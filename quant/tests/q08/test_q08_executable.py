from __future__ import annotations

import pytest

from quant_edge.derivatives.borrow import BorrowObservationV1
from quant_edge.derivatives.costs import (
    CostKind,
    CostStackV1,
    known_component,
    unknown_component,
)
from quant_edge.derivatives.executable import (
    ExecutableBasisV1,
    ExecutableStatus,
    LegKind,
    NetExecutableEdgeV1,
    SizedQuoteV1,
    SizeFeasibility,
    compute_executable_basis,
    net_executable_edge,
)
from quant_edge.errors import ContractValueError
from quant_edge.labels.basis import (
    BasisConstruction,
    BorrowAssumptionV1,
    BorrowKnownness,
    ConstructionFeasibility,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import ExactScaledValueV1

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
AS_OF = BASE_NS + 10 * SECOND_NS
STALENESS = 5 * SECOND_NS


def _usdt(price: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=price, scale=2, unit_id="USDT")


def _size(amount: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=amount, scale=0, unit_id="BNB")


def _quote(
    leg: LegKind,
    bid: int,
    ask: int,
    *,
    offset_s: int = 9,
    bid_size: int | None = 5,
    ask_size: int | None = 5,
) -> SizedQuoteV1:
    return SizedQuoteV1(
        leg=leg,
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=1,
        bid=_usdt(bid),
        ask=_usdt(ask),
        bid_size=None if bid_size is None else _size(bid_size),
        ask_size=None if ask_size is None else _size(ask_size),
    )


SPOT = _quote(LegKind.SPOT, 10_000, 10_002)
PERP = _quote(LegKind.USDM_PERP, 10_060, 10_062)


def _basis(construction: BasisConstruction, **overrides: object) -> ExecutableBasisV1:
    fields: dict[str, object] = {
        "construction": construction,
        "spot_quote": SPOT,
        "perp_quote": PERP,
        "intended_size": _size(2),
        "as_of_ns": AS_OF,
        "max_staleness_ns": STALENESS,
    }
    fields.update(overrides)
    return compute_executable_basis(**fields)  # type: ignore[arg-type]


def _known_costs() -> CostStackV1:
    return CostStackV1(
        stack_version="q08-test-costs-v1",
        components=(
            known_component(CostKind.BORROW_CARRY, 1, 10_000),
            known_component(CostKind.ENTRY_SLIPPAGE, 5, 10_000),
            known_component(CostKind.EXIT_SLIPPAGE, 5, 10_000),
            known_component(CostKind.FUNDING_CARRY, -2, 10_000),
            known_component(CostKind.PER_LEG_FEE, 75, 100_000),
            known_component(CostKind.RECOVERY, 10, 10_000),
        ),
    )


def _borrow(knownness: BorrowKnownness) -> BorrowObservationV1:
    known = knownness is BorrowKnownness.KNOWN_AVAILABLE
    return BorrowObservationV1(
        observed_at_ns=BASE_NS,
        assumption=BorrowAssumptionV1(
            assumption_version="q08-test-borrow-v1",
            knownness=knownness,
            hourly_rate=make_ratio(1, 100_000) if known else None,
        ),
        inventory=None,
        interest_interval_ns=None,
        valid_until_ns=BASE_NS + 3_600_000_000_000 if known else None,
    )


class TestSizedQuote:
    def test_crossed_quotes_are_rejected(self) -> None:
        with pytest.raises(ContractValueError, match="crossed"):
            _quote(LegKind.SPOT, 10_010, 10_000)

    def test_sizes_may_be_unknown_but_never_negative_or_untyped(self) -> None:
        quote = _quote(LegKind.SPOT, 10_000, 10_002, bid_size=None, ask_size=None)
        assert quote.bid_size is None
        assert quote.as_mapping()["bidSize"] is None
        with pytest.raises(ContractValueError, match="cannot be negative"):
            SizedQuoteV1(
                leg=LegKind.SPOT,
                event_time_ns=BASE_NS,
                ordinal=0,
                bid=_usdt(10_000),
                ask=_usdt(10_002),
                bid_size=ExactScaledValueV1(coefficient=-1, scale=0, unit_id="BNB"),
                ask_size=None,
            )
        with pytest.raises(ContractValueError, match="ExactScaledValueV1"):
            SizedQuoteV1(
                leg=LegKind.SPOT,
                event_time_ns=BASE_NS,
                ordinal=0,
                bid=_usdt(10_000),
                ask=_usdt(10_002),
                bid_size=5,  # type: ignore[arg-type]
                ask_size=None,
            )
        with pytest.raises(ContractValueError, match="LegKind"):
            SizedQuoteV1(
                leg="SPOT",  # type: ignore[arg-type]
                event_time_ns=BASE_NS,
                ordinal=0,
                bid=_usdt(10_000),
                ask=_usdt(10_002),
                bid_size=None,
                ask_size=None,
            )


class TestExecutableBasisConstructionDistinctness:
    def test_normal_uses_spot_ask_and_perp_bid(self) -> None:
        observed = _basis(BasisConstruction.NORMAL)
        assert observed.status is ExecutableStatus.AVAILABLE
        assert observed.entry_basis is not None
        # (perp_bid - spot_ask) / spot_ask = (10060 - 10002) / 10002 = 29/5001.
        assert observed.entry_basis.numerator == 29
        assert observed.entry_basis.denominator == 5_001

    def test_reverse_uses_spot_bid_and_perp_ask(self) -> None:
        observed = _basis(BasisConstruction.REVERSE)
        assert observed.status is ExecutableStatus.AVAILABLE
        assert observed.entry_basis is not None
        # (spot_bid - perp_ask) / spot_bid = (10000 - 10062) / 10000 = -31/5000.
        assert observed.entry_basis.numerator == -31
        assert observed.entry_basis.denominator == 5_000

    def test_the_two_constructions_never_coincide_on_spread_quotes(self) -> None:
        normal = _basis(BasisConstruction.NORMAL)
        reverse = _basis(BasisConstruction.REVERSE)
        assert normal.entry_basis is not None
        assert reverse.entry_basis is not None
        assert normal.entry_basis != reverse.entry_basis
        negated = make_ratio(-reverse.entry_basis.numerator, reverse.entry_basis.denominator)
        # With a real spread the constructions are not even mirror images.
        assert normal.entry_basis != negated
        assert normal.as_mapping()["construction"] == "NORMAL"
        assert reverse.as_mapping()["construction"] == "REVERSE"

    def test_legs_are_typed_and_never_interchangeable(self) -> None:
        with pytest.raises(ContractValueError, match="never interchangeable"):
            _basis(BasisConstruction.NORMAL, spot_quote=PERP)
        with pytest.raises(ContractValueError, match="never interchangeable"):
            _basis(BasisConstruction.NORMAL, perp_quote=SPOT)


class TestExecutableBasisStatusLaw:
    def test_missing_legs_stay_unknown(self) -> None:
        observed = _basis(BasisConstruction.NORMAL, spot_quote=None)
        assert observed.status is ExecutableStatus.UNKNOWN
        assert observed.entry_basis is None
        assert observed.size_feasibility is SizeFeasibility.UNKNOWN
        assert "SPOT_QUOTE_MISSING" in observed.reasons
        observed = _basis(BasisConstruction.NORMAL, perp_quote=None)
        assert "PERP_QUOTE_MISSING" in observed.reasons
        assert observed.spot_time_ns == SPOT.event_time_ns
        assert observed.perp_time_ns is None

    def test_stale_legs_stay_stale_never_valued(self) -> None:
        stale_spot = _quote(LegKind.SPOT, 10_000, 10_002, offset_s=1)
        observed = _basis(BasisConstruction.NORMAL, spot_quote=stale_spot)
        assert observed.status is ExecutableStatus.STALE
        assert observed.entry_basis is None
        assert "SPOT_QUOTE_STALE" in observed.reasons
        stale_perp = _quote(LegKind.USDM_PERP, 10_060, 10_062, offset_s=1)
        observed = _basis(BasisConstruction.NORMAL, perp_quote=stale_perp)
        assert "PERP_QUOTE_STALE" in observed.reasons

    def test_future_quotes_are_rejected(self) -> None:
        future = _quote(LegKind.SPOT, 10_000, 10_002, offset_s=11)
        with pytest.raises(ContractValueError, match="newer than as-of"):
            _basis(BasisConstruction.NORMAL, spot_quote=future)

    def test_input_type_laws(self) -> None:
        with pytest.raises(ContractValueError, match="BasisConstruction"):
            _basis("NORMAL")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="SizedQuoteV1"):
            _basis(BasisConstruction.NORMAL, spot_quote="quote")
        with pytest.raises(ContractValueError, match="strictly positive"):
            _basis(BasisConstruction.NORMAL, intended_size=_size(0))


class TestSizeFeasibility:
    def test_sufficient_when_the_consumed_sides_cover_the_intended_size(self) -> None:
        observed = _basis(BasisConstruction.NORMAL)
        assert observed.size_feasibility is SizeFeasibility.SUFFICIENT
        assert observed.reasons == ()

    def test_normal_inspects_spot_ask_and_perp_bid_sizes(self) -> None:
        thin_spot_ask = _quote(LegKind.SPOT, 10_000, 10_002, ask_size=1)
        observed = _basis(BasisConstruction.NORMAL, spot_quote=thin_spot_ask)
        assert observed.size_feasibility is SizeFeasibility.INSUFFICIENT
        assert "SIZE_INSUFFICIENT" in observed.reasons
        # The same thin ask does not affect the REVERSE construction, which
        # consumes the spot bid instead.
        observed = _basis(BasisConstruction.REVERSE, spot_quote=thin_spot_ask)
        assert observed.size_feasibility is SizeFeasibility.SUFFICIENT

    def test_reverse_inspects_spot_bid_and_perp_ask_sizes(self) -> None:
        thin_perp_ask = _quote(LegKind.USDM_PERP, 10_060, 10_062, ask_size=1)
        observed = _basis(BasisConstruction.REVERSE, perp_quote=thin_perp_ask)
        assert observed.size_feasibility is SizeFeasibility.INSUFFICIENT
        observed = _basis(BasisConstruction.NORMAL, perp_quote=thin_perp_ask)
        assert observed.size_feasibility is SizeFeasibility.SUFFICIENT

    def test_unknown_size_is_never_assumed_depth(self) -> None:
        no_size = _quote(LegKind.SPOT, 10_000, 10_002, ask_size=None)
        observed = _basis(BasisConstruction.NORMAL, spot_quote=no_size)
        assert observed.size_feasibility is SizeFeasibility.UNKNOWN
        assert "SIZE_UNKNOWN" in observed.reasons
        # The basis itself is still available; only the size truth is unknown.
        assert observed.status is ExecutableStatus.AVAILABLE

    def test_insufficient_beats_unknown(self) -> None:
        thin_unknown = _quote(LegKind.SPOT, 10_000, 10_002, ask_size=1, bid_size=None)
        observed = _basis(
            BasisConstruction.NORMAL,
            spot_quote=thin_unknown,
            perp_quote=_quote(LegKind.USDM_PERP, 10_060, 10_062, bid_size=None),
        )
        assert observed.size_feasibility is SizeFeasibility.INSUFFICIENT


class TestExecutableBasisContract:
    def test_value_exists_exactly_when_available(self) -> None:
        observed = _basis(BasisConstruction.NORMAL)
        with pytest.raises(ContractValueError, match="exactly when"):
            ExecutableBasisV1(
                construction=observed.construction,
                as_of_ns=observed.as_of_ns,
                intended_size=observed.intended_size,
                status=ExecutableStatus.UNKNOWN,
                size_feasibility=observed.size_feasibility,
                entry_basis=observed.entry_basis,
                spot_time_ns=observed.spot_time_ns,
                perp_time_ns=observed.perp_time_ns,
                reasons=observed.reasons,
            )
        with pytest.raises(ContractValueError, match="sorted and unique"):
            ExecutableBasisV1(
                construction=observed.construction,
                as_of_ns=observed.as_of_ns,
                intended_size=observed.intended_size,
                status=observed.status,
                size_feasibility=observed.size_feasibility,
                entry_basis=observed.entry_basis,
                spot_time_ns=observed.spot_time_ns,
                perp_time_ns=observed.perp_time_ns,
                reasons=("B_REASON", "A_REASON"),
            )


class TestNetExecutableEdge:
    def test_normal_net_edge_is_basis_minus_total_costs(self) -> None:
        edge = net_executable_edge(
            executable=_basis(BasisConstruction.NORMAL),
            costs=_known_costs(),
            borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
            as_of_ns=AS_OF,
        )
        assert edge.status is ExecutableStatus.AVAILABLE
        assert edge.feasibility is ConstructionFeasibility.FEASIBLE
        assert edge.value is not None
        # 29/5001 - 49/10000 = 44951/50010000 exactly.
        assert edge.value.numerator == 44_951
        assert edge.value.denominator == 50_010_000

    def test_reverse_net_edge_requires_known_available_borrow(self) -> None:
        edge = net_executable_edge(
            executable=_basis(BasisConstruction.REVERSE),
            costs=_known_costs(),
            borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
            as_of_ns=AS_OF,
        )
        assert edge.status is ExecutableStatus.AVAILABLE
        assert edge.value is not None
        assert edge.value.numerator == -111
        assert edge.value.denominator == 10_000

    def test_unknown_borrow_makes_the_reverse_edge_unknown_never_zero(self) -> None:
        edge = net_executable_edge(
            executable=_basis(BasisConstruction.REVERSE),
            costs=_known_costs(),
            borrow=_borrow(BorrowKnownness.UNKNOWN),
            as_of_ns=AS_OF,
        )
        assert edge.status is ExecutableStatus.UNKNOWN
        assert edge.value is None
        assert edge.feasibility is ConstructionFeasibility.UNKNOWN
        assert "BORROW_UNKNOWN" in edge.reasons

    def test_known_unavailable_borrow_makes_the_reverse_edge_infeasible(self) -> None:
        edge = net_executable_edge(
            executable=_basis(BasisConstruction.REVERSE),
            costs=_known_costs(),
            borrow=_borrow(BorrowKnownness.KNOWN_UNAVAILABLE),
            as_of_ns=AS_OF,
        )
        assert edge.status is ExecutableStatus.UNKNOWN
        assert edge.value is None
        assert edge.feasibility is ConstructionFeasibility.INFEASIBLE
        assert "BORROW_UNAVAILABLE" in edge.reasons

    def test_unknown_borrow_never_blocks_the_normal_construction(self) -> None:
        edge = net_executable_edge(
            executable=_basis(BasisConstruction.NORMAL),
            costs=_known_costs(),
            borrow=_borrow(BorrowKnownness.UNKNOWN),
            as_of_ns=AS_OF,
        )
        assert edge.status is ExecutableStatus.AVAILABLE
        assert edge.feasibility is ConstructionFeasibility.FEASIBLE

    def test_one_unknown_cost_component_removes_the_value(self) -> None:
        costs = CostStackV1(
            stack_version="q08-test-costs-v1-unknown",
            components=(
                unknown_component(CostKind.BORROW_CARRY),
                *_known_costs().components[1:],
            ),
        )
        edge = net_executable_edge(
            executable=_basis(BasisConstruction.NORMAL),
            costs=costs,
            borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
            as_of_ns=AS_OF,
        )
        assert edge.status is ExecutableStatus.UNKNOWN
        assert edge.value is None
        assert "COST_COMPONENT_UNKNOWN" in edge.reasons

    def test_stale_basis_propagates_stale(self) -> None:
        stale = _basis(
            BasisConstruction.NORMAL,
            spot_quote=_quote(LegKind.SPOT, 10_000, 10_002, offset_s=1),
        )
        edge = net_executable_edge(
            executable=stale,
            costs=_known_costs(),
            borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
            as_of_ns=AS_OF,
        )
        assert edge.status is ExecutableStatus.STALE
        assert edge.value is None

    def test_insufficient_or_unknown_size_removes_the_value(self) -> None:
        for spot_quote in (
            _quote(LegKind.SPOT, 10_000, 10_002, ask_size=1),
            _quote(LegKind.SPOT, 10_000, 10_002, ask_size=None),
        ):
            edge = net_executable_edge(
                executable=_basis(BasisConstruction.NORMAL, spot_quote=spot_quote),
                costs=_known_costs(),
                borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
                as_of_ns=AS_OF,
            )
            assert edge.status is ExecutableStatus.UNKNOWN
            assert edge.value is None

    def test_missing_basis_reports_the_reason(self) -> None:
        edge = net_executable_edge(
            executable=_basis(BasisConstruction.NORMAL, spot_quote=None),
            costs=_known_costs(),
            borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
            as_of_ns=AS_OF,
        )
        assert "BASIS_UNAVAILABLE" in edge.reasons
        assert edge.value is None

    def test_edge_contract_laws(self) -> None:
        edge = net_executable_edge(
            executable=_basis(BasisConstruction.NORMAL),
            costs=_known_costs(),
            borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
            as_of_ns=AS_OF,
        )
        with pytest.raises(ContractValueError, match="exactly when"):
            NetExecutableEdgeV1(
                construction=edge.construction,
                as_of_ns=edge.as_of_ns,
                status=ExecutableStatus.UNKNOWN,
                feasibility=edge.feasibility,
                value=edge.value,
                reasons=edge.reasons,
            )
        with pytest.raises(ContractValueError, match="FEASIBLE borrow truth"):
            NetExecutableEdgeV1(
                construction=BasisConstruction.REVERSE,
                as_of_ns=edge.as_of_ns,
                status=ExecutableStatus.AVAILABLE,
                feasibility=ConstructionFeasibility.UNKNOWN,
                value=make_ratio(1, 100),
                reasons=(),
            )
        with pytest.raises(ContractValueError, match="pre-date"):
            net_executable_edge(
                executable=_basis(BasisConstruction.NORMAL),
                costs=_known_costs(),
                borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
                as_of_ns=AS_OF - SECOND_NS,
            )
        with pytest.raises(ContractValueError, match="ExecutableBasisV1"):
            net_executable_edge(
                executable=None,  # type: ignore[arg-type]
                costs=_known_costs(),
                borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
                as_of_ns=AS_OF,
            )
        with pytest.raises(ContractValueError, match="CostStackV1"):
            net_executable_edge(
                executable=_basis(BasisConstruction.NORMAL),
                costs=None,  # type: ignore[arg-type]
                borrow=_borrow(BorrowKnownness.KNOWN_AVAILABLE),
                as_of_ns=AS_OF,
            )
