import type {
  ActivePosition,
  ActivePositionId,
  CapitalLifecycleState,
  CapitalMandateId,
  ExternalExecutionReference,
  ExternalReconciliationReference,
  NonNegativeDecimal,
  PositionLeg,
  PositionState,
  PositionThesis,
  TruthMetadata,
} from '../contracts/index.js';
import type { ExecutionStateSlice, ReconciliationStateSlice } from '../contracts/ports.js';

export interface PositionLegProjectionInput
  extends Pick<PositionLeg, 'id' | 'instrumentId' | 'symbol' | 'side' | 'quantity' | 'quoteExposure' | 'valuationAsset' | 'externalLifecycle' | 'truth'> {}

export interface ActivePositionProjectionInput {
  readonly id?: ActivePositionId;
  readonly revision: number;
  readonly mandateId: CapitalMandateId;
  readonly thesis: Readonly<PositionThesis>;
  readonly sourceState: PositionState;
  readonly sourceCapitalLifecycle: CapitalLifecycleState;
  readonly legs: readonly Readonly<PositionLegProjectionInput>[];
  readonly oneLegSinceMs: number | null;
  readonly executionState: Readonly<ExecutionStateSlice> | null;
  readonly reconciliationState: Readonly<ReconciliationStateSlice> | null;
  readonly outstandingActionIntentIds: readonly string[];
  readonly openedAtMs: number;
  readonly lastTransitionAtMs: number;
  readonly truth: Readonly<TruthMetadata>;
  readonly projectedAtMs: number;
}

export const POSITION_PROJECTION_ISSUE_CODES = Object.freeze([
  'DUPLICATE_LEG_ID',
  'LEG_IDENTITY_INVALID',
  'LEG_EXPOSURE_INCONSISTENT',
  'LEG_LIFECYCLE_EXPOSURE_CONFLICT',
  'LEG_LIFECYCLE_EXPOSURE_UNCERTAIN',
  'LEG_TRUTH_NOT_COMPLETE',
  'EXECUTION_REFERENCE_MISSING',
  'RECONCILIATION_REFERENCE_MISSING',
  'EXECUTION_REFERENCE_INVALID',
  'RECONCILIATION_REFERENCE_INVALID',
  'EXTERNAL_CORRELATION_MISMATCH',
  'EXECUTION_LIFECYCLE_EXPOSURE_CONFLICT',
  'RECONCILIATION_UNCERTAIN',
  'RECONCILIATION_DIVERGED',
  'SOURCE_STATE_OVERRIDDEN',
] as const);
export type PositionProjectionIssueCode = (typeof POSITION_PROJECTION_ISSUE_CODES)[number];

export interface PositionProjectionIssue {
  readonly code: PositionProjectionIssueCode;
  readonly truthEffect: 'NONE' | 'PARTIAL' | 'UNKNOWN' | 'DIVERGENT';
  readonly detail: string;
  readonly legIds: readonly string[];
}

export interface ActivePositionProjection {
  readonly position: Readonly<ActivePosition>;
  readonly executionReference: Readonly<ExternalExecutionReference> | null;
  readonly reconciliationReference: Readonly<ExternalReconciliationReference> | null;
  readonly issues: readonly Readonly<PositionProjectionIssue>[];
  readonly supervisionPriority: 'EXPOSED_CAPITAL';
  readonly projectedAtMs: number;
}

export interface PositionExposureSummary {
  readonly grossExposure: NonNegativeDecimal;
  readonly longExposure: NonNegativeDecimal;
  readonly shortExposure: NonNegativeDecimal;
  readonly netDirectionalExposure: import('../contracts/index.js').ExactDecimal;
  readonly hedgeRatio: import('../contracts/index.js').ExactDecimal | null;
  readonly oneLegExposure: NonNegativeDecimal;
}
