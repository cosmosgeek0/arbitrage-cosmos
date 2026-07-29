#!/usr/bin/env python3
"""Frozen one-run evaluator for S-2I."""

from __future__ import annotations

import argparse
import bisect
import collections
import csv
import datetime as dt
import hashlib
import io
import itertools
import json
import math
import os
import pathlib
import random
import stat
import statistics
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

import acquisition


PACKET_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = PACKET_DIR.parents[2]
PROTOCOL_PATH = PACKET_DIR / "protocol.v1.json"
PLAN_PATH = PACKET_DIR / "source_plan.v1.json"
MANIFEST_PATH = PACKET_DIR / "source_manifest.v1.json"
FREEZE_PATH = PACKET_DIR / "freeze.v1.json"
RUN_RECEIPT_PATH = PACKET_DIR / "RUN_CONSUMED.v1.json"
DEVELOPMENT_OPEN_PATH = PACKET_DIR / "DEVELOPMENT_OPENED.v1.json"
DEVELOPMENT_PATH = PACKET_DIR / "development.v1.json"
CANDIDATE_PATH = PACKET_DIR / "candidate_seal.v1.json"
HOLDOUT_OPEN_PATH = PACKET_DIR / "HOLDOUT_OPENED.v1.json"
FAILURE_PATH = PACKET_DIR / "terminal_failure.v1.json"
RESULT_PATH = PACKET_DIR / "result.v1.json"
TERMINAL_PATH = PACKET_DIR / "terminal.v1.json"
SUMS_PATH = PACKET_DIR / "SHA256SUMS"

GENERATED_NAMES = {
    "source_manifest.v1.json",
    "freeze.v1.json",
    "RUN_CONSUMED.v1.json",
    "DEVELOPMENT_OPENED.v1.json",
    "development.v1.json",
    "candidate_seal.v1.json",
    "HOLDOUT_OPENED.v1.json",
    "terminal_failure.v1.json",
    "result.v1.json",
    "terminal.v1.json",
    "POSTRUN_VERIFICATION.v1.json",
    "SHA256SUMS",
}

BASE_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
EXPECTED_PROTOCOL_SEMANTIC_SHA256 = (
    "b5c26ebd02794f23796b756bb5911f166a513f265450847d472222c3efd1e74d"
)
CANONICAL_RAW_ROOT = acquisition.CANONICAL_RAW_ROOT
CANONICAL_STATE_ROOT = pathlib.Path(
    "/private/tmp/cosmos-s2i-spot-usdm-leadlag-v1-fbce/state"
)
HOUR_MS = 3_600_000
DAY_MS = 86_400_000
DEVELOPMENT_START_MS = 1_751_328_000_000  # 2025-07-01
DEVELOPMENT_END_MS = 1_772_323_200_000  # 2026-03-01
HOLDOUT_START_MS = 1_772_928_000_000  # 2026-03-08
HOLDOUT_END_MS = 1_782_864_000_000  # 2026-07-01
RPI_BREAK_MS = 1_763_424_000_000  # 2025-11-18
SIGNAL_GUARD_HOURS = 1
ENTRY_GROSS_USD = 960.0
CASH_RESERVE_USD = 40.0
BOOTSTRAP_BLOCK_DAYS = 7
FIXED_SYMBOLS = (
    "ADAUSDT",
    "BNBUSDT",
    "BTCUSDT",
    "DOGEUSDT",
    "ETHUSDT",
    "LINKUSDT",
    "SOLUSDT",
    "XRPUSDT",
)
REQUIRED_LIMITATIONS = (
    "historical cross-engine clock offset is UNKNOWN",
    "hour bars cannot identify sub-hour causality",
    "no historical synchronized order book, spread, queue, or impact",
    "account-effective and historical commission are UNKNOWN",
    "fixed long-lived universe has survivorship bias",
    "zero net notional is not proven beta or factor neutrality",
    "quote-volume capacity is not executable capacity",
    "USDT per $1k is not a fiat-USD conversion",
    "RPI began during the sample on 2025-11-18",
)
WARMUP_DEVELOPMENT_MONTHS = (
    "2025-06",
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
)
EMBARGO_HOLDOUT_MONTHS = ("2026-03", "2026-04", "2026-05", "2026-06")
SCENARIOS: dict[str, float] = {
    "base": 7.0,
    "stress": 15.0,
    "severe": 20.0,
}
TRIALS: tuple[tuple[int, int], ...] = tuple(
    (horizon, names)
    for horizon in (1, 2, 3, 6)
    for names in (2, 3, 4)
)
EXPECTED_DEVELOPMENT_GATES = {
    "base_total_gt_usd": "0",
    "capacity_proxy_p05_gte_usd": "1000",
    "holm_adjusted_absolute_p_lte": "0.05",
    "holm_adjusted_excess_p_lte": "0.05",
    "maximum_marked_gross_lte_usd": "1000",
    "maximum_severe_drawdown_lte_usd": "100",
    "minimum_active_utc_days": 120,
    "minimum_portfolio_formations": 1000,
    "remove_best_month_stress_total_gt_usd": "0",
    "required_symbol_directions": "ALL_FIXED_SYMBOLS_BOTH_LONG_AND_SHORT",
    "severe_total_gt_usd": "0",
    "stress_90pct_lower_bound_gt_usd": "0",
    "stress_excess_90pct_lower_bound_gt_usd": "0",
    "stress_total_gt_usd": "0",
    "white_reality_check_p_lte": "0.05",
}
EXPECTED_HOLDOUT_GATES = {
    "capacity_proxy_p05_gte_usd": "1000",
    "maximum_marked_gross_lte_usd": "1000",
    "maximum_severe_drawdown_lte_usd": "100",
    "minimum_active_utc_days": 60,
    "minimum_portfolio_formations": 400,
    "required_symbol_directions": "ALL_FIXED_SYMBOLS_BOTH_LONG_AND_SHORT",
    "severe_total_gt_usd": "0",
    "stress_90pct_lower_bound_gt_usd": "0",
    "stress_excess_90pct_lower_bound_gt_usd": "0",
    "stress_total_gt_usd": "0",
}


class StudyError(RuntimeError):
    """A terminal custody, schema, clock, or lifecycle failure."""


@dataclass(frozen=True)
class Bar:
    timestamp_ms: int
    open: float
    close: float
    quote_volume: float


@dataclass(frozen=True)
class Funding:
    timestamp_ms: int
    interval_hours: int
    rate: float


@dataclass
class SymbolData:
    spot: dict[int, Bar]
    contract: dict[int, Bar]
    mark: dict[int, Bar]
    funding: list[Funding]


@dataclass(frozen=True)
class Feature:
    spot_lead_z: float
    futures_comparator_z: float
    reverse_futures_z: float
    spot_return: float
    futures_return: float


@dataclass
class Simulation:
    trial_id: str
    horizon_hours: int
    names_per_side: int
    source: str
    daily_dates: list[str]
    daily_by_scenario: dict[str, list[float]]
    hourly_by_scenario: dict[str, list[tuple[int, float]]]
    formation_ledger: list[tuple[int, list[str], list[str]]]
    capacity_ledger: list[tuple[int, str, float, float]]
    marked_exposure_ledger: list[tuple[int, str, float, float]]
    formation_count: int
    active_days: int
    long_symbols: list[str]
    short_symbols: list[str]
    capacity_values_usd: list[float]
    pre_rpi_stress_usd: float
    post_rpi_stress_usd: float
    gross_usd: float
    funding_usd: float
    maximum_marked_gross_usd: float
    maximum_abs_marked_net_notional_usd: float


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def atomic_write(path: pathlib.Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def atomic_create_once(path: pathlib.Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.parent.is_symlink():
        raise StudyError(f"STATE_PARENT_SYMLINK {path.parent}")
    try:
        descriptor = os.open(
            path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o600,
        )
    except FileExistsError as error:
        raise StudyError(f"ONE_RUN_ALREADY_CONSUMED {path}") from error
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def load_json(path: pathlib.Path) -> Any:
    if path.is_symlink():
        raise StudyError(f"JSON_SYMLINK {path}")
    try:
        descriptor = os.open(
            path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        )
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            metadata = os.fstat(handle.fileno())
            if not stat.S_ISREG(metadata.st_mode):
                raise StudyError(f"JSON_NOT_REGULAR {path}")
            return json.load(handle)
    except StudyError:
        raise
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as error:
        raise StudyError(f"JSON_READ_FAILED {path} {error}") from error


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    if path.is_symlink():
        raise StudyError(f"HASH_SYMLINK {path}")
    try:
        descriptor = os.open(
            path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        )
        with os.fdopen(descriptor, "rb") as handle:
            metadata = os.fstat(handle.fileno())
            if not stat.S_ISREG(metadata.st_mode):
                raise StudyError(f"HASH_NOT_REGULAR {path}")
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except StudyError:
        raise
    except OSError as error:
        raise StudyError(f"HASH_READ_FAILED {path} {error}") from error
    return digest.hexdigest()


def git(*arguments: str) -> str:
    completed = subprocess.run(
        ["git", *arguments],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def git_blob_bytes(commit: str, relative: str) -> bytes:
    completed = subprocess.run(
        ["git", "show", f"{commit}:{relative}"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return completed.stdout


def require_canonical_roots(raw_root: pathlib.Path) -> None:
    if raw_root.resolve() != CANONICAL_RAW_ROOT.resolve():
        raise StudyError(
            f"RAW_ROOT_NOT_CANONICAL expected={CANONICAL_RAW_ROOT.resolve()} "
            f"found={raw_root.resolve()}"
        )
    if raw_root.is_symlink():
        raise StudyError("RAW_ROOT_SYMLINK")
    if CANONICAL_STATE_ROOT.exists() and CANONICAL_STATE_ROOT.is_symlink():
        raise StudyError("STATE_ROOT_SYMLINK")


def git_identity(require_clean: bool) -> dict[str, str]:
    root = pathlib.Path(git("rev-parse", "--show-toplevel")).resolve()
    if root != REPO_ROOT.resolve():
        raise StudyError(f"REPO_ROOT_MISMATCH {root} {REPO_ROOT.resolve()}")
    status = git("status", "--porcelain=v1", "--untracked-files=all")
    if require_clean and status:
        raise StudyError(f"WORKTREE_NOT_CLEAN {status[:500]!r}")
    changed = git("diff", "--name-only", f"{BASE_COMMIT}..HEAD").splitlines()
    outside = [
        path for path in changed if not path.startswith("quant/research/s2i/")
    ]
    if outside:
        raise StudyError(f"SCOPE_VIOLATION {outside}")
    return {
        "commit": git("rev-parse", "HEAD"),
        "tree": git("rev-parse", "HEAD^{tree}"),
    }


def packet_static_files() -> list[pathlib.Path]:
    paths: list[pathlib.Path] = []
    for path in PACKET_DIR.iterdir():
        if path.name in GENERATED_NAMES or path.name.startswith("."):
            continue
        if path.suffix not in {".py", ".md", ".json"}:
            continue
        if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
            raise StudyError(f"STATIC_NOT_REGULAR {path}")
        paths.append(path)
    return sorted(paths)


def file_inventory(paths: Sequence[pathlib.Path]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for path in paths:
        if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
            raise StudyError(f"INVENTORY_NOT_REGULAR {path}")
        output.append(
            {
                "bytes": path.stat().st_size,
                "path": path.relative_to(REPO_ROOT).as_posix(),
                "sha256": sha256_file(path),
            }
        )
    return output


def validate_protocol(protocol: Mapping[str, Any]) -> None:
    if sha256_bytes(canonical_json_bytes(protocol)) != (
        EXPECTED_PROTOCOL_SEMANTIC_SHA256
    ):
        raise StudyError("PROTOCOL_SEMANTIC_DIGEST")
    if protocol.get("schema") != "cosmos.s2i.protocol.v1":
        raise StudyError("PROTOCOL_SCHEMA")
    if protocol.get("base_commit") != BASE_COMMIT:
        raise StudyError("PROTOCOL_BASE")
    if protocol["trials"]["trial_count"] != len(TRIALS):
        raise StudyError("PROTOCOL_TRIAL_COUNT")
    if protocol["consumer"]["task"] != "N3 successor/final convergence":
        raise StudyError("PROTOCOL_CONSUMER")
    if protocol["economics"]["account_effective_commission"] != "UNKNOWN":
        raise StudyError("ACCOUNT_FEE_TRUTH")
    if protocol["distinctness"]["spot_position"] != "FORBIDDEN":
        raise StudyError("SPOT_POSITION_COLLISION")
    if protocol.get("scope") != {
        "canonical_or_live_runtime": False,
        "capital_authority": "NONE",
        "host": False,
        "money": False,
        "orders": False,
        "private_api": False,
        "provider": False,
        "public_only": True,
        "test_orders": False,
        "transfers": False,
        "ui": False,
        "withdrawals": False,
    }:
        raise StudyError("PROTOCOL_SCOPE")
    if protocol.get("sealing") != {
        "candidate_seal_before_holdout_member_access": True,
        "failure_policy": "RUN_REMAINS_CONSUMED",
        "freeze_before_outcome_member_access": True,
        "holdout_marker_before_first_holdout_member_access": True,
        "run_marker_before_first_development_member_access": True,
        "run_marker_create_once": True,
        "run_once": True,
    }:
        raise StudyError("PROTOCOL_SEALING")
    expected_calendar = {
        "development": "[2025-07-01T00:00:00Z,2026-03-01T00:00:00Z)",
        "embargo": "[2026-03-01T00:00:00Z,2026-03-08T00:00:00Z)",
        "holdout": "[2026-03-08T00:00:00Z,2026-07-01T00:00:00Z)",
        "planned_economic_window": (
            "[2025-07-01T00:00:00Z,2026-07-01T00:00:00Z)"
        ),
        "timezone": "UTC",
        "warmup": "[2025-06-01T00:00:00Z,2025-07-01T00:00:00Z)",
    }
    if protocol["calendar"] != expected_calendar:
        raise StudyError("PROTOCOL_CALENDAR")
    if protocol["clock"].get("decision_guard_hours") != SIGNAL_GUARD_HOURS:
        raise StudyError("PROTOCOL_GUARD")
    if protocol["clock"].get("bar_interval") != "1h":
        raise StudyError("PROTOCOL_BAR_INTERVAL")
    if tuple(protocol["universe"]["symbols"]) != FIXED_SYMBOLS:
        raise StudyError("PROTOCOL_SYMBOLS")
    if protocol["universe"]["missing_policy"] != (
        "No substitutions. A sleeve stays cash unless all eight fixed names "
        "are eligible; a missing required post-entry mark is UNMEASURED."
    ):
        raise StudyError("PROTOCOL_MISSING_POLICY")
    trials = protocol["trials"]
    if trials["horizon_hours"] != [1, 2, 3, 6]:
        raise StudyError("PROTOCOL_HORIZONS")
    if trials["names_per_side"] != [2, 3, 4]:
        raise StudyError("PROTOCOL_NAMES_PER_SIDE")
    if trials["champion_selection"] != (
        "Maximum development stress total; lexicographically lowest "
        "trial_id breaks an exact tie; no fallback if that champion fails "
        "any gate."
    ):
        raise StudyError("PROTOCOL_CHAMPION")
    economics = protocol["economics"]
    if (
        float(economics["capital_usd"]) != 1000.0
        or float(economics["entry_gross_usd"]) != ENTRY_GROSS_USD
        or float(economics["cash_reserve_usd"]) != CASH_RESERVE_USD
        or economics["compounding"] is not False
        or economics["spot_cashflow"] != "NONE"
    ):
        raise StudyError("PROTOCOL_CAPITAL")
    scenario_totals = {
        name: float(values["adverse_execution_bps_per_fill"])
        + float(values["illustrative_taker_fee_bps_per_fill"])
        for name, values in economics["scenarios"].items()
    }
    if scenario_totals != SCENARIOS:
        raise StudyError("PROTOCOL_SCENARIOS")
    signal = protocol["signal"]
    if (
        signal["rolling_hours"] != 672
        or signal["minimum_fit_observations"] != 504
    ):
        raise StudyError("PROTOCOL_SIGNAL_WINDOW")
    bootstrap = protocol["statistics"]["bootstrap"]
    if (
        bootstrap["replicates"] != 8192
        or bootstrap["seed"] != 2026073009
        or bootstrap["block_days"] != BOOTSTRAP_BLOCK_DAYS
    ):
        raise StudyError("PROTOCOL_BOOTSTRAP")
    if protocol["statistics"]["pbo"] != {
        "chronological_blocks": 8,
        "combinations": 70,
        "method": (
            "Complete CSCV over four of eight development calendar-month "
            "blocks."
        ),
        "role": "DIAGNOSTIC_ONLY",
    }:
        raise StudyError("PROTOCOL_PBO")
    if protocol["development_gates"] != EXPECTED_DEVELOPMENT_GATES:
        raise StudyError("PROTOCOL_DEVELOPMENT_GATES")
    if protocol["holdout_gates"] != EXPECTED_HOLDOUT_GATES:
        raise StudyError("PROTOCOL_HOLDOUT_GATES")
    plan = acquisition.validate_source_plan(load_json(PLAN_PATH))
    if tuple(protocol["sources"]["months"]) != tuple(plan["months"]):
        raise StudyError("PROTOCOL_MONTHS")
    if tuple(protocol["universe"]["symbols"]) != tuple(plan["symbols"]):
        raise StudyError("PROTOCOL_PLAN_SYMBOLS")
    if protocol["sources"]["datasets"] != [
        "monthly Spot klines 1h",
        "monthly USD-M contract klines 1h",
        "monthly USD-M mark-price klines 1h",
        "monthly USD-M fundingRate",
    ]:
        raise StudyError("PROTOCOL_SOURCE_DATASETS")
    provenance = protocol["provenance"]
    if provenance["archive_base"] != plan["archive_base"]:
        raise StudyError("PROTOCOL_PLAN_ARCHIVE_BASE")
    if pathlib.Path(provenance["raw_root"]).resolve() != CANONICAL_RAW_ROOT.resolve():
        raise StudyError("PROTOCOL_RAW_ROOT")
    if pathlib.Path(
        provenance["state_root"]
    ).resolve() != CANONICAL_STATE_ROOT.resolve():
        raise StudyError("PROTOCOL_STATE_ROOT")


def validate_manifest(
    manifest: Mapping[str, Any], raw_root: pathlib.Path
) -> None:
    if manifest.get("schema") != "cosmos.s2i.source-manifest.v1":
        raise StudyError("MANIFEST_SCHEMA")
    if manifest.get("outcome_member_access") != "NONE":
        raise StudyError("MANIFEST_OUTCOME_ACCESS")
    plan_sha = sha256_file(PLAN_PATH)
    if manifest.get("source_plan_sha256") != plan_sha:
        raise StudyError("MANIFEST_PLAN_BINDING")
    plan = load_json(PLAN_PATH)
    acquisition.validate_source_plan(plan)
    semantic_failures = acquisition.validate_manifest_semantics(
        dict(manifest), plan
    )
    if semantic_failures:
        raise StudyError(
            f"MANIFEST_SEMANTICS {'; '.join(semantic_failures[:20])}"
        )
    failures = acquisition.verify_manifest_files(dict(manifest), raw_root)
    if failures:
        raise StudyError(f"RAW_CUSTODY {'; '.join(failures[:20])}")


def command_freeze(raw_root: pathlib.Path) -> int:
    require_canonical_roots(raw_root)
    prohibited = [
        path
        for path in (
            FREEZE_PATH,
            RUN_RECEIPT_PATH,
            DEVELOPMENT_OPEN_PATH,
            DEVELOPMENT_PATH,
            CANDIDATE_PATH,
            HOLDOUT_OPEN_PATH,
            FAILURE_PATH,
            RESULT_PATH,
            TERMINAL_PATH,
            SUMS_PATH,
            PACKET_DIR / "POSTRUN_VERIFICATION.v1.json",
        )
        if path.exists()
    ]
    if prohibited:
        raise StudyError(f"OUTCOME_ARTIFACT_PREEXISTS {prohibited}")
    protocol = load_json(PROTOCOL_PATH)
    validate_protocol(protocol)
    manifest = load_json(MANIFEST_PATH)
    validate_manifest(manifest, raw_root)
    identity = git_identity(require_clean=True)
    inventory_paths = packet_static_files() + [MANIFEST_PATH]
    inventory = file_inventory(inventory_paths)
    for item in inventory:
        committed = git_blob_bytes(identity["commit"], item["path"])
        if len(committed) != item["bytes"]:
            raise StudyError(f"STATIC_COMMIT_SIZE {item['path']}")
        if sha256_bytes(committed) != item["sha256"]:
            raise StudyError(f"STATIC_COMMIT_HASH {item['path']}")
    freeze = {
        "archive_member_access": "NONE",
        "created_at_utc": acquisition.utc_now(),
        "file_inventory": inventory,
        "inventory_sha256": sha256_bytes(canonical_json_bytes(inventory)),
        "raw_inventory_sha256": manifest["inventory_sha256"],
        "raw_root": str(CANONICAL_RAW_ROOT.resolve()),
        "schema": "cosmos.s2i.freeze.v1",
        "source_manifest_sha256": sha256_file(MANIFEST_PATH),
        "source_plan_semantic_sha256": (
            acquisition.EXPECTED_SOURCE_PLAN_SEMANTIC_SHA256
        ),
        "static_commit": identity["commit"],
        "static_tree": identity["tree"],
        "state_root": str(CANONICAL_STATE_ROOT.resolve()),
        "status": "FROZEN_BEFORE_OUTCOMES",
    }
    atomic_write(FREEZE_PATH, canonical_json_bytes(freeze))
    print(
        json.dumps(
            {
                "freeze": str(FREEZE_PATH),
                "inventory_sha256": freeze["inventory_sha256"],
                "raw_inventory_sha256": freeze["raw_inventory_sha256"],
                "status": freeze["status"],
            },
            sort_keys=True,
        )
    )
    return 0


def validate_freeze(raw_root: pathlib.Path) -> tuple[dict[str, Any], dict[str, Any]]:
    require_canonical_roots(raw_root)
    protocol = load_json(PROTOCOL_PATH)
    validate_protocol(protocol)
    freeze = load_json(FREEZE_PATH)
    if freeze.get("schema") != "cosmos.s2i.freeze.v1":
        raise StudyError("FREEZE_SCHEMA")
    if freeze.get("status") != "FROZEN_BEFORE_OUTCOMES":
        raise StudyError("FREEZE_STATUS")
    if freeze.get("archive_member_access") != "NONE":
        raise StudyError("FREEZE_ACCESS")
    if freeze.get("raw_root") != str(CANONICAL_RAW_ROOT.resolve()):
        raise StudyError("FREEZE_RAW_ROOT")
    if freeze.get("state_root") != str(CANONICAL_STATE_ROOT.resolve()):
        raise StudyError("FREEZE_STATE_ROOT")
    if freeze.get("source_plan_semantic_sha256") != (
        acquisition.EXPECTED_SOURCE_PLAN_SEMANTIC_SHA256
    ):
        raise StudyError("FREEZE_SOURCE_PLAN_SEMANTIC")
    if git("rev-parse", f"{freeze['static_commit']}^{{tree}}") != freeze[
        "static_tree"
    ]:
        raise StudyError("FREEZE_STATIC_TREE")
    expected_inventory = file_inventory(packet_static_files() + [MANIFEST_PATH])
    if freeze.get("file_inventory") != expected_inventory:
        raise StudyError("FREEZE_EXACT_FILE_INVENTORY")
    for item in freeze["file_inventory"]:
        path = REPO_ROOT / item["path"]
        if not path.is_file() or path.is_symlink():
            raise StudyError(f"FROZEN_FILE_MISSING {item['path']}")
        if path.stat().st_size != item["bytes"]:
            raise StudyError(f"FROZEN_FILE_SIZE {item['path']}")
        if sha256_file(path) != item["sha256"]:
            raise StudyError(f"FROZEN_FILE_HASH {item['path']}")
        committed = git_blob_bytes(freeze["static_commit"], item["path"])
        if len(committed) != item["bytes"] or sha256_bytes(committed) != item[
            "sha256"
        ]:
            raise StudyError(f"FREEZE_STATIC_COMMIT_BINDING {item['path']}")
    if sha256_bytes(canonical_json_bytes(freeze["file_inventory"])) != freeze[
        "inventory_sha256"
    ]:
        raise StudyError("FREEZE_INVENTORY_DIGEST")
    manifest = load_json(MANIFEST_PATH)
    if sha256_file(MANIFEST_PATH) != freeze["source_manifest_sha256"]:
        raise StudyError("FREEZE_MANIFEST_BINDING")
    if manifest["inventory_sha256"] != freeze["raw_inventory_sha256"]:
        raise StudyError("FREEZE_RAW_BINDING")
    validate_manifest(manifest, raw_root)
    return protocol, manifest


def normalize_timestamp(raw: str, dataset: str, close: bool = False) -> int:
    try:
        value = int(raw)
    except ValueError as error:
        raise StudyError(f"TIMESTAMP_INVALID {dataset} {raw!r}") from error
    native_microseconds = value >= 100_000_000_000_000
    expects_spot_microseconds = dataset == "spot" or dataset.startswith(
        "data/spot/"
    )
    if expects_spot_microseconds and not native_microseconds:
        raise StudyError(f"SPOT_TIMESTAMP_NOT_MICROSECONDS {value}")
    if not expects_spot_microseconds and native_microseconds:
        raise StudyError(f"USDM_TIMESTAMP_NOT_MILLISECONDS {value}")
    if native_microseconds:
        expected_remainder = 999 if close else 0
        if value % 1000 != expected_remainder:
            raise StudyError(
                f"SPOT_TIMESTAMP_MICROSECOND_REMAINDER "
                f"expected={expected_remainder} found={value % 1000}"
            )
        value //= 1000
    if value < 1_000_000_000_000 or value >= 10_000_000_000_000:
        raise StudyError(f"TIMESTAMP_RANGE {dataset} {value}")
    return value


def safe_float(raw: str, label: str) -> float:
    try:
        value = float(raw)
    except ValueError as error:
        raise StudyError(f"NUMBER_INVALID {label} {raw!r}") from error
    if not math.isfinite(value):
        raise StudyError(f"NUMBER_NONFINITE {label}")
    return value


class ArchiveAccess:
    def __init__(
        self,
        manifest: Mapping[str, Any],
        raw_root: pathlib.Path,
        holdout_allowed: bool,
    ) -> None:
        self.index = {item["key"]: item for item in manifest["artifacts"]}
        self.raw_root = raw_root
        self.holdout_allowed = holdout_allowed
        self.opened_keys: list[str] = []

    def rows(self, key: str) -> Iterable[list[str]]:
        item = self.index.get(key)
        if item is None:
            raise StudyError(f"ARCHIVE_NOT_MANIFESTED {key}")
        if (
            item["lifecycle_partition"] == "EMBARGO_HOLDOUT"
            and not self.holdout_allowed
        ):
            raise StudyError(f"HOLDOUT_ACCESS_FORBIDDEN {key}")
        try:
            path = acquisition.validate_local_target(self.raw_root, key)
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(path, flags)
            with os.fdopen(descriptor, "rb") as source:
                metadata = os.fstat(source.fileno())
                if not stat.S_ISREG(metadata.st_mode):
                    raise StudyError(f"ARCHIVE_NOT_REGULAR {key}")
                if metadata.st_size != item["archive_bytes"]:
                    raise StudyError(f"ARCHIVE_SIZE_MUTATED {key}")
                digest = hashlib.sha256()
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
                if digest.hexdigest() != item["archive_sha256"]:
                    raise StudyError(f"ARCHIVE_MUTATED {key}")
                source.seek(0)
                with zipfile.ZipFile(source, "r") as archive:
                    members = [
                        member
                        for member in archive.infolist()
                        if not member.is_dir()
                    ]
                    if len(members) != 1:
                        raise StudyError(
                            f"ZIP_MEMBER_COUNT {key} {len(members)}"
                        )
                    member = members[0]
                    pure = pathlib.PurePosixPath(member.filename)
                    if (
                        pure.is_absolute()
                        or ".." in pure.parts
                        or len(pure.parts) != 1
                        or pure.suffix.lower() != ".csv"
                    ):
                        raise StudyError(
                            f"ZIP_MEMBER_PATH {key} {member.filename}"
                        )
                    if member.flag_bits & 0x1:
                        raise StudyError(f"ZIP_ENCRYPTED {key}")
                    if member.file_size > 100_000_000:
                        raise StudyError(f"ZIP_MEMBER_TOO_LARGE {key}")
                    self.opened_keys.append(key)
                    with archive.open(member, "r") as binary:
                        text = io.TextIOWrapper(
                            binary, encoding="utf-8", newline=""
                        )
                        reader = csv.reader(text)
                        for row in reader:
                            if row and any(field.strip() for field in row):
                                yield row
        except StudyError:
            raise
        except (
            acquisition.AcquisitionError,
            OSError,
            RuntimeError,
            UnicodeError,
            ValueError,
            csv.Error,
            zipfile.BadZipFile,
        ) as error:
            raise StudyError(f"ARCHIVE_MEMBER_READ_FAILED {key} {error}") from error


def artifact_key(dataset: str, symbol: str, month: str) -> str:
    templates = {
        "spot_kline_1h": (
            "data/spot/monthly/klines/{symbol}/1h/"
            "{symbol}-1h-{month}.zip"
        ),
        "usdm_kline_1h": (
            "data/futures/um/monthly/klines/{symbol}/1h/"
            "{symbol}-1h-{month}.zip"
        ),
        "usdm_mark_kline_1h": (
            "data/futures/um/monthly/markPriceKlines/{symbol}/1h/"
            "{symbol}-1h-{month}.zip"
        ),
        "usdm_funding_rate": (
            "data/futures/um/monthly/fundingRate/{symbol}/"
            "{symbol}-fundingRate-{month}.zip"
        ),
    }
    return templates[dataset].format(symbol=symbol, month=month)


def parse_kline_rows(
    rows: Iterable[list[str]], dataset: str
) -> dict[int, Bar]:
    bars: dict[int, Bar] = {}
    previous = -1
    for row_number, row in enumerate(rows, start=1):
        if row_number == 1:
            try:
                int(row[0])
            except (ValueError, IndexError):
                continue
        if len(row) != 12:
            raise StudyError(
                f"KLINE_COLUMN_COUNT {dataset} row={row_number} count={len(row)}"
            )
        timestamp = normalize_timestamp(row[0].strip(), dataset)
        close_timestamp = normalize_timestamp(row[6].strip(), dataset, close=True)
        if timestamp % HOUR_MS:
            raise StudyError(f"KLINE_OPEN_OFF_GRID {dataset} {timestamp}")
        if close_timestamp != timestamp + HOUR_MS - 1:
            raise StudyError(
                f"KLINE_CLOSE_CLOCK {dataset} {timestamp} {close_timestamp}"
            )
        if timestamp <= previous or timestamp in bars:
            raise StudyError(f"KLINE_ORDER_DUPLICATE {dataset} {timestamp}")
        previous = timestamp
        open_price = safe_float(row[1], f"{dataset}.open")
        high = safe_float(row[2], f"{dataset}.high")
        low = safe_float(row[3], f"{dataset}.low")
        close_price = safe_float(row[4], f"{dataset}.close")
        quote_volume = safe_float(row[7], f"{dataset}.quote_volume")
        if min(open_price, high, low, close_price) <= 0:
            raise StudyError(f"KLINE_PRICE_NONPOSITIVE {dataset} {timestamp}")
        if high < max(open_price, close_price, low):
            raise StudyError(f"KLINE_HIGH_INVALID {dataset} {timestamp}")
        if low > min(open_price, close_price, high):
            raise StudyError(f"KLINE_LOW_INVALID {dataset} {timestamp}")
        if quote_volume < 0:
            raise StudyError(f"KLINE_QUOTE_VOLUME_NEGATIVE {dataset} {timestamp}")
        bars[timestamp] = Bar(
            timestamp_ms=timestamp,
            open=open_price,
            close=close_price,
            quote_volume=quote_volume,
        )
    if not bars:
        raise StudyError(f"KLINE_EMPTY {dataset}")
    return bars


def parse_funding_rows(rows: Iterable[list[str]], dataset: str) -> list[Funding]:
    material = list(rows)
    if not material:
        raise StudyError(f"FUNDING_EMPTY {dataset}")
    header = tuple(field.strip().lower() for field in material[0])
    expected = ("calc_time", "funding_interval_hours", "last_funding_rate")
    if header != expected:
        raise StudyError(f"FUNDING_HEADER {dataset} {header!r}")
    output: list[Funding] = []
    previous = -1
    for row_number, row in enumerate(material[1:], start=2):
        if len(row) != 3:
            raise StudyError(
                f"FUNDING_COLUMN_COUNT {dataset} row={row_number}"
            )
        timestamp = normalize_timestamp(row[0].strip(), dataset)
        interval = safe_float(row[1], f"{dataset}.interval")
        rate = safe_float(row[2], f"{dataset}.rate")
        if timestamp <= previous:
            raise StudyError(f"FUNDING_ORDER_DUPLICATE {dataset} {timestamp}")
        if interval <= 0 or interval > 24 or interval != int(interval):
            raise StudyError(f"FUNDING_INTERVAL {dataset} {interval}")
        if timestamp % HOUR_MS >= 60_000:
            raise StudyError(f"FUNDING_TIMESTAMP_OFF_HOUR {dataset} {timestamp}")
        if abs(rate) > 0.05:
            raise StudyError(f"FUNDING_RATE_RANGE {dataset} {rate}")
        previous = timestamp
        output.append(Funding(timestamp, int(interval), rate))
    if not output:
        raise StudyError(f"FUNDING_NO_ROWS {dataset}")
    return output


def merge_unique(
    destination: dict[int, Bar], addition: Mapping[int, Bar], label: str
) -> None:
    overlap = set(destination).intersection(addition)
    if overlap:
        raise StudyError(f"CROSS_ARCHIVE_DUPLICATE {label} {min(overlap)}")
    destination.update(addition)


def validate_funding_coverage(
    symbol: str,
    symbol_data: SymbolData,
) -> None:
    if not symbol_data.contract or not symbol_data.funding:
        raise StudyError(f"FUNDING_COVERAGE_EMPTY {symbol}")
    tolerance_ms = 60_000
    settlements = symbol_data.funding
    first_contract = min(symbol_data.contract)
    coverage_end = max(symbol_data.contract) + HOUR_MS
    if (
        settlements[0].timestamp_ms - first_contract
        > settlements[0].interval_hours * HOUR_MS + tolerance_ms
    ):
        raise StudyError(f"FUNDING_LEADING_GAP {symbol}")
    if (
        coverage_end - settlements[-1].timestamp_ms
        > settlements[-1].interval_hours * HOUR_MS + tolerance_ms
    ):
        raise StudyError(f"FUNDING_TRAILING_GAP {symbol}")
    for previous, current in zip(settlements, settlements[1:]):
        observed = current.timestamp_ms - previous.timestamp_ms
        expected = current.interval_hours * HOUR_MS
        if abs(observed - expected) >= tolerance_ms:
            raise StudyError(
                f"FUNDING_CADENCE_GAP {symbol} "
                f"previous={previous.timestamp_ms} current={current.timestamp_ms} "
                f"expected_ms={expected} observed_ms={observed}"
            )


def load_months(
    access: ArchiveAccess,
    symbols: Sequence[str],
    months: Sequence[str],
) -> dict[str, SymbolData]:
    output = {
        symbol: SymbolData(spot={}, contract={}, mark={}, funding=[])
        for symbol in symbols
    }
    for symbol in symbols:
        for month in months:
            spot_key = artifact_key("spot_kline_1h", symbol, month)
            contract_key = artifact_key("usdm_kline_1h", symbol, month)
            mark_key = artifact_key("usdm_mark_kline_1h", symbol, month)
            funding_key = artifact_key("usdm_funding_rate", symbol, month)
            merge_unique(
                output[symbol].spot,
                parse_kline_rows(access.rows(spot_key), spot_key),
                spot_key,
            )
            merge_unique(
                output[symbol].contract,
                parse_kline_rows(access.rows(contract_key), contract_key),
                contract_key,
            )
            merge_unique(
                output[symbol].mark,
                parse_kline_rows(access.rows(mark_key), mark_key),
                mark_key,
            )
            output[symbol].funding.extend(
                parse_funding_rows(access.rows(funding_key), funding_key)
            )
        output[symbol].funding.sort(key=lambda item: item.timestamp_ms)
        times = [item.timestamp_ms for item in output[symbol].funding]
        if len(times) != len(set(times)):
            raise StudyError(f"CROSS_ARCHIVE_FUNDING_DUPLICATE {symbol}")
        validate_funding_coverage(symbol, output[symbol])
    return output


def merge_data(
    first: Mapping[str, SymbolData], second: Mapping[str, SymbolData]
) -> dict[str, SymbolData]:
    output: dict[str, SymbolData] = {}
    for symbol in sorted(first):
        left = first[symbol]
        right = second[symbol]
        merged = SymbolData(
            spot=dict(left.spot),
            contract=dict(left.contract),
            mark=dict(left.mark),
            funding=list(left.funding),
        )
        merge_unique(merged.spot, right.spot, f"{symbol}.spot")
        merge_unique(merged.contract, right.contract, f"{symbol}.contract")
        merge_unique(merged.mark, right.mark, f"{symbol}.mark")
        merged.funding.extend(right.funding)
        merged.funding.sort(key=lambda item: item.timestamp_ms)
        if len({item.timestamp_ms for item in merged.funding}) != len(
            merged.funding
        ):
            raise StudyError(f"MERGED_FUNDING_DUPLICATE {symbol}")
        validate_funding_coverage(symbol, merged)
        output[symbol] = merged
    return output


def build_features(data: SymbolData) -> dict[int, Feature]:
    common = sorted(set(data.spot).intersection(data.contract))
    window: collections.deque[tuple[float, float]] = collections.deque()
    sum_x = sum_y = sum_xx = sum_yy = sum_xy = 0.0
    features: dict[int, Feature] = {}
    previous_timestamp: int | None = None

    def clear_window() -> None:
        nonlocal sum_x, sum_y, sum_xx, sum_yy, sum_xy
        window.clear()
        sum_x = sum_y = sum_xx = sum_yy = sum_xy = 0.0

    for timestamp in common:
        previous = timestamp - HOUR_MS
        if (
            previous not in data.spot
            or previous not in data.contract
            or (
                previous_timestamp is not None
                and timestamp != previous_timestamp + HOUR_MS
            )
        ):
            clear_window()
            previous_timestamp = timestamp
            continue
        spot_return = math.log(
            data.spot[timestamp].close / data.spot[previous].close
        )
        futures_return = math.log(
            data.contract[timestamp].close / data.contract[previous].close
        )
        n = len(window)
        if n >= 504:
            mean_x = sum_x / n
            mean_y = sum_y / n
            centered_xx = sum_xx - sum_x * sum_x / n
            centered_yy = sum_yy - sum_y * sum_y / n
            centered_xy = sum_xy - sum_x * sum_y / n
            if centered_xx > 1e-16 and centered_yy > 1e-16:
                beta = centered_xy / centered_xx
                alpha = mean_y - beta * mean_x
                residual_sse = centered_yy - centered_xy**2 / centered_xx
                residual_sd = math.sqrt(max(residual_sse / (n - 2), 0.0))
                reverse_beta = centered_xy / centered_yy
                reverse_alpha = mean_x - reverse_beta * mean_y
                reverse_sse = centered_xx - centered_xy**2 / centered_yy
                reverse_sd = math.sqrt(max(reverse_sse / (n - 2), 0.0))
                futures_sd = math.sqrt(centered_xx / (n - 1))
                if min(residual_sd, reverse_sd, futures_sd) > 1e-12:
                    feature = Feature(
                        spot_lead_z=(
                            spot_return - alpha - beta * futures_return
                        )
                        / residual_sd,
                        futures_comparator_z=(futures_return - mean_x)
                        / futures_sd,
                        reverse_futures_z=(
                            futures_return
                            - reverse_alpha
                            - reverse_beta * spot_return
                        )
                        / reverse_sd,
                        spot_return=spot_return,
                        futures_return=futures_return,
                    )
                    if all(
                        math.isfinite(value)
                        for value in (
                            feature.spot_lead_z,
                            feature.futures_comparator_z,
                            feature.reverse_futures_z,
                        )
                    ):
                        features[timestamp] = feature
        window.append((futures_return, spot_return))
        sum_x += futures_return
        sum_y += spot_return
        sum_xx += futures_return * futures_return
        sum_yy += spot_return * spot_return
        sum_xy += futures_return * spot_return
        if len(window) > 672:
            old_x, old_y = window.popleft()
            sum_x -= old_x
            sum_y -= old_y
            sum_xx -= old_x * old_x
            sum_yy -= old_y * old_y
            sum_xy -= old_x * old_y
        previous_timestamp = timestamp
    return features


def date_key(timestamp_ms: int) -> str:
    return dt.datetime.fromtimestamp(
        timestamp_ms / 1000, tz=dt.timezone.utc
    ).date().isoformat()


def date_range(start_ms: int, end_ms: int) -> list[str]:
    start = dt.datetime.fromtimestamp(
        start_ms / 1000, tz=dt.timezone.utc
    ).date()
    end = dt.datetime.fromtimestamp(end_ms / 1000, tz=dt.timezone.utc).date()
    output: list[str] = []
    cursor = start
    while cursor < end:
        output.append(cursor.isoformat())
        cursor += dt.timedelta(days=1)
    return output


def trial_id(horizon: int, names: int) -> str:
    return f"h{horizon}_k{names}"


def select_symbols(
    feature_map: Mapping[str, Mapping[int, Feature]],
    symbols: Sequence[str],
    timestamp: int,
    names: int,
    source: str,
) -> tuple[list[str], list[str]] | None:
    field = (
        "spot_lead_z" if source == "spot_lead" else "futures_comparator_z"
    )
    values: list[tuple[float, str]] = []
    for symbol in symbols:
        feature = feature_map[symbol].get(timestamp)
        if feature is None:
            return None
        values.append((getattr(feature, field), symbol))
    values.sort(key=lambda item: (item[0], item[1]))
    short_symbols = [symbol for _, symbol in values[:names]]
    long_symbols = [symbol for _, symbol in values[-names:]]
    if set(short_symbols).intersection(long_symbols):
        raise StudyError("SELECTION_OVERLAP")
    return long_symbols, short_symbols


def add_event(
    events: dict[str, dict[int, float]],
    scenario: str,
    timestamp: int,
    amount: float,
) -> None:
    events[scenario][timestamp] = events[scenario].get(timestamp, 0.0) + amount


def simulate(
    data: Mapping[str, SymbolData],
    feature_map: Mapping[str, Mapping[int, Feature]],
    symbols: Sequence[str],
    start_ms: int,
    end_ms: int,
    horizon: int,
    names: int,
    source: str,
) -> Simulation:
    events: dict[str, dict[int, float]] = {
        scenario: {} for scenario in SCENARIOS
    }
    formation_days: set[str] = set()
    long_seen: set[str] = set()
    short_seen: set[str] = set()
    order_flow_by_timestamp_symbol: dict[tuple[int, str], float] = {}
    marked_gross_posttrade: dict[int, float] = {}
    marked_net_posttrade: dict[int, float] = {}
    marked_gross_preclose: dict[int, float] = {}
    marked_net_preclose: dict[int, float] = {}
    formation_ledger: list[tuple[int, list[str], list[str]]] = []
    formation_count = 0
    gross_total = 0.0
    funding_total = 0.0
    timestamp = start_ms
    sleeve_gross = ENTRY_GROSS_USD / horizon
    leg_notional = sleeve_gross / (2 * names)

    while (
        timestamp + (horizon + SIGNAL_GUARD_HOURS + 1) * HOUR_MS
        < end_ms
    ):
        selection = select_symbols(
            feature_map, symbols, timestamp, names, source
        )
        if selection is None:
            timestamp += HOUR_MS
            continue
        long_symbols, short_symbols = selection
        entry_timestamp = timestamp + (SIGNAL_GUARD_HOURS + 1) * HOUR_MS
        exit_timestamp = entry_timestamp + horizon * HOUR_MS
        selected = [(symbol, 1) for symbol in long_symbols] + [
            (symbol, -1) for symbol in short_symbols
        ]
        if any(entry_timestamp not in data[symbol].contract for symbol, _ in selected):
            timestamp += HOUR_MS
            continue
        for symbol, _ in selected:
            for step in range(horizon + 1):
                required = entry_timestamp + step * HOUR_MS
                if required not in data[symbol].contract:
                    raise StudyError(
                        f"POST_ENTRY_MARK_MISSING {symbol} {required}"
                    )

        formation_count += 1
        formation_days.add(date_key(entry_timestamp))
        long_seen.update(long_symbols)
        short_seen.update(short_symbols)
        formation_ledger.append(
            (entry_timestamp, list(long_symbols), list(short_symbols))
        )

        for symbol, direction in selected:
            symbol_data = data[symbol]
            entry_price = symbol_data.contract[entry_timestamp].open
            exit_price = symbol_data.contract[exit_timestamp].open
            quantity = leg_notional / entry_price
            gross_leg = direction * quantity * (exit_price - entry_price)
            gross_total += gross_leg
            entry_flow_key = (entry_timestamp, symbol)
            exit_flow_key = (exit_timestamp, symbol)
            order_flow_by_timestamp_symbol[entry_flow_key] = (
                order_flow_by_timestamp_symbol.get(entry_flow_key, 0.0)
                + leg_notional
            )
            order_flow_by_timestamp_symbol[exit_flow_key] = (
                order_flow_by_timestamp_symbol.get(exit_flow_key, 0.0)
                + quantity * exit_price
            )
            for step in range(horizon):
                mark_timestamp = entry_timestamp + step * HOUR_MS
                marked_notional = (
                    quantity * symbol_data.contract[mark_timestamp].open
                )
                marked_gross_posttrade[mark_timestamp] = (
                    marked_gross_posttrade.get(mark_timestamp, 0.0)
                    + marked_notional
                )
                marked_net_posttrade[mark_timestamp] = (
                    marked_net_posttrade.get(mark_timestamp, 0.0)
                    + direction * marked_notional
                )
            for step in range(1, horizon + 1):
                mark_timestamp = entry_timestamp + step * HOUR_MS
                marked_notional = (
                    quantity * symbol_data.contract[mark_timestamp].open
                )
                marked_gross_preclose[mark_timestamp] = (
                    marked_gross_preclose.get(mark_timestamp, 0.0)
                    + marked_notional
                )
                marked_net_preclose[mark_timestamp] = (
                    marked_net_preclose.get(mark_timestamp, 0.0)
                    + direction * marked_notional
                )
            for scenario, cost_bps in SCENARIOS.items():
                entry_cost = leg_notional * cost_bps / 10_000
                exit_notional = quantity * exit_price
                exit_cost = exit_notional * cost_bps / 10_000
                add_event(
                    events, scenario, entry_timestamp, -entry_cost
                )
                add_event(events, scenario, exit_timestamp, -exit_cost)
                for step in range(horizon):
                    left_timestamp = entry_timestamp + step * HOUR_MS
                    right_timestamp = left_timestamp + HOUR_MS
                    left_price = symbol_data.contract[left_timestamp].open
                    right_price = symbol_data.contract[right_timestamp].open
                    add_event(
                        events,
                        scenario,
                        right_timestamp,
                        direction * quantity * (right_price - left_price),
                    )

            funding_times = [item.timestamp_ms for item in symbol_data.funding]
            left_index = bisect.bisect_left(funding_times, entry_timestamp)
            right_index = bisect.bisect_left(funding_times, exit_timestamp)
            for funding in symbol_data.funding[left_index:right_index]:
                mark_timestamp = funding.timestamp_ms // HOUR_MS * HOUR_MS
                mark_bar = symbol_data.mark.get(mark_timestamp)
                if mark_bar is None:
                    raise StudyError(
                        f"FUNDING_MARK_MISSING {symbol} "
                        f"{funding.timestamp_ms}"
                    )
                cashflow = (
                    -direction * quantity * mark_bar.open * funding.rate
                )
                funding_total += cashflow
                for scenario in SCENARIOS:
                    add_event(
                        events,
                        scenario,
                        funding.timestamp_ms,
                        cashflow,
                    )

        timestamp += HOUR_MS

    capacity_values: list[float] = []
    capacity_ledger: list[tuple[int, str, float, float]] = []
    for (
        flow_timestamp,
        flow_symbol,
    ), actual_order_notional in sorted(order_flow_by_timestamp_symbol.items()):
        prior = data[flow_symbol].contract.get(flow_timestamp - HOUR_MS)
        if prior is None:
            raise StudyError(
                f"CAPACITY_PRIOR_BAR_MISSING {flow_symbol} {flow_timestamp}"
            )
        if actual_order_notional <= 0:
            raise StudyError("CAPACITY_ORDER_NOTIONAL_NONPOSITIVE")
        capacity_ledger.append(
            (
                flow_timestamp,
                flow_symbol,
                prior.quote_volume,
                actual_order_notional,
            )
        )
        capacity_values.append(
            prior.quote_volume
            * 0.0001
            / (actual_order_notional / 1000.0)
        )

    dates = date_range(start_ms, end_ms)
    daily_by_scenario: dict[str, list[float]] = {}
    hourly_by_scenario: dict[str, list[tuple[int, float]]] = {}
    for scenario in SCENARIOS:
        ordered = sorted(events[scenario].items())
        hourly_by_scenario[scenario] = ordered
        daily = {date: 0.0 for date in dates}
        for event_timestamp, amount in ordered:
            key = date_key(event_timestamp)
            if key in daily:
                daily[key] += amount
        daily_by_scenario[scenario] = [daily[date] for date in dates]
    pre_rpi = sum(
        amount
        for event_timestamp, amount in hourly_by_scenario["stress"]
        if event_timestamp < RPI_BREAK_MS
    )
    post_rpi = sum(
        amount
        for event_timestamp, amount in hourly_by_scenario["stress"]
        if event_timestamp >= RPI_BREAK_MS
    )
    marked_exposure_ledger = [
        (
            timestamp,
            "POSTTRADE",
            marked_gross_posttrade[timestamp],
            marked_net_posttrade[timestamp],
        )
        for timestamp in sorted(marked_gross_posttrade)
    ] + [
        (
            timestamp,
            "PRECLOSE",
            marked_gross_preclose[timestamp],
            marked_net_preclose[timestamp],
        )
        for timestamp in sorted(marked_gross_preclose)
    ]
    return Simulation(
        trial_id=trial_id(horizon, names),
        horizon_hours=horizon,
        names_per_side=names,
        source=source,
        daily_dates=dates,
        daily_by_scenario=daily_by_scenario,
        hourly_by_scenario=hourly_by_scenario,
        formation_ledger=formation_ledger,
        capacity_ledger=capacity_ledger,
        marked_exposure_ledger=marked_exposure_ledger,
        formation_count=formation_count,
        active_days=len(formation_days),
        long_symbols=sorted(long_seen),
        short_symbols=sorted(short_seen),
        capacity_values_usd=capacity_values,
        pre_rpi_stress_usd=pre_rpi,
        post_rpi_stress_usd=post_rpi,
        gross_usd=gross_total,
        funding_usd=funding_total,
        maximum_marked_gross_usd=max(
            [
                *marked_gross_posttrade.values(),
                *marked_gross_preclose.values(),
            ],
            default=0.0,
        ),
        maximum_abs_marked_net_notional_usd=max(
            (
                abs(value)
                for value in [
                    *marked_net_posttrade.values(),
                    *marked_net_preclose.values(),
                ]
            ),
            default=0.0,
        ),
    )


def reverse_diagnostic_bps(
    data: Mapping[str, SymbolData],
    feature_map: Mapping[str, Mapping[int, Feature]],
    symbols: Sequence[str],
    start_ms: int,
    end_ms: int,
    horizon: int,
    names: int,
) -> dict[str, Any]:
    values: list[float] = []
    timestamp = start_ms
    while (
        timestamp + (horizon + SIGNAL_GUARD_HOURS + 1) * HOUR_MS
        < end_ms
    ):
        ranked: list[tuple[float, str]] = []
        missing = False
        for symbol in symbols:
            feature = feature_map[symbol].get(timestamp)
            if feature is None:
                missing = True
                break
            ranked.append((feature.reverse_futures_z, symbol))
        if missing:
            timestamp += HOUR_MS
            continue
        ranked.sort(key=lambda item: (item[0], item[1]))
        short_symbols = [symbol for _, symbol in ranked[:names]]
        long_symbols = [symbol for _, symbol in ranked[-names:]]
        entry = timestamp + (SIGNAL_GUARD_HOURS + 1) * HOUR_MS
        exit_timestamp = entry + horizon * HOUR_MS
        if any(
            entry not in data[symbol].spot
            or exit_timestamp not in data[symbol].spot
            for symbol in long_symbols + short_symbols
        ):
            timestamp += HOUR_MS
            continue
        long_return = sum(
            data[symbol].spot[exit_timestamp].open
            / data[symbol].spot[entry].open
            - 1
            for symbol in long_symbols
        ) / names
        short_return = sum(
            data[symbol].spot[exit_timestamp].open
            / data[symbol].spot[entry].open
            - 1
            for symbol in short_symbols
        ) / names
        values.append((long_return - short_return) * 5000.0)
        timestamp += HOUR_MS
    return {
        "formations": len(values),
        "mean_futures_to_spot_long_short_bps": (
            sum(values) / len(values) if values else None
        ),
        "role": "DIAGNOSTIC_ONLY_NO_SPOT_TRADE",
    }


def percentile(values: Sequence[float], probability: float) -> float:
    if not values:
        raise StudyError("PERCENTILE_EMPTY")
    ordered = sorted(values)
    position = probability * (len(ordered) - 1)
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def maximum_drawdown(events: Sequence[tuple[int, float]]) -> float:
    equity = 0.0
    peak = 0.0
    drawdown = 0.0
    for _, amount in events:
        equity += amount
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    return drawdown


def common_bootstrap_starts(
    day_count: int, replicates: int, block_days: int, seed: int
) -> list[list[int]]:
    rng = random.Random(seed)
    blocks = math.ceil(day_count / block_days)
    return [
        [rng.randrange(day_count) for _ in range(blocks)]
        for _ in range(replicates)
    ]


def bootstrap_means(
    series_by_trial: Sequence[Sequence[float]],
    starts: Sequence[Sequence[int]],
    block_days: int,
) -> list[list[float]]:
    if not series_by_trial:
        raise StudyError("BOOTSTRAP_NO_SERIES")
    day_count = len(series_by_trial[0])
    if any(len(series) != day_count for series in series_by_trial):
        raise StudyError("BOOTSTRAP_LENGTH_MISMATCH")
    output = [[] for _ in series_by_trial]
    for replicate_starts in starts:
        sums = [0.0] * len(series_by_trial)
        used = 0
        for start in replicate_starts:
            for offset in range(block_days):
                if used >= day_count:
                    break
                index = (start + offset) % day_count
                for trial_index, series in enumerate(series_by_trial):
                    sums[trial_index] += series[index]
                used += 1
            if used >= day_count:
                break
        for trial_index, total in enumerate(sums):
            output[trial_index].append(total / day_count)
    return output


def one_sided_centered_p(
    observed_mean: float, bootstrap: Sequence[float]
) -> float:
    exceedances = sum(
        1 for value in bootstrap if value - observed_mean >= observed_mean
    )
    return (exceedances + 1) / (len(bootstrap) + 1)


def holm_adjust(p_values: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(p_values.items(), key=lambda item: (item[1], item[0]))
    count = len(ordered)
    adjusted: dict[str, float] = {}
    running = 0.0
    for index, (name, value) in enumerate(ordered):
        candidate = min(1.0, (count - index) * value)
        running = max(running, candidate)
        adjusted[name] = running
    return adjusted


def pbo_diagnostic(
    trial_ids: Sequence[str],
    simulations: Mapping[str, Simulation],
) -> dict[str, Any]:
    months = [
        "2025-07",
        "2025-08",
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
    ]
    month_means: dict[str, list[float]] = {}
    for identifier in trial_ids:
        simulation = simulations[identifier]
        values: list[float] = []
        for month in months:
            month_values = [
                amount
                for date, amount in zip(
                    simulation.daily_dates,
                    simulation.daily_by_scenario["stress"],
                )
                if date.startswith(month)
            ]
            values.append(
                sum(month_values) / len(month_values)
                if month_values
                else float("-inf")
            )
        month_means[identifier] = values
    underperformed = 0
    selections: dict[str, int] = {identifier: 0 for identifier in trial_ids}
    split_count = 0
    for train_indices in itertools.combinations(range(8), 4):
        train = set(train_indices)
        test = [index for index in range(8) if index not in train]
        in_sample = {
            identifier: statistics.fmean(
                month_means[identifier][index] for index in train
            )
            for identifier in trial_ids
        }
        selected = max(
            trial_ids, key=lambda item: (in_sample[item], tuple(-ord(c) for c in item))
        )
        selections[selected] += 1
        out_sample = {
            identifier: statistics.fmean(
                month_means[identifier][index] for index in test
            )
            for identifier in trial_ids
        }
        median = statistics.median(out_sample.values())
        if out_sample[selected] <= median:
            underperformed += 1
        split_count += 1
    return {
        "combinations": split_count,
        "pbo": underperformed / split_count,
        "reference": 0.5,
        "role": "DIAGNOSTIC_ONLY",
        "selection_counts": selections,
    }


def monthly_sums(simulation: Simulation, scenario: str) -> dict[str, float]:
    output: dict[str, float] = {}
    for date, value in zip(
        simulation.daily_dates, simulation.daily_by_scenario[scenario]
    ):
        month = date[:7]
        output[month] = output.get(month, 0.0) + value
    return output


def simulation_summary(simulation: Simulation) -> dict[str, Any]:
    totals = {
        scenario: sum(simulation.daily_by_scenario[scenario])
        for scenario in SCENARIOS
    }
    capacity_p05 = (
        percentile(simulation.capacity_values_usd, 0.05)
        if simulation.capacity_values_usd
        else 0.0
    )
    return {
        "active_utc_days": simulation.active_days,
        "capacity_proxy_p05_usd": capacity_p05,
        "funding_usd": simulation.funding_usd,
        "gross_before_cost_and_funding_usd": simulation.gross_usd,
        "horizon_hours": simulation.horizon_hours,
        "long_symbols": simulation.long_symbols,
        "maximum_abs_marked_net_notional_usd": (
            simulation.maximum_abs_marked_net_notional_usd
        ),
        "maximum_drawdown_usd": {
            scenario: maximum_drawdown(
                simulation.hourly_by_scenario[scenario]
            )
            for scenario in SCENARIOS
        },
        "maximum_marked_gross_usd": simulation.maximum_marked_gross_usd,
        "monthly_stress_usd": monthly_sums(simulation, "stress"),
        "names_per_side": simulation.names_per_side,
        "post_rpi_stress_usd": simulation.post_rpi_stress_usd,
        "pre_rpi_stress_usd": simulation.pre_rpi_stress_usd,
        "portfolio_formations": simulation.formation_count,
        "short_symbols": simulation.short_symbols,
        "source": simulation.source,
        "totals_usd_per_1000": totals,
        "trial_id": simulation.trial_id,
    }


def simulation_audit_ledger(simulation: Simulation) -> dict[str, Any]:
    """Serialize the minimum path evidence needed to derive every GO gate."""
    return {
        "capacity_observations": simulation.capacity_ledger,
        "formations": simulation.formation_ledger,
        "hourly_pnl": {
            scenario: simulation.hourly_by_scenario[scenario]
            for scenario in SCENARIOS
        },
        "marked_exposure": simulation.marked_exposure_ledger,
    }


def development_statistics(
    candidates: Mapping[str, Simulation],
    comparators: Mapping[str, Simulation],
    replicates: int,
    seed: int,
    expected_symbols: Sequence[str],
) -> tuple[dict[str, Any], str, bool]:
    identifiers = sorted(candidates)
    stress = [
        candidates[identifier].daily_by_scenario["stress"]
        for identifier in identifiers
    ]
    excess = [
        [
            candidate - comparator
            for candidate, comparator in zip(
                candidates[identifier].daily_by_scenario["stress"],
                comparators[identifier].daily_by_scenario["stress"],
            )
        ]
        for identifier in identifiers
    ]
    day_count = len(stress[0])
    starts = common_bootstrap_starts(day_count, replicates, 7, seed)
    stress_bootstrap = bootstrap_means(stress, starts, 7)
    excess_bootstrap = bootstrap_means(excess, starts, 7)
    observed_stress = [statistics.fmean(values) for values in stress]
    observed_excess = [statistics.fmean(values) for values in excess]

    raw_p: dict[str, float] = {}
    for index, identifier in enumerate(identifiers):
        raw_p[f"{identifier}.absolute"] = one_sided_centered_p(
            observed_stress[index], stress_bootstrap[index]
        )
        raw_p[f"{identifier}.excess"] = one_sided_centered_p(
            observed_excess[index], excess_bootstrap[index]
        )
    adjusted = holm_adjust(raw_p)
    observed_max = max(observed_excess)
    white_exceedances = 0
    for replicate in range(replicates):
        centered_max = max(
            excess_bootstrap[index][replicate] - observed_excess[index]
            for index in range(len(identifiers))
        )
        if centered_max >= observed_max:
            white_exceedances += 1
    white_p = (white_exceedances + 1) / (replicates + 1)

    summaries: dict[str, Any] = {}
    for index, identifier in enumerate(identifiers):
        candidate = candidates[identifier]
        comparator = comparators[identifier]
        candidate_summary = simulation_summary(candidate)
        comparator_summary = simulation_summary(comparator)
        stress_distribution = [
            value * day_count for value in stress_bootstrap[index]
        ]
        excess_distribution = [
            value * day_count for value in excess_bootstrap[index]
        ]
        monthly = candidate_summary["monthly_stress_usd"]
        remove_best_month = sum(monthly.values()) - max(monthly.values())
        gates = {
            "active_days": candidate.active_days >= 120,
            "base_positive": candidate_summary["totals_usd_per_1000"][
                "base"
            ]
            > 0,
            "capacity": candidate_summary["capacity_proxy_p05_usd"] >= 1000,
            "directions": (
                candidate.long_symbols == sorted(expected_symbols)
                and candidate.short_symbols == sorted(expected_symbols)
            ),
            "formations": candidate.formation_count >= 1000,
            "holm_absolute": adjusted[f"{identifier}.absolute"] <= 0.05,
            "holm_excess": adjusted[f"{identifier}.excess"] <= 0.05,
            "marked_gross": (
                candidate_summary["maximum_marked_gross_usd"] <= 1000
            ),
            "remove_best_month": remove_best_month > 0,
            "severe_drawdown": candidate_summary["maximum_drawdown_usd"][
                "severe"
            ]
            <= 100,
            "severe_positive": candidate_summary["totals_usd_per_1000"][
                "severe"
            ]
            > 0,
            "stress_excess_lcb": percentile(excess_distribution, 0.05) > 0,
            "stress_lcb": percentile(stress_distribution, 0.05) > 0,
            "stress_positive": candidate_summary["totals_usd_per_1000"][
                "stress"
            ]
            > 0,
            "white_reality_check": white_p <= 0.05,
        }
        summaries[identifier] = {
            "bootstrap": {
                "absolute_stress_90pct_interval_usd": [
                    percentile(stress_distribution, 0.05),
                    percentile(stress_distribution, 0.95),
                ],
                "matched_excess_90pct_interval_usd": [
                    percentile(excess_distribution, 0.05),
                    percentile(excess_distribution, 0.95),
                ],
                "replicates": replicates,
            },
            "candidate": candidate_summary,
            "comparator": comparator_summary,
            "gates": gates,
            "holm_adjusted_p": {
                "absolute": adjusted[f"{identifier}.absolute"],
                "matched_excess": adjusted[f"{identifier}.excess"],
            },
            "raw_p": {
                "absolute": raw_p[f"{identifier}.absolute"],
                "matched_excess": raw_p[f"{identifier}.excess"],
            },
            "remove_best_month_stress_usd": remove_best_month,
        }
    champion = max(
        identifiers,
        key=lambda identifier: (
            summaries[identifier]["candidate"]["totals_usd_per_1000"][
                "stress"
            ],
            tuple(-ord(character) for character in identifier),
        ),
    )
    champion_pass = all(summaries[champion]["gates"].values())
    statistics_packet = {
        "champion": champion,
        "champion_development_pass": champion_pass,
        "holm_family_size": 24,
        "pbo": pbo_diagnostic(identifiers, candidates),
        "trials": summaries,
        "white_reality_check": {
            "observed_max_matched_excess_daily_mean_usd": observed_max,
            "p_value": white_p,
            "replicates": replicates,
        },
    }
    return statistics_packet, champion, champion_pass
def holdout_statistics(
    candidate: Simulation,
    comparator: Simulation,
    replicates: int,
    seed: int,
    expected_symbols: Sequence[str],
) -> tuple[dict[str, Any], bool]:
    stress = candidate.daily_by_scenario["stress"]
    excess = [
        left - right
        for left, right in zip(
            stress, comparator.daily_by_scenario["stress"]
        )
    ]
    starts = common_bootstrap_starts(len(stress), replicates, 7, seed)
    stress_bootstrap = bootstrap_means([stress], starts, 7)[0]
    excess_bootstrap = bootstrap_means([excess], starts, 7)[0]
    stress_distribution = [value * len(stress) for value in stress_bootstrap]
    excess_distribution = [value * len(excess) for value in excess_bootstrap]
    summary = simulation_summary(candidate)
    gates = {
        "active_days": candidate.active_days >= 60,
        "capacity": summary["capacity_proxy_p05_usd"] >= 1000,
        "directions": (
            candidate.long_symbols == sorted(expected_symbols)
            and candidate.short_symbols == sorted(expected_symbols)
        ),
        "formations": candidate.formation_count >= 400,
        "marked_gross": summary["maximum_marked_gross_usd"] <= 1000,
        "severe_drawdown": summary["maximum_drawdown_usd"]["severe"] <= 100,
        "severe_positive": summary["totals_usd_per_1000"]["severe"] > 0,
        "stress_excess_lcb": percentile(excess_distribution, 0.05) > 0,
        "stress_lcb": percentile(stress_distribution, 0.05) > 0,
        "stress_positive": summary["totals_usd_per_1000"]["stress"] > 0,
    }
    packet = {
        "bootstrap": {
            "absolute_stress_90pct_interval_usd": [
                percentile(stress_distribution, 0.05),
                percentile(stress_distribution, 0.95),
            ],
            "matched_excess_90pct_interval_usd": [
                percentile(excess_distribution, 0.05),
                percentile(excess_distribution, 0.95),
            ],
            "replicates": replicates,
        },
        "candidate": summary,
        "comparator": simulation_summary(comparator),
        "gates": gates,
    }
    return packet, all(gates.values())


def development_ledger(
    statistics_packet: Mapping[str, Any],
    candidates: Mapping[str, Simulation],
    comparators: Mapping[str, Simulation],
    reverse: Mapping[str, Any],
    identity: Mapping[str, str],
    access: ArchiveAccess,
) -> dict[str, Any]:
    daily: dict[str, Any] = {}
    for identifier in sorted(candidates):
        daily[identifier] = {
            "candidate": {
                scenario: candidates[identifier].daily_by_scenario[scenario]
                for scenario in SCENARIOS
            },
            "comparator": {
                scenario: comparators[identifier].daily_by_scenario[scenario]
                for scenario in SCENARIOS
            },
            "dates": candidates[identifier].daily_dates,
        }
    return {
        "archive_member_keys_opened": sorted(access.opened_keys),
        "archive_members_opened": len(access.opened_keys),
        "candidate_audit_ledger": {
            identifier: simulation_audit_ledger(candidates[identifier])
            for identifier in sorted(candidates)
        },
        "daily_ledger": daily,
        "git": identity,
        "reverse_direction_diagnostic": reverse,
        "schema": "cosmos.s2i.development.v1",
        "statistics": statistics_packet,
    }


def write_terminal(result: Mapping[str, Any]) -> None:
    evidence_paths = [
        FREEZE_PATH,
        RUN_RECEIPT_PATH,
        DEVELOPMENT_OPEN_PATH,
        DEVELOPMENT_PATH,
        RESULT_PATH,
    ]
    if CANDIDATE_PATH.exists():
        evidence_paths.append(CANDIDATE_PATH)
    if HOLDOUT_OPEN_PATH.exists():
        evidence_paths.append(HOLDOUT_OPEN_PATH)
    if FAILURE_PATH.exists():
        evidence_paths.append(FAILURE_PATH)
    evidence = file_inventory(evidence_paths)
    terminal = {
        "capital_authority": "NONE",
        "consumer": "N3 successor/final convergence",
        "evidence_inventory": evidence,
        "result_sha256": sha256_file(RESULT_PATH),
        "schema": "cosmos.s2i.terminal.v1",
        "status": result["verdict"],
    }
    atomic_write(TERMINAL_PATH, canonical_json_bytes(terminal))
    checksum_paths = evidence_paths + [TERMINAL_PATH, MANIFEST_PATH]
    lines = [
        f"{sha256_file(path)}  {path.relative_to(PACKET_DIR).as_posix()}"
        for path in sorted(checksum_paths)
    ]
    atomic_write(SUMS_PATH, ("\n".join(lines) + "\n").encode("utf-8"))


def seal_unmeasured(
    code: str,
    detail: str,
    identity: Mapping[str, str],
    holdout_gate_consumed: bool,
    holdout_member_keys: Sequence[str],
) -> dict[str, Any]:
    error_packet = {"code": code, "detail": detail}
    development_preserved = DEVELOPMENT_PATH.is_file()
    if not development_preserved:
        development = {
            "error": error_packet,
            "git": identity,
            "schema": "cosmos.s2i.development.v1",
            "status": "UNMEASURED",
        }
        atomic_write(DEVELOPMENT_PATH, canonical_json_bytes(development))
    failure = {
        "candidate_seal_sha256": (
            sha256_file(CANDIDATE_PATH) if CANDIDATE_PATH.is_file() else None
        ),
        "development_preserved": development_preserved,
        "development_sha256": sha256_file(DEVELOPMENT_PATH),
        "error": error_packet,
        "git": identity,
        "holdout_gate_consumed": holdout_gate_consumed,
        "holdout_member_keys_opened": sorted(holdout_member_keys),
        "holdout_opened_sha256": (
            sha256_file(HOLDOUT_OPEN_PATH)
            if HOLDOUT_OPEN_PATH.is_file()
            else None
        ),
        "schema": "cosmos.s2i.terminal-failure.v1",
        "stage": (
            "HOLDOUT"
            if holdout_gate_consumed
            else (
                "POST_DEVELOPMENT"
                if development_preserved
                else "DEVELOPMENT"
            )
        ),
    }
    atomic_write(FAILURE_PATH, canonical_json_bytes(failure))
    result = {
        "account_effective_commission": "UNKNOWN",
        "capital_authority": "NONE",
        "consumer": "N3 successor/final convergence",
        "development_state": (
            "PRESERVED_SEALED_LEDGER"
            if development_preserved
            else "UNMEASURED_ERROR_LEDGER"
        ),
        "error": error_packet,
        "executable_capacity": "UNMEASURED",
        "git": identity,
        "holdout": {
            "archive_member_keys_opened": sorted(holdout_member_keys),
            "archive_members_opened": len(holdout_member_keys),
            "gate_consumed": holdout_gate_consumed,
            "state": (
                "GATE_CONSUMED_TERMINAL_FAILURE"
                if holdout_gate_consumed
                else "UNOPENED"
            ),
        },
        "limitations": list(REQUIRED_LIMITATIONS),
        "public_capacity_proxy_p05_usd": "UNMEASURED",
        "schema": "cosmos.s2i.result.v1",
        "source_manifest_sha256": sha256_file(MANIFEST_PATH),
        "verdict": "UNMEASURED",
    }
    atomic_write(RESULT_PATH, canonical_json_bytes(result))
    write_terminal(result)
    return result


def run_study(raw_root: pathlib.Path) -> dict[str, Any]:
    require_canonical_roots(raw_root)
    state_root = CANONICAL_STATE_ROOT
    protocol, manifest = validate_freeze(raw_root)
    identity = git_identity(require_clean=True)
    static_commit = str(load_json(FREEZE_PATH)["static_commit"])
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", static_commit, "HEAD"],
        cwd=REPO_ROOT,
        check=False,
    ).returncode
    if ancestor != 0:
        raise StudyError("FREEZE_LINEAGE")
    if any(
        path.exists()
        for path in (
            RUN_RECEIPT_PATH,
            DEVELOPMENT_OPEN_PATH,
            DEVELOPMENT_PATH,
            CANDIDATE_PATH,
            HOLDOUT_OPEN_PATH,
            FAILURE_PATH,
            RESULT_PATH,
            TERMINAL_PATH,
            SUMS_PATH,
            PACKET_DIR / "POSTRUN_VERIFICATION.v1.json",
        )
    ):
        raise StudyError("TRACKED_RUN_ARTIFACT_PREEXISTS")

    run_payload = {
        "freeze_sha256": sha256_file(FREEZE_PATH),
        "git": identity,
        "run_started_at_utc": acquisition.utc_now(),
        "raw_root": str(CANONICAL_RAW_ROOT.resolve()),
        "schema": "cosmos.s2i.run-consumed.v1",
        "state_root": str(CANONICAL_STATE_ROOT.resolve()),
        "state": "CONSUMED_BEFORE_ANY_ARCHIVE_MEMBER_ACCESS",
    }
    state_marker = state_root / "RUN_GATE.v1.json"
    payload = canonical_json_bytes(run_payload)
    atomic_create_once(state_marker, payload)
    atomic_write(RUN_RECEIPT_PATH, payload)
    development_open = {
        "authorized_partitions": ["WARMUP", "DEVELOPMENT"],
        "git": identity,
        "schema": "cosmos.s2i.development-opened.v1",
        "state": "WRITTEN_BEFORE_FIRST_DEVELOPMENT_MEMBER_ACCESS",
    }
    atomic_write(
        DEVELOPMENT_OPEN_PATH, canonical_json_bytes(development_open)
    )

    holdout_gate_consumed = False
    holdout_access: ArchiveAccess | None = None
    try:
        symbols = list(protocol["universe"]["symbols"])
        development_access = ArchiveAccess(
            manifest, raw_root, holdout_allowed=False
        )
        development_data = load_months(
            development_access, symbols, WARMUP_DEVELOPMENT_MONTHS
        )
        features = {
            symbol: build_features(development_data[symbol])
            for symbol in symbols
        }
        candidates: dict[str, Simulation] = {}
        comparators: dict[str, Simulation] = {}
        reverse: dict[str, Any] = {}
        for horizon, names in TRIALS:
            identifier = trial_id(horizon, names)
            candidates[identifier] = simulate(
                development_data,
                features,
                symbols,
                DEVELOPMENT_START_MS,
                DEVELOPMENT_END_MS,
                horizon,
                names,
                "spot_lead",
            )
            comparators[identifier] = simulate(
                development_data,
                features,
                symbols,
                DEVELOPMENT_START_MS,
                DEVELOPMENT_END_MS,
                horizon,
                names,
                "futures_comparator",
            )
            reverse[identifier] = reverse_diagnostic_bps(
                development_data,
                features,
                symbols,
                DEVELOPMENT_START_MS,
                DEVELOPMENT_END_MS,
                horizon,
                names,
            )
        replicates = int(protocol["statistics"]["bootstrap"]["replicates"])
        seed = int(protocol["statistics"]["bootstrap"]["seed"])
        statistics_packet, champion, development_pass = (
            development_statistics(
                candidates, comparators, replicates, seed, symbols
            )
        )
        ledger = development_ledger(
            statistics_packet,
            candidates,
            comparators,
            reverse,
            identity,
            development_access,
        )
        atomic_write(DEVELOPMENT_PATH, canonical_json_bytes(ledger))

        holdout_packet: dict[str, Any]
        holdout_pass = False
        if development_pass:
            champion_horizon = candidates[champion].horizon_hours
            champion_names = candidates[champion].names_per_side
            candidate = {
                "champion_trial_id": champion,
                "development_sha256": sha256_file(DEVELOPMENT_PATH),
                "git": identity,
                "horizon_hours": champion_horizon,
                "names_per_side": champion_names,
                "schema": "cosmos.s2i.candidate-seal.v1",
                "state": "SEALED_BEFORE_HOLDOUT_MEMBER_ACCESS",
            }
            atomic_write(CANDIDATE_PATH, canonical_json_bytes(candidate))
            holdout_gate = {
                "candidate_seal_sha256": sha256_file(CANDIDATE_PATH),
                "git": identity,
                "schema": "cosmos.s2i.holdout-opened.v1",
                "state": "CONSUMED_BEFORE_FIRST_HOLDOUT_MEMBER_ACCESS",
            }
            holdout_payload = canonical_json_bytes(holdout_gate)
            atomic_create_once(
                state_root / "HOLDOUT_GATE.v1.json", holdout_payload
            )
            holdout_gate_consumed = True
            atomic_write(HOLDOUT_OPEN_PATH, holdout_payload)
            holdout_access = ArchiveAccess(
                manifest, raw_root, holdout_allowed=True
            )
            holdout_only = load_months(
                holdout_access, symbols, EMBARGO_HOLDOUT_MONTHS
            )
            combined = merge_data(development_data, holdout_only)
            combined_features = {
                symbol: build_features(combined[symbol]) for symbol in symbols
            }
            holdout_candidate = simulate(
                combined,
                combined_features,
                symbols,
                HOLDOUT_START_MS,
                HOLDOUT_END_MS,
                champion_horizon,
                champion_names,
                "spot_lead",
            )
            holdout_comparator = simulate(
                combined,
                combined_features,
                symbols,
                HOLDOUT_START_MS,
                HOLDOUT_END_MS,
                champion_horizon,
                champion_names,
                "futures_comparator",
            )
            holdout_statistics_packet, holdout_pass = holdout_statistics(
                holdout_candidate,
                holdout_comparator,
                replicates,
                seed + 1,
                symbols,
            )
            holdout_packet = {
                "archive_member_keys_opened": sorted(
                    holdout_access.opened_keys
                ),
                "archive_members_opened": len(holdout_access.opened_keys),
                "candidate_audit_ledger": simulation_audit_ledger(
                    holdout_candidate
                ),
                "daily_ledger": {
                    "candidate": {
                        scenario: holdout_candidate.daily_by_scenario[
                            scenario
                        ]
                        for scenario in SCENARIOS
                    },
                    "comparator": {
                        scenario: holdout_comparator.daily_by_scenario[
                            scenario
                        ]
                        for scenario in SCENARIOS
                    },
                    "dates": holdout_candidate.daily_dates,
                },
                "gate_consumed": True,
                "state": "OPENED_AFTER_DEVELOPMENT_PASS",
                "statistics": holdout_statistics_packet,
            }
        else:
            holdout_packet = {
                "archive_members_opened": 0,
                "gate_consumed": False,
                "state": "UNOPENED_CONDITIONAL_DEVELOPMENT_GATE_FAILED",
            }

        verdict = (
            "GO_PUBLIC_PROXY_LOCAL"
            if development_pass and holdout_pass
            else "NO_GO"
        )
        champion_summary = statistics_packet["trials"][champion]
        result = {
            "account_effective_commission": "UNKNOWN",
            "capital_authority": "NONE",
            "champion": champion,
            "consumer": "N3 successor/final convergence",
            "development": {
                "all_gates_pass": development_pass,
                "matched_excess_90pct_interval_usd": champion_summary[
                    "bootstrap"
                ]["matched_excess_90pct_interval_usd"],
                "maximum_abs_marked_net_notional_usd": champion_summary[
                    "candidate"
                ]["maximum_abs_marked_net_notional_usd"],
                "maximum_drawdown_usd": champion_summary["candidate"][
                    "maximum_drawdown_usd"
                ],
                "maximum_marked_gross_usd": champion_summary["candidate"][
                    "maximum_marked_gross_usd"
                ],
                "multiplicity": {
                    "holm_adjusted_p": champion_summary["holm_adjusted_p"],
                    "holm_family_size": statistics_packet[
                        "holm_family_size"
                    ],
                    "white_reality_check": statistics_packet[
                        "white_reality_check"
                    ],
                },
                "net_usd_per_1000": champion_summary["candidate"][
                    "totals_usd_per_1000"
                ],
                "pbo": statistics_packet["pbo"],
                "stress_90pct_interval_usd": champion_summary["bootstrap"][
                    "absolute_stress_90pct_interval_usd"
                ],
            },
            "executable_capacity": "UNMEASURED",
            "git": identity,
            "holdout": holdout_packet,
            "limitations": list(REQUIRED_LIMITATIONS),
            "public_capacity_proxy_p05_usd": champion_summary["candidate"][
                "capacity_proxy_p05_usd"
            ],
            "schema": "cosmos.s2i.result.v1",
            "source_manifest_sha256": sha256_file(MANIFEST_PATH),
            "verdict": verdict,
        }
        atomic_write(RESULT_PATH, canonical_json_bytes(result))
        write_terminal(result)
        return result
    except StudyError as error:
        return seal_unmeasured(
            error.__class__.__name__,
            str(error),
            identity,
            holdout_gate_consumed,
            holdout_access.opened_keys if holdout_access else [],
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    freeze_parser = subparsers.add_parser("freeze")
    freeze_parser.add_argument("--raw-root", type=pathlib.Path, required=True)
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--raw-root", type=pathlib.Path, required=True)
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    if arguments.command == "freeze":
        return command_freeze(arguments.raw_root)
    if arguments.command == "run":
        result = run_study(arguments.raw_root)
        print(
            json.dumps(
                {
                    "consumer": result["consumer"],
                    "holdout_state": result["holdout"]["state"],
                    "verdict": result["verdict"],
                },
                sort_keys=True,
            )
        )
        return 0
    raise StudyError(f"UNKNOWN_COMMAND {arguments.command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except StudyError as error:
        print(f"S2I_EXPERIMENT_STOP {error}")
        raise SystemExit(2)
