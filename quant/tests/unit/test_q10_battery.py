from __future__ import annotations

from importlib import metadata
from typing import Any

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.models.contracts import (
    BatteryDisposition,
    CalibrationMethod,
    MetricDerivation,
    MetricDirection,
    MetricValueV1,
    ModelResultV1,
    ModelRole,
    ProbabilitySemantics,
    TargetKind,
    disposition_table_digest,
    make_comparison_report,
    prediction_digest,
)
from quant_edge.models.synthetic import battery_split, build_battery_dataset

battery = pytest.importorskip("quant_edge.models.battery", reason="Q10 models extra not installed")
studies = pytest.importorskip("quant_edge.models.studies", reason="Q10 models extra not installed")

SEED = 20260712


def _fake_report(target_id: str) -> Any:
    def result(model_id: str, mantissa: int) -> ModelResultV1:
        return ModelResultV1(
            model_id=model_id,
            target_id=target_id,
            role=ModelRole.CONTROL,
            calibration=CalibrationMethod.NONE,
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=(),
            metrics=(
                MetricValueV1(
                    "primary",
                    FixedPointV1(mantissa),
                    MetricDerivation.EXACT_RATIONAL,
                    MetricDirection.LOWER_IS_BETTER,
                ),
            ),
            predictions=prediction_digest({"score": (FixedPointV1(mantissa),)}),
        )

    return make_comparison_report(
        target_id=target_id,
        target_kind=TargetKind.REGRESSION,
        primary_metric="primary",
        results=(result("model_a:v1", 1), result("model_b:v1", 2)),
    )


def _fake_study(study_id: str) -> Any:
    spec = studies.StudySpecV1(
        study_id=study_id,
        objective_metric="primary",
        direction=MetricDirection.LOWER_IS_BETTER,
        n_trials=1,
        sampler_seed=1,
    )
    trial = studies.TrialRecordV1(
        0, (("x", 1),), studies.TrialState.COMPLETE, FixedPointV1(0), None
    )
    space = (studies.ParamSpecV1("x", studies.ParamKind.INT_RANGE, low=0, high=1),)
    return studies.StudyRecordV1(spec, space, (trial,), 0)


def _fake_result(**overrides: object) -> Any:
    base: dict[str, object] = {
        "seed": SEED,
        "dataset": build_battery_dataset(SEED),
        "split": battery_split(),
        "reports": (_fake_report("a:v1"), _fake_report("b:v1")),
        "studies": (_fake_study("study_a:v1"), _fake_study("study_b:v1")),
        "dispositions": battery.SECTION_14_BATTERY_DISPOSITIONS,
        "frameworks": battery.framework_versions(),
    }
    base.update(overrides)
    return battery.BatteryResultV1(**base)


def test_battery_result_laws() -> None:
    result = _fake_result()
    assert result.report("a:v1").target_id == "a:v1"
    with pytest.raises(ContractValueError, match="unknown report"):
        result.report("missing:v1")
    with pytest.raises(ContractValueError, match="sorted by unique target_id"):
        _fake_result(reports=(_fake_report("b:v1"), _fake_report("a:v1")))
    with pytest.raises(ContractValueError, match="sorted by unique study_id"):
        _fake_result(studies=(_fake_study("study_b:v1"), _fake_study("study_a:v1")))
    mapping = result.as_mapping()
    assert mapping["schema"] == "Q10BatteryResultV1"
    assert mapping["seed"] == str(SEED)
    assert result.content_digest.hexdigest == result.content_digest.hexdigest


def test_framework_versions_are_the_pinned_adoptions() -> None:
    versions = dict(battery.framework_versions())
    assert versions == {
        "optuna": metadata.version("optuna"),
        "scikit-learn": metadata.version("scikit-learn"),
        "xgboost": metadata.version("xgboost"),
    }
    assert versions["optuna"] == "4.9.0"
    assert versions["scikit-learn"] == "1.9.0"
    assert versions["xgboost"] == "3.3.0"


def test_disposition_table_is_lawful_and_honest() -> None:
    records = battery.SECTION_14_BATTERY_DISPOSITIONS
    disposition_table_digest(records)  # sorted/unique law
    by_id = {record.bullet_id: record for record in records}
    waiting = {
        bullet_id
        for bullet_id, record in by_id.items()
        if record.disposition is BatteryDisposition.WAITING_Q14
    }
    assert waiting == {
        "16-01-purged-embargoed-walk-forward",
        "16-02-untouched-holdout",
        "16-03-negative-control-factory",
        "16-04-cost-latency-stress",
        "16-05-pbo-dsr-bootstrap",
    }
    assert by_id["14.3-02-lightgbm"].disposition is BatteryDisposition.REFERENCE_ONLY
    assert by_id["14.3-03-catboost"].disposition is BatteryDisposition.REFERENCE_ONLY
    boosted = by_id["14.3-01-xgboost-challengers"]
    assert boosted.disposition is BatteryDisposition.ADOPT
    assert len(boosted.implemented_ids) == 8
    trials = by_id["14.3-06-record-all-trials"]
    assert set(trials.implemented_ids) == {
        "study_xgb_classifier:v1",
        "study_xgb_quantile:v1",
        "study_xgb_ranker:v1",
        "study_xgb_regressor:v1",
    }
    for record in records:
        if record.disposition in (BatteryDisposition.ADOPT, BatteryDisposition.ADAPT):
            assert record.implemented_ids
        else:
            assert not record.implemented_ids
