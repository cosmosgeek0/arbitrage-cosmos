from __future__ import annotations

import ast
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest

from quant_edge.bootstrap import sources as sources_module
from quant_edge.bootstrap.sources import (
    ARCHIVE_PRODUCER_OWNER,
    BINANCE_ARCHIVE_SOURCE_ID,
    CANONICAL_BRIDGE_SOURCE_ID,
    CANONICAL_PRODUCER_OWNER,
    TARDIS_REFERENCE_SOURCE_ID,
    MaterializedSourceReviewV1,
    Q03SourceReviewRegistryV1,
    SourceDeliveryPosture,
    build_binance_archive_source_card,
    build_canonical_bridge_source_card,
    build_tardis_reference_source_card,
    materialize_q03_source_reviews,
)
from quant_edge.canonical import parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.lake.governance import (
    SOURCE_GATE_ORDER,
    SourceAdoptionDisposition,
    SourceCardReviewStatus,
    SourceCardReviewV1,
    SourceGateCode,
    evaluate_source_card,
)

AS_OF_MS = 1_783_814_400_000
SOURCE_RESEARCH_SHA256 = "a" * 64


def _registry() -> Q03SourceReviewRegistryV1:
    return materialize_q03_source_reviews(
        evaluated_at_ms=AS_OF_MS,
        source_research_sha256=SOURCE_RESEARCH_SHA256,
    )


def _by_id() -> dict[str, MaterializedSourceReviewV1]:
    return {source.card.source_id: source for source in _registry().sources}


def test_materialized_registry_is_canonical_review_only_and_deterministic() -> None:
    first = _registry()
    second = _registry()
    parsed = parse_canonical_object(first.canonical_bytes())

    assert first == second
    assert first.sha256 == second.sha256
    assert parsed == first.as_mapping()
    assert parsed["authorityPosture"] == "REVIEW_ONLY_NO_ADMISSION"
    assert [source.card.source_id for source in first.sources] == sorted(
        (BINANCE_ARCHIVE_SOURCE_ID, CANONICAL_BRIDGE_SOURCE_ID, TARDIS_REFERENCE_SOURCE_ID)
    )
    assert all(
        source.review.authority_posture == "REVIEW_ONLY_NO_ADMISSION" for source in first.sources
    )
    assert "ADMITTED" not in first.canonical_bytes().decode()


def test_archive_card_fails_exactly_unresolved_identity_and_retention_gates() -> None:
    source = _by_id()[BINANCE_ARCHIVE_SOURCE_ID]
    card = source.card

    assert source.delivery_posture is SourceDeliveryPosture.BOUNDED_HISTORICAL_RESEARCH
    assert card.disposition is SourceAdoptionDisposition.ADAPT
    assert card.canonical_producer_owner == ARCHIVE_PRODUCER_OWNER
    assert source.expected_canonical_producer_owner == ARCHIVE_PRODUCER_OWNER
    assert source.review.status is SourceCardReviewStatus.INELIGIBLE
    assert source.review.failed_gate_codes == (
        SourceGateCode.STABLE_IDENTITY_MAPPING,
        SourceGateCode.RETENTION_PERMISSION,
    )
    assert "MIT_IN_README_ONLY" in card.gates[3].evidence_summary
    assert "NOT_EXPLICIT" in card.gates[3].evidence_summary
    assert "UNKNOWN_REQUIRES_APPROVAL" in card.gates[3].evidence_summary
    assert "archive is not live capture" in card.live_coverage_summary
    assert {"IDENTITY_UNRESOLVED", "LICENSE_UNRESOLVED"}.issubset(card.failure_state_codes)


def test_bridge_card_is_owner_correct_but_real_delivery_is_missing_and_blocked() -> None:
    source = _by_id()[CANONICAL_BRIDGE_SOURCE_ID]
    card = source.card

    assert source.delivery_posture is SourceDeliveryPosture.MISSING_BLOCKED
    assert card.canonical_producer_owner == "intelligenceRuntime"
    assert card.live_coverage_summary.startswith("MISSING/BLOCKED")
    assert {"MISSING", "BLOCKED", "DROPPED", "GAPPED", "RESTARTED"}.issubset(
        card.failure_state_codes
    )
    assert source.review.status is SourceCardReviewStatus.INELIGIBLE
    assert source.review.failed_gate_codes == (
        SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
        SourceGateCode.TIMESTAMP_SEQUENCE_SEMANTICS,
        SourceGateCode.RETENTION_PERMISSION,
        SourceGateCode.RESOURCE_RATE_BUDGET,
    )
    assert SourceGateCode.CANONICAL_PRODUCER_OWNERSHIP not in source.review.failed_gate_codes


def test_tardis_card_remains_interface_only_without_access_data_or_dependency() -> None:
    source = _by_id()[TARDIS_REFERENCE_SOURCE_ID]
    card = source.card

    assert source.delivery_posture is SourceDeliveryPosture.INTERFACE_ONLY
    assert card.disposition is SourceAdoptionDisposition.REFERENCE_ONLY
    assert card.historical_coverage_summary.startswith("UNAVAILABLE")
    assert "no Tardis data was acquired" in card.historical_coverage_summary
    assert {"ACCESS_NOT_ACQUIRED", "RETENTION_RESTRICTED"}.issubset(card.failure_state_codes)
    assert source.review.failed_gate_codes == (
        SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
        SourceGateCode.STABLE_IDENTITY_MAPPING,
        SourceGateCode.RETENTION_PERMISSION,
        SourceGateCode.RESOURCE_RATE_BUDGET,
    )


def test_preuse_research_revision_only_changes_archive_card_without_import_campaign() -> None:
    first = _registry()
    second = materialize_q03_source_reviews(
        evaluated_at_ms=AS_OF_MS,
        source_research_sha256="b" * 64,
    )
    first_by_id = {source.card.source_id: source.card.sha256 for source in first.sources}
    second_by_id = {source.card.source_id: source.card.sha256 for source in second.sources}
    assert first_by_id[BINANCE_ARCHIVE_SOURCE_ID] != second_by_id[BINANCE_ARCHIVE_SOURCE_ID]
    assert first_by_id[CANONICAL_BRIDGE_SOURCE_ID] == second_by_id[CANONICAL_BRIDGE_SOURCE_ID]
    assert first_by_id[TARDIS_REFERENCE_SOURCE_ID] == second_by_id[TARDIS_REFERENCE_SOURCE_ID]
    assert first.sha256 != second.sha256


@pytest.mark.parametrize(
    "builder",
    [build_canonical_bridge_source_card, build_tardis_reference_source_card],
)
def test_card_builders_reject_ambient_or_invalid_evaluation_time(builder: object) -> None:
    with pytest.raises(ContractValueError):
        builder(evaluated_at_ms=True)  # type: ignore[operator]


def test_archive_builder_rejects_invalid_digest_and_time() -> None:
    with pytest.raises(ContractValueError):
        build_binance_archive_source_card(
            evaluated_at_ms=AS_OF_MS,
            source_research_sha256="not-a-digest",
        )
    with pytest.raises(ContractValueError):
        build_binance_archive_source_card(
            evaluated_at_ms=0,
            source_research_sha256=SOURCE_RESEARCH_SHA256,
        )
    with pytest.raises(ContractValueError):
        build_binance_archive_source_card(
            evaluated_at_ms=AS_OF_MS,
            source_research_sha256=1,  # type: ignore[arg-type]
        )


def test_materialized_review_rejects_forged_review_type_and_delivery_posture() -> None:
    source = _by_id()[BINANCE_ARCHIVE_SOURCE_ID]
    forged = SourceCardReviewV1(
        status=SourceCardReviewStatus.INELIGIBLE,
        failed_gate_codes=(SourceGateCode.RETENTION_PERMISSION,),
    )
    with pytest.raises(ContractValueError, match="derived"):
        replace(source, review=forged)
    with pytest.raises(ContractValueError, match="card must"):
        MaterializedSourceReviewV1(
            card=object(),  # type: ignore[arg-type]
            review=source.review,
            delivery_posture=source.delivery_posture,
            expected_canonical_producer_owner=source.expected_canonical_producer_owner,
        )
    with pytest.raises(ContractValueError, match="review must"):
        replace(source, review=object())  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="delivery_posture"):
        replace(source, delivery_posture="ADMITTED")  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="expected_canonical"):
        replace(source, expected_canonical_producer_owner=None)  # type: ignore[arg-type]
    with pytest.raises(FrozenInstanceError):
        source.delivery_posture = SourceDeliveryPosture.INTERFACE_ONLY  # type: ignore[misc]


def test_source_registry_rejects_missing_duplicate_unsorted_or_mixed_time_cards() -> None:
    registry = _registry()
    archive, bridge, tardis = registry.sources
    for invalid in (
        registry.sources[:-1],
        (archive, archive, tardis),
        (tardis, bridge, archive),
        (archive, bridge, object()),
    ):
        with pytest.raises(ContractValueError):
            Q03SourceReviewRegistryV1(evaluated_at_ms=AS_OF_MS, sources=invalid)  # type: ignore[arg-type]
    later_card = build_tardis_reference_source_card(evaluated_at_ms=AS_OF_MS + 1)
    later = replace(
        tardis,
        card=later_card,
        review=evaluate_source_card(
            later_card,
            expected_canonical_producer_owner=CANONICAL_PRODUCER_OWNER,
        ),
    )
    mixed = tuple(sorted((archive, bridge, later), key=lambda item: item.card.source_id))
    with pytest.raises(ContractValueError, match="evaluation time"):
        Q03SourceReviewRegistryV1(evaluated_at_ms=AS_OF_MS, sources=mixed)

    wrong_owner_review = evaluate_source_card(
        archive.card,
        expected_canonical_producer_owner=CANONICAL_PRODUCER_OWNER,
    )
    wrong_owner = replace(
        archive,
        review=wrong_owner_review,
        expected_canonical_producer_owner=CANONICAL_PRODUCER_OWNER,
    )
    wrong_owner_sources = tuple(
        sorted((wrong_owner, bridge, tardis), key=lambda item: item.card.source_id)
    )
    with pytest.raises(ContractValueError, match="wrong canonical owner"):
        Q03SourceReviewRegistryV1(evaluated_at_ms=AS_OF_MS, sources=wrong_owner_sources)

    wrong_posture = replace(archive, delivery_posture=SourceDeliveryPosture.INTERFACE_ONLY)
    wrong_posture_sources = tuple(
        sorted((wrong_posture, bridge, tardis), key=lambda item: item.card.source_id)
    )
    with pytest.raises(ContractValueError, match="wrong delivery posture"):
        Q03SourceReviewRegistryV1(evaluated_at_ms=AS_OF_MS, sources=wrong_posture_sources)

    unexpected_card = replace(tardis.card, source_id="unexpected.source")
    unexpected = replace(
        tardis,
        card=unexpected_card,
        review=evaluate_source_card(
            unexpected_card,
            expected_canonical_producer_owner=CANONICAL_PRODUCER_OWNER,
        ),
    )
    unexpected_sources = tuple(
        sorted((archive, bridge, unexpected), key=lambda item: item.card.source_id)
    )
    with pytest.raises(ContractValueError, match="unexpected source set"):
        Q03SourceReviewRegistryV1(evaluated_at_ms=AS_OF_MS, sources=unexpected_sources)


def test_gate_materializer_rejects_partial_or_mutable_internal_evidence() -> None:
    complete: dict[SourceGateCode, tuple[str, ...]] = dict.fromkeys(
        SOURCE_GATE_ORDER, (SOURCE_RESEARCH_SHA256,)
    )
    del complete[SourceGateCode.RETENTION_PERMISSION]
    with pytest.raises(ContractValueError, match="every Q-C gate"):
        sources_module._gates(complete, failed_summaries={})
    mutable: dict[SourceGateCode, tuple[str, ...]] = dict.fromkeys(
        SOURCE_GATE_ORDER, (SOURCE_RESEARCH_SHA256,)
    )
    mutable[SourceGateCode.RETENTION_PERMISSION] = []  # type: ignore[assignment]
    with pytest.raises(ContractValueError, match="immutable tuples"):
        sources_module._gates(mutable, failed_summaries={})
    with pytest.raises(ContractValueError, match="unsupported"):
        sources_module._gates(
            dict.fromkeys(SOURCE_GATE_ORDER, (SOURCE_RESEARCH_SHA256,)),
            failed_summaries={"NOT_A_GATE": "bad"},  # type: ignore[dict-item]
        )


def test_sources_module_has_no_effectful_runtime_imports() -> None:
    path = Path(sources_module.__file__)
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imported_roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            imported_roots.add(node.module.split(".")[0])
    assert imported_roots.isdisjoint(
        {"aiohttp", "httpx", "os", "pathlib", "requests", "socket", "subprocess", "time"}
    )
    assert all(
        not (
            isinstance(node, ast.ImportFrom)
            and node.module is not None
            and node.module.endswith("bootstrap.importer")
        )
        for node in ast.walk(tree)
    )
