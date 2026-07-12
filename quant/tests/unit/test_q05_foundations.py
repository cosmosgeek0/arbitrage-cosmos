from __future__ import annotations

import pytest

from quant_edge.bootstrap.atlas import PointInTimeInstrumentV1
from quant_edge.errors import ContractValueError
from quant_edge.labels.identity import (
    SampleIdentityV1,
    VersionSetV1,
    make_sample_identity,
    with_cost_version,
)
from quant_edge.labels.rational import (
    ExactRatioV1,
    make_ratio,
    price_return,
    price_spread_ratio,
    ratio_add,
    ratio_compare,
    ratio_subtract,
    scaled_to_aligned,
)
from quant_edge.labels.series import (
    EvidenceSeriesV1,
    GapIntervalV1,
    PricePointV1,
    QuotePointV1,
    SeriesKind,
)
from quant_edge.lake.contracts import EvidencePosture, ExactScaledValueV1

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _scaled(coefficient: int, scale: int = 2) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id="USDT")


def _price_point(offset_s: int, coefficient: int, ordinal: int) -> PricePointV1:
    return PricePointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        price=_scaled(coefficient),
    )


def _series(
    points: tuple[PricePointV1, ...],
    *,
    start_s: int = -120,
    end_s: int = 7_200,
    gaps: tuple[GapIntervalV1, ...] = (),
    kind: SeriesKind = SeriesKind.TRADE_MID_PROXY,
    posture: EvidencePosture = EvidencePosture.SYNTHETIC,
) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id="series-1",
        symbol="BNBUSDT",
        kind=kind,
        posture=posture,
        completeness_start_ns=BASE_NS + start_s * SECOND_NS,
        completeness_end_ns=BASE_NS + end_s * SECOND_NS,
        price_points=points,
        quote_points=(),
        known_gaps=gaps,
    )


class TestExactRatio:
    def test_make_ratio_reduces_and_normalizes_sign(self) -> None:
        assert make_ratio(2, 4) == ExactRatioV1(numerator=1, denominator=2)
        assert make_ratio(1, -2) == ExactRatioV1(numerator=-1, denominator=2)
        assert make_ratio(-6, -4) == ExactRatioV1(numerator=3, denominator=2)
        assert make_ratio(0, 7).is_zero
        assert make_ratio(-1, 8).is_negative

    def test_make_ratio_rejects_invalid_inputs(self) -> None:
        with pytest.raises(ContractValueError):
            make_ratio(True, 2)
        with pytest.raises(ContractValueError):
            make_ratio(1, 0)
        with pytest.raises(ContractValueError):
            make_ratio(1, "2")  # type: ignore[arg-type]

    def test_direct_construction_requires_reduced_form_and_bounds(self) -> None:
        with pytest.raises(ContractValueError):
            ExactRatioV1(numerator=2, denominator=4)
        with pytest.raises(ContractValueError):
            ExactRatioV1(numerator=1, denominator=0)
        with pytest.raises(ContractValueError):
            ExactRatioV1(numerator=10**61, denominator=1)
        assert ExactRatioV1(numerator=1, denominator=2).as_mapping() == {
            "denominator": "2",
            "numerator": "1",
        }

    def test_arithmetic_and_comparison_are_exact(self) -> None:
        third = make_ratio(1, 3)
        sixth = make_ratio(1, 6)

        assert ratio_add(third, sixth) == make_ratio(1, 2)
        assert ratio_subtract(third, sixth) == make_ratio(1, 6)
        assert ratio_compare(third, sixth) == 1
        assert ratio_compare(sixth, third) == -1
        assert ratio_compare(third, make_ratio(2, 6)) == 0

    def test_price_return_is_exact_across_scales(self) -> None:
        reference = _scaled(10_000)  # 100.00
        future = ExactScaledValueV1(coefficient=1_010, scale=1, unit_id="USDT")  # 101.0

        assert price_return(reference, future) == make_ratio(1, 100)
        assert scaled_to_aligned(reference) == 10_000 * 10**36

    def test_price_return_rejects_unlawful_prices(self) -> None:
        with pytest.raises(ContractValueError):
            price_return("100", _scaled(1))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            price_return(_scaled(0), _scaled(1))
        with pytest.raises(ContractValueError):
            price_return(_scaled(100), _scaled(-1))

    def test_spread_ratio(self) -> None:
        assert price_spread_ratio(_scaled(9_900), _scaled(10_100)) == make_ratio(2, 100)
        with pytest.raises(ContractValueError):
            price_spread_ratio(_scaled(0), _scaled(1))
        with pytest.raises(ContractValueError):
            price_spread_ratio(_scaled(100), _scaled(0))
        with pytest.raises(ContractValueError):
            price_spread_ratio(_scaled(101), _scaled(100))


class TestEvidenceSeries:
    def test_valid_price_series_and_lookups(self) -> None:
        points = (
            _price_point(-10, 10_000, 1),
            _price_point(1, 10_100, 2),
            _price_point(30, 9_900, 3),
        )
        series = _series(points)

        assert series.last_price_at_or_before(BASE_NS) == points[0]
        assert series.last_price_at_or_before(BASE_NS + 2 * SECOND_NS) == points[1]
        assert series.last_price_at_or_before(BASE_NS - 60 * SECOND_NS) is None
        assert not series.gap_intersecting(BASE_NS, BASE_NS + SECOND_NS)
        assert series.evidence_digest() == _series(points).evidence_digest()

    def test_pre_cutoff_digest_ignores_future_evidence(self) -> None:
        early = (_price_point(-10, 10_000, 1), _price_point(1, 10_100, 2))
        extended = (*early, _price_point(50, 12_000, 3))
        cutoff = BASE_NS + 2 * SECOND_NS

        assert _series(early).pre_cutoff_digest(cutoff) == _series(extended).pre_cutoff_digest(
            cutoff
        )
        assert _series(early).evidence_digest() != _series(extended).evidence_digest()
        with pytest.raises(ContractValueError):
            _series(early).pre_cutoff_digest(-5)

    def test_gap_contracts(self) -> None:
        gap = GapIntervalV1(start_ns=BASE_NS + 5 * SECOND_NS, end_ns=BASE_NS + 6 * SECOND_NS)

        assert gap.intersects(BASE_NS, BASE_NS + 10 * SECOND_NS)
        assert not gap.intersects(BASE_NS + 6 * SECOND_NS, BASE_NS + 7 * SECOND_NS)
        with pytest.raises(ContractValueError):
            GapIntervalV1(start_ns=BASE_NS, end_ns=BASE_NS)
        series = _series((_price_point(0, 10_000, 1),), gaps=(gap,))
        assert series.gap_intersecting(BASE_NS + 5 * SECOND_NS, BASE_NS + 7 * SECOND_NS)

    def test_series_shape_rejections(self) -> None:
        points = (_price_point(0, 10_000, 1),)
        quote = QuotePointV1(
            event_time_ns=BASE_NS,
            ordinal=1,
            bid=_scaled(9_900),
            ask=_scaled(10_100),
        )
        with pytest.raises(ContractValueError):
            _series(points, kind="TRADE")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _series((), kind=SeriesKind.TRADE_MID_PROXY)
        with pytest.raises(ContractValueError):
            _series(points, start_s=100, end_s=100)
        with pytest.raises(ContractValueError):
            EvidenceSeriesV1(
                series_id="series-1",
                symbol="BNBUSDT",
                kind=SeriesKind.EXECUTABLE_QUOTES,
                posture=EvidencePosture.SYNTHETIC,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS + SECOND_NS,
                price_points=points,
                quote_points=(quote,),
                known_gaps=(),
            )
        with pytest.raises(ContractValueError):
            EvidenceSeriesV1(
                series_id="series-1",
                symbol="BNBUSDT",
                kind=SeriesKind.MID,
                posture=EvidencePosture.SYNTHETIC,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS + SECOND_NS,
                price_points=(),
                quote_points=(quote,),
                known_gaps=(),
            )
        with pytest.raises(ContractValueError):
            _series(points, posture=EvidencePosture.LIVE)

    def test_point_ordering_and_bounds(self) -> None:
        with pytest.raises(ContractValueError):
            _series((_price_point(1, 10_000, 2), _price_point(0, 10_000, 3)))
        with pytest.raises(ContractValueError):
            _series((_price_point(0, 10_000, 2), _price_point(1, 10_000, 2)))
        with pytest.raises(ContractValueError):
            _series((_price_point(0, 10_000, 1), "point"))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _series((None,) * 100_001)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _series((_price_point(-500, 10_000, 1),))
        with pytest.raises(ContractValueError):
            _series((_price_point(8_000, 10_000, 1),))

    def test_gap_ordering_and_bounds(self) -> None:
        gap_a = GapIntervalV1(start_ns=BASE_NS, end_ns=BASE_NS + SECOND_NS)
        gap_b = GapIntervalV1(start_ns=BASE_NS, end_ns=BASE_NS + 2 * SECOND_NS)
        points = (_price_point(0, 10_000, 1),)
        with pytest.raises(ContractValueError):
            _series(points, gaps=(gap_b, gap_a))
        with pytest.raises(ContractValueError):
            _series(points, gaps=[gap_a])  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _series(points, gaps=(gap_a, "gap"))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _series(
                points,
                gaps=(
                    GapIntervalV1(
                        start_ns=BASE_NS - 500 * SECOND_NS,
                        end_ns=BASE_NS - 400 * SECOND_NS,
                    ),
                ),
            )

    def test_quote_series_and_point_contracts(self) -> None:
        quote = QuotePointV1(
            event_time_ns=BASE_NS,
            ordinal=1,
            bid=_scaled(9_900),
            ask=_scaled(10_100),
        )
        series = EvidenceSeriesV1(
            series_id="series-q",
            symbol="BNBUSDT",
            kind=SeriesKind.EXECUTABLE_QUOTES,
            posture=EvidencePosture.SYNTHETIC,
            completeness_start_ns=BASE_NS - SECOND_NS,
            completeness_end_ns=BASE_NS + SECOND_NS,
            price_points=(),
            quote_points=(quote,),
            known_gaps=(),
        )

        assert series.last_quote_at_or_before(BASE_NS) == quote
        assert series.last_quote_at_or_before(BASE_NS - SECOND_NS) is None
        with pytest.raises(ContractValueError):
            QuotePointV1(
                event_time_ns=BASE_NS,
                ordinal=1,
                bid=_scaled(10_100),
                ask=_scaled(9_900),
            )
        with pytest.raises(ContractValueError):
            QuotePointV1(event_time_ns=BASE_NS, ordinal=-1, bid=_scaled(1), ask=_scaled(2))
        with pytest.raises(ContractValueError):
            PricePointV1(event_time_ns=5, ordinal=1, price=_scaled(1))
        with pytest.raises(ContractValueError):
            PricePointV1(event_time_ns=BASE_NS, ordinal=1, price="100")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            PricePointV1(event_time_ns=BASE_NS, ordinal=1, price=_scaled(0))


def _instrument() -> PointInTimeInstrumentV1:
    return PointInTimeInstrumentV1(
        venue="binance",
        product="spot",
        symbol="BNBUSDT",
        base_asset_id="UNKNOWN_BASE",
        quote_asset_id="UNKNOWN_QUOTE",
        instrument_version="archive-v1",
        observed_at_ns=BASE_NS,
        missing_identity_fields=("base_asset_id", "quote_asset_id"),
    )


def _versions() -> VersionSetV1:
    return VersionSetV1(
        dataset_version="ds-v1",
        feature_version="feat-v1",
        label_definition_version="label-v1",
        cost_assumption_version="cost-v1",
        execution_assumption_version="exec-v1",
    )


def _sample(**overrides: object) -> SampleIdentityV1:
    fields: dict[str, object] = {
        "event_id": "event-1",
        "cohort_id": "cohort-1",
        "instrument": _instrument(),
        "feature_lookback_start_ns": BASE_NS - 60 * SECOND_NS,
        "feature_cutoff_ns": BASE_NS,
        "label_start_ns": BASE_NS,
        "label_end_ns": BASE_NS + 3_600 * SECOND_NS,
        "source_completeness_start_ns": BASE_NS - 120 * SECOND_NS,
        "source_completeness_end_ns": BASE_NS + 7_200 * SECOND_NS,
        "versions": _versions(),
    }
    fields.update(overrides)
    return make_sample_identity(**fields)  # type: ignore[arg-type]


class TestSampleIdentity:
    def test_identity_is_deterministic_and_content_derived(self) -> None:
        first = _sample()
        second = _sample()

        assert first == second
        assert first.sample_id.startswith("q05sample:")
        assert first.horizon_ns == 3_600 * SECOND_NS
        assert first.as_mapping()["sampleId"] == first.sample_id

    def test_version_axes_change_identity(self) -> None:
        base = _sample()
        recosted = with_cost_version(base, "cost-v2")

        assert recosted.sample_id != base.sample_id
        assert recosted.versions.cost_assumption_version == "cost-v2"
        assert recosted.label_start_ns == base.label_start_ns
        with pytest.raises(ContractValueError):
            with_cost_version("sample", "cost-v2")  # type: ignore[arg-type]

    def test_temporal_law_rejections(self) -> None:
        with pytest.raises(ContractValueError):
            _sample(feature_lookback_start_ns=BASE_NS)
        with pytest.raises(ContractValueError):
            _sample(feature_cutoff_ns=BASE_NS + SECOND_NS)
        with pytest.raises(ContractValueError):
            _sample(label_end_ns=BASE_NS)
        with pytest.raises(ContractValueError):
            _sample(source_completeness_start_ns=BASE_NS - 30 * SECOND_NS)
        with pytest.raises(ContractValueError):
            _sample(source_completeness_end_ns=BASE_NS + 60 * SECOND_NS)

    def test_forged_fields_are_rejected(self) -> None:
        sample = _sample()
        with pytest.raises(ContractValueError):
            SampleIdentityV1(
                sample_id=sample.sample_id,
                event_id="event-2",
                cohort_id=sample.cohort_id,
                instrument=sample.instrument,
                feature_lookback_start_ns=sample.feature_lookback_start_ns,
                feature_cutoff_ns=sample.feature_cutoff_ns,
                label_start_ns=sample.label_start_ns,
                label_end_ns=sample.label_end_ns,
                horizon_ns=sample.horizon_ns,
                source_completeness_start_ns=sample.source_completeness_start_ns,
                source_completeness_end_ns=sample.source_completeness_end_ns,
                versions=sample.versions,
            )
        with pytest.raises(ContractValueError):
            SampleIdentityV1(
                sample_id=sample.sample_id,
                event_id=sample.event_id,
                cohort_id=sample.cohort_id,
                instrument=sample.instrument,
                feature_lookback_start_ns=sample.feature_lookback_start_ns,
                feature_cutoff_ns=sample.feature_cutoff_ns,
                label_start_ns=sample.label_start_ns,
                label_end_ns=sample.label_end_ns,
                horizon_ns=sample.horizon_ns - 1,
                source_completeness_start_ns=sample.source_completeness_start_ns,
                source_completeness_end_ns=sample.source_completeness_end_ns,
                versions=sample.versions,
            )
        with pytest.raises(ContractValueError):
            _sample(instrument="instrument")
        with pytest.raises(ContractValueError):
            _sample(versions="versions")
        with pytest.raises(ContractValueError):
            _sample(event_id="")

    def test_version_set_contract(self) -> None:
        with pytest.raises(ContractValueError):
            VersionSetV1(
                dataset_version="",
                feature_version="feat-v1",
                label_definition_version="label-v1",
                cost_assumption_version="cost-v1",
                execution_assumption_version="exec-v1",
            )
        assert _versions().as_mapping()["costAssumptionVersion"] == "cost-v1"
