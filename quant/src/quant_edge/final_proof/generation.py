"""Q17 final proof-kit composition and exact-directory verification."""

from __future__ import annotations

import hashlib
import os
import re
import stat
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Final, cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import CanonicalJsonError, QuantEdgeError
from quant_edge.final_proof.benchmark import validate_q17_benchmark
from quant_edge.final_proof.components import validate_component_manifest
from quant_edge.final_proof.evidence import (
    project_research_evidence,
    validate_research_evidence_projection,
)
from quant_edge.final_proof.replay import validate_replay_fault_proof
from quant_edge.final_proof.security import (
    FROZEN_Q_LANE_FILES_SHA256,
    scan_python_files,
    scan_python_tree,
    verify_changed_path_scope,
    verify_frozen_files,
)
from quant_edge.inference.protocol import ProtocolContractV1


class Q17ArtifactError(QuantEdgeError):
    """Q17 generated evidence is incomplete, unsafe, or semantically false."""


_SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")
_MAX_ARTIFACT_BYTES: Final = 8 * 1024 * 1024
_GENERATED_PREFIX: Final = "generated/q17/"
_MANIFEST_NAME: Final = "artifact_manifest.v1.json"
_OUTPUT_NAMES: Final = (
    "accepted_research_evidence.v1.json",
    "benchmark.v1.json",
    "component_manifest.v1.json",
    "end_to_end_proof.v1.json",
    "fault_campaign.v1.json",
    "integration_instructions.md",
    "security_scope.v1.json",
)
_ALL_NAMES: Final = tuple(sorted((*_OUTPUT_NAMES, _MANIFEST_NAME)))
_EXPECTED_ARTIFACT_PATHS: Final = tuple(f"{_GENERATED_PREFIX}{name}" for name in _ALL_NAMES)
_TEMP_NAMES: Final = {name: f".{name}.q17-tmp" for name in _ALL_NAMES}
_DIRECTORY_FLAGS: Final = (
    os.O_RDONLY
    | getattr(os, "O_DIRECTORY", 0)
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_NONBLOCK", 0)
    | getattr(os, "O_CLOEXEC", 0)
)
_READ_FLAGS: Final = (
    os.O_RDONLY
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_NONBLOCK", 0)
    | getattr(os, "O_CLOEXEC", 0)
)
_WRITE_FLAGS: Final = (
    os.O_WRONLY
    | os.O_CREAT
    | os.O_EXCL
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_NONBLOCK", 0)
    | getattr(os, "O_CLOEXEC", 0)
)

EXPECTED_C17_PATHS: Final = (
    "quant/DECISIONS/Q17-001-FINAL-PROOF.md",
    "quant/QUANT_EDGE_BUILD_STATE.md",
    "quant/RECEIPTS/Q17.md",
    "quant/TASKS/Q17.md",
    "quant/docs/Q17_END_TO_END_ACCEPTANCE.md",
    "quant/generated/q17/accepted_research_evidence.v1.json",
    "quant/generated/q17/artifact_manifest.v1.json",
    "quant/generated/q17/benchmark.v1.json",
    "quant/generated/q17/component_manifest.v1.json",
    "quant/generated/q17/end_to_end_proof.v1.json",
    "quant/generated/q17/fault_campaign.v1.json",
    "quant/generated/q17/integration_instructions.md",
    "quant/generated/q17/security_scope.v1.json",
    "quant/scripts/q17_acceptance_campaign.py",
    "quant/src/quant_edge/final_proof/__init__.py",
    "quant/src/quant_edge/final_proof/benchmark.py",
    "quant/src/quant_edge/final_proof/components.py",
    "quant/src/quant_edge/final_proof/evidence.py",
    "quant/src/quant_edge/final_proof/generation.py",
    "quant/src/quant_edge/final_proof/replay.py",
    "quant/src/quant_edge/final_proof/security.py",
    "quant/tests/q17/__init__.py",
    "quant/tests/q17/test_benchmark.py",
    "quant/tests/q17/test_component_manifest.py",
    "quant/tests/q17/test_evidence.py",
    "quant/tests/q17/test_generation.py",
    "quant/tests/q17/test_replay_faults.py",
    "quant/tests/q17/test_security.py",
)

FROZEN_FILE_SHA256: Final = FROZEN_Q_LANE_FILES_SHA256

TRUSTED_SOURCE_SHA256: Final = {
    "cli.py": "56e110936b16370ca1e7cf1e0b9fd6668dce203f910f42d4370e12e0a716812f",
    "final_proof/benchmark.py": (
        "0f216c5de272ec1756b5b5cfd06aae73682aa7701529bb74ed7437cb6ea7f797"
    ),
    "inference/transport.py": ("f3ab8e8a9a6cd29776c153ddd52cc673f627c9dcdd9fa9c01078c55cf8e44769"),
}


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _object(value: object, *, field: str) -> dict[str, object]:
    if type(value) is not dict or any(not isinstance(key, str) for key in value):
        raise Q17ArtifactError(f"{field} must be a plain object with text keys")
    return cast(dict[str, object], value)


def _array(value: object, *, field: str) -> list[object]:
    if not isinstance(value, list):
        raise Q17ArtifactError(f"{field} must be an array")
    return cast(list[object], value)


def _exact(value: dict[str, object], keys: set[str], *, field: str) -> None:
    if set(value) != keys:
        raise Q17ArtifactError(f"{field} fields are not exact")


def _is_int(value: object, *, minimum: int = 0) -> bool:
    return type(value) is int and value >= minimum


def _is_sha256(value: object) -> bool:
    return isinstance(value, str) and _SHA256_RE.fullmatch(value) is not None


def _safe_name(value: object) -> str:
    if not isinstance(value, str):
        raise Q17ArtifactError("artifact path is not an exact Q17 output")
    path = PurePosixPath(value)
    if path.is_absolute() or len(path.parts) != 1 or "\\" in value or "://" in value:
        raise Q17ArtifactError("artifact path is unsafe")
    if value not in _OUTPUT_NAMES:
        raise Q17ArtifactError("artifact path is not an exact Q17 output")
    return value


def _validate_scan(value: object, *, field: str) -> dict[str, object]:
    scan = _object(value, field=field)
    _exact(
        scan,
        {
            "clean",
            "findingCount",
            "findings",
            "scannedFiles",
            "schema",
            "sourceSetSha256",
            "version",
        },
        field=field,
    )
    if not (
        scan["schema"] == "Q17SecurityScanV1"
        and type(scan["version"]) is int
        and scan["version"] == 1
        and type(scan["clean"]) is bool
        and scan["clean"] is True
        and type(scan["findingCount"]) is int
        and scan["findingCount"] == 0
        and scan["findings"] == []
        and _is_int(scan["scannedFiles"], minimum=1)
        and _is_sha256(scan["sourceSetSha256"])
    ):
        raise Q17ArtifactError(f"{field} is not a clean exact security scan")
    return scan


def validate_security_scope(repo_root: Path, value: object) -> dict[str, object]:
    """Recompute source/frozen/scope evidence and compare canonical bytes."""

    mapping = _object(value, field="security scope")
    _exact(
        mapping,
        {
            "actualStagedCommitScope",
            "advisoryOnly",
            "conclusion",
            "declaredC17PathScope",
            "frozenFiles",
            "posture",
            "schema",
            "scopeEvidenceClass",
            "securityScan",
            "version",
        },
        field="security scope",
    )
    scans = _object(mapping["securityScan"], field="securityScan")
    _exact(scans, {"campaignScript", "sourceTree"}, field="securityScan")
    _validate_scan(scans["sourceTree"], field="securityScan.sourceTree")
    _validate_scan(scans["campaignScript"], field="securityScan.campaignScript")
    conclusion = _object(mapping["conclusion"], field="security conclusion")
    expected_conclusion = {
        "executionAuthority": False,
        "externalNetwork": False,
        "forbiddenFindings": 0,
        "moneyAuthority": False,
        "secretAccess": False,
    }
    if canonical_json_bytes(conclusion) != canonical_json_bytes(expected_conclusion):
        raise Q17ArtifactError("security conclusion is not fail-closed")
    if not (
        mapping["schema"] == "Q17SecurityScopeV1"
        and type(mapping["version"]) is int
        and mapping["version"] == 1
        and type(mapping["advisoryOnly"]) is bool
        and mapping["advisoryOnly"] is True
        and mapping["posture"] == "ADVISORY_ONLY"
        and mapping["scopeEvidenceClass"] == "DECLARED_EXPECTED_C17_INVENTORY"
        and mapping["actualStagedCommitScope"] == "NOT_MEASURED_RESERVED_FOR_Q17_RECEIPT"
    ):
        raise Q17ArtifactError("security scope identity is invalid")

    expected_source = scan_python_tree(
        repo_root / "quant" / "src" / "quant_edge",
        trusted_source_sha256=TRUSTED_SOURCE_SHA256,
    )
    expected_source.require_clean()
    expected_campaign = scan_python_files(
        repo_root,
        ("quant/scripts/q17_acceptance_campaign.py",),
        trusted_source_sha256=TRUSTED_SOURCE_SHA256,
    )
    expected_campaign.require_clean()
    expected_frozen = verify_frozen_files(repo_root, FROZEN_FILE_SHA256)
    expected_frozen.require_clean()
    expected_scope = verify_changed_path_scope(EXPECTED_C17_PATHS)
    expected_scope.require_clean()
    expected = {
        "actualStagedCommitScope": "NOT_MEASURED_RESERVED_FOR_Q17_RECEIPT",
        "advisoryOnly": True,
        "conclusion": expected_conclusion,
        "declaredC17PathScope": expected_scope.as_mapping(),
        "frozenFiles": expected_frozen.as_mapping(),
        "posture": "ADVISORY_ONLY",
        "schema": "Q17SecurityScopeV1",
        "scopeEvidenceClass": "DECLARED_EXPECTED_C17_INVENTORY",
        "securityScan": {
            "campaignScript": expected_campaign.as_mapping(),
            "sourceTree": expected_source.as_mapping(),
        },
        "version": 1,
    }
    if canonical_json_bytes(mapping) != canonical_json_bytes(expected):
        raise Q17ArtifactError("security scope differs from recomputed current truth")
    return expected


def _integration_instructions() -> bytes:
    lines = [
        "# Q17 integration instructions (advisory-only lane)",
        "",
        "## Current truth",
        "",
        "- Q17 is isolated proof evidence; product integration is `NOT_CONFIGURED`.",
        "- The current action is `ABSTAIN_UNKNOWN`; health is `DEGRADED` and",
        "  serviceability is `SAFE_ABSTAIN_ONLY`.",
        "- There is no loadable accepted champion, real-market edge claim,",
        "  capital/risk approval, order, transfer, withdrawal, borrow/repay or",
        "  execution authority.",
        "",
        "## Accepted local Q16 startup (no dedicated CLI exists)",
        "",
        "Construct `build_serving_manifest(QUANT_ROOT)`, then",
        "`load_serving_lineage(QUANT_ROOT, manifest)`,",
        "`ProtocolContractV1.load(REPO_ROOT)`, and `LocalInferenceServiceV1`.",
        "Create `create_unix_server(path=SOCKET_PATH, service=service,",
        "fallback_now_ms=trusted_clock_ms)`, call",
        "`handle.server.serve_forever()` inside `try`, and always call",
        "`handle.close()` in `finally`.",
        "The UDS parent/socket modes remain `0700`/`0600`; optional TCP is literal",
        "loopback only. Treat timeout, malformed response, protocol error,",
        "stale/gapped evidence or any blocker as no assessment.",
        "",
        "## Director-owned future integration",
        "",
        "1. Pin exact C17/A17 and all generated artifact hashes on a director integration branch.",
        "2. Add only a narrow adapter into the existing systemIntegration composition",
        "   root; do not create a second source, cache, model registry, risk gate,",
        "   store or socket owner.",
        "3. Preserve raw evidence/lineage and `ABSTAIN_UNKNOWN`; never translate it",
        "   into an actionable proposal.",
        "4. Re-run cross-language, stale, gap, timeout, restart, security, supervisor",
        "   and cockpit truth gates before any wiring claim.",
        "5. Keep `LIVE_EXECUTION_NOT_IMPLEMENTED`; Q17 authorizes no Main edit,",
        "   deployment, process restart, signed/private call or money path.",
        "",
        "`quant/scripts/q17_acceptance_campaign.py` generates evidence only. It is",
        "not an inference-service startup command.",
        "",
    ]
    return "\n".join(lines).encode()


def _split_replay(value: dict[str, object]) -> tuple[dict[str, object], dict[str, object]]:
    proof = {
        "assessmentEnvelope": value["assessmentEnvelope"],
        "assessmentSummary": value["assessmentSummary"],
        "posture": value["posture"],
        "protocolSchemaSha256": value["protocolSchemaSha256"],
        "repeatability": value["repeatability"],
        "schema": "Q17EndToEndProofV1",
        "status": value["status"],
        "version": 1,
    }
    faults = {
        "assessmentSha256": _object(value["assessmentSummary"], field="assessmentSummary")[
            "assessmentSha256"
        ],
        "faults": value["faults"],
        "posture": value["posture"],
        "schema": "Q17FaultCampaignV1",
        "status": value["status"],
        "version": 1,
    }
    return proof, faults


def _join_replay(
    proof: dict[str, object],
    faults: dict[str, object],
) -> dict[str, object]:
    _exact(
        proof,
        {
            "assessmentEnvelope",
            "assessmentSummary",
            "posture",
            "protocolSchemaSha256",
            "repeatability",
            "schema",
            "status",
            "version",
        },
        field="end-to-end proof",
    )
    _exact(
        faults,
        {"assessmentSha256", "faults", "posture", "schema", "status", "version"},
        field="fault campaign",
    )
    if not (
        proof["schema"] == "Q17EndToEndProofV1"
        and faults["schema"] == "Q17FaultCampaignV1"
        and type(proof["version"]) is int
        and proof["version"] == 1
        and type(faults["version"]) is int
        and faults["version"] == 1
        and proof["posture"] == faults["posture"] == "SYNTHETIC_ONLY"
        and proof["status"] == faults["status"] == "PASS_FAIL_CLOSED"
    ):
        raise Q17ArtifactError("split replay artifact identity is invalid")
    summary = _object(proof["assessmentSummary"], field="assessmentSummary")
    if faults["assessmentSha256"] != summary.get("assessmentSha256"):
        raise Q17ArtifactError("fault campaign assessment identity is inconsistent")
    return {
        "assessmentEnvelope": proof["assessmentEnvelope"],
        "assessmentSummary": proof["assessmentSummary"],
        "faults": faults["faults"],
        "posture": proof["posture"],
        "protocolSchemaSha256": proof["protocolSchemaSha256"],
        "repeatability": proof["repeatability"],
        "schema": "Q17ReplayFaultProofV1",
        "status": proof["status"],
        "version": 1,
    }


def _artifact_manifest(artifacts: dict[str, bytes]) -> bytes:
    rows = [
        {
            "byteLength": len(raw),
            "relativePath": f"{_GENERATED_PREFIX}{name}",
            "sha256": _sha256(raw),
        }
        for name, raw in sorted(artifacts.items())
    ]
    return canonical_json_bytes(
        {
            "artifacts": rows,
            "excludedSelf": f"{_GENERATED_PREFIX}{_MANIFEST_NAME}",
            "finalAction": "ABSTAIN_UNKNOWN",
            "generator": "quant_edge.final_proof.generation:build_q17_artifacts",
            "posture": "ADVISORY_ONLY",
            "schema": "Q17ArtifactManifestV1",
            "version": 1,
        }
    )


def build_q17_artifacts(
    repo_root: Path,
    *,
    replay_proof: dict[str, object],
    research_evidence: dict[str, object],
    benchmark: dict[str, object],
    security_scope: dict[str, object],
    component_manifest: dict[str, object],
) -> dict[str, bytes]:
    """Validate every current input and build the exact eight-file Q17 kit."""

    protocol = ProtocolContractV1.load(repo_root)
    validate_replay_fault_proof(replay_proof, protocol=protocol)
    evidence = validate_research_evidence_projection(research_evidence)
    current_evidence = project_research_evidence(repo_root)
    if canonical_json_bytes(evidence) != canonical_json_bytes(current_evidence):
        raise Q17ArtifactError("research evidence does not match current repo truth")
    validate_q17_benchmark(benchmark, repo_root=repo_root)
    security = validate_security_scope(repo_root, security_scope)
    components = validate_component_manifest(repo_root, component_manifest)
    proof, faults = _split_replay(replay_proof)
    artifacts = {
        "accepted_research_evidence.v1.json": canonical_json_bytes(current_evidence),
        "benchmark.v1.json": canonical_json_bytes(benchmark),
        "component_manifest.v1.json": canonical_json_bytes(components),
        "end_to_end_proof.v1.json": canonical_json_bytes(proof),
        "fault_campaign.v1.json": canonical_json_bytes(faults),
        "integration_instructions.md": _integration_instructions(),
        "security_scope.v1.json": canonical_json_bytes(security),
    }
    artifacts[_MANIFEST_NAME] = _artifact_manifest(artifacts)
    return {f"{_GENERATED_PREFIX}{name}": raw for name, raw in sorted(artifacts.items())}


_DirectoryIdentity = tuple[int, int]
_FileIdentity = tuple[int, int, int, int, int, int, int]


def _directory_identity(info: os.stat_result) -> _DirectoryIdentity:
    if not stat.S_ISDIR(info.st_mode):
        raise Q17ArtifactError("Q17 directory hierarchy contains a non-directory entry")
    return info.st_dev, info.st_ino


def _file_identity(info: os.stat_result) -> _FileIdentity:
    return (
        info.st_dev,
        info.st_ino,
        info.st_mode,
        info.st_nlink,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
    )


def _require_regular(
    info: os.stat_result,
    *,
    require_nonempty: bool,
    require_mode: bool,
) -> _FileIdentity:
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or info.st_size > _MAX_ARTIFACT_BYTES
        or (require_nonempty and info.st_size < 1)
        or (require_mode and stat.S_IMODE(info.st_mode) != 0o644)
    ):
        raise Q17ArtifactError("Q17 artifact must be a unique bounded regular 0644 file")
    return _file_identity(info)


@dataclass(slots=True)
class _DirectoryChain:
    root_path: Path
    root_identity: _DirectoryIdentity
    descriptors: list[int] = field(default_factory=list)
    edges: list[tuple[int, str, int, _DirectoryIdentity]] = field(default_factory=list)

    @property
    def current_fd(self) -> int:
        if not self.descriptors:
            raise Q17ArtifactError("Q17 directory hierarchy is closed")
        return self.descriptors[-1]

    def append(self, name: str) -> None:
        parent_fd = self.current_fd
        child_fd = -1
        try:
            before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            before_identity = _directory_identity(before)
            child_fd = os.open(name, _DIRECTORY_FLAGS, dir_fd=parent_fd)
            opened_identity = _directory_identity(os.fstat(child_fd))
            after_identity = _directory_identity(
                os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            )
            if before_identity != opened_identity or opened_identity != after_identity:
                raise Q17ArtifactError("Q17 directory hierarchy changed while opening")
        except OSError as error:
            if child_fd >= 0:
                os.close(child_fd)
            raise Q17ArtifactError("Q17 directory hierarchy cannot be opened safely") from error
        except Q17ArtifactError:
            if child_fd >= 0:
                os.close(child_fd)
            raise
        self.descriptors.append(child_fd)
        self.edges.append((parent_fd, name, child_fd, opened_identity))

    def revalidate(self) -> None:
        try:
            if _directory_identity(self.root_path.lstat()) != self.root_identity:
                raise Q17ArtifactError("Q17 directory root was replaced")
            if _directory_identity(os.fstat(self.descriptors[0])) != self.root_identity:
                raise Q17ArtifactError("Q17 opened directory root changed")
            for parent_fd, name, child_fd, expected in self.edges:
                named = _directory_identity(os.stat(name, dir_fd=parent_fd, follow_symlinks=False))
                opened = _directory_identity(os.fstat(child_fd))
                if named != expected or opened != expected:
                    raise Q17ArtifactError("Q17 directory hierarchy was replaced")
        except OSError as error:
            raise Q17ArtifactError("Q17 directory hierarchy cannot be revalidated") from error

    def close(self) -> None:
        while self.descriptors:
            os.close(self.descriptors.pop())


def _open_directory_chain(directory: Path) -> _DirectoryChain:
    if not isinstance(directory, Path) or not directory.is_absolute():
        raise Q17ArtifactError("Q17 artifact directory must be an absolute Path")
    try:
        resolved = directory.resolve(strict=True)
    except OSError as error:
        raise Q17ArtifactError("Q17 artifact directory is unavailable") from error
    if resolved != directory:
        raise Q17ArtifactError("Q17 artifact directory hierarchy must not use links")
    root_path = Path(directory.anchor)
    root_fd = -1
    chain: _DirectoryChain | None = None
    try:
        root_identity = _directory_identity(root_path.lstat())
        root_fd = os.open(root_path, _DIRECTORY_FLAGS)
        if _directory_identity(os.fstat(root_fd)) != root_identity:
            raise Q17ArtifactError("Q17 directory root changed while opening")
        chain = _DirectoryChain(root_path, root_identity, [root_fd])
        root_fd = -1
        for part in directory.parts[1:]:
            chain.append(part)
        chain.revalidate()
        return chain
    except OSError as error:
        if chain is not None:
            chain.close()
        elif root_fd >= 0:
            os.close(root_fd)
        raise Q17ArtifactError("Q17 directory hierarchy cannot be opened safely") from error
    except Q17ArtifactError:
        if chain is not None:
            chain.close()
        elif root_fd >= 0:
            os.close(root_fd)
        raise


def _stat_entry(directory_fd: int, name: str) -> os.stat_result | None:
    try:
        return os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    except OSError as error:
        raise Q17ArtifactError(f"Q17 artifact entry cannot be inspected: {name}") from error


def _inspect_inventory(
    directory_fd: int,
    *,
    exact: bool,
    allow_temps: bool,
    require_mode: bool,
) -> dict[str, _FileIdentity]:
    try:
        names = tuple(sorted(os.listdir(directory_fd)))
    except OSError as error:
        raise Q17ArtifactError("Q17 artifact inventory cannot be listed safely") from error
    allowed = set(_ALL_NAMES)
    if allow_temps:
        allowed.update(_TEMP_NAMES.values())
    if (exact and names != _ALL_NAMES) or any(name not in allowed for name in names):
        raise Q17ArtifactError("Q17 artifact inventory is not exact")
    identities: dict[str, _FileIdentity] = {}
    for name in names:
        info = _stat_entry(directory_fd, name)
        if info is None:
            raise Q17ArtifactError("Q17 artifact inventory changed during inspection")
        identity = _require_regular(
            info,
            require_nonempty=exact,
            require_mode=require_mode,
        )
        identities[name] = identity
    return identities


def _read_open_directory(chain: _DirectoryChain) -> dict[str, bytes]:
    chain.revalidate()
    identities = _inspect_inventory(
        chain.current_fd,
        exact=True,
        allow_temps=False,
        require_mode=True,
    )
    result: dict[str, bytes] = {}
    for name in _ALL_NAMES:
        descriptor = -1
        try:
            descriptor = os.open(name, _READ_FLAGS, dir_fd=chain.current_fd)
            first = os.fstat(descriptor)
            first_identity = _require_regular(
                first,
                require_nonempty=True,
                require_mode=True,
            )
            if first_identity != identities[name]:
                raise Q17ArtifactError("Q17 artifact was replaced while opening")
            chunks: list[bytes] = []
            remaining = first.st_size + 1
            while True:
                chunk = os.read(descriptor, min(65_536, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            raw = b"".join(chunks)
            last_identity = _require_regular(
                os.fstat(descriptor),
                require_nonempty=True,
                require_mode=True,
            )
            named = _stat_entry(chain.current_fd, name)
            if (
                named is None
                or len(raw) != first.st_size
                or first_identity != last_identity
                or first_identity
                != _require_regular(named, require_nonempty=True, require_mode=True)
            ):
                raise Q17ArtifactError("Q17 artifact changed during bounded read")
            result[name] = raw
        except OSError as error:
            raise Q17ArtifactError(f"Q17 artifact cannot be opened safely: {name}") from error
        finally:
            if descriptor >= 0:
                os.close(descriptor)
    chain.revalidate()
    final_identities = _inspect_inventory(
        chain.current_fd,
        exact=True,
        allow_temps=False,
        require_mode=True,
    )
    if final_identities != identities:
        raise Q17ArtifactError("Q17 artifact identities changed during directory read")
    return result


def _safe_read_directory(directory: Path) -> dict[str, bytes]:
    chain = _open_directory_chain(directory)
    try:
        return _read_open_directory(chain)
    finally:
        chain.close()


def _open_q17_output(repo_root: Path, *, create: bool) -> _DirectoryChain | None:
    generated = repo_root / "quant" / "generated"
    chain = _open_directory_chain(generated)
    try:
        current = _stat_entry(chain.current_fd, "q17")
        if current is None:
            if not create:
                chain.revalidate()
                chain.close()
                return None
            try:
                os.mkdir("q17", mode=0o700, dir_fd=chain.current_fd)
            except OSError as error:
                raise Q17ArtifactError("Q17 output directory cannot be created safely") from error
        elif not stat.S_ISDIR(current.st_mode):
            raise Q17ArtifactError("Q17 output path must be a real directory")
        chain.append("q17")
        chain.revalidate()
        return chain
    except BaseException:
        chain.close()
        raise


def preflight_q17_output_directory(repo_root: Path) -> None:
    """Reject unsafe output ancestry/inventory before expensive Q17 measurement."""

    chain = _open_q17_output(repo_root, create=False)
    if chain is None:
        return
    try:
        _inspect_inventory(
            chain.current_fd,
            exact=False,
            allow_temps=True,
            require_mode=False,
        )
        chain.revalidate()
    finally:
        chain.close()


def _remove_recoverable_temps(
    chain: _DirectoryChain,
    identities: dict[str, _FileIdentity],
) -> None:
    for temp_name in _TEMP_NAMES.values():
        expected = identities.get(temp_name)
        if expected is None:
            continue
        descriptor = -1
        try:
            descriptor = os.open(temp_name, _READ_FLAGS, dir_fd=chain.current_fd)
            observed = _require_regular(
                os.fstat(descriptor),
                require_nonempty=False,
                require_mode=False,
            )
            named = _stat_entry(chain.current_fd, temp_name)
            if named is None or observed != expected or _file_identity(named) != expected:
                raise Q17ArtifactError("Q17 recoverable temp was replaced")
        except OSError as error:
            raise Q17ArtifactError("Q17 recoverable temp cannot be opened safely") from error
        finally:
            if descriptor >= 0:
                os.close(descriptor)
        chain.revalidate()
        try:
            os.unlink(temp_name, dir_fd=chain.current_fd)
        except OSError as error:
            raise Q17ArtifactError("Q17 recoverable temp cannot be removed safely") from error
        if _stat_entry(chain.current_fd, temp_name) is not None:
            raise Q17ArtifactError("Q17 recoverable temp remained after removal")


def _write_all(descriptor: int, raw: bytes) -> None:
    offset = 0
    while offset < len(raw):
        written = os.write(descriptor, raw[offset:])
        if written < 1:
            raise Q17ArtifactError("Q17 atomic artifact write made no progress")
        offset += written


def _atomic_replace_artifact(
    chain: _DirectoryChain,
    *,
    name: str,
    raw: bytes,
    expected_target: _FileIdentity | None,
) -> None:
    temp_name = _TEMP_NAMES[name]
    descriptor = -1
    temp_identity: _FileIdentity | None = None
    try:
        chain.revalidate()
        if _stat_entry(chain.current_fd, temp_name) is not None:
            raise Q17ArtifactError("Q17 atomic temp path unexpectedly exists")
        descriptor = os.open(
            temp_name,
            _WRITE_FLAGS,
            0o600,
            dir_fd=chain.current_fd,
        )
        os.fchmod(descriptor, 0o644)
        _write_all(descriptor, raw)
        os.fsync(descriptor)
        temp_identity = _require_regular(
            os.fstat(descriptor),
            require_nonempty=True,
            require_mode=True,
        )
        if temp_identity[4] != len(raw):
            raise Q17ArtifactError("Q17 atomic artifact size is inconsistent")
        named_temp = _stat_entry(chain.current_fd, temp_name)
        if named_temp is None or _file_identity(named_temp) != temp_identity:
            raise Q17ArtifactError("Q17 atomic temp was replaced before publication")
        current_target = _stat_entry(chain.current_fd, name)
        if expected_target is None:
            if current_target is not None:
                raise Q17ArtifactError("Q17 artifact appeared during atomic publication")
        elif current_target is None or _file_identity(current_target) != expected_target:
            raise Q17ArtifactError("Q17 artifact was replaced before atomic publication")
        os.replace(
            temp_name,
            name,
            src_dir_fd=chain.current_fd,
            dst_dir_fd=chain.current_fd,
        )
        renamed_identity = _require_regular(
            os.fstat(descriptor),
            require_nonempty=True,
            require_mode=True,
        )
        published = _stat_entry(chain.current_fd, name)
        if (
            published is None
            or renamed_identity[:6] != temp_identity[:6]
            or _file_identity(published) != renamed_identity
        ):
            raise Q17ArtifactError("Q17 artifact publication identity is inconsistent")
        temp_identity = renamed_identity
        os.fsync(chain.current_fd)
        chain.revalidate()
    except OSError as error:
        raise Q17ArtifactError(f"Q17 artifact cannot be published safely: {name}") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        leftover = _stat_entry(chain.current_fd, temp_name)
        if leftover is not None and (
            temp_identity is None or _file_identity(leftover) == temp_identity
        ):
            os.unlink(temp_name, dir_fd=chain.current_fd)


def _normalize_artifacts(artifacts: dict[str, bytes]) -> dict[str, bytes]:
    if type(artifacts) is not dict or tuple(sorted(artifacts)) != _EXPECTED_ARTIFACT_PATHS:
        raise Q17ArtifactError("Q17 artifact write-set paths are not exact")
    normalized: dict[str, bytes] = {}
    for relative, raw in artifacts.items():
        if type(raw) is not bytes or not raw or len(raw) > _MAX_ARTIFACT_BYTES:
            raise Q17ArtifactError("Q17 artifact write-set bytes are invalid")
        name = relative.removeprefix(_GENERATED_PREFIX)
        normalized[name] = raw
    return normalized


def write_q17_artifacts(repo_root: Path, artifacts: dict[str, bytes]) -> None:
    """Atomically publish exact 0644 outputs, with manifest last and safe recovery."""

    normalized = _normalize_artifacts(artifacts)
    chain = cast(_DirectoryChain, _open_q17_output(repo_root, create=True))
    try:
        os.fchmod(chain.current_fd, 0o700)
        identities = _inspect_inventory(
            chain.current_fd,
            exact=False,
            allow_temps=True,
            require_mode=False,
        )
        _remove_recoverable_temps(chain, identities)
        target_identities = {name: identities.get(name) for name in _ALL_NAMES}
        for name in (*_OUTPUT_NAMES, _MANIFEST_NAME):
            _atomic_replace_artifact(
                chain,
                name=name,
                raw=normalized[name],
                expected_target=target_identities[name],
            )
        observed = _read_open_directory(chain)
        if observed != normalized:
            raise Q17ArtifactError("Q17 published artifact bytes differ from the write-set")
    finally:
        chain.close()


def validate_q17_artifact_directory(repo_root: Path) -> dict[str, object]:
    """Verify exact inventory, hashes, split proof and current semantic truth."""

    directory = repo_root / "quant" / "generated" / "q17"
    raw = _safe_read_directory(directory)
    try:
        manifest = parse_canonical_object(raw[_MANIFEST_NAME])
    except CanonicalJsonError as error:
        raise Q17ArtifactError("Q17 artifact manifest is not canonical JSON") from error
    _exact(
        manifest,
        {
            "artifacts",
            "excludedSelf",
            "finalAction",
            "generator",
            "posture",
            "schema",
            "version",
        },
        field="artifact manifest",
    )
    if not (
        manifest["schema"] == "Q17ArtifactManifestV1"
        and type(manifest["version"]) is int
        and manifest["version"] == 1
        and manifest["excludedSelf"] == f"{_GENERATED_PREFIX}{_MANIFEST_NAME}"
        and manifest["finalAction"] == "ABSTAIN_UNKNOWN"
        and manifest["posture"] == "ADVISORY_ONLY"
    ):
        raise Q17ArtifactError("Q17 artifact manifest identity is invalid")
    rows = _array(manifest["artifacts"], field="artifact manifest rows")
    expected_paths = [f"{_GENERATED_PREFIX}{name}" for name in _OUTPUT_NAMES]
    observed_paths: list[str] = []
    for index, item in enumerate(rows):
        row = _object(item, field=f"artifact row {index}")
        _exact(row, {"byteLength", "relativePath", "sha256"}, field="artifact row")
        relative = row["relativePath"]
        if not isinstance(relative, str) or not relative.startswith(_GENERATED_PREFIX):
            raise Q17ArtifactError("artifact row path is not Q17-relative")
        name = _safe_name(relative.removeprefix(_GENERATED_PREFIX))
        observed_paths.append(relative)
        if not (
            _is_int(row["byteLength"], minimum=1)
            and row["byteLength"] == len(raw[name])
            and _is_sha256(row["sha256"])
            and row["sha256"] == _sha256(raw[name])
        ):
            raise Q17ArtifactError("artifact row bytes do not match")
    if observed_paths != expected_paths or len(set(observed_paths)) != len(observed_paths):
        raise Q17ArtifactError("artifact manifest path inventory is not exact and sorted")

    parsed: dict[str, dict[str, object]] = {}
    for name in _OUTPUT_NAMES:
        if name.endswith(".json"):
            try:
                parsed[name] = parse_canonical_object(raw[name])
            except CanonicalJsonError as error:
                raise Q17ArtifactError(f"Q17 artifact is not canonical JSON: {name}") from error
    replay = _join_replay(
        parsed["end_to_end_proof.v1.json"],
        parsed["fault_campaign.v1.json"],
    )
    validate_replay_fault_proof(replay, protocol=ProtocolContractV1.load(repo_root))
    if raw["integration_instructions.md"] != _integration_instructions():
        raise Q17ArtifactError("Q17 integration instructions drifted")
    regenerated = build_q17_artifacts(
        repo_root,
        replay_proof=replay,
        research_evidence=parsed["accepted_research_evidence.v1.json"],
        benchmark=parsed["benchmark.v1.json"],
        security_scope=parsed["security_scope.v1.json"],
        component_manifest=parsed["component_manifest.v1.json"],
    )
    regenerated_by_name = {
        relative.removeprefix(_GENERATED_PREFIX): value for relative, value in regenerated.items()
    }
    if raw != regenerated_by_name:
        raise Q17ArtifactError(
            "Q17 artifact directory differs from exact regenerated current truth"
        )
    return parse_canonical_object(regenerated_by_name[_MANIFEST_NAME])


__all__ = [
    "EXPECTED_C17_PATHS",
    "FROZEN_FILE_SHA256",
    "TRUSTED_SOURCE_SHA256",
    "Q17ArtifactError",
    "build_q17_artifacts",
    "preflight_q17_output_directory",
    "validate_q17_artifact_directory",
    "validate_security_scope",
    "write_q17_artifacts",
]
