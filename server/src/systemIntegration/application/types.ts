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
  SystemFocusPinReadback,
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
  ProductIdentityReferenceRecord,
  RestartBarrierProjection,
} from '../persistence/types.js';
import type { DeploymentFreezeClearOwnerPort } from '../ops/types.js';
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
  /** Closed source policy supplied explicitly by the production composition. */
  readonly readinessPolicy?: unknown;
  readonly components?: ApplicationComponentReadPorts;
  readonly summaries?: ApplicationSummaryReadPort;
  readonly traces?: ApplicationTraceReadPort;
  readonly deploymentFreezeClear?: DeploymentFreezeClearOwnerPort;
  /** Narrow command/readback seam; strategy engines remain the sole owners. */
  readonly strategyIntake?: Readonly<{
    basis?: Readonly<{
      readPaused(): boolean;
      setPaused(paused: boolean): boolean;
    }>;
    volume?: Readonly<{
      readPaused(): boolean;
      setPaused(paused: boolean): boolean;
    }>;
  }>;
  /** Narrow durable deny-overlay seam; strategy engines remain the effective policy owners. */
  readonly strategySymbolPolicy?: Readonly<{
    basis?: StrategySymbolPolicyOwnerPort;
    volume?: StrategySymbolPolicyOwnerPort;
  }>;
  /** Existing Capital/config owners expose only downward size-ceiling application. */
  readonly sizeCeilings?: Readonly<Partial<Record<'SYSTEM' | 'BASIS' | 'VOLUME', SizeCeilingOwnerPort>>>;
  /** Closed, approved threshold catalog; strategy runtimes remain the config owners. */
  readonly strategyThresholds?: Readonly<Partial<Record<'BASIS' | 'VOLUME', StrategyThresholdOwnerPort>>>;
  /** Intelligence Runtime owns desired focus pins and effective attention readback. */
  readonly attentionFocus?: AttentionFocusOwnerPort;
  readonly tickIntervalMs?: number;
  readonly defaultGateTimeoutMs?: number;
  readonly defaultComponentTimeoutMs?: number;
  readonly drainTimeoutMs?: number;
  /** Must remain below the durable restart-truth freshness lease. */
  readonly restartTruthRefreshIntervalMs?: number;
}

export interface StrategyIntakeControlReadback {
  readonly strategy: 'basis' | 'volume';
  readonly desiredPaused: boolean;
  readonly effectivePaused: boolean | null;
  readonly controlRevision: number;
  readonly state: 'APPLIED' | 'EFFECT_UNAVAILABLE' | 'OWNER_NOT_WIRED';
}

export interface StrategySymbolPolicyOwnerPort {
  readBlockedSymbols(): readonly string[];
  setBlocked(symbol: string, blocked: boolean): boolean;
  isAllowed(symbol: string): boolean;
}

export interface StrategySymbolPolicyControlReadback {
  readonly strategy: 'basis' | 'volume';
  readonly symbol: string;
  readonly desiredBlocked: boolean;
  readonly effectiveBlocked: boolean | null;
  readonly effectiveAllowed: boolean | null;
  readonly controlRevision: number;
  readonly state: 'APPLIED' | 'EFFECT_UNAVAILABLE' | 'OWNER_NOT_WIRED';
}

export interface SizeCeilingOwnerPort {
  readCeiling(): string | null;
  setCeiling(value: string): boolean;
}

export interface SizeCeilingControlReadback {
  readonly scope: 'SYSTEM' | 'BASIS' | 'VOLUME';
  readonly desiredMaximumNotionalUsd: string | null;
  readonly effectiveMaximumNotionalUsd: string | null;
  readonly controlRevision: number;
  readonly state: 'APPLIED' | 'UNAVAILABLE' | 'OWNER_NOT_WIRED';
}

export interface StrategyThresholdOwnerPort {
  readThreshold(): string | null;
  setThreshold(value: string): boolean;
}

export interface StrategyThresholdControlReadback {
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly threshold: 'MIN_NET_BASIS_PCT' | 'VOLUME_1S_MULTIPLE';
  readonly desiredValue: string | null;
  readonly effectiveValue: string | null;
  readonly controlRevision: number;
  readonly state: 'APPLIED' | 'UNAVAILABLE' | 'OWNER_NOT_WIRED';
}

export interface AttentionFocusOwnerReadback {
  readonly symbol: string;
  readonly pinned: boolean;
  readonly eligible: boolean | null;
  readonly canPin: boolean;
  readonly effectivePinned: boolean | null;
  readonly effectiveTier: SystemFocusPinReadback['effectiveTier'];
  readonly attentionPlanId: string | null;
  readonly attentionPlanAtMs: number | null;
  readonly pinCount: number;
  readonly pinCapacity: number;
}

export interface AttentionFocusOwnerPort {
  readPinnedSymbols(): readonly string[];
  readFocusState(symbol: string): Readonly<AttentionFocusOwnerReadback>;
  setPinned(symbol: string, pinned: boolean): boolean;
  restorePinnedSymbols(symbols: readonly string[]): boolean;
}

export type SystemApplicationPhase =
  | 'CREATED'
  | 'STARTING'
  | 'RUNNING'
  | 'FAILED'
  | 'DRAINING'
  | 'MAINTENANCE'
  | 'DRAINED';

export type SystemApplicationDrainDisposition =
  | 'DRAINED'
  | 'REFUSED_RECOVERY_SUPERVISION_REQUIRED'
  | 'DRAIN_FAILED';

export type SystemApplicationDrainBlockingReference = Readonly<Pick<
  ProductIdentityReferenceRecord,
  'referenceType' | 'referenceId' | 'ownerId' | 'ownerRevision' | 'resolutionState' | 'correlationId'
>>;

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
  readonly disposition: SystemApplicationDrainDisposition;
  readonly phase: SystemApplicationPhase;
  readonly correlationId: string;
  readonly blockerCodes: readonly string[];
  readonly blockingIdentityReferences: readonly SystemApplicationDrainBlockingReference[];
  readonly composition: Readonly<ManagedCompositionReadSnapshot>;
  readonly finalCheckpoint: Readonly<PersistedCommitReceipt> | null;
  readonly persistenceFailureCode: PersistenceFailureCode | null;
  /** True only after a clean physical drain and durable final checkpoint. */
  readonly ledgerCloseMayProceed: boolean;
}

export interface SystemIntegrationApplicationFacade {
  start(): Readonly<SystemApplicationStartResult>;
  readonly read: SystemIntegrationReadPort;
  readonly controls: SystemControlService;
  executeValidateOnly(
    input: Readonly<ValidateOnlyOrchestratorInput>,
  ): Promise<Readonly<ValidateOnlyRunResult>>;
  restartManagedRuntime(): Readonly<ManagedRuntimeRestartResult>;
  refreshRestartTruth(): Promise<Readonly<RestartBarrierProjection>>;
  managedRuntime(): Readonly<ManagedCompositionReadSnapshot>;
  supervisor(): Readonly<SystemSupervisorReadModel>;
  controlState(): Readonly<SystemControlState>;
  strategyIntakeState(strategy: 'basis' | 'volume'): Readonly<StrategyIntakeControlReadback>;
  strategySymbolPolicyState(
    strategy: 'basis' | 'volume',
    symbol: string,
  ): Readonly<StrategySymbolPolicyControlReadback>;
  sizeCeilingState(scope: 'SYSTEM' | 'BASIS' | 'VOLUME'): Readonly<SizeCeilingControlReadback>;
  strategyThresholdState(strategy: 'BASIS' | 'VOLUME'): Readonly<StrategyThresholdControlReadback>;
  focusPinState(symbol: string): Readonly<SystemFocusPinReadback>;
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
