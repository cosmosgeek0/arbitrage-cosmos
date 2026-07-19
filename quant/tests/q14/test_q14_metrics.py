"""Q14 exact metric law: values, degeneracy reasons and the primary-metric spec."""

from __future__ import annotations

from dataclasses import replace

import pytest
from q14_fixtures import make_sample_set, predictions_from_scores

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.validation.metrics import (
    MetricKind,
    MetricStatus,
    MetricValueV1,
    PrimaryMetricSpecV1,
    brier_score,
    calibration_slope,
    evaluate_primary,
    expected_calibration_error,
    pr_auc,
    precision_at_k,
    recall_at_k,
    roc_auc,
)
from quant_edge.validation.samples import PredictionSetV1, SampleSetV1

SCALE = 10**12


def _prediction_set(
    samples: SampleSetV1,
    scores: dict[str, tuple[int, int]],
) -> PredictionSetV1:
    ratios: dict[str, ExactRatioV1] = {
        sample_id: make_ratio(numerator, denominator)
        for sample_id, (numerator, denominator) in scores.items()
    }
    return predictions_from_scores(samples, ratios)


def _simple_case() -> tuple[SampleSetV1, PredictionSetV1]:
    """Four samples: labels T, F, T, F; scores 0.9, 0.8, 0.4, 0.1."""

    samples = make_sample_set(4, outcome_of=lambda index: index % 2 == 0)
    predictions = _prediction_set(
        samples,
        {
            "s-0000": (9, 10),
            "s-0001": (8, 10),
            "s-0002": (4, 10),
            "s-0003": (1, 10),
        },
    )
    return samples, predictions


def test_metric_value_contract_law() -> None:
    good = MetricValueV1(
        metric_id="m",
        status=MetricStatus.AVAILABLE,
        value=FixedPointV1(1),
        reason=None,
        support=2,
        positive_count=1,
    )
    assert good.as_mapping()["metricId"] == "m"
    with pytest.raises(ContractValueError, match="MetricStatus"):
        MetricValueV1(
            metric_id="m",
            status="AVAILABLE",  # type: ignore[arg-type]
            value=FixedPointV1(1),
            reason=None,
            support=2,
            positive_count=1,
        )
    with pytest.raises(ContractValueError, match="value and no reason"):
        MetricValueV1(
            metric_id="m",
            status=MetricStatus.AVAILABLE,
            value=None,
            reason=None,
            support=2,
            positive_count=1,
        )
    with pytest.raises(ContractValueError, match="value and no reason"):
        MetricValueV1(
            metric_id="m",
            status=MetricStatus.AVAILABLE,
            value=FixedPointV1(1),
            reason="NO_REASON_ALLOWED",
            support=2,
            positive_count=1,
        )
    with pytest.raises(ContractValueError, match="reason and no value"):
        MetricValueV1(
            metric_id="m",
            status=MetricStatus.UNKNOWN,
            value=FixedPointV1(1),
            reason="SOME_REASON",
            support=2,
            positive_count=1,
        )
    with pytest.raises(ContractValueError, match="reason and no value"):
        MetricValueV1(
            metric_id="m",
            status=MetricStatus.UNKNOWN,
            value=None,
            reason=None,
            support=2,
            positive_count=1,
        )
    with pytest.raises(ContractValueError, match="reason"):
        MetricValueV1(
            metric_id="m",
            status=MetricStatus.UNKNOWN,
            value=None,
            reason="not a code",
            support=2,
            positive_count=1,
        )


def test_primary_metric_spec_law() -> None:
    with pytest.raises(ContractValueError, match="MetricKind"):
        PrimaryMetricSpecV1(kind="PR_AUC", k=None, ece_bins=None)  # type: ignore[arg-type]
    with pytest.raises(ContractValueError, match="diagnostic"):
        PrimaryMetricSpecV1(kind=MetricKind.CALIBRATION_SLOPE, k=None, ece_bins=None)
    with pytest.raises(ContractValueError, match="k"):
        PrimaryMetricSpecV1(kind=MetricKind.PRECISION_AT_K, k=None, ece_bins=None)
    with pytest.raises(ContractValueError, match="k applies only"):
        PrimaryMetricSpecV1(kind=MetricKind.PR_AUC, k=3, ece_bins=None)
    with pytest.raises(ContractValueError, match="ece_bins"):
        PrimaryMetricSpecV1(kind=MetricKind.ECE, k=None, ece_bins=None)
    with pytest.raises(ContractValueError, match="ece_bins applies only"):
        PrimaryMetricSpecV1(kind=MetricKind.BRIER, k=None, ece_bins=8)

    at_k = PrimaryMetricSpecV1(kind=MetricKind.RECALL_AT_K, k=5, ece_bins=None)
    assert at_k.metric_id() == "recall_at_k:5"
    assert at_k.higher_is_better
    ece = PrimaryMetricSpecV1(kind=MetricKind.ECE, k=None, ece_bins=8)
    assert ece.metric_id() == "ece:8"
    assert not ece.higher_is_better
    plain = PrimaryMetricSpecV1(kind=MetricKind.PR_AUC, k=None, ece_bins=None)
    assert plain.metric_id() == "pr_auc"
    assert plain.as_mapping() == {"eceBins": None, "k": None, "kind": "PR_AUC"}


def test_precision_and_recall_at_k() -> None:
    samples, predictions = _simple_case()
    precision = precision_at_k(samples, predictions, k=2)
    assert precision.status is MetricStatus.AVAILABLE
    assert precision.value == FixedPointV1(SCALE // 2)
    recall = recall_at_k(samples, predictions, k=2)
    assert recall.value == FixedPointV1(SCALE // 2)
    assert recall.positive_count == 2

    small = precision_at_k(samples, predictions, k=5)
    assert small.status is MetricStatus.UNKNOWN
    assert small.reason == "INSUFFICIENT_SCOREABLE_SAMPLES"
    assert recall_at_k(samples, predictions, k=5).reason == "INSUFFICIENT_SCOREABLE_SAMPLES"

    negatives = make_sample_set(4, outcome_of=lambda index: False)
    negative_predictions = _prediction_set(
        negatives,
        {f"s-{index:04d}": (1, 10) for index in range(4)},
    )
    no_positive = recall_at_k(negatives, negative_predictions, k=2)
    assert no_positive.reason == "NO_POSITIVE_SAMPLES"


def test_pr_auc_exact_value_and_degeneracy() -> None:
    samples, predictions = _simple_case()
    metric = pr_auc(samples, predictions)
    assert metric.status is MetricStatus.AVAILABLE
    # Ranks: s-0000 (T), s-0001 (F), s-0002 (T), s-0003 (F) -> AP = (1 + 2/3) / 2.
    assert metric.value == FixedPointV1(833_333_333_333)

    negatives = make_sample_set(3, outcome_of=lambda index: False)
    negative_predictions = _prediction_set(
        negatives, {f"s-{index:04d}": (1, 10) for index in range(3)}
    )
    assert pr_auc(negatives, negative_predictions).reason == "NO_POSITIVE_SAMPLES"

    unknown = make_sample_set(3, outcome_of=lambda index: None)
    unknown_predictions = _prediction_set(
        unknown, {f"s-{index:04d}": (1, 10) for index in range(3)}
    )
    assert pr_auc(unknown, unknown_predictions).reason == "NO_SCOREABLE_SAMPLES"

    constant = make_sample_set(4, outcome_of=lambda index: index % 2 == 0)
    renamed_cases = (
        ("a-positive", "z-negative", "b-positive", "y-negative"),
        ("z-positive", "a-negative", "y-positive", "b-negative"),
    )
    for sample_ids in renamed_cases:
        renamed = SampleSetV1(
            dataset_id="q14-tied-constant",
            posture=constant.posture,
            samples=tuple(
                replace(sample, sample_id=sample_id)
                for sample, sample_id in zip(constant.samples, sample_ids, strict=True)
            ),
        )
        tied_predictions = _prediction_set(
            renamed,
            {sample.sample_id: (1, 2) for sample in renamed.samples},
        )
        assert pr_auc(renamed, tied_predictions).value == FixedPointV1(SCALE // 2)

    mixed = make_sample_set(
        6,
        outcome_of=lambda index: (True, False, True, True, False, False)[index],
    )
    mixed_renamings = (
        ("a", "z", "b", "c", "y", "x"),
        ("z", "a", "y", "x", "b", "c"),
    )
    for mixed_sample_ids in mixed_renamings:
        renamed = SampleSetV1(
            dataset_id="q14-tied-mixed",
            posture=mixed.posture,
            samples=tuple(
                replace(sample, sample_id=sample_id)
                for sample, sample_id in zip(mixed.samples, mixed_sample_ids, strict=True)
            ),
        )
        score_by_position = ((9, 10), (9, 10), (1, 2), (1, 2), (1, 2), (1, 10))
        tied_predictions = _prediction_set(
            renamed,
            {
                sample.sample_id: score
                for sample, score in zip(renamed.samples, score_by_position, strict=True)
            },
        )
        assert pr_auc(renamed, tied_predictions).value == FixedPointV1(566_666_666_667)


def test_roc_auc_tie_law() -> None:
    samples, predictions = _simple_case()
    metric = roc_auc(samples, predictions)
    # Pairs: (0.9 vs 0.8, 0.1) wins 2; (0.4 vs 0.8) loses; (0.4 vs 0.1) wins -> 3/4.
    assert metric.value == FixedPointV1(750_000_000_000)

    tied_samples = make_sample_set(4, outcome_of=lambda index: index % 2 == 0)
    tied_predictions = _prediction_set(
        tied_samples, {f"s-{index:04d}": (1, 2) for index in range(4)}
    )
    tied = roc_auc(tied_samples, tied_predictions)
    assert tied.value == FixedPointV1(SCALE // 2)

    negatives = make_sample_set(3, outcome_of=lambda index: False)
    negative_predictions = _prediction_set(
        negatives, {f"s-{index:04d}": (1, 10) for index in range(3)}
    )
    assert roc_auc(negatives, negative_predictions).reason == "DEGENERATE_CLASS_SUPPORT"


def test_brier_and_probability_range_law() -> None:
    samples, predictions = _simple_case()
    metric = brier_score(samples, predictions)
    # ((0.1)^2 + (0.8)^2 + (0.6)^2 + (0.1)^2) / 4 = 1.02 / 4 = 0.255.
    assert metric.value == FixedPointV1(255_000_000_000)

    out_of_range = _prediction_set(
        samples,
        {
            "s-0000": (11, 10),
            "s-0001": (8, 10),
            "s-0002": (4, 10),
            "s-0003": (1, 10),
        },
    )
    assert brier_score(samples, out_of_range).reason == "SCORE_OUTSIDE_PROBABILITY_RANGE"

    unknown = make_sample_set(3, outcome_of=lambda index: None)
    unknown_predictions = _prediction_set(
        unknown, {f"s-{index:04d}": (1, 10) for index in range(3)}
    )
    assert brier_score(unknown, unknown_predictions).reason == "NO_SCOREABLE_SAMPLES"


def test_expected_calibration_error_bin_law() -> None:
    samples, predictions = _simple_case()
    metric = expected_calibration_error(samples, predictions, bins=2)
    # Low bin: scores 0.4, 0.1 -> conf 0.25, acc 0.5 -> |diff| 0.25 (weight 1/2).
    # High bin: scores 0.9, 0.8 -> conf 0.85, acc 0.5 -> |diff| 0.35 (weight 1/2).
    assert metric.value == FixedPointV1(300_000_000_000)

    boundary = _prediction_set(
        samples,
        {
            "s-0000": (1, 1),
            "s-0001": (1, 1),
            "s-0002": (0, 1),
            "s-0003": (0, 1),
        },
    )
    top_clamped = expected_calibration_error(samples, boundary, bins=4)
    assert top_clamped.status is MetricStatus.AVAILABLE

    out_of_range = _prediction_set(
        samples,
        {
            "s-0000": (11, 10),
            "s-0001": (8, 10),
            "s-0002": (4, 10),
            "s-0003": (1, 10),
        },
    )
    assert (
        expected_calibration_error(samples, out_of_range, bins=2).reason
        == "SCORE_OUTSIDE_PROBABILITY_RANGE"
    )
    unknown = make_sample_set(3, outcome_of=lambda index: None)
    unknown_predictions = _prediction_set(
        unknown, {f"s-{index:04d}": (1, 10) for index in range(3)}
    )
    assert (
        expected_calibration_error(unknown, unknown_predictions, bins=2).reason
        == "NO_SCOREABLE_SAMPLES"
    )


def test_calibration_slope_law() -> None:
    samples, predictions = _simple_case()
    metric = calibration_slope(samples, predictions)
    assert metric.status is MetricStatus.AVAILABLE
    # cov = 0.2, var = 0.41 -> slope = 20/41.
    assert metric.value == FixedPointV1(487_804_878_049)

    constant = _prediction_set(samples, {f"s-{index:04d}": (1, 2) for index in range(4)})
    assert calibration_slope(samples, constant).reason == "CONSTANT_SCORES"

    out_of_range = _prediction_set(
        samples,
        {
            "s-0000": (11, 10),
            "s-0001": (8, 10),
            "s-0002": (4, 10),
            "s-0003": (1, 10),
        },
    )
    assert calibration_slope(samples, out_of_range).reason == "SCORE_OUTSIDE_PROBABILITY_RANGE"
    unknown = make_sample_set(3, outcome_of=lambda index: None)
    unknown_predictions = _prediction_set(
        unknown, {f"s-{index:04d}": (1, 10) for index in range(3)}
    )
    assert calibration_slope(unknown, unknown_predictions).reason == "NO_SCOREABLE_SAMPLES"


def test_restrict_ids_law() -> None:
    samples, predictions = _simple_case()
    restricted = pr_auc(samples, predictions, restrict_ids=("s-0000", "s-0001"))
    assert restricted.support == 2
    with pytest.raises(ContractValueError, match="restricted ids"):
        pr_auc(samples, predictions, restrict_ids=("s-9999",))


def test_evaluate_primary_dispatch() -> None:
    samples, predictions = _simple_case()
    cases = [
        (PrimaryMetricSpecV1(kind=MetricKind.PR_AUC, k=None, ece_bins=None), "pr_auc"),
        (PrimaryMetricSpecV1(kind=MetricKind.ROC_AUC, k=None, ece_bins=None), "roc_auc"),
        (
            PrimaryMetricSpecV1(kind=MetricKind.PRECISION_AT_K, k=2, ece_bins=None),
            "precision_at_k:2",
        ),
        (
            PrimaryMetricSpecV1(kind=MetricKind.RECALL_AT_K, k=2, ece_bins=None),
            "recall_at_k:2",
        ),
        (PrimaryMetricSpecV1(kind=MetricKind.BRIER, k=None, ece_bins=None), "brier"),
        (PrimaryMetricSpecV1(kind=MetricKind.ECE, k=None, ece_bins=2), "ece:2"),
    ]
    for spec, metric_id in cases:
        assert evaluate_primary(spec, samples, predictions).metric_id == metric_id
    with pytest.raises(ContractValueError, match="PrimaryMetricSpecV1"):
        evaluate_primary("nope", samples, predictions)  # type: ignore[arg-type]
