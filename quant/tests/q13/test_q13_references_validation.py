from __future__ import annotations

from dataclasses import replace

import pytest

from quant_edge.deep import (
    EXACT_EVIDENCE_GAP,
    REFERENCE_MODELS,
    DeepDataSufficiencyReportV1,
    DeepFamily,
    DeepModelReferenceV1,
    IntendedRole,
    Q14DeepValidationBindingV1,
    bind_q14_validation,
    evaluate_deep_data_sufficiency,
    frozen_q13_sufficiency_evidence,
    reference_catalog_digest,
    reference_catalog_mapping,
)
from quant_edge.deep.contracts import DeepFoldLineageV1
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.models import BatteryDisposition


def _digest(character: str) -> DigestV1:
    return DigestV1(character * 64)


def _lineage(candidate_id: str = "future-candidate-v1") -> DeepFoldLineageV1:
    return DeepFoldLineageV1(
        fold_id="fold-1",
        candidate_id=candidate_id,
        validation_sample_id="validation-1",
        validation_group_id="validation-group-1",
        validation_cutoff_ns=1_700_000_100_000_000_000,
        training_sample_ids=("training-1",),
        training_group_ids=("training-group-1",),
        max_training_label_end_ns=1_700_000_000_000_000_000,
        embargo_ns=10_000_000_000,
        training_set_digest=_digest("1"),
        split_plan_digest=_digest("2"),
        feature_registry_digest=_digest("3"),
        label_manifest_digest=_digest("4"),
    )


def _passed_report() -> DeepDataSufficiencyReportV1:
    evidence = frozen_q13_sufficiency_evidence()
    passed = replace(
        evidence,
        complete_historical_l2=True,
        independent_events_regimes=True,
        stable_point_in_time_labels=True,
        realistic_cost_actionability=True,
        measured_compute_budget=True,
        untouched_chronological_holdout=True,
        same_cohort_simple_baseline=True,
        evidence_gap=None,
    )
    return evaluate_deep_data_sufficiency(passed)


def test_all_deep_candidates_are_inert_reference_only_records() -> None:
    assert tuple(model.family for model in REFERENCE_MODELS) == tuple(DeepFamily)
    assert {model.intended_role for model in REFERENCE_MODELS} == {
        IntendedRole.SIMPLE_TEMPORAL_BASELINE,
        IntendedRole.SHADOW_CHALLENGER,
    }
    assert all(model.disposition is BatteryDisposition.REFERENCE_ONLY for model in REFERENCE_MODELS)
    assert all(model.evidence_gap == EXACT_EVIDENCE_GAP for model in REFERENCE_MODELS)
    assert all(model.as_disposition_record().implemented_ids == () for model in REFERENCE_MODELS)
    assert all(model.as_mapping()["trained"] is False for model in REFERENCE_MODELS)
    assert all(model.as_mapping()["shadowScoring"] is False for model in REFERENCE_MODELS)
    assert all(model.as_mapping()["promotionEligible"] is False for model in REFERENCE_MODELS)
    assert all(
        model.as_mapping()["probabilitySemantics"] == "UNAVAILABLE" for model in REFERENCE_MODELS
    )
    assert reference_catalog_mapping()["schema"] == "Q13DeepReferenceCatalogV1"
    assert reference_catalog_digest() == reference_catalog_digest()


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"family": "bad"}, "family must"),
        ({"intended_role": "bad"}, "intended_role"),
        ({"primary_reference": "http://not-primary"}, "HTTPS"),
        ({"evidence_gap": "short"}, "exact evidence gap"),
        ({"disposition": BatteryDisposition.ADOPT}, "REFERENCE_ONLY"),
    ],
)
def test_reference_contract_cannot_claim_implementation_or_weaker_gap(
    changes: dict[str, object], message: str
) -> None:
    with pytest.raises(ContractValueError, match=message):
        replace(REFERENCE_MODELS[0], **changes)  # type: ignore[arg-type]


def test_current_failed_gate_cannot_bind_q14_or_create_a_validation_path() -> None:
    report = evaluate_deep_data_sufficiency(frozen_q13_sufficiency_evidence())
    with pytest.raises(ContractValueError, match="DEEP_DATA_SUFFICIENCY_GATE_FAILED"):
        bind_q14_validation(
            report,
            candidate_id="future-candidate-v1",
            family=DeepFamily.SIMPLE_MLP,
            sample_set_digest=_digest("5"),
            walk_forward_plan_digest=_digest("6"),
            lineage=_lineage(),
        )


def test_future_binding_requires_a_passed_gate_and_exact_lineage() -> None:
    binding = bind_q14_validation(
        _passed_report(),
        candidate_id="future-candidate-v1",
        family=DeepFamily.SIMPLE_MLP,
        sample_set_digest=_digest("5"),
        walk_forward_plan_digest=_digest("6"),
        lineage=_lineage(),
    )
    assert binding.q14_factory_revision == "q14.validation.v1"
    assert binding.as_mapping()["schema"] == "Q13Q14DeepValidationBindingV1"
    assert binding.digest() == binding.digest()

    with pytest.raises(ContractValueError, match="report must"):
        bind_q14_validation(
            "bad",  # type: ignore[arg-type]
            candidate_id="future-candidate-v1",
            family=DeepFamily.SIMPLE_MLP,
            sample_set_digest=_digest("5"),
            walk_forward_plan_digest=_digest("6"),
            lineage=_lineage(),
        )
    with pytest.raises(ContractValueError, match="lineage must"):
        bind_q14_validation(
            _passed_report(),
            candidate_id="future-candidate-v1",
            family=DeepFamily.SIMPLE_MLP,
            sample_set_digest=_digest("5"),
            walk_forward_plan_digest=_digest("6"),
            lineage="bad",  # type: ignore[arg-type]
        )
    with pytest.raises(ContractValueError, match="does not match"):
        bind_q14_validation(
            _passed_report(),
            candidate_id="different",
            family=DeepFamily.SIMPLE_MLP,
            sample_set_digest=_digest("5"),
            walk_forward_plan_digest=_digest("6"),
            lineage=_lineage(),
        )


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"family": "bad"}, "family must"),
        ({"sample_set_digest": "bad"}, "sample_set_digest"),
        ({"walk_forward_plan_digest": "bad"}, "walk_forward_plan_digest"),
        ({"lineage_digest": "bad"}, "lineage_digest"),
        ({"sufficiency_report_digest": "bad"}, "sufficiency_report_digest"),
        ({"q14_factory_revision": "bad revision"}, "contract identifier"),
    ],
)
def test_binding_contract_is_digest_bound(changes: dict[str, object], message: str) -> None:
    base = Q14DeepValidationBindingV1(
        candidate_id="future-candidate-v1",
        family=DeepFamily.SIMPLE_MLP,
        sample_set_digest=_digest("5"),
        walk_forward_plan_digest=_digest("6"),
        lineage_digest=_digest("7"),
        sufficiency_report_digest=_digest("8"),
    )
    with pytest.raises(ContractValueError, match=message):
        replace(base, **changes)  # type: ignore[arg-type]


def test_direct_reference_constructor_uses_existing_q10_disposition_vocabulary() -> None:
    model = DeepModelReferenceV1(
        model_id="direct-reference-v0",
        family=DeepFamily.SIMPLE_MLP,
        intended_role=IntendedRole.SIMPLE_TEMPORAL_BASELINE,
        primary_reference="https://arxiv.org/abs/2502.15757",
        evidence_gap=EXACT_EVIDENCE_GAP,
    )
    assert model.as_disposition_record().disposition is BatteryDisposition.REFERENCE_ONLY
