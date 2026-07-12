"""Crash-safe, local-only Q15 research registry.

SQLite is used as a single-file transactional commit boundary.  The registry is
not the product ledger and exposes no listener, remote URI, autoloading or model
deserialization.  Cards, artifact references, transitions, scores and feedback
are append-only; the champion table is only a verified current projection of the
append-only transition history.
"""

from __future__ import annotations

import os
import sqlite3
import stat
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import cast

from quant_edge.canonical import canonical_json_bytes, parse_canonical_object
from quant_edge.errors import ContractValueError, QuantEdgeError
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int
from quant_edge.primitives import require_utc_millis
from quant_edge.registry_ops.artifacts import read_verified_artifact
from quant_edge.registry_ops.contracts import (
    AnnotationOutcomeLinkV1,
    ArtifactKind,
    ArtifactRefV1,
    ChampionSnapshotV1,
    CommitStage,
    DatasetCardV1,
    DelayedFeedbackV1,
    DriftAlarmV1,
    DriftResponse,
    EvidencePosture,
    ExperimentCardV1,
    FeedbackState,
    ModelCardV1,
    ModelLifecycle,
    ModelRegistrationV1,
    OwnerAnnotationV1,
    RetirementRecordV1,
    ServingPosture,
    ShadowComparisonV1,
    ShadowScoreBatchV1,
    TransitionKind,
    ValidationBindingV1,
    mapping_digest,
)

SCHEMA_VERSION = 1


class RegistryError(QuantEdgeError):
    """Base failure for the explicit Q15 research-registry boundary."""


class RegistryConflictError(RegistryError):
    """An immutable ID, expected generation or identity binding conflicted."""


class RegistryIntegrityError(RegistryError):
    """Persisted state or referenced artifact failed closed."""


FaultHook = Callable[[CommitStage], None]


def _require_reason(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 4_096:
        raise ContractValueError(f"{field} must be bounded non-empty text")
    value.encode("utf-8", errors="strict")
    return value


def _mapping_int(mapping: dict[str, object], key: str) -> int:
    value = mapping[key]
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise RegistryIntegrityError(f"persisted {key} is not an integer")
    return int(value)


def _artifact_from_mapping(mapping: dict[str, object]) -> ArtifactRefV1:
    try:
        return ArtifactRefV1(
            artifact_id=str(mapping["artifactId"]),
            kind=ArtifactKind(str(mapping["kind"])),
            schema_name=str(mapping["schemaName"]),
            schema_version=_mapping_int(mapping, "schemaVersion"),
            relative_path=str(mapping["relativePath"]),
            sha256=DigestV1(str(mapping["sha256"])),
            byte_length=_mapping_int(mapping, "byteLength"),
            media_type=str(mapping["mediaType"]),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise RegistryIntegrityError("persisted artifact reference is malformed") from error


def _snapshot_from_mapping(mapping: dict[str, object]) -> ChampionSnapshotV1:
    try:
        return ChampionSnapshotV1(
            slot_id=str(mapping["slotId"]),
            generation=_mapping_int(mapping, "generation"),
            model_id=str(mapping["modelId"]),
            model_revision=str(mapping["modelRevision"]),
            artifact_sha256=DigestV1(str(mapping["artifactSha256"])),
            model_card_sha256=DigestV1(str(mapping["modelCardSha256"])),
            policy_revision=str(mapping["policyRevision"]),
            posture=ServingPosture(str(mapping["posture"])),
            transition_id=str(mapping["transitionId"]),
            updated_at_ms=_mapping_int(mapping, "updatedAtMs"),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise RegistryIntegrityError("persisted champion snapshot is malformed") from error


def _verify_transition_record(
    transition: sqlite3.Row,
    snapshot: ChampionSnapshotV1,
    previous: ChampionSnapshotV1 | None,
) -> None:
    expected_snapshot = canonical_json_bytes(snapshot.as_mapping())
    expected_previous = None if previous is None else previous.content_digest.hexdigest
    if (
        transition["slot_id"] != snapshot.slot_id
        or transition["next_snapshot_sha"] != snapshot.content_digest.hexdigest
        or bytes(transition["next_snapshot"]) != expected_snapshot
        or transition["previous_snapshot_sha"] != expected_previous
        or transition["committed_at_ms"] != snapshot.updated_at_ms
        or (previous is not None and snapshot.updated_at_ms <= previous.updated_at_ms)
    ):
        raise RegistryIntegrityError("transition snapshot chain is corrupt")
    command = parse_canonical_object(bytes(transition["command"]))
    try:
        kind = TransitionKind(str(transition["kind"]))
    except ValueError as error:
        raise RegistryIntegrityError("transition kind is unsupported") from error
    expected_generation = 0 if previous is None else previous.generation
    if (
        bytes(transition["command"]) != canonical_json_bytes(command)
        or mapping_digest(command).hexdigest != transition["command_sha"]
        or command.get("transitionId") != snapshot.transition_id
        or command.get("slotId") != snapshot.slot_id
        or command.get("kind") != kind.value
        or command.get("policyRevision") != snapshot.policy_revision
        or command.get("expectedGeneration") != expected_generation
    ):
        raise RegistryIntegrityError("transition command is corrupt or semantically unbound")
    evidence_blob = transition["evidence"]
    evidence_sha = transition["evidence_sha"]
    if (evidence_blob is None) != (evidence_sha is None):
        raise RegistryIntegrityError("transition evidence presence is corrupt")
    evidence = None
    if evidence_blob is not None:
        evidence = parse_canonical_object(bytes(evidence_blob))
        if (
            bytes(evidence_blob) != canonical_json_bytes(evidence)
            or mapping_digest(evidence).hexdigest != evidence_sha
        ):
            raise RegistryIntegrityError("transition evidence is corrupt")
    same_model = previous is not None and (
        previous.model_id == snapshot.model_id
        and previous.model_revision == snapshot.model_revision
        and previous.artifact_sha256 == snapshot.artifact_sha256
        and previous.model_card_sha256 == snapshot.model_card_sha256
    )
    reason = str(transition["reason"])
    if kind is TransitionKind.BOOTSTRAP:
        valid = (
            previous is None
            and snapshot.generation == 1
            and evidence is None
            and command.get("modelId") == snapshot.model_id
            and command.get("modelRevision") == snapshot.model_revision
            and command.get("reason") == reason
        )
    elif kind is TransitionKind.PROMOTION:
        gates = evidence.get("gates") if isinstance(evidence, dict) else None
        valid = (
            previous is not None
            and isinstance(evidence, dict)
            and command.get("candidateModelId") == snapshot.model_id
            and command.get("candidateModelRevision") == snapshot.model_revision
            and command.get("evidence") == evidence
            and evidence.get("subjectModelId") == snapshot.model_id
            and evidence.get("subjectModelRevision") == snapshot.model_revision
            and evidence.get("subjectArtifactSha256") == snapshot.artifact_sha256.hexdigest
            and evidence.get("reportBaselineModelId") == previous.model_id
            and evidence.get("reportChallengerModelId") == snapshot.model_id
            and isinstance(gates, dict)
            and set(gates)
            == {
                "auditableRecord",
                "calibration",
                "cardsComplete",
                "chronologicalPrimaryMetric",
                "costsLatency",
                "criticalRegimesTails",
                "immutableInputs",
                "inferenceResources",
                "leakageNegativeControls",
                "matureShadowComparison",
            }
            and all(value is True for value in gates.values())
            and command.get("reason") == reason
        )
    elif kind is TransitionKind.ROLLBACK:
        valid = (
            previous is not None
            and command.get("targetModelId") == snapshot.model_id
            and command.get("targetModelRevision") == snapshot.model_revision
            and command.get("targetArtifactSha256") == snapshot.artifact_sha256.hexdigest
            and isinstance(evidence, dict)
            and evidence.get("targetModelId") == snapshot.model_id
            and evidence.get("targetModelRevision") == snapshot.model_revision
            and evidence.get("targetArtifactSha256") == snapshot.artifact_sha256.hexdigest
            and command.get("reason") == reason
        )
    elif kind is TransitionKind.DEMOTION:
        valid = (
            same_model
            and command.get("alarm") == evidence
            and isinstance(evidence, dict)
            and evidence.get("reasonCode") == reason
            and previous is not None
            and evidence.get("monitoredModelId") == previous.model_id
            and evidence.get("monitoredModelRevision") == previous.model_revision
            and evidence.get("monitoredArtifactSha256") == previous.artifact_sha256.hexdigest
            and evidence.get("monitoredGeneration") == previous.generation
            and evidence.get("monitoredTransitionId") == previous.transition_id
            and _mapping_int(evidence, "observedAtMs") >= previous.updated_at_ms
        )
    else:
        valid = (
            kind is TransitionKind.RECOVERY
            and same_model
            and isinstance(evidence, dict)
            and isinstance(evidence.get("historicalSnapshotSha256"), str)
            and command.get("reason") == reason
        )
    if not valid:
        raise RegistryIntegrityError("transition semantics do not bind to champion history")


def _verify_persisted_shadow_lineage(
    connection: sqlite3.Connection,
    comparison: dict[str, object],
) -> None:
    batch_ids = comparison.get("batchIds")
    feedback_hashes = comparison.get("feedbackSha256")
    if (
        not isinstance(batch_ids, list)
        or not batch_ids
        or not isinstance(feedback_hashes, list)
        or len(batch_ids) != len(feedback_hashes)
    ):
        raise RegistryIntegrityError("shadow comparison lineage lists are malformed")
    observed_feedback: list[str] = []
    champion_losses: list[int] = []
    challenger_losses: list[int] = []
    for batch_id in batch_ids:
        if not isinstance(batch_id, str):
            raise RegistryIntegrityError("shadow batch identity is malformed")
        row = connection.execute(
            "SELECT body_sha,body,feedback_id FROM shadow_batches WHERE batch_id=?",
            (batch_id,),
        ).fetchone()
        if row is None or row["feedback_id"] is None:
            raise RegistryIntegrityError("mature shadow batch lineage is absent")
        batch = parse_canonical_object(bytes(row["body"]))
        feedback_row = connection.execute(
            "SELECT body_sha,body FROM feedback WHERE feedback_id=?",
            (row["feedback_id"],),
        ).fetchone()
        if feedback_row is None:
            raise RegistryIntegrityError("mature shadow feedback lineage is absent")
        feedback = parse_canonical_object(bytes(feedback_row["body"]))
        if (
            bytes(row["body"]) != canonical_json_bytes(batch)
            or mapping_digest(batch).hexdigest != row["body_sha"]
            or bytes(feedback_row["body"]) != canonical_json_bytes(feedback)
            or mapping_digest(feedback).hexdigest != feedback_row["body_sha"]
            or feedback.get("state") != FeedbackState.AVAILABLE.value
            or feedback.get("batchId") != batch_id
            or feedback.get("eventId") != batch.get("eventId")
            or feedback.get("targetId") != comparison.get("targetId")
            or feedback.get("horizonMs") != comparison.get("horizonMs")
        ):
            raise RegistryIntegrityError("mature shadow lineage is corrupt or cross-bound")
        champion = batch.get("champion")
        challengers = batch.get("challengers")
        challenger = None
        if isinstance(challengers, list):
            challenger = next(
                (
                    item
                    for item in challengers
                    if isinstance(item, dict)
                    and item.get("modelId") == comparison.get("challengerModelId")
                    and item.get("modelRevision") == comparison.get("challengerModelRevision")
                    and item.get("artifactSha256") == comparison.get("challengerArtifactSha256")
                ),
                None,
            )
        if (
            not isinstance(champion, dict)
            or challenger is None
            or batch.get("slotId") != comparison.get("slotId")
            or batch.get("targetId") != comparison.get("targetId")
            or batch.get("horizonMs") != comparison.get("horizonMs")
            or batch.get("championGeneration") != comparison.get("championGeneration")
            or batch.get("championTransitionId") != comparison.get("championTransitionId")
            or champion.get("modelId") != comparison.get("championModelId")
            or champion.get("modelRevision") != comparison.get("championModelRevision")
            or champion.get("artifactSha256") != comparison.get("championArtifactSha256")
        ):
            raise RegistryIntegrityError("shadow comparison model lineage is corrupt")
        champion_score = champion.get("scoreMicros")
        challenger_score = challenger.get("scoreMicros")
        outcome = feedback.get("outcomeMicros")
        if any(
            isinstance(value, bool) or not isinstance(value, int)
            for value in (champion_score, challenger_score, outcome)
        ):
            raise RegistryIntegrityError("shadow comparison metric inputs are unavailable")
        expected_champion_output = mapping_digest(
            {"scoreMicros": str(cast(int, champion_score))}
        ).hexdigest
        expected_challenger_output = mapping_digest(
            {"scoreMicros": str(cast(int, challenger_score))}
        ).hexdigest
        expected_outcome = mapping_digest({"outcomeMicros": str(cast(int, outcome))}).hexdigest
        if (
            champion.get("outputSha256") != expected_champion_output
            or challenger.get("outputSha256") != expected_challenger_output
            or feedback.get("outcomeSha256") != expected_outcome
        ):
            raise RegistryIntegrityError("shadow metric values are not digest-bound")
        champion_error = cast(int, champion_score) - cast(int, outcome)
        challenger_error = cast(int, challenger_score) - cast(int, outcome)
        champion_losses.append((champion_error * champion_error) // 1_000_000)
        challenger_losses.append((challenger_error * challenger_error) // 1_000_000)
        observed_feedback.append(str(feedback_row["body_sha"]))
    derived_champion = sum(champion_losses) // len(champion_losses)
    derived_challenger = sum(challenger_losses) // len(challenger_losses)
    derived_verdict = "PASS" if derived_challenger < derived_champion else "FAIL"
    if (
        sorted(observed_feedback) != sorted(str(value) for value in feedback_hashes)
        or comparison.get("metricId") != "brier_loss_micros:v1"
        or comparison.get("championMetricMicros") != derived_champion
        or comparison.get("challengerMetricMicros") != derived_challenger
        or comparison.get("verdict") != derived_verdict
    ):
        raise RegistryIntegrityError("shadow comparison does not reproduce from lineage")


def _verify_validation_report_content(
    raw: bytes,
    evidence: ValidationBindingV1,
    current: ChampionSnapshotV1,
    candidate: sqlite3.Row,
) -> None:
    try:
        report = parse_canonical_object(raw)
    except QuantEdgeError as error:
        raise RegistryIntegrityError("promotion report is not canonical JSON") from error
    if report.get("schema") != evidence.report_artifact.schema_name:
        raise RegistryConflictError("validation report schema binding mismatch")
    if report.get("schema") == "Q15SyntheticPromotionReportV1":
        exact = (
            report.get("baselineModelId") == current.model_id
            and report.get("baselineArtifactSha256") == current.artifact_sha256.hexdigest
            and report.get("challengerModelId") == candidate["model_id"]
            and report.get("challengerArtifactSha256") == candidate["artifact_sha"]
            and report.get("verdict") == evidence.report_verdict
            and report.get("posture") == EvidencePosture.SYNTHETIC_ONLY.value
        )
    elif report.get("schema") == "Q14ValidationGoldenFixtureV1":
        raise RegistryConflictError("Q14_REPORT_NOT_ARTIFACT_IDENTITY_BOUND")
    else:
        raise RegistryConflictError("validation report schema is not promotion-admitted")
    if not exact:
        raise RegistryConflictError("VALIDATION_REPORT_CONTENT_MISMATCH")


class ResearchRegistryStore:
    """One explicit local registry root and one serialized writer connection."""

    def __init__(self, root: Path) -> None:
        if not isinstance(root, Path) or not root.is_absolute():
            raise ContractValueError("registry root must be an absolute pathlib.Path")
        try:
            info = root.lstat()
        except OSError as error:
            raise RegistryIntegrityError("registry root must pre-exist") from error
        if not stat.S_ISDIR(info.st_mode) or root.is_symlink():
            raise RegistryIntegrityError("registry root must be a real non-symlink directory")
        self._root = root
        self._root_identity = (info.st_dev, info.st_ino)
        database = root / "q15-registry.sqlite3"
        created = False
        flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            database_fd = os.open(database, flags, 0o600)
            created = True
        except FileExistsError:
            try:
                database_fd = os.open(
                    database,
                    os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
                )
            except OSError as error:
                raise RegistryIntegrityError("registry database path is unsafe") from error
        except OSError as error:
            raise RegistryIntegrityError("registry database could not be created safely") from error
        database_info = os.fstat(database_fd)
        if not stat.S_ISREG(database_info.st_mode):
            os.close(database_fd)
            raise RegistryIntegrityError("registry database must be a regular file")
        self._database_identity = (database_info.st_dev, database_info.st_ino)
        os.close(database_fd)
        if created:
            root_fd = os.open(
                root,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
            )
            try:
                os.fsync(root_fd)
            finally:
                os.close(root_fd)
        self._connection: sqlite3.Connection | None = None
        try:
            self._connection = sqlite3.connect(
                database,
                timeout=10.0,
                isolation_level=None,
                check_same_thread=True,
            )
        except sqlite3.Error as error:
            raise RegistryIntegrityError("registry database could not be opened") from error
        opened_database = database.lstat()
        if (opened_database.st_dev, opened_database.st_ino) != self._database_identity:
            self._connection.close()
            raise RegistryIntegrityError("registry database identity changed while opening")
        self._connection.row_factory = sqlite3.Row
        try:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA synchronous=FULL")
            self._connection.execute("PRAGMA foreign_keys=ON")
            self._connection.execute("PRAGMA trusted_schema=OFF")
            pragmas = {
                "foreign_keys": self._connection.execute("PRAGMA foreign_keys").fetchone()[0],
                "journal_mode": self._connection.execute("PRAGMA journal_mode").fetchone()[0],
                "synchronous": self._connection.execute("PRAGMA synchronous").fetchone()[0],
                "trusted_schema": self._connection.execute("PRAGMA trusted_schema").fetchone()[0],
            }
            if pragmas != {
                "foreign_keys": 1,
                "journal_mode": "wal",
                "synchronous": 2,
                "trusted_schema": 0,
            }:
                raise RegistryIntegrityError("required SQLite durability pragmas were not applied")
            self._initialize_schema()
        except BaseException:
            self._connection.close()
            raise

    def __enter__(self) -> ResearchRegistryStore:
        self._require_open()
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.close()

    def __del__(self) -> None:
        with suppress(Exception):
            self.close()

    def close(self) -> None:
        connection = getattr(self, "_connection", None)
        if connection is not None:
            connection.close()
            self._connection = None

    def _require_open(self) -> sqlite3.Connection:
        connection = getattr(self, "_connection", None)
        if not isinstance(connection, sqlite3.Connection):
            raise RegistryError("registry store is closed")
        try:
            current = self._root.lstat()
            database = (self._root / "q15-registry.sqlite3").lstat()
        except OSError as error:
            raise RegistryIntegrityError(
                "registry root or database path became unavailable"
            ) from error
        if (current.st_dev, current.st_ino) != self._root_identity:
            raise RegistryIntegrityError("registry root identity changed")
        if (database.st_dev, database.st_ino) != self._database_identity:
            raise RegistryIntegrityError("registry database identity changed")
        return connection

    def _initialize_schema(self) -> None:
        connection = self._require_open()
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS registry_meta(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS cards(
                kind TEXT NOT NULL,
                card_id TEXT NOT NULL,
                revision TEXT NOT NULL,
                digest TEXT NOT NULL UNIQUE,
                body BLOB NOT NULL,
                recorded_at_ms INTEGER NOT NULL,
                PRIMARY KEY(kind, card_id, revision)
            ) STRICT;
            CREATE TABLE IF NOT EXISTS artifacts(
                artifact_id TEXT PRIMARY KEY,
                digest TEXT NOT NULL,
                body BLOB NOT NULL,
                recorded_at_ms INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS models(
                model_id TEXT NOT NULL,
                model_revision TEXT NOT NULL,
                artifact_id TEXT NOT NULL,
                artifact_sha TEXT NOT NULL,
                model_card_sha TEXT NOT NULL,
                dataset_card_sha TEXT NOT NULL,
                experiment_card_sha TEXT NOT NULL,
                output_contract_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                score_contract_id TEXT NOT NULL,
                evidence_posture TEXT NOT NULL,
                lifecycle TEXT NOT NULL,
                body_sha TEXT NOT NULL,
                body BLOB NOT NULL,
                registered_at_ms INTEGER NOT NULL,
                PRIMARY KEY(model_id, model_revision),
                FOREIGN KEY(artifact_id) REFERENCES artifacts(artifact_id)
            ) STRICT;
            CREATE TABLE IF NOT EXISTS champions(
                slot_id TEXT PRIMARY KEY,
                generation INTEGER NOT NULL,
                snapshot_sha TEXT NOT NULL,
                snapshot BLOB NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS champion_history(
                slot_id TEXT NOT NULL,
                generation INTEGER NOT NULL,
                snapshot_sha TEXT NOT NULL,
                snapshot BLOB NOT NULL,
                PRIMARY KEY(slot_id, generation)
            ) STRICT;
            CREATE TABLE IF NOT EXISTS transitions(
                transition_id TEXT PRIMARY KEY,
                command_sha TEXT NOT NULL,
                command BLOB NOT NULL,
                kind TEXT NOT NULL,
                slot_id TEXT NOT NULL,
                previous_snapshot_sha TEXT,
                next_snapshot_sha TEXT NOT NULL,
                next_snapshot BLOB NOT NULL,
                evidence_sha TEXT,
                evidence BLOB,
                reason TEXT NOT NULL,
                committed_at_ms INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS shadow_batches(
                batch_id TEXT PRIMARY KEY,
                body_sha TEXT NOT NULL,
                body BLOB NOT NULL,
                slot_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                horizon_ms INTEGER NOT NULL,
                matures_at_ms INTEGER NOT NULL,
                feedback_id TEXT
            ) STRICT;
            CREATE TABLE IF NOT EXISTS feedback(
                feedback_id TEXT PRIMARY KEY,
                batch_id TEXT NOT NULL UNIQUE,
                body_sha TEXT NOT NULL,
                body BLOB NOT NULL,
                observed_at_ms INTEGER NOT NULL,
                FOREIGN KEY(batch_id) REFERENCES shadow_batches(batch_id)
            ) STRICT;
            CREATE TABLE IF NOT EXISTS shadow_comparisons(
                comparison_id TEXT PRIMARY KEY,
                body_sha TEXT NOT NULL UNIQUE,
                body BLOB NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS annotations(
                annotation_id TEXT PRIMARY KEY,
                body_sha TEXT NOT NULL,
                body BLOB NOT NULL
            ) STRICT;
            CREATE TABLE IF NOT EXISTS annotation_outcome_links(
                link_id TEXT PRIMARY KEY,
                annotation_id TEXT NOT NULL UNIQUE,
                feedback_id TEXT NOT NULL,
                body_sha TEXT NOT NULL,
                body BLOB NOT NULL,
                FOREIGN KEY(annotation_id) REFERENCES annotations(annotation_id),
                FOREIGN KEY(feedback_id) REFERENCES feedback(feedback_id)
            ) STRICT;
            CREATE TABLE IF NOT EXISTS drift_alarms(
                alarm_id TEXT PRIMARY KEY,
                body_sha TEXT NOT NULL,
                body BLOB NOT NULL,
                command_sha TEXT NOT NULL,
                command BLOB NOT NULL,
                transition_id TEXT NOT NULL UNIQUE
            ) STRICT;
            CREATE TABLE IF NOT EXISTS retirements(
                retirement_id TEXT PRIMARY KEY,
                model_id TEXT NOT NULL,
                model_revision TEXT NOT NULL,
                body_sha TEXT NOT NULL,
                body BLOB NOT NULL,
                UNIQUE(model_id, model_revision)
            ) STRICT;
            """
        )
        row = connection.execute(
            "SELECT value FROM registry_meta WHERE key = 'schema_version'"
        ).fetchone()
        if row is None:
            connection.execute(
                "INSERT INTO registry_meta(key, value) VALUES('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
        elif row["value"] != str(SCHEMA_VERSION):
            raise RegistryIntegrityError("unsupported registry schema version")

    def _begin(self, hook: FaultHook | None) -> sqlite3.Connection:
        connection = self._require_open()
        connection.execute("BEGIN IMMEDIATE")
        try:
            if hook is not None:
                hook(CommitStage.AFTER_BEGIN)
        except BaseException:
            self._rollback(connection)
            raise
        return connection

    @staticmethod
    def _finish(connection: sqlite3.Connection, hook: FaultHook | None) -> None:
        if hook is not None:
            hook(CommitStage.BEFORE_COMMIT)
        connection.execute("COMMIT")
        if hook is not None:
            hook(CommitStage.AFTER_COMMIT)

    @staticmethod
    def _rollback(connection: sqlite3.Connection) -> None:
        if connection.in_transaction:
            connection.execute("ROLLBACK")

    def register_card(
        self,
        card: DatasetCardV1 | ModelCardV1 | ExperimentCardV1,
        *,
        recorded_at_ms: int,
    ) -> DigestV1:
        require_utc_millis(recorded_at_ms, field="recorded_at_ms")
        if isinstance(card, DatasetCardV1):
            kind = "DATASET"
        elif isinstance(card, ModelCardV1):
            kind = "MODEL"
        elif isinstance(card, ExperimentCardV1):
            kind = "EXPERIMENT"
        else:
            raise ContractValueError("card must be a Q15 dataset, model or experiment card")
        mapping = card.as_mapping()
        digest = mapping_digest(mapping)
        body = canonical_json_bytes(mapping)
        connection = self._require_open()
        existing = connection.execute(
            "SELECT digest, body FROM cards WHERE kind=? AND card_id=? AND revision=?",
            (kind, card.card_id, card.revision),
        ).fetchone()
        if existing is not None:
            if existing["digest"] != digest.hexdigest or bytes(existing["body"]) != body:
                raise RegistryConflictError("card identity is immutable and already differs")
            return digest
        try:
            connection.execute(
                "INSERT INTO cards(kind, card_id, revision, digest, body, recorded_at_ms) "
                "VALUES(?,?,?,?,?,?)",
                (kind, card.card_id, card.revision, digest.hexdigest, body, recorded_at_ms),
            )
        except sqlite3.IntegrityError as error:
            message = "card digest is already bound to another identity"
            raise RegistryConflictError(message) from error
        return digest

    def register_artifact(
        self,
        reference: ArtifactRefV1,
        *,
        artifact_root: Path,
        recorded_at_ms: int,
    ) -> DigestV1:
        require_utc_millis(recorded_at_ms, field="recorded_at_ms")
        read_verified_artifact(artifact_root, reference)
        body = canonical_json_bytes(reference.as_mapping())
        digest = mapping_digest(reference.as_mapping())
        connection = self._require_open()
        existing = connection.execute(
            "SELECT digest, body FROM artifacts WHERE artifact_id=?", (reference.artifact_id,)
        ).fetchone()
        if existing is not None:
            if existing["digest"] != digest.hexdigest or bytes(existing["body"]) != body:
                raise RegistryConflictError("artifact_id is immutable and already differs")
            return digest
        connection.execute(
            "INSERT INTO artifacts(artifact_id,digest,body,recorded_at_ms) VALUES(?,?,?,?)",
            (reference.artifact_id, digest.hexdigest, body, recorded_at_ms),
        )
        return digest

    def _card_row(self, kind: str, digest: DigestV1) -> sqlite3.Row:
        row = (
            self._require_open()
            .execute("SELECT * FROM cards WHERE kind=? AND digest=?", (kind, digest.hexdigest))
            .fetchone()
        )
        if row is None:
            raise RegistryConflictError(f"required {kind.lower()} card digest is not registered")
        mapping = parse_canonical_object(bytes(row["body"]))
        if mapping_digest(mapping) != digest or bytes(row["body"]) != canonical_json_bytes(mapping):
            raise RegistryIntegrityError("persisted card digest does not verify")
        return cast(sqlite3.Row, row)

    def register_model(
        self,
        registration: ModelRegistrationV1,
        *,
        artifact_root: Path,
    ) -> DigestV1:
        if not isinstance(registration, ModelRegistrationV1):
            raise ContractValueError("registration must be ModelRegistrationV1")
        self.register_artifact(
            registration.artifact,
            artifact_root=artifact_root,
            recorded_at_ms=registration.registered_at_ms,
        )
        model_card = self._card_row("MODEL", registration.model_card_digest)
        dataset_card = self._card_row("DATASET", registration.dataset_card_digest)
        experiment_card = self._card_row("EXPERIMENT", registration.experiment_card_digest)
        model_card_mapping = parse_canonical_object(bytes(model_card["body"]))
        dataset_card_mapping = parse_canonical_object(bytes(dataset_card["body"]))
        experiment_card_mapping = parse_canonical_object(bytes(experiment_card["body"]))
        artifact_ids = model_card_mapping.get("artifactIds")
        dataset_artifact_ids = dataset_card_mapping.get("artifactIds")
        experiment_artifact_ids = experiment_card_mapping.get("artifactIds")
        experiment_model_card_ids = experiment_card_mapping.get("modelCardIds")
        if not all(
            isinstance(value, list)
            for value in (
                artifact_ids,
                dataset_artifact_ids,
                experiment_artifact_ids,
                experiment_model_card_ids,
            )
        ):
            raise RegistryIntegrityError("registry card identity lists are malformed")
        artifact_ids = cast(list[object], artifact_ids)
        dataset_artifact_ids = cast(list[object], dataset_artifact_ids)
        experiment_artifact_ids = cast(list[object], experiment_artifact_ids)
        experiment_model_card_ids = cast(list[object], experiment_model_card_ids)
        if (
            model_card_mapping.get("modelId") != registration.model_id
            or model_card_mapping.get("modelRevision") != registration.model_revision
            or registration.artifact.artifact_id not in artifact_ids
            or model_card_mapping.get("posture") != registration.posture.value
            or model_card_mapping.get("registryStateAtIssue")
            != ModelLifecycle.SHADOW_CHALLENGER.value
            or registration.artifact.artifact_id not in dataset_artifact_ids
            or model_card_mapping.get("cardId") not in experiment_model_card_ids
            or registration.artifact.artifact_id not in experiment_artifact_ids
            or dataset_card_mapping.get("posture") != registration.posture.value
            or experiment_card_mapping.get("posture") != registration.posture.value
        ):
            raise RegistryConflictError(
                "model registration does not match its immutable model card"
            )
        mapping = registration.as_mapping()
        digest = mapping_digest(mapping)
        body = canonical_json_bytes(mapping)
        connection = self._require_open()
        existing = connection.execute(
            "SELECT body_sha, body FROM models WHERE model_id=? AND model_revision=?",
            (registration.model_id, registration.model_revision),
        ).fetchone()
        if existing is not None:
            if existing["body_sha"] != digest.hexdigest or bytes(existing["body"]) != body:
                raise RegistryConflictError("model registration identity already differs")
            return digest
        connection.execute(
            """
            INSERT INTO models(
                model_id,model_revision,artifact_id,artifact_sha,model_card_sha,
                dataset_card_sha,experiment_card_sha,output_contract_id,target_id,
                score_contract_id,evidence_posture,
                lifecycle,body_sha,body,registered_at_ms
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                registration.model_id,
                registration.model_revision,
                registration.artifact.artifact_id,
                registration.artifact.sha256.hexdigest,
                registration.model_card_digest.hexdigest,
                registration.dataset_card_digest.hexdigest,
                registration.experiment_card_digest.hexdigest,
                registration.output_contract_id,
                registration.target_id,
                registration.score_contract_id,
                registration.posture.value,
                ModelLifecycle.SHADOW_CHALLENGER.value,
                digest.hexdigest,
                body,
                registration.registered_at_ms,
            ),
        )
        return digest

    def _model_row(self, model_id: str, model_revision: str) -> sqlite3.Row:
        row = (
            self._require_open()
            .execute(
                "SELECT * FROM models WHERE model_id=? AND model_revision=?",
                (model_id, model_revision),
            )
            .fetchone()
        )
        if row is None:
            raise RegistryConflictError("model identity is not registered")
        return cast(sqlite3.Row, row)

    def model_lifecycle(self, model_id: str, model_revision: str) -> ModelLifecycle:
        require_contract_id(model_id, field="model_id")
        require_contract_id(model_revision, field="model_revision")
        return ModelLifecycle(str(self._model_row(model_id, model_revision)["lifecycle"]))

    def _model_artifact_reference(self, model: sqlite3.Row) -> ArtifactRefV1:
        artifact_row = (
            self._require_open()
            .execute(
                "SELECT digest,body FROM artifacts WHERE artifact_id=?", (model["artifact_id"],)
            )
            .fetchone()
        )
        if artifact_row is None:
            raise RegistryIntegrityError("model artifact manifest is absent")
        mapping = parse_canonical_object(bytes(artifact_row["body"]))
        reference = _artifact_from_mapping(mapping)
        if (
            mapping_digest(mapping).hexdigest != artifact_row["digest"]
            or reference.sha256.hexdigest != model["artifact_sha"]
        ):
            raise RegistryIntegrityError("model artifact manifest binding is corrupt")
        return reference

    def _current(self, slot_id: str) -> ChampionSnapshotV1 | None:
        row = (
            self._require_open()
            .execute(
                "SELECT generation,snapshot_sha,snapshot FROM champions WHERE slot_id=?",
                (slot_id,),
            )
            .fetchone()
        )
        if row is None:
            return None
        mapping = parse_canonical_object(bytes(row["snapshot"]))
        snapshot = _snapshot_from_mapping(mapping)
        if (
            snapshot.slot_id != slot_id
            or snapshot.generation != row["generation"]
            or snapshot.content_digest.hexdigest != row["snapshot_sha"]
            or bytes(row["snapshot"]) != canonical_json_bytes(mapping)
        ):
            raise RegistryIntegrityError("champion projection is corrupt")
        return snapshot

    def current_champion(self, slot_id: str) -> ChampionSnapshotV1 | None:
        require_contract_id(slot_id, field="slot_id")
        return self._current(slot_id)

    def _idempotent_transition(
        self,
        connection: sqlite3.Connection,
        transition_id: str,
        command_sha: DigestV1,
    ) -> ChampionSnapshotV1 | None:
        row = connection.execute(
            "SELECT command_sha,command,next_snapshot_sha,next_snapshot FROM transitions "
            "WHERE transition_id=?",
            (transition_id,),
        ).fetchone()
        if row is None:
            return None
        if row["command_sha"] != command_sha.hexdigest:
            raise RegistryConflictError("transition idempotency key conflicts with prior command")
        stored_command = parse_canonical_object(bytes(row["command"]))
        if mapping_digest(stored_command).hexdigest != row["command_sha"]:
            raise RegistryIntegrityError("stored transition command is corrupt")
        snapshot = _snapshot_from_mapping(parse_canonical_object(bytes(row["next_snapshot"])))
        if snapshot.content_digest.hexdigest != row["next_snapshot_sha"]:
            raise RegistryIntegrityError("stored transition snapshot is corrupt")
        return snapshot

    @staticmethod
    def _new_snapshot(
        *,
        slot_id: str,
        generation: int,
        model: sqlite3.Row,
        policy_revision: str,
        posture: ServingPosture,
        transition_id: str,
        now_ms: int,
    ) -> ChampionSnapshotV1:
        return ChampionSnapshotV1(
            slot_id=slot_id,
            generation=generation,
            model_id=str(model["model_id"]),
            model_revision=str(model["model_revision"]),
            artifact_sha256=DigestV1(str(model["artifact_sha"])),
            model_card_sha256=DigestV1(str(model["model_card_sha"])),
            policy_revision=policy_revision,
            posture=posture,
            transition_id=transition_id,
            updated_at_ms=now_ms,
        )

    @staticmethod
    def _persist_transition(
        connection: sqlite3.Connection,
        *,
        transition_id: str,
        command_sha: DigestV1,
        command: dict[str, object],
        kind: TransitionKind,
        previous: ChampionSnapshotV1 | None,
        next_snapshot: ChampionSnapshotV1,
        evidence_sha: DigestV1 | None,
        evidence: dict[str, object] | None,
        reason: str,
        now_ms: int,
    ) -> None:
        body = canonical_json_bytes(next_snapshot.as_mapping())
        digest = next_snapshot.content_digest.hexdigest
        command_body = canonical_json_bytes(command)
        if mapping_digest(command) != command_sha:
            raise RegistryIntegrityError("transition command digest does not verify")
        evidence_body = None if evidence is None else canonical_json_bytes(evidence)
        if (evidence is None) != (evidence_sha is None):
            raise RegistryIntegrityError("transition evidence body/digest presence mismatch")
        if evidence is not None and mapping_digest(evidence) != evidence_sha:
            raise RegistryIntegrityError("transition evidence digest does not verify")
        connection.execute(
            "INSERT INTO transitions(transition_id,command_sha,command,kind,slot_id,"
            "previous_snapshot_sha,next_snapshot_sha,next_snapshot,evidence_sha,evidence,reason,"
            "committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                transition_id,
                command_sha.hexdigest,
                command_body,
                kind.value,
                next_snapshot.slot_id,
                None if previous is None else previous.content_digest.hexdigest,
                digest,
                body,
                None if evidence_sha is None else evidence_sha.hexdigest,
                evidence_body,
                reason,
                now_ms,
            ),
        )
        connection.execute(
            "INSERT INTO champion_history(slot_id,generation,snapshot_sha,snapshot) "
            "VALUES(?,?,?,?)",
            (next_snapshot.slot_id, next_snapshot.generation, digest, body),
        )
        connection.execute(
            "INSERT INTO champions(slot_id,generation,snapshot_sha,snapshot) VALUES(?,?,?,?) "
            "ON CONFLICT(slot_id) DO UPDATE SET generation=excluded.generation,"
            "snapshot_sha=excluded.snapshot_sha,snapshot=excluded.snapshot",
            (next_snapshot.slot_id, next_snapshot.generation, digest, body),
        )

    def bootstrap_research_champion(
        self,
        *,
        slot_id: str,
        model_id: str,
        model_revision: str,
        transition_id: str,
        policy_revision: str,
        reason: str,
        now_ms: int,
        artifact_root: Path,
        expected_generation: int = 0,
        hook: FaultHook | None = None,
    ) -> ChampionSnapshotV1:
        for field_name, value in (
            ("slot_id", slot_id),
            ("model_id", model_id),
            ("model_revision", model_revision),
            ("transition_id", transition_id),
            ("policy_revision", policy_revision),
        ):
            require_contract_id(value, field=field_name)
        _require_reason(reason, field="reason")
        require_utc_millis(now_ms, field="now_ms")
        require_strict_int(expected_generation, field="expected_generation", minimum=0)
        command = {
            "expectedGeneration": expected_generation,
            "kind": TransitionKind.BOOTSTRAP.value,
            "modelId": model_id,
            "modelRevision": model_revision,
            "policyRevision": policy_revision,
            "reason": reason,
            "slotId": slot_id,
            "transitionId": transition_id,
        }
        command_sha = mapping_digest(command)
        connection = self._begin(hook)
        try:
            prior = self._idempotent_transition(connection, transition_id, command_sha)
            if prior is not None:
                self._finish(connection, hook)
                return prior
            if self._current(slot_id) is not None or expected_generation != 0:
                raise RegistryConflictError("bootstrap requires an empty slot at generation zero")
            model = self._model_row(model_id, model_revision)
            if model["lifecycle"] != ModelLifecycle.SHADOW_CHALLENGER.value:
                raise RegistryConflictError("bootstrap model must be a shadow challenger")
            if model["evidence_posture"] != EvidencePosture.SYNTHETIC_ONLY.value:
                raise RegistryConflictError("bootstrap is limited to explicit SYNTHETIC_ONLY proof")
            read_verified_artifact(artifact_root, self._model_artifact_reference(model))
            snapshot = self._new_snapshot(
                slot_id=slot_id,
                generation=1,
                model=model,
                policy_revision=policy_revision,
                posture=ServingPosture.ADVISORY,
                transition_id=transition_id,
                now_ms=now_ms,
            )
            connection.execute(
                "UPDATE models SET lifecycle=? WHERE model_id=? AND model_revision=?",
                (ModelLifecycle.CHAMPION.value, model_id, model_revision),
            )
            self._persist_transition(
                connection,
                transition_id=transition_id,
                command_sha=command_sha,
                command=command,
                kind=TransitionKind.BOOTSTRAP,
                previous=None,
                next_snapshot=snapshot,
                evidence_sha=None,
                evidence=None,
                reason=reason,
                now_ms=now_ms,
            )
            self._finish(connection, hook)
            return snapshot
        except BaseException:
            self._rollback(connection)
            raise

    def promote_challenger(
        self,
        *,
        slot_id: str,
        candidate_model_id: str,
        candidate_model_revision: str,
        transition_id: str,
        policy_revision: str,
        evidence: ValidationBindingV1,
        reason: str,
        now_ms: int,
        expected_generation: int,
        artifact_root: Path,
        hook: FaultHook | None = None,
    ) -> ChampionSnapshotV1:
        for field_name, value in (
            ("slot_id", slot_id),
            ("candidate_model_id", candidate_model_id),
            ("candidate_model_revision", candidate_model_revision),
            ("transition_id", transition_id),
            ("policy_revision", policy_revision),
        ):
            require_contract_id(value, field=field_name)
        if not isinstance(evidence, ValidationBindingV1):
            raise ContractValueError("evidence must be ValidationBindingV1")
        _require_reason(reason, field="reason")
        require_utc_millis(now_ms, field="now_ms")
        require_strict_int(expected_generation, field="expected_generation", minimum=1)
        report_raw = read_verified_artifact(artifact_root, evidence.report_artifact)
        command = {
            "candidateModelId": candidate_model_id,
            "candidateModelRevision": candidate_model_revision,
            "evidence": evidence.as_mapping(),
            "expectedGeneration": expected_generation,
            "kind": TransitionKind.PROMOTION.value,
            "policyRevision": policy_revision,
            "reason": reason,
            "slotId": slot_id,
            "transitionId": transition_id,
        }
        command_sha = mapping_digest(command)
        connection = self._begin(hook)
        try:
            prior = self._idempotent_transition(connection, transition_id, command_sha)
            if prior is not None:
                self._finish(connection, hook)
                return prior
            current = self._current(slot_id)
            if current is None or current.generation != expected_generation:
                raise RegistryConflictError("promotion expected generation is stale")
            if now_ms <= current.updated_at_ms:
                raise RegistryConflictError("promotion timestamp must advance champion history")
            if current.posture is not ServingPosture.ADVISORY:
                raise RegistryConflictError("an abstaining champion cannot promote a challenger")
            candidate = self._model_row(candidate_model_id, candidate_model_revision)
            if candidate["lifecycle"] != ModelLifecycle.SHADOW_CHALLENGER.value:
                raise RegistryConflictError("promotion candidate must be a shadow challenger")
            current_model = self._model_row(current.model_id, current.model_revision)
            if (
                candidate["target_id"] != current_model["target_id"]
                or candidate["score_contract_id"] != current_model["score_contract_id"]
            ):
                raise RegistryConflictError("promotion candidate output contract is incompatible")
            read_verified_artifact(artifact_root, self._model_artifact_reference(current_model))
            if (
                candidate["evidence_posture"]
                not in (
                    EvidencePosture.SYNTHETIC_ONLY.value,
                    EvidencePosture.RESEARCH_ONLY.value,
                )
                or candidate["evidence_posture"] != evidence.posture.value
            ):
                raise RegistryConflictError("promotion evidence posture is incompatible")
            candidate_artifact = self._model_artifact_reference(candidate)
            read_verified_artifact(artifact_root, candidate_artifact)
            exact_subject = (
                evidence.subject_model_id == candidate_model_id
                and evidence.subject_model_revision == candidate_model_revision
                and evidence.subject_artifact_sha256.hexdigest == candidate["artifact_sha"]
            )
            exact_comparison = (
                evidence.report_baseline_model_id == current.model_id
                and evidence.report_challenger_model_id == candidate_model_id
            )
            if not exact_subject or not exact_comparison:
                raise RegistryConflictError("VALIDATION_ARTIFACT_MISMATCH")
            if not evidence.gates.all_passed:
                raise RegistryConflictError("PROMOTION_GATE_INCOMPLETE")
            shadow_row = connection.execute(
                "SELECT body_sha,body FROM shadow_comparisons WHERE body_sha=?",
                (evidence.shadow_report_sha256.hexdigest,),
            ).fetchone()
            if shadow_row is None:
                raise RegistryConflictError("MATURE_SHADOW_COMPARISON_MISSING")
            shadow = parse_canonical_object(bytes(shadow_row["body"]))
            if (
                bytes(shadow_row["body"]) != canonical_json_bytes(shadow)
                or mapping_digest(shadow).hexdigest != shadow_row["body_sha"]
            ):
                raise RegistryIntegrityError("persisted shadow comparison is corrupt")
            shadow_exact = (
                shadow.get("slotId") == slot_id
                and shadow.get("championGeneration") == current.generation
                and shadow.get("championTransitionId") == current.transition_id
                and shadow.get("championModelId") == current.model_id
                and shadow.get("championModelRevision") == current.model_revision
                and shadow.get("championArtifactSha256") == current.artifact_sha256.hexdigest
                and shadow.get("challengerModelId") == candidate_model_id
                and shadow.get("challengerModelRevision") == candidate_model_revision
                and shadow.get("challengerArtifactSha256") == candidate["artifact_sha"]
                and shadow.get("verdict") == "PASS"
                and shadow.get("posture") == evidence.posture.value
            )
            if not shadow_exact:
                raise RegistryConflictError("MATURE_SHADOW_COMPARISON_MISMATCH")
            if evidence.posture is EvidencePosture.SYNTHETIC_ONLY:
                if evidence.report_verdict != "SYNTHETIC_FIXTURE_PASS":
                    raise RegistryConflictError(
                        "synthetic promotion requires explicit fixture verdict"
                    )
            elif evidence.report_verdict != "IMPROVES":
                raise RegistryConflictError("promotion report must carry an exact IMPROVES verdict")
            _verify_validation_report_content(report_raw, evidence, current, candidate)
            registered_report = connection.execute(
                "SELECT digest,body FROM artifacts WHERE artifact_id=?",
                (evidence.report_artifact.artifact_id,),
            ).fetchone()
            if registered_report is None:
                raise RegistryConflictError("validation report artifact is not registered")
            report_mapping = parse_canonical_object(bytes(registered_report["body"]))
            if (
                bytes(registered_report["body"]) != canonical_json_bytes(report_mapping)
                or mapping_digest(report_mapping).hexdigest != registered_report["digest"]
                or _artifact_from_mapping(report_mapping) != evidence.report_artifact
            ):
                raise RegistryIntegrityError("validation report registry binding is corrupt")
            snapshot = self._new_snapshot(
                slot_id=slot_id,
                generation=current.generation + 1,
                model=candidate,
                policy_revision=policy_revision,
                posture=ServingPosture.ADVISORY,
                transition_id=transition_id,
                now_ms=now_ms,
            )
            connection.execute(
                "UPDATE models SET lifecycle=? WHERE model_id=? AND model_revision=?",
                (ModelLifecycle.SHADOW_CHALLENGER.value, current.model_id, current.model_revision),
            )
            connection.execute(
                "UPDATE models SET lifecycle=? WHERE model_id=? AND model_revision=?",
                (ModelLifecycle.CHAMPION.value, candidate_model_id, candidate_model_revision),
            )
            self._persist_transition(
                connection,
                transition_id=transition_id,
                command_sha=command_sha,
                command=command,
                kind=TransitionKind.PROMOTION,
                previous=current,
                next_snapshot=snapshot,
                evidence_sha=mapping_digest(evidence.as_mapping()),
                evidence=evidence.as_mapping(),
                reason=reason,
                now_ms=now_ms,
            )
            self._finish(connection, hook)
            return snapshot
        except BaseException:
            self._rollback(connection)
            raise

    def apply_drift_alarm(
        self,
        *,
        slot_id: str,
        transition_id: str,
        policy_revision: str,
        alarm: DriftAlarmV1,
        expected_generation: int,
    ) -> ChampionSnapshotV1:
        require_contract_id(slot_id, field="slot_id")
        require_contract_id(transition_id, field="transition_id")
        require_contract_id(policy_revision, field="policy_revision")
        if not isinstance(alarm, DriftAlarmV1):
            raise ContractValueError("alarm must be DriftAlarmV1")
        require_strict_int(expected_generation, field="expected_generation", minimum=1)
        command = {
            "alarm": alarm.as_mapping(),
            "expectedGeneration": expected_generation,
            "kind": TransitionKind.DEMOTION.value,
            "policyRevision": policy_revision,
            "slotId": slot_id,
            "transitionId": transition_id,
        }
        command_sha = mapping_digest(command)
        connection = self._begin(None)
        try:
            prior = self._idempotent_transition(connection, transition_id, command_sha)
            if prior is not None:
                self._finish(connection, None)
                return prior
            current = self._current(slot_id)
            if current is None or current.generation != expected_generation:
                raise RegistryConflictError("drift expected generation is stale")
            if (
                alarm.monitored_model_id != current.model_id
                or alarm.monitored_model_revision != current.model_revision
                or alarm.monitored_artifact_sha256 != current.artifact_sha256
                or alarm.monitored_generation != current.generation
                or alarm.monitored_transition_id != current.transition_id
            ):
                raise RegistryConflictError("drift alarm is not bound to the exact champion")
            if alarm.observed_at_ms <= current.updated_at_ms:
                raise RegistryConflictError("drift alarm predates the exact champion")
            alarm_body = canonical_json_bytes(alarm.as_mapping())
            existing_alarm = connection.execute(
                "SELECT body_sha,body,command_sha,command,transition_id "
                "FROM drift_alarms WHERE alarm_id=?",
                (alarm.alarm_id,),
            ).fetchone()
            if existing_alarm is not None:
                if (
                    existing_alarm["body_sha"] != alarm.content_digest.hexdigest
                    or bytes(existing_alarm["body"]) != alarm_body
                    or existing_alarm["command_sha"] != command_sha.hexdigest
                    or bytes(existing_alarm["command"]) != canonical_json_bytes(command)
                    or existing_alarm["transition_id"] != transition_id
                ):
                    raise RegistryConflictError("drift alarm identity already differs")
            else:
                try:
                    connection.execute(
                        "INSERT INTO drift_alarms(alarm_id,body_sha,body,command_sha,command,"
                        "transition_id) VALUES(?,?,?,?,?,?)",
                        (
                            alarm.alarm_id,
                            alarm.content_digest.hexdigest,
                            alarm_body,
                            command_sha.hexdigest,
                            canonical_json_bytes(command),
                            transition_id,
                        ),
                    )
                except sqlite3.IntegrityError as error:
                    raise RegistryConflictError(
                        "drift observation transition identity is already reserved"
                    ) from error
            if not alarm.alarmed and alarm.response is DriftResponse.WARN:
                self._finish(connection, None)
                return current
            posture = current.posture
            if alarm.alarmed and alarm.response is DriftResponse.ABSTAIN_UNKNOWN:
                posture = ServingPosture.ABSTAIN_UNKNOWN
            snapshot = ChampionSnapshotV1(
                slot_id=current.slot_id,
                generation=current.generation + 1,
                model_id=current.model_id,
                model_revision=current.model_revision,
                artifact_sha256=current.artifact_sha256,
                model_card_sha256=current.model_card_sha256,
                policy_revision=policy_revision,
                posture=posture,
                transition_id=transition_id,
                updated_at_ms=alarm.observed_at_ms,
            )
            self._persist_transition(
                connection,
                transition_id=transition_id,
                command_sha=command_sha,
                command=command,
                kind=TransitionKind.DEMOTION,
                previous=current,
                next_snapshot=snapshot,
                evidence_sha=alarm.content_digest,
                evidence=alarm.as_mapping(),
                reason=alarm.reason_code,
                now_ms=alarm.observed_at_ms,
            )
            self._finish(connection, None)
            return snapshot
        except BaseException:
            self._rollback(connection)
            raise

    def recover_advisory_posture(
        self,
        *,
        slot_id: str,
        transition_id: str,
        policy_revision: str,
        reason: str,
        now_ms: int,
        expected_generation: int,
        artifact_root: Path,
    ) -> ChampionSnapshotV1:
        require_contract_id(slot_id, field="slot_id")
        require_contract_id(transition_id, field="transition_id")
        require_contract_id(policy_revision, field="policy_revision")
        _require_reason(reason, field="reason")
        require_utc_millis(now_ms, field="now_ms")
        require_strict_int(expected_generation, field="expected_generation", minimum=1)
        command = {
            "expectedGeneration": expected_generation,
            "kind": TransitionKind.RECOVERY.value,
            "policyRevision": policy_revision,
            "reason": reason,
            "slotId": slot_id,
            "transitionId": transition_id,
        }
        command_sha = mapping_digest(command)
        connection = self._begin(None)
        try:
            prior = self._idempotent_transition(connection, transition_id, command_sha)
            if prior is not None:
                self._finish(connection, None)
                return prior
            current = self._current(slot_id)
            if current is None or current.generation != expected_generation:
                raise RegistryConflictError("recovery expected generation is stale")
            if now_ms <= current.updated_at_ms:
                raise RegistryConflictError("recovery timestamp must advance champion history")
            if current.posture is not ServingPosture.ABSTAIN_UNKNOWN:
                raise RegistryConflictError("only an abstaining champion needs explicit recovery")
            historical = connection.execute(
                "SELECT snapshot_sha FROM champion_history WHERE slot_id=? AND "
                "json_extract(snapshot,'$.modelId')=? AND "
                "json_extract(snapshot,'$.modelRevision')=? AND "
                "json_extract(snapshot,'$.artifactSha256')=? AND "
                "json_extract(snapshot,'$.posture')=? ORDER BY generation DESC LIMIT 1",
                (
                    slot_id,
                    current.model_id,
                    current.model_revision,
                    current.artifact_sha256.hexdigest,
                    ServingPosture.ADVISORY.value,
                ),
            ).fetchone()
            if historical is None:
                raise RegistryConflictError("no exact prior advisory champion exists")
            model = self._model_row(current.model_id, current.model_revision)
            read_verified_artifact(artifact_root, self._model_artifact_reference(model))
            snapshot = ChampionSnapshotV1(
                slot_id=current.slot_id,
                generation=current.generation + 1,
                model_id=current.model_id,
                model_revision=current.model_revision,
                artifact_sha256=current.artifact_sha256,
                model_card_sha256=current.model_card_sha256,
                policy_revision=policy_revision,
                posture=ServingPosture.ADVISORY,
                transition_id=transition_id,
                updated_at_ms=now_ms,
            )
            recovery_evidence: dict[str, object] = {
                "historicalSnapshotSha256": str(historical["snapshot_sha"])
            }
            self._persist_transition(
                connection,
                transition_id=transition_id,
                command_sha=command_sha,
                command=command,
                kind=TransitionKind.RECOVERY,
                previous=current,
                next_snapshot=snapshot,
                evidence_sha=mapping_digest(recovery_evidence),
                evidence=recovery_evidence,
                reason=reason,
                now_ms=now_ms,
            )
            self._finish(connection, None)
            return snapshot
        except BaseException:
            self._rollback(connection)
            raise

    def rollback_champion(
        self,
        *,
        slot_id: str,
        target_model_id: str,
        target_model_revision: str,
        target_artifact_sha256: DigestV1,
        transition_id: str,
        policy_revision: str,
        reason: str,
        now_ms: int,
        expected_generation: int,
        artifact_root: Path,
    ) -> ChampionSnapshotV1:
        for field_name, value in (
            ("slot_id", slot_id),
            ("target_model_id", target_model_id),
            ("target_model_revision", target_model_revision),
            ("transition_id", transition_id),
            ("policy_revision", policy_revision),
        ):
            require_contract_id(value, field=field_name)
        if not isinstance(target_artifact_sha256, DigestV1):
            raise ContractValueError("target_artifact_sha256 must be DigestV1")
        _require_reason(reason, field="reason")
        require_utc_millis(now_ms, field="now_ms")
        require_strict_int(expected_generation, field="expected_generation", minimum=1)
        command = {
            "expectedGeneration": expected_generation,
            "kind": TransitionKind.ROLLBACK.value,
            "policyRevision": policy_revision,
            "reason": reason,
            "slotId": slot_id,
            "targetArtifactSha256": target_artifact_sha256.hexdigest,
            "targetModelId": target_model_id,
            "targetModelRevision": target_model_revision,
            "transitionId": transition_id,
        }
        command_sha = mapping_digest(command)
        connection = self._begin(None)
        try:
            prior = self._idempotent_transition(connection, transition_id, command_sha)
            if prior is not None:
                self._finish(connection, None)
                return prior
            current = self._current(slot_id)
            if current is None or current.generation != expected_generation:
                raise RegistryConflictError("rollback expected generation is stale")
            if now_ms <= current.updated_at_ms:
                raise RegistryConflictError("rollback timestamp must advance champion history")
            if (
                current.model_id == target_model_id
                and current.model_revision == target_model_revision
                and current.artifact_sha256 == target_artifact_sha256
            ):
                raise RegistryConflictError("rollback target is already champion")
            historical = connection.execute(
                "SELECT 1 FROM champion_history WHERE slot_id=? AND "
                "json_extract(snapshot,'$.modelId')=? AND "
                "json_extract(snapshot,'$.modelRevision')=? AND "
                "json_extract(snapshot,'$.artifactSha256')=? LIMIT 1",
                (slot_id, target_model_id, target_model_revision, target_artifact_sha256.hexdigest),
            ).fetchone()
            if historical is None:
                raise RegistryConflictError("rollback target was never an exact prior champion")
            target = self._model_row(target_model_id, target_model_revision)
            if target["artifact_sha"] != target_artifact_sha256.hexdigest:
                raise RegistryConflictError("rollback target artifact identity mismatch")
            if target["lifecycle"] != ModelLifecycle.SHADOW_CHALLENGER.value:
                raise RegistryConflictError("rollback target must be an unoccupied shadow model")
            current_model = self._model_row(current.model_id, current.model_revision)
            if (
                target["target_id"] != current_model["target_id"]
                or target["score_contract_id"] != current_model["score_contract_id"]
            ):
                raise RegistryConflictError("rollback target output contract is incompatible")
            target_reference = self._model_artifact_reference(target)
            read_verified_artifact(artifact_root, target_reference)
            snapshot = self._new_snapshot(
                slot_id=slot_id,
                generation=current.generation + 1,
                model=target,
                policy_revision=policy_revision,
                posture=ServingPosture.ADVISORY,
                transition_id=transition_id,
                now_ms=now_ms,
            )
            connection.execute(
                "UPDATE models SET lifecycle=? WHERE model_id=? AND model_revision=?",
                (ModelLifecycle.SHADOW_CHALLENGER.value, current.model_id, current.model_revision),
            )
            connection.execute(
                "UPDATE models SET lifecycle=? WHERE model_id=? AND model_revision=?",
                (ModelLifecycle.CHAMPION.value, target_model_id, target_model_revision),
            )
            rollback_evidence: dict[str, object] = {
                "targetArtifactSha256": target_artifact_sha256.hexdigest,
                "targetModelId": target_model_id,
                "targetModelRevision": target_model_revision,
            }
            self._persist_transition(
                connection,
                transition_id=transition_id,
                command_sha=command_sha,
                command=command,
                kind=TransitionKind.ROLLBACK,
                previous=current,
                next_snapshot=snapshot,
                evidence_sha=mapping_digest(rollback_evidence),
                evidence=rollback_evidence,
                reason=reason,
                now_ms=now_ms,
            )
            self._finish(connection, None)
            return snapshot
        except BaseException:
            self._rollback(connection)
            raise

    def retire_model(self, record: RetirementRecordV1) -> DigestV1:
        if not isinstance(record, RetirementRecordV1):
            raise ContractValueError("record must be RetirementRecordV1")
        connection = self._begin(None)
        try:
            model = self._model_row(record.model_id, record.model_revision)
            if model["artifact_sha"] != record.artifact_sha256.hexdigest:
                raise RegistryConflictError("retirement artifact identity mismatch")
            active = connection.execute(
                "SELECT 1 FROM champions WHERE "
                "json_extract(snapshot,'$.modelId')=? AND "
                "json_extract(snapshot,'$.modelRevision')=? LIMIT 1",
                (record.model_id, record.model_revision),
            ).fetchone()
            if active is not None:
                raise RegistryConflictError("active champion must be rolled back before retirement")
            evidence_rows = connection.execute(
                "SELECT evidence_sha AS digest,evidence AS body FROM transitions "
                "WHERE evidence_sha=? UNION ALL "
                "SELECT body_sha AS digest,body FROM shadow_comparisons WHERE body_sha=? "
                "UNION ALL SELECT body_sha AS digest,body FROM drift_alarms WHERE body_sha=?",
                (
                    record.evidence_digest.hexdigest,
                    record.evidence_digest.hexdigest,
                    record.evidence_digest.hexdigest,
                ),
            ).fetchall()
            identity_keys = (
                ("subjectModelId", "subjectModelRevision", "subjectArtifactSha256"),
                ("monitoredModelId", "monitoredModelRevision", "monitoredArtifactSha256"),
                ("challengerModelId", "challengerModelRevision", "challengerArtifactSha256"),
                ("championModelId", "championModelRevision", "championArtifactSha256"),
                ("targetModelId", "targetModelRevision", "targetArtifactSha256"),
            )
            evidence_binds = False
            for evidence_row in evidence_rows:
                evidence_mapping = parse_canonical_object(bytes(evidence_row["body"]))
                if (
                    bytes(evidence_row["body"]) != canonical_json_bytes(evidence_mapping)
                    or mapping_digest(evidence_mapping).hexdigest != evidence_row["digest"]
                ):
                    raise RegistryIntegrityError("retirement evidence row is corrupt")
                evidence_binds = evidence_binds or any(
                    evidence_mapping.get(model_key) == record.model_id
                    and evidence_mapping.get(revision_key) == record.model_revision
                    and evidence_mapping.get(artifact_key) == record.artifact_sha256.hexdigest
                    for model_key, revision_key, artifact_key in identity_keys
                )
            if not evidence_binds:
                raise RegistryConflictError(
                    "retirement evidence does not bind the exact model artifact"
                )
            body = canonical_json_bytes(record.as_mapping())
            existing = connection.execute(
                "SELECT body_sha,body FROM retirements WHERE retirement_id=?",
                (record.retirement_id,),
            ).fetchone()
            if existing is not None:
                if (
                    existing["body_sha"] != record.content_digest.hexdigest
                    or bytes(existing["body"]) != body
                ):
                    raise RegistryConflictError("retirement idempotency key conflicts")
                self._finish(connection, None)
                return record.content_digest
            try:
                connection.execute(
                    "INSERT INTO retirements(retirement_id,model_id,model_revision,body_sha,body) "
                    "VALUES(?,?,?,?,?)",
                    (
                        record.retirement_id,
                        record.model_id,
                        record.model_revision,
                        record.content_digest.hexdigest,
                        body,
                    ),
                )
            except sqlite3.IntegrityError as error:
                raise RegistryConflictError(
                    "model already has an immutable retirement record"
                ) from error
            connection.execute(
                "UPDATE models SET lifecycle=? WHERE model_id=? AND model_revision=?",
                (ModelLifecycle.RETIRED.value, record.model_id, record.model_revision),
            )
            self._finish(connection, None)
            return record.content_digest
        except BaseException:
            self._rollback(connection)
            raise

    def record_shadow_batch(self, batch: ShadowScoreBatchV1) -> DigestV1:
        if not isinstance(batch, ShadowScoreBatchV1):
            raise ContractValueError("batch must be ShadowScoreBatchV1")
        body = canonical_json_bytes(batch.as_mapping())
        connection = self._begin(None)
        try:
            existing = connection.execute(
                "SELECT body_sha,body FROM shadow_batches WHERE batch_id=?", (batch.batch_id,)
            ).fetchone()
            if existing is not None:
                if (
                    existing["body_sha"] != batch.content_digest.hexdigest
                    or bytes(existing["body"]) != body
                ):
                    raise RegistryConflictError("shadow batch idempotency key conflicts")
                self._finish(connection, None)
                return batch.content_digest
            current = self._current(batch.slot_id)
            if current is None:
                raise RegistryConflictError("shadow batch requires an exact champion")
            if (
                batch.champion_generation != current.generation
                or batch.champion_transition_id != current.transition_id
                or batch.champion.model_id != current.model_id
                or batch.champion.model_revision != current.model_revision
                or batch.champion.artifact_sha256 != current.artifact_sha256
            ):
                raise RegistryConflictError("shadow batch champion identity is stale")
            champion_model = self._model_row(current.model_id, current.model_revision)
            target_id = str(champion_model["target_id"])
            score_contract = str(champion_model["score_contract_id"])
            if target_id != batch.target_id:
                raise RegistryConflictError("shadow batch target and output contract disagree")
            for challenger in batch.challengers:
                row = self._model_row(challenger.model_id, challenger.model_revision)
                if (
                    row["lifecycle"] != ModelLifecycle.SHADOW_CHALLENGER.value
                    or row["artifact_sha"] != challenger.artifact_sha256.hexdigest
                    or row["target_id"] != target_id
                    or row["score_contract_id"] != score_contract
                ):
                    raise RegistryConflictError(
                        "shadow prediction is not an exact compatible challenger"
                    )
            connection.execute(
                "INSERT INTO shadow_batches(batch_id,body_sha,body,slot_id,event_id,target_id,"
                "horizon_ms,matures_at_ms) VALUES(?,?,?,?,?,?,?,?)",
                (
                    batch.batch_id,
                    batch.content_digest.hexdigest,
                    body,
                    batch.slot_id,
                    batch.event_id,
                    batch.target_id,
                    batch.horizon_ms,
                    batch.matures_at_ms,
                ),
            )
            self._finish(connection, None)
            return batch.content_digest
        except BaseException:
            self._rollback(connection)
            raise

    def attach_delayed_feedback(self, feedback: DelayedFeedbackV1) -> DigestV1:
        if not isinstance(feedback, DelayedFeedbackV1):
            raise ContractValueError("feedback must be DelayedFeedbackV1")
        connection = self._begin(None)
        try:
            batch = connection.execute(
                "SELECT * FROM shadow_batches WHERE batch_id=?", (feedback.batch_id,)
            ).fetchone()
            if batch is None:
                raise RegistryConflictError("feedback batch is unknown")
            if (
                batch["event_id"] != feedback.event_id
                or batch["target_id"] != feedback.target_id
                or batch["horizon_ms"] != feedback.horizon_ms
            ):
                raise RegistryConflictError("feedback cannot cross event, target or horizon")
            if feedback.observed_at_ms < batch["matures_at_ms"]:
                raise RegistryConflictError("feedback horizon has not matured")
            body = canonical_json_bytes(feedback.as_mapping())
            existing = connection.execute(
                "SELECT body_sha,body FROM feedback WHERE feedback_id=? OR batch_id=?",
                (feedback.feedback_id, feedback.batch_id),
            ).fetchone()
            if existing is not None:
                if (
                    existing["body_sha"] != feedback.content_digest.hexdigest
                    or bytes(existing["body"]) != body
                ):
                    raise RegistryConflictError("feedback idempotency or horizon link conflicts")
                self._finish(connection, None)
                return feedback.content_digest
            connection.execute(
                "INSERT INTO feedback(feedback_id,batch_id,body_sha,body,observed_at_ms) "
                "VALUES(?,?,?,?,?)",
                (
                    feedback.feedback_id,
                    feedback.batch_id,
                    feedback.content_digest.hexdigest,
                    body,
                    feedback.observed_at_ms,
                ),
            )
            connection.execute(
                "UPDATE shadow_batches SET feedback_id=? WHERE batch_id=?",
                (feedback.feedback_id, feedback.batch_id),
            )
            self._finish(connection, None)
            return feedback.content_digest
        except BaseException:
            self._rollback(connection)
            raise

    def record_shadow_comparison(self, comparison: ShadowComparisonV1) -> DigestV1:
        if not isinstance(comparison, ShadowComparisonV1):
            raise ContractValueError("comparison must be ShadowComparisonV1")
        body = canonical_json_bytes(comparison.as_mapping())
        connection = self._begin(None)
        try:
            existing = connection.execute(
                "SELECT body_sha,body FROM shadow_comparisons WHERE comparison_id=?",
                (comparison.comparison_id,),
            ).fetchone()
            if existing is not None:
                if (
                    existing["body_sha"] != comparison.content_digest.hexdigest
                    or bytes(existing["body"]) != body
                ):
                    raise RegistryConflictError("shadow comparison identity already differs")
                self._finish(connection, None)
                return comparison.content_digest
            observed_feedback: list[str] = []
            champion_losses: list[int] = []
            challenger_losses: list[int] = []
            for batch_id in comparison.batch_ids:
                row = connection.execute(
                    "SELECT body_sha,body,feedback_id FROM shadow_batches WHERE batch_id=?",
                    (batch_id,),
                ).fetchone()
                if row is None or row["feedback_id"] is None:
                    raise RegistryConflictError("shadow comparison requires mature feedback")
                batch = parse_canonical_object(bytes(row["body"]))
                if (
                    bytes(row["body"]) != canonical_json_bytes(batch)
                    or mapping_digest(batch).hexdigest != row["body_sha"]
                ):
                    raise RegistryIntegrityError("persisted shadow batch is corrupt")
                challengers = batch.get("challengers")
                if not isinstance(challengers, list):
                    raise RegistryIntegrityError("persisted shadow challengers are malformed")
                challenger = next(
                    (
                        item
                        for item in challengers
                        if isinstance(item, dict)
                        and item.get("modelId") == comparison.challenger_model_id
                        and item.get("modelRevision") == comparison.challenger_model_revision
                        and item.get("artifactSha256")
                        == comparison.challenger_artifact_sha256.hexdigest
                    ),
                    None,
                )
                champion = batch.get("champion")
                champion_match = isinstance(champion, dict) and (
                    champion.get("modelId") == comparison.champion_model_id
                    and champion.get("modelRevision") == comparison.champion_model_revision
                    and champion.get("artifactSha256")
                    == comparison.champion_artifact_sha256.hexdigest
                )
                if (
                    batch.get("slotId") != comparison.slot_id
                    or batch.get("targetId") != comparison.target_id
                    or batch.get("horizonMs") != str(comparison.horizon_ms)
                    or batch.get("championGeneration") != comparison.champion_generation
                    or batch.get("championTransitionId") != comparison.champion_transition_id
                    or not (champion_match and challenger is not None)
                ):
                    raise RegistryConflictError("shadow comparison model identities mismatch")
                feedback = connection.execute(
                    "SELECT body_sha,body FROM feedback WHERE feedback_id=?", (row["feedback_id"],)
                ).fetchone()
                if feedback is None:
                    raise RegistryIntegrityError("mature shadow feedback row is absent")
                feedback_body = parse_canonical_object(bytes(feedback["body"]))
                if (
                    bytes(feedback["body"]) != canonical_json_bytes(feedback_body)
                    or mapping_digest(feedback_body).hexdigest != feedback["body_sha"]
                    or feedback_body.get("state") != "AVAILABLE"
                    or feedback_body.get("outcomeSha256") is None
                ):
                    raise RegistryConflictError(
                        "shadow comparison PASS requires available objective feedback"
                    )
                champion_score = champion.get("scoreMicros") if isinstance(champion, dict) else None
                challenger_score = challenger.get("scoreMicros")
                outcome = feedback_body.get("outcomeMicros")
                if any(
                    isinstance(value, bool) or not isinstance(value, int)
                    for value in (champion_score, challenger_score, outcome)
                ):
                    raise RegistryConflictError(
                        "shadow comparison requires exact persisted metric inputs"
                    )
                champion_error = cast(int, champion_score) - cast(int, outcome)
                challenger_error = cast(int, challenger_score) - cast(int, outcome)
                champion_losses.append((champion_error * champion_error) // 1_000_000)
                challenger_losses.append((challenger_error * challenger_error) // 1_000_000)
                observed_feedback.append(str(feedback["body_sha"]))
            expected_feedback = [item.hexdigest for item in comparison.feedback_digests]
            if sorted(observed_feedback) != expected_feedback:
                raise RegistryConflictError("shadow comparison feedback digests mismatch")
            derived_champion = sum(champion_losses) // len(champion_losses)
            derived_challenger = sum(challenger_losses) // len(challenger_losses)
            derived_verdict = "PASS" if derived_challenger < derived_champion else "FAIL"
            if (
                comparison.metric_id != "brier_loss_micros:v1"
                or comparison.champion_metric_micros != derived_champion
                or comparison.challenger_metric_micros != derived_challenger
                or comparison.verdict != derived_verdict
            ):
                raise RegistryConflictError("shadow comparison metrics do not reproduce")
            connection.execute(
                "INSERT INTO shadow_comparisons(comparison_id,body_sha,body) VALUES(?,?,?)",
                (comparison.comparison_id, comparison.content_digest.hexdigest, body),
            )
            self._finish(connection, None)
            return comparison.content_digest
        except BaseException:
            self._rollback(connection)
            raise

    def record_owner_annotation(self, annotation: OwnerAnnotationV1) -> DigestV1:
        if not isinstance(annotation, OwnerAnnotationV1):
            raise ContractValueError("annotation must be OwnerAnnotationV1")
        body = canonical_json_bytes(annotation.as_mapping())
        connection = self._begin(None)
        try:
            existing = connection.execute(
                "SELECT body_sha,body FROM annotations WHERE annotation_id=?",
                (annotation.annotation_id,),
            ).fetchone()
            if existing is not None:
                if (
                    existing["body_sha"] != annotation.content_digest.hexdigest
                    or bytes(existing["body"]) != body
                ):
                    raise RegistryConflictError("owner annotation identity already differs")
                self._finish(connection, None)
                return annotation.content_digest
            batch = connection.execute(
                "SELECT body_sha,body,feedback_id FROM shadow_batches WHERE body_sha=?",
                (annotation.evidence_digest.hexdigest,),
            ).fetchone()
            if batch is None:
                raise RegistryConflictError("annotation evidence is not an admitted shadow batch")
            batch_body = parse_canonical_object(bytes(batch["body"]))
            if batch_body.get("eventId") != annotation.event_id:
                raise RegistryConflictError("annotation event and evidence disagree")
            cutoff = int(str(batch_body["featureCutoffMs"]))
            if annotation.tagged_at_ms < cutoff:
                raise RegistryConflictError("annotation predates its visible evidence")
            if annotation.outcome_hidden_when_tagged and batch["feedback_id"] is not None:
                feedback = connection.execute(
                    "SELECT body,observed_at_ms FROM feedback WHERE feedback_id=?",
                    (batch["feedback_id"],),
                ).fetchone()
                if feedback is None or annotation.tagged_at_ms >= feedback["observed_at_ms"]:
                    raise RegistryConflictError(
                        "hidden annotation was tagged after outcome arrival"
                    )
            elif not annotation.outcome_hidden_when_tagged:
                if batch["feedback_id"] is None:
                    raise RegistryConflictError(
                        "outcome-known annotation requires available objective feedback"
                    )
                feedback = connection.execute(
                    "SELECT body,observed_at_ms FROM feedback WHERE feedback_id=?",
                    (batch["feedback_id"],),
                ).fetchone()
                feedback_body = (
                    None if feedback is None else parse_canonical_object(bytes(feedback["body"]))
                )
                if (
                    feedback is None
                    or feedback_body is None
                    or feedback_body.get("state") != FeedbackState.AVAILABLE.value
                    or annotation.tagged_at_ms < feedback["observed_at_ms"]
                ):
                    raise RegistryConflictError(
                        "outcome-known annotation timing or feedback is invalid"
                    )
            connection.execute(
                "INSERT INTO annotations(annotation_id,body_sha,body) VALUES(?,?,?)",
                (annotation.annotation_id, annotation.content_digest.hexdigest, body),
            )
            self._finish(connection, None)
            return annotation.content_digest
        except BaseException:
            self._rollback(connection)
            raise

    def link_annotation_outcome(self, link: AnnotationOutcomeLinkV1) -> DigestV1:
        if not isinstance(link, AnnotationOutcomeLinkV1):
            raise ContractValueError("link must be AnnotationOutcomeLinkV1")
        body = canonical_json_bytes(link.as_mapping())
        connection = self._begin(None)
        try:
            annotation = connection.execute(
                "SELECT body FROM annotations WHERE annotation_id=?", (link.annotation_id,)
            ).fetchone()
            feedback = connection.execute(
                "SELECT body,observed_at_ms,batch_id FROM feedback WHERE feedback_id=?",
                (link.feedback_id,),
            ).fetchone()
            if annotation is None or feedback is None:
                raise RegistryConflictError("annotation outcome link references unknown evidence")
            annotation_body = parse_canonical_object(bytes(annotation["body"]))
            feedback_body = parse_canonical_object(bytes(feedback["body"]))
            tagged_at_ms = int(str(annotation_body["taggedAtMs"]))
            outcome_hidden = annotation_body.get("outcomeHiddenWhenTagged")
            batch = connection.execute(
                "SELECT body_sha FROM shadow_batches WHERE batch_id=?", (feedback["batch_id"],)
            ).fetchone()
            if (
                batch is None
                or annotation_body.get("eventId") != feedback_body.get("eventId")
                or annotation_body.get("evidenceSha256") != batch["body_sha"]
                or feedback_body.get("state") != "AVAILABLE"
                or link.linked_at_ms < feedback["observed_at_ms"]
                or link.linked_at_ms < tagged_at_ms
                or not isinstance(outcome_hidden, bool)
                or (outcome_hidden and tagged_at_ms >= feedback["observed_at_ms"])
                or (not outcome_hidden and tagged_at_ms < feedback["observed_at_ms"])
            ):
                raise RegistryConflictError("annotation and outcome lineage mismatch")
            existing = connection.execute(
                "SELECT body_sha,body FROM annotation_outcome_links WHERE "
                "link_id=? OR annotation_id=?",
                (link.link_id, link.annotation_id),
            ).fetchone()
            if existing is not None:
                if (
                    existing["body_sha"] != link.content_digest.hexdigest
                    or bytes(existing["body"]) != body
                ):
                    raise RegistryConflictError("annotation outcome link conflicts")
                self._finish(connection, None)
                return link.content_digest
            connection.execute(
                "INSERT INTO annotation_outcome_links(link_id,annotation_id,feedback_id,"
                "body_sha,body) VALUES(?,?,?,?,?)",
                (
                    link.link_id,
                    link.annotation_id,
                    link.feedback_id,
                    link.content_digest.hexdigest,
                    body,
                ),
            )
            self._finish(connection, None)
            return link.content_digest
        except BaseException:
            self._rollback(connection)
            raise

    def restore_champion(self, slot_id: str, *, artifact_root: Path) -> ChampionSnapshotV1:
        """Restore one head from a consistent DB snapshot, then verify its artifact bytes."""

        require_contract_id(slot_id, field="slot_id")
        connection = self._require_open()
        connection.execute("BEGIN")
        try:
            check = connection.execute("PRAGMA quick_check").fetchone()
            if check is None or check[0] != "ok":
                raise RegistryIntegrityError("registry quick_check failed")
            snapshot, references = self._verified_restore_head(slot_id)
            connection.execute("COMMIT")
        except BaseException:
            self._rollback(connection)
            raise
        for reference in references:
            try:
                read_verified_artifact(artifact_root, reference)
            except QuantEdgeError as error:
                raise RegistryIntegrityError(
                    "champion lineage artifact failed verification"
                ) from error
        return snapshot

    def _verified_restore_head(
        self,
        slot_id: str,
    ) -> tuple[ChampionSnapshotV1, tuple[ArtifactRefV1, ...]]:
        require_contract_id(slot_id, field="slot_id")
        connection = self._require_open()
        snapshot = self._current(slot_id)
        if snapshot is None:
            raise RegistryIntegrityError("champion slot is unavailable")
        history = connection.execute(
            "SELECT generation,snapshot_sha,snapshot FROM champion_history WHERE slot_id=? "
            "ORDER BY generation",
            (slot_id,),
        ).fetchall()
        if len(history) != snapshot.generation:
            raise RegistryIntegrityError("champion history is not contiguous")
        lineage_references: list[ArtifactRefV1] = []
        previous: ChampionSnapshotV1 | None = None
        for expected_generation, history_row in enumerate(history, start=1):
            historical = _snapshot_from_mapping(
                parse_canonical_object(bytes(history_row["snapshot"]))
            )
            if (
                history_row["generation"] != expected_generation
                or historical.generation != expected_generation
                or historical.slot_id != slot_id
                or historical.content_digest.hexdigest != history_row["snapshot_sha"]
                or bytes(history_row["snapshot"]) != canonical_json_bytes(historical.as_mapping())
            ):
                raise RegistryIntegrityError("champion history entry is corrupt")
            transition = connection.execute(
                "SELECT command_sha,command,kind,slot_id,previous_snapshot_sha,"
                "next_snapshot_sha,next_snapshot,evidence_sha,evidence,reason,committed_at_ms "
                "FROM transitions WHERE transition_id=?",
                (historical.transition_id,),
            ).fetchone()
            if transition is None:
                raise RegistryIntegrityError("champion history transition is absent")
            _verify_transition_record(transition, historical, previous)
            if transition["kind"] == TransitionKind.DEMOTION.value:
                alarm = connection.execute(
                    "SELECT body_sha,body,command_sha,command FROM drift_alarms "
                    "WHERE transition_id=?",
                    (historical.transition_id,),
                ).fetchone()
                if (
                    alarm is None
                    or alarm["body_sha"] != transition["evidence_sha"]
                    or bytes(alarm["body"]) != bytes(transition["evidence"])
                    or alarm["command_sha"] != transition["command_sha"]
                    or bytes(alarm["command"]) != bytes(transition["command"])
                ):
                    raise RegistryIntegrityError("demotion alarm lineage is absent or corrupt")
            if transition["kind"] == TransitionKind.RECOVERY.value:
                recovery = parse_canonical_object(bytes(transition["evidence"]))
                historical_sha = recovery.get("historicalSnapshotSha256")
                recovered_from = connection.execute(
                    "SELECT generation,snapshot FROM champion_history WHERE slot_id=? "
                    "AND snapshot_sha=? AND generation<?",
                    (slot_id, historical_sha, historical.generation),
                ).fetchone()
                if recovered_from is None:
                    raise RegistryIntegrityError("recovery historical evidence is absent")
                prior_advisory = _snapshot_from_mapping(
                    parse_canonical_object(bytes(recovered_from["snapshot"]))
                )
                if (
                    prior_advisory.posture is not ServingPosture.ADVISORY
                    or prior_advisory.model_id != historical.model_id
                    or prior_advisory.model_revision != historical.model_revision
                    or prior_advisory.artifact_sha256 != historical.artifact_sha256
                    or prior_advisory.model_card_sha256 != historical.model_card_sha256
                ):
                    raise RegistryIntegrityError("recovery historical evidence is incompatible")
            if transition["kind"] == TransitionKind.ROLLBACK.value:
                rollback_target = connection.execute(
                    "SELECT 1 FROM champion_history WHERE slot_id=? AND generation<? "
                    "AND json_extract(snapshot,'$.modelId')=? "
                    "AND json_extract(snapshot,'$.modelRevision')=? "
                    "AND json_extract(snapshot,'$.artifactSha256')=? LIMIT 1",
                    (
                        slot_id,
                        historical.generation,
                        historical.model_id,
                        historical.model_revision,
                        historical.artifact_sha256.hexdigest,
                    ),
                ).fetchone()
                if rollback_target is None:
                    raise RegistryIntegrityError("rollback target is absent from prior history")
            if transition["kind"] == TransitionKind.PROMOTION.value:
                promotion = parse_canonical_object(bytes(transition["evidence"]))
                shadow_sha = promotion.get("shadowReportSha256")
                report_mapping = promotion.get("reportArtifact")
                if not isinstance(shadow_sha, str) or not isinstance(report_mapping, dict):
                    raise RegistryIntegrityError("promotion lineage evidence is malformed")
                shadow = connection.execute(
                    "SELECT body_sha,body FROM shadow_comparisons WHERE body_sha=?",
                    (shadow_sha,),
                ).fetchone()
                report = connection.execute(
                    "SELECT digest,body FROM artifacts WHERE artifact_id=?",
                    (report_mapping.get("artifactId"),),
                ).fetchone()
                if shadow is None or report is None:
                    raise RegistryIntegrityError("promotion lineage evidence is absent")
                stored_shadow = parse_canonical_object(bytes(shadow["body"]))
                stored_report = parse_canonical_object(bytes(report["body"]))
                if (
                    bytes(shadow["body"]) != canonical_json_bytes(stored_shadow)
                    or mapping_digest(stored_shadow).hexdigest != shadow["body_sha"]
                    or bytes(report["body"]) != canonical_json_bytes(stored_report)
                    or mapping_digest(stored_report).hexdigest != report["digest"]
                    or stored_report != report_mapping
                    or stored_report.get("schemaName") != "Q15SyntheticPromotionReportV1"
                    or promotion.get("posture") != EvidencePosture.SYNTHETIC_ONLY.value
                    or promotion.get("reportVerdict") != "SYNTHETIC_FIXTURE_PASS"
                    or stored_shadow.get("posture") != promotion.get("posture")
                ):
                    raise RegistryIntegrityError("promotion lineage evidence is corrupt")
                _verify_persisted_shadow_lineage(connection, stored_shadow)
                lineage_references.append(_artifact_from_mapping(stored_report))
            previous = historical
        if previous != snapshot:
            raise RegistryIntegrityError("champion projection is not the exact committed head")
        model = self._model_row(snapshot.model_id, snapshot.model_revision)
        registration = parse_canonical_object(bytes(model["body"]))
        artifact_mapping = registration.get("artifact")
        if (
            model["lifecycle"] != ModelLifecycle.CHAMPION.value
            or model["artifact_sha"] != snapshot.artifact_sha256.hexdigest
            or model["model_card_sha"] != snapshot.model_card_sha256.hexdigest
            or bytes(model["body"]) != canonical_json_bytes(registration)
            or mapping_digest(registration).hexdigest != model["body_sha"]
            or registration.get("modelId") != snapshot.model_id
            or registration.get("modelRevision") != snapshot.model_revision
            or registration.get("modelCardSha256") != model["model_card_sha"]
            or registration.get("datasetCardSha256") != model["dataset_card_sha"]
            or registration.get("experimentCardSha256") != model["experiment_card_sha"]
            or registration.get("outputContractId") != model["output_contract_id"]
            or registration.get("targetId") != model["target_id"]
            or registration.get("scoreContractId") != model["score_contract_id"]
            or registration.get("posture") != model["evidence_posture"]
            or not isinstance(artifact_mapping, dict)
            or artifact_mapping.get("artifactId") != model["artifact_id"]
            or artifact_mapping.get("sha256") != model["artifact_sha"]
        ):
            raise RegistryIntegrityError("champion model registration is inconsistent")
        model_card = self._card_row("MODEL", snapshot.model_card_sha256)
        model_card_mapping = parse_canonical_object(bytes(model_card["body"]))
        model_artifact_ids = model_card_mapping.get("artifactIds")
        if (
            model_card_mapping.get("modelId") != snapshot.model_id
            or model_card_mapping.get("modelRevision") != snapshot.model_revision
            or model_card_mapping.get("posture") != model["evidence_posture"]
            or model_card_mapping.get("registryStateAtIssue")
            != ModelLifecycle.SHADOW_CHALLENGER.value
            or not isinstance(model_artifact_ids, list)
            or model["artifact_id"] not in model_artifact_ids
        ):
            raise RegistryIntegrityError("champion model card binding is inconsistent")
        self._card_row("DATASET", DigestV1(str(model["dataset_card_sha"])))
        self._card_row("EXPERIMENT", DigestV1(str(model["experiment_card_sha"])))
        lifecycle_heads = {
            (str(row["model_id"]), str(row["model_revision"]))
            for row in connection.execute(
                "SELECT model_id,model_revision FROM models WHERE lifecycle=?",
                (ModelLifecycle.CHAMPION.value,),
            ).fetchall()
        }
        projection_rows = connection.execute(
            "SELECT slot_id,generation,snapshot_sha,snapshot FROM champions"
        ).fetchall()
        projected_heads: list[tuple[str, str]] = []
        for projection_row in projection_rows:
            projected = _snapshot_from_mapping(
                parse_canonical_object(bytes(projection_row["snapshot"]))
            )
            if (
                projected.slot_id != projection_row["slot_id"]
                or projected.generation != projection_row["generation"]
                or projected.content_digest.hexdigest != projection_row["snapshot_sha"]
                or bytes(projection_row["snapshot"]) != canonical_json_bytes(projected.as_mapping())
            ):
                raise RegistryIntegrityError("global champion projection is corrupt")
            projected_heads.append((projected.model_id, projected.model_revision))
        if (
            len(projected_heads) != len(set(projected_heads))
            or set(projected_heads) != lifecycle_heads
        ):
            raise RegistryIntegrityError(
                "champion lifecycle and projection identities are not bijective"
            )
        artifact_row = connection.execute(
            "SELECT digest,body FROM artifacts WHERE artifact_id=?", (model["artifact_id"],)
        ).fetchone()
        if artifact_row is None:
            raise RegistryIntegrityError("champion artifact manifest is absent")
        artifact_mapping = parse_canonical_object(bytes(artifact_row["body"]))
        reference = _artifact_from_mapping(artifact_mapping)
        if (
            mapping_digest(artifact_mapping).hexdigest != artifact_row["digest"]
            or bytes(artifact_row["body"]) != canonical_json_bytes(artifact_mapping)
            or reference.as_mapping() != artifact_mapping
            or reference.sha256 != snapshot.artifact_sha256
            or registration.get("artifact") != artifact_mapping
        ):
            raise RegistryIntegrityError("champion artifact manifest is corrupt")
        lineage_references.append(reference)
        unique_references = {
            (item.artifact_id, item.sha256.hexdigest): item for item in lineage_references
        }
        return snapshot, tuple(unique_references[key] for key in sorted(unique_references))

    def transition_count(self, slot_id: str) -> int:
        require_contract_id(slot_id, field="slot_id")
        row = (
            self._require_open()
            .execute("SELECT COUNT(*) AS count FROM transitions WHERE slot_id=?", (slot_id,))
            .fetchone()
        )
        if row is None:
            raise RegistryIntegrityError("transition count query failed")
        return int(row["count"])

    def feedback_state(self, batch_id: str) -> str:
        require_contract_id(batch_id, field="batch_id")
        row = (
            self._require_open()
            .execute("SELECT feedback_id FROM shadow_batches WHERE batch_id=?", (batch_id,))
            .fetchone()
        )
        if row is None:
            raise RegistryConflictError("shadow batch is unknown")
        return "PENDING" if row["feedback_id"] is None else "MATURED"

    def list_model_lifecycles(self) -> tuple[tuple[str, str, ModelLifecycle], ...]:
        rows = (
            self._require_open()
            .execute(
                "SELECT model_id,model_revision,lifecycle FROM models "
                "ORDER BY model_id,model_revision"
            )
            .fetchall()
        )
        return tuple(
            (str(row["model_id"]), str(row["model_revision"]), ModelLifecycle(row["lifecycle"]))
            for row in rows
        )
