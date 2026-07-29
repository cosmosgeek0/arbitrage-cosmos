#!/usr/bin/env python3
"""Freeze and verify the N3-S1 profitability convergence registry.

The freeze command consumes only explicit inputs: one frozen origin spec, one
orchestrator run ledger, and one Git object database. Verification is offline
and deterministic. No network, clock, environment, provider, private API, or
money capability is used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any, Literal, cast, overload

SCHEMA = "N3S1ProfitabilityConvergenceV1"
SPEC_SCHEMA = "N3S1OriginSpecV1"
CANONICAL_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
CANONICAL_TREE = "37d1b88aa7c8d9ee1f70dc35d0e78613b6ed32f9"
CUTOFF_RECORD_ID = "2026-07-29 ORCHESTRATOR V-G26 ACCEPTANCE"
CUTOFF_ROW_SHA256 = "9cdbb8ee0e3cf40dbc9deef232a3ec7f4a29d8e32f658f0c331868c5bf21a718"
N3_BASELINE_COMMIT = "45fa1ac2a67fc782dad978a4ba3388ba1a2e03db"
N3_BASELINE_ROW_SHA256 = "ec3ff8d824e270843aa57e7daabe8db8942bb7ebbdadf1289588f8354b18e4db"
SMETA_ACCEPTED_FAMILY_ORDER = (
    "F01_BASIS_TRIGGER_HOLD",
    "F02_VOLUME_PROXY_THRESHOLD",
    "F03_SPOT_PMA_TREND",
    "F04_USDM_POST_FUNDING_CROWD_UNWIND",
    "F05_VOLUME_ACCEPTED_EXIT_REPLAY",
    "F06_USDM_FUNDING_DISPERSION",
    "F07_SPOT_LIQUIDITY_SHOCK_REVERSAL",
)
SMETA_ACCEPTED_FAMILIES = frozenset(SMETA_ACCEPTED_FAMILY_ORDER)
SMETA_ORIGIN_FAMILY_KEYS = {
    "E-1": "F01_BASIS_TRIGGER_HOLD",
    "BASIS-SUCCESSOR": "F01_BASIS_TRIGGER_HOLD",
    "VOLUME-CONDITIONAL-PROXY": "F02_VOLUME_PROXY_THRESHOLD",
    "S-1B": "F03_SPOT_PMA_TREND",
    "V-E1": "F05_VOLUME_ACCEPTED_EXIT_REPLAY",
    "S-1C": "F04_USDM_POST_FUNDING_CROWD_UNWIND",
    "S-1D": "F06_USDM_FUNDING_DISPERSION",
    "S-1E": "F07_SPOT_LIQUIDITY_SHOCK_REVERSAL",
}
REQUIRED_LIMITATIONS = {
    "V-G5": "MEASURED_PATH_REUSE_FORBIDDEN",
    "V-G11": "CURRENT_N3_INELIGIBLE",
    "V-G13": "EVALUATOR_REUSE_FORBIDDEN",
    "V-G26": "POSITIVE_POINT_ESTIMATE_NOT_CREDIBLE",
}
POST_CUTOFF_RECORD_IDS = (
    "2026-07-29 ORCHESTRATOR V-G14 ACCEPTANCE",
    "2026-07-29 ORCHESTRATOR V-G15 ACCEPTANCE",
    "2026-07-29 ORCHESTRATOR V-G24 ACCEPTANCE",
    "2026-07-29 ORCHESTRATOR V-G16 ACCEPTANCE",
    "2026-07-29 ORCHESTRATOR V-G18 ACCEPTANCE",
    "2026-07-29 ORCHESTRATOR V-G21 ACCEPTANCE",
    "2026-07-29 ORCHESTRATOR V-G22 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR V-G29 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR S-1P DURABILITY ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR S-1U ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR V-G25 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR V-G30 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR V-G31 ACCEPTANCE",
)
EXPECTED_ORIGIN_IDS = (
    "E-1",
    "BASIS-SUCCESSOR",
    "VOLUME-CONDITIONAL-PROXY",
    "S-1B",
    "V-E1",
    "S-1C",
    "S-1D",
    "S-1E",
    "S-1F",
    "S-1G",
    "S-1H",
    "S-1I",
    "S-1J",
    "S-1K",
    "S-1L",
    "S-1M",
    "S-1N",
    "S-1O",
    "S-1Q",
    "S-1R",
    "S-1S",
    "V-G2",
    "V-G3",
    "V-G4",
    "V-G5",
    "V-G6",
    "V-G7",
    "V-G8",
    "V-G9",
    "V-G11",
    "V-G13",
    "V-G17",
    "V-G19",
    "V-G20",
    "V-G23",
    "V-G26",
)
PENDING_ACTIVE_IDS = ("V-G1", "V-G10", "V-G12", "S-1T", "S-1V")
PENDING_ACCEPTANCE_IDS: tuple[str, ...] = ()
OUTSIDE_CUTOFF_PENDING_IDS = (
    "S-1W",
    "V-G27",
    "V-G28",
    "V-G32",
    "V-G33",
    "V-G34",
    "V-G35",
    "V-G36",
    "V-G37",
    "V-G38",
)
REQUIRED_TRUTH_CODES = (
    "ACCEPTED_PRE_OUTCOME_FAMILY_ALIAS_REGISTRY",
    "COMPLETE_GLOBAL_ATTEMPT_LEDGER",
    "SANITIZED_ACCOUNT_EFFECTIVE_FEES",
    "EXECUTABLE_CAPACITY_AND_EXECUTION_PROOF",
    "COMPLETE_MARKED_EQUITY_PATHS",
    "SINGLE_FRESH_HOLDOUT_RECEIPT_IF_A_WINNER_EMERGES",
)
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
SAFE_PATH = re.compile(r"^[a-zA-Z0-9._/-]+$")
FULL_IDENTIFIER = re.compile(r"(?<![0-9a-f])[0-9a-f]{40,64}(?![0-9a-f])")


class ContractError(ValueError):
    """Raised when frozen evidence violates the registry contract."""


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
    actual = set(value)
    _require(actual == expected, f"{label}: keys mismatch")


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        + b"\n"
    )


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_reject_duplicate_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError(f"{path.name}: invalid JSON") from exc
    return _exact_dict(value, path.name)


@overload
def _git(repo: Path, args: Sequence[str], *, text: Literal[False] = False) -> bytes: ...


@overload
def _git(repo: Path, args: Sequence[str], *, text: Literal[True]) -> str: ...


def _git(repo: Path, args: Sequence[str], *, text: bool = False) -> bytes | str:
    command = ["git", "-c", "core.quotepath=false", "-C", str(repo), *args]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=text,
    )
    if completed.returncode != 0:
        _fail(f"git command failed: {' '.join(args)}")
    if text:
        return _exact_str(completed.stdout, "git text output")
    _require(type(completed.stdout) is bytes, "git byte output expected")
    return cast(bytes, completed.stdout)


def _verify_commit_tree(repo: Path, commit: str, expected_tree: str) -> None:
    _require(bool(HEX40.fullmatch(commit)), "producer commit must be a full Git OID")
    _require(bool(HEX40.fullmatch(expected_tree)), "producer tree must be a full Git OID")
    object_type = _exact_str(
        _git(repo, ["cat-file", "-t", commit], text=True), "git object type"
    ).strip()
    _require(object_type == "commit", f"{commit}: not a commit")
    actual_tree = _exact_str(
        _git(repo, ["show", "-s", "--format=%T", commit], text=True), "git tree"
    ).strip()
    _require(actual_tree == expected_tree, f"{commit}: tree mismatch")


def _pin_artifact(repo: Path, commit: str, tree: str, relative_path: str) -> dict[str, Any]:
    _verify_commit_tree(repo, commit, tree)
    _require(type(relative_path) is str and bool(relative_path), "artifact path missing")
    _require(bool(SAFE_PATH.fullmatch(relative_path)), "artifact path has unsafe bytes")
    _require(not relative_path.startswith("/"), "artifact path must be relative")
    _require(".." not in relative_path.split("/"), "artifact path traversal")
    listing = _git(repo, ["ls-tree", "-z", commit, "--", relative_path])
    _require(type(listing) is bytes, "git ls-tree returned text")
    entries = [entry for entry in listing.split(b"\0") if entry]
    _require(len(entries) == 1, f"{relative_path}: expected one Git entry")
    try:
        metadata, encoded_path = entries[0].split(b"\t", 1)
        mode, object_type, oid = metadata.decode("ascii").split(" ")
        decoded_path = encoded_path.decode("utf-8")
    except (ValueError, UnicodeDecodeError) as exc:
        raise ContractError(f"{relative_path}: malformed Git entry") from exc
    _require(decoded_path == relative_path, f"{relative_path}: path mismatch")
    _require(mode == "100644", f"{relative_path}: non-ordinary mode")
    _require(object_type == "blob", f"{relative_path}: non-blob object")
    _require(bool(HEX40.fullmatch(oid)), f"{relative_path}: invalid blob OID")
    raw = _git(repo, ["cat-file", "blob", oid])
    _require(type(raw) is bytes, "git cat-file returned text")
    return {
        "byteLength": len(raw),
        "gitBlob": oid,
        "mode": mode,
        "path": relative_path,
        "producerCommit": commit,
        "producerTree": tree,
        "rawSha256": _sha256(raw),
    }


def _protocol_path(origin_id: str) -> str:
    slug = origin_id.lower().replace("-", "")
    _require(bool(re.fullmatch(r"(?:s1[a-z]|vg[0-9]{1,2})", slug)), "bad protocol slug")
    return f"quant/research/{slug}/protocol.v1.json"


def _extract_rows(
    run_raw: bytes, record_ids: Iterable[str]
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    lines = run_raw.splitlines(keepends=True)
    receipts: dict[str, dict[str, Any]] = {}
    positions: dict[str, int] = {}
    for record_id in record_ids:
        encoded = record_id.encode("utf-8")
        matches = [(index, line) for index, line in enumerate(lines) if encoded in line]
        _require(len(matches) == 1, f"{record_id}: expected one acceptance row")
        index, row = matches[0]
        _require(row.endswith(b"\n"), f"{record_id}: acceptance row lacks LF")
        _require(row.startswith(b"- "), f"{record_id}: row is not a Markdown bullet")
        _require(b"ORCHESTRATOR" in row and b"ACCEPTANCE" in row, f"{record_id}: bad authority")
        try:
            row_utf8 = row.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ContractError(f"{record_id}: non-UTF-8 row") from exc
        receipts[record_id] = {
            "authority": "ORCHESTRATOR_RUN_MD",
            "recordId": record_id,
            "rowByteLength": len(row),
            "rowSha256": _sha256(row),
            "rowUtf8": row_utf8,
        }
        positions[record_id] = index
    return receipts, positions


def _validate_spec(spec: dict[str, Any]) -> None:
    _exact_keys(
        spec,
        {
            "aggregateBindings",
            "canonicalOrigin",
            "cutoff",
            "origins",
            "pendingInputs",
            "postCutoffAcceptedExcluded",
            "schema",
            "version",
        },
        "spec",
    )
    _require(_exact_str(spec["schema"], "spec.schema") == SPEC_SCHEMA, "bad spec schema")
    _require(_exact_int(spec["version"], "spec.version") == 1, "bad spec version")
    canonical = _exact_dict(spec["canonicalOrigin"], "spec.canonicalOrigin")
    _exact_keys(canonical, {"commit", "tree"}, "spec.canonicalOrigin")
    _require(canonical["commit"] == CANONICAL_COMMIT, "spec canonical commit mismatch")
    _require(canonical["tree"] == CANONICAL_TREE, "spec canonical tree mismatch")
    cutoff = _exact_dict(spec["cutoff"], "spec.cutoff")
    _exact_keys(cutoff, {"recordId", "rowSha256"}, "spec.cutoff")
    _require(cutoff["recordId"] == CUTOFF_RECORD_ID, "spec cutoff record mismatch")
    _require(cutoff["rowSha256"] == CUTOFF_ROW_SHA256, "spec cutoff hash mismatch")

    aggregate_bindings = _exact_list(spec["aggregateBindings"], "spec.aggregateBindings")
    _require(len(aggregate_bindings) == 2, "spec aggregate binding count")
    aggregate_ids: list[str] = []
    for binding_any in aggregate_bindings:
        binding = _exact_dict(binding_any, "spec aggregate binding")
        _exact_keys(
            binding,
            {
                "bindingId",
                "expectedRowSha256",
                "path",
                "producerCommit",
                "producerTree",
                "recordId",
                "status",
            },
            "spec aggregate binding",
        )
        aggregate_ids.append(_exact_str(binding["bindingId"], "aggregate binding ID"))
        _require(
            bool(HEX64.fullmatch(_exact_str(binding["expectedRowSha256"], "aggregate row hash"))),
            "bad aggregate row hash",
        )
        _require(
            bool(
                HEX40.fullmatch(_exact_str(binding["producerCommit"], "aggregate producer commit"))
            ),
            "bad aggregate producer commit",
        )
        _require(
            bool(HEX40.fullmatch(_exact_str(binding["producerTree"], "aggregate producer tree"))),
            "bad aggregate producer tree",
        )
        _exact_str(binding["recordId"], "aggregate record ID")
        _exact_str(binding["path"], "aggregate path")
        _require(binding["status"] == "ACCEPTED_SOURCE_ONLY", "aggregate status inflation")
    _require(
        tuple(aggregate_ids) == ("S-META1", "N3-BASELINE"),
        "spec aggregate identity/order drift",
    )

    origins = _exact_list(spec["origins"], "spec.origins")
    _require(len(origins) == 36, "spec must contain 36 cutoff origins")
    origin_ids: list[str] = []
    for index, item_any in enumerate(origins, start=1):
        item = _exact_dict(item_any, f"spec.origins[{index}]")
        _exact_keys(
            item,
            {
                "custodyState",
                "familyKey",
                "limitations",
                "normalizedVerdict",
                "originId",
                "path",
                "producerCommit",
                "producerTree",
                "recordId",
                "sourceVerdict",
            },
            f"spec.origins[{index}]",
        )
        origin_id = _exact_str(item["originId"], f"origin {index} id")
        origin_ids.append(origin_id)
        family_key = _exact_str(item["familyKey"], f"{origin_id}.familyKey")
        expected_smeta_family = SMETA_ORIGIN_FAMILY_KEYS.get(origin_id)
        if expected_smeta_family is not None:
            _require(
                family_key == expected_smeta_family,
                f"{origin_id}: S-META1 family mapping drift",
            )
        _exact_str(item["recordId"], f"{origin_id}.recordId")
        _exact_str(item["custodyState"], f"{origin_id}.custodyState")
        verdict = _exact_str(item["normalizedVerdict"], f"{origin_id}.normalizedVerdict")
        _require(verdict in {"NO_GO", "UNMEASURED"}, f"{origin_id}: bad verdict")
        _exact_str(item["sourceVerdict"], f"{origin_id}.sourceVerdict")
        limitations = _exact_list(item["limitations"], f"{origin_id}.limitations")
        _require(bool(limitations), f"{origin_id}: empty limitations")
        for limitation in limitations:
            _exact_str(limitation, f"{origin_id}.limitation")
        _require(len(limitations) == len(set(limitations)), f"{origin_id}: duplicate limitation")
        commit = item["producerCommit"]
        tree = item["producerTree"]
        path = item["path"]
        if commit is None:
            _require(tree is None and path is None, f"{origin_id}: partial receipt-only pin")
        else:
            _require(
                type(commit) is str and bool(HEX40.fullmatch(commit)),
                f"{origin_id}: bad commit",
            )
            _require(
                type(tree) is str and bool(HEX40.fullmatch(tree)),
                f"{origin_id}: bad tree",
            )
            if path is not None:
                _exact_str(path, f"{origin_id}.path")
        if item["custodyState"] == "ACCEPTED_RECEIPT_ONLY":
            _require(path is None, f"{origin_id}: receipt-only origin has artifact")
        else:
            _require(
                type(path) is str and bool(path),
                f"{origin_id}: result artifact absent",
            )
    _require(tuple(origin_ids) == EXPECTED_ORIGIN_IDS, "origin allowlist/order drift")
    _require(set(REQUIRED_LIMITATIONS).issubset(origin_ids), "required origins absent")
    excluded = _exact_list(spec["postCutoffAcceptedExcluded"], "spec.postCutoffAcceptedExcluded")
    for record_id in excluded:
        _exact_str(record_id, "post-cutoff excluded record")
    _require(
        tuple(excluded) == POST_CUTOFF_RECORD_IDS,
        "post-cutoff exclusions mismatch",
    )


def _build_family_rollups(origins: list[dict[str, Any]]) -> list[dict[str, Any]]:
    observed_order: list[str] = []
    grouped: dict[str, list[dict[str, Any]]] = {}
    for origin in origins:
        key = origin["familyIdentity"]["key"]
        if key not in grouped:
            grouped[key] = []
            observed_order.append(key)
        grouped[key].append(origin)
    order = [
        *[key for key in SMETA_ACCEPTED_FAMILY_ORDER if key in grouped],
        *[key for key in observed_order if key not in SMETA_ACCEPTED_FAMILIES],
    ]
    families: list[dict[str, Any]] = []
    for ordinal, key in enumerate(order, start=1):
        members = grouped[key]
        identity_states = {member["familyIdentity"]["state"] for member in members}
        _require(len(identity_states) == 1, f"{key}: mixed identity states")
        verdicts = {member["normalizedVerdict"] for member in members}
        _require(len(verdicts) == 1, f"{key}: conflicting accepted verdicts")
        families.append(
            {
                "effectiveProgramWideP": {"denominator": 1, "numerator": 1},
                "familyKey": key,
                "identityState": next(iter(identity_states)),
                "normalizedVerdict": next(iter(verdicts)),
                "ordinal": ordinal,
                "originCount": len(members),
                "originIds": [member["originId"] for member in members],
                "verifiedPositive": False,
            }
        )
    return families


def _pending_output(spec_pending: dict[str, Any]) -> dict[str, Any]:
    _exact_keys(
        spec_pending,
        {
            "activeUnpublishedWithinCutoff",
            "awaitingAcceptanceWithinCutoff",
            "outsideCutoffExcluded",
            "requiredTruth",
        },
        "spec.pendingInputs",
    )

    def tasks(
        name: str,
        state: str,
        in_cutoff: bool,
        expected_ids: tuple[str, ...],
    ) -> list[dict[str, Any]]:
        rows = _exact_list(spec_pending[name], f"spec.pendingInputs.{name}")
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item_any in rows:
            item = _exact_dict(item_any, f"pending {name}")
            _exact_keys(item, {"milestoneId", "taskRefSuffix"}, f"pending {name}")
            milestone = _exact_str(item["milestoneId"], "pending milestone")
            suffix = _exact_str(item["taskRefSuffix"], "pending suffix")
            _require(bool(re.fullmatch(r"[0-9a-f]{4}", suffix)), "bad task suffix")
            _require(milestone not in seen, f"duplicate pending milestone {milestone}")
            seen.add(milestone)
            result.append(
                {
                    "evidenceState": state,
                    "inCutoffScope": in_cutoff,
                    "milestoneId": milestone,
                    "outcomeBytesInspected": False,
                    "taskRefIsEvidence": False,
                    "taskRefSuffix": suffix,
                }
            )
        _require(
            tuple(item["milestoneId"] for item in result) == expected_ids,
            f"pending {name} allowlist/order drift",
        )
        return result

    required = _exact_list(spec_pending["requiredTruth"], "pending required truth")
    required_out: list[dict[str, Any]] = []
    seen_required: set[str] = set()
    for code_any in required:
        code = _exact_str(code_any, "pending truth code")
        _require(code not in seen_required, f"duplicate required truth {code}")
        seen_required.add(code)
        required_out.append({"code": code, "state": "PENDING"})
    _require(
        tuple(item["code"] for item in required_out) == REQUIRED_TRUTH_CODES,
        "required truth allowlist/order drift",
    )
    return {
        "activeUnpublishedWithinCutoff": tasks(
            "activeUnpublishedWithinCutoff",
            "ACTIVE_UNPUBLISHED",
            True,
            PENDING_ACTIVE_IDS,
        ),
        "awaitingAcceptanceWithinCutoff": tasks(
            "awaitingAcceptanceWithinCutoff",
            "AWAITING_ORCHESTRATOR_ACCEPTANCE",
            True,
            PENDING_ACCEPTANCE_IDS,
        ),
        "outsideCutoffExcluded": tasks(
            "outsideCutoffExcluded",
            "OUTSIDE_CUTOFF_EXCLUDED",
            False,
            OUTSIDE_CUTOFF_PENDING_IDS,
        ),
        "requiredTruth": required_out,
    }


def freeze_registry(spec: dict[str, Any], run_raw: bytes, repo: Path) -> dict[str, Any]:
    _validate_spec(spec)
    origins_spec = _exact_list(spec["origins"], "spec.origins")
    aggregate_spec = _exact_list(spec["aggregateBindings"], "spec.aggregateBindings")
    included_record_ids: list[str] = []
    for binding_any in aggregate_spec:
        binding = _exact_dict(binding_any, "aggregate binding")
        included_record_ids.append(_exact_str(binding["recordId"], "aggregate recordId"))
    for origin_any in origins_spec:
        origin = _exact_dict(origin_any, "origin")
        included_record_ids.append(_exact_str(origin["recordId"], "origin recordId"))
    unique_included = list(dict.fromkeys(included_record_ids))
    all_record_ids = [*unique_included, *POST_CUTOFF_RECORD_IDS]
    receipts, positions = _extract_rows(run_raw, all_record_ids)
    cutoff_position = positions[CUTOFF_RECORD_ID]
    _require(receipts[CUTOFF_RECORD_ID]["rowSha256"] == CUTOFF_ROW_SHA256, "cutoff drift")
    for record_id in unique_included:
        _require(
            positions[record_id] >= cutoff_position,
            f"{record_id}: accepted after the V-G26 cutoff",
        )
    for record_id in POST_CUTOFF_RECORD_IDS:
        _require(
            positions[record_id] < cutoff_position,
            f"{record_id}: expected post-cutoff acceptance",
        )

    aggregate_bindings: list[dict[str, Any]] = []
    for binding_any in aggregate_spec:
        binding = _exact_dict(binding_any, "aggregate binding")
        expected_row = _exact_str(binding["expectedRowSha256"], "aggregate row hash")
        record_id = _exact_str(binding["recordId"], "aggregate record")
        _require(receipts[record_id]["rowSha256"] == expected_row, f"{record_id}: row drift")
        artifact = _pin_artifact(
            repo,
            _exact_str(binding["producerCommit"], "aggregate commit"),
            _exact_str(binding["producerTree"], "aggregate tree"),
            _exact_str(binding["path"], "aggregate path"),
        )
        aggregate_bindings.append(
            {
                "acceptanceRowSha256": expected_row,
                "artifact": artifact,
                "bindingId": _exact_str(binding["bindingId"], "aggregate bindingId"),
                "recordId": record_id,
                "status": _exact_str(binding["status"], "aggregate status"),
            }
        )

    origins: list[dict[str, Any]] = []
    for ordinal, origin_any in enumerate(origins_spec, start=1):
        source = _exact_dict(origin_any, f"origin {ordinal}")
        origin_id = _exact_str(source["originId"], f"origin {ordinal} id")
        commit = source["producerCommit"]
        tree = source["producerTree"]
        path = source["path"]
        origin_artifact: dict[str, Any] | None = None
        if commit is not None:
            _verify_commit_tree(repo, commit, tree)
            if path is not None:
                origin_artifact = _pin_artifact(repo, commit, tree, path)
        family_key = _exact_str(source["familyKey"], f"{origin_id}.familyKey")
        if family_key in SMETA_ACCEPTED_FAMILIES:
            family_identity: dict[str, Any] = {
                "key": family_key,
                "protocolArtifact": None,
                "state": "ACCEPTED_SMETA1",
            }
        else:
            _require(commit is not None and tree is not None, f"{origin_id}: protocol pin absent")
            protocol = _pin_artifact(repo, commit, tree, _protocol_path(origin_id))
            family_identity = {
                "key": f"POST_SMETA1::{origin_id}::{protocol['rawSha256']}",
                "protocolArtifact": protocol,
                "state": "PROVISIONAL_POST_SMETA1",
            }
        origins.append(
            {
                "acceptanceRowSha256": receipts[source["recordId"]]["rowSha256"],
                "artifact": origin_artifact,
                "custodyState": _exact_str(source["custodyState"], f"{origin_id}.custody"),
                "familyIdentity": family_identity,
                "limitations": sorted(source["limitations"]),
                "normalizedVerdict": _exact_str(
                    source["normalizedVerdict"], f"{origin_id}.verdict"
                ),
                "ordinal": ordinal,
                "originId": origin_id,
                "producerCommit": commit,
                "producerTree": tree,
                "recordId": _exact_str(source["recordId"], f"{origin_id}.recordId"),
                "sourceVerdict": _exact_str(source["sourceVerdict"], f"{origin_id}.sourceVerdict"),
                "verifiedPositive": False,
            }
        )

    families = _build_family_rollups(origins)
    _require(len(origins) == 36, "origin count drift")
    _require(len(families) == 35, "accepted-family dedup count drift")
    verdict_counts = {
        verdict: sum(origin["normalizedVerdict"] == verdict for origin in origins)
        for verdict in ("NO_GO", "UNMEASURED")
    }
    pending = _pending_output(_exact_dict(spec["pendingInputs"], "spec.pendingInputs"))
    pending_within = len(pending["activeUnpublishedWithinCutoff"]) + len(
        pending["awaitingAcceptanceWithinCutoff"]
    )
    receipt_values = [receipts[record_id] for record_id in sorted(unique_included)]
    post_cutoff = [
        {
            "acceptanceRowSha256": receipts[record_id]["rowSha256"],
            "outcomeBytesConsumed": False,
            "reason": "POST_VG26_CUTOFF",
            "recordId": record_id,
        }
        for record_id in POST_CUTOFF_RECORD_IDS
    ]
    registry: dict[str, Any] = {
        "acceptanceReceipts": receipt_values,
        "aggregateBindings": aggregate_bindings,
        "canonicalOrigin": {
            "commit": CANONICAL_COMMIT,
            "tree": CANONICAL_TREE,
        },
        "cutoff": {
            "inclusive": True,
            "postCutoffOriginsConsumed": False,
            "producerCommit": origins[-1]["producerCommit"],
            "producerTree": origins[-1]["producerTree"],
            "recordId": CUTOFF_RECORD_ID,
            "resultArtifact": origins[-1]["artifact"],
            "rowSha256": CUTOFF_ROW_SHA256,
        },
        "families": families,
        "ledgerSnapshot": {
            "asOfRecordId": POST_CUTOFF_RECORD_IDS[-1],
            "asOfRowSha256": receipts[POST_CUTOFF_RECORD_IDS[-1]]["rowSha256"],
            "inclusive": True,
            "newerAcceptanceRowsConsumed": False,
        },
        "originSpecCanonicalSha256": _sha256(_canonical_bytes(spec)),
        "origins": origins,
        "pendingInputs": pending,
        "postCutoffAcceptedExcluded": post_cutoff,
        "schema": SCHEMA,
        "summary": {
            "acceptedCrediblePositiveCount": 0,
            "acceptedFamilyCount": len(families),
            "acceptedOriginCount": len(origins),
            "capitalAuthority": "NONE",
            "completeFamilyUniverse": False,
            "crediblePositiveCount": None,
            "currentProfitabilityVerdict": "UNKNOWN",
            "familyDeduplicationState": "EXACT_FOR_ACCEPTED_ORIGINS_ONLY",
            "localVerdictCounts": verdict_counts,
            "moneyUsd": 0,
            "owner1000FundingVerdict": "NO",
            "pendingTaskCountWithinCutoff": pending_within,
            "pendingTruthCount": len(pending["requiredTruth"]),
            "positiveEdgeClaim": "NOT_MADE",
            "postCutoffAcceptedExcludedCount": len(post_cutoff),
            "receiptOnlyOriginCount": sum(
                origin["custodyState"] == "ACCEPTED_RECEIPT_ONLY" for origin in origins
            ),
            "recommendation": "NONE",
            "verifiedPositiveCount": 0,
        },
        "truthPolicy": {
            "missingOutcomeBecomesZero": False,
            "pboMayOverrideMultiplicityOrIntervals": False,
            "positivePointEstimateMayQualify": False,
            "publicCapacityMaySubstituteForExecutableCapacity": False,
            "publicFeesMaySubstituteForAccountEffectiveFees": False,
            "unknownAndNullPreserved": True,
        },
        "version": 1,
    }
    card = render_owner_card(registry)
    registry["ownerCardRawSha256"] = _sha256(card.encode("utf-8"))
    validate_registry(registry)
    return registry


def render_owner_card(registry: Mapping[str, Any]) -> str:
    summary = _exact_dict(registry["summary"], "registry.summary")
    ledger_snapshot = _exact_dict(registry["ledgerSnapshot"], "registry.ledgerSnapshot")
    ledger_milestone = (
        _exact_str(ledger_snapshot["asOfRecordId"], "ledger as-of record")
        .split(" ORCHESTRATOR ", 1)[1]
        .split(" ", 1)[0]
    )
    aggregate_bindings = _exact_list(registry["aggregateBindings"], "registry.aggregateBindings")
    n3 = next(
        (
            binding
            for binding in aggregate_bindings
            if _exact_dict(binding, "aggregate binding")["bindingId"] == "N3-BASELINE"
        ),
        None,
    )
    n3_binding = _exact_dict(n3, "N3 baseline binding")
    n3_artifact = _exact_dict(n3_binding["artifact"], "N3 artifact")
    expected = (
        f"canonical …{CANONICAL_COMMIT[-4:]}/tree …{CANONICAL_TREE[-4:]} + "
        f"accepted N3 …{n3_artifact['producerCommit'][-4:]}/row "
        f"…{n3_binding['acceptanceRowSha256'][-4:]} + accepted evidence through "
        f"V-G26-row …{CUTOFF_ROW_SHA256[-4:]} → deterministic source-only scoreboard"
    )
    found = (
        f"origins={summary['acceptedOriginCount']}/{summary['acceptedOriginCount']}; "
        f"acceptedFamilies={summary['acceptedFamilyCount']}; "
        f"acceptedCrediblePositives={summary['acceptedCrediblePositiveCount']}; "
        "crediblePositiveCount=null; "
        "V-G26=NO_GO+POSITIVE_POINT_ESTIMATE_NOT_CREDIBLE; "
        f"pendingTasks={summary['pendingTaskCountWithinCutoff']}; "
        f"pendingTruth={summary['pendingTruthCount']}; "
        f"postCutoffAcceptedExcluded={summary['postCutoffAcceptedExcludedCount']}; "
        f"ledgerAsOf={ledger_milestone}-row "
        f"…{ledger_snapshot['asOfRowSha256'][-4:]}; "
        "globalProfitability=UNKNOWN; owner$1k=NO; positiveEdgeClaim=NOT_MADE; "
        "recommendation=NONE; authority=NONE; effects=NONE/$0"
    )
    card = (
        "- item=`N3-S1 PROFITABILITY CONVERGENCE`"
        f" | expected=`{expected}`"
        f" | found=`{found}`"
        " | status=`N3_S1_SOURCE_READY; PRESERVED_WAITING(final convergence); "
        "NOT_LANDED; STOP`\n"
    )
    _require(card.count("\n") == 1 and card.endswith("\n"), "card is not one line")
    _require(not FULL_IDENTIFIER.search(card), "card leaked a full identifier")
    _require(
        not any(token in card for token in ("/Users/", "Desktop/", "quant/", "research/")),
        "card leaked a path",
    )
    _require(len(card.encode("utf-8")) <= 1100, "card exceeds bounded length")
    return card


def _validate_artifact_pin(value: Any, label: str) -> None:
    pin = _exact_dict(value, label)
    _exact_keys(
        pin,
        {
            "byteLength",
            "gitBlob",
            "mode",
            "path",
            "producerCommit",
            "producerTree",
            "rawSha256",
        },
        label,
    )
    _require(_exact_int(pin["byteLength"], f"{label}.byteLength") >= 0, "negative size")
    _require(bool(HEX40.fullmatch(_exact_str(pin["gitBlob"], f"{label}.gitBlob"))), "bad blob")
    _require(pin["mode"] == "100644", f"{label}: bad mode")
    path = _exact_str(pin["path"], f"{label}.path")
    _require(bool(SAFE_PATH.fullmatch(path)) and not path.startswith("/"), f"{label}: bad path")
    _require(".." not in path.split("/"), f"{label}: path traversal")
    _require(
        bool(HEX40.fullmatch(_exact_str(pin["producerCommit"], f"{label}.commit"))),
        f"{label}: bad commit",
    )
    _require(
        bool(HEX40.fullmatch(_exact_str(pin["producerTree"], f"{label}.tree"))),
        f"{label}: bad tree",
    )
    _require(
        bool(HEX64.fullmatch(_exact_str(pin["rawSha256"], f"{label}.rawSha256"))),
        f"{label}: bad SHA-256",
    )


def validate_registry(registry_any: Any) -> None:
    registry = _exact_dict(registry_any, "registry")
    _exact_keys(
        registry,
        {
            "acceptanceReceipts",
            "aggregateBindings",
            "canonicalOrigin",
            "cutoff",
            "families",
            "ledgerSnapshot",
            "origins",
            "ownerCardRawSha256",
            "originSpecCanonicalSha256",
            "pendingInputs",
            "postCutoffAcceptedExcluded",
            "schema",
            "summary",
            "truthPolicy",
            "version",
        },
        "registry",
    )
    _require(_exact_str(registry["schema"], "registry.schema") == SCHEMA, "schema mismatch")
    _require(_exact_int(registry["version"], "registry.version") == 1, "version mismatch")
    _require(
        bool(
            HEX64.fullmatch(
                _exact_str(
                    registry["originSpecCanonicalSha256"],
                    "registry.originSpecCanonicalSha256",
                )
            )
        ),
        "bad origin-spec hash",
    )
    canonical = _exact_dict(registry["canonicalOrigin"], "registry.canonicalOrigin")
    _exact_keys(canonical, {"commit", "tree"}, "registry.canonicalOrigin")
    _require(
        _exact_str(canonical["commit"], "canonical commit") == CANONICAL_COMMIT
        and _exact_str(canonical["tree"], "canonical tree") == CANONICAL_TREE,
        "canonical origin mismatch",
    )
    cutoff = _exact_dict(registry["cutoff"], "registry.cutoff")
    _exact_keys(
        cutoff,
        {
            "inclusive",
            "postCutoffOriginsConsumed",
            "producerCommit",
            "producerTree",
            "recordId",
            "resultArtifact",
            "rowSha256",
        },
        "registry.cutoff",
    )
    _require(
        _exact_str(cutoff["recordId"], "cutoff record") == CUTOFF_RECORD_ID,
        "cutoff record mismatch",
    )
    _require(
        _exact_str(cutoff["rowSha256"], "cutoff row hash") == CUTOFF_ROW_SHA256,
        "cutoff row mismatch",
    )
    _require(_exact_bool(cutoff["inclusive"], "cutoff.inclusive"), "cutoff not inclusive")
    _require(
        _exact_bool(cutoff["postCutoffOriginsConsumed"], "cutoff.postCutoffOriginsConsumed")
        is False,
        "post-cutoff origin consumed",
    )
    _validate_artifact_pin(cutoff["resultArtifact"], "cutoff.resultArtifact")
    _require(
        _exact_str(cutoff["producerCommit"], "cutoff producer commit")
        == cutoff["resultArtifact"]["producerCommit"],
        "cutoff commit",
    )
    _require(
        _exact_str(cutoff["producerTree"], "cutoff producer tree")
        == cutoff["resultArtifact"]["producerTree"],
        "cutoff tree",
    )
    ledger_snapshot = _exact_dict(registry["ledgerSnapshot"], "registry.ledgerSnapshot")
    _exact_keys(
        ledger_snapshot,
        {
            "asOfRecordId",
            "asOfRowSha256",
            "inclusive",
            "newerAcceptanceRowsConsumed",
        },
        "registry.ledgerSnapshot",
    )
    _require(
        _exact_str(ledger_snapshot["asOfRecordId"], "ledger as-of record")
        == POST_CUTOFF_RECORD_IDS[-1],
        "ledger as-of record drift",
    )
    _require(
        bool(
            HEX64.fullmatch(_exact_str(ledger_snapshot["asOfRowSha256"], "ledger as-of row hash"))
        ),
        "bad ledger as-of row hash",
    )
    _require(
        _exact_bool(ledger_snapshot["inclusive"], "ledger snapshot inclusive"),
        "ledger snapshot must be inclusive",
    )
    _require(
        _exact_bool(
            ledger_snapshot["newerAcceptanceRowsConsumed"],
            "newer acceptance rows consumed",
        )
        is False,
        "newer acceptance rows consumed",
    )

    receipts = _exact_list(registry["acceptanceReceipts"], "registry.acceptanceReceipts")
    receipt_ids: list[str] = []
    receipt_hashes: dict[str, str] = {}
    for index, receipt_any in enumerate(receipts, start=1):
        receipt = _exact_dict(receipt_any, f"receipt {index}")
        _exact_keys(
            receipt,
            {"authority", "recordId", "rowByteLength", "rowSha256", "rowUtf8"},
            f"receipt {index}",
        )
        _require(
            _exact_str(receipt["authority"], "receipt authority") == "ORCHESTRATOR_RUN_MD",
            "receipt authority",
        )
        record_id = _exact_str(receipt["recordId"], "receipt recordId")
        row = _exact_str(receipt["rowUtf8"], "receipt row").encode("utf-8")
        _require(row.endswith(b"\n"), f"{record_id}: missing LF")
        _require(row.startswith(b"- "), f"{record_id}: receipt is not a Markdown bullet")
        _require(
            b"ORCHESTRATOR" in row and b"ACCEPTANCE" in row,
            f"{record_id}: receipt authority markers absent",
        )
        _require(len(row) == _exact_int(receipt["rowByteLength"], "receipt size"), "row size")
        row_hash = _exact_str(receipt["rowSha256"], "receipt hash")
        _require(bool(HEX64.fullmatch(row_hash)), "bad receipt hash")
        _require(_sha256(row) == row_hash, f"{record_id}: receipt hash mismatch")
        _require(record_id.encode("utf-8") in row, f"{record_id}: identity absent")
        receipt_ids.append(record_id)
        receipt_hashes[record_id] = row_hash
    _require(len(receipt_ids) == len(set(receipt_ids)), "duplicate acceptance receipt")
    _require(CUTOFF_RECORD_ID in receipt_hashes, "cutoff receipt absent")
    _require(receipt_hashes[CUTOFF_RECORD_ID] == CUTOFF_ROW_SHA256, "cutoff receipt drift")
    for excluded in POST_CUTOFF_RECORD_IDS:
        _require(excluded not in receipt_hashes, f"post-cutoff receipt consumed: {excluded}")

    aggregate_bindings = _exact_list(registry["aggregateBindings"], "registry.aggregateBindings")
    _require(len(aggregate_bindings) == 2, "aggregate binding count")
    binding_ids: list[str] = []
    for binding_any in aggregate_bindings:
        binding = _exact_dict(binding_any, "aggregate binding")
        _exact_keys(
            binding,
            {"acceptanceRowSha256", "artifact", "bindingId", "recordId", "status"},
            "aggregate binding",
        )
        binding_id = _exact_str(binding["bindingId"], "aggregate bindingId")
        binding_ids.append(binding_id)
        record_id = _exact_str(binding["recordId"], "aggregate recordId")
        _require(record_id in receipt_hashes, f"{binding_id}: receipt absent")
        _require(
            binding["acceptanceRowSha256"] == receipt_hashes[record_id],
            f"{binding_id}: receipt mismatch",
        )
        _require(
            _exact_str(binding["status"], "aggregate status") == "ACCEPTED_SOURCE_ONLY",
            "aggregate status inflation",
        )
        _validate_artifact_pin(binding["artifact"], f"{binding_id}.artifact")
    _require(set(binding_ids) == {"N3-BASELINE", "S-META1"}, "aggregate identities")
    n3_binding = next(item for item in aggregate_bindings if item["bindingId"] == "N3-BASELINE")
    _require(
        n3_binding["artifact"]["producerCommit"] == N3_BASELINE_COMMIT,
        "N3 baseline commit mismatch",
    )
    _require(
        n3_binding["acceptanceRowSha256"] == N3_BASELINE_ROW_SHA256,
        "N3 baseline acceptance mismatch",
    )

    origins = _exact_list(registry["origins"], "registry.origins")
    _require(len(origins) == 36, "registry origin count")
    origin_ids: list[str] = []
    artifact_identities: list[tuple[str, str, str]] = []
    for expected_ordinal, origin_any in enumerate(origins, start=1):
        origin = _exact_dict(origin_any, f"origin {expected_ordinal}")
        _exact_keys(
            origin,
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
            f"origin {expected_ordinal}",
        )
        _require(
            _exact_int(origin["ordinal"], "origin ordinal") == expected_ordinal,
            "origin ordinal gap",
        )
        origin_id = _exact_str(origin["originId"], "originId")
        origin_ids.append(origin_id)
        record_id = _exact_str(origin["recordId"], f"{origin_id}.recordId")
        _require(record_id in receipt_hashes, f"{origin_id}: receipt missing")
        _require(
            origin["acceptanceRowSha256"] == receipt_hashes[record_id],
            f"{origin_id}: receipt hash mismatch",
        )
        _require(
            _exact_str(origin["normalizedVerdict"], f"{origin_id}.verdict")
            in {"NO_GO", "UNMEASURED"},
            f"{origin_id}: invalid verdict",
        )
        _require(
            _exact_bool(origin["verifiedPositive"], f"{origin_id}.verifiedPositive") is False,
            f"{origin_id}: false positive inflation",
        )
        limitations = _exact_list(origin["limitations"], f"{origin_id}.limitations")
        for limitation in limitations:
            _exact_str(limitation, f"{origin_id}.limitation")
        _require(limitations == sorted(limitations), f"{origin_id}: limitation order")
        _require(len(limitations) == len(set(limitations)), f"{origin_id}: duplicate limitation")
        _exact_str(origin["sourceVerdict"], f"{origin_id}.sourceVerdict")
        required = REQUIRED_LIMITATIONS.get(origin_id)
        if required is not None:
            _require(required in limitations, f"{origin_id}: required limitation lost")
        custody = _exact_str(origin["custodyState"], f"{origin_id}.custody")
        expected_custody = (
            "ACCEPTED_RECEIPT_ONLY"
            if origin_id in {"E-1", "BASIS-SUCCESSOR", "VOLUME-CONDITIONAL-PROXY"}
            else (
                "ACCEPTED_VIA_F15_COMPOSITE" if origin_id in {"S-1E", "S-1F"} else "ACCEPTED_EXACT"
            )
        )
        _require(custody == expected_custody, f"{origin_id}: custody-state drift")
        producer_commit = origin["producerCommit"]
        producer_tree = origin["producerTree"]
        artifact = origin["artifact"]
        if custody == "ACCEPTED_RECEIPT_ONLY":
            _require(artifact is None, f"{origin_id}: receipt-only artifact present")
            if producer_commit is None:
                _require(
                    producer_tree is None,
                    f"{origin_id}: partial receipt-only producer pin",
                )
            else:
                _require(
                    type(producer_commit) is str and bool(HEX40.fullmatch(producer_commit)),
                    f"{origin_id}: bad producer commit",
                )
                _require(
                    type(producer_tree) is str and bool(HEX40.fullmatch(producer_tree)),
                    f"{origin_id}: bad producer tree",
                )
        else:
            _require(
                type(producer_commit) is str and bool(HEX40.fullmatch(producer_commit)),
                f"{origin_id}: bad producer commit",
            )
            _require(
                type(producer_tree) is str and bool(HEX40.fullmatch(producer_tree)),
                f"{origin_id}: bad producer tree",
            )
            _validate_artifact_pin(artifact, f"{origin_id}.artifact")
            _require(origin["producerCommit"] == artifact["producerCommit"], "producer commit")
            _require(origin["producerTree"] == artifact["producerTree"], "producer tree")
            artifact_identities.append(
                (artifact["producerCommit"], artifact["path"], artifact["rawSha256"])
            )
        family = _exact_dict(origin["familyIdentity"], f"{origin_id}.familyIdentity")
        _exact_keys(family, {"key", "protocolArtifact", "state"}, f"{origin_id}.familyIdentity")
        state = _exact_str(family["state"], f"{origin_id}.identityState")
        key = _exact_str(family["key"], f"{origin_id}.familyKey")
        if state == "ACCEPTED_SMETA1":
            _require(
                key == SMETA_ORIGIN_FAMILY_KEYS.get(origin_id),
                f"{origin_id}: S-META1 family mapping drift",
            )
            _require(family["protocolArtifact"] is None, f"{origin_id}: extra protocol pin")
        elif state == "PROVISIONAL_POST_SMETA1":
            protocol = _exact_dict(family["protocolArtifact"], f"{origin_id}.protocolArtifact")
            _validate_artifact_pin(protocol, f"{origin_id}.protocol")
            _require(
                protocol["producerCommit"] == producer_commit
                and protocol["producerTree"] == producer_tree,
                f"{origin_id}: protocol producer mismatch",
            )
            _require(
                protocol["path"] == _protocol_path(origin_id),
                f"{origin_id}: protocol path mismatch",
            )
            protocol_hash = protocol["rawSha256"]
            _require(
                key == f"POST_SMETA1::{origin_id}::{protocol_hash}",
                f"{origin_id}: provisional identity mismatch",
            )
        else:
            _fail(f"{origin_id}: invalid family identity state")
    _require(tuple(origin_ids) == EXPECTED_ORIGIN_IDS, "origin allowlist/order drift")
    expected_receipt_ids = sorted(
        {
            *(
                _exact_str(binding["recordId"], "aggregate binding record")
                for binding in aggregate_bindings
            ),
            *(_exact_str(origin["recordId"], "origin record") for origin in origins),
        }
    )
    _require(receipt_ids == expected_receipt_ids, "unreferenced or unordered receipt")
    _require(
        len(artifact_identities) == len(set(artifact_identities)),
        "duplicate economic result artifact",
    )
    vg26_origin = origins[-1]
    _require(vg26_origin["originId"] == "V-G26", "V-G26 absent")
    _require(
        cutoff["resultArtifact"] == vg26_origin["artifact"],
        "cutoff/result origin artifact drift",
    )
    _require(
        cutoff["producerCommit"] == vg26_origin["producerCommit"]
        and cutoff["producerTree"] == vg26_origin["producerTree"],
        "cutoff/result origin producer drift",
    )

    families = _exact_list(registry["families"], "registry.families")
    _require(len(families) == 35, "family dedup count")
    family_keys: list[str] = []
    rolled_origin_ids: list[str] = []
    for ordinal, family_any in enumerate(families, start=1):
        family = _exact_dict(family_any, f"family {ordinal}")
        _exact_keys(
            family,
            {
                "effectiveProgramWideP",
                "familyKey",
                "identityState",
                "normalizedVerdict",
                "ordinal",
                "originCount",
                "originIds",
                "verifiedPositive",
            },
            f"family {ordinal}",
        )
        _require(_exact_int(family["ordinal"], "family ordinal") == ordinal, "family ordinal")
        family_key = _exact_str(family["familyKey"], "family key")
        family_keys.append(family_key)
        members = _exact_list(family["originIds"], f"{family_key}.originIds")
        _require(bool(members), f"{family_key}: no origins")
        for member in members:
            rolled_origin_ids.append(_exact_str(member, f"{family_key}.originId"))
        _require(
            _exact_int(family["originCount"], f"{family_key}.originCount") == len(members),
            f"{family_key}: origin count mismatch",
        )
        effective_p = _exact_dict(
            family["effectiveProgramWideP"], f"{family_key}.effectiveProgramWideP"
        )
        _exact_keys(
            effective_p,
            {"denominator", "numerator"},
            f"{family_key}.effectiveProgramWideP",
        )
        _require(
            _exact_int(effective_p["denominator"], f"{family_key}.p denominator") == 1
            and _exact_int(effective_p["numerator"], f"{family_key}.p numerator") == 1,
            f"{family_key}: effective p must be one",
        )
        _require(
            _exact_bool(family["verifiedPositive"], f"{family_key}.positive") is False,
            f"{family_key}: family positive inflation",
        )
        identity_state = _exact_str(family["identityState"], f"{family_key}.identityState")
        expected_identity_state = (
            "ACCEPTED_SMETA1"
            if family_key in SMETA_ACCEPTED_FAMILIES
            else "PROVISIONAL_POST_SMETA1"
        )
        _require(
            identity_state == expected_identity_state,
            f"{family_key}: rollup identity-state drift",
        )
        _require(
            _exact_str(family["normalizedVerdict"], f"{family_key}.verdict")
            in {"NO_GO", "UNMEASURED"},
            f"{family_key}: rollup verdict invalid",
        )
    _require(len(family_keys) == len(set(family_keys)), "duplicate family key")
    _require(
        tuple(family_keys[: len(SMETA_ACCEPTED_FAMILY_ORDER)]) == SMETA_ACCEPTED_FAMILY_ORDER,
        "S-META1 canonical family order drift",
    )
    _require(sorted(rolled_origin_ids) == sorted(origin_ids), "family/origin coverage mismatch")
    _require(families == _build_family_rollups(origins), "family rollup drift")

    summary = _exact_dict(registry["summary"], "registry.summary")
    _exact_keys(
        summary,
        {
            "acceptedCrediblePositiveCount",
            "acceptedFamilyCount",
            "acceptedOriginCount",
            "capitalAuthority",
            "completeFamilyUniverse",
            "crediblePositiveCount",
            "currentProfitabilityVerdict",
            "familyDeduplicationState",
            "localVerdictCounts",
            "moneyUsd",
            "owner1000FundingVerdict",
            "pendingTaskCountWithinCutoff",
            "pendingTruthCount",
            "positiveEdgeClaim",
            "postCutoffAcceptedExcludedCount",
            "receiptOnlyOriginCount",
            "recommendation",
            "verifiedPositiveCount",
        },
        "registry.summary",
    )
    _require(_exact_int(summary["acceptedOriginCount"], "summary origin count") == 36, "summary")
    _require(_exact_int(summary["acceptedFamilyCount"], "summary family count") == 35, "summary")
    _require(
        _exact_int(summary["acceptedCrediblePositiveCount"], "accepted positive count") == 0,
        "accepted positive count inflation",
    )
    _require(summary["crediblePositiveCount"] is None, "global credible count must be null")
    _require(
        _exact_int(summary["verifiedPositiveCount"], "verified positive count") == 0,
        "verified positive count inflation",
    )
    _require(
        _exact_str(summary["currentProfitabilityVerdict"], "global verdict") == "UNKNOWN",
        "global verdict inflation",
    )
    _require(
        _exact_str(summary["owner1000FundingVerdict"], "owner funding verdict") == "NO",
        "owner funding verdict inflation",
    )
    _require(
        _exact_str(summary["positiveEdgeClaim"], "positive edge claim") == "NOT_MADE",
        "positive edge claim inflation",
    )
    _require(
        _exact_str(summary["recommendation"], "recommendation") == "NONE",
        "recommendation inflation",
    )
    _require(
        _exact_str(summary["capitalAuthority"], "capital authority") == "NONE",
        "authority inflation",
    )
    _require(_exact_int(summary["moneyUsd"], "moneyUsd") == 0, "money effect")
    _require(
        _exact_bool(summary["completeFamilyUniverse"], "complete family universe") is False,
        "family universe inflation",
    )
    _require(
        _exact_str(summary["familyDeduplicationState"], "family deduplication state")
        == "EXACT_FOR_ACCEPTED_ORIGINS_ONLY",
        "dedup state inflation",
    )
    local_verdict_counts = _exact_dict(summary["localVerdictCounts"], "summary.localVerdictCounts")
    _exact_keys(
        local_verdict_counts,
        {"NO_GO", "UNMEASURED"},
        "summary.localVerdictCounts",
    )
    _require(
        _exact_int(local_verdict_counts["NO_GO"], "NO_GO count")
        + _exact_int(local_verdict_counts["UNMEASURED"], "UNMEASURED count")
        == 36,
        "verdict count",
    )
    _require(
        local_verdict_counts
        == {
            verdict: sum(origin["normalizedVerdict"] == verdict for origin in origins)
            for verdict in ("NO_GO", "UNMEASURED")
        },
        "local verdict count drift",
    )
    _require(
        _exact_int(summary["pendingTaskCountWithinCutoff"], "pending task count") == 5,
        "pending count",
    )
    _require(_exact_int(summary["pendingTruthCount"], "pending truth count") == 6, "truth count")
    _require(
        _exact_int(summary["postCutoffAcceptedExcludedCount"], "post-cutoff count") == 13,
        "post-cutoff count",
    )
    _require(
        _exact_int(summary["receiptOnlyOriginCount"], "receipt-only count") == 3,
        "custody count",
    )

    pending = _exact_dict(registry["pendingInputs"], "registry.pendingInputs")
    _exact_keys(
        pending,
        {
            "activeUnpublishedWithinCutoff",
            "awaitingAcceptanceWithinCutoff",
            "outsideCutoffExcluded",
            "requiredTruth",
        },
        "registry.pendingInputs",
    )
    pending_ids: list[str] = []
    pending_contracts = (
        (
            "activeUnpublishedWithinCutoff",
            "ACTIVE_UNPUBLISHED",
            True,
            PENDING_ACTIVE_IDS,
        ),
        (
            "awaitingAcceptanceWithinCutoff",
            "AWAITING_ORCHESTRATOR_ACCEPTANCE",
            True,
            PENDING_ACCEPTANCE_IDS,
        ),
        (
            "outsideCutoffExcluded",
            "OUTSIDE_CUTOFF_EXCLUDED",
            False,
            OUTSIDE_CUTOFF_PENDING_IDS,
        ),
    )
    for category, expected_state, expected_in_cutoff, expected_ids in pending_contracts:
        category_ids: list[str] = []
        for task_any in _exact_list(pending[category], f"pending.{category}"):
            task = _exact_dict(task_any, f"pending.{category}")
            _exact_keys(
                task,
                {
                    "evidenceState",
                    "inCutoffScope",
                    "milestoneId",
                    "outcomeBytesInspected",
                    "taskRefIsEvidence",
                    "taskRefSuffix",
                },
                f"pending.{category}",
            )
            milestone_id = _exact_str(task["milestoneId"], "pending milestone")
            pending_ids.append(milestone_id)
            category_ids.append(milestone_id)
            _require(
                _exact_str(task["evidenceState"], "pending evidence state") == expected_state,
                "pending state drift",
            )
            _require(
                _exact_bool(task["inCutoffScope"], "pending in-cutoff scope") is expected_in_cutoff,
                "pending cutoff-scope drift",
            )
            _require(
                _exact_bool(task["outcomeBytesInspected"], "outcomeBytesInspected") is False,
                "unpublished outcome inspected",
            )
            _require(
                _exact_bool(task["taskRefIsEvidence"], "taskRefIsEvidence") is False,
                "task ref promoted to evidence",
            )
            _require(
                bool(
                    re.fullmatch(
                        r"[0-9a-f]{4}",
                        _exact_str(task["taskRefSuffix"], "task suffix"),
                    )
                ),
                "bad pending task suffix",
            )
        _require(tuple(category_ids) == expected_ids, f"{category}: allowlist/order drift")
    _require(len(pending_ids) == len(set(pending_ids)), "duplicate pending milestone")
    required_truth = _exact_list(pending["requiredTruth"], "pending.requiredTruth")
    _require(len(required_truth) == 6, "required truth count")
    required_codes: list[str] = []
    for item_any in required_truth:
        item = _exact_dict(item_any, "required truth")
        _exact_keys(item, {"code", "state"}, "required truth")
        required_codes.append(_exact_str(item["code"], "required truth code"))
        _require(
            _exact_str(item["state"], "required truth state") == "PENDING",
            "required truth promoted",
        )
    _require(tuple(required_codes) == REQUIRED_TRUTH_CODES, "required truth drift")

    excluded_items = _exact_list(
        registry["postCutoffAcceptedExcluded"], "postCutoffAcceptedExcluded"
    )
    excluded_ids = []
    for item_any in excluded_items:
        item = _exact_dict(item_any, "post-cutoff exclusion")
        _exact_keys(
            item,
            {
                "acceptanceRowSha256",
                "outcomeBytesConsumed",
                "reason",
                "recordId",
            },
            "post-cutoff exclusion",
        )
        excluded_ids.append(_exact_str(item["recordId"], "post-cutoff record"))
        _require(
            bool(
                HEX64.fullmatch(
                    _exact_str(
                        item["acceptanceRowSha256"],
                        "post-cutoff acceptance-row hash",
                    )
                )
            ),
            "bad post-cutoff acceptance-row hash",
        )
        _require(
            _exact_str(item["reason"], "post-cutoff reason") == "POST_VG26_CUTOFF",
            "post-cutoff reason drift",
        )
        _require(
            _exact_bool(item["outcomeBytesConsumed"], "post-cutoff consumed") is False,
            "post-cutoff outcome consumed",
        )
    _require(tuple(excluded_ids) == POST_CUTOFF_RECORD_IDS, "post-cutoff exclusion drift")
    _require(
        excluded_items[-1]["acceptanceRowSha256"] == ledger_snapshot["asOfRowSha256"],
        "ledger as-of hash drift",
    )

    truth_policy = _exact_dict(registry["truthPolicy"], "registry.truthPolicy")
    expected_truth_policy = {
        "missingOutcomeBecomesZero": False,
        "pboMayOverrideMultiplicityOrIntervals": False,
        "positivePointEstimateMayQualify": False,
        "publicCapacityMaySubstituteForExecutableCapacity": False,
        "publicFeesMaySubstituteForAccountEffectiveFees": False,
        "unknownAndNullPreserved": True,
    }
    _exact_keys(truth_policy, set(expected_truth_policy), "registry.truthPolicy")
    for policy_name, expected_value in expected_truth_policy.items():
        _require(
            _exact_bool(truth_policy[policy_name], f"truthPolicy.{policy_name}") is expected_value,
            "truth policy weakened",
        )
    card_hash = _exact_str(registry["ownerCardRawSha256"], "owner card hash")
    _require(bool(HEX64.fullmatch(card_hash)), "bad owner card hash")
    _require(_sha256(render_owner_card(registry).encode("utf-8")) == card_hash, "card hash drift")


def verify_git_pins(registry: Mapping[str, Any], repo: Path) -> None:
    canonical = _exact_dict(registry["canonicalOrigin"], "registry.canonicalOrigin")
    _verify_commit_tree(repo, canonical["commit"], canonical["tree"])
    pins: list[dict[str, Any]] = []
    cutoff = _exact_dict(registry["cutoff"], "registry.cutoff")
    pins.append(_exact_dict(cutoff["resultArtifact"], "cutoff artifact"))
    for binding_any in _exact_list(registry["aggregateBindings"], "aggregate bindings"):
        binding = _exact_dict(binding_any, "aggregate binding")
        pins.append(_exact_dict(binding["artifact"], "aggregate artifact"))
    for origin_any in _exact_list(registry["origins"], "origins"):
        origin = _exact_dict(origin_any, "origin")
        commit = origin["producerCommit"]
        tree = origin["producerTree"]
        if commit is not None:
            _verify_commit_tree(repo, commit, tree)
        if origin["artifact"] is not None:
            pins.append(_exact_dict(origin["artifact"], "origin artifact"))
        protocol = _exact_dict(origin["familyIdentity"], "family identity")["protocolArtifact"]
        if protocol is not None:
            pins.append(_exact_dict(protocol, "protocol artifact"))
    seen: set[tuple[str, str, str]] = set()
    for pin in pins:
        identity = (pin["producerCommit"], pin["path"], pin["rawSha256"])
        if identity in seen:
            continue
        seen.add(identity)
        actual = _pin_artifact(
            repo,
            pin["producerCommit"],
            pin["producerTree"],
            pin["path"],
        )
        _require(actual == pin, f"{pin['path']}: Git pin drift")


def verify_spec_binding(registry: Mapping[str, Any], spec: dict[str, Any]) -> None:
    """Bind every semantic and Git identity to the frozen origin adapter."""

    _validate_spec(spec)
    _require(
        registry["originSpecCanonicalSha256"] == _sha256(_canonical_bytes(spec)),
        "origin-spec hash drift",
    )
    expected_bindings = {
        binding["bindingId"]: binding
        for binding in _exact_list(spec["aggregateBindings"], "spec aggregate bindings")
    }
    actual_bindings = {
        binding["bindingId"]: binding
        for binding in _exact_list(registry["aggregateBindings"], "registry aggregate bindings")
    }
    _require(set(actual_bindings) == set(expected_bindings), "aggregate binding drift")
    for binding_id, expected in expected_bindings.items():
        actual = _exact_dict(actual_bindings[binding_id], f"{binding_id} binding")
        artifact = _exact_dict(actual["artifact"], f"{binding_id} artifact")
        _require(
            {
                "bindingId": actual["bindingId"],
                "expectedRowSha256": actual["acceptanceRowSha256"],
                "path": artifact["path"],
                "producerCommit": artifact["producerCommit"],
                "producerTree": artifact["producerTree"],
                "recordId": actual["recordId"],
                "status": actual["status"],
            }
            == expected,
            f"{binding_id}: spec binding mismatch",
        )

    expected_origins = _exact_list(spec["origins"], "spec origins")
    actual_origins = _exact_list(registry["origins"], "registry origins")
    _require(len(actual_origins) == len(expected_origins), "spec origin count mismatch")
    # Length equality is checked immediately above; this spelling keeps the
    # verifier runnable under the workstation's Python 3.9 as well as 3.13.
    for expected_any, actual_any in zip(expected_origins, actual_origins):  # noqa: B905
        expected = _exact_dict(expected_any, "expected origin")
        actual = _exact_dict(actual_any, "actual origin")
        artifact = actual["artifact"]
        actual_path = None if artifact is None else artifact["path"]
        _require(
            {
                "custodyState": actual["custodyState"],
                "limitations": actual["limitations"],
                "normalizedVerdict": actual["normalizedVerdict"],
                "originId": actual["originId"],
                "path": actual_path,
                "producerCommit": actual["producerCommit"],
                "producerTree": actual["producerTree"],
                "recordId": actual["recordId"],
                "sourceVerdict": actual["sourceVerdict"],
            }
            == {
                "custodyState": expected["custodyState"],
                "limitations": sorted(expected["limitations"]),
                "normalizedVerdict": expected["normalizedVerdict"],
                "originId": expected["originId"],
                "path": expected["path"],
                "producerCommit": expected["producerCommit"],
                "producerTree": expected["producerTree"],
                "recordId": expected["recordId"],
                "sourceVerdict": expected["sourceVerdict"],
            },
            f"{expected['originId']}: spec origin mismatch",
        )
        family = _exact_dict(actual["familyIdentity"], "actual family identity")
        if expected["familyKey"] in SMETA_ACCEPTED_FAMILIES:
            _require(
                family["key"] == expected["familyKey"],
                f"{expected['originId']}: spec family mismatch",
            )
        else:
            protocol = _exact_dict(family["protocolArtifact"], "actual protocol artifact")
            _require(
                protocol["producerCommit"] == expected["producerCommit"]
                and protocol["producerTree"] == expected["producerTree"]
                and protocol["path"] == _protocol_path(expected["originId"]),
                f"{expected['originId']}: spec protocol mismatch",
            )

    _require(
        registry["pendingInputs"]
        == _pending_output(_exact_dict(spec["pendingInputs"], "spec pending inputs")),
        "pending-input spec binding drift",
    )
    _require(
        tuple(
            item["recordId"]
            for item in _exact_list(
                registry["postCutoffAcceptedExcluded"],
                "registry post-cutoff exclusions",
            )
        )
        == tuple(spec["postCutoffAcceptedExcluded"]),
        "post-cutoff spec binding drift",
    )


def verify_run_receipts(registry: Mapping[str, Any], run_raw: bytes) -> None:
    """Re-bind stored acceptance receipts and cutoff chronology to current run.md."""

    stored_receipts = {
        receipt["recordId"]: receipt
        for receipt in _exact_list(registry["acceptanceReceipts"], "registry acceptance receipts")
    }
    record_ids = list(stored_receipts)
    all_record_ids = [*record_ids, *POST_CUTOFF_RECORD_IDS]
    extracted, positions = _extract_rows(run_raw, all_record_ids)
    for record_id, stored in stored_receipts.items():
        _require(stored == extracted[record_id], f"{record_id}: live receipt drift")
    cutoff_position = positions[CUTOFF_RECORD_ID]
    for record_id in record_ids:
        _require(
            positions[record_id] >= cutoff_position,
            f"{record_id}: acceptance is post-cutoff",
        )
    for record_id in POST_CUTOFF_RECORD_IDS:
        _require(
            positions[record_id] < cutoff_position,
            f"{record_id}: exclusion is not post-cutoff",
        )
    excluded_items = _exact_list(
        registry["postCutoffAcceptedExcluded"], "registry post-cutoff exclusions"
    )
    for item_any in excluded_items:
        item = _exact_dict(item_any, "post-cutoff exclusion")
        record_id = _exact_str(item["recordId"], "post-cutoff record")
        _require(
            item["acceptanceRowSha256"] == extracted[record_id]["rowSha256"],
            f"{record_id}: live exclusion receipt drift",
        )

    lines = run_raw.splitlines(keepends=True)
    as_of_position = positions[POST_CUTOFF_RECORD_IDS[-1]]
    post_cutoff_profitability_ids: list[str] = []
    for line in lines[as_of_position:cutoff_position]:
        try:
            text = line.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ContractError("run.md contains non-UTF-8 bytes") from exc
        match = re.search(r"item=`([^`]+)`", text)
        if match is None:
            continue
        record_id = match.group(1)
        marker = " ORCHESTRATOR "
        if marker not in record_id or " ACCEPTANCE" not in record_id:
            continue
        milestone = record_id.split(marker, 1)[1].split(" ", 1)[0]
        if milestone.startswith("S-") or milestone.startswith("V-G"):
            post_cutoff_profitability_ids.append(record_id)
    _require(
        tuple(reversed(post_cutoff_profitability_ids)) == POST_CUTOFF_RECORD_IDS,
        "profitability acceptance set drift within ledger snapshot",
    )


def _write_outputs(registry: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    registry_path = output_dir / "current_profitability_registry.v1.json"
    card_path = output_dir / "owner_verdict_card.v1.md"
    registry_path.write_bytes(_canonical_bytes(registry))
    card_path.write_bytes(render_owner_card(registry).encode("utf-8"))


def _verify_files(
    registry_path: Path,
    card_path: Path,
    repo: Path,
    spec_path: Path,
    run_path: Path,
) -> dict[str, Any]:
    registry_raw = registry_path.read_bytes()
    registry = load_json(registry_path)
    validate_registry(registry)
    _require(registry_raw == _canonical_bytes(registry), "registry is not canonical JSON")
    spec = load_json(spec_path)
    verify_spec_binding(registry, spec)
    verify_run_receipts(registry, run_path.read_bytes())
    expected_card = render_owner_card(registry).encode("utf-8")
    actual_card = card_path.read_bytes()
    _require(actual_card == expected_card, "owner card bytes drift")
    verify_git_pins(registry, repo)
    return {
        "acceptedFamilyCount": registry["summary"]["acceptedFamilyCount"],
        "acceptedOriginCount": registry["summary"]["acceptedOriginCount"],
        "cardSha256": _sha256(actual_card),
        "crediblePositiveCount": registry["summary"]["crediblePositiveCount"],
        "registrySha256": _sha256(registry_raw),
        "verifiedPositiveCount": registry["summary"]["verifiedPositiveCount"],
        "verdict": registry["summary"]["currentProfitabilityVerdict"],
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    freeze = subparsers.add_parser("freeze")
    freeze.add_argument("--spec", type=Path, required=True)
    freeze.add_argument("--run", type=Path, required=True)
    freeze.add_argument("--repo", type=Path, required=True)
    freeze.add_argument("--output-dir", type=Path, required=True)
    verify = subparsers.add_parser("verify")
    verify.add_argument("--registry", type=Path, required=True)
    verify.add_argument("--card", type=Path, required=True)
    verify.add_argument("--spec", type=Path, required=True)
    verify.add_argument("--run", type=Path, required=True)
    verify.add_argument("--repo", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "freeze":
            spec = load_json(args.spec)
            run_raw = args.run.read_bytes()
            registry = freeze_registry(spec, run_raw, args.repo)
            _write_outputs(registry, args.output_dir)
            proof = _verify_files(
                args.output_dir / "current_profitability_registry.v1.json",
                args.output_dir / "owner_verdict_card.v1.md",
                args.repo,
                args.spec,
                args.run,
            )
        else:
            proof = _verify_files(
                args.registry,
                args.card,
                args.repo,
                args.spec,
                args.run,
            )
    except (ContractError, OSError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(proof, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
