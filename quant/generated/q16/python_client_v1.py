"""Generated Q16 strict one-request UDS client; local use only."""
from __future__ import annotations
import json
import math
import re
import socket
from pathlib import Path

MAXIMUM_SAFE_INTEGER = 9007199254740991
_FROZEN_SCHEMA = json.loads(r"""{"$defs":{"Completeness":{"enum":["COMPLETE","PARTIAL","SAMPLED","UNAVAILABLE","UNKNOWN"]},"DecimalString":{"pattern":"^-?[0-9]{1,24}(\\.[0-9]{1,18})?$","type":"string"},"EconomicAssumptionContextV1":{"additionalProperties":false,"properties":{"asOfMs":{"$ref":"#/$defs/UtcMillis"},"borrow":{"additionalProperties":false,"properties":{"availability":{"enum":["AVAILABLE","UNAVAILABLE","UNKNOWN","STALE"]},"expiresAtMs":{"$ref":"#/$defs/NullableUtcMillis"},"interestConvention":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"quantity":{"$ref":"#/$defs/NullableDecimalString"},"rateHourly":{"$ref":"#/$defs/NullableDecimalString"}},"required":["availability"],"type":"object"},"expiresAtMs":{"$ref":"#/$defs/UtcMillis"},"feeTier":{"additionalProperties":false,"properties":{"makerBps":{"$ref":"#/$defs/NullableDecimalString"},"source":{"$ref":"#/$defs/ShortString"},"takerBps":{"$ref":"#/$defs/NullableDecimalString"},"uncertainty":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]}},"type":"object"},"funding":{"additionalProperties":false,"properties":{"intervalHours":{"anyOf":[{"maximum":24,"minimum":1,"type":"integer"},{"type":"null"}]},"nextFundingTimeMs":{"$ref":"#/$defs/NullableUtcMillis"},"rate":{"$ref":"#/$defs/NullableDecimalString"},"source":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]}},"type":"object"},"intendedSize":{"$ref":"#/$defs/DecimalString"},"latencyScenarioMs":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]},"missingFields":{"$ref":"#/$defs/StringArray"},"quoteCurrency":{"$ref":"#/$defs/ShortString"},"recoveryCostScenario":{"$ref":"#/$defs/NullableDecimalString"},"sourceSnapshotIds":{"$ref":"#/$defs/IdArray"},"spreadSlippageModel":{"additionalProperties":false,"properties":{"name":{"$ref":"#/$defs/ShortString"},"version":{"$ref":"#/$defs/ShortString"}},"required":["name","version"],"type":"object"},"state":{"enum":["LIVE","HYPOTHETICAL"]}},"required":["asOfMs","expiresAtMs","state","intendedSize","quoteCurrency","missingFields","sourceSnapshotIds"],"type":"object"},"EdgeAssessmentEnvelopeV1":{"additionalProperties":false,"properties":{"abstentionReasonCodes":{"items":{"$ref":"#/$defs/UpperSnake"},"maxItems":64,"type":"array"},"advisoryAction":{"enum":["IGNORE","WATCH","FOCUS","PROPOSE_CONSIDERATION","ABSTAIN_UNKNOWN"]},"analogues":{"items":{"additionalProperties":false,"properties":{"analogueId":{"$ref":"#/$defs/IdString"},"laterOutcomeRef":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]}},"required":["analogueId"],"type":"object"},"maxItems":64,"type":"array"},"assessmentId":{"$ref":"#/$defs/IdString"},"capacityEvidence":{"anyOf":[{"maxProperties":32,"type":"object"},{"type":"null"}]},"costEstimates":{"additionalProperties":false,"properties":{"borrow":{"$ref":"#/$defs/NullableDecimalString"},"fee":{"$ref":"#/$defs/NullableDecimalString"},"funding":{"$ref":"#/$defs/NullableDecimalString"},"latency":{"$ref":"#/$defs/NullableDecimalString"},"recovery":{"$ref":"#/$defs/NullableDecimalString"},"slippage":{"$ref":"#/$defs/NullableDecimalString"},"spread":{"$ref":"#/$defs/NullableDecimalString"}},"type":"object"},"driftState":{"enum":["STABLE","DRIFTING","BROKEN","UNKNOWN"]},"economicAssumptionContext":{"$ref":"#/$defs/EconomicAssumptionContextV1"},"eventTimeMs":{"$ref":"#/$defs/NullableUtcMillis"},"evidence":{"additionalProperties":false,"properties":{"conflicting":{"$ref":"#/$defs/StringArray"},"missing":{"$ref":"#/$defs/StringArray"},"supporting":{"$ref":"#/$defs/StringArray"}},"required":["supporting","conflicting","missing"],"type":"object"},"expiryTimeMs":{"$ref":"#/$defs/UtcMillis"},"featureAttribution":{"items":{"additionalProperties":false,"properties":{"contribution":{"$ref":"#/$defs/DecimalString"},"feature":{"$ref":"#/$defs/ShortString"}},"required":["feature","contribution"],"type":"object"},"maxItems":128,"type":"array"},"generationTimeMs":{"$ref":"#/$defs/UtcMillis"},"grossEstimate":{"$ref":"#/$defs/NullableDecimalString"},"hypothesisId":{"$ref":"#/$defs/IdString"},"instrumentGraph":{"$ref":"#/$defs/InstrumentGraph"},"invalidationConditions":{"$ref":"#/$defs/StringArray"},"lineage":{"additionalProperties":false,"properties":{"calibrationVersion":{"$ref":"#/$defs/ShortString"},"datasetVersion":{"$ref":"#/$defs/ShortString"},"featureVersion":{"$ref":"#/$defs/ShortString"},"labelVersion":{"$ref":"#/$defs/ShortString"},"modelVersion":{"$ref":"#/$defs/ShortString"}},"required":["datasetVersion","featureVersion","labelVersion","modelVersion","calibrationVersion"],"type":"object"},"marketStageProbabilities":{"additionalProperties":{"maximum":1,"minimum":0,"type":"number"},"maxProperties":16,"type":"object"},"netExpectedValue":{"additionalProperties":false,"properties":{"quantiles":{"additionalProperties":{"$ref":"#/$defs/DecimalString"},"maxProperties":16,"type":"object"},"state":{"enum":["ESTIMATED","UNKNOWN"]}},"required":["state"],"type":"object"},"oodState":{"enum":["IN_DISTRIBUTION","NEAR_BOUNDARY","OUT_OF_DISTRIBUTION","UNKNOWN"]},"parentEvidenceIds":{"$ref":"#/$defs/IdArray"},"predictions":{"items":{"additionalProperties":false,"properties":{"horizonMs":{"minimum":1,"type":"integer"},"quantiles":{"additionalProperties":{"$ref":"#/$defs/DecimalString"},"maxProperties":16,"type":"object"},"target":{"$ref":"#/$defs/ShortString"}},"required":["target","horizonMs","quantiles"],"type":"object"},"maxItems":64,"type":"array"},"receiveTimeMs":{"$ref":"#/$defs/UtcMillis"},"regimeProbabilities":{"additionalProperties":{"maximum":1,"minimum":0,"type":"number"},"maxProperties":16,"type":"object"},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"EdgeAssessmentEnvelopeV1"},"sourceQuality":{"$ref":"#/$defs/QualityFlags"},"strategyFamily":{"$ref":"#/$defs/ShortString"},"traceId":{"$ref":"#/$defs/IdString"},"uncertainty":{"additionalProperties":false,"properties":{"data":{"enum":["LOW","MEDIUM","HIGH","UNKNOWN"]},"epistemic":{"enum":["LOW","MEDIUM","HIGH","UNKNOWN"]},"model":{"enum":["LOW","MEDIUM","HIGH","UNKNOWN"]}},"required":["epistemic","model","data"],"type":"object"},"version":{"const":1}},"required":["schema","version","revision","assessmentId","traceId","parentEvidenceIds","strategyFamily","hypothesisId","instrumentGraph","eventTimeMs","receiveTimeMs","generationTimeMs","expiryTimeMs","predictions","uncertainty","oodState","driftState","netExpectedValue","evidence","lineage","sourceQuality","advisoryAction","abstentionReasonCodes","invalidationConditions","economicAssumptionContext"],"type":"object"},"EdgeBrainHealthV1":{"additionalProperties":false,"properties":{"blockingReasons":{"$ref":"#/$defs/StringArray"},"componentId":{"$ref":"#/$defs/IdString"},"driftState":{"enum":["STABLE","DRIFTING","BROKEN","UNKNOWN"]},"generatedAtMs":{"$ref":"#/$defs/UtcMillis"},"lastErrorCode":{"anyOf":[{"$ref":"#/$defs/UpperSnake"},{"type":"null"}]},"lastSuccessMs":{"$ref":"#/$defs/NullableUtcMillis"},"modelVersions":{"additionalProperties":{"$ref":"#/$defs/ShortString"},"maxProperties":32,"type":"object"},"queueDepth":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"EdgeBrainHealthV1"},"state":{"enum":["OK","DEGRADED","STALE","FAILED","UNKNOWN"]},"truthLabel":{"$ref":"#/$defs/TruthLabel"},"version":{"const":1}},"required":["schema","version","revision","componentId","generatedAtMs","state","truthLabel","blockingReasons"],"type":"object"},"EdgeFeedbackEnvelopeV1":{"additionalProperties":false,"properties":{"assessmentId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"completeness":{"$ref":"#/$defs/Completeness"},"dedupeKey":{"$ref":"#/$defs/IdString"},"deliveredAtMs":{"$ref":"#/$defs/UtcMillis"},"feedbackId":{"$ref":"#/$defs/IdString"},"outcomeId":{"$ref":"#/$defs/IdString"},"payloadHash":{"$ref":"#/$defs/HashHex"},"projection":{"anyOf":[{"maxProperties":64,"type":"object"},{"type":"null"}]},"reconciliationState":{"$ref":"#/$defs/ReconciliationState"},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"EdgeFeedbackEnvelopeV1"},"traceId":{"$ref":"#/$defs/IdString"},"version":{"const":1}},"required":["schema","version","revision","feedbackId","outcomeId","assessmentId","traceId","deliveredAtMs","dedupeKey","payloadHash","completeness","reconciliationState"],"type":"object"},"EdgeOutcomeEnvelopeV1":{"additionalProperties":false,"properties":{"assessmentId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"cohort":{"enum":["ACTED","REJECTED","EXPIRED","MISSED","CONTROL"]},"completeness":{"$ref":"#/$defs/Completeness"},"contentHash":{"$ref":"#/$defs/HashHex"},"costs":{"additionalProperties":false,"properties":{"borrow":{"$ref":"#/$defs/NullableDecimalString"},"fees":{"$ref":"#/$defs/NullableDecimalString"},"funding":{"$ref":"#/$defs/NullableDecimalString"},"interest":{"$ref":"#/$defs/NullableDecimalString"},"latencyMs":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]},"recovery":{"$ref":"#/$defs/NullableDecimalString"},"slippage":{"$ref":"#/$defs/NullableDecimalString"}},"type":"object"},"decisionLineage":{"anyOf":[{"maxProperties":32,"type":"object"},{"type":"null"}]},"excursion":{"additionalProperties":false,"properties":{"mae":{"$ref":"#/$defs/NullableDecimalString"},"mfe":{"$ref":"#/$defs/NullableDecimalString"},"timeToEventMs":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]}},"type":"object"},"fills":{"items":{"additionalProperties":false,"properties":{"fee":{"$ref":"#/$defs/NullableDecimalString"},"price":{"$ref":"#/$defs/DecimalString"},"quantity":{"$ref":"#/$defs/DecimalString"},"timeMs":{"$ref":"#/$defs/UtcMillis"}},"required":["price","quantity","timeMs"],"type":"object"},"maxItems":512,"type":"array"},"labelKind":{"enum":["REAL","HYPOTHETICAL","REPLAY"]},"outcomeId":{"$ref":"#/$defs/IdString"},"pnlAttribution":{"anyOf":[{"maxProperties":32,"type":"object"},{"type":"null"}]},"reconciliationState":{"$ref":"#/$defs/ReconciliationState"},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"EdgeOutcomeEnvelopeV1"},"sourceEventIds":{"$ref":"#/$defs/IdArray"},"sourceRevisions":{"$ref":"#/$defs/StringArray"},"traceId":{"$ref":"#/$defs/IdString"},"version":{"const":1}},"required":["schema","version","revision","outcomeId","traceId","assessmentId","cohort","labelKind","sourceEventIds","costs","completeness","reconciliationState","contentHash"],"type":"object"},"Freshness":{"enum":["FRESH","STALE","UNKNOWN"]},"HashHex":{"pattern":"^[a-f0-9]{16,128}$","type":"string"},"IdArray":{"items":{"$ref":"#/$defs/IdString"},"maxItems":1024,"type":"array"},"IdString":{"pattern":"^[A-Za-z0-9_.:\\-]{1,128}$","type":"string"},"InstrumentGraph":{"additionalProperties":false,"properties":{"borrowAsset":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"canonicalAsset":{"$ref":"#/$defs/ShortString"},"missingLegReason":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"perpSymbol":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"product":{"$ref":"#/$defs/Product"},"spotSymbol":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"symbol":{"$ref":"#/$defs/ShortString"},"venue":{"$ref":"#/$defs/ShortString"}},"required":["venue","product","symbol","canonicalAsset"],"type":"object"},"MarketEvidenceEnvelopeV1":{"additionalProperties":false,"properties":{"evidenceId":{"$ref":"#/$defs/IdString"},"exchangeEventTimeMs":{"$ref":"#/$defs/NullableUtcMillis"},"featureCutoffTimeMs":{"$ref":"#/$defs/NullableUtcMillis"},"instrumentGraph":{"$ref":"#/$defs/InstrumentGraph"},"localReceiveTimeMs":{"$ref":"#/$defs/UtcMillis"},"normalizationTimeMs":{"$ref":"#/$defs/UtcMillis"},"normalizedSchemaHash":{"$ref":"#/$defs/HashHex"},"payload":{"maxProperties":128,"type":"object"},"payloadKind":{"enum":["TRADE","BOOK_TICKER","BOOK_SNAPSHOT","BOOK_DELTA","MARK","INDEX","FUNDING","OPEN_INTEREST","LIQUIDATION","CONTEXT"]},"quality":{"$ref":"#/$defs/QualityFlags"},"rawPayloadHash":{"$ref":"#/$defs/HashHex"},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"MarketEvidenceEnvelopeV1"},"source":{"$ref":"#/$defs/SourceLineage"},"traceId":{"$ref":"#/$defs/IdString"},"truthLabel":{"$ref":"#/$defs/TruthLabel"},"version":{"const":1}},"required":["schema","version","revision","evidenceId","traceId","instrumentGraph","exchangeEventTimeMs","localReceiveTimeMs","normalizationTimeMs","featureCutoffTimeMs","source","rawPayloadHash","normalizedSchemaHash","truthLabel","quality","payloadKind","payload"],"type":"object"},"NullableDecimalString":{"anyOf":[{"$ref":"#/$defs/DecimalString"},{"type":"null"}]},"NullableUtcMillis":{"anyOf":[{"$ref":"#/$defs/UtcMillis"},{"type":"null"}]},"Product":{"enum":["SPOT","USDM_PERP","MARGIN"]},"ProtocolErrorV1":{"additionalProperties":false,"properties":{"code":{"$ref":"#/$defs/UpperSnake"},"component":{"$ref":"#/$defs/ShortString"},"correlationId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"errorId":{"$ref":"#/$defs/IdString"},"message":{"$ref":"#/$defs/ShortString"},"occurredAtMs":{"$ref":"#/$defs/UtcMillis"},"recommendedOperatorAction":{"$ref":"#/$defs/ShortString"},"retryable":{"type":"boolean"},"revision":{"minimum":0,"type":"integer"},"safeCurrentState":{"$ref":"#/$defs/ShortString"},"schema":{"const":"ProtocolErrorV1"},"sourceEnvelopeId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"sourceEnvelopeSchema":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"stage":{"$ref":"#/$defs/ShortString"},"version":{"const":1}},"required":["schema","version","revision","errorId","code","message","occurredAtMs","retryable","component","stage","safeCurrentState","recommendedOperatorAction","correlationId"],"type":"object"},"QualityFlags":{"additionalProperties":false,"properties":{"completeness":{"$ref":"#/$defs/Completeness"},"duplicate":{"type":"boolean"},"freshness":{"$ref":"#/$defs/Freshness"},"gapCount":{"minimum":0,"type":"integer"},"reconstructed":{"type":"boolean"}},"required":["freshness","completeness","gapCount","duplicate","reconstructed"],"type":"object"},"ReconciliationState":{"enum":["EXACT","PENDING","PARTIAL","AMBIGUOUS","DIVERGED","STALE","UNAVAILABLE"]},"ShortString":{"maxLength":256,"minLength":1,"type":"string"},"SourceLineage":{"additionalProperties":false,"properties":{"connectionId":{"$ref":"#/$defs/IdString"},"endpoint":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"sequence":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]},"sessionId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"sourceType":{"$ref":"#/$defs/ShortString"},"streamClass":{"$ref":"#/$defs/ShortString"}},"required":["sourceType","streamClass","connectionId"],"type":"object"},"StringArray":{"items":{"$ref":"#/$defs/ShortString"},"maxItems":256,"type":"array"},"TruthLabel":{"enum":["LIVE","REPLAY","SYNTHETIC"]},"UpperSnake":{"pattern":"^[A-Z][A-Z0-9_]{0,99}$","type":"string"},"UtcMillis":{"maximum":4102444800000,"minimum":1262304000000,"type":"integer"}},"$id":"edge-protocol-v1","$schema":"https://json-schema.org/draft/2020-12/schema","title":"EDGE_PROTOCOL_V1 — frozen Q/L interchange (see EDGE_PROTOCOL_V1.md)"}""")
_FORBIDDEN = (
    "signature", "apikey", "apisecret", "secret", "passphrase", "password",
    "privatekey", "listenkey", "credential", "approvedcapital", "orderrequest",
    "leveragemutation", "livesendpermission",
)
_WRAPPER_FIELDS = {
    "generatedAtMs", "operation", "payload", "requestId", "schema", "version",
}
_ASSESSMENT_REQUIRED = {
    "schema", "version", "revision", "assessmentId", "traceId", "parentEvidenceIds",
    "strategyFamily", "hypothesisId", "instrumentGraph", "eventTimeMs", "receiveTimeMs",
    "generationTimeMs", "expiryTimeMs", "predictions", "uncertainty", "oodState",
    "driftState", "netExpectedValue", "evidence", "lineage", "sourceQuality",
    "advisoryAction", "abstentionReasonCodes", "invalidationConditions",
    "economicAssumptionContext",
}
_ASSESSMENT_ALLOWED = _ASSESSMENT_REQUIRED | {
    "analogues", "capacityEvidence", "costEstimates", "featureAttribution",
    "grossEstimate", "marketStageProbabilities", "regimeProbabilities",
}
_ERROR_REQUIRED = {
    "schema", "version", "revision", "errorId", "code", "message", "occurredAtMs",
    "retryable", "component", "stage", "safeCurrentState",
    "recommendedOperatorAction", "correlationId",
}
_ERROR_ALLOWED = _ERROR_REQUIRED | {"sourceEnvelopeSchema", "sourceEnvelopeId"}
_READ_FIELDS = {
    "HEALTH": (
        "EdgeBrainHealthV1",
        {
            "schema", "version", "revision", "componentId", "generatedAtMs", "state",
            "truthLabel", "blockingReasons",
        },
        {
            "schema", "version", "revision", "componentId", "generatedAtMs", "state",
            "truthLabel", "blockingReasons", "lastSuccessMs", "lastErrorCode",
            "queueDepth", "modelVersions", "driftState",
        },
    ),
    "READINESS": (
        "Q16ReadinessV1",
        {
            "advisoryReady", "blockingReasonCodes", "limits", "modelReadiness",
            "processReady", "safeFallback", "schema", "serviceability", "version",
        },
        {
            "advisoryReady", "blockingReasonCodes", "limits", "modelReadiness",
            "processReady", "safeFallback", "schema", "serviceability", "version",
        },
    ),
    "LINEAGE": (
        "Q16ServingLineageV1",
        {
            "calibrationAvailable", "calibrationRevision", "champion", "deepGate",
            "dependencyLockSha256", "manifestSha256", "readiness", "schema",
            "shadowModelIds", "streaming", "version",
        },
        {
            "calibrationAvailable", "calibrationRevision", "champion", "deepGate",
            "dependencyLockSha256", "manifestSha256", "readiness", "schema",
            "shadowModelIds", "streaming", "version",
        },
    ),
    "METRICS": (
        "Q16ServiceMetricsV1",
        {
            "abstentions", "accepted", "completed", "protocolErrors", "queueDepth",
            "queueRejections", "schema", "serviceClosedRejections", "timeouts",
            "transportErrors", "version",
        },
        {
            "abstentions", "accepted", "completed", "protocolErrors", "queueDepth",
            "queueRejections", "schema", "serviceClosedRejections", "timeouts",
            "transportErrors", "version",
        },
    ),
}

def _pairs(items: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in items:
        if key in value:
            raise ValueError("response contains a duplicate JSON key")
        value[key] = item
    return value

def _reject_constant(_token: str) -> object:
    raise ValueError("response contains a non-finite number")

def _walk(value: object, depth: int = 0) -> None:
    if depth > 64:
        raise ValueError("response nesting exceeds the client limit")
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = "".join(character for character in key.casefold() if character.isalnum())
            if any(token in normalized for token in _FORBIDDEN):
                raise ValueError("response contains a forbidden authority or secret key")
            _walk(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _walk(item, depth + 1)
    elif isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > MAXIMUM_SAFE_INTEGER:
            raise ValueError("response integer exceeds the cross-language safe range")
    elif isinstance(value, float):
        if not math.isfinite(value) or (value == 0.0 and math.copysign(1.0, value) < 0):
            raise ValueError("response contains a non-finite or negative-zero number")

def _exact(value: dict[str, object], allowed: set[str], required: set[str]) -> None:
    if not required <= set(value) or not set(value) <= allowed:
        raise ValueError("response fields are not schema-exact")

def _integer(value: object, field: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= MAXIMUM_SAFE_INTEGER
    ):
        raise ValueError(f"{field} must be a non-negative safe integer")
    return value

def _identifier(value: object, field: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 256:
        raise ValueError(f"{field} must be bounded non-empty text")
    return value

def _json_type(value: object) -> str:
    if value is None: return "null"
    if isinstance(value, bool): return "boolean"
    if isinstance(value, int): return "integer"
    if isinstance(value, float): return "number"
    if isinstance(value, str): return "string"
    if isinstance(value, list): return "array"
    if isinstance(value, dict): return "object"
    return type(value).__name__

def _resolve(ref: str) -> dict[str, object]:
    if not ref.startswith("#/"):
        raise ValueError("external frozen-schema references are forbidden")
    node: object = _FROZEN_SCHEMA
    for part in ref[2:].split("/"):
        if not isinstance(node, dict) or part not in node:
            raise ValueError("frozen-schema reference is unresolved")
        node = node[part]
    if not isinstance(node, dict):
        raise ValueError("frozen-schema reference is malformed")
    return node

def _schema_errors(schema: dict[str, object], value: object, trail: str) -> list[str]:
    if "$ref" in schema:
        ref = schema["$ref"]
        if not isinstance(ref, str): return [f"{trail}: malformed ref"]
        return _schema_errors(_resolve(ref), value, trail)
    any_of = schema.get("anyOf")
    if isinstance(any_of, list):
        branches = [
            _schema_errors(branch, value, trail)
            for branch in any_of if isinstance(branch, dict)
        ]
        return [] if any(not branch for branch in branches) else [f"{trail}: no anyOf matched"]
    errors: list[str] = []
    if "const" in schema and (
        isinstance(value, bool) != isinstance(schema["const"], bool)
        or value != schema["const"]
    ):
        errors.append(f"{trail}: const mismatch")
    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        errors.append(f"{trail}: enum mismatch")
    expected = schema.get("type")
    observed = _json_type(value)
    if isinstance(expected, str) and not (
        observed == expected or (expected == "number" and observed in {"integer", "number"})
    ):
        return [*errors, f"{trail}: expected {expected}"]
    if isinstance(value, str):
        pattern = schema.get("pattern")
        if isinstance(pattern, str) and re.fullmatch(pattern, value) is None:
            errors.append(f"{trail}: pattern mismatch")
        minimum = schema.get("minLength")
        maximum = schema.get("maxLength")
        if isinstance(minimum, int) and len(value) < minimum: errors.append(f"{trail}: too short")
        if isinstance(maximum, int) and len(value) > maximum: errors.append(f"{trail}: too long")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if isinstance(minimum, (int, float)) and value < minimum: errors.append(f"{trail}: low")
        if isinstance(maximum, (int, float)) and value > maximum: errors.append(f"{trail}: high")
    if isinstance(value, list):
        maximum = schema.get("maxItems")
        if isinstance(maximum, int) and len(value) > maximum: errors.append(f"{trail}: too many")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                errors.extend(_schema_errors(item_schema, item, f"{trail}[{index}]"))
    if isinstance(value, dict):
        maximum = schema.get("maxProperties")
        if isinstance(maximum, int) and len(value) > maximum:
            errors.append(f"{trail}: too many keys")
        required = schema.get("required")
        if isinstance(required, list):
            errors.extend(f"{trail}: missing {key}" for key in required if key not in value)
        properties = schema.get("properties")
        additional = schema.get("additionalProperties")
        for key, item in value.items():
            if isinstance(properties, dict) and key in properties:
                child = properties[key]
                if isinstance(child, dict):
                    errors.extend(_schema_errors(child, item, f"{trail}.{key}"))
            elif additional is False:
                errors.append(f"{trail}: unknown {key}")
            elif isinstance(additional, dict):
                errors.extend(_schema_errors(additional, item, f"{trail}.{key}"))
    return errors

def _validate_frozen_envelope(value: dict[str, object]) -> None:
    definitions = _FROZEN_SCHEMA.get("$defs")
    schema_name = value.get("schema")
    if not isinstance(definitions, dict) or not isinstance(schema_name, str):
        raise ValueError("frozen envelope schema is unavailable")
    body = definitions.get(schema_name)
    if not isinstance(body, dict):
        raise ValueError("frozen envelope schema is unregistered")
    errors = _schema_errors(body, value, "$")
    if errors:
        raise ValueError("frozen envelope validation failed: " + "; ".join(errors[:4]))

def _validate_error(value: dict[str, object]) -> None:
    _validate_frozen_envelope(value)
    _exact(value, _ERROR_ALLOWED, _ERROR_REQUIRED)
    if (
        value["schema"] != "ProtocolErrorV1"
        or isinstance(value["version"], bool)
        or value["version"] != 1
    ):
        raise ValueError("protocol error schema/version is unsupported")
    _integer(value["revision"], "revision")
    _integer(value["occurredAtMs"], "occurredAtMs")
    _identifier(value["errorId"], "errorId")
    _identifier(value["code"], "code")
    if not isinstance(value["retryable"], bool):
        raise ValueError("retryable must be boolean")

def _validate_probabilities(value: object, field: str) -> None:
    if value is None:
        return
    if not isinstance(value, dict) or len(value) > 16:
        raise ValueError(f"{field} must be a bounded object")
    for probability in value.values():
        if isinstance(probability, bool) or not isinstance(probability, (int, float)):
            raise ValueError(f"{field} values must be numeric")
        if not 0 <= probability <= 1:
            raise ValueError(f"{field} values must be probabilities")

def _validate_assessment(value: dict[str, object]) -> None:
    _validate_frozen_envelope(value)
    _exact(value, _ASSESSMENT_ALLOWED, _ASSESSMENT_REQUIRED)
    if (
        value["schema"] != "EdgeAssessmentEnvelopeV1"
        or isinstance(value["version"], bool)
        or value["version"] != 1
    ):
        raise ValueError("assessment schema/version is unsupported")
    for field in ("revision", "receiveTimeMs", "generationTimeMs", "expiryTimeMs"):
        _integer(value[field], field)
    for field in ("assessmentId", "traceId", "strategyFamily", "hypothesisId"):
        _identifier(value[field], field)
    if value["advisoryAction"] not in {
        "IGNORE", "WATCH", "FOCUS", "PROPOSE_CONSIDERATION", "ABSTAIN_UNKNOWN",
    }:
        raise ValueError("assessment advisoryAction is unsupported")
    reasons = value["abstentionReasonCodes"]
    if not isinstance(reasons, list) or any(not isinstance(item, str) for item in reasons):
        raise ValueError("assessment abstentionReasonCodes must be text")
    if value["advisoryAction"] == "ABSTAIN_UNKNOWN" and not reasons:
        raise ValueError("ABSTAIN_UNKNOWN requires at least one reason")
    if not isinstance(value["predictions"], list) or len(value["predictions"]) > 64:
        raise ValueError("assessment predictions must be bounded")
    _validate_probabilities(value.get("marketStageProbabilities"), "marketStageProbabilities")
    _validate_probabilities(value.get("regimeProbabilities"), "regimeProbabilities")
    if not isinstance(value["netExpectedValue"], dict):
        raise ValueError("assessment netExpectedValue must be an object")
    if value["netExpectedValue"].get("state") not in {"ESTIMATED", "UNKNOWN"}:
        raise ValueError("assessment netExpectedValue state is unsupported")
    evidence = value.get("evidence")
    quality = value.get("sourceQuality")
    ambiguous = (
        value["netExpectedValue"].get("state") != "ESTIMATED"
        or not value["predictions"]
        or bool(reasons)
        or value.get("oodState") != "IN_DISTRIBUTION"
        or value.get("driftState") != "STABLE"
        or not isinstance(evidence, dict)
        or bool(evidence.get("conflicting"))
        or bool(evidence.get("missing"))
        or not isinstance(quality, dict)
        or quality.get("freshness") != "FRESH"
        or quality.get("completeness") != "COMPLETE"
        or quality.get("gapCount") != 0
    )
    if ambiguous and value["advisoryAction"] != "ABSTAIN_UNKNOWN":
        raise ValueError("unavailable or ambiguous truth requires ABSTAIN_UNKNOWN")

def _validate_read_payload(operation: str, value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError("read response payload must be an object")
    schema, required, allowed = _READ_FIELDS[operation]
    _exact(value, allowed, required)
    if value["schema"] != schema or isinstance(value["version"], bool) or value["version"] != 1:
        raise ValueError("read response payload schema/version is unsupported")
    if operation == "HEALTH":
        _validate_frozen_envelope(value)
        _integer(value["revision"], "revision")
        _integer(value["generatedAtMs"], "generatedAtMs")
        if value["state"] not in {"OK", "DEGRADED", "STALE", "FAILED", "UNKNOWN"}:
            raise ValueError("health state is unsupported")
    elif operation == "READINESS":
        if not isinstance(value["processReady"], bool) or not isinstance(
            value["advisoryReady"], bool
        ):
            raise ValueError("readiness booleans are malformed")
        if value["safeFallback"] != "ABSTAIN_UNKNOWN":
            raise ValueError("readiness fallback must remain ABSTAIN_UNKNOWN")
    elif operation == "LINEAGE":
        if not isinstance(value["calibrationAvailable"], bool):
            raise ValueError("lineage calibrationAvailable must be boolean")
        if value["streaming"] != "NOT_JUSTIFIED":
            raise ValueError("lineage streaming state is unsupported")
    else:
        for field in (
            "abstentions", "accepted", "completed", "protocolErrors", "queueDepth",
            "queueRejections", "serviceClosedRejections", "timeouts", "transportErrors",
        ):
            _integer(value[field], field)

def validate_response(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("response must be a JSON object")
    _walk(value)
    if value.get("schema") == "ProtocolErrorV1":
        _validate_error(value)
        return value
    _exact(value, _WRAPPER_FIELDS, _WRAPPER_FIELDS)
    if (
        value["schema"] != "Q16LocalInferenceResponseV1"
        or isinstance(value["version"], bool)
        or value["version"] != 1
    ):
        raise ValueError("local response schema/version is unsupported")
    operation = value["operation"]
    if operation not in {"ASSESS", "BATCH_ASSESS", "HEALTH", "READINESS", "LINEAGE", "METRICS"}:
        raise ValueError("local response operation is unsupported")
    _integer(value["generatedAtMs"], "generatedAtMs")
    _identifier(value["requestId"], "requestId")
    payload = value["payload"]
    if operation == "ASSESS":
        if not isinstance(payload, dict):
            raise ValueError("ASSESS payload must be an object")
        _validate_assessment(payload)
    elif operation == "BATCH_ASSESS":
        if not isinstance(payload, list) or not payload or len(payload) > 256:
            raise ValueError("BATCH_ASSESS payload must be a bounded non-empty array")
        for item in payload:
            if not isinstance(item, dict):
                raise ValueError("BATCH_ASSESS item must be an object")
            _validate_assessment(item)
    else:
        _validate_read_payload(operation, payload)
    return value

def _parse(raw: bytes) -> dict[str, object]:
    try:
        text = raw.decode("utf-8", errors="strict")
        value = json.loads(text, object_pairs_hook=_pairs, parse_constant=_reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("response is not strict bounded JSON") from error
    return validate_response(value)

def request_bytes(
    socket_path: Path,
    payload_bytes: bytes,
    *,
    maximum_bytes: int = 262144,
    timeout_seconds: float = 2.0,
) -> dict[str, object]:
    if type(payload_bytes) is not bytes or not payload_bytes or len(payload_bytes) > maximum_bytes:
        raise ValueError("request exceeds the bounded local protocol frame")
    if b"\n" in payload_bytes[:-1] or b"\r" in payload_bytes:
        raise ValueError("request bytes must contain exactly one JSON frame")
    framed = payload_bytes if payload_bytes.endswith(b"\n") else payload_bytes + b"\n"
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(timeout_seconds)
        client.connect(str(socket_path))
        client.sendall(framed)
        received = bytearray()
        while not received.endswith(b"\n"):
            chunk = client.recv(min(65536, maximum_bytes + 1 - len(received)))
            if not chunk:
                raise ValueError("local inference server closed before a complete frame")
            received.extend(chunk)
            if len(received) > maximum_bytes:
                raise ValueError("response exceeds the bounded local protocol frame")
    if b"\n" in received[:-1]:
        raise ValueError("local inference server returned multiple frames")
    return _parse(bytes(received[:-1]))

def request_file(
    socket_path: Path,
    payload_path: Path,
    *,
    maximum_bytes: int = 262144,
    timeout_seconds: float = 2.0,
) -> dict[str, object]:
    return request_bytes(
        socket_path,
        payload_path.read_bytes(),
        maximum_bytes=maximum_bytes,
        timeout_seconds=timeout_seconds,
    )

def request(
    socket_path: Path,
    payload: dict[str, object],
    *,
    maximum_bytes: int = 262144,
    timeout_seconds: float = 2.0,
) -> dict[str, object]:
    _walk(payload)
    raw = json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return request_bytes(
        socket_path,
        raw,
        maximum_bytes=maximum_bytes,
        timeout_seconds=timeout_seconds,
    )
