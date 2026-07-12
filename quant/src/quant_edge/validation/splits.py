"""Purged, embargoed, grouped walk-forward splitting with an untouched holdout.

Implements the §16.1 splitting law: chronological folds, grouped event identity that
never straddles a train/validation boundary, purging of train samples whose label
interval overlaps the validation period, an embargo of at least the declared maximum
label horizon plus feature lookback (enforced as a contract, not a convention), and a
final chronological holdout that no fold can see and that is only reachable through an
explicit recorded grant.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int
from quant_edge.validation.samples import SampleSetV1, ValidationSampleV1

MAX_FOLDS = 64
MAX_EMBARGO_NS = 365 * 24 * 3_600 * 1_000_000_000


class SplitScheme(StrEnum):
    EXPANDING = "EXPANDING"
    ROLLING = "ROLLING"


class FoldStatus(StrEnum):
    VALID = "VALID"
    INVALID_INSUFFICIENT_TRAIN = "INVALID_INSUFFICIENT_TRAIN"


class PlanStatus(StrEnum):
    VALID = "VALID"
    INVALID_FOLD = "INVALID_FOLD"


@dataclass(frozen=True, slots=True)
class WalkForwardSpecV1:
    """Declared splitting law; the embargo floor is a contract, not advice."""

    scheme: SplitScheme
    fold_count: int
    max_label_horizon_ns: int
    max_feature_lookback_ns: int
    embargo_ns: int
    min_train_size: int
    holdout_fraction: ExactRatioV1
    rolling_train_size: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.scheme, SplitScheme):
            raise ContractValueError("scheme must be a SplitScheme")
        require_strict_int(self.fold_count, field="fold_count", minimum=1, maximum=MAX_FOLDS)
        require_strict_int(
            self.max_label_horizon_ns,
            field="max_label_horizon_ns",
            minimum=1,
            maximum=MAX_EMBARGO_NS,
        )
        require_strict_int(
            self.max_feature_lookback_ns,
            field="max_feature_lookback_ns",
            minimum=0,
            maximum=MAX_EMBARGO_NS,
        )
        require_strict_int(self.embargo_ns, field="embargo_ns", minimum=0, maximum=MAX_EMBARGO_NS)
        if self.embargo_ns < self.max_label_horizon_ns + self.max_feature_lookback_ns:
            raise ContractValueError(
                "embargo must be at least the declared label horizon plus feature lookback"
            )
        require_strict_int(self.min_train_size, field="min_train_size", minimum=1)
        if not isinstance(self.holdout_fraction, ExactRatioV1):
            raise ContractValueError("holdout_fraction must be ExactRatioV1")
        if self.holdout_fraction.is_negative or ratio_at_least_one(self.holdout_fraction):
            raise ContractValueError("holdout_fraction must lie in [0, 1)")
        if self.scheme is SplitScheme.ROLLING:
            if self.rolling_train_size is None:
                raise ContractValueError("rolling scheme requires rolling_train_size")
            require_strict_int(
                self.rolling_train_size,
                field="rolling_train_size",
                minimum=self.min_train_size,
            )
        elif self.rolling_train_size is not None:
            raise ContractValueError("expanding scheme forbids rolling_train_size")

    def as_mapping(self) -> dict[str, object]:
        return {
            "embargoNs": str(self.embargo_ns),
            "foldCount": self.fold_count,
            "holdoutFraction": self.holdout_fraction.as_mapping(),
            "maxFeatureLookbackNs": str(self.max_feature_lookback_ns),
            "maxLabelHorizonNs": str(self.max_label_horizon_ns),
            "minTrainSize": self.min_train_size,
            "rollingTrainSize": self.rolling_train_size,
            "scheme": self.scheme.value,
        }


def ratio_at_least_one(ratio: ExactRatioV1) -> bool:
    return ratio.numerator >= ratio.denominator


@dataclass(frozen=True, slots=True)
class FoldV1:
    """One chronological fold with per-reason exclusion accounting."""

    fold_id: str
    status: FoldStatus
    train_sample_ids: tuple[str, ...]
    validation_sample_ids: tuple[str, ...]
    validation_start_cutoff_ns: int
    validation_end_cutoff_ns: int
    group_conflict_count: int
    purged_count: int
    embargoed_count: int
    rolling_trimmed_count: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "embargoedCount": self.embargoed_count,
            "foldId": self.fold_id,
            "groupConflictCount": self.group_conflict_count,
            "purgedCount": self.purged_count,
            "rollingTrimmedCount": self.rolling_trimmed_count,
            "status": self.status.value,
            "trainSampleIds": list(self.train_sample_ids),
            "validationEndCutoffNs": str(self.validation_end_cutoff_ns),
            "validationSampleIds": list(self.validation_sample_ids),
            "validationStartCutoffNs": str(self.validation_start_cutoff_ns),
        }


@dataclass(frozen=True, slots=True)
class WalkForwardPlanV1:
    """Digest-bound split plan; holdout members appear in no fold."""

    spec: WalkForwardSpecV1
    dataset_digest: DigestV1
    folds: tuple[FoldV1, ...]
    holdout_sample_ids: tuple[str, ...]
    quarantined_sample_ids: tuple[str, ...]
    status: PlanStatus

    def as_mapping(self) -> dict[str, object]:
        return {
            "datasetDigest": self.dataset_digest.hexdigest,
            "folds": [fold.as_mapping() for fold in self.folds],
            "holdoutSampleIds": list(self.holdout_sample_ids),
            "quarantinedSampleIds": list(self.quarantined_sample_ids),
            "schema": "Q14WalkForwardPlanV1",
            "spec": self.spec.as_mapping(),
            "status": self.status.value,
        }

    def digest(self) -> DigestV1:
        digest = hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        return DigestV1(hexdigest=digest)


def build_walk_forward_plan(samples: SampleSetV1, spec: WalkForwardSpecV1) -> WalkForwardPlanV1:
    """Build the purged/embargoed grouped walk-forward plan over a sample set."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(spec, WalkForwardSpecV1):
        raise ContractValueError("spec must be WalkForwardSpecV1")
    for sample in samples.samples:
        if sample.label_horizon_ns > spec.max_label_horizon_ns:
            raise ContractValueError(
                f"sample {sample.sample_id} exceeds the declared maximum label horizon"
            )

    ordered = samples.samples
    total = len(ordered)
    holdout_count = (total * spec.holdout_fraction.numerator) // spec.holdout_fraction.denominator
    research_end = total - holdout_count
    holdout = ordered[research_end:]
    holdout_groups = {sample.group_id for sample in holdout}
    research: list[ValidationSampleV1] = []
    quarantined: list[str] = []
    for sample in ordered[:research_end]:
        if sample.group_id in holdout_groups:
            quarantined.append(sample.sample_id)
        else:
            research.append(sample)

    segment_count = spec.fold_count + 1
    if len(research) < segment_count:
        raise ContractValueError(
            "research range is smaller than fold_count + 1 chronological segments"
        )
    segments = _segment(research, segment_count)

    folds: list[FoldV1] = []
    for fold_index in range(1, segment_count):
        validation = segments[fold_index]
        candidates = [sample for segment in segments[:fold_index] for sample in segment]
        folds.append(_build_fold(fold_index, candidates, validation, spec))
    status = (
        PlanStatus.VALID
        if all(fold.status is FoldStatus.VALID for fold in folds)
        else PlanStatus.INVALID_FOLD
    )
    return WalkForwardPlanV1(
        spec=spec,
        dataset_digest=samples.digest(),
        folds=tuple(folds),
        holdout_sample_ids=tuple(sample.sample_id for sample in holdout),
        quarantined_sample_ids=tuple(quarantined),
        status=status,
    )


def _segment(
    research: list[ValidationSampleV1],
    segment_count: int,
) -> list[list[ValidationSampleV1]]:
    base, remainder = divmod(len(research), segment_count)
    segments: list[list[ValidationSampleV1]] = []
    start = 0
    for index in range(segment_count):
        size = base + (1 if index < remainder else 0)
        segments.append(research[start : start + size])
        start += size
    return segments


def _build_fold(
    fold_index: int,
    candidates: list[ValidationSampleV1],
    validation: list[ValidationSampleV1],
    spec: WalkForwardSpecV1,
) -> FoldV1:
    validation_groups = {sample.group_id for sample in validation}
    validation_start = validation[0].cutoff_ns
    validation_end = validation[-1].cutoff_ns
    train: list[ValidationSampleV1] = []
    group_conflicts = 0
    purged = 0
    embargoed = 0
    for sample in candidates:
        if sample.group_id in validation_groups:
            group_conflicts += 1
        elif sample.label_end_ns >= validation_start:
            purged += 1
        elif sample.label_end_ns >= validation_start - spec.embargo_ns:
            embargoed += 1
        else:
            train.append(sample)
    rolling_trimmed = 0
    window = spec.rolling_train_size
    if window is not None and len(train) > window:
        rolling_trimmed = len(train) - window
        train = train[-window:]
    status = (
        FoldStatus.VALID
        if len(train) >= spec.min_train_size
        else FoldStatus.INVALID_INSUFFICIENT_TRAIN
    )
    return FoldV1(
        fold_id=f"fold-{fold_index:02d}",
        status=status,
        train_sample_ids=tuple(sample.sample_id for sample in train),
        validation_sample_ids=tuple(sample.sample_id for sample in validation),
        validation_start_cutoff_ns=validation_start,
        validation_end_cutoff_ns=validation_end,
        group_conflict_count=group_conflicts,
        purged_count=purged,
        embargoed_count=embargoed,
        rolling_trimmed_count=rolling_trimmed,
    )


@dataclass(frozen=True, slots=True)
class HoldoutGrantV1:
    """Explicit, plan-bound permission to open the untouched holdout once."""

    grant_id: str
    reason: str
    plan_digest: DigestV1

    def __post_init__(self) -> None:
        require_contract_id(self.grant_id, field="grant_id")
        if not isinstance(self.reason, str) or not 1 <= len(self.reason) <= 400:
            raise ContractValueError("reason must be a non-empty string of at most 400 characters")
        if not isinstance(self.plan_digest, DigestV1):
            raise ContractValueError("plan_digest must be DigestV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "grantId": self.grant_id,
            "planDigest": self.plan_digest.hexdigest,
            "reason": self.reason,
        }


def open_holdout(
    samples: SampleSetV1,
    plan: WalkForwardPlanV1,
    grant: HoldoutGrantV1,
) -> tuple[ValidationSampleV1, ...]:
    """Materialize holdout samples only under a grant bound to this exact plan."""

    if not isinstance(samples, SampleSetV1):
        raise ContractValueError("samples must be SampleSetV1")
    if not isinstance(plan, WalkForwardPlanV1):
        raise ContractValueError("plan must be WalkForwardPlanV1")
    if not isinstance(grant, HoldoutGrantV1):
        raise ContractValueError("grant must be HoldoutGrantV1")
    if plan.dataset_digest != samples.digest():
        raise ContractValueError("plan is bound to a different sample set")
    if grant.plan_digest != plan.digest():
        raise ContractValueError("grant is bound to a different plan")
    if not plan.holdout_sample_ids:
        raise ContractValueError("plan has no holdout to open")
    holdout_ids = set(plan.holdout_sample_ids)
    return tuple(sample for sample in samples.samples if sample.sample_id in holdout_ids)
