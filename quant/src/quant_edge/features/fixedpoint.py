from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import require_strict_int

FIXED_POINT_SCALE: Final = 10**12
MAX_FIXED_MANTISSA: Final = 10**38


def round_half_even(numerator: int, denominator: int) -> int:
    """Deterministic banker's rounding of ``numerator / denominator``."""

    if isinstance(numerator, bool) or not isinstance(numerator, int):
        raise ContractValueError("numerator must be an integer")
    if isinstance(denominator, bool) or not isinstance(denominator, int) or denominator <= 0:
        raise ContractValueError("denominator must be a positive integer")
    quotient, remainder = divmod(numerator, denominator)
    doubled = remainder * 2
    if doubled > denominator or (doubled == denominator and quotient % 2 != 0):
        quotient += 1
    return quotient


@dataclass(frozen=True, slots=True)
class FixedPointV1:
    """Integer fixed-point value at the single declared scale; never a float."""

    mantissa: int

    def __post_init__(self) -> None:
        require_strict_int(
            self.mantissa,
            field="mantissa",
            minimum=-MAX_FIXED_MANTISSA,
            maximum=MAX_FIXED_MANTISSA,
        )

    @property
    def is_zero(self) -> bool:
        return self.mantissa == 0

    def as_mapping(self) -> dict[str, object]:
        return {"mantissa": str(self.mantissa), "scale": str(FIXED_POINT_SCALE)}


FP_ZERO: Final = FixedPointV1(0)
FP_ONE: Final = FixedPointV1(FIXED_POINT_SCALE)


def fp_from_int(value: int) -> FixedPointV1:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractValueError("value must be an integer")
    return FixedPointV1(value * FIXED_POINT_SCALE)


def fp_from_ratio(ratio: ExactRatioV1) -> FixedPointV1:
    if not isinstance(ratio, ExactRatioV1):
        raise ContractValueError("ratio must be ExactRatioV1")
    return FixedPointV1(round_half_even(ratio.numerator * FIXED_POINT_SCALE, ratio.denominator))


def fp_add(left: FixedPointV1, right: FixedPointV1) -> FixedPointV1:
    return FixedPointV1(left.mantissa + right.mantissa)


def fp_sub(left: FixedPointV1, right: FixedPointV1) -> FixedPointV1:
    return FixedPointV1(left.mantissa - right.mantissa)


def fp_mul(left: FixedPointV1, right: FixedPointV1) -> FixedPointV1:
    product = left.mantissa * right.mantissa
    sign = -1 if product < 0 else 1
    return FixedPointV1(sign * round_half_even(abs(product), FIXED_POINT_SCALE))


def fp_div(left: FixedPointV1, right: FixedPointV1) -> FixedPointV1:
    if right.mantissa == 0:
        raise ContractValueError("fixed-point division by zero")
    numerator = left.mantissa * FIXED_POINT_SCALE
    sign = -1 if (numerator < 0) != (right.mantissa < 0) else 1
    return FixedPointV1(sign * round_half_even(abs(numerator), abs(right.mantissa)))


def fp_abs(value: FixedPointV1) -> FixedPointV1:
    return FixedPointV1(abs(value.mantissa))


def fp_compare(left: FixedPointV1, right: FixedPointV1) -> int:
    if left.mantissa < right.mantissa:
        return -1
    if left.mantissa > right.mantissa:
        return 1
    return 0


def fp_mean_of_two(left: FixedPointV1, right: FixedPointV1) -> FixedPointV1:
    total = left.mantissa + right.mantissa
    sign = -1 if total < 0 else 1
    return FixedPointV1(sign * round_half_even(abs(total), 2))


def fp_ulp_distance(left: FixedPointV1, right: FixedPointV1) -> int:
    return abs(left.mantissa - right.mantissa)
