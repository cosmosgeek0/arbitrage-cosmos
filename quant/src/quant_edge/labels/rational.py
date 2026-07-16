from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import ExactScaledValueV1, require_strict_int

MAX_RATIO_MAGNITUDE: Final = 10**60


@dataclass(frozen=True, slots=True)
class ExactRatioV1:
    """Reduced exact rational number; the lane never rounds through floats."""

    numerator: int
    denominator: int

    def __post_init__(self) -> None:
        require_strict_int(
            self.numerator,
            field="numerator",
            minimum=-MAX_RATIO_MAGNITUDE,
            maximum=MAX_RATIO_MAGNITUDE,
        )
        require_strict_int(
            self.denominator,
            field="denominator",
            minimum=1,
            maximum=MAX_RATIO_MAGNITUDE,
        )
        if math.gcd(abs(self.numerator), self.denominator) != 1:
            raise ContractValueError("ratio must be stored fully reduced")

    @property
    def is_zero(self) -> bool:
        return self.numerator == 0

    @property
    def is_negative(self) -> bool:
        return self.numerator < 0

    def as_mapping(self) -> dict[str, object]:
        return {"denominator": str(self.denominator), "numerator": str(self.numerator)}


def make_ratio(numerator: int, denominator: int) -> ExactRatioV1:
    if isinstance(numerator, bool) or not isinstance(numerator, int):
        raise ContractValueError("numerator must be an integer")
    if isinstance(denominator, bool) or not isinstance(denominator, int) or denominator == 0:
        raise ContractValueError("denominator must be a non-zero integer")
    if denominator < 0:
        numerator = -numerator
        denominator = -denominator
    divisor = math.gcd(abs(numerator), denominator)
    if divisor > 1:
        numerator //= divisor
        denominator //= divisor
    return ExactRatioV1(numerator=numerator, denominator=denominator)


ZERO_RATIO: Final = make_ratio(0, 1)


def ratio_add(left: ExactRatioV1, right: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(
        left.numerator * right.denominator + right.numerator * left.denominator,
        left.denominator * right.denominator,
    )


def ratio_subtract(left: ExactRatioV1, right: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(
        left.numerator * right.denominator - right.numerator * left.denominator,
        left.denominator * right.denominator,
    )


def ratio_compare(left: ExactRatioV1, right: ExactRatioV1) -> int:
    lhs = left.numerator * right.denominator
    rhs = right.numerator * left.denominator
    if lhs < rhs:
        return -1
    if lhs > rhs:
        return 1
    return 0


def scaled_to_aligned(value: ExactScaledValueV1) -> int:
    """Integer value at a fixed 10^38 alignment for exact cross-scale arithmetic."""

    # The contract bounds scale to 0..38, so the exponent is always non-negative.
    aligned: int = value.coefficient * 10 ** (38 - value.scale)
    return aligned


def price_return(reference: ExactScaledValueV1, future: ExactScaledValueV1) -> ExactRatioV1:
    """Exact simple return ``future/reference - 1``; reference must be positive."""

    if not isinstance(reference, ExactScaledValueV1) or not isinstance(future, ExactScaledValueV1):
        raise ContractValueError("returns are computed over exact scaled prices")
    reference_aligned = scaled_to_aligned(reference)
    future_aligned = scaled_to_aligned(future)
    if reference_aligned <= 0:
        raise ContractValueError("reference price must be strictly positive")
    if future_aligned < 0:
        raise ContractValueError("future price must be non-negative")
    return make_ratio(future_aligned - reference_aligned, reference_aligned)


def price_spread_ratio(
    bid: ExactScaledValueV1,
    ask: ExactScaledValueV1,
) -> ExactRatioV1:
    """Exact relative spread ``(ask - bid) / mid`` with ``mid = (ask + bid) / 2``."""

    bid_aligned = scaled_to_aligned(bid)
    ask_aligned = scaled_to_aligned(ask)
    if bid_aligned <= 0 or ask_aligned <= 0:
        raise ContractValueError("quote prices must be strictly positive")
    if ask_aligned < bid_aligned:
        raise ContractValueError("crossed quotes cannot produce a lawful spread")
    return make_ratio(2 * (ask_aligned - bid_aligned), ask_aligned + bid_aligned)
