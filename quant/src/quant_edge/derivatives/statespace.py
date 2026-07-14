from __future__ import annotations

import itertools
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.derivatives.basis_path import BasisPathV1, basis_fixed_point
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import (
    FP_ZERO,
    FixedPointV1,
    fp_add,
    fp_from_ratio,
    fp_mul,
    fp_sub,
)
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    require_contract_id,
    require_strict_int,
)

MAX_FILTER_POINTS: Final = 100_000
MAX_HALF_LIFE_STEPS: Final = 64
MIN_AR1_OBSERVATIONS: Final = 8

# The lane owns no validated model; every state-space output is a reference
# challenger under this exact label until the validation phases prove otherwise.
CHALLENGER_STATUS: Final = "REFERENCE_ONLY"


class MeanReversionStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    NON_MEAN_REVERTING = "NON_MEAN_REVERTING"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class FilterStepV1:
    """One fixed-gain filter step: the latent estimate and its innovation."""

    event_time_ns: int
    estimate: FixedPointV1
    innovation: FixedPointV1

    def __post_init__(self) -> None:
        require_strict_int(
            self.event_time_ns,
            field="event_time_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        for name in ("estimate", "innovation"):
            if not isinstance(getattr(self, name), FixedPointV1):
                raise ContractValueError(f"{name} must be FixedPointV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "estimate": self.estimate.as_mapping(),
            "eventTimeNs": str(self.event_time_ns),
            "innovation": self.innovation.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class FixedGainFilterV1:
    """A deterministic fixed-gain scalar filter over the basis path.

    ``estimate_k = estimate_{k-1} + gain * (observed_k - estimate_{k-1})`` computed
    in fixed point with the accepted half-even rounding law per step, matching the
    frozen Q06 EWMA recurrence style so state stays bounded on any path length.
    This is a REFERENCE_ONLY latent fair-value challenger, not a validated model,
    and its gain is a versioned assumption rather than an estimated parameter.
    """

    filter_version: str
    gain: ExactRatioV1

    def __post_init__(self) -> None:
        require_contract_id(self.filter_version, field="filter_version")
        if not isinstance(self.gain, ExactRatioV1):
            raise ContractValueError("gain must be ExactRatioV1")
        if self.gain.numerator <= 0 or self.gain.numerator > self.gain.denominator:
            raise ContractValueError("gain must lie in (0, 1]")

    @property
    def challenger_status(self) -> str:
        return CHALLENGER_STATUS

    def run(self, path: BasisPathV1) -> tuple[FilterStepV1, ...]:
        # The path contract already bounds points to MAX_FILTER_POINTS.
        if not isinstance(path, BasisPathV1):
            raise ContractValueError("path must be BasisPathV1")
        gain = fp_from_ratio(self.gain)
        steps: list[FilterStepV1] = []
        estimate: FixedPointV1 | None = None
        for point in path.points:
            observed = basis_fixed_point(point)
            if estimate is None:
                estimate = observed
                innovation = FP_ZERO
            else:
                innovation = fp_sub(observed, estimate)
                estimate = fp_add(estimate, fp_mul(gain, innovation))
            steps.append(
                FilterStepV1(
                    event_time_ns=point.event_time_ns,
                    estimate=estimate,
                    innovation=innovation,
                )
            )
        return tuple(steps)


@dataclass(frozen=True, slots=True)
class MeanReversionDiagnosticV1:
    """Zero-mean AR(1) diagnostic over the quantized basis path.

    The AR(1)-around-zero form is the tested hypothesis, never an assumption of
    truth; phi exists exactly when the status is AVAILABLE, and the discrete
    half-life is bracketed in whole observation steps with explicit censoring.
    """

    status: MeanReversionStatus
    observations: int
    phi: ExactRatioV1 | None
    half_life_steps: int | None
    half_life_censored: bool

    def __post_init__(self) -> None:
        if not isinstance(self.status, MeanReversionStatus):
            raise ContractValueError("status must be MeanReversionStatus")
        require_strict_int(self.observations, field="observations", minimum=0)
        if (self.phi is not None) != (
            self.status in (MeanReversionStatus.AVAILABLE, MeanReversionStatus.NON_MEAN_REVERTING)
        ):
            raise ContractValueError("phi exists exactly when a verdict exists")
        if self.phi is not None and not isinstance(self.phi, ExactRatioV1):
            raise ContractValueError("phi must be ExactRatioV1 or None")
        if self.half_life_steps is not None:
            require_strict_int(
                self.half_life_steps,
                field="half_life_steps",
                minimum=1,
                maximum=MAX_HALF_LIFE_STEPS,
            )
            if self.status is not MeanReversionStatus.AVAILABLE or self.half_life_censored:
                raise ContractValueError("a half-life requires an uncensored AVAILABLE verdict")
        if not isinstance(self.half_life_censored, bool):
            raise ContractValueError("half_life_censored must be boolean")
        if self.half_life_censored and self.status is not MeanReversionStatus.AVAILABLE:
            raise ContractValueError("censoring only applies to an AVAILABLE verdict")

    def as_mapping(self) -> dict[str, object]:
        return {
            "halfLifeCensored": self.half_life_censored,
            "halfLifeSteps": self.half_life_steps,
            "observations": self.observations,
            "phi": None if self.phi is None else self.phi.as_mapping(),
            "status": self.status.value,
        }


def mean_reversion_diagnostic(path: BasisPathV1) -> MeanReversionDiagnosticV1:
    """Exact zero-mean AR(1) fit and discrete half-life over the basis path.

    ``phi = sum(x_{t-1} * x_t) / sum(x_{t-1}^2)`` over quantized basis mantissas.
    The half-life is the smallest k with ``|phi|^k <= 1/2`` decided in exact
    integer arithmetic; k beyond the bounded maximum is censored, ``|phi| >= 1`` is
    NON_MEAN_REVERTING and insufficient history stays UNKNOWN.
    """

    if not isinstance(path, BasisPathV1):
        raise ContractValueError("path must be BasisPathV1")
    mantissas = [basis_fixed_point(point).mantissa for point in path.points]
    observations = len(mantissas)
    if observations < MIN_AR1_OBSERVATIONS:
        return MeanReversionDiagnosticV1(
            status=MeanReversionStatus.UNKNOWN,
            observations=observations,
            phi=None,
            half_life_steps=None,
            half_life_censored=False,
        )
    numerator = sum(previous * current for previous, current in itertools.pairwise(mantissas))
    denominator = sum(previous * previous for previous in mantissas[:-1])
    if denominator == 0:
        return MeanReversionDiagnosticV1(
            status=MeanReversionStatus.UNKNOWN,
            observations=observations,
            phi=None,
            half_life_steps=None,
            half_life_censored=False,
        )
    phi = make_ratio(numerator, denominator)
    abs_numerator = abs(phi.numerator)
    if abs_numerator >= phi.denominator:
        return MeanReversionDiagnosticV1(
            status=MeanReversionStatus.NON_MEAN_REVERTING,
            observations=observations,
            phi=phi,
            half_life_steps=None,
            half_life_censored=False,
        )
    # Exact bracketing: |phi|^k <= 1/2  <=>  2 * |num|^k <= den^k.
    power_numerator = 1
    power_denominator = 1
    for step in range(1, MAX_HALF_LIFE_STEPS + 1):
        power_numerator *= abs_numerator
        power_denominator *= phi.denominator
        if 2 * power_numerator <= power_denominator:
            return MeanReversionDiagnosticV1(
                status=MeanReversionStatus.AVAILABLE,
                observations=observations,
                phi=phi,
                half_life_steps=step,
                half_life_censored=False,
            )
    return MeanReversionDiagnosticV1(
        status=MeanReversionStatus.AVAILABLE,
        observations=observations,
        phi=phi,
        half_life_steps=None,
        half_life_censored=True,
    )
