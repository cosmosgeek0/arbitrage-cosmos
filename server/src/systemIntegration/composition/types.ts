import type {
  CommandResult,
  ComponentProbe,
  ComponentStepContext,
  ControlCommandRequest,
  ControlEnvironment,
} from '../../foundation/control/index.js';
import type { RuntimeStatusSnapshot } from '../../foundation/contracts/index.js';
import type { SystemComponentId } from '../contracts/constants.js';

export interface UtcClock {
  /** Safe-integer UTC milliseconds. The value must never regress. */
  nowMs(): number;
}

export interface ScheduledTask {
  cancel(): void;
}

export interface RepeatingScheduler {
  scheduleEvery(intervalMs: number, task: () => void): ScheduledTask;
}

export interface RuntimeHealthEvidence extends ComponentProbe {
  /** Liveness is separate from primary-source readiness/freshness. */
  readonly running: boolean;
}

export interface CommonRuntimePort {
  /** Validation is synchronous and side-effect free. */
  validate?(ctx: ComponentStepContext): void;
  /** Existing Market/Basis/Volume shutdown methods are synchronous. */
  stop(): void;
  health(ctx: ComponentStepContext): RuntimeHealthEvidence;
}

/** Narrow directional seam over the existing MarketEngine lifecycle. */
export interface MarketRuntimePort extends CommonRuntimePort {
  init(): Promise<void>;
  start(): void;
}

/** Narrow directional seam over the existing BasisRuntime/VolumeRuntime lifecycle. */
export interface StrategyRuntimePort extends CommonRuntimePort {
  start(): Promise<void>;
}

/** Optional Q/L01 observation mount. It has no strategy or money authority. */
export interface QAdvisoryRuntimePort extends CommonRuntimePort {
  start(): Promise<void>;
}

/**
 * Directional lifecycle over accepted IntelligenceRuntime/IntelligenceFoundation
 * owners. It owns no source transport, strategy, proposal, or money authority.
 */
export interface IntelligenceRuntimePort extends CommonRuntimePort {
  start(): Promise<void>;
}

export interface CoreRuntimePorts {
  readonly market: MarketRuntimePort;
  readonly intelligenceRuntime: IntelligenceRuntimePort;
  readonly marketIntelligence: IntelligenceRuntimePort;
  readonly q?: QAdvisoryRuntimePort;
  readonly basis: StrategyRuntimePort;
  readonly volume: StrategyRuntimePort;
}

export type AdapterStartState = 'IDLE' | 'PENDING' | 'RESOLVED' | 'REJECTED';
export type ManagedDrainOutcome = 'NOT_REQUESTED' | 'IN_PROGRESS' | 'CLEAN' | 'FAILED' | 'TIMED_OUT';
export type ManagedRestartCompletionReadback = 'PENDING' | 'APPLIED' | 'FAILED' | 'UNKNOWN';

export interface ManagedSubsystemRestartIdentity {
  readonly correlationId: string;
  readonly revision: number;
  readonly targetComponentId: SystemComponentId;
  readonly closureComponentIds: readonly SystemComponentId[];
}

export type ManagedSubsystemRestartResult = Readonly<
  | { readonly ok: true; readonly identity: Readonly<ManagedSubsystemRestartIdentity> }
  | { readonly ok: false; readonly code: string }
>;

export interface ManagedRestartCommandIdentity {
  readonly correlationId: string;
  readonly revision: number;
  readonly targetGeneration: number;
}

export interface ManagedAdapterSnapshot {
  readonly componentId: SystemComponentId;
  readonly startState: AdapterStartState;
  readonly ownsUnderlyingRuntime: boolean;
  readonly admittedGeneration: number | null;
  readonly restartCount: number;
  readonly abortCount: number;
  readonly lastFailureCode: string | null;
  readonly lastAbortFailed: boolean;
}

export interface ManagedCompositionReadSnapshot {
  readonly supervisor: Readonly<RuntimeStatusSnapshot>;
  readonly componentOrder: readonly SystemComponentId[];
  readonly adapters: readonly Readonly<ManagedAdapterSnapshot>[];
  readonly driverRunning: boolean;
  readonly acceptingCommands: boolean;
  readonly draining: boolean;
  readonly drainCompleted: boolean;
  readonly drainTimedOut: boolean;
  readonly drainOutcome: ManagedDrainOutcome;
  readonly cleanShutdown: boolean;
  readonly drainFailureCode: string | null;
  readonly remainingOwnedComponentIds: readonly SystemComponentId[];
  readonly lastDriveAtMs: number | null;
  readonly driverFailureCode: string | null;
}

export interface ManagedCompositionOptions {
  readonly clock: UtcClock;
  readonly scheduler: RepeatingScheduler;
  readonly ports: CoreRuntimePorts;
  readonly readEnvironment: () => ControlEnvironment;
  readonly tickIntervalMs?: number;
  readonly defaultGateTimeoutMs?: number;
  readonly defaultComponentTimeoutMs?: number;
  readonly drainTimeoutMs?: number;
}

export interface ManagedCompositionControl {
  start(): CommandResult;
  /** Boot the graph and converge to PAUSED before claiming that posture. */
  startPaused(): CommandResult;
  validate(): CommandResult;
  restart(): CommandResult;
  restartComponent(componentId: SystemComponentId): ManagedSubsystemRestartResult;
  issue(command: ControlCommandRequest['command']): CommandResult;
  driveOnce(): Readonly<ManagedCompositionReadSnapshot>;
  drain(): Promise<Readonly<ManagedCompositionReadSnapshot>>;
  read(): Readonly<ManagedCompositionReadSnapshot>;
  readRestartCompletion(
    identity: Readonly<ManagedRestartCommandIdentity>,
  ): ManagedRestartCompletionReadback;
  readSubsystemRestart(
    identity: Readonly<ManagedSubsystemRestartIdentity>,
  ): ManagedRestartCompletionReadback;
}
