"""Revisioned recorded-outcome residual evidence for Q15 (L-068).

The pure evaluator consumes immutable caller-supplied outcome records. Replay
evidence may promote only a research calibration head. A production head
requires records explicitly bound to REAL evidence; this package supplies no
collector and therefore makes no claim that such a corpus currently exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1, require_contract_id, require_strict_int
from quant_edge.primitives import require_utc_millis
from quant_edge.registry_ops.contracts import OutcomeReality, mapping_digest

MAX_RECORDED_OUTCOMES: Final = 10_000
MICROS: Final = 1_000_000
RECORDED_OUTCOME_ATTESTATION_SCHEMA: Final = "Q15RecordedOutcomeAttestationV1"


def _ceil_nonnegative_ratio(numerator: int, denominator: int) -> int:
    return (numerator + denominator - 1) // denominator


def _round_ratio_away_from_zero(numerator: int, denominator: int) -> int:
    if numerator == 0:
        return 0
    magnitude = _ceil_nonnegative_ratio(abs(numerator), denominator)
    return magnitude if numerator > 0 else -magnitude


class CalibrationAuthority(StrEnum):
    RESEARCH_ONLY = "RESEARCH_ONLY"
    PRODUCTION = "PRODUCTION"


class RecordedCalibrationStatus(StrEnum):
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"
    PROMOTION_ELIGIBLE = "PROMOTION_ELIGIBLE"
    REJECTED = "REJECTED"
    NOT_CONFIGURED = "NOT_CONFIGURED"
    WRONG_REALITY = "WRONG_REALITY"


@dataclass(frozen=True, slots=True)
class RecordedPredictionV1:
    """One immutable prediction fact that can be persisted before outcome maturity."""

    prediction_id: str
    batch_id: str
    event_id: str
    model_id: str
    model_revision: str
    source_revision: str
    source_artifact_sha256: DigestV1
    prediction_micros: int
    predicted_cost_micros: int
    cost_unit: str
    cost_valuation_asset: str
    prediction_cutoff_ms: int
    prediction_issued_at_ms: int

    def __post_init__(self) -> None:
        for field_name in (
            "prediction_id",
            "batch_id",
            "event_id",
            "model_id",
            "model_revision",
            "source_revision",
            "cost_unit",
            "cost_valuation_asset",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.source_artifact_sha256, DigestV1):
            raise ContractValueError("source_artifact_sha256 must be DigestV1")
        require_strict_int(
            self.prediction_micros,
            field="prediction_micros",
            minimum=0,
            maximum=MICROS,
        )
        require_strict_int(
            self.predicted_cost_micros,
            field="predicted_cost_micros",
            minimum=0,
            maximum=10**15,
        )
        cutoff = require_utc_millis(
            self.prediction_cutoff_ms,
            field="prediction_cutoff_ms",
        )
        issued = require_utc_millis(
            self.prediction_issued_at_ms,
            field="prediction_issued_at_ms",
        )
        if cutoff > issued:
            raise ContractValueError("prediction_cutoff_ms must not follow prediction issue time")

    @classmethod
    def from_mapping(cls, mapping: dict[str, object]) -> RecordedPredictionV1:
        expected_keys = {
            "batchId",
            "costUnit",
            "costValuationAsset",
            "eventId",
            "modelId",
            "modelRevision",
            "predictedCostMicros",
            "predictionCutoffMs",
            "predictionId",
            "predictionIssuedAtMs",
            "predictionMicros",
            "schema",
            "sourceArtifactSha256",
            "sourceRevision",
            "version",
        }
        if set(mapping) != expected_keys:
            raise ContractValueError("recorded prediction keys must be schema-exact")
        if (
            mapping.get("schema") != "Q15RecordedPredictionArtifactV1"
            or mapping.get("version") != 1
        ):
            raise ContractValueError("recorded prediction schema/version mismatch")
        try:
            return cls(
                prediction_id=cast(str, mapping["predictionId"]),
                batch_id=cast(str, mapping["batchId"]),
                event_id=cast(str, mapping["eventId"]),
                model_id=cast(str, mapping["modelId"]),
                model_revision=cast(str, mapping["modelRevision"]),
                source_revision=cast(str, mapping["sourceRevision"]),
                source_artifact_sha256=DigestV1(cast(str, mapping["sourceArtifactSha256"])),
                prediction_micros=int(cast(int | str, mapping["predictionMicros"])),
                predicted_cost_micros=int(cast(int | str, mapping["predictedCostMicros"])),
                cost_unit=cast(str, mapping["costUnit"]),
                cost_valuation_asset=cast(str, mapping["costValuationAsset"]),
                prediction_cutoff_ms=int(cast(int | str, mapping["predictionCutoffMs"])),
                prediction_issued_at_ms=int(cast(int | str, mapping["predictionIssuedAtMs"])),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ContractValueError("recorded prediction values are malformed") from error

    def as_mapping(self) -> dict[str, object]:
        return {
            "batchId": self.batch_id,
            "costUnit": self.cost_unit,
            "costValuationAsset": self.cost_valuation_asset,
            "eventId": self.event_id,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "predictedCostMicros": self.predicted_cost_micros,
            "predictionCutoffMs": str(self.prediction_cutoff_ms),
            "predictionId": self.prediction_id,
            "predictionIssuedAtMs": str(self.prediction_issued_at_ms),
            "predictionMicros": self.prediction_micros,
            "schema": "Q15RecordedPredictionArtifactV1",
            "sourceArtifactSha256": self.source_artifact_sha256.hexdigest,
            "sourceRevision": self.source_revision,
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class RecordedPredictionRegistrationV1:
    """Store-owned receipt proving an exact prediction existed before its outcome."""

    owner_id: str
    owner_revision: str
    prediction: RecordedPredictionV1
    registered_at_ms: int

    def __post_init__(self) -> None:
        require_contract_id(self.owner_id, field="owner_id")
        require_contract_id(self.owner_revision, field="owner_revision")
        if not isinstance(self.prediction, RecordedPredictionV1):
            raise ContractValueError("prediction must be RecordedPredictionV1")
        registered = require_utc_millis(self.registered_at_ms, field="registered_at_ms")
        if registered < self.prediction.prediction_issued_at_ms:
            raise ContractValueError("prediction cannot be registered before its issue time")

    @classmethod
    def from_mapping(cls, mapping: dict[str, object]) -> RecordedPredictionRegistrationV1:
        if set(mapping) != {
            "ownerId",
            "ownerRevision",
            "prediction",
            "predictionSha256",
            "registeredAtMs",
            "schema",
            "version",
        }:
            raise ContractValueError("recorded prediction registration keys must be exact")
        if (
            mapping.get("schema") != "Q15RecordedPredictionRegistrationV1"
            or mapping.get("version") != 1
        ):
            raise ContractValueError("recorded prediction registration schema mismatch")
        prediction_mapping = mapping.get("prediction")
        if not isinstance(prediction_mapping, dict):
            raise ContractValueError("recorded prediction registration requires a prediction")
        prediction = RecordedPredictionV1.from_mapping(prediction_mapping)
        if mapping.get("predictionSha256") != prediction.content_digest.hexdigest:
            raise ContractValueError("recorded prediction registration digest mismatch")
        try:
            return cls(
                owner_id=cast(str, mapping["ownerId"]),
                owner_revision=cast(str, mapping["ownerRevision"]),
                prediction=prediction,
                registered_at_ms=int(cast(int | str, mapping["registeredAtMs"])),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ContractValueError("recorded prediction registration is malformed") from error

    def matches_outcome(self, outcome: RecordedOutcomeV1) -> bool:
        return (
            isinstance(outcome, RecordedOutcomeV1)
            and self.prediction == outcome.recorded_prediction
            and self.registered_at_ms < outcome.observed_at_ms
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "ownerId": self.owner_id,
            "ownerRevision": self.owner_revision,
            "prediction": self.prediction.as_mapping(),
            "predictionSha256": self.prediction.content_digest.hexdigest,
            "registeredAtMs": str(self.registered_at_ms),
            "schema": "Q15RecordedPredictionRegistrationV1",
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class RecordedOutcomeV1:
    outcome_id: str
    batch_id: str
    event_id: str
    prediction_id: str
    model_id: str
    model_revision: str
    source_revision: str
    source_artifact_sha256: DigestV1
    prediction_micros: int
    outcome_micros: int
    predicted_cost_micros: int
    realized_cost_micros: int
    cost_unit: str
    cost_valuation_asset: str
    prediction_cutoff_ms: int
    prediction_issued_at_ms: int
    observed_at_ms: int
    reality: OutcomeReality

    def __post_init__(self) -> None:
        for field_name in (
            "outcome_id",
            "batch_id",
            "event_id",
            "prediction_id",
            "model_id",
            "model_revision",
            "source_revision",
            "cost_unit",
            "cost_valuation_asset",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.source_artifact_sha256, DigestV1):
            raise ContractValueError("source_artifact_sha256 must be DigestV1")
        for field_name in ("prediction_micros", "outcome_micros"):
            require_strict_int(
                getattr(self, field_name), field=field_name, minimum=0, maximum=MICROS
            )
        for field_name in ("predicted_cost_micros", "realized_cost_micros"):
            require_strict_int(
                getattr(self, field_name), field=field_name, minimum=0, maximum=10**15
            )
        cutoff = require_utc_millis(self.prediction_cutoff_ms, field="prediction_cutoff_ms")
        issued = require_utc_millis(
            self.prediction_issued_at_ms,
            field="prediction_issued_at_ms",
        )
        observed = require_utc_millis(self.observed_at_ms, field="observed_at_ms")
        if cutoff > issued:
            raise ContractValueError("prediction_cutoff_ms must not follow prediction issue time")
        if issued >= observed:
            raise ContractValueError("prediction issue time must precede outcome observation")
        if not isinstance(self.reality, OutcomeReality):
            raise ContractValueError("reality must be OutcomeReality")

    @property
    def residual_micros(self) -> int:
        return self.outcome_micros - self.prediction_micros

    @property
    def cost_residual_micros(self) -> int:
        return self.realized_cost_micros - self.predicted_cost_micros

    @property
    def recorded_prediction(self) -> RecordedPredictionV1:
        return RecordedPredictionV1(
            prediction_id=self.prediction_id,
            batch_id=self.batch_id,
            event_id=self.event_id,
            model_id=self.model_id,
            model_revision=self.model_revision,
            source_revision=self.source_revision,
            source_artifact_sha256=self.source_artifact_sha256,
            prediction_micros=self.prediction_micros,
            predicted_cost_micros=self.predicted_cost_micros,
            cost_unit=self.cost_unit,
            cost_valuation_asset=self.cost_valuation_asset,
            prediction_cutoff_ms=self.prediction_cutoff_ms,
            prediction_issued_at_ms=self.prediction_issued_at_ms,
        )

    def prediction_artifact_mapping(self) -> dict[str, object]:
        """Canonical pre-outcome prediction event; its digest is never caller supplied."""

        return self.recorded_prediction.as_mapping()

    @property
    def prediction_artifact_sha256(self) -> DigestV1:
        return mapping_digest(self.prediction_artifact_mapping())

    def as_mapping(self) -> dict[str, object]:
        return {
            "batchId": self.batch_id,
            "costResidualMicros": self.cost_residual_micros,
            "eventId": self.event_id,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "observedAtMs": str(self.observed_at_ms),
            "outcomeId": self.outcome_id,
            "outcomeMicros": self.outcome_micros,
            "predictionArtifactSha256": self.prediction_artifact_sha256.hexdigest,
            "predictionCutoffMs": str(self.prediction_cutoff_ms),
            "predictionId": self.prediction_id,
            "predictionIssuedAtMs": str(self.prediction_issued_at_ms),
            "predictedCostMicros": self.predicted_cost_micros,
            "predictionMicros": self.prediction_micros,
            "realizedCostMicros": self.realized_cost_micros,
            "reality": self.reality.value,
            "residualMicros": self.residual_micros,
            "costUnit": self.cost_unit,
            "costValuationAsset": self.cost_valuation_asset,
            "sourceArtifactSha256": self.source_artifact_sha256.hexdigest,
            "sourceRevision": self.source_revision,
        }

    def outcome_truth_mapping(self) -> dict[str, object]:
        """The observed target/cost truth, excluding the model prediction."""

        return {
            "eventId": self.event_id,
            "observedAtMs": str(self.observed_at_ms),
            "outcomeId": self.outcome_id,
            "outcomeMicros": self.outcome_micros,
            "realizedCostMicros": self.realized_cost_micros,
            "reality": self.reality.value,
            "costUnit": self.cost_unit,
            "costValuationAsset": self.cost_valuation_asset,
            "sourceArtifactSha256": self.source_artifact_sha256.hexdigest,
            "sourceRevision": self.source_revision,
        }

    @property
    def outcome_truth_digest(self) -> DigestV1:
        return mapping_digest(self.outcome_truth_mapping())

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class RecordedOutcomeCorpusV1:
    corpus_id: str
    corpus_revision: str
    records: tuple[RecordedOutcomeV1, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.corpus_id, field="corpus_id")
        require_contract_id(self.corpus_revision, field="corpus_revision")
        if not isinstance(self.records, tuple) or len(self.records) > MAX_RECORDED_OUTCOMES:
            raise ContractValueError(f"records must be a tuple bounded to {MAX_RECORDED_OUTCOMES}")
        if any(not isinstance(record, RecordedOutcomeV1) for record in self.records):
            raise ContractValueError("records must contain RecordedOutcomeV1")
        ids = [record.outcome_id for record in self.records]
        if ids != sorted(ids) or len(ids) != len(set(ids)):
            raise ContractValueError("records must be sorted by unique outcome_id")
        event_ids = [record.event_id for record in self.records]
        if len(event_ids) != len(set(event_ids)):
            raise ContractValueError("records must bind unique underlying event_id values")
        prediction_ids = [record.prediction_id for record in self.records]
        if len(prediction_ids) != len(set(prediction_ids)):
            raise ContractValueError("records must bind unique prediction_id values")
        cost_identities = {
            (record.cost_unit, record.cost_valuation_asset) for record in self.records
        }
        if len(cost_identities) > 1:
            raise ContractValueError("recorded outcomes must share one exact cost identity")

    def as_mapping(self) -> dict[str, object]:
        return {
            "corpusId": self.corpus_id,
            "corpusRevision": self.corpus_revision,
            "records": [record.as_mapping() for record in self.records],
            "schema": "Q15RecordedOutcomeCorpusV1",
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class RecordedOutcomeAttestationV1:
    """Outcome-owner export bound to durable, pre-outcome prediction receipts."""

    collector_id: str
    collector_revision: str
    prediction_owner_id: str
    prediction_owner_revision: str
    corpus_id: str
    corpus_revision: str
    corpus_sha256: DigestV1
    record_ids: tuple[str, ...]
    record_sha256: tuple[DigestV1, ...]
    outcome_sha256: tuple[DigestV1, ...]
    prediction_ids: tuple[str, ...]
    prediction_sha256: tuple[DigestV1, ...]
    prediction_registration_sha256: tuple[DigestV1, ...]

    def __post_init__(self) -> None:
        for field_name in (
            "collector_id",
            "collector_revision",
            "prediction_owner_id",
            "prediction_owner_revision",
            "corpus_id",
            "corpus_revision",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.corpus_sha256, DigestV1):
            raise ContractValueError("corpus_sha256 must be DigestV1")
        if (
            not isinstance(self.record_ids, tuple)
            or len(self.record_ids) > MAX_RECORDED_OUTCOMES
            or self.record_ids != tuple(sorted(set(self.record_ids)))
        ):
            raise ContractValueError("record_ids must be bounded, sorted and unique")
        if (
            not isinstance(self.prediction_ids, tuple)
            or len(self.prediction_ids) != len(self.record_ids)
            or len(set(self.prediction_ids)) != len(self.prediction_ids)
        ):
            raise ContractValueError("prediction_ids must align with records and be unique")
        for prediction_id in self.prediction_ids:
            require_contract_id(prediction_id, field="prediction_id")
        for field_name in (
            "record_sha256",
            "outcome_sha256",
            "prediction_sha256",
            "prediction_registration_sha256",
        ):
            values = getattr(self, field_name)
            if (
                not isinstance(values, tuple)
                or len(values) != len(self.record_ids)
                or any(not isinstance(value, DigestV1) for value in values)
            ):
                raise ContractValueError(f"{field_name} must align with record_ids")

    @classmethod
    def for_corpus(
        cls,
        *,
        collector_id: str,
        collector_revision: str,
        prediction_owner_id: str,
        prediction_owner_revision: str,
        corpus: RecordedOutcomeCorpusV1,
        prediction_registrations: tuple[RecordedPredictionRegistrationV1, ...],
    ) -> RecordedOutcomeAttestationV1:
        if not isinstance(corpus, RecordedOutcomeCorpusV1):
            raise ContractValueError("corpus must be RecordedOutcomeCorpusV1")
        if (
            not isinstance(prediction_registrations, tuple)
            or len(prediction_registrations) != len(corpus.records)
            or any(
                not isinstance(item, RecordedPredictionRegistrationV1)
                for item in prediction_registrations
            )
        ):
            raise ContractValueError("prediction registrations must align with corpus records")
        for record, registration in zip(
            corpus.records,
            prediction_registrations,
            strict=True,
        ):
            if (
                registration.owner_id != prediction_owner_id
                or registration.owner_revision != prediction_owner_revision
                or not registration.matches_outcome(record)
            ):
                raise ContractValueError(
                    "every outcome requires its exact owner-bound pre-outcome prediction"
                )
        return cls(
            collector_id=collector_id,
            collector_revision=collector_revision,
            prediction_owner_id=prediction_owner_id,
            prediction_owner_revision=prediction_owner_revision,
            corpus_id=corpus.corpus_id,
            corpus_revision=corpus.corpus_revision,
            corpus_sha256=corpus.content_digest,
            record_ids=tuple(record.outcome_id for record in corpus.records),
            record_sha256=tuple(record.content_digest for record in corpus.records),
            outcome_sha256=tuple(record.outcome_truth_digest for record in corpus.records),
            prediction_ids=tuple(record.prediction_id for record in corpus.records),
            prediction_sha256=tuple(
                registration.prediction.content_digest for registration in prediction_registrations
            ),
            prediction_registration_sha256=tuple(
                registration.content_digest for registration in prediction_registrations
            ),
        )

    @classmethod
    def from_mapping(cls, mapping: dict[str, object]) -> RecordedOutcomeAttestationV1:
        expected_keys = {
            "collectorId",
            "collectorRevision",
            "predictionOwnerId",
            "predictionOwnerRevision",
            "corpusId",
            "corpusRevision",
            "corpusSha256",
            "outcomeSha256",
            "predictionIds",
            "predictionSha256",
            "predictionRegistrationSha256",
            "recordIds",
            "recordSha256",
            "schema",
            "version",
        }
        if set(mapping) != expected_keys:
            raise ContractValueError("recorded-outcome attestation keys must be schema-exact")
        if (
            mapping.get("schema") != RECORDED_OUTCOME_ATTESTATION_SCHEMA
            or mapping.get("version") != 1
        ):
            raise ContractValueError("recorded-outcome attestation schema/version mismatch")
        strings = (
            mapping.get("collectorId"),
            mapping.get("collectorRevision"),
            mapping.get("predictionOwnerId"),
            mapping.get("predictionOwnerRevision"),
            mapping.get("corpusId"),
            mapping.get("corpusRevision"),
            mapping.get("corpusSha256"),
        )
        if any(not isinstance(value, str) for value in strings):
            raise ContractValueError("recorded-outcome attestation identities must be text")
        record_ids = mapping.get("recordIds")
        record_sha = mapping.get("recordSha256")
        outcome_sha = mapping.get("outcomeSha256")
        prediction_ids = mapping.get("predictionIds")
        prediction_sha = mapping.get("predictionSha256")
        prediction_registration_sha = mapping.get("predictionRegistrationSha256")
        arrays = (
            record_ids,
            record_sha,
            outcome_sha,
            prediction_ids,
            prediction_sha,
            prediction_registration_sha,
        )
        if not all(isinstance(value, list) for value in arrays):
            raise ContractValueError("recorded-outcome attestation arrays must be lists")
        record_id_values = cast(list[object], record_ids)
        record_sha_values = cast(list[object], record_sha)
        outcome_sha_values = cast(list[object], outcome_sha)
        prediction_id_values = cast(list[object], prediction_ids)
        prediction_sha_values = cast(list[object], prediction_sha)
        prediction_registration_sha_values = cast(list[object], prediction_registration_sha)
        if any(
            not isinstance(value, str)
            for value in (
                *record_id_values,
                *record_sha_values,
                *outcome_sha_values,
                *prediction_id_values,
                *prediction_sha_values,
                *prediction_registration_sha_values,
            )
        ):
            raise ContractValueError("recorded-outcome attestation array values must be text")
        return cls(
            collector_id=cast(str, strings[0]),
            collector_revision=cast(str, strings[1]),
            prediction_owner_id=cast(str, strings[2]),
            prediction_owner_revision=cast(str, strings[3]),
            corpus_id=cast(str, strings[4]),
            corpus_revision=cast(str, strings[5]),
            corpus_sha256=DigestV1(cast(str, strings[6])),
            record_ids=tuple(cast(list[str], record_id_values)),
            record_sha256=tuple(DigestV1(value) for value in cast(list[str], record_sha_values)),
            outcome_sha256=tuple(DigestV1(value) for value in cast(list[str], outcome_sha_values)),
            prediction_ids=tuple(cast(list[str], prediction_id_values)),
            prediction_sha256=tuple(
                DigestV1(value) for value in cast(list[str], prediction_sha_values)
            ),
            prediction_registration_sha256=tuple(
                DigestV1(value) for value in cast(list[str], prediction_registration_sha_values)
            ),
        )

    def matches_corpus(
        self,
        corpus: RecordedOutcomeCorpusV1,
        prediction_registrations: tuple[RecordedPredictionRegistrationV1, ...],
    ) -> bool:
        return self == self.for_corpus(
            collector_id=self.collector_id,
            collector_revision=self.collector_revision,
            prediction_owner_id=self.prediction_owner_id,
            prediction_owner_revision=self.prediction_owner_revision,
            corpus=corpus,
            prediction_registrations=prediction_registrations,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "collectorId": self.collector_id,
            "collectorRevision": self.collector_revision,
            "predictionOwnerId": self.prediction_owner_id,
            "predictionOwnerRevision": self.prediction_owner_revision,
            "corpusId": self.corpus_id,
            "corpusRevision": self.corpus_revision,
            "corpusSha256": self.corpus_sha256.hexdigest,
            "outcomeSha256": [value.hexdigest for value in self.outcome_sha256],
            "predictionIds": list(self.prediction_ids),
            "predictionRegistrationSha256": [
                value.hexdigest for value in self.prediction_registration_sha256
            ],
            "predictionSha256": [value.hexdigest for value in self.prediction_sha256],
            "recordIds": list(self.record_ids),
            "recordSha256": [value.hexdigest for value in self.record_sha256],
            "schema": RECORDED_OUTCOME_ATTESTATION_SCHEMA,
            "version": 1,
        }


@dataclass(frozen=True, slots=True)
class RecordedCalibrationPolicyV1:
    policy_revision: str
    authority: CalibrationAuthority
    minimum_records: int
    maximum_source_revisions: int
    maximum_brier_micros: int
    maximum_absolute_bias_micros: int
    maximum_mean_absolute_residual_micros: int
    maximum_absolute_cost_residual_micros: int
    required_cost_unit: str
    required_cost_valuation_asset: str

    def __post_init__(self) -> None:
        require_contract_id(self.policy_revision, field="policy_revision")
        if not isinstance(self.authority, CalibrationAuthority):
            raise ContractValueError("authority must be CalibrationAuthority")
        require_strict_int(
            self.minimum_records,
            field="minimum_records",
            minimum=1,
            maximum=MAX_RECORDED_OUTCOMES,
        )
        require_strict_int(
            self.maximum_source_revisions,
            field="maximum_source_revisions",
            minimum=1,
            maximum=128,
        )
        for field_name in (
            "maximum_brier_micros",
            "maximum_absolute_bias_micros",
            "maximum_mean_absolute_residual_micros",
        ):
            require_strict_int(
                getattr(self, field_name), field=field_name, minimum=0, maximum=MICROS
            )
        require_strict_int(
            self.maximum_absolute_cost_residual_micros,
            field="maximum_absolute_cost_residual_micros",
            minimum=0,
            maximum=10**15,
        )
        require_contract_id(self.required_cost_unit, field="required_cost_unit")
        require_contract_id(
            self.required_cost_valuation_asset,
            field="required_cost_valuation_asset",
        )

    @property
    def required_reality(self) -> OutcomeReality:
        return (
            OutcomeReality.REPLAY
            if self.authority is CalibrationAuthority.RESEARCH_ONLY
            else OutcomeReality.REAL
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "authority": self.authority.value,
            "maximumAbsoluteBiasMicros": self.maximum_absolute_bias_micros,
            "maximumAbsoluteCostResidualMicros": self.maximum_absolute_cost_residual_micros,
            "maximumBrierMicros": self.maximum_brier_micros,
            "maximumMeanAbsoluteResidualMicros": self.maximum_mean_absolute_residual_micros,
            "maximumSourceRevisions": self.maximum_source_revisions,
            "minimumRecords": self.minimum_records,
            "policyRevision": self.policy_revision,
            "requiredReality": self.required_reality.value,
            "requiredCostUnit": self.required_cost_unit,
            "requiredCostValuationAsset": self.required_cost_valuation_asset,
        }


@dataclass(frozen=True, slots=True)
class RecordedCalibrationReportV1:
    report_id: str
    slot_id: str
    corpus_id: str
    corpus_revision: str
    corpus_sha256: DigestV1
    attestation_artifact_sha256: DigestV1 | None
    policy: RecordedCalibrationPolicyV1
    model_id: str | None
    model_revision: str | None
    source_revisions: tuple[str, ...]
    record_ids: tuple[str, ...]
    outcome_digests: tuple[DigestV1, ...]
    prediction_digests: tuple[DigestV1, ...]
    prediction_registration_digests: tuple[DigestV1, ...]
    status: RecordedCalibrationStatus
    reason_codes: tuple[str, ...]
    mean_prediction_micros: int | None
    mean_outcome_micros: int | None
    brier_micros: int | None
    bias_micros: int | None
    mean_absolute_residual_micros: int | None
    mean_cost_residual_micros: int | None

    def __post_init__(self) -> None:
        for field_name in ("report_id", "slot_id", "corpus_id", "corpus_revision"):
            require_contract_id(getattr(self, field_name), field=field_name)
        if not isinstance(self.corpus_sha256, DigestV1):
            raise ContractValueError("corpus_sha256 must be DigestV1")
        if self.attestation_artifact_sha256 is not None and not isinstance(
            self.attestation_artifact_sha256, DigestV1
        ):
            raise ContractValueError("attestation_artifact_sha256 must be DigestV1 or None")
        if not isinstance(self.policy, RecordedCalibrationPolicyV1):
            raise ContractValueError("policy must be RecordedCalibrationPolicyV1")
        if not isinstance(self.status, RecordedCalibrationStatus):
            raise ContractValueError("status must be RecordedCalibrationStatus")
        for field_name in ("outcome_digests", "prediction_digests"):
            values = getattr(self, field_name)
            if (
                not isinstance(values, tuple)
                or len(values) != len(self.record_ids)
                or any(not isinstance(value, DigestV1) for value in values)
            ):
                raise ContractValueError(f"{field_name} must align with record_ids")
        if not isinstance(self.prediction_registration_digests, tuple) or any(
            not isinstance(value, DigestV1) for value in self.prediction_registration_digests
        ):
            raise ContractValueError("prediction_registration_digests must contain DigestV1 values")
        if self.attestation_artifact_sha256 is None:
            if self.prediction_registration_digests:
                raise ContractValueError(
                    "unattested reports cannot claim prediction registration receipts"
                )
        elif len(self.prediction_registration_digests) != len(self.record_ids):
            raise ContractValueError(
                "production attestation requires one prediction registration per record"
            )
        metrics = (
            self.mean_prediction_micros,
            self.mean_outcome_micros,
            self.brier_micros,
            self.bias_micros,
            self.mean_absolute_residual_micros,
            self.mean_cost_residual_micros,
        )
        if self.status is RecordedCalibrationStatus.DATA_INSUFFICIENT:
            if any(value is not None for value in metrics):
                raise ContractValueError("DATA_INSUFFICIENT cannot publish metrics")
        elif any(value is None for value in metrics):
            raise ContractValueError("evaluated calibration reports require all metrics")

    @property
    def report_revision(self) -> str:
        return f"sha256:{self.content_digest.hexdigest}"

    @property
    def is_promotable(self) -> bool:
        return self.status is RecordedCalibrationStatus.PROMOTION_ELIGIBLE

    def as_mapping(self) -> dict[str, object]:
        return {
            "attestationArtifactSha256": None
            if self.attestation_artifact_sha256 is None
            else self.attestation_artifact_sha256.hexdigest,
            "biasMicros": self.bias_micros,
            "brierMicros": self.brier_micros,
            "corpusId": self.corpus_id,
            "corpusRevision": self.corpus_revision,
            "corpusSha256": self.corpus_sha256.hexdigest,
            "meanAbsoluteResidualMicros": self.mean_absolute_residual_micros,
            "meanCostResidualMicros": self.mean_cost_residual_micros,
            "meanOutcomeMicros": self.mean_outcome_micros,
            "meanPredictionMicros": self.mean_prediction_micros,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "outcomeSha256": [digest.hexdigest for digest in self.outcome_digests],
            "predictionRegistrationSha256": [
                digest.hexdigest for digest in self.prediction_registration_digests
            ],
            "predictionSha256": [digest.hexdigest for digest in self.prediction_digests],
            "policy": self.policy.as_mapping(),
            "reasonCodes": list(self.reason_codes),
            "recordIds": list(self.record_ids),
            "reportId": self.report_id,
            "schema": "Q15RecordedCalibrationReportV1",
            "slotId": self.slot_id,
            "sourceRevisions": list(self.source_revisions),
            "status": self.status.value,
            "version": 1,
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


@dataclass(frozen=True, slots=True)
class RecordedCalibrationSnapshotV1:
    slot_id: str
    generation: int
    report_id: str
    report_revision: str
    model_id: str
    model_revision: str
    policy_revision: str
    authority: CalibrationAuthority
    transition_id: str
    updated_at_ms: int

    def __post_init__(self) -> None:
        for field_name in (
            "slot_id",
            "report_id",
            "report_revision",
            "model_id",
            "model_revision",
            "policy_revision",
            "transition_id",
        ):
            require_contract_id(getattr(self, field_name), field=field_name)
        require_strict_int(self.generation, field="generation", minimum=1)
        if not isinstance(self.authority, CalibrationAuthority):
            raise ContractValueError("authority must be CalibrationAuthority")
        require_utc_millis(self.updated_at_ms, field="updated_at_ms")

    def as_mapping(self) -> dict[str, object]:
        return {
            "authority": self.authority.value,
            "generation": self.generation,
            "modelId": self.model_id,
            "modelRevision": self.model_revision,
            "policyRevision": self.policy_revision,
            "reportId": self.report_id,
            "reportRevision": self.report_revision,
            "slotId": self.slot_id,
            "transitionId": self.transition_id,
            "updatedAtMs": str(self.updated_at_ms),
        }

    @property
    def content_digest(self) -> DigestV1:
        return mapping_digest(self.as_mapping())


def evaluate_recorded_calibration(
    *,
    report_id: str,
    slot_id: str,
    corpus: RecordedOutcomeCorpusV1,
    policy: RecordedCalibrationPolicyV1,
) -> RecordedCalibrationReportV1:
    """Evaluate research truth; production eligibility is a registry-store operation."""

    return _evaluate_recorded_calibration(
        report_id=report_id,
        slot_id=slot_id,
        corpus=corpus,
        policy=policy,
        attestation_artifact_sha256=None,
        prediction_registration_digests=(),
    )


def _evaluate_recorded_calibration(
    *,
    report_id: str,
    slot_id: str,
    corpus: RecordedOutcomeCorpusV1,
    policy: RecordedCalibrationPolicyV1,
    attestation_artifact_sha256: DigestV1 | None,
    prediction_registration_digests: tuple[DigestV1, ...],
) -> RecordedCalibrationReportV1:
    require_contract_id(report_id, field="report_id")
    require_contract_id(slot_id, field="slot_id")
    if not isinstance(corpus, RecordedOutcomeCorpusV1):
        raise ContractValueError("corpus must be RecordedOutcomeCorpusV1")
    if not isinstance(policy, RecordedCalibrationPolicyV1):
        raise ContractValueError("policy must be RecordedCalibrationPolicyV1")
    if attestation_artifact_sha256 is not None and not isinstance(
        attestation_artifact_sha256, DigestV1
    ):
        raise ContractValueError("attestation_artifact_sha256 must be DigestV1 or None")
    if (
        policy.authority is CalibrationAuthority.RESEARCH_ONLY
        and attestation_artifact_sha256 is not None
    ):
        raise ContractValueError("research calibration must not claim production attestation")
    if not isinstance(prediction_registration_digests, tuple) or any(
        not isinstance(value, DigestV1) for value in prediction_registration_digests
    ):
        raise ContractValueError("prediction registration digests must contain DigestV1")
    if attestation_artifact_sha256 is None and prediction_registration_digests:
        raise ContractValueError("prediction receipts require a production attestation")
    if attestation_artifact_sha256 is not None and len(prediction_registration_digests) != len(
        corpus.records
    ):
        raise ContractValueError("production reports require one prediction receipt per record")
    models = tuple(sorted({(record.model_id, record.model_revision) for record in corpus.records}))
    source_revisions = tuple(sorted({record.source_revision for record in corpus.records}))
    realities = {record.reality for record in corpus.records}
    reasons: set[str] = set()
    if len(corpus.records) < policy.minimum_records:
        reasons.add("RECORDED_OUTCOMES_BELOW_MINIMUM")
    if not corpus.records:
        reasons.add("RECORDED_OUTCOMES_ABSENT")
    if len(models) > 1:
        reasons.add("MODEL_REVISION_MIXED")
    if len(source_revisions) > policy.maximum_source_revisions:
        reasons.add("SOURCE_REVISION_FRAGMENTED")
    if realities != {policy.required_reality}:
        reasons.add("OUTCOME_REALITY_NOT_AUTHORIZED")
    if corpus.records and any(
        (record.cost_unit, record.cost_valuation_asset)
        != (policy.required_cost_unit, policy.required_cost_valuation_asset)
        for record in corpus.records
    ):
        reasons.add("COST_IDENTITY_NOT_AUTHORIZED")
    if policy.authority is CalibrationAuthority.PRODUCTION and attestation_artifact_sha256 is None:
        reasons.add("OUTCOME_ATTESTATION_REQUIRED")

    if len(corpus.records) < policy.minimum_records or not corpus.records:
        status = RecordedCalibrationStatus.DATA_INSUFFICIENT
        metrics: tuple[int | None, ...] = (None,) * 6
    else:
        count = len(corpus.records)
        mean_prediction = sum(record.prediction_micros for record in corpus.records) // count
        mean_outcome = sum(record.outcome_micros for record in corpus.records) // count
        bias_total = sum(record.residual_micros for record in corpus.records)
        absolute_residual_total = sum(abs(record.residual_micros) for record in corpus.records)
        brier_numerator = sum(
            record.residual_micros * record.residual_micros for record in corpus.records
        )
        cost_residual_total = sum(record.cost_residual_micros for record in corpus.records)
        # Positive fractional loss/error is rounded upward; signed bias rounds
        # away from zero. Exact numerators, not rounded reports, gate budgets.
        bias = _round_ratio_away_from_zero(bias_total, count)
        mean_absolute_residual = _ceil_nonnegative_ratio(absolute_residual_total, count)
        brier = _ceil_nonnegative_ratio(brier_numerator, count * MICROS)
        mean_cost_residual = _round_ratio_away_from_zero(cost_residual_total, count)
        metrics = (
            mean_prediction,
            mean_outcome,
            brier,
            bias,
            mean_absolute_residual,
            mean_cost_residual,
        )
        if brier_numerator > policy.maximum_brier_micros * count * MICROS:
            reasons.add("BRIER_EXCEEDS_BUDGET")
        if abs(bias_total) > policy.maximum_absolute_bias_micros * count:
            reasons.add("BIAS_EXCEEDS_BUDGET")
        if absolute_residual_total > policy.maximum_mean_absolute_residual_micros * count:
            reasons.add("RESIDUAL_EXCEEDS_BUDGET")
        if abs(cost_residual_total) > policy.maximum_absolute_cost_residual_micros * count:
            reasons.add("COST_RESIDUAL_EXCEEDS_BUDGET")
        if "OUTCOME_REALITY_NOT_AUTHORIZED" in reasons:
            status = RecordedCalibrationStatus.WRONG_REALITY
        elif "OUTCOME_ATTESTATION_REQUIRED" in reasons:
            status = RecordedCalibrationStatus.NOT_CONFIGURED
        elif reasons:
            status = RecordedCalibrationStatus.REJECTED
        else:
            status = RecordedCalibrationStatus.PROMOTION_ELIGIBLE
    model_id, model_revision = models[0] if len(models) == 1 else (None, None)
    return RecordedCalibrationReportV1(
        report_id=report_id,
        slot_id=slot_id,
        corpus_id=corpus.corpus_id,
        corpus_revision=corpus.corpus_revision,
        corpus_sha256=corpus.content_digest,
        attestation_artifact_sha256=attestation_artifact_sha256,
        policy=policy,
        model_id=model_id,
        model_revision=model_revision,
        source_revisions=source_revisions,
        record_ids=tuple(record.outcome_id for record in corpus.records),
        outcome_digests=tuple(record.outcome_truth_digest for record in corpus.records),
        prediction_digests=tuple(record.prediction_artifact_sha256 for record in corpus.records),
        prediction_registration_digests=prediction_registration_digests,
        status=status,
        reason_codes=tuple(sorted(reasons)),
        mean_prediction_micros=metrics[0],
        mean_outcome_micros=metrics[1],
        brier_micros=metrics[2],
        bias_micros=metrics[3],
        mean_absolute_residual_micros=metrics[4],
        mean_cost_residual_micros=metrics[5],
    )
