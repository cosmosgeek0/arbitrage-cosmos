#!/usr/bin/env python3
"""Freeze and verify the N3-S2 accepted-only profitability successor.

N3-S2 is an incremental overlay on the accepted N3-S1 commit. It preserves the
entire N3-S1 registry byte-for-byte, consumes only the exact orchestrator-
accepted economic rows newer than V-G31, and records every intervening
orchestrator disposition without importing rejected or source-only economics.

The command is offline and deterministic. It uses only an explicit spec,
run.md bytes, and exact Git objects. It has no network, clock, environment,
provider, private API, host, order, transfer, withdrawal, or money capability.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Literal, cast, overload

import registry_tool as n3s1

ContractError = n3s1.ContractError

SCHEMA = "N3S2ProfitabilityConvergenceV1"
SPEC_SCHEMA = "N3S2OriginSpecV1"
VERSION = 1

CANONICAL_COMMIT = "a169b123fb186d1943a75ad648552c4d95be1be1"
CANONICAL_TREE = "37d1b88aa7c8d9ee1f70dc35d0e78613b6ed32f9"

BASELINE_COMMIT = "13631f3cc31020d8ca377d57e24ad6b75d89dba6"
BASELINE_TREE = "0d6fe288894fd61d267087158e67a1564cf31e5c"
BASELINE_PARENT = CANONICAL_COMMIT
BASELINE_RECORD_ID = "2026-07-30 ORCHESTRATOR N3-S1 ACCEPTANCE + REFILL"
BASELINE_ROW_SHA256 = "782961bc94190770849d2becc6a4b48b94fef004958bfa927c45fa3933ca0703"
BASELINE_SPEC_PATH = "quant/research/n3_successor/origin_spec.v1.json"
BASELINE_SPEC_SHA256 = "d9215f40bbc7c19fe862c5852a40c3e323492ef2f31d7ea8c314a11168e07f75"
BASELINE_REGISTRY_PATH = "quant/research/n3_successor/current_profitability_registry.v1.json"
BASELINE_REGISTRY_SHA256 = "7e62d2f0bb18b6f0ec73a367ab0ce1ff55d6b35a2c0ed750e8ab12340be9b218"
BASELINE_CARD_PATH = "quant/research/n3_successor/owner_verdict_card.v1.md"
BASELINE_CARD_SHA256 = "c5fcde6f7d219c560349bfb4df951a6a145fd3510b8491d7bd776d69ef2dd10b"
BASELINE_ORIGINS_SHA256 = "434a07d8f36e13a543590ea28301a511a6d018ea85d6e53f9612d8c87dcc987c"
BASELINE_FAMILIES_SHA256 = "8678c8b3b7f80ae50a8a9c4d1ead3361fa1771551bc9e0e31cce55de22b07074"
BASELINE_LEGACY_EXCLUSIONS_SHA256 = (
    "999e0e530da8136349435c1534dcd357d432916309f02bfb611e2dd91d11fa88"
)
BASELINE_TRUTH_POLICY_SHA256 = "9ada035aa4e394641243530de655dcb5fd9c7aefede09f56b097f5ccb2b3a48e"

DELTA_START_RECORD_ID = "2026-07-30 ORCHESTRATOR V-G31 ACCEPTANCE"
DELTA_START_ROW_SHA256 = "83506a85d714eb0546663214bcd936e5431795a052f571fe55d56701a69fa0a8"
ECONOMIC_THROUGH_RECORD_ID = "2026-07-30 ORCHESTRATOR S-2I ACCEPTANCE + OPUS 5 FOLD-PREP REFILL"
ECONOMIC_THROUGH_ROW_SHA256 = "a8eed34a68da51dd2a31638209bf6e60ea2fc630c70ee82aeaa751ac14eeae96"
LEDGER_AS_OF_RECORD_ID = "2026-07-30 ORCHESTRATOR DQ-14 ACCEPTANCE"
LEDGER_AS_OF_ROW_SHA256 = "7969f6b26f06a0e8890a3b6bd355c946cca534b201a63c8a3b600a56ca71b5bb"

INCREMENTAL_ORIGIN_IDS = (
    "V-G28",
    "V-G37",
    "S-1Y",
    "S-2C",
    "S-1Z",
    "V-G36",
    "S-2G",
    "S-2H",
    "V-G27",
    "S-2A",
    "S-2K",
    "S-2I",
)
EXPECTED_COMBINED_ORIGIN_COUNT = 48
EXPECTED_COMBINED_FAMILY_COUNT = 47
EXPECTED_LOCAL_VERDICT_COUNTS = {"NO_GO": 24, "UNMEASURED": 24}

REQUIRED_ORIGIN_LIMITATIONS = {
    "V-G28": (
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "BASE_INTERVAL_CROSSES_ZERO",
        "EXECUTABLE_CAPACITY_UNMEASURED",
        "HOLDOUT_UNOPENED",
        "NINE_DEVELOPMENT_GATES_FAILED",
        "PBO_ABOVE_PREDECLARED_THRESHOLD",
    ),
    "V-G37": (
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "DAILY_CLOSE_BOUNDARY_INVALID_ALPACAUSDT_2025_05_ROW_2",
        "ECONOMICS_INFERENCE_DRAWDOWN_AND_CAPACITY_UNMEASURED",
        "EXECUTABLE_CAPACITY_UNMEASURED",
        "HOLDOUT_SEALED_UNOPENED",
        "NO_REPAIR_OR_RERUN",
    ),
    "S-1Y": (
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "BASE_AND_STRESS_INTERVALS_CROSS_ZERO",
        "EXECUTABLE_FULL_WINDOW_CAPACITY_UNMEASURED",
        "HOLM_P_ONE",
        "HOLDOUT_UNOPENED",
        "POSITIVE_BASE_PROXY_NOT_CREDIBLE",
        "REALITY_CHECK_P_0_8711",
        "STRESS_AND_SEVERE_NET_NEGATIVE",
    ),
    "S-2C": (
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "CANDIDATE_ABSENT",
        "ECONOMICS_INFERENCE_DRAWDOWN_AND_CAPACITY_UNMEASURED",
        "HOLDOUT_UNOPENED",
        "NO_REPAIR_OR_RERUN",
        "NON_HOURLY_FUNDING_TIMESTAMP",
        "RAW_SOURCE_BODIES_EXTERNAL",
    ),
    "S-1Z": (
        "ACCEPTANCE_ROW_COMMIT_FRAGMENT_NON_SUFFIX",
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "BASE_STRESS_SEVERE_NET_NEGATIVE",
        "EXECUTABLE_CAPACITY_UNMEASURED",
        "HOLDOUT_CONSUMED_NO_REOPEN",
        "HOLM_P_ONE",
        "PBO_DIAGNOSTIC_ONLY",
        "RAW_SOURCE_BODIES_EXTERNAL",
        "STRESS_SEVERE_DRAWDOWN_EXCESSIVE",
        "WHITE_P_0_9844",
    ),
    "V-G36": (
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "BASE_STRESS_DRAWDOWN_EXCEEDS_20_PERCENT",
        "EXECUTABLE_INTRADAY_CAPACITY_UNMEASURED",
        "HOLDOUT_UNOPENED",
        "HOLM_AND_WHITE_GATES_FAILED",
        "NO_CHAMPION",
        "PBO_DIAGNOSTIC_NOT_SELECTOR",
        "POSITIVE_POINT_ESTIMATE_NOT_CREDIBLE",
        "RUN_CONSUMED",
        "ZERO_OF_12_TRIALS_PASSED",
    ),
    "S-2G": (
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "BASE_STRESS_FEE_STRESS_NET_NEGATIVE",
        "CANDIDATE_SEAL_ABSENT",
        "EXECUTABLE_CAPACITY_UNMEASURED",
        "FIXED_COHORT_SURVIVORSHIP_FILTER_TRUTH_UNRESOLVED",
        "GROSS_POSITIVE_PROXY_NOT_CREDIBLE",
        "HOLDOUT_UNOPENED",
        "HOLM_AND_WHITE_P_ONE",
        "INFERENCE_CONDITIONAL",
        "NO_DEVELOPMENT_QUALIFIER",
        "NOMINAL_USDT_NOT_USD_PARITY",
        "PBO_DIAGNOSTIC_ONLY",
        "SHARED_HOLDOUT_REUSE_RISK_UNCERTIFIED",
        "STRESS_DRAWDOWN_68_63_PERCENT",
        "STRESS_INTERVAL_ENTIRELY_NEGATIVE",
        "SYNTHETIC_SHORT_BORROW_UNKNOWN",
    ),
    "S-2H": (
        "ACCOUNT_EFFECTIVE_COMMISSION_UNKNOWN",
        "ALL_ECONOMIC_STATISTICAL_DRAWDOWN_CAPACITY_FIELDS_UNMEASURED",
        "FROZEN_TOP30_RANK_EFFECT_OF_9_FALSE_REJECTIONS_UNMEASURED",
        "FROZEN_USDT_AS_USD_ASSUMPTION_UNUSABLE_FOR_FUTURE_REUSE",
        "GLOBAL_HOLDOUT_NOT_CERTIFIED_SHARED_REUSE_RISK",
        "HISTORICAL_FILTERS_SPREAD_DEPTH_IMPACT_AND_EXECUTABLE_CAPACITY_UNMEASURED",
        "HOLDOUT_SEALED_UNOPENED",
        "NO_DEVELOPMENT_RESULT_OR_SELECTION",
        "NO_REPAIR_OR_RERUN",
        "PREDECLARED_UP_SUFFIX_FALSE_POSITIVE_EXCLUSIONS_JUPUSDT_AND_SYRUPUSDT",
        "PRIOR_DISCOVERY_ASCII_CANDIDATE_GRAMMAR_LIMITATION",
        "SCREEN_CONSUMED",
        "SPOT_IS_CONTINUOUS_UTC_BOUNDARY_IS_NOT_A_MARKET_CLOSE",
        "SYNTHETIC_SHORT_BORROW_INVENTORY_AND_INTEREST_UNKNOWN",
    ),
    "V-G27": (
        "ACCEPTANCE_ROW_CORRECTS_WORKER_TREE_SUFFIX",
        "ACCOUNT_EFFECTIVE_FEES_AND_PROFITABILITY_UNKNOWN",
        "BASE_AND_STRESS_INTERVALS_ENTIRELY_NEGATIVE",
        "BASE_STRESS_SEVERE_NET_NEGATIVE",
        "EXECUTABLE_CAPACITY_UNMEASURED",
        "FIXED_COHORT_SURVIVORSHIP_LIMITATION",
        "GROSS_POSITIVE_PROXY_NOT_CREDIBLE",
        "HOLDOUT_UNOPENED",
        "HOLM_AND_WHITE_P_ONE",
        "NINE_OF_TEN_FORMAL_GATES_FAILED",
        "NOMINAL_SCREEN_BELOW_INITIAL_1000",
        "PBO_DIAGNOSTIC_ONLY",
        "PROGRAM_WIDE_MULTIPLICITY_NOT_CONVERGED",
        "PUBLIC_QUOTE_VOLUME_AND_COSTS_NOT_EXECUTABLE_DEPTH_OR_ACCOUNT_TRUTH",
        "STRESS_DRAWDOWN_26_76_PERCENT",
    ),
    "S-2A": (
        "ACCOUNT_EFFECTIVE_FEES_UNKNOWN",
        "BASE_INTERVAL_CROSSES_ZERO",
        "BASE_STRESS_SEVERE_NET_NEGATIVE",
        "CURRENT_EXCHANGE_INFO_NOT_HISTORICAL_UNIVERSE",
        "EXECUTABLE_CAPACITY_UNMEASURED",
        "HOLDOUT_SEALED_UNOPENED",
        "HOLM_P_ONE",
        "HOURLY_MARK_OPEN_NOT_EXACT_FUNDING_SETTLEMENT_MARK",
        "NO_ELIGIBLE_CHAMPION",
        "PBO_DIAGNOSTIC_ONLY",
        "PROGRAM_WIDE_MULTIPLICITY_UNMEASURED",
        "PUBLIC_TURNOVER_NOT_EXECUTABLE_DEPTH",
        "REALIZED_DAILY_DRAWDOWN_NOT_INTRAPERIOD_MARK_DRAWDOWN",
        "ROUND_TRIPS_39_BELOW_REQUIRED_96",
        "STATIC_PANEL_SURVIVORSHIP_LIMITATION",
        "USDT_USD_PARITY_UNMEASURED",
        "WHITE_P_0_996583",
    ),
    "S-2K": (
        "ACCOUNT_EFFECTIVE_FEES_AND_BORROW_COST_ARE_UNKNOWN",
        "BASE_BOOTSTRAP_INTERVAL_ENTIRELY_NEGATIVE",
        "BASE_FIVE_MINUTE_DRAWDOWN_96_10_PERCENT",
        "BASE_STRESS_SEVERE_PUBLIC_PROXY_NET_NEGATIVE",
        "CANDIDATE_ABSENT",
        "EIGHT_OF_ELEVEN_DEVELOPMENT_GATES_FAILED",
        "FIXED_20_SYMBOL_COHORT_DOES_NOT_PROVE_POINT_IN_TIME_FULL_MARKET_OR_REMOVE_SURVIVORSHIP",
        "GROSS_PUBLIC_PROXY_NET_NEGATIVE",
        "HOLDOUT_SEALED_UNOPENED",
        "HOLM_AND_WHITE_0_999268",
        "ONE_INTERNAL_HOLDOUT_IS_NOT_A_FRESH_GLOBAL_CORPUS",
        "PUBLIC_5M_QUOTE_VOLUME_IS_NOT_EXECUTABLE_CAPACITY_OR_DEPTH",
        "PUBLIC_CAPACITY_P05_1_14_USD_BELOW_1000",
        "PUBLIC_PROXY_RESULTS_CANNOT_AUTHORIZE_CAPITAL_OR_EXECUTION",
        "SPREAD_DEPTH_QUEUE_LATENCY_IMPACT_FILTERS_COLLATERAL_AND_LIQUIDATION_ARE_UNMEASURED",
        "SYNTHETIC_SHORT_LEGS_REQUIRE_BORROW_OR_MARGIN_INVENTORY_NOT_PROVED_BY_SPOT_ARCHIVES",
        "USDT_EQUALS_USD_IS_A_RESEARCH_NORMALIZATION_NOT_REDEMPTION_TRUTH",
    ),
    "S-2I": (
        "ACCOUNT_EFFECTIVE_AND_HISTORICAL_COMMISSION_UNKNOWN",
        "BASE_STRESS_SEVERE_PUBLIC_PROXY_NET_NEGATIVE",
        "EXECUTABLE_CAPACITY_UNMEASURED",
        "FIXED_LONG_LIVED_UNIVERSE_HAS_SURVIVORSHIP_BIAS",
        "HISTORICAL_CROSS_ENGINE_CLOCK_OFFSET_UNKNOWN",
        "HOLDOUT_SEALED_UNOPENED_DEVELOPMENT_GATES_FAILED",
        "HOLM_ABSOLUTE_1_MATCHED_EXCESS_0_8338",
        "HOUR_BARS_CANNOT_IDENTIFY_SUB_HOUR_CAUSALITY",
        "MATCHED_EXCESS_INTERVAL_POSITIVE_NOT_CREDIBLE_AFTER_MULTIPLICITY",
        "MAXIMUM_MARKED_GROSS_1020_156266_EXCEEDS_1000_GATE",
        "NO_HISTORICAL_SYNCHRONIZED_ORDER_BOOK_SPREAD_QUEUE_OR_IMPACT",
        "PBO_ZERO_DIAGNOSTIC_ONLY",
        "PROGRAM_WIDE_ALIAS_ATTEMPT_LEDGER_INCOMPLETE_EFFECTIVE_P_ONE",
        "PUBLIC_PROXY_CANNOT_AUTHORIZE_CAPITAL_OR_EXECUTION",
        "PUBLIC_QUOTE_VOLUME_CAPACITY_PROXY_13666_55_NOT_EXECUTABLE_CAPACITY",
        "RAW_ARCHIVE_BODIES_EXTERNAL_TO_GIT",
        "REMOVE_BEST_MONTH_STRESS_NEGATIVE",
        "RESULT_EMBEDDED_GIT_IS_STATIC_PRE_ACCEPTANCE_PROVENANCE",
        "RPI_BEGAN_DURING_SAMPLE_2025_11_18_PRE_RPI_COMPARABILITY_NOT_ESTABLISHED",
        "RUN_CONSUMED_ONE_OF_ONE_NO_RERUN",
        "SEVERE_DRAWDOWN_3677_866136_EXCEEDS_100_GATE",
        "STRESS_90PCT_INTERVAL_ENTIRELY_NEGATIVE",
        "USDT_PER_1000_NOT_FIAT_USD_CONVERSION",
        "WHITE_REALITY_CHECK_0_2951",
        "ZERO_NET_NOTIONAL_NOT_PROVEN_BETA_OR_FACTOR_NEUTRALITY",
    ),
}

LEDGER_ROW_IDS = (
    "2026-07-30 ORCHESTRATOR S-2B DISTINCTNESS STOP",
    "2026-07-30 ORCHESTRATOR CUTOVER ISSUER STOP ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR S-1W REJECTION",
    "2026-07-30 ORCHESTRATOR S-2D DISTINCTNESS STOP",
    "2026-07-30 ORCHESTRATOR V-G12 REJECTION",
    "2026-07-30 ORCHESTRATOR V-G28 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR V-G32 REJECTION",
    "2026-07-30 ORCHESTRATOR DQ-2 SOURCE STOP",
    "2026-07-30 ORCHESTRATOR S-2F DISTINCTNESS STOP",
    "2026-07-30 ORCHESTRATOR S-2J DISTINCTNESS STOP",
    "2026-07-30 ORCHESTRATOR V-G35 REJECTION",
    "2026-07-30 ORCHESTRATOR V-G37 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR S-2E DISTINCTNESS STOP",
    "2026-07-30 ORCHESTRATOR S-2L DISTINCTNESS STOP",
    BASELINE_RECORD_ID,
    "2026-07-30 ORCHESTRATOR DQ-1 ACCEPTANCE + REFILL",
    "2026-07-30 ORCHESTRATOR S-1Y ACCEPTANCE + REFILL",
    "2026-07-30 ORCHESTRATOR DQ-3 ACCEPTANCE + REFILL",
    "2026-07-30 ORCHESTRATOR V-G38 REJECTION + REFILL",
    "2026-07-30 ORCHESTRATOR M-A CUTOVER BLOCKER ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR S-2M ACCEPTANCE + RETIREMENT",
    "2026-07-30 ORCHESTRATOR S-2C ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR S-1Z ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR V-G36 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR V-G1 REJECTION",
    "2026-07-30 ORCHESTRATOR S-1V REJECTION",
    "2026-07-30 ORCHESTRATOR DQ-6 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR S-2G ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR DQ-8 ACCEPTANCE + PRODUCT REFILL",
    "2026-07-30 ORCHESTRATOR S-2H ACCEPTANCE + DQ-11 DURABILITY RESUME",
    "2026-07-30 ORCHESTRATOR DQ-11 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR DQ-9 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR V-G27 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR S-2A ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR DQ-4 ACCEPTANCE",
    "2026-07-30 ORCHESTRATOR S-2K ACCEPTANCE",
    ECONOMIC_THROUGH_RECORD_ID,
    "2026-07-30 ORCHESTRATOR DQ-14 DURABILITY REJECTION + SAME-TASK RESUME",
    LEDGER_AS_OF_RECORD_ID,
)

LEDGER_CLASSIFICATIONS = {
    "2026-07-30 ORCHESTRATOR S-2B DISTINCTNESS STOP": (
        "MATERIAL_DISTINCTNESS_STOP",
        False,
        "PROPOSAL_STOP_ONLY",
    ),
    "2026-07-30 ORCHESTRATOR CUTOVER ISSUER STOP ACCEPTANCE": (
        "OUT_OF_SCOPE_ACCEPTED_SAFE_STOP",
        False,
        "OUT_OF_SCOPE",
    ),
    "2026-07-30 ORCHESTRATOR S-1W REJECTION": (
        "REJECTED_NONCONSUMABLE",
        False,
        "REJECTED_ATTEMPT_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR S-2D DISTINCTNESS STOP": (
        "MATERIAL_DISTINCTNESS_STOP",
        False,
        "PROPOSAL_STOP_ONLY",
    ),
    "2026-07-30 ORCHESTRATOR V-G12 REJECTION": (
        "REJECTED_NONCONSUMABLE",
        False,
        "REJECTED_ATTEMPT_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR V-G28 ACCEPTANCE": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR S-2F DISTINCTNESS STOP": (
        "MATERIAL_DISTINCTNESS_STOP",
        False,
        "PROPOSAL_STOP_ONLY",
    ),
    "2026-07-30 ORCHESTRATOR V-G32 REJECTION": (
        "REJECTED_NONCONSUMABLE",
        False,
        "REJECTED_ATTEMPT_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR DQ-2 SOURCE STOP": (
        "ACCEPTED_SOURCE_LIMITATION",
        False,
        "NONE",
    ),
    "2026-07-30 ORCHESTRATOR S-2J DISTINCTNESS STOP": (
        "MATERIAL_DISTINCTNESS_STOP",
        False,
        "PROPOSAL_STOP_ONLY",
    ),
    "2026-07-30 ORCHESTRATOR V-G35 REJECTION": (
        "REJECTED_NONCONSUMABLE",
        False,
        "REJECTED_ATTEMPT_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR V-G37 ACCEPTANCE": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR S-2E DISTINCTNESS STOP": (
        "MATERIAL_DISTINCTNESS_STOP",
        False,
        "PROPOSAL_STOP_ONLY",
    ),
    "2026-07-30 ORCHESTRATOR S-2L DISTINCTNESS STOP": (
        "MATERIAL_DISTINCTNESS_STOP",
        False,
        "PROPOSAL_STOP_ONLY",
    ),
    BASELINE_RECORD_ID: ("ACCEPTED_BASELINE_SOURCE_ONLY", False, "BASELINE_BOUND"),
    "2026-07-30 ORCHESTRATOR DQ-1 ACCEPTANCE + REFILL": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
    ),
    "2026-07-30 ORCHESTRATOR S-1Y ACCEPTANCE + REFILL": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR DQ-3 ACCEPTANCE + REFILL": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
    ),
    "2026-07-30 ORCHESTRATOR V-G38 REJECTION + REFILL": (
        "REJECTED_NONCONSUMABLE",
        False,
        "REJECTED_ATTEMPT_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR M-A CUTOVER BLOCKER ACCEPTANCE": (
        "OUT_OF_SCOPE_ACCEPTED_BLOCKED_STATE",
        False,
        "OUT_OF_SCOPE",
    ),
    "2026-07-30 ORCHESTRATOR S-2M ACCEPTANCE + RETIREMENT": (
        "MATERIAL_DISTINCTNESS_STOP",
        False,
        "PROPOSAL_STOP_ONLY",
    ),
    "2026-07-30 ORCHESTRATOR S-2C ACCEPTANCE": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR S-1Z ACCEPTANCE": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR V-G36 ACCEPTANCE": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR V-G1 REJECTION": (
        "REJECTED_NONCONSUMABLE",
        False,
        "REJECTED_ATTEMPT_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR S-1V REJECTION": (
        "REJECTED_NONCONSUMABLE",
        False,
        "REJECTED_ATTEMPT_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR DQ-6 ACCEPTANCE": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
    ),
    "2026-07-30 ORCHESTRATOR S-2G ACCEPTANCE": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR DQ-8 ACCEPTANCE + PRODUCT REFILL": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
    ),
    "2026-07-30 ORCHESTRATOR S-2H ACCEPTANCE + DQ-11 DURABILITY RESUME": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR DQ-11 ACCEPTANCE": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
    ),
    "2026-07-30 ORCHESTRATOR DQ-9 ACCEPTANCE": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
    ),
    "2026-07-30 ORCHESTRATOR V-G27 ACCEPTANCE": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR S-2A ACCEPTANCE": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR DQ-4 ACCEPTANCE": (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
    ),
    "2026-07-30 ORCHESTRATOR S-2K ACCEPTANCE": (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    ECONOMIC_THROUGH_RECORD_ID: (
        "ACCEPTED_ECONOMIC_ORIGIN",
        True,
        "ACCEPTED_ORIGIN_P_ONE",
    ),
    "2026-07-30 ORCHESTRATOR DQ-14 DURABILITY REJECTION + SAME-TASK RESUME": (
        "REJECTED_SOURCE_DURABILITY",
        False,
        "NONE",
    ),
    LEDGER_AS_OF_RECORD_ID: (
        "ACCEPTED_SOURCE_ONLY",
        False,
        "NONE",
    ),
}

LEDGER_ROW_SHA256 = {
    "2026-07-30 ORCHESTRATOR S-2B DISTINCTNESS STOP": (
        "6ffbfb65775b6c94b9f236a86d63c3290ac3a62426e7da6898a4ea587e19c62b"
    ),
    "2026-07-30 ORCHESTRATOR CUTOVER ISSUER STOP ACCEPTANCE": (
        "df9a34cd70773f82d88f3b8b566960d231da8c83d74ad05c15f4effc1c324233"
    ),
    "2026-07-30 ORCHESTRATOR S-1W REJECTION": (
        "74bd5399248e0f4ee4976470bc120f8bc30c41f016c37b955577bfcf764ad372"
    ),
    "2026-07-30 ORCHESTRATOR S-2D DISTINCTNESS STOP": (
        "7519d4cd0f19e8a6c0dca7a3452c4735af1ea0c2dd9501190b25e7f8c31e5898"
    ),
    "2026-07-30 ORCHESTRATOR V-G12 REJECTION": (
        "7e15a7f5e2a93ac87a71cc0dc091eccae83dcae253177eb754aed175fb44744d"
    ),
    "2026-07-30 ORCHESTRATOR V-G28 ACCEPTANCE": (
        "1c4c1b73a215bc0206cab5d0c976fdbb73c242fd3fc30b09e06e6e07a18bde86"
    ),
    "2026-07-30 ORCHESTRATOR S-2F DISTINCTNESS STOP": (
        "a715340cb6c0c062fe08da28938acb49edb3e627258dddbc118a78de10ee101b"
    ),
    "2026-07-30 ORCHESTRATOR V-G32 REJECTION": (
        "da7a2a8a6679aeb01473f6cb3f8a7a9152641716ae30fa29d76197521b61cd58"
    ),
    "2026-07-30 ORCHESTRATOR DQ-2 SOURCE STOP": (
        "507fb31993a860af34e72ae506838a4241eb30f49a45497de9db27dc7609b675"
    ),
    "2026-07-30 ORCHESTRATOR S-2J DISTINCTNESS STOP": (
        "8a65d27e848b573930f1cd8ce2deca9557b359b7bede889c4f313e8e1c281adf"
    ),
    "2026-07-30 ORCHESTRATOR V-G35 REJECTION": (
        "e52e138867da1bd098878bb95dd7474cbc8c4134c3ce6b6c460e1a9d7f72dcba"
    ),
    "2026-07-30 ORCHESTRATOR V-G37 ACCEPTANCE": (
        "40b0ec75efb4990c5cc0b7b5453ea2dd6bf657a56184c2ef2fca26a7f1bb0330"
    ),
    "2026-07-30 ORCHESTRATOR S-2E DISTINCTNESS STOP": (
        "e7f5371bb8b5d180cf6550130681a2cd351fec9cc9a870f9f47dc2d180ab3662"
    ),
    "2026-07-30 ORCHESTRATOR S-2L DISTINCTNESS STOP": (
        "abf42270a24f4801e0e52c2d58df08ddc7fa795e1eb2c39bb79babe0e9f26f4c"
    ),
    BASELINE_RECORD_ID: BASELINE_ROW_SHA256,
    "2026-07-30 ORCHESTRATOR DQ-1 ACCEPTANCE + REFILL": (
        "02a45154afb6e5592b124919ee2aa46e3d44e2bb118438a5599dee57d77ca7d9"
    ),
    "2026-07-30 ORCHESTRATOR S-1Y ACCEPTANCE + REFILL": (
        "f151ddf9327a033064fca505648082d65a5cd7b267f81907f457898e056e84a5"
    ),
    "2026-07-30 ORCHESTRATOR DQ-3 ACCEPTANCE + REFILL": (
        "a4a59c2a0f516ba385ce6a11ce095ec7af88e2abd15d35740f3c42c5ce12f011"
    ),
    "2026-07-30 ORCHESTRATOR V-G38 REJECTION + REFILL": (
        "fbe234950e66c5e49ee9f6f4b611cafdc0bb892b48059e1b814bda9c18c9317b"
    ),
    "2026-07-30 ORCHESTRATOR M-A CUTOVER BLOCKER ACCEPTANCE": (
        "b45345cb8a2ac17a33625ec43f917fc7412ecf51a10b726f002d1c8bae8f1d0c"
    ),
    "2026-07-30 ORCHESTRATOR S-2M ACCEPTANCE + RETIREMENT": (
        "8e4f9c3babbaca90b421b8409e80d19721f46744e5d8d3c3b4467cb55463850f"
    ),
    "2026-07-30 ORCHESTRATOR S-2C ACCEPTANCE": (
        "43bad734804c8c053856579e0f105d23774445dade6b07085b375d5f2b45a25e"
    ),
    "2026-07-30 ORCHESTRATOR S-1Z ACCEPTANCE": (
        "ae9595aab10813437c81332b13f716c33f2207e226957c78b44f06242a860c6a"
    ),
    "2026-07-30 ORCHESTRATOR V-G36 ACCEPTANCE": (
        "2852691f5676ccebd1cca714cf668f0680d76f8d097eedb0b688ee381472fcb1"
    ),
    "2026-07-30 ORCHESTRATOR V-G1 REJECTION": (
        "28ca0b5d25c038698e99ed5af861d41868c97738568721fc4638ae28e36203a6"
    ),
    "2026-07-30 ORCHESTRATOR S-1V REJECTION": (
        "c07a1d0207a1e7c84f50470b175fc3932d96c4e56ac11239fca3e24f29c8bccb"
    ),
    "2026-07-30 ORCHESTRATOR DQ-6 ACCEPTANCE": (
        "02849bae38ade724d29b5eb8e0626dac65937475cddfb9598a76f92f8a52b6f8"
    ),
    "2026-07-30 ORCHESTRATOR S-2G ACCEPTANCE": (
        "7c6e50593f9bfc5d3f26d12074a038a9e37cea34fd7cbc596431f36497d87e55"
    ),
    "2026-07-30 ORCHESTRATOR DQ-8 ACCEPTANCE + PRODUCT REFILL": (
        "6a2b77937e3335c446e011cab746ad6f891a90137c7482c23f9aebd4e7eabbd6"
    ),
    "2026-07-30 ORCHESTRATOR S-2H ACCEPTANCE + DQ-11 DURABILITY RESUME": (
        "bba59063cc66b62b8c4b08e5b4f2be2513fd168f8da9a20d6047696afd64e418"
    ),
    "2026-07-30 ORCHESTRATOR DQ-11 ACCEPTANCE": (
        "e7829130c995101d2fb170fc5f32b2d516adf0fd3431834a132369c5fc4a7cfe"
    ),
    "2026-07-30 ORCHESTRATOR DQ-9 ACCEPTANCE": (
        "dadb050b5da0ae6ced2edc3ce16267a6bd542dc92002783b5e6567c37911aaca"
    ),
    "2026-07-30 ORCHESTRATOR V-G27 ACCEPTANCE": (
        "e90901f925adbd3e968915df2d38ec7a0f533caef01ec2a7adf006080fc87e42"
    ),
    "2026-07-30 ORCHESTRATOR S-2A ACCEPTANCE": (
        "cd3ea18b204a24f581408dd4fbf7d098925130b198fc52b605c3e2a0282b5a65"
    ),
    "2026-07-30 ORCHESTRATOR DQ-4 ACCEPTANCE": (
        "2be00f4b8949e7ea856a6966374e60067ecb2de589b79872baae4ca4824cd776"
    ),
    "2026-07-30 ORCHESTRATOR S-2K ACCEPTANCE": (
        "7584e05cfffbc4f5533bc05fda42f0b04ee0c9e85c7f4e4345653937d368aff8"
    ),
    ECONOMIC_THROUGH_RECORD_ID: ECONOMIC_THROUGH_ROW_SHA256,
    "2026-07-30 ORCHESTRATOR DQ-14 DURABILITY REJECTION + SAME-TASK RESUME": (
        "d315571546270e2f44f1417b8e6a3152882b052dfe726debb76455ee7c76fa4a"
    ),
    LEDGER_AS_OF_RECORD_ID: LEDGER_AS_OF_ROW_SHA256,
}

REQUIRED_LEDGER_LIMITATIONS = {
    "2026-07-30 ORCHESTRATOR S-2B DISTINCTNESS STOP": (
        "MATERIAL_DUPLICATE_S_1B",
        "V_G5_SIGNAL_COLLISION",
        "NO_PRODUCT_BYTES",
    ),
    "2026-07-30 ORCHESTRATOR CUTOVER ISSUER STOP ACCEPTANCE": (
        "NON_PROFITABILITY_SCOPE",
        "NO_MONEY_EFFECT",
    ),
    "2026-07-30 ORCHESTRATOR S-1W REJECTION": (
        "PROTOCOL_EVALUATOR_VERIFIER_REUSE_FORBIDDEN",
        "TERMINAL_UNMEASURED_EVIDENCE_RETAINED",
        "NO_REPAIR_OR_RERUN",
    ),
    "2026-07-30 ORCHESTRATOR S-2D DISTINCTNESS STOP": (
        "MATERIAL_DUPLICATE_S_1G_S_1J",
        "NO_PRODUCT_BYTES",
    ),
    "2026-07-30 ORCHESTRATOR V-G12 REJECTION": (
        "ORIGIN_PROOF_NOT_DURABLE",
        "NOT_CONSUMABLE_BY_N3",
        "NO_RERUN",
    ),
    "2026-07-30 ORCHESTRATOR V-G28 ACCEPTANCE": REQUIRED_ORIGIN_LIMITATIONS["V-G28"],
    "2026-07-30 ORCHESTRATOR S-2F DISTINCTNESS STOP": (
        "MATERIAL_DUPLICATE_S_1B",
        "V_G5_SIGNAL_COLLISION",
        "NO_PRODUCT_BYTES",
    ),
    "2026-07-30 ORCHESTRATOR V-G32 REJECTION": (
        "CAUSALITY_INVALID_FUTURE_MALFORMED_ROWS",
        "VG31_SNAPSHOT_NOT_INDEPENDENTLY_RECONSTRUCTIBLE",
        "NOT_CONSUMABLE_BY_N3",
        "EVALUATOR_REUSE_FORBIDDEN",
    ),
    "2026-07-30 ORCHESTRATOR DQ-2 SOURCE STOP": (
        "OFFICIAL_HISTORICAL_STATUS_SOURCE_NOT_FOUND",
        "HISTORICAL_BACKFILL_FORBIDDEN",
        "NO_PRODUCT_BYTES",
    ),
    "2026-07-30 ORCHESTRATOR S-2J DISTINCTNESS STOP": (
        "MATERIAL_DUPLICATE_S_1Y",
        "NO_PRODUCT_BYTES",
    ),
    "2026-07-30 ORCHESTRATOR V-G35 REJECTION": (
        "DRAWDOWN_DATE_LABEL_MISALIGNMENT",
        "EVALUATOR_REUSE_FORBIDDEN",
        "NO_REPAIR_OR_RERUN",
    ),
    "2026-07-30 ORCHESTRATOR V-G37 ACCEPTANCE": REQUIRED_ORIGIN_LIMITATIONS["V-G37"],
    "2026-07-30 ORCHESTRATOR S-2E DISTINCTNESS STOP": (
        "MATERIAL_DUPLICATE_V_G2_V_G3_V_G4_V_G26",
        "NO_PRODUCT_BYTES",
    ),
    "2026-07-30 ORCHESTRATOR S-2L DISTINCTNESS STOP": (
        "MATERIAL_DUPLICATE_V_G17",
        "NO_PRODUCT_BYTES",
    ),
    BASELINE_RECORD_ID: ("SOURCE_ONLY", "NOT_LANDED"),
    "2026-07-30 ORCHESTRATOR DQ-1 ACCEPTANCE + REFILL": (
        "DUPLICATE_TRUNCATION_CAUSE_UNKNOWN",
        "LIFECYCLE_INVENTORY_COVERAGE_UNASSESSED",
        "WITH_EXCLUSIONS_NON_GREEN",
    ),
    "2026-07-30 ORCHESTRATOR S-1Y ACCEPTANCE + REFILL": REQUIRED_ORIGIN_LIMITATIONS["S-1Y"],
    "2026-07-30 ORCHESTRATOR DQ-3 ACCEPTANCE + REFILL": (
        "FUTURE_ONLY_NON_RETROACTIVE",
        "NOT_REGISTRY_COMPLETENESS",
        "NOT_ECONOMICS_OR_AUTHORITY",
    ),
    "2026-07-30 ORCHESTRATOR V-G38 REJECTION + REFILL": (
        "TERMINAL_SOURCE_STATE_FALSE",
        "EVALUATOR_VERIFIER_REUSE_FORBIDDEN",
        "N3_ECONOMIC_CONSUMPTION_FORBIDDEN",
        "NO_REPAIR_OR_RERUN",
    ),
    "2026-07-30 ORCHESTRATOR M-A CUTOVER BLOCKER ACCEPTANCE": (
        "NON_PROFITABILITY_SCOPE",
        "ACCEPTED_BLOCKED_STATE",
        "NO_HOST_OR_MONEY_EFFECT",
    ),
    "2026-07-30 ORCHESTRATOR S-2M ACCEPTANCE + RETIREMENT": (
        "MATERIAL_DUPLICATE_V_G6",
        "NO_PRODUCT_BYTES",
        "HOLDOUT_NOT_CREATED",
        "RETIRED",
    ),
    "2026-07-30 ORCHESTRATOR S-2C ACCEPTANCE": REQUIRED_ORIGIN_LIMITATIONS["S-2C"],
    "2026-07-30 ORCHESTRATOR S-1Z ACCEPTANCE": REQUIRED_ORIGIN_LIMITATIONS["S-1Z"],
    "2026-07-30 ORCHESTRATOR V-G36 ACCEPTANCE": REQUIRED_ORIGIN_LIMITATIONS["V-G36"],
    "2026-07-30 ORCHESTRATOR V-G1 REJECTION": (
        "LOCAL_UNVERIFIED_NO_REMOTE_REF",
        "VERIFIER_EVIDENCE_CONTRACT_FAILURE",
        "INTERVALS_CROSS_ZERO",
        "NO_CHAMPION",
        "N3_ECONOMICS_FORBIDDEN",
        "NO_RERUN",
    ),
    "2026-07-30 ORCHESTRATOR S-1V REJECTION": (
        "FROZEN_VERIFIER_SCHEMA_MISMATCH",
        "OPERATIONAL_UNMEASURED_NO_GO",
        "NO_PACKET_REPAIR_OR_ECONOMIC_RERUN",
        "HOLDOUT_UNOPENED",
        "FROZEN_VERIFIER_REUSE_FORBIDDEN",
        "N3_STATE_ONLY",
    ),
    "2026-07-30 ORCHESTRATOR DQ-6 ACCEPTANCE": (
        "SOURCE_ONLY_ECONOMICS_TRUTH_VALIDATOR",
        "SYNTHETIC_FIXTURES_NOT_PROFITABILITY_EVIDENCE",
        "ACCOUNT_EFFECTIVE_FEE_AND_NET_REMAIN_UNKNOWN",
        "EXECUTABLE_CAPACITY_REMAINS_UNMEASURED",
        "USDT_TO_USD_CONVERSION_REMAINS_UNKNOWN",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
    ),
    "2026-07-30 ORCHESTRATOR S-2G ACCEPTANCE": REQUIRED_ORIGIN_LIMITATIONS["S-2G"],
    "2026-07-30 ORCHESTRATOR DQ-8 ACCEPTANCE + PRODUCT REFILL": (
        "SOURCE_ONLY_NAV_DRAWDOWN_COORDINATE_VALIDATOR",
        "SYNTHETIC_KNOWN_ANSWER_NOT_PROFITABILITY_EVIDENCE",
        "SOURCE_AUTHENTICITY_AND_CAPTURE_TIMING_REMAIN_CONSUMER_GATES",
        "ACCOUNT_COMPLETE_COSTS_REMAIN_CONSUMER_GATE",
        "NO_RETROACTIVE_PACKET_VALIDATION_OR_REPAIR",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
    ),
    "2026-07-30 ORCHESTRATOR S-2H ACCEPTANCE + DQ-11 DURABILITY RESUME": (
        REQUIRED_ORIGIN_LIMITATIONS["S-2H"]
    ),
    "2026-07-30 ORCHESTRATOR DQ-11 ACCEPTANCE": (
        "SOURCE_ONLY_SAMPLE_ADMISSION_DENOMINATOR_VALIDATOR",
        "SYNTHETIC_KNOWN_ANSWER_COUNTS_NOT_ECONOMIC_EVIDENCE",
        "GIT_PIN_NOT_SIGNATURE_OR_DEPLOYMENT_AUTHORITY",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
    ),
    "2026-07-30 ORCHESTRATOR DQ-9 ACCEPTANCE": (
        "SOURCE_ONLY_SEALED_LIFECYCLE_VALIDATOR",
        "SYNTHETIC_KNOWN_ANSWER_NO_GO_NOT_ECONOMIC_EVIDENCE",
        "CANNOT_PROVE_UNDISCLOSED_PARALLEL_RUNS_OR_MARKER_TIMING",
        "NO_EXPERIMENT_OR_HOLDOUT_OPENED",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
    ),
    "2026-07-30 ORCHESTRATOR V-G27 ACCEPTANCE": REQUIRED_ORIGIN_LIMITATIONS["V-G27"],
    "2026-07-30 ORCHESTRATOR S-2A ACCEPTANCE": REQUIRED_ORIGIN_LIMITATIONS["S-2A"],
    "2026-07-30 ORCHESTRATOR DQ-4 ACCEPTANCE": (
        "SOURCE_ONLY_ORIGIN_PROOF_VALIDATOR",
        "SUPPLIED_OFFLINE_GIT_CONSISTENCY_ONLY",
        "NO_REMOTE_FRESHNESS_AUTHORSHIP_SIGNING_OR_CHRONOLOGY_PROOF",
        "NO_DATA_CUSTODY_ECONOMIC_OR_HOLDOUT_VALIDATION",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
    ),
    "2026-07-30 ORCHESTRATOR S-2K ACCEPTANCE": REQUIRED_ORIGIN_LIMITATIONS["S-2K"],
    ECONOMIC_THROUGH_RECORD_ID: REQUIRED_ORIGIN_LIMITATIONS["S-2I"],
    "2026-07-30 ORCHESTRATOR DQ-14 DURABILITY REJECTION + SAME-TASK RESUME": (
        "SOURCE_ONLY_DURABILITY_REJECTION",
        "BRANCH_LOCAL_ONLY_NO_UPSTREAM_AT_REJECTION",
        "SAME_TASK_RESUMED_FOR_PUSH_AND_UPSTREAM_PROOF_ONLY",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
        "AUTHORITY_NONE",
    ),
    LEDGER_AS_OF_RECORD_ID: (
        "SOURCE_ONLY_SOURCE_ACCESS_REPLAY_VALIDATOR",
        "SUPPLIED_LEDGER_CONSISTENCY_ONLY",
        "INDEPENDENT_AUTHENTICATED_TERMINAL_TIP_AND_COUNT_REQUIRED",
        "FACADE_BYPASS_NOT_DETECTABLE",
        "INVENTORY_ROLES_AND_CONTENT_NOT_INDEPENDENTLY_PROVEN",
        "UNOPENED_MEANS_NO_ELIGIBLE_ATTEMPT_AFTER_PRE_RUN_SEAL_ONLY",
        "LEDGER_AND_VERIFIER_CLAIMS_NOT_AUTHENTICATED_PROVENANCE",
        "NO_RETROACTIVE_PACKET_VALIDATION_OR_ARCHIVE_HOLDOUT_ACCESS",
        "SYNTHETIC_KNOWN_ANSWER_NOT_PROFITABILITY_EVIDENCE",
        "NO_ECONOMIC_ORIGIN_FAMILY_TRIAL_OR_P_VALUE",
        "AUTHORITY_NONE",
    ),
}

SOURCE_ONLY_PINS = (
    (
        "DQ-1",
        "2026-07-30 ORCHESTRATOR DQ-1 ACCEPTANCE + REFILL",
        "ec0c9f436d01f25134c226057981b107dfc97f67",
        "52f854d7fbcde842baa739333b0fc7b3e5fdc921",
        "quant/research/dq1/policy.v1.json",
    ),
    (
        "DQ-3",
        "2026-07-30 ORCHESTRATOR DQ-3 ACCEPTANCE + REFILL",
        "2ed4c74802e436cf446fa983cfe16245383c66a1",
        "55ddad0db43ee4309a42ce532db55cbfa237db96",
        "quant/research/dq3/known_answer.v1.json",
    ),
    (
        "DQ-6",
        "2026-07-30 ORCHESTRATOR DQ-6 ACCEPTANCE",
        "107bda07bf0da35be7844cc4abfe38577391ebae",
        "45919cbe306d8113ae8a0e143e6bc8fb1031c28d",
        "quant/research/dq6/known_answer.v1.json",
    ),
    (
        "DQ-8",
        "2026-07-30 ORCHESTRATOR DQ-8 ACCEPTANCE + PRODUCT REFILL",
        "61501d5ea1605adc1133e2680870b1897b27a099",
        "88fbca8a53c9c5b442acd4aa34e46383cb68bb08",
        "quant/research/dq8/fixtures/known_receipt.v1.json",
    ),
    (
        "DQ-11",
        "2026-07-30 ORCHESTRATOR DQ-11 ACCEPTANCE",
        "8f501fde341699355833555a988c2cdb03a5c075",
        "7c861ca7910c8245042a5d4011ca3c5d89a83b78",
        "quant/research/dq11/known_answer.v1.json",
    ),
    (
        "DQ-9",
        "2026-07-30 ORCHESTRATOR DQ-9 ACCEPTANCE",
        "4d42ffc037e5a20536b72c11d05fa0e68945a819",
        "490234c14059737a8327e969aa695697ce0ae5e1",
        "quant/research/dq9/known_answer.v1.json",
    ),
    (
        "DQ-4",
        "2026-07-30 ORCHESTRATOR DQ-4 ACCEPTANCE",
        "29740b692946557cf6615880fc41d9ded49f69fa",
        "a5922b98e3f15b79de9308269304ee76b88365a1",
        "quant/research/dq4/policy.v1.json",
    ),
    (
        "DQ-14",
        LEDGER_AS_OF_RECORD_ID,
        "0f17eb14279b2bd718fba48ea3da97b4f0f9709e",
        "eecc24ae0f39320b97b601a2da8487173613d3f1",
        "quant/research/dq14/known_answer.v1.json",
    ),
)

PENDING_ACTIVE_WITHIN_BASELINE = (
    ("V-G10", "99f9"),
    ("S-1T", "fea0"),
)
PENDING_ACTIVE_OUTSIDE_BASELINE: tuple[tuple[str, str], ...] = ()
PENDING_TERMINAL: tuple[tuple[str, str], ...] = ()
REQUIRED_TRUTH_CODES = n3s1.REQUIRED_TRUTH_CODES

HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
FULL_IDENTIFIER = re.compile(r"(?<![0-9a-f])[0-9a-f]{40,64}(?![0-9a-f])")
ITEM_RECORD = re.compile(rb"^- item=`([^`]+)`")


def _fail(message: str) -> None:
    raise ContractError(message)


def _require(condition: bool, message: str) -> None:
    if not condition:
        _fail(message)


def _exact_dict(value: Any, label: str) -> dict[str, Any]:
    _require(type(value) is dict, f"{label}: expected exact object")
    return cast(dict[str, Any], value)


def _exact_list(value: Any, label: str) -> list[Any]:
    _require(type(value) is list, f"{label}: expected exact array")
    return cast(list[Any], value)


def _exact_str(value: Any, label: str) -> str:
    _require(type(value) is str, f"{label}: expected exact string")
    return cast(str, value)


def _exact_int(value: Any, label: str) -> int:
    _require(type(value) is int, f"{label}: expected exact integer")
    return cast(int, value)


def _exact_bool(value: Any, label: str) -> bool:
    _require(type(value) is bool, f"{label}: expected exact boolean")
    return cast(bool, value)


def _exact_keys(value: Mapping[str, Any], expected: set[str], label: str) -> None:
    _require(set(value) == expected, f"{label}: keys mismatch")


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return n3s1._canonical_bytes(value)


def load_json(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ContractError(f"{path}: cannot read JSON") from exc
    return _load_json_bytes(raw, str(path))


def _load_json_bytes(raw: bytes, label: str) -> dict[str, Any]:
    def reject_constant(value: str) -> None:
        raise ContractError(f"{label}: non-finite JSON constant {value}")

    try:
        value = json.loads(
            raw,
            object_pairs_hook=n3s1._reject_duplicate_pairs,
            parse_constant=reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError(f"{label}: invalid JSON") from exc
    return _exact_dict(value, label)


@overload
def _git(repo: Path, args: Sequence[str], *, text: Literal[False] = False) -> bytes: ...


@overload
def _git(repo: Path, args: Sequence[str], *, text: Literal[True]) -> str: ...


def _git(repo: Path, args: Sequence[str], *, text: bool = False) -> Any:
    command = ["git", "-C", str(repo), *args]
    try:
        completed = subprocess.run(command, check=True, capture_output=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ContractError(f"git command failed: {' '.join(args)}") from exc
    if text:
        try:
            return completed.stdout.decode("utf-8").strip()
        except UnicodeDecodeError as exc:
            raise ContractError("git text output is not UTF-8") from exc
    return completed.stdout


def _pin_artifact(repo: Path, commit: str, tree: str, path: str) -> dict[str, Any]:
    return n3s1._pin_artifact(repo, commit, tree, path)


def _protocol_path(origin_id: str) -> str:
    slug = origin_id.lower().replace("-", "")
    _require(
        bool(re.fullmatch(r"(?:s[12][a-z]|vg[0-9]{1,2})", slug)),
        "bad protocol slug",
    )
    return f"quant/research/{slug}/protocol.v1.json"


def _result_path(origin_id: str) -> str:
    if origin_id == "S-2H":
        return "quant/research/s2h/screen-terminal.v1.json"
    slug = origin_id.lower().replace("-", "")
    _require(
        bool(re.fullmatch(r"(?:s[12][a-z]|vg[0-9]{1,2})", slug)),
        "bad result slug",
    )
    return f"quant/research/{slug}/result.v1.json"


def _extract_rows(
    run_raw: bytes, record_ids: Sequence[str]
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    lines = run_raw.splitlines(keepends=True)
    receipts: dict[str, dict[str, Any]] = {}
    positions: dict[str, int] = {}
    for record_id in record_ids:
        marker = f"- item=`{record_id}`".encode()
        matches = [(index, line) for index, line in enumerate(lines) if line.startswith(marker)]
        _require(len(matches) == 1, f"{record_id}: expected one exact ledger row")
        index, row = matches[0]
        _require(row.endswith(b"\n"), f"{record_id}: row lacks LF")
        try:
            row_utf8 = row.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ContractError(f"{record_id}: row is not UTF-8") from exc
        receipts[record_id] = {
            "authority": "ORCHESTRATOR_RUN_MD",
            "recordId": record_id,
            "rowByteLength": len(row),
            "rowSha256": _sha256(row),
            "rowUtf8": row_utf8,
        }
        positions[record_id] = index
    return receipts, positions


def _window_orchestrator_ids(run_raw: bytes) -> tuple[str, ...]:
    record_ids = [DELTA_START_RECORD_ID, LEDGER_AS_OF_RECORD_ID]
    _, positions = _extract_rows(run_raw, record_ids)
    start = positions[DELTA_START_RECORD_ID]
    end = positions[LEDGER_AS_OF_RECORD_ID]
    _require(end < start, "ledger boundary does not follow V-G31")
    chronological: list[str] = []
    for line in reversed(run_raw.splitlines(keepends=True)[end:start]):
        match = ITEM_RECORD.match(line)
        if match is None:
            continue
        try:
            record_id = match.group(1).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ContractError("non-UTF-8 ledger record") from exc
        if " ORCHESTRATOR " in record_id:
            chronological.append(record_id)
    return tuple(chronological)


def _validate_spec(spec: dict[str, Any]) -> None:
    _exact_keys(
        spec,
        {
            "acceptanceLedgerAsOf",
            "baseline",
            "canonicalOrigin",
            "deltaStartExclusive",
            "economicEvidenceThrough",
            "incrementalOrigins",
            "ledgerRows",
            "pendingInputs",
            "schema",
            "sourceOnlyPins",
            "version",
        },
        "spec",
    )
    _require(_exact_str(spec["schema"], "spec.schema") == SPEC_SCHEMA, "spec schema")
    _require(_exact_int(spec["version"], "spec.version") == VERSION, "spec version")

    canonical = _exact_dict(spec["canonicalOrigin"], "spec.canonicalOrigin")
    _exact_keys(canonical, {"commit", "tree"}, "spec.canonicalOrigin")
    _require(
        canonical == {"commit": CANONICAL_COMMIT, "tree": CANONICAL_TREE},
        "canonical origin drift",
    )

    baseline = _exact_dict(spec["baseline"], "spec.baseline")
    expected_baseline = {
        "cardPath": BASELINE_CARD_PATH,
        "cardRawSha256": BASELINE_CARD_SHA256,
        "originSpecPath": BASELINE_SPEC_PATH,
        "originSpecRawSha256": BASELINE_SPEC_SHA256,
        "producerCommit": BASELINE_COMMIT,
        "producerParent": BASELINE_PARENT,
        "producerTree": BASELINE_TREE,
        "recordId": BASELINE_RECORD_ID,
        "registryPath": BASELINE_REGISTRY_PATH,
        "registryRawSha256": BASELINE_REGISTRY_SHA256,
        "rowSha256": BASELINE_ROW_SHA256,
    }
    _exact_keys(baseline, set(expected_baseline), "spec.baseline")
    _require(baseline == expected_baseline, "baseline spec drift")

    boundary_contracts = (
        (
            "deltaStartExclusive",
            DELTA_START_RECORD_ID,
            DELTA_START_ROW_SHA256,
        ),
        (
            "economicEvidenceThrough",
            ECONOMIC_THROUGH_RECORD_ID,
            ECONOMIC_THROUGH_ROW_SHA256,
        ),
        (
            "acceptanceLedgerAsOf",
            LEDGER_AS_OF_RECORD_ID,
            LEDGER_AS_OF_ROW_SHA256,
        ),
    )
    for field, record_id, row_hash in boundary_contracts:
        boundary = _exact_dict(spec[field], f"spec.{field}")
        _exact_keys(boundary, {"recordId", "rowSha256"}, f"spec.{field}")
        _require(
            boundary == {"recordId": record_id, "rowSha256": row_hash},
            f"{field} drift",
        )

    origins = _exact_list(spec["incrementalOrigins"], "spec.incrementalOrigins")
    _require(len(origins) == len(INCREMENTAL_ORIGIN_IDS), "incremental origin count")
    seen_ids: list[str] = []
    for index, value in enumerate(origins, start=1):
        origin = _exact_dict(value, f"spec.incrementalOrigins[{index}]")
        _exact_keys(
            origin,
            {
                "custodyState",
                "limitations",
                "normalizedVerdict",
                "originId",
                "path",
                "producerCommit",
                "producerTree",
                "recordId",
                "rowSha256",
                "sourceVerdict",
            },
            f"spec.incrementalOrigins[{index}]",
        )
        origin_id = _exact_str(origin["originId"], "incremental origin ID")
        seen_ids.append(origin_id)
        expected_custody = (
            "ACCEPTED_TREE_EXACT_COMMIT_FRAGMENT_NON_SUFFIX"
            if origin_id == "S-1Z"
            else "ACCEPTED_EXACT"
        )
        _require(origin["custodyState"] == expected_custody, f"{origin_id}: custody")
        _require(
            origin["normalizedVerdict"] in {"NO_GO", "UNMEASURED"},
            f"{origin_id}: verdict",
        )
        _require(bool(HEX40.fullmatch(_exact_str(origin["producerCommit"], "commit"))), "commit")
        _require(bool(HEX40.fullmatch(_exact_str(origin["producerTree"], "tree"))), "tree")
        _require(
            bool(HEX64.fullmatch(_exact_str(origin["rowSha256"], "row hash"))),
            "row hash",
        )
        _require(origin["path"] == _result_path(origin_id), f"{origin_id}: result path")
        _exact_str(origin["recordId"], "record ID")
        _exact_str(origin["sourceVerdict"], "source verdict")
        limitations = tuple(
            _exact_str(item, f"{origin_id}.limitation")
            for item in _exact_list(origin["limitations"], f"{origin_id}.limitations")
        )
        _require(
            limitations == REQUIRED_ORIGIN_LIMITATIONS[origin_id],
            f"{origin_id}: limitation drift",
        )
        _require(origin["rowSha256"] == LEDGER_ROW_SHA256[origin["recordId"]], "row drift")
    _require(tuple(seen_ids) == INCREMENTAL_ORIGIN_IDS, "incremental origin order")

    ledger_rows = _exact_list(spec["ledgerRows"], "spec.ledgerRows")
    ledger_ids: list[str] = []
    for index, value in enumerate(ledger_rows, start=1):
        row = _exact_dict(value, f"spec.ledgerRows[{index}]")
        _exact_keys(
            row,
            {
                "attemptDisposition",
                "classification",
                "economicOriginConsumed",
                "limitations",
                "recordId",
                "rowSha256",
            },
            f"spec.ledgerRows[{index}]",
        )
        record_id = _exact_str(row["recordId"], "ledger record")
        ledger_ids.append(record_id)
        expected_class, expected_consumed, expected_attempt = LEDGER_CLASSIFICATIONS[record_id]
        _require(row["classification"] == expected_class, f"{record_id}: classification")
        _require(
            _exact_bool(row["economicOriginConsumed"], "economic consumed") is expected_consumed,
            f"{record_id}: economic-consumption drift",
        )
        _require(row["attemptDisposition"] == expected_attempt, f"{record_id}: attempt")
        _require(row["rowSha256"] == LEDGER_ROW_SHA256[record_id], f"{record_id}: hash")
        limitations = tuple(
            _exact_str(item, f"{record_id}.limitation")
            for item in _exact_list(row["limitations"], f"{record_id}.limitations")
        )
        _require(
            limitations == REQUIRED_LEDGER_LIMITATIONS[record_id],
            f"{record_id}: limitations",
        )
    _require(tuple(ledger_ids) == LEDGER_ROW_IDS, "ledger row allowlist/order")

    source_pins = _exact_list(spec["sourceOnlyPins"], "spec.sourceOnlyPins")
    expected_source_pins = [
        {
            "bindingId": binding_id,
            "path": path,
            "producerCommit": commit,
            "producerTree": tree,
            "recordId": record_id,
        }
        for binding_id, record_id, commit, tree, path in SOURCE_ONLY_PINS
    ]
    _require(source_pins == expected_source_pins, "source-only pin drift")

    _pending_output(_exact_dict(spec["pendingInputs"], "spec.pendingInputs"))


def _pending_output(spec_pending: dict[str, Any]) -> dict[str, Any]:
    _exact_keys(
        spec_pending,
        {
            "activeOutsideBaselineCutoff",
            "activeWithinBaselineCutoff",
            "requiredTruth",
            "terminalPending",
        },
        "spec.pendingInputs",
    )

    def normalize(
        field: str,
        state: str,
        in_baseline_cutoff: bool,
        expected: tuple[tuple[str, str], ...],
    ) -> list[dict[str, Any]]:
        values = _exact_list(spec_pending[field], f"spec.pendingInputs.{field}")
        normalized: list[dict[str, Any]] = []
        for value in values:
            item = _exact_dict(value, f"pending {field}")
            _exact_keys(item, {"milestoneId", "taskRefSuffix"}, f"pending {field}")
            milestone = _exact_str(item["milestoneId"], "pending milestone")
            suffix = _exact_str(item["taskRefSuffix"], "pending suffix")
            _require(bool(re.fullmatch(r"[0-9a-f]{4}", suffix)), "pending suffix")
            normalized.append(
                {
                    "evidenceState": state,
                    "inBaselineCutoffScope": in_baseline_cutoff,
                    "milestoneId": milestone,
                    "outcomeBytesInspected": False,
                    "taskRefIsEvidence": False,
                    "taskRefSuffix": suffix,
                }
            )
        _require(
            tuple((item["milestoneId"], item["taskRefSuffix"]) for item in normalized) == expected,
            f"{field}: pending allowlist/order",
        )
        return normalized

    required = _exact_list(spec_pending["requiredTruth"], "spec.pendingInputs.requiredTruth")
    required_out = [
        {"code": _exact_str(code, "required truth code"), "state": "PENDING"} for code in required
    ]
    _require(
        tuple(item["code"] for item in required_out) == REQUIRED_TRUTH_CODES,
        "required truth drift",
    )
    return {
        "activeOutsideBaselineCutoff": normalize(
            "activeOutsideBaselineCutoff",
            "ACTIVE_UNPUBLISHED",
            False,
            PENDING_ACTIVE_OUTSIDE_BASELINE,
        ),
        "activeWithinBaselineCutoff": normalize(
            "activeWithinBaselineCutoff",
            "ACTIVE_UNPUBLISHED",
            True,
            PENDING_ACTIVE_WITHIN_BASELINE,
        ),
        "requiredTruth": required_out,
        "terminalPending": normalize(
            "terminalPending",
            "TERMINAL_PENDING_ORCHESTRATOR",
            False,
            PENDING_TERMINAL,
        ),
    }


def _load_baseline(
    repo: Path, run_raw: bytes
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    baseline_pins = {
        "cardArtifact": _pin_artifact(repo, BASELINE_COMMIT, BASELINE_TREE, BASELINE_CARD_PATH),
        "originSpecArtifact": _pin_artifact(
            repo, BASELINE_COMMIT, BASELINE_TREE, BASELINE_SPEC_PATH
        ),
        "registryArtifact": _pin_artifact(
            repo, BASELINE_COMMIT, BASELINE_TREE, BASELINE_REGISTRY_PATH
        ),
    }
    _require(
        baseline_pins["cardArtifact"]["rawSha256"] == BASELINE_CARD_SHA256,
        "baseline card bytes drift",
    )
    _require(
        baseline_pins["originSpecArtifact"]["rawSha256"] == BASELINE_SPEC_SHA256,
        "baseline spec bytes drift",
    )
    _require(
        baseline_pins["registryArtifact"]["rawSha256"] == BASELINE_REGISTRY_SHA256,
        "baseline registry bytes drift",
    )
    registry_raw = _git(repo, ["show", f"{BASELINE_COMMIT}:{BASELINE_REGISTRY_PATH}"])
    spec_raw = _git(repo, ["show", f"{BASELINE_COMMIT}:{BASELINE_SPEC_PATH}"])
    card_raw = _git(repo, ["show", f"{BASELINE_COMMIT}:{BASELINE_CARD_PATH}"])
    _require(type(registry_raw) is bytes, "baseline registry output")
    _require(type(spec_raw) is bytes, "baseline spec output")
    _require(type(card_raw) is bytes, "baseline card output")
    baseline_registry = _load_json_bytes(registry_raw, "baseline registry")
    baseline_spec = _load_json_bytes(spec_raw, "baseline spec")
    n3s1.validate_registry(baseline_registry)
    n3s1.verify_spec_binding(baseline_registry, baseline_spec)
    n3s1.verify_git_pins(baseline_registry, repo)
    n3s1.verify_run_receipts(baseline_registry, run_raw)
    _require(
        n3s1.render_owner_card(baseline_registry).encode("utf-8") == card_raw,
        "baseline card rendering drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline_registry["origins"])) == BASELINE_ORIGINS_SHA256,
        "baseline origin set drift",
    )
    _require(
        _sha256(_canonical_bytes(baseline_registry["families"])) == BASELINE_FAMILIES_SHA256,
        "baseline family set drift",
    )
    return baseline_registry, baseline_pins, baseline_spec


def freeze_registry(spec: dict[str, Any], run_raw: bytes, repo: Path) -> dict[str, Any]:
    _validate_spec(spec)
    baseline_registry, baseline_pins, _ = _load_baseline(repo, run_raw)

    all_row_ids = (DELTA_START_RECORD_ID, *LEDGER_ROW_IDS)
    extracted, positions = _extract_rows(run_raw, all_row_ids)
    _require(
        extracted[DELTA_START_RECORD_ID]["rowSha256"] == DELTA_START_ROW_SHA256,
        "V-G31 delta-start row drift",
    )
    _require(_window_orchestrator_ids(run_raw) == LEDGER_ROW_IDS, "delta ledger window drift")
    for record_id in LEDGER_ROW_IDS:
        _require(
            extracted[record_id]["rowSha256"] == LEDGER_ROW_SHA256[record_id],
            f"{record_id}: live row drift",
        )
    _require(
        positions[LEDGER_AS_OF_RECORD_ID]
        <= positions[ECONOMIC_THROUGH_RECORD_ID]
        < positions[DELTA_START_RECORD_ID],
        "dual-boundary chronology drift",
    )

    spec_origins = _exact_list(spec["incrementalOrigins"], "spec.incrementalOrigins")
    incremental_origins: list[dict[str, Any]] = []
    for offset, value in enumerate(spec_origins, start=1):
        source = _exact_dict(value, f"incremental origin {offset}")
        origin_id = _exact_str(source["originId"], "incremental origin ID")
        commit = _exact_str(source["producerCommit"], f"{origin_id}.commit")
        tree = _exact_str(source["producerTree"], f"{origin_id}.tree")
        result_artifact = _pin_artifact(
            repo,
            commit,
            tree,
            _exact_str(source["path"], f"{origin_id}.path"),
        )
        protocol_artifact = _pin_artifact(repo, commit, tree, _protocol_path(origin_id))
        incremental_origins.append(
            {
                "acceptanceRowSha256": extracted[source["recordId"]]["rowSha256"],
                "artifact": result_artifact,
                "custodyState": _exact_str(source["custodyState"], f"{origin_id}.custody"),
                "familyIdentity": {
                    "key": f"POST_SMETA1::{origin_id}::{protocol_artifact['rawSha256']}",
                    "protocolArtifact": protocol_artifact,
                    "state": "PROVISIONAL_POST_SMETA1",
                },
                "limitations": sorted(source["limitations"]),
                "normalizedVerdict": _exact_str(
                    source["normalizedVerdict"], f"{origin_id}.verdict"
                ),
                "ordinal": 36 + offset,
                "originId": origin_id,
                "producerCommit": commit,
                "producerTree": tree,
                "recordId": _exact_str(source["recordId"], f"{origin_id}.recordId"),
                "sourceVerdict": _exact_str(source["sourceVerdict"], f"{origin_id}.sourceVerdict"),
                "verifiedPositive": False,
            }
        )

    origins = [*copy.deepcopy(baseline_registry["origins"]), *incremental_origins]
    families = n3s1._build_family_rollups(origins)
    _require(len(origins) == EXPECTED_COMBINED_ORIGIN_COUNT, "combined origin count")
    _require(len(families) == EXPECTED_COMBINED_FAMILY_COUNT, "combined family count")

    ledger_specs = _exact_list(spec["ledgerRows"], "spec.ledgerRows")
    ledger_receipts: list[dict[str, Any]] = []
    for value in ledger_specs:
        row_spec = _exact_dict(value, "ledger row")
        record_id = _exact_str(row_spec["recordId"], "ledger record")
        receipt = copy.deepcopy(extracted[record_id])
        receipt.update(
            {
                "attemptDisposition": row_spec["attemptDisposition"],
                "classification": row_spec["classification"],
                "economicOriginConsumed": row_spec["economicOriginConsumed"],
                "limitations": list(row_spec["limitations"]),
            }
        )
        ledger_receipts.append(receipt)

    source_only_pins: list[dict[str, Any]] = []
    for value in _exact_list(spec["sourceOnlyPins"], "spec.sourceOnlyPins"):
        source = _exact_dict(value, "source-only pin")
        artifact = _pin_artifact(
            repo,
            _exact_str(source["producerCommit"], "source commit"),
            _exact_str(source["producerTree"], "source tree"),
            _exact_str(source["path"], "source path"),
        )
        source_only_pins.append(
            {
                "acceptanceRowSha256": extracted[source["recordId"]]["rowSha256"],
                "artifact": artifact,
                "bindingId": _exact_str(source["bindingId"], "source binding ID"),
                "economicContribution": "NONE",
                "recordId": _exact_str(source["recordId"], "source record"),
                "status": "ACCEPTED_SOURCE_ONLY",
            }
        )

    pending = _pending_output(_exact_dict(spec["pendingInputs"], "spec.pendingInputs"))
    active_count = len(pending["activeWithinBaselineCutoff"]) + len(
        pending["activeOutsideBaselineCutoff"]
    )
    terminal_count = len(pending["terminalPending"])
    local_verdict_counts = {
        verdict: sum(origin["normalizedVerdict"] == verdict for origin in origins)
        for verdict in ("NO_GO", "UNMEASURED")
    }
    legacy_excluded = copy.deepcopy(baseline_registry["postCutoffAcceptedExcluded"])
    _require(
        _sha256(_canonical_bytes(legacy_excluded)) == BASELINE_LEGACY_EXCLUSIONS_SHA256,
        "legacy exclusion set drift",
    )
    truth_policy = copy.deepcopy(baseline_registry["truthPolicy"])
    _require(
        _sha256(_canonical_bytes(truth_policy)) == BASELINE_TRUTH_POLICY_SHA256,
        "truth-policy drift",
    )

    registry: dict[str, Any] = {
        "acceptanceLedgerAsOf": {
            "recordId": LEDGER_AS_OF_RECORD_ID,
            "rowSha256": extracted[LEDGER_AS_OF_RECORD_ID]["rowSha256"],
        },
        "baseline": {
            "acceptanceRowSha256": extracted[BASELINE_RECORD_ID]["rowSha256"],
            "cardArtifact": baseline_pins["cardArtifact"],
            "originSpecArtifact": baseline_pins["originSpecArtifact"],
            "producerCommit": BASELINE_COMMIT,
            "producerParent": BASELINE_PARENT,
            "producerTree": BASELINE_TREE,
            "recordId": BASELINE_RECORD_ID,
            "registryArtifact": baseline_pins["registryArtifact"],
        },
        "canonicalOrigin": {"commit": CANONICAL_COMMIT, "tree": CANONICAL_TREE},
        "deltaWindow": {
            "acceptedEconomicOriginIds": list(INCREMENTAL_ORIGIN_IDS),
            "economicEvidenceThrough": {
                "recordId": ECONOMIC_THROUGH_RECORD_ID,
                "rowSha256": extracted[ECONOMIC_THROUGH_RECORD_ID]["rowSha256"],
            },
            "startExclusive": {
                "recordId": DELTA_START_RECORD_ID,
                "rowSha256": extracted[DELTA_START_RECORD_ID]["rowSha256"],
            },
        },
        "families": families,
        "ledgerReceipts": ledger_receipts,
        "legacyAcceptedExcluded": legacy_excluded,
        "originSpecCanonicalSha256": _sha256(_canonical_bytes(spec)),
        "origins": origins,
        "ownerCardRawSha256": "",
        "pendingInputs": pending,
        "schema": SCHEMA,
        "sourceOnlyPins": source_only_pins,
        "summary": {
            "acceptedCrediblePositiveCount": 0,
            "acceptedFamilyCount": len(families),
            "acceptedOriginCount": len(origins),
            "activeProfitabilityTaskCount": active_count,
            "capitalAuthority": "NONE",
            "completeFamilyUniverse": False,
            "crediblePositiveCount": None,
            "currentProfitabilityVerdict": "UNKNOWN",
            "familyDeduplicationState": "EXACT_FOR_ACCEPTED_ORIGINS_ONLY",
            "legacyAcceptedExcludedCount": len(legacy_excluded),
            "localVerdictCounts": local_verdict_counts,
            "moneyUsd": 0,
            "owner1000FundingVerdict": "NO",
            "positiveEdgeClaim": "NOT_MADE",
            "postVG31AcceptedEconomicConsumedCount": len(INCREMENTAL_ORIGIN_IDS),
            "recommendation": "NONE",
            "rejectedAttemptP1DispositionCount": sum(
                row["attemptDisposition"] == "REJECTED_ATTEMPT_P_ONE" for row in ledger_receipts
            ),
            "requiredTruthCount": len(pending["requiredTruth"]),
            "terminalPendingCount": terminal_count,
            "verifiedPositiveCount": 0,
        },
        "truthPolicy": truth_policy,
        "version": VERSION,
    }
    card = render_owner_card(registry)
    registry["ownerCardRawSha256"] = _sha256(card.encode("utf-8"))
    validate_registry(registry)
    return registry


def render_owner_card(registry: Mapping[str, Any]) -> str:
    summary = _exact_dict(registry["summary"], "registry.summary")
    delta = _exact_dict(registry["deltaWindow"], "registry.deltaWindow")
    economic = _exact_dict(delta["economicEvidenceThrough"], "economic boundary")
    ledger = _exact_dict(registry["acceptanceLedgerAsOf"], "ledger boundary")
    pending = _exact_dict(registry["pendingInputs"], "registry.pendingInputs")
    active_ids = [
        item["milestoneId"]
        for field in ("activeWithinBaselineCutoff", "activeOutsideBaselineCutoff")
        for item in _exact_list(pending[field], f"pending.{field}")
    ]
    terminal_ids = [
        item["milestoneId"]
        for item in _exact_list(pending["terminalPending"], "pending.terminalPending")
    ]
    found = (
        f"origins={summary['acceptedOriginCount']}/{summary['acceptedOriginCount']}; "
        f"acceptedFamilies={summary['acceptedFamilyCount']}; "
        f"localNO_GO={summary['localVerdictCounts']['NO_GO']}; "
        f"localUNMEASURED={summary['localVerdictCounts']['UNMEASURED']}; "
        "acceptedCrediblePositives=0; crediblePositiveCount=null; "
        f"postV-G31AcceptedConsumed={summary['postVG31AcceptedEconomicConsumedCount']}; "
        f"acceptedSourceOnly={len(_exact_list(registry['sourceOnlyPins'], 'sourceOnlyPins'))}; "
        f"legacyAcceptedExcluded={summary['legacyAcceptedExcludedCount']}; "
        f"active={','.join(active_ids)}; terminalPending={','.join(terminal_ids)}; "
        f"pendingTruth={summary['requiredTruthCount']}; "
        f"economicThrough=S-2I-row …{economic['rowSha256'][-4:]}; "
        f"ledgerAsOf=DQ-14-row …{ledger['rowSha256'][-4:]}; "
        "globalProfitability=UNKNOWN; owner$1k=NO; positiveEdgeClaim=NOT_MADE; "
        "recommendation=NONE; authority=NONE; effects=NONE/$0"
    )
    card = (
        "- item=`N3-S2 PROFITABILITY CONVERGENCE`"
        f" | expected=`accepted N3-S1 …{BASELINE_COMMIT[-4:]}/row "
        f"…{BASELINE_ROW_SHA256[-4:]} + exactly twelve post-V-G31 accepted economics "
        f"after V-G31-row …{DELTA_START_ROW_SHA256[-4:]}; accepted ledger through "
        f"DQ-14-row …{LEDGER_AS_OF_ROW_SHA256[-4:]}`"
        f" | found=`{found}`"
        " | status=`N3_S2_SOURCE_READY; PRESERVED_WAITING(final convergence); "
        "NOT_LANDED; STOP`\n"
    )
    _require(card.count("\n") == 1 and card.endswith("\n"), "card is not one line")
    _require(not FULL_IDENTIFIER.search(card), "card leaked a full identifier")
    _require(
        not any(token in card for token in ("/Users/", "Desktop/", "quant/", "research/")),
        "card leaked a path",
    )
    _require(len(card.encode("utf-8")) <= 1600, "card exceeds bounded length")
    return card


def _validate_artifact_pin(value: Any, label: str) -> None:
    n3s1._validate_artifact_pin(value, label)


def validate_registry(registry_any: Any) -> None:
    registry = _exact_dict(registry_any, "registry")
    _exact_keys(
        registry,
        {
            "acceptanceLedgerAsOf",
            "baseline",
            "canonicalOrigin",
            "deltaWindow",
            "families",
            "ledgerReceipts",
            "legacyAcceptedExcluded",
            "origins",
            "originSpecCanonicalSha256",
            "ownerCardRawSha256",
            "pendingInputs",
            "schema",
            "sourceOnlyPins",
            "summary",
            "truthPolicy",
            "version",
        },
        "registry",
    )
    _require(_exact_str(registry["schema"], "registry.schema") == SCHEMA, "schema")
    _require(_exact_int(registry["version"], "registry.version") == VERSION, "version")
    _require(
        bool(HEX64.fullmatch(_exact_str(registry["originSpecCanonicalSha256"], "origin spec SHA"))),
        "origin spec SHA",
    )
    canonical = _exact_dict(registry["canonicalOrigin"], "canonicalOrigin")
    _require(
        canonical == {"commit": CANONICAL_COMMIT, "tree": CANONICAL_TREE},
        "canonical origin",
    )

    baseline = _exact_dict(registry["baseline"], "registry.baseline")
    _exact_keys(
        baseline,
        {
            "acceptanceRowSha256",
            "cardArtifact",
            "originSpecArtifact",
            "producerCommit",
            "producerParent",
            "producerTree",
            "recordId",
            "registryArtifact",
        },
        "registry.baseline",
    )
    _require(
        baseline["producerCommit"] == BASELINE_COMMIT
        and baseline["producerTree"] == BASELINE_TREE
        and baseline["producerParent"] == BASELINE_PARENT,
        "baseline lineage",
    )
    _require(
        baseline["recordId"] == BASELINE_RECORD_ID
        and baseline["acceptanceRowSha256"] == BASELINE_ROW_SHA256,
        "baseline acceptance",
    )
    for field, path, raw_hash in (
        ("originSpecArtifact", BASELINE_SPEC_PATH, BASELINE_SPEC_SHA256),
        ("registryArtifact", BASELINE_REGISTRY_PATH, BASELINE_REGISTRY_SHA256),
        ("cardArtifact", BASELINE_CARD_PATH, BASELINE_CARD_SHA256),
    ):
        artifact = _exact_dict(baseline[field], f"baseline.{field}")
        _validate_artifact_pin(artifact, f"baseline.{field}")
        _require(
            artifact["path"] == path
            and artifact["rawSha256"] == raw_hash
            and artifact["producerCommit"] == BASELINE_COMMIT
            and artifact["producerTree"] == BASELINE_TREE,
            f"baseline {field} drift",
        )

    delta = _exact_dict(registry["deltaWindow"], "registry.deltaWindow")
    _exact_keys(
        delta,
        {"acceptedEconomicOriginIds", "economicEvidenceThrough", "startExclusive"},
        "registry.deltaWindow",
    )
    _require(
        tuple(
            _exact_str(item, "accepted economic origin")
            for item in _exact_list(
                delta["acceptedEconomicOriginIds"], "delta.acceptedEconomicOriginIds"
            )
        )
        == INCREMENTAL_ORIGIN_IDS,
        "accepted economic origin allowlist",
    )
    start = _exact_dict(delta["startExclusive"], "delta.startExclusive")
    economic = _exact_dict(delta["economicEvidenceThrough"], "delta.economicEvidenceThrough")
    _require(
        start == {"recordId": DELTA_START_RECORD_ID, "rowSha256": DELTA_START_ROW_SHA256},
        "delta start",
    )
    _require(
        economic
        == {
            "recordId": ECONOMIC_THROUGH_RECORD_ID,
            "rowSha256": ECONOMIC_THROUGH_ROW_SHA256,
        },
        "economic boundary",
    )
    ledger_as_of = _exact_dict(registry["acceptanceLedgerAsOf"], "acceptanceLedgerAsOf")
    _require(
        ledger_as_of == {"recordId": LEDGER_AS_OF_RECORD_ID, "rowSha256": LEDGER_AS_OF_ROW_SHA256},
        "ledger boundary",
    )

    ledger_receipts = _exact_list(registry["ledgerReceipts"], "registry.ledgerReceipts")
    ledger_ids: list[str] = []
    consumed_ids: list[str] = []
    for index, value in enumerate(ledger_receipts, start=1):
        receipt = _exact_dict(value, f"ledger receipt {index}")
        _exact_keys(
            receipt,
            {
                "attemptDisposition",
                "authority",
                "classification",
                "economicOriginConsumed",
                "limitations",
                "recordId",
                "rowByteLength",
                "rowSha256",
                "rowUtf8",
            },
            f"ledger receipt {index}",
        )
        record_id = _exact_str(receipt["recordId"], "ledger record")
        ledger_ids.append(record_id)
        raw = _exact_str(receipt["rowUtf8"], "ledger row").encode("utf-8")
        _require(raw.endswith(b"\n"), f"{record_id}: row LF")
        _require(raw.startswith(f"- item=`{record_id}`".encode()), f"{record_id}: identity")
        _require(receipt["authority"] == "ORCHESTRATOR_RUN_MD", "ledger authority")
        _require(len(raw) == _exact_int(receipt["rowByteLength"], "row length"), "row length")
        _require(_sha256(raw) == receipt["rowSha256"], f"{record_id}: row hash")
        _require(receipt["rowSha256"] == LEDGER_ROW_SHA256[record_id], "known row hash")
        expected_class, expected_consumed, expected_attempt = LEDGER_CLASSIFICATIONS[record_id]
        _require(receipt["classification"] == expected_class, f"{record_id}: class")
        consumed = _exact_bool(receipt["economicOriginConsumed"], "economic consumed")
        _require(consumed is expected_consumed, f"{record_id}: consumption")
        if consumed:
            consumed_ids.append(record_id)
        _require(receipt["attemptDisposition"] == expected_attempt, f"{record_id}: attempt")
        limitations = tuple(
            _exact_str(item, f"{record_id}.limitation")
            for item in _exact_list(receipt["limitations"], f"{record_id}.limitations")
        )
        _require(
            limitations == REQUIRED_LEDGER_LIMITATIONS[record_id],
            f"{record_id}: limitations",
        )
    _require(tuple(ledger_ids) == LEDGER_ROW_IDS, "ledger receipt allowlist/order")
    _require(
        tuple(consumed_ids)
        == (
            "2026-07-30 ORCHESTRATOR V-G28 ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR V-G37 ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-1Y ACCEPTANCE + REFILL",
            "2026-07-30 ORCHESTRATOR S-2C ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-1Z ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR V-G36 ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-2G ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-2H ACCEPTANCE + DQ-11 DURABILITY RESUME",
            "2026-07-30 ORCHESTRATOR V-G27 ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-2A ACCEPTANCE",
            "2026-07-30 ORCHESTRATOR S-2K ACCEPTANCE",
            ECONOMIC_THROUGH_RECORD_ID,
        ),
        "economic receipt consumption set",
    )
    _require(
        all(" ORCHESTRATOR " in receipt_id for receipt_id in ledger_ids),
        "non-orchestrator row entered acceptance ledger",
    )

    origins = _exact_list(registry["origins"], "registry.origins")
    _require(len(origins) == EXPECTED_COMBINED_ORIGIN_COUNT, "origin count")
    _require(
        _sha256(_canonical_bytes(origins[:36])) == BASELINE_ORIGINS_SHA256,
        "baseline origin prefix drift",
    )
    _require(
        tuple(origin["originId"] for origin in origins[36:]) == INCREMENTAL_ORIGIN_IDS,
        "incremental origin order",
    )
    artifact_identities: set[tuple[str, str, str]] = set()
    for ordinal, value in enumerate(origins, start=1):
        origin = _exact_dict(value, f"origin {ordinal}")
        _require(_exact_int(origin["ordinal"], "origin ordinal") == ordinal, "origin ordinal")
        origin_id = _exact_str(origin["originId"], "origin ID")
        _require(
            _exact_bool(origin["verifiedPositive"], "origin verified positive") is False,
            "positive inflation",
        )
        if ordinal <= 36:
            continue
        expected_custody = (
            "ACCEPTED_TREE_EXACT_COMMIT_FRAGMENT_NON_SUFFIX"
            if origin_id == "S-1Z"
            else "ACCEPTED_EXACT"
        )
        _require(origin["custodyState"] == expected_custody, f"{origin_id}: custody")
        _require(
            origin["normalizedVerdict"] in {"NO_GO", "UNMEASURED"},
            f"{origin_id}: verdict",
        )
        _require(
            tuple(sorted(REQUIRED_ORIGIN_LIMITATIONS[origin_id])) == tuple(origin["limitations"]),
            f"{origin_id}: limitation loss",
        )
        artifact = _exact_dict(origin["artifact"], f"{origin_id}.artifact")
        protocol = _exact_dict(
            _exact_dict(origin["familyIdentity"], f"{origin_id}.familyIdentity")[
                "protocolArtifact"
            ],
            f"{origin_id}.protocolArtifact",
        )
        _validate_artifact_pin(artifact, f"{origin_id}.artifact")
        _validate_artifact_pin(protocol, f"{origin_id}.protocol")
        _require(artifact["path"] == _result_path(origin_id), f"{origin_id}: result path")
        _require(protocol["path"] == _protocol_path(origin_id), f"{origin_id}: protocol")
        _require(
            artifact["producerCommit"] == origin["producerCommit"]
            and artifact["producerTree"] == origin["producerTree"]
            and protocol["producerCommit"] == origin["producerCommit"]
            and protocol["producerTree"] == origin["producerTree"],
            f"{origin_id}: producer drift",
        )
        family = _exact_dict(origin["familyIdentity"], f"{origin_id}.familyIdentity")
        _require(family["state"] == "PROVISIONAL_POST_SMETA1", "family state")
        _require(
            family["key"] == f"POST_SMETA1::{origin_id}::{protocol['rawSha256']}",
            f"{origin_id}: family identity",
        )
        identity = (artifact["producerCommit"], artifact["path"], artifact["rawSha256"])
        _require(identity not in artifact_identities, "duplicate incremental artifact")
        artifact_identities.add(identity)
        _require(
            origin["acceptanceRowSha256"] == LEDGER_ROW_SHA256[origin["recordId"]],
            f"{origin_id}: receipt",
        )

    families = _exact_list(registry["families"], "registry.families")
    _require(len(families) == EXPECTED_COMBINED_FAMILY_COUNT, "family count")
    _require(
        _sha256(_canonical_bytes(families[:35])) == BASELINE_FAMILIES_SHA256,
        "baseline family prefix drift",
    )
    _require(families == n3s1._build_family_rollups(origins), "family rollup drift")
    for family in families:
        effective_p = _exact_dict(family["effectiveProgramWideP"], "effective p")
        _require(
            _exact_int(effective_p["numerator"], "p numerator") == 1
            and _exact_int(effective_p["denominator"], "p denominator") == 1,
            "effective program-wide p not one",
        )
        _require(
            _exact_bool(family["verifiedPositive"], "family verified positive") is False,
            "family positive inflation",
        )

    legacy = _exact_list(registry["legacyAcceptedExcluded"], "legacyAcceptedExcluded")
    _require(len(legacy) == 13, "legacy exclusion count")
    _require(
        _sha256(_canonical_bytes(legacy)) == BASELINE_LEGACY_EXCLUSIONS_SHA256,
        "legacy accepted exclusion drift",
    )
    for item in legacy:
        _require(item["outcomeBytesConsumed"] is False, "legacy outcome consumed")

    source_pins = _exact_list(registry["sourceOnlyPins"], "sourceOnlyPins")
    _require(len(source_pins) == len(SOURCE_ONLY_PINS), "source-only pin count")
    for index, source_expected in enumerate(SOURCE_ONLY_PINS):
        value = source_pins[index]
        item = _exact_dict(value, "source-only pin")
        binding_id, record_id, commit, tree, path = source_expected
        _require(
            item["bindingId"] == binding_id
            and item["recordId"] == record_id
            and item["status"] == "ACCEPTED_SOURCE_ONLY"
            and item["economicContribution"] == "NONE",
            "source-only classification",
        )
        _require(
            item["acceptanceRowSha256"] == LEDGER_ROW_SHA256[record_id],
            "source-only receipt",
        )
        artifact = _exact_dict(item["artifact"], "source-only artifact")
        _validate_artifact_pin(artifact, "source-only artifact")
        _require(
            artifact["producerCommit"] == commit
            and artifact["producerTree"] == tree
            and artifact["path"] == path,
            "source-only pin drift",
        )

    pending = _exact_dict(registry["pendingInputs"], "pendingInputs")
    expected_pending = {
        "activeOutsideBaselineCutoff": (
            "ACTIVE_UNPUBLISHED",
            False,
            PENDING_ACTIVE_OUTSIDE_BASELINE,
        ),
        "activeWithinBaselineCutoff": (
            "ACTIVE_UNPUBLISHED",
            True,
            PENDING_ACTIVE_WITHIN_BASELINE,
        ),
        "terminalPending": (
            "TERMINAL_PENDING_ORCHESTRATOR",
            False,
            PENDING_TERMINAL,
        ),
    }
    seen_pending: set[str] = set()
    for field, (state, in_scope, expected_tasks) in expected_pending.items():
        values = _exact_list(pending[field], f"pending.{field}")
        observed: list[tuple[str, str]] = []
        for value in values:
            item = _exact_dict(value, f"pending.{field}")
            milestone = _exact_str(item["milestoneId"], "pending milestone")
            suffix = _exact_str(item["taskRefSuffix"], "pending suffix")
            observed.append((milestone, suffix))
            _require(milestone not in seen_pending, "duplicate pending milestone")
            seen_pending.add(milestone)
            _require(item["evidenceState"] == state, "pending state")
            _require(
                _exact_bool(item["inBaselineCutoffScope"], "pending scope") is in_scope,
                "pending scope",
            )
            _require(
                _exact_bool(item["outcomeBytesInspected"], "pending inspected") is False,
                "pending outcome inspected",
            )
            _require(
                _exact_bool(item["taskRefIsEvidence"], "pending evidence") is False,
                "pending task ref promoted",
            )
        _require(tuple(observed) == expected_tasks, f"{field}: pending drift")
    required_truth = _exact_list(pending["requiredTruth"], "pending.requiredTruth")
    _require(
        tuple(item["code"] for item in required_truth) == REQUIRED_TRUTH_CODES,
        "required truth codes",
    )
    _require(all(item["state"] == "PENDING" for item in required_truth), "truth promoted")

    truth_policy = _exact_dict(registry["truthPolicy"], "truthPolicy")
    _require(
        _sha256(_canonical_bytes(truth_policy)) == BASELINE_TRUTH_POLICY_SHA256,
        "truth policy weakened",
    )

    summary = _exact_dict(registry["summary"], "summary")
    expected_summary = {
        "acceptedCrediblePositiveCount": 0,
        "acceptedFamilyCount": EXPECTED_COMBINED_FAMILY_COUNT,
        "acceptedOriginCount": EXPECTED_COMBINED_ORIGIN_COUNT,
        "activeProfitabilityTaskCount": 2,
        "capitalAuthority": "NONE",
        "completeFamilyUniverse": False,
        "crediblePositiveCount": None,
        "currentProfitabilityVerdict": "UNKNOWN",
        "familyDeduplicationState": "EXACT_FOR_ACCEPTED_ORIGINS_ONLY",
        "legacyAcceptedExcludedCount": 13,
        "localVerdictCounts": EXPECTED_LOCAL_VERDICT_COUNTS,
        "moneyUsd": 0,
        "owner1000FundingVerdict": "NO",
        "positiveEdgeClaim": "NOT_MADE",
        "postVG31AcceptedEconomicConsumedCount": 12,
        "recommendation": "NONE",
        "rejectedAttemptP1DispositionCount": 7,
        "requiredTruthCount": 6,
        "terminalPendingCount": 0,
        "verifiedPositiveCount": 0,
    }
    _exact_keys(summary, set(expected_summary), "summary")
    for field in (
        "capitalAuthority",
        "currentProfitabilityVerdict",
        "familyDeduplicationState",
        "owner1000FundingVerdict",
        "positiveEdgeClaim",
        "recommendation",
    ):
        _exact_str(summary[field], f"summary.{field}")
    for field in (
        "acceptedCrediblePositiveCount",
        "acceptedFamilyCount",
        "acceptedOriginCount",
        "activeProfitabilityTaskCount",
        "legacyAcceptedExcludedCount",
        "moneyUsd",
        "postVG31AcceptedEconomicConsumedCount",
        "rejectedAttemptP1DispositionCount",
        "requiredTruthCount",
        "terminalPendingCount",
        "verifiedPositiveCount",
    ):
        _exact_int(summary[field], f"summary.{field}")
    _exact_bool(summary["completeFamilyUniverse"], "summary.completeFamilyUniverse")
    _require(summary["crediblePositiveCount"] is None, "credible-positive count must be null")
    local_counts = _exact_dict(summary["localVerdictCounts"], "summary.localVerdictCounts")
    _exact_keys(local_counts, {"NO_GO", "UNMEASURED"}, "summary.localVerdictCounts")
    _exact_int(local_counts["NO_GO"], "summary.localVerdictCounts.NO_GO")
    _exact_int(local_counts["UNMEASURED"], "summary.localVerdictCounts.UNMEASURED")
    _require(summary == expected_summary, "summary drift or verdict inflation")

    card_hash = _exact_str(registry["ownerCardRawSha256"], "owner card SHA")
    _require(bool(HEX64.fullmatch(card_hash)), "owner card SHA")
    _require(_sha256(render_owner_card(registry).encode("utf-8")) == card_hash, "card hash")


def verify_spec_binding(registry: Mapping[str, Any], spec: dict[str, Any]) -> None:
    _validate_spec(spec)
    _require(
        registry["originSpecCanonicalSha256"] == _sha256(_canonical_bytes(spec)),
        "origin spec binding drift",
    )


def verify_git_pins(registry: Mapping[str, Any], repo: Path) -> None:
    pins: list[dict[str, Any]] = []
    baseline = _exact_dict(registry["baseline"], "baseline")
    for field in ("cardArtifact", "originSpecArtifact", "registryArtifact"):
        pins.append(_exact_dict(baseline[field], f"baseline.{field}"))
    for origin in _exact_list(registry["origins"], "origins")[36:]:
        item = _exact_dict(origin, "incremental origin")
        pins.append(_exact_dict(item["artifact"], "incremental artifact"))
        family = _exact_dict(item["familyIdentity"], "incremental family")
        pins.append(_exact_dict(family["protocolArtifact"], "incremental protocol"))
    for source in _exact_list(registry["sourceOnlyPins"], "sourceOnlyPins"):
        pins.append(_exact_dict(_exact_dict(source, "source pin")["artifact"], "source artifact"))
    seen: set[tuple[str, str, str]] = set()
    for pin in pins:
        identity = (pin["producerCommit"], pin["path"], pin["rawSha256"])
        _require(identity not in seen, "duplicate verification pin")
        seen.add(identity)
        actual = _pin_artifact(
            repo,
            _exact_str(pin["producerCommit"], "pin commit"),
            _exact_str(pin["producerTree"], "pin tree"),
            _exact_str(pin["path"], "pin path"),
        )
        _require(actual == pin, f"{pin['path']}: Git pin drift")


def verify_run_receipts(registry: Mapping[str, Any], run_raw: bytes) -> None:
    record_ids = (DELTA_START_RECORD_ID, *LEDGER_ROW_IDS)
    extracted, _ = _extract_rows(run_raw, record_ids)
    _require(_window_orchestrator_ids(run_raw) == LEDGER_ROW_IDS, "live delta window drift")
    _require(
        extracted[DELTA_START_RECORD_ID]["rowSha256"] == DELTA_START_ROW_SHA256,
        "live delta-start row drift",
    )
    for receipt in _exact_list(registry["ledgerReceipts"], "ledgerReceipts"):
        item = _exact_dict(receipt, "ledger receipt")
        record_id = _exact_str(item["recordId"], "ledger record")
        stored_core = {
            key: item[key]
            for key in ("authority", "recordId", "rowByteLength", "rowSha256", "rowUtf8")
        }
        _require(stored_core == extracted[record_id], f"{record_id}: live receipt drift")


def _write_outputs(registry: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    registry_path = output_dir / "current_profitability_registry.v2.json"
    card_path = output_dir / "owner_verdict_card.v2.md"
    registry_path.write_bytes(_canonical_bytes(registry))
    card_path.write_bytes(render_owner_card(registry).encode("utf-8"))


def _verify_files(
    registry_path: Path,
    card_path: Path,
    repo: Path,
    spec_path: Path,
    run_path: Path,
) -> dict[str, Any]:
    registry = load_json(registry_path)
    spec = load_json(spec_path)
    run_raw = run_path.read_bytes()
    validate_registry(registry)
    verify_spec_binding(registry, spec)
    verify_git_pins(registry, repo)
    verify_run_receipts(registry, run_raw)
    expected = freeze_registry(spec, run_raw, repo)
    _require(_canonical_bytes(expected) == registry_path.read_bytes(), "registry bytes drift")
    expected_card = render_owner_card(registry).encode("utf-8")
    _require(card_path.read_bytes() == expected_card, "owner card bytes drift")
    summary = _exact_dict(registry["summary"], "summary")
    return {
        "acceptedFamilyCount": summary["acceptedFamilyCount"],
        "acceptedOriginCount": summary["acceptedOriginCount"],
        "activeProfitabilityTaskCount": summary["activeProfitabilityTaskCount"],
        "cardSha256": _sha256(expected_card),
        "crediblePositiveCount": summary["crediblePositiveCount"],
        "ledgerAsOf": registry["acceptanceLedgerAsOf"],
        "postVG31AcceptedEconomicConsumedCount": summary["postVG31AcceptedEconomicConsumedCount"],
        "registrySha256": _sha256(registry_path.read_bytes()),
        "terminalPendingCount": summary["terminalPendingCount"],
        "verdict": summary["currentProfitabilityVerdict"],
        "verifiedPositiveCount": summary["verifiedPositiveCount"],
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    freeze = commands.add_parser("freeze")
    freeze.add_argument("--spec", type=Path, required=True)
    freeze.add_argument("--run", type=Path, required=True)
    freeze.add_argument("--repo", type=Path, required=True)
    freeze.add_argument("--output-dir", type=Path, required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--registry", type=Path, required=True)
    verify.add_argument("--card", type=Path, required=True)
    verify.add_argument("--spec", type=Path, required=True)
    verify.add_argument("--run", type=Path, required=True)
    verify.add_argument("--repo", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "freeze":
            spec = load_json(args.spec)
            registry = freeze_registry(spec, args.run.read_bytes(), args.repo)
            _write_outputs(registry, args.output_dir)
            proof = _verify_files(
                args.output_dir / "current_profitability_registry.v2.json",
                args.output_dir / "owner_verdict_card.v2.md",
                args.repo,
                args.spec,
                args.run,
            )
        else:
            proof = _verify_files(
                args.registry,
                args.card,
                args.repo,
                args.spec,
                args.run,
            )
    except ContractError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "PASS", **proof}, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
