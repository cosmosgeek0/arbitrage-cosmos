"""Honest Q13 model references; no learned implementation exists."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.canonical import canonical_json_bytes
from quant_edge.deep.sufficiency import EXACT_EVIDENCE_GAP
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, require_contract_id
from quant_edge.models import BatteryDisposition, BatteryDispositionRecordV1


class DeepFamily(StrEnum):
    SIMPLE_MLP = "SIMPLE_MLP"
    DEEPLOB_STYLE = "DEEPLOB_STYLE"
    TLOB_STYLE = "TLOB_STYLE"


class IntendedRole(StrEnum):
    SIMPLE_TEMPORAL_BASELINE = "SIMPLE_TEMPORAL_BASELINE"
    SHADOW_CHALLENGER = "SHADOW_CHALLENGER"


@dataclass(frozen=True, slots=True)
class DeepModelReferenceV1:
    model_id: str
    family: DeepFamily
    intended_role: IntendedRole
    primary_reference: str
    evidence_gap: str
    disposition: BatteryDisposition = BatteryDisposition.REFERENCE_ONLY

    def __post_init__(self) -> None:
        require_contract_id(self.model_id, field="model_id")
        if not isinstance(self.family, DeepFamily):
            raise ContractValueError("family must be DeepFamily")
        if not isinstance(self.intended_role, IntendedRole):
            raise ContractValueError("intended_role must be IntendedRole")
        if not isinstance(self.primary_reference, str) or not self.primary_reference.startswith(
            "https://"
        ):
            raise ContractValueError("primary_reference must be an HTTPS URL")
        if self.evidence_gap != EXACT_EVIDENCE_GAP:
            raise ContractValueError("every deep reference must carry the exact evidence gap")
        if self.disposition is not BatteryDisposition.REFERENCE_ONLY:
            raise ContractValueError("Q13 deep models must remain REFERENCE_ONLY")

    def as_disposition_record(self) -> BatteryDispositionRecordV1:
        return BatteryDispositionRecordV1(
            bullet_id=f"q13-{self.family.value.lower().replace('_', '-')}",
            bullet=f"{self.family.value} deep-sequence candidate",
            disposition=self.disposition,
            reason=self.evidence_gap,
            implemented_ids=(),
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "artifactSha256": None,
            "calibrationEvidence": None,
            "disposition": self.disposition.value,
            "evidenceGap": self.evidence_gap,
            "family": self.family.value,
            "implemented": False,
            "intendedRole": self.intended_role.value,
            "metrics": [],
            "modelId": self.model_id,
            "primaryReference": self.primary_reference,
            "probabilitySemantics": "UNAVAILABLE",
            "promotionEligible": False,
            "q14ValidationRequired": True,
            "shadowScoring": False,
            "trained": False,
        }


REFERENCE_MODELS: Final = (
    DeepModelReferenceV1(
        model_id="simple-mlp-v0",
        family=DeepFamily.SIMPLE_MLP,
        intended_role=IntendedRole.SIMPLE_TEMPORAL_BASELINE,
        primary_reference="https://arxiv.org/abs/2502.15757",
        evidence_gap=EXACT_EVIDENCE_GAP,
    ),
    DeepModelReferenceV1(
        model_id="deeplob-style-v0",
        family=DeepFamily.DEEPLOB_STYLE,
        intended_role=IntendedRole.SHADOW_CHALLENGER,
        primary_reference="https://arxiv.org/abs/1808.03668",
        evidence_gap=EXACT_EVIDENCE_GAP,
    ),
    DeepModelReferenceV1(
        model_id="tlob-style-v0",
        family=DeepFamily.TLOB_STYLE,
        intended_role=IntendedRole.SHADOW_CHALLENGER,
        primary_reference="https://arxiv.org/abs/2502.15757",
        evidence_gap=EXACT_EVIDENCE_GAP,
    ),
)


def reference_catalog_mapping() -> dict[str, object]:
    return {
        "models": [model.as_mapping() for model in REFERENCE_MODELS],
        "schema": "Q13DeepReferenceCatalogV1",
        "version": 1,
    }


def reference_catalog_digest() -> DigestV1:
    return DigestV1(
        hexdigest=hashlib.sha256(canonical_json_bytes(reference_catalog_mapping())).hexdigest()
    )
