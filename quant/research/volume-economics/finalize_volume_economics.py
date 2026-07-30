#!/usr/bin/env python3
"""Network-free invalid-test finalizer for the retained Volume archive run."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
SCHEMA = "volume.archive-conditional-economics.v1"
POLICY_SCHEMA = "volume.economics-policy.v1"
RAW_RESULT_SCHEMA = "TEMP_VOLUME_12M_STATEFUL_CONDITIONAL_PROXY_V4"
FROZEN_POLICY_SHA256 = "27402815b52079d9d34eda0e822ec7a7598af9f12fe797533cde731a8551266e"
INVALID_RUN_PRODUCER_SHA256 = "576ea91a27195553902766f78fa3994430fa30ff2a55f6bc3aaab251dca1b826"
PREDECESSOR_COMMIT = "20a3a66acc2bd92638fd13b1377225ff8e8def6f"
PREDECESSOR_TREE = "bb14c2880ebce1a07ff32632bb7b63aa14ec5f26"
FAIL_CLOSED_ENTRYPOINT = "measure_volume_12m_fail_closed.py"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require(condition: bool, code: str) -> None:
    if not condition:
        raise RuntimeError(code)


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"JSON_OBJECT_REQUIRED:{path.name}")
    return value


def data_row_count(path: Path) -> int:
    with path.open("rb") as handle:
        lines = sum(1 for _ in handle)
    require(lines > 1, f"EVENT_LEDGER_EMPTY:{path.name}")
    return lines - 1


def validate_raw_binding(
    result: dict[str, Any],
    result_path: Path,
    events_path: Path,
    manifest_path: Path,
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
        events_binding.get("rows") == data_row_count(events_path),
        f"EVENT_COUNT_BINDING_INVALID:{events_path.name}",
    )
    require(
        events_binding.get("rows") == result["base"]["events"],
        f"RAW_EVENT_COUNT_INVALID:{result_path.name}",
    )
    require(
        script_binding.get("sha256") == INVALID_RUN_PRODUCER_SHA256,
        f"INVALID_RUN_PRODUCER_BINDING:{result_path.name}",
    )


def validate_chronology_map(
    result: dict[str, Any],
    field: str,
    symbols: list[str],
    result_path: Path,
) -> dict[str, int]:
    value = result.get(field)
    require(isinstance(value, dict), f"CHRONOLOGY_MAP_MISSING:{result_path.name}:{field}")
    require(set(value) == set(symbols), f"CHRONOLOGY_SYMBOL_SET:{result_path.name}:{field}")
    output: dict[str, int] = {}
    for symbol in symbols:
        count = value[symbol]
        require(
            isinstance(count, int) and not isinstance(count, bool) and count >= 0,
            f"CHRONOLOGY_COUNT_INVALID:{result_path.name}:{field}:{symbol}",
        )
        output[symbol] = count
    return output


def rejected_phase(
    *,
    result: dict[str, Any],
    result_path: Path,
    events_path: Path,
    symbols: list[str],
) -> dict[str, Any]:
    duplicate_map = validate_chronology_map(
        result,
        "archiveIdenticalDuplicateRowsBySymbol",
        symbols,
        result_path,
    )
    out_of_order_map = validate_chronology_map(
        result,
        "archiveOutOfOrderTransitionsBySymbol",
        symbols,
        result_path,
    )
    return {
        "rawResultSha256": sha256_file(result_path),
        "derivedEventLedgerSha256": sha256_file(events_path),
        "reportedDuplicateCollapsedKeysBySymbol": {
            symbol: count for symbol, count in duplicate_map.items() if count
        },
        "reportedOutOfOrderTransitionsBySymbol": {
            symbol: count for symbol, count in out_of_order_map.items() if count
        },
    }


def build_invalid_packet(
    *,
    policy: dict[str, Any],
    raw_manifest_path: Path,
    sealed_manifest_path: Path,
    sealed_manifest: dict[str, Any],
    rejected_evidence: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA,
        "policyId": policy["policyId"],
        "testStatus": "INVALID_TEST",
        "measurementStatus": "UNMEASURED",
        "goNoGo": "NOT_APPLICABLE",
        "source": {
            "acceptedVolumeCommit": policy["source"]["acceptedVolumeCommit"],
            "acceptedVolumeTree": policy["source"]["acceptedVolumeTree"],
            "predecessorInvalidTestCommit": PREDECESSOR_COMMIT,
            "predecessorInvalidTestTree": PREDECESSOR_TREE,
            "invalidRunProducerSha256": INVALID_RUN_PRODUCER_SHA256,
            "failClosedEntrypoint": FAIL_CLOSED_ENTRYPOINT,
            "failClosedEntrypointSha256": sha256_file(ROOT / FAIL_CLOSED_ENTRYPOINT),
            "rawArchiveManifestSha256": sha256_file(raw_manifest_path),
            "sealedArchiveManifestSha256": sha256_file(sealed_manifest_path),
            "archiveCount": sealed_manifest["archiveCount"],
            "recordedOfficialChecksumVerifications": sealed_manifest[
                "officialChecksumVerifiedCount"
            ],
            "rawArchiveBytesPresentInGit": False,
        },
        "period": {
            "startInclusiveUtc": policy["dataset"]["startInclusiveUtc"],
            "endExclusiveUtc": policy["dataset"]["endExclusiveUtc"],
            "calendarDays": 365,
        },
        "sample": None,
        "economics": {
            "netUsdPer1000": None,
            "netSyntheticUsdtPer1000": None,
            "confidenceInterval95": None,
            "drawdown": None,
            "eventSample": None,
        },
        "capacity": {
            "measuredCapacity": None,
            "supports1000QuoteNotional": "UNKNOWN",
            "fullUniverseCapacity": "UNKNOWN",
            "extrapolationForbidden": True,
        },
        "feePosture": {
            "publicScenariosEvaluated": False,
            "accountEffectiveFeeState": "UNKNOWN",
            "usdEquivalenceEstablished": False,
        },
        "phases": None,
        "rejectedEvidence": rejected_evidence,
        "verdict": {
            "testDisposition": "INVALID_TEST",
            "archiveConditional": "UNMEASURED",
            "reasonCodes": [
                "SOURCE_DUPLICATE_KLINE_OPEN_TIME_REPORTED",
                "SOURCE_OUT_OF_ORDER_KLINE_OPEN_TIME_REPORTED",
                "UNAUTHORIZED_SOURCE_CANONICALIZATION",
            ],
            "oosGate": policy["verdict"]["oosGate"],
            "pboGate": policy["verdict"]["pboGate"],
            "accountEffective": "UNMEASURED",
            "acceptedVe2ProspectiveLifecycle": "UNMEASURED",
            "repairAuthority": "NONE",
            "rerunAuthority": "NONE",
            "executionAuthority": "NONE",
        },
        "sourceRules": {
            "validationTiming": "BEFORE_ANY_FEATURE_EVENT_OR_ECONOMIC_MEASUREMENT",
            "nativeTwelveFieldParsingRequired": True,
            "nativeMicrosecondOpenTimeRequired": True,
            "uniqueStrictlyIncreasingOpenTimeRequired": True,
            "sortAllowed": False,
            "deduplicationAllowed": False,
            "rowOrSymbolExclusionAllowed": False,
            "gapFillOrRepairAllowed": False,
        },
        "consumer": policy["consumer"],
        "authority": policy["defaults"],
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--raw-manifest", type=Path, required=True)
    parser.add_argument("--sealed-manifest", type=Path, required=True)
    parser.add_argument("--phase0-events", type=Path, required=True)
    parser.add_argument("--phase1-events", type=Path, required=True)
    parser.add_argument("--phase0-result", type=Path, required=True)
    parser.add_argument("--phase1-result", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    require(sha256_file(args.policy) == FROZEN_POLICY_SHA256, "FROZEN_POLICY_CHANGED")
    policy = read_json(args.policy)
    raw_manifest = json.loads(args.raw_manifest.read_text(encoding="utf-8"))
    sealed_manifest = read_json(args.sealed_manifest)
    phase0_result = read_json(args.phase0_result)
    phase1_result = read_json(args.phase1_result)

    require(policy.get("schemaVersion") == POLICY_SCHEMA, "POLICY_SCHEMA_INVALID")
    require(policy.get("frozenBeforeCurrentRerunCompleted") is True, "POLICY_NOT_FROZEN")
    require(policy.get("outcomesKnownFromPriorConsumedRun") is True, "OUTCOME_HISTORY_HIDDEN")
    require(
        policy["source"]["measurementScriptSha256"] == INVALID_RUN_PRODUCER_SHA256,
        "POLICY_PRODUCER_BINDING",
    )
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
    )
    validate_raw_binding(
        phase1_result,
        args.phase1_result,
        args.phase1_events,
        args.raw_manifest,
    )

    symbols = policy["dataset"]["symbols"]
    rejected_evidence = {
        "phase0": rejected_phase(
            result=phase0_result,
            result_path=args.phase0_result,
            events_path=args.phase0_events,
            symbols=symbols,
        ),
        "phase1": rejected_phase(
            result=phase1_result,
            result_path=args.phase1_result,
            events_path=args.phase1_events,
            symbols=symbols,
        ),
    }
    require(
        any(
            phase["reportedDuplicateCollapsedKeysBySymbol"]
            or phase["reportedOutOfOrderTransitionsBySymbol"]
            for phase in rejected_evidence.values()
        ),
        "SOURCE_CHRONOLOGY_DEFECT_REQUIRED",
    )

    packet = build_invalid_packet(
        policy=policy,
        raw_manifest_path=args.raw_manifest,
        sealed_manifest_path=args.sealed_manifest,
        sealed_manifest=sealed_manifest,
        rejected_evidence=rejected_evidence,
    )
    args.output.write_text(
        json.dumps(packet, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
