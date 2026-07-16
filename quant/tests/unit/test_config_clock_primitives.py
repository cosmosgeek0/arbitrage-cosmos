from dataclasses import FrozenInstanceError

import pytest

from quant_edge.canonical import parse_canonical_object
from quant_edge.clock import Clock, FixedClock
from quant_edge.config import ResearchConfig, make_research_config
from quant_edge.errors import ContractValueError
from quant_edge.primitives import UINT128_MAX, require_id, require_seed, require_utc_millis

AS_OF_MS = 1_783_814_400_000


def test_fixed_clock_and_config_round_trip_are_explicit_and_immutable() -> None:
    clock: Clock = FixedClock(AS_OF_MS)
    config = make_research_config(
        clock=clock,
        run_id="q01.fixture",
        seed=20_260_712,
        truth_posture="SYNTHETIC",
    )
    expected = {
        "asOfMs": AS_OF_MS,
        "datasetRevision": None,
        "runId": "q01.fixture",
        "schema": "QuantResearchConfigV1",
        "seed": "20260712",
        "truthPosture": "SYNTHETIC",
        "version": 1,
    }
    assert config.as_mapping() == expected
    assert ResearchConfig.from_mapping(parse_canonical_object(config.canonical_bytes())) == config
    with pytest.raises(FrozenInstanceError):
        config.seed = 1  # type: ignore[misc]


def test_config_preserves_explicit_dataset_revision() -> None:
    config = ResearchConfig(
        run_id="q01.research",
        as_of_ms=AS_OF_MS,
        seed=0,
        truth_posture="RESEARCH",
        dataset_revision="dataset.none-yet",
    )
    assert config.as_mapping()["datasetRevision"] == "dataset.none-yet"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("run_id", ""),
        ("run_id", "contains space"),
        ("as_of_ms", True),
        ("as_of_ms", 1),
        ("seed", True),
        ("seed", -1),
        ("seed", UINT128_MAX + 1),
        ("truth_posture", "LIVE"),
        ("dataset_revision", "contains space"),
    ],
)
def test_config_rejects_invalid_contract_values(field: str, value: object) -> None:
    values: dict[str, object] = {
        "run_id": "q01.fixture",
        "as_of_ms": AS_OF_MS,
        "seed": 1,
        "truth_posture": "RESEARCH",
        "dataset_revision": None,
    }
    values[field] = value
    with pytest.raises(ContractValueError):
        ResearchConfig(**values)  # type: ignore[arg-type]


def test_config_mapping_rejects_unknown_schema_and_ambiguous_values() -> None:
    valid = ResearchConfig(
        run_id="q01.fixture",
        as_of_ms=AS_OF_MS,
        seed=1,
        truth_posture="RESEARCH",
    ).as_mapping()
    mutations = [
        {**valid, "extra": "field"},
        {key: value for key, value in valid.items() if key != "runId"},
        {**valid, "schema": "QuantResearchConfigV2"},
        {**valid, "version": 2},
        {**valid, "seed": 1},
        {**valid, "seed": "-1"},
        {**valid, "seed": "\uff11\uff12"},
        {**valid, "seed": "9" * 10_000},
        {**valid, "datasetRevision": 2},
        {**valid, "truthPosture": "LIVE"},
        {**valid, "runId": 2},
    ]
    for mutation in mutations:
        with pytest.raises(ContractValueError):
            ResearchConfig.from_mapping(mutation)


@pytest.mark.parametrize("value", [True, 0, 4_102_444_800_001])
def test_utc_primitive_rejects_non_protocol_values(value: object) -> None:
    with pytest.raises(ContractValueError):
        require_utc_millis(value, field="test")


def test_primitives_accept_frozen_boundaries() -> None:
    assert require_utc_millis(1_262_304_000_000, field="test") == 1_262_304_000_000
    assert require_seed(UINT128_MAX) == UINT128_MAX
    assert require_id("A.b:c-1", field="test") == "A.b:c-1"
    with pytest.raises(ContractValueError):
        FixedClock(1)
