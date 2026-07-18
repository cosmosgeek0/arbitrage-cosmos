// Generated Q16 strict one-request UDS client; local use only.
import fs from 'node:fs';
import net from 'node:net';
import { TextDecoder } from 'node:util';

const MAXIMUM_SAFE_INTEGER = 9007199254740991;
const FROZEN_SCHEMA = {"$defs":{"Completeness":{"enum":["COMPLETE","PARTIAL","SAMPLED","UNAVAILABLE","UNKNOWN"]},"DecimalString":{"pattern":"^-?[0-9]{1,24}(\\.[0-9]{1,18})?$","type":"string"},"EconomicAssumptionContextV1":{"additionalProperties":false,"properties":{"asOfMs":{"$ref":"#/$defs/UtcMillis"},"borrow":{"additionalProperties":false,"properties":{"availability":{"enum":["AVAILABLE","UNAVAILABLE","UNKNOWN","STALE"]},"expiresAtMs":{"$ref":"#/$defs/NullableUtcMillis"},"interestConvention":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"quantity":{"$ref":"#/$defs/NullableDecimalString"},"rateHourly":{"$ref":"#/$defs/NullableDecimalString"}},"required":["availability"],"type":"object"},"expiresAtMs":{"$ref":"#/$defs/UtcMillis"},"feeTier":{"additionalProperties":false,"properties":{"makerBps":{"$ref":"#/$defs/NullableDecimalString"},"source":{"$ref":"#/$defs/ShortString"},"takerBps":{"$ref":"#/$defs/NullableDecimalString"},"uncertainty":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]}},"type":"object"},"funding":{"additionalProperties":false,"properties":{"intervalHours":{"anyOf":[{"maximum":24,"minimum":1,"type":"integer"},{"type":"null"}]},"nextFundingTimeMs":{"$ref":"#/$defs/NullableUtcMillis"},"rate":{"$ref":"#/$defs/NullableDecimalString"},"source":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]}},"type":"object"},"intendedSize":{"$ref":"#/$defs/DecimalString"},"latencyScenarioMs":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]},"missingFields":{"$ref":"#/$defs/StringArray"},"quoteCurrency":{"$ref":"#/$defs/ShortString"},"recoveryCostScenario":{"$ref":"#/$defs/NullableDecimalString"},"sourceSnapshotIds":{"$ref":"#/$defs/IdArray"},"spreadSlippageModel":{"additionalProperties":false,"properties":{"name":{"$ref":"#/$defs/ShortString"},"version":{"$ref":"#/$defs/ShortString"}},"required":["name","version"],"type":"object"},"state":{"enum":["LIVE","HYPOTHETICAL"]}},"required":["asOfMs","expiresAtMs","state","intendedSize","quoteCurrency","missingFields","sourceSnapshotIds"],"type":"object"},"EdgeAssessmentEnvelopeV1":{"additionalProperties":false,"properties":{"abstentionReasonCodes":{"items":{"$ref":"#/$defs/UpperSnake"},"maxItems":64,"type":"array"},"advisoryAction":{"enum":["IGNORE","WATCH","FOCUS","PROPOSE_CONSIDERATION","ABSTAIN_UNKNOWN"]},"analogues":{"items":{"additionalProperties":false,"properties":{"analogueId":{"$ref":"#/$defs/IdString"},"laterOutcomeRef":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]}},"required":["analogueId"],"type":"object"},"maxItems":64,"type":"array"},"assessmentId":{"$ref":"#/$defs/IdString"},"capacityEvidence":{"anyOf":[{"maxProperties":32,"type":"object"},{"type":"null"}]},"costEstimates":{"additionalProperties":false,"properties":{"borrow":{"$ref":"#/$defs/NullableDecimalString"},"fee":{"$ref":"#/$defs/NullableDecimalString"},"funding":{"$ref":"#/$defs/NullableDecimalString"},"latency":{"$ref":"#/$defs/NullableDecimalString"},"recovery":{"$ref":"#/$defs/NullableDecimalString"},"slippage":{"$ref":"#/$defs/NullableDecimalString"},"spread":{"$ref":"#/$defs/NullableDecimalString"}},"type":"object"},"driftState":{"enum":["STABLE","DRIFTING","BROKEN","UNKNOWN"]},"economicAssumptionContext":{"$ref":"#/$defs/EconomicAssumptionContextV1"},"eventTimeMs":{"$ref":"#/$defs/NullableUtcMillis"},"evidence":{"additionalProperties":false,"properties":{"conflicting":{"$ref":"#/$defs/StringArray"},"missing":{"$ref":"#/$defs/StringArray"},"supporting":{"$ref":"#/$defs/StringArray"}},"required":["supporting","conflicting","missing"],"type":"object"},"expiryTimeMs":{"$ref":"#/$defs/UtcMillis"},"featureAttribution":{"items":{"additionalProperties":false,"properties":{"contribution":{"$ref":"#/$defs/DecimalString"},"feature":{"$ref":"#/$defs/ShortString"}},"required":["feature","contribution"],"type":"object"},"maxItems":128,"type":"array"},"generationTimeMs":{"$ref":"#/$defs/UtcMillis"},"grossEstimate":{"$ref":"#/$defs/NullableDecimalString"},"hypothesisId":{"$ref":"#/$defs/IdString"},"instrumentGraph":{"$ref":"#/$defs/InstrumentGraph"},"invalidationConditions":{"$ref":"#/$defs/StringArray"},"lineage":{"additionalProperties":false,"properties":{"calibrationVersion":{"$ref":"#/$defs/ShortString"},"datasetVersion":{"$ref":"#/$defs/ShortString"},"featureVersion":{"$ref":"#/$defs/ShortString"},"labelVersion":{"$ref":"#/$defs/ShortString"},"modelVersion":{"$ref":"#/$defs/ShortString"}},"required":["datasetVersion","featureVersion","labelVersion","modelVersion","calibrationVersion"],"type":"object"},"marketStageProbabilities":{"additionalProperties":{"maximum":1,"minimum":0,"type":"number"},"maxProperties":16,"type":"object"},"netExpectedValue":{"additionalProperties":false,"properties":{"quantiles":{"additionalProperties":{"$ref":"#/$defs/DecimalString"},"maxProperties":16,"type":"object"},"state":{"enum":["ESTIMATED","UNKNOWN"]}},"required":["state"],"type":"object"},"oodState":{"enum":["IN_DISTRIBUTION","NEAR_BOUNDARY","OUT_OF_DISTRIBUTION","UNKNOWN"]},"parentEvidenceIds":{"$ref":"#/$defs/IdArray"},"predictions":{"items":{"additionalProperties":false,"properties":{"horizonMs":{"minimum":1,"type":"integer"},"quantiles":{"additionalProperties":{"$ref":"#/$defs/DecimalString"},"maxProperties":16,"type":"object"},"target":{"$ref":"#/$defs/ShortString"}},"required":["target","horizonMs","quantiles"],"type":"object"},"maxItems":64,"type":"array"},"receiveTimeMs":{"$ref":"#/$defs/UtcMillis"},"regimeProbabilities":{"additionalProperties":{"maximum":1,"minimum":0,"type":"number"},"maxProperties":16,"type":"object"},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"EdgeAssessmentEnvelopeV1"},"sourceQuality":{"$ref":"#/$defs/QualityFlags"},"strategyFamily":{"$ref":"#/$defs/ShortString"},"traceId":{"$ref":"#/$defs/IdString"},"uncertainty":{"additionalProperties":false,"properties":{"data":{"enum":["LOW","MEDIUM","HIGH","UNKNOWN"]},"epistemic":{"enum":["LOW","MEDIUM","HIGH","UNKNOWN"]},"model":{"enum":["LOW","MEDIUM","HIGH","UNKNOWN"]}},"required":["epistemic","model","data"],"type":"object"},"version":{"const":1}},"required":["schema","version","revision","assessmentId","traceId","parentEvidenceIds","strategyFamily","hypothesisId","instrumentGraph","eventTimeMs","receiveTimeMs","generationTimeMs","expiryTimeMs","predictions","uncertainty","oodState","driftState","netExpectedValue","evidence","lineage","sourceQuality","advisoryAction","abstentionReasonCodes","invalidationConditions","economicAssumptionContext"],"type":"object"},"EdgeBrainHealthV1":{"additionalProperties":false,"properties":{"blockingReasons":{"$ref":"#/$defs/StringArray"},"componentId":{"$ref":"#/$defs/IdString"},"driftState":{"enum":["STABLE","DRIFTING","BROKEN","UNKNOWN"]},"generatedAtMs":{"$ref":"#/$defs/UtcMillis"},"lastErrorCode":{"anyOf":[{"$ref":"#/$defs/UpperSnake"},{"type":"null"}]},"lastSuccessMs":{"$ref":"#/$defs/NullableUtcMillis"},"modelVersions":{"additionalProperties":{"$ref":"#/$defs/ShortString"},"maxProperties":32,"type":"object"},"queueDepth":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"EdgeBrainHealthV1"},"state":{"enum":["OK","DEGRADED","STALE","FAILED","UNKNOWN"]},"truthLabel":{"$ref":"#/$defs/TruthLabel"},"version":{"const":1}},"required":["schema","version","revision","componentId","generatedAtMs","state","truthLabel","blockingReasons"],"type":"object"},"EdgeFeedbackEnvelopeV1":{"additionalProperties":false,"properties":{"assessmentId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"completeness":{"$ref":"#/$defs/Completeness"},"dedupeKey":{"$ref":"#/$defs/IdString"},"deliveredAtMs":{"$ref":"#/$defs/UtcMillis"},"feedbackId":{"$ref":"#/$defs/IdString"},"outcomeId":{"$ref":"#/$defs/IdString"},"payloadHash":{"$ref":"#/$defs/HashHex"},"projection":{"anyOf":[{"maxProperties":64,"type":"object"},{"type":"null"}]},"reconciliationState":{"$ref":"#/$defs/ReconciliationState"},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"EdgeFeedbackEnvelopeV1"},"traceId":{"$ref":"#/$defs/IdString"},"version":{"const":1}},"required":["schema","version","revision","feedbackId","outcomeId","assessmentId","traceId","deliveredAtMs","dedupeKey","payloadHash","completeness","reconciliationState"],"type":"object"},"EdgeOutcomeEnvelopeV1":{"additionalProperties":false,"properties":{"assessmentId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"cohort":{"enum":["ACTED","REJECTED","EXPIRED","MISSED","CONTROL"]},"completeness":{"$ref":"#/$defs/Completeness"},"contentHash":{"$ref":"#/$defs/HashHex"},"costs":{"additionalProperties":false,"properties":{"borrow":{"$ref":"#/$defs/NullableDecimalString"},"fees":{"$ref":"#/$defs/NullableDecimalString"},"funding":{"$ref":"#/$defs/NullableDecimalString"},"interest":{"$ref":"#/$defs/NullableDecimalString"},"latencyMs":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]},"recovery":{"$ref":"#/$defs/NullableDecimalString"},"slippage":{"$ref":"#/$defs/NullableDecimalString"}},"type":"object"},"decisionLineage":{"anyOf":[{"maxProperties":32,"type":"object"},{"type":"null"}]},"excursion":{"additionalProperties":false,"properties":{"mae":{"$ref":"#/$defs/NullableDecimalString"},"mfe":{"$ref":"#/$defs/NullableDecimalString"},"timeToEventMs":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]}},"type":"object"},"fills":{"items":{"additionalProperties":false,"properties":{"fee":{"$ref":"#/$defs/NullableDecimalString"},"price":{"$ref":"#/$defs/DecimalString"},"quantity":{"$ref":"#/$defs/DecimalString"},"timeMs":{"$ref":"#/$defs/UtcMillis"}},"required":["price","quantity","timeMs"],"type":"object"},"maxItems":512,"type":"array"},"labelKind":{"enum":["REAL","HYPOTHETICAL","REPLAY"]},"outcomeId":{"$ref":"#/$defs/IdString"},"pnlAttribution":{"anyOf":[{"maxProperties":32,"type":"object"},{"type":"null"}]},"reconciliationState":{"$ref":"#/$defs/ReconciliationState"},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"EdgeOutcomeEnvelopeV1"},"sourceEventIds":{"$ref":"#/$defs/IdArray"},"sourceRevisions":{"$ref":"#/$defs/StringArray"},"traceId":{"$ref":"#/$defs/IdString"},"version":{"const":1}},"required":["schema","version","revision","outcomeId","traceId","assessmentId","cohort","labelKind","sourceEventIds","costs","completeness","reconciliationState","contentHash"],"type":"object"},"Freshness":{"enum":["FRESH","STALE","UNKNOWN"]},"HashHex":{"pattern":"^[a-f0-9]{16,128}$","type":"string"},"IdArray":{"items":{"$ref":"#/$defs/IdString"},"maxItems":1024,"type":"array"},"IdString":{"pattern":"^[A-Za-z0-9_.:\\-]{1,128}$","type":"string"},"InstrumentGraph":{"additionalProperties":false,"properties":{"borrowAsset":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"canonicalAsset":{"$ref":"#/$defs/ShortString"},"missingLegReason":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"perpSymbol":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"product":{"$ref":"#/$defs/Product"},"spotSymbol":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"symbol":{"$ref":"#/$defs/ShortString"},"venue":{"$ref":"#/$defs/ShortString"}},"required":["venue","product","symbol","canonicalAsset"],"type":"object"},"MarketEvidenceEnvelopeV1":{"additionalProperties":false,"properties":{"evidenceId":{"$ref":"#/$defs/IdString"},"exchangeEventTimeMs":{"$ref":"#/$defs/NullableUtcMillis"},"featureCutoffTimeMs":{"$ref":"#/$defs/NullableUtcMillis"},"instrumentGraph":{"$ref":"#/$defs/InstrumentGraph"},"localReceiveTimeMs":{"$ref":"#/$defs/UtcMillis"},"normalizationTimeMs":{"$ref":"#/$defs/UtcMillis"},"normalizedSchemaHash":{"$ref":"#/$defs/HashHex"},"payload":{"maxProperties":128,"type":"object"},"payloadKind":{"enum":["TRADE","BOOK_TICKER","BOOK_SNAPSHOT","BOOK_DELTA","MARK","INDEX","FUNDING","OPEN_INTEREST","LIQUIDATION","CONTEXT"]},"quality":{"$ref":"#/$defs/QualityFlags"},"rawPayloadHash":{"$ref":"#/$defs/HashHex"},"revision":{"minimum":0,"type":"integer"},"schema":{"const":"MarketEvidenceEnvelopeV1"},"source":{"$ref":"#/$defs/SourceLineage"},"traceId":{"$ref":"#/$defs/IdString"},"truthLabel":{"$ref":"#/$defs/TruthLabel"},"version":{"const":1}},"required":["schema","version","revision","evidenceId","traceId","instrumentGraph","exchangeEventTimeMs","localReceiveTimeMs","normalizationTimeMs","featureCutoffTimeMs","source","rawPayloadHash","normalizedSchemaHash","truthLabel","quality","payloadKind","payload"],"type":"object"},"NullableDecimalString":{"anyOf":[{"$ref":"#/$defs/DecimalString"},{"type":"null"}]},"NullableUtcMillis":{"anyOf":[{"$ref":"#/$defs/UtcMillis"},{"type":"null"}]},"Product":{"enum":["SPOT","USDM_PERP","MARGIN"]},"ProtocolErrorV1":{"additionalProperties":false,"properties":{"code":{"$ref":"#/$defs/UpperSnake"},"component":{"$ref":"#/$defs/ShortString"},"correlationId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"errorId":{"$ref":"#/$defs/IdString"},"message":{"$ref":"#/$defs/ShortString"},"occurredAtMs":{"$ref":"#/$defs/UtcMillis"},"recommendedOperatorAction":{"$ref":"#/$defs/ShortString"},"retryable":{"type":"boolean"},"revision":{"minimum":0,"type":"integer"},"safeCurrentState":{"$ref":"#/$defs/ShortString"},"schema":{"const":"ProtocolErrorV1"},"sourceEnvelopeId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"sourceEnvelopeSchema":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"stage":{"$ref":"#/$defs/ShortString"},"version":{"const":1}},"required":["schema","version","revision","errorId","code","message","occurredAtMs","retryable","component","stage","safeCurrentState","recommendedOperatorAction","correlationId"],"type":"object"},"QualityFlags":{"additionalProperties":false,"properties":{"completeness":{"$ref":"#/$defs/Completeness"},"duplicate":{"type":"boolean"},"freshness":{"$ref":"#/$defs/Freshness"},"gapCount":{"minimum":0,"type":"integer"},"reconstructed":{"type":"boolean"}},"required":["freshness","completeness","gapCount","duplicate","reconstructed"],"type":"object"},"ReconciliationState":{"enum":["EXACT","PENDING","PARTIAL","AMBIGUOUS","DIVERGED","STALE","UNAVAILABLE"]},"ShortString":{"maxLength":256,"minLength":1,"type":"string"},"SourceLineage":{"additionalProperties":false,"properties":{"connectionId":{"$ref":"#/$defs/IdString"},"endpoint":{"anyOf":[{"$ref":"#/$defs/ShortString"},{"type":"null"}]},"sequence":{"anyOf":[{"minimum":0,"type":"integer"},{"type":"null"}]},"sessionId":{"anyOf":[{"$ref":"#/$defs/IdString"},{"type":"null"}]},"sourceType":{"$ref":"#/$defs/ShortString"},"streamClass":{"$ref":"#/$defs/ShortString"}},"required":["sourceType","streamClass","connectionId"],"type":"object"},"StringArray":{"items":{"$ref":"#/$defs/ShortString"},"maxItems":256,"type":"array"},"TruthLabel":{"enum":["LIVE","REPLAY","SYNTHETIC"]},"UpperSnake":{"pattern":"^[A-Z][A-Z0-9_]{0,99}$","type":"string"},"UtcMillis":{"maximum":4102444800000,"minimum":1262304000000,"type":"integer"}},"$id":"edge-protocol-v1","$schema":"https://json-schema.org/draft/2020-12/schema","title":"EDGE_PROTOCOL_V1 — frozen Q/L interchange (see EDGE_PROTOCOL_V1.md)"};
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
const FORBIDDEN = [
  'signature', 'apikey', 'apisecret', 'secret', 'passphrase', 'password',
  'privatekey', 'listenkey', 'credential', 'approvedcapital', 'orderrequest',
  'leveragemutation', 'livesendpermission',
];
const WRAPPER_FIELDS = ['generatedAtMs', 'operation', 'payload', 'requestId', 'schema', 'version'];
const ASSESSMENT_REQUIRED = [
  'schema', 'version', 'revision', 'assessmentId', 'traceId', 'parentEvidenceIds',
  'strategyFamily', 'hypothesisId', 'instrumentGraph', 'eventTimeMs', 'receiveTimeMs',
  'generationTimeMs', 'expiryTimeMs', 'predictions', 'uncertainty', 'oodState',
  'driftState', 'netExpectedValue', 'evidence', 'lineage', 'sourceQuality',
  'advisoryAction', 'abstentionReasonCodes', 'invalidationConditions',
  'economicAssumptionContext',
];
const ASSESSMENT_ALLOWED = [...ASSESSMENT_REQUIRED,
  'analogues', 'capacityEvidence', 'costEstimates', 'featureAttribution', 'grossEstimate',
  'marketStageProbabilities', 'regimeProbabilities'];
const ERROR_REQUIRED = [
  'schema', 'version', 'revision', 'errorId', 'code', 'message', 'occurredAtMs',
  'retryable', 'component', 'stage', 'safeCurrentState', 'recommendedOperatorAction',
  'correlationId',
];
const ERROR_ALLOWED = [...ERROR_REQUIRED, 'sourceEnvelopeSchema', 'sourceEnvelopeId'];
const READ_FIELDS = {
  HEALTH: [
    'EdgeBrainHealthV1',
    ['schema', 'version', 'revision', 'componentId', 'generatedAtMs', 'state',
      'truthLabel', 'blockingReasons'],
    ['schema', 'version', 'revision', 'componentId', 'generatedAtMs', 'state',
      'truthLabel', 'blockingReasons', 'lastSuccessMs', 'lastErrorCode', 'queueDepth',
      'modelVersions', 'driftState'],
  ],
  READINESS: [
    'Q16ReadinessV1',
    ['advisoryReady', 'blockingReasonCodes', 'limits', 'modelReadiness', 'processReady',
      'safeFallback', 'schema', 'serviceability', 'version'],
    ['advisoryReady', 'blockingReasonCodes', 'limits', 'modelReadiness', 'processReady',
      'safeFallback', 'schema', 'serviceability', 'version'],
  ],
  LINEAGE: [
    'Q16ServingLineageV1',
    ['calibrationAvailable', 'calibrationRevision', 'champion', 'deepGate',
      'dependencyLockSha256', 'manifestSha256', 'readiness', 'schema', 'shadowModelIds',
      'streaming', 'version'],
    ['calibrationAvailable', 'calibrationRevision', 'champion', 'deepGate',
      'dependencyLockSha256', 'manifestSha256', 'readiness', 'schema', 'shadowModelIds',
      'streaming', 'version'],
  ],
  METRICS: [
    'Q16ServiceMetricsV1',
    ['abstentions', 'accepted', 'completed', 'protocolErrors', 'queueDepth',
      'queueRejections', 'schema', 'serviceClosedRejections', 'timeouts',
      'transportErrors', 'version'],
    ['abstentions', 'accepted', 'completed', 'protocolErrors', 'queueDepth',
      'queueRejections', 'schema', 'serviceClosedRejections', 'timeouts',
      'transportErrors', 'version'],
  ],
};

function fail(message) { throw new Error(message); }
function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}
function resolveRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) fail('external schema ref');
  let node = FROZEN_SCHEMA;
  for (const part of ref.slice(2).split('/')) {
    if (!node || typeof node !== 'object' || !(part in node)) fail('unresolved schema ref');
    node = node[part];
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) fail('malformed schema ref');
  return node;
}
function schemaErrors(schema, value, trail) {
  if ('$ref' in schema) return schemaErrors(resolveRef(schema.$ref), value, trail);
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map((branch) => schemaErrors(branch, value, trail));
    return branches.some((branch) => branch.length === 0) ? [] : [`${trail}: no anyOf`];
  }
  const errors = [];
  if ('const' in schema && value !== schema.const) errors.push(`${trail}: const`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${trail}: enum`);
  const observed = jsonType(value);
  if (
    typeof schema.type === 'string'
    && observed !== schema.type
    && !(schema.type === 'number' && (observed === 'integer' || observed === 'number'))
  ) return [...errors, `${trail}: type`];
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string') {
      const expression = new RegExp(`^(?:${schema.pattern})$`, 'u');
      if (!expression.test(value)) errors.push(`${trail}: pattern`);
    }
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${trail}: short`);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${trail}: long`);
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${trail}: low`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${trail}: high`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${trail}: too many`);
    }
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((item, index) => {
        errors.push(...schemaErrors(schema.items, item, `${trail}[${index}]`));
      });
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (Number.isInteger(schema.maxProperties) && keys.length > schema.maxProperties) {
      errors.push(`${trail}: too many keys`);
    }
    if (Array.isArray(schema.required)) {
      schema.required.forEach((key) => {
        if (!(key in value)) errors.push(`${trail}: missing ${key}`);
      });
    }
    keys.forEach((key) => {
      if (schema.properties && key in schema.properties) {
        errors.push(...schemaErrors(schema.properties[key], value[key], `${trail}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${trail}: unknown ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...schemaErrors(schema.additionalProperties, value[key], `${trail}.${key}`));
      }
    });
  }
  return errors;
}
function validateFrozenEnvelope(value) {
  const body = FROZEN_SCHEMA.$defs && FROZEN_SCHEMA.$defs[value.schema];
  if (!body || typeof body !== 'object') fail('frozen envelope schema is unregistered');
  const errors = schemaErrors(body, value, '$');
  if (errors.length) fail(`frozen envelope validation failed: ${errors.slice(0, 4).join('; ')}`);
}
function exact(value, allowed, required) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
    fail('response fields are not schema-exact');
  }
}
function integer(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be a non-negative safe integer`);
  }
  return value;
}
function identifier(value, field) {
  if (typeof value !== 'string' || !value.length || value.length > 256) {
    fail(`${field} must be bounded non-empty text`);
  }
  return value;
}
function walk(value, depth = 0) {
  if (depth > 64) fail('response nesting exceeds the client limit');
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, depth + 1));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (FORBIDDEN.some((token) => normalized.includes(token))) {
        fail('response contains a forbidden authority or secret key');
      }
      walk(item, depth + 1);
    });
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('response contains an unsafe number');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      fail('response integer exceeds safe range');
    }
  }
}

export function strictParse(text) {
  if (typeof text !== 'string' || !text.length) fail('response is not strict JSON');
  let index = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(text[index] || '')) index += 1; };
  const parseString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          fail('response string is malformed');
        }
      }
      if (text[index] === '\\') index += 1;
      index += 1;
    }
    return fail('response string is incomplete');
  };
  const parseNumber = () => {
    const match = text.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) return fail('response number is malformed');
    index += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number) || Object.is(number, -0)) fail('response number is unsafe');
    if (!match[0].match(/[.eE]/) && !Number.isSafeInteger(number)) {
      fail('response integer exceeds safe range');
    }
    return number;
  };
  const parseValue = (depth = 0) => {
    if (depth > 64) fail('response nesting exceeds the client limit');
    whitespace();
    if (text[index] === '"') return parseString();
    if (text[index] === '[') {
      const result = [];
      index += 1;
      whitespace();
      if (text[index] === ']') { index += 1; return result; }
      while (true) {
        result.push(parseValue(depth + 1));
        whitespace();
        if (text[index] === ']') { index += 1; return result; }
        if (text[index] !== ',') fail('response array is malformed');
        index += 1;
      }
    }
    if (text[index] === '{') {
      const result = {};
      const seen = new Set();
      index += 1;
      whitespace();
      if (text[index] === '}') { index += 1; return result; }
      while (true) {
        whitespace();
        if (text[index] !== '"') fail('response object key is malformed');
        const key = parseString();
        if (seen.has(key)) fail('response contains a duplicate JSON key');
        seen.add(key);
        whitespace();
        if (text[index] !== ':') fail('response object is malformed');
        index += 1;
        result[key] = parseValue(depth + 1);
        whitespace();
        if (text[index] === '}') { index += 1; return result; }
        if (text[index] !== ',') fail('response object is malformed');
        index += 1;
      }
    }
    for (const [token, value] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, index)) { index += token.length; return value; }
    }
    return parseNumber();
  };
  const result = parseValue();
  whitespace();
  if (index !== text.length) fail('response has trailing non-whitespace data');
  walk(result);
  return result;
}

export function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const pairs = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
    return `{${pairs.join(',')}}`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('non-finite or negative-zero number');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail('unsafe integer Number');
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('unsupported request value');
  return encoded;
}

function validateError(value) {
  validateFrozenEnvelope(value);
  exact(value, ERROR_ALLOWED, ERROR_REQUIRED);
  if (value.schema !== 'ProtocolErrorV1' || value.version !== 1) {
    fail('protocol error schema/version is unsupported');
  }
  integer(value.revision, 'revision');
  integer(value.occurredAtMs, 'occurredAtMs');
  identifier(value.errorId, 'errorId');
  identifier(value.code, 'code');
  if (typeof value.retryable !== 'boolean') fail('retryable must be boolean');
}
function validateProbabilities(value, field) {
  if (value === undefined || value === null) return;
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length > 16
  ) {
    fail(`${field} must be a bounded object`);
  }
  Object.values(value).forEach((probability) => {
    if (typeof probability !== 'number' || probability < 0 || probability > 1) {
      fail(`${field} values must be probabilities`);
    }
  });
}
function validateAssessment(value) {
  validateFrozenEnvelope(value);
  exact(value, ASSESSMENT_ALLOWED, ASSESSMENT_REQUIRED);
  if (value.schema !== 'EdgeAssessmentEnvelopeV1' || value.version !== 1) {
    fail('assessment schema/version is unsupported');
  }
  ['revision', 'receiveTimeMs', 'generationTimeMs', 'expiryTimeMs'].forEach(
    (field) => integer(value[field], field),
  );
  ['assessmentId', 'traceId', 'strategyFamily', 'hypothesisId'].forEach(
    (field) => identifier(value[field], field),
  );
  const actions = ['IGNORE', 'WATCH', 'FOCUS', 'PROPOSE_CONSIDERATION', 'ABSTAIN_UNKNOWN'];
  if (!actions.includes(value.advisoryAction)) {
    fail('assessment advisoryAction is unsupported');
  }
  if (
    !Array.isArray(value.abstentionReasonCodes)
    || value.abstentionReasonCodes.some((item) => typeof item !== 'string')
  ) {
    fail('assessment abstentionReasonCodes must be text');
  }
  if (value.advisoryAction === 'ABSTAIN_UNKNOWN' && !value.abstentionReasonCodes.length) {
    fail('ABSTAIN_UNKNOWN requires at least one reason');
  }
  if (!Array.isArray(value.predictions) || value.predictions.length > 64) {
    fail('assessment predictions must be bounded');
  }
  validateProbabilities(value.marketStageProbabilities, 'marketStageProbabilities');
  validateProbabilities(value.regimeProbabilities, 'regimeProbabilities');
  if (
    !value.netExpectedValue || typeof value.netExpectedValue !== 'object'
    || Array.isArray(value.netExpectedValue)
  ) {
    fail('assessment netExpectedValue must be an object');
  }
  if (!['ESTIMATED', 'UNKNOWN'].includes(value.netExpectedValue.state)) {
    fail('netExpectedValue state is unsupported');
  }
  const evidence = value.evidence;
  const quality = value.sourceQuality;
  const ambiguous = (
    value.netExpectedValue.state !== 'ESTIMATED'
    || !value.predictions.length
    || value.abstentionReasonCodes.length > 0
    || value.oodState !== 'IN_DISTRIBUTION'
    || value.driftState !== 'STABLE'
    || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || Boolean(evidence && evidence.conflicting && evidence.conflicting.length)
    || Boolean(evidence && evidence.missing && evidence.missing.length)
    || !quality || typeof quality !== 'object' || Array.isArray(quality)
    || quality.freshness !== 'FRESH'
    || quality.completeness !== 'COMPLETE'
    || quality.gapCount !== 0
  );
  if (ambiguous && value.advisoryAction !== 'ABSTAIN_UNKNOWN') {
    fail('unavailable or ambiguous truth requires ABSTAIN_UNKNOWN');
  }
}
function validateReadPayload(operation, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('read response payload must be an object');
  }
  const [schema, required, allowed] = READ_FIELDS[operation];
  exact(value, allowed, required);
  if (value.schema !== schema || value.version !== 1) {
    fail('read response payload schema/version is unsupported');
  }
  if (operation === 'HEALTH') {
    validateFrozenEnvelope(value);
    integer(value.revision, 'revision');
    integer(value.generatedAtMs, 'generatedAtMs');
    if (!['OK', 'DEGRADED', 'STALE', 'FAILED', 'UNKNOWN'].includes(value.state)) {
      fail('health state is unsupported');
    }
  } else if (operation === 'READINESS') {
    if (typeof value.processReady !== 'boolean' || typeof value.advisoryReady !== 'boolean') {
      fail('readiness booleans are malformed');
    }
    if (value.safeFallback !== 'ABSTAIN_UNKNOWN') fail('readiness fallback is unsafe');
  } else if (operation === 'LINEAGE') {
    if (typeof value.calibrationAvailable !== 'boolean') {
      fail('calibrationAvailable must be boolean');
    }
    if (value.streaming !== 'NOT_JUSTIFIED') fail('lineage streaming state is unsupported');
  } else {
    const counters = [
      'abstentions', 'accepted', 'completed', 'protocolErrors', 'queueDepth',
      'queueRejections', 'serviceClosedRejections', 'timeouts', 'transportErrors',
    ];
    counters.forEach((field) => integer(value[field], field));
  }
}

export function validateResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('response must be a JSON object');
  }
  walk(value);
  if (value.schema === 'ProtocolErrorV1') { validateError(value); return value; }
  exact(value, WRAPPER_FIELDS, WRAPPER_FIELDS);
  if (value.schema !== 'Q16LocalInferenceResponseV1' || value.version !== 1) {
    fail('local response schema/version is unsupported');
  }
  const operations = ['ASSESS', 'BATCH_ASSESS', 'HEALTH', 'READINESS', 'LINEAGE', 'METRICS'];
  if (!operations.includes(value.operation)) {
    fail('local response operation is unsupported');
  }
  integer(value.generatedAtMs, 'generatedAtMs');
  identifier(value.requestId, 'requestId');
  if (value.operation === 'ASSESS') {
    if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
      fail('ASSESS payload must be an object');
    }
    validateAssessment(value.payload);
  } else if (value.operation === 'BATCH_ASSESS') {
    if (!Array.isArray(value.payload) || !value.payload.length || value.payload.length > 256) {
      fail('BATCH_ASSESS payload must be bounded');
    }
    value.payload.forEach(validateAssessment);
  } else {
    validateReadPayload(value.operation, value.payload);
  }
  return value;
}

export function requestBytes(socketPath, payloadBytes, maximumBytes = 262144, timeoutMs = 2000) {
  if (!(payloadBytes instanceof Uint8Array)) fail('request bytes must be Uint8Array');
  const raw = Buffer.from(payloadBytes);
  if (!raw.length || raw.length > maximumBytes) fail('request exceeds bounded local frame');
  if (raw.includes(13) || raw.subarray(0, -1).includes(10)) {
    fail('request bytes must contain exactly one JSON frame');
  }
  const framed = raw.at(-1) === 10 ? raw : Buffer.concat([raw, Buffer.from('\n')]);
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ path: socketPath });
    let received = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      client.destroy();
      if (error) reject(error); else resolve(value);
    };
    client.setTimeout(timeoutMs, () => finish(new Error('local inference request timed out')));
    client.on('connect', () => client.write(framed));
    client.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length > maximumBytes) {
        return finish(new Error('response exceeds bounded local frame'));
      }
      const newline = received.indexOf(10);
      if (newline >= 0) {
        if (newline !== received.length - 1) {
          return finish(new Error('server returned multiple response frames'));
        }
        try {
          const text = STRICT_UTF8.decode(received.subarray(0, -1));
          const value = strictParse(text);
          return finish(null, validateResponse(value));
        } catch (error) {
          return finish(error);
        }
      }
      return undefined;
    });
    client.on('error', (error) => finish(error));
    client.on('end', () => {
      if (!settled) finish(new Error('incomplete response frame'));
    });
  });
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function readRequestFile(payloadPath, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    fail('maximumBytes must be a positive safe integer');
  }
  const before = fs.lstatSync(payloadPath, { bigint: true });
  if (!before.isFile()) fail('raw request path must resolve to a regular file');
  if (before.size <= 0n || before.size > BigInt(maximumBytes)) {
    fail('raw request file exceeds bounded local frame');
  }
  const noFollow = fs.constants.O_NOFOLLOW;
  const nonBlocking = fs.constants.O_NONBLOCK;
  if (!Number.isInteger(noFollow) || !Number.isInteger(nonBlocking)) {
    fail('safe raw request file admission is unsupported on this platform');
  }
  let descriptor;
  try {
    descriptor = fs.openSync(payloadPath, fs.constants.O_RDONLY | noFollow | nonBlocking);
  } catch (error) {
    throw new Error(`raw request file changed during admission: ${error}`);
  }
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) fail('raw request path must resolve to a regular file');
    if (!sameFileIdentity(before, opened)) fail('raw request file changed during admission');
    const raw = Buffer.alloc(Number(opened.size) + 1);
    let total = 0;
    while (total < raw.length) {
      const count = fs.readSync(descriptor, raw, total, raw.length - total, null);
      if (count === 0) break;
      total += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(opened, after) || total !== Number(opened.size)) {
      fail('raw request file changed during admission');
    }
    return raw.subarray(0, total);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function requestFile(socketPath, payloadPath, maximumBytes = 262144, timeoutMs = 2000) {
  return requestBytes(
    socketPath,
    readRequestFile(payloadPath, maximumBytes),
    maximumBytes,
    timeoutMs,
  );
}

export function request(socketPath, payload, maximumBytes = 262144, timeoutMs = 2000) {
  const raw = Buffer.from(canonicalStringify(payload), 'utf8');
  return requestBytes(socketPath, raw, maximumBytes, timeoutMs);
}
