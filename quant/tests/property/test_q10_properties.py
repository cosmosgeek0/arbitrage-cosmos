from __future__ import annotations

from fractions import Fraction

from hypothesis import given, seed, settings
from hypothesis import strategies as st

from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.models.contracts import (
    CalibrationMethod,
    MetricDerivation,
    MetricDirection,
    MetricValueV1,
    ModelResultV1,
    ModelRole,
    ProbabilitySemantics,
    TargetKind,
    make_comparison_report,
    prediction_digest,
)
from quant_edge.models.metrics import (
    brier_score,
    exact_auc,
    expected_calibration_error,
    kendall_tau_a,
    mean_absolute_error,
    mean_squared_error,
    pinball_loss,
    precision_at_k,
)
from quant_edge.models.quantize import quantize_binary64
from quant_edge.models.split import InternalChronologicalSplitV1

PROB_MANTISSA = st.integers(min_value=0, max_value=FIXED_POINT_SCALE)
VALUE_MANTISSA = st.integers(min_value=-(10**16), max_value=10**16)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(st.floats(min_value=-1e6, max_value=1e6, allow_nan=False, allow_infinity=False, width=64))
def test_quantization_is_the_nearest_grid_point(value: float) -> None:
    mantissa = quantize_binary64(value, field="v").mantissa
    exact = Fraction.from_float(value) * FIXED_POINT_SCALE
    assert abs(exact - mantissa) <= Fraction(1, 2)
    if abs(exact - mantissa) == Fraction(1, 2):
        assert mantissa % 2 == 0


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(st.lists(st.tuples(PROB_MANTISSA, st.integers(0, 1)), min_size=1, max_size=40))
def test_brier_and_ece_match_brute_force(pairs: list[tuple[int, int]]) -> None:
    predictions = tuple(FixedPointV1(mantissa) for mantissa, _ in pairs)
    labels = tuple(label for _, label in pairs)

    brute_brier = sum(
        ((Fraction(m, FIXED_POINT_SCALE) - y) ** 2 for m, y in pairs), start=Fraction(0)
    ) / len(pairs)
    assert brier_score(predictions, labels).value.mantissa == _round(brute_brier)

    bins: dict[int, list[tuple[int, int]]] = {}
    for mantissa, label in pairs:
        bins.setdefault(min(mantissa * 10 // FIXED_POINT_SCALE, 9), []).append((mantissa, label))
    brute_ece = sum(
        Fraction(len(members), len(pairs))
        * abs(
            Fraction(sum(m for m, _ in members), len(members) * FIXED_POINT_SCALE)
            - Fraction(sum(y for _, y in members), len(members))
        )
        for members in bins.values()
    )
    assert expected_calibration_error(predictions, labels).value.mantissa == _round(brute_ece)


def _round(value: Fraction | int) -> int:
    scaled = Fraction(value) * FIXED_POINT_SCALE
    quotient, remainder = divmod(scaled.numerator, scaled.denominator)
    doubled = remainder * 2
    if doubled > scaled.denominator or (doubled == scaled.denominator and quotient % 2 != 0):
        quotient += 1
    return quotient


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(st.lists(st.tuples(PROB_MANTISSA, st.integers(0, 1)), min_size=2, max_size=30))
def test_auc_matches_quadratic_brute_force(pairs: list[tuple[int, int]]) -> None:
    labels = [label for _, label in pairs]
    if len(set(labels)) < 2:
        pairs = [*pairs[:-1], (pairs[-1][0], 1 - labels[-1])]
    predictions = tuple(FixedPointV1(mantissa) for mantissa, _ in pairs)
    label_tuple = tuple(label for _, label in pairs)
    positives = [m for m, y in pairs if y == 1]
    negatives = [m for m, y in pairs if y == 0]
    doubled = sum(2 if p > n else 1 if p == n else 0 for p in positives for n in negatives)
    brute = Fraction(doubled, 2 * len(positives) * len(negatives))
    assert exact_auc(predictions, label_tuple).value.mantissa == _round(brute)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(st.tuples(VALUE_MANTISSA, st.integers(-10_000, 10_000)), min_size=1, max_size=30),
    st.sampled_from(["0.25", "0.5", "0.75"]),
)
def test_regression_metrics_match_brute_force(pairs: list[tuple[int, int]], level: str) -> None:
    predictions = tuple(FixedPointV1(mantissa) for mantissa, _ in pairs)
    labels = tuple(label for _, label in pairs)
    diffs = [Fraction(mantissa, FIXED_POINT_SCALE) - label for mantissa, label in pairs]
    assert mean_squared_error(predictions, labels).value.mantissa == _round(
        sum((diff * diff for diff in diffs), start=Fraction(0)) / len(diffs)
    )
    assert mean_absolute_error(predictions, labels).value.mantissa == _round(
        sum((abs(diff) for diff in diffs), start=Fraction(0)) / len(diffs)
    )
    quantile = Fraction(level)
    pinball = sum(
        (quantile * -diff if diff <= 0 else (1 - quantile) * diff for diff in diffs),
        start=Fraction(0),
    ) / len(diffs)
    assert pinball_loss(predictions, labels, level=level).value.mantissa == _round(pinball)


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(st.tuples(VALUE_MANTISSA, st.integers(0, 3)), min_size=4, max_size=4 * 8).filter(
        lambda pairs: len(pairs) % 4 == 0
    )
)
def test_rank_metrics_match_brute_force(pairs: list[tuple[int, int]]) -> None:
    scores = tuple(FixedPointV1(mantissa) for mantissa, _ in pairs)
    grades = tuple(grade for _, grade in pairs)
    group_size = 4
    groups = [pairs[start : start + group_size] for start in range(0, len(pairs), group_size)]

    brute_precision = Fraction(0)
    for group in groups:
        ranked = sorted(enumerate(group), key=lambda item: (-item[1][0], item[0]))
        top = ranked[:2]
        brute_precision += Fraction(sum(1 for _, (_, grade) in top if grade >= 2), 2)
    brute_precision /= len(groups)
    measured = precision_at_k(scores, grades, group_size=group_size, k=2, relevant_grade=2)
    assert measured.value.mantissa == _round(brute_precision)

    concordant = 0
    total = 0
    for group in groups:
        for left in range(group_size):
            for right in range(left + 1, group_size):
                product = (group[left][0] - group[right][0]) * (group[left][1] - group[right][1])
                concordant += 1 if product > 0 else -1 if product < 0 else 0
                total += 1
    assert kendall_tau_a(scores, grades, group_size=group_size).value.mantissa == _round(
        Fraction(concordant, total)
    )


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(
    st.lists(st.tuples(st.integers(0, 30), VALUE_MANTISSA), min_size=2, max_size=8).filter(
        lambda items: len({index for index, _ in items}) == len(items)
    ),
    st.booleans(),
)
def test_comparison_winner_law_matches_brute_force(
    entries: list[tuple[int, int]], higher: bool
) -> None:
    direction = MetricDirection.HIGHER_IS_BETTER if higher else MetricDirection.LOWER_IS_BETTER
    results = tuple(
        ModelResultV1(
            model_id=f"model_{index:02d}:v1",
            target_id="target:v1",
            role=ModelRole.CONTROL,
            calibration=CalibrationMethod.NONE,
            probability_semantics=ProbabilitySemantics.NOT_PROBABILITY,
            params=(),
            metrics=(
                MetricValueV1(
                    "primary",
                    FixedPointV1(mantissa),
                    MetricDerivation.EXACT_RATIONAL,
                    direction,
                ),
            ),
            predictions=prediction_digest({"score": (FixedPointV1(mantissa),)}),
        )
        for index, mantissa in entries
    )
    report = make_comparison_report(
        target_id="target:v1",
        target_kind=TargetKind.REGRESSION,
        primary_metric="primary",
        results=results,
    )
    ordered = sorted(results, key=lambda result: result.model_id)
    best = (max if higher else min)(
        ordered, key=lambda result: result.metric("primary").value.mantissa
    )
    best_mantissa = best.metric("primary").value.mantissa
    candidates = [
        result.model_id
        for result in ordered
        if result.metric("primary").value.mantissa == best_mantissa
    ]
    assert report.winner_model_id == min(candidates)
    assert len(report.losing_model_ids()) == len(results) - 1


@settings(max_examples=60, deadline=None)
@seed(20260712)
@given(st.integers(2, 50), st.integers(0, 10), st.integers(2, 30), st.integers(2, 30))
def test_split_partition_property(train: int, embargo: int, valid: int, test: int) -> None:
    split = InternalChronologicalSplitV1(
        train_rows=train, embargo_rows=embargo, valid_rows=valid, test_rows=test
    )
    segments = [
        list(split.train_indices),
        list(split.embargo_indices),
        list(split.valid_indices),
        list(split.test_indices),
    ]
    flattened = [index for segment in segments for index in segment]
    assert flattened == list(range(split.total_rows))
    split.require_exact_cover(split.total_rows)
