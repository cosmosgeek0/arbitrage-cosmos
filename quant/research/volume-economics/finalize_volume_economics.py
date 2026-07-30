#!/usr/bin/env python3
"""Network-free normalization of the finite Volume archive economics."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP, getcontext
from pathlib import Path
from typing import Any


getcontext().prec = 60

SCHEMA = "volume.archive-conditional-economics.v1"
POLICY_SCHEMA = "volume.economics-policy.v1"
RAW_RESULT_SCHEMA = "TEMP_VOLUME_12M_STATEFUL_CONDITIONAL_PROXY_V4"
EVENT_NOTIONAL = Decimal("12")
SLIPPAGE_RATE = Decimal("5") / Decimal("10000")
PERIOD_START_S = 1_751_328_000
PERIOD_DAYS = 365
BOOTSTRAP_SEED = 20_260_728
BOOTSTRAP_BLOCK_DAYS = 7
BOOTSTRAP_REPLICATES = 2_000
Q12 = Decimal("0.000000000001")
RNG_DOMAIN = b"quant-edge-rng-v1\x00"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_decimal(value: Decimal) -> str:
    rendered = value.quantize(Q12, rounding=ROUND_HALF_UP)
    if rendered == 0:
        rendered = abs(rendered)
    return format(rendered, "f")


def next_u64(seed: int, counter: int) -> int:
    material = (
        RNG_DOMAIN
        + seed.to_bytes(16, byteorder="big", signed=False)
        + counter.to_bytes(8, byteorder="big", signed=False)
    )
    return int.from_bytes(hashlib.sha256(material).digest()[:8], byteorder="big")


def require(condition: bool, code: str) -> None:
    if not condition:
        raise RuntimeError(code)


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"JSON_OBJECT_REQUIRED:{path.name}")
    return value


def read_events(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    require(bool(rows), f"EVENTS_EMPTY:{path.name}")
    required = {
        "symbol",
        "focus_session_id",
        "proposal_s",
        "entry_open",
        "exit_open",
        "direction",
        "participation_disposition",
    }
    require(required.issubset(rows[0]), f"EVENT_COLUMNS_INVALID:{path.name}")
    identities: set[tuple[str, str]] = set()
    last_order: tuple[int, str] | None = None
    for row in rows:
        require(
            row["participation_disposition"] == "ACCEPTED_12USD_1PCT",
            f"NON_ACCEPTED_EVENT:{path.name}",
        )
        identity = (row["symbol"], row["focus_session_id"])
        require(identity not in identities, f"DUPLICATE_EVENT:{path.name}")
        identities.add(identity)
        order = (int(row["proposal_s"]), row["symbol"])
        require(last_order is None or order >= last_order, f"EVENT_ORDER_INVALID:{path.name}")
        last_order = order
        require(row["direction"] in {"LONG", "SHORT_PREOWNED"}, f"DIRECTION_INVALID:{path.name}")
        require(Decimal(row["entry_open"]) > 0, f"ENTRY_PRICE_INVALID:{path.name}")
        require(Decimal(row["exit_open"]) > 0, f"EXIT_PRICE_INVALID:{path.name}")
    return rows


def event_pnl(row: dict[str, str], fee_bps_per_side: Decimal) -> Decimal:
    entry_open = Decimal(row["entry_open"])
    exit_open = Decimal(row["exit_open"])
    fee_rate = fee_bps_per_side / Decimal("10000")
    if row["direction"] == "LONG":
        entry = entry_open * (Decimal(1) + SLIPPAGE_RATE)
        exit_price = exit_open * (Decimal(1) - SLIPPAGE_RATE)
        gross = EVENT_NOTIONAL * (exit_price / entry - Decimal(1))
    else:
        entry = entry_open * (Decimal(1) - SLIPPAGE_RATE)
        exit_price = exit_open * (Decimal(1) + SLIPPAGE_RATE)
        gross = EVENT_NOTIONAL * (Decimal(1) - exit_price / entry)
    exit_notional = EVENT_NOTIONAL * exit_price / entry
    fees = fee_rate * (EVENT_NOTIONAL + exit_notional)
    return gross - fees


def bootstrap(
    rows: list[dict[str, str]],
    pnls: list[Decimal],
) -> dict[str, Any]:
    daily_pnl = [Decimal(0) for _ in range(PERIOD_DAYS)]
    daily_notional = [Decimal(0) for _ in range(PERIOD_DAYS)]
    for row, pnl in zip(rows, pnls, strict=True):
        day = (int(row["proposal_s"]) - PERIOD_START_S) // 86_400
        require(0 <= day < PERIOD_DAYS, "EVENT_OUTSIDE_PERIOD")
        daily_pnl[day] += pnl
        daily_notional[day] += EVENT_NOTIONAL

    blocks_needed = math.ceil(PERIOD_DAYS / BOOTSTRAP_BLOCK_DAYS)
    replicates: list[Decimal] = []
    counter = 0
    for _ in range(BOOTSTRAP_REPLICATES):
        indices: list[int] = []
        for _ in range(blocks_needed):
            start = next_u64(BOOTSTRAP_SEED, counter) % PERIOD_DAYS
            counter += 1
            indices.extend(
                (start + offset) % PERIOD_DAYS
                for offset in range(BOOTSTRAP_BLOCK_DAYS)
            )
        drawn = indices[:PERIOD_DAYS]
        denominator = sum((daily_notional[index] for index in drawn), Decimal(0))
        require(denominator > 0, "BOOTSTRAP_ZERO_NOTIONAL")
        numerator = sum((daily_pnl[index] for index in drawn), Decimal(0))
        replicates.append(Decimal(1000) * numerator / denominator)

    replicates.sort()
    lower_index = math.ceil(Decimal("0.025") * len(replicates)) - 1
    upper_index = math.ceil(Decimal("0.975") * len(replicates)) - 1
    total_notional = EVENT_NOTIONAL * len(rows)
    point = Decimal(1000) * sum(pnls, Decimal(0)) / total_notional
    return {
        "method": "SEEDED_CIRCULAR_UTC_DAY_BLOCK_BOOTSTRAP_OF_PNL_OVER_ENTRY_NOTIONAL",
        "seed": str(BOOTSTRAP_SEED),
        "blockLengthUtcDays": BOOTSTRAP_BLOCK_DAYS,
        "windowUtcDays": PERIOD_DAYS,
        "replicates": BOOTSTRAP_REPLICATES,
        "coverage": "0.95",
        "quantileRule": "NEAREST_RANK_CEILING",
        "pointNetSyntheticUsdtPer1000": canonical_decimal(point),
        "lowerNetSyntheticUsdtPer1000": canonical_decimal(replicates[lower_index]),
        "upperNetSyntheticUsdtPer1000": canonical_decimal(replicates[upper_index]),
    }


def drawdown(rows: list[dict[str, str]], pnls: list[Decimal]) -> dict[str, Any]:
    cumulative = Decimal(0)
    peak = Decimal(0)
    peak_index = -1
    max_drawdown = Decimal(0)
    max_peak_index = -1
    max_trough_index = -1
    for index, pnl in enumerate(pnls):
        cumulative += pnl
        if cumulative > peak:
            peak = cumulative
            peak_index = index
        current = peak - cumulative
        if current > max_drawdown:
            max_drawdown = current
            max_peak_index = peak_index
            max_trough_index = index

    def coordinate(index: int) -> dict[str, Any] | None:
        if index < 0:
            return None
        return {
            "eventIndex": index,
            "proposalEpochSecond": int(rows[index]["proposal_s"]),
            "symbol": rows[index]["symbol"],
        }

    return {
        "metric": "MAX_PEAK_TO_TROUGH_CUMULATIVE_MODELED_PNL",
        "modeledPnlUsdtAt12UsdtEventNotional": canonical_decimal(max_drawdown),
        "cumulativeOpportunityEdgePer1000Units": canonical_decimal(
            max_drawdown * Decimal(1000) / EVENT_NOTIONAL
        ),
        "peak": coordinate(max_peak_index),
        "trough": coordinate(max_trough_index),
        "capitalDrawdownClaim": False,
    }


def scenario(
    rows: list[dict[str, str]],
    *,
    scenario_id: str,
    fee_bps_per_side: Decimal,
) -> dict[str, Any]:
    pnls = [event_pnl(row, fee_bps_per_side) for row in rows]
    aggregate = sum(pnls, Decimal(0))
    total_notional = EVENT_NOTIONAL * len(rows)
    return {
        "id": scenario_id,
        "feeBpsPerSide": canonical_decimal(fee_bps_per_side),
        "slippageBpsPerSide": "5.000000000000",
        "accountEffective": False,
        "events": len(rows),
        "aggregateModeledPnlSyntheticUsdt": canonical_decimal(aggregate),
        "aggregateEntryNotionalSyntheticUsdt": canonical_decimal(total_notional),
        "netSyntheticUsdtPer1000": canonical_decimal(
            Decimal(1000) * aggregate / total_notional
        ),
        "bootstrap95": bootstrap(rows, pnls),
        "drawdown": drawdown(rows, pnls),
    }


def validate_raw_binding(
    result: dict[str, Any],
    result_path: Path,
    events_path: Path,
    manifest_path: Path,
    policy: dict[str, Any],
) -> None:
    require(result.get("schema") == RAW_RESULT_SCHEMA, f"RAW_SCHEMA_INVALID:{result_path.name}")
    require(result.get("resultClass") == "CONDITIONAL_PROXY_ONLY", "RAW_CLASS_INVALID")
    require(
        result.get("archiveManifestSha256") == sha256_file(manifest_path),
        f"MANIFEST_BINDING_INVALID:{result_path.name}",
    )
    bindings = result.get("artifactBindings")
    require(isinstance(bindings, dict), "RAW_BINDINGS_MISSING")
    events_binding = bindings.get("acceptedParticipationEvents")
    script_binding = bindings.get("script")
    require(isinstance(events_binding, dict), "EVENT_BINDING_MISSING")
    require(isinstance(script_binding, dict), "SCRIPT_BINDING_MISSING")
    require(
        events_binding.get("sha256") == sha256_file(events_path),
        f"EVENT_HASH_INVALID:{events_path.name}",
    )
    require(
        events_binding.get("rows") == result["base"]["events"],
        f"EVENT_COUNT_BINDING_INVALID:{events_path.name}",
    )
    require(
        script_binding.get("sha256") == policy["source"]["measurementScriptSha256"],
        "SCRIPT_HASH_BINDING_INVALID",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--raw-manifest", type=Path, required=True)
    parser.add_argument("--sealed-manifest", type=Path, required=True)
    parser.add_argument("--phase0-events", type=Path, required=True)
    parser.add_argument("--phase1-events", type=Path, required=True)
    parser.add_argument("--phase0-result", type=Path, required=True)
    parser.add_argument("--phase1-result", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    policy = read_json(args.policy)
    raw_manifest = json.loads(args.raw_manifest.read_text(encoding="utf-8"))
    sealed_manifest = read_json(args.sealed_manifest)
    phase0_result = read_json(args.phase0_result)
    phase1_result = read_json(args.phase1_result)
    phase0_events = read_events(args.phase0_events)
    phase1_events = read_events(args.phase1_events)

    require(policy.get("schemaVersion") == POLICY_SCHEMA, "POLICY_SCHEMA_INVALID")
    require(policy.get("frozenBeforeCurrentRerunCompleted") is True, "POLICY_NOT_FROZEN")
    require(policy.get("outcomesKnownFromPriorConsumedRun") is True, "OUTCOME_HISTORY_HIDDEN")
    require(
        isinstance(raw_manifest, list) and len(raw_manifest) == 120,
        "RAW_MANIFEST_COUNT_INVALID",
    )
    require(
        sealed_manifest.get("schemaVersion") == "volume.archive-manifest.v1",
        "SEALED_MANIFEST_SCHEMA_INVALID",
    )
    require(
        sealed_manifest.get("rawManifestSha256") == sha256_file(args.raw_manifest),
        "SEALED_RAW_MANIFEST_BINDING_INVALID",
    )
    require(
        sealed_manifest.get("archiveCount") == 120
        and sealed_manifest.get("officialChecksumVerifiedCount") == 120,
        "SEALED_MANIFEST_COUNT_INVALID",
    )
    require(
        len(sealed_manifest.get("records", [])) == 120
        and all(
            item.get("checksumVerified") is True
            and item.get("advertisedArchiveSha256") == item.get("archiveSha256")
            for item in sealed_manifest["records"]
        ),
        "SEALED_MANIFEST_CHECKSUM_STATE_INVALID",
    )
    validate_raw_binding(
        phase0_result,
        args.phase0_result,
        args.phase0_events,
        args.raw_manifest,
        policy,
    )
    validate_raw_binding(
        phase1_result,
        args.phase1_result,
        args.phase1_events,
        args.raw_manifest,
        policy,
    )
    require(len(phase0_events) == phase0_result["base"]["events"], "PHASE0_COUNT_INVALID")
    require(len(phase1_events) == phase1_result["base"]["events"], "PHASE1_COUNT_INVALID")

    phases: dict[str, Any] = {}
    for phase_id, rows, raw_result_path, events_path in (
        ("phase0", phase0_events, args.phase0_result, args.phase0_events),
        ("phase1", phase1_events, args.phase1_result, args.phase1_events),
    ):
        phases[phase_id] = {
            "timerPhase": 0 if phase_id == "phase0" else 1,
            "rawResultSha256": sha256_file(raw_result_path),
            "acceptedEventsSha256": sha256_file(events_path),
            "scenarios": [
                scenario(
                    rows,
                    scenario_id="PUBLIC_10_BPS_PER_SIDE",
                    fee_bps_per_side=Decimal("10"),
                ),
                scenario(
                    rows,
                    scenario_id="PUBLIC_12_BPS_PER_SIDE_STRESS",
                    fee_bps_per_side=Decimal("12"),
                ),
            ],
        }

    stress_upper = [
        Decimal(
            phases[phase_id]["scenarios"][1]["bootstrap95"][
                "upperNetSyntheticUsdtPer1000"
            ]
        )
        for phase_id in ("phase0", "phase1")
    ]
    for phase_id, raw_result in (
        ("phase0", phase0_result),
        ("phase1", phase1_result),
    ):
        reproduced = Decimal(
            phases[phase_id]["scenarios"][0]["netSyntheticUsdtPer1000"]
        )
        retained = Decimal(str(raw_result["base"]["netUsdPer1000EntryNotional"]))
        require(
            abs(reproduced - retained) <= Decimal("0.000000001"),
            f"RAW_ECONOMICS_RECONCILIATION:{phase_id}",
        )
    require(all(value < 0 for value in stress_upper), "NO_GO_GATE_NOT_MET")
    packet = {
        "schemaVersion": SCHEMA,
        "policyId": policy["policyId"],
        "source": {
            "acceptedVolumeCommit": policy["source"]["acceptedVolumeCommit"],
            "acceptedVolumeTree": policy["source"]["acceptedVolumeTree"],
            "measurementScriptSha256": policy["source"]["measurementScriptSha256"],
            "rawArchiveManifestSha256": sha256_file(args.raw_manifest),
            "sealedArchiveManifestSha256": sha256_file(args.sealed_manifest),
            "archiveCount": len(raw_manifest),
            "officialChecksumsVerified": sealed_manifest[
                "officialChecksumVerifiedCount"
            ],
        },
        "period": {
            "startInclusiveUtc": policy["dataset"]["startInclusiveUtc"],
            "endExclusiveUtc": policy["dataset"]["endExclusiveUtc"],
            "calendarDays": PERIOD_DAYS,
        },
        "sample": {
            "symbols": policy["dataset"]["symbols"],
            "symbolCount": len(policy["dataset"]["symbols"]),
            "phase0ExactEvents": len(phase0_events),
            "phase1ExactEvents": len(phase1_events),
            "selectionState": policy["dataset"]["selectionState"],
            "oosState": policy["verdict"]["oosGate"],
        },
        "capacity": policy["capacity"],
        "feePosture": {
            "publicScenariosOnly": True,
            "accountEffectiveFeeState": "UNKNOWN",
            "usdEquivalenceEstablished": False,
        },
        "phases": phases,
        "verdict": {
            "archiveConditional": "NO_GO",
            "reason": "BOTH_TIMER_PHASE_PUBLIC_12_BPS_STRESS_BOOTSTRAP_95_UPPER_STRICTLY_BELOW_ZERO",
            "oosGate": policy["verdict"]["oosGate"],
            "pboGate": policy["verdict"]["pboGate"],
            "positiveDisposition": policy["verdict"]["positiveDisposition"],
            "accountEffective": "UNMEASURED",
            "acceptedVe2ProspectiveLifecycle": "UNMEASURED",
            "executionAuthority": "NONE",
        },
        "limitations": [
            "CONDITIONAL_ARCHIVE_PROXY_ONLY",
            "USDT_TO_USD_EQUIVALENCE_NOT_ESTABLISHED",
            "HISTORICAL_BOOK_DEPTH_RECEIVE_CLOCK_AND_POINT_IN_TIME_FILTERS_ABSENT",
            "UNAVAILABLE_BOOK_AND_CAPPED_RAW_TAPE_GATES_ASSUMED_PASS",
            "CURRENT_COHORT_SURVIVORSHIP_BIAS",
            "APR_JUN_SPLIT_RETROSPECTIVE_NOT_UNTOUCHED_OOS",
            "SINGLE_1000_USDT_CAPACITY_UNKNOWN",
        ],
        "consumer": policy["consumer"],
        "authority": policy["defaults"],
    }
    args.output.write_text(
        json.dumps(packet, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
