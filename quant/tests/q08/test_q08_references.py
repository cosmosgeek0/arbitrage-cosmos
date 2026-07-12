from __future__ import annotations

import pytest

from quant_edge.derivatives.references import (
    ReferenceDifferenceStatus,
    ReferenceDifferenceV1,
    ReferenceKind,
    ReferencePriceV1,
    ReferenceSetV1,
    premium,
    reference_difference,
)
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import ExactScaledValueV1

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _price(kind: ReferenceKind, offset_s: int, price: int) -> ReferencePriceV1:
    return ReferencePriceV1(
        kind=kind,
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        price=ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT"),
    )


def _reference_set(*entries: ReferencePriceV1, as_of_s: int = 100) -> ReferenceSetV1:
    return ReferenceSetV1(
        symbol="BNBUSDT-PERP",
        as_of_ns=BASE_NS + as_of_s * SECOND_NS,
        max_staleness_ns=10 * SECOND_NS,
        entries=tuple(sorted(entries, key=lambda entry: entry.kind.value)),
    )


class TestReferenceContracts:
    def test_reference_price_requires_kind_time_and_positive_price(self) -> None:
        with pytest.raises(ContractValueError, match="kind"):
            ReferencePriceV1(
                kind="MARK",  # type: ignore[arg-type]
                event_time_ns=BASE_NS,
                price=ExactScaledValueV1(coefficient=1, scale=0, unit_id="USDT"),
            )
        with pytest.raises(ContractValueError, match="strictly positive"):
            _price(ReferenceKind.MARK, 0, 0)
        with pytest.raises(ContractValueError, match="ExactScaledValueV1"):
            ReferencePriceV1(
                kind=ReferenceKind.MARK,
                event_time_ns=BASE_NS,
                price=101.5,  # type: ignore[arg-type]
            )

    def test_reference_set_rejects_duplicates_unsorted_and_future_entries(self) -> None:
        mark = _price(ReferenceKind.MARK, 95, 10_050)
        with pytest.raises(ContractValueError, match="duplicate"):
            _reference_set(mark, _price(ReferenceKind.MARK, 96, 10_060))
        with pytest.raises(ContractValueError, match="sorted"):
            ReferenceSetV1(
                symbol="BNBUSDT-PERP",
                as_of_ns=BASE_NS + 100 * SECOND_NS,
                max_staleness_ns=10 * SECOND_NS,
                entries=(
                    _price(ReferenceKind.MID, 95, 10_040),
                    _price(ReferenceKind.INDEX, 95, 10_020),
                ),
            )
        with pytest.raises(ContractValueError, match="newer than as-of"):
            _reference_set(_price(ReferenceKind.MARK, 200, 10_050))
        with pytest.raises(ContractValueError, match="at most one price per kind"):
            ReferenceSetV1(
                symbol="BNBUSDT-PERP",
                as_of_ns=BASE_NS,
                max_staleness_ns=SECOND_NS,
                entries=[],  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="ReferencePriceV1"):
            ReferenceSetV1(
                symbol="BNBUSDT-PERP",
                as_of_ns=BASE_NS,
                max_staleness_ns=SECOND_NS,
                entries=("MARK",),  # type: ignore[arg-type]
            )

    def test_reference_set_entry_lookup_requires_kind(self) -> None:
        references = _reference_set(_price(ReferenceKind.MARK, 95, 10_050))
        assert references.entry(ReferenceKind.MARK) is not None
        assert references.entry(ReferenceKind.INDEX) is None
        with pytest.raises(ContractValueError, match="ReferenceKind"):
            references.entry("MARK")  # type: ignore[arg-type]

    def test_difference_value_exists_exactly_when_available(self) -> None:
        with pytest.raises(ContractValueError, match="exactly when"):
            ReferenceDifferenceV1(
                numerator_kind=ReferenceKind.MARK,
                denominator_kind=ReferenceKind.INDEX,
                as_of_ns=BASE_NS,
                status=ReferenceDifferenceStatus.UNKNOWN,
                value=premium(
                    _reference_set(
                        _price(ReferenceKind.INDEX, 95, 10_000),
                        _price(ReferenceKind.MARK, 95, 10_050),
                    )
                ).value,
            )
        with pytest.raises(ContractValueError, match="two distinct kinds"):
            ReferenceDifferenceV1(
                numerator_kind=ReferenceKind.MARK,
                denominator_kind=ReferenceKind.MARK,
                as_of_ns=BASE_NS,
                status=ReferenceDifferenceStatus.UNKNOWN,
                value=None,
            )


class TestReferenceDifference:
    def test_premium_uses_mark_and_index_only(self) -> None:
        references = _reference_set(
            _price(ReferenceKind.INDEX, 95, 10_000),
            _price(ReferenceKind.MARK, 95, 10_050),
            _price(ReferenceKind.MID, 95, 99_999),
        )
        observed = premium(references)
        assert observed.status is ReferenceDifferenceStatus.AVAILABLE
        assert observed.value is not None
        # (10050 - 10000) / 10000 exactly, unaffected by the absurd MID entry.
        assert observed.value.numerator == 1
        assert observed.value.denominator == 200
        assert observed.numerator_kind is ReferenceKind.MARK
        assert observed.denominator_kind is ReferenceKind.INDEX

    def test_missing_kind_is_unknown_never_zero(self) -> None:
        references = _reference_set(_price(ReferenceKind.MARK, 95, 10_050))
        observed = premium(references)
        assert observed.status is ReferenceDifferenceStatus.UNKNOWN
        assert observed.value is None

    def test_stale_kind_is_stale_never_zero_and_never_substituted(self) -> None:
        references = _reference_set(
            _price(ReferenceKind.INDEX, 10, 10_000),
            _price(ReferenceKind.MARK, 95, 10_050),
            _price(ReferenceKind.MID, 95, 10_020),
        )
        observed = premium(references)
        assert observed.status is ReferenceDifferenceStatus.STALE
        assert observed.value is None

    def test_generic_difference_rejects_equal_kinds_and_bad_inputs(self) -> None:
        references = _reference_set(_price(ReferenceKind.MID, 95, 10_020))
        with pytest.raises(ContractValueError, match="distinct kinds"):
            reference_difference(references, ReferenceKind.MID, ReferenceKind.MID)
        with pytest.raises(ContractValueError, match="ReferenceSetV1"):
            reference_difference(None, ReferenceKind.MID, ReferenceKind.MARK)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="ReferenceKind"):
            reference_difference(references, "MID", ReferenceKind.MARK)  # type: ignore[arg-type]

    def test_mid_versus_last_trade_stays_typed(self) -> None:
        references = _reference_set(
            _price(ReferenceKind.LAST_TRADE, 95, 10_010),
            _price(ReferenceKind.MID, 95, 10_020),
        )
        observed = reference_difference(references, ReferenceKind.MID, ReferenceKind.LAST_TRADE)
        assert observed.status is ReferenceDifferenceStatus.AVAILABLE
        assert observed.value is not None
        assert observed.value.numerator == 1
        assert observed.value.denominator == 1_001
        mapping = observed.as_mapping()
        assert mapping["numeratorKind"] == "MID"
        assert mapping["denominatorKind"] == "LAST_TRADE"

    def test_set_and_price_mappings_are_deterministic(self) -> None:
        references = _reference_set(_price(ReferenceKind.INDEX, 95, 10_000))
        mapping = references.as_mapping()
        assert mapping["symbol"] == "BNBUSDT-PERP"
        entries = mapping["entries"]
        assert isinstance(entries, list)
        assert len(entries) == 1
        assert entries[0]["kind"] == "INDEX"
