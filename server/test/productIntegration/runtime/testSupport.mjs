import { SYSTEM_COMPONENT_IDS } from '../../../dist/systemIntegration/contracts/constants.js';

export const T0 = 1_800_000_000_000;

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
  return Object.freeze({
    componentId,
    owner: componentId === 'engine-supervisor' ? 'SYSTEM_INTEGRATION' : 'AUDITED_APP',
    ownerPath: componentId === 'engine-supervisor' ? 'server/src/systemIntegration/**' : `owner/${componentId}`,
    releaseStatuses: Object.freeze(publicSource ? ['BUILT_AND_TESTED', 'WIRED', 'LIVE_PUBLIC'] : ['BUILT_AND_TESTED', 'WIRED']),
    truthLabel: publicSource ? 'LIVE_PUBLIC' : 'DRY_RUN',
    desiredState: 'RUNNING',
    phase: 'RUNNING',
    domainObservedState: 'READY',
    sourceLifecycle: null,
    readiness: 'READY',
    authority: publicSource ? 'LIVE_PUBLIC' : 'DERIVED_LIVE',
    completeness: 'COMPLETE',
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
    lastReceiveAtMs: T0 - 800 - index,
    lastProcessAtMs: T0 - 700 - index,
    lastSuccessAtMs: T0 - 500 - index,
    dependencies: Object.freeze(index === 0 ? [] : [SYSTEM_COMPONENT_IDS[index - 1]]),
    queue: Object.freeze({ depth: index % 3, capacity: 100, dropped: 0, coalesced: 0, observedAtMs: T0 - 100 }),
    lastFailure: null,
    blockerCodes: Object.freeze([]),
    generation: 1,
    restartCount: 0,
    supportedControls: Object.freeze(componentId === 'engine-supervisor'
      ? ['SET_SAFE_MODE', 'SET_KILL_SWITCH', 'SET_INTAKE_PAUSED', 'RESTART_COMPONENT']
      : []),
    capitalExposed: false,
    operatorAttentionRequired: false,
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
    control: Object.freeze({ revision: 3, generation: 2, safeMode: 'READ_ONLY', killSwitchEngaged: false, intakePaused: false, updatedAtMs: T0 - 200, correlationId: 'cor_control_test' }),
    truthLabel: 'DRY_RUN',
    components,
    edges,
    rootBlockerComponentIds: Object.freeze([]),
    operatorAttentionComponentIds: Object.freeze([]),
    overallPosture: 'READY',
    runtimeGeneration: 4,
    controlGeneration: 2,
    firstRootBlockerComponentId: null,
    rootCauses: Object.freeze([]),
    attentionQueue: Object.freeze([]),
    summaries: Object.freeze({
      sourceCoverage: Object.freeze({ truthLabel: 'LIVE_PUBLIC', universeSymbols: 10, spotCoveredSymbols: 10, usdMCoveredSymbols: 10, quietSymbolsRetained: 10, materialGapCount: 0, rateLimitedSourceCount: 0, lastMaterialGapAtMs: null }),
      strategies: Object.freeze({
        basis: Object.freeze({ truthLabel: 'DRY_RUN', heartbeatAtMs: T0 - 500, candidateCount: 1, proposalCount: 0, rejectionCount: 1, acceptedCount: 0, lastDecisionAtMs: T0 - 500, sourceRevision: 'basis-1' }),
        volume: Object.freeze({ truthLabel: 'DRY_RUN', heartbeatAtMs: T0 - 500, candidateCount: 1, proposalCount: 0, rejectionCount: 1, acceptedCount: 0, lastDecisionAtMs: T0 - 500, sourceRevision: 'volume-1' }),
      }),
      intelligence: Object.freeze({ truthLabel: 'LIVE_PUBLIC', evidenceCount: 2, attentionCount: 0, focusRequestedCount: 0, focusActiveCount: 0, thesisCount: 0, insufficientEvidenceCount: 0, lastUpdateAtMs: T0 - 500 }),
      capital: Object.freeze({ truthLabel: 'DRY_RUN', accountTruthState: 'NOT_CONFIGURED', allocatableAmount: null, reservedAmount: null, activeExposureAmount: '0.00 USDT', eligibleCount: 0, reservationCount: 0, stagedMandateCount: 0, activeExposureCount: 0, checkpointRevision: 'capital-1', blockerCodes: Object.freeze([]) }),
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
