from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum

from research.dq5.contracts import (
    Candidate,
    OpenEvent,
    Registration,
    Registry,
    Window,
    WindowRole,
    locate_candidate_pending_record,
    parse_candidate,
    parse_registry,
    validate_registry_event_references,
)

from quant_edge.canonical import canonical_json_bytes

REPORT_SCHEMA_VERSION = "DQ5_REPORT_V1"
MAX_DETAILED_FINDINGS = 4_096


class Dq5ReasonCode(StrEnum):
    REGISTRY_HISTORY_INCOMPLETE = "DQ5_REGISTRY_HISTORY_INCOMPLETE"
    VALIDATION_CAPACITY_EXCEEDED = "DQ5_VALIDATION_CAPACITY_EXCEEDED"
    RESEARCH_ID_REUSED = "DQ5_RESEARCH_ID_REUSED"
    CORPUS_NOT_REGISTERED = "DQ5_CORPUS_NOT_REGISTERED"
    CANDIDATE_DEVELOPMENT_HOLDOUT_OVERLAP = "DQ5_CANDIDATE_DEVELOPMENT_HOLDOUT_OVERLAP"
    CORPUS_WINDOW_OVERLAP = "DQ5_CORPUS_WINDOW_OVERLAP"
    CORPUS_WINDOW_REUSED_ACROSS_FAMILY = "DQ5_CORPUS_WINDOW_REUSED_ACROSS_FAMILY"
    SEALED_ARTIFACT_REUSED = "DQ5_SEALED_ARTIFACT_REUSED"
    SEALED_ARTIFACT_REUSED_ACROSS_FAMILY = "DQ5_SEALED_ARTIFACT_REUSED_ACROSS_FAMILY"
    HOLDOUT_ID_REUSED = "DQ5_HOLDOUT_ID_REUSED"
    HOLDOUT_SHARED = "DQ5_HOLDOUT_SHARED"
    HOLDOUT_SHARED_ACROSS_FAMILY = "DQ5_HOLDOUT_SHARED_ACROSS_FAMILY"
    HOLDOUT_OPENED_OR_ATTEMPTED = "DQ5_HOLDOUT_OPENED_OR_ATTEMPTED"
    FRESH_HOLDOUT_REQUIRED = "DQ5_FRESH_HOLDOUT_REQUIRED"
    FRESH_HOLDOUT_CLAIM_FALSE = "DQ5_FRESH_HOLDOUT_CLAIM_FALSE"


class ValidationStatus(StrEnum):
    ELIGIBLE_FOR_INTAKE = "ELIGIBLE_FOR_INTAKE"
    REJECTED = "REJECTED"


@dataclass(frozen=True, slots=True)
class Finding:
    code: Dq5ReasonCode
    candidate_research_id: str
    candidate_window_id: str | None = None
    conflicting_research_id: str | None = None
    conflicting_window_id: str | None = None
    holdout_id: str | None = None
    overlap_start_ms: int | None = None
    overlap_end_ms: int | None = None

    @property
    def sort_key(self) -> tuple[object, ...]:
        return (
            self.code.value,
            self.candidate_research_id,
            self.candidate_window_id or "",
            self.conflicting_research_id or "",
            self.conflicting_window_id or "",
            self.holdout_id or "",
            self.overlap_start_ms if self.overlap_start_ms is not None else -1,
            self.overlap_end_ms if self.overlap_end_ms is not None else -1,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "candidateResearchId": self.candidate_research_id,
            "candidateWindowId": self.candidate_window_id,
            "code": self.code.value,
            "conflictingResearchId": self.conflicting_research_id,
            "conflictingWindowId": self.conflicting_window_id,
            "holdoutId": self.holdout_id,
            "overlapEndMs": self.overlap_end_ms,
            "overlapStartMs": self.overlap_start_ms,
        }


@dataclass(frozen=True, slots=True)
class ValidationReport:
    registry_sha256: str
    registry_custody_receipt_sha256: str
    candidate_sha256: str
    status: ValidationStatus
    reason_codes: tuple[Dq5ReasonCode, ...]
    findings: tuple[Finding, ...]
    registry_registration_count: int
    registry_pending_registration_count: int
    registry_corpus_count: int
    registry_window_count: int
    candidate_window_count: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "authority": "NONE",
            "candidateSha256": self.candidate_sha256,
            "findings": [finding.as_mapping() for finding in self.findings],
            "reasonCodes": [code.value for code in self.reason_codes],
            "registryCustodyReceiptSha256": self.registry_custody_receipt_sha256,
            "registrySha256": self.registry_sha256,
            "schemaVersion": REPORT_SCHEMA_VERSION,
            "status": self.status.value,
            "summary": {
                "candidateWindowCount": self.candidate_window_count,
                "registryCorpusCount": self.registry_corpus_count,
                "registryPendingRegistrationCount": (self.registry_pending_registration_count),
                "registryRegistrationCount": self.registry_registration_count,
                "registryWindowCount": self.registry_window_count,
            },
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())


class _FindingCollector:
    def __init__(self) -> None:
        self._detailed: set[Finding] = set()
        self.capacity_exceeded = False

    def add(self, finding: Finding) -> None:
        if finding in self._detailed:
            return
        if len(self._detailed) >= MAX_DETAILED_FINDINGS:
            self.capacity_exceeded = True
            return
        self._detailed.add(finding)

    def finish(self, *aggregate: Finding) -> tuple[Finding, ...]:
        findings = set(self._detailed)
        findings.update(aggregate)
        return tuple(sorted(findings, key=lambda finding: finding.sort_key))


def _overlap_bounds(left: Window, right: Window) -> tuple[int, int] | None:
    if left.corpus != right.corpus:
        return None
    start_ms = max(left.start_ms, right.start_ms)
    end_ms = min(left.end_ms, right.end_ms)
    if start_ms >= end_ms:
        return None
    return start_ms, end_ms


def _opened_holdouts(events: tuple[OpenEvent, ...]) -> frozenset[tuple[str, str]]:
    return frozenset((event.research_id, event.holdout_id) for event in events)


def _history_by_corpus(
    registrations: tuple[Registration, ...],
) -> dict[tuple[str, str, str, str], list[tuple[Registration, Window]]]:
    result: dict[
        tuple[str, str, str, str],
        list[tuple[Registration, Window]],
    ] = {}
    for registration in registrations:
        for window in registration.windows:
            result.setdefault(window.corpus.key, []).append((registration, window))
    for rows in result.values():
        rows.sort(
            key=lambda row: (
                row[1].start_ms,
                row[1].end_ms,
                row[0].research_id,
                row[1].sort_key,
            )
        )
    return result


def _history_by_artifact(
    registrations: tuple[Registration, ...],
) -> dict[str, list[tuple[Registration, Window]]]:
    result: dict[str, list[tuple[Registration, Window]]] = {}
    for registration in registrations:
        for window in registration.windows:
            result.setdefault(window.artifact_sha256, []).append((registration, window))
    for rows in result.values():
        rows.sort(key=lambda row: (row[0].research_id, row[1].sort_key))
    return result


def _add_internal_overlap_findings(
    collector: _FindingCollector,
    registration: Registration,
) -> bool:
    freshness_defeated = False
    windows = registration.windows
    for index, left in enumerate(windows):
        for right in windows[index + 1 :]:
            if right.corpus.key != left.corpus.key:
                if right.corpus.key > left.corpus.key:
                    break
                continue
            bounds = _overlap_bounds(left, right)
            if bounds is None or left.role is right.role:
                continue
            start_ms, end_ms = bounds
            collector.add(
                Finding(
                    code=Dq5ReasonCode.CANDIDATE_DEVELOPMENT_HOLDOUT_OVERLAP,
                    candidate_research_id=registration.research_id,
                    candidate_window_id=left.window_id,
                    conflicting_research_id=registration.research_id,
                    conflicting_window_id=right.window_id,
                    holdout_id=(
                        left.holdout_id if left.role is WindowRole.HOLDOUT else right.holdout_id
                    ),
                    overlap_start_ms=start_ms,
                    overlap_end_ms=end_ms,
                )
            )
            collector.add(
                Finding(
                    code=Dq5ReasonCode.CORPUS_WINDOW_OVERLAP,
                    candidate_research_id=registration.research_id,
                    candidate_window_id=left.window_id,
                    conflicting_research_id=registration.research_id,
                    conflicting_window_id=right.window_id,
                    holdout_id=(
                        left.holdout_id if left.role is WindowRole.HOLDOUT else right.holdout_id
                    ),
                    overlap_start_ms=start_ms,
                    overlap_end_ms=end_ms,
                )
            )
            freshness_defeated = True
    return freshness_defeated


def _add_internal_artifact_findings(
    collector: _FindingCollector,
    registration: Registration,
) -> bool:
    freshness_defeated = False
    by_artifact: dict[str, list[Window]] = {}
    for window in registration.windows:
        by_artifact.setdefault(window.artifact_sha256, []).append(window)
    for artifact_sha256 in sorted(by_artifact):
        windows = by_artifact[artifact_sha256]
        for index, left in enumerate(windows):
            for right in windows[index + 1 :]:
                collector.add(
                    Finding(
                        code=Dq5ReasonCode.SEALED_ARTIFACT_REUSED,
                        candidate_research_id=registration.research_id,
                        candidate_window_id=left.window_id,
                        conflicting_research_id=registration.research_id,
                        conflicting_window_id=right.window_id,
                        holdout_id=(
                            left.holdout_id if left.role is WindowRole.HOLDOUT else right.holdout_id
                        ),
                    )
                )
                if left.role is right.role:
                    continue
                collector.add(
                    Finding(
                        code=Dq5ReasonCode.HOLDOUT_SHARED,
                        candidate_research_id=registration.research_id,
                        candidate_window_id=left.window_id,
                        conflicting_research_id=registration.research_id,
                        conflicting_window_id=right.window_id,
                        holdout_id=(
                            left.holdout_id if left.role is WindowRole.HOLDOUT else right.holdout_id
                        ),
                    )
                )
                freshness_defeated = True
    return freshness_defeated


def _add_reused_holdout_findings(
    collector: _FindingCollector,
    comparison_registrations: tuple[Registration, ...],
    candidate: Candidate,
    opened: frozenset[tuple[str, str]],
) -> bool:
    freshness_defeated = False
    registration = candidate.registration
    for holdout_id in sorted(registration.holdout_ids):
        candidate_window = registration.first_window_for_holdout(holdout_id)
        for historical in comparison_registrations:
            if holdout_id not in historical.holdout_ids:
                continue
            historical_window = historical.first_window_for_holdout(holdout_id)
            collector.add(
                Finding(
                    code=Dq5ReasonCode.HOLDOUT_ID_REUSED,
                    candidate_research_id=registration.research_id,
                    candidate_window_id=candidate_window.window_id,
                    conflicting_research_id=historical.research_id,
                    conflicting_window_id=historical_window.window_id,
                    holdout_id=holdout_id,
                )
            )
            collector.add(
                Finding(
                    code=Dq5ReasonCode.HOLDOUT_SHARED,
                    candidate_research_id=registration.research_id,
                    candidate_window_id=candidate_window.window_id,
                    conflicting_research_id=historical.research_id,
                    conflicting_window_id=historical_window.window_id,
                    holdout_id=holdout_id,
                )
            )
            if registration.family_id != historical.family_id:
                collector.add(
                    Finding(
                        code=Dq5ReasonCode.HOLDOUT_SHARED_ACROSS_FAMILY,
                        candidate_research_id=registration.research_id,
                        candidate_window_id=candidate_window.window_id,
                        conflicting_research_id=historical.research_id,
                        conflicting_window_id=historical_window.window_id,
                        holdout_id=holdout_id,
                    )
                )
            freshness_defeated = True
            if (historical.research_id, holdout_id) in opened:
                collector.add(
                    Finding(
                        code=Dq5ReasonCode.HOLDOUT_OPENED_OR_ATTEMPTED,
                        candidate_research_id=registration.research_id,
                        candidate_window_id=candidate_window.window_id,
                        conflicting_research_id=historical.research_id,
                        conflicting_window_id=historical_window.window_id,
                        holdout_id=holdout_id,
                    )
                )
    return freshness_defeated


def _artifact_reuse_finding(
    *,
    code: Dq5ReasonCode,
    candidate: Registration,
    candidate_window: Window,
    historical: Registration,
    historical_window: Window,
    holdout_id: str | None,
) -> Finding:
    return Finding(
        code=code,
        candidate_research_id=candidate.research_id,
        candidate_window_id=candidate_window.window_id,
        conflicting_research_id=historical.research_id,
        conflicting_window_id=historical_window.window_id,
        holdout_id=holdout_id,
    )


def _add_artifact_reuse_findings(
    collector: _FindingCollector,
    comparison_registrations: tuple[Registration, ...],
    candidate: Candidate,
    opened: frozenset[tuple[str, str]],
) -> bool:
    freshness_defeated = False
    registration = candidate.registration
    history = _history_by_artifact(comparison_registrations)
    for candidate_window in registration.windows:
        for historical, historical_window in history.get(candidate_window.artifact_sha256, ()):
            collector.add(
                _artifact_reuse_finding(
                    code=Dq5ReasonCode.SEALED_ARTIFACT_REUSED,
                    candidate=registration,
                    candidate_window=candidate_window,
                    historical=historical,
                    historical_window=historical_window,
                    holdout_id=None,
                )
            )
            cross_family = registration.family_id != historical.family_id
            if cross_family:
                collector.add(
                    _artifact_reuse_finding(
                        code=Dq5ReasonCode.SEALED_ARTIFACT_REUSED_ACROSS_FAMILY,
                        candidate=registration,
                        candidate_window=candidate_window,
                        historical=historical,
                        historical_window=historical_window,
                        holdout_id=None,
                    )
                )

            shared_holdout_id: str | None = None
            if candidate_window.role is WindowRole.HOLDOUT:
                shared_holdout_id = candidate_window.holdout_id
            elif historical_window.role is WindowRole.HOLDOUT:
                shared_holdout_id = historical_window.holdout_id
            if shared_holdout_id is None:
                continue

            collector.add(
                _artifact_reuse_finding(
                    code=Dq5ReasonCode.HOLDOUT_SHARED,
                    candidate=registration,
                    candidate_window=candidate_window,
                    historical=historical,
                    historical_window=historical_window,
                    holdout_id=shared_holdout_id,
                )
            )
            if cross_family:
                collector.add(
                    _artifact_reuse_finding(
                        code=Dq5ReasonCode.HOLDOUT_SHARED_ACROSS_FAMILY,
                        candidate=registration,
                        candidate_window=candidate_window,
                        historical=historical,
                        historical_window=historical_window,
                        holdout_id=shared_holdout_id,
                    )
                )
            freshness_defeated = True
            if (
                historical_window.role is WindowRole.HOLDOUT
                and historical_window.holdout_id is not None
                and (historical.research_id, historical_window.holdout_id) in opened
            ):
                collector.add(
                    _artifact_reuse_finding(
                        code=Dq5ReasonCode.HOLDOUT_OPENED_OR_ATTEMPTED,
                        candidate=registration,
                        candidate_window=candidate_window,
                        historical=historical,
                        historical_window=historical_window,
                        holdout_id=historical_window.holdout_id,
                    )
                )
    return freshness_defeated


def _cross_registration_finding(
    *,
    code: Dq5ReasonCode,
    candidate: Registration,
    candidate_window: Window,
    historical: Registration,
    historical_window: Window,
    holdout_id: str | None,
    overlap_start_ms: int,
    overlap_end_ms: int,
) -> Finding:
    return Finding(
        code=code,
        candidate_research_id=candidate.research_id,
        candidate_window_id=candidate_window.window_id,
        conflicting_research_id=historical.research_id,
        conflicting_window_id=historical_window.window_id,
        holdout_id=holdout_id,
        overlap_start_ms=overlap_start_ms,
        overlap_end_ms=overlap_end_ms,
    )


def _add_cross_registration_findings(
    collector: _FindingCollector,
    comparison_registrations: tuple[Registration, ...],
    candidate: Candidate,
    opened: frozenset[tuple[str, str]],
) -> bool:
    freshness_defeated = False
    registration = candidate.registration
    history = _history_by_corpus(comparison_registrations)
    for candidate_window in registration.windows:
        for historical, historical_window in history.get(candidate_window.corpus.key, ()):
            if historical_window.start_ms >= candidate_window.end_ms:
                break
            bounds = _overlap_bounds(candidate_window, historical_window)
            if bounds is None:
                continue
            start_ms, end_ms = bounds
            collector.add(
                _cross_registration_finding(
                    code=Dq5ReasonCode.CORPUS_WINDOW_OVERLAP,
                    candidate=registration,
                    candidate_window=candidate_window,
                    historical=historical,
                    historical_window=historical_window,
                    holdout_id=None,
                    overlap_start_ms=start_ms,
                    overlap_end_ms=end_ms,
                )
            )
            cross_family = registration.family_id != historical.family_id
            if cross_family:
                collector.add(
                    _cross_registration_finding(
                        code=Dq5ReasonCode.CORPUS_WINDOW_REUSED_ACROSS_FAMILY,
                        candidate=registration,
                        candidate_window=candidate_window,
                        historical=historical,
                        historical_window=historical_window,
                        holdout_id=None,
                        overlap_start_ms=start_ms,
                        overlap_end_ms=end_ms,
                    )
                )

            shared_holdout_id: str | None = None
            if candidate_window.role is WindowRole.HOLDOUT:
                shared_holdout_id = candidate_window.holdout_id
            elif historical_window.role is WindowRole.HOLDOUT:
                shared_holdout_id = historical_window.holdout_id
            if shared_holdout_id is None:
                continue

            collector.add(
                _cross_registration_finding(
                    code=Dq5ReasonCode.HOLDOUT_SHARED,
                    candidate=registration,
                    candidate_window=candidate_window,
                    historical=historical,
                    historical_window=historical_window,
                    holdout_id=shared_holdout_id,
                    overlap_start_ms=start_ms,
                    overlap_end_ms=end_ms,
                )
            )
            if cross_family:
                collector.add(
                    _cross_registration_finding(
                        code=Dq5ReasonCode.HOLDOUT_SHARED_ACROSS_FAMILY,
                        candidate=registration,
                        candidate_window=candidate_window,
                        historical=historical,
                        historical_window=historical_window,
                        holdout_id=shared_holdout_id,
                        overlap_start_ms=start_ms,
                        overlap_end_ms=end_ms,
                    )
                )
            freshness_defeated = True
            if (
                historical_window.role is WindowRole.HOLDOUT
                and historical_window.holdout_id is not None
                and (historical.research_id, historical_window.holdout_id) in opened
            ):
                collector.add(
                    _cross_registration_finding(
                        code=Dq5ReasonCode.HOLDOUT_OPENED_OR_ATTEMPTED,
                        candidate=registration,
                        candidate_window=candidate_window,
                        historical=historical,
                        historical_window=historical_window,
                        holdout_id=historical_window.holdout_id,
                        overlap_start_ms=start_ms,
                        overlap_end_ms=end_ms,
                    )
                )
    return freshness_defeated


def _validate_intake(
    registry: Registry,
    candidate: Candidate,
    *,
    registry_sha256: str,
    candidate_sha256: str,
) -> ValidationReport:
    validate_registry_event_references(registry)
    self_pending_index = locate_candidate_pending_record(registry, candidate)
    collector = _FindingCollector()
    registration = candidate.registration
    comparison_registrations = (
        *registry.registrations,
        *(
            pending
            for index, pending in enumerate(registry.pending_registrations)
            if index != self_pending_index
        ),
    )
    freshness_defeated = False

    if not registry.coverage_complete:
        collector.add(
            Finding(
                code=Dq5ReasonCode.REGISTRY_HISTORY_INCOMPLETE,
                candidate_research_id=registration.research_id,
            )
        )

    controlled_corpora = frozenset(registry.corpora)
    for window in registration.windows:
        if window.corpus in controlled_corpora:
            continue
        collector.add(
            Finding(
                code=Dq5ReasonCode.CORPUS_NOT_REGISTERED,
                candidate_research_id=registration.research_id,
                candidate_window_id=window.window_id,
            )
        )

    if any(
        historical.research_id == registration.research_id
        for historical in comparison_registrations
    ):
        collector.add(
            Finding(
                code=Dq5ReasonCode.RESEARCH_ID_REUSED,
                candidate_research_id=registration.research_id,
                conflicting_research_id=registration.research_id,
            )
        )

    if not registration.fresh_holdout_claim:
        collector.add(
            Finding(
                code=Dq5ReasonCode.FRESH_HOLDOUT_REQUIRED,
                candidate_research_id=registration.research_id,
            )
        )

    freshness_defeated |= _add_internal_overlap_findings(collector, registration)
    freshness_defeated |= _add_internal_artifact_findings(collector, registration)

    opened = _opened_holdouts(registry.holdout_open_events)
    for holdout_id in sorted(registration.holdout_ids):
        if (registration.research_id, holdout_id) not in opened:
            continue
        window = registration.first_window_for_holdout(holdout_id)
        collector.add(
            Finding(
                code=Dq5ReasonCode.HOLDOUT_OPENED_OR_ATTEMPTED,
                candidate_research_id=registration.research_id,
                candidate_window_id=window.window_id,
                conflicting_research_id=registration.research_id,
                conflicting_window_id=window.window_id,
                holdout_id=holdout_id,
            )
        )
        freshness_defeated = True

    freshness_defeated |= _add_reused_holdout_findings(
        collector, comparison_registrations, candidate, opened
    )
    freshness_defeated |= _add_artifact_reuse_findings(
        collector, comparison_registrations, candidate, opened
    )
    freshness_defeated |= _add_cross_registration_findings(
        collector, comparison_registrations, candidate, opened
    )

    aggregate: list[Finding] = []
    if registration.fresh_holdout_claim and freshness_defeated:
        aggregate.append(
            Finding(
                code=Dq5ReasonCode.FRESH_HOLDOUT_CLAIM_FALSE,
                candidate_research_id=registration.research_id,
            )
        )
    if collector.capacity_exceeded:
        aggregate.append(
            Finding(
                code=Dq5ReasonCode.VALIDATION_CAPACITY_EXCEEDED,
                candidate_research_id=registration.research_id,
            )
        )

    findings = collector.finish(*aggregate)
    reason_codes = tuple(sorted({finding.code for finding in findings}, key=str))
    status = ValidationStatus.ELIGIBLE_FOR_INTAKE if not findings else ValidationStatus.REJECTED
    return ValidationReport(
        registry_sha256=registry_sha256,
        registry_custody_receipt_sha256=registry.custody_receipt_sha256,
        candidate_sha256=candidate_sha256,
        status=status,
        reason_codes=reason_codes,
        findings=findings,
        registry_corpus_count=len(registry.corpora),
        registry_pending_registration_count=len(registry.pending_registrations),
        registry_registration_count=len(registry.registrations),
        registry_window_count=registry.total_window_count,
        candidate_window_count=len(registration.windows),
    )


def validate_bytes(registry_raw: bytes, candidate_raw: bytes) -> ValidationReport:
    registry = parse_registry(registry_raw)
    candidate = parse_candidate(candidate_raw)
    return _validate_intake(
        registry,
        candidate,
        registry_sha256=hashlib.sha256(registry_raw).hexdigest(),
        candidate_sha256=hashlib.sha256(candidate_raw).hexdigest(),
    )
