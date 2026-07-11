/**
 * Foundation contracts — execution lifecycles and modes (WAVE 0, frozen).
 *
 * The exact plan/leg lifecycle unions and execution modes from the sprint
 * directive (section 11), plus the deterministic transition laws the Lane C
 * coordinator/reducer must obey.
 *
 * LAWS:
 *   - LIVE_MANUAL exists only as a blocked, future-compatible type; the mode
 *     gate returns LIVE_EXECUTION_NOT_IMPLEMENTED for it.
 *   - Unresolved exposure is never silently discarded: ONE_LEG_EXPOSED and
 *     RECOVERY_REQUIRED cannot transition straight to a happy terminal
 *     state; they resolve through CLOSING/RECONCILING or end in FAILED.
 *   - AMBIGUOUS is not terminal for a leg; it must resolve to a real
 *     outcome (or the plan escalates to RECOVERY_REQUIRED).
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import {
  createStructuredFailure,
  fail,
  ok,
  type ContractResult,
} from './failures.js';
import { isValidUtcMillis } from './time.js';
import { LIVE_EXECUTION_BLOCK_CODE } from './runtime.js';

// ---------- execution modes ----------

export const EXECUTION_MODES = ['VALIDATE_ONLY', 'PAPER', 'LIVE_MANUAL'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === 'string' && (EXECUTION_MODES as readonly string[]).includes(value);
}

export interface ExecutionModeCheckContext {
  /** From the caller's injected clock. */
  nowMs: number;
  correlationId: string;
}

/**
 * Gate a requested execution mode. Deterministic:
 *   - VALIDATE_ONLY / PAPER => ok (neither can reach a live venue).
 *   - LIVE_MANUAL => StructuredFailure LIVE_EXECUTION_NOT_IMPLEMENTED.
 *   - anything else => StructuredFailure INVALID_EXECUTION_MODE.
 */
export function checkExecutionModePermitted(
  mode: unknown,
  ctx: ExecutionModeCheckContext,
): ContractResult<ExecutionMode> {
  if (!isValidUtcMillis(ctx.nowMs)) {
    throw new TypeError('checkExecutionModePermitted: ctx.nowMs must be a valid UTC ms from an injected clock');
  }
  if (typeof ctx.correlationId !== 'string' || ctx.correlationId.length === 0) {
    throw new TypeError('checkExecutionModePermitted: ctx.correlationId must be a non-empty string');
  }
  if (!isExecutionMode(mode)) {
    return fail(
      createStructuredFailure({
        component: 'foundation.contracts.execution',
        stage: 'checkExecutionModePermitted',
        code: 'INVALID_EXECUTION_MODE',
        message: `execution mode ${JSON.stringify(mode)} is not a known ExecutionMode`,
        occurredAt: ctx.nowMs,
        retryable: false,
        safeCurrentState: 'UNCHANGED',
        recommendedOperatorAction: 'Use VALIDATE_ONLY or PAPER.',
        correlationId: ctx.correlationId,
      }),
    );
  }
  if (mode === 'LIVE_MANUAL') {
    return fail(
      createStructuredFailure({
        component: 'foundation.contracts.execution',
        stage: 'checkExecutionModePermitted',
        code: LIVE_EXECUTION_BLOCK_CODE,
        message: 'LIVE_MANUAL is a blocked future-compatible mode: live execution is not implemented in this build.',
        occurredAt: ctx.nowMs,
        retryable: false,
        safeCurrentState: 'UNCHANGED',
        recommendedOperatorAction: 'Use VALIDATE_ONLY or PAPER until a future audited release unlocks live execution.',
        correlationId: ctx.correlationId,
      }),
    );
  }
  return ok(mode);
}

// ---------- plan lifecycle ----------

export const PLAN_LIFECYCLES = [
  'CREATED',
  'AWAITING_APPROVAL',
  'PREFLIGHTING',
  'READY',
  'OPENING',
  'ONE_LEG_EXPOSED',
  'HEDGED_OPEN',
  'CLOSE_REQUESTED',
  'CLOSING',
  'RECONCILING',
  'CLOSED',
  'RECOVERY_REQUIRED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type PlanLifecycle = (typeof PLAN_LIFECYCLES)[number];

export function isPlanLifecycle(value: unknown): value is PlanLifecycle {
  return typeof value === 'string' && (PLAN_LIFECYCLES as readonly string[]).includes(value);
}

export const TERMINAL_PLAN_LIFECYCLES = ['CLOSED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;

export function isTerminalPlanLifecycle(state: PlanLifecycle): boolean {
  if (!isPlanLifecycle(state)) throw new TypeError(`isTerminalPlanLifecycle: invalid state ${JSON.stringify(state)}`);
  return (TERMINAL_PLAN_LIFECYCLES as readonly string[]).includes(state);
}

/**
 * Legal plan transitions. Design notes:
 *   - CREATED may skip approval only into PREFLIGHTING (validate-only flows);
 *     it can never reach OPENING without READY.
 *   - Exposure states resolve through close/reconcile paths; CLOSED is only
 *     reachable via CLOSING or RECONCILING.
 *   - EXPIRED is reachable only before capital is exposed (naked-duration
 *     expiry AFTER exposure is RECOVERY_REQUIRED, not EXPIRED).
 */
export const PLAN_LIFECYCLE_TRANSITIONS: Readonly<Record<PlanLifecycle, readonly PlanLifecycle[]>> =
  Object.freeze({
    CREATED: Object.freeze(['AWAITING_APPROVAL', 'PREFLIGHTING', 'CANCELLED', 'EXPIRED'] as const),
    AWAITING_APPROVAL: Object.freeze(['PREFLIGHTING', 'CANCELLED', 'EXPIRED'] as const),
    PREFLIGHTING: Object.freeze(['READY', 'FAILED', 'CANCELLED', 'EXPIRED'] as const),
    READY: Object.freeze(['OPENING', 'CANCELLED', 'EXPIRED'] as const),
    OPENING: Object.freeze(['ONE_LEG_EXPOSED', 'HEDGED_OPEN', 'RECONCILING', 'RECOVERY_REQUIRED', 'FAILED', 'CANCELLED'] as const),
    ONE_LEG_EXPOSED: Object.freeze(['HEDGED_OPEN', 'CLOSE_REQUESTED', 'CLOSING', 'RECONCILING', 'RECOVERY_REQUIRED', 'FAILED'] as const),
    HEDGED_OPEN: Object.freeze(['CLOSE_REQUESTED', 'RECONCILING', 'RECOVERY_REQUIRED', 'FAILED'] as const),
    CLOSE_REQUESTED: Object.freeze(['CLOSING', 'RECONCILING', 'RECOVERY_REQUIRED', 'FAILED'] as const),
    CLOSING: Object.freeze(['RECONCILING', 'CLOSED', 'ONE_LEG_EXPOSED', 'RECOVERY_REQUIRED', 'FAILED'] as const),
    RECONCILING: Object.freeze(['CLOSED', 'HEDGED_OPEN', 'ONE_LEG_EXPOSED', 'RECOVERY_REQUIRED', 'FAILED'] as const),
    RECOVERY_REQUIRED: Object.freeze(['RECONCILING', 'CLOSING', 'FAILED'] as const),
    CLOSED: Object.freeze([] as const),
    FAILED: Object.freeze([] as const),
    CANCELLED: Object.freeze([] as const),
    EXPIRED: Object.freeze([] as const),
  });

export function canTransitionPlanLifecycle(from: PlanLifecycle, to: PlanLifecycle): boolean {
  if (!isPlanLifecycle(from)) throw new TypeError(`canTransitionPlanLifecycle: invalid from-state ${JSON.stringify(from)}`);
  if (!isPlanLifecycle(to)) throw new TypeError(`canTransitionPlanLifecycle: invalid to-state ${JSON.stringify(to)}`);
  return PLAN_LIFECYCLE_TRANSITIONS[from].includes(to);
}

// ---------- leg lifecycle ----------

export const LEG_LIFECYCLES = [
  'PLANNED',
  'VALIDATED',
  'SUBMITTING',
  'ACKNOWLEDGED',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCEL_PENDING',
  'CANCELLED',
  'REJECTED',
  'AMBIGUOUS',
] as const;
export type LegLifecycle = (typeof LEG_LIFECYCLES)[number];

export function isLegLifecycle(value: unknown): value is LegLifecycle {
  return typeof value === 'string' && (LEG_LIFECYCLES as readonly string[]).includes(value);
}

export const TERMINAL_LEG_LIFECYCLES = ['FILLED', 'CANCELLED', 'REJECTED'] as const;

export function isTerminalLegLifecycle(state: LegLifecycle): boolean {
  if (!isLegLifecycle(state)) throw new TypeError(`isTerminalLegLifecycle: invalid state ${JSON.stringify(state)}`);
  return (TERMINAL_LEG_LIFECYCLES as readonly string[]).includes(state);
}

/**
 * Legal leg transitions. Design notes:
 *   - Response loss during SUBMITTING becomes AMBIGUOUS, never a guess.
 *   - AMBIGUOUS resolves only to evidence-backed outcomes.
 *   - CANCEL_PENDING may still FILL (cancel/fill race) — cancellation is a
 *     request, not a fact.
 *   - CANCELLED after partial fills still carries fills; quantity truth is
 *     the reducer's obligation, not encoded in the state name.
 */
export const LEG_LIFECYCLE_TRANSITIONS: Readonly<Record<LegLifecycle, readonly LegLifecycle[]>> =
  Object.freeze({
    PLANNED: Object.freeze(['VALIDATED', 'CANCELLED', 'REJECTED'] as const),
    VALIDATED: Object.freeze(['SUBMITTING', 'CANCELLED'] as const),
    SUBMITTING: Object.freeze(['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'AMBIGUOUS'] as const),
    ACKNOWLEDGED: Object.freeze(['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'AMBIGUOUS'] as const),
    PARTIALLY_FILLED: Object.freeze(['FILLED', 'CANCEL_PENDING', 'CANCELLED', 'AMBIGUOUS'] as const),
    CANCEL_PENDING: Object.freeze(['CANCELLED', 'FILLED', 'AMBIGUOUS'] as const),
    AMBIGUOUS: Object.freeze(['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED'] as const),
    FILLED: Object.freeze([] as const),
    CANCELLED: Object.freeze([] as const),
    REJECTED: Object.freeze([] as const),
  });

export function canTransitionLegLifecycle(from: LegLifecycle, to: LegLifecycle): boolean {
  if (!isLegLifecycle(from)) throw new TypeError(`canTransitionLegLifecycle: invalid from-state ${JSON.stringify(from)}`);
  if (!isLegLifecycle(to)) throw new TypeError(`canTransitionLegLifecycle: invalid to-state ${JSON.stringify(to)}`);
  return LEG_LIFECYCLE_TRANSITIONS[from].includes(to);
}
