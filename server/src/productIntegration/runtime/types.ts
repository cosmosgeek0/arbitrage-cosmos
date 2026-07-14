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
  opsReadback():
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
  readonly targetType: 'SYSTEM' | 'COMPONENT';
  readonly targetId: string;
  readonly payload: Readonly<Record<string, ProductRuntimeCommandScalar>>;
  readonly expectedRevision: string;
  readonly nowMs: number;
  readonly operator: Readonly<ProductRuntimeOperator>;
}

/** Optional canonical owner. Presence alone never wires a control. */
export interface ProductRuntimeCommandOwnerPort {
  readonly capability: Readonly<ProductRuntimeCommandOwnerCapability>;
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

export type ProductRuntimeControlWiringState =
  | 'WIRED_LIVE' | `UNAVAILABLE:${string}` | `PENDING_BACKEND:${string}` | 'OWNER_GATED';

export interface ProductRuntimeControlRegistryEntry {
  readonly controlId: string;
  readonly backendCommandId: ProductRuntimeSafeBackendCommand;
  readonly wiringState: ProductRuntimeControlWiringState;
  readonly owner: string;
  readonly targetType: 'SYSTEM' | 'COMPONENT';
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
}

export type ProductRuntimeManagedInventoryState =
  | 'EVIDENCE_PRESENT' | 'OWNER_GATED' | 'NOT_CONFIGURED' | 'MISSING';

export interface ProductRuntimeManagedInventoryEvidenceRef {
  readonly source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION';
  readonly componentId: string;
  readonly componentProjectionIndex: number;
}

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

export interface ProductRuntimeSupervisorEnvelope {
  readonly schemaVersion: typeof PRODUCT_RUNTIME_SUPERVISOR_SCHEMA;
  readonly revision: string;
  readonly digest: string;
  readonly evaluatedAtMs: number;
  readonly truthLabel: ProductRuntimeTruthLabel;
  readonly persistentSyntheticLabel: boolean;
  readonly opsReadback: Readonly<CanonicalSupervisorOpsReadback>;
  readonly opsIntakeInterlock: Readonly<CanonicalOpsIntakeInterlock>;
  readonly ownerView: Readonly<ProductRuntimeOwnerView>;
  readonly dashboard: Readonly<SystemSupervisorReadModel>;
  readonly components: readonly Readonly<ProductRuntimeComponentProjection>[];
  readonly managedInventory: Readonly<ProductRuntimeManagedInventoryProjection>;
  readonly dependencyEdges: readonly Readonly<ProductRuntimeDependencyEdge>[];
  readonly controls: readonly Readonly<ProductRuntimeControlRegistryEntry>[];
  readonly traces: readonly Readonly<ProductRuntimeCorrelationTrace>[];
  readonly incidentAvailability: Readonly<ProductRuntimeIncidentAvailability>;
  readonly incidents: readonly never[];
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
