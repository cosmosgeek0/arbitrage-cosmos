"""Fail-closed future binding to the accepted Q14 validation factory.

The binding records the additional out-of-fold lineage Q14 predictions do not encode.
It creates no predictions and opens no holdout.  Current Q13 evidence cannot construct
one because the sufficiency report fails.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from quant_edge.canonical import canonical_json_bytes
from quant_edge.deep.contracts import DeepFoldLineageV1
from quant_edge.deep.references import DeepFamily
from quant_edge.deep.sufficiency import DeepDataSufficiencyReportV1
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, require_contract_id


@dataclass(frozen=True, slots=True)
class Q14DeepValidationBindingV1:
    candidate_id: str
    family: DeepFamily
    sample_set_digest: DigestV1
    walk_forward_plan_digest: DigestV1
    lineage_digest: DigestV1
    sufficiency_report_digest: DigestV1
    q14_factory_revision: str = "q14.validation.v1"

    def __post_init__(self) -> None:
        require_contract_id(self.candidate_id, field="candidate_id")
        if not isinstance(self.family, DeepFamily):
            raise ContractValueError("family must be DeepFamily")
        for field, value in (
            ("sample_set_digest", self.sample_set_digest),
            ("walk_forward_plan_digest", self.walk_forward_plan_digest),
            ("lineage_digest", self.lineage_digest),
            ("sufficiency_report_digest", self.sufficiency_report_digest),
        ):
            if not isinstance(value, DigestV1):
                raise ContractValueError(f"{field} must be DigestV1")
        require_contract_id(self.q14_factory_revision, field="q14_factory_revision")

    def as_mapping(self) -> dict[str, object]:
        return {
            "candidateId": self.candidate_id,
            "family": self.family.value,
            "lineageSha256": self.lineage_digest.hexdigest,
            "q14FactoryRevision": self.q14_factory_revision,
            "sampleSetSha256": self.sample_set_digest.hexdigest,
            "schema": "Q13Q14DeepValidationBindingV1",
            "sufficiencyReportSha256": self.sufficiency_report_digest.hexdigest,
            "walkForwardPlanSha256": self.walk_forward_plan_digest.hexdigest,
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def bind_q14_validation(
    report: DeepDataSufficiencyReportV1,
    *,
    candidate_id: str,
    family: DeepFamily,
    sample_set_digest: DigestV1,
    walk_forward_plan_digest: DigestV1,
    lineage: DeepFoldLineageV1,
) -> Q14DeepValidationBindingV1:
    """Bind a future passed candidate; current Q13 always fails before binding."""

    if not isinstance(report, DeepDataSufficiencyReportV1):
        raise ContractValueError("report must be DeepDataSufficiencyReportV1")
    if not report.training_permitted:
        raise ContractValueError("DEEP_DATA_SUFFICIENCY_GATE_FAILED")
    if not isinstance(lineage, DeepFoldLineageV1):
        raise ContractValueError("lineage must be DeepFoldLineageV1")
    if lineage.candidate_id != candidate_id:
        raise ContractValueError("lineage candidate does not match validation candidate")
    return Q14DeepValidationBindingV1(
        candidate_id=candidate_id,
        family=family,
        sample_set_digest=sample_set_digest,
        walk_forward_plan_digest=walk_forward_plan_digest,
        lineage_digest=lineage.digest(),
        sufficiency_report_digest=report.digest(),
    )
