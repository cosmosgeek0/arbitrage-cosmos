import type { L12SupervisorSnapshot } from '../exposureRecoveryProjection/index.js';
import type {
  DesiredRuntimeState,
  RuntimePhase,
} from '../../../foundation/contracts/index.js';
import type { RateDiagnostic } from '../../../foundation/observability/types.js';

export const MACHINE_GRAPH_EVIDENCE_SCHEMA =
  'LIVE_EDGE_MACHINE_GRAPH_EVIDENCE_SNAPSHOT_V1' as const;

export const MACHINE_GRAPH_ROLES = Object.freeze([
  'SECRETS_BOUNDARY',
  'CLOCK_SYNCHRONIZATION',
  'SPOT_PUBLIC_STREAM',
  'USD_M_PUBLIC_STREAM',
  'SPOT_PRIVATE_STREAM',
  'USD_M_PRIVATE_STREAM',
  'MARGIN_PRIVATE_STREAM',
  'INSTRUMENT_FILTER_REGISTRY',
  'ACCOUNT_TRUTH',
  'EVIDENCE_ATTENTION_RUNTIME',
  'QUANT_BRIDGE',
  'BASIS_ENGINE',
  'VOLUME_ENGINE',
  'PROPOSAL_REJECTION_AUTHORITY',
  'CAPITAL_GATE',
  'RISK_GATE',
  'EXECUTION_HAND',
  'BASIS_COORDINATOR',
  'VOLUME_LIFECYCLE',
  'EXPOSURE_POSITION_SUPERVISOR',
  'RECONCILIATION',
  'OUTCOME_QUANT_FEEDBACK',
  'LEDGER_READ_MODEL',
  'DATABASE',
  'EC2_PROCESS',
  'CLOUDFLARE_TUNNEL_ACCESS',
  'WATCHDOG_ALARMS',
] as const);
export type MachineGraphRole = (typeof MACHINE_GRAPH_ROLES)[number];

/** Copied from the existing System Integration contract; this adapter does not own topology. */
export const CANONICAL_SYSTEM_COMPONENT_IDS = Object.freeze([
  'public-spot-source',
  'public-usdm-source',
  'market-universe',
  'intelligence-runtime',
  'market-intelligence',
  'basis-engine',
  'volume-engine',
  'capital-supervision',
  'multileg-risk',
  'execution-coordinator-validate-only',
  'reconciliation',
  'ledger-persistence',
  'engine-supervisor',
] as const);
export type CanonicalSystemComponentId = (typeof CANONICAL_SYSTEM_COMPONENT_IDS)[number];

/** Copied discriminants from accepted L14. Availability is intentionally separate. */
export const MACHINE_GRAPH_CONTROL_ACTIONS = Object.freeze([
  'SET_COMPONENT_DESIRED_STATE',
  'PAUSE_INTAKE',
  'RESUME_INTAKE',
  'UPDATE_BOUNDED_CONFIGURATION',
  'APPROVE',
  'ARM',
  'DISARM',
  'REARM',
  'REVOKE',
  'HALT',
  'RECONCILE',
  'CANCEL',
  'CLOSE',
  'REDUCE',
  'EXECUTE_PRECOMPUTED_RECOVERY_PLAN',
  'REPAY_LIABILITY',
  'SAFE_RESTART_COMPONENT',
  'ACKNOWLEDGE_RECOVERY',
] as const);
export type MachineGraphControlAction = (typeof MACHINE_GRAPH_CONTROL_ACTIONS)[number];

export const MACHINE_GRAPH_METRICS = Object.freeze([
  'DEPLOYED_REVISION',
  'SCHEMA_VERSION',
  'CONFIG_VERSION',
  'SERVER_TIME_OFFSET_MS',
  'SERVER_TIME_DRIFT_MS',
  'PUBLIC_EVENT_AGE_MS',
  'PRIVATE_EVENT_AGE_MS',
  'STREAM_RECONNECT_COUNT',
  'MALFORMED_EVENT_COUNT',
  'REST_RECONCILIATION_AGE_MS',
  'RATE_LIMIT_UTILIZATION_PPM',
  'RATE_LIMIT_COOLDOWN_MS',
  'DECISION_AGE_MS',
  'ASSESSMENT_AGE_MS',
  'TICKET_ACK_LATENCY_MS',
  'ORDER_ACK_LATENCY_MS',
  'AMBIGUOUS_MUTATION_COUNT',
  'PARTIAL_FILL_COUNT',
  'UNHEDGED_NOTIONAL',
  'UNHEDGED_DURATION_MS',
  'RECONCILIATION_MISMATCH_COUNT',
  'ORPHAN_COUNT',
  'MARGIN_LIABILITY',
  'MARGIN_INTEREST',
  'RECOVERY_QUEUE_DEPTH',
  'RECOVERY_QUEUE_AGE_MS',
  'DATABASE_COMMIT_FAILURE_COUNT',
  'LEDGER_FAILURE_COUNT',
  'PROCESS_RESTART_COUNT',
  'EVENT_LOOP_LAG_MS',
  'CPU_UTILIZATION_PPM',
  'MEMORY_USAGE_BYTES',
  'DISK_FREE_BYTES',
  'BACKUP_HEALTH',
  'RESTORE_HEALTH',
  'ROLLBACK_HEALTH',
] as const);
export type MachineGraphMetric = (typeof MACHINE_GRAPH_METRICS)[number];

export type MachineGraphMetricInstrument =
  | 'COUNTER'
  | 'GAUGE'
  | 'REVISION'
  | 'VERSION'
  | 'STATUS';

export const MACHINE_GRAPH_METRIC_INSTRUMENTS = Object.freeze({
  DEPLOYED_REVISION: 'REVISION',
  SCHEMA_VERSION: 'VERSION',
  CONFIG_VERSION: 'VERSION',
  SERVER_TIME_OFFSET_MS: 'GAUGE',
  SERVER_TIME_DRIFT_MS: 'GAUGE',
  PUBLIC_EVENT_AGE_MS: 'GAUGE',
  PRIVATE_EVENT_AGE_MS: 'GAUGE',
  STREAM_RECONNECT_COUNT: 'COUNTER',
  MALFORMED_EVENT_COUNT: 'COUNTER',
  REST_RECONCILIATION_AGE_MS: 'GAUGE',
  RATE_LIMIT_UTILIZATION_PPM: 'GAUGE',
  RATE_LIMIT_COOLDOWN_MS: 'GAUGE',
  DECISION_AGE_MS: 'GAUGE',
  ASSESSMENT_AGE_MS: 'GAUGE',
  TICKET_ACK_LATENCY_MS: 'GAUGE',
  ORDER_ACK_LATENCY_MS: 'GAUGE',
  AMBIGUOUS_MUTATION_COUNT: 'COUNTER',
  PARTIAL_FILL_COUNT: 'COUNTER',
  UNHEDGED_NOTIONAL: 'GAUGE',
  UNHEDGED_DURATION_MS: 'GAUGE',
  RECONCILIATION_MISMATCH_COUNT: 'COUNTER',
  ORPHAN_COUNT: 'COUNTER',
  MARGIN_LIABILITY: 'GAUGE',
  MARGIN_INTEREST: 'GAUGE',
  RECOVERY_QUEUE_DEPTH: 'GAUGE',
  RECOVERY_QUEUE_AGE_MS: 'GAUGE',
  DATABASE_COMMIT_FAILURE_COUNT: 'COUNTER',
  LEDGER_FAILURE_COUNT: 'COUNTER',
  PROCESS_RESTART_COUNT: 'COUNTER',
  EVENT_LOOP_LAG_MS: 'GAUGE',
  CPU_UTILIZATION_PPM: 'GAUGE',
  MEMORY_USAGE_BYTES: 'GAUGE',
  DISK_FREE_BYTES: 'GAUGE',
  BACKUP_HEALTH: 'STATUS',
  RESTORE_HEALTH: 'STATUS',
  ROLLBACK_HEALTH: 'STATUS',
} as const satisfies Readonly<Record<MachineGraphMetric, MachineGraphMetricInstrument>>);

export const MACHINE_GRAPH_ALARMS = Object.freeze([
  'PROCESS_ABSENT',
  'STALE_PRIVATE_TRUTH',
  'UNHEDGED_EXPOSURE_DURATION_EXCEEDED',
  'RECONCILIATION_MISMATCH',
  'RECOVERY_REQUIRED',
  'DISK_OR_DATABASE_FAILURE',
  'CLOCK_SKEW',
  'REPEATED_AMBIGUOUS_EXCHANGE_MUTATIONS',
  'SECRET_FETCH_FAILURE',
  'QUANT_PROTOCOL_INCOMPATIBILITY',
  'CLOUDFLARE_TUNNEL_OR_ACCESS_FAILURE',
  'BACKUP_STALE',
  'TRADE_UNSAFE',
] as const);
export type MachineGraphAlarm = (typeof MACHINE_GRAPH_ALARMS)[number];

export const MACHINE_GRAPH_METRIC_UNITS = Object.freeze({
  DEPLOYED_REVISION: 'REVISION',
  SCHEMA_VERSION: 'VERSION',
  CONFIG_VERSION: 'VERSION',
  SERVER_TIME_OFFSET_MS: 'MILLISECONDS',
  SERVER_TIME_DRIFT_MS: 'MILLISECONDS',
  PUBLIC_EVENT_AGE_MS: 'MILLISECONDS',
  PRIVATE_EVENT_AGE_MS: 'MILLISECONDS',
  STREAM_RECONNECT_COUNT: 'COUNT',
  MALFORMED_EVENT_COUNT: 'COUNT',
  REST_RECONCILIATION_AGE_MS: 'MILLISECONDS',
  RATE_LIMIT_UTILIZATION_PPM: 'PARTS_PER_MILLION',
  RATE_LIMIT_COOLDOWN_MS: 'MILLISECONDS',
  DECISION_AGE_MS: 'MILLISECONDS',
  ASSESSMENT_AGE_MS: 'MILLISECONDS',
  TICKET_ACK_LATENCY_MS: 'MILLISECONDS',
  ORDER_ACK_LATENCY_MS: 'MILLISECONDS',
  AMBIGUOUS_MUTATION_COUNT: 'COUNT',
  PARTIAL_FILL_COUNT: 'COUNT',
  UNHEDGED_NOTIONAL: 'EXACT_DECIMAL',
  UNHEDGED_DURATION_MS: 'MILLISECONDS',
  RECONCILIATION_MISMATCH_COUNT: 'COUNT',
  ORPHAN_COUNT: 'COUNT',
  MARGIN_LIABILITY: 'EXACT_DECIMAL',
  MARGIN_INTEREST: 'EXACT_DECIMAL',
  RECOVERY_QUEUE_DEPTH: 'COUNT',
  RECOVERY_QUEUE_AGE_MS: 'MILLISECONDS',
  DATABASE_COMMIT_FAILURE_COUNT: 'COUNT',
  LEDGER_FAILURE_COUNT: 'COUNT',
  PROCESS_RESTART_COUNT: 'COUNT',
  EVENT_LOOP_LAG_MS: 'MILLISECONDS',
  CPU_UTILIZATION_PPM: 'PARTS_PER_MILLION',
  MEMORY_USAGE_BYTES: 'BYTES',
  DISK_FREE_BYTES: 'BYTES',
  BACKUP_HEALTH: 'STATUS',
  RESTORE_HEALTH: 'STATUS',
  ROLLBACK_HEALTH: 'STATUS',
} as const satisfies Readonly<Record<MachineGraphMetric, MachineGraphMetricUnit>>);

export type MachineGraphMetricUnit =
  | 'REVISION'
  | 'VERSION'
  | 'MILLISECONDS'
  | 'COUNT'
  | 'PARTS_PER_MILLION'
  | 'EXACT_DECIMAL'
  | 'BYTES'
  | 'STATUS';

export interface L12SubjectBinding {
  readonly strategy: 'NORMAL_BASIS' | 'REVERSE_BASIS' | 'VOLUME';
  readonly proposalId: string;
  readonly assessmentId: string | null;
  readonly mandateId: string;
  readonly reservationId: string;
  readonly approvalId: string | null;
  readonly planOrLifecycleId: string;
  readonly correlationId: string;
  readonly accountRealmId: string;
  readonly symbol: string;
}

export interface L12CanonicalTruthBindingCopy {
  readonly owner: 'CAPITAL_FOUNDATION';
  readonly subject: Readonly<L12SubjectBinding>;
  readonly accountingScopeId: string;
  readonly mutationId: string;
  readonly exposureTruthRevision: string;
  readonly capitalPositionRevision: string;
  readonly accountCapacityRevision: string;
  readonly reservationRevision: string;
  readonly reservationSettlementRevision: string;
  readonly executionRevision: string;
  readonly outstandingRevision: string;
  readonly reconciliationRevision: string;
  readonly recoveryRevision: string;
}

export interface L12ComponentEvidenceBindingCopy {
  readonly capitalExposed: boolean;
  readonly operatorAttentionRequired: boolean;
  readonly ownerRevision: string;
  readonly reasonCodes: readonly string[];
}

export interface L12RecoveryBindingCopy {
  readonly required: boolean;
  readonly ownerEndState: 'OPEN' | 'CLOSED' | 'RECOVERED' | 'MANUAL_INTERVENTION' | null;
  /** Opaque L12 owner values. L13 never parses these decimals. */
  readonly residualExposure: string | null;
  readonly residualLiability: string | null;
  readonly ownerRevision: string;
  readonly reasonCodes: readonly string[];
}

export interface L12SnapshotBindingCopy {
  readonly sourceSchema: L12SupervisorSnapshot['schema'];
  readonly sourceVersion: 1;
  readonly sourceSnapshotRevision: string;
  readonly projectionStatus: 'BLOCKED' | 'RECOVERY_REQUIRED' | 'COMPLETE_FOR_OWNER_REVIEW';
  readonly projectionAuthority: 'OWNER_EVIDENCE_ADAPTER_ONLY';
  readonly truthClass: 'SYNTHETIC_ONLY';
  readonly subject: Readonly<L12SubjectBinding>;
  readonly canonicalTruth: Readonly<L12CanonicalTruthBindingCopy>;
  readonly componentEvidence: Readonly<L12ComponentEvidenceBindingCopy>;
  readonly recovery: Readonly<L12RecoveryBindingCopy>;
}

export interface MachineGraphRoleBinding {
  readonly role: MachineGraphRole;
  readonly bindingState: 'BOUND' | 'OWNER_GATED' | 'MISSING';
  /** Empty unless BOUND. No canonical ID may be repeated across bound roles. */
  readonly componentIds: readonly CanonicalSystemComponentId[];
  readonly bindingRevision: string | null;
  readonly authority: 'INJECTED_SYSTEM_INTEGRATION_CONTRACT_BINDING';
}

export interface CounterWindowEvidence {
  readonly logicalWriterId: string;
  readonly continuity: 'CONTIGUOUS' | 'RESET' | 'GAP' | 'UNKNOWN';
  readonly aggregationTemporality: 'DELTA' | 'CUMULATIVE' | 'UNKNOWN';
  readonly startAtMs: number;
  readonly endAtMs: number;
  readonly startCount: number;
  readonly endCount: number;
}

export interface MachineGraphVersionEvidence {
  readonly modelVersion: string | null;
  readonly configVersion: string | null;
  readonly schemaVersion: string | null;
  readonly deployedRevision: string | null;
}

export interface MachineGraphRateEvidence {
  /** Canonical Foundation diagnostic output, copied without recalculating its rate. */
  readonly diagnostic: Readonly<RateDiagnostic> | null;
  readonly logicalWriterId: string | null;
  readonly aggregationTemporality: 'DELTA' | 'CUMULATIVE' | 'UNKNOWN' | 'UNAVAILABLE';
  readonly authority: 'FOUNDATION_OBSERVABILITY' | 'OWNER_INJECTED' | 'UNAVAILABLE';
  readonly ownerRevision: string | null;
  readonly ownerDigest: string | null;
  readonly observedAtMs: number | null;
  readonly reasonCodes: readonly string[];
}

export interface MachineGraphControlStateEvidence {
  readonly desiredState: DesiredRuntimeState | 'UNKNOWN' | 'UNAVAILABLE';
  readonly phase: RuntimePhase | 'UNKNOWN' | 'UNAVAILABLE';
  readonly generation: number | null;
  readonly authority: 'FOUNDATION_CONTROL' | 'UNAVAILABLE';
  readonly ownerRevision: string | null;
  readonly ownerDigest: string | null;
  readonly observedAtMs: number | null;
  readonly reasonCodes: readonly string[];
}

export interface MachineGraphLastErrorEvidence {
  readonly code: string;
  readonly ownerRevision: string;
  readonly observedAtMs: number;
}

export interface MachineGraphTraceReference {
  readonly correlationId: string;
  readonly traceRevision: string;
}

export interface MachineGraphControlEvidence {
  readonly action: MachineGraphControlAction;
  readonly implementationState:
    | 'PROVEN_CONTROL_PLANE_RUNTIME_ONLY'
    | 'CONTRACT_ONLY'
    | 'UNKNOWN';
  readonly integrationState: 'UNWIRED' | 'OWNER_GATED' | 'MISSING' | 'UNKNOWN';
  readonly availability: 'UNAVAILABLE';
  readonly ownerRevision: string | null;
  readonly controlReference: null;
  readonly reasonCodes: readonly string[];
}

export interface MachineGraphRoleEvidence {
  readonly role: MachineGraphRole;
  readonly owner: string;
  readonly ownerPath: string | null;
  readonly ownerRevision: string | null;
  readonly evidenceState: 'CURRENT' | 'STALE' | 'PARTIAL' | 'SYNTHETIC_ONLY' | 'UNKNOWN' | 'UNAVAILABLE';
  /** Whole-machine state is copied only from the canonical Foundation control owner. */
  readonly controlState: Readonly<MachineGraphControlStateEvidence>;
  /** Owner dialect, deliberately not cast into whole-machine readiness. */
  readonly observedState: string | null;
  readonly heartbeatAtMs: number | null;
  readonly exchangeEventAgeMs: number | null;
  readonly localReceiveAgeMs: number | null;
  readonly localProcessingAgeMs: number | null;
  readonly inputRate: Readonly<MachineGraphRateEvidence>;
  readonly outputRate: Readonly<MachineGraphRateEvidence>;
  readonly queueDepth: number | null;
  readonly droppedCount: number | null;
  readonly backpressure: 'CLEAR' | 'ACTIVE' | 'UNKNOWN' | 'UNAVAILABLE';
  readonly sourceType:
    | 'LIVE_PUBLIC'
    | 'LIVE_PRIVATE'
    | 'DERIVED'
    | 'RECORDED_REPLAY'
    | 'SYNTHETIC_TEST'
    | 'INFRASTRUCTURE'
    | 'UNKNOWN'
    | 'UNAVAILABLE';
  readonly completeness: 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'UNKNOWN' | 'UNAVAILABLE';
  readonly versions: Readonly<MachineGraphVersionEvidence>;
  readonly lastMeaningfulAdvanceAtMs: number | null;
  readonly blockerCode: string | null;
  /** Opaque owner reference; L13 never selects or propagates a root cause. */
  readonly rootCauseReference: string | null;
  readonly lastError: Readonly<MachineGraphLastErrorEvidence> | null;
  /** Owner-declared subset only; availability remains in the top-level exact action matrix. */
  readonly supportedControls: readonly MachineGraphControlAction[];
  readonly trace: Readonly<MachineGraphTraceReference> | null;
  readonly capitalExposed: boolean | null;
  readonly operatorAttentionRequired: boolean | null;
}

export interface MachineGraphMetricEvidence {
  readonly metric: MachineGraphMetric;
  readonly unit: MachineGraphMetricUnit;
  readonly status: 'OBSERVED' | 'STALE' | 'UNKNOWN' | 'UNAVAILABLE';
  readonly value: string | number | null;
  readonly owner: string;
  readonly ownerRevision: string | null;
  readonly ownerDigest: string | null;
  readonly observedAtMs: number | null;
  readonly window: Readonly<CounterWindowEvidence> | null;
  /** Fixed empty labels prevent account/symbol/correlation cardinality leaks. */
  readonly labels: readonly [];
  readonly reasonCodes: readonly string[];
}

export interface MachineGraphAlarmEvidence {
  readonly alarm: MachineGraphAlarm;
  readonly state: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA' | 'UNKNOWN' | 'UNAVAILABLE';
  readonly owner: string;
  readonly ownerRevision: string | null;
  readonly ownerDigest: string | null;
  readonly observedAtMs: number | null;
  readonly automaticAction: 'NONE';
  readonly canLiquidate: false;
  readonly canMutateCapital: false;
  readonly haltRecommendation: boolean;
  readonly trace: Readonly<MachineGraphTraceReference> | null;
  readonly reasonCodes: readonly string[];
}

export interface MachineGraphEvidenceInput {
  readonly assembledAtMs: number;
  /** Full accepted L12 snapshot used only to invoke its canonical validator. */
  readonly l12Snapshot: Readonly<L12SupervisorSnapshot>;
  readonly roleBindings: readonly Readonly<MachineGraphRoleBinding>[];
  readonly roles: readonly Readonly<MachineGraphRoleEvidence>[];
  readonly controls: readonly Readonly<MachineGraphControlEvidence>[];
  readonly metrics: readonly Readonly<MachineGraphMetricEvidence>[];
  readonly alarms: readonly Readonly<MachineGraphAlarmEvidence>[];
}

export interface MachineGraphEvidenceSnapshot {
  readonly schema: typeof MACHINE_GRAPH_EVIDENCE_SCHEMA;
  readonly version: 1;
  readonly snapshotRevision: string;
  readonly assembledAtMs: number;
  /** Compact copy derived only after the full L12 snapshot validates. */
  readonly l12Binding: Readonly<L12SnapshotBindingCopy>;
  readonly roleBindings: readonly Readonly<MachineGraphRoleBinding>[];
  readonly roles: readonly Readonly<MachineGraphRoleEvidence>[];
  readonly controls: readonly Readonly<MachineGraphControlEvidence>[];
  readonly metrics: readonly Readonly<MachineGraphMetricEvidence>[];
  readonly alarms: readonly Readonly<MachineGraphAlarmEvidence>[];
  readonly projectionAuthority: 'OWNER_EVIDENCE_ADAPTER_ONLY';
  readonly graphAuthority: 'SYSTEM_INTEGRATION';
  readonly observabilityAuthority: 'FOUNDATION_OBSERVABILITY';
  readonly controlAuthority: 'NONE_RECORD_ONLY';
  readonly rootCauseAuthority: 'NONE_RECORD_ONLY';
  readonly readinessAuthority: 'NONE_RECORD_ONLY';
  readonly alarmEvaluationAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly automaticActionAuthorization: 'NONE';
  readonly truthClass: 'SYNTHETIC_ONLY_UNWIRED';
}
