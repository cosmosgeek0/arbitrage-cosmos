#!/usr/bin/env python3
"""Freeze and verify the RESULT3-PREP1 current-money-answer artifact.

The artifact is a deterministic, source-only projection of four exact accepted
Git objects. It does not call a provider, inspect private/account data, execute
research, infer profitability, authorize capital, or verify live protections.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, NoReturn, cast

SCHEMA_ID = "CurrentMoneyAnswerV1"
VERSION = 1
ANSWER_NAME = "current_money_answer.v1.json"
MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991


class ContractError(RuntimeError):
    """The pinned evidence or materialized current-money answer is invalid."""


def fail(message: str) -> NoReturn:
    raise ContractError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def require_equal(actual: Any, expected: Any, label: str) -> None:
    require(actual == expected, f"{label}: expected {expected!r}, found {actual!r}")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_float(value: str) -> NoReturn:
    fail(f"JSON floats forbidden; use exact decimal strings: {value}")


def reject_constant(value: str) -> NoReturn:
    fail(f"non-finite JSON number: {value}")


def validate_json_value(value: Any, label: str = "$") -> None:
    if value is None or type(value) is bool:
        return
    if type(value) is int:
        require(
            -MAX_SAFE_JSON_INTEGER <= value <= MAX_SAFE_JSON_INTEGER,
            f"{label}: integer outside interoperable JSON range",
        )
        return
    if type(value) is str:
        require(
            all(not 0xD800 <= ord(character) <= 0xDFFF for character in value),
            f"{label}: lone UTF-16 surrogate forbidden",
        )
        return
    if type(value) is list:
        for index, item in enumerate(value):
            validate_json_value(item, f"{label}[{index}]")
        return
    if type(value) is dict:
        for key, item in value.items():
            require(type(key) is str, f"{label}: object key must be a string")
            validate_json_value(key, f"{label}.<key>")
            validate_json_value(item, f"{label}.{key}")
        return
    fail(f"{label}: unsupported JSON value type: {type(value).__name__}")


def strict_load(raw: bytes, label: str) -> dict[str, Any]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ContractError(f"{label}: not UTF-8") from exc
    try:
        value = json.loads(
            text,
            object_pairs_hook=duplicate_object,
            parse_constant=reject_constant,
            parse_float=reject_float,
        )
    except (json.JSONDecodeError, ContractError) as exc:
        if isinstance(exc, ContractError):
            raise
        raise ContractError(f"{label}: invalid JSON: {exc}") from exc
    require(type(value) is dict, f"{label}: root must be an object")
    validate_json_value(value)
    return cast(dict[str, Any], value)


def canonical_bytes(value: Any) -> bytes:
    validate_json_value(value)
    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        + b"\n"
    )


def as_object(value: Any, label: str) -> dict[str, Any]:
    require(type(value) is dict, f"{label}: expected object")
    return cast(dict[str, Any], value)


def as_list(value: Any, label: str) -> list[Any]:
    require(type(value) is list, f"{label}: expected array")
    return cast(list[Any], value)


def exact_oid(value: str, label: str) -> str:
    require(
        len(value) == 40 and all(character in "0123456789abcdef" for character in value),
        f"{label}: full lowercase 40-hex OID required",
    )
    return value


def safe_path(value: str, label: str) -> str:
    path = PurePosixPath(value)
    require(
        bool(value) and not path.is_absolute() and ".." not in path.parts and "." not in path.parts,
        f"{label}: unsafe path",
    )
    return value


def git(repo: Path, args: Sequence[str]) -> bytes:
    process = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=False,
        capture_output=True,
    )
    if process.returncode:
        fail(f"git {' '.join(args)} failed: {process.stderr.decode(errors='replace').strip()}")
    return process.stdout


@dataclass(frozen=True)
class Pin:
    commit: str
    tree: str
    path: str
    blob: str
    byte_length: int
    raw_sha256: str
    parent: str | None = None


NORMALIZATION_PIN = Pin(
    commit="85e73e2699e54673fdc82e27b70504bc98f393a9",
    tree="fb4eba9c7ed44735cfd7a38c95e1164fffc5a039",
    parent="d350c4785abe9932d054c82d9aff03f00dc37255",
    path="quant/research/verdict-normalization/current_verdicts.v1.json",
    blob="8e1ebc6cbd2551eda99ee5a8da986a4b7a62ce69",
    byte_length=188_715,
    raw_sha256="17c9ab3cca22c6eefc5a0a693d45741e80e8ae5509718e9e69e1c6456b33ffe4",
)

N3_PIN = Pin(
    commit="0c0c774cc48d9bcb6c914ccd393c2b5c0b6131d4",
    tree="2a532877f55f9ef1a2892b2364ff981a0ff953e3",
    parent="88d2c06350e3387ab810010f6027d9d52191f3fe",
    path="quant/research/n3_successor/current_profitability_registry.v4.json",
    blob="a32a661a8c14736a28cb3d117f86614ff01945e8",
    byte_length=118_516,
    raw_sha256="18098a23ad1aeb1ef8e6bfc7652177561b6d05a8904f025252ba10e9eb517a06",
)

MAKER_PIN = Pin(
    commit="2fd5e8a42e53286bbb8ac9260ea99986dc4ebb9e",
    tree="983d535919fab24dc0b23c53b54e943320cdfa91",
    path="quant/research/maker_fee_edge_grid/result.v1.json",
    blob="b784271a111a7cec808afd2f7f8c3d322d428fc4",
    byte_length=3_770,
    raw_sha256="d3b694562ca88cec109b8fd410fba718123e73115fb297ee1bc66f24591fb726",
)

VOLUME_PIN = Pin(
    commit="88751475d2b4f30b080ac947f478a4bbc38cbbdf",
    tree="9a4c4a77ff7b8b8b0df87674b4542e784dec5af0",
    path="quant/research/volume-economics/terminal-result.v1.json",
    blob="26a8c1b068bdd9a63c0b1f9ea8e9b232c4b8aca8",
    byte_length=3_858,
    raw_sha256="d80082013147b42cfacb8bf9c0b9df420bba081ca4ba26f517b82c9b804b1929",
)

M0_SOURCE_PIN = Pin(
    commit="ce4be56e13b1cf33658f3b6f0aee9254c90540e8",
    tree="a29a1cd3828f940efc4c9e17abe9b15d063ea24b",
    parent="c245bf5f64caa6ddf960f6ddcd520ec571033a18",
    path="server/src/foundation/execution/m0SpotSourceMount.ts",
    blob="06df24ae23bd129f1a69f5d69986716488c3e0a8",
    byte_length=9_367,
    raw_sha256="e0506f3f08f48346dceee838d28f7d0c3e69f40ba0cbc3fe5c182f709de3bbc6",
)

M0_RISK_PIN = Pin(
    commit="ce4be56e13b1cf33658f3b6f0aee9254c90540e8",
    tree="a29a1cd3828f940efc4c9e17abe9b15d063ea24b",
    parent="c245bf5f64caa6ddf960f6ddcd520ec571033a18",
    path="server/src/foundation/risk/spotRiskPolicy.ts",
    blob="1a2a69d2e26b2035f9826070b5b25c27cac3a1bd",
    byte_length=14_183,
    raw_sha256="4f35c8258b995e386d945ef384f9dd820a037b711b7c3db7ccb76a943ff27181",
)

JSON_PINS: tuple[tuple[str, Pin], ...] = (
    ("acceptedVerdictNormalization", NORMALIZATION_PIN),
    ("acceptedProfitabilityRegistry", N3_PIN),
    ("acceptedMakerFeeControl", MAKER_PIN),
    ("acceptedVolumeControl", VOLUME_PIN),
)

EVIDENCE_PINS: tuple[tuple[str, Pin], ...] = (
    *JSON_PINS,
    ("acceptedPreparedM0SourceMount", M0_SOURCE_PIN),
    ("acceptedPreparedM0RiskPolicy", M0_RISK_PIN),
)

REQUIRED_TRUTH: tuple[str, ...] = (
    "ACCEPTED_PRE_OUTCOME_FAMILY_ALIAS_REGISTRY",
    "COMPLETE_GLOBAL_ATTEMPT_LEDGER",
    "SANITIZED_ACCOUNT_EFFECTIVE_FEES",
    "EXECUTABLE_CAPACITY_AND_EXECUTION_PROOF",
    "COMPLETE_MARKED_EQUITY_PATHS",
    "SINGLE_FRESH_HOLDOUT_RECEIPT_IF_A_WINNER_EMERGES",
)

MAKER_LIMITATIONS: tuple[str, ...] = (
    "ACCEPTED_E1_BODY_BYTES_UNAVAILABLE",
    "AGGREGATE_RECEIPT_CANNOT_REPRODUCE_DEPENDENCE_AWARE_INTERVALS",
    "MARKED_EQUITY_PATH_ABSENT",
    "CAUSAL_MAKER_FILL_AND_EXECUTABLE_CAPACITY_UNPROVEN",
    "INDEPENDENT_OOS_HOLDOUT_AND_PBO_UNAVAILABLE",
    "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
)

SCENARIO_NULL_FIELDS: tuple[str, ...] = (
    "netUsdPer1000SpotEntryNotional",
    "interval95UsdPer1000SpotEntryNotional",
    "maxDrawdownUsd",
    "maxDrawdownFraction",
    "capacityUsd",
    "positiveSubsetCount",
    "feeDecompositionUsd",
    "pairAndPredeclaredRegimeBreakdown",
)

EXPECTED_NORMALIZATION_TRUTH_POLICY = {
    "accountEffectiveFeesRemainUnknown": True,
    "crediblePositiveNullPreserved": True,
    "excludedOrRejectedEconomicsPromoted": False,
    "holdoutsReopened": False,
    "invalidTestEconomicsPromoted": False,
    "missingValuesBecomeZero": False,
    "publicCapacityPromotedToExecutable": False,
    "sealedRunsReexecuted": False,
}

EXPECTED_N3_TRUTH_POLICY = {
    "missingOutcomeBecomesZero": False,
    "pboMayOverrideMultiplicityOrIntervals": False,
    "positivePointEstimateMayQualify": False,
    "publicCapacityMaySubstituteForExecutableCapacity": False,
    "publicFeesMaySubstituteForAccountEffectiveFees": False,
    "unknownAndNullPreserved": True,
}

EXPECTED_EFFECTS = {
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

EXPECTED_VOLUME_AUTHORITY = {
    "casAuthority": False,
    "killSwitchEngaged": True,
    "mode": "SHADOW_ONLY",
    "orderTransferWithdrawalMoneyAuthority": False,
    "privateOrSignedAuthority": False,
    "recordOnly": True,
    "strategyEnabled": False,
    "submitAuthority": False,
}

EXPECTED_VOLUME_SOURCE_RULES = {
    "deduplicationAllowed": False,
    "gapFillOrRepairAllowed": False,
    "nativeMicrosecondOpenTimeRequired": True,
    "nativeTwelveFieldParsingRequired": True,
    "rowOrSymbolExclusionAllowed": False,
    "sortAllowed": False,
    "uniqueStrictlyIncreasingOpenTimeRequired": True,
    "validationTiming": "BEFORE_ANY_FEATURE_EVENT_OR_ECONOMIC_MEASUREMENT",
}


def pin_dict(pin: Pin) -> dict[str, Any]:
    value: dict[str, Any] = {
        "producerCommit": pin.commit,
        "producerTree": pin.tree,
        "path": pin.path,
        "gitBlob": pin.blob,
        "byteLength": pin.byte_length,
        "rawSha256": pin.raw_sha256,
    }
    if pin.parent is not None:
        value["producerParent"] = pin.parent
    return value


def read_pin_bytes(repo: Path, pin: Pin, label: str) -> bytes:
    commit = exact_oid(pin.commit, f"{label}.commit")
    expected_tree = exact_oid(pin.tree, f"{label}.tree")
    found_tree = git(repo, ["show", "-s", "--format=%T", commit]).decode().strip()
    require_equal(found_tree, expected_tree, f"{label}.tree")
    if pin.parent is not None:
        found_parents = git(repo, ["show", "-s", "--format=%P", commit]).decode().strip()
        require_equal(found_parents, exact_oid(pin.parent, f"{label}.parent"), f"{label}.parent")

    path = safe_path(pin.path, f"{label}.path")
    tree_row = git(repo, ["ls-tree", "-z", commit, "--", path])
    rows = [row for row in tree_row.split(b"\0") if row]
    require(len(rows) == 1, f"{label}: expected exactly one tree entry")
    header, found_path = rows[0].split(b"\t", 1)
    mode, object_type, blob = header.decode().split(" ")
    require_equal(mode, "100644", f"{label}.mode")
    require_equal(object_type, "blob", f"{label}.objectType")
    require_equal(found_path.decode(), path, f"{label}.path")
    require_equal(blob, exact_oid(pin.blob, f"{label}.blob"), f"{label}.blob")

    size_text = git(repo, ["cat-file", "-s", blob]).decode().strip()
    require(size_text.isdigit(), f"{label}: invalid blob size")
    require_equal(int(size_text), pin.byte_length, f"{label}.byteLength")
    raw = git(repo, ["cat-file", "blob", blob])
    require_equal(len(raw), pin.byte_length, f"{label}.catFileByteLength")
    require_equal(sha256(raw), pin.raw_sha256, f"{label}.rawSha256")
    return raw


def read_json_pin(repo: Path, pin: Pin, label: str) -> dict[str, Any]:
    return strict_load(read_pin_bytes(repo, pin, label), label)


def validate_normalization(document: Mapping[str, Any]) -> None:
    require_equal(document.get("schema"), "VerdictNormalizationRegistryV1", "normalization.schema")
    require_equal(document.get("version"), 1, "normalization.version")
    summary = as_object(document.get("summary"), "normalization.summary")
    expected_summary = {
        "authority": "NONE",
        "completeDispositionUniverse": True,
        "crediblePositiveCount": None,
        "currentProfitabilityVerdict": "UNKNOWN",
        "economicConsumableCount": 46,
        "pendingInputCount": 0,
        "positiveEdgeClaim": "NOT_MADE",
        "recommendation": "NONE",
        "recordCount": 94,
        "verifiedPositiveCount": 0,
    }
    for key, expected in expected_summary.items():
        require_equal(summary.get(key), expected, f"normalization.summary.{key}")
    require_equal(
        summary.get("n3Baseline"),
        {
            "acceptedCrediblePositiveCount": 0,
            "families": 49,
            "globalProfitability": "UNKNOWN",
            "localVerdictCounts": {"NO_GO": 24, "UNMEASURED": 26},
            "origins": 50,
            "verifiedPositiveCount": 0,
        },
        "normalization.summary.n3Baseline",
    )
    require_equal(
        document.get("truthPolicy"),
        EXPECTED_NORMALIZATION_TRUTH_POLICY,
        "normalization.truthPolicy",
    )
    require_equal(document.get("effects"), EXPECTED_EFFECTS, "normalization.effects")

    records = as_list(document.get("records"), "normalization.records")
    require_equal(len(records), 94, "normalization.records.length")
    economic_records: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for index, raw_record in enumerate(records):
        record = as_object(raw_record, f"normalization.records[{index}]")
        record_id = record.get("id")
        require(type(record_id) is str, f"normalization.records[{index}].id: expected string")
        require(record_id not in by_id, f"normalization.records: duplicate id {record_id}")
        by_id[cast(str, record_id)] = record
        require_equal(record.get("authority"), "NONE", f"normalization.records[{index}].authority")
        if record.get("economicConsumable") is True:
            economic_records.append(record)

    require_equal(len(economic_records), 46, "normalization.economicConsumableCount")
    for record in economic_records:
        record_id = cast(str, record["id"])
        fees = as_object(record.get("fees"), f"{record_id}.fees")
        capacity = as_object(record.get("capacity"), f"{record_id}.capacity")
        require_equal(fees.get("accountEffectiveState"), "UNKNOWN", f"{record_id}.fees.state")
        require(fees.get("accountEffectiveValue") is None, f"{record_id}.fees.value: must be null")
        require_equal(capacity.get("executableState"), "UNKNOWN", f"{record_id}.capacity.state")
        require(
            capacity.get("executableValue") is None,
            f"{record_id}.capacity.value: must be null",
        )

    maker = by_id.get("BASIS-MAKER-REAL-TIER-GRID")
    volume = by_id.get("VOLUME-ECONOMICS")
    require(maker is not None, "normalization: maker control missing")
    require(volume is not None, "normalization: volume control missing")
    for control_id, record, verdict, expected_pin in (
        ("maker", cast(dict[str, Any], maker), "UNKNOWN_DATA", MAKER_PIN),
        ("volume", cast(dict[str, Any], volume), "INVALID_TEST", VOLUME_PIN),
    ):
        require_equal(
            record.get("disposition"), "ACCEPTED_SOURCE_ONLY", f"{control_id}.disposition"
        )
        require_equal(record.get("n3Consumption"), "SOURCE_ONLY", f"{control_id}.consumption")
        require_equal(record.get("normalizedVerdict"), verdict, f"{control_id}.verdict")
        require(record.get("economicConsumable") is False, f"{control_id}: economics promoted")
        require_equal(
            record.get("producer"),
            {"commit": expected_pin.commit, "tree": expected_pin.tree},
            f"{control_id}.producer",
        )
        result_pin = as_object(record.get("resultPin"), f"{control_id}.resultPin")
        require_equal(
            result_pin,
            {
                "byteLength": expected_pin.byte_length,
                "contentReadForNormalization": True,
                "gitBlob": expected_pin.blob,
                "path": expected_pin.path,
                "rawSha256": expected_pin.raw_sha256,
                "rawSha256VerifiedThisTask": True,
                "trustedForEconomics": False,
            },
            f"{control_id}.resultPin",
        )


def validate_n3(document: Mapping[str, Any]) -> list[dict[str, str]]:
    require_equal(document.get("schema"), "N3S4ProfitabilityStateV1", "n3.schema")
    require_equal(document.get("version"), 1, "n3.version")
    summary = as_object(document.get("summary"), "n3.summary")
    expected_summary = {
        "acceptedCrediblePositiveCount": 0,
        "acceptedFamilyCount": 49,
        "acceptedOriginCount": 50,
        "capitalAuthority": "NONE",
        "completeFamilyUniverse": False,
        "crediblePositiveCount": None,
        "currentProfitabilityVerdict": "UNKNOWN",
        "localVerdictCounts": {"NO_GO": 24, "UNMEASURED": 26},
        "moneyUsd": 0,
        "owner1000FundingVerdict": "NO",
        "positiveEdgeClaim": "NOT_MADE",
        "recommendation": "NONE",
        "requiredTruthCount": 6,
        "terminalPendingCount": 0,
        "verifiedPositiveCount": 0,
    }
    for key, expected in expected_summary.items():
        require_equal(summary.get(key), expected, f"n3.summary.{key}")
    require_equal(document.get("truthPolicy"), EXPECTED_N3_TRUTH_POLICY, "n3.truthPolicy")

    n3_effects = as_object(document.get("effects"), "n3.effects")
    require_equal(n3_effects, EXPECTED_EFFECTS, "n3.effects")
    pending = as_object(document.get("pendingInputs"), "n3.pendingInputs")
    require_equal(pending.get("activeOutsideBaselineCutoff"), [], "n3.pending.outside")
    require_equal(pending.get("activeWithinBaselineCutoff"), [], "n3.pending.within")
    require_equal(pending.get("terminalPending"), [], "n3.pending.terminal")
    required_truth = as_list(pending.get("requiredTruth"), "n3.pending.requiredTruth")
    expected = [{"code": code, "state": "PENDING"} for code in REQUIRED_TRUTH]
    require_equal(required_truth, expected, "n3.pending.requiredTruth")
    return cast(list[dict[str, str]], required_truth)


def validate_maker(document: Mapping[str, Any]) -> list[dict[str, Any]]:
    require_equal(document.get("schema"), "MakerFeeEdgeGridResultV1", "maker.schema")
    require_equal(document.get("version"), 1, "maker.version")
    expected_scalars = {
        "status": "BLOCKED",
        "normalizedVerdict": "UNKNOWN_DATA",
        "blocker": "ACCEPTED_E1_BODY_BYTES_UNAVAILABLE",
        "feePosture": "PUBLIC_SCHEDULE_SCENARIO_ONLY",
        "accountEffectiveFees": "UNKNOWN",
        "positiveEdgeClaim": "NOT_MADE",
        "verifiedPositiveCount": None,
        "recommendation": "NONE",
        "capitalAuthority": "NONE",
    }
    for key, expected_value in expected_scalars.items():
        require_equal(document.get(key), expected_value, f"maker.{key}")
    require_equal(document.get("knownLimitations"), list(MAKER_LIMITATIONS), "maker.limitations")

    custody = as_object(document.get("inputCustody"), "maker.inputCustody")
    require_equal(custody.get("state"), "ACCEPTED_RECEIPT_ONLY", "maker.custody.state")
    require_equal(custody.get("measurementBody"), "ABSENT", "maker.custody.measurement")
    require(
        custody.get("allRequiredHashesVerifiedThisRun") is False,
        "maker.custody: hashes cannot be promoted",
    )

    context = as_object(document.get("acceptedContextOnly"), "maker.acceptedContextOnly")
    require_equal(
        context,
        {
            "windowUtc": "2025-07-01T00:00:00Z/2026-07-01T00:00:00Z",
            "roundTrips": 366,
            "frozenPairs": 40,
            "activePairs": 18,
            "populatedWeekKeys": 33,
            "unit": "USD_PER_1000_SPOT_ENTRY_NOTIONAL",
            "allTakerPublicProxyNetUsdPer1000": "-1.8724979631579157",
            "custodyQualification": "RECEIPT_ONLY_NOT_RECOMPUTED",
        },
        "maker.acceptedContextOnly",
    )

    expected_fees = (
        ("PUBLIC_REGULAR_USDT_NO_BNB", "10", "10", "2", "5"),
        ("PUBLIC_REGULAR_USDT_BNB_SENSITIVITY", "7.5", "7.5", "1.8", "4.5"),
    )
    scenarios = as_list(document.get("scenarios"), "maker.scenarios")
    require_equal(len(scenarios), len(expected_fees), "maker.scenarios.length")
    projected: list[dict[str, Any]] = []
    for index, expected_fee_row in enumerate(expected_fees):
        scenario = as_object(scenarios[index], f"maker.scenarios[{index}]")
        scenario_id, spot_entry, spot_exit, usdtm_entry, usdtm_exit = expected_fee_row
        require_equal(scenario.get("scenarioId"), scenario_id, f"maker.scenarios[{index}].id")
        require_equal(
            scenario.get("measurementState"),
            "NOT_MEASURED",
            f"maker.scenarios[{index}].measurement",
        )
        fee_values = {
            "spotEntryMakerBps": spot_entry,
            "spotExitTakerBps": spot_exit,
            "usdtMEntryMakerBps": usdtm_entry,
            "usdtMExitTakerBps": usdtm_exit,
        }
        for key, value in fee_values.items():
            require_equal(scenario.get(key), value, f"maker.scenarios[{index}].{key}")
        for field in SCENARIO_NULL_FIELDS:
            require(
                scenario.get(field) is None,
                f"maker.scenarios[{index}].{field}: must remain null",
            )
        projected.append(
            {
                "scenarioId": scenario_id,
                "measurementState": "NOT_MEASURED",
                "feesBps": {
                    "spotEntryMaker": spot_entry,
                    "spotExitTaker": spot_exit,
                    "usdtMEntryMaker": usdtm_entry,
                    "usdtMExitTaker": usdtm_exit,
                },
                "netUsdPer1000SpotEntryNotional": None,
                "interval95UsdPer1000SpotEntryNotional": None,
                "maxDrawdownUsd": None,
                "maxDrawdownFraction": None,
                "capacityUsd": None,
                "positiveSubsetCount": None,
                "feeDecompositionUsd": None,
                "pairAndPredeclaredRegimeBreakdown": None,
            }
        )
    execution = as_object(document.get("executionTruth"), "maker.executionTruth")
    require_equal(execution.get("executableCapacity"), "UNKNOWN", "maker.capacity")
    require_equal(execution.get("makerEntryFill"), "UNKNOWN", "maker.fill")
    return projected


def validate_volume(document: Mapping[str, Any]) -> dict[str, Any]:
    require_equal(
        document.get("schemaVersion"), "volume.archive-conditional-economics.v1", "volume.schema"
    )
    require_equal(document.get("testStatus"), "INVALID_TEST", "volume.testStatus")
    require_equal(document.get("measurementStatus"), "UNMEASURED", "volume.measurementStatus")
    require_equal(document.get("goNoGo"), "NOT_APPLICABLE", "volume.goNoGo")
    require(document.get("phases") is None, "volume.phases: must be null")
    require(document.get("sample") is None, "volume.sample: must be null")
    require_equal(document.get("authority"), EXPECTED_VOLUME_AUTHORITY, "volume.authority")
    require_equal(document.get("sourceRules"), EXPECTED_VOLUME_SOURCE_RULES, "volume.sourceRules")
    require_equal(
        document.get("capacity"),
        {
            "extrapolationForbidden": True,
            "fullUniverseCapacity": "UNKNOWN",
            "measuredCapacity": None,
            "supports1000QuoteNotional": "UNKNOWN",
        },
        "volume.capacity",
    )
    require_equal(
        document.get("economics"),
        {
            "confidenceInterval95": None,
            "drawdown": None,
            "eventSample": None,
            "netSyntheticUsdtPer1000": None,
            "netUsdPer1000": None,
        },
        "volume.economics",
    )
    require_equal(
        document.get("feePosture"),
        {
            "accountEffectiveFeeState": "UNKNOWN",
            "publicScenariosEvaluated": False,
            "usdEquivalenceEstablished": False,
        },
        "volume.feePosture",
    )
    verdict = as_object(document.get("verdict"), "volume.verdict")
    require_equal(verdict.get("accountEffective"), "UNMEASURED", "volume.verdict.account")
    require_equal(verdict.get("executionAuthority"), "NONE", "volume.verdict.executionAuthority")
    require_equal(verdict.get("repairAuthority"), "NONE", "volume.verdict.repairAuthority")
    require_equal(verdict.get("rerunAuthority"), "NONE", "volume.verdict.rerunAuthority")
    return cast(dict[str, Any], document["capacity"])


def validate_m0_source(source_mount: bytes, risk_policy: bytes) -> None:
    source_markers = (
        b"runtimeActivated: false as const",
        b"liveExecutionPermitted: false as const",
        b"ownerConfirmation: 'ACKNOWLEDGED_NOT_AUTHORITY' as const",
        b"sourceEnabled: false as const",
        b"killSwitchEngaged: true as const",
        b"allowedSymbols: Object.freeze([]) as readonly never[]",
        b"approvedUsdQuoteAssets: Object.freeze([]) as readonly never[]",
        b"orderType: 'LIMIT' as const",
        b"notionalBasis:\n            'SIGNED_LIMIT_PRICE_TIMES_QUANTITY' as const",
        b"authorityState: 'NOT_PRESENT' as const",
        b"automaticRetry: false as const",
        b"submitAuthority: 'NONE' as const",
        b"withdrawalPolicy: 'DISABLED' as const",
        b"transferPolicy: 'DISABLED' as const",
    )
    for marker in source_markers:
        require(
            source_mount.count(marker) == 1,
            f"m0.sourceMount: exact marker missing or repeated: {marker!r}",
        )
    risk_marker = b"export const OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE = '10' as const;"
    require(risk_policy.count(risk_marker) == 1, "m0.riskPolicy: exact 10 USDT ceiling missing")


def build_answer(repo: Path) -> dict[str, Any]:
    documents = {label: read_json_pin(repo, pin, label) for label, pin in JSON_PINS}
    normalization = documents["acceptedVerdictNormalization"]
    n3 = documents["acceptedProfitabilityRegistry"]
    maker = documents["acceptedMakerFeeControl"]
    volume = documents["acceptedVolumeControl"]

    validate_normalization(normalization)
    required_truth = validate_n3(n3)
    scenarios = validate_maker(maker)
    volume_capacity = validate_volume(volume)
    validate_m0_source(
        read_pin_bytes(repo, M0_SOURCE_PIN, "acceptedPreparedM0SourceMount"),
        read_pin_bytes(repo, M0_RISK_PIN, "acceptedPreparedM0RiskPolicy"),
    )

    normalization_summary = as_object(normalization["summary"], "normalization.summary")
    n3_summary = as_object(n3["summary"], "n3.summary")
    maker_context = as_object(maker["acceptedContextOnly"], "maker.acceptedContextOnly")

    return {
        "schema": SCHEMA_ID,
        "version": VERSION,
        "deliveryBoundary": {
            "milestone": "RESULT3-PREP1",
            "stage": "SOURCE_ONLY_PREPARATION",
            "consumer": "FINAL_PROFITABILITY",
            "eligibleAfter": "M0",
            "priority": "RESULT_1_FIRST",
            "authority": "NONE",
            "landed": False,
            "deployed": False,
            "live": False,
        },
        "evidencePins": {label: pin_dict(pin) for label, pin in EVIDENCE_PINS},
        "currentMoneyAnswer": {
            "measuredEdgeAfterStatedFees": {
                "scope": "ACCOUNT_EFFECTIVE",
                "measurementState": "UNMEASURED",
                "signState": "UNKNOWN",
                "value": None,
                "unit": None,
                "accountEffectiveFeeState": "UNKNOWN",
                "accountEffectiveFeeValue": None,
                "inferenceProhibited": True,
            },
            "acceptedPublicProxyContext": {
                "evidenceClass": "PUBLIC_PROXY_ACCEPTED_CONTEXT_ONLY",
                "windowUtc": maker_context["windowUtc"],
                "roundTrips": maker_context["roundTrips"],
                "frozenPairs": maker_context["frozenPairs"],
                "activePairs": maker_context["activePairs"],
                "populatedWeekKeys": maker_context["populatedWeekKeys"],
                "value": maker_context["allTakerPublicProxyNetUsdPer1000"],
                "unit": maker_context["unit"],
                "signState": "NEGATIVE",
                "custodyQualification": maker_context["custodyQualification"],
                "contributesToMeasuredEdge": False,
                "contributesToProfitabilityVerdict": False,
            },
            "statedFeeEvidence": {
                "accountEffective": {"state": "UNKNOWN", "value": None, "unit": None},
                "publicScenarios": scenarios,
                "publicScenarioState": "SCENARIO_ONLY_NOT_ACCOUNT_TRUTH",
            },
            "profitability": {
                "state": n3_summary["currentProfitabilityVerdict"],
                "signState": "UNKNOWN",
                "positiveEdgeClaim": n3_summary["positiveEdgeClaim"],
                "verifiedPositiveCount": normalization_summary["verifiedPositiveCount"],
                "acceptedCrediblePositiveCount": n3_summary["acceptedCrediblePositiveCount"],
                "crediblePositiveCount": n3_summary["crediblePositiveCount"],
                "recommendation": n3_summary["recommendation"],
                "acceptedOriginCount": n3_summary["acceptedOriginCount"],
                "acceptedFamilyCount": n3_summary["acceptedFamilyCount"],
                "completeFamilyUniverse": n3_summary["completeFamilyUniverse"],
                "localVerdictCounts": n3_summary["localVerdictCounts"],
                "zeroVerifiedPositivesImpliesNegative": False,
            },
            "currentCeilings": {
                "capitalAuthority": n3_summary["capitalAuthority"],
                "authorizedCapitalUsd": {"state": "UNKNOWN", "value": None},
                "executableCapacityUsd": {"state": "UNKNOWN", "value": None},
                "preparedM0SourceOnlyOrderNotionalCeiling": {
                    "value": "10",
                    "unit": "USDT",
                    "basis": "SIGNED_LIMIT_PRICE_TIMES_QUANTITY",
                    "orderType": "LIMIT",
                    "executableNow": False,
                    "fundingBudget": False,
                    "scalingAuthority": False,
                },
                "owner1000FundingCase": {
                    "amountUsd": "1000",
                    "verdict": n3_summary["owner1000FundingVerdict"],
                    "classification": "FUNDING_VERDICT_NOT_EXECUTABLE_CEILING",
                },
            },
            "largerCapitalUnknowns": {
                "scope": "ABOVE_OWNER_1000_FUNDING_CASE",
                "profitabilityState": "UNKNOWN",
                "signState": "UNKNOWN",
                "accountEffectiveFeeState": "UNKNOWN",
                "executableCapacityState": "UNKNOWN",
                "maximumAmountUsd": None,
                "supports1000QuoteNotional": volume_capacity["supports1000QuoteNotional"],
                "fullUniverseCapacity": volume_capacity["fullUniverseCapacity"],
                "measuredCapacity": volume_capacity["measuredCapacity"],
                "extrapolationForbidden": volume_capacity["extrapolationForbidden"],
                "capitalAuthority": "NONE",
            },
        },
        "protections": {
            "effectiveRuntimeProtections": {"state": "UNKNOWN"},
            "preparedM0SourceProtections": {
                "evidenceState": "ACCEPTED_SOURCE_ONLY_NEVER_FIREABLE",
                "landed": False,
                "deployed": False,
                "live": False,
                "runtimeAccepted": False,
                "sourceEnabled": False,
                "killSwitchEngaged": True,
                "allowedSymbols": [],
                "approvedUsdQuoteAssets": [],
                "ownerConfirmation": "ACKNOWLEDGED_NOT_AUTHORITY",
                "testOrderAuthorityState": "NOT_PRESENT",
                "submitAuthority": "NONE",
                "automaticRetry": False,
                "withdrawalPolicy": "DISABLED",
                "transferPolicy": "DISABLED",
            },
            "acceptedVolumeArtifactOnly": {
                "scope": "VOLUME_CONTROL_ARTIFACT_NOT_LIVE_RUNTIME_VERIFICATION",
                **EXPECTED_VOLUME_AUTHORITY,
            },
            "truthPolicy": {
                "missingValuesBecomeZero": False,
                "publicFeesSubstituteForAccountEffectiveFees": False,
                "publicCapacitySubstituteForExecutableCapacity": False,
                "positivePointEstimateQualifies": False,
                "holdoutsReopened": False,
                "sealedRunsReexecuted": False,
            },
        },
        "requiredTruth": required_truth,
        "effects": {
            "scope": "RESULT3_PREP1_SOURCE_PREPARATION_ONLY",
            **EXPECTED_EFFECTS,
        },
    }


def verify_materialized(expected: Mapping[str, Any], answer_path: Path) -> None:
    raw = answer_path.read_bytes()
    actual = strict_load(raw, str(answer_path))
    require(raw == canonical_bytes(actual), f"{answer_path}: non-canonical JSON")
    require_equal(actual, expected, str(answer_path))


def atomic_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def default_repo() -> Path:
    root = git(Path(__file__).resolve().parent, ["rev-parse", "--show-toplevel"])
    return Path(root.decode().strip())


def default_answer() -> Path:
    return Path(__file__).resolve().with_name(ANSWER_NAME)


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("command", choices=("freeze", "verify"))
    value.add_argument("--repo", type=Path, default=None)
    value.add_argument("--answer", type=Path, default=None)
    return value


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    repo = arguments.repo.resolve() if arguments.repo is not None else default_repo()
    answer = arguments.answer.resolve() if arguments.answer is not None else default_answer()
    try:
        expected = build_answer(repo)
        if arguments.command == "freeze":
            atomic_write(answer, canonical_bytes(expected))
        verify_materialized(expected, answer)
    except (ContractError, OSError) as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1
    print(f"PASS {answer} sha256={sha256(answer.read_bytes())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
