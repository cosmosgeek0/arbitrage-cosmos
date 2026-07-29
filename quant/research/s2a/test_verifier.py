from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from research.s2a import verifier as subject


def write_json(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def frozen_protocol() -> dict[str, object]:
    return json.loads((Path(__file__).parent / "protocol.v1.json").read_text())


def test_parse_checksum_file_binds_unique_basenames(tmp_path: Path) -> None:
    path = tmp_path / "SHA256SUMS"
    path.write_text(f"{'a' * 64}  result.v1.json\n", encoding="utf-8")
    assert subject.parse_checksum_file(path) == {"result.v1.json": "a" * 64}
    path.write_text(f"{'a' * 64}  ../result.v1.json\n", encoding="utf-8")
    with pytest.raises(ValueError, match="basenames"):
        subject.parse_checksum_file(path)


def test_verify_packet_checksums_detects_change(tmp_path: Path) -> None:
    artifact = tmp_path / "result.v1.json"
    artifact.write_text("{}\n", encoding="utf-8")
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    (tmp_path / "SHA256SUMS").write_text(f"{digest}  result.v1.json\n", encoding="utf-8")
    assert subject.verify_packet_checksums(tmp_path) == 1
    artifact.write_text('{"changed":true}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="checksum mismatch"):
        subject.verify_packet_checksums(tmp_path)


def test_verify_packet_checksums_requires_exact_inventory(tmp_path: Path) -> None:
    artifact = tmp_path / "result.v1.json"
    artifact.write_text("{}\n", encoding="utf-8")
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    (tmp_path / "SHA256SUMS").write_text(
        f"{digest}  result.v1.json\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="inventory"):
        subject.verify_packet_checksums(
            tmp_path,
            {"result.v1.json", "development.v1.json"},
        )


def complete_result() -> dict[str, object]:
    result: dict[str, object] = {
        "run_status": "COMPLETE",
        "research_verdict": "NO_GO",
        "local_public_verdict": "NO_GO",
        "program_wide_external_multiplicity": "UNMEASURED",
        "capital_verdict": "NO_GO",
        "authority": "NONE",
        "effects": {
            "ui": False,
            "canonical": False,
            "host": False,
            "provider": False,
            "private": False,
            "order": False,
            "transfer": False,
            "withdrawal": False,
            "money_usd": 0,
        },
        "development": {
            "eligible_for_holdout": False,
            "candidate_hours": 6000,
            "active_round_trips": 100,
            "active_weeks": 20,
            "distinct_idiosyncratic_symbols": 8,
            "max_realized_drawdown_fraction_of_1000": 0.1,
            "base_familywise_bonferroni_lower_usd_per_1000": -2.0,
            "centered_block_one_sided_p": 0.1,
            "holm_adjusted_p": 0.2,
            "white_reality_check_p": 0.3,
            "net_usd_per_1000": {
                "gross": 10.0,
                "base": 2.0,
                "stress": -2.0,
                "severe": -5.0,
            },
            "base_interval_95_usd_per_1000": {"lower": -1.0, "upper": 4.0},
            "public_capacity_proxy_usd": {
                "observations": 100,
                "minimum": 1000.0,
                "p05": 2000.0,
                "median": 5000.0,
            },
            "development_gates": {},
            "pbo": {"role": "DIAGNOSTIC_ONLY", "pbo": 0.5},
        },
        "holdout_state": "SEALED_UNOPENED_DEVELOPMENT_GATES_FAILED",
        "holdout": None,
    }
    development = result["development"]
    assert isinstance(development, dict)
    development["development_gates"] = subject.development_gate_values(
        frozen_protocol(),
        development,
        float(development["white_reality_check_p"]),
    )
    return result


def test_verify_numeric_result_accepts_honest_no_go() -> None:
    subject.verify_numeric_result(complete_result(), frozen_protocol())


def test_verify_numeric_result_rejects_nonfinite_economics() -> None:
    result = complete_result()
    result["development"]["net_usd_per_1000"]["base"] = float("inf")  # type: ignore[index]
    with pytest.raises(ValueError, match="nonnumeric"):
        subject.verify_numeric_result(result, frozen_protocol())


def test_verify_numeric_result_rejects_authority_widening() -> None:
    result = complete_result()
    result["capital_verdict"] = "GO"
    with pytest.raises(ValueError, match="authority"):
        subject.verify_numeric_result(result, frozen_protocol())


def test_local_go_must_remain_program_wide_unmeasured() -> None:
    result = complete_result()
    result["local_public_verdict"] = "GO"
    result["research_verdict"] = "GO"
    with pytest.raises(ValueError, match="verdict law"):
        subject.verify_numeric_result(result, frozen_protocol())


def test_development_pass_cannot_hide_holdout() -> None:
    result = complete_result()
    development = result["development"]
    assert isinstance(development, dict)
    development["eligible_for_holdout"] = True
    development["net_usd_per_1000"]["stress"] = 1.0
    development["base_interval_95_usd_per_1000"]["lower"] = 0.5
    development["base_familywise_bonferroni_lower_usd_per_1000"] = 0.25
    development["holm_adjusted_p"] = 0.01
    development["white_reality_check_p"] = 0.01
    development["development_gates"] = subject.development_gate_values(
        frozen_protocol(),
        development,
        float(development["white_reality_check_p"]),
    )
    with pytest.raises(ValueError, match="measured holdout"):
        subject.verify_numeric_result(result, frozen_protocol())


def test_fabricated_positive_gates_cannot_mint_local_go() -> None:
    result = complete_result()
    development = result["development"]
    assert isinstance(development, dict)
    genuine = subject.development_gate_values(
        frozen_protocol(),
        development,
        float(development["white_reality_check_p"]),
    )
    development["eligible_for_holdout"] = True
    development["development_gates"] = dict.fromkeys(genuine, True)
    result["research_verdict"] = "UNMEASURED"
    result["local_public_verdict"] = "GO"
    with pytest.raises(ValueError, match="numeric thresholds"):
        subject.verify_numeric_result(result, frozen_protocol())


def test_artifact_gate_reconstruction_accepts_trials_without_embedded_white(
    tmp_path: Path,
) -> None:
    protocol = frozen_protocol()
    trials: dict[str, object] = {}
    for trial_id, (z_threshold, volume_threshold, hold_hours) in subject.frozen_trial_parameters(
        protocol
    ).items():
        summary: dict[str, object] = {
            "trial_id": trial_id,
            "z_threshold": z_threshold,
            "volume_threshold": volume_threshold,
            "hold_hours": hold_hours,
            "candidate_hours": 6000,
            "active_round_trips": 100,
            "active_weeks": 20,
            "distinct_idiosyncratic_symbols": 8,
            "net_usd_per_1000": {
                "gross": 10.0,
                "base": 2.0,
                "stress": -2.0,
                "severe": -5.0,
            },
            "base_interval_95_usd_per_1000": {"lower": -1.0, "upper": 4.0},
            "base_familywise_bonferroni_lower_usd_per_1000": -2.0,
            "centered_block_one_sided_p": 0.1,
            "holm_adjusted_p": 0.2,
            "max_realized_drawdown_fraction_of_1000": 0.1,
            "public_capacity_proxy_usd": {
                "observations": 100,
                "minimum": 1000.0,
                "p05": 2000.0,
                "median": 5000.0,
            },
        }
        gates = subject.development_gate_values(protocol, summary, 0.3)
        summary["development_gates"] = gates
        summary["all_development_gates_pass"] = all(gates.values())
        trials[trial_id] = summary
    reporting = min(trials)
    development = {
        "trial_count": 12,
        "white_reality_check_p": 0.3,
        "trials": trials,
        "reporting_champion_trial_id": reporting,
        "eligible_trial_ids": [],
        "eligible_champion_trial_id": None,
        "all_development_gates_pass": False,
        "pbo_affects_verdict": False,
        "external_program_wide_multiplicity": "UNMEASURED",
        "pbo": {"role": "DIAGNOSTIC_ONLY", "splits": 924},
    }
    write_json(tmp_path / "development.v1.json", development)
    subject.verify_evidence_gate_law(
        tmp_path,
        protocol,
        {"development": {"present": True}},
    )


def test_cross_state_rejects_opened_holdout_after_development_failure() -> None:
    with pytest.raises(ValueError, match="opened holdout contradicts"):
        subject.verify_cross_state(
            complete_result(),
            {"holdout_opened": True, "rows": []},
        )


def test_terminal_failure_requires_null_development() -> None:
    result = complete_result()
    result["run_status"] = "TERMINAL_MEASUREMENT_FAILURE"
    result["research_verdict"] = "UNMEASURED"
    result["local_public_verdict"] = "UNMEASURED"
    result["holdout_state"] = "SEALED_UNOPENED_TERMINAL_MEASUREMENT_FAILURE"
    with pytest.raises(ValueError, match="unmeasured"):
        subject.verify_numeric_result(result, frozen_protocol())
    result["development"] = None
    subject.verify_numeric_result(result, frozen_protocol())


def test_verify_unopened_holdout_has_no_body(tmp_path: Path) -> None:
    protocol = {
        "sources": {"root": "https://example.invalid"},
        "universe": {
            "factor_symbol": "BTCUSDT",
            "idiosyncratic_symbols": ["ETHUSDT"],
        },
        "window": {
            "development_months": ["2026-03"],
            "holdout_months": ["2026-04"],
        },
    }
    rows: list[dict[str, object]] = []
    for symbol in ("BTCUSDT", "ETHUSDT"):
        for dataset in subject.SOURCE_DATASETS:
            development_relative = subject.archive_relative_path(
                dataset,
                symbol,
                "2026-03",
            )
            rows.append(
                {
                    "dataset": dataset,
                    "symbol": symbol,
                    "month": "2026-03",
                    "phase": "DEVELOPMENT",
                    "relative_path": development_relative,
                    "zip_url": f"https://example.invalid/{development_relative}",
                    "checksum_url": (f"https://example.invalid/{development_relative}.CHECKSUM"),
                    "status": "NOT_ACQUIRED_TERMINAL_FAILURE",
                    "member_opened": False,
                }
            )
            holdout_relative = subject.archive_relative_path(
                dataset,
                symbol,
                "2026-04",
            )
            rows.append(
                {
                    "dataset": dataset,
                    "symbol": symbol,
                    "month": "2026-04",
                    "phase": "HOLDOUT",
                    "relative_path": holdout_relative,
                    "zip_url": f"https://example.invalid/{holdout_relative}",
                    "checksum_url": f"https://example.invalid/{holdout_relative}.CHECKSUM",
                    "status": "SEALED_UNOPENED",
                    "member_opened": False,
                    "declared_zip_sha256": None,
                    "received_zip_sha256": None,
                    "checksum_sha256": None,
                    "zip_bytes": None,
                    "checksum_bytes": None,
                    "csv_member": None,
                }
            )
    manifest = {
        "rows": rows,
        "expected_archive_pairs": len(rows),
        "expected_http_objects": 2 * len(rows),
        "acquired_archive_pairs": 0,
        "acquired_http_objects": 0,
        "opened_archive_members": 0,
        "holdout_opened": False,
    }
    report = subject.verify_manifest(tmp_path, manifest, protocol)
    assert report["sealed_holdout_rows"] == 6


def test_verify_unopened_holdout_rejects_present_archive(tmp_path: Path) -> None:
    protocol = {
        "sources": {"root": "https://example.invalid"},
        "universe": {
            "factor_symbol": "BTCUSDT",
            "idiosyncratic_symbols": [],
        },
        "window": {
            "development_months": [],
            "holdout_months": ["2026-04"],
        },
    }
    rows = []
    for dataset in subject.SOURCE_DATASETS:
        relative = subject.archive_relative_path(dataset, "BTCUSDT", "2026-04")
        rows.append(
            {
                "dataset": dataset,
                "symbol": "BTCUSDT",
                "month": "2026-04",
                "phase": "HOLDOUT",
                "relative_path": relative,
                "zip_url": f"https://example.invalid/{relative}",
                "checksum_url": f"https://example.invalid/{relative}.CHECKSUM",
                "status": "SEALED_UNOPENED",
                "member_opened": False,
                "declared_zip_sha256": None,
                "received_zip_sha256": None,
                "checksum_sha256": None,
                "zip_bytes": None,
                "checksum_bytes": None,
                "csv_member": None,
            }
        )
    archive = tmp_path / "archives" / subject.archive_relative_path("klines", "BTCUSDT", "2026-04")
    archive.parent.mkdir(parents=True)
    archive.write_bytes(b"unexpected")
    manifest = {
        "rows": rows,
        "expected_archive_pairs": len(rows),
        "expected_http_objects": 2 * len(rows),
        "acquired_archive_pairs": 0,
        "acquired_http_objects": 0,
        "opened_archive_members": 0,
        "holdout_opened": False,
    }
    with pytest.raises(ValueError, match="unexpectedly exist"):
        subject.verify_manifest(tmp_path, manifest, protocol)


def test_read_json_requires_object(tmp_path: Path) -> None:
    path = tmp_path / "x.json"
    write_json(path, [])
    with pytest.raises(ValueError, match="object"):
        subject.read_json(path)
