"""Stratified discrete-time cause-specific hazard model (transparent baseline).

The fitted state is nothing but integer sufficient statistics: per stratum, per
grid bin, per cause — event counts, censoring counts and risk-set sizes. The
documented smoothing law is Laplace over the bin's outcome simplex::

    hazard_k  = (d_k + a) / (n + (K + 1) * a)
    survive   = (n - sum_k d_k + a) / (n + (K + 1) * a)

so the K cause hazards plus the survive-the-bin probability sum to one exactly.
Predictions multiply exact per-bin survive factors and accumulate exact
cause incidences, quantized half-even only at the contract boundary. A subject
censored inside a bin is treated as censored at the bin's end (at risk for the
whole bin); durations beyond the grid are administratively censored at grid end
and counted. Unseen strata and bins whose risk set falls below the declared
minimum yield explicit ``UNKNOWN`` — never a fabricated hazard.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from fractions import Fraction
from typing import cast

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.survival.contracts import (
    MAX_SUBJECTS,
    CauseSetV1,
    SurvivalCohortV1,
    TimeGridV1,
    fraction_to_fixed_point,
)
from quant_edge.survival.km import ONE

MAX_SMOOTHING = 1_000


class PredictionStatus(StrEnum):
    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class HazardModelConfigV1:
    """Versioned model law: grid, causes, smoothing and the minimum risk set."""

    model_version: str
    grid: TimeGridV1
    causes: CauseSetV1
    smoothing: ExactRatioV1
    min_risk_set: int

    def __post_init__(self) -> None:
        require_contract_id(self.model_version, field="model_version")
        if not isinstance(self.grid, TimeGridV1):
            raise ContractValueError("grid must be TimeGridV1")
        if not isinstance(self.causes, CauseSetV1):
            raise ContractValueError("causes must be CauseSetV1")
        if not isinstance(self.smoothing, ExactRatioV1):
            raise ContractValueError("smoothing must be ExactRatioV1")
        if self.smoothing.is_negative or self.smoothing.numerator > MAX_SMOOTHING * (
            self.smoothing.denominator
        ):
            raise ContractValueError(f"smoothing must lie inside [0, {MAX_SMOOTHING}]")
        require_strict_int(self.min_risk_set, field="min_risk_set", minimum=1, maximum=MAX_SUBJECTS)

    def as_mapping(self) -> dict[str, object]:
        return {
            "causes": self.causes.as_mapping(),
            "grid": self.grid.as_mapping(),
            "minRiskSet": self.min_risk_set,
            "modelVersion": self.model_version,
            "smoothing": self.smoothing.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class StratumBinV1:
    """Integer sufficient statistics of one stratum inside one grid bin."""

    bin_index: int
    end_ns: int
    at_risk: int
    events: tuple[int, ...]
    censored: int

    def __post_init__(self) -> None:
        require_strict_int(self.bin_index, field="bin_index", minimum=0)
        require_strict_int(self.end_ns, field="end_ns", minimum=1)
        require_strict_int(self.at_risk, field="at_risk", minimum=0)
        if not isinstance(self.events, tuple) or not self.events:
            raise ContractValueError("events must be a non-empty tuple")
        for index, count in enumerate(self.events):
            require_strict_int(count, field=f"events[{index}]", minimum=0)
        require_strict_int(self.censored, field="censored", minimum=0)
        if sum(self.events) + self.censored > self.at_risk:
            raise ContractValueError("departures cannot exceed the bin risk set")

    @property
    def total_events(self) -> int:
        return sum(self.events)

    def as_mapping(self) -> dict[str, object]:
        return {
            "atRisk": self.at_risk,
            "binIndex": self.bin_index,
            "censored": self.censored,
            "endNs": str(self.end_ns),
            "events": list(self.events),
        }


@dataclass(frozen=True, slots=True)
class StratumTableV1:
    """All fitted state for one stratum; counts only, never fitted floats."""

    stratum_id: str
    subjects: int
    beyond_grid: int
    bins: tuple[StratumBinV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.stratum_id, field="stratum_id")
        require_strict_int(self.subjects, field="subjects", minimum=1, maximum=MAX_SUBJECTS)
        require_strict_int(self.beyond_grid, field="beyond_grid", minimum=0)
        if not isinstance(self.bins, tuple) or not self.bins:
            raise ContractValueError("bins must be a non-empty tuple")
        for index, stratum_bin in enumerate(self.bins):
            if not isinstance(stratum_bin, StratumBinV1):
                raise ContractValueError(f"bins[{index}] must be StratumBinV1")
            if stratum_bin.bin_index != index:
                raise ContractValueError("bins must be dense and ordered by index")

    def as_mapping(self) -> dict[str, object]:
        return {
            "beyondGrid": self.beyond_grid,
            "bins": [stratum_bin.as_mapping() for stratum_bin in self.bins],
            "stratumId": self.stratum_id,
            "subjects": self.subjects,
        }


@dataclass(frozen=True, slots=True)
class PredictedBinV1:
    """Quantized per-bin prediction; UNKNOWN carries no numbers at all."""

    bin_index: int
    end_ns: int
    status: PredictionStatus
    hazards: tuple[FixedPointV1, ...] | None
    survival: FixedPointV1 | None
    incidence: tuple[FixedPointV1, ...] | None

    def __post_init__(self) -> None:
        require_strict_int(self.bin_index, field="bin_index", minimum=0)
        require_strict_int(self.end_ns, field="end_ns", minimum=1)
        if not isinstance(self.status, PredictionStatus):
            raise ContractValueError("status must be PredictionStatus")
        known = self.status is PredictionStatus.KNOWN
        values_present = (
            self.hazards is not None and self.survival is not None and self.incidence is not None
        )
        values_absent = self.hazards is None and self.survival is None and self.incidence is None
        if known and not values_present:
            raise ContractValueError("KNOWN bins must carry hazards, survival and incidence")
        if not known and not values_absent:
            raise ContractValueError("UNKNOWN bins must carry no numbers")

    def as_mapping(self) -> dict[str, object]:
        return {
            "binIndex": self.bin_index,
            "endNs": str(self.end_ns),
            "hazards": None
            if self.hazards is None
            else [value.as_mapping() for value in self.hazards],
            "incidence": None
            if self.incidence is None
            else [value.as_mapping() for value in self.incidence],
            "status": self.status.value,
            "survival": None if self.survival is None else self.survival.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class StratumPredictionV1:
    """Survival curve and cause incidences for one stratum over the model grid."""

    stratum_id: str
    grid: TimeGridV1
    known_bins: int
    bins: tuple[PredictedBinV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.stratum_id, field="stratum_id")
        if not isinstance(self.grid, TimeGridV1):
            raise ContractValueError("grid must be TimeGridV1")
        if not isinstance(self.bins, tuple) or len(self.bins) != self.grid.bin_count:
            raise ContractValueError("predictions must cover every grid bin")
        require_strict_int(self.known_bins, field="known_bins", minimum=0, maximum=len(self.bins))
        for index, predicted in enumerate(self.bins):
            if not isinstance(predicted, PredictedBinV1):
                raise ContractValueError(f"bins[{index}] must be PredictedBinV1")
            if predicted.bin_index != index:
                raise ContractValueError("prediction bins must be dense and ordered")
            expected = (
                PredictionStatus.KNOWN if index < self.known_bins else PredictionStatus.UNKNOWN
            )
            if predicted.status is not expected:
                raise ContractValueError("KNOWN bins must form a prefix of the grid")

    def survival_at(self, horizon_ns: int) -> FixedPointV1 | None:
        """Survival at an on-grid horizon; None once the model is UNKNOWN there."""

        index = self.grid.index_of_time(horizon_ns)
        if index >= self.known_bins:
            return None
        return self.bins[index].survival

    def event_probability_at(self, cause_id_index: int, horizon_ns: int) -> FixedPointV1 | None:
        """Cause CIF at an on-grid horizon; None once the model is UNKNOWN there."""

        index = self.grid.index_of_time(horizon_ns)
        if index >= self.known_bins:
            return None
        incidence = cast(tuple[FixedPointV1, ...], self.bins[index].incidence)
        require_strict_int(
            cause_id_index,
            field="cause_id_index",
            minimum=0,
            maximum=len(incidence) - 1,
        )
        return incidence[cause_id_index]

    def as_mapping(self) -> dict[str, object]:
        return {
            "bins": [predicted.as_mapping() for predicted in self.bins],
            "gridId": self.grid.grid_id,
            "knownBins": self.known_bins,
            "stratumId": self.stratum_id,
        }


@dataclass(frozen=True, slots=True)
class DiscreteHazardModelV1:
    """Fitted model: the config plus one integer table per observed stratum."""

    config: HazardModelConfigV1
    strata: tuple[StratumTableV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.config, HazardModelConfigV1):
            raise ContractValueError("config must be HazardModelConfigV1")
        if not isinstance(self.strata, tuple) or not self.strata:
            raise ContractValueError("strata must be a non-empty tuple")
        previous = ""
        for index, table in enumerate(self.strata):
            if not isinstance(table, StratumTableV1):
                raise ContractValueError(f"strata[{index}] must be StratumTableV1")
            if table.stratum_id <= previous:
                raise ContractValueError("strata must be strictly sorted by id")
            previous = table.stratum_id
            if len(table.bins) != self.config.grid.bin_count:
                raise ContractValueError("stratum tables must cover every grid bin")
            for stratum_bin in table.bins:
                if len(stratum_bin.events) != len(self.config.causes.cause_ids):
                    raise ContractValueError("bin events must align with the cause set")

    def stratum(self, stratum_id: str) -> StratumTableV1 | None:
        require_contract_id(stratum_id, field="stratum_id")
        for table in self.strata:
            if table.stratum_id == stratum_id:
                return table
        return None

    def predict(self, stratum_id: str) -> StratumPredictionV1 | None:
        """Predict for one stratum; None for a stratum the model never saw."""

        table = self.stratum(stratum_id)
        if table is None:
            return None
        alpha = Fraction(self.config.smoothing.numerator, self.config.smoothing.denominator)
        cause_count = len(self.config.causes.cause_ids)
        survival = ONE
        incidence = [Fraction(0)] * cause_count
        bins: list[PredictedBinV1] = []
        known_bins = 0
        unknown_from_here = False
        for stratum_bin in table.bins:
            if not unknown_from_here and stratum_bin.at_risk < self.config.min_risk_set:
                unknown_from_here = True
            if unknown_from_here:
                bins.append(
                    PredictedBinV1(
                        bin_index=stratum_bin.bin_index,
                        end_ns=stratum_bin.end_ns,
                        status=PredictionStatus.UNKNOWN,
                        hazards=None,
                        survival=None,
                        incidence=None,
                    )
                )
                continue
            denominator = stratum_bin.at_risk + (cause_count + 1) * alpha
            hazards = [
                Fraction(stratum_bin.events[cause_index] + alpha, denominator)
                for cause_index in range(cause_count)
            ]
            survive = Fraction(stratum_bin.at_risk - stratum_bin.total_events + alpha, denominator)
            for cause_index in range(cause_count):
                incidence[cause_index] += survival * hazards[cause_index]
            survival *= survive
            known_bins += 1
            bins.append(
                PredictedBinV1(
                    bin_index=stratum_bin.bin_index,
                    end_ns=stratum_bin.end_ns,
                    status=PredictionStatus.KNOWN,
                    hazards=tuple(fraction_to_fixed_point(value) for value in hazards),
                    survival=fraction_to_fixed_point(survival),
                    incidence=tuple(fraction_to_fixed_point(value) for value in incidence),
                )
            )
        return StratumPredictionV1(
            stratum_id=stratum_id,
            grid=self.config.grid,
            known_bins=known_bins,
            bins=tuple(bins),
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "config": self.config.as_mapping(),
            "strata": [table.as_mapping() for table in self.strata],
        }


@dataclass(slots=True)
class _StratumAccumulator:
    subjects: int = 0
    beyond: int = 0
    at_risk: list[int] = field(default_factory=list)
    events: list[list[int]] = field(default_factory=list)
    censored: list[int] = field(default_factory=list)


def fit_discrete_hazard(
    cohort: SurvivalCohortV1,
    config: HazardModelConfigV1,
) -> DiscreteHazardModelV1:
    """Aggregate the cohort into per-stratum integer tables under the binning law."""

    if not isinstance(cohort, SurvivalCohortV1):
        raise ContractValueError("cohort must be SurvivalCohortV1")
    if not isinstance(config, HazardModelConfigV1):
        raise ContractValueError("config must be HazardModelConfigV1")
    if cohort.causes != config.causes:
        raise ContractValueError("cohort and config must share one cause set")
    grid = config.grid
    cause_count = len(config.causes.cause_ids)
    per_stratum: dict[str, _StratumAccumulator] = {}
    for subject in cohort.subjects:
        state = per_stratum.get(subject.stratum_id)
        if state is None:
            state = _StratumAccumulator(
                at_risk=[0] * grid.bin_count,
                events=[[0] * cause_count for _ in range(grid.bin_count)],
                censored=[0] * grid.bin_count,
            )
            per_stratum[subject.stratum_id] = state
        state.subjects += 1
        bin_index = grid.bin_index(subject.duration_ns)
        if bin_index is None:
            state.beyond += 1
            last_bin = grid.bin_count - 1
        else:
            last_bin = bin_index
        for index in range(last_bin + 1):
            state.at_risk[index] += 1
        if bin_index is not None:
            if subject.cause_id is None:
                state.censored[bin_index] += 1
            else:
                state.events[bin_index][config.causes.index_of(subject.cause_id)] += 1
    strata: list[StratumTableV1] = []
    for stratum_id in sorted(per_stratum):
        state = per_stratum[stratum_id]
        bins = tuple(
            StratumBinV1(
                bin_index=index,
                end_ns=grid.times_ns[index],
                at_risk=state.at_risk[index],
                events=tuple(state.events[index]),
                censored=state.censored[index],
            )
            for index in range(grid.bin_count)
        )
        strata.append(
            StratumTableV1(
                stratum_id=stratum_id,
                subjects=state.subjects,
                beyond_grid=state.beyond,
                bins=bins,
            )
        )
    return DiscreteHazardModelV1(config=config, strata=tuple(strata))
