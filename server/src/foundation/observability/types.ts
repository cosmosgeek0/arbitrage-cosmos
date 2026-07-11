/**
 * Lane H — pure diagnostics evidence and output vocabulary.
 *
 * This lane does not own any runtime state. A future composition root takes
 * snapshots from the existing supervisor/engines/adapters, supplies an
 * explicit evaluation clock and policy, and calls `deriveDiagnostics`.
 * Everything nullable below is deliberately nullable: absence is evidence,
 * never permission to manufacture zero, "healthy", or the current time.
 */
import type {
  ContractResult,
  DataAuthority,
  DiagnosticEnvelope,
  FreshnessReport,
  HealthState,
  RuntimePhase,
  RuntimeStatusSnapshot,
  SourcedTimestamp,
  StructuredFailure,
} from '../contracts/index.js';

export const BASELINE_STATES = ['READY', 'WARMING', 'STALE', 'FAILED', 'UNKNOWN'] as const;
export type BaselineState = (typeof BASELINE_STATES)[number];

export const BORROW_COVERAGE_STATES = ['FULL', 'PARTIAL', 'NONE', 'NOT_REQUIRED', 'UNKNOWN'] as const;
export type BorrowCoverageState = (typeof BORROW_COVERAGE_STATES)[number];

export const AGE_STATES = ['KNOWN', 'STALE', 'CLOCK_SKEWED', 'UNKNOWN'] as const;
export type AgeState = (typeof AGE_STATES)[number];

export const RATE_STATES = [
  'KNOWN',
  'STALE',
  'COUNTER_RESET',
  'INVALID_WINDOW',
  'CLOCK_SKEWED',
  'UNKNOWN',
] as const;
export type RateState = (typeof RATE_STATES)[number];

/** All health thresholds are supplied by the integration; this lane hides none. */
export interface DiagnosticsPolicy {
  heartbeatMaxAgeMs: number;
  cycleMaxAgeMs: number;
  /** Maximum age of the ending cumulative sample used for a rate. */
  rateMaxAgeMs: number;
  clockSkewToleranceMs: number;
  consecutiveFailuresDegradedAt: number;
  consecutiveFailuresFailedAt: number;
  /** Sequence gaps observed in the caller's diagnostic window. */
  maxSequenceGaps: number;
}

/** Two cumulative points from one logical writer. */
export interface CounterWindowEvidence {
  startAtMs: number;
  endAtMs: number;
  startCount: number;
  endCount: number;
}

export interface SourceDiagnosticEvidence {
  sourceId: string;
  required: boolean;
  authority: DataAuthority;
  timestamp: SourcedTimestamp | null;
  heartbeatAtMs: number | null;
  lastSuccessfulCycleAtMs: number | null;
  lastError: StructuredFailure | null;
  consecutiveFailures: number | null;
  eventCounter: CounterWindowEvidence | null;
  messageCounter: CounterWindowEvidence | null;
  reconnectCount: number | null;
  /** Gaps observed in the same bounded diagnostic window used by policy. */
  sequenceGapCount: number | null;
}

export interface RejectionCountEvidence {
  code: string;
  count: number;
}

export interface PipelineCountsEvidence {
  required: boolean;
  authority: DataAuthority;
  timestamp: SourcedTimestamp | null;
  universe: number | null;
  candidates: number | null;
  focus: number | null;
  proposals: number | null;
  rejectionCounts: readonly RejectionCountEvidence[] | null;
}

export interface BaselineEvidence {
  required: boolean;
  authority: DataAuthority;
  timestamp: SourcedTimestamp | null;
  state: BaselineState;
}

export interface BorrowCoverageEvidence {
  required: boolean;
  authority: DataAuthority;
  timestamp: SourcedTimestamp | null;
  /** Assets whose contemplated path requires current borrow truth. */
  requiredAssetCount: number | null;
  /** Required assets with current, usable borrow truth. */
  coveredAssetCount: number | null;
}

export interface SupervisorDiagnosticEvidence {
  authority: DataAuthority;
  snapshot: RuntimeStatusSnapshot;
}

export interface DiagnosticsInput {
  /** UTC milliseconds from the caller's real, replay, or test clock. */
  nowMs: number;
  correlationId: string;
  policy: DiagnosticsPolicy;
  supervisor: SupervisorDiagnosticEvidence | null;
  sources: readonly SourceDiagnosticEvidence[];
  counts: PipelineCountsEvidence | null;
  baseline: BaselineEvidence | null;
  borrow: BorrowCoverageEvidence | null;
}

export interface AgeDiagnostic {
  state: AgeState;
  atMs: number | null;
  ageMs: number | null;
  maxAgeMs: number;
}

export interface RateDiagnostic {
  state: RateState;
  perSecond: number | null;
  deltaCount: number | null;
  windowMs: number | null;
  startAtMs: number | null;
  endAtMs: number | null;
  /** Injected nowMs minus endAtMs; null when the counter window is absent. */
  ageMs: number | null;
  maxAgeMs: number;
}

export interface SourceDiagnostic {
  sourceId: string;
  required: boolean;
  declaredAuthority: DataAuthority;
  effectiveAuthority: DataAuthority;
  freshness: Readonly<FreshnessReport>;
  heartbeat: AgeDiagnostic;
  lastSuccessfulCycle: AgeDiagnostic;
  lastError: StructuredFailure | null;
  consecutiveFailures: number | null;
  eventRate: RateDiagnostic;
  messageRate: RateDiagnostic;
  reconnectCount: number | null;
  sequenceGapCount: number | null;
}

export interface ComponentDiagnostic {
  name: string;
  required: boolean;
  phase: RuntimePhase;
  authority: DataAuthority;
  heartbeat: AgeDiagnostic;
  lastError: StructuredFailure | null;
}

export interface FailedPreflightDiagnostic {
  gate: string;
  status: 'FAIL' | 'TIMEOUT';
  blocking: boolean;
  checkedAt: number | null;
}

export interface SupervisorDiagnostic {
  phase: RuntimePhase | 'UNKNOWN';
  declaredAuthority: DataAuthority;
  effectiveAuthority: DataAuthority;
  heartbeat: AgeDiagnostic;
  blockedAtGate: string | null;
  failedPreflight: readonly FailedPreflightDiagnostic[];
  components: readonly ComponentDiagnostic[];
  lastError: StructuredFailure | null;
}

export interface PipelineCountsDiagnostic {
  required: boolean | null;
  declaredAuthority: DataAuthority;
  effectiveAuthority: DataAuthority;
  freshness: Readonly<FreshnessReport>;
  universe: number | null;
  candidates: number | null;
  focus: number | null;
  proposals: number | null;
  rejectionCounts: readonly RejectionCountEvidence[] | null;
  totalRejections: number | null;
}

export interface BaselineDiagnostic {
  required: boolean | null;
  state: BaselineState;
  declaredAuthority: DataAuthority;
  effectiveAuthority: DataAuthority;
  freshness: Readonly<FreshnessReport>;
}

export interface BorrowCoverageDiagnostic {
  required: boolean | null;
  state: BorrowCoverageState;
  requiredAssetCount: number | null;
  coveredAssetCount: number | null;
  uncoveredAssetCount: number | null;
  /** Null for unknown and NOT_REQUIRED rather than a fabricated 0/1. */
  coverageRatio: number | null;
  declaredAuthority: DataAuthority;
  effectiveAuthority: DataAuthority;
  freshness: Readonly<FreshnessReport>;
}

export interface AuthorityLabel {
  label: string;
  declaredAuthority: DataAuthority;
  effectiveAuthority: DataAuthority;
  freshnessState: FreshnessReport['state'];
}

export interface HealthReason {
  state: Exclude<HealthState, 'HEALTHY'>;
  code: string;
  subject: string;
}

export interface OverallHealthDiagnostic {
  state: HealthState;
  reasons: readonly HealthReason[];
}

export interface DiagnosticsSnapshot {
  evaluatedAtMs: number;
  policy: DiagnosticsPolicy;
  supervisor: SupervisorDiagnostic;
  sources: readonly SourceDiagnostic[];
  counts: PipelineCountsDiagnostic;
  baseline: BaselineDiagnostic;
  borrow: BorrowCoverageDiagnostic;
  authorityLabels: readonly AuthorityLabel[];
  overall: OverallHealthDiagnostic;
}

export type DiagnosticsResult = ContractResult<
  Readonly<DiagnosticEnvelope<Readonly<DiagnosticsSnapshot>>>
>;

export const OBSERVABILITY_FAILURE_CODES = Object.freeze({
  EVIDENCE_INVALID: 'DIAGNOSTIC_EVIDENCE_INVALID',
} as const);
