import {
  canonicalJson,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import {
  addTwinDecimals,
  compareTwinDecimals,
  signedTwinResidual,
  subtractTwinDecimals,
  twinDecimal,
} from '../exchangeTwin/index.js';
import {
  validateNormalBasisFoundationBinding,
} from './binding.js';
import {
  cloneFreezeNormalBasis,
  hydrateNormalBasisOwnerCheckpoint,
} from './ownerCheckpoint.js';
import {
  validateNormalBasisTwinLegObservation,
} from './twinAdapter.js';
import {
  NORMAL_BASIS_OWNER_AGREEMENT_SCHEMA,
  NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA,
  type EvaluateNormalBasisOwnerAgreementInput,
  type NormalBasisCanonicalOutcome,
  type NormalBasisFoundationReconciliationView,
  type NormalBasisFoundationStateView,
  type NormalBasisOwnerAgreement,
  type NormalBasisRecoveryRecommendationView,
} from './types.js';

function revision(prefix: string, value: unknown): string {
  return `${prefix}${stableHash128Hex(canonicalJson(value))}`;
}

const RECONCILIATION_STATUSES = Object.freeze([
  'EXACT', 'PENDING', 'PARTIAL', 'AMBIGUOUS', 'DIVERGED', 'STALE', 'UNAVAILABLE',
] as const);
const RECONCILIATION_RECOMMENDATIONS = Object.freeze([
  'WAIT', 'REFRESH', 'CANCEL_REMAINDER', 'HEDGE_RESIDUAL', 'CLOSE_POSITION',
  'MANUAL_REVIEW', 'NO_ACTION',
] as const);
const LEG_LIFECYCLES = Object.freeze([
  'PLANNED', 'VALIDATED', 'SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED',
  'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'REJECTED', 'AMBIGUOUS',
] as const);
const OBSERVED_ORDER_STATUSES = Object.freeze([
  'NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'UNKNOWN',
] as const);
const RECONCILIATION_SEVERITY = Object.freeze({
  EXACT: 0,
  PENDING: 1,
  PARTIAL: 2,
  STALE: 3,
  UNAVAILABLE: 4,
  AMBIGUOUS: 5,
  DIVERGED: 6,
} as const);
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,95}$/;

function exactKeys(value: object, keys: readonly string[], label: string): void {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function reconciliationStatus(value: unknown, label: string): keyof typeof RECONCILIATION_SEVERITY {
  if (typeof value !== 'string'
    || !(RECONCILIATION_STATUSES as readonly string[]).includes(value)) {
    throw new TypeError(`${label} is not a canonical Foundation reconciliation status`);
  }
  return value as keyof typeof RECONCILIATION_SEVERITY;
}

function finiteNumber(value: unknown, label: string, nonNegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonNegative && value < 0)) {
    throw new TypeError(`${label} must be a finite${nonNegative ? ' non-negative' : ''} number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function nullableNumber(value: unknown, label: string, nonNegative = false): number | null {
  return value === null ? null : finiteNumber(value, label, nonNegative);
}

function reasonCodes(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 64
    || value.some((item) => typeof item !== 'string' || !REASON_CODE.test(item))
    || new Set(value).size !== value.length) {
    throw new TypeError(`${label} are not canonical unique Foundation reason codes`);
  }
  return value as readonly string[];
}

function ownerQuantity(value: number, label: string): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite Foundation quantity`);
  }
  const projected = String(value);
  if (Number(projected) !== value) {
    throw new TypeError(`${label} did not round-trip through binary64`);
  }
  return twinDecimal(projected, label);
}

function ownerQuantities(state: Readonly<NormalBasisFoundationStateView>): Readonly<{
  openingSpotQuantity: string;
  openingPerpQuantity: string;
  closingSpotQuantity: string;
  closingPerpQuantity: string;
}> {
  const output = {
    openingSpotQuantity: ownerQuantity(
      state.openingLegs.SPOT.cumulativeFilledQuantity,
      'Foundation agreement Spot opening fill',
    ),
    openingPerpQuantity: ownerQuantity(
      state.openingLegs.PERP.cumulativeFilledQuantity,
      'Foundation agreement Perp opening fill',
    ),
    closingSpotQuantity: ownerQuantity(
      state.closingLegs.SPOT.cumulativeFilledQuantity,
      'Foundation agreement Spot closing fill',
    ),
    closingPerpQuantity: ownerQuantity(
      state.closingLegs.PERP.cumulativeFilledQuantity,
      'Foundation agreement Perp closing fill',
    ),
  };
  if (compareTwinDecimals(output.closingSpotQuantity, output.openingSpotQuantity) > 0
    || compareTwinDecimals(output.closingPerpQuantity, output.openingPerpQuantity) > 0) {
    throw new TypeError('Foundation agreement close fill exceeds its confirmed opening fill');
  }
  return Object.freeze(output);
}

function stateLeg(
  state: Readonly<NormalBasisFoundationStateView>,
  phase: 'OPEN' | 'CLOSE',
  key: 'SPOT' | 'PERP',
) {
  return phase === 'OPEN' ? state.openingLegs[key] : state.closingLegs[key];
}

function expectedPositionDelta(
  state: Readonly<NormalBasisFoundationStateView>,
  key: 'SPOT' | 'PERP',
): number {
  const opening = state.openingLegs[key];
  const closing = state.closingLegs[key];
  const signed = (side: 'BUY' | 'SELL', quantity: number): number => (
    side === 'BUY' ? quantity : -quantity
  );
  return signed(opening.definition.side, opening.cumulativeFilledQuantity)
    + signed(closing.definition.side, closing.cumulativeFilledQuantity);
}

function validateReconciledLeg(
  value: Readonly<NormalBasisFoundationReconciliationView['legs'][number]>,
  state: Readonly<NormalBasisFoundationStateView>,
  expectedIdentity: string,
): keyof typeof RECONCILIATION_SEVERITY {
  exactKeys(value, [
    'phase', 'legKey', 'clientOrderId', 'venueOrderId', 'expectedLifecycle',
    'expectedSubmittedQuantity', 'expectedFilledQuantity', 'observedOrderStatus',
    'observedOrderFilledQuantity', 'observedTradeFilledQuantity',
    'observedFilledQuantity', 'observedRemainderQuantity', 'status', 'reasonCodes',
  ], 'Foundation reconciled leg');
  const identity = `${value.phase}:${value.legKey}`;
  if (identity !== expectedIdentity
    || !['OPEN', 'CLOSE'].includes(value.phase)
    || !['SPOT', 'PERP'].includes(value.legKey)
    || !(LEG_LIFECYCLES as readonly string[]).includes(value.expectedLifecycle)
    || (value.venueOrderId !== null
      && (typeof value.venueOrderId !== 'string' || value.venueOrderId.length === 0))
    || (value.observedOrderStatus !== null
      && !(OBSERVED_ORDER_STATUSES as readonly string[]).includes(value.observedOrderStatus))) {
    throw new TypeError('Foundation reconciliation carries an invalid canonical leg identity');
  }
  const leg = stateLeg(state, value.phase, value.legKey);
  const submitted = finiteNumber(
    value.expectedSubmittedQuantity,
    'Foundation expected submitted quantity',
    true,
  );
  const expectedFilled = finiteNumber(
    value.expectedFilledQuantity,
    'Foundation expected filled quantity',
    true,
  );
  const orderFilled = nullableNumber(
    value.observedOrderFilledQuantity,
    'Foundation observed order fill',
    true,
  );
  const tradeFilled = nullableNumber(
    value.observedTradeFilledQuantity,
    'Foundation observed trade fill',
    true,
  );
  const observedFilled = nullableNumber(
    value.observedFilledQuantity,
    'Foundation observed fill',
    true,
  );
  const remainder = nullableNumber(
    value.observedRemainderQuantity,
    'Foundation observed remainder',
    true,
  );
  const status = reconciliationStatus(value.status, 'Foundation leg status');
  const reasons = reasonCodes(value.reasonCodes, 'Foundation leg reason codes');
  if (value.clientOrderId !== leg.definition.clientOrderId
    || (leg.venueOrderId !== null && value.venueOrderId !== leg.venueOrderId)
    || value.expectedLifecycle !== leg.lifecycle
    || submitted !== leg.submittedQuantity
    || expectedFilled !== leg.cumulativeFilledQuantity
    || expectedFilled > submitted
    || (observedFilled === null) !== (remainder === null)
    || (observedFilled !== null
      && (observedFilled > submitted || remainder !== Math.max(0, submitted - observedFilled)))) {
    throw new TypeError('Foundation reconciliation leg lineage diverges from the checkpoint');
  }
  if (status === 'EXACT') {
    const reproducedObserved = tradeFilled !== null && tradeFilled > 0
      ? tradeFilled : orderFilled ?? tradeFilled;
    if (reasons.length !== 0
      || (orderFilled !== null && tradeFilled !== null && orderFilled !== tradeFilled)
      || reproducedObserved !== observedFilled
      || (!['SUBMITTING', 'AMBIGUOUS'].includes(value.expectedLifecycle)
        && observedFilled !== expectedFilled)
      || (value.observedOrderStatus === 'FILLED' && observedFilled !== submitted)
      || (['NEW', 'REJECTED'].includes(value.observedOrderStatus ?? '')
        && observedFilled !== 0)
      || (value.observedOrderStatus === 'PARTIALLY_FILLED'
        && (observedFilled === null || observedFilled <= 0 || observedFilled >= submitted))) {
      throw new TypeError('Foundation EXACT leg does not reproduce from its owner components');
    }
  }
  return status;
}

function validateReconciledPosition(
  value: Readonly<NormalBasisFoundationReconciliationView['positions'][number]>,
  state: Readonly<NormalBasisFoundationStateView>,
  expectedVenue: 'BINANCE_SPOT' | 'BINANCE_USDM',
): keyof typeof RECONCILIATION_SEVERITY {
  exactKeys(value, [
    'venue', 'expectedDeltaQuantity', 'observedDeltaQuantity', 'differenceQuantity',
    'status', 'reasonCodes',
  ], 'Foundation position comparison');
  const key = expectedVenue === 'BINANCE_SPOT' ? 'SPOT' : 'PERP';
  const expected = finiteNumber(value.expectedDeltaQuantity, 'Foundation expected position delta');
  const observed = nullableNumber(value.observedDeltaQuantity, 'Foundation observed position delta');
  const difference = nullableNumber(value.differenceQuantity, 'Foundation position difference');
  const status = reconciliationStatus(value.status, 'Foundation position status');
  const reasons = reasonCodes(value.reasonCodes, 'Foundation position reason codes');
  if (value.venue !== expectedVenue
    || expected !== expectedPositionDelta(state, key)
    || (observed === null) !== (difference === null)
    || (observed !== null && difference !== observed - expected)
    || (status === 'EXACT' && (observed === null || reasons.length !== 0))) {
    throw new TypeError('Foundation position comparison is not canonical for the checkpoint');
  }
  return status;
}

function validateReconciliationSource(
  value: Readonly<NormalBasisFoundationReconciliationView['sources']['orders']>,
  state: Readonly<NormalBasisFoundationStateView>,
  evaluatedAtMs: number,
  historyRequired: boolean,
): keyof typeof RECONCILIATION_SEVERITY {
  exactKeys(value, [
    'sourceId', 'sourceTimeMs', 'receivedAtMs', 'maxAgeMs', 'freshness', 'authority',
    'completeness', 'coverageStartMs', 'coverageEndMs', 'status', 'reasonCodes',
  ], 'Foundation reconciliation source');
  const sourceTimeMs = value.sourceTimeMs === null
    ? null : finiteNumber(value.sourceTimeMs, 'Foundation source time', true);
  const receivedAtMs = finiteNumber(value.receivedAtMs, 'Foundation source receipt time', true);
  const maxAgeMs = finiteNumber(value.maxAgeMs, 'Foundation source maximum age', true);
  const coverageStartMs = value.coverageStartMs === null
    ? null : finiteNumber(value.coverageStartMs, 'Foundation source coverage start', true);
  const coverageEndMs = value.coverageEndMs === null
    ? null : finiteNumber(value.coverageEndMs, 'Foundation source coverage end', true);
  const status = reconciliationStatus(value.status, 'Foundation source status');
  const reasons = reasonCodes(value.reasonCodes, 'Foundation source reason codes');
  if (typeof value.sourceId !== 'string' || value.sourceId.length === 0
    || !Number.isSafeInteger(sourceTimeMs ?? 0)
    || !Number.isSafeInteger(receivedAtMs)
    || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0
    || !['FRESH', 'STALE', 'UNAVAILABLE', 'CLOCK_SKEWED'].includes(value.freshness)
    || !['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST', 'UNAVAILABLE']
      .includes(value.authority)
    || !['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(value.completeness)
    || (coverageStartMs === null) !== (coverageEndMs === null)
    || (coverageStartMs !== null && coverageEndMs !== null
      && (!Number.isSafeInteger(coverageStartMs) || !Number.isSafeInteger(coverageEndMs)
        || coverageStartMs > coverageEndMs))) {
    throw new TypeError('Foundation reconciliation source has an invalid evidence tuple');
  }
  if (status === 'EXACT') {
    const freshnessTime = sourceTimeMs ?? receivedAtMs;
    if (value.freshness !== 'FRESH'
      || !['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'].includes(value.authority)
      || value.completeness !== 'COMPLETE'
      || reasons.length !== 0
      || receivedAtMs > evaluatedAtMs || freshnessTime > evaluatedAtMs
      || evaluatedAtMs - freshnessTime > maxAgeMs
      || (historyRequired && (coverageStartMs === null || coverageEndMs === null
        || coverageStartMs > state.createdAtMs || coverageEndMs < freshnessTime))) {
      throw new TypeError('Foundation EXACT source lacks fresh complete private evidence');
    }
  }
  return status;
}

function validateReconciliation(
  value: Readonly<NormalBasisFoundationReconciliationView>,
  state: Readonly<NormalBasisFoundationStateView>,
  expectedEvaluatedAtMs: number,
): Readonly<{
  result: Readonly<NormalBasisFoundationReconciliationView>;
  evidenceRevision: string;
  blocking: boolean;
  manual: boolean;
}> {
  const result = cloneFreezeNormalBasis(value);
  const topKeys = [
    'correlationId', 'evaluatedAtMs', 'executionAuthority', 'legs', 'normalization',
    'planId', 'positions', 'reasons', 'recommendation', 'sources', 'status',
  ];
  if (result === null || typeof result !== 'object'
    || Object.keys(result).sort().join(',') !== [...topKeys].sort().join(',')
    || result.planId !== state.plan.planId
    || result.correlationId !== state.plan.correlationId
    || !Number.isSafeInteger(result.evaluatedAtMs)
    || result.evaluatedAtMs !== expectedEvaluatedAtMs
    || result.evaluatedAtMs < state.updatedAtMs
    || result.executionAuthority !== 'NONE'
    || !Array.isArray(result.reasons)
    || !Array.isArray(result.legs) || result.legs.length !== 4
    || !Array.isArray(result.positions) || result.positions.length !== 2) {
    throw new TypeError('canonical Foundation reconciliation result is not exact for the checkpoint');
  }
  const statuses: (keyof typeof RECONCILIATION_SEVERITY)[] = [];
  const legIdentities = ['OPEN:SPOT', 'OPEN:PERP', 'CLOSE:SPOT', 'CLOSE:PERP'];
  result.legs.forEach((leg, index) => {
    statuses.push(validateReconciledLeg(leg, state, legIdentities[index]!));
  });
  statuses.push(validateReconciledPosition(result.positions[0]!, state, 'BINANCE_SPOT'));
  statuses.push(validateReconciledPosition(result.positions[1]!, state, 'BINANCE_USDM'));
  if (result.sources === null || typeof result.sources !== 'object') {
    throw new TypeError('Foundation reconciliation source reports are required');
  }
  exactKeys(result.sources, ['orders', 'fills', 'positions'], 'Foundation source reports');
  statuses.push(validateReconciliationSource(
    result.sources.orders,
    state,
    result.evaluatedAtMs,
    true,
  ));
  statuses.push(validateReconciliationSource(
    result.sources.fills,
    state,
    result.evaluatedAtMs,
    true,
  ));
  statuses.push(validateReconciliationSource(
    result.sources.positions,
    state,
    result.evaluatedAtMs,
    false,
  ));
  for (const reason of result.reasons) {
    exactKeys(reason, ['code', 'status', 'detail', 'evidenceKind', 'phase', 'legKey'],
      'Foundation reconciliation reason');
    const status = reconciliationStatus(reason.status, 'Foundation reason status');
    if (typeof reason.code !== 'string' || !REASON_CODE.test(reason.code)
      || typeof reason.detail !== 'string' || reason.detail.length === 0
      || (reason.evidenceKind !== null
        && !['ORDERS', 'FILLS', 'POSITIONS'].includes(reason.evidenceKind))
      || (reason.phase !== null && !['OPEN', 'CLOSE'].includes(reason.phase))
      || (reason.legKey !== null && !['SPOT', 'PERP'].includes(reason.legKey))) {
      throw new TypeError('Foundation reconciliation reason is not canonical');
    }
    statuses.push(status);
  }
  if (result.normalization === null || typeof result.normalization !== 'object') {
    throw new TypeError('Foundation reconciliation normalization statistics are required');
  }
  const normalizationKeys = [
    'exactDuplicateOrdersDropped', 'exactDuplicateFillsDropped',
    'exactDuplicatePositionsDropped', 'outOfOrderFillPairs',
  ];
  exactKeys(result.normalization, normalizationKeys, 'Foundation normalization statistics');
  for (const key of normalizationKeys) {
    const count = result.normalization[key as keyof typeof result.normalization];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError('Foundation normalization count is invalid');
    }
  }
  const status = reconciliationStatus(result.status, 'Foundation result status');
  const worst = statuses.reduce<keyof typeof RECONCILIATION_SEVERITY>(
    (current, candidate) => (
      RECONCILIATION_SEVERITY[candidate] > RECONCILIATION_SEVERITY[current]
        ? candidate : current
    ),
    'EXACT',
  );
  if (!(RECONCILIATION_RECOMMENDATIONS as readonly string[]).includes(result.recommendation)
    || status !== worst
    || (status === 'EXACT'
      && (result.recommendation !== 'NO_ACTION' || result.reasons.length !== 0))
    || (status !== 'EXACT' && result.recommendation === 'NO_ACTION')) {
    throw new TypeError('Foundation result status/recommendation does not reproduce from owner evidence');
  }
  return Object.freeze({
    result,
    evidenceRevision: revision('l09reconciliationevidence_', result),
    blocking: ['AMBIGUOUS', 'DIVERGED', 'STALE', 'UNAVAILABLE'].includes(status),
    manual: status === 'PENDING' || status === 'PARTIAL',
  });
}

function recoveryLineage(
  input: Readonly<EvaluateNormalBasisOwnerAgreementInput>,
  state: Readonly<NormalBasisFoundationStateView>,
  checkpointChecksum: string,
  reconciliationEvidenceRevision: string,
  reconciliationEvaluatedAtMs: number,
): readonly Readonly<NormalBasisRecoveryRecommendationView>[] {
  if (!Number.isSafeInteger(input.recoveryEvaluatedAtMs)
    || input.recoveryEvaluatedAtMs < reconciliationEvaluatedAtMs
    || typeof input.recoveryProvider?.recommendExecutionRecovery !== 'function') {
    throw new TypeError('canonical Foundation recovery provider and evaluation time are required');
  }
  const raw = input.recoveryProvider.recommendExecutionRecovery(
    state,
    input.recoveryEvaluatedAtMs,
  );
  if (!Array.isArray(raw) || raw.length > 12) {
    throw new TypeError('normal-Basis recovery recommendations exceed the closed bound');
  }
  const output = raw.map((recommendation) => {
    if (Object.keys(recommendation).sort().join(',')
        !== 'action,automatic,clientOrderId,legKey,phase,reason,riskEffect'
      || ![
        'VERIFY_AMBIGUOUS_ORDER', 'HEDGE_RESIDUAL', 'CLOSE_EXPOSED_LEG',
        'CANCEL_REMAINDER', 'MANUAL_REVIEW', 'NO_ACTION',
      ].includes(recommendation.action)
      || !['RISK_REDUCING', 'NEUTRAL'].includes(recommendation.riskEffect)
      || recommendation.automatic !== false
      || typeof recommendation.reason !== 'string' || recommendation.reason.length === 0) {
      throw new TypeError('normal-Basis recovery recommendation lost canonical owner fields');
    }
    let legId: string | null = null;
    if (recommendation.phase === null || recommendation.legKey === null) {
      if (recommendation.phase !== null || recommendation.legKey !== null
        || recommendation.clientOrderId !== null) {
        throw new TypeError('plan-wide recovery recommendation carries partial leg lineage');
      }
    } else {
      const leg = stateLeg(state, recommendation.phase, recommendation.legKey);
      if (recommendation.clientOrderId !== leg.definition.clientOrderId) {
        throw new TypeError('leg recovery recommendation carries a different client-order ID');
      }
      legId = leg.definition.legId;
    }
    const material = {
      planId: state.plan.planId,
      correlationId: state.plan.correlationId,
      ownerCheckpointChecksum: checkpointChecksum,
      ownerRevision: state.revision,
      ownerStateRevision: state.stateRevisionId,
      reconciliationEvidenceRevision,
      evaluatedAtMs: input.recoveryEvaluatedAtMs,
      action: recommendation.action,
      riskEffect: recommendation.riskEffect,
      reason: recommendation.reason,
      phase: recommendation.phase,
      legKey: recommendation.legKey,
      legId,
      clientOrderId: recommendation.clientOrderId,
      automatic: false as const,
    };
    return Object.freeze({
      ...material,
      recommendationRevision: revision('l09recovery_', material),
    });
  });
  return Object.freeze(output);
}

/**
 * Cross-checks accepted L06/L07 evidence against replayed Foundation owner
 * checkpoint truth and the full canonical Foundation reconciliation result.
 */
export function evaluateNormalBasisOwnerAgreement(
  input: Readonly<EvaluateNormalBasisOwnerAgreementInput>,
): Readonly<NormalBasisOwnerAgreement> {
  const binding = validateNormalBasisFoundationBinding(input.foundationBinding);
  const checkpoint = hydrateNormalBasisOwnerCheckpoint(
    binding,
    input.ownerCheckpoint,
    input.ownerCheckpointHydrator,
  );
  const state = checkpoint.state;
  if (!['CLOSED', 'HEDGED_OPEN', 'ONE_LEG_EXPOSED', 'RECOVERY_REQUIRED', 'FAILED']
    .includes(state.lifecycle)) {
    throw new TypeError('canonical Foundation agreement checkpoint is not at an agreement lifecycle');
  }
  if (!Number.isSafeInteger(input.ownerReconciliationEvaluatedAtMs)
    || input.ownerReconciliationEvaluatedAtMs < state.updatedAtMs
    || typeof input.ownerReconciliationProvider?.reconcileExecutionState !== 'function') {
    throw new TypeError('canonical Foundation reconciliation provider and evaluation time are required');
  }
  const reconciliation = validateReconciliation(
    input.ownerReconciliationProvider.reconcileExecutionState(
      state,
      input.ownerReconciliationEvaluatedAtMs,
    ),
    state,
    input.ownerReconciliationEvaluatedAtMs,
  );
  if (!Array.isArray(input.observations) || input.observations.length > 12) {
    throw new TypeError('normal-Basis observations exceed the closed bound');
  }
  const observationIdentities = new Set<string>();
  const observations = input.observations.map((candidate) => {
    const observation = validateNormalBasisTwinLegObservation(
      candidate,
      binding,
      input.ownerCheckpointHydrator,
    );
    if (observation.schema !== NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA
      || observation.foundationBindingRevision !== binding.foundationBindingRevision) {
      throw new TypeError('normal-Basis observation belongs to a different owner binding');
    }
    const phase = observation.stage.startsWith('ENTRY_') ? 'OPEN' : 'CLOSE';
    const key = observation.product === 'SPOT' ? 'SPOT' : 'PERP';
    const identity = `${phase}:${key}`;
    const finalLeg = stateLeg(state, phase, key);
    const observationCheckpoint = hydrateNormalBasisOwnerCheckpoint(
      binding,
      observation.ownerCheckpoint,
      input.ownerCheckpointHydrator,
    );
    if (observation.deterministicClientOrderId !== finalLeg.definition.clientOrderId
      || observationCheckpoint.state.lastSequence > state.lastSequence
      || canonicalJson(observationCheckpoint.state.eventLog)
        !== canonicalJson(state.eventLog.slice(0, observationCheckpoint.state.lastSequence))
      || compareTwinDecimals(
        observation.confirmedFilledQuantity,
        ownerQuantity(finalLeg.cumulativeFilledQuantity, 'final owner leg fill'),
      ) > 0) {
      throw new TypeError('normal-Basis observation is not an ancestor of final checkpoint truth');
    }
    observationIdentities.add(identity);
    return observation;
  });
  const uniqueFields = [
    observations.map((value) => value.deterministicClientOrderId),
    observations.map((value) => value.l06MutationId),
    observations.map((value) => value.observationRevision),
    observations.map((value) => String(value.mutationLineage.requestSequence)),
    observations.map((value) => value.mutationLineage.requestId),
    observations.map((value) => value.mutationLineage.intentFingerprint),
    observations.map((value) => value.mutationLineage.sanitizedRequestContentHash),
  ];
  if (uniqueFields.some((values) => new Set(values).size !== values.length)) {
    throw new TypeError('normal-Basis agreement requires unique mutation identity per owner order');
  }
  const requiredObservationIdentities: string[] = [];
  for (const phase of ['OPEN', 'CLOSE'] as const) {
    for (const key of ['SPOT', 'PERP'] as const) {
      if (stateLeg(state, phase, key).submittedQuantity > 0) {
        requiredObservationIdentities.push(`${phase}:${key}`);
      }
    }
  }
  if (observations.length !== requiredObservationIdentities.length
    || observationIdentities.size !== requiredObservationIdentities.length
    || requiredObservationIdentities.some((identity) => !observationIdentities.has(identity))) {
    throw new TypeError('normal-Basis agreement requires one observation for every submitted owner leg');
  }

  const quantities = ownerQuantities(state);
  const residualSpotQuantity = subtractTwinDecimals(
    quantities.openingSpotQuantity,
    quantities.closingSpotQuantity,
  );
  const residualPerpQuantity = subtractTwinDecimals(
    quantities.openingPerpQuantity,
    quantities.closingPerpQuantity,
  );
  const spotFeeCut = (
    phase: 'OPEN' | 'CLOSE',
    grossQuantity: string,
  ): Readonly<{
    commissionQuantity: string;
    adjustedQuantity: string;
  }> | null => {
    if (grossQuantity === '0') {
      return Object.freeze({ commissionQuantity: '0', adjustedQuantity: '0' });
    }
    const observation = observations.find((candidate) => (
      candidate.product === 'SPOT'
        && (phase === 'OPEN'
          ? candidate.stage === 'ENTRY_SPOT'
          : candidate.stage === 'EXIT_SPOT' || candidate.stage === 'RECOVERY_CLOSE_SPOT')
    ));
    if (observation === undefined
      || observation.confirmedFilledQuantity !== grossQuantity
      || observation.baseAssetCommissionQuantity === null
      || observation.feeAdjustedConfirmedQuantity === null) return null;
    return Object.freeze({
      commissionQuantity: observation.baseAssetCommissionQuantity,
      adjustedQuantity: observation.feeAdjustedConfirmedQuantity,
    });
  };
  const openingSpotFeeCut = spotFeeCut('OPEN', quantities.openingSpotQuantity);
  const closingSpotFeeCut = spotFeeCut('CLOSE', quantities.closingSpotQuantity);
  const feeTruthAvailable = openingSpotFeeCut !== null && closingSpotFeeCut !== null;
  const openingSpotBaseAssetCommissionQuantity = openingSpotFeeCut?.commissionQuantity ?? null;
  const closingSpotBaseAssetCommissionQuantity = closingSpotFeeCut?.commissionQuantity ?? null;
  const feeAdjustedSpotBaseQuantity = feeTruthAvailable
    ? signedTwinResidual(
      openingSpotFeeCut.adjustedQuantity,
      closingSpotFeeCut.adjustedQuantity,
    )
    : null;
  const netBaseQuantity = !feeTruthAvailable
    ? null
    : compareTwinDecimals(
      openingSpotFeeCut.adjustedQuantity,
      closingSpotFeeCut.adjustedQuantity,
    ) >= 0
      ? signedTwinResidual(
        subtractTwinDecimals(
          openingSpotFeeCut.adjustedQuantity,
          closingSpotFeeCut.adjustedQuantity,
        ),
        residualPerpQuantity,
      )
      : signedTwinResidual(
        '0',
        addTwinDecimals(
          subtractTwinDecimals(
            closingSpotFeeCut.adjustedQuantity,
            openingSpotFeeCut.adjustedQuantity,
          ),
          residualPerpQuantity,
        ),
      );
  const unhedgedBaseQuantity = netBaseQuantity === null
    ? null : netBaseQuantity.startsWith('-') ? netBaseQuantity.slice(1) : netBaseQuantity;
  const allLegs = [
    ...Object.values(state.openingLegs),
    ...Object.values(state.closingLegs),
  ];
  const ambiguityVisible = allLegs.some((leg) => leg.lifecycle === 'AMBIGUOUS')
    || observations.some((observation) => observation.ambiguityVisible);
  const workingRemainderVisible = allLegs.some((leg) => (
    leg.lifecycle === 'ACKNOWLEDGED'
      || leg.lifecycle === 'PARTIALLY_FILLED'
      || leg.lifecycle === 'CANCEL_PENDING'
  ));
  const recommendations = recoveryLineage(
    input,
    state,
    checkpoint.checksum,
    reconciliation.evidenceRevision,
    reconciliation.result.evaluatedAtMs,
  );
  const meaningfulRecommendation = recommendations.some((value) => value.action !== 'NO_ACTION');
  const manualReviewRecommendation = recommendations.some((value) => value.action === 'MANUAL_REVIEW');
  const openedAny = quantities.openingSpotQuantity !== '0'
    || quantities.openingPerpQuantity !== '0';
  const imbalanced = netBaseQuantity === null || netBaseQuantity !== '0';
  const reasons: string[] = [];
  const canonicalOutcome = state.lifecycle as NormalBasisCanonicalOutcome;
  if (reconciliation.blocking) reasons.push('OWNER_RECONCILIATION_BLOCKED');
  if (!feeTruthAvailable) reasons.push('SPOT_FEE_TRUTH_UNAVAILABLE');
  if (canonicalOutcome === 'CLOSED'
    && (feeAdjustedSpotBaseQuantity !== '0' || residualPerpQuantity !== '0'
      || ambiguityVisible || workingRemainderVisible || !openedAny)) {
    reasons.push('OWNER_CLOSED_WITH_UNRESOLVED_TRUTH');
  }
  if (canonicalOutcome === 'HEDGED_OPEN'
    && (feeAdjustedSpotBaseQuantity === null || feeAdjustedSpotBaseQuantity === '0'
      || feeAdjustedSpotBaseQuantity.startsWith('-') || imbalanced
      || ambiguityVisible || workingRemainderVisible)) {
    reasons.push('OWNER_HEDGED_OPEN_WITH_UNRESOLVED_TRUTH');
  }
  if (ambiguityVisible && canonicalOutcome !== 'RECOVERY_REQUIRED') {
    reasons.push('OWNER_AMBIGUITY_NOT_RECOVERY_REQUIRED');
  }
  if (canonicalOutcome === 'ONE_LEG_EXPOSED'
    && (!openedAny || (!imbalanced && !workingRemainderVisible) || ambiguityVisible)) {
    reasons.push('OWNER_ONE_LEG_EXPOSED_WITHOUT_EXPOSURE');
  }
  if (canonicalOutcome === 'FAILED'
    && (feeAdjustedSpotBaseQuantity !== '0' || residualPerpQuantity !== '0'
      || ambiguityVisible || workingRemainderVisible)) {
    reasons.push('OWNER_FAILED_WITH_UNRESOLVED_TRUTH');
  }
  if ((canonicalOutcome === 'ONE_LEG_EXPOSED' || canonicalOutcome === 'RECOVERY_REQUIRED')
    && !meaningfulRecommendation) {
    reasons.push('OWNER_RECOVERY_RECOMMENDATION_MISSING');
  }
  if (canonicalOutcome === 'RECOVERY_REQUIRED' && !manualReviewRecommendation) {
    reasons.push('OWNER_MANUAL_REVIEW_NOT_RETAINED');
  }
  const orderedReasons = Object.freeze([...new Set(reasons)].sort());
  const manualActionRequired = orderedReasons.length === 0
    && (reconciliation.manual
      || canonicalOutcome === 'ONE_LEG_EXPOSED'
      || canonicalOutcome === 'RECOVERY_REQUIRED');
  const material = {
    foundationBindingRevision: binding.foundationBindingRevision,
    ownerCheckpointChecksum: checkpoint.checksum,
    ownerCheckpointRevision: checkpoint.checkpointRevision,
    ownerStateRevision: state.stateRevisionId,
    reconciliationEvidenceRevision: reconciliation.evidenceRevision,
    reconciliationStatus: reconciliation.result.status,
    ownerReconciliationEvidence: reconciliation.result,
    canonicalOutcome,
    state: orderedReasons.length > 0
      ? ('BLOCKED' as const)
      : manualActionRequired ? ('MANUAL_ACTION_REQUIRED' as const) : ('PASS' as const),
    reasonCodes: orderedReasons,
    ...quantities,
    residualSpotQuantity,
    residualPerpQuantity,
    openingSpotBaseAssetCommissionQuantity,
    closingSpotBaseAssetCommissionQuantity,
    feeAdjustedSpotBaseQuantity,
    netBaseQuantity,
    unhedgedBaseQuantity,
    ambiguityVisible,
    workingRemainderVisible,
    manualActionRequired,
    ownerRecommendationsRetained: recommendations,
    observationRevisions: Object.freeze(observations.map((value) => value.observationRevision)),
    lifecycleAuthority: 'FOUNDATION_EXECUTION' as const,
    reconciliationAuthority: 'FOUNDATION_RECONCILIATION' as const,
    evidenceAuthority: 'ADAPTER_EVIDENCE_ONLY' as const,
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    sendEligible: false as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  };
  return cloneFreezeNormalBasis({
    schema: NORMAL_BASIS_OWNER_AGREEMENT_SCHEMA,
    ...material,
    agreementRevision: revision('l09agreement_', material),
  });
}
