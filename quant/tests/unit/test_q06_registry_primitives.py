from __future__ import annotations

from dataclasses import replace

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.domains import (
    BarSeriesV1,
    BarV1,
    FeaturePointV1,
    FeatureSeriesV1,
    WallTimeBarSpecV1,
    build_bars,
)
from quant_edge.features.fixedpoint import FixedPointV1, fp_from_int
from quant_edge.features.harness import (
    EquivalenceReportV1,
    run_equivalence,
    streaming_vector,
    vector_digest,
)
from quant_edge.features.primitives import (
    MAX_BATCH_POINTS,
    FeatureImplementationV1,
    activity_intensity_feature,
    bar_return_feature,
    ewma_variance_feature,
    robust_z_feature,
    v1_features,
)
from quant_edge.features.registry import (
    FeatureRegistryV1,
    render_registry_markdown,
    verify_registry_markdown,
)
from quant_edge.lake.contracts import EvidencePosture, ExactScaledValueV1

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _scaled(coefficient: int, scale: int = 2) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id="USDT")


def _series(prices: tuple[int, ...], *, spacing_s: int = 2) -> FeatureSeriesV1:
    points = tuple(
        FeaturePointV1(
            event_time_ns=BASE_NS + index * spacing_s * SECOND_NS,
            ordinal=index + 1,
            value=_scaled(price),
            volume=_scaled(5, scale=0),
        )
        for index, price in enumerate(prices)
    )
    return FeatureSeriesV1(
        series_id="series-1",
        symbol="BNBUSDT",
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + (len(prices) * spacing_s + 10) * SECOND_NS,
        points=points,
    )


def _bars(prices: tuple[int, ...], *, width_s: int = 10) -> BarSeriesV1:
    return build_bars(
        _series(prices),
        WallTimeBarSpecV1(wall_width_ns=width_s * SECOND_NS, anchor_ns=BASE_NS),
    )


WALK = tuple(10_000 + ((i * 37) % 11 - 5) * 7 for i in range(60))


class TestRegistry:
    def test_registry_digest_and_markdown_law(self) -> None:
        cards = tuple(sorted((f.card for f in v1_features()), key=lambda c: c.feature_id))
        registry = FeatureRegistryV1(registry_version="q06-features-v1", cards=cards)
        markdown = render_registry_markdown(registry)

        verify_registry_markdown(markdown, registry)
        assert (
            registry.content_digest
            == FeatureRegistryV1(
                registry_version="q06-features-v1",
                cards=cards,
            ).content_digest
        )
        with pytest.raises(ContractValueError):
            verify_registry_markdown(markdown + "tampered", registry)
        with pytest.raises(ContractValueError):
            render_registry_markdown("registry")  # type: ignore[arg-type]

    def test_registry_rejects_duplicates_and_disorder(self) -> None:
        card = bar_return_feature().card
        with pytest.raises(ContractValueError):
            FeatureRegistryV1(registry_version="v1", cards=(card, card))
        other = activity_intensity_feature().card
        with pytest.raises(ContractValueError):
            FeatureRegistryV1(registry_version="v1", cards=(card, other))
        with pytest.raises(ContractValueError):
            FeatureRegistryV1(registry_version="v1", cards=())
        with pytest.raises(ContractValueError):
            FeatureRegistryV1(registry_version="v1", cards=("card",))  # type: ignore[arg-type]

    def test_card_completeness_law(self) -> None:
        card = bar_return_feature().card

        assert card.feature_id == "bar_return:v1"
        assert card.as_mapping()["schema"] == "Q06FeatureCardV1"
        with pytest.raises(ContractValueError):
            replace(card, economic_hypothesis="   ")
        with pytest.raises(ContractValueError):
            replace(card, inputs=())
        with pytest.raises(ContractValueError):
            replace(card, inputs=("b", "a"))
        with pytest.raises(ContractValueError):
            replace(card, domain="WALL_TIME")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            replace(card, equivalence_tolerance_ulp=-1)
        with pytest.raises(ContractValueError):
            replace(card, lower_bound="0")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            replace(
                card,
                lower_bound=fp_from_int(2),
                upper_bound=fp_from_int(1),
            )
        bounded = replace(card, lower_bound=fp_from_int(-1), upper_bound=fp_from_int(1))
        assert bounded.as_mapping()["lowerBound"] == fp_from_int(-1).as_mapping()


class TestPrimitives:
    def test_all_v1_features_pass_equivalence_on_a_walk(self) -> None:
        bars = _bars(WALK)
        for implementation in v1_features():
            report = run_equivalence(implementation, bars)
            assert report.passed, report.as_mapping()
            assert report.status_mismatches == 0

    def test_bar_return_values(self) -> None:
        bars = _bars((10_000, 10_100, 10_100, 9_900), width_s=2)
        vector = streaming_vector(bar_return_feature(), bars)

        assert vector[0] is None
        assert vector[1] is not None
        assert vector[1].mantissa == 10_000_000_000  # +1%
        assert vector[2] is not None
        assert vector[2].mantissa == 0

    def test_activity_counts_and_empty_bars(self) -> None:
        bars = _bars((10_000, 10_100), width_s=1)
        vector = streaming_vector(activity_intensity_feature(), bars)

        assert vector[0] == fp_from_int(1)
        assert vector[1] == fp_from_int(0)

    def test_robust_z_requires_history_and_nonzero_mad(self) -> None:
        constant = _bars(tuple([10_000] * 12), width_s=2)
        vector = streaming_vector(robust_z_feature(), constant)

        assert all(value is None for value in vector)

        varied = _bars(WALK, width_s=2)
        varied_vector = streaming_vector(robust_z_feature(), varied)
        assert any(value is not None for value in varied_vector)
        assert all(value is None for value in varied_vector[:8])

    def test_ewma_variance_seeds_at_zero(self) -> None:
        bars = _bars((10_000, 10_100, 10_050), width_s=2)
        vector = streaming_vector(ewma_variance_feature(), bars)

        assert vector[0] is None
        assert vector[1] == FixedPointV1(0)
        assert vector[2] is not None
        assert vector[2].mantissa > 0

    def test_batch_reference_is_bounded(self) -> None:
        implementation = ewma_variance_feature()
        closes = tuple(
            BarV1(
                index=index,
                start_ns=BASE_NS + index,
                end_ns=BASE_NS + index + 1,
                point_count=1,
                first_value_aligned=10**36,
                last_value_aligned=10**36,
                volume_aligned_total=None,
                complete=True,
            )
            for index in range(MAX_BATCH_POINTS + 2)
        )
        with pytest.raises(ContractValueError):
            implementation.batch(closes)

    def test_implementation_contract(self) -> None:
        with pytest.raises(ContractValueError):
            FeatureImplementationV1(
                card="card",  # type: ignore[arg-type]
                batch=lambda bars: None,
                make_streaming=lambda: None,  # type: ignore[arg-type,return-value]
            )
        with pytest.raises(ContractValueError):
            FeatureImplementationV1(
                card=bar_return_feature().card,
                batch="batch",  # type: ignore[arg-type]
                make_streaming=lambda: None,  # type: ignore[arg-type,return-value]
            )


class TestHarness:
    def test_report_contract_binds_measured_truth(self) -> None:
        bars = _bars(WALK)
        report = run_equivalence(bar_return_feature(), bars)

        assert report.as_mapping()["passed"] is True
        with pytest.raises(ContractValueError):
            EquivalenceReportV1(
                feature_id=report.feature_id,
                bars=report.bars,
                compared_values=report.compared_values,
                status_mismatches=report.status_mismatches,
                max_ulp_deviation=report.tolerance_ulp + 1,
                tolerance_ulp=report.tolerance_ulp,
                passed=True,
                streaming_vector_digest=report.streaming_vector_digest,
            )
        with pytest.raises(ContractValueError):
            EquivalenceReportV1(
                feature_id=report.feature_id,
                bars=report.bars,
                compared_values=report.compared_values,
                status_mismatches=report.status_mismatches,
                max_ulp_deviation=report.max_ulp_deviation,
                tolerance_ulp=report.tolerance_ulp,
                passed=report.passed,
                streaming_vector_digest="digest",  # type: ignore[arg-type]
            )

    def test_disagreement_fails_the_feature(self) -> None:
        base = bar_return_feature()
        broken = FeatureImplementationV1(
            card=base.card,
            batch=lambda bars: None,
            make_streaming=base.make_streaming,
        )
        report = run_equivalence(broken, _bars(WALK))

        assert not report.passed
        assert report.status_mismatches > 0

    def test_vector_digest_is_deterministic(self) -> None:
        bars = _bars(WALK)
        first = streaming_vector(bar_return_feature(), bars)
        second = streaming_vector(bar_return_feature(), bars)

        assert vector_digest(first) == vector_digest(second)
        with pytest.raises(ContractValueError):
            streaming_vector("implementation", bars)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            streaming_vector(bar_return_feature(), "bars")  # type: ignore[arg-type]


class TestCoverageEdges:
    def test_batch_robust_z_returns_none_on_zero_mad(self) -> None:
        constant = _bars(tuple([10_000] * 24), width_s=2)
        pointful = tuple(bar for bar in constant.bars if bar.complete and bar.point_count > 0)
        assert len(pointful) >= 9
        assert robust_z_feature().batch(pointful) is None

    def test_reduce_handles_coprime_and_common_factors(self) -> None:
        from quant_edge.features.primitives import _reduce

        assert _reduce(3, 7) == (3, 7)
        assert _reduce(6, 4) == (3, 2)
