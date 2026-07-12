from __future__ import annotations

import pytest

from quant_edge.book.levels import (
    MAX_DECIMAL_TEXT_LENGTH,
    BookDecimalV1,
    BookSide,
    LadderUpdateOutcome,
    PriceLadder,
    PriceLevelUpdateV1,
    parse_book_decimal,
    parse_price_level_update,
)
from quant_edge.errors import ContractValueError


def _decimal(text: str, *, allow_zero: bool = True) -> BookDecimalV1:
    return parse_book_decimal(text, field="value", allow_zero=allow_zero)


def _update(price: str, quantity: str) -> PriceLevelUpdateV1:
    return parse_price_level_update(price, quantity, field="update")


class TestParseBookDecimal:
    def test_preserves_wire_text_and_normalizes_numeric_identity(self) -> None:
        parsed = _decimal("25.35190000")

        assert parsed.text == "25.35190000"
        assert parsed.coefficient == 253_519
        assert parsed.scale == 4
        assert not parsed.is_zero

    def test_equal_values_share_numeric_key_across_wire_forms(self) -> None:
        assert _decimal("0.0024").numeric_key == _decimal("0.002400").numeric_key
        assert _decimal("10").numeric_key == _decimal("10.000").numeric_key

    def test_integer_and_zero_forms(self) -> None:
        assert _decimal("0").numeric_key == (0, 0)
        assert _decimal("0.0000").numeric_key == (0, 0)
        assert _decimal("0.0000").is_zero
        assert _decimal("431").numeric_key == (431, 0)

    def test_aligned_value_orders_across_scales(self) -> None:
        assert _decimal("0.0024").aligned < _decimal("0.0026").aligned
        assert _decimal("2").aligned < _decimal("10").aligned
        assert _decimal("0.5").aligned < _decimal("1").aligned
        assert _decimal("7403.89").aligned == _decimal("7403.8900").aligned

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "00.1",
            "01",
            ".5",
            "5.",
            "1..2",
            "-1",
            "+1",
            "1e5",
            "NaN",
            "0x10",
            "1,5",
            " 1",
            "1 ",
        ],
    )
    def test_rejects_noncanonical_text(self, text: str) -> None:
        with pytest.raises(ContractValueError):
            _decimal(text)

    def test_rejects_non_string_and_oversized_text(self) -> None:
        with pytest.raises(ContractValueError):
            parse_book_decimal(1, field="value", allow_zero=True)
        with pytest.raises(ContractValueError):
            _decimal("1" * (MAX_DECIMAL_TEXT_LENGTH + 1))

    def test_rejects_excess_scale_or_significant_digits(self) -> None:
        with pytest.raises(ContractValueError):
            _decimal("0." + "0" * 38 + "1")
        with pytest.raises(ContractValueError):
            _decimal("1" * 39)

    def test_zero_rejected_when_not_allowed(self) -> None:
        with pytest.raises(ContractValueError):
            _decimal("0.000", allow_zero=False)

    def test_boundary_widths_accepted(self) -> None:
        assert _decimal("0." + "0" * 37 + "1").scale == 38
        assert _decimal("9" * 38).coefficient == int("9" * 38)


class TestBookDecimalContract:
    def test_direct_construction_must_agree_with_wire_text(self) -> None:
        parsed = _decimal("0.0024")
        rebuilt = BookDecimalV1(
            text="0.0024",
            coefficient=parsed.coefficient,
            scale=parsed.scale,
            aligned=parsed.aligned,
        )

        assert rebuilt == parsed

    def test_direct_construction_rejects_disagreeing_fields(self) -> None:
        parsed = _decimal("0.0024")
        with pytest.raises(ContractValueError):
            BookDecimalV1(text="0.0025", coefficient=parsed.coefficient, scale=2, aligned=1)
        with pytest.raises(ContractValueError):
            BookDecimalV1(text=1, coefficient=1, scale=0, aligned=parsed.aligned)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            BookDecimalV1(text="0.0024", coefficient=-1, scale=2, aligned=0)
        with pytest.raises(ContractValueError):
            BookDecimalV1(text="0.0024", coefficient=24, scale=64, aligned=0)

    def test_as_mapping_is_exact(self) -> None:
        assert _decimal("0.0024").as_mapping() == {
            "coefficient": "24",
            "scale": 4,
            "text": "0.0024",
        }


class TestPriceLevelUpdate:
    def test_zero_quantity_is_a_removal_marker(self) -> None:
        update = _update("0.0024", "0.00000000")

        assert update.quantity.is_zero
        assert update.as_mapping() == {"price": "0.0024", "quantity": "0.00000000"}

    def test_rejects_zero_price(self) -> None:
        with pytest.raises(ContractValueError):
            _update("0.0000", "1")

    def test_rejects_non_decimal_fields(self) -> None:
        with pytest.raises(ContractValueError):
            PriceLevelUpdateV1(price="0.0024", quantity=_decimal("1"))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            PriceLevelUpdateV1(price=_decimal("0.0024"), quantity="1")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            PriceLevelUpdateV1(price=_decimal("0"), quantity=_decimal("1"))


class TestPriceLadder:
    def test_side_and_capacity_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            PriceLadder("BID", capacity=4)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            PriceLadder(BookSide.BID, capacity=0)
        with pytest.raises(ContractValueError):
            PriceLadder(BookSide.BID, capacity=65_537)
        ladder = PriceLadder(BookSide.BID, capacity=4)

        assert ladder.side is BookSide.BID
        assert ladder.capacity == 4
        assert ladder.depth == 0
        with pytest.raises(ContractValueError):
            ladder.apply("update")  # type: ignore[arg-type]

    def test_absolute_quantity_lifecycle(self) -> None:
        ladder = PriceLadder(BookSide.BID, capacity=4)

        assert ladder.apply(_update("0.0024", "10")) is LadderUpdateOutcome.INSERTED
        assert ladder.apply(_update("0.002400", "12")) is LadderUpdateOutcome.REPLACED
        assert ladder.apply(_update("0.0024", "0")) is LadderUpdateOutcome.REMOVED
        assert ladder.apply(_update("0.0024", "0")) is LadderUpdateOutcome.REMOVED_ABSENT
        assert ladder.depth == 0

    def test_capacity_bound_refuses_new_level_without_mutation(self) -> None:
        ladder = PriceLadder(BookSide.ASK, capacity=2)
        ladder.apply(_update("1.1", "1"))
        ladder.apply(_update("1.2", "1"))

        assert ladder.apply(_update("1.3", "1")) is LadderUpdateOutcome.CAPACITY_EXCEEDED
        assert ladder.depth == 2
        assert ladder.apply(_update("1.2", "9")) is LadderUpdateOutcome.REPLACED

    def test_best_and_canonical_order_per_side(self) -> None:
        bids = PriceLadder(BookSide.BID, capacity=8)
        asks = PriceLadder(BookSide.ASK, capacity=8)
        for price in ("0.0101", "0.0100", "0.0102"):
            bids.apply(_update(price, "1"))
            asks.apply(_update(price, "1"))

        assert bids.best_price_aligned() == _decimal("0.0102").aligned
        assert asks.best_price_aligned() == _decimal("0.0100").aligned
        assert [level.price.text for level in bids.canonical_levels()] == [
            "0.0102",
            "0.0101",
            "0.0100",
        ]
        assert [level.price.text for level in asks.canonical_levels()] == [
            "0.0100",
            "0.0101",
            "0.0102",
        ]

    def test_empty_ladder_has_no_best_and_clear_resets(self) -> None:
        ladder = PriceLadder(BookSide.BID, capacity=2)

        assert ladder.best_price_aligned() is None
        ladder.apply(_update("1", "1"))
        ladder.clear()
        assert ladder.depth == 0
        assert ladder.canonical_levels() == ()
