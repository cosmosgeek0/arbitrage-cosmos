"""§16.3 multiple-testing machinery: trial ledger, CSCV PBO and BH correction.

Every attempted trial is ledgered, including failed and abandoned ones — an automated
search counts as many trials, never one clever model. PBO follows the combinatorially
symmetric cross-validation construction with explicit validity gates and exact
rational output. Benjamini-Hochberg runs over supplied exact p-values only; this
module never invents a distribution.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from itertools import combinations
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1, round_half_even
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import (
    DigestV1,
    require_contract_id,
    require_reason_code,
    require_strict_int,
)

FIXED_SCALE: Final = 10**12
MAX_TRIALS: Final = 4_096
MAX_PBO_TRIALS: Final = 256
MIN_PBO_BLOCKS: Final = 4
MAX_PBO_BLOCKS: Final = 16
MAX_NOTE_LENGTH: Final = 200


class TrialStatus(StrEnum):
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    ABANDONED = "ABANDONED"


@dataclass(frozen=True, slots=True)
class TrialRecordV1:
    """One attempted trial; failure and abandonment are first-class outcomes."""

    trial_id: str
    family_id: str
    model_id: str
    metric_id: str
    status: TrialStatus
    note: str

    def __post_init__(self) -> None:
        require_contract_id(self.trial_id, field="trial_id")
        require_contract_id(self.family_id, field="family_id")
        require_contract_id(self.model_id, field="model_id")
        require_contract_id(self.metric_id, field="metric_id")
        if not isinstance(self.status, TrialStatus):
            raise ContractValueError("status must be a TrialStatus")
        if not isinstance(self.note, str) or len(self.note) > MAX_NOTE_LENGTH:
            raise ContractValueError("note must be a string of bounded length")

    def as_mapping(self) -> dict[str, object]:
        return {
            "familyId": self.family_id,
            "metricId": self.metric_id,
            "modelId": self.model_id,
            "note": self.note,
            "status": self.status.value,
            "trialId": self.trial_id,
        }


@dataclass(frozen=True, slots=True)
class TrialLedgerV1:
    """Sorted, digest-bound record of every attempted trial in a family."""

    trials: tuple[TrialRecordV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.trials, tuple) or not self.trials:
            raise ContractValueError("trials must be a non-empty tuple")
        if len(self.trials) > MAX_TRIALS:
            raise ContractValueError("trial count exceeds MAX_TRIALS")
        previous: str | None = None
        for trial in self.trials:
            if not isinstance(trial, TrialRecordV1):
                raise ContractValueError("trials must contain TrialRecordV1 entries")
            if previous is not None and trial.trial_id <= previous:
                raise ContractValueError("trials must be sorted by unique trial_id")
            previous = trial.trial_id

    @property
    def attempted_count(self) -> int:
        return len(self.trials)

    def count_by_status(self, status: TrialStatus) -> int:
        if not isinstance(status, TrialStatus):
            raise ContractValueError("status must be a TrialStatus")
        return sum(1 for trial in self.trials if trial.status is status)

    def as_mapping(self) -> dict[str, object]:
        return {
            "attemptedCount": self.attempted_count,
            "schema": "Q14TrialLedgerV1",
            "trials": [trial.as_mapping() for trial in self.trials],
        }

    def digest(self) -> DigestV1:
        digest = hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        return DigestV1(hexdigest=digest)


class PboStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    INVALID = "INVALID"


@dataclass(frozen=True, slots=True)
class PboReportV1:
    """CSCV probability of backtest overfitting with exact counts."""

    status: PboStatus
    reason: str | None
    trial_count: int
    block_count: int
    split_count: int
    underperform_count: int
    pbo: FixedPointV1 | None

    def __post_init__(self) -> None:
        if not isinstance(self.status, PboStatus):
            raise ContractValueError("status must be a PboStatus")
        if self.status is PboStatus.AVAILABLE:
            if not isinstance(self.pbo, FixedPointV1) or self.reason is not None:
                raise ContractValueError("available reports carry a pbo and no reason")
        else:
            if self.pbo is not None or self.reason is None:
                raise ContractValueError("invalid reports carry a reason and no pbo")
            require_reason_code(self.reason, field="reason")
        require_strict_int(self.trial_count, field="trial_count", minimum=0)
        require_strict_int(self.block_count, field="block_count", minimum=0)
        require_strict_int(self.split_count, field="split_count", minimum=0)
        require_strict_int(
            self.underperform_count,
            field="underperform_count",
            minimum=0,
            maximum=max(self.split_count, 0),
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "blockCount": self.block_count,
            "pbo": None if self.pbo is None else self.pbo.as_mapping(),
            "reason": self.reason,
            "splitCount": self.split_count,
            "status": self.status.value,
            "trialCount": self.trial_count,
            "underperformCount": self.underperform_count,
        }


def _pbo_invalid(reason: str, trials: int, blocks: int) -> PboReportV1:
    return PboReportV1(
        status=PboStatus.INVALID,
        reason=reason,
        trial_count=trials,
        block_count=blocks,
        split_count=0,
        underperform_count=0,
        pbo=None,
    )


def pbo_cscv(block_scores: tuple[tuple[ExactRatioV1, ...], ...]) -> PboReportV1:
    """CSCV PBO: fraction of symmetric splits where the in-sample champion's
    out-of-sample mean sits at or below the out-of-sample median (documented
    conservative tie law; in-sample ties resolve to the lowest trial index)."""

    if not isinstance(block_scores, tuple):
        raise ContractValueError("block_scores must be a tuple of per-trial tuples")
    trials = len(block_scores)
    if trials > MAX_PBO_TRIALS:
        raise ContractValueError("trial count exceeds MAX_PBO_TRIALS")
    blocks = len(block_scores[0]) if block_scores else 0
    for row in block_scores:
        if not isinstance(row, tuple) or len(row) != blocks:
            raise ContractValueError("every trial must score the same block tuple")
        if any(not isinstance(value, ExactRatioV1) for value in row):
            raise ContractValueError("block scores must be ExactRatioV1 entries")
    if trials < 2:
        return _pbo_invalid("FEWER_THAN_TWO_TRIALS", trials, blocks)
    if blocks < MIN_PBO_BLOCKS or blocks > MAX_PBO_BLOCKS:
        return _pbo_invalid("BLOCK_COUNT_OUT_OF_RANGE", trials, blocks)
    if blocks % 2 != 0:
        return _pbo_invalid("ODD_BLOCK_COUNT", trials, blocks)

    matrix = [
        [Fraction(value.numerator, value.denominator) for value in row] for row in block_scores
    ]
    half = blocks // 2
    split_count = 0
    underperform_count = 0
    for in_sample in combinations(range(blocks), half):
        split_count += 1
        out_sample = tuple(index for index in range(blocks) if index not in in_sample)
        is_means = [
            sum((matrix[trial][index] for index in in_sample), Fraction(0))
            for trial in range(trials)
        ]
        best_trial = 0
        for trial in range(1, trials):
            if is_means[trial] > is_means[best_trial]:
                best_trial = trial
        oos_means = [
            sum((matrix[trial][index] for index in out_sample), Fraction(0))
            for trial in range(trials)
        ]
        ordered = sorted(oos_means)
        median = (ordered[(trials - 1) // 2] + ordered[trials // 2]) / 2
        if oos_means[best_trial] <= median:
            underperform_count += 1

    pbo_value = FixedPointV1(round_half_even(underperform_count * FIXED_SCALE, split_count))
    return PboReportV1(
        status=PboStatus.AVAILABLE,
        reason=None,
        trial_count=trials,
        block_count=blocks,
        split_count=split_count,
        underperform_count=underperform_count,
        pbo=pbo_value,
    )


@dataclass(frozen=True, slots=True)
class BhReportV1:
    """Benjamini-Hochberg outcome over supplied exact p-values."""

    fdr_per_myriad: int
    tested_count: int
    rejected_trial_ids: tuple[str, ...]

    def as_mapping(self) -> dict[str, object]:
        return {
            "fdrPerMyriad": self.fdr_per_myriad,
            "rejectedTrialIds": list(self.rejected_trial_ids),
            "testedCount": self.tested_count,
        }


def benjamini_hochberg(
    p_values: tuple[tuple[str, ExactRatioV1], ...],
    *,
    fdr_per_myriad: int,
) -> BhReportV1:
    """Reject the largest prefix with p_(k) <= k * q / m under exact comparisons."""

    require_strict_int(fdr_per_myriad, field="fdr_per_myriad", minimum=1, maximum=9_999)
    if not isinstance(p_values, tuple) or not p_values or len(p_values) > MAX_TRIALS:
        raise ContractValueError("p_values must be a non-empty bounded tuple")
    seen: set[str] = set()
    entries: list[tuple[Fraction, str]] = []
    for entry in p_values:
        if not isinstance(entry, tuple) or len(entry) != 2:
            raise ContractValueError("each p-value entry must be (trial_id, ExactRatioV1)")
        trial_id, p_value = entry
        require_contract_id(trial_id, field="trial_id")
        if trial_id in seen:
            raise ContractValueError(f"duplicate trial id: {trial_id}")
        seen.add(trial_id)
        if not isinstance(p_value, ExactRatioV1):
            raise ContractValueError("p-values must be ExactRatioV1")
        fraction = Fraction(p_value.numerator, p_value.denominator)
        if fraction < 0 or fraction > 1:
            raise ContractValueError("p-values must lie in [0, 1]")
        entries.append((fraction, trial_id))
    entries.sort()
    total = len(entries)
    q = Fraction(fdr_per_myriad, 10_000)
    cut = 0
    for rank, (fraction, _) in enumerate(entries, start=1):
        if fraction <= Fraction(rank, total) * q:
            cut = rank
    rejected = tuple(sorted(trial_id for _, trial_id in entries[:cut]))
    return BhReportV1(
        fdr_per_myriad=fdr_per_myriad,
        tested_count=total,
        rejected_trial_ids=rejected,
    )


def distinct_trial_count(block_scores: tuple[tuple[ExactRatioV1, ...], ...]) -> int:
    """Bounded lower estimator of effective trials: exact-duplicate collapse.

    Correlated-but-not-identical trials still count separately; a spectral effective
    number needs eigenvalues that have no exact deterministic representation here, so
    that refinement is deferred to the model phases and recorded as a limitation.
    """

    if not isinstance(block_scores, tuple) or len(block_scores) > MAX_TRIALS:
        raise ContractValueError("block_scores must be a bounded tuple")
    seen_rows: set[tuple[tuple[int, int], ...]] = set()
    for row in block_scores:
        if not isinstance(row, tuple):
            raise ContractValueError("every trial row must be a tuple")
        if any(not isinstance(value, ExactRatioV1) for value in row):
            raise ContractValueError("block scores must be ExactRatioV1 entries")
        seen_rows.add(tuple((value.numerator, value.denominator) for value in row))
    return len(seen_rows)
