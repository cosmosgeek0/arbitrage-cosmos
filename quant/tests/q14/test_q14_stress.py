"""Q14 cost/latency stress law: attractive predictions must survive explicit costs."""

from __future__ import annotations

from dataclasses import replace

import pytest
from q14_fixtures import make_sample_set

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import make_ratio
from quant_edge.validation.stress import (
    CostStressScenarioV1,
    OpportunityDecayV1,
    StressSpecV1,
    run_cost_stress,
)

ZERO = make_ratio(0, 1)


def _scenario(scenario_id: str = "base-echo", **overrides: object) -> CostStressScenarioV1:
    base = CostStressScenarioV1(
        scenario_id=scenario_id,
        fee_delta=ZERO,
        slippage_delta=ZERO,
        funding_delta=ZERO,
        borrow_delta=ZERO,
        recovery_delta=ZERO,
        latency_ns=0,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def _spec(*scenarios: CostStressScenarioV1) -> StressSpecV1:
    return StressSpecV1(
        act_threshold=make_ratio(1, 1000),
        decay=OpportunityDecayV1(decay_ratio_per_second=make_ratio(1, 1000)),
        scenarios=scenarios,
    )


def test_scenario_and_spec_contract_law() -> None:
    with pytest.raises(ContractValueError, match="fee_delta"):
        _scenario(fee_delta=make_ratio(-1, 100))
    with pytest.raises(ContractValueError, match="fee_delta"):
        _scenario(fee_delta=0.01)
    with pytest.raises(ContractValueError, match="latency_ns"):
        _scenario(latency_ns=-1)
    with pytest.raises(ContractValueError, match="decay_ratio_per_second"):
        OpportunityDecayV1(decay_ratio_per_second=make_ratio(-1, 10))
    with pytest.raises(ContractValueError, match="act_threshold"):
        StressSpecV1(
            act_threshold=0.1,  # type: ignore[arg-type]
            decay=OpportunityDecayV1(decay_ratio_per_second=ZERO),
            scenarios=(_scenario(),),
        )
    with pytest.raises(ContractValueError, match="OpportunityDecayV1"):
        StressSpecV1(act_threshold=ZERO, decay="decay", scenarios=(_scenario(),))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="non-empty"):
        StressSpecV1(
            act_threshold=ZERO,
            decay=OpportunityDecayV1(decay_ratio_per_second=ZERO),
            scenarios=(),
        )
    with pytest.raises(ContractValueError, match="CostStressScenarioV1"):
        StressSpecV1(
            act_threshold=ZERO,
            decay=OpportunityDecayV1(decay_ratio_per_second=ZERO),
            scenarios=("s",),  # type: ignore[arg-type]
        )
    with pytest.raises(ContractValueError, match="duplicate scenario id"):
        _spec(_scenario("dup"), _scenario("dup"))
    with pytest.raises(ContractValueError, match="MAX_SCENARIOS"):
        _spec(*(_scenario(f"s-{index:03d}") for index in range(65)))


def test_attractive_prediction_flips_to_abstention_under_stress() -> None:
    samples = make_sample_set(10, gross_edge=make_ratio(4, 1000), base_cost=make_ratio(1, 1000))
    spec = _spec(
        _scenario("base-echo"),
        _scenario("fee-shock", fee_delta=make_ratio(3, 1000)),
        _scenario("latency-shock", latency_ns=3_000_000_000),
    )
    report = run_cost_stress(samples, spec)
    assert report.base_actionable_count == 10
    assert report.base_abstain_count == 0

    by_id = {outcome.scenario_id: outcome for outcome in report.outcomes}
    echo = by_id["base-echo"]
    assert echo.actionable_count == 10
    assert echo.flipped_from_base_count == 0

    fee_shock = by_id["fee-shock"]
    assert fee_shock.actionable_count == 0
    assert fee_shock.flipped_from_base_count == 10
    assert fee_shock.mean_net_edge is not None
    assert fee_shock.mean_net_edge.mantissa == 0

    latency_shock = by_id["latency-shock"]
    assert latency_shock.actionable_count == 0
    assert latency_shock.flipped_from_base_count == 10
    assert latency_shock.min_net_edge is not None
    assert latency_shock.min_net_edge.mantissa == 0
    assert report.as_mapping()["schema"] == "Q14CostStressReportV1"


def test_unknown_cost_truth_abstains_never_zero() -> None:
    samples = make_sample_set(6, gross_edge=make_ratio(4, 1000), base_cost=None)
    report = run_cost_stress(samples, _spec(_scenario()))
    assert report.base_actionable_count == 0
    assert report.base_abstain_count == 6
    outcome = report.outcomes[0]
    assert outcome.abstain_count == 6
    assert outcome.mean_net_edge is None
    assert outcome.min_net_edge is None


def test_stress_input_contract_law() -> None:
    samples = make_sample_set(4)
    spec = _spec(_scenario())
    with pytest.raises(ContractValueError, match="SampleSetV1"):
        run_cost_stress("nope", spec)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="StressSpecV1"):
        run_cost_stress(samples, "nope")  # type: ignore[arg-type]
