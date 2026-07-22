"""Binary64 model engine — the only module that touches numpy/sklearn/xgboost.

Floats exist here and die at the ``quantize`` boundary in the calling layer.
Every fit is single-threaded by law (``threadpool_limits(1)`` plus explicit
``n_jobs=1`` / fixed seeds), fits see the training slice only, and isotonic
calibration fits on the validation slice only. No function here reads the
environment, the clock or the network; no model is persisted to storage. Q14
diagnostics may carry bounded in-memory UBJ bytes solely so the validator can
refit and replay the exact artifact without accepting caller declarations.
"""

from __future__ import annotations

import hashlib
import warnings
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import numpy as np
import numpy.typing as npt
from sklearn.feature_selection import mutual_info_classif
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LinearRegression, LogisticRegression, QuantileRegressor
from threadpoolctl import threadpool_limits
from xgboost import Booster, DMatrix, XGBClassifier, XGBRanker, XGBRegressor

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError

_FloatArray = npt.NDArray[np.float64]

Rows = tuple[tuple[int | None, ...], ...]
Labels = tuple[int, ...]
IndexTuple = tuple[int, ...]

DIAGNOSTIC_ALGORITHM_ID = "xgb-binary-hist"
DIAGNOSTIC_MODEL_REVISION = "xgboost-3.3.0"
MAX_DIAGNOSTIC_ARTIFACT_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class DiagnosticPermutationOutput:
    feature_index: int
    donor_indices: IndexTuple
    probabilities: tuple[float, ...]
    raw_margins: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class DiagnosticShapeOutput:
    feature_index: int
    regime_index: int
    signed_effect: float | None
    comparable_steps: int
    monotonic_violation_count: int


@dataclass(frozen=True, slots=True)
class DiagnosticFitBinding:
    params_digest: str
    model_spec_digest: str
    fit_artifact_digest: str
    fit_artifact_ubj: bytes

    def __post_init__(self) -> None:
        for field in ("params_digest", "model_spec_digest", "fit_artifact_digest"):
            value = getattr(self, field)
            if (
                not isinstance(value, str)
                or len(value) != 64
                or any(character not in "0123456789abcdef" for character in value)
            ):
                raise ContractValueError(f"{field} must be lowercase SHA-256")
        if (
            not isinstance(self.fit_artifact_ubj, bytes)
            or not 0 < len(self.fit_artifact_ubj) <= MAX_DIAGNOSTIC_ARTIFACT_BYTES
        ):
            raise ContractValueError("diagnostic fit artifact must be bounded UBJ bytes")
        if hashlib.sha256(self.fit_artifact_ubj).hexdigest() != self.fit_artifact_digest:
            raise ContractValueError("diagnostic fit artifact digest does not match UBJ bytes")


@dataclass(frozen=True, slots=True)
class DiagnosticTreeOutput:
    binding: DiagnosticFitBinding
    probabilities: tuple[float, ...]
    raw_margins: tuple[float, ...]
    contributions_with_bias: tuple[tuple[float, ...], ...]
    permutations: tuple[DiagnosticPermutationOutput, ...]
    shapes: tuple[DiagnosticShapeOutput, ...]


@dataclass(frozen=True, slots=True)
class DiagnosticSubsetOutput:
    binding: DiagnosticFitBinding
    probabilities: tuple[float, ...]
    raw_margins: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class DiagnosticArtifactOutput:
    probabilities: tuple[float, ...]
    raw_margins: tuple[float, ...]
    contributions_with_bias: tuple[tuple[float, ...], ...]


@dataclass(frozen=True, slots=True)
class BoostParams:
    """Exact JSON-safe boosted-tree parameters; the engine converts once."""

    max_depth: int
    n_estimators: int
    learning_rate: str
    min_child_weight: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "learningRate": self.learning_rate,
            "maxDepth": str(self.max_depth),
            "minChildWeight": str(self.min_child_weight),
            "nEstimators": str(self.n_estimators),
        }

    def learning_rate_value(self) -> float:
        try:
            value = float(self.learning_rate)
        except ValueError as error:
            raise ContractValueError("learning_rate must be a decimal string") from error
        if not 0.0 < value <= 1.0:
            raise ContractValueError("learning_rate must lie in (0, 1]")
        return value


def _matrix(rows: Rows, indices: range) -> _FloatArray:
    return np.array([rows[index] for index in indices], dtype=np.float64)


def _vector(labels: Labels, indices: range) -> _FloatArray:
    return np.array([labels[index] for index in indices], dtype=np.float64)


def _as_floats(values: _FloatArray) -> tuple[float, ...]:
    return tuple(float(item) for item in values)


def _sha256_mapping(value: dict[str, object]) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _diagnostic_fit_binding(
    model: XGBClassifier,
    *,
    params: BoostParams,
    feature_ids: tuple[str, ...],
    seed: int,
) -> DiagnosticFitBinding:
    params_digest = _sha256_mapping(params.as_mapping())
    model_spec_digest = _sha256_mapping(
        {
            "algorithmId": DIAGNOSTIC_ALGORITHM_ID,
            "featureIds": list(feature_ids),
            "modelRevision": DIAGNOSTIC_MODEL_REVISION,
            "objective": "binary:logistic",
            "paramsDigest": params_digest,
            "seed": str(seed),
            "treeMethod": "hist",
        }
    )
    artifact = bytes(model.get_booster().save_raw(raw_format="ubj"))
    return DiagnosticFitBinding(
        params_digest=params_digest,
        model_spec_digest=model_spec_digest,
        fit_artifact_digest=hashlib.sha256(artifact).hexdigest(),
        fit_artifact_ubj=artifact,
    )


def _diagnostic_artifact_outputs(
    booster: Booster,
    evaluate_x: _FloatArray,
    *,
    include_contributions: bool,
) -> DiagnosticArtifactOutput:
    matrix = DMatrix(evaluate_x)
    with threadpool_limits(limits=1):
        probabilities = _normalize_binary_margin(booster.predict(matrix, strict_shape=True))
        raw_margins = _normalize_binary_margin(
            booster.predict(matrix, output_margin=True, strict_shape=True)
        )
        contributions = (
            _normalize_binary_contributions(
                booster.predict(
                    matrix,
                    pred_contribs=True,
                    approx_contribs=False,
                    strict_shape=True,
                ),
                row_count=len(evaluate_x),
                feature_count=evaluate_x.shape[1],
            )
            if include_contributions
            else np.empty((len(evaluate_x), 0), dtype=np.float64)
        )
    return DiagnosticArtifactOutput(
        probabilities=_as_floats(probabilities),
        raw_margins=_as_floats(raw_margins),
        contributions_with_bias=(
            tuple(_as_floats(row) for row in contributions) if include_contributions else ()
        ),
    )


def _load_diagnostic_booster(fit_artifact_ubj: bytes) -> Booster:
    if (
        not isinstance(fit_artifact_ubj, bytes)
        or not 0 < len(fit_artifact_ubj) <= MAX_DIAGNOSTIC_ARTIFACT_BYTES
    ):
        raise ContractValueError("diagnostic fit artifact must be bounded UBJ bytes")
    booster = Booster()
    try:
        booster.load_model(bytearray(fit_artifact_ubj))
    except Exception as error:
        raise ContractValueError("diagnostic fit artifact is not loadable XGBoost UBJ") from error
    return booster


def xgb_classifier_artifact_outputs(
    fit_artifact_ubj: bytes,
    evaluate_rows: Rows,
    *,
    include_contributions: bool = False,
) -> DiagnosticArtifactOutput:
    """Replay a bounded UBJ artifact on an explicit evaluation slice only."""

    if not isinstance(evaluate_rows, tuple) or not evaluate_rows:
        raise ContractValueError("diagnostic artifact replay requires evaluation rows")
    width = len(evaluate_rows[0])
    if width == 0 or any(not isinstance(row, tuple) or len(row) != width for row in evaluate_rows):
        raise ContractValueError("diagnostic artifact replay rows must share one width")
    return _diagnostic_artifact_outputs(
        _load_diagnostic_booster(fit_artifact_ubj),
        np.asarray(evaluate_rows, dtype=np.float64),
        include_contributions=include_contributions,
    )


def refit_xgb_classifier_artifact(
    train_rows: Rows,
    train_labels: Labels,
    evaluate_rows: Rows,
    *,
    feature_ids: tuple[str, ...],
    params: BoostParams,
    seed: int,
    include_contributions: bool = False,
) -> tuple[DiagnosticFitBinding, DiagnosticArtifactOutput]:
    """Deterministically refit from an explicit train slice and replay holdout rows."""

    if not isinstance(train_rows, tuple) or not train_rows or len(train_rows) != len(train_labels):
        raise ContractValueError("diagnostic refit train rows and labels must align")
    if not isinstance(evaluate_rows, tuple) or not evaluate_rows:
        raise ContractValueError("diagnostic refit requires evaluation rows")
    width = len(train_rows[0])
    if (
        width == 0
        or len(feature_ids) != width
        or feature_ids != tuple(sorted(set(feature_ids)))
        or any(not isinstance(row, tuple) or len(row) != width for row in train_rows)
        or any(not isinstance(row, tuple) or len(row) != width for row in evaluate_rows)
    ):
        raise ContractValueError("diagnostic refit rows must match sorted feature identities")
    if set(train_labels) != {0, 1}:
        raise ContractValueError("diagnostic classifier training requires both classes")
    model = _fit_diagnostic_classifier(
        np.asarray(train_rows, dtype=np.float64),
        np.asarray(train_labels, dtype=np.float64),
        params=params,
        seed=seed,
    )
    binding = _diagnostic_fit_binding(
        model,
        params=params,
        feature_ids=feature_ids,
        seed=seed,
    )
    return binding, _diagnostic_artifact_outputs(
        model.get_booster(),
        np.asarray(evaluate_rows, dtype=np.float64),
        include_contributions=include_contributions,
    )


def _require_indices(indices: IndexTuple, *, row_count: int, field: str) -> None:
    if not isinstance(indices, tuple) or not indices:
        raise ContractValueError(f"{field} must be a non-empty tuple")
    if len(set(indices)) != len(indices):
        raise ContractValueError(f"{field} must contain unique indices")
    if any(isinstance(index, bool) or not isinstance(index, int) for index in indices):
        raise ContractValueError(f"{field} must contain integers")
    if any(not 0 <= index < row_count for index in indices):
        raise ContractValueError(f"{field} contains an out-of-range index")


def _require_feature_indices(feature_indices: IndexTuple, *, width: int) -> None:
    _require_indices(feature_indices, row_count=width, field="feature_indices")
    if feature_indices != tuple(sorted(feature_indices)):
        raise ContractValueError("feature_indices must be sorted")


def _indexed_matrix(
    rows: Rows,
    row_indices: IndexTuple,
    feature_indices: IndexTuple,
) -> _FloatArray:
    return np.asarray(
        [[rows[row_index][column] for column in feature_indices] for row_index in row_indices],
        dtype=np.float64,
    )


def _indexed_vector(labels: Labels, indices: IndexTuple) -> _FloatArray:
    return np.asarray([labels[index] for index in indices], dtype=np.float64)


def training_mutual_information(
    rows: Rows,
    labels: Labels,
    train_indices: IndexTuple,
    *,
    discrete_features: tuple[bool, ...],
    seed: int,
) -> tuple[float, ...]:
    """Estimate MI from the explicit training slice only; no validation row is read."""

    if len(rows) != len(labels) or not rows:
        raise ContractValueError("rows and labels must align and be non-empty")
    width = len(rows[0])
    if any(len(row) != width for row in rows):
        raise ContractValueError("rows must share one feature width")
    _require_indices(train_indices, row_count=len(rows), field="train_indices")
    if len(train_indices) < 4:
        raise ContractValueError("mutual information requires at least four training rows")
    if not isinstance(discrete_features, tuple) or len(discrete_features) != width:
        raise ContractValueError("discrete_features must match the feature width")
    if any(not isinstance(value, bool) for value in discrete_features):
        raise ContractValueError("discrete_features must contain booleans")
    train_labels = tuple(labels[index] for index in train_indices)
    if set(train_labels) != {0, 1}:
        raise ContractValueError("mutual information requires both binary classes in training")
    with threadpool_limits(limits=1):
        values = mutual_info_classif(
            _indexed_matrix(rows, train_indices, tuple(range(width))),
            _indexed_vector(labels, train_indices),
            discrete_features=np.asarray(discrete_features, dtype=np.bool_),
            random_state=seed,
            n_jobs=1,
        )
    return _as_floats(np.asarray(values, dtype=np.float64))


def _normalize_binary_margin(values: npt.NDArray[np.floating[Any]]) -> _FloatArray:
    normalized = np.asarray(values, dtype=np.float64)
    if normalized.ndim == 2 and normalized.shape[1] == 1:
        normalized = normalized[:, 0]
    if normalized.ndim != 1:
        raise ContractValueError("binary raw-margin shape must be one value per row")
    return normalized


def _normalize_binary_contributions(
    values: npt.NDArray[np.floating[Any]],
    *,
    row_count: int,
    feature_count: int,
) -> _FloatArray:
    normalized = np.asarray(values, dtype=np.float64)
    if normalized.ndim == 3 and normalized.shape[1] == 1:
        normalized = normalized[:, 0, :]
    if normalized.shape != (row_count, feature_count + 1):
        raise ContractValueError("TreeSHAP contributions must include every feature plus bias")
    return normalized


def _fit_diagnostic_classifier(
    train_x: _FloatArray,
    train_y: _FloatArray,
    *,
    params: BoostParams,
    seed: int,
) -> XGBClassifier:
    model = XGBClassifier(
        objective="binary:logistic",
        **_boost_common(params, None, random_state=seed),
    )
    with threadpool_limits(limits=1):
        model.fit(train_x, train_y)
    return model


def _diagnostic_shapes(
    booster: Booster,
    train_x: _FloatArray,
    evaluate_x: _FloatArray,
    feature_indices: IndexTuple,
    regime_positions: tuple[IndexTuple, ...],
) -> tuple[DiagnosticShapeOutput, ...]:
    outputs: list[DiagnosticShapeOutput] = []
    for local_feature, feature_index in enumerate(feature_indices):
        anchors = np.unique(np.quantile(train_x[:, local_feature], (0.25, 0.5, 0.75)))
        for regime_index, positions in enumerate(regime_positions):
            _require_indices(
                positions,
                row_count=len(evaluate_x),
                field=f"regime_positions[{regime_index}]",
            )
            if len(anchors) < 2:
                outputs.append(
                    DiagnosticShapeOutput(
                        feature_index=feature_index,
                        regime_index=regime_index,
                        signed_effect=None,
                        comparable_steps=0,
                        monotonic_violation_count=0,
                    )
                )
                continue
            base = np.asarray(evaluate_x[list(positions)], dtype=np.float64)
            step_effects: list[float] = []
            with threadpool_limits(limits=1):
                for low, high in pairwise(anchors):
                    low_rows = base.copy()
                    high_rows = base.copy()
                    low_rows[:, local_feature] = low
                    high_rows[:, local_feature] = high
                    low_margin = _normalize_binary_margin(
                        booster.inplace_predict(low_rows, predict_type="margin")
                    )
                    high_margin = _normalize_binary_margin(
                        booster.inplace_predict(high_rows, predict_type="margin")
                    )
                    step_effects.append(float(np.mean(high_margin - low_margin)))
            terminal = float(np.sum(np.asarray(step_effects, dtype=np.float64)))
            direction = (terminal > 0.0) - (terminal < 0.0)
            violations = sum(
                1
                for effect in step_effects
                if direction != 0 and ((effect > 0.0) - (effect < 0.0)) not in (0, direction)
            )
            outputs.append(
                DiagnosticShapeOutput(
                    feature_index=feature_index,
                    regime_index=regime_index,
                    signed_effect=terminal,
                    comparable_steps=len(step_effects),
                    monotonic_violation_count=violations,
                )
            )
    return tuple(outputs)


def xgb_classifier_artifact_shapes(
    fit_artifact_ubj: bytes,
    train_rows: Rows,
    evaluate_rows: Rows,
    *,
    regime_positions: tuple[IndexTuple, ...],
) -> tuple[DiagnosticShapeOutput, ...]:
    """Replay training-support shape probes from one verified in-memory artifact."""

    if not isinstance(train_rows, tuple) or not train_rows:
        raise ContractValueError("diagnostic shape replay requires training rows")
    if not isinstance(evaluate_rows, tuple) or not evaluate_rows:
        raise ContractValueError("diagnostic shape replay requires evaluation rows")
    width = len(train_rows[0])
    if (
        width == 0
        or any(not isinstance(row, tuple) or len(row) != width for row in train_rows)
        or any(not isinstance(row, tuple) or len(row) != width for row in evaluate_rows)
    ):
        raise ContractValueError("diagnostic shape replay rows must share one width")
    if not isinstance(regime_positions, tuple) or not regime_positions:
        raise ContractValueError("diagnostic shape replay requires regime positions")
    flattened = [position for group in regime_positions for position in group]
    if sorted(flattened) != list(range(len(evaluate_rows))) or len(flattened) != len(
        set(flattened)
    ):
        raise ContractValueError("regime positions must exactly partition evaluation rows")
    return _diagnostic_shapes(
        _load_diagnostic_booster(fit_artifact_ubj),
        np.asarray(train_rows, dtype=np.float64),
        np.asarray(evaluate_rows, dtype=np.float64),
        tuple(range(width)),
        regime_positions,
    )


def xgb_classifier_diagnostics(
    rows: Rows,
    labels: Labels,
    train_indices: IndexTuple,
    evaluate_indices: IndexTuple,
    *,
    feature_indices: IndexTuple,
    feature_ids: tuple[str, ...],
    params: BoostParams,
    seed: int,
    permutations: tuple[tuple[int, IndexTuple], ...] = (),
    regime_positions: tuple[IndexTuple, ...] | None = None,
) -> DiagnosticTreeOutput:
    """Fit once on train, then evaluate validation, TreeSHAP and same-fit permutations."""

    if len(rows) != len(labels) or not rows:
        raise ContractValueError("rows and labels must align and be non-empty")
    width = len(rows[0])
    if any(len(row) != width for row in rows):
        raise ContractValueError("rows must share one feature width")
    _require_indices(train_indices, row_count=len(rows), field="train_indices")
    _require_indices(evaluate_indices, row_count=len(rows), field="evaluate_indices")
    if set(train_indices) & set(evaluate_indices):
        raise ContractValueError("training and evaluation indices must be disjoint")
    _require_feature_indices(feature_indices, width=width)
    if len(feature_ids) != len(feature_indices):
        raise ContractValueError("feature_ids must align with feature_indices")
    if {labels[index] for index in train_indices} != {0, 1}:
        raise ContractValueError("diagnostic classifier training requires both classes")
    train_x = _indexed_matrix(rows, train_indices, feature_indices)
    evaluate_x = _indexed_matrix(rows, evaluate_indices, feature_indices)
    model = _fit_diagnostic_classifier(
        train_x,
        _indexed_vector(labels, train_indices),
        params=params,
        seed=seed,
    )
    binding = _diagnostic_fit_binding(
        model,
        params=params,
        feature_ids=feature_ids,
        seed=seed,
    )
    baseline_replay = _diagnostic_artifact_outputs(
        model.get_booster(),
        evaluate_x,
        include_contributions=True,
    )
    permutation_outputs = []
    for feature_index, donor_indices in permutations:
        if feature_index not in feature_indices:
            raise ContractValueError("permutation feature must belong to the fitted feature set")
        if (
            not isinstance(donor_indices, tuple)
            or len(donor_indices) != len(evaluate_indices)
            or any(
                isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(rows)
                for index in donor_indices
            )
            or any(
                donor == receiver
                for donor, receiver in zip(donor_indices, evaluate_indices, strict=True)
            )
        ):
            raise ContractValueError(
                "permutation donors must be aligned non-identity rows from the bound matrix"
            )
        local_feature = feature_indices.index(feature_index)
        permuted_x = evaluate_x.copy()
        for destination, donor in enumerate(donor_indices):
            permuted_x[destination, local_feature] = rows[donor][feature_index]
        with threadpool_limits(limits=1):
            permutation_replay = _diagnostic_artifact_outputs(
                model.get_booster(),
                permuted_x,
                include_contributions=False,
            )
        permutation_outputs.append(
            DiagnosticPermutationOutput(
                feature_index=feature_index,
                donor_indices=donor_indices,
                probabilities=permutation_replay.probabilities,
                raw_margins=permutation_replay.raw_margins,
            )
        )
    positions = (
        regime_positions if regime_positions is not None else (tuple(range(len(evaluate_indices))),)
    )
    flattened = [position for group in positions for position in group]
    if sorted(flattened) != list(range(len(evaluate_indices))) or len(flattened) != len(
        set(flattened)
    ):
        raise ContractValueError("regime positions must exactly partition evaluation rows")
    shapes = _diagnostic_shapes(
        model.get_booster(),
        train_x,
        evaluate_x,
        feature_indices,
        positions,
    )
    return DiagnosticTreeOutput(
        binding=binding,
        probabilities=baseline_replay.probabilities,
        raw_margins=baseline_replay.raw_margins,
        contributions_with_bias=baseline_replay.contributions_with_bias,
        permutations=tuple(permutation_outputs),
        shapes=shapes,
    )


def xgb_classifier_subset_scores(
    rows: Rows,
    labels: Labels,
    train_indices: IndexTuple,
    evaluate_indices: IndexTuple,
    *,
    feature_indices: IndexTuple,
    feature_ids: tuple[str, ...],
    params: BoostParams,
    seed: int,
) -> DiagnosticSubsetOutput:
    """Refit the same bounded classifier on an explicit feature subset."""

    if len(rows) != len(labels) or not rows:
        raise ContractValueError("rows and labels must align and be non-empty")
    width = len(rows[0])
    if any(len(row) != width for row in rows):
        raise ContractValueError("rows must share one feature width")
    _require_indices(train_indices, row_count=len(rows), field="train_indices")
    _require_indices(evaluate_indices, row_count=len(rows), field="evaluate_indices")
    if set(train_indices) & set(evaluate_indices):
        raise ContractValueError("training and evaluation indices must be disjoint")
    _require_feature_indices(feature_indices, width=width)
    if len(feature_ids) != len(feature_indices):
        raise ContractValueError("feature_ids must align with feature_indices")
    if {labels[index] for index in train_indices} != {0, 1}:
        raise ContractValueError("diagnostic classifier training requires both classes")
    model = _fit_diagnostic_classifier(
        _indexed_matrix(rows, train_indices, feature_indices),
        _indexed_vector(labels, train_indices),
        params=params,
        seed=seed,
    )
    replay = _diagnostic_artifact_outputs(
        model.get_booster(),
        _indexed_matrix(rows, evaluate_indices, feature_indices),
        include_contributions=False,
    )
    return DiagnosticSubsetOutput(
        binding=_diagnostic_fit_binding(
            model,
            params=params,
            feature_ids=feature_ids,
            seed=seed,
        ),
        probabilities=replay.probabilities,
        raw_margins=replay.raw_margins,
    )


def _standardize(train: _FloatArray, evaluate: _FloatArray) -> tuple[_FloatArray, _FloatArray]:
    """Standardize with train-slice statistics only; constant columns get unit scale."""

    mean = train.mean(axis=0)
    scale = train.std(axis=0)
    scale = np.where(scale == 0.0, 1.0, scale)
    return (train - mean) / scale, (evaluate - mean) / scale


def logistic_scores(
    rows: Rows,
    labels: Labels,
    train: range,
    evaluate: range,
    *,
    elastic_net: bool,
) -> tuple[float, ...]:
    if elastic_net:
        model = LogisticRegression(
            solver="saga",
            l1_ratio=0.5,
            C=1.0,
            max_iter=8_000,
            tol=1e-8,
            random_state=0,
        )
    else:
        model = LogisticRegression(solver="lbfgs", C=1.0, max_iter=2_000)
    with threadpool_limits(limits=1):
        train_x, eval_x = _standardize(_matrix(rows, train), _matrix(rows, evaluate))
        train_y = _vector(labels, train)
        model.fit(train_x, train_y)
        scores = model.predict_proba(eval_x)[:, 1]
    return _as_floats(np.asarray(scores, dtype=np.float64))


def linear_regression_values(
    rows: Rows, labels: Labels, train: range, evaluate: range
) -> tuple[float, ...]:
    with threadpool_limits(limits=1):
        train_x, eval_x = _standardize(_matrix(rows, train), _matrix(rows, evaluate))
        model = LinearRegression()
        model.fit(train_x, _vector(labels, train))
        values = model.predict(eval_x)
    return _as_floats(np.asarray(values, dtype=np.float64))


def quantile_linear_values(
    rows: Rows,
    labels: Labels,
    train: range,
    evaluate: range,
    *,
    quantiles: tuple[float, ...],
) -> tuple[tuple[float, ...], ...]:
    outputs: list[tuple[float, ...]] = []
    with threadpool_limits(limits=1):
        train_x, eval_x = _standardize(_matrix(rows, train), _matrix(rows, evaluate))
        train_y = _vector(labels, train)
        with warnings.catch_warnings():
            # SciPy reports native HiGHS controls as unknown before forwarding them verbatim.
            warnings.filterwarnings(
                "ignore",
                message=r"Unrecognized options detected: \{'threads': 1\}",
            )
            for quantile in quantiles:
                model = QuantileRegressor(
                    quantile=quantile,
                    alpha=0.0,
                    solver="highs-ds",
                    solver_options={"threads": 1},
                )
                model.fit(train_x, train_y)
                outputs.append(_as_floats(np.asarray(model.predict(eval_x), dtype=np.float64)))
    return tuple(outputs)


def _boost_common(
    params: BoostParams,
    monotone: tuple[int, ...] | None,
    *,
    random_state: int = 7,
) -> dict[str, Any]:
    common: dict[str, Any] = {
        "tree_method": "hist",
        "n_jobs": 1,
        "random_state": random_state,
        "max_depth": params.max_depth,
        "n_estimators": params.n_estimators,
        "learning_rate": params.learning_rate_value(),
        "min_child_weight": params.min_child_weight,
        "subsample": 1.0,
        "colsample_bytree": 1.0,
        "device": "cpu",
    }
    if monotone is not None:
        common["monotone_constraints"] = monotone
    return common


def _q10_boost_common(
    params: BoostParams,
    monotone: tuple[int, ...] | None,
) -> dict[str, Any]:
    """Pin the Q10 booster path without changing Q14's sealed histogram identity."""

    common = _boost_common(params, monotone)
    common.update(
        {
            "base_score": 0.5,
            "nthread": 1,
            "seed_per_iteration": False,
            "tree_method": "exact",
        }
    )
    return common


def _q10_booster_predict(booster: Booster, evaluate_x: _FloatArray) -> _FloatArray:
    """Use one explicit single-thread native prediction path for Q10."""

    matrix = DMatrix(evaluate_x, nthread=1)
    return np.asarray(booster.predict(matrix, strict_shape=True), dtype=np.float64)


def _q10_single_output(values: _FloatArray) -> _FloatArray:
    normalized = np.asarray(values, dtype=np.float64)
    if normalized.ndim == 2 and normalized.shape[1] == 1:
        normalized = normalized[:, 0]
    if normalized.ndim != 1:
        raise ContractValueError("Q10 prediction shape must be one value per row")
    return normalized


def xgb_classifier_scores(
    rows: Rows,
    labels: Labels,
    train: range,
    evaluate: range,
    *,
    params: BoostParams,
    monotone: tuple[int, ...] | None,
) -> tuple[float, ...]:
    model = XGBClassifier(objective="binary:logistic", **_q10_boost_common(params, monotone))
    with threadpool_limits(limits=1):
        model.fit(_matrix(rows, train), _vector(labels, train))
        scores = _q10_single_output(
            _q10_booster_predict(model.get_booster(), _matrix(rows, evaluate))
        )
    return _as_floats(scores)


def xgb_regressor_values(
    rows: Rows,
    labels: Labels,
    train: range,
    evaluate: range,
    *,
    params: BoostParams,
    monotone: tuple[int, ...] | None,
) -> tuple[float, ...]:
    model = XGBRegressor(objective="reg:squarederror", **_q10_boost_common(params, monotone))
    with threadpool_limits(limits=1):
        model.fit(_matrix(rows, train), _vector(labels, train))
        values = _q10_single_output(
            _q10_booster_predict(model.get_booster(), _matrix(rows, evaluate))
        )
    return _as_floats(values)


def xgb_quantile_values(
    rows: Rows,
    labels: Labels,
    train: range,
    evaluate: range,
    *,
    params: BoostParams,
    monotone: tuple[int, ...] | None,
    quantiles: tuple[float, ...],
) -> tuple[tuple[float, ...], ...]:
    if len(quantiles) < 2:
        raise ContractValueError("quantile prediction shape must match the requested levels")
    model = XGBRegressor(
        objective="reg:quantileerror",
        quantile_alpha=np.array(quantiles, dtype=np.float64),
        **_q10_boost_common(params, monotone),
    )
    with threadpool_limits(limits=1):
        model.fit(_matrix(rows, train), _vector(labels, train))
        values = _q10_booster_predict(model.get_booster(), _matrix(rows, evaluate))
    if values.ndim != 2 or values.shape[1] != len(quantiles):
        raise ContractValueError("quantile prediction shape must match the requested levels")
    return tuple(_as_floats(values[:, column]) for column in range(values.shape[1]))


def xgb_ranker_scores(
    rows: Rows,
    labels: Labels,
    train: range,
    evaluate: range,
    *,
    params: BoostParams,
    monotone: tuple[int, ...] | None,
    group_size: int,
) -> tuple[float, ...]:
    if len(train) % group_size != 0 or len(evaluate) % group_size != 0:
        raise ContractValueError("ranker slices must align to whole groups")
    model = XGBRanker(objective="rank:pairwise", **_q10_boost_common(params, monotone))
    train_qid = np.arange(len(train)) // group_size
    with threadpool_limits(limits=1):
        model.fit(_matrix(rows, train), _vector(labels, train), qid=train_qid)
        scores = _q10_single_output(
            _q10_booster_predict(model.get_booster(), _matrix(rows, evaluate))
        )
    return _as_floats(scores)


def isotonic_calibrate(
    fit_scores: tuple[float, ...],
    fit_labels: Labels,
    apply_scores: tuple[float, ...],
) -> tuple[float, ...]:
    """Isotonic probability calibration fit on the validation slice only."""

    if len(fit_scores) != len(fit_labels) or not fit_scores:
        raise ContractValueError("calibration fit inputs must align and be non-empty")
    model = IsotonicRegression(y_min=0.0, y_max=1.0, increasing=True, out_of_bounds="clip")
    with threadpool_limits(limits=1):
        model.fit(np.array(fit_scores, dtype=np.float64), np.array(fit_labels, dtype=np.float64))
        calibrated = model.predict(np.array(apply_scores, dtype=np.float64))
    return _as_floats(np.asarray(calibrated, dtype=np.float64))
