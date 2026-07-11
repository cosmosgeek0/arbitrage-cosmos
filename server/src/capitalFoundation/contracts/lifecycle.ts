import {
  createStructuredFailure,
  fail,
  isValidUtcMillis,
  ok,
  type ContractResult,
} from '../../foundation/contracts/index.js';

export const CAPITAL_LIFECYCLE_STATES = [
  'OBSERVED',
  'ELIGIBLE',
  'BLOCKED',
  'ADVISORY',
  'RESERVED',
  'PLANNED',
  'AWAITING_APPROVAL',
  'AWAITING_RISK',
  'READY_FOR_EXECUTION',
  'ENTERING',
  'PARTIALLY_EXPOSED',
  'HEDGED',
  'ACTIVE',
  'REDUCING',
  'EXITING',
  'RECOVERY_REQUIRED',
  'CLOSED',
  'CANCELLED',
  'EXPIRED',
  'UNKNOWN',
] as const;
export type CapitalLifecycleState = (typeof CAPITAL_LIFECYCLE_STATES)[number];

export const TERMINAL_CAPITAL_LIFECYCLE_STATES = ['CLOSED', 'CANCELLED', 'EXPIRED'] as const;

export const CAPITAL_LIFECYCLE_TRANSITIONS: Readonly<
  Record<CapitalLifecycleState, readonly CapitalLifecycleState[]>
> = Object.freeze({
  OBSERVED: Object.freeze(['ELIGIBLE', 'BLOCKED', 'ADVISORY', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const),
  ELIGIBLE: Object.freeze(['RESERVED', 'BLOCKED', 'ADVISORY', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const),
  BLOCKED: Object.freeze(['OBSERVED', 'ELIGIBLE', 'ADVISORY', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const),
  ADVISORY: Object.freeze(['OBSERVED', 'ELIGIBLE', 'BLOCKED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const),
  RESERVED: Object.freeze(['PLANNED', 'BLOCKED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const),
  PLANNED: Object.freeze(['AWAITING_APPROVAL', 'BLOCKED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const),
  AWAITING_APPROVAL: Object.freeze(['AWAITING_RISK', 'BLOCKED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const),
  AWAITING_RISK: Object.freeze(['READY_FOR_EXECUTION', 'BLOCKED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const),
  READY_FOR_EXECUTION: Object.freeze(['ENTERING', 'BLOCKED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'] as const),
  ENTERING: Object.freeze(['PARTIALLY_EXPOSED', 'HEDGED', 'ACTIVE', 'RECOVERY_REQUIRED', 'UNKNOWN'] as const),
  PARTIALLY_EXPOSED: Object.freeze(['HEDGED', 'ACTIVE', 'REDUCING', 'EXITING', 'RECOVERY_REQUIRED', 'UNKNOWN'] as const),
  HEDGED: Object.freeze(['ACTIVE', 'REDUCING', 'EXITING', 'RECOVERY_REQUIRED', 'UNKNOWN'] as const),
  ACTIVE: Object.freeze(['REDUCING', 'EXITING', 'RECOVERY_REQUIRED', 'UNKNOWN'] as const),
  REDUCING: Object.freeze(['ACTIVE', 'HEDGED', 'EXITING', 'RECOVERY_REQUIRED', 'CLOSED', 'UNKNOWN'] as const),
  EXITING: Object.freeze(['CLOSED', 'RECOVERY_REQUIRED', 'UNKNOWN'] as const),
  RECOVERY_REQUIRED: Object.freeze(['REDUCING', 'EXITING', 'CLOSED', 'UNKNOWN'] as const),
  CLOSED: Object.freeze([] as const),
  CANCELLED: Object.freeze([] as const),
  EXPIRED: Object.freeze([] as const),
  UNKNOWN: Object.freeze(['OBSERVED', 'BLOCKED', 'PARTIALLY_EXPOSED', 'RECOVERY_REQUIRED', 'CANCELLED', 'EXPIRED'] as const),
});

export function isCapitalLifecycleState(value: unknown): value is CapitalLifecycleState {
  return typeof value === 'string'
    && (CAPITAL_LIFECYCLE_STATES as readonly string[]).includes(value);
}

export function canTransitionCapitalLifecycle(
  from: CapitalLifecycleState,
  to: CapitalLifecycleState,
): boolean {
  if (!isCapitalLifecycleState(from) || !isCapitalLifecycleState(to)) {
    throw new TypeError('capital lifecycle transition contains an unknown state');
  }
  return CAPITAL_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export interface CapitalTransitionEvidence {
  readonly nowMs: number;
  readonly correlationId: string;
  readonly approvalValidated: boolean;
  readonly approvalMode: 'READ_ONLY' | 'ADVISORY' | 'VALIDATE_ONLY' | 'MANUAL_ARMED' | null;
  readonly boundRiskAllowed: boolean;
  readonly boundRiskCurrent: boolean;
}

export interface CapitalTransitionReceipt {
  readonly from: CapitalLifecycleState;
  readonly to: CapitalLifecycleState;
  readonly transitionedAtMs: number;
  readonly correlationId: string;
}

/**
 * Authoritative lifecycle transition guard. The boolean helper above is for
 * graph inspection only; state reducers must use this typed result.
 */
export function transitionCapitalLifecycle(
  from: CapitalLifecycleState,
  to: CapitalLifecycleState,
  evidence: CapitalTransitionEvidence,
): ContractResult<Readonly<CapitalTransitionReceipt>> {
  if (!isValidUtcMillis(evidence.nowMs) || evidence.correlationId.trim().length === 0) {
    throw new TypeError('capital transition requires injected UTC time and a correlation ID');
  }
  const reject = (code: string, message: string) => fail<Readonly<CapitalTransitionReceipt>>(
    createStructuredFailure({
      component: 'capitalFoundation.contracts.lifecycle',
      stage: `${from}->${to}`,
      code,
      message,
      occurredAt: evidence.nowMs,
      retryable: false,
      safeCurrentState: from,
      recommendedOperatorAction: 'Satisfy the named transition gate and retry with a new state revision.',
      correlationId: evidence.correlationId,
    }),
  );
  if (!canTransitionCapitalLifecycle(from, to)) {
    return reject('ILLEGAL_CAPITAL_LIFECYCLE_TRANSITION', `${from} cannot transition to ${to}`);
  }
  if (from === 'AWAITING_APPROVAL' && to === 'AWAITING_RISK') {
    if (!evidence.approvalValidated || (evidence.approvalMode !== 'VALIDATE_ONLY' && evidence.approvalMode !== 'MANUAL_ARMED')) {
      return reject('APPROVAL_REQUIRED_FOR_RISK', 'a current VALIDATE_ONLY or MANUAL_ARMED approval is required before external risk evaluation');
    }
  }
  if (from === 'AWAITING_RISK' && to === 'READY_FOR_EXECUTION') {
    if (!evidence.approvalValidated || evidence.approvalMode !== 'MANUAL_ARMED') {
      return reject('MANUAL_ARMED_APPROVAL_REQUIRED', 'only a current MANUAL_ARMED approval may become execution-ready');
    }
    if (!evidence.boundRiskAllowed || !evidence.boundRiskCurrent) {
      return reject('BOUND_CURRENT_RISK_REQUIRED', 'a current allowed Foundation risk verdict bound to this mandate is required');
    }
  }
  return ok(Object.freeze({
    from,
    to,
    transitionedAtMs: evidence.nowMs,
    correlationId: evidence.correlationId,
  }));
}

export const CAPITAL_STAGES = ['OBSERVE', 'PROBE', 'CONFIRM', 'ADD', 'HOLD', 'REDUCE', 'EXIT'] as const;
export type CapitalStage = (typeof CAPITAL_STAGES)[number];

export const CAPITAL_STAGE_TRANSITIONS: Readonly<Record<CapitalStage, readonly CapitalStage[]>> = Object.freeze({
  OBSERVE: Object.freeze(['PROBE', 'CONFIRM', 'HOLD', 'EXIT'] as const),
  PROBE: Object.freeze(['CONFIRM', 'HOLD', 'REDUCE', 'EXIT'] as const),
  CONFIRM: Object.freeze(['ADD', 'HOLD', 'REDUCE', 'EXIT'] as const),
  ADD: Object.freeze(['HOLD', 'REDUCE', 'EXIT'] as const),
  HOLD: Object.freeze(['ADD', 'REDUCE', 'EXIT'] as const),
  REDUCE: Object.freeze(['HOLD', 'REDUCE', 'EXIT'] as const),
  EXIT: Object.freeze([] as const),
});

export function canTransitionCapitalStage(from: CapitalStage, to: CapitalStage): boolean {
  if (!(CAPITAL_STAGES as readonly string[]).includes(from) || !(CAPITAL_STAGES as readonly string[]).includes(to)) {
    throw new TypeError('capital stage transition contains an unknown stage');
  }
  return CAPITAL_STAGE_TRANSITIONS[from].includes(to);
}

export interface CapitalStageTransitionEvidence {
  readonly nowMs: number;
  readonly correlationId: string;
  readonly freshEvidence: boolean;
  readonly reservationAvailable: boolean;
  readonly approvalValidated: boolean;
  readonly futureRiskRecheckRequired: boolean;
  readonly adversePriceMoveIsSoleReason: boolean;
}

export interface CapitalStageTransitionReceipt {
  readonly from: CapitalStage;
  readonly to: CapitalStage;
  readonly transitionedAtMs: number;
  readonly correlationId: string;
}

export function transitionCapitalStage(
  from: CapitalStage,
  to: CapitalStage,
  evidence: CapitalStageTransitionEvidence,
): ContractResult<Readonly<CapitalStageTransitionReceipt>> {
  if (!isValidUtcMillis(evidence.nowMs) || evidence.correlationId.trim().length === 0) {
    throw new TypeError('capital stage transition requires injected UTC time and a correlation ID');
  }
  const reject = (code: string, message: string) => fail<Readonly<CapitalStageTransitionReceipt>>(
    createStructuredFailure({
      component: 'capitalFoundation.contracts.lifecycle',
      stage: `stage:${from}->${to}`,
      code,
      message,
      occurredAt: evidence.nowMs,
      retryable: false,
      safeCurrentState: from,
      recommendedOperatorAction: 'Satisfy the named stage gate before requesting another transition.',
      correlationId: evidence.correlationId,
    }),
  );
  if (!canTransitionCapitalStage(from, to)) {
    return reject('ILLEGAL_CAPITAL_STAGE_TRANSITION', `${from} cannot transition to ${to}`);
  }
  if (to === 'ADD') {
    if (evidence.adversePriceMoveIsSoleReason) {
      return reject('AVERAGING_DOWN_FORBIDDEN', 'adverse price movement alone cannot authorize an exposure increase');
    }
    if (!evidence.freshEvidence) return reject('FRESH_EVIDENCE_REQUIRED', 'ADD requires fresh evidence');
    if (!evidence.reservationAvailable) return reject('RESERVATION_REQUIRED', 'ADD requires available reservation');
    if (!evidence.approvalValidated) return reject('APPROVAL_REQUIRED', 'ADD requires current scoped approval');
    if (!evidence.futureRiskRecheckRequired) return reject('FUTURE_RISK_RECHECK_REQUIRED', 'ADD must remain gated by a future Foundation risk recheck');
  }
  return ok(Object.freeze({ from, to, transitionedAtMs: evidence.nowMs, correlationId: evidence.correlationId }));
}
