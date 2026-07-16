import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOCKED_EXECUTION_MODE_REQUESTS,
  DIALECT_LOSS_CODES,
  LIVE_EXECUTION_NOT_IMPLEMENTED,
  SYSTEM_COMPONENT_IDS,
  SYSTEM_RELEASE_STATUSES,
  SYSTEM_SAFE_MODES,
  SYSTEM_TRUTH_LABELS,
  createOpaqueIdentityAlias,
  createSystemSourceRegistrySnapshot,
  projectIntelligenceTruthToSourcedTimestamp,
  projectRuntimeLifecycleEvidence,
  resolveSystemSafeMode,
  translateIntelligenceAuthority,
  translateRuntimeCoverage,
  translateRuntimeErrorToStructuredFailure,
  translateStableFailureToStructuredFailure,
  validateOpaqueIdentityAlias,
  validateReleaseStatuses,
  validateSystemComponentSnapshot,
  validateSystemControlMutationRequest,
  validateSystemSourceRegistrySnapshot,
  validateSystemTraceEvent,
} from '../../../dist/systemIntegration/contracts/index.js';
import {
  evaluateFreshness,
  STRUCTURED_FAILURE_KEYS,
} from '../../../dist/foundation/contracts/index.js';
import {
  makeStableFailure,
} from '../../../dist/intelligenceFoundation/contracts/index.js';

const NOW = 1_780_000_000_000;
const CONTEXT = Object.freeze({
  nowMs: NOW,
  correlationId: 'cor_system_contract_test',
  safeCurrentState: 'STOPPED',
});

function truth(overrides = {}) {
  const base = {
    schemaVersion: '1',
    producerVersion: 'system-contract-test-1',
    configurationVersion: 'cfg-test',
    featureVersion: null,
    authority: {
      kind: 'EXCHANGE_PRIMARY',
      sourceId: 'runtime-source:spot-test',
      dataset: 'bookTicker',
      endpointClass: 'PUBLIC',
    },
    provenance: {
      sourceRecordIds: ['book:1'],
      sourceSet: ['runtime-source:spot-test'],
      transforms: ['normalize-book-v1'],
    },
    temporal: {
      sourceEventTimeMs: null,
      sourceTransactionTimeMs: NOW - 100,
      receivedTimeMs: NOW - 50,
      sequence: { first: '10', last: '11', previous: '9' },
    },
    freshness: {
      basis: 'SOURCE_TRANSACTION_TIME',
      evaluatedAtMs: NOW,
      ageMs: 100,
      maxAgeMs: 1_000,
      state: 'FRESH',
    },
    completeness: {
      state: 'COMPLETE',
      observedFields: ['bid', 'ask'],
      missingFields: [],
      reasonCodes: [],
    },
  };
  return {
    ...base,
    ...overrides,
    authority: { ...base.authority, ...(overrides.authority ?? {}) },
    provenance: { ...base.provenance, ...(overrides.provenance ?? {}) },
    temporal: { ...base.temporal, ...(overrides.temporal ?? {}) },
    freshness: { ...base.freshness, ...(overrides.freshness ?? {}) },
    completeness: { ...base.completeness, ...(overrides.completeness ?? {}) },
  };
}

function sourceRecord(overrides = {}) {
  return {
    sourceId: 'runtime-source:spot-mini-ticker',
    semanticStream: 'SPOT_MINI_TICKER',
    dataset: 'binance.spot.miniTicker',
    productFamily: 'SPOT',
    endpointClass: 'PUBLIC',
    physicalProducer: {
      kind: 'EXISTING_AUDITED',
      producerId: 'market-engine',
      ownerPath: 'server/src/engine/marketData.ts',
      transport: 'INJECTED_EXISTING',
    },
    semanticPublisher: 'intelligence-runtime',
    consumers: ['market-intelligence', 'engine-supervisor'],
    releaseStatuses: ['IMPORTED', 'WIRED', 'LIVE_PUBLIC'],
    maximumAuthority: 'LIVE_PUBLIC',
    duplicatePolicy: 'SINGLE_PRODUCER_ONLY',
    notes: ['No integration-owned socket.'],
    ...overrides,
  };
}

function liveComponent(overrides = {}) {
  const sourceTimestamp = {
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 80,
    maxAgeMs: 5_000,
    authority: 'LIVE_PUBLIC',
    completeness: 'COMPLETE',
    sourceId: 'runtime-source:spot-test',
  };
  return {
    componentId: 'public-spot-source',
    owner: 'INTELLIGENCE_RUNTIME',
    ownerPath: 'server/src/intelligenceRuntime',
    releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'LIVE_PUBLIC'],
    truthLabel: 'LIVE_PUBLIC',
    desiredState: 'RUNNING',
    phase: 'RUNNING',
    domainObservedState: 'LIVE',
    sourceLifecycle: 'LIVE',
    readiness: 'READY',
    authority: 'LIVE_PUBLIC',
    completeness: 'COMPLETE',
    sourceTimestamp,
    freshness: evaluateFreshness(sourceTimestamp, NOW),
    lastReceiveAtMs: NOW - 80,
    lastProcessAtMs: NOW - 60,
    lastSuccessAtMs: NOW - 60,
    dependencies: ['ledger-persistence'],
    queue: null,
    lastFailure: null,
    blockerCodes: [],
    generation: 1,
    restartCount: 0,
    supportedControls: ['RESTART_COMPONENT'],
    capitalExposed: false,
    operatorAttentionRequired: false,
    ...overrides,
  };
}

test('canonical convergence vocabularies are closed and frozen', () => {
  assert.deepEqual(SYSTEM_SAFE_MODES, ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY']);
  assert.equal(SYSTEM_COMPONENT_IDS.length, 14);
  assert.ok(SYSTEM_COMPONENT_IDS.includes('q-inference'));
  assert.ok(SYSTEM_COMPONENT_IDS.includes('execution-coordinator-validate-only'));
  assert.ok(SYSTEM_RELEASE_STATUSES.includes('SYNTHETIC_ONLY'));
  assert.ok(SYSTEM_TRUTH_LABELS.includes('DRY_RUN'));
  assert.ok(DIALECT_LOSS_CODES.includes('REVISION_UNAVAILABLE'));
  assert.ok(DIALECT_LOSS_CODES.includes('SOURCE_ID_DERIVED'));
  for (const vocabulary of [
    SYSTEM_SAFE_MODES,
    SYSTEM_COMPONENT_IDS,
    SYSTEM_RELEASE_STATUSES,
    SYSTEM_TRUTH_LABELS,
    DIALECT_LOSS_CODES,
    BLOCKED_EXECUTION_MODE_REQUESTS,
  ]) {
    assert.equal(Object.isFrozen(vocabulary), true);
    assert.throws(() => vocabulary.push('__WIDENED__'), TypeError);
  }
});

test('safe modes keep Control keyless and Capital reservation unavailable', () => {
  for (const mode of SYSTEM_SAFE_MODES) {
    const result = resolveSystemSafeMode(mode, CONTEXT);
    assert.equal(result.ok, true);
    assert.equal(result.value.foundationRunMode, 'INTELLIGENCE');
    assert.equal(result.value.capitalObservationMode, mode);
    assert.equal(result.value.capitalReservationMode, 'UNAVAILABLE');
    assert.equal(result.value.liveExecutionPermitted, false);
    assert.equal(result.value.requiresPrivateKeys, false);
    assert.equal(result.value.coordinatorMode, mode === 'VALIDATE_ONLY' ? 'VALIDATE_ONLY' : 'UNAVAILABLE');
  }
  const validateOnly = resolveSystemSafeMode('VALIDATE_ONLY', CONTEXT);
  assert.ok(validateOnly.value.translationReasons.includes('CAPITAL_MANUAL_ARMED_DIALECT_BLOCKED'));
});

test('live/manual/autonomous modes hard-block before granting authority', () => {
  for (const mode of BLOCKED_EXECUTION_MODE_REQUESTS) {
    const result = resolveSystemSafeMode(mode, CONTEXT);
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, LIVE_EXECUTION_NOT_IMPLEMENTED);
    assert.equal(result.failure.safeCurrentState, 'STOPPED');
  }
  const unknown = resolveSystemSafeMode('EXECUTION_VALIDATE_ONLY', CONTEXT);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.failure.code, 'INVALID_SAFE_MODE');
});

test('runtime coverage translates only completeness and never mints DataAuthority', () => {
  const complete = translateRuntimeCoverage('COMPLETE');
  assert.deepEqual(Object.keys(complete).sort(), [
    'foundationCompleteness', 'intelligenceCompleteness', 'losses', 'runtimeCoverage', 'sampled',
  ]);
  assert.equal(Object.hasOwn(complete, 'authority'), false);
  const sampled = translateRuntimeCoverage('SAMPLED');
  assert.equal(sampled.intelligenceCompleteness, 'PARTIAL');
  assert.equal(sampled.foundationCompleteness, 'PARTIAL');
  assert.equal(sampled.losses[0].code, 'RUNTIME_SAMPLED_LOWER_BOUND');
  const unknown = translateRuntimeCoverage('UNKNOWN');
  assert.equal(unknown.foundationCompleteness, 'UNAVAILABLE');
  assert.throws(() => translateRuntimeCoverage('LIVE_PUBLIC'), /unknown RuntimeAuthority/);
});

test('runtime lifecycle remains evidence and never cross-casts to RuntimePhase', () => {
  assert.deepEqual(projectRuntimeLifecycleEvidence('LIVE'), {
    sourceLifecycle: 'LIVE',
    readinessEvidence: 'READY',
    machinePhase: null,
    fatalEvidence: false,
  });
  assert.equal(projectRuntimeLifecycleEvidence('STALE').readinessEvidence, 'DEGRADED');
  assert.equal(projectRuntimeLifecycleEvidence('FAILED').fatalEvidence, true);
});

test('MI transaction time and sequence project with explicit named loss', () => {
  const result = projectIntelligenceTruthToSourcedTimestamp(truth(), {
    ...CONTEXT,
    acquisitionAuthority: 'LIVE_PUBLIC',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.sourceTimeMs, NOW - 100);
  assert.equal(result.value.receivedAtMs, NOW - 50);
  assert.equal(result.value.authority, 'LIVE_PUBLIC');
  assert.deepEqual(result.losses.map((loss) => loss.code), [
    'TRANSACTION_TIME_USED_AS_SOURCE_TIME',
    'SEQUENCE_NOT_REPRESENTABLE',
  ]);
});

test('missing MI age budget produces null instead of a fabricated timestamp', () => {
  const unavailable = truth({
    freshness: {
      basis: 'UNAVAILABLE',
      evaluatedAtMs: NOW,
      ageMs: null,
      maxAgeMs: null,
      state: 'UNAVAILABLE',
    },
  });
  const result = projectIntelligenceTruthToSourcedTimestamp(unavailable, {
    ...CONTEXT,
    acquisitionAuthority: 'LIVE_PUBLIC',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
  assert.ok(result.losses.some((loss) => loss.code === 'MAX_AGE_MISSING'));
});

test('MI authority requires acquisition and upstream context', () => {
  assert.equal(
    translateIntelligenceAuthority('EXCHANGE_PRIMARY', { acquisitionAuthority: 'LIVE_PUBLIC' }).effectiveAuthority,
    'LIVE_PUBLIC',
  );
  const derivedMissing = translateIntelligenceAuthority('ENGINE_DERIVED', {
    acquisitionAuthority: 'LIVE_PUBLIC',
  });
  assert.equal(derivedMissing.effectiveAuthority, 'UNAVAILABLE');
  assert.equal(derivedMissing.losses[0].code, 'UPSTREAM_AUTHORITY_MISSING');
  const derived = translateIntelligenceAuthority('ENGINE_DERIVED', {
    acquisitionAuthority: 'LIVE_PUBLIC',
    upstreamAuthorities: ['LIVE_PUBLIC', 'DERIVED_LIVE'],
  });
  assert.equal(derived.effectiveAuthority, 'DERIVED_LIVE');
  const operator = translateIntelligenceAuthority('OPERATOR_SUPPLIED', {
    acquisitionAuthority: 'LIVE_PUBLIC',
  });
  assert.equal(operator.effectiveAuthority, 'UNAVAILABLE');
});

test('foreign engine identities stay opaque and byte-identical', () => {
  const alias = createOpaqueIdentityAlias({
    systemId: 'alias:proposal:1',
    owner: 'BASIS_ENGINE',
    ownerId: 'bp_lx8m_1',
    canonicalProjectionId: 'cprop_abc123',
    correlationId: 'basis_lx8m_2',
    revisionDigest: null,
  });
  assert.equal(alias.ownerId, 'bp_lx8m_1');
  assert.equal(alias.correlationId, 'basis_lx8m_2');
  assert.deepEqual(validateOpaqueIdentityAlias(alias), []);
  assert.equal(Object.isFrozen(alias), true);
  assert.ok(DIALECT_LOSS_CODES.includes('SOURCE_ID_DERIVED'));
  assert.ok(DIALECT_LOSS_CODES.includes('REVISION_UNAVAILABLE'));
});

test('origin failures translate without widening Foundation StructuredFailure', () => {
  const source = makeStableFailure(
    'STALE_SOURCE',
    'intelligence_evidence',
    'source is stale',
    'truth.freshness',
    ['evidence:1'],
  );
  const projection = translateStableFailureToStructuredFailure(source, {
    ...CONTEXT,
    stage: 'normalize',
    recommendedOperatorAction: 'Refresh the public source.',
  });
  assert.deepEqual(Object.keys(projection.failure), STRUCTURED_FAILURE_KEYS);
  assert.equal(projection.origin.kind, 'MARKET_INTELLIGENCE');
  assert.equal(projection.origin.failureId, source.id);
  assert.deepEqual(projection.origin.evidenceIds, ['evidence:1']);
  assert.equal(projection.losses[0].code, 'ORIGIN_FAILURE_FIELDS_RETAINED_IN_TRACE');
});

test('runtime free-form failure detail is redacted at the canonical boundary', () => {
  const projection = translateRuntimeErrorToStructuredFailure({
    code: 'SOCKET_FAILED',
    message: 'raw upstream detail that must not cross',
    retryable: true,
    observedAtMs: NOW - 1,
    recommendedAction: 'raw action',
  }, {
    ...CONTEXT,
    sourceId: 'runtime-source:spot',
    stage: 'probe',
    recommendedOperatorAction: 'Inspect the public source.',
  });
  assert.deepEqual(Object.keys(projection.failure), STRUCTURED_FAILURE_KEYS);
  assert.doesNotMatch(projection.failure.message, /raw upstream detail/);
  assert.ok(projection.losses.some((loss) => loss.code === 'ORIGIN_FAILURE_DETAIL_REDACTED'));
});

test('source registry enforces one semantic producer and no private authority', () => {
  const snapshot = createSystemSourceRegistrySnapshot({
    revision: 1,
    evaluatedAtMs: NOW,
    records: [sourceRecord()],
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.records[0]), true);
  assert.deepEqual(validateSystemSourceRegistrySnapshot(snapshot), []);
  const duplicate = validateSystemSourceRegistrySnapshot({
    revision: 2,
    evaluatedAtMs: NOW,
    records: [sourceRecord(), sourceRecord({ sourceId: 'runtime-source:duplicate' })],
  });
  assert.ok(duplicate.some((entry) => entry.code === 'DUPLICATE_SEMANTIC_PRODUCER'));
  const privateClaim = validateSystemSourceRegistrySnapshot({
    revision: 1,
    evaluatedAtMs: NOW,
    records: [sourceRecord({ maximumAuthority: 'LIVE_PRIVATE' })],
  });
  assert.ok(privateClaim.some((entry) => entry.code === 'AUTHORITY_INVALID'));
});

test('release and component validation prevents dry-run/live and READY/unknown conflicts', () => {
  assert.ok(validateReleaseStatuses(['LIVE_PUBLIC']).some((entry) => entry.code === 'LIVE_REQUIRES_WIRED'));
  assert.ok(validateReleaseStatuses(['MISSING', 'WIRED']).some((entry) => entry.code === 'MISSING_STATUS_CONFLICT'));
  const component = {
    componentId: 'execution-coordinator-validate-only',
    owner: 'BACKEND_FOUNDATION_EXECUTION',
    ownerPath: 'server/src/foundation/execution',
    releaseStatuses: ['IMPORTED', 'WIRED', 'LIVE_PUBLIC'],
    truthLabel: 'DRY_RUN',
    desiredState: 'RUNNING',
    phase: 'RUNNING',
    domainObservedState: 'READY',
    sourceLifecycle: null,
    readiness: 'READY',
    authority: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    sourceTimestamp: null,
    freshness: null,
    lastReceiveAtMs: null,
    lastProcessAtMs: NOW,
    lastSuccessAtMs: NOW,
    dependencies: ['multileg-risk'],
    queue: null,
    lastFailure: null,
    blockerCodes: [],
    generation: 1,
    restartCount: 0,
    supportedControls: ['RESTART_COMPONENT'],
    capitalExposed: false,
    operatorAttentionRequired: false,
  };
  const issues = validateSystemComponentSnapshot(component);
  assert.ok(issues.some((entry) => entry.code === 'LIVE_TRUTH_CONFLICT'));
  assert.ok(issues.some((entry) => entry.code === 'READY_TRUTH_INVALID'));
});

test('LIVE_PUBLIC component truth requires matching release and public authority evidence', () => {
  const forged = liveComponent({
    releaseStatuses: ['MISSING'],
    authority: 'UNAVAILABLE',
    sourceTimestamp: null,
    freshness: null,
  });
  const issues = validateSystemComponentSnapshot(forged);
  assert.ok(issues.some((entry) => entry.code === 'LIVE_TRUTH_RELEASE_REQUIRED'));
  assert.ok(issues.some((entry) => entry.code === 'LIVE_TRUTH_AUTHORITY_INVALID'));
  assert.ok(issues.some((entry) => entry.code === 'READY_LIVE_FRESHNESS_REQUIRED'));

  assert.deepEqual(validateSystemComponentSnapshot(liveComponent()), []);
  assert.deepEqual(validateSystemComponentSnapshot(liveComponent({
    componentId: 'ledger-persistence',
    owner: 'EXISTING_LEDGER',
    ownerPath: 'server/src/db.ts',
    domainObservedState: 'WRITABLE',
    sourceLifecycle: null,
    sourceTimestamp: null,
    freshness: null,
    dependencies: [],
  })), []);
});

test('READY live source truth rejects stale, forged, or misaligned freshness', () => {
  const base = liveComponent();
  const stale = validateSystemComponentSnapshot(liveComponent({
    freshness: {
      ...base.freshness,
      state: 'STALE',
      effectiveAuthority: 'UNAVAILABLE',
    },
  }));
  assert.ok(stale.some((entry) => entry.code === 'FRESHNESS_SOURCE_MISMATCH'));
  assert.ok(stale.some((entry) => entry.code === 'LIVE_FRESHNESS_INVALID'));
  assert.ok(stale.some((entry) => entry.code === 'READY_LIVE_FRESHNESS_INVALID'));

  const forgedAge = validateSystemComponentSnapshot(liveComponent({
    freshness: { ...base.freshness, ageMs: 0 },
  }));
  assert.ok(forgedAge.some((entry) => entry.code === 'FRESHNESS_SOURCE_MISMATCH'));

  const unavailableSource = validateSystemComponentSnapshot(liveComponent({
    sourceTimestamp: { ...base.sourceTimestamp, authority: 'UNAVAILABLE' },
    freshness: {
      state: 'UNAVAILABLE',
      ageMs: null,
      basis: 'NONE',
      effectiveAuthority: 'UNAVAILABLE',
      evaluatedAt: NOW,
    },
  }));
  assert.ok(unavailableSource.some((entry) => entry.code === 'LIVE_SOURCE_AUTHORITY_INVALID'));
  assert.ok(unavailableSource.some((entry) => entry.code === 'READY_LIVE_FRESHNESS_INVALID'));

  const derivedTimestamp = { ...base.sourceTimestamp, authority: 'DERIVED_LIVE' };
  const authorityUpgrade = validateSystemComponentSnapshot(liveComponent({
    sourceTimestamp: derivedTimestamp,
    freshness: evaluateFreshness(derivedTimestamp, NOW),
  }));
  assert.ok(authorityUpgrade.some((entry) => entry.code === 'LIVE_AUTHORITY_UPGRADE'));
});

test('LIVE_PUBLIC trace truth requires matching release evidence and excludes authority smuggling', () => {
  const base = {
    id: 'trace:live:1',
    sequence: 1,
    kind: 'SOURCE',
    componentId: 'public-spot-source',
    correlationId: 'cor_trace_live_1',
    occurredAtMs: NOW,
    persistedAtMs: null,
    truthLabel: 'LIVE_PUBLIC',
    releaseStatuses: ['WIRED', 'LIVE_PUBLIC'],
    ownerId: 'runtime-source:spot-test',
    canonicalProjectionId: null,
    revisionDigest: null,
    domainLifecycle: 'LIVE',
    machinePhase: 'RUNNING',
    failure: null,
    referenceIds: ['book:1'],
    lossCodes: [],
  };
  assert.deepEqual(validateSystemTraceEvent(base), []);

  const missing = validateSystemTraceEvent({ ...base, releaseStatuses: ['MISSING'] });
  assert.ok(missing.some((entry) => entry.code === 'LIVE_TRACE_RELEASE_REQUIRED'));
  assert.ok(missing.some((entry) => entry.code === 'LIVE_TRACE_UNAVAILABLE_CONFLICT'));

  const forgedAuthority = validateSystemTraceEvent({ ...base, authority: 'UNAVAILABLE' });
  assert.ok(forgedAuthority.some((entry) => entry.code === 'UNKNOWN_FIELD' && entry.path === 'authority'));

  const downgraded = validateSystemTraceEvent({ ...base, lossCodes: ['STALE_AUTHORITY_DOWNGRADED'] });
  assert.ok(downgraded.some((entry) => entry.code === 'LIVE_TRACE_AUTHORITY_CONFLICT'));
});

test('control and trace validators reject live mode and forged live labels', () => {
  const request = {
    idempotencyKey: 'mode-change:0001',
    expectedRevision: 3,
    reason: 'Validate the bounded dry-run chain.',
    requestedAtMs: NOW,
    correlationId: 'cor_control_1',
    mutation: { command: 'SET_SAFE_MODE', safeMode: 'LIVE' },
  };
  assert.ok(validateSystemControlMutationRequest(request).some((entry) => entry.code === 'SAFE_MODE_INVALID'));
  const trace = {
    id: 'trace:1',
    sequence: 1,
    kind: 'EXECUTION',
    componentId: 'execution-coordinator-validate-only',
    correlationId: 'cor_control_1',
    occurredAtMs: NOW,
    persistedAtMs: null,
    truthLabel: 'DRY_RUN',
    releaseStatuses: ['IMPORTED', 'WIRED', 'LIVE_PUBLIC'],
    ownerId: 'plan_dry_1',
    canonicalProjectionId: null,
    revisionDigest: null,
    domainLifecycle: 'READY',
    machinePhase: 'RUNNING',
    failure: null,
    referenceIds: ['proposal:1'],
    lossCodes: ['SOURCE_ID_DERIVED', 'REVISION_UNAVAILABLE'],
  };
  assert.ok(validateSystemTraceEvent(trace).some((entry) => entry.code === 'LIVE_TRUTH_CONFLICT'));
});
