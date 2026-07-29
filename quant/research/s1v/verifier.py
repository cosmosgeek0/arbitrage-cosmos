#!/usr/bin/env python3
"""Standalone, network-free verifier for the sealed S-1V packet."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from collections.abc import Mapping, Sequence
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any, Final, cast

BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
SCHEMA_PREFIX: Final = "cosmos.quant.research.s1v"
SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
SUM_LINE_PATTERN: Final = re.compile(r"^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)$")

STATIC_FILES: Final = frozenset(
    {
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "experiment.py",
        "protocol.v1.json",
        "source_plan.v1.json",
        "test_experiment.py",
        "test_verifier.py",
        "trial_ledger.v1.json",
        "verifier.py",
    }
)
PRE_RUN_FILES: Final = frozenset(
    {
        "freeze.v1.json",
        "preseal.v1.json",
        "run_consumed.v1.json",
        "screen_consumed.v1.json",
        "source_manifest.v1.json",
        "universe.v1.json",
    }
)
TERMINAL_FILES: Final = frozenset({"REPORT.md", "result.v1.json", "SHA256SUMS"})
DEVELOPMENT_FILE: Final = "development.v1.json"
HOLDOUT_BUNDLE: Final = frozenset(
    {"candidate_seal.v1.json", "holdout_open.v1.json", "holdout.v1.json"}
)
BASE_INVENTORY: Final = STATIC_FILES | PRE_RUN_FILES | TERMINAL_FILES
FREEZE_BINDINGS: Final = STATIC_FILES | {
    "preseal.v1.json",
    "screen_consumed.v1.json",
    "source_manifest.v1.json",
    "universe.v1.json",
}
EXPECTED_SCHEMAS: Final = {
    "protocol.v1.json": f"{SCHEMA_PREFIX}.protocol.v1",
    "source_plan.v1.json": f"{SCHEMA_PREFIX}.source_plan.v1",
    "trial_ledger.v1.json": f"{SCHEMA_PREFIX}.trial_ledger.v1",
    "preseal.v1.json": f"{SCHEMA_PREFIX}.preseal.v1",
    "screen_consumed.v1.json": f"{SCHEMA_PREFIX}.screen_consumed.v1",
    "universe.v1.json": f"{SCHEMA_PREFIX}.universe.v1",
    "source_manifest.v1.json": f"{SCHEMA_PREFIX}.source_manifest.v1",
    "freeze.v1.json": f"{SCHEMA_PREFIX}.freeze.v1",
    "run_consumed.v1.json": f"{SCHEMA_PREFIX}.run_consumed.v1",
    DEVELOPMENT_FILE: f"{SCHEMA_PREFIX}.development.v1",
    "result.v1.json": f"{SCHEMA_PREFIX}.result.v1",
    "candidate_seal.v1.json": f"{SCHEMA_PREFIX}.candidate_seal.v1",
    "holdout_open.v1.json": f"{SCHEMA_PREFIX}.holdout_open.v1",
    "holdout.v1.json": f"{SCHEMA_PREFIX}.holdout.v1",
}
SCREEN_MONTHS: Final = ("2025-06",)
DEVELOPMENT_MONTHS: Final = (
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
)
HOLDOUT_MONTHS: Final = ("2026-04", "2026-05", "2026-06")
ALL_MONTHS: Final = SCREEN_MONTHS + DEVELOPMENT_MONTHS + HOLDOUT_MONTHS
SOURCE_KINDS: Final = ("fundingRate", "klines_1h", "markPriceKlines_1h")
FROZEN_COMMIT_PATTERN: Final = re.compile(r"^[0-9a-f]{40}$")
SYMBOL_PATTERN: Final = re.compile(r"^[A-Z0-9]+USDT$")
REASON_CODE_PATTERN: Final = re.compile(r"^[A-Z][A-Z0-9_]*$")
SCENARIOS: Final = ("base", "stress", "severe")
PROTOCOL_AUTHORITY: Final = {
    "canonical_branch": "NONE",
    "deployment": "NONE",
    "execution": "NONE",
    "host": "NONE",
    "money_moved_usd": 0,
    "orders": "NONE",
    "private_read": "NONE",
    "provider": "NONE",
    "transfers": "NONE",
    "ui": "NONE",
    "withdrawals": "NONE",
}
SOURCE_AUTHORITY: Final = {
    **PROTOCOL_AUTHORITY,
    "public_download": "NONE_DURING_S1V_ENGINE",
}
NETWORK_POLICY: Final = {
    "allowed_hosts": [],
    "credentials": False,
    "engine_network_access": False,
    "fresh_public_download": False,
    "private_endpoints": False,
    "redirect_to_unlisted_host": False,
    "rest_fallback": False,
    "signed_endpoints": False,
}
EXPECTED_RESULT_EFFECTS: Final = {
    "live_trading": False,
    "money_moved_usd": 0,
    "orders_placed": 0,
    "private_api_used": False,
    "provider_mutation": False,
    "transfers": 0,
    "withdrawals": 0,
}
EXPECTED_SCHEMA_PROBE_CUSTODY: Final = {
    "disclosed": True,
    "outcome_rows_opened": 0,
    "outside_selected_source_root": True,
}
SOURCE_TEMPLATES: Final = {
    "checksum": "{zip_path}.CHECKSUM",
    "fundingRate": (
        "data/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    ),
    "klines_1h": ("data/futures/um/monthly/klines/{symbol}/1h/{symbol}-1h-{month}.zip"),
    "markPriceKlines_1h": (
        "data/futures/um/monthly/markPriceKlines/{symbol}/1h/{symbol}-1h-{month}.zip"
    ),
}
SOURCE_MANIFEST_FIELDS: Final = [
    "acquisition_state",
    "availability",
    "byte_count",
    "http_status",
    "kind",
    "local_relative_path",
    "member_state",
    "month",
    "sidecar_expected_zip_sha256",
    "sidecar_sha256",
    "source_url",
    "symbol",
    "zip_sha256",
]
DIRECTED_HASH_CHAIN: Final = [
    "preseal.v1.json binds the complete static-file byte digests and canonical base commit",
    "screen_consumed.v1.json binds preseal.v1.json and protocol.v1.json",
    (
        "universe.v1.json binds screen_consumed.v1.json, the full sorted "
        "candidate-attempt ledger, exact June archive_member_open_count "
        "reconciliation, all successful June evidence digests, every row "
        "reason_code, and the mechanical selected-30 projection"
    ),
    ("source_manifest.v1.json binds universe.v1.json and all 1170 selected ZIP/sidecar pairs"),
    ("freeze.v1.json binds static files, preseal, screen marker, universe, and source manifest"),
    "run_consumed.v1.json binds freeze.v1.json and protocol.v1.json",
    (
        "development.v1.json binds run_consumed.v1.json, freeze.v1.json, "
        "protocol.v1.json, and trial_ledger.v1.json"
    ),
    (
        "candidate_seal.v1.json binds development.v1.json and the single "
        "champion when and only when all development gates pass"
    ),
    (
        "holdout_open.v1.json binds candidate_seal.v1.json before any "
        "April-through-June member opening"
    ),
    ("holdout.v1.json binds holdout_open.v1.json and the sealed champion evaluation"),
    (
        "result.v1.json binds the applicable terminal chain; SHA256SUMS binds "
        "every final packet file except itself"
    ),
]
TRIAL_SPECS: Final = tuple(
    {
        "compression_run_observations": compression,
        "expansion_ratio": expansion,
        "hold_hours": hold,
        "trial_id": (f"c{compression}_x{str(expansion).replace('.', 'p')}_h{hold}"),
    }
    for compression in (3, 6)
    for expansion in (1.25, 1.75)
    for hold in (6, 12, 24)
)
TRUSTED_DEVELOPMENT_GATES: Final = {
    "active_cohorts_min": 24,
    "active_weeks_min": 12,
    "all_must_pass_before_candidate_seal": True,
    "base_capacity_min_usd_gte": 1000.0,
    "base_net_usd_per_1000_gt": 0.0,
    "bonferroni_base_lower_bound_gt": 0.0,
    "bonferroni_stress_lower_bound_gt": 0.0,
    "champion_holm_p_lte": 0.05,
    "distinct_traded_symbols_min": 12,
    "pbo_lte": 0.5,
    "remove_best_month_stress_net_usd_per_1000_gt": 0.0,
    "remove_best_symbol_stress_net_usd_per_1000_gt": 0.0,
    "severe_hourly_marked_equity_max_drawdown_lte": 0.1,
    "stress_net_usd_per_1000_gt": 0.0,
    "valid_causal_decision_epochs_min": 60,
    "valid_complete_source_manifest": True,
    "white_reality_check_base_p_lte": 0.05,
    "white_reality_check_stress_p_lte": 0.05,
}
TRUSTED_HOLDOUT_GATES: Final = {
    "active_cohorts_min": 8,
    "active_weeks_min": 6,
    "base_capacity_min_usd_gte": 1000.0,
    "base_net_usd_per_1000_gt": 0.0,
    "distinct_traded_symbols_min": 6,
    "pointwise_base_lower_bound_gt": 0.0,
    "pointwise_stress_lower_bound_gt": 0.0,
    "remove_best_month_stress_net_usd_per_1000_gt": 0.0,
    "remove_best_symbol_stress_net_usd_per_1000_gt": 0.0,
    "severe_hourly_marked_equity_max_drawdown_lte": 0.1,
    "stress_net_usd_per_1000_gt": 0.0,
}
DEVELOPMENT_GATE_KEYS: Final = frozenset(TRUSTED_DEVELOPMENT_GATES) - {
    "all_must_pass_before_candidate_seal"
}
HOLDOUT_GATE_KEYS: Final = frozenset(TRUSTED_HOLDOUT_GATES)
TRIAL_SUMMARY_KEYS: Final = frozenset(
    {
        "active_cohorts",
        "active_weeks",
        "base_bonferroni_lcb",
        "base_net_usd_per_1000",
        "base_p_value",
        "bootstrap_interval_usd_per_1000",
        "distinct_traded_symbols",
        "development_gates",
        "holm_adjusted_p",
        "passes_all_development_gates",
        "public_capacity_proxy_usd",
        "remove_best_month_stress_net_usd_per_1000",
        "remove_best_symbol_stress_net_usd_per_1000",
        "severe_hourly_marked_equity_max_drawdown",
        "severe_net_usd_per_1000",
        "skipped_active_epochs",
        "stress_bonferroni_lcb",
        "stress_net_usd_per_1000",
        "stress_p_value",
        "trial_id",
        "valid_cash_epochs",
        "valid_decision_epochs",
    }
)
HOLDOUT_SUMMARY_KEYS: Final = frozenset(
    {
        "active_cohorts",
        "active_weeks",
        "bootstrap_intervals",
        "distinct_traded_symbols",
        "net_usd_per_1000_by_scenario",
        "pointwise_lcb",
        "public_capacity_proxy_usd",
        "remove_best_month_stress_net_usd_per_1000",
        "remove_best_symbol_stress_net_usd_per_1000",
        "severe_hourly_marked_equity_max_drawdown",
        "skipped_active_epochs",
        "valid_cash_epochs",
        "valid_decision_epochs",
    }
)
PBO_KEYS: Final = frozenset(
    {
        "authority",
        "pbo",
        "purged_days_per_block",
        "score_days_per_block",
        "splits",
    }
)
RESULT_COMMON_KEYS: Final = frozenset(
    {
        "account_effective_fees",
        "capital_authority",
        "created_at",
        "effects",
        "executable_capacity",
        "execution_authority",
        "freeze_file_sha256",
        "frozen_commit",
        "limitations",
        "positive_edge_claim",
        "protocol_file_sha256",
        "run_consumed_file_sha256",
        "schema",
        "selected_source_root_holdout_outcome_rows_opened_before_gates",
        "source_manifest_file_sha256",
        "trial_ledger_file_sha256",
    }
)
RESULT_STATE_KEYS: Final = frozenset(
    {
        "bootstrap_intervals",
        "candidate_seal_file_sha256",
        "causal_and_activity_counters",
        "development_and_holdout_custody",
        "development_file_sha256",
        "holdout_file_sha256",
        "holdout_open_file_sha256",
        "holdout_state",
        "holm_p_values",
        "net_usd_per_1000_by_scenario",
        "outcome_state",
        "pbo",
        "public_capacity_proxy",
        "remove_best_symbol_and_month_stress_net",
        "severe_hourly_marked_equity_max_drawdown",
        "strategy_verdict",
        "verdict",
        "white_reality_check_p_by_scenario",
    }
)
RESULT_COUNTER_KEYS: Final = frozenset(
    {
        "active_cohorts",
        "active_weeks",
        "distinct_traded_symbols",
        "skipped_active_epochs",
        "valid_cash_epochs",
        "valid_causal_decision_epochs",
    }
)


class VerificationError(RuntimeError):
    """Packet authentication or custody failure."""


def canonical_bytes(value: Any) -> bytes:
    """Return the sole accepted JSON representation."""

    try:
        encoded = json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise VerificationError(f"JSON_NOT_CANONICALIZABLE:{exc}") from exc
    return encoded + b"\n"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise VerificationError(f"FILE_READ_FAILED:{path.name}:{exc}") from exc
    return digest.hexdigest()


def _require_object(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise VerificationError(code)
    return dict(value)


def _require_exact_json_object(
    value: Any,
    expected: Mapping[str, Any],
    code: str,
) -> dict[str, Any]:
    document = _require_object(value, code)
    if document != expected or canonical_bytes(document) != canonical_bytes(dict(expected)):
        raise VerificationError(code)
    return document


def _require_sha256(value: Any, code: str) -> str:
    if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
        raise VerificationError(code)
    return value


def load_canonical_json(path: Path, expected_schema: str) -> dict[str, Any]:
    """Load one canonical JSON object under the no-self-digest contract."""

    try:
        raw_bytes = path.read_bytes()
        decoded = raw_bytes.decode("utf-8", errors="strict")
        value = json.loads(decoded)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VerificationError(f"JSON_READ_FAILED:{path.name}:{exc}") from exc
    document = _require_object(value, f"JSON_OBJECT_REQUIRED:{path.name}")
    if raw_bytes != canonical_bytes(document):
        raise VerificationError(f"NONCANONICAL_JSON:{path.name}")
    if document.get("schema") != expected_schema:
        raise VerificationError(f"SCHEMA_INVALID:{path.name}")
    if "artifactSha256" in document or "artifact_sha256" in document:
        raise VerificationError(f"SELF_DIGEST_FIELD_FORBIDDEN:{path.name}")
    return document


def _inventory_for_names(names: set[str]) -> frozenset[str]:
    bundle_members = names & HOLDOUT_BUNDLE
    if bundle_members and bundle_members != HOLDOUT_BUNDLE:
        missing = sorted(HOLDOUT_BUNDLE - bundle_members)
        raise VerificationError(f"PARTIAL_HOLDOUT_BUNDLE:{missing}")
    if bundle_members and DEVELOPMENT_FILE not in names:
        raise VerificationError("HOLDOUT_BUNDLE_WITHOUT_DEVELOPMENT")
    expected = BASE_INVENTORY
    if DEVELOPMENT_FILE in names:
        expected = expected | {DEVELOPMENT_FILE}
    if bundle_members:
        expected = expected | HOLDOUT_BUNDLE
    return frozenset(expected)


def verify_exact_inventory(root: Path) -> frozenset[str]:
    try:
        entries = tuple(root.iterdir())
    except OSError as exc:
        raise VerificationError(f"INVENTORY_READ_FAILED:{exc}") from exc
    names = {entry.name for entry in entries}
    if len(names) != len(entries):
        raise VerificationError("INVENTORY_NAME_COLLISION")
    expected = _inventory_for_names(names)
    if names != expected:
        missing = sorted(expected - names)
        extra = sorted(names - expected)
        raise VerificationError(f"INVENTORY_INVALID:missing={missing}:extra={extra}")
    for entry in entries:
        if entry.is_symlink() or not entry.is_file():
            raise VerificationError(f"INVENTORY_NONREGULAR:{entry.name}")
    return expected


def parse_sha256sums(path: Path, expected_inventory: frozenset[str]) -> dict[str, str]:
    """Parse the checksum manifest without delegating to a host executable."""

    try:
        raw = path.read_bytes()
        text = raw.decode("ascii", errors="strict")
    except (OSError, UnicodeDecodeError) as exc:
        raise VerificationError(f"SHA256SUMS_READ_FAILED:{exc}") from exc
    if not raw or not raw.endswith(b"\n") or b"\r" in raw:
        raise VerificationError("SHA256SUMS_NONCANONICAL")
    rows: list[tuple[str, str]] = []
    for line in text.splitlines():
        match = SUM_LINE_PATTERN.fullmatch(line)
        if match is None:
            raise VerificationError("SHA256SUMS_MALFORMED")
        digest, name = match.groups()
        rows.append((name, digest))
    names = [name for name, _digest in rows]
    expected_names = sorted(expected_inventory - {"SHA256SUMS"})
    if names != expected_names or len(names) != len(set(names)):
        raise VerificationError("SHA256SUMS_INVENTORY_INVALID")
    return dict(rows)


def verify_sha256sums(root: Path, expected_inventory: frozenset[str]) -> None:
    sums = parse_sha256sums(root / "SHA256SUMS", expected_inventory)
    for name, expected in sums.items():
        actual = sha256_file(root / name)
        if actual != expected:
            raise VerificationError(f"SHA256SUMS_DIGEST_INVALID:{name}")


def _require_binding_map(
    document: Mapping[str, Any],
    field: str,
    expected_files: frozenset[str],
    root: Path,
    code: str,
) -> None:
    bindings = _require_object(document.get(field), code)
    if set(bindings) != set(expected_files):
        raise VerificationError(code)
    for name, claimed in bindings.items():
        _require_sha256(claimed, code)
        if claimed != sha256_file(root / name):
            raise VerificationError(f"{code}:{name}")


def _require_file_link(
    document: Mapping[str, Any],
    field: str,
    root: Path,
    target_name: str,
    code: str,
) -> None:
    claimed = _require_sha256(document.get(field), code)
    if claimed != sha256_file(root / target_name):
        raise VerificationError(code)


def _require_absent_link(document: Mapping[str, Any], field: str, code: str) -> None:
    if document.get(field) is not None:
        raise VerificationError(code)


def _safe_relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and "." not in path.parts


def _require_exact_keys(
    value: Any,
    expected: frozenset[str] | set[str],
    code: str,
) -> dict[str, Any]:
    document = _require_object(value, code)
    if set(document) != set(expected):
        raise VerificationError(
            f"{code}:missing={sorted(set(expected) - set(document))}:"
            f"extra={sorted(set(document) - set(expected))}"
        )
    return document


def _require_nonnegative_int(value: Any, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise VerificationError(code)
    return value


def _require_exact_nonnegative_int(
    document: Mapping[str, Any],
    field: str,
    expected: int,
    code: str,
) -> int:
    value = _require_nonnegative_int(document.get(field), code)
    if value != expected:
        raise VerificationError(code)
    return value


def _require_decimal(
    value: Any,
    code: str,
    *,
    minimum: Decimal | None = None,
    maximum: Decimal | None = None,
) -> Decimal:
    if not isinstance(value, str) or not value:
        raise VerificationError(code)
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise VerificationError(code) from exc
    if (
        not parsed.is_finite()
        or (minimum is not None and parsed < minimum)
        or (maximum is not None and parsed > maximum)
    ):
        raise VerificationError(code)
    return parsed


def _require_probability(value: Any, code: str) -> Decimal:
    return _require_decimal(
        value,
        code,
        minimum=Decimal(0),
        maximum=Decimal(1),
    )


def _require_scenario_decimals(value: Any, code: str) -> dict[str, Decimal]:
    raw = _require_exact_keys(value, set(SCENARIOS), code)
    return {
        scenario: _require_decimal(raw[scenario], f"{code}:{scenario}") for scenario in SCENARIOS
    }


def _require_intervals(value: Any, code: str) -> dict[str, tuple[Decimal, Decimal]]:
    raw = _require_exact_keys(value, set(SCENARIOS), code)
    result: dict[str, tuple[Decimal, Decimal]] = {}
    for scenario in SCENARIOS:
        interval = raw[scenario]
        if not isinstance(interval, list) or len(interval) != 2:
            raise VerificationError(f"{code}:{scenario}")
        lower = _require_decimal(interval[0], f"{code}:{scenario}:lower")
        upper = _require_decimal(interval[1], f"{code}:{scenario}:upper")
        if lower > upper:
            raise VerificationError(f"{code}:{scenario}:ORDER")
        result[scenario] = (lower, upper)
    return result


def _expected_source_path(kind: str, symbol: str, month: str) -> str:
    template = SOURCE_TEMPLATES[kind]
    return template.format(symbol=symbol, month=month)


def _validate_pbo(value: Any, code: str) -> dict[str, Any]:
    pbo = _require_exact_keys(value, PBO_KEYS, code)
    if (
        pbo["authority"] != "DIAGNOSTIC_ONLY"
        or pbo["splits"] != 924
        or pbo["score_days_per_block"] != 20
        or pbo["purged_days_per_block"] != 2
    ):
        raise VerificationError(code)
    _require_probability(pbo["pbo"], f"{code}:pbo")
    return pbo


def _validate_white(value: Any, code: str) -> dict[str, Decimal]:
    raw = _require_exact_keys(value, {"base", "stress"}, code)
    return {
        scenario: _require_probability(raw[scenario], f"{code}:{scenario}")
        for scenario in ("base", "stress")
    }


def _validate_capacity(value: Any, code: str) -> dict[str, Decimal]:
    raw = _require_exact_keys(value, {"minimum", "p05"}, code)
    minimum = _require_decimal(raw["minimum"], f"{code}:minimum", minimum=Decimal(0))
    p05 = _require_decimal(raw["p05"], f"{code}:p05", minimum=Decimal(0))
    if minimum > p05:
        raise VerificationError(f"{code}:ORDER")
    return {"minimum": minimum, "p05": p05}


def _validate_protocol_documents(
    protocol: Mapping[str, Any],
    source_plan: Mapping[str, Any],
    ledger: Mapping[str, Any],
) -> None:
    if protocol.get("canonical_base") != BASE_COMMIT:
        raise VerificationError("PROTOCOL_BASE_INVALID")
    protocol_id = protocol.get("protocol_id")
    if (
        not isinstance(protocol_id, str)
        or source_plan.get("protocol_id") != protocol_id
        or ledger.get("protocol_id") != protocol_id
    ):
        raise VerificationError("PROTOCOL_ID_LINK_INVALID")
    _require_exact_json_object(
        protocol.get("authority"),
        PROTOCOL_AUTHORITY,
        "PROTOCOL_AUTHORITY_INVALID",
    )
    _require_exact_json_object(
        source_plan.get("authority"),
        SOURCE_AUTHORITY,
        "SOURCE_PLAN_AUTHORITY_INVALID",
    )
    if source_plan.get("public_only") is not True:
        raise VerificationError("SOURCE_PLAN_PUBLIC_ONLY_INVALID")
    _require_exact_json_object(
        source_plan.get("network_policy"),
        NETWORK_POLICY,
        "SOURCE_PLAN_NETWORK_POLICY_INVALID",
    )
    if source_plan.get("templates") != SOURCE_TEMPLATES:
        raise VerificationError("SOURCE_PLAN_TEMPLATES_INVALID")
    selected_source_freeze = _require_object(
        source_plan.get("selected_source_freeze"),
        "SOURCE_PLAN_SELECTED_FREEZE_INVALID",
    )
    if selected_source_freeze.get("manifest_fields") != SOURCE_MANIFEST_FIELDS:
        raise VerificationError("SOURCE_PLAN_MANIFEST_FIELDS_INVALID")
    artifact_contract = _require_object(
        source_plan.get("artifact_contract"),
        "ARTIFACT_CONTRACT_INVALID",
    )
    if set(artifact_contract) != {
        "canonical_json",
        "directed_hash_chain",
        "schemas",
        "self_digest_convention",
    }:
        raise VerificationError("ARTIFACT_CONTRACT_INVALID")
    if artifact_contract.get("canonical_json") != (
        "All packet JSON is UTF-8, key-sorted compact JSON with one trailing LF."
    ):
        raise VerificationError("ARTIFACT_CANONICAL_CONTRACT_INVALID")
    if artifact_contract.get("schemas") != EXPECTED_SCHEMAS:
        raise VerificationError("ARTIFACT_SCHEMA_CONTRACT_INVALID")
    if artifact_contract.get("directed_hash_chain") != DIRECTED_HASH_CHAIN:
        raise VerificationError("ARTIFACT_HASH_CHAIN_CONTRACT_INVALID")
    if artifact_contract.get("self_digest_convention") != (
        "No JSON artifact contains a literal self-digest. preseal.v1.json binds static "
        "file hashes; freeze.v1.json binds the directed parent-child hash chain and "
        "source freeze; final SHA256SUMS binds complete on-disk bytes."
    ):
        raise VerificationError("ARTIFACT_DIGEST_CONTRACT_INVALID")
    development_gates = _require_object(
        protocol.get("development_gates"),
        "PROTOCOL_DEVELOPMENT_GATES_INVALID",
    )
    if development_gates != TRUSTED_DEVELOPMENT_GATES or canonical_bytes(
        development_gates
    ) != canonical_bytes(TRUSTED_DEVELOPMENT_GATES):
        raise VerificationError("PROTOCOL_DEVELOPMENT_GATES_INVALID")
    holdout_gates = _require_object(
        protocol.get("holdout_gates_if_opened"),
        "PROTOCOL_HOLDOUT_GATES_INVALID",
    )
    if holdout_gates != TRUSTED_HOLDOUT_GATES or canonical_bytes(holdout_gates) != canonical_bytes(
        TRUSTED_HOLDOUT_GATES
    ):
        raise VerificationError("PROTOCOL_HOLDOUT_GATES_INVALID")
    trials = ledger.get("trials")
    if (
        not isinstance(trials, list)
        or trials != list(TRIAL_SPECS)
        or ledger.get("family_size") != 12
        or ledger.get("grid")
        != {
            "compression_run_observations": [3, 6],
            "expansion_ratio": [1.25, 1.75],
            "hold_hours": [6, 12, 24],
        }
    ):
        raise VerificationError("TRIAL_LEDGER_COUNT_INVALID")


def _validate_universe(
    universe: Mapping[str, Any],
) -> tuple[tuple[str, ...], dict[tuple[str, str], dict[str, str]], bool]:
    expected_keys = {
        "candidate_count",
        "created_at",
        "preseal_file_sha256",
        "schema",
        "screen_archive_member_open_count",
        "screen_attempt_count",
        "screen_attempts",
        "screen_consumed_file_sha256",
        "screen_month",
        "screen_rows",
        "selected_count",
        "selected_symbols",
        "status",
    }
    if set(universe) != expected_keys or universe.get("screen_month") != "2025-06":
        raise VerificationError("UNIVERSE_SCHEMA_INVALID")
    rows = universe.get("screen_rows")
    selected = universe.get("selected_symbols")
    attempts = universe.get("screen_attempts")
    if (
        not isinstance(rows, list)
        or not isinstance(selected, list)
        or not isinstance(attempts, list)
    ):
        raise VerificationError("UNIVERSE_ROWS_INVALID")
    candidate_count = _require_nonnegative_int(
        universe.get("candidate_count"),
        "UNIVERSE_CANDIDATE_COUNT_INVALID",
    )
    attempt_count = _require_nonnegative_int(
        universe.get("screen_attempt_count"),
        "UNIVERSE_ATTEMPT_COUNT_INVALID",
    )
    screen_open_count = _require_nonnegative_int(
        universe.get("screen_archive_member_open_count"),
        "UNIVERSE_SCREEN_OPEN_COUNT_INVALID",
    )
    if attempt_count != len(attempts):
        raise VerificationError("UNIVERSE_ATTEMPT_COUNT_INVALID")

    base_attempt_keys = {
        "archive_member_open_count",
        "reason_code",
        "status",
        "symbol",
    }
    success_attempt_keys = base_attempt_keys | {
        "june_evidence",
        "screen_quote_volume",
    }
    successful: list[tuple[Decimal, str, dict[str, Any]]] = []
    attempt_symbols: list[str] = []
    observed_open_count = 0
    for raw_attempt in attempts:
        attempt = _require_object(raw_attempt, "UNIVERSE_ATTEMPT_INVALID")
        symbol = attempt.get("symbol")
        if not isinstance(symbol, str) or SYMBOL_PATTERN.fullmatch(symbol) is None:
            raise VerificationError("UNIVERSE_ATTEMPT_SYMBOL_INVALID")
        if attempt_symbols and symbol <= attempt_symbols[-1]:
            raise VerificationError("UNIVERSE_ATTEMPT_ORDER_INVALID")
        attempt_symbols.append(symbol)
        member_open_count = _require_nonnegative_int(
            attempt.get("archive_member_open_count"),
            "UNIVERSE_ATTEMPT_OPEN_COUNT_INVALID",
        )
        if member_open_count > len(SOURCE_KINDS):
            raise VerificationError("UNIVERSE_ATTEMPT_OPEN_COUNT_INVALID")
        observed_open_count += member_open_count
        status = attempt.get("status")
        if status == "INVALID_EVIDENCE":
            reason = attempt.get("reason_code")
            if (
                set(attempt) != base_attempt_keys
                or not isinstance(reason, str)
                or REASON_CODE_PATTERN.fullmatch(reason) is None
            ):
                raise VerificationError("UNIVERSE_INVALID_ATTEMPT_SCHEMA_INVALID")
            continue
        if status != "SUCCESS" or set(attempt) != success_attempt_keys:
            raise VerificationError("UNIVERSE_ATTEMPT_STATUS_INVALID")
        if attempt.get("reason_code") is not None or member_open_count != len(SOURCE_KINDS):
            raise VerificationError("UNIVERSE_SUCCESS_ATTEMPT_CUSTODY_INVALID")
        volume = _require_decimal(
            attempt.get("screen_quote_volume"),
            "UNIVERSE_VOLUME_INVALID",
            minimum=Decimal(0),
        )
        june = _require_exact_keys(
            attempt.get("june_evidence"),
            set(SOURCE_KINDS),
            "UNIVERSE_JUNE_EVIDENCE_INVALID",
        )
        projected_evidence: dict[str, dict[str, str]] = {}
        for kind in SOURCE_KINDS:
            digests = _require_exact_keys(
                june[kind],
                {"sidecar_sha256", "zip_sha256"},
                "UNIVERSE_JUNE_DIGESTS_INVALID",
            )
            projected_evidence[kind] = {
                "sidecar_sha256": _require_sha256(
                    digests["sidecar_sha256"],
                    "UNIVERSE_JUNE_SIDECAR_INVALID",
                ),
                "zip_sha256": _require_sha256(
                    digests["zip_sha256"],
                    "UNIVERSE_JUNE_ZIP_INVALID",
                ),
            }
        successful.append(
            (
                volume,
                symbol,
                {
                    "june_evidence": projected_evidence,
                    "screen_quote_volume": attempt["screen_quote_volume"],
                    "symbol": symbol,
                },
            )
        )
    if observed_open_count != screen_open_count:
        raise VerificationError("UNIVERSE_SCREEN_OPEN_COUNT_SUM_INVALID")
    if candidate_count != len(successful):
        raise VerificationError("UNIVERSE_CANDIDATE_COUNT_INVALID")

    ranked_successes = sorted(
        successful,
        key=lambda item: (-item[0], item[1]),
    )
    expected_rows = [item[2] for item in ranked_successes[:30]]
    expected_symbols = [str(row["symbol"]) for row in expected_rows]
    if rows != expected_rows or selected != expected_symbols:
        raise VerificationError("UNIVERSE_SCREEN_SELECTION_INVALID")
    if universe.get("selected_count") != len(expected_rows):
        raise VerificationError("UNIVERSE_COUNT_INVALID")

    evidence: dict[tuple[str, str], dict[str, str]] = {}
    for row in expected_rows:
        symbol = str(row["symbol"])
        selected_june = cast(
            Mapping[str, Mapping[str, str]],
            row["june_evidence"],
        )
        for kind in SOURCE_KINDS:
            evidence[(symbol, kind)] = dict(selected_june[kind])
    status = universe.get("status")
    complete = status == "FROZEN"
    if complete:
        if len(successful) < 30 or len(expected_symbols) != 30:
            raise VerificationError("UNIVERSE_COUNT_INVALID")
    elif status != "INVALID_EVIDENCE" or len(successful) >= 30:
        raise VerificationError("UNIVERSE_STATUS_INVALID")
    return tuple(expected_symbols), evidence, complete


def _validate_manifest(
    manifest: Mapping[str, Any],
    symbols: tuple[str, ...],
    june_evidence: Mapping[tuple[str, str], Mapping[str, str]],
    *,
    universe_complete: bool,
) -> bool:
    expected_top_keys = {
        "created_at",
        "development_archive_member_open_count",
        "entries",
        "entry_count",
        "holdout_archive_member_open_count",
        "schema",
        "selected_source_root_holdout_outcome_rows_opened_before_gates",
        "status",
        "universe_file_sha256",
    }
    if set(manifest) != expected_top_keys:
        raise VerificationError("MANIFEST_SCHEMA_INVALID")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or manifest.get("entry_count") != len(entries):
        raise VerificationError("MANIFEST_ENTRIES_INVALID")
    for field in (
        "development_archive_member_open_count",
        "holdout_archive_member_open_count",
        "selected_source_root_holdout_outcome_rows_opened_before_gates",
    ):
        _require_exact_nonnegative_int(
            manifest,
            field,
            0,
            "MANIFEST_MEMBER_CUSTODY_INVALID",
        )
    expected_entry_keys = {
        "acquisition_state",
        "availability",
        "byte_count",
        "http_status",
        "kind",
        "local_relative_path",
        "member_state",
        "month",
        "sidecar_expected_zip_sha256",
        "sidecar_sha256",
        "source_url",
        "symbol",
        "zip_sha256",
    }
    expected_cells = {
        (symbol, month, kind) for symbol in symbols for month in ALL_MONTHS for kind in SOURCE_KINDS
    }
    seen: set[tuple[str, str, str]] = set()
    unavailable = 0
    for raw_entry in entries:
        entry = _require_exact_keys(
            raw_entry,
            expected_entry_keys,
            "MANIFEST_ENTRY_SCHEMA_INVALID",
        )
        symbol = entry.get("symbol")
        month = entry.get("month")
        kind = entry.get("kind")
        if not isinstance(symbol, str) or not isinstance(month, str) or not isinstance(kind, str):
            raise VerificationError("MANIFEST_ENTRY_KEY_INVALID")
        cell = (symbol, month, kind)
        if cell not in expected_cells or cell in seen:
            raise VerificationError("MANIFEST_ENTRY_KEY_INVALID")
        seen.add(cell)
        relative = _expected_source_path(kind, symbol, month)
        if (
            entry.get("local_relative_path") != relative
            or entry.get("source_url") != f"https://data.binance.vision/{relative}"
            or not _safe_relative_path(relative)
        ):
            raise VerificationError("MANIFEST_PATH_OR_URL_INVALID")
        expected_member_state = (
            "SCREEN_OPENED_ONCE" if month in SCREEN_MONTHS else "OPAQUE_UNOPENED"
        )
        if entry.get("member_state") != expected_member_state:
            raise VerificationError("MANIFEST_MEMBER_STATE_INVALID")
        availability = entry.get("availability")
        if availability == "AVAILABLE":
            zip_sha = _require_sha256(
                entry.get("zip_sha256"),
                "MANIFEST_ZIP_DIGEST_INVALID",
            )
            sidecar_sha = _require_sha256(
                entry.get("sidecar_sha256"),
                "MANIFEST_SIDECAR_DIGEST_INVALID",
            )
            if (
                _require_sha256(
                    entry.get("sidecar_expected_zip_sha256"),
                    "MANIFEST_PUBLISHER_DIGEST_INVALID",
                )
                != zip_sha
                or entry.get("http_status") is not None
                or entry.get("acquisition_state")
                != "LOCAL_OFFICIAL_ARCHIVE_REUSE_CHECKSUM_VERIFIED"
                or _require_nonnegative_int(
                    entry.get("byte_count"),
                    "MANIFEST_BYTE_COUNT_INVALID",
                )
                <= 0
            ):
                raise VerificationError("MANIFEST_AVAILABLE_ENTRY_INVALID")
            if month == "2025-06":
                expected = june_evidence.get((symbol, kind))
                if (
                    expected is None
                    or expected.get("zip_sha256") != zip_sha
                    or expected.get("sidecar_sha256") != sidecar_sha
                ):
                    raise VerificationError("MANIFEST_UNIVERSE_DIGEST_DRIFT")
        elif availability == "UNAVAILABLE":
            unavailable += 1
            if entry.get("acquisition_state") != "UNAVAILABLE":
                raise VerificationError("MANIFEST_UNAVAILABLE_ENTRY_INVALID")
            if any(
                entry.get(field) is not None
                for field in (
                    "byte_count",
                    "http_status",
                    "sidecar_expected_zip_sha256",
                    "sidecar_sha256",
                    "zip_sha256",
                )
            ):
                raise VerificationError("MANIFEST_UNAVAILABLE_ENTRY_INVALID")
        else:
            raise VerificationError("MANIFEST_AVAILABILITY_INVALID")
    if seen != expected_cells or len(entries) != len(expected_cells):
        raise VerificationError("MANIFEST_CARTESIAN_COVERAGE_INVALID")
    status = manifest.get("status")
    complete = status == "COMPLETE"
    if complete:
        if not universe_complete or len(entries) != 1170 or unavailable:
            raise VerificationError("MANIFEST_COMPLETE_STATE_INVALID")
    elif status != "INVALID_EVIDENCE" or (universe_complete and unavailable == 0):
        raise VerificationError("MANIFEST_INVALID_STATE_INVALID")
    return complete


def _validate_pre_run_chain(
    root: Path,
    documents: Mapping[str, Mapping[str, Any]],
) -> bool:
    preseal = documents["preseal.v1.json"]
    screen = documents["screen_consumed.v1.json"]
    universe = documents["universe.v1.json"]
    manifest = documents["source_manifest.v1.json"]
    freeze = documents["freeze.v1.json"]
    run = documents["run_consumed.v1.json"]

    if (
        set(preseal)
        != {
            "allowed_screen_count",
            "bound_files",
            "canonical_base",
            "created_at",
            "policy",
            "schema",
        }
        or preseal.get("canonical_base") != BASE_COMMIT
        or preseal.get("policy") != "CREATED_BEFORE_ANY_SCREEN_MEMBER_OPEN"
    ):
        raise VerificationError("PRESEAL_BASE_INVALID")
    _require_exact_nonnegative_int(
        preseal,
        "allowed_screen_count",
        1,
        "PRESEAL_BASE_INVALID",
    )
    _require_binding_map(
        preseal,
        "bound_files",
        STATIC_FILES,
        root,
        "PRESEAL_BINDINGS_INVALID",
    )
    _require_file_link(
        screen,
        "preseal_file_sha256",
        root,
        "preseal.v1.json",
        "SCREEN_PRESEAL_LINK_INVALID",
    )
    _require_file_link(
        screen,
        "protocol_file_sha256",
        root,
        "protocol.v1.json",
        "SCREEN_PROTOCOL_LINK_INVALID",
    )
    if (
        set(screen)
        != {
            "allowed_screen_count",
            "created_at",
            "marker_created_before_first_member",
            "marker_created_before_screen_open",
            "preseal_file_sha256",
            "protocol_file_sha256",
            "schema",
            "screen_archive_member_open_count_before",
            "screen_ordinal",
        }
        or screen.get("marker_created_before_first_member") is not True
        or screen.get("marker_created_before_screen_open") is not True
    ):
        raise VerificationError("SCREEN_CUSTODY_INVALID")
    for field, expected in (
        ("allowed_screen_count", 1),
        ("screen_ordinal", 1),
        ("screen_archive_member_open_count_before", 0),
    ):
        _require_exact_nonnegative_int(
            screen,
            field,
            expected,
            "SCREEN_CUSTODY_INVALID",
        )

    _require_file_link(
        universe,
        "preseal_file_sha256",
        root,
        "preseal.v1.json",
        "UNIVERSE_PRESEAL_LINK_INVALID",
    )
    _require_file_link(
        universe,
        "screen_consumed_file_sha256",
        root,
        "screen_consumed.v1.json",
        "UNIVERSE_SCREEN_LINK_INVALID",
    )
    symbols, june_evidence, universe_complete = _validate_universe(universe)

    _require_file_link(
        manifest,
        "universe_file_sha256",
        root,
        "universe.v1.json",
        "MANIFEST_UNIVERSE_LINK_INVALID",
    )
    manifest_complete = _validate_manifest(
        manifest,
        symbols,
        june_evidence,
        universe_complete=universe_complete,
    )
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise VerificationError("MANIFEST_ENTRIES_INVALID")
    manifest_status = manifest.get("status")
    if (manifest_status == "COMPLETE") is not manifest_complete:
        raise VerificationError("MANIFEST_STATUS_INVALID")
    if not manifest_complete and manifest_status != "INVALID_EVIDENCE":
        raise VerificationError("MANIFEST_STATUS_INVALID")
    seen_keys: set[tuple[str, str, str]] = set()
    for entry_value in entries:
        entry = _require_object(entry_value, "MANIFEST_ENTRY_INVALID")
        key = (
            entry.get("symbol"),
            entry.get("month"),
            entry.get("kind"),
        )
        if key in seen_keys or any(not isinstance(part, str) or not part for part in key):
            raise VerificationError("MANIFEST_ENTRY_KEY_INVALID")
        typed_key = (str(key[0]), str(key[1]), str(key[2]))
        if (
            typed_key[0] not in symbols
            or typed_key[1] not in ALL_MONTHS
            or typed_key[2] not in SOURCE_KINDS
        ):
            raise VerificationError("MANIFEST_ENTRY_KEY_INVALID")
        seen_keys.add(typed_key)
        source_url = entry.get("source_url")
        if (
            not isinstance(source_url, str)
            or not source_url.startswith("https://data.binance.vision/data/futures/um/monthly/")
            or "?" in source_url
            or "#" in source_url
        ):
            raise VerificationError("MANIFEST_SOURCE_URL_INVALID")
        if not _safe_relative_path(entry.get("local_relative_path")):
            raise VerificationError("MANIFEST_PATH_INVALID")
        availability = entry.get("availability")
        if availability not in {"AVAILABLE", "UNAVAILABLE"}:
            raise VerificationError("MANIFEST_AVAILABILITY_INVALID")
        for field in (
            "sidecar_expected_zip_sha256",
            "sidecar_sha256",
            "zip_sha256",
        ):
            value = entry.get(field)
            if value is not None:
                _require_sha256(value, f"MANIFEST_DIGEST_INVALID:{field}")
        if availability == "AVAILABLE":
            zip_sha = _require_sha256(
                entry.get("zip_sha256"),
                "MANIFEST_ZIP_DIGEST_INVALID",
            )
            _require_sha256(
                entry.get("sidecar_sha256"),
                "MANIFEST_SIDECAR_DIGEST_INVALID",
            )
            if (
                _require_sha256(
                    entry.get("sidecar_expected_zip_sha256"),
                    "MANIFEST_PUBLISHER_DIGEST_INVALID",
                )
                != zip_sha
                or entry.get("http_status") is not None
                or entry.get("acquisition_state")
                != "LOCAL_OFFICIAL_ARCHIVE_REUSE_CHECKSUM_VERIFIED"
                or not isinstance(entry.get("byte_count"), int)
                or entry["byte_count"] <= 0
            ):
                raise VerificationError("MANIFEST_AVAILABLE_ENTRY_INVALID")
        month = typed_key[1]
        expected_member_state = (
            "SCREEN_OPENED_ONCE" if month in SCREEN_MONTHS else "OPAQUE_UNOPENED"
        )
        if entry.get("member_state") != expected_member_state:
            raise VerificationError("MANIFEST_MEMBER_STATE_INVALID")
    if manifest.get("entry_count") != len(entries):
        raise VerificationError("MANIFEST_ENTRY_COUNT_INVALID")
    for field in (
        "development_archive_member_open_count",
        "holdout_archive_member_open_count",
    ):
        _require_exact_nonnegative_int(
            manifest,
            field,
            0,
            "MANIFEST_MEMBER_CUSTODY_INVALID",
        )
    if manifest_complete:
        expected_keys = {
            (symbol, month, kind)
            for symbol in symbols
            for month in ALL_MONTHS
            for kind in SOURCE_KINDS
        }
        if (
            not universe_complete
            or seen_keys != expected_keys
            or len(entries) != 1170
            or any(
                not isinstance(entry, dict) or entry.get("availability") != "AVAILABLE"
                for entry in entries
            )
        ):
            raise VerificationError("MANIFEST_CARTESIAN_COVERAGE_INVALID")

    if (
        set(freeze)
        != {
            "allowed_run_count",
            "bound_files",
            "canonical_base",
            "created_at",
            "development_archive_member_open_count",
            "holdout_archive_member_open_count",
            "preseal_file_sha256",
            "schema",
            "screen_consumed_file_sha256",
            "source_manifest_file_sha256",
            "trial_ledger_file_sha256",
            "universe_file_sha256",
        }
        or freeze.get("canonical_base") != BASE_COMMIT
    ):
        raise VerificationError("FREEZE_BASE_INVALID")
    if set(run) != {
        "allowed_run_count",
        "created_at",
        "development_archive_member_open_count_before",
        "freeze_file_sha256",
        "frozen_commit",
        "holdout_archive_member_open_count_before",
        "marker_created_before_development_open",
        "protocol_file_sha256",
        "run_ordinal",
        "schema",
        "source_manifest_file_sha256",
        "trial_ledger_file_sha256",
        "universe_file_sha256",
    }:
        raise VerificationError("RUN_SCHEMA_INVALID")
    for field, target in (
        ("preseal_file_sha256", "preseal.v1.json"),
        ("screen_consumed_file_sha256", "screen_consumed.v1.json"),
        ("universe_file_sha256", "universe.v1.json"),
        ("source_manifest_file_sha256", "source_manifest.v1.json"),
        ("trial_ledger_file_sha256", "trial_ledger.v1.json"),
    ):
        _require_file_link(freeze, field, root, target, f"FREEZE_LINK_INVALID:{field}")
    _require_binding_map(
        freeze,
        "bound_files",
        FREEZE_BINDINGS,
        root,
        "FREEZE_BINDINGS_INVALID",
    )
    for field, expected in (
        ("allowed_run_count", 1),
        ("development_archive_member_open_count", 0),
        ("holdout_archive_member_open_count", 0),
    ):
        _require_exact_nonnegative_int(
            freeze,
            field,
            expected,
            "FREEZE_CUSTODY_INVALID",
        )

    for field, target in (
        ("freeze_file_sha256", "freeze.v1.json"),
        ("protocol_file_sha256", "protocol.v1.json"),
        ("source_manifest_file_sha256", "source_manifest.v1.json"),
        ("universe_file_sha256", "universe.v1.json"),
        ("trial_ledger_file_sha256", "trial_ledger.v1.json"),
    ):
        _require_file_link(run, field, root, target, f"RUN_LINK_INVALID:{field}")
    frozen_commit = run.get("frozen_commit")
    for field, expected in (
        ("allowed_run_count", 1),
        ("run_ordinal", 1),
        ("development_archive_member_open_count_before", 0),
        ("holdout_archive_member_open_count_before", 0),
    ):
        _require_exact_nonnegative_int(
            run,
            field,
            expected,
            "RUN_CUSTODY_INVALID",
        )
    if (
        run.get("marker_created_before_development_open") is not True
        or not isinstance(frozen_commit, str)
        or FROZEN_COMMIT_PATTERN.fullmatch(frozen_commit) is None
    ):
        raise VerificationError("RUN_CUSTODY_INVALID")
    return universe_complete and manifest_complete


def _protocol_threshold(
    thresholds: Mapping[str, Any],
    key: str,
    code: str,
) -> Decimal:
    value = thresholds.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise VerificationError(code)
    try:
        parsed = Decimal(str(value))
    except InvalidOperation as exc:
        raise VerificationError(code) from exc
    if not parsed.is_finite():
        raise VerificationError(code)
    return parsed


def _validate_trial_summary(
    value: Any,
    *,
    expected_trial_id: str,
) -> dict[str, Any]:
    summary = _require_exact_keys(
        value,
        TRIAL_SUMMARY_KEYS,
        f"DEVELOPMENT_TRIAL_SCHEMA_INVALID:{expected_trial_id}",
    )
    if summary.get("trial_id") != expected_trial_id:
        raise VerificationError("DEVELOPMENT_TRIAL_LEDGER_DRIFT")
    for field in (
        "active_cohorts",
        "active_weeks",
        "distinct_traded_symbols",
        "skipped_active_epochs",
        "valid_cash_epochs",
        "valid_decision_epochs",
    ):
        _require_nonnegative_int(
            summary.get(field),
            f"DEVELOPMENT_TRIAL_COUNTER_INVALID:{expected_trial_id}:{field}",
        )
    for field in (
        "base_bonferroni_lcb",
        "base_net_usd_per_1000",
        "remove_best_month_stress_net_usd_per_1000",
        "remove_best_symbol_stress_net_usd_per_1000",
        "severe_net_usd_per_1000",
        "stress_bonferroni_lcb",
        "stress_net_usd_per_1000",
    ):
        _require_decimal(
            summary.get(field),
            f"DEVELOPMENT_TRIAL_DECIMAL_INVALID:{expected_trial_id}:{field}",
        )
    for field in ("base_p_value", "holm_adjusted_p", "stress_p_value"):
        _require_probability(
            summary.get(field),
            f"DEVELOPMENT_TRIAL_PROBABILITY_INVALID:{expected_trial_id}:{field}",
        )
    _require_decimal(
        summary.get("severe_hourly_marked_equity_max_drawdown"),
        f"DEVELOPMENT_TRIAL_DRAWDOWN_INVALID:{expected_trial_id}",
        minimum=Decimal(0),
    )
    _require_intervals(
        summary.get("bootstrap_interval_usd_per_1000"),
        f"DEVELOPMENT_TRIAL_INTERVAL_INVALID:{expected_trial_id}",
    )
    _validate_capacity(
        summary.get("public_capacity_proxy_usd"),
        f"DEVELOPMENT_TRIAL_CAPACITY_INVALID:{expected_trial_id}",
    )
    gates = _require_object(
        summary.get("development_gates"),
        f"DEVELOPMENT_TRIAL_GATES_INVALID:{expected_trial_id}",
    )
    if set(gates) != DEVELOPMENT_GATE_KEYS or any(
        not isinstance(value, bool) for value in gates.values()
    ):
        raise VerificationError(f"DEVELOPMENT_TRIAL_GATES_INVALID:{expected_trial_id}")
    if not isinstance(summary.get("passes_all_development_gates"), bool):
        raise VerificationError(f"DEVELOPMENT_TRIAL_PASS_INVALID:{expected_trial_id}")
    return summary


def _validate_holm_adjustments(summaries: Sequence[Mapping[str, Any]]) -> None:
    ordered_raw = sorted(
        (
            (
                max(
                    _require_probability(
                        summary["base_p_value"],
                        "DEVELOPMENT_TRIAL_PROBABILITY_INVALID",
                    ),
                    _require_probability(
                        summary["stress_p_value"],
                        "DEVELOPMENT_TRIAL_PROBABILITY_INVALID",
                    ),
                ),
                str(summary["trial_id"]),
            )
            for summary in summaries
        ),
        key=lambda item: (item[0], item[1]),
    )
    expected_by_trial: dict[str, Decimal] = {}
    running = Decimal(0)
    for index, (raw_p, trial_id) in enumerate(ordered_raw):
        step = min(Decimal(1), Decimal(12 - index) * raw_p)
        running = max(running, step)
        expected_by_trial[trial_id] = running
    for summary in summaries:
        supplied = _require_probability(
            summary["holm_adjusted_p"],
            "DEVELOPMENT_TRIAL_PROBABILITY_INVALID",
        )
        if supplied != expected_by_trial[str(summary["trial_id"])]:
            raise VerificationError("HOLM_DERIVATION_INVALID")


def _derive_development_gates(
    summary: Mapping[str, Any],
    pbo: Mapping[str, Any],
    white: Mapping[str, Decimal],
    protocol: Mapping[str, Any],
    *,
    pre_run_complete: bool,
) -> dict[str, bool]:
    thresholds = _require_object(
        protocol.get("development_gates"),
        "PROTOCOL_DEVELOPMENT_GATES_INVALID",
    )
    threshold_code = "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID"
    capacity = _validate_capacity(
        summary["public_capacity_proxy_usd"],
        "DEVELOPMENT_TRIAL_CAPACITY_INVALID",
    )
    return {
        "active_cohorts_min": (
            summary["active_cohorts"]
            >= _protocol_threshold(thresholds, "active_cohorts_min", threshold_code)
        ),
        "active_weeks_min": (
            summary["active_weeks"]
            >= _protocol_threshold(thresholds, "active_weeks_min", threshold_code)
        ),
        "base_capacity_min_usd_gte": (
            capacity["minimum"]
            >= _protocol_threshold(
                thresholds,
                "base_capacity_min_usd_gte",
                threshold_code,
            )
        ),
        "base_net_usd_per_1000_gt": (
            _require_decimal(
                summary["base_net_usd_per_1000"],
                "DEVELOPMENT_TRIAL_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "base_net_usd_per_1000_gt",
                threshold_code,
            )
        ),
        "bonferroni_base_lower_bound_gt": (
            _require_decimal(
                summary["base_bonferroni_lcb"],
                "DEVELOPMENT_TRIAL_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "bonferroni_base_lower_bound_gt",
                threshold_code,
            )
        ),
        "bonferroni_stress_lower_bound_gt": (
            _require_decimal(
                summary["stress_bonferroni_lcb"],
                "DEVELOPMENT_TRIAL_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "bonferroni_stress_lower_bound_gt",
                threshold_code,
            )
        ),
        "champion_holm_p_lte": (
            _require_probability(
                summary["holm_adjusted_p"],
                "DEVELOPMENT_TRIAL_METRIC_INVALID",
            )
            <= _protocol_threshold(
                thresholds,
                "champion_holm_p_lte",
                threshold_code,
            )
        ),
        "distinct_traded_symbols_min": (
            summary["distinct_traded_symbols"]
            >= _protocol_threshold(
                thresholds,
                "distinct_traded_symbols_min",
                threshold_code,
            )
        ),
        "pbo_lte": (
            _require_probability(pbo["pbo"], "DEVELOPMENT_PBO_INVALID")
            <= _protocol_threshold(thresholds, "pbo_lte", threshold_code)
        ),
        "remove_best_month_stress_net_usd_per_1000_gt": (
            _require_decimal(
                summary["remove_best_month_stress_net_usd_per_1000"],
                "DEVELOPMENT_TRIAL_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "remove_best_month_stress_net_usd_per_1000_gt",
                threshold_code,
            )
        ),
        "remove_best_symbol_stress_net_usd_per_1000_gt": (
            _require_decimal(
                summary["remove_best_symbol_stress_net_usd_per_1000"],
                "DEVELOPMENT_TRIAL_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "remove_best_symbol_stress_net_usd_per_1000_gt",
                threshold_code,
            )
        ),
        "severe_hourly_marked_equity_max_drawdown_lte": (
            _require_decimal(
                summary["severe_hourly_marked_equity_max_drawdown"],
                "DEVELOPMENT_TRIAL_METRIC_INVALID",
            )
            <= _protocol_threshold(
                thresholds,
                "severe_hourly_marked_equity_max_drawdown_lte",
                threshold_code,
            )
        ),
        "stress_net_usd_per_1000_gt": (
            _require_decimal(
                summary["stress_net_usd_per_1000"],
                "DEVELOPMENT_TRIAL_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "stress_net_usd_per_1000_gt",
                threshold_code,
            )
        ),
        "valid_causal_decision_epochs_min": (
            summary["valid_decision_epochs"]
            >= _protocol_threshold(
                thresholds,
                "valid_causal_decision_epochs_min",
                threshold_code,
            )
        ),
        "valid_complete_source_manifest": (
            pre_run_complete and thresholds.get("valid_complete_source_manifest") is True
        ),
        "white_reality_check_base_p_lte": (
            white["base"]
            <= _protocol_threshold(
                thresholds,
                "white_reality_check_base_p_lte",
                threshold_code,
            )
        ),
        "white_reality_check_stress_p_lte": (
            white["stress"]
            <= _protocol_threshold(
                thresholds,
                "white_reality_check_stress_p_lte",
                threshold_code,
            )
        ),
    }


def _validate_development(
    root: Path,
    development: Mapping[str, Any],
    ledger: Mapping[str, Any],
    protocol: Mapping[str, Any],
    *,
    pre_run_complete: bool,
) -> dict[str, Any]:
    if set(development) != {
        "admitted_to_holdout",
        "champion_trial_id",
        "created_at",
        "development_archive_member_open_count",
        "freeze_file_sha256",
        "frozen_commit",
        "holdout_archive_member_open_count",
        "holdout_open_gates",
        "outcome_state",
        "pbo",
        "protocol_file_sha256",
        "reported_trial_id",
        "run_consumed_file_sha256",
        "schema",
        "source_manifest_file_sha256",
        "trial_ledger_file_sha256",
        "trials",
        "white_reality_check_p_by_scenario",
    }:
        raise VerificationError("DEVELOPMENT_SCHEMA_INVALID")
    for field, target in (
        ("run_consumed_file_sha256", "run_consumed.v1.json"),
        ("freeze_file_sha256", "freeze.v1.json"),
        ("protocol_file_sha256", "protocol.v1.json"),
        ("source_manifest_file_sha256", "source_manifest.v1.json"),
        ("trial_ledger_file_sha256", "trial_ledger.v1.json"),
    ):
        _require_file_link(
            development,
            field,
            root,
            target,
            f"DEVELOPMENT_LINK_INVALID:{field}",
        )
    if development.get("outcome_state") != "MEASURED":
        raise VerificationError("DEVELOPMENT_NOT_MEASURED")
    development_open_count = _require_nonnegative_int(
        development.get("development_archive_member_open_count"),
        "DEVELOPMENT_MEMBER_OPEN_COUNT_INVALID",
    )
    holdout_open_count = _require_nonnegative_int(
        development.get("holdout_archive_member_open_count"),
        "DEVELOPMENT_MEMBER_OPEN_COUNT_INVALID",
    )
    if development_open_count != 900 or holdout_open_count != 0:
        raise VerificationError("DEVELOPMENT_OPENED_HOLDOUT")
    run = load_canonical_json(
        root / "run_consumed.v1.json",
        EXPECTED_SCHEMAS["run_consumed.v1.json"],
    )
    if development.get("frozen_commit") != run.get("frozen_commit"):
        raise VerificationError("DEVELOPMENT_FROZEN_COMMIT_INVALID")
    summaries = development.get("trials")
    if not isinstance(summaries, list) or len(summaries) != 12:
        raise VerificationError("DEVELOPMENT_TRIAL_COUNT_INVALID")
    ledger_trials = ledger.get("trials")
    assert isinstance(ledger_trials, list)
    ledger_ids = [trial["trial_id"] for trial in ledger_trials if isinstance(trial, dict)]
    if ledger_ids != [spec["trial_id"] for spec in TRIAL_SPECS]:
        raise VerificationError("DEVELOPMENT_TRIAL_LEDGER_DRIFT")
    validated_summaries = [
        _validate_trial_summary(value, expected_trial_id=trial_id)
        for value, trial_id in zip(summaries, ledger_ids, strict=True)
    ]
    _validate_holm_adjustments(validated_summaries)
    champion_id = development.get("champion_trial_id")
    reported_id = development.get("reported_trial_id")
    if (champion_id is not None and champion_id not in ledger_ids) or reported_id not in ledger_ids:
        raise VerificationError("DEVELOPMENT_CHAMPION_INVALID")

    def metric_key(
        summary: Mapping[str, Any],
    ) -> tuple[Decimal, Decimal, Decimal, str]:
        return (
            -min(
                _require_decimal(
                    summary["base_bonferroni_lcb"],
                    "DEVELOPMENT_CHAMPION_METRIC_INVALID",
                ),
                _require_decimal(
                    summary["stress_bonferroni_lcb"],
                    "DEVELOPMENT_CHAMPION_METRIC_INVALID",
                ),
            ),
            -_require_decimal(
                summary["stress_net_usd_per_1000"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            ),
            _require_decimal(
                summary["severe_hourly_marked_equity_max_drawdown"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            ),
            str(summary["trial_id"]),
        )

    global_metric_winner = min(
        validated_summaries,
        key=metric_key,
    )
    gates = _require_object(
        development.get("holdout_open_gates"),
        "DEVELOPMENT_GATES_INVALID",
    )
    if set(gates) != DEVELOPMENT_GATE_KEYS or any(
        not isinstance(value, bool) for value in gates.values()
    ):
        raise VerificationError("DEVELOPMENT_GATES_INVALID")
    pbo = _validate_pbo(development.get("pbo"), "DEVELOPMENT_PBO_INVALID")
    white = _validate_white(
        development.get("white_reality_check_p_by_scenario"),
        "DEVELOPMENT_WHITE_INVALID",
    )
    passing_summaries: list[Mapping[str, Any]] = []
    for summary in validated_summaries:
        derived = _derive_development_gates(
            summary,
            pbo,
            white,
            protocol,
            pre_run_complete=pre_run_complete,
        )
        if summary["development_gates"] != derived:
            raise VerificationError(
                f"DEVELOPMENT_TRIAL_GATE_DERIVATION_INVALID:{summary['trial_id']}"
            )
        passes = all(derived.values())
        if summary["passes_all_development_gates"] is not passes:
            raise VerificationError(f"DEVELOPMENT_TRIAL_PASS_INVALID:{summary['trial_id']}")
        if passes:
            passing_summaries.append(summary)
    eligible_champion = min(passing_summaries, key=metric_key) if passing_summaries else None
    reported_summary = eligible_champion or global_metric_winner
    if (
        champion_id != (eligible_champion["trial_id"] if eligible_champion is not None else None)
        or reported_id != reported_summary["trial_id"]
    ):
        raise VerificationError("DEVELOPMENT_CHAMPION_SELECTION_INVALID")
    expected_champion = reported_summary
    thresholds = _require_object(
        protocol.get("development_gates"),
        "PROTOCOL_DEVELOPMENT_GATES_INVALID",
    )
    capacity = _validate_capacity(
        expected_champion["public_capacity_proxy_usd"],
        "DEVELOPMENT_CHAMPION_CAPACITY_INVALID",
    )
    expected_gates = {
        "active_cohorts_min": (
            expected_champion["active_cohorts"]
            >= _protocol_threshold(
                thresholds,
                "active_cohorts_min",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "active_weeks_min": (
            expected_champion["active_weeks"]
            >= _protocol_threshold(
                thresholds,
                "active_weeks_min",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "base_capacity_min_usd_gte": (
            capacity["minimum"]
            >= _protocol_threshold(
                thresholds,
                "base_capacity_min_usd_gte",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "base_net_usd_per_1000_gt": (
            _require_decimal(
                expected_champion["base_net_usd_per_1000"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "base_net_usd_per_1000_gt",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "bonferroni_base_lower_bound_gt": (
            _require_decimal(
                expected_champion["base_bonferroni_lcb"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "bonferroni_base_lower_bound_gt",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "bonferroni_stress_lower_bound_gt": (
            _require_decimal(
                expected_champion["stress_bonferroni_lcb"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "bonferroni_stress_lower_bound_gt",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "champion_holm_p_lte": (
            _require_probability(
                expected_champion["holm_adjusted_p"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            )
            <= _protocol_threshold(
                thresholds,
                "champion_holm_p_lte",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "distinct_traded_symbols_min": (
            expected_champion["distinct_traded_symbols"]
            >= _protocol_threshold(
                thresholds,
                "distinct_traded_symbols_min",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "pbo_lte": (
            _require_probability(pbo["pbo"], "DEVELOPMENT_PBO_INVALID")
            <= _protocol_threshold(
                thresholds,
                "pbo_lte",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "remove_best_month_stress_net_usd_per_1000_gt": (
            _require_decimal(
                expected_champion["remove_best_month_stress_net_usd_per_1000"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "remove_best_month_stress_net_usd_per_1000_gt",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "remove_best_symbol_stress_net_usd_per_1000_gt": (
            _require_decimal(
                expected_champion["remove_best_symbol_stress_net_usd_per_1000"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "remove_best_symbol_stress_net_usd_per_1000_gt",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "severe_hourly_marked_equity_max_drawdown_lte": (
            _require_decimal(
                expected_champion["severe_hourly_marked_equity_max_drawdown"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            )
            <= _protocol_threshold(
                thresholds,
                "severe_hourly_marked_equity_max_drawdown_lte",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "stress_net_usd_per_1000_gt": (
            _require_decimal(
                expected_champion["stress_net_usd_per_1000"],
                "DEVELOPMENT_CHAMPION_METRIC_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "stress_net_usd_per_1000_gt",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "valid_causal_decision_epochs_min": (
            expected_champion["valid_decision_epochs"]
            >= _protocol_threshold(
                thresholds,
                "valid_causal_decision_epochs_min",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "valid_complete_source_manifest": (
            pre_run_complete and thresholds.get("valid_complete_source_manifest") is True
        ),
        "white_reality_check_base_p_lte": (
            white["base"]
            <= _protocol_threshold(
                thresholds,
                "white_reality_check_base_p_lte",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
        "white_reality_check_stress_p_lte": (
            white["stress"]
            <= _protocol_threshold(
                thresholds,
                "white_reality_check_stress_p_lte",
                "PROTOCOL_DEVELOPMENT_THRESHOLD_INVALID",
            )
        ),
    }
    if gates != expected_gates:
        raise VerificationError("DEVELOPMENT_GATE_DERIVATION_INVALID")
    computed_admission = all(expected_gates.values())
    admitted = development.get("admitted_to_holdout")
    if (
        not isinstance(admitted, bool)
        or admitted != computed_admission
        or admitted is not (champion_id is not None)
    ):
        raise VerificationError("DEVELOPMENT_ADMISSION_MISMATCH")
    return {
        "admitted": admitted,
        "champion": eligible_champion,
        "pbo": pbo,
        "reported": reported_summary,
        "summaries": validated_summaries,
        "white": white,
    }


def _validate_result_authority(result: Mapping[str, Any]) -> None:
    if result.get("capital_authority") != "NO_GO":
        raise VerificationError("RESULT_CAPITAL_AUTHORITY_INVALID")
    if result.get("execution_authority") != "NONE":
        raise VerificationError("RESULT_EXECUTION_AUTHORITY_INVALID")
    if result.get("positive_edge_claim") is not False:
        raise VerificationError("RESULT_POSITIVE_EDGE_CLAIM_INVALID")
    if result.get("account_effective_fees") != "UNKNOWN":
        raise VerificationError("RESULT_ACCOUNT_FEES_OVERCLAIM")
    if result.get("executable_capacity") != "UNKNOWN":
        raise VerificationError("RESULT_EXECUTABLE_CAPACITY_OVERCLAIM")
    _require_exact_json_object(
        result.get("effects"),
        EXPECTED_RESULT_EFFECTS,
        "RESULT_EFFECTS_INVALID",
    )


def _validate_null_economics(result: Mapping[str, Any]) -> None:
    scenario_net = _require_object(
        result.get("net_usd_per_1000_by_scenario"),
        "RESULT_SCENARIO_NET_INVALID",
    )
    if set(scenario_net) != {"base", "severe", "stress"} or any(
        value is not None for value in scenario_net.values()
    ):
        raise VerificationError("UNMEASURED_ECONOMICS_NOT_NULL")
    required_nulls = (
        "bootstrap_intervals",
        "causal_and_activity_counters",
        "holm_p_values",
        "pbo",
        "public_capacity_proxy",
        "remove_best_symbol_and_month_stress_net",
        "severe_hourly_marked_equity_max_drawdown",
        "white_reality_check_p_by_scenario",
    )
    if any(field not in result for field in required_nulls):
        raise VerificationError("RESULT_ECONOMICS_FIELDS_MISSING")
    if any(result[field] is not None for field in required_nulls):
        raise VerificationError("UNMEASURED_ECONOMICS_NOT_NULL")


def _validate_result_schema(
    result: Mapping[str, Any],
    *,
    terminal_unmeasured: bool,
) -> None:
    expected = RESULT_COMMON_KEYS | RESULT_STATE_KEYS
    if terminal_unmeasured:
        expected = expected | {"reason_code"}
    if set(result) != expected:
        raise VerificationError(
            "RESULT_SCHEMA_INVALID:"
            f"missing={sorted(set(expected) - set(result))}:"
            f"extra={sorted(set(result) - set(expected))}"
        )
    limitations = result.get("limitations")
    if (
        not isinstance(limitations, list)
        or len(limitations) < 5
        or any(not isinstance(item, str) or not item for item in limitations)
    ):
        raise VerificationError("RESULT_LIMITATIONS_INVALID")
    _require_exact_nonnegative_int(
        result,
        "selected_source_root_holdout_outcome_rows_opened_before_gates",
        0,
        "RESULT_HOLDOUT_PRE_GATE_DISCLOSURE_INVALID",
    )
    if terminal_unmeasured:
        reason = result.get("reason_code")
        if not isinstance(reason, str) or not reason:
            raise VerificationError("RESULT_REASON_CODE_INVALID")


def _validate_result_custody(
    result: Mapping[str, Any],
    universe: Mapping[str, Any],
    development: Mapping[str, Any] | None,
    holdout: Mapping[str, Any] | None,
) -> None:
    custody = _require_exact_keys(
        result.get("development_and_holdout_custody"),
        {"development", "holdout", "schema_only_probe", "screen"},
        "RESULT_CUSTODY_SCHEMA_INVALID",
    )
    screen = _require_exact_keys(
        custody["screen"],
        {"archive_member_open_count", "open_count", "state"},
        "RESULT_SCREEN_CUSTODY_INVALID",
    )
    screen_archive_count = _require_nonnegative_int(
        screen.get("archive_member_open_count"),
        "RESULT_SCREEN_CUSTODY_INVALID",
    )
    expected_screen_archive_count = _require_nonnegative_int(
        universe.get("screen_archive_member_open_count"),
        "RESULT_SCREEN_CUSTODY_INVALID",
    )
    screen_open_count = _require_nonnegative_int(
        screen.get("open_count"),
        "RESULT_SCREEN_CUSTODY_INVALID",
    )
    if (
        screen_archive_count != expected_screen_archive_count
        or screen_open_count != 1
        or screen.get("state") != "OPENED_ONCE_JUNE_ONLY"
    ):
        raise VerificationError("RESULT_SCREEN_CUSTODY_INVALID")
    probe = _require_exact_keys(
        custody["schema_only_probe"],
        {"disclosed", "outcome_rows_opened", "outside_selected_source_root"},
        "RESULT_PROBE_CUSTODY_INVALID",
    )
    if canonical_bytes(probe) != canonical_bytes(EXPECTED_SCHEMA_PROBE_CUSTODY):
        raise VerificationError("RESULT_PROBE_CUSTODY_INVALID")
    development_custody = _require_exact_keys(
        custody["development"],
        {"archive_member_open_count", "state"},
        "RESULT_DEVELOPMENT_CUSTODY_INVALID",
    )
    development_count = _require_nonnegative_int(
        development_custody.get("archive_member_open_count"),
        "RESULT_DEVELOPMENT_CUSTODY_INVALID",
    )
    if development is None:
        if development_count > 900 or development_custody.get("state") != "RUN_CONSUMED_UNMEASURED":
            raise VerificationError("RESULT_DEVELOPMENT_CUSTODY_INVALID")
    elif development_custody.get(
        "state"
    ) != "MEASURED_ONCE" or development_count != development.get(
        "development_archive_member_open_count"
    ):
        raise VerificationError("RESULT_DEVELOPMENT_CUSTODY_INVALID")
    holdout_custody = _require_exact_keys(
        custody["holdout"],
        {
            "archive_member_open_count",
            "open_count",
            "outcome_rows_opened_before_gates",
            "state",
        },
        "RESULT_HOLDOUT_CUSTODY_INVALID",
    )
    holdout_count = _require_nonnegative_int(
        holdout_custody.get("archive_member_open_count"),
        "RESULT_HOLDOUT_CUSTODY_INVALID",
    )
    outcome_rows_before_gates = _require_nonnegative_int(
        holdout_custody.get("outcome_rows_opened_before_gates"),
        "RESULT_HOLDOUT_CUSTODY_INVALID",
    )
    holdout_open_count = _require_nonnegative_int(
        holdout_custody.get("open_count"),
        "RESULT_HOLDOUT_CUSTODY_INVALID",
    )
    if outcome_rows_before_gates != 0:
        raise VerificationError("RESULT_HOLDOUT_CUSTODY_INVALID")
    if holdout is None:
        if (
            holdout_count != 0
            or holdout_open_count != 0
            or holdout_custody.get("state") != "UNOPENED"
        ):
            raise VerificationError("RESULT_HOLDOUT_CUSTODY_INVALID")
    elif (
        holdout_count != holdout.get("holdout_archive_member_open_count")
        or holdout_open_count != 1
        or holdout_custody.get("state") != "OPENED_ONCE_CHAMPION_ONLY"
    ):
        raise VerificationError("RESULT_HOLDOUT_CUSTODY_INVALID")


def _validate_result_counters(value: Any) -> dict[str, Any]:
    counters = _require_exact_keys(
        value,
        RESULT_COUNTER_KEYS,
        "RESULT_COUNTERS_INVALID",
    )
    for key in RESULT_COUNTER_KEYS:
        _require_nonnegative_int(counters[key], f"RESULT_COUNTERS_INVALID:{key}")
    return counters


def _validate_measured_result_metrics(
    result: Mapping[str, Any],
    development_validation: Mapping[str, Any],
    *,
    holdout_summary: Mapping[str, Any] | None,
) -> None:
    champion = cast(Mapping[str, Any], development_validation["reported"])
    summaries = cast(Sequence[Mapping[str, Any]], development_validation["summaries"])
    if holdout_summary is None:
        expected_net = {
            "base": champion["base_net_usd_per_1000"],
            "severe": champion["severe_net_usd_per_1000"],
            "stress": champion["stress_net_usd_per_1000"],
        }
        expected_intervals = champion["bootstrap_interval_usd_per_1000"]
        expected_capacity = champion["public_capacity_proxy_usd"]
        expected_drawdown = champion["severe_hourly_marked_equity_max_drawdown"]
        expected_counters = {
            "active_cohorts": champion["active_cohorts"],
            "active_weeks": champion["active_weeks"],
            "distinct_traded_symbols": champion["distinct_traded_symbols"],
            "skipped_active_epochs": champion["skipped_active_epochs"],
            "valid_cash_epochs": champion["valid_cash_epochs"],
            "valid_causal_decision_epochs": champion["valid_decision_epochs"],
        }
        expected_robustness = {
            "remove_best_month_stress_net_usd_per_1000": champion[
                "remove_best_month_stress_net_usd_per_1000"
            ],
            "remove_best_symbol_stress_net_usd_per_1000": champion[
                "remove_best_symbol_stress_net_usd_per_1000"
            ],
        }
        _validate_capacity(
            result.get("public_capacity_proxy"),
            "RESULT_CAPACITY_INVALID",
        )
    else:
        expected_net = holdout_summary["net_usd_per_1000_by_scenario"]
        expected_intervals = holdout_summary["bootstrap_intervals"]
        expected_capacity = holdout_summary["public_capacity_proxy_usd"]
        expected_drawdown = holdout_summary["severe_hourly_marked_equity_max_drawdown"]
        expected_counters = {
            "active_cohorts": holdout_summary["active_cohorts"],
            "active_weeks": holdout_summary["active_weeks"],
            "distinct_traded_symbols": holdout_summary["distinct_traded_symbols"],
            "skipped_active_epochs": holdout_summary["skipped_active_epochs"],
            "valid_cash_epochs": holdout_summary["valid_cash_epochs"],
            "valid_causal_decision_epochs": holdout_summary["valid_decision_epochs"],
        }
        expected_robustness = {
            "remove_best_month_stress_net_usd_per_1000": holdout_summary[
                "remove_best_month_stress_net_usd_per_1000"
            ],
            "remove_best_symbol_stress_net_usd_per_1000": holdout_summary[
                "remove_best_symbol_stress_net_usd_per_1000"
            ],
        }
        _validate_capacity(
            result.get("public_capacity_proxy"),
            "RESULT_CAPACITY_INVALID",
        )
    _require_scenario_decimals(
        result.get("net_usd_per_1000_by_scenario"),
        "RESULT_SCENARIO_NET_INVALID",
    )
    _require_intervals(result.get("bootstrap_intervals"), "RESULT_INTERVAL_INVALID")
    counters = _validate_result_counters(result.get("causal_and_activity_counters"))
    robustness = _require_exact_keys(
        result.get("remove_best_symbol_and_month_stress_net"),
        {
            "remove_best_month_stress_net_usd_per_1000",
            "remove_best_symbol_stress_net_usd_per_1000",
        },
        "RESULT_ROBUSTNESS_INVALID",
    )
    for key in robustness:
        _require_decimal(robustness[key], f"RESULT_ROBUSTNESS_INVALID:{key}")
    _require_decimal(
        result.get("severe_hourly_marked_equity_max_drawdown"),
        "RESULT_DRAWDOWN_INVALID",
        minimum=Decimal(0),
    )
    holm = _require_exact_keys(
        result.get("holm_p_values"),
        {str(summary["trial_id"]) for summary in summaries},
        "RESULT_HOLM_INVALID",
    )
    for trial_id, value in holm.items():
        _require_probability(value, f"RESULT_HOLM_INVALID:{trial_id}")
    expected_holm = {str(summary["trial_id"]): summary["holm_adjusted_p"] for summary in summaries}
    result_white = _validate_white(
        result.get("white_reality_check_p_by_scenario"),
        "RESULT_WHITE_INVALID",
    )
    result_pbo = _validate_pbo(result.get("pbo"), "RESULT_PBO_INVALID")
    if (
        result.get("net_usd_per_1000_by_scenario") != expected_net
        or result.get("bootstrap_intervals") != expected_intervals
        or result.get("public_capacity_proxy") != expected_capacity
        or result.get("severe_hourly_marked_equity_max_drawdown") != expected_drawdown
        or counters != expected_counters
        or robustness != expected_robustness
        or holm != expected_holm
        or result_white != development_validation["white"]
        or result_pbo != development_validation["pbo"]
    ):
        raise VerificationError("RESULT_DERIVATION_INVALID")


def _validate_holdout_summary(value: Any) -> dict[str, Any]:
    summary = _require_exact_keys(
        value,
        HOLDOUT_SUMMARY_KEYS,
        "HOLDOUT_SUMMARY_SCHEMA_INVALID",
    )
    for field in (
        "active_cohorts",
        "active_weeks",
        "distinct_traded_symbols",
        "skipped_active_epochs",
        "valid_cash_epochs",
        "valid_decision_epochs",
    ):
        _require_nonnegative_int(
            summary.get(field),
            f"HOLDOUT_COUNTER_INVALID:{field}",
        )
    _require_scenario_decimals(
        summary.get("net_usd_per_1000_by_scenario"),
        "HOLDOUT_NET_INVALID",
    )
    _require_intervals(
        summary.get("bootstrap_intervals"),
        "HOLDOUT_INTERVAL_INVALID",
    )
    _require_scenario_decimals(
        summary.get("pointwise_lcb"),
        "HOLDOUT_POINTWISE_LCB_INVALID",
    )
    _validate_capacity(
        summary.get("public_capacity_proxy_usd"),
        "HOLDOUT_CAPACITY_INVALID",
    )
    for field in (
        "remove_best_month_stress_net_usd_per_1000",
        "remove_best_symbol_stress_net_usd_per_1000",
    ):
        _require_decimal(
            summary.get(field),
            f"HOLDOUT_ROBUSTNESS_INVALID:{field}",
        )
    _require_decimal(
        summary.get("severe_hourly_marked_equity_max_drawdown"),
        "HOLDOUT_DRAWDOWN_INVALID",
        minimum=Decimal(0),
    )
    return summary


def _validate_null_holdout_summary(value: Any) -> dict[str, Any]:
    summary = _require_exact_keys(
        value,
        HOLDOUT_SUMMARY_KEYS,
        "HOLDOUT_UNMEASURED_SUMMARY_SCHEMA_INVALID",
    )
    if any(item is not None for item in summary.values()):
        raise VerificationError("HOLDOUT_UNMEASURED_SUMMARY_NOT_NULL")
    return summary


def _derive_holdout_gates(
    summary: Mapping[str, Any],
    protocol: Mapping[str, Any],
) -> dict[str, bool]:
    thresholds = _require_object(
        protocol.get("holdout_gates_if_opened"),
        "PROTOCOL_HOLDOUT_GATES_INVALID",
    )
    net = _require_scenario_decimals(
        summary.get("net_usd_per_1000_by_scenario"),
        "HOLDOUT_NET_INVALID",
    )
    lcb = _require_scenario_decimals(
        summary.get("pointwise_lcb"),
        "HOLDOUT_POINTWISE_LCB_INVALID",
    )
    return {
        "active_cohorts_min": (
            summary["active_cohorts"]
            >= _protocol_threshold(
                thresholds,
                "active_cohorts_min",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "active_weeks_min": (
            summary["active_weeks"]
            >= _protocol_threshold(
                thresholds,
                "active_weeks_min",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "base_capacity_min_usd_gte": (
            _validate_capacity(
                summary["public_capacity_proxy_usd"],
                "HOLDOUT_CAPACITY_INVALID",
            )["minimum"]
            >= _protocol_threshold(
                thresholds,
                "base_capacity_min_usd_gte",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "base_net_usd_per_1000_gt": (
            net["base"]
            > _protocol_threshold(
                thresholds,
                "base_net_usd_per_1000_gt",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "distinct_traded_symbols_min": (
            summary["distinct_traded_symbols"]
            >= _protocol_threshold(
                thresholds,
                "distinct_traded_symbols_min",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "pointwise_base_lower_bound_gt": (
            lcb["base"]
            > _protocol_threshold(
                thresholds,
                "pointwise_base_lower_bound_gt",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "pointwise_stress_lower_bound_gt": (
            lcb["stress"]
            > _protocol_threshold(
                thresholds,
                "pointwise_stress_lower_bound_gt",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "remove_best_month_stress_net_usd_per_1000_gt": (
            _require_decimal(
                summary["remove_best_month_stress_net_usd_per_1000"],
                "HOLDOUT_ROBUSTNESS_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "remove_best_month_stress_net_usd_per_1000_gt",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "remove_best_symbol_stress_net_usd_per_1000_gt": (
            _require_decimal(
                summary["remove_best_symbol_stress_net_usd_per_1000"],
                "HOLDOUT_ROBUSTNESS_INVALID",
            )
            > _protocol_threshold(
                thresholds,
                "remove_best_symbol_stress_net_usd_per_1000_gt",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "severe_hourly_marked_equity_max_drawdown_lte": (
            _require_decimal(
                summary["severe_hourly_marked_equity_max_drawdown"],
                "HOLDOUT_DRAWDOWN_INVALID",
            )
            <= _protocol_threshold(
                thresholds,
                "severe_hourly_marked_equity_max_drawdown_lte",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
        "stress_net_usd_per_1000_gt": (
            net["stress"]
            > _protocol_threshold(
                thresholds,
                "stress_net_usd_per_1000_gt",
                "PROTOCOL_HOLDOUT_THRESHOLD_INVALID",
            )
        ),
    }


def _validate_holdout_bundle(
    root: Path,
    development: Mapping[str, Any],
    candidate: Mapping[str, Any],
    opened: Mapping[str, Any],
    holdout: Mapping[str, Any],
    result: Mapping[str, Any],
    protocol: Mapping[str, Any],
) -> dict[str, Any]:
    champion_id = development.get("champion_trial_id")
    if set(candidate) != {
        "champion_trial_id",
        "created_at",
        "development_file_sha256",
        "freeze_file_sha256",
        "frozen_commit",
        "run_consumed_file_sha256",
        "schema",
        "source_manifest_file_sha256",
        "trial_ledger_file_sha256",
    }:
        raise VerificationError("CANDIDATE_SCHEMA_INVALID")
    _require_file_link(
        candidate,
        "development_file_sha256",
        root,
        DEVELOPMENT_FILE,
        "CANDIDATE_DEVELOPMENT_LINK_INVALID",
    )
    for field, target in (
        ("freeze_file_sha256", "freeze.v1.json"),
        ("run_consumed_file_sha256", "run_consumed.v1.json"),
        ("source_manifest_file_sha256", "source_manifest.v1.json"),
        ("trial_ledger_file_sha256", "trial_ledger.v1.json"),
    ):
        _require_file_link(candidate, field, root, target, f"CANDIDATE_LINK_INVALID:{field}")
    if candidate.get("champion_trial_id") != champion_id or candidate.get(
        "frozen_commit"
    ) != development.get("frozen_commit"):
        raise VerificationError("CANDIDATE_CHAMPION_INVALID")

    _require_file_link(
        opened,
        "candidate_seal_file_sha256",
        root,
        "candidate_seal.v1.json",
        "HOLDOUT_OPEN_CANDIDATE_LINK_INVALID",
    )
    _require_file_link(
        opened,
        "development_file_sha256",
        root,
        DEVELOPMENT_FILE,
        "HOLDOUT_OPEN_DEVELOPMENT_LINK_INVALID",
    )
    if (
        set(opened)
        != {
            "allowed_holdout_open_count",
            "candidate_seal_file_sha256",
            "champion_trial_id",
            "created_at",
            "development_file_sha256",
            "frozen_commit",
            "holdout_archive_member_open_count_before",
            "holdout_open_ordinal",
            "marker_created_before_first_member",
            "marker_created_before_holdout_open",
            "reserved_holdout_path",
            "reserved_result_path",
            "schema",
        }
        or opened.get("champion_trial_id") != champion_id
        or opened.get("marker_created_before_first_member") is not True
        or opened.get("marker_created_before_holdout_open") is not True
        or opened.get("reserved_holdout_path") != "holdout.v1.json"
        or opened.get("reserved_result_path") != "result.v1.json"
        or opened.get("frozen_commit") != development.get("frozen_commit")
    ):
        raise VerificationError("HOLDOUT_OPEN_CUSTODY_INVALID")
    for field, expected in (
        ("holdout_archive_member_open_count_before", 0),
        ("holdout_open_ordinal", 1),
        ("allowed_holdout_open_count", 1),
    ):
        _require_exact_nonnegative_int(
            opened,
            field,
            expected,
            "HOLDOUT_OPEN_CUSTODY_INVALID",
        )

    _require_file_link(
        holdout,
        "candidate_seal_file_sha256",
        root,
        "candidate_seal.v1.json",
        "HOLDOUT_CANDIDATE_LINK_INVALID",
    )
    _require_file_link(
        holdout,
        "holdout_open_file_sha256",
        root,
        "holdout_open.v1.json",
        "HOLDOUT_MARKER_LINK_INVALID",
    )
    if (
        set(holdout)
        != {
            "all_gates_pass",
            "candidate_seal_file_sha256",
            "champion_trial_id",
            "created_at",
            "frozen_commit",
            "gates",
            "holdout_open_file_sha256",
            "holdout_archive_member_open_count",
            "outcome_state",
            "schema",
            "summary",
        }
        or holdout.get("champion_trial_id") != champion_id
        or holdout.get("frozen_commit") != development.get("frozen_commit")
    ):
        raise VerificationError("HOLDOUT_CHAMPION_INVALID")
    gates = _require_object(holdout.get("gates"), "HOLDOUT_GATES_INVALID")
    holdout_open_count = _require_nonnegative_int(
        holdout.get("holdout_archive_member_open_count"),
        "HOLDOUT_MEMBER_OPEN_COUNT_INVALID",
    )
    if set(gates) != HOLDOUT_GATE_KEYS or any(
        not isinstance(value, bool) for value in gates.values()
    ):
        raise VerificationError("HOLDOUT_GATES_INVALID")
    outcome = holdout.get("outcome_state")
    if outcome == "MEASURED":
        if holdout_open_count != 360:
            raise VerificationError("HOLDOUT_MEMBER_OPEN_COUNT_INVALID")
        summary = _validate_holdout_summary(holdout.get("summary"))
        expected_gates = _derive_holdout_gates(summary, protocol)
        if gates != expected_gates:
            raise VerificationError("HOLDOUT_GATE_DERIVATION_INVALID")
        all_gates_pass = all(expected_gates.values())
    elif outcome == "UNMEASURED":
        if holdout_open_count > 360:
            raise VerificationError("HOLDOUT_MEMBER_OPEN_COUNT_INVALID")
        summary = _validate_null_holdout_summary(holdout.get("summary"))
        if any(gates.values()):
            raise VerificationError("HOLDOUT_UNMEASURED_GATE_INVALID")
        all_gates_pass = False
    else:
        raise VerificationError("HOLDOUT_OUTCOME_INVALID")
    if holdout.get("all_gates_pass") is not all_gates_pass:
        raise VerificationError("HOLDOUT_GATE_SUMMARY_INVALID")
    for field, target in (
        ("candidate_seal_file_sha256", "candidate_seal.v1.json"),
        ("holdout_open_file_sha256", "holdout_open.v1.json"),
        ("holdout_file_sha256", "holdout.v1.json"),
    ):
        _require_file_link(result, field, root, target, f"RESULT_LINK_INVALID:{field}")
    return {
        "all_gates_pass": all_gates_pass,
        "gates": gates,
        "outcome": outcome,
        "archive_member_open_count": holdout_open_count,
        "summary": summary,
    }


def _validate_result_chain(
    root: Path,
    documents: Mapping[str, Mapping[str, Any]],
    inventory: frozenset[str],
    *,
    pre_run_complete: bool,
) -> None:
    result = documents["result.v1.json"]
    protocol = documents["protocol.v1.json"]
    universe = documents["universe.v1.json"]
    for field, target in (
        ("run_consumed_file_sha256", "run_consumed.v1.json"),
        ("freeze_file_sha256", "freeze.v1.json"),
        ("protocol_file_sha256", "protocol.v1.json"),
        ("source_manifest_file_sha256", "source_manifest.v1.json"),
        ("trial_ledger_file_sha256", "trial_ledger.v1.json"),
    ):
        _require_file_link(result, field, root, target, f"RESULT_LINK_INVALID:{field}")
    _validate_result_authority(result)
    run = documents["run_consumed.v1.json"]
    if result.get("frozen_commit") != run.get("frozen_commit"):
        raise VerificationError("RESULT_FROZEN_COMMIT_INVALID")

    development = documents.get(DEVELOPMENT_FILE)
    bundle_present = HOLDOUT_BUNDLE.issubset(inventory)
    if development is None:
        if bundle_present:
            raise VerificationError("HOLDOUT_BUNDLE_WITHOUT_DEVELOPMENT")
        _validate_result_schema(result, terminal_unmeasured=True)
        _require_absent_link(
            result,
            "development_file_sha256",
            "RESULT_DEVELOPMENT_ABSENCE_LINK_INVALID",
        )
        for field in (
            "candidate_seal_file_sha256",
            "holdout_file_sha256",
            "holdout_open_file_sha256",
        ):
            _require_absent_link(result, field, f"RESULT_ABSENT_LINK_INVALID:{field}")
        if (
            result.get("outcome_state") != "TERMINAL_UNMEASURED"
            or result.get("verdict") != "UNMEASURED_RUN_CONSUMED_NO_RERUN"
            or result.get("strategy_verdict") != "UNMEASURED"
            or result.get("holdout_state") != "UNOPENED"
        ):
            raise VerificationError("TERMINAL_UNMEASURED_STATE_INVALID")
        _validate_result_custody(result, universe, None, None)
        _validate_null_economics(result)
        return

    if not pre_run_complete:
        raise VerificationError("DEVELOPMENT_AFTER_INVALID_PRE_RUN")
    _require_file_link(
        result,
        "development_file_sha256",
        root,
        DEVELOPMENT_FILE,
        "RESULT_DEVELOPMENT_LINK_INVALID",
    )
    development_validation = _validate_development(
        root,
        development,
        documents["trial_ledger.v1.json"],
        protocol,
        pre_run_complete=pre_run_complete,
    )
    admitted = development_validation["admitted"]
    if bundle_present is not admitted:
        raise VerificationError("HOLDOUT_BUNDLE_ADMISSION_MISMATCH")
    if not bundle_present:
        _validate_result_schema(result, terminal_unmeasured=False)
        for field in (
            "candidate_seal_file_sha256",
            "holdout_file_sha256",
            "holdout_open_file_sha256",
        ):
            _require_absent_link(result, field, f"RESULT_ABSENT_LINK_INVALID:{field}")
        if (
            result.get("outcome_state") != "MEASURED_DEVELOPMENT_REJECTED"
            or result.get("verdict") != "NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED"
            or result.get("strategy_verdict") != "NO_GO"
            or result.get("holdout_state") != "UNOPENED"
        ):
            raise VerificationError("DEVELOPMENT_REJECTION_STATE_INVALID")
        _validate_result_custody(result, universe, development, None)
        _validate_measured_result_metrics(
            result,
            development_validation,
            holdout_summary=None,
        )
        return

    candidate = documents["candidate_seal.v1.json"]
    opened = documents["holdout_open.v1.json"]
    holdout = documents["holdout.v1.json"]
    holdout_validation = _validate_holdout_bundle(
        root,
        development,
        candidate,
        opened,
        holdout,
        result,
        protocol,
    )
    if result.get("holdout_state") != "OPENED_ONCE_CHAMPION_ONLY":
        raise VerificationError("HOLDOUT_RESULT_STATE_INVALID")
    _validate_result_custody(result, universe, development, holdout)
    if holdout_validation["outcome"] == "UNMEASURED":
        _validate_result_schema(result, terminal_unmeasured=True)
        if (
            result.get("outcome_state") != "TERMINAL_UNMEASURED"
            or result.get("verdict") != "UNMEASURED_RUN_CONSUMED_NO_RERUN"
            or result.get("strategy_verdict") != "UNMEASURED"
        ):
            raise VerificationError("HOLDOUT_UNMEASURED_RESULT_INVALID")
        _validate_null_economics(result)
        return
    _validate_result_schema(result, terminal_unmeasured=False)
    expected_verdict = (
        "PUBLIC_PROXY_PASS_CAPITAL_NO_GO" if holdout_validation["all_gates_pass"] else "NO_GO"
    )
    if (
        result.get("outcome_state") != "MEASURED_HOLDOUT"
        or result.get("verdict") != expected_verdict
        or result.get("strategy_verdict") != "NO_GO"
    ):
        raise VerificationError("HOLDOUT_VERDICT_INVALID")
    _validate_measured_result_metrics(
        result,
        development_validation,
        holdout_summary=cast(
            Mapping[str, Any],
            holdout_validation["summary"],
        ),
    )


def ensure_network_free_verifier(path: Path) -> None:
    """Reject imports that could make this verifier depend on network or processes."""

    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, SyntaxError) as exc:
        raise VerificationError(f"VERIFIER_SOURCE_INVALID:{exc}") from exc
    forbidden = {"aiohttp", "http", "requests", "socket", "subprocess", "urllib"}
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".", maxsplit=1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".", maxsplit=1)[0])
    if forbidden & imported:
        raise VerificationError("VERIFIER_NETWORK_OR_PROCESS_IMPORT")


def verify_packet(root: Path) -> dict[str, Any]:
    packet = root.resolve()
    inventory = verify_exact_inventory(packet)
    verify_sha256sums(packet, inventory)
    documents: dict[str, Mapping[str, Any]] = {}
    for name, schema in EXPECTED_SCHEMAS.items():
        if name in inventory:
            documents[name] = load_canonical_json(packet / name, schema)
    _validate_protocol_documents(
        documents["protocol.v1.json"],
        documents["source_plan.v1.json"],
        documents["trial_ledger.v1.json"],
    )
    pre_run_complete = _validate_pre_run_chain(packet, documents)
    _validate_result_chain(
        packet,
        documents,
        inventory,
        pre_run_complete=pre_run_complete,
    )
    ensure_network_free_verifier(packet / "verifier.py")
    result = documents["result.v1.json"]
    return {
        "archiveMembersOpenedByVerifier": 0,
        "baseCommit": BASE_COMMIT,
        "capitalAuthority": "NO_GO",
        "executionAuthority": "NONE",
        "holdoutState": result["holdout_state"],
        "networkUsedByVerifier": False,
        "packet": str(packet),
        "schema": f"{SCHEMA_PREFIX}.verification_receipt.v1",
        "status": "AUTHENTIC",
        "strategyVerdict": result["strategy_verdict"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="S-1V packet directory (defaults to this verifier's directory)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        receipt = verify_packet(args.root)
    except VerificationError as exc:
        print(f"S1V_VERIFY_FAILED:{exc}", file=sys.stderr)
        return 2
    print(json.dumps(receipt, allow_nan=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
