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
import {
  createExecutionPlanDefinition,
  validateNormalBasisPlanBinding,
} from './plan.js';
import {
  EXECUTION_EVENT_TYPES,
  EXECUTION_LEG_KEYS,
  NORMAL_BASIS_MAX_JOURNAL_ENTRIES,
  NORMAL_BASIS_STEP_ORDER,
  type ExecutionEvent,
  type ExecutionLegKey,
  type ExecutionLegPhase,
  type ExecutionLegState,
  type ExecutionPlanState,
  type ExecutionReducerResult,
  type NormalBasisOrderObservation,
  type NormalBasisPlanBinding,
  type NormalBasisProgressAction,
  type NormalBasisProgressObservation,
  type NormalBasisProgressState,
  type NormalBasisStep,
} from './types.js';

const EPSILON = 1e-12;
type ExposureProjection = Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'> &
  Partial<Pick<ExecutionPlanState, 'normalBasisProgress' | 'plan'>>;
const AMBIGUITY_RESOLUTIONS = new Set([
  'ACKNOWLEDGED',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'PROVEN_ABSENT',
]);

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
  RESTART_RECOVERY_BLOCKED: ['phase', 'legKey', 'failure'],
  NAKED_DURATION_EXPIRED: [],
  NORMAL_BASIS_PROGRESS_OBSERVED: ['normalBasisObservation'],
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
  'RESTART_RECOVERY_BLOCKED',
  'NAKED_DURATION_EXPIRED',
  'NORMAL_BASIS_PROGRESS_OBSERVED',
]);

function freezeEvent(event: ExecutionEvent): Readonly<ExecutionEvent> {
  return Object.freeze({
    ...event,
    ...(event.normalBasisObservation === undefined
      ? {}
      : { normalBasisObservation: Object.freeze({ ...event.normalBasisObservation }) }),
  });
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

function hasOverClose(state: ExposureProjection): boolean {
  if (state.normalBasisProgress !== undefined) {
    const fills = state.normalBasisProgress.terminalNetFilledQuantityByStep;
    if (
      (fills.SPOT_CLOSE ?? 0) > (fills.SPOT_OPEN ?? 0) + EPSILON ||
      (fills.PERP_CLOSE ?? 0) > (fills.PERP_OPEN ?? 0) + EPSILON
    ) return true;
  }
  return EXECUTION_LEG_KEYS.some(
    (key) => state.closingLegs[key].cumulativeFilledQuantity > state.openingLegs[key].cumulativeFilledQuantity + EPSILON,
  );
}

export function hasKnownOpenExposure(state: ExposureProjection): boolean {
  if (state.normalBasisProgress !== undefined) {
    const fills = state.normalBasisProgress.terminalNetFilledQuantityByStep;
    if (
      (fills.SPOT_OPEN ?? 0) - (fills.SPOT_CLOSE ?? 0) > EPSILON ||
      (fills.PERP_OPEN ?? 0) - (fills.PERP_CLOSE ?? 0) > EPSILON
    ) return true;
  }
  return EXECUTION_LEG_KEYS.some((key) => knownResidual(state, key) > EPSILON);
}

export function hasAmbiguousLeg(state: ExposureProjection): boolean {
  if (state.normalBasisProgress?.action.disposition === 'QUERY_REQUIRED') return true;
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

export function hasActiveWorkingLeg(state: ExposureProjection): boolean {
  if (
    state.normalBasisProgress !== undefined &&
    (
      state.normalBasisProgress.action.disposition === 'QUERY_REQUIRED' ||
      state.normalBasisProgress.action.disposition === 'CANCEL_ELIGIBLE' ||
      state.normalBasisProgress.action.disposition === 'AWAIT_TERMINAL'
    )
  ) return true;
  return EXECUTION_LEG_KEYS.some(
    (key) => ACTIVE_ORDER_LIFECYCLES.has(state.openingLegs[key].lifecycle) || ACTIVE_ORDER_LIFECYCLES.has(state.closingLegs[key].lifecycle),
  );
}

const NORMAL_BASIS_TERMINAL_STATES = new Set([
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'PROVEN_ABSENT',
]);

function sameQuantity(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

function normalBasisIdentity(
  binding: NormalBasisPlanBinding,
  step: NormalBasisStep,
  attempt: number,
): string {
  if (step === 'SPOT_OPEN' || step === 'PERP_OPEN') {
    if (attempt !== 0) throw new TypeError('normal-Basis open steps permit only attempt zero');
    return binding.steps[step].clientOrderId;
  }
  const identity = binding.closeAttempts.find(
    (candidate) => candidate.step === step && candidate.attempt === attempt,
  );
  if (identity === undefined) throw new TypeError('normal-Basis close attempt is outside the bound budget');
  return identity.clientOrderId;
}

function freezeNormalBasisAction(action: NormalBasisProgressAction): Readonly<NormalBasisProgressAction> {
  return Object.freeze(action);
}

function projectNormalBasisProgress(
  binding: NormalBasisPlanBinding,
  journal: readonly Readonly<NormalBasisProgressObservation>[],
): Readonly<NormalBasisProgressState> {
  const latest = new Map<string, NormalBasisOrderObservation>();
  const terminalAttemptCount = new Map<NormalBasisStep, number>();
  for (const observation of journal) {
    if (observation.kind !== 'ORDER') continue;
    latest.set(`${observation.step}:${observation.attempt}`, observation);
  }

  const active = [...latest.values()].filter(
    (observation) => !NORMAL_BASIS_TERMINAL_STATES.has(observation.state),
  );
  if (active.length > 1) throw new TypeError('normal-Basis journal has more than one active order');

  const terminalFor = (step: NormalBasisStep): readonly NormalBasisOrderObservation[] =>
    [...latest.values()]
      .filter(
        (observation) =>
          observation.step === step && NORMAL_BASIS_TERMINAL_STATES.has(observation.state),
      )
      .sort((left, right) => left.attempt - right.attempt);
  const terminalFill = (step: NormalBasisStep): number | null => {
    const terminal = terminalFor(step);
    if (terminal.length === 0) return null;
    terminalAttemptCount.set(step, terminal.length);
    return terminal.reduce((sum, observation) => sum + observation.cumulativeFilledQuantity, 0);
  };

  const spotOpen = terminalFill('SPOT_OPEN');
  const perpOpen = terminalFill('PERP_OPEN');
  const perpClose = terminalFill('PERP_CLOSE');
  const spotClose = terminalFill('SPOT_CLOSE');
  const terminalNetFilledQuantityByStep = Object.freeze({
    SPOT_OPEN: spotOpen,
    PERP_OPEN: perpOpen,
    PERP_CLOSE: perpClose,
    SPOT_CLOSE: spotClose,
  });

  const activeObservation = active[0];
  let next: NormalBasisProgressState['next'];
  let nextAttempt: number | null = null;
  let expectedQuantity: number | null = null;

  if (activeObservation !== undefined) {
    next = activeObservation.step;
    nextAttempt = activeObservation.attempt;
    expectedQuantity = activeObservation.submittedQuantity;
  } else if (spotOpen === null) {
    next = 'SPOT_OPEN';
    nextAttempt = 0;
    expectedQuantity = binding.risk.spot.intendedQty;
  } else if (spotOpen <= EPSILON) {
    next = 'BASELINE_RECONCILIATION';
  } else if (perpOpen === null) {
    next = 'PERP_OPEN';
    nextAttempt = 0;
    expectedQuantity =
      binding.risk.perp.intendedQty * (spotOpen / binding.risk.spot.intendedQty);
  } else {
    const perpResidual = Math.max(0, perpOpen - (perpClose ?? 0));
    const spotResidual = Math.max(0, spotOpen - (spotClose ?? 0));
    if (perpResidual > EPSILON) {
      next = 'PERP_CLOSE';
      nextAttempt = terminalAttemptCount.get('PERP_CLOSE') ?? 0;
      expectedQuantity = perpResidual;
    } else if (spotResidual > EPSILON) {
      next = 'SPOT_CLOSE';
      nextAttempt = terminalAttemptCount.get('SPOT_CLOSE') ?? 0;
      expectedQuantity = spotResidual;
    } else {
      next = 'BASELINE_RECONCILIATION';
    }
  }

  const baselineObservations = journal.filter(
    (observation): observation is Extract<NormalBasisProgressObservation, { kind: 'BASELINE' }> =>
      observation.kind === 'BASELINE',
  );
  const latestBaseline = baselineObservations.at(-1);
  const baselineFlat =
    latestBaseline !== undefined &&
    sameQuantity(latestBaseline.spotSignedBaseQty, binding.risk.baseline.spotSignedBaseQty) &&
    sameQuantity(latestBaseline.perpSignedBaseQty, binding.risk.baseline.perpSignedBaseQty);
  if (next === 'BASELINE_RECONCILIATION' && baselineFlat) next = 'COMPLETE';

  let action: NormalBasisProgressAction;
  if (next === 'COMPLETE') {
    action = {
      disposition: 'COMPLETE',
      step: null,
      attempt: null,
      clientOrderId: null,
      quantity: null,
      sendEligible: false,
    };
  } else if (next === 'BASELINE_RECONCILIATION') {
    action = {
      disposition: 'OBSERVE_BASELINE',
      step: null,
      attempt: null,
      clientOrderId: null,
      quantity: null,
      sendEligible: false,
    };
  } else if (activeObservation === undefined) {
    if (
      nextAttempt === null ||
      expectedQuantity === null ||
      expectedQuantity <= EPSILON
    ) {
      throw new TypeError('normal-Basis journal has no positive actionable residual');
    }
    if (
      (next === 'PERP_CLOSE' || next === 'SPOT_CLOSE') &&
      nextAttempt >= binding.maxCloseAttempts
    ) {
      nextAttempt = null;
      action = {
        disposition: 'ATTEMPT_BUDGET_EXHAUSTED',
        step: next,
        attempt: null,
        clientOrderId: null,
        quantity: expectedQuantity,
        sendEligible: false,
      };
    } else {
      action = {
        disposition: 'SUBMIT_ELIGIBLE',
        step: next,
        attempt: nextAttempt,
        clientOrderId: normalBasisIdentity(binding, next, nextAttempt),
        quantity: expectedQuantity,
        sendEligible: false,
      };
    }
  } else {
    action = {
      disposition:
        activeObservation.state === 'AMBIGUOUS'
          ? 'QUERY_REQUIRED'
          : activeObservation.state === 'WORKING'
            ? 'CANCEL_ELIGIBLE'
            : 'AWAIT_TERMINAL',
      step: next,
      attempt: nextAttempt,
      clientOrderId: activeObservation.clientOrderId,
      quantity: expectedQuantity,
      sendEligible: false,
    };
  }

  return Object.freeze({
    bindingId: binding.bindingId,
    journal: Object.freeze([...journal]),
    next,
    nextAttempt,
    expectedQuantity,
    terminalNetFilledQuantityByStep,
    workingOrAmbiguousClientOrderId:
      activeObservation?.state === 'WORKING' || activeObservation?.state === 'AMBIGUOUS'
        ? activeObservation.clientOrderId
        : null,
    baselineFlat,
    complete: next === 'COMPLETE',
    action: freezeNormalBasisAction(action),
    deliveryGuarantee: 'PROCESS_LOCAL_REPLAY_ONLY_REQUIRES_LEDGER_CAS',
  });
}

/** Initial pure, record-only projection for an immutable normal-Basis binding. */
export function createNormalBasisProgress(
  binding: NormalBasisPlanBinding,
): Readonly<NormalBasisProgressState> {
  return projectNormalBasisProgress(binding, Object.freeze([]));
}

const NORMAL_BASIS_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  SUBMISSION_STARTED: new Set(['WORKING', 'AMBIGUOUS', 'FILLED', 'CANCELLED', 'REJECTED']),
  WORKING: new Set(['WORKING', 'AMBIGUOUS', 'CANCEL_REQUESTED', 'FILLED', 'CANCELLED', 'REJECTED']),
  AMBIGUOUS: new Set(['QUERY_STARTED']),
  QUERY_STARTED: new Set(['WORKING', 'AMBIGUOUS', 'CANCEL_REQUESTED', 'FILLED', 'CANCELLED', 'REJECTED', 'PROVEN_ABSENT']),
  CANCEL_REQUESTED: new Set(['AMBIGUOUS', 'FILLED', 'CANCELLED']),
});

/**
 * Validate and append one immutable observation. Invalid/out-of-order evidence
 * throws without mutating the prior projection.
 */
export function appendNormalBasisProgress(
  binding: NormalBasisPlanBinding,
  progress: NormalBasisProgressState,
  observation: NormalBasisProgressObservation,
  expectedAggregateRevision?: Readonly<
    Pick<ExecutionPlanState, 'revision' | 'stateRevisionId'>
  >,
): Readonly<NormalBasisProgressState> {
  if (progress.bindingId !== binding.bindingId || progress.complete) {
    throw new TypeError('normal-Basis progress is complete or belongs to another binding');
  }
  if (
    progress.journal.length >= NORMAL_BASIS_MAX_JOURNAL_ENTRIES ||
    observation.journalIndex !== progress.journal.length ||
    !isValidUtcMillis(observation.occurredAtMs) ||
    (progress.journal.at(-1)?.occurredAtMs ?? 0) > observation.occurredAtMs
  ) {
    throw new TypeError('normal-Basis observation violates the bounded append-only journal');
  }
  if (observation.kind === 'BASELINE') {
    if (
      progress.action.disposition !== 'OBSERVE_BASELINE' ||
      expectedAggregateRevision === undefined ||
      observation.bindingId !== binding.bindingId ||
      !Number.isSafeInteger(observation.observedStateRevision) ||
      observation.observedStateRevision <= 0 ||
      observation.observedStateRevision !== expectedAggregateRevision.revision ||
      observation.observedStateRevisionId !== expectedAggregateRevision.stateRevisionId ||
      expectedAggregateRevision.stateRevisionId !== deriveStateRevisionId({
        scope: `execution:${binding.planId}`,
        revision: expectedAggregateRevision.revision,
      }) ||
      observation.observedStateRevisionId !== deriveStateRevisionId({
        scope: `execution:${binding.planId}`,
        revision: observation.observedStateRevision,
      }) ||
      !Number.isFinite(observation.spotSignedBaseQty) ||
      !Number.isFinite(observation.perpSignedBaseQty)
    ) {
      throw new TypeError('normal-Basis baseline observation is invalid or premature');
    }
  } else {
    const action = progress.action;
    if (
      action.step === null ||
      action.attempt === null ||
      action.clientOrderId === null ||
      action.quantity === null ||
      observation.step !== action.step ||
      observation.attempt !== action.attempt ||
      observation.clientOrderId !== action.clientOrderId ||
      !Number.isFinite(observation.submittedQuantity) ||
      observation.submittedQuantity <= 0 ||
      !sameQuantity(observation.submittedQuantity, action.quantity) ||
      !Number.isFinite(observation.cumulativeFilledQuantity) ||
      observation.cumulativeFilledQuantity < 0 ||
      observation.cumulativeFilledQuantity > observation.submittedQuantity + EPSILON
    ) {
      throw new TypeError('normal-Basis order observation does not match the actionable projection');
    }
    const prior = [...progress.journal].reverse().find(
      (candidate): candidate is NormalBasisOrderObservation =>
        candidate.kind === 'ORDER' &&
        candidate.step === observation.step &&
        candidate.attempt === observation.attempt,
    );
    if (prior === undefined) {
      if (
        action.disposition !== 'SUBMIT_ELIGIBLE' ||
        observation.state !== 'SUBMISSION_STARTED' ||
        observation.cumulativeFilledQuantity !== 0
      ) {
        throw new TypeError('normal-Basis attempt must begin with SUBMISSION_STARTED');
      }
      if (
        observation.step === 'SPOT_OPEN' &&
        observation.occurredAtMs >= binding.entryExpiresAtMs
      ) {
        throw new TypeError('normal-Basis entry authority expired before submission');
      }
    } else {
      if (
        !sameQuantity(prior.submittedQuantity, observation.submittedQuantity) ||
        observation.cumulativeFilledQuantity + EPSILON < prior.cumulativeFilledQuantity ||
        !NORMAL_BASIS_TRANSITIONS[prior.state]?.has(observation.state)
      ) {
        throw new TypeError('normal-Basis attempt transition or terminal net fill is invalid');
      }
      if (observation.state === 'FILLED' && !sameQuantity(
        observation.cumulativeFilledQuantity,
        observation.submittedQuantity,
      )) {
        throw new TypeError('normal-Basis FILLED evidence must prove the submitted net fill');
      }
      if (observation.state === 'PROVEN_ABSENT' && observation.cumulativeFilledQuantity !== 0) {
        throw new TypeError('normal-Basis PROVEN_ABSENT evidence cannot carry a fill');
      }
    }
  }
  return projectNormalBasisProgress(
    binding,
    Object.freeze([...progress.journal, Object.freeze({ ...observation })]),
  );
}

function normalizedResidual(state: Pick<ExecutionPlanState, 'openingLegs' | 'closingLegs'>, key: ExecutionLegKey): number {
  return knownResidual(state, key) / state.openingLegs[key].definition.quantity;
}

export function hasNakedExposure(state: ExposureProjection): boolean {
  if (hasAmbiguousLeg(state)) return true;
  // A submitting/working order can create exposure before its response is
  // observed, so the bounded naked timer starts at submission, not receipt.
  if (hasActiveWorkingLeg(state)) return true;
  const legacyNaked =
    Math.abs(normalizedResidual(state, 'SPOT') - normalizedResidual(state, 'PERP')) > EPSILON;
  if (state.normalBasisProgress !== undefined && state.plan?.normalBasisBinding !== undefined) {
    const fills = state.normalBasisProgress.terminalNetFilledQuantityByStep;
    const risk = state.plan.normalBasisBinding.risk;
    const spotResidual =
      ((fills.SPOT_OPEN ?? 0) - (fills.SPOT_CLOSE ?? 0)) / risk.spot.intendedQty;
    const perpResidual =
      ((fills.PERP_OPEN ?? 0) - (fills.PERP_CLOSE ?? 0)) / risk.perp.intendedQty;
    // The projections are independent evidence streams. Either divergence is
    // sufficient; the journal must never mask a conflicting legacy leg fact.
    return Math.abs(spotResidual - perpResidual) > EPSILON || legacyNaked;
  }
  return legacyNaked;
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

function isSafelyHedged(state: ExposureProjection): boolean {
  if (!hasKnownOpenExposure(state) || hasAmbiguousLeg(state) || hasOverClose(state)) return false;
  if (state.normalBasisProgress !== undefined) {
    return !hasActiveWorkingLeg(state) && !hasNakedExposure(state);
  }
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
    const reconstructedBase = createExecutionPlanDefinition({
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
    const reconstructed = supplied.normalBasisBinding === undefined
      ? reconstructedBase
      : Object.freeze({
          ...reconstructedBase,
          normalBasisBinding: validateNormalBasisPlanBinding(
            reconstructedBase,
            supplied.normalBasisBinding,
          ),
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
    ...(plan.normalBasisBinding === undefined
      ? {}
      : { normalBasisProgress: createNormalBasisProgress(plan.normalBasisBinding) }),
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
  let normalBasisProgress = state.normalBasisProgress;

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
      const target = (event.phase === 'OPEN' ? openingLegs : closingLegs)[event.legKey];
      if (target.lifecycle !== 'VALIDATED') return reject('INVALID_LEG_TRANSITION');
      if (
        event.phase === 'OPEN' &&
        lifecycle !== 'OPENING' &&
        lifecycle !== 'ONE_LEG_EXPOSED'
      ) return reject('INVALID_PLAN_TRANSITION');
      const maximum = event.phase === 'OPEN'
        ? target.definition.quantity
        : openingLegs[event.legKey].cumulativeFilledQuantity - target.cumulativeFilledQuantity;
      if (event.phase === 'OPEN') {
        const index = state.plan.openingOrder.indexOf(event.legKey);
        if (index < 0) return reject('INVALID_LEG_TRANSITION');
        if (index > 0) {
          const predecessor = openingLegs[state.plan.openingOrder[index - 1]];
          if (
            (predecessor.lifecycle !== 'FILLED' && predecessor.lifecycle !== 'CANCELLED') ||
            predecessor.cumulativeFilledQuantity <= EPSILON
          ) return reject('INVALID_LEG_TRANSITION');
          const expectedQuantity = target.definition.quantity * (
            predecessor.cumulativeFilledQuantity / predecessor.definition.quantity
          );
          if (
            !Number.isFinite(expectedQuantity) ||
            expectedQuantity <= 0 ||
            Math.abs(event.submittedQuantity - expectedQuantity) > EPSILON
          ) return reject('INVALID_LEG_TRANSITION');
        }
      }
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
        !updateLeg(event.phase, event.legKey, leg.lifecycle === 'CANCEL_PENDING' ? 'CANCEL_PENDING' : 'PARTIALLY_FILLED', {
          cumulativeFilledQuantity: event.cumulativeFilledQuantity,
          venueOrderId: event.venueOrderId ?? leg.venueOrderId,
        })
      ) return reject('INVALID_LEG_TRANSITION');
      break;
    }
    case 'LEG_FILLED': {
      if (!validLegTarget(event)) return reject('INVALID_EVENT');
      const leg = (event.phase === 'OPEN' ? openingLegs : closingLegs)[event.legKey];
      if (leg.lifecycle === 'FILLED') return reject('INVALID_LEG_TRANSITION');
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
      const leg = (event.phase === 'OPEN' ? openingLegs : closingLegs)[event.legKey];
      if (leg.lifecycle === 'REJECTED') return reject('INVALID_LEG_TRANSITION');
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
      if (leg.lifecycle !== 'AMBIGUOUS' || !AMBIGUITY_RESOLUTIONS.has(resolution)) {
        return reject('INVALID_LEG_TRANSITION');
      }
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
      if (
        (resolution === 'ACKNOWLEDGED' || resolution === 'REJECTED') &&
        event.cumulativeFilledQuantity !== undefined
      ) return reject('INVALID_EVENT');
      if (
        resolution !== 'REJECTED' &&
        resolution !== 'PROVEN_ABSENT' &&
        event.failure !== undefined
      ) return reject('INVALID_EVENT');
      if (
        resolution === 'PROVEN_ABSENT' &&
        (
          !isStructuredFailure(event.failure) ||
          event.venueOrderId !== undefined ||
          event.cumulativeFilledQuantity !== undefined ||
          leg.venueOrderId !== null ||
          leg.cumulativeFilledQuantity > EPSILON
        )
      ) return reject('INVALID_EVENT');
      if ((resolution === 'REJECTED' || resolution === 'PROVEN_ABSENT') && !isStructuredFailure(event.failure)) {
        return reject('INVALID_EVENT');
      }
      const resolvedLifecycle = resolution === 'PROVEN_ABSENT' ? 'REJECTED' : resolution;
      if (!updateLeg(event.phase, event.legKey, resolvedLifecycle, {
        cumulativeFilledQuantity:
          resolution === 'PARTIALLY_FILLED' || resolution === 'FILLED' || resolution === 'CANCELLED'
            ? (event.cumulativeFilledQuantity as number)
            : leg.cumulativeFilledQuantity,
        venueOrderId: event.venueOrderId ?? leg.venueOrderId,
        lastFailure:
          resolution === 'REJECTED' || resolution === 'PROVEN_ABSENT'
            ? (event.failure as StructuredFailure)
            : leg.lastFailure,
        lastAmbiguityResolution: resolution,
      })) return reject('INVALID_LEG_TRANSITION');
      if ((resolution === 'REJECTED' || resolution === 'PROVEN_ABSENT') && event.failure) failures.push(event.failure);
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
      if (leg.lifecycle === 'CANCELLED') return reject('INVALID_LEG_TRANSITION');
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
        if (
          state.plan.normalBasisBinding !== undefined &&
          (
            state.normalBasisProgress === undefined ||
            !state.normalBasisProgress.complete ||
            !state.normalBasisProgress.baselineFlat
          )
        ) return reject('UNRESOLVED_EXPOSURE');
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
    case 'RESTART_RECOVERY_BLOCKED': {
      if (
        !validLegTarget(event) ||
        !isStructuredFailure(event.failure) ||
        !setLifecycle('RECOVERY_REQUIRED')
      ) return reject('INVALID_PLAN_TRANSITION');
      failures.push(event.failure);
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
    case 'NORMAL_BASIS_PROGRESS_OBSERVED': {
      const binding = state.plan.normalBasisBinding;
      const observation = event.normalBasisObservation;
      if (
        binding === undefined ||
        normalBasisProgress === undefined ||
        observation === undefined ||
        observation.occurredAtMs !== event.occurredAtMs
      ) return reject('INVALID_EVENT');
      if (
        observation.kind === 'ORDER' &&
        observation.state === 'SUBMISSION_STARTED' &&
        (
          (observation.step === 'SPOT_OPEN' && lifecycle !== 'OPENING') ||
          (
            observation.step === 'PERP_OPEN' &&
            lifecycle !== 'ONE_LEG_EXPOSED' &&
            !(
              lifecycle === 'RECOVERY_REQUIRED' &&
              normalBasisProgress.action.disposition === 'SUBMIT_ELIGIBLE' &&
              normalBasisProgress.action.step === 'PERP_OPEN' &&
              normalBasisProgress.next === 'PERP_OPEN' &&
              (normalBasisProgress.terminalNetFilledQuantityByStep.SPOT_OPEN ?? 0) > EPSILON
            )
          ) ||
          (
            (observation.step === 'PERP_CLOSE' || observation.step === 'SPOT_CLOSE') &&
            lifecycle !== 'CLOSING'
          )
        )
      ) return reject('INVALID_PLAN_TRANSITION');
      if (
        observation.kind === 'BASELINE' &&
        lifecycle !== 'RECONCILING' &&
        lifecycle !== 'CLOSING'
      ) return reject('INVALID_PLAN_TRANSITION');
      if (
        observation.kind === 'BASELINE' &&
        (
          observation.bindingId !== binding.bindingId ||
          observation.observedStateRevision !== state.revision ||
          observation.observedStateRevisionId !== state.stateRevisionId
        )
      ) return reject('INVALID_EVENT');
      try {
        normalBasisProgress = appendNormalBasisProgress(
          binding,
          normalBasisProgress,
          observation,
          {
            revision: state.revision,
            stateRevisionId: state.stateRevisionId,
          },
        );
      } catch {
        return reject('INVARIANT_VIOLATION');
      }
      const progressProjection = {
        ...state,
        openingLegs,
        closingLegs,
        normalBasisProgress,
      };
      if (observation.kind === 'ORDER' && NORMAL_BASIS_TERMINAL_STATES.has(observation.state)) {
        if (
          observation.step === 'SPOT_OPEN' &&
          (normalBasisProgress.terminalNetFilledQuantityByStep.SPOT_OPEN ?? 0) > EPSILON &&
          lifecycle === 'OPENING' &&
          !setLifecycle('ONE_LEG_EXPOSED')
        ) return reject('INVALID_PLAN_TRANSITION');
        if (
          observation.step === 'PERP_OPEN' &&
          lifecycle === 'ONE_LEG_EXPOSED' &&
          isSafelyHedged(progressProjection) &&
          !setLifecycle('HEDGED_OPEN')
        ) return reject('INVALID_PLAN_TRANSITION');
      }
      if (
        normalBasisProgress.action.disposition === 'ATTEMPT_BUDGET_EXHAUSTED' &&
        !setLifecycle('RECOVERY_REQUIRED')
      ) return reject('INVALID_PLAN_TRANSITION');
      if (observation.kind === 'BASELINE' && normalBasisProgress.complete) {
        if (
          hasKnownOpenExposure(progressProjection) ||
          hasAmbiguousLeg(progressProjection) ||
          hasActiveWorkingLeg(progressProjection) ||
          hasOverClose(progressProjection) ||
          !setLifecycle('CLOSED')
        ) return reject('UNRESOLVED_EXPOSURE');
      }
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

  const projected = {
    ...state,
    openingLegs,
    closingLegs,
    ...(normalBasisProgress === undefined ? {} : { normalBasisProgress }),
  };
  if (hasOverClose(projected)) return reject('INVARIANT_VIOLATION');

  // Derive global exposure state only from leg facts, never from optimism.
  if (event.phase === 'OPEN' && event.type.startsWith('LEG_')) {
    const safelyHedged = isSafelyHedged(projected);
    const anyFill = openingLegs.SPOT.cumulativeFilledQuantity > EPSILON || openingLegs.PERP.cumulativeFilledQuantity > EPSILON;
    const rejectedAfterAmbiguity =
      event.type === 'LEG_AMBIGUITY_RESOLVED' &&
      (event.ambiguityResolution === 'REJECTED' || event.ambiguityResolution === 'PROVEN_ABSENT');
    if (safelyHedged && lifecycle !== 'RECOVERY_REQUIRED' && lifecycle !== 'FAILED') {
      if (!setLifecycle('HEDGED_OPEN')) return reject('INVALID_PLAN_TRANSITION');
    } else if (anyFill && lifecycle !== 'RECOVERY_REQUIRED' && lifecycle !== 'FAILED') {
      if (!setLifecycle('ONE_LEG_EXPOSED')) return reject('INVALID_PLAN_TRANSITION');
    } else if ((event.type === 'LEG_REJECTED' || rejectedAfterAmbiguity) && !anyFill && lifecycle === 'OPENING') {
      if (!setLifecycle('FAILED')) return reject('INVALID_PLAN_TRANSITION');
    }
  }

  if (isTerminalPlanLifecycle(lifecycle) && hasActiveWorkingLeg(projected)) {
    return reject('INVARIANT_VIOLATION');
  }

  if (event.phase === 'CLOSE' && event.type.startsWith('LEG_')) {
    const rejectedAfterAmbiguity =
      event.type === 'LEG_AMBIGUITY_RESOLVED' &&
      (event.ambiguityResolution === 'REJECTED' || event.ambiguityResolution === 'PROVEN_ABSENT');
    if (
      (event.type === 'LEG_REJECTED' || event.type === 'LEG_AMBIGUITY_UNRESOLVED' || rejectedAfterAmbiguity) &&
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
    ...(normalBasisProgress === undefined ? {} : { normalBasisProgress }),
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
