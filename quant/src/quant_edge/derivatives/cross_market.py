"""Exact cross-sectional evidence and multiplicity-safe lead/lag challenger gates.

The mounted evidence supports same-venue Spot/perp lead-lag only. Cross-venue
leadership, lagged OFI, Granger and transfer-entropy capabilities therefore stay
``BLOCKED_DATA``. Statistical selection is deterministic and available for synthetic
research evidence, but does not manufacture production measurements.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import require_contract_id, require_strict_int

MAX_CROSS_SECTION_ASSETS: Final = 2_048
MAX_BETA_WINDOW: Final = 4_096
MAX_CHALLENGERS: Final = 64


class EvidenceStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    PARTIAL_RESEARCH_ONLY = "PARTIAL_RESEARCH_ONLY"
    UNKNOWN = "UNKNOWN"


class ChallengeStatus(StrEnum):
    SELECTED_RESEARCH_ONLY = "SELECTED_RESEARCH_ONLY"
    REJECTED_MULTIPLICITY = "REJECTED_MULTIPLICITY"
    REJECTED_UNSTABLE = "REJECTED_UNSTABLE"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"
    AVAILABLE_EXISTING_OWNER = "AVAILABLE_EXISTING_OWNER"
    BLOCKED_DATA = "BLOCKED_DATA"


@dataclass(frozen=True, slots=True)
class AssetReturnV1:
    asset_id: str
    sector_id: str
    cohort_id: str
    as_of_ns: int
    return_value: ExactRatioV1 | None

    def __post_init__(self) -> None:
        require_contract_id(self.asset_id, field="asset_id")
        require_contract_id(self.sector_id, field="sector_id")
        require_contract_id(self.cohort_id, field="cohort_id")
        require_strict_int(self.as_of_ns, field="as_of_ns", minimum=0)
        if self.return_value is not None and not isinstance(self.return_value, ExactRatioV1):
            raise ContractValueError("return_value must be ExactRatioV1 or None")


@dataclass(frozen=True, slots=True)
class AssetResidualV1:
    asset_id: str
    sector_id: str
    return_value: ExactRatioV1 | None
    market_residual: ExactRatioV1 | None
    sector_residual: ExactRatioV1 | None


@dataclass(frozen=True, slots=True)
class CrossSectionReportV1:
    cohort_id: str
    as_of_ns: int
    status: EvidenceStatus
    known_assets: int
    total_assets: int
    market_return: ExactRatioV1 | None
    sector_returns: tuple[tuple[str, ExactRatioV1], ...]
    advance_breadth: ExactRatioV1 | None
    residuals: tuple[AssetResidualV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.cohort_id, field="cohort_id")
        require_strict_int(self.as_of_ns, field="as_of_ns", minimum=0)
        if not isinstance(self.status, EvidenceStatus):
            raise ContractValueError("status must be EvidenceStatus")
        require_strict_int(self.known_assets, field="known_assets", minimum=0)
        require_strict_int(self.total_assets, field="total_assets", minimum=self.known_assets)
        if self.status is EvidenceStatus.AVAILABLE and self.known_assets != self.total_assets:
            raise ContractValueError("available cross sections require complete cohort evidence")
        if self.status is EvidenceStatus.PARTIAL_RESEARCH_ONLY and not (
            0 < self.known_assets < self.total_assets
        ):
            raise ContractValueError("partial cross sections require incomplete non-empty evidence")
        if self.status is EvidenceStatus.UNKNOWN and self.known_assets != 0:
            raise ContractValueError("unknown cross sections require zero known assets")
        if self.status is not EvidenceStatus.AVAILABLE and (
            self.market_return is not None
            or self.advance_breadth is not None
            or self.sector_returns
        ):
            raise ContractValueError("non-available cross sections expose no aggregate values")


@dataclass(frozen=True, slots=True)
class BetaEstimateV1:
    status: EvidenceStatus
    sample_count: int
    beta: ExactRatioV1 | None
    reason: str | None

    def __post_init__(self) -> None:
        if not isinstance(self.status, EvidenceStatus):
            raise ContractValueError("status must be EvidenceStatus")
        if self.status is EvidenceStatus.PARTIAL_RESEARCH_ONLY:
            raise ContractValueError("beta cannot use partial cross-section status")
        require_strict_int(self.sample_count, field="sample_count", minimum=0)
        if (self.status is EvidenceStatus.AVAILABLE) != (self.beta is not None):
            raise ContractValueError("beta exists exactly when evidence is available")
        if (self.status is EvidenceStatus.UNKNOWN) != (self.reason is not None):
            raise ContractValueError("unknown beta must name its reason")


@dataclass(frozen=True, slots=True)
class ChallengeCandidateV1:
    candidate_id: str
    p_value: ExactRatioV1
    first_half_sign: int
    second_half_sign: int
    sample_count: int

    def __post_init__(self) -> None:
        require_contract_id(self.candidate_id, field="candidate_id")
        if not isinstance(self.p_value, ExactRatioV1) or not (
            0 <= self.p_value.numerator <= self.p_value.denominator
        ):
            raise ContractValueError("p_value must lie in [0, 1]")
        if self.first_half_sign not in (-1, 0, 1) or self.second_half_sign not in (-1, 0, 1):
            raise ContractValueError("stability signs must be -1, 0, or 1")
        require_strict_int(self.sample_count, field="sample_count", minimum=0)


@dataclass(frozen=True, slots=True)
class ChallengeDecisionV1:
    candidate_id: str
    status: ChallengeStatus
    holm_threshold: ExactRatioV1 | None


@dataclass(frozen=True, slots=True)
class LeadLagCapabilityV1:
    capability_id: str
    status: ChallengeStatus
    reason: str

    def __post_init__(self) -> None:
        require_contract_id(self.capability_id, field="capability_id")
        if self.status not in (
            ChallengeStatus.AVAILABLE_EXISTING_OWNER,
            ChallengeStatus.BLOCKED_DATA,
        ):
            raise ContractValueError("capability status must describe mounted evidence")
        if not self.reason.strip():
            raise ContractValueError("capability reason must be non-empty")


def _ratio(value: Fraction) -> ExactRatioV1:
    return make_ratio(value.numerator, value.denominator)


def _known_fraction(value: ExactRatioV1 | None) -> Fraction:
    if value is None:
        raise AssertionError("known filter excludes missing returns")
    return Fraction(value.numerator, value.denominator)


def cross_sectional_report(returns: tuple[AssetReturnV1, ...]) -> CrossSectionReportV1:
    if not isinstance(returns, tuple) or not returns or len(returns) > MAX_CROSS_SECTION_ASSETS:
        raise ContractValueError(
            f"returns must be a non-empty tuple bounded at {MAX_CROSS_SECTION_ASSETS}"
        )
    for item in returns:
        if not isinstance(item, AssetReturnV1):
            raise ContractValueError("returns must contain AssetReturnV1")
    asset_ids = tuple(item.asset_id for item in returns)
    if asset_ids != tuple(sorted(set(asset_ids))):
        raise ContractValueError("returns must be sorted and unique by asset_id")
    cohorts = {(item.cohort_id, item.as_of_ns) for item in returns}
    if len(cohorts) != 1:
        raise ContractValueError("returns must share one cohort_id and as_of_ns")
    cohort_id, as_of_ns = next(iter(cohorts))
    known = tuple(item for item in returns if item.return_value is not None)
    if not known:
        return CrossSectionReportV1(
            cohort_id=cohort_id,
            as_of_ns=as_of_ns,
            status=EvidenceStatus.UNKNOWN,
            known_assets=0,
            total_assets=len(returns),
            market_return=None,
            sector_returns=(),
            advance_breadth=None,
            residuals=tuple(
                AssetResidualV1(item.asset_id, item.sector_id, None, None, None) for item in returns
            ),
        )
    if len(known) != len(returns):
        return CrossSectionReportV1(
            cohort_id=cohort_id,
            as_of_ns=as_of_ns,
            status=EvidenceStatus.PARTIAL_RESEARCH_ONLY,
            known_assets=len(known),
            total_assets=len(returns),
            market_return=None,
            sector_returns=(),
            advance_breadth=None,
            residuals=tuple(
                AssetResidualV1(item.asset_id, item.sector_id, item.return_value, None, None)
                for item in returns
            ),
        )
    market = sum(
        (_known_fraction(item.return_value) for item in known),
        start=Fraction(0),
    ) / len(known)
    sector_values: dict[str, list[Fraction]] = {}
    for item in known:
        value = item.return_value
        if value is None:
            raise AssertionError("known filter excludes missing returns")
        sector_values.setdefault(item.sector_id, []).append(
            Fraction(value.numerator, value.denominator)
        )
    sectors = tuple(
        (sector, _ratio(sum(values, start=Fraction(0)) / len(values)))
        for sector, values in sorted(sector_values.items())
    )
    sector_map = {sector: Fraction(value.numerator, value.denominator) for sector, value in sectors}
    residuals: list[AssetResidualV1] = []
    for item in returns:
        value = item.return_value
        if value is None:
            residuals.append(AssetResidualV1(item.asset_id, item.sector_id, None, None, None))
            continue
        observed = Fraction(value.numerator, value.denominator)
        residuals.append(
            AssetResidualV1(
                item.asset_id,
                item.sector_id,
                value,
                _ratio(observed - market),
                _ratio(observed - sector_map[item.sector_id]),
            )
        )
    advances = sum(
        item.return_value is not None and item.return_value.numerator > 0 for item in returns
    )
    return CrossSectionReportV1(
        cohort_id=cohort_id,
        as_of_ns=as_of_ns,
        status=EvidenceStatus.AVAILABLE,
        known_assets=len(known),
        total_assets=len(returns),
        market_return=_ratio(market),
        sector_returns=sectors,
        advance_breadth=make_ratio(advances, len(known)),
        residuals=tuple(residuals),
    )


def dynamic_beta(
    asset_returns: tuple[ExactRatioV1 | None, ...],
    factor_returns: tuple[ExactRatioV1 | None, ...],
    *,
    window: int,
) -> BetaEstimateV1:
    require_strict_int(window, field="window", minimum=2, maximum=MAX_BETA_WINDOW)
    if not isinstance(asset_returns, tuple) or not isinstance(factor_returns, tuple):
        raise ContractValueError("beta inputs must be tuples")
    if len(asset_returns) != len(factor_returns):
        raise ContractValueError("beta inputs must align")
    pairs = tuple(
        (asset, factor)
        for asset, factor in zip(asset_returns[-window:], factor_returns[-window:], strict=True)
        if asset is not None and factor is not None
    )
    if len(pairs) < 2:
        return BetaEstimateV1(EvidenceStatus.UNKNOWN, len(pairs), None, "DATA_INSUFFICIENT")
    asset_values = tuple(Fraction(item[0].numerator, item[0].denominator) for item in pairs)
    factor_values = tuple(Fraction(item[1].numerator, item[1].denominator) for item in pairs)
    asset_mean = sum(asset_values, start=Fraction(0)) / len(pairs)
    factor_mean = sum(factor_values, start=Fraction(0)) / len(pairs)
    covariance = sum(
        (
            (asset - asset_mean) * (factor - factor_mean)
            for asset, factor in zip(asset_values, factor_values, strict=True)
        ),
        start=Fraction(0),
    )
    variance = sum(((factor - factor_mean) ** 2 for factor in factor_values), start=Fraction(0))
    if variance == 0:
        return BetaEstimateV1(EvidenceStatus.UNKNOWN, len(pairs), None, "ZERO_FACTOR_VARIANCE")
    return BetaEstimateV1(EvidenceStatus.AVAILABLE, len(pairs), _ratio(covariance / variance), None)


def holm_stability_decisions(
    candidates: tuple[ChallengeCandidateV1, ...],
    *,
    family_alpha: ExactRatioV1,
    min_samples: int,
) -> tuple[ChallengeDecisionV1, ...]:
    if not isinstance(candidates, tuple) or not candidates or len(candidates) > MAX_CHALLENGERS:
        raise ContractValueError(
            f"candidates must be a non-empty tuple bounded at {MAX_CHALLENGERS}"
        )
    if not isinstance(family_alpha, ExactRatioV1) or not (
        0 < family_alpha.numerator < family_alpha.denominator
    ):
        raise ContractValueError("family_alpha must lie strictly inside (0, 1)")
    require_strict_int(min_samples, field="min_samples", minimum=2)
    if any(not isinstance(item, ChallengeCandidateV1) for item in candidates):
        raise ContractValueError("candidates must contain ChallengeCandidateV1")
    if len({item.candidate_id for item in candidates}) != len(candidates):
        raise ContractValueError("candidate identifiers must be unique")
    ordered = sorted(
        candidates,
        key=lambda item: (
            Fraction(item.p_value.numerator, item.p_value.denominator),
            item.candidate_id,
        ),
    )
    failed_multiplicity = False
    decisions: list[ChallengeDecisionV1] = []
    for index, candidate in enumerate(ordered):
        threshold = make_ratio(
            family_alpha.numerator,
            family_alpha.denominator * (len(ordered) - index),
        )
        multiplicity_rejected = failed_multiplicity or (
            candidate.p_value.numerator * threshold.denominator
            > threshold.numerator * candidate.p_value.denominator
        )
        failed_multiplicity = multiplicity_rejected
        if candidate.sample_count < min_samples:
            status = ChallengeStatus.DATA_INSUFFICIENT
        elif (
            candidate.first_half_sign == 0
            or candidate.first_half_sign != candidate.second_half_sign
        ):
            status = ChallengeStatus.REJECTED_UNSTABLE
        elif multiplicity_rejected:
            status = ChallengeStatus.REJECTED_MULTIPLICITY
        else:
            status = ChallengeStatus.SELECTED_RESEARCH_ONLY
        decisions.append(ChallengeDecisionV1(candidate.candidate_id, status, threshold))
    return tuple(sorted(decisions, key=lambda item: item.candidate_id))


def lead_lag_capabilities() -> tuple[LeadLagCapabilityV1, ...]:
    return (
        LeadLagCapabilityV1(
            "cross-venue-leadership",
            ChallengeStatus.BLOCKED_DATA,
            "no canonical cross-venue synchronized public evidence is mounted",
        ),
        LeadLagCapabilityV1(
            "granger-challenger",
            ChallengeStatus.BLOCKED_DATA,
            "no data-sufficient lagged cross-venue family exists for multiplicity-safe testing",
        ),
        LeadLagCapabilityV1(
            "lagged-ofi-transfer",
            ChallengeStatus.BLOCKED_DATA,
            "public snapshot deltas do not provide canonical event-level OFI transfer evidence",
        ),
        LeadLagCapabilityV1(
            "spot-perp-leadlag",
            ChallengeStatus.AVAILABLE_EXISTING_OWNER,
            "quant_edge.derivatives.leadlag owns same-pair Spot/perp evidence",
        ),
        LeadLagCapabilityV1(
            "transfer-entropy-challenger",
            ChallengeStatus.BLOCKED_DATA,
            "no canonical synchronized cross-venue symbol process is mounted",
        ),
    )
