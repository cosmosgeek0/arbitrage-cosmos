#!/usr/bin/env python3
"""Offline semantic and custody verifier for the sealed S-2I packet."""

from __future__ import annotations

import argparse
import itertools
import json
import math
import pathlib
import stat
import statistics as py_statistics
from typing import Any, Iterable, Mapping, Sequence

import acquisition
import experiment


PACKET_DIR = pathlib.Path(__file__).resolve().parent
POSTRUN_PATH = PACKET_DIR / "POSTRUN_VERIFICATION.v1.json"
DEVELOPMENT_GATE_KEYS = frozenset(
    {
        "active_days",
        "base_positive",
        "capacity",
        "directions",
        "formations",
        "holm_absolute",
        "holm_excess",
        "marked_gross",
        "remove_best_month",
        "severe_drawdown",
        "severe_positive",
        "stress_excess_lcb",
        "stress_lcb",
        "stress_positive",
        "white_reality_check",
    }
)
HOLDOUT_GATE_KEYS = frozenset(
    {
        "active_days",
        "capacity",
        "directions",
        "formations",
        "marked_gross",
        "severe_drawdown",
        "severe_positive",
        "stress_excess_lcb",
        "stress_lcb",
        "stress_positive",
    }
)


class VerificationError(RuntimeError):
    """Evidence verification failure."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise VerificationError(code)


def require_regular_file(path: pathlib.Path, code: str) -> None:
    require(
        path.exists()
        and not path.is_symlink()
        and stat.S_ISREG(path.lstat().st_mode),
        code,
    )


def path_present(path: pathlib.Path) -> bool:
    return path.exists() or path.is_symlink()


def expected_evidence_paths() -> list[pathlib.Path]:
    paths = [
        experiment.FREEZE_PATH,
        experiment.RUN_RECEIPT_PATH,
        experiment.DEVELOPMENT_OPEN_PATH,
        experiment.DEVELOPMENT_PATH,
        experiment.RESULT_PATH,
    ]
    if path_present(experiment.CANDIDATE_PATH):
        paths.append(experiment.CANDIDATE_PATH)
    if path_present(experiment.HOLDOUT_OPEN_PATH):
        paths.append(experiment.HOLDOUT_OPEN_PATH)
    if path_present(experiment.FAILURE_PATH):
        paths.append(experiment.FAILURE_PATH)
    return paths


def verify_checksum_file(evidence_paths: Sequence[pathlib.Path]) -> None:
    checksum_paths = list(evidence_paths) + [
        experiment.TERMINAL_PATH,
        experiment.MANIFEST_PATH,
    ]
    expected = [
        (
            f"{experiment.sha256_file(path)}  "
            f"{path.relative_to(PACKET_DIR).as_posix()}"
        )
        for path in sorted(checksum_paths)
    ]
    require_regular_file(experiment.SUMS_PATH, "SHA256SUMS_NOT_REGULAR")
    found = experiment.SUMS_PATH.read_text(encoding="utf-8").splitlines()
    require(found == expected, "SHA256SUMS_EXACT_INVENTORY")


def verify_receipts(
    evidence_commit: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    for path, code in (
        (experiment.FREEZE_PATH, "FREEZE_NOT_REGULAR"),
        (experiment.RUN_RECEIPT_PATH, "RUN_NOT_REGULAR"),
        (experiment.DEVELOPMENT_OPEN_PATH, "DEVELOPMENT_OPEN_NOT_REGULAR"),
    ):
        require_regular_file(path, code)
    freeze = experiment.load_json(experiment.FREEZE_PATH)
    run = experiment.load_json(experiment.RUN_RECEIPT_PATH)
    opened = experiment.load_json(experiment.DEVELOPMENT_OPEN_PATH)
    require(
        run.get("schema") == "cosmos.s2i.run-consumed.v1",
        "RUN_SCHEMA",
    )
    require(
        run.get("state")
        == "CONSUMED_BEFORE_ANY_ARCHIVE_MEMBER_ACCESS",
        "RUN_STATE",
    )
    require(
        run.get("freeze_sha256")
        == experiment.sha256_file(experiment.FREEZE_PATH),
        "RUN_FREEZE_BINDING",
    )
    require(
        run.get("raw_root") == str(experiment.CANONICAL_RAW_ROOT.resolve()),
        "RUN_RAW_ROOT",
    )
    require(
        run.get("state_root")
        == str(experiment.CANONICAL_STATE_ROOT.resolve()),
        "RUN_STATE_ROOT",
    )
    require(
        opened.get("schema") == "cosmos.s2i.development-opened.v1",
        "DEVELOPMENT_OPEN_SCHEMA",
    )
    require(
        opened.get("state")
        == "WRITTEN_BEFORE_FIRST_DEVELOPMENT_MEMBER_ACCESS",
        "DEVELOPMENT_OPEN_STATE",
    )
    require(
        opened.get("authorized_partitions") == ["WARMUP", "DEVELOPMENT"],
        "DEVELOPMENT_OPEN_PARTITIONS",
    )
    require(opened.get("git") == run.get("git"), "RECEIPT_GIT_BINDING")
    require(
        freeze.get("raw_root") == run.get("raw_root")
        and freeze.get("state_root") == run.get("state_root"),
        "FREEZE_RUN_ROOT_BINDING",
    )
    external = experiment.CANONICAL_STATE_ROOT / "RUN_GATE.v1.json"
    require(
        external.is_file()
        and not external.is_symlink()
        and external.read_bytes()
        == experiment.RUN_RECEIPT_PATH.read_bytes(),
        "EXTERNAL_RUN_GATE_MISMATCH",
    )
    run_git = run.get("git")
    require(
        isinstance(run_git, Mapping)
        and set(run_git) == {"commit", "tree"},
        "RUN_GIT_SCHEMA",
    )
    run_commit = run_git["commit"]
    run_tree = run_git["tree"]
    require(
        experiment.git("rev-parse", f"{run_commit}^{{tree}}") == run_tree,
        "RUN_GIT_TREE",
    )
    require(
        experiment.git(
            "merge-base", "--is-ancestor", freeze["static_commit"], run_commit
        )
        == "",
        "STATIC_TO_RUN_LINEAGE",
    )
    require(
        experiment.git(
            "merge-base", "--is-ancestor", run_commit, evidence_commit
        )
        == "",
        "RUN_TO_EVIDENCE_LINEAGE",
    )
    return run, opened


def verify_manifest_and_freeze() -> dict[str, Any]:
    for path, code in (
        (experiment.PROTOCOL_PATH, "PROTOCOL_NOT_REGULAR"),
        (experiment.PLAN_PATH, "SOURCE_PLAN_NOT_REGULAR"),
        (experiment.MANIFEST_PATH, "MANIFEST_NOT_REGULAR"),
        (experiment.FREEZE_PATH, "FREEZE_NOT_REGULAR"),
    ):
        require_regular_file(path, code)
    protocol = experiment.load_json(experiment.PROTOCOL_PATH)
    experiment.validate_protocol(protocol)
    freeze = experiment.load_json(experiment.FREEZE_PATH)
    require(
        freeze.get("schema") == "cosmos.s2i.freeze.v1", "FREEZE_SCHEMA"
    )
    require(
        freeze.get("archive_member_access") == "NONE", "FREEZE_ACCESS"
    )
    require(
        freeze.get("status") == "FROZEN_BEFORE_OUTCOMES",
        "FREEZE_STATUS",
    )
    require(
        freeze.get("raw_root") == str(experiment.CANONICAL_RAW_ROOT.resolve()),
        "FREEZE_RAW_ROOT",
    )
    require(
        freeze.get("state_root")
        == str(experiment.CANONICAL_STATE_ROOT.resolve()),
        "FREEZE_STATE_ROOT",
    )
    require(
        freeze.get("source_plan_semantic_sha256")
        == acquisition.EXPECTED_SOURCE_PLAN_SEMANTIC_SHA256,
        "FREEZE_SOURCE_PLAN_SEMANTIC",
    )
    require(
        experiment.git(
            "rev-parse", f"{freeze['static_commit']}^{{tree}}"
        )
        == freeze["static_tree"],
        "FREEZE_STATIC_TREE",
    )
    require(
        experiment.git(
            "merge-base",
            "--is-ancestor",
            experiment.BASE_COMMIT,
            freeze["static_commit"],
        )
        == "",
        "FREEZE_BASE_LINEAGE",
    )
    expected_inventory = experiment.file_inventory(
        experiment.packet_static_files() + [experiment.MANIFEST_PATH]
    )
    require(
        freeze.get("file_inventory") == expected_inventory,
        "FREEZE_EXACT_FILE_INVENTORY",
    )
    for item in freeze["file_inventory"]:
        path = experiment.REPO_ROOT / item["path"]
        require(path.is_file() and not path.is_symlink(), "FREEZE_FILE")
        require(path.stat().st_size == item["bytes"], "FREEZE_SIZE")
        require(
            experiment.sha256_file(path) == item["sha256"], "FREEZE_HASH"
        )
        committed = experiment.git_blob_bytes(
            freeze["static_commit"], item["path"]
        )
        require(len(committed) == item["bytes"], "FREEZE_COMMIT_SIZE")
        require(
            experiment.sha256_bytes(committed) == item["sha256"],
            "FREEZE_COMMIT_HASH",
        )
    require(
        experiment.sha256_bytes(
            experiment.canonical_json_bytes(freeze["file_inventory"])
        )
        == freeze["inventory_sha256"],
        "FREEZE_INVENTORY_DIGEST",
    )
    manifest = experiment.load_json(experiment.MANIFEST_PATH)
    plan = experiment.load_json(experiment.PLAN_PATH)
    require(
        acquisition.source_plan_failures(plan) == [],
        "SOURCE_PLAN_SEMANTICS",
    )
    require(
        acquisition.validate_manifest_semantics(manifest, plan) == [],
        "MANIFEST_SEMANTICS",
    )
    require(manifest["artifact_count"] == 416, "MANIFEST_COUNT")
    require(
        experiment.sha256_file(experiment.MANIFEST_PATH)
        == freeze["source_manifest_sha256"],
        "MANIFEST_FREEZE_BINDING",
    )
    require(
        manifest["inventory_sha256"] == freeze["raw_inventory_sha256"],
        "RAW_INVENTORY_FREEZE_BINDING",
    )
    return manifest


def expected_archive_keys(
    manifest: Mapping[str, Any], partitions: set[str]
) -> list[str]:
    return sorted(
        item["key"]
        for item in manifest["artifacts"]
        if item["lifecycle_partition"] in partitions
    )


def derive_verdict(
    development_pass: bool,
    holdout_state: str,
    holdout_gates: Mapping[str, bool] | None,
) -> str:
    if not development_pass:
        if (
            holdout_state
            != "UNOPENED_CONDITIONAL_DEVELOPMENT_GATE_FAILED"
            or holdout_gates is not None
        ):
            raise VerificationError("FAILED_DEVELOPMENT_STATE_MACHINE")
        return "NO_GO"
    if (
        holdout_state != "OPENED_AFTER_DEVELOPMENT_PASS"
        or holdout_gates is None
    ):
        raise VerificationError("PASSED_DEVELOPMENT_STATE_MACHINE")
    if set(holdout_gates) != HOLDOUT_GATE_KEYS or not all(
        isinstance(value, bool) for value in holdout_gates.values()
    ):
        raise VerificationError("HOLDOUT_GATE_SCHEMA")
    return (
        "GO_PUBLIC_PROXY_LOCAL"
        if all(holdout_gates.values())
        else "NO_GO"
    )


def close_number(left: Any, right: Any) -> bool:
    return (
        isinstance(left, (int, float))
        and not isinstance(left, bool)
        and isinstance(right, (int, float))
        and not isinstance(right, bool)
        and math.isfinite(float(left))
        and math.isfinite(float(right))
        and math.isclose(
            float(left), float(right), rel_tol=1e-12, abs_tol=1e-10
        )
    )


def finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def development_gate_values(
    summary: Mapping[str, Any],
    statistics: Mapping[str, Any],
) -> dict[str, bool]:
    candidate = summary["candidate"]
    monthly = candidate["monthly_stress_usd"]
    remove_best_month = sum(monthly.values()) - max(monthly.values())
    return {
        "active_days": candidate["active_utc_days"] >= 120,
        "base_positive": candidate["totals_usd_per_1000"]["base"] > 0,
        "capacity": candidate["capacity_proxy_p05_usd"] >= 1000,
        "directions": (
            candidate["long_symbols"] == list(experiment.FIXED_SYMBOLS)
            and candidate["short_symbols"] == list(experiment.FIXED_SYMBOLS)
        ),
        "formations": candidate["portfolio_formations"] >= 1000,
        "holm_absolute": summary["holm_adjusted_p"]["absolute"] <= 0.05,
        "holm_excess": (
            summary["holm_adjusted_p"]["matched_excess"] <= 0.05
        ),
        "marked_gross": candidate["maximum_marked_gross_usd"] <= 1000,
        "remove_best_month": remove_best_month > 0,
        "severe_drawdown": candidate["maximum_drawdown_usd"]["severe"] <= 100,
        "severe_positive": candidate["totals_usd_per_1000"]["severe"] > 0,
        "stress_excess_lcb": (
            summary["bootstrap"]["matched_excess_90pct_interval_usd"][0] > 0
        ),
        "stress_lcb": (
            summary["bootstrap"]["absolute_stress_90pct_interval_usd"][0] > 0
        ),
        "stress_positive": candidate["totals_usd_per_1000"]["stress"] > 0,
        "white_reality_check": (
            statistics["white_reality_check"]["p_value"] <= 0.05
        ),
    }


def holdout_gate_values(summary: Mapping[str, Any]) -> dict[str, bool]:
    candidate = summary["candidate"]
    return {
        "active_days": candidate["active_utc_days"] >= 60,
        "capacity": candidate["capacity_proxy_p05_usd"] >= 1000,
        "directions": (
            candidate["long_symbols"] == list(experiment.FIXED_SYMBOLS)
            and candidate["short_symbols"] == list(experiment.FIXED_SYMBOLS)
        ),
        "formations": candidate["portfolio_formations"] >= 400,
        "marked_gross": candidate["maximum_marked_gross_usd"] <= 1000,
        "severe_drawdown": candidate["maximum_drawdown_usd"]["severe"] <= 100,
        "severe_positive": candidate["totals_usd_per_1000"]["severe"] > 0,
        "stress_excess_lcb": (
            summary["bootstrap"]["matched_excess_90pct_interval_usd"][0] > 0
        ),
        "stress_lcb": (
            summary["bootstrap"]["absolute_stress_90pct_interval_usd"][0] > 0
        ),
        "stress_positive": candidate["totals_usd_per_1000"]["stress"] > 0,
    }


def verify_daily_totals(
    ledger: Mapping[str, Any],
    candidate_summary: Mapping[str, Any],
    comparator_summary: Mapping[str, Any],
) -> None:
    require(
        set(ledger) == {"candidate", "comparator", "dates"},
        "DAILY_LEDGER_KEYS",
    )
    dates = ledger["dates"]
    require(
        isinstance(dates, list)
        and len(dates) > 0
        and len(dates) == len(set(dates)),
        "DAILY_DATES",
    )
    for source, summary in (
        ("candidate", candidate_summary),
        ("comparator", comparator_summary),
    ):
        totals = summary.get("totals_usd_per_1000")
        require(
            isinstance(totals, Mapping)
            and set(totals) == set(experiment.SCENARIOS)
            and all(finite_number(value) for value in totals.values()),
            "SUMMARY_TOTALS_SCHEMA",
        )
        require(
            set(ledger[source]) == set(experiment.SCENARIOS),
            "DAILY_SCENARIOS",
        )
        for scenario in experiment.SCENARIOS:
            values = ledger[source][scenario]
            require(
                isinstance(values, list)
                and len(values) == len(dates)
                and all(finite_number(value) for value in values),
                "DAILY_VALUES",
            )
            require(
                close_number(
                    sum(values),
                    summary["totals_usd_per_1000"][scenario],
                ),
                "DAILY_TOTAL_BINDING",
            )
    monthly: dict[str, float] = {}
    for date, value in zip(dates, ledger["candidate"]["stress"]):
        monthly[date[:7]] = monthly.get(date[:7], 0.0) + value
    require(
        set(monthly) == set(candidate_summary["monthly_stress_usd"]),
        "MONTHLY_KEYS",
    )
    for month, value in monthly.items():
        require(
            close_number(
                value, candidate_summary["monthly_stress_usd"][month]
            ),
            "MONTHLY_TOTAL_BINDING",
        )


def verify_candidate_audit(
    audit: Mapping[str, Any],
    ledger: Mapping[str, Any],
    summary: Mapping[str, Any],
    expected_trial_id: str,
    start_ms: int,
    end_ms: int,
) -> None:
    require(
        set(audit)
        == {
            "capacity_observations",
            "formations",
            "hourly_pnl",
            "marked_exposure",
        },
        "AUDIT_LEDGER_KEYS",
    )
    require(
        summary.get("trial_id") == expected_trial_id
        and summary.get("source") == "spot_lead",
        "AUDIT_TRIAL_BINDING",
    )
    require(
        isinstance(summary.get("maximum_drawdown_usd"), Mapping)
        and set(summary["maximum_drawdown_usd"])
        == set(experiment.SCENARIOS)
        and all(
            finite_number(value)
            for value in summary["maximum_drawdown_usd"].values()
        ),
        "DRAWDOWN_MAP_SCHEMA",
    )
    horizon = summary.get("horizon_hours")
    names = summary.get("names_per_side")
    require(
        isinstance(horizon, int)
        and not isinstance(horizon, bool)
        and isinstance(names, int)
        and not isinstance(names, bool)
        and experiment.trial_id(horizon, names) == expected_trial_id,
        "AUDIT_CONFIGURATION",
    )

    formations = audit["formations"]
    require(isinstance(formations, list), "FORMATION_LEDGER_TYPE")
    prior_timestamp = -1
    active_dates: set[str] = set()
    long_seen: set[str] = set()
    short_seen: set[str] = set()
    expected_flow_keys: set[tuple[int, str]] = set()
    expected_exposure_keys: set[tuple[int, str]] = set()
    for row in formations:
        require(
            isinstance(row, list) and len(row) == 3,
            "FORMATION_ROW",
        )
        timestamp, longs, shorts = row
        require(
            isinstance(timestamp, int)
            and not isinstance(timestamp, bool)
            and start_ms <= timestamp < end_ms
            and timestamp + horizon * experiment.HOUR_MS < end_ms
            and timestamp % experiment.HOUR_MS == 0
            and timestamp > prior_timestamp,
            "FORMATION_TIMESTAMP",
        )
        prior_timestamp = timestamp
        require(
            isinstance(longs, list)
            and isinstance(shorts, list)
            and len(longs) == names
            and len(shorts) == names
            and len(longs) == len(set(longs))
            and len(shorts) == len(set(shorts))
            and not set(longs).intersection(shorts)
            and set(longs).issubset(experiment.FIXED_SYMBOLS)
            and set(shorts).issubset(experiment.FIXED_SYMBOLS),
            "FORMATION_SELECTION",
        )
        active_dates.add(experiment.date_key(timestamp))
        long_seen.update(longs)
        short_seen.update(shorts)
        for symbol in [*longs, *shorts]:
            expected_flow_keys.add((timestamp, symbol))
            expected_flow_keys.add(
                (timestamp + horizon * experiment.HOUR_MS, symbol)
            )
        for step in range(horizon):
            expected_exposure_keys.add(
                (
                    timestamp + step * experiment.HOUR_MS,
                    "POSTTRADE",
                )
            )
        for step in range(1, horizon + 1):
            expected_exposure_keys.add(
                (
                    timestamp + step * experiment.HOUR_MS,
                    "PRECLOSE",
                )
            )
    require(
        summary.get("portfolio_formations") == len(formations),
        "FORMATION_COUNT_DERIVATION",
    )
    require(
        summary.get("active_utc_days") == len(active_dates),
        "ACTIVE_DAYS_DERIVATION",
    )
    require(
        summary.get("long_symbols") == sorted(long_seen)
        and summary.get("short_symbols") == sorted(short_seen),
        "DIRECTION_DERIVATION",
    )

    capacity_rows = audit["capacity_observations"]
    require(isinstance(capacity_rows, list), "CAPACITY_LEDGER_TYPE")
    capacity_keys: list[tuple[int, str]] = []
    capacity_values: list[float] = []
    for row in capacity_rows:
        require(
            isinstance(row, list) and len(row) == 4,
            "CAPACITY_ROW",
        )
        timestamp, symbol, prior_quote_volume, order_notional = row
        require(
            isinstance(timestamp, int)
            and not isinstance(timestamp, bool)
            and timestamp % experiment.HOUR_MS == 0
            and symbol in experiment.FIXED_SYMBOLS
            and finite_number(prior_quote_volume)
            and float(prior_quote_volume) >= 0
            and finite_number(order_notional)
            and float(order_notional) > 0,
            "CAPACITY_OBSERVATION",
        )
        capacity_keys.append((timestamp, symbol))
        capacity_values.append(
            float(prior_quote_volume)
            * 0.0001
            / (float(order_notional) / 1000.0)
        )
    require(
        capacity_keys == sorted(capacity_keys)
        and len(capacity_keys) == len(set(capacity_keys))
        and set(capacity_keys) == expected_flow_keys,
        "CAPACITY_FORMATION_BINDING",
    )
    derived_capacity = (
        experiment.percentile(capacity_values, 0.05)
        if capacity_values
        else 0.0
    )
    require(
        close_number(
            summary.get("capacity_proxy_p05_usd"), derived_capacity
        ),
        "CAPACITY_DERIVATION",
    )

    marked_rows = audit["marked_exposure"]
    require(isinstance(marked_rows, list), "MARKED_LEDGER_TYPE")
    marked_keys: list[tuple[int, str]] = []
    marked_gross: list[float] = []
    marked_net: list[float] = []
    phase_order = {"POSTTRADE": 0, "PRECLOSE": 1}
    for row in marked_rows:
        require(
            isinstance(row, list) and len(row) == 4,
            "MARKED_ROW",
        )
        timestamp, phase, gross, net = row
        require(
            isinstance(timestamp, int)
            and not isinstance(timestamp, bool)
            and timestamp % experiment.HOUR_MS == 0
            and phase in phase_order
            and finite_number(gross)
            and float(gross) >= 0
            and finite_number(net)
            and abs(float(net)) <= float(gross) + 1e-8,
            "MARKED_OBSERVATION",
        )
        marked_keys.append((timestamp, phase))
        marked_gross.append(float(gross))
        marked_net.append(float(net))
    require(
        len(marked_keys) == len(set(marked_keys))
        and set(marked_keys) == expected_exposure_keys
        and marked_keys
        == sorted(
            marked_keys,
            key=lambda item: (phase_order[item[1]], item[0]),
        ),
        "MARKED_FORMATION_BINDING",
    )
    require(
        close_number(
            summary.get("maximum_marked_gross_usd"),
            max(marked_gross, default=0.0),
        )
        and close_number(
            summary.get("maximum_abs_marked_net_notional_usd"),
            max((abs(value) for value in marked_net), default=0.0),
        ),
        "MARKED_EXPOSURE_DERIVATION",
    )

    hourly = audit["hourly_pnl"]
    require(
        isinstance(hourly, Mapping)
        and set(hourly) == set(experiment.SCENARIOS),
        "HOURLY_LEDGER_SCENARIOS",
    )
    dates = ledger["dates"]
    for scenario in experiment.SCENARIOS:
        rows = hourly[scenario]
        require(isinstance(rows, list), "HOURLY_LEDGER_TYPE")
        timestamps: list[int] = []
        events: list[tuple[int, float]] = []
        daily = {date: 0.0 for date in dates}
        for row in rows:
            require(
                isinstance(row, list)
                and len(row) == 2
                and isinstance(row[0], int)
                and not isinstance(row[0], bool)
                and start_ms <= row[0] < end_ms
                and finite_number(row[1]),
                "HOURLY_ROW",
            )
            timestamp = row[0]
            amount = float(row[1])
            timestamps.append(timestamp)
            events.append((timestamp, amount))
            date = experiment.date_key(timestamp)
            if date in daily:
                daily[date] += amount
        require(
            timestamps == sorted(timestamps)
            and len(timestamps) == len(set(timestamps)),
            "HOURLY_TIMESTAMP_ORDER",
        )
        require(
            all(
                close_number(found, wanted)
                for found, wanted in zip(
                    ledger["candidate"][scenario],
                    [daily[date] for date in dates],
                )
            ),
            "HOURLY_DAILY_DERIVATION",
        )
        require(
            close_number(
                summary["maximum_drawdown_usd"][scenario],
                experiment.maximum_drawdown(events),
            ),
            "DRAWDOWN_DERIVATION",
        )


def recompute_pbo(
    daily: Mapping[str, Any], trial_ids: Sequence[str]
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
        dates = daily[identifier]["dates"]
        stress = daily[identifier]["candidate"]["stress"]
        values: list[float] = []
        for month in months:
            month_values = [
                float(amount)
                for date, amount in zip(dates, stress)
                if date.startswith(month)
            ]
            require(bool(month_values), "PBO_MONTH_EMPTY")
            values.append(sum(month_values) / len(month_values))
        month_means[identifier] = values
    underperformed = 0
    selections = {identifier: 0 for identifier in trial_ids}
    combinations = 0
    for train_indices in itertools.combinations(range(8), 4):
        train = set(train_indices)
        test = [index for index in range(8) if index not in train]
        in_sample = {
            identifier: py_statistics.fmean(
                month_means[identifier][index] for index in train
            )
            for identifier in trial_ids
        }
        selected = min(
            trial_ids,
            key=lambda identifier: (-in_sample[identifier], identifier),
        )
        selections[selected] += 1
        out_sample = {
            identifier: py_statistics.fmean(
                month_means[identifier][index] for index in test
            )
            for identifier in trial_ids
        }
        if out_sample[selected] <= py_statistics.median(
            out_sample.values()
        ):
            underperformed += 1
        combinations += 1
    return {
        "combinations": combinations,
        "pbo": underperformed / combinations,
        "reference": 0.5,
        "role": "DIAGNOSTIC_ONLY",
        "selection_counts": selections,
    }


def verify_bootstrap_packet_schema(packet: Mapping[str, Any]) -> None:
    interval_fields = {
        "absolute_stress_90pct_interval_usd",
        "matched_excess_90pct_interval_usd",
    }
    require(
        isinstance(packet, Mapping)
        and set(packet) == interval_fields | {"replicates"}
        and packet.get("replicates") == 8192,
        "BOOTSTRAP_PACKET_SCHEMA",
    )
    for field in interval_fields:
        interval = packet[field]
        require(
            isinstance(interval, list)
            and len(interval) == 2
            and all(finite_number(value) for value in interval)
            and float(interval[0]) <= float(interval[1]),
            "BOOTSTRAP_INTERVAL_SCHEMA",
        )


def verify_development_inference(
    development: Mapping[str, Any],
    statistics: Mapping[str, Any],
) -> str:
    expected_ids = sorted(
        experiment.trial_id(horizon, names)
        for horizon, names in experiment.TRIALS
    )
    require(
        sorted(statistics["trials"]) == expected_ids,
        "TRIAL_FAMILY",
    )
    daily = development["daily_ledger"]
    require(sorted(daily) == expected_ids, "DAILY_TRIAL_FAMILY")
    audit = development["candidate_audit_ledger"]
    require(sorted(audit) == expected_ids, "AUDIT_TRIAL_FAMILY")
    expected_dates = experiment.date_range(
        experiment.DEVELOPMENT_START_MS,
        experiment.DEVELOPMENT_END_MS,
    )
    stress: list[list[float]] = []
    excess: list[list[float]] = []
    for identifier in expected_ids:
        summary = statistics["trials"][identifier]
        verify_daily_totals(
            daily[identifier],
            summary["candidate"],
            summary["comparator"],
        )
        require(
            daily[identifier]["dates"] == expected_dates,
            "DEVELOPMENT_DATES",
        )
        require(
            summary["comparator"].get("trial_id") == identifier
            and summary["comparator"].get("source")
            == "futures_comparator"
            and summary["comparator"].get("horizon_hours")
            == summary["candidate"].get("horizon_hours")
            and summary["comparator"].get("names_per_side")
            == summary["candidate"].get("names_per_side"),
            "COMPARATOR_CONFIGURATION",
        )
        verify_candidate_audit(
            audit[identifier],
            daily[identifier],
            summary["candidate"],
            identifier,
            experiment.DEVELOPMENT_START_MS,
            experiment.DEVELOPMENT_END_MS,
        )
        candidate_values = daily[identifier]["candidate"]["stress"]
        comparator_values = daily[identifier]["comparator"]["stress"]
        stress.append(candidate_values)
        excess.append(
            [
                left - right
                for left, right in zip(candidate_values, comparator_values)
            ]
        )
    day_count = len(stress[0])
    starts = experiment.common_bootstrap_starts(
        day_count,
        8192,
        experiment.BOOTSTRAP_BLOCK_DAYS,
        2026073009,
    )
    stress_bootstrap = experiment.bootstrap_means(
        stress, starts, experiment.BOOTSTRAP_BLOCK_DAYS
    )
    excess_bootstrap = experiment.bootstrap_means(
        excess, starts, experiment.BOOTSTRAP_BLOCK_DAYS
    )
    observed_stress = [py_statistics.fmean(values) for values in stress]
    observed_excess = [py_statistics.fmean(values) for values in excess]
    raw_p: dict[str, float] = {}
    for index, identifier in enumerate(expected_ids):
        raw_p[f"{identifier}.absolute"] = experiment.one_sided_centered_p(
            observed_stress[index], stress_bootstrap[index]
        )
        raw_p[f"{identifier}.excess"] = experiment.one_sided_centered_p(
            observed_excess[index], excess_bootstrap[index]
        )
    adjusted = experiment.holm_adjust(raw_p)
    white_exceedances = 0
    observed_max = max(observed_excess)
    for replicate in range(8192):
        centered_max = max(
            excess_bootstrap[index][replicate] - observed_excess[index]
            for index in range(len(expected_ids))
        )
        if centered_max >= observed_max:
            white_exceedances += 1
    white_p = (white_exceedances + 1) / 8193
    require(
        statistics["white_reality_check"]
        == {
            "observed_max_matched_excess_daily_mean_usd": observed_max,
            "p_value": white_p,
            "replicates": 8192,
        },
        "WHITE_RECOMPUTATION",
    )
    require(
        statistics["holm_family_size"] == 24,
        "HOLM_FAMILY_SIZE",
    )
    for index, identifier in enumerate(expected_ids):
        summary = statistics["trials"][identifier]
        verify_bootstrap_packet_schema(summary["bootstrap"])
        require(
            isinstance(summary["raw_p"], Mapping)
            and set(summary["raw_p"]) == {"absolute", "matched_excess"}
            and isinstance(summary["holm_adjusted_p"], Mapping)
            and set(summary["holm_adjusted_p"])
            == {"absolute", "matched_excess"},
            "P_VALUE_PACKET_SCHEMA",
        )
        stress_distribution = [
            value * day_count for value in stress_bootstrap[index]
        ]
        excess_distribution = [
            value * day_count for value in excess_bootstrap[index]
        ]
        expected_intervals = {
            "absolute_stress_90pct_interval_usd": [
                experiment.percentile(stress_distribution, 0.05),
                experiment.percentile(stress_distribution, 0.95),
            ],
            "matched_excess_90pct_interval_usd": [
                experiment.percentile(excess_distribution, 0.05),
                experiment.percentile(excess_distribution, 0.95),
            ],
            "replicates": 8192,
        }
        for field in (
            "absolute_stress_90pct_interval_usd",
            "matched_excess_90pct_interval_usd",
        ):
            for found, expected in zip(
                summary["bootstrap"][field], expected_intervals[field]
            ):
                require(close_number(found, expected), "INTERVAL_RECOMPUTATION")
        require(
            close_number(
                summary["raw_p"]["absolute"],
                raw_p[f"{identifier}.absolute"],
            )
            and close_number(
                summary["raw_p"]["matched_excess"],
                raw_p[f"{identifier}.excess"],
            ),
            "RAW_P_RECOMPUTATION",
        )
        require(
            close_number(
                summary["holm_adjusted_p"]["absolute"],
                adjusted[f"{identifier}.absolute"],
            )
            and close_number(
                summary["holm_adjusted_p"]["matched_excess"],
                adjusted[f"{identifier}.excess"],
            ),
            "HOLM_RECOMPUTATION",
        )
        expected_gates = development_gate_values(summary, statistics)
        require(
            set(summary["gates"]) == DEVELOPMENT_GATE_KEYS
            and all(
                isinstance(value, bool)
                for value in summary["gates"].values()
            )
            and summary["gates"] == expected_gates,
            "DEVELOPMENT_GATE_DERIVATION",
        )
    expected_champion = min(
        expected_ids,
        key=lambda identifier: (
            -statistics["trials"][identifier]["candidate"][
                "totals_usd_per_1000"
            ]["stress"],
            identifier,
        ),
    )
    require(
        statistics["champion"] == expected_champion,
        "CHAMPION_DERIVATION",
    )
    require(
        statistics["pbo"] == recompute_pbo(daily, expected_ids),
        "PBO_RECOMPUTATION",
    )
    return expected_champion


def verify_holdout_inference(holdout: Mapping[str, Any]) -> dict[str, bool]:
    summary = holdout["statistics"]
    verify_bootstrap_packet_schema(summary["bootstrap"])
    ledger = holdout["daily_ledger"]
    verify_daily_totals(
        ledger, summary["candidate"], summary["comparator"]
    )
    require(
        ledger["dates"]
        == experiment.date_range(
            experiment.HOLDOUT_START_MS, experiment.HOLDOUT_END_MS
        ),
        "HOLDOUT_DATES",
    )
    identifier = summary["candidate"]["trial_id"]
    require(
        summary["comparator"].get("trial_id") == identifier
        and summary["comparator"].get("source") == "futures_comparator"
        and summary["comparator"].get("horizon_hours")
        == summary["candidate"].get("horizon_hours")
        and summary["comparator"].get("names_per_side")
        == summary["candidate"].get("names_per_side"),
        "HOLDOUT_COMPARATOR_CONFIGURATION",
    )
    verify_candidate_audit(
        holdout["candidate_audit_ledger"],
        ledger,
        summary["candidate"],
        identifier,
        experiment.HOLDOUT_START_MS,
        experiment.HOLDOUT_END_MS,
    )
    stress = ledger["candidate"]["stress"]
    excess = [
        left - right
        for left, right in zip(
            stress, ledger["comparator"]["stress"]
        )
    ]
    starts = experiment.common_bootstrap_starts(
        len(stress),
        8192,
        experiment.BOOTSTRAP_BLOCK_DAYS,
        2026073010,
    )
    stress_bootstrap = experiment.bootstrap_means(
        [stress], starts, experiment.BOOTSTRAP_BLOCK_DAYS
    )[0]
    excess_bootstrap = experiment.bootstrap_means(
        [excess], starts, experiment.BOOTSTRAP_BLOCK_DAYS
    )[0]
    expected = {
        "absolute_stress_90pct_interval_usd": [
            experiment.percentile(
                [value * len(stress) for value in stress_bootstrap], 0.05
            ),
            experiment.percentile(
                [value * len(stress) for value in stress_bootstrap], 0.95
            ),
        ],
        "matched_excess_90pct_interval_usd": [
            experiment.percentile(
                [value * len(stress) for value in excess_bootstrap], 0.05
            ),
            experiment.percentile(
                [value * len(stress) for value in excess_bootstrap], 0.95
            ),
        ],
    }
    for field, values in expected.items():
        for found, wanted in zip(summary["bootstrap"][field], values):
            require(close_number(found, wanted), "HOLDOUT_INTERVAL_RECOMPUTATION")
    expected_gates = holdout_gate_values(summary)
    require(
        set(summary["gates"]) == HOLDOUT_GATE_KEYS
        and all(
            isinstance(value, bool) for value in summary["gates"].values()
        )
        and summary["gates"] == expected_gates,
        "HOLDOUT_GATE_DERIVATION",
    )
    return expected_gates


def verify_candidate_seal(
    development: Mapping[str, Any],
    statistics: Mapping[str, Any],
    champion: str,
) -> dict[str, Any]:
    require_regular_file(
        experiment.CANDIDATE_PATH, "CANDIDATE_NOT_REGULAR"
    )
    candidate = experiment.load_json(experiment.CANDIDATE_PATH)
    champion_summary = statistics["trials"][champion]["candidate"]
    require(
        candidate.get("schema") == "cosmos.s2i.candidate-seal.v1",
        "CANDIDATE_SCHEMA",
    )
    require(
        candidate.get("state")
        == "SEALED_BEFORE_HOLDOUT_MEMBER_ACCESS",
        "CANDIDATE_STATE",
    )
    require(
        candidate.get("champion_trial_id") == champion,
        "CANDIDATE_CHAMPION",
    )
    require(
        candidate.get("horizon_hours")
        == champion_summary["horizon_hours"]
        and candidate.get("names_per_side")
        == champion_summary["names_per_side"],
        "CANDIDATE_CONFIGURATION",
    )
    require(
        candidate.get("development_sha256")
        == experiment.sha256_file(experiment.DEVELOPMENT_PATH),
        "CANDIDATE_DEVELOPMENT_BINDING",
    )
    require(
        candidate.get("git") == development.get("git"),
        "CANDIDATE_GIT_BINDING",
    )
    return candidate


def verify_holdout_receipt(candidate: Mapping[str, Any]) -> dict[str, Any]:
    require_regular_file(
        experiment.HOLDOUT_OPEN_PATH, "HOLDOUT_OPEN_NOT_REGULAR"
    )
    opened = experiment.load_json(experiment.HOLDOUT_OPEN_PATH)
    require(
        opened.get("schema") == "cosmos.s2i.holdout-opened.v1"
        and opened.get("state")
        == "CONSUMED_BEFORE_FIRST_HOLDOUT_MEMBER_ACCESS",
        "HOLDOUT_RECEIPT",
    )
    require(
        opened.get("candidate_seal_sha256")
        == experiment.sha256_file(experiment.CANDIDATE_PATH),
        "HOLDOUT_CANDIDATE_BINDING",
    )
    require(
        opened.get("git") == candidate.get("git"),
        "HOLDOUT_GIT_BINDING",
    )
    external = experiment.CANONICAL_STATE_ROOT / "HOLDOUT_GATE.v1.json"
    require(
        external.is_file()
        and not external.is_symlink()
        and external.read_bytes()
        == experiment.HOLDOUT_OPEN_PATH.read_bytes(),
        "EXTERNAL_HOLDOUT_GATE_MISMATCH",
    )
    return opened


def verify_development_custody(
    development: Mapping[str, Any],
    result: Mapping[str, Any],
    manifest: Mapping[str, Any],
) -> None:
    development_keys = expected_archive_keys(
        manifest, {"WARMUP", "DEVELOPMENT"}
    )
    require(
        development.get("archive_member_keys_opened") == development_keys,
        "DEVELOPMENT_ARCHIVE_KEYS",
    )
    require(
        development.get("archive_members_opened") == len(development_keys),
        "DEVELOPMENT_ARCHIVE_COUNT",
    )
    require(
        development.get("git") == result.get("git"),
        "DEVELOPMENT_RESULT_GIT",
    )


def verify_non_unmeasured_result(
    result: Mapping[str, Any],
    development: Mapping[str, Any],
    manifest: Mapping[str, Any],
) -> None:
    require(
        development.get("schema") == "cosmos.s2i.development.v1",
        "DEVELOPMENT_SCHEMA",
    )
    statistics = development.get("statistics")
    require(isinstance(statistics, Mapping), "DEVELOPMENT_STATISTICS")
    champion = verify_development_inference(development, statistics)
    require(result.get("champion") == champion, "RESULT_CHAMPION_BINDING")
    champion_summary = statistics["trials"][champion]
    gates = development_gate_values(champion_summary, statistics)
    development_pass = all(gates.values())
    require(
        statistics["champion_development_pass"] is development_pass,
        "DEVELOPMENT_PASS_DERIVATION",
    )
    expected_development = {
        "all_gates_pass": development_pass,
        "matched_excess_90pct_interval_usd": champion_summary["bootstrap"][
            "matched_excess_90pct_interval_usd"
        ],
        "maximum_abs_marked_net_notional_usd": champion_summary["candidate"][
            "maximum_abs_marked_net_notional_usd"
        ],
        "maximum_drawdown_usd": champion_summary["candidate"][
            "maximum_drawdown_usd"
        ],
        "maximum_marked_gross_usd": champion_summary["candidate"][
            "maximum_marked_gross_usd"
        ],
        "multiplicity": {
            "holm_adjusted_p": champion_summary["holm_adjusted_p"],
            "holm_family_size": statistics["holm_family_size"],
            "white_reality_check": statistics["white_reality_check"],
        },
        "net_usd_per_1000": champion_summary["candidate"][
            "totals_usd_per_1000"
        ],
        "pbo": statistics["pbo"],
        "stress_90pct_interval_usd": champion_summary["bootstrap"][
            "absolute_stress_90pct_interval_usd"
        ],
    }
    require(
        result.get("development") == expected_development,
        "RESULT_DEVELOPMENT_BINDING",
    )
    require(
        result.get("public_capacity_proxy_p05_usd")
        == champion_summary["candidate"]["capacity_proxy_p05_usd"],
        "RESULT_CAPACITY_BINDING",
    )
    verify_development_custody(development, result, manifest)

    holdout = result["holdout"]
    holdout_gates: Mapping[str, bool] | None = None
    if development_pass:
        candidate = verify_candidate_seal(
            development, statistics, champion
        )
        verify_holdout_receipt(candidate)
        holdout_keys = expected_archive_keys(
            manifest, {"EMBARGO_HOLDOUT"}
        )
        require(
            holdout.get("archive_member_keys_opened") == holdout_keys,
            "HOLDOUT_ARCHIVE_KEYS",
        )
        require(
            holdout.get("archive_members_opened") == len(holdout_keys)
            and holdout.get("gate_consumed") is True,
            "HOLDOUT_ARCHIVE_COUNT",
        )
        require(
            holdout["statistics"]["candidate"]["trial_id"] == champion,
            "HOLDOUT_CHAMPION_BINDING",
        )
        holdout_gates = verify_holdout_inference(holdout)
    else:
        require(
            not path_present(experiment.CANDIDATE_PATH)
            and not path_present(experiment.HOLDOUT_OPEN_PATH),
            "FAILED_DEVELOPMENT_HOLDOUT_RECEIPT",
        )
        require(
            holdout
            == {
                "archive_members_opened": 0,
                "gate_consumed": False,
                "state": (
                    "UNOPENED_CONDITIONAL_DEVELOPMENT_GATE_FAILED"
                ),
            },
            "FAILED_DEVELOPMENT_HOLDOUT_SUMMARY",
        )
        require(
            not (
                experiment.CANONICAL_STATE_ROOT / "HOLDOUT_GATE.v1.json"
            ).exists()
            and not (
                experiment.CANONICAL_STATE_ROOT / "HOLDOUT_GATE.v1.json"
            ).is_symlink(),
            "FAILED_DEVELOPMENT_EXTERNAL_HOLDOUT_GATE",
        )
    expected_verdict = derive_verdict(
        development_pass,
        holdout["state"],
        holdout_gates,
    )
    require(result.get("verdict") == expected_verdict, "VERDICT_DERIVATION")


def verify_unmeasured_result(
    result: Mapping[str, Any],
    development: Mapping[str, Any],
    manifest: Mapping[str, Any],
) -> None:
    require_regular_file(
        experiment.FAILURE_PATH, "TERMINAL_FAILURE_NOT_REGULAR"
    )
    failure = experiment.load_json(experiment.FAILURE_PATH)
    require(
        failure.get("schema") == "cosmos.s2i.terminal-failure.v1",
        "TERMINAL_FAILURE_SCHEMA",
    )
    require(
        failure.get("error") == result.get("error")
        and failure.get("git") == result.get("git"),
        "TERMINAL_FAILURE_BINDING",
    )
    require(
        failure.get("development_sha256")
        == experiment.sha256_file(experiment.DEVELOPMENT_PATH),
        "TERMINAL_FAILURE_DEVELOPMENT_HASH",
    )
    opened_keys = result["holdout"].get("archive_member_keys_opened")
    require(
        isinstance(opened_keys, list)
        and opened_keys == sorted(opened_keys)
        and len(opened_keys) == len(set(opened_keys))
        and failure.get("holdout_member_keys_opened") == opened_keys
        and result["holdout"].get("archive_members_opened")
        == len(opened_keys),
        "UNMEASURED_HOLDOUT_KEYS",
    )
    preserved = failure.get("development_preserved")
    require(isinstance(preserved, bool), "FAILURE_PRESERVED_TYPE")
    if not preserved:
        require(
            failure.get("stage") == "DEVELOPMENT"
            and failure.get("holdout_gate_consumed") is False
            and failure.get("candidate_seal_sha256") is None
            and failure.get("holdout_opened_sha256") is None,
            "PREDEVELOPMENT_FAILURE_STATE",
        )
        require(
            development
            == {
                "error": result["error"],
                "git": result["git"],
                "schema": "cosmos.s2i.development.v1",
                "status": "UNMEASURED",
            },
            "UNMEASURED_DEVELOPMENT_LEDGER",
        )
        require(
            result.get("development_state") == "UNMEASURED_ERROR_LEDGER"
            and result["holdout"]
            == {
                "archive_member_keys_opened": [],
                "archive_members_opened": 0,
                "gate_consumed": False,
                "state": "UNOPENED",
            },
            "PREDEVELOPMENT_RESULT_STATE",
        )
        require(
            not path_present(experiment.CANDIDATE_PATH)
            and not path_present(experiment.HOLDOUT_OPEN_PATH)
            and not path_present(
                experiment.CANONICAL_STATE_ROOT
                / "HOLDOUT_GATE.v1.json"
            ),
            "PREDEVELOPMENT_HOLDOUT_ARTIFACT",
        )
        return

    require(
        result.get("development_state") == "PRESERVED_SEALED_LEDGER"
        and development.get("schema") == "cosmos.s2i.development.v1"
        and isinstance(development.get("statistics"), Mapping),
        "PRESERVED_DEVELOPMENT_STATE",
    )
    statistics = development["statistics"]
    champion = verify_development_inference(development, statistics)
    verify_development_custody(development, result, manifest)
    champion_gates = development_gate_values(
        statistics["trials"][champion], statistics
    )
    require(
        all(champion_gates.values())
        and statistics.get("champion_development_pass") is True,
        "PRESERVED_DEVELOPMENT_NOT_PASSING",
    )
    candidate = verify_candidate_seal(development, statistics, champion)
    require(
        failure.get("candidate_seal_sha256")
        == experiment.sha256_file(experiment.CANDIDATE_PATH),
        "FAILURE_CANDIDATE_BINDING",
    )
    stage = failure.get("stage")
    if stage == "POST_DEVELOPMENT":
        require(
            failure.get("holdout_gate_consumed") is False
            and failure.get("holdout_opened_sha256") is None
            and result["holdout"]
            == {
                "archive_member_keys_opened": [],
                "archive_members_opened": 0,
                "gate_consumed": False,
                "state": "UNOPENED",
            },
            "POSTDEVELOPMENT_FAILURE_STATE",
        )
        require(
            not path_present(experiment.HOLDOUT_OPEN_PATH)
            and not path_present(
                experiment.CANONICAL_STATE_ROOT
                / "HOLDOUT_GATE.v1.json"
            ),
            "POSTDEVELOPMENT_HOLDOUT_ARTIFACT",
        )
        return
    require(stage == "HOLDOUT", "FAILURE_STAGE")
    verify_holdout_receipt(candidate)
    require(
        failure.get("holdout_gate_consumed") is True
        and failure.get("holdout_opened_sha256")
        == experiment.sha256_file(experiment.HOLDOUT_OPEN_PATH)
        and result["holdout"].get("gate_consumed") is True
        and result["holdout"].get("state")
        == "GATE_CONSUMED_TERMINAL_FAILURE",
        "HOLDOUT_FAILURE_STATE",
    )
    expected_holdout_keys = set(
        expected_archive_keys(manifest, {"EMBARGO_HOLDOUT"})
    )
    require(
        set(opened_keys).issubset(expected_holdout_keys),
        "HOLDOUT_FAILURE_ARCHIVE_KEYS",
    )


def verify_result_and_terminal(
    manifest: Mapping[str, Any],
    evidence_commit: str,
) -> dict[str, Any]:
    for path, code in (
        (experiment.RESULT_PATH, "RESULT_NOT_REGULAR"),
        (experiment.DEVELOPMENT_PATH, "DEVELOPMENT_NOT_REGULAR"),
        (experiment.TERMINAL_PATH, "TERMINAL_NOT_REGULAR"),
    ):
        require_regular_file(path, code)
    result = experiment.load_json(experiment.RESULT_PATH)
    development = experiment.load_json(experiment.DEVELOPMENT_PATH)
    terminal = experiment.load_json(experiment.TERMINAL_PATH)
    run, _ = verify_receipts(evidence_commit)
    require(
        result.get("schema") == "cosmos.s2i.result.v1", "RESULT_SCHEMA"
    )
    require(
        result.get("verdict")
        in {"NO_GO", "UNMEASURED", "GO_PUBLIC_PROXY_LOCAL"},
        "VERDICT_ENUM",
    )
    require(
        result.get("capital_authority") == "NONE"
        and result.get("consumer") == "N3 successor/final convergence",
        "RESULT_AUTHORITY",
    )
    require(
        result.get("git") == run.get("git"), "RESULT_RUN_GIT_BINDING"
    )
    require(
        result.get("account_effective_commission") == "UNKNOWN",
        "ACCOUNT_FEE_PROMOTION",
    )
    require(
        result.get("executable_capacity") == "UNMEASURED",
        "CAPACITY_PROMOTION",
    )
    require(
        result.get("limitations") == list(experiment.REQUIRED_LIMITATIONS),
        "RESULT_LIMITATIONS",
    )
    require(
        result.get("source_manifest_sha256")
        == experiment.sha256_file(experiment.MANIFEST_PATH),
        "RESULT_MANIFEST_BINDING",
    )
    if result["verdict"] == "UNMEASURED":
        require(
            result.get("public_capacity_proxy_p05_usd") == "UNMEASURED",
            "UNMEASURED_CAPACITY_PROXY",
        )
        verify_unmeasured_result(result, development, manifest)
    else:
        require(
            not path_present(experiment.FAILURE_PATH),
            "MEASURED_FAILURE_ARTIFACT",
        )
        verify_non_unmeasured_result(result, development, manifest)

    evidence_paths = expected_evidence_paths()
    expected_inventory = experiment.file_inventory(evidence_paths)
    require(
        terminal.get("schema") == "cosmos.s2i.terminal.v1",
        "TERMINAL_SCHEMA",
    )
    require(
        terminal.get("evidence_inventory") == expected_inventory,
        "TERMINAL_EXACT_EVIDENCE_INVENTORY",
    )
    require(
        terminal.get("result_sha256")
        == experiment.sha256_file(experiment.RESULT_PATH),
        "TERMINAL_RESULT_BINDING",
    )
    require(
        terminal.get("status") == result.get("verdict"),
        "TERMINAL_STATUS_BINDING",
    )
    require(
        terminal.get("capital_authority") == "NONE"
        and terminal.get("consumer") == "N3 successor/final convergence",
        "TERMINAL_AUTHORITY",
    )
    verify_checksum_file(evidence_paths)
    verify_committed_regular_files(
        [
            *evidence_paths,
            experiment.TERMINAL_PATH,
            experiment.MANIFEST_PATH,
            experiment.SUMS_PATH,
        ],
        evidence_commit,
    )
    return result


def verify_committed_regular_files(
    paths: Sequence[pathlib.Path], commit: str
) -> None:
    for path in paths:
        require_regular_file(path, "EVIDENCE_NOT_REGULAR")
        relative = path.relative_to(experiment.REPO_ROOT).as_posix()
        listing = experiment.git("ls-tree", commit, "--", relative)
        fields = listing.split(None, 3)
        require(
            len(fields) == 4
            and fields[0] in {"100644", "100755"}
            and fields[1] == "blob"
            and fields[3] == relative,
            "EVIDENCE_GIT_MODE",
        )
        committed = experiment.git_blob_bytes(commit, relative)
        require(
            len(committed) == path.stat().st_size
            and experiment.sha256_bytes(committed)
            == experiment.sha256_file(path),
            "EVIDENCE_COMMIT_HASH",
        )


def verify_scope() -> dict[str, str]:
    identity = experiment.git_identity(require_clean=True)
    tracked = experiment.git("ls-files", "-s", "quant/research/s2i")
    require(bool(tracked), "SCOPE_EMPTY")
    for line in tracked.splitlines():
        metadata, relative = line.split("\t", 1)
        mode, object_id, stage = metadata.split()
        require(
            relative.startswith("quant/research/s2i/"), "TRACKED_SCOPE"
        )
        require(
            mode in {"100644", "100755"}
            and len(object_id) == 40
            and stage == "0",
            "TRACKED_GIT_MODE",
        )
        require_regular_file(
            experiment.REPO_ROOT / relative, "TRACKED_NOT_REGULAR"
        )
        require(
            not relative.endswith(".zip")
            and "/raw/" not in relative
            and "/state/" not in relative,
            "RAW_TRACKED",
        )
    return identity


def verify_postrun(identity: Mapping[str, str]) -> None:
    require_regular_file(POSTRUN_PATH, "POSTRUN_NOT_REGULAR")
    receipt = experiment.load_json(POSTRUN_PATH)
    require(
        receipt.get("schema") == "cosmos.s2i.postrun-verification.v1",
        "POSTRUN_SCHEMA",
    )
    evidence_commit = receipt["evidence_commit"]
    evidence_tree = receipt["evidence_tree"]
    require(
        experiment.git("rev-parse", f"{evidence_commit}^{{tree}}")
        == evidence_tree,
        "POSTRUN_EVIDENCE_TREE",
    )
    require(
        experiment.git("merge-base", "--is-ancestor", evidence_commit, "HEAD")
        == "",
        "POSTRUN_LINEAGE",
    )
    require(
        experiment.git("rev-list", "--count", f"{evidence_commit}..HEAD")
        == "1",
        "POSTRUN_COMMIT_COUNT",
    )
    changed = experiment.git(
        "diff", "--name-only", f"{evidence_commit}..HEAD"
    ).splitlines()
    require(
        changed == ["quant/research/s2i/POSTRUN_VERIFICATION.v1.json"],
        "POSTRUN_DESCENDANT_SCOPE",
    )
    require(
        receipt["result_sha256"]
        == experiment.sha256_file(experiment.RESULT_PATH),
        "POSTRUN_RESULT",
    )
    require(
        receipt["terminal_sha256"]
        == experiment.sha256_file(experiment.TERMINAL_PATH),
        "POSTRUN_TERMINAL",
    )
    require(identity["commit"] == experiment.git("rev-parse", "HEAD"), "HEAD")
    verify_committed_regular_files([POSTRUN_PATH], identity["commit"])


def verify_all(require_postrun: bool) -> dict[str, Any]:
    identity = verify_scope()
    if require_postrun:
        require_regular_file(POSTRUN_PATH, "POSTRUN_MISSING")
        evidence_commit = experiment.load_json(POSTRUN_PATH)[
            "evidence_commit"
        ]
    else:
        evidence_commit = identity["commit"]
    manifest = verify_manifest_and_freeze()
    result = verify_result_and_terminal(manifest, evidence_commit)
    if require_postrun:
        verify_postrun(identity)
    return {
        "git": identity,
        "postrun": require_postrun,
        "result_sha256": experiment.sha256_file(experiment.RESULT_PATH),
        "status": "S2I_TERMINAL_VERIFICATION_PASS",
        "verdict": result["verdict"],
    }


def write_postrun() -> dict[str, Any]:
    require(not path_present(POSTRUN_PATH), "POSTRUN_ALREADY_EXISTS")
    outcome = verify_all(require_postrun=False)
    identity = outcome["git"]
    receipt = {
        "evidence_commit": identity["commit"],
        "evidence_tree": identity["tree"],
        "result_sha256": experiment.sha256_file(experiment.RESULT_PATH),
        "schema": "cosmos.s2i.postrun-verification.v1",
        "status": "PASS",
        "terminal_sha256": experiment.sha256_file(experiment.TERMINAL_PATH),
    }
    experiment.atomic_write(
        POSTRUN_PATH, experiment.canonical_json_bytes(receipt)
    )
    return {
        **outcome,
        "postrun_path": str(POSTRUN_PATH),
        "status": "S2I_POSTRUN_RECEIPT_WRITTEN",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-postrun", action="store_true")
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    output = (
        write_postrun()
        if arguments.write_postrun
        else verify_all(require_postrun=True)
    )
    print(json.dumps(output, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        VerificationError,
        acquisition.AcquisitionError,
        experiment.StudyError,
    ) as error:
        print(f"S2I_VERIFICATION_STOP {error}")
        raise SystemExit(2)
