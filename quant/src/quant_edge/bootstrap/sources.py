"""Materialized Q03 source cards and fail-closed review evidence.

These builders only assemble immutable :class:`DataSourceCardV1` evidence from pinned
Q03 research identities.  They have no source-admission, producer-registration, network,
storage, clock, environment, or credential effect.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.lake.governance import (
    SOURCE_GATE_ORDER,
    DataSourceCardV1,
    SourceAdoptionDisposition,
    SourceCardReviewV1,
    SourceGateCode,
    SourceGateEvidenceV1,
    evaluate_source_card,
)
from quant_edge.primitives import require_utc_millis

ARCHIVE_PRODUCER_OWNER: Final = "quant.offline_import"
CANONICAL_PRODUCER_OWNER: Final = "intelligenceRuntime"
BINANCE_ARCHIVE_SOURCE_ID: Final = "binance.public.archive.spot.aggTrades"
CANONICAL_BRIDGE_SOURCE_ID: Final = "canonical.intelligenceRuntime.q-bridge"
TARDIS_REFERENCE_SOURCE_ID: Final = "tardis.binance.reference"

BINANCE_PUBLIC_DATA_README_SHA256: Final = (
    "085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6"
)
SPOT_STREAM_CONTRACT_SHA256: Final = (
    "32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a"
)
USD_M_DOCUMENTATION_SHA256: Final = (
    "c72e3a3d9c840cf7db9ce5df5844106dda9a4b681d5d6539ff79e9c90ce0cbe0"
)
RUNTIME_CONTRACT_SHA256: Final = "482573f7d78901e9119a98075ec5ed7f900b224ae6555df0e1bf0c7b4623349e"
RUNTIME_SPOT_TYPES_SHA256: Final = (
    "75033425d4ba59f30181ba7ac8df7d928fdb382284c1943ddbb06121c6879f3e"
)
RUNTIME_FUTURES_TYPES_SHA256: Final = (
    "94fee5bedf7b3e20b0d69121bda8bedb4c2a59eabb5b1347c5e42d202e17322c"
)
RUNTIME_CAPTURE_TYPES_SHA256: Final = (
    "e9c9984df9d566ee6c5bf01ed43f6181ab2f2817f83ac099d293ff8e2af28d5c"
)
RUNTIME_BRIDGE_TYPES_SHA256: Final = (
    "d09f5a9ebd5cfafb542531c3b4318396492bd30e5de8c386319387c788274e46"
)
TARDIS_BINANCE_SPOT_DOC_SHA256: Final = (
    "21ca9ac6d54b82237dccdbe894058e73281d0be3ea38cee8d2b9cc06f0525749"
)
TARDIS_BINANCE_FUTURES_DOC_SHA256: Final = (
    "996509b3b8c26cc43454005d01ee7fa9a9bc5acc1aef68f121eefb4164f6cce1"
)
TARDIS_DATA_FAQ_SHA256: Final = "1964e67f23b21b89ac74fdbcb119fba006ee27c77ea91c5e04ab406bee7cf639"
TARDIS_TERMS_SHA256: Final = "c23ffa7e3a8dd8d2d1302929af9eded290e38d8eb7098766fe1da13135e1cd92"


class SourceDeliveryPosture(StrEnum):
    BOUNDED_HISTORICAL_RESEARCH = "BOUNDED_HISTORICAL_RESEARCH"
    MISSING_BLOCKED = "MISSING_BLOCKED"
    INTERFACE_ONLY = "INTERFACE_ONLY"


_EXPECTED_OWNER_BY_SOURCE: Final[dict[str, str]] = {
    BINANCE_ARCHIVE_SOURCE_ID: ARCHIVE_PRODUCER_OWNER,
    CANONICAL_BRIDGE_SOURCE_ID: CANONICAL_PRODUCER_OWNER,
    TARDIS_REFERENCE_SOURCE_ID: CANONICAL_PRODUCER_OWNER,
}
_DELIVERY_POSTURE_BY_SOURCE: Final[dict[str, SourceDeliveryPosture]] = {
    BINANCE_ARCHIVE_SOURCE_ID: SourceDeliveryPosture.BOUNDED_HISTORICAL_RESEARCH,
    CANONICAL_BRIDGE_SOURCE_ID: SourceDeliveryPosture.MISSING_BLOCKED,
    TARDIS_REFERENCE_SOURCE_ID: SourceDeliveryPosture.INTERFACE_ONLY,
}


def _require_sha256(value: object, *, field: str) -> str:
    if not isinstance(value, str):
        raise ContractValueError(f"{field} must be a lowercase SHA-256 digest")
    try:
        return DigestV1(value).hexdigest
    except ContractValueError as error:
        raise ContractValueError(f"{field} must be a lowercase SHA-256 digest") from error


def _digests(*values: str) -> tuple[str, ...]:
    validated = tuple(_require_sha256(value, field="gate evidence") for value in values)
    return tuple(sorted(set(validated)))


_GATE_SUMMARIES: Final[dict[SourceGateCode, str]] = {
    SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS: "Official or licensed access evidence.",
    SourceGateCode.STABLE_IDENTITY_MAPPING: "Stable point-in-time identity mapping evidence.",
    SourceGateCode.TIMESTAMP_SEQUENCE_SEMANTICS: "Timestamp and sequence semantics evidence.",
    SourceGateCode.RETENTION_PERMISSION: "Retention and redistribution permission evidence.",
    SourceGateCode.RESOURCE_RATE_BUDGET: "Bounded resource and rate-budget evidence.",
    SourceGateCode.EXPLICIT_HYPOTHESIS_VALUE: "Explicit hypothesis-value evidence.",
    SourceGateCode.CANONICAL_PRODUCER_OWNERSHIP: "Canonical producer-owner evidence.",
    SourceGateCode.OBSERVABLE_FAILURE_STATE: "Observable missing and failure-state evidence.",
}


def _gates(
    evidence: dict[SourceGateCode, tuple[str, ...]],
    *,
    failed_summaries: dict[SourceGateCode, str],
) -> tuple[SourceGateEvidenceV1, ...]:
    if set(evidence) != set(SOURCE_GATE_ORDER):
        raise ContractValueError("source-card evidence must address every Q-C gate")
    if not set(failed_summaries).issubset(SOURCE_GATE_ORDER):
        raise ContractValueError("failed_summaries contains an unsupported Q-C gate")
    result: list[SourceGateEvidenceV1] = []
    for gate in SOURCE_GATE_ORDER:
        gate_evidence = evidence[gate]
        if not isinstance(gate_evidence, tuple):
            raise ContractValueError("gate evidence must be immutable tuples")
        if gate_evidence:
            summary = _GATE_SUMMARIES[gate]
        else:
            summary = failed_summaries.get(gate, f"{gate.value} is unresolved.")
        result.append(
            SourceGateEvidenceV1(
                gate=gate,
                evidence_digests=gate_evidence,
                evidence_summary=summary,
            )
        )
    return tuple(result)


def build_binance_archive_source_card(
    *,
    evaluated_at_ms: int,
    source_research_sha256: str,
) -> DataSourceCardV1:
    """Build the official-archive card with identity and retention gaps preserved."""

    require_utc_millis(evaluated_at_ms, field="evaluated_at_ms")
    source_research = _require_sha256(
        source_research_sha256,
        field="source_research_sha256",
    )
    research = _digests(BINANCE_PUBLIC_DATA_README_SHA256, source_research)
    evidence = dict.fromkeys(SOURCE_GATE_ORDER, research)
    evidence[SourceGateCode.STABLE_IDENTITY_MAPPING] = ()
    evidence[SourceGateCode.RETENTION_PERMISSION] = ()
    return DataSourceCardV1(
        source_id=BINANCE_ARCHIVE_SOURCE_ID,
        contract_revision="binance-public-data.5c7f319.q03.v1",
        evaluated_at_ms=evaluated_at_ms,
        gates=_gates(
            evidence,
            failed_summaries={
                SourceGateCode.STABLE_IDENTITY_MAPPING: (
                    "URL plus checksum identifies bytes, but complete point-in-time instrument "
                    "identity remains UNKNOWN."
                ),
                SourceGateCode.RETENTION_PERMISSION: (
                    "Repository license is MIT_IN_README_ONLY; archive-data license is "
                    "NOT_EXPLICIT and raw redistribution is UNKNOWN_REQUIRES_APPROVAL."
                ),
            },
        ),
        hypothesis_ids=(
            "H1_DORMANT_TO_ACTIVE_EARLY_TRANSITION",
            "H2_CONTINUATION_VERSUS_EXHAUSTION",
            "H5_FALSE_BURST_MANIPULATION_RISK_FILTERING",
        ),
        incremental_value_summary=(
            "Provides bounded coarse aggregate-trade history for falsification and bootstrap "
            "coverage, without live latency or order-book claims."
        ),
        canonical_producer_owner=ARCHIVE_PRODUCER_OWNER,
        failure_state_codes=(
            "CHECKSUM_MISMATCH",
            "IDENTITY_UNRESOLVED",
            "LICENSE_UNRESOLVED",
            "MISSING",
            "REPLACED",
        ),
        historical_coverage_summary=(
            "One checksum-bound Spot daily aggregate-trade sample; every other path/date is "
            "UNKNOWN or UNAVAILABLE unless separately observed."
        ),
        live_coverage_summary="UNAVAILABLE; an archive is not live capture.",
        expected_latency_summary="UNAVAILABLE; archive rows contain no local receive clock.",
        outage_completeness_summary=(
            "Archive replacement is possible; gaps and upstream completeness remain explicit."
        ),
        disposition=SourceAdoptionDisposition.ADAPT,
    )


def build_canonical_bridge_source_card(*, evaluated_at_ms: int) -> DataSourceCardV1:
    """Build the owner-correct bridge card while real Q delivery stays MISSING/BLOCKED."""

    require_utc_millis(evaluated_at_ms, field="evaluated_at_ms")
    runtime = _digests(
        RUNTIME_CONTRACT_SHA256,
        RUNTIME_SPOT_TYPES_SHA256,
        RUNTIME_FUTURES_TYPES_SHA256,
        RUNTIME_CAPTURE_TYPES_SHA256,
        RUNTIME_BRIDGE_TYPES_SHA256,
        SPOT_STREAM_CONTRACT_SHA256,
        USD_M_DOCUMENTATION_SHA256,
    )
    evidence = dict.fromkeys(SOURCE_GATE_ORDER, runtime)
    for gate in (
        SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
        SourceGateCode.TIMESTAMP_SEQUENCE_SEMANTICS,
        SourceGateCode.RETENTION_PERMISSION,
        SourceGateCode.RESOURCE_RATE_BUDGET,
    ):
        evidence[gate] = ()
    return DataSourceCardV1(
        source_id=CANONICAL_BRIDGE_SOURCE_ID,
        contract_revision="canonical-intelligenceRuntime.q03-fixture.v1",
        evaluated_at_ms=evaluated_at_ms,
        gates=_gates(
            evidence,
            failed_summaries={
                SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS: (
                    "No accepted real Q delivery is attached; synthetic fixtures prove only "
                    "the read-only contract."
                ),
                SourceGateCode.TIMESTAMP_SEQUENCE_SEMANTICS: (
                    "Real delivery lacks accepted receive-monotonic, ordinal, persistence and "
                    "exact-decimal evidence."
                ),
                SourceGateCode.RETENTION_PERMISSION: (
                    "No accepted Q append-only delivery or retention integration exists."
                ),
                SourceGateCode.RESOURCE_RATE_BUDGET: (
                    "A bounded synthetic drop-new contract is not a measured live integration "
                    "budget."
                ),
            },
        ),
        hypothesis_ids=(
            "H1_DORMANT_TO_ACTIVE_EARLY_TRANSITION",
            "H2_CONTINUATION_VERSUS_EXHAUSTION",
            "H5_FALSE_BURST_MANIPULATION_RISK_FILTERING",
            "H6_CROSS_SOURCE_LEADERSHIP",
        ),
        incremental_value_summary=(
            "Defines the owner-correct seam for later high-fidelity receive-clock, sequence, "
            "gap and drop evidence."
        ),
        canonical_producer_owner=CANONICAL_PRODUCER_OWNER,
        failure_state_codes=("BLOCKED", "DROPPED", "GAPPED", "MISSING", "RESTARTED", "STALE"),
        historical_coverage_summary="SYNTHETIC_ONLY contract fixtures; no real market history.",
        live_coverage_summary="MISSING/BLOCKED; no accepted Q delivery is wired.",
        expected_latency_summary="UNAVAILABLE until real receive and processing clocks exist.",
        outage_completeness_summary=(
            "Synthetic gap/drop/restart cases are observable; live completeness is UNAVAILABLE."
        ),
        disposition=SourceAdoptionDisposition.ADAPT,
    )


def build_tardis_reference_source_card(*, evaluated_at_ms: int) -> DataSourceCardV1:
    """Build the optional interface-only card without claiming access or retention rights."""

    require_utc_millis(evaluated_at_ms, field="evaluated_at_ms")
    documents = _digests(
        TARDIS_BINANCE_SPOT_DOC_SHA256,
        TARDIS_BINANCE_FUTURES_DOC_SHA256,
        TARDIS_DATA_FAQ_SHA256,
        TARDIS_TERMS_SHA256,
    )
    evidence = dict.fromkeys(SOURCE_GATE_ORDER, documents)
    for gate in (
        SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS,
        SourceGateCode.STABLE_IDENTITY_MAPPING,
        SourceGateCode.RETENTION_PERMISSION,
        SourceGateCode.RESOURCE_RATE_BUDGET,
    ):
        evidence[gate] = ()
    return DataSourceCardV1(
        source_id=TARDIS_REFERENCE_SOURCE_ID,
        contract_revision="tardis-binance-docs.2026-07-12.q03.v1",
        evaluated_at_ms=evaluated_at_ms,
        gates=_gates(
            evidence,
            failed_summaries={
                SourceGateCode.OFFICIAL_OR_LICENSED_ACCESS: (
                    "REFERENCE_ONLY; no subscription, credential, license grant or download."
                ),
                SourceGateCode.STABLE_IDENTITY_MAPPING: (
                    "No retrieved dataset revision is mapped into the canonical instrument "
                    "identity."
                ),
                SourceGateCode.RETENTION_PERMISSION: (
                    "Terms restrict raw redistribution; no Q retention permission is accepted."
                ),
                SourceGateCode.RESOURCE_RATE_BUDGET: (
                    "No subscription or measured download/resource budget exists."
                ),
            },
        ),
        hypothesis_ids=(
            "H1_DORMANT_TO_ACTIVE_EARLY_TRANSITION",
            "H2_CONTINUATION_VERSUS_EXHAUSTION",
            "H5_FALSE_BURST_MANIPULATION_RISK_FILTERING",
            "H6_CROSS_SOURCE_LEADERSHIP",
        ),
        incremental_value_summary=(
            "Documents a possible later normalized-history interface while adding no Q03 "
            "dependency, access, data or runtime."
        ),
        canonical_producer_owner=CANONICAL_PRODUCER_OWNER,
        failure_state_codes=(
            "ACCESS_NOT_ACQUIRED",
            "BLOCKED",
            "MISSING",
            "RETENTION_RESTRICTED",
        ),
        historical_coverage_summary="UNAVAILABLE; no Tardis data was acquired.",
        live_coverage_summary="UNAVAILABLE; this is an interface-only historical reference.",
        expected_latency_summary="UNAVAILABLE; no client or delivery is implemented.",
        outage_completeness_summary=(
            "Provider documentation warns of possible gaps; no local completeness claim exists."
        ),
        disposition=SourceAdoptionDisposition.REFERENCE_ONLY,
    )


@dataclass(frozen=True, slots=True)
class MaterializedSourceReviewV1:
    """A card plus its derived review and explicit delivery posture."""

    card: DataSourceCardV1
    review: SourceCardReviewV1
    delivery_posture: SourceDeliveryPosture
    expected_canonical_producer_owner: str

    def __post_init__(self) -> None:
        if not isinstance(self.card, DataSourceCardV1):
            raise ContractValueError("card must be DataSourceCardV1")
        if not isinstance(self.review, SourceCardReviewV1):
            raise ContractValueError("review must be SourceCardReviewV1")
        if not isinstance(self.delivery_posture, SourceDeliveryPosture):
            raise ContractValueError("delivery_posture must be SourceDeliveryPosture")
        if not isinstance(self.expected_canonical_producer_owner, str):
            raise ContractValueError("expected_canonical_producer_owner must be text")
        expected = evaluate_source_card(
            self.card,
            expected_canonical_producer_owner=self.expected_canonical_producer_owner,
        )
        if self.review != expected:
            raise ContractValueError("source review must be derived from the exact source card")

    def as_mapping(self) -> dict[str, object]:
        return {
            "card": self.card.as_mapping(),
            "deliveryPosture": self.delivery_posture.value,
            "expectedCanonicalProducerOwner": self.expected_canonical_producer_owner,
            "review": self.review.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class Q03SourceReviewRegistryV1:
    """The exact three-card Q03 review registry; it carries no admission operation."""

    evaluated_at_ms: int
    sources: tuple[MaterializedSourceReviewV1, ...]

    def __post_init__(self) -> None:
        require_utc_millis(self.evaluated_at_ms, field="evaluated_at_ms")
        if not isinstance(self.sources, tuple) or len(self.sources) != 3:
            raise ContractValueError("Q03 source registry requires exactly three immutable cards")
        if any(not isinstance(source, MaterializedSourceReviewV1) for source in self.sources):
            raise ContractValueError("sources must contain MaterializedSourceReviewV1 records")
        ids = tuple(source.card.source_id for source in self.sources)
        if ids != tuple(sorted(set(ids))):
            raise ContractValueError("source cards must be sorted and unique by source_id")
        if set(ids) != set(_EXPECTED_OWNER_BY_SOURCE):
            raise ContractValueError("Q03 source registry contains an unexpected source set")
        for source in self.sources:
            source_id = source.card.source_id
            if source.expected_canonical_producer_owner != _EXPECTED_OWNER_BY_SOURCE[source_id]:
                raise ContractValueError("source registry carries the wrong canonical owner")
            if source.delivery_posture is not _DELIVERY_POSTURE_BY_SOURCE[source_id]:
                raise ContractValueError("source registry carries the wrong delivery posture")
        if any(source.card.evaluated_at_ms != self.evaluated_at_ms for source in self.sources):
            raise ContractValueError("every source card must share the registry evaluation time")

    def as_mapping(self) -> dict[str, object]:
        return {
            "authorityPosture": "REVIEW_ONLY_NO_ADMISSION",
            "evaluatedAtMs": self.evaluated_at_ms,
            "schema": "Q03SourceReviewRegistryV1",
            "sources": [source.as_mapping() for source in self.sources],
            "version": 1,
        }

    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.as_mapping())

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.canonical_bytes()).hexdigest()


def materialize_q03_source_reviews(
    *,
    evaluated_at_ms: int,
    source_research_sha256: str,
) -> Q03SourceReviewRegistryV1:
    """Build and review the exact Q03 archive, bridge and optional reference cards."""

    archive = build_binance_archive_source_card(
        evaluated_at_ms=evaluated_at_ms,
        source_research_sha256=source_research_sha256,
    )
    bridge = build_canonical_bridge_source_card(evaluated_at_ms=evaluated_at_ms)
    tardis = build_tardis_reference_source_card(evaluated_at_ms=evaluated_at_ms)
    cards = tuple(sorted((archive, bridge, tardis), key=lambda card: card.source_id))
    sources = tuple(
        MaterializedSourceReviewV1(
            card=card,
            review=evaluate_source_card(
                card,
                expected_canonical_producer_owner=_EXPECTED_OWNER_BY_SOURCE[card.source_id],
            ),
            delivery_posture=_DELIVERY_POSTURE_BY_SOURCE[card.source_id],
            expected_canonical_producer_owner=_EXPECTED_OWNER_BY_SOURCE[card.source_id],
        )
        for card in cards
    )
    return Q03SourceReviewRegistryV1(evaluated_at_ms=evaluated_at_ms, sources=sources)
