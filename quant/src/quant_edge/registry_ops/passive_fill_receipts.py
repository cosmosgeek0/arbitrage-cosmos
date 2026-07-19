"""Durable Q15 authority for passive-fill held-out evidence receipts.

The receipt is evidence, not a caller assertion. ResearchRegistryStore is the
only emitter and rereads every content binding before it can authorize the
existing recorded-calibration CAS promotion path.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int
from quant_edge.primitives import require_utc_millis
from quant_edge.registry_ops.contracts import OutcomeReality, mapping_digest
from quant_edge.registry_ops.recorded_outcomes import CalibrationAuthority

PASSIVE_FILL_CALIBRATION_OWNER_ID: Final = "quant.registry.recorded-outcomes"
PASSIVE_FILL_CALIBRATION_OWNER_REVISION: Final = "l068.recorded-outcomes.v1"
MAX_PASSIVE_FILL_CALIBRATION_RECEIPT_TTL_MS: Final = 31 * 24 * 60 * 60 * 1_000


class PassiveFillCalibrationMode(StrEnum):
    CHRONOLOGICAL_HELD_OUT = "CHRONOLOGICAL_HELD_OUT"
    IN_SAMPLE = "IN_SAMPLE"
    RANDOM_SPLIT = "RANDOM_SPLIT"


class PassiveFillCalibrationCompleteness(StrEnum):
    COMPLETE = "COMPLETE"
    PARTIAL = "PARTIAL"
    SYNTHETIC = "SYNTHETIC"


@dataclass(frozen=True, slots=True)
class PassiveFillHeldOutCalibrationReceiptV1:
    receipt_id: str
    owner_id: str
    owner_revision: str
    mode: PassiveFillCalibrationMode
    completeness: PassiveFillCalibrationCompleteness
    challenger_model_revision: str
    challenger_sha256: DigestV1
    training_observations_sha256: DigestV1
    training_event_ids: tuple[str, ...]
    training_observed_through_ms: int
    report_id: str
    report_revision: str
    report_sha256: DigestV1
    policy_revision: str
    authority: CalibrationAuthority
    corpus_id: str
    corpus_revision: str
    corpus_sha256: DigestV1
    heldout_reality: OutcomeReality
    heldout_event_ids: tuple[str, ...]
    heldout_prediction_cutoff_from_ms: int
    heldout_observed_through_ms: int
    transition_id: str
    expected_generation: int
    issued_at_ms: int
    expires_at_ms: int

    def __post_init__(self) -> None:
        for field_name in (
            "receipt_id",
            "owner_id",
            "owner_revision",
            "challenger_model_revision",
            "report_id",
            "report_revision",
            "policy_revision",
            "corpus_id",
            "corpus_revision",
            "transition_id",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.mode, PassiveFillCalibrationMode):
            raise ContractValueError("mode must be PassiveFillCalibrationMode")
        if not isinstance(self.completeness, PassiveFillCalibrationCompleteness):
            raise ContractValueError("completeness must be PassiveFillCalibrationCompleteness")
        if not isinstance(self.authority, CalibrationAuthority):
            raise ContractValueError("authority must be CalibrationAuthority")
        if not isinstance(self.heldout_reality, OutcomeReality):
            raise ContractValueError("heldout_reality must be OutcomeReality")
        for field_name in (
            "challenger_sha256",
            "training_observations_sha256",
            "report_sha256",
            "corpus_sha256",
        ):
            if not isinstance(getattr(self, field_name), DigestV1):
                raise ContractValueError(f"{field_name} must be DigestV1")
        for field_name in ("training_event_ids", "heldout_event_ids"):
            values = getattr(self, field_name)
            if not isinstance(values, tuple) or not values or values != tuple(sorted(set(values))):
                raise ContractValueError(f"{field_name} must be non-empty, sorted and unique")
            for event_id in values:
                require_contract_id(event_id, field="event_id")
        require_strict_int(
            self.expected_generation,
            field="expected_generation",
            minimum=0,
        )
        training_end = require_utc_millis(
            self.training_observed_through_ms,
            field="training_observed_through_ms",
        )
        holdout_start = require_utc_millis(
            self.heldout_prediction_cutoff_from_ms,
            field="heldout_prediction_cutoff_from_ms",
        )
        holdout_end = require_utc_millis(
            self.heldout_observed_through_ms,
            field="heldout_observed_through_ms",
        )
        issued = require_utc_millis(self.issued_at_ms, field="issued_at_ms")
        expires = require_utc_millis(self.expires_at_ms, field="expires_at_ms")
        if holdout_start > holdout_end or holdout_end > issued:
            raise ContractValueError("held-out calibration times are not chronological")
        ttl_ms = expires - issued
        require_strict_int(
            ttl_ms,
            field="receipt_ttl_ms",
            minimum=1,
            maximum=MAX_PASSIVE_FILL_CALIBRATION_RECEIPT_TTL_MS,
        )
        if self.completeness is PassiveFillCalibrationCompleteness.COMPLETE:
            if self.mode is not PassiveFillCalibrationMode.CHRONOLOGICAL_HELD_OUT:
                raise ContractValueError("complete receipt mode must be CHRONOLOGICAL_HELD_OUT")
            if self.authority is not CalibrationAuthority.RESEARCH_ONLY:
                raise ContractValueError("passive-fill challenger promotion is research-only")
            if self.heldout_reality is not OutcomeReality.REPLAY:
                raise ContractValueError("complete receipt requires recorded REPLAY outcomes")
            if set(self.training_event_ids) & set(self.heldout_event_ids):
                raise ContractValueError("training and held-out event identities overlap")
            if training_end >= holdout_start:
                raise ContractValueError("training evidence overlaps the chronological holdout")

    @classmethod
    def from_mapping(
        cls,
        mapping: dict[str, object],
    ) -> PassiveFillHeldOutCalibrationReceiptV1:
        expected_keys = {
            "authority",
            "challengerModelRevision",
            "challengerSha256",
            "completeness",
            "corpusId",
            "corpusRevision",
            "corpusSha256",
            "expectedGeneration",
            "expiresAtMs",
            "heldoutEventIds",
            "heldoutObservedThroughMs",
            "heldoutPredictionCutoffFromMs",
            "heldoutReality",
            "issuedAtMs",
            "mode",
            "ownerId",
            "ownerRevision",
            "policyRevision",
            "receiptId",
            "reportId",
            "reportRevision",
            "reportSha256",
            "schema",
            "trainingEventIds",
            "trainingObservationsSha256",
            "trainingObservedThroughMs",
            "transitionId",
            "version",
        }
        if set(mapping) != expected_keys:
            raise ContractValueError("passive-fill calibration receipt keys must be schema-exact")
        if (
            mapping.get("schema") != "Q15PassiveFillHeldOutCalibrationReceiptV1"
            or mapping.get("version") != 1
        ):
            raise ContractValueError("passive-fill calibration receipt schema/version mismatch")
        training_events = mapping.get("trainingEventIds")
        heldout_events = mapping.get("heldoutEventIds")
        if not isinstance(training_events, list) or not isinstance(heldout_events, list):
            raise ContractValueError("passive-fill calibration event IDs must be lists")
        if any(not isinstance(value, str) for value in (*training_events, *heldout_events)):
            raise ContractValueError("passive-fill calibration event IDs must be text")
        try:
            return cls(
                receipt_id=cast(str, mapping["receiptId"]),
                owner_id=cast(str, mapping["ownerId"]),
                owner_revision=cast(str, mapping["ownerRevision"]),
                mode=PassiveFillCalibrationMode(cast(str, mapping["mode"])),
                completeness=PassiveFillCalibrationCompleteness(cast(str, mapping["completeness"])),
                challenger_model_revision=cast(str, mapping["challengerModelRevision"]),
                challenger_sha256=DigestV1(cast(str, mapping["challengerSha256"])),
                training_observations_sha256=DigestV1(
                    cast(str, mapping["trainingObservationsSha256"])
                ),
                training_event_ids=tuple(cast(list[str], training_events)),
                training_observed_through_ms=int(
                    cast(int | str, mapping["trainingObservedThroughMs"])
                ),
                report_id=cast(str, mapping["reportId"]),
                report_revision=cast(str, mapping["reportRevision"]),
                report_sha256=DigestV1(cast(str, mapping["reportSha256"])),
                policy_revision=cast(str, mapping["policyRevision"]),
                authority=CalibrationAuthority(cast(str, mapping["authority"])),
                corpus_id=cast(str, mapping["corpusId"]),
                corpus_revision=cast(str, mapping["corpusRevision"]),
                corpus_sha256=DigestV1(cast(str, mapping["corpusSha256"])),
                heldout_reality=OutcomeReality(cast(str, mapping["heldoutReality"])),
                heldout_event_ids=tuple(cast(list[str], heldout_events)),
                heldout_prediction_cutoff_from_ms=int(
                    cast(int | str, mapping["heldoutPredictionCutoffFromMs"])
                ),
                heldout_observed_through_ms=int(
                    cast(int | str, mapping["heldoutObservedThroughMs"])
                ),
                transition_id=cast(str, mapping["transitionId"]),
                expected_generation=int(cast(int | str, mapping["expectedGeneration"])),
                issued_at_ms=int(cast(int | str, mapping["issuedAtMs"])),
                expires_at_ms=int(cast(int | str, mapping["expiresAtMs"])),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ContractValueError("passive-fill calibration receipt is malformed") from error

    def as_mapping(self) -> dict[str, object]:
        return {
            "authority": self.authority.value,
            "challengerModelRevision": self.challenger_model_revision,
            "challengerSha256": self.challenger_sha256.hexdigest,
            "completeness": self.completeness.value,
            "corpusId": self.corpus_id,
            "corpusRevision": self.corpus_revision,
            "corpusSha256": self.corpus_sha256.hexdigest,
            "expectedGeneration": self.expected_generation,
            "expiresAtMs": str(self.expires_at_ms),
            "heldoutEventIds": list(self.heldout_event_ids),
            "heldoutObservedThroughMs": str(self.heldout_observed_through_ms),
            "heldoutPredictionCutoffFromMs": str(self.heldout_prediction_cutoff_from_ms),
            "heldoutReality": self.heldout_reality.value,
            "issuedAtMs": str(self.issued_at_ms),
            "mode": self.mode.value,
            "ownerId": self.owner_id,
            "ownerRevision": self.owner_revision,
            "policyRevision": self.policy_revision,
            "receiptId": self.receipt_id,
            "reportId": self.report_id,
            "reportRevision": self.report_revision,
            "reportSha256": self.report_sha256.hexdigest,
            "schema": "Q15PassiveFillHeldOutCalibrationReceiptV1",
            "trainingEventIds": list(self.training_event_ids),
            "trainingObservationsSha256": self.training_observations_sha256.hexdigest,
            "trainingObservedThroughMs": str(self.training_observed_through_ms),
            "transitionId": self.transition_id,
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())

    @property
    def receipt_revision(self) -> str:
        return f"sha256:{self.content_digest.hexdigest}"
