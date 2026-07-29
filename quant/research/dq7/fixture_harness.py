"""Deterministic materialization for the checked-in DQ-7 fixture matrix."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, cast

from research.dq7.validator import validate_program_v1

FIXTURE_DIRECTORY = Path(__file__).with_name("fixtures")
VALID_FIXTURE_PATH = FIXTURE_DIRECTORY / "valid_program.v1.json"
HOSTILE_FIXTURE_PATH = FIXTURE_DIRECTORY / "hostile_cases.v1.json"

JsonObject = dict[str, Any]


def _object(value: Any, field: str) -> JsonObject:
    if type(value) is not dict:
        raise AssertionError(f"fixture field {field} must be an object")
    return cast(JsonObject, value)


def _array(value: Any, field: str) -> list[Any]:
    if type(value) is not list:
        raise AssertionError(f"fixture field {field} must be an array")
    return value


def _load_object(path: Path) -> JsonObject:
    value = json.loads(path.read_text(encoding="utf-8"))
    return _object(value, path.name)


def load_valid_fixture() -> JsonObject:
    """Return an independent copy of the fully covered valid program."""

    return copy.deepcopy(_load_object(VALID_FIXTURE_PATH))


def load_hostile_case_records() -> list[JsonObject]:
    """Return the ordered, declarative hostile-case records."""

    fixture = _load_object(HOSTILE_FIXTURE_PATH)
    if fixture.get("schema") != "cosmos.dq7.hostile-cases.v1":
        raise AssertionError("hostile fixture schema mismatch")
    return [
        _object(record, f"cases[{index}]")
        for index, record in enumerate(_array(fixture.get("cases"), "cases"))
    ]


def cover_manifest(manifest: JsonObject) -> JsonObject:
    """Bind a manifest's current attempts and family components into one plan."""

    covered = copy.deepcopy(manifest)
    covered["globalMultiplicity"] = None
    draft_receipt = validate_program_v1(covered)
    covered["globalMultiplicity"] = {
        "scopeId": "PROGRAM_WIDE",
        "methodId": "PROGRAM_HOLM_FWER",
        "alpha": {"numerator": 1, "denominator": 20},
        "frozenBeforeAnyOutcome": True,
        "attemptIds": [candidate.attempt_id for candidate in draft_receipt.candidates],
        "familyComponentIds": [
            component.component_id for component in draft_receipt.family_components
        ],
        "attemptLedgerDigest": draft_receipt.attempt_ledger_digest,
        "familyUniverseDigest": draft_receipt.family_universe_digest,
        "consumerIds": ["N3_INTAKE", "SCHEDULER"],
    }
    return covered


def _candidate(manifest: JsonObject, attempt_id: str) -> JsonObject:
    candidates = _array(manifest.get("candidates"), "candidates")
    for index, raw_candidate in enumerate(candidates):
        candidate = _object(raw_candidate, f"candidates[{index}]")
        if candidate.get("attemptId") == attempt_id:
            return candidate
    raise AssertionError(f"fixture attempt {attempt_id} is absent")


def _clone_momentum(manifest: JsonObject, mutation_id: str) -> JsonObject:
    original = _candidate(manifest, "ATTEMPT_MOMENTUM")
    clone = copy.deepcopy(original)
    clone["attemptId"] = f"ATTEMPT_{mutation_id}"
    clone["declaredFamilyId"] = f"FAMILY_{mutation_id}"
    clone["displayName"] = f"Hostile fixture {mutation_id}"
    _array(manifest["candidates"], "candidates").append(clone)
    return clone


def materialize_hostile_case(mutation_id: str) -> JsonObject:
    """Materialize one hostile case from its closed mutation identifier."""

    manifest = load_valid_fixture()
    if mutation_id.startswith("CLONE_"):
        clone = _clone_momentum(manifest, mutation_id)
        nuisance = _object(clone["nuisance"], "clone.nuisance")
        if mutation_id == "CLONE_EXACT_RENAME":
            pass
        elif mutation_id == "CLONE_VENUE":
            nuisance["venueProviderIds"] = ["VENUE_RENAMED"]
        elif mutation_id == "CLONE_SIZING":
            nuisance["sizingPolicyId"] = "HOSTILE_SIZING"
        elif mutation_id == "CLONE_BOOKKEEPING":
            nuisance["bookkeepingPolicyId"] = "HOSTILE_BOOKKEEPING"
        elif mutation_id == "CLONE_NONPREDICTIVE":
            nuisance["venueProviderIds"] = ["VENUE_RENAMED"]
            nuisance["sizingPolicyId"] = "HOSTILE_SIZING"
        elif mutation_id == "CLONE_IMPLEMENTATION_COLLISION":
            nuisance["implementationDigest"] = "4" * 64
        elif mutation_id == "CLONE_CROSS_TARGET":
            prediction = _object(clone["prediction"], "clone.prediction")
            prediction.update(
                {
                    "outcomeId": "FORWARD_VOLATILITY",
                    "forecastClockId": "ONE_DAY_AHEAD",
                    "populationTopologyId": "LIQUID_DERIVATIVES",
                    "targetRoleId": "VOLATILITY_HORIZON",
                    "targetValueId": "ONE_DAY",
                    "polarityId": "POSITIVE",
                    "actionMappingId": "RISK_SCALING_ONLY",
                }
            )
        elif mutation_id == "CLONE_EXTENDED_SIGNAL":
            graph = _object(clone["featureGraph"], "clone.featureGraph")
            _array(graph["nodes"], "clone.featureGraph.nodes").append(
                {
                    "nodeId": "MOMENTUM_Z",
                    "opId": "ZSCORE",
                    "inputNodeIds": ["MOMENTUM"],
                    "sourceRoleId": None,
                    "parameterBindings": [{"roleId": "LOOKBACK", "valueId": "ONE_DAY"}],
                }
            )
            graph["rootNodeIds"] = ["MOMENTUM_Z"]
        elif mutation_id in {
            "CLONE_DECLARED_SPLIT",
            "CLONE_SHARED_SOURCE_ONLY",
        }:
            graph = _object(clone["featureGraph"], "clone.featureGraph")
            graph["nodes"] = [
                {
                    "nodeId": "MID",
                    "opId": "SOURCE",
                    "inputNodeIds": [],
                    "sourceRoleId": "SPOT_MID_PRICE",
                    "parameterBindings": [],
                },
                {
                    "nodeId": "MID_MEAN",
                    "opId": "MEAN",
                    "inputNodeIds": ["MID"],
                    "sourceRoleId": None,
                    "parameterBindings": [{"roleId": "LOOKBACK", "valueId": "ONE_DAY"}],
                },
            ]
            graph["rootNodeIds"] = ["MID_MEAN"]
            if mutation_id == "CLONE_DECLARED_SPLIT":
                clone["declaredFamilyId"] = "FAMILY_MOMENTUM"
        else:
            raise AssertionError(f"unknown clone mutation {mutation_id}")
        return cover_manifest(manifest)

    plan = _object(manifest["globalMultiplicity"], "globalMultiplicity")
    if mutation_id == "DROP_MULTIPLICITY_PLAN":
        manifest["globalMultiplicity"] = None
    elif mutation_id == "DROP_ATTEMPT_MEMBERSHIP":
        plan["attemptIds"] = _array(plan["attemptIds"], "attemptIds")[:-1]
    elif mutation_id == "DROP_FAMILY_MEMBERSHIP":
        plan["familyComponentIds"] = _array(
            plan["familyComponentIds"],
            "familyComponentIds",
        )[:-1]
    elif mutation_id == "CORRUPT_MULTIPLICITY_DIGEST":
        plan["familyUniverseDigest"] = "0" * 64
    elif mutation_id == "DROP_N3_CONSUMER":
        plan["consumerIds"] = ["SCHEDULER"]
    elif mutation_id == "CLEAR_PREOUTCOME_FREEZE":
        plan["frozenBeforeAnyOutcome"] = False
    elif mutation_id == "SET_LOCAL_METHOD":
        plan["methodId"] = "LOCAL_FAMILY_BH_FDR"
    elif mutation_id == "SET_LOCAL_SCOPE":
        plan["scopeId"] = "LOCAL_FAMILY"
    else:
        raise AssertionError(f"unknown hostile mutation {mutation_id}")
    return manifest
