import {
  canonicalJson,
  canTransitionLegLifecycle,
  canTransitionPlanLifecycle,
  deriveEventId,
  deriveStateRevisionId,
  findSecretLikePaths,
  findSerializabilityIssues,
  isStructuredFailure,
  isTerminalPlanLifecycle,
  isValidUtcMillis,
  type LegLifecycle,
  type PlanLifecycle,
  type StructuredFailure,
} from '../contracts/index.js';
import { createExecutionPlanDefinition } from './plan.js';
import {
  EXECUTION_EVENT_TYPES,
  EXECUTION_LEG_KEYS,
  type ExecutionEvent,
  type ExecutionLegKey,
  type ExecutionLegPhase,
  type ExecutionLegState,
  type ExecutionPlanState,
  type ExecutionReducerResult,
} from './types.js';

const EPSILON = 1e-12;

const BASE_EVENT_KEYS = ['eventId', 'planId', 'sequence', 'occurredAtMs', 'type'] as const;
const EVENT_DETAIL_KEYS: Readonly<Record<ExecutionEvent['type'], readonly string[]>> = Object.freeze({
  PLAN_CREATED: ['plan'],
  APPROVAL_REQUESTED: ['approvalExpiresAtMs'],
  APPROVAL_GRANTED: [],
  APPROVAL_EXPIRED: [],
  PROPOSAL_EXPIRED: [],
  ENTRY_WINDOW_EXPIRED: ['failure'],
  PREFLIGHT_STARTED: [],
  PREFLIGHT_PASSED: [],
  PREFLIGHT_FAILED: ['failure'],
  OPENING_STARTED: [],
  LEG_VALIDATED: ['phase', 'legKey'],
  LEG_SUBMISSION_STARTED: ['phase', 'legKey', 'submittedQuantity'],
  LEG_ACKNOWLEDGED: ['phase', 'legKey', 'venueOrderId'],
  LEG_PARTIALLY_FILLED: ['phase', 'legKey', 'cumulativeFilledQuantity', 'venueOrderId'],
  LEG_FILLED: ['phase', 'legKey', 'cumulativeFilledQuantity', 'venueOrderId'],
  LEG_REJECTED: ['phase', 'legKey', 'failure'],
  LEG_RESPONSE_AMBIGUOUS: ['phase', 'legKey', 'failure'],
  LEG_AMBIGUITY_RESOLVED: ['phase', 'legKey', 'ambiguityResolution', 'cumulativeFilledQuantity', 'venueOrderId', 'failure'],
  LEG_AMBIGUITY_UNRESOLVED: ['phase', 'legKey', 'failure'],
  LEG_CANCEL_REQUESTED: ['phase', 'legKey'],
  LEG_CANCELLED: ['phase', 'legKey', 'cumulativeFilledQuantity', 'venueOrderId'],
  CLOSE_REQUESTED: ['emergency'],
  CLOSING_STARTED: [],
  RECONCILIATION_STARTED: [],
  RECONCILIATION_RESOLVED: ['reconciliationOutcome', 'failure'],
  NAKED_DURATION_EXPIRED: [],
  PLAN_CANCELLED: [],
  PLAN_FAILED: ['failure'],
});

const PAPER_ONLY_EVENT_TYPES = new Set<ExecutionEvent['type']>([
  'OPENING_STARTED',
  'LEG_SUBMISSION_STARTED',
  'LEG_ACKNOWLEDGED',
  'LEG_PARTIALLY_FILLED',
  'LEG_FILLED',
  'LEG_RESPONSE_AMBIGUOUS',
  'LEG_AMBIGUITY_RESOLVED',
  'LEG_AMBIGUITY_UNRESOLVED',
  'LEG_CANCEL_REQUESTED',
  'LEG_CANCELLED',
  'CLOSE_REQUESTED',
  'CLOSING_STARTED',
  'RECONCILIATION_STARTED',
  'RECONCILIATION_RESOLVED',
  'NAKED_DURATION_EXPIRED',
]);

function freezeEvent(event: ExecutionEvent): Readonly<ExecutionEvent> {
  return Object.freeze({ ...event });
}

function initialLeg(definition: ExecutionLegState['definition']): Readonly<ExecutionLegState> {
  return Object.freeze({
    definition,
    lifecycle: 'PLANNED' as const,
    submittedQuantity: 0,
    cumulativeFilledQuantity: 0,
    venueOrderId: null,
    lastEventAtMs: null,
    lastFailure: null,
  });
}

function freezeLegRecord(
  record: Record<ExecutionLegKey, ExecutionLegState>,
): Readonly<Record<ExecutionLegKey, ExecutionLegState>> {
  return Object.freeze({ SPOT: Object.freeze(record.SPOT), PERP: Object.freeze(record.PERP) });
}

function validEventEnvelope(event: ExecutionEvent): boolean {
  const structurallyValid = (
    typeof event === 'object' &&
    event !== null &&
    typeof event.eventId === 'string' &&
    event.eventId.startsWith('evt_') &&
    typeof event.planId === 'string' &&
    event.planId.startsWith('plan_') &&
    Number.isSafeInteger(event.sequence) &&
    event.sequence >= 0 &&
    isValidUtcMillis(event.occurredAtMs) &&
    (EXECUTION_EVENT_TYPES as readonly string[]).includes(event.type)
  );
  if (!structurallyValid) return false;
  const allowedKeys = new Set<string>([...BASE_EVENT_KEYS, ...EVENT_DETAIL_KEYS[event.type]]);
  if (Object.keys(event).some((key) => !allowedKeys.has(key))) return false;
  if (findSecretLikePaths(event).length > 0 || findSerializabilityIssues(event).length > 0) return false;
  try {
    canonicalJson(event);
  } catch {
    return false;
  }
  return event.eventId === deriveEventId({ streamId: `execution:${event.planId}`, sequence: event.sequence });
}

function validLegTarget(event: ExecutionEvent): event is ExecutionEvent & {
  phase: ExecutionLegPhase;
  legKey: ExecutionLegKey;
} {
  return (
    (event.phase === 'OPEN' || event.phase === 'CLOSE') &&
    (EXECUTION_LEG_KEYS as readonly string[]).includes(event.legKey ?? '')
  );
}

function knownResidual(state: Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'>, key: ExecutionLegKey): number {
  return Math.max(
    0,
    state.openingLegs[key].cumulativeFilledQuantity - state.closingLegs[key].cumulativeFilledQuantity,
  );
}

function hasOverClose(state: Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'>): boolean {
  return EXECUTION_LEG_KEYS.some(
    (key) => state.closingLegs[key].cumulativeFilledQuantity > state.openingLegs[key].cumulativeFilledQuantity + EPSILON,
  );
}

export function hasKnownOpenExposure(state: Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'>): boolean {
  return EXECUTION_LEG_KEYS.some((key) => knownResidual(state, key) > EPSILON);
}

export function hasAmbiguousLeg(state: Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'>): boolean {
  return EXECUTION_LEG_KEYS.some(
    (key) => state.openingLegs[key].lifecycle === 'AMBIGUOUS' || state.closingLegs[key].lifecycle === 'AMBIGUOUS',
  );
}

const ACTIVE_ORDER_LIFECYCLES: ReadonlySet<LegLifecycle> = new Set([
  'SUBMITTING',
  'ACKNOWLEDGED',
  'PARTIALLY_FILLED',
  'CANCEL_PENDING',
  'AMBIGUOUS',
]);

export function hasActiveWorkingLeg(state: Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'>): boolean {
  return EXECUTION_LEG_KEYS.some(
    (key) => ACTIVE_ORDER_LIFECYCLES.has(state.openingLegs[key].lifecycle) || ACTIVE_ORDER_LIFECYCLES.has(state.closingLegs[key].lifecycle),
  );
}

function normalizedResidual(state: Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'>, key: ExecutionLegKey): number {
  return knownResidual(state, key) / state.openingLegs[key].definition.quantity;
}

export function hasNakedExposure(state: Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'>): boolean {
  if (hasAmbiguousLeg(state)) return true;
  // A submitting/working order can create exposure before its response is
  // observed, so the bounded naked timer starts at submission, not receipt.
  if (hasActiveWorkingLeg(state)) return true;
  return Math.abs(normalizedResidual(state, 'SPOT') - normalizedResidual(state, 'PERP')) > EPSILON;
}

function validateFillQuantity(
  leg: ExecutionLegState,
  value: unknown,
  complete: boolean,
  maximumVenueQuantity: number,
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
  const target = leg.submittedQuantity;
  if (target <= 0 || target > maximumVenueQuantity + EPSILON) return false;
  if (value + EPSILON < leg.cumulativeFilledQuantity || value - EPSILON > target) return false;
  if (value - EPSILON > maximumVenueQuantity) return false;
  if (complete && Math.abs(value - target) > EPSILON) return false;
  if (!complete && value >= target - EPSILON) return false;
  return true;
}

function validCancellationCumulative(leg: ExecutionLegState, value: unknown, maximumVenueQuantity: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value + EPSILON >= leg.cumulativeFilledQuantity &&
    value <= leg.submittedQuantity + EPSILON &&
    value <= maximumVenueQuantity + EPSILON
  );
}

function isSafelyHedged(state: Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'>): boolean {
  if (!hasKnownOpenExposure(state) || hasAmbiguousLeg(state) || hasOverClose(state)) return false;
  const hasPendingOpeningOrder = EXECUTION_LEG_KEYS.some((key) => ACTIVE_ORDER_LIFECYCLES.has(state.openingLegs[key].lifecycle));
  return !hasPendingOpeningOrder && Math.abs(normalizedResidual(state, 'SPOT') - normalizedResidual(state, 'PERP')) <= EPSILON;
}

function makeInitialState(event: ExecutionEvent): ExecutionReducerResult {
  if (event.sequence !== 1 || event.type !== 'PLAN_CREATED' || event.plan === undefined || event.plan.planId !== event.planId) {
    return Object.freeze({ applied: false as const, state: null, reason: 'INVALID_EVENT' as const });
  }
  let plan: ExecutionPlanState['plan'];
  try {
    const supplied = event.plan;
    const reconstructed = createExecutionPlanDefinition({
      strategy: supplied.strategy,
      direction: supplied.direction,
      symbol: supplied.symbol,
      proposal: supplied.proposal,
      attempt: supplied.attempt,
      mode: supplied.mode,
      requiresApproval: supplied.requiresApproval,
      maxNakedDurationMs: supplied.maxNakedDurationMs,
      spotQuantity: supplied.openingLegs.SPOT.quantity,
      perpQuantity: supplied.openingLegs.PERP.quantity,
      openingOrder: supplied.openingOrder,
    });
    if (canonicalJson(reconstructed) !== canonicalJson(supplied)) {
      return Object.freeze({ applied: false as const, state: null, reason: 'INVALID_EVENT' as const });
    }
    plan = reconstructed;
  } catch {
    return Object.freeze({ applied: false as const, state: null, reason: 'INVALID_EVENT' as const });
  }
  const frozenEvent = freezeEvent({ ...event, plan });
  const revision = 1;
  const state: ExecutionPlanState = Object.freeze({
    plan,
    lifecycle: 'CREATED' as const,
    revision,
    stateRevisionId: deriveStateRevisionId({ scope: `execution:${plan.planId}`, revision }),
    lastSequence: event.sequence,
    createdAtMs: event.occurredAtMs,
    updatedAtMs: event.occurredAtMs,
    exposedSinceMs: null,
    approval: Object.freeze({
      status: plan.requiresApproval ? ('NOT_REQUESTED' as const) : ('NOT_REQUIRED' as const),
      requestedAtMs: null,
      approvedAtMs: null,
      expiresAtMs: null,
    }),
    preflight: Object.freeze({
      status: 'NOT_STARTED' as const,
      startedAtMs: null,
      completedAtMs: null,
      lastFailure: null,
    }),
    openingLegs: freezeLegRecord({
      SPOT: initialLeg(plan.openingLegs.SPOT),
      PERP: initialLeg(plan.openingLegs.PERP),
    }),
    closingLegs: freezeLegRecord({
      SPOT: initialLeg(plan.closingLegs.SPOT),
      PERP: initialLeg(plan.closingLegs.PERP),
    }),
    processedEventIds: Object.freeze([event.eventId]),
    eventLog: Object.freeze([frozenEvent]),
    failures: Object.freeze([]),
  });
  return Object.freeze({ applied: true as const, state });
}

/**
 * Pure aggregate reducer. Duplicate event IDs and stale stream sequences are
 * ignored without revision changes. Invalid transitions are rejected without
 * mutating the prior state.
 */
export function reduceExecutionEvent(
  state: ExecutionPlanState | null,
  event: ExecutionEvent,
): ExecutionReducerResult {
  if (!validEventEnvelope(event)) {
    return Object.freeze({ applied: false as const, state, reason: 'INVALID_EVENT' as const });
  }
  if (state === null) return makeInitialState(event);
  if (event.planId !== state.plan.planId) {
    return Object.freeze({ applied: false as const, state, reason: 'PLAN_MISMATCH' as const });
  }
  if (state.processedEventIds.includes(event.eventId)) {
    const prior = state.eventLog.find((candidate) => candidate.eventId === event.eventId);
    if (prior === undefined || canonicalJson(prior) !== canonicalJson(event)) {
      return Object.freeze({ applied: false as const, state, reason: 'INVALID_EVENT' as const });
    }
    return Object.freeze({ applied: false as const, state, reason: 'DUPLICATE_EVENT' as const });
  }
  if (event.sequence <= state.lastSequence) {
    return Object.freeze({ applied: false as const, state, reason: 'STALE_EVENT' as const });
  }
  if (event.sequence !== state.lastSequence + 1) {
    return Object.freeze({ applied: false as const, state, reason: 'EVENT_SEQUENCE_GAP' as const });
  }
  if (event.type === 'PLAN_CREATED') {
    return Object.freeze({ applied: false as const, state, reason: 'INVALID_EVENT' as const });
  }
  if (state.plan.mode !== 'PAPER' && PAPER_ONLY_EVENT_TYPES.has(event.type)) {
    return Object.freeze({ applied: false as const, state, reason: 'INVARIANT_VIOLATION' as const });
  }

  let lifecycle: PlanLifecycle = state.lifecycle;
  let approval = state.approval;
  let preflight = state.preflight;
  let openingLegs: Record<ExecutionLegKey, ExecutionLegState> = {
    SPOT: state.openingLegs.SPOT,
    PERP: state.openingLegs.PERP,
  };
  let closingLegs: Record<ExecutionLegKey, ExecutionLegState> = {
    SPOT: state.closingLegs.SPOT,
    PERP: state.closingLegs.PERP,
  };
  let failures = [...state.failures];

  const setLifecycle = (to: PlanLifecycle): boolean => {
    if (lifecycle === to) return true;
    if (!canTransitionPlanLifecycle(lifecycle, to)) return false;
    lifecycle = to;
    return true;
  };

  const updateLeg = (
    phase: ExecutionLegPhase,
    key: ExecutionLegKey,
    to: LegLifecycle,
    changes: Partial<ExecutionLegState> = {},
  ): boolean => {
    const record = phase === 'OPEN' ? openingLegs : closingLegs;
    const current = record[key];
    if (current.lifecycle !== to && !canTransitionLegLifecycle(current.lifecycle, to)) return false;
    record[key] = Object.freeze({ ...current, ...changes, lifecycle: to, lastEventAtMs: event.occurredAtMs });
    return true;
  };

  const reject = (reason: 'INVALID_EVENT' | 'EVENT_SEQUENCE_GAP' | 'INVALID_PLAN_TRANSITION' | 'INVALID_LEG_TRANSITION' | 'UNRESOLVED_EXPOSURE' | 'INVARIANT_VIOLATION'): ExecutionReducerResult =>
    Object.freeze({ applied: false as const, state, reason });

  switch (event.type) {
    case 'APPROVAL_REQUESTED': {
      if (
        !state.plan.requiresApproval ||
        !isValidUtcMillis(event.approvalExpiresAtMs) ||
        (event.approvalExpiresAtMs as number) <= event.occurredAtMs ||
        !setLifecycle('AWAITING_APPROVAL')
      ) return reject('INVALID_PLAN_TRANSITION');
      approval = Object.freeze({
        status: 'PENDING' as const,
        requestedAtMs: event.occurredAtMs,
        approvedAtMs: null,
        expiresAtMs: event.approvalExpiresAtMs as number,
      });
      break;
    }
    case 'APPROVAL_GRANTED': {
      if (
        lifecycle !== 'AWAITING_APPROVAL' ||
        approval.status !== 'PENDING' ||
        approval.expiresAtMs === null ||
        event.occurredAtMs >= approval.expiresAtMs
      ) return reject('INVALID_EVENT');
      approval = Object.freeze({ ...approval, status: 'APPROVED' as const, approvedAtMs: event.occurredAtMs });
      break;
    }
    case 'APPROVAL_EXPIRED': {
      if (approval.status !== 'PENDING' || approval.expiresAtMs === null || event.occurredAtMs < approval.expiresAtMs) {
        return reject('INVALID_EVENT');
      }
      if (!setLifecycle('EXPIRED')) return reject('INVALID_PLAN_TRANSITION');
      approval = Object.freeze({ ...approval, status: 'EXPIRED' as const });
      break;
    }
    case 'PROPOSAL_EXPIRED': {
      if (event.occurredAtMs <= state.plan.proposal.expiresAtMs && event.occurredAtMs - state.plan.proposal.observedAtMs <= state.plan.proposal.maxAgeMs) {
        return reject('INVALID_EVENT');
      }
      if (!setLifecycle('EXPIRED')) return reject('INVALID_PLAN_TRANSITION');
      break;
    }
    case 'ENTRY_WINDOW_EXPIRED': {
      if (!isStructuredFailure(event.failure)) return reject('INVALID_EVENT');
      const riskMayExist = hasKnownOpenExposure(state) || hasActiveWorkingLeg(state) || hasAmbiguousLeg(state);
      const target: PlanLifecycle = riskMayExist
        ? 'RECOVERY_REQUIRED'
        : lifecycle === 'OPENING'
          ? 'FAILED'
          : 'EXPIRED';
      if (!setLifecycle(target)) return reject('INVALID_PLAN_TRANSITION');
      if (
        state.plan.requiresApproval &&
        approval.expiresAtMs !== null &&
        event.occurredAtMs >= approval.expiresAtMs
      ) {
        approval = Object.freeze({ ...approval, status: 'EXPIRED' as const });
      }
      failures.push(event.failure);
      break;
    }
    case 'PREFLIGHT_STARTED': {
      if (!setLifecycle('PREFLIGHTING')) return reject('INVALID_PLAN_TRANSITION');
      if (state.plan.requiresApproval && approval.status !== 'APPROVED') return reject('INVALID_EVENT');
      preflight = Object.freeze({
        status: 'RUNNING' as const,
        startedAtMs: event.occurredAtMs,
        completedAtMs: null,
        lastFailure: null,
      });
      break;
    }
    case 'PREFLIGHT_PASSED': {
      if (preflight.status !== 'RUNNING' || !setLifecycle('READY')) return reject('INVALID_PLAN_TRANSITION');
      preflight = Object.freeze({ ...preflight, status: 'PASSED' as const, completedAtMs: event.occurredAtMs });
      break;
    }
    case 'PREFLIGHT_FAILED': {
      if (preflight.status !== 'RUNNING' || !isStructuredFailure(event.failure) || !setLifecycle('FAILED')) {
        return reject('INVALID_EVENT');
      }
      preflight = Object.freeze({
        ...preflight,
        status: 'FAILED' as const,
        completedAtMs: event.occurredAtMs,
        lastFailure: event.failure,
      });
      failures.push(event.failure);
      break;
    }
    case 'OPENING_STARTED': {
      if (!setLifecycle('OPENING')) return reject('INVALID_PLAN_TRANSITION');
      break;
    }
    case 'LEG_VALIDATED': {
      if (!validLegTarget(event) || !updateLeg(event.phase, event.legKey, 'VALIDATED')) {
        return reject('INVALID_LEG_TRANSITION');
      }
      break;
    }
    case 'LEG_SUBMISSION_STARTED': {
      if (
        !validLegTarget(event) ||
        typeof event.submittedQuantity !== 'number' ||
        !Number.isFinite(event.submittedQuantity) ||
        event.submittedQuantity <= 0
      ) return reject('INVALID_EVENT');
      const maximum = event.phase === 'OPEN'
        ? openingLegs[event.legKey].definition.quantity
        : openingLegs[event.legKey].cumulativeFilledQuantity - closingLegs[event.legKey].cumulativeFilledQuantity;
      if (
        event.submittedQuantity > maximum + EPSILON ||
        !updateLeg(event.phase, event.legKey, 'SUBMITTING', { submittedQuantity: event.submittedQuantity })
      ) {
        return reject('INVALID_LEG_TRANSITION');
      }
      break;
    }
    case 'LEG_ACKNOWLEDGED': {
      if (!validLegTarget(event) || !updateLeg(event.phase, event.legKey, 'ACKNOWLEDGED', { venueOrderId: event.venueOrderId ?? null })) {
        return reject('INVALID_LEG_TRANSITION');
      }
      break;
    }
    case 'LEG_PARTIALLY_FILLED': {
      if (!validLegTarget(event)) return reject('INVALID_EVENT');
      const leg = (event.phase === 'OPEN' ? openingLegs : closingLegs)[event.legKey];
      const maximum = event.phase === 'OPEN'
        ? leg.definition.quantity
        : openingLegs[event.legKey].cumulativeFilledQuantity;
      if (
        !validateFillQuantity(leg, event.cumulativeFilledQuantity, false, maximum) ||
        !updateLeg(event.phase, event.legKey, 'PARTIALLY_FILLED', {
          cumulativeFilledQuantity: event.cumulativeFilledQuantity,
          venueOrderId: event.venueOrderId ?? leg.venueOrderId,
        })
      ) return reject('INVALID_LEG_TRANSITION');
      break;
    }
    case 'LEG_FILLED': {
      if (!validLegTarget(event)) return reject('INVALID_EVENT');
      const leg = (event.phase === 'OPEN' ? openingLegs : closingLegs)[event.legKey];
      const maximum = event.phase === 'OPEN'
        ? leg.definition.quantity
        : openingLegs[event.legKey].cumulativeFilledQuantity;
      if (
        !validateFillQuantity(leg, event.cumulativeFilledQuantity, true, maximum) ||
        !updateLeg(event.phase, event.legKey, 'FILLED', {
          cumulativeFilledQuantity: event.cumulativeFilledQuantity,
          venueOrderId: event.venueOrderId ?? leg.venueOrderId,
        })
      ) return reject('INVALID_LEG_TRANSITION');
      break;
    }
    case 'LEG_REJECTED': {
      if (!validLegTarget(event) || !isStructuredFailure(event.failure)) return reject('INVALID_EVENT');
      if (!updateLeg(event.phase, event.legKey, 'REJECTED', { lastFailure: event.failure })) {
        return reject('INVALID_LEG_TRANSITION');
      }
      failures.push(event.failure);
      break;
    }
    case 'LEG_RESPONSE_AMBIGUOUS': {
      if (!validLegTarget(event) || !isStructuredFailure(event.failure)) return reject('INVALID_EVENT');
      if (!updateLeg(event.phase, event.legKey, 'AMBIGUOUS', { lastFailure: event.failure })) {
        return reject('INVALID_LEG_TRANSITION');
      }
      failures.push(event.failure);
      break;
    }
    case 'LEG_AMBIGUITY_RESOLVED': {
      if (!validLegTarget(event) || event.ambiguityResolution === undefined) return reject('INVALID_EVENT');
      const leg = (event.phase === 'OPEN' ? openingLegs : closingLegs)[event.legKey];
      const resolution = event.ambiguityResolution;
      const maximum = event.phase === 'OPEN'
        ? leg.definition.quantity
        : openingLegs[event.legKey].cumulativeFilledQuantity;
      if (resolution === 'PARTIALLY_FILLED' && !validateFillQuantity(leg, event.cumulativeFilledQuantity, false, maximum)) {
        return reject('INVALID_EVENT');
      }
      if (resolution === 'FILLED' && !validateFillQuantity(leg, event.cumulativeFilledQuantity, true, maximum)) {
        return reject('INVALID_EVENT');
      }
      if (resolution === 'CANCELLED' && !validCancellationCumulative(leg, event.cumulativeFilledQuantity, maximum)) {
        return reject('INVALID_EVENT');
      }
      if (resolution === 'REJECTED' && !isStructuredFailure(event.failure)) return reject('INVALID_EVENT');
      if (!updateLeg(event.phase, event.legKey, resolution, {
        cumulativeFilledQuantity:
          resolution === 'PARTIALLY_FILLED' || resolution === 'FILLED' || resolution === 'CANCELLED'
            ? (event.cumulativeFilledQuantity as number)
            : leg.cumulativeFilledQuantity,
        venueOrderId: event.venueOrderId ?? leg.venueOrderId,
        lastFailure: resolution === 'REJECTED' ? (event.failure as StructuredFailure) : leg.lastFailure,
      })) return reject('INVALID_LEG_TRANSITION');
      if (resolution === 'REJECTED' && event.failure) failures.push(event.failure);
      break;
    }
    case 'LEG_AMBIGUITY_UNRESOLVED': {
      if (!validLegTarget(event) || !isStructuredFailure(event.failure)) return reject('INVALID_EVENT');
      const leg = (event.phase === 'OPEN' ? openingLegs : closingLegs)[event.legKey];
      if (leg.lifecycle !== 'AMBIGUOUS') return reject('INVALID_LEG_TRANSITION');
      (event.phase === 'OPEN' ? openingLegs : closingLegs)[event.legKey] = Object.freeze({
        ...leg,
        lastEventAtMs: event.occurredAtMs,
        lastFailure: event.failure,
      });
      failures.push(event.failure);
      if (!setLifecycle('RECOVERY_REQUIRED')) return reject('INVALID_PLAN_TRANSITION');
      break;
    }
    case 'LEG_CANCEL_REQUESTED': {
      if (!validLegTarget(event) || !updateLeg(event.phase, event.legKey, 'CANCEL_PENDING')) {
        return reject('INVALID_LEG_TRANSITION');
      }
      break;
    }
    case 'LEG_CANCELLED': {
      if (!validLegTarget(event)) return reject('INVALID_EVENT');
      const leg = (event.phase === 'OPEN' ? openingLegs : closingLegs)[event.legKey];
      const maximum = event.phase === 'OPEN'
        ? leg.definition.quantity
        : openingLegs[event.legKey].cumulativeFilledQuantity;
      if (
        !validCancellationCumulative(leg, event.cumulativeFilledQuantity, maximum) ||
        !updateLeg(event.phase, event.legKey, 'CANCELLED', {
          cumulativeFilledQuantity: event.cumulativeFilledQuantity,
          venueOrderId: event.venueOrderId ?? leg.venueOrderId,
        })
      ) {
        return reject('INVALID_LEG_TRANSITION');
      }
      break;
    }
    case 'CLOSE_REQUESTED': {
      if (lifecycle === 'RECOVERY_REQUIRED') {
        if (!setLifecycle('CLOSING')) return reject('INVALID_PLAN_TRANSITION');
      } else if (!setLifecycle('CLOSE_REQUESTED')) {
        return reject('INVALID_PLAN_TRANSITION');
      }
      break;
    }
    case 'CLOSING_STARTED': {
      if (!setLifecycle('CLOSING')) return reject('INVALID_PLAN_TRANSITION');
      break;
    }
    case 'RECONCILIATION_STARTED': {
      if (!setLifecycle('RECONCILING')) return reject('INVALID_PLAN_TRANSITION');
      break;
    }
    case 'RECONCILIATION_RESOLVED': {
      if (lifecycle !== 'RECONCILING' || event.reconciliationOutcome === undefined) return reject('INVALID_EVENT');
      if (event.reconciliationOutcome === 'CLOSED') {
        const projected = { ...state, openingLegs, closingLegs };
        if (hasKnownOpenExposure(projected) || hasAmbiguousLeg(projected)) return reject('UNRESOLVED_EXPOSURE');
      }
      if (event.reconciliationOutcome === 'HEDGED_OPEN') {
        const projected = { ...state, openingLegs, closingLegs };
        if (!isSafelyHedged(projected)) return reject('INVARIANT_VIOLATION');
      }
      if (event.reconciliationOutcome === 'ONE_LEG_EXPOSED') {
        const projected = { ...state, openingLegs, closingLegs };
        if (!hasNakedExposure(projected)) return reject('INVARIANT_VIOLATION');
      }
      if (event.failure !== undefined) {
        if (!isStructuredFailure(event.failure)) return reject('INVALID_EVENT');
        failures.push(event.failure);
      }
      if (!setLifecycle(event.reconciliationOutcome)) return reject('INVALID_PLAN_TRANSITION');
      break;
    }
    case 'NAKED_DURATION_EXPIRED': {
      if (
        state.exposedSinceMs === null ||
        event.occurredAtMs < state.exposedSinceMs + state.plan.maxNakedDurationMs ||
        !setLifecycle('RECOVERY_REQUIRED')
      ) return reject('INVALID_EVENT');
      break;
    }
    case 'PLAN_CANCELLED': {
      const projected = { ...state, openingLegs, closingLegs };
      if (hasKnownOpenExposure(projected) || hasAmbiguousLeg(projected) || hasActiveWorkingLeg(projected)) {
        return reject('UNRESOLVED_EXPOSURE');
      }
      if (!setLifecycle('CANCELLED')) return reject('INVALID_PLAN_TRANSITION');
      break;
    }
    case 'PLAN_FAILED': {
      if (!isStructuredFailure(event.failure) || !setLifecycle('FAILED')) return reject('INVALID_EVENT');
      failures.push(event.failure);
      break;
    }
  }

  const projected = { ...state, openingLegs, closingLegs };
  if (hasOverClose(projected)) return reject('INVARIANT_VIOLATION');

  // Derive global exposure state only from leg facts, never from optimism.
  if (event.phase === 'OPEN' && event.type.startsWith('LEG_')) {
    const safelyHedged = isSafelyHedged(projected);
    const anyFill = openingLegs.SPOT.cumulativeFilledQuantity > EPSILON || openingLegs.PERP.cumulativeFilledQuantity > EPSILON;
    if (safelyHedged && lifecycle !== 'RECOVERY_REQUIRED' && lifecycle !== 'FAILED') {
      if (!setLifecycle('HEDGED_OPEN')) return reject('INVALID_PLAN_TRANSITION');
    } else if (anyFill && lifecycle !== 'RECOVERY_REQUIRED' && lifecycle !== 'FAILED') {
      if (!setLifecycle('ONE_LEG_EXPOSED')) return reject('INVALID_PLAN_TRANSITION');
    } else if (event.type === 'LEG_REJECTED' && !anyFill && lifecycle === 'OPENING') {
      if (!setLifecycle('FAILED')) return reject('INVALID_PLAN_TRANSITION');
    }
  }

  if (isTerminalPlanLifecycle(lifecycle) && hasActiveWorkingLeg(projected)) {
    return reject('INVARIANT_VIOLATION');
  }

  if (event.phase === 'CLOSE' && event.type.startsWith('LEG_')) {
    if (
      (event.type === 'LEG_REJECTED' || event.type === 'LEG_AMBIGUITY_UNRESOLVED') &&
      lifecycle !== 'RECOVERY_REQUIRED' &&
      !setLifecycle('RECOVERY_REQUIRED')
    ) return reject('INVALID_PLAN_TRANSITION');
    if (hasNakedExposure(projected) && lifecycle === 'CLOSING') {
      if (!setLifecycle('ONE_LEG_EXPOSED')) return reject('INVALID_PLAN_TRANSITION');
    }
  }

  const naked = hasNakedExposure(projected);
  const exposedSinceMs = naked ? (state.exposedSinceMs ?? event.occurredAtMs) : null;
  const revision = state.revision + 1;
  const frozenEvent = freezeEvent(event);
  const nextState: ExecutionPlanState = Object.freeze({
    ...state,
    lifecycle,
    revision,
    stateRevisionId: deriveStateRevisionId({ scope: `execution:${state.plan.planId}`, revision }),
    lastSequence: event.sequence,
    updatedAtMs: Math.max(state.updatedAtMs, event.occurredAtMs),
    exposedSinceMs,
    approval: Object.freeze(approval),
    preflight: Object.freeze(preflight),
    openingLegs: freezeLegRecord(openingLegs),
    closingLegs: freezeLegRecord(closingLegs),
    processedEventIds: Object.freeze([...state.processedEventIds, event.eventId]),
    eventLog: Object.freeze([...state.eventLog, frozenEvent]),
    failures: Object.freeze(failures),
  });
  return Object.freeze({ applied: true as const, state: nextState });
}

export function replayExecutionEvents(events: readonly ExecutionEvent[]): ExecutionReducerResult {
  let state: ExecutionPlanState | null = null;
  let last: ExecutionReducerResult = Object.freeze({ applied: false as const, state: null, reason: 'INVALID_EVENT' as const });
  for (const event of events) {
    last = reduceExecutionEvent(state, event);
    if (!last.applied) return last;
    state = last.state;
  }
  return last;
}
