export const PRODUCT_SUPERVISOR_SCHEMA = 'product-supervisor.v1' as const;
export const PRODUCT_COMMAND_SCHEMA = 'product-command.v1' as const;
export const MATERIAL_CURSOR_SCHEMA = 'material-cursor.v1' as const;
export const PRODUCT_MANAGED_INVENTORY_SCHEMA = 'i00-managed-inventory.v1' as const;
export const SAFE_LIVE_BACKEND_COMMAND_IDS: readonly string[] = Object.freeze([
  'SET_SAFE_MODE', 'SET_KILL_SWITCH', 'SET_INTAKE_PAUSED', 'RESTART_COMPONENT',
]);
export const PRODUCT_TRACE_STAGES: readonly string[] = Object.freeze([
  'Market Source',
  'Normalized Evidence',
  'Attention / Focus',
  'Q Assessment',
  'Basis / Volume Decision',
  'Capital Verdict',
  'Risk Verdict',
  'Ticket / Plan',
  'Reconciliation',
  'Position / Recovery',
  'PnL / Cost Attribution',
  'Outcome Feedback',
]);
const PRODUCT_TRACE_ID = /^[A-Za-z0-9_.:\-]{1,160}$/;

export type ProductTruthLabel =
  | 'LIVE_PUBLIC'
  | 'WIRED'
  | 'BUILT_AND_TESTED'
  | 'IMPORTED'
  | 'SYNTHETIC_ONLY'
  | 'BLOCKED'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'MISSING'
  | 'UNKNOWN';

export type ProductLifecycle =
  | 'STOPPED'
  | 'START_REQUESTED'
  | 'STARTING'
  | 'WARMING'
  | 'READY'
  | 'DEGRADED'
  | 'PAUSED'
  | 'DRAINING'
  | 'RECONCILING'
  | 'RECOVERY_REQUIRED'
  | 'BLOCKED'
  | 'FAILED'
  | 'STOPPING';

export type ProductCapability =
  | 'LIVE_PUBLIC'
  | 'LIVE_PRIVATE_READ'
  | 'LIVE_SIGNED_VALIDATE'
  | 'LIVE_MANUAL_CAPPED'
  | 'SHADOW'
  | 'DRY_RUN'
  | 'REPLAY'
  | 'SYNTHETIC'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export type ProductSafeMode = 'READ_ONLY' | 'ADVISORY' | 'VALIDATE_ONLY';
export type ControlWiringState =
  | 'WIRED_LIVE'
  | 'WIRED_FIXTURE'
  | `PENDING_BACKEND:${string}`
  | 'OWNER_GATED'
  | `UNAVAILABLE:${string}`;

export type ControlResultStatus =
  | 'APPLIED'
  | 'ACCEPTED_ASYNC'
  | 'REJECTED_SCHEMA'
  | 'REJECTED_BOUNDS'
  | 'REJECTED_AUTHORITY'
  | 'REJECTED_STALE_REVISION'
  | 'REJECTED_STATE'
  | 'REJECTED_DEPENDENCY'
  | 'REJECTED_EXPOSURE'
  | 'REJECTED_NOT_SUPPORTED'
  | 'EXPIRED'
  | 'ALREADY_APPLIED'
  | 'FAILED_RECOVERABLE'
  | 'FAILED_ATTENTION_REQUIRED';

export type ProductCommandScalar = string | number | boolean | null;

export type SurfaceId =
  | 'dashboard'
  | 'control-room'
  | 'account'
  | 'markets'
  | 'token'
  | 'basis'
  | 'volume'
  | 'opportunities'
  | 'borrow'
  | 'execution'
  | 'orders'
  | 'positions'
  | 'fills'
  | 'pnl'
  | 'risk'
  | 'health'
  | 'logs-ledger'
  | 'notifications';

export const REQUIRED_SURFACE_IDS: readonly SurfaceId[] = Object.freeze([
  'dashboard',
  'control-room',
  'account',
  'markets',
  'token',
  'basis',
  'volume',
  'opportunities',
  'borrow',
  'execution',
  'orders',
  'positions',
  'fills',
  'pnl',
  'risk',
  'health',
  'logs-ledger',
  'notifications',
]);

export interface ProductRevisionSet {
  readonly testedCommit: string | null;
  readonly deployedCommit: string | null;
  readonly modelRevision: string | null;
  readonly configRevision: string | null;
  readonly schemaRevision: string;
}

export interface FiveSecondOwnerView {
  readonly processAlive: 'YES' | 'NO' | 'UNKNOWN';
  readonly machineReady: 'YES' | 'NO' | 'UNKNOWN';
  readonly tradeReady: 'NO';
  readonly desiredMode: ProductSafeMode;
  readonly effectiveMode: ProductSafeMode | 'BLOCKED' | 'UNKNOWN';
  readonly exposedCapital: string | null;
  readonly unresolvedRecovery: string | null;
  readonly dataFreshness: string | null;
  readonly topRootBlocker: string | null;
  readonly activeOpportunity: string | null;
  readonly activeTicket: string | null;
  readonly activePosition: string | null;
  readonly latestMaterialChange: string | null;
  readonly revisions: Readonly<ProductRevisionSet>;
}

/** Render the canonical owner verdict; the browser never derives readiness. */
export function productMachineReadinessTone(
  machineReady: FiveSecondOwnerView['machineReady'],
): 'ok' | 'warn' {
  return machineReady === 'YES' ? 'ok' : 'warn';
}

export interface ProductComponentProjection {
  readonly componentId: string;
  readonly owner: string;
  readonly desiredLifecycle: ProductLifecycle;
  readonly observedLifecycle: ProductLifecycle;
  readonly capability: ProductCapability;
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
  readonly truthLabel: ProductTruthLabel;
}

export type ProductManagedInventoryState =
  | 'EVIDENCE_PRESENT'
  | 'OWNER_GATED'
  | 'NOT_CONFIGURED'
  | 'MISSING';

export interface ProductManagedInventoryEvidenceRef {
  readonly source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION';
  readonly componentId: string;
  readonly componentProjectionIndex: number;
}

export interface ProductManagedInventoryEntry {
  readonly identity: I00ManagedComponentIdentity;
  readonly owner: string;
  readonly canonicalComponentIds: readonly string[];
  readonly inventoryState: ProductManagedInventoryState;
  readonly evidence: readonly Readonly<ProductManagedInventoryEvidenceRef>[] | null;
  readonly reasonCode: string | null;
}

export interface ProductManagedInventoryProjection {
  readonly schemaVersion: typeof PRODUCT_MANAGED_INVENTORY_SCHEMA;
  readonly expectedIdentityCount: 33;
  readonly mappedIdentityCount: number;
  readonly evidencePresentCount: number;
  readonly ownerGatedCount: number;
  readonly notConfiguredCount: number;
  readonly missingCount: number;
  readonly canonicalComponentCount: number;
  readonly referencedCanonicalComponentCount: number;
  readonly observedCanonicalComponentCount: number;
  readonly entries: readonly Readonly<ProductManagedInventoryEntry>[];
}

type ProductManagedInventoryUnavailableState = Exclude<ProductManagedInventoryState, 'EVIDENCE_PRESENT'>;

interface ProductManagedInventoryContractEntry<TIdentity extends string = string> {
  readonly identity: TIdentity;
  readonly owner: string;
  readonly canonicalComponentIds: readonly string[];
  readonly unavailableState: ProductManagedInventoryUnavailableState | null;
  readonly unavailableReason: string | null;
}

function managedInventoryMappedRole<const TIdentity extends string>(
  identity: TIdentity,
  owner: string,
  ...canonicalComponentIds: string[]
): Readonly<ProductManagedInventoryContractEntry<TIdentity>> {
  return Object.freeze({
    identity,
    owner,
    canonicalComponentIds: Object.freeze(canonicalComponentIds),
    unavailableState: null,
    unavailableReason: null,
  });
}

function managedInventoryUnavailableRole<const TIdentity extends string>(
  identity: TIdentity,
  owner: string,
  unavailableState: ProductManagedInventoryUnavailableState,
  unavailableReason: string,
): Readonly<ProductManagedInventoryContractEntry<TIdentity>> {
  return Object.freeze({
    identity,
    owner,
    canonicalComponentIds: Object.freeze([]),
    unavailableState,
    unavailableReason,
  });
}

/**
 * Browser-side v1 wire-decoder expectation. This validates the server-owned
 * role projection; it is not a second topology, lifecycle, or readiness
 * owner. Fixture construction reuses it only to emit server-shaped synthetic
 * envelopes whose evidence indexes bind to their final component array.
 */
const PRODUCT_MANAGED_INVENTORY_CONTRACT = Object.freeze([
  managedInventoryUnavailableRole('operator-auth', 'AUDITED_BACKEND_SECURITY', 'OWNER_GATED', 'REMOTE_OPERATOR_IDENTITY_OWNER_GATED'),
  managedInventoryUnavailableRole('configuration-authority', 'SYSTEM_CONTROL_CONFIGURATION_OWNER', 'OWNER_GATED', 'CANONICAL_CONFIGURATION_VERSION_OWNER_REQUIRED'),
  managedInventoryMappedRole('ledger-persistence', 'EXISTING_LEDGER', 'ledger-persistence'),
  managedInventoryUnavailableRole('database', 'EXISTING_LEDGER_DATABASE', 'OWNER_GATED', 'DATABASE_LIFECYCLE_EVIDENCE_NOT_BOUND'),
  managedInventoryUnavailableRole('clock-sync', 'CANONICAL_CLOCK_SYNC_OWNER', 'OWNER_GATED', 'CLOCK_SYNCHRONIZATION_OWNER_NOT_BOUND'),
  managedInventoryMappedRole('spot-public-source', 'AUDITED_APP_PUBLIC_SOURCE', 'public-spot-source'),
  managedInventoryMappedRole('usdm-public-source', 'AUDITED_APP_PUBLIC_SOURCE', 'public-usdm-source'),
  managedInventoryUnavailableRole('spot-private-truth', 'LIVE_EDGE_PRIVATE_TRUTH', 'OWNER_GATED', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'),
  managedInventoryUnavailableRole('usdm-private-truth', 'LIVE_EDGE_PRIVATE_TRUTH', 'OWNER_GATED', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'),
  managedInventoryUnavailableRole('margin-private-truth', 'LIVE_EDGE_PRIVATE_TRUTH', 'OWNER_GATED', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'),
  managedInventoryMappedRole('instrument-filter-registry', 'CANONICAL_MARKET_UNIVERSE', 'market-universe'),
  managedInventoryMappedRole('universe', 'CANONICAL_MARKET_UNIVERSE', 'market-universe'),
  managedInventoryMappedRole('evidence-attention-runtime', 'INTELLIGENCE_RUNTIME_AND_MARKET_INTELLIGENCE', 'intelligence-runtime', 'market-intelligence'),
  managedInventoryMappedRole('q-inference', 'Q_INFERENCE', 'q-inference'),
  managedInventoryMappedRole('basis-engine', 'BASIS_ENGINE', 'basis-engine'),
  managedInventoryMappedRole('volume-engine', 'VOLUME_ENGINE', 'volume-engine'),
  managedInventoryUnavailableRole('opportunity-authority', 'FOUNDATION_CANONICAL_OPPORTUNITY', 'OWNER_GATED', 'OPPORTUNITY_AUTHORITY_COMPONENT_EVIDENCE_NOT_BOUND'),
  managedInventoryMappedRole('capital-supervision', 'CAPITAL_SUPERVISION', 'capital-supervision'),
  managedInventoryMappedRole('risk-gate', 'BACKEND_FOUNDATION_RISK', 'multileg-risk'),
  managedInventoryMappedRole('execution-hand', 'BACKEND_FOUNDATION_EXECUTION', 'execution-coordinator-validate-only'),
  managedInventoryUnavailableRole('normal-basis-coordinator', 'LIVE_EDGE_NORMAL_BASIS_COORDINATOR', 'OWNER_GATED', 'NORMAL_BASIS_COORDINATOR_COMPONENT_EVIDENCE_NOT_BOUND'),
  managedInventoryUnavailableRole('reverse-basis-coordinator', 'LIVE_EDGE_REVERSE_BASIS_COORDINATOR', 'OWNER_GATED', 'REVERSE_BASIS_COORDINATOR_COMPONENT_EVIDENCE_NOT_BOUND'),
  managedInventoryUnavailableRole('volume-position-lifecycle', 'LIVE_EDGE_VOLUME_POSITION_LIFECYCLE', 'OWNER_GATED', 'VOLUME_POSITION_LIFECYCLE_COMPONENT_EVIDENCE_NOT_BOUND'),
  managedInventoryMappedRole('reconciliation', 'BACKEND_FOUNDATION_RECONCILIATION', 'reconciliation'),
  managedInventoryUnavailableRole('exposure-position-recovery', 'LIVE_EDGE_EXPOSURE_RECOVERY', 'OWNER_GATED', 'PRIVATE_ACCOUNT_TRUTH_OWNER_GATED'),
  managedInventoryUnavailableRole('outcome-feedback', 'Q_OUTCOME_FEEDBACK_OWNER', 'OWNER_GATED', 'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED'),
  managedInventoryMappedRole('machine-supervisor', 'BACKEND_FOUNDATION_CONTROL_AND_SYSTEM_INTEGRATION', 'engine-supervisor'),
  managedInventoryUnavailableRole('api-read-model', 'PRODUCT_INTEGRATION_READ_MODEL', 'NOT_CONFIGURED', 'API_READ_MODEL_NOT_LIFECYCLE_MANAGED'),
  managedInventoryUnavailableRole('notification-incident-router', 'NOTIFICATION_INCIDENT_ROUTER', 'NOT_CONFIGURED', 'INCIDENT_OWNER_NOT_CONFIGURED'),
  managedInventoryUnavailableRole('web-cockpit', 'PRODUCT_CONTROL_WEB', 'NOT_CONFIGURED', 'WEB_COCKPIT_NOT_LIFECYCLE_MANAGED'),
  managedInventoryUnavailableRole('backup-restore', 'OPS_BACKUP_RESTORE', 'MISSING', 'BACKUP_RESTORE_MANAGED_COMPONENT_MISSING'),
  managedInventoryUnavailableRole('external-watchdog', 'OPS_EXTERNAL_WATCHDOG', 'MISSING', 'EXTERNAL_WATCHDOG_MANAGED_COMPONENT_MISSING'),
  managedInventoryUnavailableRole('cloudflare-tunnel-access', 'OPS_CLOUDFLARE_ACCESS', 'MISSING', 'CLOUDFLARE_TUNNEL_ACCESS_MANAGED_COMPONENT_MISSING'),
]);

export const I00_MANAGED_COMPONENT_IDENTITIES = Object.freeze(
  PRODUCT_MANAGED_INVENTORY_CONTRACT.map((entry) => entry.identity),
);
export type I00ManagedComponentIdentity = (typeof I00_MANAGED_COMPONENT_IDENTITIES)[number];

const PRODUCT_MANAGED_CANONICAL_COMPONENT_IDS = Object.freeze(Array.from(new Set(
  PRODUCT_MANAGED_INVENTORY_CONTRACT.flatMap((entry) => entry.canonicalComponentIds),
)));

export interface ProductDependencyEdgeProjection {
  readonly fromComponentId: string;
  readonly toComponentId: string;
  readonly required: boolean;
  readonly state: 'AVAILABLE' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';
  readonly rootCauseComponentId: string | null;
  readonly reasonCodes: readonly string[];
}

export interface ProductControlPreview {
  readonly previewId: string;
  readonly controlId: string;
  readonly expectedRevision: string;
  readonly digest: string;
  readonly consequence: string;
  readonly expiresAtMs: number;
  readonly synthetic: boolean;
}

export interface ProductControlResult {
  readonly commandId: string;
  readonly controlId: string;
  readonly status: ControlResultStatus;
  readonly before: string;
  readonly after: string;
  readonly receiptId: string | null;
  readonly correlationId: string;
  readonly completedAtMs: number;
  readonly synthetic: boolean;
}

export interface ProductCommandResultIdentity {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly controlId: string;
}

export type ProductCommandResultReadback =
  | Readonly<{
      readonly state: 'PENDING' | 'TERMINAL';
      readonly result: Readonly<ProductControlResult>;
      readonly reasonCode: null;
    }>
  | Readonly<{
      readonly state: 'AMBIGUOUS';
      readonly result: Readonly<ProductControlResult>;
      readonly reasonCode: 'COMMAND_RESULT_FAILED_ATTENTION_REQUIRED';
    }>;

export function isProductCommandResultIdentity(value: unknown): value is ProductCommandResultIdentity {
  return isRecord(value)
    && Object.keys(value).length === 3
    && typeof value.commandId === 'string'
    && /^sysctrl_[a-f0-9]{64}$/.test(value.commandId)
    && typeof value.idempotencyKey === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.idempotencyKey)
    && typeof value.controlId === 'string'
    && /^[a-z0-9][a-z0-9.-]{0,159}$/.test(value.controlId);
}

export interface ProductControlRegistryEntry {
  readonly controlId: string;
  readonly backendCommandId: string;
  readonly wiringState: ControlWiringState;
  readonly owner: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly payload: Readonly<Record<string, ProductCommandScalar>>;
  readonly payloadSchema: string;
  readonly payloadEnumeration: readonly ProductCommandScalar[];
  readonly defaultValue: ProductCommandScalar;
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
  readonly effect: 'IMMEDIATE' | 'DRAIN' | 'RESTART' | 'DEPLOYMENT';
  readonly confirmationText: string;
  readonly disabledReason: string | null;
  readonly preview: Readonly<ProductControlPreview> | null;
  readonly latestResult: Readonly<ProductControlResult> | null;
}

export interface ProductTraceStage {
  readonly stage: string;
  readonly owner: string;
  readonly referenceId: string | null;
  readonly occurredAtMs: number | null;
  readonly outcome: string;
  readonly truthLabel: ProductTruthLabel;
  readonly evidenceState: 'PRESENT' | 'ABSENT' | 'UNKNOWN_DUE_TO_TRUNCATION';
}

export interface ProductCorrelationTrace {
  readonly correlationId: string;
  readonly symbol: string | null;
  readonly truncated: boolean;
  readonly completeness: 'COMPLETE' | 'TRUNCATED';
  readonly stages: readonly Readonly<ProductTraceStage>[];
}

export function productTraceHasSyntheticEvidence(trace: Readonly<ProductCorrelationTrace> | null): boolean {
  return trace?.stages.some((stage) => stage.truthLabel === 'SYNTHETIC_ONLY') ?? false;
}

export interface ProductIncidentAvailability {
  readonly state: 'AVAILABLE' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  readonly truthLabel: ProductTruthLabel;
  readonly blocker: string | null;
}

export interface ProductIncidentProjection {
  readonly fingerprint: string;
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly rootComponentId: string;
  readonly capitalRelevant: boolean;
  readonly firstSeenAtMs: number;
  readonly lastSeenAtMs: number;
  readonly count: number;
  readonly state: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  readonly reasonCode: string;
  readonly operatorAction: string | null;
  readonly correlationId: string | null;
}

export interface MaterialEventProjection {
  readonly cursor: string;
  readonly eventId: string;
  readonly occurredAtMs: number;
  readonly componentId: string;
  readonly kind: string;
  readonly correlationId: string | null;
  readonly truthLabel: ProductTruthLabel;
}

export interface MaterialEventPage {
  readonly schemaVersion: typeof MATERIAL_CURSOR_SCHEMA;
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
  readonly items: readonly Readonly<MaterialEventProjection>[];
}

export interface ProductSurfaceProjection {
  readonly surfaceId: SurfaceId;
  readonly label: string;
  readonly bindingState: 'BINDING_READY' | 'DIRECTOR_MOUNT_REQUIRED' | 'BLOCKED_BACKEND';
  readonly truthLabel: ProductTruthLabel;
  readonly canonicalSource: string;
  readonly evaluatedAtMs: number;
  readonly summary: string;
  readonly blocker: string | null;
  readonly controlIds: readonly string[];
  readonly correlationId: string | null;
  readonly evidence: readonly Readonly<ProductSurfaceDatum>[];
}

export interface ProductSurfaceDatum {
  readonly fieldId: string;
  readonly label: string;
  readonly value: string | null;
  readonly truthLabel: ProductTruthLabel;
  readonly canonicalSource: string;
  readonly unavailableReason: string | null;
}

export interface CanonicalSupervisorOpsReadback {
  readonly source: 'CANONICAL_SUPERVISOR_READBACK';
  readonly observedAtUtc: string;
  readonly validUntilUtc: string;
  readonly deploymentFrozen: boolean | 'UNKNOWN';
  readonly exposureState: 'NONE' | 'ACTIVE' | 'AMBIGUOUS' | 'RECOVERY_REQUIRED' | 'UNKNOWN';
  readonly ambiguityState: 'NONE' | 'AMBIGUOUS' | 'UNKNOWN';
  readonly recoveryState: 'NONE' | 'RECOVERY_REQUIRED' | 'UNKNOWN';
  readonly currentSchemaVersion: number | null;
  readonly rollbackFloor: number | null;
}

export interface CanonicalOpsIntakeInterlock {
  readonly source: 'CANONICAL_OPS_INTAKE_INTERLOCK';
  readonly state: 'OPS_INTERLOCK_CLEAR' | 'OPS_INTERLOCK_BLOCKED';
  readonly blocksNewEntries: boolean;
  readonly externalActionAuthorization: 'NONE';
  readonly evaluatedAtUtc: string;
  readonly readbackValidUntilUtc: string | null;
  readonly reasonCodes: readonly string[];
}

export interface ProductSupervisorEnvelope<TDashboard = unknown> {
  readonly schemaVersion: typeof PRODUCT_SUPERVISOR_SCHEMA;
  readonly revision: string;
  readonly digest: string;
  readonly evaluatedAtMs: number;
  readonly truthLabel: ProductTruthLabel;
  readonly persistentSyntheticLabel: boolean;
  readonly opsReadback: Readonly<CanonicalSupervisorOpsReadback>;
  readonly opsIntakeInterlock: Readonly<CanonicalOpsIntakeInterlock>;
  readonly ownerView: Readonly<FiveSecondOwnerView>;
  readonly dashboard: TDashboard;
  readonly components: readonly Readonly<ProductComponentProjection>[];
  readonly managedInventory: Readonly<ProductManagedInventoryProjection>;
  readonly dependencyEdges: readonly Readonly<ProductDependencyEdgeProjection>[];
  readonly controls: readonly Readonly<ProductControlRegistryEntry>[];
  readonly traces: readonly Readonly<ProductCorrelationTrace>[];
  readonly incidentAvailability: Readonly<ProductIncidentAvailability>;
  readonly incidents: readonly Readonly<ProductIncidentProjection>[];
  readonly materialEvents: Readonly<MaterialEventPage>;
  readonly surfaces: Readonly<Record<SurfaceId, Readonly<ProductSurfaceProjection>>>;
}

export interface ProductCommandRequest {
  readonly schemaVersion: typeof PRODUCT_COMMAND_SCHEMA;
  readonly idempotencyKey: string;
  readonly controlId: string;
  readonly backendCommandId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly payload: Readonly<Record<string, ProductCommandScalar>>;
  readonly currentRevision: string;
  readonly expectedRevision: string;
  readonly previewId: string;
  readonly previewDigest: string;
  readonly expiresAtMs: number;
  readonly reason: string;
}

export type ProductFixtureScenarioId =
  | 'HEALTHY_OBSERVE'
  | 'DEGRADED_STALE_SOURCES'
  | 'VALIDATE_ONLY_SLICE_RUNNING'
  | 'RECOVERY_REQUIRED_ONE_LEG'
  | 'TINY_LIVE_CANARY_OWNER_GATED';

export const REQUIRED_FIXTURE_SCENARIOS: readonly ProductFixtureScenarioId[] = Object.freeze([
  'HEALTHY_OBSERVE',
  'DEGRADED_STALE_SOURCES',
  'VALIDATE_ONLY_SLICE_RUNNING',
  'RECOVERY_REQUIRED_ONE_LEG',
  'TINY_LIVE_CANARY_OWNER_GATED',
]);

export interface ProductFixtureSession {
  readonly scenarioId: ProductFixtureScenarioId;
  readonly sessionId: string;
  readonly startedAtMs: number;
  readonly nowMs: number;
  readonly tick: number;
  readonly controlRevision: number;
  readonly materialCursor: number;
  readonly desiredMode: ProductSafeMode;
  readonly effectiveMode: ProductSafeMode | 'BLOCKED';
  readonly killSwitchEngaged: boolean;
  readonly intakePaused: boolean;
  readonly lastResult: Readonly<ProductControlResult> | null;
  readonly lastIdempotencyKey: string | null;
}

const SURFACE_LABELS: Readonly<Record<SurfaceId, string>> = Object.freeze({
  dashboard: 'Dashboard',
  'control-room': 'Control Room',
  account: 'Account',
  markets: 'Markets',
  token: 'Token',
  basis: 'Basis',
  volume: 'Volume',
  opportunities: 'Opportunities',
  borrow: 'Borrow',
  execution: 'Execution',
  orders: 'Orders',
  positions: 'Positions',
  fills: 'Fills',
  pnl: 'PnL',
  risk: 'Risk',
  health: 'Health',
  'logs-ledger': 'Logs / Ledger',
  notifications: 'Notifications',
});

const SURFACE_SOURCES: Readonly<Record<SurfaceId, string>> = Object.freeze({
  dashboard: 'ownerView + incidents + revisions',
  'control-room': 'components + controls + traces',
  account: 'accountTruth + capital',
  markets: 'universe + evidence projections',
  token: 'symbol chronology + correlation trace',
  basis: 'basis owner projection',
  volume: 'volume owner projection',
  opportunities: 'canonical opportunity projection',
  borrow: 'margin truth + liability projection',
  execution: 'ticket + plan + reconciliation projection',
  orders: 'execution order projection',
  positions: 'capital position + recovery projection',
  fills: 'execution fill projection',
  pnl: 'capital economics attribution',
  risk: 'foundation risk + effective halt projection',
  health: 'component graph + source freshness',
  'logs-ledger': 'material cursor + bounded trace query',
  notifications: 'grouped incidents + operator attention',
});

export const REQUIRED_SURFACE_EVIDENCE: Readonly<Record<SurfaceId, readonly string[]>> = Object.freeze({
  dashboard: Object.freeze(['overall-posture', 'startup', 'revisions', 'mode', 'capital', 'pnl-drawdown', 'pipeline-counts', 'active-objects', 'root-blocker', 'attention', 'strategy-q', 'material-decisions']),
  'control-room': Object.freeze(['machine-graph', 'dependency-edges', 'boot-timeline', 'control-registry', 'revision-conflicts', 'async-progress', 'before-after', 'config-history', 'authority', 'correlation', 'emergency-controls', 'deployment-frozen', 'exposure-state', 'ambiguity-state', 'recovery-state', 'ledger-schema-compatibility', 'ops-interlock']),
  account: Object.freeze(['spot-truth', 'usdm-truth', 'margin-truth', 'balances-equity-collateral', 'available-capital', 'permissions-modes', 'orders-positions', 'liabilities-interest', 'freshness-completeness', 'reconciliation', 'foreign-manual']),
  markets: Object.freeze(['basis', 'wake-up', 'flow', 'liquidity', 'derivatives', 'data-quality', 'candidate-focus', 'source-freshness', 'q-assessment']),
  token: Object.freeze(['first-change', 'evidence-timeline', 'spot-perp-leadership', 'market-context', 'candidate-focus', 'q-model', 'strategy-decisions', 'conflicts-missing', 'ticket-position', 'outcome']),
  basis: Object.freeze(['directional-cases', 'economics', 'gap', 'funding', 'depth-slippage', 'borrow', 'feasibility', 'staging', 'proposal-reject', 'execution-recovery']),
  volume: Object.freeze(['quiet-baseline', 'transition-stage', 'anomaly-follow-through', 'spot-perp-leadership', 'liquidity-crowding', 'analogues-false-positives', 'q-uncertainty', 'proposal-reject', 'position-outcome']),
  opportunities: Object.freeze(['strategy-source-revision', 'evidence-conflict-missing', 'model-assessment', 'net-economics', 'capital-risk-verdict', 'size-staging', 'expiry-invalidation', 'entry-exit-recovery', 'approval', 'rejection']),
  borrow: Object.freeze(['availability-inventory', 'maximum-borrowable', 'rate-interest', 'account-collateral', 'freshness', 'principal-accrual-repay', 'proposal-ticket', 'unsupported']),
  execution: Object.freeze(['ticket-leg-state', 'quantities', 'order-identities', 'ambiguity-reconciliation', 'one-leg-timer', 'exit-capacity', 'funding-borrow', 'controls', 'pnl-attribution']),
  orders: Object.freeze(['ticket-leg-state', 'quantities', 'order-identities', 'ambiguity-reconciliation', 'controls']),
  positions: Object.freeze(['ticket-position-link', 'gross-net-unhedged', 'one-leg-timer', 'exit-capacity', 'recovery']),
  fills: Object.freeze(['fill-identities', 'quantities', 'fees-spread-slippage', 'reconciliation', 'correlation']),
  pnl: Object.freeze(['directional', 'basis-convergence', 'funding', 'borrow-interest', 'fees', 'spread', 'slippage', 'one-leg-exposure', 'execution-recovery-error', 'net-result']),
  risk: Object.freeze(['envelope-revision', 'utilization-reservations', 'gross-net-unhedged', 'concentration', 'loss-drawdown', 'stale-data', 'liquidity-impact', 'ambiguity-recovery', 'gate-decisions', 'halt-posture']),
  health: Object.freeze(['lifecycle-capability', 'heartbeat-advance', 'source-event-processing-age', 'queue-drop-backpressure', 'reconnect-error', 'rest-latency-budget', 'q-latency-queue', 'db-ledger', 'host-runtime', 'backup-release-watchdog', 'root-blocker-action', 'deployment-frozen', 'exposure-state', 'ambiguity-state', 'recovery-state', 'ledger-schema-compatibility', 'ops-interlock']),
  'logs-ledger': Object.freeze(['event-class-severity', 'component-strategy-symbol', 'correlation', 'fingerprint', 'bounded-pagination', 'saved-filters', 'trace', 'redaction', 'retention', 'raw-debug']),
  notifications: Object.freeze(['fingerprint-dedup', 'causal-group', 'root-cause', 'severity-capital', 'first-last-count', 'state', 'owner-action', 'routing', 'correlation', 'silence-ack', 'recovery-proof']),
});

export function isFunctionalWiringState(state: ControlWiringState): boolean {
  return state === 'WIRED_LIVE' || state === 'WIRED_FIXTURE';
}

export function createFixtureSession(
  scenarioId: ProductFixtureScenarioId,
  sessionId: string,
  startedAtMs: number,
): ProductFixtureSession {
  return Object.freeze({
    scenarioId,
    sessionId,
    startedAtMs,
    nowMs: startedAtMs,
    tick: 0,
    controlRevision: 1,
    materialCursor: 1,
    desiredMode: scenarioId === 'HEALTHY_OBSERVE' || scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' ? 'READ_ONLY' : 'VALIDATE_ONLY',
    effectiveMode: scenarioId === 'TINY_LIVE_CANARY_OWNER_GATED' ? 'BLOCKED' : scenarioId === 'HEALTHY_OBSERVE' || scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' ? 'READ_ONLY' : 'VALIDATE_ONLY',
    killSwitchEngaged: scenarioId === 'RECOVERY_REQUIRED_ONE_LEG',
    intakePaused: scenarioId === 'RECOVERY_REQUIRED_ONE_LEG',
    lastResult: null,
    lastIdempotencyKey: null,
  });
}

export function advanceFixtureSession(
  session: Readonly<ProductFixtureSession>,
  nowMs: number,
): ProductFixtureSession {
  if (!Number.isFinite(nowMs) || nowMs < session.nowMs) {
    throw new Error('FIXTURE_CLOCK_MUST_BE_MONOTONIC');
  }
  const tick = Math.floor((nowMs - session.startedAtMs) / 5_000);
  const pending = session.lastResult;
  const lastResult = pending?.status === 'ACCEPTED_ASYNC' && nowMs - pending.completedAtMs >= 5_000
    ? Object.freeze({
        ...pending,
        status: 'APPLIED' as const,
        after: pending.controlId === 'recovery.execute-plan'
          ? 'RECOVERY_FIXTURE_RESOLVED'
          : 'RESTART_COMPLETED_SYNTHETIC',
        completedAtMs: nowMs,
      })
    : pending;
  return Object.freeze({
    ...session,
    nowMs,
    tick,
    materialCursor: nowMs === session.nowMs ? session.materialCursor : session.materialCursor + 1,
    lastResult,
  });
}

export function applyFixtureCommand(
  session: Readonly<ProductFixtureSession>,
  request: Readonly<ProductCommandRequest>,
): ProductFixtureSession {
  if (request.idempotencyKey === session.lastIdempotencyKey && session.lastResult) return session;
  const revision = `fixture-rev-${session.controlRevision}`;
  const control = buildFixtureControls(session, revision).find((entry) => entry.controlId === request.controlId);
  const preview = control?.preview;
  const payloadMatches = control ? stableScalarRecord(control.payload) === stableScalarRecord(request.payload) : false;
  const valid = request.schemaVersion === PRODUCT_COMMAND_SCHEMA
    && request.idempotencyKey.length > 0
    && request.idempotencyKey.length <= 500
    && control !== undefined
    && control.wiringState === 'WIRED_FIXTURE'
    && request.backendCommandId === control.backendCommandId
    && request.targetType === control.targetType
    && request.targetId === control.targetId
    && payloadMatches
    && request.currentRevision === revision
    && request.expectedRevision === revision
    && preview !== undefined
    && preview !== null
    && request.previewId === preview.previewId
    && request.previewDigest === preview.digest
    && request.expiresAtMs > session.nowMs;
  if (!valid) {
    const rejected: ProductControlResult = Object.freeze({
      commandId: `fixture-command-${session.sessionId}-rejected-${session.materialCursor + 1}`,
      controlId: request.controlId,
      status: request.expiresAtMs <= session.nowMs ? 'EXPIRED' : 'REJECTED_SCHEMA',
      before: control ? fixtureControlValue(session, control.controlId) : 'UNKNOWN',
      after: 'UNCHANGED',
      receiptId: null,
      correlationId: `fixture-correlation-${session.sessionId}`,
      completedAtMs: session.nowMs,
      synthetic: true,
    });
    return Object.freeze({
      ...session,
      materialCursor: session.materialCursor + 1,
      lastResult: rejected,
      lastIdempotencyKey: request.idempotencyKey || null,
    });
  }
  return applyFixtureControlInternal(session, request.controlId, request.expectedRevision, request.idempotencyKey);
}

export function applyFixtureControl(
  session: Readonly<ProductFixtureSession>,
  controlId: string,
  expectedRevision: string,
): ProductFixtureSession {
  return applyFixtureControlInternal(session, controlId, expectedRevision, null);
}

function applyFixtureControlInternal(
  session: Readonly<ProductFixtureSession>,
  controlId: string,
  expectedRevision: string,
  idempotencyKey: string | null,
): ProductFixtureSession {
  const expected = `fixture-rev-${session.controlRevision}`;
  const stale = expectedRevision !== expected;
  const nextRevision = stale ? session.controlRevision : session.controlRevision + 1;
  let desiredMode = session.desiredMode;
  let effectiveMode = session.effectiveMode;
  let killSwitchEngaged = session.killSwitchEngaged;
  let intakePaused = session.intakePaused;
  let before = fixtureControlValue(session, controlId);
  let after = before;
  let status: ControlResultStatus = stale ? 'REJECTED_STALE_REVISION' : 'APPLIED';

  if (!stale) {
    if (controlId === 'global.safe-mode') {
      desiredMode = session.desiredMode === 'READ_ONLY' ? 'ADVISORY' : session.desiredMode === 'ADVISORY' ? 'VALIDATE_ONLY' : 'READ_ONLY';
      effectiveMode = session.scenarioId === 'TINY_LIVE_CANARY_OWNER_GATED' ? 'BLOCKED' : desiredMode;
      after = `${desiredMode} / ${effectiveMode}`;
    } else if (controlId === 'global.kill-switch.engage') {
      killSwitchEngaged = !session.killSwitchEngaged;
      if (killSwitchEngaged) intakePaused = true;
      after = killSwitchEngaged ? 'ENGAGED / INTAKE_PAUSED' : 'CLEAR / INTAKE_REMAINS_PAUSED';
    } else if (controlId === 'global.intake') {
      intakePaused = !session.intakePaused;
      after = intakePaused ? 'PAUSED' : 'OPEN';
    } else if (controlId === 'component.restart') {
      after = 'RESTART_ACCEPTED_SYNTHETIC';
      status = 'ACCEPTED_ASYNC';
    } else if (controlId === 'recovery.execute-plan' && session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG') {
      after = 'RECOVERY_FIXTURE_ADVANCING';
      status = 'ACCEPTED_ASYNC';
    } else {
      status = 'REJECTED_NOT_SUPPORTED';
    }
  }

  const result: ProductControlResult = Object.freeze({
    commandId: `fixture-command-${session.sessionId}-${nextRevision}`,
    controlId,
    status,
    before,
    after,
    receiptId: stale ? null : `fixture-receipt-${session.sessionId}-${nextRevision}`,
    correlationId: `fixture-correlation-${session.sessionId}`,
    completedAtMs: session.nowMs,
    synthetic: true,
  });

  return Object.freeze({
    ...session,
    controlRevision: nextRevision,
    desiredMode,
    effectiveMode,
    killSwitchEngaged,
    intakePaused,
    lastResult: result,
    lastIdempotencyKey: idempotencyKey,
    materialCursor: session.materialCursor + 1,
  });
}

function stableScalarRecord(value: Readonly<Record<string, ProductCommandScalar>>): string {
  return JSON.stringify(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function fixtureControlValue(session: Readonly<ProductFixtureSession>, controlId: string): string {
  if (controlId === 'global.safe-mode') return `${session.desiredMode} / ${session.effectiveMode}`;
  if (controlId === 'global.kill-switch.engage') return session.killSwitchEngaged ? 'ENGAGED' : 'CLEAR';
  if (controlId === 'global.intake') return session.intakePaused ? 'PAUSED' : 'OPEN';
  if (controlId === 'component.restart') return 'READY';
  if (controlId === 'recovery.execute-plan') return session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' ? 'RECOVERY_REQUIRED' : 'UNAVAILABLE';
  return 'UNAVAILABLE';
}

export function buildFixtureManagedInventory(
  components: readonly Readonly<ProductComponentProjection>[],
): Readonly<ProductManagedInventoryProjection> {
  const identities = PRODUCT_MANAGED_INVENTORY_CONTRACT.map((entry) => entry.identity);
  const mappedCount = PRODUCT_MANAGED_INVENTORY_CONTRACT.filter((entry) => entry.canonicalComponentIds.length > 0).length;
  if (identities.length !== 33
    || new Set(identities).size !== identities.length
    || mappedCount !== 14
    || PRODUCT_MANAGED_CANONICAL_COMPONENT_IDS.length !== 14) {
    throw new TypeError('managed inventory fixture contract must remain the exact 33-role/14-component wire schema');
  }

  const evidenceById = new Map<string, Array<{ component: Readonly<ProductComponentProjection>; index: number }>>();
  for (const [index, component] of components.entries()) {
    const existing = evidenceById.get(component.componentId) ?? [];
    existing.push({ component, index });
    evidenceById.set(component.componentId, existing);
  }

  const entries = Object.freeze(PRODUCT_MANAGED_INVENTORY_CONTRACT.map((contract) => {
    const canonicalComponentIds = Object.freeze([...contract.canonicalComponentIds]);
    if (canonicalComponentIds.length === 0) {
      return Object.freeze({
        identity: contract.identity,
        owner: contract.owner,
        canonicalComponentIds,
        inventoryState: contract.unavailableState!,
        evidence: null,
        reasonCode: contract.unavailableReason!,
      });
    }
    const observations = canonicalComponentIds.map((componentId) => evidenceById.get(componentId) ?? []);
    if (observations.some((matches) => matches.length !== 1)) {
      return Object.freeze({
        identity: contract.identity,
        owner: contract.owner,
        canonicalComponentIds,
        inventoryState: 'MISSING' as const,
        evidence: null,
        reasonCode: observations.some((matches) => matches.length > 1)
          ? 'CANONICAL_COMPONENT_EVIDENCE_DUPLICATED'
          : 'CANONICAL_COMPONENT_EVIDENCE_MISSING',
      });
    }
    return Object.freeze({
      identity: contract.identity,
      owner: contract.owner,
      canonicalComponentIds,
      inventoryState: 'EVIDENCE_PRESENT' as const,
      evidence: Object.freeze(observations.map((matches) => Object.freeze({
        source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION' as const,
        componentId: matches[0]!.component.componentId,
        componentProjectionIndex: matches[0]!.index,
      }))),
      reasonCode: null,
    });
  }));

  const count = (state: ProductManagedInventoryState): number => (
    entries.filter((entry) => entry.inventoryState === state).length
  );
  const referencedCanonicalComponentCount = new Set(
    PRODUCT_MANAGED_INVENTORY_CONTRACT.flatMap((entry) => entry.canonicalComponentIds),
  ).size;
  return Object.freeze({
    schemaVersion: PRODUCT_MANAGED_INVENTORY_SCHEMA,
    expectedIdentityCount: 33,
    mappedIdentityCount: mappedCount,
    evidencePresentCount: count('EVIDENCE_PRESENT'),
    ownerGatedCount: count('OWNER_GATED'),
    notConfiguredCount: count('NOT_CONFIGURED'),
    missingCount: count('MISSING'),
    canonicalComponentCount: PRODUCT_MANAGED_CANONICAL_COMPONENT_IDS.length,
    referencedCanonicalComponentCount,
    observedCanonicalComponentCount: PRODUCT_MANAGED_CANONICAL_COMPONENT_IDS.filter((componentId) => (
      (evidenceById.get(componentId)?.length ?? 0) === 1
    )).length,
    entries,
  });
}

export function buildFixtureBinding<TDashboard>(
  session: Readonly<ProductFixtureSession>,
  dashboard: TDashboard,
): ProductSupervisorEnvelope<TDashboard> {
  const scenario = fixtureScenarioFacts(session);
  const revision = `fixture-rev-${session.controlRevision}`;
  const controls = buildFixtureControls(session, revision);
  const surfaces = Object.fromEntries(REQUIRED_SURFACE_IDS.map((surfaceId) => [
    surfaceId,
    Object.freeze({
      surfaceId,
      label: SURFACE_LABELS[surfaceId],
      bindingState: 'BINDING_READY',
      truthLabel: 'SYNTHETIC_ONLY',
      canonicalSource: SURFACE_SOURCES[surfaceId],
      evaluatedAtMs: session.nowMs,
      summary: `${SURFACE_LABELS[surfaceId]} fixture binding · ${scenario.summary}`,
      blocker: scenario.blocker,
      controlIds: controls.filter((control) => control.group === surfaceControlGroup(surfaceId)).map((control) => control.controlId),
      correlationId: `fixture-correlation-${session.sessionId}`,
      evidence: buildFixtureSurfaceEvidence(surfaceId, session, scenario, controls.length),
    } satisfies ProductSurfaceProjection),
  ])) as unknown as Record<SurfaceId, ProductSurfaceProjection>;

  const eventCursor = String(session.materialCursor);
  const previousCursor = String(session.materialCursor - 1);
  const ownerView: FiveSecondOwnerView = Object.freeze({
    processAlive: scenario.processAlive,
    machineReady: scenario.machineReady,
    tradeReady: 'NO',
    desiredMode: session.desiredMode,
    effectiveMode: session.effectiveMode,
    exposedCapital: scenario.exposedCapital,
    unresolvedRecovery: scenario.recovery,
    dataFreshness: scenario.freshness,
    topRootBlocker: scenario.blocker,
    activeOpportunity: scenario.opportunity,
    activeTicket: scenario.ticket,
    activePosition: scenario.position,
    latestMaterialChange: scenario.materialChange,
    revisions: Object.freeze({
      testedCommit: '692501587617d4880303fbd747d93e63c376f088',
      deployedCommit: null,
      modelRevision: scenario.modelRevision,
      configRevision: revision,
      schemaRevision: PRODUCT_SUPERVISOR_SCHEMA,
    }),
  });

  const materialEvents: MaterialEventPage = Object.freeze({
    schemaVersion: MATERIAL_CURSOR_SCHEMA,
    mode: 'TAIL_BOOTSTRAP',
    requestedAfterCursor: previousCursor,
    retainedFromCursor: '1',
    highWaterCursor: eventCursor,
    nextCursor: eventCursor,
    hasMore: false,
    continuity: 'PROVEN',
    truncated: false,
    backfillRequired: false,
    missingRange: previousCursor === '0' ? null : Object.freeze({
      fromCursor: '1',
      toCursor: previousCursor,
      reason: 'BOOTSTRAP_HISTORY_OMITTED',
    }),
    items: Object.freeze([Object.freeze({
      cursor: eventCursor,
      eventId: `fixture-event-${session.sessionId}-${eventCursor}`,
      occurredAtMs: session.nowMs,
      componentId: scenario.eventComponent,
      kind: scenario.eventKind,
      correlationId: `fixture-correlation-${session.sessionId}`,
      truthLabel: 'SYNTHETIC_ONLY',
    } satisfies MaterialEventProjection)]),
  });

  return Object.freeze({
    schemaVersion: PRODUCT_SUPERVISOR_SCHEMA,
    revision,
    digest: `SYNTHETIC_DIGEST:${session.sessionId}:${session.controlRevision}:${session.tick}`,
    evaluatedAtMs: session.nowMs,
    truthLabel: 'SYNTHETIC_ONLY',
    persistentSyntheticLabel: true,
    opsReadback: Object.freeze({
      source: 'CANONICAL_SUPERVISOR_READBACK',
      observedAtUtc: new Date(Math.floor(session.nowMs / 1_000) * 1_000).toISOString().replace('.000Z', 'Z'),
      validUntilUtc: new Date(Math.floor(session.nowMs / 1_000) * 1_000 + 10 * 60_000).toISOString().replace('.000Z', 'Z'),
      deploymentFrozen: 'UNKNOWN',
      exposureState: 'UNKNOWN',
      ambiguityState: 'UNKNOWN',
      recoveryState: 'UNKNOWN',
      currentSchemaVersion: null,
      rollbackFloor: null,
    }),
    opsIntakeInterlock: Object.freeze({
      source: 'CANONICAL_OPS_INTAKE_INTERLOCK',
      state: 'OPS_INTERLOCK_BLOCKED',
      blocksNewEntries: true,
      externalActionAuthorization: 'NONE',
      evaluatedAtUtc: new Date(Math.floor(session.nowMs / 1_000) * 1_000).toISOString().replace('.000Z', 'Z'),
      readbackValidUntilUtc: new Date(Math.floor(session.nowMs / 1_000) * 1_000 + 10 * 60_000).toISOString().replace('.000Z', 'Z'),
      reasonCodes: Object.freeze(['SYNTHETIC_ONLY']),
    }),
    ownerView,
    dashboard,
    components: scenario.components,
    managedInventory: buildFixtureManagedInventory(scenario.components),
    dependencyEdges: buildFixtureDependencyEdges(scenario.components),
    controls,
    traces: Object.freeze([buildFixtureTrace(session, scenario)]),
    incidentAvailability: Object.freeze({
      state: 'AVAILABLE',
      truthLabel: 'SYNTHETIC_ONLY',
      blocker: null,
    }),
    incidents: scenario.incidents,
    materialEvents,
    surfaces: Object.freeze(surfaces),
  });
}

interface FixtureScenarioFacts {
  readonly summary: string;
  readonly processAlive: FiveSecondOwnerView['processAlive'];
  readonly machineReady: FiveSecondOwnerView['machineReady'];
  readonly exposedCapital: string | null;
  readonly recovery: string | null;
  readonly freshness: string | null;
  readonly blocker: string | null;
  readonly opportunity: string | null;
  readonly ticket: string | null;
  readonly position: string | null;
  readonly materialChange: string;
  readonly modelRevision: string | null;
  readonly eventComponent: string;
  readonly eventKind: string;
  readonly components: readonly Readonly<ProductComponentProjection>[];
  readonly incidents: readonly Readonly<ProductIncidentProjection>[];
}

function fixtureScenarioFacts(session: Readonly<ProductFixtureSession>): FixtureScenarioFacts {
  const tickPhase = Math.min(session.tick, 3);
  const base = baseFixtureComponents(session.nowMs, session.scenarioId);
  if (session.scenarioId === 'DEGRADED_STALE_SOURCES') {
    return {
      summary: 'Stale public source blocks dependent readiness',
      processAlive: 'YES', machineReady: 'NO', exposedCapital: null, recovery: 'NONE',
      freshness: `${35 + tickPhase * 5}s stale`, blocker: 'SOURCE_STALE:public-usdm-source',
      opportunity: null, ticket: null, position: null,
      materialChange: tickPhase < 2 ? 'USD-M source entered backoff' : 'Resubscription remains pending',
      modelRevision: 'fixture-model-stale', eventComponent: 'public-usdm-source', eventKind: 'source-stale',
      components: base.map((component) => component.componentId === 'public-usdm-source' ? Object.freeze({ ...component, observedLifecycle: 'DEGRADED', blockerCode: 'SOURCE_STALE', sourceAgeMs: 35_000 + tickPhase * 5_000 }) : component),
      incidents: Object.freeze([fixtureIncident(session, 'HIGH', 'public-usdm-source', 'SOURCE_STALE', false)]),
    };
  }
  if (session.scenarioId === 'VALIDATE_ONLY_SLICE_RUNNING') {
    return {
      summary: 'Validate-only chain advances without exchange mutation',
      processAlive: 'YES', machineReady: 'YES', exposedCapital: '0.00 USDT', recovery: 'NONE',
      freshness: `${2 + tickPhase}s`, blocker: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
      opportunity: 'fixture-opportunity-basis-01', ticket: `fixture-ticket-${tickPhase + 1}`, position: null,
      materialChange: ['Evidence sealed', 'Capital capped fixture', 'Risk validated fixture', 'Reconciliation converged fixture'][tickPhase],
      modelRevision: 'fixture-model-validate', eventComponent: 'execution-coordinator-validate-only', eventKind: `validate-stage-${tickPhase + 1}`,
      components: base, incidents: Object.freeze([]),
    };
  }
  if (session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG') {
    const recoveryResolved = session.lastResult?.controlId === 'recovery.execute-plan'
      && session.lastResult.status === 'APPLIED';
    if (recoveryResolved) {
      return {
        summary: 'Synthetic one-leg recovery completed and exposure is clear',
        processAlive: 'YES', machineReady: 'YES', exposedCapital: '0.00 USDT SYNTHETIC', recovery: 'NONE',
        freshness: `${1 + tickPhase}s`, blocker: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
        opportunity: null, ticket: 'fixture-ticket-recovery-01', position: null,
        materialChange: 'Synthetic recovery fixture resolved',
        modelRevision: 'fixture-model-recovery', eventComponent: 'reconciliation', eventKind: 'recovery-resolved',
        components: base, incidents: Object.freeze([]),
      };
    }
    return {
      summary: 'One synthetic leg is exposed and recovery is primary',
      processAlive: 'YES', machineReady: 'NO', exposedCapital: '4.80 USDT SYNTHETIC', recovery: 'ONE_LEG_EXPOSED',
      freshness: `${1 + tickPhase}s`, blocker: 'RECOVERY_REQUIRED_ONE_LEG',
      opportunity: 'fixture-opportunity-recovery-01', ticket: 'fixture-ticket-recovery-01', position: 'fixture-position-leg-a',
      materialChange: tickPhase < 2 ? 'Leg A fixture fill observed' : 'Recovery fixture awaiting owner action',
      modelRevision: 'fixture-model-recovery', eventComponent: 'reconciliation', eventKind: 'recovery-required',
      components: base.map((component) => component.componentId === 'reconciliation' ? Object.freeze({ ...component, observedLifecycle: 'RECOVERY_REQUIRED', capitalRelevance: 'RECOVERY', blockerCode: 'ONE_LEG_EXPOSED' }) : component),
      incidents: Object.freeze([fixtureIncident(session, 'CRITICAL', 'reconciliation', 'ONE_LEG_EXPOSED', true)]),
    };
  }
  if (session.scenarioId === 'TINY_LIVE_CANARY_OWNER_GATED') {
    return {
      summary: 'Tiny-live canary remains owner-gated and unavailable',
      processAlive: 'YES', machineReady: 'NO', exposedCapital: '0.00 USDT', recovery: 'NONE',
      freshness: `${2 + tickPhase}s`, blocker: 'OWNER_AUTHORIZATION_REQUIRED',
      opportunity: 'fixture-canary-candidate-01', ticket: null, position: null,
      materialChange: 'Canary preview remains blocked before command submission',
      modelRevision: 'fixture-model-canary', eventComponent: 'capital-supervision', eventKind: 'owner-gate-held',
      components: base, incidents: Object.freeze([fixtureIncident(session, 'MEDIUM', 'capital-supervision', 'OWNER_AUTHORIZATION_REQUIRED', false)]),
    };
  }
  return {
    summary: 'Healthy observation fixture with no capital authority',
    processAlive: 'YES', machineReady: 'YES', exposedCapital: '0.00 USDT', recovery: 'NONE',
    freshness: `${1 + tickPhase}s`, blocker: null,
    opportunity: null, ticket: null, position: null,
    materialChange: ['Supervisor fixture advanced', 'Sources fixture advanced', 'Engines fixture advanced', 'Ledger fixture advanced'][tickPhase],
    modelRevision: 'fixture-model-observe', eventComponent: 'machine-supervisor', eventKind: 'fixture-heartbeat',
    components: base, incidents: Object.freeze([]),
  };
}

function baseFixtureComponents(nowMs: number, scenarioId: ProductFixtureScenarioId): readonly Readonly<ProductComponentProjection>[] {
  const ids = ['public-spot-source', 'public-usdm-source', 'market-universe', 'intelligence-runtime', 'market-intelligence', 'q-inference', 'basis-engine', 'volume-engine', 'capital-supervision', 'multileg-risk', 'execution-coordinator-validate-only', 'reconciliation', 'ledger-persistence', 'engine-supervisor'];
  return Object.freeze(ids.map((componentId, index) => Object.freeze({
    componentId,
    owner: fixtureOwner(componentId),
    desiredLifecycle: 'READY',
    observedLifecycle: 'READY',
    capability: componentId.includes('execution') || componentId === 'multileg-risk' || componentId === 'reconciliation' ? 'DRY_RUN' : 'SYNTHETIC',
    heartbeatAtMs: nowMs - 1_000 - index * 20,
    lastAdvanceAtMs: nowMs - 800 - index * 20,
    sourceAgeMs: componentId.includes('source') ? 1_000 : null,
    eventAgeMs: 1_000 + index * 10,
    processingAgeMs: 200 + index * 5,
    queueDepth: index % 3,
    queueCapacity: 100,
    droppedCount: 0,
    blockerCode: null,
    rootCauseComponentId: null,
    capitalRelevance: scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' && componentId === 'reconciliation' ? 'RECOVERY' : 'NONE',
    supportedControlIds: ['component.restart'],
    correlationId: null,
    truthLabel: 'SYNTHETIC_ONLY',
  } satisfies ProductComponentProjection)));
}

function fixtureOwner(componentId: string): string {
  if (componentId === 'q-inference') return 'quant/src/quant_edge/inference/**';
  if (componentId.includes('basis') || componentId.includes('volume')) return 'server/src/engine/**';
  if (componentId.includes('capital')) return 'server/src/capitalFoundation/**';
  if (componentId.includes('risk') || componentId.includes('execution') || componentId === 'reconciliation') return 'server/src/foundation/**';
  if (componentId === 'ledger-persistence') return 'server/src/ledger.ts';
  return 'server/src/systemIntegration/**';
}

function buildFixtureDependencyEdges(
  components: readonly Readonly<ProductComponentProjection>[],
): readonly Readonly<ProductDependencyEdgeProjection>[] {
  const ordered = components.map((component) => component.componentId);
  return Object.freeze(ordered.slice(1).map((componentId, index) => {
    const root = components.find((component) => component.observedLifecycle === 'DEGRADED' || component.observedLifecycle === 'BLOCKED' || component.observedLifecycle === 'RECOVERY_REQUIRED');
    return Object.freeze({
      fromComponentId: ordered[index],
      toComponentId: componentId,
      required: true,
      state: root && (root.componentId === ordered[index] || root.componentId === componentId) ? 'BLOCKED' : 'AVAILABLE',
      rootCauseComponentId: root?.componentId ?? null,
      reasonCodes: Object.freeze(root?.blockerCode ? [root.blockerCode] : []),
    } satisfies ProductDependencyEdgeProjection);
  }));
}

function fixtureIncident(
  session: Readonly<ProductFixtureSession>,
  severity: ProductIncidentProjection['severity'],
  rootComponentId: string,
  reasonCode: string,
  capitalRelevant: boolean,
): ProductIncidentProjection {
  return Object.freeze({
    fingerprint: `fixture:${rootComponentId}:${reasonCode}`,
    severity, rootComponentId, capitalRelevant,
    firstSeenAtMs: session.startedAtMs,
    lastSeenAtMs: session.nowMs,
    count: Math.max(1, session.tick + 1),
    state: 'OPEN', reasonCode,
    operatorAction: capitalRelevant ? 'Inspect the synthetic recovery control.' : 'Inspect the synthetic source/control evidence.',
    correlationId: `fixture-correlation-${session.sessionId}`,
  });
}

function buildFixtureControls(
  session: Readonly<ProductFixtureSession>,
  revision: string,
): readonly Readonly<ProductControlRegistryEntry>[] {
  const preview = (controlId: string, consequence: string): ProductControlPreview => Object.freeze({
    previewId: `fixture-preview-${session.sessionId}-${controlId}-${session.controlRevision}`,
    controlId,
    expectedRevision: revision,
    digest: `SYNTHETIC_DIGEST:${controlId}:${revision}`,
    consequence,
    expiresAtMs: session.nowMs + 30_000,
    synthetic: true,
  });
  const entries: ProductControlRegistryEntry[] = [
    {
      controlId: 'global.safe-mode', backendCommandId: 'SET_SAFE_MODE', wiringState: 'WIRED_FIXTURE', owner: 'foundation/control',
      targetType: 'SYSTEM', targetId: 'machine', payload: { safeMode: session.desiredMode === 'READ_ONLY' ? 'ADVISORY' : session.desiredMode === 'ADVISORY' ? 'VALIDATE_ONLY' : 'READ_ONLY' },
      payloadSchema: '{ safeMode: READ_ONLY | ADVISORY | VALIDATE_ONLY }', payloadEnumeration: ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'], defaultValue: 'READ_ONLY',
      currentStateRevision: revision, group: 'Global Posture', label: 'Safe Mode',
      explanation: 'Changes fixture desired mode; live authority is never granted.', safeBounds: 'READ_ONLY | ADVISORY | VALIDATE_ONLY',
      currentDesiredValue: session.desiredMode, currentEffectiveValue: session.effectiveMode, authority: 'FIXTURE_OPERATOR', effect: 'IMMEDIATE',
      requiredPosture: 'PROCESS_ALIVE', expiryPolicy: 'Preview expires after 30 seconds.', reversibility: 'Reversible within the safe-mode enumeration.', invariants: ['Never grants live authority.'], effectTelemetry: ['control revision', 'desired/effective mode'],
      confirmationText: 'Confirm the synthetic mode revision.', disabledReason: null,
      preview: preview('global.safe-mode', 'Cycles the synthetic safe mode within the frozen three-mode vocabulary.'), latestResult: resultFor(session, 'global.safe-mode'),
    },
    {
      controlId: 'global.kill-switch.engage', backendCommandId: 'SET_KILL_SWITCH', wiringState: 'WIRED_FIXTURE', owner: 'foundation/control',
      targetType: 'SYSTEM', targetId: 'machine', payload: { engaged: !session.killSwitchEngaged }, currentStateRevision: revision,
      payloadSchema: '{ engaged: boolean }', payloadEnumeration: [false, true], defaultValue: true,
      group: 'Global Posture', label: 'Kill Switch',
      explanation: 'Engaging blocks synthetic new risk and also pauses intake.', safeBounds: 'CLEAR | ENGAGED',
      currentDesiredValue: session.killSwitchEngaged ? 'ENGAGED' : 'CLEAR', currentEffectiveValue: session.killSwitchEngaged ? 'ENGAGED' : 'CLEAR', authority: 'FIXTURE_OPERATOR', effect: 'IMMEDIATE',
      requiredPosture: 'PROCESS_ALIVE', expiryPolicy: 'Preview expires after 30 seconds.', reversibility: 'Reversible; release never resumes intake.', invariants: ['Engage also pauses intake.', 'Release does not resume intake.'], effectTelemetry: ['kill posture', 'intake posture', 'control revision'],
      confirmationText: 'Confirm the fail-closed synthetic kill posture.', disabledReason: null,
      preview: preview('global.kill-switch.engage', 'Engaging also pauses fixture intake; releasing does not resume intake automatically.'), latestResult: resultFor(session, 'global.kill-switch.engage'),
    },
    {
      controlId: 'global.intake', backendCommandId: 'SET_INTAKE_PAUSED', wiringState: 'WIRED_FIXTURE', owner: 'foundation/control',
      targetType: 'SYSTEM', targetId: 'machine', payload: { paused: !session.intakePaused }, currentStateRevision: revision,
      payloadSchema: '{ paused: boolean }', payloadEnumeration: [false, true], defaultValue: true,
      group: 'Global Posture', label: 'Proposal Intake',
      explanation: 'Pauses or resumes synthetic proposal intake without hiding recovery.', safeBounds: 'OPEN | PAUSED',
      currentDesiredValue: session.intakePaused ? 'PAUSED' : 'OPEN', currentEffectiveValue: session.intakePaused ? 'PAUSED' : 'OPEN', authority: 'FIXTURE_OPERATOR', effect: 'IMMEDIATE',
      requiredPosture: 'NO_NEW_EXPOSURE', expiryPolicy: 'Preview expires after 30 seconds.', reversibility: 'Reversible unless another fail-closed gate holds intake.', invariants: ['Recovery remains visible while paused.'], effectTelemetry: ['intake posture', 'control revision'],
      confirmationText: 'Confirm the synthetic intake revision.', disabledReason: null,
      preview: preview('global.intake', 'Changes only the synthetic intake gate.'), latestResult: resultFor(session, 'global.intake'),
    },
    {
      controlId: 'component.restart', backendCommandId: 'RESTART_COMPONENT', wiringState: 'WIRED_FIXTURE', owner: 'foundation/control',
      targetType: 'COMPONENT', targetId: 'engine-supervisor', payload: { componentId: 'engine-supervisor' }, currentStateRevision: revision,
      payloadSchema: '{ componentId: registered component ID }', payloadEnumeration: ['engine-supervisor'], defaultValue: 'engine-supervisor',
      group: 'Component Lifecycle', label: 'Safe Component Restart',
      explanation: 'Exercises the asynchronous fixture command lifecycle.', safeBounds: 'registered fixture component IDs only',
      currentDesiredValue: 'READY', currentEffectiveValue: 'READY', authority: 'FIXTURE_OPERATOR', effect: 'RESTART',
      requiredPosture: 'NO_CAPITAL_EXPOSED', expiryPolicy: 'Preview expires after 30 seconds.', reversibility: 'Not reversible; restart is asynchronous.', invariants: ['Registered component IDs only.', 'No process mutation in fixtures.'], effectTelemetry: ['component lifecycle', 'restart receipt', 'generation'],
      confirmationText: 'Confirm the synthetic component restart.', disabledReason: null,
      preview: preview('component.restart', 'Advances a synthetic restart receipt; no process is restarted.'), latestResult: resultFor(session, 'component.restart'),
    },
    {
      controlId: 'recovery.execute-plan', backendCommandId: 'EXECUTE_RECOVERY_PLAN',
      wiringState: session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' ? 'WIRED_FIXTURE' : 'PENDING_BACKEND:EXECUTE_RECOVERY_PLAN',
      owner: 'foundation/execution', targetType: 'RECOVERY_PLAN', targetId: 'fixture-recovery-plan-01',
      payload: { planId: 'fixture-recovery-plan-01' }, currentStateRevision: revision,
      payloadSchema: '{ planId: exact precomputed recovery plan ID }', payloadEnumeration: ['fixture-recovery-plan-01'], defaultValue: null,
      group: 'Recovery', label: 'Execute Recovery Plan',
      explanation: 'Risk-reducing recovery remains separate from entry authority.', safeBounds: 'exact precomputed recovery plan only',
      currentDesiredValue: session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' ? 'RECOVERY_REQUIRED' : 'UNAVAILABLE',
      currentEffectiveValue: session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' ? 'AWAITING_FIXTURE_CONFIRMATION' : 'UNAVAILABLE',
      authority: session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' ? 'FIXTURE_OPERATOR' : 'FOUNDATION_OWNER_REQUIRED', effect: 'IMMEDIATE',
      requiredPosture: 'RECOVERY_REQUIRED', expiryPolicy: 'Preview expires after 30 seconds.', reversibility: 'Not reversible after accepted execution.', invariants: ['Risk-reducing only.', 'Exact plan identity and revision required.'], effectTelemetry: ['recovery lifecycle', 'exposed capital', 'reconciliation incident'],
      confirmationText: 'Confirm the exact synthetic recovery plan.',
      disabledReason: session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' ? null : 'No recovery owner command is mounted in this scenario.',
      preview: session.scenarioId === 'RECOVERY_REQUIRED_ONE_LEG' ? preview('recovery.execute-plan', 'Advances only the synthetic one-leg recovery lifecycle.') : null,
      latestResult: resultFor(session, 'recovery.execute-plan'),
    },
    {
      controlId: 'canary.request', backendCommandId: 'REQUEST_TINY_LIVE_CANARY', wiringState: 'OWNER_GATED', owner: 'I00 director + external authorization',
      targetType: 'TICKET', targetId: 'UNAVAILABLE', payload: {}, currentStateRevision: revision,
      payloadSchema: 'UNAVAILABLE', payloadEnumeration: [], defaultValue: null,
      group: 'Capital Authority', label: 'Tiny Live Canary',
      explanation: 'A canary requires a separate durable owner authorization and is never enabled by this package.', safeBounds: '10 USDT aggregate | 1 ticket | 2 USDT loss | no repeat',
      currentDesiredValue: 'DISARMED', currentEffectiveValue: 'OWNER_GATED', authority: 'EXTERNAL_OWNER_AUTHORIZATION_REQUIRED', effect: 'IMMEDIATE',
      requiredPosture: 'EXTERNAL_OWNER_AUTHORIZATION + PRIVATE_TRUTH + SIGNED_VALIDATION', expiryPolicy: 'No preview is issued.', reversibility: 'UNAVAILABLE', invariants: ['No automatic capital authority.', 'No fixture may enable this control.'], effectTelemetry: ['UNAVAILABLE'],
      confirmationText: 'Unavailable in fixture and unmounted product paths.', disabledReason: 'Owner authorization, private truth, signed validation, and director mounting are absent.',
      preview: null, latestResult: null,
    },
  ];
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

function resultFor(session: Readonly<ProductFixtureSession>, controlId: string): Readonly<ProductControlResult> | null {
  return session.lastResult?.controlId === controlId ? session.lastResult : null;
}

function buildFixtureTrace(session: Readonly<ProductFixtureSession>, scenario: FixtureScenarioFacts): ProductCorrelationTrace {
  const correlationId = `fixture-correlation-${session.sessionId}`;
  const stages = PRODUCT_TRACE_STAGES;
  return Object.freeze({
    correlationId,
    symbol: session.scenarioId === 'HEALTHY_OBSERVE' ? null : 'FIXTUREUSDT',
    truncated: false,
    completeness: 'COMPLETE',
    stages: Object.freeze(stages.map((stage, index) => Object.freeze({
      stage,
      owner: fixtureTraceOwner(index),
      referenceId: index <= Math.min(session.tick, stages.length - 1) ? `fixture-ref-${index + 1}` : null,
      occurredAtMs: index <= Math.min(session.tick, stages.length - 1) ? session.startedAtMs + index * 250 : null,
      outcome: index <= Math.min(session.tick, stages.length - 1) ? scenario.eventKind : 'NO_EVENT_PUBLISHED',
      truthLabel: index <= Math.min(session.tick, stages.length - 1) ? 'SYNTHETIC_ONLY' : 'MISSING',
      evidenceState: index <= Math.min(session.tick, stages.length - 1) ? 'PRESENT' : 'ABSENT',
    } satisfies ProductTraceStage))),
  });
}

function fixtureTraceOwner(index: number): string {
  if (index <= 2) return 'intelligenceFoundation / intelligenceRuntime';
  if (index === 3) return 'Q advisory';
  if (index === 4) return 'Basis / Volume owner';
  if (index === 5 || index >= 9) return 'capitalFoundation';
  return 'foundation';
}

function surfaceControlGroup(surfaceId: SurfaceId): string {
  if (surfaceId === 'control-room' || surfaceId === 'health') return 'Component Lifecycle';
  if (surfaceId === 'risk' || surfaceId === 'dashboard') return 'Global Posture';
  if (surfaceId === 'execution' || surfaceId === 'positions') return 'Recovery';
  return '';
}

function buildFixtureSurfaceEvidence(
  surfaceId: SurfaceId,
  session: Readonly<ProductFixtureSession>,
  scenario: Readonly<FixtureScenarioFacts>,
  controlCount: number,
): readonly Readonly<ProductSurfaceDatum>[] {
  const known: Readonly<Record<string, string | null>> = Object.freeze({
    'overall-posture': scenario.machineReady === 'YES' ? 'READY · SYNTHETIC' : 'BLOCKED · SYNTHETIC',
    startup: `FIXTURE TICK ${session.tick}`,
    revisions: `fixture-rev-${session.controlRevision}`,
    mode: `${session.desiredMode} / ${session.effectiveMode}`,
    capital: scenario.exposedCapital,
    'active-objects': [scenario.opportunity, scenario.ticket, scenario.position].filter(Boolean).join(' · ') || 'NONE',
    'root-blocker': scenario.blocker,
    'material-decisions': scenario.materialChange,
    'machine-graph': `${scenario.components.length} canonical components`,
    'control-registry': `${controlCount} versioned controls`,
    'async-progress': session.lastResult?.status ?? 'NO_ACTIVE_COMMAND',
    correlation: `fixture-correlation-${session.sessionId}`,
    'available-capital': scenario.exposedCapital === null ? null : '0.00 USDT SYNTHETIC',
    'orders-positions': scenario.position ?? 'NONE',
    'freshness-completeness': scenario.freshness,
    'source-freshness': scenario.freshness,
    'candidate-focus': scenario.opportunity ?? 'NONE',
    'ticket-position': [scenario.ticket, scenario.position].filter(Boolean).join(' · ') || 'NONE',
    'execution-recovery': scenario.recovery ?? 'NONE',
    'proposal-ticket': scenario.ticket,
    'ticket-leg-state': scenario.ticket,
    'ticket-position-link': [scenario.ticket, scenario.position].filter(Boolean).join(' · ') || null,
    'one-leg-timer': scenario.recovery === 'ONE_LEG_EXPOSED' ? `${Math.max(0, session.nowMs - session.startedAtMs)}ms SYNTHETIC` : 'NONE',
    recovery: scenario.recovery ?? 'NONE',
    'net-result': '0.00 USDT SYNTHETIC',
    'halt-posture': scenario.blocker ?? 'NO FIXTURE HALT',
    'lifecycle-capability': `${scenario.components.length} synthetic component projections`,
    'heartbeat-advance': scenario.freshness,
    'source-event-processing-age': scenario.freshness,
    'root-blocker-action': scenario.blocker,
    'deployment-frozen': 'UNKNOWN_FROZEN',
    'exposure-state': 'UNKNOWN',
    'ambiguity-state': 'UNKNOWN',
    'recovery-state': 'UNKNOWN',
    'ledger-schema-compatibility': null,
    'ops-interlock': 'OPS_INTERLOCK_BLOCKED',
    'bounded-pagination': 'CURSOR BOUNDED · LIMIT 200',
    fingerprint: `fixture:${scenario.eventComponent}:${scenario.eventKind}`,
    'fingerprint-dedup': `${scenario.incidents.length} grouped incident(s)`,
    'severity-capital': scenario.incidents[0]?.severity ?? 'NONE',
    'first-last-count': scenario.incidents.length ? `${session.startedAtMs} / ${session.nowMs} / ${Math.max(1, session.tick + 1)}` : 'NONE',
    state: scenario.incidents[0]?.state ?? 'NONE',
    'owner-action': scenario.incidents[0]?.operatorAction ?? 'NONE',
    'recovery-proof': scenario.recovery ?? 'NO RECOVERY ACTIVE',
  });
  return Object.freeze(REQUIRED_SURFACE_EVIDENCE[surfaceId].map((fieldId) => {
    const value = Object.prototype.hasOwnProperty.call(known, fieldId) ? known[fieldId] : null;
    return Object.freeze({
      fieldId,
      label: fieldId.replaceAll('-', ' '),
      value,
      truthLabel: value === null ? 'MISSING' : 'SYNTHETIC_ONLY',
      canonicalSource: `${SURFACE_SOURCES[surfaceId]}:${fieldId}`,
      unavailableReason: value === null ? 'NOT_PUBLISHED_BY_FIXTURE_CONTRACT' : null,
    } satisfies ProductSurfaceDatum);
  }));
}

export function validateMaterialEventPage(
  previousCursor: string,
  value: unknown,
  expectedMode: MaterialEventPage['mode'] = 'CURSOR',
): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return Object.freeze(['MATERIAL_PAGE_INVALID']);
  const page = value;
  if (page.schemaVersion !== MATERIAL_CURSOR_SCHEMA) errors.push('MATERIAL_CURSOR_SCHEMA_UNSUPPORTED');
  if (page.mode !== expectedMode) errors.push('MATERIAL_PAGE_MODE_MISMATCH');
  const requestedAfterCursor = typeof page.requestedAfterCursor === 'string' ? page.requestedAfterCursor : '';
  const retainedFromCursor = typeof page.retainedFromCursor === 'string' ? page.retainedFromCursor : null;
  const highWaterCursor = typeof page.highWaterCursor === 'string' ? page.highWaterCursor : '';
  const nextCursor = typeof page.nextCursor === 'string' ? page.nextCursor : '';
  if (!isDecimalCursor(previousCursor) || !isDecimalCursor(requestedAfterCursor)
    || !(page.retainedFromCursor === null || (typeof page.retainedFromCursor === 'string' && isPositiveDecimalCursor(page.retainedFromCursor)))
    || !isDecimalCursor(highWaterCursor) || !isDecimalCursor(nextCursor)) errors.push('MATERIAL_CURSOR_INVALID');
  if (page.requestedAfterCursor !== previousCursor) errors.push('MATERIAL_CURSOR_REQUEST_MISMATCH');
  if (page.continuity !== 'PROVEN') errors.push(page.continuity === 'GAP' ? 'MATERIAL_CURSOR_GAP' : 'MATERIAL_CURSOR_UNPROVEN');
  if (page.truncated !== false || page.backfillRequired !== false) errors.push('MATERIAL_BACKFILL_REQUIRED');
  if (typeof page.hasMore !== 'boolean') errors.push('MATERIAL_HAS_MORE_INVALID');
  if (page.missingRange !== null) {
    if (!isRecord(page.missingRange)
      || typeof page.missingRange.fromCursor !== 'string' || !isPositiveDecimalCursor(page.missingRange.fromCursor)
      || typeof page.missingRange.toCursor !== 'string' || !isPositiveDecimalCursor(page.missingRange.toCursor)
      || !['RETENTION_GAP', 'INTERIOR_GAP', 'EVIDENCE_UNPROVEN', 'BOOTSTRAP_HISTORY_OMITTED'].includes(String(page.missingRange.reason))) {
      errors.push('MATERIAL_MISSING_RANGE_INVALID');
    } else if (expectedMode === 'CURSOR'
      || !['BOOTSTRAP_HISTORY_OMITTED', 'RETENTION_GAP'].includes(String(page.missingRange.reason))) {
      errors.push('MATERIAL_BACKFILL_REQUIRED');
    }
  }
  const items = Array.isArray(page.items) ? page.items : [];
  if (!Array.isArray(page.items)) errors.push('MATERIAL_ITEMS_INVALID');
  if (items.length > 500) errors.push('MATERIAL_ITEMS_OUT_OF_BOUNDS');
  if (!errors.includes('MATERIAL_CURSOR_INVALID') && !errors.includes('MATERIAL_ITEMS_INVALID') && !errors.includes('MATERIAL_ITEMS_OUT_OF_BOUNDS')) {
    const previous = BigInt(previousCursor);
    const retained = retainedFromCursor === null ? null : BigInt(retainedFromCursor);
    const highWater = BigInt(highWaterCursor);
    const next = BigInt(nextCursor);
    const tailRetentionLoss = expectedMode === 'TAIL_BOOTSTRAP' && retained !== null && retained > 1n;
    if (tailRetentionLoss && (page.continuity === 'PROVEN'
      || page.truncated !== true
      || page.backfillRequired !== true)) {
      errors.push('MATERIAL_RETENTION_STATE_CONTRADICTION');
    }
    if (previous > highWater || next < previous || next > highWater || (retained !== null && retained > highWater)) {
      errors.push('MATERIAL_CURSOR_GEOMETRY_INVALID');
    }
    if (retained === null && highWater > 0n) errors.push('MATERIAL_RETENTION_UNPROVEN');
    let expected = BigInt(previousCursor) + 1n;
    for (const item of items) {
      if (!isRecord(item) || typeof item.cursor !== 'string' || !isDecimalCursor(item.cursor) || BigInt(item.cursor) !== expected) {
        errors.push('MATERIAL_CURSOR_NOT_GAP_FREE');
        break;
      }
      if (typeof item.eventId !== 'string' || item.eventId.length === 0
        || typeof item.occurredAtMs !== 'number' || !Number.isFinite(item.occurredAtMs)
        || typeof item.componentId !== 'string' || item.componentId.length === 0
        || typeof item.kind !== 'string' || item.kind.length === 0
        || !isStringOrNull(item.correlationId)
        || !isProductTruthLabel(item.truthLabel)) errors.push('MATERIAL_EVENT_INVALID');
      expected += 1n;
    }
    const lastItem = items.length ? items[items.length - 1] : null;
    const expectedNext = isRecord(lastItem) && typeof lastItem.cursor === 'string' ? lastItem.cursor : previousCursor;
    if (nextCursor !== expectedNext) errors.push('MATERIAL_NEXT_CURSOR_MISMATCH');
    const shouldHaveMore = next < highWater;
    if (page.hasMore !== shouldHaveMore) errors.push('MATERIAL_HAS_MORE_MISMATCH');
    if (shouldHaveMore && next === previous) errors.push('MATERIAL_CURSOR_NO_PROGRESS');
    if (!shouldHaveMore && next !== highWater) errors.push('MATERIAL_HIGH_WATER_MISMATCH');
    if (expectedMode === 'TAIL_BOOTSTRAP' && previous > 0n && page.missingRange === null) {
      errors.push('MATERIAL_BOOTSTRAP_RANGE_MISSING');
    }
    if (page.missingRange !== null && isRecord(page.missingRange)
      && typeof page.missingRange.fromCursor === 'string' && isPositiveDecimalCursor(page.missingRange.fromCursor)
      && typeof page.missingRange.toCursor === 'string' && isPositiveDecimalCursor(page.missingRange.toCursor)
      && ['BOOTSTRAP_HISTORY_OMITTED', 'RETENTION_GAP'].includes(String(page.missingRange.reason))) {
      const exactTailRange = expectedMode === 'TAIL_BOOTSTRAP'
        && page.missingRange.fromCursor === '1'
        && BigInt(page.missingRange.toCursor) === previous;
      if (!exactTailRange) errors.push('MATERIAL_BOOTSTRAP_RANGE_INVALID');
      if (page.missingRange.reason === 'RETENTION_GAP'
        && (retained === null || previous !== retained - 1n)) errors.push('MATERIAL_RETENTION_RANGE_INVALID');
      if (page.missingRange.reason === 'BOOTSTRAP_HISTORY_OMITTED'
        && retained !== null && retained > 1n) errors.push('MATERIAL_BOOTSTRAP_REASON_INVALID');
    }
  }
  return Object.freeze(Array.from(new Set(errors)));
}

function isDecimalCursor(value: string): boolean {
  return /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

function isPositiveDecimalCursor(value: string): boolean {
  return isDecimalCursor(value) && value !== '0';
}

export function validateProductCorrelationTrace(value: unknown, expectedCorrelationId?: string): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value) || !Array.isArray(value.stages)) return Object.freeze(['TRACE_ENTRY_INVALID']);
  if (typeof value.correlationId !== 'string' || !PRODUCT_TRACE_ID.test(value.correlationId)) {
    errors.push('TRACE_CORRELATION_ID_INVALID');
  } else if (expectedCorrelationId !== undefined && value.correlationId !== expectedCorrelationId) {
    errors.push('TRACE_CORRELATION_ID_MISMATCH');
  }
  if (!isStringOrNull(value.symbol)) errors.push('TRACE_SYMBOL_INVALID');
  if (typeof value.truncated !== 'boolean'
    || !['COMPLETE', 'TRUNCATED'].includes(String(value.completeness))
    || (value.truncated === true) !== (value.completeness === 'TRUNCATED')) errors.push('TRACE_COMPLETENESS_INVALID');
  if (value.stages.length !== PRODUCT_TRACE_STAGES.length) errors.push('TRACE_STAGE_COUNT_INVALID');
  for (const [index, stage] of value.stages.entries()) {
    if (!isRecord(stage)
      || typeof stage.stage !== 'string' || stage.stage.length === 0
      || typeof stage.owner !== 'string' || stage.owner.length === 0
      || !isStringOrNull(stage.referenceId)
      || !isFiniteNumberOrNull(stage.occurredAtMs)
      || typeof stage.outcome !== 'string' || stage.outcome.length === 0
      || !isProductTruthLabel(stage.truthLabel)
      || !['PRESENT', 'ABSENT', 'UNKNOWN_DUE_TO_TRUNCATION'].includes(String(stage.evidenceState))) {
      errors.push('TRACE_STAGE_INVALID');
      continue;
    }
    if (stage.stage !== PRODUCT_TRACE_STAGES[index]) errors.push('TRACE_STAGE_ORDER_INVALID');
    if (stage.evidenceState === 'PRESENT' && (stage.referenceId === null || stage.occurredAtMs === null)) {
      errors.push('TRACE_STAGE_PRESENT_EVIDENCE_MISSING');
    }
    if (stage.evidenceState !== 'PRESENT' && (stage.referenceId !== null || stage.occurredAtMs !== null)) {
      errors.push('TRACE_STAGE_ABSENT_EVIDENCE_CONTRADICTION');
    }
    if (stage.evidenceState === 'UNKNOWN_DUE_TO_TRUNCATION' && value.truncated !== true) {
      errors.push('TRACE_STAGE_UNKNOWN_WITHOUT_TRUNCATION');
    }
    if (stage.evidenceState === 'UNKNOWN_DUE_TO_TRUNCATION' && stage.truthLabel !== 'UNKNOWN') {
      errors.push('TRACE_STAGE_TRUNCATION_TRUTH_INVALID');
    }
    if (stage.evidenceState === 'UNKNOWN_DUE_TO_TRUNCATION' && stage.outcome !== 'UNKNOWN_DUE_TO_TRACE_TRUNCATION') {
      errors.push('TRACE_STAGE_TRUNCATION_OUTCOME_INVALID');
    }
    if (stage.evidenceState === 'ABSENT' && value.truncated === true) {
      errors.push('TRACE_STAGE_ABSENT_ON_TRUNCATED_TRACE');
    }
    if (stage.evidenceState === 'ABSENT' && stage.truthLabel !== 'MISSING') {
      errors.push('TRACE_STAGE_ABSENT_TRUTH_INVALID');
    }
    if (stage.evidenceState === 'ABSENT' && stage.outcome !== 'NO_EVENT_PUBLISHED') {
      errors.push('TRACE_STAGE_ABSENT_OUTCOME_INVALID');
    }
  }
  return Object.freeze(Array.from(new Set(errors)));
}

export function validateProductSupervisorEnvelope(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return Object.freeze(['PRODUCT_SUPERVISOR_NOT_OBJECT']);
  if (value.schemaVersion !== PRODUCT_SUPERVISOR_SCHEMA) errors.push('PRODUCT_SUPERVISOR_SCHEMA_UNSUPPORTED');
  if (typeof value.revision !== 'string' || value.revision.length === 0) errors.push('PRODUCT_REVISION_MISSING');
  if (typeof value.digest !== 'string' || value.digest.length === 0 || value.digest.length > 500) errors.push('PRODUCT_DIGEST_INVALID');
  if (typeof value.evaluatedAtMs !== 'number' || !Number.isFinite(value.evaluatedAtMs)) errors.push('PRODUCT_EVALUATED_AT_INVALID');
  if (!isProductTruthLabel(value.truthLabel)) errors.push('PRODUCT_TRUTH_LABEL_INVALID');
  if (typeof value.persistentSyntheticLabel !== 'boolean') errors.push('SYNTHETIC_LABEL_INVALID');
  errors.push(...validateCanonicalOpsEnvelope(value.opsReadback, value.opsIntakeInterlock, value.evaluatedAtMs));
  const syntheticScan = scanSyntheticTruth(value);
  if (!syntheticScan.complete) errors.push('SYNTHETIC_TRUTH_SCAN_OUT_OF_BOUNDS');
  if (syntheticScan.found && value.persistentSyntheticLabel !== true) errors.push('SYNTHETIC_LABEL_NOT_PERSISTENT');
  errors.push(...validateOwnerView(value.ownerView));
  errors.push(...validateDashboardProjection(value.dashboard));
  if (!Array.isArray(value.components)) errors.push('COMPONENT_GRAPH_MISSING');
  else {
    if (value.components.length > 200) errors.push('COMPONENT_GRAPH_OUT_OF_BOUNDS');
    const componentIds = new Set<string>();
    for (const component of value.components) {
      if (!isRecord(component) || typeof component.componentId !== 'string' || component.componentId.length === 0) {
        errors.push('COMPONENT_ENTRY_INVALID');
        continue;
      }
      if (componentIds.has(component.componentId)) errors.push('COMPONENT_ID_DUPLICATE');
      componentIds.add(component.componentId);
      if (typeof component.owner !== 'string' || component.owner.length === 0) errors.push('COMPONENT_OWNER_MISSING');
      if (!Array.isArray(component.supportedControlIds)) errors.push('COMPONENT_CONTROLS_INVALID');
      if (!PRODUCT_LIFECYCLES.has(String(component.desiredLifecycle))) errors.push('COMPONENT_FIELD_INVALID:desiredLifecycle');
      if (!PRODUCT_LIFECYCLES.has(String(component.observedLifecycle))) errors.push('COMPONENT_FIELD_INVALID:observedLifecycle');
      if (!PRODUCT_CAPABILITIES.has(String(component.capability))) errors.push('COMPONENT_FIELD_INVALID:capability');
      if (!['NONE', 'POTENTIAL', 'EXPOSED', 'RECOVERY'].includes(String(component.capitalRelevance))) errors.push('COMPONENT_FIELD_INVALID:capitalRelevance');
      if (!isProductTruthLabel(component.truthLabel)) errors.push('COMPONENT_FIELD_INVALID:truthLabel');
      for (const field of ['heartbeatAtMs', 'lastAdvanceAtMs', 'sourceAgeMs', 'eventAgeMs', 'processingAgeMs', 'queueDepth', 'queueCapacity', 'droppedCount']) {
        if (!isNonnegativeNumberOrNull(component[field])) errors.push(`COMPONENT_FIELD_INVALID:${field}`);
      }
      if (typeof component.queueDepth === 'number' && typeof component.queueCapacity === 'number' && component.queueDepth > component.queueCapacity) errors.push('COMPONENT_QUEUE_INVALID');
      for (const field of ['blockerCode', 'rootCauseComponentId', 'correlationId']) {
        if (!isStringOrNull(component[field])) errors.push(`COMPONENT_FIELD_INVALID:${field}`);
      }
    }
    if (isRecord(value.dashboard) && Array.isArray(value.dashboard.components)) {
      const dashboardIds = value.dashboard.components
        .filter(isRecord)
        .map((component) => component.componentId)
        .filter((componentId): componentId is string => typeof componentId === 'string')
        .sort();
      const canonicalIds = [...componentIds].sort();
      if (dashboardIds.length !== canonicalIds.length || dashboardIds.some((id, index) => id !== canonicalIds[index])) {
        errors.push('DASHBOARD_COMPONENT_GRAPH_MISMATCH');
      }
      if (value.truthLabel === 'SYNTHETIC_ONLY' && value.dashboard.components.some((component) => isRecord(component) && component.truthLabel === 'LIVE_PUBLIC')) {
        errors.push('SYNTHETIC_DASHBOARD_CONTAINS_LIVE_TRUTH');
      }
    }
  }
  errors.push(...validateProductManagedInventory(value.managedInventory, value.components, value.ownerView));
  if (!Array.isArray(value.dependencyEdges)) errors.push('DEPENDENCY_EDGES_MISSING');
  else {
    if (value.dependencyEdges.length > 1_000) errors.push('DEPENDENCY_EDGES_OUT_OF_BOUNDS');
    for (const edge of value.dependencyEdges) {
      if (!isRecord(edge)
        || typeof edge.fromComponentId !== 'string' || edge.fromComponentId.length === 0
        || typeof edge.toComponentId !== 'string' || edge.toComponentId.length === 0
        || typeof edge.required !== 'boolean'
        || !['AVAILABLE', 'DEGRADED', 'BLOCKED', 'UNKNOWN'].includes(String(edge.state))
        || !isStringOrNull(edge.rootCauseComponentId)
        || !Array.isArray(edge.reasonCodes)) errors.push('DEPENDENCY_EDGE_INVALID');
    }
  }
  if (!Array.isArray(value.traces)) errors.push('TRACE_INDEX_MISSING');
  else for (const trace of value.traces) errors.push(...validateProductCorrelationTrace(trace));
  if (!isRecord(value.incidentAvailability)
    || !['AVAILABLE', 'NOT_CONFIGURED', 'UNAVAILABLE'].includes(String(value.incidentAvailability.state))
    || !isProductTruthLabel(value.incidentAvailability.truthLabel)
    || !isStringOrNull(value.incidentAvailability.blocker)
    || (value.incidentAvailability.state === 'AVAILABLE' && value.incidentAvailability.blocker !== null)
    || (value.incidentAvailability.state !== 'AVAILABLE'
      && (typeof value.incidentAvailability.blocker !== 'string' || value.incidentAvailability.blocker.length === 0))) {
    errors.push('INCIDENT_AVAILABILITY_INVALID');
  } else if ((value.incidentAvailability.state === 'AVAILABLE'
      && !['LIVE_PUBLIC', 'WIRED', 'BUILT_AND_TESTED', 'IMPORTED', 'SYNTHETIC_ONLY'].includes(String(value.incidentAvailability.truthLabel)))
    || (value.incidentAvailability.state === 'NOT_CONFIGURED' && value.incidentAvailability.truthLabel !== 'NOT_CONFIGURED')
    || (value.incidentAvailability.state === 'UNAVAILABLE'
      && !['UNAVAILABLE', 'UNKNOWN'].includes(String(value.incidentAvailability.truthLabel)))) {
    errors.push('INCIDENT_AVAILABILITY_TRUTH_MISMATCH');
  }
  if (!Array.isArray(value.incidents)) errors.push('INCIDENT_PROJECTION_MISSING');
  else {
    if (value.incidents.length > 200) errors.push('INCIDENT_PROJECTION_OUT_OF_BOUNDS');
    for (const incident of value.incidents) {
      if (!isRecord(incident)
        || typeof incident.fingerprint !== 'string' || incident.fingerprint.length === 0
        || typeof incident.rootComponentId !== 'string' || incident.rootComponentId.length === 0
        || typeof incident.reasonCode !== 'string' || incident.reasonCode.length === 0
        || !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(String(incident.severity))
        || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(String(incident.state))
        || typeof incident.capitalRelevant !== 'boolean'
        || !Number.isFinite(incident.firstSeenAtMs)
        || !Number.isFinite(incident.lastSeenAtMs)
        || !Number.isInteger(incident.count) || Number(incident.count) < 1
        || !isStringOrNull(incident.operatorAction)
        || !isStringOrNull(incident.correlationId)) errors.push('INCIDENT_ENTRY_INVALID');
    }
    if (isRecord(value.incidentAvailability) && value.incidentAvailability.state !== 'AVAILABLE' && value.incidents.length > 0) {
      errors.push('INCIDENTS_PUBLISHED_WHILE_UNAVAILABLE');
    }
  }
  if (!Array.isArray(value.controls)) errors.push('CONTROL_REGISTRY_MISSING');
  else {
    const ids = new Set<string>();
    for (const control of value.controls) {
      if (!isRecord(control)) { errors.push('CONTROL_ENTRY_INVALID'); continue; }
      if (typeof control.controlId !== 'string' || control.controlId.length === 0) errors.push('CONTROL_ID_MISSING');
      else if (ids.has(control.controlId)) errors.push('CONTROL_ID_DUPLICATE');
      else ids.add(control.controlId);
      if (typeof control.backendCommandId !== 'string' || control.backendCommandId.length === 0) errors.push('CONTROL_BACKEND_COMMAND_MISSING');
      if (typeof control.wiringState !== 'string' || !validWiringState(control.wiringState)) errors.push('CONTROL_WIRING_INVALID');
      for (const field of ['owner', 'targetType', 'targetId', 'payloadSchema', 'safeBounds', 'currentDesiredValue', 'currentEffectiveValue', 'authority', 'requiredPosture', 'expiryPolicy', 'reversibility', 'currentStateRevision', 'confirmationText']) {
        if (typeof control[field] !== 'string' || control[field].length === 0) errors.push(`CONTROL_FIELD_MISSING:${field}`);
      }
      for (const field of ['group', 'label', 'explanation']) {
        if (typeof control[field] !== 'string' || control[field].length === 0) errors.push(`CONTROL_FIELD_MISSING:${field}`);
      }
      if (!['IMMEDIATE', 'DRAIN', 'RESTART', 'DEPLOYMENT'].includes(String(control.effect))) errors.push('CONTROL_EFFECT_INVALID');
      if (!isStringOrNull(control.disabledReason)) errors.push('CONTROL_DISABLED_REASON_INVALID');
      if (!isCommandPayload(control.payload)) errors.push('CONTROL_PAYLOAD_INVALID');
      if (!Array.isArray(control.payloadEnumeration) || control.payloadEnumeration.some((item) => !isCommandScalar(item)) || !isCommandScalar(control.defaultValue)
        || !Array.isArray(control.invariants) || control.invariants.some((item) => typeof item !== 'string' || item.length === 0)
        || !Array.isArray(control.effectTelemetry) || control.effectTelemetry.some((item) => typeof item !== 'string' || item.length === 0)) errors.push('CONTROL_REGISTRY_CONTRACT_INVALID');
      if (control.wiringState === 'WIRED_FIXTURE' && value.truthLabel !== 'SYNTHETIC_ONLY') errors.push('FIXTURE_CONTROL_ON_NON_SYNTHETIC_SNAPSHOT');
      if (control.wiringState === 'WIRED_LIVE' && value.truthLabel === 'SYNTHETIC_ONLY') errors.push('LIVE_CONTROL_ON_SYNTHETIC_SNAPSHOT');
      if (control.wiringState === 'WIRED_LIVE' && !SAFE_LIVE_BACKEND_COMMAND_IDS.includes(String(control.backendCommandId))) errors.push('LIVE_COMMAND_OUTSIDE_NON_MONEY_ALLOWLIST');
      if (!isFunctionalWiringState(control.wiringState as ControlWiringState) && control.preview !== null) errors.push('DISABLED_CONTROL_HAS_PREVIEW');
      if (control.preview !== null && !isRecord(control.preview)) errors.push('CONTROL_PREVIEW_INVALID');
      else if (isRecord(control.preview) && (
        typeof control.preview.previewId !== 'string' || control.preview.previewId.length === 0
        || control.preview.controlId !== control.controlId
        || typeof control.preview.expectedRevision !== 'string' || control.preview.expectedRevision.length === 0
        || typeof control.preview.digest !== 'string' || control.preview.digest.length === 0
        || !Number.isFinite(control.preview.expiresAtMs)
        || typeof control.preview.synthetic !== 'boolean'
      )) errors.push('CONTROL_PREVIEW_INVALID');
      if (value.truthLabel === 'SYNTHETIC_ONLY' && isRecord(control.preview) && control.preview.synthetic !== true) errors.push('SYNTHETIC_CONTROL_PREVIEW_NOT_SYNTHETIC');
      if (control.wiringState === 'WIRED_LIVE' && isRecord(control.preview) && control.preview.synthetic === true) errors.push('LIVE_CONTROL_PREVIEW_IS_SYNTHETIC');
      if (control.wiringState === 'WIRED_FIXTURE' && isRecord(control.preview) && control.preview.synthetic !== true) errors.push('FIXTURE_CONTROL_PREVIEW_NOT_SYNTHETIC');
      if (control.latestResult !== null && !isValidControlResult(control.latestResult)) errors.push('CONTROL_RESULT_INVALID');
      if (isRecord(control.latestResult) && control.latestResult.controlId !== control.controlId) errors.push('CONTROL_RESULT_ID_MISMATCH');
      if (control.wiringState === 'WIRED_LIVE' && isRecord(control.latestResult) && control.latestResult.synthetic === true) errors.push('LIVE_CONTROL_RESULT_IS_SYNTHETIC');
      if (control.wiringState === 'WIRED_FIXTURE' && isRecord(control.latestResult) && control.latestResult.synthetic !== true) errors.push('FIXTURE_CONTROL_RESULT_NOT_SYNTHETIC');
      if (value.truthLabel === 'SYNTHETIC_ONLY' && isRecord(control.latestResult) && control.latestResult.synthetic !== true) errors.push('SYNTHETIC_CONTROL_RESULT_NOT_SYNTHETIC');
    }
  }
  if (!isRecord(value.surfaces)) errors.push('SURFACE_ADAPTERS_MISSING');
  else for (const surfaceId of REQUIRED_SURFACE_IDS) {
    const surface = value.surfaces[surfaceId];
    if (!isRecord(surface)) errors.push(`SURFACE_ADAPTER_MISSING:${surfaceId}`);
    else {
      if (surface.surfaceId !== surfaceId) errors.push(`SURFACE_ADAPTER_ID_MISMATCH:${surfaceId}`);
      if (!['BINDING_READY', 'DIRECTOR_MOUNT_REQUIRED', 'BLOCKED_BACKEND'].includes(String(surface.bindingState))
        || !isProductTruthLabel(surface.truthLabel)
        || typeof surface.label !== 'string' || surface.label.length === 0
        || typeof surface.canonicalSource !== 'string' || surface.canonicalSource.length === 0
        || typeof surface.evaluatedAtMs !== 'number' || !Number.isFinite(surface.evaluatedAtMs)
        || typeof surface.summary !== 'string' || surface.summary.length === 0
        || !isStringOrNull(surface.blocker)
        || !Array.isArray(surface.controlIds)
        || !isStringOrNull(surface.correlationId)) errors.push(`SURFACE_ENTRY_INVALID:${surfaceId}`);
      if (!Array.isArray(surface.evidence)) errors.push(`SURFACE_EVIDENCE_MISSING:${surfaceId}`);
      else {
        const ids = new Set(surface.evidence.filter(isRecord).map((datum) => datum.fieldId));
        for (const fieldId of REQUIRED_SURFACE_EVIDENCE[surfaceId]) if (!ids.has(fieldId)) errors.push(`SURFACE_EVIDENCE_FIELD_MISSING:${surfaceId}:${fieldId}`);
        for (const datum of surface.evidence) {
          if (!isRecord(datum)
            || typeof datum.fieldId !== 'string' || datum.fieldId.length === 0
            || typeof datum.label !== 'string' || datum.label.length === 0
            || !isStringOrNull(datum.value)
            || !isProductTruthLabel(datum.truthLabel)
            || typeof datum.canonicalSource !== 'string' || datum.canonicalSource.length === 0
            || !isStringOrNull(datum.unavailableReason)) errors.push(`SURFACE_EVIDENCE_INVALID:${surfaceId}`);
        }
      }
    }
  }
  if (isRecord(value.opsReadback) && isRecord(value.opsIntakeInterlock) && isRecord(value.surfaces)) {
    const expectedOpsEvidence: Readonly<Record<string, string | null>> = Object.freeze({
      'deployment-frozen': value.opsReadback.deploymentFrozen === true ? 'FROZEN'
        : value.opsReadback.deploymentFrozen === false ? 'NOT_FROZEN' : 'UNKNOWN_FROZEN',
      'exposure-state': typeof value.opsReadback.exposureState === 'string' ? value.opsReadback.exposureState : null,
      'ambiguity-state': typeof value.opsReadback.ambiguityState === 'string' ? value.opsReadback.ambiguityState : null,
      'recovery-state': typeof value.opsReadback.recoveryState === 'string' ? value.opsReadback.recoveryState : null,
      'ledger-schema-compatibility': typeof value.opsReadback.currentSchemaVersion === 'number'
        && typeof value.opsReadback.rollbackFloor === 'number'
        ? `CURRENT ${value.opsReadback.currentSchemaVersion} · ROLLBACK FLOOR ${value.opsReadback.rollbackFloor}`
        : null,
      'ops-interlock': typeof value.opsIntakeInterlock.state === 'string' ? value.opsIntakeInterlock.state : null,
    });
    for (const surfaceId of ['control-room', 'health']) {
      const surface = value.surfaces[surfaceId];
      if (!isRecord(surface) || !Array.isArray(surface.evidence)) continue;
      for (const [fieldId, expected] of Object.entries(expectedOpsEvidence)) {
        const datum = surface.evidence.find((entry) => isRecord(entry) && entry.fieldId === fieldId);
        if (!isRecord(datum) || datum.value !== expected) errors.push(`OPS_SURFACE_EVIDENCE_MISMATCH:${surfaceId}:${fieldId}`);
      }
    }
  }
  if (!isRecord(value.materialEvents)) errors.push('MATERIAL_EVENTS_MISSING');
  else errors.push(...validateMaterialEventPage(String(value.materialEvents.requestedAfterCursor ?? ''), value.materialEvents, 'TAIL_BOOTSTRAP'));
  if (isRecord(value.ownerView) && isRecord(value.materialEvents)
    && value.ownerView.latestMaterialChange !== null
    && (value.materialEvents.hasMore === true
      || value.materialEvents.nextCursor !== value.materialEvents.highWaterCursor)) {
    errors.push('OWNER_MATERIAL_LATEST_CHANGE_NOT_AT_HIGH_WATER');
  }
  if (isRecord(value.ownerView) && isRecord(value.dashboard) && isRecord(value.dashboard.summaries)) {
    const capital = value.dashboard.summaries.capital;
    const reconciliation = value.dashboard.summaries.reconciliation;
    if (isRecord(capital) && value.ownerView.exposedCapital !== capital.activeExposureAmount) errors.push('OWNER_DASHBOARD_EXPOSURE_MISMATCH');
    if (value.ownerView.unresolvedRecovery !== null && value.ownerView.unresolvedRecovery !== 'NONE' && isRecord(reconciliation) && reconciliation.blocksNewExposure !== true) errors.push('OWNER_DASHBOARD_RECOVERY_MISMATCH');
    const dashboardReady = value.dashboard.overallPosture === 'READY';
    const ownerReady = value.ownerView.machineReady === 'YES';
    const health = isRecord(value.surfaces) && isRecord(value.surfaces.health)
      ? value.surfaces.health
      : null;
    const advance = health && Array.isArray(health.evidence)
      ? health.evidence.find((datum) => isRecord(datum) && datum.fieldId === 'heartbeat-advance')
      : null;
    const meaningfulAdvancePublished = isRecord(advance)
      && typeof advance.value === 'string'
      && advance.value.length > 0
      && advance.unavailableReason === null
      && !['UNKNOWN', 'MISSING', 'UNAVAILABLE', 'NOT_CONFIGURED', 'BLOCKED'].includes(String(advance.truthLabel))
      && isRecord(value.dashboard)
      && health?.evaluatedAtMs === value.dashboard.evaluatedAtMs;
    if (ownerReady && !meaningfulAdvancePublished) errors.push('OWNER_MEANINGFUL_ADVANCE_REQUIRED');
    if ((ownerReady && !dashboardReady)
      || (dashboardReady && meaningfulAdvancePublished && !ownerReady)) {
      errors.push('OWNER_DASHBOARD_READINESS_MISMATCH');
    }
  }
  return Object.freeze(Array.from(new Set(errors)));
}

function validateProductManagedInventory(
  inventoryValue: unknown,
  componentsValue: unknown,
  ownerViewValue: unknown,
): readonly string[] {
  if (!isRecord(inventoryValue)) return Object.freeze(['MANAGED_INVENTORY_MISSING']);
  const errors: string[] = [];
  if (inventoryValue.schemaVersion !== PRODUCT_MANAGED_INVENTORY_SCHEMA) {
    errors.push('MANAGED_INVENTORY_SCHEMA_UNSUPPORTED');
  }

  const components = Array.isArray(componentsValue) ? componentsValue : [];
  const occurrences = new Map<string, number[]>();
  for (const [index, component] of components.entries()) {
    if (!isRecord(component) || typeof component.componentId !== 'string') continue;
    const indexes = occurrences.get(component.componentId) ?? [];
    indexes.push(index);
    occurrences.set(component.componentId, indexes);
    if (!PRODUCT_MANAGED_CANONICAL_COMPONENT_IDS.includes(component.componentId)) {
      errors.push('MANAGED_INVENTORY_COMPONENT_UNKNOWN');
    }
  }
  const observedCanonicalComponentCount = PRODUCT_MANAGED_CANONICAL_COMPONENT_IDS.filter((componentId) => (
    (occurrences.get(componentId)?.length ?? 0) === 1
  )).length;

  const entries = inventoryValue.entries;
  const validEntries: Record<string, unknown>[] = [];
  if (!Array.isArray(entries)) {
    errors.push('MANAGED_INVENTORY_ENTRIES_MISSING');
  } else {
    if (entries.length !== PRODUCT_MANAGED_INVENTORY_CONTRACT.length) {
      errors.push('MANAGED_INVENTORY_ENTRY_COUNT_INVALID');
    }
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const contract = PRODUCT_MANAGED_INVENTORY_CONTRACT[index];
      if (!isRecord(entry) || !contract) {
        errors.push('MANAGED_INVENTORY_ENTRY_INVALID');
        continue;
      }
      validEntries.push(entry);
      if (entry.identity !== contract.identity) errors.push('MANAGED_INVENTORY_IDENTITY_ORDER_INVALID');
      if (entry.owner !== contract.owner) errors.push('MANAGED_INVENTORY_OWNER_MISMATCH');
      if (!Array.isArray(entry.canonicalComponentIds)
        || entry.canonicalComponentIds.length !== contract.canonicalComponentIds.length
        || entry.canonicalComponentIds.some((componentId, componentIndex) => (
          componentId !== contract.canonicalComponentIds[componentIndex]
        ))) {
        errors.push('MANAGED_INVENTORY_COMPONENT_MAPPING_INVALID');
      }
      if (!['EVIDENCE_PRESENT', 'OWNER_GATED', 'NOT_CONFIGURED', 'MISSING'].includes(String(entry.inventoryState))) {
        errors.push('MANAGED_INVENTORY_STATE_INVALID');
      }

      if (contract.canonicalComponentIds.length === 0) {
        if (entry.inventoryState !== contract.unavailableState
          || entry.evidence !== null
          || entry.reasonCode !== contract.unavailableReason) {
          errors.push('MANAGED_INVENTORY_DISPOSITION_INVALID');
        }
        continue;
      }

      const expectedObservations = contract.canonicalComponentIds.map((componentId) => occurrences.get(componentId) ?? []);
      const exactEvidencePresent = expectedObservations.every((indexes) => indexes.length === 1);
      if (!exactEvidencePresent) {
        const expectedReason = expectedObservations.some((indexes) => indexes.length > 1)
          ? 'CANONICAL_COMPONENT_EVIDENCE_DUPLICATED'
          : 'CANONICAL_COMPONENT_EVIDENCE_MISSING';
        if (entry.inventoryState !== 'MISSING'
          || entry.evidence !== null
          || entry.reasonCode !== expectedReason) {
          errors.push('MANAGED_INVENTORY_DISPOSITION_INVALID');
        }
        continue;
      }

      if (entry.inventoryState !== 'EVIDENCE_PRESENT' || entry.reasonCode !== null) {
        errors.push('MANAGED_INVENTORY_DISPOSITION_INVALID');
      }
      if (!Array.isArray(entry.evidence)
        || entry.evidence.length !== contract.canonicalComponentIds.length) {
        errors.push('MANAGED_INVENTORY_EVIDENCE_INVALID');
        continue;
      }
      for (const [evidenceIndex, evidence] of entry.evidence.entries()) {
        const expectedComponentId = contract.canonicalComponentIds[evidenceIndex];
        if (!isRecord(evidence)) {
          errors.push('MANAGED_INVENTORY_EVIDENCE_INVALID');
          continue;
        }
        if (evidence.source !== 'PRODUCT_RUNTIME_COMPONENT_PROJECTION') {
          errors.push('MANAGED_INVENTORY_EVIDENCE_SOURCE_INVALID');
        }
        if (evidence.componentId !== expectedComponentId) {
          errors.push('MANAGED_INVENTORY_EVIDENCE_COMPONENT_INVALID');
        }
        if (!Number.isInteger(evidence.componentProjectionIndex)
          || Number(evidence.componentProjectionIndex) < 0
          || Number(evidence.componentProjectionIndex) >= components.length) {
          errors.push('MANAGED_INVENTORY_EVIDENCE_INDEX_INVALID');
          continue;
        }
        const projected = components[Number(evidence.componentProjectionIndex)];
        if (!isRecord(projected) || projected.componentId !== expectedComponentId) {
          errors.push('MANAGED_INVENTORY_EVIDENCE_INDEX_INVALID');
        }
      }
    }
  }

  const stateCount = (state: ProductManagedInventoryState): number => validEntries.filter((entry) => (
    entry.inventoryState === state
  )).length;
  const countExpectations: Readonly<Record<string, number>> = Object.freeze({
    expectedIdentityCount: 33,
    mappedIdentityCount: PRODUCT_MANAGED_INVENTORY_CONTRACT.filter((entry) => entry.canonicalComponentIds.length > 0).length,
    evidencePresentCount: stateCount('EVIDENCE_PRESENT'),
    ownerGatedCount: stateCount('OWNER_GATED'),
    notConfiguredCount: stateCount('NOT_CONFIGURED'),
    missingCount: stateCount('MISSING'),
    canonicalComponentCount: PRODUCT_MANAGED_CANONICAL_COMPONENT_IDS.length,
    referencedCanonicalComponentCount: new Set(
      PRODUCT_MANAGED_INVENTORY_CONTRACT.flatMap((entry) => entry.canonicalComponentIds),
    ).size,
    observedCanonicalComponentCount,
  });
  for (const [field, expected] of Object.entries(countExpectations)) {
    const actual = inventoryValue[field];
    if (!Number.isInteger(actual) || Number(actual) < 0) {
      errors.push(`MANAGED_INVENTORY_COUNT_INVALID:${field}`);
    } else if (actual !== expected) {
      errors.push(`MANAGED_INVENTORY_COUNT_MISMATCH:${field}`);
    }
  }
  if (Number.isInteger(inventoryValue.evidencePresentCount)
    && Number.isInteger(inventoryValue.ownerGatedCount)
    && Number.isInteger(inventoryValue.notConfiguredCount)
    && Number.isInteger(inventoryValue.missingCount)
    && Number(inventoryValue.evidencePresentCount)
      + Number(inventoryValue.ownerGatedCount)
      + Number(inventoryValue.notConfiguredCount)
      + Number(inventoryValue.missingCount) !== 33) {
    errors.push('MANAGED_INVENTORY_DENOMINATOR_INVALID');
  }

  const inventoryEntries = Array.isArray(entries) ? entries : [];
  const mappedEvidenceComplete = PRODUCT_MANAGED_INVENTORY_CONTRACT.every((contract, index) => {
    const entry = inventoryEntries[index];
    return contract.canonicalComponentIds.length === 0
      || (isRecord(entry) && entry.inventoryState === 'EVIDENCE_PRESENT');
  });
  if (isRecord(ownerViewValue)
    && ownerViewValue.machineReady === 'YES'
    && (observedCanonicalComponentCount !== PRODUCT_MANAGED_CANONICAL_COMPONENT_IDS.length
      || !mappedEvidenceComplete)) {
    errors.push('MANAGED_INVENTORY_GREEN_WITH_MISSING_COMPONENT');
  }
  return Object.freeze(Array.from(new Set(errors)));
}

function validateOwnerView(value: unknown): readonly string[] {
  if (!isRecord(value)) return ['OWNER_VIEW_MISSING'];
  const errors: string[] = [];
  if (!['YES', 'NO', 'UNKNOWN'].includes(String(value.processAlive))) errors.push('OWNER_PROCESS_ALIVE_INVALID');
  if (!['YES', 'NO', 'UNKNOWN'].includes(String(value.machineReady))) errors.push('OWNER_MACHINE_READY_INVALID');
  if (value.tradeReady !== 'NO') errors.push('OWNER_TRADE_READY_INVALID');
  if (!['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'].includes(String(value.desiredMode))) errors.push('OWNER_DESIRED_MODE_INVALID');
  if (!['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY', 'BLOCKED', 'UNKNOWN'].includes(String(value.effectiveMode))) errors.push('OWNER_EFFECTIVE_MODE_INVALID');
  for (const field of ['exposedCapital', 'unresolvedRecovery', 'dataFreshness', 'topRootBlocker', 'activeOpportunity', 'activeTicket', 'activePosition', 'latestMaterialChange']) {
    if (!isStringOrNull(value[field])) errors.push(`OWNER_FIELD_INVALID:${field}`);
  }
  if (!isRecord(value.revisions)) errors.push('OWNER_REVISIONS_MISSING');
  else for (const field of ['testedCommit', 'deployedCommit', 'modelRevision', 'configRevision']) {
    if (!isStringOrNull(value.revisions[field])) errors.push(`OWNER_REVISION_INVALID:${field}`);
  }
  if (isRecord(value.revisions) && value.revisions.schemaRevision !== PRODUCT_SUPERVISOR_SCHEMA) errors.push('OWNER_SCHEMA_REVISION_INVALID');
  return errors;
}

function validateDashboardProjection(value: unknown): readonly string[] {
  if (!isRecord(value)) return ['DASHBOARD_PROJECTION_MISSING'];
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push('DASHBOARD_SCHEMA_INVALID');
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0) errors.push('DASHBOARD_REVISION_INVALID');
  if (!Number.isFinite(value.evaluatedAtMs)) errors.push('DASHBOARD_EVALUATED_AT_INVALID');
  if (typeof value.phase !== 'string' || value.phase.length === 0) errors.push('DASHBOARD_PHASE_INVALID');
  if (!['STOPPED', 'WARMING', 'READY', 'DEGRADED', 'BLOCKED', 'FAILED'].includes(String(value.overallPosture))) errors.push('DASHBOARD_POSTURE_INVALID');
  if (!isSystemTruthLabel(value.truthLabel)) errors.push('DASHBOARD_TRUTH_INVALID');
  if (!Number.isInteger(value.runtimeGeneration) || !Number.isInteger(value.controlGeneration)) errors.push('DASHBOARD_GENERATION_INVALID');
  if (!isStringOrNull(value.firstRootBlockerComponentId)) errors.push('DASHBOARD_ROOT_BLOCKER_INVALID');
  for (const field of ['components', 'edges', 'rootBlockerComponentIds', 'operatorAttentionComponentIds', 'attentionQueue', 'recentCorrelatedDecisions']) {
    if (!Array.isArray(value[field])) errors.push(`DASHBOARD_FIELD_INVALID:${field}`);
  }
  if (!isRecord(value.control)) errors.push('DASHBOARD_CONTROL_INVALID');
  else if (!Number.isInteger(value.control.revision) || !Number.isInteger(value.control.generation)
    || !['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'].includes(String(value.control.safeMode))
    || typeof value.control.killSwitchEngaged !== 'boolean'
    || typeof value.control.intakePaused !== 'boolean'
    || typeof value.control.updatedAtMs !== 'number' || !Number.isFinite(value.control.updatedAtMs)
    || typeof value.control.correlationId !== 'string' || value.control.correlationId.length === 0) errors.push('DASHBOARD_CONTROL_INVALID');
  if (!isRecord(value.summaries)) errors.push('DASHBOARD_SUMMARIES_INVALID');
  else errors.push(...validateDashboardSummaries(value.summaries));
  if (Array.isArray(value.components)) for (const component of value.components) {
    if (!isRecord(component)
      || typeof component.componentId !== 'string' || component.componentId.length === 0
      || typeof component.owner !== 'string' || component.owner.length === 0
      || typeof component.ownerPath !== 'string' || component.ownerPath.length === 0
      || !Array.isArray(component.releaseStatuses)
      || !['LIVE_PUBLIC', 'DRY_RUN', 'SYNTHETIC_ONLY', 'RECORDED_REPLAY', 'UNAVAILABLE', 'UNKNOWN'].includes(String(component.truthLabel))
      || !['STOPPED', 'RUNNING', 'PAUSED'].includes(String(component.desiredState))
      || typeof component.phase !== 'string' || component.phase.length === 0
      || !isStringOrNull(component.domainObservedState)
      || !['STOPPED', 'WARMING', 'READY', 'DEGRADED', 'BLOCKED', 'FAILED'].includes(String(component.readiness))
      || typeof component.completeness !== 'string'
      || !isSourceTimestamp(component.sourceTimestamp)
      || !isFreshness(component.freshness)
      || !isFiniteNumberOrNull(component.lastReceiveAtMs)
      || !isFiniteNumberOrNull(component.lastProcessAtMs)
      || !isFiniteNumberOrNull(component.lastSuccessAtMs)
      || !isStringArray(component.dependencies)
      || !isQueue(component.queue)
      || !isStringArray(component.blockerCodes)
      || !Number.isInteger(component.generation) || Number(component.generation) < 0
      || !Number.isInteger(component.restartCount) || Number(component.restartCount) < 0
      || !isStringArray(component.supportedControls)
      || typeof component.capitalExposed !== 'boolean'
      || typeof component.operatorAttentionRequired !== 'boolean'
      || !isLastFailure(component.lastFailure)) errors.push('DASHBOARD_COMPONENT_INVALID');
  }
  if (Array.isArray(value.edges)) for (const edge of value.edges) {
    if (!isRecord(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string'
      || typeof edge.required !== 'boolean'
      || !['AVAILABLE', 'DEGRADED', 'BLOCKED', 'UNKNOWN'].includes(String(edge.state))
      || !isStringOrNull(edge.rootBlockerComponentId)
      || !Array.isArray(edge.reasonCodes)) errors.push('DASHBOARD_EDGE_INVALID');
  }
  if (Array.isArray(value.attentionQueue)) for (const entry of value.attentionQueue) {
    if (!isRecord(entry) || typeof entry.componentId !== 'string' || typeof entry.rootComponentId !== 'string'
      || !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(String(entry.severity))
      || !Array.isArray(entry.reasonCodes) || typeof entry.capitalExposed !== 'boolean'
      || !isStringOrNull(entry.recommendedOperatorAction)) errors.push('DASHBOARD_ATTENTION_INVALID');
  }
  if (Array.isArray(value.recentCorrelatedDecisions) && value.recentCorrelatedDecisions.length > 500) errors.push('DASHBOARD_TRACE_OUT_OF_BOUNDS');
  if (Array.isArray(value.recentCorrelatedDecisions)) for (const decision of value.recentCorrelatedDecisions) {
    if (!isRecord(decision)
      || typeof decision.eventId !== 'string' || decision.eventId.length === 0
      || typeof decision.correlationId !== 'string' || decision.correlationId.length === 0
      || typeof decision.componentId !== 'string' || decision.componentId.length === 0
      || typeof decision.kind !== 'string' || decision.kind.length === 0
      || typeof decision.occurredAtMs !== 'number' || !Number.isFinite(decision.occurredAtMs)
      || !isSystemTruthLabel(decision.truthLabel)
      || !fieldsAreStringOrNull(decision, ['ownerId', 'canonicalProjectionId', 'revisionDigest', 'failureCode'])
      || !isStringArray(decision.referenceIds)) errors.push('DASHBOARD_TRACE_ENTRY_INVALID');
  }
  return errors;
}

function validateDashboardSummaries(value: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  const source = value.sourceCoverage;
  if (!isRecord(source) || !isSystemTruthLabel(source.truthLabel)
    || !fieldsAreNullableNumbers(source, ['universeSymbols', 'spotCoveredSymbols', 'usdMCoveredSymbols', 'quietSymbolsRetained', 'materialGapCount', 'rateLimitedSourceCount', 'lastMaterialGapAtMs'])) errors.push('DASHBOARD_SUMMARY_INVALID:sourceCoverage');
  const strategies = value.strategies;
  if (!isRecord(strategies)) errors.push('DASHBOARD_SUMMARY_INVALID:strategies');
  else for (const id of ['basis', 'volume']) {
    const strategy = strategies[id];
    if (!isRecord(strategy) || !isSystemTruthLabel(strategy.truthLabel)
      || !fieldsAreNullableNumbers(strategy, ['heartbeatAtMs', 'candidateCount', 'proposalCount', 'rejectionCount', 'acceptedCount', 'lastDecisionAtMs'])
      || !isStringOrNull(strategy.sourceRevision)) errors.push(`DASHBOARD_SUMMARY_INVALID:strategies.${id}`);
  }
  const intelligence = value.intelligence;
  if (!isRecord(intelligence) || !isSystemTruthLabel(intelligence.truthLabel)
    || !fieldsAreNullableNumbers(intelligence, ['evidenceCount', 'attentionCount', 'focusRequestedCount', 'focusActiveCount', 'thesisCount', 'insufficientEvidenceCount', 'lastUpdateAtMs'])) errors.push('DASHBOARD_SUMMARY_INVALID:intelligence');
  const capital = value.capital;
  if (!isRecord(capital) || !isSystemTruthLabel(capital.truthLabel)
    || typeof capital.accountTruthState !== 'string'
    || !fieldsAreStringOrNull(capital, ['allocatableAmount', 'reservedAmount', 'activeExposureAmount', 'checkpointRevision'])
    || !fieldsAreNullableNumbers(capital, ['eligibleCount', 'reservationCount', 'stagedMandateCount', 'activeExposureCount'])
    || !isStringArray(capital.blockerCodes)) errors.push('DASHBOARD_SUMMARY_INVALID:capital');
  const risk = value.risk;
  if (!isRecord(risk) || !isSystemTruthLabel(risk.truthLabel)
    || !['APPROVE', 'REJECT', 'CAP', 'UNAVAILABLE'].includes(String(risk.latestVerdict))
    || !fieldsAreNullableNumbers(risk, ['latestVerdictAtMs', 'rejectionCount'])
    || !isStringOrNull(risk.latestVerdictId) || !isStringArray(risk.reasonCodes)) errors.push('DASHBOARD_SUMMARY_INVALID:risk');
  const execution = value.execution;
  if (!isRecord(execution) || !isSystemTruthLabel(execution.truthLabel)
    || !['VALIDATE_ONLY', 'UNAVAILABLE'].includes(String(execution.mode))
    || execution.barrier !== 'LIVE_EXECUTION_NOT_IMPLEMENTED'
    || !fieldsAreStringOrNull(execution, ['planId', 'planLifecycle', 'recoveryState'])
    || typeof execution.coordinatorState !== 'string'
    || !fieldsAreNullableNumbers(execution, ['legCount', 'lastTransitionAtMs'])) errors.push('DASHBOARD_SUMMARY_INVALID:execution');
  const reconciliation = value.reconciliation;
  if (!isRecord(reconciliation) || !isSystemTruthLabel(reconciliation.truthLabel)
    || typeof reconciliation.status !== 'string' || typeof reconciliation.blocksNewExposure !== 'boolean'
    || !fieldsAreStringOrNull(reconciliation, ['recommendation', 'checkpointId'])
    || !isFiniteNumberOrNull(reconciliation.evaluatedAtMs) || !isStringArray(reconciliation.reasonCodes)) errors.push('DASHBOARD_SUMMARY_INVALID:reconciliation');
  const ledger = value.ledger;
  if (!isRecord(ledger)) {
    errors.push('DASHBOARD_SUMMARY_INVALID:ledger');
  } else {
    const schemaState = ledger.schemaCompatibilityState;
    const schemaReason = ledger.schemaCompatibilityReason;
    const schemaAvailable = schemaState === 'AVAILABLE'
      && Number.isSafeInteger(ledger.currentSchemaVersion)
      && Number(ledger.currentSchemaVersion) >= 1
      && Number.isSafeInteger(ledger.rollbackFloor)
      && Number(ledger.rollbackFloor) >= 0
      && Number(ledger.rollbackFloor) <= Number(ledger.currentSchemaVersion)
      && schemaReason === null;
    const schemaFailed = ['UNAVAILABLE', 'MALFORMED', 'MISMATCH'].includes(String(schemaState))
      && ledger.currentSchemaVersion === null
      && ledger.rollbackFloor === null
      && typeof schemaReason === 'string'
      && /^[A-Z][A-Z0-9_]{0,127}$/.test(schemaReason)
      && ledger.truthLabel === 'UNAVAILABLE';
    if (!isSystemTruthLabel(ledger.truthLabel)
      || !(ledger.writable === null || typeof ledger.writable === 'boolean')
      || (!schemaAvailable && !schemaFailed)
      || !fieldsAreStringOrNull(ledger, ['lastEventId', 'checkpointRevision'])
      || !fieldsAreNullableNumbers(ledger, ['lastPersistedAtMs', 'recentTraceCount', 'lastCleanShutdownAtMs'])) {
      errors.push('DASHBOARD_SUMMARY_INVALID:ledger');
    }
  }
  return errors;
}

function fieldsAreNullableNumbers(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => isNonnegativeNumberOrNull(value[field]));
}

function fieldsAreStringOrNull(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => isStringOrNull(value[field]));
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isSystemTruthLabel(value: unknown): boolean {
  return ['LIVE_PUBLIC', 'DRY_RUN', 'SYNTHETIC_ONLY', 'RECORDED_REPLAY', 'UNAVAILABLE', 'UNKNOWN'].includes(String(value));
}

function isSourceTimestamp(value: unknown): boolean {
  return value === null || (isRecord(value)
    && isFiniteNumberOrNull(value.sourceTimeMs)
    && typeof value.receivedAtMs === 'number' && Number.isFinite(value.receivedAtMs)
    && typeof value.maxAgeMs === 'number' && Number.isFinite(value.maxAgeMs) && value.maxAgeMs >= 0);
}

function isFreshness(value: unknown): boolean {
  return value === null || (isRecord(value)
    && typeof value.state === 'string' && value.state.length > 0
    && isNonnegativeNumberOrNull(value.ageMs)
    && typeof value.evaluatedAt === 'number' && Number.isFinite(value.evaluatedAt));
}

function isQueue(value: unknown): boolean {
  return value === null || (isRecord(value)
    && ['depth', 'capacity', 'dropped', 'coalesced'].every((field) => Number.isInteger(value[field]) && Number(value[field]) >= 0)
    && typeof value.observedAtMs === 'number' && Number.isFinite(value.observedAtMs));
}

function isLastFailure(value: unknown): boolean {
  return value === null || (isRecord(value)
    && typeof value.code === 'string' && value.code.length > 0
    && typeof value.message === 'string'
    && typeof value.recommendedOperatorAction === 'string');
}

function isValidControlResult(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const durableReceiptRequired = ['APPLIED', 'ACCEPTED_ASYNC', 'ALREADY_APPLIED'].includes(String(value.status));
  return typeof value.commandId === 'string' && value.commandId.length > 0
    && typeof value.controlId === 'string' && value.controlId.length > 0
    && ['APPLIED', 'ACCEPTED_ASYNC', 'REJECTED_SCHEMA', 'REJECTED_BOUNDS', 'REJECTED_AUTHORITY', 'REJECTED_STALE_REVISION', 'REJECTED_STATE', 'REJECTED_DEPENDENCY', 'REJECTED_EXPOSURE', 'REJECTED_NOT_SUPPORTED', 'EXPIRED', 'ALREADY_APPLIED', 'FAILED_RECOVERABLE', 'FAILED_ATTENTION_REQUIRED'].includes(String(value.status))
    && typeof value.before === 'string' && typeof value.after === 'string'
    && isStringOrNull(value.receiptId)
    && (!durableReceiptRequired || (typeof value.receiptId === 'string' && value.receiptId.length > 0))
    && typeof value.correlationId === 'string' && value.correlationId.length > 0
    && Number.isFinite(value.completedAtMs)
    && typeof value.synthetic === 'boolean';
}

function isProductTruthLabel(value: unknown): value is ProductTruthLabel {
  return ['LIVE_PUBLIC', 'WIRED', 'BUILT_AND_TESTED', 'IMPORTED', 'SYNTHETIC_ONLY', 'BLOCKED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING', 'UNKNOWN'].includes(String(value));
}

function scanSyntheticTruth(value: unknown): Readonly<{ found: boolean; complete: boolean }> {
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (stack.length > 0 && visited < 10_000) {
    const current = stack.pop();
    if (!isRecord(current) && !Array.isArray(current)) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    visited += 1;
    if (isRecord(current) && current.truthLabel === 'SYNTHETIC_ONLY') {
      return Object.freeze({ found: true, complete: true });
    }
    const children = Array.isArray(current) ? current : Object.values(current);
    for (const child of children) {
      if (typeof child === 'object' && child !== null) stack.push(child);
    }
  }
  return Object.freeze({ found: false, complete: stack.length === 0 });
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function exactUtcSeconds(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && new Date(parsed).toISOString().replace('.000Z', 'Z') === value;
}

function exactRecordKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function validateCanonicalOpsEnvelope(
  readbackValue: unknown,
  interlockValue: unknown,
  evaluatedAtValue: unknown,
): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(readbackValue) || !exactRecordKeys(readbackValue, [
    'source', 'observedAtUtc', 'validUntilUtc', 'deploymentFrozen', 'exposureState',
    'ambiguityState', 'recoveryState', 'currentSchemaVersion', 'rollbackFloor',
  ])) return Object.freeze(['OPS_READBACK_INVALID']);
  if (readbackValue.source !== 'CANONICAL_SUPERVISOR_READBACK'
      || !exactUtcSeconds(readbackValue.observedAtUtc)
      || !exactUtcSeconds(readbackValue.validUntilUtc)
      || ![true, false, 'UNKNOWN'].includes(readbackValue.deploymentFrozen as boolean | string)
      || !['NONE', 'ACTIVE', 'AMBIGUOUS', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(String(readbackValue.exposureState))
      || !['NONE', 'AMBIGUOUS', 'UNKNOWN'].includes(String(readbackValue.ambiguityState))
      || !['NONE', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(String(readbackValue.recoveryState))) {
    errors.push('OPS_READBACK_INVALID');
  }
  const schemaAvailable = Number.isSafeInteger(readbackValue.currentSchemaVersion)
    && (readbackValue.currentSchemaVersion as number) >= 1
    && Number.isSafeInteger(readbackValue.rollbackFloor)
    && (readbackValue.rollbackFloor as number) >= 0
    && (readbackValue.rollbackFloor as number) <= (readbackValue.currentSchemaVersion as number);
  if (!schemaAvailable && !(readbackValue.currentSchemaVersion === null && readbackValue.rollbackFloor === null)) {
    errors.push('OPS_SCHEMA_COMPATIBILITY_INVALID');
  }
  if (exactUtcSeconds(readbackValue.observedAtUtc) && exactUtcSeconds(readbackValue.validUntilUtc)
      && typeof evaluatedAtValue === 'number' && Number.isFinite(evaluatedAtValue)) {
    const observedAtMs = Date.parse(readbackValue.observedAtUtc);
    const validUntilMs = Date.parse(readbackValue.validUntilUtc);
    const leaseMs = validUntilMs - observedAtMs;
    if (observedAtMs > evaluatedAtValue || evaluatedAtValue - observedAtMs > 30_000
        || validUntilMs <= evaluatedAtValue || leaseMs < 5 * 60_000 || leaseMs > 60 * 60_000) {
      errors.push('OPS_READBACK_NOT_CURRENT');
    }
  }
  if (!isRecord(interlockValue) || !exactRecordKeys(interlockValue, [
    'source', 'state', 'blocksNewEntries', 'externalActionAuthorization', 'evaluatedAtUtc',
    'readbackValidUntilUtc', 'reasonCodes',
  ])) return Object.freeze([...new Set([...errors, 'OPS_INTERLOCK_INVALID'])]);
  const blocked = interlockValue.state === 'OPS_INTERLOCK_BLOCKED';
  if (interlockValue.source !== 'CANONICAL_OPS_INTAKE_INTERLOCK'
      || !['OPS_INTERLOCK_CLEAR', 'OPS_INTERLOCK_BLOCKED'].includes(String(interlockValue.state))
      || interlockValue.blocksNewEntries !== blocked
      || interlockValue.externalActionAuthorization !== 'NONE'
      || !exactUtcSeconds(interlockValue.evaluatedAtUtc)
      || interlockValue.readbackValidUntilUtc !== readbackValue.validUntilUtc
      || !Array.isArray(interlockValue.reasonCodes)
      || interlockValue.reasonCodes.length > 32
      || interlockValue.reasonCodes.some((code) => typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(code))
      || new Set(interlockValue.reasonCodes).size !== interlockValue.reasonCodes.length
      || (blocked ? interlockValue.reasonCodes.length === 0 : interlockValue.reasonCodes.length !== 0)) {
    errors.push('OPS_INTERLOCK_INVALID');
  }
  return Object.freeze([...new Set(errors)]);
}

function isNonnegativeNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

const PRODUCT_LIFECYCLES: ReadonlySet<string> = new Set([
  'STOPPED', 'START_REQUESTED', 'STARTING', 'WARMING', 'READY', 'DEGRADED', 'PAUSED',
  'DRAINING', 'RECONCILING', 'RECOVERY_REQUIRED', 'BLOCKED', 'FAILED', 'STOPPING',
]);

const PRODUCT_CAPABILITIES: ReadonlySet<string> = new Set([
  'LIVE_PUBLIC', 'LIVE_PRIVATE_READ', 'LIVE_SIGNED_VALIDATE', 'LIVE_MANUAL_CAPPED', 'SHADOW',
  'DRY_RUN', 'REPLAY', 'SYNTHETIC', 'NOT_CONFIGURED', 'UNAVAILABLE', 'UNKNOWN',
]);

function validWiringState(value: string): value is ControlWiringState {
  return value === 'WIRED_LIVE' || value === 'WIRED_FIXTURE' || value === 'OWNER_GATED' || value.startsWith('PENDING_BACKEND:') || value.startsWith('UNAVAILABLE:');
}

function isCommandPayload(value: unknown): value is Readonly<Record<string, ProductCommandScalar>> {
  return isRecord(value) && Object.keys(value).length <= 20 && Object.values(value).every((entry) => (
    entry === null || typeof entry === 'string' || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry))
  ));
}

function isCommandScalar(value: unknown): value is ProductCommandScalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
