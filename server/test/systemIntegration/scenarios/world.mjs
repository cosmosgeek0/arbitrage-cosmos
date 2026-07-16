import {
  buildCanonicalReadModelFromCaptures,
  captureEngineSnapshot,
  probeRuntimeSource,
} from '../../../dist/systemIntegration/adapters/index.js';
import {
  createManagedRuntimeComposition,
} from '../../../dist/systemIntegration/composition/index.js';
import {
  buildSystemSupervisorProjection,
  buildSystemTraceIndex,
} from '../../../dist/systemIntegration/supervisor/index.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  SYSTEM_PERSISTENCE_EVENT_KIND,
  SystemLedgerPersistenceAdapter,
  upsertDryRunExecutionReference,
  upsertReconciliationReference,
  upsertReservationReference,
} from '../../../dist/systemIntegration/persistence/index.js';
import {
  BLOCKED_EXECUTION_MODE_REQUESTS,
  LIVE_EXECUTION_NOT_IMPLEMENTED,
} from '../../../dist/systemIntegration/contracts/index.js';
import {
  ValidateOnlyOrchestrator,
} from '../../../dist/systemIntegration/verticalSlice/index.js';
import {
  EMPTY_RESERVATION_BOOK,
  reduceReservationBook,
} from '../../../dist/capitalFoundation/allocation/index.js';
import {
  buildCanonicalReadModel,
} from '../../../dist/foundation/readModel/index.js';
import {
  createExecutionCoordinator,
  recommendExecutionRecovery,
} from '../../../dist/foundation/execution/index.js';
import {
  evaluateMultiLegRisk,
} from '../../../dist/foundation/risk/index.js';
import {
  reconcileExecutionState,
} from '../../../dist/foundation/reconciliation/index.js';
import {
  createSourcedTimestamp,
  createStructuredFailure,
  evaluateFreshness,
} from '../../../dist/foundation/contracts/index.js';

import {
  ManualClock,
  ManualScheduler,
  BoundedInMemoryLedger,
} from '../fixtures/index.mjs';
import {
  CAPITAL_SUPERVISION_SCENARIOS,
  runCapitalSupervisionScenario,
} from '../../capitalFoundation/scenarios/harness.mjs';
import {
  baseWorld as buildCapitalWorld,
} from '../../capitalFoundation/scenarios/fixtures.mjs';
import {
  COMPAT_NOW,
  FakeExecutionPorts,
  ManualClock as FoundationManualClock,
  allowedRiskInput,
  canonicalReadModelInput,
  exactReconciliationEvidence,
  executionPlanInput,
} from '../../foundation/fixtures/compatibility-fixtures.mjs';
import {
  NOW as VERTICAL_NOW,
  buildValidateOnlyInput,
  clone as cloneVertical,
} from '../verticalSlice/fixtures.mjs';
import {
  CORRELATION as SUPERVISOR_CORRELATION,
  NOW as SUPERVISOR_NOW,
  failure as supervisorFailure,
  projectionInput,
  traceEvent as supervisorTraceEvent,
} from '../supervisor/fixtures.mjs';

export const NOW = VERTICAL_NOW;
export {
  BLOCKED_EXECUTION_MODE_REQUESTS,
  LIVE_EXECUTION_NOT_IMPLEMENTED,
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  SYSTEM_PERSISTENCE_EVENT_KIND,
  SUPERVISOR_CORRELATION,
  SUPERVISOR_NOW,
  SystemLedgerPersistenceAdapter,
  buildSystemTraceIndex,
  cloneVertical,
  evaluateFreshness,
  projectionInput,
  supervisorFailure,
  supervisorTraceEvent,
  upsertDryRunExecutionReference,
  upsertReconciliationReference,
  upsertReservationReference,
};

const ADAPTER_CONTEXT = Object.freeze({
  nowMs: NOW,
  correlationId: 'cor-acceptance-adapters',
  safeCurrentState: 'READ_ONLY',
});

export function runtimeSource(sourceId, overrides = {}) {
  return {
    sourceId,
    transportKind: 'INJECTED',
    endpointClass: 'MARKET',
    productFamily: sourceId.includes('usdm') ? 'USD_M_PERPETUAL' : 'SPOT',
    desiredState: 'RUNNING',
    observedState: 'LIVE',
    connectionGeneration: 3,
    connectedAtMs: NOW - 10_000,
    lastMessageSourceTimeMs: NOW - 120,
    lastMessageReceiveTimeMs: NOW - 100,
    lastProcessedTimeMs: NOW - 90,
    messageAgeMs: 100,
    processingLagMs: 10,
    messageCount: 50,
    invalidCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    sequenceGapCount: 0,
    droppedCount: 0,
    coalescedCount: 0,
    reconnectCount: 1,
    backoff: { attempt: 0, ceiling: 10, delayMs: null, retryAtMs: null, cooldownUntilMs: null },
    rateBudget: {
      state: 'AVAILABLE', usedWeight: null, limit: null, intervalMs: null,
      resetsAtMs: null, retryAfterMs: null, observedAtMs: NOW - 100,
    },
    lastError: null,
    recommendedAction: 'No action required.',
    authority: 'COMPLETE',
    completeness: 'COMPLETE',
    snapshotTimeMs: NOW,
    ...overrides,
  };
}

export function observation(overrides = {}) {
  return {
    quietSymbolsRetained: true,
    retainedSymbols: [{ symbol: 'BTCUSDT', lastActivityAtMs: NOW - 100 }],
    focus: null,
    focusedBooks: [],
    rejectedSignals: [],
    proposalIds: [],
    ...overrides,
  };
}

export function sourceReading(sourceId, overrides = {}) {
  return {
    source: runtimeSource(sourceId),
    queue: {
      depth: 0,
      capacity: 100,
      dropped: 0,
      coalesced: 0,
      observedAtMs: NOW,
      resyncRequired: false,
    },
    observation: observation(),
    ...overrides,
  };
}

export function sourceProbe(componentId, value) {
  const sourceId = componentId === 'public-spot-source' ? 'spot-public-source' : 'usdm-public-source';
  return probeRuntimeSource({
    ...ADAPTER_CONTEXT,
    componentId,
    expectedSourceId: sourceId,
    owner: 'INTELLIGENCE_RUNTIME',
    ownerPath: 'server/src/intelligenceRuntime',
    acquisitionAuthority: 'SYNTHETIC_TEST',
    maxAgeMs: 1_000,
    dependencies: [],
    releaseStatuses: ['BUILT_AND_TESTED', 'IMPORTED', 'WIRED', 'SYNTHETIC_ONLY'],
    supportedControls: ['SET_COMPONENT_STATE', 'RESTART_COMPONENT'],
    port: { readRuntimeSourceProbe: () => value },
  });
}

function engineDecision(strategy, correlationId, overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    ts: NOW - 150,
    strategy,
    kind: 'proposal',
    rejectCode: null,
    humanReason: 'exact engine decision',
    correlationId,
    evidence: {
      direction: strategy === 'basis' ? 'long_spot_short_perp' : 'long',
      netEdgePct: strategy === 'basis' ? 0.31 : null,
      confidence: 0.72,
      borrowStatus: 'not_needed',
    },
    ...overrides,
  };
}

function engineProposal(strategy, id, correlationId, overrides = {}) {
  return {
    id,
    correlationId,
    strategy,
    symbol: 'BTCUSDT',
    direction: strategy === 'basis' ? 'long_spot_short_perp' : 'long',
    createdTs: NOW - 300,
    updatedTs: NOW - 150,
    status: 'open',
    reason: 'exact source proposal',
    grossEdgePct: 0.5,
    netEdgePct: strategy === 'basis' ? 0.31 : null,
    fundingAdjPct: strategy === 'basis' ? 0.01 : null,
    borrowRequired: false,
    borrowStatus: 'not_needed',
    suggestedNotionalUsd: 100,
    confidence: 0.72,
    invalidation: 'source-owned invalidation',
    evidence: { sourceFact: 'retained' },
    ...overrides,
  };
}

export function captureEngine(family, records = {}) {
  const strategy = family === 'BASIS' ? 'basis' : 'volume_spike';
  const correlationId = family === 'BASIS' ? 'basis-correlation' : 'volume-correlation';
  const proposalId = family === 'BASIS' ? 'basis-proposal-id' : 'volume-proposal-id';
  return captureEngineSnapshot({
    ...ADAPTER_CONTEXT,
    family,
    sourceId: family === 'BASIS' ? 'engine.basis.snapshot' : 'engine.volume.snapshot',
    snapshotTimeMs: NOW - 100,
    receivedAtMs: NOW - 90,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    configVersion: family === 'BASIS' ? 'basis-config-v9' : 'volume-config-v4',
    port: {
      readDecisions: () => records.decisions ?? [engineDecision(strategy, correlationId)],
      readProposals: () => records.proposals ?? [engineProposal(strategy, proposalId, correlationId)],
      readRecordRevision: records.readRecordRevision,
    },
  });
}

export function canonicalReadModelFromCaptures(input) {
  return buildCanonicalReadModelFromCaptures({ ...ADAPTER_CONTEXT, ...input });
}

function compositionTimestamp(ctx, sourceId) {
  return createSourcedTimestamp({
    sourceTimeMs: ctx.nowMs,
    receivedAtMs: ctx.nowMs,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
  });
}

export function createCompositionWorld(options = {}) {
  const clock = new ManualClock(1_800_000_000_000);
  const scheduler = new ManualScheduler(clock);
  const log = [];

  function strategy(name, startMode = 'resolved', stopMode = 'resolved') {
    const state = { running: false, fatalCode: null, startCalls: 0, stopCalls: 0, validateCalls: 0 };
    const port = {
      validate() { state.validateCalls += 1; log.push(`validate:${name}`); },
      start() {
        state.startCalls += 1;
        state.running = true;
        log.push(`start:${name}`);
        if (startMode === 'rejected') return Promise.reject(new Error('synthetic optional start failure'));
        return Promise.resolve();
      },
      stop() {
        state.stopCalls += 1;
        log.push(`stop:${name}`);
        if (stopMode === 'throw') throw new Error('synthetic stop failure');
        state.running = false;
      },
      health(ctx) {
        const fatal = state.fatalCode === null ? null : createStructuredFailure({
          component: name,
          stage: 'probe',
          code: state.fatalCode,
          message: `${name} deterministic failure`,
          occurredAt: ctx.nowMs,
          retryable: true,
          safeCurrentState: 'UNCHANGED',
          recommendedOperatorAction: `Inspect ${name}.`,
          correlationId: ctx.correlationId,
        });
        return {
          running: state.running,
          heartbeatAt: state.running ? ctx.nowMs : null,
          timestamp: state.running ? compositionTimestamp(ctx, `acceptance.${name}`) : null,
          fatal,
        };
      },
    };
    return { state, port };
  }

  const marketState = { running: false, fatalCode: null, initCalls: 0, startCalls: 0, stopCalls: 0, validateCalls: 0 };
  const market = {
    validate() { marketState.validateCalls += 1; log.push('validate:market'); },
    init() { marketState.initCalls += 1; log.push('init:market'); return Promise.resolve(); },
    start() { marketState.startCalls += 1; marketState.running = true; log.push('start:market'); },
    stop() { marketState.stopCalls += 1; marketState.running = false; log.push('stop:market'); },
    health(ctx) {
      const fatal = marketState.fatalCode === null ? null : createStructuredFailure({
        component: 'market', stage: 'probe', code: marketState.fatalCode,
        message: 'market deterministic failure', occurredAt: ctx.nowMs, retryable: true,
        safeCurrentState: 'UNCHANGED', recommendedOperatorAction: 'Inspect market.', correlationId: ctx.correlationId,
      });
      return {
        running: marketState.running,
        heartbeatAt: marketState.running ? ctx.nowMs : null,
        timestamp: marketState.running ? compositionTimestamp(ctx, 'acceptance.market') : null,
        fatal,
      };
    },
  };
  const intelligenceRuntime = strategy(
    'intelligence-runtime',
    options.intelligenceRuntimeStartMode,
    options.intelligenceRuntimeStopMode,
  );
  const marketIntelligence = strategy(
    'market-intelligence',
    options.marketIntelligenceStartMode,
    options.marketIntelligenceStopMode,
  );
  const basis = strategy('basis', options.basisStartMode, options.basisStopMode);
  const volume = strategy('volume', options.volumeStartMode, options.volumeStopMode);
  const q = options.includeQ ? strategy('q', options.qStartMode, options.qStopMode) : null;
  const composition = createManagedRuntimeComposition({
    clock,
    scheduler,
    ports: {
      market,
      intelligenceRuntime: intelligenceRuntime.port,
      marketIntelligence: marketIntelligence.port,
      ...(q === null ? {} : { q: q.port }),
      basis: basis.port,
      volume: volume.port,
    },
    readEnvironment: () => ({ privateKeysAvailable: false, killSwitchEngaged: true, borrowTruthPresent: false }),
    tickIntervalMs: 1,
    defaultGateTimeoutMs: 5,
    defaultComponentTimeoutMs: 20,
    drainTimeoutMs: 50,
  });
  return {
    composition,
    clock,
    scheduler,
    log,
    states: {
      market: marketState,
      intelligenceRuntime: intelligenceRuntime.state,
      marketIntelligence: marketIntelligence.state,
      q: q?.state ?? null,
      basis: basis.state,
      volume: volume.state,
    },
  };
}

export async function driveComposition(world, count = 1) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
    world.clock.advance(1);
    world.scheduler.runDue();
  }
}

export async function startCompositionReady(world) {
  const result = world.composition.start();
  await driveComposition(world, 8);
  return result;
}

export function runCapitalScenario(id) {
  const scenario = CAPITAL_SUPERVISION_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`unknown Capital scenario ${id}`);
  return runCapitalSupervisionScenario(scenario);
}

export function competingReservationTruth() {
  const capital = buildCapitalWorld({ key: 'acceptance-double-reservation' });
  const allocation = capital.allocation.result.decisions[0];
  const authority = capital.allocation.result.authorities.find(
    (candidate) => candidate.allocationDecisionId === allocation.id,
  );
  const first = reduceReservationBook(EMPTY_RESERVATION_BOOK, {
    kind: 'RESERVE',
    commandId: 'acceptance:reserve:first',
    nowMs: NOW,
    allocation,
    authority,
    allocationInput: capital.allocation.input,
    capitalClaimKey: `claim:${allocation.considerationId}`,
  });
  const second = reduceReservationBook(first.book, {
    kind: 'RESERVE',
    commandId: 'acceptance:reserve:second',
    nowMs: NOW,
    allocation,
    authority,
    allocationInput: capital.allocation.input,
    capitalClaimKey: `claim:competing:${allocation.considerationId}`,
  });
  return { capital, first, second };
}

export function createPersistenceWorld(nowMs = NOW, options = {}) {
  const clock = new ManualClock(nowMs);
  const ledger = new BoundedInMemoryLedger(clock, {
    maximumEvents: options.maximumEvents ?? 2_000,
    maximumConfigEntries: 32,
    maximumEventBytes: 512 * 1024,
  });
  const adapter = new SystemLedgerPersistenceAdapter(ledger);
  const loaded = adapter.load(nowMs, options.correlationId ?? 'acceptance.persistence.load');
  return { clock, ledger, adapter, loaded };
}

export async function runValidateOnly(input = buildValidateOnlyInput()) {
  const persistence = createPersistenceWorld(input.nowMs, {
    correlationId: `${input.correlationId}.persistence.load`,
    maximumEvents: 64,
  });
  if (!persistence.loaded.ok) {
    throw new Error(`validate-only persistence load failed: ${persistence.loaded.code}`);
  }
  const startup = persistence.adapter.persistStartup({
    startedAtMs: input.nowMs,
    correlationId: `${input.correlationId}.persistence.startup`,
  });
  if (!startup.ok) throw new Error(`validate-only persistence startup failed: ${startup.code}`);
  const result = await new ValidateOnlyOrchestrator(persistence.adapter).execute(input);
  return { input, result, startup, ...persistence };
}

export function validateOnlyInput() {
  return buildValidateOnlyInput();
}

export async function createOneLegExecutionTruth() {
  const read = buildCanonicalReadModel(canonicalReadModelInput());
  if (!read.ok) throw new Error(`canonical read model failed: ${read.failure.code}`);
  const proposal = read.value.basis.proposals[0];
  const clock = new FoundationManualClock(COMPAT_NOW);
  const ports = new FakeExecutionPorts(clock);
  const coordinator = createExecutionCoordinator(executionPlanInput(proposal), clock, ports);
  const plan = coordinator.snapshot().plan;
  const verdict = evaluateMultiLegRisk(allowedRiskInput(plan, proposal));
  ports.authorizeRisk(plan.planId, verdict);
  ports.queueSubmission('OPEN:SPOT', {
    kind: 'FILLED', venueOrderId: 'dry-one-leg-spot', cumulativeFilledQuantity: plan.openingLegs.SPOT.quantity,
  });
  ports.queueSubmission('OPEN:PERP', {
    kind: 'REJECTED',
    failure: {
      code: 'SYNTHETIC_SECOND_LEG_REJECTED', message: 'Synthetic second leg rejected.', retryable: false,
      recommendedOperatorAction: 'Reconcile and expose only a risk-reducing recommendation.',
    },
  });
  const preflight = await coordinator.preflight();
  if (!preflight.ok) throw new Error(`execution preflight failed: ${preflight.failure.code}`);
  const started = coordinator.beginOpen();
  if (!started.ok) throw new Error(`execution open failed: ${started.failure.code}`);
  await coordinator.submitNextOpeningLeg();
  await coordinator.submitNextOpeningLeg();
  const state = coordinator.snapshot();
  const evidence = exactReconciliationEvidence(state, COMPAT_NOW);
  const reconciliation = reconcileExecutionState(
    state,
    evidence,
    COMPAT_NOW,
    { quantityTolerance: 1e-9, normalizedHedgeTolerance: 1e-9 },
  );
  const recovery = recommendExecutionRecovery(state, COMPAT_NOW);
  return { state, evidence, reconciliation, recovery, ports };
}

export function buildSupervisor(input) {
  return buildSystemSupervisorProjection(input);
}

export function persistenceTrace({
  id,
  sequence,
  correlationId,
  occurredAtMs,
  kind,
  componentId,
  truthLabel = 'DRY_RUN',
  domainLifecycle = 'RECORDED',
  referenceIds = [],
}) {
  return Object.freeze({
    id,
    sequence,
    kind,
    componentId,
    correlationId,
    occurredAtMs,
    persistedAtMs: null,
    truthLabel,
    releaseStatuses: Object.freeze(['WIRED', 'SYNTHETIC_ONLY']),
    ownerId: null,
    canonicalProjectionId: null,
    revisionDigest: null,
    domainLifecycle,
    machinePhase: 'RUNNING',
    failure: null,
    referenceIds: Object.freeze([...referenceIds]),
    lossCodes: Object.freeze([]),
  });
}
