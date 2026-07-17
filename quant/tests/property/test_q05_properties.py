from __future__ import annotations

from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.bootstrap.atlas import PointInTimeInstrumentV1
from quant_edge.labels.controls import ControlMatchSpecV1, WindowFactsV1, match_controls
from quant_edge.labels.identity import SampleIdentityV1, VersionSetV1, make_sample_identity
from quant_edge.labels.outcomes import (
    BarrierSpecV1,
    CostScenarioV1,
    OutcomeDefinitionV1,
    OutcomeStatus,
    SampleOutcomesV1,
    compute_sample_outcomes,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import EvidenceSeriesV1, PricePointV1, SeriesKind
from quant_edge.labels.stages import (
    StageDefinitionV1,
    StageEvidenceV1,
    StageLabel,
    generate_stage,
)
from quant_edge.lake.contracts import (
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
DAY_NS = 86_400_000_000_000

MARKET_IDENTITY = InstrumentIdentityV1(
    instrument_id="test-binance-spot-BNBUSDT",
    base_size_unit_id="BNB",
    quote_price_unit_id="USDT",
)

POINT_LISTS = st.lists(
    st.tuples(
        st.integers(min_value=1, max_value=30),  # seconds between points
        st.integers(min_value=1, max_value=1_000_000),  # price coefficient
    ),
    min_size=1,
    max_size=40,
)


def _series_from(
    deltas: list[tuple[int, int]],
    *,
    start_offset_s: int = -30,
    end_s: int = 7_200,
) -> EvidenceSeriesV1:
    points = []
    offset = start_offset_s
    for index, (gap_s, coefficient) in enumerate(deltas):
        points.append(
            PricePointV1(
                event_time_ns=BASE_NS + offset * SECOND_NS,
                ordinal=index + 1,
                price=ExactScaledValueV1(coefficient=coefficient, scale=2, unit_id="USDT"),
            )
        )
        offset += gap_s
    return EvidenceSeriesV1(
        series_id="series-1",
        symbol="BNBUSDT",
        instrument=MARKET_IDENTITY,
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        completeness_end_ns=BASE_NS + end_s * SECOND_NS,
        price_points=tuple(points),
        quote_points=(),
        known_gaps=(),
    )


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


def _sample() -> SampleIdentityV1:
    return make_sample_identity(
        event_id="event-1",
        cohort_id="cohort-1",
        instrument=_instrument(),
        feature_lookback_start_ns=BASE_NS - 60 * SECOND_NS,
        feature_cutoff_ns=BASE_NS,
        label_start_ns=BASE_NS,
        label_end_ns=BASE_NS + 3_600 * SECOND_NS,
        source_completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        source_completeness_end_ns=BASE_NS + 7_200 * SECOND_NS,
        versions=VersionSetV1(
            dataset_version="ds-v1",
            feature_version="feat-v1",
            label_definition_version="label-v1",
            cost_assumption_version="cost-v1",
            execution_assumption_version="exec-v1",
        ),
    )


def _compute(series: EvidenceSeriesV1) -> SampleOutcomesV1:
    return compute_sample_outcomes(
        _sample(),
        series,
        definition=OutcomeDefinitionV1(
            definition_version="outcome-v1",
            max_reference_staleness_ns=3_600 * SECOND_NS,
        ),
        barriers=BarrierSpecV1(
            spec_version="barrier-v1",
            up_ratio=make_ratio(1, 100),
            down_ratio=make_ratio(-1, 100),
        ),
        cost_scenarios=(
            CostScenarioV1(
                scenario_version="cost-a",
                total_cost_ratio=make_ratio(1, 1_000),
                submission_latency_ns=2 * SECOND_NS,
            ),
        ),
    )


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(deltas=POINT_LISTS, end_s=st.integers(min_value=1, max_value=7_200))
def test_outcomes_are_deterministic_and_never_coerce_censoring(
    deltas: list[tuple[int, int]],
    end_s: int,
) -> None:
    total_span = sum(gap for gap, _ in deltas)
    end_s = max(end_s, total_span - 30 + 1)
    series = _series_from(deltas, end_s=min(end_s, 7_200))
    if series.price_points[-1].event_time_ns > series.completeness_end_ns:
        return
    first = _compute(series)
    second = _compute(series)

    assert first.canonical_bytes() == second.canonical_bytes()
    for outcome in first.horizons:
        target_ns = BASE_NS + outcome.horizon_ns
        if outcome.status is OutcomeStatus.AVAILABLE:
            assert outcome.gross_return is not None
            assert series.completeness_end_ns >= target_ns
        if series.completeness_end_ns < target_ns and outcome.status is not (
            OutcomeStatus.UNAVAILABLE
        ):
            assert outcome.status is OutcomeStatus.CENSORED
            assert outcome.censor_time_ns == series.completeness_end_ns
    passage = first.first_passage
    if passage.status is OutcomeStatus.AVAILABLE:
        assert passage.passage_time_ns is not None
        assert passage.passage_time_ns > BASE_NS
        assert passage.passage_time_ns <= min(
            BASE_NS + 3_600 * SECOND_NS,
            series.completeness_end_ns,
        )


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    pre=POINT_LISTS,
    post=st.lists(
        st.tuples(
            st.integers(min_value=1, max_value=30),
            st.integers(min_value=1, max_value=1_000_000),
        ),
        min_size=0,
        max_size=20,
    ),
)
def test_post_cutoff_evidence_never_alters_pre_cutoff_truth(
    pre: list[tuple[int, int]],
    post: list[tuple[int, int]],
) -> None:
    pre_span = sum(gap for gap, _ in pre)
    if pre_span > 25:
        return
    base_series = _series_from(pre, start_offset_s=-30)
    extended_points = list(base_series.price_points)
    offset = 10
    for index, (gap_s, coefficient) in enumerate(post):
        extended_points.append(
            PricePointV1(
                event_time_ns=BASE_NS + offset * SECOND_NS,
                ordinal=len(pre) + index + 1,
                price=ExactScaledValueV1(coefficient=coefficient, scale=2, unit_id="USDT"),
            )
        )
        offset += gap_s
    extended_series = EvidenceSeriesV1(
        series_id="series-1",
        symbol="BNBUSDT",
        instrument=base_series.instrument,
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=base_series.completeness_start_ns,
        completeness_end_ns=base_series.completeness_end_ns,
        price_points=tuple(extended_points),
        quote_points=(),
        known_gaps=(),
    )

    cutoff = BASE_NS
    assert base_series.pre_cutoff_digest(cutoff) == extended_series.pre_cutoff_digest(cutoff)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    pool_shape=st.lists(
        st.tuples(
            st.integers(min_value=0, max_value=9),  # day offset back
            st.integers(min_value=0, max_value=5_000),  # row count
            st.integers(min_value=0, max_value=30),  # range numerator (per mille)
            st.booleans(),  # completeness known
        ),
        min_size=0,
        max_size=30,
    )
)
def test_matched_controls_never_overlap_and_share_buckets(
    pool_shape: list[tuple[int, int, int, bool]],
) -> None:
    sample = _sample()
    spec = ControlMatchSpecV1(
        match_version="match-v1",
        liquidity_bucket_edges=(10, 100, 1_000),
        volatility_bucket_edges=(make_ratio(1, 200), make_ratio(1, 20)),
        time_of_day_bucket_ns=DAY_NS // 24,
        funding_cycle_ns=DAY_NS // 3,
        max_controls=8,
    )
    candidate = WindowFactsV1(
        window_id="candidate-1",
        symbol="BNBUSDT",
        window_start_ns=BASE_NS - 90_000 * SECOND_NS,
        window_end_ns=BASE_NS - 89_400 * SECOND_NS,
        row_count=120,
        value_range_ratio=make_ratio(1, 100),
        regime_id="regime-a",
        completeness_known=True,
        gap_row_count=0,
    )
    pool = []
    facts_by_id: dict[str, WindowFactsV1] = {}
    for index, (days_back, rows, range_per_mille, known) in enumerate(pool_shape):
        start = BASE_NS - (90_000 + days_back * 86_400) * SECOND_NS
        facts = WindowFactsV1(
            window_id=f"pool-{index:03d}",
            symbol="BNBUSDT",
            window_start_ns=start,
            window_end_ns=start + 600 * SECOND_NS,
            row_count=rows,
            value_range_ratio=make_ratio(range_per_mille, 1_000),
            regime_id="regime-a",
            completeness_known=known,
            gap_row_count=0,
        )
        pool.append(facts)
        facts_by_id[facts.window_id] = facts

    result = match_controls(sample, candidate, tuple(pool), spec)

    assert result.selected_window_ids == tuple(sorted(result.selected_window_ids))
    assert len(result.selected_window_ids) <= spec.max_controls
    for window_id in result.selected_window_ids:
        facts = facts_by_id[window_id]
        assert facts.completeness_known
        assert not (
            facts.window_start_ns < sample.label_end_ns
            and sample.feature_lookback_start_ns < facts.window_end_ns
        )
        assert spec.liquidity_bucket(facts.row_count) == spec.liquidity_bucket(candidate.row_count)
        assert spec.volatility_bucket(facts.value_range_ratio) == spec.volatility_bucket(
            candidate.value_range_ratio
        )
    assert match_controls(sample, candidate, tuple(pool), spec) == result


@settings(max_examples=80, deadline=None)
@seed(20260712)
@given(
    baseline=st.lists(st.integers(min_value=0, max_value=50), min_size=1, max_size=8),
    window=st.lists(st.integers(min_value=0, max_value=200), min_size=1, max_size=8),
    sign=st.integers(min_value=-1, max_value=1),
    complete=st.booleans(),
    disorder=st.booleans(),
)
def test_stage_classifier_is_total_and_deterministic(
    baseline: list[int],
    window: list[int],
    sign: int,
    complete: bool,
    disorder: bool,
) -> None:
    definition = StageDefinitionV1(
        definition_version="stage-v1",
        dormant_max_count=1,
        ignition_ratio=make_ratio(3, 1),
        continuation_floor_ratio=make_ratio(2, 1),
        fade_ceiling_ratio=make_ratio(1, 2),
    )
    evidence = StageEvidenceV1(
        baseline_bucket_counts=tuple(baseline),
        window_bucket_counts=tuple(window),
        net_return_sign=sign,
        window_complete=complete,
        disorder_observed=disorder,
    )

    first = generate_stage(evidence, definition)
    second = generate_stage(evidence, definition)

    assert first == second
    assert first.stage in StageLabel
    if disorder:
        assert first.stage is StageLabel.DISORDER
    elif not complete:
        assert first.stage is StageLabel.UNKNOWN
