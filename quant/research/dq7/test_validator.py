from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, cast

import pytest
from research.dq7.fixture_harness import (
    FIXTURE_DIRECTORY,
    cover_manifest,
    load_hostile_case_records,
    load_valid_fixture,
    materialize_hostile_case,
)
from research.dq7.validator import (
    ContractError,
    load_program_manifest_v1,
    validate_program_v1,
)
from research.dq7.verify_known_answer import verify_known_answer

JsonObject = dict[str, Any]


def _object(value: Any) -> JsonObject:
    assert type(value) is dict
    return cast(JsonObject, value)


def _array(value: Any) -> list[Any]:
    assert type(value) is list
    return cast(list[Any], value)


def _candidate(manifest: JsonObject, attempt_id: str) -> JsonObject:
    for value in _array(manifest["candidates"]):
        candidate = _object(value)
        if candidate["attemptId"] == attempt_id:
            return candidate
    raise AssertionError(f"missing fixture candidate {attempt_id}")


def _node(candidate: JsonObject, node_id: str) -> JsonObject:
    graph = _object(candidate["featureGraph"])
    for value in _array(graph["nodes"]):
        node = _object(value)
        if node["nodeId"] == node_id:
            return node
    raise AssertionError(f"missing fixture node {node_id}")


def _identity(receipt: Any, attempt_id: str) -> Any:
    for candidate in receipt.candidates:
        if candidate.attempt_id == attempt_id:
            return candidate
    raise AssertionError(f"missing receipt candidate {attempt_id}")


def _without_plan() -> JsonObject:
    manifest = load_valid_fixture()
    manifest["globalMultiplicity"] = None
    return manifest


def _expect_contract_error(manifest: JsonObject, expected_code: str) -> None:
    with pytest.raises(ContractError) as raised:
        validate_program_v1(manifest)
    assert raised.value.code == expected_code


def test_valid_fixture_is_clean_and_covered() -> None:
    receipt = validate_program_v1(load_valid_fixture())

    assert receipt.reason_codes == ()
    assert receipt.multiplicity_status == "COVERED"
    assert receipt.scheduler_disposition == "ADMIT"
    assert receipt.n3_intake_disposition == "ADMISSIBLE"
    assert receipt.verified_positive_structurally_eligible is True
    assert receipt.authority == "NONE"
    assert receipt.candidate_count == 3
    assert receipt.declared_family_count == 3
    assert receipt.predictive_family_count == 3
    assert receipt.family_component_count == 3
    assert receipt.canonical_bytes().endswith(b"\n")
    assert len(receipt.receipt_digest) == 64


HOSTILE_CASES = tuple(
    pytest.param(record, id=cast(str, record["caseId"])) for record in load_hostile_case_records()
)


@pytest.mark.parametrize("record", HOSTILE_CASES)
def test_hostile_fixture_matrix_has_exact_deterministic_outcome(
    record: JsonObject,
) -> None:
    mutation_id = cast(str, record["mutationId"])
    manifest = materialize_hostile_case(mutation_id)

    first = validate_program_v1(manifest)
    second = validate_program_v1(copy.deepcopy(manifest))

    assert list(first.reason_codes) == record["expectedReasonCodes"]
    assert first.scheduler_disposition == record["expectedSchedulerDisposition"]
    assert first.n3_intake_disposition == record["expectedN3Disposition"]
    assert first.canonical_bytes() == second.canonical_bytes()
    assert first.receipt_digest == second.receipt_digest
    assert first.authority == "NONE"
    expected_structural_eligibility = record["expectedSchedulerDisposition"] != "REJECT"
    assert first.verified_positive_structurally_eligible is expected_structural_eligibility


def test_candidate_and_node_order_do_not_change_receipt() -> None:
    left = _without_plan()
    right = copy.deepcopy(left)
    _array(right["candidates"]).reverse()
    for raw_candidate in _array(right["candidates"]):
        candidate = _object(raw_candidate)
        graph = _object(candidate["featureGraph"])
        _array(graph["nodes"]).reverse()

    assert (
        validate_program_v1(left).canonical_bytes() == validate_program_v1(right).canonical_bytes()
    )


def test_node_identifiers_do_not_change_predictive_identity() -> None:
    left = _without_plan()
    right = copy.deepcopy(left)
    candidate = _candidate(right, "ATTEMPT_MOMENTUM")
    graph = _object(candidate["featureGraph"])
    replacements = {
        "MID": "RENAMED_SOURCE",
        "MID_LAG": "RENAMED_LAG",
        "MOMENTUM": "RENAMED_ROOT",
    }
    for raw_node in _array(graph["nodes"]):
        node = _object(raw_node)
        node["nodeId"] = replacements[cast(str, node["nodeId"])]
        node["inputNodeIds"] = [
            replacements[cast(str, input_id)] for input_id in _array(node["inputNodeIds"])
        ]
    graph["rootNodeIds"] = ["RENAMED_ROOT"]

    assert (
        validate_program_v1(left).canonical_bytes() == validate_program_v1(right).canonical_bytes()
    )


def test_noncommutative_input_order_changes_family_identity() -> None:
    left = _without_plan()
    right = copy.deepcopy(left)
    right_root = _node(_candidate(right, "ATTEMPT_MOMENTUM"), "MOMENTUM")
    _array(right_root["inputNodeIds"]).reverse()

    left_identity = _identity(
        validate_program_v1(left),
        "ATTEMPT_MOMENTUM",
    )
    right_identity = _identity(
        validate_program_v1(right),
        "ATTEMPT_MOMENTUM",
    )
    assert left_identity.family_fingerprint != right_identity.family_fingerprint
    assert left_identity.hypothesis_fingerprint != right_identity.hypothesis_fingerprint


def test_commutative_input_order_does_not_change_family_identity() -> None:
    left = _without_plan()
    left_root = _node(_candidate(left, "ATTEMPT_MOMENTUM"), "MOMENTUM")
    left_root["opId"] = "SUM"
    right = copy.deepcopy(left)
    right_root = _node(_candidate(right, "ATTEMPT_MOMENTUM"), "MOMENTUM")
    _array(right_root["inputNodeIds"]).reverse()

    left_identity = _identity(
        validate_program_v1(left),
        "ATTEMPT_MOMENTUM",
    )
    right_identity = _identity(
        validate_program_v1(right),
        "ATTEMPT_MOMENTUM",
    )
    assert left_identity.family_fingerprint == right_identity.family_fingerprint
    assert left_identity.hypothesis_fingerprint == right_identity.hypothesis_fingerprint


def test_parameter_value_changes_hypothesis_but_not_family() -> None:
    left = _without_plan()
    right = copy.deepcopy(left)
    lag = _node(_candidate(right, "ATTEMPT_MOMENTUM"), "MID_LAG")
    binding = _object(_array(lag["parameterBindings"])[0])
    binding["valueId"] = "FOUR_HOURS"

    left_identity = _identity(
        validate_program_v1(left),
        "ATTEMPT_MOMENTUM",
    )
    right_identity = _identity(
        validate_program_v1(right),
        "ATTEMPT_MOMENTUM",
    )
    assert left_identity.family_fingerprint == right_identity.family_fingerprint
    assert left_identity.hypothesis_fingerprint != right_identity.hypothesis_fingerprint


def test_venue_sizing_bookkeeping_and_labels_are_nonpredictive() -> None:
    left = _without_plan()
    right = copy.deepcopy(left)
    candidate = _candidate(right, "ATTEMPT_MOMENTUM")
    candidate["displayName"] = "Completely renamed wrapper"
    nuisance = _object(candidate["nuisance"])
    nuisance["venueProviderIds"] = ["OTHER_VENUE"]
    nuisance["sizingPolicyId"] = "OTHER_SIZING"
    nuisance["bookkeepingPolicyId"] = "OTHER_BOOKKEEPING"

    left_identity = _identity(
        validate_program_v1(left),
        "ATTEMPT_MOMENTUM",
    )
    right_identity = _identity(
        validate_program_v1(right),
        "ATTEMPT_MOMENTUM",
    )
    assert left_identity.family_fingerprint == right_identity.family_fingerprint
    assert left_identity.hypothesis_fingerprint == right_identity.hypothesis_fingerprint
    assert left_identity.nuisance_fingerprint != right_identity.nuisance_fingerprint


def test_single_attempt_does_not_require_multiplicity_plan() -> None:
    manifest = _without_plan()
    manifest["candidates"] = [_candidate(manifest, "ATTEMPT_MOMENTUM")]

    receipt = validate_program_v1(manifest)

    assert receipt.reason_codes == ()
    assert receipt.multiplicity_status == "NOT_REQUIRED_SINGLE_ATTEMPT"
    assert receipt.scheduler_disposition == "ADMIT"


@pytest.mark.parametrize(
    ("mutation", "expected_code"),
    [
        ("UNKNOWN_OP", "FEATURE_OP_INVALID"),
        ("DANGLING_INPUT", "FEATURE_INPUT_DANGLING"),
        ("GRAPH_CYCLE", "FEATURE_GRAPH_CYCLE"),
        ("UNREACHABLE_NODE", "FEATURE_NODE_UNREACHABLE"),
        ("SOURCE_ROOT", "FEATURE_ROOT_SOURCE_ONLY"),
        ("DUPLICATE_NODE", "DUPLICATE_NODE_ID"),
        ("DUPLICATE_INPUT", "DUPLICATE_IDENTIFIER"),
        ("UNICODE_IDENTIFIER", "IDENTIFIER_INVALID"),
        ("BOOLEAN_ALPHA", "INTEGER_REQUIRED"),
        ("FLOAT_ALPHA", "INTEGER_REQUIRED"),
        ("EXTRA_KEY", "KEY_SET_INVALID"),
    ],
)
def test_malformed_contracts_fail_closed(
    mutation: str,
    expected_code: str,
) -> None:
    manifest = load_valid_fixture()
    momentum = _candidate(manifest, "ATTEMPT_MOMENTUM")
    if mutation == "UNKNOWN_OP":
        _node(momentum, "MOMENTUM")["opId"] = "MAGIC_ALPHA"
    elif mutation == "DANGLING_INPUT":
        _node(momentum, "MID_LAG")["inputNodeIds"] = ["ABSENT"]
    elif mutation == "GRAPH_CYCLE":
        _node(momentum, "MID_LAG")["inputNodeIds"] = ["MID_LAG"]
    elif mutation == "UNREACHABLE_NODE":
        graph = _object(momentum["featureGraph"])
        _array(graph["nodes"]).append(
            {
                "nodeId": "UNUSED",
                "opId": "SOURCE",
                "inputNodeIds": [],
                "sourceRoleId": "UNUSED_SOURCE",
                "parameterBindings": [],
            }
        )
    elif mutation == "SOURCE_ROOT":
        _object(momentum["featureGraph"])["rootNodeIds"] = ["MID"]
    elif mutation == "DUPLICATE_NODE":
        graph = _object(momentum["featureGraph"])
        _array(graph["nodes"]).append(copy.deepcopy(_array(graph["nodes"])[0]))
    elif mutation == "DUPLICATE_INPUT":
        _node(momentum, "MOMENTUM")["inputNodeIds"] = ["MID", "MID"]
    elif mutation == "UNICODE_IDENTIFIER":
        momentum["attemptId"] = "ΑTTEMPT_CONFUSABLE"  # noqa: RUF001
    elif mutation == "BOOLEAN_ALPHA":
        _object(_object(manifest["globalMultiplicity"])["alpha"])["numerator"] = True
    elif mutation == "FLOAT_ALPHA":
        _object(_object(manifest["globalMultiplicity"])["alpha"])["numerator"] = 1.0
    elif mutation == "EXTRA_KEY":
        momentum["freeTextSignal"] = "trust me"
    else:
        raise AssertionError(f"unhandled malformed mutation {mutation}")
    _expect_contract_error(manifest, expected_code)


def test_duplicate_json_keys_are_rejected_before_schema_validation() -> None:
    path = FIXTURE_DIRECTORY / "duplicate_key_program.v1.json"

    with pytest.raises(ContractError) as raised:
        load_program_manifest_v1(path)

    assert raised.value.code == "DUPLICATE_JSON_KEY"


def test_fixture_plan_can_be_rebound_to_current_exact_coordinates() -> None:
    manifest = load_valid_fixture()
    _object(manifest["globalMultiplicity"])["familyUniverseDigest"] = "0" * 64

    rebound = cover_manifest(manifest)
    receipt = validate_program_v1(rebound)

    assert receipt.reason_codes == ()
    assert receipt.multiplicity_status == "COVERED"


def test_loader_rejects_nonfinite_json_number(tmp_path: Path) -> None:
    path = tmp_path / "nonfinite.json"
    path.write_text('{"value": NaN}', encoding="utf-8")

    with pytest.raises(ContractError) as raised:
        load_program_manifest_v1(path)

    assert raised.value.code == "NONFINITE_JSON_NUMBER"


def test_frozen_known_answer_matches() -> None:
    verify_known_answer()
