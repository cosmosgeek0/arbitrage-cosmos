"""Q-070 genuine fold-safe feature diagnostics and hostile anti-shortcut proofs."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace

import pytest
from q14_fixtures import HOUR_NS, make_sample

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.diagnostics import diagnostic_obligations
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.features.values import FeatureValueStatus, FeatureValueV1
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import DigestV1, EvidencePosture
from quant_edge.models.engine import (
    BoostParams,
    DiagnosticFitBinding,
    refit_xgb_classifier_artifact,
    training_mutual_information,
    xgb_classifier_artifact_outputs,
    xgb_classifier_diagnostics,
    xgb_classifier_subset_scores,
)
from quant_edge.models.quantize import (
    quantize_binary64,
    quantize_binary64_with_abs_error,
    quantize_probability_vector,
    quantize_vector,
)
from quant_edge.validation.feature_diagnostics import (
    MUTUAL_INFORMATION_ESTIMATOR_ID,
    MUTUAL_INFORMATION_SEED,
    AttributionDependence,
    AttributionMethod,
    AttributionOutputSpace,
    DiagnosticFeatureCellV1,
    DiagnosticFeatureKind,
    DiagnosticFeatureRole,
    DiagnosticFeatureSpecV1,
    DiagnosticMatrixV1,
    DiagnosticObligation,
    DiagnosticObligationEvidenceV1,
    DiagnosticStatus,
    FeatureDiagnosticSuiteV1,
    FeatureVariantKind,
    FitScope,
    FoldFeatureShapeV1,
    FoldFeatureVariantV1,
    FoldFitManifestV1,
    FoldMutualInformationV1,
    FoldPredictionsV1,
    PermutationEvidenceV1,
    PermutationManifestV1,
    ShapeEvidenceStatus,
    TreeAttributionSetV1,
    build_diagnostic_matrix,
    chronological_permutation_importance,
    deterministic_permutation_donor_ids,
    diagnostic_input_digest,
    diagnostic_model_spec_digest,
    family_ablation,
    fold_prediction_output_digest,
    incremental_engine_value,
    permutation_evaluation_rows,
    permutation_input_digest,
    permutation_max_feature_asof_ns,
    sign_monotonicity_stability,
    tree_attribution_output_digest,
    tree_expected_value_digest,
    validate_training_mutual_information,
    validate_tree_attributions,
)
from quant_edge.validation.samples import SampleSetV1
from quant_edge.validation.splits import (
    SplitScheme,
    WalkForwardPlanV1,
    WalkForwardSpecV1,
    build_walk_forward_plan,
)


def _digest(label: str) -> DigestV1:
    return DigestV1(hashlib.sha256(label.encode()).hexdigest())


def _mapping_digest(value: dict[str, object]) -> DigestV1:
    return DigestV1(hashlib.sha256(canonical_json_bytes(value)).hexdigest())


@dataclass(frozen=True, slots=True)
class DiagnosticContext:
    samples: SampleSetV1
    plan: WalkForwardPlanV1
    matrix: DiagnosticMatrixV1
    rows: tuple[tuple[int, ...], ...]
    labels: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class DiagnosticEvidence:
    mutual_information: tuple[FoldMutualInformationV1, ...]
    permutations: tuple[PermutationEvidenceV1, ...]
    attributions: tuple[TreeAttributionSetV1, ...]
    shapes: tuple[FoldFeatureShapeV1, ...]
    full: tuple[FoldFeatureVariantV1, ...]
    ablated: tuple[FoldFeatureVariantV1, ...]
    engine: tuple[FoldFeatureVariantV1, ...]
    augmented: tuple[FoldFeatureVariantV1, ...]


def _build_context() -> DiagnosticContext:
    rows = tuple(
        (
            (index * 7) % 17 - 8,
            (index * 5) % 13 - 6,
            (index * 11 + 3) % 19 - 9,
        )
        for index in range(90)
    )
    labels = tuple(int(3 * candidate + 2 * engine > 0) for candidate, engine, _ in rows)
    samples = SampleSetV1(
        dataset_id="q070-recorded-replay",
        posture=EvidencePosture.REPLAY,
        samples=tuple(make_sample(index, outcome=bool(labels[index])) for index in range(90)),
    )
    plan = build_walk_forward_plan(
        samples,
        WalkForwardSpecV1(
            scheme=SplitScheme.EXPANDING,
            fold_count=2,
            max_label_horizon_ns=HOUR_NS,
            max_feature_lookback_ns=HOUR_NS,
            embargo_ns=2 * HOUR_NS,
            min_train_size=12,
            holdout_fraction=make_ratio(0, 1),
            rolling_train_size=None,
        ),
    )
    specs = (
        DiagnosticFeatureSpecV1(
            feature_id="candidate_signal",
            family_id="candidate_family",
            role=DiagnosticFeatureRole.CANDIDATE,
            kind=DiagnosticFeatureKind.CONTINUOUS,
            expected_direction=1,
        ),
        DiagnosticFeatureSpecV1(
            feature_id="engine_signal",
            family_id="engine_family",
            role=DiagnosticFeatureRole.ENGINE_BASELINE,
            kind=DiagnosticFeatureKind.CONTINUOUS,
            expected_direction=1,
        ),
        DiagnosticFeatureSpecV1(
            feature_id="noise",
            family_id="noise_family",
            role=DiagnosticFeatureRole.CANDIDATE,
            kind=DiagnosticFeatureKind.DISCRETE,
            expected_direction=0,
        ),
    )
    feature_cells = tuple(
        tuple(
            DiagnosticFeatureCellV1(
                sample_id=sample_id,
                feature_id=spec.feature_id,
                source_id="q070.recorded-feature-owner",
                source_revision="q070.recorded-feature-owner.v1",
                source_artifact_sha256=_digest(f"q070-source:{sample_id}:{spec.feature_id}"),
                posture=EvidencePosture.REPLAY,
                observation=FeatureValueV1(
                    feature_id=spec.feature_id,
                    as_of_ns=samples.by_id(sample_id).cutoff_ns - 1,
                    input_last_event_ns=samples.by_id(sample_id).cutoff_ns - 1,
                    status=FeatureValueStatus.AVAILABLE,
                    value=FixedPointV1(rows[row_index][feature_index]),
                ),
            )
            for feature_index, spec in enumerate(specs)
        )
        for row_index, sample_id in enumerate(samples.sample_ids)
    )
    matrix = build_diagnostic_matrix(
        samples=samples,
        feature_specs=specs,
        feature_cells=feature_cells,
        regime_ids=tuple("active" if index % 2 == 0 else "calm" for index in range(90)),
    )
    return DiagnosticContext(samples=samples, plan=plan, matrix=matrix, rows=rows, labels=labels)


def _indices(context: DiagnosticContext, sample_ids: tuple[str, ...]) -> tuple[int, ...]:
    return tuple(context.samples.sample_ids.index(sample_id) for sample_id in sample_ids)


def test_matrix_digest_binds_per_feature_asof_and_rejects_future_truth(
    context: DiagnosticContext,
) -> None:
    sample_id = context.samples.sample_ids[0]
    row_index = context.samples.sample_ids.index(sample_id)
    feature_id = context.matrix.feature_ids[0]
    future_cells = [list(row) for row in context.matrix.feature_cells]
    future_cell = future_cells[row_index][0]
    future_time = context.samples.by_id(sample_id).cutoff_ns + 1
    future_cells[row_index][0] = replace(
        future_cell,
        observation=replace(
            future_cell.observation,
            as_of_ns=future_time,
            input_last_event_ns=future_time,
        ),
    )
    future_matrix = replace(
        context.matrix,
        feature_cells=tuple(tuple(row) for row in future_cells),
    )

    assert future_matrix.digest() != context.matrix.digest()
    with pytest.raises(ContractValueError, match="post-cutoff feature truth"):
        diagnostic_input_digest(
            context.samples,
            future_matrix,
            (sample_id,),
            (feature_id,),
            include_labels=False,
        )
    with pytest.raises(ContractValueError, match="as_of_ns is outside"):
        replace(future_cell.observation, as_of_ns=0, input_last_event_ns=0)
    with pytest.raises(ContractValueError, match="post-cutoff feature truth"):
        validate_training_mutual_information(
            context.samples,
            context.plan,
            future_matrix,
            (),
        )
    with pytest.raises(ContractValueError, match="post-cutoff feature truth"):
        build_diagnostic_matrix(
            samples=context.samples,
            feature_specs=context.matrix.feature_specs,
            feature_cells=future_matrix.feature_cells,
            regime_ids=context.matrix.regime_ids,
        )
    changed_source_cells = [list(row) for row in context.matrix.feature_cells]
    changed_source_cells[row_index][0] = replace(
        future_cell,
        source_artifact_sha256=_digest("changed-source-artifact"),
    )
    changed_source_matrix = replace(
        context.matrix,
        feature_cells=tuple(tuple(row) for row in changed_source_cells),
    )
    assert changed_source_matrix.rows == context.matrix.rows
    assert changed_source_matrix.feature_asof_ns == context.matrix.feature_asof_ns
    assert changed_source_matrix.digest() != context.matrix.digest()
    assert diagnostic_input_digest(
        context.samples,
        changed_source_matrix,
        (sample_id,),
        (feature_id,),
        include_labels=False,
    ) != diagnostic_input_digest(
        context.samples,
        context.matrix,
        (sample_id,),
        (feature_id,),
        include_labels=False,
    )


def _rows_for(
    context: DiagnosticContext,
    sample_ids: tuple[str, ...],
    feature_ids: tuple[str, ...],
) -> tuple[tuple[int | None, ...], ...]:
    indices = tuple(context.matrix.feature_index(feature_id) for feature_id in feature_ids)
    return tuple(
        tuple(context.matrix.row_for(sample_id)[index] for index in indices)
        for sample_id in sample_ids
    )


def _manifest(
    context: DiagnosticContext,
    fold_id: str,
    train_ids: tuple[str, ...],
    validation_ids: tuple[str, ...],
    feature_ids: tuple[str, ...],
    binding: DiagnosticFitBinding,
    params: BoostParams,
    prediction_scores: tuple[FixedPointV1, ...],
    prediction_raw_margins: tuple[FixedPointV1, ...],
    attribution_output_digest: DigestV1 | None = None,
    expected_value_digest: DigestV1 | None = None,
) -> FoldFitManifestV1:
    fold = next(item for item in context.plan.folds if item.fold_id == fold_id)
    max_asof = tuple(
        context.matrix.max_feature_asof_for(sample_id, feature_ids) for sample_id in validation_ids
    )
    return FoldFitManifestV1(
        dataset_digest=context.samples.digest(),
        matrix_digest=context.matrix.digest(),
        plan_digest=context.plan.digest(),
        fold_digest=DigestV1(hashlib.sha256(canonical_json_bytes(fold.as_mapping())).hexdigest()),
        fold_id=fold_id,
        algorithm_id="xgb-binary-hist",
        model_revision="xgboost-3.3.0",
        params=tuple(sorted((key, str(value)) for key, value in params.as_mapping().items())),
        params_digest=DigestV1(binding.params_digest),
        model_spec_digest=DigestV1(binding.model_spec_digest),
        fit_artifact_digest=DigestV1(binding.fit_artifact_digest),
        fit_artifact_ubj=binding.fit_artifact_ubj,
        training_input_digest=diagnostic_input_digest(
            context.samples,
            context.matrix,
            train_ids,
            feature_ids,
            include_labels=True,
        ),
        validation_input_digest=diagnostic_input_digest(
            context.samples,
            context.matrix,
            validation_ids,
            feature_ids,
            include_labels=False,
        ),
        prediction_output_digest=fold_prediction_output_digest(
            validation_ids,
            prediction_scores,
            prediction_raw_margins,
            max_asof,
        ),
        attribution_output_digest=attribution_output_digest,
        expected_value_digest=expected_value_digest,
        fit_scope=FitScope.TRAINING_ONLY,
        seed=7,
        train_sample_ids=train_ids,
        validation_sample_ids=validation_ids,
        feature_ids=feature_ids,
    )


def _predictions(
    context: DiagnosticContext,
    manifest: FoldFitManifestV1,
    scores: tuple[float, ...],
    raw_margins: tuple[float, ...],
    *,
    max_feature_asof_ns: tuple[int, ...] | None = None,
) -> FoldPredictionsV1:
    return FoldPredictionsV1(
        manifest=manifest,
        scores=(quantized := quantize_probability_vector(scores, field="q070 probabilities")),
        raw_margins=(quantized_margins := quantize_vector(raw_margins, field="raw margins")),
        max_feature_asof_ns=(
            max_asof := (
                tuple(
                    context.matrix.max_feature_asof_for(sample_id, manifest.feature_ids)
                    for sample_id in manifest.validation_sample_ids
                )
                if max_feature_asof_ns is None
                else max_feature_asof_ns
            )
        ),
        output_digest=fold_prediction_output_digest(
            manifest.validation_sample_ids,
            quantized,
            quantized_margins,
            max_asof,
        ),
    )


def _build_evidence(context: DiagnosticContext) -> DiagnosticEvidence:
    params = BoostParams(
        max_depth=2,
        n_estimators=12,
        learning_rate="0.2",
        min_child_weight=1,
    )
    all_feature_ids = context.matrix.feature_ids
    all_indices = tuple(range(len(all_feature_ids)))
    discrete = tuple(
        spec.kind is DiagnosticFeatureKind.DISCRETE for spec in context.matrix.feature_specs
    )
    mi_reports: list[FoldMutualInformationV1] = []
    permutations: list[PermutationEvidenceV1] = []
    attributions: list[TreeAttributionSetV1] = []
    shapes: list[FoldFeatureShapeV1] = []
    full_variants: list[FoldFeatureVariantV1] = []
    ablated_variants: list[FoldFeatureVariantV1] = []
    engine_variants: list[FoldFeatureVariantV1] = []
    augmented_variants: list[FoldFeatureVariantV1] = []

    for fold in context.plan.folds:
        train_indices = _indices(context, fold.train_sample_ids)
        validation_indices = _indices(context, fold.validation_sample_ids)
        for feature_index, feature_id in enumerate(all_feature_ids):
            value = training_mutual_information(
                tuple((row[feature_index],) for row in context.rows),
                context.labels,
                train_indices,
                discrete_features=(discrete[feature_index],),
                seed=MUTUAL_INFORMATION_SEED,
            )[0]
            quantized_mi, quantization_error = quantize_binary64_with_abs_error(
                value,
                field="mutual information",
            )
            mi_reports.append(
                FoldMutualInformationV1(
                    dataset_digest=context.samples.digest(),
                    matrix_digest=context.matrix.digest(),
                    fold_id=fold.fold_id,
                    feature_id=feature_id,
                    estimator_id=MUTUAL_INFORMATION_ESTIMATOR_ID,
                    seed=MUTUAL_INFORMATION_SEED,
                    train_sample_ids=fold.train_sample_ids,
                    used_train_sample_ids=fold.train_sample_ids,
                    status=DiagnosticStatus.AVAILABLE,
                    training_row_count=len(train_indices),
                    value_nats=quantized_mi,
                    quantization_abs_error=quantization_error,
                )
            )

        permutation_inputs = tuple(
            (
                feature_index,
                tuple(
                    context.samples.sample_ids.index(sample_id)
                    for sample_id in deterministic_permutation_donor_ids(
                        samples=context.samples,
                        matrix=context.matrix,
                        plan_digest=context.plan.digest(),
                        fold_id=fold.fold_id,
                        feature_id=all_feature_ids[feature_index],
                        repeat_index=0,
                        seed=7,
                        receiver_sample_ids=fold.validation_sample_ids,
                        donor_pool_sample_ids=(
                            *fold.train_sample_ids,
                            *fold.validation_sample_ids,
                        ),
                    )
                ),
            )
            for feature_index in all_indices
        )
        regime_order = tuple(
            sorted(
                {context.matrix.regime_for(sample_id) for sample_id in fold.validation_sample_ids}
            )
        )
        regime_positions = tuple(
            tuple(
                position
                for position, sample_id in enumerate(fold.validation_sample_ids)
                if context.matrix.regime_for(sample_id) == regime_id
            )
            for regime_id in regime_order
        )
        output = xgb_classifier_diagnostics(
            context.rows,
            context.labels,
            train_indices,
            validation_indices,
            feature_indices=all_indices,
            feature_ids=all_feature_ids,
            params=params,
            seed=7,
            permutations=permutation_inputs,
            regime_positions=regime_positions,
        )
        prediction_scores = quantize_probability_vector(
            output.probabilities,
            field="q070 probabilities",
        )
        raw_margins = quantize_vector(output.raw_margins, field="raw margins")
        base_values = tuple(
            quantize_binary64(row[-1], field="TreeSHAP bias")
            for row in output.contributions_with_bias
        )
        contributions = tuple(
            quantize_vector(row[:-1], field="TreeSHAP contributions")
            for row in output.contributions_with_bias
        )
        fit_artifact_digest = DigestV1(output.binding.fit_artifact_digest)
        attribution_output_digest = tree_attribution_output_digest(
            validation_sample_ids=fold.validation_sample_ids,
            feature_ids=all_feature_ids,
            fit_artifact_digest=fit_artifact_digest,
            method=AttributionMethod.XGBOOST_3_3_EXACT_TREE_SHAP,
            dependence=AttributionDependence.TREE_PATH_DEPENDENT,
            output_space=AttributionOutputSpace.RAW_MARGIN,
            raw_margins=raw_margins,
            base_values=base_values,
            contributions=contributions,
        )
        expected_value_digest = tree_expected_value_digest(
            fit_artifact_digest=fit_artifact_digest,
            base_values=base_values,
        )
        manifest = _manifest(
            context,
            fold.fold_id,
            fold.train_sample_ids,
            fold.validation_sample_ids,
            all_feature_ids,
            output.binding,
            params,
            prediction_scores,
            raw_margins,
            attribution_output_digest,
            expected_value_digest,
        )
        baseline = _predictions(
            context,
            manifest,
            output.probabilities,
            output.raw_margins,
        )
        full_variants.append(
            FoldFeatureVariantV1(kind=FeatureVariantKind.FULL, predictions=baseline)
        )
        augmented_variants.append(
            FoldFeatureVariantV1(
                kind=FeatureVariantKind.ENGINE_PLUS_CANDIDATE,
                predictions=baseline,
            )
        )
        attributions.append(
            TreeAttributionSetV1(
                manifest=manifest,
                fit_artifact_digest=fit_artifact_digest,
                attribution_output_digest=attribution_output_digest,
                expected_value_digest=expected_value_digest,
                method=AttributionMethod.XGBOOST_3_3_EXACT_TREE_SHAP,
                dependence=AttributionDependence.TREE_PATH_DEPENDENT,
                output_space=AttributionOutputSpace.RAW_MARGIN,
                raw_margins=raw_margins,
                base_values=base_values,
                contributions=contributions,
            )
        )
        for permutation_output in output.permutations:
            feature_id = all_feature_ids[permutation_output.feature_index]
            permutations.append(
                PermutationEvidenceV1(
                    permutation=PermutationManifestV1(
                        plan_digest=context.plan.digest(),
                        input_digest=permutation_input_digest(
                            context.samples,
                            context.matrix,
                            receiver_sample_ids=fold.validation_sample_ids,
                            donor_sample_ids=tuple(
                                context.samples.sample_ids[index]
                                for index in permutation_output.donor_indices
                            ),
                            feature_ids=all_feature_ids,
                            feature_id=feature_id,
                        ),
                        fold_id=fold.fold_id,
                        feature_id=feature_id,
                        repeat_index=0,
                        seed=7,
                        receiver_sample_ids=fold.validation_sample_ids,
                        donor_sample_ids=tuple(
                            context.samples.sample_ids[index]
                            for index in permutation_output.donor_indices
                        ),
                    ),
                    baseline=baseline,
                    permuted=_predictions(
                        context,
                        manifest,
                        permutation_output.probabilities,
                        permutation_output.raw_margins,
                        max_feature_asof_ns=permutation_max_feature_asof_ns(
                            context.samples,
                            context.matrix,
                            receiver_sample_ids=fold.validation_sample_ids,
                            donor_sample_ids=tuple(
                                context.samples.sample_ids[index]
                                for index in permutation_output.donor_indices
                            ),
                            feature_ids=all_feature_ids,
                            feature_id=feature_id,
                        ),
                    ),
                )
            )
        for shape_output in output.shapes:
            shapes.append(
                FoldFeatureShapeV1(
                    manifest=manifest,
                    feature_id=all_feature_ids[shape_output.feature_index],
                    regime_id=regime_order[shape_output.regime_index],
                    status=(
                        ShapeEvidenceStatus.AVAILABLE
                        if shape_output.signed_effect is not None
                        else ShapeEvidenceStatus.DATA_INSUFFICIENT
                    ),
                    signed_effect=(
                        None
                        if shape_output.signed_effect is None
                        else quantize_binary64(
                            shape_output.signed_effect,
                            field="local shape effect",
                        )
                    ),
                    comparable_steps=shape_output.comparable_steps,
                    monotonic_violation_count=shape_output.monotonic_violation_count,
                )
            )

        for family_id in context.matrix.family_ids:
            kept_ids = tuple(
                spec.feature_id
                for spec in context.matrix.feature_specs
                if spec.family_id != family_id
            )
            kept_indices = tuple(
                context.matrix.feature_index(feature_id) for feature_id in kept_ids
            )
            variant_output = xgb_classifier_subset_scores(
                context.rows,
                context.labels,
                train_indices,
                validation_indices,
                feature_indices=kept_indices,
                feature_ids=kept_ids,
                params=params,
                seed=7,
            )
            variant_manifest = _manifest(
                context,
                fold.fold_id,
                fold.train_sample_ids,
                fold.validation_sample_ids,
                kept_ids,
                variant_output.binding,
                params,
                quantize_probability_vector(
                    variant_output.probabilities,
                    field="q070 probabilities",
                ),
                quantize_vector(variant_output.raw_margins, field="raw margins"),
            )
            ablated_variants.append(
                FoldFeatureVariantV1(
                    kind=FeatureVariantKind.FAMILY_ABLATION,
                    predictions=_predictions(
                        context,
                        variant_manifest,
                        variant_output.probabilities,
                        variant_output.raw_margins,
                    ),
                    excluded_family_id=family_id,
                )
            )

        engine_ids = tuple(
            spec.feature_id
            for spec in context.matrix.feature_specs
            if spec.role is DiagnosticFeatureRole.ENGINE_BASELINE
        )
        engine_indices = tuple(
            context.matrix.feature_index(feature_id) for feature_id in engine_ids
        )
        engine_output = xgb_classifier_subset_scores(
            context.rows,
            context.labels,
            train_indices,
            validation_indices,
            feature_indices=engine_indices,
            feature_ids=engine_ids,
            params=params,
            seed=7,
        )
        engine_manifest = _manifest(
            context,
            fold.fold_id,
            fold.train_sample_ids,
            fold.validation_sample_ids,
            engine_ids,
            engine_output.binding,
            params,
            quantize_probability_vector(
                engine_output.probabilities,
                field="q070 probabilities",
            ),
            quantize_vector(engine_output.raw_margins, field="raw margins"),
        )
        engine_variants.append(
            FoldFeatureVariantV1(
                kind=FeatureVariantKind.ENGINE_ONLY,
                predictions=_predictions(
                    context,
                    engine_manifest,
                    engine_output.probabilities,
                    engine_output.raw_margins,
                ),
            )
        )

    return DiagnosticEvidence(
        mutual_information=tuple(mi_reports),
        permutations=tuple(permutations),
        attributions=tuple(attributions),
        shapes=tuple(
            sorted(
                shapes,
                key=lambda item: (
                    item.feature_id,
                    item.regime_id,
                    item.manifest.fold_id,
                ),
            )
        ),
        full=tuple(full_variants),
        ablated=tuple(ablated_variants),
        engine=tuple(engine_variants),
        augmented=tuple(augmented_variants),
    )


@pytest.fixture(scope="module")
def context() -> DiagnosticContext:
    return _build_context()


@pytest.fixture(scope="module")
def evidence(context: DiagnosticContext) -> DiagnosticEvidence:
    return _build_evidence(context)


def test_training_mutual_information_is_fold_safe(
    context: DiagnosticContext,
    evidence: DiagnosticEvidence,
) -> None:
    reports = validate_training_mutual_information(
        context.samples,
        context.plan,
        context.matrix,
        evidence.mutual_information,
    )
    assert len(reports) == len(context.plan.folds) * len(context.matrix.feature_ids)
    assert all(report.status is DiagnosticStatus.AVAILABLE for report in reports)
    assert all(report.value_nats is not None for report in reports)

    first_fold = context.plan.folds[0]
    train_indices = _indices(context, first_fold.train_sample_ids)
    original = training_mutual_information(
        context.rows,
        context.labels,
        train_indices,
        discrete_features=(False, False, True),
        seed=7,
    )
    future = set(range(len(context.rows))) - set(train_indices)
    mutated_rows = tuple(
        row if index not in future else tuple(value * -1000 for value in row)
        for index, row in enumerate(context.rows)
    )
    mutated_labels = tuple(
        label if index not in future else 1 - label for index, label in enumerate(context.labels)
    )
    mutated = training_mutual_information(
        mutated_rows,
        mutated_labels,
        train_indices,
        discrete_features=(False, False, True),
        seed=7,
    )
    assert mutated == original

    forged = replace(
        reports[0],
        train_sample_ids=context.plan.folds[0].validation_sample_ids,
        used_train_sample_ids=context.plan.folds[0].validation_sample_ids,
        training_row_count=len(context.plan.folds[0].validation_sample_ids),
    )
    with pytest.raises(ContractValueError, match="exact authoritative train ids"):
        validate_training_mutual_information(
            context.samples,
            context.plan,
            context.matrix,
            (forged, *reports[1:]),
        )

    first = reports[0]
    assert first.value_nats is not None
    assert first.quantization_abs_error is not None
    forged_measurements = (
        replace(
            first,
            value_nats=FixedPointV1(first.value_nats.mantissa + 987_654_321),
        ),
        replace(
            first,
            quantization_abs_error=FixedPointV1(first.quantization_abs_error.mantissa + 1),
        ),
        replace(first, estimator_id="caller-selected-mi"),
        replace(first, seed=first.seed + 1),
    )
    for forged_measurement in forged_measurements:
        with pytest.raises(
            ContractValueError,
            match=r"canonical estimator and seed|exact deterministic training-only replay",
        ):
            validate_training_mutual_information(
                context.samples,
                context.plan,
                context.matrix,
                (forged_measurement, *reports[1:]),
            )


def test_same_fit_chronological_permutation_and_exact_tree_attribution(
    context: DiagnosticContext,
    evidence: DiagnosticEvidence,
) -> None:
    importances = chronological_permutation_importance(
        context.samples,
        context.plan,
        context.matrix,
        evidence.permutations,
    )
    assert tuple(item.feature_id for item in importances) == context.matrix.feature_ids
    assert all(item.status is DiagnosticStatus.AVAILABLE for item in importances)
    assert all(item.repeat_count == 1 for item in importances)
    assert all(item.mean_brier_importance is not None for item in importances)
    for item in evidence.permutations:
        assert item.permuted.max_feature_asof_ns == permutation_max_feature_asof_ns(
            context.samples,
            context.matrix,
            receiver_sample_ids=item.permutation.receiver_sample_ids,
            donor_sample_ids=item.permutation.donor_sample_ids,
            feature_ids=item.baseline.manifest.feature_ids,
            feature_id=item.permutation.feature_id,
        )
        for receiver_id, donor_id in zip(
            item.permutation.receiver_sample_ids,
            item.permutation.donor_sample_ids,
            strict=True,
        ):
            receiver_cutoff = context.samples.by_id(receiver_id).cutoff_ns
            assert context.samples.by_id(donor_id).cutoff_ns <= receiver_cutoff
            assert (
                context.matrix.cell_for(
                    donor_id,
                    item.permutation.feature_id,
                ).observation.as_of_ns
                <= receiver_cutoff
            )
    first_permutation = evidence.permutations[0]
    first_receiver = first_permutation.permutation.receiver_sample_ids[0]
    future_donor = first_permutation.permutation.receiver_sample_ids[-1]
    with pytest.raises(ContractValueError, match="chronological feature truth"):
        permutation_evaluation_rows(
            context.samples,
            context.matrix,
            receiver_sample_ids=(first_receiver,),
            donor_sample_ids=(future_donor,),
            feature_ids=first_permutation.baseline.manifest.feature_ids,
            feature_id=first_permutation.permutation.feature_id,
        )

    attributions = validate_tree_attributions(
        context.samples,
        context.plan,
        context.matrix,
        evidence.attributions,
    )
    assert all(report.status is DiagnosticStatus.AVAILABLE for report in attributions)
    assert all(not report.causality_claim for report in attributions)
    assert all(report.mean_abs_contribution is not None for report in attributions)

    first = evidence.attributions[0]
    changed_row = list(first.contributions[0])
    changed_row[0] = FixedPointV1(changed_row[0].mantissa + 2_000_000)
    bad = replace(
        first,
        contributions=(tuple(changed_row), *first.contributions[1:]),
    )
    invalid = validate_tree_attributions(
        context.samples,
        context.plan,
        context.matrix,
        (bad, *evidence.attributions[1:]),
    )
    assert invalid[0].status is DiagnosticStatus.INVALID
    assert invalid[0].mean_abs_contribution is None


def test_fit_manifest_and_tree_output_bindings_reject_reuse_and_forgery(
    context: DiagnosticContext,
    evidence: DiagnosticEvidence,
) -> None:
    zero_matrix = replace(
        context.matrix,
        feature_cells=tuple(
            tuple(
                replace(
                    cell,
                    observation=replace(cell.observation, value=FixedPointV1(0)),
                )
                for cell in row
            )
            for row in context.matrix.feature_cells
        ),
    )
    first = evidence.attributions[0]
    rebound_zero_manifest = replace(
        first.manifest,
        matrix_digest=zero_matrix.digest(),
        training_input_digest=diagnostic_input_digest(
            context.samples,
            zero_matrix,
            first.manifest.train_sample_ids,
            first.manifest.feature_ids,
            include_labels=True,
        ),
        validation_input_digest=diagnostic_input_digest(
            context.samples,
            zero_matrix,
            first.manifest.validation_sample_ids,
            first.manifest.feature_ids,
            include_labels=False,
        ),
    )
    with pytest.raises(ContractValueError, match="deterministic model fitted"):
        validate_tree_attributions(
            context.samples,
            context.plan,
            zero_matrix,
            (replace(first, manifest=rebound_zero_manifest), *evidence.attributions[1:]),
        )

    zero = FixedPointV1(0)
    zero_raw_margins = (zero,) * len(first.raw_margins)
    zero_base_values = (zero,) * len(first.base_values)
    zero_contributions = tuple(
        (zero,) * len(first.manifest.feature_ids) for _ in first.contributions
    )
    zero_attribution_digest = tree_attribution_output_digest(
        validation_sample_ids=first.manifest.validation_sample_ids,
        feature_ids=first.manifest.feature_ids,
        fit_artifact_digest=first.fit_artifact_digest,
        method=first.method,
        dependence=first.dependence,
        output_space=first.output_space,
        raw_margins=zero_raw_margins,
        base_values=zero_base_values,
        contributions=zero_contributions,
    )
    zero_expected_value_digest = tree_expected_value_digest(
        fit_artifact_digest=first.fit_artifact_digest,
        base_values=zero_base_values,
    )
    forged_zero = replace(
        first,
        manifest=replace(
            first.manifest,
            attribution_output_digest=zero_attribution_digest,
            expected_value_digest=zero_expected_value_digest,
        ),
        attribution_output_digest=zero_attribution_digest,
        expected_value_digest=zero_expected_value_digest,
        raw_margins=zero_raw_margins,
        base_values=zero_base_values,
        contributions=zero_contributions,
    )
    reports = validate_tree_attributions(
        context.samples,
        context.plan,
        context.matrix,
        (forged_zero, *evidence.attributions[1:]),
    )
    assert reports[0].max_local_accuracy_residual.mantissa == 0
    assert reports[0].status is DiagnosticStatus.INVALID
    assert reports[0].mean_abs_contribution is None

    leaked_manifest = replace(
        first.manifest,
        training_input_digest=first.manifest.validation_input_digest,
    )
    with pytest.raises(ContractValueError, match="exact training slice"):
        validate_tree_attributions(
            context.samples,
            context.plan,
            context.matrix,
            (replace(first, manifest=leaked_manifest), *evidence.attributions[1:]),
        )

    unsupported = replace(
        first,
        method=AttributionMethod.EXACT_ADDITIVE_EQUIVALENT,
        dependence=AttributionDependence.DECLARED_BACKGROUND,
    )
    reports = validate_tree_attributions(
        context.samples,
        context.plan,
        context.matrix,
        (unsupported, *evidence.attributions[1:]),
    )
    assert reports[0].status is DiagnosticStatus.UNSUPPORTED


def test_actual_heldout_fit_and_self_consistent_model_substitutions_are_rejected(
    context: DiagnosticContext,
    evidence: DiagnosticEvidence,
) -> None:
    first = evidence.attributions[0]
    manifest = first.manifest
    params = BoostParams(max_depth=2, n_estimators=12, learning_rate="0.2", min_child_weight=1)
    heldout_labels = tuple(
        1 if context.samples.by_id(sample_id).binary_outcome is True else 0
        for sample_id in manifest.validation_sample_ids
    )
    heldout_binding, heldout_output = refit_xgb_classifier_artifact(
        _rows_for(context, manifest.validation_sample_ids, manifest.feature_ids),
        heldout_labels,
        _rows_for(context, manifest.validation_sample_ids, manifest.feature_ids),
        feature_ids=manifest.feature_ids,
        params=params,
        seed=manifest.seed,
    )
    heldout_scores = quantize_probability_vector(
        heldout_output.probabilities,
        field="heldout-fit probabilities",
    )
    heldout_margins = quantize_vector(
        heldout_output.raw_margins,
        field="heldout-fit raw margins",
    )
    heldout_manifest = replace(
        manifest,
        fit_artifact_digest=DigestV1(heldout_binding.fit_artifact_digest),
        fit_artifact_ubj=heldout_binding.fit_artifact_ubj,
        prediction_output_digest=fold_prediction_output_digest(
            manifest.validation_sample_ids,
            heldout_scores,
            heldout_margins,
            tuple(
                context.matrix.max_feature_asof_for(sample_id, manifest.feature_ids)
                for sample_id in manifest.validation_sample_ids
            ),
        ),
    )
    with pytest.raises(ContractValueError, match="deterministic model fitted"):
        validate_tree_attributions(
            context.samples,
            context.plan,
            context.matrix,
            (replace(first, manifest=heldout_manifest), *evidence.attributions[1:]),
        )

    changed_params = BoostParams(
        max_depth=4,
        n_estimators=16,
        learning_rate="0.9",
        min_child_weight=2,
    ).as_mapping()
    changed_manifest = replace(
        manifest,
        params=tuple(sorted((key, str(value)) for key, value in changed_params.items())),
        params_digest=_mapping_digest(changed_params),
    )
    changed_manifest = replace(
        changed_manifest,
        model_spec_digest=diagnostic_model_spec_digest(changed_manifest),
    )
    with pytest.raises(ContractValueError, match="deterministic model fitted"):
        validate_tree_attributions(
            context.samples,
            context.plan,
            context.matrix,
            (replace(first, manifest=changed_manifest), *evidence.attributions[1:]),
        )

    foreign_model = replace(
        manifest,
        algorithm_id="fabricated-classifier",
        model_revision="fabricated-9.9.9",
    )
    foreign_model = replace(
        foreign_model,
        model_spec_digest=diagnostic_model_spec_digest(foreign_model),
    )
    with pytest.raises(ContractValueError, match="exact Q10 engine"):
        validate_tree_attributions(
            context.samples,
            context.plan,
            context.matrix,
            (replace(first, manifest=foreign_model), *evidence.attributions[1:]),
        )


def test_permutation_and_ablation_outputs_require_exact_artifact_replay(
    context: DiagnosticContext,
    evidence: DiagnosticEvidence,
) -> None:
    first_permutation = evidence.permutations[0]
    permuted = first_permutation.permuted
    zero_scores = tuple(FixedPointV1(0) for _ in permuted.scores)
    zero_margins = tuple(FixedPointV1(0) for _ in permuted.raw_margins)
    forged_permuted = replace(
        permuted,
        scores=zero_scores,
        raw_margins=zero_margins,
        output_digest=fold_prediction_output_digest(
            permuted.manifest.validation_sample_ids,
            zero_scores,
            zero_margins,
            permuted.max_feature_asof_ns,
        ),
    )
    with pytest.raises(ContractValueError, match="exact replay"):
        chronological_permutation_importance(
            context.samples,
            context.plan,
            context.matrix,
            (
                replace(first_permutation, permuted=forged_permuted),
                *evidence.permutations[1:],
            ),
        )

    receivers = first_permutation.permutation.receiver_sample_ids
    fold = next(
        item for item in context.plan.folds if item.fold_id == first_permutation.permutation.fold_id
    )
    donor_pool = (*fold.train_sample_ids, *fold.validation_sample_ids)
    feature_id = first_permutation.permutation.feature_id
    bad_donors = tuple(
        next(
            donor_id
            for donor_id in donor_pool
            if donor_id != receiver_id
            and donor_id != expected_donor_id
            and context.samples.by_id(donor_id).cutoff_ns
            <= context.samples.by_id(receiver_id).cutoff_ns
            and context.matrix.cell_for(donor_id, feature_id).observation.as_of_ns
            <= context.samples.by_id(receiver_id).cutoff_ns
        )
        for receiver_id, expected_donor_id in zip(
            receivers,
            first_permutation.permutation.donor_sample_ids,
            strict=True,
        )
    )
    manifest = first_permutation.baseline.manifest
    bad_replay = xgb_classifier_artifact_outputs(
        manifest.fit_artifact_ubj,
        permutation_evaluation_rows(
            context.samples,
            context.matrix,
            receiver_sample_ids=receivers,
            donor_sample_ids=bad_donors,
            feature_ids=manifest.feature_ids,
            feature_id=feature_id,
        ),
    )
    bad_permutation = replace(
        first_permutation,
        permutation=replace(
            first_permutation.permutation,
            donor_sample_ids=bad_donors,
            input_digest=permutation_input_digest(
                context.samples,
                context.matrix,
                receiver_sample_ids=receivers,
                donor_sample_ids=bad_donors,
                feature_ids=manifest.feature_ids,
                feature_id=feature_id,
            ),
        ),
        permuted=_predictions(
            context,
            manifest,
            bad_replay.probabilities,
            bad_replay.raw_margins,
            max_feature_asof_ns=permutation_max_feature_asof_ns(
                context.samples,
                context.matrix,
                receiver_sample_ids=receivers,
                donor_sample_ids=bad_donors,
                feature_ids=manifest.feature_ids,
                feature_id=feature_id,
            ),
        ),
    )
    with pytest.raises(ContractValueError, match="deterministic donor order"):
        chronological_permutation_importance(
            context.samples,
            context.plan,
            context.matrix,
            (bad_permutation, *evidence.permutations[1:]),
        )

    first_ablation = evidence.ablated[0]
    full = next(
        variant
        for variant in evidence.full
        if variant.predictions.manifest.fold_id == first_ablation.predictions.manifest.fold_id
    )
    reused_manifest = replace(
        first_ablation.predictions.manifest,
        fit_artifact_digest=full.predictions.manifest.fit_artifact_digest,
        fit_artifact_ubj=full.predictions.manifest.fit_artifact_ubj,
    )
    reused_ablation = replace(
        first_ablation,
        predictions=replace(first_ablation.predictions, manifest=reused_manifest),
    )
    with pytest.raises(ContractValueError, match="deterministic model fitted"):
        family_ablation(
            context.samples,
            context.plan,
            context.matrix,
            evidence.full,
            (reused_ablation, *evidence.ablated[1:]),
        )


def test_permutation_manifest_rejects_identity_and_misaligned_donors(
    context: DiagnosticContext,
) -> None:
    fold = context.plan.folds[0]
    with pytest.raises(ContractValueError, match="non-identity"):
        PermutationManifestV1(
            plan_digest=context.plan.digest(),
            input_digest=_digest("identity-permutation"),
            fold_id=fold.fold_id,
            feature_id="candidate_signal",
            repeat_index=0,
            seed=7,
            receiver_sample_ids=fold.validation_sample_ids,
            donor_sample_ids=fold.validation_sample_ids,
        )
    with pytest.raises(ContractValueError, match="receivers and donors must align"):
        PermutationManifestV1(
            plan_digest=context.plan.digest(),
            input_digest=_digest("cross-slice-permutation"),
            fold_id=fold.fold_id,
            feature_id="candidate_signal",
            repeat_index=0,
            seed=7,
            receiver_sample_ids=fold.validation_sample_ids,
            donor_sample_ids=fold.validation_sample_ids[1:],
        )


def test_sign_and_monotonicity_require_two_chronological_folds(
    context: DiagnosticContext,
    evidence: DiagnosticEvidence,
) -> None:
    stable = sign_monotonicity_stability(
        context.samples,
        context.plan,
        context.matrix,
        evidence.shapes,
    )
    assert tuple(report.feature_id for report in stable) == context.matrix.feature_ids
    for report in stable:
        if report.status is DiagnosticStatus.AVAILABLE:
            assert report.available_slice_count >= 2

    first_index, first = next(
        (index, item)
        for index, item in enumerate(evidence.shapes)
        if item.status is ShapeEvidenceStatus.AVAILABLE
        and item.signed_effect is not None
        and item.comparable_steps > 0
    )
    alternate_violations = 0 if first.monotonic_violation_count else 1
    assert first.signed_effect is not None
    mutations = (
        replace(first, signed_effect=FixedPointV1(first.signed_effect.mantissa + 1)),
        replace(first, comparable_steps=first.comparable_steps + 1),
        replace(first, monotonic_violation_count=alternate_violations),
        replace(
            first,
            status=ShapeEvidenceStatus.DATA_INSUFFICIENT,
            signed_effect=None,
            comparable_steps=0,
            monotonic_violation_count=0,
        ),
    )
    for mutation in mutations:
        forged = list(evidence.shapes)
        forged[first_index] = mutation
        with pytest.raises(ContractValueError, match="exact training-fit artifact replay"):
            sign_monotonicity_stability(
                context.samples,
                context.plan,
                context.matrix,
                tuple(forged),
            )


def test_genuine_family_refits_and_incremental_engine_baseline(
    context: DiagnosticContext,
    evidence: DiagnosticEvidence,
) -> None:
    ablations = family_ablation(
        context.samples,
        context.plan,
        context.matrix,
        evidence.full,
        evidence.ablated,
    )
    assert tuple(item.family_id for item in ablations) == context.matrix.family_ids
    assert all(item.status is DiagnosticStatus.AVAILABLE for item in ablations)
    assert all(item.mean_brier_importance is not None for item in ablations)

    incremental = incremental_engine_value(
        context.samples,
        context.plan,
        context.matrix,
        evidence.engine,
        evidence.augmented,
    )
    assert incremental.status is DiagnosticStatus.AVAILABLE
    assert incremental.engine_feature_ids == ("engine_signal",)
    assert incremental.candidate_feature_ids == ("candidate_signal", "noise")
    assert incremental.mean_brier_improvement is not None

    first = evidence.ablated[0]
    wrong_seed = replace(
        first,
        predictions=replace(
            first.predictions,
            manifest=replace(first.predictions.manifest, seed=8),
        ),
    )
    with pytest.raises(ContractValueError, match="model specification digest"):
        family_ablation(
            context.samples,
            context.plan,
            context.matrix,
            evidence.full,
            (wrong_seed, *evidence.ablated[1:]),
        )

    engine_first = evidence.engine[0]
    candidate_only = replace(
        engine_first,
        predictions=replace(
            engine_first.predictions,
            manifest=replace(
                engine_first.predictions.manifest,
                feature_ids=("candidate_signal",),
            ),
        ),
    )
    with pytest.raises(ContractValueError, match="training input"):
        incremental_engine_value(
            context.samples,
            context.plan,
            context.matrix,
            (candidate_only, *evidence.engine[1:]),
            evidence.augmented,
        )


def test_complete_ten_obligation_suite_has_no_promotion_authority() -> None:
    obligations = tuple(
        DiagnosticObligationEvidenceV1(
            obligation=obligation,
            status=DiagnosticStatus.AVAILABLE,
            evidence_digest=_digest(obligation.value),
        )
        for obligation in sorted(DiagnosticObligation, key=lambda item: item.value)
    )
    suite = FeatureDiagnosticSuiteV1(
        posture=EvidencePosture.REPLAY,
        obligations=obligations,
    )

    assert len(suite.obligations) == 10
    assert set(diagnostic_obligations()) == {item.value for item in DiagnosticObligation}
    assert suite.promotion_authority is False
    assert suite.as_mapping()["promotionAuthority"] is False
    assert suite.as_mapping()["posture"] == "REPLAY"
    assert isinstance(suite.digest(), DigestV1)

    with pytest.raises(ContractValueError, match="all ten obligations"):
        FeatureDiagnosticSuiteV1(
            posture=EvidencePosture.REPLAY,
            obligations=obligations[:-1],
        )
    with pytest.raises(ContractValueError, match="synthetic diagnostic suites"):
        FeatureDiagnosticSuiteV1(
            posture=EvidencePosture.SYNTHETIC,
            obligations=obligations,
        )


def test_synthetic_samples_cannot_publish_available_diagnostics(
    context: DiagnosticContext,
    evidence: DiagnosticEvidence,
) -> None:
    synthetic_samples = replace(context.samples, posture=EvidencePosture.SYNTHETIC)
    synthetic_matrix = replace(
        context.matrix,
        dataset_digest=synthetic_samples.digest(),
        posture=EvidencePosture.SYNTHETIC,
        feature_cells=tuple(
            tuple(replace(cell, posture=EvidencePosture.SYNTHETIC) for cell in row)
            for row in context.matrix.feature_cells
        ),
    )
    with pytest.raises(ContractValueError, match="synthetic evidence"):
        sign_monotonicity_stability(
            synthetic_samples,
            context.plan,
            synthetic_matrix,
            evidence.shapes,
        )
