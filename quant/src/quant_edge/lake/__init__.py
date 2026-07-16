"""Deterministic, immutable research-evidence storage contracts."""

from quant_edge.lake.contracts import (
    DigestV1,
    EvidencePosture,
    ExactScaledValueV1,
    PartitionKeyV1,
    QualityFactsV1,
    QualityState,
    RawTimestampV1,
    ReferenceMarketEvidenceRowV1,
    ResearchQualityAssessmentV1,
    TimestampBasis,
    TimestampUnit,
    derive_quality,
)

__all__ = [
    "DigestV1",
    "EvidencePosture",
    "ExactScaledValueV1",
    "PartitionKeyV1",
    "QualityFactsV1",
    "QualityState",
    "RawTimestampV1",
    "ReferenceMarketEvidenceRowV1",
    "ResearchQualityAssessmentV1",
    "TimestampBasis",
    "TimestampUnit",
    "derive_quality",
]
