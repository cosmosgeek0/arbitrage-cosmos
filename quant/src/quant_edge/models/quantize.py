"""The Q10 quantization law: binary64 model outputs die here, exactly once.

Model engines compute in binary64 internally. Every value that crosses into a
public numeric contract is quantized through this module: the exact rational
represented by the binary64 (via ``Fraction.from_float``, which is lossless) is
rounded half-even onto the single Q06 ``FixedPointV1`` scale. No float survives
past this boundary and no second rounding ever occurs.
"""

from __future__ import annotations

from fractions import Fraction
from math import isfinite

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    FixedPointV1,
    round_half_even,
)

PROBABILITY_ONE_MANTISSA = FIXED_POINT_SCALE


def quantize_binary64(value: float, *, field: str) -> FixedPointV1:
    """Quantize one binary64 value half-even onto the fixed-point grid.

    The input must be a finite Python float. ``Fraction.from_float`` recovers
    the exact rational the binary64 represents, so the half-even rounding below
    is exact by construction; this is the only float-to-contract crossing in
    the models package.
    """

    if isinstance(value, bool) or not isinstance(value, float):
        raise ContractValueError(f"{field} must be a binary64 float")
    if not isfinite(value):
        raise ContractValueError(f"{field} must be finite")
    exact = Fraction.from_float(value)
    scaled = exact * FIXED_POINT_SCALE
    if scaled >= 0:
        mantissa = round_half_even(scaled.numerator, scaled.denominator)
    else:
        magnitude = -scaled
        mantissa = -round_half_even(magnitude.numerator, magnitude.denominator)
    return FixedPointV1(mantissa)


def quantize_probability(value: float, *, field: str) -> FixedPointV1:
    """Quantize a probability and fail closed outside [0, 1]."""

    quantized = quantize_binary64(value, field=field)
    if not 0 <= quantized.mantissa <= PROBABILITY_ONE_MANTISSA:
        raise ContractValueError(f"{field} must quantize into [0, 1]")
    return quantized


def quantize_vector(values: tuple[float, ...], *, field: str) -> tuple[FixedPointV1, ...]:
    if not isinstance(values, tuple) or not values:
        raise ContractValueError(f"{field} must be a non-empty tuple of floats")
    return tuple(
        quantize_binary64(item, field=f"{field}[{index}]") for index, item in enumerate(values)
    )


def quantize_probability_vector(
    values: tuple[float, ...], *, field: str
) -> tuple[FixedPointV1, ...]:
    if not isinstance(values, tuple) or not values:
        raise ContractValueError(f"{field} must be a non-empty tuple of floats")
    return tuple(
        quantize_probability(item, field=f"{field}[{index}]") for index, item in enumerate(values)
    )
