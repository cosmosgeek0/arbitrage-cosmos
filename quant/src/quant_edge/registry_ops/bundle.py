"""Strict Q10/Q11/Q14 artifact adapters and deterministic Q15 card bundle."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.registry_ops.artifacts import (
    Q10_CAMPAIGN_SCHEMA,
    Q10_GOLDEN_SCHEMA,
    Q11_CAMPAIGN_SCHEMA,
    Q11_GOLDEN_SCHEMA,
    Q14_CAMPAIGN_SCHEMA,
    Q14_GOLDEN_SCHEMA,
    digest_file,
    verify_json_artifact,
)
from quant_edge.registry_ops.contracts import (
    ArtifactKind,
    ArtifactManifestV1,
    ArtifactRefV1,
    ChampionSnapshotV1,
    DatasetCardV1,
    DelayedFeedbackV1,
    EvidencePosture,
    ExperimentCardV1,
    FeedbackState,
    ModelCardV1,
    ModelLifecycle,
    ModelRegistrationV1,
    OutcomeDisposition,
    OutcomeReality,
    PromotionGateV1,
    ShadowComparisonV1,
    ShadowPredictionV1,
    ShadowScoreBatchV1,
    ValidationBindingV1,
    mapping_digest,
)

Q10_GOLDEN_SHA256: Final = "874b2cd9af4ce3ebd5c590fbf3f458b8145e8e76f762d29798be9592bd22833e"
Q10_DATASET_SHA256: Final = "127281fbde3e7f8c4143f85fe6f867720138158ffc0446342bfa96ef5da37375"
Q10_CAMPAIGN_SHA256: Final = "ab1f8a607d437eb4d98dc3e284a3e08999712269984dc45bd18fb9ca70b6541f"
Q11_GOLDEN_SHA256: Final = "b3041042e63b98d4d70367b13cff4f04abe82c1169f8fb066b6d6c8088aef99b"
Q11_CAMPAIGN_SHA256: Final = "6d35ef2d42d627c1cf3a95a7ca77be50daea64655c8366d46b0382f59a9582c1"
Q14_GOLDEN_SHA256: Final = "539c95b264333208dfd37c96856be32bd130b41907560558a38bd323e53b20c9"
Q14_CAMPAIGN_SHA256: Final = "a0522034a97c2676d4af31c7b22c10412ebb06a115df4de72f307081b23d9f87"
UV_LOCK_SHA256: Final = "716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29"
Q06_GOLDEN_SHA256: Final = "06c81655ebb61a6311f29f7964d99b6d4dca94d7a1f8c2416d922fda3fcbabb3"
HYPOTHESIS_REGISTRY_SHA256: Final = (
    "24c78ece6b0d6fb7307ba3b6fb01a396632db5ca557a7d52889e890b3912425e"
)
Q15_SYNTHETIC_PROMOTION_SHA256: Final = (
    "12042d41e7ca727801fbd5b2871d5fb24b2768e5372c36f02699a5ec24f01f3c"
)


@dataclass(frozen=True, slots=True)
class MergedQ15BundleV1:
    artifact_manifest: ArtifactManifestV1
    dataset_card: DatasetCardV1
    q11_dataset_card: DatasetCardV1
    q11_model_card: ModelCardV1
    q10_baseline_model_card: ModelCardV1
    q10_model_card: ModelCardV1
    experiment_card: ExperimentCardV1
    q11_registration: ModelRegistrationV1
    q10_baseline_registration: ModelRegistrationV1
    q10_registration: ModelRegistrationV1

    def artifact(self, artifact_id: str) -> ArtifactRefV1:
        for artifact in self.artifact_manifest.artifacts:
            if artifact.artifact_id == artifact_id:
                return artifact
        raise ContractValueError(f"unknown merged artifact: {artifact_id}")


def synthetic_shadow_records(
    bundle: MergedQ15BundleV1,
    champion: ChampionSnapshotV1,
) -> tuple[ShadowScoreBatchV1, DelayedFeedbackV1, ShadowComparisonV1]:
    outcome = 1
    champion_score_micros = 200_000
    challenger_score_micros = 900_000

    def brier_loss_micros(score_micros: int) -> int:
        error_micros = score_micros - (outcome * 1_000_000)
        return (error_micros * error_micros) // 1_000_000

    champion_loss = brier_loss_micros(champion_score_micros)
    challenger_loss = brier_loss_micros(challenger_score_micros)
    verdict = "PASS" if challenger_loss < champion_loss else "FAIL"
    batch = ShadowScoreBatchV1(
        batch_id="q15.synthetic-shadow.v1",
        slot_id=champion.slot_id,
        event_id="q15.synthetic-event.v1",
        target_id="transition_binary:v1",
        feature_cutoff_ms=1_783_890_000_010,
        horizon_ms=1_000,
        champion_generation=champion.generation,
        champion_transition_id=champion.transition_id,
        champion=ShadowPredictionV1(
            champion.model_id,
            champion.model_revision,
            champion.artifact_sha256,
            mapping_digest({"scoreMicros": str(champion_score_micros)}),
            champion_score_micros,
        ),
        challengers=(
            ShadowPredictionV1(
                bundle.q10_registration.model_id,
                bundle.q10_registration.model_revision,
                bundle.q10_registration.artifact.sha256,
                mapping_digest({"scoreMicros": str(challenger_score_micros)}),
                challenger_score_micros,
            ),
        ),
        disposition=OutcomeDisposition.QUIET_CONTROL,
        reality=OutcomeReality.HYPOTHETICAL,
    )
    feedback = DelayedFeedbackV1(
        feedback_id="q15.synthetic-feedback.v1",
        batch_id=batch.batch_id,
        event_id=batch.event_id,
        target_id=batch.target_id,
        horizon_ms=batch.horizon_ms,
        source_revision="q15.synthetic-outcome.v1",
        observed_at_ms=batch.matures_at_ms,
        state=FeedbackState.AVAILABLE,
        outcome_digest=mapping_digest({"outcomeMicros": str(outcome * 1_000_000)}),
        outcome_micros=outcome * 1_000_000,
    )
    comparison = ShadowComparisonV1(
        comparison_id="q15.synthetic-shadow-comparison.v1",
        slot_id=batch.slot_id,
        target_id=batch.target_id,
        horizon_ms=batch.horizon_ms,
        champion_generation=batch.champion_generation,
        champion_transition_id=batch.champion_transition_id,
        champion_model_id=champion.model_id,
        champion_model_revision=champion.model_revision,
        champion_artifact_sha256=champion.artifact_sha256,
        challenger_model_id=bundle.q10_registration.model_id,
        challenger_model_revision=bundle.q10_registration.model_revision,
        challenger_artifact_sha256=bundle.q10_registration.artifact.sha256,
        batch_ids=(batch.batch_id,),
        feedback_digests=(feedback.content_digest,),
        metric_id="brier_loss_micros:v1",
        champion_metric_micros=champion_loss,
        challenger_metric_micros=challenger_loss,
        verdict=verdict,
        posture=EvidencePosture.SYNTHETIC_ONLY,
    )
    return batch, feedback, comparison


def synthetic_promotion_binding(
    bundle: MergedQ15BundleV1,
    *,
    shadow_report_sha256: DigestV1,
) -> ValidationBindingV1:
    """Explicit fixture gate; it is never evidence that Q10/Q11 passed Q14."""

    return ValidationBindingV1(
        evidence_id="q15.synthetic-promotion-binding.v1",
        subject_model_id=bundle.q10_registration.model_id,
        subject_model_revision=bundle.q10_registration.model_revision,
        subject_artifact_sha256=bundle.q10_registration.artifact.sha256,
        report_artifact=bundle.artifact("q15.synthetic-promotion-report.v1"),
        report_baseline_model_id=bundle.q10_baseline_registration.model_id,
        report_challenger_model_id=bundle.q10_registration.model_id,
        report_verdict="SYNTHETIC_FIXTURE_PASS",
        shadow_report_sha256=shadow_report_sha256,
        posture=EvidencePosture.SYNTHETIC_ONLY,
        gates=PromotionGateV1(
            immutable_inputs=True,
            leakage_negative_controls=True,
            chronological_primary_metric=True,
            calibration=True,
            costs_latency=True,
            inference_resources=True,
            critical_regimes_tails=True,
            cards_complete=True,
            mature_shadow_comparison=True,
            auditable_record=True,
        ),
    )


def mismatched_q14_binding(
    bundle: MergedQ15BundleV1,
    *,
    shadow_report_sha256: DigestV1,
) -> ValidationBindingV1:
    """The accepted Q14 report is deliberately represented with its real subjects."""

    fixture = synthetic_promotion_binding(
        bundle,
        shadow_report_sha256=shadow_report_sha256,
    )
    return ValidationBindingV1(
        evidence_id="q15.q14-identity-mismatch.v1",
        subject_model_id=fixture.subject_model_id,
        subject_model_revision=fixture.subject_model_revision,
        subject_artifact_sha256=fixture.subject_artifact_sha256,
        report_artifact=bundle.artifact("q14.validation-golden.v1"),
        report_baseline_model_id="random-baseline",
        report_challenger_model_id="informative-challenger",
        report_verdict="IMPROVES",
        shadow_report_sha256=fixture.shadow_report_sha256,
        posture=EvidencePosture.SYNTHETIC_ONLY,
        gates=fixture.gates,
    )


def _reference(
    root: Path,
    *,
    artifact_id: str,
    kind: ArtifactKind,
    schema_name: str,
    schema_version: int,
    relative_path: str,
    expected_sha256: str,
    media_type: str = "application/json",
) -> ArtifactRefV1:
    digest, size = digest_file(root / relative_path)
    if digest.hexdigest != expected_sha256:
        raise ContractValueError(f"accepted artifact drifted: {artifact_id}")
    return ArtifactRefV1(
        artifact_id=artifact_id,
        kind=kind,
        schema_name=schema_name,
        schema_version=schema_version,
        relative_path=relative_path,
        sha256=digest,
        byte_length=size,
        media_type=media_type,
    )


def build_merged_q15_bundle(
    repo_root: Path,
    *,
    code_commit: str,
    recorded_at_ms: int,
) -> MergedQ15BundleV1:
    """Bind exact accepted artifacts; no foreign model is loaded or reimplemented."""

    q10_golden = _reference(
        repo_root,
        artifact_id="q10.model-golden.v1",
        kind=ArtifactKind.MODEL_EVIDENCE,
        schema_name=Q10_GOLDEN_SCHEMA.schema_name,
        schema_version=1,
        relative_path="quant/fixtures/q10_model_golden_v1.json",
        expected_sha256=Q10_GOLDEN_SHA256,
    )
    q10_campaign = _reference(
        repo_root,
        artifact_id="q10.model-campaign.v1",
        kind=ArtifactKind.EXPERIMENT,
        schema_name=Q10_CAMPAIGN_SCHEMA.schema_name,
        schema_version=1,
        relative_path="quant/generated/q10/model_campaign.v1.json",
        expected_sha256=Q10_CAMPAIGN_SHA256,
    )
    q11_golden = _reference(
        repo_root,
        artifact_id="q11.survival-golden.v1",
        kind=ArtifactKind.MODEL_PAYLOAD,
        schema_name=Q11_GOLDEN_SCHEMA.schema_name,
        schema_version=1,
        relative_path="quant/generated/q11/survival_golden_v1.json",
        expected_sha256=Q11_GOLDEN_SHA256,
    )
    q11_campaign = _reference(
        repo_root,
        artifact_id="q11.survival-campaign.v1",
        kind=ArtifactKind.EXPERIMENT,
        schema_name=Q11_CAMPAIGN_SCHEMA.schema_name,
        schema_version=1,
        relative_path="quant/generated/q11/survival_campaign.v1.json",
        expected_sha256=Q11_CAMPAIGN_SHA256,
    )
    q14_golden = _reference(
        repo_root,
        artifact_id="q14.validation-golden.v1",
        kind=ArtifactKind.VALIDATION_REPORT,
        schema_name=Q14_GOLDEN_SCHEMA.schema_name,
        schema_version=1,
        relative_path="quant/generated/q14/q14_validation_golden_v1.json",
        expected_sha256=Q14_GOLDEN_SHA256,
    )
    q14_campaign = _reference(
        repo_root,
        artifact_id="q14.validation-campaign.v1",
        kind=ArtifactKind.VALIDATION_REPORT,
        schema_name=Q14_CAMPAIGN_SCHEMA.schema_name,
        schema_version=1,
        relative_path="quant/generated/q14/validation_campaign.v1.json",
        expected_sha256=Q14_CAMPAIGN_SHA256,
    )
    uv_lock = _reference(
        repo_root,
        artifact_id="q01.uv-lock",
        kind=ArtifactKind.DEPENDENCY_LOCK,
        schema_name="UvLockV1",
        schema_version=1,
        relative_path="quant/uv.lock",
        expected_sha256=UV_LOCK_SHA256,
        media_type="application/toml",
    )
    q06_golden = _reference(
        repo_root,
        artifact_id="q06.feature-golden.v1",
        kind=ArtifactKind.FEATURE_REGISTRY,
        schema_name="Q06FeatureGoldenFixtureV1",
        schema_version=1,
        relative_path="quant/fixtures/q06_feature_golden_v1.json",
        expected_sha256=Q06_GOLDEN_SHA256,
    )
    hypotheses = _reference(
        repo_root,
        artifact_id="q01.edge-hypotheses.v1",
        kind=ArtifactKind.HYPOTHESIS_REGISTRY,
        schema_name="EdgeHypothesisRegistryV1",
        schema_version=1,
        relative_path="quant/registry/edge_hypotheses.v1.json",
        expected_sha256=HYPOTHESIS_REGISTRY_SHA256,
    )
    synthetic_promotion = _reference(
        repo_root,
        artifact_id="q15.synthetic-promotion-report.v1",
        kind=ArtifactKind.VALIDATION_REPORT,
        schema_name="Q15SyntheticPromotionReportV1",
        schema_version=1,
        relative_path="quant/generated/q15/synthetic_promotion_report.v1.json",
        expected_sha256=Q15_SYNTHETIC_PROMOTION_SHA256,
    )

    verify_json_artifact(repo_root, q10_golden, Q10_GOLDEN_SCHEMA)
    verify_json_artifact(repo_root, q10_campaign, Q10_CAMPAIGN_SCHEMA)
    verify_json_artifact(repo_root, q11_golden, Q11_GOLDEN_SCHEMA)
    verify_json_artifact(repo_root, q11_campaign, Q11_CAMPAIGN_SCHEMA)
    verify_json_artifact(repo_root, q14_golden, Q14_GOLDEN_SCHEMA)
    verify_json_artifact(repo_root, q14_campaign, Q14_CAMPAIGN_SCHEMA)

    artifacts = tuple(
        sorted(
            (
                hypotheses,
                uv_lock,
                q06_golden,
                q10_campaign,
                q10_golden,
                q11_campaign,
                q11_golden,
                q14_campaign,
                q14_golden,
                synthetic_promotion,
            ),
            key=lambda item: item.artifact_id,
        )
    )
    manifest = ArtifactManifestV1("q15.merged-artifacts.v1", artifacts)
    dataset = DatasetCardV1(
        card_id="q15.dataset-card.battery-synthetic.v1",
        revision="q15.v1",
        dataset_id="battery_synthetic:v1",
        posture=EvidencePosture.SYNTHETIC_ONLY,
        sources_and_licenses=(
            ("license", "UNKNOWN; repository has no root LICENSE file"),
            ("origin", "Q10 deterministic generated fixture"),
        ),
        date_coverage="No market dates; seeded synthetic rows only.",
        symbol_product_coverage=("No real symbol or product coverage",),
        cadence_and_timestamps=("Synthetic chronological row ordinals; no exchange timestamps",),
        gaps_revisions_checksums=(
            f"Q10 golden SHA256 {q10_golden.sha256.hexdigest}",
            f"Q10 dataset content SHA256 {Q10_DATASET_SHA256}",
            "No upstream completeness claim",
        ),
        survivorship_delisting_limits=("Not applicable to synthetic data",),
        l2_availability="No L2 market evidence",
        feature_label_lineage=(
            "Q10 features lin_primary lin_secondary xor_left xor_right hetero_driver "
            "noise_a noise_b noise_c liquidity_proxy activity_proxy",
            "Q10 planted synthetic targets transition_binary net_edge_regression "
            "net_edge_quantiles attention_rank",
            f"Q06 artifact {q06_golden.sha256.hexdigest} is an input registry proof only; "
            "it is not Q10 feature lineage",
        ),
        retention_privacy=("Repository fixture; no private/account data",),
        artifact_ids=tuple(sorted((q10_campaign.artifact_id, q10_golden.artifact_id))),
    )
    q11_dataset = DatasetCardV1(
        card_id="q15.dataset-card.q11-survival-synthetic.v1",
        revision="q15.v1",
        dataset_id="q11_survival_synthetic:v1",
        posture=EvidencePosture.SYNTHETIC_ONLY,
        sources_and_licenses=(
            ("license", "UNKNOWN; repository has no root LICENSE file"),
            ("origin", "Q11 deterministic synthetic fixture"),
        ),
        date_coverage="No market dates; seeded synthetic survival cohorts only.",
        symbol_product_coverage=("No real symbol or product coverage",),
        cadence_and_timestamps=("Synthetic nanosecond event horizons",),
        gaps_revisions_checksums=(
            f"Q11 golden SHA256 {q11_golden.sha256.hexdigest}",
            "No upstream completeness claim",
        ),
        survivorship_delisting_limits=("Not applicable to synthetic data",),
        l2_availability="No L2 market evidence",
        feature_label_lineage=("Q11 strata and competing-risk target contracts",),
        retention_privacy=("Repository fixture; no private/account data",),
        artifact_ids=tuple(sorted((q11_campaign.artifact_id, q11_golden.artifact_id))),
    )
    q11_card = ModelCardV1(
        card_id="q15.model-card.q11-golden-hazard.v1",
        revision="q15.v1",
        model_id="q11.golden.hazard.v1",
        model_revision="q11.golden.v1",
        posture=EvidencePosture.SYNTHETIC_ONLY,
        registry_state_at_issue=ModelLifecycle.SHADOW_CHALLENGER,
        intended_use=("Registered Q11 model artifact and independent survival fixture",),
        forbidden_use=(
            "Capital risk or order authority",
            "Claim of validated market edge",
            "Live inference without a separately accepted loader",
        ),
        periods=(
            ("test", "Seeded synthetic cohort"),
            ("train", "Seeded synthetic cohort"),
            ("validation", "UNAVAILABLE; Q11 reports no separate validation period"),
        ),
        symbols_products_cohorts=("HIGH LOW THIN synthetic strata",),
        data_sufficiency_missingness=(
            "Q11 deterministic machinery proof only",
            "Unseen and thin strata remain UNKNOWN",
        ),
        feature_versions=("Q11 stratum contract v1",),
        label_versions=("Q11 competing-risk target v1",),
        algorithm="Discrete empirical hazard with integer sufficient statistics",
        hyperparameters=(
            ("causes", "A,B"),
            ("gridTimesNs", "10000000000,20000000000,30000000000"),
            ("minRiskSet", "2"),
            ("smoothing", "1/1"),
            ("sourceModelVersion", "q11.golden.hazard.v1"),
        ),
        calibration_method="Q11 deterministic survival calibration report",
        cost_assumptions=("No economic or execution-cost claim",),
        performance_slices=(
            "Q11 HIGH LOW THIN synthetic-stratum metrics only",
            "Liquidity stage performance UNAVAILABLE on synthetic survival evidence",
        ),
        known_failures=("No Q14 model-specific validation", "No Q15 deserializer"),
        drift_triggers=("Calibration residual regime and latency drift",),
        inference_budget=("UNAVAILABLE until Q16 benchmark",),
        loadable_model_payload=False,
        artifact_ids=(q11_golden.artifact_id,),
    )
    q10_baseline_card = ModelCardV1(
        card_id="q15.model-card.q10-logistic.v1",
        revision="q15.v1",
        model_id="logistic:v1",
        model_revision="q10.golden.v1",
        posture=EvidencePosture.SYNTHETIC_ONLY,
        registry_state_at_issue=ModelLifecycle.SHADOW_CHALLENGER,
        intended_use=("Compatible transition_binary advisory champion fixture",),
        forbidden_use=(
            "Capital risk or order authority",
            "Inference because Q10 persisted no fitted weights",
            "Claim of validated market edge",
        ),
        periods=(
            ("test", "Q10 internal synthetic test slice"),
            ("train", "Q10 internal synthetic train slice"),
            ("validation", "Q10 internal synthetic validation slice"),
        ),
        symbols_products_cohorts=("No real symbols; transition_binary synthetic target",),
        data_sufficiency_missingness=(
            "Q10 predictions and metrics only",
            "Fitted model weights are not persisted",
        ),
        feature_versions=("Q10 synthetic feature vector v1",),
        label_versions=("transition_binary:v1",),
        algorithm="Logistic transparent baseline result evidence; no serialized estimator",
        hyperparameters=(("C", "1.0"), ("maxIter", "2000"), ("solver", "lbfgs")),
        calibration_method="ISOTONIC_VALIDATION in Q10 synthetic report",
        cost_assumptions=("No executable economics",),
        performance_slices=(
            "Q10 transition_binary aggregate synthetic test metrics only",
            "Per-regime per-stage and real-liquidity performance UNAVAILABLE",
        ),
        known_failures=("No fitted weights", "No model-specific Q14 validation"),
        drift_triggers=("Prediction calibration residual and quality drift",),
        inference_budget=("UNAVAILABLE because no loadable payload",),
        loadable_model_payload=False,
        artifact_ids=(q10_golden.artifact_id,),
    )
    q10_card = ModelCardV1(
        card_id="q15.model-card.q10-xgb-classifier.v1",
        revision="q15.v1",
        model_id="xgb_classifier:v1",
        model_revision="q10.golden.v1",
        posture=EvidencePosture.SYNTHETIC_ONLY,
        registry_state_at_issue=ModelLifecycle.SHADOW_CHALLENGER,
        intended_use=("Shadow challenger and state-machine fixture",),
        forbidden_use=(
            "Capital risk or order authority",
            "Inference because Q10 persisted no fitted weights",
            "Promotion from the unrelated Q14 IMPROVES report",
        ),
        periods=(
            ("test", "Q10 internal synthetic 128-row test slice"),
            ("train", "Q10 internal synthetic 400-row train slice"),
            ("validation", "Q10 internal synthetic 96-row validation slice after 16-row embargo"),
        ),
        symbols_products_cohorts=("No real symbols; transition_binary synthetic target",),
        data_sufficiency_missingness=(
            "Q10 predictions and metrics only",
            "Fitted model weights are not persisted",
        ),
        feature_versions=("Q10 synthetic feature vector v1",),
        label_versions=("transition_binary:v1",),
        algorithm="XGBoost classifier result evidence; no serialized estimator",
        hyperparameters=(
            ("learningRate", "0.1"),
            ("maxDepth", "5"),
            ("minChildWeight", "2"),
            ("nEstimators", "150"),
        ),
        calibration_method="ISOTONIC_VALIDATION in Q10 synthetic report",
        cost_assumptions=("No executable economics",),
        performance_slices=(
            "Q10 transition_binary aggregate synthetic test metrics only",
            "Per-regime per-stage and real-liquidity performance UNAVAILABLE",
        ),
        known_failures=("No fitted weights", "Q14 report identity mismatch"),
        drift_triggers=("Prediction calibration residual and quality drift",),
        inference_budget=("UNAVAILABLE because no loadable payload",),
        loadable_model_payload=False,
        artifact_ids=(q10_golden.artifact_id,),
    )
    experiment = ExperimentCardV1(
        card_id="q15.experiment-card.registry-proof.v1",
        revision="q15.v1",
        experiment_id="q15.registry-proof.v1",
        hypothesis_id="H5_FALSE_BURST_MANIPULATION_RISK_FILTERING",
        code_commit=code_commit,
        dependency_lock_sha256=uv_lock.sha256,
        dataset_manifest_ids=(
            f"q10.dataset.contentSha256.{Q10_DATASET_SHA256}",
            f"q11.fixture.sha256.{q11_golden.sha256.hexdigest}",
        ),
        feature_versions=(
            "q10.synthetic-feature-vector.v1",
            "q11.stratum-contract.v1",
        ),
        label_versions=("Q10 transition_binary:v1", "Q11 competing-risk target v1"),
        split_fold_ids=(
            "q10.internal.train400.embargo16.validation96.test128",
            "q11.seeded.synthetic.cohort.split.UNAVAILABLE",
        ),
        parameters=(
            ("q10Seed", "20260712"),
            ("q11Seed", "20260712"),
            ("registryPolicy", "q15.synthetic-advisory.v1"),
        ),
        seed=20260712,
        attempted_trial_ids=tuple(
            f"{study}.trial.{index:02d}"
            for study in (
                "study_xgb_classifier:v1",
                "study_xgb_quantile:v1",
                "study_xgb_ranker:v1",
                "study_xgb_regressor:v1",
            )
            for index in range(12)
        ),
        metrics_and_intervals=(
            "Q10 transition_binary winner xgb_classifier:v1 by Brier",
            "Q11 integrated Brier marginal-any 207712472530/1000000000000",
            "Q10 model-specific confidence intervals UNAVAILABLE in merged artifact",
            "Q11 model-specific confidence intervals UNAVAILABLE in merged artifact",
            "Q14 comparison is unrelated and rejected for Q10 Q11 promotion",
        ),
        artifact_ids=tuple(
            sorted(
                (
                    q10_campaign.artifact_id,
                    q10_golden.artifact_id,
                    q11_campaign.artifact_id,
                    q11_golden.artifact_id,
                    q14_campaign.artifact_id,
                    q14_golden.artifact_id,
                    synthetic_promotion.artifact_id,
                )
            )
        ),
        latency_resource_benchmark=("Q15 registry storage only; inference benchmark unavailable",),
        model_card_ids=tuple(
            sorted((q10_baseline_card.card_id, q10_card.card_id, q11_card.card_id))
        ),
        decision=(
            "Bootstrap Q10 logistic result as SYNTHETIC_ONLY transition_binary champion; "
            "keep compatible Q10 XGBoost in shadow; register Q11 separately; reject Q14 mismatch"
        ),
        posture=EvidencePosture.SYNTHETIC_ONLY,
    )
    q11_registration = ModelRegistrationV1(
        model_id=q11_card.model_id,
        model_revision=q11_card.model_revision,
        artifact=q11_golden,
        model_card_digest=q11_card.content_digest,
        dataset_card_digest=q11_dataset.content_digest,
        experiment_card_digest=experiment.content_digest,
        output_contract_id="Q11SurvivalPredictionV1",
        target_id="competing_risk_survival:v1",
        score_contract_id="survival_curve:v1",
        posture=EvidencePosture.SYNTHETIC_ONLY,
        registered_at_ms=recorded_at_ms,
    )
    q10_baseline_registration = ModelRegistrationV1(
        model_id=q10_baseline_card.model_id,
        model_revision=q10_baseline_card.model_revision,
        artifact=q10_golden,
        model_card_digest=q10_baseline_card.content_digest,
        dataset_card_digest=dataset.content_digest,
        experiment_card_digest=experiment.content_digest,
        output_contract_id="Q10ModelResultV1.transition_binary:v1",
        target_id="transition_binary:v1",
        score_contract_id="probability_micros:v1",
        posture=EvidencePosture.SYNTHETIC_ONLY,
        registered_at_ms=recorded_at_ms,
    )
    q10_registration = ModelRegistrationV1(
        model_id=q10_card.model_id,
        model_revision=q10_card.model_revision,
        artifact=q10_golden,
        model_card_digest=q10_card.content_digest,
        dataset_card_digest=dataset.content_digest,
        experiment_card_digest=experiment.content_digest,
        output_contract_id="Q10ModelResultV1.transition_binary:v1",
        target_id="transition_binary:v1",
        score_contract_id="probability_micros:v1",
        posture=EvidencePosture.SYNTHETIC_ONLY,
        registered_at_ms=recorded_at_ms,
    )
    return MergedQ15BundleV1(
        artifact_manifest=manifest,
        dataset_card=dataset,
        q11_dataset_card=q11_dataset,
        q11_model_card=q11_card,
        q10_baseline_model_card=q10_baseline_card,
        q10_model_card=q10_card,
        experiment_card=experiment,
        q11_registration=q11_registration,
        q10_baseline_registration=q10_baseline_registration,
        q10_registration=q10_registration,
    )
