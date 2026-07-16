"""Q16 deterministic raw-fixture to advisory-envelope pipeline."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import cast

from quant_edge.book.replay import ReplayResultV1, run_replay, script_from_mapping
from quant_edge.canonical import canonical_json_bytes, require_exact_keys
from quant_edge.errors import ContractValueError
from quant_edge.features.values import FeatureValueV1, derive_feature_value
from quant_edge.inference.contracts import ServingLineageV1, StageDigestV1
from quant_edge.inference.protocol import ProtocolContractV1, protocol_digest, protocol_json_bytes
from quant_edge.lake.contracts import DigestV1, ExactScaledValueV1, require_contract_id
from quant_edge.micro.bookfeat import (
    book_slope_imbalance_feature,
    cumulative_band_imbalance_feature,
    vwap_spread_at_size_feature,
)
from quant_edge.micro.inputs import TopOfBookPointV1, ladder_from_book_view
from quant_edge.micro.l1 import l1_queue_imbalance_feature, microprice_displacement_feature
from quant_edge.primitives import require_utc_millis

RAW_FIXTURE_FIELDS = (
    "economicAssumptionContext",
    "expiresAtMs",
    "featureCutoffTimeMs",
    "fixtureId",
    "generatedAtMs",
    "schema",
    "sourceFixtureSha256",
    "spotBookScript",
    "traceId",
    "truthLabel",
    "version",
)
ACCEPTED_Q04_FIXTURE_SHA256 = "32e134938d9e2ba5e9f32fb279bfa9bf9c6dcc8abe0d220107382d7f78fa6aec"
ACCEPTED_Q04_SPOT_SCRIPT_SHA256 = "b61f0c058b253ebe88a1e871db1fc4d246e5b14ebb6e26f10a3777b5ec6cd8e6"
SOURCE_FRESHNESS_BOUND_MS = 1_000


@dataclass(frozen=True, slots=True)
class PipelineResultV1:
    raw_fixture: dict[str, object]
    evidence: dict[str, object]
    feature_snapshot: dict[str, object]
    model_state: dict[str, object]
    calibration_state: dict[str, object]
    assessment: dict[str, object]
    stages: tuple[StageDigestV1, ...]

    def __post_init__(self) -> None:
        mappings = (
            self.raw_fixture,
            self.evidence,
            self.feature_snapshot,
            self.model_state,
            self.calibration_state,
            self.assessment,
        )
        if any(not isinstance(item, dict) for item in mappings):
            raise ContractValueError("pipeline stages must be JSON object mappings")
        if not isinstance(self.stages, tuple) or len(self.stages) != 6:
            raise ContractValueError("pipeline result requires the exact six-stage chain")
        names = tuple(stage.stage for stage in self.stages)
        if names != ("RAW", "EVIDENCE", "FEATURES", "MODELS", "CALIBRATION", "ASSESSMENT"):
            raise ContractValueError("pipeline stage order is not canonical")

    @property
    def assessment_sha256(self) -> DigestV1:
        return self.stages[-1].digest

    def as_mapping(self) -> dict[str, object]:
        return {
            "assessment": self.assessment,
            "assessmentSha256": self.assessment_sha256.hexdigest,
            "calibrationState": self.calibration_state,
            "evidence": self.evidence,
            "featureSnapshot": self.feature_snapshot,
            "modelState": self.model_state,
            "posture": "SYNTHETIC_ONLY",
            "schema": "Q16InferencePipelineResultV1",
            "stages": [stage.as_mapping() for stage in self.stages],
            "version": 1,
        }


def _internal_digest(value: object) -> DigestV1:
    return DigestV1(hashlib.sha256(canonical_json_bytes(value)).hexdigest())


def _stage(
    stage: str,
    schema: str,
    value: object,
    parents: tuple[StageDigestV1, ...],
    *,
    protocol: bool = False,
) -> StageDigestV1:
    digest = protocol_digest(value) if protocol else _internal_digest(value)
    return StageDigestV1(
        stage=stage,
        schema=schema,
        digest=digest,
        parent_digests=tuple(parent.digest for parent in parents),
    )


def _validate_raw_fixture(value: dict[str, object]) -> None:
    require_exact_keys(value, expected=RAW_FIXTURE_FIELDS, path="$raw")
    if (
        value["schema"] != "Q16RawInferenceFixtureV1"
        or type(value["version"]) is not int
        or value["version"] != 1
        or value["truthLabel"] != "SYNTHETIC"
    ):
        raise ContractValueError("Q16 raw fixture schema/version/truth label is invalid")
    for field in ("fixtureId", "traceId"):
        require_contract_id(value[field], field=field)
    source_digest = value["sourceFixtureSha256"]
    if source_digest != ACCEPTED_Q04_FIXTURE_SHA256:
        raise ContractValueError("sourceFixtureSha256 is not the accepted Q04 fixture")
    for field in ("featureCutoffTimeMs", "generatedAtMs", "expiresAtMs"):
        item = value[field]
        if isinstance(item, bool) or not isinstance(item, int):
            raise ContractValueError(f"{field} must be an integer")
    if cast(int, value["featureCutoffTimeMs"]) > cast(int, value["generatedAtMs"]):
        raise ContractValueError("feature cutoff cannot follow generation time")
    if cast(int, value["generatedAtMs"]) >= cast(int, value["expiresAtMs"]):
        raise ContractValueError("assessment expiry must follow generation time")
    if not isinstance(value["spotBookScript"], dict):
        raise ContractValueError("spotBookScript must be a Q04 script object")
    script = script_from_mapping(cast(dict[str, object], value["spotBookScript"]))
    if script.script_digest.hexdigest != ACCEPTED_Q04_SPOT_SCRIPT_SHA256:
        raise ContractValueError("spotBookScript is not the accepted Q04 Spot script")
    economics = value["economicAssumptionContext"]
    if not isinstance(economics, dict):
        raise ContractValueError("economicAssumptionContext must be an object")
    if (
        economics.get("asOfMs") != value["generatedAtMs"]
        or economics.get("expiresAtMs") != value["expiresAtMs"]
    ):
        raise ContractValueError("economic assumption times must match the fixture lifecycle")
    source_ids = economics.get("sourceSnapshotIds")
    if not isinstance(source_ids, list) or value["fixtureId"] not in source_ids:
        raise ContractValueError("economic assumptions must bind the raw fixture identity")


def _source_times(raw: dict[str, object]) -> tuple[int, int]:
    script = cast(dict[str, object], raw["spotBookScript"])
    steps = script.get("steps")
    if not isinstance(steps, list):
        raise ContractValueError("spotBookScript steps are unavailable")
    event_times: list[int] = []
    receive_times: list[int] = []
    for step in steps:
        if not isinstance(step, dict):
            raise ContractValueError("spotBookScript step is malformed")
        delta = step.get("delta")
        snapshot = step.get("snapshot")
        if isinstance(delta, dict):
            event_time = delta.get("eventTimeMs")
            receive = delta.get("receive")
            if isinstance(event_time, bool) or not isinstance(event_time, int):
                raise ContractValueError("Q04 delta event time is malformed")
            if not isinstance(receive, dict):
                raise ContractValueError("Q04 delta receive truth is malformed")
            receive_time = receive.get("receiveWallTimeMs")
            if isinstance(receive_time, bool) or not isinstance(receive_time, int):
                raise ContractValueError("Q04 delta receive time is malformed")
            event_times.append(event_time)
            receive_times.append(receive_time)
        elif isinstance(snapshot, dict):
            provenance = snapshot.get("provenance")
            if not isinstance(provenance, dict):
                raise ContractValueError("Q04 snapshot provenance is malformed")
            receive_time = provenance.get("acquiredWallTimeMs")
            if isinstance(receive_time, bool) or not isinstance(receive_time, int):
                raise ContractValueError("Q04 snapshot receive time is malformed")
            receive_times.append(receive_time)
    if not event_times or not receive_times:
        raise ContractValueError("Q04 source times are unavailable")
    event_time_ms = max(event_times)
    receive_time_ms = max(receive_times)
    cutoff_ms = cast(int, raw["featureCutoffTimeMs"])
    generated_ms = cast(int, raw["generatedAtMs"])
    if event_time_ms > receive_time_ms or receive_time_ms > cutoff_ms or cutoff_ms > generated_ms:
        raise ContractValueError("Q04 event/receive/cutoff/generation time chain is invalid")
    return event_time_ms, receive_time_ms


def _instrument(result: ReplayResultV1) -> dict[str, object]:
    symbol = result.final_view.symbol
    asset = symbol.removesuffix("USDT") or symbol
    return {
        "borrowAsset": asset,
        "canonicalAsset": asset,
        "missingLegReason": "USD-M and borrow truth are absent from this synthetic fixture",
        "perpSymbol": None,
        "product": "SPOT",
        "spotSymbol": symbol,
        "symbol": symbol,
        "venue": "BINANCE",
    }


def _quality(result: ReplayResultV1) -> dict[str, object]:
    counters = dict(result.final_view.counters)
    gap_count = counters.get("anomalies_total", 0)
    return {
        "completeness": "COMPLETE" if result.final_view.model_eligible else "PARTIAL",
        "duplicate": counters.get("ignored_stale", 0) > 0,
        "freshness": "FRESH",
        "gapCount": gap_count,
        "reconstructed": counters.get("snapshots_applied", 0) > 0,
    }


def _evidence(
    raw: dict[str, object],
    result: ReplayResultV1,
    *,
    event_time_ms: int,
    receive_time_ms: int,
) -> dict[str, object]:
    script = script_from_mapping(cast(dict[str, object], raw["spotBookScript"]))
    cutoff_ms = cast(int, raw["featureCutoffTimeMs"])
    evidence_digest = hashlib.sha256(
        f"{script.script_digest.hexdigest}\0{raw['traceId']}".encode()
    ).hexdigest()[:24]
    return {
        "evidenceId": f"q16.ev.{evidence_digest}",
        "exchangeEventTimeMs": event_time_ms,
        "featureCutoffTimeMs": cutoff_ms,
        "instrumentGraph": _instrument(result),
        "localReceiveTimeMs": receive_time_ms,
        "normalizationTimeMs": cutoff_ms,
        "normalizedSchemaHash": _internal_digest(
            {"schema": "Q04ReplayResultV1", "version": 1}
        ).hexdigest,
        "payload": result.final_view.as_mapping(),
        "payloadKind": "BOOK_SNAPSHOT",
        "quality": _quality(result),
        "rawPayloadHash": script.script_digest.hexdigest,
        "revision": 0,
        "schema": "MarketEvidenceEnvelopeV1",
        "source": {
            "connectionId": "q16.synthetic.q04.replay",
            "endpoint": None,
            "sequence": result.final_view.book_update_id,
            "sessionId": "q16.synthetic.session.v1",
            "sourceType": "Q04_ACCEPTED_REPLAY_FIXTURE",
            "streamClass": "LOCAL_SYNTHETIC_REPLAY",
        },
        "traceId": raw["traceId"],
        "truthLabel": "SYNTHETIC",
        "version": 1,
    }


def _feature_values(
    result: ReplayResultV1,
    *,
    cutoff_ms: int,
    input_event_ms: int,
) -> tuple[FeatureValueV1, ...]:
    view = result.final_view
    if not view.bids or not view.asks:
        raise ContractValueError("Q04 final view has no two-sided book")
    event_ns = input_event_ms * 1_000_000
    cutoff_ns = cutoff_ms * 1_000_000
    top = TopOfBookPointV1(
        event_time_ns=event_ns,
        ordinal=view.engine_step,
        bid_price=ExactScaledValueV1(
            view.bids[0].price.coefficient,
            view.bids[0].price.scale,
            "QUOTE_PRICE",
        ),
        bid_size=ExactScaledValueV1(
            view.bids[0].quantity.coefficient,
            view.bids[0].quantity.scale,
            "BASE_QUANTITY",
        ),
        ask_price=ExactScaledValueV1(
            view.asks[0].price.coefficient,
            view.asks[0].price.scale,
            "QUOTE_PRICE",
        ),
        ask_size=ExactScaledValueV1(
            view.asks[0].quantity.coefficient,
            view.asks[0].quantity.scale,
            "BASE_QUANTITY",
        ),
    )
    ladder = ladder_from_book_view(
        event_time_ns=event_ns,
        ordinal=view.engine_step,
        bids=tuple((item.price.aligned, item.quantity.aligned) for item in view.bids),
        asks=tuple((item.price.aligned, item.quantity.aligned) for item in view.asks),
    )
    computations = (
        (
            l1_queue_imbalance_feature().card.feature_id,
            l1_queue_imbalance_feature().batch((top,)),
        ),
        (
            microprice_displacement_feature().card.feature_id,
            microprice_displacement_feature().batch((top,)),
        ),
        (
            cumulative_band_imbalance_feature().card.feature_id,
            cumulative_band_imbalance_feature().batch((ladder,)),
        ),
        (
            book_slope_imbalance_feature().card.feature_id,
            book_slope_imbalance_feature().batch((ladder,)),
        ),
        (
            vwap_spread_at_size_feature().card.feature_id,
            vwap_spread_at_size_feature().batch((ladder,)),
        ),
    )
    return tuple(
        derive_feature_value(
            feature_id=feature_id,
            as_of_ns=cutoff_ns,
            input_last_event_ns=event_ns,
            freshness_bound_ns=1_000_000_000,
            input_quality=view.quality,
            computed=computed,
        )
        for feature_id, computed in computations
    )


def _feature_snapshot(
    result: ReplayResultV1,
    *,
    cutoff_ms: int,
    input_event_ms: int,
) -> dict[str, object]:
    values = tuple(
        sorted(
            _feature_values(result, cutoff_ms=cutoff_ms, input_event_ms=input_event_ms),
            key=lambda item: item.feature_id,
        )
    )
    return {
        "bookResultSha256": result.result_digest.hexdigest,
        "cutoffTimeMs": cutoff_ms,
        "featureOwner": "quant_edge.features+quant_edge.micro",
        "features": [item.as_mapping() for item in values],
        "modelEligibleBook": result.final_view.model_eligible,
        "posture": "SYNTHETIC_ONLY",
        "schema": "Q16FeatureSnapshotV1",
        "version": 1,
    }


def _model_state(lineage: ServingLineageV1, feature_stage: StageDigestV1) -> dict[str, object]:
    return {
        "champion": {
            "availability": lineage.champion_availability.value,
            "modelId": lineage.champion_model_id,
            "posture": lineage.champion_posture,
            "revision": lineage.champion_revision,
            "score": None,
        },
        "deepGate": lineage.deep_gate,
        "featureSnapshotSha256": feature_stage.digest.hexdigest,
        "modelOwner": "quant_edge.registry_ops",
        "posture": "SYNTHETIC_ONLY",
        "schema": "Q16VerifiedModelStateV1",
        "shadowModels": [
            {"advisoryAuthority": "NONE", "modelId": model_id, "score": None}
            for model_id in lineage.shadow_model_ids
        ],
        "version": 1,
    }


def _calibration_state(lineage: ServingLineageV1, model_stage: StageDigestV1) -> dict[str, object]:
    return {
        "calibratedProbability": None,
        "calibrationOwner": "quant_edge.ensemble",
        "modelStateSha256": model_stage.digest.hexdigest,
        "reasonCode": "CALIBRATION_UNAVAILABLE",
        "revision": lineage.calibration_revision,
        "schema": "Q16CalibrationStateV1",
        "status": "UNAVAILABLE_MODEL_OUTPUT",
        "version": 1,
    }


def _assessment(
    raw: dict[str, object],
    evidence: dict[str, object],
    feature_stage: StageDigestV1,
    model_stage: StageDigestV1,
    calibration_stage: StageDigestV1,
    lineage: ServingLineageV1,
    evaluation_time_ms: int,
) -> dict[str, object]:
    reasons = set(lineage.blocking_reason_codes())
    reasons.update(("ECONOMIC_TRUTH_INCOMPLETE", "SOURCE_GAP_HISTORY"))
    quality = dict(cast(dict[str, object], evidence["quality"]))
    receive_time_ms = cast(int, evidence["localReceiveTimeMs"])
    generated_time_ms = cast(int, raw["generatedAtMs"])
    if evaluation_time_ms < generated_time_ms:
        quality["freshness"] = "UNKNOWN"
        reasons.update(("EVALUATION_PRECEDES_GENERATION", "SOURCE_TIME_AMBIGUOUS"))
    elif evaluation_time_ms - receive_time_ms > SOURCE_FRESHNESS_BOUND_MS:
        quality["freshness"] = "STALE"
        reasons.add("SOURCE_STALE")
    if evaluation_time_ms > cast(int, raw["expiresAtMs"]):
        quality["freshness"] = "STALE"
        reasons.update(("ASSESSMENT_EXPIRED", "SOURCE_STALE"))
    if quality["duplicate"] is True:
        reasons.add("DUPLICATE_EVIDENCE_OBSERVED")
    if quality["reconstructed"] is True:
        reasons.add("RECONSTRUCTED_EVIDENCE")
    core_digest = hashlib.sha256(
        "\0".join(
            (
                cast(str, evidence["evidenceId"]),
                feature_stage.digest.hexdigest,
                model_stage.digest.hexdigest,
                calibration_stage.digest.hexdigest,
            )
        ).encode()
    ).hexdigest()
    return {
        "abstentionReasonCodes": sorted(reasons),
        "assessmentId": f"q16.as.{core_digest[:24]}",
        "driftState": "UNKNOWN",
        "economicAssumptionContext": raw["economicAssumptionContext"],
        "eventTimeMs": evidence["exchangeEventTimeMs"],
        "evidence": {
            "conflicting": ["The accepted Q15 champion is not a loadable fitted model artifact."],
            "missing": [
                "accepted champion weights",
                "bound live calibration output",
                "complete fees funding borrow latency and recovery economics",
            ],
            "supporting": ["Q04 replay and Q06/Q07 feature owners completed deterministically."],
        },
        "expiryTimeMs": raw["expiresAtMs"],
        "featureAttribution": [],
        "generationTimeMs": raw["generatedAtMs"],
        "grossEstimate": None,
        "hypothesisId": "H1_BASIS_CONVERGENCE",
        "instrumentGraph": evidence["instrumentGraph"],
        "invalidationConditions": [
            "Do not consume after expiry.",
            "Do not treat synthetic fixture evidence as observed market truth.",
            "Do not use until an accepted hash-pinned loadable champion exists.",
        ],
        "lineage": {
            "calibrationVersion": lineage.calibration_revision,
            "datasetVersion": f"q16.raw.{cast(str, raw['sourceFixtureSha256'])[:16]}",
            "featureVersion": f"q16.features.{feature_stage.digest.hexdigest[:16]}",
            "labelVersion": "UNAVAILABLE",
            "modelVersion": f"{lineage.champion_model_id}.{lineage.champion_revision}",
        },
        "marketStageProbabilities": {},
        "netExpectedValue": {"state": "UNKNOWN"},
        "oodState": "UNKNOWN",
        "parentEvidenceIds": [evidence["evidenceId"]],
        "predictions": [],
        "receiveTimeMs": evidence["localReceiveTimeMs"],
        "regimeProbabilities": {},
        "revision": 0,
        "schema": "EdgeAssessmentEnvelopeV1",
        "sourceQuality": quality,
        "strategyFamily": "BASIS_CONVERGENCE",
        "traceId": raw["traceId"],
        "uncertainty": {"data": "HIGH", "epistemic": "UNKNOWN", "model": "UNKNOWN"},
        "version": 1,
        "advisoryAction": "ABSTAIN_UNKNOWN",
    }


def run_inference_pipeline(
    raw_fixture: dict[str, object],
    *,
    lineage: ServingLineageV1,
    protocol: ProtocolContractV1,
    evaluation_time_ms: int | None = None,
) -> PipelineResultV1:
    if not isinstance(raw_fixture, dict):
        raise ContractValueError("raw_fixture must be an object")
    if not isinstance(lineage, ServingLineageV1):
        raise ContractValueError("lineage must be ServingLineageV1")
    if not isinstance(protocol, ProtocolContractV1):
        raise ContractValueError("protocol must be ProtocolContractV1")
    _validate_raw_fixture(raw_fixture)
    event_time_ms, receive_time_ms = _source_times(raw_fixture)
    evaluation_time = (
        cast(int, raw_fixture["generatedAtMs"])
        if evaluation_time_ms is None
        else require_utc_millis(evaluation_time_ms, field="evaluation_time_ms")
    )
    raw_stage = _stage("RAW", "Q16RawInferenceFixtureV1", raw_fixture, ())
    result = run_replay(script_from_mapping(cast(dict[str, object], raw_fixture["spotBookScript"])))
    evidence = _evidence(
        raw_fixture,
        result,
        event_time_ms=event_time_ms,
        receive_time_ms=receive_time_ms,
    )
    protocol.validate_envelope(evidence, maximum_bytes=262_144)
    evidence_stage = _stage(
        "EVIDENCE", "MarketEvidenceEnvelopeV1", evidence, (raw_stage,), protocol=True
    )
    features = _feature_snapshot(
        result,
        cutoff_ms=cast(int, raw_fixture["featureCutoffTimeMs"]),
        input_event_ms=event_time_ms,
    )
    feature_stage = _stage("FEATURES", "Q16FeatureSnapshotV1", features, (evidence_stage,))
    models = _model_state(lineage, feature_stage)
    model_stage = _stage("MODELS", "Q16VerifiedModelStateV1", models, (feature_stage,))
    calibration = _calibration_state(lineage, model_stage)
    calibration_stage = _stage("CALIBRATION", "Q16CalibrationStateV1", calibration, (model_stage,))
    assessment = _assessment(
        raw_fixture,
        evidence,
        feature_stage,
        model_stage,
        calibration_stage,
        lineage,
        evaluation_time,
    )
    protocol.validate_envelope(assessment, maximum_bytes=262_144)
    assessment_stage = _stage(
        "ASSESSMENT",
        "EdgeAssessmentEnvelopeV1",
        assessment,
        (calibration_stage,),
        protocol=True,
    )
    if protocol_json_bytes(assessment) != protocol_json_bytes(cast(object, assessment)):
        raise ContractValueError("protocol assessment bytes are unstable")
    return PipelineResultV1(
        raw_fixture=raw_fixture,
        evidence=evidence,
        feature_snapshot=features,
        model_state=models,
        calibration_state=calibration,
        assessment=assessment,
        stages=(
            raw_stage,
            evidence_stage,
            feature_stage,
            model_stage,
            calibration_stage,
            assessment_stage,
        ),
    )
