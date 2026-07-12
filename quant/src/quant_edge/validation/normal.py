"""Deterministic integer fixed-point standard-normal CDF, quantile and square root.

Everything here is pure integer arithmetic at an internal working scale of 10^-24, so
results are byte-identical on every platform. Φ uses the alternating Maclaurin series
of erf with |z| clamped to 12 (the true tail beyond 12 is below one working ulp);
Φ⁻¹ is a bounded bisection against Φ itself. Values are approximations with a declared
conservative absolute-error bound; they are never presented as exact.
"""

from __future__ import annotations

import math
from fractions import Fraction
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, round_half_even

WORKING_SCALE: Final = 10**24
Z_CLAMP_W: Final = 12 * WORKING_SCALE
MAX_ERF_TERMS: Final = 1_024
QUANTILE_BISECTIONS: Final = 96

TWO_OVER_SQRT_PI_W: Final = 1_128_379_167_095_512_573_896_158
INV_SQRT2_W: Final = 707_106_781_186_547_524_400_844

DECLARED_MAX_ABS_ERROR: Final = FixedPointV1(1_000)
"""Conservative declared bound: 10^-9 at the public 10^-12 scale."""


def _require_int(value: object, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractValueError(f"{field} must be an integer")
    return value


def _erf_w(x_w: int) -> int:
    """erf(x) at the working scale for x_w >= 0 via the alternating Maclaurin series.

    With the public |z| <= 12 clamp the argument satisfies x <= 12/sqrt(2) < 8.5, the
    term magnitudes peak near n = x^2 < 73 and reach zero well before MAX_ERF_TERMS;
    the cap exists so an out-of-contract caller fails loudly instead of spinning.
    """

    x2_w = x_w * x_w // WORKING_SCALE
    power = x_w
    total = power
    term_index = 1
    while term_index < MAX_ERF_TERMS:
        power = power * x2_w // (WORKING_SCALE * term_index)
        term = power // (2 * term_index + 1)
        if term == 0:
            return TWO_OVER_SQRT_PI_W * total // WORKING_SCALE
        total += -term if term_index % 2 else term
        term_index += 1
    raise ContractValueError("erf series exceeded its convergence bound")


def phi_w(z_w: int) -> int:
    """Standard-normal CDF at the working scale with the documented |z| <= 12 clamp."""

    _require_int(z_w, field="z_w")
    if z_w >= Z_CLAMP_W:
        return WORKING_SCALE
    if z_w <= -Z_CLAMP_W:
        return 0
    x_w = abs(z_w) * INV_SQRT2_W // WORKING_SCALE
    erf_value = _erf_w(x_w)
    if z_w >= 0:
        return (WORKING_SCALE + erf_value) // 2
    return (WORKING_SCALE - erf_value) // 2


def quantile_w(probability: Fraction) -> int:
    """Φ⁻¹ at the working scale by bounded bisection against ``phi_w``."""

    if not isinstance(probability, Fraction):
        raise ContractValueError("probability must be a Fraction")
    if probability <= 0 or probability >= 1:
        raise ContractValueError("probability must lie strictly inside (0, 1)")
    target_w = round_half_even(probability.numerator * WORKING_SCALE, probability.denominator)
    if target_w >= WORKING_SCALE:
        return Z_CLAMP_W
    if target_w <= 0:
        return -Z_CLAMP_W
    low = -Z_CLAMP_W
    high = Z_CLAMP_W
    for _ in range(QUANTILE_BISECTIONS):
        mid = (low + high) // 2
        if phi_w(mid) < target_w:
            low = mid
        else:
            high = mid
    return (low + high) // 2


def sqrt_w(value_w: int) -> int:
    """Floor square root at the working scale: sqrt(v/W) = isqrt(v * W) / W."""

    _require_int(value_w, field="value_w")
    if value_w < 0:
        raise ContractValueError("square root requires a non-negative value")
    return math.isqrt(value_w * WORKING_SCALE)


def normal_cdf(z: FixedPointV1) -> FixedPointV1:
    """Public Φ over the accepted fixed-point contract (scale 10^-12)."""

    if not isinstance(z, FixedPointV1):
        raise ContractValueError("z must be FixedPointV1")
    z_w = z.mantissa * (WORKING_SCALE // FIXED_POINT_SCALE)
    return FixedPointV1(round_half_even(phi_w(z_w) * FIXED_POINT_SCALE, WORKING_SCALE))


def normal_quantile(probability: Fraction) -> FixedPointV1:
    """Public Φ⁻¹ over the accepted fixed-point contract (scale 10^-12)."""

    z_w = quantile_w(probability)
    return FixedPointV1(round_half_even(z_w * FIXED_POINT_SCALE, WORKING_SCALE))


def fixed_sqrt(value: FixedPointV1) -> FixedPointV1:
    """Public floor square root over the accepted fixed-point contract."""

    if not isinstance(value, FixedPointV1):
        raise ContractValueError("value must be FixedPointV1")
    if value.mantissa < 0:
        raise ContractValueError("square root requires a non-negative value")
    return FixedPointV1(math.isqrt(value.mantissa * FIXED_POINT_SCALE))
