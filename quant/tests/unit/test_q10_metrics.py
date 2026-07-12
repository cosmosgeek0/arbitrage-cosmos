from __future__ import annotations

import math

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.models.contracts import MetricDerivation, MetricDirection
from quant_edge.models.metrics import (
    binary64_log_loss,
    brier_score,
    coverage_abs_error,
    crossing_fraction,
    exact_auc,
    expected_calibration_error,
    kendall_tau_a,
    mean_absolute_error,
    mean_squared_error,
    pinball_loss,
    pinball_mean,
    precision_at_k,
    recall_at_k,
)

S = FIXED_POINT_SCALE


def fp(numerator: int, denominator: int = 1) -> FixedPointV1:
    assert (numerator * S) % denominator == 0
    return FixedPointV1(numerator * S // denominator)


def test_brier_exact() -> None:
    # ((0.75-1)^2 + (0.25-0)^2) / 2 = 1/16
    value = brier_score((fp(3, 4), fp(1, 4)), (1, 0))
    assert value.value.mantissa == S // 16
    assert value.derivation is MetricDerivation.EXACT_RATIONAL
    assert value.direction is MetricDirection.LOWER_IS_BETTER


def test_brier_rejects_bad_inputs() -> None:
    with pytest.raises(ContractValueError, match="labels must be binary"):
        brier_score((fp(1, 2),), (2,))
    with pytest.raises(ContractValueError, match=r"\[0, 1\]"):
        brier_score((FixedPointV1(-1),), (0,))
    with pytest.raises(ContractValueError, match="align with predictions"):
        brier_score((fp(1, 2),), (0, 1))
    with pytest.raises(ContractValueError, match="non-empty tuple"):
        brier_score((), ())
    with pytest.raises(ContractValueError, match="FixedPointV1"):
        brier_score((0.5,), (0,))  # type: ignore[arg-type]


def test_auc_exact_with_ties() -> None:
    # scores: pos {0.9, 0.5}, neg {0.5, 0.1}
    # pairs: (0.9>0.5)=1, (0.9>0.1)=1, (0.5==0.5)=1/2, (0.5>0.1)=1 -> 3.5/4
    value = exact_auc((fp(9, 10), fp(1, 2), fp(1, 2), fp(1, 10)), (1, 1, 0, 0))
    assert value.value.mantissa == 7 * S // 8
    assert value.direction is MetricDirection.HIGHER_IS_BETTER


def test_auc_perfect_and_reversed() -> None:
    assert exact_auc((fp(9, 10), fp(1, 10)), (1, 0)).value.mantissa == S
    assert exact_auc((fp(1, 10), fp(9, 10)), (1, 0)).value.mantissa == 0


def test_auc_requires_both_classes() -> None:
    with pytest.raises(ContractValueError, match="both classes"):
        exact_auc((fp(1, 2), fp(1, 4)), (1, 1))
    with pytest.raises(ContractValueError, match="both classes"):
        exact_auc((fp(1, 2), fp(1, 4)), (0, 0))


def test_ece_exact_binning() -> None:
    # bin 0 [0,0.1): p=0.05,y=0 -> |0.05-0| ; bin 9: p=0.95,y=1 -> |0.95-1|
    # ECE = 1/2*0.05 + 1/2*0.05 = 0.05
    value = expected_calibration_error((fp(1, 20), fp(19, 20)), (0, 1))
    assert value.value.mantissa == S // 20
    assert value.name == "ece"
    named = expected_calibration_error((fp(1, 20),), (0,), name="ece_precalibration")
    assert named.name == "ece_precalibration"


def test_ece_last_bin_closed_at_one() -> None:
    value = expected_calibration_error((fp(1),), (1,))
    assert value.value.mantissa == 0


def test_log_loss_matches_binary64_reference_and_clips() -> None:
    predictions = (fp(3, 4), fp(1, 4))
    labels = (1, 0)
    expected = (-math.log(0.75) - math.log(0.75)) / 2
    value = binary64_log_loss(predictions, labels)
    assert value.derivation is MetricDerivation.BINARY64
    assert abs(value.value.mantissa / S - expected) < 1e-12
    clipped = binary64_log_loss((fp(0), fp(1)), (1, 0))
    # both terms clip to one grid unit; the reference follows the same binary64 path
    reference = (-math.log(1 / S) - math.log(1.0 - (S - 1) / S)) / 2
    assert abs(clipped.value.mantissa / S - reference) < 1e-9


def test_mse_mae_exact() -> None:
    predictions = (fp(3), fp(-1))
    labels = (1, 1)
    assert mean_squared_error(predictions, labels).value.mantissa == 4 * S
    assert mean_absolute_error(predictions, labels).value.mantissa == 2 * S


def test_pinball_exact() -> None:
    # q=0.75: y=4,p=2 -> 0.75*2=1.5 ; y=0,p=2 -> 0.25*2=0.5 ; mean=1
    value = pinball_loss((fp(2), fp(2)), (4, 0), level="0.75")
    assert value.value.mantissa == S
    assert value.name == "pinball_0.75"
    with pytest.raises(ContractValueError, match="unknown quantile level"):
        pinball_loss((fp(2),), (4,), level="0.9")


def test_pinball_mean_exact_and_law() -> None:
    by_level: dict[str, tuple[FixedPointV1, ...]] = {
        "0.25": (fp(2), fp(2)),
        "0.5": (fp(2), fp(2)),
        "0.75": (fp(2), fp(2)),
    }
    labels = (4, 0)
    # per-level means: q(4-2) + (1-q)(2-0) over 2 -> q*2/2 + (1-q)*2/2 = 1 each
    value = pinball_mean(by_level, labels)
    assert value.value.mantissa == S
    assert value.name == "pinball_mean"
    with pytest.raises(ContractValueError, match="declared levels"):
        pinball_mean({"0.25": (fp(2),)}, (4,))


def test_coverage_abs_error_exact() -> None:
    # y<=p for (1<=2) and not (5<=2): coverage 1/2; |1/2 - 1/4| = 1/4
    value = coverage_abs_error((fp(2), fp(2)), (1, 5), level="0.25")
    assert value.value.mantissa == S // 4
    assert value.name == "coverage_abs_error_0.25"


def test_crossing_fraction_exact() -> None:
    lower = (fp(1), fp(3))
    middle = (fp(2), fp(2))
    upper = (fp(3), fp(1))
    value = crossing_fraction(lower, middle, upper)
    assert value.value.mantissa == S // 2
    with pytest.raises(ContractValueError, match="aligned non-empty"):
        crossing_fraction((), (), ())
    with pytest.raises(ContractValueError, match="aligned non-empty"):
        crossing_fraction(lower, middle, (fp(3),))


def test_precision_and_recall_at_k() -> None:
    # one group of 4, k=2, relevant grade >= 2
    scores = (fp(9), fp(8), fp(7), fp(6))
    grades = (2, 0, 3, 2)
    precision = precision_at_k(scores, grades, group_size=4, k=2, relevant_grade=2)
    assert precision.value.mantissa == S // 2
    assert precision.name == "precision_at_2"
    recall = recall_at_k(scores, grades, group_size=4, k=2, relevant_grade=2)
    assert recall.value.mantissa == S // 3
    assert recall.name == "recall_at_2"


def test_rank_metric_tie_break_prefers_earlier_row() -> None:
    scores = (fp(5), fp(5), fp(5), fp(5))
    grades = (3, 0, 0, 0)
    precision = precision_at_k(scores, grades, group_size=4, k=1, relevant_grade=2)
    assert precision.value.mantissa == S


def test_rank_metric_laws() -> None:
    scores = (fp(1), fp(2), fp(3), fp(4))
    grades = (0, 1, 2, 3)
    with pytest.raises(ContractValueError, match="whole groups"):
        precision_at_k(scores, grades, group_size=3, k=1, relevant_grade=2)
    with pytest.raises(ContractValueError, match="within the group size"):
        precision_at_k(scores, grades, group_size=4, k=5, relevant_grade=2)
    with pytest.raises(ContractValueError, match="within the group size"):
        recall_at_k(scores, grades, group_size=4, k=0, relevant_grade=2)
    with pytest.raises(ContractValueError, match="at least one relevant"):
        recall_at_k(scores, (0, 0, 0, 0), group_size=4, k=2, relevant_grade=2)


def test_kendall_tau_a_exact() -> None:
    # perfectly concordant group
    scores = (fp(1), fp(2), fp(3), fp(4))
    grades = (0, 1, 2, 3)
    assert kendall_tau_a(scores, grades, group_size=4).value.mantissa == S
    # fully discordant
    reversed_grades = (3, 2, 1, 0)
    assert kendall_tau_a(scores, reversed_grades, group_size=4).value.mantissa == -S
    # ties contribute zero
    tied = kendall_tau_a((fp(1), fp(1)), (0, 1), group_size=2)
    assert tied.value.mantissa == 0
