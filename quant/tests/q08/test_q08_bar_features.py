from __future__ import annotations

from collections.abc import Callable, Sequence

import pytest

from quant_edge.derivatives.bar_features import (
    CONVERGING_WINDOW,
    PERSISTENCE_WINDOW,
    Q08_REGISTRY_VERSION,
    basis_converging_fraction_feature,
    basis_gap_acceleration_feature,
    basis_gap_velocity_feature,
    basis_sign_persistence_feature,
    q08_features,
    q08_registry,
)
from quant_edge.derivatives.basis_path import (
    BASIS_ALIGNMENT,
    BasisPathV1,
    BasisPointV1,
    build_basis_bars,
)
from quant_edge.derivatives.references import ReferenceKind
from quant_edge.features.domains import BarSeriesV1, BarV1, WallTimeBarSpecV1
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE
from quant_edge.features.harness import run_equivalence
from quant_edge.features.primitives import FeatureImplementationV1
from quant_edge.features.registry import (
    render_registry_markdown,
    verify_registry_markdown,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _path_from_bases(bases_bps: Sequence[int | None]) -> BasisPathV1:
    """One observation per 10s bar; None leaves that bar empty."""

    points = []
    ordinal = 0
    for index, basis_bps in enumerate(bases_bps):
        if basis_bps is None:
            continue
        spot = 10_000_000
        perp = spot + spot * basis_bps // 10_000
        points.append(
            BasisPointV1(
                event_time_ns=BASE_NS + (index * 10 + 5) * SECOND_NS,
                ordinal=ordinal,
                basis=make_ratio(perp - spot, spot),
                spot_aligned=spot,
                perp_aligned=perp,
            )
        )
        ordinal += 1
    return BasisPathV1(
        path_id="q08-feature-path",
        spot_symbol="BNBUSDT",
        perp_symbol="BNBUSDT-PERP",
        reference_kind=ReferenceKind.LAST_TRADE,
        posture=EvidencePosture.SYNTHETIC,
        max_staleness_ns=SECOND_NS,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + len(bases_bps) * 10 * SECOND_NS,
        points=tuple(points),
        known_gaps=(),
    )


def _bars(bases_bps: Sequence[int | None]) -> BarSeriesV1:
    return build_basis_bars(
        _path_from_bases(bases_bps),
        wall_width_ns=10 * SECOND_NS,
        anchor_ns=BASE_NS,
    )


def _bps(value: int) -> int:
    return value * FIXED_POINT_SCALE // 10_000


class TestGoldenVectors:
    """Documented golden vectors for every registered Q08 feature."""

    def test_basis_gap_velocity_golden_vector(self) -> None:
        bars = _bars([100, 80, 90, None, 40])
        implementation = basis_gap_velocity_feature()
        streaming = implementation.make_streaming()
        observed = [
            None if value is None else value.mantissa
            for value in (streaming.update(bar) for bar in bars.bars)
        ]
        # First bar has no predecessor; the empty bar yields None but the chain
        # resumes against the last complete close (90 -> 40).
        assert observed == [None, _bps(-20), _bps(10), None, _bps(-50)]

    def test_basis_gap_acceleration_golden_vector(self) -> None:
        bars = _bars([100, 80, 90, 40])
        implementation = basis_gap_acceleration_feature()
        streaming = implementation.make_streaming()
        observed = [
            None if value is None else value.mantissa
            for value in (streaming.update(bar) for bar in bars.bars)
        ]
        # Velocities: None, -20, +10, -50 => accelerations None, None, +30, -60.
        assert observed == [None, None, _bps(30), _bps(-60)]

    def test_basis_sign_persistence_golden_vector(self) -> None:
        bars = _bars([100, 80, -10, -20, 0, 30, None, 40])
        implementation = basis_sign_persistence_feature()
        streaming = implementation.make_streaming()
        observed = [
            None if value is None else value.mantissa // FIXED_POINT_SCALE
            for value in (streaming.update(bar) for bar in bars.bars)
        ]
        # Runs: +,+ then -,- then zero resets, + starts anew, the empty bar
        # breaks the run, and the final + starts at one again.
        assert observed == [1, 2, 1, 2, 0, 1, None, 1]

    def test_basis_sign_persistence_caps_at_the_window(self) -> None:
        bars = _bars([10] * (PERSISTENCE_WINDOW + 3))
        implementation = basis_sign_persistence_feature()
        streaming = implementation.make_streaming()
        observed = [
            None if value is None else value.mantissa // FIXED_POINT_SCALE
            for value in (streaming.update(bar) for bar in bars.bars)
        ]
        assert observed[-1] == PERSISTENCE_WINDOW
        assert max(value for value in observed if value is not None) == PERSISTENCE_WINDOW

    def test_basis_converging_fraction_golden_vector(self) -> None:
        # Nine complete bars: |basis| shrinks on 6 of 8 transitions.
        bars = _bars([100, 90, 95, 80, 70, 60, 65, 50, 40])
        implementation = basis_converging_fraction_feature()
        streaming = implementation.make_streaming()
        observed = [
            None if value is None else value.mantissa
            for value in (streaming.update(bar) for bar in bars.bars)
        ]
        assert observed[:-1] == [None] * (CONVERGING_WINDOW)
        assert observed[-1] == 6 * FIXED_POINT_SCALE // 8

    def test_converging_fraction_window_breaks_on_missing_bars(self) -> None:
        bases: list[int | None] = [100, 90, 95, 80, 70, None, 60, 65, 50, 40]
        bars = _bars(bases)
        implementation = basis_converging_fraction_feature()
        streaming = implementation.make_streaming()
        observed = [streaming.update(bar) for bar in bars.bars]
        # The break at index 5 leaves only four transitions after it.
        assert all(value is None for value in observed)


class TestEquivalence:
    def test_streaming_equals_batch_on_golden_and_broken_series(self) -> None:
        for bases in (
            [100, 80, 90, 40, 30, 20, 25, 10, 5, 0, -5, -10],
            [100, None, 80, 0, -10, None, None, 20, 20, 15],
            [0, 0, 0],
            [50],
        ):
            bars = _bars(bases)
            for implementation in q08_features():
                report = run_equivalence(implementation, bars)
                assert report.passed, (implementation.card.feature_id, bases)
                assert report.max_ulp_deviation == 0
                assert report.tolerance_ulp == 0

    def test_foreign_alignment_still_quantizes_deterministically(self) -> None:
        # A hand-built bar whose aligned value is not a BASIS_ALIGNMENT multiple
        # quantizes half-even instead of failing.
        bar = BarV1(
            index=0,
            start_ns=BASE_NS,
            end_ns=BASE_NS + 10 * SECOND_NS,
            point_count=1,
            first_value_aligned=BASIS_ALIGNMENT + 1,
            last_value_aligned=BASIS_ALIGNMENT + 1,
            volume_aligned_total=None,
            complete=True,
        )
        series = BarSeriesV1(
            spec=WallTimeBarSpecV1(wall_width_ns=10 * SECOND_NS, anchor_ns=BASE_NS),
            bars=(bar,),
        )
        implementation = basis_sign_persistence_feature()
        streaming = implementation.make_streaming()
        observed = streaming.update(series.bars[0])
        assert observed is not None
        assert observed.mantissa == FIXED_POINT_SCALE


class TestRegistry:
    def test_registry_is_complete_sorted_and_digest_bound(self) -> None:
        registry = q08_registry()
        assert registry.registry_version == Q08_REGISTRY_VERSION
        identities = [card.feature_id for card in registry.cards]
        assert identities == [
            "basis_converging_fraction:v1",
            "basis_gap_acceleration:v1",
            "basis_gap_velocity:v1",
            "basis_sign_persistence:v1",
        ]
        markdown = render_registry_markdown(registry)
        verify_registry_markdown(markdown, registry)
        assert registry.content_digest.hexdigest in markdown

    def test_every_card_is_complete_and_makes_no_predictive_claim(self) -> None:
        for implementation in q08_features():
            card = implementation.card
            mapping = card.as_mapping()
            for key, value in mapping.items():
                if key in ("lowerBound", "upperBound"):
                    continue
                assert value not in (None, "", []), key
            assert card.inputs == ("basis_bar_series",)
            assert card.normalization_cohort == "spot-perp-pair-self"
            assert card.equivalence_tolerance_ulp == 0
            for banned in ("guaranteed", "profitable", "validated", "proven"):
                assert banned not in card.economic_hypothesis.lower()

    def test_bounded_cards_declare_their_bounds(self) -> None:
        persistence = basis_sign_persistence_feature().card
        assert persistence.lower_bound is not None
        assert persistence.upper_bound is not None
        assert persistence.upper_bound.mantissa == PERSISTENCE_WINDOW * FIXED_POINT_SCALE
        fraction = basis_converging_fraction_feature().card
        assert fraction.upper_bound is not None
        assert fraction.upper_bound.mantissa == FIXED_POINT_SCALE

    def test_batch_rejects_valueless_prefixes(self) -> None:
        empty: tuple[BarV1, ...] = ()
        for implementation in q08_features():
            assert implementation.batch(empty) is None


@pytest.mark.parametrize(
    "factory",
    [
        basis_converging_fraction_feature,
        basis_gap_acceleration_feature,
        basis_gap_velocity_feature,
        basis_sign_persistence_feature,
    ],
)
def test_incremental_update_is_o_of_window_or_better(
    factory: Callable[[], FeatureImplementationV1],
) -> None:
    """The incremental-update benchmark: state stays bounded over long series."""

    implementation = factory()
    streaming = implementation.make_streaming()
    bars = _bars([((index * 13) % 41) - 20 for index in range(1_000)])
    for bar in bars.bars:
        streaming.update(bar)
    # Bounded state: the streaming object holds no unbounded history.
    slots = getattr(type(streaming), "__slots__", ())
    assert slots, "streaming implementations must declare __slots__"
    for slot in slots:
        name = f"_{type(streaming).__name__.lstrip('_')}{slot}" if slot.startswith("__") else slot
        value = getattr(streaming, name)
        if isinstance(value, list):
            assert len(value) <= CONVERGING_WINDOW + 1
