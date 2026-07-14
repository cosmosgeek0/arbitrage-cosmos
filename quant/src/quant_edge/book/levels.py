from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import MAX_DECIMAL_COEFFICIENT, require_strict_int

MAX_DECIMAL_TEXT_LENGTH: Final = 80
MAX_DECIMAL_SCALE: Final = 38
MAX_DECIMAL_SIGNIFICANT_DIGITS: Final = 38
MAX_LADDER_CAPACITY: Final = 65_536
DECIMAL_ALIGNMENT_SCALE: Final = MAX_DECIMAL_SCALE

_DECIMAL_PATTERN: Final = re.compile(r"^(?P<integer>0|[1-9][0-9]*)(?:\.(?P<fraction>[0-9]+))?$")


class BookSide(StrEnum):
    BID = "BID"
    ASK = "ASK"


class LadderUpdateOutcome(StrEnum):
    INSERTED = "INSERTED"
    REPLACED = "REPLACED"
    REMOVED = "REMOVED"
    REMOVED_ABSENT = "REMOVED_ABSENT"
    CAPACITY_EXCEEDED = "CAPACITY_EXCEEDED"


@dataclass(frozen=True, slots=True)
class BookDecimalV1:
    """Exact non-negative decimal preserved from a canonical wire string.

    ``coefficient``/``scale`` are trailing-zero normalized so equal numeric values share
    one numeric identity; ``text`` preserves the exact wire form. ``aligned`` is the
    integer value scaled to ``DECIMAL_ALIGNMENT_SCALE`` for total ordering without floats.
    """

    text: str
    coefficient: int
    scale: int
    aligned: int

    def __post_init__(self) -> None:
        if not isinstance(self.text, str):
            raise ContractValueError("decimal text must be a string")
        require_strict_int(
            self.coefficient,
            field="coefficient",
            minimum=0,
            maximum=MAX_DECIMAL_COEFFICIENT,
        )
        require_strict_int(self.scale, field="scale", minimum=0, maximum=MAX_DECIMAL_SCALE)
        expected = parse_book_decimal(self.text, field="decimal", allow_zero=True)
        if (
            expected.coefficient != self.coefficient
            or expected.scale != self.scale
            or expected.aligned != self.aligned
        ):
            raise ContractValueError("decimal fields disagree with the canonical wire text")

    @property
    def is_zero(self) -> bool:
        return self.coefficient == 0

    @property
    def numeric_key(self) -> tuple[int, int]:
        return (self.coefficient, self.scale)

    def as_mapping(self) -> dict[str, object]:
        return {"coefficient": str(self.coefficient), "scale": self.scale, "text": self.text}


def parse_book_decimal(value: object, *, field: str, allow_zero: bool) -> BookDecimalV1:
    if not isinstance(value, str) or not value or len(value) > MAX_DECIMAL_TEXT_LENGTH:
        raise ContractValueError(
            f"{field} must be a decimal string of at most {MAX_DECIMAL_TEXT_LENGTH} characters"
        )
    match = _DECIMAL_PATTERN.fullmatch(value)
    if match is None:
        raise ContractValueError(f"{field} must be a canonical non-floating decimal string")
    fraction = match.group("fraction") or ""
    digits = f"{match.group('integer')}{fraction}"
    significant = digits.lstrip("0") or "0"
    if len(fraction) > MAX_DECIMAL_SCALE or len(significant) > MAX_DECIMAL_SIGNIFICANT_DIGITS:
        raise ContractValueError(f"{field} exceeds the exact decimal range")
    coefficient = int(digits)
    scale = len(fraction)
    while scale > 0 and coefficient % 10 == 0:
        coefficient //= 10
        scale -= 1
    if coefficient == 0:
        if not allow_zero:
            raise ContractValueError(f"{field} must be strictly positive")
        scale = 0
    aligned = coefficient * 10 ** (DECIMAL_ALIGNMENT_SCALE - scale)
    decimal = object.__new__(BookDecimalV1)
    object.__setattr__(decimal, "text", value)
    object.__setattr__(decimal, "coefficient", coefficient)
    object.__setattr__(decimal, "scale", scale)
    object.__setattr__(decimal, "aligned", aligned)
    return decimal


@dataclass(frozen=True, slots=True)
class PriceLevelUpdateV1:
    """One absolute-quantity level assignment; zero quantity removes the level."""

    price: BookDecimalV1
    quantity: BookDecimalV1

    def __post_init__(self) -> None:
        if not isinstance(self.price, BookDecimalV1) or not isinstance(
            self.quantity, BookDecimalV1
        ):
            raise ContractValueError("price and quantity must be BookDecimalV1")
        if self.price.is_zero:
            raise ContractValueError("price must be strictly positive")

    def as_mapping(self) -> dict[str, object]:
        return {"price": self.price.text, "quantity": self.quantity.text}


def parse_price_level_update(
    price: object,
    quantity: object,
    *,
    field: str,
) -> PriceLevelUpdateV1:
    return PriceLevelUpdateV1(
        price=parse_book_decimal(price, field=f"{field}.price", allow_zero=False),
        quantity=parse_book_decimal(quantity, field=f"{field}.quantity", allow_zero=True),
    )


class PriceLadder:
    """Deterministic one-side price ladder with absolute-quantity replacement."""

    __slots__ = ("__capacity", "__levels", "__side")

    def __init__(self, side: BookSide, *, capacity: int) -> None:
        if not isinstance(side, BookSide):
            raise ContractValueError("side must be a BookSide")
        self.__side = side
        self.__capacity = require_strict_int(
            capacity,
            field="capacity",
            minimum=1,
            maximum=MAX_LADDER_CAPACITY,
        )
        self.__levels: dict[tuple[int, int], PriceLevelUpdateV1] = {}

    @property
    def side(self) -> BookSide:
        return self.__side

    @property
    def capacity(self) -> int:
        return self.__capacity

    @property
    def depth(self) -> int:
        return len(self.__levels)

    def apply(self, update: PriceLevelUpdateV1) -> LadderUpdateOutcome:
        if not isinstance(update, PriceLevelUpdateV1):
            raise ContractValueError("ladder updates must be PriceLevelUpdateV1")
        key = update.price.numeric_key
        if update.quantity.is_zero:
            if key in self.__levels:
                del self.__levels[key]
                return LadderUpdateOutcome.REMOVED
            return LadderUpdateOutcome.REMOVED_ABSENT
        if key in self.__levels:
            self.__levels[key] = update
            return LadderUpdateOutcome.REPLACED
        if len(self.__levels) >= self.__capacity:
            return LadderUpdateOutcome.CAPACITY_EXCEEDED
        self.__levels[key] = update
        return LadderUpdateOutcome.INSERTED

    def best_price_aligned(self) -> int | None:
        if not self.__levels:
            return None
        aligned = (level.price.aligned for level in self.__levels.values())
        if self.__side is BookSide.BID:
            return max(aligned)
        return min(aligned)

    def canonical_levels(self) -> tuple[PriceLevelUpdateV1, ...]:
        ordered = sorted(
            self.__levels.values(),
            key=lambda level: level.price.aligned,
            reverse=self.__side is BookSide.BID,
        )
        return tuple(ordered)

    def clear(self) -> None:
        self.__levels.clear()
