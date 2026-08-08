"""Closed, byte-only orchestration for N3-I1 edge-verdict intake."""

from __future__ import annotations

from quant_edge.errors import ContractValueError
from quant_edge.n3_intake.adapters import adapt_registry, adapt_result
from quant_edge.n3_intake.contracts import (
    PACKET_ROLE_ORDER,
    AcceptanceState,
    ArtifactPinV1,
    ArtifactRole,
    IntakeDecisionV1,
    PacketRole,
    PinnedDocumentV1,
    ResultPacketV1,
)
from quant_edge.n3_intake.decision import _aggregate_results


def evaluate_intake(
    registry_document: PinnedDocumentV1,
    result_documents: tuple[PinnedDocumentV1, ...],
) -> IntakeDecisionV1:
    """Verify, join, assess, and aggregate one closed N3-I1 document packet."""

    if not isinstance(registry_document, PinnedDocumentV1):
        raise ContractValueError("registry_document must be PinnedDocumentV1")
    if registry_document.pin.role is not ArtifactRole.S_META1:
        raise ContractValueError("registry pin role must be S_META1")
    if registry_document.pin.acceptance is AcceptanceState.REJECTED:
        raise ContractValueError("REJECTED registry pin is invalid input")
    if not isinstance(result_documents, tuple):
        raise ContractValueError("result_documents must be a tuple")
    if any(not isinstance(document, PinnedDocumentV1) for document in result_documents):
        raise ContractValueError("result_documents must contain PinnedDocumentV1 values")
    if any(document.pin.acceptance is AcceptanceState.REJECTED for document in result_documents):
        raise ContractValueError("REJECTED result pin is invalid input")

    registry = adapt_registry(registry_document)
    family_by_role = {family.packet_role: family for family in registry.families}
    result_by_role: dict[PacketRole, ResultPacketV1] = {}
    pin_by_role: dict[PacketRole, ArtifactPinV1] = {}
    for document in result_documents:
        result = adapt_result(document)
        if result.role in result_by_role:
            raise ContractValueError(f"duplicate result role: {result.role.value}")
        result_by_role[result.role] = result
        pin_by_role[result.role] = document.pin

    expected_roles = set(family_by_role)
    observed_roles = set(result_by_role)
    missing_roles = expected_roles - observed_roles
    orphan_roles = observed_roles - expected_roles
    if missing_roles or orphan_roles:
        raise ContractValueError(
            "result role universe differs from registry; "
            f"missing={_ordered_role_names(missing_roles)}, "
            f"orphan={_ordered_role_names(orphan_roles)}"
        )

    return _aggregate_results(
        registry,
        result_by_role,
        registry_document.pin,
        pin_by_role,
    )


def _ordered_role_names(roles: set[PacketRole]) -> list[str]:
    return [role.value for role in PACKET_ROLE_ORDER if role in roles]
