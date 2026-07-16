"""Battery estimator registry: transparent baselines, controls, boosted challengers.

Each estimator is a typed spec plus a deterministic raw-output function. Pure
transparent families (prevalence, train mean, empirical train quantiles,
single-feature rankers, the seeded random-rank control) are computed here with
exact integer arithmetic and converted to binary64 once for the shared
quantization path; learned families delegate to the single-threaded engine.
Raw outputs are binary64 and must be quantized by the caller before entering
any public contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import require_contract_id
from quant_edge.models import engine
from quant_edge.models.contracts import ModelRole, TargetKind
from quant_edge.models.split import InternalChronologicalSplitV1
from quant_edge.models.synthetic import (
    QUANTILE_LEVELS,
    FeatureRole,
    SyntheticDatasetV1,
    SyntheticTargetV1,
)
from quant_edge.randomness import DeterministicRandom

SCORE_OUTPUT = "score"
_RANDOM_SCORE_BITS = 53


class EstimatorFamily(StrEnum):
    LOGISTIC = "LOGISTIC"
    ELASTIC_LOGISTIC = "ELASTIC_LOGISTIC"
    PREVALENCE = "PREVALENCE"
    RANDOM_RANK = "RANDOM_RANK"
    OLS = "OLS"
    TRAIN_MEAN = "TRAIN_MEAN"
    QUANTILE_LINEAR = "QUANTILE_LINEAR"
    TRAIN_QUANTILE = "TRAIN_QUANTILE"
    FEATURE_RANKER = "FEATURE_RANKER"
    XGB_CLASSIFIER = "XGB_CLASSIFIER"
    XGB_REGRESSOR = "XGB_REGRESSOR"
    XGB_QUANTILE = "XGB_QUANTILE"
    XGB_RANKER = "XGB_RANKER"


_BOOSTED_FAMILIES = frozenset(
    {
        EstimatorFamily.XGB_CLASSIFIER,
        EstimatorFamily.XGB_REGRESSOR,
        EstimatorFamily.XGB_QUANTILE,
        EstimatorFamily.XGB_RANKER,
    }
)

_FAMILY_KINDS: dict[EstimatorFamily, frozenset[TargetKind]] = {
    EstimatorFamily.LOGISTIC: frozenset({TargetKind.BINARY}),
    EstimatorFamily.ELASTIC_LOGISTIC: frozenset({TargetKind.BINARY}),
    EstimatorFamily.PREVALENCE: frozenset({TargetKind.BINARY}),
    EstimatorFamily.RANDOM_RANK: frozenset({TargetKind.BINARY, TargetKind.RANK}),
    EstimatorFamily.OLS: frozenset({TargetKind.REGRESSION}),
    EstimatorFamily.TRAIN_MEAN: frozenset({TargetKind.REGRESSION}),
    EstimatorFamily.QUANTILE_LINEAR: frozenset({TargetKind.QUANTILE}),
    EstimatorFamily.TRAIN_QUANTILE: frozenset({TargetKind.QUANTILE}),
    EstimatorFamily.FEATURE_RANKER: frozenset({TargetKind.RANK}),
    EstimatorFamily.XGB_CLASSIFIER: frozenset({TargetKind.BINARY}),
    EstimatorFamily.XGB_REGRESSOR: frozenset({TargetKind.REGRESSION}),
    EstimatorFamily.XGB_QUANTILE: frozenset({TargetKind.QUANTILE}),
    EstimatorFamily.XGB_RANKER: frozenset({TargetKind.RANK}),
}


@dataclass(frozen=True, slots=True)
class EstimatorSpecV1:
    model_id: str
    family: EstimatorFamily
    role: ModelRole
    target_kind: TargetKind
    params: tuple[tuple[str, int | str], ...]

    def __post_init__(self) -> None:
        require_contract_id(self.model_id, field="model_id")
        if not isinstance(self.family, EstimatorFamily):
            raise ContractValueError("family must be EstimatorFamily")
        if not isinstance(self.role, ModelRole):
            raise ContractValueError("role must be ModelRole")
        if not isinstance(self.target_kind, TargetKind):
            raise ContractValueError("target_kind must be TargetKind")
        if self.target_kind not in _FAMILY_KINDS[self.family]:
            raise ContractValueError(f"{self.family.value} does not support {self.target_kind}")
        if (self.family in _BOOSTED_FAMILIES) != (self.role is ModelRole.BOOSTED_CHALLENGER):
            raise ContractValueError("boosted families and only they are challengers")
        if not isinstance(self.params, tuple):
            raise ContractValueError("params must be a tuple of name/value pairs")
        names = [name for name, _ in self.params]
        if names != sorted(names) or len(set(names)) != len(names):
            raise ContractValueError("params must be sorted by unique name")

    def param(self, name: str) -> int | str:
        for key, value in self.params:
            if key == name:
                return value
        raise ContractValueError(f"{self.model_id} does not declare param {name}")

    def int_param(self, name: str) -> int:
        value = self.param(name)
        if isinstance(value, bool) or not isinstance(value, int):
            raise ContractValueError(f"param {name} must be an integer")
        return value

    def str_param(self, name: str) -> str:
        value = self.param(name)
        if not isinstance(value, str):
            raise ContractValueError(f"param {name} must be a string")
        return value


def boost_params_from_spec(spec: EstimatorSpecV1) -> engine.BoostParams:
    return engine.BoostParams(
        max_depth=spec.int_param("max_depth"),
        n_estimators=spec.int_param("n_estimators"),
        learning_rate=spec.str_param("learning_rate"),
        min_child_weight=spec.int_param("min_child_weight"),
    )


def monotone_vector(dataset: SyntheticDatasetV1, constrained: dict[str, int]) -> tuple[int, ...]:
    """Constraint vector; only declared planted directions are defensible."""

    vector = [0] * len(dataset.features)
    for feature_id, direction in constrained.items():
        index = dataset.feature_index(feature_id)
        spec = dataset.features[index]
        if direction not in (-1, 1):
            raise ContractValueError("monotone constraints must be -1 or +1")
        if spec.monotone_direction != direction:
            raise ContractValueError(
                f"constraint on {feature_id} contradicts its declared planted direction"
            )
        vector[index] = direction
    return tuple(vector)


def random_scores(seed: int, target_index: int, count: int) -> tuple[float, ...]:
    """Seeded control scores in [0, 1); exactly representable 53-bit fractions."""

    if count < 1:
        raise ContractValueError("count must be positive")
    rng = DeterministicRandom.from_seed(8 * seed + 2 * target_index + 1)
    return tuple(
        (rng.next_u64() >> (64 - _RANDOM_SCORE_BITS)) / (1 << _RANDOM_SCORE_BITS)
        for _ in range(count)
    )


def _train_labels(
    target: SyntheticTargetV1, split: InternalChronologicalSplitV1
) -> tuple[int, ...]:
    return tuple(target.labels[index] for index in split.train_indices)


def _prevalence_scores(train_labels: tuple[int, ...], count: int) -> tuple[float, ...]:
    positives = sum(train_labels)
    return (positives / len(train_labels),) * count


def _train_mean_values(train_labels: tuple[int, ...], count: int) -> tuple[float, ...]:
    return (sum(train_labels) / len(train_labels),) * count


def exact_train_quantile(train_labels: tuple[int, ...], *, level: str) -> int:
    """Type-1 (lower) empirical quantile of the train labels, exact."""

    if level not in QUANTILE_LEVELS:
        raise ContractValueError(f"unknown quantile level {level}")
    numerator, denominator = {
        "0.25": (1, 4),
        "0.5": (1, 2),
        "0.75": (3, 4),
    }[level]
    ordered = sorted(train_labels)
    count = len(ordered)
    index = (numerator * count + denominator - 1) // denominator - 1
    return ordered[max(index, 0)]


def _feature_scores(
    dataset: SyntheticDatasetV1, feature_id: str, indices: range
) -> tuple[float, ...]:
    column = dataset.feature_index(feature_id)
    role = dataset.features[column].role
    if role not in (FeatureRole.LIQUIDITY_PROXY, FeatureRole.ACTIVITY_PROXY):
        raise ContractValueError("single-feature rankers are proxy-feature stand-ins only")
    return tuple(float(dataset.rows[index][column]) for index in indices)


def raw_outputs(
    spec: EstimatorSpecV1,
    dataset: SyntheticDatasetV1,
    target: SyntheticTargetV1,
    split: InternalChronologicalSplitV1,
    evaluate: range,
    *,
    battery_seed: int,
    monotone: tuple[int, ...] | None,
) -> dict[str, tuple[float, ...]]:
    """Fit on the train slice only and score the requested evaluation slice."""

    if target.kind is not spec.target_kind:
        raise ContractValueError(f"{spec.model_id} cannot score a {target.kind.value} target")
    split.require_exact_cover(len(dataset.rows))
    if monotone is not None and spec.family not in _BOOSTED_FAMILIES:
        raise ContractValueError("monotone constraints apply to boosted challengers only")
    rows = dataset.rows
    labels = target.labels
    train = split.train_indices
    count = len(evaluate)
    family = spec.family
    if family is EstimatorFamily.LOGISTIC:
        scores = engine.logistic_scores(rows, labels, train, evaluate, elastic_net=False)
        return {SCORE_OUTPUT: scores}
    if family is EstimatorFamily.ELASTIC_LOGISTIC:
        scores = engine.logistic_scores(rows, labels, train, evaluate, elastic_net=True)
        return {SCORE_OUTPUT: scores}
    if family is EstimatorFamily.PREVALENCE:
        return {SCORE_OUTPUT: _prevalence_scores(_train_labels(target, split), count)}
    if family is EstimatorFamily.RANDOM_RANK:
        target_index = next(
            index
            for index, item in enumerate(dataset.targets)
            if item.target_id == target.target_id
        )
        return {SCORE_OUTPUT: random_scores(battery_seed, target_index, count)}
    if family is EstimatorFamily.OLS:
        return {SCORE_OUTPUT: engine.linear_regression_values(rows, labels, train, evaluate)}
    if family is EstimatorFamily.TRAIN_MEAN:
        return {SCORE_OUTPUT: _train_mean_values(_train_labels(target, split), count)}
    if family is EstimatorFamily.QUANTILE_LINEAR:
        vectors = engine.quantile_linear_values(
            rows,
            labels,
            train,
            evaluate,
            quantiles=tuple(float(level) for level in QUANTILE_LEVELS),
        )
        return {f"q{level}": vector for level, vector in zip(QUANTILE_LEVELS, vectors, strict=True)}
    if family is EstimatorFamily.TRAIN_QUANTILE:
        train_labels = _train_labels(target, split)
        return {
            f"q{level}": (float(exact_train_quantile(train_labels, level=level)),) * count
            for level in QUANTILE_LEVELS
        }
    if family is EstimatorFamily.FEATURE_RANKER:
        return {SCORE_OUTPUT: _feature_scores(dataset, spec.str_param("feature_id"), evaluate)}
    if family is EstimatorFamily.XGB_CLASSIFIER:
        scores = engine.xgb_classifier_scores(
            rows, labels, train, evaluate, params=boost_params_from_spec(spec), monotone=monotone
        )
        return {SCORE_OUTPUT: scores}
    if family is EstimatorFamily.XGB_REGRESSOR:
        values = engine.xgb_regressor_values(
            rows, labels, train, evaluate, params=boost_params_from_spec(spec), monotone=monotone
        )
        return {SCORE_OUTPUT: values}
    if family is EstimatorFamily.XGB_QUANTILE:
        vectors = engine.xgb_quantile_values(
            rows,
            labels,
            train,
            evaluate,
            params=boost_params_from_spec(spec),
            monotone=monotone,
            quantiles=tuple(float(level) for level in QUANTILE_LEVELS),
        )
        return {f"q{level}": vector for level, vector in zip(QUANTILE_LEVELS, vectors, strict=True)}
    scores = engine.xgb_ranker_scores(
        rows,
        labels,
        train,
        evaluate,
        params=boost_params_from_spec(spec),
        monotone=monotone,
        group_size=target.require_group_size(),
    )
    return {SCORE_OUTPUT: scores}
