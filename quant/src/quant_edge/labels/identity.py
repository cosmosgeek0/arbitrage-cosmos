from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from typing import Final

from quant_edge.bootstrap.atlas import PointInTimeInstrumentV1
from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    require_contract_id,
    require_strict_int,
)

SAMPLE_SCHEMA: Final = "Q05SampleIdentityV1"
MIN_HORIZON_NS: Final = 1
MAX_HORIZON_NS: Final = 86_400_000_000_000


def _require_ns(value: object, *, field: str) -> int:
    return require_strict_int(value, field=field, minimum=UTC_NS_MIN, maximum=UTC_NS_MAX)


@dataclass(frozen=True, slots=True)
class VersionSetV1:
    """Every §11.1 version axis; changing any axis changes every derived identity."""

    dataset_version: str
    feature_version: str
    label_definition_version: str
    cost_assumption_version: str
    execution_assumption_version: str

    def __post_init__(self) -> None:
        for name in (
            "dataset_version",
            "feature_version",
            "label_definition_version",
            "cost_assumption_version",
            "execution_assumption_version",
        ):
            require_contract_id(getattr(self, name), field=name)

    def as_mapping(self) -> dict[str, object]:
        return {
            "costAssumptionVersion": self.cost_assumption_version,
            "datasetVersion": self.dataset_version,
            "executionAssumptionVersion": self.execution_assumption_version,
            "featureVersion": self.feature_version,
            "labelDefinitionVersion": self.label_definition_version,
        }


@dataclass(frozen=True, slots=True)
class SampleIdentityV1:
    sample_id: str
    event_id: str
    cohort_id: str
    instrument: PointInTimeInstrumentV1
    feature_lookback_start_ns: int
    feature_cutoff_ns: int
    label_start_ns: int
    label_end_ns: int
    horizon_ns: int
    source_completeness_start_ns: int
    source_completeness_end_ns: int
    versions: VersionSetV1

    def __post_init__(self) -> None:
        require_contract_id(self.event_id, field="event_id")
        require_contract_id(self.cohort_id, field="cohort_id")
        if not isinstance(self.instrument, PointInTimeInstrumentV1):
            raise ContractValueError("instrument must be PointInTimeInstrumentV1")
        lookback = _require_ns(self.feature_lookback_start_ns, field="feature_lookback_start_ns")
        cutoff = _require_ns(self.feature_cutoff_ns, field="feature_cutoff_ns")
        start = _require_ns(self.label_start_ns, field="label_start_ns")
        end = _require_ns(self.label_end_ns, field="label_end_ns")
        require_strict_int(
            self.horizon_ns,
            field="horizon_ns",
            minimum=MIN_HORIZON_NS,
            maximum=MAX_HORIZON_NS,
        )
        completeness_start = _require_ns(
            self.source_completeness_start_ns,
            field="source_completeness_start_ns",
        )
        completeness_end = _require_ns(
            self.source_completeness_end_ns,
            field="source_completeness_end_ns",
        )
        if not lookback < cutoff:
            raise ContractValueError("feature lookback must begin before the feature cutoff")
        if not cutoff <= start:
            raise ContractValueError("the label interval cannot begin before the feature cutoff")
        if not start < end:
            raise ContractValueError("the label interval must be non-empty")
        if end - start != self.horizon_ns:
            raise ContractValueError("horizon must equal the exact label interval length")
        if completeness_start > lookback or completeness_end < end:
            raise ContractValueError(
                "the source completeness interval must cover lookback through label end"
            )
        if not isinstance(self.versions, VersionSetV1):
            raise ContractValueError("versions must be VersionSetV1")
        expected = derive_sample_id(
            event_id=self.event_id,
            cohort_id=self.cohort_id,
            instrument=self.instrument,
            feature_lookback_start_ns=lookback,
            feature_cutoff_ns=cutoff,
            label_start_ns=start,
            label_end_ns=end,
            source_completeness_start_ns=completeness_start,
            source_completeness_end_ns=completeness_end,
            versions=self.versions,
        )
        if self.sample_id != expected:
            raise ContractValueError("sample_id disagrees with the derived sample identity")

    def as_mapping(self) -> dict[str, object]:
        return {
            "cohortId": self.cohort_id,
            "eventId": self.event_id,
            "featureCutoffNs": str(self.feature_cutoff_ns),
            "featureLookbackStartNs": str(self.feature_lookback_start_ns),
            "horizonNs": str(self.horizon_ns),
            "instrument": self.instrument.as_mapping(),
            "labelEndNs": str(self.label_end_ns),
            "labelStartNs": str(self.label_start_ns),
            "sampleId": self.sample_id,
            "schema": SAMPLE_SCHEMA,
            "sourceCompletenessEndNs": str(self.source_completeness_end_ns),
            "sourceCompletenessStartNs": str(self.source_completeness_start_ns),
            "version": 1,
            "versions": self.versions.as_mapping(),
        }


def derive_sample_id(
    *,
    event_id: str,
    cohort_id: str,
    instrument: PointInTimeInstrumentV1,
    feature_lookback_start_ns: int,
    feature_cutoff_ns: int,
    label_start_ns: int,
    label_end_ns: int,
    source_completeness_start_ns: int,
    source_completeness_end_ns: int,
    versions: VersionSetV1,
) -> str:
    if not isinstance(instrument, PointInTimeInstrumentV1):
        raise ContractValueError("instrument must be PointInTimeInstrumentV1")
    if not isinstance(versions, VersionSetV1):
        raise ContractValueError("versions must be VersionSetV1")
    identity = {
        "cohortId": cohort_id,
        "eventId": event_id,
        "featureCutoffNs": str(feature_cutoff_ns),
        "featureLookbackStartNs": str(feature_lookback_start_ns),
        "instrument": instrument.as_mapping(),
        "labelEndNs": str(label_end_ns),
        "labelStartNs": str(label_start_ns),
        "schema": SAMPLE_SCHEMA,
        "sourceCompletenessEndNs": str(source_completeness_end_ns),
        "sourceCompletenessStartNs": str(source_completeness_start_ns),
        "version": 1,
        "versions": versions.as_mapping(),
    }
    return f"q05sample:{hashlib.sha256(canonical_json_bytes(identity)).hexdigest()}"


def make_sample_identity(
    *,
    event_id: str,
    cohort_id: str,
    instrument: PointInTimeInstrumentV1,
    feature_lookback_start_ns: int,
    feature_cutoff_ns: int,
    label_start_ns: int,
    label_end_ns: int,
    source_completeness_start_ns: int,
    source_completeness_end_ns: int,
    versions: VersionSetV1,
) -> SampleIdentityV1:
    sample_id = derive_sample_id(
        event_id=event_id,
        cohort_id=cohort_id,
        instrument=instrument,
        feature_lookback_start_ns=feature_lookback_start_ns,
        feature_cutoff_ns=feature_cutoff_ns,
        label_start_ns=label_start_ns,
        label_end_ns=label_end_ns,
        source_completeness_start_ns=source_completeness_start_ns,
        source_completeness_end_ns=source_completeness_end_ns,
        versions=versions,
    )
    return SampleIdentityV1(
        sample_id=sample_id,
        event_id=event_id,
        cohort_id=cohort_id,
        instrument=instrument,
        feature_lookback_start_ns=feature_lookback_start_ns,
        feature_cutoff_ns=feature_cutoff_ns,
        label_start_ns=label_start_ns,
        label_end_ns=label_end_ns,
        horizon_ns=label_end_ns - label_start_ns,
        source_completeness_start_ns=source_completeness_start_ns,
        source_completeness_end_ns=source_completeness_end_ns,
        versions=versions,
    )


def with_cost_version(sample: SampleIdentityV1, cost_assumption_version: str) -> SampleIdentityV1:
    """A cost-assumption change is a new label version identity, never an edit."""

    if not isinstance(sample, SampleIdentityV1):
        raise ContractValueError("sample must be SampleIdentityV1")
    versions = replace(sample.versions, cost_assumption_version=cost_assumption_version)
    return make_sample_identity(
        event_id=sample.event_id,
        cohort_id=sample.cohort_id,
        instrument=sample.instrument,
        feature_lookback_start_ns=sample.feature_lookback_start_ns,
        feature_cutoff_ns=sample.feature_cutoff_ns,
        label_start_ns=sample.label_start_ns,
        label_end_ns=sample.label_end_ns,
        source_completeness_start_ns=sample.source_completeness_start_ns,
        source_completeness_end_ns=sample.source_completeness_end_ns,
        versions=versions,
    )
