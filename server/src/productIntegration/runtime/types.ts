import type { SystemTraceEvent, SystemTraceSnapshot } from '../../systemIntegration/contracts/types.js';
import type { SystemSupervisorReadModel } from '../../systemIntegration/supervisor/types.js';
import type {
  CanonicalOpsIntakeInterlock,
  CanonicalSupervisorOpsReadback,
} from '../../systemIntegration/ops/index.js';
import type { BootReleaseReadback } from '../../systemIntegration/persistence/index.js';

export const PRODUCT_RUNTIME_SUPERVISOR_SCHEMA = 'product-supervisor.v1' as const;
export const PRODUCT_RUNTIME_COMMAND_SCHEMA = 'product-command.v1' as const;
export const PRODUCT_RUNTIME_CURSOR_SCHEMA = 'material-cursor.v1' as const;
export const PRODUCT_RUNTIME_MANAGED_INVENTORY_SCHEMA = 'i00-managed-inventory.v1' as const;
export const PRODUCT_RUNTIME_MAX_QUERY_LIMIT = 500;

/**
 * Exact I00 section 8 expected inventory. These are product roles, not an
 * alternative System Integration component graph.
 */
export const I00_MANAGED_COMPONENT_IDENTITIES = Object.freeze([
  'operator-auth',
  'configuration-authority',
  'ledger-persistence',
  'database',
  'clock-sync',
  'spot-public-source',
  'usdm-public-source',
  'spot-private-truth',
  'usdm-private-truth',
  'margin-private-truth',
  'instrument-filter-registry',
  'universe',
  'evidence-attention-runtime',
  'q-inference',
  'basis-engine',
  'volume-engine',
  'opportunity-authority',
  'capital-supervision',
  'risk-gate',
  'execution-hand',
  'normal-basis-coordinator',
  'reverse-basis-coordinator',
  'volume-position-lifecycle',
  'reconciliation',
  'exposure-position-recovery',
  'outcome-feedback',
  'machine-supervisor',
  'api-read-model',
  'notification-incident-router',
  'web-cockpit',
  'backup-restore',
  'external-watchdog',
  'cloudflare-tunnel-access',
] as const);
export type I00ManagedComponentIdentity = (typeof I00_MANAGED_COMPONENT_IDENTITIES)[number];

export type ProductRuntimeTruthLabel =
  | 'LIVE_PUBLIC' | 'WIRED' | 'BUILT_AND_TESTED' | 'IMPORTED'
  | 'SYNTHETIC_ONLY' | 'BLOCKED' | 'NOT_CONFIGURED' | 'UNAVAILABLE'
  | 'MISSING' | 'UNKNOWN';

export type ProductRuntimeLifecycle =
  | 'STOPPED' | 'START_REQUESTED' | 'STARTING' | 'WARMING' | 'READY'
  | 'DEGRADED' | 'PAUSED' | 'DRAINING' | 'RECONCILING'
  | 'RECOVERY_REQUIRED' | 'BLOCKED' | 'FAILED' | 'STOPPING';

export type ProductRuntimeCapability =
  | 'LIVE_PUBLIC' | 'LIVE_PRIVATE_READ' | 'LIVE_SIGNED_VALIDATE'
  | 'LIVE_MANUAL_CAPPED' | 'SHADOW' | 'DRY_RUN' | 'REPLAY'
  | 'SYNTHETIC' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'UNKNOWN';

export type ProductRuntimePresentationTone = 'ok' | 'warn' | 'bad' | 'idle';
export type ProductRuntimeWatchmanStatus = 'operational' | 'degraded' | 'outage' | 'planned';

/**
 * Server-owned display posture for one canonical component. The browser may
 * render this value or fail closed on transport continuity; it may not derive
 * a replacement verdict from lifecycle/capability/truth fields.
 */
export interface ProductRuntimeComponentPresentation {
  readonly status: ProductRuntimeWatchmanStatus;
  readonly tone: ProductRuntimePresentationTone;
  readonly statusLabel: string;
  readonly stateLabel: string;
}

export interface ProductRuntimeMaterialSourceRecord {
  readonly cursor: string;
  readonly event: Readonly<SystemTraceEvent>;
}

/**
 * Cursor-bearing read owned by the System Integration persistence boundary.
 * `truncated` means retention loss, never ordinary forward pagination.
 */
export interface ProductRuntimeMaterialSourcePage {
  readonly requestedAfterCursor: string;
  readonly retainedFromCursor: string | null;
  readonly highWaterCursor: string;
  readonly continuity: 'PROVEN' | 'GAP' | 'UNPROVEN';
  readonly truncated: boolean;
  readonly items: readonly Readonly<ProductRuntimeMaterialSourceRecord>[];
}

export interface ProductRuntimeReadPorts {
  applicationStartOk(): boolean | Promise<boolean>;
  applicationStartFailureCodes?(): readonly string[] | Promise<readonly string[]>;
  supervisor(): Readonly<SystemSupervisorReadModel> | Promise<Readonly<SystemSupervisorReadModel>>;
  opsReadback(supervisor: Readonly<SystemSupervisorReadModel>):
    | Readonly<CanonicalSupervisorOpsReadback>
    | Promise<Readonly<CanonicalSupervisorOpsReadback>>;
  bootReleaseReadback?():
    | Readonly<BootReleaseReadback>
    | Promise<Readonly<BootReleaseReadback>>;
  events(input: Readonly<{ afterCursor: string; limit: number }>):
    | Readonly<ProductRuntimeMaterialSourcePage>
    | Promise<Readonly<ProductRuntimeMaterialSourcePage>>;
  trace(correlationId: string, limit: number):
    | Readonly<SystemTraceSnapshot>
    | null
    | Promise<Readonly<SystemTraceSnapshot> | null>;
  incidents?(): Readonly<ProductRuntimeIncidentSnapshot>
    | Promise<Readonly<ProductRuntimeIncidentSnapshot>>;
}

export interface ProductRuntimeClock {
  nowMs(): number;
}

export interface ProductRuntimeOperator {
  readonly id: string;
  readonly email: string | null;
  readonly source: 'loopback' | 'cloudflare-access';
}

export const PRODUCT_RUNTIME_SAFE_BACKEND_COMMANDS = Object.freeze([
  'SET_SAFE_MODE',
  'SET_KILL_SWITCH',
  'SET_INTAKE_PAUSED',
  'RESTART_COMPONENT',
  'SET_PUBLIC_SOURCE_LIFECYCLE',
  'SET_BASIS_INTAKE',
  'SET_VOLUME_INTAKE',
  'PIN_FOCUS',
  'ACK_INCIDENT',
] as const);
export type ProductRuntimeSafeBackendCommand = (typeof PRODUCT_RUNTIME_SAFE_BACKEND_COMMANDS)[number];

export interface ProductRuntimeCommandOwnerCapability {
  readonly ownerId: string;
  readonly supportedBackendCommandIds: readonly ProductRuntimeSafeBackendCommand[];
  readonly serverDerivedActor: boolean;
  readonly durableIdempotency: boolean;
  readonly revisionCompareAndSet: boolean;
  readonly durableReceipts: boolean;
  readonly managedRestartComponentId: 'engine-supervisor' | null;
}

export type ProductRuntimeCommandScalar = string | number | boolean | null;

export interface ProductRuntimeControlPreview {
  readonly previewId: string;
  readonly controlId: string;
  readonly expectedRevision: string;
  readonly digest: string;
  readonly consequence: string;
  readonly expiresAtMs: number;
  readonly synthetic: boolean;
}

export interface ProductRuntimeCommandRequest {
  readonly schemaVersion: typeof PRODUCT_RUNTIME_COMMAND_SCHEMA;
  readonly idempotencyKey: string;
  readonly controlId: string;
  readonly backendCommandId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly payload: Readonly<Record<string, ProductRuntimeCommandScalar>>;
  readonly currentRevision: string;
  readonly expectedRevision: string;
  readonly previewId: string;
  readonly previewDigest: string;
  readonly expiresAtMs: number;
  readonly reason: string;
}

export type ProductRuntimeControlResultStatus =
  | 'APPLIED' | 'ACCEPTED_ASYNC' | 'REJECTED_SCHEMA' | 'REJECTED_BOUNDS'
  | 'REJECTED_AUTHORITY' | 'REJECTED_STALE_REVISION' | 'REJECTED_STATE'
  | 'REJECTED_DEPENDENCY' | 'REJECTED_EXPOSURE' | 'REJECTED_NOT_SUPPORTED'
  | 'EXPIRED' | 'ALREADY_APPLIED' | 'FAILED_RECOVERABLE'
  | 'FAILED_ATTENTION_REQUIRED';

export interface ProductRuntimeControlResult {
  readonly commandId: string;
  readonly controlId: string;
  readonly status: ProductRuntimeControlResultStatus;
  readonly before: string;
  readonly after: string;
  readonly receiptId: string | null;
  readonly correlationId: string;
  readonly completedAtMs: number;
  readonly synthetic: boolean;
}

export interface ProductRuntimeCommandResultIdentity {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly controlId: string;
}

export type ProductRuntimeCommandResultReadback =
  | Readonly<{
      readonly state: 'NOT_FOUND';
      readonly result: null;
      readonly failureCode: null;
    }>
  | Readonly<{
      readonly state: 'PENDING' | 'TERMINAL';
      readonly result: Readonly<ProductRuntimeControlResult>;
      readonly failureCode: null;
    }>
  | Readonly<{
      readonly state: 'FAIL_CLOSED';
      readonly result: Readonly<ProductRuntimeControlResult> | null;
      readonly failureCode: string;
    }>;

export interface ProductRuntimeCommandIntent {
  readonly controlId: string;
  readonly backendCommandId: ProductRuntimeSafeBackendCommand;
  readonly targetType: 'SYSTEM' | 'COMPONENT' | 'SYMBOL' | 'INCIDENT';
  readonly targetId: string;
  readonly payload: Readonly<Record<string, ProductRuntimeCommandScalar>>;
  readonly expectedRevision: string;
  readonly nowMs: number;
  readonly operator: Readonly<ProductRuntimeOperator>;
}

/** Optional canonical owner. Presence alone never wires a control. */
export interface ProductRuntimeCommandOwnerPort {
  readonly capability: Readonly<ProductRuntimeCommandOwnerCapability>;
  readSourceControlState?(sourceId: 'public-spot-source' | 'public-usdm-source'): Readonly<{
    readonly sourceRevision: number;
    readonly desiredLifecycle: 'LIVE' | 'ISOLATED';
    readonly observedLifecycle: string;
    readonly pendingAction: 'ISOLATE' | 'RESTART' | null;
  }> | null;
  readStrategyIntakeControlState?(strategy: 'basis' | 'volume'): Readonly<{
    readonly controlRevision: number;
    readonly desiredPaused: boolean;
    readonly effectivePaused: boolean | null;
    readonly state: 'APPLIED' | 'EFFECT_UNAVAILABLE' | 'OWNER_NOT_WIRED';
  }> | null;
  readFocusControlState?(symbol: string): Readonly<{
    readonly symbol: string;
    readonly desiredPinned: boolean;
    readonly ownerPinned: boolean | null;
    readonly eligible: boolean | null;
    readonly canPin: boolean | null;
    readonly effectivePinned: boolean | null;
    readonly effectiveTier: string | null;
    readonly attentionPlanId: string | null;
    readonly attentionPlanAtMs: number | null;
    readonly pinCount: number | null;
    readonly pinCapacity: number | null;
    readonly controlRevision: number;
    readonly state: 'APPLIED' | 'UNAVAILABLE' | 'OWNER_NOT_WIRED';
  }> | null;
  readFocusPinnedSymbols?(): readonly string[];
  /**
   * Authorizes only an exact command whose desired mutation is already durable
   * and whose runtime publication is still pending. This recovery seam may
   * bypass a now-unavailable registry projection or an expired preview, but it
   * must never admit a new mutation.
   */
  authorizePendingReplay?(input: Readonly<{
    request: Readonly<ProductRuntimeCommandRequest>;
    intent: Readonly<ProductRuntimeCommandIntent>;
  }>): Promise<boolean>;
  readIncidentControlState?(incidentId: string): Readonly<{
    readonly incidentId: string;
    readonly ledgerEventId: number;
    readonly state: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
    readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    readonly rootComponentId: string;
    readonly eventCount: number;
    readonly acknowledgedAtMs: number | null;
    readonly resolvedAtMs: number | null;
  }> | null;
  preview(intent: Readonly<ProductRuntimeCommandIntent>): Promise<Readonly<ProductRuntimeControlPreview>>;
  submit(input: Readonly<{
    request: Readonly<ProductRuntimeCommandRequest>;
    intent: Readonly<ProductRuntimeCommandIntent>;
  }>): Promise<Readonly<ProductRuntimeControlResult>>;
  readResult(
    identity: Readonly<ProductRuntimeCommandResultIdentity>,
  ): Promise<Readonly<ProductRuntimeCommandResultReadback>>;
}

export interface ProductRuntimeOptions {
  readonly read: ProductRuntimeReadPorts;
  readonly clock: ProductRuntimeClock;
  readonly commandOwner?: ProductRuntimeCommandOwnerPort;
}

export interface ProductRuntimeMaterialEvent {
  readonly cursor: string;
  readonly eventId: string;
  readonly occurredAtMs: number;
  readonly componentId: string;
  readonly kind: string;
  readonly correlationId: string | null;
  readonly truthLabel: ProductRuntimeTruthLabel;
}

export interface ProductRuntimeMaterialEventPage {
  readonly schemaVersion: typeof PRODUCT_RUNTIME_CURSOR_SCHEMA;
  readonly mode: 'CURSOR' | 'TAIL_BOOTSTRAP';
  readonly requestedAfterCursor: string;
  readonly retainedFromCursor: string | null;
  readonly highWaterCursor: string;
  readonly nextCursor: string;
  readonly hasMore: boolean;
  readonly continuity: 'PROVEN' | 'GAP' | 'UNPROVEN';
  readonly truncated: boolean;
  readonly backfillRequired: boolean;
  readonly missingRange: Readonly<{
    readonly fromCursor: string;
    readonly toCursor: string;
    readonly reason: 'RETENTION_GAP' | 'INTERIOR_GAP' | 'EVIDENCE_UNPROVEN' | 'BOOTSTRAP_HISTORY_OMITTED';
  }> | null;
  readonly items: readonly Readonly<ProductRuntimeMaterialEvent>[];
}

export interface ProductRuntimeTraceStage {
  readonly stage: string;
  readonly owner: string;
  readonly referenceId: string | null;
  readonly occurredAtMs: number | null;
  readonly outcome: string;
  readonly truthLabel: ProductRuntimeTruthLabel;
  readonly evidenceState: 'PRESENT' | 'ABSENT' | 'UNKNOWN_DUE_TO_TRUNCATION';
}

export interface ProductRuntimeCorrelationTrace {
  readonly correlationId: string;
  readonly symbol: string | null;
  readonly truncated: boolean;
  readonly completeness: 'COMPLETE' | 'TRUNCATED';
  readonly stages: readonly Readonly<ProductRuntimeTraceStage>[];
}

export interface ProductRuntimeIncidentAvailability {
  readonly state: 'AVAILABLE' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  readonly truthLabel: ProductRuntimeTruthLabel;
  readonly blocker: string | null;
}

export interface ProductRuntimeIncidentProjection {
  readonly incidentId: string;
  readonly fingerprint: string;
  readonly ledgerEventId: number;
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly rootComponentId: string;
  readonly sourceGroup: string;
  readonly capitalRelevant: boolean;
  readonly firstSeenAtMs: number;
  readonly lastSeenAtMs: number;
  readonly count: number;
  readonly state: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  readonly reasonCode: 'CONNECTION_UNHEALTHY';
  readonly operatorAction: string;
  readonly correlationId: string;
  readonly acknowledgedAtMs: number | null;
  readonly acknowledgedByOperatorId: string | null;
  readonly resolvedAtMs: number | null;
  readonly acknowledgementControlId: string;
  readonly routing: Readonly<{
    readonly inApp: Readonly<{
      readonly state: 'WIRED_LOCAL';
      readonly receiptId: string;
    }>;
    readonly externalPaging: Readonly<{
      readonly state: 'NOT_CONFIGURED';
      readonly receiptId: null;
      readonly blocker: 'EXTERNAL_PAGING_OWNER_NOT_CONFIGURED';
    }>;
  }>;
  readonly recoveryProof: Readonly<{
    readonly state: 'PENDING' | 'PROVEN';
    readonly sourceEventId: number | null;
    readonly resolvedAtMs: number | null;
  }>;
}

export interface ProductRuntimeIncidentSnapshot {
  readonly availability: Readonly<ProductRuntimeIncidentAvailability>;
  readonly incidents: readonly Readonly<ProductRuntimeIncidentProjection>[];
}

export type ProductRuntimeControlWiringState =
  | 'WIRED_LIVE' | `UNAVAILABLE:${string}` | `PENDING_BACKEND:${string}` | 'OWNER_GATED';

export interface ProductRuntimeControlRegistryEntry {
  readonly controlId: string;
  readonly backendCommandId: ProductRuntimeSafeBackendCommand;
  readonly wiringState: ProductRuntimeControlWiringState;
  readonly owner: string;
  readonly targetType: 'SYSTEM' | 'COMPONENT' | 'SYMBOL' | 'INCIDENT';
  readonly targetId: string;
  readonly payload: Readonly<Record<string, ProductRuntimeCommandScalar>>;
  readonly payloadSchema: string;
  readonly payloadEnumeration: readonly ProductRuntimeCommandScalar[];
  readonly defaultValue: ProductRuntimeCommandScalar;
  readonly group: string;
  readonly label: string;
  readonly explanation: string;
  readonly safeBounds: string;
  readonly currentDesiredValue: string;
  readonly currentEffectiveValue: string;
  readonly authority: string;
  readonly requiredPosture: string;
  readonly expiryPolicy: string;
  readonly reversibility: string;
  readonly invariants: readonly string[];
  readonly effectTelemetry: readonly string[];
  readonly currentStateRevision: string;
  readonly effect: 'IMMEDIATE' | 'RESTART';
  readonly confirmationText: string;
  readonly disabledReason: string | null;
  readonly preview: null;
  readonly latestResult: null;
}

export interface ProductRuntimeComponentProjection {
  readonly componentId: string;
  readonly owner: string;
  readonly desiredLifecycle: ProductRuntimeLifecycle;
  readonly observedLifecycle: ProductRuntimeLifecycle;
  readonly capability: ProductRuntimeCapability;
  readonly heartbeatAtMs: number | null;
  readonly lastAdvanceAtMs: number | null;
  readonly sourceAgeMs: number | null;
  readonly eventAgeMs: number | null;
  readonly processingAgeMs: number | null;
  readonly queueDepth: number | null;
  readonly queueCapacity: number | null;
  readonly droppedCount: number | null;
  readonly blockerCode: string | null;
  readonly rootCauseComponentId: string | null;
  readonly capitalRelevance: 'NONE' | 'POTENTIAL' | 'EXPOSED' | 'RECOVERY';
  readonly supportedControlIds: readonly string[];
  readonly correlationId: string | null;
  readonly truthLabel: ProductRuntimeTruthLabel;
  readonly canonicalPresentation: Readonly<ProductRuntimeComponentPresentation>;
}

export type ProductRuntimeManagedInventoryState =
  | 'EVIDENCE_PRESENT' | 'OWNER_GATED' | 'NOT_CONFIGURED' | 'MISSING';

export interface ProductRuntimeManagedInventoryComponentEvidenceRef {
  readonly source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION';
  readonly componentId: string;
  readonly componentProjectionIndex: number;
}

export interface ProductRuntimeManagedInventoryOwnerEvidenceRef {
  readonly source: 'PRODUCT_RUNTIME_OWNER_PROJECTION';
  readonly ownerId: 'productIntegration.incident-router';
  readonly truthLabel: 'BUILT_AND_TESTED';
}

export type ProductRuntimeManagedInventoryEvidenceRef =
  | ProductRuntimeManagedInventoryComponentEvidenceRef
  | ProductRuntimeManagedInventoryOwnerEvidenceRef;

/**
 * A role-to-owner reference. `evidence` reuses canonical Product component
 * projection indexes and is null whenever exact owner evidence is absent.
 * Lifecycle/capability truth remains present only in the top-level canonical
 * `components` array.
 */
export interface ProductRuntimeManagedInventoryEntry {
  readonly identity: I00ManagedComponentIdentity;
  readonly owner: string;
  readonly canonicalComponentIds: readonly string[];
  readonly inventoryState: ProductRuntimeManagedInventoryState;
  readonly evidence: readonly Readonly<ProductRuntimeManagedInventoryEvidenceRef>[] | null;
  readonly reasonCode: string | null;
}

export interface ProductRuntimeManagedInventoryProjection {
  readonly schemaVersion: typeof PRODUCT_RUNTIME_MANAGED_INVENTORY_SCHEMA;
  readonly expectedIdentityCount: 33;
  readonly mappedIdentityCount: number;
  readonly evidencePresentCount: number;
  readonly ownerGatedCount: number;
  readonly notConfiguredCount: number;
  readonly missingCount: number;
  readonly canonicalComponentCount: number;
  readonly referencedCanonicalComponentCount: number;
  readonly observedCanonicalComponentCount: number;
  readonly entries: readonly Readonly<ProductRuntimeManagedInventoryEntry>[];
}

export interface ProductRuntimeDependencyEdge {
  readonly fromComponentId: string;
  readonly toComponentId: string;
  readonly required: boolean;
  readonly state: 'AVAILABLE' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';
  readonly rootCauseComponentId: string | null;
  readonly reasonCodes: readonly string[];
}

export interface ProductRuntimeOwnerView {
  readonly processAlive: 'YES' | 'NO' | 'UNKNOWN';
  readonly machineReady: 'YES' | 'NO' | 'UNKNOWN';
  readonly tradeReady: 'NO';
  readonly desiredMode: 'READ_ONLY' | 'ADVISORY' | 'VALIDATE_ONLY';
  readonly effectiveMode: 'READ_ONLY' | 'ADVISORY' | 'VALIDATE_ONLY' | 'BLOCKED' | 'UNKNOWN';
  readonly exposedCapital: string | null;
  readonly unresolvedRecovery: string | null;
  readonly dataFreshness: string | null;
  readonly topRootBlocker: string | null;
  readonly activeOpportunity: string | null;
  readonly activeTicket: string | null;
  readonly activePosition: string | null;
  readonly latestMaterialChange: string | null;
  readonly revisions: Readonly<{
    testedCommit: string | null;
    deployedCommit: string | null;
    modelRevision: string | null;
    configRevision: string | null;
    schemaRevision: typeof PRODUCT_RUNTIME_SUPERVISOR_SCHEMA;
  }>;
}

export type ProductRuntimeBootReleaseLifecycleState =
  | 'ACTIVE' | 'CRASH_PENDING' | 'CLEAN_COMPLETED' | 'UNCLEAN_COMPLETED';

export type ProductRuntimeBootReleaseIdentityIssue =
  | 'TESTED_COMMIT_UNKNOWN'
  | 'DEPLOYED_COMMIT_UNKNOWN'
  | 'CONFIG_REVISION_UNKNOWN'
  | 'SCHEMA_REVISION_UNKNOWN'
  | 'MODEL_REVISION_UNKNOWN';

export interface ProductRuntimeBootReleaseRecord {
  readonly operationId: string;
  readonly operationType: 'APPLICATION_BOOT';
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
  readonly lifecycleState: ProductRuntimeBootReleaseLifecycleState;
  readonly identityState: 'AVAILABLE' | 'PARTIAL' | 'UNKNOWN';
  readonly identityIssues: readonly ProductRuntimeBootReleaseIdentityIssue[];
  readonly deploymentMutationAuthority: 'NONE';
}

/**
 * Bounded Product projection of canonical Ledger boot/release readback.
 * This is evidence only and carries no deployment mutation authority.
 */
export interface ProductRuntimeBootReleaseReadback {
  readonly source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE';
  readonly state: 'AVAILABLE' | 'EMPTY' | 'UNAVAILABLE';
  readonly latest: Readonly<ProductRuntimeBootReleaseRecord> | null;
  readonly history: readonly Readonly<ProductRuntimeBootReleaseRecord>[];
  readonly crashPendingOperationIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface ProductRuntimeSurfaceDatum {
  readonly fieldId: string;
  readonly label: string;
  readonly value: string | null;
  readonly truthLabel: ProductRuntimeTruthLabel;
  readonly canonicalSource: string;
  readonly unavailableReason: string | null;
}

export interface ProductRuntimeSurfaceProjection {
  readonly surfaceId: string;
  readonly label: string;
  readonly bindingState: 'BINDING_READY' | 'BLOCKED_BACKEND';
  readonly truthLabel: ProductRuntimeTruthLabel;
  readonly canonicalSource: string;
  readonly evaluatedAtMs: number;
  readonly summary: string;
  readonly blocker: string | null;
  readonly controlIds: readonly string[];
  readonly correlationId: string | null;
  readonly evidence: readonly Readonly<ProductRuntimeSurfaceDatum>[];
}

export interface ProductRuntimeCanonicalCockpitTruth {
  readonly source: 'CANONICAL_SUPERVISOR_PRODUCT_PROJECTION';
  readonly marketFeedReadiness: Readonly<{
    readonly proven: boolean;
    readonly label: 'Market Feed Readiness Proven' | 'Market Feed Readiness Unproven';
    readonly detail: string;
  }>;
  readonly strategyRuntime: Readonly<{
    readonly tone: ProductRuntimePresentationTone;
    readonly label: string;
    readonly livePublicCount: number;
  }>;
  readonly watchmanOverall: Readonly<{
    readonly status: ProductRuntimeWatchmanStatus;
    readonly label: string;
  }>;
}

export interface ProductRuntimeSupervisorEnvelope {
  readonly schemaVersion: typeof PRODUCT_RUNTIME_SUPERVISOR_SCHEMA;
  readonly revision: string;
  readonly digest: string;
  readonly evaluatedAtMs: number;
  readonly truthLabel: ProductRuntimeTruthLabel;
  readonly persistentSyntheticLabel: boolean;
  readonly opsReadback: Readonly<CanonicalSupervisorOpsReadback>;
  readonly opsIntakeInterlock: Readonly<CanonicalOpsIntakeInterlock>;
  readonly bootReleaseReadback: Readonly<ProductRuntimeBootReleaseReadback>;
  readonly ownerView: Readonly<ProductRuntimeOwnerView>;
  readonly canonicalCockpit: Readonly<ProductRuntimeCanonicalCockpitTruth>;
  readonly dashboard: Readonly<SystemSupervisorReadModel>;
  readonly components: readonly Readonly<ProductRuntimeComponentProjection>[];
  readonly managedInventory: Readonly<ProductRuntimeManagedInventoryProjection>;
  readonly dependencyEdges: readonly Readonly<ProductRuntimeDependencyEdge>[];
  readonly controls: readonly Readonly<ProductRuntimeControlRegistryEntry>[];
  readonly traces: readonly Readonly<ProductRuntimeCorrelationTrace>[];
  readonly incidentAvailability: Readonly<ProductRuntimeIncidentAvailability>;
  readonly incidents: readonly Readonly<ProductRuntimeIncidentProjection>[];
  readonly materialEvents: Readonly<ProductRuntimeMaterialEventPage>;
  readonly surfaces: Readonly<Record<string, Readonly<ProductRuntimeSurfaceProjection>>>;
}

export class ProductRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ProductRuntimeError';
    this.code = code;
    this.status = status;
  }
}
