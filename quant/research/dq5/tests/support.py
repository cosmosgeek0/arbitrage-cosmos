from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object

DQ5_ROOT = Path(__file__).resolve().parents[1]


def fixture_bytes(category: str, name: str) -> bytes:
    return (DQ5_ROOT / "fixtures" / category / name).read_bytes()


def fixture_object(category: str, name: str) -> dict[str, object]:
    return parse_canonical_object(fixture_bytes(category, name))


def require_object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def require_array(value: object) -> list[object]:
    assert isinstance(value, list)
    return cast(list[object], value)


def require_int(value: object) -> int:
    assert isinstance(value, int)
    assert not isinstance(value, bool)
    return value


def require_bool(value: object) -> bool:
    assert isinstance(value, bool)
    return value


def require_string(value: object) -> str:
    assert isinstance(value, str)
    return value


def _window_content_key(value: object) -> tuple[object, ...]:
    window = require_object(value)
    corpus = require_object(window["corpus"])
    holdout_id = window["holdoutId"]
    return (
        require_string(corpus["providerId"]),
        require_string(corpus["venueId"]),
        require_string(corpus["productId"]),
        require_string(corpus["instrumentId"]),
        require_int(window["startMs"]),
        require_int(window["endMs"]),
        require_string(window["role"]),
        require_string(holdout_id) if holdout_id is not None else "",
        require_string(window["windowId"]),
        require_string(window["artifactSha256"]),
    )


def _registration_sort_key(value: object) -> tuple[object, ...]:
    registration = require_object(value)
    return (
        require_string(registration["researchId"]),
        require_string(registration["familyId"]),
        require_string(registration["protocolSha256"]),
        require_bool(registration["freshHoldoutClaim"]),
        tuple(_window_content_key(item) for item in require_array(registration["windows"])),
    )


def sealed_intake(
    registry: dict[str, object],
    candidate: dict[str, object],
) -> tuple[bytes, bytes]:
    """Return canonical registry and candidate bytes after custody pre-persistence."""
    pending = require_array(registry["pendingRegistrations"])
    pending.append(deepcopy(require_object(candidate["registration"])))
    pending.sort(key=_registration_sort_key)
    return canonical_json_bytes(registry), canonical_json_bytes(candidate)


def sealed_fixture_intake(
    registry_category: str,
    registry_name: str,
    candidate_category: str,
    candidate_name: str,
) -> tuple[bytes, bytes]:
    return sealed_intake(
        fixture_object(registry_category, registry_name),
        fixture_object(candidate_category, candidate_name),
    )
