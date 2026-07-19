from __future__ import annotations

import pytest

from quant_edge.derivatives.basis_path import (
    BASIS_ALIGNMENT,
    BasisPathV1,
    BasisPointV1,
    LegAttributionV1,
    LegDriver,
    attribute_leg_changes,
    basis_fixed_point,
    build_basis_bars,
    build_basis_path,
)
from quant_edge.derivatives.references import ReferenceKind
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import make_ratio, ratio_add, ratio_compare, ratio_subtract
from quant_edge.labels.series import (
    EvidenceSeriesV1,
    GapIntervalV1,
    PricePointV1,
    QuotePointV1,
    SeriesKind,
)
from quant_edge.lake.contracts import (
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
STALENESS = 5 * SECOND_NS


def _price(price: int, unit_id: str = "USDT") -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=price, scale=2, unit_id=unit_id)


def _usdt(price: int) -> ExactScaledValueV1:
    return _price(price)


def _market_identity(
    symbol: str,
    *,
    instrument_id: str | None = None,
    base_size_unit_id: str = "BNB",
    quote_price_unit_id: str = "USDT",
) -> InstrumentIdentityV1:
    return InstrumentIdentityV1(
        instrument_id=instrument_id or f"test-{symbol}",
        base_size_unit_id=base_size_unit_id,
        quote_price_unit_id=quote_price_unit_id,
    )


def _series(
    series_id: str,
    symbol: str,
    prices: list[tuple[int, int]],
    *,
    end_offset_s: int = 100,
    gaps: tuple[GapIntervalV1, ...] = (),
    kind: SeriesKind = SeriesKind.TRADE_MID_PROXY,
    posture: EvidencePosture = EvidencePosture.SYNTHETIC,
    instrument_id: str | None = None,
    base_size_unit_id: str = "BNB",
    quote_price_unit_id: str = "USDT",
) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id=series_id,
        symbol=symbol,
        instrument=_market_identity(
            symbol,
            instrument_id=instrument_id,
            base_size_unit_id=base_size_unit_id,
            quote_price_unit_id=quote_price_unit_id,
        ),
        kind=kind,
        posture=posture,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + end_offset_s * SECOND_NS,
        price_points=tuple(
            PricePointV1(
                event_time_ns=BASE_NS + offset_s * SECOND_NS,
                ordinal=index,
                price=_price(price, quote_price_unit_id),
            )
            for index, (offset_s, price) in enumerate(prices)
        ),
        quote_points=(),
        known_gaps=gaps,
    )


def _point(offset_s: int, ordinal: int, spot: int, perp: int) -> BasisPointV1:
    return BasisPointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        basis=make_ratio(perp - spot, spot),
        spot_aligned=spot,
        perp_aligned=perp,
    )


def _path(points: tuple[BasisPointV1, ...], **overrides: object) -> BasisPathV1:
    fields: dict[str, object] = {
        "path_id": "q08-test-path",
        "spot_symbol": "BNBUSDT",
        "perp_symbol": "BNBUSDT-PERP",
        "reference_kind": ReferenceKind.LAST_TRADE,
        "posture": EvidencePosture.SYNTHETIC,
        "max_staleness_ns": STALENESS,
        "completeness_start_ns": BASE_NS,
        "completeness_end_ns": BASE_NS + 100 * SECOND_NS,
        "points": points,
        "known_gaps": (),
    }
    fields.update(overrides)
    return BasisPathV1(**fields)  # type: ignore[arg-type]


class TestBasisPointContract:
    def test_basis_must_equal_the_leg_prices_exactly(self) -> None:
        with pytest.raises(ContractValueError, match="exactly"):
            BasisPointV1(
                event_time_ns=BASE_NS,
                ordinal=0,
                basis=make_ratio(1, 100),
                spot_aligned=10_000,
                perp_aligned=10_060,
            )
        point = _point(0, 0, 10_000, 10_060)
        assert point.basis == make_ratio(3, 500)
        assert point.as_mapping()["spotAligned"] == "10000"

    def test_type_and_bound_laws(self) -> None:
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            BasisPointV1(
                event_time_ns=BASE_NS,
                ordinal=0,
                basis=0.006,  # type: ignore[arg-type]
                spot_aligned=10_000,
                perp_aligned=10_060,
            )
        with pytest.raises(ContractValueError, match="spot_aligned"):
            BasisPointV1(
                event_time_ns=BASE_NS,
                ordinal=0,
                basis=make_ratio(0, 1),
                spot_aligned=0,
                perp_aligned=1,
            )


class TestBasisPathContract:
    def test_path_ordering_and_interval_laws(self) -> None:
        with pytest.raises(ContractValueError, match="time-ordered"):
            _path((_point(10, 0, 10_000, 10_060), _point(5, 1, 10_000, 10_060)))
        with pytest.raises(ContractValueError, match="strictly increase"):
            _path((_point(5, 1, 10_000, 10_060), _point(10, 1, 10_000, 10_060)))
        with pytest.raises(ContractValueError, match="inside the completeness"):
            _path((_point(101, 0, 10_000, 10_060),))
        with pytest.raises(ContractValueError, match="BasisPointV1"):
            _path(("point",))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="tuple"):
            _path([_point(5, 0, 10_000, 10_060)])  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="non-empty"):
            _path((), completeness_end_ns=BASE_NS)
        with pytest.raises(ContractValueError, match="ReferenceKind"):
            _path((), reference_kind="LAST_TRADE")
        with pytest.raises(ContractValueError, match="SYNTHETIC or REPLAY"):
            _path((), posture=EvidencePosture.LIVE)

    def test_gap_laws(self) -> None:
        gap = GapIntervalV1(start_ns=BASE_NS + 10 * SECOND_NS, end_ns=BASE_NS + 20 * SECOND_NS)
        path = _path((), known_gaps=(gap,))
        assert path.gap_intersecting(BASE_NS + 15 * SECOND_NS, BASE_NS + 16 * SECOND_NS)
        assert not path.gap_intersecting(BASE_NS + 20 * SECOND_NS, BASE_NS + 30 * SECOND_NS)
        with pytest.raises(ContractValueError, match="sorted and non-overlapping"):
            _path(
                (),
                known_gaps=(
                    gap,
                    GapIntervalV1(
                        start_ns=BASE_NS + 15 * SECOND_NS, end_ns=BASE_NS + 25 * SECOND_NS
                    ),
                ),
            )
        with pytest.raises(ContractValueError, match="inside the completeness"):
            _path(
                (),
                known_gaps=(
                    GapIntervalV1(
                        start_ns=BASE_NS + 90 * SECOND_NS,
                        end_ns=BASE_NS + 110 * SECOND_NS,
                    ),
                ),
            )
        with pytest.raises(ContractValueError, match="GapIntervalV1"):
            _path((), known_gaps=("gap",))
        with pytest.raises(ContractValueError, match="bounded"):
            _path((), known_gaps=[gap])

    def test_mapping_is_deterministic(self) -> None:
        path = _path((_point(5, 0, 10_000, 10_060),))
        mapping = path.as_mapping()
        assert mapping["referenceKind"] == "LAST_TRADE"
        assert mapping["spotSymbol"] == "BNBUSDT"


class TestBuildBasisPath:
    def test_samples_at_perp_times_with_fresh_spot_references(self) -> None:
        spot = _series("spot", "BNBUSDT", [(0, 10_000), (10, 10_100)])
        perp = _series("perp", "BNBUSDT-PERP", [(1, 10_060), (11, 10_130), (30, 10_150)])
        path = build_basis_path(
            path_id="q08-built",
            spot_series=spot,
            perp_series=perp,
            reference_kind=ReferenceKind.LAST_TRADE,
            max_staleness_ns=STALENESS,
        )
        # The third perp observation has no fresh spot reference and is omitted,
        # never zero-filled.
        assert len(path.points) == 2
        assert path.points[0].basis == make_ratio(10_060 - 10_000, 10_000)
        assert path.points[1].basis == make_ratio(10_130 - 10_100, 10_100)
        assert path.points[0].ordinal == 0
        assert path.points[1].ordinal == 1
        assert path.spot_symbol == "BNBUSDT"
        assert path.perp_symbol == "BNBUSDT-PERP"

    def test_leg_instruments_and_units_must_define_one_compatible_pair(self) -> None:
        spot = _series("spot", "BNBUSDT", [(0, 10_000)])
        incompatible_legs = (
            (
                _series(
                    "perp-same-instrument",
                    "BNBUSDT-PERP",
                    [(1, 10_060)],
                    instrument_id=spot.instrument.instrument_id,
                ),
                "distinct instruments",
            ),
            (
                _series(
                    "perp-cross-base",
                    "ETHUSDT-PERP",
                    [(1, 10_060)],
                    base_size_unit_id="ETH",
                ),
                "matching base-size units",
            ),
            (
                _series(
                    "perp-cross-quote",
                    "BNBUSDC-PERP",
                    [(1, 10_060)],
                    quote_price_unit_id="USDC",
                ),
                "matching quote-price units",
            ),
        )
        for perp, message in incompatible_legs:
            with pytest.raises(ContractValueError, match=message):
                build_basis_path(
                    path_id="q08-hostile-cross-instrument",
                    spot_series=spot,
                    perp_series=perp,
                    reference_kind=ReferenceKind.LAST_TRADE,
                    max_staleness_ns=STALENESS,
                )

    def test_reference_kind_must_match_the_evidence_kind(self) -> None:
        spot = _series("spot", "BNBUSDT", [(0, 10_000)])
        perp = _series("perp", "BNBUSDT-PERP", [(1, 10_060)])
        for claimed in (ReferenceKind.MARK, ReferenceKind.INDEX, ReferenceKind.MID):
            with pytest.raises(ContractValueError, match="cannot prove reference"):
                build_basis_path(
                    path_id="q08-built",
                    spot_series=spot,
                    perp_series=perp,
                    reference_kind=claimed,
                    max_staleness_ns=STALENESS,
                )
        mid_spot = _series("spot", "BNBUSDT", [(0, 10_000)], kind=SeriesKind.MID)
        mid_perp = _series("perp", "BNBUSDT-PERP", [(1, 10_060)], kind=SeriesKind.MID)
        path = build_basis_path(
            path_id="q08-built-mid",
            spot_series=mid_spot,
            perp_series=mid_perp,
            reference_kind=ReferenceKind.MID,
            max_staleness_ns=STALENESS,
        )
        assert path.reference_kind is ReferenceKind.MID

    def test_executable_quotes_are_rejected_as_indicative_legs(self) -> None:
        quotes = EvidenceSeriesV1(
            series_id="quotes",
            symbol="BNBUSDT",
            instrument=_market_identity("BNBUSDT"),
            kind=SeriesKind.EXECUTABLE_QUOTES,
            posture=EvidencePosture.SYNTHETIC,
            completeness_start_ns=BASE_NS,
            completeness_end_ns=BASE_NS + 100 * SECOND_NS,
            price_points=(),
            quote_points=(
                QuotePointV1(
                    event_time_ns=BASE_NS,
                    ordinal=0,
                    bid=_usdt(10_000),
                    ask=_usdt(10_002),
                ),
            ),
            known_gaps=(),
        )
        perp = _series("perp", "BNBUSDT-PERP", [(1, 10_060)])
        with pytest.raises(ContractValueError, match="never consume executable quotes"):
            build_basis_path(
                path_id="q08-built",
                spot_series=quotes,
                perp_series=perp,
                reference_kind=ReferenceKind.LAST_TRADE,
                max_staleness_ns=STALENESS,
            )

    def test_posture_and_overlap_laws(self) -> None:
        spot = _series("spot", "BNBUSDT", [(0, 10_000)], posture=EvidencePosture.REPLAY)
        perp = _series("perp", "BNBUSDT-PERP", [(1, 10_060)])
        with pytest.raises(ContractValueError, match="one honest posture"):
            build_basis_path(
                path_id="q08-built",
                spot_series=spot,
                perp_series=perp,
                reference_kind=ReferenceKind.LAST_TRADE,
                max_staleness_ns=STALENESS,
            )
        early = _series("spot", "BNBUSDT", [(0, 10_000)], end_offset_s=10)
        late = EvidenceSeriesV1(
            series_id="perp",
            symbol="BNBUSDT-PERP",
            instrument=_market_identity("BNBUSDT-PERP"),
            kind=SeriesKind.TRADE_MID_PROXY,
            posture=EvidencePosture.SYNTHETIC,
            completeness_start_ns=BASE_NS + 20 * SECOND_NS,
            completeness_end_ns=BASE_NS + 40 * SECOND_NS,
            price_points=(
                PricePointV1(
                    event_time_ns=BASE_NS + 21 * SECOND_NS,
                    ordinal=0,
                    price=_usdt(10_060),
                ),
            ),
            quote_points=(),
            known_gaps=(),
        )
        with pytest.raises(ContractValueError, match="no completeness overlap"):
            build_basis_path(
                path_id="q08-built",
                spot_series=early,
                perp_series=late,
                reference_kind=ReferenceKind.LAST_TRADE,
                max_staleness_ns=STALENESS,
            )
        with pytest.raises(ContractValueError, match="EvidenceSeriesV1"):
            build_basis_path(
                path_id="q08-built",
                spot_series=None,  # type: ignore[arg-type]
                perp_series=perp,
                reference_kind=ReferenceKind.LAST_TRADE,
                max_staleness_ns=STALENESS,
            )

    def test_gaps_from_both_legs_are_merged_and_clipped(self) -> None:
        spot = _series(
            "spot",
            "BNBUSDT",
            [(0, 10_000), (50, 10_100)],
            gaps=(
                GapIntervalV1(start_ns=BASE_NS + 10 * SECOND_NS, end_ns=BASE_NS + 20 * SECOND_NS),
                GapIntervalV1(start_ns=BASE_NS + 40 * SECOND_NS, end_ns=BASE_NS + 45 * SECOND_NS),
            ),
        )
        perp = _series(
            "perp",
            "BNBUSDT-PERP",
            [(1, 10_060), (51, 10_160)],
            gaps=(
                GapIntervalV1(start_ns=BASE_NS + 15 * SECOND_NS, end_ns=BASE_NS + 25 * SECOND_NS),
            ),
        )
        path = build_basis_path(
            path_id="q08-built",
            spot_series=spot,
            perp_series=perp,
            reference_kind=ReferenceKind.LAST_TRADE,
            max_staleness_ns=STALENESS,
        )
        assert path.known_gaps == (
            GapIntervalV1(start_ns=BASE_NS + 10 * SECOND_NS, end_ns=BASE_NS + 25 * SECOND_NS),
            GapIntervalV1(start_ns=BASE_NS + 40 * SECOND_NS, end_ns=BASE_NS + 45 * SECOND_NS),
        )


class TestLegAttribution:
    def test_contributions_sum_to_the_basis_delta_exactly(self) -> None:
        path = _path(
            (
                _point(0, 0, 10_000, 10_060),
                _point(2, 1, 10_020, 10_060),
                _point(4, 2, 10_020, 10_040),
                _point(6, 3, 10_030, 10_050),
            )
        )
        attributions = attribute_leg_changes(path)
        assert len(attributions) == 3
        for previous, current, attribution in zip(
            path.points, path.points[1:], attributions, strict=False
        ):
            delta = ratio_subtract(current.basis, previous.basis)
            assert ratio_compare(attribution.basis_delta, delta) == 0
            recombined = ratio_add(attribution.spot_contribution, attribution.perp_contribution)
            assert ratio_compare(recombined, delta) == 0

    def test_drivers_name_the_moving_leg(self) -> None:
        path = _path(
            (
                _point(0, 0, 10_000, 10_060),
                _point(2, 1, 10_020, 10_060),  # only the spot leg moved
                _point(4, 2, 10_020, 10_040),  # only the perp leg moved
                _point(6, 3, 10_020, 10_040),  # nothing moved
            )
        )
        drivers = [attribution.driver for attribution in attribute_leg_changes(path)]
        assert drivers == [LegDriver.SPOT_LEG, LegDriver.PERP_LEG, LegDriver.NONE]

    def test_both_equal_driver_exists(self) -> None:
        # Constructed so both contributions are exactly 1: the perp leg adds
        # (150-100)/50 and the spot leg adds 100*(100-50)/(50*100).
        path = _path(
            (
                _point(0, 0, 100, 100),
                _point(2, 1, 50, 150),
            )
        )
        attributions = attribute_leg_changes(path)
        assert attributions[0].driver is LegDriver.BOTH_EQUAL

    def test_attribution_contract_laws(self) -> None:
        with pytest.raises(ContractValueError, match="sum to the basis delta"):
            LegAttributionV1(
                from_time_ns=BASE_NS,
                to_time_ns=BASE_NS + SECOND_NS,
                basis_delta=make_ratio(1, 100),
                spot_contribution=make_ratio(1, 100),
                perp_contribution=make_ratio(1, 100),
                driver=LegDriver.SPOT_LEG,
            )
        with pytest.raises(ContractValueError, match="backwards"):
            LegAttributionV1(
                from_time_ns=BASE_NS + SECOND_NS,
                to_time_ns=BASE_NS,
                basis_delta=make_ratio(0, 1),
                spot_contribution=make_ratio(0, 1),
                perp_contribution=make_ratio(0, 1),
                driver=LegDriver.NONE,
            )
        with pytest.raises(ContractValueError, match="BasisPathV1"):
            attribute_leg_changes(None)  # type: ignore[arg-type]


class TestBasisBars:
    def test_bars_carry_quantized_basis_at_the_documented_alignment(self) -> None:
        path = _path(
            (
                _point(1, 0, 10_000, 10_060),
                _point(12, 1, 10_000, 10_040),
                _point(14, 2, 10_000, 10_020),
            )
        )
        bars = build_basis_bars(path, wall_width_ns=10 * SECOND_NS, anchor_ns=BASE_NS)
        assert len(bars.bars) == 10
        first = bars.bars[0]
        assert first.point_count == 1
        assert first.last_value_aligned == (
            basis_fixed_point(path.points[0]).mantissa * BASIS_ALIGNMENT
        )
        second = bars.bars[1]
        assert second.point_count == 2
        assert second.first_value_aligned == (
            basis_fixed_point(path.points[1]).mantissa * BASIS_ALIGNMENT
        )
        assert second.last_value_aligned == (
            basis_fixed_point(path.points[2]).mantissa * BASIS_ALIGNMENT
        )
        # Basis bars never carry volume.
        assert all(bar.volume_aligned_total is None for bar in bars.bars)
        # Empty bars are honest truth.
        assert bars.bars[2].point_count == 0
        assert bars.bars[2].first_value_aligned is None

    def test_gap_intersecting_bars_are_never_complete(self) -> None:
        path = _path(
            (_point(1, 0, 10_000, 10_060),),
            known_gaps=(
                GapIntervalV1(start_ns=BASE_NS + 15 * SECOND_NS, end_ns=BASE_NS + 16 * SECOND_NS),
            ),
        )
        bars = build_basis_bars(path, wall_width_ns=10 * SECOND_NS, anchor_ns=BASE_NS)
        assert bars.bars[0].complete
        assert not bars.bars[1].complete
        assert bars.bars[2].complete

    def test_anchor_and_bound_laws(self) -> None:
        path = _path((_point(1, 0, 10_000, 10_060),))
        with pytest.raises(ContractValueError, match="anchor"):
            build_basis_bars(path, wall_width_ns=10 * SECOND_NS, anchor_ns=BASE_NS + SECOND_NS)
        with pytest.raises(ContractValueError, match="bounded maximum"):
            build_basis_bars(path, wall_width_ns=1, anchor_ns=BASE_NS)
        with pytest.raises(ContractValueError, match="BasisPathV1"):
            build_basis_bars(None, wall_width_ns=SECOND_NS, anchor_ns=BASE_NS)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="BasisPointV1"):
            basis_fixed_point(None)  # type: ignore[arg-type]

    def test_quantization_rounds_half_even_once(self) -> None:
        point = _point(1, 0, 3, 4)
        # 1/3 quantized half-even at 10^-12.
        assert basis_fixed_point(point).mantissa == 333_333_333_333
