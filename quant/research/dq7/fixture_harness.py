"""Deterministic materialization for the checked-in DQ-7 fixture matrix."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, cast

from research.dq7.validator import (
    calculate_pre_outcome_freeze_digest_v1,
    validate_program_v1,
)

FIXTURE_DIRECTORY = Path(__file__).with_name("fixtures")
VALID_FIXTURE_PATH = FIXTURE_DIRECTORY / "valid_program.v1.json"
HOSTILE_FIXTURE_PATH = FIXTURE_DIRECTORY / "hostile_cases.v1.json"
ACCEPTED_REGISTRY_PATH = FIXTURE_DIRECTORY / "accepted_registry.v1.json"

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


def load_accepted_registry() -> JsonObject:
    """Return the external trust pins used by the fixture program."""

    registry = _load_object(ACCEPTED_REGISTRY_PATH)
    if registry.get("schema") != "cosmos.dq7.accepted-registry.v1":
        raise AssertionError("accepted registry fixture schema mismatch")
    return registry


def fixture_ontology_digest() -> str:
    return cast(str, load_accepted_registry()["semanticOntologyDigest"])


def registry_freeze_digest() -> str:
    """Return the freeze coordinate the external registry accepted."""

    return cast(str, load_accepted_registry()["preOutcomeFreezeDigest"])


def validate_fixture_manifest(manifest: JsonObject) -> Any:
    """Validate exactly as an external consumer does: both pins from the registry.

    Neither pin is ever read back out of the manifest under validation.  A fixture
    that self-pinned -- taking the accepted freeze coordinate from the submitted
    plan's own claim -- would assert only that the submission agrees with itself,
    which is precisely the check `PROGRAM_PREOUTCOME_FREEZE_UNTRUSTED` exists to
    make impossible to pass by construction.
    """

    return validate_program_v1(
        manifest,
        accepted_semantic_ontology_digest=fixture_ontology_digest(),
        accepted_pre_outcome_freeze_digest=registry_freeze_digest(),
    )


def validate_fixture_manifest_with_pin(
    manifest: JsonObject,
    accepted_pre_outcome_freeze_digest: str | None,
) -> Any:
    """Validate against an explicitly supplied, checked-in accepted freeze pin.

    Hostile records name their own accepted coordinate so that a legitimately
    different program keeps focused distinctness coverage, while a plan-tampering
    case is still judged against the coordinate a registry had already accepted.
    """

    return validate_program_v1(
        manifest,
        accepted_semantic_ontology_digest=fixture_ontology_digest(),
        accepted_pre_outcome_freeze_digest=accepted_pre_outcome_freeze_digest,
    )


def hostile_accepted_freeze_digest(record: JsonObject) -> str | None:
    """Return one hostile record's checked-in accepted freeze coordinate."""

    if "acceptedPreOutcomeFreezeDigest" not in record:
        raise AssertionError(
            f"hostile case {record.get('caseId')} is missing its checked-in "
            "acceptedPreOutcomeFreezeDigest; regenerate with "
            "verify_known_answer.py --write"
        )
    accepted = record["acceptedPreOutcomeFreezeDigest"]
    return None if accepted is None else cast(str, accepted)


def resolve_hostile_accepted_pin(mutation_id: str, manifest: JsonObject) -> str | None:
    """Recompute what an external registry would already have accepted for one case.

    Used only by regeneration, never by validation.  A ``CLONE_*`` case builds a
    legitimately different program, so a registry would have accepted that program's
    own freeze-open coordinate; every other case tampers with the valid program's
    plan after the fact, so the accepted coordinate stays the valid program's.
    """

    if not mutation_id.startswith("CLONE_"):
        return registry_freeze_digest()
    if manifest.get("globalMultiplicity") is None:
        return None
    return calculate_pre_outcome_freeze_digest_v1(manifest)


def _bind_freeze_digest(manifest: JsonObject) -> None:
    """Resolve the draft plan's null freeze coordinate into a bound one.

    The validator owns the freeze-open gate, so this raises ``ContractError``
    with ``PREOUTCOME_FREEZE_CLOSED`` from inside
    ``calculate_pre_outcome_freeze_digest_v1`` for any acknowledged outcome.
    """

    plan = _object(manifest.get("globalMultiplicity"), "globalMultiplicity")
    plan["preOutcomeFreezeDigest"] = None
    plan["preOutcomeFreezeDigest"] = calculate_pre_outcome_freeze_digest_v1(manifest)


def cover_manifest(manifest: JsonObject) -> JsonObject:
    """Bind a manifest's current attempts and family components into one plan."""

    covered = copy.deepcopy(manifest)
    covered["globalMultiplicity"] = None
    draft_receipt = validate_program_v1(
        covered,
        accepted_semantic_ontology_digest=fixture_ontology_digest(),
    )
    covered["globalMultiplicity"] = {
        "programId": covered["programId"],
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
        "semanticOntologyDigest": draft_receipt.semantic_ontology_digest,
        "preOutcomeFreezeDigest": None,
        "consumerIds": ["N3_INTAKE", "SCHEDULER"],
    }
    _bind_freeze_digest(covered)
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
        elif mutation_id == "CLONE_PARAMETER_ROLE_ALIAS":
            graph = _object(clone["featureGraph"], "clone.featureGraph")
            for raw_node in _array(graph["nodes"], "clone.featureGraph.nodes"):
                node = _object(raw_node, "clone.featureGraph.node")
                if node.get("nodeId") == "MID_LAG":
                    binding = _object(
                        _array(
                            node["parameterBindings"],
                            "clone.parameterBindings",
                        )[0],
                        "clone.parameterBinding",
                    )
                    binding["roleId"] = "SEMANTICALLY_SAME_LAG_PERIOD"
        elif mutation_id == "CLONE_SOURCE_ALIAS":
            graph = _object(clone["featureGraph"], "clone.featureGraph")
            for raw_node in _array(graph["nodes"], "clone.featureGraph.nodes"):
                node = _object(raw_node, "clone.featureGraph.node")
                if node.get("nodeId") == "MID":
                    node["sourceRoleId"] = "RENAMED_SPOT_MID"
        elif mutation_id == "CLONE_OUTCOME_ALIAS":
            prediction = _object(clone["prediction"], "clone.prediction")
            prediction["outcomeId"] = "FORWARD_RETURN_ALIAS"
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
    elif mutation_id == "SET_OTHER_PROGRAM_IN_PLAN":
        plan["programId"] = "OTHER_PROGRAM"
    elif mutation_id == "SET_OTHER_ONTOLOGY_IN_PLAN":
        plan["semanticOntologyDigest"] = "0" * 64
    else:
        raise AssertionError(f"unknown hostile mutation {mutation_id}")
    if manifest["globalMultiplicity"] is not None:
        _bind_freeze_digest(manifest)
    return manifest
