import type {
  CommandResult,
  ControlEnvironment,
} from '../../foundation/control/index.js';
import type {
  RuntimeStatusSnapshot,
} from '../../foundation/contracts/index.js';
import type {
  SystemComponentId,
} from '../contracts/constants.js';
import type {
  SystemComponentSnapshot,
  SystemControlState,
  SystemTraceEvent,
} from '../contracts/types.js';
import type {
  CoreRuntimePorts,
  ManagedCompositionReadSnapshot,
  RepeatingScheduler,
  UtcClock,
} from '../composition/types.js';
import type {
  LedgerPersistencePort,
  PersistedCommitReceipt,
  PersistenceFailureCode,
  PersistenceLoadResult,
  RestartBarrierProjection,
} from '../persistence/types.js';
import type {
  SystemSupervisorReadModel,
  SystemSupervisorSummaries,
} from '../supervisor/types.js';
import type {
  ValidateOnlyOrchestratorInput,
  ValidateOnlyRunResult,
} from '../verticalSlice/types.js';
import type {
  SystemIntegrationReadPort,
} from '../routes/types.js';
import type { SystemControlService } from '../controls/service.js';

/** Passive owner projection. The application deliberately receives no refresh method. */
export interface ApplicationComponentReadPort {
  readComponentSnapshot(): Readonly<SystemComponentSnapshot> | null;
}

export type ApplicationComponentReadPorts = Readonly<Partial<
  Record<SystemComponentId, ApplicationComponentReadPort>
>>;

export type ApplicationOwnerSummaries = Readonly<Partial<Pick<
  SystemSupervisorSummaries,
  'sourceCoverage' | 'strategies' | 'intelligence' | 'capital'
>>>;

/** Passive owner summary facts. Application-owned sections are never accepted here. */
export interface ApplicationSummaryReadPort {
  readSupervisorSummaries(): ApplicationOwnerSummaries | null;
}

/** Optional bounded owner events that are already in the canonical trace dialect. */
export interface ApplicationTraceReadPort {
  readTraceEvents(): readonly Readonly<SystemTraceEvent>[];
}

export interface SystemIntegrationApplicationOptions {
  readonly ledger: LedgerPersistencePort;
  readonly clock: UtcClock;
  readonly scheduler: RepeatingScheduler;
  readonly runtimes: CoreRuntimePorts;
  readonly readEnvironment: () => ControlEnvironment;
  readonly components?: ApplicationComponentReadPorts;
  readonly summaries?: ApplicationSummaryReadPort;
  readonly traces?: ApplicationTraceReadPort;
  readonly tickIntervalMs?: number;
  readonly defaultGateTimeoutMs?: number;
  readonly defaultComponentTimeoutMs?: number;
  readonly drainTimeoutMs?: number;
}

export type SystemApplicationPhase =
  | 'CREATED'
  | 'STARTING'
  | 'RUNNING'
  | 'FAILED'
  | 'DRAINING'
  | 'DRAINED';

export interface SystemApplicationStartResult {
  readonly ok: boolean;
  readonly phase: SystemApplicationPhase;
  readonly correlationId: string;
  readonly persistenceLoad: PersistenceLoadResult;
  readonly startupReceipt: Readonly<PersistedCommitReceipt> | null;
  readonly persistenceFailureCode: PersistenceFailureCode | null;
  readonly restartBarrier: Readonly<RestartBarrierProjection>;
  readonly compositionCommand: Readonly<CommandResult> | null;
  readonly composition: Readonly<ManagedCompositionReadSnapshot>;
}

export interface ManagedRuntimeRestartResult {
  readonly ok: boolean;
  readonly code: string;
  readonly command: Readonly<CommandResult>;
  readonly composition: Readonly<ManagedCompositionReadSnapshot>;
}

export interface SystemApplicationDrainResult {
  readonly ok: boolean;
  readonly clean: boolean;
  readonly correlationId: string;
  readonly composition: Readonly<ManagedCompositionReadSnapshot>;
  readonly finalCheckpoint: Readonly<PersistedCommitReceipt> | null;
  readonly persistenceFailureCode: PersistenceFailureCode | null;
  /** True only after the final checkpoint attempt has completed. */
  readonly ledgerCloseMayProceed: true;
}

export interface SystemIntegrationApplicationFacade {
  start(): Readonly<SystemApplicationStartResult>;
  readonly read: SystemIntegrationReadPort;
  readonly controls: SystemControlService;
  executeValidateOnly(
    input: Readonly<ValidateOnlyOrchestratorInput>,
  ): Promise<Readonly<ValidateOnlyRunResult>>;
  restartManagedRuntime(): Readonly<ManagedRuntimeRestartResult>;
  managedRuntime(): Readonly<ManagedCompositionReadSnapshot>;
  supervisor(): Readonly<SystemSupervisorReadModel>;
  controlState(): Readonly<SystemControlState>;
  restartBarrier(): Readonly<RestartBarrierProjection>;
  drain(): Promise<Readonly<SystemApplicationDrainResult>>;
}

export interface ApplicationSnapshotInputs {
  readonly nowMs: number;
  readonly runtime: Readonly<RuntimeStatusSnapshot>;
  readonly control: Readonly<SystemControlState>;
  readonly components: readonly Readonly<SystemComponentSnapshot>[];
  readonly summaries: Readonly<SystemSupervisorSummaries>;
  readonly traces: readonly Readonly<SystemTraceEvent>[];
}
