#!/usr/bin/env python3
"""Freeze and verify the N3-S3 accepted-boundary profitability overlay.

N3-S3 is an incremental, deterministic overlay on the accepted N3-S2
registry. It consumes exactly six newer ORCHESTRATOR-accepted records:
five prospective DQ validators as source-only bindings and V-G10 as one
terminal UNMEASURED economic origin. Active S-1T remains an opaque pending
identifier; this tool never resolves or reads its branch, worktree, or bytes.

The command is offline. It uses only an explicit spec, run.md bytes, and exact
Git objects. It has no network, clock, environment, provider, private API,
host, order, transfer, withdrawal, M0, or money capability.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Literal, cast, overload

import registry_tool as n3s1
import registry_tool_v2 as n3s2

ContractError = n3s2.ContractError

SCHEMA = "N3S3ProfitabilityConvergenceV1"
SPEC_SCHEMA = "N3S3OriginSpecV1"
VERSION = 1

CANONICAL_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
CANONICAL_TREE = "37d1b88aa7c8d9ee1f70dc35d0e78613b6ed32f9"

BASELINE_COMMIT = "cf00db3f44c030dc393639b4ea7493797fe2aba6"
BASELINE_TREE = "c0b0458169b2287808a763965d79611d6b2acaee"
BASELINE_PARENT = "13631f3cc31020d8ca377d57e24ad6b75d89dba6"
BASELINE_RECORD_ID = "2026-07-30 ORCHESTRATOR DQ-10 ACCEPTANCE + N3/FOLD REFILL"
BASELINE_ROW_SHA256 = "1cde4548dffb2631ecac535f245f3e728b2bd1c083219e62146a99eef0fe1591"

BASELINE_ARTIFACTS = (
    (
        "readme",
        "quant/research/n3_successor/README_S2.md",
        "4898506d3726e71f3cf9f1f586f91c91b7829ba6948c7f6ded46fbdb2fcfdfb7",
    ),
    (
        "originSpec",
        "quant/research/n3_successor/origin_spec.v2.json",
        "ee6fab1ded2fcea45494b9fb2d400c3dbf63238e0dd85ad51fcfde0153bb7090",
    ),
    (
        "registry",
        "quant/research/n3_successor/current_profitability_registry.v2.json",
        "c06b134157ee3aac7c13bf1baa50a050722aa1500df0037f6f3bc401b9d07097",
    ),
    (
        "card",
        "quant/research/n3_successor/owner_verdict_card.v2.md",
        "3ac83fd273706fb27fcdf09074c3a536dfc4be004c31fa461b9e93cd36c08230",
    ),
    (
        "tool",
        "quant/research/n3_successor/registry_tool_v2.py",
        "dff3533a92a2f1db3d3182b5c4af07acb0685c9479f7656ad2d24bcdfce20d0e",
    ),
    (
        "tests",
        "quant/research/n3_successor/test_registry_v2.py",
        "855b0a6d7e28ccb0a5ee89a743dc5f962418820d37037a6764af62551c863d05",
    ),
)

BASELINE_ORIGINS_SHA256 = "bc78a4b1b06a4c38a2f18ea3921b1e84fafafc8e0abf7fd9f25e19cc1c0dd982"
BASELINE_FAMILIES_SHA256 = "54303515151254531db7db3b411ec5c8cd0a6ed959b82cd201de6bf7538725fb"
BASELINE_LEDGER_SHA256 = "98f14294e23a3a27cc58a0691354b7e7e3f967b17e38fc96a43f1c0ae843df00"
BASELINE_SOURCE_PINS_SHA256 = "17d223f278af087b65488f787d91e05b51a5355f5c6d6dbdc612aa50818a447a"
BASELINE_PENDING_SHA256 = "a005b01d241b1dc70343c8b18ab62c125313f4fd1acf714bd0365b37b1899df0"
BASELINE_LEGACY_EXCLUSIONS_SHA256 = (
    "999e0e530da8136349435c1534dcd357d432916309f02bfb611e2dd91d11fa88"
)
BASELINE_TRUTH_POLICY_SHA256 = "9ada035aa4e394641243530de655dcb5fd9c7aefede09f56b097f5ccb2b3a48e"
BASELINE_SUMMARY_SHA256 = "6f43db6ea254951a7fe93d9127e770c086379f66034bdb222fe7b4c068af7680"

PRIOR_LEDGER_RECORD_ID = n3s2.LEDGER_AS_OF_RECORD_ID
PRIOR_LEDGER_ROW_SHA256 = n3s2.LEDGER_AS_OF_ROW_SHA256
ECONOMIC_THROUGH_RECORD_ID = "2026-07-30 ORCHESTRATOR V-G10 ACCEPTANCE"
ECONOMIC_THROUGH_ROW_SHA256 = "fe3d49ed4a4640f69f46dc43dacdb01319264e879843f1876e8d00f863d1d67f"
LEDGER_AS_OF_RECORD_ID = BASELINE_RECORD_ID
LEDGER_AS_OF_ROW_SHA256 = BASELINE_ROW_SHA256

V_G10_COMMIT = "b2bb5551afee9e2dadafd0020bdd8243e33cb028"
V_G10_TREE = "dfc66bf967e917b11f406538d4ea5dac78f14c10"
V_G10_RESULT_PATH = "quant/research/vg10/result.v1.json"
V_G10_PROTOCOL_PATH = "quant/research/vg10/protocol.v1.json"
V_G10_RESULT_SHA256 = "fb10af3ed6913327af1551dc587ab0ecae03d97bef3bb6fa672c4dab68c8bb99"
V_G10_PROTOCOL_SHA256 = "5b11993f366f531d42d041d624b4e4ab9c379f344ef9fa02f4db2f3d6a2a670e"

EXPECTED_COMBINED_ORIGIN_COUNT = 49
EXPECTED_COMBINED_FAMILY_COUNT = 48
EXPECTED_LOCAL_VERDICT_COUNTS = {"NO_GO": 24, "UNMEASURED": 25}
EXPECTED_SOURCE_ONLY_PIN_COUNT = 13
EXPECTED_POST_VG31_ECONOMIC_COUNT = 13

V_G10_LIMITATIONS = (
    "ACCOUNT_EFFECTIVE_HISTORICAL_SPECIAL_AND_TAX_FEES_UNKNOWN",
    "ALPACAUSDT_2025_05_CLOSE_NOT_EXACT_INTERVAL_BOUNDARY",
    "ANALYST_FEE_AND_ADVERSE_EXECUTION_SENSITIVITIES_NOT_APPLIED_OR_ACCOUNT_TRUTH",
    "CAPITAL_NO_GO",
    "COHORT_NOT_SELECTED",
    "DEVELOPMENT_AND_HOLDOUT_BODY_OPEN_STATES_NOT_ATTEMPTED",
    "DEVELOPMENT_OBJECT_NOT_REQUESTED_OUTCOME_MARKER_NOT_CONSUMED_AND_CANDIDATE_NOT_SEALED",
    "ECONOMICS_INTERVAL_MULTIPLICITY_PBO_DRAWDOWN_AND_PUBLIC_CAPACITY_UNMEASURED",
    "EXECUTABLE_CAPACITY_UNMEASURED",
    "GLOBAL_SIBLING_CAMPAIGN_MULTIPLICITY_UNKNOWN_UNADJUSTED",
    "HOLDOUT_NOT_REQUESTED_OR_OPENED",
    "NO_OUTCOME_RECOMPUTATION_OR_ARCHIVE_DECOMPRESSION_IN_VERIFICATION",
    "NO_REPAIR_SUBSTITUTION_REFIT_OR_RERUN",
    "SOURCE_ADMISSIBILITY_ONLY_NOT_PROFITABILITY",
    "SPREAD_BOOK_IMPACT_LATENCY_AND_HISTORICAL_FILTER_ADMISSIBILITY_UNMEASURED",
    "USDT_EQUALS_USD_UNPROVEN_REPORTING_CONVENTION",
)

DQ_LIMITATIONS = {
    "DQ-5": (
        "PROSPECTIVE_METADATA_ONLY",
        "REQUIRES_COMPLETE_CUSTODY_VERIFIED_GLOBAL_REGISTRY",
        "DOES_NOT_AUTHENTICATE_EXTERNAL_CUSTODY_RECEIPT",
        "CANNOT_PROVE_DIFFERENTLY_NAMED_FAMILIES_ECONOMICALLY_DISTINCT",
        "NO_DATASET_ARCHIVE_EXPERIMENT_OUTCOME_OR_HOLDOUT_OPENED",
        "README_SELECTED_AS_COMPLETE_CONTRACT_BINDING_BECAUSE_NO_DECLARED_KNOWN_ANSWER_OR_POLICY",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
        "AUTHORITY_NONE",
    ),
    "DQ-7": (
        "PROSPECTIVE_STRUCTURAL_ADMISSIBILITY_ONLY",
        "EXTERNAL_ACCEPTED_ONTOLOGY_AND_PREOUTCOME_FREEZE_PINS_REQUIRED",
        "CANNOT_DISCOVER_OMITTED_ATTEMPTS_OR_PROVE_GLOBAL_LEDGER_COMPLETENESS",
        "DOES_NOT_EXECUTE_MULTIPLICITY_OR_VALIDATE_STATISTICS_OR_ECONOMICS",
        "MANIFEST_DIGEST_BINDS_NORMALIZED_CONTENT_NOT_SUBMITTED_TRANSPORT_BYTES",
        "PRIOR_EXPERIMENTS_AND_HOLDOUTS_UNTOUCHED",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
        "AUTHORITY_NONE",
    ),
    "DQ-10": (
        "DECLARED_RESULT_ENVELOPE_SEMANTICS_ONLY",
        "DOES_NOT_CALCULATE_OR_AUTHENTICATE_RESEARCH_RESULTS",
        "DOES_NOT_DEREFERENCE_EVIDENCE_BODIES_OR_APPROVE_CALLER_POLICY",
        "DOES_NOT_CONSTRUCT_ADMISSION_IDENTITIES_OR_DENOMINATORS",
        "DOES_NOT_VERIFY_CUSTODY_TRIAL_COMPLETENESS_STATISTICS_MULTIPLICITY_HOLDOUT_FEES_CAPACITY_OR_ECONOMICS",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
        "AUTHORITY_NONE",
    ),
    "DQ-12": (
        "CURRENT_ONLY_SPOT_TO_USDM_INSTRUMENT_IDENTITY",
        "HISTORICAL_STATUS_UNKNOWN",
        "MARGIN_ASSET_IS_SETTLEMENT_PROXY_ONLY",
        "ENDPOINT_METADATA_AND_PAYLOAD_DIGESTS_DO_NOT_AUTHENTICATE_COLLECTION",
        "TRUSTED_EXTERNAL_EVALUATION_TIME_AND_COLLECTION_RECEIPT_REQUIRED",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
        "AUTHORITY_NONE",
    ),
    "DQ-13": (
        "PROSPECTIVE_CLOCK_POLICY_ONLY",
        "CANNOT_REOPEN_OR_RECLASSIFY_CONSUMED_RUNS",
        "VALID_PROVES_ONLY_SUPPLIED_DIGEST_BOUND_EVIDENCE_SATISFIES_FROZEN_POLICY",
        "SOURCE_COMPLETENESS_EXCHANGE_AUTHENTICITY_CLOCK_SYNC_EXTERNAL_LABEL_ISOLATION_FEE_TRUTH_EXECUTION_AND_PROFITABILITY_NOT_PROVEN",
        "SAFETY_NOT_PROVEN",
        "THREE_DAY_PHASE_IS_CONSERVATIVE_FAIL_CLOSED_PROJECT_RULE",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
        "AUTHORITY_NONE",
    ),
}

SELECTED_RECORD_IDS = (
    "2026-07-30 ORCHESTRATOR DQ-7 ACCEPTANCE",
    ECONOMIC_THROUGH_RECORD_ID,
    "2026-07-30 ORCHESTRATOR DQ-5 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR DQ-12 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR DQ-13 ACCEPTANCE",
    LEDGER_AS_OF_RECORD_ID,
)

ROW_SHA256 = {
    "2026-07-30 ORCHESTRATOR DQ-7 ACCEPTANCE": (
        "0cc6e8211e6dc1a4ae61248c4ff2bcf2a89b54736c0dc0eb4fe2d2955c3865f9"
    ),
    ECONOMIC_THROUGH_RECORD_ID: ECONOMIC_THROUGH_ROW_SHA256,
    "2026-07-30 ORCHESTRATOR DQ-5 ACCEPTANCE": (
        "12e1c6e0b1eedefc3f7bbae02dbc8b2450fd4acfb40e5b19c200f5c598007759"
    ),
    "2026-07-30 ORCHESTRATOR DQ-12 ACCEPTANCE": (
        "b51d7538c889fb93b470ddaaada1ed878451ca8dd61403682311efbf125160e5"
    ),
    "2026-07-30 ORCHESTRATOR DQ-13 ACCEPTANCE": (
        "f985023dae30810d22b8cd1070b318e46552c0f7b28e44b9c66a17a2b59a693f"
    ),
    LEDGER_AS_OF_RECORD_ID: LEDGER_AS_OF_ROW_SHA256,
}

ROW_CLASSIFICATION = {
    "2026-07-30 ORCHESTRATOR DQ-7 ACCEPTANCE": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
        DQ_LIMITATIONS["DQ-7"],
    ),
    ECONOMIC_THROUGH_RECORD_ID: (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
        V_G10_LIMITATIONS,
    ),
    "2026-07-30 ORCHESTRATOR DQ-5 ACCEPTANCE": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
        DQ_LIMITATIONS["DQ-5"],
    ),
    "2026-07-30 ORCHESTRATOR DQ-12 ACCEPTANCE": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
        DQ_LIMITATIONS["DQ-12"],
    ),
    "2026-07-30 ORCHESTRATOR DQ-13 ACCEPTANCE": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
        DQ_LIMITATIONS["DQ-13"],
    ),
    LEDGER_AS_OF_RECORD_ID: (
        "ACCEPTED_BASELINE_AND_SOURCE_ONLY",
        False,
        "BASELINE_BOUND",
        DQ_LIMITATIONS["DQ-10"],
    ),
}

NEW_SOURCE_PINS = (
    (
        "DQ-7",
        "2026-07-30 ORCHESTRATOR DQ-7 ACCEPTANCE",
        "73500e9fb2e3184ac28f764a053fb32f1a628aee",
        "e265196b35ad1a1893a9bfd4f3ef84834163a3f8",
        "quant/research/dq7/fixtures/known_answer.v1.json",
        "c3811ed1125142c12e37a78a77983ee4dfac896fa235bdfad8edc76e6716405f",
        "SCHEDULER_AND_N3_INTAKE_FINAL_CONVERGENCE",
    ),
    (
        "DQ-5",
        "2026-07-30 ORCHESTRATOR DQ-5 ACCEPTANCE",
        "e5850fd4236518c7b2081aac45e889a1ece8ec2e",
        "87e66056482689c195af53c74114b0880782c6d6",
        "quant/research/dq5/README.md",
        "60fefdc8a6a8fb3d1b332bb9fd2a2d1f8a658d24668b56db3298e18161fbd508",
        "N3_AND_FUTURE_RESEARCH_INTAKE",
    ),
    (
        "DQ-12",
        "2026-07-30 ORCHESTRATOR DQ-12 ACCEPTANCE",
        "028b7eacea44a2f1df9e38a4b5c33352d908ee27",
        "8b005d57f524463ae56985a41873422be7c12aca",
        "quant/research/dq12/SHA256SUMS",
        "e7cda1fa5a3c45b2631837b7a92b01088fc823553ae66e311c13cfc275bd8a38",
        "N3_SUCCESSOR_AND_FINAL_CONVERGENCE",
    ),
    (
        "DQ-13",
        "2026-07-30 ORCHESTRATOR DQ-13 ACCEPTANCE",
        "e2f15e7387212905022fecba840c1226dce408da",
        "23d5020194436fc30bcb3e4786d3383a6123f4c5",
        "quant/research/dq13/SHA256SUMS",
        "1b4775ff80c9d2ca59dc4b935b0902fa778cb7542d4068e1719161a90e4324bc",
        "FUTURE_S1_VG_AND_N3_FINAL_CONVERGENCE",
    ),
    (
        "DQ-10",
        LEDGER_AS_OF_RECORD_ID,
        "43397a75062142796ce9e3f8979e8676469b6a4a",
        "fe7d8ae3ab1dc98b82b4534f42a6f5cd2a7f06b6",
        "quant/research/dq10/SHA256SUMS",
        "a2ea16ad741454f5b6d3d80d0633bbf7926e3dae16c3fbc6f311e84981190168",
        "N3_SUCCESSOR_AND_FINAL_CONVERGENCE",
    ),
)

PENDING_ACTIVE = (("S-1T", "fea0"),)
REQUIRED_TRUTH_CODES = n3s2.REQUIRED_TRUTH_CODES

HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
FULL_IDENTIFIER = re.compile(r"(?<![0-9a-f])[0-9a-f]{40,64}(?![0-9a-f])")


def _fail(message: str) -> None:
    raise ContractError(message)


def _require(condition: bool, message: str) -> None:
    if not condition:
        _fail(message)


def _exact_dict(value: Any, label: str) -> dict[str, Any]:
    _require(type(value) is dict, f"{label}: expected exact object")
    return cast(dict[str, Any], value)


def _exact_list(value: Any, label: str) -> list[Any]:
    _require(type(value) is list, f"{label}: expected exact array")
    return cast(list[Any], value)


def _exact_str(value: Any, label: str) -> str:
    _require(type(value) is str, f"{label}: expected exact string")
    return cast(str, value)


def _exact_int(value: Any, label: str) -> int:
    _require(type(value) is int, f"{label}: expected exact integer")
    return cast(int, value)


def _exact_bool(value: Any, label: str) -> bool:
    _require(type(value) is bool, f"{label}: expected exact boolean")
    return cast(bool, value)


def _exact_keys(value: Mapping[str, Any], expected: set[str], label: str) -> None:
    _require(set(value) == expected, f"{label}: keys drift")


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )


def load_json(path: Path) -> dict[str, Any]:
    return _load_json_bytes(path.read_bytes(), str(path))


def _load_json_bytes(raw: bytes, label: str) -> dict[str, Any]:
    def reject_constant(value: str) -> None:
        raise ContractError(f"{label}: non-finite JSON constant {value}")

    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            _require(key not in result, f"{label}: duplicate key {key}")
            result[key] = value
        return result

    try:
        value = json.loads(
            raw,
            parse_constant=reject_constant,
            object_pairs_hook=object_pairs,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError(f"{label}: invalid strict JSON") from exc
    return _exact_dict(value, label)


@overload
def _git(repo: Path, args: Sequence[str], *, text: Literal[False] = False) -> bytes: ...


@overload
def _git(repo: Path, args: Sequence[str], *, text: Literal[True]) -> str: ...


def _git(repo: Path, args: Sequence[str], *, text: bool = False) -> Any:
    process = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=False,
        capture_output=True,
        text=False,
    )
    if process.returncode != 0:
        raise ContractError(f"git {' '.join(args)} failed")
    if text:
        try:
            return process.stdout.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ContractError("git output is not UTF-8") from exc
    return process.stdout


def _pin_artifact(repo: Path, commit: str, tree: str, path: str) -> dict[str, Any]:
    return n3s2._pin_artifact(repo, commit, tree, path)


def _extract_rows(
    run_raw: bytes, record_ids: Sequence[str]
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    """Extract one exact LF-terminated FABLE5 row per allowlisted record."""

    lines = run_raw.splitlines(keepends=True)
    receipts: dict[str, dict[str, Any]] = {}
    positions: dict[str, int] = {}
    for record_id in record_ids:
        marker = f"- item=`{record_id}`".encode()
        matches = [(index, line) for index, line in enumerate(lines) if line.startswith(marker)]
        _require(len(matches) == 1, f"{record_id}: expected one exact ledger row")
        index, row = matches[0]
        _require(row.endswith(b"\n"), f"{record_id}: row lacks LF")
        try:
            row_utf8 = row.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ContractError(f"{record_id}: row is not UTF-8") from exc
        receipts[record_id] = {
            "authority": "ORCHESTRATOR_RUN_MD",
            "recordId": record_id,
            "rowByteLength": len(row),
            "rowSha256": _sha256(row),
            "rowUtf8": row_utf8,
        }
        positions[record_id] = index
    return receipts, positions


def _validate_selected_order(positions: Mapping[str, int]) -> None:
    """Bind the six sparse accepted rows without consuming intervening records."""

    prior = positions[PRIOR_LEDGER_RECORD_ID]
    selected_positions = [positions[record_id] for record_id in SELECTED_RECORD_IDS]
    _require(
        all(position < prior for position in selected_positions),
        "selected row does not follow the prior N3-S2 boundary",
    )
    _require(
        all(
            selected_positions[index] > selected_positions[index + 1]
            for index in range(len(selected_positions) - 1)
        ),
        "selected accepted-row chronology drift",
    )


def _expected_baseline_spec() -> dict[str, Any]:
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


def _expected_ledger_specs() -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for record_id in SELECTED_RECORD_IDS:
        classification, consumed, attempt, limitations = ROW_CLASSIFICATION[record_id]
        output.append(
            {
                "attemptDisposition": attempt,
                "classification": classification,
                "economicOriginConsumed": consumed,
                "limitations": list(limitations),
                "recordId": record_id,
                "rowSha256": ROW_SHA256[record_id],
            }
        )
    return output


def _expected_source_specs() -> list[dict[str, Any]]:
    return [
        {
            "bindingId": binding_id,
            "consumerScope": consumer_scope,
            "path": path,
            "producerCommit": commit,
            "producerTree": tree,
            "rawSha256": raw_sha,
            "recordId": record_id,
        }
        for (
            binding_id,
            record_id,
            commit,
            tree,
            path,
            raw_sha,
            consumer_scope,
        ) in NEW_SOURCE_PINS
    ]


def _expected_incremental_origin_spec() -> dict[str, Any]:
    return {
        "custodyState": "ACCEPTED_EXACT",
        "limitations": list(V_G10_LIMITATIONS),
        "normalizedVerdict": "UNMEASURED",
        "originId": "V-G10",
        "producerCommit": V_G10_COMMIT,
        "producerTree": V_G10_TREE,
        "protocolPath": V_G10_PROTOCOL_PATH,
        "protocolRawSha256": V_G10_PROTOCOL_SHA256,
        "recordId": ECONOMIC_THROUGH_RECORD_ID,
        "resultPath": V_G10_RESULT_PATH,
        "resultRawSha256": V_G10_RESULT_SHA256,
        "rowSha256": ECONOMIC_THROUGH_ROW_SHA256,
        "sourceVerdict": "UNMEASURED_CAPITAL_NO_GO",
    }


def _validate_boundary(
    spec: Mapping[str, Any],
    field: str,
    record_id: str,
    row_sha256: str,
) -> None:
    boundary = _exact_dict(spec[field], f"spec.{field}")
    _exact_keys(boundary, {"recordId", "rowSha256"}, f"spec.{field}")
    _require(
        boundary == {"recordId": record_id, "rowSha256": row_sha256},
        f"{field} drift",
    )


def _pending_output(spec_pending: dict[str, Any]) -> dict[str, Any]:
    _exact_keys(
        spec_pending,
        {
            "activeOutsideBaselineCutoff",
            "activeWithinBaselineCutoff",
            "requiredTruth",
            "terminalPending",
        },
        "spec.pendingInputs",
    )
    _require(
        _exact_list(
            spec_pending["activeOutsideBaselineCutoff"],
            "spec.pendingInputs.activeOutsideBaselineCutoff",
        )
        == [],
        "outside-baseline pending drift",
    )
    _require(
        _exact_list(spec_pending["terminalPending"], "spec.pendingInputs.terminalPending") == [],
        "terminal pending drift",
    )
    active_values = _exact_list(
        spec_pending["activeWithinBaselineCutoff"],
        "spec.pendingInputs.activeWithinBaselineCutoff",
    )
    _require(len(active_values) == 1, "active pending count")
    active = _exact_dict(active_values[0], "active pending")
    _exact_keys(active, {"milestoneId", "taskRefSuffix"}, "active pending")
    _require(
        (
            _exact_str(active["milestoneId"], "active milestone"),
            _exact_str(active["taskRefSuffix"], "active suffix"),
        )
        == PENDING_ACTIVE[0],
        "active S-1T opaque identity drift",
    )
    _require(
        bool(re.fullmatch(r"[0-9a-f]{4}", cast(str, active["taskRefSuffix"]))),
        "active suffix",
    )

    truth_values = _exact_list(spec_pending["requiredTruth"], "spec.pendingInputs.requiredTruth")
    truth_codes = tuple(_exact_str(value, "required truth code") for value in truth_values)
    _require(truth_codes == REQUIRED_TRUTH_CODES, "required truth drift")
    return {
        "activeOutsideBaselineCutoff": [],
        "activeWithinBaselineCutoff": [
            {
                "evidenceState": "ACTIVE_UNPUBLISHED",
                "inBaselineCutoffScope": True,
                "milestoneId": PENDING_ACTIVE[0][0],
                "outcomeBytesInspected": False,
                "taskRefIsEvidence": False,
                "taskRefSuffix": PENDING_ACTIVE[0][1],
            }
        ],
        "requiredTruth": [{"code": code, "state": "PENDING"} for code in REQUIRED_TRUTH_CODES],
        "terminalPending": [],
    }


def _validate_spec(spec: dict[str, Any]) -> None:
    _exact_keys(
        spec,
        {
            "acceptanceLedgerAsOf",
            "baseline",
            "canonicalOrigin",
            "economicEvidenceThrough",
            "incrementalOrigin",
            "ledgerRows",
            "pendingInputs",
            "priorLedgerAsOf",
            "schema",
            "sourceOnlyPins",
            "version",
        },
        "spec",
    )
    _require(_exact_str(spec["schema"], "spec.schema") == SPEC_SCHEMA, "spec schema")
    _require(_exact_int(spec["version"], "spec.version") == VERSION, "spec version")
    canonical = _exact_dict(spec["canonicalOrigin"], "spec.canonicalOrigin")
    _exact_keys(canonical, {"commit", "tree"}, "spec.canonicalOrigin")
    _require(
        canonical == {"commit": CANONICAL_COMMIT, "tree": CANONICAL_TREE},
        "canonical origin drift",
    )
    baseline = _exact_dict(spec["baseline"], "spec.baseline")
    _require(baseline == _expected_baseline_spec(), "baseline spec drift")
    _validate_boundary(spec, "priorLedgerAsOf", PRIOR_LEDGER_RECORD_ID, PRIOR_LEDGER_ROW_SHA256)
    _validate_boundary(
        spec,
        "economicEvidenceThrough",
        ECONOMIC_THROUGH_RECORD_ID,
        ECONOMIC_THROUGH_ROW_SHA256,
    )
    _validate_boundary(
        spec, "acceptanceLedgerAsOf", LEDGER_AS_OF_RECORD_ID, LEDGER_AS_OF_ROW_SHA256
    )
    origin = _exact_dict(spec["incrementalOrigin"], "spec.incrementalOrigin")
    _require(origin == _expected_incremental_origin_spec(), "V-G10 origin spec drift")
    ledger = _exact_list(spec["ledgerRows"], "spec.ledgerRows")
    _require(ledger == _expected_ledger_specs(), "selected ledger allowlist/order drift")
    source_pins = _exact_list(spec["sourceOnlyPins"], "spec.sourceOnlyPins")
    _require(source_pins == _expected_source_specs(), "source-only pin drift")
    _pending_output(_exact_dict(spec["pendingInputs"], "spec.pendingInputs"))


def _load_baseline(
    repo: Path, run_raw: bytes
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, Any]]:
    pins: dict[str, dict[str, Any]] = {}
    for name, path, raw_sha in BASELINE_ARTIFACTS:
        pin = _pin_artifact(repo, BASELINE_COMMIT, BASELINE_TREE, path)
        _require(pin["rawSha256"] == raw_sha, f"baseline {name} bytes drift")
        pins[name] = pin

    registry_raw = _git(
        repo,
        [
            "show",
            f"{BASELINE_COMMIT}:quant/research/n3_successor/current_profitability_registry.v2.json",
        ],
    )
    spec_raw = _git(
        repo,
        ["show", f"{BASELINE_COMMIT}:quant/research/n3_successor/origin_spec.v2.json"],
    )
    card_raw = _git(
        repo,
        ["show", f"{BASELINE_COMMIT}:quant/research/n3_successor/owner_verdict_card.v2.md"],
    )
    _require(type(registry_raw) is bytes, "baseline registry output")
    _require(type(spec_raw) is bytes, "baseline spec output")
    _require(type(card_raw) is bytes, "baseline card output")
    registry = _load_json_bytes(registry_raw, "baseline registry")
    spec = _load_json_bytes(spec_raw, "baseline spec")
    n3s2.validate_registry(registry)
    n3s2.verify_spec_binding(registry, spec)
    n3s2.verify_git_pins(registry, repo)
    n3s2.verify_run_receipts(registry, run_raw)
    _require(
        n3s2.render_owner_card(registry).encode("utf-8") == card_raw,
        "baseline card rendering drift",
    )
    baseline_hashes = {
        "origins": BASELINE_ORIGINS_SHA256,
        "families": BASELINE_FAMILIES_SHA256,
        "ledgerReceipts": BASELINE_LEDGER_SHA256,
        "sourceOnlyPins": BASELINE_SOURCE_PINS_SHA256,
        "pendingInputs": BASELINE_PENDING_SHA256,
        "legacyAcceptedExcluded": BASELINE_LEGACY_EXCLUSIONS_SHA256,
        "truthPolicy": BASELINE_TRUTH_POLICY_SHA256,
        "summary": BASELINE_SUMMARY_SHA256,
    }
    for field, expected_sha in baseline_hashes.items():
        _require(
            _sha256(_canonical_bytes(registry[field])) == expected_sha,
            f"baseline {field} drift",
        )
    return registry, pins, spec


def _build_incremental_origin(
    spec_origin: Mapping[str, Any],
    receipt: Mapping[str, Any],
    repo: Path,
) -> dict[str, Any]:
    result_artifact = _pin_artifact(
        repo,
        V_G10_COMMIT,
        V_G10_TREE,
        _exact_str(spec_origin["resultPath"], "V-G10 result path"),
    )
    protocol_artifact = _pin_artifact(
        repo,
        V_G10_COMMIT,
        V_G10_TREE,
        _exact_str(spec_origin["protocolPath"], "V-G10 protocol path"),
    )
    _require(
        result_artifact["rawSha256"] == V_G10_RESULT_SHA256,
        "V-G10 result bytes drift",
    )
    _require(
        protocol_artifact["rawSha256"] == V_G10_PROTOCOL_SHA256,
        "V-G10 protocol bytes drift",
    )
    result_raw = _git(repo, ["show", f"{V_G10_COMMIT}:{V_G10_RESULT_PATH}"])
    _require(type(result_raw) is bytes, "V-G10 result output")
    result = _load_json_bytes(result_raw, "V-G10 result")
    expected_result = {
        "accountEffectiveFees": "UNKNOWN",
        "capitalVerdict": "NO_GO",
        "completedAtUtc": "2026-07-29T21:33:14Z",
        "evidence": {"message": "ALPACAUSDT 2025-05 close time is not the exact interval boundary"},
        "executableCapacity": "UNMEASURED",
        "executionAuthority": "NONE",
        "globalSiblingCampaignMultiplicity": "UNKNOWN_UNADJUSTED",
        "reasonCode": "EVIDENCE_INVALID",
        "researchVerdict": "UNMEASURED",
        "schema": "VG10TerminalResultV1",
        "usdtEqualsUsd": "UNPROVEN_REPORTING_CONVENTION",
    }
    _require(result == expected_result, "V-G10 terminal result semantic drift")
    return {
        "acceptanceRowSha256": receipt["rowSha256"],
        "artifact": result_artifact,
        "custodyState": "ACCEPTED_EXACT",
        "familyIdentity": {
            "key": f"POST_SMETA1::V-G10::{V_G10_PROTOCOL_SHA256}",
            "protocolArtifact": protocol_artifact,
            "state": "PROVISIONAL_POST_SMETA1",
        },
        "limitations": sorted(V_G10_LIMITATIONS),
        "normalizedVerdict": "UNMEASURED",
        "ordinal": EXPECTED_COMBINED_ORIGIN_COUNT,
        "originId": "V-G10",
        "producerCommit": V_G10_COMMIT,
        "producerTree": V_G10_TREE,
        "recordId": ECONOMIC_THROUGH_RECORD_ID,
        "sourceVerdict": "UNMEASURED_CAPITAL_NO_GO",
        "verifiedPositive": False,
    }


def freeze_registry(spec: dict[str, Any], run_raw: bytes, repo: Path) -> dict[str, Any]:
    _validate_spec(spec)
    baseline_registry, baseline_pins, _ = _load_baseline(repo, run_raw)

    extracted, positions = _extract_rows(run_raw, (PRIOR_LEDGER_RECORD_ID, *SELECTED_RECORD_IDS))
    _require(
        extracted[PRIOR_LEDGER_RECORD_ID]["rowSha256"] == PRIOR_LEDGER_ROW_SHA256,
        "prior DQ-14 row drift",
    )
    for record_id in SELECTED_RECORD_IDS:
        _require(
            extracted[record_id]["rowSha256"] == ROW_SHA256[record_id],
            f"{record_id}: live row drift",
        )
    _validate_selected_order(positions)

    incremental_origin = _build_incremental_origin(
        _exact_dict(spec["incrementalOrigin"], "spec.incrementalOrigin"),
        extracted[ECONOMIC_THROUGH_RECORD_ID],
        repo,
    )
    origins = [*copy.deepcopy(baseline_registry["origins"]), incremental_origin]
    families = n3s1._build_family_rollups(origins)
    _require(len(origins) == EXPECTED_COMBINED_ORIGIN_COUNT, "combined origin count")
    _require(len(families) == EXPECTED_COMBINED_FAMILY_COUNT, "combined family count")

    ledger_receipts: list[dict[str, Any]] = []
    for value in _exact_list(spec["ledgerRows"], "spec.ledgerRows"):
        row_spec = _exact_dict(value, "ledger row")
        record_id = _exact_str(row_spec["recordId"], "ledger record ID")
        receipt = copy.deepcopy(extracted[record_id])
        receipt.update(
            {
                "attemptDisposition": row_spec["attemptDisposition"],
                "classification": row_spec["classification"],
                "economicOriginConsumed": row_spec["economicOriginConsumed"],
                "limitations": list(row_spec["limitations"]),
            }
        )
        ledger_receipts.append(receipt)

    new_source_pins: list[dict[str, Any]] = []
    for value in _exact_list(spec["sourceOnlyPins"], "spec.sourceOnlyPins"):
        source = _exact_dict(value, "source-only pin")
        binding_id = _exact_str(source["bindingId"], "binding ID")
        artifact = _pin_artifact(
            repo,
            _exact_str(source["producerCommit"], f"{binding_id}.commit"),
            _exact_str(source["producerTree"], f"{binding_id}.tree"),
            _exact_str(source["path"], f"{binding_id}.path"),
        )
        _require(
            artifact["rawSha256"] == source["rawSha256"],
            f"{binding_id}: artifact bytes drift",
        )
        record_id = _exact_str(source["recordId"], f"{binding_id}.record")
        new_source_pins.append(
            {
                "acceptanceRowSha256": extracted[record_id]["rowSha256"],
                "artifact": artifact,
                "bindingId": binding_id,
                "consumerScope": _exact_str(
                    source["consumerScope"], f"{binding_id}.consumer scope"
                ),
                "economicContribution": "NONE",
                "limitations": list(DQ_LIMITATIONS[binding_id]),
                "recordId": record_id,
                "status": "ACCEPTED_SOURCE_ONLY",
            }
        )
    source_only_pins = [
        *copy.deepcopy(baseline_registry["sourceOnlyPins"]),
        *new_source_pins,
    ]
    _require(
        len(source_only_pins) == EXPECTED_SOURCE_ONLY_PIN_COUNT,
        "combined source-only pin count",
    )

    pending = _pending_output(_exact_dict(spec["pendingInputs"], "spec.pendingInputs"))
    legacy_excluded = copy.deepcopy(baseline_registry["legacyAcceptedExcluded"])
    truth_policy = copy.deepcopy(baseline_registry["truthPolicy"])
    _require(
        _sha256(_canonical_bytes(legacy_excluded)) == BASELINE_LEGACY_EXCLUSIONS_SHA256,
        "legacy exclusion set drift",
    )
    _require(
        _sha256(_canonical_bytes(truth_policy)) == BASELINE_TRUTH_POLICY_SHA256,
        "truth policy drift",
    )
    local_verdict_counts = {
        verdict: sum(origin["normalizedVerdict"] == verdict for origin in origins)
        for verdict in ("NO_GO", "UNMEASURED")
    }
    _require(
        local_verdict_counts == EXPECTED_LOCAL_VERDICT_COUNTS,
        "local verdict count drift",
    )

    registry: dict[str, Any] = {
        "acceptanceLedgerAsOf": {
            "recordId": LEDGER_AS_OF_RECORD_ID,
            "rowSha256": extracted[LEDGER_AS_OF_RECORD_ID]["rowSha256"],
        },
        "baseline": {
            "acceptanceRowSha256": extracted[BASELINE_RECORD_ID]["rowSha256"],
            "artifacts": [
                {"name": name, **baseline_pins[name]} for name, _, _ in BASELINE_ARTIFACTS
            ],
            "producerCommit": BASELINE_COMMIT,
            "producerParent": BASELINE_PARENT,
            "producerTree": BASELINE_TREE,
            "recordId": BASELINE_RECORD_ID,
        },
        "canonicalOrigin": {"commit": CANONICAL_COMMIT, "tree": CANONICAL_TREE},
        "deltaWindow": {
            "acceptedEconomicOriginIds": ["V-G10"],
            "economicEvidenceThrough": {
                "recordId": ECONOMIC_THROUGH_RECORD_ID,
                "rowSha256": extracted[ECONOMIC_THROUGH_RECORD_ID]["rowSha256"],
            },
            "newSourceOnlyBindingIds": [binding_id for binding_id, *_ in NEW_SOURCE_PINS],
            "priorLedgerAsOf": {
                "recordId": PRIOR_LEDGER_RECORD_ID,
                "rowSha256": extracted[PRIOR_LEDGER_RECORD_ID]["rowSha256"],
            },
            "selectedRecordIds": list(SELECTED_RECORD_IDS),
        },
        "families": families,
        "ledgerReceipts": ledger_receipts,
        "legacyAcceptedExcluded": legacy_excluded,
        "originSpecCanonicalSha256": _sha256(_canonical_bytes(spec)),
        "origins": origins,
        "ownerCardRawSha256": "",
        "pendingInputs": pending,
        "schema": SCHEMA,
        "sourceOnlyPins": source_only_pins,
        "summary": {
            "acceptedCrediblePositiveCount": 0,
            "acceptedFamilyCount": len(families),
            "acceptedOriginCount": len(origins),
            "acceptedSinceN3S2EconomicConsumedCount": 1,
            "activeProfitabilityTaskCount": 1,
            "capitalAuthority": "NONE",
            "completeFamilyUniverse": False,
            "crediblePositiveCount": None,
            "currentProfitabilityVerdict": "UNKNOWN",
            "familyDeduplicationState": "EXACT_FOR_ACCEPTED_ORIGINS_ONLY",
            "legacyAcceptedExcludedCount": len(legacy_excluded),
            "localVerdictCounts": local_verdict_counts,
            "moneyUsd": 0,
            "newSourceOnlyBindingCount": len(new_source_pins),
            "owner1000FundingVerdict": "NO",
            "positiveEdgeClaim": "NOT_MADE",
            "postVG31AcceptedEconomicConsumedCount": EXPECTED_POST_VG31_ECONOMIC_COUNT,
            "recommendation": "NONE",
            "requiredTruthCount": len(REQUIRED_TRUTH_CODES),
            "selectedReceiptCount": len(ledger_receipts),
            "terminalPendingCount": 0,
            "verifiedPositiveCount": 0,
        },
        "truthPolicy": truth_policy,
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
    ledger = _exact_dict(registry["acceptanceLedgerAsOf"], "ledger boundary")
    pending = _exact_dict(registry["pendingInputs"], "registry.pendingInputs")
    active = _exact_list(
        pending["activeWithinBaselineCutoff"], "pending.activeWithinBaselineCutoff"
    )
    active_ids = ",".join(_exact_str(item["milestoneId"], "active ID") for item in active)
    found = (
        f"origins={summary['acceptedOriginCount']}/{summary['acceptedOriginCount']}; "
        f"acceptedFamilies={summary['acceptedFamilyCount']}; "
        f"localNO_GO={summary['localVerdictCounts']['NO_GO']}; "
        f"localUNMEASURED={summary['localVerdictCounts']['UNMEASURED']}; "
        "acceptedCrediblePositives=0; crediblePositiveCount=null; "
        f"postV-G31AcceptedConsumed={summary['postVG31AcceptedEconomicConsumedCount']}; "
        f"sinceN3-S2AcceptedConsumed={summary['acceptedSinceN3S2EconomicConsumedCount']}; "
        f"acceptedSourceOnly={len(_exact_list(registry['sourceOnlyPins'], 'source pins'))}; "
        f"selectedReceipts={summary['selectedReceiptCount']}; "
        f"legacyAcceptedExcluded={summary['legacyAcceptedExcludedCount']}; "
        f"active={active_ids}; terminalPending=; "
        f"pendingTruth={summary['requiredTruthCount']}; "
        f"economicThrough=V-G10-row …{economic['rowSha256'][-4:]}; "
        f"ledgerAsOf=DQ-10-row …{ledger['rowSha256'][-4:]}; "
        "globalProfitability=UNKNOWN; owner$1k=NO; positiveEdgeClaim=NOT_MADE; "
        "recommendation=NONE; authority=NONE; effects=NONE/$0"
    )
    card = (
        "- item=`N3-S3 PROFITABILITY CONVERGENCE`"
        f" | expected=`accepted N3-S2 …{BASELINE_COMMIT[-4:]}/row "
        f"…{BASELINE_ROW_SHA256[-4:]} + V-G10 accepted UNMEASURED economics "
        "and DQ-5/DQ-7/DQ-10/DQ-12/DQ-13 source-only bindings`"
        f" | found=`{found}`"
        " | status=`N3_S3_SOURCE_READY; PRESERVED_WAITING(final convergence); "
        "NOT_LANDED; STOP`\n"
    )
    _require(card.count("\n") == 1 and card.endswith("\n"), "card is not one line")
    _require(not FULL_IDENTIFIER.search(card), "card leaked a full identifier")
    _require(
        not any(token in card for token in ("/Users/", "Desktop/", "quant/", "research/")),
        "card leaked a path",
    )
    _require(len(card.encode("utf-8")) <= 1600, "card exceeds bounded length")
    return card


def _validate_artifact_pin(value: Any, label: str) -> None:
    n3s2._validate_artifact_pin(value, label)


def _validate_baseline_registry_field(value: Any) -> None:
    baseline = _exact_dict(value, "registry.baseline")
    _exact_keys(
        baseline,
        {
            "acceptanceRowSha256",
            "artifacts",
            "producerCommit",
            "producerParent",
            "producerTree",
            "recordId",
        },
        "registry.baseline",
    )
    _require(
        baseline["acceptanceRowSha256"] == BASELINE_ROW_SHA256,
        "baseline acceptance hash",
    )
    _require(baseline["producerCommit"] == BASELINE_COMMIT, "baseline commit")
    _require(baseline["producerTree"] == BASELINE_TREE, "baseline tree")
    _require(baseline["producerParent"] == BASELINE_PARENT, "baseline parent")
    _require(baseline["recordId"] == BASELINE_RECORD_ID, "baseline record")
    artifacts = _exact_list(baseline["artifacts"], "registry.baseline.artifacts")
    _require(len(artifacts) == len(BASELINE_ARTIFACTS), "baseline artifact count")
    for offset in range(len(BASELINE_ARTIFACTS)):
        index = offset + 1
        value_item = artifacts[offset]
        expected = BASELINE_ARTIFACTS[offset]
        item = _exact_dict(value_item, f"baseline artifact {index}")
        _exact_keys(
            item,
            {
                "byteLength",
                "gitBlob",
                "mode",
                "name",
                "path",
                "producerCommit",
                "producerTree",
                "rawSha256",
            },
            f"baseline artifact {index}",
        )
        name, path, raw_sha = expected
        _require(item["name"] == name, f"baseline artifact {index} name")
        _validate_artifact_pin(
            {key: value for key, value in item.items() if key != "name"},
            f"baseline artifact {name}",
        )
        _require(item["path"] == path, f"baseline artifact {name} path")
        _require(item["producerCommit"] == BASELINE_COMMIT, "baseline pin commit")
        _require(item["producerTree"] == BASELINE_TREE, "baseline pin tree")
        _require(item["rawSha256"] == raw_sha, f"baseline artifact {name} bytes")


def _validate_pending_registry(value: Any) -> None:
    pending = _exact_dict(value, "registry.pendingInputs")
    expected = {
        "activeOutsideBaselineCutoff": [],
        "activeWithinBaselineCutoff": [
            {
                "evidenceState": "ACTIVE_UNPUBLISHED",
                "inBaselineCutoffScope": True,
                "milestoneId": "S-1T",
                "outcomeBytesInspected": False,
                "taskRefIsEvidence": False,
                "taskRefSuffix": "fea0",
            }
        ],
        "requiredTruth": [{"code": code, "state": "PENDING"} for code in REQUIRED_TRUTH_CODES],
        "terminalPending": [],
    }
    _require(pending == expected, "pending input drift")


def validate_registry(registry_any: Any) -> None:
    registry = _exact_dict(registry_any, "registry")
    _exact_keys(
        registry,
        {
            "acceptanceLedgerAsOf",
            "baseline",
            "canonicalOrigin",
            "deltaWindow",
            "families",
            "ledgerReceipts",
            "legacyAcceptedExcluded",
            "originSpecCanonicalSha256",
            "origins",
            "ownerCardRawSha256",
            "pendingInputs",
            "schema",
            "sourceOnlyPins",
            "summary",
            "truthPolicy",
            "version",
        },
        "registry",
    )
    _require(registry["schema"] == SCHEMA, "registry schema")
    _require(type(registry["version"]) is int and registry["version"] == VERSION, "version")
    _require(
        registry["canonicalOrigin"] == {"commit": CANONICAL_COMMIT, "tree": CANONICAL_TREE},
        "canonical origin",
    )
    _validate_baseline_registry_field(registry["baseline"])
    _require(
        registry["acceptanceLedgerAsOf"]
        == {"recordId": LEDGER_AS_OF_RECORD_ID, "rowSha256": LEDGER_AS_OF_ROW_SHA256},
        "acceptance boundary",
    )
    spec_hash = _exact_str(registry["originSpecCanonicalSha256"], "origin spec canonical hash")
    _require(bool(HEX64.fullmatch(spec_hash)), "origin spec canonical hash")
    card_hash = _exact_str(registry["ownerCardRawSha256"], "owner card hash")
    _require(bool(HEX64.fullmatch(card_hash)), "owner card hash")

    delta = _exact_dict(registry["deltaWindow"], "registry.deltaWindow")
    expected_delta = {
        "acceptedEconomicOriginIds": ["V-G10"],
        "economicEvidenceThrough": {
            "recordId": ECONOMIC_THROUGH_RECORD_ID,
            "rowSha256": ECONOMIC_THROUGH_ROW_SHA256,
        },
        "newSourceOnlyBindingIds": [binding_id for binding_id, *_ in NEW_SOURCE_PINS],
        "priorLedgerAsOf": {
            "recordId": PRIOR_LEDGER_RECORD_ID,
            "rowSha256": PRIOR_LEDGER_ROW_SHA256,
        },
        "selectedRecordIds": list(SELECTED_RECORD_IDS),
    }
    _require(delta == expected_delta, "delta window drift")

    origins = _exact_list(registry["origins"], "registry.origins")
    _require(len(origins) == EXPECTED_COMBINED_ORIGIN_COUNT, "origin count")
    _require(
        _sha256(_canonical_bytes(origins[:-1])) == BASELINE_ORIGINS_SHA256,
        "baseline origin prefix drift",
    )
    incremental = _exact_dict(origins[-1], "V-G10 origin")
    _exact_keys(
        incremental,
        {
            "acceptanceRowSha256",
            "artifact",
            "custodyState",
            "familyIdentity",
            "limitations",
            "normalizedVerdict",
            "ordinal",
            "originId",
            "producerCommit",
            "producerTree",
            "recordId",
            "sourceVerdict",
            "verifiedPositive",
        },
        "V-G10 origin",
    )
    _require(incremental["acceptanceRowSha256"] == ECONOMIC_THROUGH_ROW_SHA256, "V-G10 row")
    _require(incremental["custodyState"] == "ACCEPTED_EXACT", "V-G10 custody")
    _require(incremental["normalizedVerdict"] == "UNMEASURED", "V-G10 verdict")
    _require(incremental["sourceVerdict"] == "UNMEASURED_CAPITAL_NO_GO", "V-G10 source verdict")
    _require(incremental["verifiedPositive"] is False, "V-G10 positive")
    _require(incremental["ordinal"] == EXPECTED_COMBINED_ORIGIN_COUNT, "V-G10 ordinal")
    _require(incremental["originId"] == "V-G10", "V-G10 origin ID")
    _require(incremental["producerCommit"] == V_G10_COMMIT, "V-G10 commit")
    _require(incremental["producerTree"] == V_G10_TREE, "V-G10 tree")
    _require(incremental["recordId"] == ECONOMIC_THROUGH_RECORD_ID, "V-G10 record")
    _require(
        incremental["limitations"] == sorted(V_G10_LIMITATIONS),
        "V-G10 limitation drift",
    )
    artifact = _exact_dict(incremental["artifact"], "V-G10 artifact")
    _validate_artifact_pin(artifact, "V-G10 artifact")
    _require(artifact["path"] == V_G10_RESULT_PATH, "V-G10 result path")
    _require(artifact["rawSha256"] == V_G10_RESULT_SHA256, "V-G10 result hash")
    family_identity = _exact_dict(incremental["familyIdentity"], "V-G10 family")
    _exact_keys(family_identity, {"key", "protocolArtifact", "state"}, "V-G10 family")
    _require(
        family_identity["key"] == f"POST_SMETA1::V-G10::{V_G10_PROTOCOL_SHA256}",
        "V-G10 family key",
    )
    _require(family_identity["state"] == "PROVISIONAL_POST_SMETA1", "V-G10 family state")
    protocol = _exact_dict(family_identity["protocolArtifact"], "V-G10 protocol")
    _validate_artifact_pin(protocol, "V-G10 protocol")
    _require(protocol["path"] == V_G10_PROTOCOL_PATH, "V-G10 protocol path")
    _require(protocol["rawSha256"] == V_G10_PROTOCOL_SHA256, "V-G10 protocol hash")

    families = _exact_list(registry["families"], "registry.families")
    _require(len(families) == EXPECTED_COMBINED_FAMILY_COUNT, "family count")
    rebuilt_families = n3s1._build_family_rollups(origins)
    _require(families == rebuilt_families, "family rollup drift")
    final_family = _exact_dict(families[-1], "V-G10 family rollup")
    _require(final_family["originIds"] == ["V-G10"], "V-G10 family membership")
    _require(
        final_family["effectiveProgramWideP"] == {"denominator": 1, "numerator": 1},
        "V-G10 effective p must remain 1",
    )
    _require(final_family["verifiedPositive"] is False, "V-G10 family positive")

    receipts = _exact_list(registry["ledgerReceipts"], "registry.ledgerReceipts")
    _require(len(receipts) == len(SELECTED_RECORD_IDS), "selected receipt count")
    expected_ledger_specs = _expected_ledger_specs()
    for offset in range(len(expected_ledger_specs)):
        index = offset + 1
        value = receipts[offset]
        expected_spec = expected_ledger_specs[offset]
        receipt = _exact_dict(value, f"receipt {index}")
        _exact_keys(
            receipt,
            {
                "attemptDisposition",
                "authority",
                "classification",
                "economicOriginConsumed",
                "limitations",
                "recordId",
                "rowByteLength",
                "rowSha256",
                "rowUtf8",
            },
            f"receipt {index}",
        )
        _require(receipt["authority"] == "ORCHESTRATOR_RUN_MD", "receipt authority")
        for field in (
            "attemptDisposition",
            "classification",
            "economicOriginConsumed",
            "limitations",
            "recordId",
            "rowSha256",
        ):
            _require(
                receipt[field] == expected_spec[field],
                f"receipt {index} {field} drift",
            )
        row_utf8 = _exact_str(receipt["rowUtf8"], f"receipt {index} row")
        _require(row_utf8.endswith("\n") and row_utf8.count("\n") == 1, "receipt row LF")
        _require(
            _sha256(row_utf8.encode("utf-8")) == receipt["rowSha256"],
            "receipt bytes/hash mismatch",
        )
        _require(
            len(row_utf8.encode("utf-8"))
            == _exact_int(receipt["rowByteLength"], "receipt byte length"),
            "receipt byte length mismatch",
        )

    source_pins = _exact_list(registry["sourceOnlyPins"], "registry.sourceOnlyPins")
    _require(len(source_pins) == EXPECTED_SOURCE_ONLY_PIN_COUNT, "source pin count")
    _require(
        _sha256(_canonical_bytes(source_pins[:8])) == BASELINE_SOURCE_PINS_SHA256,
        "baseline source pin prefix drift",
    )
    expected_source_specs = _expected_source_specs()
    for offset in range(len(expected_source_specs)):
        index = offset + 1
        value = source_pins[8 + offset]
        spec_value = expected_source_specs[offset]
        pin = _exact_dict(value, f"new source pin {index}")
        _exact_keys(
            pin,
            {
                "acceptanceRowSha256",
                "artifact",
                "bindingId",
                "consumerScope",
                "economicContribution",
                "limitations",
                "recordId",
                "status",
            },
            f"new source pin {index}",
        )
        _require(pin["bindingId"] == spec_value["bindingId"], "source binding ID")
        _require(
            pin["consumerScope"] == spec_value["consumerScope"],
            "source consumer scope",
        )
        _require(pin["recordId"] == spec_value["recordId"], "source record ID")
        _require(pin["acceptanceRowSha256"] == ROW_SHA256[pin["recordId"]], "source row")
        _require(pin["economicContribution"] == "NONE", "source economic contribution")
        _require(pin["status"] == "ACCEPTED_SOURCE_ONLY", "source status")
        _require(pin["limitations"] == list(DQ_LIMITATIONS[pin["bindingId"]]), "source limits")
        artifact_pin = _exact_dict(pin["artifact"], "source artifact")
        _validate_artifact_pin(artifact_pin, "source artifact")
        _require(artifact_pin["path"] == spec_value["path"], "source path")
        _require(
            artifact_pin["producerCommit"] == spec_value["producerCommit"],
            "source commit",
        )
        _require(
            artifact_pin["producerTree"] == spec_value["producerTree"],
            "source tree",
        )
        _require(
            artifact_pin["rawSha256"] == spec_value["rawSha256"],
            "source bytes",
        )

    _require(
        _sha256(_canonical_bytes(registry["legacyAcceptedExcluded"]))
        == BASELINE_LEGACY_EXCLUSIONS_SHA256,
        "legacy exclusions drift",
    )
    _require(
        _sha256(_canonical_bytes(registry["truthPolicy"])) == BASELINE_TRUTH_POLICY_SHA256,
        "truth policy drift",
    )
    _validate_pending_registry(registry["pendingInputs"])

    expected_summary = {
        "acceptedCrediblePositiveCount": 0,
        "acceptedFamilyCount": EXPECTED_COMBINED_FAMILY_COUNT,
        "acceptedOriginCount": EXPECTED_COMBINED_ORIGIN_COUNT,
        "acceptedSinceN3S2EconomicConsumedCount": 1,
        "activeProfitabilityTaskCount": 1,
        "capitalAuthority": "NONE",
        "completeFamilyUniverse": False,
        "crediblePositiveCount": None,
        "currentProfitabilityVerdict": "UNKNOWN",
        "familyDeduplicationState": "EXACT_FOR_ACCEPTED_ORIGINS_ONLY",
        "legacyAcceptedExcludedCount": 13,
        "localVerdictCounts": EXPECTED_LOCAL_VERDICT_COUNTS,
        "moneyUsd": 0,
        "newSourceOnlyBindingCount": 5,
        "owner1000FundingVerdict": "NO",
        "positiveEdgeClaim": "NOT_MADE",
        "postVG31AcceptedEconomicConsumedCount": EXPECTED_POST_VG31_ECONOMIC_COUNT,
        "recommendation": "NONE",
        "requiredTruthCount": len(REQUIRED_TRUTH_CODES),
        "selectedReceiptCount": len(SELECTED_RECORD_IDS),
        "terminalPendingCount": 0,
        "verifiedPositiveCount": 0,
    }
    _require(registry["summary"] == expected_summary, "summary drift")
    _require(
        _sha256(render_owner_card(registry).encode("utf-8")) == card_hash,
        "owner card hash drift",
    )


def verify_spec_binding(registry: Mapping[str, Any], spec: dict[str, Any]) -> None:
    _validate_spec(spec)
    _require(
        registry["originSpecCanonicalSha256"] == _sha256(_canonical_bytes(spec)),
        "origin spec binding drift",
    )


def _compare_pin(actual: Mapping[str, Any], expected: Mapping[str, Any], label: str) -> None:
    _require(dict(actual) == dict(expected), f"{label}: live Git pin drift")


def verify_git_pins(registry: Mapping[str, Any], repo: Path) -> None:
    baseline = _exact_dict(registry["baseline"], "registry.baseline")
    for value in _exact_list(baseline["artifacts"], "baseline artifacts"):
        pin = _exact_dict(value, "baseline artifact")
        live = _pin_artifact(
            repo,
            _exact_str(pin["producerCommit"], "baseline commit"),
            _exact_str(pin["producerTree"], "baseline tree"),
            _exact_str(pin["path"], "baseline path"),
        )
        expected = {key: value for key, value in pin.items() if key != "name"}
        _compare_pin(live, expected, f"baseline {pin['name']}")
    origin = _exact_dict(_exact_list(registry["origins"], "origins")[-1], "V-G10 origin")
    for field in ("artifact",):
        pin = _exact_dict(origin[field], f"V-G10 {field}")
        live = _pin_artifact(repo, V_G10_COMMIT, V_G10_TREE, _exact_str(pin["path"], "V-G10 path"))
        _compare_pin(live, pin, f"V-G10 {field}")
    family = _exact_dict(origin["familyIdentity"], "V-G10 family")
    protocol = _exact_dict(family["protocolArtifact"], "V-G10 protocol")
    live_protocol = _pin_artifact(repo, V_G10_COMMIT, V_G10_TREE, V_G10_PROTOCOL_PATH)
    _compare_pin(live_protocol, protocol, "V-G10 protocol")
    for value in _exact_list(registry["sourceOnlyPins"], "source pins")[8:]:
        source = _exact_dict(value, "new source pin")
        pin = _exact_dict(source["artifact"], "new source artifact")
        live = _pin_artifact(
            repo,
            _exact_str(pin["producerCommit"], "source commit"),
            _exact_str(pin["producerTree"], "source tree"),
            _exact_str(pin["path"], "source path"),
        )
        _compare_pin(live, pin, f"source {source['bindingId']}")


def verify_run_receipts(registry: Mapping[str, Any], run_raw: bytes) -> None:
    extracted, positions = _extract_rows(run_raw, (PRIOR_LEDGER_RECORD_ID, *SELECTED_RECORD_IDS))
    _require(
        extracted[PRIOR_LEDGER_RECORD_ID]["rowSha256"] == PRIOR_LEDGER_ROW_SHA256,
        "prior boundary live row drift",
    )
    _validate_selected_order(positions)
    receipts = _exact_list(registry["ledgerReceipts"], "registry.ledgerReceipts")
    _require(len(receipts) == len(SELECTED_RECORD_IDS), "receipt count")
    for receipt in receipts:
        item = _exact_dict(receipt, "registry receipt")
        record_id = _exact_str(item["recordId"], "receipt record")
        _require(
            extracted[record_id]
            == {
                key: item[key]
                for key in ("authority", "recordId", "rowByteLength", "rowSha256", "rowUtf8")
            },
            f"{record_id}: live receipt drift",
        )


def _write_outputs(registry: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "current_profitability_registry.v3.json").write_bytes(_canonical_bytes(registry))
    (output_dir / "owner_verdict_card.v3.md").write_text(
        render_owner_card(registry), encoding="utf-8"
    )


def _verify_files(
    registry_path: Path,
    card_path: Path,
    spec: dict[str, Any],
    run_raw: bytes,
    repo: Path,
) -> None:
    registry_raw = registry_path.read_bytes()
    registry = _load_json_bytes(registry_raw, str(registry_path))
    _require(registry_raw == _canonical_bytes(registry), "registry is not canonical JSON")
    validate_registry(registry)
    verify_spec_binding(registry, spec)
    verify_git_pins(registry, repo)
    verify_run_receipts(registry, run_raw)
    expected_card = render_owner_card(registry).encode("utf-8")
    _require(card_path.read_bytes() == expected_card, "owner card bytes drift")


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
            registry = freeze_registry(spec, run_raw, args.repo)
            _write_outputs(registry, args.output_dir)
        else:
            _require(args.output_dir is None, "verify does not accept --output-dir")
            _require(args.registry is not None, "verify requires --registry")
            _require(args.card is not None, "verify requires --card")
            _verify_files(args.registry, args.card, spec, run_raw, args.repo)
    except (ContractError, OSError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
