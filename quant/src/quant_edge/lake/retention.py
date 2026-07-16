from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import (
    UTC_NS_MAX,
    UTC_NS_MIN,
    DigestV1,
    require_path_segment,
    require_strict_int,
)
from quant_edge.lake.manifest import DatasetRevisionManifestV1, RetentionClass

MAX_RETENTION_REVISIONS: Final = 4_096
_RETENTION_DECISION_TOKEN: Final = object()


class RetentionAction(StrEnum):
    RETAIN = "RETAIN"
    EXPIRE_PAYLOAD_PRESERVE_MANIFEST = "EXPIRE_PAYLOAD_PRESERVE_MANIFEST"


@dataclass(frozen=True, slots=True, init=False)
class RetentionDecisionV1:
    dataset_id: str
    revision_id: str
    artifact_digest: DigestV1
    relative_payload_path: str
    action: RetentionAction
    reason: str
    preserve_manifest: bool = True
    preserve_lineage: bool = True

    def __init__(
        self,
        dataset_id: str,
        revision_id: str,
        artifact_digest: DigestV1,
        relative_payload_path: str,
        action: RetentionAction,
        reason: str,
        preserve_manifest: bool = True,
        preserve_lineage: bool = True,
        *,
        _token: object | None = None,
    ) -> None:
        if _token is not _RETENTION_DECISION_TOKEN:
            raise ContractValueError("retention decisions must be engine-derived")
        object.__setattr__(self, "dataset_id", dataset_id)
        object.__setattr__(self, "revision_id", revision_id)
        object.__setattr__(self, "artifact_digest", artifact_digest)
        object.__setattr__(self, "relative_payload_path", relative_payload_path)
        object.__setattr__(self, "action", action)
        object.__setattr__(self, "reason", reason)
        object.__setattr__(self, "preserve_manifest", preserve_manifest)
        object.__setattr__(self, "preserve_lineage", preserve_lineage)
        require_path_segment(self.dataset_id, field="dataset_id")
        require_path_segment(self.revision_id, field="revision_id")
        if not isinstance(self.artifact_digest, DigestV1):
            raise ContractValueError("artifact_digest must be DigestV1")
        if not isinstance(self.relative_payload_path, str):
            raise ContractValueError("relative_payload_path must be a canonical relative string")
        path = PurePosixPath(self.relative_payload_path)
        parts = path.parts
        if (
            path.is_absolute()
            or path.as_posix() != self.relative_payload_path
            or len(parts) != 11
            or parts[:4] != ("datasets", self.dataset_id, "revisions", self.revision_id)
            or parts[4] != "partitions"
            or not parts[-1].endswith(".parquet")
        ):
            raise ContractValueError("relative_payload_path must bind the decision revision")
        for part in (*parts[:-1], parts[-1][: -len(".parquet")]):
            require_path_segment(part, field="relative_payload_path component")
        if not isinstance(self.action, RetentionAction):
            raise ContractValueError("action must be RetentionAction")
        allowed_reasons = {
            RetentionAction.EXPIRE_PAYLOAD_PRESERVE_MANIFEST: frozenset(
                {"DECLARED_EXPIRY_REACHED_WITH_PERMISSION_AND_PRESERVED_DEPENDENCIES"}
            ),
            RetentionAction.RETAIN: frozenset(
                {
                    "PRESERVE_CLASS",
                    "EXPIRY_NOT_REACHED_OR_UNKNOWN",
                    "PERMISSION_OR_DEPENDENCY_STATE_NOT_PROVEN",
                }
            ),
        }
        if not isinstance(self.reason, str) or self.reason not in allowed_reasons[self.action]:
            raise ContractValueError("reason must be a controlled value for the retention action")
        if self.preserve_manifest is not True or self.preserve_lineage is not True:
            raise ContractValueError("retention decisions must preserve manifest and lineage")


def _derive_retention_decision(
    *,
    dataset_id: str,
    revision_id: str,
    artifact_digest: DigestV1,
    relative_payload_path: str,
    action: RetentionAction,
    reason: str,
    preserve_manifest: bool = True,
    preserve_lineage: bool = True,
) -> RetentionDecisionV1:
    return RetentionDecisionV1(
        dataset_id=dataset_id,
        revision_id=revision_id,
        artifact_digest=artifact_digest,
        relative_payload_path=relative_payload_path,
        action=action,
        reason=reason,
        preserve_manifest=preserve_manifest,
        preserve_lineage=preserve_lineage,
        _token=_RETENTION_DECISION_TOKEN,
    )


def plan_retention(
    manifests: tuple[DatasetRevisionManifestV1, ...],
    *,
    as_of_ns: int,
    deletion_permission_known: bool | None,
    dependencies_preserved: bool | None,
) -> tuple[RetentionDecisionV1, ...]:
    if not isinstance(manifests, tuple):
        raise ContractValueError("manifests must be an immutable tuple")
    if len(manifests) > MAX_RETENTION_REVISIONS:
        raise ContractValueError(
            f"retention input exceeds {MAX_RETENTION_REVISIONS} revision manifests"
        )
    require_strict_int(
        as_of_ns,
        field="as_of_ns",
        minimum=UTC_NS_MIN,
        maximum=UTC_NS_MAX,
    )
    if deletion_permission_known is not None and not isinstance(deletion_permission_known, bool):
        raise ContractValueError("deletion_permission_known must be boolean or null")
    if dependencies_preserved is not None and not isinstance(dependencies_preserved, bool):
        raise ContractValueError("dependencies_preserved must be boolean or null")
    if any(not isinstance(item, DatasetRevisionManifestV1) for item in manifests):
        raise ContractValueError("manifests must contain DatasetRevisionManifestV1")
    identities = [(item.dataset_id, item.revision_id) for item in manifests]
    if len(identities) != len(set(identities)):
        raise ContractValueError("retention input contains duplicate revision identities")
    decisions: list[RetentionDecisionV1] = []
    for manifest in sorted(manifests, key=lambda item: (item.dataset_id, item.revision_id)):
        entry = manifest.partition
        eligible = (
            entry.retention_class is not RetentionClass.PRESERVE
            and entry.expires_at_ns is not None
            and entry.expires_at_ns <= as_of_ns
            and deletion_permission_known is True
            and dependencies_preserved is True
        )
        if eligible:
            action = RetentionAction.EXPIRE_PAYLOAD_PRESERVE_MANIFEST
            reason = "DECLARED_EXPIRY_REACHED_WITH_PERMISSION_AND_PRESERVED_DEPENDENCIES"
        elif entry.retention_class is RetentionClass.PRESERVE:
            action = RetentionAction.RETAIN
            reason = "PRESERVE_CLASS"
        elif entry.expires_at_ns is None or entry.expires_at_ns > as_of_ns:
            action = RetentionAction.RETAIN
            reason = "EXPIRY_NOT_REACHED_OR_UNKNOWN"
        else:
            action = RetentionAction.RETAIN
            reason = "PERMISSION_OR_DEPENDENCY_STATE_NOT_PROVEN"
        decisions.append(
            _derive_retention_decision(
                dataset_id=manifest.dataset_id,
                revision_id=manifest.revision_id,
                artifact_digest=entry.artifact_digest,
                relative_payload_path=entry.relative_path,
                action=action,
                reason=reason,
            )
        )
    return tuple(decisions)
