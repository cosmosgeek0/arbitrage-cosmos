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
import type {
  NormalBasisApprovedRiskBinding,
  NormalBasisRiskBindingRequest,
} from '../risk/types.js';

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
  /**
   * OPT-IN ONLY (default OFF). When omitted the produced plan is byte-identical
   * to the v1 plan, including termsFingerprint, LegIds, and client-order IDs.
   */
  normalBasis?: NormalBasisExecutionBindingRequest;
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
  /**
   * Present only for opt-in normal-Basis plans. The KEY IS ABSENT when the
   * binding is off, so canonical JSON, checkpoint checksums, and every v1
   * fingerprint stay byte-identical for existing callers.
   */
  normalBasisBinding?: NormalBasisPlanBinding;
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
  'NORMAL_BASIS_PROGRESS_OBSERVED',
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
  normalBasisObservation?: NormalBasisProgressObservation;
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
  /** Key absent for every legacy/unbound aggregate. */
  normalBasisProgress?: NormalBasisProgressState;
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

export const DEFAULT_EXECUTION_PORT_TIMEOUT_MS = 15_000;
export const MAXIMUM_EXECUTION_PORT_TIMEOUT_MS = 120_000;

export interface ExecutionPortCallContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly deadlineAtMs: number;
}

export interface ExecutionDeadlineHandle {
  cancel(): void;
}

export interface ExecutionDeadlineScheduler {
  schedule(delayMs: number, task: () => void): ExecutionDeadlineHandle;
}

export interface ExecutionCoordinatorDeadlineOptions {
  readonly portTimeoutMs?: number;
  readonly scheduler?: ExecutionDeadlineScheduler;
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
  preflight(plan: ExecutionPlanDefinition, context: Readonly<ExecutionPortCallContext>): Promise<PreflightPortResult>;
  validateLeg(request: LegOperationRequest, context: Readonly<ExecutionPortCallContext>): Promise<PreflightPortResult>;
  /** Dormant abstract port. Implementations supplied to this sprint are fakes only. */
  submitPaper(request: LegOperationRequest, context: Readonly<ExecutionPortCallContext>): Promise<SubmissionOutcome>;
  lookupByClientOrderId(request: LegOperationRequest, context: Readonly<ExecutionPortCallContext>): Promise<LookupOutcome>;
  reconcile(state: ExecutionPlanState, context: Readonly<ExecutionPortCallContext>): Promise<ReconciliationOutcome>;
}

export interface ExecutionClock extends ExecutionDeadlineScheduler {
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

// ---------------------------------------------------------------------------
// Normal-Basis plan/risk binding (additive, versioned, DEFAULT OFF)
//
// A binding is an immutable RECORD of the one sequence a normal (long spot /
// short USD-M) Basis plan may take, plus the risk truth it was authorized
// under. It grants no authority of any kind: `actionAuthority` is the literal
// NONE_RECORD_ONLY and `sendEligible` is the literal false. Nothing in this
// family opens a socket, signs a request, or sends an order.
//
// It is opt-in per plan. Callers that do not pass `normalBasis` observe no
// change whatsoever: same PlanId, same termsFingerprint, same LegIds, same
// client-order IDs, same checkpoint bytes.
// ---------------------------------------------------------------------------

export const NORMAL_BASIS_BINDING_SCHEMA = 'cosmos.foundation.execution.normalBasisBinding' as const;
export const NORMAL_BASIS_BINDING_VERSION = 1 as const;

/** The only direction this binding describes. Reverse Basis is out of scope. */
export const NORMAL_BASIS_DIRECTION = 'LONG_SPOT_SHORT_PERP' as const;

/**
 * THE bound sequence. Spot is acquired first, hedged by the USD-M short, and
 * unwound short-leg-first so the hedge never lifts before the asset it hedges.
 */
export const NORMAL_BASIS_STEP_ORDER = ['SPOT_OPEN', 'PERP_OPEN', 'PERP_CLOSE', 'SPOT_CLOSE'] as const;
export type NormalBasisStep = (typeof NORMAL_BASIS_STEP_ORDER)[number];

/** Bounded re-close budget; cancel/query address the same attempt order ID. */
export const NORMAL_BASIS_MAX_CLOSE_ATTEMPTS = 4 as const;
export const NORMAL_BASIS_MAX_JOURNAL_ENTRIES = 128 as const;

export type NormalBasisPrecondition =
  /** Entry leg: only the plan-level windows and risk verdict gate it. */
  | 'NONE'
  /** Net Spot fill must be terminal (FILLED) or cancel-confirmed (CANCELLED). */
  | 'SPOT_OPEN_NET_FILL_TERMINAL_OR_CANCEL_CONFIRMED'
  /** A reduce-only USD-M close needs an observed hedge residual to reduce. */
  | 'PERP_HEDGE_RESIDUAL_PRESENT'
  /** Spot may only be released once the USD-M reduce-only close is terminal. */
  | 'PERP_CLOSE_TERMINAL_REDUCE_ONLY';

export interface NormalBasisStepBinding {
  readonly step: NormalBasisStep;
  readonly phase: ExecutionLegPhase;
  readonly legKey: ExecutionLegKey;
  readonly role: ExecutionLegDefinition['role'];
  readonly venue: Venue;
  readonly side: OrderSide;
  readonly reduceOnly: boolean;
  readonly riskEffect: RiskEffect;
  /** Steps that must be satisfied before this one, in bound order. */
  readonly requires: readonly NormalBasisStep[];
  readonly precondition: NormalBasisPrecondition;
  /** Attempt-0 identity; identical to the v1 leg client-order ID. */
  readonly clientOrderId: string;
}

/** One bounded, distinct close-order identity. Cancel/query reuse this ID. */
export interface NormalBasisAttemptIdentity {
  readonly attempt: number;
  readonly step: Extract<NormalBasisStep, 'PERP_CLOSE' | 'SPOT_CLOSE'>;
  readonly clientOrderId: string;
}

/** The opt-in request contains real risk evaluation input, never assertions. */
export type NormalBasisExecutionBindingRequest = NormalBasisRiskBindingRequest;

export interface NormalBasisPlanBinding {
  readonly schema: typeof NORMAL_BASIS_BINDING_SCHEMA;
  readonly version: typeof NORMAL_BASIS_BINDING_VERSION;
  /** Content digest over every field below; the binding's immutable identity. */
  readonly bindingId: string;
  readonly planId: PlanId;
  readonly correlationId: CorrelationId;
  /** The v1 plan fingerprint this binding is bound to, never a replacement. */
  readonly termsFingerprint: string;
  readonly direction: typeof NORMAL_BASIS_DIRECTION;
  readonly symbol: string;
  readonly stepOrder: readonly NormalBasisStep[];
  readonly steps: Readonly<Record<NormalBasisStep, NormalBasisStepBinding>>;
  /** The existing one-leg (naked) cap, restated as a bound term. */
  readonly maxNakedDurationMs: number;
  /** Earliest entry-only horizon. It deliberately does not expire a close. */
  readonly entryExpiresAtMs: number;
  readonly proposalExpiresAtMs: number;
  readonly risk: NormalBasisApprovedRiskBinding;
  readonly maxCloseAttempts: typeof NORMAL_BASIS_MAX_CLOSE_ATTEMPTS;
  readonly closeAttempts: readonly NormalBasisAttemptIdentity[];
  readonly policy: NormalBasisPolicyTerms;
  /** Literal, non-negotiable. This record authorizes nothing. */
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly riskAuthority: 'NONE';
  readonly sendEligible: false;
}

/** Every term is a literal; a binding cannot be built with a policy relaxed. */
export interface NormalBasisPolicyTerms {
  readonly requireTerminalOrCancelConfirmedSpotFillBeforeHedge: true;
  readonly requireReduceOnlyUsdmCloseBeforeSpotClose: true;
  readonly queryFirstOnAmbiguity: true;
  readonly allowBlindResubmit: false;
  readonly requireBaselineFlatReconciliation: true;
  /** An in-memory reducer/checkpoint is not an atomic external-action ledger. */
  readonly crossProcessExactlyOnce: false;
  readonly ledgerCasRequiredForExactlyOnce: true;
}

export const NORMAL_BASIS_ATTEMPT_STATES = [
  'SUBMISSION_STARTED',
  'WORKING',
  'AMBIGUOUS',
  'QUERY_STARTED',
  'CANCEL_REQUESTED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'PROVEN_ABSENT',
] as const;
export type NormalBasisAttemptState = (typeof NORMAL_BASIS_ATTEMPT_STATES)[number];

export interface NormalBasisOrderObservation {
  readonly kind: 'ORDER';
  readonly journalIndex: number;
  readonly occurredAtMs: number;
  readonly step: NormalBasisStep;
  readonly attempt: number;
  readonly state: NormalBasisAttemptState;
  /** Order identity for submit, lookup, and cancel alike. */
  readonly clientOrderId: string;
  readonly submittedQuantity: number;
  readonly cumulativeFilledQuantity: number;
}

export interface NormalBasisBaselineObservation {
  readonly kind: 'BASELINE';
  readonly journalIndex: number;
  readonly occurredAtMs: number;
  readonly bindingId: string;
  /** Exact aggregate revision observed immediately before reconciliation. */
  readonly observedStateRevisionId: StateRevisionId;
  readonly observedStateRevision: number;
  readonly spotSignedBaseQty: number;
  readonly perpSignedBaseQty: number;
}

export type NormalBasisProgressObservation =
  | NormalBasisOrderObservation
  | NormalBasisBaselineObservation;

export type NormalBasisNext =
  | NormalBasisStep
  | 'BASELINE_RECONCILIATION'
  | 'COMPLETE';

export type NormalBasisProgressDisposition =
  | 'SUBMIT_ELIGIBLE'
  | 'QUERY_REQUIRED'
  | 'CANCEL_ELIGIBLE'
  | 'AWAIT_TERMINAL'
  | 'ATTEMPT_BUDGET_EXHAUSTED'
  | 'OBSERVE_BASELINE'
  | 'COMPLETE';

/** Pure instruction record only. It never carries permission to send. */
export interface NormalBasisProgressAction {
  readonly disposition: NormalBasisProgressDisposition;
  readonly step: NormalBasisStep | null;
  readonly attempt: number | null;
  readonly clientOrderId: string | null;
  readonly quantity: number | null;
  readonly sendEligible: false;
}

/**
 * Pure projection over an append-only bounded journal. It is checkpointable
 * evidence, not a send capability or a cross-process exactly-once claim.
 */
export interface NormalBasisProgressState {
  readonly bindingId: string;
  readonly journal: readonly Readonly<NormalBasisProgressObservation>[];
  readonly next: NormalBasisNext;
  readonly nextAttempt: number | null;
  readonly expectedQuantity: number | null;
  /** Null until the step has terminal fill evidence; close values aggregate retries. */
  readonly terminalNetFilledQuantityByStep: Readonly<Record<NormalBasisStep, number | null>>;
  readonly workingOrAmbiguousClientOrderId: string | null;
  readonly baselineFlat: boolean;
  readonly complete: boolean;
  readonly action: Readonly<NormalBasisProgressAction>;
  readonly deliveryGuarantee: 'PROCESS_LOCAL_REPLAY_ONLY_REQUIRES_LEDGER_CAS';
}

export type NormalBasisProgressResult =
  | { readonly applied: true; readonly progress: NormalBasisProgressState }
  | {
      readonly applied: false;
      readonly progress: NormalBasisProgressState;
      readonly code: NormalBasisGateCode;
      readonly reason: string;
    };

export const NORMAL_BASIS_GATE_CODES = [
  'BINDING_ABSENT',
  'STEP_OUT_OF_ORDER',
  'SPOT_FILL_NOT_TERMINAL',
  'SPOT_FILL_ABSENT',
  'HEDGE_RESIDUAL_ABSENT',
  'PERP_CLOSE_NOT_TERMINAL',
  'AMBIGUITY_REQUIRES_QUERY_FIRST',
  'BLIND_RESUBMIT_BLOCKED',
  'ATTEMPT_BUDGET_EXHAUSTED',
  'ENTRY_AUTHORITY_EXPIRED',
  'WORKING_OR_AMBIGUOUS_CAP',
  'TERMINAL_NET_FILL_REQUIRED',
  'JOURNAL_INVALID',
  'RECONCILIATION_NOT_BASELINE_FLAT',
] as const;
export type NormalBasisGateCode = (typeof NORMAL_BASIS_GATE_CODES)[number];

export type NormalBasisGateDecision =
  | { readonly allowed: true; readonly step: NormalBasisStep }
  | {
      readonly allowed: false;
      readonly step: NormalBasisStep;
      readonly code: NormalBasisGateCode;
      readonly reason: string;
    };

export type NormalBasisBindingComparison =
  | 'ABSENT_BOTH'
  | 'ABSENT_ONE'
  | 'SAME_BINDING'
  | 'CONFLICTING_BINDING';
