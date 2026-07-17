import {
  createStructuredFailure,
  fail,
  type ControlCommand,
  type RuntimePhase,
} from '../../foundation/contracts/index.js';
import {
  createDeterministicSupervisor,
  type CommandResult,
  type DeterministicSupervisor,
} from '../../foundation/control/index.js';
import type { SystemComponentId } from '../contracts/constants.js';
import { createCoreManagedGraph, type CoreManagedGraph } from './graph.js';
import type {
  ManagedCompositionControl,
  ManagedCompositionOptions,
  ManagedCompositionReadSnapshot,
  ManagedDrainOutcome,
  ManagedRestartCommandIdentity,
  ManagedRestartCompletionReadback,
  ScheduledTask,
} from './types.js';

const DEFAULT_TICK_INTERVAL_MS = 250;
const DEFAULT_GATE_TIMEOUT_MS = 5_000;
const DEFAULT_COMPONENT_TIMEOUT_MS = 30_000;
const DEFAULT_DRAIN_TIMEOUT_MS = 45_000;
const TERMINAL_UNOWNED_PHASES = new Set<RuntimePhase>(['STOPPED', 'BLOCKED', 'FAILED']);

function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * One explicit lifecycle owner for the existing Market/Basis/Volume runtimes.
 * Construction is inert; start()/driveOnce()/drain() are the only effectful
 * entrypoints.
 */
export class ManagedRuntimeComposition implements ManagedCompositionControl {
  private readonly graph: CoreManagedGraph;
  private readonly supervisor: DeterministicSupervisor;
  private readonly tickIntervalMs: number;
  private readonly drainTimeoutMs: number;

  private driverTask: ScheduledTask | null = null;
  private acceptingCommands = true;
  private draining = false;
  private drainCompleted = false;
  private drainTimedOut = false;
  private drainOutcome: ManagedDrainOutcome = 'NOT_REQUESTED';
  private drainFailureCode: string | null = null;
  private drainStartedAtMs: number | null = null;
  private stopIssuedForDrain = false;
  private drainPromise: Promise<Readonly<ManagedCompositionReadSnapshot>> | null = null;
  private resolveDrain: ((snapshot: Readonly<ManagedCompositionReadSnapshot>) => void) | null = null;
  private lastDriveAtMs: number | null = null;
  private driverFailureCode: string | null = null;
  private pauseAfterStart = false;

  constructor(private readonly options: ManagedCompositionOptions) {
    if (!options || typeof options.clock?.nowMs !== 'function') {
      throw new TypeError('ManagedCompositionOptions.clock.nowMs is required');
    }
    if (typeof options.scheduler?.scheduleEvery !== 'function') {
      throw new TypeError('ManagedCompositionOptions.scheduler.scheduleEvery is required');
    }
    if (typeof options.readEnvironment !== 'function') {
      throw new TypeError('ManagedCompositionOptions.readEnvironment is required');
    }
    this.tickIntervalMs = positiveSafeInteger(
      'tickIntervalMs',
      options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS,
    );
    const gateTimeoutMs = positiveSafeInteger(
      'defaultGateTimeoutMs',
      options.defaultGateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS,
    );
    const componentTimeoutMs = positiveSafeInteger(
      'defaultComponentTimeoutMs',
      options.defaultComponentTimeoutMs ?? DEFAULT_COMPONENT_TIMEOUT_MS,
    );
    this.drainTimeoutMs = positiveSafeInteger(
      'drainTimeoutMs',
      options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS,
    );
    this.graph = createCoreManagedGraph(options.ports);
    this.supervisor = createDeterministicSupervisor(
      {
        scope: 'systemIntegration.managedRuntime',
        runMode: 'INTELLIGENCE',
        defaultGateTimeoutMs: gateTimeoutMs,
        defaultComponentTimeoutMs: componentTimeoutMs,
      },
      {
        components: this.graph.ordered,
        gates: [],
        readEnvironment: options.readEnvironment,
      },
    );
  }

  start(): CommandResult {
    this.ensureDriver();
    return this.issue('START');
  }

  startPaused(): CommandResult {
    this.pauseAfterStart = true;
    const command = this.start();
    if (!command.ok) this.pauseAfterStart = false;
    return command;
  }

  validate(): CommandResult {
    this.ensureDriver();
    return this.issue('VALIDATE');
  }

  restart(): CommandResult {
    this.ensureDriver();
    return this.issue('RESTART');
  }

  issue(command: ControlCommand): CommandResult {
    const nowMs = this.options.clock.nowMs();
    if (!this.acceptingCommands && command !== 'STOP') {
      return fail(createStructuredFailure({
        component: 'system-integration-composition',
        stage: 'command',
        code: 'COMPOSITION_DRAINING',
        message: 'The managed composition is draining and accepts no new non-stop command.',
        occurredAt: nowMs,
        retryable: false,
        safeCurrentState: this.supervisor.snapshot().phase,
        recommendedOperatorAction: 'Wait for shutdown to complete before constructing a new composition.',
        correlationId: `composition-drain-${this.supervisor.snapshot().revision}`,
      }));
    }
    return this.issueAt(command, nowMs);
  }

  driveOnce(): Readonly<ManagedCompositionReadSnapshot> {
    const nowMs = this.options.clock.nowMs();
    this.supervisor.tick(nowMs);
    this.lastDriveAtMs = nowMs;
    this.advancePauseAfterStart(nowMs);
    const status = this.supervisor.snapshot();
    this.abortUnownedAfterTerminal(status.phase, status.commandCorrelationId);
    this.advanceDrain(nowMs);
    return this.read();
  }

  drain(): Promise<Readonly<ManagedCompositionReadSnapshot>> {
    if (this.drainPromise !== null && (!this.drainCompleted || this.drainOutcome === 'CLEAN')) {
      return this.drainPromise;
    }
    // A failed physical stop is recoverable only by an explicit later drain
    // call after the failing owner has been repaired. Reset attempt-local
    // bookkeeping, never the supervisor's failure history or driver failure.
    this.drainPromise = null;
    this.resolveDrain = null;
    this.acceptingCommands = false;
    this.draining = true;
    this.drainCompleted = false;
    this.drainTimedOut = false;
    this.drainOutcome = 'IN_PROGRESS';
    this.drainFailureCode = null;
    this.stopIssuedForDrain = false;
    this.pauseAfterStart = false;
    this.drainStartedAtMs = this.options.clock.nowMs();
    this.ensureDriver();
    this.drainPromise = new Promise((resolve) => {
      this.resolveDrain = resolve;
    });
    this.advanceDrain(this.drainStartedAtMs);
    return this.drainPromise;
  }

  read(): Readonly<ManagedCompositionReadSnapshot> {
    const remainingOwnedComponentIds = this.remainingOwnedComponentIds();
    const supervisor = this.supervisor.snapshot();
    const cleanShutdown = this.drainOutcome === 'CLEAN'
      && remainingOwnedComponentIds.length === 0
      && supervisor.phase === 'STOPPED';
    return Object.freeze({
      supervisor,
      componentOrder: Object.freeze(this.graph.ordered.map((adapter) => adapter.name)),
      adapters: Object.freeze(this.graph.ordered.map((adapter) => adapter.read())),
      driverRunning: this.driverTask !== null,
      acceptingCommands: this.acceptingCommands,
      draining: this.draining,
      drainCompleted: this.drainCompleted,
      drainTimedOut: this.drainTimedOut,
      drainOutcome: this.drainOutcome,
      cleanShutdown,
      drainFailureCode: this.drainFailureCode,
      remainingOwnedComponentIds: Object.freeze(remainingOwnedComponentIds),
      lastDriveAtMs: this.lastDriveAtMs,
      driverFailureCode: this.driverFailureCode,
    });
  }

  /**
   * Read one edge-triggered restart from the canonical supervisor itself.
   * Stable RUNNING posture is insufficient: success must retain the exact
   * accepted command revision, target generation, and correlated transition.
   */
  readRestartCompletion(
    identity: Readonly<ManagedRestartCommandIdentity>,
  ): ManagedRestartCompletionReadback {
    if (!identity || typeof identity !== 'object'
      || typeof identity.correlationId !== 'string' || identity.correlationId.length === 0
      || !Number.isSafeInteger(identity.revision) || identity.revision < 0
      || !Number.isSafeInteger(identity.targetGeneration) || identity.targetGeneration < 1) {
      return 'UNKNOWN';
    }
    const snapshot = this.supervisor.snapshot();
    if (snapshot.revision !== identity.revision) return 'UNKNOWN';
    if (snapshot.commandCorrelationId !== null) {
      const generationIsExpected = snapshot.generation === identity.targetGeneration
        || snapshot.generation + 1 === identity.targetGeneration;
      return snapshot.commandCorrelationId === identity.correlationId && generationIsExpected
        ? 'PENDING'
        : 'UNKNOWN';
    }
    if (snapshot.generation !== identity.targetGeneration) return 'UNKNOWN';

    const transitionTargets = this.supervisor.transitionTargetsForCorrelation(identity.correlationId);
    if (transitionTargets.length === 0) return 'UNKNOWN';
    if (snapshot.desiredState === 'RUNNING'
      && (snapshot.phase === 'RUNNING' || snapshot.phase === 'DEGRADED')
      && transitionTargets.some((target) => target === 'RUNNING' || target === 'DEGRADED')) {
      return 'APPLIED';
    }
    if ((snapshot.phase === 'FAILED' || snapshot.phase === 'BLOCKED')
      && transitionTargets.includes(snapshot.phase)) {
      return 'FAILED';
    }
    return 'UNKNOWN';
  }

  private ensureDriver(): void {
    if (this.driverTask !== null || this.drainCompleted) return;
    this.driverTask = this.options.scheduler.scheduleEvery(this.tickIntervalMs, () => {
      try {
        this.driveOnce();
      } catch {
        this.handleDriverFailure();
      }
    });
  }

  private advancePauseAfterStart(nowMs: number): void {
    if (!this.pauseAfterStart || this.draining) return;
    const status = this.supervisor.snapshot();
    if (status.commandCorrelationId !== null) return;
    if (status.phase === 'PAUSED') {
      this.pauseAfterStart = false;
      return;
    }
    if (status.phase === 'RUNNING' || status.phase === 'DEGRADED') {
      const pause = this.issueAt('PAUSE', nowMs);
      if (!pause.ok) this.pauseAfterStart = false;
      return;
    }
    if (status.phase === 'FAILED' || status.phase === 'BLOCKED' || status.phase === 'STOPPED') {
      this.pauseAfterStart = false;
    }
  }

  private issueAt(command: ControlCommand, nowMs: number): CommandResult {
    return this.supervisor.issue({
      command,
      revision: this.supervisor.snapshot().revision + 1,
      nowMs,
    });
  }

  private advanceDrain(nowMs: number): void {
    if (!this.draining || this.drainCompleted) return;
    const startedAt = this.drainStartedAtMs;
    if (startedAt !== null && nowMs - startedAt >= this.drainTimeoutMs) {
      this.drainTimedOut = true;
      this.drainFailureCode = 'DRAIN_TIMEOUT';
      this.forceStopAllReverse();
      this.completeDrain();
      return;
    }

    let status = this.supervisor.snapshot();
    if (status.commandCorrelationId !== null) return;
    if (!this.stopIssuedForDrain) {
      this.stopIssuedForDrain = true;
      const result = this.issueAt('STOP', nowMs);
      if (!result.ok) {
        this.drainFailureCode = result.failure.code;
        this.forceStopAllReverse();
        this.completeDrain();
        return;
      }
      status = this.supervisor.snapshot();
      this.abortUnownedAfterTerminal(status.phase, status.commandCorrelationId);
    }

    if (status.commandCorrelationId === null && (status.phase === 'STOPPED' || status.phase === 'FAILED')) {
      this.completeDrain();
    }
  }

  private abortUnownedAfterTerminal(phase: RuntimePhase, correlationId: string | null): void {
    if (correlationId !== null || !TERMINAL_UNOWNED_PHASES.has(phase)) return;
    if (phase === 'FAILED') {
      // Foundation preserves the primary failure and started-set evidence.
      // The composition separately enforces physical safety: a terminal
      // failure cannot leave admitted transports or strategy timers alive.
      this.forceStopAllReverse();
      return;
    }
    const admitted = new Set(this.supervisor.startedComponents());
    for (const adapter of [...this.graph.ordered].reverse()) {
      if (!admitted.has(adapter.name)) adapter.abortUnowned();
    }
  }

  private forceStopAllReverse(): void {
    for (const adapter of [...this.graph.ordered].reverse()) adapter.forceStop();
  }

  private handleDriverFailure(): void {
    this.driverFailureCode = 'COMPOSITION_DRIVER_FAILED';
    this.drainFailureCode = 'COMPOSITION_DRIVER_FAILED';
    this.forceStopAllReverse();
    if (this.draining) {
      this.completeDrain();
      return;
    }
    this.cancelDriver();
  }

  private completeDrain(): void {
    if (this.drainCompleted) return;
    const remainingOwned = this.remainingOwnedComponentIds();
    const supervisor = this.supervisor.snapshot();
    if (this.drainTimedOut) {
      this.drainOutcome = 'TIMED_OUT';
      this.drainFailureCode ??= 'DRAIN_TIMEOUT';
    } else if (remainingOwned.length > 0) {
      this.drainOutcome = 'FAILED';
      this.drainFailureCode = 'DRAIN_RETAINED_OWNERSHIP';
    } else if (supervisor.phase !== 'STOPPED') {
      this.drainOutcome = 'FAILED';
      this.drainFailureCode ??= supervisor.lastError?.code ?? 'DRAIN_NOT_STOPPED';
    } else {
      this.drainOutcome = 'CLEAN';
      this.drainFailureCode = null;
    }
    this.draining = false;
    this.drainCompleted = true;
    this.cancelDriver();
    const resolve = this.resolveDrain;
    this.resolveDrain = null;
    resolve?.(this.read());
  }

  private cancelDriver(): void {
    this.driverTask?.cancel();
    this.driverTask = null;
  }

  private remainingOwnedComponentIds(): SystemComponentId[] {
    return this.graph.ordered
      .filter((adapter) => adapter.read().ownsUnderlyingRuntime)
      .map((adapter) => adapter.name);
  }
}

export function createManagedRuntimeComposition(
  options: ManagedCompositionOptions,
): ManagedRuntimeComposition {
  return new ManagedRuntimeComposition(options);
}
