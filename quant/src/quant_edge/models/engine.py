"""Binary64 model engine — the only module that touches numpy/sklearn/xgboost.

Floats exist here and die at the ``quantize`` boundary in the calling layer.
Every fit is single-threaded by law (``threadpool_limits(1)`` plus explicit
``n_jobs=1`` / fixed seeds), fits see the training slice only, and isotonic
calibration fits on the validation slice only. No function here reads the
environment, the clock or the network; no model is persisted.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LinearRegression, LogisticRegression, QuantileRegressor
from threadpoolctl import threadpool_limits
from xgboost import XGBClassifier, XGBRanker, XGBRegressor

from quant_edge.errors import ContractValueError

_FloatArray = npt.NDArray[np.float64]

Rows = tuple[tuple[int, ...], ...]
Labels = tuple[int, ...]


@dataclass(frozen=True, slots=True)
class BoostParams:
    """Exact JSON-safe boosted-tree parameters; the engine converts once."""

    max_depth: int
    n_estimators: int
    learning_rate: str
    min_child_weight: int

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
    train_x, eval_x = _standardize(_matrix(rows, train), _matrix(rows, evaluate))
    train_y = _vector(labels, train)
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
        model.fit(train_x, train_y)
        scores = model.predict_proba(eval_x)[:, 1]
    return _as_floats(np.asarray(scores, dtype=np.float64))


def linear_regression_values(
    rows: Rows, labels: Labels, train: range, evaluate: range
) -> tuple[float, ...]:
    train_x, eval_x = _standardize(_matrix(rows, train), _matrix(rows, evaluate))
    with threadpool_limits(limits=1):
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
    train_x, eval_x = _standardize(_matrix(rows, train), _matrix(rows, evaluate))
    train_y = _vector(labels, train)
    outputs: list[tuple[float, ...]] = []
    with threadpool_limits(limits=1):
        for quantile in quantiles:
            model = QuantileRegressor(quantile=quantile, alpha=0.0, solver="highs")
            model.fit(train_x, train_y)
            outputs.append(_as_floats(np.asarray(model.predict(eval_x), dtype=np.float64)))
    return tuple(outputs)


def _boost_common(params: BoostParams, monotone: tuple[int, ...] | None) -> dict[str, Any]:
    common: dict[str, Any] = {
        "tree_method": "hist",
        "n_jobs": 1,
        "random_state": 7,
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


def xgb_classifier_scores(
    rows: Rows,
    labels: Labels,
    train: range,
    evaluate: range,
    *,
    params: BoostParams,
    monotone: tuple[int, ...] | None,
) -> tuple[float, ...]:
    model = XGBClassifier(objective="binary:logistic", **_boost_common(params, monotone))
    with threadpool_limits(limits=1):
        model.fit(_matrix(rows, train), _vector(labels, train))
        scores = model.predict_proba(_matrix(rows, evaluate))[:, 1]
    return _as_floats(np.asarray(scores, dtype=np.float64))


def xgb_regressor_values(
    rows: Rows,
    labels: Labels,
    train: range,
    evaluate: range,
    *,
    params: BoostParams,
    monotone: tuple[int, ...] | None,
) -> tuple[float, ...]:
    model = XGBRegressor(objective="reg:squarederror", **_boost_common(params, monotone))
    with threadpool_limits(limits=1):
        model.fit(_matrix(rows, train), _vector(labels, train))
        values = model.predict(_matrix(rows, evaluate))
    return _as_floats(np.asarray(values, dtype=np.float64))


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
    model = XGBRegressor(
        objective="reg:quantileerror",
        quantile_alpha=np.array(quantiles, dtype=np.float64),
        **_boost_common(params, monotone),
    )
    with threadpool_limits(limits=1):
        model.fit(_matrix(rows, train), _vector(labels, train))
        values = np.asarray(model.predict(_matrix(rows, evaluate)), dtype=np.float64)
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
    model = XGBRanker(objective="rank:pairwise", **_boost_common(params, monotone))
    train_qid = np.arange(len(train)) // group_size
    with threadpool_limits(limits=1):
        model.fit(_matrix(rows, train), _vector(labels, train), qid=train_qid)
        scores = model.predict(_matrix(rows, evaluate))
    return _as_floats(np.asarray(scores, dtype=np.float64))


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
