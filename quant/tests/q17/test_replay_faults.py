from __future__ import annotations

import hashlib
import os
from collections.abc import Callable
from copy import deepcopy
from itertools import pairwise
from pathlib import Path
from typing import cast

import pytest

import quant_edge.final_proof.replay as replay_module
from quant_edge.book.replay import script_from_mapping
from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.final_proof.replay import (
    ASSESSMENT_RELATIVE_PATH,
    CAMPAIGN_RELATIVE_PATH,
    CORRUPT_COPY_NAME,
    EXPECTED_AMBIGUOUS_ASSESSMENT_SHA256,
    EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
    EXPECTED_ASSESSMENT_SHA256,
    EXPECTED_BLOCKERS,
    EXPECTED_CAMPAIGN_SHA256,
    EXPECTED_EVALUATION_TIME_MS,
    EXPECTED_EXPIRED_ASSESSMENT_SHA256,
    EXPECTED_EXPIRED_EVALUATION_TIME_MS,
    EXPECTED_FIXTURE_SHA256,
    EXPECTED_MUTATIONS,
    EXPECTED_PIPELINE_SHA256,
    EXPECTED_Q04_GAP_PREFIX_SHA256,
    EXPECTED_Q04_REPLAY_SHA256,
    EXPECTED_REQUEST_SHA256,
    FIXTURE_RELATIVE_PATH,
    REQUEST_RELATIVE_PATH,
    ReplayProofError,
    build_replay_fault_proof,
    corrupt_forward_gap_fixture_bytes,
    run_replay_fault_campaign,
    validate_replay_fault_proof,
)
from quant_edge.inference.artifacts import build_serving_manifest, load_serving_lineage
from quant_edge.inference.contracts import ServingLineageV1
from quant_edge.inference.pipeline import (
    PipelineResultV1,
)
from quant_edge.inference.pipeline import (
    run_inference_pipeline as owner_run_inference_pipeline,
)
from quant_edge.inference.protocol import (
    ProtocolContractV1,
    strict_json_object,
)

QUANT_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = QUANT_ROOT.parent


def _mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return value


def _list(value: object) -> list[object]:
    assert isinstance(value, list)
    return value


@pytest.fixture(scope="session")
def protocol() -> ProtocolContractV1:
    return ProtocolContractV1.load(REPO_ROOT)


@pytest.fixture(scope="session")
def lineage() -> ServingLineageV1:
    manifest = build_serving_manifest(QUANT_ROOT)
    return load_serving_lineage(QUANT_ROOT, manifest)


@pytest.fixture(scope="session")
def fixture_bytes() -> bytes:
    return (QUANT_ROOT / FIXTURE_RELATIVE_PATH).read_bytes()


@pytest.fixture(scope="session")
def corrupted_fixture_bytes(fixture_bytes: bytes) -> bytes:
    return corrupt_forward_gap_fixture_bytes(fixture_bytes)


@pytest.fixture(scope="session")
def proof(tmp_path_factory: pytest.TempPathFactory) -> dict[str, object]:
    return run_replay_fault_campaign(
        QUANT_ROOT,
        REPO_ROOT,
        tmp_path_factory.mktemp("q17-replay-copy"),
        evaluation_time_ms=EXPECTED_EVALUATION_TIME_MS,
        expired_evaluation_time_ms=EXPECTED_EXPIRED_EVALUATION_TIME_MS,
        ambiguous_evaluation_time_ms=EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
    )


def _build(
    fixture_bytes: bytes,
    corrupted_fixture_bytes: bytes,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    *,
    request_bytes: bytes | None = None,
    evaluation_time_ms: int = EXPECTED_EVALUATION_TIME_MS,
    expired_evaluation_time_ms: int = EXPECTED_EXPIRED_EVALUATION_TIME_MS,
    ambiguous_evaluation_time_ms: int = EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
) -> dict[str, object]:
    return build_replay_fault_proof(
        fixture_bytes,
        (
            (QUANT_ROOT / REQUEST_RELATIVE_PATH).read_bytes()
            if request_bytes is None
            else request_bytes
        ),
        (QUANT_ROOT / ASSESSMENT_RELATIVE_PATH).read_bytes(),
        (QUANT_ROOT / CAMPAIGN_RELATIVE_PATH).read_bytes(),
        corrupted_fixture_bytes,
        lineage=lineage,
        protocol=protocol,
        evaluation_time_ms=evaluation_time_ms,
        expired_evaluation_time_ms=expired_evaluation_time_ms,
        ambiguous_evaluation_time_ms=ambiguous_evaluation_time_ms,
    )


def test_current_q16_campaign_repin_preserves_pipeline_and_assessment() -> None:
    campaign_bytes = (QUANT_ROOT / CAMPAIGN_RELATIVE_PATH).read_bytes()
    campaign = strict_json_object(campaign_bytes, maximum_bytes=262_144)
    assessment_bytes = (QUANT_ROOT / ASSESSMENT_RELATIVE_PATH).read_bytes()

    assert hashlib.sha256(campaign_bytes).hexdigest() == EXPECTED_CAMPAIGN_SHA256
    assert (
        hashlib.sha256(canonical_json_bytes(_mapping(campaign["pipeline"]))).hexdigest()
        == EXPECTED_PIPELINE_SHA256
    )
    assert hashlib.sha256(assessment_bytes).hexdigest() == EXPECTED_ASSESSMENT_SHA256
    assert campaign["assessmentSha256"] == EXPECTED_ASSESSMENT_SHA256


def test_campaign_binds_two_runs_and_every_committed_q16_identity(
    proof: dict[str, object],
    protocol: ProtocolContractV1,
) -> None:
    validate_replay_fault_proof(proof, protocol=protocol)
    repeatability = _mapping(proof["repeatability"])
    assert repeatability == {
        "assessmentSha256": EXPECTED_ASSESSMENT_SHA256,
        "byteIdenticalIndependentRuns": True,
        "committedGoldenMatched": True,
        "pipelineSha256": EXPECTED_PIPELINE_SHA256,
        "rawFixtureSha256": EXPECTED_FIXTURE_SHA256,
        "requestSha256": EXPECTED_REQUEST_SHA256,
        "runCount": 2,
        "stageIdentities": repeatability["stageIdentities"],
    }
    stages = cast(list[dict[str, object]], repeatability["stageIdentities"])
    assert [stage["stage"] for stage in stages] == [
        "RAW",
        "EVIDENCE",
        "FEATURES",
        "MODELS",
        "CALIBRATION",
        "ASSESSMENT",
    ]
    assert stages[0]["parentSha256"] == []
    for previous, current in pairwise(stages):
        assert current["parentSha256"] == [previous["sha256"]]
    assert canonical_json_bytes(proof) == canonical_json_bytes(deepcopy(proof))


def test_assessment_is_protocol_valid_and_contains_no_actionable_numbers(
    proof: dict[str, object],
    protocol: ProtocolContractV1,
) -> None:
    assessment = _mapping(proof["assessmentEnvelope"])
    protocol.validate_envelope(assessment, maximum_bytes=262_144)
    assert assessment["advisoryAction"] == "ABSTAIN_UNKNOWN"
    assert assessment["abstentionReasonCodes"] == list(EXPECTED_BLOCKERS)
    assert assessment["predictions"] == []
    assert assessment["featureAttribution"] == []
    assert assessment["grossEstimate"] is None
    assert assessment["marketStageProbabilities"] == {}
    assert assessment["regimeProbabilities"] == {}
    assert assessment["netExpectedValue"] == {"state": "UNKNOWN"}
    summary = _mapping(proof["assessmentSummary"])
    assert summary["scoresAbsent"] is True
    assert summary["probabilitiesAbsent"] is True
    assert summary["netEconomicsState"] == "UNKNOWN"


def test_gap_prefix_is_observed_before_recovery_and_pipeline_rejects_mutation(
    proof: dict[str, object],
) -> None:
    faults = _mapping(proof["faults"])
    gap = _mapping(faults["sequenceGap"])
    assert gap["qualityPath"] == ["COMPLETE", "GAPPED", "RECONSTRUCTING"]
    assert gap["gapBookModelEligible"] is False
    assert gap["emptyBookDuringGap"] is True
    assert gap["bookUpdateIdUnavailable"] is True
    assert gap["resyncTriggerObserved"] is True
    assert gap["gapPrefixReplaySha256"] == EXPECTED_Q04_GAP_PREFIX_SHA256
    assert gap["fullReplaySha256"] == EXPECTED_Q04_REPLAY_SHA256
    assert gap["finalBookRecovered"] is True
    assert gap["alteredScriptRejectedBeforeAssessment"] is True
    assert gap["sourceGapBlockerPresent"] is True

    mutations = cast(list[dict[str, object]], faults["mutationRejections"])
    assert [row["mutation"] for row in mutations] == list(EXPECTED_MUTATIONS)
    assert all(row["rejected"] is True for row in mutations)
    assert all(row["assessmentProduced"] is False for row in mutations)


def test_expiry_and_future_relative_ambiguity_are_explicit_abstentions(
    proof: dict[str, object],
) -> None:
    faults = _mapping(proof["faults"])
    expiration = _mapping(faults["expiration"])
    assert expiration == {
        "assessmentSha256": EXPECTED_EXPIRED_ASSESSMENT_SHA256,
        "finalAction": "ABSTAIN_UNKNOWN",
        "reasonCodes": ["ASSESSMENT_EXPIRED", "SOURCE_STALE"],
        "sourceFreshness": "STALE",
    }
    ambiguity = _mapping(faults["futureAmbiguity"])
    assert ambiguity == {
        "assessmentSha256": EXPECTED_AMBIGUOUS_ASSESSMENT_SHA256,
        "finalAction": "ABSTAIN_UNKNOWN",
        "reasonCodes": ["EVALUATION_PRECEDES_GENERATION", "SOURCE_TIME_AMBIGUOUS"],
        "sourceFreshness": "UNKNOWN",
    }


def test_campaign_and_pure_builder_are_byte_deterministic(
    tmp_path: Path,
    fixture_bytes: bytes,
    corrupted_fixture_bytes: bytes,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    proof: dict[str, object],
) -> None:
    second_campaign = run_replay_fault_campaign(
        QUANT_ROOT,
        REPO_ROOT,
        tmp_path,
        evaluation_time_ms=EXPECTED_EVALUATION_TIME_MS,
        expired_evaluation_time_ms=EXPECTED_EXPIRED_EVALUATION_TIME_MS,
        ambiguous_evaluation_time_ms=EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
    )
    pure = _build(fixture_bytes, corrupted_fixture_bytes, lineage, protocol)
    assert canonical_json_bytes(second_campaign) == canonical_json_bytes(proof)
    assert canonical_json_bytes(pure) == canonical_json_bytes(proof)
    copied = tmp_path / CORRUPT_COPY_NAME
    assert copied.is_file()
    assert not copied.is_symlink()
    assert copied.read_bytes() == corrupted_fixture_bytes


def test_builder_runs_two_distinct_primary_pipeline_objects_through_owner_delegate(
    fixture_bytes: bytes,
    corrupted_fixture_bytes: bytes,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    primary_inputs: list[dict[str, object]] = []
    primary_results: list[PipelineResultV1] = []

    def delegated_pipeline(
        raw_fixture: dict[str, object],
        *,
        lineage: ServingLineageV1,
        protocol: ProtocolContractV1,
        evaluation_time_ms: int | None = None,
    ) -> PipelineResultV1:
        result = owner_run_inference_pipeline(
            raw_fixture,
            lineage=lineage,
            protocol=protocol,
            evaluation_time_ms=evaluation_time_ms,
        )
        if evaluation_time_ms == EXPECTED_EVALUATION_TIME_MS:
            primary_inputs.append(raw_fixture)
            primary_results.append(result)
        return result

    monkeypatch.setattr(replay_module, "run_inference_pipeline", delegated_pipeline)
    delegated_proof = _build(fixture_bytes, corrupted_fixture_bytes, lineage, protocol)

    assert len(primary_inputs) == 2
    assert len(primary_results) == 2
    assert primary_inputs[0] is not primary_inputs[1]
    assert primary_results[0] is not primary_results[1]
    assert canonical_json_bytes(primary_inputs[0]) == canonical_json_bytes(primary_inputs[1])
    assert canonical_json_bytes(primary_results[0].as_mapping()) == canonical_json_bytes(
        primary_results[1].as_mapping()
    )
    repeatability = _mapping(delegated_proof["repeatability"])
    assert repeatability["byteIdenticalIndependentRuns"] is True
    assert repeatability["committedGoldenMatched"] is True
    assert repeatability["pipelineSha256"] == EXPECTED_PIPELINE_SHA256


def test_corruption_is_canonical_and_targets_the_accepted_forward_gap(
    fixture_bytes: bytes,
    corrupted_fixture_bytes: bytes,
) -> None:
    original = parse_canonical_object(fixture_bytes)
    corrupted = parse_canonical_object(corrupted_fixture_bytes)
    assert original["version"] == corrupted["version"] == 1
    assert original["sourceFixtureSha256"] == corrupted["sourceFixtureSha256"]
    original_script = script_from_mapping(original["spotBookScript"])
    corrupted_script = script_from_mapping(corrupted["spotBookScript"])
    assert original_script.script_digest != corrupted_script.script_digest
    assert canonical_json_bytes(corrupted) == corrupted_fixture_bytes


def _add_root_field(value: dict[str, object]) -> None:
    value["injected"] = True


def _change_proof_version(value: dict[str, object]) -> None:
    value["version"] = True


def _change_proof_version_to_float(value: dict[str, object]) -> None:
    value["version"] = 1.0


def _change_action(value: dict[str, object]) -> None:
    _mapping(value["assessmentEnvelope"])["advisoryAction"] = "PROPOSE_CONSIDERATION"


def _change_assessment_version(value: dict[str, object]) -> None:
    _mapping(value["assessmentEnvelope"])["version"] = 2


def _change_assessment_version_to_bool(value: dict[str, object]) -> None:
    _mapping(value["assessmentEnvelope"])["version"] = True


def _change_assessment_nested_bool_to_int(value: dict[str, object]) -> None:
    assessment = _mapping(value["assessmentEnvelope"])
    _mapping(assessment["sourceQuality"])["duplicate"] = 1


def _change_lineage(value: dict[str, object]) -> None:
    assessment = _mapping(value["assessmentEnvelope"])
    _mapping(assessment["lineage"])["modelVersion"] = "ambiguous.valid.revision"


def _change_net_economics(value: dict[str, object]) -> None:
    _mapping(value["assessmentEnvelope"])["netExpectedValue"] = {"state": "ESTIMATED"}


def _change_stage(value: dict[str, object]) -> None:
    repeatability = _mapping(value["repeatability"])
    stages = _list(repeatability["stageIdentities"])
    _mapping(stages[2])["sha256"] = "a" * 64


def _change_summary_bool_to_int(value: dict[str, object]) -> None:
    _mapping(value["assessmentSummary"])["scoresAbsent"] = 1


def _change_repeatability_bool_to_int(value: dict[str, object]) -> None:
    _mapping(value["repeatability"])["committedGoldenMatched"] = 1


def _change_run_count_to_bool(value: dict[str, object]) -> None:
    _mapping(value["repeatability"])["runCount"] = True


def _change_run_count_to_float(value: dict[str, object]) -> None:
    _mapping(value["repeatability"])["runCount"] = 2.0


def _change_gap(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    _mapping(faults["sequenceGap"])["gapBookModelEligible"] = True


def _change_gap_true_bool_to_int(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    _mapping(faults["sequenceGap"])["resyncTriggerObserved"] = 1


def _change_gap_false_bool_to_int(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    _mapping(faults["sequenceGap"])["gapBookModelEligible"] = 0


def _change_mutation(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    rows = _list(faults["mutationRejections"])
    _mapping(rows[0])["rejected"] = False


def _change_mutation_true_bool_to_int(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    rows = _list(faults["mutationRejections"])
    _mapping(rows[0])["rejected"] = 1


def _change_mutation_false_bool_to_int(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    rows = _list(faults["mutationRejections"])
    _mapping(rows[0])["assessmentProduced"] = 0


def _change_expiration(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    _mapping(faults["expiration"])["sourceFreshness"] = "FRESH"


def _change_corruption_digest(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    _mapping(faults["corruption"])["copiedBytesSha256"] = "not-a-digest"


def _change_corruption_to_valid_unaccepted_digest(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    _mapping(faults["corruption"])["copiedBytesSha256"] = "a" * 64


def _change_corruption_bool_to_int(value: dict[str, object]) -> None:
    faults = _mapping(value["faults"])
    _mapping(faults["corruption"])["rejectedBeforeAssessment"] = 1


@pytest.mark.parametrize(
    "mutator",
    [
        _add_root_field,
        _change_proof_version,
        _change_proof_version_to_float,
        _change_action,
        _change_assessment_version,
        _change_assessment_version_to_bool,
        _change_assessment_nested_bool_to_int,
        _change_lineage,
        _change_net_economics,
        _change_stage,
        _change_summary_bool_to_int,
        _change_repeatability_bool_to_int,
        _change_run_count_to_bool,
        _change_run_count_to_float,
        _change_gap,
        _change_gap_true_bool_to_int,
        _change_gap_false_bool_to_int,
        _change_mutation,
        _change_mutation_true_bool_to_int,
        _change_mutation_false_bool_to_int,
        _change_expiration,
        _change_corruption_digest,
        _change_corruption_to_valid_unaccepted_digest,
        _change_corruption_bool_to_int,
    ],
)
def test_strict_validator_rejects_injected_or_forged_proofs(
    proof: dict[str, object],
    protocol: ProtocolContractV1,
    mutator: Callable[[dict[str, object]], None],
) -> None:
    forged = deepcopy(proof)
    mutator(forged)
    with pytest.raises(ReplayProofError):
        validate_replay_fault_proof(forged, protocol=protocol)


@pytest.mark.parametrize(
    ("times", "message"),
    [
        (
            (
                EXPECTED_EVALUATION_TIME_MS + 1,
                EXPECTED_EXPIRED_EVALUATION_TIME_MS,
                EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
            ),
            "clocks",
        ),
        (
            (
                EXPECTED_EVALUATION_TIME_MS,
                EXPECTED_EXPIRED_EVALUATION_TIME_MS + 1,
                EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
            ),
            "clocks",
        ),
        (
            (
                EXPECTED_EVALUATION_TIME_MS,
                EXPECTED_EXPIRED_EVALUATION_TIME_MS,
                EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS - 1,
            ),
            "clocks",
        ),
    ],
)
def test_builder_rejects_noncanonical_injected_clocks(
    fixture_bytes: bytes,
    corrupted_fixture_bytes: bytes,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    times: tuple[int, int, int],
    message: str,
) -> None:
    with pytest.raises(ReplayProofError, match=message):
        _build(
            fixture_bytes,
            corrupted_fixture_bytes,
            lineage,
            protocol,
            evaluation_time_ms=times[0],
            expired_evaluation_time_ms=times[1],
            ambiguous_evaluation_time_ms=times[2],
        )


def test_builder_rejects_tampered_golden_or_corrupt_copy(
    fixture_bytes: bytes,
    corrupted_fixture_bytes: bytes,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
) -> None:
    request = strict_json_object(
        (QUANT_ROOT / REQUEST_RELATIVE_PATH).read_bytes(),
        maximum_bytes=262_144,
    )
    request["requestId"] = "q16.request.tampered"
    with pytest.raises(ReplayProofError, match="committed Q16 digest"):
        _build(
            fixture_bytes,
            corrupted_fixture_bytes,
            lineage,
            protocol,
            request_bytes=canonical_json_bytes(request).removesuffix(b"\n"),
        )
    with pytest.raises(ReplayProofError, match="deterministic forward-gap mutation"):
        _build(fixture_bytes, fixture_bytes, lineage, protocol)
    with pytest.raises(ReplayProofError, match="raw fixture"):
        corrupt_forward_gap_fixture_bytes(fixture_bytes[:-1])


@pytest.mark.parametrize(
    "relative_path",
    [
        "../quant/fixtures/q16_raw_fixture_v1.json",
        "fixtures/./q16_raw_fixture_v1.json",
        "fixtures\\q16_raw_fixture_v1.json",
        "https://example.invalid/q16.json",
        "/absolute/q16.json",
    ],
)
def test_campaign_rejects_traversal_and_nonportable_fixture_paths(
    tmp_path: Path,
    relative_path: str,
) -> None:
    with pytest.raises(ReplayProofError, match="path"):
        run_replay_fault_campaign(
            QUANT_ROOT,
            REPO_ROOT,
            tmp_path,
            fixture_relative_path=relative_path,
            evaluation_time_ms=EXPECTED_EVALUATION_TIME_MS,
            expired_evaluation_time_ms=EXPECTED_EXPIRED_EVALUATION_TIME_MS,
            ambiguous_evaluation_time_ms=EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
        )


def test_campaign_rejects_relative_roots_symlinks_and_existing_copy(tmp_path: Path) -> None:
    with pytest.raises(ReplayProofError, match="absolute"):
        run_replay_fault_campaign(
            Path("quant"),
            REPO_ROOT,
            tmp_path,
            evaluation_time_ms=EXPECTED_EVALUATION_TIME_MS,
            expired_evaluation_time_ms=EXPECTED_EXPIRED_EVALUATION_TIME_MS,
            ambiguous_evaluation_time_ms=EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
        )

    fake_repo = tmp_path / "fake-repo"
    fake_quant = fake_repo / "quant"
    (fake_quant / "fixtures").mkdir(parents=True)
    (fake_quant / FIXTURE_RELATIVE_PATH).symlink_to(QUANT_ROOT / FIXTURE_RELATIVE_PATH)
    with pytest.raises(ReplayProofError, match="symlink"):
        run_replay_fault_campaign(
            fake_quant,
            fake_repo,
            tmp_path,
            evaluation_time_ms=EXPECTED_EVALUATION_TIME_MS,
            expired_evaluation_time_ms=EXPECTED_EXPIRED_EVALUATION_TIME_MS,
            ambiguous_evaluation_time_ms=EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
        )

    existing_root = tmp_path / "existing"
    existing_root.mkdir()
    (existing_root / CORRUPT_COPY_NAME).write_bytes(b"occupied")
    with pytest.raises(ReplayProofError, match="existing path"):
        run_replay_fault_campaign(
            QUANT_ROOT,
            REPO_ROOT,
            existing_root,
            evaluation_time_ms=EXPECTED_EVALUATION_TIME_MS,
            expired_evaluation_time_ms=EXPECTED_EXPIRED_EVALUATION_TIME_MS,
            ambiguous_evaluation_time_ms=EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
        )

    real_copy = tmp_path / "real-copy"
    real_copy.mkdir()
    linked_copy = tmp_path / "linked-copy"
    linked_copy.symlink_to(real_copy, target_is_directory=True)
    with pytest.raises(ReplayProofError, match="real directory"):
        run_replay_fault_campaign(
            QUANT_ROOT,
            REPO_ROOT,
            linked_copy,
            evaluation_time_ms=EXPECTED_EVALUATION_TIME_MS,
            expired_evaluation_time_ms=EXPECTED_EXPIRED_EVALUATION_TIME_MS,
            ambiguous_evaluation_time_ms=EXPECTED_AMBIGUOUS_EVALUATION_TIME_MS,
        )


_OpenPath = str | bytes | os.PathLike[str] | os.PathLike[bytes]


def test_fd_reader_rejects_file_swap_to_outside_symlink(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "root"
    root.mkdir()
    victim = root / "victim.json"
    victim.write_bytes(b"inside")
    outside = tmp_path / "outside.json"
    outside.write_bytes(b"outside-secret")
    original_open = os.open
    swapped = False

    def swapping_open(
        path: _OpenPath,
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        nonlocal swapped
        if path == "victim.json" and dir_fd is not None and not swapped:
            swapped = True
            victim.unlink()
            victim.symlink_to(outside)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", swapping_open)
    with pytest.raises(ReplayProofError, match=r"symlink|identity"):
        replay_module._safe_read(root, "victim.json", field="race fixture")
    assert swapped
    assert victim.is_symlink()
    assert outside.read_bytes() == b"outside-secret"


def test_fd_reader_rejects_parent_swap_to_outside_symlink(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "root"
    parent = root / "parent"
    parent.mkdir(parents=True)
    (parent / "victim.json").write_bytes(b"inside")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "victim.json").write_bytes(b"outside-secret")
    held_parent = root / "held-parent"
    original_open = os.open
    swapped = False

    def swapping_open(
        path: _OpenPath,
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        nonlocal swapped
        if path == "parent" and dir_fd is not None and not swapped:
            swapped = True
            parent.rename(held_parent)
            parent.symlink_to(outside, target_is_directory=True)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", swapping_open)
    with pytest.raises(ReplayProofError, match=r"parent symlink|race"):
        replay_module._safe_read(root, "parent/victim.json", field="race fixture")
    assert swapped
    assert parent.is_symlink()
    assert (outside / "victim.json").read_bytes() == b"outside-secret"


def test_fd_reader_rejects_detached_intermediate_parent_with_recreated_live_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "root"
    live_parent = root / "level-one"
    live_leaf_parent = live_parent / "level-two"
    live_leaf_parent.mkdir(parents=True)
    accepted = b"accepted-identical-bytes"
    (live_leaf_parent / "victim.json").write_bytes(accepted)
    detached_parent = tmp_path / "detached-level-one"
    original_read = os.read
    swapped = False

    def swapping_read(descriptor: int, length: int) -> bytes:
        nonlocal swapped
        if not swapped:
            swapped = True
            live_parent.rename(detached_parent)
            recreated_leaf_parent = live_parent / "level-two"
            recreated_leaf_parent.mkdir(parents=True)
            (recreated_leaf_parent / "victim.json").write_bytes(accepted)
        return original_read(descriptor, length)

    monkeypatch.setattr(os, "read", swapping_read)
    with pytest.raises(ReplayProofError, match="parent-to-child link changed identity"):
        replay_module._safe_read(
            root,
            "level-one/level-two/victim.json",
            field="detached fixture",
        )
    assert swapped
    assert (detached_parent / "level-two" / "victim.json").read_bytes() == accepted
    assert (live_parent / "level-two" / "victim.json").read_bytes() == accepted


def test_fd_reader_rejects_fifo_without_blocking(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    fifo = root / "fixture.fifo"
    os.mkfifo(fifo, mode=0o600)
    with pytest.raises(ReplayProofError, match="identity-stable regular file"):
        replay_module._safe_read(root, "fixture.fifo", field="fifo fixture")


def test_fd_reader_rejects_regular_file_identity_swap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "root"
    root.mkdir()
    victim = root / "victim.json"
    victim.write_bytes(b"accepted")
    held = root / "held.json"
    original_open = os.open
    swapped = False

    def swapping_open(
        path: _OpenPath,
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        nonlocal swapped
        if path == "victim.json" and dir_fd is not None and not swapped:
            swapped = True
            victim.rename(held)
            victim.write_bytes(b"replacement")
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", swapping_open)
    with pytest.raises(ReplayProofError, match="identity-stable"):
        replay_module._safe_read(root, "victim.json", field="race fixture")
    assert swapped
    assert victim.read_bytes() == b"replacement"


def test_fd_copy_rejects_final_entry_swap_and_repo_destination(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    copy_root = tmp_path / "copy"
    copy_root.mkdir()
    outside = tmp_path / "outside.json"
    outside.write_bytes(b"outside-secret")
    held = copy_root / "held-copy.json"
    target = copy_root / CORRUPT_COPY_NAME
    original_stat = os.stat
    swapped = False

    def swapping_stat(
        path: _OpenPath,
        *,
        dir_fd: int | None = None,
        follow_symlinks: bool = True,
    ) -> os.stat_result:
        nonlocal swapped
        if path == CORRUPT_COPY_NAME and dir_fd is not None and not swapped:
            swapped = True
            target.rename(held)
            target.symlink_to(outside)
        return original_stat(path, dir_fd=dir_fd, follow_symlinks=follow_symlinks)

    monkeypatch.setattr(os, "stat", swapping_stat)
    with pytest.raises(ReplayProofError, match="swapped"):
        replay_module._write_corrupt_copy(
            copy_root,
            b"corrupted-fixture",
            forbidden_root=REPO_ROOT,
        )
    assert swapped
    assert target.is_symlink()
    assert outside.read_bytes() == b"outside-secret"

    monkeypatch.setattr(os, "stat", original_stat)
    forbidden_target = QUANT_ROOT / CORRUPT_COPY_NAME
    assert not forbidden_target.exists()
    with pytest.raises(ReplayProofError, match="outside repo_root"):
        replay_module._write_corrupt_copy(
            QUANT_ROOT,
            b"corrupted-fixture",
            forbidden_root=REPO_ROOT,
        )
    assert not forbidden_target.exists()


def test_fd_copy_exclusive_open_rejects_preexisting_symlink(tmp_path: Path) -> None:
    copy_root = tmp_path / "copy"
    copy_root.mkdir()
    outside = tmp_path / "outside.json"
    outside.write_bytes(b"outside-secret")
    target = copy_root / CORRUPT_COPY_NAME
    target.symlink_to(outside)
    with pytest.raises(ReplayProofError, match="existing path, symlink, or race"):
        replay_module._write_corrupt_copy(
            copy_root,
            b"corrupted-fixture",
            forbidden_root=REPO_ROOT,
        )
    assert target.is_symlink()
    assert outside.read_bytes() == b"outside-secret"


def test_validator_rejects_wrong_types_and_non_json_values(protocol: ProtocolContractV1) -> None:
    with pytest.raises(ReplayProofError, match="object"):
        validate_replay_fault_proof(cast(dict[str, object], []), protocol=protocol)
    with pytest.raises(ReplayProofError, match="protocol"):
        validate_replay_fault_proof({}, protocol=cast(ProtocolContractV1, object()))
