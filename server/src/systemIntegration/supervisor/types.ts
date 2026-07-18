import type {
  RuntimeStatusSnapshot,
  StructuredFailure,
} from '../../foundation/contracts/index.js';
import type {
  SystemComponentSnapshot,
  SystemControlState,
  SystemDependencyEdge,
  SystemSupervisorSnapshot,
  SystemTraceEvent,
  SystemTraceSnapshot,
} from '../contracts/types.js';
import type {
  SystemComponentId,
  SystemTruthLabel,
} from '../contracts/constants.js';
import type { LedgerSchemaCompatibilityState } from '../persistence/types.js';

export const SYSTEM_OVERALL_POSTURES = Object.freeze([
  'STOPPED',
  'WARMING',
  'READY',
  'DEGRADED',
  'BLOCKED',
  'FAILED',
] as const);

export type SystemOverallPosture = (typeof SYSTEM_OVERALL_POSTURES)[number];

export const SYSTEM_ROOT_CAUSE_SEVERITIES = Object.freeze([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
] as const);

export type SystemRootCauseSeverity = (typeof SYSTEM_ROOT_CAUSE_SEVERITIES)[number];

export interface SystemRootCause {
  readonly componentId: SystemComponentId;
  readonly severity: SystemRootCauseSeverity;
  readonly reasonCodes: readonly string[];
  readonly failure: Readonly<StructuredFailure> | null;
  readonly dependencyPath: readonly SystemComponentId[];
  readonly affectedComponentIds: readonly SystemComponentId[];
  readonly capitalExposed: boolean;
}

export interface SystemAttentionItem {
  readonly componentId: SystemComponentId;
  readonly rootComponentId: SystemComponentId;
  readonly severity: SystemRootCauseSeverity;
  readonly reasonCodes: readonly string[];
  readonly capitalExposed: boolean;
  readonly recommendedOperatorAction: string | null;
}

export interface SystemSourceCoverageSummary {
  readonly truthLabel: SystemTruthLabel;
  readonly universeSymbols: number | null;
  readonly spotCoveredSymbols: number | null;
  readonly usdMCoveredSymbols: number | null;
  readonly quietSymbolsRetained: number | null;
  readonly materialGapCount: number | null;
  readonly rateLimitedSourceCount: number | null;
  readonly lastMaterialGapAtMs: number | null;
}

export interface SystemStrategyRuntimeSummary {
  readonly truthLabel: SystemTruthLabel;
  readonly heartbeatAtMs: number | null;
  readonly candidateCount: number | null;
  readonly proposalCount: number | null;
  readonly rejectionCount: number | null;
  readonly acceptedCount: number | null;
  readonly lastDecisionAtMs: number | null;
  readonly sourceRevision: string | null;
}

export interface SystemStrategySummary {
  readonly basis: Readonly<SystemStrategyRuntimeSummary>;
  readonly volume: Readonly<SystemStrategyRuntimeSummary>;
}

export interface SystemIntelligenceSummary {
  readonly truthLabel: SystemTruthLabel;
  readonly evidenceCount: number | null;
  readonly attentionCount: number | null;
  readonly focusRequestedCount: number | null;
  readonly focusActiveCount: number | null;
  readonly thesisCount: number | null;
  readonly insufficientEvidenceCount: number | null;
  readonly lastUpdateAtMs: number | null;
}

export interface SystemCapitalSummary {
  readonly truthLabel: SystemTruthLabel;
  readonly accountTruthState: string;
  readonly allocatableAmount: string | null;
  readonly reservedAmount: string | null;
  readonly activeExposureAmount: string | null;
  readonly eligibleCount: number | null;
  readonly reservationCount: number | null;
  readonly stagedMandateCount: number | null;
  readonly activeExposureCount: number | null;
  readonly checkpointRevision: string | null;
  readonly blockerCodes: readonly string[];
}

export interface SystemRiskSummary {
  readonly truthLabel: SystemTruthLabel;
  readonly latestVerdict: 'APPROVE' | 'REJECT' | 'NEEDS_REVIEW' | 'CAP' | 'UNAVAILABLE';
  readonly latestVerdictAtMs: number | null;
  readonly latestVerdictId: string | null;
  readonly correlationId: string | null;
  /** Exact gross-USD authority for this verdict, encoded without binary float drift. */
  readonly maxAllowedSize: string | null;
  readonly requiredConfirmation: boolean | null;
  readonly decisiveInputSnapshot: readonly Readonly<{
    readonly code: string;
    readonly status: 'PASS' | 'FAIL' | 'UNKNOWN';
    readonly detail: string;
    readonly observed: string | null;
    readonly limit: string | null;
    readonly evidenceTimestamp: number | null;
  }>[];
  readonly rejectionCount: number | null;
  readonly reasonCodes: readonly string[];
}

export interface SystemExecutionSummary {
  readonly truthLabel: SystemTruthLabel;
  readonly mode: 'VALIDATE_ONLY' | 'UNAVAILABLE';
  readonly barrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED';
  readonly planId: string | null;
  readonly planLifecycle: string | null;
  readonly coordinatorState: string;
  readonly legCount: number | null;
  readonly recoveryState: string | null;
  readonly lastTransitionAtMs: number | null;
}

export interface SystemReconciliationSummary {
  readonly truthLabel: SystemTruthLabel;
  readonly status: string;
  readonly blocksNewExposure: boolean;
  readonly recommendation: string | null;
  readonly checkpointId: string | null;
  readonly evaluatedAtMs: number | null;
  readonly reasonCodes: readonly string[];
}

export interface SystemLedgerSummary {
  readonly truthLabel: SystemTruthLabel;
  readonly writable: boolean | null;
  readonly schemaCompatibilityState: LedgerSchemaCompatibilityState;
  readonly schemaCompatibilityReason: string | null;
  readonly currentSchemaVersion: number | null;
  readonly rollbackFloor: number | null;
  readonly lastEventId: string | null;
  readonly lastPersistedAtMs: number | null;
  readonly checkpointRevision: string | null;
  readonly recentTraceCount: number | null;
  readonly lastCleanShutdownAtMs: number | null;
}

export interface SystemSupervisorSummaries {
  readonly sourceCoverage: Readonly<SystemSourceCoverageSummary>;
  readonly strategies: Readonly<SystemStrategySummary>;
  readonly intelligence: Readonly<SystemIntelligenceSummary>;
  readonly capital: Readonly<SystemCapitalSummary>;
  readonly risk: Readonly<SystemRiskSummary>;
  readonly execution: Readonly<SystemExecutionSummary>;
  readonly reconciliation: Readonly<SystemReconciliationSummary>;
  readonly ledger: Readonly<SystemLedgerSummary>;
}

export interface SystemTraceIndexEntry {
  readonly correlationId: string;
  readonly firstOccurredAtMs: number;
  readonly lastOccurredAtMs: number;
  readonly componentIds: readonly SystemComponentId[];
  readonly truthLabels: readonly SystemTruthLabel[];
  readonly eventCount: number;
  readonly failureCount: number;
  readonly snapshot: Readonly<SystemTraceSnapshot>;
}

export interface SystemTraceIndex {
  readonly evaluatedAtMs: number;
  readonly entries: readonly Readonly<SystemTraceIndexEntry>[];
  readonly totalInputEvents: number;
  readonly uniqueEventCount: number;
  readonly duplicateEventCount: number;
  readonly truncated: boolean;
}

export interface SystemRecentCorrelatedDecision {
  readonly eventId: string;
  readonly correlationId: string;
  readonly componentId: SystemComponentId;
  readonly kind: SystemTraceEvent['kind'];
  readonly occurredAtMs: number;
  readonly truthLabel: SystemTruthLabel;
  readonly ownerId: string | null;
  readonly canonicalProjectionId: string | null;
  readonly revisionDigest: string | null;
  readonly failureCode: string | null;
  readonly referenceIds: readonly string[];
}

export interface SystemSupervisorProjectionInput {
  readonly nowMs: number;
  readonly correlationId: string;
  readonly revision: number;
  readonly runtime: Readonly<RuntimeStatusSnapshot>;
  readonly control: Readonly<SystemControlState>;
  /** Exactly one explicit canonical adapter snapshot for every component ID. */
  readonly components: readonly Readonly<SystemComponentSnapshot>[];
  /** Domain-owned facts only. The supervisor displays them but never derives policy. */
  readonly summaries: Readonly<SystemSupervisorSummaries>;
  /** Existing-ledger material transitions, already translated to the system trace contract. */
  readonly traceEvents: readonly Readonly<SystemTraceEvent>[];
}

export type SystemSupervisorReadModel = Readonly<SystemSupervisorSnapshot & {
  readonly overallPosture: SystemOverallPosture;
  /** Foundation process startup generation; distinct from persisted control generation. */
  readonly runtimeGeneration: number;
  /** Persisted integration control/checkpoint generation. */
  readonly controlGeneration: number;
  readonly firstRootBlockerComponentId: SystemComponentId | null;
  readonly rootCauses: readonly Readonly<SystemRootCause>[];
  readonly attentionQueue: readonly Readonly<SystemAttentionItem>[];
  readonly summaries: Readonly<SystemSupervisorSummaries>;
  readonly traceIndex: Readonly<SystemTraceIndex>;
  readonly recentCorrelatedDecisions: readonly Readonly<SystemRecentCorrelatedDecision>[];
}>;

export interface SystemRootCauseProjection {
  readonly components: readonly Readonly<SystemComponentSnapshot>[];
  readonly edges: readonly Readonly<SystemDependencyEdge>[];
  readonly rootCauses: readonly Readonly<SystemRootCause>[];
  readonly attentionQueue: readonly Readonly<SystemAttentionItem>[];
  readonly firstRootBlockerComponentId: SystemComponentId | null;
}
