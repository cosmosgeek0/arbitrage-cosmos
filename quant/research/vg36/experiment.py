"""One-run Binance-public V-G36 taker-buy quote-share shock experiment.

The module is import-safe and network-free. ``acquire`` and ``freeze`` hash the
already-present compressed source objects without opening ZIP members. Only
``run`` may open archive bodies, and it consumes the exclusive run marker first.
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
import random
import re
import stat
import subprocess
import sys
import zipfile
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from statistics import median
from typing import BinaryIO, cast

type JsonScalar = None | bool | int | float | str
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]
type JsonObject = dict[str, JsonValue]

PACKET_DIR = Path(__file__).resolve().parent
QUANT_DIR = PACKET_DIR.parents[1]
REPO_DIR = QUANT_DIR.parent
PROTOCOL_PATH = PACKET_DIR / "protocol.v1.json"
README_PATH = PACKET_DIR / "README.md"
SOURCE_RESEARCH_PATH = PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md"
DISTINCTNESS_PATH = PACKET_DIR / "DISTINCTNESS.md"
PRE_RUN_SPEC_PATH = PACKET_DIR / "PRE_RUN_SPEC.md"
EXPERIMENT_PATH = PACKET_DIR / "experiment.py"
VERIFY_PATH = PACKET_DIR / "verify.py"
TEST_PATH = PACKET_DIR / "test_experiment.py"
ACQUISITION_PATH = PACKET_DIR / "acquisition-manifest.v1.json"
SOURCE_MANIFEST_PATH = PACKET_DIR / "source-manifest.v1.json"
FREEZE_PATH = PACKET_DIR / "freeze.v1.json"
RUN_MARKER_PATH = PACKET_DIR / "run-marker.v1.json"
DEVELOPMENT_PATH = PACKET_DIR / "development.v1.json"
CANDIDATE_SEAL_PATH = PACKET_DIR / "candidate-seal.v1.json"
HOLDOUT_MARKER_PATH = PACKET_DIR / "holdout-open-marker.v1.json"
HOLDOUT_BODY_OPEN_PATH = PACKET_DIR / "holdout-body-open.v1.json"
HOLDOUT_PATH = PACKET_DIR / "holdout.v1.json"
RESULT_PATH = PACKET_DIR / "result.v1.json"
SHA256SUMS_PATH = PACKET_DIR / "SHA256SUMS"

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
PUBLIC_DATA_COMMIT = "5c7f3197591c0d54d85dc43066226bc4c671d47a"
SPOT_DOCS_COMMIT = "6b8372cad7cecbdf5dd88a3372eafff51988c5cf"
PROTOCOL_SEMANTIC_SHA256 = "2ba318f3f461469d618f90d71af0ba8f8dcd0754d4faee670b3ff4ff1e171bd8"
ARCHIVE_ROOT = Path(
    "/Users/cosmosgeek/.codex/evidence/"
    "cosmos-vg3-public-volume-v1-4ddd-r5/archives/data/spot/monthly/klines"
)

COHORT = (
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "SOLUSDT",
    "TRXUSDT",
    "LTCUSDT",
    "LINKUSDT",
    "AVAXUSDT",
    "DOTUSDT",
)
SOURCE_MONTHS = (
    "2025-03",
    "2025-04",
    "2025-05",
    "2025-06",
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
)
DEVELOPMENT_SOURCE_MONTHS = frozenset(SOURCE_MONTHS[:12])
HOLDOUT_SOURCE_MONTHS = frozenset(SOURCE_MONTHS[12:])
DEVELOPMENT_FIRST_OPEN = date(2025, 7, 1)
DEVELOPMENT_FINAL_OPEN = date(2026, 2, 28)
HOLDOUT_FIRST_OPEN = date(2026, 3, 1)
HOLDOUT_FINAL_OPEN = date(2026, 6, 30)

STARTING_CASH = Decimal("1000")
CAPACITY_FRACTION = Decimal("0.0001")
MAD_NORMALIZER = 1.4826
BOOTSTRAP_REPLICATES = 4_096
BOOTSTRAP_SEED = 202_607_300_036
PRIMARY_BLOCK_DAYS = 7
SENSITIVITY_BLOCK_DAYS = 14
MAX_STRESS_DRAWDOWN = 0.20
CHECKSUM_RE = re.compile(r"^([0-9a-f]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
KLINE_HEADER = (
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_volume",
    "trades",
    "taker_buy_base_volume",
    "taker_buy_quote_volume",
    "ignore",
)
COST_SCENARIOS = (
    ("gross", 0),
    ("fee_only", 10),
    ("base", 20),
    ("stress", 35),
    ("severe", 60),
)
SOURCE_FILES = (
    README_PATH,
    SOURCE_RESEARCH_PATH,
    DISTINCTNESS_PATH,
    PRE_RUN_SPEC_PATH,
    PROTOCOL_PATH,
    EXPERIMENT_PATH,
    VERIFY_PATH,
    TEST_PATH,
    PACKET_DIR / "__init__.py",
)


class VG36Error(RuntimeError):
    """Base packet failure."""


class MeasurementError(VG36Error):
    """Terminal source, schema, causal, or lifecycle defect."""


@dataclass(frozen=True, slots=True)
class TrialSpec:
    lookback: int
    threshold: float
    hold_days: int
    trial_id: str


@dataclass(frozen=True, slots=True)
class Bar:
    day: date
    open_price: Decimal
    quote_volume: Decimal
    taker_buy_quote_volume: Decimal

    @property
    def taker_buy_share(self) -> Decimal:
        return self.taker_buy_quote_volume / self.quote_volume


@dataclass(frozen=True, slots=True)
class CohortPoint:
    day: date
    open_prices: tuple[Decimal, ...]
    quote_volumes: tuple[Decimal, ...]
    share: float
    logit_share: float
    innovation: float | None


@dataclass(frozen=True, slots=True)
class ShockSignal:
    day: date
    z_score: float
    previous_z_score: float


@dataclass(frozen=True, slots=True)
class Trade:
    signal_day: date
    entry_day: date
    exit_day: date


@dataclass(frozen=True, slots=True)
class ScenarioPath:
    scenario_id: str
    per_side_bps: int
    days: tuple[date, ...]
    strategy_equity: tuple[float, ...]
    comparator_equity: tuple[float, ...]
    absolute_daily_returns: tuple[float, ...]
    comparator_daily_returns: tuple[float, ...]
    excess_daily_returns: tuple[float, ...]
    trades: tuple[Trade, ...]
    transition_count: int
    capacity_proxy_usdt: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class BootstrapSummary:
    observed_mean_usdt_per_day_per_1000: float
    lower_90: float
    upper_90: float
    one_sided_95_lcb: float
    one_sided_p_value: float
    block_days: int
    replicates: int


@dataclass(frozen=True, slots=True)
class ScenarioInference:
    scenario_id: str
    primary_absolute: BootstrapSummary
    primary_excess: BootstrapSummary
    sensitivity_absolute: BootstrapSummary
    sensitivity_excess: BootstrapSummary


@dataclass(frozen=True, slots=True)
class TrialEvaluation:
    trial: TrialSpec
    paths: tuple[ScenarioPath, ...]
    primary_absolute: BootstrapSummary
    primary_excess: BootstrapSummary
    sensitivity_absolute: BootstrapSummary
    sensitivity_excess: BootstrapSummary
    monthly_absolute: tuple[float, ...]
    monthly_excess: tuple[float, ...]
    scenario_inference: tuple[ScenarioInference, ...] = ()


def _canonical_json(value: JsonObject) -> bytes:
    try:
        text = json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as exc:
        raise MeasurementError("JSON value is not canonicalizable") from exc
    return f"{text}\n".encode()


def _json_object_without_duplicates(pairs: list[tuple[str, JsonValue]]) -> JsonObject:
    output: JsonObject = {}
    for key, value in pairs:
        if key in output:
            raise MeasurementError(f"duplicate JSON key: {key}")
        output[key] = value
    return output


def _reject_json_constant(raw: str) -> JsonValue:
    raise MeasurementError(f"nonfinite JSON constant: {raw}")


def _read_json(path: Path) -> JsonObject:
    try:
        raw = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_json_object_without_duplicates,
            parse_constant=_reject_json_constant,
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MeasurementError(f"invalid JSON: {path}") from exc
    if not isinstance(raw, dict) or not all(isinstance(key, str) for key in raw):
        raise MeasurementError(f"JSON root must be an object: {path}")
    return cast(JsonObject, raw)


def _read_canonical_json(path: Path) -> JsonObject:
    value = _read_json(path)
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise MeasurementError(f"cannot read canonical JSON: {path}") from exc
    if payload != _canonical_json(value):
        raise MeasurementError(f"JSON is not canonical: {path}")
    return value


def _write_json_exclusive(path: Path, value: JsonObject) -> None:
    payload = _canonical_json(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(descriptor)
    _fsync_directory(path.parent)


def _write_bytes_replace(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(descriptor)
    os.replace(temporary, path)
    _fsync_directory(path.parent)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _sha256_stream(handle: BinaryIO) -> str:
    digest = hashlib.sha256()
    while True:
        chunk = handle.read(1 << 20)
        if not chunk:
            return digest.hexdigest()
        digest.update(chunk)


def sha256_path(path: Path) -> str:
    with path.open("rb") as handle:
        return _sha256_stream(handle)


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _git_output(*arguments: str) -> str:
    completed = subprocess.run(
        ("git", *arguments),
        cwd=REPO_DIR,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise MeasurementError(f"git {' '.join(arguments)} failed: {detail}")
    return completed.stdout.strip()


def _git_is_ancestor(ancestor: str, descendant: str) -> bool:
    completed = subprocess.run(
        ("git", "merge-base", "--is-ancestor", ancestor, descendant),
        cwd=REPO_DIR,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode not in (0, 1):
        raise MeasurementError("git ancestry check failed")
    return completed.returncode == 0


def _require_direct_child(child: str, parent: str, label: str) -> None:
    if child == parent:
        raise MeasurementError(f"{label} must be a direct child, not the parent")
    resolved_child = _git_output("rev-parse", child)
    resolved_parent = _git_output("rev-parse", parent)
    lineage = _git_output("rev-list", "--parents", "-n", "1", resolved_child).split()
    if lineage != [resolved_child, resolved_parent]:
        raise MeasurementError(f"{label} is not the required direct child")


def _require_exclusive_scope(ancestor: str, descendant: str) -> None:
    changed = tuple(
        line
        for line in _git_output("diff", "--name-only", f"{ancestor}..{descendant}").splitlines()
        if line
    )
    prefix = f"{PACKET_DIR.relative_to(REPO_DIR)}/"
    if not changed or any(not path.startswith(prefix) for path in changed):
        raise MeasurementError("Git lineage escapes the exclusive V-G36 subtree")


def _require_source_clean() -> str:
    head = _git_output("rev-parse", "HEAD")
    _require_direct_child(head, BASE_COMMIT, "pre-output source commit")
    _require_exclusive_scope(BASE_COMMIT, head)
    relative_paths = tuple(str(path.relative_to(REPO_DIR)) for path in SOURCE_FILES)
    status = _git_output("status", "--porcelain", "--untracked-files=no", "--", *relative_paths)
    if status:
        raise MeasurementError("tracked V-G36 source is dirty")
    for relative in relative_paths:
        if _git_output("ls-files", "--error-unmatch", relative) != relative:
            raise MeasurementError(f"source is not tracked at HEAD: {relative}")
        disk_hash = sha256_path(REPO_DIR / relative)
        blob = subprocess.run(
            ("git", "show", f"HEAD:{relative}"),
            cwd=REPO_DIR,
            check=False,
            capture_output=True,
        )
        if blob.returncode != 0 or _sha256_bytes(blob.stdout) != disk_hash:
            raise MeasurementError(f"source differs from HEAD: {relative}")
    return head


def _object(value: JsonValue | None, field: str) -> JsonObject:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise MeasurementError(f"{field} must be an object")
    return value


def _array(value: JsonValue | None, field: str) -> list[JsonValue]:
    if not isinstance(value, list):
        raise MeasurementError(f"{field} must be an array")
    return value


def _string(value: JsonValue | None, field: str) -> str:
    if not isinstance(value, str):
        raise MeasurementError(f"{field} must be a string")
    return value


def _integer(value: JsonValue | None, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise MeasurementError(f"{field} must be an integer")
    return value


def load_protocol() -> JsonObject:
    protocol = _read_json(PROTOCOL_PATH)
    validate_protocol(protocol)
    return protocol


def validate_protocol(protocol: Mapping[str, JsonValue]) -> None:
    semantic_payload = _canonical_json(cast(JsonObject, dict(protocol)))
    if _sha256_bytes(semantic_payload) != PROTOCOL_SEMANTIC_SHA256:
        raise MeasurementError("protocol semantic digest drift")
    if protocol.get("schema") != "VG36TakerBuyQuoteShareShockProtocolV1":
        raise MeasurementError("protocol schema drift")
    if protocol.get("baseCommit") != BASE_COMMIT:
        raise MeasurementError("protocol base commit drift")
    provenance = _object(protocol.get("provenance"), "provenance")
    if provenance.get("binancePublicDataCommit") != PUBLIC_DATA_COMMIT:
        raise MeasurementError("public-data pin drift")
    if provenance.get("binanceSpotApiDocsCommit") != SPOT_DOCS_COMMIT:
        raise MeasurementError("Spot-docs pin drift")
    data = _object(protocol.get("data"), "data")
    if data.get("archiveRoot") != str(ARCHIVE_ROOT):
        raise MeasurementError("archive root drift")
    if data.get("sourcePairCount") != len(COHORT) * len(SOURCE_MONTHS):
        raise MeasurementError("source pair count drift")
    if data.get("sourceMonths") != list(SOURCE_MONTHS):
        raise MeasurementError("source month drift")
    universe = _object(protocol.get("universe"), "universe")
    if universe.get("cohort") != list(COHORT):
        raise MeasurementError("cohort drift")
    signal = _object(protocol.get("signal"), "signal")
    grid = _object(signal.get("candidateGrid"), "signal.candidateGrid")
    if grid != {
        "holdDays": [1, 3, 5],
        "lookbackPriorInnovations": [20, 60],
        "negativeShockThreshold": ["1.5", "2.5"],
        "trialCount": 12,
    }:
        raise MeasurementError("trial grid drift")
    if trial_grid() != tuple(
        TrialSpec(lookback, threshold, hold, f"vg36-l{lookback}-k{int(threshold * 10)}-h{hold}")
        for lookback in (20, 60)
        for threshold in (1.5, 2.5)
        for hold in (1, 3, 5)
    ):
        raise MeasurementError("executable trial grid drift")


def trial_grid() -> tuple[TrialSpec, ...]:
    return tuple(
        TrialSpec(lookback, threshold, hold, f"vg36-l{lookback}-k{int(threshold * 10)}-h{hold}")
        for lookback in (20, 60)
        for threshold in (1.5, 2.5)
        for hold in (1, 3, 5)
    )


def _month_bounds(month: str) -> tuple[date, date]:
    try:
        start = date.fromisoformat(f"{month}-01")
    except ValueError as exc:
        raise MeasurementError(f"invalid month: {month}") from exc
    if start.month == 12:
        return start, date(start.year + 1, 1, 1)
    return start, date(start.year, start.month + 1, 1)


def _expected_archive_paths(symbol: str, month: str) -> tuple[Path, Path]:
    basename = f"{symbol}-1d-{month}.zip"
    archive = ARCHIVE_ROOT / symbol / "1d" / basename
    return archive, archive.with_name(f"{basename}.CHECKSUM")


def _regular_identity(path: Path, root: Path) -> tuple[int, int]:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise MeasurementError(f"missing source: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise MeasurementError(f"source is not a regular nonsymlink file: {path}")
    try:
        path.resolve(strict=True).relative_to(root.resolve(strict=True))
    except (OSError, ValueError) as exc:
        raise MeasurementError(f"source escapes archive root: {path}") from exc
    return metadata.st_dev, metadata.st_ino


def _publisher_checksum(sidecar: Path, expected_basename: str) -> tuple[str, str, int]:
    try:
        payload = sidecar.read_bytes()
        text = payload.decode("ascii")
    except (OSError, UnicodeDecodeError) as exc:
        raise MeasurementError(f"invalid checksum sidecar: {sidecar}") from exc
    matched = CHECKSUM_RE.fullmatch(text)
    if matched is None or matched.group(2) != expected_basename:
        raise MeasurementError(f"publisher checksum shape mismatch: {sidecar}")
    return matched.group(1), _sha256_bytes(payload), len(payload)


def _source_rows() -> list[JsonValue]:
    rows: list[JsonValue] = []
    seen_identities: set[tuple[int, int]] = set()
    for symbol in COHORT:
        for month in SOURCE_MONTHS:
            archive, sidecar = _expected_archive_paths(symbol, month)
            archive_identity = _regular_identity(archive, ARCHIVE_ROOT)
            sidecar_identity = _regular_identity(sidecar, ARCHIVE_ROOT)
            if archive_identity in seen_identities or sidecar_identity in seen_identities:
                raise MeasurementError("source inode collision")
            if archive_identity == sidecar_identity:
                raise MeasurementError("archive/sidecar inode collision")
            seen_identities.update((archive_identity, sidecar_identity))
            archive_sha = sha256_path(archive)
            official_sha, sidecar_sha, sidecar_bytes = _publisher_checksum(sidecar, archive.name)
            if official_sha != archive_sha:
                raise MeasurementError(f"publisher checksum mismatch: {archive}")
            rows.append(
                {
                    "archiveBytes": archive.stat().st_size,
                    "archivePath": str(archive),
                    "archiveSha256": archive_sha,
                    "checksumBytes": sidecar_bytes,
                    "checksumPath": str(sidecar),
                    "checksumSha256": sidecar_sha,
                    "month": month,
                    "publisherArchiveSha256": official_sha,
                    "symbol": symbol,
                }
            )
    return rows


def acquire_sources() -> JsonObject:
    protocol = load_protocol()
    head = _require_source_clean()
    rows = _source_rows()
    manifest: JsonObject = {
        "archiveBodiesOpened": False,
        "archiveRoot": str(ARCHIVE_ROOT),
        "archiveRootMutation": "FORBIDDEN",
        "artifactCount": len(rows),
        "artifacts": rows,
        "baseCommit": BASE_COMMIT,
        "createdAtUtc": _utc_now(),
        "gitHead": head,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG36CompressedSourceAcquisitionV1",
        "sourceState": "PUBLISHER_CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED",
    }
    if protocol.get("schema") != "VG36TakerBuyQuoteShareShockProtocolV1":
        raise MeasurementError("protocol changed during acquisition")
    _write_json_exclusive(ACQUISITION_PATH, manifest)
    return manifest


def _artifact_rows(manifest: Mapping[str, JsonValue]) -> list[JsonObject]:
    values = _array(manifest.get("artifacts"), "artifacts")
    rows: list[JsonObject] = []
    for index, value in enumerate(values):
        rows.append(_object(value, f"artifacts[{index}]"))
    return rows


def _verify_source_rows(manifest: Mapping[str, JsonValue]) -> None:
    rows = _artifact_rows(manifest)
    expected = tuple((symbol, month) for symbol in COHORT for month in SOURCE_MONTHS)
    found: list[tuple[str, str]] = []
    identities: set[tuple[int, int]] = set()
    for index, row in enumerate(rows):
        symbol = _string(row.get("symbol"), f"artifacts[{index}].symbol")
        month = _string(row.get("month"), f"artifacts[{index}].month")
        archive, sidecar = _expected_archive_paths(symbol, month)
        if row.get("archivePath") != str(archive) or row.get("checksumPath") != str(sidecar):
            raise MeasurementError("source path drift")
        archive_identity = _regular_identity(archive, ARCHIVE_ROOT)
        sidecar_identity = _regular_identity(sidecar, ARCHIVE_ROOT)
        if (
            archive_identity in identities
            or sidecar_identity in identities
            or archive_identity == sidecar_identity
        ):
            raise MeasurementError("source identity collision")
        identities.update((archive_identity, sidecar_identity))
        archive_sha = sha256_path(archive)
        official_sha, sidecar_sha, sidecar_bytes = _publisher_checksum(sidecar, archive.name)
        if (
            row.get("archiveSha256") != archive_sha
            or row.get("publisherArchiveSha256") != official_sha
            or row.get("checksumSha256") != sidecar_sha
            or row.get("archiveBytes") != archive.stat().st_size
            or row.get("checksumBytes") != sidecar_bytes
            or archive_sha != official_sha
        ):
            raise MeasurementError("compressed source identity drift")
        found.append((symbol, month))
    if tuple(found) != expected or len(rows) != len(expected):
        raise MeasurementError("source matrix drift")


def _validate_acquisition(
    acquisition: Mapping[str, JsonValue],
    *,
    expected_head: str | None = None,
) -> str:
    if acquisition.get("schema") != "VG36CompressedSourceAcquisitionV1":
        raise MeasurementError("acquisition schema drift")
    if acquisition.get("archiveBodiesOpened") is not False:
        raise MeasurementError("acquisition archive-open truth invalid")
    if acquisition.get("archiveRoot") != str(ARCHIVE_ROOT):
        raise MeasurementError("acquisition archive root drift")
    if acquisition.get("archiveRootMutation") != "FORBIDDEN":
        raise MeasurementError("acquisition mutation law drift")
    if acquisition.get("artifactCount") != len(COHORT) * len(SOURCE_MONTHS):
        raise MeasurementError("acquisition artifact count drift")
    if acquisition.get("baseCommit") != BASE_COMMIT:
        raise MeasurementError("acquisition base commit drift")
    if acquisition.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise MeasurementError("acquisition protocol binding drift")
    if acquisition.get("sourceState") != "PUBLISHER_CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED":
        raise MeasurementError("acquisition source state drift")
    head = _string(acquisition.get("gitHead"), "acquisition.gitHead")
    if expected_head is not None and head != expected_head:
        raise MeasurementError("acquisition Git head drift")
    _require_direct_child(head, BASE_COMMIT, "acquisition source commit")
    _require_exclusive_scope(BASE_COMMIT, head)
    _verify_source_rows(acquisition)
    return head


def _validate_source_manifest(
    manifest: Mapping[str, JsonValue],
    acquisition: Mapping[str, JsonValue],
) -> None:
    if manifest.get("schema") != "VG36FrozenCompressedSourceManifestV1":
        raise MeasurementError("source manifest schema drift")
    if manifest.get("archiveBodiesOpened") is not False:
        raise MeasurementError("manifest archive-open truth invalid")
    if manifest.get("archiveRoot") != str(ARCHIVE_ROOT):
        raise MeasurementError("manifest archive root drift")
    if manifest.get("artifactCount") != len(COHORT) * len(SOURCE_MONTHS):
        raise MeasurementError("manifest artifact count drift")
    if manifest.get("cohort") != list(COHORT):
        raise MeasurementError("manifest cohort drift")
    if manifest.get("months") != list(SOURCE_MONTHS):
        raise MeasurementError("manifest month drift")
    if manifest.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise MeasurementError("manifest protocol binding drift")
    if manifest.get("sourceState") != "PUBLISHER_CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED":
        raise MeasurementError("manifest source state drift")
    if manifest.get("artifacts") != acquisition.get("artifacts"):
        raise MeasurementError("acquisition/source-manifest artifact drift")
    _verify_source_rows(manifest)


def freeze_sources() -> JsonObject:
    load_protocol()
    head = _require_source_clean()
    acquisition = _read_canonical_json(ACQUISITION_PATH)
    _validate_acquisition(acquisition, expected_head=head)
    source_manifest: JsonObject = {
        "archiveBodiesOpened": False,
        "archiveRoot": str(ARCHIVE_ROOT),
        "artifactCount": len(COHORT) * len(SOURCE_MONTHS),
        "artifacts": cast(list[JsonValue], acquisition["artifacts"]),
        "cohort": list(COHORT),
        "months": list(SOURCE_MONTHS),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG36FrozenCompressedSourceManifestV1",
        "sourceState": "PUBLISHER_CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED",
    }
    _write_json_exclusive(SOURCE_MANIFEST_PATH, source_manifest)
    _validate_source_manifest(source_manifest, acquisition)
    freeze: JsonObject = {
        "acquisitionSha256": sha256_path(ACQUISITION_PATH),
        "archiveBodiesOpened": False,
        "baseCommit": BASE_COMMIT,
        "createdAtUtc": _utc_now(),
        "gitHeadBeforeFreezeOutputs": head,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG36PreOutcomeFreezeV1",
        "sourceFileSha256": {
            str(path.relative_to(PACKET_DIR)): sha256_path(path) for path in SOURCE_FILES
        },
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
    }
    _write_json_exclusive(FREEZE_PATH, freeze)
    return freeze


def _decimal(raw: str, field: str, *, positive: bool = False) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise MeasurementError(f"{field} is not decimal") from exc
    if not value.is_finite() or (positive and value <= 0):
        raise MeasurementError(f"{field} is outside its domain")
    return value


def _nonnegative_decimal(raw: str, field: str) -> Decimal:
    value = _decimal(raw, field)
    if value < 0:
        raise MeasurementError(f"{field} is negative")
    return value


def _timestamp_day(raw: str, field: str, *, close: bool = False) -> date:
    if not raw.isascii() or not raw.isdigit():
        raise MeasurementError(f"{field} is not an unsigned microsecond timestamp")
    value = int(raw)
    if value < 1_000_000_000_000_000 or value > 9_999_999_999_999_999:
        raise MeasurementError(f"{field} is not a 2025+ microsecond timestamp")
    seconds, micros = divmod(value, 1_000_000)
    try:
        moment = datetime.fromtimestamp(seconds, UTC).replace(microsecond=micros)
    except (OverflowError, OSError, ValueError) as exc:
        raise MeasurementError(f"{field} is outside UTC") from exc
    if close:
        if moment.time() != datetime.max.time().replace(microsecond=999999):
            raise MeasurementError(f"{field} is not the UTC daily close")
    elif moment.time() != datetime.min.time():
        raise MeasurementError(f"{field} is not the UTC daily open")
    return moment.date()


def _parse_kline_row(row: Sequence[str], symbol: str, row_number: int) -> Bar:
    if len(row) != 12:
        raise MeasurementError(f"{symbol} row {row_number}: expected 12 fields")
    day = _timestamp_day(row[0], f"{symbol}[{row_number}].open_time")
    close_day = _timestamp_day(row[6], f"{symbol}[{row_number}].close_time", close=True)
    if close_day != day:
        raise MeasurementError(f"{symbol} row {row_number}: close day mismatch")
    open_price = _decimal(row[1], "open", positive=True)
    high = _decimal(row[2], "high", positive=True)
    low = _decimal(row[3], "low", positive=True)
    close_price = _decimal(row[4], "close", positive=True)
    if high < max(open_price, close_price) or low > min(open_price, close_price) or high < low:
        raise MeasurementError(f"{symbol} row {row_number}: impossible OHLC")
    _nonnegative_decimal(row[5], "base_volume")
    quote_volume = _decimal(row[7], "quote_volume", positive=True)
    if not row[8].isascii() or not row[8].isdigit():
        raise MeasurementError(f"{symbol} row {row_number}: invalid trade count")
    _nonnegative_decimal(row[9], "taker_buy_base_volume")
    taker_buy_quote = _nonnegative_decimal(row[10], "taker_buy_quote_volume")
    if taker_buy_quote > quote_volume:
        raise MeasurementError(f"{symbol} row {row_number}: taker share exceeds one")
    _nonnegative_decimal(row[11], "ignore")
    return Bar(day, open_price, quote_volume, taker_buy_quote)


def parse_archive(
    artifact: Mapping[str, JsonValue],
    *,
    on_member_open: Callable[[Mapping[str, JsonValue]], None] | None = None,
) -> tuple[Bar, ...]:
    symbol = _string(artifact.get("symbol"), "artifact.symbol")
    month = _string(artifact.get("month"), "artifact.month")
    archive, _ = _expected_archive_paths(symbol, month)
    if artifact.get("archivePath") != str(archive):
        raise MeasurementError("archive path mismatch")
    if artifact.get("archiveSha256") != sha256_path(archive):
        raise MeasurementError("archive changed before open")
    expected_member = archive.name.removesuffix(".zip") + ".csv"
    try:
        with zipfile.ZipFile(archive, "r") as container:
            members = container.infolist()
            if len(members) != 1:
                raise MeasurementError(f"{archive}: expected exactly one ZIP member")
            member = members[0]
            member_mode = member.external_attr >> 16
            member_type = stat.S_IFMT(member_mode)
            if (
                member.filename != expected_member
                or member.is_dir()
                or "/" in member.filename
                or "\\" in member.filename
                or member.flag_bits & 0x1
                or member_type not in (0, stat.S_IFREG)
            ):
                raise MeasurementError(f"{archive}: invalid ZIP member")
            with container.open(member, "r") as raw:
                if on_member_open is not None:
                    on_member_open(artifact)
                text = io.TextIOWrapper(
                    cast(BinaryIO, raw), encoding="utf-8", errors="strict", newline=""
                )
                try:
                    reader = csv.reader(text)
                    rows = list(reader)
                finally:
                    text.detach()
    except (OSError, UnicodeDecodeError, csv.Error, zipfile.BadZipFile) as exc:
        raise MeasurementError(f"invalid archive: {archive}") from exc
    if rows and tuple(rows[0]) == KLINE_HEADER:
        rows = rows[1:]
    bars = tuple(
        _parse_kline_row(row, symbol, row_number) for row_number, row in enumerate(rows, start=1)
    )
    start, end = _month_bounds(month)
    expected_days = tuple(_date_range(start, end))
    if tuple(bar.day for bar in bars) != expected_days:
        raise MeasurementError(f"{archive}: daily continuity mismatch")
    return bars


def _date_range(start: date, end_exclusive: date) -> Iterable[date]:
    current = start
    while current < end_exclusive:
        yield current
        current += timedelta(days=1)


def _load_bars(
    manifest: Mapping[str, JsonValue],
    allowed_months: frozenset[str],
    *,
    on_first_member_open: Callable[[Mapping[str, JsonValue]], None] | None = None,
) -> dict[str, tuple[Bar, ...]]:
    output: dict[str, list[Bar]] = {symbol: [] for symbol in COHORT}
    selected = 0
    receipt_pending = on_first_member_open
    for artifact in _artifact_rows(manifest):
        month = _string(artifact.get("month"), "artifact.month")
        if month not in allowed_months:
            continue
        symbol = _string(artifact.get("symbol"), "artifact.symbol")
        if symbol not in output:
            raise MeasurementError("unexpected symbol in source manifest")
        callback = receipt_pending
        output[symbol].extend(parse_archive(artifact, on_member_open=callback))
        if callback is not None:
            receipt_pending = None
        selected += 1
    if selected != len(COHORT) * len(allowed_months):
        raise MeasurementError("partition source matrix incomplete")
    frozen: dict[str, tuple[Bar, ...]] = {}
    for symbol in COHORT:
        bars = tuple(output[symbol])
        if len({bar.day for bar in bars}) != len(bars):
            raise MeasurementError(f"{symbol}: duplicate day")
        if any(
            right.day != left.day + timedelta(days=1) for left, right in itertools.pairwise(bars)
        ):
            raise MeasurementError(f"{symbol}: cross-month daily gap")
        frozen[symbol] = bars
    return frozen


def merge_bars(
    first: Mapping[str, Sequence[Bar]],
    second: Mapping[str, Sequence[Bar]],
) -> dict[str, tuple[Bar, ...]]:
    merged: dict[str, tuple[Bar, ...]] = {}
    if tuple(first) != COHORT or tuple(second) != COHORT:
        raise MeasurementError("bar map cohort order drift")
    for symbol in COHORT:
        values = tuple(first[symbol]) + tuple(second[symbol])
        if len({bar.day for bar in values}) != len(values):
            raise MeasurementError(f"{symbol}: duplicate day while merging")
        if any(
            right.day != left.day + timedelta(days=1) for left, right in itertools.pairwise(values)
        ):
            raise MeasurementError(f"{symbol}: merge continuity defect")
        merged[symbol] = values
    return merged


def build_cohort_points(
    bars_by_symbol: Mapping[str, Sequence[Bar]],
) -> tuple[CohortPoint, ...]:
    if tuple(bars_by_symbol) != COHORT:
        raise MeasurementError("bar map must preserve the exact cohort order")
    reference_days = tuple(bar.day for bar in bars_by_symbol[COHORT[0]])
    if len(reference_days) < 2:
        raise MeasurementError("cohort history is too short")
    symbol_rows: list[Sequence[Bar]] = []
    for symbol in COHORT:
        rows = bars_by_symbol[symbol]
        if tuple(bar.day for bar in rows) != reference_days:
            raise MeasurementError("cross-symbol day alignment defect")
        symbol_rows.append(rows)
    points: list[CohortPoint] = []
    previous_logit: float | None = None
    for index, day in enumerate(reference_days):
        bars = tuple(rows[index] for rows in symbol_rows)
        scalar_decimal = sum((bar.taker_buy_share for bar in bars), Decimal(0)) / Decimal(
            len(COHORT)
        )
        if not (Decimal(0) < scalar_decimal < Decimal(1)):
            raise MeasurementError(f"{day}: cohort share outside open unit interval")
        scalar = float(scalar_decimal)
        logit_share = math.log(scalar / (1.0 - scalar))
        innovation = None if previous_logit is None else logit_share - previous_logit
        points.append(
            CohortPoint(
                day,
                tuple(bar.open_price for bar in bars),
                tuple(bar.quote_volume for bar in bars),
                scalar,
                logit_share,
                innovation,
            )
        )
        previous_logit = logit_share
    return tuple(points)


def standardized_innovations(
    points: Sequence[CohortPoint],
    lookback: int,
) -> dict[date, float]:
    if lookback <= 1:
        raise MeasurementError("lookback must exceed one")
    innovations = tuple(point.innovation for point in points)
    output: dict[date, float] = {}
    for index in range(lookback + 1, len(points)):
        current = innovations[index]
        prior = innovations[index - lookback : index]
        if current is None or any(value is None for value in prior):
            raise MeasurementError("innovation warmup defect")
        prior_values = tuple(cast(float, value) for value in prior)
        center = median(prior_values)
        mad = median(tuple(abs(value - center) for value in prior_values))
        if not math.isfinite(mad) or mad <= 0.0:
            raise MeasurementError(f"{points[index].day}: zero or invalid prior MAD")
        z_score = (current - center) / (MAD_NORMALIZER * mad)
        if not math.isfinite(z_score):
            raise MeasurementError("nonfinite standardized innovation")
        output[points[index].day] = z_score
    return output


def detect_signals(
    points: Sequence[CohortPoint],
    trial: TrialSpec,
) -> tuple[ShockSignal, ...]:
    z_scores = standardized_innovations(points, trial.lookback)
    signals: list[ShockSignal] = []
    for left, right in itertools.pairwise(points):
        previous_z = z_scores.get(left.day)
        current_z = z_scores.get(right.day)
        if (
            previous_z is not None
            and current_z is not None
            and current_z <= -trial.threshold
            and previous_z > -1.0
        ):
            signals.append(ShockSignal(right.day, current_z, previous_z))
    return tuple(signals)


def schedule_trades(
    signals: Sequence[ShockSignal],
    calendar: Sequence[date],
    trial: TrialSpec,
    first_open: date,
    final_open: date,
) -> tuple[Trade, ...]:
    if not calendar or tuple(calendar) != tuple(sorted(set(calendar))):
        raise MeasurementError("calendar must be unique and ordered")
    if any(right != left + timedelta(days=1) for left, right in itertools.pairwise(calendar)):
        raise MeasurementError("calendar must be contiguous")
    positions = {day: index for index, day in enumerate(calendar)}
    if first_open not in positions or final_open not in positions:
        raise MeasurementError("partition boundary missing")
    first_index = positions[first_open]
    final_index = positions[final_open]
    next_eligible_signal_index = 0
    trades: list[Trade] = []
    for signal in signals:
        signal_index = positions.get(signal.day)
        if signal_index is None:
            continue
        entry_index = signal_index + 2
        exit_index = entry_index + trial.hold_days
        if entry_index < first_index or entry_index > final_index or exit_index > final_index:
            continue
        if signal_index < next_eligible_signal_index:
            continue
        trades.append(Trade(signal.day, calendar[entry_index], calendar[exit_index]))
        next_eligible_signal_index = exit_index
    return tuple(trades)


def lagged_capacity_proxy(
    point_by_day: Mapping[date, CohortPoint],
    calendar: Sequence[date],
    entry_day: date,
) -> float:
    position = {day: index for index, day in enumerate(calendar)}
    entry_index = position.get(entry_day)
    if entry_index is None or entry_index < 30:
        raise MeasurementError("capacity proxy lacks 30 lagged complete days")
    prior_days = calendar[entry_index - 30 : entry_index]
    constituent_medians = tuple(
        median(tuple(point_by_day[day].quote_volumes[index] for day in prior_days))
        for index in range(len(COHORT))
    )
    proxy = Decimal(len(COHORT)) * min(constituent_medians) * CAPACITY_FRACTION
    return float(proxy)


def _portfolio_value(units: Sequence[Decimal], prices: Sequence[Decimal]) -> Decimal:
    if len(units) != len(COHORT) or len(prices) != len(COHORT):
        raise MeasurementError("portfolio dimension mismatch")
    return sum((unit * price for unit, price in zip(units, prices, strict=True)), Decimal(0))


def _simulate_equity(
    points: Sequence[CohortPoint],
    trades: Sequence[Trade],
    per_side_bps: int,
    *,
    always_on: bool,
) -> tuple[tuple[float, ...], int]:
    if per_side_bps < 0 or per_side_bps >= 10_000:
        raise MeasurementError("per-side cost outside domain")
    cost_factor = Decimal(1) - Decimal(per_side_bps) / Decimal(10_000)
    entries = {trade.entry_day for trade in trades}
    exits = {trade.exit_day for trade in trades}
    if len(entries) != len(trades) or len(exits) != len(trades):
        raise MeasurementError("trade boundary collision")
    cash = STARTING_CASH
    units: tuple[Decimal, ...] | None = None
    equity: list[float] = []
    transitions = 0
    for index, point in enumerate(points):
        should_exit = (always_on and index == len(points) - 1) or point.day in exits
        should_enter = (always_on and index == 0) or point.day in entries
        if should_exit:
            if units is None:
                raise MeasurementError("exit without open position")
            cash = _portfolio_value(units, point.open_prices) * cost_factor
            units = None
            transitions += 1
        if should_enter:
            if units is not None:
                raise MeasurementError("entry while already holding")
            investable = cash * cost_factor
            allocation = investable / Decimal(len(COHORT))
            units = tuple(allocation / price for price in point.open_prices)
            cash = Decimal(0)
            transitions += 1
        marked = cash if units is None else _portfolio_value(units, point.open_prices)
        if not marked.is_finite() or marked < 0:
            raise MeasurementError("invalid marked equity")
        equity.append(float(marked))
    if units is not None:
        raise MeasurementError("position lacks authenticated boundary exit")
    return tuple(equity), transitions


def _daily_returns(equity: Sequence[float]) -> tuple[float, ...]:
    prior = float(STARTING_CASH)
    output: list[float] = []
    for value in equity:
        if prior <= 0.0 or not math.isfinite(value):
            raise MeasurementError("invalid equity return denominator")
        result = value / prior - 1.0
        if result <= -1.0 or not math.isfinite(result):
            raise MeasurementError("invalid daily return")
        output.append(result)
        prior = value
    return tuple(output)


def simulate_scenario(
    all_points: Sequence[CohortPoint],
    trades: Sequence[Trade],
    first_open: date,
    final_open: date,
    scenario_id: str,
    per_side_bps: int,
) -> ScenarioPath:
    selected = tuple(point for point in all_points if first_open <= point.day <= final_open)
    if not selected or selected[0].day != first_open or selected[-1].day != final_open:
        raise MeasurementError("simulation partition boundary mismatch")
    days = tuple(point.day for point in selected)
    if any(right != left + timedelta(days=1) for left, right in itertools.pairwise(days)):
        raise MeasurementError("simulation day gap")
    strategy_equity, transitions = _simulate_equity(selected, trades, per_side_bps, always_on=False)
    comparator_equity, comparator_transitions = _simulate_equity(
        selected,
        (Trade(first_open, first_open, final_open),),
        per_side_bps,
        always_on=True,
    )
    if comparator_transitions != 2:
        raise MeasurementError("comparator transition defect")
    absolute_returns = _daily_returns(strategy_equity)
    comparator_returns = _daily_returns(comparator_equity)
    excess_returns = tuple(
        absolute - comparator
        for absolute, comparator in zip(absolute_returns, comparator_returns, strict=True)
    )
    point_by_day = {point.day: point for point in all_points}
    calendar = tuple(point.day for point in all_points)
    capacities = tuple(
        lagged_capacity_proxy(point_by_day, calendar, trade.entry_day) for trade in trades
    )
    return ScenarioPath(
        scenario_id,
        per_side_bps,
        days,
        strategy_equity,
        comparator_equity,
        absolute_returns,
        comparator_returns,
        excess_returns,
        tuple(trades),
        transitions,
        capacities,
    )


def _mean(values: Sequence[float]) -> float:
    if not values:
        raise MeasurementError("mean of empty sequence")
    value = math.fsum(values) / len(values)
    if not math.isfinite(value):
        raise MeasurementError("nonfinite mean")
    return value


def _percentile(values: Sequence[float], probability: float) -> float:
    if not values or not 0.0 <= probability <= 1.0:
        raise MeasurementError("invalid percentile request")
    ordered = sorted(values)
    position = probability * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def circular_block_indices(
    length: int,
    block_days: int,
    replicates: int,
    seed: int,
) -> tuple[tuple[int, ...], ...]:
    if length <= 0 or block_days <= 0 or replicates <= 0:
        raise MeasurementError("invalid bootstrap geometry")
    generator = random.Random(seed)
    output: list[tuple[int, ...]] = []
    block_count = math.ceil(length / block_days)
    for _ in range(replicates):
        indices: list[int] = []
        for _ in range(block_count):
            start = generator.randrange(length)
            indices.extend((start + offset) % length for offset in range(block_days))
        output.append(tuple(indices[:length]))
    return tuple(output)


def bootstrap_summary(
    daily_returns: Sequence[float],
    block_days: int,
    replicates: int,
    seed: int,
) -> BootstrapSummary:
    if not daily_returns or any(not math.isfinite(value) for value in daily_returns):
        raise MeasurementError("invalid bootstrap observations")
    observations = tuple(value * 1000.0 for value in daily_returns)
    observed = _mean(observations)
    indices = circular_block_indices(len(observations), block_days, replicates, seed)
    means = tuple(_mean(tuple(observations[index] for index in replicate)) for replicate in indices)
    centered = tuple(value - observed for value in observations)
    centered_means = tuple(
        _mean(tuple(centered[index] for index in replicate)) for replicate in indices
    )
    count = sum(value >= observed for value in centered_means)
    p_value = (count + 1.0) / (replicates + 1.0)
    return BootstrapSummary(
        observed,
        _percentile(means, 0.05),
        _percentile(means, 0.95),
        _percentile(means, 0.05),
        p_value,
        block_days,
        replicates,
    )


def holm_adjust(raw_p_values: Mapping[str, float]) -> dict[str, float]:
    if not raw_p_values or any(
        not math.isfinite(value) or not 0.0 <= value <= 1.0 for value in raw_p_values.values()
    ):
        raise MeasurementError("invalid Holm family")
    ordered = sorted(raw_p_values.items(), key=lambda item: (item[1], item[0]))
    adjusted: dict[str, float] = {}
    running = 0.0
    count = len(ordered)
    for rank, (identity, raw) in enumerate(ordered):
        running = max(running, min(1.0, raw * (count - rank)))
        adjusted[identity] = running
    return adjusted


def white_max_stat_p_value(
    trial_observations: Mapping[str, Sequence[float]],
    block_days: int,
    replicates: int,
    seed: int,
) -> float:
    if not trial_observations:
        raise MeasurementError("White family is empty")
    lengths = {len(values) for values in trial_observations.values()}
    if len(lengths) != 1 or 0 in lengths:
        raise MeasurementError("White family observation lengths differ")
    length = lengths.pop()
    values_usdt = {
        trial_id: tuple(value * 1000.0 for value in values)
        for trial_id, values in trial_observations.items()
    }
    observed_means = {trial_id: _mean(values) for trial_id, values in values_usdt.items()}
    family_observed = max(observed_means.values())
    centered = {
        trial_id: tuple(value - observed_means[trial_id] for value in values)
        for trial_id, values in values_usdt.items()
    }
    indices = circular_block_indices(length, block_days, replicates, seed)
    exceedances = 0
    for replicate in indices:
        maximum = max(
            _mean(tuple(values[index] for index in replicate)) for values in centered.values()
        )
        if maximum >= family_observed:
            exceedances += 1
    return (exceedances + 1.0) / (replicates + 1.0)


def _compound_return(values: Sequence[float]) -> float:
    factor = 1.0
    for value in values:
        factor *= 1.0 + value
    result = factor - 1.0
    if not math.isfinite(result):
        raise MeasurementError("nonfinite compounded return")
    return result


def monthly_returns(path: ScenarioPath) -> tuple[tuple[float, ...], tuple[float, ...]]:
    months = tuple(dict.fromkeys(day.strftime("%Y-%m") for day in path.days))
    absolute: list[float] = []
    excess: list[float] = []
    for month in months:
        indices = tuple(
            index for index, day in enumerate(path.days) if day.strftime("%Y-%m") == month
        )
        absolute_value = _compound_return(
            tuple(path.absolute_daily_returns[index] for index in indices)
        )
        comparator_value = _compound_return(
            tuple(path.comparator_daily_returns[index] for index in indices)
        )
        absolute.append(absolute_value)
        excess.append(absolute_value - comparator_value)
    return tuple(absolute), tuple(excess)


def max_drawdown(equity: Sequence[float]) -> float:
    values = (float(STARTING_CASH), *equity)
    peak = values[0]
    maximum = 0.0
    for value in values:
        peak = max(peak, value)
        if peak <= 0.0:
            raise MeasurementError("nonpositive drawdown peak")
        maximum = max(maximum, (peak - value) / peak)
    return maximum


def scenario_by_id(evaluation: TrialEvaluation, scenario_id: str) -> ScenarioPath:
    matches = tuple(path for path in evaluation.paths if path.scenario_id == scenario_id)
    if len(matches) != 1:
        raise MeasurementError(f"scenario not unique: {scenario_id}")
    return matches[0]


def evaluate_trial(
    points: Sequence[CohortPoint],
    trial: TrialSpec,
    first_open: date,
    final_open: date,
    *,
    replicates: int = BOOTSTRAP_REPLICATES,
    seed: int = BOOTSTRAP_SEED,
) -> TrialEvaluation:
    signals = detect_signals(points, trial)
    calendar = tuple(point.day for point in points)
    trades = schedule_trades(signals, calendar, trial, first_open, final_open)
    paths = tuple(
        simulate_scenario(
            points,
            trades,
            first_open,
            final_open,
            scenario_id,
            per_side_bps,
        )
        for scenario_id, per_side_bps in COST_SCENARIOS
    )
    scenario_inferences = tuple(
        _scenario_inference(path, trial, scenario_index, replicates, seed)
        for scenario_index, path in enumerate(paths)
    )
    base = next(path for path in paths if path.scenario_id == "base")
    base_inference = next(value for value in scenario_inferences if value.scenario_id == "base")
    monthly_absolute, monthly_excess = monthly_returns(base)
    return TrialEvaluation(
        trial,
        paths,
        base_inference.primary_absolute,
        base_inference.primary_excess,
        base_inference.sensitivity_absolute,
        base_inference.sensitivity_excess,
        monthly_absolute,
        monthly_excess,
        scenario_inferences,
    )


def _scenario_inference(
    path: ScenarioPath,
    trial: TrialSpec,
    scenario_index: int,
    replicates: int,
    seed: int,
) -> ScenarioInference:
    lane = scenario_index * 10
    return ScenarioInference(
        path.scenario_id,
        bootstrap_summary(
            path.absolute_daily_returns,
            PRIMARY_BLOCK_DAYS,
            replicates,
            seed + _trial_seed(trial, lane + 1),
        ),
        bootstrap_summary(
            path.excess_daily_returns,
            PRIMARY_BLOCK_DAYS,
            replicates,
            seed + _trial_seed(trial, lane + 2),
        ),
        bootstrap_summary(
            path.absolute_daily_returns,
            SENSITIVITY_BLOCK_DAYS,
            replicates,
            seed + _trial_seed(trial, lane + 3),
        ),
        bootstrap_summary(
            path.excess_daily_returns,
            SENSITIVITY_BLOCK_DAYS,
            replicates,
            seed + _trial_seed(trial, lane + 4),
        ),
    )


def _trial_seed(trial: TrialSpec, lane: int) -> int:
    payload = f"{trial.trial_id}:{lane}".encode()
    return int.from_bytes(hashlib.sha256(payload).digest()[:4], "big")


def family_inference(
    evaluations: Sequence[TrialEvaluation],
    *,
    replicates: int = BOOTSTRAP_REPLICATES,
    seed: int = BOOTSTRAP_SEED,
) -> JsonObject:
    if tuple(evaluation.trial for evaluation in evaluations) != trial_grid():
        raise MeasurementError("family evaluation order drift")
    absolute_raw = {
        evaluation.trial.trial_id: evaluation.primary_absolute.one_sided_p_value
        for evaluation in evaluations
    }
    excess_raw = {
        evaluation.trial.trial_id: evaluation.primary_excess.one_sided_p_value
        for evaluation in evaluations
    }
    absolute_observations = {
        evaluation.trial.trial_id: scenario_by_id(evaluation, "base").absolute_daily_returns
        for evaluation in evaluations
    }
    excess_observations = {
        evaluation.trial.trial_id: scenario_by_id(evaluation, "base").excess_daily_returns
        for evaluation in evaluations
    }
    absolute_holm = holm_adjust(absolute_raw)
    excess_holm = holm_adjust(excess_raw)
    absolute_white = white_max_stat_p_value(
        absolute_observations, PRIMARY_BLOCK_DAYS, replicates, seed + 101
    )
    excess_white = white_max_stat_p_value(
        excess_observations, PRIMARY_BLOCK_DAYS, replicates, seed + 202
    )
    absolute_holm_json: JsonObject = {}
    excess_holm_json: JsonObject = {}
    for key, value in absolute_holm.items():
        absolute_holm_json[key] = value
    for key, value in excess_holm.items():
        excess_holm_json[key] = value
    return {
        "absoluteHolmAdjustedP": absolute_holm_json,
        "absoluteWhiteMaxStatP": absolute_white,
        "excessHolmAdjustedP": excess_holm_json,
        "excessWhiteMaxStatP": excess_white,
        "pbo": cscv_pbo(evaluations),
        "role": "DEVELOPMENT_MULTIPLICITY_AND_REPORT_ONLY_PBO",
    }


def cscv_pbo(evaluations: Sequence[TrialEvaluation]) -> JsonObject:
    if len(evaluations) != 12:
        raise MeasurementError("CSCV requires twelve trials")
    base_paths = tuple(scenario_by_id(evaluation, "base") for evaluation in evaluations)
    months = tuple(dict.fromkeys(day.strftime("%Y-%m") for day in base_paths[0].days))
    if len(months) != 8:
        raise MeasurementError("CSCV requires exactly eight development months")
    if any(
        tuple(dict.fromkeys(day.strftime("%Y-%m") for day in path.days)) != months
        for path in base_paths
    ):
        raise MeasurementError("CSCV month alignment drift")
    lambdas: list[float] = []
    selections: list[JsonValue] = []
    month_set = set(months)
    for training_months_tuple in itertools.combinations(months, 4):
        training_months = set(training_months_tuple)
        testing_months = month_set - training_months
        training_scores = tuple(_partition_mean(path, training_months) for path in base_paths)
        selected_index = max(
            range(len(evaluations)),
            key=lambda index: (
                training_scores[index],
                evaluations[index].trial.trial_id,
            ),
        )
        testing_scores = tuple(_partition_mean(path, testing_months) for path in base_paths)
        selected_score = testing_scores[selected_index]
        below = sum(score < selected_score for score in testing_scores)
        tied = sum(score == selected_score for score in testing_scores)
        percentile = (below + 0.5 * tied) / len(testing_scores)
        percentile = min(max(percentile, 1.0 / 24.0), 23.0 / 24.0)
        lambda_value = math.log(percentile / (1.0 - percentile))
        lambdas.append(lambda_value)
        selections.append(
            {
                "selectedTrialId": evaluations[selected_index].trial.trial_id,
                "testingRankPercentile": percentile,
                "trainingMonths": list(training_months_tuple),
            }
        )
    return {
        "combinationCount": len(lambdas),
        "lambdaMedian": median(lambdas),
        "limitations": [
            "MEAN_EXCESS_FAMILY_DIAGNOSTIC_NOT_GATE_AND_LCB_SELECTION_PROCEDURE",
            "NO_MULTI_DAY_HOLDING_PURGE_AT_MONTH_BOUNDARIES",
        ],
        "pbo": sum(value <= 0.0 for value in lambdas) / len(lambdas),
        "role": "REPORT_ONLY_MEAN_EXCESS_FAMILY_DIAGNOSTIC_NEVER_SELECTS_RESCUES_OR_VETOES",
        "selections": selections,
    }


def _partition_mean(path: ScenarioPath, months: set[str]) -> float:
    selected = tuple(
        value
        for day, value in zip(path.days, path.excess_daily_returns, strict=True)
        if day.strftime("%Y-%m") in months
    )
    return _mean(selected)


def _bootstrap_mapping(summary: BootstrapSummary) -> JsonObject:
    return {
        "blockDays": summary.block_days,
        "lower90UsdtPerDayPer1000": summary.lower_90,
        "observedMeanUsdtPerDayPer1000": summary.observed_mean_usdt_per_day_per_1000,
        "oneSided95LcbUsdtPerDayPer1000": summary.one_sided_95_lcb,
        "oneSidedPValue": summary.one_sided_p_value,
        "replicates": summary.replicates,
        "upper90UsdtPerDayPer1000": summary.upper_90,
    }


def _scenario_mapping(
    path: ScenarioPath,
    inference: ScenarioInference,
) -> JsonObject:
    if path.scenario_id != inference.scenario_id:
        raise MeasurementError("scenario inference identity mismatch")
    total_absolute = path.strategy_equity[-1] - float(STARTING_CASH)
    total_comparator = path.comparator_equity[-1] - float(STARTING_CASH)
    return {
        "absoluteMeanUsdtPerDayPer1000": _mean(path.absolute_daily_returns) * 1000.0,
        "absoluteTotalUsdtPer1000": total_absolute,
        "capacityProxyMinimumUsdt": min(path.capacity_proxy_usdt)
        if path.capacity_proxy_usdt
        else None,
        "capacityProxyObservations": len(path.capacity_proxy_usdt),
        "comparatorTotalUsdtPer1000": total_comparator,
        "completedTrades": len(path.trades),
        "excessMeanUsdtPerDayPer1000": _mean(path.excess_daily_returns) * 1000.0,
        "excessTotalUsdtPer1000": total_absolute - total_comparator,
        "markedOpenMaximumDrawdownFraction": max_drawdown(path.strategy_equity),
        "perExecutedSideBps": path.per_side_bps,
        "primaryAbsolute": _bootstrap_mapping(inference.primary_absolute),
        "primaryExcess": _bootstrap_mapping(inference.primary_excess),
        "scenarioId": path.scenario_id,
        "sensitivityAbsolute": _bootstrap_mapping(inference.sensitivity_absolute),
        "sensitivityExcess": _bootstrap_mapping(inference.sensitivity_excess),
        "transitionCount": path.transition_count,
    }


def evaluation_mapping(evaluation: TrialEvaluation) -> JsonObject:
    inferences = {inference.scenario_id: inference for inference in evaluation.scenario_inference}
    if set(inferences) != {path.scenario_id for path in evaluation.paths}:
        raise MeasurementError("scenario inference coverage mismatch")
    return {
        "monthlyAbsoluteCompoundReturns": list(evaluation.monthly_absolute),
        "monthlyExcessCompoundReturns": list(evaluation.monthly_excess),
        "primaryAbsolute": _bootstrap_mapping(evaluation.primary_absolute),
        "primaryExcess": _bootstrap_mapping(evaluation.primary_excess),
        "scenarios": [
            _scenario_mapping(path, inferences[path.scenario_id]) for path in evaluation.paths
        ],
        "sensitivityAbsolute": _bootstrap_mapping(evaluation.sensitivity_absolute),
        "sensitivityExcess": _bootstrap_mapping(evaluation.sensitivity_excess),
        "trial": {
            "holdDays": evaluation.trial.hold_days,
            "lookback": evaluation.trial.lookback,
            "threshold": evaluation.trial.threshold,
            "trialId": evaluation.trial.trial_id,
        },
    }


def _path_totals(path: ScenarioPath) -> tuple[float, float]:
    absolute = path.strategy_equity[-1] - float(STARTING_CASH)
    comparator = path.comparator_equity[-1] - float(STARTING_CASH)
    return absolute, absolute - comparator


def development_gates(
    evaluation: TrialEvaluation,
    family: Mapping[str, JsonValue],
) -> dict[str, bool]:
    base = scenario_by_id(evaluation, "base")
    stress = scenario_by_id(evaluation, "stress")
    base_absolute, base_excess = _path_totals(base)
    stress_absolute, stress_excess = _path_totals(stress)
    absolute_holm = _object(family.get("absoluteHolmAdjustedP"), "absoluteHolmAdjustedP")
    excess_holm = _object(family.get("excessHolmAdjustedP"), "excessHolmAdjustedP")
    absolute_holm_value = absolute_holm.get(evaluation.trial.trial_id)
    excess_holm_value = excess_holm.get(evaluation.trial.trial_id)
    if not isinstance(absolute_holm_value, (int, float)) or isinstance(absolute_holm_value, bool):
        raise MeasurementError("absolute Holm value missing")
    if not isinstance(excess_holm_value, (int, float)) or isinstance(excess_holm_value, bool):
        raise MeasurementError("excess Holm value missing")
    absolute_white = family.get("absoluteWhiteMaxStatP")
    excess_white = family.get("excessWhiteMaxStatP")
    if not isinstance(absolute_white, (int, float)) or isinstance(absolute_white, bool):
        raise MeasurementError("absolute White value missing")
    if not isinstance(excess_white, (int, float)) or isinstance(excess_white, bool):
        raise MeasurementError("excess White value missing")
    return {
        "base_absolute_mean_positive": (
            evaluation.primary_absolute.observed_mean_usdt_per_day_per_1000 > 0.0
        ),
        "base_absolute_primary_lcb_positive": evaluation.primary_absolute.one_sided_95_lcb > 0.0,
        "base_absolute_total_positive": base_absolute > 0.0,
        "base_excess_mean_positive": evaluation.primary_excess.observed_mean_usdt_per_day_per_1000
        > 0.0,
        "base_excess_primary_lcb_positive": evaluation.primary_excess.one_sided_95_lcb > 0.0,
        "base_excess_total_positive": base_excess > 0.0,
        "completed_trades_at_least_4": len(base.trades) >= 4,
        "holm_absolute_at_most_0_05": float(absolute_holm_value) <= 0.05,
        "holm_excess_at_most_0_05": float(excess_holm_value) <= 0.05,
        "positive_absolute_months_at_least_5": sum(
            value > 0.0 for value in evaluation.monthly_absolute
        )
        >= 5,
        "positive_excess_months_at_least_5": sum(value > 0.0 for value in evaluation.monthly_excess)
        >= 5,
        "stress_absolute_total_positive": stress_absolute > 0.0,
        "stress_drawdown_at_most_0_20": max_drawdown(stress.strategy_equity) <= MAX_STRESS_DRAWDOWN,
        "stress_excess_total_positive": stress_excess > 0.0,
        "white_absolute_at_most_0_05": float(absolute_white) <= 0.05,
        "white_excess_at_most_0_05": float(excess_white) <= 0.05,
    }


def holdout_gates(evaluation: TrialEvaluation) -> dict[str, bool]:
    base = scenario_by_id(evaluation, "base")
    stress = scenario_by_id(evaluation, "stress")
    base_absolute, base_excess = _path_totals(base)
    stress_absolute, stress_excess = _path_totals(stress)
    return {
        "base_absolute_mean_positive": (
            evaluation.primary_absolute.observed_mean_usdt_per_day_per_1000 > 0.0
        ),
        "base_absolute_primary_lcb_positive": evaluation.primary_absolute.one_sided_95_lcb > 0.0,
        "base_absolute_raw_p_at_most_0_05": evaluation.primary_absolute.one_sided_p_value <= 0.05,
        "base_absolute_total_positive": base_absolute > 0.0,
        "base_excess_mean_positive": evaluation.primary_excess.observed_mean_usdt_per_day_per_1000
        > 0.0,
        "base_excess_primary_lcb_positive": evaluation.primary_excess.one_sided_95_lcb > 0.0,
        "base_excess_raw_p_at_most_0_05": evaluation.primary_excess.one_sided_p_value <= 0.05,
        "base_excess_total_positive": base_excess > 0.0,
        "completed_trades_at_least_2": len(base.trades) >= 2,
        "positive_absolute_months_at_least_3": sum(
            value > 0.0 for value in evaluation.monthly_absolute
        )
        >= 3,
        "positive_excess_months_at_least_3": sum(value > 0.0 for value in evaluation.monthly_excess)
        >= 3,
        "stress_absolute_total_positive": stress_absolute > 0.0,
        "stress_drawdown_at_most_0_20": max_drawdown(stress.strategy_equity) <= MAX_STRESS_DRAWDOWN,
        "stress_excess_total_positive": stress_excess > 0.0,
    }


def _selection_key(evaluation: TrialEvaluation) -> tuple[float, float, int, float, int, int, str]:
    base = scenario_by_id(evaluation, "base")
    return (
        evaluation.primary_excess.one_sided_95_lcb,
        evaluation.primary_absolute.one_sided_95_lcb,
        -base.transition_count,
        evaluation.trial.threshold,
        evaluation.trial.lookback,
        -evaluation.trial.hold_days,
        evaluation.trial.trial_id,
    )


def select_development_candidate(
    evaluations: Sequence[TrialEvaluation],
    family: Mapping[str, JsonValue],
) -> tuple[TrialEvaluation | None, dict[str, dict[str, bool]]]:
    gates = {
        evaluation.trial.trial_id: development_gates(evaluation, family)
        for evaluation in evaluations
    }
    passers = tuple(
        evaluation for evaluation in evaluations if all(gates[evaluation.trial.trial_id].values())
    )
    if not passers:
        return None, gates
    return max(passers, key=_selection_key), gates


def _require_tracked_clean(paths: Sequence[Path]) -> str:
    head = _git_output("rev-parse", "HEAD")
    if _git_output("status", "--porcelain"):
        raise MeasurementError("frozen worktree is not globally clean")
    relative_paths = tuple(str(path.relative_to(REPO_DIR)) for path in paths)
    status = _git_output("status", "--porcelain", "--", *relative_paths)
    if status:
        raise MeasurementError("frozen packet inputs are dirty")
    for relative in relative_paths:
        if _git_output("ls-files", "--error-unmatch", relative) != relative:
            raise MeasurementError(f"frozen input is not tracked: {relative}")
        blob = subprocess.run(
            ("git", "show", f"HEAD:{relative}"),
            cwd=REPO_DIR,
            check=False,
            capture_output=True,
        )
        if blob.returncode != 0 or _sha256_bytes(blob.stdout) != sha256_path(REPO_DIR / relative):
            raise MeasurementError(f"frozen input differs from HEAD: {relative}")
    return head


def validate_frozen_identity() -> tuple[JsonObject, JsonObject, str]:
    load_protocol()
    paths = (*SOURCE_FILES, ACQUISITION_PATH, SOURCE_MANIFEST_PATH, FREEZE_PATH)
    head = _require_tracked_clean(paths)
    freeze = _read_canonical_json(FREEZE_PATH)
    manifest = _read_canonical_json(SOURCE_MANIFEST_PATH)
    acquisition = _read_canonical_json(ACQUISITION_PATH)
    if freeze.get("schema") != "VG36PreOutcomeFreezeV1":
        raise MeasurementError("freeze schema drift")
    if freeze.get("archiveBodiesOpened") is not False:
        raise MeasurementError("freeze archive-open truth invalid")
    if freeze.get("baseCommit") != BASE_COMMIT:
        raise MeasurementError("freeze base commit drift")
    if freeze.get("protocolSha256") != sha256_path(PROTOCOL_PATH):
        raise MeasurementError("freeze protocol binding drift")
    if freeze.get("sourceManifestSha256") != sha256_path(SOURCE_MANIFEST_PATH):
        raise MeasurementError("freeze source-manifest binding drift")
    if freeze.get("acquisitionSha256") != sha256_path(ACQUISITION_PATH):
        raise MeasurementError("freeze acquisition binding drift")
    expected_source_hashes: JsonObject = {
        str(path.relative_to(PACKET_DIR)): sha256_path(path) for path in SOURCE_FILES
    }
    if freeze.get("sourceFileSha256") != expected_source_hashes:
        raise MeasurementError("freeze source-file binding drift")
    acquisition_head = _validate_acquisition(acquisition)
    if freeze.get("gitHeadBeforeFreezeOutputs") != acquisition_head:
        raise MeasurementError("freeze/acquisition Git head drift")
    _validate_source_manifest(manifest, acquisition)
    _require_direct_child(head, acquisition_head, "committed freeze head")
    _require_exclusive_scope(BASE_COMMIT, head)
    return freeze, manifest, head


def _require_prerun_absence() -> None:
    forbidden = (
        RUN_MARKER_PATH,
        DEVELOPMENT_PATH,
        CANDIDATE_SEAL_PATH,
        HOLDOUT_MARKER_PATH,
        HOLDOUT_BODY_OPEN_PATH,
        HOLDOUT_PATH,
        RESULT_PATH,
        SHA256SUMS_PATH,
    )
    present = tuple(path.name for path in forbidden if path.exists())
    if present:
        raise MeasurementError(f"run lifecycle already consumed: {present}")


def _consume_run_marker(freeze: Mapping[str, JsonValue], git_head: str) -> JsonObject:
    marker: JsonObject = {
        "createdAtUtc": _utc_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "gitHead": git_head,
        "holdoutAuthorized": False,
        "holdoutOpened": False,
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "schema": "VG36ExclusiveRunMarkerV1",
        "sourceManifestSha256": sha256_path(SOURCE_MANIFEST_PATH),
    }
    if freeze.get("schema") != "VG36PreOutcomeFreezeV1":
        raise MeasurementError("freeze changed before marker")
    _write_json_exclusive(RUN_MARKER_PATH, marker)
    return marker


def _terminal_truth() -> JsonObject:
    return {
        "accountEffectiveFees": "UNKNOWN",
        "capitalAuthority": "NONE",
        "causalIdentification": "NOT_CLAIMED",
        "consumer": "N3_SUCCESSOR_ORCHESTRATOR_SCOREBOARD",
        "executableCapacity": "UNMEASURED",
        "globalSharedHoldoutRisk": "PRESENT_VERIFIED_POSITIVE_INELIGIBLE",
        "intradayDrawdown": "UNMEASURED",
    }


def _terminal_unmeasured(reason: str) -> JsonObject:
    result: JsonObject = {
        **_terminal_truth(),
        "candidateSealSha256": (
            sha256_path(CANDIDATE_SEAL_PATH) if CANDIDATE_SEAL_PATH.exists() else None
        ),
        "candidateSealed": CANDIDATE_SEAL_PATH.exists(),
        "developmentSha256": (sha256_path(DEVELOPMENT_PATH) if DEVELOPMENT_PATH.exists() else None),
        "developmentMaterialized": DEVELOPMENT_PATH.exists(),
        "disposition": "TERMINAL_DEFECT_NO_REPAIR_NO_RERUN",
        "holdoutAuthorized": HOLDOUT_MARKER_PATH.exists(),
        "holdoutBodyOpenReceiptSha256": (
            sha256_path(HOLDOUT_BODY_OPEN_PATH) if HOLDOUT_BODY_OPEN_PATH.exists() else None
        ),
        "holdoutMarkerSha256": (
            sha256_path(HOLDOUT_MARKER_PATH) if HOLDOUT_MARKER_PATH.exists() else None
        ),
        "holdoutOpened": HOLDOUT_BODY_OPEN_PATH.exists(),
        "holdoutSha256": sha256_path(HOLDOUT_PATH) if HOLDOUT_PATH.exists() else None,
        "holdoutOutcomeMaterialized": HOLDOUT_PATH.exists(),
        "localVerdict": "UNMEASURED",
        "reason": reason[:500],
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "schema": "VG36TerminalResultV1",
        "verdict": "UNMEASURED",
    }
    _write_json_exclusive(RESULT_PATH, result)
    write_sha256s()
    return result


def _development_result(
    evaluations: Sequence[TrialEvaluation],
    family: JsonObject,
    gates: Mapping[str, Mapping[str, bool]],
    champion: TrialEvaluation | None,
) -> JsonObject:
    return {
        "allTrialEvaluations": [evaluation_mapping(value) for value in evaluations],
        "championTrialId": champion.trial.trial_id if champion is not None else None,
        "familyInference": family,
        "freezeSha256": sha256_path(FREEZE_PATH),
        "gateResults": {
            trial_id: dict(sorted(trial_gates.items()))
            for trial_id, trial_gates in sorted(gates.items())
        },
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "schema": "VG36DevelopmentEvaluationV1",
    }


def _no_go_development(development: Mapping[str, JsonValue]) -> JsonObject:
    result: JsonObject = {
        **_terminal_truth(),
        "candidateSealed": False,
        "developmentMaterialized": True,
        "developmentSha256": sha256_path(DEVELOPMENT_PATH),
        "disposition": "VALID_DEVELOPMENT_GATE_FAILURE_HOLDOUT_UNOPENED",
        "holdoutAuthorized": False,
        "holdoutOpened": False,
        "holdoutOutcomeMaterialized": False,
        "localVerdict": "NO_GO",
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "schema": "VG36TerminalResultV1",
        "verdict": "NO_GO",
    }
    if development.get("championTrialId") is not None:
        raise MeasurementError("development no-go unexpectedly has champion")
    _write_json_exclusive(RESULT_PATH, result)
    write_sha256s()
    return result


def _candidate_seal(champion: TrialEvaluation) -> JsonObject:
    seal: JsonObject = {
        "championTrial": {
            "holdDays": champion.trial.hold_days,
            "lookback": champion.trial.lookback,
            "threshold": champion.trial.threshold,
            "trialId": champion.trial.trial_id,
        },
        "createdAtUtc": _utc_now(),
        "developmentSha256": sha256_path(DEVELOPMENT_PATH),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "schema": "VG36DevelopmentCandidateSealV1",
    }
    _write_json_exclusive(CANDIDATE_SEAL_PATH, seal)
    return seal


def _holdout_marker(champion: TrialEvaluation) -> JsonObject:
    marker: JsonObject = {
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "championTrialId": champion.trial.trial_id,
        "createdAtUtc": _utc_now(),
        "freezeSha256": sha256_path(FREEZE_PATH),
        "schema": "VG36ExclusiveHoldoutOpenMarkerV1",
    }
    _write_json_exclusive(HOLDOUT_MARKER_PATH, marker)
    return marker


def _holdout_body_open_receipt(artifact: Mapping[str, JsonValue]) -> None:
    symbol = _string(artifact.get("symbol"), "holdout-open.symbol")
    month = _string(artifact.get("month"), "holdout-open.month")
    archive_sha = _string(artifact.get("archiveSha256"), "holdout-open.archiveSha256")
    if (
        symbol not in COHORT
        or month not in HOLDOUT_SOURCE_MONTHS
        or not HEX64_RE.fullmatch(archive_sha)
    ):
        raise MeasurementError("holdout-open artifact identity drift")
    receipt: JsonObject = {
        "archiveMemberBodyOpened": True,
        "archiveSha256": archive_sha,
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "createdAtUtc": _utc_now(),
        "holdoutMarkerSha256": sha256_path(HOLDOUT_MARKER_PATH),
        "month": month,
        "schema": "VG36FirstHoldoutArchiveBodyOpenV1",
        "symbol": symbol,
    }
    _write_json_exclusive(HOLDOUT_BODY_OPEN_PATH, receipt)


def _holdout_result(evaluation: TrialEvaluation, gates: Mapping[str, bool]) -> JsonObject:
    return {
        "allHoldoutGatesPass": all(gates.values()),
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "championTrialId": evaluation.trial.trial_id,
        "evaluation": evaluation_mapping(evaluation),
        "gateResults": dict(sorted(gates.items())),
        "holdoutBodyOpenReceiptSha256": sha256_path(HOLDOUT_BODY_OPEN_PATH),
        "holdoutMarkerSha256": sha256_path(HOLDOUT_MARKER_PATH),
        "schema": "VG36HoldoutEvaluationV1",
    }


def _terminal_holdout(holdout: Mapping[str, JsonValue]) -> JsonObject:
    local_pass = holdout.get("allHoldoutGatesPass") is True
    result: JsonObject = {
        **_terminal_truth(),
        "candidateSealSha256": sha256_path(CANDIDATE_SEAL_PATH),
        "candidateSealed": True,
        "developmentMaterialized": True,
        "developmentSha256": sha256_path(DEVELOPMENT_PATH),
        "disposition": (
            "LOCAL_PUBLIC_GO_BUT_GLOBAL_SHARED_HOLDOUT_INELIGIBLE"
            if local_pass
            else "VALID_HOLDOUT_GATE_FAILURE"
        ),
        "holdoutAuthorized": True,
        "holdoutBodyOpenReceiptSha256": sha256_path(HOLDOUT_BODY_OPEN_PATH),
        "holdoutMarkerSha256": sha256_path(HOLDOUT_MARKER_PATH),
        "holdoutOpened": True,
        "holdoutOutcomeMaterialized": True,
        "holdoutSha256": sha256_path(HOLDOUT_PATH),
        "localVerdict": "LOCAL_PUBLIC_GO" if local_pass else "NO_GO",
        "runMarkerSha256": sha256_path(RUN_MARKER_PATH),
        "schema": "VG36TerminalResultV1",
        "verdict": "NO_GO",
    }
    _write_json_exclusive(RESULT_PATH, result)
    write_sha256s()
    return result


def run_experiment() -> JsonObject:
    _require_prerun_absence()
    freeze, manifest, head = validate_frozen_identity()
    _consume_run_marker(freeze, head)
    try:
        development_bars = _load_bars(manifest, DEVELOPMENT_SOURCE_MONTHS)
        development_points = build_cohort_points(development_bars)
        evaluations = tuple(
            evaluate_trial(
                development_points,
                trial,
                DEVELOPMENT_FIRST_OPEN,
                DEVELOPMENT_FINAL_OPEN,
            )
            for trial in trial_grid()
        )
        family = family_inference(evaluations)
        champion, gates = select_development_candidate(evaluations, family)
        development = _development_result(evaluations, family, gates, champion)
        _write_json_exclusive(DEVELOPMENT_PATH, development)
        if champion is None:
            return _no_go_development(development)
        _candidate_seal(champion)
        _holdout_marker(champion)
        holdout_bars = _load_bars(
            manifest,
            HOLDOUT_SOURCE_MONTHS,
            on_first_member_open=_holdout_body_open_receipt,
        )
        complete_bars = merge_bars(development_bars, holdout_bars)
        complete_points = build_cohort_points(complete_bars)
        holdout_evaluation = evaluate_trial(
            complete_points,
            champion.trial,
            HOLDOUT_FIRST_OPEN,
            HOLDOUT_FINAL_OPEN,
        )
        gates_holdout = holdout_gates(holdout_evaluation)
        holdout = _holdout_result(holdout_evaluation, gates_holdout)
        _write_json_exclusive(HOLDOUT_PATH, holdout)
        return _terminal_holdout(holdout)
    except BaseException as exc:
        if RESULT_PATH.exists():
            raise
        return _terminal_unmeasured(f"{type(exc).__name__}: {exc}")


def packet_files() -> tuple[Path, ...]:
    candidates = (
        *SOURCE_FILES,
        ACQUISITION_PATH,
        SOURCE_MANIFEST_PATH,
        FREEZE_PATH,
        RUN_MARKER_PATH,
        DEVELOPMENT_PATH,
        CANDIDATE_SEAL_PATH,
        HOLDOUT_MARKER_PATH,
        HOLDOUT_BODY_OPEN_PATH,
        HOLDOUT_PATH,
        RESULT_PATH,
    )
    return tuple(path for path in candidates if path.exists())


def write_sha256s() -> None:
    lines = "".join(
        f"{sha256_path(path)}  {path.name}\n"
        for path in sorted(packet_files(), key=lambda item: item.name)
    )
    _write_bytes_replace(SHA256SUMS_PATH, lines.encode("ascii"))


def _parse_args(arguments: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("acquire", "freeze", "run", "verify"))
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    parsed = _parse_args(arguments)
    try:
        if parsed.command == "acquire":
            result = acquire_sources()
        elif parsed.command == "freeze":
            result = freeze_sources()
        elif parsed.command == "run":
            result = run_experiment()
        else:
            from research.vg36.verify import verify_packet

            result = verify_packet()
    except VG36Error as exc:
        print(f"VG36_ERROR {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
