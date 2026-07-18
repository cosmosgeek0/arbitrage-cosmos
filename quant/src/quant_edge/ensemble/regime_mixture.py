"""Soft-regime specialist mixing with conservative unseen-regime protection.

The mixer is exact deterministic mechanics over supplied regime probabilities and
specialist probabilities. It does not fit specialists or claim calibration. Real
per-regime calibration remains ``BLOCKED_DATA`` while Q13 real-evidence sufficiency is
false. Missing/unsupported regime mass is either substituted with the declared fallback
inside a small bound or forces the whole assessment to fallback.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import require_contract_id, require_strict_int

MAX_REGIME_SPECIALISTS: Final = 32
PER_REGIME_CALIBRATION_STATUS: Final = "BLOCKED_DATA_Q13_REAL_EVIDENCE_INSUFFICIENT"


class RegimeMixtureStatus(StrEnum):
    MIXED_RESEARCH_ONLY = "MIXED_RESEARCH_ONLY"
    MIXED_WITH_UNSEEN_FALLBACK = "MIXED_WITH_UNSEEN_FALLBACK"
    FALLBACK_UNSEEN_REGIME = "FALLBACK_UNSEEN_REGIME"
    FALLBACK_DISAGREEMENT = "FALLBACK_DISAGREEMENT"


@dataclass(frozen=True, slots=True)
class RegimeWeightV1:
    regime_id: str
    probability: ExactRatioV1

    def __post_init__(self) -> None:
        require_contract_id(self.regime_id, field="regime_id")
        _require_probability(self.probability, field="probability")


@dataclass(frozen=True, slots=True)
class RegimeWeightsV1:
    weights: tuple[RegimeWeightV1, ...]

    def __post_init__(self) -> None:
        if (
            not isinstance(self.weights, tuple)
            or not 2 <= len(self.weights) <= MAX_REGIME_SPECIALISTS
        ):
            raise ContractValueError(f"weights must contain 2..{MAX_REGIME_SPECIALISTS} regimes")
        if any(not isinstance(item, RegimeWeightV1) for item in self.weights):
            raise ContractValueError("weights must contain RegimeWeightV1")
        regime_ids = tuple(item.regime_id for item in self.weights)
        if regime_ids != tuple(sorted(set(regime_ids))):
            raise ContractValueError("weights must be sorted and unique by regime_id")
        total = sum((_fraction(item.probability) for item in self.weights), start=Fraction(0))
        if total != 1:
            raise ContractValueError("regime probabilities must sum exactly to one")


@dataclass(frozen=True, slots=True)
class RegimeSpecialistV1:
    regime_id: str
    probability: ExactRatioV1
    training_support: int

    def __post_init__(self) -> None:
        require_contract_id(self.regime_id, field="regime_id")
        _require_probability(self.probability, field="probability")
        require_strict_int(self.training_support, field="training_support", minimum=0)


@dataclass(frozen=True, slots=True)
class RegimeMixtureSpecV1:
    fallback_probability: ExactRatioV1
    disagreement_threshold: ExactRatioV1
    max_unseen_mass: ExactRatioV1
    min_specialist_support: int

    def __post_init__(self) -> None:
        _require_probability(self.fallback_probability, field="fallback_probability")
        _require_probability(self.disagreement_threshold, field="disagreement_threshold")
        _require_probability(self.max_unseen_mass, field="max_unseen_mass")
        require_strict_int(self.min_specialist_support, field="min_specialist_support", minimum=1)


@dataclass(frozen=True, slots=True)
class RegimeMixtureAssessmentV1:
    status: RegimeMixtureStatus
    final_probability: ExactRatioV1
    raw_mixture_probability: ExactRatioV1 | None
    disagreement: ExactRatioV1 | None
    unseen_mass: ExactRatioV1
    substituted_regimes: tuple[str, ...]
    calibration_status: str
    reason: str | None

    def __post_init__(self) -> None:
        if not isinstance(self.status, RegimeMixtureStatus):
            raise ContractValueError("status must be RegimeMixtureStatus")
        _require_probability(self.final_probability, field="final_probability")
        if self.raw_mixture_probability is not None:
            _require_probability(self.raw_mixture_probability, field="raw_mixture_probability")
        if self.disagreement is not None:
            _require_probability(self.disagreement, field="disagreement")
        _require_probability(self.unseen_mass, field="unseen_mass")
        if self.substituted_regimes != tuple(sorted(set(self.substituted_regimes))):
            raise ContractValueError("substituted_regimes must be sorted and unique")
        if self.calibration_status != PER_REGIME_CALIBRATION_STATUS:
            raise ContractValueError("real per-regime calibration remains blocked by Q13")
        fallback = self.status in (
            RegimeMixtureStatus.FALLBACK_UNSEEN_REGIME,
            RegimeMixtureStatus.FALLBACK_DISAGREEMENT,
        )
        if fallback != (self.reason is not None):
            raise ContractValueError("full fallback assessments must name a reason")


def _require_probability(value: ExactRatioV1, *, field: str) -> None:
    if not isinstance(value, ExactRatioV1) or not 0 <= value.numerator <= value.denominator:
        raise ContractValueError(f"{field} must be an ExactRatioV1 in [0, 1]")


def _fraction(value: ExactRatioV1) -> Fraction:
    return Fraction(value.numerator, value.denominator)


def _ratio(value: Fraction) -> ExactRatioV1:
    return make_ratio(value.numerator, value.denominator)


def mix_regime_specialists(
    weights: RegimeWeightsV1,
    specialists: tuple[RegimeSpecialistV1, ...],
    *,
    spec: RegimeMixtureSpecV1,
) -> RegimeMixtureAssessmentV1:
    if not isinstance(weights, RegimeWeightsV1):
        raise ContractValueError("weights must be RegimeWeightsV1")
    if not isinstance(specialists, tuple) or len(specialists) > MAX_REGIME_SPECIALISTS:
        raise ContractValueError(f"specialists must be bounded at {MAX_REGIME_SPECIALISTS}")
    if any(not isinstance(item, RegimeSpecialistV1) for item in specialists):
        raise ContractValueError("specialists must contain RegimeSpecialistV1")
    if not isinstance(spec, RegimeMixtureSpecV1):
        raise ContractValueError("spec must be RegimeMixtureSpecV1")
    specialist_ids = tuple(item.regime_id for item in specialists)
    if specialist_ids != tuple(sorted(set(specialist_ids))):
        raise ContractValueError("specialists must be sorted and unique by regime_id")
    specialist_map = {item.regime_id: item for item in specialists}
    fallback = _fraction(spec.fallback_probability)
    unseen_mass = Fraction(0)
    substituted: list[str] = []
    effective: list[tuple[Fraction, Fraction]] = []
    for weight in weights.weights:
        mass = _fraction(weight.probability)
        specialist = specialist_map.get(weight.regime_id)
        if specialist is None or specialist.training_support < spec.min_specialist_support:
            unseen_mass += mass
            substituted.append(weight.regime_id)
            effective.append((mass, fallback))
        else:
            effective.append((mass, _fraction(specialist.probability)))
    if unseen_mass > _fraction(spec.max_unseen_mass):
        return RegimeMixtureAssessmentV1(
            RegimeMixtureStatus.FALLBACK_UNSEEN_REGIME,
            spec.fallback_probability,
            None,
            None,
            _ratio(unseen_mass),
            tuple(sorted(substituted)),
            PER_REGIME_CALIBRATION_STATUS,
            "UNSEEN_REGIME_MASS_EXCEEDS_BOUND",
        )
    mixture = sum((mass * prediction for mass, prediction in effective), start=Fraction(0))
    disagreement = sum(
        (mass * abs(prediction - mixture) for mass, prediction in effective), start=Fraction(0)
    )
    if disagreement > _fraction(spec.disagreement_threshold):
        return RegimeMixtureAssessmentV1(
            RegimeMixtureStatus.FALLBACK_DISAGREEMENT,
            spec.fallback_probability,
            _ratio(mixture),
            _ratio(disagreement),
            _ratio(unseen_mass),
            tuple(sorted(substituted)),
            PER_REGIME_CALIBRATION_STATUS,
            "SPECIALIST_DISAGREEMENT_EXCEEDS_BOUND",
        )
    return RegimeMixtureAssessmentV1(
        (
            RegimeMixtureStatus.MIXED_WITH_UNSEEN_FALLBACK
            if substituted
            else RegimeMixtureStatus.MIXED_RESEARCH_ONLY
        ),
        _ratio(mixture),
        _ratio(mixture),
        _ratio(disagreement),
        _ratio(unseen_mass),
        tuple(sorted(substituted)),
        PER_REGIME_CALIBRATION_STATUS,
        None,
    )
