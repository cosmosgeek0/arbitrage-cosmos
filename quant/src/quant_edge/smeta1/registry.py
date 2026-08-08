"""S-META1 burst-wide profitability evidence law.

The registry freezes family identities and the decision law before the active
S-1C/S-1D/S-1E/V-E1 outcomes are available.  This module deliberately consumes
only exact rational p-values and integer-scaled economics; it neither downloads
market data nor calls any account endpoint.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from fractions import Fraction
from itertools import combinations
from math import comb
from pathlib import Path
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object, require_exact_keys
from quant_edge.errors import CanonicalJsonError, ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio
from quant_edge.validation.multiplicity import (
    TrialLedgerV1,
    TrialRecordV1,
    TrialStatus,
    holm_bonferroni,
)

BASE_COMMIT: Final = "a169b123fb186d1943a75ad648552c4d95be1be1"
EXPECTED_REGISTRY_SHA256: Final = "d51fd2d7f91a4f8087afdcf8131b735e682d42d525d8967a8d556ed15f5b32c4"
REGISTRY_SCHEMA: Final = "SMeta1ProfitabilityEvidenceRegistryV1"
REGISTRY_ID: Final = "S-META1"
REGISTRY_FROZEN_AT_UTC: Final = "2026-07-28T16:10:51Z"
FAMILYWISE_ALPHA: Final = Fraction(1, 40)
FAMILY_COUNT: Final = 7
SIMULTANEOUS_LCB_ALPHA: Final = Fraction(1, 280)
FRESH_HOLDOUT_NOT_BEFORE_UTC: Final = "2026-07-29T00:00:00Z"
MAX_DRAWDOWN_BPS: Final = 4_000
MAX_CAPACITY_UTILIZATION_BPS: Final = 10_000
RANKING_LCB_UNIT: Final = "MICROUSD_PER_1000USD_PER_86400_EXPOSURE_SECONDS"
RANKING_EXPOSURE_SECONDS: Final = 86_400
RANKING_NOTIONAL_USD_CENTS: Final = 100_000
SHA256_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
COMMIT_PATTERN: Final = re.compile(r"^[0-9a-f]{40}$")
LAST_FOUR_PATTERN: Final = re.compile(r"^[0-9a-f]{4}$")
FAMILY_PATTERN: Final = re.compile(r"^F[0-9]{2}_[A-Z0-9_]+$")
PBO_COMPONENT_PATTERN: Final = re.compile(r"^[A-Z0-9_.:-]{1,120}$")
PBO_METHOD: Final = "COMBINATORIALLY_SYMMETRIC_CROSS_VALIDATION"
PBO_ROLE: Final = "DIAGNOSTIC_ONLY_NOT_P_VALUE"
PBO_SCORE_UNIT: Final = "WORST_REQUIRED_FEE_SCENARIO_CAPACITY_CAPPED_NET_MICROUSD_PER_1000USD_BLOCK"
PBO_SPLIT_LAW: Final = "ALL_CHOOSE_S_OVER_2"
PBO_TIE_LAW: Final = "LOWEST_TRIAL_ID_IS_AND_OOS_EQUALITY_COUNTS_NONPOSITIVE_LOGIT"
ATTEMPT_LEDGER_SCHEMA: Final = "SMeta1AttemptLedgerV1"
CANDIDATE_UNIVERSE_SCHEMA: Final = "SMeta1CandidateUniverseV1"

EXPECTED_FAMILIES: Final = (
    "F01_BASIS_TRIGGER_HOLD",
    "F02_VOLUME_PROXY_THRESHOLD",
    "F03_SPOT_PMA_TREND",
    "F04_USDM_POST_FUNDING_CROWD_UNWIND",
    "F05_VOLUME_ACCEPTED_EXIT_REPLAY",
    "F06_USDM_FUNDING_DISPERSION",
    "F07_SPOT_LIQUIDITY_SHOCK_REVERSAL",
)
POSITIVE_ELIGIBLE_FAMILIES: Final = EXPECTED_FAMILIES[3:]
EXPECTED_ATTEMPT_COUNTS: Final = {
    "F01_BASIS_TRIGGER_HOLD": 2_976,
    "F02_VOLUME_PROXY_THRESHOLD": 162,
    "F03_SPOT_PMA_TREND": 1,
    "F04_USDM_POST_FUNDING_CROWD_UNWIND": 24,
    "F05_VOLUME_ACCEPTED_EXIT_REPLAY": 1,
    "F06_USDM_FUNDING_DISPERSION": None,
    "F07_SPOT_LIQUIDITY_SHOCK_REVERSAL": None,
}
EXPECTED_HOLM_THRESHOLDS: Final = (
    Fraction(1, 280),
    Fraction(1, 240),
    Fraction(1, 200),
    Fraction(1, 160),
    Fraction(1, 120),
    Fraction(1, 80),
    Fraction(1, 40),
)
REQUIRED_FAMILY_GATES: Final = (
    "ADMISSIBLE_EVIDENCE",
    "CAPACITY_1000_USD",
    "DATA_PROVENANCE",
    "DRAWDOWN_CAP",
    "EXECUTION_CAUSALITY",
    "FAMILY_HOLDOUT",
    "FEE_ACCOUNT_EFFECTIVE",
    "FEE_PUBLIC_REGULAR",
    "FEE_STRESS_2BP",
    "MIN_SAMPLE",
    "PBO_DIAGNOSTIC",
)
REQUIRED_CONFIRMATION_GATES: Final = (
    "CAPACITY_1000_USD",
    "DATA_PROVENANCE",
    "DRAWDOWN_CAP",
    "FRESH_AFTER_REGISTRY_FREEZE",
    "NO_FALLBACK_AFTER_OPEN",
    "ONE_ATOMIC_OPEN",
    "REQUIRED_FEE_SCENARIOS",
)
REQUIRED_FEE_SCENARIOS: Final = (
    "ACCOUNT_EFFECTIVE_SANITIZED",
    "ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG",
    "PUBLIC_REGULAR_NO_BNB",
)
EXPECTED_CONTRACT_REFS: Final[dict[str, tuple[str, str | None, str | None, str | None]]] = {
    "S-1-P-I1": (
        "COMPLETED_PUBLISHED_REJECTED",
        None,
        "8a5b929af6100c4908578bd04a6f6b75740a3f0149cddde7fc072a8204f43ede",
        None,
    ),
    "S-1B": (
        "COMPLETED_PUBLISHED_RESEARCH_STOP",
        None,
        "de4ee4e29ad0c7345416ab3212385187e4e6fde3d3c3d35d7c0ec4aeaf9e809f",
        "548b473eeee395eb802c097fb3de2f23a32ecd29faeee52eb676ebd41249a9b6",
    ),
    "s1c-usdm-post-funding-crowd-unwind:v1": (
        "ACTIVE_PREOUTCOME_PLAN_PRESENT_UNCOMMITTED",
        "168bc42dfc92f24c827475b3c479e3946c1e9c2b8dd7e2c3ae20e201691118bf",
        "91af409fca2c7da47fef9266c60238fff0732b7f3e5a6a6208811decff993e0a",
        None,
    ),
    "S-1D": (
        "ACTIVE_FAMILY_CONTRACT_ONLY",
        "b7ba510feb9aeaadea5294550b61f60e71fe25f268a74201d33360ef706634e5",
        None,
        None,
    ),
    "S-1E": (
        "ACTIVE_FAMILY_CONTRACT_ONLY",
        "ac9c3c2b3c55413ef9f1441b97ae9832f74e18aa641833b5b49016761893aa62",
        None,
        None,
    ),
    "V-E1": (
        "ACTIVE_ACCEPTED_EXIT_CONTRACT_NO_QUANT_PLAN",
        "07cbae95f007d84aa1c0032a647840fde928ccff1b1a3633415adb7b62a9415d",
        None,
        None,
    ),
}


class GateState(StrEnum):
    """Three-valued evidence state; unavailable facts never become zero or pass."""

    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"


class FamilyDecisionState(StrEnum):
    """Pre-Holm family result supplied to the frozen burst decision."""

    QUALIFYING = "QUALIFYING"
    NO_GO = "NO_GO"
    UNKNOWN = "UNKNOWN"


class WithinFamilyProcedure(StrEnum):
    """Permitted selection-aware family inference procedures."""

    BONFERRONI_ALL_ATTEMPTS = "BONFERRONI_ALL_ATTEMPTS"
    HANSEN_SPA = "HANSEN_SPA"
    ROMANO_WOLF = "ROMANO_WOLF"
    WHITE_REALITY_CHECK = "WHITE_REALITY_CHECK"


class N3Verdict(StrEnum):
    """Only truth labels N-3 may emit from this registry."""

    VERIFIED_POSITIVE = "VERIFIED_POSITIVE"
    NO_GO = "NO_GO"
    UNKNOWN = "UNKNOWN"


def _mapping(value: object, *, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ContractValueError(f"{path} must be an object")
    return cast(dict[str, object], value)


def _array(value: object, *, path: str) -> list[object]:
    if not isinstance(value, list):
        raise ContractValueError(f"{path} must be an array")
    return cast(list[object], value)


def _text(value: object, *, path: str) -> str:
    if not isinstance(value, str) or not value:
        raise ContractValueError(f"{path} must be a non-empty string")
    return value


def _integer(value: object, *, path: str, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractValueError(f"{path} must be an integer")
    if minimum is not None and value < minimum:
        raise ContractValueError(f"{path} must be >= {minimum}")
    return value


def _boolean(value: object, *, path: str) -> bool:
    if not isinstance(value, bool):
        raise ContractValueError(f"{path} must be a boolean")
    return value


def _ratio(value: object, *, path: str) -> Fraction:
    mapping = _mapping(value, path=path)
    require_exact_keys(mapping, expected=("denominator", "numerator"), path=path)
    numerator = _integer(mapping["numerator"], path=f"{path}.numerator", minimum=0)
    denominator = _integer(mapping["denominator"], path=f"{path}.denominator", minimum=1)
    if Fraction(numerator, denominator).denominator != denominator:
        raise ContractValueError(f"{path} must be reduced")
    return Fraction(numerator, denominator)


def _require_sha256(value: object, *, path: str) -> str:
    digest = _text(value, path=path)
    if SHA256_PATTERN.fullmatch(digest) is None:
        raise ContractValueError(f"{path} must be a lowercase SHA-256 digest")
    return digest


def _gate_mapping(
    gates: tuple[tuple[str, GateState], ...],
    *,
    expected: tuple[str, ...],
    path: str,
) -> dict[str, GateState]:
    if not isinstance(gates, tuple):
        raise ContractValueError(f"{path} must be a tuple")
    result: dict[str, GateState] = {}
    for entry in gates:
        if not isinstance(entry, tuple) or len(entry) != 2:
            raise ContractValueError(f"{path} entries must be (gate_id, state)")
        gate_id, state = entry
        if not isinstance(gate_id, str) or gate_id in result:
            raise ContractValueError(f"{path} gate identities must be unique strings")
        if not isinstance(state, GateState):
            raise ContractValueError(f"{path}.{gate_id} must be GateState")
        result[gate_id] = state
    if tuple(sorted(result)) != expected:
        raise ContractValueError(f"{path} must cover the frozen gate set exactly")
    return result


def _scenario_p_mapping(
    entries: tuple[tuple[str, ExactRatioV1], ...],
    *,
    path: str,
) -> dict[str, ExactRatioV1]:
    if not isinstance(entries, tuple):
        raise ContractValueError(f"{path} must be a tuple")
    result: dict[str, ExactRatioV1] = {}
    for entry in entries:
        if not isinstance(entry, tuple) or len(entry) != 2:
            raise ContractValueError(f"{path} entries must be (scenario_id, exact_p)")
        scenario_id, p_value = entry
        if not isinstance(scenario_id, str) or scenario_id in result:
            raise ContractValueError(f"{path} scenario identities must be unique strings")
        if not isinstance(p_value, ExactRatioV1):
            raise ContractValueError(f"{path}.{scenario_id} must be ExactRatioV1")
        fraction = Fraction(p_value.numerator, p_value.denominator)
        if not 0 <= fraction <= 1:
            raise ContractValueError(f"{path}.{scenario_id} must lie in [0,1]")
        result[scenario_id] = p_value
    if tuple(sorted(result)) != REQUIRED_FEE_SCENARIOS:
        raise ContractValueError(f"{path} must cover every required fee scenario exactly")
    return result


def _scenario_lcb_mapping(
    entries: tuple[tuple[str, int], ...],
    *,
    path: str,
) -> dict[str, int]:
    if not isinstance(entries, tuple):
        raise ContractValueError(f"{path} must be a tuple")
    result: dict[str, int] = {}
    for entry in entries:
        if not isinstance(entry, tuple) or len(entry) != 2:
            raise ContractValueError(f"{path} entries must be (scenario_id, integer_lcb)")
        scenario_id, lcb = entry
        if not isinstance(scenario_id, str) or scenario_id in result:
            raise ContractValueError(f"{path} scenario identities must be unique strings")
        if isinstance(lcb, bool) or not isinstance(lcb, int):
            raise ContractValueError(f"{path}.{scenario_id} must be an integer")
        result[scenario_id] = lcb
    if tuple(sorted(result)) != REQUIRED_FEE_SCENARIOS:
        raise ContractValueError(f"{path} must cover every required fee scenario exactly")
    return result


def _utc(value: str, *, path: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ContractValueError(f"{path} must be an ISO-8601 timestamp") from error
    if not value.endswith("Z") or parsed.tzinfo != UTC:
        raise ContractValueError(f"{path} must be canonical UTC ending in Z")
    return parsed


def _canonical_sha256(mapping: dict[str, object]) -> str:
    return hashlib.sha256(canonical_json_bytes(mapping)).hexdigest()


def prior_period_inventory_sha256(
    intervals: tuple[tuple[str, str, str], ...],
) -> str:
    """Validate and digest the complete pre-holdout interval inventory."""

    if not isinstance(intervals, tuple) or not intervals:
        raise ContractValueError("prior-period inventory must be a non-empty tuple")
    canonical: list[tuple[str, str, str]] = []
    seen_ids: set[str] = set()
    for entry in intervals:
        if not isinstance(entry, tuple) or len(entry) != 3:
            raise ContractValueError(
                "prior-period entries must be (period_id, expanded_start_utc, expanded_end_utc)"
            )
        period_id, start_utc, end_utc = entry
        if (
            not isinstance(period_id, str)
            or re.fullmatch(r"[A-Z0-9_.:-]{3,120}", period_id) is None
            or period_id in seen_ids
        ):
            raise ContractValueError("prior-period identities must be unique canonical strings")
        if not isinstance(start_utc, str) or not isinstance(end_utc, str):
            raise ContractValueError("prior-period boundaries must be strings")
        start = _utc(start_utc, path=f"priorPeriodInventory.{period_id}.expandedStartUtc")
        end = _utc(end_utc, path=f"priorPeriodInventory.{period_id}.expandedEndUtc")
        if start >= end:
            raise ContractValueError("prior-period expanded start must precede expanded end")
        seen_ids.add(period_id)
        canonical.append((period_id, start_utc, end_utc))
    if canonical != sorted(canonical, key=lambda item: (item[1], item[2], item[0])):
        raise ContractValueError("prior-period inventory must use canonical chronological order")
    return _canonical_sha256(
        {
            "intervals": [
                {
                    "expandedEndBeforeEmbargoUtc": end_utc,
                    "expandedStartUtc": start_utc,
                    "periodId": period_id,
                }
                for period_id, start_utc, end_utc in canonical
            ],
            "schema": "SMeta1PriorPeriodInventoryV1",
        }
    )


def _validated_attempt_rows(
    trials: tuple[tuple[str, str, str], ...],
) -> tuple[tuple[str, str, str], ...]:
    if not isinstance(trials, tuple) or not trials:
        raise ContractValueError("attempt ledger must contain at least one trial")
    rows: list[tuple[str, str, str]] = []
    for index, entry in enumerate(trials):
        if not isinstance(entry, tuple) or len(entry) != 3:
            raise ContractValueError(
                "attempt ledger entries must be "
                "(trial_id, candidate_sha256, candidate_code_config_sha256)"
            )
        trial_id, candidate_sha256, candidate_code_config_sha256 = entry
        if not isinstance(trial_id, str) or PBO_COMPONENT_PATTERN.fullmatch(trial_id) is None:
            raise ContractValueError(f"attemptLedger.trials[{index}].trialId must be canonical")
        rows.append(
            (
                trial_id,
                _require_sha256(
                    candidate_sha256,
                    path=f"attemptLedger.trials[{index}].candidateSha256",
                ),
                _require_sha256(
                    candidate_code_config_sha256,
                    path=f"attemptLedger.trials[{index}].candidateCodeConfigSha256",
                ),
            )
        )
    trial_ids = tuple(row[0] for row in rows)
    if tuple(sorted(trial_ids)) != trial_ids or len(set(trial_ids)) != len(trial_ids):
        raise ContractValueError("attempt ledger trial identities must be unique and sorted")
    return tuple(rows)


def candidate_universe_sha256_from_attempts(
    trials: tuple[tuple[str, str, str], ...],
) -> str:
    """Digest the exact ordered trial-to-candidate identity from an attempt ledger."""

    rows = _validated_attempt_rows(trials)
    return _canonical_sha256(
        {
            "schema": CANDIDATE_UNIVERSE_SCHEMA,
            "trials": [
                {
                    "candidateCodeConfigSha256": candidate_code_config_sha256,
                    "candidateSha256": candidate_sha256,
                    "trialId": trial_id,
                }
                for trial_id, candidate_sha256, candidate_code_config_sha256 in rows
            ],
        }
    )


def attempt_ledger_bytes(
    *,
    family_id: str,
    frozen_at_utc: str,
    trials: tuple[tuple[str, str, str], ...],
) -> bytes:
    """Build the canonical complete S-META1 all-attempt ledger."""

    if family_id not in POSITIVE_ELIGIBLE_FAMILIES:
        raise ContractValueError("attempt ledger requires an active positive-eligible family")
    _utc(frozen_at_utc, path="attemptLedger.frozenAtUtc")
    rows = _validated_attempt_rows(trials)
    return canonical_json_bytes(
        {
            "attemptedHypothesisCount": len(rows),
            "familyId": family_id,
            "frozenAtUtc": frozen_at_utc,
            "registrySha256": EXPECTED_REGISTRY_SHA256,
            "schema": ATTEMPT_LEDGER_SCHEMA,
            "trials": [
                {
                    "candidateCodeConfigSha256": candidate_code_config_sha256,
                    "candidateSha256": candidate_sha256,
                    "trialId": trial_id,
                }
                for trial_id, candidate_sha256, candidate_code_config_sha256 in rows
            ],
        }
    )


def _parse_attempt_ledger(
    raw: bytes,
    *,
    expected_sha256: str,
    expected_family_id: str,
    expected_frozen_at_utc: str | None = None,
) -> tuple[str, tuple[tuple[str, str, str], ...], str]:
    try:
        ledger = parse_canonical_object(raw)
        require_exact_keys(
            ledger,
            expected=(
                "attemptedHypothesisCount",
                "familyId",
                "frozenAtUtc",
                "registrySha256",
                "schema",
                "trials",
            ),
            path="attemptLedger",
        )
        if ledger["schema"] != ATTEMPT_LEDGER_SCHEMA:
            raise ContractValueError("attempt ledger schema drifted")
        if ledger["registrySha256"] != EXPECTED_REGISTRY_SHA256:
            raise ContractValueError("attempt ledger registry binding drifted")
        if ledger["familyId"] != expected_family_id:
            raise ContractValueError("attempt ledger family binding drifted")
        frozen_at_utc = _text(
            ledger["frozenAtUtc"],
            path="attemptLedger.frozenAtUtc",
        )
        _utc(frozen_at_utc, path="attemptLedger.frozenAtUtc")
        if expected_frozen_at_utc is not None and frozen_at_utc != expected_frozen_at_utc:
            raise ContractValueError("attempt ledger frozen timestamp drifted")
        attempted_count = _integer(
            ledger["attemptedHypothesisCount"],
            path="attemptLedger.attemptedHypothesisCount",
            minimum=1,
        )
        rows: list[tuple[str, str, str]] = []
        for index, value in enumerate(_array(ledger["trials"], path="attemptLedger.trials")):
            row = _mapping(value, path=f"attemptLedger.trials[{index}]")
            require_exact_keys(
                row,
                expected=(
                    "candidateCodeConfigSha256",
                    "candidateSha256",
                    "trialId",
                ),
                path=f"attemptLedger.trials[{index}]",
            )
            rows.append(
                (
                    _text(
                        row["trialId"],
                        path=f"attemptLedger.trials[{index}].trialId",
                    ),
                    _require_sha256(
                        row["candidateSha256"],
                        path=f"attemptLedger.trials[{index}].candidateSha256",
                    ),
                    _require_sha256(
                        row["candidateCodeConfigSha256"],
                        path=(f"attemptLedger.trials[{index}].candidateCodeConfigSha256"),
                    ),
                )
            )
    except CanonicalJsonError as error:
        raise ContractValueError("attempt ledger bytes must be exact canonical JSON") from error
    validated_rows = _validated_attempt_rows(tuple(rows))
    if attempted_count != len(validated_rows):
        raise ContractValueError(
            "attempt ledger count must equal its complete canonical trial rows"
        )
    if (
        attempt_ledger_bytes(
            family_id=expected_family_id,
            frozen_at_utc=frozen_at_utc,
            trials=validated_rows,
        )
        != raw
    ):
        raise ContractValueError(
            "attempt ledger bytes must match exhaustive canonical recomputation"
        )
    observed_sha256 = hashlib.sha256(raw).hexdigest()
    if observed_sha256 != expected_sha256:
        raise ContractValueError("attempt ledger bytes and digest do not match")
    return (
        frozen_at_utc,
        validated_rows,
        candidate_universe_sha256_from_attempts(validated_rows),
    )


def pbo_diagnostic_receipt_bytes(
    *,
    family_id: str,
    candidate_sha256: str,
    candidate_code_config_sha256: str,
    candidate_locked_at_utc: str,
    selected_trial_id: str,
    attempt_ledger_bytes_value: bytes,
    attempt_ledger_sha256: str,
    within_family_inference_receipt_sha256: str,
    pbo_chronological_blocks_sha256: str,
    screened_period_end_utc: str,
    fee_evidence_sha256: str,
    execution_capacity_law_sha256: str,
    trial_ids: tuple[str, ...],
    block_ids: tuple[str, ...],
    score_matrix: tuple[tuple[int, ...], ...],
    computed_at_utc: str,
) -> bytes:
    """Build canonical, exhaustively recomputed CSCV diagnostic evidence.

    The block-score matrix is screened/development evidence, never family- or
    winner-holdout evidence. PBO is retained as a diagnostic frequency only:
    its numeric value is neither a p-value nor an input to Holm, LCBs, ranking,
    or the N-3 verdict.
    """

    if family_id not in POSITIVE_ELIGIBLE_FAMILIES:
        raise ContractValueError("PBO evidence requires an active positive-eligible family")
    for field_name, value in (
        ("candidate_sha256", candidate_sha256),
        ("candidate_code_config_sha256", candidate_code_config_sha256),
        ("attempt_ledger_sha256", attempt_ledger_sha256),
        (
            "within_family_inference_receipt_sha256",
            within_family_inference_receipt_sha256,
        ),
        ("pbo_chronological_blocks_sha256", pbo_chronological_blocks_sha256),
        ("fee_evidence_sha256", fee_evidence_sha256),
        ("execution_capacity_law_sha256", execution_capacity_law_sha256),
    ):
        _require_sha256(value, path=field_name)
    for field_name, value in (
        ("candidate_locked_at_utc", candidate_locked_at_utc),
        ("screened_period_end_utc", screened_period_end_utc),
        ("computed_at_utc", computed_at_utc),
    ):
        _utc(value, path=field_name)
    attempt_ledger_frozen_at_utc, attempt_rows, candidate_universe_sha256 = _parse_attempt_ledger(
        attempt_ledger_bytes_value,
        expected_sha256=attempt_ledger_sha256,
        expected_family_id=family_id,
    )
    attempted_hypothesis_count = len(attempt_rows)
    if EXPECTED_ATTEMPT_COUNTS[family_id] is None:
        raise ContractValueError(
            "family attempt count is UNKNOWN pending a trusted pre-outcome digest authority"
        )
    ledger_trial_ids = tuple(row[0] for row in attempt_rows)
    if not isinstance(trial_ids, tuple) or trial_ids != ledger_trial_ids:
        raise ContractValueError(
            "PBO matrix trial identities must equal the canonical attempt ledger"
        )
    selected_rows = tuple(row for row in attempt_rows if row[0] == selected_trial_id)
    if len(selected_rows) != 1:
        raise ContractValueError("PBO selected trial must occur in the complete trial matrix")
    if selected_rows[0][1:] != (
        candidate_sha256,
        candidate_code_config_sha256,
    ):
        raise ContractValueError("PBO selected trial candidate must equal the assessment candidate")
    if (
        not isinstance(block_ids, tuple)
        or not block_ids
        or tuple(sorted(block_ids)) != block_ids
        or len(set(block_ids)) != len(block_ids)
        or any(
            not isinstance(block_id, str) or PBO_COMPONENT_PATTERN.fullmatch(block_id) is None
            for block_id in block_ids
        )
    ):
        raise ContractValueError("PBO block identities must be unique sorted canonical strings")
    if not isinstance(score_matrix, tuple) or len(score_matrix) != len(trial_ids):
        raise ContractValueError("PBO score matrix must contain every attempted trial")
    for row in score_matrix:
        if (
            not isinstance(row, tuple)
            or len(row) != len(block_ids)
            or any(isinstance(value, bool) or not isinstance(value, int) for value in row)
        ):
            raise ContractValueError(
                "PBO score rows must be exact integer values for every chronological block"
            )

    split_count = 0
    nonpositive_logit_count = 0
    pbo: ExactRatioV1 | None = None
    if attempted_hypothesis_count == 1:
        if EXPECTED_ATTEMPT_COUNTS[family_id] != 1:
            raise ContractValueError(
                "single-attempt PBO N/A requires a registry-frozen expected count of one"
            )
        applicability = "NOT_APPLICABLE_EXACT_SINGLE_ATTEMPT"
    else:
        block_count = len(block_ids)
        if block_count < 4 or block_count % 2:
            raise ContractValueError(
                "applicable PBO requires at least four and an even number of blocks"
            )
        applicability = "AVAILABLE"
        half = block_count // 2
        split_count = comb(block_count, half)
        for in_sample_indexes in combinations(range(block_count), half):
            in_sample = set(in_sample_indexes)
            out_of_sample_indexes = tuple(
                index for index in range(block_count) if index not in in_sample
            )
            in_sample_scores = tuple(
                sum(row[index] for index in in_sample_indexes) for row in score_matrix
            )
            selected_index = max(
                range(len(trial_ids)),
                key=lambda index: (in_sample_scores[index], -index),
            )
            out_of_sample_scores = tuple(
                sum(row[index] for index in out_of_sample_indexes) for row in score_matrix
            )
            ordered_oos = sorted(out_of_sample_scores)
            median_twice = (
                ordered_oos[(len(ordered_oos) - 1) // 2] + ordered_oos[len(ordered_oos) // 2]
            )
            if 2 * out_of_sample_scores[selected_index] <= median_twice:
                nonpositive_logit_count += 1
        pbo = make_ratio(nonpositive_logit_count, split_count)

    matrix_mapping: dict[str, object] = {
        "blockIds": list(block_ids),
        "schema": "SMeta1PboScoreMatrixV1",
        "trials": [
            {
                "blockScoresMicrousd": list(scores),
                "trialId": trial_id,
            }
            for trial_id, scores in zip(trial_ids, score_matrix, strict=True)
        ],
    }
    score_matrix_sha256 = _canonical_sha256(matrix_mapping)
    return canonical_json_bytes(
        {
            "applicability": applicability,
            "attemptLedgerFrozenAtUtc": attempt_ledger_frozen_at_utc,
            "attemptLedgerSha256": attempt_ledger_sha256,
            "attemptedHypothesisCount": attempted_hypothesis_count,
            "candidateCodeConfigSha256": candidate_code_config_sha256,
            "candidateLockedAtUtc": candidate_locked_at_utc,
            "candidateSha256": candidate_sha256,
            "candidateUniverseSha256": candidate_universe_sha256,
            "computedAtUtc": computed_at_utc,
            "executionCapacityLawSha256": execution_capacity_law_sha256,
            "familyHoldoutOutcomeBytesAccessed": False,
            "familyId": family_id,
            "feeEvidenceSha256": fee_evidence_sha256,
            "method": PBO_METHOD,
            "nonpositiveLogitCount": nonpositive_logit_count,
            "pbo": None if pbo is None else pbo.as_mapping(),
            "pboChronologicalBlocksSha256": pbo_chronological_blocks_sha256,
            "registrySha256": EXPECTED_REGISTRY_SHA256,
            "requiredFeeScenarioIds": list(REQUIRED_FEE_SCENARIOS),
            "role": PBO_ROLE,
            "schema": "SMeta1PboDiagnosticReceiptV1",
            "scoreMatrix": matrix_mapping,
            "scoreMatrixSha256": score_matrix_sha256,
            "scoreUnit": PBO_SCORE_UNIT,
            "screenedPeriodEndUtc": screened_period_end_utc,
            "selectedTrialId": selected_trial_id,
            "splitCount": split_count,
            "splitLaw": PBO_SPLIT_LAW,
            "tieLaw": PBO_TIE_LAW,
            "withinFamilyInferenceReceiptSha256": (within_family_inference_receipt_sha256),
            "winnerHoldoutOutcomeBytesAccessed": False,
            "zeroTradeBlocksIncluded": True,
        }
    )


def _prior_period_max_end(
    intervals: tuple[tuple[str, str, str], ...],
    *,
    expected_sha256: str,
    path: str,
) -> datetime:
    observed = prior_period_inventory_sha256(intervals)
    if observed != expected_sha256:
        raise ContractValueError(f"{path} digest does not match its canonical intervals")
    return max(
        _utc(end_utc, path=f"{path}.{period_id}.expandedEndUtc")
        for period_id, _, end_utc in intervals
    )


def family_holdout_authorization_sha256(
    *,
    family_id: str,
    candidate_sha256: str,
    candidate_code_config_sha256: str,
    candidate_universe_sha256: str,
    candidate_locked_at_utc: str,
    within_family_procedure: str,
    within_family_inference_receipt_sha256: str,
    pbo_receipt_sha256: str,
    attempted_hypothesis_count: int,
    attempt_ledger_sha256: str,
    holdout_dataset_sha256: str,
    holdout_period_start_utc: str,
    holdout_period_end_utc: str,
    screened_period_end_utc: str,
    embargo_seconds: int,
    prior_period_inventory_sha256: str,
    chronological_blocks_sha256: str,
    block_seed_sha256: str,
    fee_evidence_sha256: str,
    execution_capacity_law_sha256: str,
    minimum_sample_count: int,
    block_length_samples: int,
    block_count_floor: int,
    ranking_lcb_unit: str,
    ranking_exposure_seconds: int,
    ranking_notional_usd_cents: int,
    bootstrap_replicates: int,
    authorized_at_utc: str,
) -> str:
    """Digest the complete pre-open family-holdout authorization payload."""

    return _canonical_sha256(
        {
            "attemptLedgerSha256": attempt_ledger_sha256,
            "attemptedHypothesisCount": attempted_hypothesis_count,
            "blockCountFloor": block_count_floor,
            "blockLengthSamples": block_length_samples,
            "blockSeedSha256": block_seed_sha256,
            "bootstrapReplicates": bootstrap_replicates,
            "candidateCodeConfigSha256": candidate_code_config_sha256,
            "candidateLockedAtUtc": candidate_locked_at_utc,
            "candidateSha256": candidate_sha256,
            "candidateUniverseSha256": candidate_universe_sha256,
            "chronologicalBlocksSha256": chronological_blocks_sha256,
            "familyId": family_id,
            "feeEvidenceSha256": fee_evidence_sha256,
            "executionCapacityLawSha256": execution_capacity_law_sha256,
            "holdoutEmbargoSeconds": embargo_seconds,
            "holdoutDatasetSha256": holdout_dataset_sha256,
            "holdoutPeriodEndUtc": holdout_period_end_utc,
            "holdoutPeriodStartUtc": holdout_period_start_utc,
            "minimumSampleCount": minimum_sample_count,
            "priorPeriodInventorySha256": prior_period_inventory_sha256,
            "pboReceiptSha256": pbo_receipt_sha256,
            "rankingExposureSeconds": ranking_exposure_seconds,
            "rankingLcbUnit": ranking_lcb_unit,
            "rankingNotionalUsdCents": ranking_notional_usd_cents,
            "registrySha256": EXPECTED_REGISTRY_SHA256,
            "schema": "SMeta1FamilyHoldoutAuthorizationV1",
            "screenedPeriodEndUtc": screened_period_end_utc,
            "authorizedAtUtc": authorized_at_utc,
            "withinFamilyInferenceReceiptSha256": (within_family_inference_receipt_sha256),
            "withinFamilyProcedure": within_family_procedure,
        }
    )


def winner_authorization_sha256(
    *,
    registry_sha256: str,
    assessment_set_sha256: str,
    winner_lock_receipt_sha256: str,
    winner_locked_at_utc: str,
    family_id: str,
    candidate_sha256: str,
    candidate_code_config_sha256: str,
    holdout_dataset_sha256: str,
    holdout_period_id: str,
    holdout_period_start_utc: str,
    holdout_period_end_utc: str,
    screened_period_end_utc: str,
    holdout_embargo_seconds: int,
    prior_period_inventory_sha256: str,
    authorized_fee_scenarios_sha256: str,
    authorized_execution_capacity_law_sha256: str,
    authorized_inference_config_sha256: str,
    authorized_blocks_sha256: str,
    authorized_block_seed_sha256: str,
    minimum_sample_count: int,
    block_length_samples: int,
    block_count_floor: int,
    ranking_lcb_unit: str,
    ranking_exposure_seconds: int,
    ranking_notional_usd_cents: int,
    authorized_at_utc: str,
) -> str:
    """Digest the exact atomic fresh-winner authorization payload."""

    return _canonical_sha256(
        {
            "assessmentSetSha256": assessment_set_sha256,
            "authorizedAtUtc": authorized_at_utc,
            "authorizedBlockSeedSha256": authorized_block_seed_sha256,
            "authorizedBlocksSha256": authorized_blocks_sha256,
            "authorizedFeeScenariosSha256": authorized_fee_scenarios_sha256,
            "authorizedExecutionCapacityLawSha256": (authorized_execution_capacity_law_sha256),
            "authorizedInferenceConfigSha256": authorized_inference_config_sha256,
            "blockCountFloor": block_count_floor,
            "blockLengthSamples": block_length_samples,
            "candidateCodeConfigSha256": candidate_code_config_sha256,
            "candidateSha256": candidate_sha256,
            "familyId": family_id,
            "holdoutDatasetSha256": holdout_dataset_sha256,
            "holdoutEmbargoSeconds": holdout_embargo_seconds,
            "holdoutPeriodEndUtc": holdout_period_end_utc,
            "holdoutPeriodId": holdout_period_id,
            "holdoutPeriodStartUtc": holdout_period_start_utc,
            "minimumSampleCount": minimum_sample_count,
            "priorPeriodInventorySha256": prior_period_inventory_sha256,
            "rankingExposureSeconds": ranking_exposure_seconds,
            "rankingLcbUnit": ranking_lcb_unit,
            "rankingNotionalUsdCents": ranking_notional_usd_cents,
            "registrySha256": registry_sha256,
            "schema": "SMeta1WinnerAuthorizationV1",
            "screenedPeriodEndUtc": screened_period_end_utc,
            "winnerLockReceiptSha256": winner_lock_receipt_sha256,
            "winnerLockedAtUtc": winner_locked_at_utc,
        }
    )


def holdout_open_sha256(
    *,
    authorization_receipt_sha256: str,
    holdout_dataset_sha256: str,
    opened_at_utc: str,
    open_count: int,
) -> str:
    """Bind an atomic first-access receipt to the authorized dataset."""

    return _canonical_sha256(
        {
            "authorizationReceiptSha256": authorization_receipt_sha256,
            "holdoutDatasetSha256": holdout_dataset_sha256,
            "openCount": open_count,
            "openedAtUtc": opened_at_utc,
            "schema": "SMeta1HoldoutOpenReceiptV1",
        }
    )


def ranking_normalization_sha256(
    *,
    required_scenario_lcbs: tuple[tuple[str, int], ...],
    ranking_lcb_unit: str,
    ranking_exposure_seconds: int,
    ranking_notional_usd_cents: int,
) -> str:
    """Bind all family winner scores to one wall-clock exposure denominator."""

    return _canonical_sha256(
        {
            "rankingExposureSeconds": ranking_exposure_seconds,
            "rankingLcbUnit": ranking_lcb_unit,
            "rankingNotionalUsdCents": ranking_notional_usd_cents,
            "requiredScenarioLcbValues": [
                {"scenarioId": scenario_id, "value": value}
                for scenario_id, value in required_scenario_lcbs
            ],
            "schema": "SMeta1RankingNormalizationV1",
            "zeroTradeIntervalsIncluded": True,
        }
    )


def holdout_result_receipt_bytes(
    *,
    scope: str,
    candidate_sha256: str,
    candidate_code_config_sha256: str,
    open_receipt_sha256: str,
    inference_procedure: str,
    inference_config_sha256: str,
    pbo_receipt_sha256: str | None,
    result_bytes_sha256: str,
    result_at_utc: str,
    fee_evidence_sha256: str,
    execution_capacity_law_sha256: str,
    execution_capacity_drawdown_evidence_sha256: str,
    chronological_blocks_sha256: str,
    bootstrap_replicates: int,
    required_scenario_null_exceedances: tuple[tuple[str, int], ...],
    required_scenario_p_values: tuple[tuple[str, ExactRatioV1], ...],
    raw_p_value: ExactRatioV1,
    lcb_alpha: ExactRatioV1,
    required_scenario_lcbs: tuple[tuple[str, int], ...],
    aggregate_lcb: int,
    observed_sample_count: int,
    effective_block_count: int,
    stress_drawdown_bps: int,
    capacity_utilization_bps: int,
    fallback_used: bool,
    post_open_mutation: bool,
    reused_screened_period: bool,
    tested_candidate_count: int,
    result_state: str,
    gates: tuple[tuple[str, GateState], ...],
) -> bytes:
    """Build the canonical receipt payload for a measured holdout result."""

    if scope not in {"FAMILY", "WINNER"}:
        raise ContractValueError("holdout result scope must be FAMILY or WINNER")
    if scope == "FAMILY":
        _require_sha256(pbo_receipt_sha256, path="pbo_receipt_sha256")
    elif pbo_receipt_sha256 is not None:
        raise ContractValueError("winner holdout result may not carry a family PBO receipt")
    return canonical_json_bytes(
        {
            "aggregateLcb": aggregate_lcb,
            "bootstrapReplicates": bootstrap_replicates,
            "candidateCodeConfigSha256": candidate_code_config_sha256,
            "candidateSha256": candidate_sha256,
            "chronologicalBlocksSha256": chronological_blocks_sha256,
            "effectiveBlockCount": effective_block_count,
            "executionCapacityDrawdownEvidenceSha256": (
                execution_capacity_drawdown_evidence_sha256
            ),
            "executionCapacityLawSha256": execution_capacity_law_sha256,
            "feeEvidenceSha256": fee_evidence_sha256,
            "fallbackUsed": fallback_used,
            "gates": [{"gateId": gate_id, "state": state.value} for gate_id, state in gates],
            "inferenceConfigSha256": inference_config_sha256,
            "inferenceProcedure": inference_procedure,
            "lcbAlpha": lcb_alpha.as_mapping(),
            "observedSampleCount": observed_sample_count,
            "openReceiptSha256": open_receipt_sha256,
            "pboReceiptSha256": pbo_receipt_sha256,
            "postOpenMutation": post_open_mutation,
            "rawPValue": raw_p_value.as_mapping(),
            "requiredScenarioLcbValues": [
                {"scenarioId": scenario_id, "value": value}
                for scenario_id, value in required_scenario_lcbs
            ],
            "requiredScenarioNullExceedances": [
                {"scenarioId": scenario_id, "value": value}
                for scenario_id, value in required_scenario_null_exceedances
            ],
            "requiredScenarioPValues": [
                {"scenarioId": scenario_id, "value": value.as_mapping()}
                for scenario_id, value in required_scenario_p_values
            ],
            "resultAtUtc": result_at_utc,
            "resultBytesSha256": result_bytes_sha256,
            "resultState": result_state,
            "reusedScreenedPeriod": reused_screened_period,
            "schema": f"SMeta1{scope.title()}HoldoutResultV1",
            "stressDrawdownBps": stress_drawdown_bps,
            "capacityUtilizationBps": capacity_utilization_bps,
            "testedCandidateCount": tested_candidate_count,
        }
    )


def holdout_measured_result_bytes(
    *,
    scope: str,
    family_id: str,
    authorization_receipt_sha256: str,
    candidate_sha256: str,
    candidate_code_config_sha256: str,
    open_receipt_sha256: str,
    inference_procedure: str,
    inference_config_sha256: str,
    pbo_receipt_sha256: str | None,
    result_at_utc: str,
    fee_evidence_sha256: str,
    execution_capacity_law_sha256: str,
    execution_capacity_drawdown_evidence_sha256: str,
    chronological_blocks_sha256: str,
    bootstrap_replicates: int,
    required_scenario_null_exceedances: tuple[tuple[str, int], ...],
    required_scenario_p_values: tuple[tuple[str, ExactRatioV1], ...],
    raw_p_value: ExactRatioV1,
    lcb_alpha: ExactRatioV1,
    required_scenario_lcbs: tuple[tuple[str, int], ...],
    aggregate_lcb: int,
    observed_sample_count: int,
    effective_block_count: int,
    stress_drawdown_bps: int,
    capacity_utilization_bps: int,
    fallback_used: bool,
    post_open_mutation: bool,
    reused_screened_period: bool,
    tested_candidate_count: int,
    result_state: str,
    gates: tuple[tuple[str, GateState], ...],
) -> bytes:
    """Build actual canonical measured bytes for a family or winner holdout."""

    if family_id not in POSITIVE_ELIGIBLE_FAMILIES:
        raise ContractValueError("measured holdout result family must be positive-eligible")
    if scope not in {"FAMILY", "WINNER"}:
        raise ContractValueError("measured holdout result scope must be FAMILY or WINNER")
    if scope == "FAMILY":
        _require_sha256(pbo_receipt_sha256, path="pbo_receipt_sha256")
    elif pbo_receipt_sha256 is not None:
        raise ContractValueError("winner measured result may not carry a family PBO receipt")
    return canonical_json_bytes(
        {
            "aggregateLcb": aggregate_lcb,
            "authorizationReceiptSha256": authorization_receipt_sha256,
            "bootstrapReplicates": bootstrap_replicates,
            "candidateCodeConfigSha256": candidate_code_config_sha256,
            "candidateSha256": candidate_sha256,
            "capacityUtilizationBps": capacity_utilization_bps,
            "chronologicalBlocksSha256": chronological_blocks_sha256,
            "effectiveBlockCount": effective_block_count,
            "executionCapacityDrawdownEvidenceSha256": (
                execution_capacity_drawdown_evidence_sha256
            ),
            "executionCapacityLawSha256": execution_capacity_law_sha256,
            "fallbackUsed": fallback_used,
            "familyId": family_id,
            "feeEvidenceSha256": fee_evidence_sha256,
            "gates": [{"gateId": gate_id, "state": state.value} for gate_id, state in gates],
            "inferenceConfigSha256": inference_config_sha256,
            "inferenceProcedure": inference_procedure,
            "lcbAlpha": lcb_alpha.as_mapping(),
            "observedSampleCount": observed_sample_count,
            "openReceiptSha256": open_receipt_sha256,
            "pboReceiptSha256": pbo_receipt_sha256,
            "postOpenMutation": post_open_mutation,
            "rawPValue": raw_p_value.as_mapping(),
            "requiredScenarioLcbValues": [
                {"scenarioId": scenario_id, "value": value}
                for scenario_id, value in required_scenario_lcbs
            ],
            "requiredScenarioNullExceedances": [
                {"scenarioId": scenario_id, "value": value}
                for scenario_id, value in required_scenario_null_exceedances
            ],
            "requiredScenarioPValues": [
                {"scenarioId": scenario_id, "value": value.as_mapping()}
                for scenario_id, value in required_scenario_p_values
            ],
            "resultAtUtc": result_at_utc,
            "resultState": result_state,
            "reusedScreenedPeriod": reused_screened_period,
            "schema": f"SMeta1{scope.title()}MeasuredResultV1",
            "stressDrawdownBps": stress_drawdown_bps,
            "testedCandidateCount": tested_candidate_count,
        }
    )


def holdout_result_sha256(
    *,
    scope: str,
    candidate_sha256: str,
    candidate_code_config_sha256: str,
    open_receipt_sha256: str,
    inference_procedure: str,
    inference_config_sha256: str,
    pbo_receipt_sha256: str | None,
    result_bytes_sha256: str,
    result_at_utc: str,
    fee_evidence_sha256: str,
    execution_capacity_law_sha256: str,
    execution_capacity_drawdown_evidence_sha256: str,
    chronological_blocks_sha256: str,
    bootstrap_replicates: int,
    required_scenario_null_exceedances: tuple[tuple[str, int], ...],
    required_scenario_p_values: tuple[tuple[str, ExactRatioV1], ...],
    raw_p_value: ExactRatioV1,
    lcb_alpha: ExactRatioV1,
    required_scenario_lcbs: tuple[tuple[str, int], ...],
    aggregate_lcb: int,
    observed_sample_count: int,
    effective_block_count: int,
    stress_drawdown_bps: int,
    capacity_utilization_bps: int,
    fallback_used: bool,
    post_open_mutation: bool,
    reused_screened_period: bool,
    tested_candidate_count: int,
    result_state: str,
    gates: tuple[tuple[str, GateState], ...],
) -> str:
    """Digest the complete canonical measured family or winner holdout result."""

    return hashlib.sha256(
        holdout_result_receipt_bytes(
            scope=scope,
            candidate_sha256=candidate_sha256,
            candidate_code_config_sha256=candidate_code_config_sha256,
            open_receipt_sha256=open_receipt_sha256,
            inference_procedure=inference_procedure,
            inference_config_sha256=inference_config_sha256,
            pbo_receipt_sha256=pbo_receipt_sha256,
            result_bytes_sha256=result_bytes_sha256,
            result_at_utc=result_at_utc,
            fee_evidence_sha256=fee_evidence_sha256,
            execution_capacity_law_sha256=execution_capacity_law_sha256,
            execution_capacity_drawdown_evidence_sha256=(
                execution_capacity_drawdown_evidence_sha256
            ),
            chronological_blocks_sha256=chronological_blocks_sha256,
            bootstrap_replicates=bootstrap_replicates,
            required_scenario_null_exceedances=required_scenario_null_exceedances,
            required_scenario_p_values=required_scenario_p_values,
            raw_p_value=raw_p_value,
            lcb_alpha=lcb_alpha,
            required_scenario_lcbs=required_scenario_lcbs,
            aggregate_lcb=aggregate_lcb,
            observed_sample_count=observed_sample_count,
            effective_block_count=effective_block_count,
            stress_drawdown_bps=stress_drawdown_bps,
            capacity_utilization_bps=capacity_utilization_bps,
            fallback_used=fallback_used,
            post_open_mutation=post_open_mutation,
            reused_screened_period=reused_screened_period,
            tested_candidate_count=tested_candidate_count,
            result_state=result_state,
            gates=gates,
        )
    ).hexdigest()


def holdout_integrity_failure_sha256(
    *,
    open_receipt_sha256: str,
    fallback_used: bool,
    post_open_mutation: bool,
    reused_screened_period: bool,
    tested_candidate_count: int,
) -> str:
    """Digest independently evidenced post-open protocol contamination."""

    return _canonical_sha256(
        {
            "fallbackUsed": fallback_used,
            "openReceiptSha256": open_receipt_sha256,
            "postOpenMutation": post_open_mutation,
            "reusedScreenedPeriod": reused_screened_period,
            "schema": "SMeta1HoldoutIntegrityFailureV1",
            "testedCandidateCount": tested_candidate_count,
        }
    )


def terminal_family_failure_sha256(
    *,
    family_id: str,
    attempted_hypothesis_count: int,
    attempt_ledger_sha256: str,
    attempt_ledger_frozen_at_utc: str,
    first_outcome_access_at_utc: str,
    terminal_reason_code: str,
    gates: tuple[tuple[str, GateState], ...],
    terminal_evidence_bytes_sha256: str,
    terminal_evidence_at_utc: str,
) -> str:
    """Digest a conclusive active-family failure without admitting a free SHA claim."""

    return _canonical_sha256(
        {
            "attemptLedgerFrozenAtUtc": attempt_ledger_frozen_at_utc,
            "attemptLedgerSha256": attempt_ledger_sha256,
            "attemptedHypothesisCount": attempted_hypothesis_count,
            "familyId": family_id,
            "firstOutcomeAccessAtUtc": first_outcome_access_at_utc,
            "gates": [{"gateId": gate_id, "state": state.value} for gate_id, state in gates],
            "registrySha256": EXPECTED_REGISTRY_SHA256,
            "schema": "SMeta1TerminalFamilyFailureV1",
            "terminalEvidenceAtUtc": terminal_evidence_at_utc,
            "terminalEvidenceBytesSha256": terminal_evidence_bytes_sha256,
            "terminalReasonCode": terminal_reason_code,
        }
    )


@dataclass(frozen=True, slots=True)
class SMeta1RegistryV1:
    """Validated projection of the canonical registry bytes."""

    path: Path
    sha256: str
    frozen_at_utc: str
    family_ids: tuple[str, ...]
    attempted_hypothesis_counts: tuple[int | None, ...]

    def __post_init__(self) -> None:
        if self.family_ids != EXPECTED_FAMILIES:
            raise ContractValueError("family_ids drifted from the frozen family universe")
        expected_counts = tuple(
            EXPECTED_ATTEMPT_COUNTS[family_id] for family_id in EXPECTED_FAMILIES
        )
        if self.attempted_hypothesis_counts != expected_counts:
            raise ContractValueError("attempt counts drifted from the frozen family universe")
        _require_sha256(self.sha256, path="registry.sha256")
        if self.sha256 != EXPECTED_REGISTRY_SHA256:
            raise ContractValueError("registry projection must bind the exact frozen digest")
        _utc(self.frozen_at_utc, path="registry.frozen_at_utc")
        if self.frozen_at_utc != REGISTRY_FROZEN_AT_UTC:
            raise ContractValueError("registry projection freeze timestamp drifted")


def _validate_families(raw: object) -> tuple[tuple[str, ...], tuple[int | None, ...]]:
    entries = _array(raw, path="$.strategyFamilies")
    if len(entries) != FAMILY_COUNT:
        raise ContractValueError("$.strategyFamilies must contain exactly seven entries")
    family_ids: list[str] = []
    counts: list[int | None] = []
    for index, value in enumerate(entries, start=1):
        path = f"$.strategyFamilies[{index - 1}]"
        item = _mapping(value, path=path)
        require_exact_keys(
            item,
            expected=(
                "attemptComponents",
                "attemptLedgerState",
                "attemptedHypothesisCount",
                "canonicalIdentity",
                "evidenceStateAtFreeze",
                "familyId",
                "minimumAttemptedHypothesisCount",
                "ordinal",
                "preOutcomeContractState",
                "sourceRefs",
            ),
            path=path,
        )
        family_id = _text(item["familyId"], path=f"{path}.familyId")
        if FAMILY_PATTERN.fullmatch(family_id) is None:
            raise ContractValueError(f"{path}.familyId is not canonical")
        if family_id != EXPECTED_FAMILIES[index - 1]:
            raise ContractValueError(f"{path}.familyId violates frozen order or identity")
        if _integer(item["ordinal"], path=f"{path}.ordinal", minimum=1) != index:
            raise ContractValueError(f"{path}.ordinal must equal {index}")
        identity = _mapping(item["canonicalIdentity"], path=f"{path}.canonicalIdentity")
        for field in ("data", "direction", "entry", "exit", "venue"):
            _text(identity.get(field), path=f"{path}.canonicalIdentity.{field}")
        attempted = item["attemptedHypothesisCount"]
        count = (
            None
            if attempted is None
            else _integer(attempted, path=f"{path}.attemptedHypothesisCount", minimum=1)
        )
        if count != EXPECTED_ATTEMPT_COUNTS[family_id]:
            raise ContractValueError(f"{path}.attemptedHypothesisCount drifted")
        minimum = _integer(
            item["minimumAttemptedHypothesisCount"],
            path=f"{path}.minimumAttemptedHypothesisCount",
            minimum=1,
        )
        if count is not None and minimum != count:
            raise ContractValueError(f"{path} exact attempt count must equal its minimum")
        if count is None:
            if minimum != 1:
                raise ContractValueError(f"{path} pending family must reserve at least one attempt")
            if (
                _text(item["attemptLedgerState"], path=f"{path}.attemptLedgerState")
                != "LOWER_BOUND_PENDING_PREOUTCOME_MANIFEST"
            ):
                raise ContractValueError(f"{path} pending count must fail closed")
        _array(item["attemptComponents"], path=f"{path}.attemptComponents")
        _text(item["evidenceStateAtFreeze"], path=f"{path}.evidenceStateAtFreeze")
        _text(item["preOutcomeContractState"], path=f"{path}.preOutcomeContractState")
        _array(item["sourceRefs"], path=f"{path}.sourceRefs")
        family_ids.append(family_id)
        counts.append(count)
    if len(set(family_ids)) != FAMILY_COUNT:
        raise ContractValueError("$.strategyFamilies identities must be unique")
    if family_ids[1] == family_ids[4]:
        raise ContractValueError("proxy-threshold and accepted-exit families must remain distinct")
    return tuple(family_ids), tuple(counts)


def _validate_multiplicity(raw: object) -> None:
    value = _mapping(raw, path="$.multiplicity")
    if _integer(value.get("attemptedFamilyCount"), path="$.multiplicity.attemptedFamilyCount") != 7:
        raise ContractValueError("$.multiplicity.attemptedFamilyCount must equal seven")
    if (
        _ratio(value.get("familywiseAlpha"), path="$.multiplicity.familywiseAlpha")
        != FAMILYWISE_ALPHA
    ):
        raise ContractValueError("$.multiplicity.familywiseAlpha must equal 1/40")
    if _boolean(
        value.get("fdrMaySupportVerifiedPositive"),
        path="$.multiplicity.fdrMaySupportVerifiedPositive",
    ):
        raise ContractValueError("FDR may not support VERIFIED_POSITIVE")
    thresholds = tuple(
        _ratio(item, path=f"$.multiplicity.holmRankThresholds[{index}]")
        for index, item in enumerate(
            _array(value.get("holmRankThresholds"), path="$.multiplicity.holmRankThresholds")
        )
    )
    if thresholds != EXPECTED_HOLM_THRESHOLDS:
        raise ContractValueError("$.multiplicity.holmRankThresholds drifted")
    if (
        _ratio(value.get("simultaneousLcbAlpha"), path="$.multiplicity.simultaneousLcbAlpha")
        != SIMULTANEOUS_LCB_ALPHA
    ):
        raise ContractValueError("$.multiplicity.simultaneousLcbAlpha must equal 1/280")
    if (
        _integer(value.get("bootstrapReplicates"), path="$.multiplicity.bootstrapReplicates")
        != 4_096
    ):
        raise ContractValueError("$.multiplicity.bootstrapReplicates must equal 4096")
    if (
        _integer(
            value.get("firstRankMaximumExceedances"),
            path="$.multiplicity.firstRankMaximumExceedances",
        )
        != 13
    ):
        raise ContractValueError("$.multiplicity.firstRankMaximumExceedances must equal 13")
    if (
        _text(
            value.get("missingOrInadmissibleFamilyP"),
            path="$.multiplicity.missingOrInadmissibleFamilyP",
        )
        != "1/1"
    ):
        raise ContractValueError("missing or inadmissible family evidence must remain p=1")
    procedures = {
        _text(item, path="$.multiplicity.withinFamilyAllowedProcedures[]")
        for item in _array(
            value.get("withinFamilyAllowedProcedures"),
            path="$.multiplicity.withinFamilyAllowedProcedures",
        )
    }
    if procedures != {
        "BONFERRONI_ALL_ATTEMPTS",
        "HANSEN_SPA",
        "ROMANO_WOLF",
        "WHITE_REALITY_CHECK",
    }:
        raise ContractValueError("$.multiplicity.withinFamilyAllowedProcedures drifted")


def _validate_contract_refs(raw: object) -> None:
    entries = _array(raw, path="$.contractRefs")
    if len(entries) != len(EXPECTED_CONTRACT_REFS):
        raise ContractValueError("$.contractRefs must cover the frozen source contracts")
    found: dict[str, tuple[str, str | None, str | None, str | None]] = {}
    for index, value in enumerate(entries):
        path = f"$.contractRefs[{index}]"
        item = _mapping(value, path=path)
        require_exact_keys(
            item,
            expected=(
                "contractId",
                "planPath",
                "planSha256",
                "preOutcomePromptSha256",
                "sourceCommit",
                "stateAtFreeze",
                "taskIdLast4",
                "terminalEvidenceCommit",
                "terminalEvidencePath",
                "terminalEvidenceSha256",
            ),
            path=path,
        )
        contract_id = _text(item["contractId"], path=f"{path}.contractId")
        if contract_id in found:
            raise ContractValueError(f"{path}.contractId is duplicated")
        task_last_four = _text(item["taskIdLast4"], path=f"{path}.taskIdLast4")
        if LAST_FOUR_PATTERN.fullmatch(task_last_four) is None:
            raise ContractValueError(f"{path}.taskIdLast4 must be four lowercase hex digits")
        state = _text(item["stateAtFreeze"], path=f"{path}.stateAtFreeze")
        prompt = (
            None
            if item["preOutcomePromptSha256"] is None
            else _require_sha256(
                item["preOutcomePromptSha256"],
                path=f"{path}.preOutcomePromptSha256",
            )
        )
        plan_sha = (
            None
            if item["planSha256"] is None
            else _require_sha256(item["planSha256"], path=f"{path}.planSha256")
        )
        terminal_sha = (
            None
            if item["terminalEvidenceSha256"] is None
            else _require_sha256(
                item["terminalEvidenceSha256"],
                path=f"{path}.terminalEvidenceSha256",
            )
        )
        for field in ("sourceCommit", "terminalEvidenceCommit"):
            commit = item[field]
            if commit is not None and (
                not isinstance(commit, str) or COMMIT_PATTERN.fullmatch(commit) is None
            ):
                raise ContractValueError(f"{path}.{field} must be a full commit or null")
        for path_field, digest in (
            ("planPath", plan_sha),
            ("terminalEvidencePath", terminal_sha),
        ):
            artifact_path = item[path_field]
            if (artifact_path is None) != (digest is None):
                raise ContractValueError(f"{path}.{path_field} and its digest must appear together")
            if artifact_path is not None:
                text = _text(artifact_path, path=f"{path}.{path_field}")
                if not text.startswith("quant/") or text.startswith("/"):
                    raise ContractValueError(f"{path}.{path_field} must be a quant path")
        found[contract_id] = (state, prompt, plan_sha, terminal_sha)
    if found != EXPECTED_CONTRACT_REFS:
        raise ContractValueError("$.contractRefs drifted from the pre-outcome source contract")


def _validate_admissibility(raw: object) -> None:
    value = _mapping(raw, path="$.admissibility")
    if (
        _text(value.get("pboRole"), path="$.admissibility.pboRole")
        != "DIAGNOSTIC_GATE_NOT_A_P_VALUE"
    ):
        raise ContractValueError("$.admissibility PBO role drifted")
    if "UNKNOWN" not in _text(value.get("unknownLaw"), path="$.admissibility.unknownLaw"):
        raise ContractValueError("$.admissibility unknown law must fail closed")
    timestamp = _mapping(
        value.get("spotArchiveTimestampLaw"),
        path="$.admissibility.spotArchiveTimestampLaw",
    )
    if (
        _text(
            timestamp.get("cutoverUtc"),
            path="$.admissibility.spotArchiveTimestampLaw.cutoverUtc",
        )
        != "2025-01-01T00:00:00Z"
        or _text(
            timestamp.get("beforeCutoverUnit"),
            path="$.admissibility.spotArchiveTimestampLaw.beforeCutoverUnit",
        )
        != "MILLISECONDS"
        or _text(
            timestamp.get("onOrAfterCutoverUnit"),
            path="$.admissibility.spotArchiveTimestampLaw.onOrAfterCutoverUnit",
        )
        != "MICROSECONDS"
        or not _boolean(
            timestamp.get("perPartitionValidationRequired"),
            path="$.admissibility.spotArchiveTimestampLaw.perPartitionValidationRequired",
        )
        or not _boolean(
            timestamp.get("singleGlobalScaleForbidden"),
            path="$.admissibility.spotArchiveTimestampLaw.singleGlobalScaleForbidden",
        )
    ):
        raise ContractValueError("$.admissibility Spot timestamp cutover law drifted")


def _validate_fee_truth(raw: object) -> None:
    value = _mapping(raw, path="$.feeScenarioTruth")
    required = tuple(
        _text(item, path="$.feeScenarioTruth.requiredScenarioIds[]")
        for item in _array(
            value.get("requiredScenarioIds"),
            path="$.feeScenarioTruth.requiredScenarioIds",
        )
    )
    expected = (
        "ACCOUNT_EFFECTIVE_SANITIZED",
        "ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG",
        "PUBLIC_REGULAR_NO_BNB",
    )
    if tuple(sorted(required)) != expected:
        raise ContractValueError("$.feeScenarioTruth required scenarios drifted")
    if (
        _text(value.get("combinationLaw"), path="$.feeScenarioTruth.combinationLaw")
        != "INTERSECTION_UNION_MAX_P"
    ):
        raise ContractValueError("$.feeScenarioTruth must use max-p intersection-union")
    if not _boolean(
        value.get("unknownCostsRemainUnknown"), path="$.feeScenarioTruth.unknownCostsRemainUnknown"
    ):
        raise ContractValueError("$.feeScenarioTruth may not coerce unknown costs to zero")
    scenarios = _array(value.get("scenarios"), path="$.feeScenarioTruth.scenarios")
    by_id: dict[str, dict[str, object]] = {}
    for item in scenarios:
        scenario = _mapping(item, path="$.feeScenarioTruth.scenarios[]")
        scenario_id = _text(scenario.get("scenarioId"), path="scenarioId")
        if scenario_id in by_id:
            raise ContractValueError("$.feeScenarioTruth scenario IDs must be unique")
        by_id[scenario_id] = scenario
    scenario_ids = set(by_id)
    if not set(required).issubset(scenario_ids):
        raise ContractValueError("$.feeScenarioTruth scenarios do not cover required IDs")
    public = by_id["PUBLIC_REGULAR_NO_BNB"]
    if (
        _integer(public.get("spotMakerBps"), path="public.spotMakerBps") != 10
        or _integer(public.get("spotTakerBps"), path="public.spotTakerBps") != 10
        or public.get("usdmMakerBps") is not None
        or public.get("usdmTakerBps") is not None
    ):
        raise ContractValueError("public regular fee truth drifted")
    if not _boolean(public.get("required"), path="public.required"):
        raise ContractValueError("public regular fee scenario must be required")
    account = by_id["ACCOUNT_EFFECTIVE_SANITIZED"]
    if not _boolean(account.get("required"), path="account.required"):
        raise ContractValueError("account-effective scenario must be required")
    for field in ("spotMakerBps", "spotTakerBps", "usdmMakerBps", "usdmTakerBps"):
        if account.get(field) is not None:
            raise ContractValueError("account-effective rates must remain unknown at freeze")
    if (
        tuple(
            _text(item, path="account.spotBnbDiscountAppliesTo[]")
            for item in _array(
                account.get("spotBnbDiscountAppliesTo"),
                path="account.spotBnbDiscountAppliesTo",
            )
        )
        != ("STANDARD_COMMISSION_ONLY",)
        or _integer(
            account.get("taxAndSpecialDiscountPercent"),
            path="account.taxAndSpecialDiscountPercent",
        )
        != 0
        or not _boolean(
            account.get("bnbToggleSymbolEligibilityAndPerFillBalanceSufficiencyRequired"),
            path="account.bnbToggleSymbolEligibilityAndPerFillBalanceSufficiencyRequired",
        )
    ):
        raise ContractValueError("account-effective BNB application law drifted")
    stress = by_id["ADVERSE_PLUS_2_BPS_PER_SIDE_PER_FILL_LEG"]
    if (
        not _boolean(stress.get("required"), path="stress.required")
        or _integer(stress.get("additiveBps"), path="stress.additiveBps") != 2
    ):
        raise ContractValueError("adverse fee stress must be required at two bps")
    sensitivity = by_id["BNB_OR_PROMOTION_SENSITIVITY_ONLY"]
    if (
        _boolean(sensitivity.get("required"), path="bnb.required")
        or _text(sensitivity.get("fixedPointLaw"), path="bnb.fixedPointLaw")
        != "bps=coefficient*10^(-scale)"
        or _integer(
            sensitivity.get("spotAdvertisedMakerBpsCoefficient"),
            path="bnb.spotAdvertisedMakerBpsCoefficient",
        )
        != 75
        or _integer(
            sensitivity.get("spotAdvertisedMakerBpsScale"),
            path="bnb.spotAdvertisedMakerBpsScale",
        )
        != 1
        or _integer(
            sensitivity.get("spotAdvertisedTakerBpsCoefficient"),
            path="bnb.spotAdvertisedTakerBpsCoefficient",
        )
        != 75
        or _integer(
            sensitivity.get("spotAdvertisedTakerBpsScale"),
            path="bnb.spotAdvertisedTakerBpsScale",
        )
        != 1
        or _integer(
            sensitivity.get("usdmAdvertisedStandardFeeDiscountPercent"),
            path="bnb.usdmAdvertisedStandardFeeDiscountPercent",
        )
        != 10
    ):
        raise ContractValueError("BNB sensitivity law drifted")
    futures_example = by_id["USDM_2_5_BPS_FAQ_EXAMPLE_ONLY"]
    if (
        _boolean(futures_example.get("required"), path="futuresExample.required")
        or _integer(
            futures_example.get("usdmExampleMakerBps"),
            path="futuresExample.usdmExampleMakerBps",
        )
        != 2
        or _integer(
            futures_example.get("usdmExampleTakerBps"),
            path="futuresExample.usdmExampleTakerBps",
        )
        != 5
        or _text(futures_example.get("state"), path="futuresExample.state")
        != "HYPOTHETICAL_EXAMPLE_NEVER_RATE_TRUTH"
    ):
        raise ContractValueError("USD-M hypothetical fee example law drifted")


def _validate_holdout_and_verdict(root: dict[str, object]) -> None:
    holdout = _mapping(root["holdoutRules"], path="$.holdoutRules")
    if (
        _text(
            holdout.get("freshWinnerHoldoutNotBeforeUtc"),
            path="$.holdoutRules.freshWinnerHoldoutNotBeforeUtc",
        )
        != FRESH_HOLDOUT_NOT_BEFORE_UTC
    ):
        raise ContractValueError("$.holdoutRules fresh holdout boundary drifted")
    if _integer(holdout.get("maximumOpenCount"), path="$.holdoutRules.maximumOpenCount") != 1:
        raise ContractValueError("$.holdoutRules maximumOpenCount must equal one")
    for field in (
        "atomicAuthorizationOpenResult",
        "canonicalAuthorizationOpenAndResultDigestsRequired",
        "canonicalPriorPeriodIntervalsRequired",
        "completePriorPeriodInventoryDigestRequired",
        "familyHoldoutIndependentCandidateRequired",
        "freezeBeforeBytes",
        "noFallbackAfterOpen",
        "postOpenMutationContaminates",
        "reusedScreenedPeriodsProhibited",
    ):
        if not _boolean(holdout.get(field), path=f"$.holdoutRules.{field}"):
            raise ContractValueError(f"$.holdoutRules.{field} must be true")
    if (
        _integer(
            holdout.get("familyHoldoutTestedCandidateCount"),
            path="$.holdoutRules.familyHoldoutTestedCandidateCount",
        )
        != 1
    ):
        raise ContractValueError("$.holdoutRules family holdout must test one candidate")
    verdict = _mapping(root["verdictPolicy"], path="$.verdictPolicy")
    if _text(verdict.get("capitalAuthority"), path="$.verdictPolicy.capitalAuthority") != "NONE":
        raise ContractValueError("$.verdictPolicy must grant no capital authority")
    labels = tuple(
        _text(item, path="$.verdictPolicy.allowedLabels[]")
        for item in _array(verdict.get("allowedLabels"), path="$.verdictPolicy.allowedLabels")
    )
    if labels != ("NO_GO", "UNKNOWN", "VERIFIED_POSITIVE"):
        raise ContractValueError("$.verdictPolicy labels drifted")
    winner = _mapping(root["winnerPolicy"], path="$.winnerPolicy")
    if _integer(winner.get("maximumWinners"), path="$.winnerPolicy.maximumWinners") != 1:
        raise ContractValueError("$.winnerPolicy permits more than one winner")
    if (
        _text(winner.get("authorizedNextAction"), path="$.winnerPolicy.authorizedNextAction")
        != "FORWARD_SHADOW_ONLY"
    ):
        raise ContractValueError("$.winnerPolicy action exceeds validation scope")
    ranking = tuple(
        _text(item, path="$.winnerPolicy.ranking[]")
        for item in _array(winner.get("ranking"), path="$.winnerPolicy.ranking")
    )
    if ranking != (
        "MIN_REQUIRED_SCENARIO_CAPACITY_CAPPED_LCB_MICROUSD_PER_1000USD_PER_UTC_DAY_DESC",
        "STRESS_DRAWDOWN_ASC",
        "CAPACITY_UTILIZATION_ASC",
        "FAMILY_ID_ASC",
    ):
        raise ContractValueError("$.winnerPolicy ranking drifted")
    if (
        _text(winner.get("rankingMetricUnit"), path="$.winnerPolicy.rankingMetricUnit")
        != RANKING_LCB_UNIT
        or _integer(
            winner.get("rankingExposureSeconds"),
            path="$.winnerPolicy.rankingExposureSeconds",
        )
        != RANKING_EXPOSURE_SECONDS
    ):
        raise ContractValueError("$.winnerPolicy ranking unit drifted")


def _validate_sources(raw: object) -> None:
    sources = _array(raw, path="$.researchSources")
    if len(sources) < 12:
        raise ContractValueError("$.researchSources lacks the frozen primary/official source set")
    kinds: set[str] = set()
    for index, value in enumerate(sources):
        path = f"$.researchSources[{index}]"
        source = _mapping(value, path=path)
        kind = _text(source.get("kind"), path=f"{path}.kind")
        url = _text(source.get("url"), path=f"{path}.url")
        if not url.startswith("https://"):
            raise ContractValueError(f"{path}.url must use HTTPS")
        _text(source.get("title"), path=f"{path}.title")
        kinds.add(kind)
    if not {"OFFICIAL_BINANCE", "PRIMARY_STATISTICAL"}.issubset(kinds):
        raise ContractValueError("$.researchSources must include primary statistics and Binance")


def load_registry(path: Path) -> SMeta1RegistryV1:
    """Load canonical bytes and reject any drift from the frozen S-META1 law."""

    if not isinstance(path, Path):
        raise ContractValueError("path must be pathlib.Path")
    raw = path.read_bytes()
    root = parse_canonical_object(raw)
    require_exact_keys(
        root,
        expected=(
            "admissibility",
            "baseCommit",
            "capacityAndDrawdownGates",
            "contractRefs",
            "createdAtUtc",
            "feeScenarioTruth",
            "freeze",
            "holdoutRules",
            "integrationConsumer",
            "multiplicity",
            "outcomes",
            "registryId",
            "researchSources",
            "schema",
            "strategyFamilies",
            "verdictPolicy",
            "version",
            "winnerPolicy",
        ),
        path="$",
    )
    if _text(root["schema"], path="$.schema") != REGISTRY_SCHEMA:
        raise ContractValueError("$.schema drifted")
    if _integer(root["version"], path="$.version") != 1:
        raise ContractValueError("$.version must equal one")
    if _text(root["registryId"], path="$.registryId") != REGISTRY_ID:
        raise ContractValueError("$.registryId drifted")
    if _text(root["baseCommit"], path="$.baseCommit") != BASE_COMMIT:
        raise ContractValueError("$.baseCommit drifted")
    if _text(root["integrationConsumer"], path="$.integrationConsumer") != "N-3":
        raise ContractValueError("$.integrationConsumer must be N-3")
    frozen_at = _text(root["createdAtUtc"], path="$.createdAtUtc")
    _utc(frozen_at, path="$.createdAtUtc")
    freeze = _mapping(root["freeze"], path="$.freeze")
    if _text(freeze.get("state"), path="$.freeze.state") != "FROZEN_PRE_ACTIVE_OUTCOMES":
        raise ContractValueError("$.freeze.state drifted")
    if _boolean(
        freeze.get("activeOutcomeBytesAccessed"), path="$.freeze.activeOutcomeBytesAccessed"
    ):
        raise ContractValueError("$.freeze records forbidden outcome access")
    if _array(freeze.get("activeOutcomePathsOpened"), path="$.freeze.activeOutcomePathsOpened"):
        raise ContractValueError("$.freeze activeOutcomePathsOpened must be empty")
    outcomes = _mapping(root["outcomes"], path="$.outcomes")
    if _boolean(
        outcomes.get("activeOutcomeFieldsPresent"), path="$.outcomes.activeOutcomeFieldsPresent"
    ):
        raise ContractValueError("$.outcomes may not contain active result fields")
    if _array(outcomes.get("activeOutcomeValues"), path="$.outcomes.activeOutcomeValues"):
        raise ContractValueError("$.outcomes activeOutcomeValues must be empty")
    family_ids, counts = _validate_families(root["strategyFamilies"])
    _validate_multiplicity(root["multiplicity"])
    _validate_contract_refs(root["contractRefs"])
    _validate_admissibility(root["admissibility"])
    _validate_fee_truth(root["feeScenarioTruth"])
    _validate_holdout_and_verdict(root)
    _validate_sources(root["researchSources"])
    gates = _mapping(root["capacityAndDrawdownGates"], path="$.capacityAndDrawdownGates")
    if (
        _integer(
            gates.get("portfolioNotionalUsdCents"),
            path="$.capacityAndDrawdownGates.portfolioNotionalUsdCents",
        )
        != 100_000
    ):
        raise ContractValueError("$.capacityAndDrawdownGates notional must equal USD 1000")
    if (
        _integer(
            gates.get("maximumDrawdownBps"), path="$.capacityAndDrawdownGates.maximumDrawdownBps"
        )
        != MAX_DRAWDOWN_BPS
    ):
        raise ContractValueError("$.capacityAndDrawdownGates drawdown cap drifted")
    if (
        _text(gates.get("missingPathLaw"), path="$.capacityAndDrawdownGates.missingPathLaw")
        != "UNKNOWN"
    ):
        raise ContractValueError("$.capacityAndDrawdownGates missing paths must be UNKNOWN")
    if (
        _text(
            gates.get("rankingMetricUnit"),
            path="$.capacityAndDrawdownGates.rankingMetricUnit",
        )
        != RANKING_LCB_UNIT
        or _integer(
            gates.get("rankingExposureSeconds"),
            path="$.capacityAndDrawdownGates.rankingExposureSeconds",
        )
        != RANKING_EXPOSURE_SECONDS
    ):
        raise ContractValueError("$.capacityAndDrawdownGates ranking unit drifted")
    if "RPI" not in _text(
        gates.get("usdmRpiCoverageLaw"),
        path="$.capacityAndDrawdownGates.usdmRpiCoverageLaw",
    ):
        raise ContractValueError("$.capacityAndDrawdownGates must preserve USD-M RPI unknowns")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_REGISTRY_SHA256:
        raise ContractValueError("$.registry digest drifted from the frozen S-META1 bytes")
    return SMeta1RegistryV1(
        path=path,
        sha256=digest,
        frozen_at_utc=frozen_at,
        family_ids=family_ids,
        attempted_hypothesis_counts=counts,
    )


@dataclass(frozen=True, slots=True)
class FamilyAssessmentV1:
    """One digest-bound family inference receipt at N-3 integration time."""

    family_id: str
    terminal: bool
    decision_state: FamilyDecisionState
    gates: tuple[tuple[str, GateState], ...]
    terminal_reason_code: str
    candidate_sha256: str | None
    candidate_code_config_sha256: str | None
    candidate_universe_sha256: str | None
    candidate_locked_at_utc: str | None
    attempted_hypothesis_count: int | None
    attempt_ledger_bytes: bytes | None
    attempt_ledger_sha256: str | None
    attempt_ledger_frozen_at_utc: str | None
    first_outcome_access_at_utc: str | None
    within_family_procedure: WithinFamilyProcedure | None
    within_family_inference_receipt_sha256: str | None
    chronological_blocks_sha256: str | None
    bootstrap_replicates: int | None
    required_scenario_unadjusted_min_p_values: tuple[tuple[str, ExactRatioV1], ...]
    required_scenario_null_exceedances: tuple[tuple[str, int], ...]
    required_scenario_p_values: tuple[tuple[str, ExactRatioV1], ...]
    raw_family_p_value: ExactRatioV1 | None
    simultaneous_lcb_alpha: ExactRatioV1 | None
    required_scenario_capacity_capped_lcb_microusd: tuple[tuple[str, int], ...]
    capacity_capped_simultaneous_lcb_microusd: int | None
    fee_evidence_sha256: str | None
    family_execution_capacity_law_sha256: str | None
    execution_capacity_drawdown_evidence_sha256: str | None
    pbo_receipt_bytes: bytes | None
    pbo_receipt_sha256: str | None
    family_holdout_authorization_receipt_sha256: str | None
    family_holdout_authorized_at_utc: str | None
    family_holdout_dataset_sha256: str | None
    family_holdout_period_start_utc: str | None
    family_holdout_period_end_utc: str | None
    family_screened_period_end_utc: str | None
    family_holdout_embargo_seconds: int | None
    family_prior_period_expanded_intervals: tuple[tuple[str, str, str], ...]
    family_prior_period_inventory_sha256: str | None
    family_holdout_open_receipt_sha256: str | None
    family_holdout_opened_at_utc: str | None
    family_holdout_open_count: int | None
    family_holdout_minimum_sample_count: int | None
    family_holdout_observed_sample_count: int | None
    family_holdout_tested_candidate_count: int | None
    family_holdout_block_length_samples: int | None
    family_holdout_block_count_floor: int | None
    family_holdout_block_seed_sha256: str | None
    family_holdout_effective_block_count: int | None
    family_post_open_mutation: bool | None
    family_reused_screened_period: bool | None
    family_holdout_result_bytes_sha256: str | None
    family_holdout_receipt_sha256: str | None
    family_holdout_result_at_utc: str | None
    ranking_lcb_unit: str | None
    ranking_exposure_seconds: int | None
    ranking_notional_usd_cents: int | None
    ranking_normalization_receipt_sha256: str | None
    terminal_evidence_bytes: bytes | None
    terminal_evidence_bytes_sha256: str | None
    terminal_evidence_receipt_sha256: str | None
    terminal_evidence_at_utc: str | None
    stress_drawdown_bps: int | None
    capacity_utilization_bps: int | None

    def __post_init__(self) -> None:
        if self.family_id not in EXPECTED_FAMILIES:
            raise ContractValueError("family_id is outside the frozen S-META1 universe")
        if not isinstance(self.terminal, bool):
            raise ContractValueError("terminal must be boolean")
        if not isinstance(self.decision_state, FamilyDecisionState):
            raise ContractValueError("decision_state must be FamilyDecisionState")
        if (
            not isinstance(self.terminal_reason_code, str)
            or re.fullmatch(r"[A-Z0-9_]{3,80}", self.terminal_reason_code) is None
        ):
            raise ContractValueError("terminal_reason_code must be a bounded reason code")
        gates = _gate_mapping(self.gates, expected=REQUIRED_FAMILY_GATES, path="gates")
        if not self.terminal and self.decision_state is not FamilyDecisionState.UNKNOWN:
            raise ContractValueError("non-terminal family must remain UNKNOWN")
        if self.decision_state is FamilyDecisionState.UNKNOWN and not (
            not self.terminal or _has_unknown(gates)
        ):
            raise ContractValueError("UNKNOWN family must expose a material unknown gate")
        if self.decision_state is FamilyDecisionState.NO_GO:
            if not self.terminal:
                raise ContractValueError("NO_GO family must be terminal")
            if _has_unknown(gates):
                raise ContractValueError("NO_GO family may not hide a material unknown gate")
            if not any(state is GateState.FAIL for state in gates.values()):
                raise ContractValueError("NO_GO family requires an explicit failed gate")
        if (
            self.decision_state is FamilyDecisionState.QUALIFYING
            and self.family_id not in POSITIVE_ELIGIBLE_FAMILIES
        ):
            raise ContractValueError(
                "frozen rejected or research-stop family cannot become QUALIFYING"
            )
        if self.decision_state is FamilyDecisionState.QUALIFYING and not _all_pass(gates):
            raise ContractValueError(
                "QUALIFYING family requires every frozen evidence gate to PASS"
            )

        for field_name in (
            "candidate_sha256",
            "candidate_code_config_sha256",
            "candidate_universe_sha256",
            "attempt_ledger_sha256",
            "within_family_inference_receipt_sha256",
            "chronological_blocks_sha256",
            "fee_evidence_sha256",
            "family_execution_capacity_law_sha256",
            "execution_capacity_drawdown_evidence_sha256",
            "pbo_receipt_sha256",
            "family_holdout_authorization_receipt_sha256",
            "family_holdout_dataset_sha256",
            "family_prior_period_inventory_sha256",
            "family_holdout_open_receipt_sha256",
            "family_holdout_block_seed_sha256",
            "family_holdout_result_bytes_sha256",
            "family_holdout_receipt_sha256",
            "ranking_normalization_receipt_sha256",
            "terminal_evidence_bytes_sha256",
            "terminal_evidence_receipt_sha256",
        ):
            value = getattr(self, field_name)
            if value is not None:
                _require_sha256(value, path=field_name)
        if self.attempted_hypothesis_count is not None and (
            isinstance(self.attempted_hypothesis_count, bool)
            or not isinstance(self.attempted_hypothesis_count, int)
            or self.attempted_hypothesis_count < 1
        ):
            raise ContractValueError("attempted_hypothesis_count must be positive or None")
        for field_name in (
            "capacity_capped_simultaneous_lcb_microusd",
            "stress_drawdown_bps",
            "capacity_utilization_bps",
            "family_holdout_open_count",
            "family_holdout_minimum_sample_count",
            "family_holdout_observed_sample_count",
            "family_holdout_tested_candidate_count",
            "family_holdout_block_length_samples",
            "family_holdout_block_count_floor",
            "family_holdout_effective_block_count",
            "family_holdout_embargo_seconds",
            "ranking_exposure_seconds",
            "ranking_notional_usd_cents",
        ):
            value = getattr(self, field_name)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
                raise ContractValueError(f"{field_name} must be an integer or None")
        for field_name in ("stress_drawdown_bps", "capacity_utilization_bps"):
            value = getattr(self, field_name)
            if value is not None and value < 0:
                raise ContractValueError(f"{field_name} must be non-negative or None")
        for field_name in ("family_post_open_mutation", "family_reused_screened_period"):
            value = getattr(self, field_name)
            if value is not None and not isinstance(value, bool):
                raise ContractValueError(f"{field_name} must be boolean or None")
        if not isinstance(self.family_prior_period_expanded_intervals, tuple):
            raise ContractValueError("family_prior_period_expanded_intervals must be a tuple")
        if self.terminal_evidence_bytes is not None and not isinstance(
            self.terminal_evidence_bytes,
            bytes,
        ):
            raise ContractValueError("terminal_evidence_bytes must be bytes or None")
        if self.pbo_receipt_bytes is not None and not isinstance(
            self.pbo_receipt_bytes,
            bytes,
        ):
            raise ContractValueError("pbo_receipt_bytes must be bytes or None")
        if self.attempt_ledger_bytes is not None and not isinstance(
            self.attempt_ledger_bytes,
            bytes,
        ):
            raise ContractValueError("attempt_ledger_bytes must be bytes or None")
        if (self.attempt_ledger_bytes is None) != (self.attempt_ledger_sha256 is None):
            raise ContractValueError("attempt ledger bytes and digest must appear together")
        if (self.pbo_receipt_bytes is None) != (self.pbo_receipt_sha256 is None):
            raise ContractValueError("PBO receipt bytes and digest must appear together")
        if self.pbo_receipt_bytes is not None and (
            self.family_id not in POSITIVE_ELIGIBLE_FAMILIES
        ):
            raise ContractValueError("PBO receipt bytes are limited to active positive families")
        if self.terminal_evidence_bytes is not None and (
            self.family_id not in POSITIVE_ELIGIBLE_FAMILIES
            or not self.terminal
            or self.decision_state is FamilyDecisionState.UNKNOWN
        ):
            raise ContractValueError(
                "raw terminal evidence bytes require a terminal active-family result"
            )

        if self.decision_state is FamilyDecisionState.QUALIFYING:
            self._validate_qualifying_receipt()
        else:
            measured_active_failure = (
                self.family_id in POSITIVE_ELIGIBLE_FAMILIES
                and self.terminal
                and self.decision_state is FamilyDecisionState.NO_GO
            )
            if not measured_active_failure and (
                self.raw_family_p_value is not None
                or self.simultaneous_lcb_alpha is not None
                or self.capacity_capped_simultaneous_lcb_microusd is not None
                or self.required_scenario_unadjusted_min_p_values
                or self.required_scenario_null_exceedances
                or self.required_scenario_p_values
                or self.required_scenario_capacity_capped_lcb_microusd
            ):
                raise ContractValueError(
                    "non-qualifying family must enter burst Holm as p=1 without partial inference"
                )
            if self.family_id in POSITIVE_ELIGIBLE_FAMILIES and self.terminal:
                self._validate_terminal_active_receipt()
                if self.decision_state is FamilyDecisionState.NO_GO:
                    self._validate_terminal_failure_receipt()

    def _validate_pbo_receipt(self) -> None:
        if self.pbo_receipt_bytes is None or self.pbo_receipt_sha256 is None:
            raise ContractValueError("active family lacks canonical PBO diagnostic bytes")
        attempt_rows = self._validate_attempt_ledger()
        try:
            receipt = parse_canonical_object(self.pbo_receipt_bytes)
        except CanonicalJsonError as error:
            raise ContractValueError("PBO diagnostic receipt must be canonical JSON") from error
        if receipt.get("schema") != "SMeta1PboDiagnosticReceiptV1":
            raise ContractValueError("PBO diagnostic receipt schema drifted")
        matrix = _mapping(receipt.get("scoreMatrix"), path="pbo.scoreMatrix")
        require_exact_keys(
            matrix,
            expected=("blockIds", "schema", "trials"),
            path="pbo.scoreMatrix",
        )
        block_ids = tuple(
            _text(value, path=f"pbo.scoreMatrix.blockIds[{index}]")
            for index, value in enumerate(
                _array(matrix["blockIds"], path="pbo.scoreMatrix.blockIds")
            )
        )
        trial_ids: list[str] = []
        score_rows: list[tuple[int, ...]] = []
        for index, value in enumerate(_array(matrix["trials"], path="pbo.scoreMatrix.trials")):
            row = _mapping(value, path=f"pbo.scoreMatrix.trials[{index}]")
            require_exact_keys(
                row,
                expected=("blockScoresMicrousd", "trialId"),
                path=f"pbo.scoreMatrix.trials[{index}]",
            )
            trial_ids.append(_text(row["trialId"], path=f"pbo.scoreMatrix.trials[{index}].trialId"))
            score_rows.append(
                tuple(
                    _integer(
                        score,
                        path=(
                            f"pbo.scoreMatrix.trials[{index}].blockScoresMicrousd[{score_index}]"
                        ),
                    )
                    for score_index, score in enumerate(
                        _array(
                            row["blockScoresMicrousd"],
                            path=(f"pbo.scoreMatrix.trials[{index}].blockScoresMicrousd"),
                        )
                    )
                )
            )
        expected = pbo_diagnostic_receipt_bytes(
            family_id=self.family_id,
            candidate_sha256=cast(str, self.candidate_sha256),
            candidate_code_config_sha256=cast(
                str,
                self.candidate_code_config_sha256,
            ),
            candidate_locked_at_utc=cast(str, self.candidate_locked_at_utc),
            selected_trial_id=_text(
                receipt.get("selectedTrialId"),
                path="pbo.selectedTrialId",
            ),
            attempt_ledger_bytes_value=cast(bytes, self.attempt_ledger_bytes),
            attempt_ledger_sha256=cast(str, self.attempt_ledger_sha256),
            within_family_inference_receipt_sha256=cast(
                str,
                self.within_family_inference_receipt_sha256,
            ),
            pbo_chronological_blocks_sha256=_require_sha256(
                receipt.get("pboChronologicalBlocksSha256"),
                path="pbo.pboChronologicalBlocksSha256",
            ),
            screened_period_end_utc=cast(
                str,
                self.family_screened_period_end_utc,
            ),
            fee_evidence_sha256=cast(str, self.fee_evidence_sha256),
            execution_capacity_law_sha256=cast(
                str,
                self.family_execution_capacity_law_sha256,
            ),
            trial_ids=tuple(trial_ids),
            block_ids=block_ids,
            score_matrix=tuple(score_rows),
            computed_at_utc=_text(
                receipt.get("computedAtUtc"),
                path="pbo.computedAtUtc",
            ),
        )
        observed_digest = hashlib.sha256(self.pbo_receipt_bytes).hexdigest()
        if self.pbo_receipt_bytes != expected or observed_digest != self.pbo_receipt_sha256:
            raise ContractValueError(
                "PBO receipt bytes and digest must match exhaustive canonical recomputation"
            )
        if tuple(trial_ids) != tuple(row[0] for row in attempt_rows):
            raise ContractValueError(
                "PBO matrix trial identities must equal the canonical attempt ledger"
            )
        computed_at = _utc(
            _text(receipt.get("computedAtUtc"), path="pbo.computedAtUtc"),
            path="pbo.computedAtUtc",
        )
        screened_end = _utc(
            cast(str, self.family_screened_period_end_utc),
            path="family_screened_period_end_utc",
        )
        if screened_end > computed_at:
            raise ContractValueError(
                "PBO diagnostic must be computed on or after screened-period end"
            )
        ledger_frozen = _utc(
            cast(str, self.attempt_ledger_frozen_at_utc),
            path="attempt_ledger_frozen_at_utc",
        )
        candidate_locked = _utc(
            cast(str, self.candidate_locked_at_utc),
            path="candidate_locked_at_utc",
        )
        authorized = _utc(
            cast(str, self.family_holdout_authorized_at_utc),
            path="family_holdout_authorized_at_utc",
        )
        if not ledger_frozen < candidate_locked <= computed_at <= authorized:
            raise ContractValueError(
                "PBO diagnostic must be computed after candidate lock and before "
                "holdout authorization"
            )
        gates = _gate_mapping(
            self.gates,
            expected=REQUIRED_FAMILY_GATES,
            path="gates",
        )
        if gates["PBO_DIAGNOSTIC"] is not GateState.PASS:
            raise ContractValueError(
                "canonical available or exact single-attempt PBO evidence derives PASS"
            )

    def _validate_attempt_ledger(
        self,
    ) -> tuple[tuple[str, str, str], ...]:
        if (
            isinstance(self.attempted_hypothesis_count, bool)
            or not isinstance(self.attempted_hypothesis_count, int)
            or self.attempted_hypothesis_count < 1
            or self.attempt_ledger_bytes is None
            or self.attempt_ledger_sha256 is None
            or self.attempt_ledger_frozen_at_utc is None
            or self.first_outcome_access_at_utc is None
        ):
            raise ContractValueError(
                "terminal active family requires exact pre-outcome attempt-ledger evidence"
            )
        frozen_count = EXPECTED_ATTEMPT_COUNTS[self.family_id]
        if frozen_count is None:
            raise ContractValueError(
                "family attempt count is UNKNOWN pending a trusted pre-outcome digest authority"
            )
        ledger_frozen_at, attempt_rows, candidate_universe_sha256 = _parse_attempt_ledger(
            self.attempt_ledger_bytes,
            expected_sha256=self.attempt_ledger_sha256,
            expected_family_id=self.family_id,
            expected_frozen_at_utc=self.attempt_ledger_frozen_at_utc,
        )
        if self.attempted_hypothesis_count != len(attempt_rows):
            raise ContractValueError(
                "attempted hypothesis count must equal the canonical attempt ledger"
            )
        if self.candidate_universe_sha256 != candidate_universe_sha256:
            raise ContractValueError(
                "candidate universe digest must derive from the canonical attempt ledger"
            )
        if self.attempted_hypothesis_count != frozen_count:
            raise ContractValueError("family attempt count drifted from the frozen count")
        ledger_frozen = _utc(
            ledger_frozen_at,
            path="attempt_ledger_frozen_at_utc",
        )
        first_outcome = _utc(
            self.first_outcome_access_at_utc,
            path="first_outcome_access_at_utc",
        )
        registry_frozen = _utc(
            REGISTRY_FROZEN_AT_UTC,
            path="registry.frozen_at_utc",
        )
        if ledger_frozen < registry_frozen:
            raise ContractValueError("attempt ledger cannot predate the S-META1 registry freeze")
        if registry_frozen >= first_outcome:
            raise ContractValueError(
                "first outcome access must be strictly after the S-META1 registry freeze"
            )
        if ledger_frozen >= first_outcome:
            raise ContractValueError("attempt ledger must be sealed before first outcome access")
        return attempt_rows

    def _validate_terminal_active_receipt(self) -> None:
        self._validate_attempt_ledger()
        if (
            self.terminal_evidence_bytes_sha256 is None
            or self.terminal_evidence_receipt_sha256 is None
            or self.terminal_evidence_at_utc is None
            or self.first_outcome_access_at_utc is None
        ):
            raise ContractValueError("terminal active family requires an evidence receipt digest")
        if _utc(
            self.terminal_evidence_at_utc,
            path="terminal_evidence_at_utc",
        ) < _utc(
            self.first_outcome_access_at_utc,
            path="first_outcome_access_at_utc",
        ):
            raise ContractValueError("terminal family evidence cannot predate first outcome access")

    def _validate_terminal_failure_receipt(self) -> None:
        if self.terminal_evidence_bytes is None:
            raise ContractValueError("active-family NO_GO requires canonical measured result bytes")
        self._validate_family_holdout()
        if (
            self.candidate_sha256 is None
            or self.candidate_code_config_sha256 is None
            or not isinstance(self.within_family_procedure, WithinFamilyProcedure)
            or self.within_family_inference_receipt_sha256 is None
            or self.chronological_blocks_sha256 is None
            or self.fee_evidence_sha256 is None
            or self.family_execution_capacity_law_sha256 is None
            or self.execution_capacity_drawdown_evidence_sha256 is None
            or self.pbo_receipt_sha256 is None
            or self.family_holdout_authorization_receipt_sha256 is None
            or self.family_holdout_open_receipt_sha256 is None
            or self.family_holdout_result_bytes_sha256 is None
            or self.family_holdout_result_at_utc is None
            or self.family_holdout_receipt_sha256 is None
            or self.raw_family_p_value is None
            or self.simultaneous_lcb_alpha is None
            or self.capacity_capped_simultaneous_lcb_microusd is None
            or self.family_holdout_observed_sample_count is None
            or self.family_holdout_effective_block_count is None
            or self.stress_drawdown_bps is None
            or self.capacity_utilization_bps is None
            or self.family_post_open_mutation is None
            or self.family_reused_screened_period is None
            or self.family_holdout_tested_candidate_count is None
        ):
            raise ContractValueError(
                "active-family NO_GO requires a complete authorization-bound measured result"
            )
        if self.bootstrap_replicates != 4_096:
            raise ContractValueError(
                "active-family NO_GO requires exactly 4096 bootstrap replicates"
            )
        if (
            Fraction(
                self.simultaneous_lcb_alpha.numerator,
                self.simultaneous_lcb_alpha.denominator,
            )
            != SIMULTANEOUS_LCB_ALPHA
        ):
            raise ContractValueError("active-family NO_GO simultaneous LCB alpha must equal 1/280")
        attempt_count = cast(int, self.attempted_hypothesis_count)
        scenario_p_values = _scenario_p_mapping(
            self.required_scenario_p_values,
            path="terminalFailure.required_scenario_p_values",
        )
        exceedances = _scenario_lcb_mapping(
            self.required_scenario_null_exceedances,
            path="terminalFailure.required_scenario_null_exceedances",
        )
        for scenario_id in REQUIRED_FEE_SCENARIOS:
            count = exceedances[scenario_id]
            if not 0 <= count <= 4_096:
                raise ContractValueError(
                    "active-family NO_GO null exceedances must lie in [0,4096]"
                )
        if self.within_family_procedure is WithinFamilyProcedure.BONFERRONI_ALL_ATTEMPTS:
            raw_minima = _scenario_p_mapping(
                self.required_scenario_unadjusted_min_p_values,
                path="terminalFailure.required_scenario_unadjusted_min_p_values",
            )
            for scenario_id in REQUIRED_FEE_SCENARIOS:
                raw = raw_minima[scenario_id]
                if raw != bootstrap_plus_one_p(exceedances[scenario_id]):
                    raise ContractValueError(
                        "active-family NO_GO Bonferroni minima must use plus-one arithmetic"
                    )
                expected = min(
                    Fraction(1),
                    attempt_count * Fraction(raw.numerator, raw.denominator),
                )
                adjusted = scenario_p_values[scenario_id]
                if Fraction(adjusted.numerator, adjusted.denominator) != expected:
                    raise ContractValueError(
                        "active-family NO_GO Bonferroni p-values must count every attempt"
                    )
        else:
            if self.required_scenario_unadjusted_min_p_values:
                raise ContractValueError(
                    "active-family NO_GO selection-aware receipt cannot carry Bonferroni minima"
                )
            for scenario_id in REQUIRED_FEE_SCENARIOS:
                if scenario_p_values[scenario_id] != bootstrap_plus_one_p(exceedances[scenario_id]):
                    raise ContractValueError(
                        "active-family NO_GO p-values must use plus-one arithmetic"
                    )
        raw_p_value = Fraction(
            self.raw_family_p_value.numerator,
            self.raw_family_p_value.denominator,
        )
        if raw_p_value != max(
            Fraction(value.numerator, value.denominator) for value in scenario_p_values.values()
        ):
            raise ContractValueError(
                "active-family NO_GO p-value must equal the worst required scenario"
            )
        scenario_lcbs = _scenario_lcb_mapping(
            self.required_scenario_capacity_capped_lcb_microusd,
            path="terminalFailure.required_scenario_capacity_capped_lcb_microusd",
        )
        if self.capacity_capped_simultaneous_lcb_microusd != min(scenario_lcbs.values()):
            raise ContractValueError(
                "active-family NO_GO LCB must equal the worst required scenario"
            )
        expected_normalization = ranking_normalization_sha256(
            required_scenario_lcbs=(self.required_scenario_capacity_capped_lcb_microusd),
            ranking_lcb_unit=cast(str, self.ranking_lcb_unit),
            ranking_exposure_seconds=cast(int, self.ranking_exposure_seconds),
            ranking_notional_usd_cents=cast(int, self.ranking_notional_usd_cents),
        )
        if self.ranking_normalization_receipt_sha256 != expected_normalization:
            raise ContractValueError("active-family NO_GO ranking normalization digest drifted")
        expected_result_bytes = holdout_measured_result_bytes(
            scope="FAMILY",
            family_id=self.family_id,
            authorization_receipt_sha256=(self.family_holdout_authorization_receipt_sha256),
            candidate_sha256=self.candidate_sha256,
            candidate_code_config_sha256=self.candidate_code_config_sha256,
            open_receipt_sha256=self.family_holdout_open_receipt_sha256,
            inference_procedure=self.within_family_procedure.value,
            inference_config_sha256=self.within_family_inference_receipt_sha256,
            pbo_receipt_sha256=self.pbo_receipt_sha256,
            result_at_utc=self.family_holdout_result_at_utc,
            fee_evidence_sha256=self.fee_evidence_sha256,
            execution_capacity_law_sha256=self.family_execution_capacity_law_sha256,
            execution_capacity_drawdown_evidence_sha256=(
                self.execution_capacity_drawdown_evidence_sha256
            ),
            chronological_blocks_sha256=self.chronological_blocks_sha256,
            bootstrap_replicates=self.bootstrap_replicates,
            required_scenario_null_exceedances=self.required_scenario_null_exceedances,
            required_scenario_p_values=self.required_scenario_p_values,
            raw_p_value=self.raw_family_p_value,
            lcb_alpha=self.simultaneous_lcb_alpha,
            required_scenario_lcbs=(self.required_scenario_capacity_capped_lcb_microusd),
            aggregate_lcb=self.capacity_capped_simultaneous_lcb_microusd,
            observed_sample_count=self.family_holdout_observed_sample_count,
            effective_block_count=self.family_holdout_effective_block_count,
            stress_drawdown_bps=self.stress_drawdown_bps,
            capacity_utilization_bps=self.capacity_utilization_bps,
            fallback_used=False,
            post_open_mutation=self.family_post_open_mutation,
            reused_screened_period=self.family_reused_screened_period,
            tested_candidate_count=self.family_holdout_tested_candidate_count,
            result_state=self.decision_state.value,
            gates=self.gates,
        )
        try:
            evidence = parse_canonical_object(self.terminal_evidence_bytes)
        except CanonicalJsonError as error:
            raise ContractValueError(
                "active-family NO_GO requires canonical measured result bytes"
            ) from error
        if evidence.get("schema") != "SMeta1FamilyMeasuredResultV1":
            raise ContractValueError("active-family NO_GO measured result schema drifted")
        if self.terminal_evidence_bytes != expected_result_bytes:
            raise ContractValueError(
                "active-family NO_GO measured result bytes do not match the locked payload"
            )
        evidence_digest = hashlib.sha256(self.terminal_evidence_bytes).hexdigest()
        if (
            evidence_digest != self.terminal_evidence_bytes_sha256
            or evidence_digest != self.family_holdout_result_bytes_sha256
        ):
            raise ContractValueError(
                "active-family NO_GO measured result digest does not match its bytes"
            )
        expected_result_receipt = holdout_result_sha256(
            scope="FAMILY",
            candidate_sha256=self.candidate_sha256,
            candidate_code_config_sha256=self.candidate_code_config_sha256,
            open_receipt_sha256=self.family_holdout_open_receipt_sha256,
            inference_procedure=self.within_family_procedure.value,
            inference_config_sha256=self.within_family_inference_receipt_sha256,
            pbo_receipt_sha256=self.pbo_receipt_sha256,
            result_bytes_sha256=evidence_digest,
            result_at_utc=self.family_holdout_result_at_utc,
            fee_evidence_sha256=self.fee_evidence_sha256,
            execution_capacity_law_sha256=self.family_execution_capacity_law_sha256,
            execution_capacity_drawdown_evidence_sha256=(
                self.execution_capacity_drawdown_evidence_sha256
            ),
            chronological_blocks_sha256=self.chronological_blocks_sha256,
            bootstrap_replicates=self.bootstrap_replicates,
            required_scenario_null_exceedances=self.required_scenario_null_exceedances,
            required_scenario_p_values=self.required_scenario_p_values,
            raw_p_value=self.raw_family_p_value,
            lcb_alpha=self.simultaneous_lcb_alpha,
            required_scenario_lcbs=(self.required_scenario_capacity_capped_lcb_microusd),
            aggregate_lcb=self.capacity_capped_simultaneous_lcb_microusd,
            observed_sample_count=self.family_holdout_observed_sample_count,
            effective_block_count=self.family_holdout_effective_block_count,
            stress_drawdown_bps=self.stress_drawdown_bps,
            capacity_utilization_bps=self.capacity_utilization_bps,
            fallback_used=False,
            post_open_mutation=self.family_post_open_mutation,
            reused_screened_period=self.family_reused_screened_period,
            tested_candidate_count=self.family_holdout_tested_candidate_count,
            result_state=self.decision_state.value,
            gates=self.gates,
        )
        if self.family_holdout_receipt_sha256 != expected_result_receipt:
            raise ContractValueError(
                "active-family NO_GO result receipt does not bind its measured bytes"
            )
        mechanically_failed: set[str] = set()
        if raw_p_value > FAMILYWISE_ALPHA or self.capacity_capped_simultaneous_lcb_microusd <= 0:
            mechanically_failed.add("ADMISSIBLE_EVIDENCE")
        if self.stress_drawdown_bps > MAX_DRAWDOWN_BPS:
            mechanically_failed.add("DRAWDOWN_CAP")
        if self.capacity_utilization_bps > MAX_CAPACITY_UTILIZATION_BPS:
            mechanically_failed.add("CAPACITY_1000_USD")
        assessment_failed = {gate_id for gate_id, state in self.gates if state is GateState.FAIL}
        if not mechanically_failed or assessment_failed != mechanically_failed:
            raise ContractValueError(
                "active-family NO_GO gates must equal mechanically derived result failures"
            )
        unsupported_failures = assessment_failed - {
            "ADMISSIBLE_EVIDENCE",
            "DRAWDOWN_CAP",
            "CAPACITY_1000_USD",
        }
        if unsupported_failures:
            raise ContractValueError("unsupported active-family failures must remain UNKNOWN")
        expected_terminal_receipt = terminal_family_failure_sha256(
            family_id=self.family_id,
            attempted_hypothesis_count=attempt_count,
            attempt_ledger_sha256=cast(str, self.attempt_ledger_sha256),
            attempt_ledger_frozen_at_utc=cast(
                str,
                self.attempt_ledger_frozen_at_utc,
            ),
            first_outcome_access_at_utc=cast(str, self.first_outcome_access_at_utc),
            terminal_reason_code=self.terminal_reason_code,
            gates=self.gates,
            terminal_evidence_bytes_sha256=evidence_digest,
            terminal_evidence_at_utc=cast(str, self.terminal_evidence_at_utc),
        )
        if self.terminal_evidence_receipt_sha256 != expected_terminal_receipt:
            raise ContractValueError(
                "active-family NO_GO receipt must bind the measured terminal failure"
            )

    def _validate_family_holdout(self) -> None:
        required = (
            self.candidate_sha256,
            self.candidate_code_config_sha256,
            self.candidate_universe_sha256,
            self.candidate_locked_at_utc,
            self.attempt_ledger_sha256,
            self.family_holdout_authorization_receipt_sha256,
            self.family_holdout_authorized_at_utc,
            self.family_holdout_dataset_sha256,
            self.family_holdout_period_start_utc,
            self.family_holdout_period_end_utc,
            self.family_screened_period_end_utc,
            self.family_prior_period_inventory_sha256,
            self.family_holdout_open_receipt_sha256,
            self.family_holdout_opened_at_utc,
            self.family_holdout_result_bytes_sha256,
            self.family_holdout_receipt_sha256,
            self.family_holdout_result_at_utc,
            self.ranking_lcb_unit,
            self.ranking_normalization_receipt_sha256,
            self.chronological_blocks_sha256,
            self.fee_evidence_sha256,
            self.family_execution_capacity_law_sha256,
            self.execution_capacity_drawdown_evidence_sha256,
            self.within_family_inference_receipt_sha256,
            self.pbo_receipt_bytes,
            self.pbo_receipt_sha256,
            self.family_holdout_block_seed_sha256,
            self.terminal_evidence_bytes_sha256,
            self.terminal_evidence_receipt_sha256,
            self.terminal_evidence_at_utc,
            self.first_outcome_access_at_utc,
            self.attempt_ledger_frozen_at_utc,
        )
        required_integers = (
            self.bootstrap_replicates,
            self.family_holdout_embargo_seconds,
            self.family_holdout_open_count,
            self.family_holdout_minimum_sample_count,
            self.family_holdout_observed_sample_count,
            self.family_holdout_tested_candidate_count,
            self.family_holdout_block_length_samples,
            self.family_holdout_block_count_floor,
            self.family_holdout_effective_block_count,
            self.ranking_exposure_seconds,
            self.ranking_notional_usd_cents,
            self.stress_drawdown_bps,
            self.capacity_utilization_bps,
        )
        if (
            any(value is None for value in required)
            or any(value is None for value in required_integers)
            or self.family_post_open_mutation is None
            or self.family_reused_screened_period is None
        ):
            raise ContractValueError(
                "qualifying family requires a complete independently locked holdout proof"
            )
        if not isinstance(self.within_family_procedure, WithinFamilyProcedure):
            raise ContractValueError(
                "family holdout authorization requires a frozen inference procedure"
            )

        candidate_locked = _utc(
            cast(str, self.candidate_locked_at_utc),
            path="candidate_locked_at_utc",
        )
        ledger_frozen = _utc(
            cast(str, self.attempt_ledger_frozen_at_utc),
            path="attempt_ledger_frozen_at_utc",
        )
        authorized = _utc(
            cast(str, self.family_holdout_authorized_at_utc),
            path="family_holdout_authorized_at_utc",
        )
        period_start = _utc(
            cast(str, self.family_holdout_period_start_utc),
            path="family_holdout_period_start_utc",
        )
        period_end = _utc(
            cast(str, self.family_holdout_period_end_utc),
            path="family_holdout_period_end_utc",
        )
        screened_end = _utc(
            cast(str, self.family_screened_period_end_utc),
            path="family_screened_period_end_utc",
        )
        opened = _utc(
            cast(str, self.family_holdout_opened_at_utc),
            path="family_holdout_opened_at_utc",
        )
        result_at = _utc(
            cast(str, self.family_holdout_result_at_utc),
            path="family_holdout_result_at_utc",
        )
        first_outcome = _utc(
            cast(str, self.first_outcome_access_at_utc),
            path="first_outcome_access_at_utc",
        )
        terminal_at = _utc(
            cast(str, self.terminal_evidence_at_utc),
            path="terminal_evidence_at_utc",
        )
        if not ledger_frozen < candidate_locked <= authorized < opened <= result_at:
            raise ContractValueError(
                "family ledger, candidate lock, authorization, open, and result chronology drifted"
            )
        if first_outcome != opened:
            raise ContractValueError(
                "family holdout open must equal the first outcome access timestamp"
            )
        if not period_start < period_end < opened:
            raise ContractValueError(
                "family holdout period must finish before its first byte access"
            )
        embargo_seconds = cast(int, self.family_holdout_embargo_seconds)
        prior_max_end = _prior_period_max_end(
            self.family_prior_period_expanded_intervals,
            expected_sha256=cast(str, self.family_prior_period_inventory_sha256),
            path="family_prior_period_inventory",
        )
        if screened_end != prior_max_end:
            raise ContractValueError(
                "family screened-period end must equal the canonical inventory maximum"
            )
        if (
            embargo_seconds < 0
            or prior_max_end + timedelta(seconds=embargo_seconds) >= period_start
        ):
            raise ContractValueError(
                "family holdout must be disjoint from screened periods after embargo"
            )
        if result_at != terminal_at:
            raise ContractValueError("family holdout result must equal terminal evidence time")
        if (
            self.family_holdout_open_count != 1
            or self.family_holdout_tested_candidate_count != 1
            or self.family_post_open_mutation
            or self.family_reused_screened_period
        ):
            raise ContractValueError(
                "family holdout must test one locked candidate in one uncontaminated open"
            )

        minimum_samples = cast(int, self.family_holdout_minimum_sample_count)
        observed_samples = cast(int, self.family_holdout_observed_sample_count)
        block_length = cast(int, self.family_holdout_block_length_samples)
        block_floor = cast(int, self.family_holdout_block_count_floor)
        effective_blocks = cast(int, self.family_holdout_effective_block_count)
        if (
            minimum_samples < 1
            or observed_samples < minimum_samples
            or block_length < 1
            or block_floor < 2
            or effective_blocks < block_floor
            or block_length * block_floor > observed_samples
        ):
            raise ContractValueError(
                "family holdout sample and effective-block floors must be satisfied"
            )
        if (
            self.ranking_lcb_unit != RANKING_LCB_UNIT
            or self.ranking_exposure_seconds != RANKING_EXPOSURE_SECONDS
            or self.ranking_notional_usd_cents != RANKING_NOTIONAL_USD_CENTS
        ):
            raise ContractValueError(
                "family winner score must use the frozen common wall-clock unit"
            )

        self._validate_pbo_receipt()
        expected_authorization = family_holdout_authorization_sha256(
            family_id=self.family_id,
            candidate_sha256=cast(str, self.candidate_sha256),
            candidate_code_config_sha256=cast(str, self.candidate_code_config_sha256),
            candidate_universe_sha256=cast(str, self.candidate_universe_sha256),
            candidate_locked_at_utc=cast(str, self.candidate_locked_at_utc),
            within_family_procedure=self.within_family_procedure.value,
            within_family_inference_receipt_sha256=cast(
                str,
                self.within_family_inference_receipt_sha256,
            ),
            pbo_receipt_sha256=cast(str, self.pbo_receipt_sha256),
            attempted_hypothesis_count=cast(int, self.attempted_hypothesis_count),
            attempt_ledger_sha256=cast(str, self.attempt_ledger_sha256),
            holdout_dataset_sha256=cast(str, self.family_holdout_dataset_sha256),
            holdout_period_start_utc=cast(str, self.family_holdout_period_start_utc),
            holdout_period_end_utc=cast(str, self.family_holdout_period_end_utc),
            screened_period_end_utc=cast(str, self.family_screened_period_end_utc),
            embargo_seconds=embargo_seconds,
            prior_period_inventory_sha256=cast(
                str,
                self.family_prior_period_inventory_sha256,
            ),
            chronological_blocks_sha256=cast(str, self.chronological_blocks_sha256),
            block_seed_sha256=cast(str, self.family_holdout_block_seed_sha256),
            fee_evidence_sha256=cast(str, self.fee_evidence_sha256),
            execution_capacity_law_sha256=cast(
                str,
                self.family_execution_capacity_law_sha256,
            ),
            minimum_sample_count=minimum_samples,
            block_length_samples=block_length,
            block_count_floor=block_floor,
            ranking_lcb_unit=self.ranking_lcb_unit,
            ranking_exposure_seconds=self.ranking_exposure_seconds,
            ranking_notional_usd_cents=self.ranking_notional_usd_cents,
            bootstrap_replicates=cast(int, self.bootstrap_replicates),
            authorized_at_utc=cast(str, self.family_holdout_authorized_at_utc),
        )
        if self.family_holdout_authorization_receipt_sha256 != expected_authorization:
            raise ContractValueError(
                "family holdout authorization digest does not match its canonical payload"
            )
        expected_open = holdout_open_sha256(
            authorization_receipt_sha256=expected_authorization,
            holdout_dataset_sha256=cast(str, self.family_holdout_dataset_sha256),
            opened_at_utc=cast(str, self.family_holdout_opened_at_utc),
            open_count=self.family_holdout_open_count,
        )
        if self.family_holdout_open_receipt_sha256 != expected_open:
            raise ContractValueError(
                "family holdout open digest does not match its canonical payload"
            )

    def _validate_qualifying_receipt(self) -> None:
        if not self.terminal:
            raise ContractValueError("qualifying family must be terminal")
        self._validate_terminal_active_receipt()
        self._validate_family_holdout()
        attempt_count = cast(int, self.attempted_hypothesis_count)
        if (
            self.candidate_sha256 is None
            or self.candidate_code_config_sha256 is None
            or not isinstance(self.within_family_procedure, WithinFamilyProcedure)
            or self.within_family_inference_receipt_sha256 is None
            or self.chronological_blocks_sha256 is None
            or self.fee_evidence_sha256 is None
            or self.execution_capacity_drawdown_evidence_sha256 is None
            or self.pbo_receipt_sha256 is None
            or self.family_holdout_receipt_sha256 is None
            or self.terminal_evidence_receipt_sha256 is None
            or self.terminal_evidence_bytes is None
        ):
            raise ContractValueError("qualifying family lacks a digest-bound inference receipt")
        if self.bootstrap_replicates != 4_096:
            raise ContractValueError("qualifying family requires exactly 4096 bootstrap replicates")
        if (
            not isinstance(self.simultaneous_lcb_alpha, ExactRatioV1)
            or Fraction(
                self.simultaneous_lcb_alpha.numerator,
                self.simultaneous_lcb_alpha.denominator,
            )
            != SIMULTANEOUS_LCB_ALPHA
        ):
            raise ContractValueError("qualifying family simultaneous LCB alpha must equal 1/280")
        scenario_p_values = _scenario_p_mapping(
            self.required_scenario_p_values,
            path="required_scenario_p_values",
        )
        exceedances = _scenario_lcb_mapping(
            self.required_scenario_null_exceedances,
            path="required_scenario_null_exceedances",
        )
        for scenario_id in REQUIRED_FEE_SCENARIOS:
            count = exceedances[scenario_id]
            if not 0 <= count <= 4_096:
                raise ContractValueError("null exceedance count must lie in [0,4096]")
        if self.within_family_procedure is WithinFamilyProcedure.BONFERRONI_ALL_ATTEMPTS:
            raw_minima = _scenario_p_mapping(
                self.required_scenario_unadjusted_min_p_values,
                path="required_scenario_unadjusted_min_p_values",
            )
            for scenario_id in REQUIRED_FEE_SCENARIOS:
                raw = raw_minima[scenario_id]
                if raw != bootstrap_plus_one_p(exceedances[scenario_id]):
                    raise ContractValueError(
                        "Bonferroni raw minima must use plus-one bootstrap arithmetic"
                    )
                expected = min(
                    Fraction(1),
                    attempt_count * Fraction(raw.numerator, raw.denominator),
                )
                adjusted = scenario_p_values[scenario_id]
                if Fraction(adjusted.numerator, adjusted.denominator) != expected:
                    raise ContractValueError(
                        "Bonferroni family p-value must count every attempted hypothesis"
                    )
        else:
            if self.required_scenario_unadjusted_min_p_values:
                raise ContractValueError(
                    "selection-aware bootstrap receipt may not carry Bonferroni minima"
                )
            for scenario_id in REQUIRED_FEE_SCENARIOS:
                expected_p = bootstrap_plus_one_p(exceedances[scenario_id])
                if scenario_p_values[scenario_id] != expected_p:
                    raise ContractValueError(
                        "selection-aware family p-value must use plus-one bootstrap arithmetic"
                    )
        if not isinstance(self.raw_family_p_value, ExactRatioV1):
            raise ContractValueError("qualifying family requires an exact family p-value")
        maximum_scenario_p = max(
            Fraction(value.numerator, value.denominator) for value in scenario_p_values.values()
        )
        if (
            Fraction(
                self.raw_family_p_value.numerator,
                self.raw_family_p_value.denominator,
            )
            != maximum_scenario_p
        ):
            raise ContractValueError(
                "family p-value must equal the maximum required-scenario p-value"
            )
        scenario_lcbs = _scenario_lcb_mapping(
            self.required_scenario_capacity_capped_lcb_microusd,
            path="required_scenario_capacity_capped_lcb_microusd",
        )
        if (
            self.capacity_capped_simultaneous_lcb_microusd is None
            or self.capacity_capped_simultaneous_lcb_microusd != min(scenario_lcbs.values())
        ):
            raise ContractValueError(
                "simultaneous LCB must equal the minimum required-scenario LCB"
            )
        expected_normalization = ranking_normalization_sha256(
            required_scenario_lcbs=self.required_scenario_capacity_capped_lcb_microusd,
            ranking_lcb_unit=cast(str, self.ranking_lcb_unit),
            ranking_exposure_seconds=cast(int, self.ranking_exposure_seconds),
            ranking_notional_usd_cents=cast(int, self.ranking_notional_usd_cents),
        )
        if self.ranking_normalization_receipt_sha256 != expected_normalization:
            raise ContractValueError(
                "ranking normalization digest does not match the common-unit payload"
            )
        expected_result = holdout_result_sha256(
            scope="FAMILY",
            candidate_sha256=self.candidate_sha256,
            candidate_code_config_sha256=self.candidate_code_config_sha256,
            open_receipt_sha256=cast(str, self.family_holdout_open_receipt_sha256),
            inference_procedure=self.within_family_procedure.value,
            inference_config_sha256=self.within_family_inference_receipt_sha256,
            pbo_receipt_sha256=self.pbo_receipt_sha256,
            result_bytes_sha256=cast(str, self.family_holdout_result_bytes_sha256),
            result_at_utc=cast(str, self.family_holdout_result_at_utc),
            fee_evidence_sha256=self.fee_evidence_sha256,
            execution_capacity_law_sha256=cast(
                str,
                self.family_execution_capacity_law_sha256,
            ),
            execution_capacity_drawdown_evidence_sha256=(
                self.execution_capacity_drawdown_evidence_sha256
            ),
            chronological_blocks_sha256=self.chronological_blocks_sha256,
            bootstrap_replicates=self.bootstrap_replicates,
            required_scenario_null_exceedances=self.required_scenario_null_exceedances,
            required_scenario_p_values=self.required_scenario_p_values,
            raw_p_value=self.raw_family_p_value,
            lcb_alpha=self.simultaneous_lcb_alpha,
            required_scenario_lcbs=self.required_scenario_capacity_capped_lcb_microusd,
            aggregate_lcb=self.capacity_capped_simultaneous_lcb_microusd,
            observed_sample_count=cast(int, self.family_holdout_observed_sample_count),
            effective_block_count=cast(int, self.family_holdout_effective_block_count),
            stress_drawdown_bps=cast(int, self.stress_drawdown_bps),
            capacity_utilization_bps=cast(int, self.capacity_utilization_bps),
            fallback_used=False,
            post_open_mutation=cast(bool, self.family_post_open_mutation),
            reused_screened_period=cast(bool, self.family_reused_screened_period),
            tested_candidate_count=cast(
                int,
                self.family_holdout_tested_candidate_count,
            ),
            result_state=self.decision_state.value,
            gates=self.gates,
        )
        expected_measured_bytes = holdout_measured_result_bytes(
            scope="FAMILY",
            family_id=self.family_id,
            authorization_receipt_sha256=cast(
                str,
                self.family_holdout_authorization_receipt_sha256,
            ),
            candidate_sha256=self.candidate_sha256,
            candidate_code_config_sha256=self.candidate_code_config_sha256,
            open_receipt_sha256=cast(str, self.family_holdout_open_receipt_sha256),
            inference_procedure=self.within_family_procedure.value,
            inference_config_sha256=self.within_family_inference_receipt_sha256,
            pbo_receipt_sha256=self.pbo_receipt_sha256,
            result_at_utc=cast(str, self.family_holdout_result_at_utc),
            fee_evidence_sha256=self.fee_evidence_sha256,
            execution_capacity_law_sha256=cast(
                str,
                self.family_execution_capacity_law_sha256,
            ),
            execution_capacity_drawdown_evidence_sha256=(
                self.execution_capacity_drawdown_evidence_sha256
            ),
            chronological_blocks_sha256=self.chronological_blocks_sha256,
            bootstrap_replicates=self.bootstrap_replicates,
            required_scenario_null_exceedances=self.required_scenario_null_exceedances,
            required_scenario_p_values=self.required_scenario_p_values,
            raw_p_value=self.raw_family_p_value,
            lcb_alpha=self.simultaneous_lcb_alpha,
            required_scenario_lcbs=(self.required_scenario_capacity_capped_lcb_microusd),
            aggregate_lcb=self.capacity_capped_simultaneous_lcb_microusd,
            observed_sample_count=cast(
                int,
                self.family_holdout_observed_sample_count,
            ),
            effective_block_count=cast(
                int,
                self.family_holdout_effective_block_count,
            ),
            stress_drawdown_bps=cast(int, self.stress_drawdown_bps),
            capacity_utilization_bps=cast(int, self.capacity_utilization_bps),
            fallback_used=False,
            post_open_mutation=cast(bool, self.family_post_open_mutation),
            reused_screened_period=cast(bool, self.family_reused_screened_period),
            tested_candidate_count=cast(
                int,
                self.family_holdout_tested_candidate_count,
            ),
            result_state=self.decision_state.value,
            gates=self.gates,
        )
        try:
            measured = parse_canonical_object(self.terminal_evidence_bytes)
        except CanonicalJsonError as error:
            raise ContractValueError(
                "qualifying family requires canonical measured result bytes"
            ) from error
        if measured.get("schema") != "SMeta1FamilyMeasuredResultV1":
            raise ContractValueError("qualifying family measured result schema drifted")
        evidence_digest = hashlib.sha256(self.terminal_evidence_bytes).hexdigest()
        if (
            self.terminal_evidence_bytes != expected_measured_bytes
            or evidence_digest != self.family_holdout_result_bytes_sha256
            or evidence_digest != self.terminal_evidence_bytes_sha256
            or self.family_holdout_receipt_sha256 != expected_result
            or self.terminal_evidence_receipt_sha256 != expected_result
        ):
            raise ContractValueError(
                "family holdout result and terminal receipts must bind the canonical result"
            )

    def as_mapping(self) -> dict[str, object]:
        def ratio_entries(
            values: tuple[tuple[str, ExactRatioV1], ...],
        ) -> list[dict[str, object]]:
            return [
                {"scenarioId": scenario_id, "value": value.as_mapping()}
                for scenario_id, value in values
            ]

        return {
            "attemptLedgerFrozenAtUtc": self.attempt_ledger_frozen_at_utc,
            "attemptLedgerSha256": self.attempt_ledger_sha256,
            "attemptedHypothesisCount": self.attempted_hypothesis_count,
            "bootstrapReplicates": self.bootstrap_replicates,
            "candidateSha256": self.candidate_sha256,
            "candidateCodeConfigSha256": self.candidate_code_config_sha256,
            "candidateLockedAtUtc": self.candidate_locked_at_utc,
            "candidateUniverseSha256": self.candidate_universe_sha256,
            "capacityCappedSimultaneousLcbMicrousd": (
                self.capacity_capped_simultaneous_lcb_microusd
            ),
            "capacityUtilizationBps": self.capacity_utilization_bps,
            "chronologicalBlocksSha256": self.chronological_blocks_sha256,
            "decisionState": self.decision_state.value,
            "executionCapacityDrawdownEvidenceSha256": (
                self.execution_capacity_drawdown_evidence_sha256
            ),
            "familyExecutionCapacityLawSha256": (self.family_execution_capacity_law_sha256),
            "familyHoldoutReceiptSha256": self.family_holdout_receipt_sha256,
            "familyHoldoutAuthorizationReceiptSha256": (
                self.family_holdout_authorization_receipt_sha256
            ),
            "familyHoldoutAuthorizedAtUtc": self.family_holdout_authorized_at_utc,
            "familyHoldoutBlockCountFloor": self.family_holdout_block_count_floor,
            "familyHoldoutBlockLengthSamples": self.family_holdout_block_length_samples,
            "familyHoldoutBlockSeedSha256": self.family_holdout_block_seed_sha256,
            "familyHoldoutDatasetSha256": self.family_holdout_dataset_sha256,
            "familyHoldoutEffectiveBlockCount": self.family_holdout_effective_block_count,
            "familyHoldoutEmbargoSeconds": self.family_holdout_embargo_seconds,
            "familyHoldoutMinimumSampleCount": self.family_holdout_minimum_sample_count,
            "familyHoldoutObservedSampleCount": self.family_holdout_observed_sample_count,
            "familyHoldoutOpenCount": self.family_holdout_open_count,
            "familyHoldoutOpenedAtUtc": self.family_holdout_opened_at_utc,
            "familyHoldoutOpenReceiptSha256": self.family_holdout_open_receipt_sha256,
            "familyHoldoutPeriodEndUtc": self.family_holdout_period_end_utc,
            "familyHoldoutPeriodStartUtc": self.family_holdout_period_start_utc,
            "familyHoldoutResultAtUtc": self.family_holdout_result_at_utc,
            "familyHoldoutResultBytesSha256": self.family_holdout_result_bytes_sha256,
            "familyHoldoutTestedCandidateCount": self.family_holdout_tested_candidate_count,
            "familyId": self.family_id,
            "familyPostOpenMutation": self.family_post_open_mutation,
            "familyPriorPeriodExpandedIntervals": [
                {
                    "expandedEndBeforeEmbargoUtc": end_utc,
                    "expandedStartUtc": start_utc,
                    "periodId": period_id,
                }
                for period_id, start_utc, end_utc in (self.family_prior_period_expanded_intervals)
            ],
            "familyPriorPeriodInventorySha256": self.family_prior_period_inventory_sha256,
            "familyReusedScreenedPeriod": self.family_reused_screened_period,
            "familyScreenedPeriodEndUtc": self.family_screened_period_end_utc,
            "feeEvidenceSha256": self.fee_evidence_sha256,
            "firstOutcomeAccessAtUtc": self.first_outcome_access_at_utc,
            "gates": [{"gateId": gate_id, "state": state.value} for gate_id, state in self.gates],
            "pboReceiptSha256": self.pbo_receipt_sha256,
            "rawFamilyPValue": (
                None if self.raw_family_p_value is None else self.raw_family_p_value.as_mapping()
            ),
            "requiredScenarioCapacityCappedLcbMicrousd": [
                {"scenarioId": scenario_id, "value": value}
                for scenario_id, value in (self.required_scenario_capacity_capped_lcb_microusd)
            ],
            "requiredScenarioNullExceedances": [
                {"scenarioId": scenario_id, "value": value}
                for scenario_id, value in self.required_scenario_null_exceedances
            ],
            "requiredScenarioPValues": ratio_entries(self.required_scenario_p_values),
            "requiredScenarioUnadjustedMinPValues": ratio_entries(
                self.required_scenario_unadjusted_min_p_values
            ),
            "rankingExposureSeconds": self.ranking_exposure_seconds,
            "rankingLcbUnit": self.ranking_lcb_unit,
            "rankingNormalizationReceiptSha256": self.ranking_normalization_receipt_sha256,
            "rankingNotionalUsdCents": self.ranking_notional_usd_cents,
            "simultaneousLcbAlpha": (
                None
                if self.simultaneous_lcb_alpha is None
                else self.simultaneous_lcb_alpha.as_mapping()
            ),
            "stressDrawdownBps": self.stress_drawdown_bps,
            "terminal": self.terminal,
            "terminalEvidenceAtUtc": self.terminal_evidence_at_utc,
            "terminalEvidenceBytesSha256": self.terminal_evidence_bytes_sha256,
            "terminalEvidenceReceiptSha256": self.terminal_evidence_receipt_sha256,
            "terminalReasonCode": self.terminal_reason_code,
            "withinFamilyInferenceReceiptSha256": (self.within_family_inference_receipt_sha256),
            "withinFamilyProcedure": (
                None if self.within_family_procedure is None else self.within_family_procedure.value
            ),
        }


@dataclass(frozen=True, slots=True)
class WinnerConfirmationV1:
    """One registry/winner-bound atomic fresh holdout receipt."""

    family_id: str
    candidate_sha256: str
    registry_sha256: str
    assessment_set_sha256: str
    winner_lock_receipt_sha256: str
    winner_locked_at_utc: str
    authorization_receipt_sha256: str
    authorized_at_utc: str
    candidate_code_config_sha256: str
    holdout_dataset_sha256: str
    holdout_period_id: str
    holdout_period_start_utc: str
    holdout_period_end_utc: str
    screened_period_end_utc: str
    holdout_embargo_seconds: int
    prior_period_expanded_intervals: tuple[tuple[str, str, str], ...]
    prior_period_inventory_sha256: str
    authorized_fee_scenarios_sha256: str
    authorized_execution_capacity_law_sha256: str
    authorized_inference_config_sha256: str
    authorized_blocks_sha256: str
    authorized_block_seed_sha256: str
    minimum_sample_count: int
    block_length_samples: int
    block_count_floor: int
    ranking_lcb_unit: str
    ranking_exposure_seconds: int
    ranking_notional_usd_cents: int
    opened_at_utc: str
    open_count: int
    tested_candidate_count: int
    open_receipt_sha256: str
    result_at_utc: str | None
    result_bytes: bytes | None
    result_bytes_sha256: str | None
    result_receipt_sha256: str | None
    fee_evidence_sha256: str | None
    execution_capacity_drawdown_evidence_sha256: str | None
    chronological_blocks_sha256: str | None
    observed_sample_count: int | None
    effective_block_count: int | None
    stress_drawdown_bps: int | None
    capacity_utilization_bps: int | None
    fallback_used: bool
    post_open_mutation: bool
    reused_screened_period: bool
    integrity_failure_receipt_sha256: str | None
    state: GateState
    bootstrap_replicates: int | None
    required_scenario_null_exceedances: tuple[tuple[str, int], ...]
    raw_p_value: ExactRatioV1 | None
    required_scenario_p_values: tuple[tuple[str, ExactRatioV1], ...]
    lcb_alpha: ExactRatioV1 | None
    capacity_capped_net_lcb_microusd: int | None
    required_scenario_capacity_capped_lcb_microusd: tuple[tuple[str, int], ...]
    gates: tuple[tuple[str, GateState], ...]

    def __post_init__(self) -> None:
        if self.family_id not in POSITIVE_ELIGIBLE_FAMILIES:
            raise ContractValueError("confirmation family is not positive-eligible in registry v1")
        for field in (
            "candidate_sha256",
            "registry_sha256",
            "assessment_set_sha256",
            "winner_lock_receipt_sha256",
            "authorization_receipt_sha256",
            "candidate_code_config_sha256",
            "holdout_dataset_sha256",
            "prior_period_inventory_sha256",
            "authorized_fee_scenarios_sha256",
            "authorized_execution_capacity_law_sha256",
            "authorized_inference_config_sha256",
            "authorized_blocks_sha256",
            "authorized_block_seed_sha256",
            "open_receipt_sha256",
        ):
            _require_sha256(getattr(self, field), path=f"confirmation.{field}")
        for field in (
            "result_bytes_sha256",
            "result_receipt_sha256",
            "fee_evidence_sha256",
            "execution_capacity_drawdown_evidence_sha256",
            "chronological_blocks_sha256",
            "integrity_failure_receipt_sha256",
        ):
            value = getattr(self, field)
            if value is not None:
                _require_sha256(value, path=f"confirmation.{field}")
        if self.result_bytes is not None and not isinstance(self.result_bytes, bytes):
            raise ContractValueError("confirmation result_bytes must be bytes or None")
        if (self.result_bytes is None) != (self.result_bytes_sha256 is None):
            raise ContractValueError(
                "confirmation measured result bytes and digest must appear together"
            )
        if not isinstance(self.holdout_period_id, str) or not self.holdout_period_id:
            raise ContractValueError("confirmation holdout_period_id must be non-empty")
        for field in (
            "holdout_embargo_seconds",
            "minimum_sample_count",
            "block_length_samples",
            "block_count_floor",
            "ranking_exposure_seconds",
            "ranking_notional_usd_cents",
            "open_count",
            "tested_candidate_count",
        ):
            value = getattr(self, field)
            if isinstance(value, bool) or not isinstance(value, int):
                raise ContractValueError(f"confirmation {field} must be an integer")
        for field in (
            "observed_sample_count",
            "effective_block_count",
            "stress_drawdown_bps",
            "capacity_utilization_bps",
            "capacity_capped_net_lcb_microusd",
        ):
            value = getattr(self, field)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
                raise ContractValueError(f"confirmation {field} must be an integer or None")
        for field in ("stress_drawdown_bps", "capacity_utilization_bps"):
            value = getattr(self, field)
            if value is not None and value < 0:
                raise ContractValueError(f"confirmation {field} must be non-negative or None")
        winner_locked = _utc(
            self.winner_locked_at_utc,
            path="confirmation.winner_locked_at_utc",
        )
        authorized = _utc(
            self.authorized_at_utc,
            path="confirmation.authorized_at_utc",
        )
        period_start = _utc(
            self.holdout_period_start_utc,
            path="confirmation.holdout_period_start_utc",
        )
        period_end = _utc(
            self.holdout_period_end_utc,
            path="confirmation.holdout_period_end_utc",
        )
        screened_end = _utc(
            self.screened_period_end_utc,
            path="confirmation.screened_period_end_utc",
        )
        opened = _utc(self.opened_at_utc, path="confirmation.opened_at_utc")
        if not winner_locked <= authorized < period_start < period_end < opened:
            raise ContractValueError(
                "winner lock, authorization, holdout period, and access chronology drifted"
            )
        if self.holdout_embargo_seconds < 0:
            raise ContractValueError("confirmation holdout embargo must be non-negative")
        prior_max_end = _prior_period_max_end(
            self.prior_period_expanded_intervals,
            expected_sha256=self.prior_period_inventory_sha256,
            path="confirmation.prior_period_inventory",
        )
        if screened_end != prior_max_end:
            raise ContractValueError(
                "confirmation screened-period end must equal the canonical inventory maximum"
            )
        if self.result_at_utc is not None:
            result_at = _utc(self.result_at_utc, path="confirmation.result_at_utc")
            if result_at < opened:
                raise ContractValueError("confirmation result cannot predate holdout access")
        if (
            self.minimum_sample_count < 1
            or self.block_length_samples < 1
            or self.block_count_floor < 2
            or self.block_length_samples * self.block_count_floor > self.minimum_sample_count
        ):
            raise ContractValueError("confirmation sample and block floors are invalid")
        if self.open_count < 1 or self.tested_candidate_count < 1:
            raise ContractValueError(
                "confirmation open and tested-candidate counts must be positive"
            )
        if (
            self.ranking_lcb_unit != RANKING_LCB_UNIT
            or self.ranking_exposure_seconds != RANKING_EXPOSURE_SECONDS
            or self.ranking_notional_usd_cents != RANKING_NOTIONAL_USD_CENTS
        ):
            raise ContractValueError(
                "confirmation must preserve the frozen common winner-score unit"
            )
        for field in ("fallback_used", "post_open_mutation", "reused_screened_period"):
            if not isinstance(getattr(self, field), bool):
                raise ContractValueError(f"confirmation {field} must be boolean")
        if not isinstance(self.state, GateState):
            raise ContractValueError("confirmation state must be GateState")
        _gate_mapping(
            self.gates,
            expected=REQUIRED_CONFIRMATION_GATES,
            path="confirmation.gates",
        )
        expected_authorization = winner_authorization_sha256(
            registry_sha256=self.registry_sha256,
            assessment_set_sha256=self.assessment_set_sha256,
            winner_lock_receipt_sha256=self.winner_lock_receipt_sha256,
            winner_locked_at_utc=self.winner_locked_at_utc,
            family_id=self.family_id,
            candidate_sha256=self.candidate_sha256,
            candidate_code_config_sha256=self.candidate_code_config_sha256,
            holdout_dataset_sha256=self.holdout_dataset_sha256,
            holdout_period_id=self.holdout_period_id,
            holdout_period_start_utc=self.holdout_period_start_utc,
            holdout_period_end_utc=self.holdout_period_end_utc,
            screened_period_end_utc=self.screened_period_end_utc,
            holdout_embargo_seconds=self.holdout_embargo_seconds,
            prior_period_inventory_sha256=self.prior_period_inventory_sha256,
            authorized_fee_scenarios_sha256=self.authorized_fee_scenarios_sha256,
            authorized_execution_capacity_law_sha256=(
                self.authorized_execution_capacity_law_sha256
            ),
            authorized_inference_config_sha256=self.authorized_inference_config_sha256,
            authorized_blocks_sha256=self.authorized_blocks_sha256,
            authorized_block_seed_sha256=self.authorized_block_seed_sha256,
            minimum_sample_count=self.minimum_sample_count,
            block_length_samples=self.block_length_samples,
            block_count_floor=self.block_count_floor,
            ranking_lcb_unit=self.ranking_lcb_unit,
            ranking_exposure_seconds=self.ranking_exposure_seconds,
            ranking_notional_usd_cents=self.ranking_notional_usd_cents,
            authorized_at_utc=self.authorized_at_utc,
        )
        if self.authorization_receipt_sha256 != expected_authorization:
            raise ContractValueError(
                "winner authorization digest does not match its canonical payload"
            )
        expected_open = holdout_open_sha256(
            authorization_receipt_sha256=self.authorization_receipt_sha256,
            holdout_dataset_sha256=self.holdout_dataset_sha256,
            opened_at_utc=self.opened_at_utc,
            open_count=self.open_count,
        )
        if self.open_receipt_sha256 != expected_open:
            raise ContractValueError("winner open digest does not match its canonical payload")
        integrity_claimed = (
            self.fallback_used
            or self.post_open_mutation
            or self.reused_screened_period
            or self.tested_candidate_count != 1
        )
        if self.integrity_failure_receipt_sha256 is not None:
            expected_integrity = holdout_integrity_failure_sha256(
                open_receipt_sha256=self.open_receipt_sha256,
                fallback_used=self.fallback_used,
                post_open_mutation=self.post_open_mutation,
                reused_screened_period=self.reused_screened_period,
                tested_candidate_count=self.tested_candidate_count,
            )
            if not integrity_claimed or self.integrity_failure_receipt_sha256 != expected_integrity:
                raise ContractValueError(
                    "winner integrity-failure digest does not match proven contamination"
                )
        if self.state is GateState.PASS and (
            self.result_at_utc is None
            or self.result_bytes is None
            or self.result_bytes_sha256 is None
            or self.result_receipt_sha256 is None
            or self.fee_evidence_sha256 is None
            or self.execution_capacity_drawdown_evidence_sha256 is None
            or self.chronological_blocks_sha256 is None
            or self.observed_sample_count is None
            or self.effective_block_count is None
            or self.stress_drawdown_bps is None
            or self.capacity_utilization_bps is None
            or self.raw_p_value is None
            or self.capacity_capped_net_lcb_microusd is None
        ):
            raise ContractValueError("passing confirmation requires a complete result receipt")
        if (self.raw_p_value is None) != (self.capacity_capped_net_lcb_microusd is None):
            raise ContractValueError("confirmation p-value and LCB must appear together")
        if self.raw_p_value is None:
            if (
                self.result_at_utc is not None
                or self.result_bytes is not None
                or self.result_bytes_sha256 is not None
                or self.result_receipt_sha256 is not None
                or self.fee_evidence_sha256 is not None
                or self.execution_capacity_drawdown_evidence_sha256 is not None
                or self.chronological_blocks_sha256 is not None
                or self.observed_sample_count is not None
                or self.effective_block_count is not None
                or self.stress_drawdown_bps is not None
                or self.capacity_utilization_bps is not None
                or self.required_scenario_null_exceedances
                or self.required_scenario_p_values
                or self.lcb_alpha is not None
                or self.required_scenario_capacity_capped_lcb_microusd
            ):
                raise ContractValueError(
                    "confirmation without aggregate values must not carry scenario evidence"
                )
            return
        if (
            self.bootstrap_replicates != 4_096
            or not isinstance(self.lcb_alpha, ExactRatioV1)
            or Fraction(self.lcb_alpha.numerator, self.lcb_alpha.denominator) != FAMILYWISE_ALPHA
        ):
            raise ContractValueError(
                "fresh holdout requires 4096 replicates and one-sided LCB alpha 1/40"
            )
        exceedances = _scenario_lcb_mapping(
            self.required_scenario_null_exceedances,
            path="confirmation.required_scenario_null_exceedances",
        )
        scenario_p_values = _scenario_p_mapping(
            self.required_scenario_p_values,
            path="confirmation.required_scenario_p_values",
        )
        for scenario_id in REQUIRED_FEE_SCENARIOS:
            count = exceedances[scenario_id]
            if not 0 <= count <= 4_096:
                raise ContractValueError("confirmation exceedances must lie in [0,4096]")
            if scenario_p_values[scenario_id] != bootstrap_plus_one_p(count):
                raise ContractValueError(
                    "confirmation p-values must use plus-one bootstrap arithmetic"
                )
        if Fraction(self.raw_p_value.numerator, self.raw_p_value.denominator) != max(
            Fraction(value.numerator, value.denominator) for value in scenario_p_values.values()
        ):
            raise ContractValueError(
                "confirmation p-value must equal maximum required-scenario p-value"
            )
        scenario_lcbs = _scenario_lcb_mapping(
            self.required_scenario_capacity_capped_lcb_microusd,
            path="confirmation.required_scenario_capacity_capped_lcb_microusd",
        )
        if self.capacity_capped_net_lcb_microusd != min(scenario_lcbs.values()):
            raise ContractValueError("confirmation LCB must equal minimum required-scenario LCB")
        complete_result = all(
            value is not None
            for value in (
                self.result_at_utc,
                self.result_bytes,
                self.result_bytes_sha256,
                self.result_receipt_sha256,
                self.fee_evidence_sha256,
                self.execution_capacity_drawdown_evidence_sha256,
                self.chronological_blocks_sha256,
                self.observed_sample_count,
                self.effective_block_count,
                self.stress_drawdown_bps,
                self.capacity_utilization_bps,
            )
        )
        if not complete_result:
            raise ContractValueError(
                "winner inference values require complete canonical measured result bytes"
            )
        expected_measured_bytes = holdout_measured_result_bytes(
            scope="WINNER",
            family_id=self.family_id,
            authorization_receipt_sha256=self.authorization_receipt_sha256,
            candidate_sha256=self.candidate_sha256,
            candidate_code_config_sha256=self.candidate_code_config_sha256,
            open_receipt_sha256=self.open_receipt_sha256,
            inference_procedure="FRESH_WINNER_BOOTSTRAP",
            inference_config_sha256=self.authorized_inference_config_sha256,
            pbo_receipt_sha256=None,
            result_at_utc=cast(str, self.result_at_utc),
            fee_evidence_sha256=cast(str, self.fee_evidence_sha256),
            execution_capacity_law_sha256=(self.authorized_execution_capacity_law_sha256),
            execution_capacity_drawdown_evidence_sha256=cast(
                str,
                self.execution_capacity_drawdown_evidence_sha256,
            ),
            chronological_blocks_sha256=cast(str, self.chronological_blocks_sha256),
            bootstrap_replicates=self.bootstrap_replicates,
            required_scenario_null_exceedances=self.required_scenario_null_exceedances,
            required_scenario_p_values=self.required_scenario_p_values,
            raw_p_value=self.raw_p_value,
            lcb_alpha=self.lcb_alpha,
            required_scenario_lcbs=(self.required_scenario_capacity_capped_lcb_microusd),
            aggregate_lcb=self.capacity_capped_net_lcb_microusd,
            observed_sample_count=cast(int, self.observed_sample_count),
            effective_block_count=cast(int, self.effective_block_count),
            stress_drawdown_bps=cast(int, self.stress_drawdown_bps),
            capacity_utilization_bps=cast(int, self.capacity_utilization_bps),
            fallback_used=self.fallback_used,
            post_open_mutation=self.post_open_mutation,
            reused_screened_period=self.reused_screened_period,
            tested_candidate_count=self.tested_candidate_count,
            result_state=self.state.value,
            gates=self.gates,
        )
        measured_bytes = cast(bytes, self.result_bytes)
        try:
            measured = parse_canonical_object(measured_bytes)
        except CanonicalJsonError as error:
            raise ContractValueError("winner requires canonical measured result bytes") from error
        if measured.get("schema") != "SMeta1WinnerMeasuredResultV1":
            raise ContractValueError("winner measured result schema drifted")
        measured_digest = hashlib.sha256(measured_bytes).hexdigest()
        if measured_bytes != expected_measured_bytes or measured_digest != self.result_bytes_sha256:
            raise ContractValueError("winner measured result bytes do not match the locked payload")
        expected_result = holdout_result_sha256(
            scope="WINNER",
            candidate_sha256=self.candidate_sha256,
            candidate_code_config_sha256=self.candidate_code_config_sha256,
            open_receipt_sha256=self.open_receipt_sha256,
            inference_procedure="FRESH_WINNER_BOOTSTRAP",
            inference_config_sha256=self.authorized_inference_config_sha256,
            pbo_receipt_sha256=None,
            result_bytes_sha256=measured_digest,
            result_at_utc=cast(str, self.result_at_utc),
            fee_evidence_sha256=cast(str, self.fee_evidence_sha256),
            execution_capacity_law_sha256=(self.authorized_execution_capacity_law_sha256),
            execution_capacity_drawdown_evidence_sha256=cast(
                str,
                self.execution_capacity_drawdown_evidence_sha256,
            ),
            chronological_blocks_sha256=cast(str, self.chronological_blocks_sha256),
            bootstrap_replicates=self.bootstrap_replicates,
            required_scenario_null_exceedances=self.required_scenario_null_exceedances,
            required_scenario_p_values=self.required_scenario_p_values,
            raw_p_value=self.raw_p_value,
            lcb_alpha=self.lcb_alpha,
            required_scenario_lcbs=self.required_scenario_capacity_capped_lcb_microusd,
            aggregate_lcb=self.capacity_capped_net_lcb_microusd,
            observed_sample_count=cast(int, self.observed_sample_count),
            effective_block_count=cast(int, self.effective_block_count),
            stress_drawdown_bps=cast(int, self.stress_drawdown_bps),
            capacity_utilization_bps=cast(int, self.capacity_utilization_bps),
            fallback_used=self.fallback_used,
            post_open_mutation=self.post_open_mutation,
            reused_screened_period=self.reused_screened_period,
            tested_candidate_count=self.tested_candidate_count,
            result_state=self.state.value,
            gates=self.gates,
        )
        if self.result_receipt_sha256 != expected_result:
            raise ContractValueError("winner result digest does not match its canonical payload")


@dataclass(frozen=True, slots=True)
class N3DecisionV1:
    """Machine-checkable N-3 verdict; capital authority is invariantly NONE."""

    verdict: N3Verdict
    provisional_family_id: str | None
    verified_candidate_sha256: str | None
    reasons: tuple[str, ...]
    capital_authority: str = "NONE"

    def __post_init__(self) -> None:
        if not isinstance(self.verdict, N3Verdict):
            raise ContractValueError("verdict must be N3Verdict")
        if (
            self.provisional_family_id is not None
            and self.provisional_family_id not in EXPECTED_FAMILIES
        ):
            raise ContractValueError("provisional family is outside the frozen universe")
        if self.verified_candidate_sha256 is not None:
            _require_sha256(
                self.verified_candidate_sha256,
                path="verified_candidate_sha256",
            )
        if self.verdict is N3Verdict.VERIFIED_POSITIVE and self.verified_candidate_sha256 is None:
            raise ContractValueError("VERIFIED_POSITIVE requires an exact candidate digest")
        if (
            self.verdict is not N3Verdict.VERIFIED_POSITIVE
            and self.verified_candidate_sha256 is not None
        ):
            raise ContractValueError("non-positive verdict may not carry a verified candidate")
        if not self.reasons:
            raise ContractValueError("N-3 decision requires at least one reason")
        if self.capital_authority != "NONE":
            raise ContractValueError("S-META1 grants no capital authority")


def bootstrap_plus_one_p(exceedances: int, *, replicates: int = 4_096) -> ExactRatioV1:
    """Exact null-bootstrap p=(1+exceedances)/(1+replicates)."""

    if isinstance(replicates, bool) or not isinstance(replicates, int) or replicates < 1:
        raise ContractValueError("replicates must be a positive integer")
    if (
        isinstance(exceedances, bool)
        or not isinstance(exceedances, int)
        or not 0 <= exceedances <= replicates
    ):
        raise ContractValueError("exceedances must be an integer in [0, replicates]")
    return make_ratio(1 + exceedances, 1 + replicates)


def assessment_set_sha256(
    registry: SMeta1RegistryV1,
    assessments: tuple[FamilyAssessmentV1, ...],
) -> str:
    """Digest the full terminal/unknown assessment set and frozen registry."""

    if not isinstance(registry, SMeta1RegistryV1):
        raise ContractValueError("registry must be SMeta1RegistryV1")
    if not isinstance(assessments, tuple) or len(assessments) != FAMILY_COUNT:
        raise ContractValueError("assessments must be a seven-entry tuple")
    by_family: dict[str, FamilyAssessmentV1] = {}
    for assessment in assessments:
        if not isinstance(assessment, FamilyAssessmentV1):
            raise ContractValueError("assessments must contain FamilyAssessmentV1")
        if assessment.family_id in by_family:
            raise ContractValueError("assessment family identities must be unique")
        by_family[assessment.family_id] = assessment
    if tuple(sorted(by_family)) != EXPECTED_FAMILIES:
        raise ContractValueError("assessments must cover the frozen family universe exactly")
    mapping = {
        "assessments": [by_family[family_id].as_mapping() for family_id in EXPECTED_FAMILIES],
        "registrySha256": registry.sha256,
        "schema": "SMeta1AssessmentSetV1",
    }
    return hashlib.sha256(canonical_json_bytes(mapping)).hexdigest()


def _all_pass(gates: dict[str, GateState]) -> bool:
    return all(state is GateState.PASS for state in gates.values())


def _has_unknown(gates: dict[str, GateState]) -> bool:
    return any(state is GateState.UNKNOWN for state in gates.values())


def _decision(
    verdict: N3Verdict,
    reason: str,
    *,
    provisional: str | None = None,
    verified: str | None = None,
) -> N3DecisionV1:
    return N3DecisionV1(
        verdict=verdict,
        provisional_family_id=provisional,
        verified_candidate_sha256=verified,
        reasons=(reason,),
    )


def evaluate_n3(
    registry: SMeta1RegistryV1,
    assessments: tuple[FamilyAssessmentV1, ...],
    confirmation: WinnerConfirmationV1 | None = None,
) -> N3DecisionV1:
    """Apply the frozen two-stage family/winner law without fallback selection."""

    if not isinstance(registry, SMeta1RegistryV1):
        raise ContractValueError("registry must be SMeta1RegistryV1")
    if not isinstance(assessments, tuple) or len(assessments) != FAMILY_COUNT:
        raise ContractValueError("assessments must be a seven-entry tuple")
    by_family: dict[str, FamilyAssessmentV1] = {}
    for assessment in assessments:
        if not isinstance(assessment, FamilyAssessmentV1):
            raise ContractValueError("assessments must contain FamilyAssessmentV1")
        if assessment.family_id in by_family:
            raise ContractValueError("assessment family identities must be unique")
        by_family[assessment.family_id] = assessment
    if tuple(sorted(by_family)) != EXPECTED_FAMILIES:
        raise ContractValueError("assessments must cover the frozen family universe exactly")
    assessment_digest = assessment_set_sha256(registry, assessments)

    trials: list[TrialRecordV1] = []
    p_values: list[tuple[str, ExactRatioV1 | None]] = []
    trial_to_family: dict[str, str] = {}
    for ordinal, family_id in enumerate(EXPECTED_FAMILIES, start=1):
        assessment = by_family[family_id]
        trial_id = f"f-{ordinal:02d}"
        trial_to_family[trial_id] = family_id
        gates = _gate_mapping(
            assessment.gates,
            expected=REQUIRED_FAMILY_GATES,
            path=f"{family_id}.gates",
        )
        is_qualifying = (
            assessment.terminal
            and assessment.decision_state is FamilyDecisionState.QUALIFYING
            and _all_pass(gates)
            and assessment.capacity_capped_simultaneous_lcb_microusd is not None
            and assessment.capacity_capped_simultaneous_lcb_microusd > 0
            and assessment.stress_drawdown_bps is not None
            and assessment.stress_drawdown_bps <= MAX_DRAWDOWN_BPS
            and assessment.capacity_utilization_bps is not None
            and assessment.capacity_utilization_bps <= MAX_CAPACITY_UTILIZATION_BPS
        )
        trials.append(
            TrialRecordV1(
                trial_id=trial_id,
                family_id="s-meta1-burst",
                model_id="family-level-null",
                metric_id="net-edge",
                status=TrialStatus.COMPLETED if is_qualifying else TrialStatus.FAILED,
                note="family-level multiplicity entry",
            )
        )
        p_values.append(
            (
                trial_id,
                assessment.raw_family_p_value if is_qualifying else None,
            )
        )
    holm = holm_bonferroni(
        TrialLedgerV1(trials=tuple(trials)),
        tuple(p_values),
        familywise_alpha_per_myriad=250,
    )
    selected_families = {trial_to_family[trial_id] for trial_id in holm.rejected_trial_ids}

    unresolved = False
    eligible: list[FamilyAssessmentV1] = []
    for family_id in EXPECTED_FAMILIES:
        assessment = by_family[family_id]
        if not assessment.terminal or assessment.decision_state is FamilyDecisionState.UNKNOWN:
            unresolved = True
            continue
        if assessment.decision_state is FamilyDecisionState.NO_GO:
            continue
        gates = _gate_mapping(
            assessment.gates,
            expected=REQUIRED_FAMILY_GATES,
            path=f"{family_id}.gates",
        )
        if any(state is GateState.FAIL for state in gates.values()):
            continue
        if _has_unknown(gates):
            unresolved = True
            continue
        if assessment.stress_drawdown_bps is None or assessment.capacity_utilization_bps is None:
            unresolved = True
            continue
        if (
            family_id not in selected_families
            or assessment.capacity_capped_simultaneous_lcb_microusd is None
            or assessment.capacity_capped_simultaneous_lcb_microusd <= 0
            or not _all_pass(gates)
            or assessment.stress_drawdown_bps > MAX_DRAWDOWN_BPS
            or assessment.capacity_utilization_bps > MAX_CAPACITY_UTILIZATION_BPS
        ):
            continue
        eligible.append(assessment)

    if unresolved:
        return _decision(N3Verdict.UNKNOWN, "UNRESOLVED_OR_UNKNOWN_FAMILY_EVIDENCE")
    if not eligible:
        return _decision(N3Verdict.NO_GO, "ALL_SEVEN_FAMILIES_TERMINAL_WITH_NO_ELIGIBLE_WINNER")

    eligible.sort(
        key=lambda item: (
            -cast(int, item.capacity_capped_simultaneous_lcb_microusd),
            cast(int, item.stress_drawdown_bps),
            cast(int, item.capacity_utilization_bps),
            item.family_id,
        )
    )
    provisional = eligible[0]
    candidate_sha = cast(str, provisional.candidate_sha256)
    if confirmation is None:
        return _decision(
            N3Verdict.UNKNOWN,
            "FRESH_WINNER_HOLDOUT_NOT_OPENED",
            provisional=provisional.family_id,
        )
    if (
        confirmation.family_id != provisional.family_id
        or confirmation.candidate_sha256 != candidate_sha
    ):
        raise ContractValueError("confirmation must bind the exact deterministic winner")
    if (
        confirmation.registry_sha256 != registry.sha256
        or confirmation.assessment_set_sha256 != assessment_digest
        or confirmation.candidate_code_config_sha256 != provisional.candidate_code_config_sha256
        or confirmation.authorized_execution_capacity_law_sha256
        != provisional.family_execution_capacity_law_sha256
    ):
        raise ContractValueError(
            "confirmation must bind the registry, assessment set, winner code/config, "
            "and family execution-capacity law"
        )
    latest_terminal = _utc(registry.frozen_at_utc, path="registry.frozen_at_utc")
    for assessment in assessments:
        if assessment.terminal_evidence_at_utc is not None:
            latest_terminal = max(
                latest_terminal,
                _utc(
                    assessment.terminal_evidence_at_utc,
                    path=f"{assessment.family_id}.terminal_evidence_at_utc",
                ),
            )
    if (
        _utc(
            confirmation.winner_locked_at_utc,
            path="confirmation.winner_locked_at_utc",
        )
        <= latest_terminal
    ):
        raise ContractValueError("winner lock must postdate every terminal family receipt")
    confirmation_gates = _gate_mapping(
        confirmation.gates,
        expected=REQUIRED_CONFIRMATION_GATES,
        path="confirmation.gates",
    )
    earliest = _utc(FRESH_HOLDOUT_NOT_BEFORE_UTC, path="freshHoldoutNotBeforeUtc")
    period_start = _utc(
        confirmation.holdout_period_start_utc,
        path="confirmation.holdout_period_start_utc",
    )
    screened_end = _utc(
        confirmation.screened_period_end_utc,
        path="confirmation.screened_period_end_utc",
    )
    independently_proven_contamination = (
        period_start < earliest
        or screened_end + timedelta(seconds=confirmation.holdout_embargo_seconds) >= period_start
        or confirmation.open_count != 1
        or (
            confirmation.integrity_failure_receipt_sha256 is not None
            and (
                confirmation.fallback_used
                or confirmation.post_open_mutation
                or confirmation.reused_screened_period
                or confirmation.tested_candidate_count != 1
            )
        )
    )
    complete_result = all(
        value is not None
        for value in (
            confirmation.result_at_utc,
            confirmation.result_bytes,
            confirmation.result_bytes_sha256,
            confirmation.result_receipt_sha256,
            confirmation.fee_evidence_sha256,
            confirmation.execution_capacity_drawdown_evidence_sha256,
            confirmation.chronological_blocks_sha256,
            confirmation.observed_sample_count,
            confirmation.effective_block_count,
            confirmation.stress_drawdown_bps,
            confirmation.capacity_utilization_bps,
            confirmation.raw_p_value,
            confirmation.lcb_alpha,
            confirmation.capacity_capped_net_lcb_microusd,
        )
    )
    measured_failure = False
    if complete_result:
        p_value = cast(ExactRatioV1, confirmation.raw_p_value)
        measured_failure = (
            any(state is GateState.FAIL for state in confirmation_gates.values())
            or Fraction(p_value.numerator, p_value.denominator) > FAMILYWISE_ALPHA
            or cast(int, confirmation.capacity_capped_net_lcb_microusd) <= 0
            or cast(int, confirmation.observed_sample_count) < confirmation.minimum_sample_count
            or cast(int, confirmation.effective_block_count) < confirmation.block_count_floor
            or cast(int, confirmation.stress_drawdown_bps) > MAX_DRAWDOWN_BPS
            or cast(int, confirmation.capacity_utilization_bps) > MAX_CAPACITY_UTILIZATION_BPS
            or confirmation.fee_evidence_sha256 != confirmation.authorized_fee_scenarios_sha256
            or confirmation.chronological_blocks_sha256 != confirmation.authorized_blocks_sha256
        )
    if independently_proven_contamination or measured_failure:
        return _decision(
            N3Verdict.NO_GO,
            "FRESH_WINNER_HOLDOUT_FAILED_WITH_NO_FALLBACK",
            provisional=provisional.family_id,
        )
    unproven_integrity_claim = confirmation.integrity_failure_receipt_sha256 is None and (
        confirmation.fallback_used
        or confirmation.post_open_mutation
        or confirmation.reused_screened_period
        or confirmation.tested_candidate_count != 1
    )
    if (
        confirmation.state is not GateState.PASS
        or _has_unknown(confirmation_gates)
        or not complete_result
        or unproven_integrity_claim
    ):
        return _decision(
            N3Verdict.UNKNOWN,
            "FRESH_WINNER_HOLDOUT_UNRESOLVED",
            provisional=provisional.family_id,
        )
    return _decision(
        N3Verdict.VERIFIED_POSITIVE,
        "ALL_FROZEN_FAMILY_AND_FRESH_WINNER_GATES_PASSED",
        provisional=provisional.family_id,
        verified=candidate_sha,
    )
