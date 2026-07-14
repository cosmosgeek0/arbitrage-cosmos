"""Narrow Q12 adapters over accepted Q10/Q11/Q14 owner contracts.

The five Q10 ``WAITING_Q14`` records are immutable historical truth.  This module
closes them additively by validating the exact source table and binding each bullet to
the merged Q14 public owner APIs plus Q12 evidence digests.  It never edits or recasts
the Q10 disposition table and never duplicates Q14 algorithms.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum

from quant_edge.canonical import canonical_json_bytes
from quant_edge.ensemble.stacking import (
    FittedStackV1,
    ValidatedOofMatrixV1,
    stack_predictions_for_folds,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import DigestV1, require_contract_id
from quant_edge.models.contracts import (
    BatteryDisposition,
    BatteryDispositionRecordV1,
    disposition_table_digest,
)
from quant_edge.survival import ANY_CAUSE
from quant_edge.survival import PredictionSetV1 as SurvivalPredictionSetV1
from quant_edge.validation import (
    BootstrapIntervalV1,
    BootstrapStatus,
    CostStressReportV1,
    DsrReportV1,
    DsrStatus,
    HoldoutGrantV1,
    LeakageAssessmentV1,
    LeakageSpecV1,
    LeakageVerdict,
    PboReportV1,
    PboStatus,
    PlanStatus,
    PredictionV1,
    SampleSetV1,
    TrialLedgerV1,
    WalkForwardPlanV1,
    assess_leakage,
    falsify_lineage,
    future_leaked_predictions,
    run_cost_stress,
    subset_by_ids,
)
from quant_edge.validation import (
    PredictionSetV1 as ValidationPredictionSetV1,
)

WAITING_Q14_IDS: tuple[str, ...] = (
    "16-01-purged-embargoed-walk-forward",
    "16-02-untouched-holdout",
    "16-03-negative-control-factory",
    "16-04-cost-latency-stress",
    "16-05-pbo-dsr-bootstrap",
)
ANY_CAUSE_BINARY_TARGET: str = "any-cause-event:v1"
Q14_ACCEPTANCE_COMMIT: str = "e266b42913fb721cc2a8470a08774be3fdf1ce0c"
Q14_DIRECTOR_MERGE: str = "f756f3b582f24857811e6ec4c0d08a3a61026b74"
Q10_DISPOSITION_DIGEST: str = "66e2b4e296c75b13b9dc800fe7f103f7e8777bb0491f462ccf678d4b2162a259"

_CLOSURE_APIS: dict[str, tuple[str, ...]] = {
    "16-01-purged-embargoed-walk-forward": (
        "quant_edge.validation.WalkForwardSpecV1",
        "quant_edge.validation.build_walk_forward_plan",
    ),
    "16-02-untouched-holdout": (
        "quant_edge.validation.HoldoutGrantV1",
        "quant_edge.validation.open_holdout",
    ),
    "16-03-negative-control-factory": (
        "quant_edge.validation.assess_leakage",
        "quant_edge.validation.falsify_lineage",
        "quant_edge.validation.future_leaked_predictions",
        "quant_edge.validation.shuffled_labels",
    ),
    "16-04-cost-latency-stress": (
        "quant_edge.ensemble.decide_advisory",
        "quant_edge.validation.run_cost_stress",
    ),
    "16-05-pbo-dsr-bootstrap": (
        "quant_edge.validation.TrialLedgerV1",
        "quant_edge.validation.block_bootstrap_interval",
        "quant_edge.validation.deflated_sharpe_ratio",
        "quant_edge.validation.pbo_cscv",
    ),
}


class ClosureStatus(StrEnum):
    ADAPTED_CLOSED = "ADAPTED_CLOSED"


@dataclass(frozen=True, slots=True)
class BoundClosureStressEvidenceV1:
    """One Q14 stress report bound to the exact rows that produced it."""

    samples: SampleSetV1
    report: CostStressReportV1

    def __post_init__(self) -> None:
        if not isinstance(self.samples, SampleSetV1):
            raise ContractValueError("stress samples must be SampleSetV1")
        if not isinstance(self.report, CostStressReportV1):
            raise ContractValueError("stress report must be CostStressReportV1")
        if run_cost_stress(self.samples, self.report.spec) != self.report:
            raise ContractValueError("stress report must be recomputable from its exact sample set")

    def as_mapping(self) -> dict[str, object]:
        return {
            "report": self.report.as_mapping(),
            "samples": self.samples.as_mapping(),
            "samplesDigest": self.samples.digest().hexdigest,
        }


@dataclass(frozen=True, slots=True)
class BoundClosureLeakageEvidenceV1:
    """Recomputable Q14 leakage battery over honest later-fold Q12 stack output."""

    matrix: ValidatedOofMatrixV1
    fitted_stack: FittedStackV1
    later_fold_ids: tuple[str, ...]
    spec: LeakageSpecV1
    honest_assessment: LeakageAssessmentV1
    falsified_lineage_assessment: LeakageAssessmentV1
    temporal_leak_assessment: LeakageAssessmentV1

    def __post_init__(self) -> None:
        if not isinstance(self.matrix, ValidatedOofMatrixV1):
            raise ContractValueError("matrix must be ValidatedOofMatrixV1")
        if not isinstance(self.fitted_stack, FittedStackV1):
            raise ContractValueError("fitted_stack must be FittedStackV1")
        if not isinstance(self.spec, LeakageSpecV1):
            raise ContractValueError("spec must be LeakageSpecV1")
        if not isinstance(self.later_fold_ids, tuple):
            raise ContractValueError("later_fold_ids must be a tuple")
        assessment_samples, honest_predictions = self._honest_stack()
        forbidden_ids = set(self.matrix.plan.holdout_sample_ids).union(
            self.matrix.plan.quarantined_sample_ids
        )
        if forbidden_ids.intersection(assessment_samples.sample_ids):
            raise ContractValueError("leakage assessment cannot consume holdout or quarantine")
        leaked = future_leaked_predictions(
            assessment_samples,
            model_id=f"q12-temporal-{honest_predictions.digest().hexdigest[:16]}:v1",
        )
        expected = (
            assess_leakage(assessment_samples, honest_predictions, self.spec),
            assess_leakage(
                assessment_samples,
                falsify_lineage(leaked, assessment_samples),
                self.spec,
            ),
            assess_leakage(assessment_samples, leaked, self.spec),
        )
        actual = (
            self.honest_assessment,
            self.falsified_lineage_assessment,
            self.temporal_leak_assessment,
        )
        if any(not isinstance(item, LeakageAssessmentV1) for item in actual):
            raise ContractValueError("leakage assessments must be LeakageAssessmentV1")
        if actual != expected:
            raise ContractValueError(
                "leakage assessments must exactly recompute from bound Q12/Q14 evidence"
            )
        expected_verdicts = (
            LeakageVerdict.ACCEPTED_FOR_COMPARISON,
            LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL,
            LeakageVerdict.REJECTED_TEMPORAL_LEAK,
        )
        if tuple(item.verdict for item in actual) != expected_verdicts:
            raise ContractValueError("leakage battery must prove honest and both leak paths")

    def _honest_stack(self) -> tuple[SampleSetV1, ValidationPredictionSetV1]:
        return stack_predictions_for_folds(
            samples=self.matrix.samples,
            matrix=self.matrix,
            fitted=self.fitted_stack,
            fold_ids=self.later_fold_ids,
        )

    @property
    def assessment_sample_ids(self) -> tuple[str, ...]:
        return self._honest_stack()[0].sample_ids

    @property
    def assessments(self) -> tuple[LeakageAssessmentV1, ...]:
        return (
            self.honest_assessment,
            self.falsified_lineage_assessment,
            self.temporal_leak_assessment,
        )

    def as_mapping(self) -> dict[str, object]:
        assessment_samples, honest_predictions = self._honest_stack()
        return {
            "assessmentSamples": assessment_samples.as_mapping(),
            "falsifiedLineageAssessment": self.falsified_lineage_assessment.as_mapping(),
            "fittedStack": self.fitted_stack.as_mapping(),
            "honestAssessment": self.honest_assessment.as_mapping(),
            "honestPredictions": honest_predictions.as_mapping(),
            "laterFoldIds": list(self.later_fold_ids),
            "matrix": self.matrix.as_mapping(),
            "spec": self.spec.as_mapping(),
            "temporalLeakAssessment": self.temporal_leak_assessment.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class SurvivalPredictionCrosswalkV1:
    """Explicit Q11 subject -> Q14 sample identity and point-in-time lineage."""

    subject_id: str
    sample_id: str
    group_id: str
    max_feature_asof_ns: int

    def __post_init__(self) -> None:
        require_contract_id(self.subject_id, field="subject_id")
        require_contract_id(self.sample_id, field="sample_id")
        require_contract_id(self.group_id, field="group_id")
        if isinstance(self.max_feature_asof_ns, bool) or not isinstance(
            self.max_feature_asof_ns, int
        ):
            raise ContractValueError("max_feature_asof_ns must be an integer")


def project_survival_probability(
    *,
    survival_predictions: SurvivalPredictionSetV1,
    samples: SampleSetV1,
    crosswalk: tuple[SurvivalPredictionCrosswalkV1, ...],
    horizon_ns: int,
    target_id: str,
    model_id: str,
) -> ValidationPredictionSetV1:
    """Project one exact Q11 cause/horizon CDF into a Q14 prediction set.

    The projection is allowed only when the requested horizon is an exact Q11 grid
    point and every subject/sample/group identity is explicit. Unknown Q11 strata or
    unavailable bins cannot construct ``SurvivalPredictionSetV1`` and therefore remain
    absent rather than becoming zero here.
    """

    if not isinstance(survival_predictions, SurvivalPredictionSetV1):
        raise ContractValueError("survival_predictions must be Q11 PredictionSetV1")
    if survival_predictions.cause_scope != ANY_CAUSE:
        raise ContractValueError("survival projection requires the Q11 ANY_CAUSE scope")
    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be Q14 SampleSetV1")
    if target_id != ANY_CAUSE_BINARY_TARGET:
        raise ContractValueError("survival projection target semantics are frozen")
    require_contract_id(model_id, field="model_id")
    try:
        time_index = survival_predictions.grid.times_ns.index(horizon_ns)
    except ValueError as error:
        raise ContractValueError("horizon_ns must equal one Q11 grid time") from error
    if not isinstance(crosswalk, tuple) or not crosswalk:
        raise ContractValueError("crosswalk must be a non-empty tuple")
    if any(not isinstance(item, SurvivalPredictionCrosswalkV1) for item in crosswalk):
        raise ContractValueError("crosswalk must contain SurvivalPredictionCrosswalkV1")
    subject_ids = tuple(item.subject_id for item in crosswalk)
    sample_ids = tuple(item.sample_id for item in crosswalk)
    if len(set(subject_ids)) != len(subject_ids) or len(set(sample_ids)) != len(sample_ids):
        raise ContractValueError("crosswalk subject and sample ids must be unique")
    predictions_by_subject = {
        prediction.subject_id: prediction for prediction in survival_predictions.predictions
    }
    if set(predictions_by_subject) != set(subject_ids):
        raise ContractValueError("crosswalk must cover exactly the Q11 prediction subjects")
    if set(sample_ids) != set(samples.sample_ids):
        raise ContractValueError("crosswalk must cover exactly the Q14 sample set")
    projected: list[PredictionV1] = []
    for link in crosswalk:
        sample = samples.by_id(link.sample_id)
        if sample.label_horizon_ns != horizon_ns:
            raise ContractValueError("Q14 sample horizon must match the projected Q11 horizon")
        if link.group_id != sample.group_id:
            raise ContractValueError("crosswalk group_id must match Q14 sample truth")
        if link.max_feature_asof_ns > sample.cutoff_ns:
            raise ContractValueError("survival projection uses a feature after cutoff")
        probability = predictions_by_subject[link.subject_id].event_probabilities[time_index]
        projected.append(
            PredictionV1(
                sample_id=link.sample_id,
                score=make_ratio(probability.mantissa, FIXED_POINT_SCALE),
                max_feature_asof_ns=link.max_feature_asof_ns,
            )
        )
    return ValidationPredictionSetV1(
        model_id=f"{model_id}.{target_id}.h{horizon_ns}",
        dataset_digest=samples.digest(),
        predictions=tuple(sorted(projected, key=lambda item: item.sample_id)),
    )


@dataclass(frozen=True, slots=True)
class ValidationClosureEvidenceV1:
    plan_samples: SampleSetV1
    research_samples: SampleSetV1
    walk_forward_plan: WalkForwardPlanV1
    holdout_grant: HoldoutGrantV1
    opened_holdout_sample_ids: tuple[str, ...]
    leakage_evidence: BoundClosureLeakageEvidenceV1
    stress_evidence: tuple[BoundClosureStressEvidenceV1, ...]
    trial_ledger: TrialLedgerV1
    pbo_report: PboReportV1
    dsr_report: DsrReportV1
    bootstrap_report: BootstrapIntervalV1

    def __post_init__(self) -> None:
        if not isinstance(self.plan_samples, SampleSetV1):
            raise ContractValueError("plan_samples must be SampleSetV1")
        if not isinstance(self.research_samples, SampleSetV1):
            raise ContractValueError("research_samples must be SampleSetV1")
        if (
            not isinstance(self.walk_forward_plan, WalkForwardPlanV1)
            or self.walk_forward_plan.status is not PlanStatus.VALID
        ):
            raise ContractValueError("walk_forward_plan must be a valid Q14 plan")
        if self.walk_forward_plan.dataset_digest != self.plan_samples.digest():
            raise ContractValueError("walk_forward_plan must bind the exact plan sample set")
        forbidden_ids = set(self.walk_forward_plan.holdout_sample_ids).union(
            self.walk_forward_plan.quarantined_sample_ids
        )
        expected_research_ids = tuple(
            sample_id
            for sample_id in self.plan_samples.sample_ids
            if sample_id not in forbidden_ids
        )
        expected_research = subset_by_ids(self.plan_samples, expected_research_ids)
        if self.research_samples != expected_research:
            raise ContractValueError(
                "research_samples must equal all non-holdout/non-quarantined plan rows"
            )
        if (
            not isinstance(self.holdout_grant, HoldoutGrantV1)
            or self.holdout_grant.plan_digest != self.walk_forward_plan.digest()
        ):
            raise ContractValueError("holdout_grant must bind the Q14 plan")
        if self.opened_holdout_sample_ids != self.walk_forward_plan.holdout_sample_ids:
            raise ContractValueError("opened holdout ids must exactly match the Q14 plan")
        if not isinstance(self.leakage_evidence, BoundClosureLeakageEvidenceV1):
            raise ContractValueError("leakage_evidence must be BoundClosureLeakageEvidenceV1")
        if (
            self.leakage_evidence.matrix.samples != self.plan_samples
            or self.leakage_evidence.matrix.plan != self.walk_forward_plan
        ):
            raise ContractValueError("leakage evidence must bind the exact plan authority")
        if not set(self.leakage_evidence.assessment_sample_ids).issubset(
            self.research_samples.sample_ids
        ):
            raise ContractValueError("leakage evidence must use only exact research rows")
        if not self.stress_evidence or any(
            not isinstance(item, BoundClosureStressEvidenceV1) for item in self.stress_evidence
        ):
            raise ContractValueError("stress_evidence must contain bound Q14 reports")
        full_samples = {sample.sample_id: sample for sample in self.plan_samples.samples}
        for bound in self.stress_evidence:
            if bound.samples.posture is not self.research_samples.posture:
                raise ContractValueError("stress rows must preserve the plan evidence posture")
            for sample in bound.samples.samples:
                if sample.sample_id in forbidden_ids:
                    raise ContractValueError("stress evidence cannot consume holdout or quarantine")
                if full_samples.get(sample.sample_id) != sample:
                    raise ContractValueError("stress evidence rows must come exactly from the plan")
        reports = self.stress_reports
        outcomes = tuple(outcome for report in reports for outcome in report.outcomes)
        negative_net_proven = any(
            outcome.min_net_edge is not None and outcome.min_net_edge.mantissa < 0
            for outcome in outcomes
        )
        latency_flip_proven = any(
            report.spec.decay.decay_ratio_per_second.numerator > 0
            and any(scenario.latency_ns > 0 for scenario in report.spec.scenarios)
            and any(outcome.flipped_from_base_count > 0 for outcome in report.outcomes)
            for report in reports
        )
        if (
            not negative_net_proven
            or not latency_flip_proven
            or not any(outcome.abstain_count > 0 for outcome in outcomes)
        ):
            raise ContractValueError("stress evidence must prove cost-negative and unknown paths")
        if not isinstance(self.trial_ledger, TrialLedgerV1):
            raise ContractValueError("trial_ledger must be TrialLedgerV1")
        if (
            not isinstance(self.pbo_report, PboReportV1)
            or self.pbo_report.status is not PboStatus.AVAILABLE
        ):
            raise ContractValueError("pbo_report must be AVAILABLE")
        if (
            not isinstance(self.dsr_report, DsrReportV1)
            or self.dsr_report.status is not DsrStatus.AVAILABLE
        ):
            raise ContractValueError("dsr_report must be AVAILABLE")
        if (
            not isinstance(self.bootstrap_report, BootstrapIntervalV1)
            or self.bootstrap_report.status is not BootstrapStatus.AVAILABLE
        ):
            raise ContractValueError("bootstrap_report must be AVAILABLE")

    @property
    def leakage_assessments(self) -> tuple[LeakageAssessmentV1, ...]:
        return self.leakage_evidence.assessments

    @property
    def stress_reports(self) -> tuple[CostStressReportV1, ...]:
        return tuple(item.report for item in self.stress_evidence)

    @staticmethod
    def _digest_mapping(value: object) -> DigestV1:
        if not hasattr(value, "as_mapping"):
            raise ContractValueError("closure evidence must expose canonical mappings")
        mapping = value.as_mapping()
        return DigestV1(hashlib.sha256(canonical_json_bytes(mapping)).hexdigest())

    def for_bullet(self, bullet_id: str) -> DigestV1:
        mapping = {
            WAITING_Q14_IDS[0]: self.walk_forward_plan.digest(),
            WAITING_Q14_IDS[1]: self._digest_mapping(self.holdout_grant),
            WAITING_Q14_IDS[2]: self._digest_mapping(self.leakage_evidence),
            WAITING_Q14_IDS[3]: DigestV1(
                hashlib.sha256(
                    canonical_json_bytes([item.as_mapping() for item in self.stress_evidence])
                ).hexdigest()
            ),
            WAITING_Q14_IDS[4]: DigestV1(
                hashlib.sha256(
                    canonical_json_bytes(
                        {
                            "bootstrap": self.bootstrap_report.as_mapping(),
                            "dsr": self.dsr_report.as_mapping(),
                            "ledger": self.trial_ledger.as_mapping(),
                            "pbo": self.pbo_report.as_mapping(),
                        }
                    )
                ).hexdigest()
            ),
        }
        try:
            return mapping[bullet_id]
        except KeyError as error:
            raise ContractValueError(f"unknown Q10 WAITING_Q14 bullet: {bullet_id}") from error

    def as_mapping(self) -> dict[str, object]:
        return {
            "bootstrapReport": self.bootstrap_report.as_mapping(),
            "dsrReport": self.dsr_report.as_mapping(),
            "holdoutGrant": self.holdout_grant.as_mapping(),
            "leakageEvidence": self.leakage_evidence.as_mapping(),
            "openedHoldoutSampleIds": list(self.opened_holdout_sample_ids),
            "planSamples": self.plan_samples.as_mapping(),
            "pboReport": self.pbo_report.as_mapping(),
            "researchSamples": self.research_samples.as_mapping(),
            "stressEvidence": [item.as_mapping() for item in self.stress_evidence],
            "trialLedger": self.trial_ledger.as_mapping(),
            "walkForwardPlan": self.walk_forward_plan.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class ValidationClosureRecordV1:
    bullet_id: str
    status: ClosureStatus
    closure_apis: tuple[str, ...]
    evidence_digest: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.bullet_id, field="bullet_id")
        if self.bullet_id not in WAITING_Q14_IDS:
            raise ContractValueError("closure bullet is not a frozen Q10 WAITING_Q14 id")
        if self.status is not ClosureStatus.ADAPTED_CLOSED:
            raise ContractValueError("Q12 supports only ADAPTED_CLOSED closure records")
        if self.closure_apis != tuple(sorted(set(self.closure_apis))):
            raise ContractValueError("closure_apis must be sorted and unique")
        if not isinstance(self.evidence_digest, DigestV1):
            raise ContractValueError("evidence_digest must be DigestV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bulletId": self.bullet_id,
            "evidenceDigest": self.evidence_digest.hexdigest,
            "closureApis": list(self.closure_apis),
            "status": self.status.value,
        }


@dataclass(frozen=True, slots=True)
class ValidationClosureManifestV1:
    q10_disposition_digest: DigestV1
    q14_acceptance_commit: str
    q14_director_merge: str
    evidence: ValidationClosureEvidenceV1
    records: tuple[ValidationClosureRecordV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.q10_disposition_digest, DigestV1):
            raise ContractValueError("q10_disposition_digest must be DigestV1")
        if self.q10_disposition_digest.hexdigest != Q10_DISPOSITION_DIGEST:
            raise ContractValueError("closure must bind the accepted immutable Q10 table")
        require_contract_id(self.q14_acceptance_commit, field="q14_acceptance_commit")
        require_contract_id(self.q14_director_merge, field="q14_director_merge")
        if self.q14_acceptance_commit != Q14_ACCEPTANCE_COMMIT:
            raise ContractValueError("closure must bind the accepted Q14 commit")
        if self.q14_director_merge != Q14_DIRECTOR_MERGE:
            raise ContractValueError("closure must bind the director Q14 merge")
        if not isinstance(self.evidence, ValidationClosureEvidenceV1):
            raise ContractValueError("evidence must be ValidationClosureEvidenceV1")
        ids = tuple(record.bullet_id for record in self.records)
        if ids != WAITING_Q14_IDS:
            raise ContractValueError("closure manifest must contain all five bullets in order")
        for record in self.records:
            if record.status is not ClosureStatus.ADAPTED_CLOSED:
                raise ContractValueError("closure manifest record status is not accepted")
            if record.closure_apis != tuple(sorted(_CLOSURE_APIS[record.bullet_id])):
                raise ContractValueError(
                    "closure manifest record APIs do not match the frozen seam"
                )
            if record.evidence_digest != self.evidence.for_bullet(record.bullet_id):
                raise ContractValueError("closure manifest record evidence is not bound")

    def as_mapping(self) -> dict[str, object]:
        return {
            "evidence": self.evidence.as_mapping(),
            "q10DispositionDigest": self.q10_disposition_digest.hexdigest,
            "q14AcceptanceCommit": self.q14_acceptance_commit,
            "q14DirectorMerge": self.q14_director_merge,
            "records": [record.as_mapping() for record in self.records],
            "schema": "Q12ValidationClosureManifestV1",
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def close_q10_waiting_q14(
    *,
    q10_dispositions: tuple[BatteryDispositionRecordV1, ...],
    evidence: ValidationClosureEvidenceV1,
    q14_acceptance_commit: str,
    q14_director_merge: str,
) -> ValidationClosureManifestV1:
    """Validate immutable Q10 history and create the additive Q12 closure manifest."""

    if not isinstance(q10_dispositions, tuple) or not q10_dispositions:
        raise ContractValueError("q10_dispositions must be a non-empty tuple")
    if not isinstance(evidence, ValidationClosureEvidenceV1):
        raise ContractValueError("evidence must be ValidationClosureEvidenceV1")
    source_digest = disposition_table_digest(q10_dispositions)
    if source_digest.hexdigest != Q10_DISPOSITION_DIGEST:
        raise ContractValueError("Q10 disposition table differs from accepted immutable history")
    waiting = tuple(
        record
        for record in q10_dispositions
        if record.disposition is BatteryDisposition.WAITING_Q14
    )
    ids = tuple(record.bullet_id for record in waiting)
    if ids != WAITING_Q14_IDS:
        raise ContractValueError("immutable Q10 WAITING_Q14 records do not match the frozen seam")
    records = tuple(
        ValidationClosureRecordV1(
            bullet_id=bullet_id,
            status=ClosureStatus.ADAPTED_CLOSED,
            closure_apis=tuple(sorted(_CLOSURE_APIS[bullet_id])),
            evidence_digest=evidence.for_bullet(bullet_id),
        )
        for bullet_id in WAITING_Q14_IDS
    )
    return ValidationClosureManifestV1(
        q10_disposition_digest=source_digest,
        q14_acceptance_commit=q14_acceptance_commit,
        q14_director_merge=q14_director_merge,
        evidence=evidence,
        records=records,
    )
