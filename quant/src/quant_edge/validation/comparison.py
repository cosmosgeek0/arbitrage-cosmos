"""Challenger-versus-baseline comparison reports over a walk-forward plan.

The comparison runs only after both models clear the leakage verdicts. Per-fold
primary-metric deltas (direction-adjusted so positive always means the challenger
helped) feed a seeded bootstrap interval; the verdict is evidence-based and refuses
to exist when the plan, folds or metrics cannot support one. Reports are digest-bound
canonical mappings with a deterministic Markdown projection.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1
from quant_edge.validation.bootstrap import (
    BootstrapIntervalV1,
    BootstrapSpecV1,
    BootstrapStatus,
    block_bootstrap_interval,
)
from quant_edge.validation.leakage import (
    LeakageAssessmentV1,
    LeakageSpecV1,
    LeakageVerdict,
    assess_leakage,
)
from quant_edge.validation.metrics import (
    MetricStatus,
    MetricValueV1,
    PrimaryMetricSpecV1,
    evaluate_primary,
)
from quant_edge.validation.multiplicity import TrialLedgerV1
from quant_edge.validation.samples import (
    PredictionSetV1,
    SampleSetV1,
    restrict_predictions,
    subset_by_ids,
)
from quant_edge.validation.splits import (
    FoldStatus,
    HoldoutGrantV1,
    PlanStatus,
    WalkForwardPlanV1,
    open_holdout,
)

MIN_COMPARED_FOLDS: Final = 2


class ComparisonVerdict(StrEnum):
    IMPROVES = "IMPROVES"
    NO_EVIDENCE = "NO_EVIDENCE"
    WORSE = "WORSE"
    INVALID_PLAN = "INVALID_PLAN"
    INVALID_BASELINE = "INVALID_BASELINE"
    REJECTED_CHALLENGER_LEAKAGE = "REJECTED_CHALLENGER_LEAKAGE"
    REJECTED_CHALLENGER_LINEAGE = "REJECTED_CHALLENGER_LINEAGE"
    INSUFFICIENT_FOLDS = "INSUFFICIENT_FOLDS"


@dataclass(frozen=True, slots=True)
class ComparisonSpecV1:
    """Declared comparison law: primary metric, bootstrap and leakage specs."""

    primary: PrimaryMetricSpecV1
    bootstrap: BootstrapSpecV1
    leakage: LeakageSpecV1

    def __post_init__(self) -> None:
        if not isinstance(self.primary, PrimaryMetricSpecV1):
            raise ContractValueError("primary must be PrimaryMetricSpecV1")
        if not isinstance(self.bootstrap, BootstrapSpecV1):
            raise ContractValueError("bootstrap must be BootstrapSpecV1")
        if not isinstance(self.leakage, LeakageSpecV1):
            raise ContractValueError("leakage must be LeakageSpecV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bootstrap": self.bootstrap.as_mapping(),
            "leakage": self.leakage.as_mapping(),
            "primary": self.primary.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class FoldComparisonV1:
    """Per-fold metric pair and direction-adjusted delta."""

    fold_id: str
    baseline: MetricValueV1
    challenger: MetricValueV1
    effect: ExactRatioV1 | None

    def as_mapping(self) -> dict[str, object]:
        return {
            "baseline": self.baseline.as_mapping(),
            "challenger": self.challenger.as_mapping(),
            "effect": None if self.effect is None else self.effect.as_mapping(),
            "foldId": self.fold_id,
        }


@dataclass(frozen=True, slots=True)
class ComparisonReportV1:
    """Digest-bound §16 comparison report."""

    baseline_model_id: str
    challenger_model_id: str
    verdict: ComparisonVerdict
    plan_digest: DigestV1
    ledger_digest: DigestV1
    baseline_assessment: LeakageAssessmentV1
    challenger_assessment: LeakageAssessmentV1
    folds: tuple[FoldComparisonV1, ...]
    skipped_fold_count: int
    improved_fold_count: int
    worsened_fold_count: int
    tied_fold_count: int
    effect_interval: BootstrapIntervalV1 | None
    holdout_grant: HoldoutGrantV1 | None
    holdout_baseline: MetricValueV1 | None
    holdout_challenger: MetricValueV1 | None
    spec: ComparisonSpecV1

    def as_mapping(self) -> dict[str, object]:
        return {
            "baselineAssessment": self.baseline_assessment.as_mapping(),
            "baselineModelId": self.baseline_model_id,
            "challengerAssessment": self.challenger_assessment.as_mapping(),
            "challengerModelId": self.challenger_model_id,
            "effectInterval": (
                None if self.effect_interval is None else self.effect_interval.as_mapping()
            ),
            "folds": [fold.as_mapping() for fold in self.folds],
            "holdoutBaseline": (
                None if self.holdout_baseline is None else self.holdout_baseline.as_mapping()
            ),
            "holdoutChallenger": (
                None if self.holdout_challenger is None else self.holdout_challenger.as_mapping()
            ),
            "holdoutGrant": (
                None if self.holdout_grant is None else self.holdout_grant.as_mapping()
            ),
            "improvedFoldCount": self.improved_fold_count,
            "ledgerDigest": self.ledger_digest.hexdigest,
            "planDigest": self.plan_digest.hexdigest,
            "schema": "Q14ComparisonReportV1",
            "skippedFoldCount": self.skipped_fold_count,
            "spec": self.spec.as_mapping(),
            "tiedFoldCount": self.tied_fold_count,
            "verdict": self.verdict.value,
            "worsenedFoldCount": self.worsened_fold_count,
        }

    def digest(self) -> DigestV1:
        digest = hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        return DigestV1(hexdigest=digest)


def _effect(
    baseline: MetricValueV1,
    challenger: MetricValueV1,
    higher_is_better: bool,
) -> ExactRatioV1 | None:
    if (
        baseline.status is not MetricStatus.AVAILABLE
        or challenger.status is not MetricStatus.AVAILABLE
        or baseline.value is None
        or challenger.value is None
    ):
        return None
    delta = challenger.value.mantissa - baseline.value.mantissa
    if not higher_is_better:
        delta = -delta
    return make_ratio(delta, FIXED_POINT_SCALE)


def _has_verified_fold_fit_lineage(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    predictions: PredictionSetV1,
) -> bool:
    """Verify fold receipts against plan, samples, predictions, and aggregate lineage."""

    if predictions.lineage is None:
        return False
    valid_folds = tuple(fold for fold in plan.folds if fold.status is FoldStatus.VALID)
    if len(predictions.fold_fit_receipts) != len(valid_folds):
        return False
    receipt_digest = DigestV1(
        hexdigest=hashlib.sha256(
            canonical_json_bytes(
                [receipt.as_mapping() for receipt in predictions.fold_fit_receipts]
            )
        ).hexdigest()
    )
    if receipt_digest != predictions.lineage.fit_receipt_digest:
        return False
    receipts = {receipt.fold_id: receipt for receipt in predictions.fold_fit_receipts}
    prediction_by_id = {prediction.sample_id: prediction for prediction in predictions.predictions}
    for fold in valid_folds:
        receipt = receipts.get(fold.fold_id)
        if receipt is None:
            return False
        if (
            receipt.model_id != predictions.model_id
            or receipt.plan_digest != plan.digest()
            or receipt.train_sample_ids != fold.train_sample_ids
            or receipt.validation_sample_ids != fold.validation_sample_ids
            or receipt.validation_start_cutoff_ns != fold.validation_start_cutoff_ns
            or receipt.embargo_ns != plan.spec.embargo_ns
        ):
            return False
        try:
            training = subset_by_ids(samples, fold.train_sample_ids)
        except ContractValueError:
            return False
        if (
            receipt.training_dataset_digest != training.digest()
            or receipt.max_training_label_end_ns
            != max(sample.label_end_ns for sample in training.samples)
            or receipt.max_training_label_end_ns
            >= receipt.validation_start_cutoff_ns - receipt.embargo_ns
        ):
            return False
        validation_rows: list[dict[str, object]] = []
        for sample_id in fold.validation_sample_ids:
            prediction = prediction_by_id.get(sample_id)
            if prediction is None:
                return False
            validation_rows.append(prediction.as_mapping())
        prediction_digest = DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(validation_rows)).hexdigest()
        )
        if prediction_digest != receipt.prediction_digest:
            return False
    return True


def compare_models(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    baseline: PredictionSetV1,
    challenger: PredictionSetV1,
    ledger: TrialLedgerV1,
    spec: ComparisonSpecV1,
    *,
    holdout_grant: HoldoutGrantV1 | None = None,
) -> ComparisonReportV1:
    """Compare a challenger against a baseline under the declared comparison law."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(plan, WalkForwardPlanV1):
        raise ContractValueError("plan must be WalkForwardPlanV1")
    if not isinstance(ledger, TrialLedgerV1):
        raise ContractValueError("ledger must be TrialLedgerV1")
    if not isinstance(spec, ComparisonSpecV1):
        raise ContractValueError("spec must be ComparisonSpecV1")
    if plan.dataset_digest != samples.digest():
        raise ContractValueError("plan is bound to a different sample set")

    # Leakage is assessed strictly on research samples: holdout and quarantined
    # outcomes must not influence any pre-holdout decision, including this one.
    excluded = set(plan.holdout_sample_ids) | set(plan.quarantined_sample_ids)
    if excluded:
        research_ids = tuple(
            sample_id for sample_id in samples.sample_ids if sample_id not in excluded
        )
        research = subset_by_ids(samples, research_ids)
        research_baseline = restrict_predictions(baseline, research)
        research_challenger = restrict_predictions(challenger, research)
    else:
        research = samples
        research_baseline = baseline
        research_challenger = challenger
    baseline_assessment = assess_leakage(research, research_baseline, spec.leakage)
    challenger_assessment = assess_leakage(research, research_challenger, spec.leakage)

    def report(
        verdict: ComparisonVerdict,
        folds: tuple[FoldComparisonV1, ...] = (),
        skipped: int = 0,
        improved: int = 0,
        worsened: int = 0,
        tied: int = 0,
        interval: BootstrapIntervalV1 | None = None,
        holdout_baseline: MetricValueV1 | None = None,
        holdout_challenger: MetricValueV1 | None = None,
        grant: HoldoutGrantV1 | None = None,
    ) -> ComparisonReportV1:
        return ComparisonReportV1(
            baseline_model_id=baseline.model_id,
            challenger_model_id=challenger.model_id,
            verdict=verdict,
            plan_digest=plan.digest(),
            ledger_digest=ledger.digest(),
            baseline_assessment=baseline_assessment,
            challenger_assessment=challenger_assessment,
            folds=folds,
            skipped_fold_count=skipped,
            improved_fold_count=improved,
            worsened_fold_count=worsened,
            tied_fold_count=tied,
            effect_interval=interval,
            holdout_grant=grant,
            holdout_baseline=holdout_baseline,
            holdout_challenger=holdout_challenger,
            spec=spec,
        )

    if plan.status is not PlanStatus.VALID:
        return report(ComparisonVerdict.INVALID_PLAN)
    if challenger_assessment.verdict is not LeakageVerdict.ACCEPTED_FOR_COMPARISON:
        return report(ComparisonVerdict.REJECTED_CHALLENGER_LEAKAGE)
    if baseline_assessment.verdict is not LeakageVerdict.ACCEPTED_FOR_COMPARISON:
        return report(ComparisonVerdict.INVALID_BASELINE)
    if not _has_verified_fold_fit_lineage(samples, plan, baseline):
        return report(ComparisonVerdict.INVALID_BASELINE)
    if not _has_verified_fold_fit_lineage(samples, plan, challenger):
        return report(ComparisonVerdict.REJECTED_CHALLENGER_LINEAGE)

    folds: list[FoldComparisonV1] = []
    effects: list[ExactRatioV1] = []
    skipped = 0
    improved = 0
    worsened = 0
    tied = 0
    for fold in plan.folds:
        baseline_metric = evaluate_primary(
            spec.primary,
            research,
            research_baseline,
            restrict_ids=fold.validation_sample_ids,
        )
        challenger_metric = evaluate_primary(
            spec.primary,
            research,
            research_challenger,
            restrict_ids=fold.validation_sample_ids,
        )
        effect = _effect(baseline_metric, challenger_metric, spec.primary.higher_is_better)
        folds.append(
            FoldComparisonV1(
                fold_id=fold.fold_id,
                baseline=baseline_metric,
                challenger=challenger_metric,
                effect=effect,
            )
        )
        if effect is None:
            skipped += 1
        else:
            effects.append(effect)
            if effect.numerator > 0:
                improved += 1
            elif effect.numerator < 0:
                worsened += 1
            else:
                tied += 1

    if len(effects) < MIN_COMPARED_FOLDS:
        return report(
            ComparisonVerdict.INSUFFICIENT_FOLDS,
            folds=tuple(folds),
            skipped=skipped,
            improved=improved,
            worsened=worsened,
            tied=tied,
        )

    interval = block_bootstrap_interval(tuple(effects), spec.bootstrap)
    verdict = ComparisonVerdict.NO_EVIDENCE
    if interval.status is BootstrapStatus.AVAILABLE:
        lower = cast(FixedPointV1, interval.lower)
        upper = cast(FixedPointV1, interval.upper)
        if lower.mantissa > 0:
            verdict = ComparisonVerdict.IMPROVES
        elif upper.mantissa < 0:
            verdict = ComparisonVerdict.WORSE

    holdout_baseline: MetricValueV1 | None = None
    holdout_challenger: MetricValueV1 | None = None
    if holdout_grant is not None:
        holdout_samples = open_holdout(samples, plan, holdout_grant)
        holdout_ids = tuple(sample.sample_id for sample in holdout_samples)
        holdout_baseline = evaluate_primary(
            spec.primary, samples, baseline, restrict_ids=holdout_ids
        )
        holdout_challenger = evaluate_primary(
            spec.primary, samples, challenger, restrict_ids=holdout_ids
        )

    return report(
        verdict,
        folds=tuple(folds),
        skipped=skipped,
        improved=improved,
        worsened=worsened,
        tied=tied,
        interval=interval,
        holdout_baseline=holdout_baseline,
        holdout_challenger=holdout_challenger,
        grant=holdout_grant,
    )


def render_comparison_markdown(comparison: ComparisonReportV1) -> str:
    """Deterministic Markdown projection of a comparison report."""

    if not isinstance(comparison, ComparisonReportV1):
        raise ContractValueError("comparison must be ComparisonReportV1")
    lines = [
        "# Q14 comparison report",
        "",
        f"- Baseline: `{comparison.baseline_model_id}`",
        f"- Challenger: `{comparison.challenger_model_id}`",
        f"- Verdict: `{comparison.verdict.value}`",
        f"- Plan digest: `{comparison.plan_digest.hexdigest}`",
        f"- Trial ledger digest: `{comparison.ledger_digest.hexdigest}`",
        f"- Baseline leakage verdict: `{comparison.baseline_assessment.verdict.value}`",
        f"- Challenger leakage verdict: `{comparison.challenger_assessment.verdict.value}`",
        (f"- Folds compared/skipped: {len(comparison.folds)}/{comparison.skipped_fold_count}"),
        (
            f"- Improved/worsened/tied folds: {comparison.improved_fold_count}/"
            f"{comparison.worsened_fold_count}/{comparison.tied_fold_count}"
        ),
        f"- Holdout opened: {comparison.holdout_grant is not None}",
        f"- Report digest: `{comparison.digest().hexdigest}`",
        "",
    ]
    return "\n".join(lines)
