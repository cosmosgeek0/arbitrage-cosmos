import {
  bindSpotOrderTifCapability,
} from '../binanceInstrumentSpecs/index.js';
import {
  evaluateExecutionPolicyWithOwnerBindings,
} from '../executionPolicy/index.js';
import {
  canonicalJson,
  deriveClientOrderId,
  deriveCorrelationId,
  deriveLegId,
  derivePlanId,
  isValidUtcMillis,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import type {
  ExecutionPolicyDecision,
  ExecutionPolicyInput,
  ExecutionPolicyOwnerBindings,
} from '../executionPolicy/types.js';
import {
  NORMAL_BASIS_ENTRY_BINDING_SCHEMA,
  NORMAL_BASIS_FOUNDATION_BINDING_SCHEMA,
  type NormalBasisBindingReason,
  type NormalBasisEntryBindingResult,
  type NormalBasisEntryPolicyBinding,
  type NormalBasisFoundationBinding,
  type NormalBasisFoundationBindingResult,
  type NormalBasisFoundationPlanView,
} from './types.js';

const NONE_AUTHORITY = Object.freeze({
  simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
  sendEligible: false as const,
  actionAuthority: 'NONE_RECORD_ONLY' as const,
  externalActionAuthorization: 'NONE' as const,
});

function cloneFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  const copy = structuredClone(value) as T;
  const visit = (candidate: unknown): void => {
    if (typeof candidate !== 'object' || candidate === null || seen.has(candidate)) return;
    seen.add(candidate);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(candidate))) {
      if (Object.hasOwn(descriptor, 'value')) visit(descriptor.value);
    }
    Object.freeze(candidate);
  };
  visit(copy);
  return copy as Readonly<T>;
}

function revision(prefix: string, value: unknown): string {
  return `${prefix}${stableHash128Hex(canonicalJson(value))}`;
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort());
}

function failedEntry(
  decision: ExecutionPolicyDecision,
  values: readonly NormalBasisBindingReason[],
): NormalBasisEntryBindingResult {
  return Object.freeze({
    ok: false as const,
    decision: cloneFreeze(decision),
    reasonCodes: sortedUnique(values),
  });
}

function exactNoneAuthority(value: Readonly<ExecutionPolicyDecision> | Readonly<NonNullable<ExecutionPolicyDecision['selectedPlan']>>): boolean {
  return value.simulationAuthority === 'SYNTHETIC_FIXTURE'
    && value.sendEligible === false
    && value.actionAuthority === 'NONE_RECORD_ONLY'
    && value.externalActionAuthorization === 'NONE'
    && value.policyAuthority === 'ADVISORY_EXECUTION_MECHANICS_ONLY';
}

function constructEntryBinding(
  inputValue: ExecutionPolicyInput,
  ownerBindingsValue: ExecutionPolicyOwnerBindings,
): NormalBasisEntryBindingResult {
  const input = cloneFreeze(inputValue);
  const ownerBindings = cloneFreeze(ownerBindingsValue);
  const decision = evaluateExecutionPolicyWithOwnerBindings(input, ownerBindings);
  if (decision.disposition !== 'PLANNED' || decision.selectedPlan === null) {
    return failedEntry(decision, ['POLICY_NOT_PLANNED']);
  }
  const plan = decision.selectedPlan;
  const reasons: NormalBasisBindingReason[] = [];
  if (!exactNoneAuthority(decision) || !exactNoneAuthority(plan)) {
    reasons.push('POLICY_AUTHORITY_NOT_EXACT');
  }
  if (plan.sequenceMode !== 'ORDERED' || plan.actions.length !== 2
    || plan.actions[0]?.step !== 0 || plan.actions[1]?.step !== 1) {
    reasons.push('POLICY_ORDERING_NOT_EXACT');
  }
  if (plan.legs.length !== 2) reasons.push('POLICY_LEG_SET_NOT_EXACT');
  const spotLeg = plan.legs.find((leg) => leg.product === 'SPOT');
  const perpLeg = plan.legs.find((leg) => leg.product === 'USD_M_PERPETUAL');
  if (spotLeg === undefined || perpLeg === undefined) reasons.push('POLICY_LEG_SET_NOT_EXACT');
  const spotAction = spotLeg === undefined
    ? undefined
    : plan.actions.find((action) => action.legId === spotLeg.legId);
  const perpAction = perpLeg === undefined
    ? undefined
    : plan.actions.find((action) => action.legId === perpLeg.legId);

  if (spotLeg === undefined || spotAction === undefined
    || spotLeg.side !== 'BUY' || spotLeg.reduceOnly
    || spotLeg.allowedOrderTypes.length !== 1 || spotLeg.allowedOrderTypes[0] !== 'LIMIT'
    || spotLeg.allowedTimeInForce.length !== 1 || spotLeg.allowedTimeInForce[0] !== 'GTC'
    || spotLeg.l04PreflightState !== 'PASS'
    || spotAction.step !== 0 || spotAction.kind !== 'PLACE'
    || spotAction.orderType !== 'LIMIT' || spotAction.timeInForce !== 'GTC'
    || spotAction.quantitySource !== 'AUTHORIZED_FILTERED_QUANTITY'
    || spotAction.quantity !== spotLeg.filteredQuantity
    || spotAction.price !== spotLeg.authorizedLimitPrice
    || spotAction.dependsOnActualFillLegId !== null
    || spotAction.exposureEffect !== 'MAY_OPEN_WITHIN_AUTHORIZATION'
    || spotAction.ambiguityPosture !== 'RECONCILE_ONLY') {
    reasons.push('SPOT_ENTRY_NOT_EXACT');
  }
  if (perpLeg === undefined || perpAction === undefined
    || perpLeg.side !== 'SELL' || perpLeg.reduceOnly
    || !perpLeg.allowedOrderTypes.includes('LIMIT')
    || !perpLeg.allowedTimeInForce.includes('GTC')
    || perpLeg.l04PreflightState !== 'PASS'
    || perpAction.step !== 1 || perpAction.kind !== 'PLACE'
    || perpAction.orderType !== 'LIMIT' || perpAction.timeInForce !== 'GTC'
    || perpAction.quantitySource !== 'ACTUAL_FILL_OF_LEG'
    || perpAction.quantity !== perpLeg.filteredQuantity
    || perpAction.price !== perpLeg.authorizedLimitPrice
    || perpAction.dependsOnActualFillLegId !== spotLeg?.legId
    || perpAction.exposureEffect !== 'MAY_OPEN_WITHIN_AUTHORIZATION'
    || perpAction.ambiguityPosture !== 'RECONCILE_ONLY') {
    reasons.push('PERP_HEDGE_NOT_EXACT');
  }
  if (spotLeg !== undefined && perpLeg !== undefined
    && (spotLeg.symbol !== perpLeg.symbol
      || spotLeg.baseAsset !== perpLeg.baseAsset
      || spotLeg.quoteAsset !== perpLeg.quoteAsset)) {
    reasons.push('POLICY_LEG_SET_NOT_EXACT');
  }

  const ownerInput = ownerBindings.spotOrderTifOwnerInputs.length === 1
    ? ownerBindings.spotOrderTifOwnerInputs[0]
    : null;
  const capabilityResult = ownerInput === null
    ? null
    : bindSpotOrderTifCapability(ownerInput.registrySnapshot, ownerInput.sizingRequest);
  const capability = capabilityResult?.ok === true ? capabilityResult.binding : null;
  if (capability === null || spotLeg === undefined || spotAction === undefined
    || capability.symbol !== spotLeg.symbol
    || capability.baseAsset !== spotLeg.baseAsset
    || capability.quoteAsset !== spotLeg.quoteAsset
    || capability.side !== spotLeg.side
    || capability.orderType !== spotAction.orderType
    || capability.timeInForce !== spotAction.timeInForce
    || capability.instrumentRevision !== spotLeg.instrumentRevision
    || capability.registryRevision !== spotLeg.filterRevision
    || capability.preflightRevision !== spotLeg.l04SizingRevision
    || capability.sourceEvidenceRevision !== spotLeg.l04SourceEvidenceRevision
    || capability.snapshotRevision !== spotLeg.l04SnapshotRevision
    || capability.requestedPrice !== spotAction.price
    || capability.resultQuantity !== spotAction.quantity
    || capability.validUntilMs !== plan.expiresAtMs
    || !plan.evidenceRevisions.includes(`SPOT_ORDER_TIF_CAPABILITY:${capability.capabilityRevision}`)
    || capability.sendEligible !== false
    || capability.actionAuthority !== 'NONE_RECORD_ONLY'
    || capability.externalActionAuthorization !== 'NONE') {
    reasons.push('SPOT_OWNER_BINDING_NOT_EXACT');
  }

  if (reasons.length > 0 || spotLeg === undefined || perpLeg === undefined
    || spotAction === undefined || perpAction === undefined || capability === null) {
    return failedEntry(decision, reasons.length > 0 ? reasons : ['POLICY_LEG_SET_NOT_EXACT']);
  }
  const material = {
    input,
    ownerBindings,
    decision,
    plan,
    spotLeg,
    perpLeg,
    spotAction,
    perpAction,
    spotCapability: capability,
    lifecycleAuthority: 'FOUNDATION_EXECUTION' as const,
    reconciliationAuthority: 'FOUNDATION_RECONCILIATION' as const,
    ...NONE_AUTHORITY,
  };
  return Object.freeze({
    ok: true as const,
    binding: cloneFreeze({
      schema: NORMAL_BASIS_ENTRY_BINDING_SCHEMA,
      ...material,
      bindingRevision: revision('l09entry_', material),
    } satisfies NormalBasisEntryPolicyBinding),
  });
}

/** Reruns accepted L08.1 before admitting the structural normal-Basis entry. */
export function evaluateNormalBasisEntryBinding(
  input: ExecutionPolicyInput,
  ownerBindings: ExecutionPolicyOwnerBindings,
): NormalBasisEntryBindingResult {
  return constructEntryBinding(input, ownerBindings);
}

export function validateNormalBasisEntryBinding(
  value: Readonly<NormalBasisEntryPolicyBinding>,
): Readonly<NormalBasisEntryPolicyBinding> {
  if (value?.schema !== NORMAL_BASIS_ENTRY_BINDING_SCHEMA) {
    throw new TypeError('normal-Basis entry binding schema mismatch');
  }
  const reproduced = constructEntryBinding(value.input, value.ownerBindings);
  if (!reproduced.ok || canonicalJson(reproduced.binding) !== canonicalJson(value)) {
    throw new TypeError('normal-Basis entry binding is not reproducible by the accepted evaluator');
  }
  return reproduced.binding;
}

function finitePositiveProjection(value: number, exact: string): boolean {
  const projected = Number(exact);
  return Number.isFinite(value) && value > 0
    && Number.isFinite(projected) && projected > 0
    && value === projected && String(value) === exact;
}

function validFoundationLeg(
  leg: NormalBasisFoundationPlanView['openingLegs']['SPOT'],
  expected: {
    key: 'SPOT' | 'PERP';
    phase: 'OPEN' | 'CLOSE';
    role: 'SPOT_OPEN' | 'PERP_OPEN' | 'SPOT_CLOSE' | 'PERP_CLOSE';
    venue: 'BINANCE_SPOT' | 'BINANCE_USDM';
    side: 'BUY' | 'SELL';
    reduceOnly: boolean;
    riskEffect: 'RISK_INCREASING' | 'RISK_REDUCING';
  },
): boolean {
  return typeof leg?.legId === 'string' && leg.legId.length > 0
    && typeof leg.clientOrderId === 'string' && leg.clientOrderId.length > 0
    && leg.key === expected.key
    && leg.phase === expected.phase
    && leg.role === expected.role
    && leg.venue === expected.venue
    && leg.side === expected.side
    && leg.reduceOnly === expected.reduceOnly
    && leg.riskEffect === expected.riskEffect;
}

function canonicalFoundationPlanIdentityExact(
  ownerPlan: Readonly<NormalBasisFoundationPlanView>,
): boolean {
  if (typeof ownerPlan?.proposal?.canonicalProposalId !== 'string'
    || ownerPlan.proposal.canonicalProposalId.length === 0
    || !Number.isSafeInteger(ownerPlan.attempt) || ownerPlan.attempt < 0
    || !isValidUtcMillis(ownerPlan.proposal.observedAtMs)
    || !isValidUtcMillis(ownerPlan.proposal.expiresAtMs)
    || !Number.isSafeInteger(ownerPlan.proposal.maxAgeMs) || ownerPlan.proposal.maxAgeMs <= 0
    || ownerPlan.proposal.expiresAtMs <= ownerPlan.proposal.observedAtMs
    || typeof ownerPlan.requiresApproval !== 'boolean'
    || ownerPlan.strategy !== 'BASIS'
    || ownerPlan.direction !== 'LONG_SPOT_SHORT_PERP'
    || typeof ownerPlan.symbol !== 'string' || ownerPlan.symbol.length === 0
    || ownerPlan.mode !== 'PAPER'
    || !Number.isSafeInteger(ownerPlan.maxNakedDurationMs) || ownerPlan.maxNakedDurationMs <= 0
    || !Array.isArray(ownerPlan.openingOrder) || ownerPlan.openingOrder.length !== 2
    || typeof ownerPlan.openingLegs?.SPOT?.quantity !== 'number'
    || typeof ownerPlan.openingLegs?.PERP?.quantity !== 'number'
    || !Number.isFinite(ownerPlan.openingLegs.SPOT.quantity)
    || !Number.isFinite(ownerPlan.openingLegs.PERP.quantity)
    || ownerPlan.openingLegs.SPOT.quantity <= 0
    || ownerPlan.openingLegs.PERP.quantity <= 0) return false;
  const planId = derivePlanId({
    canonicalProposalId: ownerPlan.proposal.canonicalProposalId,
    attempt: ownerPlan.attempt,
  });
  if (ownerPlan.planId !== planId
    || ownerPlan.correlationId !== deriveCorrelationId({ origin: 'execution-plan', key: planId })) {
    return false;
  }
  const termsFingerprint = `terms_${stableHash128Hex(canonicalJson({
    strategy: ownerPlan.strategy,
    direction: ownerPlan.direction,
    symbol: ownerPlan.symbol,
    proposal: ownerPlan.proposal,
    attempt: ownerPlan.attempt,
    mode: ownerPlan.mode,
    requiresApproval: ownerPlan.requiresApproval,
    maxNakedDurationMs: ownerPlan.maxNakedDurationMs,
    spotQuantity: ownerPlan.openingLegs?.SPOT?.quantity,
    perpQuantity: ownerPlan.openingLegs?.PERP?.quantity,
    openingOrder: ownerPlan.openingOrder,
  }))}`;
  if (ownerPlan.termsFingerprint !== termsFingerprint) return false;
  const identities = [
    ['SPOT', 'OPEN', ownerPlan.openingLegs?.SPOT],
    ['PERP', 'OPEN', ownerPlan.openingLegs?.PERP],
    ['SPOT', 'CLOSE', ownerPlan.closingLegs?.SPOT],
    ['PERP', 'CLOSE', ownerPlan.closingLegs?.PERP],
  ] as const;
  return identities.every(([key, phase, leg]) => {
    if (leg === undefined) return false;
    const legId = deriveLegId({
      planId,
      legRole: `${key}_${phase}:${termsFingerprint}`,
    });
    return leg.legId === legId
      && leg.clientOrderId === deriveClientOrderId({ planId, legId, attempt: 0 });
  }) && new Set(identities.map(([, , leg]) => leg?.legId)).size === 4
    && new Set(identities.map(([, , leg]) => leg?.clientOrderId)).size === 4;
}

export function bindNormalBasisFoundationPlan(
  entryValue: Readonly<NormalBasisEntryPolicyBinding>,
  ownerPlanValue: Readonly<NormalBasisFoundationPlanView>,
): NormalBasisFoundationBindingResult {
  const entry = validateNormalBasisEntryBinding(entryValue);
  const ownerPlan = cloneFreeze(ownerPlanValue);
  const reasons: NormalBasisBindingReason[] = [];
  if (!canonicalFoundationPlanIdentityExact(ownerPlan)
    || ownerPlan?.planId !== entry.plan.externalPlanId
    || ownerPlan.correlationId !== entry.plan.correlationId
    || ownerPlan.proposal.observedAtMs > entry.input.evaluatedAtMs
    || entry.input.evaluatedAtMs - ownerPlan.proposal.observedAtMs > ownerPlan.proposal.maxAgeMs
    || entry.input.evaluatedAtMs >= ownerPlan.proposal.expiresAtMs
    || entry.plan.expiresAtMs > ownerPlan.proposal.expiresAtMs) {
    reasons.push('FOUNDATION_PLAN_IDENTITY_NOT_EXACT');
  }
  if (ownerPlan.strategy !== 'BASIS' || ownerPlan.direction !== 'LONG_SPOT_SHORT_PERP'
    || ownerPlan.symbol !== entry.spotLeg.symbol || ownerPlan.mode !== 'PAPER') {
    reasons.push('FOUNDATION_DIRECTION_NOT_EXACT');
  }
  if (!Array.isArray(ownerPlan.openingOrder) || ownerPlan.openingOrder.length !== 2
    || ownerPlan.openingOrder[0] !== 'SPOT' || ownerPlan.openingOrder[1] !== 'PERP'
    || !validFoundationLeg(ownerPlan.openingLegs?.SPOT, {
      key: 'SPOT', phase: 'OPEN', role: 'SPOT_OPEN', venue: 'BINANCE_SPOT',
      side: 'BUY', reduceOnly: false, riskEffect: 'RISK_INCREASING',
    })
    || !validFoundationLeg(ownerPlan.openingLegs?.PERP, {
      key: 'PERP', phase: 'OPEN', role: 'PERP_OPEN', venue: 'BINANCE_USDM',
      side: 'SELL', reduceOnly: false, riskEffect: 'RISK_INCREASING',
    })
    || !validFoundationLeg(ownerPlan.closingLegs?.SPOT, {
      key: 'SPOT', phase: 'CLOSE', role: 'SPOT_CLOSE', venue: 'BINANCE_SPOT',
      side: 'SELL', reduceOnly: false, riskEffect: 'RISK_REDUCING',
    })
    || !validFoundationLeg(ownerPlan.closingLegs?.PERP, {
      key: 'PERP', phase: 'CLOSE', role: 'PERP_CLOSE', venue: 'BINANCE_USDM',
      side: 'BUY', reduceOnly: true, riskEffect: 'RISK_REDUCING',
    })) {
    reasons.push('FOUNDATION_LEG_SET_NOT_EXACT');
  }
  if (!finitePositiveProjection(ownerPlan.openingLegs?.SPOT?.quantity, entry.spotLeg.filteredQuantity)
    || !finitePositiveProjection(ownerPlan.openingLegs?.PERP?.quantity, entry.perpLeg.filteredQuantity)
    || ownerPlan.openingLegs?.SPOT?.quantity !== ownerPlan.openingLegs?.PERP?.quantity
    || ownerPlan.closingLegs?.SPOT?.quantity !== ownerPlan.openingLegs?.SPOT?.quantity
    || ownerPlan.closingLegs?.PERP?.quantity !== ownerPlan.openingLegs?.PERP?.quantity) {
    reasons.push('FOUNDATION_QUANTITY_PROJECTION_NOT_EXACT');
  }
  const maximumNakedDurationMs = Math.min(
    entry.input.authority.mandateConstraints.maxNakedDurationMs,
    entry.input.authority.capitalConstraints.maxNakedDurationMs,
    entry.input.authority.riskConstraints.maxNakedDurationMs,
    entry.input.authority.approvalConstraints.maxNakedDurationMs,
  );
  if (!Number.isSafeInteger(ownerPlan.maxNakedDurationMs)
    || ownerPlan.maxNakedDurationMs <= 0
    || ownerPlan.maxNakedDurationMs > maximumNakedDurationMs) {
    reasons.push('FOUNDATION_NAKED_DURATION_EXCEEDS_POLICY');
  }
  if (reasons.length > 0) {
    return Object.freeze({ ok: false as const, reasonCodes: sortedUnique(reasons) });
  }
  const aliases = Object.freeze([
    Object.freeze({
      policyLegId: entry.spotLeg.legId,
      foundationOpenLegId: ownerPlan.openingLegs.SPOT.legId,
      foundationCloseLegId: ownerPlan.closingLegs.SPOT.legId,
      clientOpenOrderId: ownerPlan.openingLegs.SPOT.clientOrderId,
      clientCloseOrderId: ownerPlan.closingLegs.SPOT.clientOrderId,
      product: 'SPOT' as const,
    }),
    Object.freeze({
      policyLegId: entry.perpLeg.legId,
      foundationOpenLegId: ownerPlan.openingLegs.PERP.legId,
      foundationCloseLegId: ownerPlan.closingLegs.PERP.legId,
      clientOpenOrderId: ownerPlan.openingLegs.PERP.clientOrderId,
      clientCloseOrderId: ownerPlan.closingLegs.PERP.clientOrderId,
      product: 'USD_M_PERPETUAL' as const,
    }),
  ]);
  const material = {
    entry,
    ownerPlan,
    aliases,
    quantityProjection: 'BINARY64_PROJECTION' as const,
    lifecycleAuthority: 'FOUNDATION_EXECUTION' as const,
    ...NONE_AUTHORITY,
  };
  return Object.freeze({
    ok: true as const,
    binding: cloneFreeze({
      schema: NORMAL_BASIS_FOUNDATION_BINDING_SCHEMA,
      ...material,
      foundationBindingRevision: revision('l09foundation_', material),
    } satisfies NormalBasisFoundationBinding),
  });
}

export function validateNormalBasisFoundationBinding(
  value: Readonly<NormalBasisFoundationBinding>,
): Readonly<NormalBasisFoundationBinding> {
  if (value?.schema !== NORMAL_BASIS_FOUNDATION_BINDING_SCHEMA) {
    throw new TypeError('normal-Basis Foundation binding schema mismatch');
  }
  const reproduced = bindNormalBasisFoundationPlan(value.entry, value.ownerPlan);
  if (!reproduced.ok || canonicalJson(reproduced.binding) !== canonicalJson(value)) {
    throw new TypeError('normal-Basis Foundation binding is not reproducible');
  }
  return reproduced.binding;
}
