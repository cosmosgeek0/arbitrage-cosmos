from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.regime.contracts import (
    InputDisposition,
    ObservationSeriesV1,
    ObservationV1,
    OrdinalGuard,
    alarm_ordinals,
    disposition_from_quality,
    normalize_to_scale,
    require_fixed_point,
    run_series,
)
from quant_edge.regime.cusum import CusumConfigV1, TwoSidedCusum

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _observation(
    index: int,
    hundredths: int,
    quality: QualityState = QualityState.SYNTHETIC,
) -> ObservationV1:
    return ObservationV1(
        event_time_ns=BASE_NS + index * SECOND_NS,
        ordinal=index,
        value=FixedPointV1(hundredths * (FIXED_POINT_SCALE // 100)),
        quality=quality,
    )


def _series(points: tuple[ObservationV1, ...]) -> ObservationSeriesV1:
    return ObservationSeriesV1(
        series_id="series-1",
        symbol="BNBUSDT",
        posture=EvidencePosture.SYNTHETIC,
        points=points,
    )


class TestObservation:
    def test_valid_observation_maps_deterministically(self) -> None:
        observation = _observation(3, 1_000)
        assert observation.as_mapping() == {
            "eventTimeNs": str(BASE_NS + 3 * SECOND_NS),
            "ordinal": 3,
            "quality": "SYNTHETIC",
            "value": {"mantissa": str(10 * FIXED_POINT_SCALE), "scale": str(FIXED_POINT_SCALE)},
        }

    def test_rejects_bad_time_ordinal_value_and_quality(self) -> None:
        with pytest.raises(ContractValueError, match="event_time_ns"):
            ObservationV1(
                event_time_ns=1,
                ordinal=0,
                value=FixedPointV1(0),
                quality=QualityState.SYNTHETIC,
            )
        with pytest.raises(ContractValueError, match="ordinal"):
            ObservationV1(
                event_time_ns=BASE_NS,
                ordinal=-1,
                value=FixedPointV1(0),
                quality=QualityState.SYNTHETIC,
            )
        with pytest.raises(ContractValueError, match="value must be FixedPointV1"):
            ObservationV1(
                event_time_ns=BASE_NS,
                ordinal=0,
                value=1.0,  # type: ignore[arg-type]
                quality=QualityState.SYNTHETIC,
            )
        with pytest.raises(ContractValueError, match="quality must be QualityState"):
            ObservationV1(
                event_time_ns=BASE_NS,
                ordinal=0,
                value=FixedPointV1(0),
                quality="COMPLETE",  # type: ignore[arg-type]
            )

    def test_disposition_property_matches_quality_law(self) -> None:
        assert _observation(0, 1, QualityState.COMPLETE).disposition is InputDisposition.ELIGIBLE
        assert _observation(0, 1, QualityState.STALE).disposition is InputDisposition.SUPPRESS
        assert _observation(0, 1, QualityState.GAPPED).disposition is InputDisposition.RESET


class TestDispositionLaw:
    def test_every_quality_state_has_a_disposition(self) -> None:
        for quality in QualityState:
            assert disposition_from_quality(quality) in InputDisposition

    def test_gap_class_qualities_reset(self) -> None:
        for quality in (
            QualityState.PARTIAL,
            QualityState.GAPPED,
            QualityState.RECONSTRUCTING,
            QualityState.SAMPLED,
            QualityState.UNAVAILABLE,
            QualityState.UNKNOWN,
        ):
            assert disposition_from_quality(quality) is InputDisposition.RESET

    def test_rejects_non_quality_input(self) -> None:
        with pytest.raises(ContractValueError, match="quality must be QualityState"):
            disposition_from_quality("COMPLETE")  # type: ignore[arg-type]


class TestObservationSeries:
    def test_valid_series_round_trips(self) -> None:
        series = _series((_observation(0, 1_000), _observation(1, 1_001)))
        mapping = series.as_mapping()
        assert mapping["seriesId"] == "series-1"
        assert mapping["posture"] == "SYNTHETIC"
        points = mapping["points"]
        assert isinstance(points, list)
        assert len(points) == 2

    def test_rejects_bad_ids_and_posture(self) -> None:
        points = (_observation(0, 1_000),)
        with pytest.raises(ContractValueError, match="series_id"):
            ObservationSeriesV1(
                series_id="",
                symbol="BNBUSDT",
                posture=EvidencePosture.SYNTHETIC,
                points=points,
            )
        with pytest.raises(ContractValueError, match="symbol"):
            ObservationSeriesV1(
                series_id="series-1",
                symbol="",
                posture=EvidencePosture.SYNTHETIC,
                points=points,
            )
        with pytest.raises(ContractValueError, match="no live market evidence"):
            ObservationSeriesV1(
                series_id="series-1",
                symbol="BNBUSDT",
                posture=EvidencePosture.LIVE,
                points=points,
            )

    def test_rejects_empty_wrongly_typed_or_disordered_points(self) -> None:
        with pytest.raises(ContractValueError, match="points must be a tuple"):
            _series(())
        with pytest.raises(ContractValueError, match="points\\[0\\] must be ObservationV1"):
            _series((1,))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="time-ordered"):
            _series(
                (
                    _observation(1, 1_000),
                    ObservationV1(
                        event_time_ns=BASE_NS,
                        ordinal=2,
                        value=FixedPointV1(0),
                        quality=QualityState.SYNTHETIC,
                    ),
                )
            )
        with pytest.raises(ContractValueError, match="strictly increase"):
            _series(
                (
                    _observation(1, 1_000),
                    ObservationV1(
                        event_time_ns=BASE_NS + 2 * SECOND_NS,
                        ordinal=1,
                        value=FixedPointV1(0),
                        quality=QualityState.SYNTHETIC,
                    ),
                )
            )


class TestOrdinalGuard:
    def test_accepts_increasing_and_rejects_replay(self) -> None:
        guard = OrdinalGuard()
        guard.check(1, BASE_NS)
        guard.check(5, BASE_NS)
        with pytest.raises(ContractValueError, match="ordinal-ordered"):
            guard.check(5, BASE_NS + SECOND_NS)
        with pytest.raises(ContractValueError, match="event-time-ordered"):
            guard.check(6, BASE_NS - SECOND_NS)

    def test_rejects_invalid_ordinal(self) -> None:
        with pytest.raises(ContractValueError, match="ordinal"):
            OrdinalGuard().check(-1, BASE_NS)


class TestNormalizeToScale:
    def test_normalizes_exactly_to_target(self) -> None:
        result = normalize_to_scale((1, 1, 1))
        assert sum(result) == FIXED_POINT_SCALE
        assert max(result) - min(result) <= 1

    def test_ties_break_toward_lower_index(self) -> None:
        assert normalize_to_scale((1, 1, 1), target=4) == (2, 1, 1)

    def test_zero_weight_bins_stay_zero(self) -> None:
        assert normalize_to_scale((0, 3, 0, 1), target=4) == (0, 3, 0, 1)

    def test_rejects_empty_non_tuple_negative_and_zero_total(self) -> None:
        with pytest.raises(ContractValueError, match="weights must be a tuple"):
            normalize_to_scale(())
        with pytest.raises(ContractValueError, match="weights must be a tuple"):
            normalize_to_scale([1, 2])  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="weights\\[1\\]"):
            normalize_to_scale((1, -1))
        with pytest.raises(ContractValueError, match="positive total mass"):
            normalize_to_scale((0, 0))
        with pytest.raises(ContractValueError, match="target"):
            normalize_to_scale((1, 2), target=0)


class TestRunHelpers:
    def test_run_series_streams_every_point(self) -> None:
        config = CusumConfigV1(
            detector_id="cusum-1",
            reference=FixedPointV1(10 * FIXED_POINT_SCALE),
            warmup=0,
            slack_k=FixedPointV1(FIXED_POINT_SCALE // 20),
            threshold_h=FixedPointV1(FIXED_POINT_SCALE // 2),
        )
        series = _series((_observation(0, 1_000), _observation(1, 1_200)))
        steps = run_series(TwoSidedCusum(config), series)
        assert [step.ordinal for step in steps] == [0, 1]

    def test_run_series_rejects_non_series(self) -> None:
        config = CusumConfigV1(
            detector_id="cusum-1",
            reference=FixedPointV1(0),
            warmup=0,
            slack_k=FixedPointV1(0),
            threshold_h=FixedPointV1(1),
        )
        with pytest.raises(ContractValueError, match="series must be ObservationSeriesV1"):
            run_series(TwoSidedCusum(config), "series")  # type: ignore[arg-type]

    def test_alarm_ordinals_filters_alarms_and_rejects_non_tuple(self) -> None:
        config = CusumConfigV1(
            detector_id="cusum-1",
            reference=FixedPointV1(10 * FIXED_POINT_SCALE),
            warmup=0,
            slack_k=FixedPointV1(0),
            threshold_h=FixedPointV1(FIXED_POINT_SCALE),
        )
        series = _series((_observation(0, 1_000), _observation(1, 1_200)))
        steps = run_series(TwoSidedCusum(config), series)
        assert alarm_ordinals(steps) == (1,)
        with pytest.raises(ContractValueError, match="steps must be a tuple"):
            alarm_ordinals([])  # type: ignore[arg-type]


def test_require_fixed_point_accepts_and_rejects() -> None:
    value = FixedPointV1(5)
    assert require_fixed_point(value, field="value") is value
    with pytest.raises(ContractValueError, match="value must be FixedPointV1"):
        require_fixed_point(5, field="value")
