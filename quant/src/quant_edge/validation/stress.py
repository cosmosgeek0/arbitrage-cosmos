"""Cost and latency stress (§16.2/§16.4): attractive predictions must survive costs.

Scenarios add explicit fee/slippage/funding/borrow/recovery deltas and a latency whose
cost follows a declared opportunity-decay law. Net edge is exact; a sample with
unknown gross edge or unknown base cost abstains — missing cost truth never becomes
zero. The report counts, per scenario, how many base-actionable samples flip away, so
a strategy that only looks profitable before costs is falsified here.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1, round_half_even
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.validation.samples import SampleSetV1

FIXED_SCALE: Final = 10**12
MAX_SCENARIOS: Final = 64
MAX_LATENCY_NS: Final = 3_600 * 1_000_000_000
NS_PER_SECOND: Final = 1_000_000_000


class StressAction(StrEnum):
    ACTIONABLE = "ACTIONABLE"
    NOT_ACTIONABLE = "NOT_ACTIONABLE"
    ABSTAIN_UNKNOWN = "ABSTAIN_UNKNOWN"


def _require_cost_ratio(value: object, *, field: str) -> ExactRatioV1:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    if value.is_negative:
        raise ContractValueError(f"{field} cannot be negative")
    return value


@dataclass(frozen=True, slots=True)
class OpportunityDecayV1:
    """Declared decay law: edge lost per second of added latency."""

    decay_ratio_per_second: ExactRatioV1

    def __post_init__(self) -> None:
        _require_cost_ratio(self.decay_ratio_per_second, field="decay_ratio_per_second")

    def as_mapping(self) -> dict[str, object]:
        return {"decayRatioPerSecond": self.decay_ratio_per_second.as_mapping()}


@dataclass(frozen=True, slots=True)
class CostStressScenarioV1:
    """One explicit stress scenario; deltas only ever increase cost."""

    scenario_id: str
    fee_delta: ExactRatioV1
    slippage_delta: ExactRatioV1
    funding_delta: ExactRatioV1
    borrow_delta: ExactRatioV1
    recovery_delta: ExactRatioV1
    latency_ns: int

    def __post_init__(self) -> None:
        require_contract_id(self.scenario_id, field="scenario_id")
        _require_cost_ratio(self.fee_delta, field="fee_delta")
        _require_cost_ratio(self.slippage_delta, field="slippage_delta")
        _require_cost_ratio(self.funding_delta, field="funding_delta")
        _require_cost_ratio(self.borrow_delta, field="borrow_delta")
        _require_cost_ratio(self.recovery_delta, field="recovery_delta")
        require_strict_int(self.latency_ns, field="latency_ns", minimum=0, maximum=MAX_LATENCY_NS)

    def as_mapping(self) -> dict[str, object]:
        return {
            "borrowDelta": self.borrow_delta.as_mapping(),
            "feeDelta": self.fee_delta.as_mapping(),
            "fundingDelta": self.funding_delta.as_mapping(),
            "latencyNs": str(self.latency_ns),
            "recoveryDelta": self.recovery_delta.as_mapping(),
            "scenarioId": self.scenario_id,
            "slippageDelta": self.slippage_delta.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class StressSpecV1:
    """Declared actionability threshold, decay law and scenario grid."""

    act_threshold: ExactRatioV1
    decay: OpportunityDecayV1
    scenarios: tuple[CostStressScenarioV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.act_threshold, ExactRatioV1):
            raise ContractValueError("act_threshold must be ExactRatioV1")
        if not isinstance(self.decay, OpportunityDecayV1):
            raise ContractValueError("decay must be OpportunityDecayV1")
        if not isinstance(self.scenarios, tuple) or not self.scenarios:
            raise ContractValueError("scenarios must be a non-empty tuple")
        if len(self.scenarios) > MAX_SCENARIOS:
            raise ContractValueError("scenario count exceeds MAX_SCENARIOS")
        seen: set[str] = set()
        for scenario in self.scenarios:
            if not isinstance(scenario, CostStressScenarioV1):
                raise ContractValueError("scenarios must contain CostStressScenarioV1 entries")
            if scenario.scenario_id in seen:
                raise ContractValueError(f"duplicate scenario id: {scenario.scenario_id}")
            seen.add(scenario.scenario_id)

    def as_mapping(self) -> dict[str, object]:
        return {
            "actThreshold": self.act_threshold.as_mapping(),
            "decay": self.decay.as_mapping(),
            "scenarios": [scenario.as_mapping() for scenario in self.scenarios],
        }


@dataclass(frozen=True, slots=True)
class ScenarioOutcomeV1:
    """Deterministic per-scenario stress accounting."""

    scenario_id: str
    actionable_count: int
    not_actionable_count: int
    abstain_count: int
    flipped_from_base_count: int
    mean_net_edge: FixedPointV1 | None
    min_net_edge: FixedPointV1 | None

    def as_mapping(self) -> dict[str, object]:
        return {
            "abstainCount": self.abstain_count,
            "actionableCount": self.actionable_count,
            "flippedFromBaseCount": self.flipped_from_base_count,
            "meanNetEdge": None if self.mean_net_edge is None else self.mean_net_edge.as_mapping(),
            "minNetEdge": None if self.min_net_edge is None else self.min_net_edge.as_mapping(),
            "notActionableCount": self.not_actionable_count,
            "scenarioId": self.scenario_id,
        }


@dataclass(frozen=True, slots=True)
class CostStressReportV1:
    """Stress verdict across the declared scenario grid."""

    spec: StressSpecV1
    base_actionable_count: int
    base_abstain_count: int
    outcomes: tuple[ScenarioOutcomeV1, ...]

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseAbstainCount": self.base_abstain_count,
            "baseActionableCount": self.base_actionable_count,
            "outcomes": [outcome.as_mapping() for outcome in self.outcomes],
            "schema": "Q14CostStressReportV1",
            "spec": self.spec.as_mapping(),
        }


def _fixed(value: Fraction) -> FixedPointV1:
    return FixedPointV1(round_half_even(value.numerator * FIXED_SCALE, value.denominator))


def _scenario_cost(scenario: CostStressScenarioV1, decay: OpportunityDecayV1) -> Fraction:
    total = Fraction(0)
    for delta in (
        scenario.fee_delta,
        scenario.slippage_delta,
        scenario.funding_delta,
        scenario.borrow_delta,
        scenario.recovery_delta,
    ):
        total += Fraction(delta.numerator, delta.denominator)
    decay_ratio = Fraction(
        decay.decay_ratio_per_second.numerator,
        decay.decay_ratio_per_second.denominator,
    )
    return total + decay_ratio * Fraction(scenario.latency_ns, NS_PER_SECOND)


def _classify(
    samples: SampleSetV1,
    extra_cost: Fraction,
    threshold: Fraction,
) -> tuple[list[StressAction], list[Fraction]]:
    actions: list[StressAction] = []
    nets: list[Fraction] = []
    for sample in samples.samples:
        if sample.gross_edge_ratio is None or sample.base_cost_ratio is None:
            actions.append(StressAction.ABSTAIN_UNKNOWN)
            continue
        gross = Fraction(sample.gross_edge_ratio.numerator, sample.gross_edge_ratio.denominator)
        base = Fraction(sample.base_cost_ratio.numerator, sample.base_cost_ratio.denominator)
        net = gross - base - extra_cost
        nets.append(net)
        if net > threshold:
            actions.append(StressAction.ACTIONABLE)
        else:
            actions.append(StressAction.NOT_ACTIONABLE)
    return actions, nets


def run_cost_stress(samples: SampleSetV1, spec: StressSpecV1) -> CostStressReportV1:
    """Classify every sample under every scenario and count flips from base."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(spec, StressSpecV1):
        raise ContractValueError("spec must be StressSpecV1")
    threshold = Fraction(spec.act_threshold.numerator, spec.act_threshold.denominator)
    base_actions, _ = _classify(samples, Fraction(0), threshold)
    outcomes: list[ScenarioOutcomeV1] = []
    for scenario in spec.scenarios:
        extra = _scenario_cost(scenario, spec.decay)
        actions, nets = _classify(samples, extra, threshold)
        flipped = sum(
            1
            for base_action, action in zip(base_actions, actions, strict=True)
            if base_action is StressAction.ACTIONABLE and action is not StressAction.ACTIONABLE
        )
        outcomes.append(
            ScenarioOutcomeV1(
                scenario_id=scenario.scenario_id,
                actionable_count=sum(1 for action in actions if action is StressAction.ACTIONABLE),
                not_actionable_count=sum(
                    1 for action in actions if action is StressAction.NOT_ACTIONABLE
                ),
                abstain_count=sum(
                    1 for action in actions if action is StressAction.ABSTAIN_UNKNOWN
                ),
                flipped_from_base_count=flipped,
                mean_net_edge=_fixed(sum(nets, Fraction(0)) / len(nets)) if nets else None,
                min_net_edge=_fixed(min(nets)) if nets else None,
            )
        )
    return CostStressReportV1(
        spec=spec,
        base_actionable_count=sum(
            1 for action in base_actions if action is StressAction.ACTIONABLE
        ),
        base_abstain_count=sum(
            1 for action in base_actions if action is StressAction.ABSTAIN_UNKNOWN
        ),
        outcomes=tuple(outcomes),
    )
