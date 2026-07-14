"""Deterministic Q13 evidence projection; no model training or inference."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from quant_edge.canonical import canonical_json_bytes
from quant_edge.deep.fixtures import (
    FIXTURE_SEED,
    frozen_q13_sufficiency_evidence,
    interface_fixture_digest,
    interface_fixture_mapping,
    synthetic_q14_sample_set,
)
from quant_edge.deep.references import (
    REFERENCE_MODELS,
    reference_catalog_digest,
    reference_catalog_mapping,
)
from quant_edge.deep.sufficiency import DeepDataSufficiencyReportV1, evaluate_deep_data_sufficiency
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ZERO_RATIO
from quant_edge.lake.contracts import DigestV1
from quant_edge.validation import (
    CostStressScenarioV1,
    LeakageSpecV1,
    MetricKind,
    OpportunityDecayV1,
    PrimaryMetricSpecV1,
    StressSpecV1,
    assess_leakage,
    falsify_lineage,
    future_leaked_predictions,
    run_cost_stress,
)


@dataclass(frozen=True, slots=True)
class Q13CampaignV1:
    sufficiency: DeepDataSufficiencyReportV1
    temporal_leak_verdict: str
    forged_lineage_verdict: str
    unknown_cost_abstain_count: int
    synthetic_sample_count: int
    interface_fixture_sha256: str
    reference_catalog_sha256: str

    def as_mapping(self) -> dict[str, object]:
        return {
            "claims": {
                "actionability": "UNAVAILABLE",
                "benchmark": "NOT_RUN",
                "calibration": "UNAVAILABLE",
                "edge": "UNAVAILABLE",
                "modelTraining": "NOT_PERMITTED",
                "probability": "UNAVAILABLE",
            },
            "evidencePosture": "SYNTHETIC_INTERFACE_PROOF_ONLY",
            "fixtureSeed": str(FIXTURE_SEED),
            "interfaceFixtureSha256": self.interface_fixture_sha256,
            "q14AdversarialProbe": {
                "forgedLineageVerdict": self.forged_lineage_verdict,
                "temporalLeakVerdict": self.temporal_leak_verdict,
            },
            "referenceCatalogSha256": self.reference_catalog_sha256,
            "referenceModels": [model.as_mapping() for model in REFERENCE_MODELS],
            "schema": "Q13DeepGateCampaignV1",
            "sufficiency": self.sufficiency.as_mapping(),
            "syntheticSampleCount": self.synthetic_sample_count,
            "unknownCostAbstainCount": self.unknown_cost_abstain_count,
            "version": 1,
        }

    def digest(self) -> DigestV1:
        return DigestV1(
            hexdigest=hashlib.sha256(canonical_json_bytes(self.as_mapping())).hexdigest()
        )


def _leakage_spec() -> LeakageSpecV1:
    return LeakageSpecV1(
        primary=PrimaryMetricSpecV1(kind=MetricKind.PR_AUC, k=None, ece_bins=None),
        implausible_skill=FixedPointV1(999_000_000_000),
        band_seed=FIXTURE_SEED,
        band_replicates=8,
    )


def _unknown_cost_abstain_count() -> int:
    samples = synthetic_q14_sample_set()
    zero = CostStressScenarioV1(
        scenario_id="zero-delta",
        fee_delta=ZERO_RATIO,
        slippage_delta=ZERO_RATIO,
        funding_delta=ZERO_RATIO,
        borrow_delta=ZERO_RATIO,
        recovery_delta=ZERO_RATIO,
        latency_ns=0,
    )
    report = run_cost_stress(
        samples,
        StressSpecV1(
            act_threshold=ZERO_RATIO,
            decay=OpportunityDecayV1(decay_ratio_per_second=ZERO_RATIO),
            scenarios=(zero,),
        ),
    )
    return report.outcomes[0].abstain_count


def build_q13_campaign() -> Q13CampaignV1:
    sufficiency = evaluate_deep_data_sufficiency(frozen_q13_sufficiency_evidence())
    samples = synthetic_q14_sample_set()
    leak = future_leaked_predictions(samples, model_id="q13-deliberate-future-leak")
    temporal = assess_leakage(samples, leak, _leakage_spec())
    forged = assess_leakage(samples, falsify_lineage(leak, samples), _leakage_spec())
    return Q13CampaignV1(
        sufficiency=sufficiency,
        temporal_leak_verdict=temporal.verdict.value,
        forged_lineage_verdict=forged.verdict.value,
        unknown_cost_abstain_count=_unknown_cost_abstain_count(),
        synthetic_sample_count=len(samples.samples),
        interface_fixture_sha256=interface_fixture_digest().hexdigest,
        reference_catalog_sha256=reference_catalog_digest().hexdigest,
    )


def render_campaign_markdown(campaign: Q13CampaignV1) -> str:
    return "\n".join(
        (
            "# Q13 deep-sequence gate campaign",
            "",
            f"- Sufficiency: `{campaign.sufficiency.status.value}`",
            "- Deep model disposition: `REFERENCE_ONLY` (3/3)",
            f"- Q14 temporal leak verdict: `{campaign.temporal_leak_verdict}`",
            f"- Q14 forged-lineage verdict: `{campaign.forged_lineage_verdict}`",
            (
                "- Unknown-cost abstentions: "
                f"`{campaign.unknown_cost_abstain_count}/{campaign.synthetic_sample_count}`"
            ),
            "- Model training/benchmark: `NOT_PERMITTED` / `NOT_RUN`",
            f"- Campaign SHA-256: `{campaign.digest().hexdigest}`",
            "",
            "Synthetic probes prove interface behavior only; they are not market evidence.",
            "",
        )
    )


def generated_artifacts() -> dict[str, bytes]:
    """Canonical generated bytes keyed by the Q13 generated basename."""

    campaign = build_q13_campaign()
    return {
        "data_sufficiency.v1.json": canonical_json_bytes(campaign.sufficiency.as_mapping()),
        "interface_fixture.v1.json": canonical_json_bytes(interface_fixture_mapping()),
        "q13_campaign.v1.json": canonical_json_bytes(campaign.as_mapping()),
        "q13_campaign.v1.md": render_campaign_markdown(campaign).encode(),
        "reference_catalog.v1.json": canonical_json_bytes(reference_catalog_mapping()),
    }
