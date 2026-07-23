from __future__ import annotations

import math
from fractions import Fraction

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE
from quant_edge.models.quantize import (
    MODEL_OUTPUT_FORMAT_SPEC,
    MODEL_OUTPUT_SIGNIFICANT_DIGITS,
    canonical_model_output_text,
    quantize_binary64,
    quantize_model_output,
    quantize_model_probability,
    quantize_model_probability_vector,
    quantize_model_vector,
    quantize_probability,
    quantize_probability_vector,
    quantize_vector,
)


def test_exact_values_quantize_exactly() -> None:
    assert quantize_binary64(0.5, field="v").mantissa == FIXED_POINT_SCALE // 2
    assert quantize_binary64(1.0, field="v").mantissa == FIXED_POINT_SCALE
    assert quantize_binary64(-2.25, field="v").mantissa == -9 * FIXED_POINT_SCALE // 4
    assert quantize_binary64(0.0, field="v").mantissa == 0
    assert quantize_binary64(-0.0, field="v").mantissa == 0


def test_quantization_is_nearest_within_half_grid_unit() -> None:
    for value in (0.1, -0.3, 1.7e-5, 123.456, -9876.000001, 3.141592653589793):
        mantissa = quantize_binary64(value, field="v").mantissa
        exact = Fraction.from_float(value) * FIXED_POINT_SCALE
        assert abs(exact - mantissa) <= Fraction(1, 2)


def test_half_even_law_on_exact_grid_midpoints() -> None:
    # value = j / 8192 with odd j scales to an exact half-integer mantissa:
    # j * 10^12 / 2^13 = j * 5^12 / 2, so the half-even law must land even.
    for j in (1, 3, 5, 7, 9, 11, 4097):
        mantissa = quantize_binary64(j / 8192, field="v").mantissa
        assert mantissa % 2 == 0
        exact = Fraction(j, 8192) * FIXED_POINT_SCALE
        assert abs(exact - mantissa) == Fraction(1, 2)


def test_rejects_non_floats_and_non_finite() -> None:
    with pytest.raises(ContractValueError, match="binary64"):
        quantize_binary64(1, field="v")
    with pytest.raises(ContractValueError, match="binary64"):
        quantize_binary64(True, field="v")
    with pytest.raises(ContractValueError, match="finite"):
        quantize_binary64(float("nan"), field="v")
    with pytest.raises(ContractValueError, match="finite"):
        quantize_binary64(float("inf"), field="v")


def test_rejects_values_beyond_the_fixed_point_range() -> None:
    with pytest.raises(ContractValueError, match="mantissa"):
        quantize_binary64(1e30, field="v")


def test_probability_bounds_fail_closed() -> None:
    assert quantize_probability(0.0, field="p").mantissa == 0
    assert quantize_probability(1.0, field="p").mantissa == FIXED_POINT_SCALE
    with pytest.raises(ContractValueError, match=r"\[0, 1\]"):
        quantize_probability(1.0000001, field="p")
    with pytest.raises(ContractValueError, match=r"\[0, 1\]"):
        quantize_probability(-0.0000001, field="p")


def test_vector_contracts() -> None:
    vector = quantize_vector((0.5, -1.25), field="v")
    assert [item.mantissa for item in vector] == [
        FIXED_POINT_SCALE // 2,
        -5 * FIXED_POINT_SCALE // 4,
    ]
    with pytest.raises(ContractValueError, match="non-empty"):
        quantize_vector((), field="v")
    with pytest.raises(ContractValueError, match="non-empty"):
        quantize_vector([0.5], field="v")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match=r"v\[1\]"):
        quantize_vector((0.5, float("nan")), field="v")


def test_probability_vector_contracts() -> None:
    vector = quantize_probability_vector((0.25, 0.75), field="p")
    assert len(vector) == 2
    with pytest.raises(ContractValueError, match="non-empty"):
        quantize_probability_vector((), field="p")
    with pytest.raises(ContractValueError, match=r"p\[0\]"):
        quantize_probability_vector((1.5,), field="p")


def test_model_output_policy_is_explicit_significant_digit_formatting() -> None:
    assert MODEL_OUTPUT_SIGNIFICANT_DIGITS == 12
    assert MODEL_OUTPUT_FORMAT_SPEC == "z.12g"
    assert canonical_model_output_text(123.456789012345, field="v") == "123.456789012"
    assert canonical_model_output_text(1.23456789012345e-20, field="v") == "1.23456789012e-20"
    assert canonical_model_output_text(-0.0, field="v") == "0"


def test_adjacent_binary64_vendor_noise_collapses_at_model_output_boundary() -> None:
    committed_draw = 11986555.93255707
    failed_draw = 11986555.932557072
    assert math.nextafter(committed_draw, math.inf) == failed_draw
    assert canonical_model_output_text(committed_draw, field="v") == canonical_model_output_text(
        failed_draw, field="v"
    )
    assert quantize_model_output(committed_draw, field="v") == quantize_model_output(
        failed_draw, field="v"
    )


def test_real_twelfth_significant_digit_change_remains_distinct() -> None:
    lower = 0.1234567890124
    upper = 0.1234567890126
    assert canonical_model_output_text(lower, field="v") == "0.123456789012"
    assert canonical_model_output_text(upper, field="v") == "0.123456789013"
    assert quantize_model_output(lower, field="v") != quantize_model_output(upper, field="v")


def test_model_output_policy_is_idempotent_and_finite_only() -> None:
    for value in (0.0, -0.0, 1.0, -2.5, 1.23456789012345e-20, 9.999999999999e20):
        first = canonical_model_output_text(value, field="v")
        assert canonical_model_output_text(float(first), field="v") == first
    with pytest.raises(ContractValueError, match="binary64"):
        canonical_model_output_text(1, field="v")
    with pytest.raises(ContractValueError, match="finite"):
        canonical_model_output_text(float("nan"), field="v")
    with pytest.raises(ContractValueError, match="finite"):
        quantize_model_output(float("inf"), field="v")


def test_model_output_probability_and_vector_contracts_fail_closed() -> None:
    assert quantize_model_probability(0.25, field="p").mantissa == FIXED_POINT_SCALE // 4
    assert quantize_model_vector((0.5, -1.25), field="v") == quantize_vector(
        (0.5, -1.25), field="v"
    )
    assert len(quantize_model_probability_vector((0.25, 0.75), field="p")) == 2
    with pytest.raises(ContractValueError, match=r"\[0, 1\]"):
        quantize_model_probability(1.0000000000001, field="p")
    with pytest.raises(ContractValueError, match="non-empty"):
        quantize_model_vector((), field="v")
    with pytest.raises(ContractValueError, match=r"p\[1\]"):
        quantize_model_probability_vector((0.5, float("nan")), field="p")
