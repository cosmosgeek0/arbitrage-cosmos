from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.labels.basis import (
    BasisConstruction,
    BasisCostAssumptionV1,
    BasisDefinitionV1,
    BasisLabelV1,
    BorrowAssumptionV1,
    BorrowKnownness,
    ConstructionFeasibility,
    FundingEventV1,
    compute_basis_label,
)
from quant_edge.labels.outcomes import OutcomeStatus
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import (
    EvidenceSeriesV1,
    GapIntervalV1,
    PricePointV1,
    QuotePointV1,
    SeriesKind,
)
from quant_edge.lake.contracts import EvidencePosture, ExactScaledValueV1

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _scaled(coefficient: int, scale: int = 2) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id="USDT")


def _point(offset_s: int, coefficient: int, ordinal: int) -> PricePointV1:
    return PricePointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        price=_scaled(coefficient),
    )


def _series(
    points: tuple[PricePointV1, ...],
    *,
    series_id: str,
    end_s: int = 7_200,
    gaps: tuple[GapIntervalV1, ...] = (),
) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id=series_id,
        symbol="BNBUSDT",
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        completeness_end_ns=BASE_NS + end_s * SECOND_NS,
        price_points=points,
        quote_points=(),
        known_gaps=gaps,
    )


def _definition() -> BasisDefinitionV1:
    return BasisDefinitionV1(
        definition_version="basis-v1",
        max_reference_staleness_ns=60 * SECOND_NS,
        partial_convergence_fraction=make_ratio(1, 2),
        full_convergence_fraction=make_ratio(1, 10),
    )


def _costs() -> BasisCostAssumptionV1:
    return BasisCostAssumptionV1(
        assumption_version="fees-v1",
        per_leg_fee=make_ratio(1, 1_000),
        entry_slippage=make_ratio(1, 2_000),
        exit_slippage=make_ratio(1, 2_000),
        recovery_cost=make_ratio(1, 1_000),
    )


def _borrow(knownness: BorrowKnownness = BorrowKnownness.UNKNOWN) -> BorrowAssumptionV1:
    return BorrowAssumptionV1(
        assumption_version="borrow-v1",
        knownness=knownness,
        hourly_rate=(
            make_ratio(1, 10_000) if knownness is BorrowKnownness.KNOWN_AVAILABLE else None
        ),
    )


SPOT_POINTS = (
    _point(-5, 10_000, 1),
    _point(60, 10_000, 2),
    _point(870, 10_000, 3),
    _point(1_800, 10_000, 4),
)
PERP_POINTS = (
    _point(-3, 10_400, 1),
    _point(120, 10_150, 2),
    _point(900, 10_020, 3),
)


def _compute(
    *,
    construction: BasisConstruction = BasisConstruction.NORMAL,
    spot: EvidenceSeriesV1 | None = None,
    perp: EvidenceSeriesV1 | None = None,
    borrow: BorrowAssumptionV1 | None = None,
    funding: tuple[FundingEventV1, ...] = (),
    end_s: int = 3_600,
) -> BasisLabelV1:
    return compute_basis_label(
        construction=construction,
        spot_series=spot or _series(SPOT_POINTS, series_id="spot-1"),
        perp_series=perp or _series(PERP_POINTS, series_id="perp-1"),
        label_start_ns=BASE_NS,
        label_end_ns=BASE_NS + end_s * SECOND_NS,
        definition=_definition(),
        costs=_costs(),
        borrow=borrow or _borrow(),
        funding_schedule=funding,
    )


class TestBasisComputation:
    def test_entry_basis_and_convergence_path(self) -> None:
        label = _compute()

        assert label.status is OutcomeStatus.AVAILABLE
        assert label.entry_basis == make_ratio(4, 100)
        # 4% gross edge minus 4 x 0.1% fees, 2 x 0.05% slippage and 0.1% recovery.
        assert label.net_entry_edge == make_ratio(34, 1_000)
        assert label.partial_convergence_time_ns == BASE_NS + 120 * SECOND_NS
        assert label.full_convergence_time_ns == BASE_NS + 900 * SECOND_NS
        assert label.convergence_censor_time_ns is None
        assert label.feasibility is ConstructionFeasibility.FEASIBLE

    @pytest.mark.parametrize(
        ("perp_price", "construction", "expected_negative"),
        [
            (10_400, BasisConstruction.NORMAL, False),
            (10_400, BasisConstruction.REVERSE, True),
            (9_600, BasisConstruction.NORMAL, True),
            (9_600, BasisConstruction.REVERSE, False),
        ],
    )
    def test_net_entry_edge_is_signed_for_each_trade_direction(
        self,
        perp_price: int,
        construction: BasisConstruction,
        expected_negative: bool,
    ) -> None:
        spot = _series((_point(-5, 10_000, 1),), series_id="spot-direction")
        perp = _series((_point(-3, perp_price, 1),), series_id="perp-direction")
        label = _compute(
            construction=construction,
            spot=spot,
            perp=perp,
            borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
        )

        assert label.status is OutcomeStatus.AVAILABLE
        assert label.net_entry_edge is not None
        assert label.net_entry_edge.is_negative is expected_negative

    def test_non_convergence_is_right_censored(self) -> None:
        perp = _series(
            (_point(-3, 10_400, 1), _point(120, 10_390, 2)),
            series_id="perp-1",
        )
        label = _compute(perp=perp)

        assert label.status is OutcomeStatus.AVAILABLE
        assert label.partial_convergence_time_ns is None
        assert label.full_convergence_time_ns is None
        assert label.convergence_censor_time_ns == BASE_NS + 3_600 * SECOND_NS

    def test_incomplete_evidence_censors_at_completeness_end(self) -> None:
        perp = _series(
            (_point(-3, 10_400, 1), _point(120, 10_390, 2)),
            series_id="perp-1",
            end_s=600,
        )
        label = _compute(perp=perp)

        assert label.convergence_censor_time_ns == BASE_NS + 600 * SECOND_NS

    def test_funding_transfer_signs_by_construction(self) -> None:
        funding = (
            FundingEventV1(time_ns=BASE_NS + 300 * SECOND_NS, rate=make_ratio(1, 10_000)),
            FundingEventV1(time_ns=BASE_NS + 600 * SECOND_NS, rate=make_ratio(1, 10_000)),
            FundingEventV1(time_ns=BASE_NS + 2_000 * SECOND_NS, rate=make_ratio(5, 10_000)),
        )
        normal = _compute(funding=funding)
        reverse = _compute(
            funding=funding,
            construction=BasisConstruction.REVERSE,
            borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
        )

        # Full convergence at +900s bounds the funding window; the +2000s event is out.
        assert normal.funding_transfer == make_ratio(2, 10_000)
        assert reverse.funding_transfer == make_ratio(-2, 10_000)

    def test_gap_makes_the_label_data_invalid(self) -> None:
        gap = GapIntervalV1(
            start_ns=BASE_NS + 10 * SECOND_NS,
            end_ns=BASE_NS + 20 * SECOND_NS,
        )
        label = _compute(spot=_series(SPOT_POINTS, series_id="spot-1", gaps=(gap,)))

        assert label.status is OutcomeStatus.DATA_INVALID
        assert label.entry_basis is None
        assert label.max_executable_net_edge_status is OutcomeStatus.UNAVAILABLE

    def test_missing_reference_is_unavailable(self) -> None:
        late_spot = _series((_point(30, 10_000, 1),), series_id="spot-1")
        label = _compute(spot=late_spot)

        assert label.status is OutcomeStatus.UNAVAILABLE

    def test_zero_entry_basis_censors_convergence(self) -> None:
        perp = _series((_point(-3, 10_000, 1),), series_id="perp-1")
        label = _compute(perp=perp)

        assert label.entry_basis == make_ratio(0, 1)
        assert label.convergence_censor_time_ns == BASE_NS + 3_600 * SECOND_NS

    def test_stale_spot_leg_is_skipped_during_convergence(self) -> None:
        spot = _series((_point(-5, 10_000, 1),), series_id="spot-1", end_s=3_600)
        perp = _series(
            (_point(-3, 10_400, 1), _point(120, 10_020, 2)),
            series_id="perp-1",
        )
        label = _compute(spot=spot, perp=perp)

        # The only spot observation is stale by the time the perp converges, so the
        # convergence check cannot lawfully evaluate and censors instead.
        assert label.partial_convergence_time_ns is None
        assert label.convergence_censor_time_ns == BASE_NS + 3_600 * SECOND_NS

    def test_reverse_feasibility_tracks_borrow_knownness(self) -> None:
        unknown = _compute(construction=BasisConstruction.REVERSE)
        unavailable = _compute(
            construction=BasisConstruction.REVERSE,
            borrow=_borrow(BorrowKnownness.KNOWN_UNAVAILABLE),
        )
        available = _compute(
            construction=BasisConstruction.REVERSE,
            borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
        )

        assert unknown.feasibility is ConstructionFeasibility.UNKNOWN
        assert unavailable.feasibility is ConstructionFeasibility.INFEASIBLE
        assert available.feasibility is ConstructionFeasibility.FEASIBLE
        assert unknown.as_mapping()["feasibility"] == "UNKNOWN"


class TestBasisContracts:
    def test_compute_input_rejections(self) -> None:
        spot = _series(SPOT_POINTS, series_id="spot-1")
        with pytest.raises(ContractValueError):
            _compute(construction="NORMAL")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _compute(spot="spot")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _compute(end_s=0)
        with pytest.raises(ContractValueError):
            _compute(funding=[FundingEventV1(time_ns=BASE_NS, rate=make_ratio(1, 2))])  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _compute(
                funding=(
                    FundingEventV1(time_ns=BASE_NS + SECOND_NS, rate=make_ratio(1, 2)),
                    FundingEventV1(time_ns=BASE_NS + SECOND_NS, rate=make_ratio(1, 3)),
                )
            )
        quote_series = EvidenceSeriesV1(
            series_id="quotes-1",
            symbol="BNBUSDT",
            kind=SeriesKind.EXECUTABLE_QUOTES,
            posture=EvidencePosture.SYNTHETIC,
            completeness_start_ns=BASE_NS - SECOND_NS,
            completeness_end_ns=BASE_NS + SECOND_NS,
            price_points=(),
            quote_points=(
                QuotePointV1(
                    event_time_ns=BASE_NS,
                    ordinal=1,
                    bid=_scaled(9_900),
                    ask=_scaled(10_100),
                ),
            ),
            known_gaps=(),
        )
        with pytest.raises(ContractValueError):
            _compute(perp=quote_series)
        with pytest.raises(ContractValueError):
            compute_basis_label(
                construction=BasisConstruction.NORMAL,
                spot_series=spot,
                perp_series=_series(PERP_POINTS, series_id="perp-1"),
                label_start_ns=BASE_NS,
                label_end_ns=BASE_NS + SECOND_NS,
                definition="definition",  # type: ignore[arg-type]
                costs=_costs(),
                borrow=_borrow(),
                funding_schedule=(),
            )
        with pytest.raises(ContractValueError):
            compute_basis_label(
                construction=BasisConstruction.NORMAL,
                spot_series=spot,
                perp_series=_series(PERP_POINTS, series_id="perp-1"),
                label_start_ns=BASE_NS,
                label_end_ns=BASE_NS + SECOND_NS,
                definition=_definition(),
                costs="costs",  # type: ignore[arg-type]
                borrow=_borrow(),
                funding_schedule=(),
            )
        with pytest.raises(ContractValueError):
            compute_basis_label(
                construction=BasisConstruction.NORMAL,
                spot_series=spot,
                perp_series=_series(PERP_POINTS, series_id="perp-1"),
                label_start_ns=BASE_NS,
                label_end_ns=BASE_NS + SECOND_NS,
                definition=_definition(),
                costs=_costs(),
                borrow="borrow",  # type: ignore[arg-type]
                funding_schedule=(),
            )

    def test_assumption_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            BorrowAssumptionV1(
                assumption_version="v1",
                knownness=BorrowKnownness.KNOWN_AVAILABLE,
                hourly_rate=None,
            )
        with pytest.raises(ContractValueError):
            BorrowAssumptionV1(
                assumption_version="v1",
                knownness=BorrowKnownness.UNKNOWN,
                hourly_rate=make_ratio(1, 2),
            )
        with pytest.raises(ContractValueError):
            BorrowAssumptionV1(
                assumption_version="v1",
                knownness="KNOWN",  # type: ignore[arg-type]
                hourly_rate=None,
            )
        with pytest.raises(ContractValueError):
            BasisCostAssumptionV1(
                assumption_version="v1",
                per_leg_fee=make_ratio(-1, 2),
                entry_slippage=make_ratio(0, 1),
                exit_slippage=make_ratio(0, 1),
                recovery_cost=make_ratio(0, 1),
            )
        with pytest.raises(ContractValueError):
            BasisCostAssumptionV1(
                assumption_version="v1",
                per_leg_fee=make_ratio(1, 2),
                entry_slippage=make_ratio(0, 1),
                exit_slippage=make_ratio(0, 1),
                recovery_cost=make_ratio(0, 1),
                legs=2,
            )
        with pytest.raises(ContractValueError):
            BasisDefinitionV1(
                definition_version="v1",
                max_reference_staleness_ns=1,
                partial_convergence_fraction=make_ratio(1, 10),
                full_convergence_fraction=make_ratio(1, 2),
            )
        with pytest.raises(ContractValueError):
            BasisDefinitionV1(
                definition_version="v1",
                max_reference_staleness_ns=1,
                partial_convergence_fraction=make_ratio(3, 2),
                full_convergence_fraction=make_ratio(1, 10),
            )
        with pytest.raises(ContractValueError):
            FundingEventV1(time_ns=5, rate=make_ratio(1, 2))
        with pytest.raises(ContractValueError):
            FundingEventV1(time_ns=BASE_NS, rate="rate")  # type: ignore[arg-type]
        assert _costs().total_cost == make_ratio(6, 1_000)
        assert _costs().as_mapping()["legs"] == 4

    def test_label_record_coherence(self) -> None:
        label = _compute()
        with pytest.raises(ContractValueError):
            BasisLabelV1(
                construction=label.construction,
                definition=label.definition,
                costs=label.costs,
                borrow=label.borrow,
                feasibility=label.feasibility,
                status=OutcomeStatus.AVAILABLE,
                entry_basis=None,
                net_entry_edge=None,
                partial_convergence_time_ns=None,
                full_convergence_time_ns=None,
                convergence_censor_time_ns=None,
                funding_transfer=None,
                max_executable_net_edge_status=OutcomeStatus.UNAVAILABLE,
                max_executable_net_edge=None,
            )
        with pytest.raises(ContractValueError):
            BasisLabelV1(
                construction=label.construction,
                definition=label.definition,
                costs=label.costs,
                borrow=label.borrow,
                feasibility=label.feasibility,
                status=OutcomeStatus.UNAVAILABLE,
                entry_basis=None,
                net_entry_edge=None,
                partial_convergence_time_ns=BASE_NS,
                full_convergence_time_ns=None,
                convergence_censor_time_ns=None,
                funding_transfer=None,
                max_executable_net_edge_status=OutcomeStatus.UNAVAILABLE,
                max_executable_net_edge=None,
            )
        with pytest.raises(ContractValueError):
            BasisLabelV1(
                construction=label.construction,
                definition=label.definition,
                costs=label.costs,
                borrow=label.borrow,
                feasibility=label.feasibility,
                status=OutcomeStatus.AVAILABLE,
                entry_basis=label.entry_basis,
                net_entry_edge=label.net_entry_edge,
                partial_convergence_time_ns=BASE_NS + 100,
                full_convergence_time_ns=BASE_NS + 50,
                convergence_censor_time_ns=None,
                funding_transfer=label.funding_transfer,
                max_executable_net_edge_status=OutcomeStatus.UNAVAILABLE,
                max_executable_net_edge=None,
            )
        with pytest.raises(ContractValueError):
            BasisLabelV1(
                construction=label.construction,
                definition=label.definition,
                costs=label.costs,
                borrow=label.borrow,
                feasibility=label.feasibility,
                status=OutcomeStatus.AVAILABLE,
                entry_basis=label.entry_basis,
                net_entry_edge=label.net_entry_edge,
                partial_convergence_time_ns=label.partial_convergence_time_ns,
                full_convergence_time_ns=label.full_convergence_time_ns,
                convergence_censor_time_ns=None,
                funding_transfer=label.funding_transfer,
                max_executable_net_edge_status=OutcomeStatus.AVAILABLE,
                max_executable_net_edge=None,
            )
        with pytest.raises(ContractValueError):
            BasisLabelV1(
                construction=BasisConstruction.REVERSE,
                definition=label.definition,
                costs=label.costs,
                borrow=_borrow(BorrowKnownness.UNKNOWN),
                feasibility=ConstructionFeasibility.FEASIBLE,
                status=OutcomeStatus.AVAILABLE,
                entry_basis=label.entry_basis,
                net_entry_edge=label.net_entry_edge,
                partial_convergence_time_ns=label.partial_convergence_time_ns,
                full_convergence_time_ns=label.full_convergence_time_ns,
                convergence_censor_time_ns=None,
                funding_transfer=label.funding_transfer,
                max_executable_net_edge_status=OutcomeStatus.UNAVAILABLE,
                max_executable_net_edge=None,
            )
