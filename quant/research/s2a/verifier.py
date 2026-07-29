#!/usr/bin/env python3
"""Archive-free custody and result verifier for the sealed S-2A packet."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import re
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Final

JsonObject = dict[str, Any]
HEX_64: Final = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_40: Final = re.compile(r"^[0-9a-f]{40}$")
VERDICTS: Final = frozenset({"GO", "NO_GO", "UNMEASURED"})
SOURCE_DATASETS: Final = ("klines", "markPriceKlines", "fundingRate")
FROZEN_SOURCE_FILES: Final = frozenset(
    {
        "README.md",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "DISTINCTNESS.md",
        "__init__.py",
        "protocol.v1.json",
        "experiment.py",
        "verifier.py",
        "test_experiment.py",
        "test_verifier.py",
    }
)
BASE_PACKET_FILES: Final = frozenset(
    {
        *FROZEN_SOURCE_FILES,
        "freeze.v1.json",
        "RUN_CONSUMED.v1.json",
        "development.v1.json",
        "source_manifest.v1.json",
        "result.v1.json",
    }
)


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> JsonObject:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def parse_checksum_file(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        parts = line.split("  ", 1)
        if len(parts) != 2 or not HEX_64.fullmatch(parts[0]):
            raise ValueError("invalid SHA256SUMS row")
        digest, relative = parts
        if Path(relative).name != relative or relative in result:
            raise ValueError("SHA256SUMS filenames must be unique basenames")
        result[relative] = digest
    return result


def verify_packet_checksums(
    packet_dir: Path,
    required: set[str] | None = None,
) -> int:
    expected = parse_checksum_file(packet_dir / "SHA256SUMS")
    if not expected:
        raise ValueError("SHA256SUMS is empty")
    if required is not None and set(expected) != required:
        raise ValueError("SHA256SUMS inventory differs from the frozen result state")
    for relative, digest in expected.items():
        path = packet_dir / relative
        if not path.is_file() or sha256_file(path) != digest:
            raise ValueError(f"packet checksum mismatch for {relative}")
    return len(expected)


def manifest_key(row: Mapping[str, Any]) -> tuple[str, str, str]:
    return str(row["dataset"]), str(row["symbol"]), str(row["month"])


def archive_relative_path(dataset: str, symbol: str, month: str) -> str:
    if dataset == "klines":
        return f"klines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if dataset == "markPriceKlines":
        return f"markPriceKlines/{symbol}/1h/{symbol}-1h-{month}.zip"
    if dataset == "fundingRate":
        return f"fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
    raise ValueError(f"unsupported dataset {dataset}")


def expected_source_rows(
    protocol: JsonObject,
) -> tuple[list[JsonObject], list[JsonObject]]:
    factor = str(protocol["universe"]["factor_symbol"])
    symbols = [
        factor,
        *[str(symbol) for symbol in protocol["universe"]["idiosyncratic_symbols"]],
    ]
    root_url = str(protocol["sources"]["root"])

    def rows(months: Sequence[str], phase: str) -> list[JsonObject]:
        result: list[JsonObject] = []
        for symbol in symbols:
            for month in months:
                for dataset in SOURCE_DATASETS:
                    relative = archive_relative_path(dataset, symbol, month)
                    result.append(
                        {
                            "dataset": dataset,
                            "symbol": symbol,
                            "month": month,
                            "phase": phase,
                            "relative_path": relative,
                            "zip_url": f"{root_url}/{relative}",
                            "checksum_url": f"{root_url}/{relative}.CHECKSUM",
                            "status": "EXPECTED",
                        }
                    )
        return result

    return (
        rows(
            [str(month) for month in protocol["window"]["development_months"]],
            "DEVELOPMENT",
        ),
        rows(
            [str(month) for month in protocol["window"]["holdout_months"]],
            "HOLDOUT",
        ),
    )


def parse_official_checksum(path: Path, expected_name: str) -> str:
    tokens = path.read_text(encoding="utf-8").strip().split()
    if (
        len(tokens) != 2
        or not HEX_64.fullmatch(tokens[0])
        or tokens[1].lstrip("*") != expected_name
    ):
        raise ValueError("stored official checksum sidecar is malformed")
    return tokens[0]


def verify_manifest(
    raw_root: Path,
    manifest: JsonObject,
    protocol: JsonObject,
) -> JsonObject:
    rows = manifest.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("source manifest rows are missing")
    factor = str(protocol["universe"]["factor_symbol"])
    symbols = [
        factor,
        *[str(symbol) for symbol in protocol["universe"]["idiosyncratic_symbols"]],
    ]
    holdout_months = [str(month) for month in protocol["window"]["holdout_months"]]
    development_expected, holdout_expected = expected_source_rows(protocol)
    expected_rows = {manifest_key(row): row for row in [*development_expected, *holdout_expected]}
    expected = set(expected_rows)
    keys = [manifest_key(row) for row in rows]
    if len(keys) != len(set(keys)) or set(keys) != expected:
        raise ValueError("source manifest identity set differs from the frozen plan")
    acquired = 0
    opened = 0
    sealed = 0
    for row in rows:
        planned = expected_rows[manifest_key(row)]
        for field in (
            "dataset",
            "symbol",
            "month",
            "phase",
            "relative_path",
            "zip_url",
            "checksum_url",
        ):
            if row.get(field) != planned[field]:
                raise ValueError(f"manifest {field} differs from the frozen source plan")
        status = str(row["status"])
        phase = str(row["phase"])
        if status == "ACQUIRED_CHECKSUM_VERIFIED":
            acquired += 1
            relative = Path(str(row["local_relative_path"]))
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("manifest local path escapes raw custody")
            archive_path = raw_root / relative
            checksum_path = archive_path.with_name(f"{archive_path.name}.CHECKSUM")
            expected_local = Path("archives") / str(row["relative_path"])
            if relative != expected_local:
                raise ValueError("manifest local path differs from frozen custody layout")
            if not archive_path.is_file() or not checksum_path.is_file():
                raise ValueError("acquired custody file is absent")
            archive_digest = sha256_file(archive_path)
            if archive_digest != row["received_zip_sha256"]:
                raise ValueError("acquired archive digest differs from manifest")
            if row["received_zip_sha256"] != row["declared_zip_sha256"]:
                raise ValueError("manifest declared and received digests differ")
            if sha256_file(checksum_path) != row["checksum_sha256"]:
                raise ValueError("checksum sidecar digest differs from manifest")
            if parse_official_checksum(checksum_path, archive_path.name) != archive_digest:
                raise ValueError("official checksum sidecar does not bind the archive")
            if archive_path.stat().st_size != int(row["zip_bytes"]):
                raise ValueError("archive size differs from manifest")
            if checksum_path.stat().st_size != int(row["checksum_bytes"]):
                raise ValueError("checksum size differs from manifest")
            if bool(row.get("member_opened")):
                opened += 1
                if not isinstance(row.get("csv_member"), str):
                    raise ValueError("opened archive lacks bound CSV member")
        elif status == "SEALED_UNOPENED":
            sealed += 1
            if phase != "HOLDOUT" or bool(row.get("member_opened")):
                raise ValueError("only holdout rows may be sealed unopened")
            relative = Path(str(row["relative_path"]))
            archive_path = raw_root / "archives" / relative
            if (
                archive_path.exists()
                or archive_path.with_name(f"{archive_path.name}.CHECKSUM").exists()
            ):
                raise ValueError("sealed holdout custody bytes unexpectedly exist")
            for field in (
                "declared_zip_sha256",
                "received_zip_sha256",
                "checksum_sha256",
                "zip_bytes",
                "checksum_bytes",
                "csv_member",
            ):
                if row.get(field) is not None:
                    raise ValueError("sealed holdout row carries opened-body evidence")
        elif status == "NOT_ACQUIRED_TERMINAL_FAILURE":
            if bool(row.get("member_opened")):
                raise ValueError("failed acquisition row cannot be member-opened")
            relative = Path(str(row["relative_path"]))
            archive_path = raw_root / "archives" / relative
            if (
                archive_path.exists()
                or archive_path.with_name(f"{archive_path.name}.CHECKSUM").exists()
            ):
                raise ValueError("not-acquired custody row has unexpected bytes")
            for field in (
                "declared_zip_sha256",
                "received_zip_sha256",
                "checksum_sha256",
                "zip_bytes",
                "checksum_bytes",
                "csv_member",
            ):
                if row.get(field) is not None:
                    raise ValueError("not-acquired row carries source-body evidence")
        elif status == "PARTIAL_CUSTODY_TERMINAL_FAILURE":
            if bool(row.get("member_opened")):
                raise ValueError("partial custody cannot be member-opened")
            if phase == "HOLDOUT" and not bool(manifest["holdout_opened"]):
                raise ValueError("sealed holdout cannot have partial custody")
            relative = Path(str(row["local_relative_path"]))
            expected_local = Path("archives") / str(row["relative_path"])
            if relative != expected_local:
                raise ValueError("partial custody path differs from frozen layout")
            archive_path = raw_root / relative
            checksum_path = archive_path.with_name(f"{archive_path.name}.CHECKSUM")
            if not archive_path.is_file() and not checksum_path.is_file():
                raise ValueError("partial custody row has no surviving bytes")
            if archive_path.is_file():
                if sha256_file(archive_path) != row.get(
                    "received_zip_sha256"
                ) or archive_path.stat().st_size != int(row["zip_bytes"]):
                    raise ValueError("partial archive evidence differs from manifest")
            elif row.get("received_zip_sha256") is not None or row.get("zip_bytes") is not None:
                raise ValueError("missing partial archive carries fabricated evidence")
            if checksum_path.is_file():
                if (
                    sha256_file(checksum_path) != row.get("checksum_sha256")
                    or checksum_path.stat().st_size != int(row["checksum_bytes"])
                    or parse_official_checksum(checksum_path, archive_path.name)
                    != row.get("declared_zip_sha256")
                ):
                    raise ValueError("partial checksum evidence differs from manifest")
            elif row.get("checksum_sha256") is not None or row.get("checksum_bytes") is not None:
                raise ValueError("missing partial checksum carries fabricated evidence")
            if (
                archive_path.is_file()
                and checksum_path.is_file()
                and row.get("declared_zip_sha256") != row.get("received_zip_sha256")
            ):
                raise ValueError("partial pair contradicts its official checksum")
        else:
            raise ValueError(f"unknown manifest status {status}")
    if len(rows) != int(manifest["expected_archive_pairs"]):
        raise ValueError("expected archive-pair count mismatch")
    if 2 * len(rows) != int(manifest["expected_http_objects"]):
        raise ValueError("expected HTTP-object count mismatch")
    if acquired != int(manifest["acquired_archive_pairs"]):
        raise ValueError("acquired manifest count mismatch")
    if 2 * acquired != int(manifest["acquired_http_objects"]):
        raise ValueError("acquired HTTP-object count mismatch")
    if opened != int(manifest["opened_archive_members"]):
        raise ValueError("opened member count mismatch")
    if bool(manifest["holdout_opened"]):
        if sealed:
            raise ValueError("opened holdout cannot retain sealed-unopened rows")
    else:
        if sealed != len(symbols) * len(holdout_months) * len(SOURCE_DATASETS):
            raise ValueError("unopened holdout row count mismatch")
    return {
        "manifest_rows": len(rows),
        "acquired_archive_pairs": acquired,
        "opened_archive_members": opened,
        "sealed_holdout_rows": sealed,
    }


def finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def verified_gates(value: Any, label: str) -> dict[str, bool]:
    if (
        not isinstance(value, dict)
        or not value
        or any(not isinstance(item, bool) for item in value.values())
    ):
        raise ValueError(f"{label} gates are malformed")
    return {str(key): item for key, item in value.items()}


def verify_economics_summary(
    summary: JsonObject,
    label: str,
    *,
    development: bool,
    white_in_summary: bool = True,
) -> None:
    net = summary.get("net_usd_per_1000")
    interval = summary.get("base_interval_95_usd_per_1000")
    capacity = summary.get("public_capacity_proxy_usd")
    if (
        not isinstance(net, dict)
        or set(net) != {"gross", "base", "stress", "severe"}
        or not isinstance(interval, dict)
        or set(interval) != {"lower", "upper"}
        or not isinstance(capacity, dict)
    ):
        raise ValueError(f"{label} economics are malformed")
    numeric_paths = [
        summary.get("active_round_trips"),
        summary.get("active_weeks"),
        summary.get("max_realized_drawdown_fraction_of_1000"),
        *net.values(),
        *interval.values(),
        capacity.get("observations"),
    ]
    if development:
        numeric_paths.extend(
            [
                summary.get("base_familywise_bonferroni_lower_usd_per_1000"),
                summary.get("centered_block_one_sided_p"),
                summary.get("holm_adjusted_p"),
            ]
        )
        if white_in_summary:
            numeric_paths.append(summary.get("white_reality_check_p"))
    if any(not finite_number(value) for value in numeric_paths):
        raise ValueError(f"{label} contains nonnumeric economics")
    if float(interval["lower"]) > float(interval["upper"]):
        raise ValueError(f"{label} interval is inverted")
    if float(summary["max_realized_drawdown_fraction_of_1000"]) < 0:
        raise ValueError(f"{label} drawdown is negative")
    capacity_observations = int(capacity["observations"])
    capacity_values = [capacity.get(name) for name in ("minimum", "p05", "median")]
    if capacity_observations < 0 or (
        capacity_observations == 0 and any(value is not None for value in capacity_values)
    ):
        raise ValueError(f"{label} capacity is inconsistent")
    if capacity_observations > 0:
        for value in capacity_values:
            if (
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(float(value))
                or float(value) <= 0
            ):
                raise ValueError(f"{label} capacity is nonnumeric")
    for field in (
        "centered_block_one_sided_p",
        "holm_adjusted_p",
    ):
        if development and not 0 <= float(summary[field]) <= 1:
            raise ValueError(f"{label} p-value is outside [0, 1]")
    if development and white_in_summary and not 0 <= float(summary["white_reality_check_p"]) <= 1:
        raise ValueError(f"{label} White p-value is outside [0, 1]")


def development_gate_values(
    protocol: JsonObject,
    summary: JsonObject,
    white_p: float,
) -> dict[str, bool]:
    gates = protocol["development_gates"]
    capacity_p05 = summary["public_capacity_proxy_usd"]["p05"]
    return {
        "candidate_hours_min": int(summary["candidate_hours"]) >= int(gates["candidate_hours_min"]),
        "active_round_trips_min": int(summary["active_round_trips"])
        >= int(gates["active_round_trips_min"]),
        "active_weeks_min": int(summary["active_weeks"]) >= int(gates["active_weeks_min"]),
        "distinct_idiosyncratic_symbols_min": int(summary["distinct_idiosyncratic_symbols"])
        >= int(gates["distinct_idiosyncratic_symbols_min"]),
        "base_net_positive": float(summary["net_usd_per_1000"]["base"])
        > float(gates["base_net_usd_per_1000_gt"]),
        "stress_net_positive": float(summary["net_usd_per_1000"]["stress"])
        > float(gates["stress_net_usd_per_1000_gt"]),
        "pointwise_lower_bound_positive": float(summary["base_interval_95_usd_per_1000"]["lower"])
        > float(gates["pointwise_lower_bound_gt"]),
        "familywise_lower_bound_positive": float(
            summary["base_familywise_bonferroni_lower_usd_per_1000"]
        )
        > float(gates["familywise_lower_bound_gt"]),
        "champion_holm_p": float(summary["holm_adjusted_p"]) <= float(gates["champion_holm_p_lte"]),
        "white_reality_check_p": white_p <= float(gates["white_reality_check_p_lte"]),
        "max_drawdown": float(summary["max_realized_drawdown_fraction_of_1000"])
        <= float(gates["max_drawdown_lte"]),
        "capacity_p05": capacity_p05 is not None
        and float(capacity_p05) >= float(gates["capacity_p05_usd_gte"]),
    }


def holdout_gate_values(
    protocol: JsonObject,
    summary: JsonObject,
) -> dict[str, bool]:
    gates = protocol["holdout_gates_if_opened"]
    return {
        "active_round_trips_min": int(summary["active_round_trips"])
        >= int(gates["active_round_trips_min"]),
        "active_weeks_min": int(summary["active_weeks"]) >= int(gates["active_weeks_min"]),
        "base_net_positive": float(summary["net_usd_per_1000"]["base"])
        > float(gates["base_net_usd_per_1000_gt"]),
        "stress_net_positive": float(summary["net_usd_per_1000"]["stress"])
        > float(gates["stress_net_usd_per_1000_gt"]),
        "pointwise_lower_bound_positive": float(summary["base_interval_95_usd_per_1000"]["lower"])
        > float(gates["pointwise_lower_bound_gt"]),
        "max_drawdown": float(summary["max_realized_drawdown_fraction_of_1000"])
        <= float(gates["max_drawdown_lte"]),
    }


def verify_numeric_result(result: JsonObject, protocol: JsonObject) -> None:
    verdict = result.get("research_verdict")
    local_verdict = result.get("local_public_verdict")
    if verdict not in VERDICTS or local_verdict not in VERDICTS:
        raise ValueError("result verdict is outside the frozen vocabulary")
    if result.get("program_wide_external_multiplicity") != "UNMEASURED":
        raise ValueError("program-wide multiplicity must remain unmeasured")
    if result.get("capital_verdict") != "NO_GO" or result.get("authority") != "NONE":
        raise ValueError("result widened capital or execution authority")
    effects = result.get("effects")
    if not isinstance(effects, dict) or effects.get("money_usd") != 0:
        raise ValueError("result effects are malformed")
    if any(
        bool(effects.get(name))
        for name in (
            "ui",
            "canonical",
            "host",
            "provider",
            "private",
            "order",
            "transfer",
            "withdrawal",
        )
    ):
        raise ValueError("result claims a forbidden effect")
    run_status = result.get("run_status")
    holdout_state = result.get("holdout_state")
    if run_status == "TERMINAL_MEASUREMENT_FAILURE":
        if (
            verdict != "UNMEASURED"
            or local_verdict != "UNMEASURED"
            or result.get("development") is not None
            or result.get("holdout") is not None
            or holdout_state != "SEALED_UNOPENED_TERMINAL_MEASUREMENT_FAILURE"
        ):
            raise ValueError("terminal measurement failure must remain unmeasured")
        return
    if run_status not in {"COMPLETE", "TERMINAL_HOLDOUT_MEASUREMENT_FAILURE"}:
        raise ValueError("unknown result run status")
    development = result.get("development")
    if not isinstance(development, dict):
        raise ValueError("complete run lacks development champion report")
    verify_economics_summary(development, "development", development=True)
    pbo = development.get("pbo")
    if (
        not isinstance(pbo, dict)
        or pbo.get("role") != "DIAGNOSTIC_ONLY"
        or not finite_number(pbo.get("pbo"))
        or not 0 <= float(pbo["pbo"]) <= 1
    ):
        raise ValueError("PBO diagnostic is malformed")
    development_gates = verified_gates(
        development.get("development_gates"),
        "development",
    )
    if development_gates != development_gate_values(
        protocol,
        development,
        float(development["white_reality_check_p"]),
    ):
        raise ValueError("development gates differ from frozen numeric thresholds")
    eligible = development.get("eligible_for_holdout")
    if not isinstance(eligible, bool) or eligible != all(development_gates.values()):
        raise ValueError("development eligibility contradicts its frozen gates")
    if run_status == "TERMINAL_HOLDOUT_MEASUREMENT_FAILURE":
        if (
            not eligible
            or verdict != "UNMEASURED"
            or local_verdict != "UNMEASURED"
            or result.get("holdout") is not None
            or holdout_state != "OPENED_TERMINAL_MEASUREMENT_FAILURE"
        ):
            raise ValueError("terminal holdout failure contradicts the verdict law")
        return
    holdout = result.get("holdout")
    if not eligible:
        if (
            verdict != "NO_GO"
            or local_verdict != "NO_GO"
            or holdout is not None
            or holdout_state != "SEALED_UNOPENED_DEVELOPMENT_GATES_FAILED"
        ):
            raise ValueError("development failure contradicts the verdict law")
        return
    if not isinstance(holdout, dict):
        raise ValueError("eligible development lacks a measured holdout")
    verify_economics_summary(holdout, "holdout", development=False)
    holdout_gates = verified_gates(holdout.get("gates"), "holdout")
    if holdout_gates != holdout_gate_values(protocol, holdout):
        raise ValueError("holdout gates differ from frozen numeric thresholds")
    if all(holdout_gates.values()):
        if (
            verdict != "UNMEASURED"
            or local_verdict != "GO"
            or holdout_state != "OPENED_ON_FROZEN_CHAMPION_ALL_LOCAL_PUBLIC_GATES_PASSED"
        ):
            raise ValueError("local public pass contradicts the verdict law")
    elif (
        verdict != "NO_GO"
        or local_verdict != "NO_GO"
        or holdout_state != "OPENED_ON_FROZEN_CHAMPION_HOLDOUT_GATES_FAILED"
    ):
        raise ValueError("holdout failure contradicts the verdict law")


def concise_development(development: JsonObject) -> JsonObject:
    trial_id = development["eligible_champion_trial_id"]
    if trial_id is None:
        trial_id = development["reporting_champion_trial_id"]
    trial = development["trials"][trial_id]
    return {
        "trial_id": trial_id,
        "eligible_for_holdout": development["eligible_champion_trial_id"] is not None,
        "z_threshold": trial["z_threshold"],
        "volume_threshold": trial["volume_threshold"],
        "hold_hours": trial["hold_hours"],
        "candidate_hours": trial["candidate_hours"],
        "active_round_trips": trial["active_round_trips"],
        "active_weeks": trial["active_weeks"],
        "distinct_idiosyncratic_symbols": trial["distinct_idiosyncratic_symbols"],
        "net_usd_per_1000": trial["net_usd_per_1000"],
        "base_interval_95_usd_per_1000": trial["base_interval_95_usd_per_1000"],
        "base_familywise_bonferroni_lower_usd_per_1000": trial[
            "base_familywise_bonferroni_lower_usd_per_1000"
        ],
        "centered_block_one_sided_p": trial["centered_block_one_sided_p"],
        "holm_adjusted_p": trial["holm_adjusted_p"],
        "white_reality_check_p": development["white_reality_check_p"],
        "pbo": development["pbo"],
        "max_realized_drawdown_fraction_of_1000": trial["max_realized_drawdown_fraction_of_1000"],
        "public_capacity_proxy_usd": trial["public_capacity_proxy_usd"],
        "development_gates": trial["development_gates"],
    }


def concise_holdout(holdout: JsonObject) -> JsonObject:
    trial = holdout["trial"]
    return {
        "trial_id": holdout["sealed_champion_trial_id"],
        "net_usd_per_1000": trial["net_usd_per_1000"],
        "base_interval_95_usd_per_1000": trial["base_interval_95_usd_per_1000"],
        "active_round_trips": trial["active_round_trips"],
        "active_weeks": trial["active_weeks"],
        "max_realized_drawdown_fraction_of_1000": trial["max_realized_drawdown_fraction_of_1000"],
        "public_capacity_proxy_usd": trial["public_capacity_proxy_usd"],
        "gates": holdout["gates"],
    }


def frozen_trial_parameters(
    protocol: JsonObject,
) -> dict[str, tuple[float, float, int]]:
    result: dict[str, tuple[float, float, int]] = {}
    for z_threshold, volume_threshold, hold_hours in itertools.product(
        protocol["signal"]["absolute_residual_z_thresholds"],
        protocol["volume_confirmation"]["thresholds"],
        protocol["response"]["hold_hours"],
    ):
        z_value = float(z_threshold)
        volume_value = float(volume_threshold)
        hold_value = int(hold_hours)
        trial_id = f"Z{round(z_value * 100):03d}_V{round(volume_value * 100):03d}_H{hold_value:02d}"
        result[trial_id] = (z_value, volume_value, hold_value)
    return result


def verify_evidence_gate_law(
    packet_dir: Path,
    protocol: JsonObject,
    result: JsonObject,
) -> None:
    development = read_json(packet_dir / "development.v1.json")
    if development.get("status") == "TERMINAL_MEASUREMENT_FAILURE":
        if result.get("development") is not None:
            raise ValueError("terminal development artifact has a numeric result")
        return
    trials = development.get("trials")
    expected_parameters = frozen_trial_parameters(protocol)
    if (
        not isinstance(trials, dict)
        or set(trials) != set(expected_parameters)
        or int(development.get("trial_count", -1)) != len(expected_parameters)
        or len(expected_parameters) != int(protocol["response"]["trials"])
    ):
        raise ValueError("development trial family differs from the frozen grid")
    white_value = development.get("white_reality_check_p")
    if (
        not isinstance(white_value, (int, float))
        or isinstance(white_value, bool)
        or not math.isfinite(float(white_value))
        or not 0 <= float(white_value) <= 1
    ):
        raise ValueError("development White p-value is malformed")
    white_p = float(white_value)
    eligible: list[str] = []
    for trial_id, parameters in expected_parameters.items():
        summary = trials[trial_id]
        if (
            float(summary["z_threshold"]),
            float(summary["volume_threshold"]),
            int(summary["hold_hours"]),
        ) != parameters:
            raise ValueError("trial parameters differ from the frozen grid")
        verify_economics_summary(
            summary,
            f"trial {trial_id}",
            development=True,
            white_in_summary=False,
        )
        gates = development_gate_values(protocol, summary, white_p)
        if summary.get("development_gates") != gates or summary.get(
            "all_development_gates_pass"
        ) is not all(gates.values()):
            raise ValueError("trial gate flags differ from frozen numeric thresholds")
        if all(gates.values()):
            eligible.append(trial_id)
    reporting = min(
        trials,
        key=lambda trial_id: (
            -float(trials[trial_id]["net_usd_per_1000"]["base"]),
            trial_id,
        ),
    )
    eligible_champion = (
        min(
            eligible,
            key=lambda trial_id: (
                -float(trials[trial_id]["net_usd_per_1000"]["base"]),
                trial_id,
            ),
        )
        if eligible
        else None
    )
    if (
        development.get("reporting_champion_trial_id") != reporting
        or development.get("eligible_trial_ids") != sorted(eligible)
        or development.get("eligible_champion_trial_id") != eligible_champion
        or development.get("all_development_gates_pass") is not (eligible_champion is not None)
        or development.get("pbo_affects_verdict") is not False
        or development.get("external_program_wide_multiplicity") != "UNMEASURED"
    ):
        raise ValueError("development selection or multiplicity law is inconsistent")
    pbo = development.get("pbo")
    expected_splits = math.comb(
        int(protocol["statistics"]["pbo"]["chronological_blocks"]),
        int(protocol["statistics"]["pbo"]["chronological_blocks"]) // 2,
    )
    if (
        not isinstance(pbo, dict)
        or pbo.get("role") != "DIAGNOSTIC_ONLY"
        or int(pbo.get("splits", -1)) != expected_splits
    ):
        raise ValueError("development PBO declaration differs from the frozen law")
    holdout_path = packet_dir / "holdout.v1.json"
    if not holdout_path.exists():
        return
    holdout = read_json(holdout_path)
    summary = holdout["trial"]
    gates = holdout_gate_values(protocol, summary)
    if (
        eligible_champion is None
        or holdout.get("sealed_champion_trial_id") != eligible_champion
        or summary.get("trial_id") != eligible_champion
        or holdout.get("gates") != gates
        or holdout.get("all_holdout_gates_pass") is not all(gates.values())
    ):
        raise ValueError("holdout champion or gates differ from the frozen law")
    verify_economics_summary(
        summary,
        "holdout artifact",
        development=True,
        white_in_summary=False,
    )


def verify_result_artifact_binding(packet_dir: Path, result: JsonObject) -> None:
    development = read_json(packet_dir / "development.v1.json")
    if result.get("development") is None:
        if development.get("status") != "TERMINAL_MEASUREMENT_FAILURE":
            raise ValueError("null result development contradicts development artifact")
    elif concise_development(development) != result.get("development"):
        raise ValueError("result development projection differs from frozen artifact")
    if result.get("holdout") is None:
        if (packet_dir / "holdout.v1.json").exists():
            raise ValueError("null result holdout contradicts present holdout artifact")
    else:
        holdout = read_json(packet_dir / "holdout.v1.json")
        if concise_holdout(holdout) != result.get("holdout"):
            raise ValueError("result holdout projection differs from frozen artifact")


def verify_cross_state(result: JsonObject, manifest: JsonObject) -> None:
    opened = manifest.get("holdout_opened")
    if not isinstance(opened, bool):
        raise ValueError("manifest holdout-open state is not Boolean")
    run_status = result.get("run_status")
    holdout_state = result.get("holdout_state")
    development = result.get("development")
    eligible = development.get("eligible_for_holdout") if isinstance(development, dict) else False
    if opened:
        if (
            eligible is not True
            or holdout_state
            not in {
                "OPENED_ON_FROZEN_CHAMPION_HOLDOUT_GATES_FAILED",
                "OPENED_ON_FROZEN_CHAMPION_ALL_LOCAL_PUBLIC_GATES_PASSED",
                "OPENED_TERMINAL_MEASUREMENT_FAILURE",
            }
            or run_status not in {"COMPLETE", "TERMINAL_HOLDOUT_MEASUREMENT_FAILURE"}
        ):
            raise ValueError("opened holdout contradicts result eligibility or state")
        if run_status == "COMPLETE" and not isinstance(result.get("holdout"), dict):
            raise ValueError("complete opened holdout lacks measured economics")
    elif (
        result.get("holdout") is not None
        or run_status == "TERMINAL_HOLDOUT_MEASUREMENT_FAILURE"
        or (isinstance(holdout_state, str) and not holdout_state.startswith("SEALED_UNOPENED_"))
    ):
        raise ValueError("sealed holdout contradicts result state")

    rows = manifest.get("rows")
    if not isinstance(rows, list):
        raise ValueError("manifest rows are missing")
    development_rows = [row for row in rows if row.get("phase") == "DEVELOPMENT"]
    holdout_rows = [row for row in rows if row.get("phase") == "HOLDOUT"]

    def fully_opened(rows_to_check: Sequence[Mapping[str, Any]]) -> bool:
        return bool(rows_to_check) and all(
            row.get("status") == "ACQUIRED_CHECKSUM_VERIFIED" and row.get("member_opened") is True
            for row in rows_to_check
        )

    if run_status in {"COMPLETE", "TERMINAL_HOLDOUT_MEASUREMENT_FAILURE"} and not fully_opened(
        development_rows
    ):
        raise ValueError("post-development state lacks complete opened development custody")
    if run_status == "COMPLETE" and opened and not fully_opened(holdout_rows):
        raise ValueError("complete holdout result lacks complete opened holdout custody")


def verify_marker_agreement(
    packet_dir: Path,
    raw_root: Path,
    result: JsonObject,
    manifest: JsonObject,
    protocol: JsonObject,
    freeze: JsonObject,
) -> None:
    started_path = packet_dir / "RUN_STARTED.v1.json"
    started = read_json(started_path) if started_path.exists() else None
    consumed = read_json(packet_dir / "RUN_CONSUMED.v1.json")
    external = read_json(raw_root / "RUN_CONSUMED.v1.json")
    development_expected, holdout_expected = expected_source_rows(protocol)
    source_plan_sha256 = hashlib.sha256(
        canonical_bytes(
            {
                "development": development_expected,
                "holdout": holdout_expected,
            }
        )
    ).hexdigest()
    protocol_sha256 = sha256_file(packet_dir / "protocol.v1.json")
    freeze_sha256 = sha256_file(packet_dir / "freeze.v1.json")
    freeze_commit = result.get("freeze_commit")
    if not isinstance(freeze_commit, str) or not GIT_SHA_40.fullmatch(freeze_commit):
        raise ValueError("result freeze commit is missing")
    one_run_id = hashlib.sha256(
        canonical_bytes(
            {
                "freeze_commit": freeze_commit,
                "protocol_sha256": protocol_sha256,
                "source_plan_sha256": source_plan_sha256,
            }
        )
    ).hexdigest()
    expected_core = {
        "schema": "s2a.run-marker.v1",
        "strategy_id": "S-2A",
        "one_run_id": one_run_id,
        "freeze_commit": freeze_commit,
        "canonical_base": protocol["canonical_base"],
        "protocol_sha256": protocol_sha256,
        "freeze_sha256": freeze_sha256,
        "source_plan_sha256": source_plan_sha256,
        "raw_root": str(raw_root.resolve()),
        "max_run_count": 1,
        "holdout_opened": False,
    }
    failure = result.get("failure")
    failure_stage = failure.get("stage") if isinstance(failure, dict) else None
    missing_start_allowed = (
        result.get("run_status") == "TERMINAL_MEASUREMENT_FAILURE"
        and failure_stage == "PACKET_START_MARKER"
    )
    if (
        external != expected_core
        or (started is not None and started != expected_core)
        or (started is None and not missing_start_allowed)
    ):
        raise ValueError("start/external run marker differs from recomputed frozen state")
    core_fields = (
        "one_run_id",
        "freeze_commit",
        "canonical_base",
        "protocol_sha256",
        "freeze_sha256",
        "source_plan_sha256",
        "raw_root",
        "max_run_count",
    )
    for field in core_fields:
        markers = [consumed, external]
        if started is not None:
            markers.append(started)
        values = {marker.get(field) for marker in markers}
        if len(values) != 1:
            raise ValueError(f"run marker disagreement for {field}")
    if consumed.get("schema") != "s2a.run-marker.v1" or consumed.get("strategy_id") != "S-2A":
        raise ValueError("consumed marker identity is malformed")
    if external["one_run_id"] != result["one_run_id"] or manifest.get("one_run_id") != result.get(
        "one_run_id"
    ):
        raise ValueError("result one-run identity differs from marker")
    if external["freeze_commit"] != result["freeze_commit"]:
        raise ValueError("result freeze commit differs from marker")
    if external["source_plan_sha256"] != manifest["source_plan_sha256"]:
        raise ValueError("manifest source plan differs from marker")
    if freeze.get("canonical_base") != protocol.get("canonical_base"):
        raise ValueError("freeze canonical base differs from protocol")
    if (
        consumed.get("terminal_research_verdict") != result.get("research_verdict")
        or consumed.get("local_public_verdict") != result.get("local_public_verdict")
        or consumed.get("holdout_opened") != manifest.get("holdout_opened")
        or consumed.get("holdout_state") != result.get("holdout_state")
    ):
        raise ValueError("consumed marker contradicts manifest or result")
    holdout_packet = packet_dir / "HOLDOUT_OPENED.v1.json"
    holdout_external = raw_root / "HOLDOUT_OPENED.v1.json"
    if bool(manifest["holdout_opened"]):
        missing_packet_allowed = (
            result.get("run_status") == "TERMINAL_HOLDOUT_MEASUREMENT_FAILURE"
            and failure_stage == "HOLDOUT_MARKER"
        )
        if not holdout_external.is_file() or (
            not holdout_packet.is_file() and not missing_packet_allowed
        ):
            raise ValueError("opened holdout lacks its required marker state")
        if holdout_packet.is_file() and read_json(holdout_packet) != read_json(holdout_external):
            raise ValueError("holdout markers differ")
        holdout_marker = read_json(holdout_external)
        development = read_json(packet_dir / "development.v1.json")
        if (
            holdout_marker.get("schema") != "s2a.holdout-open.v1"
            or holdout_marker.get("strategy_id") != "S-2A"
            or holdout_marker.get("one_run_id") != one_run_id
            or holdout_marker.get("freeze_commit") != freeze_commit
            or holdout_marker.get("champion_trial_id")
            != development.get("eligible_champion_trial_id")
            or holdout_marker.get("development_sha256")
            != hashlib.sha256(canonical_bytes(development)).hexdigest()
            or holdout_marker.get("holdout_source_plan_sha256")
            != hashlib.sha256(canonical_bytes(holdout_expected)).hexdigest()
        ):
            raise ValueError("holdout marker differs from recomputed development state")
    elif holdout_packet.exists() or holdout_external.exists():
        raise ValueError("unopened holdout has an open marker")


def verify(packet_dir: Path, raw_root: Path) -> JsonObject:
    protocol = read_json(packet_dir / "protocol.v1.json")
    freeze = read_json(packet_dir / "freeze.v1.json")
    result = read_json(packet_dir / "result.v1.json")
    manifest = read_json(packet_dir / "source_manifest.v1.json")
    if protocol.get("schema") != "s2a.protocol.v1":
        raise ValueError("unexpected protocol schema")
    if freeze.get("schema") != "s2a.freeze.v1":
        raise ValueError("unexpected freeze schema")
    if result.get("schema") != "s2a.result.v1":
        raise ValueError("unexpected result schema")
    if manifest.get("schema") != "s2a.source-manifest.v1":
        raise ValueError("unexpected manifest schema")
    required_files = set(BASE_PACKET_FILES)
    failure = result.get("failure")
    failure_stage = failure.get("stage") if isinstance(failure, dict) else None
    start_marker = packet_dir / "RUN_STARTED.v1.json"
    if start_marker.exists():
        required_files.add("RUN_STARTED.v1.json")
    elif not (
        result.get("run_status") == "TERMINAL_MEASUREMENT_FAILURE"
        and failure_stage == "PACKET_START_MARKER"
    ):
        raise ValueError("packet start marker is missing outside its terminal failure state")
    holdout_marker = packet_dir / "HOLDOUT_OPENED.v1.json"
    if holdout_marker.exists():
        required_files.add("HOLDOUT_OPENED.v1.json")
    elif bool(manifest.get("holdout_opened")) and not (
        result.get("run_status") == "TERMINAL_HOLDOUT_MEASUREMENT_FAILURE"
        and failure_stage == "HOLDOUT_MARKER"
    ):
        raise ValueError("packet holdout marker is missing outside its terminal failure state")
    if result.get("holdout") is not None:
        required_files.add("holdout.v1.json")
    packet_checks = verify_packet_checksums(packet_dir, required_files)
    manifest_report = verify_manifest(raw_root, manifest, protocol)
    verify_numeric_result(result, protocol)
    verify_evidence_gate_law(packet_dir, protocol, result)
    verify_result_artifact_binding(packet_dir, result)
    verify_cross_state(result, manifest)
    verify_marker_agreement(packet_dir, raw_root, result, manifest, protocol, freeze)
    frozen_files = freeze.get("frozen_files")
    if not isinstance(frozen_files, dict) or set(frozen_files) != FROZEN_SOURCE_FILES:
        raise ValueError("freeze inventory missing")
    for relative, digest in frozen_files.items():
        if sha256_file(packet_dir / str(relative)) != digest:
            raise ValueError(f"frozen digest mismatch for {relative}")
    return {
        "schema": "s2a.verification.v1",
        "status": "PASS",
        "packet_checks": packet_checks,
        **manifest_report,
        "research_verdict": result["research_verdict"],
        "local_public_verdict": result["local_public_verdict"],
        "capital_verdict": result["capital_verdict"],
        "archive_members_reopened_by_verifier": 0,
        "economics_recomputed_by_verifier": False,
    }


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description=__doc__)
    argument_parser.add_argument("--raw-root", required=True, type=Path)
    return argument_parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    packet_dir = Path(__file__).resolve().parent
    try:
        report = verify(packet_dir, arguments.raw_root.resolve())
    except BaseException as error:
        print(f"S2A_VERIFY_FAIL {type(error).__name__}: {error}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
