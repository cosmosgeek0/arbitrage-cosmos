// systemDashboard/fixtures/builders.ts — synthetic snapshot construction.
// Fixtures are the ONLY data source for this library today. Every timestamp
// is derived from the build instant so ages render truthfully, and every
// snapshot carries a synthetic truth label unless a fixture deliberately
// simulates a live posture.

import type {
  SystemComponentId,
  SystemComponentSnapshot,
  SystemDependencyEdge,
  SystemSupervisorSnapshot,
  SystemSupervisorSummaries,
  SystemTraceDecision,
} from '../../../lib/systemIntegration';
import { EXPECTED_COMPONENTS } from '../lib/presentation';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

type ComponentOverrides = Partial<SystemComponentSnapshot>;

const OWNERS: Record<SystemComponentId, { owner: string; ownerPath: string }> = {
  'public-spot-source': { owner: 'sources', ownerPath: 'server/src/systemIntegration/sources/spot' },
  'public-usdm-source': { owner: 'sources', ownerPath: 'server/src/systemIntegration/sources/usdm' },
  'market-universe': { owner: 'universe', ownerPath: 'server/src/systemIntegration/universe' },
  'intelligence-runtime': { owner: 'intelligence', ownerPath: 'server/src/intelligenceRuntime' },
  'market-intelligence': { owner: 'intelligence', ownerPath: 'server/src/intelligenceFoundation' },
  'q-inference': { owner: 'Q_INFERENCE', ownerPath: 'quant/src/quant_edge/inference' },
  'basis-engine': { owner: 'strategy', ownerPath: 'server/src/engine/basis' },
  'volume-engine': { owner: 'strategy', ownerPath: 'server/src/engine/volume' },
  'capital-supervision': { owner: 'capital', ownerPath: 'server/src/capitalFoundation' },
  'multileg-risk': { owner: 'risk', ownerPath: 'server/src/risk/multileg' },
  'execution-coordinator-validate-only': { owner: 'execution', ownerPath: 'server/src/execution/coordinator' },
  reconciliation: { owner: 'execution', ownerPath: 'server/src/execution/reconciliation' },
  'ledger-persistence': { owner: 'ledger', ownerPath: 'server/src/ledger' },
  'engine-supervisor': { owner: 'supervisor', ownerPath: 'server/src/systemIntegration/supervisor' },
};

const DEPENDENCIES: Record<SystemComponentId, SystemComponentId[]> = {
  'public-spot-source': [],
  'public-usdm-source': [],
  'market-universe': ['public-spot-source', 'public-usdm-source'],
  'intelligence-runtime': ['market-universe'],
  'market-intelligence': ['intelligence-runtime'],
  'q-inference': ['market-intelligence'],
  'basis-engine': ['market-universe', 'market-intelligence'],
  'volume-engine': ['market-universe', 'market-intelligence'],
  'capital-supervision': ['basis-engine', 'volume-engine'],
  'multileg-risk': ['capital-supervision'],
  'execution-coordinator-validate-only': ['multileg-risk'],
  reconciliation: ['execution-coordinator-validate-only'],
  'ledger-persistence': [],
  'engine-supervisor': [],
};

export function makeComponent(
  componentId: SystemComponentId,
  now: number,
  overrides: ComponentOverrides = {},
): SystemComponentSnapshot {
  const receivedAt = now - 4 * SECOND;
  return {
    componentId,
    owner: OWNERS[componentId].owner,
    ownerPath: OWNERS[componentId].ownerPath,
    releaseStatuses: ['RELEASED'],
    truthLabel: 'SYNTHETIC_ONLY',
    desiredState: 'RUNNING',
    phase: 'RUNNING',
    domainObservedState: 'RUNNING',
    readiness: 'READY',
    completeness: 'COMPLETE',
    sourceTimestamp: { sourceTimeMs: receivedAt - SECOND, receivedAtMs: receivedAt, maxAgeMs: 30 * SECOND },
    freshness: { state: 'FRESH', ageMs: 4 * SECOND, evaluatedAt: now },
    lastReceiveAtMs: receivedAt,
    lastProcessAtMs: receivedAt + 200,
    lastSuccessAtMs: receivedAt + 350,
    dependencies: DEPENDENCIES[componentId],
    queue: null,
    blockerCodes: [],
    generation: 3,
    restartCount: 0,
    supportedControls: ['RESTART_COMPONENT'],
    capitalExposed: false,
    operatorAttentionRequired: false,
    lastFailure: null,
    ...overrides,
  };
}

/** Build edges from the static dependency map; per-fixture overrides adjust
 *  link state and root-blocker attribution afterwards. */
export function makeEdges(
  components: SystemComponentSnapshot[],
  overrides: Partial<Record<string, Partial<SystemDependencyEdge>>> = {},
): SystemDependencyEdge[] {
  const present = new Set(components.map((c) => c.componentId));
  const edges: SystemDependencyEdge[] = [];
  for (const component of components) {
    for (const dependency of component.dependencies) {
      if (!present.has(dependency)) continue;
      const edge: SystemDependencyEdge = {
        from: dependency,
        to: component.componentId,
        required: true,
        state: 'AVAILABLE',
        rootBlockerComponentId: null,
        reasonCodes: [],
        ...overrides[`${dependency}->${component.componentId}`],
      };
      edges.push(edge);
    }
  }
  return edges;
}

export function makeSummaries(now: number, overrides: DeepPartialSummaries = {}): SystemSupervisorSummaries {
  const base: SystemSupervisorSummaries = {
    sourceCoverage: {
      truthLabel: 'SYNTHETIC_ONLY',
      universeSymbols: 452,
      spotCoveredSymbols: 452,
      usdMCoveredSymbols: 318,
      quietSymbolsRetained: 41,
      materialGapCount: 0,
      rateLimitedSourceCount: 0,
      lastMaterialGapAtMs: null,
    },
    strategies: {
      basis: {
        truthLabel: 'SYNTHETIC_ONLY',
        heartbeatAtMs: now - 6 * SECOND,
        candidateCount: 12,
        proposalCount: 2,
        rejectionCount: 5,
        acceptedCount: 1,
        lastDecisionAtMs: now - 48 * SECOND,
        sourceRevision: 'rev-8842',
      },
      volume: {
        truthLabel: 'SYNTHETIC_ONLY',
        heartbeatAtMs: now - 9 * SECOND,
        candidateCount: 7,
        proposalCount: 1,
        rejectionCount: 3,
        acceptedCount: 0,
        lastDecisionAtMs: now - 2 * MINUTE,
        sourceRevision: 'rev-8842',
      },
    },
    intelligence: {
      truthLabel: 'SYNTHETIC_ONLY',
      evidenceCount: 1840,
      attentionCount: 9,
      focusRequestedCount: 4,
      focusActiveCount: 3,
      thesisCount: 2,
      insufficientEvidenceCount: 6,
      lastUpdateAtMs: now - 11 * SECOND,
    },
    capital: {
      truthLabel: 'DRY_RUN',
      accountTruthState: 'SYNTHETIC_BASELINE',
      allocatableAmount: '25,000.00 USDT',
      reservedAmount: '0.00 USDT',
      activeExposureAmount: '0.00 USDT',
      eligibleCount: 14,
      reservationCount: 0,
      stagedMandateCount: 0,
      activeExposureCount: 0,
      checkpointRevision: 'cap-ckpt-311',
      blockerCodes: [],
    },
    risk: {
      truthLabel: 'DRY_RUN',
      latestVerdict: 'APPROVE',
      latestVerdictAtMs: now - 52 * SECOND,
      latestVerdictId: 'verdict-01J9ZK',
      rejectionCount: 2,
      reasonCodes: [],
    },
    execution: {
      truthLabel: 'DRY_RUN',
      mode: 'VALIDATE_ONLY',
      barrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
      planId: 'plan-01J9ZM',
      planLifecycle: 'VALIDATED',
      coordinatorState: 'IDLE',
      legCount: 2,
      recoveryState: null,
      lastTransitionAtMs: now - 50 * SECOND,
    },
    reconciliation: {
      truthLabel: 'DRY_RUN',
      status: 'CONVERGED',
      blocksNewExposure: false,
      recommendation: null,
      checkpointId: 'recon-ckpt-77',
      evaluatedAtMs: now - 40 * SECOND,
      reasonCodes: [],
    },
    ledger: {
      truthLabel: 'LIVE_PUBLIC',
      writable: true,
      schemaCompatibilityState: 'AVAILABLE',
      schemaCompatibilityReason: null,
      currentSchemaVersion: 1,
      rollbackFloor: 1,
      lastEventId: 'evt-90311',
      lastPersistedAtMs: now - 2 * SECOND,
      checkpointRevision: 'ledger-ckpt-902',
      recentTraceCount: 36,
      lastCleanShutdownAtMs: now - 26 * HOUR,
    },
  };
  return mergeSummaries(base, overrides);
}

// Typed deep-merge for the summaries tree (one level of nesting per family).
export type DeepPartialSummaries = {
  [K in keyof SystemSupervisorSummaries]?: K extends 'strategies'
    ? { basis?: Partial<SystemSupervisorSummaries['strategies']['basis']>; volume?: Partial<SystemSupervisorSummaries['strategies']['volume']> }
    : Partial<SystemSupervisorSummaries[K]>;
};

function mergeSummaries(base: SystemSupervisorSummaries, overrides: DeepPartialSummaries): SystemSupervisorSummaries {
  return {
    sourceCoverage: { ...base.sourceCoverage, ...overrides.sourceCoverage },
    strategies: {
      basis: { ...base.strategies.basis, ...overrides.strategies?.basis },
      volume: { ...base.strategies.volume, ...overrides.strategies?.volume },
    },
    intelligence: { ...base.intelligence, ...overrides.intelligence },
    capital: { ...base.capital, ...overrides.capital },
    risk: { ...base.risk, ...overrides.risk },
    execution: { ...base.execution, ...overrides.execution },
    reconciliation: { ...base.reconciliation, ...overrides.reconciliation },
    ledger: { ...base.ledger, ...overrides.ledger },
  };
}

let traceSequence = 0;

export function makeTrace(
  now: number,
  partial: Partial<SystemTraceDecision> & Pick<SystemTraceDecision, 'componentId' | 'kind' | 'correlationId'>,
): SystemTraceDecision {
  traceSequence += 1;
  return {
    eventId: `fx-evt-${String(traceSequence).padStart(4, '0')}`,
    occurredAtMs: now - 30 * SECOND,
    truthLabel: 'SYNTHETIC_ONLY',
    ownerId: null,
    canonicalProjectionId: null,
    revisionDigest: null,
    failureCode: null,
    referenceIds: [],
    ...partial,
  };
}

/** One complete correlated chain: evidence → assessment → decision → capital
 *  → risk → plan → reconciliation → ledger, sharing one correlation id.
 *  This is what the trace drill-down expands. `provenance` keeps each stage's
 *  truth label consistent with the fixture's own story: 'live' = live public
 *  evidence flowing into dry-run capital/execution; 'replay' = a rehearsal on
 *  recorded/synthetic data. */
export function makeCorrelatedChain(
  now: number,
  correlationId: string,
  symbol: string,
  provenance: 'live' | 'replay' = 'live',
): SystemTraceDecision[] {
  const t = (secondsAgo: number) => now - secondsAgo * SECOND;
  const evidence = provenance === 'live' ? 'LIVE_PUBLIC' as const : 'RECORDED_REPLAY' as const;
  const decision = provenance === 'live' ? 'LIVE_PUBLIC' as const : 'SYNTHETIC_ONLY' as const;
  const staged = provenance === 'live' ? 'DRY_RUN' as const : 'SYNTHETIC_ONLY' as const;
  return [
    makeTrace(now, { componentId: 'market-universe', kind: 'evidence-window-sealed', correlationId, occurredAtMs: t(96), ownerId: symbol, referenceIds: [`win-${symbol}-4h`], truthLabel: evidence }),
    makeTrace(now, { componentId: 'market-intelligence', kind: 'assessment-focus', correlationId, occurredAtMs: t(88), ownerId: symbol, referenceIds: [`thesis-${symbol}-basis`], truthLabel: decision }),
    makeTrace(now, { componentId: 'basis-engine', kind: 'proposal-accepted', correlationId, occurredAtMs: t(70), ownerId: symbol, canonicalProjectionId: `prop-${symbol}-118`, revisionDigest: 'a41c09d2be7712ff', truthLabel: decision }),
    makeTrace(now, { componentId: 'capital-supervision', kind: 'reservation-staged', correlationId, occurredAtMs: t(61), ownerId: symbol, referenceIds: ['mandate-52'], truthLabel: staged }),
    makeTrace(now, { componentId: 'multileg-risk', kind: 'verdict-approve', correlationId, occurredAtMs: t(52), ownerId: symbol, referenceIds: ['verdict-01J9ZK'], truthLabel: staged }),
    makeTrace(now, { componentId: 'execution-coordinator-validate-only', kind: 'plan-validated', correlationId, occurredAtMs: t(50), ownerId: symbol, referenceIds: ['plan-01J9ZM'], truthLabel: 'DRY_RUN' }),
    makeTrace(now, { componentId: 'reconciliation', kind: 'checkpoint-converged', correlationId, occurredAtMs: t(40), referenceIds: ['recon-ckpt-77'], truthLabel: 'DRY_RUN' }),
    makeTrace(now, { componentId: 'ledger-persistence', kind: 'trace-persisted', correlationId, occurredAtMs: t(39), referenceIds: ['evt-90311'], truthLabel: 'LIVE_PUBLIC' }),
  ];
}

export interface SnapshotOptions {
  now: number;
  posture: SystemSupervisorSnapshot['overallPosture'];
  truthLabel: SystemSupervisorSnapshot['truthLabel'];
  phase?: string;
  components: SystemComponentSnapshot[];
  edgeOverrides?: Partial<Record<string, Partial<SystemDependencyEdge>>>;
  control?: Partial<SystemSupervisorSnapshot['control']>;
  summaries?: DeepPartialSummaries;
  firstRootBlockerComponentId?: SystemComponentId | null;
  rootBlockerComponentIds?: SystemComponentId[];
  attentionQueue?: SystemSupervisorSnapshot['attentionQueue'];
  recentCorrelatedDecisions?: SystemTraceDecision[];
}

export function makeSnapshot(options: SnapshotOptions): SystemSupervisorSnapshot {
  const attention = options.attentionQueue ?? [];
  return {
    schemaVersion: 1,
    revision: 4180,
    evaluatedAtMs: options.now - 3 * SECOND,
    phase: options.phase ?? 'CONVERGED',
    overallPosture: options.posture,
    truthLabel: options.truthLabel,
    runtimeGeneration: 3,
    controlGeneration: 12,
    control: {
      revision: 4180,
      generation: 12,
      safeMode: 'VALIDATE_ONLY',
      killSwitchEngaged: false,
      intakePaused: false,
      updatedAtMs: options.now - 14 * MINUTE,
      correlationId: 'ctl-01J9Y0',
      ...options.control,
    },
    components: options.components,
    edges: makeEdges(options.components, options.edgeOverrides),
    firstRootBlockerComponentId: options.firstRootBlockerComponentId ?? null,
    rootBlockerComponentIds: options.rootBlockerComponentIds ?? [],
    operatorAttentionComponentIds: attention.map((entry) => entry.componentId),
    attentionQueue: attention,
    summaries: makeSummaries(options.now, options.summaries),
    recentCorrelatedDecisions: options.recentCorrelatedDecisions ?? [],
  };
}

/** All fourteen managed components in canonical order, each optionally
 *  overridden; a fixture can also drop members to exercise MISSING boxes. */
export function makeAllComponents(
  now: number,
  overrides: Partial<Record<SystemComponentId, ComponentOverrides>> = {},
  omit: SystemComponentId[] = [],
): SystemComponentSnapshot[] {
  return EXPECTED_COMPONENTS
    .filter((id) => !omit.includes(id))
    .map((id) => makeComponent(id, now, overrides[id]));
}
