from __future__ import annotations

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.models.contracts import (
    BatteryDisposition,
    BatteryDispositionRecordV1,
    CalibrationMethod,
    ComparisonReportV1,
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


def metric(name: str, mantissa: int, *, higher: bool = False) -> MetricValueV1:
    return MetricValueV1(
        name=name,
        value=FixedPointV1(mantissa),
        derivation=MetricDerivation.EXACT_RATIONAL,
        direction=(MetricDirection.HIGHER_IS_BETTER if higher else MetricDirection.LOWER_IS_BETTER),
    )


def result(model_id: str, mantissa: int, *, higher: bool = False) -> ModelResultV1:
    return ModelResultV1(
        model_id=model_id,
        target_id="target:v1",
        role=ModelRole.TRANSPARENT_BASELINE,
        calibration=CalibrationMethod.NONE,
        probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
        params=(),
        metrics=(metric("primary", mantissa, higher=higher),),
        predictions=prediction_digest({"score": (FixedPointV1(mantissa),)}),
    )


def test_metric_value_contracts() -> None:
    value = metric("brier", 5)
    assert value.as_mapping()["name"] == "brier"
    with pytest.raises(ContractValueError, match="identifier"):
        metric("not valid!", 5)
    with pytest.raises(ContractValueError, match="FixedPointV1"):
        MetricValueV1("brier", 1, MetricDerivation.BINARY64, MetricDirection.LOWER_IS_BETTER)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="MetricDerivation"):
        MetricValueV1("brier", FixedPointV1(1), "EXACT", MetricDirection.LOWER_IS_BETTER)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="MetricDirection"):
        MetricValueV1("brier", FixedPointV1(1), MetricDerivation.BINARY64, "LOWER")  # type: ignore[arg-type]


def test_prediction_digest_laws() -> None:
    payload: dict[str, tuple[FixedPointV1, ...]] = {"score": (FixedPointV1(1), FixedPointV1(-2))}
    digest = prediction_digest(payload)
    assert digest == prediction_digest(dict(payload))
    assert digest != prediction_digest({"score": (FixedPointV1(1), FixedPointV1(2))})
    with pytest.raises(ContractValueError, match="non-empty"):
        prediction_digest({})
    with pytest.raises(ContractValueError, match="non-empty"):
        prediction_digest({"score": ()})
    with pytest.raises(ContractValueError, match="identifier"):
        prediction_digest({"bad name!": (FixedPointV1(1),)})


def test_model_result_laws() -> None:
    good = result("model_a:v1", 5)
    assert good.metric("primary").value.mantissa == 5
    assert good.as_mapping()["modelId"] == "model_a:v1"
    with pytest.raises(ContractValueError, match="not reported"):
        good.metric("missing")
    with pytest.raises(ContractValueError, match="sorted by unique name"):
        ModelResultV1(
            model_id="model_a:v1",
            target_id="target:v1",
            role=ModelRole.CONTROL,
            calibration=CalibrationMethod.NONE,
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=(("b", 1), ("a", 2)),
            metrics=(metric("primary", 1),),
            predictions=good.predictions,
        )
    with pytest.raises(ContractValueError, match="exact integer or string"):
        ModelResultV1(
            model_id="model_a:v1",
            target_id="target:v1",
            role=ModelRole.CONTROL,
            calibration=CalibrationMethod.NONE,
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=(("a", True),),
            metrics=(metric("primary", 1),),
            predictions=good.predictions,
        )
    with pytest.raises(ContractValueError, match="bounded non-empty"):
        ModelResultV1(
            model_id="model_a:v1",
            target_id="target:v1",
            role=ModelRole.CONTROL,
            calibration=CalibrationMethod.NONE,
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=(),
            metrics=(),
            predictions=good.predictions,
        )
    with pytest.raises(ContractValueError, match="sorted by unique name"):
        ModelResultV1(
            model_id="model_a:v1",
            target_id="target:v1",
            role=ModelRole.CONTROL,
            calibration=CalibrationMethod.NONE,
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=(),
            metrics=(metric("b", 1), metric("a", 2)),
            predictions=good.predictions,
        )
    with pytest.raises(ContractValueError, match="ModelRole"):
        ModelResultV1(
            model_id="model_a:v1",
            target_id="target:v1",
            role="CONTROL",  # type: ignore[arg-type]
            calibration=CalibrationMethod.NONE,
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=(),
            metrics=(metric("primary", 1),),
            predictions=good.predictions,
        )
    with pytest.raises(ContractValueError, match="CalibrationMethod"):
        ModelResultV1(
            model_id="model_a:v1",
            target_id="target:v1",
            role=ModelRole.CONTROL,
            calibration="NONE",  # type: ignore[arg-type]
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=(),
            metrics=(metric("primary", 1),),
            predictions=good.predictions,
        )
    with pytest.raises(ContractValueError, match="ProbabilitySemantics"):
        ModelResultV1(
            model_id="model_a:v1",
            target_id="target:v1",
            role=ModelRole.CONTROL,
            calibration=CalibrationMethod.NONE,
            probability_semantics="CALIBRATED",  # type: ignore[arg-type]
            params=(),
            metrics=(metric("primary", 1),),
            predictions=good.predictions,
        )
    with pytest.raises(ContractValueError, match="params must be a tuple"):
        ModelResultV1(
            model_id="model_a:v1",
            target_id="target:v1",
            role=ModelRole.CONTROL,
            calibration=CalibrationMethod.NONE,
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=[],  # type: ignore[arg-type]
            metrics=(metric("primary", 1),),
            predictions=good.predictions,
        )
    with pytest.raises(ContractValueError, match="DigestV1"):
        ModelResultV1(
            model_id="model_a:v1",
            target_id="target:v1",
            role=ModelRole.CONTROL,
            calibration=CalibrationMethod.NONE,
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=(),
            metrics=(metric("primary", 1),),
            predictions="abc",  # type: ignore[arg-type]
        )


def test_comparison_report_winner_law_lower_is_better() -> None:
    report = make_comparison_report(
        target_id="target:v1",
        target_kind=TargetKind.REGRESSION,
        primary_metric="primary",
        results=(result("model_b:v1", 3), result("model_a:v1", 7)),
    )
    assert report.winner_model_id == "model_b:v1"
    assert report.losing_model_ids() == ("model_a:v1",)
    assert report.as_mapping()["winnerModelId"] == "model_b:v1"


def test_comparison_report_winner_law_higher_and_ties() -> None:
    report = make_comparison_report(
        target_id="target:v1",
        target_kind=TargetKind.RANK,
        primary_metric="primary",
        results=(
            result("model_b:v1", 9, higher=True),
            result("model_a:v1", 9, higher=True),
            result("model_c:v1", 1, higher=True),
        ),
    )
    assert report.winner_model_id == "model_a:v1"  # lexicographic tie-break


def test_comparison_report_fails_closed() -> None:
    results = (result("model_a:v1", 7), result("model_b:v1", 3))
    with pytest.raises(ContractValueError, match="winner_model_id"):
        ComparisonReportV1(
            target_id="target:v1",
            target_kind=TargetKind.REGRESSION,
            primary_metric="primary",
            results=results,
            winner_model_id="model_a:v1",
        )
    with pytest.raises(ContractValueError, match="sorted by unique model_id"):
        ComparisonReportV1(
            target_id="target:v1",
            target_kind=TargetKind.REGRESSION,
            primary_metric="primary",
            results=(results[1], results[0]),
            winner_model_id="model_b:v1",
        )
    with pytest.raises(ContractValueError, match="at least two"):
        ComparisonReportV1(
            target_id="target:v1",
            target_kind=TargetKind.REGRESSION,
            primary_metric="primary",
            results=(results[0],),
            winner_model_id="model_a:v1",
        )
    with pytest.raises(ContractValueError, match="needs results"):
        make_comparison_report(
            target_id="target:v1",
            target_kind=TargetKind.REGRESSION,
            primary_metric="primary",
            results=(),
        )
    with pytest.raises(ContractValueError, match="belong to the report target"):
        ComparisonReportV1(
            target_id="other:v1",
            target_kind=TargetKind.REGRESSION,
            primary_metric="primary",
            results=results,
            winner_model_id="model_b:v1",
        )
    mixed = (result("model_a:v1", 7), result("model_b:v1", 3, higher=True))
    with pytest.raises(ContractValueError, match="direction must be consistent"):
        ComparisonReportV1(
            target_id="target:v1",
            target_kind=TargetKind.REGRESSION,
            primary_metric="primary",
            results=mixed,
            winner_model_id="model_b:v1",
        )
    with pytest.raises(ContractValueError, match="TargetKind"):
        ComparisonReportV1(
            target_id="target:v1",
            target_kind="REGRESSION",  # type: ignore[arg-type]
            primary_metric="primary",
            results=results,
            winner_model_id="model_b:v1",
        )


def test_disposition_record_laws() -> None:
    record = BatteryDispositionRecordV1(
        bullet_id="14.9-01-example",
        bullet="example bullet",
        disposition=BatteryDisposition.ADOPT,
        reason="implemented",
        implemented_ids=("a:v1", "b:v1"),
    )
    assert record.as_mapping()["disposition"] == "ADOPT"
    with pytest.raises(ContractValueError, match="exactly for ADOPT/ADAPT"):
        BatteryDispositionRecordV1(
            bullet_id="14.9-01-example",
            bullet="example bullet",
            disposition=BatteryDisposition.ADOPT,
            reason="implemented",
            implemented_ids=(),
        )
    with pytest.raises(ContractValueError, match="exactly for ADOPT/ADAPT"):
        BatteryDispositionRecordV1(
            bullet_id="14.9-01-example",
            bullet="example bullet",
            disposition=BatteryDisposition.WAITING_Q14,
            reason="waiting",
            implemented_ids=("a:v1",),
        )
    with pytest.raises(ContractValueError, match="sorted tuple"):
        BatteryDispositionRecordV1(
            bullet_id="14.9-01-example",
            bullet="example bullet",
            disposition=BatteryDisposition.ADOPT,
            reason="implemented",
            implemented_ids=("b:v1", "a:v1"),
        )
    with pytest.raises(ContractValueError, match="non-empty text"):
        BatteryDispositionRecordV1(
            bullet_id="14.9-01-example",
            bullet="  ",
            disposition=BatteryDisposition.REJECT,
            reason="reason",
            implemented_ids=(),
        )
    with pytest.raises(ContractValueError, match="non-empty text"):
        BatteryDispositionRecordV1(
            bullet_id="14.9-01-example",
            bullet="bullet",
            disposition=BatteryDisposition.REJECT,
            reason=" ",
            implemented_ids=(),
        )
    with pytest.raises(ContractValueError, match="BatteryDisposition"):
        BatteryDispositionRecordV1(
            bullet_id="14.9-01-example",
            bullet="bullet",
            disposition="ADOPT",  # type: ignore[arg-type]
            reason="reason",
            implemented_ids=(),
        )


def test_disposition_table_digest_laws() -> None:
    first = BatteryDispositionRecordV1(
        bullet_id="14.9-01-a",
        bullet="a",
        disposition=BatteryDisposition.REJECT,
        reason="r",
        implemented_ids=(),
    )
    second = BatteryDispositionRecordV1(
        bullet_id="14.9-02-b",
        bullet="b",
        disposition=BatteryDisposition.DATA_INSUFFICIENT,
        reason="r",
        implemented_ids=(),
    )
    digest = disposition_table_digest((first, second))
    assert digest == disposition_table_digest((first, second))
    with pytest.raises(ContractValueError, match="non-empty"):
        disposition_table_digest(())
    with pytest.raises(ContractValueError, match="sorted by unique bullet_id"):
        disposition_table_digest((second, first))
    with pytest.raises(ContractValueError, match="sorted by unique bullet_id"):
        disposition_table_digest((first, first))
