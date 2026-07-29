from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from research.dq13 import ValidationStatus

FIXTURE_SCHEMA_V1 = "cosmos.dq13.hostile-fixtures.v1"


@dataclass(frozen=True, slots=True)
class FixtureCaseV1:
    case_id: str
    frame: dict[str, object]
    expected_status: ValidationStatus
    expected_reasons: tuple[str, ...]
    digest_equals_case: str | None


def _dict(value: object, *, field: str) -> dict[str, object]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise ValueError(f"{field} must be a string-keyed object")
    return cast(dict[str, object], value)


def _list(value: object, *, field: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    return cast(list[object], value)


def _string(value: object, *, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value


def _strict_keys(
    value: dict[str, object],
    *,
    field: str,
    required: frozenset[str],
    optional: frozenset[str] = frozenset(),
) -> None:
    missing = required - set(value)
    extra = set(value) - required - optional
    if missing or extra:
        raise ValueError(f"{field} key mismatch: missing={sorted(missing)} extra={sorted(extra)}")


def _bounded_index(index: int, length: int) -> int:
    if not 0 <= index < length:
        raise ValueError(f"fixture index {index} is outside [0, {length})")
    return index


def _replace_path(root: object, path: list[object], value: object) -> None:
    if not path:
        raise ValueError("replace path cannot be empty")
    cursor = root
    for index, segment in enumerate(path[:-1]):
        if isinstance(segment, str):
            mapping = _dict(cursor, field=f"replace path segment {index}")
            if segment not in mapping:
                raise ValueError(f"replace path missing key {segment}")
            cursor = mapping[segment]
        elif isinstance(segment, int) and not isinstance(segment, bool):
            sequence = _list(cursor, field=f"replace path segment {index}")
            cursor = sequence[_bounded_index(segment, len(sequence))]
        else:
            raise ValueError("replace path segments must be strings or integers")
    leaf = path[-1]
    if isinstance(leaf, str):
        mapping = _dict(cursor, field="replace path leaf")
        if leaf not in mapping:
            raise ValueError(f"replace path missing leaf {leaf}")
        mapping[leaf] = copy.deepcopy(value)
    elif isinstance(leaf, int) and not isinstance(leaf, bool):
        sequence = _list(cursor, field="replace path leaf")
        sequence[_bounded_index(leaf, len(sequence))] = copy.deepcopy(value)
    else:
        raise ValueError("replace path leaf must be a string or integer")


def _apply_mutation(frame: dict[str, object], raw_mutation: object) -> None:
    mutation = _dict(raw_mutation, field="mutation")
    op = _string(mutation.get("op"), field="mutation.op")
    if "observations" not in frame:
        raise ValueError("frame must declare observations")
    observations = _list(frame["observations"], field="frame.observations")
    if op == "replace":
        _strict_keys(
            mutation,
            field="replace mutation",
            required=frozenset({"op", "path", "value"}),
        )
        _replace_path(
            frame,
            _list(mutation["path"], field="mutation.path"),
            mutation["value"],
        )
        return
    if op == "dropObservation":
        _strict_keys(
            mutation,
            field="dropObservation mutation",
            required=frozenset({"op", "recordId"}),
        )
        record_id = _string(mutation["recordId"], field="mutation.recordId")
        retained = [
            observation
            for observation in observations
            if _dict(observation, field="observation").get("recordId") != record_id
        ]
        if len(retained) != len(observations) - 1:
            raise ValueError("dropObservation must remove exactly one record")
        frame["observations"] = retained
        return
    if op == "duplicateObservation":
        _strict_keys(
            mutation,
            field="duplicateObservation mutation",
            required=frozenset({"op", "index", "recordId", "payloadDigest"}),
        )
        index = mutation["index"]
        if isinstance(index, bool) or not isinstance(index, int):
            raise ValueError("duplicateObservation.index must be an integer")
        duplicate = _dict(
            copy.deepcopy(observations[_bounded_index(index, len(observations))]),
            field="duplicated observation",
        )
        duplicate["recordId"] = _string(mutation["recordId"], field="mutation.recordId")
        duplicate["payloadDigest"] = _string(
            mutation["payloadDigest"],
            field="mutation.payloadDigest",
        )
        observations.append(duplicate)
        return
    if op == "reverseObservations":
        _strict_keys(
            mutation,
            field="reverseObservations mutation",
            required=frozenset({"op"}),
        )
        observations.reverse()
        return
    if op == "keepFeed":
        _strict_keys(
            mutation,
            field="keepFeed mutation",
            required=frozenset({"op", "requirementIndex", "observationIndex"}),
        )
        requirements = _list(frame.get("requirements"), field="frame.requirements")
        requirement_index = mutation["requirementIndex"]
        observation_index = mutation["observationIndex"]
        if (
            isinstance(requirement_index, bool)
            or not isinstance(requirement_index, int)
            or isinstance(observation_index, bool)
            or not isinstance(observation_index, int)
        ):
            raise ValueError("keepFeed indexes must be integers")
        frame["requirements"] = [
            copy.deepcopy(requirements[_bounded_index(requirement_index, len(requirements))])
        ]
        frame["observations"] = [
            copy.deepcopy(observations[_bounded_index(observation_index, len(observations))])
        ]
        return
    raise ValueError(f"unsupported fixture mutation {op}")


def load_fixture_cases_v1() -> tuple[FixtureCaseV1, ...]:
    path = Path(__file__).with_name("fixtures") / "cases.v1.json"
    raw: object = json.loads(path.read_text(encoding="utf-8"))
    document = _dict(raw, field="fixture document")
    _strict_keys(
        document,
        field="fixture document",
        required=frozenset({"schema", "baseFrame", "cases"}),
    )
    if document["schema"] != FIXTURE_SCHEMA_V1:
        raise ValueError("fixture schema mismatch")
    base = _dict(document["baseFrame"], field="baseFrame")
    result: list[FixtureCaseV1] = []
    seen: set[str] = set()
    for case_index, raw_case in enumerate(_list(document["cases"], field="cases")):
        case = _dict(raw_case, field=f"cases[{case_index}]")
        _strict_keys(
            case,
            field=f"cases[{case_index}]",
            required=frozenset({"caseId", "mutations", "expectedStatus", "expectedReasons"}),
            optional=frozenset({"digestEqualsCase"}),
        )
        case_id = _string(case["caseId"], field=f"cases[{case_index}].caseId")
        if case_id in seen:
            raise ValueError(f"duplicate fixture case {case_id}")
        seen.add(case_id)
        frame = _dict(copy.deepcopy(base), field=f"cases[{case_index}].frame")
        for mutation in _list(
            case["mutations"],
            field=f"cases[{case_index}].mutations",
        ):
            _apply_mutation(frame, mutation)
        reasons = tuple(
            _string(reason, field=f"cases[{case_index}].expectedReasons")
            for reason in _list(
                case["expectedReasons"],
                field=f"cases[{case_index}].expectedReasons",
            )
        )
        digest_equals_value = case.get("digestEqualsCase")
        result.append(
            FixtureCaseV1(
                case_id=case_id,
                frame=frame,
                expected_status=ValidationStatus(
                    _string(
                        case["expectedStatus"],
                        field=f"cases[{case_index}].expectedStatus",
                    )
                ),
                expected_reasons=reasons,
                digest_equals_case=(
                    None
                    if digest_equals_value is None
                    else _string(
                        digest_equals_value,
                        field=f"cases[{case_index}].digestEqualsCase",
                    )
                ),
            )
        )
    return tuple(result)


__all__ = ("FIXTURE_SCHEMA_V1", "FixtureCaseV1", "load_fixture_cases_v1")
