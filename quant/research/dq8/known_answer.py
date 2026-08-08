from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import cast

from research.dq8.validator import JsonObject, validate_payload_v1

FIXTURE_DIR = Path(__file__).with_name("fixtures")
VALID_PAYLOAD_PATH = FIXTURE_DIR / "valid_path.v1.json"
HOSTILE_MANIFEST_PATH = FIXTURE_DIR / "hostile_manifest.v1.json"
KNOWN_RECEIPT_PATH = FIXTURE_DIR / "known_receipt.v1.json"
SYNTHETIC_SOURCE_PATH = FIXTURE_DIR / "synthetic_prices.v1.csv"

PathSegment = str | int


def _load_json_object(path: Path) -> JsonObject:
    raw: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not all(isinstance(key, str) for key in raw):
        raise RuntimeError(f"{path.name} must contain one JSON object")
    return cast(JsonObject, raw)


def load_valid_payload_v1() -> JsonObject:
    return _load_json_object(VALID_PAYLOAD_PATH)


def load_known_receipt_v1() -> JsonObject:
    return _load_json_object(KNOWN_RECEIPT_PATH)


def hostile_cases_v1() -> tuple[JsonObject, ...]:
    manifest = _load_json_object(HOSTILE_MANIFEST_PATH)
    if manifest.get("schema") != "cosmos.dq8.hostile-fixtures.v1":
        raise RuntimeError("hostile fixture manifest schema mismatch")
    if manifest.get("basePayload") != VALID_PAYLOAD_PATH.name:
        raise RuntimeError("hostile fixture manifest base mismatch")
    raw_cases = manifest.get("cases")
    if not isinstance(raw_cases, list):
        raise RuntimeError("hostile fixture cases must be an array")
    cases: list[JsonObject] = []
    for raw_case in raw_cases:
        if not isinstance(raw_case, dict) or not all(isinstance(key, str) for key in raw_case):
            raise RuntimeError("each hostile fixture must be an object")
        cases.append(cast(JsonObject, raw_case))
    return tuple(cases)


def hostile_case_id_v1(case: JsonObject) -> str:
    value = case.get("caseId")
    if not isinstance(value, str) or not value:
        raise RuntimeError("hostile fixture caseId must be nonempty")
    return value


def hostile_expected_code_v1(case: JsonObject) -> str:
    value = case.get("expectedCode")
    if not isinstance(value, str) or not value:
        raise RuntimeError("hostile fixture expectedCode must be nonempty")
    return value


def _path_segments(value: object) -> tuple[PathSegment, ...]:
    if not isinstance(value, list) or not value:
        raise RuntimeError("fixture mutation path must be a nonempty array")
    result: list[PathSegment] = []
    for segment in value:
        if isinstance(segment, bool) or not isinstance(segment, (str, int)):
            raise RuntimeError("fixture mutation path segments must be strings or integers")
        result.append(segment)
    return tuple(result)


def _resolve(root: object, path: tuple[PathSegment, ...]) -> object:
    current = root
    for segment in path:
        if isinstance(segment, int):
            if not isinstance(current, list) or not 0 <= segment < len(current):
                raise RuntimeError("fixture mutation list path is invalid")
            current = current[segment]
        else:
            if not isinstance(current, dict) or segment not in current:
                raise RuntimeError("fixture mutation object path is invalid")
            current = current[segment]
    return current


def _replace_or_remove(
    root: JsonObject,
    *,
    path: tuple[PathSegment, ...],
    replacement: object,
    remove: bool,
) -> None:
    parent = _resolve(root, path[:-1])
    final = path[-1]
    if isinstance(final, int):
        if not isinstance(parent, list) or not 0 <= final < len(parent):
            raise RuntimeError("fixture mutation final list path is invalid")
        if remove:
            parent.pop(final)
        else:
            parent[final] = deepcopy(replacement)
        return
    if not isinstance(parent, dict) or final not in parent:
        raise RuntimeError("fixture mutation final object path is invalid")
    if remove:
        del parent[final]
    else:
        parent[final] = deepcopy(replacement)


def apply_hostile_case_v1(payload: JsonObject, case: JsonObject) -> JsonObject:
    mutated = deepcopy(payload)
    raw_operations = case.get("operations")
    if not isinstance(raw_operations, list) or not raw_operations:
        raise RuntimeError("hostile fixture operations must be a nonempty array")
    for raw_operation in raw_operations:
        if not isinstance(raw_operation, dict):
            raise RuntimeError("hostile fixture operation must be an object")
        operation = cast(dict[str, object], raw_operation)
        op = operation.get("op")
        path = _path_segments(operation.get("path"))
        if op == "append":
            target = _resolve(mutated, path)
            if not isinstance(target, list) or "value" not in operation:
                raise RuntimeError("append operation must target an array and include value")
            target.append(deepcopy(operation["value"]))
        elif op == "replace":
            if "value" not in operation:
                raise RuntimeError("replace operation must include value")
            _replace_or_remove(
                mutated,
                path=path,
                replacement=operation["value"],
                remove=False,
            )
        elif op == "remove":
            _replace_or_remove(mutated, path=path, replacement=None, remove=True)
        else:
            raise RuntimeError("hostile fixture operation is unsupported")
    return mutated


def verify_synthetic_source_digest_v1(payload: JsonObject) -> str:
    digest = hashlib.sha256(SYNTHETIC_SOURCE_PATH.read_bytes()).hexdigest()
    raw_prices = payload.get("prices")
    if not isinstance(raw_prices, list) or not raw_prices:
        raise RuntimeError("valid fixture prices must be a nonempty array")
    for raw_price in raw_prices:
        if not isinstance(raw_price, dict):
            raise RuntimeError("valid fixture price must be an object")
        if raw_price.get("sourceArtifactSha256") != digest:
            raise RuntimeError("valid fixture source digest is stale")
    return digest


def known_answer_projection_v1() -> JsonObject:
    payload = load_valid_payload_v1()
    verify_synthetic_source_digest_v1(payload)
    return validate_payload_v1(payload).as_dict()
