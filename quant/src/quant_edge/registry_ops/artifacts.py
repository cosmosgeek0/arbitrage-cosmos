"""Explicit, bounded artifact verification for the offline Q15 registry."""

from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from quant_edge.canonical import parse_canonical_object, require_exact_keys
from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.lake.contracts import DigestV1
from quant_edge.registry_ops.contracts import ArtifactRefV1


class ArtifactIntegrityError(QuantEdgeError):
    """An artifact path, byte identity, schema or manifest binding failed closed."""


@dataclass(frozen=True, slots=True)
class ForeignJsonSchemaV1:
    schema_name: str
    version: int
    top_level_keys: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.schema_name, str) or not self.schema_name:
            raise ContractValueError("schema_name must be non-empty text")
        if isinstance(self.version, bool) or not isinstance(self.version, int) or self.version < 1:
            raise ContractValueError("version must be a positive integer")
        if (
            not isinstance(self.top_level_keys, tuple)
            or not self.top_level_keys
            or tuple(sorted(self.top_level_keys)) != self.top_level_keys
            or len(set(self.top_level_keys)) != len(self.top_level_keys)
        ):
            raise ContractValueError("top_level_keys must be a sorted unique tuple")


Q10_GOLDEN_SCHEMA = ForeignJsonSchemaV1(
    "Q10ModelGoldenFixtureV1",
    1,
    ("battery", "schema", "version"),
)
Q10_CAMPAIGN_SCHEMA = ForeignJsonSchemaV1(
    "Q10ModelCampaignV1",
    1,
    (
        "batterySha256",
        "evidencePosture",
        "fixtureSha256",
        "honestChallengerLosses",
        "schema",
        "seed",
        "studySummaries",
        "version",
        "winnersByTarget",
    ),
)
Q11_GOLDEN_SCHEMA = ForeignJsonSchemaV1(
    "Q11SurvivalGoldenV1",
    1,
    (
        "aalenJohansen",
        "evidencePosture",
        "hazardModel",
        "kaplanMeier",
        "metrics",
        "schema",
        "targets",
        "version",
    ),
)
Q11_CAMPAIGN_SCHEMA = ForeignJsonSchemaV1(
    "Q11SurvivalCampaignV1",
    1,
    (
        "budgetVerdict",
        "censoring",
        "cohorts",
        "competing",
        "estimatorRecovery",
        "evidencePosture",
        "fixtureSha256",
        "generatingLaw",
        "modelEvaluation",
        "schema",
        "seed",
        "version",
    ),
)
Q14_GOLDEN_SCHEMA = ForeignJsonSchemaV1(
    "Q14ValidationGoldenFixtureV1",
    1,
    (
        "bootstrapInterval",
        "comparison",
        "datasetDigest",
        "deflatedSharpe",
        "forgedAssessment",
        "honestAssessment",
        "leakedAssessment",
        "multipleTesting",
        "pbo",
        "plan",
        "schema",
        "seed",
        "stress",
        "trialLedger",
        "version",
    ),
)
Q14_CAMPAIGN_SCHEMA = ForeignJsonSchemaV1(
    "Q14ValidationCampaignV1",
    1,
    (
        "battery",
        "batteryDatasets",
        "behavioralRejections",
        "comparisonVerdict",
        "goldenFixtureSha256",
        "honestAccepted",
        "schema",
        "seed",
        "stressFlipsFeeSlippage",
        "stressFlipsLatency",
        "temporalRejections",
        "version",
    ),
)


def _real_root(root: Path) -> tuple[Path, os.stat_result]:
    if not isinstance(root, Path) or not root.is_absolute():
        raise ContractValueError("artifact root must be an absolute pathlib.Path")
    try:
        info = root.lstat()
    except OSError as error:
        raise ArtifactIntegrityError("artifact root is absent") from error
    if not stat.S_ISDIR(info.st_mode) or root.is_symlink():
        raise ArtifactIntegrityError("artifact root must be a real non-symlink directory")
    return root, info


def read_verified_artifact(root: Path, reference: ArtifactRefV1) -> bytes:
    """Read exact bytes without following a symlink in any path component."""

    root, root_before = _real_root(root)
    if not isinstance(reference, ArtifactRefV1):
        raise ContractValueError("reference must be ArtifactRefV1")
    parts = PurePosixPath(reference.relative_path).parts
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        directory_fd = os.open(root, directory_flags)
    except OSError as error:
        raise ArtifactIntegrityError("artifact root cannot be opened safely") from error
    descriptor = -1
    try:
        root_opened = os.fstat(directory_fd)
        if (root_opened.st_dev, root_opened.st_ino) != (root_before.st_dev, root_before.st_ino):
            raise ArtifactIntegrityError("artifact root changed while opening")
        for part in parts[:-1]:
            try:
                next_fd = os.open(part, directory_flags, dir_fd=directory_fd)
            except OSError as error:
                raise ArtifactIntegrityError("artifact parent path is absent or unsafe") from error
            os.close(directory_fd)
            directory_fd = next_fd
        try:
            descriptor = os.open(
                parts[-1],
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=directory_fd,
            )
        except OSError as error:
            raise ArtifactIntegrityError(
                "artifact cannot be opened without following links"
            ) from error
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ArtifactIntegrityError("artifact must be a regular file")
        if before.st_size != reference.byte_length:
            raise ArtifactIntegrityError("artifact byte length does not match its manifest")
        chunks: list[bytes] = []
        remaining = reference.byte_length + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65_536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
        if len(raw) != reference.byte_length or (before.st_dev, before.st_ino, before.st_size) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
        ):
            raise ArtifactIntegrityError("artifact changed during its bounded read")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        os.close(directory_fd)
    root_after = root.lstat()
    if (root_before.st_dev, root_before.st_ino) != (root_after.st_dev, root_after.st_ino):
        raise ArtifactIntegrityError("artifact root changed during verification")
    observed = hashlib.sha256(raw).hexdigest()
    if observed != reference.sha256.hexdigest:
        raise ArtifactIntegrityError("artifact SHA-256 does not match its manifest")
    return raw


def verify_json_artifact(
    root: Path,
    reference: ArtifactRefV1,
    schema: ForeignJsonSchemaV1,
) -> dict[str, object]:
    if not isinstance(schema, ForeignJsonSchemaV1):
        raise ContractValueError("schema must be ForeignJsonSchemaV1")
    if reference.schema_name != schema.schema_name or reference.schema_version != schema.version:
        raise ArtifactIntegrityError("artifact reference and expected schema disagree")
    raw = read_verified_artifact(root, reference)
    try:
        parsed = parse_canonical_object(raw)
        require_exact_keys(parsed, expected=schema.top_level_keys, path="$")
    except QuantEdgeError as error:
        message = f"artifact JSON is not canonical and schema-exact: {error}"
        raise ArtifactIntegrityError(message) from error
    if parsed.get("schema") != schema.schema_name or parsed.get("version") != schema.version:
        raise ArtifactIntegrityError("artifact body schema/version does not match its reference")
    return parsed


def digest_file(path: Path) -> tuple[DigestV1, int]:
    """Builder helper; the caller supplies the path and owns source admission."""

    if not isinstance(path, Path):
        raise ContractValueError("path must be pathlib.Path")
    raw = path.read_bytes()
    if not raw:
        raise ArtifactIntegrityError("artifact must not be empty")
    return DigestV1(hashlib.sha256(raw).hexdigest()), len(raw)
