from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.domains import (
    BarDomain,
    BarSeriesV1,
    BarV1,
    EventTimeBarSpecV1,
    FeaturePointV1,
    FeatureSeriesV1,
    TradeCountBarSpecV1,
    VolumeBarSpecV1,
    WallTimeBarSpecV1,
    build_bars,
)
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    FP_ONE,
    FP_ZERO,
    MAX_FIXED_MANTISSA,
    FixedPointV1,
    fp_abs,
    fp_add,
    fp_compare,
    fp_div,
    fp_from_int,
    fp_from_ratio,
    fp_mean_of_two,
    fp_mul,
    fp_sub,
    fp_ulp_distance,
    round_half_even,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture, ExactScaledValueV1

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _scaled(coefficient: int, scale: int = 2, unit: str = "USDT") -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id=unit)


def _point(
    offset_s: int,
    coefficient: int,
    ordinal: int,
    *,
    volume: int | None = 5,
) -> FeaturePointV1:
    return FeaturePointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        value=_scaled(coefficient),
        volume=None if volume is None else _scaled(volume, scale=0, unit="BNB"),
    )


def _series(
    points: tuple[FeaturePointV1, ...],
    *,
    start_s: int = 0,
    end_s: int = 130,
) -> FeatureSeriesV1:
    return FeatureSeriesV1(
        series_id="series-1",
        symbol="BNBUSDT",
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS + start_s * SECOND_NS,
        completeness_end_ns=BASE_NS + end_s * SECOND_NS,
        points=points,
    )


class TestFixedPoint:
    def test_round_half_even_law(self) -> None:
        assert round_half_even(5, 2) == 2
        assert round_half_even(7, 2) == 4
        assert round_half_even(3, 2) == 2
        assert round_half_even(1, 3) == 0
        assert round_half_even(2, 3) == 1
        with pytest.raises(ContractValueError):
            round_half_even(1, 0)
        with pytest.raises(ContractValueError):
            round_half_even(1, -2)
        with pytest.raises(ContractValueError):
            round_half_even("1", 2)  # type: ignore[arg-type]

    def test_arithmetic_and_bounds(self) -> None:
        two = fp_from_int(2)
        three = fp_from_int(3)

        assert fp_add(two, three) == fp_from_int(5)
        assert fp_sub(two, three) == fp_from_int(-1)
        assert fp_mul(two, three) == fp_from_int(6)
        assert fp_div(three, two).mantissa == 15 * FIXED_POINT_SCALE // 10
        assert fp_abs(fp_from_int(-4)) == fp_from_int(4)
        assert fp_compare(two, three) == -1
        assert fp_compare(three, two) == 1
        assert fp_compare(two, two) == 0
        assert fp_mean_of_two(two, three).mantissa == 25 * FIXED_POINT_SCALE // 10
        assert fp_ulp_distance(two, three) == FIXED_POINT_SCALE
        assert FP_ZERO.is_zero
        assert FP_ONE.mantissa == FIXED_POINT_SCALE
        assert FP_ONE.as_mapping()["scale"] == str(FIXED_POINT_SCALE)
        with pytest.raises(ContractValueError):
            fp_div(two, FP_ZERO)
        with pytest.raises(ContractValueError):
            FixedPointV1(10**39)
        with pytest.raises(ContractValueError):
            fp_from_int("2")  # type: ignore[arg-type]

    def test_from_ratio_rounds_half_even(self) -> None:
        assert fp_from_ratio(make_ratio(1, 3)).mantissa == 333_333_333_333
        assert fp_from_ratio(make_ratio(2, 3)).mantissa == 666_666_666_667
        assert fp_from_ratio(make_ratio(-1, 2)).mantissa == -FIXED_POINT_SCALE // 2
        with pytest.raises(ContractValueError):
            fp_from_ratio("half")  # type: ignore[arg-type]

    def test_negative_rounding_symmetry(self) -> None:
        minus_third = fp_from_ratio(make_ratio(-1, 3))
        third = fp_from_ratio(make_ratio(1, 3))

        assert minus_third.mantissa == -third.mantissa
        assert fp_mul(fp_from_int(-1), third) == minus_third
        assert fp_div(fp_from_int(-1), fp_from_int(3)) == minus_third


class TestFeatureSeries:
    def test_valid_series_facts(self) -> None:
        series = _series((_point(1, 10_000, 1), _point(2, 10_100, 2)))

        assert series.volume_known
        assert series.points[0].value_aligned == 10_000 * 10**36
        assert series.points[0].volume_aligned == 5 * 10**38
        assert series.as_mapping()["symbol"] == "BNBUSDT"

    def test_unknown_volume_is_explicit_and_unmixed(self) -> None:
        unknown = _series((_point(1, 10_000, 1, volume=None),))
        assert not unknown.volume_known
        assert unknown.points[0].volume_aligned is None
        with pytest.raises(ContractValueError):
            _series((_point(1, 10_000, 1), _point(2, 10_100, 2, volume=None)))

    def test_series_shape_rejections(self) -> None:
        with pytest.raises(ContractValueError):
            _series(())
        with pytest.raises(ContractValueError):
            _series((None,) * 100_001)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _series(("point",))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _series((_point(1, 10_000, 1), "point"))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _series((_point(2, 10_000, 1), _point(1, 10_100, 2)))
        with pytest.raises(ContractValueError):
            _series((_point(1, 10_000, 2), _point(2, 10_100, 2)))
        with pytest.raises(ContractValueError):
            _series((_point(-5, 10_000, 1),))
        with pytest.raises(ContractValueError):
            _series((_point(500, 10_000, 1),))
        with pytest.raises(ContractValueError):
            _series((_point(1, 10_000, 1),), start_s=10, end_s=10)
        with pytest.raises(ContractValueError):
            FeatureSeriesV1(
                series_id="series-1",
                symbol="BNBUSDT",
                posture=EvidencePosture.LIVE,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS + SECOND_NS,
                points=(_point(0, 10_000, 1),),
            )
        with pytest.raises(ContractValueError):
            FeaturePointV1(
                event_time_ns=BASE_NS,
                ordinal=1,
                value=_scaled(0),
                volume=None,
            )
        with pytest.raises(ContractValueError):
            FeaturePointV1(
                event_time_ns=BASE_NS,
                ordinal=1,
                value=_scaled(1),
                volume=_scaled(-1, scale=0),
            )


class TestBarSpecs:
    def test_spec_contracts(self) -> None:
        wall = WallTimeBarSpecV1(wall_width_ns=10 * SECOND_NS, anchor_ns=BASE_NS)
        assert wall.domain is BarDomain.WALL_TIME
        assert wall.as_mapping()["domain"] == "WALL_TIME"
        assert EventTimeBarSpecV1().domain is BarDomain.EVENT_TIME
        assert EventTimeBarSpecV1().as_mapping() == {"domain": "EVENT_TIME"}
        assert TradeCountBarSpecV1(trades_per_bar=5).domain is BarDomain.TRADE_COUNT
        volume_spec = VolumeBarSpecV1(volume_threshold=_scaled(10, scale=0))
        assert volume_spec.domain is BarDomain.VOLUME
        assert volume_spec.as_mapping()["domain"] == "VOLUME"
        assert TradeCountBarSpecV1(trades_per_bar=5).as_mapping()["tradesPerBar"] == 5
        with pytest.raises(ContractValueError):
            WallTimeBarSpecV1(wall_width_ns=0, anchor_ns=BASE_NS)
        with pytest.raises(ContractValueError):
            TradeCountBarSpecV1(trades_per_bar=0)
        with pytest.raises(ContractValueError):
            VolumeBarSpecV1(volume_threshold=_scaled(0, scale=0))

    def test_bar_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            BarV1(
                index=0,
                start_ns=BASE_NS,
                end_ns=BASE_NS,
                point_count=0,
                first_value_aligned=None,
                last_value_aligned=None,
                volume_aligned_total=None,
                complete=True,
            )
        with pytest.raises(ContractValueError):
            BarV1(
                index=0,
                start_ns=BASE_NS,
                end_ns=BASE_NS + 1,
                point_count=0,
                first_value_aligned=1,
                last_value_aligned=None,
                volume_aligned_total=None,
                complete=True,
            )
        with pytest.raises(ContractValueError):
            BarV1(
                index=0,
                start_ns=BASE_NS,
                end_ns=BASE_NS + 1,
                point_count=0,
                first_value_aligned=None,
                last_value_aligned=None,
                volume_aligned_total=None,
                complete="yes",  # type: ignore[arg-type]
            )

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("first_value_aligned", True),
            ("first_value_aligned", -(MAX_FIXED_MANTISSA * 10**26) - 1),
            ("last_value_aligned", (MAX_FIXED_MANTISSA * 10**26) + 1),
            ("volume_aligned_total", -1),
            ("volume_aligned_total", (MAX_FIXED_MANTISSA * 10**26) + 1),
        ],
    )
    def test_bar_rejects_invalid_or_unbounded_numeric_facts(
        self,
        field: str,
        value: int,
    ) -> None:
        facts: dict[str, object] = {
            "index": 0,
            "start_ns": BASE_NS,
            "end_ns": BASE_NS + 1,
            "point_count": 1,
            "first_value_aligned": 1,
            "last_value_aligned": 1,
            "volume_aligned_total": 0,
            "complete": True,
        }
        facts[field] = value

        with pytest.raises(ContractValueError, match=field):
            BarV1(**facts)  # type: ignore[arg-type]

    def test_bar_accepts_bounded_signed_feature_values(self) -> None:
        bar = BarV1(
            index=0,
            start_ns=BASE_NS,
            end_ns=BASE_NS + 1,
            point_count=1,
            first_value_aligned=-1,
            last_value_aligned=0,
            volume_aligned_total=0,
            complete=True,
        )

        assert bar.first_value_aligned == -1
        assert bar.last_value_aligned == 0


class TestBarBuilding:
    def test_wall_bars_have_empty_bar_truth_and_partial_tail(self) -> None:
        series = _series(
            (_point(1, 10_000, 1), _point(21, 10_100, 2)),
            start_s=0,
            end_s=35,
        )
        bars = build_bars(
            series,
            WallTimeBarSpecV1(wall_width_ns=10 * SECOND_NS, anchor_ns=BASE_NS),
        )

        assert [bar.point_count for bar in bars.bars] == [1, 0, 1, 0]
        assert bars.bars[1].first_value_aligned is None
        assert [bar.complete for bar in bars.bars] == [True, True, True, False]
        assert bars.bars[0].start_ns == BASE_NS
        assert bars.bars[3].end_ns == BASE_NS + 40 * SECOND_NS

    def test_event_bars_are_one_per_observation(self) -> None:
        series = _series((_point(1, 10_000, 1), _point(2, 10_100, 2)))
        bars = build_bars(series, EventTimeBarSpecV1())

        assert len(bars.bars) == 2
        assert all(bar.point_count == 1 and bar.complete for bar in bars.bars)

    def test_trade_count_bars_close_on_count_with_partial_tail(self) -> None:
        series = _series(tuple(_point(i + 1, 10_000 + i, i + 1) for i in range(5)))
        bars = build_bars(series, TradeCountBarSpecV1(trades_per_bar=2))

        assert [bar.point_count for bar in bars.bars] == [2, 2, 1]
        assert [bar.complete for bar in bars.bars] == [True, True, False]

    def test_volume_bars_close_on_threshold(self) -> None:
        series = _series(
            (
                _point(1, 10_000, 1, volume=4),
                _point(2, 10_100, 2, volume=7),
                _point(3, 10_200, 3, volume=1),
            )
        )
        bars = build_bars(series, VolumeBarSpecV1(volume_threshold=_scaled(10, scale=0)))

        assert [bar.point_count for bar in bars.bars] == [2, 1]
        assert [bar.complete for bar in bars.bars] == [True, False]
        assert bars.bars[0].volume_aligned_total == 11 * 10**38

    def test_volume_bars_require_known_volume(self) -> None:
        series = _series((_point(1, 10_000, 1, volume=None),))
        with pytest.raises(ContractValueError):
            build_bars(series, VolumeBarSpecV1(volume_threshold=_scaled(10, scale=0)))

    def test_build_bars_contracts(self) -> None:
        series = _series((_point(1, 10_000, 1),))
        with pytest.raises(ContractValueError):
            build_bars("series", EventTimeBarSpecV1())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            build_bars(series, "spec")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            build_bars(
                series,
                WallTimeBarSpecV1(
                    wall_width_ns=10 * SECOND_NS,
                    anchor_ns=BASE_NS + SECOND_NS,
                ),
            )
        with pytest.raises(ContractValueError):
            build_bars(series, WallTimeBarSpecV1(wall_width_ns=1, anchor_ns=BASE_NS))

    def test_bar_series_contracts(self) -> None:
        series = _series((_point(1, 10_000, 1),))
        bars = build_bars(series, EventTimeBarSpecV1())
        with pytest.raises(ContractValueError):
            BarSeriesV1(spec="spec", bars=bars.bars)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            BarSeriesV1(spec=EventTimeBarSpecV1(), bars=("bar",))  # type: ignore[arg-type]
        shifted = BarV1(
            index=5,
            start_ns=bars.bars[0].start_ns,
            end_ns=bars.bars[0].end_ns,
            point_count=bars.bars[0].point_count,
            first_value_aligned=bars.bars[0].first_value_aligned,
            last_value_aligned=bars.bars[0].last_value_aligned,
            volume_aligned_total=bars.bars[0].volume_aligned_total,
            complete=True,
        )
        with pytest.raises(ContractValueError):
            BarSeriesV1(spec=EventTimeBarSpecV1(), bars=(shifted,))
        assert bars.as_mapping()["spec"] == {"domain": "EVENT_TIME"}


class TestCoverageEdges:
    def test_non_scaled_value_is_rejected(self) -> None:
        with pytest.raises(ContractValueError):
            FeaturePointV1(
                event_time_ns=BASE_NS,
                ordinal=1,
                value="100",  # type: ignore[arg-type]
                volume=None,
            )

    def test_bar_series_rejects_non_tuple_bars(self) -> None:
        with pytest.raises(ContractValueError):
            BarSeriesV1(spec=EventTimeBarSpecV1(), bars=[])  # type: ignore[arg-type]

    def test_wall_bars_report_unknown_volume_honestly(self) -> None:
        series = _series((_point(1, 10_000, 1, volume=None),), end_s=10)
        bars = build_bars(
            series,
            WallTimeBarSpecV1(wall_width_ns=10 * SECOND_NS, anchor_ns=BASE_NS),
        )

        assert bars.bars[0].point_count == 1
        assert bars.bars[0].volume_aligned_total is None
