import {
  SYSTEM_COMPONENT_IDS,
} from '../../../dist/systemIntegration/contracts/constants.js';
import { evaluateFreshness } from '../../../dist/foundation/contracts/index.js';
import { SIGNED_Q_READINESS_WAIVER } from '../../../dist/systemIntegration/supervisor/readinessPolicy.js';

export const NOW = Date.parse('2026-08-01T00:00:00Z');
export const CORRELATION = 'cor_supervisor_fixture_1';

const OWNER = {
  'public-spot-source': 'INTELLIGENCE_RUNTIME',
  'public-usdm-source': 'INTELLIGENCE_RUNTIME',
  'market-universe': 'INTELLIGENCE_RUNTIME',
  'intelligence-runtime': 'INTELLIGENCE_RUNTIME',
  'market-intelligence': 'MARKET_INTELLIGENCE',
  'q-inference': 'Q_INFERENCE',
  'basis-engine': 'BASIS_ENGINE',
  'volume-engine': 'VOLUME_ENGINE',
  'capital-supervision': 'CAPITAL_SUPERVISION',
  'multileg-risk': 'BACKEND_FOUNDATION_RISK',
  'execution-coordinator-validate-only': 'BACKEND_FOUNDATION_EXECUTION',
  reconciliation: 'BACKEND_FOUNDATION_RECONCILIATION',
  'ledger-persistence': 'EXISTING_LEDGER',
  'engine-supervisor': 'SYSTEM_INTEGRATION',
};

const FRESH_COMPONENTS = new Set([
  'public-spot-source',
  'public-usdm-source',
  'market-universe',
  'intelligence-runtime',
  'market-intelligence',
  'basis-engine',
  'volume-engine',
]);

const DRY_COMPONENTS = new Set([
  'multileg-risk',
  'execution-coordinator-validate-only',
  'reconciliation',
]);

export function failure(componentId, code, over = {}) {
  return {
    component: componentId,
    stage: 'owner-probe',
    code,
    message: `${componentId} reported ${code}`,
    occurredAt: NOW - 100,
    retryable: true,
    safeCurrentState: 'BLOCKED',
    recommendedOperatorAction: `Inspect ${componentId}.`,
    correlationId: CORRELATION,
    ...over,
  };
}

export function component(componentId, over = {}) {
  const dry = DRY_COMPONENTS.has(componentId);
  const fresh = FRESH_COMPONENTS.has(componentId);
  const qAbstention = componentId === 'q-inference';
  const sourceTimestamp = fresh ? {
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 80,
    maxAgeMs: 5_000,
    authority: 'LIVE_PUBLIC',
    completeness: 'COMPLETE',
    sourceId: `fixture.${componentId}`,
  } : null;
  return {
    componentId,
    owner: OWNER[componentId],
    ownerPath: `server/src/${componentId}`,
    releaseStatuses: qAbstention
      ? ['BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED']
      : dry
      ? ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY']
      : ['BUILT_AND_TESTED', 'WIRED', 'LIVE_PUBLIC'],
    truthLabel: qAbstention ? 'UNAVAILABLE' : dry ? 'DRY_RUN' : 'LIVE_PUBLIC',
    desiredState: 'RUNNING',
    phase: qAbstention ? 'BLOCKED' : 'RUNNING',
    domainObservedState: qAbstention ? 'ABSTAIN_UNKNOWN' : 'RUNNING',
    sourceLifecycle: null,
    readiness: qAbstention ? 'BLOCKED' : 'READY',
    authority: qAbstention ? 'UNAVAILABLE' : dry ? 'SYNTHETIC_TEST' : 'LIVE_PUBLIC',
    completeness: qAbstention ? 'UNAVAILABLE' : 'COMPLETE',
    sourceTimestamp,
    freshness: sourceTimestamp ? evaluateFreshness(sourceTimestamp, NOW) : null,
    lastReceiveAtMs: fresh ? NOW - 80 : null,
    lastProcessAtMs: fresh ? NOW - 60 : null,
    lastSuccessAtMs: qAbstention ? null : NOW - 40,
    dependencies: qAbstention ? ['market-intelligence'] : [],
    queue: null,
    lastFailure: null,
    blockerCodes: qAbstention ? [
      'Q_CLIENT_NOT_CONFIGURED',
      'Q_TRANSPORT_NOT_CONFIGURED',
      'Q_OWNER_OBSERVATION_NOT_CONFIGURED',
      'Q_SAFE_FALLBACK_ABSTAIN_UNKNOWN',
    ] : [],
    generation: qAbstention ? 0 : 1,
    restartCount: 0,
    supportedControls: [],
    capitalExposed: false,
    operatorAttentionRequired: qAbstention,
    ...over,
  };
}

export function components(overrides = {}) {
  return SYSTEM_COMPONENT_IDS.map((componentId) => component(componentId, overrides[componentId] ?? {}));
}

export function summaries(over = {}) {
  const base = {
    sourceCoverage: {
      truthLabel: 'LIVE_PUBLIC',
      universeSymbols: 400,
      spotCoveredSymbols: 400,
      usdMCoveredSymbols: 320,
      quietSymbolsRetained: 80,
      materialGapCount: 0,
      rateLimitedSourceCount: 0,
      lastMaterialGapAtMs: null,
    },
    strategies: {
      basis: {
        truthLabel: 'LIVE_PUBLIC',
        heartbeatAtMs: NOW - 50,
        candidateCount: 3,
        proposalCount: 1,
        cooldownCount: 1,
        rejectionCount: 2,
        acceptedCount: 1,
        lastDecisionAtMs: NOW - 75,
        sourceRevision: 'basis-rev-7',
      },
      volume: {
        truthLabel: 'LIVE_PUBLIC',
        heartbeatAtMs: NOW - 45,
        candidateCount: 4,
        proposalCount: 1,
        cooldownCount: 2,
        rejectionCount: 3,
        acceptedCount: 0,
        lastDecisionAtMs: NOW - 70,
        sourceRevision: 'volume-rev-5',
      },
    },
    intelligence: {
      truthLabel: 'LIVE_PUBLIC',
      evidenceCount: 100,
      attentionCount: 4,
      focusRequestedCount: 2,
      focusActiveCount: 1,
      thesisCount: 1,
      insufficientEvidenceCount: 3,
      lastUpdateAtMs: NOW - 40,
    },
    capital: {
      truthLabel: 'SYNTHETIC_ONLY',
      accountTruthState: 'SYNTHETIC_FIXTURE',
      allocatableAmount: '1000.00',
      reservedAmount: '100.00',
      activeExposureAmount: '0',
      eligibleCount: 1,
      reservationCount: 1,
      stagedMandateCount: 1,
      activeExposureCount: 0,
      recoveryCount: 0,
      checkpointRevision: 'capital-checkpoint-3',
      blockerCodes: [],
    },
    risk: {
      truthLabel: 'DRY_RUN',
      latestVerdict: 'APPROVE',
      latestVerdictAtMs: NOW - 30,
      latestVerdictId: 'risk-verdict-1',
      correlationId: 'corr-risk-verdict-1',
      maxAllowedSize: '200',
      requiredConfirmation: false,
      decisiveInputSnapshot: [{
        code: 'MAX_GROSS_NOTIONAL', status: 'PASS', detail: 'Exact evaluated gross size is within the cap.',
        observed: '200', limit: '400', evidenceTimestamp: NOW - 30,
      }],
      rejectionCount: 0,
      reasonCodes: [],
    },
    execution: {
      truthLabel: 'DRY_RUN',
      mode: 'VALIDATE_ONLY',
      barrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
      planId: 'plan-dry-1',
      planLifecycle: 'PLANNED',
      coordinatorState: 'VALIDATED',
      legCount: 2,
      recoveryState: null,
      lastTransitionAtMs: NOW - 20,
    },
    reconciliation: {
      truthLabel: 'DRY_RUN',
      status: 'MATCHED',
      blocksNewExposure: false,
      recommendation: null,
      checkpointId: 'recon-checkpoint-1',
      evaluatedAtMs: NOW - 10,
      reasonCodes: [],
    },
    ledger: {
      truthLabel: 'LIVE_PUBLIC',
      writable: true,
      schemaCompatibilityState: 'AVAILABLE',
      schemaCompatibilityReason: null,
      currentSchemaVersion: 1,
      rollbackFloor: 1,
      lastEventId: '100',
      lastPersistedAtMs: NOW - 5,
      checkpointRevision: 'ledger-rev-10',
      recentTraceCount: 2,
      lastCleanShutdownAtMs: null,
    },
  };
  return {
    ...base,
    ...over,
    strategies: { ...base.strategies, ...(over.strategies ?? {}) },
  };
}

export function traceEvent(over = {}) {
  return {
    id: 'trace-event-1',
    sequence: 1,
    kind: 'STRATEGY',
    componentId: 'basis-engine',
    correlationId: CORRELATION,
    occurredAtMs: NOW - 25,
    persistedAtMs: NOW - 20,
    truthLabel: 'LIVE_PUBLIC',
    releaseStatuses: ['WIRED', 'LIVE_PUBLIC'],
    ownerId: 'basis-proposal-1',
    canonicalProjectionId: 'canonical-proposal-1',
    revisionDigest: 'basis-rev-7',
    domainLifecycle: 'OPEN',
    machinePhase: 'RUNNING',
    failure: null,
    referenceIds: ['evidence-1'],
    lossCodes: [],
    ...over,
  };
}

export function projectionInput(over = {}) {
  const runtime = {
    revision: 1,
    generation: 1,
    runMode: 'EXECUTION_VALIDATE_ONLY',
    desiredState: 'RUNNING',
    phase: 'RUNNING',
    commandCorrelationId: null,
    startedAt: NOW - 1_000,
    lastTransitionAt: NOW - 900,
    heartbeatAt: NOW - 10,
    blockedAtGate: null,
    components: [],
    preflight: [],
    lastError: null,
    ...(over.runtime ?? {}),
  };
  const control = {
    revision: 1,
    generation: runtime.generation,
    safeMode: 'VALIDATE_ONLY',
    killSwitchEngaged: false,
    intakePaused: false,
    updatedAtMs: NOW - 10,
    correlationId: CORRELATION,
    ...(over.control ?? {}),
  };
  return {
    nowMs: NOW,
    correlationId: CORRELATION,
    revision: 1,
    runtime,
    control,
    readinessPolicy: SIGNED_Q_READINESS_WAIVER,
    components: components(over.componentOverrides ?? {}),
    summaries: summaries(over.summaryOverrides ?? {}),
    traceEvents: [traceEvent()],
    ...Object.fromEntries(Object.entries(over).filter(([key]) => !['runtime', 'control', 'componentOverrides', 'summaryOverrides'].includes(key))),
  };
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
