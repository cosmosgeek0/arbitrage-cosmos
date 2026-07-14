from __future__ import annotations

import itertools

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, round_half_even
from quant_edge.regime.pelt import (
    MAX_PELT_POINTS,
    PeltConfigV1,
    SegmentationV1,
    SegmentV1,
    segment_pelt,
)

HUNDREDTH = FIXED_POINT_SCALE // 100


def _values(hundredths: list[int]) -> tuple[FixedPointV1, ...]:
    return tuple(FixedPointV1(value * HUNDREDTH) for value in hundredths)


def _config(
    *,
    penalty: int = 10 * FIXED_POINT_SCALE,
    min_segment_length: int = 2,
) -> PeltConfigV1:
    return PeltConfigV1(
        segmenter_id="pelt-1",
        penalty=penalty,
        min_segment_length=min_segment_length,
    )


def _quantized_cost(mantissas: list[int]) -> int:
    count = len(mantissas)
    linear = sum(mantissas)
    square = sum(value * value for value in mantissas)
    return round_half_even(count * square - linear * linear, count * FIXED_POINT_SCALE)


def _brute_force_objective(mantissas: list[int], penalty: int, minimum: int) -> int:
    """Exhaustive optimal partitioning of the same quantized objective."""

    length = len(mantissas)
    interior = [point for point in range(minimum, length - minimum + 1) if point % 1 == 0]
    best: int | None = None
    for split_count in range(len(interior) + 1):
        for splits in itertools.combinations(interior, split_count):
            boundaries = [0, *splits, length]
            if any(later - earlier < minimum for earlier, later in itertools.pairwise(boundaries)):
                continue
            cost = (
                sum(
                    _quantized_cost(mantissas[earlier:later])
                    for earlier, later in itertools.pairwise(boundaries)
                )
                + penalty * split_count
            )
            if best is None or cost < best:
                best = cost
    assert best is not None
    return best


class TestPeltConfig:
    def test_rejects_bad_fields(self) -> None:
        with pytest.raises(ContractValueError, match="segmenter_id"):
            PeltConfigV1(segmenter_id="", penalty=0, min_segment_length=1)
        with pytest.raises(ContractValueError, match="penalty"):
            PeltConfigV1(segmenter_id="pelt-1", penalty=-1, min_segment_length=1)
        with pytest.raises(ContractValueError, match="min_segment_length"):
            PeltConfigV1(segmenter_id="pelt-1", penalty=0, min_segment_length=0)

    def test_mapping_round_trips(self) -> None:
        mapping = _config().as_mapping()
        assert mapping["minSegmentLength"] == 2
        assert mapping["penalty"] == str(10 * FIXED_POINT_SCALE)


class TestSegmentContracts:
    def test_segment_rejects_bad_bounds_and_cost(self) -> None:
        with pytest.raises(ContractValueError, match="end"):
            SegmentV1(start=3, end=3, mean=FixedPointV1(0), cost=0)
        with pytest.raises(ContractValueError, match="mean must be FixedPointV1"):
            SegmentV1(start=0, end=1, mean=0, cost=0)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="cost"):
            SegmentV1(start=0, end=1, mean=FixedPointV1(0), cost=-1)

    def test_segmentation_requires_contiguous_cover_and_true_objective(self) -> None:
        segment = SegmentV1(start=0, end=2, mean=FixedPointV1(0), cost=5)
        with pytest.raises(ContractValueError, match="non-empty tuple"):
            SegmentationV1(
                segmenter_id="pelt-1",
                point_count=2,
                penalty=0,
                segments=(),
                objective=0,
            )
        with pytest.raises(ContractValueError, match="must be SegmentV1"):
            SegmentationV1(
                segmenter_id="pelt-1",
                point_count=2,
                penalty=0,
                segments=(1,),  # type: ignore[arg-type]
                objective=0,
            )
        with pytest.raises(ContractValueError, match="tile the series contiguously"):
            SegmentationV1(
                segmenter_id="pelt-1",
                point_count=4,
                penalty=0,
                segments=(
                    segment,
                    SegmentV1(start=3, end=4, mean=FixedPointV1(0), cost=0),
                ),
                objective=5,
            )
        with pytest.raises(ContractValueError, match="cover exactly"):
            SegmentationV1(
                segmenter_id="pelt-1",
                point_count=3,
                penalty=0,
                segments=(segment,),
                objective=5,
            )
        with pytest.raises(ContractValueError, match="objective must equal"):
            SegmentationV1(
                segmenter_id="pelt-1",
                point_count=2,
                penalty=0,
                segments=(segment,),
                objective=6,
            )

    def test_boundaries_and_mapping(self) -> None:
        segmentation = SegmentationV1(
            segmenter_id="pelt-1",
            point_count=4,
            penalty=7,
            segments=(
                SegmentV1(start=0, end=2, mean=FixedPointV1(0), cost=1),
                SegmentV1(start=2, end=4, mean=FixedPointV1(0), cost=2),
            ),
            objective=10,
        )
        assert segmentation.boundaries == (2,)
        assert segmentation.as_mapping()["objective"] == "10"


class TestSegmentPelt:
    def test_rejects_bad_inputs(self) -> None:
        with pytest.raises(ContractValueError, match="values must be a tuple"):
            segment_pelt((), _config())
        with pytest.raises(ContractValueError, match="values\\[0\\]"):
            segment_pelt((1,), _config())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="config must be PeltConfigV1"):
            segment_pelt(_values([1]), "config")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="shorter than one minimum segment"):
            segment_pelt(_values([1]), _config(min_segment_length=2))
        with pytest.raises(ContractValueError, match=f"1..{MAX_PELT_POINTS}"):
            segment_pelt(tuple(FixedPointV1(0) for _ in range(MAX_PELT_POINTS + 1)), _config())

    def test_constant_series_is_one_zero_cost_segment(self) -> None:
        segmentation = segment_pelt(_values([1_000] * 12), _config())
        assert len(segmentation.segments) == 1
        assert segmentation.segments[0].cost == 0
        assert segmentation.objective == 0
        assert segmentation.segments[0].mean.mantissa == 1_000 * HUNDREDTH

    def test_two_level_series_recovers_the_exact_boundary(self) -> None:
        segmentation = segment_pelt(_values([1_000] * 10 + [1_500] * 10), _config())
        assert segmentation.boundaries == (10,)
        means = [segment.mean.mantissa for segment in segmentation.segments]
        assert means == [1_000 * HUNDREDTH, 1_500 * HUNDREDTH]

    def test_three_level_series_recovers_both_boundaries(self) -> None:
        values = [1_000] * 8 + [1_400] * 8 + [900] * 8
        segmentation = segment_pelt(_values(values), _config())
        assert segmentation.boundaries == (8, 16)

    def test_huge_penalty_suppresses_every_split(self) -> None:
        values = [1_000] * 8 + [1_400] * 8
        segmentation = segment_pelt(
            _values(values),
            _config(penalty=10**9 * FIXED_POINT_SCALE),
        )
        assert segmentation.boundaries == ()

    def test_min_segment_length_is_respected(self) -> None:
        # The last three points shift, but a minimum of four forbids that split.
        values = [1_000] * 9 + [2_000] * 3
        segmentation = segment_pelt(_values(values), _config(min_segment_length=4))
        for segment in segmentation.segments:
            assert segment.end - segment.start >= 4

    def test_matches_brute_force_on_dense_grid(self) -> None:
        values = [1_000, 1_010, 990, 1_500, 1_490, 1_510, 700, 690, 710, 705]
        mantissas = [value * HUNDREDTH for value in values]
        for penalty_scale in (1, 30, 3_000):
            penalty = penalty_scale * FIXED_POINT_SCALE // 10
            segmentation = segment_pelt(
                _values(values),
                _config(penalty=penalty, min_segment_length=1),
            )
            expected = _brute_force_objective(mantissas, penalty, 1)
            assert segmentation.objective == expected

    def test_matches_brute_force_with_min_length(self) -> None:
        values = [1_000, 1_005, 1_400, 1_410, 1_395, 900, 905, 910]
        mantissas = [value * HUNDREDTH for value in values]
        penalty = FIXED_POINT_SCALE
        segmentation = segment_pelt(
            _values(values),
            _config(penalty=penalty, min_segment_length=2),
        )
        assert segmentation.objective == _brute_force_objective(mantissas, penalty, 2)

    def test_objective_equals_recomputed_segment_costs(self) -> None:
        values = [1_000] * 6 + [1_300] * 6
        segmentation = segment_pelt(_values(values), _config())
        recomputed = sum(segment.cost for segment in segmentation.segments)
        penalties = segmentation.penalty * (len(segmentation.segments) - 1)
        assert segmentation.objective == recomputed + penalties

    def test_negative_values_quantize_signed_means(self) -> None:
        segmentation = segment_pelt(
            (FixedPointV1(-3), FixedPointV1(-4)),
            _config(min_segment_length=1, penalty=FIXED_POINT_SCALE),
        )
        assert segmentation.segments[0].mean.mantissa < 0
