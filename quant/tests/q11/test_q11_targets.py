from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.survival.contracts import SurvivalTarget
from quant_edge.survival.targets import (
    CAUSE_CONVERGENCE,
    CAUSE_DISORDER,
    CAUSE_IGNITION,
    CAUSE_INVALIDATION,
    CAUSE_WINDOW_CLOSED,
    TARGET_SPEC_VERSION,
    V1_TARGET_SPECS,
    SurvivalTargetSpecV1,
    v1_target_spec,
)


def test_every_declared_target_has_exactly_one_v1_spec() -> None:
    covered = [spec.target for spec in V1_TARGET_SPECS]
    assert covered == list(SurvivalTarget)
    for target in SurvivalTarget:
        spec = v1_target_spec(target)
        assert spec.target is target
        assert spec.spec_version == TARGET_SPEC_VERSION


def test_hand_verified_vocabulary() -> None:
    ignition = v1_target_spec(SurvivalTarget.TIME_TO_IGNITION)
    assert ignition.primary_cause == CAUSE_IGNITION
    assert ignition.competing_causes == (CAUSE_DISORDER,)
    convergence = v1_target_spec(SurvivalTarget.TIME_TO_CONVERGENCE)
    assert convergence.primary_cause == CAUSE_CONVERGENCE
    assert CAUSE_INVALIDATION in convergence.competing_causes
    invalidation = v1_target_spec(SurvivalTarget.TIME_TO_INVALIDATION)
    assert invalidation.competing_causes == ()
    actionability = v1_target_spec(SurvivalTarget.ACTIONABILITY_WINDOW)
    assert actionability.primary_cause == CAUSE_WINDOW_CLOSED


def test_cause_set_is_sorted_and_primary_index_resolves() -> None:
    for spec in V1_TARGET_SPECS:
        cause_set = spec.cause_set()
        assert list(cause_set.cause_ids) == sorted(cause_set.cause_ids)
        assert cause_set.cause_ids[spec.primary_index()] == spec.primary_cause


def test_spec_contract() -> None:
    with pytest.raises(ContractValueError, match="distinct"):
        SurvivalTargetSpecV1(
            spec_version="v",
            target=SurvivalTarget.TIME_TO_IGNITION,
            primary_cause="A",
            competing_causes=("A",),
        )
    with pytest.raises(ContractValueError, match="target"):
        SurvivalTargetSpecV1(
            spec_version="v",
            target="TIME_TO_IGNITION",  # type: ignore[arg-type]
            primary_cause="A",
            competing_causes=(),
        )
    with pytest.raises(ContractValueError, match="tuple"):
        SurvivalTargetSpecV1(
            spec_version="v",
            target=SurvivalTarget.TIME_TO_IGNITION,
            primary_cause="A",
            competing_causes=["B"],  # type: ignore[arg-type]
        )
    with pytest.raises(ContractValueError, match="competing_causes\\[0\\]"):
        SurvivalTargetSpecV1(
            spec_version="v",
            target=SurvivalTarget.TIME_TO_IGNITION,
            primary_cause="A",
            competing_causes=("bad id",),
        )
    with pytest.raises(ContractValueError, match="SurvivalTarget"):
        v1_target_spec("TIME_TO_IGNITION")  # type: ignore[arg-type]


def test_as_mapping() -> None:
    mapping = v1_target_spec(SurvivalTarget.TIME_TO_FADE).as_mapping()
    assert mapping["target"] == "TIME_TO_FADE"
    assert mapping["specVersion"] == TARGET_SPEC_VERSION
    assert isinstance(mapping["competingCauses"], list)
