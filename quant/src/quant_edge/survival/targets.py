"""Versioned v1 vocabulary binding the §14.4 targets to competing causes.

These specs are machinery constants proving the survival layer end-to-end; no
spec claims a market frequency, a hazard shape or an economic value. Real
cohorts arrive from the label factory at integration time. Right censoring is
the no-event state (§11.4 right-censored non-convergence), never a cause.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import require_contract_id
from quant_edge.survival.contracts import CauseSetV1, SurvivalTarget

CAUSE_IGNITION: Final = "IGNITION"
CAUSE_CONTINUATION: Final = "CONTINUATION"
CAUSE_FADE: Final = "FADE"
CAUSE_UNWIND: Final = "UNWIND"
CAUSE_DISORDER: Final = "DISORDER"
CAUSE_CONVERGENCE: Final = "CONVERGENCE"
CAUSE_INVALIDATION: Final = "INVALIDATION"
CAUSE_WINDOW_CLOSED: Final = "WINDOW_CLOSED"

TARGET_SPEC_VERSION: Final = "q11.targets.v1"


@dataclass(frozen=True, slots=True)
class SurvivalTargetSpecV1:
    """One target's primary cause and the causes that compete with it."""

    spec_version: str
    target: SurvivalTarget
    primary_cause: str
    competing_causes: tuple[str, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.spec_version, field="spec_version")
        if not isinstance(self.target, SurvivalTarget):
            raise ContractValueError("target must be SurvivalTarget")
        require_contract_id(self.primary_cause, field="primary_cause")
        if not isinstance(self.competing_causes, tuple):
            raise ContractValueError("competing_causes must be a tuple")
        for index, cause_id in enumerate(self.competing_causes):
            require_contract_id(cause_id, field=f"competing_causes[{index}]")
        all_causes = (self.primary_cause, *self.competing_causes)
        if len(set(all_causes)) != len(all_causes):
            raise ContractValueError("causes must be distinct")

    def cause_set(self) -> CauseSetV1:
        return CauseSetV1(cause_ids=tuple(sorted((self.primary_cause, *self.competing_causes))))

    def primary_index(self) -> int:
        return self.cause_set().index_of(self.primary_cause)

    def as_mapping(self) -> dict[str, object]:
        return {
            "competingCauses": list(self.competing_causes),
            "primaryCause": self.primary_cause,
            "specVersion": self.spec_version,
            "target": self.target.value,
        }


def _spec(
    target: SurvivalTarget,
    primary_cause: str,
    competing_causes: tuple[str, ...],
) -> SurvivalTargetSpecV1:
    return SurvivalTargetSpecV1(
        spec_version=TARGET_SPEC_VERSION,
        target=target,
        primary_cause=primary_cause,
        competing_causes=competing_causes,
    )


V1_TARGET_SPECS: Final[tuple[SurvivalTargetSpecV1, ...]] = (
    _spec(SurvivalTarget.TIME_TO_IGNITION, CAUSE_IGNITION, (CAUSE_DISORDER,)),
    _spec(
        SurvivalTarget.TIME_TO_CONTINUATION,
        CAUSE_CONTINUATION,
        (CAUSE_FADE, CAUSE_DISORDER),
    ),
    _spec(SurvivalTarget.TIME_TO_FADE, CAUSE_FADE, (CAUSE_UNWIND, CAUSE_DISORDER)),
    _spec(
        SurvivalTarget.TIME_TO_CONVERGENCE,
        CAUSE_CONVERGENCE,
        (CAUSE_INVALIDATION, CAUSE_DISORDER),
    ),
    _spec(SurvivalTarget.TIME_TO_INVALIDATION, CAUSE_INVALIDATION, ()),
    _spec(SurvivalTarget.ACTIONABILITY_WINDOW, CAUSE_WINDOW_CLOSED, (CAUSE_INVALIDATION,)),
)


_SPEC_BY_TARGET: Final[dict[SurvivalTarget, SurvivalTargetSpecV1]] = {
    spec.target: spec for spec in V1_TARGET_SPECS
}


def v1_target_spec(target: SurvivalTarget) -> SurvivalTargetSpecV1:
    """Return the v1 spec for a declared target; every target has exactly one."""

    if not isinstance(target, SurvivalTarget):
        raise ContractValueError("target must be SurvivalTarget")
    return _SPEC_BY_TARGET[target]
