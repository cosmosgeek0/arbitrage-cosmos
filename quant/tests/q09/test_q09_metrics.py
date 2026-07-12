from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import make_ratio
from quant_edge.regime.metrics import (
    AnomalyMeasurementV1,
    DetectionBudgetV1,
    DetectionReportV1,
    SegmentationReportV1,
    evaluate_anomaly_flags,
    evaluate_detection,
    evaluate_segmentation,
)


def _report(
    *,
    true_changes: tuple[int, ...] = (40, 120),
    alarms: tuple[int, ...] = (42, 44, 121, 190),
) -> DetectionReportV1:
    return evaluate_detection(
        detector_id="detector-1",
        series_id="series-1",
        series_length=200,
        detection_window=10,
        true_changes=true_changes,
        alarms=alarms,
    )


class TestEvaluateDetection:
    def test_buckets_and_delays_are_exact(self) -> None:
        report = _report()
        assert report.detected == (40, 120)
        assert report.delays == (2, 1)
        assert report.missed == ()
        assert report.false_alarms == (190,)
        assert report.redundant_alarms == (44,)
        # 200 bars minus two 11-bar detection windows.
        assert report.in_control_bars == 200 - 22
        assert report.false_alarm_rate == make_ratio(1, 178)
        assert report.mean_delay == make_ratio(3, 2)
        assert report.max_delay == 2
        assert report.detection_ratio == make_ratio(1, 1)

    def test_missed_changes_and_empty_alarms(self) -> None:
        report = _report(alarms=())
        assert report.detected == ()
        assert report.missed == (40, 120)
        assert report.mean_delay is None
        assert report.max_delay is None
        assert report.false_alarm_rate == make_ratio(0, 178)

    def test_no_true_changes_only_false_alarms(self) -> None:
        report = _report(true_changes=(), alarms=(5,))
        assert report.false_alarms == (5,)
        assert report.detection_ratio is None
        assert report.in_control_bars == 200

    def test_alarm_belongs_to_most_recent_change(self) -> None:
        report = evaluate_detection(
            detector_id="detector-1",
            series_id="series-1",
            series_length=100,
            detection_window=30,
            true_changes=(10, 20),
            alarms=(25,),
        )
        assert report.detected == (20,)
        assert report.missed == (10,)

    def test_window_clamps_at_series_end(self) -> None:
        report = evaluate_detection(
            detector_id="detector-1",
            series_id="series-1",
            series_length=20,
            detection_window=50,
            true_changes=(15,),
            alarms=(19,),
        )
        assert report.detected == (15,)
        assert report.in_control_bars == 15

    def test_mapping_round_trips(self) -> None:
        mapping = _report().as_mapping()
        assert mapping["detected"] == [40, 120]
        assert mapping["falseAlarmRate"] == {"denominator": "178", "numerator": "1"}

    def test_rejects_disordered_inputs(self) -> None:
        with pytest.raises(ContractValueError, match="strictly increase"):
            _report(alarms=(44, 42))
        with pytest.raises(ContractValueError, match="true_changes\\[0\\]"):
            _report(true_changes=(500,))


class TestDetectionReportContract:
    def test_partition_laws_are_enforced(self) -> None:
        base = _report()
        with pytest.raises(ContractValueError, match="partition the true changes"):
            DetectionReportV1(
                detector_id=base.detector_id,
                series_id=base.series_id,
                series_length=base.series_length,
                detection_window=base.detection_window,
                true_changes=base.true_changes,
                alarms=base.alarms,
                detected=(40,),
                delays=(2,),
                missed=(),
                false_alarms=base.false_alarms,
                redundant_alarms=base.redundant_alarms,
                in_control_bars=base.in_control_bars,
            )
        with pytest.raises(ContractValueError, match="partition into detections"):
            DetectionReportV1(
                detector_id=base.detector_id,
                series_id=base.series_id,
                series_length=base.series_length,
                detection_window=base.detection_window,
                true_changes=base.true_changes,
                alarms=base.alarms,
                detected=base.detected,
                delays=base.delays,
                missed=base.missed,
                false_alarms=(),
                redundant_alarms=base.redundant_alarms,
                in_control_bars=base.in_control_bars,
            )
        with pytest.raises(ContractValueError, match="align one-to-one"):
            DetectionReportV1(
                detector_id=base.detector_id,
                series_id=base.series_id,
                series_length=base.series_length,
                detection_window=base.detection_window,
                true_changes=base.true_changes,
                alarms=base.alarms,
                detected=base.detected,
                delays=(1,),
                missed=base.missed,
                false_alarms=base.false_alarms,
                redundant_alarms=base.redundant_alarms,
                in_control_bars=base.in_control_bars,
            )
        with pytest.raises(ContractValueError, match="delays\\[0\\]"):
            DetectionReportV1(
                detector_id=base.detector_id,
                series_id=base.series_id,
                series_length=base.series_length,
                detection_window=base.detection_window,
                true_changes=base.true_changes,
                alarms=base.alarms,
                detected=base.detected,
                delays=(99, 1),
                missed=base.missed,
                false_alarms=base.false_alarms,
                redundant_alarms=base.redundant_alarms,
                in_control_bars=base.in_control_bars,
            )
        with pytest.raises(ContractValueError, match="in_control_bars"):
            DetectionReportV1(
                detector_id=base.detector_id,
                series_id=base.series_id,
                series_length=base.series_length,
                detection_window=base.detection_window,
                true_changes=base.true_changes,
                alarms=base.alarms,
                detected=base.detected,
                delays=base.delays,
                missed=base.missed,
                false_alarms=base.false_alarms,
                redundant_alarms=base.redundant_alarms,
                in_control_bars=999,
            )


class TestDetectionBudget:
    def _budget(self) -> DetectionBudgetV1:
        return DetectionBudgetV1(
            budget_id="budget-1",
            max_false_alarm_rate=make_ratio(1, 100),
            max_mean_delay=make_ratio(5, 1),
            min_detection_ratio=make_ratio(9, 10),
        )

    def test_rejects_bad_fields(self) -> None:
        with pytest.raises(ContractValueError, match="budget_id"):
            DetectionBudgetV1(
                budget_id="",
                max_false_alarm_rate=make_ratio(1, 100),
                max_mean_delay=make_ratio(5, 1),
                min_detection_ratio=make_ratio(9, 10),
            )
        with pytest.raises(ContractValueError, match="max_mean_delay must be ExactRatioV1"):
            DetectionBudgetV1(
                budget_id="budget-1",
                max_false_alarm_rate=make_ratio(1, 100),
                max_mean_delay=5,  # type: ignore[arg-type]
                min_detection_ratio=make_ratio(9, 10),
            )
        with pytest.raises(ContractValueError, match="cannot be negative"):
            DetectionBudgetV1(
                budget_id="budget-1",
                max_false_alarm_rate=make_ratio(-1, 100),
                max_mean_delay=make_ratio(5, 1),
                min_detection_ratio=make_ratio(9, 10),
            )
        assert self._budget().as_mapping()["budgetId"] == "budget-1"

    def test_verdict_passes_good_report(self) -> None:
        passed, failures = self._budget().verdict(_report())
        assert passed
        assert failures == ()

    def test_verdict_reports_each_failure(self) -> None:
        tight = DetectionBudgetV1(
            budget_id="budget-tight",
            max_false_alarm_rate=make_ratio(1, 1_000),
            max_mean_delay=make_ratio(1, 1),
            min_detection_ratio=make_ratio(1, 1),
        )
        report = _report(alarms=(42, 190))
        passed, failures = tight.verdict(report)
        assert not passed
        assert "FALSE_ALARM_RATE_EXCEEDED" in failures
        assert "MEAN_DELAY_EXCEEDED" in failures
        assert "DETECTION_RATIO_BELOW_MINIMUM" in failures

    def test_verdict_fails_closed_on_unknowns(self) -> None:
        empty_series_report = evaluate_detection(
            detector_id="detector-1",
            series_id="series-1",
            series_length=10,
            detection_window=20,
            true_changes=(),
            alarms=(),
        )
        # The single change window covers everything: no in-control bars, no
        # changes, no delays -> every budget clause is unknown and fails closed.
        full_window_report = evaluate_detection(
            detector_id="detector-1",
            series_id="series-1",
            series_length=10,
            detection_window=20,
            true_changes=(0,),
            alarms=(),
        )
        passed, failures = self._budget().verdict(empty_series_report)
        assert not passed
        assert "MEAN_DELAY_UNKNOWN" in failures
        assert "DETECTION_RATIO_UNKNOWN" in failures
        passed, failures = self._budget().verdict(full_window_report)
        assert not passed
        assert "FALSE_ALARM_RATE_UNKNOWN" in failures

    def test_verdict_rejects_non_report(self) -> None:
        with pytest.raises(ContractValueError, match="report must be DetectionReportV1"):
            self._budget().verdict(None)  # type: ignore[arg-type]


class TestEvaluateSegmentation:
    def test_matches_within_slack_and_partitions(self) -> None:
        report = evaluate_segmentation(
            segmenter_id="pelt-1",
            series_id="series-1",
            true_boundaries=(80, 160),
            detected_boundaries=(82, 120),
            slack=4,
        )
        assert report.matched == ((80, 82),)
        assert report.missed == (160,)
        assert report.spurious == (120,)
        assert report.max_boundary_error == 2
        assert report.mean_boundary_error == make_ratio(2, 1)
        assert report.as_mapping()["matched"] == [[80, 82]]

    def test_empty_matches_yield_unknown_errors(self) -> None:
        report = evaluate_segmentation(
            segmenter_id="pelt-1",
            series_id="series-1",
            true_boundaries=(),
            detected_boundaries=(),
            slack=4,
        )
        assert report.max_boundary_error is None
        assert report.mean_boundary_error is None

    def test_nearest_detection_wins_one_to_one(self) -> None:
        report = evaluate_segmentation(
            segmenter_id="pelt-1",
            series_id="series-1",
            true_boundaries=(100,),
            detected_boundaries=(98, 101),
            slack=4,
        )
        assert report.matched == ((100, 101),)
        assert report.spurious == (98,)

    def test_contract_rejects_slack_violations_and_bad_partitions(self) -> None:
        with pytest.raises(ContractValueError, match="cannot exceed the slack"):
            SegmentationReportV1(
                segmenter_id="pelt-1",
                series_id="series-1",
                slack=1,
                true_boundaries=(80,),
                detected_boundaries=(90,),
                matched=((80, 90),),
                missed=(),
                spurious=(),
            )
        with pytest.raises(ContractValueError, match="partition the true boundaries"):
            SegmentationReportV1(
                segmenter_id="pelt-1",
                series_id="series-1",
                slack=4,
                true_boundaries=(80, 160),
                detected_boundaries=(82,),
                matched=((80, 82),),
                missed=(),
                spurious=(),
            )
        with pytest.raises(ContractValueError, match="partition detections"):
            SegmentationReportV1(
                segmenter_id="pelt-1",
                series_id="series-1",
                slack=4,
                true_boundaries=(80,),
                detected_boundaries=(82, 120),
                matched=((80, 82),),
                missed=(),
                spurious=(),
            )
        with pytest.raises(ContractValueError, match="matched must contain"):
            SegmentationReportV1(
                segmenter_id="pelt-1",
                series_id="series-1",
                slack=4,
                true_boundaries=(80,),
                detected_boundaries=(82,),
                matched=(80,),  # type: ignore[arg-type]
                missed=(),
                spurious=(),
            )
        with pytest.raises(ContractValueError, match="matched must be a tuple"):
            SegmentationReportV1(
                segmenter_id="pelt-1",
                series_id="series-1",
                slack=4,
                true_boundaries=(80,),
                detected_boundaries=(82,),
                matched=[(80, 82)],  # type: ignore[arg-type]
                missed=(),
                spurious=(),
            )


class TestEvaluateAnomalyFlags:
    def test_partitions_hits_misses_and_false_flags(self) -> None:
        measurement = evaluate_anomaly_flags(
            scorer_id="scorer-1",
            series_id="series-1",
            series_length=100,
            injected=(10, 50, 90),
            flagged=(10, 30, 90),
        )
        assert measurement.hits == (10, 90)
        assert measurement.missed == (50,)
        assert measurement.false_flags == (30,)
        assert measurement.hit_ratio == make_ratio(2, 3)
        assert measurement.false_flag_ratio == make_ratio(1, 97)
        assert measurement.as_mapping()["hits"] == [10, 90]

    def test_unknown_ratios_when_nothing_injected_or_all_injected(self) -> None:
        nothing = evaluate_anomaly_flags(
            scorer_id="scorer-1",
            series_id="series-1",
            series_length=10,
            injected=(),
            flagged=(),
        )
        assert nothing.hit_ratio is None
        everything = evaluate_anomaly_flags(
            scorer_id="scorer-1",
            series_id="series-1",
            series_length=2,
            injected=(0, 1),
            flagged=(0,),
        )
        assert everything.false_flag_ratio is None

    def test_contract_rejects_bad_partitions(self) -> None:
        with pytest.raises(ContractValueError, match="partition the injected"):
            AnomalyMeasurementV1(
                scorer_id="scorer-1",
                series_id="series-1",
                series_length=100,
                injected=(10,),
                flagged=(10,),
                hits=(10,),
                missed=(10,),
                false_flags=(),
            )
        with pytest.raises(ContractValueError, match="partition the flags"):
            AnomalyMeasurementV1(
                scorer_id="scorer-1",
                series_id="series-1",
                series_length=100,
                injected=(10,),
                flagged=(10, 20),
                hits=(10,),
                missed=(),
                false_flags=(),
            )
