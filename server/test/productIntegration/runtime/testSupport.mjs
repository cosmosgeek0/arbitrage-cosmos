import { SYSTEM_COMPONENT_IDS } from '../../../dist/systemIntegration/contracts/constants.js';

export const T0 = Date.parse('2026-08-01T00:00:00Z');

export const Q_READINESS_WAIVER = Object.freeze({
  id: 'READINESS-CLUSTER-001-Q-INFERENCE',
  scope: 'KEYLESS_PUBLIC_DATA_VALIDATE_ONLY',
  mode: 'VALIDATE_ONLY',
  reason: 'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED',
  owner: 'cosmosgeek',
  expiresAt: '2026-10-18T00:00:00Z',
  status: 'VALID',
});

export const VALID_SERVICE_READINESS_POLICY = Object.freeze({
  status: 'VALID',
  accepted: true,
  reasonCode: 'READINESS_POLICY_VALID',
  waiver: Q_READINESS_WAIVER,
});

const Q_BLOCKER_CODES = Object.freeze([
  'FRESHNESS_NOT_REPORTED',
  'Q_CLIENT_NOT_CONFIGURED',
  'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
  'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
  'Q_TRANSPORT_NOT_CONFIGURED',
  'RELEASE_NOT_AVAILABLE',
  'TRUTH_UNAVAILABLE',
]);

function serviceReadinessBasis(componentId) {
  if (['capital-supervision', 'multileg-risk', 'execution-coordinator-validate-only', 'reconciliation'].includes(componentId)) {
    return 'VALIDATE_ONLY_EXECUTOR';
  }
  if (componentId === 'ledger-persistence') return 'PERSISTENCE';
  if (componentId === 'engine-supervisor') return 'MANAGED_LIFECYCLE';
  return 'PUBLIC_DATA';
}

export function makeOpsReadback(overrides = {}) {
  return Object.freeze({
    source: 'CANONICAL_SUPERVISOR_READBACK',
    observedAtUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
    validUntilUtc: new Date(T0 + 10 * 60_000).toISOString().replace('.000Z', 'Z'),
    deploymentFrozen: false,
    exposureState: 'NONE',
    ambiguityState: 'NONE',
    recoveryState: 'NONE',
    currentSchemaVersion: 1,
    rollbackFloor: 1,
    ...overrides,
  });
}

export function makeOpsInterlock(overrides = {}) {
  return Object.freeze({
    source: 'CANONICAL_OPS_INTAKE_INTERLOCK',
    state: 'OPS_INTERLOCK_CLEAR',
    blocksNewEntries: false,
    externalActionAuthorization: 'NONE',
    evaluatedAtUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
    readbackValidUntilUtc: new Date(T0 + 10 * 60_000).toISOString().replace('.000Z', 'Z'),
    reasonCodes: Object.freeze([]),
    ...overrides,
  });
}

export function makeBootReleaseReadback(recordOverrides = {}, readbackOverrides = {}) {
  const latest = Object.freeze({
    operationId: 'system.application.boot.g7',
    operationType: 'APPLICATION_BOOT',
    generation: 7,
    testedCommit: 'a'.repeat(40),
    deployedCommit: 'b'.repeat(40),
    configRevision: 'config.release.17',
    schemaRevision: '1',
    modelRevision: 'model.champion.4',
    startedAtMs: T0 - 5_000,
    completedAtMs: null,
    clean: null,
    blockerCode: null,
    correlationId: 'system-boot-g7',
    ledgerEventId: 71,
    lifecycleState: 'ACTIVE',
    identityState: 'AVAILABLE',
    identityIssues: Object.freeze([]),
    deploymentMutationAuthority: 'NONE',
    ...recordOverrides,
  });
  return Object.freeze({
    source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
    state: 'AVAILABLE',
    latest,
    history: Object.freeze([latest]),
    crashPendingOperationIds: Object.freeze([]),
    reasonCodes: Object.freeze([]),
    ...readbackOverrides,
  });
}

function component(componentId, index) {
  const publicSource = componentId === 'public-spot-source' || componentId === 'public-usdm-source';
  const qAbstention = componentId === 'q-inference';
  return Object.freeze({
    componentId,
    owner: componentId === 'engine-supervisor'
      ? 'SYSTEM_INTEGRATION'
      : qAbstention ? 'Q_INFERENCE' : 'AUDITED_APP',
    ownerPath: componentId === 'engine-supervisor'
      ? 'server/src/systemIntegration/**'
      : qAbstention ? 'quant/src/quant_edge/inference' : `owner/${componentId}`,
    releaseStatuses: Object.freeze(qAbstention
      ? ['BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED']
      : publicSource ? ['BUILT_AND_TESTED', 'WIRED', 'LIVE_PUBLIC'] : ['BUILT_AND_TESTED', 'WIRED']),
    truthLabel: qAbstention ? 'UNAVAILABLE' : publicSource ? 'LIVE_PUBLIC' : 'DRY_RUN',
    desiredState: 'RUNNING',
    phase: qAbstention ? 'BLOCKED' : 'RUNNING',
    domainObservedState: qAbstention ? 'ABSTAIN_UNKNOWN' : 'READY',
    sourceLifecycle: null,
    readiness: qAbstention ? 'BLOCKED' : 'READY',
    authority: qAbstention ? 'UNAVAILABLE' : publicSource ? 'LIVE_PUBLIC' : 'DERIVED_LIVE',
    completeness: qAbstention ? 'UNAVAILABLE' : 'COMPLETE',
    sourceTimestamp: publicSource ? Object.freeze({
      sourceTimeMs: T0 - 1_000,
      receivedAtMs: T0 - 900,
      maxAgeMs: 5_000,
      authority: 'LIVE_PUBLIC',
      completeness: 'COMPLETE',
      sourceId: `test.${componentId}`,
    }) : null,
    freshness: publicSource ? Object.freeze({
      state: 'FRESH',
      ageMs: 900,
      basis: 'SOURCE_TIME',
      effectiveAuthority: 'LIVE_PUBLIC',
      evaluatedAt: T0 - 100,
    }) : null,
    ...(qAbstention ? {
      processingLagMs: null,
      retry: Object.freeze({
        state: 'UNAVAILABLE', attempt: null, ceiling: null, delayMs: null,
        retryAtMs: null, cooldownUntilMs: null,
      }),
      dataQuality: Object.freeze({
        state: 'UNAVAILABLE', invalidCount: null, duplicateCount: null,
        outOfOrderCount: null, sequenceGapCount: null, observedAtMs: null,
      }),
      checkpoint: Object.freeze({ state: 'UNAVAILABLE', revision: null, persistedAtMs: null }),
    } : {}),
    lastReceiveAtMs: qAbstention ? null : T0 - 800 - index,
    lastProcessAtMs: qAbstention ? null : T0 - 700 - index,
    lastSuccessAtMs: qAbstention ? null : T0 - 500 - index,
    dependencies: Object.freeze(index === 0 ? [] : [SYSTEM_COMPONENT_IDS[index - 1]]),
    queue: qAbstention
      ? null
      : Object.freeze({ depth: index % 3, capacity: 100, dropped: 0, coalesced: 0, observedAtMs: T0 - 100 }),
    lastFailure: null,
    blockerCodes: qAbstention ? Q_BLOCKER_CODES : Object.freeze([]),
    generation: qAbstention ? 0 : 1,
    restartCount: 0,
    supportedControls: Object.freeze(componentId === 'engine-supervisor'
      ? ['SET_SAFE_MODE', 'SET_KILL_SWITCH', 'SET_INTAKE_PAUSED', 'RESTART_COMPONENT']
      : []),
    capitalExposed: false,
    operatorAttentionRequired: qAbstention,
    serviceReadiness: Object.freeze({
      basis: serviceReadinessBasis(componentId),
      expected: true,
      observed: true,
      requiredForServiceReadiness: !qAbstention,
      excludedFromServiceReadiness: qAbstention,
      waiver: qAbstention ? Q_READINESS_WAIVER : null,
    }),
  });
}

export function makeSupervisor(overrides = {}) {
  const components = Object.freeze(SYSTEM_COMPONENT_IDS.map(component));
  const edges = Object.freeze(SYSTEM_COMPONENT_IDS.slice(1).map((componentId, index) => Object.freeze({
    from: SYSTEM_COMPONENT_IDS[index], to: componentId, required: true, state: 'AVAILABLE', rootBlockerComponentId: null, reasonCodes: Object.freeze([]),
  })));
  return Object.freeze({
    schemaVersion: 1,
    revision: 7,
    evaluatedAtMs: T0 - 100,
    phase: 'RUNNING',
    control: Object.freeze({ revision: 3, generation: 2, safeMode: 'VALIDATE_ONLY', killSwitchEngaged: false, intakePaused: false, updatedAtMs: T0 - 200, correlationId: 'cor_control_test' }),
    truthLabel: 'DRY_RUN',
    components,
    edges,
    rootBlockerComponentIds: Object.freeze(['q-inference']),
    operatorAttentionComponentIds: Object.freeze(['q-inference']),
    overallPosture: 'READY',
    runtimeGeneration: 4,
    controlGeneration: 2,
    serviceReadinessPolicy: VALID_SERVICE_READINESS_POLICY,
    firstRequiredReadinessBlockerComponentId: null,
    firstRootBlockerComponentId: 'q-inference',
    rootCauses: Object.freeze([Object.freeze({
      componentId: 'q-inference',
      severity: 'HIGH',
      reasonCodes: Q_BLOCKER_CODES,
      failure: null,
      dependencyPath: Object.freeze(['q-inference']),
      affectedComponentIds: Object.freeze(['q-inference']),
      capitalExposed: false,
    })]),
    attentionQueue: Object.freeze([Object.freeze({
      componentId: 'q-inference',
      rootComponentId: 'q-inference',
      severity: 'HIGH',
      reasonCodes: Q_BLOCKER_CODES,
      capitalExposed: false,
      recommendedOperatorAction: null,
    })]),
    summaries: Object.freeze({
      sourceCoverage: Object.freeze({ truthLabel: 'LIVE_PUBLIC', universeSymbols: 10, spotCoveredSymbols: 10, usdMCoveredSymbols: 10, quietSymbolsRetained: 10, materialGapCount: 0, rateLimitedSourceCount: 0, lastMaterialGapAtMs: null }),
      strategies: Object.freeze({
        basis: Object.freeze({ truthLabel: 'DRY_RUN', heartbeatAtMs: T0 - 500, candidateCount: 1, proposalCount: 0, cooldownCount: 0, rejectionCount: 1, acceptedCount: 0, lastDecisionAtMs: T0 - 500, sourceRevision: 'basis-1' }),
        volume: Object.freeze({ truthLabel: 'DRY_RUN', heartbeatAtMs: T0 - 500, candidateCount: 1, proposalCount: 0, cooldownCount: 0, rejectionCount: 1, acceptedCount: 0, lastDecisionAtMs: T0 - 500, sourceRevision: 'volume-1' }),
      }),
      intelligence: Object.freeze({ truthLabel: 'LIVE_PUBLIC', evidenceCount: 2, attentionCount: 0, focusRequestedCount: 0, focusActiveCount: 0, thesisCount: 0, insufficientEvidenceCount: 0, lastUpdateAtMs: T0 - 500 }),
      capital: Object.freeze({ truthLabel: 'DRY_RUN', accountTruthState: 'NOT_CONFIGURED', allocatableAmount: null, reservedAmount: null, activeExposureAmount: '0.00 USDT', eligibleCount: 0, reservationCount: 0, stagedMandateCount: 0, activeExposureCount: 0, recoveryCount: 0, checkpointRevision: 'capital-1', blockerCodes: Object.freeze([]) }),
      risk: Object.freeze({ truthLabel: 'DRY_RUN', latestVerdict: 'UNAVAILABLE', latestVerdictAtMs: null, latestVerdictId: null, correlationId: null, maxAllowedSize: null, requiredConfirmation: null, decisiveInputSnapshot: Object.freeze([]), rejectionCount: 0, reasonCodes: Object.freeze(['LIVE_EXECUTION_NOT_IMPLEMENTED']) }),
      execution: Object.freeze({ truthLabel: 'DRY_RUN', mode: 'VALIDATE_ONLY', barrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED', planId: null, planLifecycle: null, coordinatorState: 'VALIDATE_ONLY', legCount: 0, recoveryState: null, lastTransitionAtMs: null }),
      reconciliation: Object.freeze({ truthLabel: 'DRY_RUN', status: 'EXACT', blocksNewExposure: false, recommendation: null, checkpointId: 'recon-1', evaluatedAtMs: T0 - 500, reasonCodes: Object.freeze([]) }),
      ledger: Object.freeze({ truthLabel: 'DRY_RUN', writable: true, schemaCompatibilityState: 'AVAILABLE', schemaCompatibilityReason: null, currentSchemaVersion: 1, rollbackFloor: 1, lastEventId: 'evt-2', lastPersistedAtMs: T0 - 100, checkpointRevision: 'ledger-1', recentTraceCount: 2, lastCleanShutdownAtMs: null }),
    }),
    traceIndex: Object.freeze({ evaluatedAtMs: T0, entries: Object.freeze([]), totalInputEvents: 2, uniqueEventCount: 2, duplicateEventCount: 0, truncated: false }),
    recentCorrelatedDecisions: Object.freeze([]),
    ...overrides,
  });
}

export function traceEvent(id, sequence, kind, componentId, correlationId = 'cor_trace_1') {
  return Object.freeze({
    id, sequence, kind, componentId, correlationId,
    occurredAtMs: T0 - 1_000 + sequence,
    persistedAtMs: T0 - 900 + sequence,
    truthLabel: kind === 'SOURCE' ? 'LIVE_PUBLIC' : 'DRY_RUN',
    releaseStatuses: Object.freeze(kind === 'SOURCE' ? ['BUILT_AND_TESTED', 'WIRED', 'LIVE_PUBLIC'] : ['BUILT_AND_TESTED', 'WIRED']),
    ownerId: null, canonicalProjectionId: `projection-${id}`, revisionDigest: null,
    domainLifecycle: kind, machinePhase: 'RUNNING', failure: null,
    referenceIds: Object.freeze([]), lossCodes: Object.freeze([]),
  });
}

export function makeRecords() {
  return Object.freeze([
    Object.freeze({ cursor: '1', event: traceEvent('evt-1', 1, 'SOURCE', 'public-spot-source') }),
    Object.freeze({ cursor: '2', event: traceEvent('evt-2', 2, 'STRATEGY', 'basis-engine') }),
  ]);
}

export function makeRead({ applicationStartOk = true, applicationStartFailureCodes = [], supervisor = makeSupervisor(), records = makeRecords(), traceEvents = makeRecords().map((record) => record.event), bootReleaseReadback } = {}) {
  const read = {
    applicationStartOk: () => applicationStartOk,
    applicationStartFailureCodes: () => applicationStartFailureCodes,
    supervisor: () => supervisor,
    opsReadback: () => makeOpsReadback(),
    events({ afterCursor, limit }) {
      const after = BigInt(afterCursor);
      const selected = records.filter((record) => BigInt(record.cursor) > after).slice(0, limit);
      return Object.freeze({
        requestedAfterCursor: afterCursor,
        retainedFromCursor: records[0]?.cursor ?? null,
        highWaterCursor: records.at(-1)?.cursor ?? '0',
        continuity: records.length > 0 && after + 1n < BigInt(records[0].cursor) ? 'GAP' : 'PROVEN',
        truncated: records.length > 0 && after + 1n < BigInt(records[0].cursor),
        items: Object.freeze(selected),
      });
    },
    trace(correlationId, limit) {
      if (correlationId !== 'cor_trace_1') return null;
      return Object.freeze({ correlationId, evaluatedAtMs: T0, events: Object.freeze(traceEvents.slice(0, limit)), truncated: false });
    },
  };
  return Object.freeze(bootReleaseReadback === undefined
    ? read
    : { ...read, bootReleaseReadback: () => bootReleaseReadback });
}
