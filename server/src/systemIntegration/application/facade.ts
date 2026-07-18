import {
  createStructuredFailure,
  fail,
  type RuntimeStatusSnapshot,
} from '../../foundation/contracts/index.js';
import type {
  CommandResult,
  ComponentStepContext,
} from '../../foundation/control/index.js';
import {
  compareExactDecimals,
  normalizeNonNegativeExactDecimal,
  type NonNegativeDecimal,
} from '../../capitalFoundation/contracts/index.js';
import {
  SYSTEM_COMPONENT_IDS,
  type SystemComponentId,
} from '../contracts/constants.js';
import type {
  SystemControlMutation,
  SystemControlMutationReceipt,
  SystemControlMutationRequest,
  SystemControlState,
  SystemTraceEvent,
} from '../contracts/types.js';
import {
  createManagedRuntimeComposition,
  type CoreRuntimePorts,
  type ManagedCompositionReadSnapshot,
  type ManagedRestartCommandIdentity,
  type RuntimeHealthEvidence,
  type ScheduledTask,
} from '../composition/index.js';
import {
  SYSTEM_PERSISTENCE_LIMITS,
  SystemIntegrationLedgerAdapter,
  createInitialCheckpointState,
  failClosedRestartBarrier,
  type LocalMutationAuthorityPosture,
  type PersistenceLoadResult,
  type PersistedControlRuntimePublicationReference,
  type PersistedRestartTruth,
  type RestartBarrierProjection,
  type LedgerSchemaCompatibilityReadback,
  type SystemLifecycleTruthReadPort,
  type SystemRestartTruthRefreshEffectPort,
  type SystemIntegrationCheckpointState,
} from '../persistence/index.js';
import {
  buildSystemSupervisorProjection,
  traceByCorrelationId,
  type SystemSupervisorReadModel,
} from '../supervisor/index.js';
import {
  SystemControlService,
  type SystemControlActor,
  type SystemControlCompositionDecision,
  type SystemControlCompositionPort,
  type SystemControlRuntimeEffectReadback,
} from '../controls/index.js';
import {
  ValidateOnlyOrchestrator,
  type ValidateOnlyOrchestratorInput,
  type ValidateOnlyRunResult,
  type ValidateOnlyRunSnapshot,
} from '../verticalSlice/index.js';
import type {
  SystemIntegrationEventPage,
  SystemIntegrationEventQuery,
  SystemIntegrationReadPort,
} from '../routes/types.js';
import {
  buildApplicationComponents,
  defaultApplicationSummaries,
  mergeApplicationSummaries,
  uniqueTraceEvents,
  type PhysicalComponentId,
} from './projection.js';
import type {
  ApplicationOwnerSummaries,
  ManagedRuntimeRestartResult,
  SystemApplicationDrainBlockingReference,
  SystemApplicationDrainResult,
  SystemApplicationPhase,
  SystemApplicationStartResult,
  SystemIntegrationApplicationFacade,
  SystemIntegrationApplicationOptions,
  StrategyIntakeControlReadback,
  StrategySymbolPolicyControlReadback,
  SizeCeilingControlReadback,
  StrategyThresholdControlReadback,
} from './types.js';

const MAX_TRACE_EVENTS = 10_000;
const MAX_UTC_MS = 4_102_444_800_000;
const MAX_DRAIN_TRUTH_LEASE_MS = 60 * 60_000;
const MIN_DRAIN_TRUTH_LEASE_MS = 5 * 60_000;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RESTART_TRUTH_STATES = new Set(['FRESH', 'STALE', 'UNKNOWN', 'UNAVAILABLE']);
const DEFAULT_RESTART_TRUTH_REFRESH_INTERVAL_MS = Math.floor(
  SYSTEM_PERSISTENCE_LIMITS.restartTruthMaximumAgeMs / 2,
);

export type SystemIntegrationApplicationLifecycleOptions = SystemIntegrationApplicationOptions & Readonly<{
  lifecycleTruth?: SystemLifecycleTruthReadPort;
  restartTruthRefresh?: SystemRestartTruthRefreshEffectPort;
}>;

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS;
}

function maintenanceRecoveryMutation(mutation: Readonly<SystemControlMutation>): boolean {
  if (mutation.command === 'SET_SAFE_MODE') return mutation.safeMode === 'READ_ONLY';
  if (mutation.command === 'SET_KILL_SWITCH') return mutation.engaged === true;
  if (mutation.command === 'SET_INTAKE_PAUSED') return mutation.paused === true;
  if (mutation.command === 'SET_BASIS_SYMBOL_POLICY') return mutation.action === 'BLOCK';
  if (mutation.command === 'SET_VOLUME_SYMBOL_POLICY') return mutation.action === 'BLOCK';
  if (mutation.command === 'REDUCE_SIZE_CEILING') return true;
  return mutation.command === 'REVOKE_APPROVAL' || mutation.command === 'REVOKE_RESERVATION';
}

function failClosedObservedRestartTruth(nowMs: number): Readonly<PersistedRestartTruth> {
  return Object.freeze({
    publicSourceTruth: 'UNKNOWN',
    accountTruth: 'UNAVAILABLE',
    reconciliationTruth: 'UNKNOWN',
    observedAtMs: nowMs,
  });
}

function normalizedRestartTruth(value: unknown, nowMs: number): Readonly<PersistedRestartTruth> | null {
  if (!plainRecord(value)
    || !RESTART_TRUTH_STATES.has(String(value.publicSourceTruth))
    || !RESTART_TRUTH_STATES.has(String(value.accountTruth))
    || !RESTART_TRUTH_STATES.has(String(value.reconciliationTruth))
    || !validUtcMs(value.observedAtMs)
    || value.observedAtMs > nowMs) return null;
  return Object.freeze({
    publicSourceTruth: value.publicSourceTruth as PersistedRestartTruth['publicSourceTruth'],
    accountTruth: value.accountTruth as PersistedRestartTruth['accountTruth'],
    reconciliationTruth: value.reconciliationTruth as PersistedRestartTruth['reconciliationTruth'],
    observedAtMs: value.observedAtMs,
  });
}

function exactUtcSeconds(value: unknown): number | null {
  if (typeof value !== 'string' || !UTC_SECONDS.test(value)) return null;
  const parsed = Date.parse(value);
  if (!validUtcMs(parsed)) return null;
  return new Date(parsed).toISOString().replace('.000Z', 'Z') === value ? parsed : null;
}

function canonicalDrainTruthBlockers(
  value: unknown,
  nowMs: number,
  localMutationAuthority: LocalMutationAuthorityPosture,
): readonly string[] {
  if (!plainRecord(value)
    || value.source !== 'CANONICAL_SUPERVISOR_READBACK'
    || !['NONE', 'ACTIVE', 'AMBIGUOUS', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(String(value.exposureState))
    || !['NONE', 'AMBIGUOUS', 'UNKNOWN'].includes(String(value.ambiguityState))
    || !['NONE', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(String(value.recoveryState))) {
    return Object.freeze(['ORDINARY_DRAIN_CANONICAL_TRUTH_INVALID']);
  }
  const observedAtMs = exactUtcSeconds(value.observedAtUtc);
  const validUntilMs = exactUtcSeconds(value.validUntilUtc);
  if (observedAtMs === null || validUntilMs === null || validUntilMs <= observedAtMs) {
    return Object.freeze(['ORDINARY_DRAIN_CANONICAL_TRUTH_INVALID']);
  }
  const leaseMs = validUntilMs - observedAtMs;
  if (observedAtMs > nowMs) return Object.freeze(['ORDINARY_DRAIN_CANONICAL_TRUTH_CLOCK_SKEWED']);
  if (nowMs - observedAtMs > SYSTEM_PERSISTENCE_LIMITS.restartTruthMaximumAgeMs) {
    return Object.freeze(['ORDINARY_DRAIN_CANONICAL_TRUTH_STALE']);
  }
  if (validUntilMs <= nowMs) return Object.freeze(['ORDINARY_DRAIN_CANONICAL_TRUTH_EXPIRED']);
  if (leaseMs < MIN_DRAIN_TRUTH_LEASE_MS || leaseMs > MAX_DRAIN_TRUTH_LEASE_MS) {
    return Object.freeze(['ORDINARY_DRAIN_CANONICAL_TRUTH_INVALID']);
  }

  const blockers = new Set<string>();
  if (localMutationAuthority === 'UNKNOWN') blockers.add('ORDINARY_DRAIN_LOCAL_MUTATION_AUTHORITY_UNKNOWN');
  if (localMutationAuthority === 'AMBIGUOUS') blockers.add('ORDINARY_DRAIN_LOCAL_MUTATION_AUTHORITY_AMBIGUOUS');
  if (value.exposureState === 'ACTIVE') blockers.add('ORDINARY_DRAIN_EXPOSURE_ACTIVE');
  if (value.exposureState === 'AMBIGUOUS') blockers.add('ORDINARY_DRAIN_EXPOSURE_AMBIGUOUS');
  if (value.exposureState === 'RECOVERY_REQUIRED') blockers.add('ORDINARY_DRAIN_EXPOSURE_RECOVERY_REQUIRED');
  if (value.ambiguityState === 'AMBIGUOUS') blockers.add('ORDINARY_DRAIN_AMBIGUITY_PRESENT');
  if (value.recoveryState === 'RECOVERY_REQUIRED') blockers.add('ORDINARY_DRAIN_RECOVERY_REQUIRED');

  if (localMutationAuthority === 'PRESENT') {
    if (value.exposureState !== 'NONE') blockers.add('ORDINARY_DRAIN_STRONG_ZERO_EXPOSURE_NOT_PROVEN');
    if (value.ambiguityState !== 'NONE') blockers.add('ORDINARY_DRAIN_AMBIGUITY_NOT_CLEARED');
    if (value.recoveryState !== 'NONE') blockers.add('ORDINARY_DRAIN_RECOVERY_NOT_CLEARED');
  }
  return Object.freeze([...blockers].sort());
}

function canonicalRestartTruthBlockers(
  value: unknown,
  nowMs: number,
  localMutationAuthority: LocalMutationAuthorityPosture,
): readonly string[] {
  if (!plainRecord(value)
    || value.source !== 'CANONICAL_SUPERVISOR_READBACK'
    || !['NONE', 'ACTIVE', 'AMBIGUOUS', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(String(value.exposureState))
    || !['NONE', 'AMBIGUOUS', 'UNKNOWN'].includes(String(value.ambiguityState))
    || !['NONE', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(String(value.recoveryState))) {
    return Object.freeze(['RESTART_CANONICAL_TRUTH_INVALID']);
  }
  const observedAtMs = exactUtcSeconds(value.observedAtUtc);
  const validUntilMs = exactUtcSeconds(value.validUntilUtc);
  if (observedAtMs === null || validUntilMs === null || validUntilMs <= observedAtMs) {
    return Object.freeze(['RESTART_CANONICAL_TRUTH_INVALID']);
  }
  const leaseMs = validUntilMs - observedAtMs;
  if (observedAtMs > nowMs) return Object.freeze(['RESTART_CANONICAL_TRUTH_CLOCK_SKEWED']);
  if (nowMs - observedAtMs > SYSTEM_PERSISTENCE_LIMITS.restartTruthMaximumAgeMs) {
    return Object.freeze(['RESTART_CANONICAL_TRUTH_STALE']);
  }
  if (validUntilMs <= nowMs) return Object.freeze(['RESTART_CANONICAL_TRUTH_EXPIRED']);
  if (leaseMs < MIN_DRAIN_TRUTH_LEASE_MS || leaseMs > MAX_DRAIN_TRUTH_LEASE_MS) {
    return Object.freeze(['RESTART_CANONICAL_TRUTH_INVALID']);
  }

  const blockers: string[] = [];
  if (localMutationAuthority !== 'PROVEN_ABSENT') {
    blockers.push('RESTART_LOCAL_MUTATION_AUTHORITY_NOT_PROVEN_ABSENT');
  }
  if (value.exposureState !== 'NONE') blockers.push('RESTART_EXPOSURE_NONE_NOT_PROVEN');
  if (value.ambiguityState !== 'NONE') blockers.push('RESTART_AMBIGUITY_NONE_NOT_PROVEN');
  if (value.recoveryState !== 'NONE') blockers.push('RESTART_RECOVERY_NONE_NOT_PROVEN');
  return Object.freeze(blockers);
}

function localMutationAuthorityBlockers(
  posture: LocalMutationAuthorityPosture,
): readonly string[] {
  if (posture === 'UNKNOWN') return Object.freeze(['ORDINARY_DRAIN_LOCAL_MUTATION_AUTHORITY_UNKNOWN']);
  if (posture === 'AMBIGUOUS') return Object.freeze(['ORDINARY_DRAIN_LOCAL_MUTATION_AUTHORITY_AMBIGUOUS']);
  return Object.freeze([]);
}

function correlationId(prefix: string, nowMs: number): string {
  return `${prefix}-${nowMs}`;
}

function frozenHealth(evidence: Readonly<RuntimeHealthEvidence>): Readonly<RuntimeHealthEvidence> {
  return Object.freeze({
    ...evidence,
    timestamp: evidence.timestamp ? Object.freeze({ ...evidence.timestamp }) : null,
    fatal: evidence.fatal ? Object.freeze({ ...evidence.fatal }) : null,
  });
}

function frozenDrainBlockingReference(
  reference: Readonly<SystemApplicationDrainBlockingReference>,
): Readonly<SystemApplicationDrainBlockingReference> {
  return Object.freeze({
    referenceType: reference.referenceType,
    referenceId: reference.referenceId,
    ownerId: reference.ownerId,
    ownerRevision: reference.ownerRevision,
    resolutionState: reference.resolutionState,
    correlationId: reference.correlationId,
  });
}

function failedCommand(
  code: string,
  message: string,
  nowMs: number,
  safeCurrentState: string,
): CommandResult {
  return fail(createStructuredFailure({
    component: 'systemIntegration.application',
    stage: 'managed-command',
    code,
    message,
    occurredAt: nowMs,
    retryable: false,
    safeCurrentState,
    recommendedOperatorAction: 'Use the authenticated control shell after startup persistence is healthy.',
    correlationId: correlationId('system-application-command', nowMs),
  }));
}

function thresholdIdentity(strategy: 'BASIS' | 'VOLUME'): Readonly<{
  threshold: 'MIN_NET_BASIS_PCT' | 'VOLUME_1S_MULTIPLE';
  field: 'basisMinNetPct' | 'volume1sMultiple';
}> {
  return strategy === 'BASIS'
    ? Object.freeze({ threshold: 'MIN_NET_BASIS_PCT', field: 'basisMinNetPct' })
    : Object.freeze({ threshold: 'VOLUME_1S_MULTIPLE', field: 'volume1sMultiple' });
}

function canonicalStrategyThreshold(strategy: 'BASIS' | 'VOLUME', value: unknown): NonNegativeDecimal {
  if (typeof value !== 'string'
    || !/^(?:[1-9][0-9]*|0\.[0-9]*[1-9]|[1-9][0-9]*\.[0-9]*[1-9])$/.test(value)
    || value.replace('.', '').length > 12) {
    throw new TypeError('strategy threshold must be a bounded canonical positive decimal');
  }
  const canonical = normalizeNonNegativeExactDecimal(value);
  const numeric = Number(canonical);
  const bounded = strategy === 'BASIS'
    ? numeric >= 0.01 && numeric <= 100
    : numeric >= 1 && numeric <= 100;
  if (canonical !== value || !Number.isFinite(numeric) || String(numeric) !== canonical || !bounded) {
    throw new TypeError('strategy threshold is outside the approved exact range');
  }
  return canonical;
}

/**
 * The sole outer application root for convergence. Construction is inert:
 * neither the existing Ledger nor any runtime is touched until start().
 */
export class SystemIntegrationApplication implements SystemIntegrationApplicationFacade {
  private readonly persistence: SystemIntegrationLedgerAdapter;
  private readonly composition;
  private readonly validateOnly;
  private readonly health: Partial<Record<PhysicalComponentId, Readonly<RuntimeHealthEvidence>>> = {};
  private controlService: SystemControlService;
  private phaseValue: SystemApplicationPhase = 'CREATED';
  private startResult: Readonly<SystemApplicationStartResult> | null = null;
  private drainPromise: Promise<Readonly<SystemApplicationDrainResult>> | null = null;
  private barrierValue: Readonly<RestartBarrierProjection>;
  private latestValidateOnly: Readonly<ValidateOnlyRunSnapshot> | null = null;
  private applicationFailureCode: string | null = null;
  private controlPublicationFailureCode: string | null = null;
  private restartTruthRefreshFailureCode: string | null = null;
  private restartTruthRefreshPromise: Promise<Readonly<RestartBarrierProjection>> | null = null;
  private restartTruthRefreshTask: ScheduledTask | null = null;
  private restartTruthRefreshEpoch = 0;
  private drainAdmissionInProgress = false;
  private readonly runtimePublicationEffects = new Map<string, SystemControlRuntimeEffectReadback>();
  private readonly pendingRestartPublications = new Map<string, Readonly<ManagedRestartCommandIdentity>>();
  private persistedTraceCache: Readonly<{
    checkpointRevision: number;
    events: readonly Readonly<SystemTraceEvent>[];
  }> | null = null;
  private startupSucceeded = false;

  readonly read: SystemIntegrationReadPort;

  constructor(private readonly options: SystemIntegrationApplicationLifecycleOptions) {
    if (!options || typeof options.clock?.nowMs !== 'function') {
      throw new TypeError('SystemIntegrationApplication requires an injected clock.');
    }
    if (typeof options.scheduler?.scheduleEvery !== 'function') {
      throw new TypeError('SystemIntegrationApplication requires an injected scheduler.');
    }
    if (typeof options.readEnvironment !== 'function') {
      throw new TypeError('SystemIntegrationApplication requires an environment read port.');
    }
    if (options.restartTruthRefreshIntervalMs !== undefined && (
      !Number.isSafeInteger(options.restartTruthRefreshIntervalMs)
      || options.restartTruthRefreshIntervalMs < 1
      || options.restartTruthRefreshIntervalMs >= SYSTEM_PERSISTENCE_LIMITS.restartTruthMaximumAgeMs
    )) {
      throw new TypeError('restartTruthRefreshIntervalMs must be a positive safe integer below the restart-truth freshness lease.');
    }
    this.persistence = new SystemIntegrationLedgerAdapter(options.ledger);
    this.validateOnly = new ValidateOnlyOrchestrator(this.persistence);
    this.composition = createManagedRuntimeComposition({
      clock: options.clock,
      scheduler: options.scheduler,
      ports: this.instrumentRuntimes(options.runtimes),
      readEnvironment: options.readEnvironment,
      ...(options.tickIntervalMs === undefined ? {} : { tickIntervalMs: options.tickIntervalMs }),
      ...(options.defaultGateTimeoutMs === undefined ? {} : { defaultGateTimeoutMs: options.defaultGateTimeoutMs }),
      ...(options.defaultComponentTimeoutMs === undefined ? {} : { defaultComponentTimeoutMs: options.defaultComponentTimeoutMs }),
      ...(options.drainTimeoutMs === undefined ? {} : { drainTimeoutMs: options.drainTimeoutMs }),
    });
    const shellState = createInitialCheckpointState(
      options.clock.nowMs(),
      'system-integration-shell',
    );
    this.controlService = new SystemControlService({
      initialState: shellState.control,
      persistence: this.persistence,
      composition: this.controlCompositionPort(),
    });
    this.barrierValue = failClosedRestartBarrier(options.clock.nowMs(), 'PERSISTENCE_NOT_LOADED');
    this.read = Object.freeze({
      supervisor: () => this.supervisor(),
      graph: () => {
        const snapshot = this.supervisor();
        return Object.freeze({
          revision: snapshot.revision,
          evaluatedAtMs: snapshot.evaluatedAtMs,
          edges: snapshot.edges,
        });
      },
      events: (query: Readonly<SystemIntegrationEventQuery>) => this.eventPage(query),
      controls: () => this.controlState(),
      trace: (traceCorrelationId: string) => traceByCorrelationId(this.supervisor().traceIndex, traceCorrelationId),
    });
  }

  private startupRestartTruth(nowMs: number): Readonly<PersistedRestartTruth> {
    const read = this.options.lifecycleTruth?.readRestartTruth;
    if (typeof read !== 'function') return failClosedObservedRestartTruth(nowMs);
    try {
      return normalizedRestartTruth(read(nowMs), nowMs) ?? failClosedObservedRestartTruth(nowMs);
    } catch {
      return failClosedObservedRestartTruth(nowMs);
    }
  }

  private localMutationAuthority(): LocalMutationAuthorityPosture {
    const read = this.options.lifecycleTruth?.readLocalMutationAuthority;
    if (typeof read !== 'function') return 'UNKNOWN';
    try {
      const posture = read();
      return ['PROVEN_ABSENT', 'PRESENT', 'AMBIGUOUS', 'UNKNOWN'].includes(posture)
        ? posture
        : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  private pendingControlRuntimePublications(): readonly Readonly<PersistedControlRuntimePublicationReference>[] {
    const pending = this.persistence.readPendingControlRuntimePublications();
    if (!pending.ok || pending.value.length > 0) {
      this.controlPublicationFailureCode = 'CONTROL_COMMITTED_RUNTIME_PENDING';
      return pending.ok ? pending.value : Object.freeze([]);
    }
    if (this.controlPublicationFailureCode === 'CONTROL_COMMITTED_RUNTIME_PENDING') {
      this.controlPublicationFailureCode = null;
    }
    return pending.value;
  }

  private controlPublicationBlockingReference(
    reference: Readonly<PersistedControlRuntimePublicationReference>,
  ): Readonly<SystemApplicationDrainBlockingReference> {
    return Object.freeze({
      referenceType: 'AMBIGUOUS_MUTATION',
      referenceId: reference.effectId,
      ownerId: 'systemIntegration.controls',
      ownerRevision: reference.requestDigest,
      resolutionState: reference.state === 'UNKNOWN' ? 'UNKNOWN' : 'RECOVERY_REQUIRED',
      correlationId: reference.correlationId,
    });
  }

  private async ordinaryDrainTruthBlockers(nowMs: number): Promise<readonly string[]> {
    const posture = this.localMutationAuthority();
    const read = this.options.lifecycleTruth?.readOrdinaryDrainTruth;
    if (typeof read !== 'function') {
      return Object.freeze([
        'ORDINARY_DRAIN_CANONICAL_TRUTH_UNAVAILABLE',
        ...localMutationAuthorityBlockers(posture),
      ]);
    }
    try {
      const truth = await read();
      return canonicalDrainTruthBlockers(truth, nowMs, posture);
    } catch {
      return Object.freeze([
        'ORDINARY_DRAIN_CANONICAL_TRUTH_READ_FAILED',
        ...localMutationAuthorityBlockers(posture),
      ]);
    }
  }

  private async restartControlBlockers(nowMs: number): Promise<readonly string[]> {
    const posture = this.localMutationAuthority();
    const read = this.options.lifecycleTruth?.readOrdinaryDrainTruth;
    if (typeof read !== 'function') {
      return Object.freeze([
        'RESTART_CANONICAL_TRUTH_UNAVAILABLE',
        ...(posture === 'PROVEN_ABSENT' ? [] : ['RESTART_LOCAL_MUTATION_AUTHORITY_NOT_PROVEN_ABSENT']),
      ]);
    }
    try {
      return canonicalRestartTruthBlockers(await read(), nowMs, posture);
    } catch {
      return Object.freeze([
        'RESTART_CANONICAL_TRUTH_READ_FAILED',
        ...(posture === 'PROVEN_ABSENT' ? [] : ['RESTART_LOCAL_MUTATION_AUTHORITY_NOT_PROVEN_ABSENT']),
      ]);
    }
  }

  private instrumentRuntimes(ports: CoreRuntimePorts): CoreRuntimePorts {
    if (!ports?.market || !ports.intelligenceRuntime || !ports.marketIntelligence || !ports.basis || !ports.volume) {
      throw new TypeError('SystemIntegrationApplication requires Market, IntelligenceRuntime, MarketIntelligence, Basis, and Volume runtime ports.');
    }
    const record = (
      componentId: PhysicalComponentId,
      read: (ctx: ComponentStepContext) => RuntimeHealthEvidence,
    ) => (ctx: ComponentStepContext): RuntimeHealthEvidence => {
      const evidence = frozenHealth(read(ctx));
      this.health[componentId] = evidence;
      return evidence;
    };
    return Object.freeze({
      market: Object.freeze({
        ...(ports.market.validate ? { validate: (ctx: ComponentStepContext) => ports.market.validate?.(ctx) } : {}),
        init: () => ports.market.init(),
        start: () => ports.market.start(),
        stop: () => ports.market.stop(),
        health: record('market-universe', (ctx) => ports.market.health(ctx)),
      }),
      intelligenceRuntime: Object.freeze({
        ...(ports.intelligenceRuntime.validate
          ? { validate: (ctx: ComponentStepContext) => ports.intelligenceRuntime.validate?.(ctx) }
          : {}),
        start: () => ports.intelligenceRuntime.start(),
        stop: () => ports.intelligenceRuntime.stop(),
        health: record('intelligence-runtime', (ctx) => ports.intelligenceRuntime.health(ctx)),
      }),
      marketIntelligence: Object.freeze({
        ...(ports.marketIntelligence.validate
          ? { validate: (ctx: ComponentStepContext) => ports.marketIntelligence.validate?.(ctx) }
          : {}),
        start: () => ports.marketIntelligence.start(),
        stop: () => ports.marketIntelligence.stop(),
        health: record('market-intelligence', (ctx) => ports.marketIntelligence.health(ctx)),
      }),
      ...(ports.q === undefined ? {} : { q: ports.q }),
      basis: Object.freeze({
        ...(ports.basis.validate ? { validate: (ctx: ComponentStepContext) => ports.basis.validate?.(ctx) } : {}),
        start: () => ports.basis.start(),
        stop: () => ports.basis.stop(),
        health: record('basis-engine', (ctx) => ports.basis.health(ctx)),
      }),
      volume: Object.freeze({
        ...(ports.volume.validate ? { validate: (ctx: ComponentStepContext) => ports.volume.validate?.(ctx) } : {}),
        start: () => ports.volume.start(),
        stop: () => ports.volume.stop(),
        health: record('volume-engine', (ctx) => ports.volume.health(ctx)),
      }),
    });
  }

  get controls(): SystemControlService {
    return this.controlService;
  }

  start(): Readonly<SystemApplicationStartResult> {
    if (this.startResult !== null) return this.startResult;
    const nowMs = this.options.clock.nowMs();
    const startCorrelationId = correlationId('system-start', nowMs);
    this.phaseValue = 'STARTING';
    const loaded = this.persistence.load(nowMs, startCorrelationId);
    this.barrierValue = loaded.barrier;
    if (!loaded.ok) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = loaded.code;
      return this.cacheStartResult({
        ok: false,
        phase: this.phaseValue,
        correlationId: startCorrelationId,
        persistenceLoad: loaded,
        startupReceipt: null,
        persistenceFailureCode: loaded.code,
        restartBarrier: loaded.barrier,
        compositionCommand: null,
        composition: this.composition.read(),
      });
    }

    const startup = this.persistence.persistStartup({
      startedAtMs: nowMs,
      correlationId: startCorrelationId,
    });
    if (!startup.ok) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = startup.code;
      return this.cacheStartResult({
        ok: false,
        phase: this.phaseValue,
        correlationId: startCorrelationId,
        persistenceLoad: loaded,
        startupReceipt: null,
        persistenceFailureCode: startup.code,
        restartBarrier: this.restartBarrier(),
        compositionCommand: null,
        composition: this.composition.read(),
      });
    }

    const restartTruth = this.persistence.persistRestartTruth(
      this.startupRestartTruth(nowMs),
      startCorrelationId,
    );
    if (!restartTruth.ok) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = restartTruth.code;
      this.barrierValue = this.readRestartBarrier(nowMs);
      return this.cacheStartResult({
        ok: false,
        phase: this.phaseValue,
        correlationId: startCorrelationId,
        persistenceLoad: loaded,
        startupReceipt: startup.value,
        persistenceFailureCode: restartTruth.code,
        restartBarrier: this.barrierValue,
        compositionCommand: null,
        composition: this.composition.read(),
      });
    }

    const current = this.persistence.currentState();
    if (!current.ok) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = current.code;
      return this.cacheStartResult({
        ok: false,
        phase: this.phaseValue,
        correlationId: startCorrelationId,
        persistenceLoad: loaded,
        startupReceipt: startup.value,
        persistenceFailureCode: current.code,
        restartBarrier: this.restartBarrier(),
        compositionCommand: null,
        composition: this.composition.read(),
      });
    }

    if (!this.restoreStrategyIntake(current.value.strategyIntake)) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = 'STRATEGY_INTAKE_RESTORE_FAILED';
      return this.cacheStartResult({
        ok: false,
        phase: this.phaseValue,
        correlationId: startCorrelationId,
        persistenceLoad: loaded,
        startupReceipt: startup.value,
        persistenceFailureCode: null,
        restartBarrier: this.restartBarrier(),
        compositionCommand: null,
        composition: this.composition.read(),
      });
    }

    if (!this.restoreStrategySymbolPolicy(current.value.strategySymbolPolicy)) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = 'STRATEGY_SYMBOL_POLICY_RESTORE_FAILED';
      return this.cacheStartResult({
        ok: false,
        phase: this.phaseValue,
        correlationId: startCorrelationId,
        persistenceLoad: loaded,
        startupReceipt: startup.value,
        persistenceFailureCode: null,
        restartBarrier: this.restartBarrier(),
        compositionCommand: null,
        composition: this.composition.read(),
      });
    }

    if (!this.restoreSizeCeilings(current.value.sizeCeilings)) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = 'SIZE_CEILING_RESTORE_FAILED';
      return this.cacheStartResult({
        ok: false,
        phase: this.phaseValue,
        correlationId: startCorrelationId,
        persistenceLoad: loaded,
        startupReceipt: startup.value,
        persistenceFailureCode: null,
        restartBarrier: this.restartBarrier(),
        compositionCommand: null,
        composition: this.composition.read(),
      });
    }

    if (!this.restoreStrategyThresholds(current.value.strategyThresholds)) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = 'STRATEGY_THRESHOLD_RESTORE_FAILED';
      return this.cacheStartResult({
        ok: false,
        phase: this.phaseValue,
        correlationId: startCorrelationId,
        persistenceLoad: loaded,
        startupReceipt: startup.value,
        persistenceFailureCode: null,
        restartBarrier: this.restartBarrier(),
        compositionCommand: null,
        composition: this.composition.read(),
      });
    }

    this.pendingControlRuntimePublications();

    // The authenticated control shell exists before any data component is
    // admitted. Publication remains persistence-first inside the service.
    this.controlService = new SystemControlService({
      initialState: current.value.control,
      persistence: this.persistence,
      composition: this.controlCompositionPort(),
    });
    this.barrierValue = this.readRestartBarrier(nowMs);
    const persistedRootDesiredState = current.value.desiredComponents.find(
      (entry) => entry.componentId === 'market-universe',
    )?.desiredState ?? 'RUNNING';
    const command = persistedRootDesiredState === 'STOPPED'
      ? null
      : persistedRootDesiredState === 'PAUSED'
        ? this.composition.startPaused()
        : this.composition.start();
    if (command !== null && !command.ok) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = command.failure.code;
    } else {
      this.phaseValue = 'RUNNING';
      this.startupSucceeded = true;
      this.startRestartTruthRefresh();
    }
    return this.cacheStartResult({
      ok: command?.ok ?? true,
      phase: this.phaseValue,
      correlationId: startCorrelationId,
      persistenceLoad: loaded,
      startupReceipt: startup.value,
      persistenceFailureCode: null,
      restartBarrier: this.barrierValue,
      compositionCommand: command,
      composition: this.composition.read(),
    });
  }

  private cacheStartResult(result: SystemApplicationStartResult): Readonly<SystemApplicationStartResult> {
    this.startResult = Object.freeze(result);
    return this.startResult;
  }

  private readRestartBarrier(nowMs: number): Readonly<RestartBarrierProjection> {
    if (this.restartTruthRefreshFailureCode !== null) {
      return failClosedRestartBarrier(nowMs, this.restartTruthRefreshFailureCode);
    }
    const barrier = this.persistence.restartBarrier(nowMs);
    if (barrier.ok) return barrier.value;
    return failClosedRestartBarrier(nowMs, barrier.code);
  }

  restartBarrier(): Readonly<RestartBarrierProjection> {
    if (this.phaseValue === 'CREATED') return this.barrierValue;
    this.barrierValue = this.readRestartBarrier(this.options.clock.nowMs());
    return this.barrierValue;
  }

  private startRestartTruthRefresh(): void {
    if (typeof this.options.restartTruthRefresh?.refreshRestartTruth !== 'function') return;
    if (this.restartTruthRefreshTask === null) {
      const intervalMs = this.options.restartTruthRefreshIntervalMs
        ?? DEFAULT_RESTART_TRUTH_REFRESH_INTERVAL_MS;
      this.restartTruthRefreshTask = this.options.scheduler.scheduleEvery(intervalMs, () => {
        void this.refreshRestartTruth();
      });
    }
    void this.refreshRestartTruth();
  }

  private stopRestartTruthRefresh(): void {
    this.restartTruthRefreshEpoch += 1;
    this.restartTruthRefreshTask?.cancel();
    this.restartTruthRefreshTask = null;
    // Detach the fenced read so a refused drain can immediately re-arm a new
    // epoch without waiting for an uncooperative old owner promise to settle.
    this.restartTruthRefreshPromise = null;
  }

  refreshRestartTruth(): Promise<Readonly<RestartBarrierProjection>> {
    const read = this.options.restartTruthRefresh?.refreshRestartTruth;
    if (typeof read !== 'function'
      || this.phaseValue !== 'RUNNING'
      || !this.startupSucceeded
      || this.drainAdmissionInProgress) {
      return Promise.resolve(this.restartBarrier());
    }
    if (this.restartTruthRefreshPromise !== null) return this.restartTruthRefreshPromise;
    const epoch = this.restartTruthRefreshEpoch;
    const pending = this.performRestartTruthRefresh(read, epoch);
    this.restartTruthRefreshPromise = pending;
    void pending.then(
      () => {
        if (this.restartTruthRefreshPromise === pending) this.restartTruthRefreshPromise = null;
      },
      () => {
        if (this.restartTruthRefreshPromise === pending) this.restartTruthRefreshPromise = null;
      },
    );
    return pending;
  }

  private async performRestartTruthRefresh(
    read: SystemRestartTruthRefreshEffectPort['refreshRestartTruth'],
    epoch: number,
  ): Promise<Readonly<RestartBarrierProjection>> {
    const readAtMs = this.options.clock.nowMs();
    let candidate: unknown;
    try {
      candidate = await read(readAtMs);
    } catch {
      candidate = null;
    }
    const commitAtMs = this.options.clock.nowMs();
    if (
      epoch !== this.restartTruthRefreshEpoch
      || this.phaseValue !== 'RUNNING'
      || !this.startupSucceeded
    ) return failClosedRestartBarrier(commitAtMs, 'RESTART_TRUTH_REFRESH_CANCELLED');

    const truth = normalizedRestartTruth(candidate, commitAtMs)
      ?? failClosedObservedRestartTruth(commitAtMs);
    const committed = this.persistence.persistRestartTruth(
      truth,
      correlationId('restart-truth-refresh', truth.observedAtMs ?? commitAtMs),
    );
    if (!committed.ok) {
      this.restartTruthRefreshFailureCode = `RESTART_TRUTH_REFRESH_${committed.code}`;
      this.barrierValue = failClosedRestartBarrier(commitAtMs, this.restartTruthRefreshFailureCode);
      return this.barrierValue;
    }
    this.restartTruthRefreshFailureCode = null;
    this.barrierValue = this.readRestartBarrier(this.options.clock.nowMs());
    return this.barrierValue;
  }

  managedRuntime(): Readonly<ManagedCompositionReadSnapshot> {
    return this.composition.read();
  }

  restartManagedRuntime(): Readonly<ManagedRuntimeRestartResult> {
    const nowMs = this.options.clock.nowMs();
    const unavailable = this.phaseValue !== 'RUNNING'
      || !this.startupSucceeded
      || this.composition.read().draining;
    const command = unavailable
      ? failedCommand(
          'APPLICATION_NOT_READY',
          'Managed runtime restart requires a persisted, non-draining application shell.',
          nowMs,
          this.phaseValue,
        )
      : this.composition.restart();
    return Object.freeze({
      ok: command.ok,
      code: command.ok ? 'MANAGED_RUNTIME_RESTART_ACCEPTED' : command.failure.code,
      command,
      composition: this.composition.read(),
    });
  }

  private controlCompositionPort(): SystemControlCompositionPort {
    return Object.freeze({
      inspectMutation: (
        mutation: Readonly<SystemControlMutation>,
        control: Readonly<SystemControlState>,
      ) => this.inspectControlMutation(mutation, control),
      publishCommitted: (
        request: Readonly<SystemControlMutationRequest>,
        actor: Readonly<SystemControlActor>,
        receipt: Readonly<SystemControlMutationReceipt>,
      ) => this.publishControlMutation(request, actor, receipt),
      inspectCommittedPublication: (
        request: Readonly<SystemControlMutationRequest>,
        receipt: Readonly<SystemControlMutationReceipt>,
      ) => this.controlRuntimeEffectReadback(request, receipt),
    });
  }

  private runtimePublicationEffectId(
    request: Readonly<SystemControlMutationRequest>,
    receipt: Readonly<SystemControlMutationReceipt>,
  ): string {
    return `${request.idempotencyKey}:${receipt.after.revision}:${receipt.after.generation}`;
  }

  private async controlRuntimeEffectReadback(
    request: Readonly<SystemControlMutationRequest>,
    receipt: Readonly<SystemControlMutationReceipt>,
  ): Promise<SystemControlRuntimeEffectReadback> {
    if (request.mutation.command === 'SET_BASIS_SYMBOL_POLICY'
      || request.mutation.command === 'SET_VOLUME_SYMBOL_POLICY') {
      const strategy = request.mutation.command === 'SET_BASIS_SYMBOL_POLICY' ? 'basis' : 'volume';
      const owner = this.options.strategySymbolPolicy?.[strategy];
      if (!owner || typeof owner.readBlockedSymbols !== 'function') return 'UNKNOWN';
      try {
        const blocked = owner.readBlockedSymbols();
        if (!Array.isArray(blocked)) return 'UNKNOWN';
        const expected = request.mutation.action === 'BLOCK';
        return blocked.includes(request.mutation.symbol) === expected ? 'APPLIED' : 'NOT_APPLIED';
      } catch {
        return 'UNKNOWN';
      }
    }
    if (request.mutation.command === 'REDUCE_SIZE_CEILING') {
      const owner = this.options.sizeCeilings?.[request.mutation.scope];
      if (!owner || typeof owner.readCeiling !== 'function') return 'UNKNOWN';
      try {
        const effective = owner.readCeiling();
        return effective === request.mutation.maximumNotionalUsd ? 'APPLIED' : 'NOT_APPLIED';
      } catch {
        return 'UNKNOWN';
      }
    }
    if (request.mutation.command === 'SET_STRATEGY_THRESHOLD') {
      const owner = this.options.strategyThresholds?.[request.mutation.strategy];
      if (!owner || typeof owner.readThreshold !== 'function') return 'UNKNOWN';
      try {
        const effective = owner.readThreshold();
        return effective === request.mutation.value ? 'APPLIED' : 'NOT_APPLIED';
      } catch {
        return 'UNKNOWN';
      }
    }
    const effectId = this.runtimePublicationEffectId(request, receipt);
    const local = this.runtimePublicationEffects.get(effectId);
    if (local !== undefined) return local;
    const pendingRestart = this.pendingRestartPublications.get(effectId);
    if (pendingRestart !== undefined) {
      if (request.mutation.command !== 'RESTART_COMPONENT') return 'UNKNOWN';
      const completion = this.composition.readRestartCompletion(pendingRestart);
      if (completion === 'APPLIED') {
        this.pendingRestartPublications.delete(effectId);
        this.runtimePublicationEffects.set(effectId, 'APPLIED');
        return 'APPLIED';
      }
      if (completion === 'FAILED') {
        this.controlPublicationFailureCode = 'CONTROL_COMMITTED_RUNTIME_PENDING';
      }
      return 'UNKNOWN';
    }
    if (request.mutation.command === 'CLEAR_DEPLOYMENT_FREEZE') {
      return this.options.deploymentFreezeClear?.readEffect() ?? 'UNKNOWN';
    }
    const read = this.options.lifecycleTruth?.readControlRuntimeEffect;
    if (typeof read !== 'function') return 'UNKNOWN';
    try {
      const evidence = await read(effectId, request.mutation);
      return ['APPLIED', 'NOT_APPLIED', 'UNKNOWN'].includes(evidence)
        ? evidence
        : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  private decision(
    ok: boolean,
    code: string,
    message: string,
    applied: boolean,
    riskIncreasing = false,
  ): SystemControlCompositionDecision {
    return Object.freeze({ ok, code, message, applied, riskIncreasing });
  }

  private async inspectControlMutation(
    mutation: Readonly<SystemControlMutation>,
    control: Readonly<SystemControlState>,
  ): Promise<SystemControlCompositionDecision> {
    const maintenanceRecovery = this.phaseValue === 'MAINTENANCE'
      && maintenanceRecoveryMutation(mutation);
    if ((this.phaseValue !== 'RUNNING' && !maintenanceRecovery) || this.composition.read().draining) {
      return this.decision(false, 'APPLICATION_NOT_READY', 'The managed application is not accepting control mutations.', false);
    }
    const managed = this.composition.read();
    const externalKillEngaged = this.externalKillSwitchEngaged();
    if (mutation.command === 'SET_SAFE_MODE') {
      return this.decision(true, 'SAFE_MODE_ACCEPTED', '', mutation.safeMode !== control.safeMode);
    }
    if (mutation.command === 'SET_KILL_SWITCH') {
      if (!mutation.engaged && externalKillEngaged) {
        return this.decision(false, 'EXTERNAL_KILL_SWITCH_ENGAGED', 'The audited application kill switch remains engaged.', false);
      }
      return this.decision(true, 'KILL_SWITCH_ACCEPTED', '', mutation.engaged !== control.killSwitchEngaged);
    }
    if (mutation.command === 'SET_INTAKE_PAUSED') {
      if (!mutation.paused && externalKillEngaged) {
        return this.decision(false, 'EXTERNAL_KILL_SWITCH_ENGAGED', 'Strategy intake cannot resume while the audited application kill switch is engaged.', false);
      }
      if (!mutation.paused && !this.restartBarrier().canOpenOrIncrease) {
        return this.decision(false, 'RESTART_BARRIER_BLOCKED', 'Strategy intake cannot resume until restart truth is fresh and reconciled.', false);
      }
      return this.decision(true, 'INTAKE_POSTURE_ACCEPTED', '', mutation.paused !== control.intakePaused, !mutation.paused);
    }
    if (mutation.command === 'SET_BASIS_INTAKE') {
      const owner = this.options.strategyIntake?.basis;
      if (!owner || typeof owner.readPaused !== 'function' || typeof owner.setPaused !== 'function') {
        return this.decision(false, 'BASIS_INTAKE_OWNER_NOT_WIRED', 'Canonical Basis intake owner is unavailable.', false);
      }
      let paused: boolean;
      try {
        paused = owner.readPaused();
      } catch {
        return this.decision(false, 'BASIS_INTAKE_READBACK_UNAVAILABLE', 'Canonical Basis intake readback is unavailable.', false);
      }
      if (typeof paused !== 'boolean') {
        return this.decision(false, 'BASIS_INTAKE_READBACK_INVALID', 'Canonical Basis intake readback is invalid.', false);
      }
      const persisted = this.checkpoint();
      if (persisted === null) {
        return this.decision(false, 'BASIS_INTAKE_DESIRED_STATE_UNAVAILABLE', 'Durable Basis intake posture is unavailable.', false);
      }
      if (!mutation.paused && (control.intakePaused || control.killSwitchEngaged || externalKillEngaged)) {
        return this.decision(false, 'EFFECTIVE_INTAKE_PAUSED', 'Basis intake cannot resume while a stricter global posture is active.', false);
      }
      if (!mutation.paused && !this.restartBarrier().canOpenOrIncrease) {
        return this.decision(false, 'RESTART_BARRIER_BLOCKED', 'Basis intake cannot resume until restart truth is fresh and reconciled.', false);
      }
      return this.decision(
        true,
        'BASIS_INTAKE_ACCEPTED',
        '',
        persisted.strategyIntake.basisPaused !== mutation.paused || paused !== mutation.paused,
        !mutation.paused,
      );
    }
    if (mutation.command === 'SET_VOLUME_INTAKE') {
      const owner = this.options.strategyIntake?.volume;
      if (!owner || typeof owner.readPaused !== 'function' || typeof owner.setPaused !== 'function') {
        return this.decision(false, 'VOLUME_INTAKE_OWNER_NOT_WIRED', 'Canonical Volume intake owner is unavailable.', false);
      }
      let paused: boolean;
      try {
        paused = owner.readPaused();
      } catch {
        return this.decision(false, 'VOLUME_INTAKE_READBACK_UNAVAILABLE', 'Canonical Volume intake readback is unavailable.', false);
      }
      if (typeof paused !== 'boolean') {
        return this.decision(false, 'VOLUME_INTAKE_READBACK_INVALID', 'Canonical Volume intake readback is invalid.', false);
      }
      const persisted = this.checkpoint();
      if (persisted === null) {
        return this.decision(false, 'VOLUME_INTAKE_DESIRED_STATE_UNAVAILABLE', 'Durable Volume intake posture is unavailable.', false);
      }
      if (!mutation.paused && (control.intakePaused || control.killSwitchEngaged || externalKillEngaged)) {
        return this.decision(false, 'EFFECTIVE_INTAKE_PAUSED', 'Volume intake cannot resume while a stricter global posture is active.', false);
      }
      if (!mutation.paused && !this.restartBarrier().canOpenOrIncrease) {
        return this.decision(false, 'RESTART_BARRIER_BLOCKED', 'Volume intake cannot resume until restart truth is fresh and reconciled.', false);
      }
      return this.decision(
        true,
        'VOLUME_INTAKE_ACCEPTED',
        '',
        persisted.strategyIntake.volumePaused !== mutation.paused || paused !== mutation.paused,
        !mutation.paused,
      );
    }
    if (mutation.command === 'SET_BASIS_SYMBOL_POLICY'
      || mutation.command === 'SET_VOLUME_SYMBOL_POLICY') {
      const strategy = mutation.command === 'SET_BASIS_SYMBOL_POLICY' ? 'basis' : 'volume';
      const strategyLabel = strategy === 'basis' ? 'BASIS' : 'VOLUME';
      const owner = this.options.strategySymbolPolicy?.[strategy];
      if (!owner || typeof owner.readBlockedSymbols !== 'function'
        || typeof owner.setBlocked !== 'function' || typeof owner.isAllowed !== 'function') {
        return this.decision(false, `${strategyLabel}_SYMBOL_POLICY_OWNER_NOT_WIRED`, 'Canonical strategy symbol-policy owner is unavailable.', false);
      }
      let effective: readonly string[];
      try {
        effective = owner.readBlockedSymbols();
      } catch {
        return this.decision(false, `${strategyLabel}_SYMBOL_POLICY_READBACK_UNAVAILABLE`, 'Canonical symbol-policy readback is unavailable.', false);
      }
      if (!Array.isArray(effective)
        || effective.some((symbol) => typeof symbol !== 'string' || !/^[A-Z0-9]{4,20}$/.test(symbol))) {
        return this.decision(false, `${strategyLabel}_SYMBOL_POLICY_READBACK_INVALID`, 'Canonical symbol-policy readback is invalid.', false);
      }
      const persisted = this.checkpoint();
      if (persisted === null) {
        return this.decision(false, `${strategyLabel}_SYMBOL_POLICY_DESIRED_STATE_UNAVAILABLE`, 'Durable symbol-policy posture is unavailable.', false);
      }
      const desired = strategy === 'basis'
        ? persisted.strategySymbolPolicy.basisBlocked
        : persisted.strategySymbolPolicy.volumeBlocked;
      const blocking = mutation.action === 'BLOCK';
      if (blocking && !desired.includes(mutation.symbol) && desired.length >= 500) {
        return this.decision(false, `${strategyLabel}_SYMBOL_POLICY_CAPACITY_REACHED`, 'Durable strategy symbol-policy capacity is exhausted.', false);
      }
      if (!blocking && (control.intakePaused || control.killSwitchEngaged || externalKillEngaged)) {
        return this.decision(false, 'EFFECTIVE_INTAKE_PAUSED', 'A symbol cannot be allowed while a stricter global posture is active.', false);
      }
      if (!blocking && !this.restartBarrier().canOpenOrIncrease) {
        return this.decision(false, 'RESTART_BARRIER_BLOCKED', 'A symbol cannot be allowed until restart truth is fresh and reconciled.', false);
      }
      return this.decision(
        true,
        `${strategyLabel}_SYMBOL_POLICY_ACCEPTED`,
        '',
        desired.includes(mutation.symbol) !== blocking || effective.includes(mutation.symbol) !== blocking,
        !blocking,
      );
    }
    if (mutation.command === 'REDUCE_SIZE_CEILING') {
      const owner = this.options.sizeCeilings?.[mutation.scope];
      if (!owner || typeof owner.readCeiling !== 'function' || typeof owner.setCeiling !== 'function') {
        return this.decision(false, 'SIZE_CEILING_OWNER_NOT_WIRED', 'Canonical Capital/config size-ceiling owner is unavailable.', false);
      }
      let target: NonNegativeDecimal;
      let effective: NonNegativeDecimal;
      try {
        target = normalizeNonNegativeExactDecimal(mutation.maximumNotionalUsd);
        const read = owner.readCeiling();
        if (read === null) throw new TypeError('size ceiling unavailable');
        effective = normalizeNonNegativeExactDecimal(read);
        if (effective !== read) throw new TypeError('size ceiling non-canonical');
      } catch {
        return this.decision(false, 'SIZE_CEILING_EFFECT_UNAVAILABLE', 'Canonical exact size-ceiling readback is unavailable.', false);
      }
      const persisted = this.checkpoint();
      if (persisted === null) {
        return this.decision(false, 'SIZE_CEILING_DESIRED_STATE_UNAVAILABLE', 'Durable size-ceiling posture is unavailable.', false);
      }
      const field = mutation.scope === 'SYSTEM' ? 'system' : mutation.scope === 'BASIS' ? 'basis' : 'volume';
      const desiredRaw = persisted.sizeCeilings[field];
      let desired: NonNegativeDecimal | null = null;
      try {
        desired = desiredRaw === null ? null : normalizeNonNegativeExactDecimal(desiredRaw);
      } catch {
        return this.decision(false, 'SIZE_CEILING_DESIRED_STATE_UNAVAILABLE', 'Durable exact size-ceiling posture is invalid.', false);
      }
      if (compareExactDecimals(target, effective) > 0
        || (desired !== null && compareExactDecimals(target, desired) > 0)) {
        return this.decision(false, 'SIZE_CEILING_INCREASE_FORBIDDEN', 'This control permits downward-only exact size-ceiling changes.', false);
      }
      return this.decision(
        true,
        'SIZE_CEILING_REDUCTION_ACCEPTED',
        '',
        desired !== target || effective !== target,
      );
    }
    if (mutation.command === 'SET_STRATEGY_THRESHOLD') {
      const identity = thresholdIdentity(mutation.strategy);
      if (mutation.threshold !== identity.threshold) {
        return this.decision(false, 'STRATEGY_THRESHOLD_PAIR_INVALID', 'The requested threshold is not owned by this strategy.', false);
      }
      const owner = this.options.strategyThresholds?.[mutation.strategy];
      if (!owner || typeof owner.readThreshold !== 'function' || typeof owner.setThreshold !== 'function') {
        return this.decision(false, 'STRATEGY_THRESHOLD_OWNER_NOT_WIRED', 'Canonical strategy threshold owner is unavailable.', false);
      }
      let target: NonNegativeDecimal;
      let effective: NonNegativeDecimal;
      try {
        target = canonicalStrategyThreshold(mutation.strategy, mutation.value);
        const read = owner.readThreshold();
        if (read === null) throw new TypeError('strategy threshold unavailable');
        effective = canonicalStrategyThreshold(mutation.strategy, read);
      } catch {
        return this.decision(false, 'STRATEGY_THRESHOLD_EFFECT_UNAVAILABLE', 'Canonical exact strategy threshold readback is unavailable.', false);
      }
      const persisted = this.checkpoint();
      if (persisted === null) {
        return this.decision(false, 'STRATEGY_THRESHOLD_DESIRED_STATE_UNAVAILABLE', 'Durable strategy threshold posture is unavailable.', false);
      }
      let desired: NonNegativeDecimal | null = null;
      try {
        const desiredRaw = persisted.strategyThresholds[identity.field];
        desired = desiredRaw === null ? null : canonicalStrategyThreshold(mutation.strategy, desiredRaw);
      } catch {
        return this.decision(false, 'STRATEGY_THRESHOLD_DESIRED_STATE_UNAVAILABLE', 'Durable exact strategy threshold posture is invalid.', false);
      }
      const riskIncreasing = compareExactDecimals(target, effective) < 0
        || (desired !== null && compareExactDecimals(target, desired) < 0);
      if (riskIncreasing && (control.intakePaused || control.killSwitchEngaged || externalKillEngaged)) {
        return this.decision(false, 'EFFECTIVE_INTAKE_PAUSED', 'A strategy threshold cannot be lowered while a stricter global posture is active.', false);
      }
      if (riskIncreasing && !this.restartBarrier().canOpenOrIncrease) {
        return this.decision(false, 'RESTART_BARRIER_BLOCKED', 'A strategy threshold cannot be lowered until restart truth is fresh and reconciled.', false);
      }
      return this.decision(
        true,
        'STRATEGY_THRESHOLD_ACCEPTED',
        '',
        desired !== target || effective !== target,
        riskIncreasing,
      );
    }
    if (mutation.command === 'APPLY_CONFIGURATION') {
      return this.decision(false, 'CONFIGURATION_OWNER_NOT_WIRED', 'No configuration owner port is wired to this convergence root.', false);
    }
    if (mutation.command === 'CLEAR_DEPLOYMENT_FREEZE') {
      const owner = this.options.deploymentFreezeClear;
      if (owner === undefined) {
        return this.decision(false, 'DEPLOYMENT_FREEZE_CLEAR_OWNER_NOT_WIRED', 'The canonical freeze clear owner is unavailable.', false);
      }
      const decision = await owner.canClear(mutation.expectedObservedAtUtc, this.options.clock.nowMs());
      return decision.ok
        ? this.decision(true, 'FREEZE_CLEAR_ACCEPTED', '', true)
        : this.decision(false, decision.code, 'Canonical healthy recovery readback did not authorize freeze clearing.', false);
    }
    if (mutation.command === 'REVOKE_APPROVAL' || mutation.command === 'REVOKE_RESERVATION') {
      const state = this.persistence.currentState();
      if (!state.ok) return this.decision(false, state.code, 'Durable owner references are unavailable.', false);
      const exists = mutation.command === 'REVOKE_APPROVAL'
        ? state.value.approvals.some((entry) => entry.approvalId === mutation.approvalId && entry.usable)
        : state.value.reservations.some((entry) => entry.reservationId === mutation.reservationId && entry.blocksAllocation);
      return exists
        ? this.decision(true, mutation.command === 'REVOKE_APPROVAL' ? 'APPROVAL_REVOCATION_ACCEPTED' : 'RESERVATION_REVOCATION_ACCEPTED', '', true)
        : this.decision(false, mutation.command === 'REVOKE_APPROVAL' ? 'APPROVAL_NOT_FOUND' : 'RESERVATION_NOT_FOUND', 'The referenced active owner record was not found.', false);
    }
    if (mutation.command === 'RESTART_COMPONENT') {
      if (mutation.componentId !== 'market-universe') {
        return this.decision(false, 'INDIVIDUAL_RUNTIME_RESTART_NOT_SUPPORTED', 'Only the dependency-root managed runtime can restart as one graph.', false);
      }
      const blockers = await this.restartControlBlockers(this.options.clock.nowMs());
      return blockers.length === 0
        ? this.decision(true, 'MANAGED_RUNTIME_RESTART_ACCEPTED', '', true)
        : this.decision(false, blockers[0], 'Managed restart requires current canonical strong-zero truth and proven-absent local mutation authority.', false);
    }
    if (mutation.command === 'SET_PUBLIC_SOURCE_LIFECYCLE') {
      return this.decision(
        false,
        'SOURCE_LIFECYCLE_OWNER_REQUIRED',
        'Per-source lifecycle state is owned by the injected Intelligence Runtime adapter.',
        false,
      );
    }
    if (mutation.componentId !== 'market-universe') {
      return this.decision(false, 'INDIVIDUAL_COMPONENT_CONTROL_NOT_SUPPORTED', 'The managed graph has one dependency-root lifecycle command.', false);
    }
    if (mutation.desiredState === 'PAUSED' && !['RUNNING', 'DEGRADED'].includes(managed.supervisor.phase)) {
      return this.decision(false, 'MANAGED_RUNTIME_NOT_PAUSABLE', 'The managed runtime is not currently running.', false);
    }
    return this.decision(
      true,
      'MANAGED_RUNTIME_STATE_ACCEPTED',
      '',
      managed.supervisor.desiredState !== mutation.desiredState,
    );
  }

  private async publishControlMutation(
    request: Readonly<SystemControlMutationRequest>,
    _actor: Readonly<SystemControlActor>,
    receipt: Readonly<SystemControlMutationReceipt>,
  ): Promise<void> {
    if (!receipt.applied) return;
    const mutation = request.mutation;
    const runtimeEffectId = mutation.command === 'RESTART_COMPONENT'
      || mutation.command === 'SET_COMPONENT_STATE'
      || mutation.command === 'CLEAR_DEPLOYMENT_FREEZE'
      ? this.runtimePublicationEffectId(request, receipt)
      : null;
    const restartGenerationBefore = mutation.command === 'RESTART_COMPONENT'
      ? this.composition.read().supervisor.generation
      : null;
    let command: CommandResult | null = null;
    try {
      if (mutation.command === 'RESTART_COMPONENT') {
        command = this.composition.restart();
      } else if (mutation.command === 'SET_BASIS_SYMBOL_POLICY'
        || mutation.command === 'SET_VOLUME_SYMBOL_POLICY') {
        const strategy = mutation.command === 'SET_BASIS_SYMBOL_POLICY' ? 'basis' : 'volume';
        const owner = this.options.strategySymbolPolicy?.[strategy];
        if (!owner || typeof owner.setBlocked !== 'function') throw new Error('STRATEGY_SYMBOL_POLICY_OWNER_NOT_WIRED');
        owner.setBlocked(mutation.symbol, mutation.action === 'BLOCK');
      } else if (mutation.command === 'REDUCE_SIZE_CEILING') {
        const owner = this.options.sizeCeilings?.[mutation.scope];
        if (!owner || typeof owner.setCeiling !== 'function') throw new Error('SIZE_CEILING_OWNER_NOT_WIRED');
        owner.setCeiling(mutation.maximumNotionalUsd);
      } else if (mutation.command === 'SET_STRATEGY_THRESHOLD') {
        const owner = this.options.strategyThresholds?.[mutation.strategy];
        if (!owner || typeof owner.setThreshold !== 'function') throw new Error('STRATEGY_THRESHOLD_OWNER_NOT_WIRED');
        owner.setThreshold(mutation.value);
      } else if (mutation.command === 'SET_COMPONENT_STATE') {
        if (mutation.desiredState === 'STOPPED') command = this.composition.issue('STOP');
        else if (mutation.desiredState === 'PAUSED') command = this.composition.issue('PAUSE');
        else command = this.composition.read().supervisor.phase === 'PAUSED'
          ? this.composition.issue('RESUME')
          : this.composition.start();
      } else if (mutation.command === 'CLEAR_DEPLOYMENT_FREEZE') {
        if (_actor.source === 'canonical-alarm') {
          throw new Error('OPERATOR_REQUIRED');
        }
        const result = await this.options.deploymentFreezeClear?.clear(Object.freeze({
          idempotencyKey: request.idempotencyKey,
          expectedObservedAtUtc: mutation.expectedObservedAtUtc,
          reason: request.reason,
          requestedAtMs: request.requestedAtMs,
          actor: Object.freeze({
            id: _actor.id,
            email: _actor.email,
            source: _actor.source,
          }),
        }));
        if (result?.ok !== true) throw new Error(result?.code ?? 'DEPLOYMENT_FREEZE_CLEAR_OWNER_NOT_WIRED');
        if (runtimeEffectId !== null) this.runtimePublicationEffects.set(runtimeEffectId, 'APPLIED');
      }
    } catch {
      if (runtimeEffectId !== null) this.runtimePublicationEffects.set(runtimeEffectId, 'NOT_APPLIED');
      this.controlPublicationFailureCode = 'CONTROL_COMMITTED_RUNTIME_PENDING';
      throw new Error('CONTROL_COMMITTED_RUNTIME_PENDING');
    }
    if (command !== null && !command.ok) {
      if (runtimeEffectId !== null) this.runtimePublicationEffects.set(runtimeEffectId, 'NOT_APPLIED');
      this.controlPublicationFailureCode = 'CONTROL_COMMITTED_RUNTIME_PENDING';
      throw new Error('CONTROL_COMMITTED_RUNTIME_PENDING');
    }
    if (runtimeEffectId !== null && command !== null) {
      if (mutation.command === 'RESTART_COMPONENT') {
        if (!command.ok || command.value.command !== 'RESTART' || !command.value.applied
          || restartGenerationBefore === null) {
          this.controlPublicationFailureCode = 'CONTROL_COMMITTED_RUNTIME_PENDING';
          throw new Error('CONTROL_COMMITTED_RUNTIME_PENDING');
        }
        this.pendingRestartPublications.set(runtimeEffectId, Object.freeze({
          correlationId: command.value.correlationId,
          revision: command.value.revision,
          targetGeneration: restartGenerationBefore + 1,
        }));
      } else {
        this.runtimePublicationEffects.set(runtimeEffectId, 'APPLIED');
      }
    }
    if (command !== null) this.controlPublicationFailureCode = null;
  }

  async executeValidateOnly(
    input: Readonly<ValidateOnlyOrchestratorInput>,
  ): Promise<Readonly<ValidateOnlyRunResult>> {
    if (this.phaseValue !== 'RUNNING' || !this.startupSucceeded) {
      throw new Error('Validate-only orchestration requires a persisted application shell.');
    }
    const posture = this.effectiveControlState();
    if (posture.killSwitchEngaged || posture.intakePaused) {
      throw new Error('VALIDATE_ONLY_BLOCKED_BY_EFFECTIVE_POSTURE');
    }
    const result = await this.validateOnly.execute(input);
    this.latestValidateOnly = result.snapshot;
    this.barrierValue = this.readRestartBarrier(this.options.clock.nowMs());
    if (result.snapshot.disposition === 'PERSISTENCE_FAILED') {
      this.applicationFailureCode = 'VALIDATE_ONLY_PERSISTENCE_FAILED';
    }
    return result;
  }

  controlState(): Readonly<SystemControlState> {
    return this.effectiveControlState();
  }

  strategyIntakeState(strategy: 'basis' | 'volume'): Readonly<StrategyIntakeControlReadback> {
    const checkpoint = this.checkpoint();
    const desiredPaused = checkpoint === null
      ? true
      : strategy === 'basis'
        ? checkpoint.strategyIntake.basisPaused
        : checkpoint.strategyIntake.volumePaused;
    const owner = this.options.strategyIntake?.[strategy];
    if (!owner || typeof owner.readPaused !== 'function') {
      return Object.freeze({
        strategy,
        desiredPaused,
        effectivePaused: null,
        controlRevision: this.controls.snapshot().revision,
        state: 'OWNER_NOT_WIRED',
      });
    }
    const pendingPublications = this.persistence.readPendingControlRuntimePublications();
    const publicationKnown = pendingPublications.ok && pendingPublications.value.length === 0;
    try {
      const effectivePaused = owner.readPaused();
      if (typeof effectivePaused !== 'boolean') throw new TypeError('strategy intake readback must be boolean');
      return Object.freeze({
        strategy,
        desiredPaused,
        effectivePaused,
        controlRevision: this.controls.snapshot().revision,
        state: publicationKnown && effectivePaused === desiredPaused ? 'APPLIED' : 'EFFECT_UNAVAILABLE',
      });
    } catch {
      return Object.freeze({
        strategy,
        desiredPaused,
        effectivePaused: null,
        controlRevision: this.controls.snapshot().revision,
        state: 'EFFECT_UNAVAILABLE',
      });
    }
  }

  strategySymbolPolicyState(
    strategy: 'basis' | 'volume',
    symbol: string,
  ): Readonly<StrategySymbolPolicyControlReadback> {
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) throw new TypeError('symbol must be canonical');
    const checkpoint = this.checkpoint();
    const desired = checkpoint === null
      ? []
      : strategy === 'basis'
        ? checkpoint.strategySymbolPolicy.basisBlocked
        : checkpoint.strategySymbolPolicy.volumeBlocked;
    const owner = this.options.strategySymbolPolicy?.[strategy];
    const base = { strategy, symbol, desiredBlocked: desired.includes(symbol), controlRevision: this.controls.snapshot().revision } as const;
    if (!owner || typeof owner.readBlockedSymbols !== 'function' || typeof owner.isAllowed !== 'function') {
      return Object.freeze({ ...base, effectiveBlocked: null, effectiveAllowed: null, state: 'OWNER_NOT_WIRED' });
    }
    const pending = this.persistence.readPendingControlRuntimePublications();
    try {
      const effectiveBlocked = owner.readBlockedSymbols().includes(symbol);
      const effectiveAllowed = owner.isAllowed(symbol);
      return Object.freeze({
        ...base,
        effectiveBlocked,
        effectiveAllowed,
        state: pending.ok && pending.value.length === 0 && checkpoint !== null
          && effectiveBlocked === base.desiredBlocked ? 'APPLIED' : 'EFFECT_UNAVAILABLE',
      });
    } catch {
      return Object.freeze({ ...base, effectiveBlocked: null, effectiveAllowed: null, state: 'EFFECT_UNAVAILABLE' });
    }
  }

  sizeCeilingState(scope: 'SYSTEM' | 'BASIS' | 'VOLUME'): Readonly<SizeCeilingControlReadback> {
    const checkpoint = this.checkpoint();
    const field = scope === 'SYSTEM' ? 'system' : scope === 'BASIS' ? 'basis' : 'volume';
    const desiredMaximumNotionalUsd = checkpoint?.sizeCeilings[field] ?? null;
    const owner = this.options.sizeCeilings?.[scope];
    const base = { scope, desiredMaximumNotionalUsd, controlRevision: this.controls.snapshot().revision } as const;
    if (!owner || typeof owner.readCeiling !== 'function') {
      return Object.freeze({ ...base, effectiveMaximumNotionalUsd: null, state: 'OWNER_NOT_WIRED' });
    }
    const pending = this.persistence.readPendingControlRuntimePublications();
    try {
      const effectiveMaximumNotionalUsd = owner.readCeiling();
      if (effectiveMaximumNotionalUsd === null
        || normalizeNonNegativeExactDecimal(effectiveMaximumNotionalUsd) !== effectiveMaximumNotionalUsd) {
        throw new TypeError('size ceiling readback unavailable');
      }
      return Object.freeze({
        ...base,
        effectiveMaximumNotionalUsd,
        state: desiredMaximumNotionalUsd !== null && desiredMaximumNotionalUsd === effectiveMaximumNotionalUsd
          && pending.ok && pending.value.length === 0 ? 'APPLIED' : 'UNAVAILABLE',
      });
    } catch {
      return Object.freeze({ ...base, effectiveMaximumNotionalUsd: null, state: 'UNAVAILABLE' });
    }
  }

  strategyThresholdState(strategy: 'BASIS' | 'VOLUME'): Readonly<StrategyThresholdControlReadback> {
    const identity = thresholdIdentity(strategy);
    const checkpoint = this.checkpoint();
    const desiredValue = checkpoint?.strategyThresholds[identity.field] ?? null;
    const owner = this.options.strategyThresholds?.[strategy];
    const base = {
      strategy,
      threshold: identity.threshold,
      desiredValue,
      controlRevision: this.controls.snapshot().revision,
    } as const;
    if (!owner || typeof owner.readThreshold !== 'function') {
      return Object.freeze({ ...base, effectiveValue: null, state: 'OWNER_NOT_WIRED' });
    }
    const pending = this.persistence.readPendingControlRuntimePublications();
    try {
      const read = owner.readThreshold();
      if (read === null) throw new TypeError('strategy threshold readback unavailable');
      const effectiveValue = canonicalStrategyThreshold(strategy, read);
      return Object.freeze({
        ...base,
        effectiveValue,
        state: desiredValue !== null && desiredValue === effectiveValue
          && pending.ok && pending.value.length === 0 ? 'APPLIED' : 'UNAVAILABLE',
      });
    } catch {
      return Object.freeze({ ...base, effectiveValue: null, state: 'UNAVAILABLE' });
    }
  }

  private restoreStrategyIntake(
    posture: Readonly<{ basisPaused: boolean; volumePaused: boolean }>,
  ): boolean {
    for (const strategy of ['basis', 'volume'] as const) {
      const owner = this.options.strategyIntake?.[strategy];
      const desiredPaused = strategy === 'basis' ? posture.basisPaused : posture.volumePaused;
      if (!owner || typeof owner.readPaused !== 'function' || typeof owner.setPaused !== 'function') {
        // A legacy/test composition with no strategy owner may start only when
        // there is no durable effect to restore. A persisted pause still fails
        // closed because pretending it applied would reopen proposal intake.
        if (desiredPaused) return false;
        continue;
      }
      try {
        owner.setPaused(desiredPaused);
        if (owner.readPaused() !== desiredPaused) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  private restoreStrategySymbolPolicy(
    posture: Readonly<{ basisBlocked: readonly string[]; volumeBlocked: readonly string[] }>,
  ): boolean {
    for (const strategy of ['basis', 'volume'] as const) {
      const owner = this.options.strategySymbolPolicy?.[strategy];
      const desired = strategy === 'basis' ? posture.basisBlocked : posture.volumeBlocked;
      if (!owner || typeof owner.readBlockedSymbols !== 'function' || typeof owner.setBlocked !== 'function') {
        if (desired.length > 0) return false;
        continue;
      }
      try {
        const current = owner.readBlockedSymbols();
        if (!Array.isArray(current)) return false;
        for (const symbol of current) if (!desired.includes(symbol)) owner.setBlocked(symbol, false);
        for (const symbol of desired) owner.setBlocked(symbol, true);
        const restored = owner.readBlockedSymbols();
        if (JSON.stringify([...restored].sort()) !== JSON.stringify([...desired].sort())) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  private restoreSizeCeilings(
    ceilings: Readonly<{ system: string | null; basis: string | null; volume: string | null }>,
  ): boolean {
    for (const scope of ['SYSTEM', 'BASIS', 'VOLUME'] as const) {
      const field = scope === 'SYSTEM' ? 'system' : scope === 'BASIS' ? 'basis' : 'volume';
      const desired = ceilings[field];
      const owner = this.options.sizeCeilings?.[scope];
      if (desired === null) continue;
      if (!owner || typeof owner.readCeiling !== 'function' || typeof owner.setCeiling !== 'function') return false;
      try {
        if (normalizeNonNegativeExactDecimal(desired) !== desired) return false;
        const before = owner.readCeiling();
        if (before === null || compareExactDecimals(
          desired as NonNegativeDecimal,
          normalizeNonNegativeExactDecimal(before),
        ) > 0) return false;
        owner.setCeiling(desired);
        if (owner.readCeiling() !== desired) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  private restoreStrategyThresholds(
    thresholds: Readonly<{ basisMinNetPct: string | null; volume1sMultiple: string | null }>,
  ): boolean {
    for (const strategy of ['BASIS', 'VOLUME'] as const) {
      const identity = thresholdIdentity(strategy);
      const desired = thresholds[identity.field];
      if (desired === null) continue;
      const owner = this.options.strategyThresholds?.[strategy];
      if (!owner || typeof owner.readThreshold !== 'function' || typeof owner.setThreshold !== 'function') return false;
      try {
        if (canonicalStrategyThreshold(strategy, desired) !== desired) return false;
        owner.setThreshold(desired);
        if (owner.readThreshold() !== desired) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  private externalKillSwitchEngaged(): boolean {
    try {
      return this.options.readEnvironment().killSwitchEngaged !== false;
    } catch {
      return true;
    }
  }

  private effectiveControlState(): Readonly<SystemControlState> {
    const persisted = this.controls.snapshot();
    const externalKillEngaged = this.externalKillSwitchEngaged();
    return Object.freeze({
      ...persisted,
      killSwitchEngaged: persisted.killSwitchEngaged || externalKillEngaged,
      intakePaused: persisted.intakePaused || externalKillEngaged,
    });
  }

  private postureBlockerCodes(control: Readonly<SystemControlState>): readonly string[] {
    const codes: string[] = [];
    if (control.killSwitchEngaged) codes.push('EFFECTIVE_KILL_SWITCH_ENGAGED');
    if (control.intakePaused) codes.push('EFFECTIVE_INTAKE_PAUSED');
    return Object.freeze(codes);
  }

  private checkpoint(): Readonly<SystemIntegrationCheckpointState> | null {
    const current = this.persistence.currentState();
    return current.ok ? current.value : null;
  }

  private ownerSummaries(): ApplicationOwnerSummaries | null {
    try {
      return this.options.summaries?.readSupervisorSummaries() ?? null;
    } catch {
      return null;
    }
  }

  private ledgerWritable(): boolean | null {
    if (!this.options.ledger.probeWritable) return null;
    try { return this.options.ledger.probeWritable(false); } catch { return false; }
  }

  private ledgerSchemaCompatibility(): Readonly<LedgerSchemaCompatibilityReadback> {
    if (!this.options.ledger.readSchemaCompatibility) {
      return Object.freeze({
        state: 'UNAVAILABLE',
        currentSchemaVersion: null,
        rollbackFloor: null,
        reasonCode: 'LEDGER_SCHEMA_COMPATIBILITY_CAPABILITY_NOT_CONFIGURED',
      });
    }
    try {
      return this.options.ledger.readSchemaCompatibility();
    } catch {
      return Object.freeze({
        state: 'UNAVAILABLE',
        currentSchemaVersion: null,
        rollbackFloor: null,
        reasonCode: 'LEDGER_SCHEMA_COMPATIBILITY_READ_FAILED',
      });
    }
  }

  private persistedTraceEvents(): readonly Readonly<SystemTraceEvent>[] {
    const state = this.checkpoint();
    if (!state) {
      this.persistedTraceCache = null;
      return Object.freeze([]);
    }
    if (this.persistedTraceCache?.checkpointRevision === state.revision) {
      return this.persistedTraceCache.events;
    }
    const correlations = [...new Set(state.traceIndex.map((entry) => entry.correlationId))];
    const queried = this.persistence.queryTraces(correlations.map((traceCorrelationId) => ({
      correlationId: traceCorrelationId,
      limit: SYSTEM_PERSISTENCE_LIMITS.maximumTraceQueryLimit,
    })));
    if (!queried.ok) return Object.freeze([]);
    const events = Object.freeze(queried.value
      .flatMap((result) => result.events.map((entry) => entry.event))
      .slice(-MAX_TRACE_EVENTS));
    this.persistedTraceCache = Object.freeze({ checkpointRevision: state.revision, events });
    return events;
  }

  private ownerTraceEvents(): readonly Readonly<SystemTraceEvent>[] {
    try {
      const events = this.options.traces?.readTraceEvents() ?? [];
      return Object.freeze([...events].slice(-MAX_TRACE_EVENTS));
    } catch {
      return Object.freeze([]);
    }
  }

  private traceEvents(): readonly Readonly<SystemTraceEvent>[] {
    return uniqueTraceEvents([this.persistedTraceEvents(), this.ownerTraceEvents()]).slice(-MAX_TRACE_EVENTS);
  }

  supervisor(): Readonly<SystemSupervisorReadModel> {
    const nowMs = this.options.clock.nowMs();
    this.pendingControlRuntimePublications();
    const managed = this.composition.read();
    const checkpoint = this.checkpoint();
    const control = this.effectiveControlState();
    const persistenceFailureCode = checkpoint === null ? 'PERSISTENCE_NOT_LOADED' : null;
    const components = buildApplicationComponents({
      nowMs,
      managed,
      health: this.health,
      ...(this.options.components ? { ports: this.options.components } : {}),
      checkpoint,
      persistenceFailureCode,
      applicationFailureCode: this.applicationFailureCode
        ?? this.controlPublicationFailureCode
        ?? this.restartTruthRefreshFailureCode,
      postureBlockerCodes: this.postureBlockerCodes(control),
      control,
      validateOnlyRun: this.latestValidateOnly,
    });
    const summaries = mergeApplicationSummaries(
      defaultApplicationSummaries(
        checkpoint,
        this.ledgerWritable(),
        this.ledgerSchemaCompatibility(),
      ),
      this.ownerSummaries(),
      this.latestValidateOnly,
    );
    const applicationProjectionFailure = this.applicationFailureCode
      ?? this.controlPublicationFailureCode
      ?? this.restartTruthRefreshFailureCode;
    const runtime: Readonly<RuntimeStatusSnapshot> = applicationProjectionFailure === null
      ? managed.supervisor
      : Object.freeze({
          ...managed.supervisor,
          desiredState: 'RUNNING' as const,
          phase: 'FAILED' as const,
          lastError: createStructuredFailure({
            component: 'systemIntegration.application',
            stage: 'supervisor-projection',
            code: applicationProjectionFailure,
            message: 'The outer system-integration application is fail-closed.',
            occurredAt: nowMs,
            retryable: true,
            safeCurrentState: 'READ_CONTROL_SHELL_ONLY',
            recommendedOperatorAction: 'Restore durable persistence or the failed managed publication before retrying.',
            correlationId: control.correlationId,
          }),
        });
    const revision = runtime.revision + (checkpoint?.revision ?? 0);
    const projected = buildSystemSupervisorProjection({
      nowMs,
      correlationId: control.correlationId,
      revision,
      runtime,
      control,
      components,
      summaries,
      traceEvents: this.traceEvents(),
    });
    if (!projected.ok) {
      throw new Error(`System integration supervisor projection failed: ${projected.failure.code}: ${projected.failure.message}`);
    }
    return projected.value;
  }

  private eventPage(query: Readonly<SystemIntegrationEventQuery>): Readonly<SystemIntegrationEventPage> {
    const ordered = [...this.traceEvents()].sort((left, right) => (
      right.occurredAtMs - left.occurredAtMs
      || right.sequence - left.sequence
      || left.id.localeCompare(right.id)
    ));
    let start = 0;
    let end = ordered.length;
    if (query.beforeId) {
      const index = ordered.findIndex((event) => event.id === query.beforeId);
      if (index >= 0) start = index + 1;
    }
    if (query.afterId) {
      const index = ordered.findIndex((event) => event.id === query.afterId);
      if (index >= 0) end = index;
    }
    const window = ordered.slice(start, end);
    const items = Object.freeze(window.slice(0, query.limit));
    return Object.freeze({
      items,
      nextBeforeId: window.length > items.length && items.length > 0 ? items[items.length - 1].id : null,
      nextAfterId: start > 0 && items.length > 0 ? items[0].id : null,
    });
  }

  private refusedDrainResult(
    drainCorrelationId: string,
    blockerCodes: readonly string[],
    blockingIdentityReferences: readonly Readonly<SystemApplicationDrainBlockingReference>[],
    persistenceFailureCode: SystemApplicationDrainResult['persistenceFailureCode'],
  ): Readonly<SystemApplicationDrainResult> {
    const result = Object.freeze({
      ok: false,
      clean: false,
      disposition: 'REFUSED_RECOVERY_SUPERVISION_REQUIRED' as const,
      phase: this.phaseValue,
      correlationId: drainCorrelationId,
      blockerCodes: Object.freeze([...blockerCodes]),
      blockingIdentityReferences: Object.freeze([...blockingIdentityReferences]),
      composition: this.composition.read(),
      finalCheckpoint: null,
      persistenceFailureCode,
      ledgerCloseMayProceed: false,
    });
    this.drainAdmissionInProgress = false;
    if (this.phaseValue === 'RUNNING' && this.startupSucceeded) {
      this.startRestartTruthRefresh();
    }
    return result;
  }

  drain(): Promise<Readonly<SystemApplicationDrainResult>> {
    if (this.drainPromise !== null) return this.drainPromise;
    const attempt = this.prepareDrain();
    this.drainPromise = attempt;
    void attempt.then(
      (result) => {
        if ((result.disposition === 'REFUSED_RECOVERY_SUPERVISION_REQUIRED'
          || result.disposition === 'DRAIN_FAILED')
          && this.drainPromise === attempt) this.drainPromise = null;
      },
      () => {
        this.drainAdmissionInProgress = false;
        if (this.phaseValue === 'RUNNING' && this.startupSucceeded) {
          this.startRestartTruthRefresh();
        }
        if (this.drainPromise === attempt) this.drainPromise = null;
      },
    );
    return attempt;
  }

  private async prepareDrain(): Promise<Readonly<SystemApplicationDrainResult>> {
    // Fence effectful owner reads at drain-attempt admission, before any
    // asynchronous identity or canonical-truth check can yield control.
    this.drainAdmissionInProgress = true;
    this.stopRestartTruthRefresh();
    const nowMs = this.options.clock.nowMs();
    const drainCorrelationId = correlationId('system-drain', nowMs);
    const blockingRead = this.persistence.readProductBlockingIdentityReferences();
    if (!blockingRead.ok) {
      return this.refusedDrainResult(
        drainCorrelationId,
        [
          'ORDINARY_DRAIN_IDENTITY_REFERENCE_READ_UNAVAILABLE',
          blockingRead.code,
        ],
        [],
        blockingRead.code,
      );
    }
    // The canonical Ledger reader owns the exact blocking vocabulary and
    // returns only unresolved restart/shutdown references. The application
    // consumes that truth without maintaining a second policy list.
    const controlPublicationReferences = this.pendingControlRuntimePublications()
      .map((reference) => this.controlPublicationBlockingReference(reference));
    const blockingIdentityReferences = [
      ...blockingRead.value.map(frozenDrainBlockingReference),
      ...controlPublicationReferences,
    ]
      .sort((left, right) => (
        left.referenceType.localeCompare(right.referenceType, 'en')
        || left.referenceId.localeCompare(right.referenceId, 'en')
        || left.ownerRevision.localeCompare(right.ownerRevision, 'en')
      ));
    if (blockingIdentityReferences.length > 0) {
      const typeCodes = [...new Set(blockingIdentityReferences.map(
        (reference) => `UNRESOLVED_PRODUCT_IDENTITY_REFERENCE_${reference.referenceType}`,
      ))].sort();
      return this.refusedDrainResult(
        drainCorrelationId,
        [
          'ORDINARY_DRAIN_REFUSED_RECOVERY_SUPERVISION_REQUIRED',
          ...typeCodes,
        ],
        blockingIdentityReferences,
        null,
      );
    }

    const canonicalTruthBlockers = await this.ordinaryDrainTruthBlockers(nowMs);
    if (canonicalTruthBlockers.length > 0) {
      return this.refusedDrainResult(
        drainCorrelationId,
        [
          'ORDINARY_DRAIN_REFUSED_RECOVERY_SUPERVISION_REQUIRED',
          ...canonicalTruthBlockers,
        ],
        [],
        null,
      );
    }
    this.drainAdmissionInProgress = false;
    this.phaseValue = 'DRAINING';
    return this.drainApplication();
  }

  private async drainApplication(): Promise<Readonly<SystemApplicationDrainResult>> {
    let managed: Readonly<ManagedCompositionReadSnapshot>;
    try {
      managed = await this.composition.drain();
    } catch {
      managed = this.composition.read();
    }
    const nowMs = this.options.clock.nowMs();
    const drainCorrelationId = correlationId('system-drain', nowMs);
    const physicalClean = this.startupSucceeded
      && managed.cleanShutdown
      && managed.driverFailureCode === null
      && managed.drainFailureCode === null;
    const checkpoint = this.checkpoint();
    const control = this.effectiveControlState();
    const components = buildApplicationComponents({
          nowMs,
          managed,
          health: this.health,
          ...(this.options.components ? { ports: this.options.components } : {}),
          checkpoint,
          persistenceFailureCode: checkpoint === null ? 'PERSISTENCE_NOT_LOADED' : null,
          applicationFailureCode: this.applicationFailureCode
            ?? this.controlPublicationFailureCode
            ?? this.restartTruthRefreshFailureCode,
          postureBlockerCodes: this.postureBlockerCodes(control),
          control,
          validateOnlyRun: this.latestValidateOnly,
        });
    const finalCheckpoint = this.persistence.persistFinalShutdown({
      stoppedAtMs: nowMs,
      correlationId: drainCorrelationId,
      clean: physicalClean,
      componentStates: components.map((component) => Object.freeze({
            componentId: component.componentId,
            desiredState: component.desiredState,
            generation: component.generation,
          })),
    });
    const durableShutdown = finalCheckpoint.ok ? this.checkpoint()?.lastShutdown ?? null : null;
    const finalCheckpointReadbackProven = finalCheckpoint.ok
      && durableShutdown !== null
      && durableShutdown.stoppedAtMs === nowMs
      && durableShutdown.correlationId === drainCorrelationId
      && durableShutdown.clean === physicalClean;
    const finalCheckpointFailureCode = finalCheckpoint.ok
      ? finalCheckpointReadbackProven ? null : 'PERSISTENCE_READ_FAILED' as const
      : finalCheckpoint.code;
    const clean = physicalClean
      && finalCheckpointReadbackProven
      && durableShutdown?.clean === true;
    this.phaseValue = clean ? 'DRAINED' : 'MAINTENANCE';
    const blockerCodes = clean
      ? Object.freeze([])
      : Object.freeze([
          ...(this.startupSucceeded ? [] : ['APPLICATION_STARTUP_NOT_PROVEN']),
          ...(managed.driverFailureCode === null ? [] : [managed.driverFailureCode]),
          ...(managed.drainFailureCode === null ? [] : [managed.drainFailureCode]),
          ...(finalCheckpointFailureCode === null ? [] : [finalCheckpointFailureCode]),
        ]);
    return Object.freeze({
      ok: clean,
      clean,
      disposition: clean ? 'DRAINED' as const : 'DRAIN_FAILED' as const,
      phase: this.phaseValue,
      correlationId: drainCorrelationId,
      blockerCodes,
      blockingIdentityReferences: Object.freeze([]),
      composition: managed,
      finalCheckpoint: finalCheckpointReadbackProven ? finalCheckpoint.value : null,
      persistenceFailureCode: finalCheckpointFailureCode,
      ledgerCloseMayProceed: clean,
    });
  }
}

export function createSystemIntegrationApplication(
  options: SystemIntegrationApplicationLifecycleOptions,
): SystemIntegrationApplication {
  return new SystemIntegrationApplication(options);
}
