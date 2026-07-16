from __future__ import annotations

import runpy
import sys
from pathlib import Path

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import QualityState
from quant_edge.regime.alphabet import AlphabetConfigV1, RobustDiscretizer
from quant_edge.regime.analog import (
    AnalogExclusionReason,
    AnalogNeighborV1,
    AnalogQueryV1,
    AnalogRecordV1,
    AnalogRetrievalV1,
    AnalogStatus,
    retrieve_analogs,
)
from quant_edge.regime.anomaly import (
    DisorderConfigV1,
    DisorderReason,
    DisorderState,
    RobustAnomalyConfigV1,
    RobustAnomalyScorer,
    fuse_disorder,
)
from quant_edge.regime.bocpd import BocpdConfigV1, BocpdDetector
from quant_edge.regime.campaign import _verify_analog_law, _verify_profile_law
from quant_edge.regime.contracts import AlarmDirection, StepStatus
from quant_edge.regime.cusum import CusumConfigV1, CusumStepV1, TwoSidedCusum
from quant_edge.regime.matrix_profile import (
    ExclusionCountsV1,
    MatrixProfileConfigV1,
    MatrixProfileEntryV1,
    MatrixProfileV1,
    compute_left_profile,
)
from quant_edge.regime.metrics import evaluate_detection, evaluate_segmentation
from quant_edge.regime.page_hinkley import (
    PageHinkleyConfigV1,
    PageHinkleyStepV1,
    TwoSidedPageHinkley,
)
from quant_edge.regime.soft_regime import SoftRegimeFilter, v1_regime_spec

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
HOUR_NS = 3_600 * SECOND_NS
HUNDREDTH = FIXED_POINT_SCALE // 100


_RUNPY_REIMPORT = "ignore:.*found in sys.modules after import.*:RuntimeWarning"


class TestCampaignMain:
    @pytest.mark.filterwarnings(_RUNPY_REIMPORT)
    def test_module_main_writes_artifacts(self, tmp_path: Path) -> None:
        argv = sys.argv
        sys.argv = ["campaign", str(tmp_path)]
        try:
            with pytest.raises(SystemExit) as excinfo:
                runpy.run_module("quant_edge.regime.campaign", run_name="__main__")
        finally:
            sys.argv = argv
        assert excinfo.value.code == 0
        target = tmp_path / "generated" / "q09"
        for name in (
            "regime_golden_v1.json",
            "regime_campaign.v1.json",
            "regime_campaign.v1.md",
        ):
            assert (target / name).exists()

    @pytest.mark.filterwarnings(_RUNPY_REIMPORT)
    def test_module_main_usage_error(self) -> None:
        argv = sys.argv
        sys.argv = ["campaign"]
        try:
            with pytest.raises(SystemExit) as excinfo:
                runpy.run_module("quant_edge.regime.campaign", run_name="__main__")
        finally:
            sys.argv = argv
        assert excinfo.value.code == 2


class TestCampaignVerifiers:
    def test_profile_law_verifier_rejects_a_leaking_neighbor(self) -> None:
        entries = (
            MatrixProfileEntryV1(
                index=0,
                query_degenerate=False,
                neighbor=None,
                similarity=None,
                eligible_count=0,
            ),
            MatrixProfileEntryV1(
                index=1,
                query_degenerate=False,
                neighbor=None,
                similarity=None,
                eligible_count=0,
            ),
            MatrixProfileEntryV1(
                index=2,
                query_degenerate=False,
                neighbor=None,
                similarity=None,
                eligible_count=0,
            ),
            MatrixProfileEntryV1(
                index=3,
                query_degenerate=False,
                neighbor=2,
                similarity=FixedPointV1(FIXED_POINT_SCALE),
                eligible_count=1,
            ),
        )
        profile = MatrixProfileV1(
            profile_id="profile-bad",
            window=2,
            embargo=0,
            point_count=5,
            entries=entries,
            exclusions=ExclusionCountsV1(future=0, overlap=0, same_event=0, degenerate=0),
        )
        with pytest.raises(ValueError, match="earlier-only law"):
            _verify_profile_law(profile)

    def test_analog_law_verifier_rejects_a_leaking_neighbor(self) -> None:
        query = AnalogQueryV1(
            query_id="query-bad",
            symbol="BNBUSDT",
            regime_id=None,
            feature_id="window-v1",
            start_ns=BASE_NS,
            cutoff_ns=BASE_NS + SECOND_NS,
            embargo_ns=HOUR_NS,
            values=(FixedPointV1(1), FixedPointV1(2)),
            event_id=None,
        )
        neighbor = AnalogNeighborV1(
            record_id="analog-late",
            end_ns=BASE_NS + 2 * HOUR_NS,
            similarity=FixedPointV1(0),
            outcome_label="UNKNOWN",
            completeness=QualityState.SYNTHETIC,
        )
        exclusions = tuple(
            sorted(
                dict.fromkeys(AnalogExclusionReason, 0).items(),
                key=lambda item: item[0].value,
            )
        )
        retrieval = AnalogRetrievalV1(
            query_id="query-bad",
            status=AnalogStatus.OK,
            requested_k=1,
            cohort_size=1,
            neighbors=(neighbor,),
            outcome_counts=(("UNKNOWN", 1),),
            exclusion_counts=exclusions,
        )
        with pytest.raises(ValueError, match="earlier-only law"):
            _verify_analog_law(query, retrieval)


class TestAccessors:
    def test_every_component_exposes_its_configuration(self) -> None:
        alphabet = AlphabetConfigV1(
            baseline_window=4,
            thresholds=(FixedPointV1(FIXED_POINT_SCALE),),
        )
        assert RobustDiscretizer(alphabet).config is alphabet
        cusum_config = CusumConfigV1(
            detector_id="cusum-1",
            reference=FixedPointV1(0),
            warmup=0,
            slack_k=FixedPointV1(0),
            threshold_h=FixedPointV1(1),
        )
        assert TwoSidedCusum(cusum_config).config is cusum_config
        page_hinkley_config = PageHinkleyConfigV1(
            detector_id="ph-1",
            delta=FixedPointV1(0),
            threshold_lambda=FixedPointV1(1),
            warmup=1,
        )
        assert TwoSidedPageHinkley(page_hinkley_config).config is page_hinkley_config
        bocpd_config = BocpdConfigV1(
            detector_id="bocpd-1",
            alphabet=alphabet,
            hazard=make_ratio(1, 50),
            run_cap=4,
            alarm_run_length=1,
            alarm_threshold=FixedPointV1(1),
            alarm_warmup=2,
        )
        assert BocpdDetector(bocpd_config).config is bocpd_config
        anomaly_config = RobustAnomalyConfigV1(
            scorer_id="scorer-1",
            window=4,
            z_threshold=FixedPointV1(1),
        )
        assert RobustAnomalyScorer(anomaly_config).config is anomaly_config
        spec = v1_regime_spec()
        assert SoftRegimeFilter(spec).spec is spec


class TestRemainingContractBranches:
    def test_step_direction_type_is_enforced(self) -> None:
        with pytest.raises(ContractValueError, match="direction must be AlarmDirection"):
            CusumStepV1(
                detector_id="cusum-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=True,
                direction="UP",  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="direction must be AlarmDirection"):
            PageHinkleyStepV1(
                detector_id="ph-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                statistic_up=FixedPointV1(0),
                statistic_down=FixedPointV1(0),
                alarm=True,
                direction="DOWN",  # type: ignore[arg-type]
            )
        assert AlarmDirection.UP.value == "UP"

    def test_analog_retrieval_container_type_branches(self) -> None:
        neighbor = AnalogNeighborV1(
            record_id="analog-1",
            end_ns=BASE_NS,
            similarity=FixedPointV1(0),
            outcome_label="UNKNOWN",
            completeness=QualityState.SYNTHETIC,
        )
        exclusions = tuple(
            sorted(
                dict.fromkeys(AnalogExclusionReason, 0).items(),
                key=lambda item: item[0].value,
            )
        )
        with pytest.raises(ContractValueError, match="bounded by requested_k"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.OK,
                requested_k=1,
                cohort_size=2,
                neighbors=[neighbor],  # type: ignore[arg-type]
                outcome_counts=(("UNKNOWN", 1),),
                exclusion_counts=exclusions,
            )
        with pytest.raises(ContractValueError, match="outcome_counts must be a tuple"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.OK,
                requested_k=1,
                cohort_size=1,
                neighbors=(neighbor,),
                outcome_counts=[("UNKNOWN", 1)],  # type: ignore[arg-type]
                exclusion_counts=exclusions,
            )
        string_keyed = tuple((reason.value, count) for reason, count in exclusions)
        with pytest.raises(ContractValueError, match="keys must be reasons"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.OK,
                requested_k=1,
                cohort_size=1,
                neighbors=(neighbor,),
                outcome_counts=(("UNKNOWN", 1),),
                exclusion_counts=string_keyed,  # type: ignore[arg-type]
            )

    def test_metrics_reject_non_tuple_ordinals(self) -> None:
        with pytest.raises(ContractValueError, match="must be a tuple of ordinals"):
            evaluate_detection(
                detector_id="detector-1",
                series_id="series-1",
                series_length=10,
                detection_window=2,
                true_changes=(),
                alarms=[1],  # type: ignore[arg-type]
            )

    def test_segmentation_keeps_first_match_when_later_is_worse(self) -> None:
        report = evaluate_segmentation(
            segmenter_id="pelt-1",
            series_id="series-1",
            true_boundaries=(100,),
            detected_boundaries=(100, 103),
            slack=4,
        )
        assert report.matched == ((100, 100),)
        assert report.spurious == (103,)

    def test_disorder_fusion_keeps_the_worst_of_equal_findings(self) -> None:
        assessment = fuse_disorder(
            config=DisorderConfigV1(
                fusion_id="fusion-1",
                alarm_recency_bars=5,
                persistence_watch=2,
                persistence_ood=4,
                uncertainty_threshold=FixedPointV1(FIXED_POINT_SCALE // 2),
            ),
            input_quality=QualityState.COMPLETE,
            last_alarm_age=None,
            anomaly_persistence=2,
            regime_uncertainty=FixedPointV1(FIXED_POINT_SCALE // 2),
        )
        assert assessment.state is DisorderState.WATCH
        assert assessment.reasons == (
            DisorderReason.ANOMALY_PERSISTENCE_WATCH,
            DisorderReason.REGIME_UNCERTAIN,
        )


class TestZeroCorrelationOrdering:
    def test_profile_compares_two_zero_correlation_candidates(self) -> None:
        # A window is orthogonal to the alternating query exactly when its even
        # positions sum to its odd positions; the first two visited candidates
        # (starts 0 and 1) both satisfy that, so the comparator sees two
        # zero-sign keys and keeps the earliest.
        hundredths = [510, 500, 500, 510, 510, 503, 507, 501, 500, 510, 500, 510]
        values = tuple(FixedPointV1(value * HUNDREDTH) for value in hundredths)
        profile = compute_left_profile(
            values,
            MatrixProfileConfigV1(profile_id="profile-zero", window=4, embargo=0),
        )
        entry = profile.entries[8]
        assert entry.neighbor is not None

    def test_retrieval_ranks_zero_correlation_and_duplicate_records(self) -> None:
        query = AnalogQueryV1(
            query_id="query-zero",
            symbol="BNBUSDT",
            regime_id=None,
            feature_id="window-v1",
            start_ns=BASE_NS + 10 * HOUR_NS,
            cutoff_ns=BASE_NS + 10 * HOUR_NS + SECOND_NS,
            embargo_ns=0,
            values=tuple(FixedPointV1(value * HUNDREDTH) for value in (500, 510, 500, 510)),
            event_id=None,
        )

        def record(record_id: str, deltas: tuple[int, ...]) -> AnalogRecordV1:
            return AnalogRecordV1(
                record_id=record_id,
                symbol="BNBUSDT",
                regime_id="UNKNOWN",
                feature_id="window-v1",
                start_ns=BASE_NS + HOUR_NS - SECOND_NS,
                end_ns=BASE_NS + HOUR_NS,
                values=tuple(FixedPointV1((500 + delta) * HUNDREDTH) for delta in deltas),
                outcome_label="UNKNOWN",
                completeness=QualityState.SYNTHETIC,
                event_id=None,
            )

        orthogonal_a = record("analog-orthogonal-a", (0, 0, 10, 10))
        orthogonal_b = record("analog-orthogonal-b", (10, 10, 0, 0))
        duplicate = record("analog-orthogonal-a", (0, 0, 10, 10))
        retrieval = retrieve_analogs(
            query,
            (orthogonal_a, orthogonal_b, duplicate),
            k=3,
        )
        names = [neighbor.record_id for neighbor in retrieval.neighbors]
        assert names == [
            "analog-orthogonal-a",
            "analog-orthogonal-a",
            "analog-orthogonal-b",
        ]
        for neighbor in retrieval.neighbors:
            assert neighbor.similarity.mantissa == 0
