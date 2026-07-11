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
  BASIS_EXECUTION_DIRECTIONS,
  EXECUTION_LEG_KEYS,
  type BasisExecutionDirection,
  type CreateExecutionPlanInput,
  type ExecutionLegDefinition,
  type ExecutionLegKey,
  type ExecutionPlanDefinition,
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

  return Object.freeze({
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
