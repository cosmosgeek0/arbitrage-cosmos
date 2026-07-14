from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.labels.disposition import DispositionRecordV1, EventDisposition
from quant_edge.labels.identity import VersionSetV1
from quant_edge.labels.outcomes import SampleOutcomesV1
from quant_edge.labels.stages import StageAssignmentV1, StageLabel
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    require_contract_id,
    require_strict_int,
)
from quant_edge.primitives import require_utc_millis

MAX_MANIFEST_MEMBERS: Final = 100_000
MAX_GROUP_WINDOWS: Final = 100_000
OBJECTIVE_OUTCOME_OWNER: Final = "quantEdgeLabels"


@dataclass(frozen=True, slots=True)
class ObjectiveOutcomeReferenceV1:
    """The exact reference triple the accepted Q-E outcome-link contract consumes."""

    objective_outcome_owner: str
    objective_outcome_id: str
    objective_outcome_sha256: str
    objective_outcome_available_at_ms: int

    def __post_init__(self) -> None:
        if self.objective_outcome_owner != OBJECTIVE_OUTCOME_OWNER:
            raise ContractValueError("objective outcomes are owned by quantEdgeLabels")
        require_contract_id(self.objective_outcome_id, field="objective_outcome_id")
        if (
            not isinstance(self.objective_outcome_sha256, str)
            or len(self.objective_outcome_sha256) != 64
        ):
            raise ContractValueError("objective_outcome_sha256 must be a SHA-256 hex digest")
        require_utc_millis(
            self.objective_outcome_available_at_ms,
            field="objective_outcome_available_at_ms",
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "objectiveOutcomeAvailableAtMs": self.objective_outcome_available_at_ms,
            "objectiveOutcomeId": self.objective_outcome_id,
            "objectiveOutcomeOwner": self.objective_outcome_owner,
            "objectiveOutcomeSha256": self.objective_outcome_sha256,
        }


def outcome_reference(
    outcomes: SampleOutcomesV1,
    *,
    available_at_ms: int,
) -> ObjectiveOutcomeReferenceV1:
    if not isinstance(outcomes, SampleOutcomesV1):
        raise ContractValueError("outcomes must be SampleOutcomesV1")
    return ObjectiveOutcomeReferenceV1(
        objective_outcome_owner=OBJECTIVE_OUTCOME_OWNER,
        objective_outcome_id=outcomes.outcome_id,
        objective_outcome_sha256=outcomes.content_sha256,
        objective_outcome_available_at_ms=available_at_ms,
    )


@dataclass(frozen=True, slots=True)
class ManifestMemberV1:
    sample_id: str
    event_id: str
    cohort_id: str
    disposition: EventDisposition
    stage: StageLabel
    outcome_id: str
    outcome_sha256: str
    control_window_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.sample_id, field="sample_id")
        require_contract_id(self.event_id, field="event_id")
        require_contract_id(self.cohort_id, field="cohort_id")
        if not isinstance(self.disposition, EventDisposition):
            raise ContractValueError("disposition must be EventDisposition")
        if not isinstance(self.stage, StageLabel):
            raise ContractValueError("stage must be StageLabel")
        require_contract_id(self.outcome_id, field="outcome_id")
        if not isinstance(self.outcome_sha256, str) or len(self.outcome_sha256) != 64:
            raise ContractValueError("outcome_sha256 must be a SHA-256 hex digest")
        if not isinstance(self.control_window_ids, tuple) or (
            self.control_window_ids != tuple(sorted(set(self.control_window_ids)))
        ):
            raise ContractValueError("control window ids must be sorted and unique")

    def as_mapping(self) -> dict[str, object]:
        return {
            "cohortId": self.cohort_id,
            "controlWindowIds": list(self.control_window_ids),
            "disposition": self.disposition.value,
            "eventId": self.event_id,
            "outcomeId": self.outcome_id,
            "outcomeSha256": self.outcome_sha256,
            "sampleId": self.sample_id,
            "stage": self.stage.value,
        }


def make_manifest_member(
    *,
    outcomes: SampleOutcomesV1,
    disposition: DispositionRecordV1,
    stage: StageAssignmentV1,
    control_window_ids: tuple[str, ...],
) -> ManifestMemberV1:
    if not isinstance(outcomes, SampleOutcomesV1):
        raise ContractValueError("outcomes must be SampleOutcomesV1")
    if not isinstance(disposition, DispositionRecordV1):
        raise ContractValueError("disposition must be DispositionRecordV1")
    if not isinstance(stage, StageAssignmentV1):
        raise ContractValueError("stage must be StageAssignmentV1")
    if disposition.sample_id != outcomes.sample.sample_id:
        raise ContractValueError("disposition and outcomes describe different samples")
    return ManifestMemberV1(
        sample_id=outcomes.sample.sample_id,
        event_id=outcomes.sample.event_id,
        cohort_id=outcomes.sample.cohort_id,
        disposition=disposition.disposition,
        stage=stage.stage,
        outcome_id=outcomes.outcome_id,
        outcome_sha256=outcomes.content_sha256,
        control_window_ids=control_window_ids,
    )


@dataclass(frozen=True, slots=True)
class LabelManifestV1:
    """Reproducible cohort manifest: identical inputs rebuild identical bytes."""

    manifest_id: str
    versions: VersionSetV1
    match_version: str
    members: tuple[ManifestMemberV1, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.versions, VersionSetV1):
            raise ContractValueError("versions must be VersionSetV1")
        require_contract_id(self.match_version, field="match_version")
        if (
            not isinstance(self.members, tuple)
            or not self.members
            or len(self.members) > MAX_MANIFEST_MEMBERS
        ):
            raise ContractValueError(
                f"members must be a tuple of 1..{MAX_MANIFEST_MEMBERS} manifest members"
            )
        for member in self.members:
            if not isinstance(member, ManifestMemberV1):
                raise ContractValueError("members must be ManifestMemberV1")
        sample_ids = [member.sample_id for member in self.members]
        if sample_ids != sorted(set(sample_ids)):
            raise ContractValueError("members must be sorted by unique sample id")
        expected = derive_manifest_id(
            versions=self.versions,
            match_version=self.match_version,
            members=self.members,
        )
        if self.manifest_id != expected:
            raise ContractValueError("manifest_id disagrees with the derived identity")

    def core_mapping(self) -> dict[str, object]:
        disposition_counts: dict[str, int] = {}
        stage_counts: dict[str, int] = {}
        for member in self.members:
            key = member.disposition.value
            disposition_counts[key] = disposition_counts.get(key, 0) + 1
            stage_key = member.stage.value
            stage_counts[stage_key] = stage_counts.get(stage_key, 0) + 1
        return {
            "dispositionCounts": dict(sorted(disposition_counts.items())),
            "matchVersion": self.match_version,
            "members": [member.as_mapping() for member in self.members],
            "schema": "Q05LabelManifestV1",
            "stageCounts": dict(sorted(stage_counts.items())),
            "version": 1,
            "versions": self.versions.as_mapping(),
        }

    def as_mapping(self) -> dict[str, object]:
        mapping = self.core_mapping()
        mapping["manifestId"] = self.manifest_id
        return mapping

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def content_digest(self) -> DigestV1:
        return DigestV1(hashlib.sha256(self.canonical_bytes()).hexdigest())


def derive_manifest_id(
    *,
    versions: VersionSetV1,
    match_version: str,
    members: tuple[ManifestMemberV1, ...],
) -> str:
    mapping = {
        "matchVersion": match_version,
        "members": [member.as_mapping() for member in members],
        "schema": "Q05LabelManifestV1",
        "version": 1,
        "versions": versions.as_mapping(),
    }
    return f"q05manifest:{hashlib.sha256(canonical_json_bytes(mapping)).hexdigest()}"


def build_label_manifest(
    *,
    versions: VersionSetV1,
    match_version: str,
    members: tuple[ManifestMemberV1, ...],
) -> LabelManifestV1:
    ordered = tuple(sorted(members, key=lambda member: member.sample_id))
    return LabelManifestV1(
        manifest_id=derive_manifest_id(
            versions=versions,
            match_version=match_version,
            members=ordered,
        ),
        versions=versions,
        match_version=match_version,
        members=ordered,
    )


@dataclass(frozen=True, slots=True)
class GroupWindowV1:
    window_id: str
    symbol: str
    start_ns: int
    end_ns: int

    def __post_init__(self) -> None:
        require_contract_id(self.window_id, field="window_id")
        require_contract_id(self.symbol, field="symbol")
        start = require_strict_int(
            self.start_ns,
            field="start_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        end = require_strict_int(
            self.end_ns,
            field="end_ns",
            minimum=UTC_NS_MIN,
            maximum=UTC_NS_MAX,
        )
        if start >= end:
            raise ContractValueError("window start must precede window end")


def assign_evaluation_groups(
    windows: tuple[GroupWindowV1, ...],
    *,
    adjacency_gap_ns: int,
) -> dict[str, str]:
    """Group same-symbol windows whose intervals touch within the adjacency gap.

    Adjacent windows of one market episode share one evaluation group, so no split of
    an event can leak across a validation boundary (§11.7).
    """

    if (
        not isinstance(windows, tuple)
        or len(windows) > MAX_GROUP_WINDOWS
        or any(not isinstance(window, GroupWindowV1) for window in windows)
    ):
        raise ContractValueError("windows must be a bounded tuple of GroupWindowV1")
    require_strict_int(adjacency_gap_ns, field="adjacency_gap_ns", minimum=0)
    window_ids = [window.window_id for window in windows]
    if len(set(window_ids)) != len(window_ids):
        raise ContractValueError("window ids must be unique")

    assignments: dict[str, str] = {}
    by_symbol: dict[str, list[GroupWindowV1]] = {}
    for window in windows:
        by_symbol.setdefault(window.symbol, []).append(window)
    for symbol_windows in by_symbol.values():
        ordered = sorted(
            symbol_windows,
            key=lambda window: (window.start_ns, window.end_ns, window.window_id),
        )
        group: list[GroupWindowV1] = []
        group_end = 0
        for window in ordered:
            if group and window.start_ns > group_end + adjacency_gap_ns:
                _seal_group(group, assignments)
                group = []
            group.append(window)
            group_end = max(group_end, window.end_ns)
        _seal_group(group, assignments)
    return assignments


def _seal_group(group: list[GroupWindowV1], assignments: dict[str, str]) -> None:
    identity = {
        "schema": "Q05EvaluationGroupV1",
        "version": 1,
        "windowIds": sorted(window.window_id for window in group),
    }
    group_id = f"q05group:{hashlib.sha256(canonical_json_bytes(identity)).hexdigest()}"
    for window in group:
        assignments[window.window_id] = group_id
