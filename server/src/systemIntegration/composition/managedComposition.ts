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
    const status = this.supervisor.tick(nowMs);
    this.lastDriveAtMs = nowMs;
    this.abortUnownedAfterTerminal(status.phase, status.commandCorrelationId);
    this.advanceDrain(nowMs);
    return this.read();
  }

  drain(): Promise<Readonly<ManagedCompositionReadSnapshot>> {
    if (this.drainPromise !== null) return this.drainPromise;
    this.acceptingCommands = false;
    this.draining = true;
    this.drainOutcome = 'IN_PROGRESS';
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
        this.driverFailureCode = result.failure.code;
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
