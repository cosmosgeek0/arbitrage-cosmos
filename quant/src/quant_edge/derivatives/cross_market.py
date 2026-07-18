"""Bounded cross-sectional and cross-venue research evidence.

Cross-venue leadership is measured from injected public/research bars only. Source OFI
must be available before the target return interval, every lag is positive, train and
selection partitions are disjoint, model coefficients and discretization thresholds
are learned on training only, and every Granger-style or finite-sample transfer-entropy
attempt remains in Q14's exact Holm family. Missing, late, sparse, singular or
semantically incomparable evidence stays ``UNKNOWN``. Outputs grant no execution or
promotion authority.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from enum import StrEnum
from fractions import Fraction
from math import comb
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int
from quant_edge.validation.multiplicity import (
    HolmReportV1,
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    holm_bonferroni,
)

MAX_CROSS_SECTION_ASSETS: Final = 2_048
MAX_BETA_WINDOW: Final = 4_096
MAX_CROSS_MARKET_BARS: Final = 4_096
MAX_CROSS_MARKET_LAG: Final = 4
MAX_CROSS_MARKET_TRIALS: Final = 16
MAX_CROSS_MARKET_RATIO_BITS: Final = 128
MIN_TRANSFER_PAIRS: Final = 8
MIN_GRANGER_TRAIN: Final = 12
MIN_GRANGER_SELECTION: Final = 8
MIN_TE_TRAIN: Final = 16
MIN_TE_BLOCKS: Final = 4
TE_BLOCK_SIZE: Final = 8
MAX_TE_BLOCKS: Final = 16
CROSS_MARKET_ALGORITHM_REVISION: Final = "q076-cross-market-research-v2"


class EvidenceStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    PARTIAL_RESEARCH_ONLY = "PARTIAL_RESEARCH_ONLY"
    UNKNOWN = "UNKNOWN"


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


def _ratio(value: Fraction) -> ExactRatioV1:
    return make_ratio(value.numerator, value.denominator)


def _fraction(value: ExactRatioV1) -> Fraction:
    return Fraction(value.numerator, value.denominator)


def _known_fraction(value: ExactRatioV1 | None) -> Fraction:
    if value is None:
        raise AssertionError("known filter excludes missing returns")
    return _fraction(value)


def cross_sectional_report(returns: tuple[AssetReturnV1, ...]) -> CrossSectionReportV1:
    if not isinstance(returns, tuple) or not returns or len(returns) > MAX_CROSS_SECTION_ASSETS:
        raise ContractValueError(
            f"returns must be a non-empty tuple bounded at {MAX_CROSS_SECTION_ASSETS}"
        )
    if any(not isinstance(item, AssetReturnV1) for item in returns):
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
            cohort_id,
            as_of_ns,
            EvidenceStatus.UNKNOWN,
            0,
            len(returns),
            None,
            (),
            None,
            tuple(
                AssetResidualV1(item.asset_id, item.sector_id, None, None, None) for item in returns
            ),
        )
    if len(known) != len(returns):
        return CrossSectionReportV1(
            cohort_id,
            as_of_ns,
            EvidenceStatus.PARTIAL_RESEARCH_ONLY,
            len(known),
            len(returns),
            None,
            (),
            None,
            tuple(
                AssetResidualV1(item.asset_id, item.sector_id, item.return_value, None, None)
                for item in returns
            ),
        )
    market = sum((_known_fraction(item.return_value) for item in known), Fraction(0)) / len(known)
    sector_values: dict[str, list[Fraction]] = {}
    for item in known:
        sector_values.setdefault(item.sector_id, []).append(_known_fraction(item.return_value))
    sectors = tuple(
        (sector, _ratio(sum(values, Fraction(0)) / len(values)))
        for sector, values in sorted(sector_values.items())
    )
    sector_map = {sector: _fraction(value) for sector, value in sectors}
    residuals = tuple(
        AssetResidualV1(
            item.asset_id,
            item.sector_id,
            item.return_value,
            _ratio(_known_fraction(item.return_value) - market),
            _ratio(_known_fraction(item.return_value) - sector_map[item.sector_id]),
        )
        for item in returns
    )
    advances = sum(
        item.return_value is not None and item.return_value.numerator > 0 for item in returns
    )
    return CrossSectionReportV1(
        cohort_id,
        as_of_ns,
        EvidenceStatus.AVAILABLE,
        len(known),
        len(returns),
        _ratio(market),
        sectors,
        make_ratio(advances, len(known)),
        residuals,
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
    asset_values = tuple(_known_fraction(item[0]) for item in pairs)
    factor_values = tuple(_known_fraction(item[1]) for item in pairs)
    asset_mean = sum(asset_values, Fraction(0)) / len(pairs)
    factor_mean = sum(factor_values, Fraction(0)) / len(pairs)
    covariance = sum(
        (
            (asset - asset_mean) * (factor - factor_mean)
            for asset, factor in zip(asset_values, factor_values, strict=True)
        ),
        Fraction(0),
    )
    variance = sum(((factor - factor_mean) ** 2 for factor in factor_values), Fraction(0))
    if variance == 0:
        return BetaEstimateV1(EvidenceStatus.UNKNOWN, len(pairs), None, "ZERO_FACTOR_VARIANCE")
    return BetaEstimateV1(EvidenceStatus.AVAILABLE, len(pairs), _ratio(covariance / variance), None)


class CrossMarketPosture(StrEnum):
    PUBLIC_REPLAY_RESEARCH_ONLY = "PUBLIC_REPLAY_RESEARCH_ONLY"
    SYNTHETIC_RESEARCH_ONLY = "SYNTHETIC_RESEARCH_ONLY"


class TimestampSemantics(StrEnum):
    CANONICAL_AVAILABILITY_TIME = "CANONICAL_AVAILABILITY_TIME"


class ResearchStatus(StrEnum):
    AVAILABLE_RESEARCH_ONLY = "AVAILABLE_RESEARCH_ONLY"
    UNKNOWN = "UNKNOWN"


class CrossVenueDirection(StrEnum):
    A_TO_B = "A_TO_B"
    B_TO_A = "B_TO_A"


class LeadershipVerdict(StrEnum):
    A_LEADS_RESEARCH_ONLY = "A_LEADS_RESEARCH_ONLY"
    B_LEADS_RESEARCH_ONLY = "B_LEADS_RESEARCH_ONLY"
    BIDIRECTIONAL = "BIDIRECTIONAL"
    METHOD_CONFLICT = "METHOD_CONFLICT"
    NO_STABLE_LEAD = "NO_STABLE_LEAD"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class CrossMarketBarV1:
    bar_index: int
    start_ns: int
    end_ns: int
    available_ns: int
    ofi: ExactRatioV1 | None
    return_value: ExactRatioV1 | None

    def __post_init__(self) -> None:
        require_strict_int(self.bar_index, field="bar_index", minimum=0)
        require_strict_int(self.start_ns, field="start_ns", minimum=0)
        require_strict_int(self.end_ns, field="end_ns", minimum=self.start_ns + 1)
        require_strict_int(self.available_ns, field="available_ns", minimum=self.end_ns)
        for field in ("ofi", "return_value"):
            value = getattr(self, field)
            if value is not None and not isinstance(value, ExactRatioV1):
                raise ContractValueError(f"{field} must be ExactRatioV1 or None")
            if (
                value is not None
                and max(abs(value.numerator).bit_length(), value.denominator.bit_length())
                > MAX_CROSS_MARKET_RATIO_BITS
            ):
                raise ContractValueError(
                    f"{field} integer width must be bounded at {MAX_CROSS_MARKET_RATIO_BITS} bits"
                )


@dataclass(frozen=True, slots=True)
class VenueResearchSeriesV1:
    venue_id: str
    instrument_id: str
    base_asset_id: str
    quote_asset_id: str
    product_id: str
    ofi_feature_id: str
    return_feature_id: str
    source_id: str
    source_revision: str
    source_sha256: DigestV1
    posture: CrossMarketPosture
    timestamp_semantics: TimestampSemantics
    bar_width_ns: int
    max_clock_uncertainty_ns: int
    bars: tuple[CrossMarketBarV1, ...]

    def __post_init__(self) -> None:
        for field in (
            "venue_id",
            "instrument_id",
            "base_asset_id",
            "quote_asset_id",
            "product_id",
            "ofi_feature_id",
            "return_feature_id",
            "source_id",
            "source_revision",
        ):
            require_contract_id(getattr(self, field), field=field)
        if self.ofi_feature_id != "ofi_l1:v1":
            raise ContractValueError("cross-market OFI must come from canonical ofi_l1:v1")
        if not isinstance(self.source_sha256, DigestV1):
            raise ContractValueError("source_sha256 must be DigestV1")
        if not isinstance(self.posture, CrossMarketPosture):
            raise ContractValueError("posture must be CrossMarketPosture")
        if not isinstance(self.timestamp_semantics, TimestampSemantics):
            raise ContractValueError("timestamp_semantics must be canonical availability time")
        require_strict_int(self.bar_width_ns, field="bar_width_ns", minimum=1)
        require_strict_int(
            self.max_clock_uncertainty_ns,
            field="max_clock_uncertainty_ns",
            minimum=0,
            maximum=self.bar_width_ns * MAX_CROSS_MARKET_LAG,
        )
        if (
            not isinstance(self.bars, tuple)
            or not self.bars
            or len(self.bars) > MAX_CROSS_MARKET_BARS
        ):
            raise ContractValueError(
                f"bars must be a non-empty tuple bounded at {MAX_CROSS_MARKET_BARS}"
            )
        first_index = self.bars[0].bar_index
        for offset, bar in enumerate(self.bars):
            if not isinstance(bar, CrossMarketBarV1):
                raise ContractValueError("bars must contain CrossMarketBarV1")
            if bar.bar_index != first_index + offset:
                raise ContractValueError("bars must form one gap-free index segment")
            if bar.end_ns - bar.start_ns != self.bar_width_ns:
                raise ContractValueError("every bar must have the declared width")
            if offset and bar.start_ns != self.bars[offset - 1].end_ns:
                raise ContractValueError("bars must form one gap-free wall-clock grid")


@dataclass(frozen=True, slots=True)
class CrossMarketPartitionV1:
    train_end: int
    selection_start: int
    selection_end: int

    def __post_init__(self) -> None:
        require_strict_int(self.train_end, field="train_end", minimum=1)
        require_strict_int(self.selection_start, field="selection_start", minimum=self.train_end)
        require_strict_int(
            self.selection_end, field="selection_end", minimum=self.selection_start + 1
        )
        if self.selection_end > MAX_CROSS_MARKET_BARS:
            raise ContractValueError("selection_end exceeds the cross-market bar cap")


@dataclass(frozen=True, slots=True)
class CrossMarketSpecV1:
    max_lag: int = MAX_CROSS_MARKET_LAG
    familywise_alpha_per_myriad: int = 500

    def __post_init__(self) -> None:
        require_strict_int(self.max_lag, field="max_lag", minimum=1, maximum=MAX_CROSS_MARKET_LAG)
        require_strict_int(
            self.familywise_alpha_per_myriad,
            field="familywise_alpha_per_myriad",
            minimum=1,
            maximum=9_999,
        )


def _ratio_identity(value: ExactRatioV1 | None) -> dict[str, str] | None:
    if value is None:
        return None
    return {"denominator": str(value.denominator), "numerator": str(value.numerator)}


def _bar_identity(bar: CrossMarketBarV1) -> dict[str, object]:
    return {
        "availableNs": str(bar.available_ns),
        "barIndex": bar.bar_index,
        "endNs": str(bar.end_ns),
        "ofi": _ratio_identity(bar.ofi),
        "returnValue": _ratio_identity(bar.return_value),
        "startNs": str(bar.start_ns),
    }


@dataclass(frozen=True, slots=True)
class VenueResearchProvenanceV1:
    venue_id: str
    instrument_id: str
    base_asset_id: str
    quote_asset_id: str
    product_id: str
    ofi_feature_id: str
    return_feature_id: str
    source_id: str
    source_revision: str
    source_sha256: DigestV1
    posture: CrossMarketPosture
    timestamp_semantics: TimestampSemantics
    bar_width_ns: int
    max_clock_uncertainty_ns: int
    first_bar_index: int
    last_bar_index: int
    window_start_ns: int
    window_end_ns: int
    bar_count: int
    series_sha256: DigestV1

    def __post_init__(self) -> None:
        for field in (
            "venue_id",
            "instrument_id",
            "base_asset_id",
            "quote_asset_id",
            "product_id",
            "ofi_feature_id",
            "return_feature_id",
            "source_id",
            "source_revision",
        ):
            require_contract_id(getattr(self, field), field=field)
        if not isinstance(self.source_sha256, DigestV1) or not isinstance(
            self.series_sha256, DigestV1
        ):
            raise ContractValueError("provenance digests must be DigestV1")
        if not isinstance(self.posture, CrossMarketPosture):
            raise ContractValueError("provenance posture must be CrossMarketPosture")
        if not isinstance(self.timestamp_semantics, TimestampSemantics):
            raise ContractValueError("provenance timestamp semantics must be canonical")
        require_strict_int(self.bar_width_ns, field="bar_width_ns", minimum=1)
        require_strict_int(
            self.max_clock_uncertainty_ns,
            field="max_clock_uncertainty_ns",
            minimum=0,
            maximum=self.bar_width_ns * MAX_CROSS_MARKET_LAG,
        )
        require_strict_int(self.first_bar_index, field="first_bar_index", minimum=0)
        require_strict_int(
            self.last_bar_index, field="last_bar_index", minimum=self.first_bar_index
        )
        require_strict_int(self.window_start_ns, field="window_start_ns", minimum=0)
        require_strict_int(
            self.window_end_ns, field="window_end_ns", minimum=self.window_start_ns + 1
        )
        require_strict_int(
            self.bar_count, field="bar_count", minimum=1, maximum=MAX_CROSS_MARKET_BARS
        )
        if self.last_bar_index - self.first_bar_index + 1 != self.bar_count:
            raise ContractValueError("provenance bar indexes must match bar_count")

    def as_mapping(self) -> dict[str, object]:
        return {
            "barCount": self.bar_count,
            "barWidthNs": str(self.bar_width_ns),
            "baseAssetId": self.base_asset_id,
            "firstBarIndex": self.first_bar_index,
            "instrumentId": self.instrument_id,
            "lastBarIndex": self.last_bar_index,
            "maxClockUncertaintyNs": str(self.max_clock_uncertainty_ns),
            "ofiFeatureId": self.ofi_feature_id,
            "posture": self.posture.value,
            "productId": self.product_id,
            "quoteAssetId": self.quote_asset_id,
            "returnFeatureId": self.return_feature_id,
            "seriesSha256": self.series_sha256.hexdigest,
            "sourceId": self.source_id,
            "sourceRevision": self.source_revision,
            "sourceSha256": self.source_sha256.hexdigest,
            "timestampSemantics": self.timestamp_semantics.value,
            "venueId": self.venue_id,
            "windowEndNs": str(self.window_end_ns),
            "windowStartNs": str(self.window_start_ns),
        }


def _series_provenance(series: VenueResearchSeriesV1) -> VenueResearchProvenanceV1:
    identity = {
        "bars": [_bar_identity(bar) for bar in series.bars],
        "barWidthNs": str(series.bar_width_ns),
        "baseAssetId": series.base_asset_id,
        "instrumentId": series.instrument_id,
        "maxClockUncertaintyNs": str(series.max_clock_uncertainty_ns),
        "ofiFeatureId": series.ofi_feature_id,
        "posture": series.posture.value,
        "productId": series.product_id,
        "quoteAssetId": series.quote_asset_id,
        "returnFeatureId": series.return_feature_id,
        "schema": "Q076VenueResearchSeriesIdentityV1",
        "sourceId": series.source_id,
        "sourceRevision": series.source_revision,
        "sourceSha256": series.source_sha256.hexdigest,
        "timestampSemantics": series.timestamp_semantics.value,
        "venueId": series.venue_id,
        "version": 1,
    }
    first = series.bars[0]
    last = series.bars[-1]
    return VenueResearchProvenanceV1(
        venue_id=series.venue_id,
        instrument_id=series.instrument_id,
        base_asset_id=series.base_asset_id,
        quote_asset_id=series.quote_asset_id,
        product_id=series.product_id,
        ofi_feature_id=series.ofi_feature_id,
        return_feature_id=series.return_feature_id,
        source_id=series.source_id,
        source_revision=series.source_revision,
        source_sha256=series.source_sha256,
        posture=series.posture,
        timestamp_semantics=series.timestamp_semantics,
        bar_width_ns=series.bar_width_ns,
        max_clock_uncertainty_ns=series.max_clock_uncertainty_ns,
        first_bar_index=first.bar_index,
        last_bar_index=last.bar_index,
        window_start_ns=first.start_ns,
        window_end_ns=last.end_ns,
        bar_count=len(series.bars),
        series_sha256=DigestV1(hashlib.sha256(canonical_json_bytes(identity)).hexdigest()),
    )


def _provenance_core_mapping(
    series_a: VenueResearchProvenanceV1,
    series_b: VenueResearchProvenanceV1,
    partition: CrossMarketPartitionV1,
    spec: CrossMarketSpecV1,
) -> dict[str, object]:
    return {
        "algorithmRevision": CROSS_MARKET_ALGORITHM_REVISION,
        "partition": {
            "selectionEnd": partition.selection_end,
            "selectionStart": partition.selection_start,
            "trainEnd": partition.train_end,
        },
        "schema": "Q076CrossMarketProvenanceV1",
        "seriesA": series_a.as_mapping(),
        "seriesB": series_b.as_mapping(),
        "spec": {
            "familywiseAlphaPerMyriad": spec.familywise_alpha_per_myriad,
            "maxLag": spec.max_lag,
        },
        "version": 1,
    }


@dataclass(frozen=True, slots=True)
class CrossMarketProvenanceV1:
    series_a: VenueResearchProvenanceV1
    series_b: VenueResearchProvenanceV1
    partition: CrossMarketPartitionV1
    spec: CrossMarketSpecV1
    input_sha256: DigestV1

    def __post_init__(self) -> None:
        if not isinstance(self.series_a, VenueResearchProvenanceV1) or not isinstance(
            self.series_b, VenueResearchProvenanceV1
        ):
            raise ContractValueError("report provenance requires both venue series")
        if not isinstance(self.partition, CrossMarketPartitionV1):
            raise ContractValueError("report provenance requires CrossMarketPartitionV1")
        if not isinstance(self.spec, CrossMarketSpecV1):
            raise ContractValueError("report provenance requires CrossMarketSpecV1")
        if not isinstance(self.input_sha256, DigestV1):
            raise ContractValueError("input_sha256 must be DigestV1")
        expected = DigestV1(
            hashlib.sha256(canonical_json_bytes(self.core_mapping())).hexdigest()
        )
        if self.input_sha256 != expected:
            raise ContractValueError("input_sha256 must bind both series, partition, and spec")

    def core_mapping(self) -> dict[str, object]:
        return _provenance_core_mapping(self.series_a, self.series_b, self.partition, self.spec)

    def as_mapping(self) -> dict[str, object]:
        return {**self.core_mapping(), "inputSha256": self.input_sha256.hexdigest}


def _cross_market_provenance(
    series_a: VenueResearchSeriesV1,
    series_b: VenueResearchSeriesV1,
    partition: CrossMarketPartitionV1,
    spec: CrossMarketSpecV1,
) -> CrossMarketProvenanceV1:
    provenance_a = _series_provenance(series_a)
    provenance_b = _series_provenance(series_b)
    digest = DigestV1(
        hashlib.sha256(
            canonical_json_bytes(
                _provenance_core_mapping(provenance_a, provenance_b, partition, spec)
            )
        ).hexdigest()
    )
    return CrossMarketProvenanceV1(provenance_a, provenance_b, partition, spec, digest)


@dataclass(frozen=True, slots=True)
class LaggedOfiTransferV1:
    direction: CrossVenueDirection
    lag_bars: int
    status: ResearchStatus
    reason: str | None
    train_count: int
    selection_count: int
    train_slope: ExactRatioV1 | None
    selection_slope: ExactRatioV1 | None
    first_half_slope: ExactRatioV1 | None
    second_half_slope: ExactRatioV1 | None
    stable_sign: int

    def __post_init__(self) -> None:
        if not isinstance(self.direction, CrossVenueDirection):
            raise ContractValueError("direction must be CrossVenueDirection")
        require_strict_int(self.lag_bars, field="lag_bars", minimum=1, maximum=MAX_CROSS_MARKET_LAG)
        if not isinstance(self.status, ResearchStatus):
            raise ContractValueError("status must be ResearchStatus")
        require_strict_int(self.train_count, field="train_count", minimum=0)
        require_strict_int(self.selection_count, field="selection_count", minimum=0)
        if self.stable_sign not in (-1, 0, 1):
            raise ContractValueError("stable_sign must be -1, 0, or 1")
        slopes = (
            self.train_slope,
            self.selection_slope,
            self.first_half_slope,
            self.second_half_slope,
        )
        available = self.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY
        if available != all(isinstance(value, ExactRatioV1) for value in slopes):
            raise ContractValueError("transfer slopes exist exactly when evidence is available")
        if available != (self.reason is None):
            raise ContractValueError("transfer reason exists exactly when evidence is unknown")


@dataclass(frozen=True, slots=True)
class GrangerChallengerV1:
    trial_id: str
    direction: CrossVenueDirection
    lag_bars: int
    status: ResearchStatus
    reason: str | None
    train_count: int
    selection_count: int
    restricted_sse: ExactRatioV1 | None
    unrestricted_sse: ExactRatioV1 | None
    raw_p_value: ExactRatioV1 | None
    selected: bool = False

    def __post_init__(self) -> None:
        require_contract_id(self.trial_id, field="trial_id")
        if not isinstance(self.direction, CrossVenueDirection):
            raise ContractValueError("direction must be CrossVenueDirection")
        require_strict_int(self.lag_bars, field="lag_bars", minimum=1, maximum=MAX_CROSS_MARKET_LAG)
        require_strict_int(self.train_count, field="train_count", minimum=0)
        require_strict_int(self.selection_count, field="selection_count", minimum=0)
        available = self.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY
        values = (self.restricted_sse, self.unrestricted_sse, self.raw_p_value)
        if available != all(isinstance(value, ExactRatioV1) for value in values):
            raise ContractValueError("Granger values exist exactly when evidence is available")
        if available != (self.reason is None):
            raise ContractValueError("Granger reason exists exactly when evidence is unknown")
        if self.selected and not available:
            raise ContractValueError("unknown Granger trials cannot be selected")


@dataclass(frozen=True, slots=True)
class TransferEntropyChallengerV1:
    trial_id: str
    direction: CrossVenueDirection
    lag_bars: int
    status: ResearchStatus
    reason: str | None
    train_count: int
    selection_count: int
    source_threshold: ExactRatioV1 | None
    target_threshold: ExactRatioV1 | None
    raw_transfer_entropy: FixedPointV1 | None
    finite_sample_bias: FixedPointV1 | None
    corrected_transfer_entropy: FixedPointV1 | None
    raw_p_value: ExactRatioV1 | None
    selected: bool = False

    def __post_init__(self) -> None:
        require_contract_id(self.trial_id, field="trial_id")
        if not isinstance(self.direction, CrossVenueDirection):
            raise ContractValueError("direction must be CrossVenueDirection")
        require_strict_int(self.lag_bars, field="lag_bars", minimum=1, maximum=MAX_CROSS_MARKET_LAG)
        require_strict_int(self.train_count, field="train_count", minimum=0)
        require_strict_int(self.selection_count, field="selection_count", minimum=0)
        available = self.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY
        values = (
            self.source_threshold,
            self.target_threshold,
            self.raw_transfer_entropy,
            self.finite_sample_bias,
            self.corrected_transfer_entropy,
            self.raw_p_value,
        )
        if available != all(value is not None for value in values):
            raise ContractValueError("transfer-entropy values exist exactly when available")
        if available != (self.reason is None):
            raise ContractValueError("transfer-entropy reason exists exactly when unknown")
        if (
            available
            and self.raw_transfer_entropy is not None
            and self.corrected_transfer_entropy is not None
            and self.corrected_transfer_entropy.mantissa > self.raw_transfer_entropy.mantissa
        ):
            raise ContractValueError("bias correction cannot increase transfer entropy")
        if self.selected and not available:
            raise ContractValueError("unknown transfer-entropy trials cannot be selected")


@dataclass(frozen=True, slots=True)
class CrossMarketResearchReportV1:
    provenance: CrossMarketProvenanceV1
    report_revision: str
    status: ResearchStatus
    reason: str | None
    posture: CrossMarketPosture
    transfers: tuple[LaggedOfiTransferV1, ...]
    granger: tuple[GrangerChallengerV1, ...]
    transfer_entropy: tuple[TransferEntropyChallengerV1, ...]
    trial_ledger: TrialLedgerV1
    holm: HolmReportV1
    leadership: LeadershipVerdict
    authority: str = "NONE"
    is_promotable: bool = False
    cost_latency_validated: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.provenance, CrossMarketProvenanceV1):
            raise ContractValueError("report provenance must be CrossMarketProvenanceV1")
        require_contract_id(self.report_revision, field="report_revision")
        expected_revision = (
            f"{CROSS_MARKET_ALGORITHM_REVISION}:{self.provenance.input_sha256.hexdigest}"
        )
        if self.report_revision != expected_revision:
            raise ContractValueError("report_revision must bind the immutable input provenance")
        if not isinstance(self.status, ResearchStatus):
            raise ContractValueError("status must be ResearchStatus")
        if (self.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY) != (self.reason is None):
            raise ContractValueError("report reason exists exactly when evidence is unknown")
        if self.authority != "NONE" or self.is_promotable or self.cost_latency_validated:
            raise ContractValueError("cross-market research grants no operational authority")


def _pair_reason(
    series_a: VenueResearchSeriesV1,
    series_b: VenueResearchSeriesV1,
    partition: CrossMarketPartitionV1,
) -> str | None:
    if series_a.venue_id == series_b.venue_id:
        return "VENUES_NOT_DISTINCT"
    if (
        series_a.base_asset_id,
        series_a.quote_asset_id,
        series_a.product_id,
    ) != (
        series_b.base_asset_id,
        series_b.quote_asset_id,
        series_b.product_id,
    ):
        return "INSTRUMENT_SEMANTICS_MISMATCH"
    if series_a.bar_width_ns != series_b.bar_width_ns:
        return "BAR_WIDTH_MISMATCH"
    if len(series_a.bars) != len(series_b.bars) or partition.selection_end > len(series_a.bars):
        return "PARTITION_OUTSIDE_ALIGNED_EVIDENCE"
    for left, right in zip(series_a.bars, series_b.bars, strict=True):
        if (
            left.bar_index,
            left.start_ns,
            left.end_ns,
        ) != (
            right.bar_index,
            right.start_ns,
            right.end_ns,
        ):
            return "WALL_CLOCK_GRID_MISMATCH"
    return None


def _direction_series(
    direction: CrossVenueDirection,
    series_a: VenueResearchSeriesV1,
    series_b: VenueResearchSeriesV1,
) -> tuple[VenueResearchSeriesV1, VenueResearchSeriesV1]:
    return (series_a, series_b) if direction is CrossVenueDirection.A_TO_B else (series_b, series_a)


def _lag_rows(
    source: VenueResearchSeriesV1,
    target: VenueResearchSeriesV1,
    *,
    lag: int,
    start: int,
    end: int,
    with_history: bool,
) -> tuple[tuple[Fraction, ...], ...]:
    uncertainty = source.max_clock_uncertainty_ns + target.max_clock_uncertainty_ns
    if lag * source.bar_width_ns <= uncertainty:
        return ()
    rows: list[tuple[Fraction, ...]] = []
    warmup = max(lag, 1 if with_history else 0)
    for target_position in range(start + warmup, end):
        source_position = target_position - lag
        if source_position < start:
            continue
        source_bar = source.bars[source_position]
        target_bar = target.bars[target_position]
        if source_bar.available_ns > target_bar.start_ns:
            continue
        if source_bar.ofi is None or target_bar.return_value is None:
            continue
        if not with_history:
            rows.append((_fraction(source_bar.ofi), _fraction(target_bar.return_value)))
            continue
        previous_target = target.bars[target_position - 1]
        if previous_target.return_value is None:
            continue
        rows.append(
            (
                _fraction(source_bar.ofi),
                _fraction(previous_target.return_value),
                _fraction(target_bar.return_value),
            )
        )
    return tuple(rows)


def _ols_slope(rows: tuple[tuple[Fraction, Fraction], ...]) -> Fraction | None:
    if len(rows) < 2:
        return None
    mean_x = sum((row[0] for row in rows), Fraction(0)) / len(rows)
    mean_y = sum((row[1] for row in rows), Fraction(0)) / len(rows)
    numerator = sum(((x - mean_x) * (y - mean_y) for x, y in rows), Fraction(0))
    denominator = sum(((x - mean_x) ** 2 for x, _ in rows), Fraction(0))
    return None if denominator == 0 else numerator / denominator


def _sign(value: Fraction | None) -> int:
    if value is None or value == 0:
        return 0
    return 1 if value > 0 else -1


def _lagged_ofi_report(
    direction: CrossVenueDirection,
    lag: int,
    source: VenueResearchSeriesV1,
    target: VenueResearchSeriesV1,
    partition: CrossMarketPartitionV1,
) -> LaggedOfiTransferV1:
    train_rows_raw = _lag_rows(
        source, target, lag=lag, start=0, end=partition.train_end, with_history=False
    )
    selection_rows_raw = _lag_rows(
        source,
        target,
        lag=lag,
        start=partition.selection_start,
        end=partition.selection_end,
        with_history=False,
    )
    train_rows = tuple((row[0], row[1]) for row in train_rows_raw)
    selection_rows = tuple((row[0], row[1]) for row in selection_rows_raw)
    half = len(selection_rows) // 2
    slopes = (
        _ols_slope(train_rows),
        _ols_slope(selection_rows),
        _ols_slope(selection_rows[:half]),
        _ols_slope(selection_rows[half:]),
    )
    reason: str | None = None
    if len(train_rows) < MIN_TRANSFER_PAIRS or len(selection_rows) < MIN_TRANSFER_PAIRS:
        reason = "DATA_INSUFFICIENT"
    elif any(value is None for value in slopes):
        reason = "ZERO_SOURCE_VARIANCE"
    signs = tuple(_sign(value) for value in slopes)
    stable_sign = signs[0] if reason is None and signs[0] != 0 and len(set(signs)) == 1 else 0
    return LaggedOfiTransferV1(
        direction,
        lag,
        ResearchStatus.UNKNOWN if reason is not None else ResearchStatus.AVAILABLE_RESEARCH_ONLY,
        reason,
        len(train_rows),
        len(selection_rows),
        None if reason is not None or slopes[0] is None else _ratio(slopes[0]),
        None if reason is not None or slopes[1] is None else _ratio(slopes[1]),
        None if reason is not None or slopes[2] is None else _ratio(slopes[2]),
        None if reason is not None or slopes[3] is None else _ratio(slopes[3]),
        stable_sign,
    )


def _solve(rows: tuple[tuple[Fraction, ...], ...], columns: int) -> tuple[Fraction, ...] | None:
    matrix = [[Fraction(0) for _ in range(columns + 1)] for _ in range(columns)]
    for row in rows:
        features = (Fraction(1), *row[:-1])
        target = row[-1]
        if len(features) != columns:
            raise AssertionError("normal-equation column mismatch")
        for left in range(columns):
            for right in range(columns):
                matrix[left][right] += features[left] * features[right]
            matrix[left][-1] += features[left] * target
    for column in range(columns):
        pivot = next((row for row in range(column, columns) if matrix[row][column] != 0), None)
        if pivot is None:
            return None
        matrix[column], matrix[pivot] = matrix[pivot], matrix[column]
        divisor = matrix[column][column]
        matrix[column] = [value / divisor for value in matrix[column]]
        for row_index in range(columns):
            if row_index == column:
                continue
            multiplier = matrix[row_index][column]
            matrix[row_index] = [
                value - multiplier * pivot_value
                for value, pivot_value in zip(matrix[row_index], matrix[column], strict=True)
            ]
    return tuple(matrix[index][-1] for index in range(columns))


def _prediction(coefficients: tuple[Fraction, ...], features: tuple[Fraction, ...]) -> Fraction:
    return coefficients[0] + sum(
        (
            coefficient * value
            for coefficient, value in zip(coefficients[1:], features, strict=True)
        ),
        Fraction(0),
    )


def _binomial_tail(positive: int, total: int) -> ExactRatioV1:
    if total == 0 or positive * 2 <= total:
        return make_ratio(1, 1)
    return make_ratio(sum(comb(total, count) for count in range(positive, total + 1)), 2**total)


def _granger(
    direction: CrossVenueDirection,
    lag: int,
    source: VenueResearchSeriesV1,
    target: VenueResearchSeriesV1,
    partition: CrossMarketPartitionV1,
) -> GrangerChallengerV1:
    trial_id = f"granger-{direction.value.lower()}-lag-{lag:02d}"
    train = _lag_rows(source, target, lag=lag, start=0, end=partition.train_end, with_history=True)
    selection = _lag_rows(
        source,
        target,
        lag=lag,
        start=partition.selection_start,
        end=partition.selection_end,
        with_history=True,
    )
    if len(train) < MIN_GRANGER_TRAIN or len(selection) < MIN_GRANGER_SELECTION:
        return GrangerChallengerV1(
            trial_id,
            direction,
            lag,
            ResearchStatus.UNKNOWN,
            "DATA_INSUFFICIENT",
            len(train),
            len(selection),
            None,
            None,
            None,
        )
    restricted_rows = tuple((row[1], row[2]) for row in train)
    unrestricted_rows = tuple((row[1], row[0], row[2]) for row in train)
    restricted = _solve(restricted_rows, 2)
    unrestricted = _solve(unrestricted_rows, 3)
    if restricted is None or unrestricted is None:
        return GrangerChallengerV1(
            trial_id,
            direction,
            lag,
            ResearchStatus.UNKNOWN,
            "SINGULAR_TRAINING_SYSTEM",
            len(train),
            len(selection),
            None,
            None,
            None,
        )
    restricted_errors: list[Fraction] = []
    unrestricted_errors: list[Fraction] = []
    positive = 0
    non_ties = 0
    for source_ofi, own_previous, target_return in selection:
        restricted_error = target_return - _prediction(restricted, (own_previous,))
        unrestricted_error = target_return - _prediction(unrestricted, (own_previous, source_ofi))
        restricted_square = restricted_error**2
        unrestricted_square = unrestricted_error**2
        restricted_errors.append(restricted_square)
        unrestricted_errors.append(unrestricted_square)
        if restricted_square != unrestricted_square:
            non_ties += 1
            positive += unrestricted_square < restricted_square
    restricted_sse = sum(restricted_errors, Fraction(0))
    unrestricted_sse = sum(unrestricted_errors, Fraction(0))
    return GrangerChallengerV1(
        trial_id,
        direction,
        lag,
        ResearchStatus.AVAILABLE_RESEARCH_ONLY,
        None,
        len(train),
        len(selection),
        _ratio(restricted_sse),
        _ratio(unrestricted_sse),
        _binomial_tail(positive, non_ties),
    )


def _median(values: tuple[Fraction, ...]) -> Fraction:
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def _fixed_decimal(value: Decimal) -> FixedPointV1:
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        return FixedPointV1(int((value * Decimal(FIXED_POINT_SCALE)).to_integral_value()))


def _te_score(
    rows: tuple[tuple[Fraction, ...], ...],
    *,
    source_threshold: Fraction,
    target_threshold: Fraction,
) -> tuple[FixedPointV1, FixedPointV1, FixedPointV1]:
    counts_xyz: dict[tuple[int, int, int], int] = {}
    counts_yz: dict[tuple[int, int], int] = {}
    counts_xz: dict[tuple[int, int], int] = {}
    counts_z: dict[int, int] = {}
    for source, previous, target in rows:
        x = int(source > source_threshold)
        z = int(previous > target_threshold)
        y = int(target > target_threshold)
        counts_xyz[(x, y, z)] = counts_xyz.get((x, y, z), 0) + 1
        counts_yz[(y, z)] = counts_yz.get((y, z), 0) + 1
        counts_xz[(x, z)] = counts_xz.get((x, z), 0) + 1
        counts_z[z] = counts_z.get(z, 0) + 1
    with localcontext() as context:
        context.prec = 48
        context.rounding = ROUND_HALF_EVEN
        total = Decimal(len(rows))
        raw = Decimal(0)
        for (x, y, z), count in counts_xyz.items():
            numerator = Decimal(count * counts_z[z])
            denominator = Decimal(counts_yz[(y, z)] * counts_xz[(x, z)])
            raw += (Decimal(count) / total) * (numerator / denominator).ln()
        degrees = 0
        for z in counts_z:
            x_states = len({x for x, observed_z in counts_xz if observed_z == z})
            y_states = len({y for y, observed_z in counts_yz if observed_z == z})
            degrees += max(0, x_states - 1) * max(0, y_states - 1)
        bias = Decimal(degrees) / (Decimal(2) * total)
        corrected = max(Decimal(0), raw - bias)
    return _fixed_decimal(raw), _fixed_decimal(bias), _fixed_decimal(corrected)


def _transfer_entropy(
    direction: CrossVenueDirection,
    lag: int,
    source: VenueResearchSeriesV1,
    target: VenueResearchSeriesV1,
    partition: CrossMarketPartitionV1,
) -> TransferEntropyChallengerV1:
    trial_id = f"te-{direction.value.lower()}-lag-{lag:02d}"
    train = _lag_rows(source, target, lag=lag, start=0, end=partition.train_end, with_history=True)
    selection = _lag_rows(
        source,
        target,
        lag=lag,
        start=partition.selection_start,
        end=partition.selection_end,
        with_history=True,
    )
    block_count = min(MAX_TE_BLOCKS, len(selection) // TE_BLOCK_SIZE)
    if len(train) < MIN_TE_TRAIN or block_count < MIN_TE_BLOCKS:
        return TransferEntropyChallengerV1(
            trial_id,
            direction,
            lag,
            ResearchStatus.UNKNOWN,
            "DATA_INSUFFICIENT",
            len(train),
            len(selection),
            None,
            None,
            None,
            None,
            None,
            None,
        )
    source_threshold = _median(tuple(row[0] for row in train))
    target_threshold = _median(tuple(row[2] for row in train))
    evaluated = selection[: block_count * TE_BLOCK_SIZE]
    raw, bias, corrected = _te_score(
        evaluated,
        source_threshold=source_threshold,
        target_threshold=target_threshold,
    )
    positive_blocks = 0
    for block_index in range(block_count):
        block = evaluated[block_index * TE_BLOCK_SIZE : (block_index + 1) * TE_BLOCK_SIZE]
        _, _, block_corrected = _te_score(
            block,
            source_threshold=source_threshold,
            target_threshold=target_threshold,
        )
        positive_blocks += block_corrected.mantissa > 0
    return TransferEntropyChallengerV1(
        trial_id,
        direction,
        lag,
        ResearchStatus.AVAILABLE_RESEARCH_ONLY,
        None,
        len(train),
        len(evaluated),
        _ratio(source_threshold),
        _ratio(target_threshold),
        raw,
        bias,
        corrected,
        _binomial_tail(positive_blocks, block_count),
    )


def _combined_posture(
    series_a: VenueResearchSeriesV1, series_b: VenueResearchSeriesV1
) -> CrossMarketPosture:
    return (
        CrossMarketPosture.SYNTHETIC_RESEARCH_ONLY
        if CrossMarketPosture.SYNTHETIC_RESEARCH_ONLY in (series_a.posture, series_b.posture)
        else CrossMarketPosture.PUBLIC_REPLAY_RESEARCH_ONLY
    )


def evaluate_cross_market_research(
    series_a: VenueResearchSeriesV1,
    series_b: VenueResearchSeriesV1,
    *,
    partition: CrossMarketPartitionV1,
    spec: CrossMarketSpecV1 | None = None,
) -> CrossMarketResearchReportV1:
    if not isinstance(series_a, VenueResearchSeriesV1) or not isinstance(
        series_b, VenueResearchSeriesV1
    ):
        raise ContractValueError("series must be VenueResearchSeriesV1")
    if not isinstance(partition, CrossMarketPartitionV1):
        raise ContractValueError("partition must be CrossMarketPartitionV1")
    if spec is None:
        spec = CrossMarketSpecV1()
    elif not isinstance(spec, CrossMarketSpecV1):
        raise ContractValueError("spec must be CrossMarketSpecV1 or None")
    provenance = _cross_market_provenance(series_a, series_b, partition, spec)
    pair_reason = _pair_reason(series_a, series_b, partition)
    transfers: list[LaggedOfiTransferV1] = []
    granger: list[GrangerChallengerV1] = []
    entropy: list[TransferEntropyChallengerV1] = []
    for direction in CrossVenueDirection:
        source, target = _direction_series(direction, series_a, series_b)
        for lag in range(1, spec.max_lag + 1):
            if pair_reason is None:
                transfers.append(
                    _lagged_ofi_report(direction, lag, source, target, partition)
                )
                granger.append(_granger(direction, lag, source, target, partition))
                entropy.append(_transfer_entropy(direction, lag, source, target, partition))
                continue
            transfers.append(
                LaggedOfiTransferV1(
                    direction,
                    lag,
                    ResearchStatus.UNKNOWN,
                    pair_reason,
                    0,
                    0,
                    None,
                    None,
                    None,
                    None,
                    0,
                )
            )
            granger.append(
                GrangerChallengerV1(
                    f"granger-{direction.value.lower()}-lag-{lag:02d}",
                    direction,
                    lag,
                    ResearchStatus.UNKNOWN,
                    pair_reason,
                    0,
                    0,
                    None,
                    None,
                    None,
                )
            )
            entropy.append(
                TransferEntropyChallengerV1(
                    f"te-{direction.value.lower()}-lag-{lag:02d}",
                    direction,
                    lag,
                    ResearchStatus.UNKNOWN,
                    pair_reason,
                    0,
                    0,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                )
            )
    challenger_rows: tuple[GrangerChallengerV1 | TransferEntropyChallengerV1, ...] = tuple(
        sorted((*granger, *entropy), key=lambda item: item.trial_id)
    )
    if len(challenger_rows) > MAX_CROSS_MARKET_TRIALS:
        raise ContractValueError("cross-market trial family exceeds its deterministic cap")
    trials = tuple(
        TrialRecordV1(
            trial_id=item.trial_id,
            family_id="q076-cross-market-v1",
            model_id=item.trial_id,
            metric_id="exact-sign-p-value",
            status=(
                TrialStatus.COMPLETED
                if item.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY
                else TrialStatus.FAILED
            ),
            note="public research challenger",
        )
        for item in challenger_rows
    )
    ledger = TrialLedgerV1(trials)
    holm = holm_bonferroni(
        ledger,
        tuple((item.trial_id, item.raw_p_value) for item in challenger_rows),
        familywise_alpha_per_myriad=spec.familywise_alpha_per_myriad,
    )
    selected = set(holm.rejected_trial_ids)
    granger = [replace(item, selected=item.trial_id in selected) for item in granger]
    entropy = [replace(item, selected=item.trial_id in selected) for item in entropy]
    stable = {
        (item.direction, item.lag_bars)
        for item in transfers
        if item.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY and item.stable_sign != 0
    }
    selected_granger = {(item.direction, item.lag_bars) for item in granger if item.selected}
    selected_entropy = {(item.direction, item.lag_bars) for item in entropy if item.selected}
    granger_directions = {direction for direction, _ in selected_granger}
    entropy_directions = {direction for direction, _ in selected_entropy}
    supported = {direction for direction, lag in stable & (selected_granger | selected_entropy)}
    if pair_reason is not None:
        leadership = LeadershipVerdict.UNKNOWN
    elif (
        granger_directions
        and entropy_directions
        and granger_directions.isdisjoint(entropy_directions)
    ):
        leadership = LeadershipVerdict.METHOD_CONFLICT
    elif supported == set(CrossVenueDirection):
        leadership = LeadershipVerdict.BIDIRECTIONAL
    elif supported == {CrossVenueDirection.A_TO_B}:
        leadership = LeadershipVerdict.A_LEADS_RESEARCH_ONLY
    elif supported == {CrossVenueDirection.B_TO_A}:
        leadership = LeadershipVerdict.B_LEADS_RESEARCH_ONLY
    else:
        leadership = LeadershipVerdict.NO_STABLE_LEAD
    available = pair_reason is None and any(
        item.status is ResearchStatus.AVAILABLE_RESEARCH_ONLY for item in challenger_rows
    )
    return CrossMarketResearchReportV1(
        provenance=provenance,
        report_revision=(
            f"{CROSS_MARKET_ALGORITHM_REVISION}:{provenance.input_sha256.hexdigest}"
        ),
        status=(ResearchStatus.AVAILABLE_RESEARCH_ONLY if available else ResearchStatus.UNKNOWN),
        reason=None if available else pair_reason or "DATA_INSUFFICIENT",
        posture=_combined_posture(series_a, series_b),
        transfers=tuple(transfers),
        granger=tuple(granger),
        transfer_entropy=tuple(entropy),
        trial_ledger=ledger,
        holm=holm,
        leadership=leadership,
    )
