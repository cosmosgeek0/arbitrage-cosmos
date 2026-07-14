from __future__ import annotations

import pytest

from quant_edge.derivatives.basis_path import BasisPathV1, BasisPointV1
from quant_edge.derivatives.convergence import (
    ConvergenceEstimateV1,
    ConvergenceTargetV1,
    convergence_target,
    estimate_convergence,
)
from quant_edge.derivatives.references import ReferenceKind
from quant_edge.derivatives.statespace import (
    CHALLENGER_STATUS,
    MAX_HALF_LIFE_STEPS,
    FilterStepV1,
    FixedGainFilterV1,
    MeanReversionDiagnosticV1,
    MeanReversionStatus,
    mean_reversion_diagnostic,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE
from quant_edge.labels.basis import BasisConstruction
from quant_edge.labels.outcomes import OutcomeStatus
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import GapIntervalV1
from quant_edge.lake.contracts import EvidencePosture

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _point(offset_s: int, ordinal: int, basis_bps: int) -> BasisPointV1:
    spot = 10_000_000
    perp = spot + spot * basis_bps // 10_000
    return BasisPointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        basis=make_ratio(perp - spot, spot),
        spot_aligned=spot,
        perp_aligned=perp,
    )


def _path(
    bases_bps: list[int],
    *,
    step_s: int = 2,
    end_offset_s: int | None = None,
    gaps: tuple[GapIntervalV1, ...] = (),
) -> BasisPathV1:
    points = tuple(
        _point(index * step_s, index, basis_bps) for index, basis_bps in enumerate(bases_bps)
    )
    end = (
        BASE_NS + (len(bases_bps) * step_s + 5) * SECOND_NS
        if end_offset_s is None
        else BASE_NS + end_offset_s * SECOND_NS
    )
    return BasisPathV1(
        path_id="q08-ss-path",
        spot_symbol="BNBUSDT",
        perp_symbol="BNBUSDT-PERP",
        reference_kind=ReferenceKind.LAST_TRADE,
        posture=EvidencePosture.SYNTHETIC,
        max_staleness_ns=5 * SECOND_NS,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=end,
        points=points,
        known_gaps=gaps,
    )


class TestFixedGainFilter:
    def test_gain_law(self) -> None:
        with pytest.raises(ContractValueError, match="in \\(0, 1\\]"):
            FixedGainFilterV1(filter_version="q08-test-v1", gain=make_ratio(0, 1))
        with pytest.raises(ContractValueError, match="in \\(0, 1\\]"):
            FixedGainFilterV1(filter_version="q08-test-v1", gain=make_ratio(3, 2))
        with pytest.raises(ContractValueError, match="in \\(0, 1\\]"):
            FixedGainFilterV1(filter_version="q08-test-v1", gain=make_ratio(-1, 4))
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            FixedGainFilterV1(filter_version="q08-test-v1", gain=0.25)  # type: ignore[arg-type]
        assert FixedGainFilterV1(
            filter_version="q08-test-v1", gain=make_ratio(1, 1)
        ).gain == make_ratio(1, 1)

    def test_run_follows_the_documented_recurrence(self) -> None:
        filter_v1 = FixedGainFilterV1(filter_version="q08-test-v1", gain=make_ratio(1, 4))
        steps = filter_v1.run(_path([100, 200, 200, 0]))
        assert [step.innovation.mantissa for step in steps] == [
            0,
            10_000_000_000,
            7_500_000_000,
            -14_375_000_000,
        ]
        # estimate_0 = 100bp; estimate_1 = 100 + 25 = 125bp; estimate_2 =
        # 125 + 18.75 = 143.75bp; estimate_3 = 143.75 - 35.9375 = 107.8125bp.
        assert steps[1].estimate.mantissa == 125 * FIXED_POINT_SCALE // 10_000
        assert steps[2].estimate.mantissa == 14_375_000_000
        assert steps[3].estimate.mantissa == 10_781_250_000

    def test_empty_path_yields_no_steps(self) -> None:
        filter_v1 = FixedGainFilterV1(filter_version="q08-test-v1", gain=make_ratio(1, 4))
        assert filter_v1.run(_path([])) == ()
        with pytest.raises(ContractValueError, match="BasisPathV1"):
            filter_v1.run(None)  # type: ignore[arg-type]

    def test_challenger_status_is_reference_only(self) -> None:
        filter_v1 = FixedGainFilterV1(filter_version="q08-test-v1", gain=make_ratio(1, 4))
        assert filter_v1.challenger_status == CHALLENGER_STATUS == "REFERENCE_ONLY"

    def test_step_contract(self) -> None:
        with pytest.raises(ContractValueError, match="FixedPointV1"):
            FilterStepV1(event_time_ns=BASE_NS, estimate=1, innovation=None)  # type: ignore[arg-type]


class TestMeanReversionDiagnostic:
    def test_insufficient_history_stays_unknown(self) -> None:
        observed = mean_reversion_diagnostic(_path([100, 90, 80]))
        assert observed.status is MeanReversionStatus.UNKNOWN
        assert observed.phi is None
        assert observed.half_life_steps is None

    def test_all_zero_basis_stays_unknown(self) -> None:
        observed = mean_reversion_diagnostic(_path([0] * 10))
        assert observed.status is MeanReversionStatus.UNKNOWN
        assert observed.phi is None

    def test_exact_geometric_decay_has_the_exact_discrete_half_life(self) -> None:
        # basis halves every step: phi = 1/2, half-life exactly one step.
        observed = mean_reversion_diagnostic(_path([1_024, 512, 256, 128, 64, 32, 16, 8, 4, 2]))
        assert observed.status is MeanReversionStatus.AVAILABLE
        assert observed.phi == make_ratio(1, 2)
        assert observed.half_life_steps == 1
        assert not observed.half_life_censored

    def test_slow_decay_yields_a_larger_half_life(self) -> None:
        # phi = 3/4: smallest k with (3/4)^k <= 1/2 is 3.
        bases = [10_000]
        for _ in range(11):
            bases.append(bases[-1] * 3 // 4)
        observed = mean_reversion_diagnostic(_path(bases))
        assert observed.status is MeanReversionStatus.AVAILABLE
        assert observed.phi is not None
        assert observed.half_life_steps == 3

    def test_expanding_basis_is_non_mean_reverting(self) -> None:
        observed = mean_reversion_diagnostic(_path([10, 20, 40, 80, 160, 320, 640, 1_280, 2_560]))
        assert observed.status is MeanReversionStatus.NON_MEAN_REVERTING
        assert observed.phi is not None
        assert observed.half_life_steps is None
        assert not observed.half_life_censored

    def test_near_unit_root_is_censored_honestly(self) -> None:
        # A very slow decay whose half-life exceeds the bounded maximum.
        bases = [1_000_000 - index for index in range(20)]
        observed = mean_reversion_diagnostic(_path(bases))
        assert observed.status is MeanReversionStatus.AVAILABLE
        assert observed.half_life_steps is None
        assert observed.half_life_censored

    def test_oscillating_decay_uses_the_absolute_root(self) -> None:
        # basis alternates sign while halving: phi = -1/2, half-life one step.
        observed = mean_reversion_diagnostic(
            _path([1_024, -512, 256, -128, 64, -32, 16, -8, 4, -2])
        )
        assert observed.status is MeanReversionStatus.AVAILABLE
        assert observed.phi == make_ratio(-1, 2)
        assert observed.half_life_steps == 1

    def test_diagnostic_contract_laws(self) -> None:
        with pytest.raises(ContractValueError, match="BasisPathV1"):
            mean_reversion_diagnostic(None)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="verdict exists"):
            MeanReversionDiagnosticV1(
                status=MeanReversionStatus.UNKNOWN,
                observations=10,
                phi=make_ratio(1, 2),
                half_life_steps=None,
                half_life_censored=False,
            )
        with pytest.raises(ContractValueError, match="uncensored AVAILABLE"):
            MeanReversionDiagnosticV1(
                status=MeanReversionStatus.NON_MEAN_REVERTING,
                observations=10,
                phi=make_ratio(3, 2),
                half_life_steps=1,
                half_life_censored=False,
            )
        with pytest.raises(ContractValueError, match="censoring only applies"):
            MeanReversionDiagnosticV1(
                status=MeanReversionStatus.NON_MEAN_REVERTING,
                observations=10,
                phi=make_ratio(3, 2),
                half_life_steps=None,
                half_life_censored=True,
            )
        with pytest.raises(ContractValueError, match="half_life_steps"):
            MeanReversionDiagnosticV1(
                status=MeanReversionStatus.AVAILABLE,
                observations=10,
                phi=make_ratio(1, 2),
                half_life_steps=MAX_HALF_LIFE_STEPS + 1,
                half_life_censored=False,
            )


class TestConvergenceEstimate:
    def test_observed_crossing_is_bracketed_between_observations(self) -> None:
        path = _path([100, 90, 70, 45, 30])
        estimate = estimate_convergence(
            path=path,
            construction=BasisConstruction.NORMAL,
            definition_version="q08-convergence-v1",
            entry_ordinal=0,
            horizon_end_ns=path.completeness_end_ns,
            threshold_fraction=make_ratio(1, 2),
        )
        assert estimate.status is OutcomeStatus.AVAILABLE
        # |basis| reaches 45bp <= 50bp at the fourth observation (t=6s); the
        # previous observation (t=4s) still exceeded the threshold.
        assert estimate.half_life_lower_ns == 4 * SECOND_NS
        assert estimate.half_life_upper_ns == 6 * SECOND_NS
        assert estimate.censored_duration_ns is None
        assert estimate.entry_basis is not None

    def test_non_convergence_is_right_censored_at_the_observable_end(self) -> None:
        path = _path([100, 90, 80, 75, 70], end_offset_s=20)
        estimate = estimate_convergence(
            path=path,
            construction=BasisConstruction.REVERSE,
            definition_version="q08-convergence-v1",
            entry_ordinal=0,
            horizon_end_ns=path.completeness_end_ns + 100 * SECOND_NS,
            threshold_fraction=make_ratio(1, 2),
        )
        assert estimate.status is OutcomeStatus.CENSORED
        # Censoring stops at the completeness end, never at the later horizon.
        assert estimate.censored_duration_ns == 20 * SECOND_NS
        assert estimate.half_life_lower_ns is None

    def test_gap_over_the_interval_is_data_invalid(self) -> None:
        path = _path(
            [100, 90, 45],
            gaps=(GapIntervalV1(start_ns=BASE_NS + 1 * SECOND_NS, end_ns=BASE_NS + 2 * SECOND_NS),),
        )
        estimate = estimate_convergence(
            path=path,
            construction=BasisConstruction.NORMAL,
            definition_version="q08-convergence-v1",
            entry_ordinal=0,
            horizon_end_ns=path.completeness_end_ns,
            threshold_fraction=make_ratio(1, 2),
        )
        assert estimate.status is OutcomeStatus.DATA_INVALID
        assert estimate.entry_basis is None

    def test_zero_entry_basis_has_no_convergence_question(self) -> None:
        estimate = estimate_convergence(
            path=_path([0, 10, 20]),
            construction=BasisConstruction.NORMAL,
            definition_version="q08-convergence-v1",
            entry_ordinal=0,
            horizon_end_ns=BASE_NS + 100 * SECOND_NS,
            threshold_fraction=make_ratio(1, 2),
        )
        assert estimate.status is OutcomeStatus.UNAVAILABLE

    def test_entry_and_horizon_laws(self) -> None:
        path = _path([100, 90])
        with pytest.raises(ContractValueError, match="identify a path point"):
            estimate_convergence(
                path=path,
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                entry_ordinal=99,
                horizon_end_ns=path.completeness_end_ns,
                threshold_fraction=make_ratio(1, 2),
            )
        with pytest.raises(ContractValueError, match="follow the entry"):
            estimate_convergence(
                path=path,
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                entry_ordinal=0,
                horizon_end_ns=BASE_NS,
                threshold_fraction=make_ratio(1, 2),
            )
        with pytest.raises(ContractValueError, match="in \\[0, 1\\)"):
            estimate_convergence(
                path=path,
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                entry_ordinal=0,
                horizon_end_ns=path.completeness_end_ns,
                threshold_fraction=make_ratio(3, 2),
            )
        with pytest.raises(ContractValueError, match="BasisPathV1"):
            estimate_convergence(
                path=None,  # type: ignore[arg-type]
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                entry_ordinal=0,
                horizon_end_ns=BASE_NS + SECOND_NS,
                threshold_fraction=make_ratio(1, 2),
            )
        with pytest.raises(ContractValueError, match="BasisConstruction"):
            estimate_convergence(
                path=path,
                construction="NORMAL",  # type: ignore[arg-type]
                definition_version="q08-convergence-v1",
                entry_ordinal=0,
                horizon_end_ns=path.completeness_end_ns,
                threshold_fraction=make_ratio(1, 2),
            )

    def test_entry_at_the_completeness_edge_is_unavailable(self) -> None:
        # The entry observation sits exactly at the completeness end, so no
        # observable window follows it even though the horizon lies later.
        path = BasisPathV1(
            path_id="q08-edge-path",
            spot_symbol="BNBUSDT",
            perp_symbol="BNBUSDT-PERP",
            reference_kind=ReferenceKind.LAST_TRADE,
            posture=EvidencePosture.SYNTHETIC,
            max_staleness_ns=5 * SECOND_NS,
            completeness_start_ns=BASE_NS,
            completeness_end_ns=BASE_NS + SECOND_NS,
            points=(_point(1, 0, 100),),
            known_gaps=(),
        )
        estimate = estimate_convergence(
            path=path,
            construction=BasisConstruction.NORMAL,
            definition_version="q08-convergence-v1",
            entry_ordinal=0,
            horizon_end_ns=BASE_NS + 100 * SECOND_NS,
            threshold_fraction=make_ratio(1, 2),
        )
        assert estimate.status is OutcomeStatus.UNAVAILABLE

    def test_estimate_contract_laws(self) -> None:
        with pytest.raises(ContractValueError, match="carries its bracket"):
            ConvergenceEstimateV1(
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                threshold_fraction=make_ratio(1, 2),
                status=OutcomeStatus.AVAILABLE,
                entry_time_ns=BASE_NS,
                entry_basis=make_ratio(1, 100),
                half_life_lower_ns=None,
                half_life_upper_ns=None,
                censored_duration_ns=None,
            )
        with pytest.raises(ContractValueError, match="lower < upper"):
            ConvergenceEstimateV1(
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                threshold_fraction=make_ratio(1, 2),
                status=OutcomeStatus.AVAILABLE,
                entry_time_ns=BASE_NS,
                entry_basis=make_ratio(1, 100),
                half_life_lower_ns=5,
                half_life_upper_ns=5,
                censored_duration_ns=None,
            )
        with pytest.raises(ContractValueError, match="carries its duration"):
            ConvergenceEstimateV1(
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                threshold_fraction=make_ratio(1, 2),
                status=OutcomeStatus.CENSORED,
                entry_time_ns=BASE_NS,
                entry_basis=make_ratio(1, 100),
                half_life_lower_ns=None,
                half_life_upper_ns=None,
                censored_duration_ns=None,
            )
        with pytest.raises(ContractValueError, match="only observed convergences"):
            ConvergenceEstimateV1(
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                threshold_fraction=make_ratio(1, 2),
                status=OutcomeStatus.CENSORED,
                entry_time_ns=BASE_NS,
                entry_basis=make_ratio(1, 100),
                half_life_lower_ns=1,
                half_life_upper_ns=2,
                censored_duration_ns=5,
            )
        with pytest.raises(ContractValueError, match="outcome exists"):
            ConvergenceEstimateV1(
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                threshold_fraction=make_ratio(1, 2),
                status=OutcomeStatus.UNAVAILABLE,
                entry_time_ns=BASE_NS,
                entry_basis=make_ratio(1, 100),
                half_life_lower_ns=None,
                half_life_upper_ns=None,
                censored_duration_ns=None,
            )


class TestConvergenceTarget:
    def test_observed_target_uses_the_upper_bracket(self) -> None:
        path = _path([100, 90, 70, 45, 30])
        estimate = estimate_convergence(
            path=path,
            construction=BasisConstruction.NORMAL,
            definition_version="q08-convergence-v1",
            entry_ordinal=0,
            horizon_end_ns=path.completeness_end_ns,
            threshold_fraction=make_ratio(1, 2),
        )
        target = convergence_target(estimate)
        assert target is not None
        assert target.observed
        assert target.duration_ns == 6 * SECOND_NS
        assert target.construction is BasisConstruction.NORMAL

    def test_censored_target_is_not_observed(self) -> None:
        path = _path([100, 90, 80], end_offset_s=20)
        estimate = estimate_convergence(
            path=path,
            construction=BasisConstruction.REVERSE,
            definition_version="q08-convergence-v1",
            entry_ordinal=0,
            horizon_end_ns=path.completeness_end_ns,
            threshold_fraction=make_ratio(1, 2),
        )
        target = convergence_target(estimate)
        assert target is not None
        assert not target.observed
        assert target.duration_ns == 20 * SECOND_NS
        assert target.construction is BasisConstruction.REVERSE

    def test_no_outcome_projects_to_nothing(self) -> None:
        estimate = estimate_convergence(
            path=_path([0, 10]),
            construction=BasisConstruction.NORMAL,
            definition_version="q08-convergence-v1",
            entry_ordinal=0,
            horizon_end_ns=BASE_NS + 100 * SECOND_NS,
            threshold_fraction=make_ratio(1, 2),
        )
        assert convergence_target(estimate) is None
        with pytest.raises(ContractValueError, match="ConvergenceEstimateV1"):
            convergence_target(None)  # type: ignore[arg-type]

    def test_target_contract_laws(self) -> None:
        with pytest.raises(ContractValueError, match="duration_ns"):
            ConvergenceTargetV1(
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                entry_time_ns=BASE_NS,
                duration_ns=0,
                observed=True,
            )
        with pytest.raises(ContractValueError, match="boolean"):
            ConvergenceTargetV1(
                construction=BasisConstruction.NORMAL,
                definition_version="q08-convergence-v1",
                entry_time_ns=BASE_NS,
                duration_ns=1,
                observed="yes",  # type: ignore[arg-type]
            )
