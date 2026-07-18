"""Deterministic top-k focus-budget ranking measurements.

This module measures a supplied ranking; it does not infer missing production labels,
latency, value, compute, or stream cost. Expected information gain is binary KL from a
declared prior to posterior, quantized once with an explicit Decimal context. Net value
uses a declared conservative haircut before subtracting supplied costs.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from enum import StrEnum
from fractions import Fraction
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import require_contract_id, require_strict_int

MAX_FOCUS_CANDIDATES: Final = 10_000


class MeasurementPosture(StrEnum):
    SYNTHETIC_RESEARCH = "SYNTHETIC_RESEARCH"
    PRODUCTION_OBSERVED = "PRODUCTION_OBSERVED"


class FocusBudgetStatus(StrEnum):
    AVAILABLE_RESEARCH_ONLY = "AVAILABLE_RESEARCH_ONLY"
    AVAILABLE_PRODUCTION_MEASURED = "AVAILABLE_PRODUCTION_MEASURED"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


@dataclass(frozen=True, slots=True)
class FocusCandidateV1:
    candidate_id: str
    rank_score: ExactRatioV1
    relevant: bool | None
    detection_time_ns: int | None
    event_time_ns: int | None
    prior_probability: ExactRatioV1 | None
    posterior_probability: ExactRatioV1 | None
    gross_value: ExactRatioV1 | None
    cost_value: ExactRatioV1 | None
    compute_ns: int | None
    stream_bytes: int | None

    def __post_init__(self) -> None:
        require_contract_id(self.candidate_id, field="candidate_id")
        _require_probability(self.rank_score, field="rank_score", closed=True)
        if self.relevant is not None and not isinstance(self.relevant, bool):
            raise ContractValueError("relevant must be bool or None")
        for field, integer_value in (
            ("detection_time_ns", self.detection_time_ns),
            ("event_time_ns", self.event_time_ns),
            ("compute_ns", self.compute_ns),
            ("stream_bytes", self.stream_bytes),
        ):
            if integer_value is not None:
                require_strict_int(integer_value, field=field, minimum=0)
        if (
            self.detection_time_ns is not None
            and self.event_time_ns is not None
            and self.event_time_ns < self.detection_time_ns
        ):
            raise ContractValueError("event_time_ns cannot precede detection_time_ns")
        for field, probability_value in (
            ("prior_probability", self.prior_probability),
            ("posterior_probability", self.posterior_probability),
        ):
            if probability_value is not None:
                _require_probability(probability_value, field=field, closed=False)
        if (self.prior_probability is None) != (self.posterior_probability is None):
            raise ContractValueError("prior and posterior probabilities must appear together")
        for field, ratio_value in (
            ("gross_value", self.gross_value),
            ("cost_value", self.cost_value),
        ):
            if ratio_value is not None and not isinstance(ratio_value, ExactRatioV1):
                raise ContractValueError(f"{field} must be ExactRatioV1 or None")
        if (self.gross_value is None) != (self.cost_value is None):
            raise ContractValueError("gross and cost values must appear together")


@dataclass(frozen=True, slots=True)
class FocusBudgetSpecV1:
    top_k: int
    conservative_haircut: ExactRatioV1
    max_compute_ns: int
    max_stream_bytes: int

    def __post_init__(self) -> None:
        require_strict_int(self.top_k, field="top_k", minimum=1, maximum=MAX_FOCUS_CANDIDATES)
        _require_probability(self.conservative_haircut, field="conservative_haircut", closed=True)
        require_strict_int(self.max_compute_ns, field="max_compute_ns", minimum=1)
        require_strict_int(self.max_stream_bytes, field="max_stream_bytes", minimum=1)


@dataclass(frozen=True, slots=True)
class FocusBudgetReportV1:
    posture: MeasurementPosture
    status: FocusBudgetStatus
    selected_ids: tuple[str, ...]
    precision_at_k: ExactRatioV1 | None
    recall_at_k: ExactRatioV1 | None
    mean_lead_time_ns: ExactRatioV1 | None
    mean_information_gain: FixedPointV1 | None
    conservative_net_value: ExactRatioV1 | None
    compute_ns: int | None
    stream_bytes: int | None
    within_budget: bool | None
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.posture, MeasurementPosture):
            raise ContractValueError("posture must be MeasurementPosture")
        if not isinstance(self.status, FocusBudgetStatus):
            raise ContractValueError("status must be FocusBudgetStatus")
        if self.selected_ids != tuple(sorted(set(self.selected_ids))):
            raise ContractValueError("selected_ids must be sorted and unique")
        if self.status is FocusBudgetStatus.DATA_INSUFFICIENT and not self.reasons:
            raise ContractValueError("data-insufficient reports must name reasons")
        if self.status is not FocusBudgetStatus.DATA_INSUFFICIENT and self.reasons:
            raise ContractValueError("available reports cannot carry insufficiency reasons")


def _require_probability(value: ExactRatioV1, *, field: str, closed: bool) -> None:
    if not isinstance(value, ExactRatioV1):
        raise ContractValueError(f"{field} must be ExactRatioV1")
    lower = value.numerator >= 0 if closed else value.numerator > 0
    upper = value.numerator <= value.denominator if closed else value.numerator < value.denominator
    if not lower or not upper:
        interval = "[0, 1]" if closed else "(0, 1)"
        raise ContractValueError(f"{field} must lie in {interval}")


def _fraction(value: ExactRatioV1) -> Fraction:
    return Fraction(value.numerator, value.denominator)


def _ratio(value: Fraction) -> ExactRatioV1:
    return make_ratio(value.numerator, value.denominator)


def _decimal_log(value: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        return value.ln()


def _information_gain(prior: ExactRatioV1, posterior: ExactRatioV1) -> Decimal:
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        p = Decimal(posterior.numerator) / Decimal(posterior.denominator)
        q = Decimal(prior.numerator) / Decimal(prior.denominator)
        return p * _decimal_log(p / q) + (Decimal(1) - p) * _decimal_log(
            (Decimal(1) - p) / (Decimal(1) - q)
        )


def _fixed(value: Decimal) -> FixedPointV1:
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        return FixedPointV1(int((value * Decimal(FIXED_POINT_SCALE)).to_integral_value()))


def _mean_information(values: list[Decimal]) -> FixedPointV1:
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        return _fixed(sum(values, start=Decimal(0)) / Decimal(len(values)))


def _sum_optional_ints(values: tuple[int | None, ...]) -> int | None:
    total = 0
    for value in values:
        if value is None:
            return None
        total += value
    return total


def focus_budget_report(
    candidates: tuple[FocusCandidateV1, ...],
    *,
    spec: FocusBudgetSpecV1,
    posture: MeasurementPosture,
) -> FocusBudgetReportV1:
    if (
        not isinstance(candidates, tuple)
        or not candidates
        or len(candidates) > MAX_FOCUS_CANDIDATES
    ):
        raise ContractValueError(
            f"candidates must be a non-empty tuple bounded at {MAX_FOCUS_CANDIDATES}"
        )
    if not isinstance(spec, FocusBudgetSpecV1):
        raise ContractValueError("spec must be FocusBudgetSpecV1")
    if not isinstance(posture, MeasurementPosture):
        raise ContractValueError("posture must be MeasurementPosture")
    if any(not isinstance(item, FocusCandidateV1) for item in candidates):
        raise ContractValueError("candidates must contain FocusCandidateV1")
    if len({item.candidate_id for item in candidates}) != len(candidates):
        raise ContractValueError("candidate identifiers must be unique")
    if spec.top_k > len(candidates):
        raise ContractValueError("top_k cannot exceed candidate count")
    ranked = sorted(
        candidates,
        key=lambda item: (-_fraction(item.rank_score), item.candidate_id),
    )
    selected = tuple(ranked[: spec.top_k])
    reasons: set[str] = set()

    labels_known = all(item.relevant is not None for item in candidates)
    precision: ExactRatioV1 | None = None
    recall: ExactRatioV1 | None = None
    if labels_known:
        relevant_total = sum(item.relevant is True for item in candidates)
        selected_relevant = sum(item.relevant is True for item in selected)
        precision = make_ratio(selected_relevant, len(selected))
        if relevant_total > 0:
            recall = make_ratio(selected_relevant, relevant_total)
        else:
            reasons.add("NO_RELEVANT_OUTCOMES")
    else:
        reasons.add("LABELS_MISSING")

    lead_times: list[int] = []
    for item in selected:
        if item.detection_time_ns is None or item.event_time_ns is None:
            reasons.add("LEAD_TIME_MISSING")
        else:
            lead_times.append(item.event_time_ns - item.detection_time_ns)
    mean_lead = (
        make_ratio(sum(lead_times), len(lead_times)) if len(lead_times) == len(selected) else None
    )

    information: list[Decimal] = []
    for item in selected:
        if item.prior_probability is None or item.posterior_probability is None:
            reasons.add("INFORMATION_GAIN_MISSING")
        else:
            information.append(
                _information_gain(item.prior_probability, item.posterior_probability)
            )
    mean_information = _mean_information(information) if len(information) == len(selected) else None

    net_values: list[Fraction] = []
    haircut = _fraction(spec.conservative_haircut)
    for item in selected:
        if item.gross_value is None or item.cost_value is None:
            reasons.add("NET_VALUE_MISSING")
        else:
            net_values.append(_fraction(item.gross_value) * haircut - _fraction(item.cost_value))
    net_value = (
        _ratio(sum(net_values, start=Fraction(0))) if len(net_values) == len(selected) else None
    )

    compute_values = tuple(item.compute_ns for item in selected)
    stream_values = tuple(item.stream_bytes for item in selected)
    compute = _sum_optional_ints(compute_values)
    stream = _sum_optional_ints(stream_values)
    if compute is None:
        reasons.add("COMPUTE_COST_MISSING")
    if stream is None:
        reasons.add("STREAM_COST_MISSING")
    within_budget = (
        None
        if compute is None or stream is None
        else compute <= spec.max_compute_ns and stream <= spec.max_stream_bytes
    )
    ordered_reasons = tuple(sorted(reasons))
    status = (
        FocusBudgetStatus.DATA_INSUFFICIENT
        if ordered_reasons
        else (
            FocusBudgetStatus.AVAILABLE_PRODUCTION_MEASURED
            if posture is MeasurementPosture.PRODUCTION_OBSERVED
            else FocusBudgetStatus.AVAILABLE_RESEARCH_ONLY
        )
    )
    return FocusBudgetReportV1(
        posture=posture,
        status=status,
        selected_ids=tuple(sorted(item.candidate_id for item in selected)),
        precision_at_k=precision,
        recall_at_k=recall,
        mean_lead_time_ns=mean_lead,
        mean_information_gain=mean_information,
        conservative_net_value=net_value,
        compute_ns=compute,
        stream_bytes=stream,
        within_budget=within_budget,
        reasons=ordered_reasons,
    )
