"""Verify the frozen valid receipt and every focused hostile fixture."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import cast

from .validator import (
    TruthValidationError,
    canonical_receipt_json,
    validate_research_economics_truth_v1,
)

_ROOT = Path(__file__).resolve().parent
_VALID_PATH = _ROOT / "fixtures" / "valid.v1.json"
_HOSTILE_PATH = _ROOT / "fixtures" / "hostile.v1.json"
_KNOWN_ANSWER_PATH = _ROOT / "known_answer.v1.json"


def _load_object(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        value: object = json.load(handle)
    if type(value) is not dict:
        raise AssertionError(f"{path.name} must contain a JSON object")
    raw = cast(dict[object, object], value)
    if any(type(key) is not str for key in raw):
        raise AssertionError(f"{path.name} keys must be strings")
    return {cast(str, key): item for key, item in raw.items()}


def _object(value: object, context: str) -> dict[str, object]:
    if type(value) is not dict:
        raise AssertionError(f"{context} must be an object")
    return cast(dict[str, object], value)


def _array(value: object, context: str) -> list[object]:
    if type(value) is not list:
        raise AssertionError(f"{context} must be an array")
    return cast(list[object], value)


def _text(value: object, context: str) -> str:
    if type(value) is not str:
        raise AssertionError(f"{context} must be a string")
    return value


def load_valid_fixture() -> dict[str, object]:
    """Return a fresh valid fixture object."""

    return _load_object(_VALID_PATH)


def load_hostile_cases() -> list[dict[str, object]]:
    """Return structurally checked hostile mutation cases."""

    fixture = _load_object(_HOSTILE_PATH)
    if fixture.get("schema") != "cosmos.dq6.hostile-fixtures.v1":
        raise AssertionError("hostile fixture schema mismatch")
    cases = _array(fixture.get("cases"), "hostile cases")
    checked: list[dict[str, object]] = []
    for index, item in enumerate(cases):
        case = _object(item, f"hostile case {index}")
        if frozenset(case) != {"caseId", "expectedCode", "replacements"}:
            raise AssertionError(f"hostile case {index} keys mismatch")
        _text(case["caseId"], f"hostile case {index} id")
        _text(case["expectedCode"], f"hostile case {index} expected code")
        _array(case["replacements"], f"hostile case {index} replacements")
        checked.append(case)
    case_ids = [_text(case["caseId"], "caseId") for case in checked]
    if case_ids != sorted(case_ids) or len(case_ids) != len(set(case_ids)):
        raise AssertionError("hostile case ids must be sorted and unique")
    return checked


def apply_hostile_case(
    valid_document: dict[str, object],
    case: dict[str, object],
) -> dict[str, object]:
    """Apply a bounded existing-key replacement fixture to a fresh document."""

    mutated = copy.deepcopy(valid_document)
    replacements = _array(case["replacements"], "replacements")
    if not replacements:
        raise AssertionError("a hostile case must contain at least one replacement")
    for replacement_index, raw_replacement in enumerate(replacements):
        replacement = _object(raw_replacement, f"replacement {replacement_index}")
        if frozenset(replacement) != {"path", "value"}:
            raise AssertionError(f"replacement {replacement_index} keys mismatch")
        raw_path = _array(replacement["path"], f"replacement {replacement_index} path")
        path = [
            _text(segment, f"replacement {replacement_index} path segment") for segment in raw_path
        ]
        if not path:
            raise AssertionError("replacement path must not be empty")
        target = mutated
        for segment in path[:-1]:
            if segment not in target:
                raise AssertionError(f"replacement path does not exist: {segment}")
            target = _object(target[segment], f"replacement path {segment}")
        leaf = path[-1]
        if leaf not in target:
            raise AssertionError(f"replacement leaf does not exist: {leaf}")
        target[leaf] = copy.deepcopy(replacement["value"])
    return mutated


def verify() -> str:
    """Run exact valid/hostile verification and return one terse proof line."""

    valid_document = load_valid_fixture()
    receipt = validate_research_economics_truth_v1(valid_document)
    actual_known_answer = canonical_receipt_json(receipt)
    expected_known_answer = _KNOWN_ANSWER_PATH.read_bytes()
    if actual_known_answer != expected_known_answer:
        raise AssertionError("valid receipt does not match known_answer.v1.json")

    hostile_cases = load_hostile_cases()
    for case in hostile_cases:
        case_id = _text(case["caseId"], "caseId")
        expected_code = _text(case["expectedCode"], "expectedCode")
        mutated = apply_hostile_case(valid_document, case)
        try:
            validate_research_economics_truth_v1(mutated)
        except TruthValidationError as error:
            if error.code != expected_code:
                raise AssertionError(
                    f"{case_id} expected {expected_code}, received {error.code}"
                ) from error
        else:
            raise AssertionError(f"{case_id} unexpectedly validated")

    digest = _text(receipt["receiptDigestSha256"], "receipt digest")
    return f"DQ6_KNOWN_ANSWER_OK valid=1 hostile={len(hostile_cases)} receipt={digest}"


def main() -> None:
    """CLI entrypoint."""

    print(verify())


if __name__ == "__main__":
    main()
