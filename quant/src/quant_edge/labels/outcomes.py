from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.labels.identity import SampleIdentityV1
from quant_edge.labels.rational import (
    ExactRatioV1,
    make_ratio,
    ratio_compare,
    ratio_subtract,
    scaled_to_aligned,
)
from quant_edge.labels.series import EvidenceSeriesV1, QuotePointV1, SeriesKind
from quant_edge.lake.contracts import (
    DigestV1,
    require_contract_id,
    require_strict_int,
)

SECOND_NS: Final = 1_000_000_000
HORIZON_GRID_NS: Final = (
    1 * SECOND_NS,
    5 * SECOND_NS,
    15 * SECOND_NS,
    30 * SECOND_NS,
    60 * SECOND_NS,
    300 * SECOND_NS,
    900 * SECOND_NS,
    3_600 * SECOND_NS,
)
MAX_HORIZONS: Final = 16
MAX_COST_SCENARIOS: Final = 8
MAX_STALENESS_NS: Final = 3_600 * SECOND_NS


class OutcomeStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    CENSORED = "CENSORED"
    UNAVAILABLE = "UNAVAILABLE"
    DATA_INVALID = "DATA_INVALID"


class PassageBarrier(StrEnum):
    UP = "UP"
    DOWN = "DOWN"


@dataclass(frozen=True, slots=True)
class OutcomeDefinitionV1:
    """Versioned outcome definitions; values exist only under these exact rules."""

    definition_version: str
    max_reference_staleness_ns: int
    horizons_ns: tuple[int, ...] = HORIZON_GRID_NS

    def __post_init__(self) -> None:
        require_contract_id(self.definition_version, field="definition_version")
        require_strict_int(
            self.max_reference_staleness_ns,
            field="max_reference_staleness_ns",
            minimum=1,
            maximum=MAX_STALENESS_NS,
        )
        if (
            not isinstance(self.horizons_ns, tuple)
            or not self.horizons_ns
            or len(self.horizons_ns) > MAX_HORIZONS
        ):
            raise ContractValueError(f"horizons_ns must be a tuple of 1..{MAX_HORIZONS} horizons")
        previous = 0
        for horizon in self.horizons_ns:
            require_strict_int(horizon, field="horizons_ns", minimum=1)
            if horizon <= previous:
                raise ContractValueError("horizons must strictly increase")
            previous = horizon

    def as_mapping(self) -> dict[str, object]:
        return {
            "definitionVersion": self.definition_version,
            "horizonsNs": [str(h) for h in self.horizons_ns],
            "maxReferenceStalenessNs": str(self.max_reference_staleness_ns),
        }


@dataclass(frozen=True, slots=True)
class BarrierSpecV1:
    spec_version: str
    up_ratio: ExactRatioV1
    down_ratio: ExactRatioV1

    def __post_init__(self) -> None:
        require_contract_id(self.spec_version, field="spec_version")
        if not isinstance(self.up_ratio, ExactRatioV1) or not isinstance(
            self.down_ratio, ExactRatioV1
        ):
            raise ContractValueError("barrier ratios must be ExactRatioV1")
        if self.up_ratio.numerator <= 0:
            raise ContractValueError("the up barrier must be strictly positive")
        if self.down_ratio.numerator >= 0:
            raise ContractValueError("the down barrier must be strictly negative")

    def as_mapping(self) -> dict[str, object]:
        return {
            "downRatio": self.down_ratio.as_mapping(),
            "specVersion": self.spec_version,
            "upRatio": self.up_ratio.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class CostScenarioV1:
    """Explicit versioned cost/latency assumption; never an implied constant."""

    scenario_version: str
    total_cost_ratio: ExactRatioV1
    submission_latency_ns: int

    def __post_init__(self) -> None:
        require_contract_id(self.scenario_version, field="scenario_version")
        if not isinstance(self.total_cost_ratio, ExactRatioV1):
            raise ContractValueError("total_cost_ratio must be ExactRatioV1")
        if self.total_cost_ratio.is_negative:
            raise ContractValueError("costs cannot be negative")
        require_strict_int(
            self.submission_latency_ns,
            field="submission_latency_ns",
            minimum=0,
            maximum=MAX_STALENESS_NS,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "scenarioVersion": self.scenario_version,
            "submissionLatencyNs": str(self.submission_latency_ns),
            "totalCostRatio": self.total_cost_ratio.as_mapping(),
        }


def _ratio_or_none(value: ExactRatioV1 | None) -> dict[str, object] | None:
    return None if value is None else value.as_mapping()


def _require_status_shape(
    status: OutcomeStatus,
    *,
    value_present: bool,
    censor_present: bool,
) -> None:
    if not isinstance(status, OutcomeStatus):
        raise ContractValueError("status must be OutcomeStatus")
    if status is OutcomeStatus.AVAILABLE and not value_present:
        raise ContractValueError("AVAILABLE outcomes must carry a value")
    if status is not OutcomeStatus.AVAILABLE and value_present:
        raise ContractValueError("only AVAILABLE outcomes may carry a value")
    if status is OutcomeStatus.CENSORED and not censor_present:
        raise ContractValueError("CENSORED outcomes must carry a censor time")
    if status is not OutcomeStatus.CENSORED and censor_present:
        raise ContractValueError("only CENSORED outcomes may carry a censor time")


@dataclass(frozen=True, slots=True)
class HorizonOutcomeV1:
    horizon_ns: int
    status: OutcomeStatus
    gross_return: ExactRatioV1 | None
    censor_time_ns: int | None

    def __post_init__(self) -> None:
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        _require_status_shape(
            self.status,
            value_present=self.gross_return is not None,
            censor_present=self.censor_time_ns is not None,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "censorTimeNs": None if self.censor_time_ns is None else str(self.censor_time_ns),
            "grossReturn": _ratio_or_none(self.gross_return),
            "horizonNs": str(self.horizon_ns),
            "status": self.status.value,
        }


@dataclass(frozen=True, slots=True)
class ExcursionOutcomeV1:
    """Long-convention MFE/MAE over the label interval; censoring stays explicit."""

    status: OutcomeStatus
    max_upside: ExactRatioV1 | None
    max_downside: ExactRatioV1 | None
    time_to_max_upside_ns: int | None
    time_to_max_downside_ns: int | None
    censor_time_ns: int | None

    def __post_init__(self) -> None:
        values = (
            self.max_upside,
            self.max_downside,
            self.time_to_max_upside_ns,
            self.time_to_max_downside_ns,
        )
        present = [value is not None for value in values]
        if any(present) != all(present):
            raise ContractValueError("excursion values must be present together")
        _require_status_shape(
            self.status,
            value_present=all(present),
            censor_present=self.censor_time_ns is not None,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "censorTimeNs": None if self.censor_time_ns is None else str(self.censor_time_ns),
            "maxDownside": _ratio_or_none(self.max_downside),
            "maxUpside": _ratio_or_none(self.max_upside),
            "status": self.status.value,
            "timeToMaxDownsideNs": (
                None if self.time_to_max_downside_ns is None else str(self.time_to_max_downside_ns)
            ),
            "timeToMaxUpsideNs": (
                None if self.time_to_max_upside_ns is None else str(self.time_to_max_upside_ns)
            ),
        }


@dataclass(frozen=True, slots=True)
class FirstPassageOutcomeV1:
    status: OutcomeStatus
    barrier: PassageBarrier | None
    passage_time_ns: int | None
    censor_time_ns: int | None

    def __post_init__(self) -> None:
        if (self.barrier is None) != (self.passage_time_ns is None):
            raise ContractValueError("passage barrier and time must be present together")
        _require_status_shape(
            self.status,
            value_present=self.barrier is not None,
            censor_present=self.censor_time_ns is not None,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "barrier": None if self.barrier is None else self.barrier.value,
            "censorTimeNs": None if self.censor_time_ns is None else str(self.censor_time_ns),
            "passageTimeNs": (None if self.passage_time_ns is None else str(self.passage_time_ns)),
            "status": self.status.value,
        }


@dataclass(frozen=True, slots=True)
class CostedOutcomeV1:
    scenario_version: str
    horizon_ns: int
    status: OutcomeStatus
    gross_return: ExactRatioV1 | None
    net_return: ExactRatioV1 | None
    opportunity_decay: ExactRatioV1 | None
    censor_time_ns: int | None

    def __post_init__(self) -> None:
        require_contract_id(self.scenario_version, field="scenario_version")
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        values = (self.gross_return, self.net_return, self.opportunity_decay)
        present = [value is not None for value in values]
        if any(present) != all(present):
            raise ContractValueError("costed values must be present together")
        _require_status_shape(
            self.status,
            value_present=all(present),
            censor_present=self.censor_time_ns is not None,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "censorTimeNs": None if self.censor_time_ns is None else str(self.censor_time_ns),
            "grossReturn": _ratio_or_none(self.gross_return),
            "horizonNs": str(self.horizon_ns),
            "netReturn": _ratio_or_none(self.net_return),
            "opportunityDecay": _ratio_or_none(self.opportunity_decay),
            "scenarioVersion": self.scenario_version,
            "status": self.status.value,
        }


@dataclass(frozen=True, slots=True)
class SpreadOutcomeV1:
    horizon_ns: int
    status: OutcomeStatus
    entry_spread: ExactRatioV1 | None
    exit_spread: ExactRatioV1 | None
    spread_change: ExactRatioV1 | None
    executable_return: ExactRatioV1 | None
    censor_time_ns: int | None

    def __post_init__(self) -> None:
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        values = (
            self.entry_spread,
            self.exit_spread,
            self.spread_change,
            self.executable_return,
        )
        present = [value is not None for value in values]
        if any(present) != all(present):
            raise ContractValueError("spread values must be present together")
        _require_status_shape(
            self.status,
            value_present=all(present),
            censor_present=self.censor_time_ns is not None,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "censorTimeNs": None if self.censor_time_ns is None else str(self.censor_time_ns),
            "entrySpread": _ratio_or_none(self.entry_spread),
            "executableReturn": _ratio_or_none(self.executable_return),
            "exitSpread": _ratio_or_none(self.exit_spread),
            "horizonNs": str(self.horizon_ns),
            "spreadChange": _ratio_or_none(self.spread_change),
            "status": self.status.value,
        }


@dataclass(frozen=True, slots=True)
class ResidualOutcomeV1:
    horizon_ns: int
    status: OutcomeStatus
    sample_return: ExactRatioV1 | None
    market_return: ExactRatioV1 | None
    residual_return: ExactRatioV1 | None
    censor_time_ns: int | None

    def __post_init__(self) -> None:
        require_strict_int(self.horizon_ns, field="horizon_ns", minimum=1)
        values = (self.sample_return, self.market_return, self.residual_return)
        present = [value is not None for value in values]
        if any(present) != all(present):
            raise ContractValueError("residual values must be present together")
        _require_status_shape(
            self.status,
            value_present=all(present),
            censor_present=self.censor_time_ns is not None,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "censorTimeNs": None if self.censor_time_ns is None else str(self.censor_time_ns),
            "horizonNs": str(self.horizon_ns),
            "marketReturn": _ratio_or_none(self.market_return),
            "residualReturn": _ratio_or_none(self.residual_return),
            "sampleReturn": _ratio_or_none(self.sample_return),
            "status": self.status.value,
        }


@dataclass(frozen=True, slots=True)
class SampleOutcomesV1:
    """Objective multi-horizon outcomes for one sample; referenceable by Q-E links."""

    outcome_id: str
    sample: SampleIdentityV1
    definition: OutcomeDefinitionV1
    barriers: BarrierSpecV1
    series_kind: SeriesKind
    series_digest: DigestV1
    pre_cutoff_digest: DigestV1
    horizons: tuple[HorizonOutcomeV1, ...]
    excursion: ExcursionOutcomeV1
    first_passage: FirstPassageOutcomeV1
    costed: tuple[CostedOutcomeV1, ...]
    spreads: tuple[SpreadOutcomeV1, ...]
    residuals: tuple[ResidualOutcomeV1, ...]
    executable_capacity_status: OutcomeStatus
    depth_deterioration_status: OutcomeStatus

    def __post_init__(self) -> None:
        if self.executable_capacity_status is not OutcomeStatus.UNAVAILABLE:
            raise ContractValueError(
                "executable capacity requires depth evidence the lane does not hold"
            )
        if self.depth_deterioration_status is not OutcomeStatus.UNAVAILABLE:
            raise ContractValueError(
                "depth deterioration requires book evidence the lane does not hold"
            )
        expected = derive_outcome_id(self.core_mapping())
        if self.outcome_id != expected:
            raise ContractValueError("outcome_id disagrees with the derived outcome identity")

    def core_mapping(self) -> dict[str, object]:
        return _outcome_core_mapping(
            sample=self.sample,
            definition=self.definition,
            barriers=self.barriers,
            series_kind=self.series_kind,
            series_digest=self.series_digest,
            pre_cutoff_digest=self.pre_cutoff_digest,
            horizons=self.horizons,
            excursion=self.excursion,
            first_passage=self.first_passage,
            costed=self.costed,
            spreads=self.spreads,
            residuals=self.residuals,
        )

    def as_mapping(self) -> dict[str, object]:
        mapping = self.core_mapping()
        mapping["outcomeId"] = self.outcome_id
        return mapping

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def content_sha256(self) -> str:
        return hashlib.sha256(self.canonical_bytes()).hexdigest()


def derive_outcome_id(core_mapping: dict[str, object]) -> str:
    return f"q05outcome:{hashlib.sha256(canonical_json_bytes(core_mapping)).hexdigest()}"


def _outcome_core_mapping(
    *,
    sample: SampleIdentityV1,
    definition: OutcomeDefinitionV1,
    barriers: BarrierSpecV1,
    series_kind: SeriesKind,
    series_digest: DigestV1,
    pre_cutoff_digest: DigestV1,
    horizons: tuple[HorizonOutcomeV1, ...],
    excursion: ExcursionOutcomeV1,
    first_passage: FirstPassageOutcomeV1,
    costed: tuple[CostedOutcomeV1, ...],
    spreads: tuple[SpreadOutcomeV1, ...],
    residuals: tuple[ResidualOutcomeV1, ...],
) -> dict[str, object]:
    return {
        "barriers": barriers.as_mapping(),
        "costed": [outcome.as_mapping() for outcome in costed],
        "definition": definition.as_mapping(),
        "depthDeteriorationStatus": OutcomeStatus.UNAVAILABLE.value,
        "excursion": excursion.as_mapping(),
        "executableCapacityStatus": OutcomeStatus.UNAVAILABLE.value,
        "firstPassage": first_passage.as_mapping(),
        "horizons": [outcome.as_mapping() for outcome in horizons],
        "preCutoffEvidenceSha256": pre_cutoff_digest.hexdigest,
        "residuals": [outcome.as_mapping() for outcome in residuals],
        "sample": sample.as_mapping(),
        "schema": "Q05SampleOutcomesV1",
        "seriesEvidenceSha256": series_digest.hexdigest,
        "seriesKind": series_kind.value,
        "spreads": [outcome.as_mapping() for outcome in spreads],
        "version": 1,
    }


@dataclass(frozen=True, slots=True)
class _ValuePoint:
    time_ns: int
    value: int


def _series_values(series: EvidenceSeriesV1) -> tuple[_ValuePoint, ...]:
    if series.kind is SeriesKind.EXECUTABLE_QUOTES:
        # The bid/ask sum is proportional to the mid, so mid returns computed from it
        # are exact without dividing by two.
        return tuple(
            _ValuePoint(
                time_ns=point.event_time_ns,
                value=scaled_to_aligned(point.bid) + scaled_to_aligned(point.ask),
            )
            for point in series.quote_points
        )
    return tuple(
        _ValuePoint(
            time_ns=point.event_time_ns,
            value=scaled_to_aligned(point.price),
        )
        for point in series.price_points
    )


def _last_at_or_before(
    values: tuple[_ValuePoint, ...],
    time_ns: int,
) -> _ValuePoint | None:
    chosen: _ValuePoint | None = None
    for point in values:
        if point.time_ns > time_ns:
            break
        chosen = point
    return chosen


def _carry_forward(
    values: tuple[_ValuePoint, ...],
    time_ns: int,
    reference: _ValuePoint,
) -> _ValuePoint:
    """Last value at or before ``time_ns``; the reference guarantees existence."""

    chosen = reference
    for point in values:
        if point.time_ns > time_ns:
            break
        chosen = point
    return chosen


def _value_return(reference: _ValuePoint, future: _ValuePoint) -> ExactRatioV1:
    return make_ratio(future.value - reference.value, reference.value)


class _Window:
    """Shared per-target evidence checks; every rule is explicit and versioned."""

    def __init__(
        self,
        series: EvidenceSeriesV1,
        values: tuple[_ValuePoint, ...],
        definition: OutcomeDefinitionV1,
        label_start_ns: int,
    ) -> None:
        self.series = series
        self.values = values
        self.definition = definition
        self.label_start_ns = label_start_ns

    def reference(self, entry_time_ns: int) -> _ValuePoint | None:
        point = _last_at_or_before(self.values, entry_time_ns)
        if point is None:
            return None
        if entry_time_ns - point.time_ns > self.definition.max_reference_staleness_ns:
            return None
        return point

    def target_state(self, entry_time_ns: int, target_ns: int) -> tuple[OutcomeStatus, int]:
        """Classify one (entry, target] window: DATA_INVALID, CENSORED or AVAILABLE."""

        if self.series.gap_intersecting(entry_time_ns, target_ns):
            return (OutcomeStatus.DATA_INVALID, 0)
        if self.series.completeness_end_ns < target_ns:
            return (OutcomeStatus.CENSORED, self.series.completeness_end_ns)
        return (OutcomeStatus.AVAILABLE, 0)


def _horizon_outcomes(
    window: _Window,
    sample: SampleIdentityV1,
) -> tuple[HorizonOutcomeV1, ...]:
    outcomes: list[HorizonOutcomeV1] = []
    reference = window.reference(sample.label_start_ns)
    for horizon in window.definition.horizons_ns:
        if horizon > sample.horizon_ns or reference is None:
            outcomes.append(
                HorizonOutcomeV1(
                    horizon_ns=horizon,
                    status=OutcomeStatus.UNAVAILABLE,
                    gross_return=None,
                    censor_time_ns=None,
                )
            )
            continue
        target = sample.label_start_ns + horizon
        status, censor = window.target_state(sample.label_start_ns, target)
        if status is not OutcomeStatus.AVAILABLE:
            outcomes.append(
                HorizonOutcomeV1(
                    horizon_ns=horizon,
                    status=status,
                    gross_return=None,
                    censor_time_ns=censor if status is OutcomeStatus.CENSORED else None,
                )
            )
            continue
        future = _carry_forward(window.values, target, reference)
        outcomes.append(
            HorizonOutcomeV1(
                horizon_ns=horizon,
                status=OutcomeStatus.AVAILABLE,
                gross_return=_value_return(reference, future),
                censor_time_ns=None,
            )
        )
    return tuple(outcomes)


def _excursion_outcome(window: _Window, sample: SampleIdentityV1) -> ExcursionOutcomeV1:
    reference = window.reference(sample.label_start_ns)
    if reference is None:
        return ExcursionOutcomeV1(
            status=OutcomeStatus.UNAVAILABLE,
            max_upside=None,
            max_downside=None,
            time_to_max_upside_ns=None,
            time_to_max_downside_ns=None,
            censor_time_ns=None,
        )
    status, censor = window.target_state(sample.label_start_ns, sample.label_end_ns)
    if status is not OutcomeStatus.AVAILABLE:
        return ExcursionOutcomeV1(
            status=status,
            max_upside=None,
            max_downside=None,
            time_to_max_upside_ns=None,
            time_to_max_downside_ns=None,
            censor_time_ns=censor if status is OutcomeStatus.CENSORED else None,
        )
    max_up: tuple[int, int] | None = None
    max_down: tuple[int, int] | None = None
    for point in window.values:
        if point.time_ns <= sample.label_start_ns:
            continue
        if point.time_ns > sample.label_end_ns:
            break
        delta = point.value - reference.value
        if max_up is None or delta > max_up[0]:
            max_up = (delta, point.time_ns - sample.label_start_ns)
        if max_down is None or delta < max_down[0]:
            max_down = (delta, point.time_ns - sample.label_start_ns)
    if max_up is None or max_down is None:
        # A complete, gap-free window with no observations is an unchanged-value proxy.
        max_up = (0, 0)
        max_down = (0, 0)
    up_ratio = make_ratio(max(max_up[0], 0), reference.value)
    down_ratio = make_ratio(min(max_down[0], 0), reference.value)
    return ExcursionOutcomeV1(
        status=OutcomeStatus.AVAILABLE,
        max_upside=up_ratio,
        max_downside=down_ratio,
        time_to_max_upside_ns=max_up[1] if max_up[0] > 0 else 0,
        time_to_max_downside_ns=max_down[1] if max_down[0] < 0 else 0,
        censor_time_ns=None,
    )


def _first_passage_outcome(
    window: _Window,
    sample: SampleIdentityV1,
    barriers: BarrierSpecV1,
) -> FirstPassageOutcomeV1:
    reference = window.reference(sample.label_start_ns)
    if reference is None:
        return FirstPassageOutcomeV1(
            status=OutcomeStatus.UNAVAILABLE,
            barrier=None,
            passage_time_ns=None,
            censor_time_ns=None,
        )
    if window.series.gap_intersecting(sample.label_start_ns, sample.label_end_ns):
        return FirstPassageOutcomeV1(
            status=OutcomeStatus.DATA_INVALID,
            barrier=None,
            passage_time_ns=None,
            censor_time_ns=None,
        )
    for point in window.values:
        if point.time_ns <= sample.label_start_ns:
            continue
        if point.time_ns > min(sample.label_end_ns, window.series.completeness_end_ns):
            break
        observed = _value_return(reference, point)
        if ratio_compare(observed, barriers.up_ratio) >= 0:
            return FirstPassageOutcomeV1(
                status=OutcomeStatus.AVAILABLE,
                barrier=PassageBarrier.UP,
                passage_time_ns=point.time_ns,
                censor_time_ns=None,
            )
        if ratio_compare(observed, barriers.down_ratio) <= 0:
            return FirstPassageOutcomeV1(
                status=OutcomeStatus.AVAILABLE,
                barrier=PassageBarrier.DOWN,
                passage_time_ns=point.time_ns,
                censor_time_ns=None,
            )
    censor = min(sample.label_end_ns, window.series.completeness_end_ns)
    return FirstPassageOutcomeV1(
        status=OutcomeStatus.CENSORED,
        barrier=None,
        passage_time_ns=None,
        censor_time_ns=censor,
    )


def _costed_outcomes(
    window: _Window,
    sample: SampleIdentityV1,
    scenarios: tuple[CostScenarioV1, ...],
) -> tuple[CostedOutcomeV1, ...]:
    outcomes: list[CostedOutcomeV1] = []
    immediate_reference = window.reference(sample.label_start_ns)
    for scenario in scenarios:
        entry_time = sample.label_start_ns + scenario.submission_latency_ns
        delayed_reference = window.reference(entry_time)
        for horizon in window.definition.horizons_ns:
            if (
                horizon > sample.horizon_ns
                or scenario.submission_latency_ns >= horizon
                or immediate_reference is None
                or delayed_reference is None
            ):
                outcomes.append(
                    CostedOutcomeV1(
                        scenario_version=scenario.scenario_version,
                        horizon_ns=horizon,
                        status=OutcomeStatus.UNAVAILABLE,
                        gross_return=None,
                        net_return=None,
                        opportunity_decay=None,
                        censor_time_ns=None,
                    )
                )
                continue
            target = sample.label_start_ns + horizon
            status, censor = window.target_state(sample.label_start_ns, target)
            if status is not OutcomeStatus.AVAILABLE:
                outcomes.append(
                    CostedOutcomeV1(
                        scenario_version=scenario.scenario_version,
                        horizon_ns=horizon,
                        status=status,
                        gross_return=None,
                        net_return=None,
                        opportunity_decay=None,
                        censor_time_ns=censor if status is OutcomeStatus.CENSORED else None,
                    )
                )
                continue
            future = _carry_forward(window.values, target, delayed_reference)
            immediate_gross = _value_return(immediate_reference, future)
            delayed_gross = _value_return(delayed_reference, future)
            outcomes.append(
                CostedOutcomeV1(
                    scenario_version=scenario.scenario_version,
                    horizon_ns=horizon,
                    status=OutcomeStatus.AVAILABLE,
                    gross_return=delayed_gross,
                    net_return=ratio_subtract(delayed_gross, scenario.total_cost_ratio),
                    opportunity_decay=ratio_subtract(immediate_gross, delayed_gross),
                    censor_time_ns=None,
                )
            )
    return tuple(outcomes)


def _quote_spread(point: QuotePointV1) -> ExactRatioV1:
    bid = scaled_to_aligned(point.bid)
    ask = scaled_to_aligned(point.ask)
    return make_ratio(2 * (ask - bid), ask + bid)


def _spread_outcomes(
    window: _Window,
    sample: SampleIdentityV1,
) -> tuple[SpreadOutcomeV1, ...]:
    outcomes: list[SpreadOutcomeV1] = []
    series = window.series
    reference: QuotePointV1 | None = None
    if series.kind is SeriesKind.EXECUTABLE_QUOTES:
        candidate = series.last_quote_at_or_before(sample.label_start_ns)
        if candidate is not None and (
            sample.label_start_ns - candidate.event_time_ns
            <= window.definition.max_reference_staleness_ns
        ):
            reference = candidate
    for horizon in window.definition.horizons_ns:
        if reference is None or horizon > sample.horizon_ns:
            outcomes.append(
                SpreadOutcomeV1(
                    horizon_ns=horizon,
                    status=OutcomeStatus.UNAVAILABLE,
                    entry_spread=None,
                    exit_spread=None,
                    spread_change=None,
                    executable_return=None,
                    censor_time_ns=None,
                )
            )
            continue
        target = sample.label_start_ns + horizon
        status, censor = window.target_state(sample.label_start_ns, target)
        if status is not OutcomeStatus.AVAILABLE:
            outcomes.append(
                SpreadOutcomeV1(
                    horizon_ns=horizon,
                    status=status,
                    entry_spread=None,
                    exit_spread=None,
                    spread_change=None,
                    executable_return=None,
                    censor_time_ns=censor if status is OutcomeStatus.CENSORED else None,
                )
            )
            continue
        exit_point = reference
        for point in series.quote_points:
            if point.event_time_ns > target:
                break
            exit_point = point
        entry_spread = _quote_spread(reference)
        exit_spread = _quote_spread(exit_point)
        outcomes.append(
            SpreadOutcomeV1(
                horizon_ns=horizon,
                status=OutcomeStatus.AVAILABLE,
                entry_spread=entry_spread,
                exit_spread=exit_spread,
                spread_change=ratio_subtract(exit_spread, entry_spread),
                executable_return=make_ratio(
                    scaled_to_aligned(exit_point.bid) - scaled_to_aligned(reference.ask),
                    scaled_to_aligned(reference.ask),
                ),
                censor_time_ns=None,
            )
        )
    return tuple(outcomes)


def _combine_status(left: OutcomeStatus, right: OutcomeStatus) -> OutcomeStatus:
    for status in (
        OutcomeStatus.DATA_INVALID,
        OutcomeStatus.UNAVAILABLE,
        OutcomeStatus.CENSORED,
    ):
        if left is status or right is status:
            return status
    return OutcomeStatus.AVAILABLE


def _residual_outcomes(
    sample_horizons: tuple[HorizonOutcomeV1, ...],
    market_horizons: tuple[HorizonOutcomeV1, ...] | None,
) -> tuple[ResidualOutcomeV1, ...]:
    outcomes: list[ResidualOutcomeV1] = []
    for index, sample_outcome in enumerate(sample_horizons):
        market_outcome = None if market_horizons is None else market_horizons[index]
        if market_outcome is None:
            outcomes.append(
                ResidualOutcomeV1(
                    horizon_ns=sample_outcome.horizon_ns,
                    status=OutcomeStatus.UNAVAILABLE,
                    sample_return=None,
                    market_return=None,
                    residual_return=None,
                    censor_time_ns=None,
                )
            )
            continue
        status = _combine_status(sample_outcome.status, market_outcome.status)
        if (
            status is OutcomeStatus.AVAILABLE
            and sample_outcome.gross_return is not None
            and market_outcome.gross_return is not None
        ):
            outcomes.append(
                ResidualOutcomeV1(
                    horizon_ns=sample_outcome.horizon_ns,
                    status=OutcomeStatus.AVAILABLE,
                    sample_return=sample_outcome.gross_return,
                    market_return=market_outcome.gross_return,
                    residual_return=ratio_subtract(
                        sample_outcome.gross_return,
                        market_outcome.gross_return,
                    ),
                    censor_time_ns=None,
                )
            )
            continue
        censor: int | None = None
        if status is OutcomeStatus.CENSORED:
            censors = [
                value
                for value in (
                    sample_outcome.censor_time_ns,
                    market_outcome.censor_time_ns,
                )
                if value is not None
            ]
            censor = min(censors)
        outcomes.append(
            ResidualOutcomeV1(
                horizon_ns=sample_outcome.horizon_ns,
                status=status,
                sample_return=None,
                market_return=None,
                residual_return=None,
                censor_time_ns=censor,
            )
        )
    return tuple(outcomes)


def compute_sample_outcomes(
    sample: SampleIdentityV1,
    series: EvidenceSeriesV1,
    *,
    definition: OutcomeDefinitionV1,
    barriers: BarrierSpecV1,
    cost_scenarios: tuple[CostScenarioV1, ...],
    market_series: EvidenceSeriesV1 | None = None,
) -> SampleOutcomesV1:
    """Compute every §11.2 outcome the supplied evidence lawfully supports."""

    if not isinstance(sample, SampleIdentityV1):
        raise ContractValueError("sample must be SampleIdentityV1")
    if not isinstance(series, EvidenceSeriesV1):
        raise ContractValueError("series must be EvidenceSeriesV1")
    if not isinstance(definition, OutcomeDefinitionV1):
        raise ContractValueError("definition must be OutcomeDefinitionV1")
    if not isinstance(barriers, BarrierSpecV1):
        raise ContractValueError("barriers must be BarrierSpecV1")
    if (
        not isinstance(cost_scenarios, tuple)
        or not cost_scenarios
        or len(cost_scenarios) > MAX_COST_SCENARIOS
        or any(not isinstance(scenario, CostScenarioV1) for scenario in cost_scenarios)
    ):
        raise ContractValueError(
            f"cost_scenarios must be a tuple of 1..{MAX_COST_SCENARIOS} CostScenarioV1"
        )
    versions = tuple(scenario.scenario_version for scenario in cost_scenarios)
    if versions != tuple(sorted(set(versions))):
        raise ContractValueError("cost scenarios must be sorted by unique version")
    if series.symbol != sample.instrument.symbol:
        raise ContractValueError("series symbol does not match the sample instrument")
    if market_series is not None and not isinstance(market_series, EvidenceSeriesV1):
        raise ContractValueError("market_series must be EvidenceSeriesV1 or None")

    values = _series_values(series)
    window = _Window(series, values, definition, sample.label_start_ns)
    horizons = _horizon_outcomes(window, sample)
    market_horizons: tuple[HorizonOutcomeV1, ...] | None = None
    if market_series is not None:
        market_values = _series_values(market_series)
        market_window = _Window(market_series, market_values, definition, sample.label_start_ns)
        market_horizons = _horizon_outcomes(market_window, sample)
    excursion = _excursion_outcome(window, sample)
    first_passage = _first_passage_outcome(window, sample, barriers)
    costed = _costed_outcomes(window, sample, cost_scenarios)
    spreads = _spread_outcomes(window, sample)
    residuals = _residual_outcomes(horizons, market_horizons)
    series_digest = series.evidence_digest()
    pre_cutoff_digest = series.pre_cutoff_digest(sample.feature_cutoff_ns)
    core = _outcome_core_mapping(
        sample=sample,
        definition=definition,
        barriers=barriers,
        series_kind=series.kind,
        series_digest=series_digest,
        pre_cutoff_digest=pre_cutoff_digest,
        horizons=horizons,
        excursion=excursion,
        first_passage=first_passage,
        costed=costed,
        spreads=spreads,
        residuals=residuals,
    )
    return SampleOutcomesV1(
        outcome_id=derive_outcome_id(core),
        sample=sample,
        definition=definition,
        barriers=barriers,
        series_kind=series.kind,
        series_digest=series_digest,
        pre_cutoff_digest=pre_cutoff_digest,
        horizons=horizons,
        excursion=excursion,
        first_passage=first_passage,
        costed=costed,
        spreads=spreads,
        residuals=residuals,
        executable_capacity_status=OutcomeStatus.UNAVAILABLE,
        depth_deterioration_status=OutcomeStatus.UNAVAILABLE,
    )
