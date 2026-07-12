from __future__ import annotations

from typing import Any

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.models.contracts import MetricDerivation, MetricDirection, MetricValueV1

studies = pytest.importorskip("quant_edge.models.studies", reason="Q10 models extra not installed")

ParamKind = studies.ParamKind
ParamSpecV1 = studies.ParamSpecV1
StudySpecV1 = studies.StudySpecV1
StudyRecordV1 = studies.StudyRecordV1
TrialRecordV1 = studies.TrialRecordV1
TrialState = studies.TrialState

INT_SPACE = (ParamSpecV1("x", ParamKind.INT_RANGE, low=0, high=6),)


def metric(name: str, mantissa: int, *, higher: bool = False) -> MetricValueV1:
    return MetricValueV1(
        name=name,
        value=FixedPointV1(mantissa),
        derivation=MetricDerivation.EXACT_RATIONAL,
        direction=(MetricDirection.HIGHER_IS_BETTER if higher else MetricDirection.LOWER_IS_BETTER),
    )


def study_spec(*, n_trials: int = 20, higher: bool = False, seed: int = 11) -> Any:
    return StudySpecV1(
        study_id="study_test:v1",
        objective_metric="objective",
        direction=(MetricDirection.HIGHER_IS_BETTER if higher else MetricDirection.LOWER_IS_BETTER),
        n_trials=n_trials,
        sampler_seed=seed,
    )


def test_param_spec_laws() -> None:
    with pytest.raises(ContractValueError, match="low/high and no choices"):
        ParamSpecV1("x", ParamKind.INT_RANGE, low=0, high=None)
    with pytest.raises(ContractValueError, match="low/high and no choices"):
        ParamSpecV1("x", ParamKind.INT_RANGE, low=0, high=5, choices=(1, 2))
    with pytest.raises(ContractValueError, match="strictly below"):
        ParamSpecV1("x", ParamKind.INT_RANGE, low=5, high=5)
    with pytest.raises(ContractValueError, match="choices and no bounds"):
        ParamSpecV1("x", ParamKind.CATEGORICAL, low=1, choices=("a", "b"))
    with pytest.raises(ContractValueError, match="choices and no bounds"):
        ParamSpecV1("x", ParamKind.CATEGORICAL)
    with pytest.raises(ContractValueError, match="at least two"):
        ParamSpecV1("x", ParamKind.CATEGORICAL, choices=("a",))
    with pytest.raises(ContractValueError, match="unique"):
        ParamSpecV1("x", ParamKind.CATEGORICAL, choices=("a", "a"))
    with pytest.raises(ContractValueError, match="exact integers or strings"):
        ParamSpecV1("x", ParamKind.CATEGORICAL, choices=(True, False))
    with pytest.raises(ContractValueError, match="ParamKind"):
        ParamSpecV1("x", "INT_RANGE", low=0, high=5)
    int_spec = INT_SPACE[0]
    assert int_spec.int_bounds() == (0, 6)
    with pytest.raises(ContractValueError, match="not categorical"):
        int_spec.categorical_choices()
    cat_spec = ParamSpecV1("y", ParamKind.CATEGORICAL, choices=("0.1", 5))
    assert cat_spec.categorical_choices() == ("0.1", 5)
    with pytest.raises(ContractValueError, match="not an integer range"):
        cat_spec.int_bounds()
    assert cat_spec.as_mapping()["choices"] == ["0.1", 5]
    assert int_spec.as_mapping()["low"] == 0


def test_trial_record_laws() -> None:
    complete = TrialRecordV1(0, (("x", 3),), TrialState.COMPLETE, FixedPointV1(1), None)
    assert complete.as_mapping()["state"] == "COMPLETE"
    failed = TrialRecordV1(1, (("x", 3),), TrialState.FAILED, None, "boom")
    assert failed.as_mapping()["failureReason"] == "boom"
    with pytest.raises(ContractValueError, match="objective and no reason"):
        TrialRecordV1(0, (), TrialState.COMPLETE, None, None)
    with pytest.raises(ContractValueError, match="objective and no reason"):
        TrialRecordV1(0, (), TrialState.COMPLETE, FixedPointV1(1), "reason")
    with pytest.raises(ContractValueError, match="must not carry an objective"):
        TrialRecordV1(0, (), TrialState.FAILED, FixedPointV1(1), "reason")
    with pytest.raises(ContractValueError, match="failure reason"):
        TrialRecordV1(0, (), TrialState.FAILED, None, "  ")
    with pytest.raises(ContractValueError, match="sorted by unique name"):
        TrialRecordV1(0, (("b", 1), ("a", 2)), TrialState.FAILED, None, "boom")
    with pytest.raises(ContractValueError, match="integer or string"):
        TrialRecordV1(0, (("a", True),), TrialState.FAILED, None, "boom")
    with pytest.raises(ContractValueError, match="TrialState"):
        TrialRecordV1(0, (), "FAILED", None, "boom")
    with pytest.raises(ContractValueError, match="params must be a tuple"):
        TrialRecordV1(0, [], TrialState.FAILED, None, "boom")


def test_study_spec_laws() -> None:
    with pytest.raises(ContractValueError, match="n_trials"):
        study_spec(n_trials=0)
    with pytest.raises(ContractValueError, match="n_trials"):
        study_spec(n_trials=65)
    with pytest.raises(ContractValueError, match="sampler_seed"):
        study_spec(seed=-1)
    with pytest.raises(ContractValueError, match="MetricDirection"):
        StudySpecV1("s:v1", "objective", "LOWER", 4, 1)
    assert study_spec().as_mapping()["nTrials"] == 20


def _records(*states_and_values: tuple[str, int | None]) -> tuple[Any, ...]:
    records = []
    for index, (state, value) in enumerate(states_and_values):
        if state == "COMPLETE":
            records.append(
                TrialRecordV1(
                    index, (("x", index),), TrialState.COMPLETE, FixedPointV1(value or 0), None
                )
            )
        else:
            records.append(TrialRecordV1(index, (("x", index),), TrialState.FAILED, None, "boom"))
    return tuple(records)


def test_study_record_fail_closed_laws() -> None:
    spec = study_spec(n_trials=3)
    trials = _records(("COMPLETE", 5), ("FAILED", None), ("COMPLETE", 2))
    record = StudyRecordV1(spec, INT_SPACE, trials, 2)
    assert record.best_params() == (("x", 2),)
    assert len(record.complete_trials()) == 2
    assert record.as_mapping()["bestTrialIndex"] == 2
    with pytest.raises(ContractValueError, match="every budgeted trial"):
        StudyRecordV1(spec, INT_SPACE, trials[:2], 0)
    with pytest.raises(ContractValueError, match=r"exactly 0\.\.n_trials-1"):
        StudyRecordV1(spec, INT_SPACE, (trials[0], trials[2], trials[1]), 0)
    with pytest.raises(ContractValueError, match="objective law"):
        StudyRecordV1(spec, INT_SPACE, trials, 0)
    with pytest.raises(ContractValueError, match="param space must be sorted"):
        StudyRecordV1(
            spec,
            (
                ParamSpecV1("b", ParamKind.INT_RANGE, low=0, high=1),
                ParamSpecV1("a", ParamKind.INT_RANGE, low=0, high=1),
            ),
            trials,
            2,
        )
    with pytest.raises(ContractValueError, match="non-empty tuple"):
        StudyRecordV1(spec, (), trials, 2)
    with pytest.raises(ContractValueError, match="StudySpecV1"):
        StudyRecordV1("spec", INT_SPACE, trials, 2)


def test_study_record_best_index_directions() -> None:
    higher = study_spec(n_trials=3, higher=True)
    trials = _records(("COMPLETE", 5), ("COMPLETE", 9), ("COMPLETE", 9))
    for direction_trials in (trials,):
        record = StudyRecordV1(higher, INT_SPACE, direction_trials, 1)
        assert record.best_trial_index == 1  # earliest index wins the tie
    all_failed = _records(("FAILED", None), ("FAILED", None), ("FAILED", None))
    record = StudyRecordV1(study_spec(n_trials=3), INT_SPACE, all_failed, None)
    assert record.best_trial_index is None
    with pytest.raises(ContractValueError, match="no complete trial"):
        record.best_params()


def _parabola_objective(params: dict[str, int | str]) -> MetricValueV1:
    x = params["x"]
    assert isinstance(x, int)
    return metric("objective", (x - 3) ** 2 * FIXED_POINT_SCALE)


def test_bounded_study_finds_known_optimum_deterministically() -> None:
    first = studies.run_bounded_study(study_spec(), INT_SPACE, _parabola_objective)
    second = studies.run_bounded_study(study_spec(), INT_SPACE, _parabola_objective)
    assert first.as_mapping() == second.as_mapping()
    assert len(first.trials) == 20
    assert all(trial.state is TrialState.COMPLETE for trial in first.trials)
    assert first.best_params() == (("x", 3),)
    best_index = first.best_trial_index
    assert best_index is not None
    best = first.trials[best_index].objective
    assert best is not None
    assert best.mantissa == 0


def test_bounded_study_logs_injected_failures_and_keeps_budget() -> None:
    def flaky(params: dict[str, int | str]) -> MetricValueV1:
        x = params["x"]
        assert isinstance(x, int)
        if x % 2 == 1:
            raise ContractValueError("odd parameters are rejected by this objective")
        return metric("objective", (x - 3) ** 2 * FIXED_POINT_SCALE)

    record = studies.run_bounded_study(study_spec(), INT_SPACE, flaky)
    assert len(record.trials) == 20
    states = {trial.state for trial in record.trials}
    assert states == {TrialState.COMPLETE, TrialState.FAILED}
    for trial in record.trials:
        if trial.state is TrialState.FAILED:
            assert trial.failure_reason is not None
            assert "odd parameters" in trial.failure_reason
            assert trial.params  # suggested parameters are still logged
    assert record.best_trial_index is not None


def test_bounded_study_rejects_mismatched_objective_metric() -> None:
    def wrong_name(params: dict[str, int | str]) -> MetricValueV1:
        return metric("other", 0)

    record = studies.run_bounded_study(study_spec(n_trials=3), INT_SPACE, wrong_name)
    assert all(trial.state is TrialState.FAILED for trial in record.trials)
    assert all(
        trial.failure_reason is not None and "must match the study spec" in trial.failure_reason
        for trial in record.trials
    )
    assert record.best_trial_index is None


def test_bounded_study_propagates_foreign_exceptions() -> None:
    def broken(params: dict[str, int | str]) -> MetricValueV1:
        raise ValueError("not a lane error")

    with pytest.raises(ValueError, match="not a lane error"):
        studies.run_bounded_study(study_spec(n_trials=2), INT_SPACE, broken)


def test_trial_record_mapping_defends_the_logging_seam() -> None:
    optuna = pytest.importorskip("optuna")
    distributions = {"x": optuna.distributions.IntDistribution(0, 6)}
    complete = optuna.trial.create_trial(
        state=optuna.trial.TrialState.COMPLETE,
        params={"x": 1},
        distributions=distributions,
        value=1.0,
        user_attrs={"objective_mantissa": "5"},
    )
    complete.number = 0  # create_trial leaves the number unset (-1)
    record = studies._trial_record(complete)
    assert record.state is TrialState.COMPLETE
    assert record.objective is not None
    assert record.objective.mantissa == 5

    lost = optuna.trial.create_trial(
        state=optuna.trial.TrialState.COMPLETE,
        params={"x": 1},
        distributions=distributions,
        value=1.0,
        user_attrs={},
    )
    lost.number = 1
    with pytest.raises(ContractValueError, match="lost its exact objective record"):
        studies._trial_record(lost)

    unrecorded = optuna.trial.create_trial(
        state=optuna.trial.TrialState.FAIL,
        params={"x": 1},
        distributions=distributions,
        user_attrs={},
    )
    unrecorded.number = 2
    failed = studies._trial_record(unrecorded)
    assert failed.state is TrialState.FAILED
    assert failed.failure_reason == "unrecorded failure"

    with pytest.raises(ContractValueError, match="integers or strings"):
        studies._require_logged_param(True)


def test_categorical_suggestions_stay_exact() -> None:
    space = (
        ParamSpecV1("rate", ParamKind.CATEGORICAL, choices=("0.05", "0.1")),
        ParamSpecV1("size", ParamKind.CATEGORICAL, choices=(10, 20)),
    )

    def objective(params: dict[str, int | str]) -> MetricValueV1:
        assert isinstance(params["rate"], str)
        assert isinstance(params["size"], int)
        penalty = 0 if params["rate"] == "0.1" else 1
        size = params["size"]
        assert isinstance(size, int)
        return metric("objective", (penalty + size) * FIXED_POINT_SCALE)

    record = studies.run_bounded_study(study_spec(n_trials=8), space + INT_SPACE, objective)
    assert len(record.trials) == 8
    for trial in record.trials:
        mapping = dict(trial.params)
        assert isinstance(mapping["rate"], str)
        assert isinstance(mapping["size"], int)
