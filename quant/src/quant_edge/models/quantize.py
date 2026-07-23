"""Q10 float-to-contract boundaries.

Model engines compute in binary64 internally. Historical consumers use the
lossless binary64-to-fixed-point helpers. Q10 campaign publication instead
passes every model-derived float through one explicit vendor-invariance policy:
Python general format at 12 significant decimal digits with canonical zero,
then direct decimal-rational parsing and half-even projection onto the Q06
``FixedPointV1`` scale. No float survives either public boundary.

The significant-digit step is a serialization policy, not a tolerance,
comparison rule, model-training change, or claim of additional measurement
accuracy.
"""

from __future__ import annotations

from decimal import Decimal
from fractions import Fraction
from math import isfinite
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    FixedPointV1,
    round_half_even,
)

PROBABILITY_ONE_MANTISSA = FIXED_POINT_SCALE
MODEL_OUTPUT_SIGNIFICANT_DIGITS: Final = 12
MODEL_OUTPUT_FORMAT_SPEC: Final = f"z.{MODEL_OUTPUT_SIGNIFICANT_DIGITS}g"


def _fixed_point_from_fraction(exact: Fraction) -> FixedPointV1:
    scaled = exact * FIXED_POINT_SCALE
    if scaled >= 0:
        mantissa = round_half_even(scaled.numerator, scaled.denominator)
    else:
        magnitude = -scaled
        mantissa = -round_half_even(magnitude.numerator, magnitude.denominator)
    return FixedPointV1(mantissa)


def _require_finite_binary64(value: float, *, field: str) -> None:
    if isinstance(value, bool) or not isinstance(value, float):
        raise ContractValueError(f"{field} must be a binary64 float")
    if not isfinite(value):
        raise ContractValueError(f"{field} must be finite")


def quantize_binary64(value: float, *, field: str) -> FixedPointV1:
    """Quantize one binary64 value half-even onto the fixed-point grid.

    The input must be a finite Python float. ``Fraction.from_float`` recovers
    the exact rational the binary64 represents, so the half-even rounding below
    is exact by construction. This historical lossless crossing remains
    available to non-campaign consumers.
    """

    _require_finite_binary64(value, field=field)
    return _fixed_point_from_fraction(Fraction.from_float(value))


def canonical_model_output_text(value: float, *, field: str) -> str:
    """Return the Q10 campaign's finite, canonical 12-significant-digit lexeme."""

    _require_finite_binary64(value, field=field)
    return format(value, MODEL_OUTPUT_FORMAT_SPEC)


def quantize_model_output(value: float, *, field: str) -> FixedPointV1:
    """Publish one Q10 model float under the vendor-invariant precision policy."""

    lexeme = canonical_model_output_text(value, field=field)
    return _fixed_point_from_fraction(Fraction(Decimal(lexeme)))


def quantize_binary64_with_abs_error(
    value: float,
    *,
    field: str,
) -> tuple[FixedPointV1, FixedPointV1]:
    """Quantize once and publish a conservative exact-grid absolute error."""

    quantized = quantize_binary64(value, field=field)
    exact_scaled = Fraction.from_float(value) * FIXED_POINT_SCALE
    error = abs(exact_scaled - quantized.mantissa)
    error_mantissa = (error.numerator + error.denominator - 1) // error.denominator
    return quantized, FixedPointV1(error_mantissa)


def quantize_probability(value: float, *, field: str) -> FixedPointV1:
    """Quantize a probability and fail closed outside [0, 1]."""

    quantized = quantize_binary64(value, field=field)
    if not 0 <= quantized.mantissa <= PROBABILITY_ONE_MANTISSA:
        raise ContractValueError(f"{field} must quantize into [0, 1]")
    return quantized


def quantize_model_probability(value: float, *, field: str) -> FixedPointV1:
    """Publish a Q10 model probability without rounding an invalid input into range."""

    _require_finite_binary64(value, field=field)
    if not 0.0 <= value <= 1.0:
        raise ContractValueError(f"{field} must lie in [0, 1]")
    quantized = quantize_model_output(value, field=field)
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


def quantize_model_vector(values: tuple[float, ...], *, field: str) -> tuple[FixedPointV1, ...]:
    if not isinstance(values, tuple) or not values:
        raise ContractValueError(f"{field} must be a non-empty tuple of floats")
    return tuple(
        quantize_model_output(item, field=f"{field}[{index}]") for index, item in enumerate(values)
    )


def quantize_model_probability_vector(
    values: tuple[float, ...], *, field: str
) -> tuple[FixedPointV1, ...]:
    if not isinstance(values, tuple) or not values:
        raise ContractValueError(f"{field} must be a non-empty tuple of floats")
    return tuple(
        quantize_model_probability(item, field=f"{field}[{index}]")
        for index, item in enumerate(values)
    )
