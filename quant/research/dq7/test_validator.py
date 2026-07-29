from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Final, cast

import pytest
from research.dq7 import PUBLIC_API_V1
from research.dq7 import validator as validator_module
from research.dq7.fixture_harness import (
    FIXTURE_DIRECTORY,
    cover_manifest,
    fixture_freeze_digest,
    fixture_ontology_digest,
    load_hostile_case_records,
    load_valid_fixture,
    materialize_hostile_case,
    validate_fixture_manifest,
)
from research.dq7.validator import (
    ContractError,
    calculate_pre_outcome_freeze_digest_v1,
    load_program_manifest_v1,
    semantic_ontology_digest_v1,
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
        validate_fixture_manifest(manifest)
    assert raised.value.code == expected_code


def test_valid_fixture_is_clean_and_covered() -> None:
    receipt = validate_fixture_manifest(load_valid_fixture())

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

    first = validate_fixture_manifest(manifest)
    second = validate_fixture_manifest(copy.deepcopy(manifest))

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
        validate_fixture_manifest(left).canonical_bytes()
        == validate_fixture_manifest(right).canonical_bytes()
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
        validate_fixture_manifest(left).canonical_bytes()
        == validate_fixture_manifest(right).canonical_bytes()
    )


def test_noncommutative_input_order_changes_family_identity() -> None:
    left = _without_plan()
    right = copy.deepcopy(left)
    right_root = _node(_candidate(right, "ATTEMPT_MOMENTUM"), "MOMENTUM")
    _array(right_root["inputNodeIds"]).reverse()

    left_identity = _identity(
        validate_fixture_manifest(left),
        "ATTEMPT_MOMENTUM",
    )
    right_identity = _identity(
        validate_fixture_manifest(right),
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
        validate_fixture_manifest(left),
        "ATTEMPT_MOMENTUM",
    )
    right_identity = _identity(
        validate_fixture_manifest(right),
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
        validate_fixture_manifest(left),
        "ATTEMPT_MOMENTUM",
    )
    right_identity = _identity(
        validate_fixture_manifest(right),
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
        validate_fixture_manifest(left),
        "ATTEMPT_MOMENTUM",
    )
    right_identity = _identity(
        validate_fixture_manifest(right),
        "ATTEMPT_MOMENTUM",
    )
    assert left_identity.family_fingerprint == right_identity.family_fingerprint
    assert left_identity.hypothesis_fingerprint == right_identity.hypothesis_fingerprint
    assert left_identity.nuisance_fingerprint != right_identity.nuisance_fingerprint


def test_single_attempt_still_requires_preoutcome_registry_plan() -> None:
    manifest = _without_plan()
    manifest["candidates"] = [_candidate(manifest, "ATTEMPT_MOMENTUM")]

    receipt = validate_fixture_manifest(manifest)

    assert receipt.reason_codes == ("PROGRAM_MULTIPLICITY_PLAN_MISSING",)
    assert receipt.multiplicity_status == "MISSING"
    assert receipt.scheduler_disposition == "REJECT"


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
                "sourceRoleId": "SPOT_MID_PRICE",
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
    receipt = validate_fixture_manifest(rebound)

    assert receipt.reason_codes == ()
    assert receipt.multiplicity_status == "COVERED"


def test_out_of_band_ontology_and_freeze_pins_are_mandatory() -> None:
    manifest = load_valid_fixture()

    fully_untrusted = validate_program_v1(manifest)
    freeze_untrusted = validate_program_v1(
        manifest,
        accepted_semantic_ontology_digest=fixture_ontology_digest(),
    )

    assert fully_untrusted.reason_codes == (
        "PROGRAM_SEMANTIC_ONTOLOGY_UNTRUSTED",
        "PROGRAM_PREOUTCOME_FREEZE_UNTRUSTED",
    )
    assert freeze_untrusted.reason_codes == ("PROGRAM_PREOUTCOME_FREEZE_UNTRUSTED",)
    assert fully_untrusted.scheduler_disposition == "REJECT"
    assert freeze_untrusted.scheduler_disposition == "REJECT"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("attemptStatus", "COMPLETED"),
        ("attemptStatus", "FAILED"),
        ("attemptStatus", "ABANDONED"),
        ("attemptStatus", "RETIRED_DUPLICATE"),
        ("outcomeAccessed", True),
        ("resultDigest", "d" * 64),
    ],
)
def test_shipped_freeze_helper_rejects_each_closing_field(
    field: str,
    value: object,
) -> None:
    manifest = load_valid_fixture()
    candidate = _candidate(manifest, "ATTEMPT_MOMENTUM")
    if field == "resultDigest":
        _object(candidate["nuisance"])[field] = value
    else:
        candidate[field] = value

    with pytest.raises(ContractError) as minted:
        calculate_pre_outcome_freeze_digest_v1(manifest)
    with pytest.raises(ContractError) as covered:
        cover_manifest(manifest)

    assert minted.value.code == "PREOUTCOME_FREEZE_CLOSED"
    assert covered.value.code == "PREOUTCOME_FREEZE_CLOSED"


def test_freeze_coordinate_is_unmintable_once_any_outcome_is_acknowledged() -> None:
    open_manifest = load_valid_fixture()
    closed_manifest = copy.deepcopy(open_manifest)
    for raw_candidate in _array(closed_manifest["candidates"]):
        candidate = _object(raw_candidate)
        candidate["attemptStatus"] = "COMPLETED"
        candidate["outcomeAccessed"] = True
        _object(candidate["nuisance"])["resultDigest"] = "d" * 64

    assert calculate_pre_outcome_freeze_digest_v1(open_manifest) == fixture_freeze_digest(
        open_manifest
    )
    with pytest.raises(ContractError) as raised:
        calculate_pre_outcome_freeze_digest_v1(closed_manifest)
    assert raised.value.code == "PREOUTCOME_FREEZE_CLOSED"


def test_post_outcome_attempt_subset_cannot_mint_a_fresh_pin() -> None:
    manifest = load_valid_fixture()
    for raw_candidate in _array(manifest["candidates"]):
        candidate = _object(raw_candidate)
        candidate["attemptStatus"] = "COMPLETED"
        candidate["outcomeAccessed"] = True
        _object(candidate["nuisance"])["resultDigest"] = "d" * 64
    _array(manifest["candidates"]).pop()

    with pytest.raises(ContractError) as raised:
        calculate_pre_outcome_freeze_digest_v1(manifest)

    assert raised.value.code == "PREOUTCOME_FREEZE_CLOSED"


def test_execution_updates_preserve_freeze_but_change_execution_digest() -> None:
    before_manifest = load_valid_fixture()
    after_manifest = copy.deepcopy(before_manifest)
    for raw_candidate in _array(after_manifest["candidates"]):
        candidate = _object(raw_candidate)
        candidate["attemptStatus"] = "COMPLETED"
        candidate["outcomeAccessed"] = True
        _object(candidate["nuisance"])["resultDigest"] = "d" * 64

    before = validate_fixture_manifest(before_manifest)
    after = validate_fixture_manifest(after_manifest)

    assert after.reason_codes == ()
    assert after.multiplicity_status == "COVERED"
    assert after.scheduler_disposition == "ADMIT"
    assert after.attempt_ledger_digest == before.attempt_ledger_digest
    assert after.family_universe_digest == before.family_universe_digest
    assert after.computed_pre_outcome_freeze_digest == before.computed_pre_outcome_freeze_digest
    assert after.accepted_pre_outcome_freeze_digest == before.accepted_pre_outcome_freeze_digest
    assert after.execution_state_digest != before.execution_state_digest
    assert after.manifest_digest != before.manifest_digest


def test_post_freeze_design_mutation_breaks_ledger_and_freeze() -> None:
    original_manifest = load_valid_fixture()
    mutated_manifest = copy.deepcopy(original_manifest)
    nuisance = _object(_candidate(mutated_manifest, "ATTEMPT_MOMENTUM")["nuisance"])
    nuisance["venueProviderIds"] = ["POST_FREEZE_VENUE"]
    nuisance["sizingPolicyId"] = "POST_FREEZE_SIZING"
    nuisance["implementationDigest"] = "e" * 64

    original = validate_fixture_manifest(original_manifest)
    mutated = validate_program_v1(
        mutated_manifest,
        accepted_semantic_ontology_digest=fixture_ontology_digest(),
        accepted_pre_outcome_freeze_digest=fixture_freeze_digest(original_manifest),
    )

    assert mutated.reason_codes == (
        "PROGRAM_MULTIPLICITY_DIGEST_MISMATCH",
        "PROGRAM_PREOUTCOME_FREEZE_DIGEST_MISMATCH",
        "PROGRAM_PREOUTCOME_FREEZE_UNTRUSTED",
    )
    assert mutated.scheduler_disposition == "REJECT"
    assert mutated.attempt_ledger_digest != original.attempt_ledger_digest
    assert mutated.computed_pre_outcome_freeze_digest != original.computed_pre_outcome_freeze_digest


def test_unregistered_and_wrong_kind_semantics_fail_closed() -> None:
    unregistered = load_valid_fixture()
    lag = _node(_candidate(unregistered, "ATTEMPT_MOMENTUM"), "MID_LAG")
    _object(_array(lag["parameterBindings"])[0])["roleId"] = "RENAMED_OPEN_ROLE"
    _expect_contract_error(unregistered, "SEMANTIC_ID_UNREGISTERED")

    wrong_role = load_valid_fixture()
    lag = _node(_candidate(wrong_role, "ATTEMPT_MOMENTUM"), "MID_LAG")
    _object(_array(lag["parameterBindings"])[0])["roleId"] = "LOOKBACK"
    _expect_contract_error(wrong_role, "FEATURE_PARAMETER_ROLE_INVALID")

    wrong_kind = load_valid_fixture()
    lag = _node(_candidate(wrong_kind, "ATTEMPT_MOMENTUM"), "MID_LAG")
    _object(_array(lag["parameterBindings"])[0])["roleId"] = "ONE_HOUR"
    _expect_contract_error(wrong_kind, "SEMANTIC_KIND_MISMATCH")


def test_ontology_alias_injection_cannot_reuse_the_accepted_pin() -> None:
    manifest = load_valid_fixture()
    ontology = _object(manifest["semanticOntology"])
    _array(ontology["entries"]).append(
        {
            "aliasId": "LATE_LAG_ALIAS",
            "canonicalId": "LAG_PERIOD",
            "kind": "PARAMETER_ROLE",
        }
    )
    lag = _node(_candidate(manifest, "ATTEMPT_MOMENTUM"), "MID_LAG")
    _object(_array(lag["parameterBindings"])[0])["roleId"] = "LATE_LAG_ALIAS"

    receipt = validate_program_v1(
        manifest,
        accepted_semantic_ontology_digest=fixture_ontology_digest(),
        accepted_pre_outcome_freeze_digest=fixture_freeze_digest(manifest),
    )

    assert "PROGRAM_SEMANTIC_ONTOLOGY_MISMATCH" in receipt.reason_codes
    assert "PROGRAM_SEMANTIC_ONTOLOGY_UNTRUSTED" in receipt.reason_codes
    assert "PROGRAM_PREOUTCOME_FREEZE_DIGEST_MISMATCH" in receipt.reason_codes
    assert receipt.scheduler_disposition == "REJECT"


def test_associative_commutative_graphs_have_one_family_identity() -> None:
    nested = _without_plan()
    nested_candidate = _candidate(nested, "ATTEMPT_MOMENTUM")
    nested_graph = _object(nested_candidate["featureGraph"])
    nested_graph["nodes"] = [
        {
            "nodeId": "SOURCE_A",
            "opId": "SOURCE",
            "inputNodeIds": [],
            "sourceRoleId": "SPOT_MID_PRICE",
            "parameterBindings": [],
        },
        {
            "nodeId": "SOURCE_B",
            "opId": "SOURCE",
            "inputNodeIds": [],
            "sourceRoleId": "PERPETUAL_FUNDING_RATE",
            "parameterBindings": [],
        },
        {
            "nodeId": "SOURCE_C",
            "opId": "SOURCE",
            "inputNodeIds": [],
            "sourceRoleId": "SIGNED_TRADE_FLOW",
            "parameterBindings": [],
        },
        {
            "nodeId": "INNER_SUM",
            "opId": "SUM",
            "inputNodeIds": ["SOURCE_A", "SOURCE_B"],
            "sourceRoleId": None,
            "parameterBindings": [],
        },
        {
            "nodeId": "OUTER_SUM",
            "opId": "SUM",
            "inputNodeIds": ["INNER_SUM", "SOURCE_C"],
            "sourceRoleId": None,
            "parameterBindings": [],
        },
    ]
    nested_graph["rootNodeIds"] = ["OUTER_SUM"]
    flat = copy.deepcopy(nested)
    flat_graph = _object(_candidate(flat, "ATTEMPT_MOMENTUM")["featureGraph"])
    flat_graph["nodes"] = [
        node for node in _array(flat_graph["nodes"]) if _object(node)["nodeId"] != "INNER_SUM"
    ]
    _node(_candidate(flat, "ATTEMPT_MOMENTUM"), "OUTER_SUM")["inputNodeIds"] = [
        "SOURCE_A",
        "SOURCE_B",
        "SOURCE_C",
    ]

    nested_identity = _identity(
        validate_fixture_manifest(nested),
        "ATTEMPT_MOMENTUM",
    )
    flat_identity = _identity(
        validate_fixture_manifest(flat),
        "ATTEMPT_MOMENTUM",
    )

    assert nested_identity.family_fingerprint == flat_identity.family_fingerprint
    assert nested_identity.hypothesis_fingerprint == flat_identity.hypothesis_fingerprint
    assert (
        nested_identity.non_source_family_fingerprints
        == flat_identity.non_source_family_fingerprints
    )
    assert nested_identity.signal_root_fingerprints == flat_identity.signal_root_fingerprints


_SUM_SOURCES: Final = (
    ("SOURCE_A", "SPOT_MID_PRICE"),
    ("SOURCE_B", "PERPETUAL_FUNDING_RATE"),
    ("SOURCE_C", "SIGNED_TRADE_FLOW"),
)


def _source_nodes(count: int) -> list[JsonObject]:
    return [
        {
            "nodeId": node_id,
            "opId": "SOURCE",
            "inputNodeIds": [],
            "sourceRoleId": role_id,
            "parameterBindings": [],
        }
        for node_id, role_id in _SUM_SOURCES[:count]
    ]


def _sum_node(node_id: str, input_node_ids: list[str]) -> JsonObject:
    return {
        "nodeId": node_id,
        "opId": "SUM",
        "inputNodeIds": input_node_ids,
        "sourceRoleId": None,
        "parameterBindings": [],
    }


def _overlap_pair_manifest(*, nested: bool) -> JsonObject:
    """Build one contained-signal pair, spelled nested or flat.

    ``ATTEMPT_FUNDING`` carries the complete two-term signal.  ``ATTEMPT_MOMENTUM``
    carries the three-term signal that contains it, written either as
    ``SUM(SUM(a,b),c)`` or as ``SUM(a,b,c)``.  Both spellings share one family
    fingerprint, so both must reach the same verdict.
    """

    manifest = load_valid_fixture()
    _array(manifest["candidates"]).pop()
    contained = _candidate(manifest, "ATTEMPT_FUNDING")
    container = _candidate(manifest, "ATTEMPT_MOMENTUM")
    contained["prediction"] = copy.deepcopy(container["prediction"])
    _object(contained["featureGraph"])["nodes"] = [
        *_source_nodes(2),
        _sum_node("PAIR_SUM", ["SOURCE_A", "SOURCE_B"]),
    ]
    _object(contained["featureGraph"])["rootNodeIds"] = ["PAIR_SUM"]
    container_graph = _object(container["featureGraph"])
    if nested:
        container_graph["nodes"] = [
            *_source_nodes(3),
            _sum_node("INNER_SUM", ["SOURCE_A", "SOURCE_B"]),
            _sum_node("OUTER_SUM", ["INNER_SUM", "SOURCE_C"]),
        ]
    else:
        container_graph["nodes"] = [
            *_source_nodes(3),
            _sum_node("OUTER_SUM", ["SOURCE_A", "SOURCE_B", "SOURCE_C"]),
        ]
    container_graph["rootNodeIds"] = ["OUTER_SUM"]
    return cover_manifest(manifest)


def test_associative_spelling_does_not_change_pair_verdicts() -> None:
    nested = validate_fixture_manifest(_overlap_pair_manifest(nested=True))
    flat = validate_fixture_manifest(_overlap_pair_manifest(nested=False))

    assert nested.reason_codes == flat.reason_codes
    assert nested.scheduler_disposition == flat.scheduler_disposition
    assert nested.n3_intake_disposition == flat.n3_intake_disposition
    assert (
        nested.verified_positive_structurally_eligible
        is flat.verified_positive_structurally_eligible
    )
    assert nested.family_component_count == flat.family_component_count
    assert nested.attempt_ledger_digest == flat.attempt_ledger_digest
    assert nested.family_universe_digest == flat.family_universe_digest
    assert nested.receipt_digest == flat.receipt_digest


def test_absorbed_commutative_node_is_kept_when_a_consumer_differs() -> None:
    manifest = _without_plan()
    candidate = _candidate(manifest, "ATTEMPT_MOMENTUM")
    graph = _object(candidate["featureGraph"])
    graph["nodes"] = [
        *_source_nodes(3),
        _sum_node("INNER_SUM", ["SOURCE_A", "SOURCE_B"]),
        _sum_node("OUTER_SUM", ["INNER_SUM", "SOURCE_C"]),
        {
            "nodeId": "INNER_ABS",
            "opId": "ABS",
            "inputNodeIds": ["INNER_SUM"],
            "sourceRoleId": None,
            "parameterBindings": [],
        },
    ]
    graph["rootNodeIds"] = ["OUTER_SUM", "INNER_ABS"]

    identity = _identity(validate_fixture_manifest(manifest), "ATTEMPT_MOMENTUM")

    # ABS consumes INNER_SUM, so flattening cannot erase it: its fingerprint has
    # to stay in subgraph membership, unlike the fully absorbed case above.
    # INNER_SUM, OUTER_SUM, and INNER_ABS are the three non-source nodes.
    assert len(identity.non_source_family_fingerprints) == 3


@pytest.mark.parametrize(
    "bindings",
    [
        [{"roleId": "LOOKBACK", "valueId": "ONE_DAY"}],
        [{"roleId": "BINNING_POLICY", "valueId": "EQUAL_WIDTH_BINS"}],
        [
            {"roleId": "LOOKBACK", "valueId": "ONE_DAY"},
            {"roleId": "BINNING_POLICY", "valueId": "EQUAL_WIDTH_BINS"},
            {"roleId": "LAG_PERIOD", "valueId": "ONE_HOUR"},
        ],
    ],
)
def test_exact_role_sets_reject_partial_and_extra_bindings(
    bindings: list[JsonObject],
) -> None:
    manifest = load_valid_fixture()
    _node(_candidate(manifest, "ATTEMPT_FLOW"), "FLOW_ENTROPY")["parameterBindings"] = bindings

    _expect_contract_error(manifest, "FEATURE_PARAMETER_ROLE_INVALID")


def test_role_presence_cannot_split_one_hypothesis_into_two_families() -> None:
    manifest = _without_plan()
    _array(manifest["candidates"]).pop()
    bare = _candidate(manifest, "ATTEMPT_MOMENTUM")
    spelled = _candidate(manifest, "ATTEMPT_FUNDING")
    spelled["prediction"] = copy.deepcopy(bare["prediction"])
    for candidate, bindings in (
        (
            bare,
            [{"roleId": "THRESHOLD_VALUE", "valueId": "ZERO_LEVEL"}],
        ),
        (
            spelled,
            [
                {"roleId": "THRESHOLD_VALUE", "valueId": "ZERO_LEVEL"},
                {"roleId": "COMPARISON_DIRECTION", "valueId": "GREATER_THAN"},
            ],
        ),
    ):
        graph = _object(candidate["featureGraph"])
        graph["nodes"] = [
            *_source_nodes(1),
            {
                "nodeId": "LEVEL",
                "opId": "THRESHOLD",
                "inputNodeIds": ["SOURCE_A"],
                "sourceRoleId": None,
                "parameterBindings": bindings,
            },
        ]
        graph["rootNodeIds"] = ["LEVEL"]

    # The omitted-role spelling is no longer expressible, so it can no longer
    # buy a second family fingerprint for one threshold rule.
    _expect_contract_error(manifest, "FEATURE_PARAMETER_ROLE_INVALID")


def test_draft_plan_carries_a_null_freeze_coordinate() -> None:
    manifest = load_valid_fixture()
    plan = _object(manifest["globalMultiplicity"])
    bound = cast(str, plan["preOutcomeFreezeDigest"])
    plan["preOutcomeFreezeDigest"] = None

    draft = validate_program_v1(
        manifest,
        accepted_semantic_ontology_digest=fixture_ontology_digest(),
    )

    assert fixture_freeze_digest(manifest) is None
    assert draft.computed_pre_outcome_freeze_digest == bound
    assert draft.accepted_pre_outcome_freeze_digest is None
    assert "PROGRAM_PREOUTCOME_FREEZE_DIGEST_MISMATCH" in draft.reason_codes
    assert "PROGRAM_PREOUTCOME_FREEZE_UNTRUSTED" in draft.reason_codes
    assert draft.scheduler_disposition == "REJECT"
    assert calculate_pre_outcome_freeze_digest_v1(manifest) == bound


def test_zero_digest_placeholder_is_never_a_valid_freeze_coordinate() -> None:
    manifest = load_valid_fixture()
    _object(manifest["globalMultiplicity"])["preOutcomeFreezeDigest"] = "0" * 64

    receipt = validate_program_v1(
        manifest,
        accepted_semantic_ontology_digest=fixture_ontology_digest(),
        accepted_pre_outcome_freeze_digest="0" * 64,
    )

    assert "PROGRAM_PREOUTCOME_FREEZE_DIGEST_MISMATCH" in receipt.reason_codes
    assert receipt.scheduler_disposition == "REJECT"


def test_receipt_separates_computed_and_accepted_freeze_coordinates() -> None:
    manifest = load_valid_fixture()
    accepted = fixture_freeze_digest(manifest)

    receipt = validate_fixture_manifest(manifest)
    payload = receipt.as_dict()

    assert receipt.computed_pre_outcome_freeze_digest == accepted
    assert receipt.accepted_pre_outcome_freeze_digest == accepted
    assert payload["computedPreOutcomeFreezeDigest"] == accepted
    assert payload["acceptedPreOutcomeFreezeDigest"] == accepted
    assert "preOutcomeFreezeDigest" not in payload

    unpinned = validate_program_v1(
        manifest,
        accepted_semantic_ontology_digest=fixture_ontology_digest(),
    )

    assert unpinned.computed_pre_outcome_freeze_digest == accepted
    assert unpinned.accepted_pre_outcome_freeze_digest is None
    assert unpinned.receipt_digest != receipt.receipt_digest


def test_attempt_ledger_digest_is_bound_to_the_semantic_ontology() -> None:
    manifest = load_valid_fixture()
    widened = copy.deepcopy(manifest)
    _array(_object(widened["semanticOntology"])["entries"]).append(
        {
            "aliasId": "UNUSED_MID_ALIAS",
            "canonicalId": "SPOT_MID_PRICE",
            "kind": "SOURCE_ROLE",
        }
    )

    original = validate_fixture_manifest(manifest)
    rebound = validate_program_v1(
        widened,
        accepted_semantic_ontology_digest=semantic_ontology_digest_v1(widened),
    )

    assert rebound.semantic_ontology_digest != original.semantic_ontology_digest
    assert rebound.attempt_ledger_digest != original.attempt_ledger_digest
    assert rebound.family_universe_digest != original.family_universe_digest
    for rebound_candidate, original_candidate in zip(
        rebound.candidates, original.candidates, strict=True
    ):
        assert rebound_candidate.family_fingerprint == original_candidate.family_fingerprint


def test_public_api_exports_every_validator_symbol() -> None:
    exported = set(PUBLIC_API_V1)
    defined = {
        name
        for name, value in vars(validator_module).items()
        if not name.startswith("_")
        and (
            getattr(value, "__module__", None) == validator_module.__name__
            or (name.isupper() and isinstance(value, str))
        )
    }

    assert defined - exported == set()
    assert exported - defined == set()
    assert len(PUBLIC_API_V1) == len(exported)
    assert "calculate_pre_outcome_freeze_digest_v1" in exported
    assert "semantic_ontology_digest_v1" in exported


def test_loader_rejects_nonfinite_json_number(tmp_path: Path) -> None:
    path = tmp_path / "nonfinite.json"
    path.write_text('{"value": NaN}', encoding="utf-8")

    with pytest.raises(ContractError) as raised:
        load_program_manifest_v1(path)

    assert raised.value.code == "NONFINITE_JSON_NUMBER"


def test_frozen_known_answer_matches() -> None:
    verify_known_answer()
