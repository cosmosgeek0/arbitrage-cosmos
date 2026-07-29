from __future__ import annotations

from research.dq5.tests.support import (
    require_array,
    require_object,
    require_string,
    sealed_fixture_intake,
)
from research.dq5.validator import ValidationStatus, validate_bytes

from quant_edge.canonical import parse_canonical_object


def test_empty_history_accepts_one_fresh_disjoint_candidate() -> None:
    report = validate_bytes(
        *sealed_fixture_intake(
            "valid",
            "registry_empty.json",
            "valid",
            "candidate_fresh.json",
        )
    )

    assert report.status is ValidationStatus.ELIGIBLE_FOR_INTAKE
    assert report.reason_codes == ()
    assert report.findings == ()
    assert report.canonical_bytes() == report.canonical_bytes()

    decoded = parse_canonical_object(report.canonical_bytes())
    assert decoded["status"] == "ELIGIBLE_FOR_INTAKE"
    assert decoded["authority"] == "NONE"
    assert decoded["registryCustodyReceiptSha256"] == "c" * 64
    assert decoded["reasonCodes"] == []
    assert decoded["findings"] == []


def test_half_open_boundary_adjacency_is_not_overlap_or_reuse() -> None:
    report = validate_bytes(
        *sealed_fixture_intake(
            "valid",
            "registry_adjacent_history.json",
            "valid",
            "candidate_adjacent.json",
        )
    )

    assert report.status is ValidationStatus.ELIGIBLE_FOR_INTAKE
    assert report.reason_codes == ()


def test_report_is_sorted_unique_and_byte_stable() -> None:
    registry, candidate = sealed_fixture_intake(
        "hostile",
        "registry_contaminated.json",
        "hostile",
        "candidate_false_fresh.json",
    )

    first = validate_bytes(registry, candidate).canonical_bytes()
    second = validate_bytes(registry, candidate).canonical_bytes()
    assert first == second

    decoded = parse_canonical_object(first)
    reason_codes = [require_string(code) for code in require_array(decoded["reasonCodes"])]
    assert reason_codes == sorted(reason_codes)
    assert len(reason_codes) == len(set(reason_codes))

    findings = require_array(decoded["findings"])
    finding_tuples = [
        (
            require_object(finding)["code"],
            require_object(finding)["candidateWindowId"] or "",
            require_object(finding)["conflictingResearchId"] or "",
            require_object(finding)["conflictingWindowId"] or "",
            require_object(finding)["holdoutId"] or "",
            require_object(finding)["overlapStartMs"]
            if require_object(finding)["overlapStartMs"] is not None
            else -1,
            require_object(finding)["overlapEndMs"]
            if require_object(finding)["overlapEndMs"] is not None
            else -1,
        )
        for finding in findings
    ]
    assert finding_tuples == sorted(finding_tuples)
    assert len(finding_tuples) == len(set(finding_tuples))
