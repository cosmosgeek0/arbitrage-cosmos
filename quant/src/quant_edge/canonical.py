import json
from collections.abc import Iterable
from typing import cast

from quant_edge.errors import CanonicalJsonError


def _object_without_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise CanonicalJsonError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _validate_json_value(value: object, *, path: str = "$") -> None:
    if value is None or isinstance(value, (bool, int)):
        return
    if isinstance(value, str):
        try:
            value.encode("utf-8", errors="strict")
        except UnicodeEncodeError as error:
            raise CanonicalJsonError(f"{path}: JSON text must encode as strict UTF-8") from error
        return
    if isinstance(value, float):
        raise CanonicalJsonError(f"{path}: floating JSON numbers are forbidden")
    if isinstance(value, list):
        for index, item in enumerate(value):
            _validate_json_value(item, path=f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise CanonicalJsonError(f"{path}: JSON object keys must be strings")
            _validate_json_value(key, path=f"{path}.<key>")
            _validate_json_value(item, path=f"{path}.{key}")
        return
    raise CanonicalJsonError(f"{path}: unsupported JSON value {type(value).__name__}")


def canonical_json_bytes(value: object) -> bytes:
    _validate_json_value(value)
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return f"{encoded}\n".encode()


def parse_canonical_object(raw: bytes) -> dict[str, object]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CanonicalJsonError("JSON must be valid UTF-8") from error
    try:
        parsed = cast(
            object,
            json.loads(text, object_pairs_hook=_object_without_duplicates),
        )
    except json.JSONDecodeError as error:
        raise CanonicalJsonError(
            f"invalid JSON at line {error.lineno} column {error.colno}"
        ) from error
    except RecursionError as error:
        raise CanonicalJsonError("JSON nesting exceeds the deterministic limit") from error
    try:
        _validate_json_value(parsed)
    except RecursionError as error:
        raise CanonicalJsonError("JSON nesting exceeds the deterministic limit") from error
    if not isinstance(parsed, dict):
        raise CanonicalJsonError("top-level JSON value must be an object")
    if canonical_json_bytes(parsed) != raw:
        raise CanonicalJsonError("JSON bytes are not canonical")
    return parsed


def require_exact_keys(value: dict[str, object], *, expected: Iterable[str], path: str) -> None:
    expected_set = set(expected)
    actual_set = set(value)
    missing = sorted(expected_set - actual_set)
    extra = sorted(actual_set - expected_set)
    if missing or extra:
        raise CanonicalJsonError(f"{path}: key mismatch; missing={missing}, extra={extra}")
