import {
  deriveClientOrderId,
  deriveCorrelationId,
  deriveLegId,
  derivePlanId,
  canonicalJson,
  isExecutionMode,
  isValidUtcMillis,
  stableHash128Hex,
} from '../contracts/index.js';
import {
  evaluateNormalBasisRiskBinding,
  validateNormalBasisApprovedRiskBinding,
} from '../risk/evaluator.js';
import {
  BASIS_EXECUTION_DIRECTIONS,
  EXECUTION_LEG_KEYS,
  NORMAL_BASIS_BINDING_SCHEMA,
  NORMAL_BASIS_BINDING_VERSION,
  NORMAL_BASIS_DIRECTION,
  NORMAL_BASIS_MAX_CLOSE_ATTEMPTS,
  NORMAL_BASIS_STEP_ORDER,
  type BasisExecutionDirection,
  type CreateExecutionPlanInput,
  type ExecutionLegDefinition,
  type ExecutionLegKey,
  type ExecutionPlanDefinition,
  type NormalBasisAttemptIdentity,
  type NormalBasisBindingComparison,
  type NormalBasisExecutionBindingRequest,
  type NormalBasisPlanBinding,
  type NormalBasisStep,
  type NormalBasisStepBinding,
  type OrderSide,
} from './types.js';

function assertNonEmpty(name: string, value: unknown, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`${name} must be a non-empty string (<=${maxLength} chars)`);
  }
}

function assertPositiveFinite(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
}

function assertPositiveInteger(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function sides(direction: BasisExecutionDirection): {
  openSpot: OrderSide;
  openPerp: OrderSide;
  closeSpot: OrderSide;
  closePerp: OrderSide;
} {
  return direction === 'LONG_SPOT_SHORT_PERP'
    ? { openSpot: 'BUY', openPerp: 'SELL', closeSpot: 'SELL', closePerp: 'BUY' }
    : { openSpot: 'SELL', openPerp: 'BUY', closeSpot: 'BUY', closePerp: 'SELL' };
}

function makeLeg(
  planId: ExecutionPlanDefinition['planId'],
  termsFingerprint: string,
  key: ExecutionLegKey,
  phase: 'OPEN' | 'CLOSE',
  side: OrderSide,
  quantity: number,
): Readonly<ExecutionLegDefinition> {
  const role = `${key}_${phase}` as ExecutionLegDefinition['role'];
  const legId = deriveLegId({ planId, legRole: `${role}:${termsFingerprint}` });
  return Object.freeze({
    legId,
    key,
    phase,
    role,
    venue: key === 'SPOT' ? ('BINANCE_SPOT' as const) : ('BINANCE_USDM' as const),
    side,
    quantity,
    // Spot has no reduceOnly flag. A futures close must always be reduce-only.
    reduceOnly: phase === 'CLOSE' && key === 'PERP',
    riskEffect: phase === 'OPEN' ? ('RISK_INCREASING' as const) : ('RISK_REDUCING' as const),
    clientOrderId: deriveClientOrderId({ planId, legId, attempt: 0 }),
  });
}

/**
 * Pure deterministic plan construction. The frozen PlanId depends on the
 * canonical proposal and explicit attempt. A separate terms fingerprint is
 * bound into every LegId/client-order ID, so conflicting terms cannot reuse
 * venue identity. Integrators must increment attempt when intentionally
 * replanning a canonical proposal with changed terms.
 */
export function createExecutionPlanDefinition(input: CreateExecutionPlanInput): Readonly<ExecutionPlanDefinition> {
  if (input.strategy !== 'BASIS') throw new TypeError("strategy must be 'BASIS'");
  if (!(BASIS_EXECUTION_DIRECTIONS as readonly string[]).includes(input.direction)) {
    throw new TypeError('direction must be a supported Basis execution direction');
  }
  assertNonEmpty('symbol', input.symbol, 64);
  if (!isExecutionMode(input.mode)) throw new TypeError('mode must be an ExecutionMode');
  if (typeof input.requiresApproval !== 'boolean') throw new TypeError('requiresApproval must be boolean');
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) {
    throw new TypeError('attempt must be a non-negative safe integer');
  }
  assertPositiveInteger('maxNakedDurationMs', input.maxNakedDurationMs);
  assertPositiveFinite('spotQuantity', input.spotQuantity);
  assertPositiveFinite('perpQuantity', input.perpQuantity);

  assertNonEmpty('proposal.canonicalProposalId', input.proposal?.canonicalProposalId, 256);
  if (!isValidUtcMillis(input.proposal.observedAtMs)) {
    throw new TypeError('proposal.observedAtMs must be valid UTC ms');
  }
  if (!isValidUtcMillis(input.proposal.expiresAtMs)) {
    throw new TypeError('proposal.expiresAtMs must be valid UTC ms');
  }
  assertPositiveInteger('proposal.maxAgeMs', input.proposal.maxAgeMs);
  if (input.proposal.expiresAtMs <= input.proposal.observedAtMs) {
    throw new TypeError('proposal.expiresAtMs must be later than proposal.observedAtMs');
  }

  const openingOrder = input.openingOrder ?? (['SPOT', 'PERP'] as const);
  if (
    !Array.isArray(openingOrder) ||
    openingOrder.length !== 2 ||
    !(EXECUTION_LEG_KEYS as readonly string[]).includes(openingOrder[0]) ||
    !(EXECUTION_LEG_KEYS as readonly string[]).includes(openingOrder[1]) ||
    openingOrder[0] === openingOrder[1]
  ) {
    throw new TypeError('openingOrder must contain SPOT and PERP exactly once');
  }

  const planId = derivePlanId({ canonicalProposalId: input.proposal.canonicalProposalId, attempt: input.attempt });
  const correlationId = deriveCorrelationId({ origin: 'execution-plan', key: planId });
  const side = sides(input.direction);
  const termsFingerprint = `terms_${stableHash128Hex(canonicalJson({
    strategy: input.strategy,
    direction: input.direction,
    symbol: input.symbol,
    proposal: {
      canonicalProposalId: input.proposal.canonicalProposalId,
      observedAtMs: input.proposal.observedAtMs,
      maxAgeMs: input.proposal.maxAgeMs,
      expiresAtMs: input.proposal.expiresAtMs,
    },
    attempt: input.attempt,
    mode: input.mode,
    requiresApproval: input.requiresApproval,
    maxNakedDurationMs: input.maxNakedDurationMs,
    spotQuantity: input.spotQuantity,
    perpQuantity: input.perpQuantity,
    openingOrder: [openingOrder[0], openingOrder[1]],
  }))}`;
  const openingLegs = Object.freeze({
    SPOT: makeLeg(planId, termsFingerprint, 'SPOT', 'OPEN', side.openSpot, input.spotQuantity),
    PERP: makeLeg(planId, termsFingerprint, 'PERP', 'OPEN', side.openPerp, input.perpQuantity),
  });
  const closingLegs = Object.freeze({
    SPOT: makeLeg(planId, termsFingerprint, 'SPOT', 'CLOSE', side.closeSpot, input.spotQuantity),
    PERP: makeLeg(planId, termsFingerprint, 'PERP', 'CLOSE', side.closePerp, input.perpQuantity),
  });

  const base = {
    planId,
    correlationId,
    termsFingerprint,
    strategy: 'BASIS' as const,
    direction: input.direction,
    symbol: input.symbol,
    proposal: Object.freeze({
      canonicalProposalId: input.proposal.canonicalProposalId,
      observedAtMs: input.proposal.observedAtMs,
      maxAgeMs: input.proposal.maxAgeMs,
      expiresAtMs: input.proposal.expiresAtMs,
    }),
    attempt: input.attempt,
    mode: input.mode,
    requiresApproval: input.requiresApproval,
    maxNakedDurationMs: input.maxNakedDurationMs,
    openingOrder: Object.freeze([openingOrder[0], openingOrder[1]]) as readonly [ExecutionLegKey, ExecutionLegKey],
    openingLegs,
    closingLegs,
  };
  // DEFAULT OFF: the key is absent, not undefined. canonicalJson throws on an
  // undefined member, and an absent key is what keeps v1 plans, checkpoint
  // checksums, and LiveEdge client-order IDs byte-identical.
  if (input.normalBasis === undefined) return Object.freeze(base);
  return Object.freeze({
    ...base,
    normalBasisBinding: deriveNormalBasisPlanBinding(base, input.normalBasis),
  });
}

export type PlanIdentityComparison = 'DISTINCT_PLAN_ID' | 'SAME_TERMS' | 'CONFLICTING_TERMS';

/** Pure seam for an injected registry to enforce one terms binding per PlanId. */
export function compareExecutionPlanIdentity(
  left: Pick<ExecutionPlanDefinition, 'planId' | 'termsFingerprint'>,
  right: Pick<ExecutionPlanDefinition, 'planId' | 'termsFingerprint'>,
): PlanIdentityComparison {
  if (left.planId !== right.planId) return 'DISTINCT_PLAN_ID';
  return left.termsFingerprint === right.termsFingerprint ? 'SAME_TERMS' : 'CONFLICTING_TERMS';
}

// ---------------------------------------------------------------------------
// Normal-Basis binding derivation (pure data; no authority of any kind)
// ---------------------------------------------------------------------------

type BindablePlan = Omit<ExecutionPlanDefinition, 'normalBasisBinding'>;

/** Every re-close attempt has a distinct ID; its cancel/query reuse that ID. */
export function deriveNormalBasisCloseAttemptIdentity(
  plan: Pick<BindablePlan, 'planId' | 'termsFingerprint' | 'closingLegs'>,
  step: NormalBasisAttemptIdentity['step'],
  attempt: number,
): Readonly<NormalBasisAttemptIdentity> {
  if (step !== 'PERP_CLOSE' && step !== 'SPOT_CLOSE') {
    throw new TypeError('normal-Basis attempt identities exist only for PERP_CLOSE and SPOT_CLOSE');
  }
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt >= NORMAL_BASIS_MAX_CLOSE_ATTEMPTS) {
    throw new RangeError(
      `normal-Basis close attempt must be an integer in [0, ${NORMAL_BASIS_MAX_CLOSE_ATTEMPTS - 1}]`,
    );
  }
  const legKey: ExecutionLegKey = step === 'PERP_CLOSE' ? 'PERP' : 'SPOT';
  const definition = plan.closingLegs[legKey];
  return Object.freeze({
    attempt,
    step,
    // attempt 0 reproduces the existing v1 close client-order ID exactly.
    clientOrderId: deriveClientOrderId({ planId: plan.planId, legId: definition.legId, attempt }),
  });
}

function stepBinding(plan: BindablePlan, step: NormalBasisStep): Readonly<NormalBasisStepBinding> {
  const phase = step.endsWith('_OPEN') ? ('OPEN' as const) : ('CLOSE' as const);
  const legKey: ExecutionLegKey = step.startsWith('SPOT') ? 'SPOT' : 'PERP';
  const definition = phase === 'OPEN' ? plan.openingLegs[legKey] : plan.closingLegs[legKey];
  const index = NORMAL_BASIS_STEP_ORDER.indexOf(step);
  const precondition =
    step === 'SPOT_OPEN'
      ? ('NONE' as const)
      : step === 'PERP_OPEN'
        ? ('SPOT_OPEN_NET_FILL_TERMINAL_OR_CANCEL_CONFIRMED' as const)
        : step === 'PERP_CLOSE'
          ? ('PERP_HEDGE_RESIDUAL_PRESENT' as const)
          : ('PERP_CLOSE_TERMINAL_REDUCE_ONLY' as const);
  return Object.freeze({
    step,
    phase,
    legKey,
    role: definition.role,
    venue: definition.venue,
    side: definition.side,
    reduceOnly: definition.reduceOnly,
    riskEffect: definition.riskEffect,
    requires: Object.freeze(NORMAL_BASIS_STEP_ORDER.slice(0, index)),
    precondition,
    clientOrderId: definition.clientOrderId,
  });
}

/**
 * Derive the immutable normal-Basis binding for an already-built plan.
 *
 * This is a RECORD, not a permission: `actionAuthority` is the literal
 * NONE_RECORD_ONLY and `sendEligible` is the literal false. It restates the
 * one legal step order, the plan identity it is bound to, the risk intent and
 * verdict digests it was authorized under, the existing one-leg cap, and the
 * bounded close/cancel attempt identities. It never widens anything.
 */
export function deriveNormalBasisPlanBinding(
  plan: BindablePlan,
  request: NormalBasisExecutionBindingRequest,
): Readonly<NormalBasisPlanBinding> {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new TypeError('normalBasis binding request must be an object');
  }
  if (request.version !== NORMAL_BASIS_BINDING_VERSION) {
    throw new TypeError(`normalBasis binding version must be ${NORMAL_BASIS_BINDING_VERSION}`);
  }
  if (plan.direction !== NORMAL_BASIS_DIRECTION) {
    throw new TypeError(`normalBasis binding applies only to ${NORMAL_BASIS_DIRECTION}`);
  }
  if (plan.openingOrder[0] !== 'SPOT' || plan.openingOrder[1] !== 'PERP') {
    throw new TypeError('normalBasis binding requires the SPOT-then-PERP opening order');
  }
  // A record-only binding is never attached to a mode that could imply a send.
  if (plan.mode === 'LIVE_MANUAL') {
    throw new TypeError('normalBasis binding is record-only and cannot be attached to LIVE_MANUAL');
  }
  if (plan.closingLegs.PERP.reduceOnly !== true) {
    throw new TypeError('normalBasis binding requires a reduce-only USD-M close leg');
  }
  if (plan.closingLegs.SPOT.reduceOnly !== false) {
    throw new TypeError('normalBasis binding requires a non-reduce-only Spot close leg');
  }

  const risk = evaluateNormalBasisRiskBinding(request.evaluationInput);
  if (
    risk.planId !== plan.planId ||
    risk.correlationId !== plan.correlationId ||
    risk.proposalRef !== plan.proposal.canonicalProposalId ||
    risk.spot.symbol !== plan.symbol ||
    risk.perp.symbol !== plan.symbol ||
    risk.spot.intendedQty !== plan.openingLegs.SPOT.quantity ||
    risk.perp.intendedQty !== plan.openingLegs.PERP.quantity ||
    risk.declaredMaxNakedDurationMs !== plan.maxNakedDurationMs
  ) {
    throw new TypeError('normalBasis risk truth is not bound to these exact plan terms');
  }
  const entryExpiresAtMs = Math.min(plan.proposal.expiresAtMs, risk.entryExpiresAtMs);
  if (entryExpiresAtMs <= risk.verdictEvaluatedAtMs) {
    throw new TypeError('normalBasis entry authority is already expired');
  }

  const closeAttempts: NormalBasisAttemptIdentity[] = [];
  for (const step of ['PERP_CLOSE', 'SPOT_CLOSE'] as const) {
    for (let attempt = 0; attempt < NORMAL_BASIS_MAX_CLOSE_ATTEMPTS; attempt += 1) {
      closeAttempts.push(deriveNormalBasisCloseAttemptIdentity(plan, step, attempt));
    }
  }
  const identities = new Set(closeAttempts.map((entry) => entry.clientOrderId));
  if (identities.size !== closeAttempts.length) {
    throw new TypeError('normalBasis close attempt identities must all be distinct');
  }

  const semantic = {
    schema: NORMAL_BASIS_BINDING_SCHEMA,
    version: NORMAL_BASIS_BINDING_VERSION,
    planId: plan.planId,
    correlationId: plan.correlationId,
    termsFingerprint: plan.termsFingerprint,
    direction: NORMAL_BASIS_DIRECTION,
    symbol: plan.symbol,
    stepOrder: [...NORMAL_BASIS_STEP_ORDER],
    steps: Object.fromEntries(
      NORMAL_BASIS_STEP_ORDER.map((step) => [step, stepBinding(plan, step)]),
    ) as Record<NormalBasisStep, NormalBasisStepBinding>,
    maxNakedDurationMs: plan.maxNakedDurationMs,
    entryExpiresAtMs,
    proposalExpiresAtMs: plan.proposal.expiresAtMs,
    risk,
    maxCloseAttempts: NORMAL_BASIS_MAX_CLOSE_ATTEMPTS,
    closeAttempts: Object.freeze(closeAttempts),
    policy: Object.freeze({
      requireTerminalOrCancelConfirmedSpotFillBeforeHedge: true as const,
      requireReduceOnlyUsdmCloseBeforeSpotClose: true as const,
      queryFirstOnAmbiguity: true as const,
      allowBlindResubmit: false as const,
      requireBaselineFlatReconciliation: true as const,
      crossProcessExactlyOnce: false as const,
      ledgerCasRequiredForExactlyOnce: true as const,
    }),
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    riskAuthority: 'NONE' as const,
    sendEligible: false as const,
  };
  return Object.freeze({
    ...semantic,
    steps: Object.freeze(semantic.steps),
    stepOrder: Object.freeze(semantic.stepOrder) as readonly NormalBasisStep[],
    bindingId: `nbb${NORMAL_BASIS_BINDING_VERSION}_${stableHash128Hex(
      `normalBasisBinding|${canonicalJson(semantic)}`,
    )}`,
  });
}

/**
 * Replay validator for the compact immutable binding stored in an event or
 * checkpoint. This does not re-evaluate historical evidence; it re-derives
 * every execution term and both content identities from the serialized risk
 * projection.
 */
export function validateNormalBasisPlanBinding(
  plan: BindablePlan,
  candidate: unknown,
): Readonly<NormalBasisPlanBinding> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError('normal-Basis plan binding must be an object');
  }
  const supplied = candidate as NormalBasisPlanBinding;
  if (
    plan.direction !== NORMAL_BASIS_DIRECTION ||
    plan.openingOrder[0] !== 'SPOT' ||
    plan.openingOrder[1] !== 'PERP' ||
    plan.mode === 'LIVE_MANUAL' ||
    plan.closingLegs.PERP.reduceOnly !== true ||
    plan.closingLegs.SPOT.reduceOnly !== false
  ) {
    throw new TypeError('normal-Basis plan terms are not eligible for a binding');
  }
  const risk = validateNormalBasisApprovedRiskBinding(supplied.risk);
  if (
    risk.planId !== plan.planId ||
    risk.correlationId !== plan.correlationId ||
    risk.proposalRef !== plan.proposal.canonicalProposalId ||
    risk.spot.symbol !== plan.symbol ||
    risk.perp.symbol !== plan.symbol ||
    risk.spot.intendedQty !== plan.openingLegs.SPOT.quantity ||
    risk.perp.intendedQty !== plan.openingLegs.PERP.quantity ||
    risk.declaredMaxNakedDurationMs !== plan.maxNakedDurationMs
  ) {
    throw new TypeError('normal-Basis compact risk truth does not match the plan');
  }
  const closeAttempts: NormalBasisAttemptIdentity[] = [];
  for (const step of ['PERP_CLOSE', 'SPOT_CLOSE'] as const) {
    for (let attempt = 0; attempt < NORMAL_BASIS_MAX_CLOSE_ATTEMPTS; attempt += 1) {
      closeAttempts.push(deriveNormalBasisCloseAttemptIdentity(plan, step, attempt));
    }
  }
  const semantic = {
    schema: NORMAL_BASIS_BINDING_SCHEMA,
    version: NORMAL_BASIS_BINDING_VERSION,
    planId: plan.planId,
    correlationId: plan.correlationId,
    termsFingerprint: plan.termsFingerprint,
    direction: NORMAL_BASIS_DIRECTION,
    symbol: plan.symbol,
    stepOrder: [...NORMAL_BASIS_STEP_ORDER],
    steps: Object.fromEntries(
      NORMAL_BASIS_STEP_ORDER.map((step) => [step, stepBinding(plan, step)]),
    ) as Record<NormalBasisStep, NormalBasisStepBinding>,
    maxNakedDurationMs: plan.maxNakedDurationMs,
    entryExpiresAtMs: Math.min(plan.proposal.expiresAtMs, risk.entryExpiresAtMs),
    proposalExpiresAtMs: plan.proposal.expiresAtMs,
    risk,
    maxCloseAttempts: NORMAL_BASIS_MAX_CLOSE_ATTEMPTS,
    closeAttempts: Object.freeze(closeAttempts),
    policy: Object.freeze({
      requireTerminalOrCancelConfirmedSpotFillBeforeHedge: true as const,
      requireReduceOnlyUsdmCloseBeforeSpotClose: true as const,
      queryFirstOnAmbiguity: true as const,
      allowBlindResubmit: false as const,
      requireBaselineFlatReconciliation: true as const,
      crossProcessExactlyOnce: false as const,
      ledgerCasRequiredForExactlyOnce: true as const,
    }),
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    riskAuthority: 'NONE' as const,
    sendEligible: false as const,
  };
  const expected = Object.freeze({
    ...semantic,
    stepOrder: Object.freeze(semantic.stepOrder) as readonly NormalBasisStep[],
    steps: Object.freeze(semantic.steps),
    bindingId: `nbb${NORMAL_BASIS_BINDING_VERSION}_${stableHash128Hex(
      `normalBasisBinding|${canonicalJson(semantic)}`,
    )}`,
  });
  if (canonicalJson(expected) !== canonicalJson(candidate)) {
    throw new TypeError('normal-Basis plan binding content or exact plan terms mismatch');
  }
  return expected;
}

/** Pure seam for a registry enforcing one immutable binding per PlanId. */
export function compareNormalBasisBinding(
  left: Pick<ExecutionPlanDefinition, 'normalBasisBinding'>,
  right: Pick<ExecutionPlanDefinition, 'normalBasisBinding'>,
): NormalBasisBindingComparison {
  const a = left.normalBasisBinding;
  const b = right.normalBasisBinding;
  if (a === undefined && b === undefined) return 'ABSENT_BOTH';
  if (a === undefined || b === undefined) return 'ABSENT_ONE';
  return a.bindingId === b.bindingId ? 'SAME_BINDING' : 'CONFLICTING_BINDING';
}
