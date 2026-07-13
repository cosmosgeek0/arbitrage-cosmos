"""Q13 deep-sequence gate: reference-only contracts and deterministic probes."""

from quant_edge.deep.campaign import (
    Q13CampaignV1,
    build_q13_campaign,
    generated_artifacts,
    render_campaign_markdown,
)
from quant_edge.deep.contracts import DeepFoldLineageV1, DeepSequenceWindowV1
from quant_edge.deep.fixtures import (
    FIXTURE_COUNT,
    FIXTURE_SEED,
    frozen_q13_sufficiency_evidence,
    interface_fixture_digest,
    interface_fixture_mapping,
    synthetic_q14_sample_set,
    synthetic_sequence_windows,
)
from quant_edge.deep.references import (
    REFERENCE_MODELS,
    DeepFamily,
    DeepModelReferenceV1,
    IntendedRole,
    reference_catalog_digest,
    reference_catalog_mapping,
)
from quant_edge.deep.sufficiency import (
    CRITERION_ORDER,
    EXACT_EVIDENCE_GAP,
    CriterionState,
    DeepDataSufficiencyEvidenceV1,
    DeepDataSufficiencyReportV1,
    DeepGateStatus,
    SufficiencyCriterion,
    SufficiencyFindingV1,
    evaluate_deep_data_sufficiency,
)
from quant_edge.deep.validation import (
    Q14DeepValidationBindingV1,
    bind_q14_validation,
)

__all__ = [
    "CRITERION_ORDER",
    "EXACT_EVIDENCE_GAP",
    "FIXTURE_COUNT",
    "FIXTURE_SEED",
    "REFERENCE_MODELS",
    "CriterionState",
    "DeepDataSufficiencyEvidenceV1",
    "DeepDataSufficiencyReportV1",
    "DeepFamily",
    "DeepFoldLineageV1",
    "DeepGateStatus",
    "DeepModelReferenceV1",
    "DeepSequenceWindowV1",
    "IntendedRole",
    "Q13CampaignV1",
    "Q14DeepValidationBindingV1",
    "SufficiencyCriterion",
    "SufficiencyFindingV1",
    "bind_q14_validation",
    "build_q13_campaign",
    "evaluate_deep_data_sufficiency",
    "frozen_q13_sufficiency_evidence",
    "generated_artifacts",
    "interface_fixture_digest",
    "interface_fixture_mapping",
    "reference_catalog_digest",
    "reference_catalog_mapping",
    "render_campaign_markdown",
    "synthetic_q14_sample_set",
    "synthetic_sequence_windows",
]
