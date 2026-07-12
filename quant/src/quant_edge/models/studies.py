"""Bounded, sequential, fully-logged Optuna studies.

The law: a study runs exactly its hard trial budget, sequentially, with a
seeded TPE sampler over finite exact parameter spaces (integers and decimal
strings only, so every parameter is JSON-safe and replayable). Every trial —
complete or failed — becomes a typed record carrying its exact quantized
objective; a study whose logged-trial count differs from its budget fails
closed. The optimizer never promotes anything; it only produces records.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import cast

import optuna

from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.models.contracts import MetricDirection, MetricValueV1

MAX_STUDY_TRIALS = 64

_OBJECTIVE_MANTISSA_ATTR = "objective_mantissa"
_FAILURE_REASON_ATTR = "failure_reason"


class ParamKind(StrEnum):
    INT_RANGE = "INT_RANGE"
    CATEGORICAL = "CATEGORICAL"


@dataclass(frozen=True, slots=True)
class ParamSpecV1:
    name: str
    kind: ParamKind
    low: int | None = None
    high: int | None = None
    choices: tuple[int | str, ...] | None = None

    def __post_init__(self) -> None:
        require_contract_id(self.name, field="param name")
        if not isinstance(self.kind, ParamKind):
            raise ContractValueError("kind must be ParamKind")
        if self.kind is ParamKind.INT_RANGE:
            if self.low is None or self.high is None or self.choices is not None:
                raise ContractValueError("INT_RANGE needs low/high and no choices")
            require_strict_int(self.low, field="low")
            require_strict_int(self.high, field="high")
            if self.low >= self.high:
                raise ContractValueError("low must be strictly below high")
        else:
            if self.choices is None or self.low is not None or self.high is not None:
                raise ContractValueError("CATEGORICAL needs choices and no bounds")
            if not isinstance(self.choices, tuple) or len(self.choices) < 2:
                raise ContractValueError("choices must hold at least two values")
            for choice in self.choices:
                if isinstance(choice, bool) or not isinstance(choice, (int, str)):
                    raise ContractValueError("choices must be exact integers or strings")
            if len(set(self.choices)) != len(self.choices):
                raise ContractValueError("choices must be unique")

    def int_bounds(self) -> tuple[int, int]:
        if self.kind is not ParamKind.INT_RANGE or self.low is None or self.high is None:
            raise ContractValueError(f"param {self.name} is not an integer range")
        return self.low, self.high

    def categorical_choices(self) -> tuple[int | str, ...]:
        if self.kind is not ParamKind.CATEGORICAL or self.choices is None:
            raise ContractValueError(f"param {self.name} is not categorical")
        return self.choices

    def as_mapping(self) -> dict[str, object]:
        return {
            "choices": None if self.choices is None else list(self.choices),
            "high": self.high,
            "kind": self.kind.value,
            "low": self.low,
            "name": self.name,
        }


class TrialState(StrEnum):
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


@dataclass(frozen=True, slots=True)
class TrialRecordV1:
    trial_index: int
    params: tuple[tuple[str, int | str], ...]
    state: TrialState
    objective: FixedPointV1 | None
    failure_reason: str | None

    def __post_init__(self) -> None:
        require_strict_int(
            self.trial_index, field="trial_index", minimum=0, maximum=MAX_STUDY_TRIALS - 1
        )
        if not isinstance(self.params, tuple):
            raise ContractValueError("params must be a tuple of name/value pairs")
        names = [name for name, _ in self.params]
        if names != sorted(names) or len(set(names)) != len(names):
            raise ContractValueError("trial params must be sorted by unique name")
        for name, value in self.params:
            require_contract_id(name, field="trial param name")
            if isinstance(value, bool) or not isinstance(value, (int, str)):
                raise ContractValueError(f"trial param {name} must be an integer or string")
        if not isinstance(self.state, TrialState):
            raise ContractValueError("state must be TrialState")
        if self.state is TrialState.COMPLETE:
            if not isinstance(self.objective, FixedPointV1) or self.failure_reason is not None:
                raise ContractValueError("complete trials carry an objective and no reason")
        else:
            if self.objective is not None:
                raise ContractValueError("failed trials must not carry an objective")
            if not isinstance(self.failure_reason, str) or not self.failure_reason.strip():
                raise ContractValueError("failed trials must carry a failure reason")

    def as_mapping(self) -> dict[str, object]:
        return {
            "failureReason": self.failure_reason,
            "objective": None if self.objective is None else self.objective.as_mapping(),
            "params": dict(self.params),
            "state": self.state.value,
            "trialIndex": self.trial_index,
        }


@dataclass(frozen=True, slots=True)
class StudySpecV1:
    study_id: str
    objective_metric: str
    direction: MetricDirection
    n_trials: int
    sampler_seed: int

    def __post_init__(self) -> None:
        require_contract_id(self.study_id, field="study_id")
        require_contract_id(self.objective_metric, field="objective_metric")
        if not isinstance(self.direction, MetricDirection):
            raise ContractValueError("direction must be MetricDirection")
        require_strict_int(self.n_trials, field="n_trials", minimum=1, maximum=MAX_STUDY_TRIALS)
        require_strict_int(self.sampler_seed, field="sampler_seed", minimum=0, maximum=2**32 - 1)

    def as_mapping(self) -> dict[str, object]:
        return {
            "direction": self.direction.value,
            "nTrials": self.n_trials,
            "objectiveMetric": self.objective_metric,
            "samplerSeed": self.sampler_seed,
            "studyId": self.study_id,
        }


@dataclass(frozen=True, slots=True)
class StudyRecordV1:
    """All-trials-logged study outcome; missing trials fail closed here."""

    spec: StudySpecV1
    param_space: tuple[ParamSpecV1, ...]
    trials: tuple[TrialRecordV1, ...]
    best_trial_index: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.spec, StudySpecV1):
            raise ContractValueError("spec must be StudySpecV1")
        if not isinstance(self.param_space, tuple) or not self.param_space:
            raise ContractValueError("param_space must be a non-empty tuple")
        space_names = [param.name for param in self.param_space]
        if space_names != sorted(space_names) or len(set(space_names)) != len(space_names):
            raise ContractValueError("param space must be sorted by unique name")
        if not isinstance(self.trials, tuple) or len(self.trials) != self.spec.n_trials:
            raise ContractValueError("every budgeted trial must be logged, in order")
        for expected_index, trial in enumerate(self.trials):
            if trial.trial_index != expected_index:
                raise ContractValueError("trial indices must be exactly 0..n_trials-1")
        if self.best_trial_index != self._computed_best_index():
            raise ContractValueError("best_trial_index must follow the objective law")

    def _computed_best_index(self) -> int | None:
        best: tuple[int, int] | None = None
        for trial in self.trials:
            if trial.state is not TrialState.COMPLETE or trial.objective is None:
                continue
            mantissa = trial.objective.mantissa
            ordered = (
                -mantissa if self.spec.direction is MetricDirection.HIGHER_IS_BETTER else mantissa
            )
            candidate = (ordered, trial.trial_index)
            if best is None or candidate < best:
                best = candidate
        return None if best is None else best[1]

    def complete_trials(self) -> tuple[TrialRecordV1, ...]:
        return tuple(trial for trial in self.trials if trial.state is TrialState.COMPLETE)

    def best_params(self) -> tuple[tuple[str, int | str], ...]:
        if self.best_trial_index is None:
            raise ContractValueError("study has no complete trial to take parameters from")
        return self.trials[self.best_trial_index].params

    def as_mapping(self) -> dict[str, object]:
        return {
            "bestTrialIndex": self.best_trial_index,
            "paramSpace": [param.as_mapping() for param in self.param_space],
            "spec": self.spec.as_mapping(),
            "trials": [trial.as_mapping() for trial in self.trials],
        }


Objective = Callable[[dict[str, int | str]], MetricValueV1]


def _suggest(trial: optuna.trial.Trial, space: tuple[ParamSpecV1, ...]) -> dict[str, int | str]:
    params: dict[str, int | str] = {}
    for spec in space:
        if spec.kind is ParamKind.INT_RANGE:
            low, high = spec.int_bounds()
            params[spec.name] = trial.suggest_int(spec.name, low, high)
        else:
            suggested = trial.suggest_categorical(spec.name, list(spec.categorical_choices()))
            # the choices law admits exactly int/str, so the suggestion is one of them
            params[spec.name] = cast("int | str", suggested)
    return params


def run_bounded_study(
    spec: StudySpecV1,
    param_space: tuple[ParamSpecV1, ...],
    objective: Objective,
) -> StudyRecordV1:
    """Run one sequential seeded study and log every trial, or fail closed."""

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    sampler = optuna.samplers.TPESampler(seed=spec.sampler_seed)
    direction = "maximize" if spec.direction is MetricDirection.HIGHER_IS_BETTER else "minimize"
    study = optuna.create_study(sampler=sampler, direction=direction)

    def _objective(trial: optuna.trial.Trial) -> float:
        params = _suggest(trial, param_space)
        try:
            metric = objective(params)
            if metric.name != spec.objective_metric or metric.direction is not spec.direction:
                raise ContractValueError("objective metric must match the study spec")
        except QuantEdgeError as error:
            trial.set_user_attr(_FAILURE_REASON_ATTR, f"{type(error).__name__}: {error}")
            raise
        trial.set_user_attr(_OBJECTIVE_MANTISSA_ATTR, str(metric.value.mantissa))
        return metric.value.mantissa / FIXED_POINT_SCALE

    study.optimize(_objective, n_trials=spec.n_trials, catch=(QuantEdgeError,))

    records = [_trial_record(trial) for trial in study.get_trials(deepcopy=False)]
    return StudyRecordV1(
        spec=spec,
        param_space=param_space,
        trials=tuple(records),
        best_trial_index=_best_index_of(records, spec.direction),
    )


def _trial_record(trial: optuna.trial.FrozenTrial) -> TrialRecordV1:
    """Map one finished optuna trial onto the typed logging contract."""

    params = tuple(
        sorted((name, _require_logged_param(value)) for name, value in trial.params.items())
    )
    if trial.state is optuna.trial.TrialState.COMPLETE:
        mantissa_text = trial.user_attrs.get(_OBJECTIVE_MANTISSA_ATTR)
        if not isinstance(mantissa_text, str):
            raise ContractValueError("complete trial lost its exact objective record")
        return TrialRecordV1(
            trial_index=trial.number,
            params=params,
            state=TrialState.COMPLETE,
            objective=FixedPointV1(int(mantissa_text)),
            failure_reason=None,
        )
    reason = trial.user_attrs.get(_FAILURE_REASON_ATTR)
    return TrialRecordV1(
        trial_index=trial.number,
        params=params,
        state=TrialState.FAILED,
        objective=None,
        failure_reason=reason if isinstance(reason, str) else "unrecorded failure",
    )


def _require_logged_param(value: object) -> int | str:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ContractValueError("logged trial parameters must be integers or strings")
    return value


def _best_index_of(records: list[TrialRecordV1], direction: MetricDirection) -> int | None:
    best: tuple[int, int] | None = None
    for record in records:
        if record.state is not TrialState.COMPLETE or record.objective is None:
            continue
        mantissa = record.objective.mantissa
        ordered = -mantissa if direction is MetricDirection.HIGHER_IS_BETTER else mantissa
        candidate = (ordered, record.trial_index)
        if best is None or candidate < best:
            best = candidate
    return None if best is None else best[1]
