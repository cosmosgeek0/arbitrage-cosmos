from __future__ import annotations

import runpy
import sys
from fractions import Fraction
from pathlib import Path

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.randomness import DeterministicRandom
from quant_edge.survival.campaign import (
    CAMPAIGN_SEED,
    SEEDED_CAUSES,
    SEEDED_GRID,
    SEEDED_HAZARDS,
    SEEDED_STRATA,
    _draw_seeded_cohort,
    _fp_text,
    _marginal_predictions,
    _model_prediction_rows,
    _require_covered,
    _subject,
    _threshold,
    _true_any_event_survival,
    golden_hazard_model,
    main,
)
from quant_edge.survival.contracts import TimeGridV1
from quant_edge.survival.hazard_model import (
    HazardModelConfigV1,
    fit_discrete_hazard,
)
from quant_edge.survival.km import estimate_kaplan_meier

SECOND_NS = 1_000_000_000


def test_threshold_is_the_exact_floor_of_the_u64_span() -> None:
    assert _threshold(Fraction(0)) == 0
    assert _threshold(Fraction(1, 1)) == 1 << 64
    assert _threshold(Fraction(1, 2)) == 1 << 63
    assert _threshold(Fraction(1, 3)) == (1 << 64) // 3


def test_seeded_cohort_is_a_pure_function_of_the_rng_stream() -> None:
    first = _draw_seeded_cohort(DeterministicRandom.from_seed(CAMPAIGN_SEED), "c")
    second = _draw_seeded_cohort(DeterministicRandom.from_seed(CAMPAIGN_SEED), "c")
    assert first == second
    # Advancing the stream produces a different cohort (the test split).
    rng = DeterministicRandom.from_seed(CAMPAIGN_SEED)
    _draw_seeded_cohort(rng, "train")
    different = _draw_seeded_cohort(rng, "test")
    assert [subject.duration_ns for subject in different.subjects] != [
        subject.duration_ns for subject in first.subjects
    ]


def test_seeded_cohort_respects_the_generating_law_shape() -> None:
    cohort = _draw_seeded_cohort(DeterministicRandom.from_seed(CAMPAIGN_SEED), "c")
    assert cohort.size == 240
    strata = {subject.stratum_id for subject in cohort.subjects}
    assert strata == set(SEEDED_STRATA)
    for subject in cohort.subjects:
        if subject.duration_ns > SEEDED_GRID.end_ns:
            assert not subject.is_event
        else:
            assert subject.duration_ns in SEEDED_GRID.times_ns


def test_true_survival_is_the_equal_weight_mixture() -> None:
    expected = sum(
        (1 - primary - competing) ** 3 for primary, competing in SEEDED_HAZARDS.values()
    ) / len(SEEDED_HAZARDS)
    assert _true_any_event_survival(2) == expected


def test_marginal_predictions_fail_closed_beyond_follow_up() -> None:
    source = _draw_seeded_cohort(DeterministicRandom.from_seed(CAMPAIGN_SEED), "c")
    short = TimeGridV1(
        grid_id="q11.unit.short",
        times_ns=(SEEDED_GRID.end_ns + 3_600 * SECOND_NS,),
    )
    with pytest.raises(ContractValueError, match="inside follow-up"):
        _marginal_predictions(source, short, source)


def test_model_prediction_rows_reject_unknown_strata() -> None:
    thin = golden_hazard_model()
    with pytest.raises(ContractValueError, match="fully KNOWN"):
        _model_prediction_rows(thin)


def test_model_prediction_rows_are_monotone_cdf_rows() -> None:
    train = _draw_seeded_cohort(DeterministicRandom.from_seed(CAMPAIGN_SEED), "c")
    config = HazardModelConfigV1(
        model_version="q11.unit.model",
        grid=SEEDED_GRID,
        causes=SEEDED_CAUSES,
        smoothing=make_ratio(1, 100),
        min_risk_set=1,
    )
    rows = _model_prediction_rows(fit_discrete_hazard(train, config))
    assert set(rows) == set(SEEDED_STRATA)
    for any_event, primary in rows.values():
        assert len(any_event) == SEEDED_GRID.bin_count
        assert len(primary) == SEEDED_GRID.bin_count
        for row in (any_event, primary):
            previous = 0
            for value in row:
                assert value.mantissa >= previous
                previous = value.mantissa


def test_km_survives_the_marginal_grid() -> None:
    cohort = _draw_seeded_cohort(DeterministicRandom.from_seed(CAMPAIGN_SEED), "c")
    curve = estimate_kaplan_meier(cohort)
    for time_ns in SEEDED_GRID.times_ns:
        assert curve.survival_at(time_ns) is not None


def test_subject_helper_defaults_group_to_subject() -> None:
    built = _subject("s1", SECOND_NS, None)
    assert built.group_id == "s1"
    assert not built.is_event
    grouped = _subject("s2", SECOND_NS, "PRIMARY", group_id="g")
    assert grouped.group_id == "g"
    assert grouped.is_event


def test_require_covered_fails_closed_on_none() -> None:
    kept = FixedPointV1(1)
    assert _require_covered(kept) is kept
    with pytest.raises(ContractValueError, match="follow-up must cover"):
        _require_covered(None)


def test_fp_text_renders_mantissa_mappings_and_passes_through_the_rest() -> None:
    assert _fp_text({"mantissa": str(FIXED_POINT_SCALE // 4), "scale": "x"}) == "0.250000"
    assert _fp_text(None) == "None"
    assert _fp_text(7) == "7"


def test_main_usage_error_and_write_path(tmp_path: Path) -> None:
    assert main(["campaign"]) == 2
    target = tmp_path / "out"
    assert main(["campaign", str(target)]) == 0
    names = sorted(path.name for path in (target / "generated" / "q11").iterdir())
    assert names == [
        "survival_campaign.v1.json",
        "survival_campaign.v1.md",
        "survival_golden_v1.json",
    ]


_RUNPY_REIMPORT = "ignore:.*found in sys.modules after import.*:RuntimeWarning"


@pytest.mark.filterwarnings(_RUNPY_REIMPORT)
def test_module_main_guard_runs_under_runpy(tmp_path: Path) -> None:
    argv = sys.argv
    sys.argv = ["campaign", str(tmp_path)]
    try:
        with pytest.raises(SystemExit) as excinfo:
            runpy.run_module("quant_edge.survival.campaign", run_name="__main__")
    finally:
        sys.argv = argv
    assert excinfo.value.code == 0
    assert (tmp_path / "generated" / "q11" / "survival_golden_v1.json").exists()
