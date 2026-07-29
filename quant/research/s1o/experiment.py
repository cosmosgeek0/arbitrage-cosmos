#!/usr/bin/env python3
"""Sealed public-only S-1O research packet.

The module has no import-time I/O. Network access exists only in the explicit
``acquire`` command and is restricted to data.binance.vision.
"""

from __future__ import annotations

import argparse
import bisect
import contextlib
import csv
import hashlib
import io
import itertools
import json
import os
import random
import shutil
import stat
import sys
import tempfile
import urllib.request
import zipfile
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import cast

PACKET_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = PACKET_ROOT.parents[2]
PROTOCOL_PATH = PACKET_ROOT / "protocol.v1.json"
SOURCE_RESEARCH_PATH = PACKET_ROOT / "OFFICIAL_SOURCE_RESEARCH.md"
GENERATED_ROOT = PACKET_ROOT / "generated"
BASE_URL = "https://data.binance.vision/"
FIVE_MINUTES_MS = 300_000
TEN_MINUTES_MS = 600_000
DAY_MS = 86_400_000
MAX_ARCHIVE_BYTES = 2_000_000_000


class EvidenceError(RuntimeError):
    """Fail-closed public evidence error."""


@dataclass(frozen=True, order=True)
class ArchiveSpec:
    custody: str
    dataset: str
    period: str
    relative_path: str

    @property
    def url(self) -> str:
        return BASE_URL + self.relative_path

    @property
    def checksum_url(self) -> str:
        return self.url + ".CHECKSUM"

    @property
    def key(self) -> str:
        return f"{self.custody}:{self.dataset}:{self.period}"


@dataclass(frozen=True)
class FundingEvent:
    timestamp_ms: int
    interval_hours: int
    rate: Decimal


@dataclass(frozen=True)
class OIRow:
    timestamp_ms: int
    open_interest: Decimal
    open_interest_value: Decimal


@dataclass(frozen=True)
class Bar:
    open_time_ms: int
    close_time_ms: int
    close: Decimal
    quote_volume: Decimal


@dataclass(frozen=True, order=True)
class Trial:
    oi_window_hours: int
    minimum_oi_growth: Decimal
    minimum_abs_funding: Decimal

    @property
    def trial_id(self) -> str:
        growth_bp = int(self.minimum_oi_growth * Decimal(10_000))
        funding_bp_tenth = int(self.minimum_abs_funding * Decimal(100_000))
        return (
            f"oi{self.oi_window_hours:02d}h"
            f"_growth{growth_bp:04d}bp"
            f"_funding{funding_bp_tenth:02d}tenthbp"
        )


@dataclass(frozen=True)
class Trade:
    trial_id: str
    signal_timestamp_ms: int
    next_settlement_ms: int
    entry_timestamp_ms: int
    exit_timestamp_ms: int
    side: int
    observed_funding_rate: Decimal
    next_funding_rate: Decimal
    oi_growth: Decimal
    capacity_proxy_usdt: Decimal
    price_pnl_usdt: Decimal
    funding_pnl_usdt: Decimal
    base_fee_proxy_usdt: Decimal
    base_adverse_fill_proxy_usdt: Decimal
    base_net_pnl_usdt: Decimal
    stress_fee_proxy_usdt: Decimal
    stress_adverse_fill_proxy_usdt: Decimal
    stress_net_pnl_usdt: Decimal
    severe_fee_proxy_usdt: Decimal
    severe_adverse_fill_proxy_usdt: Decimal
    severe_net_pnl_usdt: Decimal


@dataclass(frozen=True)
class Evidence:
    funding: tuple[FundingEvent, ...]
    oi: tuple[OIRow, ...]
    marks: tuple[Bar, ...]
    contracts: tuple[Bar, ...]


@dataclass(frozen=True)
class ReplayState:
    stage: str
    champion: str | None
    champion_assessment: dict[str, object] | None
    holdout_marker_required: bool


def _load_json_object(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON_OBJECT_REQUIRED:{path}")
    return cast(dict[str, object], value)


def load_protocol() -> dict[str, object]:
    protocol = _load_json_object(PROTOCOL_PATH)
    if protocol.get("schema") != "cosmos.s1o.protocol.v1":
        raise EvidenceError("PROTOCOL_SCHEMA_MISMATCH")
    return protocol


def canonical_json_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write(path: Path, value: bytes) -> None:
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
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(canonical_json_bytes(value))
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo != UTC:
        raise EvidenceError(f"UTC_REQUIRED:{value}")
    return parsed


def to_ms(value: datetime) -> int:
    return int(value.timestamp() * 1000)


def _calendar() -> dict[str, datetime]:
    protocol = load_protocol()
    raw = protocol.get("calendar")
    if not isinstance(raw, dict):
        raise EvidenceError("CALENDAR_REQUIRED")
    calendar = cast(dict[str, object], raw)
    keys = (
        "acquisition_start",
        "analysis_start",
        "development_end",
        "embargo_end",
        "analysis_end",
    )
    result: dict[str, datetime] = {}
    for key in keys:
        value = calendar.get(key)
        if not isinstance(value, str):
            raise EvidenceError(f"CALENDAR_VALUE_REQUIRED:{key}")
        result[key] = parse_utc(value)
    return result


def _dates(start: datetime, end: datetime) -> Iterable[date]:
    cursor = start.date()
    while cursor < end.date():
        yield cursor
        cursor += timedelta(days=1)


def _months(start: datetime, end: datetime) -> Iterable[str]:
    cursor = date(start.year, start.month, 1)
    final = date(end.year, end.month, 1)
    while cursor <= final:
        yield cursor.strftime("%Y-%m")
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)


def build_acquisition_plan() -> tuple[ArchiveSpec, ...]:
    calendar = _calendar()
    specs: list[ArchiveSpec] = []
    daily_ranges = (
        ("development", calendar["acquisition_start"], calendar["development_end"]),
        ("holdout", calendar["development_end"], calendar["analysis_end"]),
    )
    for custody, start, end in daily_ranges:
        for day in _dates(start, end):
            stamp = day.isoformat()
            path = f"data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-{stamp}.zip"
            specs.append(ArchiveSpec(custody, "metrics", stamp, path))

    monthly_ranges = (
        ("development", calendar["acquisition_start"], calendar["development_end"]),
        ("holdout", calendar["development_end"], calendar["analysis_end"]),
    )
    for custody, start, end in monthly_ranges:
        for month in _months(start, end - timedelta(microseconds=1)):
            specs.extend(
                (
                    ArchiveSpec(
                        custody,
                        "funding_rate",
                        month,
                        "data/futures/um/monthly/fundingRate/BTCUSDT/"
                        f"BTCUSDT-fundingRate-{month}.zip",
                    ),
                    ArchiveSpec(
                        custody,
                        "mark_price_5m",
                        month,
                        "data/futures/um/monthly/markPriceKlines/BTCUSDT/5m/"
                        f"BTCUSDT-5m-{month}.zip",
                    ),
                    ArchiveSpec(
                        custody,
                        "contract_5m",
                        month,
                        f"data/futures/um/monthly/klines/BTCUSDT/5m/BTCUSDT-5m-{month}.zip",
                    ),
                )
            )
    keys = [spec.key for spec in specs]
    if len(keys) != len(set(keys)):
        raise EvidenceError("ACQUISITION_PLAN_DUPLICATE")
    return tuple(sorted(specs))


def acquisition_plan_payload() -> dict[str, object]:
    specs = build_acquisition_plan()
    return {
        "schema": "cosmos.s1o.acquisition-plan.v1",
        "protocol_sha256": sha256_file(PROTOCOL_PATH),
        "base_url": BASE_URL,
        "archive_count": len(specs),
        "archives": [
            {
                "key": spec.key,
                "custody": spec.custody,
                "dataset": spec.dataset,
                "period": spec.period,
                "relative_path": spec.relative_path,
                "url": spec.url,
                "checksum_url": spec.checksum_url,
            }
            for spec in specs
        ],
    }


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return True


def validate_external_data_root(data_root: Path) -> Path:
    if not data_root.is_absolute():
        raise EvidenceError("DATA_ROOT_MUST_BE_ABSOLUTE")
    if data_root.is_symlink():
        raise EvidenceError("DATA_ROOT_SYMLINK_FORBIDDEN")
    resolved = data_root.resolve()
    if resolved == Path("/") or _is_within(resolved, REPOSITORY_ROOT.resolve()):
        raise EvidenceError("DATA_ROOT_REPOSITORY_OR_BROAD_PATH_FORBIDDEN")
    return resolved


def _parse_checksum(text: str, expected_name: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) != 1:
        raise EvidenceError(f"CHECKSUM_LINE_COUNT:{expected_name}")
    fields = lines[0].replace("*", " ").split()
    if len(fields) != 2 or fields[1] != expected_name:
        raise EvidenceError(f"CHECKSUM_NAME_MISMATCH:{expected_name}")
    digest = fields[0].lower()
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise EvidenceError(f"CHECKSUM_FORMAT_INVALID:{expected_name}")
    return digest


def _download(url: str, destination: Path) -> None:
    if not url.startswith(BASE_URL):
        raise EvidenceError("ACQUISITION_HOST_FORBIDDEN")
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", dir=destination.parent
    )
    try:
        with (
            os.fdopen(descriptor, "wb") as output,
            urllib.request.urlopen(url, timeout=60) as response,
        ):
            if response.geturl() != url:
                raise EvidenceError(f"ACQUISITION_REDIRECT_FORBIDDEN:{url}")
            shutil.copyfileobj(response, output, length=1 << 20)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, destination)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary_name)


def _archive_paths(data_root: Path, spec: ArchiveSpec) -> tuple[Path, Path]:
    archive = data_root / spec.custody / spec.relative_path
    return archive, archive.with_name(archive.name + ".CHECKSUM")


def _regular_file_identity(path: Path) -> tuple[int, int]:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise EvidenceError(f"REGULAR_FILE_MISSING:{path.name}") from error
    if path.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        raise EvidenceError(f"REGULAR_FILE_REQUIRED:{path.name}")
    if metadata.st_nlink != 1:
        raise EvidenceError(f"HARDLINK_FORBIDDEN:{path.name}")
    return metadata.st_dev, metadata.st_ino


def _require_distinct_regular_files(paths: Sequence[Path]) -> None:
    identities: dict[tuple[int, int], Path] = {}
    for path in paths:
        identity = _regular_file_identity(path)
        if identity in identities:
            raise EvidenceError(f"FILE_IDENTITY_REUSED:{identities[identity].name}:{path.name}")
        identities[identity] = path


def verify_archive(data_root: Path, spec: ArchiveSpec) -> dict[str, object]:
    archive, checksum = _archive_paths(data_root, spec)
    _require_distinct_regular_files((archive, checksum))
    expected = _parse_checksum(checksum.read_text(encoding="utf-8"), archive.name)
    found = sha256_file(archive)
    if found != expected:
        raise EvidenceError(f"CHECKSUM_MISMATCH:{spec.key}")
    return {
        "key": spec.key,
        "relative_archive": str(archive.relative_to(data_root)),
        "relative_checksum": str(checksum.relative_to(data_root)),
        "sha256": found,
        "bytes": archive.stat().st_size,
    }


def acquire(data_root: Path) -> dict[str, object]:
    # No archive bytes may be requested until protocol, citations, and this
    # evaluator have one exact immutable seal.
    verify_freeze()
    verify_acquisition_plan()
    root = validate_external_data_root(data_root)
    marker_path = root / "S1O_DATA_ROOT.json"
    protocol_digest = sha256_file(PROTOCOL_PATH)
    if root.exists() and not marker_path.is_file() and any(root.iterdir()):
        raise EvidenceError("NONEMPTY_UNBOUND_DATA_ROOT")
    root.mkdir(parents=True, exist_ok=True)
    marker = {
        "schema": "cosmos.s1o.data-root.v1",
        "protocol_sha256": protocol_digest,
        "base_url": BASE_URL,
        "canonical_data_root": str(root),
    }
    if marker_path.exists():
        if _load_json_object(marker_path) != marker:
            raise EvidenceError("DATA_ROOT_MARKER_MISMATCH")
    else:
        atomic_create(marker_path, marker)

    records: list[dict[str, object]] = []
    for spec in build_acquisition_plan():
        archive, checksum = _archive_paths(root, spec)
        if not checksum.exists():
            _download(spec.checksum_url, checksum)
        if not archive.exists():
            _download(spec.url, archive)
        try:
            records.append(verify_archive(root, spec))
        except EvidenceError:
            archive.unlink(missing_ok=True)
            checksum.unlink(missing_ok=True)
            raise
    manifest: dict[str, object] = {
        "schema": "cosmos.s1o.data-manifest.v1",
        "protocol_sha256": protocol_digest,
        "archive_count": len(records),
        "archives": records,
    }
    manifest["manifest_sha256"] = sha256_bytes(canonical_json_bytes(manifest))
    atomic_write(root / "S1O_DATA_MANIFEST.json", canonical_json_bytes(manifest))
    return manifest


def _create_immutable_json(path: Path, payload: dict[str, object]) -> None:
    if os.path.lexists(path):
        _regular_file_identity(path)
        if _load_json_object(path) != payload:
            raise EvidenceError(f"IMMUTABLE_ARTIFACT_MISMATCH:{path.name}")
        return
    atomic_create(path, payload)


def freeze() -> dict[str, object]:
    payload: dict[str, object] = {
        "schema": "cosmos.s1o.freeze.v1",
        "protocol_sha256": sha256_file(PROTOCOL_PATH),
        "official_source_research_sha256": sha256_file(SOURCE_RESEARCH_PATH),
        "evaluator_sha256": sha256_file(Path(__file__).resolve()),
        "base_commit": "a169b123fb186d1943a75ad648552c4d95be1be1",
    }
    payload["freeze_sha256"] = sha256_bytes(canonical_json_bytes(payload))
    _create_immutable_json(GENERATED_ROOT / "freeze.v1.json", payload)
    return payload


def verify_freeze() -> dict[str, object]:
    path = GENERATED_ROOT / "freeze.v1.json"
    _regular_file_identity(path)
    freeze_payload = _load_json_object(path)
    expected = {
        "schema": "cosmos.s1o.freeze.v1",
        "protocol_sha256": sha256_file(PROTOCOL_PATH),
        "official_source_research_sha256": sha256_file(SOURCE_RESEARCH_PATH),
        "evaluator_sha256": sha256_file(Path(__file__).resolve()),
        "base_commit": "a169b123fb186d1943a75ad648552c4d95be1be1",
    }
    expected["freeze_sha256"] = sha256_bytes(canonical_json_bytes(expected))
    if freeze_payload != expected:
        raise EvidenceError("FREEZE_MISMATCH")
    return freeze_payload


def verify_acquisition_plan() -> dict[str, object]:
    path = GENERATED_ROOT / "acquisition-plan.v1.json"
    _regular_file_identity(path)
    plan = _load_json_object(path)
    if plan != acquisition_plan_payload():
        raise EvidenceError("ACQUISITION_PLAN_MISMATCH")
    return plan


def _validate_source_data_manifest_payload(manifest: dict[str, object]) -> str:
    required_root_fields = {
        "schema",
        "protocol_sha256",
        "archive_count",
        "archives",
        "manifest_sha256",
    }
    if set(manifest) != required_root_fields:
        raise EvidenceError("DATA_MANIFEST_ROOT_FIELDS_MISMATCH")
    if manifest.get("schema") != "cosmos.s1o.data-manifest.v1":
        raise EvidenceError("DATA_MANIFEST_SCHEMA_MISMATCH")
    if manifest.get("protocol_sha256") != sha256_file(PROTOCOL_PATH):
        raise EvidenceError("DATA_MANIFEST_PROTOCOL_MISMATCH")
    without_digest = dict(manifest)
    claimed = without_digest.pop("manifest_sha256")
    found = sha256_bytes(canonical_json_bytes(without_digest))
    if claimed != found:
        raise EvidenceError("DATA_MANIFEST_DIGEST_MISMATCH")
    records = manifest.get("archives")
    specs = build_acquisition_plan()
    if (
        manifest.get("archive_count") != len(specs)
        or not isinstance(records, list)
        or len(records) != len(specs)
    ):
        raise EvidenceError("DATA_MANIFEST_COUNT_MISMATCH")
    required_record_fields = {
        "key",
        "relative_archive",
        "relative_checksum",
        "sha256",
        "bytes",
    }
    for raw, spec in zip(records, specs, strict=True):
        if not isinstance(raw, dict):
            raise EvidenceError("DATA_MANIFEST_RECORD_INVALID")
        record = cast(dict[str, object], raw)
        if set(record) != required_record_fields or record.get("key") != spec.key:
            raise EvidenceError(f"DATA_MANIFEST_RECORD_FIELDS_MISMATCH:{spec.key}")
        expected_archive = str(Path(spec.custody) / spec.relative_path)
        if (
            record.get("relative_archive") != expected_archive
            or record.get("relative_checksum") != expected_archive + ".CHECKSUM"
        ):
            raise EvidenceError(f"DATA_MANIFEST_RECORD_PATH_MISMATCH:{spec.key}")
        digest = record.get("sha256")
        byte_count = record.get("bytes")
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
            raise EvidenceError(f"DATA_MANIFEST_RECORD_DIGEST_INVALID:{spec.key}")
        if not isinstance(byte_count, int) or isinstance(byte_count, bool) or byte_count <= 0:
            raise EvidenceError(f"DATA_MANIFEST_RECORD_BYTES_INVALID:{spec.key}")
    return found


def verify_data_manifest(data_root: Path) -> dict[str, object]:
    root = validate_external_data_root(data_root)
    root_marker_path = root / "S1O_DATA_ROOT.json"
    manifest_path = root / "S1O_DATA_MANIFEST.json"
    _require_distinct_regular_files((root_marker_path, manifest_path))
    expected_root_marker = {
        "schema": "cosmos.s1o.data-root.v1",
        "protocol_sha256": sha256_file(PROTOCOL_PATH),
        "base_url": BASE_URL,
        "canonical_data_root": str(root),
    }
    if _load_json_object(root_marker_path) != expected_root_marker:
        raise EvidenceError("DATA_ROOT_MARKER_MISMATCH")
    expected_specs = build_acquisition_plan()
    planned_paths: list[Path] = [root_marker_path, manifest_path]
    for spec in expected_specs:
        planned_paths.extend(_archive_paths(root, spec))
    _require_distinct_regular_files(planned_paths)
    manifest = _load_json_object(manifest_path)
    _validate_source_data_manifest_payload(manifest)
    records = cast(list[object], manifest["archives"])
    for raw, spec in zip(records, expected_specs, strict=True):
        record = cast(dict[str, object], raw)
        verified = verify_archive(root, spec)
        for field in ("relative_archive", "relative_checksum", "sha256", "bytes"):
            if record.get(field) != verified[field]:
                raise EvidenceError(f"DATA_MANIFEST_RECORD_MISMATCH:{spec.key}:{field}")
    return manifest


def verify_source_data_manifest_copy() -> dict[str, object]:
    path = GENERATED_ROOT / "source-data-manifest.v1.json"
    _regular_file_identity(path)
    manifest = _load_json_object(path)
    _validate_source_data_manifest_payload(manifest)
    return manifest


def _member_rows(data_root: Path, spec: ArchiveSpec) -> Iterable[list[str]]:
    archive, _ = _archive_paths(data_root, spec)
    verify_archive(data_root, spec)
    with zipfile.ZipFile(archive) as bundle:
        members = [member for member in bundle.infolist() if not member.is_dir()]
        if len(members) != 1:
            raise EvidenceError(f"ZIP_MEMBER_COUNT:{spec.key}")
        member = members[0]
        if Path(member.filename).name != member.filename or member.file_size > MAX_ARCHIVE_BYTES:
            raise EvidenceError(f"ZIP_MEMBER_UNSAFE:{spec.key}")
        with (
            bundle.open(member, "r") as raw,
            io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as text,
        ):
            yield from csv.reader(text)


def _decimal(value: str, label: str) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise EvidenceError(f"DECIMAL_INVALID:{label}") from error
    if not parsed.is_finite():
        raise EvidenceError(f"DECIMAL_NONFINITE:{label}")
    return parsed


def _integer(value: str, label: str) -> int:
    try:
        return int(value)
    except ValueError as error:
        raise EvidenceError(f"INTEGER_INVALID:{label}") from error


def _metrics_timestamp(value: str) -> int:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
    except ValueError as error:
        raise EvidenceError("METRICS_TIMESTAMP_FORMAT_INVALID") from error
    return to_ms(parsed)


def _dedupe_sorted[T](items: Iterable[T], selector: Callable[[T], int]) -> tuple[T, ...]:
    ordered = sorted(items, key=selector)
    for left, right in itertools.pairwise(ordered):
        if selector(left) == selector(right):
            raise EvidenceError(f"DUPLICATE_TIMESTAMP:{selector(left)}")
    return tuple(ordered)


def _parse_funding(
    data_root: Path, specs: Sequence[ArchiveSpec], start_ms: int, end_ms: int
) -> tuple[FundingEvent, ...]:
    events: list[FundingEvent] = []
    expected = ["calc_time", "funding_interval_hours", "last_funding_rate"]
    for spec in specs:
        rows = iter(_member_rows(data_root, spec))
        try:
            header = next(rows)
        except StopIteration as error:
            raise EvidenceError(f"EMPTY_ARCHIVE:{spec.key}") from error
        if header != expected:
            raise EvidenceError(f"FUNDING_SCHEMA_DRIFT:{spec.key}")
        for row in rows:
            if len(row) != 3:
                raise EvidenceError(f"FUNDING_WIDTH:{spec.key}")
            timestamp_ms = _integer(row[0], "funding_timestamp")
            interval_hours = _integer(row[1], "funding_interval")
            if interval_hours < 1 or interval_hours > 24:
                raise EvidenceError(f"FUNDING_INTERVAL_DOMAIN_INVALID:{timestamp_ms}")
            if timestamp_ms >= end_ms:
                break
            if timestamp_ms >= start_ms:
                events.append(
                    FundingEvent(
                        timestamp_ms,
                        interval_hours,
                        _decimal(row[2], "funding_rate"),
                    )
                )
    result = _dedupe_sorted(events, lambda event: event.timestamp_ms)
    for previous, current in itertools.pairwise(result):
        delta = current.timestamp_ms - previous.timestamp_ms
        if (
            previous.interval_hours < 1
            or previous.interval_hours > 24
            or current.interval_hours < 1
            or current.interval_hours > 24
            or min(
                abs(delta - previous.interval_hours * 3_600_000),
                abs(delta - current.interval_hours * 3_600_000),
            )
            > 1_000
        ):
            raise EvidenceError(f"FUNDING_INTERVAL_GAP:{previous.timestamp_ms}")
    return result


def _parse_oi(
    data_root: Path, specs: Sequence[ArchiveSpec], start_ms: int, end_ms: int
) -> tuple[OIRow, ...]:
    rows_out: list[OIRow] = []
    required = (
        "create_time",
        "symbol",
        "sum_open_interest",
        "sum_open_interest_value",
    )
    for spec in specs:
        rows = iter(_member_rows(data_root, spec))
        try:
            header = next(rows)
        except StopIteration as error:
            raise EvidenceError(f"EMPTY_ARCHIVE:{spec.key}") from error
        positions = {name: index for index, name in enumerate(header)}
        if any(name not in positions for name in required):
            raise EvidenceError(f"METRICS_SCHEMA_DRIFT:{spec.key}")
        for row in rows:
            if len(row) != len(header):
                raise EvidenceError(f"METRICS_WIDTH:{spec.key}")
            timestamp_ms = _metrics_timestamp(row[positions["create_time"]])
            if timestamp_ms >= end_ms:
                break
            if timestamp_ms < start_ms:
                continue
            if row[positions["symbol"]] != "BTCUSDT":
                raise EvidenceError(f"METRICS_SYMBOL:{spec.key}")
            if timestamp_ms % FIVE_MINUTES_MS != 0:
                raise EvidenceError(f"METRICS_ALIGNMENT:{timestamp_ms}")
            open_interest = _decimal(row[positions["sum_open_interest"]], "open_interest")
            open_interest_value = _decimal(
                row[positions["sum_open_interest_value"]], "open_interest_value"
            )
            if open_interest <= 0 or open_interest_value <= 0:
                raise EvidenceError(f"METRICS_DOMAIN_INVALID:{timestamp_ms}")
            rows_out.append(
                OIRow(
                    timestamp_ms,
                    open_interest,
                    open_interest_value,
                )
            )
    result = _dedupe_sorted(rows_out, lambda row: row.timestamp_ms)
    for previous, current in itertools.pairwise(result):
        if current.timestamp_ms - previous.timestamp_ms != FIVE_MINUTES_MS:
            raise EvidenceError(f"METRICS_GAP:{previous.timestamp_ms}")
    return result


def _parse_bars(
    data_root: Path,
    specs: Sequence[ArchiveSpec],
    start_ms: int,
    end_ms: int,
    dataset: str,
) -> tuple[Bar, ...]:
    bars: list[Bar] = []
    for spec in specs:
        rows = iter(_member_rows(data_root, spec))
        for row in rows:
            if row and not row[0].isdigit():
                continue
            if len(row) != 12:
                raise EvidenceError(f"KLINE_WIDTH:{spec.key}")
            open_ms = _integer(row[0], "bar_open")
            close_ms = _integer(row[6], "bar_close")
            if open_ms >= end_ms:
                break
            if open_ms < start_ms:
                continue
            if open_ms % FIVE_MINUTES_MS != 0 or close_ms != open_ms + FIVE_MINUTES_MS - 1:
                raise EvidenceError(f"KLINE_ALIGNMENT:{spec.key}:{open_ms}")
            quote_volume = (
                Decimal(0) if dataset == "mark_price_5m" else _decimal(row[7], "quote_volume")
            )
            close = _decimal(row[4], "bar_close_price")
            if close <= 0:
                raise EvidenceError(f"KLINE_CLOSE_DOMAIN_INVALID:{dataset}:{open_ms}")
            if dataset == "contract_5m" and quote_volume < 0:
                raise EvidenceError(f"KLINE_QUOTE_VOLUME_DOMAIN_INVALID:{open_ms}")
            bars.append(Bar(open_ms, close_ms, close, quote_volume))
    result = _dedupe_sorted(bars, lambda bar: bar.open_time_ms)
    for previous, current in itertools.pairwise(result):
        if current.open_time_ms - previous.open_time_ms != FIVE_MINUTES_MS:
            raise EvidenceError(f"KLINE_GAP:{dataset}:{previous.open_time_ms}")
    return result


def _validate_boundary_coverage(
    evidence: Evidence, start_ms: int, end_ms: int, custody: str
) -> None:
    if start_ms % FIVE_MINUTES_MS != 0 or end_ms % FIVE_MINUTES_MS != 0 or end_ms <= start_ms:
        raise EvidenceError(f"BOUNDARY_WINDOW_INVALID:{custody}")
    expected_oi_first = start_ms + FIVE_MINUTES_MS
    expected_oi_last = end_ms - FIVE_MINUTES_MS
    if (
        evidence.oi[0].timestamp_ms != expected_oi_first
        or evidence.oi[-1].timestamp_ms != expected_oi_last
    ):
        raise EvidenceError(f"METRICS_BOUNDARY_INCOMPLETE:{custody}")
    expected_bar_last = end_ms - FIVE_MINUTES_MS
    for dataset, bars in (
        ("mark_price_5m", evidence.marks),
        ("contract_5m", evidence.contracts),
    ):
        if bars[0].open_time_ms != start_ms or bars[-1].open_time_ms != expected_bar_last:
            raise EvidenceError(f"KLINE_BOUNDARY_INCOMPLETE:{dataset}:{custody}")
    first_funding = evidence.funding[0]
    last_funding = evidence.funding[-1]
    if abs(first_funding.timestamp_ms - start_ms) > 1_000:
        raise EvidenceError(f"FUNDING_START_BOUNDARY_INCOMPLETE:{custody}")
    end_gap_ms = end_ms - last_funding.timestamp_ms
    if end_gap_ms <= 0 or end_gap_ms > last_funding.interval_hours * 3_600_000 + 1_000:
        raise EvidenceError(f"FUNDING_END_BOUNDARY_INCOMPLETE:{custody}")


def load_evidence(data_root: Path, custody: str, start: datetime, end: datetime) -> Evidence:
    if custody == "development":
        if not (GENERATED_ROOT / "RUN_CONSUMED.json").is_file():
            raise EvidenceError("DEVELOPMENT_ACCESS_BEFORE_RUN_MARKER")
    elif custody == "holdout":
        if not (GENERATED_ROOT / "champion.seal.v1.json").is_file():
            raise EvidenceError("HOLDOUT_ACCESS_BEFORE_CHAMPION_SEAL")
        if not (GENERATED_ROOT / "HOLDOUT_OPENED.json").is_file():
            raise EvidenceError("HOLDOUT_ACCESS_BEFORE_OPEN_MARKER")
    else:
        raise EvidenceError(f"CUSTODY_UNKNOWN:{custody}")
    specs = [spec for spec in build_acquisition_plan() if spec.custody == custody]
    by_dataset = {
        dataset: [spec for spec in specs if spec.dataset == dataset]
        for dataset in ("metrics", "funding_rate", "mark_price_5m", "contract_5m")
    }
    start_ms = to_ms(start)
    end_ms = to_ms(end)
    evidence = Evidence(
        _parse_funding(data_root, by_dataset["funding_rate"], start_ms, end_ms),
        _parse_oi(data_root, by_dataset["metrics"], start_ms, end_ms),
        _parse_bars(data_root, by_dataset["mark_price_5m"], start_ms, end_ms, "mark_price_5m"),
        _parse_bars(data_root, by_dataset["contract_5m"], start_ms, end_ms, "contract_5m"),
    )
    if not all((evidence.funding, evidence.oi, evidence.marks, evidence.contracts)):
        raise EvidenceError(f"EVIDENCE_EMPTY:{custody}")
    _validate_boundary_coverage(evidence, start_ms, end_ms, custody)
    return evidence


def frozen_trials() -> tuple[Trial, ...]:
    return tuple(
        Trial(window, Decimal(growth), Decimal(funding))
        for window, growth, funding in itertools.product(
            (8, 24), ("0", "0.01"), ("0.00005", "0.0001")
        )
    )


def _asof_oi(rows: Sequence[OIRow], cutoff_ms: int) -> OIRow | None:
    timestamps = [row.timestamp_ms for row in rows]
    index = bisect.bisect_right(timestamps, cutoff_ms) - 1
    if index < 0:
        return None
    row = rows[index]
    if row.timestamp_ms > cutoff_ms or cutoff_ms - row.timestamp_ms > TEN_MINUTES_MS:
        return None
    return row


def _first_complete_bar_after(bars: Sequence[Bar], event_ms: int) -> Bar | None:
    close_times = [bar.close_time_ms for bar in bars]
    index = bisect.bisect_right(close_times, event_ms)
    if index >= len(bars):
        return None
    bar = bars[index]
    if bar.close_time_ms - event_ms > FIVE_MINUTES_MS:
        return None
    return bar


def _latest_complete_bar_at_or_before(bars: Sequence[Bar], event_ms: int) -> Bar | None:
    close_times = [bar.close_time_ms for bar in bars]
    index = bisect.bisect_right(close_times, event_ms) - 1
    if index < 0:
        return None
    bar = bars[index]
    if event_ms - bar.close_time_ms > FIVE_MINUTES_MS:
        return None
    return bar


def _capacity_proxy(bars: Sequence[Bar], event_ms: int, current_oi: OIRow) -> Decimal | None:
    close_times = [bar.close_time_ms for bar in bars]
    end_index = bisect.bisect_left(close_times, event_ms)
    start_index = end_index - 288
    if start_index < 0:
        return None
    window = bars[start_index:end_index]
    if len(window) != 288:
        return None
    if window[0].close_time_ms < event_ms - DAY_MS:
        return None
    if window[-1].close_time_ms >= event_ms:
        return None
    if any(
        right.open_time_ms - left.open_time_ms != FIVE_MINUTES_MS
        for left, right in itertools.pairwise(window)
    ):
        return None
    volume_capacity = sum((bar.quote_volume for bar in window), Decimal(0)) * Decimal("0.000001")
    oi_capacity = current_oi.open_interest_value * Decimal("0.000001")
    return min(volume_capacity, oi_capacity)


def _scenario_cost(notional: Decimal, fee_bps: str, adverse_bps: str) -> tuple[Decimal, Decimal]:
    fee = notional * Decimal(fee_bps) / Decimal(10_000) * 2
    adverse = notional * Decimal(adverse_bps) / Decimal(10_000) * 2
    return fee, adverse


def evaluate_trial(
    trial: Trial, evidence: Evidence, period_start_ms: int, period_end_ms: int
) -> tuple[Trade, ...]:
    notional = Decimal("1000")
    base_fee, base_adverse = _scenario_cost(notional, "4", "2")
    stress_fee, stress_adverse = _scenario_cost(notional, "8", "5")
    severe_fee, severe_adverse = _scenario_cost(notional, "10", "10")
    trades: list[Trade] = []
    for previous, current, following in zip(
        evidence.funding, evidence.funding[1:], evidence.funding[2:], strict=False
    ):
        if not (period_start_ms <= current.timestamp_ms < period_end_ms):
            continue
        if following.timestamp_ms >= period_end_ms:
            continue
        if current.rate == 0 or previous.rate == 0:
            continue
        if (current.rate > 0) != (previous.rate > 0):
            continue
        if abs(current.rate) < trial.minimum_abs_funding:
            continue
        current_cutoff = current.timestamp_ms - FIVE_MINUTES_MS
        baseline_cutoff = current.timestamp_ms - trial.oi_window_hours * 3_600_000 - FIVE_MINUTES_MS
        current_oi = _asof_oi(evidence.oi, current_cutoff)
        baseline_oi = _asof_oi(evidence.oi, baseline_cutoff)
        if current_oi is None or baseline_oi is None or baseline_oi.open_interest <= 0:
            continue
        oi_growth = current_oi.open_interest / baseline_oi.open_interest - 1
        if oi_growth < trial.minimum_oi_growth:
            continue
        entry = _first_complete_bar_after(evidence.contracts, current.timestamp_ms)
        exit_bar = _first_complete_bar_after(evidence.contracts, following.timestamp_ms)
        settlement_mark = _latest_complete_bar_at_or_before(evidence.marks, following.timestamp_ms)
        capacity = _capacity_proxy(evidence.contracts, current.timestamp_ms, current_oi)
        if (
            entry is None
            or exit_bar is None
            or settlement_mark is None
            or capacity is None
            or entry.close <= 0
        ):
            continue
        side = -1 if current.rate > 0 else 1
        quantity = notional / entry.close
        price_pnl = Decimal(side) * quantity * (exit_bar.close - entry.close)
        funding_notional = quantity * settlement_mark.close
        funding_pnl = -Decimal(side) * following.rate * funding_notional
        gross = price_pnl + funding_pnl
        trades.append(
            Trade(
                trial.trial_id,
                current.timestamp_ms,
                following.timestamp_ms,
                entry.close_time_ms,
                exit_bar.close_time_ms,
                side,
                current.rate,
                following.rate,
                oi_growth,
                capacity,
                price_pnl,
                funding_pnl,
                base_fee,
                base_adverse,
                gross - base_fee - base_adverse,
                stress_fee,
                stress_adverse,
                gross - stress_fee - stress_adverse,
                severe_fee,
                severe_adverse,
                gross - severe_fee - severe_adverse,
            )
        )
    return tuple(trades)


def _daily_values(
    trades: Sequence[Trade], start_ms: int, day_count: int, field: str
) -> tuple[Decimal, ...]:
    values = [Decimal(0) for _ in range(day_count)]
    for trade in trades:
        index = (trade.signal_timestamp_ms - start_ms) // DAY_MS
        if 0 <= index < day_count:
            values[index] += cast(Decimal, getattr(trade, field))
    return tuple(values)


def _mean(values: Sequence[Decimal]) -> Decimal:
    return sum(values, Decimal(0)) / Decimal(len(values)) if values else Decimal(0)


def _quantile(values: Sequence[Decimal], probability: Decimal) -> Decimal:
    if not values:
        return Decimal(0)
    ordered = sorted(values)
    index = int((Decimal(len(ordered) - 1) * probability).to_integral_value())
    return ordered[index]


def _bootstrap_indices(rng: random.Random, length: int, block_length: int) -> tuple[int, ...]:
    output: list[int] = []
    while len(output) < length:
        start = rng.randrange(length)
        output.extend((start + offset) % length for offset in range(block_length))
    return tuple(output[:length])


def bootstrap_trial(
    daily: Sequence[Decimal], seed: int, replicates: int = 4096
) -> tuple[Decimal, Decimal]:
    observed = _mean(daily)
    centered = tuple(value - observed for value in daily)
    rng = random.Random(seed)
    centered_means: list[Decimal] = []
    for _ in range(replicates):
        indices = _bootstrap_indices(rng, len(daily), 7)
        centered_means.append(_mean([centered[index] for index in indices]))
    exceedances = sum(value >= observed for value in centered_means)
    p_value = Decimal(1 + exceedances) / Decimal(replicates + 1)
    lcb = observed - _quantile(centered_means, Decimal("0.95"))
    return p_value, lcb


def white_reality_check(
    daily_by_trial: dict[str, tuple[Decimal, ...]], seed: int, replicates: int = 4096
) -> Decimal:
    trial_ids = sorted(daily_by_trial)
    length = len(next(iter(daily_by_trial.values())))
    observed_max = max(_mean(daily_by_trial[trial_id]) for trial_id in trial_ids)
    centered = {
        trial_id: tuple(
            value - _mean(daily_by_trial[trial_id]) for value in daily_by_trial[trial_id]
        )
        for trial_id in trial_ids
    }
    rng = random.Random(seed)
    exceedances = 0
    for _ in range(replicates):
        indices = _bootstrap_indices(rng, length, 7)
        bootstrap_max = max(
            _mean([centered[trial_id][index] for index in indices]) for trial_id in trial_ids
        )
        exceedances += bootstrap_max >= observed_max
    return Decimal(1 + exceedances) / Decimal(replicates + 1)


def holm_adjust(raw: dict[str, Decimal]) -> dict[str, Decimal]:
    ordered = sorted(raw.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, Decimal] = {}
    running = Decimal(0)
    count = len(ordered)
    for index, (trial_id, p_value) in enumerate(ordered):
        candidate = min(Decimal(1), p_value * Decimal(count - index))
        running = max(running, candidate)
        adjusted[trial_id] = running
    return adjusted


def cscv_pbo(daily_by_trial: dict[str, tuple[Decimal, ...]]) -> dict[str, object]:
    if any(len(values) != 224 for values in daily_by_trial.values()):
        raise EvidenceError("CSCV_REQUIRES_224_DEVELOPMENT_DAYS")
    trial_ids = sorted(daily_by_trial)
    block_means = {
        trial_id: tuple(
            _mean(daily_by_trial[trial_id][block * 28 : (block + 1) * 28]) for block in range(8)
        )
        for trial_id in trial_ids
    }
    losses = 0
    selections: dict[str, int] = dict.fromkeys(trial_ids, 0)
    for training_blocks in itertools.combinations(range(8), 4):
        training_set = set(training_blocks)
        test_blocks = tuple(index for index in range(8) if index not in training_set)
        in_sample = {
            trial_id: _mean([block_means[trial_id][index] for index in training_blocks])
            for trial_id in trial_ids
        }
        selected = sorted(trial_ids, key=lambda trial_id: (-in_sample[trial_id], trial_id))[0]
        selections[selected] += 1
        out_sample = {
            trial_id: _mean([block_means[trial_id][index] for index in test_blocks])
            for trial_id in trial_ids
        }
        ranking = sorted(trial_ids, key=lambda trial_id: (-out_sample[trial_id], trial_id))
        losses += ranking.index(selected) >= len(trial_ids) // 2
    return {
        "schema": "cosmos.s1o.cscv-pbo.v1",
        "role": "DIAGNOSTIC_ONLY_NOT_A_GATE",
        "blocks": 8,
        "block_days": 28,
        "splits": 70,
        "bottom_half_losses": losses,
        "pbo": _decimal_text(Decimal(losses) / Decimal(70)),
        "selection_counts": selections,
    }


def _maximum_drawdown(trades: Sequence[Trade], field: str) -> Decimal:
    cumulative = Decimal(0)
    peak = Decimal(0)
    maximum = Decimal(0)
    for trade in trades:
        cumulative += cast(Decimal, getattr(trade, field))
        peak = max(peak, cumulative)
        maximum = max(maximum, peak - cumulative)
    return maximum / Decimal("1000")


def _decimal_text(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.000000000001")), "f")


def _trade_payload(trade: Trade) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in asdict(trade).items():
        result[key] = _decimal_text(value) if isinstance(value, Decimal) else value
    return result


def _canonical_trade(trade: Trade) -> Trade:
    payload = _trade_payload(trade)
    price = Decimal(cast(str, payload["price_pnl_usdt"]))
    funding = Decimal(cast(str, payload["funding_pnl_usdt"]))
    gross = price + funding
    for scenario in ("base", "stress", "severe"):
        fee = Decimal(cast(str, payload[f"{scenario}_fee_proxy_usdt"]))
        adverse = Decimal(cast(str, payload[f"{scenario}_adverse_fill_proxy_usdt"]))
        payload[f"{scenario}_net_pnl_usdt"] = _decimal_text(gross - fee - adverse)
    return _trade_from_payload(payload)


def economic_decomposition(trades: Sequence[Trade]) -> dict[str, object]:
    fields = (
        "price_pnl_usdt",
        "funding_pnl_usdt",
        "base_fee_proxy_usdt",
        "base_adverse_fill_proxy_usdt",
        "base_net_pnl_usdt",
        "stress_fee_proxy_usdt",
        "stress_adverse_fill_proxy_usdt",
        "stress_net_pnl_usdt",
        "severe_fee_proxy_usdt",
        "severe_adverse_fill_proxy_usdt",
        "severe_net_pnl_usdt",
    )
    total = {
        field: sum((cast(Decimal, getattr(trade, field)) for trade in trades), Decimal(0))
        for field in fields
    }
    return {
        "trade_count": len(trades),
        "totals": {field: _decimal_text(value) for field, value in total.items()},
        "means_per_trade": {
            field: _decimal_text(value / Decimal(len(trades)) if trades else Decimal(0))
            for field, value in total.items()
        },
        "labels": {
            "fees": "PUBLIC_TAKER_SCENARIO_PROXY",
            "adverse_fill": "PUBLIC_ADVERSE_FILL_SCENARIO_PROXY",
            "funding": "ARCHIVE_RATE_TIMES_LAGGED_COMPLETE_MARK_PROXY",
            "price": "FIVE_MINUTE_CONTRACT_BAR_CLOSE_PROXY",
        },
    }


def development_assessment(
    trades_by_trial: dict[str, tuple[Trade, ...]], start_ms: int
) -> tuple[dict[str, dict[str, object]], str | None, dict[str, object]]:
    daily = {
        trial_id: _daily_values(trades, start_ms, 224, "stress_net_pnl_usdt")
        for trial_id, trades in trades_by_trial.items()
    }
    raw_p: dict[str, Decimal] = {}
    lcb: dict[str, Decimal] = {}
    for trial_id in sorted(daily):
        digest_seed = int(hashlib.sha256(trial_id.encode()).hexdigest()[:8], 16)
        raw_p[trial_id], lcb[trial_id] = bootstrap_trial(daily[trial_id], 17102026 + digest_seed)
    adjusted = holm_adjust(raw_p)
    white_p = white_reality_check(daily, 17102026)
    rows: dict[str, dict[str, object]] = {}
    passing: list[str] = []
    for trial_id, trades in sorted(trades_by_trial.items()):
        active_weeks = len(
            {
                datetime.fromtimestamp(trade.signal_timestamp_ms / 1000, UTC).strftime("%G-W%V")
                for trade in trades
            }
        )
        positive_signals = sum(trade.side == -1 for trade in trades)
        negative_signals = sum(trade.side == 1 for trade in trades)
        base_mean = _mean([trade.base_net_pnl_usdt for trade in trades])
        stress_mean = _mean([trade.stress_net_pnl_usdt for trade in trades])
        capacity_min = min((trade.capacity_proxy_usdt for trade in trades), default=Decimal(0))
        drawdown = _maximum_drawdown(trades, "stress_net_pnl_usdt")
        gates = {
            "minimum_trades": len(trades) >= 20,
            "minimum_active_iso_weeks": active_weeks >= 12,
            "minimum_positive_signal_trades": positive_signals >= 5,
            "minimum_negative_signal_trades": negative_signals >= 5,
            "base_mean_positive": base_mean > 0,
            "stress_mean_positive": stress_mean > 0,
            "stress_bootstrap_lcb_positive": lcb[trial_id] > 0,
            "holm_adjusted_p": adjusted[trial_id] <= Decimal("0.05"),
            "white_reality_check_p": white_p <= Decimal("0.05"),
            "maximum_drawdown": drawdown <= Decimal("0.10"),
            "minimum_capacity_proxy": capacity_min >= Decimal("1000"),
        }
        passed = all(gates.values())
        if passed:
            passing.append(trial_id)
        rows[trial_id] = {
            "trade_count": len(trades),
            "active_iso_weeks": active_weeks,
            "positive_funding_signal_trades": positive_signals,
            "negative_funding_signal_trades": negative_signals,
            "base_mean_net_pnl_usdt": _decimal_text(base_mean),
            "stress_mean_net_pnl_usdt": _decimal_text(stress_mean),
            "stress_bootstrap_lcb_usdt_per_calendar_day": _decimal_text(lcb[trial_id]),
            "raw_p": _decimal_text(raw_p[trial_id]),
            "holm_adjusted_p": _decimal_text(adjusted[trial_id]),
            "white_reality_check_p": _decimal_text(white_p),
            "maximum_drawdown_fraction": _decimal_text(drawdown),
            "minimum_capacity_proxy_usdt": _decimal_text(capacity_min),
            "economic_decomposition": economic_decomposition(trades),
            "gates": gates,
            "passed": passed,
        }
    champion = None
    if passing:
        champion = sorted(
            passing,
            key=lambda trial_id: (
                -Decimal(cast(str, rows[trial_id]["stress_mean_net_pnl_usdt"])),
                trial_id,
            ),
        )[0]
    return rows, champion, cscv_pbo(daily)


def holdout_assessment(trades: Sequence[Trade]) -> dict[str, object]:
    active_weeks = len(
        {
            datetime.fromtimestamp(trade.signal_timestamp_ms / 1000, UTC).strftime("%G-W%V")
            for trade in trades
        }
    )
    base_total = sum((trade.base_net_pnl_usdt for trade in trades), Decimal(0))
    stress_total = sum((trade.stress_net_pnl_usdt for trade in trades), Decimal(0))
    stress_mean = _mean([trade.stress_net_pnl_usdt for trade in trades])
    drawdown = _maximum_drawdown(trades, "stress_net_pnl_usdt")
    gates = {
        "minimum_trades": len(trades) >= 10,
        "minimum_active_iso_weeks": active_weeks >= 8,
        "base_total_positive": base_total > 0,
        "stress_total_positive": stress_total > 0,
        "stress_mean_positive": stress_mean > 0,
        "maximum_drawdown": drawdown <= Decimal("0.10"),
    }
    return {
        "trade_count": len(trades),
        "active_iso_weeks": active_weeks,
        "base_total_net_pnl_usdt": _decimal_text(base_total),
        "stress_total_net_pnl_usdt": _decimal_text(stress_total),
        "stress_mean_net_pnl_usdt": _decimal_text(stress_mean),
        "maximum_drawdown_fraction": _decimal_text(drawdown),
        "economic_decomposition": economic_decomposition(trades),
        "gates": gates,
        "passed": all(gates.values()),
    }


def _base_result() -> dict[str, object]:
    return {
        "schema": "cosmos.s1o.result.v1",
        "milestone": "S-1O",
        "strategy": "BTCUSDT_OWN_SYMBOL_OI_CONDITIONED_FUNDING_SIGN_PERSISTENCE",
        "protocol_sha256": sha256_file(PROTOCOL_PATH),
        "freeze_sha256": cast(str, verify_freeze()["freeze_sha256"]),
        "account_effective_fees": "UNKNOWN",
        "executable_depth": "UNKNOWN",
        "historical_filters": "UNKNOWN",
        "executable_capacity": "UNKNOWN",
        "metrics_semantic_derivation": "UNMEASURED_OFFICIAL_ARCHIVE_DOCUMENTATION_ABSENT",
        "go_structurally_reachable": False,
        "capital_disposition": "NO_GO",
    }


def _write_artifact_manifest() -> dict[str, object]:
    names = (
        "acquisition-plan.v1.json",
        "freeze.v1.json",
        "source-data-manifest.v1.json",
        "RUN_CONSUMED.json",
        "champion.seal.v1.json",
        "HOLDOUT_OPENED.json",
        "result.v1.json",
    )
    files = [
        {
            "path": name,
            "sha256": sha256_file(GENERATED_ROOT / name),
            "bytes": (GENERATED_ROOT / name).stat().st_size,
        }
        for name in names
        if (GENERATED_ROOT / name).is_file()
    ]
    manifest: dict[str, object] = {
        "schema": "cosmos.s1o.artifact-manifest.v1",
        "files": files,
    }
    manifest["manifest_sha256"] = sha256_bytes(canonical_json_bytes(manifest))
    atomic_write(GENERATED_ROOT / "artifact-manifest.v1.json", canonical_json_bytes(manifest))
    return manifest


def _prepare_run_artifacts(source_manifest: dict[str, object]) -> None:
    stale_names = (
        "RUN_CONSUMED.json",
        "champion.seal.v1.json",
        "HOLDOUT_OPENED.json",
        "result.v1.json",
        "artifact-manifest.v1.json",
    )
    stale = [name for name in stale_names if os.path.lexists(GENERATED_ROOT / name)]
    if stale:
        raise EvidenceError(f"STALE_RUN_ARTIFACTS:{','.join(stale)}")
    _create_immutable_json(GENERATED_ROOT / "source-data-manifest.v1.json", source_manifest)


def run(data_root: Path) -> dict[str, object]:
    root = validate_external_data_root(data_root)
    freeze_payload = verify_freeze()
    verify_acquisition_plan()
    data_manifest = verify_data_manifest(root)
    _prepare_run_artifacts(data_manifest)
    run_marker = GENERATED_ROOT / "RUN_CONSUMED.json"
    atomic_create(
        run_marker,
        {
            "schema": "cosmos.s1o.run-consumed.v1",
            "protocol_sha256": sha256_file(PROTOCOL_PATH),
            "freeze_sha256": freeze_payload["freeze_sha256"],
            "data_manifest_sha256": data_manifest["manifest_sha256"],
            "state": "CONSUMED_BEFORE_DEVELOPMENT_DECOMPRESSION",
        },
    )
    result = _base_result()
    result["data_manifest_sha256"] = data_manifest["manifest_sha256"]
    calendar = _calendar()
    try:
        development = load_evidence(
            root,
            "development",
            calendar["acquisition_start"],
            calendar["development_end"],
        )
        start_ms = to_ms(calendar["analysis_start"])
        end_ms = to_ms(calendar["development_end"])
        development_trades = {
            trial.trial_id: tuple(
                _canonical_trade(trade)
                for trade in evaluate_trial(trial, development, start_ms, end_ms)
            )
            for trial in frozen_trials()
        }
        assessments, champion, pbo = development_assessment(development_trades, start_ms)
        result["development"] = {
            "trials": assessments,
            "cscv_pbo": pbo,
            "champion": champion,
            "trade_ledgers": {
                trial_id: [_trade_payload(trade) for trade in trades]
                for trial_id, trades in development_trades.items()
            },
        }
        if champion is None:
            result["verdict"] = "NO_GO"
            result["reason"] = "NO_DEVELOPMENT_TRIAL_PASSED_ALL_FROZEN_GATES"
            result["holdout_status"] = "UNOPENED"
        else:
            champion_payload = {
                "schema": "cosmos.s1o.champion-seal.v1",
                "protocol_sha256": sha256_file(PROTOCOL_PATH),
                "evaluator_sha256": freeze_payload["evaluator_sha256"],
                "trial_id": champion,
                "development_assessment_sha256": sha256_bytes(
                    canonical_json_bytes(assessments[champion])
                ),
            }
            atomic_create(GENERATED_ROOT / "champion.seal.v1.json", champion_payload)
            atomic_create(
                GENERATED_ROOT / "HOLDOUT_OPENED.json",
                {
                    "schema": "cosmos.s1o.holdout-opened.v1",
                    "champion_seal_sha256": sha256_file(GENERATED_ROOT / "champion.seal.v1.json"),
                    "state": "CREATED_BEFORE_FIRST_HOLDOUT_MEMBER_ACCESS",
                },
            )
            holdout = load_evidence(
                root,
                "holdout",
                calendar["development_end"],
                calendar["analysis_end"],
            )
            champion_trial = next(trial for trial in frozen_trials() if trial.trial_id == champion)
            holdout_trades = tuple(
                _canonical_trade(trade)
                for trade in evaluate_trial(
                    champion_trial,
                    holdout,
                    to_ms(calendar["embargo_end"]),
                    to_ms(calendar["analysis_end"]),
                )
            )
            holdout_row = holdout_assessment(holdout_trades)
            result["holdout"] = {
                "assessment": holdout_row,
                "trade_ledger": [_trade_payload(trade) for trade in holdout_trades],
            }
            result["holdout_status"] = "OPENED_AFTER_CHAMPION_SEAL"
            if not holdout_row["passed"]:
                result["verdict"] = "NO_GO"
                result["reason"] = "FROZEN_HOLDOUT_ECONOMIC_GATES_FAILED"
            else:
                result["verdict"] = "UNMEASURED"
                result["reason"] = (
                    "PUBLIC_NUMERIC_GATES_PASSED_BUT_METRICS_SEMANTICS_AND_"
                    "ACCOUNT_EFFECTIVE_EXECUTION_TRUTH_ARE_UNMEASURED"
                )
    except Exception as error:
        result["verdict"] = "UNMEASURED"
        result["reason"] = f"FAIL_CLOSED:{type(error).__name__}:{error}"
        if (GENERATED_ROOT / "HOLDOUT_OPENED.json").exists():
            result.setdefault("holdout_status", "OPENED_FAIL_CLOSED")
        else:
            result.setdefault("holdout_status", "UNOPENED")
    atomic_write(GENERATED_ROOT / "result.v1.json", canonical_json_bytes(result))
    _write_artifact_manifest()
    return result


def _payload_decimal(record: dict[str, object], field: str) -> Decimal:
    value = record.get(field)
    if not isinstance(value, str):
        raise EvidenceError(f"TRADE_DECIMAL_REQUIRED:{field}")
    parsed = _decimal(value, field)
    if _decimal_text(parsed) != value:
        raise EvidenceError(f"TRADE_DECIMAL_NONCANONICAL:{field}")
    return parsed


def _payload_integer(record: dict[str, object], field: str) -> int:
    value = record.get(field)
    if not isinstance(value, int) or isinstance(value, bool):
        raise EvidenceError(f"TRADE_INTEGER_REQUIRED:{field}")
    return value


def _trade_from_payload(raw: object) -> Trade:
    if not isinstance(raw, dict):
        raise EvidenceError("TRADE_RECORD_REQUIRED")
    record = cast(dict[str, object], raw)
    required = {field.name for field in Trade.__dataclass_fields__.values()}
    if set(record) != required:
        raise EvidenceError("TRADE_FIELDS_MISMATCH")
    trial_id = record.get("trial_id")
    if not isinstance(trial_id, str) or trial_id not in {
        trial.trial_id for trial in frozen_trials()
    }:
        raise EvidenceError("TRADE_TRIAL_ID_INVALID")
    trade = Trade(
        trial_id=trial_id,
        signal_timestamp_ms=_payload_integer(record, "signal_timestamp_ms"),
        next_settlement_ms=_payload_integer(record, "next_settlement_ms"),
        entry_timestamp_ms=_payload_integer(record, "entry_timestamp_ms"),
        exit_timestamp_ms=_payload_integer(record, "exit_timestamp_ms"),
        side=_payload_integer(record, "side"),
        observed_funding_rate=_payload_decimal(record, "observed_funding_rate"),
        next_funding_rate=_payload_decimal(record, "next_funding_rate"),
        oi_growth=_payload_decimal(record, "oi_growth"),
        capacity_proxy_usdt=_payload_decimal(record, "capacity_proxy_usdt"),
        price_pnl_usdt=_payload_decimal(record, "price_pnl_usdt"),
        funding_pnl_usdt=_payload_decimal(record, "funding_pnl_usdt"),
        base_fee_proxy_usdt=_payload_decimal(record, "base_fee_proxy_usdt"),
        base_adverse_fill_proxy_usdt=_payload_decimal(record, "base_adverse_fill_proxy_usdt"),
        base_net_pnl_usdt=_payload_decimal(record, "base_net_pnl_usdt"),
        stress_fee_proxy_usdt=_payload_decimal(record, "stress_fee_proxy_usdt"),
        stress_adverse_fill_proxy_usdt=_payload_decimal(record, "stress_adverse_fill_proxy_usdt"),
        stress_net_pnl_usdt=_payload_decimal(record, "stress_net_pnl_usdt"),
        severe_fee_proxy_usdt=_payload_decimal(record, "severe_fee_proxy_usdt"),
        severe_adverse_fill_proxy_usdt=_payload_decimal(record, "severe_adverse_fill_proxy_usdt"),
        severe_net_pnl_usdt=_payload_decimal(record, "severe_net_pnl_usdt"),
    )
    if trade.side not in {-1, 1} or trade.observed_funding_rate == 0:
        raise EvidenceError("TRADE_DIRECTION_INVALID")
    expected_side = -1 if trade.observed_funding_rate > 0 else 1
    if trade.side != expected_side:
        raise EvidenceError("TRADE_DIRECTION_FUNDING_MISMATCH")
    if not (
        trade.signal_timestamp_ms
        < trade.entry_timestamp_ms
        < trade.next_settlement_ms
        < trade.exit_timestamp_ms
    ):
        raise EvidenceError("TRADE_CHRONOLOGY_MISMATCH")
    if (
        trade.entry_timestamp_ms - trade.signal_timestamp_ms > FIVE_MINUTES_MS
        or trade.exit_timestamp_ms - trade.next_settlement_ms > FIVE_MINUTES_MS
        or trade.next_settlement_ms - trade.signal_timestamp_ms > 24 * 3_600_000 + 1_000
    ):
        raise EvidenceError("TRADE_HOLDING_CLOCK_MISMATCH")
    if trade.capacity_proxy_usdt < 0:
        raise EvidenceError("TRADE_CAPACITY_DOMAIN_INVALID")
    expected_costs = {
        "base": _scenario_cost(Decimal("1000"), "4", "2"),
        "stress": _scenario_cost(Decimal("1000"), "8", "5"),
        "severe": _scenario_cost(Decimal("1000"), "10", "10"),
    }
    gross = trade.price_pnl_usdt + trade.funding_pnl_usdt
    for scenario, (expected_fee, expected_adverse) in expected_costs.items():
        fee = cast(Decimal, getattr(trade, f"{scenario}_fee_proxy_usdt"))
        adverse = cast(Decimal, getattr(trade, f"{scenario}_adverse_fill_proxy_usdt"))
        net = cast(Decimal, getattr(trade, f"{scenario}_net_pnl_usdt"))
        if fee != expected_fee or adverse != expected_adverse:
            raise EvidenceError(f"TRADE_COST_PROXY_MISMATCH:{scenario}")
        if net != gross - fee - adverse:
            raise EvidenceError(f"TRADE_DECOMPOSITION_MISMATCH:{scenario}")
    return trade


def _verify_trade_ledger(raw: object, expected_trial_id: str | None = None) -> tuple[Trade, ...]:
    if not isinstance(raw, list):
        raise EvidenceError("TRADE_LEDGER_REQUIRED")
    ledger: list[Trade] = []
    for item in raw:
        trade = _trade_from_payload(item)
        if expected_trial_id is not None and trade.trial_id != expected_trial_id:
            raise EvidenceError(f"TRADE_LEDGER_TRIAL_MISMATCH:{expected_trial_id}")
        ledger.append(trade)
    if any(
        left.signal_timestamp_ms >= right.signal_timestamp_ms
        for left, right in itertools.pairwise(ledger)
    ):
        raise EvidenceError("TRADE_LEDGER_ORDER_INVALID")
    return tuple(ledger)


def _verify_result_replay(result: dict[str, object]) -> ReplayState:
    base_fields = {
        "schema",
        "milestone",
        "strategy",
        "protocol_sha256",
        "freeze_sha256",
        "data_manifest_sha256",
        "account_effective_fees",
        "executable_depth",
        "historical_filters",
        "executable_capacity",
        "metrics_semantic_derivation",
        "go_structurally_reachable",
        "capital_disposition",
        "verdict",
        "reason",
        "holdout_status",
    }
    if set(result) not in (
        base_fields,
        base_fields | {"development"},
        base_fields | {"development", "holdout"},
    ):
        raise EvidenceError("RESULT_ROOT_FIELDS_MISMATCH")
    if (
        result.get("schema") != "cosmos.s1o.result.v1"
        or result.get("milestone") != "S-1O"
        or result.get("strategy") != "BTCUSDT_OWN_SYMBOL_OI_CONDITIONED_FUNDING_SIGN_PERSISTENCE"
    ):
        raise EvidenceError("RESULT_IDENTITY_MISMATCH")
    if result.get("protocol_sha256") != sha256_file(PROTOCOL_PATH):
        raise EvidenceError("RESULT_PROTOCOL_MISMATCH")
    required_truth = {
        "account_effective_fees": "UNKNOWN",
        "executable_depth": "UNKNOWN",
        "historical_filters": "UNKNOWN",
        "executable_capacity": "UNKNOWN",
        "metrics_semantic_derivation": ("UNMEASURED_OFFICIAL_ARCHIVE_DOCUMENTATION_ABSENT"),
        "go_structurally_reachable": False,
        "capital_disposition": "NO_GO",
    }
    if any(result.get(key) != value for key, value in required_truth.items()):
        raise EvidenceError("RESULT_TRUTH_BOUNDARY_MISMATCH")
    development_raw = result.get("development")
    if development_raw is None:
        reason = result.get("reason")
        if (
            result.get("verdict") != "UNMEASURED"
            or not (isinstance(reason, str) and reason.startswith("FAIL_CLOSED:"))
            or result.get("holdout_status") != "UNOPENED"
        ):
            raise EvidenceError("RESULT_DEVELOPMENT_MISSING")
        return ReplayState("FAIL_CLOSED_PRE_DEVELOPMENT", None, None, False)
    if not isinstance(development_raw, dict):
        raise EvidenceError("RESULT_DEVELOPMENT_INVALID")
    development = cast(dict[str, object], development_raw)
    if set(development) != {"trials", "cscv_pbo", "champion", "trade_ledgers"}:
        raise EvidenceError("RESULT_DEVELOPMENT_ROOT_FIELDS_MISMATCH")
    ledgers_raw = development.get("trade_ledgers")
    trials_raw = development.get("trials")
    if not isinstance(ledgers_raw, dict) or not isinstance(trials_raw, dict):
        raise EvidenceError("RESULT_DEVELOPMENT_FIELDS_REQUIRED")
    ledgers = cast(dict[str, object], ledgers_raw)
    trial_ids = {trial.trial_id for trial in frozen_trials()}
    if set(ledgers) != trial_ids or set(cast(dict[str, object], trials_raw)) != trial_ids:
        raise EvidenceError("RESULT_EIGHT_TRIAL_FAMILY_MISMATCH")
    reconstructed = {
        trial_id: _verify_trade_ledger(ledgers[trial_id], trial_id)
        for trial_id in sorted(trial_ids)
    }
    calendar = _calendar()
    expected_trials, expected_champion, expected_pbo = development_assessment(
        reconstructed, to_ms(calendar["analysis_start"])
    )
    if trials_raw != expected_trials:
        raise EvidenceError("RESULT_DEVELOPMENT_ASSESSMENT_MISMATCH")
    if development.get("cscv_pbo") != expected_pbo:
        raise EvidenceError("RESULT_CSCV_PBO_MISMATCH")
    champion = development.get("champion")
    if champion != expected_champion:
        raise EvidenceError("RESULT_CHAMPION_REPLAY_MISMATCH")
    if champion is None:
        if (
            result.get("verdict") != "NO_GO"
            or result.get("reason") != "NO_DEVELOPMENT_TRIAL_PASSED_ALL_FROZEN_GATES"
            or result.get("holdout_status") != "UNOPENED"
        ):
            raise EvidenceError("RESULT_NO_CHAMPION_VERDICT_MISMATCH")
        return ReplayState("NO_CHAMPION", None, None, False)
    if not isinstance(champion, str):
        raise EvidenceError("RESULT_CHAMPION_INVALID")
    champion_assessment = expected_trials[champion]
    holdout_raw = result.get("holdout")
    if not isinstance(holdout_raw, dict):
        reason = result.get("reason")
        if (
            result.get("verdict") == "UNMEASURED"
            and isinstance(reason, str)
            and reason.startswith("FAIL_CLOSED:")
        ):
            status = result.get("holdout_status")
            if status not in {"UNOPENED", "OPENED_FAIL_CLOSED"}:
                raise EvidenceError("RESULT_FAIL_CLOSED_HOLDOUT_STATUS_INVALID")
            return ReplayState(
                "FAIL_CLOSED_POST_CHAMPION",
                champion,
                champion_assessment,
                status == "OPENED_FAIL_CLOSED",
            )
        raise EvidenceError("RESULT_HOLDOUT_REQUIRED")
    holdout = cast(dict[str, object], holdout_raw)
    if set(holdout) != {"assessment", "trade_ledger"}:
        raise EvidenceError("RESULT_HOLDOUT_FIELDS_MISMATCH")
    ledger = _verify_trade_ledger(holdout.get("trade_ledger"), champion)
    expected_holdout = holdout_assessment(ledger)
    if holdout.get("assessment") != expected_holdout:
        raise EvidenceError("RESULT_HOLDOUT_ASSESSMENT_MISMATCH")
    passed = expected_holdout["passed"]
    expected_verdict = "UNMEASURED" if passed else "NO_GO"
    expected_reason = (
        "PUBLIC_NUMERIC_GATES_PASSED_BUT_METRICS_SEMANTICS_AND_"
        "ACCOUNT_EFFECTIVE_EXECUTION_TRUTH_ARE_UNMEASURED"
        if passed
        else "FROZEN_HOLDOUT_ECONOMIC_GATES_FAILED"
    )
    if (
        result.get("verdict") != expected_verdict
        or result.get("reason") != expected_reason
        or result.get("holdout_status") != "OPENED_AFTER_CHAMPION_SEAL"
    ):
        raise EvidenceError("RESULT_HOLDOUT_VERDICT_MISMATCH")
    return ReplayState("HOLDOUT_COMPLETE", champion, champion_assessment, True)


def _verify_run_markers(
    result: dict[str, object],
    replay: ReplayState,
    freeze_payload: dict[str, object],
    source_manifest: dict[str, object],
) -> set[str]:
    source_digest = source_manifest["manifest_sha256"]
    run_path = GENERATED_ROOT / "RUN_CONSUMED.json"
    _regular_file_identity(run_path)
    run_marker = _load_json_object(run_path)
    expected_run = {
        "schema": "cosmos.s1o.run-consumed.v1",
        "protocol_sha256": sha256_file(PROTOCOL_PATH),
        "freeze_sha256": freeze_payload["freeze_sha256"],
        "data_manifest_sha256": source_digest,
        "state": "CONSUMED_BEFORE_DEVELOPMENT_DECOMPRESSION",
    }
    if run_marker != expected_run:
        raise EvidenceError("RUN_MARKER_MISMATCH")
    if (
        result.get("freeze_sha256") != freeze_payload["freeze_sha256"]
        or result.get("data_manifest_sha256") != source_digest
    ):
        raise EvidenceError("RESULT_SEAL_BINDING_MISMATCH")
    expected_files = {
        "acquisition-plan.v1.json",
        "freeze.v1.json",
        "source-data-manifest.v1.json",
        "RUN_CONSUMED.json",
        "result.v1.json",
    }
    source_path = GENERATED_ROOT / "source-data-manifest.v1.json"
    _regular_file_identity(source_path)
    champion_path = GENERATED_ROOT / "champion.seal.v1.json"
    holdout_path = GENERATED_ROOT / "HOLDOUT_OPENED.json"
    if replay.champion is None:
        if champion_path.exists() or holdout_path.exists():
            raise EvidenceError("MARKER_PRESENT_WITHOUT_CHAMPION")
        return expected_files
    if replay.champion_assessment is None or not champion_path.exists():
        raise EvidenceError("CHAMPION_MARKER_REQUIRED")
    _regular_file_identity(champion_path)
    champion_marker = _load_json_object(champion_path)
    expected_champion = {
        "schema": "cosmos.s1o.champion-seal.v1",
        "protocol_sha256": sha256_file(PROTOCOL_PATH),
        "evaluator_sha256": freeze_payload["evaluator_sha256"],
        "trial_id": replay.champion,
        "development_assessment_sha256": sha256_bytes(
            canonical_json_bytes(replay.champion_assessment)
        ),
    }
    if champion_marker != expected_champion:
        raise EvidenceError("CHAMPION_MARKER_MISMATCH")
    expected_files.add("champion.seal.v1.json")
    if not replay.holdout_marker_required:
        if holdout_path.exists():
            raise EvidenceError("HOLDOUT_MARKER_UNEXPECTED")
        return expected_files
    if not holdout_path.exists():
        raise EvidenceError("HOLDOUT_MARKER_REQUIRED")
    _regular_file_identity(holdout_path)
    holdout_marker = _load_json_object(holdout_path)
    expected_holdout = {
        "schema": "cosmos.s1o.holdout-opened.v1",
        "champion_seal_sha256": sha256_file(champion_path),
        "state": "CREATED_BEFORE_FIRST_HOLDOUT_MEMBER_ACCESS",
    }
    if holdout_marker != expected_holdout:
        raise EvidenceError("HOLDOUT_MARKER_MISMATCH")
    expected_files.add("HOLDOUT_OPENED.json")
    return expected_files


def _verify_artifact_manifest(expected_names: set[str]) -> str:
    manifest_path = GENERATED_ROOT / "artifact-manifest.v1.json"
    artifact_paths = [GENERATED_ROOT / name for name in sorted(expected_names)]
    _require_distinct_regular_files((*artifact_paths, manifest_path))
    actual_names = {path.name for path in GENERATED_ROOT.iterdir()}
    if actual_names != expected_names | {"artifact-manifest.v1.json"}:
        raise EvidenceError("GENERATED_ARTIFACT_SET_MISMATCH")
    manifest = _load_json_object(manifest_path)
    if set(manifest) != {"schema", "files", "manifest_sha256"}:
        raise EvidenceError("ARTIFACT_MANIFEST_FIELDS_MISMATCH")
    if manifest.get("schema") != "cosmos.s1o.artifact-manifest.v1":
        raise EvidenceError("ARTIFACT_MANIFEST_SCHEMA_MISMATCH")
    without_digest = dict(manifest)
    claimed = without_digest.pop("manifest_sha256")
    if claimed != sha256_bytes(canonical_json_bytes(without_digest)):
        raise EvidenceError("ARTIFACT_MANIFEST_DIGEST_MISMATCH")
    expected_records = [
        {
            "path": name,
            "sha256": sha256_file(GENERATED_ROOT / name),
            "bytes": (GENERATED_ROOT / name).stat().st_size,
        }
        for name in (
            "acquisition-plan.v1.json",
            "freeze.v1.json",
            "source-data-manifest.v1.json",
            "RUN_CONSUMED.json",
            "champion.seal.v1.json",
            "HOLDOUT_OPENED.json",
            "result.v1.json",
        )
        if name in expected_names
    ]
    if manifest.get("files") != expected_records:
        raise EvidenceError("ARTIFACT_MANIFEST_RECORDS_MISMATCH")
    if not isinstance(claimed, str):
        raise EvidenceError("ARTIFACT_MANIFEST_DIGEST_REQUIRED")
    return claimed


def verify_outputs() -> dict[str, object]:
    freeze_payload = verify_freeze()
    verify_acquisition_plan()
    source_manifest = verify_source_data_manifest_copy()
    result_path = GENERATED_ROOT / "result.v1.json"
    _regular_file_identity(result_path)
    result = _load_json_object(result_path)
    replay = _verify_result_replay(result)
    expected_names = _verify_run_markers(result, replay, freeze_payload, source_manifest)
    claimed_manifest = _verify_artifact_manifest(expected_names)
    verdict = result.get("verdict")
    if verdict not in {"NO_GO", "UNMEASURED"}:
        raise EvidenceError("VERDICT_LAW_VIOLATION")
    if result.get("capital_disposition") != "NO_GO":
        raise EvidenceError("CAPITAL_DISPOSITION_VIOLATION")
    if result.get("account_effective_fees") != "UNKNOWN":
        raise EvidenceError("ACCOUNT_FEE_TRUTH_VIOLATION")
    return {
        "schema": "cosmos.s1o.verification.v1",
        "status": "PASS",
        "verdict": verdict,
        "artifact_manifest_sha256": claimed_manifest,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("plan")
    acquire_parser = subparsers.add_parser("acquire")
    acquire_parser.add_argument("--data-root", type=Path, required=True)
    subparsers.add_parser("freeze")
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--data-root", type=Path, required=True)
    subparsers.add_parser("verify")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        if arguments.command == "plan":
            payload = acquisition_plan_payload()
            atomic_write(GENERATED_ROOT / "acquisition-plan.v1.json", canonical_json_bytes(payload))
        elif arguments.command == "acquire":
            payload = acquire(arguments.data_root)
        elif arguments.command == "freeze":
            payload = freeze()
        elif arguments.command == "run":
            payload = run(arguments.data_root)
        elif arguments.command == "verify":
            payload = verify_outputs()
        else:
            raise EvidenceError("COMMAND_UNREACHABLE")
    except (EvidenceError, FileExistsError) as error:
        print(f"S1O_FAIL_CLOSED:{error}", file=sys.stderr)
        return 2
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
