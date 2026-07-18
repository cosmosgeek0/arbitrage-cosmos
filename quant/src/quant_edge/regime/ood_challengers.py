"""Bounded deterministic anomaly/OOD challenger benchmark.

Locked scikit-learn 1.9 estimators cover Isolation Forest, robust covariance/PCA,
one-class SVM and a train-only MLP reconstruction challenger. ECOD and COPOD adapt the
current PyOD 3.6.1 reference score operators to chronology-safe training ECDF ranks;
neither assessment rows nor their order can change another row's score. Half-Space
Trees follow Tan, Ting and Liu's original IJCAI 2011 construction: data-independent
random workspaces, midpoint splits, reference mass, the ``0.1 * window`` terminal
rule, and depth-weighted terminal mass. Its low-is-anomalous paper score is bounded,
normalized and inverted so every public challenger consistently uses high-is-anomalous
semantics.

All outputs remain uncalibrated research scores quantized once at Q10's binary64
boundary. No result conveys strategy, promotion or execution authority.
"""

from __future__ import annotations

import hashlib
import warnings
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

import numpy as np
from numpy.typing import NDArray
from sklearn.covariance import EllipticEnvelope, MinCovDet
from sklearn.ensemble import IsolationForest
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.svm import OneClassSVM

from quant_edge.canonical import canonical_json_bytes
from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.lake.contracts import DigestV1, require_strict_int
from quant_edge.models.quantize import quantize_binary64

MAX_OOD_SAMPLES: Final = 4_096
MAX_OOD_FEATURES: Final = 64
MAX_OOD_ESTIMATORS: Final = 128
MAX_HALF_SPACE_NODES: Final = 262_144
MAX_AUTOENCODER_HIDDEN_UNITS: Final = 64
MAX_AUTOENCODER_ITERATIONS: Final = 1_024
MAX_AUTOENCODER_FUNCTION_CALLS: Final = 65_536
MIN_OOD_TRAINING_SAMPLES: Final = 8


class OodMethod(StrEnum):
    ISOLATION_FOREST = "ISOLATION_FOREST"
    ECOD = "ECOD"
    COPOD = "COPOD"
    HALF_SPACE_TREES = "HALF_SPACE_TREES"
    ROBUST_COVARIANCE = "ROBUST_COVARIANCE"
    ROBUST_PCA = "ROBUST_PCA"
    ONE_CLASS_SVM = "ONE_CLASS_SVM"
    AUTOENCODER = "AUTOENCODER"


class OodStatus(StrEnum):
    EVALUATED_RESEARCH_ONLY = "EVALUATED_RESEARCH_ONLY"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"
    BLOCKED_DATA = "BLOCKED_DATA"


@dataclass(frozen=True, slots=True)
class OodBenchmarkSpecV1:
    seed: int
    max_samples: int
    max_features: int
    contamination: ExactRatioV1
    isolation_estimators: int
    half_space_trees: int
    half_space_depth: int
    autoencoder_hidden_units: int = 8
    autoencoder_max_iterations: int = 256
    autoencoder_max_function_calls: int = 8_192

    def __post_init__(self) -> None:
        require_strict_int(self.seed, field="seed", minimum=0)
        require_strict_int(
            self.max_samples, field="max_samples", minimum=8, maximum=MAX_OOD_SAMPLES
        )
        require_strict_int(
            self.max_features, field="max_features", minimum=1, maximum=MAX_OOD_FEATURES
        )
        if not isinstance(self.contamination, ExactRatioV1) or not (
            0 < self.contamination.numerator * 2 < self.contamination.denominator
        ):
            raise ContractValueError("contamination must lie strictly inside (0, 0.5)")
        require_strict_int(
            self.isolation_estimators,
            field="isolation_estimators",
            minimum=8,
            maximum=MAX_OOD_ESTIMATORS,
        )
        require_strict_int(
            self.half_space_trees,
            field="half_space_trees",
            minimum=4,
            maximum=MAX_OOD_ESTIMATORS,
        )
        require_strict_int(self.half_space_depth, field="half_space_depth", minimum=2, maximum=16)
        half_space_nodes = self.half_space_trees * ((1 << (self.half_space_depth + 1)) - 1)
        if half_space_nodes > MAX_HALF_SPACE_NODES:
            raise ContractValueError(
                f"half-space tree capacity must not exceed {MAX_HALF_SPACE_NODES} nodes"
            )
        require_strict_int(
            self.autoencoder_hidden_units,
            field="autoencoder_hidden_units",
            minimum=1,
            maximum=MAX_AUTOENCODER_HIDDEN_UNITS,
        )
        require_strict_int(
            self.autoencoder_max_iterations,
            field="autoencoder_max_iterations",
            minimum=16,
            maximum=MAX_AUTOENCODER_ITERATIONS,
        )
        require_strict_int(
            self.autoencoder_max_function_calls,
            field="autoencoder_max_function_calls",
            minimum=64,
            maximum=MAX_AUTOENCODER_FUNCTION_CALLS,
        )


@dataclass(frozen=True, slots=True)
class OodChallengerResultV1:
    method: OodMethod
    status: OodStatus
    scores: tuple[FixedPointV1, ...]
    score_digest: DigestV1 | None
    top_k_recall: ExactRatioV1 | None
    reason: str | None

    def __post_init__(self) -> None:
        if not isinstance(self.method, OodMethod):
            raise ContractValueError("method must be OodMethod")
        if not isinstance(self.status, OodStatus):
            raise ContractValueError("status must be OodStatus")
        evaluated = self.status is OodStatus.EVALUATED_RESEARCH_ONLY
        if evaluated != bool(self.scores) or evaluated != (self.score_digest is not None):
            raise ContractValueError("only evaluated challengers expose scores and a digest")
        if evaluated == (self.reason is not None):
            raise ContractValueError("unevaluated challengers must name a reason")


def _matrix(
    rows: tuple[tuple[FixedPointV1, ...], ...], *, spec: OodBenchmarkSpecV1, field: str
) -> NDArray[np.float64]:
    if not isinstance(rows, tuple) or not rows or len(rows) > spec.max_samples:
        raise ContractValueError(f"{field} must be non-empty and bounded by max_samples")
    width = len(rows[0])
    if not 1 <= width <= spec.max_features:
        raise ContractValueError(f"{field} width must be bounded by max_features")
    values: list[list[float]] = []
    for row in rows:
        if not isinstance(row, tuple) or len(row) != width:
            raise ContractValueError(f"{field} rows must have one fixed width")
        if any(not isinstance(value, FixedPointV1) for value in row):
            raise ContractValueError(f"{field} must contain FixedPointV1")
        values.append([value.mantissa / FIXED_POINT_SCALE for value in row])
    matrix = np.asarray(values, dtype=np.float64)
    if not np.isfinite(matrix).all():
        raise ContractValueError(f"{field} must be finite")
    return matrix


def _training_skew_signs(train: NDArray[np.float64]) -> NDArray[np.int8]:
    """Paper-defined sample-skew signs, with zero spread treated as symmetric."""

    centered = train - np.mean(train, axis=0)
    numerator = np.mean(centered**3, axis=0)
    variance = np.sum(centered**2, axis=0) / (train.shape[0] - 1)
    denominator = variance**1.5
    signs = np.zeros(train.shape[1], dtype=np.int8)
    defined = denominator > 0
    signs[defined & (numerator < 0)] = -1
    signs[defined & (numerator > 0)] = 1
    return signs


def _tail_losses(
    train: NDArray[np.float64], test: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Return train-only left, right and PyOD-compatible skew tail losses.

    ``(count + 1) / (n + 1)`` is the frozen held-out rank-p-value law. It avoids
    zero-probability extrapolation without concatenating assessment rows into the
    training ECDF, unlike PyOD's transductive convenience path.
    """

    sample_count, feature_count = train.shape
    denominator = sample_count + 1
    left = np.empty(test.shape, dtype=np.float64)
    right = np.empty(test.shape, dtype=np.float64)
    for column in range(feature_count):
        ordered = np.sort(train[:, column], kind="stable")
        left_count = np.searchsorted(ordered, test[:, column], side="right")
        right_count = sample_count - np.searchsorted(ordered, test[:, column], side="left")
        left[:, column] = -np.log((left_count + 1) / denominator)
        right[:, column] = -np.log((right_count + 1) / denominator)

    skew = np.empty(test.shape, dtype=np.float64)
    for column, sign in enumerate(_training_skew_signs(train)):
        if sign < 0:
            skew[:, column] = left[:, column]
        elif sign > 0:
            skew[:, column] = right[:, column]
        else:
            # PyOD 3.6.1's exact-zero branch combines both tails.
            skew[:, column] = left[:, column] + right[:, column]
    return left, right, skew


def _ecod_scores(train: NDArray[np.float64], test: NDArray[np.float64]) -> NDArray[np.float64]:
    left, right, skew = _tail_losses(train, test)
    return np.sum(np.maximum(np.maximum(left, right), skew), axis=1)


def _copod_scores(train: NDArray[np.float64], test: NDArray[np.float64]) -> NDArray[np.float64]:
    left, right, skew = _tail_losses(train, test)
    return np.sum(np.maximum(skew, (left + right) / 2), axis=1)


def _hash_int(*parts: int) -> int:
    payload = ":".join(str(part) for part in parts).encode("ascii")
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big")


def _hash_unit(*parts: int) -> float:
    """A deterministic binary64 draw in ``[0, 1)`` from the declared seed path."""

    return (_hash_int(*parts) >> 11) / float(1 << 53)


def _half_space_scaled(
    train: NDArray[np.float64], test: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    lower = np.min(train, axis=0)
    span = np.max(train, axis=0) - lower
    if np.any(span <= 0):
        raise ContractValueError("half-space trees require nonconstant training features")
    return (train - lower) / span, (test - lower) / span


def _half_space_workspace(
    *, feature_count: int, seed: int, tree: int
) -> tuple[list[float], list[float]]:
    lower: list[float] = []
    upper: list[float] = []
    for feature in range(feature_count):
        center = _hash_unit(seed, tree, feature, 0)
        radius = 2 * max(center, 1 - center)
        lower.append(center - radius)
        upper.append(center + radius)
    return lower, upper


def _half_space_path(
    row: NDArray[np.float64],
    *,
    seed: int,
    tree: int,
    depth_limit: int,
    workspace: tuple[list[float], list[float]],
) -> tuple[int, ...]:
    lower = workspace[0].copy()
    upper = workspace[1].copy()
    node = 0
    path = [node]
    feature_count = row.shape[0]
    for depth in range(depth_limit):
        feature = _hash_int(seed, tree, node, depth, 1) % feature_count
        threshold = (lower[feature] + upper[feature]) / 2
        if row[feature] < threshold:
            upper[feature] = threshold
            node = 2 * node + 1
        else:
            lower[feature] = threshold
            node = 2 * node + 2
        path.append(node)
    return tuple(path)


def _half_space_scores(
    train: NDArray[np.float64], test: NDArray[np.float64], *, spec: OodBenchmarkSpecV1
) -> NDArray[np.float64]:
    scaled_train, scaled_test = _half_space_scaled(train, test)
    sample_count, feature_count = scaled_train.shape
    paper_scores = np.zeros(test.shape[0], dtype=np.float64)
    for tree in range(spec.half_space_trees):
        workspace = _half_space_workspace(feature_count=feature_count, seed=spec.seed, tree=tree)
        reference_mass: dict[int, int] = {}
        for row in scaled_train:
            for node in _half_space_path(
                row,
                seed=spec.seed,
                tree=tree,
                depth_limit=spec.half_space_depth,
                workspace=workspace,
            ):
                reference_mass[node] = reference_mass.get(node, 0) + 1

        for index, row in enumerate(scaled_test):
            path = _half_space_path(
                row,
                seed=spec.seed,
                tree=tree,
                depth_limit=spec.half_space_depth,
                workspace=workspace,
            )
            for depth, node in enumerate(path):
                mass = reference_mass.get(node, 0)
                terminal = depth == spec.half_space_depth or mass * 10 <= sample_count
                if terminal:
                    paper_scores[index] += mass * (1 << depth)
                    break

    maximum = spec.half_space_trees * sample_count * (1 << spec.half_space_depth)
    return cast(NDArray[np.float64], 1 - paper_scores / maximum)


def _autoencoder_scores(
    train: NDArray[np.float64],
    test: NDArray[np.float64],
    *,
    spec: OodBenchmarkSpecV1,
) -> NDArray[np.float64]:
    if train.shape[1] < 2:
        raise ContractValueError("autoencoder requires at least two features")
    scaler = StandardScaler().fit(train)
    scaled_train = cast(NDArray[np.float64], scaler.transform(train))
    scaled_test = cast(NDArray[np.float64], scaler.transform(test))
    hidden_units = min(spec.autoencoder_hidden_units, train.shape[1] - 1)
    model = MLPRegressor(
        loss="squared_error",
        hidden_layer_sizes=(hidden_units,),
        activation="tanh",
        solver="lbfgs",
        alpha=0.0001,
        max_iter=spec.autoencoder_max_iterations,
        shuffle=False,
        random_state=spec.seed,
        tol=1e-8,
        early_stopping=False,
        warm_start=False,
        max_fun=spec.autoencoder_max_function_calls,
    ).fit(scaled_train, scaled_train)
    reconstruction = cast(NDArray[np.float64], model.predict(scaled_test))
    if reconstruction.shape != scaled_test.shape:
        raise ContractValueError("autoencoder produced malformed reconstruction")
    return cast(NDArray[np.float64], np.mean((scaled_test - reconstruction) ** 2, axis=1))


def _robust_pca_scores(
    train: NDArray[np.float64],
    test: NDArray[np.float64],
    *,
    spec: OodBenchmarkSpecV1,
) -> NDArray[np.float64]:
    """Reconstruction error from the leading eigenvectors of robust MCD scatter."""

    if train.shape[1] < 2:
        raise ContractValueError("robust PCA requires at least two features")
    estimator = MinCovDet(random_state=spec.seed).fit(train)
    location = np.asarray(estimator.location_, dtype=np.float64)
    covariance = np.asarray(estimator.covariance_, dtype=np.float64)
    if location.shape != (train.shape[1],) or covariance.shape != (
        train.shape[1],
        train.shape[1],
    ):
        raise ContractValueError("robust PCA produced malformed location or scatter")
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    if not np.isfinite(eigenvalues).all() or not np.isfinite(eigenvectors).all():
        raise ContractValueError("robust PCA produced non-finite eigensystem")
    component_count = min(train.shape[1] - 1, train.shape[0] - 1)
    order = np.argsort(eigenvalues, kind="stable")
    basis = eigenvectors[:, order[-component_count:]]
    centered = test - location
    reconstruction = (centered @ basis) @ basis.T
    return cast(NDArray[np.float64], np.mean((centered - reconstruction) ** 2, axis=1))


def _require_robust_scatter_support(train: NDArray[np.float64]) -> None:
    if train.shape[0] <= train.shape[1] + 1:
        raise ContractValueError("robust scatter requires more rows than features plus one")
    centered = train - np.mean(train, axis=0)
    if int(np.linalg.matrix_rank(centered)) < train.shape[1]:
        raise ContractValueError("robust scatter requires full-rank training evidence")


def _estimator_scores(
    method: OodMethod,
    train: NDArray[np.float64],
    test: NDArray[np.float64],
    *,
    spec: OodBenchmarkSpecV1,
) -> NDArray[np.float64]:
    contamination = spec.contamination.numerator / spec.contamination.denominator
    if method is OodMethod.ISOLATION_FOREST:
        model = IsolationForest(
            n_estimators=spec.isolation_estimators,
            contamination=contamination,
            max_samples=min(256, train.shape[0]),
            random_state=spec.seed,
            n_jobs=1,
        ).fit(train)
        return -cast(NDArray[np.float64], model.score_samples(test))
    if method is OodMethod.ECOD:
        return _ecod_scores(train, test)
    if method is OodMethod.COPOD:
        return _copod_scores(train, test)
    if method is OodMethod.HALF_SPACE_TREES:
        return _half_space_scores(train, test, spec=spec)
    if method is OodMethod.ROBUST_COVARIANCE:
        _require_robust_scatter_support(train)
        model = EllipticEnvelope(
            contamination=contamination,
            random_state=spec.seed,
        ).fit(train)
        return -cast(NDArray[np.float64], model.decision_function(test))
    if method is OodMethod.ROBUST_PCA:
        _require_robust_scatter_support(train)
        return _robust_pca_scores(train, test, spec=spec)
    if method is OodMethod.ONE_CLASS_SVM:
        model = OneClassSVM(nu=contamination, gamma="scale").fit(train)
        return -cast(NDArray[np.float64], model.decision_function(test))
    if method is OodMethod.AUTOENCODER:
        return _autoencoder_scores(train, test, spec=spec)
    raise AssertionError("all OOD methods must have an estimator dispatch")


def _quantized(values: NDArray[np.float64], *, method: OodMethod) -> tuple[FixedPointV1, ...]:
    return tuple(
        quantize_binary64(float(value), field=f"{method.value.lower()} score") for value in values
    )


def _digest(method: OodMethod, scores: tuple[FixedPointV1, ...]) -> DigestV1:
    versions = {
        OodMethod.ISOLATION_FOREST: "SKLEARN_1_9_ISOLATION_FOREST_V1",
        OodMethod.ECOD: "PYOD_3_6_1_ECOD_TRAIN_ONLY_RANK_P_V1",
        OodMethod.COPOD: "PYOD_3_6_1_COPOD_TRAIN_ONLY_RANK_P_V1",
        OodMethod.HALF_SPACE_TREES: "IJCAI_2011_STATIC_REFERENCE_WINDOW_V1",
        OodMethod.ROBUST_COVARIANCE: "SKLEARN_1_9_MCD_ELLIPTIC_ENVELOPE_V1",
        OodMethod.ROBUST_PCA: "SKLEARN_1_9_MCD_SCATTER_PCA_V1",
        OodMethod.ONE_CLASS_SVM: "SKLEARN_1_9_ONE_CLASS_SVM_V1",
        OodMethod.AUTOENCODER: "SKLEARN_1_9_MLP_RECONSTRUCTION_V1",
    }
    payload = {
        "algorithmVersion": versions[method],
        "method": method.value,
        "scoreMantissas": [str(score.mantissa) for score in scores],
        "semantics": "UNCALIBRATED_RESEARCH_SCORE",
    }
    return DigestV1(hashlib.sha256(canonical_json_bytes(payload)).hexdigest())


def _recall(
    scores: tuple[FixedPointV1, ...], labels: tuple[bool, ...] | None, contamination: ExactRatioV1
) -> ExactRatioV1 | None:
    if labels is None:
        return None
    positives = sum(labels)
    if positives == 0:
        return None
    top_k = max(1, len(scores) * contamination.numerator // contamination.denominator)
    selected = sorted(range(len(scores)), key=lambda index: (-scores[index].mantissa, index))[
        :top_k
    ]
    return make_ratio(sum(labels[index] for index in selected), positives)


def benchmark_ood_challengers(
    training: tuple[tuple[FixedPointV1, ...], ...],
    assessment: tuple[tuple[FixedPointV1, ...], ...],
    *,
    labels: tuple[bool, ...] | None,
    spec: OodBenchmarkSpecV1,
) -> tuple[OodChallengerResultV1, ...]:
    if not isinstance(spec, OodBenchmarkSpecV1):
        raise ContractValueError("spec must be OodBenchmarkSpecV1")
    train = _matrix(training, spec=spec, field="training")
    test = _matrix(assessment, spec=spec, field="assessment")
    if train.shape[1] != test.shape[1]:
        raise ContractValueError("training and assessment feature widths must match")
    if labels is not None:
        if not isinstance(labels, tuple) or len(labels) != test.shape[0]:
            raise ContractValueError("labels must align with assessment rows")
        if any(not isinstance(label, bool) for label in labels):
            raise ContractValueError("labels must be booleans")
    results: list[OodChallengerResultV1] = []
    for method in OodMethod:
        if train.shape[0] < MIN_OOD_TRAINING_SAMPLES:
            results.append(
                OodChallengerResultV1(
                    method,
                    OodStatus.DATA_INSUFFICIENT,
                    (),
                    None,
                    None,
                    f"DATA_INSUFFICIENT:MIN_TRAINING_SUPPORT_{MIN_OOD_TRAINING_SAMPLES}",
                )
            )
            continue
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error")
                raw = _estimator_scores(method, train, test, spec=spec)
            if raw.shape != (test.shape[0],) or not np.isfinite(raw).all():
                raise ContractValueError("challenger produced malformed or non-finite scores")
            scores = _quantized(raw, method=method)
            results.append(
                OodChallengerResultV1(
                    method,
                    OodStatus.EVALUATED_RESEARCH_ONLY,
                    scores,
                    _digest(method, scores),
                    _recall(scores, labels, spec.contamination),
                    None,
                )
            )
        except (ArithmeticError, ContractValueError, ValueError, Warning) as error:
            results.append(
                OodChallengerResultV1(
                    method,
                    OodStatus.DATA_INSUFFICIENT,
                    (),
                    None,
                    None,
                    f"DATA_INSUFFICIENT:{type(error).__name__}",
                )
            )
    return tuple(results)
