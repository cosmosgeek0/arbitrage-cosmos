from __future__ import annotations

import pytest

from quant_edge.derivatives.liquidations import (
    LiquidationEventV1,
    LiquidationEvidenceV1,
    LiquidationSide,
    observed_liquidation_count,
    observed_liquidation_notional,
)
from quant_edge.derivatives.openinterest import (
    OpenInterestEvidenceV1,
    OpenInterestObservationV1,
    PriceOiQuadrant,
    oi_acceleration,
    oi_change,
    oi_level,
    price_oi_quadrant,
)
from quant_edge.derivatives.sampled import (
    SampledFeatureValueV1,
    SampledValueStatus,
    derive_sampled_value,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FP_ONE
from quant_edge.labels.series import EvidenceSeriesV1, GapIntervalV1, PricePointV1, SeriesKind
from quant_edge.lake.contracts import (
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
    QualityState,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
MINUTE_NS = 60 * SECOND_NS

PRICE_INSTRUMENT = InstrumentIdentityV1(
    instrument_id="test-binance-spot-BNBUSDT",
    base_size_unit_id="BNB",
    quote_price_unit_id="USDT",
)


def _oi(offset_min: int, ordinal: int, amount: int) -> OpenInterestObservationV1:
    return OpenInterestObservationV1(
        event_time_ns=BASE_NS + offset_min * MINUTE_NS,
        ordinal=ordinal,
        open_interest=ExactScaledValueV1(coefficient=amount, scale=0, unit_id="CONTRACTS"),
    )


def _oi_evidence(
    observations: tuple[OpenInterestObservationV1, ...],
    quality: QualityState = QualityState.SAMPLED,
) -> OpenInterestEvidenceV1:
    return OpenInterestEvidenceV1(
        symbol="BNBUSDT-PERP",
        posture=EvidencePosture.SYNTHETIC,
        quality=quality,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + 100 * MINUTE_NS,
        observations=observations,
    )


THREE_OI = (_oi(10, 0, 1_000), _oi(20, 1, 1_200), _oi(30, 2, 1_150))


def _price_series(prices: list[tuple[int, int]]) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id="q08-oi-price",
        symbol="BNBUSDT",
        instrument=PRICE_INSTRUMENT,
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + 100 * MINUTE_NS,
        price_points=tuple(
            PricePointV1(
                event_time_ns=BASE_NS + offset_min * MINUTE_NS,
                ordinal=index,
                price=ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT"),
            )
            for index, (offset_min, price) in enumerate(prices)
        ),
        quote_points=(),
        known_gaps=(),
    )


class TestSampledValueLaw:
    def test_quality_vocabulary_is_confined(self) -> None:
        with pytest.raises(ContractValueError, match="cannot"):
            _oi_evidence(THREE_OI, quality=QualityState.COMPLETE)
        for quality in (QualityState.SAMPLED, QualityState.PARTIAL, QualityState.UNKNOWN):
            assert _oi_evidence(THREE_OI, quality=quality).quality is quality

    def test_value_exists_exactly_when_available_sampled(self) -> None:
        with pytest.raises(ContractValueError, match="AVAILABLE_SAMPLED"):
            SampledFeatureValueV1(
                feature_id="oi_level:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS,
                sampling=QualityState.SAMPLED,
                status=SampledValueStatus.UNKNOWN,
                value=FP_ONE,
            )
        with pytest.raises(ContractValueError, match="newer than as-of"):
            SampledFeatureValueV1(
                feature_id="oi_level:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS + SECOND_NS,
                sampling=QualityState.SAMPLED,
                status=SampledValueStatus.UNKNOWN,
                value=None,
            )

    def test_unknown_sampling_never_carries_a_value(self) -> None:
        observed = derive_sampled_value(
            feature_id="oi_level:v1",
            as_of_ns=BASE_NS + MINUTE_NS,
            input_last_event_ns=BASE_NS,
            freshness_bound_ns=10 * MINUTE_NS,
            sampling=QualityState.UNKNOWN,
            computed=FP_ONE,
        )
        assert observed.status is SampledValueStatus.UNKNOWN
        assert observed.value is None

    def test_staleness_degrades_and_never_upgrades(self) -> None:
        observed = derive_sampled_value(
            feature_id="oi_level:v1",
            as_of_ns=BASE_NS + 20 * MINUTE_NS,
            input_last_event_ns=BASE_NS,
            freshness_bound_ns=MINUTE_NS,
            sampling=QualityState.SAMPLED,
            computed=FP_ONE,
        )
        assert observed.status is SampledValueStatus.STALE
        assert observed.value is None


class TestOpenInterestFeatures:
    def test_level_change_acceleration_exact_values(self) -> None:
        as_of = BASE_NS + 31 * MINUTE_NS
        staleness = 15 * MINUTE_NS
        level = oi_level(_oi_evidence(THREE_OI), as_of_ns=as_of, max_staleness_ns=staleness)
        assert level.status is SampledValueStatus.AVAILABLE_SAMPLED
        assert level.sampling is QualityState.SAMPLED
        assert level.value is not None
        assert level.value.mantissa == 1_150 * 10**12
        change = oi_change(_oi_evidence(THREE_OI), as_of_ns=as_of, max_staleness_ns=staleness)
        assert change.value is not None
        assert change.value.mantissa == -50 * 10**12
        acceleration = oi_acceleration(
            _oi_evidence(THREE_OI), as_of_ns=as_of, max_staleness_ns=staleness
        )
        assert acceleration.value is not None
        assert acceleration.value.mantissa == -250 * 10**12

    def test_missing_history_is_unknown_never_zero(self) -> None:
        as_of = BASE_NS + 31 * MINUTE_NS
        staleness = 15 * MINUTE_NS
        empty = oi_level(_oi_evidence(()), as_of_ns=as_of, max_staleness_ns=staleness)
        assert empty.status is SampledValueStatus.UNKNOWN
        assert empty.value is None
        single = oi_change(_oi_evidence(THREE_OI[:1]), as_of_ns=as_of, max_staleness_ns=staleness)
        assert single.status is SampledValueStatus.UNKNOWN
        pair = oi_acceleration(
            _oi_evidence(THREE_OI[:2]), as_of_ns=as_of, max_staleness_ns=staleness
        )
        assert pair.status is SampledValueStatus.UNKNOWN

    def test_stale_observations_stay_stale(self) -> None:
        observed = oi_level(
            _oi_evidence(THREE_OI),
            as_of_ns=BASE_NS + 90 * MINUTE_NS,
            max_staleness_ns=15 * MINUTE_NS,
        )
        assert observed.status is SampledValueStatus.STALE

    def test_contract_laws(self) -> None:
        with pytest.raises(ContractValueError, match="OpenInterestEvidenceV1"):
            oi_level(None, as_of_ns=BASE_NS, max_staleness_ns=MINUTE_NS)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="cannot be negative"):
            _oi(10, 0, -1)
        with pytest.raises(ContractValueError, match="must be ExactScaledValueV1"):
            OpenInterestObservationV1(event_time_ns=BASE_NS, ordinal=0, open_interest=1_000)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="time-ordered"):
            _oi_evidence((_oi(20, 0, 1_000), _oi(10, 1, 1_000)))
        with pytest.raises(ContractValueError, match="strictly increase"):
            _oi_evidence((_oi(10, 1, 1_000), _oi(20, 1, 1_000)))
        with pytest.raises(ContractValueError, match="inside the completeness"):
            _oi_evidence((_oi(101, 0, 1_000),))
        with pytest.raises(ContractValueError, match="bounded tuple"):
            _oi_evidence(list(THREE_OI))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="OpenInterestObservationV1"):
            _oi_evidence(("oi",))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="SYNTHETIC or REPLAY"):
            OpenInterestEvidenceV1(
                symbol="BNBUSDT-PERP",
                posture=EvidencePosture.LIVE,
                quality=QualityState.SAMPLED,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS + MINUTE_NS,
                observations=(),
            )
        with pytest.raises(ContractValueError, match="non-empty"):
            OpenInterestEvidenceV1(
                symbol="BNBUSDT-PERP",
                posture=EvidencePosture.SYNTHETIC,
                quality=QualityState.SAMPLED,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS,
                observations=(),
            )
        assert _oi_evidence(THREE_OI).as_mapping()["quality"] == "SAMPLED"


class TestPriceOiQuadrant:
    def test_all_four_quadrants(self) -> None:
        window = {
            "window_start_ns": BASE_NS + 10 * MINUTE_NS,
            "window_end_ns": BASE_NS + 30 * MINUTE_NS,
        }
        staleness = 30 * MINUTE_NS
        rising_oi = _oi_evidence((_oi(10, 0, 1_000), _oi(30, 1, 1_200)))
        falling_oi = _oi_evidence((_oi(10, 0, 1_200), _oi(30, 1, 1_000)))
        rising_price = _price_series([(10, 10_000), (30, 10_100)])
        falling_price = _price_series([(10, 10_100), (30, 10_000)])
        cases = [
            (rising_price, rising_oi, PriceOiQuadrant.RISING_PRICE_RISING_OI),
            (rising_price, falling_oi, PriceOiQuadrant.RISING_PRICE_FALLING_OI),
            (falling_price, rising_oi, PriceOiQuadrant.FALLING_PRICE_RISING_OI),
            (falling_price, falling_oi, PriceOiQuadrant.FALLING_PRICE_FALLING_OI),
        ]
        for price_series, oi_evidence, expected in cases:
            observed = price_oi_quadrant(
                price_series=price_series,
                oi_evidence=oi_evidence,
                max_staleness_ns=staleness,
                **window,
            )
            assert observed is expected

    def test_flat_deltas_are_flat_not_invented(self) -> None:
        flat_price = _price_series([(10, 10_000), (30, 10_000)])
        rising_oi = _oi_evidence((_oi(10, 0, 1_000), _oi(30, 1, 1_200)))
        observed = price_oi_quadrant(
            price_series=flat_price,
            oi_evidence=rising_oi,
            window_start_ns=BASE_NS + 10 * MINUTE_NS,
            window_end_ns=BASE_NS + 30 * MINUTE_NS,
            max_staleness_ns=30 * MINUTE_NS,
        )
        assert observed is PriceOiQuadrant.FLAT

    def test_missing_or_stale_legs_are_unknown(self) -> None:
        window = {
            "window_start_ns": BASE_NS + 10 * MINUTE_NS,
            "window_end_ns": BASE_NS + 30 * MINUTE_NS,
        }
        price = _price_series([(10, 10_000), (30, 10_100)])
        # No OI observation before the window start.
        late_oi = _oi_evidence((_oi(29, 0, 1_000), _oi(30, 1, 1_200)))
        assert (
            price_oi_quadrant(
                price_series=price,
                oi_evidence=late_oi,
                max_staleness_ns=30 * MINUTE_NS,
                **window,
            )
            is PriceOiQuadrant.UNKNOWN
        )
        # Price evidence starting after the window start is equally unknown.
        late_price = _price_series([(29, 10_000), (30, 10_100)])
        assert (
            price_oi_quadrant(
                price_series=late_price,
                oi_evidence=_oi_evidence(THREE_OI),
                max_staleness_ns=30 * MINUTE_NS,
                **window,
            )
            is PriceOiQuadrant.UNKNOWN
        )
        # A stale price at the window end is unknown, never carried forward.
        stale_price = _price_series([(10, 10_000), (11, 10_100)])
        assert (
            price_oi_quadrant(
                price_series=stale_price,
                oi_evidence=_oi_evidence(THREE_OI),
                max_staleness_ns=5 * MINUTE_NS,
                **window,
            )
            is PriceOiQuadrant.UNKNOWN
        )
        # Unknown sampling quality poisons the quadrant.
        assert (
            price_oi_quadrant(
                price_series=price,
                oi_evidence=_oi_evidence(THREE_OI, quality=QualityState.UNKNOWN),
                max_staleness_ns=30 * MINUTE_NS,
                **window,
            )
            is PriceOiQuadrant.UNKNOWN
        )

    def test_gapped_price_evidence_is_unknown(self) -> None:
        series = _price_series([(10, 10_000), (30, 10_100)])
        gapped = EvidenceSeriesV1(
            series_id=series.series_id,
            symbol=series.symbol,
            instrument=series.instrument,
            kind=series.kind,
            posture=series.posture,
            completeness_start_ns=series.completeness_start_ns,
            completeness_end_ns=series.completeness_end_ns,
            price_points=series.price_points,
            quote_points=(),
            known_gaps=(
                GapIntervalV1(
                    start_ns=BASE_NS + 15 * MINUTE_NS,
                    end_ns=BASE_NS + 16 * MINUTE_NS,
                ),
            ),
        )
        observed = price_oi_quadrant(
            price_series=gapped,
            oi_evidence=_oi_evidence(THREE_OI),
            window_start_ns=BASE_NS + 10 * MINUTE_NS,
            window_end_ns=BASE_NS + 30 * MINUTE_NS,
            max_staleness_ns=30 * MINUTE_NS,
        )
        assert observed is PriceOiQuadrant.UNKNOWN

    def test_window_and_type_laws(self) -> None:
        price = _price_series([(10, 10_000), (30, 10_100)])
        with pytest.raises(ContractValueError, match="non-empty"):
            price_oi_quadrant(
                price_series=price,
                oi_evidence=_oi_evidence(THREE_OI),
                window_start_ns=BASE_NS + 30 * MINUTE_NS,
                window_end_ns=BASE_NS + 30 * MINUTE_NS,
                max_staleness_ns=MINUTE_NS,
            )
        with pytest.raises(ContractValueError, match="EvidenceSeriesV1"):
            price_oi_quadrant(
                price_series=None,  # type: ignore[arg-type]
                oi_evidence=_oi_evidence(THREE_OI),
                window_start_ns=BASE_NS,
                window_end_ns=BASE_NS + MINUTE_NS,
                max_staleness_ns=MINUTE_NS,
            )
        with pytest.raises(ContractValueError, match="OpenInterestEvidenceV1"):
            price_oi_quadrant(
                price_series=price,
                oi_evidence=None,  # type: ignore[arg-type]
                window_start_ns=BASE_NS,
                window_end_ns=BASE_NS + MINUTE_NS,
                max_staleness_ns=MINUTE_NS,
            )


def _liquidation(
    offset_s: int,
    ordinal: int,
    side: LiquidationSide,
    price: int | None,
    quantity: int | None,
) -> LiquidationEventV1:
    return LiquidationEventV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        side=side,
        price=(
            None
            if price is None
            else ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT")
        ),
        base_quantity=(
            None
            if quantity is None
            else ExactScaledValueV1(coefficient=quantity, scale=0, unit_id="BNB")
        ),
    )


def _liq_evidence(
    events: tuple[LiquidationEventV1, ...],
    quality: QualityState = QualityState.SAMPLED,
) -> LiquidationEvidenceV1:
    return LiquidationEvidenceV1(
        symbol="BNBUSDT-PERP",
        posture=EvidencePosture.SYNTHETIC,
        quality=quality,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + 120 * SECOND_NS,
        events=events,
    )


LIQUIDATIONS = (
    _liquidation(10, 0, LiquidationSide.LONG, 10_000, 3),
    _liquidation(20, 1, LiquidationSide.SHORT, 10_050, 2),
    _liquidation(30, 2, LiquidationSide.LONG, None, None),
)


class TestLiquidations:
    def test_quality_is_structurally_confined_to_sampled_or_partial(self) -> None:
        for quality in (QualityState.COMPLETE, QualityState.UNKNOWN, QualityState.STALE):
            with pytest.raises(ContractValueError, match="cannot prove completeness"):
                _liq_evidence(LIQUIDATIONS, quality=quality)
        assert _liq_evidence(LIQUIDATIONS, quality=QualityState.PARTIAL).quality is (
            QualityState.PARTIAL
        )

    def test_observed_count_is_sampled_truth(self) -> None:
        observed = observed_liquidation_count(
            _liq_evidence(LIQUIDATIONS),
            window_start_ns=BASE_NS,
            window_end_ns=BASE_NS + 60 * SECOND_NS,
        )
        assert observed.status is SampledValueStatus.AVAILABLE_SAMPLED
        assert observed.sampling is QualityState.SAMPLED
        assert observed.value is not None
        assert observed.value.mantissa == 3 * 10**12

    def test_side_filter(self) -> None:
        observed = observed_liquidation_count(
            _liq_evidence(LIQUIDATIONS),
            window_start_ns=BASE_NS,
            window_end_ns=BASE_NS + 60 * SECOND_NS,
            side=LiquidationSide.SHORT,
        )
        assert observed.value is not None
        assert observed.value.mantissa == 1 * 10**12
        with pytest.raises(ContractValueError, match="LiquidationSide"):
            observed_liquidation_count(
                _liq_evidence(LIQUIDATIONS),
                window_start_ns=BASE_NS,
                window_end_ns=BASE_NS + 60 * SECOND_NS,
                side="LONG",  # type: ignore[arg-type]
            )

    def test_known_notional_is_exact(self) -> None:
        observed = observed_liquidation_notional(
            _liq_evidence(LIQUIDATIONS),
            window_start_ns=BASE_NS,
            window_end_ns=BASE_NS + 25 * SECOND_NS,
        )
        assert observed.status is SampledValueStatus.AVAILABLE_SAMPLED
        assert observed.value is not None
        # 100.00 * 3 + 100.50 * 2 = 501 USDT exactly.
        assert observed.value.mantissa == 501 * 10**12

    def test_unknown_notional_makes_the_sum_unknown_never_zero(self) -> None:
        observed = observed_liquidation_notional(
            _liq_evidence(LIQUIDATIONS),
            window_start_ns=BASE_NS,
            window_end_ns=BASE_NS + 60 * SECOND_NS,
        )
        assert observed.status is SampledValueStatus.UNKNOWN
        assert observed.value is None

    def test_zero_observed_events_is_a_lower_bound_count(self) -> None:
        observed = observed_liquidation_count(
            _liq_evidence(LIQUIDATIONS),
            window_start_ns=BASE_NS + 100 * SECOND_NS,
            window_end_ns=BASE_NS + 110 * SECOND_NS,
        )
        assert observed.status is SampledValueStatus.AVAILABLE_SAMPLED
        assert observed.value is not None
        assert observed.value.is_zero

    def test_window_and_contract_laws(self) -> None:
        evidence = _liq_evidence(LIQUIDATIONS)
        with pytest.raises(ContractValueError, match="non-empty"):
            observed_liquidation_count(evidence, window_start_ns=BASE_NS, window_end_ns=BASE_NS)
        with pytest.raises(ContractValueError, match="inside the completeness"):
            observed_liquidation_count(
                evidence,
                window_start_ns=BASE_NS,
                window_end_ns=BASE_NS + 200 * SECOND_NS,
            )
        with pytest.raises(ContractValueError, match="LiquidationEvidenceV1"):
            observed_liquidation_count(
                None,  # type: ignore[arg-type]
                window_start_ns=BASE_NS,
                window_end_ns=BASE_NS + SECOND_NS,
            )
        with pytest.raises(ContractValueError, match="LiquidationSide"):
            _liquidation(10, 0, "LONG", 10_000, 3)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="cannot be negative"):
            _liquidation(10, 0, LiquidationSide.LONG, -1, 3)
        with pytest.raises(ContractValueError, match="or None"):
            LiquidationEventV1(
                event_time_ns=BASE_NS,
                ordinal=0,
                side=LiquidationSide.LONG,
                price=100.0,  # type: ignore[arg-type]
                base_quantity=None,
            )
        with pytest.raises(ContractValueError, match="time-ordered"):
            _liq_evidence(
                (
                    _liquidation(20, 0, LiquidationSide.LONG, None, None),
                    _liquidation(10, 1, LiquidationSide.LONG, None, None),
                )
            )
        with pytest.raises(ContractValueError, match="strictly increase"):
            _liq_evidence(
                (
                    _liquidation(10, 1, LiquidationSide.LONG, None, None),
                    _liquidation(20, 1, LiquidationSide.LONG, None, None),
                )
            )
        with pytest.raises(ContractValueError, match="inside the completeness"):
            _liq_evidence((_liquidation(121, 0, LiquidationSide.LONG, None, None),))
        with pytest.raises(ContractValueError, match="bounded tuple"):
            _liq_evidence(list(LIQUIDATIONS))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="LiquidationEventV1"):
            _liq_evidence(("event",))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="SYNTHETIC or REPLAY"):
            LiquidationEvidenceV1(
                symbol="BNBUSDT-PERP",
                posture=EvidencePosture.LIVE,
                quality=QualityState.SAMPLED,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS + SECOND_NS,
                events=(),
            )
        with pytest.raises(ContractValueError, match="non-empty"):
            LiquidationEvidenceV1(
                symbol="BNBUSDT-PERP",
                posture=EvidencePosture.SYNTHETIC,
                quality=QualityState.SAMPLED,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS,
                events=(),
            )
        mapping = evidence.as_mapping()
        assert mapping["quality"] == "SAMPLED"
        events = mapping["events"]
        assert isinstance(events, list)
        assert events[2]["price"] is None

    def test_notional_aligned_requires_both_facts(self) -> None:
        event = _liquidation(10, 0, LiquidationSide.LONG, 10_000, None)
        assert event.notional_aligned is None
        known = _liquidation(10, 0, LiquidationSide.LONG, 10_000, 3)
        assert known.notional_aligned is not None
