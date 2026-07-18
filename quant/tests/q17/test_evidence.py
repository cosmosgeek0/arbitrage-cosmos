from __future__ import annotations

import hashlib
import os
import shutil
import stat
import subprocess
import sys
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import cast

import pytest

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import ContractValueError
from quant_edge.final_proof import evidence
from quant_edge.final_proof.evidence import (
    EvidenceVerificationError,
    project_research_evidence,
    validate_research_evidence_projection,
)

QUANT_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = QUANT_ROOT.parent


def _materialize_evidence(root: Path) -> None:
    for spec in evidence._ARTIFACTS:
        source = REPO_ROOT / spec.relative_path
        target = root / spec.relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


def _parsed_values() -> tuple[dict[str, dict[str, object]], bytes]:
    values: dict[str, dict[str, object]] = {}
    receipt = b""
    for spec in evidence._ARTIFACTS:
        raw = (REPO_ROOT / spec.relative_path).read_bytes()
        if spec.media_type == "text/markdown":
            receipt = raw
        else:
            values[spec.artifact_id] = parse_canonical_object(raw)
    return values, receipt


def test_projector_verifies_exact_evidence_and_preserves_fail_closed_axes() -> None:
    first = project_research_evidence(REPO_ROOT)
    second = project_research_evidence(REPO_ROOT)

    assert first == second
    assert first is not second
    assert first["schema"] == "Q17AcceptedResearchEvidenceV1"
    assert first["version"] == 1
    assert first["axes"] == {
        "evidence": "SYNTHETIC_ONLY",
        "implementation": "BUILT_AND_TESTED",
        "productIntegration": "NOT_CONFIGURED",
    }
    assert first["conclusion"] == {
        "actionability": "ABSTAIN_UNKNOWN",
        "advisoryOnly": True,
        "edgeClaim": "NOT_ESTABLISHED",
        "executionAuthority": False,
        "overallClassification": "DATA_INSUFFICIENT",
    }
    claims = cast(list[dict[str, object]], first["claims"])
    assert {row["classification"] for row in claims} == {
        "SYNTHETIC",
        "REFERENCE_ONLY",
        "DATA_INSUFFICIENT",
        "REJECTED",
        "UNKNOWN",
    }
    erratum = next(
        row for row in claims if row["claimId"] == "q10.quantile-best-trial-documentary-erratum"
    )
    assert erratum["status"] == "DOCUMENTARY_ERRATUM"
    assert erratum["artifactBestTrialIndex"] == 7
    assert erratum["documentaryBestTrialIndex"] == 11
    q14 = next(row for row in claims if row["claimId"] == "q14.synthetic-validation-factory")
    assert q14["status"] == "Q14_FIXTURE_COMPARISON_ONLY_NOT_Q10_OR_Q11_VALIDATION"
    correction_claims = {
        row["claimId"]: row
        for row in claims
        if row["claimId"]
        in {
            "q12.post-acceptance-correction",
            "q15.post-acceptance-correction",
        }
    }
    assert set(correction_claims) == {
        "q12.post-acceptance-correction",
        "q15.post-acceptance-correction",
    }
    assert all(
        row["classification"] == "UNKNOWN"
        and row["status"] == "CURRENT_CORRECTED_BYTES_NOT_ACCEPTED"
        for row in correction_claims.values()
    )
    assert canonical_json_bytes(first)


def test_projection_rows_pin_every_path_size_and_digest() -> None:
    projection = project_research_evidence(REPO_ROOT)
    rows = cast(list[dict[str, object]], projection["artifacts"])
    assert len(rows) == len(evidence._ARTIFACTS) == 10
    assert [row["artifactId"] for row in rows] == [spec.artifact_id for spec in evidence._ARTIFACTS]
    for row in rows:
        path = REPO_ROOT / cast(str, row["relativePath"])
        raw = path.read_bytes()
        assert len(raw) == row["byteLength"]
        assert hashlib.sha256(raw).hexdigest() == row["sha256"]


def test_projection_preserves_historical_acceptance_without_promoting_current_corrections() -> None:
    projection = project_research_evidence(REPO_ROOT)
    artifact_rows = {
        cast(str, row["artifactId"]): row
        for row in cast(list[dict[str, object]], projection["artifacts"])
    }
    corrections = cast(list[dict[str, object]], projection["postAcceptanceCorrections"])
    expected = {
        "Q12": {
            "correctionId": "Q12_RESEARCH_INTEGRITY_LINEAGE_CORRECTION",
            "historical": {
                "q12.ensemble-campaign.v1": (
                    2_376,
                    "ad9d9b1f6ba9ffe3fc59450075f5221792f6c900403775f6820e2da763c28bb2",
                ),
                "q12.ensemble-golden.v1": (
                    153_049,
                    "88382d291f6d0ddb4443888df80ce1d03bc893790ca746d13237b23b58d2bb77",
                ),
            },
            "current": {
                "q12.ensemble-campaign.v1": (
                    2_376,
                    "3230b579cf7d8262761591209bad5dbc024214a3cd5c5fd22fff82e72c3f9863",
                ),
                "q12.ensemble-golden.v1": (
                    153_683,
                    "28d657a80b4c0328529c62e6dccf8631c2cb3574cc399ff27108b192677a942e",
                ),
            },
        },
        "Q15": {
            "correctionId": "Q15_RESEARCH_INTEGRITY_EVALUATION_UNIT_CORRECTION",
            "historical": {
                "q15.registry-campaign.v1": (
                    4_322,
                    "24debb2a96b91338d937b67878c75be2ef38615880c9c0ad8cd30590ac0bd11b",
                ),
                "q15.registry-cards.v1": (
                    16_676,
                    "0457f22f9b713955f654d99b7dcfe9795d84c71c7ec8baf5a927e007d5a08fb5",
                ),
            },
            "current": {
                "q15.registry-campaign.v1": (
                    4_425,
                    "1b93c4ce93d3fa0dee57ff1a38bfec78363921b2173dac0a6db642d46f1ad82d",
                ),
                "q15.registry-cards.v1": (
                    16_676,
                    "88554771ed8f570721bf55c2a28ef8fa5370c3ec34bcfcbf191763d3aed6e844",
                ),
            },
        },
    }

    assert [row["phase"] for row in corrections] == ["Q12", "Q15"]
    for correction in corrections:
        phase = cast(str, correction["phase"])
        phase_expected = expected[phase]
        assert correction["acceptanceState"] == "NOT_ACCEPTED"
        assert correction["correctionId"] == phase_expected["correctionId"]
        assert correction["historicalReceipts"] == "DOES_NOT_ATTEST_CORRECTED_BYTES"
        assert correction["implementationCommit"] == "PENDING_NOT_EMBEDDED"
        assert correction["implementationState"] == (
            "CORRECTION_IMPLEMENTED_PENDING_INDEPENDENT_VERIFICATION"
        )
        assert correction["implementationTree"] == "PENDING_NOT_EMBEDDED"
        assert correction["verificationState"] == ("PENDING_INDEPENDENT_EXACT_COMMIT_VERIFICATION")

        current_rows = {
            cast(str, row["artifactId"]): row
            for row in cast(list[dict[str, object]], correction["currentArtifacts"])
        }
        historical_rows = {
            cast(str, row["artifactId"]): row
            for row in cast(list[dict[str, object]], correction["historicalAcceptedArtifacts"])
        }
        assert (
            set(current_rows)
            == set(historical_rows)
            == set(cast(dict[str, tuple[int, str]], phase_expected["current"]))
        )
        for artifact_id, current_row in current_rows.items():
            current_bytes, current_sha256 = cast(
                dict[str, tuple[int, str]], phase_expected["current"]
            )[artifact_id]
            historical_bytes, historical_sha256 = cast(
                dict[str, tuple[int, str]], phase_expected["historical"]
            )[artifact_id]
            assert current_row == artifact_rows[artifact_id]
            assert (current_row["byteLength"], current_row["sha256"]) == (
                current_bytes,
                current_sha256,
            )
            raw = (REPO_ROOT / cast(str, current_row["relativePath"])).read_bytes()
            assert len(raw) == current_bytes
            assert hashlib.sha256(raw).hexdigest() == current_sha256
            assert (
                historical_rows[artifact_id]["byteLength"],
                historical_rows[artifact_id]["sha256"],
            ) == (historical_bytes, historical_sha256)
            assert historical_sha256 != current_sha256


def test_projection_validator_rejects_correction_promotion_and_historical_relabeling() -> None:
    projection = project_research_evidence(REPO_ROOT)
    promoted = deepcopy(projection)
    promoted_corrections = cast(list[dict[str, object]], promoted["postAcceptanceCorrections"])
    promoted_corrections[0]["acceptanceState"] = "ACCEPTED"
    with pytest.raises(EvidenceVerificationError, match="accepted semantic"):
        validate_research_evidence_projection(promoted)

    relabeled = deepcopy(projection)
    relabeled_corrections = cast(list[dict[str, object]], relabeled["postAcceptanceCorrections"])
    current = cast(list[dict[str, object]], relabeled_corrections[0]["currentArtifacts"])
    historical = cast(
        list[dict[str, object]],
        relabeled_corrections[0]["historicalAcceptedArtifacts"],
    )
    historical[0]["sha256"] = current[0]["sha256"]
    with pytest.raises(EvidenceVerificationError, match="accepted truth"):
        validate_research_evidence_projection(relabeled)


def test_projection_validator_returns_fresh_exact_projection() -> None:
    projection = project_research_evidence(REPO_ROOT)
    validated = validate_research_evidence_projection(deepcopy(projection))
    assert validated == projection
    assert validated is not projection


@pytest.mark.parametrize("value", [None, [], "bad", 1])
def test_projection_validator_rejects_non_objects(value: object) -> None:
    with pytest.raises(EvidenceVerificationError, match="plain object"):
        validate_research_evidence_projection(value)


def test_projection_validator_rejects_non_json_and_unknown_classification() -> None:
    projection = project_research_evidence(REPO_ROOT)
    not_json = deepcopy(projection)
    not_json["extra"] = object()
    with pytest.raises(EvidenceVerificationError, match="JSON-safe"):
        validate_research_evidence_projection(not_json)

    bad_class = deepcopy(projection)
    claims = cast(list[dict[str, object]], bad_class["claims"])
    claims[0]["classification"] = "MARKET_EDGE"
    with pytest.raises(EvidenceVerificationError, match="allowlisted"):
        validate_research_evidence_projection(bad_class)


def test_projection_validator_rejects_missing_extra_and_semantic_substitution() -> None:
    projection = project_research_evidence(REPO_ROOT)
    missing = deepcopy(projection)
    missing.pop("axes")
    with pytest.raises(EvidenceVerificationError, match="schema exact"):
        validate_research_evidence_projection(missing)

    extra = deepcopy(projection)
    extra["extra"] = None
    with pytest.raises(EvidenceVerificationError, match="schema exact"):
        validate_research_evidence_projection(extra)

    substituted = deepcopy(projection)
    claims = cast(list[dict[str, object]], substituted["claims"])
    claims[0]["classification"] = "UNKNOWN"
    with pytest.raises(EvidenceVerificationError, match="accepted truth"):
        validate_research_evidence_projection(substituted)

    wrong_claims = deepcopy(projection)
    wrong_claims["claims"] = {}
    with pytest.raises(EvidenceVerificationError, match="array"):
        validate_research_evidence_projection(wrong_claims)

    non_object_claim = deepcopy(projection)
    cast(list[object], non_object_claim["claims"])[0] = "claim"
    with pytest.raises(EvidenceVerificationError, match="object"):
        validate_research_evidence_projection(non_object_claim)


def test_projection_validator_rejects_bool_int_aliases_at_every_nested_kind() -> None:
    original = project_research_evidence(REPO_ROOT)
    hostile: list[dict[str, object]] = []

    top_version = deepcopy(original)
    top_version["version"] = True
    hostile.append(top_version)

    artifact_size = deepcopy(original)
    cast(list[dict[str, object]], artifact_size["artifacts"])[0]["byteLength"] = True
    hostile.append(artifact_size)

    artifact_version = deepcopy(original)
    cast(list[dict[str, object]], artifact_version["artifacts"])[1]["schemaVersion"] = True
    hostile.append(artifact_version)

    claim_index = deepcopy(original)
    claims = cast(list[dict[str, object]], claim_index["claims"])
    erratum = next(
        row for row in claims if row["claimId"] == "q10.quantile-best-trial-documentary-erratum"
    )
    erratum["artifactBestTrialIndex"] = True
    hostile.append(claim_index)

    advisory = deepcopy(original)
    cast(dict[str, object], advisory["conclusion"])["advisoryOnly"] = 1
    hostile.append(advisory)

    authority = deepcopy(original)
    cast(dict[str, object], authority["conclusion"])["executionAuthority"] = 0
    hostile.append(authority)

    for candidate in hostile:
        with pytest.raises(EvidenceVerificationError, match="accepted truth"):
            validate_research_evidence_projection(candidate)


def test_projector_rejects_relative_absent_non_directory_and_symlink_roots(tmp_path: Path) -> None:
    with pytest.raises(ContractValueError, match="absolute"):
        project_research_evidence(Path("relative"))
    with pytest.raises(EvidenceVerificationError, match="absent"):
        project_research_evidence(tmp_path / "absent")

    file_root = tmp_path / "file"
    file_root.write_text("not a directory")
    with pytest.raises(EvidenceVerificationError, match="non-symlink directory"):
        project_research_evidence(file_root)

    real_root = tmp_path / "real"
    real_root.mkdir()
    link_root = tmp_path / "link"
    link_root.symlink_to(real_root, target_is_directory=True)
    with pytest.raises(EvidenceVerificationError, match="non-symlink directory"):
        project_research_evidence(link_root)


@pytest.mark.parametrize(
    "path",
    ["", "/absolute.json", "../escape.json", "a/./b.json", "a/../b.json", "a\\b", "x://y"],
)
def test_path_parser_rejects_traversal_and_ambiguous_paths(path: str) -> None:
    with pytest.raises(EvidenceVerificationError, match="relative POSIX"):
        evidence._checked_parts(path)


def test_projector_rejects_missing_and_tampered_artifacts(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)

    missing_path = root / evidence._ARTIFACTS[1].relative_path
    missing_path.unlink()
    with pytest.raises(EvidenceVerificationError, match="absent"):
        project_research_evidence(root)

    _materialize_evidence(root)
    tampered = root / evidence._ARTIFACTS[1].relative_path
    tampered.write_bytes(tampered.read_bytes() + b" ")
    with pytest.raises(EvidenceVerificationError, match="size"):
        project_research_evidence(root)

    _materialize_evidence(root)
    raw = bytearray(tampered.read_bytes())
    raw[0] = ord("[")
    tampered.write_bytes(raw)
    with pytest.raises(EvidenceVerificationError, match="digest"):
        project_research_evidence(root)


def test_projector_rejects_file_and_parent_symlinks(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    spec = evidence._ARTIFACTS[5]
    target = root / spec.relative_path
    external = tmp_path / "external.json"
    external.write_bytes(target.read_bytes())
    target.unlink()
    target.symlink_to(external)
    with pytest.raises(EvidenceVerificationError, match="escapes or uses a link"):
        project_research_evidence(root)

    root2 = tmp_path / "repo2"
    root2.mkdir()
    _materialize_evidence(root2)
    generated = root2 / "quant" / "generated"
    moved = root2 / "quant" / "generated-real"
    generated.rename(moved)
    generated.symlink_to(moved, target_is_directory=True)
    with pytest.raises(EvidenceVerificationError, match="escapes or uses a link"):
        project_research_evidence(root2)


def test_projector_rejects_non_regular_artifact(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    path = root / evidence._ARTIFACTS[0].relative_path
    path.unlink()
    path.mkdir()
    with pytest.raises(EvidenceVerificationError, match="regular"):
        project_research_evidence(root)


def test_safe_open_failures_are_wrapped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    original_open = os.open

    def fail_root(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        rendered = os.fspath(path)
        if isinstance(rendered, str) and Path(rendered) == root:
            raise PermissionError("denied")
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", fail_root)
    with pytest.raises(EvidenceVerificationError, match="cannot be opened safely"):
        project_research_evidence(root)


def test_every_descriptor_open_is_nonblocking_and_close_on_exec_when_available(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    observed_flags: list[int] = []
    original_open = os.open

    def recording_open(
        path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
        flags: int,
        mode: int = 0o777,
        *,
        dir_fd: int | None = None,
    ) -> int:
        observed_flags.append(flags)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(os, "open", recording_open)
    project_research_evidence(root)

    assert observed_flags
    assert all(flags & os.O_NONBLOCK for flags in observed_flags)
    if hasattr(os, "O_CLOEXEC"):
        assert all(flags & os.O_CLOEXEC for flags in observed_flags)


def test_reader_fails_closed_when_nonblocking_open_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with monkeypatch.context() as patch:
        patch.delattr(os, "O_NONBLOCK")
        with pytest.raises(EvidenceVerificationError, match="lacks non-blocking"):
            evidence._descriptor_flags(directory=False)


def test_fifo_artifact_fails_closed_without_hanging(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    fifo = root / evidence._ARTIFACTS[0].relative_path
    fifo.unlink()
    os.mkfifo(fifo)
    probe = """
import sys
from pathlib import Path
from quant_edge.final_proof import evidence

root = Path(sys.argv[1])
resolved, before = evidence._require_root(root)
try:
    evidence._read_exact_artifact(resolved, before, evidence._ARTIFACTS[0])
except evidence.EvidenceVerificationError as error:
    if "regular non-symlink file" not in str(error):
        raise
else:
    raise AssertionError("FIFO evidence was accepted")
"""

    completed = subprocess.run(
        [sys.executable, "-c", probe, str(root)],
        cwd=QUANT_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=3.0,
    )

    assert completed.returncode == 0, completed.stderr


def test_reader_rejects_hard_linked_artifact(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    target = root / evidence._ARTIFACTS[0].relative_path
    os.link(target, root / "receipt-hard-link")

    with pytest.raises(EvidenceVerificationError, match="identity-stable regular"):
        project_research_evidence(root)


def test_safe_open_rejects_root_identity_parent_and_file_races(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    original_fstat = os.fstat

    def changed_root_fstat(fd: int) -> os.stat_result:
        observed = original_fstat(fd)
        values = list(observed)
        values[stat.ST_INO] += 1
        return os.stat_result(values)

    with monkeypatch.context() as patch:
        patch.setattr(os, "fstat", changed_root_fstat)
        with pytest.raises(EvidenceVerificationError, match="changed while opening"):
            project_research_evidence(root)

    original_open = os.open

    def deny_named(name: str) -> object:
        def denied_open(
            path: str | bytes | os.PathLike[str] | os.PathLike[bytes],
            flags: int,
            mode: int = 0o777,
            *,
            dir_fd: int | None = None,
        ) -> int:
            rendered = os.fspath(path)
            if rendered == name:
                raise PermissionError("denied")
            return original_open(path, flags, mode, dir_fd=dir_fd)

        return denied_open

    with monkeypatch.context() as patch:
        patch.setattr(os, "open", deny_named("quant"))
        with pytest.raises(EvidenceVerificationError, match="parent path"):
            project_research_evidence(root)

    with monkeypatch.context() as patch:
        patch.setattr(os, "open", deny_named("Q10.md"))
        with pytest.raises(EvidenceVerificationError, match="file cannot be opened"):
            project_research_evidence(root)


def test_bounded_reader_rejects_short_read_and_root_replacement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    resolved, before = evidence._require_root(root)

    with monkeypatch.context() as patch:
        patch.setattr(os, "read", lambda _descriptor, _size: b"")
        with pytest.raises(EvidenceVerificationError, match="changed during"):
            evidence._read_exact_artifact(resolved, before, evidence._ARTIFACTS[0])

    original_lstat = Path.lstat

    def missing_root(path: Path) -> os.stat_result:
        if path == root:
            raise FileNotFoundError("removed")
        return original_lstat(path)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "lstat", missing_root)
        with pytest.raises(EvidenceVerificationError, match="disappeared"):
            evidence._read_exact_artifact(resolved, before, evidence._ARTIFACTS[0])

    def changed_root(path: Path) -> os.stat_result:
        observed = original_lstat(path)
        if path == root:
            values = list(observed)
            values[stat.ST_INO] += 1
            return os.stat_result(values)
        return observed

    with monkeypatch.context() as patch:
        patch.setattr(Path, "lstat", changed_root)
        with pytest.raises(EvidenceVerificationError, match="changed during verification"):
            evidence._read_exact_artifact(resolved, before, evidence._ARTIFACTS[0])


def test_bounded_reader_rejects_intermediate_parent_rename_recreate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    resolved, before = evidence._require_root(root)
    parent = root / "quant" / "RECEIPTS"
    moved = root / "quant" / "RECEIPTS-original"
    original_read = os.read
    swapped = False

    def swap_parent_then_read(descriptor: int, size: int) -> bytes:
        nonlocal swapped
        if not swapped:
            swapped = True
            parent.rename(moved)
            parent.mkdir()
            shutil.copyfile(moved / "Q10.md", parent / "Q10.md")
        return original_read(descriptor, size)

    monkeypatch.setattr(os, "read", swap_parent_then_read)
    with pytest.raises(EvidenceVerificationError, match="parent path changed"):
        evidence._read_exact_artifact(resolved, before, evidence._ARTIFACTS[0])


def test_bounded_reader_rejects_leaf_atomic_replacement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _materialize_evidence(root)
    resolved, before = evidence._require_root(root)
    target = root / evidence._ARTIFACTS[0].relative_path
    replacement = target.with_name("Q10-replacement.md")
    replacement.write_bytes(target.read_bytes())
    original_read = os.read
    swapped = False

    def replace_leaf_then_read(descriptor: int, size: int) -> bytes:
        nonlocal swapped
        if not swapped:
            swapped = True
            replacement.replace(target)
        return original_read(descriptor, size)

    monkeypatch.setattr(os, "read", replace_leaf_then_read)
    with pytest.raises(EvidenceVerificationError, match="changed during its bounded read"):
        evidence._read_exact_artifact(resolved, before, evidence._ARTIFACTS[0])


def test_projector_wraps_bad_json_specs_and_requires_documentary_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    campaign = evidence._ARTIFACTS[1]
    incomplete = replace(campaign, top_level_keys=None)
    with monkeypatch.context() as patch:
        patch.setattr(evidence, "_ARTIFACTS", (incomplete,))
        with pytest.raises(EvidenceVerificationError, match="canonical schema-exact"):
            project_research_evidence(REPO_ROOT)

    receipt = evidence._ARTIFACTS[0]
    non_json = replace(
        receipt,
        media_type="application/json",
        schema_name="ReceiptV1",
        schema_version=1,
        top_level_keys=("schema", "version"),
    )
    with monkeypatch.context() as patch:
        patch.setattr(evidence, "_ARTIFACTS", (non_json,))
        with pytest.raises(EvidenceVerificationError, match="canonical schema-exact"):
            project_research_evidence(REPO_ROOT)

    json_only = tuple(spec for spec in evidence._ARTIFACTS if spec.media_type == "application/json")
    with monkeypatch.context() as patch:
        patch.setattr(evidence, "_ARTIFACTS", json_only)
        with pytest.raises(EvidenceVerificationError, match="documentary evidence is absent"):
            project_research_evidence(REPO_ROOT)


def test_semantic_validators_reject_ambiguous_or_promoted_truth() -> None:
    values, receipt = _parsed_values()
    evidence._validate_q10(deepcopy(values), receipt)
    evidence._validate_q12(deepcopy(values))
    evidence._validate_q13(deepcopy(values))
    evidence._validate_q14(deepcopy(values))
    evidence._validate_q15(deepcopy(values))

    duplicate_study = deepcopy(values)
    summaries = cast(
        list[dict[str, object]],
        duplicate_study["q10.model-campaign.v1"]["studySummaries"],
    )
    summaries[1]["studyId"] = summaries[0]["studyId"]
    with pytest.raises(EvidenceVerificationError, match="ambiguous"):
        evidence._validate_q10(duplicate_study, receipt)

    missing_disposition = deepcopy(values)
    battery = cast(dict[str, object], missing_disposition["q10.model-golden.v1"]["battery"])
    dispositions = cast(list[dict[str, object]], battery["dispositions"])
    dispositions[:] = [row for row in dispositions if row["bulletId"] != "14.3-02-lightgbm"]
    with pytest.raises(EvidenceVerificationError, match="absent"):
        evidence._validate_q10(missing_disposition, receipt)

    duplicate_disposition = deepcopy(values)
    duplicate_battery = cast(
        dict[str, object], duplicate_disposition["q10.model-golden.v1"]["battery"]
    )
    duplicate_rows = cast(list[dict[str, object]], duplicate_battery["dispositions"])
    duplicate_rows.append(deepcopy(duplicate_rows[0]))
    with pytest.raises(EvidenceVerificationError, match="duplicated"):
        evidence._validate_q10(duplicate_disposition, receipt)

    with pytest.raises(EvidenceVerificationError, match="erratum"):
        evidence._validate_q10(deepcopy(values), b"not the receipt\n")

    promoted_q12 = deepcopy(values)
    actions = cast(dict[str, object], promoted_q12["q12.ensemble-campaign.v1"]["abstentionActions"])
    actions["costUnknown"] = "WATCH"
    with pytest.raises(EvidenceVerificationError, match="accepted semantic"):
        evidence._validate_q12(promoted_q12)

    promoted_q13 = deepcopy(values)
    promoted_q13["q13.data-sufficiency.v1"]["trainingPermitted"] = True
    with pytest.raises(EvidenceVerificationError, match="accepted semantic"):
        evidence._validate_q13(promoted_q13)

    promoted_q14 = deepcopy(values)
    promoted_q14["q14.validation-campaign.v1"]["temporalRejections"] = 0
    with pytest.raises(EvidenceVerificationError, match="accepted semantic"):
        evidence._validate_q14(promoted_q14)

    ambiguous_q15 = deepcopy(values)
    cards = cast(list[dict[str, object]], ambiguous_q15["q15.registry-cards.v1"]["modelCards"])
    cards.append(deepcopy(next(row for row in cards if row["modelId"] == "logistic:v1")))
    with pytest.raises(EvidenceVerificationError, match="ambiguous"):
        evidence._validate_q15(ambiguous_q15)

    inflated_q15 = deepcopy(values)
    evaluation_counts = cast(
        dict[str, object], inflated_q15["q15.registry-campaign.v1"]["shadowEvaluationCounts"]
    )
    evaluation_counts["evaluationUnitCount"] = 2
    with pytest.raises(EvidenceVerificationError, match="accepted semantic"):
        evidence._validate_q15(inflated_q15)


def test_low_level_type_and_key_guards_reject_hostile_values() -> None:
    with pytest.raises(EvidenceVerificationError, match="object"):
        evidence._require_mapping([], path="$")
    with pytest.raises(EvidenceVerificationError, match="keys must be text"):
        evidence._require_mapping({1: "bad"}, path="$")
    with pytest.raises(EvidenceVerificationError, match="array"):
        evidence._require_list({}, path="$")
    with pytest.raises(EvidenceVerificationError, match="accepted semantic"):
        evidence._expect(True, 1, path="$.typed")
    with pytest.raises(EvidenceVerificationError, match="schema exact"):
        evidence._exact_keys({"x": 1}, ("y",), path="$")


def test_private_reader_rejects_injected_traversal_spec(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    _, before = evidence._require_root(root)
    forged = evidence._ArtifactSpec(
        artifact_id="forged",
        relative_path="../outside.json",
        sha256="0" * 64,
        byte_length=1,
        media_type="application/json",
        schema_name="ForgedV1",
        schema_version=1,
        top_level_keys=("schema", "version"),
    )
    with pytest.raises(EvidenceVerificationError, match="relative POSIX"):
        evidence._read_exact_artifact(root, before, forged)
