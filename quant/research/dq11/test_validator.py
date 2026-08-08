"""Focused clean and hostile proof for the DQ-11 validator."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from research.dq11 import validator
from research.dq11.__main__ import main as cli_main
from research.dq11.validator import (
    MAX_INPUT_BYTES,
    PUBLIC_API_V1,
    AdmissionStatus,
    ContractError,
    IdentityV1,
    OutcomeStatus,
    identity_set_digest_v1,
    receipt_json_bytes_v1,
    validate_bytes_v1,
    validate_document_v1,
)

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
VALID_FIXTURE = FIXTURES / "valid-mixed.v1.json"
HOSTILE_MANIFEST = FIXTURES / "hostile-cases.v1.json"

IDENTITIES = {key: IdentityV1(f"sample-{key}", key * 64) for key in "abcdef"}


def _identity_object(key: str) -> dict[str, str]:
    return IDENTITIES[key].to_object()


def _stage(keys: str) -> dict[str, Any]:
    identities = tuple(IDENTITIES[key] for key in keys)
    return {
        "observation": "OBSERVED",
        "declaredCount": len(identities),
        "declaredIdentityDigest": identity_set_digest_v1(identities),
        "identities": [identity.to_object() for identity in identities],
    }


def _disposition(key: str, after_stage: str, reason: str) -> dict[str, Any]:
    return {
        "identity": _identity_object(key),
        "afterStage": after_stage,
        "reasonCode": reason,
        "evidenceState": "OBSERVED",
    }


def _packet(
    stage_keys: dict[str, str],
    dispositions: list[dict[str, Any]],
    *,
    flow_id: str = "dq11-test-flow",
) -> dict[str, Any]:
    stages = {
        name: _stage(stage_keys[name])
        for name in (
            "available",
            "eligible",
            "quarantined",
            "admitted",
            "signaled",
            "filled",
            "scored",
        )
    }
    admitted = stages["admitted"]
    return {
        "schema": "cosmos.dq11.sample-admission-denominator.v1",
        "flowId": flow_id,
        "stages": stages,
        "dispositions": dispositions,
        "frozenAdmissionDenominator": {
            "declaredCount": admitted["declaredCount"],
            "identityDigest": admitted["declaredIdentityDigest"],
        },
    }


def _valid_document() -> dict[str, Any]:
    return json.loads(VALID_FIXTURE.read_text(encoding="utf-8"))


def _refresh_stage(document: dict[str, Any], stage_name: str) -> None:
    stage = document["stages"][stage_name]
    identities = tuple(
        IdentityV1(item["sampleId"], item["originDigest"]) for item in stage["identities"]
    )
    stage["declaredCount"] = len(identities)
    stage["declaredIdentityDigest"] = identity_set_digest_v1(identities)


def _expect_code(document: object, code: str) -> None:
    with pytest.raises(ContractError) as raised:
        validate_document_v1(document)
    assert raised.value.code == code


def _resolve_parent(document: Any, path: list[str | int]) -> tuple[Any, str | int]:
    current = document
    for component in path[:-1]:
        current = current[component]
    return current, path[-1]


def _apply_operation(document: dict[str, Any], operation: dict[str, Any]) -> None:
    path = operation["path"]
    parent, leaf = _resolve_parent(document, path)
    action = operation["operation"]
    if action == "replace":
        parent[leaf] = operation["value"]
    elif action == "remove":
        if isinstance(parent, list):
            parent.pop(leaf)
        else:
            del parent[leaf]
    elif action == "append":
        parent[leaf].append(operation["value"])
    else:  # pragma: no cover - the checked-in manifest owns this closed vocabulary.
        raise AssertionError(f"unknown fixture operation {action!r}")


HOSTILE_CASES = json.loads(HOSTILE_MANIFEST.read_text(encoding="utf-8"))["cases"]


def test_valid_fixture_reconciles_every_stage_and_admission_anchor() -> None:
    raw = VALID_FIXTURE.read_bytes()
    receipt = validate_bytes_v1(raw)

    assert receipt.source_sha256 == hashlib.sha256(raw).hexdigest()
    assert receipt.admission_status is AdmissionStatus.READY
    assert receipt.outcome_status is OutcomeStatus.OBSERVED_SCORED_SAMPLES
    assert receipt.denominator_usable is True
    assert [stage.declared_count for stage in receipt.stages] == [6, 5, 1, 4, 3, 2, 1]
    assert receipt.frozen_admission_count == 4
    assert receipt.to_object()["authority"] == "NONE"
    assert all(
        receipt.to_object()["reconciliations"].values()  # type: ignore[union-attr]
    )


@pytest.mark.parametrize(
    "case",
    HOSTILE_CASES,
    ids=[case["caseId"] for case in HOSTILE_CASES],
)
def test_checked_in_hostile_fixture_matrix(case: dict[str, Any]) -> None:
    document = copy.deepcopy(_valid_document())
    for operation in case["operations"]:
        _apply_operation(document, operation)
    _expect_code(document, case["expectedCode"])


def test_duplicate_json_key_is_rejected_before_schema_validation() -> None:
    with pytest.raises(ContractError) as raised:
        validate_bytes_v1((FIXTURES / "duplicate-key.v1.json").read_bytes())
    assert raised.value.code == "DUPLICATE_JSON_KEY"


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        (b'{"x":NaN}', "NON_FINITE_NUMBER"),
        (b"\xef\xbb\xbf{}", "UTF8_BOM_FORBIDDEN"),
        (b"\xff", "INVALID_UTF8"),
        (b"{", "MALFORMED_JSON"),
        (b"[" * 20_000 + b"0" + b"]" * 20_000, "JSON_DEPTH_EXCEEDED"),
        (
            b'{"schema":' + b"9" * 5_000 + b"}",
            "JSON_INTEGER_BOUND_EXCEEDED",
        ),
        (b" " * (MAX_INPUT_BYTES + 1), "INPUT_BOUND_EXCEEDED"),
    ],
    ids=[
        "non-finite",
        "bom",
        "invalid-utf8",
        "malformed",
        "deep-nesting",
        "oversized-integer",
        "oversized-input",
    ],
)
def test_strict_raw_json_boundary(raw: bytes, code: str) -> None:
    with pytest.raises(ContractError) as raised:
        validate_bytes_v1(raw)
    assert raised.value.code == code


def test_identity_mutation_is_not_hidden_by_a_refreshed_stage_digest() -> None:
    document = _valid_document()
    document["stages"]["eligible"]["identities"][0]["originDigest"] = "f" * 64
    _refresh_stage(document, "eligible")
    _expect_code(document, "IDENTITY_MUTATION")


def test_equal_count_identity_substitution_cannot_bypass_admission() -> None:
    document = _valid_document()
    document["stages"]["signaled"]["identities"][2] = _identity_object("e")
    _refresh_stage(document, "signaled")
    _expect_code(document, "SIGNAL_WITHOUT_ADMISSION")


def test_filled_identity_cannot_bypass_signaled_stage() -> None:
    document = _valid_document()
    document["stages"]["filled"]["identities"][1] = _identity_object("d")
    _refresh_stage(document, "filled")
    _expect_code(document, "FILL_WITHOUT_SIGNAL")


def test_scored_identity_cannot_bypass_filled_stage() -> None:
    document = _valid_document()
    document["stages"]["scored"]["identities"][0] = _identity_object("c")
    _refresh_stage(document, "scored")
    _expect_code(document, "SCORE_WITHOUT_FILL")


def test_quarantined_identity_cannot_also_be_admitted() -> None:
    document = _valid_document()
    document["stages"]["admitted"]["identities"][3] = _identity_object("e")
    _refresh_stage(document, "admitted")
    _expect_code(document, "QUARANTINE_ADMISSION_OVERLAP")


def test_eligible_identity_cannot_silently_escape_quarantine_or_admission() -> None:
    document = _valid_document()
    document["stages"]["quarantined"]["identities"] = []
    _refresh_stage(document, "quarantined")
    _expect_code(document, "QUARANTINE_PARTITION_DRIFT")


def test_duplicate_origin_digest_under_an_alias_is_rejected() -> None:
    document = _valid_document()
    document["stages"]["available"]["identities"][1]["originDigest"] = "a" * 64
    _expect_code(document, "DUPLICATE_ORIGIN_IDENTITY")


def test_one_identity_cannot_receive_multiple_terminal_dispositions() -> None:
    document = _valid_document()
    document["dispositions"].append(copy.deepcopy(document["dispositions"][0]))
    _expect_code(document, "DUPLICATE_DISPOSITION")


def test_spurious_disposition_fails_the_exact_complement() -> None:
    document = _valid_document()
    document["dispositions"][0]["afterStage"] = "ADMITTED"
    _expect_code(document, "DISPOSITION_DRIFT")


def test_disposition_identity_must_retain_the_origin_digest() -> None:
    document = _valid_document()
    document["dispositions"][0]["identity"]["originDigest"] = "a" * 64
    _expect_code(document, "IDENTITY_MUTATION")


def test_explicit_missing_stage_is_not_an_observed_empty_stage() -> None:
    document = _valid_document()
    document["stages"]["signaled"] = {
        "observation": "MISSING",
        "declaredCount": None,
        "declaredIdentityDigest": None,
        "identities": None,
    }
    _expect_code(document, "STAGE_EVIDENCE_MISSING")


def test_missing_stage_cannot_carry_zero_values() -> None:
    document = _valid_document()
    document["stages"]["signaled"]["observation"] = "MISSING"
    _expect_code(document, "MISSING_STAGE_HAS_VALUES")


def test_fully_observed_empty_flow_is_valid_but_denominator_is_unusable() -> None:
    document = _packet(
        dict.fromkeys(
            (
                "available",
                "eligible",
                "quarantined",
                "admitted",
                "signaled",
                "filled",
                "scored",
            ),
            "",
        ),
        [],
        flow_id="observed-empty-flow",
    )
    receipt = validate_document_v1(document)

    assert receipt.admission_status is AdmissionStatus.UNMEASURED_ZERO_DENOMINATOR
    assert receipt.outcome_status is OutcomeStatus.UNMEASURED_NO_SCORED_SAMPLES
    assert receipt.denominator_usable is False
    assert {rate.status for _, rate in receipt.rates} == {"UNMEASURED_ZERO_DENOMINATOR"}
    assert all(rate.numerator == rate.denominator == 0 for _, rate in receipt.rates)


def test_complete_exclusion_flow_preserves_observed_zero_admissions() -> None:
    document = _packet(
        {
            "available": "a",
            "eligible": "",
            "quarantined": "",
            "admitted": "",
            "signaled": "",
            "filled": "",
            "scored": "",
        },
        [_disposition("a", "AVAILABLE", "INELIGIBLE_PROTOCOL")],
        flow_id="observed-no-admission",
    )
    receipt = validate_document_v1(document)

    assert receipt.stages[0].declared_count == 1
    assert receipt.admission_status is AdmissionStatus.UNMEASURED_ZERO_DENOMINATOR
    assert receipt.denominator_usable is False


def test_positive_admission_denominator_can_have_observed_zero_events() -> None:
    document = _packet(
        {
            "available": "ab",
            "eligible": "ab",
            "quarantined": "",
            "admitted": "ab",
            "signaled": "",
            "filled": "",
            "scored": "",
        },
        [
            _disposition("a", "ADMITTED", "NO_SIGNAL_OBSERVED"),
            _disposition("b", "ADMITTED", "NO_SIGNAL_OBSERVED"),
        ],
        flow_id="observed-zero-events",
    )
    receipt = validate_document_v1(document)

    assert receipt.admission_status is AdmissionStatus.READY
    assert receipt.outcome_status is OutcomeStatus.UNMEASURED_NO_SCORED_SAMPLES
    assert receipt.denominator_usable is True
    assert all(rate.denominator == 2 for _, rate in receipt.rates)
    assert all(rate.numerator == 0 for _, rate in receipt.rates)
    assert all(rate.status == "OBSERVED_ZERO" for _, rate in receipt.rates)


def test_observed_no_fill_keeps_admitted_denominator() -> None:
    document = _packet(
        {
            "available": "a",
            "eligible": "a",
            "quarantined": "",
            "admitted": "a",
            "signaled": "a",
            "filled": "",
            "scored": "",
        },
        [_disposition("a", "SIGNALED", "NO_FILL_OBSERVED")],
        flow_id="observed-no-fill",
    )
    receipt = validate_document_v1(document)
    rates = dict(receipt.rates)

    assert rates["signaled"].to_object() == {
        "numerator": 1,
        "denominator": 1,
        "status": "OBSERVED",
    }
    assert rates["filled"].to_object() == {
        "numerator": 0,
        "denominator": 1,
        "status": "OBSERVED_ZERO",
    }


def test_input_order_changes_source_hash_but_not_semantic_flow_digest() -> None:
    original = _valid_document()
    reordered = copy.deepcopy(original)
    for stage in reordered["stages"].values():
        stage["identities"].reverse()
    reordered["dispositions"].reverse()

    original_receipt = validate_document_v1(original)
    reordered_receipt = validate_document_v1(reordered)

    assert original_receipt.flow_digest == reordered_receipt.flow_digest
    assert original_receipt.source_sha256 != reordered_receipt.source_sha256
    assert original_receipt.stages == reordered_receipt.stages


def test_receipt_bytes_are_deterministic_and_end_in_one_newline() -> None:
    receipt = validate_bytes_v1(VALID_FIXTURE.read_bytes())
    first = receipt_json_bytes_v1(receipt)
    second = receipt_json_bytes_v1(receipt)

    assert first == second
    assert first.endswith(b"\n")
    assert not first.endswith(b"\n\n")
    assert b"NaN" not in first
    assert b"Infinity" not in first


def test_public_api_is_explicitly_frozen_at_v1() -> None:
    assert PUBLIC_API_V1 == (
        "cosmos.dq11.sample-admission-denominator.v1",
        "cosmos.dq11.sample-admission-denominator-receipt.v1",
        "ContractError",
        "IdentityV1",
        "StageV1",
        "ValidationReceiptV1",
        "canonical_json_bytes_v1",
        "identity_set_digest_v1",
        "receipt_json_bytes_v1",
        "validate_bytes_v1",
        "validate_document_v1",
    )


def test_contract_error_has_a_stable_machine_object() -> None:
    error = ContractError("EXAMPLE", "$.path", "detail")
    assert error.to_object() == {
        "schema": "cosmos.dq11.error.v1",
        "code": "EXAMPLE",
        "path": "$.path",
        "detail": "detail",
    }


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda document: document.pop("flowId"), "FIELD_MISSING"),
        (lambda document: document.update({"extra": 1}), "UNKNOWN_FIELD"),
        (lambda document: document.update({"schema": "forged"}), "SCHEMA_MISMATCH"),
        (lambda document: document.update({"flowId": 1}), "STRING_TYPE"),
        (lambda document: document.update({"flowId": ""}), "STRING_FORMAT"),
        (
            lambda document: document["stages"].update({"unexpected": _stage("")}),
            "UNKNOWN_STAGE",
        ),
        (
            lambda document: document["stages"]["available"].update({"observation": "UNKNOWN"}),
            "OBSERVATION_STATE",
        ),
        (
            lambda document: document["stages"]["available"].update({"declaredCount": -1}),
            "COUNT_RANGE",
        ),
        (
            lambda document: document["stages"]["available"].update({"declaredCount": 100_001}),
            "COUNT_BOUND_EXCEEDED",
        ),
        (
            lambda document: document["dispositions"][0].update({"afterStage": "QUARANTINED"}),
            "DISPOSITION_STAGE",
        ),
        (
            lambda document: document["dispositions"][0].update({"evidenceState": "UNKNOWN"}),
            "EVIDENCE_STATE",
        ),
        (
            lambda document: document["dispositions"][0].update({"reasonCode": 7}),
            "STRING_TYPE",
        ),
        (
            lambda document: document["dispositions"][0].update({"reasonCode": "lowercase"}),
            "STRING_FORMAT",
        ),
    ],
)
def test_closed_structural_contract_rejects_hostile_shapes(
    mutate: Any,
    code: str,
) -> None:
    document = _valid_document()
    mutate(document)
    _expect_code(document, code)


@pytest.mark.parametrize(
    ("document", "code"),
    [
        ([], "OBJECT_TYPE"),
        (
            {
                "schema": "cosmos.dq11.sample-admission-denominator.v1",
                "flowId": "x",
                "stages": {},
                "dispositions": {},
                "frozenAdmissionDenominator": {},
            },
            "STAGE_MISSING",
        ),
    ],
)
def test_top_level_and_required_collection_types_fail_closed(
    document: object,
    code: str,
) -> None:
    _expect_code(document, code)


def test_dispositions_must_be_an_array() -> None:
    document = _valid_document()
    document["dispositions"] = {}
    _expect_code(document, "ARRAY_TYPE")


def test_identity_list_must_be_an_array() -> None:
    document = _valid_document()
    document["stages"]["available"]["identities"] = {}
    _expect_code(document, "ARRAY_TYPE")


def test_non_json_in_memory_values_are_rejected_before_validation() -> None:
    _expect_code({"not": {"a", "json", "value"}}, "NON_CANONICAL_VALUE")


def test_foreign_identity_is_rejected_even_with_a_refreshed_digest() -> None:
    document = _valid_document()
    document["stages"]["eligible"]["identities"][4] = {
        "sampleId": "sample-z",
        "originDigest": "0" * 64,
    }
    _refresh_stage(document, "eligible")
    _expect_code(document, "ORPHAN_ID")


def test_spurious_only_disposition_fails_exact_complement() -> None:
    document = _valid_document()
    document["dispositions"].append(_disposition("a", "AVAILABLE", "SPURIOUS_EXCLUSION"))
    _expect_code(document, "DISPOSITION_DRIFT")


def test_collection_bounds_stop_before_partial_item_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = _valid_document()
    monkeypatch.setattr(validator, "MAX_DISPOSITIONS", 4)
    _expect_code(document, "DISPOSITION_BOUND_EXCEEDED")


def test_cli_rejects_an_oversized_file_with_a_canonical_error(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    oversized = tmp_path / "oversized.json"
    oversized.write_bytes(b" " * (MAX_INPUT_BYTES + 1))

    assert cli_main([str(oversized)]) == 2
    error = json.loads(capsys.readouterr().err)
    assert error == {
        "schema": "cosmos.dq11.error.v1",
        "code": "INPUT_BOUND_EXCEEDED",
        "path": "$",
        "detail": f"file exceeds {MAX_INPUT_BYTES} bytes",
    }
