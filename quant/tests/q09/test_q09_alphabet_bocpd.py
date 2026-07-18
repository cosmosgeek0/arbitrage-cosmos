from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import QualityState
from quant_edge.regime.alphabet import AlphabetConfigV1, RobustDiscretizer
from quant_edge.regime.bocpd import (
    MAX_HAZARD_DENOMINATOR,
    BocpdConfigV1,
    BocpdDetector,
    BocpdStepV1,
)
from quant_edge.regime.contracts import ObservationV1, StepStatus

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
HUNDREDTH = FIXED_POINT_SCALE // 100


def _observation(
    index: int,
    hundredths: int,
    quality: QualityState = QualityState.SYNTHETIC,
    *,
    event_time_index: int | None = None,
) -> ObservationV1:
    return ObservationV1(
        event_time_ns=BASE_NS
        + (index if event_time_index is None else event_time_index) * SECOND_NS,
        ordinal=index,
        value=FixedPointV1(hundredths * HUNDREDTH),
        quality=quality,
    )


def _alphabet(window: int = 4) -> AlphabetConfigV1:
    return AlphabetConfigV1(
        baseline_window=window,
        thresholds=(FixedPointV1(FIXED_POINT_SCALE), FixedPointV1(3 * FIXED_POINT_SCALE)),
    )


def _bocpd_config(
    *,
    window: int = 4,
    run_cap: int = 8,
    alarm_run_length: int = 2,
    alarm_threshold_mantissa: int = FIXED_POINT_SCALE // 2,
    alarm_warmup: int = 4,
) -> BocpdConfigV1:
    return BocpdConfigV1(
        detector_id="bocpd-1",
        alphabet=_alphabet(window),
        hazard=make_ratio(1, 50),
        run_cap=run_cap,
        alarm_run_length=alarm_run_length,
        alarm_threshold=FixedPointV1(alarm_threshold_mantissa),
        alarm_warmup=alarm_warmup,
    )


class TestAlphabetConfig:
    def test_symbol_count_is_odd_and_mapping_round_trips(self) -> None:
        config = _alphabet()
        assert config.symbol_count == 5
        assert config.as_mapping()["symbolCount"] == 5

    def test_rejects_bad_window_and_thresholds(self) -> None:
        thresholds = (FixedPointV1(FIXED_POINT_SCALE),)
        with pytest.raises(ContractValueError, match="baseline_window"):
            AlphabetConfigV1(baseline_window=1, thresholds=thresholds)
        with pytest.raises(ContractValueError, match="thresholds must be a tuple"):
            AlphabetConfigV1(baseline_window=4, thresholds=())
        with pytest.raises(ContractValueError, match="thresholds\\[0\\]"):
            AlphabetConfigV1(baseline_window=4, thresholds=(1,))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="strictly positive"):
            AlphabetConfigV1(baseline_window=4, thresholds=(FixedPointV1(0),))
        with pytest.raises(ContractValueError, match="strictly increase"):
            AlphabetConfigV1(
                baseline_window=4,
                thresholds=(FixedPointV1(2), FixedPointV1(2)),
            )


class TestRobustDiscretizer:
    def test_rejects_bad_config_and_value(self) -> None:
        with pytest.raises(ContractValueError, match="config must be AlphabetConfigV1"):
            RobustDiscretizer("config")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="value must be FixedPointV1"):
            RobustDiscretizer(_alphabet()).classify_and_push(1)  # type: ignore[arg-type]

    def test_warmup_returns_none_until_window_full(self) -> None:
        discretizer = RobustDiscretizer(_alphabet(window=3))
        assert discretizer.classify_and_push(FixedPointV1(1_000)) is None
        assert discretizer.classify_and_push(FixedPointV1(1_010)) is None
        assert not discretizer.warm
        assert discretizer.classify_and_push(FixedPointV1(990)) is None
        assert discretizer.warm

    def test_symbols_cover_all_buckets(self) -> None:
        # Fresh baseline per probe: classification is against the prior window
        # only, so probing the same trained state isolates each bucket.
        expected = {1_003: 2, 1_015: 3, 1_200: 4, 995: 1, 700: 0}
        for probe, symbol in expected.items():
            discretizer = RobustDiscretizer(_alphabet(window=4))
            for value in (1_000, 1_010, 990, 1_005):
                discretizer.classify_and_push(FixedPointV1(value * HUNDREDTH))
            # Baseline median ~10.02, MAD ~0.05 in value units.
            assert discretizer.classify_and_push(FixedPointV1(probe * HUNDREDTH)) == symbol

    def test_zero_mad_maps_zero_deviation_to_middle_and_rest_to_extremes(self) -> None:
        discretizer = RobustDiscretizer(_alphabet(window=3))
        for _ in range(3):
            discretizer.classify_and_push(FixedPointV1(1_000 * HUNDREDTH))
        assert discretizer.classify_and_push(FixedPointV1(1_000 * HUNDREDTH)) == 2
        assert discretizer.classify_and_push(FixedPointV1(1_001 * HUNDREDTH)) == 4
        assert discretizer.classify_and_push(FixedPointV1(999 * HUNDREDTH)) == 0

    def test_reset_restarts_warmup(self) -> None:
        discretizer = RobustDiscretizer(_alphabet(window=2))
        discretizer.classify_and_push(FixedPointV1(1))
        discretizer.classify_and_push(FixedPointV1(2))
        warm_before_reset = discretizer.warm
        discretizer.reset()
        warm_after_reset = discretizer.warm
        assert warm_before_reset
        assert not warm_after_reset
        assert discretizer.classify_and_push(FixedPointV1(3)) is None


class TestBocpdConfig:
    def test_rejects_bad_fields(self) -> None:
        alphabet = _alphabet()
        with pytest.raises(ContractValueError, match="detector_id"):
            BocpdConfigV1(
                detector_id="",
                alphabet=alphabet,
                hazard=make_ratio(1, 50),
                run_cap=8,
                alarm_run_length=2,
                alarm_threshold=FixedPointV1(1),
                alarm_warmup=4,
            )
        with pytest.raises(ContractValueError, match="alphabet must be AlphabetConfigV1"):
            BocpdConfigV1(
                detector_id="bocpd-1",
                alphabet=None,  # type: ignore[arg-type]
                hazard=make_ratio(1, 50),
                run_cap=8,
                alarm_run_length=2,
                alarm_threshold=FixedPointV1(1),
                alarm_warmup=4,
            )
        with pytest.raises(ContractValueError, match="hazard must be ExactRatioV1"):
            BocpdConfigV1(
                detector_id="bocpd-1",
                alphabet=alphabet,
                hazard=0.01,  # type: ignore[arg-type]
                run_cap=8,
                alarm_run_length=2,
                alarm_threshold=FixedPointV1(1),
                alarm_warmup=4,
            )
        with pytest.raises(ContractValueError, match="strictly between zero and one"):
            BocpdConfigV1(
                detector_id="bocpd-1",
                alphabet=alphabet,
                hazard=make_ratio(1, 1),
                run_cap=8,
                alarm_run_length=2,
                alarm_threshold=FixedPointV1(1),
                alarm_warmup=4,
            )
        with pytest.raises(ContractValueError, match="hazard denominator"):
            BocpdConfigV1(
                detector_id="bocpd-1",
                alphabet=alphabet,
                hazard=make_ratio(1, MAX_HAZARD_DENOMINATOR + 1),
                run_cap=8,
                alarm_run_length=2,
                alarm_threshold=FixedPointV1(1),
                alarm_warmup=4,
            )
        with pytest.raises(ContractValueError, match="run_cap"):
            BocpdConfigV1(
                detector_id="bocpd-1",
                alphabet=alphabet,
                hazard=make_ratio(1, 50),
                run_cap=1,
                alarm_run_length=0,
                alarm_threshold=FixedPointV1(1),
                alarm_warmup=4,
            )
        with pytest.raises(ContractValueError, match="alarm_run_length"):
            BocpdConfigV1(
                detector_id="bocpd-1",
                alphabet=alphabet,
                hazard=make_ratio(1, 50),
                run_cap=8,
                alarm_run_length=8,
                alarm_threshold=FixedPointV1(1),
                alarm_warmup=9,
            )
        with pytest.raises(ContractValueError, match="alarm_threshold must lie inside"):
            BocpdConfigV1(
                detector_id="bocpd-1",
                alphabet=alphabet,
                hazard=make_ratio(1, 50),
                run_cap=8,
                alarm_run_length=2,
                alarm_threshold=FixedPointV1(0),
                alarm_warmup=4,
            )
        with pytest.raises(ContractValueError, match="alarm_warmup"):
            BocpdConfigV1(
                detector_id="bocpd-1",
                alphabet=alphabet,
                hazard=make_ratio(1, 50),
                run_cap=8,
                alarm_run_length=4,
                alarm_threshold=FixedPointV1(1),
                alarm_warmup=4,
            )

    def test_mapping_round_trips(self) -> None:
        mapping = _bocpd_config().as_mapping()
        assert mapping["runCap"] == 8
        assert mapping["alarmRunLength"] == 2


class TestBocpdStepContract:
    def _posterior(self) -> tuple[int, ...]:
        return (FIXED_POINT_SCALE, 0, 0)

    def test_posterior_must_sum_exactly(self) -> None:
        with pytest.raises(ContractValueError, match="sum exactly"):
            BocpdStepV1(
                detector_id="bocpd-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                symbol=1,
                posterior=(FIXED_POINT_SCALE, 1, 0),
                map_run_length=0,
                change_mass=FixedPointV1(FIXED_POINT_SCALE),
                alarm=False,
            )

    def test_symbol_exists_exactly_when_ok(self) -> None:
        with pytest.raises(ContractValueError, match="symbol exists exactly"):
            BocpdStepV1(
                detector_id="bocpd-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.WARMUP,
                symbol=1,
                posterior=self._posterior(),
                map_run_length=0,
                change_mass=FixedPointV1(FIXED_POINT_SCALE),
                alarm=False,
            )
        with pytest.raises(ContractValueError, match="symbol exists exactly"):
            BocpdStepV1(
                detector_id="bocpd-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                symbol=None,
                posterior=self._posterior(),
                map_run_length=0,
                change_mass=FixedPointV1(FIXED_POINT_SCALE),
                alarm=False,
            )

    def test_change_mass_and_map_and_alarm_laws(self) -> None:
        with pytest.raises(ContractValueError, match="change_mass must equal"):
            BocpdStepV1(
                detector_id="bocpd-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                symbol=1,
                posterior=self._posterior(),
                map_run_length=0,
                change_mass=FixedPointV1(1),
                alarm=False,
            )
        with pytest.raises(ContractValueError, match="map_run_length"):
            BocpdStepV1(
                detector_id="bocpd-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                symbol=1,
                posterior=self._posterior(),
                map_run_length=3,
                change_mass=FixedPointV1(FIXED_POINT_SCALE),
                alarm=False,
            )
        with pytest.raises(ContractValueError, match="only an OK step may alarm"):
            BocpdStepV1(
                detector_id="bocpd-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.RESET,
                symbol=None,
                posterior=self._posterior(),
                map_run_length=0,
                change_mass=FixedPointV1(FIXED_POINT_SCALE),
                alarm=True,
            )
        with pytest.raises(ContractValueError, match="posterior must be a tuple"):
            BocpdStepV1(
                detector_id="bocpd-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                symbol=1,
                posterior=(FIXED_POINT_SCALE, 0),
                map_run_length=0,
                change_mass=FixedPointV1(FIXED_POINT_SCALE),
                alarm=False,
            )
        with pytest.raises(ContractValueError, match="status must be StepStatus"):
            BocpdStepV1(
                detector_id="bocpd-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status="OK",  # type: ignore[arg-type]
                symbol=1,
                posterior=self._posterior(),
                map_run_length=0,
                change_mass=FixedPointV1(FIXED_POINT_SCALE),
                alarm=False,
            )
        with pytest.raises(ContractValueError, match="alarm must be boolean"):
            BocpdStepV1(
                detector_id="bocpd-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                symbol=1,
                posterior=self._posterior(),
                map_run_length=0,
                change_mass=FixedPointV1(FIXED_POINT_SCALE),
                alarm=1,  # type: ignore[arg-type]
            )

    def test_mapping_round_trips(self) -> None:
        step = BocpdStepV1(
            detector_id="bocpd-1",
            ordinal=0,
            event_time_ns=BASE_NS,
            status=StepStatus.OK,
            symbol=2,
            posterior=self._posterior(),
            map_run_length=0,
            change_mass=FixedPointV1(FIXED_POINT_SCALE),
            alarm=False,
        )
        mapping = step.as_mapping()
        assert mapping["posterior"] == [str(FIXED_POINT_SCALE), "0", "0"]
        assert mapping["symbol"] == 2


class TestBocpdBehavior:
    def test_rejects_bad_config_observation_and_order(self) -> None:
        with pytest.raises(ContractValueError, match="config must be BocpdConfigV1"):
            BocpdDetector(None)  # type: ignore[arg-type]
        detector = BocpdDetector(_bocpd_config())
        with pytest.raises(ContractValueError, match="observation must be ObservationV1"):
            detector.update(None)  # type: ignore[arg-type]
        detector.update(_observation(0, 1_000))
        with pytest.raises(ContractValueError, match="ordinal-ordered"):
            detector.update(_observation(0, 1_000))
        with pytest.raises(ContractValueError, match="event-time-ordered"):
            detector.update(_observation(1, 1_000, event_time_index=-1))

    def test_alphabet_warmup_reports_warmup_steps(self) -> None:
        detector = BocpdDetector(_bocpd_config(window=3))
        for index in range(3):
            step = detector.update(_observation(index, 1_000 + index))
            assert step.status is StepStatus.WARMUP
            assert step.symbol is None
            assert step.change_mass.mantissa == FIXED_POINT_SCALE

    def test_posterior_always_sums_to_scale_and_respects_cap(self) -> None:
        detector = BocpdDetector(_bocpd_config(window=3, run_cap=4))
        for index in range(30):
            noise = (index * 7) % 3 - 1
            step = detector.update(_observation(index, 1_000 + noise))
            assert sum(step.posterior) == FIXED_POINT_SCALE
            assert len(step.posterior) == 5
            assert step.map_run_length <= 4

    def test_in_control_series_never_alarms_and_run_length_grows(self) -> None:
        detector = BocpdDetector(_bocpd_config(window=4, run_cap=8, alarm_warmup=6))
        last = None
        for index in range(40):
            noise = (index * 7) % 3 - 1
            last = detector.update(_observation(index, 1_000 + noise))
            assert not last.alarm
        assert last is not None
        assert last.map_run_length == 8

    def test_level_shift_raises_alarm_within_bounded_delay(self) -> None:
        # The baseline window must outlast the evidence accumulation: a short
        # window adapts to the new level before the posterior can collapse.
        detector = BocpdDetector(
            _bocpd_config(
                window=16,
                run_cap=16,
                alarm_run_length=4,
                alarm_warmup=8,
            )
        )
        for index in range(30):
            noise = (index * 7) % 3 - 1
            detector.update(_observation(index, 1_000 + noise))
        alarmed_at: int | None = None
        for index in range(30, 42):
            step = detector.update(_observation(index, 1_400 + (index % 2)))
            if step.alarm:
                alarmed_at = index
                break
        assert alarmed_at is not None
        assert alarmed_at <= 34

    def test_alarm_warmup_blocks_initial_prior_mass(self) -> None:
        # Right after the alphabet warms, all mass sits at short run lengths; the
        # alarm warmup must silence that prior artifact.
        detector = BocpdDetector(_bocpd_config(window=3, alarm_run_length=2, alarm_warmup=4))
        statuses = []
        for index in range(6):
            step = detector.update(_observation(index, 1_000 + (index % 2)))
            statuses.append(step.status)
            assert not step.alarm
        assert StepStatus.OK in statuses

    def test_stale_suppresses_and_gap_resets_posterior(self) -> None:
        detector = BocpdDetector(_bocpd_config(window=3))
        for index in range(8):
            detector.update(_observation(index, 1_000 + (index % 2)))
        suppressed = detector.update(_observation(8, 1_400, QualityState.STALE))
        assert suppressed.status is StepStatus.SUPPRESSED
        assert suppressed.symbol is None
        reset = detector.update(_observation(9, 1_400, QualityState.GAPPED))
        assert reset.status is StepStatus.RESET
        assert reset.posterior[0] == FIXED_POINT_SCALE
        follow_up = detector.update(_observation(10, 1_400))
        assert follow_up.status is StepStatus.WARMUP
