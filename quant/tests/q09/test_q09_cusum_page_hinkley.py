from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import QualityState
from quant_edge.regime.contracts import AlarmDirection, ObservationV1, StepStatus
from quant_edge.regime.cusum import CusumConfigV1, CusumStepV1, TwoSidedCusum
from quant_edge.regime.page_hinkley import (
    PageHinkleyConfigV1,
    PageHinkleyStepV1,
    TwoSidedPageHinkley,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
HUNDREDTH = FIXED_POINT_SCALE // 100


def _observation(
    index: int,
    hundredths: int,
    quality: QualityState = QualityState.SYNTHETIC,
) -> ObservationV1:
    return ObservationV1(
        event_time_ns=BASE_NS + index * SECOND_NS,
        ordinal=index,
        value=FixedPointV1(hundredths * HUNDREDTH),
        quality=quality,
    )


def _cusum(
    *,
    reference: int | None = 1_000,
    warmup: int = 0,
    slack_hundredths: int = 5,
    threshold_hundredths: int = 50,
) -> TwoSidedCusum:
    return TwoSidedCusum(
        CusumConfigV1(
            detector_id="cusum-1",
            reference=None if reference is None else FixedPointV1(reference * HUNDREDTH),
            warmup=warmup,
            slack_k=FixedPointV1(slack_hundredths * HUNDREDTH),
            threshold_h=FixedPointV1(threshold_hundredths * HUNDREDTH),
        )
    )


def _page_hinkley(
    *,
    delta_hundredths: int = 5,
    lambda_hundredths: int = 50,
    warmup: int = 4,
) -> TwoSidedPageHinkley:
    return TwoSidedPageHinkley(
        PageHinkleyConfigV1(
            detector_id="ph-1",
            delta=FixedPointV1(delta_hundredths * HUNDREDTH),
            threshold_lambda=FixedPointV1(lambda_hundredths * HUNDREDTH),
            warmup=warmup,
        )
    )


class TestCusumConfig:
    def test_fixed_reference_forbids_warmup(self) -> None:
        with pytest.raises(ContractValueError, match="forbids a warmup"):
            CusumConfigV1(
                detector_id="cusum-1",
                reference=FixedPointV1(0),
                warmup=4,
                slack_k=FixedPointV1(0),
                threshold_h=FixedPointV1(1),
            )

    def test_estimated_reference_requires_warmup(self) -> None:
        with pytest.raises(ContractValueError, match="warmup"):
            CusumConfigV1(
                detector_id="cusum-1",
                reference=None,
                warmup=1,
                slack_k=FixedPointV1(0),
                threshold_h=FixedPointV1(1),
            )

    def test_rejects_bad_id_slack_threshold_and_reference_type(self) -> None:
        with pytest.raises(ContractValueError, match="detector_id"):
            CusumConfigV1(
                detector_id="",
                reference=FixedPointV1(0),
                warmup=0,
                slack_k=FixedPointV1(0),
                threshold_h=FixedPointV1(1),
            )
        with pytest.raises(ContractValueError, match="reference must be FixedPointV1"):
            CusumConfigV1(
                detector_id="cusum-1",
                reference=0,  # type: ignore[arg-type]
                warmup=0,
                slack_k=FixedPointV1(0),
                threshold_h=FixedPointV1(1),
            )
        with pytest.raises(ContractValueError, match="slack_k cannot be negative"):
            CusumConfigV1(
                detector_id="cusum-1",
                reference=FixedPointV1(0),
                warmup=0,
                slack_k=FixedPointV1(-1),
                threshold_h=FixedPointV1(1),
            )
        with pytest.raises(ContractValueError, match="threshold_h must be strictly positive"):
            CusumConfigV1(
                detector_id="cusum-1",
                reference=FixedPointV1(0),
                warmup=0,
                slack_k=FixedPointV1(0),
                threshold_h=FixedPointV1(0),
            )

    def test_mapping_carries_every_field(self) -> None:
        config = CusumConfigV1(
            detector_id="cusum-1",
            reference=None,
            warmup=4,
            slack_k=FixedPointV1(1),
            threshold_h=FixedPointV1(2),
        )
        mapping = config.as_mapping()
        assert mapping["reference"] is None
        assert mapping["warmup"] == 4


class TestCusumStepContract:
    def test_alarm_requires_ok_and_direction(self) -> None:
        with pytest.raises(ContractValueError, match="only an OK step may alarm"):
            CusumStepV1(
                detector_id="cusum-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.WARMUP,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=True,
                direction=AlarmDirection.UP,
            )
        with pytest.raises(ContractValueError, match="direction exists exactly"):
            CusumStepV1(
                detector_id="cusum-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=True,
                direction=None,
            )
        with pytest.raises(ContractValueError, match="direction exists exactly"):
            CusumStepV1(
                detector_id="cusum-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=False,
                direction=AlarmDirection.UP,
            )

    def test_rejects_negative_statistics_bad_status_and_bad_alarm(self) -> None:
        with pytest.raises(ContractValueError, match="statistic_up cannot be negative"):
            CusumStepV1(
                detector_id="cusum-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                statistic_up=FixedPointV1(-1),
                statistic_down=FixedPointV1(0),
                alarm=False,
                direction=None,
            )
        with pytest.raises(ContractValueError, match="status must be StepStatus"):
            CusumStepV1(
                detector_id="cusum-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status="OK",  # type: ignore[arg-type]
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=False,
                direction=None,
            )
        with pytest.raises(ContractValueError, match="alarm must be boolean"):
            CusumStepV1(
                detector_id="cusum-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=1,  # type: ignore[arg-type]
                direction=None,
            )

    def test_step_mapping_is_deterministic(self) -> None:
        step = CusumStepV1(
            detector_id="cusum-1",
            ordinal=2,
            event_time_ns=BASE_NS,
            status=StepStatus.OK,
            statistic_up=FixedPointV1(3),
            statistic_down=FixedPointV1(4),
            alarm=False,
            direction=None,
        )
        mapping = step.as_mapping()
        assert mapping["direction"] is None
        assert mapping["statisticUp"] == {"mantissa": "3", "scale": str(FIXED_POINT_SCALE)}


class TestCusumBehavior:
    def test_rejects_non_config_and_non_observation(self) -> None:
        with pytest.raises(ContractValueError, match="config must be CusumConfigV1"):
            TwoSidedCusum("config")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="observation must be ObservationV1"):
            _cusum().update("observation")  # type: ignore[arg-type]

    def test_rejects_out_of_order_ordinals(self) -> None:
        detector = _cusum()
        detector.update(_observation(1, 1_000))
        with pytest.raises(ContractValueError, match="ordinal-ordered"):
            detector.update(_observation(1, 1_000))

    def test_in_control_series_never_alarms(self) -> None:
        detector = _cusum()
        for index in range(50):
            noise = ((index * 37) % 21 - 10) // 10
            step = detector.update(_observation(index, 1_000 + noise))
            assert step.status is StepStatus.OK
            assert not step.alarm

    def test_upward_shift_alarms_up_and_restarts(self) -> None:
        detector = _cusum()
        for index in range(10):
            detector.update(_observation(index, 1_000))
        step = detector.update(_observation(10, 1_100))
        assert step.alarm
        assert step.direction is AlarmDirection.UP
        follow_up = detector.update(_observation(11, 1_000))
        assert follow_up.statistic_up.is_zero
        assert follow_up.statistic_down.is_zero

    def test_downward_shift_alarms_down(self) -> None:
        detector = _cusum()
        step = detector.update(_observation(0, 900))
        assert step.alarm
        assert step.direction is AlarmDirection.DOWN

    def test_both_statistics_can_be_positive_without_alarm(self) -> None:
        # Slack zero and a huge threshold let both sides accumulate: the clamp at
        # zero lets a partial retracement leave mass on both sides.
        detector = _cusum(slack_hundredths=0, threshold_hundredths=10_000)
        detector.update(_observation(0, 1_200))
        step = detector.update(_observation(1, 900))
        assert step.statistic_up.mantissa > 0
        assert step.statistic_down.mantissa > 0
        assert not step.alarm

    def test_warmup_estimates_reference_and_reports_warmup_steps(self) -> None:
        detector = _cusum(reference=None, warmup=4)
        for index in range(4):
            step = detector.update(_observation(index, 1_000 + (index % 2)))
            assert step.status is StepStatus.WARMUP
            assert not step.alarm
        step = detector.update(_observation(4, 1_200))
        assert step.status is StepStatus.OK
        assert step.alarm

    def test_alarm_restarts_warmup_for_estimated_reference(self) -> None:
        detector = _cusum(reference=None, warmup=2)
        detector.update(_observation(0, 1_000))
        detector.update(_observation(1, 1_000))
        alarm_step = detector.update(_observation(2, 1_200))
        assert alarm_step.alarm
        # Post-alarm points re-estimate the reference at the new level.
        assert detector.update(_observation(3, 1_200)).status is StepStatus.WARMUP
        assert detector.update(_observation(4, 1_200)).status is StepStatus.WARMUP
        settled = detector.update(_observation(5, 1_200))
        assert settled.status is StepStatus.OK
        assert not settled.alarm

    def test_stale_input_suppresses_without_state_change(self) -> None:
        detector = _cusum()
        detector.update(_observation(0, 1_010))
        before = detector.update(_observation(1, 1_010))
        assert before.statistic_up.mantissa > 0
        suppressed = detector.update(_observation(2, 1_200, QualityState.STALE))
        assert suppressed.status is StepStatus.SUPPRESSED
        assert suppressed.statistic_up.mantissa == before.statistic_up.mantissa
        assert not suppressed.alarm

    def test_gap_input_resets_statistics_and_estimated_reference(self) -> None:
        detector = _cusum(reference=None, warmup=2)
        detector.update(_observation(0, 1_000))
        detector.update(_observation(1, 1_000))
        detector.update(_observation(2, 1_040))
        reset = detector.update(_observation(3, 1_040, QualityState.GAPPED))
        assert reset.status is StepStatus.RESET
        assert reset.statistic_up.is_zero
        # The reference is re-estimated from scratch after the gap.
        assert detector.update(_observation(4, 1_200)).status is StepStatus.WARMUP

    def test_fixed_reference_survives_gap_reset(self) -> None:
        detector = _cusum()
        detector.update(_observation(0, 1_000))
        detector.update(_observation(1, 1_000, QualityState.GAPPED))
        step = detector.update(_observation(2, 1_100))
        assert step.status is StepStatus.OK
        assert step.alarm


class TestPageHinkleyConfig:
    def test_rejects_bad_fields(self) -> None:
        with pytest.raises(ContractValueError, match="detector_id"):
            PageHinkleyConfigV1(
                detector_id="",
                delta=FixedPointV1(0),
                threshold_lambda=FixedPointV1(1),
                warmup=1,
            )
        with pytest.raises(ContractValueError, match="delta cannot be negative"):
            PageHinkleyConfigV1(
                detector_id="ph-1",
                delta=FixedPointV1(-1),
                threshold_lambda=FixedPointV1(1),
                warmup=1,
            )
        with pytest.raises(ContractValueError, match="threshold_lambda"):
            PageHinkleyConfigV1(
                detector_id="ph-1",
                delta=FixedPointV1(0),
                threshold_lambda=FixedPointV1(0),
                warmup=1,
            )
        with pytest.raises(ContractValueError, match="warmup"):
            PageHinkleyConfigV1(
                detector_id="ph-1",
                delta=FixedPointV1(0),
                threshold_lambda=FixedPointV1(1),
                warmup=0,
            )

    def test_mapping_round_trips(self) -> None:
        config = PageHinkleyConfigV1(
            detector_id="ph-1",
            delta=FixedPointV1(1),
            threshold_lambda=FixedPointV1(2),
            warmup=3,
        )
        assert config.as_mapping()["warmup"] == 3


class TestPageHinkleyStepContract:
    def test_alarm_and_direction_laws(self) -> None:
        with pytest.raises(ContractValueError, match="only an OK step may alarm"):
            PageHinkleyStepV1(
                detector_id="ph-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.RESET,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=True,
                direction=AlarmDirection.DOWN,
            )
        with pytest.raises(ContractValueError, match="direction exists exactly"):
            PageHinkleyStepV1(
                detector_id="ph-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=False,
                direction=AlarmDirection.DOWN,
            )
        with pytest.raises(ContractValueError, match="statistic_down cannot be negative"):
            PageHinkleyStepV1(
                detector_id="ph-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(-1),
                alarm=False,
                direction=None,
            )
        with pytest.raises(ContractValueError, match="status must be StepStatus"):
            PageHinkleyStepV1(
                detector_id="ph-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=None,  # type: ignore[arg-type]
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=False,
                direction=None,
            )
        with pytest.raises(ContractValueError, match="alarm must be boolean"):
            PageHinkleyStepV1(
                detector_id="ph-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=0,  # type: ignore[arg-type]
                direction=None,
            )

    def test_mapping_is_deterministic(self) -> None:
        step = PageHinkleyStepV1(
            detector_id="ph-1",
            ordinal=1,
            event_time_ns=BASE_NS,
            status=StepStatus.WARMUP,
            statistic_up=FixedPointV1(0),
            statistic_down=FixedPointV1(0),
            alarm=False,
            direction=None,
        )
        assert step.as_mapping()["status"] == "WARMUP"


class TestPageHinkleyBehavior:
    def test_rejects_non_config_and_non_observation(self) -> None:
        with pytest.raises(ContractValueError, match="config must be PageHinkleyConfigV1"):
            TwoSidedPageHinkley(None)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="observation must be ObservationV1"):
            _page_hinkley().update(None)  # type: ignore[arg-type]

    def test_rejects_out_of_order_ordinals(self) -> None:
        detector = _page_hinkley()
        detector.update(_observation(2, 1_000))
        with pytest.raises(ContractValueError, match="ordinal-ordered"):
            detector.update(_observation(2, 1_000))

    def test_warmup_suppresses_alarm_authority(self) -> None:
        detector = _page_hinkley(warmup=8)
        for index in range(8):
            step = detector.update(_observation(index, 1_000 + 100 * (index % 2)))
            assert step.status is StepStatus.WARMUP
            assert not step.alarm

    def test_in_control_series_never_alarms(self) -> None:
        detector = _page_hinkley()
        for index in range(60):
            noise = ((index * 37) % 21 - 10) // 10
            step = detector.update(_observation(index, 1_000 + noise))
            assert not step.alarm

    def test_upward_shift_alarms_up_and_restarts_everything(self) -> None:
        detector = _page_hinkley()
        for index in range(10):
            detector.update(_observation(index, 1_000))
        alarm_step: PageHinkleyStepV1 | None = None
        for index in range(10, 20):
            step = detector.update(_observation(index, 1_150))
            if step.alarm:
                alarm_step = step
                break
        assert alarm_step is not None
        assert alarm_step.direction is AlarmDirection.UP
        # A restart empties both statistics and the running mean.
        follow_up = detector.update(_observation(alarm_step.ordinal + 1, 1_150))
        assert follow_up.status is StepStatus.WARMUP
        assert follow_up.statistic_up.mantissa <= detector.config.delta.mantissa

    def test_downward_shift_alarms_down(self) -> None:
        detector = _page_hinkley()
        for index in range(10):
            detector.update(_observation(index, 1_000))
        alarm_step: PageHinkleyStepV1 | None = None
        for index in range(10, 20):
            step = detector.update(_observation(index, 850))
            if step.alarm:
                alarm_step = step
                break
        assert alarm_step is not None
        assert alarm_step.direction is AlarmDirection.DOWN

    def test_stale_suppresses_and_gap_resets(self) -> None:
        detector = _page_hinkley()
        detector.update(_observation(0, 1_000))
        suppressed = detector.update(_observation(1, 1_500, QualityState.STALE))
        assert suppressed.status is StepStatus.SUPPRESSED
        reset = detector.update(_observation(2, 1_500, QualityState.UNKNOWN))
        assert reset.status is StepStatus.RESET
        assert reset.statistic_up.is_zero
        assert detector.update(_observation(3, 1_500)).status is StepStatus.WARMUP

    def test_simultaneous_crossings_pick_the_larger_statistic_up(self) -> None:
        # Warmup suppresses alarms while both statistics accumulate; the first OK
        # step then sees both above lambda and the larger side decides.
        detector = _page_hinkley(delta_hundredths=0, lambda_hundredths=40, warmup=3)
        for index, value in enumerate((1_000, 1_200, 800)):
            assert detector.update(_observation(index, value)).status is StepStatus.WARMUP
        step = detector.update(_observation(3, 1_200))
        assert step.alarm
        assert step.statistic_up.mantissa > step.statistic_down.mantissa
        assert step.direction is AlarmDirection.UP

    def test_simultaneous_crossings_pick_the_larger_statistic_down(self) -> None:
        detector = _page_hinkley(delta_hundredths=0, lambda_hundredths=40, warmup=3)
        for index, value in enumerate((1_000, 800, 1_200)):
            assert detector.update(_observation(index, value)).status is StepStatus.WARMUP
        step = detector.update(_observation(3, 800))
        assert step.alarm
        assert step.statistic_down.mantissa > step.statistic_up.mantissa
        assert step.direction is AlarmDirection.DOWN
