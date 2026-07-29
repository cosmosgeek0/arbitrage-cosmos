"""Frozen public-only V-G22 volume-gap continuation experiment.

The lifecycle intentionally separates byte inventory, development selection, the
single holdout open, and verifier-only reporting.  Only the inventory command may
run before ``freeze.v1.json`` exists, and it never opens a ZIP member.
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
import statistics
import sys
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, getcontext
from pathlib import Path
from typing import Any, cast

getcontext().prec = 50

PACKET = Path(__file__).resolve().parent
PROTOCOL_PATH = PACKET / "protocol.v1.json"
SOURCE_MANIFEST_PATH = PACKET / "source_manifest.v1.json"
FREEZE_PATH = PACKET / "freeze.v1.json"
DEVELOPMENT_OPEN_PATH = PACKET / "development-open.v1.json"
HOLDOUT_OPEN_PATH = PACKET / "holdout-open.v1.json"
RUN_MARKER_PATH = PACKET / "run-marker.v1.json"
DEVELOPMENT_PATH = PACKET / "development.v1.json"
SELECTION_PATH = PACKET / "selection.v1.json"
RESULT_PATH = PACKET / "result.v1.json"
SHA256SUMS_PATH = PACKET / "SHA256SUMS"

DAY_US = 86_400_000_000
ZERO = Decimal(0)
ONE = Decimal(1)
INITIAL_USD = Decimal("1000")
FEE_RATE = Decimal("0.001")
BASE_ADVERSE = Decimal("0.001")
STRESS_ADVERSE = Decimal("0.0025")
PARTICIPATION = Decimal("0.0001")
MIN_ADV = Decimal("5000000")
ALPHA = 0.05
BOOTSTRAP_SEED = 421337
BOOTSTRAP_REPLICATES = 4096
BOOTSTRAP_BLOCK = 7
EXPECTED_SOURCE_ROOT = "/private/tmp/cosmos-s1f-weekly-momentum-cash-v1"
CANONICAL_PARENT_SHA = "a169b123fb186d1943a75ad648552c4d95be1be1"
SHA256_RE = re.compile(r"[0-9a-f]{64}")
COMMIT_RE = re.compile(r"[0-9a-f]{40}")
ACQUISITION_PAIR_FIELDS = (
    "checksumBytes",
    "checksumFrozenEtag",
    "checksumFrozenLastModified",
    "checksumKey",
    "checksumListedBytes",
    "checksumSha256",
    "month",
    "state",
    "symbol",
    "zipBytes",
    "zipFrozenEtag",
    "zipFrozenLastModified",
    "zipKey",
    "zipListedBytes",
    "zipSha256",
)

JsonObject = dict[str, Any]


class ContractError(RuntimeError):
    """A frozen protocol, custody, or lifecycle contract failed."""


class MeasurementError(RuntimeError):
    """The preregistered estimate cannot be measured from admitted evidence."""


@dataclass(frozen=True, slots=True)
class Bar:
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal


@dataclass(frozen=True, slots=True)
class Trial:
    trial_id: str
    lookback: int
    min_gap: int
    hold_days: int


@dataclass(frozen=True, slots=True)
class SelectedAsset:
    symbol: str
    previous_regime: int
    current_regime: int
    regime_gap: int
    quote_volume_ratio: Decimal
    close_ratio: Decimal
    prior_adv: Decimal


@dataclass(slots=True)
class Position:
    symbol: str
    allocation: Decimal
    quantity: Decimal
    raw_entry: Decimal
    adverse_entry: Decimal
    exit_day: date
    prior_adv: Decimal


@dataclass(slots=True)
class Sleeve:
    cash: Decimal
    positions: list[Position] = field(default_factory=list)


@dataclass(slots=True)
class TradeAccounting:
    symbol: str
    allocation: Decimal
    gross_pnl: Decimal
    entry_fee_cost: Decimal
    exit_fee_cost: Decimal
    adverse_execution_cost: Decimal
    net_pnl: Decimal


@dataclass(slots=True)
class Simulation:
    trial: Trial
    cost_label: str
    final_nav: Decimal
    net_usd: Decimal
    gross_pnl: Decimal
    entry_fee_cost: Decimal
    exit_fee_cost: Decimal
    adverse_execution_cost: Decimal
    daily_nav: list[tuple[date, Decimal]]
    daily_returns: list[tuple[date, float]]
    max_drawdown: Decimal
    valid_cohort_days: int
    selected_allocations: int
    skipped_entries: int
    round_trips: int
    distinct_assets: set[str]
    capacity_proxy_nominal_usdt: Decimal | None
    top_asset_gross_profit_share: Decimal
    top_five_trade_gross_profit_share: Decimal


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        + b"\n"
    )


def normalized_lines(values: Iterable[str]) -> bytes:
    return ("\n".join(values) + "\n").encode("utf-8")


def load_json(path: Path) -> JsonObject:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ContractError(f"{path.name} must contain a JSON object")
    return cast(JsonObject, value)


def write_json_once(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = canonical_bytes(value)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise ContractError(f"refusing to overwrite {path.name}") from exc
    try:
        view = memoryview(raw)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise OSError(f"short write for {path.name}")
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    parent_descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(parent_descriptor)
    finally:
        os.close(parent_descriptor)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def exact_decimal(value: Decimal, places: int = 8) -> str:
    quantum = Decimal(1).scaleb(-places)
    return format(value.quantize(quantum), "f")


def parse_day(value: str) -> date:
    return date.fromisoformat(value)


def days(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def protocol() -> JsonObject:
    value = load_json(PROTOCOL_PATH)
    if value.get("version") != "VG22ProtocolV1":
        raise ContractError("unexpected protocol version")
    data = value.get("data")
    if not isinstance(data, dict):
        raise ContractError("protocol data contract is absent")
    if (
        data.get("sourceRoot") != EXPECTED_SOURCE_ROOT
        or data.get("interval") != "1d"
        or data.get("quoteAsset") != "USDT"
        or data.get("timestampUnitFrom2025") != "MICROSECONDS"
    ):
        raise ContractError("protocol public-data contract drifted")
    if data.get("developmentArchiveMonths") != [
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
    ]:
        raise ContractError("protocol development archive split drifted")
    if data.get("holdoutWarmupArchiveMonths") != ["2026-01", "2026-02"]:
        raise ContractError("protocol holdout warmup archive split drifted")
    if data.get("holdoutArchiveMonths") != [
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
    ]:
        raise ContractError("protocol holdout archive split drifted")
    expected_trial_ids = [trial.trial_id for trial in trials()]
    if value.get("trials") != {
        "attemptedCount": 12,
        "holdingDays": [1, 3],
        "lookbackDays": [20, 40, 60],
        "minimumRegimeGap": [1, 2],
        "orderedTrialIds": expected_trial_ids,
    }:
        raise ContractError("protocol frozen trial family drifted")
    bootstrap = value.get("bootstrap")
    if not isinstance(bootstrap, dict) or (
        bootstrap.get("blockLengthDays") != BOOTSTRAP_BLOCK
        or bootstrap.get("replicates") != BOOTSTRAP_REPLICATES
        or bootstrap.get("seed") != BOOTSTRAP_SEED
    ):
        raise ContractError("protocol bootstrap contract drifted")
    costs = value.get("costs")
    if not isinstance(costs, dict) or (
        costs.get("base")
        != {
            "adverseExecutionBasisPointsPerSide": 10,
            "feeBasisPointsPerSide": 10,
        }
        or costs.get("stress")
        != {
            "adverseExecutionBasisPointsPerSide": 25,
            "feeBasisPointsPerSide": 10,
        }
    ):
        raise ContractError("protocol cost contract drifted")
    inference = value.get("inference")
    if not isinstance(inference, dict) or inference.get("selectionMetric") != (
        "HIGHEST_COMPOUNDED_DEVELOPMENT_BASE_NET_USD_PER_1000_"
        "ACROSS_THE_CONCATENATED_FOUR_FIXED_RULE_EVALUATION_FOLDS"
    ):
        raise ContractError("protocol selection metric drifted")
    return value


def trials() -> tuple[Trial, ...]:
    result: list[Trial] = []
    for lookback in (20, 40, 60):
        for min_gap in (1, 2):
            for hold in (1, 3):
                trial_id = f"VG22-L{lookback:02d}-G{min_gap}-H{hold}"
                result.append(Trial(trial_id, lookback, min_gap, hold))
    return tuple(result)


def trial_family_binding(proto: JsonObject) -> JsonObject:
    return {
        "trials": [
            {
                "holdingDays": trial.hold_days,
                "lookbackDays": trial.lookback,
                "minimumRegimeGap": trial.min_gap,
                "trialId": trial.trial_id,
            }
            for trial in trials()
        ]
    }


def split_plan_binding(proto: JsonObject) -> JsonObject:
    data = cast(JsonObject, proto["data"])
    development = cast(JsonObject, cast(JsonObject, proto["partitions"])["development"])
    holdout = cast(JsonObject, proto["holdout"])
    return {
        "developmentEvaluationFolds": development["evaluationFolds"],
        "historyBufferEndUtcDate": development["historyBufferEndUtcDate"],
        "historyBufferStartUtcDate": development["historyBufferStartUtcDate"],
        "holdoutArchiveMonths": data["holdoutArchiveMonths"],
        "holdoutWarmupArchiveMonths": data["holdoutWarmupArchiveMonths"],
        "holdout": {
            "endUtcDate": holdout["endUtcDate"],
            "startUtcDate": holdout["startUtcDate"],
        },
    }


def freeze_command(state_root: Path, pre_outcome_commit: str | None) -> JsonObject:
    if pre_outcome_commit is None or COMMIT_RE.fullmatch(pre_outcome_commit) is None:
        raise ContractError("freeze requires --pre-outcome-commit as lowercase 40-hex")
    if str(state_root.resolve()) != EXPECTED_SOURCE_ROOT:
        raise ContractError("state root differs from the frozen public source root")
    if not SOURCE_MANIFEST_PATH.exists():
        raise ContractError("source manifest must be inventoried before freeze")
    if any(
        path.exists()
        for path in (
            FREEZE_PATH,
            DEVELOPMENT_OPEN_PATH,
            HOLDOUT_OPEN_PATH,
            RUN_MARKER_PATH,
            DEVELOPMENT_PATH,
            SELECTION_PATH,
            RESULT_PATH,
        )
    ):
        raise ContractError("freeze authority was already consumed or outcomes exist")
    proto = protocol()
    trial_family = trial_family_binding(proto)
    freeze_bindings = cast(JsonObject, cast(JsonObject, proto["lifecycle"])["freezeBindings"])
    trial_family_sha256 = sha256_bytes(canonical_bytes(trial_family))
    if trial_family_sha256 != freeze_bindings["expectedTrialFamilySha256"]:
        raise ContractError("computed trial-family digest differs from protocol")
    split_plan_sha256 = sha256_bytes(canonical_bytes(split_plan_binding(proto)))
    if split_plan_sha256 != freeze_bindings["expectedSplitPlanSha256"]:
        raise ContractError("computed split-plan digest differs from protocol")
    value: JsonObject = {
        "canonicalParentSha": CANONICAL_PARENT_SHA,
        "evaluatorSha256": sha256_file(Path(__file__).resolve()),
        "frozenAtUtc": utc_now(),
        "holdoutMaximumOpenCount": 1,
        "officialSourceResearchSha256": sha256_file(PACKET / "OFFICIAL_SOURCE_RESEARCH.md"),
        "officialSourcesSha256": sha256_file(PACKET / "official_sources.v1.json"),
        "parentCommit": CANONICAL_PARENT_SHA,
        "preOutcomeCommit": pre_outcome_commit,
        "protocolSha256": sha256_file(PROTOCOL_PATH),
        "readmeSha256": sha256_file(PACKET / "README.md"),
        "schema": "VG22FreezeV1",
        "sourceManifestSha256": sha256_file(SOURCE_MANIFEST_PATH),
        "sourceRoot": EXPECTED_SOURCE_ROOT,
        "splitPlanSha256": split_plan_sha256,
        "testsSha256": sha256_file(PACKET / "test_experiment.py"),
        "trialFamilySha256": trial_family_sha256,
    }
    write_json_once(FREEZE_PATH, value)
    return value


def verify_sidecar(sidecar: bytes, archive_name: str, archive_sha: str) -> None:
    try:
        line = sidecar.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise ContractError(f"non-ASCII checksum sidecar for {archive_name}") from exc
    fields = line.split()
    if len(fields) != 2:
        raise ContractError(f"invalid checksum grammar for {archive_name}")
    advertised, filename = fields
    if advertised.lower() != archive_sha:
        raise ContractError(f"official checksum mismatch for {archive_name}")
    if filename.lstrip("*") != archive_name:
        raise ContractError(f"checksum filename mismatch for {archive_name}")


def inventory(state_root: Path) -> JsonObject:
    if any(
        path.exists()
        for path in (
            FREEZE_PATH,
            DEVELOPMENT_OPEN_PATH,
            HOLDOUT_OPEN_PATH,
            RUN_MARKER_PATH,
        )
    ):
        raise ContractError("inventory is forbidden after freeze or run authority exists")
    if SOURCE_MANIFEST_PATH.exists():
        raise ContractError("source manifest already exists")

    proto = protocol()
    expected_root = Path(cast(JsonObject, proto["data"])["sourceRoot"])
    if state_root.resolve() != expected_root.resolve():
        raise ContractError("state root differs from the frozen protocol")

    acquisition_path = state_root / "acquisition-manifest.v1.json"
    discovery_path = state_root / "discovery.v1.json"
    expected_acquisition = cast(JsonObject, proto["data"])["sourceAcquisitionManifestSha256"]
    expected_discovery = cast(JsonObject, proto["data"])["discoverySha256"]
    if sha256_file(acquisition_path) != expected_acquisition:
        raise ContractError("acquisition manifest digest mismatch")
    if sha256_file(discovery_path) != expected_discovery:
        raise ContractError("discovery digest mismatch")

    acquisition = load_json(acquisition_path)
    discovery = load_json(discovery_path)
    if (
        acquisition.get("schema") != "S1FAcquisitionManifestV1"
        or acquisition.get("state") != "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED"
        or acquisition.get("archiveBodiesDecompressed") is not False
    ):
        raise ContractError("acquisition manifest state is not admissible")
    artifact_pairs_value = acquisition.get("artifactPairs")
    if not isinstance(artifact_pairs_value, list) or not all(
        isinstance(row, dict) for row in artifact_pairs_value
    ):
        raise ContractError("acquisition artifact pairs are malformed")
    artifact_pairs = cast(list[JsonObject], artifact_pairs_value)
    if acquisition.get("artifactPairCount") != len(artifact_pairs):
        raise ContractError("acquisition artifact pair count mismatch")
    artifact_row_digests = [sha256_bytes(canonical_bytes(row)) for row in artifact_pairs]
    if acquisition.get("artifactRowsSha256") != sha256_bytes(
        normalized_lines(artifact_row_digests)
    ):
        raise ContractError("acquisition artifact pair digest mismatch")
    acquisition_absent_value = acquisition.get("absentSymbolMonths")
    if not isinstance(acquisition_absent_value, list) or not all(
        isinstance(item, str) for item in acquisition_absent_value
    ):
        raise ContractError("acquisition absent universe-month rows are malformed")
    acquisition_absent = cast(list[str], acquisition_absent_value)
    if acquisition_absent != sorted(set(acquisition_absent)):
        raise ContractError("acquisition absent universe-month rows are not sorted unique")
    if acquisition.get("absentSymbolMonthCount") != len(acquisition_absent):
        raise ContractError("acquisition absent universe-month count mismatch")
    if acquisition.get("absentSha256") != sha256_bytes(normalized_lines(acquisition_absent)):
        raise ContractError("acquisition absent universe-month digest mismatch")

    universe_obj = cast(JsonObject, discovery["universe"])
    symbols = tuple(cast(list[str], universe_obj["symbols"]))
    if len(symbols) != len(set(symbols)) or tuple(sorted(symbols)) != symbols:
        raise ContractError("frozen discovery universe is not unique and sorted")
    universe = set(symbols)

    data = cast(JsonObject, proto["data"])
    months = set(cast(list[str], data["developmentArchiveMonths"]))
    months.update(cast(list[str], data["holdoutWarmupArchiveMonths"]))
    months.update(cast(list[str], data["holdoutArchiveMonths"]))
    records: list[JsonObject] = []
    seen: set[tuple[str, str]] = set()
    relevant_sources = [
        source
        for source in artifact_pairs
        if source.get("symbol") in universe and source.get("month") in months
    ]
    if any(set(source) != set(ACQUISITION_PAIR_FIELDS) for source in relevant_sources):
        raise ContractError("filtered acquisition pair fields drifted")
    expected_pairs = sorted(
        (
            {field: source[field] for field in ACQUISITION_PAIR_FIELDS}
            for source in relevant_sources
        ),
        key=lambda row: (cast(str, row["symbol"]), cast(str, row["month"])),
    )
    for source in expected_pairs:
        symbol = cast(str, source["symbol"])
        month = cast(str, source["month"])
        identity = (symbol, month)
        if identity in seen:
            raise ContractError(f"duplicate acquisition pair {symbol} {month}")
        seen.add(identity)
        archive_name = f"{symbol}-1d-{month}.zip"
        pair_dir = state_root / "archives" / symbol / month
        archive_path = pair_dir / archive_name
        sidecar_path = pair_dir / f"{archive_name}.CHECKSUM"
        pair_path = pair_dir / "pair.v1.json"
        archive_raw = archive_path.read_bytes()
        sidecar_raw = sidecar_path.read_bytes()
        pair_raw = pair_path.read_bytes()
        archive_sha = sha256_bytes(archive_raw)
        sidecar_sha = sha256_bytes(sidecar_raw)
        if archive_sha != source["zipSha256"]:
            raise ContractError(f"archive digest mismatch for {symbol} {month}")
        if sidecar_sha != source["checksumSha256"]:
            raise ContractError(f"sidecar digest mismatch for {symbol} {month}")
        if len(archive_raw) != source["zipBytes"]:
            raise ContractError(f"archive byte length mismatch for {symbol} {month}")
        if len(sidecar_raw) != source["checksumBytes"]:
            raise ContractError(f"sidecar byte length mismatch for {symbol} {month}")
        verify_sidecar(sidecar_raw, archive_name, archive_sha)
        pair_value = json.loads(pair_raw)
        if not isinstance(pair_value, dict):
            raise ContractError(f"invalid pair manifest for {symbol} {month}")
        pair_expected_fields = {
            field: source[field]
            for field in ACQUISITION_PAIR_FIELDS
            if field not in {"checksumBytes", "state", "zipBytes"}
        }
        if pair_value.get("schema") != "S1FLocalArchivePairV1" or any(
            pair_value.get(field) != value for field, value in pair_expected_fields.items()
        ):
            raise ContractError(f"pair manifest binding mismatch for {symbol} {month}")
        key = cast(str, source["zipKey"])
        records.append(
            {
                **source,
                "checksumPath": str(sidecar_path),
                "checksumUrl": f"https://data.binance.vision/{source['checksumKey']}",
                "pairBytes": len(pair_raw),
                "pairPath": str(pair_path),
                "pairSha256": sha256_bytes(pair_raw),
                "zipPath": str(archive_path),
                "zipUrl": f"https://data.binance.vision/{key}",
            }
        )
    records.sort(key=lambda row: (cast(str, row["symbol"]), cast(str, row["month"])))
    if not records:
        raise ContractError("no admitted source records")
    actual_pairs = [{field: row[field] for field in ACQUISITION_PAIR_FIELDS} for row in records]
    expected_pair_digest = sha256_bytes(
        normalized_lines(sha256_bytes(canonical_bytes(row)) for row in expected_pairs)
    )
    actual_pair_digest = sha256_bytes(
        normalized_lines(sha256_bytes(canonical_bytes(row)) for row in actual_pairs)
    )
    if actual_pairs != expected_pairs or actual_pair_digest != expected_pair_digest:
        raise ContractError("local source records differ from filtered acquisition pairs")
    relevant_absent: list[str] = []
    for item in acquisition_absent:
        fields = item.split("|")
        if len(fields) != 2:
            raise ContractError("acquisition absent universe-month identity is malformed")
        absent_symbol, absent_month = fields
        if absent_symbol in universe and absent_month in months:
            relevant_absent.append(item)
    expected_universe_months = {f"{symbol}|{month}" for symbol in symbols for month in months}
    present_universe_months = {
        f"{cast(str, row['symbol'])}|{cast(str, row['month'])}" for row in expected_pairs
    }
    if (
        present_universe_months & set(relevant_absent)
        or present_universe_months | set(relevant_absent) != expected_universe_months
    ):
        raise ContractError("acquisition present/absent universe-month coverage differs")
    absent_digest = sha256_bytes(normalized_lines(relevant_absent))
    month_counts = {
        month: sum(1 for row in records if row["month"] == month) for month in sorted(months)
    }
    symbol_count = len({cast(str, row["symbol"]) for row in records})
    normalized_digest = sha256_bytes(canonical_bytes(records))
    manifest = {
        "acquisitionManifestBytes": acquisition_path.stat().st_size,
        "acquisitionManifestSha256": expected_acquisition,
        "archiveBodiesOpened": False,
        "authenticatedAtUtc": utc_now(),
        "discoveryBytes": discovery_path.stat().st_size,
        "discoverySha256": expected_discovery,
        "expectedAcquisitionPairCount": len(expected_pairs),
        "expectedAcquisitionPairSetSha256": expected_pair_digest,
        "actualAcquisitionPairCount": len(actual_pairs),
        "actualAcquisitionPairSetSha256": actual_pair_digest,
        "acquisitionPairSetExactEquality": True,
        "absentUniverseMonthCount": len(relevant_absent),
        "absentUniverseMonthSha256": absent_digest,
        "absentUniverseMonths": relevant_absent,
        "interval": "1d",
        "monthCounts": month_counts,
        "normalizedRecordSha256": normalized_digest,
        "recordCount": len(records),
        "records": records,
        "schema": "VG22SourceManifestV1",
        "sourceAcquisitionCompletedAtUtc": acquisition.get("completedAtUtc"),
        "sourceRoot": str(state_root.resolve()),
        "symbolCount": symbol_count,
        "universeCount": len(symbols),
        "universeSha256": universe_obj["sha256"],
    }
    write_json_once(SOURCE_MANIFEST_PATH, manifest)
    return manifest


def verify_freeze() -> JsonObject:
    freeze = load_json(FREEZE_PATH)
    if freeze.get("schema") != "VG22FreezeV1":
        raise ContractError("unexpected freeze schema")
    proto = protocol()
    expected: dict[str, Path] = {
        "evaluatorSha256": Path(__file__).resolve(),
        "officialSourceResearchSha256": PACKET / "OFFICIAL_SOURCE_RESEARCH.md",
        "officialSourcesSha256": PACKET / "official_sources.v1.json",
        "protocolSha256": PROTOCOL_PATH,
        "readmeSha256": PACKET / "README.md",
        "sourceManifestSha256": SOURCE_MANIFEST_PATH,
        "testsSha256": PACKET / "test_experiment.py",
    }
    for field_name, path in expected.items():
        if freeze.get(field_name) != sha256_file(path):
            raise ContractError(f"freeze mismatch: {field_name}")
    if freeze.get("canonicalParentSha") != CANONICAL_PARENT_SHA:
        raise ContractError("freeze canonical parent mismatch")
    if (
        not isinstance(freeze.get("preOutcomeCommit"), str)
        or COMMIT_RE.fullmatch(cast(str, freeze["preOutcomeCommit"])) is None
    ):
        raise ContractError("freeze pre-outcome commit is malformed")
    freeze_bindings = cast(JsonObject, cast(JsonObject, proto["lifecycle"])["freezeBindings"])
    if (
        freeze.get("parentCommit") != CANONICAL_PARENT_SHA
        or freeze.get("trialFamilySha256") != freeze_bindings["expectedTrialFamilySha256"]
        or freeze.get("trialFamilySha256")
        != sha256_bytes(canonical_bytes(trial_family_binding(proto)))
    ):
        raise ContractError("freeze trial family mismatch")
    if freeze.get("splitPlanSha256") != freeze_bindings["expectedSplitPlanSha256"] or freeze.get(
        "splitPlanSha256"
    ) != sha256_bytes(canonical_bytes(split_plan_binding(proto))):
        raise ContractError("freeze split plan mismatch")
    if freeze.get("sourceRoot") != proto["data"]["sourceRoot"]:
        raise ContractError("freeze source root mismatch")
    if freeze.get("holdoutMaximumOpenCount") != 1:
        raise ContractError("freeze holdout authority mismatch")
    return freeze


def manifest_records(months: set[str]) -> tuple[JsonObject, ...]:
    manifest = load_json(SOURCE_MANIFEST_PATH)
    if manifest.get("schema") != "VG22SourceManifestV1":
        raise ContractError("unexpected source manifest schema")
    if manifest.get("archiveBodiesOpened") is not False:
        raise ContractError("source manifest must predate archive-body access")
    records = cast(list[JsonObject], manifest["records"])
    selected = tuple(row for row in records if row["month"] in months)
    if not selected:
        raise ContractError("partition has no source records")
    return selected


def parse_archive(record: JsonObject) -> tuple[list[Bar], JsonObject]:
    symbol = cast(str, record["symbol"])
    month = cast(str, record["month"])
    archive_path = Path(cast(str, record["zipPath"]))
    try:
        archive_raw = archive_path.read_bytes()
    except OSError as exc:
        raise MeasurementError(f"archive unavailable: {symbol} {month}") from exc
    if len(archive_raw) != record["zipBytes"]:
        raise MeasurementError(f"archive length changed: {symbol} {month}")
    if sha256_bytes(archive_raw) != record["zipSha256"]:
        raise MeasurementError(f"archive digest changed: {symbol} {month}")
    expected_member = f"{symbol}-1d-{month}.csv"
    try:
        with zipfile.ZipFile(io.BytesIO(archive_raw), "r") as archive:
            members = [item for item in archive.infolist() if not item.is_dir()]
            if len(members) != 1 or members[0].filename != expected_member:
                raise MeasurementError(f"unexpected ZIP member for {symbol} {month}")
            raw_csv = archive.read(members[0])
    except zipfile.BadZipFile as exc:
        raise MeasurementError(f"invalid ZIP archive: {symbol} {month}") from exc
    try:
        text = raw_csv.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise MeasurementError(f"non-UTF8 CSV for {symbol} {month}") from exc

    valid: list[Bar] = []
    internal_missing_day_count = 0
    invalid_value_row_count = 0
    raw_count = 0
    previous_raw_day: date | None = None
    previous_valid_day: date | None = None
    for row in csv.reader(io.StringIO(text)):
        raw_count += 1
        if len(row) != 12:
            raise MeasurementError(f"wrong kline field count for {symbol} {month}")
        try:
            open_us = int(row[0])
            close_us = int(row[6])
            open_price = Decimal(row[1])
            high = Decimal(row[2])
            low = Decimal(row[3])
            close = Decimal(row[4])
            quote_volume = Decimal(row[7])
        except (ValueError, ArithmeticError) as exc:
            raise MeasurementError(f"invalid kline scalar for {symbol} {month}") from exc
        if open_us < 1_000_000_000_000_000 or close_us < 1_000_000_000_000_000:
            raise MeasurementError(f"2025+ timestamp is not microseconds: {symbol} {month}")
        if open_us % DAY_US != 0:
            raise MeasurementError(f"daily open is not UTC midnight: {symbol} {month}")
        if close_us != open_us + DAY_US - 1:
            raise MeasurementError(f"invalid daily close boundary: {symbol} {month}")
        day = date(1970, 1, 1) + timedelta(days=open_us // DAY_US)
        if day.strftime("%Y-%m") != month:
            raise MeasurementError(f"row month mismatch: {symbol} {month}")
        if previous_raw_day is not None and day <= previous_raw_day:
            raise MeasurementError(f"duplicate or unsorted raw open time: {symbol} {month}")
        previous_raw_day = day
        if (
            min(open_price, high, low, close) <= ZERO
            or quote_volume <= ZERO
            or high < max(open_price, close)
            or low > min(open_price, close)
        ):
            invalid_value_row_count += 1
            continue
        if previous_valid_day is not None:
            internal_missing_day_count += (day - previous_valid_day).days - 1
        previous_valid_day = day
        valid.append(Bar(day, open_price, high, low, close, quote_volume))
    if raw_count == 0:
        raise MeasurementError(f"empty archive: {symbol} {month}")
    summary: JsonObject = {
        "csvBytes": len(raw_csv),
        "firstValidDay": None if not valid else valid[0].day.isoformat(),
        "internalMissingDayCount": internal_missing_day_count,
        "invalidValueRowCount": invalid_value_row_count,
        "lastValidDay": None if not valid else valid[-1].day.isoformat(),
        "month": month,
        "partialRowCount": 0,
        "rawRowCount": raw_count,
        "symbol": symbol,
        "validRowCount": len(valid),
        "zipSha256": record["zipSha256"],
    }
    return valid, summary


def load_bars(months: set[str]) -> tuple[dict[str, dict[date, Bar]], list[JsonObject]]:
    by_symbol: dict[str, dict[date, Bar]] = {}
    summaries: list[JsonObject] = []
    for record in manifest_records(months):
        rows, summary = parse_archive(record)
        symbol = cast(str, record["symbol"])
        symbol_rows = by_symbol.setdefault(symbol, {})
        for bar in rows:
            if bar.day in symbol_rows:
                raise MeasurementError(f"duplicate full bar across archives: {symbol} {bar.day}")
            symbol_rows[bar.day] = bar
        summaries.append(summary)
    partition_missing_days: dict[str, int] = {}
    for symbol, series in sorted(by_symbol.items()):
        ordered_days = sorted(series)
        partition_missing_days[symbol] = sum(
            (current - previous).days - 1 for previous, current in itertools.pairwise(ordered_days)
        )
    for summary in summaries:
        summary["partitionMissingDayCount"] = partition_missing_days[cast(str, summary["symbol"])]
    summaries.sort(key=lambda row: (cast(str, row["symbol"]), cast(str, row["month"])))
    return by_symbol, summaries


def previous_days(current: date, count: int) -> list[date]:
    return [current - timedelta(days=offset) for offset in range(count, 0, -1)]


def empirical_tercile(values: Sequence[Decimal], numerator: int) -> Decimal:
    """Return the frozen lower empirical 1/3 or 2/3 threshold."""

    if not values or numerator not in (1, 2):
        raise ContractError("empirical tercile requires values and numerator 1 or 2")
    ordered = sorted(values)
    index = ((len(ordered) - 1) * numerator) // 3
    return ordered[index]


def quote_volume_regime(
    series: Mapping[date, Bar],
    current_day: date,
    lookback: int,
) -> int:
    """Classify one closed bar using only the window strictly before that bar."""

    history_days = previous_days(current_day, lookback)
    if any(day not in series for day in history_days):
        raise ContractError("regime classifier received incomplete prior history")
    history = [series[day].quote_volume for day in history_days]
    lower = empirical_tercile(history, 1)
    upper = empirical_tercile(history, 2)
    current_volume = series[current_day].quote_volume
    if current_volume <= lower:
        return 0
    if current_volume <= upper:
        return 1
    return 2


def select_assets(
    bars: dict[str, dict[date, Bar]],
    signal_day: date,
    trial: Trial,
) -> tuple[list[SelectedAsset], int]:
    risk: list[SelectedAsset] = []
    required = max(trial.lookback + 1, 30)
    history_days = previous_days(signal_day, required)
    for symbol in sorted(bars):
        series = bars[symbol]
        current = series.get(signal_day)
        if current is None:
            continue
        if any(day not in series for day in history_days):
            continue
        prior_30 = [series[day].quote_volume for day in history_days[-30:]]
        prior_adv = statistics.median(prior_30)
        previous = series[signal_day - timedelta(days=1)]
        if prior_adv < MIN_ADV or current.quote_volume <= ZERO or previous.quote_volume <= ZERO:
            continue
        previous_regime = quote_volume_regime(
            series,
            signal_day - timedelta(days=1),
            trial.lookback,
        )
        current_regime = quote_volume_regime(series, signal_day, trial.lookback)
        gap = current_regime - previous_regime
        close_ratio = current.close / previous.close
        quote_volume_ratio = current.quote_volume / previous.quote_volume
        risk.append(
            SelectedAsset(
                symbol,
                previous_regime,
                current_regime,
                gap,
                quote_volume_ratio,
                close_ratio,
                prior_adv,
            )
        )
    risk_count = len(risk)
    positive = [
        asset for asset in risk if asset.regime_gap >= trial.min_gap and asset.close_ratio > ONE
    ]
    positive.sort(
        key=lambda item: (
            -item.regime_gap,
            -item.quote_volume_ratio,
            -item.close_ratio,
            item.symbol.encode("utf-8"),
        )
    )
    if risk_count < 20 or len(positive) < 3:
        return [], risk_count
    return positive[:5], risk_count


def sell_value(position: Position, raw_exit: Decimal, adverse: Decimal) -> Decimal:
    adverse_exit = raw_exit * (ONE - adverse)
    return position.quantity * adverse_exit * (ONE - FEE_RATE)


def trade_accounting(
    position: Position,
    raw_exit: Decimal,
    adverse: Decimal,
) -> TradeAccounting:
    gross_final = position.allocation * raw_exit / position.raw_entry
    after_entry_fee = gross_final * (ONE - FEE_RATE)
    after_exit_fee = after_entry_fee * (ONE - FEE_RATE)
    actual_final = sell_value(position, raw_exit, adverse)
    gross_pnl = gross_final - position.allocation
    entry_fee_cost = gross_final - after_entry_fee
    exit_fee_cost = after_entry_fee - after_exit_fee
    adverse_cost = after_exit_fee - actual_final
    net_pnl = actual_final - position.allocation
    identity = gross_pnl - entry_fee_cost - exit_fee_cost - adverse_cost
    if abs(identity - net_pnl) > Decimal("0.00000000000000000001"):
        raise ContractError("trade accounting identity failed")
    return TradeAccounting(
        position.symbol,
        position.allocation,
        gross_pnl,
        entry_fee_cost,
        exit_fee_cost,
        adverse_cost,
        net_pnl,
    )


def simulate(
    bars: dict[str, dict[date, Bar]],
    trial: Trial,
    start: date,
    end: date,
    adverse: Decimal,
    cost_label: str,
) -> Simulation:
    sleeves = [Sleeve(INITIAL_USD / trial.hold_days) for _ in range(trial.hold_days)]
    daily_nav: list[tuple[date, Decimal]] = []
    daily_returns: list[tuple[date, float]] = []
    accounts: list[TradeAccounting] = []
    valid_cohort_days = 0
    selected_allocations = 0
    skipped_entries = 0
    capacity_scales: list[Decimal] = []
    previous_nav = INITIAL_USD

    for current in days(start, end):
        sleeve_index = current.toordinal() % trial.hold_days
        sleeve = sleeves[sleeve_index]
        if sleeve.positions:
            if any(position.exit_day != current for position in sleeve.positions):
                raise ContractError("sleeve reuse before the frozen exit day")
            for position in sleeve.positions:
                exit_bar = bars.get(position.symbol, {}).get(current)
                if exit_bar is None:
                    raise MeasurementError(
                        f"missing successful exit: {position.symbol} {current.isoformat()}"
                    )
                accounting = trade_accounting(position, exit_bar.open, adverse)
                sleeve.cash += position.allocation + accounting.net_pnl
                accounts.append(accounting)
            sleeve.positions.clear()

        latest_entry = end - timedelta(days=trial.hold_days)
        if current <= latest_entry:
            signal_day = current - timedelta(days=1)
            selected, risk_count = select_assets(bars, signal_day, trial)
            if risk_count >= 20:
                valid_cohort_days += 1
            if selected:
                selected_allocations += len(selected)
                entrants = [(asset, bars.get(asset.symbol, {}).get(current)) for asset in selected]
                available = [
                    (asset, entry_bar) for asset, entry_bar in entrants if entry_bar is not None
                ]
                if len(available) != len(selected):
                    skipped_entries += len(selected)
                    available = []
                allocation = sleeve.cash / len(available) if available else ZERO
                for asset, entry_bar in available:
                    adverse_entry = entry_bar.open * (ONE + adverse)
                    quantity = allocation * (ONE - FEE_RATE) / adverse_entry
                    sleeve.cash -= allocation
                    sleeve.positions.append(
                        Position(
                            symbol=asset.symbol,
                            allocation=allocation,
                            quantity=quantity,
                            raw_entry=entry_bar.open,
                            adverse_entry=adverse_entry,
                            exit_day=current + timedelta(days=trial.hold_days),
                            prior_adv=asset.prior_adv,
                        )
                    )
                    capacity_scales.append(
                        asset.prior_adv * PARTICIPATION / allocation
                        if allocation > ZERO
                        else Decimal("Infinity")
                    )

        nav = ZERO
        for current_sleeve in sleeves:
            nav += current_sleeve.cash
            for position in current_sleeve.positions:
                mark = bars.get(position.symbol, {}).get(current)
                if mark is None:
                    raise MeasurementError(
                        f"missing mark while position open: {position.symbol} {current}"
                    )
                nav += sell_value(position, mark.close, adverse)
        daily_nav.append((current, nav))
        daily_return = float(nav / previous_nav - ONE)
        daily_returns.append((current, daily_return))
        previous_nav = nav

    if any(sleeve.positions for sleeve in sleeves):
        raise ContractError("partition ended with an open position")
    final_nav = sum((sleeve.cash for sleeve in sleeves), ZERO)
    if abs(final_nav - daily_nav[-1][1]) > Decimal("0.00000000000000000001"):
        raise ContractError("terminal NAV reconciliation failed")

    gross = sum((item.gross_pnl for item in accounts), ZERO)
    entry_fees = sum((item.entry_fee_cost for item in accounts), ZERO)
    exit_fees = sum((item.exit_fee_cost for item in accounts), ZERO)
    adverse_cost = sum((item.adverse_execution_cost for item in accounts), ZERO)
    net = final_nav - INITIAL_USD
    if abs(gross - entry_fees - exit_fees - adverse_cost - net) > Decimal("0.000001"):
        raise ContractError("portfolio accounting identity failed")

    peak = INITIAL_USD
    maximum_drawdown = ZERO
    for _, nav in daily_nav:
        if nav > peak:
            peak = nav
        drawdown = (peak - nav) / peak
        maximum_drawdown = max(maximum_drawdown, drawdown)

    positive_gross = [item for item in accounts if item.gross_pnl > ZERO]
    total_positive = sum((item.gross_pnl for item in positive_gross), ZERO)
    if total_positive > ZERO:
        by_asset: dict[str, Decimal] = {}
        for item in positive_gross:
            by_asset[item.symbol] = by_asset.get(item.symbol, ZERO) + item.gross_pnl
        top_asset_share = max(by_asset.values()) / total_positive
        top_five_share = (
            sum(sorted((item.gross_pnl for item in positive_gross), reverse=True)[:5], ZERO)
            / total_positive
        )
    else:
        top_asset_share = ONE
        top_five_share = ONE
    capacity = None
    if capacity_scales:
        capacity = INITIAL_USD * min(capacity_scales)

    return Simulation(
        trial=trial,
        cost_label=cost_label,
        final_nav=final_nav,
        net_usd=net,
        gross_pnl=gross,
        entry_fee_cost=entry_fees,
        exit_fee_cost=exit_fees,
        adverse_execution_cost=adverse_cost,
        daily_nav=daily_nav,
        daily_returns=daily_returns,
        max_drawdown=maximum_drawdown,
        valid_cohort_days=valid_cohort_days,
        selected_allocations=selected_allocations,
        skipped_entries=skipped_entries,
        round_trips=len(accounts),
        distinct_assets={item.symbol for item in accounts},
        capacity_proxy_nominal_usdt=capacity,
        top_asset_gross_profit_share=top_asset_share,
        top_five_trade_gross_profit_share=top_five_share,
    )


def simulation_mapping(simulation: Simulation, *, include_series: bool) -> JsonObject:
    coverage = (
        None
        if simulation.selected_allocations == 0
        else Decimal(simulation.round_trips) / Decimal(simulation.selected_allocations)
    )
    value: JsonObject = {
        "accountEffectiveFee": "UNKNOWN",
        "adverseExecutionScenarioPerSideBps": (10 if simulation.cost_label == "BASE" else 25),
        "adverseExecutionCostUsd": exact_decimal(simulation.adverse_execution_cost),
        "allInPublicScenarioPerSideBps": (20 if simulation.cost_label == "BASE" else 35),
        "capacityProxyLabel": "PRIOR_30D_QUOTE_VOLUME_ONE_BP_PARTICIPATION_PROXY",
        "capacityProxyNominalUsdt": (
            None
            if simulation.capacity_proxy_nominal_usdt is None
            else exact_decimal(simulation.capacity_proxy_nominal_usdt, 2)
        ),
        "costLabel": simulation.cost_label,
        "distinctAssetCount": len(simulation.distinct_assets),
        "entryCoverage": None if coverage is None else exact_decimal(coverage, 6),
        "entryFeeCostUsd": exact_decimal(simulation.entry_fee_cost),
        "executableCapacity": "UNMEASURED",
        "exitFeeCostUsd": exact_decimal(simulation.exit_fee_cost),
        "finalNavUsd": exact_decimal(simulation.final_nav),
        "grossPricePnlUsd": exact_decimal(simulation.gross_pnl),
        "historicalSpreadImpact": "UNMEASURED",
        "maximumDrawdown": exact_decimal(simulation.max_drawdown, 8),
        "netUsdPer1000": exact_decimal(simulation.net_usd),
        "roundTripCount": simulation.round_trips,
        "selectedAllocationCount": simulation.selected_allocations,
        "skippedEntryCount": simulation.skipped_entries,
        "topAssetGrossProfitShare": exact_decimal(simulation.top_asset_gross_profit_share, 8),
        "topFiveTradeGrossProfitShare": exact_decimal(
            simulation.top_five_trade_gross_profit_share, 8
        ),
        "orderBookDataUsed": False,
        "orderBookInference": "NONE",
        "publicFeeScenarioPerSideBps": 10,
        "validCohortDayCount": simulation.valid_cohort_days,
    }
    if include_series:
        value["dailyNav"] = [
            {"date": day.isoformat(), "navUsd": exact_decimal(nav)}
            for day, nav in simulation.daily_nav
        ]
        value["dailyReturns"] = [
            {"date": day.isoformat(), "return": format(value_float, ".17g")}
            for day, value_float in simulation.daily_returns
        ]
    return value


def circular_draw_indices(
    count: int,
    block_length: int,
    rng: random.Random,
) -> list[int]:
    result: list[int] = []
    while len(result) < count:
        start = rng.randrange(count)
        for offset in range(block_length):
            result.append((start + offset) % count)
            if len(result) == count:
                break
    return result


def compounded_net(values: Sequence[float]) -> float:
    nav = 1000.0
    for value in values:
        nav *= 1.0 + value
    return nav - 1000.0


def percentile(values: list[float], probability: float) -> float:
    if not values:
        raise ContractError("percentile requires values")
    values.sort()
    index = max(0, min(len(values) - 1, math.ceil(probability * len(values)) - 1))
    return values[index]


def bootstrap_report(values: Sequence[float], seed_offset: int = 0) -> JsonObject:
    if len(values) < BOOTSTRAP_BLOCK:
        return {
            "lowerNetUsdPer1000": None,
            "oneSidedPValue": None,
            "reason": "INSUFFICIENT_DAILY_RETURNS",
            "status": "UNAVAILABLE",
            "upperNetUsdPer1000": None,
        }
    rng = random.Random(BOOTSTRAP_SEED + seed_offset)
    mean_value = statistics.fmean(values)
    centered = [value - mean_value for value in values]
    nets: list[float] = []
    exceed = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_draw_indices(len(values), BOOTSTRAP_BLOCK, rng)
        sample = [values[index] for index in indices]
        nets.append(compounded_net(sample))
        centered_mean = statistics.fmean(centered[index] for index in indices)
        if centered_mean >= mean_value:
            exceed += 1
    return {
        "blockLengthDays": BOOTSTRAP_BLOCK,
        "coveragePerMyriad": 9500,
        "lowerNetUsdPer1000": format(percentile(nets.copy(), 0.025), ".10f"),
        "oneSidedPValue": format((exceed + 1) / (BOOTSTRAP_REPLICATES + 1), ".10f"),
        "pointNetUsdPer1000": format(compounded_net(values), ".10f"),
        "replicates": BOOTSTRAP_REPLICATES,
        "seed": BOOTSTRAP_SEED + seed_offset,
        "status": "AVAILABLE",
        "upperNetUsdPer1000": format(percentile(nets.copy(), 0.975), ".10f"),
    }


def holm_report(p_values: dict[str, float]) -> JsonObject:
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    decisions: list[JsonObject] = []
    still_rejecting = True
    rejected: list[str] = []
    running_adjusted = 0.0
    count = len(ordered)
    for rank, (trial_id, p_value) in enumerate(ordered, start=1):
        threshold = ALPHA / (count - rank + 1)
        running_adjusted = max(running_adjusted, min(1.0, p_value * (count - rank + 1)))
        selected = still_rejecting and p_value < threshold
        if selected:
            rejected.append(trial_id)
        else:
            still_rejecting = False
        decisions.append(
            {
                "adjustedPValue": format(running_adjusted, ".10f"),
                "rawPValue": format(p_value, ".10f"),
                "rejected": selected,
                "threshold": format(threshold, ".10f"),
                "trialId": trial_id,
            }
        )
    return {
        "alpha": format(ALPHA, ".2f"),
        "decisions": decisions,
        "rejectedTrialIds": sorted(rejected),
        "testedCount": count,
    }


def white_reality_check(
    matrix: Mapping[str, Sequence[float]],
) -> JsonObject:
    ordered_ids = sorted(matrix)
    lengths = {len(matrix[trial_id]) for trial_id in ordered_ids}
    if len(lengths) != 1 or not lengths or next(iter(lengths)) < BOOTSTRAP_BLOCK:
        return {"pValue": None, "reason": "MATRIX_SHAPE_INVALID", "status": "UNAVAILABLE"}
    count = next(iter(lengths))
    means = {trial_id: statistics.fmean(matrix[trial_id]) for trial_id in ordered_ids}
    observed = max(means.values())
    centered = {
        trial_id: [value - means[trial_id] for value in matrix[trial_id]]
        for trial_id in ordered_ids
    }
    rng = random.Random(BOOTSTRAP_SEED + 90_000)
    exceed = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = circular_draw_indices(count, BOOTSTRAP_BLOCK, rng)
        bootstrap_max = max(
            statistics.fmean(centered[trial_id][index] for index in indices)
            for trial_id in ordered_ids
        )
        if bootstrap_max >= observed:
            exceed += 1
    return {
        "observedMaximumMeanDailyReturn": format(observed, ".17g"),
        "pValue": format((exceed + 1) / (BOOTSTRAP_REPLICATES + 1), ".10f"),
        "replicates": BOOTSTRAP_REPLICATES,
        "status": "AVAILABLE",
        "testedCount": len(ordered_ids),
    }


def frozen_selection_key(trial_id: str, score: float) -> tuple[float, int, int, int, str]:
    candidate = {trial.trial_id: trial for trial in trials()}.get(trial_id)
    if candidate is None:
        raise ContractError("selection score names a trial outside the frozen family")
    return (
        -score,
        candidate.hold_days,
        -candidate.lookback,
        -candidate.min_gap,
        candidate.trial_id,
    )


def pbo_report(matrix: Mapping[str, Sequence[float]]) -> JsonObject:
    ordered_ids = sorted(matrix)
    canonical_series = [
        {
            "dailyReturns": [format(value, ".17g") for value in matrix[trial_id]],
            "trialId": trial_id,
        }
        for trial_id in ordered_ids
    ]
    distinct_series_count = len(
        {canonical_bytes(cast(JsonObject, row)["dailyReturns"]) for row in canonical_series}
    )
    series_digest = sha256_bytes(canonical_bytes(canonical_series))
    series_evidence: JsonObject = {
        "canonicalDailyReturnSeriesSha256": series_digest,
        "distinctCanonicalDailyReturnSeriesCount": distinct_series_count,
    }
    if ordered_ids != sorted(trial.trial_id for trial in trials()):
        return {
            **series_evidence,
            "pbo": None,
            "reason": "TRIAL_FAMILY_INVALID",
            "status": "UNAVAILABLE",
        }
    lengths = {len(matrix[trial_id]) for trial_id in ordered_ids}
    if len(lengths) != 1 or not lengths:
        return {
            **series_evidence,
            "pbo": None,
            "reason": "MATRIX_SHAPE_INVALID",
            "status": "UNAVAILABLE",
        }
    if distinct_series_count < 2:
        return {
            **series_evidence,
            "diagnosticOnly": True,
            "pbo": None,
            "reason": "FEWER_THAN_TWO_DISTINCT_TRIAL_SERIES",
            "status": "UNAVAILABLE",
        }
    count = next(iter(lengths))
    if count < 8:
        return {
            **series_evidence,
            "pbo": None,
            "reason": "INSUFFICIENT_DAYS",
            "status": "UNAVAILABLE",
        }
    blocks: list[list[int]] = [[] for _ in range(8)]
    for index in range(count):
        block = min(7, index * 8 // count)
        blocks[block].append(index)
    underperform = 0
    degradations: list[float] = []
    rank_logits: list[float] = []
    split_count = 0
    for in_blocks in itertools.combinations(range(8), 4):
        split_count += 1
        in_set = set(in_blocks)
        in_indices = [index for block in in_set for index in blocks[block]]
        out_indices = [
            index for block in range(8) if block not in in_set for index in blocks[block]
        ]
        in_scores = {
            trial_id: compounded_net([matrix[trial_id][index] for index in in_indices])
            for trial_id in ordered_ids
        }
        champion = min(
            ordered_ids,
            key=lambda trial_id: frozen_selection_key(trial_id, in_scores[trial_id]),
        )
        out_scores = {
            trial_id: compounded_net([matrix[trial_id][index] for index in out_indices])
            for trial_id in ordered_ids
        }
        champion_out = out_scores[champion]
        rank = 1 + sum(1 for score in out_scores.values() if score < champion_out)
        percentile_rank = rank / (len(ordered_ids) + 1)
        if percentile_rank <= 0.5:
            underperform += 1
        clipped = min(max(percentile_rank, 1e-12), 1 - 1e-12)
        rank_logits.append(math.log(clipped / (1 - clipped)))
        degradations.append(out_scores[champion] - in_scores[champion])
    return {
        **series_evidence,
        "blockCount": 8,
        "diagnosticOnly": true_json(),
        "medianOosCompoundedNetDegradationUsdPer1000": format(
            statistics.median(degradations), ".10f"
        ),
        "medianRankLogit": format(statistics.median(rank_logits), ".10f"),
        "pbo": format(underperform / split_count, ".10f"),
        "selectionStatistic": "COMPOUNDED_NET_USD_PER_1000",
        "splitCount": split_count,
        "status": "AVAILABLE",
        "tieLaw": [
            "LOWER_HOLD_DAYS",
            "LARGER_LOOKBACK_DAYS",
            "LARGER_MINIMUM_REGIME_GAP",
            "LEXICOGRAPHIC_TRIAL_ID",
            "CONSERVATIVE_WORST_OOS_RANK_ON_TIES",
        ],
        "underperformCount": underperform,
    }


def true_json() -> bool:
    """Return a typed JSON boolean without truthy sentinel shortcuts."""

    return True


def concatenate_fold_returns(simulations: Sequence[Simulation]) -> list[float]:
    return [value for simulation in simulations for _, value in simulation.daily_returns]


def trial_ledger(
    rows_by_id: Mapping[str, JsonObject] | None,
    *,
    unavailable_reason: str | None = None,
) -> list[JsonObject]:
    ledger: list[JsonObject] = []
    for trial in trials():
        source = None if rows_by_id is None else rows_by_id.get(trial.trial_id)
        if source is None:
            if unavailable_reason is None:
                raise ContractError("trial ledger omitted a frozen member")
            status = "UNMEASURED"
            base_net: str | None = None
            stress_net: str | None = None
            gate_pass: bool | None = None
            bootstrap_status = "UNAVAILABLE"
            p_value: str | None = None
            round_trips: int | None = None
            valid_cohort_days: int | None = None
            distinct_assets: int | None = None
            failed_gates = [unavailable_reason]
        else:
            gate_pass = bool(source["developmentGatePass"])
            status = "MEASURED_GATE_PASS" if gate_pass else "MEASURED_GATE_FAIL"
            base_net = cast(str, source["developmentBaseNetUsdPer1000"])
            stress_net = cast(str, source["developmentStressNetUsdPer1000"])
            bootstrap = cast(JsonObject, source["bootstrap"])
            bootstrap_status = cast(str, bootstrap["status"])
            p_value = cast(str | None, bootstrap["oneSidedPValue"])
            gate_evidence = cast(JsonObject, source["gateEvidence"])
            round_trips = cast(int, gate_evidence["roundTripCount"])
            valid_cohort_days = cast(int, gate_evidence["validCohortDayCount"])
            distinct_assets = cast(int, gate_evidence["distinctAssetCount"])
            gates = cast(JsonObject, gate_evidence["gates"])
            failed_gates = sorted(name for name, passed in gates.items() if not passed)
        ledger.append(
            {
                "bootstrapStatus": bootstrap_status,
                "developmentBaseNetUsdPer1000": base_net,
                "developmentStressNetUsdPer1000": stress_net,
                "developmentGatePass": gate_pass,
                "distinctAssets": distinct_assets,
                "failedGates": failed_gates,
                "holdDays": trial.hold_days,
                "lookbackDays": trial.lookback,
                "minimumRegimeGap": trial.min_gap,
                "pValueOrNull": p_value,
                "roundTrips": round_trips,
                "status": status,
                "trialId": trial.trial_id,
                "validCohortDays": valid_cohort_days,
            }
        )
    if len(ledger) != 12 or [row["trialId"] for row in ledger] != [
        trial.trial_id for trial in trials()
    ]:
        raise ContractError("trial ledger is not the exact frozen family")
    return ledger


def not_estimable_mapping() -> JsonObject:
    return {
        "capacityProxyLabel": "PRIOR_30D_QUOTE_VOLUME_ONE_BP_PARTICIPATION_PROXY",
        "capacityProxyNominalUsdt": None,
        "executableCapacity": "UNMEASURED",
        "historicalSpreadImpact": "UNMEASURED",
        "maximumDrawdown": None,
        "netUsdPer1000": None,
        "orderBookDataUsed": False,
        "orderBookInference": "NONE",
        "status": "NOT_ESTIMABLE",
    }


def write_terminal_marker(
    *,
    result: JsonObject,
    holdout_open_count: int,
    trial_ledger_sha256: str,
) -> JsonObject:
    if holdout_open_count not in (0, 1):
        raise ContractError("terminal holdout count must be zero or one")
    marker: JsonObject = {
        "completedAtUtc": utc_now(),
        "developmentOpenSha256": sha256_file(DEVELOPMENT_OPEN_PATH),
        "developmentSha256": sha256_file(DEVELOPMENT_PATH),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holdoutOpenCount": holdout_open_count,
        "holdoutOpenSha256": (sha256_file(HOLDOUT_OPEN_PATH) if holdout_open_count == 1 else None),
        "resultSha256": sha256_file(RESULT_PATH),
        "schema": "VG22RunMarkerV1",
        "selectionSha256": (sha256_file(SELECTION_PATH) if SELECTION_PATH.exists() else None),
        "sourceManifestSha256": sha256_file(SOURCE_MANIFEST_PATH),
        "state": "COMPLETE",
        "trialLedgerSha256": trial_ledger_sha256,
        "verdict": result["verdict"],
    }
    write_json_once(RUN_MARKER_PATH, marker)
    return marker


def terminal_development_measurement_failure(error: MeasurementError) -> JsonObject:
    """Consume the run once and seal an honest pre-holdout UNMEASURED result."""

    development_open = load_json(DEVELOPMENT_OPEN_PATH)
    if development_open.get("schema") != "VG22DevelopmentOpenV1":
        raise ContractError("development-open receipt schema is invalid")
    if any(
        path.exists()
        for path in (
            DEVELOPMENT_PATH,
            SELECTION_PATH,
            HOLDOUT_OPEN_PATH,
            RESULT_PATH,
            RUN_MARKER_PATH,
        )
    ):
        raise ContractError("measurement failure collided with sealed evidence")

    reason = f"DEVELOPMENT_MEASUREMENT_ERROR:{error}"
    unavailable_pbo = {
        "canonicalDailyReturnSeriesSha256": sha256_bytes(canonical_bytes([])),
        "distinctCanonicalDailyReturnSeriesCount": 0,
        "diagnosticOnly": True,
        "pbo": None,
        "reason": "DEVELOPMENT_MEASUREMENT_ABORT",
        "status": "UNAVAILABLE",
    }
    ledger = trial_ledger(
        None,
        unavailable_reason="DEVELOPMENT_MEASUREMENT_ERROR",
    )
    ledger_sha256 = sha256_bytes(canonical_bytes(ledger))
    development: JsonObject = {
        "archiveBodyPartitionsOpened": ["DEVELOPMENT", "WARMUP"],
        "attemptedTrialCount": 12,
        "completedAtUtc": utc_now(),
        "completedTrialCount": 0,
        "developmentOpenSha256": sha256_file(DEVELOPMENT_OPEN_PATH),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "frozenTrialCount": 12,
        "pbo": unavailable_pbo,
        "reason": reason,
        "schema": "VG22DevelopmentV1",
        "selectionCreated": False,
        "status": "UNMEASURED",
        "trialLedger": ledger,
        "trialLedgerSha256": ledger_sha256,
        "trials": [],
    }
    write_json_once(DEVELOPMENT_PATH, development)

    not_estimable = not_estimable_mapping()
    result: JsonObject = {
        "accountEffectiveFee": "UNKNOWN",
        "archiveBodyPartitionsOpened": ["DEVELOPMENT", "WARMUP"],
        "authority": {
            "capital": "NONE",
            "consumer": "N3 successor/final convergence",
            "effectUsd": "0",
            "execution": "NONE",
            "orders": "NONE",
            "scope": "PUBLIC_RESEARCH_ONLY",
        },
        "base": not_estimable,
        "completedAtUtc": utc_now(),
        "developmentSha256": sha256_file(DEVELOPMENT_PATH),
        "failedFormalGates": ["MEASUREMENT"],
        "historicalSpreadImpact": "UNMEASURED",
        "holdoutOpenCount": 0,
        "lockedTrialId": None,
        "orderBookDataUsed": False,
        "orderBookInference": "NONE",
        "pbo": unavailable_pbo,
        "reason": reason,
        "schema": "VG22ResultV1",
        "selectionSha256": None,
        "stress": dict(not_estimable),
        "trialLedgerSha256": ledger_sha256,
        "verdict": "UNMEASURED",
    }
    write_json_once(RESULT_PATH, result)
    write_terminal_marker(
        result=result,
        holdout_open_count=0,
        trial_ledger_sha256=ledger_sha256,
    )
    return result


def development_command(state_root: Path) -> JsonObject:
    freeze = verify_freeze()
    if any(
        path.exists()
        for path in (
            DEVELOPMENT_OPEN_PATH,
            HOLDOUT_OPEN_PATH,
            RUN_MARKER_PATH,
            DEVELOPMENT_PATH,
            SELECTION_PATH,
            RESULT_PATH,
        )
    ):
        raise ContractError("development authority was already consumed")
    if str(state_root.resolve()) != freeze["sourceRoot"]:
        raise ContractError("state root differs from freeze")
    development_open: JsonObject = {
        "developmentOpenCount": 1,
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holdoutMaximumOpenCount": 1,
        "holdoutOpenCount": 0,
        "openedAtUtc": utc_now(),
        "schema": "VG22DevelopmentOpenV1",
        "sourceManifestSha256": sha256_file(SOURCE_MANIFEST_PATH),
    }
    write_json_once(DEVELOPMENT_OPEN_PATH, development_open)

    proto = protocol()
    months = set(cast(list[str], cast(JsonObject, proto["data"])["developmentArchiveMonths"]))
    bars, semantic_rows = load_bars(months)
    fold_specs = cast(
        list[JsonObject],
        cast(JsonObject, cast(JsonObject, proto["partitions"])["development"])["evaluationFolds"],
    )
    all_trials = trials()
    trial_rows: list[JsonObject] = []
    return_matrix: dict[str, list[float]] = {}
    p_values: dict[str, float] = {}
    trial_simulations: dict[str, list[Simulation]] = {}
    for trial_index, trial in enumerate(all_trials):
        base_folds: list[Simulation] = []
        stress_folds: list[Simulation] = []
        fold_rows: list[JsonObject] = []
        for fold in fold_specs:
            start = parse_day(cast(str, fold["startUtcDate"]))
            end = parse_day(cast(str, fold["endUtcDate"]))
            base = simulate(bars, trial, start, end, BASE_ADVERSE, "BASE")
            stress = simulate(bars, trial, start, end, STRESS_ADVERSE, "STRESS")
            base_folds.append(base)
            stress_folds.append(stress)
            fold_rows.append(
                {
                    "base": simulation_mapping(base, include_series=True),
                    "foldId": fold["id"],
                    "stress": simulation_mapping(stress, include_series=False),
                }
            )
        values = concatenate_fold_returns(base_folds)
        stress_values = concatenate_fold_returns(stress_folds)
        bootstrap = bootstrap_report(values, trial_index)
        raw_p = float(cast(str, bootstrap["oneSidedPValue"]))
        p_values[trial.trial_id] = raw_p
        return_matrix[trial.trial_id] = values
        trial_simulations[trial.trial_id] = base_folds
        median_fold_net = statistics.median(float(sim.net_usd) for sim in base_folds)
        development_base_net = compounded_net(values)
        development_stress_net = compounded_net(stress_values)
        trial_rows.append(
            {
                "bootstrap": bootstrap,
                "developmentBaseNetUsdPer1000": format(development_base_net, ".10f"),
                "developmentStressNetUsdPer1000": format(development_stress_net, ".10f"),
                "folds": fold_rows,
                "holdDays": trial.hold_days,
                "lookbackDays": trial.lookback,
                "medianFoldBaseNetUsdPer1000": format(median_fold_net, ".10f"),
                "minimumRegimeGap": trial.min_gap,
                "trialId": trial.trial_id,
            }
        )
    holm = holm_report(p_values)
    white = white_reality_check(return_matrix)
    pbo = pbo_report(return_matrix)
    rejected = set(cast(list[str], holm["rejectedTrialIds"]))
    white_pass = white["status"] == "AVAILABLE" and float(cast(str, white["pValue"])) < ALPHA
    for row in trial_rows:
        trial_id = cast(str, row["trialId"])
        simulations = trial_simulations[trial_id]
        bootstrap = cast(JsonObject, row["bootstrap"])
        valid_days = sum(sim.valid_cohort_days for sim in simulations)
        round_trips = sum(sim.round_trips for sim in simulations)
        assets = set().union(*(sim.distinct_assets for sim in simulations))
        positive_folds = sum(1 for sim in simulations if sim.net_usd > ZERO)
        gates = {
            "adjustedMultiplicity": trial_id in rejected,
            "bootstrapLowerBoundPositive": (
                bootstrap["status"] == "AVAILABLE"
                and float(cast(str, bootstrap["lowerNetUsdPer1000"])) > 0
            ),
            "distinctAssets": len(assets) >= 20,
            "positiveFolds": positive_folds >= 3,
            "roundTrips": round_trips >= 100,
            "stressNetPositive": float(cast(str, row["developmentStressNetUsdPer1000"])) > 0,
            "validCohortDays": valid_days >= 80,
            "whiteRealityCheck": white_pass,
        }
        row["developmentGatePass"] = all(gates.values())
        row["gateEvidence"] = {
            "distinctAssetCount": len(assets),
            "gates": gates,
            "positiveFoldCount": positive_folds,
            "roundTripCount": round_trips,
            "validCohortDayCount": valid_days,
        }

    ranked = sorted(
        trial_rows,
        key=lambda row: frozen_selection_key(
            cast(str, row["trialId"]),
            float(cast(str, row["developmentBaseNetUsdPer1000"])),
        ),
    )
    champion_row = ranked[0]
    by_id = {trial.trial_id: trial for trial in all_trials}
    development = {
        "archiveBodyPartitionsOpened": ["DEVELOPMENT", "WARMUP"],
        "attemptedTrialCount": len(all_trials),
        "completedAtUtc": utc_now(),
        "developmentOpenSha256": sha256_file(DEVELOPMENT_OPEN_PATH),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holm": holm,
        "pbo": pbo,
        "schema": "VG22DevelopmentV1",
        "selectionMetric": "COMPOUNDED_DEVELOPMENT_BASE_NET_USD_PER_1000",
        "semanticRowLedger": semantic_rows,
        "semanticRowLedgerSha256": sha256_bytes(canonical_bytes(semantic_rows)),
        "trials": trial_rows,
        "whiteRealityCheck": white,
    }
    rows_by_id = {cast(str, row["trialId"]): row for row in trial_rows}
    ledger = trial_ledger(rows_by_id)
    ledger_sha256 = sha256_bytes(canonical_bytes(ledger))
    development["trialLedger"] = ledger
    development["trialLedgerSha256"] = ledger_sha256
    write_json_once(DEVELOPMENT_PATH, development)
    selected_id = cast(str, champion_row["trialId"])
    selected_trial = by_id[selected_id]
    selection = {
        "champion": {
            "developmentGatePass": champion_row["developmentGatePass"],
            "developmentBaseNetUsdPer1000": champion_row["developmentBaseNetUsdPer1000"],
            "holdDays": selected_trial.hold_days,
            "lookbackDays": selected_trial.lookback,
            "medianFoldBaseNetUsdPer1000": champion_row["medianFoldBaseNetUsdPer1000"],
            "minimumRegimeGap": selected_trial.min_gap,
            "trialId": selected_id,
        },
        "developmentSha256": sha256_file(DEVELOPMENT_PATH),
        "developmentOpenSha256": sha256_file(DEVELOPMENT_OPEN_PATH),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holdoutMetricsRead": False,
        "lockedAtUtc": utc_now(),
        "schema": "VG22SelectionV1",
        "trialLedgerSha256": ledger_sha256,
        "tieBreakApplied": [
            "LOWER_HOLD_DAYS",
            "LARGER_LOOKBACK_DAYS",
            "LARGER_MINIMUM_REGIME_GAP",
            "LEXICOGRAPHIC_TRIAL_ID",
        ],
    }
    write_json_once(SELECTION_PATH, selection)
    return selection


def selected_trial(selection: JsonObject) -> Trial:
    champion = cast(JsonObject, selection["champion"])
    trial_id = cast(str, champion["trialId"])
    candidates = {trial.trial_id: trial for trial in trials()}
    if trial_id not in candidates:
        raise ContractError("selection names a trial outside the frozen family")
    trial = candidates[trial_id]
    if (
        champion["lookbackDays"] != trial.lookback
        or champion["holdDays"] != trial.hold_days
        or champion["minimumRegimeGap"] != trial.min_gap
    ):
        raise ContractError("selection parameters do not match the frozen trial")
    return trial


def holdout_command(state_root: Path) -> JsonObject:
    freeze = verify_freeze()
    if any(path.exists() for path in (HOLDOUT_OPEN_PATH, RESULT_PATH, RUN_MARKER_PATH)):
        raise ContractError("holdout authority or result already exists")
    development_open = load_json(DEVELOPMENT_OPEN_PATH)
    selection = load_json(SELECTION_PATH)
    development = load_json(DEVELOPMENT_PATH)
    if development_open.get("schema") != "VG22DevelopmentOpenV1":
        raise ContractError("development-open receipt is invalid")
    if selection.get("developmentOpenSha256") != sha256_file(DEVELOPMENT_OPEN_PATH):
        raise ContractError("selection does not bind development-open receipt")
    if selection.get("developmentSha256") != sha256_file(DEVELOPMENT_PATH):
        raise ContractError("selection does not bind development evidence")
    if selection.get("trialLedgerSha256") != development.get("trialLedgerSha256"):
        raise ContractError("selection does not bind the exact trial ledger")
    if str(state_root.resolve()) != freeze["sourceRoot"]:
        raise ContractError("state root differs from freeze")

    holdout_open: JsonObject = {
        "developmentOpenSha256": sha256_file(DEVELOPMENT_OPEN_PATH),
        "developmentSha256": sha256_file(DEVELOPMENT_PATH),
        "freezeSha256": sha256_file(FREEZE_PATH),
        "holdoutOpenCount": 1,
        "openedAtUtc": utc_now(),
        "schema": "VG22HoldoutOpenV1",
        "selectionSha256": sha256_file(SELECTION_PATH),
        "trialLedgerSha256": development["trialLedgerSha256"],
    }
    write_json_once(HOLDOUT_OPEN_PATH, holdout_open)
    trial = selected_trial(selection)
    proto = protocol()
    result: JsonObject
    try:
        data = cast(JsonObject, proto["data"])
        months = set(cast(list[str], data["holdoutWarmupArchiveMonths"]))
        months.update(cast(list[str], data["holdoutArchiveMonths"]))
        bars, semantic_rows = load_bars(months)
        start = parse_day(cast(str, cast(JsonObject, proto["holdout"])["startUtcDate"]))
        end = parse_day(cast(str, cast(JsonObject, proto["holdout"])["endUtcDate"]))
        base = simulate(bars, trial, start, end, BASE_ADVERSE, "BASE")
        stress = simulate(bars, trial, start, end, STRESS_ADVERSE, "STRESS")
        values = [value for _, value in base.daily_returns]
        bootstrap = bootstrap_report(values, 200_000)
        p_value = (
            None
            if bootstrap["oneSidedPValue"] is None
            else float(cast(str, bootstrap["oneSidedPValue"]))
        )
        coverage = (
            None
            if base.selected_allocations == 0
            else Decimal(base.round_trips) / Decimal(base.selected_allocations)
        )
        holdout_gates = {
            "oneSidedPValue": p_value is not None and p_value < ALPHA,
            "bootstrapLowerBoundPositive": (
                bootstrap["lowerNetUsdPer1000"] is not None
                and float(cast(str, bootstrap["lowerNetUsdPer1000"])) > 0
            ),
            "basePrior30dQuoteVolumeOneBpProxyAtLeast1000NominalUsdt": (
                base.capacity_proxy_nominal_usdt is not None
                and base.capacity_proxy_nominal_usdt >= INITIAL_USD
            ),
            "development": bool(cast(JsonObject, selection["champion"])["developmentGatePass"]),
            "distinctAssets": len(base.distinct_assets) >= 15,
            "entryCoverage": coverage is not None and coverage >= Decimal("0.95"),
            "baseMaximumDrawdown": base.max_drawdown <= Decimal("0.10"),
            "roundTrips": base.round_trips >= 40,
            "stressNetPositive": stress.net_usd > ZERO,
            "topAssetConcentration": (base.top_asset_gross_profit_share <= Decimal("0.20")),
            "topFiveTradeConcentration": (
                base.top_five_trade_gross_profit_share <= Decimal("0.40")
            ),
            "validCohortDays": base.valid_cohort_days >= 60,
        }
        verdict = "GO" if all(holdout_gates.values()) else "NO_GO"
        failed = sorted(name for name, passed in holdout_gates.items() if not passed)
        result = {
            "accountEffectiveFee": "UNKNOWN",
            "archiveBodyPartitionsOpened": ["HOLDOUT", "HOLDOUT_WARMUP"],
            "authority": {
                "capital": "NONE",
                "consumer": "N3 successor/final convergence",
                "effectUsd": "0",
                "execution": "NONE",
                "orders": "NONE",
                "scope": "PUBLIC_RESEARCH_ONLY",
            },
            "base": simulation_mapping(base, include_series=True),
            "bootstrap": bootstrap,
            "completedAtUtc": utc_now(),
            "failedFormalGates": failed,
            "formalGateEvidence": holdout_gates,
            "historicalFilterCompliance": "UNKNOWN",
            "historicalSpreadImpact": "UNMEASURED",
            "holdoutOpenCount": 1,
            "holdoutOpenSha256": sha256_file(HOLDOUT_OPEN_PATH),
            "lockedTrialId": trial.trial_id,
            "netEdgeScope": "EXACT_FOR_DECLARED_PUBLIC_FEE_AND_ADVERSE_EXECUTION_SCENARIO",
            "pbo": {
                "canonicalDailyReturnSeriesSha256": cast(JsonObject, development["pbo"])[
                    "canonicalDailyReturnSeriesSha256"
                ],
                "developmentReport": development["pbo"],
                "diagnosticOnly": true_json(),
                "distinctCanonicalDailyReturnSeriesCount": cast(JsonObject, development["pbo"])[
                    "distinctCanonicalDailyReturnSeriesCount"
                ],
                "pbo": cast(JsonObject, development["pbo"]).get("pbo"),
                "status": cast(JsonObject, development["pbo"])["status"],
            },
            "orderBookDataUsed": False,
            "orderBookInference": "NONE",
            "reason": (
                "ALL_FORMAL_PUBLIC_RESEARCH_GATES_PASS"
                if verdict == "GO"
                else "ONE_OR_MORE_FORMAL_PUBLIC_RESEARCH_GATES_FAILED"
            ),
            "schema": "VG22ResultV1",
            "selectionSha256": sha256_file(SELECTION_PATH),
            "semanticRowLedger": semantic_rows,
            "semanticRowLedgerSha256": sha256_bytes(canonical_bytes(semantic_rows)),
            "stress": simulation_mapping(stress, include_series=False),
            "trialLedgerSha256": development["trialLedgerSha256"],
            "verdict": verdict,
        }
    except MeasurementError as exc:
        development_pbo = cast(JsonObject, development["pbo"])
        unavailable_pbo = {
            "canonicalDailyReturnSeriesSha256": development_pbo["canonicalDailyReturnSeriesSha256"],
            "developmentReport": development_pbo,
            "distinctCanonicalDailyReturnSeriesCount": development_pbo[
                "distinctCanonicalDailyReturnSeriesCount"
            ],
            "diagnosticOnly": True,
            "pbo": development_pbo.get("pbo"),
            "reason": "HOLDOUT_MEASUREMENT_ERROR_DEVELOPMENT_PBO_PRESERVED",
            "status": development_pbo["status"],
        }
        result = {
            "accountEffectiveFee": "UNKNOWN",
            "authority": {
                "capital": "NONE",
                "consumer": "N3 successor/final convergence",
                "effectUsd": "0",
                "execution": "NONE",
                "orders": "NONE",
                "scope": "PUBLIC_RESEARCH_ONLY",
            },
            "base": not_estimable_mapping(),
            "completedAtUtc": utc_now(),
            "failedFormalGates": ["MEASUREMENT"],
            "holdoutOpenCount": 1,
            "holdoutOpenSha256": sha256_file(HOLDOUT_OPEN_PATH),
            "lockedTrialId": trial.trial_id,
            "pbo": unavailable_pbo,
            "reason": f"MEASUREMENT_ERROR:{exc}",
            "schema": "VG22ResultV1",
            "selectionSha256": sha256_file(SELECTION_PATH),
            "stress": not_estimable_mapping(),
            "orderBookDataUsed": False,
            "orderBookInference": "NONE",
            "trialLedgerSha256": development["trialLedgerSha256"],
            "verdict": "UNMEASURED",
        }
    write_json_once(RESULT_PATH, result)
    write_terminal_marker(
        result=result,
        holdout_open_count=1,
        trial_ledger_sha256=cast(str, development["trialLedgerSha256"]),
    )
    return result


def verify_sha256s() -> None:
    if not SHA256SUMS_PATH.exists():
        raise ContractError("SHA256SUMS is required for terminal reporting")
    lines = SHA256SUMS_PATH.read_text(encoding="utf-8").splitlines()
    if not lines or any(not line for line in lines):
        raise ContractError("SHA256SUMS must contain nonblank canonical rows")
    declared: dict[str, str] = {}
    declared_order: list[str] = []
    for line in lines:
        fields = line.split("  ")
        if len(fields) != 2:
            raise ContractError("SHA256SUMS row grammar is invalid")
        digest, filename = fields
        if SHA256_RE.fullmatch(digest) is None:
            raise ContractError(f"SHA256SUMS digest is invalid: {filename}")
        relative = Path(filename)
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or filename == SHA256SUMS_PATH.name
            or "__pycache__" in relative.parts
        ):
            raise ContractError(f"SHA256SUMS filename is inadmissible: {filename}")
        if filename in declared:
            raise ContractError(f"SHA256SUMS duplicate filename: {filename}")
        declared[filename] = digest
        declared_order.append(filename)
    if declared_order != sorted(declared_order):
        raise ContractError("SHA256SUMS filenames must be sorted")

    actual: dict[str, Path] = {}
    for path in PACKET.rglob("*"):
        relative = path.relative_to(PACKET)
        if path == SHA256SUMS_PATH or "__pycache__" in relative.parts:
            continue
        if path.is_symlink():
            raise ContractError(f"packet symlink is forbidden: {relative.as_posix()}")
        if path.is_file():
            actual[relative.as_posix()] = path
    if set(declared) != set(actual):
        missing = sorted(set(actual) - set(declared))
        extra = sorted(set(declared) - set(actual))
        raise ContractError(f"SHA256SUMS exact-set mismatch: missing={missing};extra={extra}")
    for filename, path in actual.items():
        if sha256_file(path) != declared[filename]:
            raise ContractError(f"SHA256SUMS mismatch: {filename}")


def report_command(state_root: Path) -> JsonObject:
    freeze = verify_freeze()
    marker = load_json(RUN_MARKER_PATH)
    development_open = load_json(DEVELOPMENT_OPEN_PATH)
    development = load_json(DEVELOPMENT_PATH)
    result = load_json(RESULT_PATH)
    if str(state_root.resolve()) != freeze["sourceRoot"]:
        raise ContractError("state root differs from freeze")
    if marker.get("state") != "COMPLETE":
        raise ContractError("run marker is not terminal")
    if marker.get("developmentOpenSha256") != sha256_file(DEVELOPMENT_OPEN_PATH):
        raise ContractError("run marker does not bind development-open receipt")
    if development_open.get("schema") != "VG22DevelopmentOpenV1":
        raise ContractError("development-open receipt is invalid")
    if marker.get("resultSha256") != sha256_file(RESULT_PATH):
        raise ContractError("run marker does not bind result")
    if marker.get("developmentSha256") != sha256_file(DEVELOPMENT_PATH):
        raise ContractError("run marker does not bind development")
    ledger_value = development.get("trialLedger")
    if not isinstance(ledger_value, list) or len(ledger_value) != 12:
        raise ContractError("development trial ledger is not exactly 12 members")
    ledger = cast(list[JsonObject], ledger_value)
    if [row.get("trialId") for row in ledger] != [trial.trial_id for trial in trials()]:
        raise ContractError("development trial ledger order/family mismatch")
    ledger_sha256 = sha256_bytes(canonical_bytes(ledger))
    if (
        development.get("trialLedgerSha256") != ledger_sha256
        or result.get("trialLedgerSha256") != ledger_sha256
        or marker.get("trialLedgerSha256") != ledger_sha256
    ):
        raise ContractError("terminal evidence does not bind the exact trial ledger")
    if result.get("verdict") not in {"GO", "NO_GO", "UNMEASURED"}:
        raise ContractError("invalid terminal verdict")
    if (
        result.get("verdict") == "UNMEASURED"
        and cast(JsonObject, result["base"]).get("netUsdPer1000") is not None
    ):
        raise ContractError("UNMEASURED result invented a numeric edge")
    holdout_count = marker.get("holdoutOpenCount")
    if holdout_count == 0:
        if result.get("verdict") != "UNMEASURED":
            raise ContractError("zero-holdout terminal result must be UNMEASURED")
        if result.get("holdoutOpenCount") != 0 or result.get("selectionSha256") is not None:
            raise ContractError("pre-holdout result invented selection or holdout access")
        if SELECTION_PATH.exists():
            raise ContractError("pre-holdout terminal result has an unexpected selection")
        if HOLDOUT_OPEN_PATH.exists() or marker.get("holdoutOpenSha256") is not None:
            raise ContractError("pre-holdout terminal result has a holdout-open receipt")
        if development.get("status") != "UNMEASURED":
            raise ContractError("zero-holdout result lacks terminal development evidence")
    elif holdout_count == 1:
        selection = load_json(SELECTION_PATH)
        holdout_open = load_json(HOLDOUT_OPEN_PATH)
        if marker.get("selectionSha256") != sha256_file(SELECTION_PATH):
            raise ContractError("run marker does not bind selection")
        if marker.get("holdoutOpenSha256") != sha256_file(HOLDOUT_OPEN_PATH):
            raise ContractError("run marker does not bind holdout-open receipt")
        if (
            holdout_open.get("schema") != "VG22HoldoutOpenV1"
            or holdout_open.get("selectionSha256") != sha256_file(SELECTION_PATH)
            or holdout_open.get("trialLedgerSha256") != ledger_sha256
        ):
            raise ContractError("holdout-open receipt binding is invalid")
        if selection.get("holdoutMetricsRead") is not False:
            raise ContractError("selection claims holdout access")
        if result.get("selectionSha256") != sha256_file(SELECTION_PATH):
            raise ContractError("result does not bind locked selection")
        if selection.get("trialLedgerSha256") != ledger_sha256:
            raise ContractError("selection does not bind the exact trial ledger")
        if development.get("attemptedTrialCount") != 12:
            raise ContractError("development omitted a frozen trial")
    else:
        raise ContractError("terminal holdout open count must be zero or one")
    verify_sha256s()
    return {
        "accountEffectiveFee": result.get("accountEffectiveFee"),
        "authenticatedWithoutRecomputation": True,
        "baseNetUsdPer1000": cast(JsonObject, result["base"]).get("netUsdPer1000"),
        "consumer": "N3 successor/final convergence",
        "holdoutOpenCount": marker["holdoutOpenCount"],
        "lockedTrialId": result["lockedTrialId"],
        "resultSha256": sha256_file(RESULT_PATH),
        "stressNetUsdPer1000": cast(JsonObject, result["stress"]).get("netUsdPer1000"),
        "verdict": result["verdict"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("inventory", "freeze", "develop", "holdout", "report"),
    )
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--pre-outcome-commit")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    state_root = cast(Path, arguments.state_root)
    try:
        if arguments.command == "inventory":
            value = inventory(state_root)
            summary = {
                "normalizedRecordSha256": value["normalizedRecordSha256"],
                "recordCount": value["recordCount"],
                "schema": value["schema"],
                "symbolCount": value["symbolCount"],
            }
        elif arguments.command == "freeze":
            value = freeze_command(state_root, cast(str | None, arguments.pre_outcome_commit))
            summary = {
                "preOutcomeCommit": value["preOutcomeCommit"],
                "schema": value["schema"],
                "splitPlanSha256": value["splitPlanSha256"],
                "trialFamilySha256": value["trialFamilySha256"],
            }
        elif arguments.command == "develop":
            value = development_command(state_root)
            summary = value
        elif arguments.command == "holdout":
            value = holdout_command(state_root)
            summary = {
                "baseNetUsdPer1000": cast(JsonObject, value["base"]).get("netUsdPer1000"),
                "lockedTrialId": value["lockedTrialId"],
                "stressNetUsdPer1000": cast(JsonObject, value["stress"]).get("netUsdPer1000"),
                "verdict": value["verdict"],
            }
        else:
            summary = report_command(state_root)
    except MeasurementError as exc:
        if arguments.command == "develop" and DEVELOPMENT_OPEN_PATH.exists():
            try:
                value = terminal_development_measurement_failure(exc)
            except (ContractError, OSError, ValueError) as sealing_error:
                print(
                    f"VG22_ERROR:{type(sealing_error).__name__}:{sealing_error}",
                    file=sys.stderr,
                )
                return 2
            summary = {
                "baseNetUsdPer1000": cast(JsonObject, value["base"])["netUsdPer1000"],
                "holdoutOpenCount": value["holdoutOpenCount"],
                "reason": value["reason"],
                "verdict": value["verdict"],
            }
        else:
            print(f"VG22_ERROR:{type(exc).__name__}:{exc}", file=sys.stderr)
            return 2
    except (ContractError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(f"VG22_ERROR:{type(exc).__name__}:{exc}", file=sys.stderr)
        return 2
    print(json.dumps(summary, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
