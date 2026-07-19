from __future__ import annotations

import math
from decimal import getcontext, localcontext

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.models.contracts import MetricDerivation, MetricDirection
from quant_edge.models.focus_budget import (
    PRODUCTION_FOCUS_EVIDENCE_NOT_CONFIGURED,
    FocusBudgetReportV1,
    FocusBudgetSpecV1,
    FocusBudgetStatus,
    FocusCandidateV1,
    MeasurementPosture,
    focus_budget_report,
)
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


def _focus_candidate(
    candidate_id: str,
    score: int,
    *,
    relevant: bool | None = True,
    lead_time_ns: int | None = 20,
    gross: int | None = 10,
    cost: int | None = 2,
    compute_ns: int | None = 100,
    stream_bytes: int | None = 10,
) -> FocusCandidateV1:
    return FocusCandidateV1(
        candidate_id=candidate_id,
        rank_score=make_ratio(score, 10),
        relevant=relevant,
        detection_time_ns=None if lead_time_ns is None else 1_000,
        event_time_ns=None if lead_time_ns is None else 1_000 + lead_time_ns,
        prior_probability=None if lead_time_ns is None else make_ratio(1, 5),
        posterior_probability=None if lead_time_ns is None else make_ratio(4, 5),
        gross_value=None if gross is None else make_ratio(gross, 1),
        cost_value=None if cost is None else make_ratio(cost, 1),
        compute_ns=compute_ns,
        stream_bytes=stream_bytes,
    )


def _focus_spec(*, compute: int = 1_000, stream: int = 1_000) -> FocusBudgetSpecV1:
    return FocusBudgetSpecV1(
        top_k=2,
        conservative_haircut=make_ratio(1, 2),
        max_compute_ns=compute,
        max_stream_bytes=stream,
    )


class TestFocusBudgetMetrics:
    def test_top_k_precision_recall_and_lead_time_are_exact(self) -> None:
        report = focus_budget_report(
            (
                _focus_candidate("asset-a", 9, relevant=True, lead_time_ns=20),
                _focus_candidate("asset-b", 8, relevant=False, lead_time_ns=40),
                _focus_candidate("asset-c", 7, relevant=True, lead_time_ns=60),
            ),
            spec=_focus_spec(),
            posture=MeasurementPosture.SYNTHETIC_RESEARCH,
        )

        assert report.status is FocusBudgetStatus.AVAILABLE_RESEARCH_ONLY
        assert report.selected_ids == ("asset-a", "asset-b")
        assert report.precision_at_k == make_ratio(1, 2)
        assert report.recall_at_k == make_ratio(1, 2)
        assert report.mean_lead_time_ns == make_ratio(30, 1)

    def test_expected_information_gain_is_positive_and_deterministic(self) -> None:
        candidates = (_focus_candidate("asset-a", 9), _focus_candidate("asset-b", 8))

        first = focus_budget_report(
            candidates,
            spec=_focus_spec(),
            posture=MeasurementPosture.SYNTHETIC_RESEARCH,
        )

        assert first == focus_budget_report(
            candidates,
            spec=_focus_spec(),
            posture=MeasurementPosture.SYNTHETIC_RESEARCH,
        )
        assert first.mean_information_gain is not None
        assert first.mean_information_gain.mantissa > 0

    def test_information_gain_ignores_and_restores_hostile_ambient_precision(self) -> None:
        candidates = (_focus_candidate("asset-a", 9), _focus_candidate("asset-b", 8))
        original = getcontext().copy()

        with localcontext() as ambient:
            ambient.prec = 6
            low_precision = focus_budget_report(
                candidates,
                spec=_focus_spec(),
                posture=MeasurementPosture.SYNTHETIC_RESEARCH,
            )
            assert getcontext().prec == 6

            ambient.prec = 28
            ordinary_precision = focus_budget_report(
                candidates,
                spec=_focus_spec(),
                posture=MeasurementPosture.SYNTHETIC_RESEARCH,
            )
            assert getcontext().prec == 28

        assert low_precision == ordinary_precision
        assert getcontext().prec == original.prec
        assert getcontext().rounding == original.rounding
        assert getcontext().flags == original.flags
        assert getcontext().traps == original.traps

    def test_research_costs_are_measured_but_caller_cannot_mint_production_truth(self) -> None:
        candidates = (
            _focus_candidate("asset-a", 9, gross=10, cost=2, compute_ns=100, stream_bytes=10),
            _focus_candidate("asset-b", 8, gross=8, cost=1, compute_ns=200, stream_bytes=20),
        )
        research = focus_budget_report(
            candidates,
            spec=_focus_spec(),
            posture=MeasurementPosture.SYNTHETIC_RESEARCH,
        )
        production = focus_budget_report(
            candidates,
            spec=_focus_spec(),
            posture=MeasurementPosture.PRODUCTION_OBSERVED,
        )

        assert research.status is FocusBudgetStatus.AVAILABLE_RESEARCH_ONLY
        assert research.conservative_net_value == make_ratio(6, 1)
        assert research.compute_ns == 300
        assert research.stream_bytes == 30
        assert research.within_budget is True
        assert production.status is FocusBudgetStatus.DATA_INSUFFICIENT
        assert production.selected_ids == ()
        assert production.precision_at_k is None
        assert production.recall_at_k is None
        assert production.mean_lead_time_ns is None
        assert production.mean_information_gain is None
        assert production.conservative_net_value is None
        assert production.compute_ns is None
        assert production.stream_bytes is None
        assert production.within_budget is None
        assert production.reasons == (PRODUCTION_FOCUS_EVIDENCE_NOT_CONFIGURED,)
        with pytest.raises(ContractValueError, match=PRODUCTION_FOCUS_EVIDENCE_NOT_CONFIGURED):
            FocusBudgetReportV1(
                MeasurementPosture.PRODUCTION_OBSERVED,
                FocusBudgetStatus.AVAILABLE_PRODUCTION_MEASURED,
                (),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                (),
            )

    def test_absent_research_measurements_stay_data_insufficient(self) -> None:
        missing = FocusCandidateV1(
            candidate_id="asset-a",
            rank_score=make_ratio(9, 10),
            relevant=None,
            detection_time_ns=None,
            event_time_ns=None,
            prior_probability=None,
            posterior_probability=None,
            gross_value=None,
            cost_value=None,
            compute_ns=None,
            stream_bytes=None,
        )

        report = focus_budget_report(
            (missing,),
            spec=FocusBudgetSpecV1(1, make_ratio(1, 2), 1_000, 1_000),
            posture=MeasurementPosture.SYNTHETIC_RESEARCH,
        )

        assert report.status is FocusBudgetStatus.DATA_INSUFFICIENT
        assert report.mean_lead_time_ns is None
        assert report.mean_information_gain is None
        assert report.conservative_net_value is None
        assert report.within_budget is None
        assert set(report.reasons) == {
            "COMPUTE_COST_MISSING",
            "INFORMATION_GAIN_MISSING",
            "LABELS_MISSING",
            "LEAD_TIME_MISSING",
            "NET_VALUE_MISSING",
            "STREAM_COST_MISSING",
        }

    def test_tie_break_and_budget_breach_are_deterministic(self) -> None:
        report = focus_budget_report(
            (
                _focus_candidate("asset-b", 9, compute_ns=80, stream_bytes=80),
                _focus_candidate("asset-a", 9, compute_ns=80, stream_bytes=80),
                _focus_candidate("asset-c", 8),
            ),
            spec=_focus_spec(compute=100, stream=100),
            posture=MeasurementPosture.SYNTHETIC_RESEARCH,
        )

        assert report.selected_ids == ("asset-a", "asset-b")
        assert report.within_budget is False
        with pytest.raises(ContractValueError, match="top_k cannot exceed"):
            focus_budget_report(
                (_focus_candidate("asset-a", 9),),
                spec=_focus_spec(),
                posture=MeasurementPosture.SYNTHETIC_RESEARCH,
            )

    def test_no_relevant_outcomes_and_invalid_probability_fail_honestly(self) -> None:
        report = focus_budget_report(
            (
                _focus_candidate("asset-a", 9, relevant=False),
                _focus_candidate("asset-b", 8, relevant=False),
            ),
            spec=_focus_spec(),
            posture=MeasurementPosture.SYNTHETIC_RESEARCH,
        )

        assert report.status is FocusBudgetStatus.DATA_INSUFFICIENT
        assert report.precision_at_k == make_ratio(0, 1)
        assert report.recall_at_k is None
        assert report.reasons == ("NO_RELEVANT_OUTCOMES",)
        with pytest.raises(ContractValueError, match=r"\(0, 1\)"):
            FocusCandidateV1(
                "asset-z",
                make_ratio(1, 2),
                True,
                1,
                2,
                make_ratio(0, 1),
                make_ratio(1, 2),
                make_ratio(1, 1),
                make_ratio(0, 1),
                1,
                1,
            )


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
