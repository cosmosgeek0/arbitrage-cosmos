from __future__ import annotations

from fractions import Fraction

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE
from quant_edge.models.quantize import (
    quantize_binary64,
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
