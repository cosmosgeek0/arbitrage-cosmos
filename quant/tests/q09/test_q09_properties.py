from __future__ import annotations

import itertools

from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, round_half_even
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import QualityState
from quant_edge.regime.alphabet import AlphabetConfigV1
from quant_edge.regime.analog import AnalogQueryV1, AnalogRecordV1, retrieve_analogs
from quant_edge.regime.bocpd import BocpdConfigV1, BocpdDetector
from quant_edge.regime.contracts import ObservationV1, StepStatus, normalize_to_scale
from quant_edge.regime.cusum import CusumConfigV1, TwoSidedCusum
from quant_edge.regime.matrix_profile import MatrixProfileConfigV1, compute_left_profile
from quant_edge.regime.page_hinkley import PageHinkleyConfigV1, TwoSidedPageHinkley
from quant_edge.regime.pelt import PeltConfigV1, segment_pelt
from quant_edge.regime.soft_regime import SoftRegimeFilter, v1_regime_spec

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
HOUR_NS = 3_600 * SECOND_NS
HUNDREDTH = FIXED_POINT_SCALE // 100

NOISE = st.lists(st.integers(min_value=-10, max_value=10), min_size=40, max_size=80)
SHIFTED = st.tuples(
    st.lists(st.integers(min_value=-10, max_value=10), min_size=48, max_size=80),
    st.integers(min_value=20, max_value=28),  # change position
    st.integers(min_value=150, max_value=400),  # magnitude in hundredths
    st.booleans(),  # direction
)


def _observation(index: int, hundredths: int) -> ObservationV1:
    return ObservationV1(
        event_time_ns=BASE_NS + index * SECOND_NS,
        ordinal=index,
        value=FixedPointV1(hundredths * HUNDREDTH),
        quality=QualityState.SYNTHETIC,
    )


def _cusum() -> TwoSidedCusum:
    return TwoSidedCusum(
        CusumConfigV1(
            detector_id="cusum-p",
            reference=None,
            warmup=8,
            slack_k=FixedPointV1(15 * HUNDREDTH),
            threshold_h=FixedPointV1(80 * HUNDREDTH),
        )
    )


def _page_hinkley() -> TwoSidedPageHinkley:
    return TwoSidedPageHinkley(
        PageHinkleyConfigV1(
            detector_id="ph-p",
            delta=FixedPointV1(15 * HUNDREDTH),
            threshold_lambda=FixedPointV1(100 * HUNDREDTH),
            warmup=8,
        )
    )


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(NOISE)
def test_cusum_and_page_hinkley_stay_silent_in_control(noise: list[int]) -> None:
    """Bounded zigzag noise inside the slack band never alarms either detector."""

    cusum = _cusum()
    page_hinkley = _page_hinkley()
    for index, delta in enumerate(noise):
        observation = _observation(index, 1_000 + delta)
        assert not cusum.update(observation).alarm
        assert not page_hinkley.update(observation).alarm


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(SHIFTED)
def test_planted_shift_is_detected_within_bounded_delay(
    case: tuple[list[int], int, int, bool],
) -> None:
    noise, position, magnitude, upward = case
    offset = magnitude if upward else -magnitude
    cusum = _cusum()
    page_hinkley = _page_hinkley()
    cusum_alarms = []
    page_hinkley_alarms = []
    for index, delta in enumerate(noise):
        level = 1_000 + delta + (offset if index >= position else 0)
        observation = _observation(index, level)
        if cusum.update(observation).alarm:
            cusum_alarms.append(index)
        if page_hinkley.update(observation).alarm:
            page_hinkley_alarms.append(index)
    assert any(position <= alarm <= position + 12 for alarm in cusum_alarms)
    assert any(position <= alarm <= position + 12 for alarm in page_hinkley_alarms)
    assert not any(alarm < position for alarm in cusum_alarms)
    assert not any(alarm < position for alarm in page_hinkley_alarms)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(st.integers(min_value=-40, max_value=40), min_size=4, max_size=12),
    st.integers(min_value=0, max_value=3),
)
def test_pelt_matches_brute_force_optimal_partitioning(
    deltas: list[int],
    penalty_scale: int,
) -> None:
    values = tuple(FixedPointV1((1_000 + delta) * HUNDREDTH) for delta in deltas)
    penalty = penalty_scale * FIXED_POINT_SCALE // 2
    config = PeltConfigV1(segmenter_id="pelt-p", penalty=penalty, min_segment_length=1)
    segmentation = segment_pelt(values, config)

    mantissas = [value.mantissa for value in values]

    def cost(start: int, end: int) -> int:
        segment = mantissas[start:end]
        total = sum(segment)
        square = sum(value * value for value in segment)
        count = end - start
        return round_half_even(count * square - total * total, count * FIXED_POINT_SCALE)

    best: int | None = None
    length = len(mantissas)
    for split_count in range(length):
        for splits in itertools.combinations(range(1, length), split_count):
            boundaries = [0, *splits, length]
            objective = (
                sum(cost(earlier, later) for earlier, later in itertools.pairwise(boundaries))
                + penalty * split_count
            )
            if best is None or objective < best:
                best = objective
    assert segmentation.objective == best


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(st.integers(min_value=-500, max_value=500), min_size=20, max_size=60),
)
def test_bocpd_posterior_laws_hold_on_arbitrary_series(deltas: list[int]) -> None:
    detector = BocpdDetector(
        BocpdConfigV1(
            detector_id="bocpd-p",
            alphabet=AlphabetConfigV1(
                baseline_window=6,
                thresholds=(
                    FixedPointV1(FIXED_POINT_SCALE),
                    FixedPointV1(3 * FIXED_POINT_SCALE),
                ),
            ),
            hazard=make_ratio(1, 40),
            run_cap=8,
            alarm_run_length=2,
            alarm_threshold=FixedPointV1(FIXED_POINT_SCALE // 2),
            alarm_warmup=4,
        )
    )
    for index, delta in enumerate(deltas):
        step = detector.update(_observation(index, 1_000 + delta))
        assert sum(step.posterior) == FIXED_POINT_SCALE
        assert len(step.posterior) == 9
        assert 0 <= step.map_run_length <= 8
        assert step.change_mass.mantissa == step.posterior[0]


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(st.integers(min_value=-500, max_value=500), min_size=20, max_size=50),
)
def test_soft_regime_probabilities_stay_normalized_and_floored(
    deltas: list[int],
) -> None:
    spec = v1_regime_spec()
    regime_filter = SoftRegimeFilter(spec)
    for index, delta in enumerate(deltas):
        step = regime_filter.update(_observation(index, 1_000 + delta))
        assert sum(step.probabilities) == FIXED_POINT_SCALE
        if step.status is StepStatus.OK:
            assert min(step.probabilities) >= spec.floor.mantissa
        assert step.uncertainty.mantissa == FIXED_POINT_SCALE - max(step.probabilities)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(st.integers(min_value=-99, max_value=99), min_size=12, max_size=40),
    st.integers(min_value=2, max_value=5),
    st.integers(min_value=0, max_value=3),
)
def test_matrix_profile_earlier_only_and_conservation_laws(
    deltas: list[int],
    window: int,
    embargo: int,
) -> None:
    values = tuple(FixedPointV1((500 + delta) * HUNDREDTH) for delta in deltas)
    profile = compute_left_profile(
        values,
        MatrixProfileConfigV1(profile_id="profile-p", window=window, embargo=embargo),
    )
    window_count = len(profile.entries)
    eligible_total = 0
    for entry in profile.entries:
        eligible_total += entry.eligible_count
        if entry.neighbor is not None:
            assert entry.neighbor + window + embargo <= entry.index
            assert entry.similarity is not None
            assert abs(entry.similarity.mantissa) <= FIXED_POINT_SCALE
    assert profile.exclusions.total + eligible_total == window_count * (window_count - 1)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(
        st.tuples(
            st.integers(min_value=1, max_value=40),  # end offset hours
            st.lists(
                st.integers(min_value=-80, max_value=80),
                min_size=4,
                max_size=4,
            ),
        ),
        min_size=1,
        max_size=25,
    ),
    st.integers(min_value=1, max_value=6),
)
def test_analog_retrieval_never_leaks_future_or_overlap(
    raw_records: list[tuple[int, list[int]]],
    k: int,
) -> None:
    records = tuple(
        AnalogRecordV1(
            record_id=f"analog-{index:02d}",
            symbol="BNBUSDT",
            regime_id="UNKNOWN",
            feature_id="window-v1",
            start_ns=BASE_NS + hours * HOUR_NS - 4 * SECOND_NS,
            end_ns=BASE_NS + hours * HOUR_NS,
            outcome_start_ns=BASE_NS + hours * HOUR_NS,
            outcome_end_ns=BASE_NS + hours * HOUR_NS + SECOND_NS,
            label_available_ns=BASE_NS + hours * HOUR_NS + 2 * SECOND_NS,
            values=tuple(FixedPointV1((500 + delta) * HUNDREDTH) for delta in deltas),
            outcome_label="UNKNOWN",
            completeness=QualityState.SYNTHETIC,
            event_id=f"event-{index:02d}",
        )
        for index, (hours, deltas) in enumerate(raw_records)
    )
    query = AnalogQueryV1(
        query_id="query-p",
        symbol="BNBUSDT",
        regime_id=None,
        feature_id="window-v1",
        start_ns=BASE_NS + 20 * HOUR_NS,
        cutoff_ns=BASE_NS + 20 * HOUR_NS + 4 * SECOND_NS,
        embargo_ns=2 * HOUR_NS,
        values=(
            FixedPointV1(500 * HUNDREDTH),
            FixedPointV1(540 * HUNDREDTH),
            FixedPointV1(520 * HUNDREDTH),
            FixedPointV1(480 * HUNDREDTH),
        ),
        event_id="event-query",
    )
    retrieval = retrieve_analogs(query, records, k=k)
    horizon = query.cutoff_ns - query.embargo_ns
    record_by_id = {record.record_id: record for record in records}
    for neighbor in retrieval.neighbors:
        record = record_by_id[neighbor.record_id]
        assert neighbor.end_ns <= horizon
        assert record.end_ns <= query.start_ns
        assert record.label_available_ns <= horizon
        assert record.event_id is not None
        assert query.event_id is not None
        assert record.event_id != query.event_id
    counted = sum(count for _, count in retrieval.exclusion_counts)
    assert counted + retrieval.cohort_size == len(records)


@settings(max_examples=80, deadline=None)
@seed(20260712)
@given(
    st.lists(st.integers(min_value=0, max_value=1_000), min_size=1, max_size=40),
    st.integers(min_value=1, max_value=10**12),
)
def test_normalize_to_scale_is_exact_for_any_weights(
    weights: list[int],
    target: int,
) -> None:
    if sum(weights) == 0:
        weights[0] = 1
    result = normalize_to_scale(tuple(weights), target=target)
    assert sum(result) == target
    for weight, share in zip(weights, result, strict=True):
        if weight == 0:
            assert share == 0
