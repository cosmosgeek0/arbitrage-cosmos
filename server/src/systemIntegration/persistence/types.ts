import type {
  SystemControlState,
  SystemTraceEvent,
} from '../contracts/types.js';
import type { SystemComponentId } from '../contracts/constants.js';

export const SYSTEM_PERSISTENCE_SCHEMA = 'cosmos.system-integration.checkpoint' as const;
export const SYSTEM_PERSISTENCE_VERSION = 1 as const;
export const SYSTEM_PERSISTENCE_CONFIG_KEY = 'system.integration.checkpoint.v1' as const;
export const SYSTEM_PERSISTENCE_EVENT_KIND = 'system.integration.trace' as const;

export const SYSTEM_PERSISTENCE_LIMITS = Object.freeze({
  maximumCheckpointBytes: 512 * 1024,
  maximumAuditEventBytes: 128 * 1024,
  maximumJsonDepth: 24,
  maximumJsonNodes: 50_000,
  maximumArrayLength: 2_000,
  maximumObjectKeys: 256,
  maximumStringBytes: 64 * 1024,
  maximumDesiredComponents: 64,
  maximumAuthorityReferences: 1_000,
  maximumReservations: 512,
  maximumApprovals: 512,
  maximumExecutions: 256,
  maximumReconciliations: 256,
  maximumIdempotencyReceipts: 512,
  maximumControlRejections: 512,
  maximumTraceIndexEntries: 1_024,
  maximumReasonCodes: 32,
  maximumTraceQueryLimit: 200,
  maximumLedgerScan: 2_000,
  restartTruthMaximumAgeMs: 60_000,
} as const);

export type SystemJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly SystemJsonValue[]
  | { readonly [key: string]: SystemJsonValue };

export interface LedgerEventRecord {
  readonly id: number;
  readonly ts: number;
  readonly kind: string;
  readonly symbol: string | null;
  readonly data: unknown;
}

/** Structural port implemented by the existing Ledger. No second store exists. */
export interface LedgerPersistencePort {
  getConfigValue(key: string): string | null;
  setConfigValueAndLogEvent(
    key: string,
    value: string,
    kind: string,
    symbol?: string | null,
    data?: unknown,
  ): LedgerEventRecord;
  recentEvents(
    limit?: number,
    kind?: string,
    symbol?: string,
    q?: string,
    since?: number,
    beforeId?: number,
    until?: number,
    offset?: number,
    afterId?: number,
  ): LedgerEventRecord[];
  probeWritable?(force?: boolean): boolean;
}

export interface PersistedDesiredComponentState {
  readonly componentId: SystemComponentId;
  readonly desiredState: 'STOPPED' | 'RUNNING' | 'PAUSED';
  readonly generation: number;
  readonly updatedAtMs: number;
}

/**
 * Opaque owner reference. Persistence preserves identity and revision but does
 * not infer proposal, mandate, configuration, or position policy semantics.
 */
export interface PersistedAuthorityReference {
  readonly kind: 'PROPOSAL' | 'MANDATE' | 'CONFIGURATION' | 'ACTIVE_POSITION_POLICY';
  readonly ownerId: string;
  readonly ownerRevision: string;
  readonly correlationId: string;
  readonly updatedAtMs: number;
}

/**
 * Capital remains the lifecycle authority. `blocksAllocation` is a supplied
 * replay-safety projection, retained so a restart cannot reserve twice.
 */
export interface PersistedReservationReference {
  readonly reservationId: string;
  readonly allocationKey: string;
  readonly ownerRevision: string;
  readonly domainState: string;
  readonly blocksAllocation: boolean;
  readonly correlationId: string;
  readonly updatedAtMs: number;
}

export interface PersistedApprovalReference {
  readonly approvalId: string;
  readonly bindingDigest: string;
  readonly ownerRevision: string;
  readonly domainState: string;
  readonly usable: boolean;
  readonly expiresAtMs: number | null;
  readonly correlationId: string;
  readonly updatedAtMs: number;
}

/** Foundation owns the lifecycle and serialized checkpoint content. */
export interface PersistedDryRunExecutionReference {
  readonly planId: string;
  readonly checkpointDigest: string;
  readonly serializedCheckpoint: string;
  readonly domainLifecycle: string;
  readonly dryRun: true;
  readonly requiresReconciliation: boolean;
  readonly correlationId: string;
  readonly updatedAtMs: number;
}

/** Foundation reconciliation supplies status and admission projection. */
export interface PersistedReconciliationReference {
  readonly planId: string;
  readonly ownerRevision: string;
  readonly domainStatus: string;
  readonly allowsNewExposure: boolean;
  readonly reasonCodes: readonly string[];
  readonly correlationId: string;
  readonly observedAtMs: number;
}

export type PersistedTruthState = 'FRESH' | 'STALE' | 'UNKNOWN' | 'UNAVAILABLE';

export interface PersistedRestartTruth {
  readonly publicSourceTruth: PersistedTruthState;
  readonly accountTruth: PersistedTruthState;
  readonly reconciliationTruth: PersistedTruthState;
  readonly observedAtMs: number | null;
}

export interface PersistedIdempotencyReceipt {
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly correlationId: string;
  readonly recordedAtMs: number;
  readonly checkpointRevision: number;
  readonly receipt: SystemJsonValue;
}

/**
 * A deliberately redacted rejection record. Unknown commands, free-form
 * bodies, email addresses, and caller-provided messages never enter durable
 * storage through this projection.
 */
export interface PersistedControlRejectionReceipt {
  readonly dedupeKey: string;
  readonly idempotencyKey: string | null;
  readonly requestDigest: string;
  readonly command: string | null;
  readonly expectedRevision: number | null;
  readonly currentRevision: number;
  readonly code: string;
  readonly message: 'Control request rejected.';
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly actorIdDigest: string;
  readonly actorSource: 'loopback' | 'cloudflare-access';
  readonly checkpointRevision: number;
}

export interface PersistedTraceIndexEntry {
  readonly eventId: string;
  readonly correlationId: string;
  readonly eventDigest: string;
  readonly occurredAtMs: number;
}

export interface PersistedStartupRecord {
  readonly generation: number;
  readonly startedAtMs: number;
  readonly correlationId: string;
  readonly restoredFromRevision: number;
}

export interface PersistedShutdownRecord {
  readonly generation: number;
  readonly stoppedAtMs: number;
  readonly correlationId: string;
  readonly clean: boolean;
  readonly finalComponentStateDigest: string;
}

export interface SystemIntegrationCheckpointState {
  readonly revision: number;
  readonly generation: number;
  readonly control: Readonly<SystemControlState>;
  readonly desiredComponents: readonly Readonly<PersistedDesiredComponentState>[];
  readonly authorityReferences: readonly Readonly<PersistedAuthorityReference>[];
  readonly reservations: readonly Readonly<PersistedReservationReference>[];
  readonly approvals: readonly Readonly<PersistedApprovalReference>[];
  readonly dryRunExecutions: readonly Readonly<PersistedDryRunExecutionReference>[];
  readonly reconciliations: readonly Readonly<PersistedReconciliationReference>[];
  readonly idempotencyReceipts: readonly Readonly<PersistedIdempotencyReceipt>[];
  readonly controlRejections: readonly Readonly<PersistedControlRejectionReceipt>[];
  readonly traceIndex: readonly Readonly<PersistedTraceIndexEntry>[];
  readonly restartTruth: Readonly<PersistedRestartTruth>;
  readonly lastStartup: Readonly<PersistedStartupRecord> | null;
  readonly lastShutdown: Readonly<PersistedShutdownRecord> | null;
}

export interface SystemPersistenceCheckpoint {
  readonly schema: typeof SYSTEM_PERSISTENCE_SCHEMA;
  readonly version: typeof SYSTEM_PERSISTENCE_VERSION;
  readonly state: Readonly<SystemIntegrationCheckpointState>;
  readonly checksum: string;
}

export interface RestartBarrierProjection {
  readonly evaluatedAtMs: number;
  readonly canOpenOrIncrease: boolean;
  readonly supervisionContinues: true;
  readonly reasonCodes: readonly string[];
  readonly activeReservationIds: readonly string[];
  readonly usableApprovalIds: readonly string[];
  readonly reconciliationRequiredPlanIds: readonly string[];
}

export type PersistenceFailureCode =
  | 'PERSISTENCE_NOT_LOADED'
  | 'PERSISTENCE_CORRUPT'
  | 'PERSISTENCE_WRITE_FAILED'
  | 'PERSISTENCE_READ_FAILED'
  | 'PERSISTENCE_SEALED'
  | 'CHECKPOINT_INVALID'
  | 'CHECKPOINT_REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'TRACE_EVENT_CONFLICT'
  | 'INVALID_PERSISTENCE_REQUEST';

export type PersistenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: PersistenceFailureCode; readonly message: string };

export type PersistenceLoadResult =
  | {
      readonly ok: true;
      readonly source: 'EMPTY' | 'CHECKPOINT';
      readonly state: Readonly<SystemIntegrationCheckpointState>;
      readonly barrier: Readonly<RestartBarrierProjection>;
    }
  | {
      readonly ok: false;
      readonly code: 'PERSISTENCE_CORRUPT' | 'PERSISTENCE_READ_FAILED';
      readonly message: string;
      readonly barrier: Readonly<RestartBarrierProjection>;
    };

export interface PersistenceAuditInput {
  readonly auditKind: 'STARTUP' | 'TRANSITION' | 'TRACE' | 'RESTART_TRUTH' | 'SHUTDOWN' | 'CHECKPOINT';
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly traceEvent?: Readonly<SystemTraceEvent>;
}

export interface PersistedCommitReceipt {
  readonly checkpointRevision: number;
  readonly ledgerEventId: number;
  readonly checksum: string;
}

export interface IdempotentTransitionInput<T extends SystemJsonValue> {
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly traceEvent: Readonly<SystemTraceEvent>;
  readonly transition: (
    current: Readonly<SystemIntegrationCheckpointState>,
  ) => {
    readonly nextState: Readonly<SystemIntegrationCheckpointState>;
    readonly receipt: T;
  };
}

export interface IdempotentTransitionReceipt<T extends SystemJsonValue> {
  readonly replayed: boolean;
  readonly receipt: T;
  readonly checkpointRevision: number;
  readonly ledgerEventId: number | null;
}

export interface TraceQuery {
  readonly correlationId: string;
  readonly limit?: number;
  readonly sinceMs?: number;
  readonly untilMs?: number;
}

export interface TraceAppendReceipt {
  readonly appended: boolean;
  readonly checkpointRevision: number;
  readonly ledgerEventId: number | null;
}

export interface PersistedTraceEventRecord {
  readonly ledgerEventId: number;
  readonly persistedAtMs: number;
  readonly event: Readonly<SystemTraceEvent>;
}

export interface PersistedTraceQueryResult {
  readonly correlationId: string;
  readonly events: readonly Readonly<PersistedTraceEventRecord>[];
  readonly truncated: boolean;
}
