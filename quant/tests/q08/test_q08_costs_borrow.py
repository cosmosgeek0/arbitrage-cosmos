from __future__ import annotations

import pytest

from quant_edge.derivatives.borrow import (
    BorrowObservationV1,
    borrow_hourly_rate,
    construction_feasibility,
    effective_borrow_knownness,
)
from quant_edge.derivatives.costs import (
    CostComponentV1,
    CostKind,
    CostKnownness,
    CostStackV1,
    known_component,
    unknown_component,
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
HOUR_NS = 3_600_000_000_000


def _full_stack(**overrides: CostComponentV1) -> CostStackV1:
    components = {
        CostKind.BORROW_CARRY: known_component(CostKind.BORROW_CARRY, 1, 10_000),
        CostKind.ENTRY_SLIPPAGE: known_component(CostKind.ENTRY_SLIPPAGE, 5, 10_000),
        CostKind.EXIT_SLIPPAGE: known_component(CostKind.EXIT_SLIPPAGE, 5, 10_000),
        CostKind.FUNDING_CARRY: known_component(CostKind.FUNDING_CARRY, -2, 10_000),
        CostKind.PER_LEG_FEE: known_component(CostKind.PER_LEG_FEE, 75, 100_000),
        CostKind.RECOVERY: known_component(CostKind.RECOVERY, 10, 10_000),
    }
    for component in overrides.values():
        components[component.kind] = component
    return CostStackV1(
        stack_version="q08-test-costs-v1",
        components=tuple(
            components[kind] for kind in sorted(CostKind, key=lambda kind: kind.value)
        ),
    )


def _available_borrow(**overrides: object) -> BorrowObservationV1:
    fields: dict[str, object] = {
        "observed_at_ns": BASE_NS,
        "assumption": BorrowAssumptionV1(
            assumption_version="q08-test-borrow-v1",
            knownness=BorrowKnownness.KNOWN_AVAILABLE,
            hourly_rate=make_ratio(1, 100_000),
        ),
        "inventory": ExactScaledValueV1(coefficient=50, scale=0, unit_id="BNB"),
        "interest_interval_ns": HOUR_NS,
        "valid_until_ns": BASE_NS + 24 * HOUR_NS,
    }
    fields.update(overrides)
    return BorrowObservationV1(**fields)  # type: ignore[arg-type]


class TestCostComponents:
    def test_value_exists_exactly_when_known(self) -> None:
        with pytest.raises(ContractValueError, match="exactly when"):
            CostComponentV1(
                kind=CostKind.RECOVERY,
                knownness=CostKnownness.UNKNOWN,
                value=make_ratio(1, 100),
            )
        with pytest.raises(ContractValueError, match="exactly when"):
            CostComponentV1(kind=CostKind.RECOVERY, knownness=CostKnownness.KNOWN, value=None)

    def test_only_funding_carry_may_be_negative(self) -> None:
        assert known_component(CostKind.FUNDING_CARRY, -3, 10_000).value is not None
        for kind in CostKind:
            if kind is CostKind.FUNDING_CARRY:
                continue
            with pytest.raises(ContractValueError, match="cannot be negative"):
                known_component(kind, -1, 10_000)

    def test_component_type_laws(self) -> None:
        with pytest.raises(ContractValueError, match="CostKind"):
            CostComponentV1(
                kind="RECOVERY",  # type: ignore[arg-type]
                knownness=CostKnownness.KNOWN,
                value=make_ratio(1, 100),
            )
        with pytest.raises(ContractValueError, match="CostKnownness"):
            CostComponentV1(kind=CostKind.RECOVERY, knownness="KNOWN", value=make_ratio(1, 100))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            CostComponentV1(kind=CostKind.RECOVERY, knownness=CostKnownness.KNOWN, value=0.01)  # type: ignore[arg-type]


class TestCostStack:
    def test_total_over_fully_known_stack_is_exact(self) -> None:
        stack = _full_stack()
        assert stack.total_knownness is CostKnownness.KNOWN
        assert stack.unknown_kinds == ()
        total = stack.total()
        assert total is not None
        # 4 * 7.5bp + 5bp + 5bp - 2bp + 1bp + 10bp = 49bp exactly.
        assert total.numerator == 49
        assert total.denominator == 10_000

    def test_one_unknown_component_makes_the_total_unknown_never_zero(self) -> None:
        for kind in CostKind:
            stack = _full_stack(**{kind.value.lower(): unknown_component(kind)})
            assert stack.total_knownness is CostKnownness.UNKNOWN
            assert stack.unknown_kinds == (kind,)
            assert stack.total() is None

    def test_every_kind_must_be_declared_exactly_once(self) -> None:
        complete = _full_stack()
        with pytest.raises(ContractValueError, match="every cost kind exactly once"):
            CostStackV1(
                stack_version="q08-test-costs-v1",
                components=complete.components[:-1],
            )
        with pytest.raises(ContractValueError, match="every cost kind exactly once"):
            # Sorted, right length, but BORROW_CARRY twice and RECOVERY missing.
            CostStackV1(
                stack_version="q08-test-costs-v1",
                components=(
                    known_component(CostKind.BORROW_CARRY, 1, 10_000),
                    *complete.components[:-1],
                ),
            )
        with pytest.raises(ContractValueError, match="sorted"):
            CostStackV1(
                stack_version="q08-test-costs-v1",
                components=tuple(reversed(complete.components)),
            )
        with pytest.raises(ContractValueError, match="CostComponentV1"):
            CostStackV1(
                stack_version="q08-test-costs-v1",
                components=(*complete.components[:-1], "RECOVERY"),  # type: ignore[arg-type]
            )

    def test_four_leg_law_and_lookup(self) -> None:
        stack = _full_stack()
        assert stack.legs == 4
        with pytest.raises(ContractValueError, match="four-leg"):
            CostStackV1(
                stack_version="q08-test-costs-v1",
                components=stack.components,
                legs=2,
            )
        component = stack.component(CostKind.RECOVERY)
        assert component.kind is CostKind.RECOVERY
        with pytest.raises(ContractValueError, match="CostKind"):
            stack.component("RECOVERY")  # type: ignore[arg-type]

    def test_mapping_reports_knownness(self) -> None:
        mapping = _full_stack(borrow_carry=unknown_component(CostKind.BORROW_CARRY)).as_mapping()
        assert mapping["totalKnownness"] == "UNKNOWN"
        assert mapping["legs"] == 4


class TestBorrowObservation:
    def test_extension_facts_require_known_available(self) -> None:
        for knownness in (BorrowKnownness.UNKNOWN, BorrowKnownness.KNOWN_UNAVAILABLE):
            assumption = BorrowAssumptionV1(
                assumption_version="q08-test-borrow-v1",
                knownness=knownness,
                hourly_rate=None,
            )
            with pytest.raises(ContractValueError, match="extension facts"):
                BorrowObservationV1(
                    observed_at_ns=BASE_NS,
                    assumption=assumption,
                    inventory=ExactScaledValueV1(coefficient=1, scale=0, unit_id="BNB"),
                    interest_interval_ns=None,
                    valid_until_ns=None,
                )
            observation = BorrowObservationV1(
                observed_at_ns=BASE_NS,
                assumption=assumption,
                inventory=None,
                interest_interval_ns=None,
                valid_until_ns=None,
            )
            assert observation.as_mapping()["inventory"] is None

    def test_observation_field_laws(self) -> None:
        with pytest.raises(ContractValueError, match="BorrowAssumptionV1"):
            BorrowObservationV1(
                observed_at_ns=BASE_NS,
                assumption=None,  # type: ignore[arg-type]
                inventory=None,
                interest_interval_ns=None,
                valid_until_ns=None,
            )
        with pytest.raises(ContractValueError, match="inventory cannot be negative"):
            _available_borrow(inventory=ExactScaledValueV1(coefficient=-1, scale=0, unit_id="BNB"))
        with pytest.raises(ContractValueError, match="inventory must be"):
            _available_borrow(inventory=5)
        with pytest.raises(ContractValueError, match="interest_interval_ns"):
            _available_borrow(interest_interval_ns=0)
        with pytest.raises(ContractValueError, match="beyond the observation"):
            _available_borrow(valid_until_ns=BASE_NS)
        mapping = _available_borrow().as_mapping()
        assert mapping["interestIntervalNs"] == str(HOUR_NS)
        assert mapping["validUntilNs"] == str(BASE_NS + 24 * HOUR_NS)

    def test_known_available_borrow_must_declare_its_validity(self) -> None:
        # Adversarial-review regression: without this law an available-borrow
        # observation would grant REVERSE feasibility forever.
        with pytest.raises(ContractValueError, match="validity horizon"):
            _available_borrow(valid_until_ns=None)

    def test_effective_knownness_degrades_and_never_upgrades(self) -> None:
        observation = _available_borrow()
        assert (
            effective_borrow_knownness(observation, BASE_NS + HOUR_NS)
            is BorrowKnownness.KNOWN_AVAILABLE
        )
        # Before the observation nothing is known yet.
        assert effective_borrow_knownness(observation, BASE_NS - HOUR_NS) is BorrowKnownness.UNKNOWN
        # After the validity expires the truth decays to UNKNOWN.
        assert (
            effective_borrow_knownness(observation, BASE_NS + 25 * HOUR_NS)
            is BorrowKnownness.UNKNOWN
        )
        with pytest.raises(ContractValueError, match="BorrowObservationV1"):
            effective_borrow_knownness(None, BASE_NS)  # type: ignore[arg-type]

    def test_hourly_rate_is_never_zero_filled(self) -> None:
        observation = _available_borrow()
        rate = borrow_hourly_rate(observation, BASE_NS + HOUR_NS)
        assert rate is not None
        assert rate.numerator == 1
        assert borrow_hourly_rate(observation, BASE_NS + 25 * HOUR_NS) is None
        unknown = BorrowObservationV1(
            observed_at_ns=BASE_NS,
            assumption=BorrowAssumptionV1(
                assumption_version="q08-test-borrow-v1",
                knownness=BorrowKnownness.UNKNOWN,
                hourly_rate=None,
            ),
            inventory=None,
            interest_interval_ns=None,
            valid_until_ns=None,
        )
        assert borrow_hourly_rate(unknown, BASE_NS + HOUR_NS) is None


class TestConstructionFeasibility:
    def test_the_accepted_truth_table(self) -> None:
        table = {
            (BasisConstruction.NORMAL, BorrowKnownness.UNKNOWN): ConstructionFeasibility.FEASIBLE,
            (
                BasisConstruction.NORMAL,
                BorrowKnownness.KNOWN_UNAVAILABLE,
            ): ConstructionFeasibility.FEASIBLE,
            (
                BasisConstruction.NORMAL,
                BorrowKnownness.KNOWN_AVAILABLE,
            ): ConstructionFeasibility.FEASIBLE,
            (
                BasisConstruction.REVERSE,
                BorrowKnownness.KNOWN_AVAILABLE,
            ): ConstructionFeasibility.FEASIBLE,
            (
                BasisConstruction.REVERSE,
                BorrowKnownness.KNOWN_UNAVAILABLE,
            ): ConstructionFeasibility.INFEASIBLE,
            (BasisConstruction.REVERSE, BorrowKnownness.UNKNOWN): ConstructionFeasibility.UNKNOWN,
        }
        for (construction, knownness), expected in table.items():
            assert construction_feasibility(construction, knownness) is expected

    def test_type_laws(self) -> None:
        with pytest.raises(ContractValueError, match="BasisConstruction"):
            construction_feasibility("NORMAL", BorrowKnownness.UNKNOWN)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="BorrowKnownness"):
            construction_feasibility(BasisConstruction.NORMAL, "UNKNOWN")  # type: ignore[arg-type]
