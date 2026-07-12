"""Deflated Sharpe Ratio diagnostics (§16.3), valid-gated and deterministic.

Follows Bailey & López de Prado's construction: the observed non-annualized Sharpe
ratio is compared against the expected maximum Sharpe ratio of ``trial_count``
effectively independent trials, adjusted for skewness and kurtosis of the return
series. Moments are exact rationals; square roots, Φ and Φ⁻¹ run on the deterministic
integer fixed-point core with a declared approximation bound. Every statistical
precondition is an explicit gate that yields ``INVALID`` with a typed reason — this
module refuses to be approximately right about validity.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, round_half_even
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import require_reason_code, require_strict_int
from quant_edge.validation.normal import (
    DECLARED_MAX_ABS_ERROR,
    WORKING_SCALE,
    phi_w,
    quantile_w,
    sqrt_w,
)

MIN_OBSERVATIONS: Final = 20
MAX_OBSERVATIONS: Final = 1_000_000
MAX_TRIALS: Final = 1_000_000
MIN_VARIANCE_W: Final = 10**12
"""Return variance below 10^-12 is beneath the deterministic resolution gate."""

GAMMA_W: Final = 577_215_664_901_532_860_606_512
E_INV_W: Final = 367_879_441_171_442_321_595_523


class DsrStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    INVALID = "INVALID"


@dataclass(frozen=True, slots=True)
class DsrInputsV1:
    """Injected evidence for one DSR evaluation."""

    returns: tuple[ExactRatioV1, ...]
    trial_count: int
    trial_sr_variance: ExactRatioV1

    def __post_init__(self) -> None:
        if not isinstance(self.returns, tuple) or len(self.returns) > MAX_OBSERVATIONS:
            raise ContractValueError("returns must be a tuple of bounded length")
        if any(not isinstance(value, ExactRatioV1) for value in self.returns):
            raise ContractValueError("returns must contain ExactRatioV1 entries")
        require_strict_int(self.trial_count, field="trial_count", minimum=1, maximum=MAX_TRIALS)
        if not isinstance(self.trial_sr_variance, ExactRatioV1):
            raise ContractValueError("trial_sr_variance must be ExactRatioV1")
        if self.trial_sr_variance.is_negative:
            raise ContractValueError("trial_sr_variance cannot be negative")


@dataclass(frozen=True, slots=True)
class DsrReportV1:
    """DSR evaluation result with explicit validity and declared error bound."""

    status: DsrStatus
    reason: str | None
    sharpe: FixedPointV1 | None
    benchmark_sr0: FixedPointV1 | None
    dsr_probability: FixedPointV1 | None
    observation_count: int
    trial_count: int
    max_abs_error: FixedPointV1

    def __post_init__(self) -> None:
        if not isinstance(self.status, DsrStatus):
            raise ContractValueError("status must be a DsrStatus")
        populated = (
            isinstance(self.sharpe, FixedPointV1)
            and isinstance(self.benchmark_sr0, FixedPointV1)
            and isinstance(self.dsr_probability, FixedPointV1)
        )
        if self.status is DsrStatus.AVAILABLE:
            if not populated or self.reason is not None:
                raise ContractValueError("available reports carry values and no reason")
        else:
            if self.sharpe is not None or self.dsr_probability is not None:
                raise ContractValueError("invalid reports carry no values")
            if self.benchmark_sr0 is not None or self.reason is None:
                raise ContractValueError("invalid reports carry a reason and no benchmark")
            require_reason_code(self.reason, field="reason")
        require_strict_int(self.observation_count, field="observation_count", minimum=0)
        require_strict_int(self.trial_count, field="trial_count", minimum=0)
        if self.max_abs_error != DECLARED_MAX_ABS_ERROR:
            raise ContractValueError("max_abs_error must be the declared module bound")

    def as_mapping(self) -> dict[str, object]:
        return {
            "benchmarkSr0": (
                None if self.benchmark_sr0 is None else self.benchmark_sr0.as_mapping()
            ),
            "dsrProbability": (
                None if self.dsr_probability is None else self.dsr_probability.as_mapping()
            ),
            "maxAbsError": self.max_abs_error.as_mapping(),
            "observationCount": self.observation_count,
            "reason": self.reason,
            "sharpe": None if self.sharpe is None else self.sharpe.as_mapping(),
            "status": self.status.value,
            "trialCount": self.trial_count,
        }


def _invalid(reason: str, observations: int, trials: int) -> DsrReportV1:
    return DsrReportV1(
        status=DsrStatus.INVALID,
        reason=reason,
        sharpe=None,
        benchmark_sr0=None,
        dsr_probability=None,
        observation_count=observations,
        trial_count=trials,
        max_abs_error=DECLARED_MAX_ABS_ERROR,
    )


def _to_working(value: Fraction) -> int:
    return round_half_even(value.numerator * WORKING_SCALE, value.denominator)


def _to_public(value_w: int) -> FixedPointV1:
    return FixedPointV1(round_half_even(value_w * FIXED_POINT_SCALE, WORKING_SCALE))


def _central_moments(series: list[Fraction]) -> tuple[Fraction, Fraction, Fraction]:
    count = len(series)
    mean = sum(series, Fraction(0)) / count
    m2 = Fraction(0)
    m3 = Fraction(0)
    m4 = Fraction(0)
    for value in series:
        centered = value - mean
        squared = centered * centered
        m2 += squared
        m3 += squared * centered
        m4 += squared * squared
    return m2 / count, m3 / count, m4 / count


def _mean(series: list[Fraction]) -> Fraction:
    return sum(series, Fraction(0)) / len(series)


def expected_max_sharpe_w(*, trial_count: int, trial_sr_variance: Fraction) -> int:
    """SR0 at the working scale: E[max SR] over N independent no-skill trials."""

    require_strict_int(trial_count, field="trial_count", minimum=1, maximum=MAX_TRIALS)
    if not isinstance(trial_sr_variance, Fraction) or trial_sr_variance < 0:
        raise ContractValueError("trial_sr_variance must be a non-negative Fraction")
    if trial_count == 1:
        return 0
    variance_w = _to_working(trial_sr_variance)
    if variance_w == 0:
        return 0
    scale_w = sqrt_w(variance_w)
    p1 = Fraction(trial_count - 1, trial_count)
    p2 = 1 - Fraction(E_INV_W, WORKING_SCALE) / trial_count
    q1_w = quantile_w(p1)
    q2_w = quantile_w(p2)
    factor_w = ((WORKING_SCALE - GAMMA_W) * q1_w + GAMMA_W * q2_w) // WORKING_SCALE
    return scale_w * factor_w // WORKING_SCALE


def deflated_sharpe_ratio(inputs: DsrInputsV1) -> DsrReportV1:
    """Evaluate the DSR with every statistical precondition as an explicit gate."""

    if not isinstance(inputs, DsrInputsV1):
        raise ContractValueError("inputs must be DsrInputsV1")
    observations = len(inputs.returns)
    trials = inputs.trial_count
    if observations < MIN_OBSERVATIONS:
        return _invalid("INSUFFICIENT_OBSERVATIONS", observations, trials)

    series = [Fraction(value.numerator, value.denominator) for value in inputs.returns]
    m2, m3, m4 = _central_moments(series)
    m2_w = _to_working(m2)
    if m2_w < MIN_VARIANCE_W:
        return _invalid("VARIANCE_BELOW_RESOLUTION", observations, trials)

    sigma_w = sqrt_w(m2_w)
    mean_w = _to_working(_mean(series))
    sharpe_w = round_half_even(mean_w * WORKING_SCALE, sigma_w)

    m2_sigma_w = m2_w * sigma_w // WORKING_SCALE
    skew_w = round_half_even(_to_working(m3) * WORKING_SCALE, m2_sigma_w)
    kurtosis = m4 / (m2 * m2)
    kurtosis_w = _to_working(kurtosis)

    sr_squared_w = sharpe_w * sharpe_w // WORKING_SCALE
    radicand_w = (
        WORKING_SCALE
        - skew_w * sharpe_w // WORKING_SCALE
        + (kurtosis_w - WORKING_SCALE) * sr_squared_w // (4 * WORKING_SCALE)
    )
    if radicand_w <= 0:
        return _invalid("NON_POSITIVE_VARIANCE_ADJUSTMENT", observations, trials)

    trial_variance = Fraction(
        inputs.trial_sr_variance.numerator, inputs.trial_sr_variance.denominator
    )
    sr0_w = expected_max_sharpe_w(trial_count=trials, trial_sr_variance=trial_variance)

    sqrt_t_minus_1_w = sqrt_w((observations - 1) * WORKING_SCALE)
    numerator_w = (sharpe_w - sr0_w) * sqrt_t_minus_1_w // WORKING_SCALE
    denominator_w = sqrt_w(radicand_w)
    z_w = round_half_even(numerator_w * WORKING_SCALE, denominator_w)
    dsr_w = phi_w(z_w)

    return DsrReportV1(
        status=DsrStatus.AVAILABLE,
        reason=None,
        sharpe=_to_public(sharpe_w),
        benchmark_sr0=_to_public(sr0_w),
        dsr_probability=_to_public(dsr_w),
        observation_count=observations,
        trial_count=trials,
        max_abs_error=DECLARED_MAX_ABS_ERROR,
    )


def point_sharpe(returns: tuple[ExactRatioV1, ...]) -> FixedPointV1 | None:
    """Non-annualized Sharpe ratio, or None when beneath the validity gates."""

    if not isinstance(returns, tuple) or len(returns) > MAX_OBSERVATIONS:
        raise ContractValueError("returns must be a tuple of bounded length")
    if any(not isinstance(value, ExactRatioV1) for value in returns):
        raise ContractValueError("returns must contain ExactRatioV1 entries")
    if len(returns) < 2:
        return None
    series = [Fraction(value.numerator, value.denominator) for value in returns]
    m2, _, _ = _central_moments(series)
    m2_w = _to_working(m2)
    if m2_w < MIN_VARIANCE_W:
        return None
    sharpe_w = round_half_even(_to_working(_mean(series)) * WORKING_SCALE, sqrt_w(m2_w))
    return _to_public(sharpe_w)


def sharpe_variance_across(trial_sharpes: tuple[FixedPointV1, ...]) -> ExactRatioV1:
    """Exact population variance of trial Sharpe ratios (fixed-point inputs)."""

    if not isinstance(trial_sharpes, tuple) or not 2 <= len(trial_sharpes) <= MAX_TRIALS:
        raise ContractValueError("trial_sharpes must contain between 2 and MAX_TRIALS entries")
    if any(not isinstance(value, FixedPointV1) for value in trial_sharpes):
        raise ContractValueError("trial_sharpes must contain FixedPointV1 entries")
    values = [Fraction(value.mantissa, FIXED_POINT_SCALE) for value in trial_sharpes]
    mean = sum(values, Fraction(0)) / len(values)
    variance = sum(((value - mean) ** 2 for value in values), Fraction(0)) / len(values)
    return make_ratio(variance.numerator, variance.denominator)
