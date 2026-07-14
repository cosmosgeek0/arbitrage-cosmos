from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ZERO_RATIO, ExactRatioV1, make_ratio, ratio_add
from quant_edge.lake.contracts import require_contract_id

BASIS_ROUND_TRIP_LEGS: Final = 4


class CostKind(StrEnum):
    PER_LEG_FEE = "PER_LEG_FEE"
    ENTRY_SLIPPAGE = "ENTRY_SLIPPAGE"
    EXIT_SLIPPAGE = "EXIT_SLIPPAGE"
    FUNDING_CARRY = "FUNDING_CARRY"
    BORROW_CARRY = "BORROW_CARRY"
    RECOVERY = "RECOVERY"


class CostKnownness(StrEnum):
    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"


# Funding carry may lawfully be a credit; every other component is a non-negative cost.
_SIGNED_KINDS: Final = frozenset({CostKind.FUNDING_CARRY})


@dataclass(frozen=True, slots=True)
class CostComponentV1:
    """One cost component whose value exists exactly when it is KNOWN."""

    kind: CostKind
    knownness: CostKnownness
    value: ExactRatioV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.kind, CostKind):
            raise ContractValueError("kind must be CostKind")
        if not isinstance(self.knownness, CostKnownness):
            raise ContractValueError("knownness must be CostKnownness")
        if (self.value is not None) != (self.knownness is CostKnownness.KNOWN):
            raise ContractValueError("a cost value exists exactly when the component is KNOWN")
        if self.value is not None:
            if not isinstance(self.value, ExactRatioV1):
                raise ContractValueError("value must be ExactRatioV1 or None")
            if self.kind not in _SIGNED_KINDS and self.value.is_negative:
                raise ContractValueError(f"{self.kind.value} cannot be negative")

    def as_mapping(self) -> dict[str, object]:
        return {
            "kind": self.kind.value,
            "knownness": self.knownness.value,
            "value": None if self.value is None else self.value.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class CostStackV1:
    """The complete round-trip cost stack; every kind must be declared explicitly.

    A total exists only when every component is KNOWN; one UNKNOWN component makes
    the whole stack UNKNOWN, never zero.
    """

    stack_version: str
    components: tuple[CostComponentV1, ...]
    legs: int = BASIS_ROUND_TRIP_LEGS

    def __post_init__(self) -> None:
        require_contract_id(self.stack_version, field="stack_version")
        if not isinstance(self.components, tuple) or len(self.components) != len(CostKind):
            raise ContractValueError(
                "components must declare every cost kind exactly once; omission is not UNKNOWN"
            )
        if any(not isinstance(component, CostComponentV1) for component in self.components):
            raise ContractValueError("components must contain CostComponentV1")
        declared = [component.kind for component in self.components]
        if sorted(kind.value for kind in declared) != [kind.value for kind in declared]:
            raise ContractValueError("components must be sorted by kind")
        if len(set(declared)) != len(CostKind):
            raise ContractValueError("components must declare every cost kind exactly once")
        if self.legs != BASIS_ROUND_TRIP_LEGS:
            raise ContractValueError("basis round trips are four-leg constructions")

    def component(self, kind: CostKind) -> CostComponentV1:
        if not isinstance(kind, CostKind):
            raise ContractValueError("kind must be CostKind")
        # The stack law guarantees every kind exists exactly once.
        return next(candidate for candidate in self.components if candidate.kind is kind)

    @property
    def unknown_kinds(self) -> tuple[CostKind, ...]:
        return tuple(
            component.kind
            for component in self.components
            if component.knownness is CostKnownness.UNKNOWN
        )

    @property
    def total_knownness(self) -> CostKnownness:
        return CostKnownness.UNKNOWN if self.unknown_kinds else CostKnownness.KNOWN

    def total(self) -> ExactRatioV1 | None:
        """Total round-trip cost, or None when any component is UNKNOWN."""

        if self.unknown_kinds:
            return None
        total = ZERO_RATIO
        for component in self.components:
            # The component law guarantees every KNOWN component carries a value.
            value = cast(ExactRatioV1, component.value)
            if component.kind is CostKind.PER_LEG_FEE:
                value = make_ratio(value.numerator * self.legs, value.denominator)
            total = ratio_add(total, value)
        return total

    def as_mapping(self) -> dict[str, object]:
        return {
            "components": [component.as_mapping() for component in self.components],
            "legs": self.legs,
            "stackVersion": self.stack_version,
            "totalKnownness": self.total_knownness.value,
        }


def known_component(kind: CostKind, numerator: int, denominator: int) -> CostComponentV1:
    return CostComponentV1(
        kind=kind,
        knownness=CostKnownness.KNOWN,
        value=make_ratio(numerator, denominator),
    )


def unknown_component(kind: CostKind) -> CostComponentV1:
    return CostComponentV1(kind=kind, knownness=CostKnownness.UNKNOWN, value=None)
