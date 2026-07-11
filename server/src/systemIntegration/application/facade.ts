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
  type RuntimeHealthEvidence,
} from '../composition/index.js';
import {
  SystemIntegrationLedgerAdapter,
  createInitialCheckpointState,
  failClosedRestartBarrier,
  type PersistenceLoadResult,
  type RestartBarrierProjection,
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
  SystemApplicationDrainResult,
  SystemApplicationPhase,
  SystemApplicationStartResult,
  SystemIntegrationApplicationFacade,
  SystemIntegrationApplicationOptions,
} from './types.js';

const MAX_TRACE_EVENTS = 10_000;

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
  private startupSucceeded = false;

  readonly read: SystemIntegrationReadPort;

  constructor(private readonly options: SystemIntegrationApplicationOptions) {
    if (!options || typeof options.clock?.nowMs !== 'function') {
      throw new TypeError('SystemIntegrationApplication requires an injected clock.');
    }
    if (typeof options.scheduler?.scheduleEvery !== 'function') {
      throw new TypeError('SystemIntegrationApplication requires an injected scheduler.');
    }
    if (typeof options.readEnvironment !== 'function') {
      throw new TypeError('SystemIntegrationApplication requires an environment read port.');
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

  private instrumentRuntimes(ports: CoreRuntimePorts): CoreRuntimePorts {
    if (!ports?.market || !ports.basis || !ports.volume) {
      throw new TypeError('SystemIntegrationApplication requires Market, Basis, and Volume runtime ports.');
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

    // The authenticated control shell exists before any data component is
    // admitted. Publication remains persistence-first inside the service.
    this.controlService = new SystemControlService({
      initialState: current.value.control,
      persistence: this.persistence,
      composition: this.controlCompositionPort(),
    });
    this.barrierValue = this.readRestartBarrier(nowMs);
    const command = this.composition.start();
    if (!command.ok) {
      this.phaseValue = 'FAILED';
      this.applicationFailureCode = command.failure.code;
    } else {
      this.phaseValue = 'RUNNING';
      this.startupSucceeded = true;
    }
    return this.cacheStartResult({
      ok: command.ok,
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
    const barrier = this.persistence.restartBarrier(nowMs);
    if (barrier.ok) return barrier.value;
    return failClosedRestartBarrier(nowMs, barrier.code);
  }

  restartBarrier(): Readonly<RestartBarrierProjection> {
    if (this.phaseValue === 'CREATED') return this.barrierValue;
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
    });
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

  private inspectControlMutation(
    mutation: Readonly<SystemControlMutation>,
    control: Readonly<SystemControlState>,
  ): SystemControlCompositionDecision {
    if (this.phaseValue !== 'RUNNING' || this.composition.read().draining) {
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
    if (mutation.command === 'APPLY_CONFIGURATION') {
      return this.decision(false, 'CONFIGURATION_OWNER_NOT_WIRED', 'No configuration owner port is wired to this convergence root.', false);
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
      return mutation.componentId === 'market-universe'
        ? this.decision(true, 'MANAGED_RUNTIME_RESTART_ACCEPTED', '', true)
        : this.decision(false, 'INDIVIDUAL_RUNTIME_RESTART_NOT_SUPPORTED', 'Only the dependency-root managed runtime can restart as one graph.', false);
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
    let command: CommandResult | null = null;
    if (mutation.command === 'RESTART_COMPONENT') {
      command = this.composition.restart();
    } else if (mutation.command === 'SET_COMPONENT_STATE') {
      if (mutation.desiredState === 'STOPPED') command = this.composition.issue('STOP');
      else if (mutation.desiredState === 'PAUSED') command = this.composition.issue('PAUSE');
      else command = this.composition.read().supervisor.phase === 'PAUSED'
        ? this.composition.issue('RESUME')
        : this.composition.start();
    }
    if (command !== null && !command.ok) {
      this.controlPublicationFailureCode = command.failure.code;
      return;
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

  private persistedTraceEvents(): readonly Readonly<SystemTraceEvent>[] {
    const state = this.checkpoint();
    if (!state) return Object.freeze([]);
    const correlations = [...new Set(state.traceIndex.map((entry) => entry.correlationId))];
    const events: SystemTraceEvent[] = [];
    for (const traceCorrelationId of correlations) {
      const queried = this.persistence.queryTrace({ correlationId: traceCorrelationId, limit: 200 });
      if (!queried.ok) continue;
      events.push(...queried.value.events.map((entry) => entry.event));
      if (events.length >= MAX_TRACE_EVENTS) break;
    }
    return Object.freeze(events.slice(-MAX_TRACE_EVENTS));
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
      applicationFailureCode: this.applicationFailureCode ?? this.controlPublicationFailureCode,
      postureBlockerCodes: this.postureBlockerCodes(control),
      control,
      validateOnlyRun: this.latestValidateOnly,
    });
    const summaries = mergeApplicationSummaries(
      defaultApplicationSummaries(checkpoint, this.ledgerWritable()),
      this.ownerSummaries(),
      this.latestValidateOnly,
    );
    const applicationProjectionFailure = this.applicationFailureCode ?? this.controlPublicationFailureCode;
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

  drain(): Promise<Readonly<SystemApplicationDrainResult>> {
    if (this.drainPromise !== null) return this.drainPromise;
    this.phaseValue = 'DRAINING';
    this.drainPromise = this.drainApplication();
    return this.drainPromise;
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
          applicationFailureCode: this.applicationFailureCode ?? this.controlPublicationFailureCode,
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
    this.phaseValue = 'DRAINED';
    return Object.freeze({
      ok: physicalClean && finalCheckpoint.ok,
      clean: physicalClean && finalCheckpoint.ok,
      correlationId: drainCorrelationId,
      composition: managed,
      finalCheckpoint: finalCheckpoint.ok ? finalCheckpoint.value : null,
      persistenceFailureCode: finalCheckpoint.ok ? null : finalCheckpoint.code,
      ledgerCloseMayProceed: true as const,
    });
  }
}

export function createSystemIntegrationApplication(
  options: SystemIntegrationApplicationOptions,
): SystemIntegrationApplication {
  return new SystemIntegrationApplication(options);
}
