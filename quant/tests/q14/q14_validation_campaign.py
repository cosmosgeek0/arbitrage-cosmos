"""Deterministic Q14 validation-factory campaign and golden-fixture builder.

Usage: ``python tests/q14/q14_validation_campaign.py OUTPUT_ROOT``

Writes, byte-deterministically and without any network, environment or ambient-time
access:

- ``OUTPUT_ROOT/generated/q14/q14_validation_golden_v1.json``
- ``OUTPUT_ROOT/generated/q14/validation_campaign.v1.json``
- ``OUTPUT_ROOT/generated/q14/validation_campaign.v1.md``

Everything here is SYNTHETIC fixture evidence proving the §16 falsification machinery;
no metric is claimed to describe a real market, model or edge.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from quant_edge.canonical import canonical_json_bytes
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.randomness import DeterministicRandom
from quant_edge.validation.bootstrap import BootstrapSpecV1, block_bootstrap_interval
from quant_edge.validation.comparison import (
    ComparisonSpecV1,
    compare_models,
    render_comparison_markdown,
)
from quant_edge.validation.controls import (
    falsify_lineage,
    future_leaked_predictions,
    random_rank_predictions,
)
from quant_edge.validation.dsr import DsrInputsV1, deflated_sharpe_ratio
from quant_edge.validation.leakage import LeakageSpecV1, LeakageVerdict, assess_leakage
from quant_edge.validation.metrics import MetricKind, PrimaryMetricSpecV1
from quant_edge.validation.multiplicity import (
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    benjamini_hochberg,
    pbo_cscv,
)
from quant_edge.validation.samples import (
    PredictionSetV1,
    PredictionV1,
    SampleSetV1,
    ValidationSampleV1,
)
from quant_edge.validation.splits import (
    HoldoutGrantV1,
    SplitScheme,
    WalkForwardSpecV1,
    build_walk_forward_plan,
)
from quant_edge.validation.stress import (
    CostStressScenarioV1,
    OpportunityDecayV1,
    StressSpecV1,
    run_cost_stress,
)

CAMPAIGN_SEED = 20260712
SEEDED_DATASETS = 8
BASE_NS = 1_772_000_000_000_000_000
HOUR_NS = 3_600_000_000_000
ZERO = make_ratio(0, 1)


def _dataset(rng: DeterministicRandom, *, dataset_id: str, count: int) -> SampleSetV1:
    samples: list[ValidationSampleV1] = []
    for index in range(count):
        outcome = rng.next_u64() % 3 == 0
        horizon = (1 + int(rng.next_u64() % 3)) * (HOUR_NS // 4)
        samples.append(
            ValidationSampleV1(
                sample_id=f"s-{index:04d}",
                symbol="BNBUSDT",
                group_id=f"g-{index:04d}",
                cutoff_ns=BASE_NS + index * HOUR_NS,
                label_end_ns=BASE_NS + index * HOUR_NS + horizon,
                strata=(("liquidity", "mid"),),
                binary_outcome=outcome,
                gross_edge_ratio=make_ratio(2 + int(rng.next_u64() % 4), 1_000),
                base_cost_ratio=make_ratio(1, 1_000),
                quality=QualityState.SYNTHETIC,
            )
        )
    return SampleSetV1(
        dataset_id=dataset_id,
        posture=EvidencePosture.SYNTHETIC,
        samples=tuple(samples),
    )


def _informative(samples: SampleSetV1, *, model_id: str) -> PredictionSetV1:
    predictions = []
    for position, sample in enumerate(sorted(samples.samples, key=lambda sample: sample.sample_id)):
        noisy = position % 5 == 0
        skilled = bool(sample.binary_outcome) != noisy
        score = make_ratio(7, 10) if skilled else make_ratio(3, 10)
        predictions.append(
            PredictionV1(
                sample_id=sample.sample_id,
                score=score,
                max_feature_asof_ns=sample.cutoff_ns,
            )
        )
    return PredictionSetV1(
        model_id=model_id,
        dataset_digest=samples.digest(),
        predictions=tuple(predictions),
    )


def _walk_spec() -> WalkForwardSpecV1:
    return WalkForwardSpecV1(
        scheme=SplitScheme.EXPANDING,
        fold_count=4,
        max_label_horizon_ns=HOUR_NS,
        max_feature_lookback_ns=0,
        embargo_ns=HOUR_NS,
        min_train_size=4,
        holdout_fraction=make_ratio(1, 5),
        rolling_train_size=None,
    )


def _leakage_spec() -> LeakageSpecV1:
    return LeakageSpecV1(
        primary=PrimaryMetricSpecV1(kind=MetricKind.PR_AUC, k=None, ece_bins=None),
        implausible_skill=FixedPointV1(990_000_000_000),
        band_seed=CAMPAIGN_SEED,
        band_replicates=32,
    )


def _comparison_spec() -> ComparisonSpecV1:
    return ComparisonSpecV1(
        primary=PrimaryMetricSpecV1(kind=MetricKind.PR_AUC, k=None, ece_bins=None),
        bootstrap=BootstrapSpecV1(
            seed=CAMPAIGN_SEED,
            block_length=1,
            replicates=128,
            coverage_per_myriad=9_000,
        ),
        leakage=_leakage_spec(),
    )


def _ledger() -> TrialLedgerV1:
    return TrialLedgerV1(
        trials=(
            TrialRecordV1(
                trial_id="t-000",
                family_id="family-golden",
                model_id="random-baseline",
                metric_id="pr_auc",
                status=TrialStatus.COMPLETED,
                note="seeded no-skill baseline",
            ),
            TrialRecordV1(
                trial_id="t-001",
                family_id="family-golden",
                model_id="informative-challenger",
                metric_id="pr_auc",
                status=TrialStatus.COMPLETED,
                note="synthetic skilled challenger",
            ),
            TrialRecordV1(
                trial_id="t-002",
                family_id="family-golden",
                model_id="abandoned-variant",
                metric_id="pr_auc",
                status=TrialStatus.ABANDONED,
                note="abandoned during search; ledgered per §16.3",
            ),
        )
    )


def _stress_spec() -> StressSpecV1:
    return StressSpecV1(
        act_threshold=make_ratio(1, 1_000),
        decay=OpportunityDecayV1(decay_ratio_per_second=make_ratio(1, 1_000)),
        scenarios=(
            CostStressScenarioV1(
                scenario_id="base-echo",
                fee_delta=ZERO,
                slippage_delta=ZERO,
                funding_delta=ZERO,
                borrow_delta=ZERO,
                recovery_delta=ZERO,
                latency_ns=0,
            ),
            CostStressScenarioV1(
                scenario_id="fee-slippage-shock",
                fee_delta=make_ratio(3, 1_000),
                slippage_delta=make_ratio(2, 1_000),
                funding_delta=ZERO,
                borrow_delta=ZERO,
                recovery_delta=ZERO,
                latency_ns=0,
            ),
            CostStressScenarioV1(
                scenario_id="latency-shock",
                fee_delta=ZERO,
                slippage_delta=ZERO,
                funding_delta=ZERO,
                borrow_delta=ZERO,
                recovery_delta=ZERO,
                latency_ns=5_000_000_000,
            ),
        ),
    )


def _pbo_matrix(rng: DeterministicRandom) -> tuple[tuple[ExactRatioV1, ...], ...]:
    return tuple(
        tuple(make_ratio(int(rng.next_u64() % 2_001) - 1_000, 10_000) for _ in range(8))
        for _ in range(6)
    )


def _returns(rng: DeterministicRandom, count: int) -> tuple[ExactRatioV1, ...]:
    return tuple(make_ratio(int(rng.next_u64() % 601) - 250, 10_000) for _ in range(count))


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    rng = DeterministicRandom.from_seed(CAMPAIGN_SEED)

    # Golden scenario: one dataset, full factory pass.
    samples = _dataset(rng, dataset_id="q14-golden", count=80)
    plan = build_walk_forward_plan(samples, _walk_spec())
    leakage_spec = _leakage_spec()

    leaked = future_leaked_predictions(samples, model_id="leaked-model")
    forged = falsify_lineage(leaked, samples)
    honest = random_rank_predictions(samples, seed=7, model_id="random-baseline")
    challenger = _informative(samples, model_id="informative-challenger")

    leaked_assessment = assess_leakage(samples, leaked, leakage_spec)
    forged_assessment = assess_leakage(samples, forged, leakage_spec)
    honest_assessment = assess_leakage(samples, honest, leakage_spec)

    grant = HoldoutGrantV1(
        grant_id="grant-golden-final",
        reason="single final holdout read for the golden comparison fixture",
        plan_digest=plan.digest(),
    )
    comparison = compare_models(
        samples,
        plan,
        honest,
        challenger,
        _ledger(),
        _comparison_spec(),
        holdout_grant=grant,
    )

    stress = run_cost_stress(samples, _stress_spec())
    pbo = pbo_cscv(_pbo_matrix(rng))
    dsr = deflated_sharpe_ratio(
        DsrInputsV1(
            returns=_returns(rng, 48),
            trial_count=24,
            trial_sr_variance=make_ratio(1, 100),
        )
    )
    interval = block_bootstrap_interval(
        _returns(rng, 24),
        BootstrapSpecV1(
            seed=CAMPAIGN_SEED,
            block_length=3,
            replicates=256,
            coverage_per_myriad=9_500,
        ),
    )
    bh = benjamini_hochberg(
        (
            ("t-000", make_ratio(4, 10)),
            ("t-001", make_ratio(1, 1_000)),
            ("t-002", make_ratio(8, 10)),
        ),
        fdr_per_myriad=500,
    )

    fixture_mapping: dict[str, object] = {
        "bootstrapInterval": interval.as_mapping(),
        "comparison": comparison.as_mapping(),
        "datasetDigest": samples.digest().hexdigest,
        "deflatedSharpe": dsr.as_mapping(),
        "forgedAssessment": forged_assessment.as_mapping(),
        "honestAssessment": honest_assessment.as_mapping(),
        "leakedAssessment": leaked_assessment.as_mapping(),
        "multipleTesting": bh.as_mapping(),
        "pbo": pbo.as_mapping(),
        "plan": plan.as_mapping(),
        "schema": "Q14ValidationGoldenFixtureV1",
        "seed": str(CAMPAIGN_SEED),
        "stress": stress.as_mapping(),
        "trialLedger": _ledger().as_mapping(),
        "version": 1,
    }
    fixture_bytes = canonical_json_bytes(fixture_mapping)

    # Seeded rejection battery: the deliberate leak must be rejected on every
    # dataset, on both detection paths, and the honest baseline must never be
    # rejected as a leak.
    battery = []
    temporal_rejections = 0
    behavioral_rejections = 0
    honest_accepted = 0
    for index in range(SEEDED_DATASETS):
        seeded = _dataset(rng, dataset_id=f"q14-battery-{index:02d}", count=40)
        seeded_leak = future_leaked_predictions(seeded, model_id=f"leak-{index:02d}")
        seeded_forged = falsify_lineage(seeded_leak, seeded)
        seeded_honest = random_rank_predictions(
            seeded, seed=CAMPAIGN_SEED + index, model_id=f"baseline-{index:02d}"
        )
        truthful = assess_leakage(seeded, seeded_leak, leakage_spec)
        behavioral = assess_leakage(seeded, seeded_forged, leakage_spec)
        honest_run = assess_leakage(seeded, seeded_honest, leakage_spec)
        temporal_rejections += int(truthful.verdict is LeakageVerdict.REJECTED_TEMPORAL_LEAK)
        behavioral_rejections += int(
            behavioral.verdict is LeakageVerdict.REJECTED_IMPLAUSIBLE_SKILL
        )
        honest_accepted += int(honest_run.verdict is LeakageVerdict.ACCEPTED_FOR_COMPARISON)
        battery.append(
            {
                "behavioralVerdict": behavioral.verdict.value,
                "datasetDigest": seeded.digest().hexdigest,
                "datasetId": seeded.dataset_id,
                "honestVerdict": honest_run.verdict.value,
                "temporalVerdict": truthful.verdict.value,
            }
        )

    campaign_mapping: dict[str, object] = {
        "battery": battery,
        "batteryDatasets": SEEDED_DATASETS,
        "behavioralRejections": behavioral_rejections,
        "comparisonVerdict": comparison.verdict.value,
        "goldenFixtureSha256": _sha256(fixture_bytes),
        "honestAccepted": honest_accepted,
        "schema": "Q14ValidationCampaignV1",
        "seed": str(CAMPAIGN_SEED),
        "stressFlipsFeeSlippage": stress.outcomes[1].flipped_from_base_count,
        "stressFlipsLatency": stress.outcomes[2].flipped_from_base_count,
        "temporalRejections": temporal_rejections,
        "version": 1,
    }
    campaign_bytes = canonical_json_bytes(campaign_mapping)

    markdown_lines = [
        "# Q14 validation-factory campaign (SYNTHETIC evidence)",
        "",
        f"- Seed: `{CAMPAIGN_SEED}`",
        f"- Golden fixture SHA-256: `{_sha256(fixture_bytes)}`",
        f"- Campaign JSON SHA-256: `{_sha256(campaign_bytes)}`",
        f"- Golden dataset digest: `{samples.digest().hexdigest}`",
        f"- Leaked model (true lineage): `{leaked_assessment.verdict.value}`",
        f"- Leaked model (falsified lineage): `{forged_assessment.verdict.value}`",
        f"- Honest baseline: `{honest_assessment.verdict.value}`",
        (
            f"- Rejection battery: {temporal_rejections}/{SEEDED_DATASETS} temporal, "
            f"{behavioral_rejections}/{SEEDED_DATASETS} behavioral, "
            f"{honest_accepted}/{SEEDED_DATASETS} honest baselines accepted"
        ),
        f"- Comparison verdict (challenger vs baseline): `{comparison.verdict.value}`",
        (
            f"- Stress flips to non-actionable: fee/slippage "
            f"{stress.outcomes[1].flipped_from_base_count}, latency "
            f"{stress.outcomes[2].flipped_from_base_count} "
            f"of {stress.base_actionable_count} base-actionable"
        ),
        f"- PBO: `{pbo.status.value}`",
        f"- DSR: `{dsr.status.value}`",
        "",
        "No claim of real-market validity is made; every input is a seeded synthetic",
        "fixture proving only that the falsification machinery works.",
        "",
        "## Golden comparison report",
        "",
        render_comparison_markdown(comparison),
    ]
    markdown_bytes = "\n".join(markdown_lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write("usage: q14_validation_campaign.py OUTPUT_ROOT\n")
        return 2
    output_root = Path(argv[1])
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    generated = output_root / "generated" / "q14"
    generated.mkdir(parents=True, exist_ok=True)
    (generated / "q14_validation_golden_v1.json").write_bytes(fixture_bytes)
    (generated / "validation_campaign.v1.json").write_bytes(campaign_bytes)
    (generated / "validation_campaign.v1.md").write_bytes(markdown_bytes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
