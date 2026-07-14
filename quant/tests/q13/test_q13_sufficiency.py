from __future__ import annotations

from dataclasses import replace

import pytest

from quant_edge.deep import (
    CRITERION_ORDER,
    EXACT_EVIDENCE_GAP,
    CriterionState,
    DeepDataSufficiencyEvidenceV1,
    DeepDataSufficiencyReportV1,
    DeepGateStatus,
    SufficiencyFindingV1,
    evaluate_deep_data_sufficiency,
    frozen_q13_sufficiency_evidence,
)
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1


def _passed_evidence() -> DeepDataSufficiencyEvidenceV1:
    base = frozen_q13_sufficiency_evidence()
    return replace(
        base,
        complete_historical_l2=True,
        independent_events_regimes=True,
        stable_point_in_time_labels=True,
        realistic_cost_actionability=True,
        measured_compute_budget=True,
        untouched_chronological_holdout=True,
        same_cohort_simple_baseline=True,
        evidence_gap=None,
    )


def test_actual_evidence_fails_all_proven_requirements_and_keeps_unknown_compute() -> None:
    evidence = frozen_q13_sufficiency_evidence()
    report = evaluate_deep_data_sufficiency(evidence)

    assert report.status is DeepGateStatus.FAIL_DATA_INSUFFICIENT
    assert report.training_permitted is False
    assert evidence.evidence_gap == EXACT_EVIDENCE_GAP
    assert tuple(finding.criterion for finding in report.findings) == CRITERION_ORDER
    assert tuple(finding.state for finding in report.findings) == (
        CriterionState.FAIL,
        CriterionState.FAIL,
        CriterionState.FAIL,
        CriterionState.FAIL,
        CriterionState.UNKNOWN,
        CriterionState.FAIL,
        CriterionState.FAIL,
    )
    assert report.as_mapping()["trainingPermitted"] is False
    assert len(report.digest().hexdigest) == 64


def test_all_seven_proofs_are_required_for_sufficiency() -> None:
    evidence = _passed_evidence()
    report = evaluate_deep_data_sufficiency(evidence)
    assert report.status is DeepGateStatus.SUFFICIENT
    assert report.training_permitted is True
    assert all(finding.state is CriterionState.PASS for finding in report.findings)
    assert evidence.as_mapping()["evidenceGap"] is None

    failed = replace(evidence, measured_compute_budget=None, evidence_gap=EXACT_EVIDENCE_GAP)
    assert evaluate_deep_data_sufficiency(failed).status is DeepGateStatus.FAIL_DATA_INSUFFICIENT


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"complete_historical_l2": 1}, "boolean or None"),
        ({"reason_codes": ()}, "non-empty tuple"),
        ({"reason_codes": ("B_CODE", "A_CODE")}, "sorted and unique"),
        ({"evidence_digests": ()}, "non-empty tuple"),
        (
            {"evidence_digests": (("not-a-pair",),)},
            r"must be a \(name, DigestV1\) pair",
        ),
        (
            {"evidence_digests": (("evidence", "not-a-digest"),)},
            "DigestV1",
        ),
        (
            {
                "evidence_digests": (
                    ("same", DigestV1("0" * 64)),
                    ("same", DigestV1("1" * 64)),
                )
            },
            "sorted by unique name",
        ),
        ({"evidence_gap": None}, "exact Q13 evidence gap"),
    ],
)
def test_evidence_contract_rejects_false_or_ambiguous_truth(
    changes: dict[str, object], message: str
) -> None:
    with pytest.raises(ContractValueError, match=message):
        replace(frozen_q13_sufficiency_evidence(), **changes)  # type: ignore[arg-type]


def test_sufficient_evidence_cannot_carry_a_failure_gap() -> None:
    with pytest.raises(ContractValueError, match="cannot carry"):
        replace(_passed_evidence(), evidence_gap=EXACT_EVIDENCE_GAP)


def test_evaluator_and_report_refuse_malformed_types_or_status() -> None:
    evidence = frozen_q13_sufficiency_evidence()
    report = evaluate_deep_data_sufficiency(evidence)
    with pytest.raises(ContractValueError, match="evidence must"):
        evaluate_deep_data_sufficiency("bad")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="status must"):
        replace(report, status="bad")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="evidence must"):
        replace(report, evidence="bad")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="findings must contain"):
        replace(report, findings=("bad",))  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="canonical order"):
        replace(report, findings=tuple(reversed(report.findings)))
    with pytest.raises(ContractValueError, match="fail closed"):
        replace(report, status=DeepGateStatus.SUFFICIENT)

    finding = SufficiencyFindingV1(CRITERION_ORDER[0], CriterionState.FAIL)
    assert finding.as_mapping() == {
        "criterion": "COMPLETE_HISTORICAL_L2",
        "state": "FAIL",
    }
    with pytest.raises(ContractValueError, match="criterion must"):
        SufficiencyFindingV1("bad", CriterionState.FAIL)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="state must"):
        SufficiencyFindingV1(CRITERION_ORDER[0], "bad")  # type: ignore[arg-type]

    with pytest.raises(ContractValueError, match="fail closed"):
        DeepDataSufficiencyReportV1(
            status=DeepGateStatus.FAIL_DATA_INSUFFICIENT,
            evidence=_passed_evidence(),
            findings=tuple(
                SufficiencyFindingV1(criterion, CriterionState.PASS)
                for criterion in CRITERION_ORDER
            ),
        )
