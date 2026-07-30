#!/usr/bin/env python3
"""Freeze and verify the N3-S4 accepted-boundary profitability state.

N3-S4 is an offline overlay on the accepted N3-S3 registry. It consumes one
terminal economic origin (S-1T), one already-pinned source validator durability
receipt (DQ-1), and two pre-worktree state-only custody stops (LIQ-CUSTODY1 and
BORROW-CUSTODY1). It does not rerun research or open any archive or holdout.

The command reads only explicit local files and exact Git objects. It has no
network, clock, provider, private API, host, order, transfer, withdrawal, M0,
or money capability.
"""

from __future__ import annotations

import argparse
import copy
import re
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import registry_tool as n3s1
import registry_tool_v3 as n3s3

ContractError = n3s3.ContractError

SCHEMA = "N3S4ProfitabilityStateV1"
SPEC_SCHEMA = "N3S4OriginSpecV1"
VERSION = 1

CANONICAL_COMMIT = n3s3.CANONICAL_COMMIT
CANONICAL_TREE = n3s3.CANONICAL_TREE

BASELINE_COMMIT = "88d2c06350e3387ab810010f6027d9d52191f3fe"
BASELINE_TREE = "d5f861a1d4c4f5bdf69fed92fdfbf227d847dce0"
BASELINE_PARENT = "cf00db3f44c030dc393639b4ea7493797fe2aba6"
BASELINE_RECORD_ID = "2026-07-30 ORCHESTRATOR N3-S3 ACCEPTANCE + DATA-CUSTODY REFILL"
BASELINE_ROW_SHA256 = "bdbc59911a8a154346cd1bc6def14be56eb57e2bf7f86538e7225a828da5258c"

BASELINE_ARTIFACTS = (
    (
        "readme",
        "quant/research/n3_successor/README_S3.md",
        "08ed55ab082921c09a2674550f7554d46a705cb63f7e927384402d4985253701",
    ),
    (
        "originSpec",
        "quant/research/n3_successor/origin_spec.v3.json",
        "888eedf0e68edfc9b767715e8b78d3d242f103a8666ab230b2ec2b7c3a301b82",
    ),
    (
        "registry",
        "quant/research/n3_successor/current_profitability_registry.v3.json",
        "8815efdaf4c5f23373fa6a27bc8a90a0eeb5f91da84aec662df9e212f49bf460",
    ),
    (
        "card",
        "quant/research/n3_successor/owner_verdict_card.v3.md",
        "a8edf60e148ddfe466a57aa31e58768c901234d9cebb4aedec1f6ab53cd91939",
    ),
    (
        "tool",
        "quant/research/n3_successor/registry_tool_v3.py",
        "b075d371bd0d7524745592b220184292474ee3bf2285e2112fa3b75810d30a80",
    ),
    (
        "tests",
        "quant/research/n3_successor/test_registry_v3.py",
        "de924749970844293812707a67f64738d1a2464e5c0863d2cb12c8172a3c3d74",
    ),
)

BASELINE_ORIGINS_SHA256 = "c49ff1b31e00a17987957bd8a2f42180d55be0abb2b0a51b98f34dbc44fadc3b"
BASELINE_FAMILIES_SHA256 = "a337f9f5a0c3d6617f694a97e73603e72396e2baef68a58ade0d59a59026ece9"
BASELINE_LEDGER_SHA256 = "3190655dc2394e05a714fd7cdb2bb92ef7d2307e34b235a30b745988c7c79a11"
BASELINE_SOURCE_PINS_SHA256 = "394b7907df89ec87f2d28d58acfe604280fc0c836b3d0ab995392e1d56b608ca"
BASELINE_PENDING_SHA256 = "8a014e0b0df441a0a8625fee2226ddffbe16b6ff229968f8b5181b29f5d255d8"
BASELINE_LEGACY_SHA256 = "999e0e530da8136349435c1534dcd357d432916309f02bfb611e2dd91d11fa88"
BASELINE_TRUTH_SHA256 = "9ada035aa4e394641243530de655dcb5fd9c7aefede09f56b097f5ccb2b3a48e"
BASELINE_SUMMARY_SHA256 = "9b131a3f1b3549bb719e910761b366d3d4e91995b17d7d25af772b8655532468"
BASELINE_DELTA_SHA256 = "9fe765fa3202581630ef312dd79955a2bdb6338fbfc2b9d5af61248b9425da83"

DQ1_RECORD_ID = "2026-07-30 ORCHESTRATOR DQ-1 DURABILITY ACCEPTANCE"
DQ1_ROW_SHA256 = "7a80f78933f53c8a6c0295080b604634f62a5fc2dfc1743171ff0dc92431220f"
DQ1_BINDING_RECORD_ID = "2026-07-30 ORCHESTRATOR DQ-1 ACCEPTANCE + REFILL"
DQ1_BINDING_ROW_SHA256 = "02a45154afb6e5592b124919ee2aa46e3d44e2bb118438a5599dee57d77ca7d9"
DQ1_COMMIT = "ec0c9f436d01f25134c226057981b107dfc97f67"
DQ1_TREE = "52f854d7fbcde842baa739333b0fc7b3e5fdc921"
DQ1_PATH = "quant/research/dq1/policy.v1.json"
DQ1_RAW_SHA256 = "7c134e0f3d84c15460f7e05a3f911404b6d07cc73a36656d686b24370a5f1016"

S1T_RECORD_ID = "2026-07-30 ORCHESTRATOR S-1T ACCEPTANCE"
S1T_ROW_SHA256 = "8bb12801be99b246f43c34a3758626f9db9f0df090a393753bd812fb4d7ac28e"
S1T_COMMIT = "c5e683ee42e7b156dde388a12bc0299d53b4cfc9"
S1T_TREE = "6c34266d0300fbc88d85decd90bd1fd5e7bf36a9"
S1T_RESULT_PATH = "quant/research/s1t/evidence/terminal/result.v1.json"
S1T_RESULT_SHA256 = "0558791e94d4edebcc7a20756ec022e924578b9103b655427bc3a0183b5eb16f"
S1T_PROTOCOL_PATH = "quant/research/s1t/protocol.v1.json"
S1T_PROTOCOL_SHA256 = "af9868d6404829dad4cf90efb290b72185028e41a3148318b5ecfa8c6ee1b9b3"
S1T_PROTOCOL_BLOB = "c2968d970f95a685a51d255d91e6d113730aa618"
S1T_STATIC_COMMIT = "ee1e7f32609ba25932e9805046594cccc98291b2"
S1T_STATIC_TREE = "551fc7369bbbae20ce1cfd0ef9f20bb72f1041bf"
S1T_TRIAL_PATH = "quant/research/s1t/trial_ledger.v1.json"
S1T_TRIAL_SHA256 = "101248044d8bb0d755400497d7c0fa239558ae7f604e5f04d995385e5a21592d"
S1T_FREEZE_PATH = "quant/research/s1t/evidence/preoutcome/freeze.v1.json"
S1T_FREEZE_SHA256 = "e5fe6d685d3c02fec56a64b135a0674527e31f9d7e3ed82e68bfcbaae9c75df5"
S1T_RUN_PATH = "quant/research/s1t/evidence/terminal/run_consumed.v1.json"
S1T_RUN_SHA256 = "82af3821640aee8826d536a9739e10fdbd2cee500a0179eb80271a02c4fdde5f"
S1T_FAMILY_KEY = f"POST_SMETA1::S-1T::{S1T_PROTOCOL_SHA256}"
S1T_LIMITATIONS_SHA256 = "6721114a8764c61985d3c0dab28c20cd3c07313764ecae57de600b315c58c39a"

LIQ_RECORD_ID = "2026-07-30 ORCHESTRATOR LIQ-CUSTODY1 ACCEPTANCE"
LIQ_ROW_SHA256 = "05d90c8493b96ded9b625664622b56acf968884e625245a75e2e687e5b5a6e16"
LIQ_TERMINAL_RECORD_ID = "2026-07-30 LIQ-CUSTODY1 USD-M FORCED-LIQUIDATION CUSTODY STOP"
LIQ_TERMINAL_ROW_SHA256 = "483c07e4a70e0b7715e256f61ae9d3c99abf76dc6067782fe55525b5e4b698b0"
BORROW_RECORD_ID = "2026-07-30 ORCHESTRATOR BORROW-CUSTODY1 ACCEPTANCE"
BORROW_ROW_SHA256 = "9eaac0b4c9e4ca55f057a6c5784ae02eef92889591af2e28a1e8a5d5e8693c9f"
BORROW_TERMINAL_RECORD_ID = "2026-07-30 BORROW-CUSTODY1 SPOT MARGIN SHORT-CUSTODY TERMINAL"
BORROW_TERMINAL_ROW_SHA256 = "e2a7c5e6852e88603ad112b9084cf84856391896106c4c66e68427eb04394399"

SELECTED_RECORD_IDS = (
    LIQ_TERMINAL_RECORD_ID,
    BORROW_TERMINAL_RECORD_ID,
    DQ1_RECORD_ID,
    S1T_RECORD_ID,
    LIQ_RECORD_ID,
    BORROW_RECORD_ID,
)
ROW_SHA256 = {
    LIQ_TERMINAL_RECORD_ID: LIQ_TERMINAL_ROW_SHA256,
    BORROW_TERMINAL_RECORD_ID: BORROW_TERMINAL_ROW_SHA256,
    DQ1_RECORD_ID: DQ1_ROW_SHA256,
    S1T_RECORD_ID: S1T_ROW_SHA256,
    LIQ_RECORD_ID: LIQ_ROW_SHA256,
    BORROW_RECORD_ID: BORROW_ROW_SHA256,
}

REQUIRED_TRUTH_CODES = n3s3.REQUIRED_TRUTH_CODES
EXPECTED_ORIGIN_COUNT = 50
EXPECTED_FAMILY_COUNT = 49
EXPECTED_LOCAL_VERDICTS = {"NO_GO": 24, "UNMEASURED": 26}
EXPECTED_SOURCE_PIN_COUNT = 13

NO_EFFECTS = {
    "credentialsUsed": False,
    "hostEffects": False,
    "moneyMovedUsd": 0,
    "ordersPlaced": 0,
    "privateApiUsed": False,
    "providerMutation": False,
    "transfers": 0,
    "uiEffects": False,
    "withdrawals": 0,
}

LIQ_LIMITATIONS = (
    "NO_PUBLIC_USDM_12_MONTH_LIQUIDATION_CORPUS",
    "LIQUIDATION_SNAPSHOT_ARCHIVE_EMPTY_FOR_USDM",
    "COINM_NOT_SUBSTITUTABLE",
    "ARCHIVE_SCHEMA_RETENTION_AND_STREAM_IDENTITY_UNDOCUMENTED",
    "AVAILABILITY_CLOCK_UNSUPPORTED",
    "FINALITY_REVISION_UNSUPPORTED",
    "HISTORICAL_IDENTITY_UNSUPPORTED",
    "HOLDOUT_NOT_CREATED_NO_PRODUCT_BYTES",
)
BORROW_LIMITATIONS = (
    "NO_IMMUTABLE_PUBLIC_12_MONTH_POINT_IN_TIME_CUSTODY_HISTORY",
    "PUBLIC_SURFACES_CURRENT_SNAPSHOT_ONLY",
    "INVENTORY_RATE_AND_ACCRUAL_HISTORY_USER_DATA_OR_ACCOUNT_SPECIFIC",
    "RATE_HISTORY_12_MONTH_RETENTION_EFFECTIVE_TIME_AND_IMMUTABILITY_UNDOCUMENTED",
    "ACCRUED_INTEREST_HISTORY_ONLY_PAST_90_DAYS",
    "PUBLIC_SPOT_ARCHIVE_HAS_NO_MARGIN_CUSTODY_OR_HISTORICAL_IDENTITY",
    "HOLDOUT_NOT_CREATED_NO_PRODUCT_BYTES",
)

FULL_IDENTIFIER = re.compile(r"(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])")


def _fail(message: str) -> None:
    raise ContractError(message)


def _require(condition: bool, message: str) -> None:
    if not condition:
        _fail(message)


def _canonical_bytes(value: Any) -> bytes:
    return n3s3._canonical_bytes(value)


def _sha256(raw: bytes) -> str:
    return n3s3._sha256(raw)


def _exact_dict(value: Any, label: str) -> dict[str, Any]:
    return n3s3._exact_dict(value, label)


def _exact_list(value: Any, label: str) -> list[Any]:
    return n3s3._exact_list(value, label)


def _exact_str(value: Any, label: str) -> str:
    return n3s3._exact_str(value, label)


def load_json(path: Path) -> dict[str, Any]:
    return n3s3.load_json(path)


def _load_json_bytes(raw: bytes, label: str) -> dict[str, Any]:
    return n3s3._load_json_bytes(raw, label)


def _git(repo: Path, args: Sequence[str]) -> bytes:
    return n3s3._git(repo, args)


def _pin_artifact(repo: Path, commit: str, tree: str, path: str) -> dict[str, Any]:
    return n3s3._pin_artifact(repo, commit, tree, path)


def _expected_baseline() -> dict[str, Any]:
    return {
        "artifacts": [
            {"name": name, "path": path, "rawSha256": raw_sha}
            for name, path, raw_sha in BASELINE_ARTIFACTS
        ],
        "producerCommit": BASELINE_COMMIT,
        "producerParent": BASELINE_PARENT,
        "producerTree": BASELINE_TREE,
        "recordId": BASELINE_RECORD_ID,
        "rowSha256": BASELINE_ROW_SHA256,
    }


def _expected_origin_spec() -> dict[str, Any]:
    return {
        "custodyArtifacts": [
            {"path": S1T_FREEZE_PATH, "rawSha256": S1T_FREEZE_SHA256},
            {"path": S1T_RUN_PATH, "rawSha256": S1T_RUN_SHA256},
            {"path": S1T_TRIAL_PATH, "rawSha256": S1T_TRIAL_SHA256},
        ],
        "normalizedVerdict": "UNMEASURED",
        "originId": "S-1T",
        "producerCommit": S1T_COMMIT,
        "producerTree": S1T_TREE,
        "protocolPath": S1T_PROTOCOL_PATH,
        "protocolRawSha256": S1T_PROTOCOL_SHA256,
        "recordId": S1T_RECORD_ID,
        "resultPath": S1T_RESULT_PATH,
        "resultRawSha256": S1T_RESULT_SHA256,
        "rowSha256": S1T_ROW_SHA256,
        "sourceVerdict": "UNMEASURED_RUN_CONSUMED_NO_RERUN",
    }


def _expected_spec() -> dict[str, Any]:
    return {
        "baseline": _expected_baseline(),
        "canonicalOrigin": {"commit": CANONICAL_COMMIT, "tree": CANONICAL_TREE},
        "effects": copy.deepcopy(NO_EFFECTS),
        "economicEvidenceThrough": {
            "recordId": S1T_RECORD_ID,
            "rowSha256": S1T_ROW_SHA256,
        },
        "incrementalOrigin": _expected_origin_spec(),
        "ledgerRows": [
            {
                "attemptDisposition": "SUPPORTING_TERMINAL_STATE_NO_ADDITIONAL_P",
                "classification": "SUPPORTING_STATE_ONLY_TERMINAL_EVIDENCE",
                "economicOriginConsumed": False,
                "recordId": LIQ_TERMINAL_RECORD_ID,
                "rowSha256": LIQ_TERMINAL_ROW_SHA256,
            },
            {
                "attemptDisposition": "SUPPORTING_TERMINAL_STATE_NO_ADDITIONAL_P",
                "classification": "SUPPORTING_STATE_ONLY_TERMINAL_EVIDENCE",
                "economicOriginConsumed": False,
                "recordId": BORROW_TERMINAL_RECORD_ID,
                "rowSha256": BORROW_TERMINAL_ROW_SHA256,
            },
            {
                "attemptDisposition": "RETAINED_SOURCE_BINDING_DURABILITY",
                "classification": "ACCEPTED_SOURCE_ONLY",
                "economicOriginConsumed": False,
                "recordId": DQ1_RECORD_ID,
                "rowSha256": DQ1_ROW_SHA256,
            },
            {
                "attemptDisposition": "ACCEPTED_ORIGIN_P_ONE",
                "classification": "ACCEPTED_ECONOMIC_ORIGIN",
                "economicOriginConsumed": True,
                "recordId": S1T_RECORD_ID,
                "rowSha256": S1T_ROW_SHA256,
            },
            {
                "attemptDisposition": "ACCEPTED_STATE_ONLY_P_ONE",
                "classification": "ACCEPTED_PRE_WORKTREE_STATE_STOP",
                "economicOriginConsumed": False,
                "recordId": LIQ_RECORD_ID,
                "rowSha256": LIQ_ROW_SHA256,
            },
            {
                "attemptDisposition": "ACCEPTED_STATE_ONLY_P_ONE",
                "classification": "ACCEPTED_PRE_WORKTREE_STATE_STOP",
                "economicOriginConsumed": False,
                "recordId": BORROW_RECORD_ID,
                "rowSha256": BORROW_ROW_SHA256,
            },
        ],
        "pendingInputs": {
            "activeOutsideBaselineCutoff": [],
            "activeWithinBaselineCutoff": [],
            "requiredTruth": list(REQUIRED_TRUTH_CODES),
            "terminalPending": [],
        },
        "priorAcceptedBoundary": {
            "recordId": BASELINE_RECORD_ID,
            "rowSha256": BASELINE_ROW_SHA256,
        },
        "retainedSourceBinding": {
            "bindingId": "DQ-1",
            "bindingRecordId": DQ1_BINDING_RECORD_ID,
            "bindingRowSha256": DQ1_BINDING_ROW_SHA256,
            "consumerScope": "N3_S4_AND_FUTURE_RESEARCH_INTAKE",
            "durabilityRecordId": DQ1_RECORD_ID,
            "durabilityRowSha256": DQ1_ROW_SHA256,
            "path": DQ1_PATH,
            "producerCommit": DQ1_COMMIT,
            "producerTree": DQ1_TREE,
            "rawSha256": DQ1_RAW_SHA256,
        },
        "schema": SPEC_SCHEMA,
        "selectedAcceptedBoundary": {
            "recordId": BORROW_RECORD_ID,
            "rowSha256": BORROW_ROW_SHA256,
        },
        "stateOnlyStops": [
            {
                "limitations": list(LIQ_LIMITATIONS),
                "milestoneId": "LIQ-CUSTODY1",
                "recordId": LIQ_RECORD_ID,
                "rowSha256": LIQ_ROW_SHA256,
                "taskRefSuffix": "deaa",
                "terminalRecordId": LIQ_TERMINAL_RECORD_ID,
                "terminalRowSha256": LIQ_TERMINAL_ROW_SHA256,
            },
            {
                "limitations": list(BORROW_LIMITATIONS),
                "milestoneId": "BORROW-CUSTODY1",
                "recordId": BORROW_RECORD_ID,
                "rowSha256": BORROW_ROW_SHA256,
                "taskRefSuffix": "ac11",
                "terminalRecordId": BORROW_TERMINAL_RECORD_ID,
                "terminalRowSha256": BORROW_TERMINAL_ROW_SHA256,
            },
        ],
        "version": VERSION,
    }


def _validate_spec(spec: dict[str, Any]) -> None:
    expected = _expected_spec()
    _require(
        _canonical_bytes(spec) == _canonical_bytes(expected),
        "origin spec differs from the frozen N3-S4 contract",
    )


def _extract_selected_rows(
    run_raw: bytes,
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    record_ids = (*SELECTED_RECORD_IDS, BASELINE_RECORD_ID)
    extracted, positions = n3s3._extract_rows(run_raw, record_ids)
    for record_id, expected_hash in {
        **ROW_SHA256,
        BASELINE_RECORD_ID: BASELINE_ROW_SHA256,
    }.items():
        _require(
            extracted[record_id]["rowSha256"] == expected_hash,
            f"{record_id}: accepted row bytes drift",
        )
    _require(
        all(
            positions[record_id] < positions[BASELINE_RECORD_ID]
            for record_id in SELECTED_RECORD_IDS
        ),
        "selected post-N3-S3 row is not newer than the accepted baseline",
    )
    selected_positions = [positions[record_id] for record_id in SELECTED_RECORD_IDS]
    _require(
        all(
            selected_positions[index] > selected_positions[index + 1]
            for index in range(len(selected_positions) - 1)
        ),
        "selected accepted-row chronology drift",
    )
    return extracted, positions


def _baseline_registry(run_raw: bytes, repo: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    commit = _git(repo, ["rev-parse", f"{BASELINE_COMMIT}^{{commit}}"]).decode().strip()
    tree = _git(repo, ["rev-parse", f"{BASELINE_COMMIT}^{{tree}}"]).decode().strip()
    parent = _git(repo, ["rev-parse", f"{BASELINE_COMMIT}^"]).decode().strip()
    _require(commit == BASELINE_COMMIT, "baseline commit drift")
    _require(tree == BASELINE_TREE, "baseline tree drift")
    _require(parent == BASELINE_PARENT, "baseline parent drift")

    artifact_pins: list[dict[str, Any]] = []
    for name, path, expected_sha in BASELINE_ARTIFACTS:
        pin = _pin_artifact(repo, BASELINE_COMMIT, BASELINE_TREE, path)
        _require(pin["rawSha256"] == expected_sha, f"baseline {name} bytes drift")
        artifact_pins.append({"name": name, **pin})

    spec_path = next(path for name, path, _ in BASELINE_ARTIFACTS if name == "originSpec")
    registry_path = next(path for name, path, _ in BASELINE_ARTIFACTS if name == "registry")
    baseline_spec_raw = _git(repo, ["show", f"{BASELINE_COMMIT}:{spec_path}"])
    baseline_spec = _load_json_bytes(baseline_spec_raw, "accepted N3-S3 origin spec")
    regenerated = n3s3.freeze_registry(baseline_spec, run_raw, repo)
    accepted_raw = _git(repo, ["show", f"{BASELINE_COMMIT}:{registry_path}"])
    accepted = _load_json_bytes(accepted_raw, "accepted N3-S3 registry")
    _require(accepted_raw == _canonical_bytes(accepted), "accepted N3-S3 registry not canonical")
    _require(
        _sha256(accepted_raw)
        == next(raw for name, _, raw in BASELINE_ARTIFACTS if name == "registry"),
        "accepted N3-S3 registry raw hash drift",
    )
    _require(
        _canonical_bytes(regenerated) == accepted_raw,
        "transitive N3-S3 verifier does not reproduce accepted bytes",
    )
    n3s3.validate_registry(accepted)
    return accepted, artifact_pins


def _load_pinned_json(
    repo: Path, path: str, expected_sha: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    pin = _pin_artifact(repo, S1T_COMMIT, S1T_TREE, path)
    _require(pin["rawSha256"] == expected_sha, f"{path}: bytes drift")
    raw = _git(repo, ["show", f"{S1T_COMMIT}:{path}"])
    _require(_sha256(raw) == expected_sha, f"{path}: show bytes drift")
    return _load_json_bytes(raw, path), pin


def _build_s1t_origin(repo: Path) -> dict[str, Any]:
    result, result_pin = _load_pinned_json(repo, S1T_RESULT_PATH, S1T_RESULT_SHA256)
    protocol, protocol_pin = _load_pinned_json(repo, S1T_PROTOCOL_PATH, S1T_PROTOCOL_SHA256)
    freeze, freeze_pin = _load_pinned_json(repo, S1T_FREEZE_PATH, S1T_FREEZE_SHA256)
    run, run_pin = _load_pinned_json(repo, S1T_RUN_PATH, S1T_RUN_SHA256)
    trial, trial_pin = _load_pinned_json(repo, S1T_TRIAL_PATH, S1T_TRIAL_SHA256)

    _require(result["schema"] == "cosmos.quant.research.s1t.result.v1", "S-1T result schema")
    _require(result["strategy_id"] == "S-1T", "S-1T strategy ID")
    _require(result["verdict"] == "UNMEASURED_RUN_CONSUMED_NO_RERUN", "S-1T verdict")
    _require(result["outcome_state"] == "TERMINAL_UNMEASURED", "S-1T outcome state")
    _require(
        result["failure_binding"]["error_code"] == "FUNDING_SURVEILLANCE_GAP_INVALID",
        "S-1T failure binding",
    )
    _require(result["holdout_state"] == "UNOPENED", "S-1T holdout")
    _require(result["account_effective_fees"] == "UNKNOWN", "S-1T fee truth")
    _require(result["executable_capacity"] == "UNKNOWN", "S-1T capacity truth")
    _require(result["capital_authority"] == "NO_GO", "S-1T capital truth")
    _require(result["execution_authority"] == "NONE", "S-1T authority")
    _require(result["positive_edge_claim"] is False, "S-1T positive claim")
    _require(result["causal_policy_effect_claim"] is False, "S-1T causal claim")
    _require(result["lag_safe_claim"] is False, "S-1T lag-safe claim")
    for field in (
        "activity_counters",
        "bootstrap_intervals",
        "holm_p_values",
        "pbo",
        "price_funding_fee_and_adverse_attribution",
        "public_capacity_proxy",
        "remove_best_symbol_and_month_stress_net",
        "reported_trial_id",
        "severe_hourly_marked_equity_max_drawdown",
        "white_reality_check_p_by_scenario",
    ):
        _require(result[field] is None, f"S-1T {field} must remain null")
    _require(
        all(value is None for value in result["net_usd_per_1000_by_scenario"].values()),
        "S-1T net scenarios must remain null",
    )
    custody = result["development_and_holdout_custody"]
    _require(custody["one_run"] is True, "S-1T one-run custody")
    _require(custody["repair_or_rerun"] is False, "S-1T rerun custody")
    _require(custody["holdout"]["state"] == "UNOPENED", "S-1T holdout custody")
    _require(custody["holdout"]["archive_member_open_count"] == 0, "S-1T holdout archive opens")
    _require(custody["holdout"]["open_count"] == 0, "S-1T holdout opens")
    _require(custody["holdout"]["outcome_rows_opened_before_gates"] == 0, "S-1T holdout rows")
    _require(result["effects"]["money_moved_usd"] == 0, "S-1T money")
    _require(
        not any(value for key, value in result["effects"].items() if key != "money_moved_usd"),
        "S-1T effects",
    )
    _require(result["protocol_raw_sha256"] == S1T_PROTOCOL_SHA256, "S-1T protocol binding")
    _require(result["static_producer_commit"] == S1T_STATIC_COMMIT, "S-1T static commit")
    _require(result["static_producer_tree"] == S1T_STATIC_TREE, "S-1T static tree")
    _require(result["n3_handoff"]["family_key"] == S1T_FAMILY_KEY, "S-1T family key")
    _require(result["n3_handoff"]["frozen_n3_v1_mutation"] is False, "S-1T N3 mutation")
    _require(
        result["n3_handoff"]["producer_commit"] == S1T_STATIC_COMMIT,
        "S-1T embedded handoff producer",
    )
    _require(
        result["n3_handoff"]["producer_tree"] == S1T_STATIC_TREE,
        "S-1T embedded handoff tree",
    )
    _require(
        result["n3_handoff"]["protocol_path_and_blob"]
        == {
            "git_blob_object_id": S1T_PROTOCOL_BLOB,
            "repository_relative_path": S1T_PROTOCOL_PATH,
        },
        "S-1T embedded protocol binding",
    )
    _require(
        result["n3_handoff"]["result_path_and_blob"] == "DEFERRED_TO_FINAL_RESULT_COMMIT",
        "S-1T embedded pre-acceptance placeholder truth",
    )
    _require(
        _sha256(_canonical_bytes(result["limitations"])) == S1T_LIMITATIONS_SHA256,
        "S-1T limitations drift",
    )
    _require(
        protocol["protocol_id"] == "s1t-binance-usdm-funding-interval-transition-v1",
        "S-1T protocol ID",
    )
    _require(freeze["allowed_run_count"] == 1, "S-1T frozen run count")
    _require(freeze["holdout_archive_member_open_count"] == 0, "S-1T frozen holdout opens")
    _require(run["allowed_run_count"] == 1 and run["run_ordinal"] == 1, "S-1T run ordinal")
    _require(run["marker_created_before_any_development_member"] is True, "S-1T run marker")
    _require(run["holdout_archive_member_open_count_before"] == 0, "S-1T pre-run holdout")
    _require(trial["family_size"] == 12 and len(trial["trials"]) == 12, "S-1T trial family")

    return {
        "acceptanceRowSha256": S1T_ROW_SHA256,
        "artifact": result_pin,
        "custodyArtifacts": [
            {"name": "freeze", **freeze_pin},
            {"name": "runConsumed", **run_pin},
            {"name": "trialLedger", **trial_pin},
        ],
        "custodyState": "ACCEPTED_EXACT_RUN_CONSUMED",
        "familyIdentity": {
            "key": S1T_FAMILY_KEY,
            "protocolArtifact": protocol_pin,
            "state": "PROVISIONAL_POST_SMETA1",
        },
        "limitations": list(result["limitations"]),
        "normalizedVerdict": "UNMEASURED",
        "ordinal": EXPECTED_ORIGIN_COUNT,
        "originId": "S-1T",
        "producerCommit": S1T_COMMIT,
        "producerTree": S1T_TREE,
        "recordId": S1T_RECORD_ID,
        "sourceSemantics": {
            "accountEffectiveFees": "UNKNOWN",
            "capitalAuthority": "NO_GO",
            "causalPolicyEffectClaim": False,
            "executableCapacity": "UNKNOWN",
            "executionAuthority": "NONE",
            "failureCode": "FUNDING_SURVEILLANCE_GAP_INVALID",
            "holdoutState": "UNOPENED",
            "holmPValues": None,
            "netUsdPer1000ByScenario": {"base": None, "severe": None, "stress": None},
            "pbo": None,
            "reportedTrialId": None,
            "trialCount": 12,
            "whiteRealityCheckPByScenario": None,
        },
        "sourceVerdict": "UNMEASURED_RUN_CONSUMED_NO_RERUN",
        "verifiedPositive": False,
    }


def _state_only_stops(spec: Mapping[str, Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for item_any in _exact_list(spec["stateOnlyStops"], "spec.stateOnlyStops"):
        item = _exact_dict(item_any, "state-only stop")
        output.append(
            {
                "attemptContribution": "ACCEPTED_STATE_ONLY_P_ONE",
                "authority": "NONE",
                "capitalVerdict": "NO_GO",
                "conservativeAttemptP": {"denominator": 1, "numerator": 1},
                "economicOriginContribution": "NONE",
                "familyContribution": "NONE",
                "holdoutState": "NOT_CREATED",
                "limitations": list(item["limitations"]),
                "milestoneId": item["milestoneId"],
                "normalizedState": "UNMEASURED",
                "productBytesCreated": False,
                "recordId": item["recordId"],
                "rowSha256": item["rowSha256"],
                "taskRefIsEvidence": False,
                "taskRefSuffix": item["taskRefSuffix"],
                "terminalRecordId": item["terminalRecordId"],
                "terminalRowSha256": item["terminalRowSha256"],
                "trialContribution": "NONE",
            }
        )
    return output


def _pending_output() -> dict[str, Any]:
    return {
        "activeOutsideBaselineCutoff": [],
        "activeWithinBaselineCutoff": [],
        "requiredTruth": [{"code": code, "state": "PENDING"} for code in REQUIRED_TRUTH_CODES],
        "terminalPending": [],
    }


def freeze_registry(spec: dict[str, Any], run_raw: bytes, repo: Path) -> dict[str, Any]:
    _validate_spec(spec)
    extracted, _ = _extract_selected_rows(run_raw)
    baseline, baseline_pins = _baseline_registry(run_raw, repo)

    _require(
        _sha256(_canonical_bytes(baseline["origins"])) == BASELINE_ORIGINS_SHA256,
        "baseline origin set drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline["families"])) == BASELINE_FAMILIES_SHA256,
        "baseline family set drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline["ledgerReceipts"])) == BASELINE_LEDGER_SHA256,
        "baseline ledger set drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline["sourceOnlyPins"])) == BASELINE_SOURCE_PINS_SHA256,
        "baseline source pin set drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline["pendingInputs"])) == BASELINE_PENDING_SHA256,
        "baseline pending state drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline["legacyAcceptedExcluded"])) == BASELINE_LEGACY_SHA256,
        "baseline legacy exclusions drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline["truthPolicy"])) == BASELINE_TRUTH_SHA256,
        "baseline truth policy drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline["summary"])) == BASELINE_SUMMARY_SHA256,
        "baseline summary drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline["deltaWindow"])) == BASELINE_DELTA_SHA256,
        "baseline delta drift",
    )

    retained = copy.deepcopy(baseline["sourceOnlyPins"])
    dq1_matches = [item for item in retained if item["bindingId"] == "DQ-1"]
    _require(len(dq1_matches) == 1, "DQ-1 retained source binding count")
    dq1_pin = dq1_matches[0]
    _require(dq1_pin["recordId"] == DQ1_BINDING_RECORD_ID, "DQ-1 original receipt")
    _require(dq1_pin["acceptanceRowSha256"] == DQ1_BINDING_ROW_SHA256, "DQ-1 original row")
    _require(dq1_pin["artifact"]["producerCommit"] == DQ1_COMMIT, "DQ-1 commit")
    _require(dq1_pin["artifact"]["producerTree"] == DQ1_TREE, "DQ-1 tree")
    _require(dq1_pin["artifact"]["path"] == DQ1_PATH, "DQ-1 path")
    _require(dq1_pin["artifact"]["rawSha256"] == DQ1_RAW_SHA256, "DQ-1 bytes")
    _require(
        _pin_artifact(repo, DQ1_COMMIT, DQ1_TREE, DQ1_PATH) == dq1_pin["artifact"],
        "DQ-1 live Git pin drift",
    )

    s1t = _build_s1t_origin(repo)
    origins = [*copy.deepcopy(baseline["origins"]), s1t]
    families = n3s1._build_family_rollups(origins)
    _require(len(origins) == EXPECTED_ORIGIN_COUNT, "accepted origin count")
    _require(len(families) == EXPECTED_FAMILY_COUNT, "accepted family count")

    ledger_receipts: list[dict[str, Any]] = []
    ledger_specs = _exact_list(spec["ledgerRows"], "spec.ledgerRows")
    for row_any in ledger_specs:
        row = _exact_dict(row_any, "ledger row")
        record_id = _exact_str(row["recordId"], "ledger record")
        receipt = copy.deepcopy(extracted[record_id])
        receipt.update(
            {
                "attemptDisposition": row["attemptDisposition"],
                "classification": row["classification"],
                "economicOriginConsumed": row["economicOriginConsumed"],
            }
        )
        ledger_receipts.append(receipt)

    stops = _state_only_stops(spec)
    local_verdicts = {
        verdict: sum(origin["normalizedVerdict"] == verdict for origin in origins)
        for verdict in ("NO_GO", "UNMEASURED")
    }
    _require(local_verdicts == EXPECTED_LOCAL_VERDICTS, "local verdict count drift")

    registry: dict[str, Any] = {
        "baseline": {
            "acceptanceRowSha256": BASELINE_ROW_SHA256,
            "artifacts": baseline_pins,
            "producerCommit": BASELINE_COMMIT,
            "producerParent": BASELINE_PARENT,
            "producerTree": BASELINE_TREE,
            "recordId": BASELINE_RECORD_ID,
        },
        "baselineStateHashes": {
            "deltaWindow": BASELINE_DELTA_SHA256,
            "families": BASELINE_FAMILIES_SHA256,
            "ledgerReceipts": BASELINE_LEDGER_SHA256,
            "legacyAcceptedExcluded": BASELINE_LEGACY_SHA256,
            "origins": BASELINE_ORIGINS_SHA256,
            "pendingInputs": BASELINE_PENDING_SHA256,
            "sourceOnlyPins": BASELINE_SOURCE_PINS_SHA256,
            "summary": BASELINE_SUMMARY_SHA256,
            "truthPolicy": BASELINE_TRUTH_SHA256,
        },
        "canonicalOrigin": {"commit": CANONICAL_COMMIT, "tree": CANONICAL_TREE},
        "deltaWindow": {
            "acceptedEconomicOriginIds": ["S-1T"],
            "acceptedStateOnlyStopIds": ["LIQ-CUSTODY1", "BORROW-CUSTODY1"],
            "economicEvidenceThrough": {
                "recordId": S1T_RECORD_ID,
                "rowSha256": S1T_ROW_SHA256,
            },
            "priorAcceptedBoundary": {
                "recordId": BASELINE_RECORD_ID,
                "rowSha256": BASELINE_ROW_SHA256,
            },
            "retainedBaselineSourceBindingIds": ["DQ-1"],
            "selectedAcceptedBoundary": {
                "recordId": BORROW_RECORD_ID,
                "rowSha256": BORROW_ROW_SHA256,
            },
            "selectedRecordIds": list(SELECTED_RECORD_IDS),
        },
        "effects": copy.deepcopy(NO_EFFECTS),
        "families": families,
        "ledgerReceipts": ledger_receipts,
        "legacyAcceptedExcluded": copy.deepcopy(baseline["legacyAcceptedExcluded"]),
        "originSpecCanonicalSha256": _sha256(_canonical_bytes(spec)),
        "origins": origins,
        "ownerCardRawSha256": "",
        "pendingInputs": _pending_output(),
        "retainedSourceBindings": [
            {
                "bindingId": "DQ-1",
                "bindingRecordId": DQ1_BINDING_RECORD_ID,
                "bindingRowSha256": DQ1_BINDING_ROW_SHA256,
                "consumerScope": "N3_S4_AND_FUTURE_RESEARCH_INTAKE",
                "durabilityRecordId": DQ1_RECORD_ID,
                "durabilityRowSha256": DQ1_ROW_SHA256,
                "sourcePinOrdinal": next(
                    index + 1 for index, item in enumerate(retained) if item["bindingId"] == "DQ-1"
                ),
            }
        ],
        "schema": SCHEMA,
        "sourceOnlyPins": retained,
        "stateOnlyStops": stops,
        "summary": {
            "acceptedCrediblePositiveCount": 0,
            "acceptedFamilyCount": len(families),
            "acceptedOriginCount": len(origins),
            "acceptedSinceN3S2EconomicConsumedCount": 2,
            "acceptedSinceN3S3EconomicConsumedCount": 1,
            "acceptedStateOnlyStopCount": len(stops),
            "activeProfitabilityTaskCount": 0,
            "capitalAuthority": "NONE",
            "completeFamilyUniverse": False,
            "crediblePositiveCount": None,
            "currentProfitabilityVerdict": "UNKNOWN",
            "familyDeduplicationState": "EXACT_FOR_ACCEPTED_ORIGINS_ONLY",
            "legacyAcceptedExcludedCount": len(baseline["legacyAcceptedExcluded"]),
            "localVerdictCounts": local_verdicts,
            "moneyUsd": 0,
            "owner1000FundingVerdict": "NO",
            "positiveEdgeClaim": "NOT_MADE",
            "postVG31AcceptedEconomicConsumedCount": 14,
            "recommendation": "NONE",
            "requiredTruthCount": len(REQUIRED_TRUTH_CODES),
            "retainedBaselineSourceBindingCount": 1,
            "selectedReceiptCount": len(ledger_receipts),
            "sourceOnlyBindingCount": len(retained),
            "stateOnlyPOneCount": len(stops),
            "terminalPendingCount": 0,
            "verifiedPositiveCount": 0,
        },
        "truthPolicy": copy.deepcopy(baseline["truthPolicy"]),
        "version": VERSION,
    }
    card = render_owner_card(registry)
    registry["ownerCardRawSha256"] = _sha256(card.encode("utf-8"))
    validate_registry(registry)
    return registry


def render_owner_card(registry: Mapping[str, Any]) -> str:
    summary = _exact_dict(registry["summary"], "registry.summary")
    delta = _exact_dict(registry["deltaWindow"], "registry.deltaWindow")
    economic = _exact_dict(delta["economicEvidenceThrough"], "economic boundary")
    selected = _exact_dict(delta["selectedAcceptedBoundary"], "selected boundary")
    found = (
        f"origins={summary['acceptedOriginCount']}/{summary['acceptedOriginCount']}; "
        f"acceptedFamilies={summary['acceptedFamilyCount']}; "
        f"localNO_GO={summary['localVerdictCounts']['NO_GO']}; "
        f"localUNMEASURED={summary['localVerdictCounts']['UNMEASURED']}; "
        "accepted/verifiedPositives=0/0; crediblePositiveCount=null; "
        f"postV-G31AcceptedConsumed={summary['postVG31AcceptedEconomicConsumedCount']}; "
        f"sinceN3-S3AcceptedConsumed={summary['acceptedSinceN3S3EconomicConsumedCount']}; "
        f"acceptedSourceOnly={summary['sourceOnlyBindingCount']}; "
        f"retainedSource={summary['retainedBaselineSourceBindingCount']}; "
        f"stateOnlyStops={summary['acceptedStateOnlyStopCount']}; "
        f"stateOnlyP1={summary['stateOnlyPOneCount']}; "
        f"selectedReceipts={summary['selectedReceiptCount']}; active=; terminalPending=; "
        f"pendingTruth={summary['requiredTruthCount']}; "
        f"economicThrough=S-1T-row …{economic['rowSha256'][-4:]}; "
        f"selectedAsOf=BORROW-row …{selected['rowSha256'][-4:]}; "
        "globalProfitability=UNKNOWN; owner$1k=NO; positiveEdgeClaim=NOT_MADE; "
        "recommendation=NONE; authority=NONE; effects=NONE/$0"
    )
    card = (
        "- item=`N3-S4 FINAL PROFITABILITY STATE`"
        f" | expected=`accepted N3-S3 …{BASELINE_COMMIT[-4:]}/row "
        f"…{BASELINE_ROW_SHA256[-4:]} + S-1T terminal UNMEASURED, retained DQ-1, "
        "and LIQ/BORROW state-only stops`"
        f" | found=`{found}`"
        " | status=`N3_S4_DURABLE_SOURCE_READY; FINAL_ACCEPTED_BOUNDARY_STATE; "
        "GLOBAL PROFITABILITY UNKNOWN; OWNER $1K NO; AUTHORITY NONE; NOT_LANDED; STOP`\n"
    )
    _require(card.count("\n") == 1 and card.endswith("\n"), "card must be one LF row")
    _require(FULL_IDENTIFIER.search(card) is None, "card leaked a full identifier")
    _require(
        not any(token in card for token in ("/Users/", "Desktop/", "quant/", "research/")),
        "card leaked a path",
    )
    _require(len(card.encode("utf-8")) <= 1600, "card exceeds bounded length")
    return card


def _validate_pin(pin_any: Any, label: str) -> None:
    n3s3._validate_artifact_pin(pin_any, label)


def validate_registry(registry_any: Any) -> None:
    registry = _exact_dict(registry_any, "registry")
    expected_keys = {
        "baseline",
        "baselineStateHashes",
        "canonicalOrigin",
        "deltaWindow",
        "effects",
        "families",
        "ledgerReceipts",
        "legacyAcceptedExcluded",
        "originSpecCanonicalSha256",
        "origins",
        "ownerCardRawSha256",
        "pendingInputs",
        "retainedSourceBindings",
        "schema",
        "sourceOnlyPins",
        "stateOnlyStops",
        "summary",
        "truthPolicy",
        "version",
    }
    _require(set(registry) == expected_keys, "registry top-level keys")
    _require(registry["schema"] == SCHEMA and registry["version"] == VERSION, "registry identity")
    _require(
        registry["canonicalOrigin"] == {"commit": CANONICAL_COMMIT, "tree": CANONICAL_TREE},
        "canonical origin",
    )
    _require(
        _canonical_bytes(registry["effects"]) == _canonical_bytes(NO_EFFECTS),
        "effect injection",
    )

    baseline = _exact_dict(registry["baseline"], "registry.baseline")
    _require(
        set(baseline)
        == {
            "acceptanceRowSha256",
            "artifacts",
            "producerCommit",
            "producerParent",
            "producerTree",
            "recordId",
        },
        "baseline keys",
    )
    _require(
        {
            key: baseline[key]
            for key in ("producerCommit", "producerParent", "producerTree", "recordId")
        }
        == {
            "producerCommit": BASELINE_COMMIT,
            "producerParent": BASELINE_PARENT,
            "producerTree": BASELINE_TREE,
            "recordId": BASELINE_RECORD_ID,
        },
        "baseline identity",
    )
    _require(baseline["acceptanceRowSha256"] == BASELINE_ROW_SHA256, "baseline row")
    artifacts = _exact_list(baseline["artifacts"], "baseline artifacts")
    _require(len(artifacts) == len(BASELINE_ARTIFACTS), "baseline artifact count")
    for item_any, (name, path, raw_sha) in zip(  # noqa: B905 - Python 3.9
        artifacts, BASELINE_ARTIFACTS
    ):
        item = _exact_dict(item_any, f"baseline {name}")
        _require(item["name"] == name, f"baseline {name} name")
        _validate_pin(
            {key: value for key, value in item.items() if key != "name"}, f"baseline {name}"
        )
        _require(item["path"] == path and item["rawSha256"] == raw_sha, f"baseline {name} pin")
        _require(item["producerCommit"] == BASELINE_COMMIT, f"baseline {name} commit")
        _require(item["producerTree"] == BASELINE_TREE, f"baseline {name} tree")

    expected_state_hashes = {
        "deltaWindow": BASELINE_DELTA_SHA256,
        "families": BASELINE_FAMILIES_SHA256,
        "ledgerReceipts": BASELINE_LEDGER_SHA256,
        "legacyAcceptedExcluded": BASELINE_LEGACY_SHA256,
        "origins": BASELINE_ORIGINS_SHA256,
        "pendingInputs": BASELINE_PENDING_SHA256,
        "sourceOnlyPins": BASELINE_SOURCE_PINS_SHA256,
        "summary": BASELINE_SUMMARY_SHA256,
        "truthPolicy": BASELINE_TRUTH_SHA256,
    }
    _require(registry["baselineStateHashes"] == expected_state_hashes, "baseline state hashes")

    origins = _exact_list(registry["origins"], "registry.origins")
    _require(len(origins) == EXPECTED_ORIGIN_COUNT, "origin count")
    _require(
        _sha256(_canonical_bytes(origins[:-1])) == BASELINE_ORIGINS_SHA256,
        "baseline origin prefix drift",
    )
    origin = _exact_dict(origins[-1], "S-1T origin")
    _require(
        set(origin)
        == {
            "acceptanceRowSha256",
            "artifact",
            "custodyArtifacts",
            "custodyState",
            "familyIdentity",
            "limitations",
            "normalizedVerdict",
            "ordinal",
            "originId",
            "producerCommit",
            "producerTree",
            "recordId",
            "sourceSemantics",
            "sourceVerdict",
            "verifiedPositive",
        },
        "S-1T origin keys",
    )
    _require(origin["originId"] == "S-1T" and origin["ordinal"] == 50, "S-1T identity")
    _require(
        origin["producerCommit"] == S1T_COMMIT and origin["producerTree"] == S1T_TREE,
        "S-1T producer",
    )
    _require(origin["recordId"] == S1T_RECORD_ID, "S-1T record")
    _require(origin["acceptanceRowSha256"] == S1T_ROW_SHA256, "S-1T row")
    _require(origin["normalizedVerdict"] == "UNMEASURED", "S-1T normalized verdict")
    _require(origin["sourceVerdict"] == "UNMEASURED_RUN_CONSUMED_NO_RERUN", "S-1T source verdict")
    _require(origin["custodyState"] == "ACCEPTED_EXACT_RUN_CONSUMED", "S-1T custody state")
    _require(origin["verifiedPositive"] is False, "S-1T positive inflation")
    _require(
        _sha256(_canonical_bytes(origin["limitations"])) == S1T_LIMITATIONS_SHA256,
        "S-1T limitations",
    )
    result_pin = _exact_dict(origin["artifact"], "S-1T result pin")
    _validate_pin(result_pin, "S-1T result")
    _require(result_pin["path"] == S1T_RESULT_PATH, "S-1T result path")
    _require(result_pin["rawSha256"] == S1T_RESULT_SHA256, "S-1T result bytes")
    _require(result_pin["producerCommit"] == S1T_COMMIT, "S-1T result commit")
    _require(result_pin["producerTree"] == S1T_TREE, "S-1T result tree")
    custody_artifacts = _exact_list(origin["custodyArtifacts"], "S-1T custody artifacts")
    _require(len(custody_artifacts) == 3, "S-1T custody artifact count")
    for item_any, name, path, raw_sha in zip(  # noqa: B905 - Python 3.9
        custody_artifacts,
        ("freeze", "runConsumed", "trialLedger"),
        (S1T_FREEZE_PATH, S1T_RUN_PATH, S1T_TRIAL_PATH),
        (S1T_FREEZE_SHA256, S1T_RUN_SHA256, S1T_TRIAL_SHA256),
    ):
        item = _exact_dict(item_any, f"S-1T {name}")
        _require(
            set(item)
            == {
                "byteLength",
                "gitBlob",
                "mode",
                "name",
                "path",
                "producerCommit",
                "producerTree",
                "rawSha256",
            },
            f"S-1T {name} keys",
        )
        _require(item["name"] == name, f"S-1T {name} name")
        pin = {key: value for key, value in item.items() if key != "name"}
        _validate_pin(pin, f"S-1T {name}")
        _require(item["path"] == path and item["rawSha256"] == raw_sha, f"S-1T {name} pin")
        _require(item["producerCommit"] == S1T_COMMIT, f"S-1T {name} commit")
        _require(item["producerTree"] == S1T_TREE, f"S-1T {name} tree")
    family_identity = _exact_dict(origin["familyIdentity"], "S-1T family identity")
    _require(
        set(family_identity) == {"key", "protocolArtifact", "state"},
        "S-1T family identity keys",
    )
    _require(
        family_identity["key"] == S1T_FAMILY_KEY
        and family_identity["state"] == "PROVISIONAL_POST_SMETA1",
        "S-1T family identity",
    )
    protocol_pin = _exact_dict(family_identity["protocolArtifact"], "S-1T protocol")
    _validate_pin(protocol_pin, "S-1T protocol")
    _require(protocol_pin["path"] == S1T_PROTOCOL_PATH, "S-1T protocol path")
    _require(protocol_pin["rawSha256"] == S1T_PROTOCOL_SHA256, "S-1T protocol bytes")
    _require(protocol_pin["producerCommit"] == S1T_COMMIT, "S-1T protocol commit")
    _require(protocol_pin["producerTree"] == S1T_TREE, "S-1T protocol tree")
    semantics = _exact_dict(origin["sourceSemantics"], "S-1T source semantics")
    expected_semantics = {
        "accountEffectiveFees": "UNKNOWN",
        "capitalAuthority": "NO_GO",
        "causalPolicyEffectClaim": False,
        "executableCapacity": "UNKNOWN",
        "executionAuthority": "NONE",
        "failureCode": "FUNDING_SURVEILLANCE_GAP_INVALID",
        "holdoutState": "UNOPENED",
        "holmPValues": None,
        "netUsdPer1000ByScenario": {"base": None, "severe": None, "stress": None},
        "pbo": None,
        "reportedTrialId": None,
        "trialCount": 12,
        "whiteRealityCheckPByScenario": None,
    }
    _require(
        _canonical_bytes(semantics) == _canonical_bytes(expected_semantics),
        "S-1T null/unknown semantics",
    )

    families = _exact_list(registry["families"], "registry.families")
    _require(len(families) == EXPECTED_FAMILY_COUNT, "family count")
    _require(
        _sha256(_canonical_bytes(families[:-1])) == BASELINE_FAMILIES_SHA256,
        "baseline family prefix drift",
    )
    _require(families == n3s1._build_family_rollups(origins), "family rollup drift")
    s1t_family = _exact_dict(families[-1], "S-1T family")
    _require(s1t_family["originIds"] == ["S-1T"], "S-1T family membership")
    _require(
        s1t_family["effectiveProgramWideP"] == {"denominator": 1, "numerator": 1},
        "S-1T effective p must be one",
    )
    _require(s1t_family["verifiedPositive"] is False, "S-1T family positive")

    source_pins = _exact_list(registry["sourceOnlyPins"], "source pins")
    _require(len(source_pins) == EXPECTED_SOURCE_PIN_COUNT, "source pin count")
    _require(
        _sha256(_canonical_bytes(source_pins)) == BASELINE_SOURCE_PINS_SHA256,
        "source pins changed or DQ-1 duplicated",
    )
    retained = _exact_list(registry["retainedSourceBindings"], "retained sources")
    _require(
        retained
        == [
            {
                "bindingId": "DQ-1",
                "bindingRecordId": DQ1_BINDING_RECORD_ID,
                "bindingRowSha256": DQ1_BINDING_ROW_SHA256,
                "consumerScope": "N3_S4_AND_FUTURE_RESEARCH_INTAKE",
                "durabilityRecordId": DQ1_RECORD_ID,
                "durabilityRowSha256": DQ1_ROW_SHA256,
                "sourcePinOrdinal": 1,
            }
        ],
        "retained DQ-1 binding drift",
    )

    stops = _exact_list(registry["stateOnlyStops"], "state-only stops")
    _require(len(stops) == 2, "state-only stop count")
    for (
        item,
        milestone,
        suffix,
        record_id,
        row_hash,
        terminal_record_id,
        terminal_row_hash,
        limitations,
    ) in zip(  # noqa: B905 - Python 3.9
        stops,
        ("LIQ-CUSTODY1", "BORROW-CUSTODY1"),
        ("deaa", "ac11"),
        (LIQ_RECORD_ID, BORROW_RECORD_ID),
        (LIQ_ROW_SHA256, BORROW_ROW_SHA256),
        (LIQ_TERMINAL_RECORD_ID, BORROW_TERMINAL_RECORD_ID),
        (LIQ_TERMINAL_ROW_SHA256, BORROW_TERMINAL_ROW_SHA256),
        (LIQ_LIMITATIONS, BORROW_LIMITATIONS),
    ):
        stop = _exact_dict(item, milestone)
        _require(
            set(stop)
            == {
                "attemptContribution",
                "authority",
                "capitalVerdict",
                "conservativeAttemptP",
                "economicOriginContribution",
                "familyContribution",
                "holdoutState",
                "limitations",
                "milestoneId",
                "normalizedState",
                "productBytesCreated",
                "recordId",
                "rowSha256",
                "taskRefIsEvidence",
                "taskRefSuffix",
                "terminalRecordId",
                "terminalRowSha256",
                "trialContribution",
            },
            f"{milestone} keys",
        )
        _require(
            stop["milestoneId"] == milestone and stop["taskRefSuffix"] == suffix,
            f"{milestone} identity",
        )
        _require(
            stop["recordId"] == record_id and stop["rowSha256"] == row_hash, f"{milestone} receipt"
        )
        _require(
            stop["terminalRecordId"] == terminal_record_id
            and stop["terminalRowSha256"] == terminal_row_hash,
            f"{milestone} terminal evidence",
        )
        _require(stop["taskRefIsEvidence"] is False, f"{milestone} suffix promotion")
        _require(stop["productBytesCreated"] is False, f"{milestone} product bytes")
        _require(stop["normalizedState"] == "UNMEASURED", f"{milestone} state")
        _require(stop["attemptContribution"] == "ACCEPTED_STATE_ONLY_P_ONE", f"{milestone} attempt")
        _require(stop["capitalVerdict"] == "NO_GO", f"{milestone} capital")
        _require(stop["authority"] == "NONE", f"{milestone} authority")
        _require(stop["holdoutState"] == "NOT_CREATED", f"{milestone} holdout")
        _require(stop["economicOriginContribution"] == "NONE", f"{milestone} economic promotion")
        _require(stop["familyContribution"] == "NONE", f"{milestone} family promotion")
        _require(stop["trialContribution"] == "NONE", f"{milestone} trial promotion")
        _require(
            _canonical_bytes(stop["conservativeAttemptP"])
            == _canonical_bytes({"denominator": 1, "numerator": 1}),
            f"{milestone} conservative p",
        )
        _require(stop["limitations"] == list(limitations), f"{milestone} limitations")

    receipts = _exact_list(registry["ledgerReceipts"], "ledger receipts")
    _require(len(receipts) == len(SELECTED_RECORD_IDS), "selected receipt count")
    _require(
        [receipt["recordId"] for receipt in receipts] == list(SELECTED_RECORD_IDS),
        "selected receipt order",
    )
    _require(
        [receipt["rowSha256"] for receipt in receipts]
        == [ROW_SHA256[record_id] for record_id in SELECTED_RECORD_IDS],
        "selected receipt hashes",
    )
    _require(
        [receipt["economicOriginConsumed"] for receipt in receipts]
        == [False, False, False, True, False, False],
        "selected receipt economic classifications",
    )
    expected_receipt_rows = _expected_spec()["ledgerRows"]
    for receipt_any, row_spec_any in zip(  # noqa: B905 - Python 3.9
        receipts, expected_receipt_rows
    ):
        receipt = _exact_dict(receipt_any, "selected receipt")
        row_spec = _exact_dict(row_spec_any, "selected receipt spec")
        _require(
            set(receipt)
            == {
                "attemptDisposition",
                "authority",
                "classification",
                "economicOriginConsumed",
                "recordId",
                "rowByteLength",
                "rowSha256",
                "rowUtf8",
            },
            "selected receipt keys",
        )
        for key in (
            "attemptDisposition",
            "classification",
            "economicOriginConsumed",
            "recordId",
            "rowSha256",
        ):
            _require(receipt[key] == row_spec[key], f"{receipt['recordId']}: {key}")

    pending = _exact_dict(registry["pendingInputs"], "pending inputs")
    _require(pending == _pending_output(), "pending state drift")
    _require(
        _sha256(_canonical_bytes(registry["legacyAcceptedExcluded"])) == BASELINE_LEGACY_SHA256,
        "legacy exclusion drift",
    )
    _require(
        _sha256(_canonical_bytes(registry["truthPolicy"])) == BASELINE_TRUTH_SHA256,
        "truth policy drift",
    )

    expected_delta = {
        "acceptedEconomicOriginIds": ["S-1T"],
        "acceptedStateOnlyStopIds": ["LIQ-CUSTODY1", "BORROW-CUSTODY1"],
        "economicEvidenceThrough": {"recordId": S1T_RECORD_ID, "rowSha256": S1T_ROW_SHA256},
        "priorAcceptedBoundary": {
            "recordId": BASELINE_RECORD_ID,
            "rowSha256": BASELINE_ROW_SHA256,
        },
        "retainedBaselineSourceBindingIds": ["DQ-1"],
        "selectedAcceptedBoundary": {
            "recordId": BORROW_RECORD_ID,
            "rowSha256": BORROW_ROW_SHA256,
        },
        "selectedRecordIds": list(SELECTED_RECORD_IDS),
    }
    _require(registry["deltaWindow"] == expected_delta, "delta window drift")

    summary = _exact_dict(registry["summary"], "summary")
    expected_summary = {
        "acceptedCrediblePositiveCount": 0,
        "acceptedFamilyCount": 49,
        "acceptedOriginCount": 50,
        "acceptedSinceN3S2EconomicConsumedCount": 2,
        "acceptedSinceN3S3EconomicConsumedCount": 1,
        "acceptedStateOnlyStopCount": 2,
        "activeProfitabilityTaskCount": 0,
        "capitalAuthority": "NONE",
        "completeFamilyUniverse": False,
        "crediblePositiveCount": None,
        "currentProfitabilityVerdict": "UNKNOWN",
        "familyDeduplicationState": "EXACT_FOR_ACCEPTED_ORIGINS_ONLY",
        "legacyAcceptedExcludedCount": 13,
        "localVerdictCounts": EXPECTED_LOCAL_VERDICTS,
        "moneyUsd": 0,
        "owner1000FundingVerdict": "NO",
        "positiveEdgeClaim": "NOT_MADE",
        "postVG31AcceptedEconomicConsumedCount": 14,
        "recommendation": "NONE",
        "requiredTruthCount": 6,
        "retainedBaselineSourceBindingCount": 1,
        "selectedReceiptCount": 6,
        "sourceOnlyBindingCount": 13,
        "stateOnlyPOneCount": 2,
        "terminalPendingCount": 0,
        "verifiedPositiveCount": 0,
    }
    _require(
        _canonical_bytes(summary) == _canonical_bytes(expected_summary),
        "summary drift",
    )
    owner_hash = _exact_str(registry["ownerCardRawSha256"], "owner card hash")
    _require(bool(re.fullmatch(r"[0-9a-f]{64}", owner_hash)), "owner card hash shape")
    _require(_sha256(render_owner_card(registry).encode()) == owner_hash, "owner card hash drift")


def verify_spec_binding(registry: Mapping[str, Any], spec: dict[str, Any]) -> None:
    _validate_spec(spec)
    _require(
        registry["originSpecCanonicalSha256"] == _sha256(_canonical_bytes(spec)),
        "origin spec binding drift",
    )


def verify_git_pins(registry: Mapping[str, Any], repo: Path) -> None:
    baseline = _exact_dict(registry["baseline"], "baseline")
    for item_any in _exact_list(baseline["artifacts"], "baseline artifacts"):
        item = _exact_dict(item_any, "baseline artifact")
        live = _pin_artifact(repo, BASELINE_COMMIT, BASELINE_TREE, item["path"])
        _require(
            live == {key: value for key, value in item.items() if key != "name"},
            f"baseline {item['name']}: live Git pin drift",
        )
    origin = _exact_dict(_exact_list(registry["origins"], "origins")[-1], "S-1T")
    for item_any in [origin["artifact"], origin["familyIdentity"]["protocolArtifact"]]:
        pin = _exact_dict(item_any, "S-1T artifact")
        _require(
            _pin_artifact(repo, S1T_COMMIT, S1T_TREE, pin["path"]) == pin,
            f"{pin['path']}: live Git pin drift",
        )
    for item_any in _exact_list(origin["custodyArtifacts"], "S-1T custody artifacts"):
        item = _exact_dict(item_any, "S-1T custody artifact")
        pin = {key: value for key, value in item.items() if key != "name"}
        _require(
            _pin_artifact(repo, S1T_COMMIT, S1T_TREE, item["path"]) == pin,
            f"{item['name']}: live Git pin drift",
        )
    source = next(
        item
        for item in _exact_list(registry["sourceOnlyPins"], "source pins")
        if item["bindingId"] == "DQ-1"
    )
    _require(
        _pin_artifact(repo, DQ1_COMMIT, DQ1_TREE, DQ1_PATH) == source["artifact"],
        "DQ-1 live Git pin drift",
    )


def verify_run_receipts(registry: Mapping[str, Any], run_raw: bytes) -> None:
    extracted, _ = _extract_selected_rows(run_raw)
    for receipt_any in _exact_list(registry["ledgerReceipts"], "ledger receipts"):
        receipt = _exact_dict(receipt_any, "ledger receipt")
        record_id = _exact_str(receipt["recordId"], "receipt record ID")
        _require(
            extracted[record_id]
            == {
                key: receipt[key]
                for key in ("authority", "recordId", "rowByteLength", "rowSha256", "rowUtf8")
            },
            f"{record_id}: live receipt drift",
        )


def _write_outputs(registry: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "current_profitability_registry.v4.json").write_bytes(_canonical_bytes(registry))
    (output_dir / "owner_verdict_card.v4.md").write_text(
        render_owner_card(registry), encoding="utf-8"
    )


def _verify_files(
    registry_path: Path,
    card_path: Path,
    spec: dict[str, Any],
    run_raw: bytes,
    repo: Path,
) -> None:
    raw = registry_path.read_bytes()
    registry = _load_json_bytes(raw, str(registry_path))
    _require(raw == _canonical_bytes(registry), "registry is not canonical JSON")
    validate_registry(registry)
    verify_spec_binding(registry, spec)
    verify_git_pins(registry, repo)
    verify_run_receipts(registry, run_raw)
    _require(
        card_path.read_bytes() == render_owner_card(registry).encode(),
        "owner card bytes drift",
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("freeze", "verify"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--spec", type=Path, required=True)
        subparser.add_argument("--run", type=Path, required=True)
        subparser.add_argument("--repo", type=Path, required=True)
        subparser.add_argument("--output-dir", type=Path)
        subparser.add_argument("--registry", type=Path)
        subparser.add_argument("--card", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        spec = load_json(args.spec)
        run_raw = args.run.read_bytes()
        if args.command == "freeze":
            _require(args.output_dir is not None, "freeze requires --output-dir")
            _require(args.registry is None and args.card is None, "freeze output mode")
            _write_outputs(freeze_registry(spec, run_raw, args.repo), args.output_dir)
        else:
            _require(args.output_dir is None, "verify does not accept --output-dir")
            _require(args.registry is not None, "verify requires --registry")
            _require(args.card is not None, "verify requires --card")
            _verify_files(args.registry, args.card, spec, run_raw, args.repo)
    except (ContractError, OSError, KeyError, TypeError, ValueError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
