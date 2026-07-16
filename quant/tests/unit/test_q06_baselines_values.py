from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.baselines import (
    BaselineCohortKeyV1,
    BoundedQuantile,
    CohortBaselineSet,
    EwmaMeanVariance,
    HistorySufficiencyV1,
    RollingMedianMad,
    cohort_key,
)
from quant_edge.features.fixedpoint import (
    FIXED_POINT_SCALE,
    FixedPointV1,
    fp_from_int,
)
from quant_edge.features.values import (
    FeatureValueStatus,
    FeatureValueV1,
    derive_feature_value,
    status_from_quality,
    worst_status,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import QualityState

BASE_NS = 1_772_000_000_000_000_000
ALPHA = FixedPointV1(FIXED_POINT_SCALE // 5)


class TestRollingMedianMad:
    def test_median_and_mad_exact_laws(self) -> None:
        baseline = RollingMedianMad(4)
        for value in (1, 9, 3, 5):
            baseline.push(fp_from_int(value))

        assert baseline.count == 4
        assert baseline.window == 4
        # Sorted 1,3,5,9 -> median mean(3,5)=4; deviations 3,1,1,5 -> mad mean(1,3)=2.
        assert baseline.median() == fp_from_int(4)
        assert baseline.mad() == fp_from_int(2)

    def test_window_eviction_and_odd_median(self) -> None:
        baseline = RollingMedianMad(3)
        for value in (1, 9, 3, 5):
            baseline.push(fp_from_int(value))

        # Window holds 9,3,5 -> median 5; deviations 0,2,4 -> mad 2.
        assert baseline.median() == fp_from_int(5)
        assert baseline.mad() == fp_from_int(2)

    def test_empty_and_contract_errors(self) -> None:
        baseline = RollingMedianMad(3)

        assert baseline.median() is None
        assert baseline.mad() is None
        with pytest.raises(ContractValueError):
            RollingMedianMad(0)
        with pytest.raises(ContractValueError):
            baseline.push(3)  # type: ignore[arg-type]


class TestEwmaMeanVariance:
    def test_seed_and_update_law(self) -> None:
        ewma = EwmaMeanVariance(ALPHA)

        assert ewma.mean() is None
        assert ewma.variance() is None
        ewma.push(fp_from_int(10))
        assert ewma.mean() == fp_from_int(10)
        assert ewma.variance() == FixedPointV1(0)
        ewma.push(fp_from_int(20))
        # mean = 10 + 0.2*10 = 12; var = 0.8*(0 + 0.2*100) = 16.
        assert ewma.mean() == fp_from_int(12)
        assert ewma.variance() == fp_from_int(16)
        assert ewma.count == 2

    def test_alpha_contract(self) -> None:
        with pytest.raises(ContractValueError):
            EwmaMeanVariance(FixedPointV1(0))
        with pytest.raises(ContractValueError):
            EwmaMeanVariance(FixedPointV1(FIXED_POINT_SCALE))
        with pytest.raises(ContractValueError):
            EwmaMeanVariance("alpha")  # type: ignore[arg-type]


class TestBoundedQuantile:
    def test_lower_order_statistic_law(self) -> None:
        quantile = BoundedQuantile(5, make_ratio(1, 2))
        for value in (5, 1, 9, 3, 7):
            quantile.push(fp_from_int(value))

        assert quantile.value() == fp_from_int(5)
        assert quantile.count == 5
        quantile.push(fp_from_int(11))  # evicts 5; sorted 1,3,7,9,11 -> median 7
        assert quantile.value() == fp_from_int(7)

    def test_extreme_quantiles_and_contracts(self) -> None:
        low = BoundedQuantile(4, make_ratio(0, 1))
        high = BoundedQuantile(4, make_ratio(1, 1))
        for value in (5, 1, 9, 3):
            low.push(fp_from_int(value))
            high.push(fp_from_int(value))

        assert low.value() == fp_from_int(1)
        assert high.value() == fp_from_int(9)
        assert BoundedQuantile(4, make_ratio(1, 2)).value() is None
        with pytest.raises(ContractValueError):
            BoundedQuantile(4, make_ratio(3, 2))
        with pytest.raises(ContractValueError):
            BoundedQuantile(4, make_ratio(-1, 2))
        with pytest.raises(ContractValueError):
            BoundedQuantile(4, "half")  # type: ignore[arg-type]


class TestCohorts:
    def test_cohort_key_buckets(self) -> None:
        key = cohort_key(
            symbol="BNBUSDT",
            event_time_ns=BASE_NS,
            time_of_day_bucket_ns=3_600_000_000_000,
            funding_cycle_ns=28_800_000_000_000,
            regime_id="regime-a",
            liquidity_bucket=2,
        )

        assert key.symbol == "BNBUSDT"
        assert key.time_of_day_bucket == (BASE_NS % 86_400_000_000_000) // 3_600_000_000_000
        assert key.funding_cycle_bucket == (BASE_NS % 86_400_000_000_000) // 28_800_000_000_000
        assert key.as_mapping()["liquidityBucket"] == 2
        with pytest.raises(ContractValueError):
            cohort_key(
                symbol="BNBUSDT",
                event_time_ns=BASE_NS,
                time_of_day_bucket_ns=0,
                funding_cycle_ns=1,
                regime_id="regime-a",
                liquidity_bucket=0,
            )
        with pytest.raises(ContractValueError):
            BaselineCohortKeyV1(
                symbol="BNBUSDT",
                time_of_day_bucket=-1,
                funding_cycle_bucket=0,
                regime_id="regime-a",
                liquidity_bucket=0,
            )

    def test_history_gate_yields_unknown_not_a_value(self) -> None:
        baselines = CohortBaselineSet(
            window=4,
            alpha=ALPHA,
            min_span_ns=10,
            min_observations=3,
        )
        key = BaselineCohortKeyV1(
            symbol="BNBUSDT",
            time_of_day_bucket=1,
            funding_cycle_bucket=0,
            regime_id="regime-a",
            liquidity_bucket=0,
        )

        assert baselines.sufficiency(key) is None
        assert baselines.median_mad(key) is None
        assert baselines.ewma_mean_variance(key) is None
        baselines.observe(key, BASE_NS, fp_from_int(10))
        baselines.observe(key, BASE_NS + 5, fp_from_int(12))
        sufficiency = baselines.sufficiency(key)
        assert sufficiency is not None
        assert not sufficiency.sufficient
        assert baselines.median_mad(key) is None
        baselines.observe(key, BASE_NS + 20, fp_from_int(14))
        sufficiency = baselines.sufficiency(key)
        assert sufficiency is not None
        assert sufficiency.sufficient
        median_mad = baselines.median_mad(key)
        ewma = baselines.ewma_mean_variance(key)
        assert median_mad is not None
        assert median_mad[0] == fp_from_int(12)
        assert ewma is not None

    def test_cohort_contracts(self) -> None:
        baselines = CohortBaselineSet(
            window=4,
            alpha=ALPHA,
            min_span_ns=10,
            min_observations=3,
        )
        key = BaselineCohortKeyV1(
            symbol="BNBUSDT",
            time_of_day_bucket=1,
            funding_cycle_bucket=0,
            regime_id="regime-a",
            liquidity_bucket=0,
        )
        with pytest.raises(ContractValueError):
            baselines.observe("key", BASE_NS, fp_from_int(1))  # type: ignore[arg-type]
        baselines.observe(key, BASE_NS + 10, fp_from_int(1))
        with pytest.raises(ContractValueError):
            baselines.observe(key, BASE_NS, fp_from_int(2))
        with pytest.raises(ContractValueError):
            CohortBaselineSet(window=0, alpha=ALPHA, min_span_ns=1, min_observations=1)
        with pytest.raises(ContractValueError):
            CohortBaselineSet(
                window=4,
                alpha=FixedPointV1(0),
                min_span_ns=1,
                min_observations=1,
            )

    def test_history_sufficiency_contract(self) -> None:
        sufficiency = HistorySufficiencyV1(
            observed_start_ns=0,
            observed_end_ns=100,
            observation_count=5,
            min_span_ns=50,
            min_observations=5,
        )

        assert sufficiency.sufficient
        assert sufficiency.as_mapping()["sufficient"] is True
        insufficient = HistorySufficiencyV1(
            observed_start_ns=0,
            observed_end_ns=40,
            observation_count=5,
            min_span_ns=50,
            min_observations=5,
        )
        assert not insufficient.sufficient
        with pytest.raises(ContractValueError):
            HistorySufficiencyV1(
                observed_start_ns=100,
                observed_end_ns=40,
                observation_count=5,
                min_span_ns=50,
                min_observations=5,
            )


class TestFeatureValues:
    def test_value_status_coherence(self) -> None:
        value = FeatureValueV1(
            feature_id="bar_return:v1",
            as_of_ns=BASE_NS + 10,
            input_last_event_ns=BASE_NS,
            status=FeatureValueStatus.AVAILABLE,
            value=fp_from_int(1),
        )

        assert value.as_mapping()["status"] == "AVAILABLE"
        with pytest.raises(ContractValueError):
            FeatureValueV1(
                feature_id="bar_return:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS,
                status=FeatureValueStatus.AVAILABLE,
                value=None,
            )
        with pytest.raises(ContractValueError):
            FeatureValueV1(
                feature_id="bar_return:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS,
                status=FeatureValueStatus.UNKNOWN,
                value=fp_from_int(1),
            )
        with pytest.raises(ContractValueError):
            FeatureValueV1(
                feature_id="bar_return:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS + 5,
                status=FeatureValueStatus.UNKNOWN,
                value=None,
            )
        with pytest.raises(ContractValueError):
            FeatureValueV1(
                feature_id="bar_return:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS,
                status="AVAILABLE",  # type: ignore[arg-type]
                value=None,
            )

    def test_quality_mapping_and_worst_status(self) -> None:
        assert status_from_quality(QualityState.COMPLETE) is FeatureValueStatus.AVAILABLE
        assert status_from_quality(QualityState.GAPPED) is FeatureValueStatus.DATA_INVALID
        assert status_from_quality(QualityState.STALE) is FeatureValueStatus.STALE
        assert status_from_quality(QualityState.UNAVAILABLE) is FeatureValueStatus.UNKNOWN
        with pytest.raises(ContractValueError):
            status_from_quality("COMPLETE")  # type: ignore[arg-type]
        assert (
            worst_status(
                (FeatureValueStatus.AVAILABLE, FeatureValueStatus.STALE),
            )
            is FeatureValueStatus.STALE
        )
        assert (
            worst_status(
                (
                    FeatureValueStatus.STALE,
                    FeatureValueStatus.DATA_INVALID,
                    FeatureValueStatus.UNKNOWN,
                ),
            )
            is FeatureValueStatus.DATA_INVALID
        )
        with pytest.raises(ContractValueError):
            worst_status(())
        with pytest.raises(ContractValueError):
            worst_status(("AVAILABLE",))  # type: ignore[arg-type]

    def test_propagation_never_upgrades(self) -> None:
        fresh = derive_feature_value(
            feature_id="bar_return:v1",
            as_of_ns=BASE_NS + 10,
            input_last_event_ns=BASE_NS + 5,
            freshness_bound_ns=10,
            input_quality=QualityState.COMPLETE,
            computed=fp_from_int(1),
        )
        stale = derive_feature_value(
            feature_id="bar_return:v1",
            as_of_ns=BASE_NS + 100,
            input_last_event_ns=BASE_NS,
            freshness_bound_ns=10,
            input_quality=QualityState.COMPLETE,
            computed=fp_from_int(1),
        )
        gapped = derive_feature_value(
            feature_id="bar_return:v1",
            as_of_ns=BASE_NS + 5,
            input_last_event_ns=BASE_NS,
            freshness_bound_ns=10,
            input_quality=QualityState.GAPPED,
            computed=fp_from_int(1),
        )
        unknown = derive_feature_value(
            feature_id="bar_return:v1",
            as_of_ns=BASE_NS + 5,
            input_last_event_ns=BASE_NS,
            freshness_bound_ns=10,
            input_quality=QualityState.COMPLETE,
            computed=None,
        )

        assert fresh.status is FeatureValueStatus.AVAILABLE
        assert fresh.value == fp_from_int(1)
        assert stale.status is FeatureValueStatus.STALE
        assert stale.value is None
        assert gapped.status is FeatureValueStatus.DATA_INVALID
        assert gapped.value is None
        assert unknown.status is FeatureValueStatus.UNKNOWN


class TestCoverageEdges:
    def test_available_value_must_be_fixed_point(self) -> None:
        with pytest.raises(ContractValueError):
            FeatureValueV1(
                feature_id="bar_return:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS,
                status=FeatureValueStatus.AVAILABLE,
                value="1",  # type: ignore[arg-type]
            )
