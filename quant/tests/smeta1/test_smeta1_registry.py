from __future__ import annotations

import hashlib
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

import quant_edge.smeta1 as smeta1
from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.smeta1.registry import (
    EXPECTED_ATTEMPT_COUNTS,
    EXPECTED_FAMILIES,
    EXPECTED_HOLM_THRESHOLDS,
    FAMILYWISE_ALPHA,
    MAX_DRAWDOWN_BPS,
    RANKING_EXPOSURE_SECONDS,
    RANKING_LCB_UNIT,
    RANKING_NOTIONAL_USD_CENTS,
    REGISTRY_FROZEN_AT_UTC,
    REQUIRED_CONFIRMATION_GATES,
    REQUIRED_FAMILY_GATES,
    REQUIRED_FEE_SCENARIOS,
    SIMULTANEOUS_LCB_ALPHA,
    FamilyAssessmentV1,
    FamilyDecisionState,
    GateState,
    N3Verdict,
    SMeta1RegistryV1,
    WinnerConfirmationV1,
    WithinFamilyProcedure,
    assessment_set_sha256,
    attempt_ledger_bytes,
    bootstrap_plus_one_p,
    candidate_universe_sha256_from_attempts,
    evaluate_n3,
    family_holdout_authorization_sha256,
    holdout_integrity_failure_sha256,
    holdout_measured_result_bytes,
    holdout_open_sha256,
    holdout_result_sha256,
    load_registry,
    pbo_diagnostic_receipt_bytes,
    prior_period_inventory_sha256,
    ranking_normalization_sha256,
    terminal_family_failure_sha256,
    winner_authorization_sha256,
)

QUANT_ROOT = Path(__file__).parents[2]
FIXTURE_ROOT = Path(__file__).parent / "fixtures"
REGISTRY_PATH = FIXTURE_ROOT / "smeta1_profitability_evidence_registry.v1.json"
RECEIPT_PATH = FIXTURE_ROOT / "freeze_receipt.v1.json"
ORIGINAL_DONOR_TEST_SHA256 = "0525e7d163d0acc39c372759c9d87d464eb49201fede298e141df3661613408f"
FAMILY_A = EXPECTED_FAMILIES[3]
FAMILY_B = EXPECTED_FAMILIES[4]
CANDIDATE_A = "a" * 64
CANDIDATE_B = "b" * 64
CODE_CONFIG_A = "9" * 64
CODE_CONFIG_B = "8" * 64
LEDGER_FROZEN = "2026-07-28T16:20:00Z"
FAMILY_CANDIDATE_LOCKED = "2026-07-28T16:30:00Z"
PBO_COMPUTED_AT = "2026-07-28T16:35:00Z"
FAMILY_AUTHORIZED_AT = "2026-07-28T16:40:00Z"
FAMILY_SCREENED_END = "2026-07-28T15:00:00Z"
FAMILY_PERIOD_START = "2026-07-28T17:00:00Z"
FAMILY_PERIOD_END = "2026-07-28T21:00:00Z"
FIRST_OUTCOME_ACCESS = "2026-07-28T22:00:00Z"
TERMINAL_EVIDENCE_AT = "2026-07-28T23:00:00Z"
WINNER_LOCKED_AT = "2026-07-28T23:30:00Z"
FRESH_AUTHORIZED_AT = "2026-07-28T23:45:00Z"
FRESH_SCREENED_END = "2026-07-28T22:00:00Z"
FRESH_PERIOD_START = "2026-07-29T00:00:00Z"
FRESH_PERIOD_END = "2026-07-29T01:00:00Z"
FRESH_OPENED_AT = "2026-07-29T01:05:00Z"
FRESH_RESULT_AT = "2026-07-29T01:10:00Z"
HOLDOUT_EMBARGO_SECONDS = 3_600
MINIMUM_SAMPLES = 100
OBSERVED_SAMPLES = 120
BLOCK_LENGTH_SAMPLES = 10
BLOCK_COUNT_FLOOR = 5
EFFECTIVE_BLOCK_COUNT = 10


def _gates(
    names: tuple[str, ...],
    default: GateState = GateState.PASS,
    **overrides: GateState,
) -> tuple[tuple[str, GateState], ...]:
    return tuple((name, overrides.get(name, default)) for name in names)


def _no_go(family_id: str) -> FamilyAssessmentV1:
    if EXPECTED_ATTEMPT_COUNTS[family_id] is None:
        return _unknown(family_id)
    is_active = family_id in EXPECTED_FAMILIES[3:]
    terminal_bytes: bytes | None
    terminal_bytes_sha256: str | None
    terminal_receipt_sha256: str | None
    gates = _gates(
        REQUIRED_FAMILY_GATES,
        ADMISSIBLE_EVIDENCE=GateState.FAIL,
    )
    terminal_reason_code = "CONCLUSIVE_GATE_FAILURE" if is_active else "FROZEN_INADMISSIBLE_OR_STOP"
    if is_active:
        measured = _qualifying(
            family_id,
            lcb=0,
            null_exceedances=102,
            attempted_count=(2 if EXPECTED_ATTEMPT_COUNTS[family_id] is None else None),
        )
        terminal_bytes = holdout_measured_result_bytes(
            scope="FAMILY",
            family_id=family_id,
            authorization_receipt_sha256=cast(
                str,
                measured.family_holdout_authorization_receipt_sha256,
            ),
            candidate_sha256=cast(str, measured.candidate_sha256),
            candidate_code_config_sha256=cast(
                str,
                measured.candidate_code_config_sha256,
            ),
            open_receipt_sha256=cast(
                str,
                measured.family_holdout_open_receipt_sha256,
            ),
            inference_procedure=cast(
                WithinFamilyProcedure,
                measured.within_family_procedure,
            ).value,
            inference_config_sha256=cast(
                str,
                measured.within_family_inference_receipt_sha256,
            ),
            pbo_receipt_sha256=measured.pbo_receipt_sha256,
            result_at_utc=cast(str, measured.family_holdout_result_at_utc),
            fee_evidence_sha256=cast(str, measured.fee_evidence_sha256),
            execution_capacity_law_sha256=cast(
                str,
                measured.family_execution_capacity_law_sha256,
            ),
            execution_capacity_drawdown_evidence_sha256=cast(
                str,
                measured.execution_capacity_drawdown_evidence_sha256,
            ),
            chronological_blocks_sha256=cast(
                str,
                measured.chronological_blocks_sha256,
            ),
            bootstrap_replicates=cast(int, measured.bootstrap_replicates),
            required_scenario_null_exceedances=(measured.required_scenario_null_exceedances),
            required_scenario_p_values=measured.required_scenario_p_values,
            raw_p_value=cast(ExactRatioV1, measured.raw_family_p_value),
            lcb_alpha=cast(ExactRatioV1, measured.simultaneous_lcb_alpha),
            required_scenario_lcbs=(measured.required_scenario_capacity_capped_lcb_microusd),
            aggregate_lcb=cast(
                int,
                measured.capacity_capped_simultaneous_lcb_microusd,
            ),
            observed_sample_count=cast(
                int,
                measured.family_holdout_observed_sample_count,
            ),
            effective_block_count=cast(
                int,
                measured.family_holdout_effective_block_count,
            ),
            stress_drawdown_bps=cast(int, measured.stress_drawdown_bps),
            capacity_utilization_bps=cast(int, measured.capacity_utilization_bps),
            fallback_used=False,
            post_open_mutation=cast(bool, measured.family_post_open_mutation),
            reused_screened_period=cast(
                bool,
                measured.family_reused_screened_period,
            ),
            tested_candidate_count=cast(
                int,
                measured.family_holdout_tested_candidate_count,
            ),
            result_state=FamilyDecisionState.NO_GO.value,
            gates=gates,
        )
        terminal_bytes_sha256 = hashlib.sha256(terminal_bytes).hexdigest()
        result_receipt_sha256 = holdout_result_sha256(
            scope="FAMILY",
            candidate_sha256=cast(str, measured.candidate_sha256),
            candidate_code_config_sha256=cast(
                str,
                measured.candidate_code_config_sha256,
            ),
            open_receipt_sha256=cast(
                str,
                measured.family_holdout_open_receipt_sha256,
            ),
            inference_procedure=cast(
                WithinFamilyProcedure,
                measured.within_family_procedure,
            ).value,
            inference_config_sha256=cast(
                str,
                measured.within_family_inference_receipt_sha256,
            ),
            pbo_receipt_sha256=measured.pbo_receipt_sha256,
            result_bytes_sha256=terminal_bytes_sha256,
            result_at_utc=cast(str, measured.family_holdout_result_at_utc),
            fee_evidence_sha256=cast(str, measured.fee_evidence_sha256),
            execution_capacity_law_sha256=cast(
                str,
                measured.family_execution_capacity_law_sha256,
            ),
            execution_capacity_drawdown_evidence_sha256=cast(
                str,
                measured.execution_capacity_drawdown_evidence_sha256,
            ),
            chronological_blocks_sha256=cast(
                str,
                measured.chronological_blocks_sha256,
            ),
            bootstrap_replicates=cast(int, measured.bootstrap_replicates),
            required_scenario_null_exceedances=(measured.required_scenario_null_exceedances),
            required_scenario_p_values=measured.required_scenario_p_values,
            raw_p_value=cast(ExactRatioV1, measured.raw_family_p_value),
            lcb_alpha=cast(ExactRatioV1, measured.simultaneous_lcb_alpha),
            required_scenario_lcbs=(measured.required_scenario_capacity_capped_lcb_microusd),
            aggregate_lcb=cast(
                int,
                measured.capacity_capped_simultaneous_lcb_microusd,
            ),
            observed_sample_count=cast(
                int,
                measured.family_holdout_observed_sample_count,
            ),
            effective_block_count=cast(
                int,
                measured.family_holdout_effective_block_count,
            ),
            stress_drawdown_bps=cast(int, measured.stress_drawdown_bps),
            capacity_utilization_bps=cast(int, measured.capacity_utilization_bps),
            fallback_used=False,
            post_open_mutation=cast(bool, measured.family_post_open_mutation),
            reused_screened_period=cast(
                bool,
                measured.family_reused_screened_period,
            ),
            tested_candidate_count=cast(
                int,
                measured.family_holdout_tested_candidate_count,
            ),
            result_state=FamilyDecisionState.NO_GO.value,
            gates=gates,
        )
        terminal_receipt_sha256 = terminal_family_failure_sha256(
            family_id=family_id,
            attempted_hypothesis_count=cast(
                int,
                measured.attempted_hypothesis_count,
            ),
            attempt_ledger_sha256=cast(str, measured.attempt_ledger_sha256),
            attempt_ledger_frozen_at_utc=cast(
                str,
                measured.attempt_ledger_frozen_at_utc,
            ),
            first_outcome_access_at_utc=cast(
                str,
                measured.first_outcome_access_at_utc,
            ),
            terminal_reason_code=terminal_reason_code,
            gates=gates,
            terminal_evidence_bytes_sha256=terminal_bytes_sha256,
            terminal_evidence_at_utc=cast(
                str,
                measured.terminal_evidence_at_utc,
            ),
        )
        return replace(
            measured,
            decision_state=FamilyDecisionState.NO_GO,
            gates=gates,
            terminal_reason_code=terminal_reason_code,
            family_holdout_result_bytes_sha256=terminal_bytes_sha256,
            family_holdout_receipt_sha256=result_receipt_sha256,
            terminal_evidence_bytes=terminal_bytes,
            terminal_evidence_bytes_sha256=terminal_bytes_sha256,
            terminal_evidence_receipt_sha256=terminal_receipt_sha256,
        )
    attempted_count = (
        (EXPECTED_ATTEMPT_COUNTS[family_id] or 1)
        if is_active
        else EXPECTED_ATTEMPT_COUNTS[family_id]
    )
    terminal_bytes = None
    terminal_bytes_sha256 = None
    terminal_receipt_sha256 = None
    return FamilyAssessmentV1(
        family_id=family_id,
        terminal=True,
        decision_state=FamilyDecisionState.NO_GO,
        gates=gates,
        terminal_reason_code=terminal_reason_code,
        candidate_sha256=None,
        candidate_code_config_sha256=None,
        candidate_universe_sha256=None,
        candidate_locked_at_utc=None,
        attempted_hypothesis_count=attempted_count,
        attempt_ledger_bytes=None,
        attempt_ledger_sha256="c" * 64 if is_active else None,
        attempt_ledger_frozen_at_utc=LEDGER_FROZEN if is_active else None,
        first_outcome_access_at_utc=FIRST_OUTCOME_ACCESS if is_active else None,
        within_family_procedure=None,
        within_family_inference_receipt_sha256=None,
        chronological_blocks_sha256=None,
        bootstrap_replicates=None,
        required_scenario_unadjusted_min_p_values=(),
        required_scenario_null_exceedances=(),
        required_scenario_p_values=(),
        raw_family_p_value=None,
        simultaneous_lcb_alpha=None,
        required_scenario_capacity_capped_lcb_microusd=(),
        capacity_capped_simultaneous_lcb_microusd=None,
        fee_evidence_sha256=None,
        family_execution_capacity_law_sha256=None,
        execution_capacity_drawdown_evidence_sha256=None,
        pbo_receipt_bytes=None,
        pbo_receipt_sha256=None,
        family_holdout_authorization_receipt_sha256=None,
        family_holdout_authorized_at_utc=None,
        family_holdout_dataset_sha256=None,
        family_holdout_period_start_utc=None,
        family_holdout_period_end_utc=None,
        family_screened_period_end_utc=None,
        family_holdout_embargo_seconds=None,
        family_prior_period_expanded_intervals=(),
        family_prior_period_inventory_sha256=None,
        family_holdout_open_receipt_sha256=None,
        family_holdout_opened_at_utc=None,
        family_holdout_open_count=None,
        family_holdout_minimum_sample_count=None,
        family_holdout_observed_sample_count=None,
        family_holdout_tested_candidate_count=None,
        family_holdout_block_length_samples=None,
        family_holdout_block_count_floor=None,
        family_holdout_block_seed_sha256=None,
        family_holdout_effective_block_count=None,
        family_post_open_mutation=None,
        family_reused_screened_period=None,
        family_holdout_result_bytes_sha256=None,
        family_holdout_receipt_sha256=None,
        family_holdout_result_at_utc=None,
        ranking_lcb_unit=None,
        ranking_exposure_seconds=None,
        ranking_notional_usd_cents=None,
        ranking_normalization_receipt_sha256=None,
        terminal_evidence_bytes=terminal_bytes,
        terminal_evidence_bytes_sha256=terminal_bytes_sha256,
        terminal_evidence_receipt_sha256=terminal_receipt_sha256,
        terminal_evidence_at_utc=TERMINAL_EVIDENCE_AT if is_active else None,
        stress_drawdown_bps=None,
        capacity_utilization_bps=None,
    )


def _unknown(family_id: str) -> FamilyAssessmentV1:
    return FamilyAssessmentV1(
        family_id=family_id,
        terminal=False,
        decision_state=FamilyDecisionState.UNKNOWN,
        gates=_gates(REQUIRED_FAMILY_GATES, GateState.UNKNOWN),
        terminal_reason_code="UNRESOLVED",
        candidate_sha256=None,
        candidate_code_config_sha256=None,
        candidate_universe_sha256=None,
        candidate_locked_at_utc=None,
        attempted_hypothesis_count=None,
        attempt_ledger_bytes=None,
        attempt_ledger_sha256=None,
        attempt_ledger_frozen_at_utc=None,
        first_outcome_access_at_utc=None,
        within_family_procedure=None,
        within_family_inference_receipt_sha256=None,
        chronological_blocks_sha256=None,
        bootstrap_replicates=None,
        required_scenario_unadjusted_min_p_values=(),
        required_scenario_null_exceedances=(),
        required_scenario_p_values=(),
        raw_family_p_value=None,
        simultaneous_lcb_alpha=None,
        required_scenario_capacity_capped_lcb_microusd=(),
        capacity_capped_simultaneous_lcb_microusd=None,
        fee_evidence_sha256=None,
        family_execution_capacity_law_sha256=None,
        execution_capacity_drawdown_evidence_sha256=None,
        pbo_receipt_bytes=None,
        pbo_receipt_sha256=None,
        family_holdout_authorization_receipt_sha256=None,
        family_holdout_authorized_at_utc=None,
        family_holdout_dataset_sha256=None,
        family_holdout_period_start_utc=None,
        family_holdout_period_end_utc=None,
        family_screened_period_end_utc=None,
        family_holdout_embargo_seconds=None,
        family_prior_period_expanded_intervals=(),
        family_prior_period_inventory_sha256=None,
        family_holdout_open_receipt_sha256=None,
        family_holdout_opened_at_utc=None,
        family_holdout_open_count=None,
        family_holdout_minimum_sample_count=None,
        family_holdout_observed_sample_count=None,
        family_holdout_tested_candidate_count=None,
        family_holdout_block_length_samples=None,
        family_holdout_block_count_floor=None,
        family_holdout_block_seed_sha256=None,
        family_holdout_effective_block_count=None,
        family_post_open_mutation=None,
        family_reused_screened_period=None,
        family_holdout_result_bytes_sha256=None,
        family_holdout_receipt_sha256=None,
        family_holdout_result_at_utc=None,
        ranking_lcb_unit=None,
        ranking_exposure_seconds=None,
        ranking_notional_usd_cents=None,
        ranking_normalization_receipt_sha256=None,
        terminal_evidence_bytes=None,
        terminal_evidence_bytes_sha256=None,
        terminal_evidence_receipt_sha256=None,
        terminal_evidence_at_utc=None,
        stress_drawdown_bps=None,
        capacity_utilization_bps=None,
    )


def _pbo_evidence(
    *,
    family_id: str,
    candidate: str,
    code_config: str,
    attempt_rows: tuple[tuple[str, str, str], ...],
    attempt_ledger_bytes_value: bytes,
    attempt_ledger_sha256_value: str,
    inference_receipt_sha256: str,
    family_screened_end: str,
    fee_sha256: str,
    execution_law_sha256: str,
    candidate_locked_at: str,
    mode: str,
) -> bytes:
    trial_ids = tuple(row[0] for row in attempt_rows)
    block_ids = ("BLOCK_0000", "BLOCK_0001", "BLOCK_0002", "BLOCK_0003")
    if mode == "ROBUST":
        score_matrix = tuple(
            tuple(100 * index + block for block in range(len(block_ids)))
            for index in range(len(attempt_rows))
        )
    elif mode == "OVERFIT":
        score_matrix = tuple(
            (10, 10, -10, -10) if index % 2 == 0 else (-10, -10, 10, 10)
            for index in range(len(attempt_rows))
        )
    else:
        raise AssertionError("unsupported synthetic PBO mode")
    return pbo_diagnostic_receipt_bytes(
        family_id=family_id,
        candidate_sha256=candidate,
        candidate_code_config_sha256=code_config,
        candidate_locked_at_utc=candidate_locked_at,
        selected_trial_id=trial_ids[-1],
        attempt_ledger_bytes_value=attempt_ledger_bytes_value,
        attempt_ledger_sha256=attempt_ledger_sha256_value,
        within_family_inference_receipt_sha256=inference_receipt_sha256,
        pbo_chronological_blocks_sha256="6" * 64,
        screened_period_end_utc=family_screened_end,
        fee_evidence_sha256=fee_sha256,
        execution_capacity_law_sha256=execution_law_sha256,
        trial_ids=trial_ids,
        block_ids=block_ids,
        score_matrix=score_matrix,
        computed_at_utc=PBO_COMPUTED_AT,
    )


def _synthetic_attempt_rows(
    *,
    family_id: str,
    count: int,
    selected_candidate: str,
    selected_code_config: str,
) -> tuple[tuple[str, str, str], ...]:
    return tuple(
        (
            f"TRIAL_{index:04d}",
            (
                selected_candidate
                if index == count - 1
                else hashlib.sha256(f"{family_id}:candidate:{index}".encode()).hexdigest()
            ),
            (
                selected_code_config
                if index == count - 1
                else hashlib.sha256(f"{family_id}:code-config:{index}".encode()).hexdigest()
            ),
        )
        for index in range(count)
    )


def _direct_pbo_from_attempt_rows(
    attempt_rows: tuple[tuple[str, str, str], ...],
    *,
    candidate: str = CANDIDATE_A,
    code_config: str = CODE_CONFIG_A,
    matrix_trial_ids: tuple[str, ...] | None = None,
    selected_trial_id: str | None = None,
) -> bytes:
    ledger_bytes = attempt_ledger_bytes(
        family_id=FAMILY_A,
        frozen_at_utc=LEDGER_FROZEN,
        trials=attempt_rows,
    )
    trial_ids = (
        tuple(row[0] for row in attempt_rows) if matrix_trial_ids is None else matrix_trial_ids
    )
    block_ids = ("BLOCK_0000", "BLOCK_0001", "BLOCK_0002", "BLOCK_0003")
    return pbo_diagnostic_receipt_bytes(
        family_id=FAMILY_A,
        candidate_sha256=candidate,
        candidate_code_config_sha256=code_config,
        candidate_locked_at_utc=FAMILY_CANDIDATE_LOCKED,
        selected_trial_id=(attempt_rows[-1][0] if selected_trial_id is None else selected_trial_id),
        attempt_ledger_bytes_value=ledger_bytes,
        attempt_ledger_sha256=hashlib.sha256(ledger_bytes).hexdigest(),
        within_family_inference_receipt_sha256="1" * 64,
        pbo_chronological_blocks_sha256="6" * 64,
        screened_period_end_utc=FAMILY_SCREENED_END,
        fee_evidence_sha256="3" * 64,
        execution_capacity_law_sha256="b" * 64,
        trial_ids=trial_ids,
        block_ids=block_ids,
        score_matrix=tuple(
            tuple(index * 100 + block for block in range(len(block_ids)))
            for index in range(len(trial_ids))
        ),
        computed_at_utc=PBO_COMPUTED_AT,
    )


def _qualifying(
    family_id: str = FAMILY_A,
    *,
    lcb: int = 100,
    drawdown_bps: int = 1_000,
    utilization_bps: int = 5_000,
    candidate: str = CANDIDATE_A,
    code_config: str = CODE_CONFIG_A,
    gates: tuple[tuple[str, GateState], ...] | None = None,
    procedure: WithinFamilyProcedure = WithinFamilyProcedure.HANSEN_SPA,
    null_exceedances: int = 13,
    attempted_count: int | None = None,
    ledger_frozen_at: str | None = LEDGER_FROZEN,
    first_outcome_access_at: str = FIRST_OUTCOME_ACCESS,
    candidate_locked_at: str = FAMILY_CANDIDATE_LOCKED,
    family_authorized_at: str = FAMILY_AUTHORIZED_AT,
    family_period_start: str = FAMILY_PERIOD_START,
    family_period_end: str = FAMILY_PERIOD_END,
    family_screened_end: str = FAMILY_SCREENED_END,
    family_open_count: int = 1,
    family_tested_candidate_count: int = 1,
    family_post_open_mutation: bool = False,
    family_reused_screened_period: bool = False,
    observed_samples: int = OBSERVED_SAMPLES,
    effective_blocks: int = EFFECTIVE_BLOCK_COUNT,
    pbo_mode: str = "ROBUST",
) -> FamilyAssessmentV1:
    count = (
        attempted_count if attempted_count is not None else EXPECTED_ATTEMPT_COUNTS[family_id] or 1
    )
    gates_value = _gates(REQUIRED_FAMILY_GATES) if gates is None else gates
    raw = bootstrap_plus_one_p(null_exceedances)
    if procedure is WithinFamilyProcedure.BONFERRONI_ALL_ATTEMPTS:
        adjusted_numerator = min(raw.denominator, count * raw.numerator)
        adjusted = make_ratio(adjusted_numerator, raw.denominator)
        raw_minima = tuple((scenario_id, raw) for scenario_id in REQUIRED_FEE_SCENARIOS)
    else:
        adjusted = raw
        raw_minima = ()
    exceedances = tuple((scenario_id, null_exceedances) for scenario_id in REQUIRED_FEE_SCENARIOS)
    scenario_p_values = tuple((scenario_id, adjusted) for scenario_id in REQUIRED_FEE_SCENARIOS)
    scenario_lcbs = tuple((scenario_id, lcb) for scenario_id in REQUIRED_FEE_SCENARIOS)
    lcb_alpha = make_ratio(
        SIMULTANEOUS_LCB_ALPHA.numerator,
        SIMULTANEOUS_LCB_ALPHA.denominator,
    )
    attempt_rows = _synthetic_attempt_rows(
        family_id=family_id,
        count=count,
        selected_candidate=candidate,
        selected_code_config=code_config,
    )
    attempt_ledger_bytes_value = attempt_ledger_bytes(
        family_id=family_id,
        frozen_at_utc=ledger_frozen_at or LEDGER_FROZEN,
        trials=attempt_rows,
    )
    attempt_ledger_sha256 = hashlib.sha256(attempt_ledger_bytes_value).hexdigest()
    candidate_universe_sha256 = candidate_universe_sha256_from_attempts(attempt_rows)
    holdout_dataset_sha256 = "f" * 64
    prior_period_intervals = (
        ("ALL_SCREENED_PERIODS", "2026-07-01T00:00:00Z", family_screened_end),
    )
    prior_inventory_sha256 = prior_period_inventory_sha256(prior_period_intervals)
    blocks_sha256 = "2" * 64
    block_seed_sha256 = "8" * 64
    fee_sha256 = "3" * 64
    execution_law_sha256 = "b" * 64
    execution_evidence_sha256 = "4" * 64
    inference_receipt_sha256 = "1" * 64
    pbo_receipt_bytes = _pbo_evidence(
        family_id=family_id,
        candidate=candidate,
        code_config=code_config,
        attempt_rows=attempt_rows,
        attempt_ledger_bytes_value=attempt_ledger_bytes_value,
        attempt_ledger_sha256_value=attempt_ledger_sha256,
        inference_receipt_sha256=inference_receipt_sha256,
        family_screened_end=family_screened_end,
        fee_sha256=fee_sha256,
        execution_law_sha256=execution_law_sha256,
        candidate_locked_at=candidate_locked_at,
        mode=pbo_mode,
    )
    pbo_receipt_sha256 = hashlib.sha256(pbo_receipt_bytes).hexdigest()
    authorization_sha256 = family_holdout_authorization_sha256(
        family_id=family_id,
        candidate_sha256=candidate,
        candidate_code_config_sha256=code_config,
        candidate_universe_sha256=candidate_universe_sha256,
        candidate_locked_at_utc=candidate_locked_at,
        within_family_procedure=procedure.value,
        within_family_inference_receipt_sha256=inference_receipt_sha256,
        pbo_receipt_sha256=pbo_receipt_sha256,
        attempted_hypothesis_count=count,
        attempt_ledger_sha256=attempt_ledger_sha256,
        holdout_dataset_sha256=holdout_dataset_sha256,
        holdout_period_start_utc=family_period_start,
        holdout_period_end_utc=family_period_end,
        screened_period_end_utc=family_screened_end,
        embargo_seconds=HOLDOUT_EMBARGO_SECONDS,
        prior_period_inventory_sha256=prior_inventory_sha256,
        chronological_blocks_sha256=blocks_sha256,
        block_seed_sha256=block_seed_sha256,
        fee_evidence_sha256=fee_sha256,
        execution_capacity_law_sha256=execution_law_sha256,
        minimum_sample_count=MINIMUM_SAMPLES,
        block_length_samples=BLOCK_LENGTH_SAMPLES,
        block_count_floor=BLOCK_COUNT_FLOOR,
        ranking_lcb_unit=RANKING_LCB_UNIT,
        ranking_exposure_seconds=RANKING_EXPOSURE_SECONDS,
        ranking_notional_usd_cents=RANKING_NOTIONAL_USD_CENTS,
        bootstrap_replicates=4_096,
        authorized_at_utc=family_authorized_at,
    )
    open_sha256 = holdout_open_sha256(
        authorization_receipt_sha256=authorization_sha256,
        holdout_dataset_sha256=holdout_dataset_sha256,
        opened_at_utc=first_outcome_access_at,
        open_count=family_open_count,
    )
    result_bytes = holdout_measured_result_bytes(
        scope="FAMILY",
        family_id=family_id,
        authorization_receipt_sha256=authorization_sha256,
        candidate_sha256=candidate,
        candidate_code_config_sha256=code_config,
        open_receipt_sha256=open_sha256,
        inference_procedure=procedure.value,
        inference_config_sha256=inference_receipt_sha256,
        pbo_receipt_sha256=pbo_receipt_sha256,
        result_at_utc=TERMINAL_EVIDENCE_AT,
        fee_evidence_sha256=fee_sha256,
        execution_capacity_law_sha256=execution_law_sha256,
        execution_capacity_drawdown_evidence_sha256=execution_evidence_sha256,
        chronological_blocks_sha256=blocks_sha256,
        bootstrap_replicates=4_096,
        required_scenario_null_exceedances=exceedances,
        required_scenario_p_values=scenario_p_values,
        raw_p_value=adjusted,
        lcb_alpha=lcb_alpha,
        required_scenario_lcbs=scenario_lcbs,
        aggregate_lcb=lcb,
        observed_sample_count=observed_samples,
        effective_block_count=effective_blocks,
        stress_drawdown_bps=drawdown_bps,
        capacity_utilization_bps=utilization_bps,
        fallback_used=False,
        post_open_mutation=family_post_open_mutation,
        reused_screened_period=family_reused_screened_period,
        tested_candidate_count=family_tested_candidate_count,
        result_state=FamilyDecisionState.QUALIFYING.value,
        gates=gates_value,
    )
    result_bytes_sha256 = hashlib.sha256(result_bytes).hexdigest()
    result_sha256 = holdout_result_sha256(
        scope="FAMILY",
        candidate_sha256=candidate,
        candidate_code_config_sha256=code_config,
        open_receipt_sha256=open_sha256,
        inference_procedure=procedure.value,
        inference_config_sha256=inference_receipt_sha256,
        pbo_receipt_sha256=pbo_receipt_sha256,
        result_bytes_sha256=result_bytes_sha256,
        result_at_utc=TERMINAL_EVIDENCE_AT,
        fee_evidence_sha256=fee_sha256,
        execution_capacity_law_sha256=execution_law_sha256,
        execution_capacity_drawdown_evidence_sha256=execution_evidence_sha256,
        chronological_blocks_sha256=blocks_sha256,
        bootstrap_replicates=4_096,
        required_scenario_null_exceedances=exceedances,
        required_scenario_p_values=scenario_p_values,
        raw_p_value=adjusted,
        lcb_alpha=lcb_alpha,
        required_scenario_lcbs=scenario_lcbs,
        aggregate_lcb=lcb,
        observed_sample_count=observed_samples,
        effective_block_count=effective_blocks,
        stress_drawdown_bps=drawdown_bps,
        capacity_utilization_bps=utilization_bps,
        fallback_used=False,
        post_open_mutation=family_post_open_mutation,
        reused_screened_period=family_reused_screened_period,
        tested_candidate_count=family_tested_candidate_count,
        result_state=FamilyDecisionState.QUALIFYING.value,
        gates=gates_value,
    )
    normalization_sha256 = ranking_normalization_sha256(
        required_scenario_lcbs=scenario_lcbs,
        ranking_lcb_unit=RANKING_LCB_UNIT,
        ranking_exposure_seconds=RANKING_EXPOSURE_SECONDS,
        ranking_notional_usd_cents=RANKING_NOTIONAL_USD_CENTS,
    )
    return FamilyAssessmentV1(
        family_id=family_id,
        terminal=True,
        decision_state=FamilyDecisionState.QUALIFYING,
        gates=gates_value,
        terminal_reason_code="SELECTION_ADJUSTED_CANDIDATE",
        candidate_sha256=candidate,
        candidate_code_config_sha256=code_config,
        candidate_universe_sha256=candidate_universe_sha256,
        candidate_locked_at_utc=candidate_locked_at,
        attempted_hypothesis_count=count,
        attempt_ledger_bytes=attempt_ledger_bytes_value,
        attempt_ledger_sha256=attempt_ledger_sha256,
        attempt_ledger_frozen_at_utc=ledger_frozen_at,
        first_outcome_access_at_utc=first_outcome_access_at,
        within_family_procedure=procedure,
        within_family_inference_receipt_sha256=inference_receipt_sha256,
        chronological_blocks_sha256=blocks_sha256,
        bootstrap_replicates=4_096,
        required_scenario_unadjusted_min_p_values=raw_minima,
        required_scenario_null_exceedances=exceedances,
        required_scenario_p_values=scenario_p_values,
        raw_family_p_value=adjusted,
        simultaneous_lcb_alpha=lcb_alpha,
        required_scenario_capacity_capped_lcb_microusd=scenario_lcbs,
        capacity_capped_simultaneous_lcb_microusd=lcb,
        fee_evidence_sha256=fee_sha256,
        family_execution_capacity_law_sha256=execution_law_sha256,
        execution_capacity_drawdown_evidence_sha256=execution_evidence_sha256,
        pbo_receipt_bytes=pbo_receipt_bytes,
        pbo_receipt_sha256=pbo_receipt_sha256,
        family_holdout_authorization_receipt_sha256=authorization_sha256,
        family_holdout_authorized_at_utc=family_authorized_at,
        family_holdout_dataset_sha256=holdout_dataset_sha256,
        family_holdout_period_start_utc=family_period_start,
        family_holdout_period_end_utc=family_period_end,
        family_screened_period_end_utc=family_screened_end,
        family_holdout_embargo_seconds=HOLDOUT_EMBARGO_SECONDS,
        family_prior_period_expanded_intervals=prior_period_intervals,
        family_prior_period_inventory_sha256=prior_inventory_sha256,
        family_holdout_open_receipt_sha256=open_sha256,
        family_holdout_opened_at_utc=first_outcome_access_at,
        family_holdout_open_count=family_open_count,
        family_holdout_minimum_sample_count=MINIMUM_SAMPLES,
        family_holdout_observed_sample_count=observed_samples,
        family_holdout_tested_candidate_count=family_tested_candidate_count,
        family_holdout_block_length_samples=BLOCK_LENGTH_SAMPLES,
        family_holdout_block_count_floor=BLOCK_COUNT_FLOOR,
        family_holdout_block_seed_sha256=block_seed_sha256,
        family_holdout_effective_block_count=effective_blocks,
        family_post_open_mutation=family_post_open_mutation,
        family_reused_screened_period=family_reused_screened_period,
        family_holdout_result_bytes_sha256=result_bytes_sha256,
        family_holdout_receipt_sha256=result_sha256,
        family_holdout_result_at_utc=TERMINAL_EVIDENCE_AT,
        ranking_lcb_unit=RANKING_LCB_UNIT,
        ranking_exposure_seconds=RANKING_EXPOSURE_SECONDS,
        ranking_notional_usd_cents=RANKING_NOTIONAL_USD_CENTS,
        ranking_normalization_receipt_sha256=normalization_sha256,
        terminal_evidence_bytes=result_bytes,
        terminal_evidence_bytes_sha256=result_bytes_sha256,
        terminal_evidence_receipt_sha256=result_sha256,
        terminal_evidence_at_utc=TERMINAL_EVIDENCE_AT,
        stress_drawdown_bps=drawdown_bps,
        capacity_utilization_bps=utilization_bps,
    )


def _replace(
    base: tuple[FamilyAssessmentV1, ...],
    *values: FamilyAssessmentV1,
) -> tuple[FamilyAssessmentV1, ...]:
    replacements = {value.family_id: value for value in values}
    return tuple(
        replacements.get(family_id, base[index])
        for index, family_id in enumerate(EXPECTED_FAMILIES)
    )


def _confirmation(
    registry: SMeta1RegistryV1,
    assessments: tuple[FamilyAssessmentV1, ...],
    family_id: str = FAMILY_A,
    *,
    candidate: str = CANDIDATE_A,
    code_config: str = CODE_CONFIG_A,
    state: GateState = GateState.PASS,
    null_exceedances: int = 101,
    lcb: int = 1,
    winner_locked_at: str = WINNER_LOCKED_AT,
    authorized_at: str = FRESH_AUTHORIZED_AT,
    period_start: str = FRESH_PERIOD_START,
    period_end: str = FRESH_PERIOD_END,
    screened_end: str = FRESH_SCREENED_END,
    opened: str = FRESH_OPENED_AT,
    open_count: int = 1,
    tested_candidate_count: int = 1,
    fallback_used: bool = False,
    post_open_mutation: bool = False,
    reused_screened_period: bool = False,
    prove_integrity_failure: bool = True,
    include_result: bool = True,
    observed_samples: int = OBSERVED_SAMPLES,
    effective_blocks: int = EFFECTIVE_BLOCK_COUNT,
    stress_drawdown_bps: int = 1_000,
    capacity_utilization_bps: int = 5_000,
    execution_law_sha256: str = "b" * 64,
    assessment_digest_override: str | None = None,
    gates: tuple[tuple[str, GateState], ...] | None = None,
) -> WinnerConfirmationV1:
    p_value = bootstrap_plus_one_p(null_exceedances)
    gates_value = _gates(REQUIRED_CONFIRMATION_GATES) if gates is None else gates
    assessment_digest = (
        assessment_set_sha256(registry, assessments)
        if assessment_digest_override is None
        else assessment_digest_override
    )
    winner_lock_receipt_sha256 = "1" * 64
    holdout_dataset_sha256 = "3" * 64
    prior_period_intervals = (("ALL_PRIOR_PERIODS", "2026-07-01T00:00:00Z", screened_end),)
    prior_inventory_sha256 = prior_period_inventory_sha256(prior_period_intervals)
    fee_sha256 = "6" * 64
    execution_evidence_sha256 = "c" * 64
    inference_config_sha256 = "d" * 64
    blocks_sha256 = "7" * 64
    block_seed_sha256 = "8" * 64
    authorization_sha256 = winner_authorization_sha256(
        registry_sha256=registry.sha256,
        assessment_set_sha256=assessment_digest,
        winner_lock_receipt_sha256=winner_lock_receipt_sha256,
        winner_locked_at_utc=winner_locked_at,
        family_id=family_id,
        candidate_sha256=candidate,
        candidate_code_config_sha256=code_config,
        holdout_dataset_sha256=holdout_dataset_sha256,
        holdout_period_id="FRESH_POST_FREEZE_UTC_V1",
        holdout_period_start_utc=period_start,
        holdout_period_end_utc=period_end,
        screened_period_end_utc=screened_end,
        holdout_embargo_seconds=HOLDOUT_EMBARGO_SECONDS,
        prior_period_inventory_sha256=prior_inventory_sha256,
        authorized_fee_scenarios_sha256=fee_sha256,
        authorized_execution_capacity_law_sha256=execution_law_sha256,
        authorized_inference_config_sha256=inference_config_sha256,
        authorized_blocks_sha256=blocks_sha256,
        authorized_block_seed_sha256=block_seed_sha256,
        minimum_sample_count=MINIMUM_SAMPLES,
        block_length_samples=BLOCK_LENGTH_SAMPLES,
        block_count_floor=BLOCK_COUNT_FLOOR,
        ranking_lcb_unit=RANKING_LCB_UNIT,
        ranking_exposure_seconds=RANKING_EXPOSURE_SECONDS,
        ranking_notional_usd_cents=RANKING_NOTIONAL_USD_CENTS,
        authorized_at_utc=authorized_at,
    )
    open_sha256 = holdout_open_sha256(
        authorization_receipt_sha256=authorization_sha256,
        holdout_dataset_sha256=holdout_dataset_sha256,
        opened_at_utc=opened,
        open_count=open_count,
    )
    scenario_exceedances = tuple(
        (scenario_id, null_exceedances) for scenario_id in REQUIRED_FEE_SCENARIOS
    )
    scenario_p_values = tuple((scenario_id, p_value) for scenario_id in REQUIRED_FEE_SCENARIOS)
    scenario_lcbs = tuple((scenario_id, lcb) for scenario_id in REQUIRED_FEE_SCENARIOS)
    lcb_alpha = make_ratio(
        FAMILYWISE_ALPHA.numerator,
        FAMILYWISE_ALPHA.denominator,
    )
    integrity_claimed = (
        fallback_used or post_open_mutation or reused_screened_period or tested_candidate_count != 1
    )
    integrity_failure_sha256 = (
        holdout_integrity_failure_sha256(
            open_receipt_sha256=open_sha256,
            fallback_used=fallback_used,
            post_open_mutation=post_open_mutation,
            reused_screened_period=reused_screened_period,
            tested_candidate_count=tested_candidate_count,
        )
        if integrity_claimed and prove_integrity_failure
        else None
    )
    result_bytes = (
        holdout_measured_result_bytes(
            scope="WINNER",
            family_id=family_id,
            authorization_receipt_sha256=authorization_sha256,
            candidate_sha256=candidate,
            candidate_code_config_sha256=code_config,
            open_receipt_sha256=open_sha256,
            inference_procedure="FRESH_WINNER_BOOTSTRAP",
            inference_config_sha256=inference_config_sha256,
            pbo_receipt_sha256=None,
            result_at_utc=FRESH_RESULT_AT,
            fee_evidence_sha256=fee_sha256,
            execution_capacity_law_sha256=execution_law_sha256,
            execution_capacity_drawdown_evidence_sha256=execution_evidence_sha256,
            chronological_blocks_sha256=blocks_sha256,
            bootstrap_replicates=4_096,
            required_scenario_null_exceedances=scenario_exceedances,
            required_scenario_p_values=scenario_p_values,
            raw_p_value=p_value,
            lcb_alpha=lcb_alpha,
            required_scenario_lcbs=scenario_lcbs,
            aggregate_lcb=lcb,
            observed_sample_count=observed_samples,
            effective_block_count=effective_blocks,
            stress_drawdown_bps=stress_drawdown_bps,
            capacity_utilization_bps=capacity_utilization_bps,
            fallback_used=fallback_used,
            post_open_mutation=post_open_mutation,
            reused_screened_period=reused_screened_period,
            tested_candidate_count=tested_candidate_count,
            result_state=state.value,
            gates=gates_value,
        )
        if include_result
        else None
    )
    result_bytes_sha256 = (
        hashlib.sha256(result_bytes).hexdigest() if result_bytes is not None else None
    )
    result_sha256 = (
        holdout_result_sha256(
            scope="WINNER",
            candidate_sha256=candidate,
            candidate_code_config_sha256=code_config,
            open_receipt_sha256=open_sha256,
            inference_procedure="FRESH_WINNER_BOOTSTRAP",
            inference_config_sha256=inference_config_sha256,
            pbo_receipt_sha256=None,
            result_bytes_sha256=cast(str, result_bytes_sha256),
            result_at_utc=FRESH_RESULT_AT,
            fee_evidence_sha256=fee_sha256,
            execution_capacity_law_sha256=execution_law_sha256,
            execution_capacity_drawdown_evidence_sha256=execution_evidence_sha256,
            chronological_blocks_sha256=blocks_sha256,
            bootstrap_replicates=4_096,
            required_scenario_null_exceedances=scenario_exceedances,
            required_scenario_p_values=scenario_p_values,
            raw_p_value=p_value,
            lcb_alpha=lcb_alpha,
            required_scenario_lcbs=scenario_lcbs,
            aggregate_lcb=lcb,
            observed_sample_count=observed_samples,
            effective_block_count=effective_blocks,
            stress_drawdown_bps=stress_drawdown_bps,
            capacity_utilization_bps=capacity_utilization_bps,
            fallback_used=fallback_used,
            post_open_mutation=post_open_mutation,
            reused_screened_period=reused_screened_period,
            tested_candidate_count=tested_candidate_count,
            result_state=state.value,
            gates=gates_value,
        )
        if include_result
        else None
    )
    return WinnerConfirmationV1(
        family_id=family_id,
        candidate_sha256=candidate,
        registry_sha256=registry.sha256,
        assessment_set_sha256=assessment_digest,
        winner_lock_receipt_sha256=winner_lock_receipt_sha256,
        winner_locked_at_utc=winner_locked_at,
        authorization_receipt_sha256=authorization_sha256,
        authorized_at_utc=authorized_at,
        candidate_code_config_sha256=code_config,
        holdout_dataset_sha256=holdout_dataset_sha256,
        holdout_period_id="FRESH_POST_FREEZE_UTC_V1",
        holdout_period_start_utc=period_start,
        holdout_period_end_utc=period_end,
        screened_period_end_utc=screened_end,
        holdout_embargo_seconds=HOLDOUT_EMBARGO_SECONDS,
        prior_period_expanded_intervals=prior_period_intervals,
        prior_period_inventory_sha256=prior_inventory_sha256,
        authorized_fee_scenarios_sha256=fee_sha256,
        authorized_execution_capacity_law_sha256=execution_law_sha256,
        authorized_inference_config_sha256=inference_config_sha256,
        authorized_blocks_sha256=blocks_sha256,
        authorized_block_seed_sha256=block_seed_sha256,
        minimum_sample_count=MINIMUM_SAMPLES,
        block_length_samples=BLOCK_LENGTH_SAMPLES,
        block_count_floor=BLOCK_COUNT_FLOOR,
        ranking_lcb_unit=RANKING_LCB_UNIT,
        ranking_exposure_seconds=RANKING_EXPOSURE_SECONDS,
        ranking_notional_usd_cents=RANKING_NOTIONAL_USD_CENTS,
        opened_at_utc=opened,
        open_count=open_count,
        tested_candidate_count=tested_candidate_count,
        open_receipt_sha256=open_sha256,
        result_at_utc=FRESH_RESULT_AT if include_result else None,
        result_bytes=result_bytes,
        result_bytes_sha256=result_bytes_sha256,
        result_receipt_sha256=result_sha256,
        fee_evidence_sha256=fee_sha256 if include_result else None,
        execution_capacity_drawdown_evidence_sha256=(
            execution_evidence_sha256 if include_result else None
        ),
        chronological_blocks_sha256=blocks_sha256 if include_result else None,
        observed_sample_count=observed_samples if include_result else None,
        effective_block_count=effective_blocks if include_result else None,
        stress_drawdown_bps=stress_drawdown_bps if include_result else None,
        capacity_utilization_bps=capacity_utilization_bps if include_result else None,
        fallback_used=fallback_used,
        post_open_mutation=post_open_mutation,
        reused_screened_period=reused_screened_period,
        integrity_failure_receipt_sha256=integrity_failure_sha256,
        state=state,
        bootstrap_replicates=4_096 if include_result else None,
        required_scenario_null_exceedances=scenario_exceedances if include_result else (),
        raw_p_value=p_value if include_result else None,
        required_scenario_p_values=scenario_p_values if include_result else (),
        lcb_alpha=lcb_alpha if include_result else None,
        capacity_capped_net_lcb_microusd=lcb if include_result else None,
        required_scenario_capacity_capped_lcb_microusd=(scenario_lcbs if include_result else ()),
        gates=gates_value,
    )


@pytest.fixture(scope="module")
def registry() -> SMeta1RegistryV1:
    return load_registry(REGISTRY_PATH)


def test_registry_freezes_seven_distinct_families_and_attempt_counts() -> None:
    registry = load_registry(REGISTRY_PATH)
    assert registry.family_ids == EXPECTED_FAMILIES
    assert registry.attempted_hypothesis_counts == (2_976, 162, 1, 24, 1, None, None)
    assert len(set(registry.family_ids)) == 7
    assert EXPECTED_HOLM_THRESHOLDS[0].numerator == 1
    assert EXPECTED_HOLM_THRESHOLDS[0].denominator == 280


def test_registry_freezes_current_binance_fee_data_and_rpi_unknown_laws() -> None:
    root = parse_canonical_object(REGISTRY_PATH.read_bytes())
    admissibility = cast(dict[str, object], root["admissibility"])
    timestamp = cast(dict[str, object], admissibility["spotArchiveTimestampLaw"])
    assert timestamp == {
        "beforeCutoverUnit": "MILLISECONDS",
        "cutoverUtc": "2025-01-01T00:00:00Z",
        "onOrAfterCutoverUnit": "MICROSECONDS",
        "perPartitionValidationRequired": True,
        "singleGlobalScaleForbidden": True,
    }
    capacity = cast(dict[str, object], root["capacityAndDrawdownGates"])
    assert "RPI" in cast(str, capacity["usdmRpiCoverageLaw"])
    assert capacity["rankingMetricUnit"] == RANKING_LCB_UNIT
    assert capacity["rankingExposureSeconds"] == RANKING_EXPOSURE_SECONDS
    holdout = cast(dict[str, object], root["holdoutRules"])
    assert holdout["canonicalAuthorizationOpenAndResultDigestsRequired"] is True
    assert holdout["familyHoldoutTestedCandidateCount"] == 1
    winner = cast(dict[str, object], root["winnerPolicy"])
    assert winner["rankingMetricUnit"] == RANKING_LCB_UNIT
    fee_truth = cast(dict[str, object], root["feeScenarioTruth"])
    scenarios = {
        cast(str, scenario["scenarioId"]): scenario
        for scenario in (
            cast(dict[str, object], value) for value in cast(list[object], fee_truth["scenarios"])
        )
    }
    account = scenarios["ACCOUNT_EFFECTIVE_SANITIZED"]
    assert account["spotBnbDiscountAppliesTo"] == ["STANDARD_COMMISSION_ONLY"]
    assert account["taxAndSpecialDiscountPercent"] == 0
    assert account["bnbToggleSymbolEligibilityAndPerFillBalanceSufficiencyRequired"] is True
    sensitivity = scenarios["BNB_OR_PROMOTION_SENSITIVITY_ONLY"]
    assert sensitivity["fixedPointLaw"] == "bps=coefficient*10^(-scale)"
    assert sensitivity["spotAdvertisedMakerBpsCoefficient"] == 75
    assert sensitivity["spotAdvertisedMakerBpsScale"] == 1
    assert sensitivity["usdmAdvertisedStandardFeeDiscountPercent"] == 10
    assert scenarios["USDM_2_5_BPS_FAQ_EXAMPLE_ONLY"]["state"] == (
        "HYPOTHETICAL_EXAMPLE_NEVER_RATE_TRUTH"
    )
    source_urls = {
        cast(str, source["url"])
        for source in (
            cast(dict[str, object], value) for value in cast(list[object], root["researchSources"])
        )
    }
    assert "https://www.binance.com/en/fee/futureFee" in source_urls
    assert "https://www.binance.com/en/support/faq/detail/360033544231" in source_urls


def test_registry_is_canonical_and_pins_exact_economic_identity(tmp_path: Path) -> None:
    raw = REGISTRY_PATH.read_bytes()
    parse_canonical_object(raw)
    mutations = (
        (
            b'"attemptedFamilyCount":7',
            b'"attemptedFamilyCount":6',
            "must equal seven",
        ),
        (
            b'"familyId":"F05_VOLUME_ACCEPTED_EXIT_REPLAY"',
            b'"familyId":"F02_VOLUME_PROXY_THRESHOLD"',
            "frozen order or identity",
        ),
        (
            b'"attemptedHypothesisCount":2976',
            b'"attemptedHypothesisCount":2975',
            "attemptedHypothesisCount drifted",
        ),
        (
            b'"fdrMaySupportVerifiedPositive":false',
            b'"fdrMaySupportVerifiedPositive":true',
            "FDR may not support",
        ),
        (
            b'"entry":"MAKER_ONLY_STRICT_TRADE_THROUGH_AFTER_FUNDING"',
            b'"entry":"OUTCOME_SELECTED_ENTRY"',
            "registry digest drifted",
        ),
    )
    for index, (old, new, message) in enumerate(mutations):
        mutated = raw.replace(old, new, 1)
        assert mutated != raw
        path = tmp_path / f"mutated-{index}.json"
        path.write_bytes(mutated)
        with pytest.raises(ContractValueError, match=message):
            load_registry(path)


def test_plus_one_boundaries_match_frozen_alpha() -> None:
    assert bootstrap_plus_one_p(13).numerator * 280 <= bootstrap_plus_one_p(13).denominator
    assert bootstrap_plus_one_p(14).numerator * 280 > bootstrap_plus_one_p(14).denominator
    assert bootstrap_plus_one_p(101).numerator * 40 <= bootstrap_plus_one_p(101).denominator
    assert bootstrap_plus_one_p(102).numerator * 40 > bootstrap_plus_one_p(102).denominator


def test_within_family_bonferroni_counts_every_attempt() -> None:
    valid = _qualifying(
        FAMILY_B,
        procedure=WithinFamilyProcedure.BONFERRONI_ALL_ATTEMPTS,
    )
    raw_minima = list(valid.required_scenario_unadjusted_min_p_values)
    raw_minima[0] = (raw_minima[0][0], make_ratio(1, 1_000))
    with pytest.raises(ContractValueError, match="plus-one bootstrap"):
        replace(valid, required_scenario_unadjusted_min_p_values=tuple(raw_minima))
    many_attempts = _qualifying(
        procedure=WithinFamilyProcedure.BONFERRONI_ALL_ATTEMPTS,
        null_exceedances=0,
    )
    adjusted = list(many_attempts.required_scenario_p_values)
    adjusted[0] = (adjusted[0][0], bootstrap_plus_one_p(0))
    with pytest.raises(ContractValueError, match="count every attempted"):
        replace(many_attempts, required_scenario_p_values=tuple(adjusted))
    scenario_lcbs = list(valid.required_scenario_capacity_capped_lcb_microusd)
    scenario_lcbs[0] = (scenario_lcbs[0][0], 99)
    with pytest.raises(ContractValueError, match="minimum required-scenario"):
        replace(
            valid,
            required_scenario_capacity_capped_lcb_microusd=tuple(scenario_lcbs),
        )


def test_selection_aware_bootstrap_recomputes_plus_one_p() -> None:
    valid = _qualifying(
        procedure=WithinFamilyProcedure.HANSEN_SPA,
        null_exceedances=13,
    )
    scenario_p_values = list(valid.required_scenario_p_values)
    scenario_p_values[0] = (scenario_p_values[0][0], make_ratio(1, 280))
    with pytest.raises(ContractValueError, match="plus-one bootstrap"):
        replace(valid, required_scenario_p_values=tuple(scenario_p_values))


def test_frozen_rejected_and_research_stop_families_cannot_win() -> None:
    for family_id in EXPECTED_FAMILIES[:3]:
        with pytest.raises(ContractValueError, match="positive-eligible"):
            _qualifying(family_id)


def test_pending_family_terminal_ledger_remains_unknown() -> None:
    for family_id in EXPECTED_FAMILIES[5:]:
        with pytest.raises(
            ContractValueError,
            match="UNKNOWN pending a trusted pre-outcome digest authority",
        ):
            _qualifying(
                family_id,
                attempted_count=2,
                ledger_frozen_at=FIRST_OUTCOME_ACCESS,
            )


def test_no_go_requires_known_explicit_failure_and_terminal_receipt() -> None:
    valid = _no_go(FAMILY_A)
    with pytest.raises(ContractValueError, match="explicit failed gate"):
        replace(valid, gates=_gates(REQUIRED_FAMILY_GATES))
    with pytest.raises(ContractValueError, match="may not hide"):
        replace(
            valid,
            gates=_gates(
                REQUIRED_FAMILY_GATES,
                ADMISSIBLE_EVIDENCE=GateState.FAIL,
                FEE_ACCOUNT_EFFECTIVE=GateState.UNKNOWN,
            ),
        )
    with pytest.raises(ContractValueError, match="evidence receipt"):
        replace(valid, terminal_evidence_receipt_sha256=None)
    with pytest.raises(ContractValueError, match="measured terminal failure"):
        replace(valid, terminal_evidence_receipt_sha256="f" * 64)
    with pytest.raises(ContractValueError, match="requires canonical measured result bytes"):
        replace(valid, terminal_evidence_bytes=None)
    with pytest.raises(ContractValueError, match="open digest"):
        replace(valid, family_holdout_open_receipt_sha256="f" * 64)

    def receipt_for(evidence_sha256: str) -> str:
        return terminal_family_failure_sha256(
            family_id=valid.family_id,
            attempted_hypothesis_count=cast(int, valid.attempted_hypothesis_count),
            attempt_ledger_sha256=cast(str, valid.attempt_ledger_sha256),
            attempt_ledger_frozen_at_utc=cast(str, valid.attempt_ledger_frozen_at_utc),
            first_outcome_access_at_utc=cast(str, valid.first_outcome_access_at_utc),
            terminal_reason_code=valid.terminal_reason_code,
            gates=valid.gates,
            terminal_evidence_bytes_sha256=evidence_sha256,
            terminal_evidence_at_utc=cast(str, valid.terminal_evidence_at_utc),
        )

    raw = cast(bytes, valid.terminal_evidence_bytes)
    noncanonical = raw.removesuffix(b"\n")
    noncanonical_sha256 = hashlib.sha256(noncanonical).hexdigest()
    with pytest.raises(ContractValueError, match="requires canonical measured result bytes"):
        replace(
            valid,
            terminal_evidence_bytes=noncanonical,
            terminal_evidence_bytes_sha256=noncanonical_sha256,
            terminal_evidence_receipt_sha256=receipt_for(noncanonical_sha256),
        )

    tampered = raw.replace(
        f'"candidateSha256":"{CANDIDATE_A}"'.encode(),
        f'"candidateSha256":"{CANDIDATE_B}"'.encode(),
    )
    assert tampered != raw
    tampered_sha256 = hashlib.sha256(tampered).hexdigest()
    with pytest.raises(ContractValueError, match="do not match the locked payload"):
        replace(
            valid,
            terminal_evidence_bytes=tampered,
            terminal_evidence_bytes_sha256=tampered_sha256,
            terminal_evidence_receipt_sha256=receipt_for(tampered_sha256),
        )

    self_authored_envelope = canonical_json_bytes(
        {
            "failedGateIds": ["ADMISSIBLE_EVIDENCE"],
            "familyId": FAMILY_A,
            "schema": "SMeta1TerminalFamilyFailureEvidenceV1",
        }
    )
    envelope_sha256 = hashlib.sha256(self_authored_envelope).hexdigest()
    with pytest.raises(ContractValueError, match="measured result schema"):
        replace(
            valid,
            family_holdout_receipt_sha256=envelope_sha256,
            terminal_evidence_bytes=self_authored_envelope,
            terminal_evidence_bytes_sha256=envelope_sha256,
            terminal_evidence_receipt_sha256=receipt_for(envelope_sha256),
        )


def test_pending_families_prevent_all_terminal_no_go(
    registry: SMeta1RegistryV1,
) -> None:
    assessments = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    decision = evaluate_n3(registry, assessments)
    assert decision.verdict is N3Verdict.UNKNOWN
    assert decision.capital_authority == "NONE"
    assert decision.verified_candidate_sha256 is None


def test_n3_rejects_six_eight_and_duplicate_family_assessments(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    with pytest.raises(ContractValueError, match="seven-entry"):
        evaluate_n3(registry, base[:-1])
    with pytest.raises(ContractValueError, match="seven-entry"):
        evaluate_n3(registry, (*base, base[-1]))
    with pytest.raises(ContractValueError, match="unique"):
        evaluate_n3(registry, (*base[:-1], base[0]))


def test_any_unresolved_family_blocks_every_candidate(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(
        base,
        _qualifying(),
        _unknown(EXPECTED_FAMILIES[-1]),
    )
    decision = evaluate_n3(registry, assessments)
    assert decision.verdict is N3Verdict.UNKNOWN
    assert decision.verified_candidate_sha256 is None


def test_missing_capacity_or_drawdown_path_is_unknown(registry: SMeta1RegistryV1) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    qualifying = _qualifying()
    with pytest.raises(ContractValueError, match="complete independently locked"):
        replace(qualifying, stress_drawdown_bps=None)
    with pytest.raises(ContractValueError, match="complete independently locked"):
        replace(qualifying, capacity_utilization_bps=None)
    assert evaluate_n3(registry, _replace(base, _unknown(FAMILY_A))).verdict is N3Verdict.UNKNOWN


@pytest.mark.parametrize(
    ("drawdown_bps", "capacity_bps", "expected"),
    [
        (4_000, 10_000, N3Verdict.UNKNOWN),
        (4_001, 10_000, N3Verdict.UNKNOWN),
        (4_000, 10_001, N3Verdict.UNKNOWN),
    ],
)
def test_drawdown_and_capacity_boundaries(
    registry: SMeta1RegistryV1,
    drawdown_bps: int,
    capacity_bps: int,
    expected: N3Verdict,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(
        base,
        _qualifying(
            drawdown_bps=drawdown_bps,
            utilization_bps=capacity_bps,
        ),
    )
    assert evaluate_n3(registry, assessments).verdict is expected


@pytest.mark.parametrize(
    ("null_exceedances", "expected"),
    [
        (13, N3Verdict.UNKNOWN),
        (14, N3Verdict.UNKNOWN),
        (4_096, N3Verdict.UNKNOWN),
    ],
)
def test_first_holm_rank_boundaries(
    registry: SMeta1RegistryV1,
    null_exceedances: int,
    expected: N3Verdict,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(
        base,
        _qualifying(null_exceedances=null_exceedances),
    )
    assert evaluate_n3(registry, assessments).verdict is expected


@pytest.mark.parametrize(
    ("invalid_lcb", "invalid_drawdown_bps", "invalid_capacity_bps"),
    [
        (0, 1_000, 5_000),
        (100, MAX_DRAWDOWN_BPS + 1, 5_000),
        (100, 1_000, 10_001),
    ],
)
def test_ineligible_family_cannot_consume_an_earlier_holm_rank(
    registry: SMeta1RegistryV1,
    invalid_lcb: int,
    invalid_drawdown_bps: int,
    invalid_capacity_bps: int,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(
        base,
        _qualifying(
            FAMILY_A,
            lcb=invalid_lcb,
            null_exceedances=0,
            drawdown_bps=invalid_drawdown_bps,
            utilization_bps=invalid_capacity_bps,
        ),
        _qualifying(
            FAMILY_B,
            candidate=CANDIDATE_B,
            code_config=CODE_CONFIG_B,
            null_exceedances=14,
        ),
    )
    decision = evaluate_n3(registry, assessments)
    assert decision.verdict is N3Verdict.UNKNOWN
    assert decision.provisional_family_id is None


def test_failed_gate_family_cannot_enter_holm_or_promote_another_family() -> None:
    with pytest.raises(ContractValueError, match="every frozen evidence gate"):
        _qualifying(
            gates=_gates(
                REQUIRED_FAMILY_GATES,
                ADMISSIBLE_EVIDENCE=GateState.FAIL,
            )
        )


def test_fee_unknown_and_zero_lcb_fail_closed(registry: SMeta1RegistryV1) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    with pytest.raises(ContractValueError, match="every frozen evidence gate"):
        _qualifying(
            gates=_gates(
                REQUIRED_FAMILY_GATES,
                FEE_ACCOUNT_EFFECTIVE=GateState.UNKNOWN,
            )
        )
    assert (
        evaluate_n3(
            registry,
            _replace(base, _unknown(FAMILY_A)),
        ).verdict
        is N3Verdict.UNKNOWN
    )
    assert (
        evaluate_n3(
            registry,
            _replace(base, _qualifying(lcb=0)),
        ).verdict
        is N3Verdict.UNKNOWN
    )


def test_holm_selected_family_requires_fresh_holdout(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(base, _qualifying())
    decision = evaluate_n3(registry, assessments)
    assert decision.verdict is N3Verdict.UNKNOWN
    assert decision.provisional_family_id is None


def test_pending_families_block_verified_positive_with_exact_winner(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(base, _qualifying())
    confirmation = _confirmation(registry, assessments)
    decision = evaluate_n3(registry, assessments, confirmation)
    assert decision.verdict is N3Verdict.UNKNOWN
    assert decision.verified_candidate_sha256 is None
    assert decision.capital_authority == "NONE"
    mismatched = _confirmation(
        registry,
        assessments,
        assessment_digest_override="f" * 64,
    )
    assert evaluate_n3(registry, assessments, mismatched).verdict is N3Verdict.UNKNOWN
    assert (
        evaluate_n3(
            registry,
            assessments,
            _confirmation(
                registry,
                assessments,
                winner_locked_at="2026-07-28T22:30:00Z",
            ),
        ).verdict
        is N3Verdict.UNKNOWN
    )
    with pytest.raises(ContractValueError, match="chronology drifted"):
        _confirmation(
            registry,
            assessments,
            authorized_at=FRESH_PERIOD_START,
        )
    mismatched_execution_law = _confirmation(
        registry,
        assessments,
        execution_law_sha256="e" * 64,
    )
    assert (
        evaluate_n3(
            registry,
            assessments,
            mismatched_execution_law,
        ).verdict
        is N3Verdict.UNKNOWN
    )


def test_deterministic_ranking_uses_lcb_before_family_id(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(
        base,
        _qualifying(FAMILY_A, lcb=100),
        _qualifying(
            FAMILY_B,
            lcb=101,
            candidate=CANDIDATE_B,
            code_config=CODE_CONFIG_B,
        ),
    )
    decision = evaluate_n3(registry, assessments)
    assert decision.verdict is N3Verdict.UNKNOWN
    assert decision.provisional_family_id is None
    confirmation = _confirmation(
        registry,
        assessments,
        FAMILY_B,
        candidate=CANDIDATE_B,
        code_config=CODE_CONFIG_B,
    )
    assert evaluate_n3(registry, assessments, confirmation).verdict is N3Verdict.UNKNOWN


def test_fresh_holdout_atomic_no_fallback_truth_table(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(base, _qualifying())
    confirmations = (
        _confirmation(registry, assessments, state=GateState.FAIL),
        (
            _confirmation(
                registry,
                assessments,
                state=GateState.FAIL,
                gates=_gates(
                    REQUIRED_CONFIRMATION_GATES,
                    DRAWDOWN_CAP=GateState.FAIL,
                ),
            )
        ),
        (
            _confirmation(
                registry,
                assessments,
                winner_locked_at="2026-07-28T23:30:00Z",
                authorized_at="2026-07-28T23:35:00Z",
                period_start="2026-07-28T23:40:00Z",
                period_end="2026-07-28T23:50:00Z",
                opened="2026-07-28T23:59:59Z",
            )
        ),
        _confirmation(registry, assessments, open_count=2),
        _confirmation(registry, assessments, fallback_used=True),
        _confirmation(registry, assessments, post_open_mutation=True),
        _confirmation(registry, assessments, reused_screened_period=True),
        _confirmation(registry, assessments, null_exceedances=102),
        _confirmation(registry, assessments, lcb=0),
        (
            _confirmation(
                registry,
                assessments,
                gates=_gates(
                    REQUIRED_CONFIRMATION_GATES,
                    REQUIRED_FEE_SCENARIOS=GateState.UNKNOWN,
                ),
            )
        ),
    )
    for confirmation in confirmations:
        decision = evaluate_n3(registry, assessments, confirmation)
        assert decision.verdict is N3Verdict.UNKNOWN
        assert decision.provisional_family_id is None
        assert decision.capital_authority == "NONE"


@pytest.mark.parametrize(
    "first_outcome_access_at",
    [
        "2026-07-28T16:10:50Z",
        "2026-07-28T16:10:51Z",
    ],
)
def test_active_outcome_must_follow_registry_freeze_strictly(
    first_outcome_access_at: str,
) -> None:
    with pytest.raises(ContractValueError, match="strictly after"):
        _qualifying(
            ledger_frozen_at=REGISTRY_FROZEN_AT_UTC,
            candidate_locked_at="2026-07-28T16:20:00Z",
            family_authorized_at=FAMILY_AUTHORIZED_AT,
            family_screened_end="2026-07-28T12:00:00Z",
            family_period_start=FAMILY_PERIOD_START,
            family_period_end=FAMILY_PERIOD_END,
            first_outcome_access_at=first_outcome_access_at,
        )
    with pytest.raises(ContractValueError, match="cannot predate"):
        _qualifying(ledger_frozen_at="2026-07-28T13:00:00Z")


def test_family_holdout_is_one_locked_candidate_one_open_and_disjoint() -> None:
    with pytest.raises(ContractValueError, match="chronology drifted"):
        _qualifying(candidate_locked_at="2026-07-28T22:30:00Z")
    with pytest.raises(ContractValueError, match="one locked candidate"):
        _qualifying(family_tested_candidate_count=2)
    with pytest.raises(ContractValueError, match="one locked candidate"):
        _qualifying(family_open_count=2)
    with pytest.raises(ContractValueError, match="disjoint"):
        _qualifying(family_screened_end="2026-07-28T16:30:00Z")
    with pytest.raises(ContractValueError, match="one locked candidate"):
        _qualifying(family_post_open_mutation=True)
    with pytest.raises(ContractValueError, match="one locked candidate"):
        _qualifying(family_reused_screened_period=True)


def test_family_holdout_recomputes_authorization_result_and_normalization() -> None:
    valid = _qualifying()
    assert hashlib.sha256(cast(bytes, valid.terminal_evidence_bytes)).hexdigest() == (
        valid.family_holdout_result_bytes_sha256
    )
    with pytest.raises(ContractValueError, match="digest-bound inference receipt"):
        replace(valid, terminal_evidence_bytes=None)
    with pytest.raises(ContractValueError, match="authorization digest"):
        replace(
            valid,
            family_holdout_authorization_receipt_sha256="f" * 64,
        )
    with pytest.raises(ContractValueError, match="authorization digest"):
        replace(valid, within_family_procedure=WithinFamilyProcedure.ROMANO_WOLF)
    with pytest.raises(ContractValueError, match="canonical intervals"):
        replace(valid, family_prior_period_inventory_sha256="f" * 64)
    with pytest.raises(ContractValueError, match="canonical result"):
        replace(valid, family_holdout_receipt_sha256="f" * 64)
    with pytest.raises(ContractValueError, match="common-unit payload"):
        replace(valid, ranking_normalization_receipt_sha256="f" * 64)
    with pytest.raises(ContractValueError, match="common wall-clock unit"):
        replace(valid, ranking_exposure_seconds=3_600)


def test_pbo_receipt_bytes_are_recomputed_and_preopen_authorization_bound() -> None:
    valid = _qualifying()
    pbo_bytes = cast(bytes, valid.pbo_receipt_bytes)
    assert hashlib.sha256(pbo_bytes).hexdigest() == valid.pbo_receipt_sha256
    mapping = valid.as_mapping()
    assert mapping["pboReceiptSha256"] == valid.pbo_receipt_sha256
    assert "pboReceiptBytes" not in mapping

    with pytest.raises(ContractValueError, match="bytes and digest must appear together"):
        replace(valid, pbo_receipt_bytes=None)
    with pytest.raises(ContractValueError, match="exhaustive canonical recomputation"):
        replace(valid, pbo_receipt_sha256="f" * 64)

    tampered = pbo_bytes.replace(
        f'"candidateSha256":"{CANDIDATE_A}"'.encode(),
        f'"candidateSha256":"{CANDIDATE_B}"'.encode(),
    )
    assert tampered != pbo_bytes
    with pytest.raises(ContractValueError, match="exhaustive canonical recomputation"):
        replace(
            valid,
            pbo_receipt_bytes=tampered,
            pbo_receipt_sha256=hashlib.sha256(tampered).hexdigest(),
        )

    attempt_rows = _synthetic_attempt_rows(
        family_id=valid.family_id,
        count=cast(int, valid.attempted_hypothesis_count),
        selected_candidate=cast(str, valid.candidate_sha256),
        selected_code_config=cast(str, valid.candidate_code_config_sha256),
    )
    alternative = _pbo_evidence(
        family_id=valid.family_id,
        candidate=cast(str, valid.candidate_sha256),
        code_config=cast(str, valid.candidate_code_config_sha256),
        attempt_rows=attempt_rows,
        attempt_ledger_bytes_value=cast(bytes, valid.attempt_ledger_bytes),
        attempt_ledger_sha256_value=cast(str, valid.attempt_ledger_sha256),
        inference_receipt_sha256=cast(
            str,
            valid.within_family_inference_receipt_sha256,
        ),
        family_screened_end=cast(str, valid.family_screened_period_end_utc),
        fee_sha256=cast(str, valid.fee_evidence_sha256),
        execution_law_sha256=cast(
            str,
            valid.family_execution_capacity_law_sha256,
        ),
        candidate_locked_at=cast(str, valid.candidate_locked_at_utc),
        mode="OVERFIT",
    )
    with pytest.raises(ContractValueError, match="authorization digest"):
        replace(
            valid,
            pbo_receipt_bytes=alternative,
            pbo_receipt_sha256=hashlib.sha256(alternative).hexdigest(),
        )

    active_no_go = _no_go(FAMILY_A)
    with pytest.raises(ContractValueError, match="exhaustive canonical recomputation"):
        replace(active_no_go, pbo_receipt_sha256="f" * 64)


def test_attempt_ledger_bytes_digest_count_and_universe_fail_closed() -> None:
    valid = _qualifying()
    ledger_bytes = cast(bytes, valid.attempt_ledger_bytes)
    attempt_rows = _synthetic_attempt_rows(
        family_id=valid.family_id,
        count=cast(int, valid.attempted_hypothesis_count),
        selected_candidate=cast(str, valid.candidate_sha256),
        selected_code_config=cast(str, valid.candidate_code_config_sha256),
    )
    assert smeta1.attempt_ledger_bytes(
        family_id=valid.family_id,
        frozen_at_utc=cast(str, valid.attempt_ledger_frozen_at_utc),
        trials=attempt_rows,
    ) == attempt_ledger_bytes(
        family_id=valid.family_id,
        frozen_at_utc=cast(str, valid.attempt_ledger_frozen_at_utc),
        trials=attempt_rows,
    )
    assert smeta1.candidate_universe_sha256_from_attempts(
        attempt_rows
    ) == candidate_universe_sha256_from_attempts(attempt_rows)
    ledger = parse_canonical_object(ledger_bytes)
    assert set(ledger) == {
        "attemptedHypothesisCount",
        "familyId",
        "frozenAtUtc",
        "registrySha256",
        "schema",
        "trials",
    }
    trial_rows = cast(list[object], ledger["trials"])
    assert len(trial_rows) == valid.attempted_hypothesis_count
    assert all(
        set(cast(dict[str, object], row))
        == {
            "candidateCodeConfigSha256",
            "candidateSha256",
            "trialId",
        }
        for row in trial_rows
    )
    assert hashlib.sha256(ledger_bytes).hexdigest() == valid.attempt_ledger_sha256
    assert "attemptLedgerBytes" not in valid.as_mapping()

    with pytest.raises(
        ContractValueError,
        match="bytes and digest must appear together",
    ):
        replace(valid, attempt_ledger_bytes=None)
    with pytest.raises(
        ContractValueError,
        match="candidate universe digest must derive",
    ):
        replace(valid, candidate_universe_sha256="f" * 64)

    alternate_rows = list(
        _synthetic_attempt_rows(
            family_id=valid.family_id,
            count=valid.attempted_hypothesis_count,
            selected_candidate=cast(str, valid.candidate_sha256),
            selected_code_config=cast(str, valid.candidate_code_config_sha256),
        )
    )
    alternate_rows[0] = (
        alternate_rows[0][0],
        "7" * 64,
        alternate_rows[0][2],
    )
    alternate_bytes = attempt_ledger_bytes(
        family_id=valid.family_id,
        frozen_at_utc=cast(str, valid.attempt_ledger_frozen_at_utc),
        trials=tuple(alternate_rows),
    )
    with pytest.raises(
        ContractValueError,
        match="bytes and digest do not match",
    ):
        replace(valid, attempt_ledger_bytes=alternate_bytes)


def test_pbo_attempt_provenance_substitution_and_claimed_count_fail_closed(
    registry: SMeta1RegistryV1,
) -> None:
    original_rows = _synthetic_attempt_rows(
        family_id=FAMILY_A,
        count=2,
        selected_candidate=CANDIDATE_A,
        selected_code_config=CODE_CONFIG_A,
    )
    substituted_trial_rows = (
        original_rows[0],
        ("TRIAL_0002", CANDIDATE_A, CODE_CONFIG_A),
    )
    with pytest.raises(
        ContractValueError,
        match="matrix trial identities must equal",
    ):
        _direct_pbo_from_attempt_rows(
            substituted_trial_rows,
            matrix_trial_ids=("TRIAL_0000", "TRIAL_0001"),
            selected_trial_id="TRIAL_0002",
        )

    selected_candidate_substitution = (
        original_rows[0],
        ("TRIAL_0001", CANDIDATE_B, CODE_CONFIG_B),
    )
    with pytest.raises(
        ContractValueError,
        match="selected trial candidate must equal",
    ):
        _direct_pbo_from_attempt_rows(selected_candidate_substitution)

    def evaluate_pending_two_attempts(pending_family_id: str) -> N3Verdict:
        claimed = _qualifying(
            pending_family_id,
            attempted_count=2,
        )
        assessments = _replace(
            tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES),
            claimed,
        )
        confirmation = _confirmation(
            registry,
            assessments,
            family_id=pending_family_id,
        )
        return evaluate_n3(registry, assessments, confirmation).verdict

    for pending_family_id in EXPECTED_FAMILIES[5:]:
        with pytest.raises(
            ContractValueError,
            match="UNKNOWN pending a trusted pre-outcome digest authority",
        ):
            evaluate_pending_two_attempts(pending_family_id)

    def evaluate_claimed_single_attempt_f06() -> N3Verdict:
        claimed = _qualifying(
            EXPECTED_FAMILIES[5],
            attempted_count=1,
        )
        assessments = _replace(
            tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES),
            claimed,
        )
        confirmation = _confirmation(
            registry,
            assessments,
            family_id=EXPECTED_FAMILIES[5],
        )
        return evaluate_n3(registry, assessments, confirmation).verdict

    with pytest.raises(
        ContractValueError,
        match="UNKNOWN pending a trusted pre-outcome digest authority",
    ):
        evaluate_claimed_single_attempt_f06()


def test_pbo_is_exact_diagnostic_only_and_single_attempt_is_not_applicable(
    registry: SMeta1RegistryV1,
) -> None:
    robust = _qualifying(pbo_mode="ROBUST")
    overfit = _qualifying(pbo_mode="OVERFIT")
    robust_receipt = parse_canonical_object(cast(bytes, robust.pbo_receipt_bytes))
    overfit_receipt = parse_canonical_object(cast(bytes, overfit.pbo_receipt_bytes))
    assert robust_receipt["splitCount"] == 6
    assert robust_receipt["nonpositiveLogitCount"] == 0
    assert robust_receipt["pbo"] == {"denominator": "1", "numerator": "0"}
    assert overfit_receipt["splitCount"] == 6
    assert overfit_receipt["nonpositiveLogitCount"] == 6
    assert overfit_receipt["pbo"] == {"denominator": "1", "numerator": "1"}

    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    for qualifying in (robust, overfit):
        assessments = _replace(base, qualifying)
        confirmation = _confirmation(registry, assessments)
        assert evaluate_n3(registry, assessments, confirmation).verdict is N3Verdict.UNKNOWN

    single = _qualifying(
        FAMILY_B,
        candidate=CANDIDATE_B,
        code_config=CODE_CONFIG_B,
    )
    single_receipt = parse_canonical_object(cast(bytes, single.pbo_receipt_bytes))
    single_ledger = parse_canonical_object(cast(bytes, single.attempt_ledger_bytes))
    assert single_ledger["attemptedHypothesisCount"] == 1
    assert len(cast(list[object], single_ledger["trials"])) == 1
    assert single_receipt["applicability"] == "NOT_APPLICABLE_EXACT_SINGLE_ATTEMPT"
    assert single_receipt["splitCount"] == 0
    assert single_receipt["nonpositiveLogitCount"] == 0
    assert single_receipt["pbo"] is None


def test_pbo_chronology_and_matrix_shape_fail_closed() -> None:
    with pytest.raises(ContractValueError, match="before holdout authorization"):
        _qualifying(family_authorized_at="2026-07-28T16:34:00Z")
    attempt_rows = _synthetic_attempt_rows(
        family_id=FAMILY_A,
        count=2,
        selected_candidate=CANDIDATE_A,
        selected_code_config=CODE_CONFIG_A,
    )
    ledger_bytes = attempt_ledger_bytes(
        family_id=FAMILY_A,
        frozen_at_utc=LEDGER_FROZEN,
        trials=attempt_rows,
    )
    with pytest.raises(ContractValueError, match="even number of blocks"):
        pbo_diagnostic_receipt_bytes(
            family_id=FAMILY_A,
            candidate_sha256=CANDIDATE_A,
            candidate_code_config_sha256=CODE_CONFIG_A,
            candidate_locked_at_utc=FAMILY_CANDIDATE_LOCKED,
            selected_trial_id="TRIAL_0001",
            attempt_ledger_bytes_value=ledger_bytes,
            attempt_ledger_sha256=hashlib.sha256(ledger_bytes).hexdigest(),
            within_family_inference_receipt_sha256="1" * 64,
            pbo_chronological_blocks_sha256="6" * 64,
            screened_period_end_utc=FAMILY_SCREENED_END,
            fee_evidence_sha256="3" * 64,
            execution_capacity_law_sha256="b" * 64,
            trial_ids=("TRIAL_0000", "TRIAL_0001"),
            block_ids=("BLOCK_0000", "BLOCK_0001", "BLOCK_0002"),
            score_matrix=((1, 2, 3), (3, 2, 1)),
            computed_at_utc=PBO_COMPUTED_AT,
        )


def test_pbo_receipt_computed_before_claimed_screened_cutoff_fails_closed() -> None:
    with pytest.raises(ContractValueError, match="on or after screened-period end"):
        _qualifying(
            family_screened_end="2026-07-28T16:36:00Z",
            family_period_start="2026-07-28T17:40:00Z",
        )


def test_family_holdout_sample_and_block_floors_fail_closed() -> None:
    with pytest.raises(ContractValueError, match="sample and effective-block"):
        _qualifying(observed_samples=MINIMUM_SAMPLES - 1)
    with pytest.raises(ContractValueError, match="sample and effective-block"):
        _qualifying(effective_blocks=BLOCK_COUNT_FLOOR - 1)


def test_fresh_authorization_and_result_payloads_are_recomputed(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(base, _qualifying())
    confirmation = _confirmation(registry, assessments)
    with pytest.raises(ContractValueError, match="authorization digest"):
        replace(confirmation, authorization_receipt_sha256="f" * 64)
    with pytest.raises(ContractValueError, match="canonical intervals"):
        replace(confirmation, prior_period_inventory_sha256="f" * 64)
    with pytest.raises(ContractValueError, match="canonical payload"):
        replace(confirmation, result_receipt_sha256="f" * 64)
    failed_gates = _gates(
        REQUIRED_CONFIRMATION_GATES,
        DRAWDOWN_CAP=GateState.FAIL,
    )
    with pytest.raises(ContractValueError, match="locked payload"):
        replace(confirmation, gates=failed_gates)
    with pytest.raises(ContractValueError, match="must be positive"):
        _confirmation(registry, assessments, open_count=0)


def test_complete_winner_result_binds_every_integrity_claim(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(base, _qualifying())
    attacks = (
        (
            _confirmation(registry, assessments, fallback_used=True),
            {"fallback_used": False, "integrity_failure_receipt_sha256": None},
        ),
        (
            _confirmation(registry, assessments, post_open_mutation=True),
            {"post_open_mutation": False, "integrity_failure_receipt_sha256": None},
        ),
        (
            _confirmation(registry, assessments, reused_screened_period=True),
            {"reused_screened_period": False, "integrity_failure_receipt_sha256": None},
        ),
        (
            _confirmation(registry, assessments, tested_candidate_count=2),
            {"tested_candidate_count": 1, "integrity_failure_receipt_sha256": None},
        ),
    )
    for confirmation, mutation in attacks:
        with pytest.raises(ContractValueError, match="locked payload"):
            replace(confirmation, **mutation)


def test_winner_state_and_measured_result_bytes_are_immutable(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(base, _qualifying())
    confirmation = _confirmation(registry, assessments)
    assert hashlib.sha256(cast(bytes, confirmation.result_bytes)).hexdigest() == (
        confirmation.result_bytes_sha256
    )
    with pytest.raises(ContractValueError, match="appear together"):
        replace(confirmation, result_bytes=None)
    tampered = cast(bytes, confirmation.result_bytes).replace(
        f'"candidateSha256":"{CANDIDATE_A}"'.encode(),
        f'"candidateSha256":"{CANDIDATE_B}"'.encode(),
    )
    assert tampered != confirmation.result_bytes
    with pytest.raises(ContractValueError, match="locked payload"):
        replace(confirmation, result_bytes=tampered)
    unknown = _confirmation(
        registry,
        assessments,
        state=GateState.UNKNOWN,
    )
    with pytest.raises(ContractValueError, match="locked payload"):
        replace(unknown, state=GateState.PASS)


def test_fresh_winner_numeric_fields_reject_negative_and_boolean_values(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(base, _qualifying())
    with pytest.raises(ContractValueError, match="stress_drawdown_bps must be non-negative"):
        _confirmation(registry, assessments, stress_drawdown_bps=-1)
    with pytest.raises(ContractValueError, match="capacity_utilization_bps must be non-negative"):
        _confirmation(registry, assessments, capacity_utilization_bps=-1)
    with pytest.raises(
        ContractValueError,
        match="capacity_capped_net_lcb_microusd must be an integer",
    ):
        replace(
            _confirmation(registry, assessments),
            capacity_capped_net_lcb_microusd=True,
        )


def test_fresh_fail_without_result_is_unknown_unless_contamination_is_proven(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(base, _qualifying())
    no_result = _confirmation(
        registry,
        assessments,
        state=GateState.FAIL,
        include_result=False,
    )
    assert evaluate_n3(registry, assessments, no_result).verdict is N3Verdict.UNKNOWN
    second_open = _confirmation(
        registry,
        assessments,
        state=GateState.FAIL,
        include_result=False,
        open_count=2,
    )
    assert evaluate_n3(registry, assessments, second_open).verdict is N3Verdict.UNKNOWN
    unproven_fallback = _confirmation(
        registry,
        assessments,
        state=GateState.FAIL,
        include_result=False,
        fallback_used=True,
        prove_integrity_failure=False,
    )
    assert evaluate_n3(registry, assessments, unproven_fallback).verdict is N3Verdict.UNKNOWN


def test_fresh_period_overlap_and_sample_block_shortfalls_are_no_go(
    registry: SMeta1RegistryV1,
) -> None:
    base = tuple(_no_go(family_id) for family_id in EXPECTED_FAMILIES)
    assessments = _replace(base, _qualifying())
    confirmations = (
        _confirmation(
            registry,
            assessments,
            screened_end="2026-07-28T23:30:00Z",
        ),
        _confirmation(
            registry,
            assessments,
            observed_samples=MINIMUM_SAMPLES - 1,
        ),
        _confirmation(
            registry,
            assessments,
            effective_blocks=BLOCK_COUNT_FLOOR - 1,
        ),
        _confirmation(
            registry,
            assessments,
            stress_drawdown_bps=MAX_DRAWDOWN_BPS + 1,
        ),
        _confirmation(
            registry,
            assessments,
            capacity_utilization_bps=10_001,
        ),
    )
    for confirmation in confirmations:
        assert evaluate_n3(registry, assessments, confirmation).verdict is N3Verdict.UNKNOWN


def test_freeze_receipt_binds_every_frozen_artifact() -> None:
    receipt = parse_canonical_object(RECEIPT_PATH.read_bytes())
    assert set(receipt) == {
        "artifacts",
        "attemptedFamilyCount",
        "baseCommit",
        "focusedProof",
        "frozenAtUtc",
        "knownLimitations",
        "outcomeBytesAccessed",
        "registryId",
        "schema",
        "unpublishedOutcomePathsOpened",
        "version",
    }
    assert receipt["schema"] == "SMeta1FreezeReceiptV1"
    assert receipt["registryId"] == "S-META1"
    assert receipt["version"] == 1
    assert receipt["attemptedFamilyCount"] == 7
    assert receipt["frozenAtUtc"] == "2026-07-28T16:10:51Z"
    assert receipt["baseCommit"] == "a169b123fb186d1943a75ad648552c4d95be1be1"
    assert receipt["outcomeBytesAccessed"] is False
    assert receipt["unpublishedOutcomePathsOpened"] == []
    artifacts = cast(list[object], receipt["artifacts"])
    assert len(artifacts) == 4
    artifact_paths = tuple(cast(str, cast(dict[str, object], value)["path"]) for value in artifacts)
    assert len(set(artifact_paths)) == len(artifact_paths)
    assert set(artifact_paths) == {
        "registry/smeta1_profitability_evidence_registry.v1.json",
        "src/quant_edge/smeta1/__init__.py",
        "src/quant_edge/smeta1/registry.py",
        "tests/smeta1/test_smeta1_registry.py",
    }
    for value in artifacts:
        item = cast(dict[str, object], value)
        assert set(item) == {"path", "sha256"}
        artifact_path = cast(str, item["path"])
        if artifact_path == "registry/smeta1_profitability_evidence_registry.v1.json":
            path = REGISTRY_PATH
        elif artifact_path == "tests/smeta1/test_smeta1_registry.py":
            # The source-only recovery relocates evidence under tests; retain the
            # donor receipt's test hash without claiming this adapted path is identical.
            assert item["sha256"] == ORIGINAL_DONOR_TEST_SHA256
            continue
        else:
            path = QUANT_ROOT / artifact_path
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"]
    assert receipt["focusedProof"] == [
        {
            "command": ("PYTHONHASHSEED=0 uv run --locked --no-sync pytest -q tests/smeta1"),
            "expectedExitCode": 0,
            "observedExitCode": 0,
            "observedSummary": "46 passed",
        },
        {
            "command": ("uv run --locked --no-sync ruff check src/quant_edge/smeta1 tests/smeta1"),
            "expectedExitCode": 0,
            "observedExitCode": 0,
            "observedSummary": "All checks passed!",
        },
        {
            "command": (
                "uv run --locked --no-sync ruff format --check src/quant_edge/smeta1 tests/smeta1"
            ),
            "expectedExitCode": 0,
            "observedExitCode": 0,
            "observedSummary": "3 files already formatted",
        },
        {
            "command": (
                "uv run --locked --no-sync mypy --strict src/quant_edge/smeta1 tests/smeta1"
            ),
            "expectedExitCode": 0,
            "observedExitCode": 0,
            "observedSummary": "Success: no issues found in 3 source files",
        },
        {
            "command": (
                "PYTHONHASHSEED=0 uv run --locked --no-sync pytest -q "
                "tests/q14/test_q14_multiplicity_bootstrap.py "
                "tests/unit/test_canonical.py tests/smeta1"
            ),
            "expectedExitCode": 0,
            "observedExitCode": 0,
            "observedSummary": "78 passed",
        },
    ]
