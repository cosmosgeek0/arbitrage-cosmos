import copy
import json
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import HypothesisRegistryError
from quant_edge.hypotheses import (
    HypothesisRegistry,
    render_hypothesis_map,
    verify_hypothesis_map,
)

QUANT_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = QUANT_ROOT / "registry" / "edge_hypotheses.v1.json"
MAP_PATH = QUANT_ROOT / "EDGE_HYPOTHESIS_MAP.md"


def _registry_object() -> dict[str, object]:
    return cast(dict[str, object], json.loads(REGISTRY_PATH.read_text(encoding="utf-8")))


def _families(value: dict[str, object]) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], value["families"])


def test_committed_registry_is_canonical_honest_and_matches_markdown() -> None:
    registry = HypothesisRegistry.from_canonical_bytes(REGISTRY_PATH.read_bytes())
    verify_hypothesis_map(MAP_PATH.read_text(encoding="utf-8"), registry)
    assert registry.revision == "edge-hypotheses-2026-07-12-v2"
    assert len(registry.families) == 8
    assert [family.family_id for family in registry.families[:6]] == [
        "H1_DORMANT_TO_ACTIVE_EARLY_TRANSITION",
        "H2_CONTINUATION_VERSUS_EXHAUSTION",
        "H3_EXECUTABLE_NORMAL_BASIS_CONVERGENCE",
        "H4_REVERSE_BASIS_FEASIBILITY",
        "H5_FALSE_BURST_MANIPULATION_RISK_FILTERING",
        "H6_CROSS_SOURCE_LEADERSHIP",
    ]
    assert {family.status for family in registry.families} == {
        "UNTESTED",
        "DATA_INSUFFICIENT",
        "RESEARCH",
    }
    assert registry.verification_summary() == {
        "familyCount": 8,
        "registryRevision": registry.revision,
        "schema": "HypothesisRegistryVerificationV1",
        "statusCounts": {"DATA_INSUFFICIENT": 5, "RESEARCH": 2, "UNTESTED": 1},
        "version": 1,
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema", "EdgeHypothesisRegistryV2"),
        ("version", 2),
        ("truthPosture", "LIVE"),
        ("allowedStatuses", ["UNTESTED"]),
        ("revision", "not valid"),
        ("asOfMs", 1),
        ("families", []),
        ("families", "not-an-array"),
    ],
)
def test_registry_rejects_invalid_top_level_contract(field: str, value: object) -> None:
    mutation = _registry_object()
    mutation[field] = value
    with pytest.raises(HypothesisRegistryError):
        HypothesisRegistry.from_canonical_bytes(canonical_json_bytes(mutation))


def test_registry_rejects_missing_or_extra_top_level_keys() -> None:
    missing = _registry_object()
    del missing["revision"]
    extra = {**_registry_object(), "extra": None}
    for mutation in (missing, extra):
        with pytest.raises(HypothesisRegistryError):
            HypothesisRegistry.from_canonical_bytes(canonical_json_bytes(mutation))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", "not valid"),
        ("id", "X1_WRONG_PREFIX"),
        ("status", "PROVEN"),
        ("hypothesis", ""),
        ("hypothesis", "x" * 2_049),
        ("hypothesis", "two\nlines"),
        ("hypothesis", " trailing "),
        ("requiredSources", []),
        ("requiredSources", "not-an-array"),
        ("requiredSources", ["duplicate", "duplicate"]),
    ],
)
def test_registry_rejects_invalid_family_contract(field: str, value: object) -> None:
    mutation = _registry_object()
    _families(mutation)[0][field] = value
    with pytest.raises(HypothesisRegistryError):
        HypothesisRegistry.from_canonical_bytes(canonical_json_bytes(mutation))


def test_registry_rejects_non_objects_and_family_key_drift() -> None:
    non_object = _registry_object()
    cast(list[object], non_object["families"])[0] = "not-an-object"
    missing = _registry_object()
    del _families(missing)[0]["primaryMetric"]
    extra = _registry_object()
    _families(extra)[0]["probabilityOfEdge"] = 1
    for mutation in (non_object, missing, extra):
        with pytest.raises(HypothesisRegistryError):
            HypothesisRegistry.from_canonical_bytes(canonical_json_bytes(mutation))


def test_registry_rejects_unsorted_or_duplicate_families() -> None:
    unsorted = _registry_object()
    _families(unsorted)[0], _families(unsorted)[1] = (
        _families(unsorted)[1],
        _families(unsorted)[0],
    )
    duplicate = _registry_object()
    _families(duplicate)[1]["id"] = _families(duplicate)[0]["id"]
    oversized = _registry_object()
    seed_family = copy.deepcopy(_families(oversized)[0])
    oversized["families"] = [
        {**seed_family, "id": f"H9_OVERSIZED_{index:03d}"} for index in range(65)
    ]
    for mutation in (unsorted, duplicate, oversized):
        with pytest.raises(HypothesisRegistryError):
            HypothesisRegistry.from_canonical_bytes(canonical_json_bytes(mutation))


def test_registry_rejects_noncanonical_bytes() -> None:
    with pytest.raises(HypothesisRegistryError):
        HypothesisRegistry.from_canonical_bytes(REGISTRY_PATH.read_bytes().rstrip())


def test_markdown_is_exact_projection_and_rejects_any_substantive_drift() -> None:
    registry = HypothesisRegistry.from_canonical_bytes(REGISTRY_PATH.read_bytes())
    markdown = MAP_PATH.read_text(encoding="utf-8")
    assert markdown == render_hypothesis_map(registry)
    first = registry.families[0]
    mutations = [
        markdown.replace(registry.revision, "other-revision", 1),
        markdown.replace(
            f"**Hypothesis:** {first.hypothesis}",
            "**Hypothesis:** contradictory manual claim",
            1,
        ),
        markdown.replace(
            f"### `{first.family_id}` — `{first.status}`",
            f"### `{first.family_id}` — `SHADOW`",
            1,
        ),
        markdown + "Manual unregistered appendix.\n",
    ]
    for mutation in mutations:
        with pytest.raises(HypothesisRegistryError):
            verify_hypothesis_map(mutation, registry)
