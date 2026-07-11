import {
  canonicalJson,
  combineReconciliationStatuses,
  defaultRecommendationForStatus,
  isLegLifecycle,
  isPlanLifecycle,
  isValidClientOrderId,
  isValidUtcMillis,
  isVenue,
  type ReconciliationStatus,
  type Venue,
} from '../contracts/index.js';
import type {
  ExecutionLegKey,
  ExecutionLegPhase,
  ExecutionLegState,
  ExecutionPlanState,
} from '../execution/types.js';
import { normalizeObservedEvidence } from './normalize.js';
import type {
  EvidenceKind,
  NormalizationIssue,
  NormalizedEvidenceCollection,
  NormalizedObservedEvidence,
  ObservedEvidenceInput,
  ObservedFillEvidence,
  ObservedOrderEvidence,
  ObservedPositionEvidence,
  ReconciledLeg,
  ReconciliationPolicy,
  ReconciliationReason,
  ReconciliationResult,
  ReconciliationSourceReport,
  VenuePositionComparison,
} from './types.js';

const MAX_SAFE_QUANTITY = Number.MAX_SAFE_INTEGER;
const STATE_EPSILON = 1e-12;
const PRIVATE_EVIDENCE_AUTHORITIES = new Set(['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST']);
const ACTIVE_ORDER_STATUSES = new Set<ObservedOrderEvidence['status']>(['NEW', 'PARTIALLY_FILLED']);

interface SourceAssessment {
  report: ReconciliationSourceReport;
  reasons: readonly ReconciliationReason[];
}

function reason(
  code: string,
  status: ReconciliationStatus,
  detail: string,
  evidenceKind: EvidenceKind | null = null,
  phase: ExecutionLegPhase | null = null,
  legKey: ExecutionLegKey | null = null,
): Readonly<ReconciliationReason> {
  return Object.freeze({ code, status, detail, evidenceKind, phase, legKey });
}

function worst(statuses: readonly ReconciliationStatus[]): ReconciliationStatus {
  return combineReconciliationStatuses(statuses.length === 0 ? ['EXACT'] : statuses);
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function safeAdd(left: number, right: number, context: string): number {
  const result = left + right;
  if (!Number.isFinite(result) || Math.abs(result) > MAX_SAFE_QUANTITY) {
    throw new TypeError(`${context}: quantity aggregate exceeds the safe numeric range`);
  }
  return result;
}

function sumQuantities(values: readonly number[], context: string): number {
  let total = 0;
  for (const value of values) total = safeAdd(total, value, context);
  return total;
}

function approxEqual(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function signedQuantity(side: 'BUY' | 'SELL', quantity: number): number {
  return side === 'BUY' ? quantity : -quantity;
}

function assertPolicy(policy: ReconciliationPolicy): void {
  if (
    typeof policy !== 'object' ||
    policy === null ||
    !Number.isFinite(policy.quantityTolerance) ||
    policy.quantityTolerance < 0 ||
    policy.quantityTolerance > MAX_SAFE_QUANTITY
  ) {
    throw new TypeError('reconciliation policy quantityTolerance must be a non-negative finite safe-range number');
  }
  if (
    !Number.isFinite(policy.normalizedHedgeTolerance) ||
    policy.normalizedHedgeTolerance < 0 ||
    policy.normalizedHedgeTolerance > 1
  ) {
    throw new TypeError('reconciliation policy normalizedHedgeTolerance must be a finite number in [0, 1]');
  }
}

function assertNormalizedRecordHorizons(evidence: NormalizedObservedEvidence): void {
  const checks = [
    {
      kind: 'orders',
      collection: evidence.orders,
      timestamp: (record: Readonly<ObservedOrderEvidence>) => record.updatedAtMs,
    },
    {
      kind: 'fills',
      collection: evidence.fills,
      timestamp: (record: Readonly<ObservedFillEvidence>) => record.occurredAtMs,
    },
    {
      kind: 'positions',
      collection: evidence.positions,
      timestamp: (record: Readonly<ObservedPositionEvidence>) => record.observedAtMs,
    },
  ] as const;
  for (const check of checks) {
    if (!isValidUtcMillis(check.collection.metadata.receivedAtMs)) {
      throw new TypeError(`normalized ${check.kind} receivedAtMs is malformed`);
    }
    const sourceTime = check.collection.metadata.sourceTimeMs;
    if (sourceTime !== null && !isValidUtcMillis(sourceTime)) {
      throw new TypeError(`normalized ${check.kind} sourceTimeMs is malformed`);
    }
    const sourceHorizon = sourceTime ?? check.collection.metadata.receivedAtMs;
    for (const record of check.collection.records ?? []) {
      // The union is intentionally narrowed by the matching collection and
      // timestamp function above; this cast only bridges TypeScript's tuple
      // union call limitation and does not transform the record.
      const timestamp = (check.timestamp as (value: never) => number)(record as never);
      if (!isValidUtcMillis(timestamp) || timestamp > sourceHorizon || timestamp > evidence.evaluatedAtMs) {
        throw new TypeError(`normalized ${check.kind} record timestamp exceeds source/evaluation horizon`);
      }
    }
  }
}

function assertLegState(
  leg: unknown,
  phase: ExecutionLegPhase,
  key: ExecutionLegKey,
): asserts leg is ExecutionLegState {
  if (typeof leg !== 'object' || leg === null || Array.isArray(leg)) {
    throw new TypeError(`checkpoint ${phase}.${key} leg must be an object`);
  }
  const candidate = leg as Partial<ExecutionLegState>;
  const definition = candidate.definition;
  const expectedVenue = key === 'SPOT' ? 'BINANCE_SPOT' : 'BINANCE_USDM';
  const expectedRole = `${key}_${phase}`;
  const expectedRiskEffect = phase === 'OPEN' ? 'RISK_INCREASING' : 'RISK_REDUCING';
  const expectedReduceOnly = phase === 'CLOSE' && key === 'PERP';
  if (
    typeof definition !== 'object' ||
    definition === null ||
    definition.phase !== phase ||
    definition.key !== key ||
    !isVenue(definition.venue) ||
    definition.venue !== expectedVenue ||
    definition.role !== expectedRole ||
    definition.riskEffect !== expectedRiskEffect ||
    definition.reduceOnly !== expectedReduceOnly ||
    (definition.side !== 'BUY' && definition.side !== 'SELL')
  ) {
    throw new TypeError(`checkpoint ${phase}.${key} leg definition is malformed`);
  }
  if (
    typeof definition.quantity !== 'number' ||
    !Number.isFinite(definition.quantity) ||
    definition.quantity <= 0 ||
    definition.quantity > MAX_SAFE_QUANTITY ||
    !isValidClientOrderId(definition.clientOrderId)
  ) {
    throw new TypeError(`checkpoint ${phase}.${key} leg quantity/client-order identity is malformed`);
  }
  if (!isLegLifecycle(candidate.lifecycle)) {
    throw new TypeError(`checkpoint ${phase}.${key} leg lifecycle is malformed`);
  }
  if (
    typeof candidate.submittedQuantity !== 'number' ||
    !Number.isFinite(candidate.submittedQuantity) ||
    candidate.submittedQuantity < 0 ||
    candidate.submittedQuantity > definition.quantity ||
    typeof candidate.cumulativeFilledQuantity !== 'number' ||
    !Number.isFinite(candidate.cumulativeFilledQuantity) ||
    candidate.cumulativeFilledQuantity < 0 ||
    candidate.cumulativeFilledQuantity > candidate.submittedQuantity ||
    candidate.cumulativeFilledQuantity > MAX_SAFE_QUANTITY
  ) {
    throw new TypeError(`checkpoint ${phase}.${key} leg quantities are malformed`);
  }
  if (
    candidate.venueOrderId !== null &&
    (typeof candidate.venueOrderId !== 'string' || candidate.venueOrderId.trim().length === 0)
  ) {
    throw new TypeError(`checkpoint ${phase}.${key} venueOrderId must be string|null`);
  }
}

function assertExecutionState(state: ExecutionPlanState): void {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new TypeError('reconciliation checkpoint state must be an object');
  }
  if (
    typeof state.plan !== 'object' ||
    state.plan === null ||
    typeof state.plan.planId !== 'string' ||
    !state.plan.planId.startsWith('plan_') ||
    typeof state.plan.correlationId !== 'string' ||
    state.plan.correlationId.length === 0 ||
    typeof state.plan.symbol !== 'string' ||
    state.plan.symbol.trim().length === 0 ||
    !isPlanLifecycle(state.lifecycle) ||
    !isValidUtcMillis(state.createdAtMs) ||
    !isValidUtcMillis(state.updatedAtMs) ||
    state.updatedAtMs < state.createdAtMs
  ) {
    throw new TypeError('reconciliation checkpoint identity/lifecycle/time is malformed');
  }
  const clientOrderIds: string[] = [];
  for (const phase of ['OPEN', 'CLOSE'] as const) {
    const record = phase === 'OPEN' ? state.openingLegs : state.closingLegs;
    const planRecord = phase === 'OPEN' ? state.plan.openingLegs : state.plan.closingLegs;
    if (typeof record !== 'object' || record === null) throw new TypeError(`checkpoint ${phase} legs are missing`);
    if (typeof planRecord !== 'object' || planRecord === null) throw new TypeError(`plan ${phase} leg definitions are missing`);
    for (const key of ['SPOT', 'PERP'] as const) {
      assertLegState(record[key], phase, key);
      if (canonicalJson(record[key].definition) !== canonicalJson(planRecord[key])) {
        throw new TypeError(`checkpoint ${phase}.${key} leg definition diverges from frozen plan definition`);
      }
      clientOrderIds.push(record[key].definition.clientOrderId);
    }
  }
  if (new Set(clientOrderIds).size !== clientOrderIds.length) {
    throw new TypeError('checkpoint reuses a client-order ID across semantic legs');
  }
  for (const key of ['SPOT', 'PERP'] as const) {
    if (
      state.openingLegs[key].definition.side === state.closingLegs[key].definition.side ||
      state.openingLegs[key].definition.quantity !== state.closingLegs[key].definition.quantity
    ) {
      throw new TypeError(`checkpoint ${key} close definition does not reverse its opening leg`);
    }
  }
  if (state.lifecycle === 'CLOSED') {
    const active = new Set(['SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_PENDING', 'AMBIGUOUS']);
    for (const key of ['SPOT', 'PERP'] as const) {
      const residual = safeAdd(
        signedQuantity(state.openingLegs[key].definition.side, state.openingLegs[key].cumulativeFilledQuantity),
        signedQuantity(state.closingLegs[key].definition.side, state.closingLegs[key].cumulativeFilledQuantity),
        `CLOSED checkpoint ${key} exposure`,
      );
      if (Math.abs(residual) > STATE_EPSILON) {
        throw new TypeError(`CLOSED checkpoint retains ${key} exposure`);
      }
      if (active.has(state.openingLegs[key].lifecycle) || active.has(state.closingLegs[key].lifecycle)) {
        throw new TypeError(`CLOSED checkpoint retains an active ${key} leg`);
      }
    }
  }
}

function assessSource<T>(
  kind: EvidenceKind,
  collection: NormalizedEvidenceCollection<T>,
  state: ExecutionPlanState,
  historyRequired: boolean,
): SourceAssessment {
  const statuses: ReconciliationStatus[] = [];
  const reasons: ReconciliationReason[] = [];
  const add = (code: string, status: ReconciliationStatus, detail: string): void => {
    statuses.push(status);
    reasons.push(reason(code, status, detail, kind));
  };
  const label = kind.toLowerCase();

  if (
    collection.metadata.authority === 'UNAVAILABLE' ||
    collection.metadata.completeness === 'UNAVAILABLE' ||
    collection.records === null
  ) {
    add(`${kind}_SOURCE_UNAVAILABLE`, 'UNAVAILABLE', `${label} private evidence source is unavailable`);
  } else if (!PRIVATE_EVIDENCE_AUTHORITIES.has(collection.metadata.authority)) {
    add(`${kind}_PRIVATE_AUTHORITY_REQUIRED`, 'UNAVAILABLE', `${label} evidence is not private/replay/test authority`);
  }

  if (collection.freshness === 'STALE') {
    add(`${kind}_SOURCE_STALE`, 'STALE', `${label} evidence is older than its declared maximum age`);
  } else if (collection.freshness === 'CLOCK_SKEWED') {
    add(`${kind}_SOURCE_CLOCK_SKEWED`, 'STALE', `${label} evidence is ahead of the injected evaluation clock`);
  }

  if (collection.metadata.completeness === 'PARTIAL') {
    add(
      historyRequired ? `${kind}_HISTORY_INCOMPLETE` : `${kind}_SNAPSHOT_INCOMPLETE`,
      'UNAVAILABLE',
      `${label} evidence is explicitly partial`,
    );
  }

  if (historyRequired && collection.metadata.completeness !== 'UNAVAILABLE') {
    const start = collection.metadata.coverageStartMs;
    const end = collection.metadata.coverageEndMs;
    const snapshotHorizon = collection.metadata.sourceTimeMs ?? collection.metadata.receivedAtMs;
    if (start === null || end === null || start > state.createdAtMs || end < snapshotHorizon) {
      add(
        `${kind}_HISTORY_WINDOW_INCOMPLETE`,
        'UNAVAILABLE',
        `${label} history does not cover checkpoint creation through the evidence snapshot horizon`,
      );
    }
  }

  const status = worst(statuses);
  return {
    report: Object.freeze({
      sourceId: collection.metadata.sourceId,
      sourceTimeMs: collection.metadata.sourceTimeMs,
      receivedAtMs: collection.metadata.receivedAtMs,
      maxAgeMs: collection.metadata.maxAgeMs,
      freshness: collection.freshness,
      authority: collection.metadata.authority,
      completeness: collection.metadata.completeness,
      coverageStartMs: collection.metadata.coverageStartMs,
      coverageEndMs: collection.metadata.coverageEndMs,
      status,
      reasonCodes: unique(reasons.map((item) => item.code)),
    }),
    reasons: Object.freeze(reasons),
  };
}

function issueTouchesPlan(
  issue: NormalizationIssue,
  state: ExecutionPlanState,
  clientOrderIds: ReadonlySet<string>,
  venueOrderIds: ReadonlySet<string>,
): boolean {
  if (issue.clientOrderIds.some((value) => clientOrderIds.has(value))) return true;
  if (issue.venueOrderIds.some((value) => venueOrderIds.has(value))) return true;
  return issue.evidenceKind === 'POSITIONS' &&
    issue.symbols.includes(state.plan.symbol) &&
    issue.venues.some((venue) => venue === 'BINANCE_SPOT' || venue === 'BINANCE_USDM');
}

function orderStatusConsistencyReason(
  order: Readonly<ObservedOrderEvidence>,
  tolerance: number,
  phase: ExecutionLegPhase,
  key: ExecutionLegKey,
): ReconciliationReason | null {
  if (order.status === 'UNKNOWN') {
    return reason('ORDER_STATUS_UNKNOWN', 'AMBIGUOUS', 'venue order status is explicitly unknown', 'ORDERS', phase, key);
  }
  if (order.status === 'FILLED' && !approxEqual(order.cumulativeFilledQuantity, order.originalQuantity, tolerance)) {
    return reason('ORDER_STATUS_QUANTITY_DISAGREEMENT', 'DIVERGED', 'FILLED order quantity is not its original quantity', 'ORDERS', phase, key);
  }
  if (
    order.status === 'PARTIALLY_FILLED' &&
    (order.cumulativeFilledQuantity <= tolerance || order.cumulativeFilledQuantity >= order.originalQuantity - tolerance)
  ) {
    return reason('ORDER_STATUS_QUANTITY_DISAGREEMENT', 'DIVERGED', 'PARTIALLY_FILLED order has a non-partial quantity', 'ORDERS', phase, key);
  }
  if (order.status === 'NEW' && order.cumulativeFilledQuantity > tolerance) {
    return reason('ORDER_STATUS_QUANTITY_DISAGREEMENT', 'DIVERGED', 'NEW order reports a positive cumulative fill', 'ORDERS', phase, key);
  }
  if (order.status === 'REJECTED' && order.cumulativeFilledQuantity > tolerance) {
    return reason('ORDER_STATUS_QUANTITY_DISAGREEMENT', 'DIVERGED', 'REJECTED order reports a positive cumulative fill', 'ORDERS', phase, key);
  }
  return null;
}

function reconcileLeg(
  phase: ExecutionLegPhase,
  key: ExecutionLegKey,
  leg: ExecutionLegState,
  state: ExecutionPlanState,
  evidence: NormalizedObservedEvidence,
  sources: { orders: SourceAssessment; fills: SourceAssessment },
  relevantIssues: readonly NormalizationIssue[],
  policy: ReconciliationPolicy,
): Readonly<ReconciledLeg> {
  const localReasons: ReconciliationReason[] = [];
  const add = (code: string, status: ReconciliationStatus, detail: string, kind: EvidenceKind | null): void => {
    localReasons.push(reason(code, status, detail, kind, phase, key));
  };
  const definition = leg.definition;
  const expectedClientOrderId = definition.clientOrderId;
  const orderSourceComplete = sources.orders.report.status === 'EXACT';
  const fillSourceComplete = sources.fills.report.status === 'EXACT';
  const orders = orderSourceComplete ? (evidence.orders.records ?? []) : [];
  const scopedCheckpointOrderId = leg.venueOrderId;
  const matchingOrders = orders.filter((order) =>
    order.clientOrderId === expectedClientOrderId ||
    (
      scopedCheckpointOrderId !== null &&
      order.venue === definition.venue &&
      order.symbol === state.plan.symbol &&
      order.venueOrderId === scopedCheckpointOrderId
    )
  );

  if (matchingOrders.length > 1) {
    add('MULTIPLE_MATCHING_ORDERS', 'AMBIGUOUS', 'multiple order records match one intended leg identity', 'ORDERS');
  }
  const order = matchingOrders.length === 1 ? matchingOrders[0] : null;
  const candidateVenueOrderIds = new Set<string>();
  if (scopedCheckpointOrderId !== null) candidateVenueOrderIds.add(scopedCheckpointOrderId);
  for (const candidate of matchingOrders) candidateVenueOrderIds.add(candidate.venueOrderId);

  const fills = fillSourceComplete ? (evidence.fills.records ?? []) : [];
  const fillIdentityConflict = relevantIssues.some((issue) =>
    issue.code === 'CONFLICTING_FILL_IDENTITY' &&
    (
      issue.clientOrderIds.includes(expectedClientOrderId) ||
      issue.venueOrderIds.some((value) => candidateVenueOrderIds.has(value))
    )
  );
  const matchingFills = fills.filter((fill) =>
    !relevantIssues.some((issue) =>
      issue.code === 'CONFLICTING_FILL_IDENTITY' &&
      issue.identity === `${fill.venue}|${fill.symbol}|${fill.tradeId}`
    ) &&
    (
      fill.clientOrderId === expectedClientOrderId ||
      (
        fill.venue === definition.venue &&
        fill.symbol === state.plan.symbol &&
        candidateVenueOrderIds.has(fill.venueOrderId)
      )
    )
  );

  if (relevantIssues.some((issue) =>
    issue.clientOrderIds.includes(expectedClientOrderId) ||
    issue.venueOrderIds.some((value) => candidateVenueOrderIds.has(value))
  )) {
    add('EVIDENCE_IDENTITY_CONFLICT', 'AMBIGUOUS', 'normalized evidence contains a conflicting identity for this leg', null);
  }

  if (order !== null) {
    if (order.venue !== definition.venue) add('ORDER_VENUE_MISMATCH', 'DIVERGED', 'order venue differs from intended leg', 'ORDERS');
    if (order.symbol !== state.plan.symbol) add('ORDER_SYMBOL_MISMATCH', 'DIVERGED', 'order symbol differs from intended plan', 'ORDERS');
    if (order.side !== definition.side) add('ORDER_SIDE_MISMATCH', 'DIVERGED', 'order side differs from intended leg', 'ORDERS');
    if (!approxEqual(order.originalQuantity, leg.submittedQuantity, policy.quantityTolerance)) {
      add('ORDER_ORIGINAL_QUANTITY_MISMATCH', 'DIVERGED', 'order original quantity differs from submitted checkpoint quantity', 'ORDERS');
    }
    if (order.reduceOnly !== null && order.reduceOnly !== definition.reduceOnly) {
      add('ORDER_REDUCE_ONLY_MISMATCH', 'DIVERGED', 'order reduce-only posture differs from intended leg', 'ORDERS');
    }
    if (leg.venueOrderId !== null && order.venueOrderId !== leg.venueOrderId) {
      add('VENUE_ORDER_ID_MISMATCH', 'DIVERGED', 'observed venue order ID differs from checkpoint', 'ORDERS');
    }
    const consistency = orderStatusConsistencyReason(order, policy.quantityTolerance, phase, key);
    if (consistency !== null) localReasons.push(consistency);
  }

  for (const fill of matchingFills) {
    if (fill.venue !== definition.venue) add('FILL_VENUE_MISMATCH', 'DIVERGED', 'fill venue differs from intended leg', 'FILLS');
    if (fill.symbol !== state.plan.symbol) add('FILL_SYMBOL_MISMATCH', 'DIVERGED', 'fill symbol differs from intended plan', 'FILLS');
    if (fill.side !== definition.side) add('FILL_SIDE_MISMATCH', 'DIVERGED', 'fill side differs from intended leg', 'FILLS');
  }

  const legFillHistoryComplete = fillSourceComplete && !fillIdentityConflict;
  const tradeQuantity = matchingFills.length > 0
    ? sumQuantities(matchingFills.map((fill) => fill.quantity), `${phase}.${key} fills`)
    : legFillHistoryComplete ? 0 : null;
  const orderQuantity = order?.cumulativeFilledQuantity ?? null;

  if (
    orderQuantity !== null &&
    legFillHistoryComplete &&
    tradeQuantity !== null &&
    !approxEqual(orderQuantity, tradeQuantity, policy.quantityTolerance)
  ) {
    add('ORDER_FILL_QUANTITY_DISAGREEMENT', 'DIVERGED', 'order cumulative quantity disagrees with complete deduplicated fill history', 'FILLS');
  }

  let observedQuantity: number | null = null;
  if (legFillHistoryComplete && tradeQuantity !== null && matchingFills.length > 0) observedQuantity = tradeQuantity;
  else if (orderQuantity !== null && orderSourceComplete) observedQuantity = orderQuantity;
  else if (tradeQuantity !== null && orderSourceComplete) observedQuantity = tradeQuantity;

  if (observedQuantity !== null && observedQuantity > leg.submittedQuantity + policy.quantityTolerance) {
    add('OBSERVED_FILL_EXCEEDS_SUBMISSION', 'DIVERGED', 'observed fill exceeds the submitted checkpoint quantity', 'FILLS');
  }

  const responseMayBeUnknown = leg.lifecycle === 'SUBMITTING' || leg.lifecycle === 'AMBIGUOUS';
  if (
    observedQuantity !== null &&
    !responseMayBeUnknown &&
    !approxEqual(observedQuantity, leg.cumulativeFilledQuantity, policy.quantityTolerance)
  ) {
    add('CHECKPOINT_FILL_DISAGREEMENT', 'DIVERGED', 'observed fill differs from checkpoint cumulative fill', 'FILLS');
  }

  const hasAnyVenueEvidence = order !== null || matchingFills.length > 0;
  if (!hasAnyVenueEvidence && leg.submittedQuantity > 0 && orderSourceComplete && legFillHistoryComplete) {
    if (leg.lifecycle === 'REJECTED' && leg.cumulativeFilledQuantity === 0 && orderSourceComplete && fillSourceComplete) {
      // A local/pre-venue rejection is consistent with authoritative absence.
    } else {
      add('MISSING_ORDER_RESPONSE', 'AMBIGUOUS', 'submitted leg has no matching order or fill evidence', 'ORDERS');
    }
  }

  if ((leg.lifecycle === 'PLANNED' || leg.lifecycle === 'VALIDATED') && hasAnyVenueEvidence) {
    add('UNEXPECTED_ORDER_FOR_UNSUBMITTED_LEG', 'DIVERGED', 'venue evidence exists for a checkpoint leg that was not submitted', 'ORDERS');
  }

  if (order !== null) {
    const status = order.status;
    if (leg.lifecycle === 'FILLED' && status !== 'FILLED') {
      add('ORDER_LIFECYCLE_DISAGREEMENT', 'DIVERGED', 'checkpoint FILLED lifecycle disagrees with venue order status', 'ORDERS');
    } else if (leg.lifecycle === 'CANCELLED' && status !== 'CANCELED' && status !== 'EXPIRED') {
      add('ORDER_LIFECYCLE_DISAGREEMENT', 'DIVERGED', 'checkpoint CANCELLED lifecycle disagrees with venue order status', 'ORDERS');
    } else if (leg.lifecycle === 'REJECTED' && status !== 'REJECTED') {
      add('ORDER_LIFECYCLE_DISAGREEMENT', 'DIVERGED', 'checkpoint REJECTED lifecycle disagrees with venue order status', 'ORDERS');
    } else if (leg.lifecycle === 'ACKNOWLEDGED' && status !== 'NEW') {
      add('ORDER_LIFECYCLE_DISAGREEMENT', 'DIVERGED', 'checkpoint ACKNOWLEDGED lifecycle is not a working venue order', 'ORDERS');
    }
  }

  const hardStatus = worst(localReasons.map((item) => item.status));
  let status = hardStatus;
  if (hardStatus === 'EXACT') {
    if (
      order !== null && ACTIVE_ORDER_STATUSES.has(order.status)
    ) {
      if (observedQuantity !== null && observedQuantity > policy.quantityTolerance) {
        status = observedQuantity < leg.submittedQuantity - policy.quantityTolerance ? 'PARTIAL' : 'EXACT';
      } else {
        status = 'PENDING';
      }
    } else if (
      observedQuantity !== null &&
      observedQuantity > policy.quantityTolerance &&
      observedQuantity < leg.submittedQuantity - policy.quantityTolerance
    ) {
      status = 'PARTIAL';
    }
  }
  if (status === 'PARTIAL') {
    localReasons.push(reason('PARTIAL_FILL_CONFIRMED', 'PARTIAL', 'deduplicated venue evidence confirms a partial fill', 'FILLS', phase, key));
  } else if (status === 'PENDING') {
    localReasons.push(reason('WORKING_ORDER_PENDING', 'PENDING', 'venue evidence confirms a still-working or submitting order', 'ORDERS', phase, key));
  }

  const remainder = observedQuantity === null
    ? null
    : Math.max(0, leg.submittedQuantity - observedQuantity);
  return Object.freeze({
    phase,
    legKey: key,
    clientOrderId: definition.clientOrderId,
    venueOrderId: order?.venueOrderId ?? leg.venueOrderId,
    expectedLifecycle: leg.lifecycle,
    expectedSubmittedQuantity: leg.submittedQuantity,
    expectedFilledQuantity: leg.cumulativeFilledQuantity,
    observedOrderStatus: order?.status ?? null,
    observedOrderFilledQuantity: orderQuantity,
    observedTradeFilledQuantity: tradeQuantity,
    observedFilledQuantity: observedQuantity,
    observedRemainderQuantity: remainder,
    status,
    reasonCodes: unique(localReasons.map((item) => item.code)),
  });
}

function expectedPositionDelta(state: ExecutionPlanState, venue: Venue): number {
  const key: ExecutionLegKey = venue === 'BINANCE_SPOT' ? 'SPOT' : 'PERP';
  const open = state.openingLegs[key];
  const close = state.closingLegs[key];
  return safeAdd(
    signedQuantity(open.definition.side, open.cumulativeFilledQuantity),
    signedQuantity(close.definition.side, close.cumulativeFilledQuantity),
    `${venue} expected position`,
  );
}

function reconcilePosition(
  venue: Venue,
  state: ExecutionPlanState,
  evidence: NormalizedObservedEvidence,
  source: SourceAssessment,
  relevantIssues: readonly NormalizationIssue[],
  policy: ReconciliationPolicy,
): { comparison: Readonly<VenuePositionComparison>; reasons: readonly ReconciliationReason[] } {
  const reasons: ReconciliationReason[] = [];
  const key: ExecutionLegKey = venue === 'BINANCE_SPOT' ? 'SPOT' : 'PERP';
  const expected = expectedPositionDelta(state, venue);
  const sourceComplete = source.report.status === 'EXACT';
  const matching = (sourceComplete ? (evidence.positions.records ?? []) : []).filter(
    (position) => position.venue === venue && position.symbol === state.plan.symbol,
  );
  let observed: number | null = null;

  const identityConflict = relevantIssues.some((issue) =>
    issue.evidenceKind === 'POSITIONS' && issue.venues.includes(venue) && issue.symbols.includes(state.plan.symbol)
  );
  if (identityConflict) {
    reasons.push(reason(
      'POSITION_IDENTITY_CONFLICT',
      'AMBIGUOUS',
      'position snapshot contains conflicting records for this venue/symbol',
      'POSITIONS',
      null,
      key,
    ));
  }

  if (!sourceComplete) {
    // Non-authoritative position records are deliberately ignored. The
    // source assessment carries the named STALE/UNAVAILABLE result.
  } else if (identityConflict) {
    // A canonically selected winner from a conflicting identity is not a
    // usable quantity and must not produce a stronger divergence verdict.
  } else if (matching.length === 0) {
    reasons.push(reason(
      'POSITION_EVIDENCE_MISSING',
      'UNAVAILABLE',
      'no position record exists; absence is not treated as zero',
      'POSITIONS',
      null,
      key,
    ));
  } else if (matching.some((position) => position.baselineQuantity === null)) {
    reasons.push(reason(
      'POSITION_BASELINE_UNKNOWN',
      'UNAVAILABLE',
      'position baseline is unknown; plan-attributed delta cannot be fabricated',
      'POSITIONS',
      null,
      key,
    ));
  } else {
    const deltas = matching.map((position) =>
      safeAdd(position.quantity, -(position.baselineQuantity as number), `${venue} observed position delta`)
    );
    observed = sumQuantities(deltas, `${venue} observed position`);
    if (matching.some((position) => position.positionSide === 'BOTH') && matching.length > 1) {
      reasons.push(reason(
        'POSITION_MODE_AMBIGUOUS',
        'AMBIGUOUS',
        'one-way BOTH and additional position-side records coexist',
        'POSITIONS',
        null,
        key,
      ));
    }
    if (deltas.some((delta) =>
      Math.abs(delta) > policy.quantityTolerance &&
      (Math.abs(expected) <= policy.quantityTolerance || Math.sign(delta) !== Math.sign(expected))
    )) {
      reasons.push(reason(
        'OPPOSING_POSITION_DELTA',
        'DIVERGED',
        'observed position-side delta opposes or survives beyond the intended plan delta',
        'POSITIONS',
        null,
        key,
      ));
    }
    if (!approxEqual(observed, expected, policy.quantityTolerance)) {
      reasons.push(reason(
        'ORDER_POSITION_DISAGREEMENT',
        'DIVERGED',
        'position delta disagrees with checkpoint fill-derived delta',
        'POSITIONS',
        null,
        key,
      ));
    }
  }

  const statuses = reasons.map((item) => item.status);
  if (source.report.status !== 'EXACT') statuses.push(source.report.status);
  const status = worst(statuses);
  return {
    comparison: Object.freeze({
      venue,
      expectedDeltaQuantity: expected,
      observedDeltaQuantity: observed,
      differenceQuantity: observed === null ? null : observed - expected,
      status,
      reasonCodes: unique(reasons.map((item) => item.code)),
    }),
    reasons: Object.freeze(reasons),
  };
}

function chooseRecommendation(
  status: ReconciliationStatus,
  state: ExecutionPlanState,
  legs: readonly ReconciledLeg[],
  positions: readonly VenuePositionComparison[],
  reasons: readonly ReconciliationReason[],
  policy: ReconciliationPolicy,
): ReconciliationResult['recommendation'] {
  if (status === 'PARTIAL') {
    if (legs.some((leg) =>
      leg.phase === 'OPEN' &&
      leg.observedRemainderQuantity !== null &&
      leg.observedRemainderQuantity > policy.quantityTolerance &&
      leg.observedOrderStatus !== null &&
      ACTIVE_ORDER_STATUSES.has(leg.observedOrderStatus)
    )) return 'CANCEL_REMAINDER';
    if (legs.some((leg) =>
      leg.phase === 'CLOSE' &&
      leg.observedRemainderQuantity !== null &&
      leg.observedRemainderQuantity > policy.quantityTolerance &&
      leg.observedOrderStatus !== null &&
      ACTIVE_ORDER_STATUSES.has(leg.observedOrderStatus)
    )) return 'WAIT';

    const spot = positions.find((position) => position.venue === 'BINANCE_SPOT');
    const perp = positions.find((position) => position.venue === 'BINANCE_USDM');
    if (
      spot !== undefined &&
      perp !== undefined &&
      spot.observedDeltaQuantity !== null &&
      perp.observedDeltaQuantity !== null
    ) {
      const spotRatio = Math.abs(spot.observedDeltaQuantity) / state.openingLegs.SPOT.definition.quantity;
      const perpRatio = Math.abs(perp.observedDeltaQuantity) / state.openingLegs.PERP.definition.quantity;
      if (Math.abs(spotRatio - perpRatio) > policy.normalizedHedgeTolerance) return 'HEDGE_RESIDUAL';
    }
    return 'REFRESH';
  }

  if (status === 'DIVERGED') {
    const closePath = state.lifecycle === 'CLOSE_REQUESTED' ||
      state.lifecycle === 'CLOSING' ||
      state.lifecycle === 'RECONCILING' ||
      state.lifecycle === 'CLOSED';
    if (
      closePath &&
      positions.some((position) =>
        position.observedDeltaQuantity !== null && Math.abs(position.observedDeltaQuantity) > policy.quantityTolerance
      )
    ) return 'CLOSE_POSITION';
    if (reasons.some((item) =>
      item.code === 'ORDER_POSITION_DISAGREEMENT' ||
      item.code === 'OPPOSING_POSITION_DELTA'
    )) return 'HEDGE_RESIDUAL';
    return 'MANUAL_REVIEW';
  }

  if (status === 'UNAVAILABLE') {
    if (reasons.some((item) => item.code.endsWith('_SOURCE_UNAVAILABLE') || item.code.endsWith('_PRIVATE_AUTHORITY_REQUIRED'))) {
      return 'MANUAL_REVIEW';
    }
    return 'REFRESH';
  }
  return defaultRecommendationForStatus(status);
}

/**
 * Compare a restored/current execution checkpoint with already-normalized
 * evidence. Pure data in, frozen data out; recommendations are never run.
 */
export function reconcileNormalizedExecutionState(
  state: ExecutionPlanState,
  evidence: NormalizedObservedEvidence,
  policy: ReconciliationPolicy,
): Readonly<ReconciliationResult> {
  assertExecutionState(state);
  assertPolicy(policy);
  if (!isValidUtcMillis(evidence.evaluatedAtMs)) {
    throw new TypeError('normalized evidence evaluatedAtMs must be valid UTC ms');
  }
  assertNormalizedRecordHorizons(evidence);

  const sourceAssessments = {
    orders: assessSource('ORDERS', evidence.orders, state, true),
    fills: assessSource('FILLS', evidence.fills, state, true),
    positions: assessSource('POSITIONS', evidence.positions, state, false),
  };

  const expectedClientOrderIds = new Set<string>();
  const expectedVenueOrderIds = new Set<string>();
  for (const record of [state.openingLegs, state.closingLegs]) {
    for (const key of ['SPOT', 'PERP'] as const) {
      expectedClientOrderIds.add(record[key].definition.clientOrderId);
      if (record[key].venueOrderId !== null) expectedVenueOrderIds.add(record[key].venueOrderId as string);
    }
  }
  for (const order of sourceAssessments.orders.report.status === 'EXACT' ? (evidence.orders.records ?? []) : []) {
    if (expectedClientOrderIds.has(order.clientOrderId)) expectedVenueOrderIds.add(order.venueOrderId);
  }
  const relevantIssues = evidence.issues.filter((item) =>
    (
      (item.evidenceKind === 'ORDERS' && sourceAssessments.orders.report.status === 'EXACT') ||
      (item.evidenceKind === 'FILLS' && sourceAssessments.fills.report.status === 'EXACT') ||
      (item.evidenceKind === 'POSITIONS' && sourceAssessments.positions.report.status === 'EXACT')
    ) &&
    issueTouchesPlan(item, state, expectedClientOrderIds, expectedVenueOrderIds)
  );

  const allReasons: ReconciliationReason[] = [
    ...sourceAssessments.orders.reasons,
    ...sourceAssessments.fills.reasons,
    ...sourceAssessments.positions.reasons,
  ];
  for (const issue of relevantIssues) {
    allReasons.push(reason(
      issue.code,
      'AMBIGUOUS',
      issue.detail,
      issue.evidenceKind,
    ));
  }

  const legs: ReconciledLeg[] = [];
  for (const phase of ['OPEN', 'CLOSE'] as const) {
    const record = phase === 'OPEN' ? state.openingLegs : state.closingLegs;
    for (const key of ['SPOT', 'PERP'] as const) {
      const reconciled = reconcileLeg(
        phase,
        key,
        record[key],
        state,
        evidence,
        sourceAssessments,
        relevantIssues,
        policy,
      );
      legs.push(reconciled);
      for (const code of reconciled.reasonCodes) {
        if (!allReasons.some((item) => item.code === code && item.phase === phase && item.legKey === key)) {
          const inferredStatus = code === 'PARTIAL_FILL_CONFIRMED'
            ? 'PARTIAL'
            : code === 'WORKING_ORDER_PENDING'
              ? 'PENDING'
              : reconciled.status;
          allReasons.push(reason(code, inferredStatus, `see reconciled ${phase}.${key} evidence`, null, phase, key));
        }
      }
    }
  }

  const positionResults = (['BINANCE_SPOT', 'BINANCE_USDM'] as const).map((venue) =>
    reconcilePosition(venue, state, evidence, sourceAssessments.positions, relevantIssues, policy)
  );
  for (const result of positionResults) allReasons.push(...result.reasons);

  const status = worst([
    sourceAssessments.orders.report.status,
    sourceAssessments.fills.report.status,
    sourceAssessments.positions.report.status,
    ...legs.map((leg) => leg.status),
    ...positionResults.map((result) => result.comparison.status),
    ...relevantIssues.map(() => 'AMBIGUOUS' as const),
  ]);
  const recommendation = chooseRecommendation(
    status,
    state,
    legs,
    positionResults.map((result) => result.comparison),
    allReasons,
    policy,
  );

  return Object.freeze({
    planId: state.plan.planId,
    correlationId: state.plan.correlationId,
    evaluatedAtMs: evidence.evaluatedAtMs,
    status,
    recommendation,
    executionAuthority: 'NONE' as const,
    reasons: Object.freeze(allReasons.map((item) => Object.freeze(item))),
    legs: Object.freeze(legs),
    positions: Object.freeze(positionResults.map((item) => item.comparison)),
    sources: Object.freeze({
      orders: sourceAssessments.orders.report,
      fills: sourceAssessments.fills.report,
      positions: sourceAssessments.positions.report,
    }),
    normalization: evidence.stats,
  });
}

/** Normalize and reconcile in one call using an explicit injected `nowMs`. */
export function reconcileExecutionState(
  state: ExecutionPlanState,
  input: ObservedEvidenceInput,
  nowMs: number,
  policy: ReconciliationPolicy,
): Readonly<ReconciliationResult> {
  if (!isValidUtcMillis(nowMs)) throw new TypeError('reconcileExecutionState: nowMs must be valid UTC ms');
  return reconcileNormalizedExecutionState(state, normalizeObservedEvidence(input, nowMs), policy);
}
