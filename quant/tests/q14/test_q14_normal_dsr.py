"""Q14 deterministic normal core and Deflated Sharpe Ratio gates."""

from __future__ import annotations

from fractions import Fraction

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.validation.dsr import (
    DsrInputsV1,
    DsrReportV1,
    DsrStatus,
    deflated_sharpe_ratio,
    expected_max_sharpe_w,
    point_sharpe,
    sharpe_variance_across,
)
from quant_edge.validation.normal import (
    DECLARED_MAX_ABS_ERROR,
    WORKING_SCALE,
    Z_CLAMP_W,
    _erf_w,
    fixed_sqrt,
    normal_cdf,
    normal_quantile,
    phi_w,
    quantile_w,
    sqrt_w,
)

SCALE = 10**12

# Reference values computed independently to 28 decimal digits.
PHI_REFERENCES = {
    0: 500_000_000_000,
    1 * SCALE: 841_344_746_069,
    2 * SCALE: 977_249_868_052,
    3 * SCALE: 998_650_101_968,
    -1 * SCALE: 158_655_253_931,
}


def test_normal_cdf_matches_references_within_declared_bound() -> None:
    for z_mantissa, expected in PHI_REFERENCES.items():
        value = normal_cdf(FixedPointV1(z_mantissa))
        assert abs(value.mantissa - expected) <= DECLARED_MAX_ABS_ERROR.mantissa
    with pytest.raises(ContractValueError, match="FixedPointV1"):
        normal_cdf(1.0)  # type: ignore[arg-type]


def test_phi_clamps_and_symmetry() -> None:
    assert phi_w(Z_CLAMP_W) == WORKING_SCALE
    assert phi_w(-Z_CLAMP_W) == 0
    assert phi_w(13 * WORKING_SCALE) == WORKING_SCALE
    z = 987_654_321 * WORKING_SCALE // 1_000_000_000
    assert phi_w(z) + phi_w(-z) in (WORKING_SCALE, WORKING_SCALE - 1)
    with pytest.raises(ContractValueError, match="z_w"):
        phi_w("nope")  # type: ignore[arg-type]


def test_erf_series_convergence_cap_fails_loudly() -> None:
    with pytest.raises(ContractValueError, match="convergence"):
        _erf_w(40 * WORKING_SCALE)


def test_quantile_inverts_cdf() -> None:
    known = {
        Fraction(1, 2): 0,
        Fraction(975, 1000): 1_959_963_984_540,
        Fraction(99, 100): 2_326_347_874_041,
        Fraction(1, 100): -2_326_347_874_041,
    }
    for probability, expected in known.items():
        value = normal_quantile(probability)
        assert abs(value.mantissa - expected) <= DECLARED_MAX_ABS_ERROR.mantissa
    with pytest.raises(ContractValueError, match="Fraction"):
        quantile_w(0.5)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="inside"):
        quantile_w(Fraction(0))
    with pytest.raises(ContractValueError, match="inside"):
        quantile_w(Fraction(1))
    assert quantile_w(Fraction(2 * 10**24 - 1, 2 * 10**24)) == Z_CLAMP_W
    assert quantile_w(Fraction(1, 10**25)) == -Z_CLAMP_W


def test_sqrt_laws() -> None:
    assert sqrt_w(4 * WORKING_SCALE) == 2 * WORKING_SCALE
    assert fixed_sqrt(FixedPointV1(4 * SCALE)) == FixedPointV1(2 * SCALE)
    assert fixed_sqrt(FixedPointV1(2 * SCALE)).mantissa == 1_414_213_562_373
    with pytest.raises(ContractValueError, match="non-negative"):
        sqrt_w(-1)
    with pytest.raises(ContractValueError, match="value_w"):
        sqrt_w("nope")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="FixedPointV1"):
        fixed_sqrt(4)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="non-negative"):
        fixed_sqrt(FixedPointV1(-1))


def _returns(pattern: list[tuple[int, int]]) -> tuple[ExactRatioV1, ...]:
    return tuple(make_ratio(numerator, denominator) for numerator, denominator in pattern)


def _steady_returns(count: int) -> tuple[ExactRatioV1, ...]:
    """Alternating small positive returns with positive mean and real variance."""

    return _returns([(3, 100) if index % 2 else (1, 100) for index in range(count)])


def test_dsr_inputs_contract_law() -> None:
    returns = _steady_returns(24)
    with pytest.raises(ContractValueError, match="tuple"):
        DsrInputsV1(returns=list(returns), trial_count=3, trial_sr_variance=make_ratio(1, 100))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="ExactRatioV1"):
        DsrInputsV1(returns=(0.5,), trial_count=3, trial_sr_variance=make_ratio(1, 100))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="trial_count"):
        DsrInputsV1(returns=returns, trial_count=0, trial_sr_variance=make_ratio(1, 100))
    with pytest.raises(ContractValueError, match="trial_sr_variance"):
        DsrInputsV1(returns=returns, trial_count=3, trial_sr_variance="v")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="negative"):
        DsrInputsV1(returns=returns, trial_count=3, trial_sr_variance=make_ratio(-1, 100))


def test_dsr_report_contract_law() -> None:
    with pytest.raises(ContractValueError, match="DsrStatus"):
        DsrReportV1(
            status="AVAILABLE",  # type: ignore[arg-type]
            reason=None,
            sharpe=FixedPointV1(1),
            benchmark_sr0=FixedPointV1(1),
            dsr_probability=FixedPointV1(1),
            observation_count=24,
            trial_count=2,
            max_abs_error=DECLARED_MAX_ABS_ERROR,
        )
    with pytest.raises(ContractValueError, match="values and no reason"):
        DsrReportV1(
            status=DsrStatus.AVAILABLE,
            reason=None,
            sharpe=None,
            benchmark_sr0=FixedPointV1(1),
            dsr_probability=FixedPointV1(1),
            observation_count=24,
            trial_count=2,
            max_abs_error=DECLARED_MAX_ABS_ERROR,
        )
    with pytest.raises(ContractValueError, match="no values"):
        DsrReportV1(
            status=DsrStatus.INVALID,
            reason="SOME_REASON",
            sharpe=FixedPointV1(1),
            benchmark_sr0=None,
            dsr_probability=None,
            observation_count=24,
            trial_count=2,
            max_abs_error=DECLARED_MAX_ABS_ERROR,
        )
    with pytest.raises(ContractValueError, match="reason and no benchmark"):
        DsrReportV1(
            status=DsrStatus.INVALID,
            reason=None,
            sharpe=None,
            benchmark_sr0=None,
            dsr_probability=None,
            observation_count=24,
            trial_count=2,
            max_abs_error=DECLARED_MAX_ABS_ERROR,
        )
    with pytest.raises(ContractValueError, match="declared module bound"):
        DsrReportV1(
            status=DsrStatus.INVALID,
            reason="SOME_REASON",
            sharpe=None,
            benchmark_sr0=None,
            dsr_probability=None,
            observation_count=24,
            trial_count=2,
            max_abs_error=FixedPointV1(1),
        )


def test_expected_max_sharpe_gates_and_monotonicity() -> None:
    assert expected_max_sharpe_w(trial_count=1, trial_sr_variance=Fraction(1, 100)) == 0
    assert expected_max_sharpe_w(trial_count=10, trial_sr_variance=Fraction(0)) == 0
    few = expected_max_sharpe_w(trial_count=5, trial_sr_variance=Fraction(1, 100))
    many = expected_max_sharpe_w(trial_count=500, trial_sr_variance=Fraction(1, 100))
    assert 0 < few < many
    with pytest.raises(ContractValueError, match="trial_count"):
        expected_max_sharpe_w(trial_count=0, trial_sr_variance=Fraction(1, 100))
    with pytest.raises(ContractValueError, match="non-negative Fraction"):
        expected_max_sharpe_w(trial_count=5, trial_sr_variance=Fraction(-1, 100))
    with pytest.raises(ContractValueError, match="non-negative Fraction"):
        expected_max_sharpe_w(trial_count=5, trial_sr_variance=0.5)  # type: ignore[arg-type]


def test_dsr_validity_gates() -> None:
    with pytest.raises(ContractValueError, match="DsrInputsV1"):
        deflated_sharpe_ratio("nope")  # type: ignore[arg-type]
    short = DsrInputsV1(
        returns=_steady_returns(19),
        trial_count=2,
        trial_sr_variance=make_ratio(1, 100),
    )
    assert deflated_sharpe_ratio(short).reason == "INSUFFICIENT_OBSERVATIONS"
    flat = DsrInputsV1(
        returns=_returns([(1, 100)] * 24),
        trial_count=2,
        trial_sr_variance=make_ratio(1, 100),
    )
    assert deflated_sharpe_ratio(flat).reason == "VARIANCE_BELOW_RESOLUTION"


def test_dsr_deflation_shrinks_with_more_trials() -> None:
    returns = _steady_returns(40)
    one_trial = deflated_sharpe_ratio(
        DsrInputsV1(returns=returns, trial_count=1, trial_sr_variance=make_ratio(0, 1))
    )
    many_trials = deflated_sharpe_ratio(
        DsrInputsV1(returns=returns, trial_count=200, trial_sr_variance=make_ratio(1, 4))
    )
    assert one_trial.status is DsrStatus.AVAILABLE
    assert many_trials.status is DsrStatus.AVAILABLE
    assert one_trial.benchmark_sr0 == FixedPointV1(0)
    assert many_trials.benchmark_sr0 is not None
    assert many_trials.benchmark_sr0.mantissa > 0
    assert one_trial.dsr_probability is not None
    assert many_trials.dsr_probability is not None
    assert many_trials.dsr_probability.mantissa < one_trial.dsr_probability.mantissa
    mapping = many_trials.as_mapping()
    assert mapping["status"] == "AVAILABLE"
    assert mapping["maxAbsError"] == DECLARED_MAX_ABS_ERROR.as_mapping()


def test_dsr_non_positive_variance_adjustment_gate() -> None:
    # A two-point return distribution sits exactly on the Pearson kurtosis bound
    # (g4 = g3^2 + 1), where the variance adjustment reduces to (1 - g3*SR/2)^2.
    # With q = 1/5 the skew is 3/2, so SR = 2/g3 = 4/3 makes the radicand exactly
    # zero: 4 copies of 1/10 and 16 copies of 1/40 give mean 1/25, sigma 3/100.
    returns = tuple([make_ratio(1, 10)] * 4 + [make_ratio(1, 40)] * 16)
    report = deflated_sharpe_ratio(
        DsrInputsV1(returns=returns, trial_count=2, trial_sr_variance=make_ratio(1, 100))
    )
    assert report.status is DsrStatus.INVALID
    assert report.reason == "NON_POSITIVE_VARIANCE_ADJUSTMENT"


def test_point_sharpe_and_trial_variance() -> None:
    returns = _steady_returns(24)
    sharpe = point_sharpe(returns)
    assert sharpe is not None
    assert sharpe.mantissa == 2 * SCALE
    assert point_sharpe(returns[:1]) is None
    assert point_sharpe(_returns([(1, 100)] * 24)) is None
    with pytest.raises(ContractValueError, match="tuple"):
        point_sharpe(list(returns))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="ExactRatioV1"):
        point_sharpe((0.5,))  # type: ignore[arg-type]

    variance = sharpe_variance_across((FixedPointV1(SCALE), FixedPointV1(3 * SCALE)))
    assert variance == make_ratio(1, 1)
    with pytest.raises(ContractValueError, match="between 2"):
        sharpe_variance_across((FixedPointV1(SCALE),))
    with pytest.raises(ContractValueError, match="FixedPointV1"):
        sharpe_variance_across((FixedPointV1(SCALE), 1))  # type: ignore[arg-type]
