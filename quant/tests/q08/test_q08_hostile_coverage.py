from __future__ import annotations

import runpy
import sys
from pathlib import Path

import pytest

from quant_edge.derivatives import campaign
from quant_edge.derivatives.basis_path import (
    BasisPathV1,
    BasisPointV1,
    LegAttributionV1,
    LegDriver,
    build_basis_path,
)
from quant_edge.derivatives.convergence import (
    ConvergenceEstimateV1,
    ConvergenceTargetV1,
    estimate_convergence,
)
from quant_edge.derivatives.executable import (
    ExecutableBasisV1,
    ExecutableStatus,
    LegKind,
    NetExecutableEdgeV1,
    SizedQuoteV1,
    SizeFeasibility,
)
from quant_edge.derivatives.leadlag import (
    EVIDENCE_ONLY,
    LagCorrelationV1,
    LeadLagReportV1,
    LeadLagVerdict,
    lead_lag_report,
)
from quant_edge.derivatives.references import (
    ReferenceDifferenceStatus,
    ReferenceDifferenceV1,
    ReferenceKind,
)
from quant_edge.derivatives.sampled import SampledFeatureValueV1, SampledValueStatus
from quant_edge.derivatives.statespace import (
    FixedGainFilterV1,
    MeanReversionDiagnosticV1,
    MeanReversionStatus,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FP_ONE
from quant_edge.features.harness import EquivalenceReportV1
from quant_edge.labels.basis import BasisConstruction, ConstructionFeasibility
from quant_edge.labels.outcomes import OutcomeStatus
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import EvidenceSeriesV1, PricePointV1, SeriesKind
from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    QualityState,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _usdt(price: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT")


def _point(offset_s: int, ordinal: int, spot: int, perp: int) -> BasisPointV1:
    return BasisPointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        basis=make_ratio(perp - spot, spot),
        spot_aligned=spot,
        perp_aligned=perp,
    )


def _path(points: tuple[BasisPointV1, ...], end_offset_s: int = 100) -> BasisPathV1:
    return BasisPathV1(
        path_id="q08-hostile-path",
        spot_symbol="BNBUSDT",
        perp_symbol="BNBUSDT-PERP",
        reference_kind=ReferenceKind.LAST_TRADE,
        posture=EvidencePosture.SYNTHETIC,
        max_staleness_ns=5 * SECOND_NS,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + end_offset_s * SECOND_NS,
        points=points,
        known_gaps=(),
    )


class TestHostileTypeGuards:
    def test_reference_difference_type_guards(self) -> None:
        with pytest.raises(ContractValueError, match="ReferenceKind"):
            ReferenceDifferenceV1(
                numerator_kind="MARK",  # type: ignore[arg-type]
                denominator_kind=ReferenceKind.INDEX,
                as_of_ns=BASE_NS,
                status=ReferenceDifferenceStatus.UNKNOWN,
                value=None,
            )
        with pytest.raises(ContractValueError, match="ReferenceDifferenceStatus"):
            ReferenceDifferenceV1(
                numerator_kind=ReferenceKind.MARK,
                denominator_kind=ReferenceKind.INDEX,
                as_of_ns=BASE_NS,
                status="UNKNOWN",  # type: ignore[arg-type]
                value=None,
            )
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            ReferenceDifferenceV1(
                numerator_kind=ReferenceKind.MARK,
                denominator_kind=ReferenceKind.INDEX,
                as_of_ns=BASE_NS,
                status=ReferenceDifferenceStatus.AVAILABLE,
                value=0.005,  # type: ignore[arg-type]
            )

    def test_sampled_value_type_guards(self) -> None:
        with pytest.raises(ContractValueError, match="SampledValueStatus"):
            SampledFeatureValueV1(
                feature_id="hostile:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS,
                sampling=QualityState.SAMPLED,
                status="UNKNOWN",  # type: ignore[arg-type]
                value=None,
            )
        with pytest.raises(ContractValueError, match="FixedPointV1"):
            SampledFeatureValueV1(
                feature_id="hostile:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS,
                sampling=QualityState.SAMPLED,
                status=SampledValueStatus.AVAILABLE_SAMPLED,
                value=1.0,  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="unknown sampling quality"):
            SampledFeatureValueV1(
                feature_id="hostile:v1",
                as_of_ns=BASE_NS,
                input_last_event_ns=BASE_NS,
                sampling=QualityState.UNKNOWN,
                status=SampledValueStatus.AVAILABLE_SAMPLED,
                value=FP_ONE,
            )

    def test_basis_point_and_attribution_type_guards(self) -> None:
        with pytest.raises(ContractValueError, match="must be ExactRatioV1"):
            LegAttributionV1(
                from_time_ns=BASE_NS,
                to_time_ns=BASE_NS + SECOND_NS,
                basis_delta=0.01,  # type: ignore[arg-type]
                spot_contribution=make_ratio(0, 1),
                perp_contribution=make_ratio(0, 1),
                driver=LegDriver.NONE,
            )
        with pytest.raises(ContractValueError, match="LegDriver"):
            LegAttributionV1(
                from_time_ns=BASE_NS,
                to_time_ns=BASE_NS + SECOND_NS,
                basis_delta=make_ratio(0, 1),
                spot_contribution=make_ratio(0, 1),
                perp_contribution=make_ratio(0, 1),
                driver="NONE",  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="ReferenceKind"):
            build_basis_path(
                path_id="hostile",
                spot_series=None,  # type: ignore[arg-type]
                perp_series=None,  # type: ignore[arg-type]
                reference_kind="LAST_TRADE",  # type: ignore[arg-type]
                max_staleness_ns=SECOND_NS,
            )

    def test_executable_type_guards(self) -> None:
        quote = SizedQuoteV1(
            leg=LegKind.SPOT,
            event_time_ns=BASE_NS,
            ordinal=0,
            bid=_usdt(10_000),
            ask=_usdt(10_002),
            bid_size=None,
            ask_size=None,
        )
        with pytest.raises(ContractValueError, match="must be ExactScaledValueV1"):
            SizedQuoteV1(
                leg=LegKind.SPOT,
                event_time_ns=BASE_NS,
                ordinal=0,
                bid=100.0,  # type: ignore[arg-type]
                ask=_usdt(10_002),
                bid_size=None,
                ask_size=None,
            )
        base_fields: dict[str, object] = {
            "construction": BasisConstruction.NORMAL,
            "as_of_ns": BASE_NS,
            "intended_size": ExactScaledValueV1(coefficient=1, scale=0, unit_id="BNB"),
            "status": ExecutableStatus.UNKNOWN,
            "size_feasibility": SizeFeasibility.UNKNOWN,
            "entry_basis": None,
            "spot_time_ns": quote.event_time_ns,
            "perp_time_ns": None,
            "reasons": (),
        }
        for field, hostile, message in (
            ("construction", "NORMAL", "BasisConstruction"),
            ("status", "UNKNOWN", "ExecutableStatus"),
            ("size_feasibility", "UNKNOWN", "SizeFeasibility"),
        ):
            with pytest.raises(ContractValueError, match=message):
                ExecutableBasisV1(**{**base_fields, field: hostile})  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            ExecutableBasisV1(
                **{  # type: ignore[arg-type]
                    **base_fields,
                    "status": ExecutableStatus.AVAILABLE,
                    "entry_basis": 0.005,
                }
            )
        edge_fields: dict[str, object] = {
            "construction": BasisConstruction.NORMAL,
            "as_of_ns": BASE_NS,
            "status": ExecutableStatus.UNKNOWN,
            "feasibility": ConstructionFeasibility.FEASIBLE,
            "value": None,
            "reasons": (),
        }
        for field, hostile, message in (
            ("construction", "NORMAL", "BasisConstruction"),
            ("status", "UNKNOWN", "ExecutableStatus"),
            ("feasibility", "FEASIBLE", "ConstructionFeasibility"),
        ):
            with pytest.raises(ContractValueError, match=message):
                NetExecutableEdgeV1(**{**edge_fields, field: hostile})  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            NetExecutableEdgeV1(
                **{  # type: ignore[arg-type]
                    **edge_fields,
                    "status": ExecutableStatus.AVAILABLE,
                    "value": 0.005,
                }
            )
        with pytest.raises(ContractValueError, match="bounded tuple"):
            NetExecutableEdgeV1(**{**edge_fields, "reasons": ["REASON"]})  # type: ignore[arg-type]

    def test_convergence_type_guards(self) -> None:
        estimate_fields: dict[str, object] = {
            "construction": BasisConstruction.NORMAL,
            "definition_version": "hostile-v1",
            "threshold_fraction": make_ratio(1, 2),
            "status": OutcomeStatus.UNAVAILABLE,
            "entry_time_ns": BASE_NS,
            "entry_basis": None,
            "half_life_lower_ns": None,
            "half_life_upper_ns": None,
            "censored_duration_ns": None,
        }
        for field, hostile, message in (
            ("construction", "NORMAL", "BasisConstruction"),
            ("status", "UNAVAILABLE", "OutcomeStatus"),
            ("threshold_fraction", 0.5, "ExactRatioV1"),
        ):
            with pytest.raises(ContractValueError, match=message):
                ConvergenceEstimateV1(**{**estimate_fields, field: hostile})  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="ExactRatioV1 or None"):
            ConvergenceEstimateV1(
                **{  # type: ignore[arg-type]
                    **estimate_fields,
                    "status": OutcomeStatus.CENSORED,
                    "entry_basis": 0.01,
                    "censored_duration_ns": 5,
                }
            )
        with pytest.raises(ContractValueError, match="not censored"):
            ConvergenceEstimateV1(
                **{  # type: ignore[arg-type]
                    **estimate_fields,
                    "status": OutcomeStatus.AVAILABLE,
                    "entry_basis": make_ratio(1, 100),
                    "half_life_lower_ns": 1,
                    "half_life_upper_ns": 2,
                    "censored_duration_ns": 5,
                }
            )
        with pytest.raises(ContractValueError, match="only censored outcomes"):
            ConvergenceEstimateV1(**{**estimate_fields, "censored_duration_ns": 5})  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="BasisConstruction"):
            ConvergenceTargetV1(
                construction="NORMAL",  # type: ignore[arg-type]
                definition_version="hostile-v1",
                entry_time_ns=BASE_NS,
                duration_ns=1,
                observed=True,
            )
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            estimate_convergence(
                path=_path((_point(1, 0, 10_000, 10_060),)),
                construction=BasisConstruction.NORMAL,
                definition_version="hostile-v1",
                entry_ordinal=0,
                horizon_end_ns=BASE_NS + 10 * SECOND_NS,
                threshold_fraction=0.5,  # type: ignore[arg-type]
            )

    def test_statespace_type_guards(self) -> None:
        diagnostic_fields: dict[str, object] = {
            "status": MeanReversionStatus.UNKNOWN,
            "observations": 0,
            "phi": None,
            "half_life_steps": None,
            "half_life_censored": False,
        }
        with pytest.raises(ContractValueError, match="MeanReversionStatus"):
            MeanReversionDiagnosticV1(**{**diagnostic_fields, "status": "UNKNOWN"})  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            MeanReversionDiagnosticV1(
                **{  # type: ignore[arg-type]
                    **diagnostic_fields,
                    "status": MeanReversionStatus.AVAILABLE,
                    "phi": 0.5,
                }
            )
        with pytest.raises(ContractValueError, match="boolean"):
            MeanReversionDiagnosticV1(
                **{**diagnostic_fields, "half_life_censored": "no"}  # type: ignore[arg-type]
            )

    def test_leadlag_type_guards(self) -> None:
        correlations = tuple(
            LagCorrelationV1(lag_bars=lag, pair_count=0, signed_r_squared=None)
            for lag in range(-4, 5)
        )
        with pytest.raises(ContractValueError, match="LeadLagVerdict"):
            LeadLagReportV1(
                verdict="UNKNOWN",  # type: ignore[arg-type]
                best_lag_bars=None,
                correlations=correlations,
                stability=None,
                posture_note=EVIDENCE_ONLY,
            )
        with pytest.raises(ContractValueError, match="LagCorrelationV1"):
            LeadLagReportV1(
                verdict=LeadLagVerdict.UNKNOWN,
                best_lag_bars=None,
                correlations=("correlation",) * 9,  # type: ignore[arg-type]
                stability=None,
                posture_note=EVIDENCE_ONLY,
            )
        with pytest.raises(ContractValueError, match="ExactRatioV1 or None"):
            LeadLagReportV1(
                verdict=LeadLagVerdict.UNKNOWN,
                best_lag_bars=None,
                correlations=correlations,
                stability=0.5,  # type: ignore[arg-type]
                posture_note=EVIDENCE_ONLY,
            )


class TestRealPathEdges:
    def test_perp_observations_outside_the_overlap_are_skipped(self) -> None:
        spot_series = EvidenceSeriesV1(
            series_id="hostile-spot",
            symbol="BNBUSDT",
            kind=SeriesKind.TRADE_MID_PROXY,
            posture=EvidencePosture.SYNTHETIC,
            completeness_start_ns=BASE_NS + 20 * SECOND_NS,
            completeness_end_ns=BASE_NS + 100 * SECOND_NS,
            price_points=(
                PricePointV1(
                    event_time_ns=BASE_NS + 25 * SECOND_NS,
                    ordinal=0,
                    price=_usdt(10_000),
                ),
            ),
            quote_points=(),
            known_gaps=(),
        )
        perp_series = EvidenceSeriesV1(
            series_id="hostile-perp",
            symbol="BNBUSDT-PERP",
            kind=SeriesKind.TRADE_MID_PROXY,
            posture=EvidencePosture.SYNTHETIC,
            completeness_start_ns=BASE_NS,
            completeness_end_ns=BASE_NS + 100 * SECOND_NS,
            price_points=(
                PricePointV1(
                    event_time_ns=BASE_NS + 5 * SECOND_NS,
                    ordinal=0,
                    price=_usdt(10_060),
                ),
                PricePointV1(
                    event_time_ns=BASE_NS + 26 * SECOND_NS,
                    ordinal=1,
                    price=_usdt(10_050),
                ),
            ),
            quote_points=(),
            known_gaps=(),
        )
        path = build_basis_path(
            path_id="hostile-overlap",
            spot_series=spot_series,
            perp_series=perp_series,
            reference_kind=ReferenceKind.LAST_TRADE,
            max_staleness_ns=5 * SECOND_NS,
        )
        # The pre-overlap perp observation is skipped, never zero-filled.
        assert len(path.points) == 1
        assert path.points[0].event_time_ns == BASE_NS + 26 * SECOND_NS

    def test_convergence_scan_stops_at_the_observable_end(self) -> None:
        # Points continue past the horizon; the scan must stop and censor at it.
        path = _path(
            (
                _point(1, 0, 10_000, 10_100),
                _point(2, 1, 10_000, 10_090),
                _point(50, 2, 10_000, 10_010),
            )
        )
        estimate = estimate_convergence(
            path=path,
            construction=BasisConstruction.NORMAL,
            definition_version="hostile-v1",
            entry_ordinal=0,
            horizon_end_ns=BASE_NS + 10 * SECOND_NS,
            threshold_fraction=make_ratio(1, 2),
        )
        assert estimate.status is OutcomeStatus.CENSORED
        assert estimate.censored_duration_ns == 9 * SECOND_NS

    def test_leadlag_tie_between_lags_is_ambiguous(self) -> None:
        # A strictly periodic pattern correlates identically at several lags.
        prices = [10_000 + 100 * (index % 2) for index in range(24)]
        series_args = {
            "kind": SeriesKind.TRADE_MID_PROXY,
            "posture": EvidencePosture.SYNTHETIC,
            "completeness_start_ns": BASE_NS,
            "completeness_end_ns": BASE_NS + len(prices) * 10 * SECOND_NS,
            "quote_points": (),
            "known_gaps": (),
        }
        spot_series = EvidenceSeriesV1(
            series_id="tied-spot",
            symbol="BNBUSDT",
            price_points=tuple(
                PricePointV1(
                    event_time_ns=BASE_NS + index * 10 * SECOND_NS + SECOND_NS,
                    ordinal=index,
                    price=_usdt(price),
                )
                for index, price in enumerate(prices)
            ),
            **series_args,  # type: ignore[arg-type]
        )
        perp_series = EvidenceSeriesV1(
            series_id="tied-perp",
            symbol="BNBUSDT-PERP",
            price_points=tuple(
                PricePointV1(
                    event_time_ns=BASE_NS + index * 10 * SECOND_NS + SECOND_NS,
                    ordinal=index,
                    price=_usdt(price),
                )
                for index, price in enumerate(prices)
            ),
            **series_args,  # type: ignore[arg-type]
        )
        report = lead_lag_report(
            spot_series=spot_series,
            perp_series=perp_series,
            wall_width_ns=10 * SECOND_NS,
            anchor_ns=BASE_NS,
        )
        assert report.verdict is LeadLagVerdict.AMBIGUOUS
        assert report.best_lag_bars is None

    def test_leadlag_constant_leg_has_no_variance_and_stays_unknown(self) -> None:
        constant = [10_000] * 20
        moving = [10_000 + 37 * ((index * 7) % 5) for index in range(20)]
        series_args = {
            "kind": SeriesKind.TRADE_MID_PROXY,
            "posture": EvidencePosture.SYNTHETIC,
            "completeness_start_ns": BASE_NS,
            "completeness_end_ns": BASE_NS + 20 * 10 * SECOND_NS,
            "quote_points": (),
            "known_gaps": (),
        }
        spot_series = EvidenceSeriesV1(
            series_id="const-spot",
            symbol="BNBUSDT",
            price_points=tuple(
                PricePointV1(
                    event_time_ns=BASE_NS + index * 10 * SECOND_NS + SECOND_NS,
                    ordinal=index,
                    price=_usdt(price),
                )
                for index, price in enumerate(constant)
            ),
            **series_args,  # type: ignore[arg-type]
        )
        perp_series = EvidenceSeriesV1(
            series_id="const-perp",
            symbol="BNBUSDT-PERP",
            price_points=tuple(
                PricePointV1(
                    event_time_ns=BASE_NS + index * 10 * SECOND_NS + SECOND_NS,
                    ordinal=index,
                    price=_usdt(price),
                )
                for index, price in enumerate(moving)
            ),
            **series_args,  # type: ignore[arg-type]
        )
        report = lead_lag_report(
            spot_series=spot_series,
            perp_series=perp_series,
            wall_width_ns=10 * SECOND_NS,
            anchor_ns=BASE_NS,
        )
        assert report.verdict is LeadLagVerdict.UNKNOWN

    def test_filter_and_diagnostic_reject_non_paths(self) -> None:
        filter_v1 = FixedGainFilterV1(filter_version="hostile-v1", gain=make_ratio(1, 2))
        with pytest.raises(ContractValueError, match="BasisPathV1"):
            filter_v1.run("path")  # type: ignore[arg-type]


class TestCampaignBoundary:
    def test_main_writes_artifacts_and_reports_hashes(self, tmp_path: Path) -> None:
        exit_code = campaign.main(["campaign", str(tmp_path / "out")])
        assert exit_code == 0
        fixture = tmp_path / "out" / "tests" / "q08" / "fixtures" / "q08_derivatives_golden_v1.json"
        assert fixture.exists()

    def test_main_usage_error(self) -> None:
        assert campaign.main(["campaign"]) == 2

    @pytest.mark.filterwarnings("ignore:.*found in sys.modules.*:RuntimeWarning")
    def test_module_entrypoint_raises_system_exit(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(sys, "argv", ["campaign", str(tmp_path / "entry")])
        with pytest.raises(SystemExit) as excinfo:
            runpy.run_module("quant_edge.derivatives.campaign", run_name="__main__")
        assert excinfo.value.code == 0

    def test_a_failing_equivalence_report_stops_the_campaign(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from quant_edge.features.harness import run_equivalence as real_run

        failing = EquivalenceReportV1(
            feature_id="basis_gap_velocity:v1",
            bars=1,
            compared_values=0,
            status_mismatches=1,
            max_ulp_deviation=0,
            tolerance_ulp=0,
            passed=False,
            streaming_vector_digest=DigestV1("0" * 64),
        )

        def fail_first(implementation: object, bars: object) -> EquivalenceReportV1:
            return failing

        monkeypatch.setattr(campaign, "run_equivalence", fail_first)
        with pytest.raises(ValueError, match="golden equivalence failed"):
            campaign.build_artifacts()

        calls = {"count": 0}

        def fail_seeded(implementation: object, bars: object) -> EquivalenceReportV1:
            calls["count"] += 1
            if calls["count"] <= 4:
                return real_run(implementation, bars)  # type: ignore[arg-type]
            return failing

        monkeypatch.setattr(campaign, "run_equivalence", fail_seeded)
        with pytest.raises(ValueError, match="seeded equivalence failed"):
            campaign.build_artifacts()
