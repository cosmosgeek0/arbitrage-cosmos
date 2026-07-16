"""Pure seven-criterion Q13 deep-data sufficiency gate."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    require_contract_id,
    require_reason_code,
    require_strict_int,
)

EXACT_EVIDENCE_GAP: Final = (
    "HISTORICAL_L2_SEQUENCE_COVERAGE_MISSING: atlas contains only 832 BNBUSDT Spot "
    "aggTrades on 2017-11-06; zero complete sequenced L2 rows, zero real point-in-time "
    "labels/outcomes, no cost/actionability truth, no independent multi-day/regime "
    "cohort, and no untouched chronological holdout."
)


class SufficiencyCriterion(StrEnum):
    COMPLETE_HISTORICAL_L2 = "COMPLETE_HISTORICAL_L2"
    INDEPENDENT_EVENTS_REGIMES = "INDEPENDENT_EVENTS_REGIMES"
    STABLE_POINT_IN_TIME_LABELS = "STABLE_POINT_IN_TIME_LABELS"
    REALISTIC_COST_ACTIONABILITY = "REALISTIC_COST_ACTIONABILITY"
    MEASURED_COMPUTE_BUDGET = "MEASURED_COMPUTE_BUDGET"
    UNTOUCHED_CHRONOLOGICAL_HOLDOUT = "UNTOUCHED_CHRONOLOGICAL_HOLDOUT"
    SAME_COHORT_SIMPLE_BASELINE = "SAME_COHORT_SIMPLE_BASELINE"


CRITERION_ORDER: Final = tuple(SufficiencyCriterion)


class CriterionState(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"


class DeepGateStatus(StrEnum):
    SUFFICIENT = "SUFFICIENT"
    FAIL_DATA_INSUFFICIENT = "FAIL_DATA_INSUFFICIENT"


@dataclass(frozen=True, slots=True)
class DeepDataSufficiencyEvidenceV1:
    """Injected receipt facts; ``None`` is unproven and therefore fail-closed."""

    evaluated_at_ns: int
    complete_historical_l2: bool | None
    independent_events_regimes: bool | None
    stable_point_in_time_labels: bool | None
    realistic_cost_actionability: bool | None
    measured_compute_budget: bool | None
    untouched_chronological_holdout: bool | None
    same_cohort_simple_baseline: bool | None
    reason_codes: tuple[str, ...]
    evidence_digests: tuple[tuple[str, DigestV1], ...]
    evidence_gap: str | None

    def __post_init__(self) -> None:
        require_strict_int(
            self.evaluated_at_ns,
            field="evaluated_at_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        for field in (
            "complete_historical_l2",
            "independent_events_regimes",
            "stable_point_in_time_labels",
            "realistic_cost_actionability",
            "measured_compute_budget",
            "untouched_chronological_holdout",
            "same_cohort_simple_baseline",
        ):
            value = getattr(self, field)
            if value is not None and not isinstance(value, bool):
                raise ContractValueError(f"{field} must be boolean or None")
        if not isinstance(self.reason_codes, tuple) or not self.reason_codes:
            raise ContractValueError("reason_codes must be a non-empty tuple")
        reasons = tuple(
            require_reason_code(code, field="reason_codes") for code in self.reason_codes
        )
        if reasons != tuple(sorted(set(reasons))):
            raise ContractValueError("reason_codes must be sorted and unique")
        if not isinstance(self.evidence_digests, tuple) or not self.evidence_digests:
            raise ContractValueError("evidence_digests must be a non-empty tuple")
        names: list[str] = []
        for entry in self.evidence_digests:
            if not isinstance(entry, tuple) or len(entry) != 2:
                raise ContractValueError("each evidence digest must be a (name, DigestV1) pair")
            name, digest = entry
            names.append(require_contract_id(name, field="evidence name"))
            if not isinstance(digest, DigestV1):
                raise ContractValueError("evidence digest must be DigestV1")
        if names != sorted(set(names)):
            raise ContractValueError("evidence_digests must be sorted by unique name")
        all_pass = all(value is True for value in self.criterion_values)
        if all_pass and self.evidence_gap is not None:
            raise ContractValueError("sufficient evidence cannot carry a failure gap")
        if not all_pass and self.evidence_gap != EXACT_EVIDENCE_GAP:
            raise ContractValueError("insufficient evidence must carry the exact Q13 evidence gap")

    @property
    def criterion_values(self) -> tuple[bool | None, ...]:
        return (
            self.complete_historical_l2,
            self.independent_events_regimes,
            self.stable_point_in_time_labels,
            self.realistic_cost_actionability,
            self.measured_compute_budget,
            self.untouched_chronological_holdout,
            self.same_cohort_simple_baseline,
        )

    def as_mapping(self) -> dict[str, object]:
        facts = {
            criterion.value: value
            for criterion, value in zip(CRITERION_ORDER, self.criterion_values, strict=True)
        }
        return {
            "evaluatedAtNs": str(self.evaluated_at_ns),
            "evidenceDigests": {name: digest.hexdigest for name, digest in self.evidence_digests},
            "evidenceGap": self.evidence_gap,
            "facts": facts,
            "reasonCodes": list(self.reason_codes),
            "schema": "Q13DeepDataSufficiencyEvidenceV1",
        }


@dataclass(frozen=True, slots=True)
class SufficiencyFindingV1:
    criterion: SufficiencyCriterion
    state: CriterionState

    def __post_init__(self) -> None:
        if not isinstance(self.criterion, SufficiencyCriterion):
            raise ContractValueError("criterion must be SufficiencyCriterion")
        if not isinstance(self.state, CriterionState):
            raise ContractValueError("state must be CriterionState")

    def as_mapping(self) -> dict[str, object]:
        return {"criterion": self.criterion.value, "state": self.state.value}


@dataclass(frozen=True, slots=True)
class DeepDataSufficiencyReportV1:
    status: DeepGateStatus
    evidence: DeepDataSufficiencyEvidenceV1
    findings: tuple[SufficiencyFindingV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.status, DeepGateStatus):
            raise ContractValueError("status must be DeepGateStatus")
        if not isinstance(self.evidence, DeepDataSufficiencyEvidenceV1):
            raise ContractValueError("evidence must be DeepDataSufficiencyEvidenceV1")
        if not isinstance(self.findings, tuple) or any(
            not isinstance(finding, SufficiencyFindingV1) for finding in self.findings
        ):
            raise ContractValueError("findings must contain SufficiencyFindingV1 entries")
        criteria = tuple(finding.criterion for finding in self.findings)
        if criteria != CRITERION_ORDER:
            raise ContractValueError("findings must contain the seven criteria in canonical order")
        expected = (
            DeepGateStatus.SUFFICIENT
            if all(finding.state is CriterionState.PASS for finding in self.findings)
            else DeepGateStatus.FAIL_DATA_INSUFFICIENT
        )
        if self.status is not expected:
            raise ContractValueError("status must fail closed unless every criterion passes")

    @property
    def training_permitted(self) -> bool:
        return self.status is DeepGateStatus.SUFFICIENT

    def as_mapping(self) -> dict[str, object]:
        return {
            "evidence": self.evidence.as_mapping(),
            "findings": [finding.as_mapping() for finding in self.findings],
            "schema": "Q13DeepDataSufficiencyReportV1",
            "status": self.status.value,
            "trainingPermitted": self.training_permitted,
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def _criterion_state(value: bool | None) -> CriterionState:
    if value is True:
        return CriterionState.PASS
    if value is False:
        return CriterionState.FAIL
    return CriterionState.UNKNOWN


def evaluate_deep_data_sufficiency(
    evidence: DeepDataSufficiencyEvidenceV1,
) -> DeepDataSufficiencyReportV1:
    if not isinstance(evidence, DeepDataSufficiencyEvidenceV1):
        raise ContractValueError("evidence must be DeepDataSufficiencyEvidenceV1")
    findings = tuple(
        SufficiencyFindingV1(criterion=criterion, state=_criterion_state(value))
        for criterion, value in zip(CRITERION_ORDER, evidence.criterion_values, strict=True)
    )
    status = (
        DeepGateStatus.SUFFICIENT
        if all(finding.state is CriterionState.PASS for finding in findings)
        else DeepGateStatus.FAIL_DATA_INSUFFICIENT
    )
    return DeepDataSufficiencyReportV1(
        status=status,
        evidence=evidence,
        findings=findings,
    )
