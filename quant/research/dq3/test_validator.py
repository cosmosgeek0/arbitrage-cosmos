from __future__ import annotations

import json
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest
import research.dq3 as dq3
from research.dq3 import (
    SCHEMA_V1,
    CoordinateContractError,
    PboTiePolicy,
    ResearchPhase,
    TrialAttemptV1,
    TrialSeriesCoordinatesV1,
    TrialStatus,
    build_pbo_coordinates_v1,
    build_white_max_t_coordinates_v1,
    derive_seed_v1,
    expand_white_replicate_v1,
    pbo_trial_coordinates_v1,
    validate_pbo_rank_row_v1,
    validate_statistical_coordinates_v1,
    white_trial_coordinates_v1,
)
from research.dq3.known_answer import known_answer_projection_v1

_FAMILY_ID = "family-a"
_MASTER_SEED = 20_260_730
_OBSERVATIONS = (
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-01-04",
    "2026-01-05",
    "2026-01-06",
    "2026-01-07",
    "2026-01-08",
)


def _fixture(
    *,
    gamma_status: TrialStatus = TrialStatus.FAILED,
) -> dict[str, object]:
    attempts = (
        TrialAttemptV1("trial-alpha", TrialStatus.COMPLETED),
        TrialAttemptV1("trial-beta", TrialStatus.COMPLETED),
        TrialAttemptV1("trial-gamma", gamma_status),
    )
    series = (
        TrialSeriesCoordinatesV1(
            "trial-alpha",
            ResearchPhase.DEVELOPMENT,
            _OBSERVATIONS,
        ),
        TrialSeriesCoordinatesV1(
            "trial-beta",
            ResearchPhase.DEVELOPMENT,
            _OBSERVATIONS,
        ),
        TrialSeriesCoordinatesV1(
            "trial-gamma",
            ResearchPhase.DEVELOPMENT,
            _OBSERVATIONS,
        ),
    )
    white_plan = build_white_max_t_coordinates_v1(
        family_id=_FAMILY_ID,
        master_seed=_MASTER_SEED,
        observation_ids=_OBSERVATIONS,
        block_length=2,
        replicate_count=4,
    )
    pbo_plan = build_pbo_coordinates_v1(
        family_id=_FAMILY_ID,
        observation_ids=_OBSERVATIONS,
        block_count=4,
    )
    return {
        "schema": SCHEMA_V1,
        "family_id": _FAMILY_ID,
        "phase": ResearchPhase.DEVELOPMENT,
        "master_seed": _MASTER_SEED,
        "attempts": attempts,
        "multiplicity_trial_ids": ("trial-alpha", "trial-beta", "trial-gamma"),
        "raw_pvalue_trial_ids": (
            ("trial-alpha", "trial-beta", "trial-gamma")
            if gamma_status is TrialStatus.COMPLETED
            else ("trial-alpha", "trial-beta")
        ),
        "series": series,
        "white_block_length": 2,
        "white_replicate_count": 4,
        "white_plan": white_plan,
        "white_trial_coordinates": (
            white_trial_coordinates_v1("trial-alpha", plan=white_plan),
            white_trial_coordinates_v1("trial-beta", plan=white_plan),
            white_trial_coordinates_v1("trial-gamma", plan=white_plan),
        ),
        "pbo_block_count": 4,
        "pbo_plan": pbo_plan,
        "pbo_trial_coordinates": (
            pbo_trial_coordinates_v1("trial-alpha", plan=pbo_plan),
            pbo_trial_coordinates_v1("trial-beta", plan=pbo_plan),
            pbo_trial_coordinates_v1("trial-gamma", plan=pbo_plan),
        ),
        "holdout_opened": False,
        "holdout_feedback_count": 0,
    }


def _validate(fixture: dict[str, object]) -> dq3.CoordinateReceiptV1:
    return validate_statistical_coordinates_v1(**fixture)  # type: ignore[arg-type]


def test_public_api_is_frozen() -> None:
    assert dq3.PUBLIC_API_V1 == (
        "SCHEMA_V1",
        "CoordinateContractError",
        "CoordinateReceiptV1",
        "PboCoordinatesV1",
        "PboTiePolicy",
        "PboTrialCoordinatesV1",
        "ResearchPhase",
        "TrialAttemptV1",
        "TrialSeriesCoordinatesV1",
        "TrialStatus",
        "WhiteMaxTCoordinatesV1",
        "WhiteTrialCoordinatesV1",
        "build_pbo_coordinates_v1",
        "build_white_max_t_coordinates_v1",
        "derive_seed_v1",
        "expand_white_replicate_v1",
        "pbo_trial_coordinates_v1",
        "validate_pbo_rank_row_v1",
        "validate_statistical_coordinates_v1",
        "white_trial_coordinates_v1",
    )
    assert tuple(name for name in dq3.__all__ if name != "PUBLIC_API_V1") == (dq3.PUBLIC_API_V1)


def test_seed_known_answer_and_semantic_domain_separation() -> None:
    seed = derive_seed_v1(
        _MASTER_SEED,
        family_id=_FAMILY_ID,
        phase=ResearchPhase.DEVELOPMENT,
        purpose="WHITE_MAX_T",
    )
    assert f"{seed:032x}" == "291f66e4f48ccf99bb69e47d9864df71"
    assert seed == derive_seed_v1(
        _MASTER_SEED,
        family_id=_FAMILY_ID,
        phase=ResearchPhase.DEVELOPMENT,
        purpose="WHITE_MAX_T",
    )
    assert seed != derive_seed_v1(
        _MASTER_SEED,
        family_id=_FAMILY_ID,
        phase=ResearchPhase.HOLDOUT,
        purpose="WHITE_MAX_T",
    )
    assert seed != derive_seed_v1(
        _MASTER_SEED,
        family_id=_FAMILY_ID,
        phase=ResearchPhase.DEVELOPMENT,
        purpose="WHITE_MAX_T",
        trial_id="trial-alpha",
    )


def test_frozen_known_answer_packet() -> None:
    expected = json.loads(
        Path(__file__).with_name("known_answer.v1.json").read_text(encoding="utf-8")
    )
    assert known_answer_projection_v1() == expected


def test_trial_order_is_byte_invariant() -> None:
    fixture = _fixture()
    original = _validate(fixture)
    fixture["attempts"] = tuple(reversed(fixture["attempts"]))  # type: ignore[arg-type]
    fixture["multiplicity_trial_ids"] = tuple(
        reversed(fixture["multiplicity_trial_ids"])  # type: ignore[arg-type]
    )
    fixture["raw_pvalue_trial_ids"] = tuple(
        reversed(fixture["raw_pvalue_trial_ids"])  # type: ignore[arg-type]
    )
    fixture["series"] = tuple(reversed(fixture["series"]))  # type: ignore[arg-type]
    fixture["white_trial_coordinates"] = tuple(
        reversed(fixture["white_trial_coordinates"])  # type: ignore[arg-type]
    )
    fixture["pbo_trial_coordinates"] = tuple(
        reversed(fixture["pbo_trial_coordinates"])  # type: ignore[arg-type]
    )
    reordered = _validate(fixture)
    assert reordered == original
    assert reordered.canonical_bytes() == original.canonical_bytes()


def test_white_max_t_replicates_must_remain_jointly_paired() -> None:
    fixture = _fixture()
    witnesses = fixture["white_trial_coordinates"]
    assert isinstance(witnesses, tuple)
    beta = witnesses[1]
    assert isinstance(beta, dq3.WhiteTrialCoordinatesV1)
    fixture["white_trial_coordinates"] = (
        witnesses[0],
        replace(
            beta,
            replicate_coordinate_digests=tuple(reversed(beta.replicate_coordinate_digests)),
        ),
    )
    with pytest.raises(
        CoordinateContractError,
        match="WHITE_MAX_T_PAIRING_MISMATCH",
    ):
        _validate(fixture)


def test_white_plan_expands_one_coordinate_for_all_trials() -> None:
    fixture = _fixture()
    plan = fixture["white_plan"]
    assert isinstance(plan, dq3.WhiteMaxTCoordinatesV1)
    assert len(plan.replicate_block_starts) == plan.replicate_count
    for replicate_index in range(plan.replicate_count):
        expanded = expand_white_replicate_v1(plan, replicate_index)
        assert len(expanded) == plan.sample_count
        assert all(0 <= index < plan.sample_count for index in expanded)


def test_white_expander_rejects_forged_or_malformed_plan() -> None:
    plan = _fixture()["white_plan"]
    assert isinstance(plan, dq3.WhiteMaxTCoordinatesV1)
    starts = list(plan.replicate_block_starts)
    first_row = list(starts[0])
    first_row[0] = (first_row[0] + 1) % plan.sample_count
    starts[0] = tuple(first_row)
    with pytest.raises(
        CoordinateContractError,
        match="WHITE_REPLICATE_DIGEST_MISMATCH",
    ):
        expand_white_replicate_v1(
            replace(plan, replicate_block_starts=tuple(starts)),
            0,
        )
    with pytest.raises(
        CoordinateContractError,
        match="WHITE_PLAN_GEOMETRY_INVALID",
    ):
        expand_white_replicate_v1(
            replace(plan, replicate_block_starts=()),
            0,
        )


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        (
            "multiplicity_trial_ids",
            ("trial-alpha", "trial-beta"),
            "MULTIPLICITY_FAMILY_MISMATCH",
        ),
        (
            "multiplicity_trial_ids",
            ("trial-alpha", "trial-beta", "trial-delta", "trial-gamma"),
            "MULTIPLICITY_FAMILY_MISMATCH",
        ),
        (
            "multiplicity_trial_ids",
            ("trial-alpha", "trial-alpha", "trial-beta"),
            "DUPLICATE_ID",
        ),
        (
            "raw_pvalue_trial_ids",
            ("trial-alpha", "trial-beta", "trial-gamma"),
            "RAW_PVALUE_FAMILY_MISMATCH",
        ),
    ],
)
def test_multiplicity_family_is_exact(
    field: str,
    value: tuple[str, ...],
    code: str,
) -> None:
    fixture = _fixture()
    fixture[field] = value
    with pytest.raises(CoordinateContractError, match=code):
        _validate(fixture)


def test_noncompleted_trials_are_retained_with_effective_p_one() -> None:
    receipt = _validate(_fixture())
    assert receipt.attempted_trial_ids == (
        "trial-alpha",
        "trial-beta",
        "trial-gamma",
    )
    assert receipt.raw_pvalue_trial_ids == ("trial-alpha", "trial-beta")
    assert receipt.effective_pvalue_trial_ids == receipt.attempted_trial_ids
    assert receipt.noncompleted_trial_ids == ("trial-gamma",)
    assert receipt.noncompleted_effective_pvalue == "1"
    assert receipt.pbo_evaluation_status == "UNMEASURED_INCOMPLETE_TRIAL_FAMILY"


def test_pbo_uses_complete_equal_shared_blocks_and_complements() -> None:
    fixture = _fixture()
    plan = fixture["pbo_plan"]
    assert isinstance(plan, dq3.PboCoordinatesV1)
    assert plan.block_ranges == ((0, 2), (2, 4), (4, 6), (6, 8))
    assert len(plan.splits) == 6
    assert len(set(plan.splits)) == 6
    for in_sample, out_of_sample in plan.splits:
        assert len(in_sample) == len(out_of_sample) == 2
        assert set(in_sample).isdisjoint(out_of_sample)
        assert tuple(sorted((*in_sample, *out_of_sample))) == (0, 1, 2, 3)


def test_pbo_trial_block_permutation_fails_closed() -> None:
    fixture = _fixture()
    witnesses = fixture["pbo_trial_coordinates"]
    assert isinstance(witnesses, tuple)
    beta = witnesses[1]
    assert isinstance(beta, dq3.PboTrialCoordinatesV1)
    fixture["pbo_trial_coordinates"] = (
        witnesses[0],
        replace(
            beta,
            block_coordinate_digests=tuple(reversed(beta.block_coordinate_digests)),
        ),
    )
    with pytest.raises(CoordinateContractError, match="PBO_BLOCK_GRID_MISMATCH"):
        _validate(fixture)


def test_pbo_rank_ties_and_nonfinite_values_fail_closed() -> None:
    receipt = _validate(_fixture(gamma_status=TrialStatus.COMPLETED))
    assert validate_pbo_rank_row_v1(
        {
            "trial-beta": Decimal("0.1"),
            "trial-alpha": Decimal("0.2"),
            "trial-gamma": Decimal("0.0"),
        },
        receipt=receipt,
    ) == ("trial-alpha", "trial-beta", "trial-gamma")
    with pytest.raises(CoordinateContractError, match="PBO_SCORE_FAMILY_MISMATCH"):
        validate_pbo_rank_row_v1(
            {
                "trial-alpha": Decimal("0.2"),
                "trial-beta": Decimal("0.1"),
            },
            receipt=receipt,
        )
    with pytest.raises(CoordinateContractError, match="PBO_SCORE_TIE"):
        validate_pbo_rank_row_v1(
            {
                "trial-alpha": Decimal("0.2"),
                "trial-beta": Decimal("0.2"),
                "trial-gamma": Decimal("0.0"),
            },
            receipt=receipt,
        )
    with pytest.raises(CoordinateContractError, match="PBO_SCORE_INVALID"):
        validate_pbo_rank_row_v1(
            {
                "trial-alpha": Decimal("NaN"),
                "trial-beta": Decimal("0.2"),
                "trial-gamma": Decimal("0.0"),
            },
            receipt=receipt,
        )
    with pytest.raises(CoordinateContractError, match="PBO_SCORE_INVALID"):
        validate_pbo_rank_row_v1(  # type: ignore[dict-item]
            {
                "trial-alpha": 0.1,
                "trial-beta": Decimal("0.2"),
                "trial-gamma": Decimal("0.0"),
            },
            receipt=receipt,
        )


def test_pbo_rank_is_bound_to_a_complete_intact_receipt() -> None:
    incomplete_receipt = _validate(_fixture())
    with pytest.raises(
        CoordinateContractError,
        match="PBO_UNMEASURED_INCOMPLETE_TRIAL_FAMILY",
    ):
        validate_pbo_rank_row_v1(
            {
                "trial-alpha": Decimal("0.2"),
                "trial-beta": Decimal("0.1"),
                "trial-gamma": Decimal("0.0"),
            },
            receipt=incomplete_receipt,
        )

    complete_receipt = _validate(_fixture(gamma_status=TrialStatus.COMPLETED))
    with pytest.raises(CoordinateContractError, match="RECEIPT_DIGEST_MISMATCH"):
        validate_pbo_rank_row_v1(
            {
                "trial-alpha": Decimal("0.2"),
                "trial-beta": Decimal("0.1"),
                "trial-gamma": Decimal("0.0"),
            },
            receipt=replace(complete_receipt, receipt_digest="0" * 64),
        )


def test_asynchronous_or_duplicate_observation_grids_fail_closed() -> None:
    fixture = _fixture()
    series = fixture["series"]
    assert isinstance(series, tuple)
    beta = series[1]
    assert isinstance(beta, TrialSeriesCoordinatesV1)
    fixture["series"] = (
        series[0],
        replace(beta, observation_ids=tuple(reversed(_OBSERVATIONS))),
        series[2],
    )
    with pytest.raises(
        CoordinateContractError,
        match="ASYNCHRONOUS_OBSERVATION_GRID",
    ):
        _validate(fixture)

    fixture = _fixture()
    series = fixture["series"]
    assert isinstance(series, tuple)
    alpha = series[0]
    assert isinstance(alpha, TrialSeriesCoordinatesV1)
    fixture["series"] = (
        replace(
            alpha,
            observation_ids=(*_OBSERVATIONS[:-1], _OBSERVATIONS[-2]),
        ),
        series[1],
        series[2],
    )
    with pytest.raises(CoordinateContractError, match="DUPLICATE_ID"):
        _validate(fixture)


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("schema", "cosmos.dq3.statistical-coordinates.v2", "SCHEMA_INVALID"),
        ("phase", ResearchPhase.HOLDOUT, "HOLDOUT_COORDINATE_FORBIDDEN"),
        ("holdout_opened", True, "HOLDOUT_ALREADY_OPEN"),
        ("holdout_opened", 1, "HOLDOUT_STATE_INVALID"),
        ("holdout_feedback_count", 1, "INTEGER_OUT_OF_RANGE"),
        ("master_seed", True, "INTEGER_INVALID"),
    ],
)
def test_top_level_fail_closed_cases(field: str, value: object, code: str) -> None:
    fixture = _fixture()
    fixture[field] = value
    with pytest.raises(CoordinateContractError, match=code):
        _validate(fixture)


@pytest.mark.parametrize("coordinate_family", ["series", "white", "pbo"])
def test_any_holdout_coordinate_is_rejected(coordinate_family: str) -> None:
    fixture = _fixture()
    if coordinate_family == "series":
        items = fixture["series"]
        assert isinstance(items, tuple)
        assert isinstance(items[0], TrialSeriesCoordinatesV1)
        fixture["series"] = (
            replace(items[0], phase=ResearchPhase.HOLDOUT),
            items[1],
            items[2],
        )
    elif coordinate_family == "white":
        items = fixture["white_trial_coordinates"]
        assert isinstance(items, tuple)
        assert isinstance(items[0], dq3.WhiteTrialCoordinatesV1)
        fixture["white_trial_coordinates"] = (
            replace(items[0], phase=ResearchPhase.HOLDOUT),
            items[1],
            items[2],
        )
    else:
        items = fixture["pbo_trial_coordinates"]
        assert isinstance(items, tuple)
        assert isinstance(items[0], dq3.PboTrialCoordinatesV1)
        fixture["pbo_trial_coordinates"] = (
            replace(items[0], phase=ResearchPhase.HOLDOUT),
            items[1],
            items[2],
        )
    with pytest.raises(
        CoordinateContractError,
        match="HOLDOUT_COORDINATE_FORBIDDEN",
    ):
        _validate(fixture)


def test_invalid_pbo_geometry_fails_closed() -> None:
    with pytest.raises(CoordinateContractError, match="PBO_BLOCK_COUNT_INVALID"):
        build_pbo_coordinates_v1(
            family_id=_FAMILY_ID,
            observation_ids=_OBSERVATIONS,
            block_count=5,
        )
    with pytest.raises(CoordinateContractError, match="PBO_BLOCK_GRID_INVALID"):
        build_pbo_coordinates_v1(
            family_id=_FAMILY_ID,
            observation_ids=_OBSERVATIONS,
            block_count=6,
        )
    with pytest.raises(CoordinateContractError, match="PBO_TIE_POLICY_INVALID"):
        build_pbo_coordinates_v1(
            family_id=_FAMILY_ID,
            observation_ids=_OBSERVATIONS,
            block_count=4,
            tie_policy="AVERAGE",  # type: ignore[arg-type]
        )
    assert _fixture()["pbo_plan"].tie_policy is PboTiePolicy.FAIL_CLOSED  # type: ignore[union-attr]


def test_forged_plan_and_incomplete_witnesses_fail_closed() -> None:
    fixture = _fixture()
    plan = fixture["white_plan"]
    assert isinstance(plan, dq3.WhiteMaxTCoordinatesV1)
    fixture["white_plan"] = replace(plan, coordinate_digest="0" * 64)
    with pytest.raises(CoordinateContractError, match="WHITE_PLAN_MISMATCH"):
        _validate(fixture)

    fixture = _fixture()
    witnesses = fixture["pbo_trial_coordinates"]
    assert isinstance(witnesses, tuple)
    fixture["pbo_trial_coordinates"] = witnesses[:1]
    with pytest.raises(CoordinateContractError, match="PBO_FAMILY_MISMATCH"):
        _validate(fixture)
