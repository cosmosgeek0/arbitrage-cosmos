import type {
  CorrelationId,
  EventId,
  ExecutionMode,
  LegId,
  LegLifecycle,
  PlanId,
  PlanLifecycle,
  StateRevisionId,
  StructuredFailure,
  Venue,
} from '../contracts/index.js';

export const EXECUTION_CHECKPOINT_SCHEMA = 'cosmos.foundation.execution.checkpoint' as const;
export const EXECUTION_CHECKPOINT_VERSION = 1 as const;

export const BASIS_EXECUTION_DIRECTIONS = [
  'LONG_SPOT_SHORT_PERP',
  'SHORT_SPOT_LONG_PERP',
] as const;
export type BasisExecutionDirection = (typeof BASIS_EXECUTION_DIRECTIONS)[number];

export const EXECUTION_LEG_KEYS = ['SPOT', 'PERP'] as const;
export type ExecutionLegKey = (typeof EXECUTION_LEG_KEYS)[number];
export type ExecutionLegPhase = 'OPEN' | 'CLOSE';
export type OrderSide = 'BUY' | 'SELL';
export type RiskEffect = 'RISK_INCREASING' | 'RISK_REDUCING' | 'NEUTRAL';

export interface ProposalReference {
  canonicalProposalId: string;
  observedAtMs: number;
  maxAgeMs: number;
  expiresAtMs: number;
}

export interface CreateExecutionPlanInput {
  strategy: 'BASIS';
  direction: BasisExecutionDirection;
  symbol: string;
  proposal: ProposalReference;
  attempt: number;
  mode: ExecutionMode;
  requiresApproval: boolean;
  maxNakedDurationMs: number;
  spotQuantity: number;
  perpQuantity: number;
  openingOrder?: readonly [ExecutionLegKey, ExecutionLegKey];
}

export interface ExecutionLegDefinition {
  legId: LegId;
  key: ExecutionLegKey;
  phase: ExecutionLegPhase;
  role: 'SPOT_OPEN' | 'PERP_OPEN' | 'SPOT_CLOSE' | 'PERP_CLOSE';
  venue: Venue;
  side: OrderSide;
  quantity: number;
  reduceOnly: boolean;
  riskEffect: RiskEffect;
  clientOrderId: string;
}

export interface ExecutionPlanDefinition {
  planId: PlanId;
  correlationId: CorrelationId;
  /** Content fingerprint for every execution-affecting plan term. */
  termsFingerprint: string;
  strategy: 'BASIS';
  direction: BasisExecutionDirection;
  symbol: string;
  proposal: ProposalReference;
  attempt: number;
  mode: ExecutionMode;
  requiresApproval: boolean;
  maxNakedDurationMs: number;
  openingOrder: readonly [ExecutionLegKey, ExecutionLegKey];
  openingLegs: Readonly<Record<ExecutionLegKey, ExecutionLegDefinition>>;
  closingLegs: Readonly<Record<ExecutionLegKey, ExecutionLegDefinition>>;
}

export interface ExecutionLegState {
  definition: ExecutionLegDefinition;
  lifecycle: LegLifecycle;
  /** Quantity covered by the current deterministic client-order ID. */
  submittedQuantity: number;
  cumulativeFilledQuantity: number;
  venueOrderId: string | null;
  lastEventAtMs: number | null;
  lastFailure: StructuredFailure | null;
  /** Present after ambiguity is resolved so current-state readers need not infer from event history. */
  lastAmbiguityResolution?: AmbiguityResolution;
}

export interface ApprovalState {
  status: 'NOT_REQUIRED' | 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'EXPIRED';
  requestedAtMs: number | null;
  approvedAtMs: number | null;
  expiresAtMs: number | null;
}

export interface PreflightState {
  status: 'NOT_STARTED' | 'RUNNING' | 'PASSED' | 'FAILED';
  startedAtMs: number | null;
  completedAtMs: number | null;
  lastFailure: StructuredFailure | null;
}

export const EXECUTION_EVENT_TYPES = [
  'PLAN_CREATED',
  'APPROVAL_REQUESTED',
  'APPROVAL_GRANTED',
  'APPROVAL_EXPIRED',
  'PROPOSAL_EXPIRED',
  'ENTRY_WINDOW_EXPIRED',
  'PREFLIGHT_STARTED',
  'PREFLIGHT_PASSED',
  'PREFLIGHT_FAILED',
  'OPENING_STARTED',
  'LEG_VALIDATED',
  'LEG_SUBMISSION_STARTED',
  'LEG_ACKNOWLEDGED',
  'LEG_PARTIALLY_FILLED',
  'LEG_FILLED',
  'LEG_REJECTED',
  'LEG_RESPONSE_AMBIGUOUS',
  'LEG_AMBIGUITY_RESOLVED',
  'LEG_AMBIGUITY_UNRESOLVED',
  'LEG_CANCEL_REQUESTED',
  'LEG_CANCELLED',
  'CLOSE_REQUESTED',
  'CLOSING_STARTED',
  'RECONCILIATION_STARTED',
  'RECONCILIATION_RESOLVED',
  'RESTART_RECOVERY_BLOCKED',
  'NAKED_DURATION_EXPIRED',
  'PLAN_CANCELLED',
  'PLAN_FAILED',
] as const;
export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

export type AmbiguityResolution =
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  /** Deterministic client-order lookup proved no venue order exists. */
  | 'PROVEN_ABSENT';

/**
 * One serializable event envelope. Optional fields are validated according
 * to `type` by the reducer; no function, transport object, or secret-bearing
 * payload can enter the event stream.
 */
export interface ExecutionEvent {
  eventId: EventId;
  planId: PlanId;
  sequence: number;
  occurredAtMs: number;
  type: ExecutionEventType;
  phase?: ExecutionLegPhase;
  legKey?: ExecutionLegKey;
  approvalExpiresAtMs?: number;
  cumulativeFilledQuantity?: number;
  submittedQuantity?: number;
  venueOrderId?: string | null;
  failure?: StructuredFailure;
  ambiguityResolution?: AmbiguityResolution;
  emergency?: boolean;
  reconciliationOutcome?: 'CLOSED' | 'HEDGED_OPEN' | 'ONE_LEG_EXPOSED' | 'RECOVERY_REQUIRED';
  plan?: ExecutionPlanDefinition;
}

export interface ExecutionPlanState {
  plan: ExecutionPlanDefinition;
  lifecycle: PlanLifecycle;
  revision: number;
  stateRevisionId: StateRevisionId;
  lastSequence: number;
  createdAtMs: number;
  updatedAtMs: number;
  exposedSinceMs: number | null;
  approval: ApprovalState;
  preflight: PreflightState;
  openingLegs: Readonly<Record<ExecutionLegKey, ExecutionLegState>>;
  closingLegs: Readonly<Record<ExecutionLegKey, ExecutionLegState>>;
  processedEventIds: readonly EventId[];
  eventLog: readonly ExecutionEvent[];
  failures: readonly StructuredFailure[];
}

export type ReducerIgnoreReason =
  | 'DUPLICATE_EVENT'
  | 'STALE_EVENT'
  | 'PLAN_MISMATCH';

export type ReducerRejectReason =
  | 'INVALID_EVENT'
  | 'EVENT_SEQUENCE_GAP'
  | 'INVALID_PLAN_TRANSITION'
  | 'INVALID_LEG_TRANSITION'
  | 'UNRESOLVED_EXPOSURE'
  | 'INVARIANT_VIOLATION';

export type ExecutionReducerResult =
  | { readonly applied: true; readonly state: ExecutionPlanState }
  | { readonly applied: false; readonly state: ExecutionPlanState | null; readonly reason: ReducerIgnoreReason | ReducerRejectReason };

export interface ExecutionCheckpoint {
  schema: typeof EXECUTION_CHECKPOINT_SCHEMA;
  version: typeof EXECUTION_CHECKPOINT_VERSION;
  planId: PlanId;
  revision: number;
  state: ExecutionPlanState;
  checksum: string;
}

export type CheckpointRestoreResult =
  | { readonly ok: true; readonly state: ExecutionPlanState }
  | {
      readonly ok: false;
      readonly code:
        | 'CHECKPOINT_PARSE_FAILED'
        | 'CHECKPOINT_SCHEMA_UNSUPPORTED'
        | 'CHECKPOINT_CHECKSUM_MISMATCH'
        | 'CHECKPOINT_REPLAY_MISMATCH'
        | 'CHECKPOINT_STATE_INVALID'
        | 'CHECKPOINT_SECRET_FIELD_REJECTED'
        | 'CHECKPOINT_UNKNOWN_FIELD';
      readonly message: string;
    };

export interface PortFailure {
  code: string;
  message: string;
  retryable: boolean;
  recommendedOperatorAction: string;
}

export type PreflightPortResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: PortFailure };

export type SubmissionOutcome =
  | { readonly kind: 'ACKNOWLEDGED'; readonly venueOrderId: string | null }
  | { readonly kind: 'PARTIALLY_FILLED'; readonly venueOrderId: string | null; readonly cumulativeFilledQuantity: number }
  | { readonly kind: 'FILLED'; readonly venueOrderId: string | null; readonly cumulativeFilledQuantity: number }
  | { readonly kind: 'CANCELLED'; readonly venueOrderId: string | null; readonly cumulativeFilledQuantity: number }
  | { readonly kind: 'REJECTED'; readonly failure: PortFailure }
  | { readonly kind: 'AMBIGUOUS'; readonly failure: PortFailure };

export type LookupOutcome =
  | {
      readonly kind: 'FOUND';
      readonly status: 'ACKNOWLEDGED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
      readonly venueOrderId: string | null;
      readonly cumulativeFilledQuantity: number;
      readonly failure?: PortFailure;
    }
  | { readonly kind: 'PROVEN_ABSENT'; readonly failure: PortFailure }
  | { readonly kind: 'UNRESOLVED'; readonly failure: PortFailure };

export type ReconciliationOutcome =
  | { readonly kind: 'CLOSED' }
  | { readonly kind: 'HEDGED_OPEN' }
  | { readonly kind: 'ONE_LEG_EXPOSED' }
  | { readonly kind: 'UNRESOLVED'; readonly failure: PortFailure };

export interface LegOperationRequest {
  planId: PlanId;
  correlationId: CorrelationId;
  symbol: string;
  direction: BasisExecutionDirection;
  mode: 'VALIDATE_ONLY' | 'PAPER';
  phase: ExecutionLegPhase;
  leg: ExecutionLegDefinition;
}

export interface ExecutionCoordinatorPorts {
  /**
   * Durable/injected identity claim. CONFLICT means the same frozen PlanId
   * was previously bound to different terms; callers must increment attempt.
   */
  claimPlanIdentity(
    planId: PlanId,
    termsFingerprint: string,
  ): 'CLAIMED' | 'EXISTING_SAME' | 'CONFLICT';
  preflight(plan: ExecutionPlanDefinition): Promise<PreflightPortResult>;
  validateLeg(request: LegOperationRequest): Promise<PreflightPortResult>;
  /** Dormant abstract port. Implementations supplied to this sprint are fakes only. */
  submitPaper(request: LegOperationRequest): Promise<SubmissionOutcome>;
  lookupByClientOrderId(request: LegOperationRequest): Promise<LookupOutcome>;
  reconcile(state: ExecutionPlanState): Promise<ReconciliationOutcome>;
}

export interface ExecutionClock {
  nowMs(): number;
}

export type CoordinatorResult =
  | { readonly ok: true; readonly state: ExecutionPlanState }
  | { readonly ok: false; readonly state: ExecutionPlanState; readonly failure: StructuredFailure };

export const RECOVERY_ACTIONS = [
  'VERIFY_AMBIGUOUS_ORDER',
  'HEDGE_RESIDUAL',
  'CLOSE_EXPOSED_LEG',
  'CANCEL_REMAINDER',
  'MANUAL_REVIEW',
  'NO_ACTION',
] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export interface RecoveryRecommendation {
  action: RecoveryAction;
  riskEffect: RiskEffect;
  reason: string;
  phase: ExecutionLegPhase | null;
  legKey: ExecutionLegKey | null;
  clientOrderId: string | null;
  automatic: false;
}
