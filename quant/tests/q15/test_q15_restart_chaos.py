from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from q15_fixtures import BASE_COMMIT, FIXED_TIME_MS, REPO_ROOT, populated_registry

from quant_edge.registry_ops.bundle import (
    build_merged_q15_bundle,
    synthetic_promotion_binding,
    synthetic_shadow_records,
)
from quant_edge.registry_ops.contracts import CommitStage, ModelLifecycle
from quant_edge.registry_ops.store import ResearchRegistryStore

_KILL_SCRIPT = r"""
import os
import signal
import sys
from pathlib import Path
from quant_edge.registry_ops.bundle import (
    build_merged_q15_bundle,
    synthetic_promotion_binding,
    synthetic_shadow_records,
)
from quant_edge.registry_ops.contracts import CommitStage
from quant_edge.registry_ops.store import ResearchRegistryStore

repo = Path(sys.argv[1])
registry = Path(sys.argv[2])
kill_stage = CommitStage(sys.argv[3])
code_commit = sys.argv[4]
bundle = build_merged_q15_bundle(
    repo,
    code_commit=code_commit,
    recorded_at_ms=1783890000000,
)
store = ResearchRegistryStore(registry)
champion = store.current_champion("transition-binary")
if champion is None:
    raise RuntimeError("fixture champion missing")
shadow_digest = synthetic_shadow_records(bundle, champion)[2].content_digest

def kill(stage: CommitStage) -> None:
    if stage is kill_stage:
        os.kill(os.getpid(), signal.SIGKILL)

store.promote_challenger(
    slot_id="transition-binary",
    candidate_model_id=bundle.q10_registration.model_id,
    candidate_model_revision=bundle.q10_registration.model_revision,
    transition_id="q15.promote.crash",
    policy_revision="q15.policy.crash.v2",
    evidence=synthetic_promotion_binding(bundle, shadow_report_sha256=shadow_digest),
    reason="Synthetic process-kill consistency proof",
    now_ms=1783890000002,
    expected_generation=1,
    artifact_root=repo,
    hook=kill,
)
"""


def _killed_promotion(registry_root: Path, stage: CommitStage) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(REPO_ROOT / "quant" / "src")
    return subprocess.run(
        [
            sys.executable,
            "-c",
            _KILL_SCRIPT,
            str(REPO_ROOT),
            str(registry_root),
            stage.value,
            BASE_COMMIT,
        ],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )


@pytest.mark.parametrize("stage", [CommitStage.AFTER_BEGIN, CommitStage.BEFORE_COMMIT])
def test_process_kill_before_commit_restores_exact_prior_champion(
    tmp_path: Path, stage: CommitStage
) -> None:
    store, bundle, initial = populated_registry(tmp_path)
    store.close()
    killed = _killed_promotion(tmp_path, stage)
    assert killed.returncode == -9
    with ResearchRegistryStore(tmp_path) as restarted:
        restored = restarted.restore_champion(initial.slot_id, artifact_root=REPO_ROOT)
        assert restored == initial
        assert restarted.transition_count(initial.slot_id) == 1
        assert (
            restarted.model_lifecycle(
                bundle.q10_registration.model_id, bundle.q10_registration.model_revision
            )
            is ModelLifecycle.SHADOW_CHALLENGER
        )


def test_process_kill_after_commit_restores_new_exact_champion_and_retry_is_idempotent(
    tmp_path: Path,
) -> None:
    store, bundle, initial = populated_registry(tmp_path)
    store.close()
    control_root = tmp_path / "control"
    control_root.mkdir()
    control, control_bundle, control_initial = populated_registry(control_root)
    expected = control.promote_challenger(
        slot_id=control_initial.slot_id,
        candidate_model_id=control_bundle.q10_registration.model_id,
        candidate_model_revision=control_bundle.q10_registration.model_revision,
        transition_id="q15.promote.crash",
        policy_revision="q15.policy.crash.v2",
        evidence=synthetic_promotion_binding(
            control_bundle,
            shadow_report_sha256=synthetic_shadow_records(control_bundle, control_initial)[
                2
            ].content_digest,
        ),
        reason="Synthetic process-kill consistency proof",
        now_ms=FIXED_TIME_MS + 2,
        expected_generation=control_initial.generation,
        artifact_root=REPO_ROOT,
    )
    control.close()
    killed = _killed_promotion(tmp_path, CommitStage.AFTER_COMMIT)
    assert killed.returncode == -9
    with ResearchRegistryStore(tmp_path) as restarted:
        restored = restarted.restore_champion(initial.slot_id, artifact_root=REPO_ROOT)
        assert restored == expected
        retried = restarted.promote_challenger(
            slot_id=initial.slot_id,
            candidate_model_id=bundle.q10_registration.model_id,
            candidate_model_revision=bundle.q10_registration.model_revision,
            transition_id="q15.promote.crash",
            policy_revision="q15.policy.crash.v2",
            evidence=synthetic_promotion_binding(
                bundle,
                shadow_report_sha256=synthetic_shadow_records(bundle, initial)[2].content_digest,
            ),
            reason="Synthetic process-kill consistency proof",
            now_ms=FIXED_TIME_MS + 2,
            expected_generation=1,
            artifact_root=REPO_ROOT,
        )
        assert retried == restored
        assert restarted.transition_count(initial.slot_id) == 2


def test_fixture_identity_is_pinned_to_current_merge() -> None:
    bundle = build_merged_q15_bundle(
        REPO_ROOT,
        code_commit=BASE_COMMIT,
        recorded_at_ms=FIXED_TIME_MS,
    )
    assert bundle.experiment_card.code_commit == BASE_COMMIT
