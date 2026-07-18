"""Bounded deterministic anomaly/OOD challenger benchmark.

Locked scikit-learn estimators cover Isolation Forest, robust covariance/PCA and
one-class SVM. Robust PCA diagonalizes a deterministic Minimum Covariance Determinant
scatter estimate rather than contamination-sensitive empirical PCA. ECOD/COPOD and a
bounded half-space partition challenger are implemented locally to avoid adding an
unsealed dependency. Autoencoder evaluation stays
``BLOCKED_DATA`` because neither a locked neural dependency nor data-sufficient Q13
evidence exists. Scores are uncalibrated research outputs quantized once at Q10's
binary64 boundary.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

import numpy as np
from numpy.typing import NDArray
from sklearn.covariance import EllipticEnvelope, MinCovDet
from sklearn.ensemble import IsolationForest
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
AUTOENCODER_BLOCKER: Final = (
    "BLOCKED_DATA: no locked autoencoder implementation and Q13 real-evidence sufficiency is false"
)


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


def _tail_scores(
    train: NDArray[np.float64], test: NDArray[np.float64], *, copula: bool
) -> NDArray[np.float64]:
    output: list[float] = []
    denominator = train.shape[0] + 2
    for row in test:
        left_score = 0.0
        right_score = 0.0
        two_sided = 0.0
        for column, value in enumerate(row):
            training = train[:, column]
            left = (int(np.count_nonzero(training <= value)) + 1) / denominator
            right = (int(np.count_nonzero(training >= value)) + 1) / denominator
            left_score += -math.log(left)
            right_score += -math.log(right)
            two_sided += -math.log(min(left, right))
        output.append(max(left_score, right_score) if copula else two_sided)
    return np.asarray(output, dtype=np.float64)


def _hash_int(*parts: int) -> int:
    payload = ":".join(str(part) for part in parts).encode("ascii")
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big")


def _half_space_scores(
    train: NDArray[np.float64], test: NDArray[np.float64], *, spec: OodBenchmarkSpecV1
) -> NDArray[np.float64]:
    feature_count = train.shape[1]
    output = [0.0] * test.shape[0]
    for tree in range(spec.half_space_trees):
        paths: list[tuple[int, ...]] = []
        choices: list[tuple[int, float]] = []
        for depth in range(spec.half_space_depth):
            hashed = _hash_int(spec.seed, tree, depth)
            feature = hashed % feature_count
            quantile_index = 1 + (hashed >> 16) % 7
            threshold = float(np.quantile(train[:, feature], quantile_index / 8, method="linear"))
            choices.append((feature, threshold))
        for row in train:
            paths.append(tuple(int(row[feature] > threshold) for feature, threshold in choices))
        occupancies: dict[tuple[int, ...], int] = {}
        for path in paths:
            occupancies[path] = occupancies.get(path, 0) + 1
        for index, row in enumerate(test):
            path = tuple(int(row[feature] > threshold) for feature, threshold in choices)
            output[index] += 1.0 / (1 + occupancies.get(path, 0))
    return np.asarray([value / spec.half_space_trees for value in output], dtype=np.float64)


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
        return _tail_scores(train, test, copula=False)
    if method is OodMethod.COPOD:
        return _tail_scores(train, test, copula=True)
    if method is OodMethod.HALF_SPACE_TREES:
        return _half_space_scores(train, test, spec=spec)
    if method is OodMethod.ROBUST_COVARIANCE:
        model = EllipticEnvelope(
            contamination=contamination,
            random_state=spec.seed,
        ).fit(train)
        return -cast(NDArray[np.float64], model.decision_function(test))
    if method is OodMethod.ROBUST_PCA:
        return _robust_pca_scores(train, test, spec=spec)
    if method is OodMethod.ONE_CLASS_SVM:
        model = OneClassSVM(nu=contamination, gamma="scale").fit(train)
        return -cast(NDArray[np.float64], model.decision_function(test))
    raise AssertionError("autoencoder is gated before estimator dispatch")


def _quantized(values: NDArray[np.float64], *, method: OodMethod) -> tuple[FixedPointV1, ...]:
    return tuple(
        quantize_binary64(float(value), field=f"{method.value.lower()} score") for value in values
    )


def _digest(method: OodMethod, scores: tuple[FixedPointV1, ...]) -> DigestV1:
    payload = {
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
        if method is OodMethod.AUTOENCODER:
            results.append(
                OodChallengerResultV1(
                    method,
                    OodStatus.BLOCKED_DATA,
                    (),
                    None,
                    None,
                    AUTOENCODER_BLOCKER,
                )
            )
            continue
        try:
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
        except (ArithmeticError, ContractValueError, ValueError) as error:
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
