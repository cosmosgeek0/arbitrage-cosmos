from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from quant_edge.derivatives.basis_path import BasisPathV1, BasisPointV1
from quant_edge.errors import ContractValueError
from quant_edge.labels.basis import BasisConstruction
from quant_edge.labels.outcomes import OutcomeStatus
from quant_edge.labels.rational import ExactRatioV1, make_ratio, ratio_compare
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    require_contract_id,
    require_strict_int,
)


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


def _require_fraction(value: object, *, field: str) -> ExactRatioV1:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    if value.is_negative or ratio_compare(value, make_ratio(1, 1)) >= 0:
        raise ContractValueError(f"{field} must lie in [0, 1)")
    return value


def _abs_ratio(value: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(abs(value.numerator), value.denominator)


@dataclass(frozen=True, slots=True)
class ConvergenceEstimateV1:
    """A convergence half-life estimate with an explicit uncertainty bracket.

    The crossing happens between two discrete observations, so the half-life is a
    bracket ``(lower_ns, upper_ns]``, never a false point estimate. Non-convergence
    is right-censored at the last observable time and a gap over the interval is
    DATA_INVALID — unknown never converges to zero.
    """

    construction: BasisConstruction
    definition_version: str
    threshold_fraction: ExactRatioV1
    status: OutcomeStatus
    entry_time_ns: int
    entry_basis: ExactRatioV1 | None
    half_life_lower_ns: int | None
    half_life_upper_ns: int | None
    censored_duration_ns: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.construction, BasisConstruction):
            raise ContractValueError("construction must be BasisConstruction")
        require_contract_id(self.definition_version, field="definition_version")
        _require_fraction(self.threshold_fraction, field="threshold_fraction")
        if not isinstance(self.status, OutcomeStatus):
            raise ContractValueError("status must be OutcomeStatus")
        _require_ns(self.entry_time_ns, field="entry_time_ns")
        observed = self.status is OutcomeStatus.AVAILABLE
        censored = self.status is OutcomeStatus.CENSORED
        if (self.entry_basis is not None) != (observed or censored):
            raise ContractValueError("entry basis exists exactly when an outcome exists")
        if self.entry_basis is not None and not isinstance(self.entry_basis, ExactRatioV1):
            raise ContractValueError("entry_basis must be ExactRatioV1 or None")
        if observed:
            if self.half_life_upper_ns is None or self.half_life_lower_ns is None:
                raise ContractValueError("an observed convergence carries its bracket")
            lower = require_strict_int(
                self.half_life_lower_ns, field="half_life_lower_ns", minimum=0
            )
            upper = require_strict_int(
                self.half_life_upper_ns, field="half_life_upper_ns", minimum=1
            )
            if lower >= upper:
                raise ContractValueError("the bracket must satisfy lower < upper")
            if self.censored_duration_ns is not None:
                raise ContractValueError("an observed convergence is not censored")
        else:
            if self.half_life_lower_ns is not None or self.half_life_upper_ns is not None:
                raise ContractValueError("only observed convergences carry brackets")
            if censored:
                if self.censored_duration_ns is None:
                    raise ContractValueError("a censored outcome carries its duration")
                require_strict_int(
                    self.censored_duration_ns,
                    field="censored_duration_ns",
                    minimum=1,
                )
            elif self.censored_duration_ns is not None:
                raise ContractValueError("only censored outcomes carry censored durations")

    def as_mapping(self) -> dict[str, object]:
        return {
            "censoredDurationNs": (
                None if self.censored_duration_ns is None else str(self.censored_duration_ns)
            ),
            "construction": self.construction.value,
            "definitionVersion": self.definition_version,
            "entryBasis": None if self.entry_basis is None else self.entry_basis.as_mapping(),
            "entryTimeNs": str(self.entry_time_ns),
            "halfLifeLowerNs": (
                None if self.half_life_lower_ns is None else str(self.half_life_lower_ns)
            ),
            "halfLifeUpperNs": (
                None if self.half_life_upper_ns is None else str(self.half_life_upper_ns)
            ),
            "status": self.status.value,
            "thresholdFraction": self.threshold_fraction.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class ConvergenceTargetV1:
    """One censored duration target for the survival phases; construction-distinct."""

    construction: BasisConstruction
    definition_version: str
    entry_time_ns: int
    duration_ns: int
    observed: bool

    def __post_init__(self) -> None:
        if not isinstance(self.construction, BasisConstruction):
            raise ContractValueError("construction must be BasisConstruction")
        require_contract_id(self.definition_version, field="definition_version")
        _require_ns(self.entry_time_ns, field="entry_time_ns")
        require_strict_int(self.duration_ns, field="duration_ns", minimum=1)
        if not isinstance(self.observed, bool):
            raise ContractValueError("observed must be boolean")

    def as_mapping(self) -> dict[str, object]:
        return {
            "construction": self.construction.value,
            "definitionVersion": self.definition_version,
            "durationNs": str(self.duration_ns),
            "entryTimeNs": str(self.entry_time_ns),
            "observed": self.observed,
        }


def estimate_convergence(
    *,
    path: BasisPathV1,
    construction: BasisConstruction,
    definition_version: str,
    entry_ordinal: int,
    horizon_end_ns: int,
    threshold_fraction: ExactRatioV1,
) -> ConvergenceEstimateV1:
    """Half-life of the absolute basis from the entry observation to the versioned
    threshold, bracketed between discrete observations and censored honestly."""

    if not isinstance(path, BasisPathV1):
        raise ContractValueError("path must be BasisPathV1")
    if not isinstance(construction, BasisConstruction):
        raise ContractValueError("construction must be BasisConstruction")
    require_contract_id(definition_version, field="definition_version")
    require_strict_int(entry_ordinal, field="entry_ordinal", minimum=0)
    horizon = _require_ns(horizon_end_ns, field="horizon_end_ns")
    fraction = _require_fraction(threshold_fraction, field="threshold_fraction")

    entry: BasisPointV1 | None = None
    entry_index: int | None = None
    for index, point in enumerate(path.points):
        if point.ordinal == entry_ordinal:
            entry = point
            entry_index = index
            break
    if entry is None or entry_index is None:
        raise ContractValueError("entry_ordinal must identify a path point")
    if horizon <= entry.event_time_ns:
        raise ContractValueError("the horizon must follow the entry observation")

    entry_gross = _abs_ratio(entry.basis)
    if entry_gross.is_zero:
        # A zero entry gap has no convergence question to answer.
        return _no_outcome(
            construction,
            definition_version,
            fraction,
            OutcomeStatus.UNAVAILABLE,
            entry.event_time_ns,
        )

    observable_end = min(horizon, path.completeness_end_ns)
    if observable_end <= entry.event_time_ns:
        # No observable window follows the entry; there is nothing to censor over.
        return _no_outcome(
            construction,
            definition_version,
            fraction,
            OutcomeStatus.UNAVAILABLE,
            entry.event_time_ns,
        )
    if path.gap_intersecting(entry.event_time_ns, observable_end):
        return _no_outcome(
            construction,
            definition_version,
            fraction,
            OutcomeStatus.DATA_INVALID,
            entry.event_time_ns,
        )

    threshold = make_ratio(
        entry_gross.numerator * fraction.numerator,
        entry_gross.denominator * fraction.denominator,
    )
    previous_time = entry.event_time_ns
    for point in path.points[entry_index + 1 :]:
        if point.event_time_ns > observable_end:
            break
        if ratio_compare(_abs_ratio(point.basis), threshold) <= 0:
            return ConvergenceEstimateV1(
                construction=construction,
                definition_version=definition_version,
                threshold_fraction=fraction,
                status=OutcomeStatus.AVAILABLE,
                entry_time_ns=entry.event_time_ns,
                entry_basis=entry.basis,
                half_life_lower_ns=previous_time - entry.event_time_ns,
                half_life_upper_ns=point.event_time_ns - entry.event_time_ns,
                censored_duration_ns=None,
            )
        previous_time = point.event_time_ns
    return ConvergenceEstimateV1(
        construction=construction,
        definition_version=definition_version,
        threshold_fraction=fraction,
        status=OutcomeStatus.CENSORED,
        entry_time_ns=entry.event_time_ns,
        entry_basis=entry.basis,
        half_life_lower_ns=None,
        half_life_upper_ns=None,
        censored_duration_ns=observable_end - entry.event_time_ns,
    )


def _no_outcome(
    construction: BasisConstruction,
    definition_version: str,
    fraction: ExactRatioV1,
    status: OutcomeStatus,
    entry_time_ns: int,
) -> ConvergenceEstimateV1:
    return ConvergenceEstimateV1(
        construction=construction,
        definition_version=definition_version,
        threshold_fraction=fraction,
        status=status,
        entry_time_ns=entry_time_ns,
        entry_basis=None,
        half_life_lower_ns=None,
        half_life_upper_ns=None,
        censored_duration_ns=None,
    )


def convergence_target(estimate: ConvergenceEstimateV1) -> ConvergenceTargetV1 | None:
    """Project an estimate into a survival target; no-outcome estimates project to
    nothing rather than to a fabricated duration."""

    if not isinstance(estimate, ConvergenceEstimateV1):
        raise ContractValueError("estimate must be ConvergenceEstimateV1")
    if estimate.status is OutcomeStatus.AVAILABLE:
        # The estimate law guarantees the upper bracket exists here.
        upper = cast(int, estimate.half_life_upper_ns)
        return ConvergenceTargetV1(
            construction=estimate.construction,
            definition_version=estimate.definition_version,
            entry_time_ns=estimate.entry_time_ns,
            duration_ns=upper,
            observed=True,
        )
    if estimate.status is OutcomeStatus.CENSORED:
        # The estimate law guarantees the censored duration exists here.
        duration = cast(int, estimate.censored_duration_ns)
        return ConvergenceTargetV1(
            construction=estimate.construction,
            definition_version=estimate.definition_version,
            entry_time_ns=estimate.entry_time_ns,
            duration_ns=duration,
            observed=False,
        )
    return None
