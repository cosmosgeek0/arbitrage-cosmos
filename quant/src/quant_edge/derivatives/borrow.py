from __future__ import annotations

from dataclasses import dataclass

from quant_edge.errors import ContractValueError
from quant_edge.labels.basis import (
    BasisConstruction,
    BorrowAssumptionV1,
    BorrowKnownness,
    ConstructionFeasibility,
)
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    ExactScaledValueV1,
    require_strict_int,
)


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


@dataclass(frozen=True, slots=True)
class BorrowObservationV1:
    """Borrow truth observed at one time, extending the accepted Q05 assumption with
    inventory, interest timing and validity where — and only where — known.

    Every extension field requires KNOWN_AVAILABLE borrow; unknown borrow carries no
    inventory, no interest timing and no validity, and never becomes available.
    KNOWN_AVAILABLE borrow must declare an explicit validity horizon so availability
    can never silently outlive the observation.
    """

    observed_at_ns: int
    assumption: BorrowAssumptionV1
    inventory: ExactScaledValueV1 | None
    interest_interval_ns: int | None
    valid_until_ns: int | None

    def __post_init__(self) -> None:
        _require_ns(self.observed_at_ns, field="observed_at_ns")
        if not isinstance(self.assumption, BorrowAssumptionV1):
            raise ContractValueError("assumption must be BorrowAssumptionV1")
        extensions = (self.inventory, self.interest_interval_ns, self.valid_until_ns)
        if self.assumption.knownness is not BorrowKnownness.KNOWN_AVAILABLE and any(
            extension is not None for extension in extensions
        ):
            raise ContractValueError(
                "borrow extension facts require KNOWN_AVAILABLE borrow; unknown or "
                "unavailable borrow carries no inventory, timing or validity"
            )
        if (
            self.assumption.knownness is BorrowKnownness.KNOWN_AVAILABLE
            and self.valid_until_ns is None
        ):
            raise ContractValueError(
                "KNOWN_AVAILABLE borrow must carry an explicit validity horizon; "
                "availability truth never silently outlives its observation"
            )
        if self.inventory is not None:
            if not isinstance(self.inventory, ExactScaledValueV1):
                raise ContractValueError("inventory must be ExactScaledValueV1")
            if self.inventory.coefficient < 0:
                raise ContractValueError("inventory cannot be negative")
        if self.interest_interval_ns is not None:
            require_strict_int(
                self.interest_interval_ns,
                field="interest_interval_ns",
                minimum=1,
            )
        if self.valid_until_ns is not None:
            valid_until = _require_ns(self.valid_until_ns, field="valid_until_ns")
            if valid_until <= self.observed_at_ns:
                raise ContractValueError("borrow validity must extend beyond the observation")

    def as_mapping(self) -> dict[str, object]:
        return {
            "assumption": self.assumption.as_mapping(),
            "interestIntervalNs": (
                None if self.interest_interval_ns is None else str(self.interest_interval_ns)
            ),
            "inventory": (
                None
                if self.inventory is None
                else {
                    "coefficient": str(self.inventory.coefficient),
                    "scale": self.inventory.scale,
                    "unitId": self.inventory.unit_id,
                }
            ),
            "observedAtNs": str(self.observed_at_ns),
            "validUntilNs": (None if self.valid_until_ns is None else str(self.valid_until_ns)),
        }


def effective_borrow_knownness(observation: BorrowObservationV1, as_of_ns: int) -> BorrowKnownness:
    """Borrow knownness as of a later injected clock; expired validity degrades to
    UNKNOWN and a pre-observation as-of knows nothing yet."""

    if not isinstance(observation, BorrowObservationV1):
        raise ContractValueError("observation must be BorrowObservationV1")
    as_of = _require_ns(as_of_ns, field="as_of_ns")
    if as_of < observation.observed_at_ns:
        return BorrowKnownness.UNKNOWN
    if observation.valid_until_ns is not None and as_of > observation.valid_until_ns:
        return BorrowKnownness.UNKNOWN
    return observation.assumption.knownness


def borrow_hourly_rate(observation: BorrowObservationV1, as_of_ns: int) -> ExactRatioV1 | None:
    """The known hourly borrow rate, or None; unknown borrow never rates at zero."""

    if effective_borrow_knownness(observation, as_of_ns) is not BorrowKnownness.KNOWN_AVAILABLE:
        return None
    return observation.assumption.hourly_rate


def construction_feasibility(
    construction: BasisConstruction,
    knownness: BorrowKnownness,
) -> ConstructionFeasibility:
    """The accepted Q05 feasibility law: NORMAL needs no borrow; REVERSE is feasible
    only under KNOWN_AVAILABLE borrow and unknown borrow stays UNKNOWN."""

    if not isinstance(construction, BasisConstruction):
        raise ContractValueError("construction must be BasisConstruction")
    if not isinstance(knownness, BorrowKnownness):
        raise ContractValueError("knownness must be BorrowKnownness")
    if construction is BasisConstruction.NORMAL:
        return ConstructionFeasibility.FEASIBLE
    if knownness is BorrowKnownness.KNOWN_AVAILABLE:
        return ConstructionFeasibility.FEASIBLE
    if knownness is BorrowKnownness.KNOWN_UNAVAILABLE:
        return ConstructionFeasibility.INFEASIBLE
    return ConstructionFeasibility.UNKNOWN
