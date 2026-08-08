"""Offline, fail-closed N3-I1 edge-verdict intake."""

from quant_edge.n3_intake.contracts import (
    AcceptanceState,
    ArtifactPinV1,
    ArtifactRole,
    DecisionState,
    PacketRole,
    PinnedDocumentV1,
)
from quant_edge.n3_intake.intake import evaluate_intake
from quant_edge.n3_intake.renderer import decision_to_canonical_bytes, render_fable5

__all__ = [
    "AcceptanceState",
    "ArtifactPinV1",
    "ArtifactRole",
    "DecisionState",
    "PacketRole",
    "PinnedDocumentV1",
    "decision_to_canonical_bytes",
    "evaluate_intake",
    "render_fable5",
]
