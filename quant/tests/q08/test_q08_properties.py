from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from quant_edge.derivatives.bar_features import q08_features
from quant_edge.derivatives.basis_path import (
    attribute_leg_changes,
    build_basis_bars,
    build_basis_path,
)
from quant_edge.derivatives.convergence import estimate_convergence
from quant_edge.derivatives.costs import (
    CostKind,
    CostStackV1,
    known_component,
    unknown_component,
)
from quant_edge.derivatives.openinterest import (
    OpenInterestEvidenceV1,
    OpenInterestObservationV1,
    PriceOiQuadrant,
    price_oi_quadrant,
)
from quant_edge.derivatives.references import ReferenceKind
from quant_edge.derivatives.sampled import SampledValueStatus, derive_sampled_value
from quant_edge.features.fixedpoint import FP_ONE
from quant_edge.features.harness import run_equivalence
from quant_edge.labels.basis import BasisConstruction
from quant_edge.labels.outcomes import OutcomeStatus
from quant_edge.labels.rational import (
    make_ratio,
    ratio_add,
    ratio_compare,
    scaled_to_aligned,
)
from quant_edge.labels.series import EvidenceSeriesV1, PricePointV1, SeriesKind
from quant_edge.lake.contracts import (
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
    QualityState,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000

SPOT_INSTRUMENT = InstrumentIdentityV1(
    instrument_id="test-binance-spot-BNBUSDT",
    base_size_unit_id="BNB",
    quote_price_unit_id="USDT",
)
PERP_INSTRUMENT = InstrumentIdentityV1(
    instrument_id="test-binance-usdm-BNBUSDT",
    base_size_unit_id="BNB",
    quote_price_unit_id="USDT",
)

DUAL_LEG_WALKS = st.lists(
    st.tuples(
        st.integers(min_value=1, max_value=9),  # seconds between perp observations
        st.integers(min_value=-90, max_value=90),  # spot move
        st.integers(min_value=-40, max_value=40),  # perp gap move
    ),
    min_size=2,
    max_size=60,
)


def _legs(moves: list[tuple[int, int, int]]) -> tuple[EvidenceSeriesV1, EvidenceSeriesV1]:
    spot_points = []
    perp_points = []
    offset = 0
    spot = 10_000
    gap = 50
    for index, (gap_s, spot_move, gap_move) in enumerate(moves):
        offset += gap_s
        spot = max(spot + spot_move, 200)
        gap = gap + gap_move
        spot_points.append(
            PricePointV1(
                event_time_ns=BASE_NS + offset * SECOND_NS,
                ordinal=index,
                price=ExactScaledValueV1(coefficient=spot, scale=2, unit_id="USDT"),
            )
        )
        perp_points.append(
            PricePointV1(
                event_time_ns=BASE_NS + offset * SECOND_NS,
                ordinal=index,
                price=ExactScaledValueV1(coefficient=max(spot + gap, 100), scale=2, unit_id="USDT"),
            )
        )
    end = BASE_NS + (offset + 5) * SECOND_NS
    spot_series = EvidenceSeriesV1(
        series_id="prop-spot",
        symbol="BNBUSDT",
        instrument=SPOT_INSTRUMENT,
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=end,
        price_points=tuple(spot_points),
        quote_points=(),
        known_gaps=(),
    )
    perp_series = EvidenceSeriesV1(
        series_id="prop-perp",
        symbol="BNBUSDT-PERP",
        instrument=PERP_INSTRUMENT,
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=end,
        price_points=tuple(perp_points),
        quote_points=(),
        known_gaps=(),
    )
    return spot_series, perp_series


@settings(max_examples=60, deadline=None)
@given(moves=DUAL_LEG_WALKS)
def test_streaming_equals_batch_for_every_q08_feature(
    moves: list[tuple[int, int, int]],
) -> None:
    spot_series, perp_series = _legs(moves)
    path = build_basis_path(
        path_id="prop-path",
        spot_series=spot_series,
        perp_series=perp_series,
        reference_kind=ReferenceKind.LAST_TRADE,
        max_staleness_ns=10 * SECOND_NS,
    )
    bars = build_basis_bars(path, wall_width_ns=5 * SECOND_NS, anchor_ns=BASE_NS)
    for implementation in q08_features():
        report = run_equivalence(implementation, bars)
        assert report.passed, implementation.card.feature_id
        assert report.max_ulp_deviation == 0


@settings(max_examples=60, deadline=None)
@given(moves=DUAL_LEG_WALKS)
def test_leg_attribution_conserves_the_basis_delta_exactly(
    moves: list[tuple[int, int, int]],
) -> None:
    spot_series, perp_series = _legs(moves)
    path = build_basis_path(
        path_id="prop-path",
        spot_series=spot_series,
        perp_series=perp_series,
        reference_kind=ReferenceKind.LAST_TRADE,
        max_staleness_ns=10 * SECOND_NS,
    )
    attributions = attribute_leg_changes(path)
    assert len(attributions) == max(len(path.points) - 1, 0)
    for previous, current, attribution in zip(
        path.points, path.points[1:], attributions, strict=False
    ):
        recombined = ratio_add(attribution.spot_contribution, attribution.perp_contribution)
        expected = ratio_add(attribution.basis_delta, make_ratio(0, 1))  # normalized copy
        assert ratio_compare(recombined, expected) == 0
        assert attribution.from_time_ns == previous.event_time_ns
        assert attribution.to_time_ns == current.event_time_ns


@settings(max_examples=60, deadline=None)
@given(moves=DUAL_LEG_WALKS, threshold=st.integers(min_value=1, max_value=9))
def test_convergence_brackets_contain_the_true_crossing(
    moves: list[tuple[int, int, int]],
    threshold: int,
) -> None:
    spot_series, perp_series = _legs(moves)
    path = build_basis_path(
        path_id="prop-path",
        spot_series=spot_series,
        perp_series=perp_series,
        reference_kind=ReferenceKind.LAST_TRADE,
        max_staleness_ns=10 * SECOND_NS,
    )
    if not path.points:
        return
    fraction = make_ratio(threshold, 10)
    estimate = estimate_convergence(
        path=path,
        construction=BasisConstruction.NORMAL,
        definition_version="prop-convergence-v1",
        entry_ordinal=path.points[0].ordinal,
        horizon_end_ns=path.completeness_end_ns,
        threshold_fraction=fraction,
    )
    entry = path.points[0]
    entry_gross = make_ratio(abs(entry.basis.numerator), entry.basis.denominator)
    if estimate.status is OutcomeStatus.AVAILABLE:
        assert estimate.half_life_lower_ns is not None
        assert estimate.half_life_upper_ns is not None
        assert 0 <= estimate.half_life_lower_ns < estimate.half_life_upper_ns
        crossing_time = entry.event_time_ns + estimate.half_life_upper_ns
        threshold_value = make_ratio(
            entry_gross.numerator * fraction.numerator,
            entry_gross.denominator * fraction.denominator,
        )
        for point in path.points[1:]:
            observed = make_ratio(abs(point.basis.numerator), point.basis.denominator)
            if point.event_time_ns < crossing_time:
                # Every strictly earlier observation still exceeds the threshold.
                assert ratio_compare(observed, threshold_value) > 0
            elif point.event_time_ns == crossing_time:
                assert ratio_compare(observed, threshold_value) <= 0
                break
    elif estimate.status is OutcomeStatus.CENSORED:
        assert estimate.censored_duration_ns is not None
        assert estimate.censored_duration_ns > 0
        assert entry.event_time_ns + estimate.censored_duration_ns <= path.completeness_end_ns


@settings(max_examples=60, deadline=None)
@given(
    price_moves=st.lists(st.integers(min_value=-50, max_value=50), min_size=2, max_size=10),
    oi_moves=st.lists(st.integers(min_value=-30, max_value=30), min_size=2, max_size=10),
)
def test_price_oi_quadrant_is_total(
    price_moves: list[int],
    oi_moves: list[int],
) -> None:
    prices = [10_000]
    for move in price_moves:
        prices.append(max(prices[-1] + move, 100))
    ois = [1_000]
    for move in oi_moves:
        ois.append(max(ois[-1] + move, 0))
    end = BASE_NS + 1_000 * SECOND_NS
    price_series = EvidenceSeriesV1(
        series_id="prop-price",
        symbol="BNBUSDT",
        instrument=SPOT_INSTRUMENT,
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=end,
        price_points=tuple(
            PricePointV1(
                event_time_ns=BASE_NS + (index + 1) * 10 * SECOND_NS,
                ordinal=index,
                price=ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT"),
            )
            for index, price in enumerate(prices)
        ),
        quote_points=(),
        known_gaps=(),
    )
    oi_evidence = OpenInterestEvidenceV1(
        symbol="BNBUSDT-PERP",
        posture=EvidencePosture.SYNTHETIC,
        quality=QualityState.SAMPLED,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=end,
        observations=tuple(
            OpenInterestObservationV1(
                event_time_ns=BASE_NS + (index + 1) * 10 * SECOND_NS,
                ordinal=index,
                open_interest=ExactScaledValueV1(coefficient=amount, scale=0, unit_id="CONTRACTS"),
            )
            for index, amount in enumerate(ois)
        ),
    )
    observed = price_oi_quadrant(
        price_series=price_series,
        oi_evidence=oi_evidence,
        window_start_ns=BASE_NS + 10 * SECOND_NS,
        window_end_ns=BASE_NS + (len(prices)) * 10 * SECOND_NS,
        max_staleness_ns=1_000 * SECOND_NS,
    )
    assert observed in PriceOiQuadrant
    # Cross-check the verdict against the raw deltas.
    price_delta = prices[-1] - prices[0]
    oi_end_index = min(len(prices) - 1, len(ois) - 1)
    oi_delta = ois[oi_end_index] - ois[0]
    if price_delta > 0 and oi_delta > 0:
        assert observed is PriceOiQuadrant.RISING_PRICE_RISING_OI
    if price_delta == 0 or oi_delta == 0:
        assert observed is PriceOiQuadrant.FLAT


@settings(max_examples=80, deadline=None)
@given(
    knownness=st.lists(st.booleans(), min_size=6, max_size=6),
    values=st.lists(st.integers(min_value=0, max_value=100), min_size=6, max_size=6),
)
def test_cost_stack_total_exists_exactly_when_everything_is_known(
    knownness: list[bool],
    values: list[int],
) -> None:
    kinds = sorted(CostKind, key=lambda kind: kind.value)
    components = tuple(
        known_component(kind, value, 10_000) if known else unknown_component(kind)
        for kind, known, value in zip(kinds, knownness, values, strict=True)
    )
    stack = CostStackV1(stack_version="prop-costs-v1", components=components)
    if all(knownness):
        assert stack.total() is not None
    else:
        assert stack.total() is None
        assert stack.unknown_kinds


@settings(max_examples=80, deadline=None)
@given(
    quality=st.sampled_from([QualityState.SAMPLED, QualityState.PARTIAL, QualityState.UNKNOWN]),
    age_s=st.integers(min_value=0, max_value=100),
    bound_s=st.integers(min_value=1, max_value=50),
    has_value=st.booleans(),
)
def test_sampled_value_status_never_upgrades(
    quality: QualityState,
    age_s: int,
    bound_s: int,
    has_value: bool,
) -> None:
    observed = derive_sampled_value(
        feature_id="prop_feature:v1",
        as_of_ns=BASE_NS + age_s * SECOND_NS,
        input_last_event_ns=BASE_NS,
        freshness_bound_ns=bound_s * SECOND_NS,
        sampling=quality,
        computed=FP_ONE if has_value else None,
    )
    if quality is QualityState.UNKNOWN or not has_value:
        assert observed.status is SampledValueStatus.UNKNOWN
        assert observed.value is None
    elif age_s > bound_s:
        assert observed.status is SampledValueStatus.STALE
        assert observed.value is None
    else:
        assert observed.status is SampledValueStatus.AVAILABLE_SAMPLED
        assert observed.value is not None


@settings(max_examples=60, deadline=None)
@given(moves=DUAL_LEG_WALKS)
def test_basis_path_points_match_the_leg_evidence_exactly(
    moves: list[tuple[int, int, int]],
) -> None:
    spot_series, perp_series = _legs(moves)
    path = build_basis_path(
        path_id="prop-path",
        spot_series=spot_series,
        perp_series=perp_series,
        reference_kind=ReferenceKind.LAST_TRADE,
        max_staleness_ns=10 * SECOND_NS,
    )
    for point in path.points:
        spot_reference = spot_series.last_price_at_or_before(point.event_time_ns)
        assert spot_reference is not None
        assert point.spot_aligned == scaled_to_aligned(spot_reference.price)
        expected = make_ratio(point.perp_aligned - point.spot_aligned, point.spot_aligned)
        assert ratio_compare(point.basis, expected) == 0
