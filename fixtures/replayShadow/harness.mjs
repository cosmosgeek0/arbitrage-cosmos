/**
 * RUN-17 pure reference-plan compiler.
 *
 * This module validates data and materializes bounded schedule windows. It has
 * no runner, timer, transport, process, persistence, fault evaluator, or
 * candidate verdict. Owner adapters and heavy execution remain external.
 */

import { createHash } from 'node:crypto';

export const REPLAY_SHADOW_COVERAGE = Object.freeze([
  'REPLAY_DATASET',
  'LATENCY_DEFINITION',
  'LOAD_DEFINITION',
  'SOAK_DEFINITION',
  'RESTART_STORM',
  'PARTIAL_FILL_AMBIGUITY',
  'STALE_DATA',
  'CONNECTION_LOSS',
  'RATE_LIMIT',
  'CLOCK_SKEW',
  'RECOVERY_CAMPAIGN',
]);

export const REPLAY_SHADOW_REQUIRED_LIMITATIONS = Object.freeze([
  'NO_CANDIDATE_BINDING',
  'NO_THRESHOLDS_OR_VERDICTS',
  'NO_NETWORK_OR_PROCESS_MUTATION',
  'NO_REAL_CREDENTIALS_OR_ENDPOINTS',
  'NO_HOST_TIMING_MEASURED',
  'HEAVY_EXECUTION_DEFERRED_POST_C2_OTHER_MACHINE',
  'OWNER_ADAPTERS_UNMOUNTED',
  'RAW_OBSERVATIONS_REQUIRE_FAIL_CLOSED_ADAPTATION',
  'NINTH_RESTART_ATTEMPT_IS_HOSTILE_POLICY_VIOLATION',
  'CAMPAIGN_TAIL_DRAIN_SEMANTICS_UNRATIFIED',
  'SIX_HOUR_SOAK_IS_DEFINITION_ONLY',
  'SYNTHETIC_CORPUS_IS_NOT_PRODUCTION_EVIDENCE',
]);

export const REPLAY_SHADOW_LIMITS = Object.freeze({
  maximumDatasets: 64,
  maximumEventsPerDataset: 128,
  maximumFaultReferences: 128,
  maximumCampaigns: 32,
  maximumPhasesPerCampaign: 16,
  maximumIterationsPerPhase: 1_000_000,
  maximumSubjects: 1_024,
  maximumInFlight: 1_024,
  maximumMeasurementDurationMs: 72 * 60 * 60 * 1_000,
  maximumPlanWindow: 1_024,
  maximumJsonDepth: 24,
  maximumJsonNodes: 100_000,
  maximumArrayLength: 10_000,
  maximumObjectKeys: 256,
  maximumStringLength: 262_144,
});

const CORPUS_KEYS = Object.freeze([
  'schema',
  'schemaVersion',
  'packetId',
  'disposition',
  'executionAuthority',
  'candidateBinding',
  'heavyExecution',
  'requiredCoverage',
  'datasets',
  'faultRefs',
  'campaigns',
  'limitations',
]);
const DATASET_KEYS = Object.freeze([
  'datasetId',
  'title',
  'ownerReference',
  'sourceKind',
  'coverage',
  'eventTimeUnit',
  'eventTape',
  'evidenceRequests',
]);
const OWNER_REFERENCE_KEYS = Object.freeze(['owner', 'ownerPath', 'ownerId']);
const EVENT_KEYS = Object.freeze(['sequence', 'atOffsetMs', 'channel', 'type', 'facts']);
const FAULT_REFERENCE_KEYS = Object.freeze([
  'faultRefId',
  'owner',
  'ownerPath',
  'scenarioId',
  'coverage',
]);
const CAMPAIGN_KEYS = Object.freeze([
  'campaignId',
  'kind',
  'datasetIds',
  'faultRefIds',
  'executionState',
  'schedule',
  'measurementRequests',
  'coverage',
]);
const SCHEDULE_KEYS = Object.freeze([
  'clock',
  'measurementClock',
  'iterationUnit',
  'measurementDurationMs',
  'phases',
]);
const PHASE_KEYS = Object.freeze([
  'phaseId',
  'startOffsetMs',
  'virtualDurationMs',
  'iterations',
  'subjectCount',
  'maxInFlight',
  'pace',
  'datasetMix',
  'faultSchedule',
]);
const FAULT_SCHEDULE_KEYS = Object.freeze(['atIteration', 'faultRefId']);
const PLAN_KEYS = Object.freeze([
  'schema',
  'schemaVersion',
  'packetId',
  'disposition',
  'executionAuthority',
  'candidateBinding',
  'corpusContentSha256',
  'campaignId',
  'kind',
  'executionState',
  'clock',
  'measurementClock',
  'iterationUnit',
  'measurementDurationMs',
  'totalIterations',
  'datasetIds',
  'faultRefIds',
  'measurementRequests',
  'coverage',
  'phases',
]);
const COMPILED_PHASE_KEYS = Object.freeze([
  'phaseId',
  'startOffsetMs',
  'virtualDurationMs',
  'iterations',
  'startOrdinal',
  'endOrdinalExclusive',
  'subjectCount',
  'maxInFlight',
  'pace',
  'datasetMix',
  'faultSchedule',
]);
const FRAME_KEYS = Object.freeze([
  'ordinal',
  'campaignId',
  'correlationRef',
  'phaseId',
  'scheduledOffsetMs',
  'dispatchCondition',
  'subjectOrdinal',
  'subjectPredecessorOrdinal',
  'admissionSlotOrdinal',
  'admissionPredecessorOrdinal',
  'repetition',
  'datasetId',
  'faultRefId',
  'faultInjectionPoint',
]);

const DATASET_ID_PATTERN = /^RS-DATA-[A-Z0-9-]{3,80}$/;
const FAULT_ID_PATTERN = /^RS-F-[A-Z0-9-]{3,80}$/;
const CAMPAIGN_ID_PATTERN = /^RS-CAMPAIGN-[A-Z0-9-]{3,80}$/;
const TOKEN_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const PHASE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,95}$/;
const SOURCE_KINDS = new Set(['ADAPTED_OWNER_FIXTURE', 'SYNTHETIC_STIMULUS_TAPE']);
const CAMPAIGN_KINDS = new Set(['LATENCY', 'LOAD', 'SOAK', 'FAILURE', 'RECOVERY']);
const PACES = new Set(['CLOSED_LOOP', 'OPEN_ARRIVAL_RATE']);
const ITERATION_UNIT = 'COMPLETE_DATASET_TAPE';
const RECOVERY_TEMPLATE_DATASET_ID = 'RS-DATA-RECOVERY-001';
const FAULT_INJECTION_POINT = 'BEFORE_TAPE_DISPATCH_FOR_FRAME_SUBJECT';
const DISPATCH_CONDITIONS = new Set(['VIRTUAL_OFFSET', 'AFTER_PREDECESSORS_COMPLETED']);
const FORBIDDEN_RESULT_KEYS = /^(?:(?:candidate|tested|base|head)(?:[A-Z0-9_].*)?|source(?:Commit|Sha|Hash|Tree)(?:[A-Z0-9_].*)?|branch(?:[A-Z0-9_].*)?|target(?:Route|Module|Path)(?:[A-Z0-9_].*)?|expected(?:[A-Z0-9_].*)?|threshold(?:[A-Z0-9_].*)?|verdict(?:[A-Z0-9_].*)?|passed|failed|success|healthy|green|acceptance(?:[A-Z0-9_].*)?|release(?:[A-Z0-9_].*)?|slo(?:[A-Z0-9_].*)?)$/i;
const FORBIDDEN_RESULT_VALUES = new Set([
  'PASS',
  'FAIL',
  'PASSED',
  'FAILED',
  'SUCCESS',
  'SUCCEEDED',
  'READY',
  'HEALTHY',
  'GREEN',
  'ACCEPTED',
  'VERIFIED_CANDIDATE',
  'REJECTED_CANDIDATE',
  'INTEGRATION_CANDIDATE_READY',
  'LIVE_PUBLIC',
  'LIVE_PRIVATE',
  'DEPLOYED',
]);
const FORBIDDEN_CANDIDATE_IDENTITY = /(?:(?<![A-Za-z0-9_.])[0-9a-f]{7,40}(?![A-Za-z0-9_.])|(?<![A-Za-z0-9_.])[0-9a-f]{64}(?![A-Za-z0-9_.])|sha256:[0-9a-f]{64}\b|refs\/heads\/|\bcurrent-main\b)/i;
const FORBIDDEN_CANDIDATE_ASSERTION = /\bcandidate\s+(?:passed|failed|succeeded|ready|healthy|accepted|rejected|deployed)\b/i;

const EVENT_FACT_KEYS = Object.freeze({
  SOURCE_SAMPLE: ['sourceRef', 'sourceTimeMs', 'receivedAtMs', 'evaluatedAtMs', 'maxAgeMs', 'completeness'],
  CONNECTION_OPENED: ['generation', 'processSession'],
  PING_FRAME_OBSERVED: ['generation', 'payloadRef'],
  PONG_FRAME_OBSERVED: ['generation', 'payloadRef'],
  SERVER_SHUTDOWN_NOTICE: ['generation'],
  CLOSE_FRAME_OBSERVED: ['generation', 'closeFrameReceived', 'localCloseCode', 'remoteCloseCode'],
  FIRST_DATA_OBSERVED: ['generation', 'sourceSequence'],
  UNDERLYING_TRANSPORT_LOST: ['generation', 'closeFrameReceived', 'localCloseCode', 'remoteCloseCode'],
  RESTART_REQUEST_RECORDED: [
    'attempt', 'generation', 'subjectRef', 'stormCorrelationRef',
    'delayBeforeAttemptMs', 'jitterMs', 'trigger',
  ],
  RESTART_STORM_TERMINAL_OBSERVATION: [
    'subjectRef', 'stormCorrelationRef', 'attemptsObserved', 'terminalObservation',
  ],
  DEPENDENT_RESTART_REQUEST_RECORDED: [
    'attempt', 'generation', 'subjectRef', 'stormCorrelationRef', 'dependencyRef', 'trigger',
  ],
  EVIDENCE_WINDOW_OPENED: [
    'operationRef', 'planRef', 'phase', 'legRef', 'venue', 'symbol',
    'clientOrderId', 'venueOrderId', 'side', 'intendedQuantity', 'processSession',
  ],
  EXECUTION_REPORT_OBSERVED: [
    'operationRef', 'planRef', 'phase', 'legRef', 'venue', 'symbol',
    'clientOrderId', 'venueOrderId', 'side', 'intendedQuantity', 'executionId', 'tradeId',
    'reportSequence', 'connectionGeneration', 'reportSession',
    'executionType', 'orderStatus', 'lastQuantity', 'cumulativeQuantity',
    'lastPrice', 'transactionTimeMs', 'sourceId', 'sourceAuthority',
    'sourceCompleteness', 'sourceTimeMs', 'receivedAtMs', 'maxAgeMs',
    'coverageStartMs', 'coverageEndMs',
  ],
  PROCESS_SESSION_CHANGED: ['priorSession', 'currentSession', 'priorTimeOriginMs', 'currentTimeOriginMs'],
  LOOKUP_EVIDENCE_UNAVAILABLE: [
    'operationRef', 'planRef', 'phase', 'legRef', 'venue', 'symbol',
    'clientOrderId', 'venueOrderId', 'side', 'intendedQuantity', 'sourceId', 'sourceAuthority',
    'sourceCompleteness', 'sourceTimeMs', 'receivedAtMs', 'maxAgeMs',
    'coverageStartMs', 'coverageEndMs', 'orders', 'fills', 'positions',
  ],
  EXECUTION_REPORT_DUPLICATE: [
    'operationRef', 'planRef', 'phase', 'legRef', 'venue', 'symbol',
    'clientOrderId', 'venueOrderId', 'side', 'intendedQuantity', 'executionId', 'tradeId',
    'reportSequence', 'connectionGeneration', 'reportSession', 'cumulativeQuantity',
  ],
  WEIGHT_HEADER_OBSERVED: [
    'protocol', 'providerRef', 'budgetRef', 'policyRevision', 'interval', 'usedWeight', 'declaredLimit',
  ],
  STATUS_OBSERVED: [
    'protocol', 'providerRef', 'budgetRef', 'policyRevision', 'statusCode', 'retryAfterMs', 'serverTimeMs',
  ],
  STREAM_CONTROL_BURST_OBSERVED: [
    'protocol', 'providerRef', 'budgetRef', 'policyRevision', 'windowMs', 'controlMessages', 'documentedLimit',
  ],
  COOLDOWN_WINDOW_ELAPSED: [
    'protocol', 'providerRef', 'budgetRef', 'policyRevision', 'declaredRetryAfterMs', 'observedElapsedMs',
  ],
  CLOCK_SAMPLE: [
    'processSession', 'sourceTime', 'sourceTimeUnit', 'receiptWallTimeMs', 'receiptMonotonicNs',
  ],
  FAULT_DETECTED: [
    'faultRefParameter', 'campaignRefParameter', 'correlationRefParameter', 'evidenceOwner', 'processSession',
  ],
  CONTAINMENT_REQUEST_RECORDED: [
    'campaignRefParameter', 'correlationRefParameter', 'evidenceOwner', 'authorityReceiptRef',
  ],
  CHECKPOINT_REFERENCE_OBSERVED: [
    'campaignRefParameter', 'correlationRefParameter', 'evidenceOwner',
    'checkpointRef', 'checkpointRevision', 'checkpointBytes',
  ],
  RECOVERY_PROCESS_SESSION_CHANGED: [
    'campaignRefParameter', 'correlationRefParameter', 'evidenceOwner',
    'priorSession', 'currentSession', 'priorTimeOriginMs', 'currentTimeOriginMs',
  ],
  READBACK_UNAVAILABLE: [
    'campaignRefParameter', 'correlationRefParameter', 'evidenceOwner', 'externalState', 'durableState',
  ],
  POSTCONDITION_SAMPLE: [
    'campaignRefParameter', 'correlationRefParameter', 'evidenceOwner',
    'sampleOrdinal', 'independentObserverRef', 'observedState',
  ],
  QUIET_PERIOD_SAMPLE: [
    'campaignRefParameter', 'correlationRefParameter', 'evidenceOwner',
    'sampleOrdinal', 'independentObserverRef', 'observedState',
  ],
  MONOTONIC_INTERVAL: [
    'processSession', 'timeOriginMs', 'startMonotonicNs', 'endMonotonicNs', 'sourceWallTimeMs',
  ],
  FRAME_OBSERVED: ['streamRef', 'sourceSequence', 'sourceTimeMs', 'receivedAtMs'],
  FRAME_DUPLICATE_OBSERVED: ['streamRef', 'sourceSequence', 'sourceTimeMs', 'receivedAtMs'],
  CAPTURE_WINDOW_DECLARED: ['retainedCapacity', 'observedCount', 'droppedCount'],
  CAPTURE_ITEM_OBSERVED: ['itemSequence'],
  CAPTURE_WINDOW_OBSERVED: ['retainedCapacity', 'observedCount', 'retainedCount', 'droppedCount'],
  BASELINE_OBSERVATION_WINDOW_OPENED: ['observerRef', 'processSession'],
  BASELINE_SOURCE_READBACK_OBSERVED: [
    'observerRef', 'processSession', 'sourceRef', 'observationRef',
    'sourceTimeMs', 'receivedAtMs',
  ],
  BASELINE_OBSERVATION_WINDOW_CLOSED: ['observerRef', 'processSession', 'observationCount'],
});

const DECIMAL_FACT_PATTERN = /^(?:0|[1-9][0-9]{0,39})\.[0-9]{8}$/;
const DIGITS_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const EVENT_FACT_ENUMS = Object.freeze({
  completeness: new Set(['COMPLETE', 'UNKNOWN']),
  executionType: new Set(['TRADE']),
  orderStatus: new Set(['PARTIALLY_FILLED']),
  phase: new Set(['OPEN']),
  venue: new Set(['BINANCE_SPOT', 'BINANCE_USDM']),
  side: new Set(['BUY', 'SELL']),
  sourceAuthority: new Set(['SYNTHETIC_TEST', 'UNAVAILABLE']),
  sourceCompleteness: new Set(['PARTIAL', 'UNAVAILABLE']),
  interval: new Set(['MINUTE']),
  sourceTimeUnit: new Set(['MILLISECOND', 'MICROSECOND']),
  observedState: new Set(['UNKNOWN', 'UNAVAILABLE']),
  protocol: new Set(['REST_HTTP', 'WEBSOCKET_STREAM']),
  trigger: new Set(['SYNTHETIC_FAILURE_OBSERVED']),
  terminalObservation: new Set(['UNKNOWN']),
  faultRefParameter: new Set(['FRAME_FAULT_REF_ID']),
  campaignRefParameter: new Set(['FRAME_CAMPAIGN_ID']),
  correlationRefParameter: new Set(['FRAME_CORRELATION_REF']),
  evidenceOwner: new Set([
    'PRODUCT_ASSURANCE_FAULT_OWNER',
    'FOUNDATION_CONTROL_OWNER',
    'SYSTEM_INTEGRATION_PERSISTENCE_OWNER',
    'INTELLIGENCE_RUNTIME_LIFECYCLE_OWNER',
    'PRODUCT_ASSURANCE_REMEDIATION_OWNER',
  ]),
});

function fail(code, path = '$') {
  throw new TypeError(`${code}:${path}`);
}

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value, path) {
  if (!isPlainRecord(value)) fail('PLAIN_RECORD_REQUIRED', path);
  return value;
}

function requireExactKeys(value, expected, path) {
  const actual = Object.keys(requireRecord(value, path)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('EXACT_KEYS_REQUIRED', path);
  }
}

function requireString(value, path, pattern = null) {
  if (typeof value !== 'string' || value.length === 0 || value.length > REPLAY_SHADOW_LIMITS.maximumStringLength) {
    fail('NONEMPTY_BOUNDED_STRING_REQUIRED', path);
  }
  if (pattern !== null && !pattern.test(value)) fail('STRING_PATTERN_INVALID', path);
  return value;
}

function requireInteger(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) {
    fail('BOUNDED_SAFE_INTEGER_REQUIRED', path);
  }
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== 'boolean') fail('BOOLEAN_REQUIRED', path);
  return value;
}

function requireNull(value, path) {
  if (value !== null) fail('NULL_REQUIRED', path);
  return value;
}

function requireNullableInteger(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value !== null) requireInteger(value, path, minimum, maximum);
  return value;
}

function requireNullableString(value, path, pattern = null) {
  if (value !== null) requireString(value, path, pattern);
  return value;
}

function requireEnum(value, path, allowed) {
  requireString(value, path);
  if (!allowed.has(value)) fail('VALUE_OUTSIDE_CLOSED_SET', path);
  return value;
}

function requireArray(value, path, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail('BOUNDED_ARRAY_REQUIRED', path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === 'symbol') fail('SYMBOL_KEY_FORBIDDEN', path);
    if (key === 'length') continue;
    if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
      fail('ARRAY_NAMED_PROPERTY_FORBIDDEN', `${path}.${key}`);
    }
    if (!Object.hasOwn(descriptors[key], 'value')) fail('ACCESSOR_FORBIDDEN', `${path}[${key}]`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail('SPARSE_ARRAY_FORBIDDEN', `${path}[${index}]`);
  }
  return value;
}

function fixedDecimalUnits(value, path) {
  requireString(value, path, DECIMAL_FACT_PATTERN);
  return BigInt(value.replace('.', ''));
}

function requireUniqueStrings(value, path, options = {}) {
  const values = requireArray(
    value,
    path,
    options.minimum ?? 1,
    options.maximum ?? REPLAY_SHADOW_LIMITS.maximumArrayLength,
  );
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    const entry = requireString(values[index], `${path}[${index}]`, options.pattern ?? null);
    if (seen.has(entry)) fail('DUPLICATE_VALUE', `${path}[${index}]`);
    if (options.allowed !== undefined && !options.allowed.has(entry)) {
      fail('VALUE_OUTSIDE_CLOSED_SET', `${path}[${index}]`);
    }
    seen.add(entry);
  }
  return values;
}

function inspectJsonTree(root, allowedCandidateBindingPaths = new Set()) {
  const state = { nodes: 0 };
  const visit = (value, path, depth) => {
    state.nodes += 1;
    if (state.nodes > REPLAY_SHADOW_LIMITS.maximumJsonNodes) fail('JSON_NODE_LIMIT_EXCEEDED', path);
    if (depth > REPLAY_SHADOW_LIMITS.maximumJsonDepth) fail('JSON_DEPTH_LIMIT_EXCEEDED', path);
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') {
      if (value.length > REPLAY_SHADOW_LIMITS.maximumStringLength) fail('STRING_LIMIT_EXCEEDED', path);
      if (FORBIDDEN_RESULT_VALUES.has(value.toUpperCase())) fail('CANDIDATE_RESULT_VALUE_FORBIDDEN', path);
      const isPacketContentDigest = path === '$.corpusContentSha256';
      if (!isPacketContentDigest && !/^[0-9]+$/.test(value) && FORBIDDEN_CANDIDATE_IDENTITY.test(value)) {
        fail('CANDIDATE_IDENTITY_FORBIDDEN', path);
      }
      if (FORBIDDEN_CANDIDATE_ASSERTION.test(value)) fail('CANDIDATE_ASSERTION_FORBIDDEN', path);
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail('UNSAFE_NUMBER_FORBIDDEN', path);
      return;
    }
    if (Array.isArray(value)) {
      requireArray(value, path, 0, REPLAY_SHADOW_LIMITS.maximumArrayLength);
      for (let index = 0; index < value.length; index += 1) visit(value[index], `${path}[${index}]`, depth + 1);
      return;
    }
    requireRecord(value, path);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > REPLAY_SHADOW_LIMITS.maximumObjectKeys) fail('OBJECT_KEY_LIMIT_EXCEEDED', path);
    for (const key of keys) {
      if (typeof key === 'symbol') fail('SYMBOL_KEY_FORBIDDEN', path);
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        fail('PROTOTYPE_KEY_FORBIDDEN', `${path}.${key}`);
      }
      const childPath = `${path}.${key}`;
      if (key === 'candidateBinding' && !allowedCandidateBindingPaths.has(childPath)) {
        fail('CANDIDATE_RESULT_KEY_FORBIDDEN', childPath);
      }
      if (key !== 'candidateBinding' && FORBIDDEN_RESULT_KEYS.test(key)) {
        fail('CANDIDATE_RESULT_KEY_FORBIDDEN', `${path}.${key}`);
      }
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value')) fail('ACCESSOR_FORBIDDEN', `${path}.${key}`);
      visit(descriptor.value, `${path}.${key}`, depth + 1);
    }
  };
  visit(root, '$', 0);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function contentSha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function validateEventFactTypes(type, facts, path) {
  const stringFields = new Set([
    'sourceRef', 'processSession', 'payloadRef', 'dependencyRef', 'operationRef',
    'planRef', 'legRef', 'symbol', 'clientOrderId', 'venueOrderId', 'executionId',
    'sourceId', 'faultRef', 'campaignRef', 'checkpointRef', 'independentObserverRef',
    'streamRef', 'observerRef', 'observationRef', 'priorSession', 'currentSession',
    'subjectRef', 'stormCorrelationRef', 'reportSession', 'providerRef', 'budgetRef',
    'policyRevision',
  ]);
  const nullableStringFields = new Set([
    'tradeId', 'authorityReceiptRef',
  ]);
  const integerFields = new Set([
    'receivedAtMs', 'evaluatedAtMs', 'maxAgeMs', 'generation',
    'sourceSequence', 'attempt', 'delayBeforeAttemptMs', 'jitterMs',
    'transactionTimeMs', 'usedWeight', 'declaredLimit', 'statusCode',
    'retryAfterMs', 'serverTimeMs', 'windowMs', 'controlMessages',
    'documentedLimit', 'declaredRetryAfterMs', 'observedElapsedMs', 'sourceTime',
    'receiptWallTimeMs', 'checkpointRevision', 'sampleOrdinal', 'timeOriginMs',
    'sourceWallTimeMs', 'retainedCapacity', 'observedCount', 'droppedCount',
    'itemSequence', 'retainedCount', 'observationCount', 'reportSequence', 'attemptsObserved',
  ]);
  const nullableIntegerFields = new Set([
    'sourceTimeMs', 'remoteCloseCode', 'priorTimeOriginMs', 'currentTimeOriginMs', 'checkpointBytes',
    'coverageStartMs', 'coverageEndMs', 'connectionGeneration',
  ]);
  const nullOnlyFields = new Set(['orders', 'fills', 'positions', 'externalState', 'durableState']);
  const booleanFields = new Set(['closeFrameReceived']);
  const decimalFields = new Set(['intendedQuantity', 'lastQuantity', 'cumulativeQuantity']);
  const nullableDecimalFields = new Set(['lastPrice']);
  const digitStringFields = new Set(['receiptMonotonicNs', 'startMonotonicNs', 'endMonotonicNs']);

  for (const [key, value] of Object.entries(facts)) {
    const factPath = `${path}.${key}`;
    if (EVENT_FACT_ENUMS[key] !== undefined) requireEnum(value, factPath, EVENT_FACT_ENUMS[key]);
    else if (stringFields.has(key)) requireString(value, factPath);
    else if (nullableStringFields.has(key)) requireNullableString(value, factPath);
    else if (integerFields.has(key)) requireInteger(value, factPath, 0, Number.MAX_SAFE_INTEGER);
    else if (nullableIntegerFields.has(key)) requireNullableInteger(value, factPath);
    else if (nullOnlyFields.has(key)) requireNull(value, factPath);
    else if (booleanFields.has(key)) requireBoolean(value, factPath);
    else if (decimalFields.has(key)) requireString(value, factPath, DECIMAL_FACT_PATTERN);
    else if (nullableDecimalFields.has(key)) requireNullableString(value, factPath, DECIMAL_FACT_PATTERN);
    else if (digitStringFields.has(key)) requireString(value, factPath, DIGITS_PATTERN);
    else if (key === 'localCloseCode') requireInteger(value, factPath, 1000, 4999);
    else fail('EVENT_FACT_VALIDATOR_MISSING', factPath);
  }

  if (type === 'SOURCE_SAMPLE') {
    if (facts.sourceTimeMs !== null && facts.receivedAtMs < facts.sourceTimeMs) {
      fail('SOURCE_RECEIPT_PRECEDES_SOURCE', `${path}.receivedAtMs`);
    }
    if (facts.evaluatedAtMs < facts.receivedAtMs) fail('EVALUATION_PRECEDES_RECEIPT', `${path}.evaluatedAtMs`);
  }
  if (type === 'EXECUTION_REPORT_OBSERVED') {
    requireInteger(facts.sourceTimeMs, `${path}.sourceTimeMs`, 0, Number.MAX_SAFE_INTEGER);
    if (facts.sourceAuthority !== 'SYNTHETIC_TEST' || facts.sourceCompleteness !== 'PARTIAL') {
      fail('SYNTHETIC_PARTIAL_REPORT_METADATA_REQUIRED', path);
    }
    if (facts.receivedAtMs < facts.sourceTimeMs) fail('SOURCE_RECEIPT_PRECEDES_SOURCE', `${path}.receivedAtMs`);
    if (facts.transactionTimeMs !== facts.sourceTimeMs) fail('SOURCE_TIME_MISMATCH', `${path}.sourceTimeMs`);
    const cumulativeQuantity = fixedDecimalUnits(facts.cumulativeQuantity, `${path}.cumulativeQuantity`);
    const lastQuantity = fixedDecimalUnits(facts.lastQuantity, `${path}.lastQuantity`);
    const intendedQuantity = fixedDecimalUnits(facts.intendedQuantity, `${path}.intendedQuantity`);
    if (cumulativeQuantity < lastQuantity) {
      fail('CUMULATIVE_QUANTITY_BELOW_LAST', `${path}.cumulativeQuantity`);
    }
    if (cumulativeQuantity > intendedQuantity) {
      fail('CUMULATIVE_QUANTITY_ABOVE_INTENDED', `${path}.cumulativeQuantity`);
    }
  }
  if (type === 'LOOKUP_EVIDENCE_UNAVAILABLE') {
    if (facts.sourceAuthority !== 'UNAVAILABLE' || facts.sourceCompleteness !== 'UNAVAILABLE') {
      fail('UNAVAILABLE_LOOKUP_METADATA_REQUIRED', path);
    }
    requireNull(facts.sourceTimeMs, `${path}.sourceTimeMs`);
    requireNull(facts.coverageStartMs, `${path}.coverageStartMs`);
    requireNull(facts.coverageEndMs, `${path}.coverageEndMs`);
  }
  if (type === 'STATUS_OBSERVED' && !new Set([418, 429]).has(facts.statusCode)) {
    fail('STATUS_CODE_OUTSIDE_RATE_LIMIT_TAPE', `${path}.statusCode`);
  }
  if (['WEIGHT_HEADER_OBSERVED', 'STATUS_OBSERVED', 'COOLDOWN_WINDOW_ELAPSED'].includes(type)) {
    if (facts.protocol !== 'REST_HTTP' || facts.budgetRef !== 'REST_REQUEST_WEIGHT_1M') {
      fail('REST_RATE_SCOPE_MISMATCH', path);
    }
  }
  if (type === 'STREAM_CONTROL_BURST_OBSERVED') {
    if (facts.protocol !== 'WEBSOCKET_STREAM' || facts.budgetRef !== 'STREAM_CONTROL_MESSAGES_1S') {
      fail('STREAM_RATE_SCOPE_MISMATCH', path);
    }
  }
  if (['WEIGHT_HEADER_OBSERVED', 'STATUS_OBSERVED', 'STREAM_CONTROL_BURST_OBSERVED', 'COOLDOWN_WINDOW_ELAPSED'].includes(type)) {
    if (facts.providerRef !== 'FAKE_BINANCE_SPOT' || facts.policyRevision !== 'OFFICIAL_DOCS_2026_07_15_SNAPSHOT') {
      fail('FAKE_PROVIDER_POLICY_SCOPE_INVALID', path);
    }
  }
  if (type === 'STREAM_CONTROL_BURST_OBSERVED' && facts.controlMessages <= facts.documentedLimit) {
    fail('CONTROL_BURST_NOT_ABOVE_LIMIT', `${path}.controlMessages`);
  }
  if (type === 'COOLDOWN_WINDOW_ELAPSED' && facts.observedElapsedMs < facts.declaredRetryAfterMs) {
    fail('COOLDOWN_SHORTER_THAN_DECLARED', `${path}.observedElapsedMs`);
  }
  if (type === 'MONOTONIC_INTERVAL' && BigInt(facts.endMonotonicNs) < BigInt(facts.startMonotonicNs)) {
    fail('MONOTONIC_INTERVAL_REVERSED', `${path}.endMonotonicNs`);
  }
  if ((type === 'FRAME_OBSERVED' || type === 'FRAME_DUPLICATE_OBSERVED') && facts.receivedAtMs < facts.sourceTimeMs) {
    fail('SOURCE_RECEIPT_PRECEDES_SOURCE', `${path}.receivedAtMs`);
  }
  if (type === 'FRAME_OBSERVED' || type === 'FRAME_DUPLICATE_OBSERVED' || type === 'BASELINE_SOURCE_READBACK_OBSERVED') {
    requireInteger(facts.sourceTimeMs, `${path}.sourceTimeMs`, 0, Number.MAX_SAFE_INTEGER);
    if (facts.receivedAtMs < facts.sourceTimeMs) fail('SOURCE_RECEIPT_PRECEDES_SOURCE', `${path}.receivedAtMs`);
  }
  if (type === 'CAPTURE_WINDOW_OBSERVED') {
    if (facts.retainedCount > facts.retainedCapacity || facts.observedCount !== facts.retainedCount + facts.droppedCount) {
      fail('CAPTURE_COUNTS_INCONSISTENT', path);
    }
  }
  const recoveryEvidenceOwners = new Map([
    ['FAULT_DETECTED', 'PRODUCT_ASSURANCE_FAULT_OWNER'],
    ['CONTAINMENT_REQUEST_RECORDED', 'FOUNDATION_CONTROL_OWNER'],
    ['CHECKPOINT_REFERENCE_OBSERVED', 'SYSTEM_INTEGRATION_PERSISTENCE_OWNER'],
    ['RECOVERY_PROCESS_SESSION_CHANGED', 'INTELLIGENCE_RUNTIME_LIFECYCLE_OWNER'],
    ['READBACK_UNAVAILABLE', 'SYSTEM_INTEGRATION_PERSISTENCE_OWNER'],
    ['POSTCONDITION_SAMPLE', 'PRODUCT_ASSURANCE_REMEDIATION_OWNER'],
    ['QUIET_PERIOD_SAMPLE', 'PRODUCT_ASSURANCE_REMEDIATION_OWNER'],
  ]);
  if (recoveryEvidenceOwners.has(type) && facts.evidenceOwner !== recoveryEvidenceOwners.get(type)) {
    fail('RECOVERY_EVIDENCE_OWNER_INVALID', `${path}.evidenceOwner`);
  }
}

function cloneAndFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => cloneAndFreeze(entry)));
  const copy = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
  for (const [key, entry] of Object.entries(value)) copy[key] = cloneAndFreeze(entry);
  return Object.freeze(copy);
}

function requireCoverage(values, path) {
  return requireUniqueStrings(values, path, {
    allowed: new Set(REPLAY_SHADOW_COVERAGE),
    maximum: REPLAY_SHADOW_COVERAGE.length,
  });
}

function requireClosedReferences(values, allowed, path) {
  for (let index = 0; index < values.length; index += 1) {
    if (!allowed.has(values[index])) fail('REFERENCE_NOT_FOUND', `${path}[${index}]`);
  }
}

function validateDataset(dataset, index) {
  const path = `$.datasets[${index}]`;
  requireExactKeys(dataset, DATASET_KEYS, path);
  requireString(dataset.datasetId, `${path}.datasetId`, DATASET_ID_PATTERN);
  requireString(dataset.title, `${path}.title`);
  requireExactKeys(dataset.ownerReference, OWNER_REFERENCE_KEYS, `${path}.ownerReference`);
  requireString(dataset.ownerReference.owner, `${path}.ownerReference.owner`, TOKEN_PATTERN);
  requireString(dataset.ownerReference.ownerPath, `${path}.ownerReference.ownerPath`);
  requireString(dataset.ownerReference.ownerId, `${path}.ownerReference.ownerId`, TOKEN_PATTERN);
  if (!SOURCE_KINDS.has(dataset.sourceKind)) fail('SOURCE_KIND_INVALID', `${path}.sourceKind`);
  requireCoverage(dataset.coverage, `${path}.coverage`);
  if (!dataset.coverage.includes('REPLAY_DATASET')) fail('REPLAY_DATASET_COVERAGE_REQUIRED', `${path}.coverage`);
  if (dataset.eventTimeUnit !== 'VIRTUAL_MILLISECOND') fail('EVENT_TIME_UNIT_INVALID', `${path}.eventTimeUnit`);
  const tape = requireArray(dataset.eventTape, `${path}.eventTape`, 1, REPLAY_SHADOW_LIMITS.maximumEventsPerDataset);
  let previousOffset = -1;
  for (let eventIndex = 0; eventIndex < tape.length; eventIndex += 1) {
    const event = tape[eventIndex];
    const eventPath = `${path}.eventTape[${eventIndex}]`;
    requireExactKeys(event, EVENT_KEYS, eventPath);
    requireInteger(event.sequence, `${eventPath}.sequence`, 1, tape.length);
    if (event.sequence !== eventIndex + 1) fail('EVENT_SEQUENCE_NOT_CONTIGUOUS', `${eventPath}.sequence`);
    requireInteger(
      event.atOffsetMs,
      `${eventPath}.atOffsetMs`,
      0,
      REPLAY_SHADOW_LIMITS.maximumMeasurementDurationMs,
    );
    if (event.atOffsetMs < previousOffset) fail('EVENT_OFFSETS_NOT_MONOTONE', `${eventPath}.atOffsetMs`);
    previousOffset = event.atOffsetMs;
    requireString(event.channel, `${eventPath}.channel`, TOKEN_PATTERN);
    requireString(event.type, `${eventPath}.type`, TOKEN_PATTERN);
    requireRecord(event.facts, `${eventPath}.facts`);
    const factKeys = EVENT_FACT_KEYS[event.type];
    if (factKeys === undefined) fail('EVENT_TYPE_UNSUPPORTED', `${eventPath}.type`);
    requireExactKeys(event.facts, factKeys, `${eventPath}.facts`);
    validateEventFactTypes(event.type, event.facts, `${eventPath}.facts`);
  }
  requireUniqueStrings(dataset.evidenceRequests, `${path}.evidenceRequests`, {
    pattern: TOKEN_PATTERN,
    maximum: 64,
  });

  if (dataset.coverage.includes('RESTART_STORM')) {
    const attempts = tape.filter((event) => event.type === 'RESTART_REQUEST_RECORDED');
    const terminal = tape.find((event) => event.type === 'RESTART_STORM_TERMINAL_OBSERVATION');
    if (attempts.length < 2 || terminal === undefined || tape.at(-1) !== terminal) {
      fail('RESTART_STORM_BOUNDARY_INCOMPLETE', path);
    }
    const correlations = new Set(tape.map((event) => event.facts.stormCorrelationRef).filter(Boolean));
    if (correlations.size !== 1 || terminal.facts.attemptsObserved !== attempts.length) {
      fail('RESTART_STORM_CORRELATION_INVALID', path);
    }
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const priorOffsetMs = index === 0 ? 0 : attempts[index - 1].atOffsetMs;
      if (attempt.facts.attempt !== index + 1 || attempt.facts.generation !== index + 1) {
        fail('RESTART_ATTEMPT_SEQUENCE_INVALID', `${path}.eventTape`);
      }
      if (attempt.atOffsetMs - priorOffsetMs !== attempt.facts.delayBeforeAttemptMs) {
        fail('RESTART_DELAY_OFFSET_MISMATCH', `${path}.eventTape`);
      }
    }
  }

  const pingsByGeneration = new Map();
  for (const event of tape) {
    if (event.type === 'PING_FRAME_OBSERVED') pingsByGeneration.set(event.facts.generation, event.facts.payloadRef);
    if (event.type === 'PONG_FRAME_OBSERVED') {
      if (pingsByGeneration.get(event.facts.generation) !== event.facts.payloadRef) {
        fail('PING_PONG_PAYLOAD_MISMATCH', path);
      }
      pingsByGeneration.delete(event.facts.generation);
    }
  }

  if (dataset.coverage.includes('PARTIAL_FILL_AMBIGUITY')) {
    const identityKeys = [
      'operationRef', 'planRef', 'phase', 'legRef', 'venue', 'symbol',
      'clientOrderId', 'venueOrderId', 'side', 'intendedQuantity',
    ];
    const evidenceEvents = tape.filter((event) => identityKeys.every((key) => Object.hasOwn(event.facts, key)));
    const baselineIdentity = identityKeys.map((key) => evidenceEvents[0]?.facts[key]);
    if (evidenceEvents.length < 4 || evidenceEvents.some((event) => (
      identityKeys.some((key, index) => event.facts[key] !== baselineIdentity[index])
    ))) {
      fail('PARTIAL_FILL_IDENTITY_CORRELATION_INVALID', path);
    }
    const reports = tape.filter((event) => event.type === 'EXECUTION_REPORT_OBSERVED');
    if (reports.length < 2 || reports.at(-1).facts.tradeId !== null || reports.at(-1).facts.lastPrice !== null) {
      fail('PARTIAL_FILL_AMBIGUITY_MISSING', path);
    }
  }

  if (dataset.coverage.includes('RECOVERY_CAMPAIGN')) {
    const fault = tape.find((event) => event.type === 'FAULT_DETECTED');
    if (fault?.facts.faultRefParameter !== 'FRAME_FAULT_REF_ID') {
      fail('RECOVERY_FRAME_PARAMETERIZATION_REQUIRED', path);
    }
    const recoveryEvents = tape.filter((event) => Object.hasOwn(event.facts, 'campaignRefParameter'));
    if (recoveryEvents.length === 0 || recoveryEvents.some((event) => (
      event.facts.campaignRefParameter !== 'FRAME_CAMPAIGN_ID'
      || event.facts.correlationRefParameter !== 'FRAME_CORRELATION_REF'
    ))) {
      fail('RECOVERY_FRAME_PARAMETERIZATION_REQUIRED', path);
    }
  }
}

function validateFaultReference(reference, index) {
  const path = `$.faultRefs[${index}]`;
  requireExactKeys(reference, FAULT_REFERENCE_KEYS, path);
  requireString(reference.faultRefId, `${path}.faultRefId`, FAULT_ID_PATTERN);
  if (reference.owner !== 'PRODUCT_ASSURANCE_FAULT_SCENARIO_V1') fail('FAULT_OWNER_INVALID', `${path}.owner`);
  if (reference.ownerPath !== 'server/src/productAssurance/faults/harness.ts') {
    fail('FAULT_OWNER_PATH_INVALID', `${path}.ownerPath`);
  }
  requireString(reference.scenarioId, `${path}.scenarioId`, TOKEN_PATTERN);
  requireCoverage(reference.coverage, `${path}.coverage`);
}

function validateCampaign(campaign, index, datasetIds, faultRefIds) {
  const path = `$.campaigns[${index}]`;
  requireExactKeys(campaign, CAMPAIGN_KEYS, path);
  requireString(campaign.campaignId, `${path}.campaignId`, CAMPAIGN_ID_PATTERN);
  if (!CAMPAIGN_KINDS.has(campaign.kind)) fail('CAMPAIGN_KIND_INVALID', `${path}.kind`);
  const campaignDatasets = requireUniqueStrings(campaign.datasetIds, `${path}.datasetIds`, {
    pattern: DATASET_ID_PATTERN,
    maximum: REPLAY_SHADOW_LIMITS.maximumDatasets,
  });
  requireClosedReferences(campaignDatasets, datasetIds, `${path}.datasetIds`);
  const campaignFaults = requireUniqueStrings(campaign.faultRefIds, `${path}.faultRefIds`, {
    pattern: FAULT_ID_PATTERN,
    minimum: 0,
    maximum: REPLAY_SHADOW_LIMITS.maximumFaultReferences,
  });
  requireClosedReferences(campaignFaults, faultRefIds, `${path}.faultRefIds`);
  if (campaign.kind === 'RECOVERY' && !campaignDatasets.includes(RECOVERY_TEMPLATE_DATASET_ID)) {
    fail('RECOVERY_TEMPLATE_DATASET_REQUIRED', `${path}.datasetIds`);
  }
  if (campaign.executionState !== 'DEFERRED_POST_C2_OTHER_MACHINE') {
    fail('HEAVY_EXECUTION_MUST_REMAIN_DEFERRED', `${path}.executionState`);
  }
  requireExactKeys(campaign.schedule, SCHEDULE_KEYS, `${path}.schedule`);
  if (campaign.schedule.clock !== 'VIRTUAL_MILLISECOND') fail('SCHEDULE_CLOCK_INVALID', `${path}.schedule.clock`);
  if (campaign.schedule.measurementClock !== 'EXTERNAL_MONOTONIC_NANOSECOND_POST_C2') {
    fail('MEASUREMENT_CLOCK_INVALID', `${path}.schedule.measurementClock`);
  }
  if (campaign.schedule.iterationUnit !== ITERATION_UNIT) {
    fail('ITERATION_UNIT_INVALID', `${path}.schedule.iterationUnit`);
  }
  requireInteger(
    campaign.schedule.measurementDurationMs,
    `${path}.schedule.measurementDurationMs`,
    1,
    REPLAY_SHADOW_LIMITS.maximumMeasurementDurationMs,
  );
  const phases = requireArray(
    campaign.schedule.phases,
    `${path}.schedule.phases`,
    1,
    REPLAY_SHADOW_LIMITS.maximumPhasesPerCampaign,
  );
  const phaseIds = new Set();
  const scheduledFaultIds = new Set();
  let previousEnd = 0;
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
    const phase = phases[phaseIndex];
    const phasePath = `${path}.schedule.phases[${phaseIndex}]`;
    requireExactKeys(phase, PHASE_KEYS, phasePath);
    requireString(phase.phaseId, `${phasePath}.phaseId`, PHASE_ID_PATTERN);
    if (phaseIds.has(phase.phaseId)) fail('DUPLICATE_PHASE_ID', `${phasePath}.phaseId`);
    phaseIds.add(phase.phaseId);
    requireInteger(
      phase.startOffsetMs,
      `${phasePath}.startOffsetMs`,
      0,
      campaign.schedule.measurementDurationMs - 1,
    );
    requireInteger(
      phase.virtualDurationMs,
      `${phasePath}.virtualDurationMs`,
      1,
      campaign.schedule.measurementDurationMs,
    );
    if (phase.startOffsetMs < previousEnd) fail('PHASES_OVERLAP', `${phasePath}.startOffsetMs`);
    if (phase.startOffsetMs > previousEnd) fail('PHASE_TIMELINE_GAP', `${phasePath}.startOffsetMs`);
    const phaseEnd = phase.startOffsetMs + phase.virtualDurationMs;
    if (!Number.isSafeInteger(phaseEnd) || phaseEnd > campaign.schedule.measurementDurationMs) {
      fail('PHASE_OUTSIDE_MEASUREMENT_WINDOW', phasePath);
    }
    previousEnd = phaseEnd;
    requireInteger(
      phase.iterations,
      `${phasePath}.iterations`,
      1,
      REPLAY_SHADOW_LIMITS.maximumIterationsPerPhase,
    );
    requireInteger(phase.subjectCount, `${phasePath}.subjectCount`, 1, REPLAY_SHADOW_LIMITS.maximumSubjects);
    requireInteger(phase.maxInFlight, `${phasePath}.maxInFlight`, 1, REPLAY_SHADOW_LIMITS.maximumInFlight);
    if (phase.maxInFlight > phase.subjectCount) fail('MAX_IN_FLIGHT_EXCEEDS_SUBJECTS', `${phasePath}.maxInFlight`);
    if (!PACES.has(phase.pace)) fail('PACE_INVALID', `${phasePath}.pace`);
    const mix = requireUniqueStrings(phase.datasetMix, `${phasePath}.datasetMix`, {
      pattern: DATASET_ID_PATTERN,
      maximum: campaignDatasets.length,
    });
    requireClosedReferences(mix, new Set(campaignDatasets), `${phasePath}.datasetMix`);
    const schedule = requireArray(
      phase.faultSchedule,
      `${phasePath}.faultSchedule`,
      0,
      REPLAY_SHADOW_LIMITS.maximumFaultReferences,
    );
    let previousIteration = -1;
    for (let faultIndex = 0; faultIndex < schedule.length; faultIndex += 1) {
      const fault = schedule[faultIndex];
      const faultPath = `${phasePath}.faultSchedule[${faultIndex}]`;
      requireExactKeys(fault, FAULT_SCHEDULE_KEYS, faultPath);
      requireInteger(fault.atIteration, `${faultPath}.atIteration`, 0, phase.iterations - 1);
      if (fault.atIteration <= previousIteration) fail('FAULT_SCHEDULE_NOT_STRICTLY_ORDERED', `${faultPath}.atIteration`);
      previousIteration = fault.atIteration;
      requireString(fault.faultRefId, `${faultPath}.faultRefId`, FAULT_ID_PATTERN);
      if (!campaignFaults.includes(fault.faultRefId)) fail('FAULT_OUTSIDE_CAMPAIGN_SET', `${faultPath}.faultRefId`);
      scheduledFaultIds.add(fault.faultRefId);
    }
    if (campaign.kind === 'RECOVERY' && !phase.datasetMix.some((datasetId) => datasetId !== RECOVERY_TEMPLATE_DATASET_ID)) {
      fail('RECOVERY_BASELINE_DATASET_REQUIRED', `${phasePath}.datasetMix`);
    }
  }
  if (previousEnd !== campaign.schedule.measurementDurationMs) {
    fail('PHASE_TIMELINE_INCOMPLETE', `${path}.schedule.measurementDurationMs`);
  }
  for (const faultRefId of campaignFaults) {
    if (!scheduledFaultIds.has(faultRefId)) fail('CAMPAIGN_FAULT_UNSCHEDULED', `${path}.faultRefIds`);
  }
  requireUniqueStrings(campaign.measurementRequests, `${path}.measurementRequests`, {
    pattern: TOKEN_PATTERN,
    maximum: 64,
  });
  requireCoverage(campaign.coverage, `${path}.coverage`);
}

function requireUniqueIds(rows, key, path) {
  const ids = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const id = rows[index][key];
    if (ids.has(id)) fail('DUPLICATE_ID', `${path}[${index}].${key}`);
    ids.add(id);
  }
  return ids;
}

export function validateCorpus(input) {
  inspectJsonTree(input, new Set(['$.candidateBinding']));
  requireExactKeys(input, CORPUS_KEYS, '$');
  if (input.schema !== 'COSMOS_REPLAY_SHADOW_CORPUS_V1') fail('CORPUS_SCHEMA_INVALID', '$.schema');
  if (input.schemaVersion !== 1) fail('CORPUS_SCHEMA_VERSION_INVALID', '$.schemaVersion');
  if (input.packetId !== 'RUN-17') fail('PACKET_ID_INVALID', '$.packetId');
  if (input.disposition !== 'SHADOW_SPECULATIVE') fail('DISPOSITION_INVALID', '$.disposition');
  if (input.executionAuthority !== 'NONE') fail('EXECUTION_AUTHORITY_FORBIDDEN', '$.executionAuthority');
  if (input.candidateBinding !== null) fail('CANDIDATE_BINDING_FORBIDDEN', '$.candidateBinding');
  if (input.heavyExecution !== 'DEFERRED_POST_C2_OTHER_MACHINE') {
    fail('HEAVY_EXECUTION_MUST_REMAIN_DEFERRED', '$.heavyExecution');
  }
  const requiredCoverage = requireUniqueStrings(input.requiredCoverage, '$.requiredCoverage', {
    allowed: new Set(REPLAY_SHADOW_COVERAGE),
    minimum: REPLAY_SHADOW_COVERAGE.length,
    maximum: REPLAY_SHADOW_COVERAGE.length,
  });
  if (requiredCoverage.some((value, index) => value !== REPLAY_SHADOW_COVERAGE[index])) {
    fail('COVERAGE_ORDER_OR_DENOMINATOR_INVALID', '$.requiredCoverage');
  }
  const datasets = requireArray(input.datasets, '$.datasets', 1, REPLAY_SHADOW_LIMITS.maximumDatasets);
  datasets.forEach(validateDataset);
  const datasetIds = requireUniqueIds(datasets, 'datasetId', '$.datasets');
  const faultRefs = requireArray(input.faultRefs, '$.faultRefs', 1, REPLAY_SHADOW_LIMITS.maximumFaultReferences);
  faultRefs.forEach(validateFaultReference);
  const faultRefIds = requireUniqueIds(faultRefs, 'faultRefId', '$.faultRefs');
  const campaigns = requireArray(input.campaigns, '$.campaigns', 1, REPLAY_SHADOW_LIMITS.maximumCampaigns);
  campaigns.forEach((campaign, index) => validateCampaign(campaign, index, datasetIds, faultRefIds));
  requireUniqueIds(campaigns, 'campaignId', '$.campaigns');
  const globallyScheduledFaults = new Set(campaigns.flatMap((campaign) => (
    campaign.schedule.phases.flatMap((phase) => phase.faultSchedule.map((fault) => fault.faultRefId))
  )));
  for (const faultRefId of faultRefIds) {
    if (!globallyScheduledFaults.has(faultRefId)) fail('FAULT_REFERENCE_NEVER_SCHEDULED', `$.faultRefs.${faultRefId}`);
  }
  const limitations = requireUniqueStrings(input.limitations, '$.limitations', {
    pattern: TOKEN_PATTERN,
    minimum: REPLAY_SHADOW_REQUIRED_LIMITATIONS.length,
    maximum: REPLAY_SHADOW_REQUIRED_LIMITATIONS.length,
  });
  if (limitations.some((value, index) => value !== REPLAY_SHADOW_REQUIRED_LIMITATIONS[index])) {
    fail('LIMITATION_ORDER_OR_DENOMINATOR_INVALID', '$.limitations');
  }

  const covered = new Set();
  for (const dataset of datasets) for (const coverage of dataset.coverage) covered.add(coverage);
  for (const reference of faultRefs) for (const coverage of reference.coverage) covered.add(coverage);
  for (const campaign of campaigns) for (const coverage of campaign.coverage) covered.add(coverage);
  for (const required of REPLAY_SHADOW_COVERAGE) {
    if (!covered.has(required)) fail('REQUIRED_COVERAGE_MISSING', `$.requiredCoverage.${required}`);
  }
  for (const required of REPLAY_SHADOW_COVERAGE.filter((value) => value !== 'REPLAY_DATASET')) {
    const linked = campaigns.some((campaign) => (
      campaign.coverage.includes(required)
      && campaign.datasetIds.some((datasetId) => (
        datasets.find((dataset) => dataset.datasetId === datasetId)?.coverage.includes(required) === true
      ))
    ));
    if (!linked) fail('REQUIRED_COVERAGE_NOT_LINKED', `$.requiredCoverage.${required}`);
  }
  const definitionKinds = new Map([
    ['LATENCY_DEFINITION', 'LATENCY'],
    ['LOAD_DEFINITION', 'LOAD'],
    ['SOAK_DEFINITION', 'SOAK'],
  ]);
  for (const [coverage, kind] of definitionKinds) {
    if (!campaigns.some((campaign) => campaign.kind === kind && campaign.coverage.includes(coverage))) {
      fail('DEFINITION_CAMPAIGN_KIND_MISSING', `$.requiredCoverage.${coverage}`);
    }
  }
  return cloneAndFreeze(input);
}

export function inventoryCorpus(input) {
  const corpus = validateCorpus(input);
  const coverage = REPLAY_SHADOW_COVERAGE.map((coverageId) => Object.freeze({
    coverageId,
    datasetIds: Object.freeze(corpus.datasets.filter((row) => row.coverage.includes(coverageId)).map((row) => row.datasetId)),
    faultRefIds: Object.freeze(corpus.faultRefs.filter((row) => row.coverage.includes(coverageId)).map((row) => row.faultRefId)),
    campaignIds: Object.freeze(corpus.campaigns.filter((row) => row.coverage.includes(coverageId)).map((row) => row.campaignId)),
  }));
  return Object.freeze({
    schema: 'COSMOS_REPLAY_SHADOW_INVENTORY_V1',
    disposition: corpus.disposition,
    executionAuthority: corpus.executionAuthority,
    heavyExecution: corpus.heavyExecution,
    datasetCount: corpus.datasets.length,
    eventCount: corpus.datasets.reduce((sum, row) => sum + row.eventTape.length, 0),
    faultReferenceCount: corpus.faultRefs.length,
    campaignCount: corpus.campaigns.length,
    coverage: Object.freeze(coverage),
  });
}

export function compileCampaign(input, campaignId) {
  const corpus = validateCorpus(input);
  requireString(campaignId, '$.campaignId', CAMPAIGN_ID_PATTERN);
  const campaign = corpus.campaigns.find((row) => row.campaignId === campaignId);
  if (campaign === undefined) fail('CAMPAIGN_NOT_FOUND', '$.campaignId');
  let startOrdinal = 0;
  const phases = campaign.schedule.phases.map((phase) => {
    const compiled = {
      phaseId: phase.phaseId,
      startOffsetMs: phase.startOffsetMs,
      virtualDurationMs: phase.virtualDurationMs,
      iterations: phase.iterations,
      startOrdinal,
      endOrdinalExclusive: startOrdinal + phase.iterations,
      subjectCount: phase.subjectCount,
      maxInFlight: phase.maxInFlight,
      pace: phase.pace,
      datasetMix: phase.datasetMix,
      faultSchedule: phase.faultSchedule,
    };
    startOrdinal = compiled.endOrdinalExclusive;
    return compiled;
  });
  return cloneAndFreeze({
    schema: 'COSMOS_REPLAY_SHADOW_PLAN_V1',
    schemaVersion: 1,
    packetId: corpus.packetId,
    disposition: corpus.disposition,
    executionAuthority: corpus.executionAuthority,
    candidateBinding: null,
    corpusContentSha256: contentSha256(corpus),
    campaignId: campaign.campaignId,
    kind: campaign.kind,
    executionState: campaign.executionState,
    clock: campaign.schedule.clock,
    measurementClock: campaign.schedule.measurementClock,
    iterationUnit: campaign.schedule.iterationUnit,
    measurementDurationMs: campaign.schedule.measurementDurationMs,
    totalIterations: startOrdinal,
    datasetIds: campaign.datasetIds,
    faultRefIds: campaign.faultRefIds,
    measurementRequests: campaign.measurementRequests,
    coverage: campaign.coverage,
    phases,
  });
}

function requirePlan(plan) {
  inspectJsonTree(plan, new Set(['$.candidateBinding']));
  requireExactKeys(plan, PLAN_KEYS, '$.plan');
  if (plan.schema !== 'COSMOS_REPLAY_SHADOW_PLAN_V1') fail('PLAN_SCHEMA_INVALID', '$.plan.schema');
  if (plan.schemaVersion !== 1) fail('PLAN_SCHEMA_VERSION_INVALID', '$.plan.schemaVersion');
  if (plan.packetId !== 'RUN-17') fail('PACKET_ID_INVALID', '$.plan.packetId');
  if (plan.disposition !== 'SHADOW_SPECULATIVE') fail('DISPOSITION_INVALID', '$.plan.disposition');
  if (plan.executionAuthority !== 'NONE') fail('EXECUTION_AUTHORITY_FORBIDDEN', '$.plan.executionAuthority');
  if (plan.candidateBinding !== null) fail('CANDIDATE_BINDING_FORBIDDEN', '$.plan.candidateBinding');
  requireString(plan.corpusContentSha256, '$.plan.corpusContentSha256', /^[0-9a-f]{64}$/);
  requireString(plan.campaignId, '$.plan.campaignId', CAMPAIGN_ID_PATTERN);
  if (!CAMPAIGN_KINDS.has(plan.kind)) fail('CAMPAIGN_KIND_INVALID', '$.plan.kind');
  if (plan.executionState !== 'DEFERRED_POST_C2_OTHER_MACHINE') {
    fail('HEAVY_EXECUTION_MUST_REMAIN_DEFERRED', '$.plan.executionState');
  }
  if (plan.clock !== 'VIRTUAL_MILLISECOND') fail('SCHEDULE_CLOCK_INVALID', '$.plan.clock');
  if (plan.measurementClock !== 'EXTERNAL_MONOTONIC_NANOSECOND_POST_C2') {
    fail('MEASUREMENT_CLOCK_INVALID', '$.plan.measurementClock');
  }
  if (plan.iterationUnit !== ITERATION_UNIT) fail('ITERATION_UNIT_INVALID', '$.plan.iterationUnit');
  requireInteger(
    plan.measurementDurationMs,
    '$.plan.measurementDurationMs',
    1,
    REPLAY_SHADOW_LIMITS.maximumMeasurementDurationMs,
  );
  requireInteger(
    plan.totalIterations,
    '$.plan.totalIterations',
    1,
    REPLAY_SHADOW_LIMITS.maximumIterationsPerPhase * REPLAY_SHADOW_LIMITS.maximumPhasesPerCampaign,
  );
  const datasetIds = requireUniqueStrings(plan.datasetIds, '$.plan.datasetIds', {
    pattern: DATASET_ID_PATTERN,
    maximum: REPLAY_SHADOW_LIMITS.maximumDatasets,
  });
  if (plan.kind === 'RECOVERY' && !datasetIds.includes(RECOVERY_TEMPLATE_DATASET_ID)) {
    fail('RECOVERY_TEMPLATE_DATASET_REQUIRED', '$.plan.datasetIds');
  }
  const faultRefIds = requireUniqueStrings(plan.faultRefIds, '$.plan.faultRefIds', {
    pattern: FAULT_ID_PATTERN,
    minimum: 0,
    maximum: REPLAY_SHADOW_LIMITS.maximumFaultReferences,
  });
  requireUniqueStrings(plan.measurementRequests, '$.plan.measurementRequests', {
    pattern: TOKEN_PATTERN,
    maximum: 64,
  });
  requireCoverage(plan.coverage, '$.plan.coverage');
  const phases = requireArray(plan.phases, '$.plan.phases', 1, REPLAY_SHADOW_LIMITS.maximumPhasesPerCampaign);
  const phaseIds = new Set();
  let expectedOrdinal = 0;
  let previousPhaseEnd = 0;
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    const path = `$.plan.phases[${index}]`;
    requireExactKeys(phase, COMPILED_PHASE_KEYS, path);
    requireString(phase.phaseId, `${path}.phaseId`, PHASE_ID_PATTERN);
    if (phaseIds.has(phase.phaseId)) fail('DUPLICATE_PHASE_ID', `${path}.phaseId`);
    phaseIds.add(phase.phaseId);
    requireInteger(phase.startOffsetMs, `${path}.startOffsetMs`, 0, plan.measurementDurationMs - 1);
    requireInteger(phase.virtualDurationMs, `${path}.virtualDurationMs`, 1, plan.measurementDurationMs);
    if (phase.startOffsetMs < previousPhaseEnd) fail('PHASES_OVERLAP', `${path}.startOffsetMs`);
    if (phase.startOffsetMs > previousPhaseEnd) fail('PHASE_TIMELINE_GAP', `${path}.startOffsetMs`);
    const phaseEnd = phase.startOffsetMs + phase.virtualDurationMs;
    if (!Number.isSafeInteger(phaseEnd) || phaseEnd > plan.measurementDurationMs) {
      fail('PHASE_OUTSIDE_MEASUREMENT_WINDOW', path);
    }
    previousPhaseEnd = phaseEnd;
    requireInteger(phase.iterations, `${path}.iterations`, 1, REPLAY_SHADOW_LIMITS.maximumIterationsPerPhase);
    requireInteger(phase.startOrdinal, `${path}.startOrdinal`, 0, plan.totalIterations - 1);
    requireInteger(phase.endOrdinalExclusive, `${path}.endOrdinalExclusive`, 1, plan.totalIterations);
    if (phase.startOrdinal !== expectedOrdinal) fail('PLAN_ORDINAL_GAP', `${path}.startOrdinal`);
    if (phase.endOrdinalExclusive !== phase.startOrdinal + phase.iterations) {
      fail('PLAN_PHASE_ITERATION_RANGE_INVALID', `${path}.endOrdinalExclusive`);
    }
    expectedOrdinal = phase.endOrdinalExclusive;
    requireInteger(phase.subjectCount, `${path}.subjectCount`, 1, REPLAY_SHADOW_LIMITS.maximumSubjects);
    requireInteger(phase.maxInFlight, `${path}.maxInFlight`, 1, REPLAY_SHADOW_LIMITS.maximumInFlight);
    if (phase.maxInFlight > phase.subjectCount) fail('MAX_IN_FLIGHT_EXCEEDS_SUBJECTS', `${path}.maxInFlight`);
    if (!PACES.has(phase.pace)) fail('PACE_INVALID', `${path}.pace`);
    const mix = requireUniqueStrings(phase.datasetMix, `${path}.datasetMix`, {
      pattern: DATASET_ID_PATTERN,
      maximum: datasetIds.length,
    });
    requireClosedReferences(mix, new Set(datasetIds), `${path}.datasetMix`);
    const schedule = requireArray(
      phase.faultSchedule,
      `${path}.faultSchedule`,
      0,
      REPLAY_SHADOW_LIMITS.maximumFaultReferences,
    );
    let previousIteration = -1;
    for (let faultIndex = 0; faultIndex < schedule.length; faultIndex += 1) {
      const fault = schedule[faultIndex];
      const faultPath = `${path}.faultSchedule[${faultIndex}]`;
      requireExactKeys(fault, FAULT_SCHEDULE_KEYS, faultPath);
      requireInteger(fault.atIteration, `${faultPath}.atIteration`, 0, phase.iterations - 1);
      if (fault.atIteration <= previousIteration) fail('FAULT_SCHEDULE_NOT_STRICTLY_ORDERED', `${faultPath}.atIteration`);
      previousIteration = fault.atIteration;
      requireString(fault.faultRefId, `${faultPath}.faultRefId`, FAULT_ID_PATTERN);
      if (!faultRefIds.includes(fault.faultRefId)) fail('FAULT_OUTSIDE_CAMPAIGN_SET', `${faultPath}.faultRefId`);
    }
  }
  if (expectedOrdinal !== plan.totalIterations) fail('PLAN_TOTAL_ITERATIONS_INVALID', '$.plan.totalIterations');
  if (previousPhaseEnd !== plan.measurementDurationMs) {
    fail('PHASE_TIMELINE_INCOMPLETE', '$.plan.measurementDurationMs');
  }
  return plan;
}

export function materializePlanWindow(planInput, options) {
  const plan = requirePlan(planInput);
  inspectJsonTree(options);
  requireExactKeys(options, ['startOrdinal', 'limit'], '$.options');
  const startOrdinal = requireInteger(options.startOrdinal, '$.options.startOrdinal', 0, plan.totalIterations);
  const limit = requireInteger(options.limit, '$.options.limit', 0, REPLAY_SHADOW_LIMITS.maximumPlanWindow);
  const endOrdinal = Math.min(plan.totalIterations, startOrdinal + limit);
  const frames = [];
  for (let ordinal = startOrdinal; ordinal < endOrdinal; ordinal += 1) {
    const phase = plan.phases.find((entry) => ordinal >= entry.startOrdinal && ordinal < entry.endOrdinalExclusive);
    if (phase === undefined) fail('PLAN_ORDINAL_NOT_COVERED', `$.plan.ordinal.${ordinal}`);
    const phaseOrdinal = ordinal - phase.startOrdinal;
    const isOpenArrival = phase.pace === 'OPEN_ARRIVAL_RATE';
    const denominator = Math.max(1, phase.iterations - 1);
    const virtualRange = Math.max(0, phase.virtualDurationMs - 1);
    const scheduledOffsetMs = isOpenArrival
      ? phase.startOffsetMs + Math.floor((phaseOrdinal * virtualRange) / denominator)
      : null;
    const subjectPredecessorOrdinal = !isOpenArrival && phaseOrdinal >= phase.subjectCount
      ? ordinal - phase.subjectCount
      : null;
    const admissionPredecessorOrdinal = !isOpenArrival && phaseOrdinal >= phase.maxInFlight
      ? ordinal - phase.maxInFlight
      : null;
    const fault = phase.faultSchedule.find((entry) => entry.atIteration === phaseOrdinal);
    let datasetId = phase.datasetMix[phaseOrdinal % phase.datasetMix.length];
    if (plan.kind === 'RECOVERY') {
      if (fault !== undefined) datasetId = RECOVERY_TEMPLATE_DATASET_ID;
      else if (datasetId === RECOVERY_TEMPLATE_DATASET_ID) {
        datasetId = phase.datasetMix.find((entry) => entry !== RECOVERY_TEMPLATE_DATASET_ID)
          ?? fail('RECOVERY_BASELINE_DATASET_REQUIRED', '$.plan.phases.datasetMix');
      }
    }
    frames.push(Object.freeze({
      ordinal,
      campaignId: plan.campaignId,
      correlationRef: `RUN-17:${plan.campaignId}:${ordinal}`,
      phaseId: phase.phaseId,
      scheduledOffsetMs,
      dispatchCondition: isOpenArrival ? 'VIRTUAL_OFFSET' : 'AFTER_PREDECESSORS_COMPLETED',
      subjectOrdinal: phaseOrdinal % phase.subjectCount,
      subjectPredecessorOrdinal,
      admissionSlotOrdinal: isOpenArrival ? null : phaseOrdinal % phase.maxInFlight,
      admissionPredecessorOrdinal,
      repetition: Math.floor(phaseOrdinal / phase.subjectCount),
      datasetId,
      faultRefId: fault?.faultRefId ?? null,
      faultInjectionPoint: fault === undefined ? null : FAULT_INJECTION_POINT,
    }));
  }
  return Object.freeze(frames);
}

function requirePlanFrames(value, path) {
  inspectJsonTree(value);
  const frames = requireArray(value, path, 0, REPLAY_SHADOW_LIMITS.maximumPlanWindow);
  let previousOrdinal = null;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const framePath = `${path}[${index}]`;
    requireExactKeys(frame, FRAME_KEYS, framePath);
    requireInteger(frame.ordinal, `${framePath}.ordinal`, 0, Number.MAX_SAFE_INTEGER);
    if (previousOrdinal !== null && frame.ordinal !== previousOrdinal + 1) {
      fail('FRAME_ORDINALS_NOT_CONTIGUOUS', `${framePath}.ordinal`);
    }
    previousOrdinal = frame.ordinal;
    requireString(frame.campaignId, `${framePath}.campaignId`, CAMPAIGN_ID_PATTERN);
    requireString(frame.correlationRef, `${framePath}.correlationRef`);
    requireString(frame.phaseId, `${framePath}.phaseId`, PHASE_ID_PATTERN);
    if (frame.scheduledOffsetMs !== null) {
      requireInteger(
        frame.scheduledOffsetMs,
        `${framePath}.scheduledOffsetMs`,
        0,
        REPLAY_SHADOW_LIMITS.maximumMeasurementDurationMs,
      );
    }
    requireEnum(frame.dispatchCondition, `${framePath}.dispatchCondition`, DISPATCH_CONDITIONS);
    if (frame.dispatchCondition === 'VIRTUAL_OFFSET' && frame.scheduledOffsetMs === null) {
      fail('OPEN_ARRIVAL_OFFSET_REQUIRED', `${framePath}.scheduledOffsetMs`);
    }
    if (frame.dispatchCondition === 'AFTER_PREDECESSORS_COMPLETED' && frame.scheduledOffsetMs !== null) {
      fail('CLOSED_LOOP_OFFSET_FORBIDDEN', `${framePath}.scheduledOffsetMs`);
    }
    requireInteger(frame.subjectOrdinal, `${framePath}.subjectOrdinal`, 0, REPLAY_SHADOW_LIMITS.maximumSubjects - 1);
    requireNullableInteger(frame.subjectPredecessorOrdinal, `${framePath}.subjectPredecessorOrdinal`);
    requireNullableInteger(
      frame.admissionSlotOrdinal,
      `${framePath}.admissionSlotOrdinal`,
      0,
      REPLAY_SHADOW_LIMITS.maximumInFlight - 1,
    );
    requireNullableInteger(frame.admissionPredecessorOrdinal, `${framePath}.admissionPredecessorOrdinal`);
    for (const [key, predecessor] of [
      ['subjectPredecessorOrdinal', frame.subjectPredecessorOrdinal],
      ['admissionPredecessorOrdinal', frame.admissionPredecessorOrdinal],
    ]) {
      if (predecessor !== null && predecessor >= frame.ordinal) {
        fail('FRAME_PREDECESSOR_NOT_PRIOR', `${framePath}.${key}`);
      }
    }
    if (frame.dispatchCondition === 'VIRTUAL_OFFSET' && [
      frame.subjectPredecessorOrdinal,
      frame.admissionSlotOrdinal,
      frame.admissionPredecessorOrdinal,
    ].some((value) => value !== null)) {
      fail('OPEN_ARRIVAL_PREDECESSOR_FORBIDDEN', framePath);
    }
    if (frame.dispatchCondition === 'AFTER_PREDECESSORS_COMPLETED' && frame.admissionSlotOrdinal === null) {
      fail('CLOSED_LOOP_ADMISSION_SLOT_REQUIRED', `${framePath}.admissionSlotOrdinal`);
    }
    requireInteger(frame.repetition, `${framePath}.repetition`, 0, Number.MAX_SAFE_INTEGER);
    requireString(frame.datasetId, `${framePath}.datasetId`, DATASET_ID_PATTERN);
    if (frame.faultRefId !== null) requireString(frame.faultRefId, `${framePath}.faultRefId`, FAULT_ID_PATTERN);
    if (frame.faultInjectionPoint !== null && frame.faultInjectionPoint !== FAULT_INJECTION_POINT) {
      fail('FAULT_INJECTION_POINT_INVALID', `${framePath}.faultInjectionPoint`);
    }
    if ((frame.faultRefId === null) !== (frame.faultInjectionPoint === null)) {
      fail('FAULT_BINDING_INCOMPLETE', framePath);
    }
  }
  return frames;
}

export function comparePlanFrames(plan, options, left, right) {
  const expected = materializePlanWindow(plan, options);
  const leftFrames = requirePlanFrames(left, '$.leftFrames');
  const rightFrames = requirePlanFrames(right, '$.rightFrames');
  const serializedExpected = JSON.stringify(expected);
  return JSON.stringify(leftFrames) === serializedExpected && JSON.stringify(rightFrames) === serializedExpected;
}
