"""Focused authentic and hostile tests for the standalone S-1V verifier."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any, cast

import pytest
from research.s1v import verifier

SOURCE_DIR = Path(verifier.__file__).resolve().parent
FROZEN_COMMIT = "f" * 40


def _signed(name: str, fields: dict[str, Any]) -> dict[str, Any]:
    return {"schema": verifier.EXPECTED_SCHEMAS[name], **fields}


def _write_json(root: Path, name: str, fields: dict[str, Any]) -> dict[str, Any]:
    document = _signed(name, fields)
    (root / name).write_bytes(verifier.canonical_bytes(document))
    return document


def _load(root: Path, name: str) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((root / name).read_text(encoding="utf-8")),
    )


def _rewrite(root: Path, name: str, **updates: Any) -> dict[str, Any]:
    document = _load(root, name)
    document.update(updates)
    (root / name).write_bytes(verifier.canonical_bytes(document))
    return document


def _refresh_sums(root: Path) -> None:
    names = sorted(path.name for path in root.iterdir() if path.name != "SHA256SUMS")
    payload = "".join(f"{verifier.sha256_file(root / name)}  {name}\n" for name in names)
    (root / "SHA256SUMS").write_text(payload, encoding="ascii")


def _redigest_pre_run_chain(root: Path) -> None:
    preseal = _load(root, "preseal.v1.json")
    preseal["bound_files"] = {
        name: verifier.sha256_file(root / name) for name in sorted(verifier.STATIC_FILES)
    }
    (root / "preseal.v1.json").write_bytes(verifier.canonical_bytes(preseal))
    _rewrite(
        root,
        "screen_consumed.v1.json",
        preseal_file_sha256=verifier.sha256_file(root / "preseal.v1.json"),
        protocol_file_sha256=verifier.sha256_file(root / "protocol.v1.json"),
    )
    _rewrite(
        root,
        "universe.v1.json",
        preseal_file_sha256=verifier.sha256_file(root / "preseal.v1.json"),
        screen_consumed_file_sha256=verifier.sha256_file(root / "screen_consumed.v1.json"),
    )
    _rewrite(
        root,
        "source_manifest.v1.json",
        universe_file_sha256=verifier.sha256_file(root / "universe.v1.json"),
    )
    freeze = _load(root, "freeze.v1.json")
    freeze["bound_files"] = {
        name: verifier.sha256_file(root / name) for name in sorted(verifier.FREEZE_BINDINGS)
    }
    freeze["preseal_file_sha256"] = verifier.sha256_file(root / "preseal.v1.json")
    freeze["screen_consumed_file_sha256"] = verifier.sha256_file(root / "screen_consumed.v1.json")
    freeze["source_manifest_file_sha256"] = verifier.sha256_file(root / "source_manifest.v1.json")
    freeze["trial_ledger_file_sha256"] = verifier.sha256_file(root / "trial_ledger.v1.json")
    freeze["universe_file_sha256"] = verifier.sha256_file(root / "universe.v1.json")
    (root / "freeze.v1.json").write_bytes(verifier.canonical_bytes(freeze))
    _rewrite(
        root,
        "run_consumed.v1.json",
        freeze_file_sha256=verifier.sha256_file(root / "freeze.v1.json"),
        protocol_file_sha256=verifier.sha256_file(root / "protocol.v1.json"),
        source_manifest_file_sha256=verifier.sha256_file(root / "source_manifest.v1.json"),
        trial_ledger_file_sha256=verifier.sha256_file(root / "trial_ledger.v1.json"),
        universe_file_sha256=verifier.sha256_file(root / "universe.v1.json"),
    )
    _rewrite(
        root,
        "result.v1.json",
        freeze_file_sha256=verifier.sha256_file(root / "freeze.v1.json"),
        protocol_file_sha256=verifier.sha256_file(root / "protocol.v1.json"),
        run_consumed_file_sha256=verifier.sha256_file(root / "run_consumed.v1.json"),
        source_manifest_file_sha256=verifier.sha256_file(root / "source_manifest.v1.json"),
        trial_ledger_file_sha256=verifier.sha256_file(root / "trial_ledger.v1.json"),
    )
    _refresh_sums(root)


def _redigest_holdout_after_open(root: Path) -> None:
    _rewrite(
        root,
        "holdout.v1.json",
        holdout_open_file_sha256=verifier.sha256_file(root / "holdout_open.v1.json"),
    )
    _rewrite(
        root,
        "result.v1.json",
        holdout_file_sha256=verifier.sha256_file(root / "holdout.v1.json"),
        holdout_open_file_sha256=verifier.sha256_file(root / "holdout_open.v1.json"),
    )
    _refresh_sums(root)


def _digest(*parts: str) -> str:
    return verifier.sha256_bytes("|".join(parts).encode())


def _effects() -> dict[str, Any]:
    return {
        "live_trading": False,
        "money_moved_usd": 0,
        "orders_placed": 0,
        "private_api_used": False,
        "provider_mutation": False,
        "transfers": 0,
        "withdrawals": 0,
    }


def _custody(
    *,
    screen_count: int = 90,
    development_count: int = 0,
    development_state: str = "RUN_CONSUMED_UNMEASURED",
    holdout_count: int = 0,
    holdout_open_count: int = 0,
    holdout_state: str = "UNOPENED",
) -> dict[str, Any]:
    return {
        "development": {
            "archive_member_open_count": development_count,
            "state": development_state,
        },
        "holdout": {
            "archive_member_open_count": holdout_count,
            "open_count": holdout_open_count,
            "outcome_rows_opened_before_gates": 0,
            "state": holdout_state,
        },
        "schema_only_probe": {
            "disclosed": True,
            "outcome_rows_opened": 0,
            "outside_selected_source_root": True,
        },
        "screen": {
            "archive_member_open_count": screen_count,
            "open_count": 1,
            "state": "OPENED_ONCE_JUNE_ONLY",
        },
    }


def _common_result(root: Path) -> dict[str, Any]:
    return {
        "account_effective_fees": "UNKNOWN",
        "capital_authority": "NO_GO",
        "created_at": "2026-07-30T00:00:08Z",
        "effects": _effects(),
        "executable_capacity": "UNKNOWN",
        "execution_authority": "NONE",
        "freeze_file_sha256": verifier.sha256_file(root / "freeze.v1.json"),
        "frozen_commit": FROZEN_COMMIT,
        "limitations": [
            "Historical publication latency is UNKNOWN.",
            "Mark opens are public proxies, not fills.",
            "Account-effective fees are UNKNOWN.",
            "Quote volume is not executable capacity.",
            "Historical rate-type truth is unavailable.",
        ],
        "positive_edge_claim": False,
        "protocol_file_sha256": verifier.sha256_file(root / "protocol.v1.json"),
        "run_consumed_file_sha256": verifier.sha256_file(root / "run_consumed.v1.json"),
        "selected_source_root_holdout_outcome_rows_opened_before_gates": 0,
        "source_manifest_file_sha256": verifier.sha256_file(root / "source_manifest.v1.json"),
        "trial_ledger_file_sha256": verifier.sha256_file(root / "trial_ledger.v1.json"),
    }


def _null_result_fields() -> dict[str, Any]:
    return {
        "bootstrap_intervals": None,
        "causal_and_activity_counters": None,
        "holm_p_values": None,
        "net_usd_per_1000_by_scenario": {
            "base": None,
            "severe": None,
            "stress": None,
        },
        "pbo": None,
        "public_capacity_proxy": None,
        "remove_best_symbol_and_month_stress_net": None,
        "severe_hourly_marked_equity_max_drawdown": None,
        "white_reality_check_p_by_scenario": None,
    }


def _terminal_result(root: Path, *, screen_count: int) -> dict[str, Any]:
    return {
        **_common_result(root),
        **_null_result_fields(),
        "candidate_seal_file_sha256": None,
        "development_and_holdout_custody": _custody(screen_count=screen_count),
        "development_file_sha256": None,
        "holdout_file_sha256": None,
        "holdout_open_file_sha256": None,
        "holdout_state": "UNOPENED",
        "outcome_state": "TERMINAL_UNMEASURED",
        "reason_code": "FIXTURE_TERMINAL",
        "strategy_verdict": "UNMEASURED",
        "verdict": "UNMEASURED_RUN_CONSUMED_NO_RERUN",
    }


def _packet_screen_count(root: Path) -> int:
    value = _load(root, "universe.v1.json")["screen_archive_member_open_count"]
    assert isinstance(value, int)
    return value


def _screen_attempts() -> list[dict[str, Any]]:
    attempts: list[dict[str, Any]] = []
    for index in range(31):
        symbol = f"S{index:02d}USDT"
        attempts.append(
            {
                "archive_member_open_count": 3,
                "june_evidence": {
                    kind: {
                        "sidecar_sha256": _digest(symbol, kind, "2025-06", "sidecar"),
                        "zip_sha256": _digest(symbol, kind, "2025-06", "zip"),
                    }
                    for kind in verifier.SOURCE_KINDS
                },
                "reason_code": None,
                "screen_quote_volume": str(3000 - index),
                "status": "SUCCESS",
                "symbol": symbol,
            }
        )
    attempts.append(
        {
            "archive_member_open_count": 0,
            "reason_code": "KLINE_MONTH_GRID_INVALID",
            "status": "INVALID_EVIDENCE",
            "symbol": "S31USDT",
        }
    )
    return attempts


def _screen_row(attempt: dict[str, Any]) -> dict[str, Any]:
    return {
        "june_evidence": attempt["june_evidence"],
        "screen_quote_volume": attempt["screen_quote_volume"],
        "symbol": attempt["symbol"],
    }


def _manifest_entries(
    rows: list[dict[str, Any]],
    *,
    june_digest_drift: bool,
    path_tamper: bool,
) -> list[dict[str, Any]]:
    evidence: dict[tuple[str, str], dict[str, str]] = {}
    for row in rows:
        june = cast(dict[str, dict[str, str]], row["june_evidence"])
        for kind in verifier.SOURCE_KINDS:
            evidence[(str(row["symbol"]), kind)] = june[kind]
    entries: list[dict[str, Any]] = []
    for row in rows:
        symbol = str(row["symbol"])
        for month in verifier.ALL_MONTHS:
            for kind in verifier.SOURCE_KINDS:
                relative = verifier._expected_source_path(kind, symbol, month)
                zip_sha = _digest(symbol, kind, month, "zip")
                sidecar_sha = _digest(symbol, kind, month, "sidecar")
                if month == "2025-06":
                    zip_sha = evidence[(symbol, kind)]["zip_sha256"]
                    sidecar_sha = evidence[(symbol, kind)]["sidecar_sha256"]
                if (
                    june_digest_drift
                    and symbol == "S00USDT"
                    and month == "2025-06"
                    and kind == "fundingRate"
                ):
                    zip_sha = "d" * 64
                if (
                    path_tamper
                    and symbol == "S00USDT"
                    and month == "2025-06"
                    and kind == "fundingRate"
                ):
                    relative = "shared.zip"
                entries.append(
                    {
                        "acquisition_state": ("LOCAL_OFFICIAL_ARCHIVE_REUSE_CHECKSUM_VERIFIED"),
                        "availability": "AVAILABLE",
                        "byte_count": 100,
                        "http_status": None,
                        "kind": kind,
                        "local_relative_path": relative,
                        "member_state": (
                            "SCREEN_OPENED_ONCE" if month == "2025-06" else "OPAQUE_UNOPENED"
                        ),
                        "month": month,
                        "sidecar_expected_zip_sha256": zip_sha,
                        "sidecar_sha256": sidecar_sha,
                        "source_url": f"https://data.binance.vision/{relative}",
                        "symbol": symbol,
                        "zip_sha256": zip_sha,
                    }
                )
    return entries


def _build_terminal_packet(
    root: Path,
    *,
    screen_before: int = 0,
    rank_tamper: bool = False,
    omit_better_candidate: bool = False,
    screen_sum_drift: bool = False,
    first_success_open_count: int | None = None,
    zero_volume_success: bool = False,
    june_digest_drift: bool = False,
    path_tamper: bool = False,
) -> Path:
    root.mkdir()
    for name in verifier.STATIC_FILES:
        if name in {
            "protocol.v1.json",
            "source_plan.v1.json",
            "trial_ledger.v1.json",
        }:
            static_value = json.loads((SOURCE_DIR / name).read_text(encoding="utf-8"))
            (root / name).write_bytes(verifier.canonical_bytes(static_value))
        else:
            (root / name).write_text(f"# fixture {name}\n", encoding="utf-8")
    _write_json(
        root,
        "preseal.v1.json",
        {
            "allowed_screen_count": 1,
            "bound_files": {
                name: verifier.sha256_file(root / name) for name in sorted(verifier.STATIC_FILES)
            },
            "canonical_base": verifier.BASE_COMMIT,
            "created_at": "2026-07-30T00:00:01Z",
            "policy": "CREATED_BEFORE_ANY_SCREEN_MEMBER_OPEN",
        },
    )
    _write_json(
        root,
        "screen_consumed.v1.json",
        {
            "allowed_screen_count": 1,
            "created_at": "2026-07-30T00:00:02Z",
            "marker_created_before_first_member": True,
            "marker_created_before_screen_open": True,
            "preseal_file_sha256": verifier.sha256_file(root / "preseal.v1.json"),
            "protocol_file_sha256": verifier.sha256_file(root / "protocol.v1.json"),
            "screen_archive_member_open_count_before": screen_before,
            "screen_ordinal": 1,
        },
    )
    attempts = _screen_attempts()
    if first_success_open_count is not None:
        attempts[0]["archive_member_open_count"] = first_success_open_count
    if zero_volume_success:
        attempts[0]["screen_quote_volume"] = "0"
    successful = [attempt for attempt in attempts if attempt["status"] == "SUCCESS"]
    ranked_successful = sorted(
        successful,
        key=lambda attempt: (
            -Decimal(str(attempt["screen_quote_volume"])),
            str(attempt["symbol"]),
        ),
    )
    rows = [_screen_row(attempt) for attempt in ranked_successful[:30]]
    if rank_tamper:
        rows[0], rows[1] = rows[1], rows[0]
    if omit_better_candidate:
        rows = [_screen_row(attempt) for attempt in ranked_successful[1:31]]
    symbols = [str(row["symbol"]) for row in rows]
    screen_open_count = sum(int(attempt["archive_member_open_count"]) for attempt in attempts)
    if screen_sum_drift:
        screen_open_count += 1
    _write_json(
        root,
        "universe.v1.json",
        {
            "candidate_count": len(successful),
            "created_at": "2026-07-30T00:00:03Z",
            "preseal_file_sha256": verifier.sha256_file(root / "preseal.v1.json"),
            "screen_archive_member_open_count": screen_open_count,
            "screen_attempt_count": len(attempts),
            "screen_attempts": attempts,
            "screen_consumed_file_sha256": verifier.sha256_file(root / "screen_consumed.v1.json"),
            "screen_month": "2025-06",
            "screen_rows": rows,
            "selected_count": 30,
            "selected_symbols": symbols,
            "status": "FROZEN",
        },
    )
    entries = _manifest_entries(
        rows,
        june_digest_drift=june_digest_drift,
        path_tamper=path_tamper,
    )
    _write_json(
        root,
        "source_manifest.v1.json",
        {
            "created_at": "2026-07-30T00:00:04Z",
            "development_archive_member_open_count": 0,
            "entries": entries,
            "entry_count": len(entries),
            "holdout_archive_member_open_count": 0,
            "selected_source_root_holdout_outcome_rows_opened_before_gates": 0,
            "status": "COMPLETE",
            "universe_file_sha256": verifier.sha256_file(root / "universe.v1.json"),
        },
    )
    _write_json(
        root,
        "freeze.v1.json",
        {
            "allowed_run_count": 1,
            "bound_files": {
                name: verifier.sha256_file(root / name) for name in sorted(verifier.FREEZE_BINDINGS)
            },
            "canonical_base": verifier.BASE_COMMIT,
            "created_at": "2026-07-30T00:00:05Z",
            "development_archive_member_open_count": 0,
            "holdout_archive_member_open_count": 0,
            "preseal_file_sha256": verifier.sha256_file(root / "preseal.v1.json"),
            "screen_consumed_file_sha256": verifier.sha256_file(root / "screen_consumed.v1.json"),
            "source_manifest_file_sha256": verifier.sha256_file(root / "source_manifest.v1.json"),
            "trial_ledger_file_sha256": verifier.sha256_file(root / "trial_ledger.v1.json"),
            "universe_file_sha256": verifier.sha256_file(root / "universe.v1.json"),
        },
    )
    _write_json(
        root,
        "run_consumed.v1.json",
        {
            "allowed_run_count": 1,
            "created_at": "2026-07-30T00:00:06Z",
            "development_archive_member_open_count_before": 0,
            "freeze_file_sha256": verifier.sha256_file(root / "freeze.v1.json"),
            "frozen_commit": FROZEN_COMMIT,
            "holdout_archive_member_open_count_before": 0,
            "marker_created_before_development_open": True,
            "protocol_file_sha256": verifier.sha256_file(root / "protocol.v1.json"),
            "run_ordinal": 1,
            "source_manifest_file_sha256": verifier.sha256_file(root / "source_manifest.v1.json"),
            "trial_ledger_file_sha256": verifier.sha256_file(root / "trial_ledger.v1.json"),
            "universe_file_sha256": verifier.sha256_file(root / "universe.v1.json"),
        },
    )
    _write_json(
        root,
        "result.v1.json",
        _terminal_result(root, screen_count=screen_open_count),
    )
    (root / "REPORT.md").write_text("# fixture report\n", encoding="utf-8")
    _refresh_sums(root)
    return root


def _pbo() -> dict[str, Any]:
    return {
        "authority": "DIAGNOSTIC_ONLY",
        "pbo": "0.1",
        "purged_days_per_block": 2,
        "score_days_per_block": 20,
        "splits": 924,
    }


def _development_gates(*, admitted: bool) -> dict[str, bool]:
    gates = dict.fromkeys(verifier.DEVELOPMENT_GATE_KEYS, True)
    if not admitted:
        gates["base_net_usd_per_1000_gt"] = False
        gates["champion_holm_p_lte"] = False
    return gates


def _trial_summary(
    trial_id: str,
    *,
    winner: bool,
    admitted: bool,
) -> dict[str, Any]:
    gates = _development_gates(admitted=admitted)
    score = "2" if winner else "1"
    raw_p = "0.001" if admitted else "0.01"
    holm_adjusted_p = "0.012" if admitted else "0.12"
    return {
        "active_cohorts": 24,
        "active_weeks": 12,
        "base_bonferroni_lcb": score,
        "base_net_usd_per_1000": "1" if admitted else "-1",
        "base_p_value": raw_p,
        "bootstrap_interval_usd_per_1000": {
            scenario: ["0", "2"] for scenario in verifier.SCENARIOS
        },
        "development_gates": gates,
        "distinct_traded_symbols": 12,
        "holm_adjusted_p": holm_adjusted_p,
        "passes_all_development_gates": admitted,
        "public_capacity_proxy_usd": {"minimum": "1000", "p05": "1000"},
        "remove_best_month_stress_net_usd_per_1000": "1",
        "remove_best_symbol_stress_net_usd_per_1000": "1",
        "severe_hourly_marked_equity_max_drawdown": "0.05",
        "severe_net_usd_per_1000": "1",
        "skipped_active_epochs": 0,
        "stress_bonferroni_lcb": score,
        "stress_net_usd_per_1000": score,
        "stress_p_value": raw_p,
        "trial_id": trial_id,
        "valid_cash_epochs": 1,
        "valid_decision_epochs": 60,
    }


def _measured_fields(
    development: dict[str, Any],
    summary: dict[str, Any],
    *,
    holdout: bool,
) -> dict[str, Any]:
    rows = cast(list[dict[str, Any]], development["trials"])
    if holdout:
        net = summary["net_usd_per_1000_by_scenario"]
        intervals = summary["bootstrap_intervals"]
        capacity = summary["public_capacity_proxy_usd"]
    else:
        net = {
            "base": summary["base_net_usd_per_1000"],
            "severe": summary["severe_net_usd_per_1000"],
            "stress": summary["stress_net_usd_per_1000"],
        }
        intervals = summary["bootstrap_interval_usd_per_1000"]
        capacity = summary["public_capacity_proxy_usd"]
    return {
        "bootstrap_intervals": intervals,
        "causal_and_activity_counters": {
            "active_cohorts": summary["active_cohorts"],
            "active_weeks": summary["active_weeks"],
            "distinct_traded_symbols": summary["distinct_traded_symbols"],
            "skipped_active_epochs": summary["skipped_active_epochs"],
            "valid_cash_epochs": summary["valid_cash_epochs"],
            "valid_causal_decision_epochs": summary["valid_decision_epochs"],
        },
        "holm_p_values": {str(row["trial_id"]): row["holm_adjusted_p"] for row in rows},
        "net_usd_per_1000_by_scenario": net,
        "pbo": development["pbo"],
        "public_capacity_proxy": capacity,
        "remove_best_symbol_and_month_stress_net": {
            "remove_best_month_stress_net_usd_per_1000": summary[
                "remove_best_month_stress_net_usd_per_1000"
            ],
            "remove_best_symbol_stress_net_usd_per_1000": summary[
                "remove_best_symbol_stress_net_usd_per_1000"
            ],
        },
        "severe_hourly_marked_equity_max_drawdown": summary[
            "severe_hourly_marked_equity_max_drawdown"
        ],
        "white_reality_check_p_by_scenario": development["white_reality_check_p_by_scenario"],
    }


def _add_development(root: Path, *, admitted: bool) -> dict[str, Any]:
    trial_ids = [str(spec["trial_id"]) for spec in verifier.TRIAL_SPECS]
    rows = [
        _trial_summary(trial_id, winner=index == 0, admitted=admitted)
        for index, trial_id in enumerate(trial_ids)
    ]
    development = _write_json(
        root,
        "development.v1.json",
        {
            "admitted_to_holdout": admitted,
            "champion_trial_id": trial_ids[0] if admitted else None,
            "created_at": "2026-07-30T00:00:09Z",
            "development_archive_member_open_count": 900,
            "freeze_file_sha256": verifier.sha256_file(root / "freeze.v1.json"),
            "frozen_commit": FROZEN_COMMIT,
            "holdout_archive_member_open_count": 0,
            "holdout_open_gates": rows[0]["development_gates"],
            "outcome_state": "MEASURED",
            "pbo": _pbo(),
            "protocol_file_sha256": verifier.sha256_file(root / "protocol.v1.json"),
            "reported_trial_id": trial_ids[0],
            "run_consumed_file_sha256": verifier.sha256_file(root / "run_consumed.v1.json"),
            "source_manifest_file_sha256": verifier.sha256_file(root / "source_manifest.v1.json"),
            "trial_ledger_file_sha256": verifier.sha256_file(root / "trial_ledger.v1.json"),
            "trials": rows,
            "white_reality_check_p_by_scenario": {"base": "0.01", "stress": "0.01"},
        },
    )
    if not admitted:
        result = {
            **_common_result(root),
            **_measured_fields(development, rows[0], holdout=False),
            "candidate_seal_file_sha256": None,
            "development_and_holdout_custody": _custody(
                screen_count=_packet_screen_count(root),
                development_count=900,
                development_state="MEASURED_ONCE",
            ),
            "development_file_sha256": verifier.sha256_file(root / "development.v1.json"),
            "holdout_file_sha256": None,
            "holdout_open_file_sha256": None,
            "holdout_state": "UNOPENED",
            "outcome_state": "MEASURED_DEVELOPMENT_REJECTED",
            "strategy_verdict": "NO_GO",
            "verdict": "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED",
        }
        _write_json(root, "result.v1.json", result)
    return development


def _holdout_summary() -> dict[str, Any]:
    return {
        "active_cohorts": 8,
        "active_weeks": 6,
        "bootstrap_intervals": {scenario: ["0", "2"] for scenario in verifier.SCENARIOS},
        "distinct_traded_symbols": 6,
        "net_usd_per_1000_by_scenario": dict.fromkeys(verifier.SCENARIOS, "1"),
        "pointwise_lcb": dict.fromkeys(verifier.SCENARIOS, "1"),
        "public_capacity_proxy_usd": {"minimum": "1000", "p05": "1000"},
        "remove_best_month_stress_net_usd_per_1000": "1",
        "remove_best_symbol_stress_net_usd_per_1000": "1",
        "severe_hourly_marked_equity_max_drawdown": "0.05",
        "skipped_active_epochs": 0,
        "valid_cash_epochs": 1,
        "valid_decision_epochs": 60,
    }


def _add_holdout(
    root: Path,
    development: dict[str, Any],
    *,
    measured: bool,
    holdout_before: int = 0,
) -> None:
    champion = str(development["champion_trial_id"])
    _write_json(
        root,
        "candidate_seal.v1.json",
        {
            "champion_trial_id": champion,
            "created_at": "2026-07-30T00:00:10Z",
            "development_file_sha256": verifier.sha256_file(root / "development.v1.json"),
            "freeze_file_sha256": verifier.sha256_file(root / "freeze.v1.json"),
            "frozen_commit": FROZEN_COMMIT,
            "run_consumed_file_sha256": verifier.sha256_file(root / "run_consumed.v1.json"),
            "source_manifest_file_sha256": verifier.sha256_file(root / "source_manifest.v1.json"),
            "trial_ledger_file_sha256": verifier.sha256_file(root / "trial_ledger.v1.json"),
        },
    )
    _write_json(
        root,
        "holdout_open.v1.json",
        {
            "allowed_holdout_open_count": 1,
            "candidate_seal_file_sha256": verifier.sha256_file(root / "candidate_seal.v1.json"),
            "champion_trial_id": champion,
            "created_at": "2026-07-30T00:00:11Z",
            "development_file_sha256": verifier.sha256_file(root / "development.v1.json"),
            "frozen_commit": FROZEN_COMMIT,
            "holdout_archive_member_open_count_before": holdout_before,
            "holdout_open_ordinal": 1,
            "marker_created_before_first_member": True,
            "marker_created_before_holdout_open": True,
            "reserved_holdout_path": "holdout.v1.json",
            "reserved_result_path": "result.v1.json",
        },
    )
    if measured:
        summary: dict[str, Any] = _holdout_summary()
        gates = dict.fromkeys(verifier.HOLDOUT_GATE_KEYS, True)
    else:
        summary = dict.fromkeys(verifier.HOLDOUT_SUMMARY_KEYS)
        gates = dict.fromkeys(verifier.HOLDOUT_GATE_KEYS, False)
    _write_json(
        root,
        "holdout.v1.json",
        {
            "all_gates_pass": measured,
            "candidate_seal_file_sha256": verifier.sha256_file(root / "candidate_seal.v1.json"),
            "champion_trial_id": champion,
            "created_at": "2026-07-30T00:00:12Z",
            "frozen_commit": FROZEN_COMMIT,
            "gates": gates,
            "holdout_archive_member_open_count": 360,
            "holdout_open_file_sha256": verifier.sha256_file(root / "holdout_open.v1.json"),
            "outcome_state": "MEASURED" if measured else "UNMEASURED",
            "summary": summary,
        },
    )
    common = {
        **_common_result(root),
        "candidate_seal_file_sha256": verifier.sha256_file(root / "candidate_seal.v1.json"),
        "development_and_holdout_custody": _custody(
            screen_count=_packet_screen_count(root),
            development_count=900,
            development_state="MEASURED_ONCE",
            holdout_count=360,
            holdout_open_count=1,
            holdout_state="OPENED_ONCE_CHAMPION_ONLY",
        ),
        "development_file_sha256": verifier.sha256_file(root / "development.v1.json"),
        "holdout_file_sha256": verifier.sha256_file(root / "holdout.v1.json"),
        "holdout_open_file_sha256": verifier.sha256_file(root / "holdout_open.v1.json"),
        "holdout_state": "OPENED_ONCE_CHAMPION_ONLY",
    }
    if measured:
        result = {
            **common,
            **_measured_fields(development, summary, holdout=True),
            "outcome_state": "MEASURED_HOLDOUT",
            "strategy_verdict": "NO_GO",
            "verdict": "PUBLIC_PROXY_PASS_CAPITAL_NO_GO",
        }
    else:
        result = {
            **common,
            **_null_result_fields(),
            "outcome_state": "TERMINAL_UNMEASURED",
            "reason_code": "HOLDOUT_EVIDENCE_INVALID_AFTER_OPEN",
            "strategy_verdict": "UNMEASURED",
            "verdict": "UNMEASURED_RUN_CONSUMED_NO_RERUN",
        }
    _write_json(root, "result.v1.json", result)


def _build_development_packet(
    root: Path,
    *,
    admitted: bool,
    holdout_measured: bool | None = None,
    holdout_before: int = 0,
) -> Path:
    _build_terminal_packet(root)
    development = _add_development(root, admitted=admitted)
    if admitted:
        assert holdout_measured is not None
        _add_holdout(
            root,
            development,
            measured=holdout_measured,
            holdout_before=holdout_before,
        )
    _refresh_sums(root)
    return root


def test_terminal_unmeasured_packet_authenticates(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    receipt = verifier.verify_packet(root)
    assert receipt["status"] == "AUTHENTIC"
    assert receipt["strategyVerdict"] == "UNMEASURED"
    assert receipt["archiveMembersOpenedByVerifier"] == 0


def test_measured_development_no_go_packet_authenticates(tmp_path: Path) -> None:
    root = _build_development_packet(tmp_path / "packet", admitted=False)
    receipt = verifier.verify_packet(root)
    assert receipt["strategyVerdict"] == "NO_GO"
    assert receipt["holdoutState"] == "UNOPENED"


def test_measured_holdout_packet_authenticates(tmp_path: Path) -> None:
    root = _build_development_packet(
        tmp_path / "packet",
        admitted=True,
        holdout_measured=True,
    )
    receipt = verifier.verify_packet(root)
    assert receipt["strategyVerdict"] == "NO_GO"
    assert receipt["holdoutState"] == "OPENED_ONCE_CHAMPION_ONLY"


def test_unmeasured_holdout_packet_authenticates(tmp_path: Path) -> None:
    root = _build_development_packet(
        tmp_path / "packet",
        admitted=True,
        holdout_measured=False,
    )
    receipt = verifier.verify_packet(root)
    assert receipt["strategyVerdict"] == "UNMEASURED"


@pytest.mark.parametrize(
    ("file_name", "object_field", "member", "replacement", "expected_code"),
    [
        (
            "protocol.v1.json",
            "authority",
            "money_moved_usd",
            False,
            "PROTOCOL_AUTHORITY_INVALID",
        ),
        (
            "source_plan.v1.json",
            "authority",
            "money_moved_usd",
            False,
            "SOURCE_PLAN_AUTHORITY_INVALID",
        ),
        (
            "source_plan.v1.json",
            "network_policy",
            "credentials",
            0,
            "SOURCE_PLAN_NETWORK_POLICY_INVALID",
        ),
    ],
)
def test_redigested_static_bool_int_alias_is_rejected(
    tmp_path: Path,
    file_name: str,
    object_field: str,
    member: str,
    replacement: Any,
    expected_code: str,
) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    document = _load(root, file_name)
    nested = cast(dict[str, Any], document[object_field])
    nested[member] = replacement
    (root / file_name).write_bytes(verifier.canonical_bytes(document))
    _redigest_pre_run_chain(root)
    with pytest.raises(verifier.VerificationError, match=rf"^{expected_code}$"):
        verifier.verify_packet(root)


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("money_moved_usd", False),
        ("live_trading", 0),
    ],
)
def test_redigested_result_effect_bool_int_alias_is_rejected(
    tmp_path: Path,
    field: str,
    replacement: Any,
) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    result = _load(root, "result.v1.json")
    effects = cast(dict[str, Any], result["effects"])
    effects[field] = replacement
    (root / "result.v1.json").write_bytes(verifier.canonical_bytes(result))
    _refresh_sums(root)
    with pytest.raises(verifier.VerificationError, match=r"^RESULT_EFFECTS_INVALID$"):
        verifier.verify_packet(root)


@pytest.mark.parametrize(
    ("file_name", "field", "replacement", "expected_code"),
    [
        ("preseal.v1.json", "allowed_screen_count", True, "PRESEAL_BASE_INVALID"),
        (
            "screen_consumed.v1.json",
            "allowed_screen_count",
            True,
            "SCREEN_CUSTODY_INVALID",
        ),
        ("screen_consumed.v1.json", "screen_ordinal", True, "SCREEN_CUSTODY_INVALID"),
        (
            "screen_consumed.v1.json",
            "screen_archive_member_open_count_before",
            False,
            "SCREEN_CUSTODY_INVALID",
        ),
        ("freeze.v1.json", "allowed_run_count", True, "FREEZE_CUSTODY_INVALID"),
        (
            "freeze.v1.json",
            "development_archive_member_open_count",
            False,
            "FREEZE_CUSTODY_INVALID",
        ),
        (
            "freeze.v1.json",
            "holdout_archive_member_open_count",
            False,
            "FREEZE_CUSTODY_INVALID",
        ),
        ("run_consumed.v1.json", "allowed_run_count", True, "RUN_CUSTODY_INVALID"),
        ("run_consumed.v1.json", "run_ordinal", True, "RUN_CUSTODY_INVALID"),
        (
            "run_consumed.v1.json",
            "development_archive_member_open_count_before",
            False,
            "RUN_CUSTODY_INVALID",
        ),
        (
            "run_consumed.v1.json",
            "holdout_archive_member_open_count_before",
            False,
            "RUN_CUSTODY_INVALID",
        ),
    ],
)
def test_redigested_pre_run_count_bool_alias_is_rejected(
    tmp_path: Path,
    file_name: str,
    field: str,
    replacement: Any,
    expected_code: str,
) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    document = _load(root, file_name)
    document[field] = replacement
    (root / file_name).write_bytes(verifier.canonical_bytes(document))
    _redigest_pre_run_chain(root)
    with pytest.raises(verifier.VerificationError, match=rf"^{expected_code}$"):
        verifier.verify_packet(root)


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("allowed_holdout_open_count", True),
        ("holdout_open_ordinal", True),
        ("holdout_archive_member_open_count_before", False),
    ],
)
def test_redigested_holdout_open_count_bool_alias_is_rejected(
    tmp_path: Path,
    field: str,
    replacement: Any,
) -> None:
    root = _build_development_packet(
        tmp_path / "packet",
        admitted=True,
        holdout_measured=True,
    )
    opened = _load(root, "holdout_open.v1.json")
    opened[field] = replacement
    (root / "holdout_open.v1.json").write_bytes(verifier.canonical_bytes(opened))
    _redigest_holdout_after_open(root)
    with pytest.raises(
        verifier.VerificationError,
        match=r"^HOLDOUT_OPEN_CUSTODY_INVALID$",
    ):
        verifier.verify_packet(root)


def test_screen_before_open_count_is_enforced(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet", screen_before=1)
    with pytest.raises(verifier.VerificationError, match="SCREEN_CUSTODY_INVALID"):
        verifier.verify_packet(root)


def test_universe_rank_is_enforced(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet", rank_tamper=True)
    with pytest.raises(
        verifier.VerificationError,
        match="UNIVERSE_SCREEN_SELECTION_INVALID",
    ):
        verifier.verify_packet(root)


def test_zero_volume_success_authenticates_and_ranks_last(tmp_path: Path) -> None:
    root = _build_terminal_packet(
        tmp_path / "packet",
        zero_volume_success=True,
    )
    receipt = verifier.verify_packet(root)
    universe = _load(root, "universe.v1.json")
    attempts = cast(list[dict[str, Any]], universe["screen_attempts"])
    assert attempts[0]["status"] == "SUCCESS"
    assert attempts[0]["screen_quote_volume"] == "0"
    assert "S00USDT" not in universe["selected_symbols"]
    assert universe["selected_symbols"][-1] == "S30USDT"
    assert receipt["status"] == "AUTHENTIC"


def test_omitted_better_screen_candidate_is_rejected(tmp_path: Path) -> None:
    root = _build_terminal_packet(
        tmp_path / "packet",
        omit_better_candidate=True,
    )
    with pytest.raises(
        verifier.VerificationError,
        match="UNIVERSE_SCREEN_SELECTION_INVALID",
    ):
        verifier.verify_packet(root)


def test_screen_attempt_open_count_sum_drift_is_rejected(tmp_path: Path) -> None:
    root = _build_terminal_packet(
        tmp_path / "packet",
        screen_sum_drift=True,
    )
    with pytest.raises(
        verifier.VerificationError,
        match="UNIVERSE_SCREEN_OPEN_COUNT_SUM_INVALID",
    ):
        verifier.verify_packet(root)


@pytest.mark.parametrize("member_open_count", [1, 4])
def test_successful_screen_attempt_requires_exactly_three_member_opens(
    tmp_path: Path,
    member_open_count: int,
) -> None:
    root = _build_terminal_packet(
        tmp_path / "packet",
        first_success_open_count=member_open_count,
    )
    with pytest.raises(
        verifier.VerificationError,
        match=(
            "UNIVERSE_SUCCESS_ATTEMPT_CUSTODY_INVALID"
            if member_open_count == 1
            else "UNIVERSE_ATTEMPT_OPEN_COUNT_INVALID"
        ),
    ):
        verifier.verify_packet(root)


def test_june_digest_link_is_enforced(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet", june_digest_drift=True)
    with pytest.raises(
        verifier.VerificationError,
        match="MANIFEST_UNIVERSE_DIGEST_DRIFT",
    ):
        verifier.verify_packet(root)


def test_official_manifest_path_is_enforced(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet", path_tamper=True)
    with pytest.raises(
        verifier.VerificationError,
        match="MANIFEST_PATH_OR_URL_INVALID",
    ):
        verifier.verify_packet(root)


def test_fabricated_trial_gate_is_rejected(tmp_path: Path) -> None:
    root = _build_development_packet(tmp_path / "packet", admitted=False)
    development = _load(root, "development.v1.json")
    first = cast(list[dict[str, Any]], development["trials"])[0]
    cast(dict[str, bool], first["development_gates"])["base_net_usd_per_1000_gt"] = True
    (root / "development.v1.json").write_bytes(verifier.canonical_bytes(development))
    _rewrite(
        root,
        "result.v1.json",
        development_file_sha256=verifier.sha256_file(root / "development.v1.json"),
    )
    _refresh_sums(root)
    with pytest.raises(
        verifier.VerificationError,
        match="DEVELOPMENT_TRIAL_GATE_DERIVATION_INVALID",
    ):
        verifier.verify_packet(root)


def test_fabricated_holm_is_rejected_before_admission_or_result(
    tmp_path: Path,
) -> None:
    root = _build_development_packet(
        tmp_path / "packet",
        admitted=True,
        holdout_measured=True,
    )
    development = _load(root, "development.v1.json")
    summaries = cast(list[dict[str, Any]], development["trials"])
    for summary in summaries:
        summary["base_p_value"] = "0.01"
        summary["stress_p_value"] = "0.01"
        summary["holm_adjusted_p"] = "0.01"
    (root / "development.v1.json").write_bytes(verifier.canonical_bytes(development))

    _rewrite(
        root,
        "candidate_seal.v1.json",
        development_file_sha256=verifier.sha256_file(root / "development.v1.json"),
    )
    _rewrite(
        root,
        "holdout_open.v1.json",
        candidate_seal_file_sha256=verifier.sha256_file(root / "candidate_seal.v1.json"),
        development_file_sha256=verifier.sha256_file(root / "development.v1.json"),
    )
    _rewrite(
        root,
        "holdout.v1.json",
        candidate_seal_file_sha256=verifier.sha256_file(root / "candidate_seal.v1.json"),
        holdout_open_file_sha256=verifier.sha256_file(root / "holdout_open.v1.json"),
    )
    result = _load(root, "result.v1.json")
    result["candidate_seal_file_sha256"] = verifier.sha256_file(root / "candidate_seal.v1.json")
    result["development_file_sha256"] = verifier.sha256_file(root / "development.v1.json")
    result["holdout_file_sha256"] = verifier.sha256_file(root / "holdout.v1.json")
    result["holdout_open_file_sha256"] = verifier.sha256_file(root / "holdout_open.v1.json")
    result["holm_p_values"] = {str(summary["trial_id"]): "0.01" for summary in summaries}
    (root / "result.v1.json").write_bytes(verifier.canonical_bytes(result))
    _refresh_sums(root)

    with pytest.raises(verifier.VerificationError, match=r"^HOLM_DERIVATION_INVALID$"):
        verifier.verify_packet(root)


def test_null_measured_economics_is_rejected(tmp_path: Path) -> None:
    root = _build_development_packet(tmp_path / "packet", admitted=False)
    result = _load(root, "result.v1.json")
    cast(dict[str, Any], result["net_usd_per_1000_by_scenario"])["base"] = None
    (root / "result.v1.json").write_bytes(verifier.canonical_bytes(result))
    _refresh_sums(root)
    with pytest.raises(verifier.VerificationError, match="RESULT_SCENARIO_NET_INVALID"):
        verifier.verify_packet(root)


def test_holdout_before_open_count_is_enforced(tmp_path: Path) -> None:
    root = _build_development_packet(
        tmp_path / "packet",
        admitted=True,
        holdout_measured=True,
        holdout_before=1,
    )
    with pytest.raises(
        verifier.VerificationError,
        match="HOLDOUT_OPEN_CUSTODY_INVALID",
    ):
        verifier.verify_packet(root)


@pytest.mark.parametrize("member_open_count", [1, 901])
def test_measured_development_requires_exact_member_open_count(
    tmp_path: Path,
    member_open_count: int,
) -> None:
    root = _build_development_packet(tmp_path / "packet", admitted=False)
    development = _load(root, "development.v1.json")
    development["development_archive_member_open_count"] = member_open_count
    (root / "development.v1.json").write_bytes(verifier.canonical_bytes(development))
    result = _load(root, "result.v1.json")
    custody = cast(
        dict[str, dict[str, Any]],
        result["development_and_holdout_custody"],
    )
    custody["development"]["archive_member_open_count"] = member_open_count
    result["development_file_sha256"] = verifier.sha256_file(root / "development.v1.json")
    (root / "result.v1.json").write_bytes(verifier.canonical_bytes(result))
    _refresh_sums(root)
    with pytest.raises(
        verifier.VerificationError,
        match="DEVELOPMENT_OPENED_HOLDOUT",
    ):
        verifier.verify_packet(root)


@pytest.mark.parametrize("member_open_count", [1, 361])
def test_measured_holdout_requires_exact_member_open_count(
    tmp_path: Path,
    member_open_count: int,
) -> None:
    root = _build_development_packet(
        tmp_path / "packet",
        admitted=True,
        holdout_measured=True,
    )
    holdout = _load(root, "holdout.v1.json")
    holdout["holdout_archive_member_open_count"] = member_open_count
    (root / "holdout.v1.json").write_bytes(verifier.canonical_bytes(holdout))
    result = _load(root, "result.v1.json")
    custody = cast(
        dict[str, dict[str, Any]],
        result["development_and_holdout_custody"],
    )
    custody["holdout"]["archive_member_open_count"] = member_open_count
    result["holdout_file_sha256"] = verifier.sha256_file(root / "holdout.v1.json")
    (root / "result.v1.json").write_bytes(verifier.canonical_bytes(result))
    _refresh_sums(root)
    with pytest.raises(
        verifier.VerificationError,
        match="HOLDOUT_MEMBER_OPEN_COUNT_INVALID",
    ):
        verifier.verify_packet(root)


def test_terminal_development_count_above_bound_is_rejected(
    tmp_path: Path,
) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    result = _load(root, "result.v1.json")
    custody = cast(
        dict[str, dict[str, Any]],
        result["development_and_holdout_custody"],
    )
    custody["development"]["archive_member_open_count"] = 901
    (root / "result.v1.json").write_bytes(verifier.canonical_bytes(result))
    _refresh_sums(root)
    with pytest.raises(
        verifier.VerificationError,
        match="RESULT_DEVELOPMENT_CUSTODY_INVALID",
    ):
        verifier.verify_packet(root)


def test_post_open_unmeasured_holdout_count_above_bound_is_rejected(
    tmp_path: Path,
) -> None:
    root = _build_development_packet(
        tmp_path / "packet",
        admitted=True,
        holdout_measured=False,
    )
    holdout = _load(root, "holdout.v1.json")
    holdout["holdout_archive_member_open_count"] = 361
    (root / "holdout.v1.json").write_bytes(verifier.canonical_bytes(holdout))
    result = _load(root, "result.v1.json")
    custody = cast(
        dict[str, dict[str, Any]],
        result["development_and_holdout_custody"],
    )
    custody["holdout"]["archive_member_open_count"] = 361
    result["holdout_file_sha256"] = verifier.sha256_file(root / "holdout.v1.json")
    (root / "result.v1.json").write_bytes(verifier.canonical_bytes(result))
    _refresh_sums(root)
    with pytest.raises(
        verifier.VerificationError,
        match="HOLDOUT_MEMBER_OPEN_COUNT_INVALID",
    ):
        verifier.verify_packet(root)


def test_trial_tuple_or_order_drift_is_rejected() -> None:
    protocol = json.loads((SOURCE_DIR / "protocol.v1.json").read_text(encoding="utf-8"))
    source_plan = json.loads((SOURCE_DIR / "source_plan.v1.json").read_text(encoding="utf-8"))
    ledger = json.loads((SOURCE_DIR / "trial_ledger.v1.json").read_text(encoding="utf-8"))
    ledger["trials"][0], ledger["trials"][1] = ledger["trials"][1], ledger["trials"][0]
    with pytest.raises(verifier.VerificationError, match="TRIAL_LEDGER_COUNT_INVALID"):
        verifier._validate_protocol_documents(protocol, source_plan, ledger)


@pytest.mark.parametrize(
    ("gate_group", "threshold", "hostile_value", "expected_code"),
    [
        (
            "development_gates",
            "active_cohorts_min",
            0,
            "PROTOCOL_DEVELOPMENT_GATES_INVALID",
        ),
        (
            "development_gates",
            "base_capacity_min_usd_gte",
            0.0,
            "PROTOCOL_DEVELOPMENT_GATES_INVALID",
        ),
        (
            "development_gates",
            "pbo_lte",
            1.0,
            "PROTOCOL_DEVELOPMENT_GATES_INVALID",
        ),
        (
            "development_gates",
            "severe_hourly_marked_equity_max_drawdown_lte",
            1.0,
            "PROTOCOL_DEVELOPMENT_GATES_INVALID",
        ),
        (
            "development_gates",
            "white_reality_check_base_p_lte",
            1.0,
            "PROTOCOL_DEVELOPMENT_GATES_INVALID",
        ),
        (
            "development_gates",
            "champion_holm_p_lte",
            1.0,
            "PROTOCOL_DEVELOPMENT_GATES_INVALID",
        ),
        (
            "holdout_gates_if_opened",
            "active_cohorts_min",
            0,
            "PROTOCOL_HOLDOUT_GATES_INVALID",
        ),
        (
            "holdout_gates_if_opened",
            "base_capacity_min_usd_gte",
            0.0,
            "PROTOCOL_HOLDOUT_GATES_INVALID",
        ),
        (
            "holdout_gates_if_opened",
            "severe_hourly_marked_equity_max_drawdown_lte",
            1.0,
            "PROTOCOL_HOLDOUT_GATES_INVALID",
        ),
    ],
)
def test_redigested_protocol_gate_mutation_is_rejected_before_derived_gates(
    tmp_path: Path,
    gate_group: str,
    threshold: str,
    hostile_value: Any,
    expected_code: str,
) -> None:
    root = _build_development_packet(
        tmp_path / "packet",
        admitted=True,
        holdout_measured=True,
    )
    protocol = _load(root, "protocol.v1.json")
    gates = cast(dict[str, Any], protocol[gate_group])
    gates[threshold] = hostile_value
    (root / "protocol.v1.json").write_bytes(verifier.canonical_bytes(protocol))
    _refresh_sums(root)
    with pytest.raises(verifier.VerificationError, match=rf"^{expected_code}$"):
        verifier.verify_packet(root)


def test_source_plan_manifest_fields_order_is_enforced() -> None:
    protocol = json.loads((SOURCE_DIR / "protocol.v1.json").read_text(encoding="utf-8"))
    source_plan = json.loads((SOURCE_DIR / "source_plan.v1.json").read_text(encoding="utf-8"))
    ledger = json.loads((SOURCE_DIR / "trial_ledger.v1.json").read_text(encoding="utf-8"))
    selected_source_freeze = cast(
        dict[str, Any],
        source_plan["selected_source_freeze"],
    )
    selected_source_freeze["manifest_fields"] = list(reversed(verifier.SOURCE_MANIFEST_FIELDS))
    with pytest.raises(
        verifier.VerificationError,
        match="SOURCE_PLAN_MANIFEST_FIELDS_INVALID",
    ):
        verifier._validate_protocol_documents(protocol, source_plan, ledger)


def test_artifact_sha256_is_rejected_outright(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    result = _load(root, "result.v1.json")
    result["artifact_sha256"] = "0" * 64
    (root / "result.v1.json").write_bytes(verifier.canonical_bytes(result))
    _refresh_sums(root)
    with pytest.raises(
        verifier.VerificationError,
        match="SELF_DIGEST_FIELD_FORBIDDEN",
    ):
        verifier.verify_packet(root)


def test_partial_holdout_bundle_is_rejected(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    _write_json(root, "candidate_seal.v1.json", {})
    _refresh_sums(root)
    with pytest.raises(verifier.VerificationError, match="PARTIAL_HOLDOUT_BUNDLE"):
        verifier.verify_packet(root)


def test_sha256sums_tamper_is_rejected(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    lines = (root / "SHA256SUMS").read_text(encoding="ascii").splitlines()
    lines[0] = "0" * 64 + lines[0][64:]
    (root / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="ascii")
    with pytest.raises(
        verifier.VerificationError,
        match="SHA256SUMS_DIGEST_INVALID",
    ):
        verifier.verify_packet(root)


def test_noncanonical_json_is_rejected(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    protocol = _load(root, "protocol.v1.json")
    (root / "protocol.v1.json").write_text(
        json.dumps(protocol, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    _refresh_sums(root)
    with pytest.raises(verifier.VerificationError, match="NONCANONICAL_JSON"):
        verifier.verify_packet(root)


def test_unmeasured_null_cannot_be_relabelled_zero(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    result = _load(root, "result.v1.json")
    cast(dict[str, Any], result["net_usd_per_1000_by_scenario"])["base"] = "0"
    (root / "result.v1.json").write_bytes(verifier.canonical_bytes(result))
    _refresh_sums(root)
    with pytest.raises(
        verifier.VerificationError,
        match="UNMEASURED_ECONOMICS_NOT_NULL",
    ):
        verifier.verify_packet(root)


def test_redigested_second_run_marker_is_rejected(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    _rewrite(root, "run_consumed.v1.json", run_ordinal=2)
    _rewrite(
        root,
        "result.v1.json",
        run_consumed_file_sha256=verifier.sha256_file(root / "run_consumed.v1.json"),
    )
    _refresh_sums(root)
    with pytest.raises(verifier.VerificationError, match="RUN_CUSTODY_INVALID"):
        verifier.verify_packet(root)


def test_unexpected_file_is_rejected(tmp_path: Path) -> None:
    root = _build_terminal_packet(tmp_path / "packet")
    (root / "notes.txt").write_text("not sealed\n", encoding="utf-8")
    with pytest.raises(verifier.VerificationError, match="INVENTORY_INVALID"):
        verifier.verify_packet(root)


def test_network_import_is_rejected(tmp_path: Path) -> None:
    source = tmp_path / "verifier.py"
    source.write_text("import socket\n", encoding="utf-8")
    with pytest.raises(
        verifier.VerificationError,
        match="VERIFIER_NETWORK_OR_PROCESS_IMPORT",
    ):
        verifier.ensure_network_free_verifier(source)
