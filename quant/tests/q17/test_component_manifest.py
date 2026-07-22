from __future__ import annotations

import copy
import hashlib
import os
import shutil
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes
from quant_edge.final_proof import components
from quant_edge.final_proof.components import (
    ComponentManifestError,
    build_component_manifest,
    validate_component_manifest,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


def _copy_file(source_root: Path, target_root: Path, relative_path: str) -> None:
    source = source_root / relative_path
    target = target_root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def _component_mirror(tmp_path: Path) -> Path:
    mirror = tmp_path / "repo"
    mirror.mkdir()
    paths = {"quant/DIRECTIVE_INPUTS.lock", "quant/TASKS/Q17.md"}
    source_paths: set[str] = set()
    for phase in components._phase_specs():
        paths.update(
            {
                f"quant/RECEIPTS/{phase.phase}.md",
                f"quant/RECEIPTS/{phase.phase}_ACCEPTANCE.md",
                phase.primary_evidence.relative_path,
            }
        )
        if phase.source is not None:
            source_paths.add(phase.source.relative_path)
    for relative_path in sorted(paths):
        _copy_file(REPO_ROOT, mirror, relative_path)
    for relative_path in sorted(source_paths):
        shutil.copytree(REPO_ROOT / relative_path, mirror / relative_path)
    return mirror


def _artifact(
    relative_path: str,
    raw: bytes,
    *,
    media_type: str = "text/markdown",
    schema: str = "TestTextV1",
    version: int | None = 1,
) -> components._ArtifactSpec:
    return components._ArtifactSpec(
        "test.artifact.v1",
        relative_path,
        len(raw),
        hashlib.sha256(raw).hexdigest(),
        media_type,
        schema,
        version,
    )


def _custom_root(tmp_path: Path, relative_path: str, raw: bytes) -> tuple[Path, os.stat_result]:
    root = tmp_path / "root"
    root.mkdir()
    target = root / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    return components._require_repo_root(root)


def _set_q17_task_status(root: Path, status_line: str) -> bytes:
    task = root / "quant/TASKS/Q17.md"
    lines = task.read_text().splitlines()
    status_indexes = [index for index, line in enumerate(lines) if line.startswith("Status:")]
    assert len(status_indexes) == 1
    lines[status_indexes[0]] = status_line
    raw = ("\n".join(lines) + "\n").encode()
    task.write_bytes(raw)
    return raw


def test_manifest_covers_every_phase_and_preserves_final_truth() -> None:
    manifest = build_component_manifest(REPO_ROOT)
    rows = cast(list[dict[str, object]], manifest["components"])

    assert [row["phase"] for row in rows] == [f"Q{index:02}" for index in range(18)]
    corrected_indices = {2, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16}
    assert all(
        row["implementationState"]
        == (
            "CORRECTION_IMPLEMENTED_PENDING_INDEPENDENT_VERIFICATION"
            if index in corrected_indices
            else "ACCEPTED"
        )
        for index, row in enumerate(rows[:17])
    )

    money_truth_expectations = {
        2: {
            "correctionId": "MONEY_TRUTH_Q02_INSTRUMENT_UNIT_IDENTITY",
            "currentPrimarySha256": (
                "01b648ee6ae5f9d4dbba345b775d4f19b4d1ce2276036d9161554c73ab8f49ba"
            ),
            "currentSourceSha256": (
                "b67b951d1f00299d45e5a7c94036293cee1e1b6dd11fb0eef6f5d478534dcaa9"
            ),
            "fixCommits": ["039c3866619c3e3af9533c651284af32a7bc114d"],
            "correctionRefs": ["Q-052"],
            "historicalPrimarySha256": (
                "01b648ee6ae5f9d4dbba345b775d4f19b4d1ce2276036d9161554c73ab8f49ba"
            ),
            "historicalSourceSha256": (
                "9d1429b33176e4f8726032243741af9e532ca36798610e08ea129eccc35bd64c"
            ),
        },
        5: {
            "correctionId": "MONEY_TRUTH_Q05_DIRECTIONAL_LABEL_ECONOMICS",
            "currentPrimarySha256": (
                "c82cf92d68bebcfbc5d818de667b9ca50714e7cffbeac331fe06176899c6709e"
            ),
            "currentSourceSha256": (
                "d8c5709d1c1caace7c32e9d58c32648e940b14804ff18aaca5245ec6f538bed7"
            ),
            "fixCommits": [
                "42e431fbc8ee8823cba826f759737ce3b3f52465",
                "039c3866619c3e3af9533c651284af32a7bc114d",
            ],
            "correctionRefs": [],
            "historicalPrimarySha256": (
                "f36a9b089fe2c935c08f6f67e8b7debcf40b8d67cde46ae73271835b725afe47"
            ),
            "historicalSourceSha256": (
                "fb3fc6571a45e330499c52000672c9f6e6819f3b12e03f42506546e85b31fe12"
            ),
        },
        8: {
            "correctionId": "MONEY_TRUTH_Q08_EXECUTABLE_BASIS_ECONOMICS",
            "currentPrimarySha256": (
                "3a2a912ccecdd9fb893d798c38b4cc40d2f4821465fd2d3e82987b7449c654a8"
            ),
            "currentSourceSha256": (
                "7182fa0098e8c96ac6e03de47e01d89d3932fcd3479f1e2b1d596e08252c4c03"
            ),
            "fixCommits": [
                "19f674a35944f1f3fdd4fdafd396fba9df6fd255",
                "42e431fbc8ee8823cba826f759737ce3b3f52465",
                "039c3866619c3e3af9533c651284af32a7bc114d",
            ],
            "correctionRefs": ["FIX-017", "Q-076"],
            "historicalPrimarySha256": (
                "d2054e47d0050ef521d91f653b9ab6f60411a2d2f0633933c7ec65e76145525b"
            ),
            "historicalSourceSha256": (
                "0224276b1a356696eab857aea38d40d8956491761a9e0012a0298cb9e3448d74"
            ),
        },
    }
    for index, expected in money_truth_expectations.items():
        row = rows[index]
        correction = cast(dict[str, object], row["postAcceptanceCorrection"])
        current_primary = cast(dict[str, object], correction["currentPrimaryEvidence"])
        current_source = cast(dict[str, object], correction["currentSourceRoot"])
        provenance = cast(dict[str, object], correction["currentBytesProvenance"])
        source_root = cast(dict[str, object], row["sourceRoot"])
        evidence_refs = cast(list[dict[str, object]], row["evidenceRefs"])

        assert correction["acceptanceState"] == "NOT_ACCEPTED"
        assert correction["correctionId"] == expected["correctionId"]
        assert correction["historicalReceipts"] == "DOES_NOT_ATTEST_CORRECTED_BYTES"
        assert correction["implementationCommit"] == components.PENDING
        assert correction["implementationTree"] == components.PENDING
        assert correction["verificationState"] == ("PENDING_INDEPENDENT_EXACT_COMMIT_VERIFICATION")
        assert source_root["sha256"] == expected["historicalSourceSha256"]
        assert evidence_refs[2]["sha256"] == expected["historicalPrimarySha256"]
        assert (
            correction["historicalAcceptedPrimaryEvidenceSha256"]
            == (expected["historicalPrimarySha256"])
        )
        assert current_source["sha256"] == expected["currentSourceSha256"]
        assert current_primary["sha256"] == expected["currentPrimarySha256"]
        current_primary_raw = (REPO_ROOT / cast(str, current_primary["path"])).read_bytes()
        assert current_primary["bytes"] == len(current_primary_raw)
        assert current_primary["sha256"] == hashlib.sha256(current_primary_raw).hexdigest()
        assert provenance == {
            "correctionRefs": expected["correctionRefs"],
            "directorIntegrationCommit": "5f887cf27ce246d80b7fc553eed470b015976963",
            "directorIntegrationTree": "813a383df420e318dc97522c860d6b1e6b99aab4",
            "fixCommits": expected["fixCommits"],
            "tipCommit": "039c3866619c3e3af9533c651284af32a7bc114d",
            "tipTree": "6724c8fa53fb74df5ef840d37ca3de8364b7c64f",
        }
        dispositions = cast(list[str], row["dispositions"])
        assert "CURRENT_CORRECTED_BYTES_NOT_ACCEPTED" in dispositions
        assert "NOT_ACCEPTED" in dispositions
        assert "EXACT_COMMIT_ACCEPTED" not in dispositions
        assert "CURRENT_BYTES_VERIFIED" not in dispositions
        for correction_ref in cast(list[str], expected["correctionRefs"]):
            assert f"{correction_ref}_IMPLEMENTED_PENDING_INDEPENDENT_VERIFICATION" in dispositions
            assert f"{correction_ref}_COMMIT_AND_TREE_PENDING_NOT_EMBEDDED" in cast(
                list[str], row["limitations"]
            )
        assert row["evidencePosture"] == (
            "HISTORICAL_ACCEPTANCE_WITH_POST_ACCEPTANCE_CORRECTION_PENDING"
        )
        assert cast(dict[str, object], row["evidenceSeal"])["status"] == (
            "HISTORICAL_RECEIPT_BYTES_VERIFIED_CORRECTION_NOT_ATTESTED"
        )
        assert f"POST_ACCEPTANCE_CORRECTION_NOT_ATTESTED_BY_Q{index:02}_RECEIPTS" in cast(
            list[str], row["limitations"]
        )

    real_gap_expectations = {
        6: {
            "correctionId": "REAL_GAP_Q06_FEATURE_DIAGNOSTICS",
            "correctionRefs": ["Q-070", "FINAL_HUNT_Q06_NUMERICAL_DOMAIN_BOUNDS", "QUANT_HUNT_19"],
            "currentFileCount": 9,
            "currentSourceSha256": (
                "01714a2e66f519f7cc0137212b9eb50d7dc8d8bd583856bf9178e6eaa62c527e"
            ),
            "historicalSourceSha256": (
                "c005edec4d0e3ec20263a8c026fca15620e918bc06f6304b3fe528d7707c5d3e"
            ),
        },
        7: {
            "correctionId": "REAL_GAP_Q07_ACTIVITY_POINT_PROCESS",
            "correctionRefs": [
                "Q-073",
                "Q-074",
                "FINAL_HUNT_Q07_CROSS_STREAM_ORDERING",
                "QUANT_HUNT_09",
            ],
            "currentFileCount": 9,
            "currentSourceSha256": (
                "a05dec57e85f1674c9fc88587050dbecc712c31fa93df44d61bee76612802564"
            ),
            "historicalSourceSha256": (
                "cd50265ea4e986b32c07f5766b1de3b904a28a136450af8888f7712e36a65798"
            ),
        },
        9: {
            "correctionId": "REAL_GAP_Q09_OOD_CHALLENGERS",
            "correctionRefs": [
                "Q-083",
                "FINAL_HUNT_Q09_TRUTH_AND_NUMERICAL_BOUNDS",
                "QUANT_HUNT_08",
                "QUANT_HUNT_10",
                "QUANT_HUNT_19",
            ],
            "currentFileCount": 14,
            "currentSourceSha256": (
                "0a99fd9a9a1609d2682c1728fec33d01dffe3cd6dd3dc98e40cda74fca9f37ae"
            ),
            "historicalSourceSha256": (
                "89b8e3747755f595d6adbb2a94e4c0d88b4eb0882a3ec5fec240a8dac3a697ae"
            ),
        },
        10: {
            "correctionId": "REAL_GAP_Q10_DIAGNOSTICS_FOCUS_BUDGET",
            "correctionRefs": ["Q-070", "Q-080", "Q10_CPU_INVARIANT_GENERATION"],
            "currentFileCount": 11,
            "currentSourceSha256": (
                "809e7e7ddbbc94769887816e39fae6dc99bb0c944fa0fc24a6fcd6ccc1d0b22a"
            ),
            "historicalSourceSha256": (
                "7ffde23cbe6d07b6b9cef99aab27151e9069b5ffffd254e32f8f3586ebeefb7a"
            ),
        },
        11: {
            "correctionId": "REAL_GAP_Q11_PASSIVE_FILL_SURVIVAL",
            "correctionRefs": [
                "L-065",
                "FINAL_HUNT_Q11_SURVIVAL_SUPPORT_AND_IDENTITY",
                "QUANT_HUNT_13",
                "QUANT_HUNT_14",
            ],
            "currentFileCount": 9,
            "currentSourceSha256": (
                "88bf3bf468b5d20700b2fff5c263aebf02fcce85df4f7893b2d42cfc99e24837"
            ),
            "historicalSourceSha256": (
                "0f635f5e6f3924fc6f0e071dfd82b49a724b06b4163cfc6a1b0e214e2963642c"
            ),
        },
        12: {
            "correctionId": "REAL_GAP_Q12_REGIME_MIXTURE",
            "correctionRefs": [
                "Q-084",
                "FINAL_HUNT_Q12_SPLIT_AND_PREDICTION_LINEAGE",
                "QUANT_HUNT_07",
                "Q12_LINEAGE_CASCADE_FROM_QUANT_HUNT_01",
            ],
            "currentFileCount": 8,
            "currentSourceSha256": (
                "f2e9c45b7941f0c168838d63eeaf6630a7b9a8c5d9ee749b74928e7e89dfbc9f"
            ),
            "historicalSourceSha256": (
                "0e933737922c1d6255b90e1be275bdd47f34318e239d549caf051246fa8c449d"
            ),
        },
        14: {
            "correctionId": "REAL_GAP_Q14_FEATURE_DIAGNOSTICS",
            "correctionRefs": [
                "Q-070",
                "FINAL_HUNT_Q14_VALIDATION_TRUTH",
                "QUANT_HUNT_01",
                "QUANT_HUNT_03",
                "QUANT_HUNT_04",
                "QUANT_HUNT_07",
                "QUANT_HUNT_12",
            ],
            "currentFileCount": 13,
            "currentSourceSha256": (
                "704fd290dc0670827b96dc23ef2344a3126dd2994d0a9b0899422c612f8be992"
            ),
            "historicalSourceSha256": (
                "8c4482643582c9e9fbd7be3bd470c4d106717955bd10ad80854df9314e6b7356"
            ),
        },
        15: {
            "correctionId": "REAL_GAP_Q15_RECORDED_CALIBRATION",
            "correctionRefs": [
                "L-068",
                "L-110",
                "FINAL_HUNT_Q15_REGISTRY_EXACTNESS",
                "QUANT_HUNT_11",
                "QUANT_HUNT_21",
                "Q15_REGENERATION_CASCADE_FROM_Q10_CURRENT_EVIDENCE",
            ],
            "currentFileCount": 9,
            "currentSourceSha256": (
                "e6af382eff43065bd18a8c7cd10f208acfea0c754574647d7c5fa0a30bf72ca9"
            ),
            "historicalSourceSha256": (
                "ccb0a8dd86e8b6548728d11bb3b28db29ce0e3e8e6d3288653375ef4d39af262"
            ),
        },
        16: {
            "correctionId": "Q16_CUMULATIVE_POST_ACCEPTANCE_CORRECTION",
            "correctionRefs": [
                "RB13_QUANT_INFERENCE_WORKER_ISOLATION",
                "Q-070",
                "QUANT_HUNT_20",
                "QUANT_HUNT_21",
                "Q16_REGENERATION_CASCADE_FROM_Q12_CURRENT_EVIDENCE",
                "Q16_REGENERATION_CASCADE_FROM_Q10_CURRENT_EVIDENCE",
            ],
            "currentFileCount": 8,
            "currentSourceSha256": (
                "f4e1ed59e26bd3508b152223a45cd4f876d0b2b4a439f6997a651899d0b22b7c"
            ),
            "historicalSourceSha256": (
                "6c67b5bf2488e3b13e5c5fc72a2b613d0ed74fb00a14f635ab71444f7c6d321a"
            ),
        },
    }
    for index, gap_expected in real_gap_expectations.items():
        row = rows[index]
        correction = cast(dict[str, object], row["postAcceptanceCorrection"])
        current_primary = cast(dict[str, object], correction["currentPrimaryEvidence"])
        current_source = cast(dict[str, object], correction["currentSourceRoot"])
        provenance = cast(dict[str, object], correction["currentBytesProvenance"])
        source_root = cast(dict[str, object], row["sourceRoot"])
        evidence_refs = cast(list[dict[str, object]], row["evidenceRefs"])

        assert correction["acceptanceState"] == "NOT_ACCEPTED"
        assert correction["correctionId"] == gap_expected["correctionId"]
        assert correction["historicalReceipts"] == "DOES_NOT_ATTEST_CORRECTED_BYTES"
        assert correction["implementationCommit"] == components.PENDING
        assert correction["implementationTree"] == components.PENDING
        assert correction["verificationState"] == ("PENDING_INDEPENDENT_EXACT_COMMIT_VERIFICATION")
        assert provenance == {
            "correctionRefs": gap_expected["correctionRefs"],
            "identityPosture": "CURRENT_BYTES_PINNED_EXACT_COMMIT_PENDING",
        }
        assert source_root["sha256"] == gap_expected["historicalSourceSha256"]
        assert current_source["fileCount"] == gap_expected["currentFileCount"]
        assert current_source["sha256"] == gap_expected["currentSourceSha256"]
        assert correction["historicalAcceptedPrimaryEvidenceSha256"] == evidence_refs[2]["sha256"]
        current_primary_raw = (REPO_ROOT / cast(str, current_primary["path"])).read_bytes()
        assert current_primary["bytes"] == len(current_primary_raw)
        assert current_primary["sha256"] == hashlib.sha256(current_primary_raw).hexdigest()
        dispositions = cast(list[str], row["dispositions"])
        assert f"Q{index:02}_POST_ACCEPTANCE_CORRECTION_IMPLEMENTED" in dispositions
        assert "CURRENT_CORRECTED_BYTES_NOT_ACCEPTED" in dispositions
        assert "NOT_ACCEPTED" in dispositions
        assert "EXACT_COMMIT_ACCEPTED" not in dispositions
        assert "CURRENT_BYTES_VERIFIED" not in dispositions
        for correction_ref in cast(list[str], gap_expected["correctionRefs"]):
            assert f"{correction_ref}_IMPLEMENTED_PENDING_INDEPENDENT_VERIFICATION" in dispositions
            assert f"{correction_ref}_COMMIT_AND_TREE_PENDING_NOT_EMBEDDED" in cast(
                list[str], row["limitations"]
            )
        assert row["evidencePosture"] == (
            "HISTORICAL_ACCEPTANCE_WITH_POST_ACCEPTANCE_CORRECTION_PENDING"
        )
        assert cast(dict[str, object], row["evidenceSeal"])["status"] == (
            "HISTORICAL_RECEIPT_BYTES_VERIFIED_CORRECTION_NOT_ATTESTED"
        )
        assert f"POST_ACCEPTANCE_CORRECTION_NOT_ATTESTED_BY_Q{index:02}_RECEIPTS" in cast(
            list[str], row["limitations"]
        )

    assert rows[16]["implementationState"] == (
        "CORRECTION_IMPLEMENTED_PENDING_INDEPENDENT_VERIFICATION"
    )
    assert rows[16]["identities"] == {
        "acceptanceCommit": "4ac05802244a194639865a4b615ee2af13dce4e2",
        "acceptanceTree": "eb367affe1952093be09d8ec2d1d1344ae905453",
        "implementationCommit": "b3d8cedece8cf3a9f546c60016beae442f85f160",
        "implementationTree": "a35b888041cbdd4ea56accd29a490a8ce043cef0",
    }
    assert rows[16]["sourceRoot"] == {
        "fileCount": 8,
        "path": "quant/src/quant_edge/inference",
        "sealSchema": "Q17SourceTreeSealV1",
        "sha256": "6c67b5bf2488e3b13e5c5fc72a2b613d0ed74fb00a14f635ab71444f7c6d321a",
    }
    q16_correction = cast(dict[str, object], rows[16]["postAcceptanceCorrection"])
    assert q16_correction["acceptanceState"] == "NOT_ACCEPTED"
    assert q16_correction["correctionId"] == "Q16_CUMULATIVE_POST_ACCEPTANCE_CORRECTION"
    assert q16_correction["historicalAcceptedServiceSha256"] == (
        "9531d45a513d28c08945adffbb51f149dc3e27afbc897f09bf66d660bf43f59f"
    )
    assert q16_correction["historicalReceipts"] == "DOES_NOT_ATTEST_CORRECTED_BYTES"
    assert q16_correction["implementationCommit"] == components.PENDING
    assert q16_correction["implementationTree"] == components.PENDING
    assert q16_correction["verificationState"] == ("PENDING_INDEPENDENT_EXACT_COMMIT_VERIFICATION")
    current_source = cast(dict[str, object], q16_correction["currentSourceRoot"])
    current_service = cast(dict[str, object], q16_correction["currentServiceSource"])
    assert current_source["sha256"] == (
        components._POST_ACCEPTANCE_CORRECTIONS["Q16"].current_source.seal_sha256
    )
    service_raw = (REPO_ROOT / "quant/src/quant_edge/inference/service.py").read_bytes()
    assert current_service["bytes"] == len(service_raw)
    assert current_service["sha256"] == hashlib.sha256(service_raw).hexdigest()
    q16_dispositions = cast(list[str], rows[16]["dispositions"])
    assert "CURRENT_CORRECTED_BYTES_NOT_ACCEPTED" in q16_dispositions
    assert "NOT_ACCEPTED" in q16_dispositions
    assert "EXACT_COMMIT_ACCEPTED" not in q16_dispositions
    assert "CURRENT_BYTES_VERIFIED" not in q16_dispositions
    assert "POST_ACCEPTANCE_CORRECTION_NOT_ATTESTED_BY_Q16_RECEIPTS" in cast(
        list[str], rows[16]["limitations"]
    )
    assert rows[16]["evidenceSeal"] == {
        "acceptanceReceiptSha256": (
            "e2283973e496cd592e56df9d95a79d79dc197122f1937b89707c22a86d490828"
        ),
        "implementationReceiptSha256": (
            "b3b08998bfc3450de2b3502defca482cb6759f6cfe44a4cbb9f2e95d43fea5d6"
        ),
        "status": "HISTORICAL_RECEIPT_BYTES_VERIFIED_CORRECTION_NOT_ATTESTED",
    }
    assert all(
        row["postAcceptanceCorrection"] is None
        for index, row in enumerate(rows[:17])
        if index not in corrected_indices
    )
    assert rows[17]["postAcceptanceCorrection"] is None
    current_task = cast(dict[str, object], manifest["q17CurrentTask"])
    current_status = current_task["semanticStatus"]
    assert current_status in {
        "WORKING",
        "COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION",
    }
    expected_state = (
        "COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION"
        if current_status == "COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION"
        else "ACTIVATED_WORKING"
    )
    assert rows[17]["implementationState"] == expected_state
    assert rows[17]["integrationState"] == "NOT_CONFIGURED"
    assert rows[17]["identities"] == {
        "acceptanceCommit": components.PENDING,
        "acceptanceTree": components.PENDING,
        "implementationCommit": components.PENDING,
        "implementationTree": components.PENDING,
    }
    assert [rows[index]["owner"] for index in range(2, 17)] == [
        f"quant_edge.{name}"
        for name in (
            "lake",
            "bootstrap",
            "book",
            "labels",
            "features",
            "micro",
            "derivatives",
            "regime",
            "models",
            "survival",
            "ensemble",
            "deep",
            "validation",
            "registry_ops",
            "inference",
        )
    ]
    assert all(rows[index]["sourceRoot"] is not None for index in range(2, 17))
    assert rows[0]["sourceRoot"] is None
    assert rows[1]["sourceRoot"] is None
    assert rows[17]["sourceRoot"] is None
    assert manifest["baseCommit"] == components.CANONICAL_BASE
    assert manifest["protocolCommit"] == components.FROZEN_PROTOCOL_COMMIT
    assert manifest["q17Finalization"] == {
        "acceptanceCommitA17": components.PENDING,
        "implementationCommitC17": components.PENDING,
    }
    activation = cast(dict[str, object], manifest["q17Activation"])
    activation_task = cast(dict[str, object], activation["task"])
    current_evidence = cast(dict[str, object], current_task["evidence"])
    assert activation["semanticStatus"] == "WORKING_AT_ACTIVATION"
    assert activation["verificationPosture"] == ("HISTORICAL_COMMIT_PIN_NOT_CURRENT_WORKTREE_BYTES")
    assert activation_task["sha256"] == components.Q17_ACTIVATION_TASK_SHA256
    assert activation_task["bytes"] == components.Q17_ACTIVATION_TASK_BYTES
    assert (
        current_evidence["sha256"]
        == hashlib.sha256((REPO_ROOT / "quant/TASKS/Q17.md").read_bytes()).hexdigest()
    )
    assert rows[17]["evidenceRefs"] == [current_evidence]
    assert manifest["finalPosture"] == {
        "action": "ABSTAIN_UNKNOWN",
        "advisoryOnly": True,
        "calibration": "UNAVAILABLE_MODEL_OUTPUT",
        "currentUniverse": "UNKNOWN",
        "deep": "FAIL_DATA_INSUFFICIENT",
        "edge": "UNAVAILABLE",
        "eventRateTrace": "UNKNOWN",
        "integration": "NOT_CONFIGURED",
        "latencyTarget": "UNKNOWN",
        "model": "UNAVAILABLE_NONLOADABLE",
        "realLabels": "DATA_INSUFFICIENT",
    }


def test_manifest_pins_corrections_merges_and_documentary_conflict() -> None:
    manifest = build_component_manifest(REPO_ROOT)
    rows = {
        cast(str, row["phase"]): row
        for row in cast(list[dict[str, object]], manifest["components"])
    }

    assert len(cast(list[object], rows["Q08"]["corrections"])) == 2
    assert len(cast(list[object], rows["Q15"]["corrections"])) == 2
    assert rows["Q00"]["directorIntegrationCommits"] == []
    assert rows["Q13"]["directorIntegrationCommits"] == ["3ed8e38d65812e2eb8ed6eba19e4eb5084c253d1"]
    assert rows["Q15"]["directorIntegrationCommits"] == [
        "f54180c3a7d014e4d91a0c6b7dc5ea4c3d521754",
        "c070fdaf7dc568448212067dde5e1fb2ecc21356",
    ]
    assert manifest["documentaryConflicts"] == [
        {
            "acceptedArtifactPath": "quant/generated/q10/model_campaign.v1.json",
            "acceptedValue": 7,
            "disposition": "ACCEPTED_ARTIFACT_CONTROLS_DOCUMENTARY_VALUE_NOT_USED",
            "documentaryPath": "quant/RECEIPTS/Q10.md",
            "documentaryValue": 11,
            "field": "study_xgb_quantile:v1.bestTrialIndex",
            "id": "Q10_QUANTILE_BEST_INDEX",
        }
    ]
    assert "Q14_NOT_A_VALIDATION_OF_Q10_OR_Q11" in cast(list[str], rows["Q10"]["limitations"])
    assert manifest["externalDirectorEvidence"] == {
        "launchAcceptance": {
            "ancestryStatus": "NOT_Q_LANE_ANCESTOR",
            "commit": components.EXTERNAL_LAUNCH_ACCEPTANCE_COMMIT,
            "originBranch": "current-main",
            "phase": "Q00",
            "role": "D_LAUNCH_1_AUTHENTIC_LAUNCH_FILE_DIGEST_ACCEPTANCE",
        }
    }


def test_current_task_completion_is_exact_without_relabeling_activation(tmp_path: Path) -> None:
    mirror = _component_mirror(tmp_path)
    complete_raw = _set_q17_task_status(
        mirror,
        "Status: `COMPLETE — READY_FOR_INDEPENDENT_COMMIT_VERIFICATION`",
    )

    manifest = build_component_manifest(mirror)
    rows = cast(list[dict[str, object]], manifest["components"])
    activation = cast(dict[str, object], manifest["q17Activation"])
    current = cast(dict[str, object], manifest["q17CurrentTask"])
    current_evidence = cast(dict[str, object], current["evidence"])

    assert cast(dict[str, object], activation["task"])["sha256"] == (
        components.Q17_ACTIVATION_TASK_SHA256
    )
    assert current == {
        "evidence": {
            "artifactId": "q17.current-task.v1",
            "bytes": len(complete_raw),
            "mediaType": "text/markdown",
            "path": "quant/TASKS/Q17.md",
            "schema": "Q17TaskV1",
            "sha256": hashlib.sha256(complete_raw).hexdigest(),
            "version": 1,
        },
        "semanticStatus": "COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION",
    }
    assert rows[17]["evidenceRefs"] == [current_evidence]
    assert rows[17]["implementationState"] == ("COMPLETE_READY_FOR_INDEPENDENT_COMMIT_VERIFICATION")
    assert rows[17]["evidencePosture"] == "COMPOSITION_COMPLETE_PENDING_EXACT_C17"
    assert "NOT_ACCEPTED" in cast(list[str], rows[17]["dispositions"])
    assert rows[17]["identities"] == {
        "acceptanceCommit": components.PENDING,
        "acceptanceTree": components.PENDING,
        "implementationCommit": components.PENDING,
        "implementationTree": components.PENDING,
    }


def test_current_task_rejects_non_exact_status_and_heading(tmp_path: Path) -> None:
    mirror = _component_mirror(tmp_path)
    _set_q17_task_status(mirror, "Status: `DONE`")
    with pytest.raises(ComponentManifestError, match="allowed exact state"):
        build_component_manifest(mirror)

    task = mirror / "quant/TASKS/Q17.md"
    task.write_text(task.read_text().replace("# Q17 —", "# Not Q17 —", 1))
    with pytest.raises(ComponentManifestError, match="heading"):
        build_component_manifest(mirror)


def test_manifest_is_deterministic_and_strictly_validates() -> None:
    first = build_component_manifest(REPO_ROOT)
    second = build_component_manifest(REPO_ROOT)

    assert canonical_json_bytes(first) == canonical_json_bytes(second)
    assert validate_component_manifest(REPO_ROOT, copy.deepcopy(first)) == first


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("duplicate", "phases"),
        ("status", "accepted truth"),
        ("hash", "accepted truth"),
        ("path", "accepted truth"),
        ("correction-acceptance", "accepted truth"),
        ("posture", "accepted truth"),
    ],
)
def test_validator_rejects_duplicates_forgery_hash_and_traversal(
    mutation: str,
    expected: str,
) -> None:
    manifest = build_component_manifest(REPO_ROOT)
    rows = cast(list[dict[str, object]], manifest["components"])
    if mutation == "duplicate":
        rows[0] = rows[1]
    elif mutation == "status":
        rows[16]["implementationState"] = "PRODUCTION_READY"
    elif mutation == "hash":
        refs = cast(list[dict[str, object]], rows[4]["evidenceRefs"])
        refs[0]["sha256"] = "0" * 64
    elif mutation == "path":
        refs = cast(list[dict[str, object]], rows[3]["evidenceRefs"])
        refs[0]["path"] = "../escape"
    elif mutation == "correction-acceptance":
        for index in (2, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16):
            correction = cast(dict[str, object], rows[index]["postAcceptanceCorrection"])
            correction["acceptanceState"] = "ACCEPTED"
    else:
        posture = cast(dict[str, object], manifest["finalPosture"])
        posture["edge"] = "AVAILABLE"

    with pytest.raises(ComponentManifestError, match=expected):
        validate_component_manifest(REPO_ROOT, manifest)


@pytest.mark.parametrize(
    ("relative_path", "kind"),
    [
        ("quant/fixtures/q05_label_golden_v1.json", "tamper"),
        ("quant/generated/q08/derivatives_campaign.v1.json", "tamper"),
        ("quant/RECEIPTS/Q15_ACCEPTANCE.md", "symlink"),
        ("", "current-source-tamper"),
        ("quant/src/quant_edge/inference/service.py", "source-tamper"),
        ("quant/src/quant_edge/book/injected.py", "source-addition"),
        ("quant/src/quant_edge/book/native.so", "source-unexpected-file"),
        ("quant/src/quant_edge/book/nested", "source-directory"),
        ("quant/src/quant_edge/book/linked.py", "source-symlink"),
    ],
)
def test_current_byte_tamper_symlink_and_source_inventory_fail_closed(
    tmp_path: Path,
    relative_path: str,
    kind: str,
) -> None:
    if kind == "current-source-tamper":
        for index, correction_path in enumerate(
            (
                "quant/src/quant_edge/lake/instruments.py",
                "quant/src/quant_edge/labels/basis.py",
                "quant/src/quant_edge/features/diagnostics.py",
                "quant/src/quant_edge/micro/activity.py",
                "quant/src/quant_edge/derivatives/cross_market.py",
                "quant/src/quant_edge/regime/ood_challengers.py",
                "quant/src/quant_edge/models/focus_budget.py",
                "quant/src/quant_edge/survival/passive_fill.py",
                "quant/src/quant_edge/ensemble/regime_mixture.py",
                "quant/src/quant_edge/validation/feature_diagnostics.py",
                "quant/src/quant_edge/registry_ops/recorded_outcomes.py",
                "quant/src/quant_edge/inference/artifacts.py",
            )
        ):
            case_root = tmp_path / f"current-source-{index}"
            case_root.mkdir()
            mirror = _component_mirror(case_root)
            target = mirror / correction_path
            target.write_bytes(target.read_bytes() + b"\n")
            with pytest.raises(ComponentManifestError):
                build_component_manifest(mirror)
        return

    mirror = _component_mirror(tmp_path)
    target = mirror / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    if kind == "symlink":
        target.unlink()
        target.symlink_to(REPO_ROOT / relative_path)
    elif kind == "source-directory":
        target.mkdir()
    elif kind == "source-symlink":
        target.symlink_to(REPO_ROOT / "quant/src/quant_edge/book/engine.py")
    elif kind == "source-addition":
        target.write_text("VALUE = 1\n")
    elif kind == "source-unexpected-file":
        target.write_bytes(b"native")
    else:
        target.write_bytes(target.read_bytes() + b"\n")

    with pytest.raises(ComponentManifestError):
        build_component_manifest(mirror)


@pytest.mark.parametrize(
    "relative_path",
    [
        "quant/src/quant_edge/features/primitives.py",
        "quant/src/quant_edge/micro/inputs.py",
        "quant/src/quant_edge/regime/analog.py",
        "quant/src/quant_edge/survival/metrics.py",
        "quant/src/quant_edge/ensemble/stacking.py",
        "quant/src/quant_edge/validation/leakage.py",
        "quant/src/quant_edge/registry_ops/store.py",
        "quant/src/quant_edge/inference/artifacts.py",
    ],
)
def test_final_hunt_current_source_pins_reject_tamper(
    tmp_path: Path,
    relative_path: str,
) -> None:
    mirror = _component_mirror(tmp_path)
    target = mirror / relative_path
    target.write_bytes(target.read_bytes() + b"\n")

    with pytest.raises(ComponentManifestError, match="source bytes changed"):
        build_component_manifest(mirror)


@pytest.mark.parametrize(
    "relative_path",
    [
        "quant/fixtures/q07_micro_golden_v1.json",
        "quant/generated/q11/survival_campaign.v1.json",
        "quant/generated/q12/ensemble_campaign.v1.json",
        "quant/generated/q15/registry_campaign.v1.json",
    ],
)
def test_final_hunt_current_primary_evidence_pins_reject_tamper(
    tmp_path: Path,
    relative_path: str,
) -> None:
    mirror = _component_mirror(tmp_path)
    target = mirror / relative_path
    target.write_bytes(target.read_bytes() + b"\n")

    with pytest.raises(ComponentManifestError):
        build_component_manifest(mirror)


def test_q16_service_pin_rejects_tamper_even_when_current_tree_is_resealed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mirror = _component_mirror(tmp_path)
    service = mirror / "quant/src/quant_edge/inference/service.py"
    original = service.read_bytes()
    service.write_bytes(original[:-1] + b" ")

    correction_spec = components._POST_ACCEPTANCE_CORRECTIONS["Q16"]
    source_spec = correction_spec.current_source
    source_root = mirror / source_spec.relative_path
    files: list[dict[str, object]] = []
    for path in sorted(source_root.glob("*.py"), key=lambda child: child.name):
        raw = path.read_bytes()
        files.append(
            {
                "bytes": len(raw),
                "path": f"{source_spec.manifest_path_prefix}/{path.name}",
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    resealed = hashlib.sha256(canonical_json_bytes({"files": files})).hexdigest()
    monkeypatch.setitem(
        components._POST_ACCEPTANCE_CORRECTIONS,
        "Q16",
        replace(
            correction_spec,
            current_source=replace(source_spec, seal_sha256=resealed),
        ),
    )

    with pytest.raises(ComponentManifestError, match="current correction source digest changed"):
        build_component_manifest(mirror)


def test_repo_root_and_paths_are_fail_closed(tmp_path: Path) -> None:
    with pytest.raises(ComponentManifestError, match="absolute"):
        build_component_manifest(Path("."))
    with pytest.raises(ComponentManifestError, match="absent"):
        build_component_manifest(tmp_path / "missing")
    file_root = tmp_path / "file"
    file_root.write_text("not a directory")
    with pytest.raises(ComponentManifestError, match="non-symlink directory"):
        build_component_manifest(file_root)
    link = tmp_path / "link"
    link.symlink_to(REPO_ROOT, target_is_directory=True)
    with pytest.raises(ComponentManifestError, match="non-symlink directory"):
        build_component_manifest(link)
    for path in ("", "../x", "/x", "a//b", "a/./b", "a\\b", "https://x", "a\x00b"):
        with pytest.raises(ComponentManifestError):
            components._safe_parts(path)


def test_artifact_contract_rejects_size_digest_schema_version_and_text(tmp_path: Path) -> None:
    raw = b"# valid\n"
    root, root_before = _custom_root(tmp_path, "evidence.md", raw)
    spec = _artifact("evidence.md", raw)
    mapping, parsed = components._artifact_mapping(root, root_before, spec)
    assert mapping["sha256"] == hashlib.sha256(raw).hexdigest()
    assert parsed is None

    bad_specs = (
        replace(spec, byte_length=1),
        replace(spec, sha256="0" * 64),
        replace(spec, sha256="BAD"),
    )
    for bad in bad_specs:
        with pytest.raises(ComponentManifestError):
            components._artifact_mapping(root, root_before, bad)

    (root / "evidence.md").write_bytes(b"not a heading")
    no_heading = _artifact("evidence.md", b"not a heading")
    with pytest.raises(ComponentManifestError, match="heading"):
        components._artifact_mapping(root, root_before, no_heading)
    (root / "evidence.md").write_bytes(b"\xff")
    invalid_utf8 = _artifact("evidence.md", b"\xff")
    with pytest.raises(ComponentManifestError, match="UTF-8"):
        components._artifact_mapping(root, root_before, invalid_utf8)

    json_cases = (
        (b'{"schema":"S","version":1}\n', "S", 1, None),
        (b'{"schema":"S","version":1}', "S", 1, None),
        (b'{"schema":"S","schema":"S","version":1}\n', "S", 1, "canonical"),
        (b'{"schema":"S","version":1}\n', "X", 1, "schema"),
        (b'{"schema":"S","version":1}\n', "S", 2, "version"),
    )
    for index, (json_raw, schema, version, error) in enumerate(json_cases):
        relative = f"case-{index}.json"
        (root / relative).write_bytes(json_raw)
        json_spec = _artifact(
            relative,
            json_raw,
            media_type="application/json",
            schema=schema,
            version=version,
        )
        if error is None:
            _, value = components._artifact_mapping(root, root_before, json_spec)
            assert value == {"schema": "S", "version": 1}
        else:
            with pytest.raises(ComponentManifestError, match=error):
                components._artifact_mapping(root, root_before, json_spec)


def test_historical_metadata_and_current_task_utf8_guards(tmp_path: Path) -> None:
    invalid = replace(_artifact("evidence.md", b"# valid\n"), byte_length=0)
    with pytest.raises(ComponentManifestError, match="historical"):
        components._pinned_artifact_mapping(invalid)

    root, root_before = _custom_root(tmp_path, "quant/TASKS/Q17.md", b"\xff")
    with pytest.raises(ComponentManifestError, match="UTF-8"):
        components._current_q17_task_mapping(root, root_before)


def test_regular_file_boundary_rejects_absence_links_directories_and_bounds(
    tmp_path: Path,
) -> None:
    root, root_before = _custom_root(tmp_path, "safe/file.txt", b"value")
    with pytest.raises(ComponentManifestError, match="absent"):
        components._read_regular(
            root, root_before, "safe/missing.txt", expected_bytes=None, maximum_bytes=10
        )
    with pytest.raises(ComponentManifestError, match="bounded"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=1
        )
    with pytest.raises(ComponentManifestError, match="size"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=4, maximum_bytes=10
        )
    (root / "safe/directory").mkdir()
    with pytest.raises(ComponentManifestError, match="regular file"):
        components._read_regular(
            root, root_before, "safe/directory", expected_bytes=None, maximum_bytes=10
        )
    (root / "safe/link.txt").symlink_to(root / "safe/file.txt")
    with pytest.raises(ComponentManifestError, match="link"):
        components._read_regular(
            root, root_before, "safe/link.txt", expected_bytes=None, maximum_bytes=10
        )
    os.mkfifo(root / "safe/fifo")
    with pytest.raises(ComponentManifestError, match="regular file"):
        components._read_regular(
            root, root_before, "safe/fifo", expected_bytes=None, maximum_bytes=10
        )

    os.link(root / "safe/file.txt", root / "safe/hardlink.txt")
    with pytest.raises(ComponentManifestError, match="single-link"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )


def test_regular_read_wraps_open_error_and_rechecks_live_leaf(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, root_before = _custom_root(tmp_path, "safe/file.txt", b"value")
    original_open = os.open

    def fail_leaf_open(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        if path == "file.txt":
            raise OSError("injected leaf open failure")
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", fail_leaf_open)
    with pytest.raises(ComponentManifestError, match="cannot be opened"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )

    monkeypatch.setattr(os, "open", original_open)
    alternate = root / "safe/alternate.txt"
    alternate.write_bytes(b"value")
    original_stat = os.stat

    def substitute_leaf_stat(
        path: str | bytes | int,
        *,
        dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> os.stat_result:
        if path == "file.txt":
            return original_stat(alternate)
        return original_stat(path, dir_fd=dir_fd, follow_symlinks=follow_symlinks)

    monkeypatch.setattr(os, "stat", substitute_leaf_stat)
    with pytest.raises(ComponentManifestError, match="leaf changed"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )


def test_regular_read_rejects_intermediate_parent_replacement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, root_before = _custom_root(tmp_path, "safe/file.txt", b"value")
    original_read = os.read
    replaced = False

    def replace_parent(descriptor: int, length: int) -> bytes:
        nonlocal replaced
        if not replaced:
            replaced = True
            (root / "safe").rename(root / "detached")
            (root / "safe").mkdir()
            (root / "safe/file.txt").write_bytes(b"value")
        return original_read(descriptor, length)

    monkeypatch.setattr(os, "read", replace_parent)
    with pytest.raises(ComponentManifestError, match="parent changed"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )


def test_regular_read_rejects_atomic_leaf_replacement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, root_before = _custom_root(tmp_path, "safe/file.txt", b"value")
    replacement = root / "safe/replacement.txt"
    replacement.write_bytes(b"value")
    original_read = os.read
    replaced = False

    def replace_leaf(descriptor: int, length: int) -> bytes:
        nonlocal replaced
        if not replaced:
            replaced = True
            replacement.replace(root / "safe/file.txt")
        return original_read(descriptor, length)

    monkeypatch.setattr(os, "read", replace_leaf)
    with pytest.raises(ComponentManifestError, match="changed during"):
        components._read_regular(
            root, root_before, "safe/file.txt", expected_bytes=None, maximum_bytes=10
        )


def test_source_root_and_q10_semantic_guards(tmp_path: Path) -> None:
    root, root_before = _custom_root(tmp_path, "src/one.py", b"VALUE = 1\n")
    rows = {
        "files": [
            {
                "bytes": 10,
                "path": "src/one.py",
                "sha256": hashlib.sha256(b"VALUE = 1\n").hexdigest(),
            }
        ]
    }
    source = components._SourceSpec(
        "src", "src", 1, hashlib.sha256(canonical_json_bytes(rows)).hexdigest()
    )
    assert components._source_mapping(root, root_before, source)["fileCount"] == 1
    (root / "src/__pycache__").mkdir()
    assert components._source_mapping(root, root_before, source)["fileCount"] == 1

    unexpected = root / "src/native.so"
    unexpected.write_bytes(b"native")
    with pytest.raises(ComponentManifestError, match="unexpected child"):
        components._source_mapping(root, root_before, source)
    unexpected.unlink()

    nested = root / "src/nested"
    nested.mkdir()
    with pytest.raises(ComponentManifestError, match="unexpected child"):
        components._source_mapping(root, root_before, source)
    nested.rmdir()

    linked = root / "src/linked.py"
    linked.symlink_to(root / "src/one.py")
    with pytest.raises(ComponentManifestError, match="unexpected child"):
        components._source_mapping(root, root_before, source)
    linked.unlink()

    shutil.rmtree(root / "src/__pycache__")
    (root / "src/__pycache__").symlink_to(root / "src", target_is_directory=True)
    with pytest.raises(ComponentManifestError, match="cache is unsafe"):
        components._source_mapping(root, root_before, source)
    (root / "src/__pycache__").unlink()

    with pytest.raises(ComponentManifestError, match="inventory"):
        components._source_mapping(root, root_before, replace(source, file_count=2))
    with pytest.raises(ComponentManifestError, match="bytes"):
        components._source_mapping(root, root_before, replace(source, seal_sha256="0" * 64))
    with pytest.raises(ComponentManifestError, match="absent"):
        components._source_mapping(root, root_before, replace(source, relative_path="missing"))

    with pytest.raises(ComponentManifestError, match="unavailable"):
        components._require_q10_best_index(None)
    with pytest.raises(ComponentManifestError, match="malformed"):
        components._require_q10_best_index({})
    for summaries in ([], [{"studyId": "study_xgb_quantile:v1", "bestTrialIndex": 8}]):
        with pytest.raises(ComponentManifestError, match="changed"):
            components._require_q10_best_index({"studySummaries": summaries})
    components._require_q10_best_index(
        {
            "studySummaries": [
                {"studyId": "other", "bestTrialIndex": 0},
                {"studyId": "study_xgb_quantile:v1", "bestTrialIndex": 10},
            ]
        }
    )


def test_source_inventory_os_errors_unsafe_root_and_read_race(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, root_before = _custom_root(tmp_path, "src/one.py", b"VALUE = 1\n")
    rows = {
        "files": [
            {
                "bytes": 10,
                "path": "src/one.py",
                "sha256": hashlib.sha256(b"VALUE = 1\n").hexdigest(),
            }
        ]
    }
    source = components._SourceSpec(
        "src", "src", 1, hashlib.sha256(canonical_json_bytes(rows)).hexdigest()
    )

    linked = root / "linked"
    linked.symlink_to(root / "src", target_is_directory=True)
    with pytest.raises(ComponentManifestError, match="root is unsafe"):
        components._source_mapping(
            root,
            root_before,
            replace(source, relative_path="linked"),
        )

    original_iterdir = Path.iterdir

    def fail_iterdir(path: Path):  # type: ignore[no-untyped-def]
        if path == root / "src":
            raise OSError("injected inventory failure")
        return original_iterdir(path)

    monkeypatch.setattr(Path, "iterdir", fail_iterdir)
    with pytest.raises(ComponentManifestError, match="inventory is unavailable"):
        components._source_inventory(root / "src")
    monkeypatch.setattr(Path, "iterdir", original_iterdir)

    original_read_regular = components._read_regular

    def touch_after_read(*args: object, **kwargs: object) -> bytes:
        raw = original_read_regular(*args, **kwargs)  # type: ignore[arg-type]
        target = root / "src/one.py"
        current = target.stat()
        os.utime(target, ns=(current.st_atime_ns, current.st_mtime_ns + 1_000_000_000))
        return raw

    monkeypatch.setattr(components, "_read_regular", touch_after_read)
    with pytest.raises(ComponentManifestError, match="inventory changed during read"):
        components._source_mapping(root, root_before, source)


def test_strict_manifest_shape_and_json_safety() -> None:
    valid = build_component_manifest(REPO_ROOT)
    bad_values: tuple[object, ...] = (
        [],
        {1: "bad"},
        {key: value for key, value in valid.items() if key != "schema"},
        {**valid, "components": []},
        {**valid, "components": [*cast(list[object], valid["components"])[:-1], []]},
        {
            **valid,
            "components": [
                *cast(list[object], valid["components"])[:-1],
                {1: "bad"},
            ],
        },
        {
            **valid,
            "components": [
                *cast(list[object], valid["components"])[:-1],
                {"phase": "Q17"},
            ],
        },
    )
    for value in bad_values:
        with pytest.raises(ComponentManifestError):
            validate_component_manifest(REPO_ROOT, value)

    forged = copy.deepcopy(valid)
    forged["version"] = 1.5
    with pytest.raises(ComponentManifestError, match="canonical-JSON-safe"):
        validate_component_manifest(REPO_ROOT, forged)
