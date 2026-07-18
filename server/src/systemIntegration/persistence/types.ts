import type {
  SystemControlMutation,
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
  maximumLiveEdgeControlEvents: 256,
  maximumControlRejections: 512,
  maximumTraceIndexEntries: 1_024,
  maximumTraceEventsPerCommit: 8,
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

export interface LedgerEventInputRecord {
  readonly kind: string;
  readonly symbol?: string | null;
  readonly data?: unknown;
}

export type LedgerConfigCompareAndSetResult =
  | {
      readonly committed: true;
      readonly events: readonly LedgerEventRecord[];
    }
  | {
      readonly committed: false;
      readonly reason: 'VERSION_CONFLICT' | 'DEADLINE_EXCEEDED';
      readonly currentValue: string | null;
    };

export const PRODUCT_IDENTITY_REFERENCE_TYPES = Object.freeze([
  'OPPORTUNITY',
  'CAPITAL_VERDICT',
  'RISK_VERDICT',
  'TICKET',
  'LEG',
  'ORDER',
  'AMBIGUOUS_MUTATION',
  'POSITION',
  'LIABILITY',
  'RECOVERY_CAMPAIGN',
  'MODEL_ASSESSMENT',
  'OUTCOME',
  'BOOT_OPERATION',
  'SHUTDOWN_OPERATION',
  'DEPLOYMENT_REVISION',
] as const);

export type ProductIdentityReferenceType = (typeof PRODUCT_IDENTITY_REFERENCE_TYPES)[number];

export const PRODUCT_IDENTITY_RESOLUTION_STATES = Object.freeze([
  'OPEN',
  'TERMINAL_PROVEN',
  'AMBIGUOUS',
  'RECOVERY_REQUIRED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const);

export type ProductIdentityResolutionState = (typeof PRODUCT_IDENTITY_RESOLUTION_STATES)[number];

export interface ProductPersistenceAuditRecord extends LedgerEventInputRecord {
  readonly data: SystemJsonValue;
}

export interface ProductDesiredStatePersistenceInput {
  readonly componentId: SystemComponentId;
  readonly expectedStateRevision: number | null;
  readonly desiredState: 'STOPPED' | 'RUNNING' | 'PAUSED';
  readonly stateRevision: number;
  readonly restartGeneration: number;
  readonly updatedAtMs: number;
  readonly correlationId: string;
  readonly audit: Readonly<ProductPersistenceAuditRecord>;
}

export interface ProductCommandPersistenceInput {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly commandType: string;
  readonly targetComponentId: string;
  readonly authenticatedOperatorId: string;
  readonly reason: string;
  readonly requiredAuthority: string;
  readonly requestPayload: SystemJsonValue;
  readonly previewDigest: string;
  readonly preview: SystemJsonValue;
  readonly expectedRevision: number;
  readonly resultingRevision: number | null;
  readonly status: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly completedAtMs: number | null;
  readonly correlationId: string;
  readonly beforeProjection: SystemJsonValue | null;
  readonly afterProjection: SystemJsonValue | null;
  readonly result: SystemJsonValue | null;
  readonly audit: Readonly<ProductPersistenceAuditRecord>;
}

export interface ProductConfigRevisionPersistenceInput {
  readonly configRevision: string;
  readonly contentDigest: string;
  readonly status: string;
  readonly effectiveAtMs: number | null;
  readonly createdAtMs: number;
  readonly createdByOperatorId: string;
  readonly correlationId: string;
  readonly config: SystemJsonValue;
  readonly audit: Readonly<ProductPersistenceAuditRecord>;
}

export interface ProductIdentityReferencePersistenceInput {
  readonly referenceType: ProductIdentityReferenceType;
  readonly referenceId: string;
  readonly ownerId: string;
  readonly ownerRevision: string;
  readonly expectedResolutionState: ProductIdentityResolutionState | null;
  readonly ownerState: string;
  readonly resolutionState: ProductIdentityResolutionState;
  readonly correlationId: string;
  readonly parentReferenceType: ProductIdentityReferenceType | null;
  readonly parentReferenceId: string | null;
  readonly payloadHash: string | null;
  readonly ownerProjection: SystemJsonValue;
  readonly occurredAtMs: number;
  readonly validUntilMs: number | null;
  readonly audit: Readonly<ProductPersistenceAuditRecord>;
}

export interface ProductIdentityReferenceRecord {
  readonly referenceType: ProductIdentityReferenceType;
  readonly referenceId: string;
  readonly ownerId: string;
  readonly ownerRevision: string;
  readonly ownerState: string;
  readonly resolutionState: ProductIdentityResolutionState;
  readonly correlationId: string;
  readonly parentReferenceType: ProductIdentityReferenceType | null;
  readonly parentReferenceId: string | null;
  readonly payloadHash: string | null;
  readonly ownerProjection: SystemJsonValue;
  readonly occurredAtMs: number;
  readonly validUntilMs: number | null;
  readonly ledgerEventId: number;
}

export interface ProductIncidentPersistenceInput {
  readonly incidentId: string;
  readonly fingerprint: string;
  readonly rootComponentId: string;
  readonly severity: string;
  readonly capitalRelevant: boolean;
  readonly expectedEventCount: number | null;
  readonly state: string;
  readonly firstSeenAtMs: number;
  readonly lastSeenAtMs: number;
  readonly eventCount: number;
  readonly acknowledgedAtMs: number | null;
  readonly acknowledgedByOperatorId: string | null;
  readonly resolvedAtMs: number | null;
  readonly correlationId: string;
  readonly audit: Readonly<ProductPersistenceAuditRecord>;
}

export interface ProductBootReleasePersistenceInput {
  readonly operationId: string;
  readonly operationType: string;
  readonly expectedLedgerEventId: number | null;
  readonly generation: number;
  readonly testedCommit: string | null;
  readonly deployedCommit: string | null;
  readonly configRevision: string | null;
  readonly schemaRevision: string;
  readonly modelRevision: string | null;
  readonly startedAtMs: number;
  readonly completedAtMs: number | null;
  readonly clean: boolean | null;
  readonly blockerCode: string | null;
  readonly correlationId: string;
  readonly audit: Readonly<ProductPersistenceAuditRecord>;
}

/**
 * Bounded, validated readback of the existing Ledger boot/release table.
 * This is evidence only: a non-null deployed commit never authorizes or
 * performs a release switch.
 */
export interface ProductBootReleaseRecord {
  readonly operationId: string;
  readonly operationType: string;
  readonly generation: number;
  readonly testedCommit: string | null;
  readonly deployedCommit: string | null;
  readonly configRevision: string | null;
  readonly schemaRevision: string;
  readonly modelRevision: string | null;
  readonly startedAtMs: number;
  readonly completedAtMs: number | null;
  readonly clean: boolean | null;
  readonly blockerCode: string | null;
  readonly correlationId: string;
  readonly ledgerEventId: number;
}

export type ProductPersistenceMutationResult =
  | {
      readonly disposition: 'COMMITTED_NEW' | 'IDEMPOTENT_REPLAY';
      readonly ledgerEvent: Readonly<LedgerEventRecord>;
      readonly currentRevision: string | null;
    }
  | {
      readonly disposition: 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT';
      readonly ledgerEvent: null;
      readonly currentRevision: string | null;
    };

export type LedgerSchemaCompatibilityState =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'MALFORMED'
  | 'MISMATCH';

/**
 * Durable schema-compatibility truth owned by the canonical Ledger. Numeric
 * values are publishable only when the metadata row and SQLite user_version
 * agree; every other state is deliberately null-valued.
 */
export interface LedgerSchemaCompatibilityReadback {
  readonly state: LedgerSchemaCompatibilityState;
  readonly currentSchemaVersion: number | null;
  readonly rollbackFloor: number | null;
  readonly reasonCode: string | null;
}

/** Structural port implemented by the existing Ledger. No second store exists. */
export interface LedgerPersistencePort {
  getConfigValue(key: string): string | null;
  /** Canonical Ledger capability; optional so legacy read/checkpoint doubles remain structural ports. */
  compareAndSetConfigValueAndLogEvents?(
    key: string,
    expectedValue: string | null,
    nextValue: string,
    records: readonly LedgerEventInputRecord[],
    commitBeforeMs?: number,
  ): LedgerConfigCompareAndSetResult;
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
  compareAndSetProductComponentDesiredState?(
    input: Readonly<ProductDesiredStatePersistenceInput>,
  ): ProductPersistenceMutationResult;
  compareAndAppendProductCommand?(
    input: Readonly<ProductCommandPersistenceInput>,
  ): ProductPersistenceMutationResult;
  recordProductConfigRevision?(
    input: Readonly<ProductConfigRevisionPersistenceInput>,
  ): ProductPersistenceMutationResult;
  compareAndUpsertProductIdentityReference?(
    input: Readonly<ProductIdentityReferencePersistenceInput>,
  ): ProductPersistenceMutationResult;
  readProductBlockingIdentityReferences?(
    limit?: number,
  ): readonly Readonly<ProductIdentityReferenceRecord>[];
  compareAndTransitionProductIncident?(
    input: Readonly<ProductIncidentPersistenceInput>,
  ): ProductPersistenceMutationResult;
  compareAndSetProductBootReleaseRevision?(
    input: Readonly<ProductBootReleasePersistenceInput>,
  ): ProductPersistenceMutationResult;
  readProductBootReleaseRevisions?(
    limit?: number,
  ): readonly Readonly<ProductBootReleaseRecord>[];
  readSchemaCompatibility?(): Readonly<LedgerSchemaCompatibilityReadback>;
  probeWritable?(force?: boolean): boolean;
}

export interface PersistedDesiredComponentState {
  readonly componentId: SystemComponentId;
  readonly desiredState: 'STOPPED' | 'RUNNING' | 'PAUSED';
  readonly generation: number;
  readonly updatedAtMs: number;
}

/**
 * Durable desired posture for the two strategy-owned proposal intake gates.
 * This is deliberately separate from component lifecycle: a paused intake
 * must not stop observation, supervision, reconciliation, or risk reduction.
 */
export interface PersistedStrategyIntakePosture {
  readonly basisPaused: boolean;
  readonly volumePaused: boolean;
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

/**
 * Canonical ordinary-stop truth projected by the supervisor/ops owner. `NONE`
 * is deliberately stronger than an empty identity query: that owner may emit
 * it only when reconciliation is current and canonical zero exposure is
 * proven. System Integration consumes this projection without recomputing it.
 */
export interface CanonicalOrdinaryDrainTruth {
  readonly source: 'CANONICAL_SUPERVISOR_READBACK';
  readonly observedAtUtc: string;
  readonly validUntilUtc: string;
  readonly exposureState: 'NONE' | 'ACTIVE' | 'AMBIGUOUS' | 'RECOVERY_REQUIRED' | 'UNKNOWN';
  readonly ambiguityState: 'NONE' | 'AMBIGUOUS' | 'UNKNOWN';
  readonly recoveryState: 'NONE' | 'RECOVERY_REQUIRED' | 'UNKNOWN';
}

/**
 * Mechanical process-local capability posture, never an account/exchange
 * balance claim. `PROVEN_ABSENT` requires proof that no signed/test/private
 * mutation port is mounted and no unresolved local mutation history is hidden
 * outside the canonical blocking-reference read.
 */
export type LocalMutationAuthorityPosture =
  | 'PROVEN_ABSENT'
  | 'PRESENT'
  | 'AMBIGUOUS'
  | 'UNKNOWN';

/**
 * Narrow lifecycle-truth seam. It owns no storage and may only supply owner
 * projections for persistence and ordinary-stop admission.
 */
export interface SystemLifecycleTruthReadPort {
  readRestartTruth?(nowMs: number): Readonly<PersistedRestartTruth>;
  readLocalMutationAuthority?(): LocalMutationAuthorityPosture;
  readOrdinaryDrainTruth?(): (
    Readonly<CanonicalOrdinaryDrainTruth>
    | Promise<Readonly<CanonicalOrdinaryDrainTruth>>
  );
  /**
   * Owner-supplied readback for a durable runtime effect identity after an
   * application-process restart. Missing, throwing, or malformed evidence is
   * always consumed as UNKNOWN and therefore can never authorize reissue.
   */
  readControlRuntimeEffect?(
    effectId: string,
    mutation: Readonly<SystemControlMutation>,
  ): (
    'APPLIED'
    | 'NOT_APPLIED'
    | 'UNKNOWN'
    | Promise<'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN'>
  );
}

/**
 * Explicit effectful restart-truth owner. It is deliberately separate from
 * passive lifecycle read ports; only the lifecycle driver invokes it.
 */
export interface SystemRestartTruthRefreshEffectPort {
  refreshRestartTruth(
    nowMs: number,
  ): Readonly<PersistedRestartTruth> | Promise<Readonly<PersistedRestartTruth>>;
}

export interface PersistedIdempotencyReceipt {
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly correlationId: string;
  readonly recordedAtMs: number;
  readonly checkpointRevision: number;
  readonly receipt: SystemJsonValue;
}

export interface PersistedControlRuntimePublicationReference {
  readonly effectId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly correlationId: string;
  readonly generation: number;
  readonly state: 'PENDING' | 'UNKNOWN';
}

/**
 * Explicit L14 control-journal storage inside the one canonical System
 * Integration checkpoint. This is not a second command store: it is the
 * typed persisted projection consumed by the accepted L14 persistence port.
 */
export interface PersistedLiveEdgeControlEvent {
  readonly storageKey: string;
  readonly storageKind: 'JOURNAL' | 'PRE_INTENT_AUDIT';
  readonly commandId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly appendRequestDigest: string;
  readonly journalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly headDigest: string;
  readonly event: SystemJsonValue;
  readonly occurredAtMs: number;
  readonly checkpointRevision: number;
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
  readonly actorSource: 'loopback' | 'cloudflare-access' | 'canonical-alarm';
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
  readonly strategyIntake: Readonly<PersistedStrategyIntakePosture>;
  readonly desiredComponents: readonly Readonly<PersistedDesiredComponentState>[];
  readonly authorityReferences: readonly Readonly<PersistedAuthorityReference>[];
  readonly reservations: readonly Readonly<PersistedReservationReference>[];
  readonly approvals: readonly Readonly<PersistedApprovalReference>[];
  readonly dryRunExecutions: readonly Readonly<PersistedDryRunExecutionReference>[];
  readonly reconciliations: readonly Readonly<PersistedReconciliationReference>[];
  readonly idempotencyReceipts: readonly Readonly<PersistedIdempotencyReceipt>[];
  readonly liveEdgeControlEvents: readonly Readonly<PersistedLiveEdgeControlEvent>[];
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
  readonly traceEvents?: readonly Readonly<SystemTraceEvent>[];
}

export interface PersistedCommitReceipt {
  readonly checkpointRevision: number;
  readonly ledgerEventId: number;
  readonly checksum: string;
}

interface IdempotentTransitionBase<T extends SystemJsonValue> {
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly transition: (
    current: Readonly<SystemIntegrationCheckpointState>,
  ) => {
    readonly nextState: Readonly<SystemIntegrationCheckpointState>;
    readonly receipt: T;
  };
}

export type IdempotentTransitionInput<T extends SystemJsonValue> =
  Readonly<IdempotentTransitionBase<T> & (
    | {
        readonly traceEvent: Readonly<SystemTraceEvent>;
        readonly traceEvents?: never;
      }
    | {
        readonly traceEvent?: never;
        readonly traceEvents: readonly [Readonly<SystemTraceEvent>, ...Readonly<SystemTraceEvent>[]];
      }
  )>;

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
