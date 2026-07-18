#!/usr/bin/env node
/**
 * Lane E deterministic reconciliation proof.
 * ZERO network, timers, environment reads, or wall-clock reads.
 * Run after `npm run build -w server`:
 *   node server/test/foundation/reconciliation/reconciliation.mjs
 */
import assert from 'node:assert/strict';
import {
  normalizeObservedEvidence,
  reconcileExecutionState,
} from '../../../dist/foundation/reconciliation/index.js';
import {
  createExecutionCoordinator,
  restoreExecutionCheckpoint,
  serializeExecutionCheckpoint,
} from '../../../dist/foundation/execution/index.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n${title}`); }

const T0 = 1_800_000_000_000;
const POLICY = Object.freeze({ quantityTolerance: 1e-9, normalizedHedgeTolerance: 1e-9 });
let proposalSequence = 0;

class ManualClock {
  constructor(nowMs = T0) { this.value = nowMs; this.deadlines = []; }
  nowMs() { return this.value; }
  schedule(delayMs, task) {
    const deadline = { dueAtMs: this.value + delayMs, task, cancelled: false, fired: false };
    this.deadlines.push(deadline);
    return { cancel: () => { deadline.cancelled = true; } };
  }
}

const portFailure = (code) => ({
  code,
  message: code,
  retryable: false,
  recommendedOperatorAction: 'Inspect synthetic evidence.',
});

class FakePorts {
  constructor() {
    this.submissions = new Map();
    this.lookups = new Map();
    this.claims = new Map();
    this.submissionCalls = [];
    this.lookupCalls = [];
  }
  queueSubmission(key, ...values) { this.submissions.set(key, [...values]); return this; }
  queueLookup(key, ...values) { this.lookups.set(key, [...values]); return this; }
  claimPlanIdentity(planId, fingerprint) {
    const prior = this.claims.get(planId);
    if (prior === undefined) { this.claims.set(planId, fingerprint); return 'CLAIMED'; }
    return prior === fingerprint ? 'EXISTING_SAME' : 'CONFLICT';
  }
  async preflight() { return { ok: true }; }
  async validateLeg() { return { ok: true }; }
  key(request) { return `${request.phase}:${request.leg.key}`; }
  async submitPaper(request) {
    this.submissionCalls.push(this.key(request));
    const queue = this.submissions.get(this.key(request));
    if (queue?.length) return queue.shift();
    return {
      kind: 'FILLED',
      venueOrderId: `paper-${request.phase}-${request.leg.key}`,
      cumulativeFilledQuantity: request.leg.quantity,
    };
  }
  async lookupByClientOrderId(request) {
    this.lookupCalls.push(this.key(request));
    const queue = this.lookups.get(this.key(request));
    if (queue?.length) return queue.shift();
    return { kind: 'UNRESOLVED', failure: portFailure('LOOKUP_UNRESOLVED') };
  }
  async reconcile() { return { kind: 'CLOSED' }; }
}

function planInput() {
  proposalSequence += 1;
  return {
    strategy: 'BASIS',
    direction: 'LONG_SPOT_SHORT_PERP',
    symbol: 'TESTUSDT',
    proposal: {
      canonicalProposalId: `cprop_reconciliation_${proposalSequence}`,
      observedAtMs: T0 - 100,
      maxAgeMs: 10_000,
      expiresAtMs: T0 + 60_000,
    },
    attempt: 0,
    mode: 'PAPER',
    requiresApproval: false,
    maxNakedDurationMs: 5_000,
    spotQuantity: 1,
    perpQuantity: 2,
  };
}

async function coordinatorWith(ports = new FakePorts()) {
  const coordinator = createExecutionCoordinator(planInput(), new ManualClock(), ports);
  assert.equal((await coordinator.preflight()).ok, true);
  return coordinator;
}

async function fullyOpenState() {
  const coordinator = await coordinatorWith();
  assert.equal((await coordinator.open()).ok, true);
  return coordinator.snapshot();
}

async function partiallyOpenState() {
  const ports = new FakePorts().queueSubmission('OPEN:SPOT', {
    kind: 'PARTIALLY_FILLED',
    venueOrderId: 'paper-OPEN-SPOT',
    cumulativeFilledQuantity: 0.4,
  });
  const coordinator = await coordinatorWith(ports);
  assert.equal(coordinator.beginOpen().ok, true);
  assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
  const intermediate = coordinator.snapshot();
  const blocked = await coordinator.submitNextOpeningLeg();
  check('working opening partial is refreshed through owner lookup before dependent progression', ports.lookupCalls.join('|') === 'OPEN:SPOT');
  check('dependent hedge remains unsubmitted when working-partial owner truth is unresolved', !blocked.ok && ports.submissionCalls.join('|') === 'OPEN:SPOT');
  return intermediate;
}

async function ambiguousState() {
  const ports = new FakePorts()
    .queueSubmission('OPEN:SPOT', { kind: 'AMBIGUOUS', failure: portFailure('RESPONSE_LOST') })
    .queueLookup('OPEN:SPOT', { kind: 'UNRESOLVED', failure: portFailure('LOOKUP_UNRESOLVED') });
  const coordinator = await coordinatorWith(ports);
  await coordinator.open();
  return coordinator.snapshot();
}

async function acknowledgedState() {
  const ports = new FakePorts().queueSubmission('OPEN:SPOT', {
    kind: 'ACKNOWLEDGED',
    venueOrderId: 'paper-OPEN-SPOT',
  });
  const coordinator = await coordinatorWith(ports);
  assert.equal(coordinator.beginOpen().ok, true);
  assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
  const intermediate = coordinator.snapshot();
  const blocked = await coordinator.submitNextOpeningLeg();
  check('acknowledged opening leg is refreshed through owner lookup before dependent progression', ports.lookupCalls.join('|') === 'OPEN:SPOT');
  check('unresolved acknowledged-leg lookup blocks progression without a dependent submission', !blocked.ok && blocked.failure.code === 'LOOKUP_UNRESOLVED' && ports.submissionCalls.join('|') === 'OPEN:SPOT');
  return intermediate;
}

async function partiallyClosingState() {
  const ports = new FakePorts().queueSubmission('CLOSE:SPOT', {
    kind: 'PARTIALLY_FILLED',
    venueOrderId: 'paper-CLOSE-SPOT',
    cumulativeFilledQuantity: 0.4,
  });
  const coordinator = await coordinatorWith(ports);
  assert.equal((await coordinator.open()).ok, true);
  await coordinator.close();
  return coordinator.snapshot();
}

async function closedState() {
  const coordinator = await coordinatorWith();
  assert.equal((await coordinator.open()).ok, true);
  assert.equal((await coordinator.close()).ok, true);
  return coordinator.snapshot();
}

function metadata(nowMs, state, over = {}) {
  return {
    sourceId: 'synthetic.private.fixture',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: nowMs,
    receivedAtMs: nowMs,
    maxAgeMs: 5_000,
    coverageStartMs: state.createdAtMs,
    coverageEndMs: Math.max(state.updatedAtMs, nowMs),
    ...over,
  };
}

function orderStatus(lifecycle) {
  if (lifecycle === 'FILLED') return 'FILLED';
  if (lifecycle === 'PARTIALLY_FILLED') return 'PARTIALLY_FILLED';
  if (lifecycle === 'CANCELLED') return 'CANCELED';
  if (lifecycle === 'REJECTED') return 'REJECTED';
  return 'NEW';
}

function signed(side, quantity) { return side === 'BUY' ? quantity : -quantity; }

function expectedDelta(state, key) {
  const open = state.openingLegs[key];
  const close = state.closingLegs[key];
  return signed(open.definition.side, open.cumulativeFilledQuantity) +
    signed(close.definition.side, close.cumulativeFilledQuantity);
}

function exactEvidence(state, nowMs = T0 + 1_000) {
  const orders = [];
  const fills = [];
  let tradeSequence = 0;
  for (const [phase, record] of [['OPEN', state.openingLegs], ['CLOSE', state.closingLegs]]) {
    for (const key of ['SPOT', 'PERP']) {
      const leg = record[key];
      if (leg.submittedQuantity <= 0 || leg.venueOrderId === null) continue;
      orders.push({
        venue: leg.definition.venue,
        symbol: state.plan.symbol,
        clientOrderId: leg.definition.clientOrderId,
        venueOrderId: leg.venueOrderId,
        side: leg.definition.side,
        originalQuantity: leg.submittedQuantity,
        cumulativeFilledQuantity: leg.cumulativeFilledQuantity,
        status: orderStatus(leg.lifecycle),
        reduceOnly: leg.definition.reduceOnly,
        updatedAtMs: nowMs - 100 + tradeSequence,
      });
      if (leg.cumulativeFilledQuantity > 0) {
        tradeSequence += 1;
        fills.push({
          venue: leg.definition.venue,
          symbol: state.plan.symbol,
          tradeId: `trade-${phase}-${key}-${tradeSequence}`,
          // Exercise both direct client-ID and order-ID-only matching.
          clientOrderId: tradeSequence % 2 === 0 ? null : leg.definition.clientOrderId,
          venueOrderId: leg.venueOrderId,
          side: leg.definition.side,
          quantity: leg.cumulativeFilledQuantity,
          price: 100 + tradeSequence,
          occurredAtMs: nowMs - 200 + tradeSequence,
        });
      }
    }
  }
  return {
    orders: { metadata: metadata(nowMs, state), records: orders },
    fills: { metadata: metadata(nowMs, state), records: fills },
    positions: {
      metadata: metadata(nowMs, state, { coverageStartMs: null, coverageEndMs: null }),
      records: [
        {
          venue: 'BINANCE_SPOT',
          symbol: state.plan.symbol,
          positionSide: 'NET',
          quantity: expectedDelta(state, 'SPOT'),
          baselineQuantity: 0,
          observedAtMs: nowMs,
        },
        {
          venue: 'BINANCE_USDM',
          symbol: state.plan.symbol,
          positionSide: 'BOTH',
          quantity: expectedDelta(state, 'PERP'),
          baselineQuantity: 0,
          observedAtMs: nowMs,
        },
      ],
    },
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

let networkAttempts = 0;
const realFetch = globalThis.fetch;
const realDateNow = Date.now;
globalThis.fetch = async () => { networkAttempts += 1; throw new Error('network forbidden'); };
Date.now = () => { throw new Error('wall clock forbidden'); };

try {
  const openState = await fullyOpenState();

  section('1. Exact fill and immutable data-only output');
  {
    const evidence = exactEvidence(openState);
    const before = JSON.stringify(evidence);
    const result = reconcileExecutionState(openState, evidence, T0 + 1_000, POLICY);
    check('fully filled two-leg plan reconciles EXACT', result.status === 'EXACT', result.status);
    check('EXACT recommends NO_ACTION', result.recommendation === 'NO_ACTION');
    check('reconciler exposes no execution authority', result.executionAuthority === 'NONE');
    check('all four semantic legs are represented', result.legs.length === 4);
    check('observed venue position deltas match fills', result.positions.every((position) => position.status === 'EXACT'));
    check(
      'source report preserves full freshness provenance',
      result.sources.orders.sourceId === evidence.orders.metadata.sourceId &&
        result.sources.orders.sourceTimeMs === evidence.orders.metadata.sourceTimeMs &&
        result.sources.orders.receivedAtMs === evidence.orders.metadata.receivedAtMs &&
        result.sources.orders.maxAgeMs === evidence.orders.metadata.maxAgeMs,
    );
    check('input evidence is not mutated', JSON.stringify(evidence) === before);
    check('result and nested collections are frozen', Object.isFrozen(result) && Object.isFrozen(result.legs) && Object.isFrozen(result.reasons));
  }

  section('2. Partial fill is explicit and remainder recommendation is data only');
  {
    const state = await partiallyOpenState();
    const result = reconcileExecutionState(state, exactEvidence(state), T0 + 1_000, POLICY);
    const spot = result.legs.find((leg) => leg.phase === 'OPEN' && leg.legKey === 'SPOT');
    check('partial venue/checkpoint truth yields PARTIAL', result.status === 'PARTIAL', result.status);
    check('partial working remainder recommends CANCEL_REMAINDER', result.recommendation === 'CANCEL_REMAINDER');
    check('partial quantity preserved exactly', spot?.observedFilledQuantity === 0.4);
    check('remainder preserved exactly', spot?.observedRemainderQuantity === 0.6);
  }

  section('3. Duplicate and out-of-order fills normalize deterministically');
  {
    const evidence = exactEvidence(openState);
    const duplicate = clone(evidence.fills.records[0]);
    evidence.fills.records = [evidence.fills.records[1], evidence.fills.records[0], duplicate];
    const normalized = normalizeObservedEvidence(evidence, T0 + 1_000);
    const result = reconcileExecutionState(openState, evidence, T0 + 1_000, POLICY);
    check('one exact duplicate fill is dropped', normalized.stats.exactDuplicateFillsDropped === 1);
    check('reversed input order is detected', normalized.stats.outOfOrderFillPairs >= 1);
    check('normalized fills are canonical chronological order', normalized.fills.records[0].occurredAtMs <= normalized.fills.records[1].occurredAtMs);
    check('dedupe/out-of-order evidence remains EXACT', result.status === 'EXACT', result.status);

    const unicodeEvidence = exactEvidence(openState);
    unicodeEvidence.fills.records[0].tradeId = 'z-trade';
    unicodeEvidence.fills.records[1].tradeId = 'ä-trade';
    unicodeEvidence.fills.records[0].occurredAtMs = T0 + 500;
    unicodeEvidence.fills.records[1].occurredAtMs = T0 + 500;
    const unicode = normalizeObservedEvidence(unicodeEvidence, T0 + 1_000);
    check('Unicode identities use locale-independent code-unit order', unicode.fills.records.map((fill) => fill.tradeId).join('|') === 'z-trade|ä-trade');
  }

  section('4. Missing submission response remains ambiguous');
  {
    const state = await ambiguousState();
    const evidence = exactEvidence(state);
    evidence.orders.records = [];
    evidence.fills.records = [];
    const result = reconcileExecutionState(state, evidence, T0 + 1_000, POLICY);
    check('missing response is AMBIGUOUS, not success/failure', result.status === 'AMBIGUOUS', result.status);
    check('missing response is named', result.reasons.some((item) => item.code === 'MISSING_ORDER_RESPONSE'));
    check('ambiguous outcome requires manual review', result.recommendation === 'MANUAL_REVIEW');
  }

  section('5. Order versus position disagreement and unexpected residual');
  {
    const evidence = exactEvidence(openState);
    evidence.positions.records[0].quantity = 0;
    evidence.positions.records[1].quantity = 0;
    const result = reconcileExecutionState(openState, evidence, T0 + 1_000, POLICY);
    check('order/position disagreement is DIVERGED', result.status === 'DIVERGED', result.status);
    check('position disagreement is named', result.reasons.some((item) => item.code === 'ORDER_POSITION_DISAGREEMENT'));
    check('open-plan disagreement recommends residual hedge', result.recommendation === 'HEDGE_RESIDUAL');

    const state = await closedState();
    const closedEvidence = exactEvidence(state);
    closedEvidence.positions.records[0].quantity = 0.1;
    closedEvidence.positions.records[1].quantity = -0.2;
    const closed = reconcileExecutionState(state, closedEvidence, T0 + 1_000, POLICY);
    check('post-close residual is DIVERGED', closed.status === 'DIVERGED', closed.status);
    check('post-close residual recommends CLOSE_POSITION', closed.recommendation === 'CLOSE_POSITION');
    check('recommendation still has no automatic authority', closed.executionAuthority === 'NONE');
  }

  section('6. Conflicting client and trade identity cannot be laundered');
  {
    const evidence = exactEvidence(openState);
    const duplicateOrder = {
      ...clone(evidence.orders.records[0]),
      venueOrderId: 'different-venue-order',
    };
    evidence.orders.records.push(duplicateOrder);
    const result = reconcileExecutionState(openState, evidence, T0 + 1_000, POLICY);
    check('duplicate client-order ID is AMBIGUOUS', result.status === 'AMBIGUOUS', result.status);
    check('duplicate client-order identity is named', result.reasons.some((item) => item.code === 'DUPLICATE_CLIENT_ORDER_ID'));

    const fillConflictEvidence = exactEvidence(openState);
    fillConflictEvidence.fills.records.push({
      ...clone(fillConflictEvidence.fills.records[0]),
      quantity: 0.4,
    });
    const conflicting = reconcileExecutionState(openState, fillConflictEvidence, T0 + 1_000, POLICY);
    check('conflicting scoped trade ID is AMBIGUOUS', conflicting.status === 'AMBIGUOUS', conflicting.status);
    check('conflicting fill identity is named', conflicting.reasons.some((item) => item.code === 'CONFLICTING_FILL_IDENTITY'));
    check('conflicted fill winner is excluded from quantity divergence', !conflicting.reasons.some((item) => item.code === 'ORDER_FILL_QUANTITY_DISAGREEMENT' || item.code === 'CHECKPOINT_FILL_DISAGREEMENT'));
  }

  section('7. Explicit rounding policy does not hide larger disagreement');
  {
    const evidence = exactEvidence(openState);
    evidence.orders.records[0].cumulativeFilledQuantity = 0.9996;
    evidence.orders.records[1].cumulativeFilledQuantity = 1.9996;
    evidence.fills.records[0].quantity = 0.9996;
    evidence.fills.records[1].quantity = 1.9996;
    evidence.positions.records[0].quantity = 0.9996;
    evidence.positions.records[1].quantity = -1.9996;
    const tolerant = reconcileExecutionState(openState, evidence, T0 + 1_000, {
      quantityTolerance: 0.001,
      normalizedHedgeTolerance: 0.001,
    });
    check('sub-step rounding within declared tolerance is EXACT', tolerant.status === 'EXACT', tolerant.status);
    const strict = reconcileExecutionState(openState, evidence, T0 + 1_000, POLICY);
    check('same quantities diverge under strict policy', strict.status === 'DIVERGED', strict.status);
  }

  section('8. Stale, incomplete, and unavailable sources remain explicit');
  {
    const staleEvidence = exactEvidence(openState);
    staleEvidence.positions.metadata.sourceTimeMs = T0;
    staleEvidence.positions.metadata.receivedAtMs = T0;
    staleEvidence.positions.metadata.maxAgeMs = 100;
    for (const position of staleEvidence.positions.records) position.observedAtMs = T0;
    const stale = reconcileExecutionState(openState, staleEvidence, T0 + 1_000, POLICY);
    check('stale snapshots yield STALE', stale.status === 'STALE', stale.status);
    check('stale evidence recommends REFRESH', stale.recommendation === 'REFRESH');

    const incompleteEvidence = exactEvidence(openState);
    incompleteEvidence.fills.metadata.completeness = 'PARTIAL';
    incompleteEvidence.fills.metadata.coverageStartMs = openState.createdAtMs + 1;
    incompleteEvidence.fills.records[0].quantity = 0.4;
    const incomplete = reconcileExecutionState(openState, incompleteEvidence, T0 + 1_000, POLICY);
    check('incomplete fill history yields UNAVAILABLE', incomplete.status === 'UNAVAILABLE', incomplete.status);
    check('incomplete history is named', incomplete.reasons.some((item) => item.code === 'FILLS_HISTORY_INCOMPLETE'));
    check('incomplete history recommends REFRESH', incomplete.recommendation === 'REFRESH');
    check('incomplete fill subset does not override complete order quantity', incomplete.legs.find((leg) => leg.phase === 'OPEN' && leg.legKey === 'SPOT')?.observedFilledQuantity === 1);
    check('incomplete fill subset cannot create quantity divergence', !incomplete.reasons.some((item) => item.code === 'ORDER_FILL_QUANTITY_DISAGREEMENT' || item.code === 'CHECKPOINT_FILL_DISAGREEMENT'));

    const unavailableEvidence = exactEvidence(openState);
    unavailableEvidence.orders.metadata.authority = 'UNAVAILABLE';
    unavailableEvidence.orders.metadata.completeness = 'UNAVAILABLE';
    unavailableEvidence.orders.metadata.sourceTimeMs = null;
    unavailableEvidence.orders.metadata.coverageStartMs = null;
    unavailableEvidence.orders.metadata.coverageEndMs = null;
    unavailableEvidence.orders.records = null;
    const unavailable = reconcileExecutionState(openState, unavailableEvidence, T0 + 1_000, POLICY);
    check('missing private order source yields UNAVAILABLE', unavailable.status === 'UNAVAILABLE', unavailable.status);
    check('missing private source is named', unavailable.reasons.some((item) => item.code === 'ORDERS_SOURCE_UNAVAILABLE'));
    check('missing private source requires manual review', unavailable.recommendation === 'MANUAL_REVIEW');
    check('unavailable source preserves null source observation time', unavailable.sources.orders.sourceTimeMs === null);

    const bothUnavailableEvidence = exactEvidence(openState);
    for (const name of ['orders', 'fills']) {
      bothUnavailableEvidence[name].metadata.authority = 'UNAVAILABLE';
      bothUnavailableEvidence[name].metadata.completeness = 'UNAVAILABLE';
      bothUnavailableEvidence[name].metadata.sourceTimeMs = null;
      bothUnavailableEvidence[name].metadata.coverageStartMs = null;
      bothUnavailableEvidence[name].metadata.coverageEndMs = null;
      bothUnavailableEvidence[name].records = null;
    }
    const bothUnavailable = reconcileExecutionState(openState, bothUnavailableEvidence, T0 + 1_000, POLICY);
    check('both order and fill sources unavailable remains UNAVAILABLE', bothUnavailable.status === 'UNAVAILABLE', bothUnavailable.status);
    check('unavailable absence is not mislabeled missing response', !bothUnavailable.reasons.some((item) => item.code === 'MISSING_ORDER_RESPONSE'));

    const untrustedRecordsEvidence = exactEvidence(openState);
    untrustedRecordsEvidence.orders.metadata.authority = 'UNAVAILABLE';
    untrustedRecordsEvidence.orders.records[0].cumulativeFilledQuantity = 0.1;
    const untrustedRecords = reconcileExecutionState(openState, untrustedRecordsEvidence, T0 + 1_000, POLICY);
    check('records labeled unavailable cannot drive DIVERGED', untrustedRecords.status === 'UNAVAILABLE', untrustedRecords.status);
    check('unavailable records are excluded from order/fill comparison', !untrustedRecords.reasons.some((item) => item.code === 'ORDER_FILL_QUANTITY_DISAGREEMENT'));

    const noBaselineEvidence = exactEvidence(openState);
    noBaselineEvidence.positions.records[0].baselineQuantity = null;
    const noBaseline = reconcileExecutionState(openState, noBaselineEvidence, T0 + 1_000, POLICY);
    check('unknown position baseline stays UNAVAILABLE', noBaseline.status === 'UNAVAILABLE', noBaseline.status);
    check('unknown baseline is named, never assumed zero', noBaseline.reasons.some((item) => item.code === 'POSITION_BASELINE_UNKNOWN'));
  }

  section('9. Close and restart reconciliation');
  {
    const state = await closedState();
    const evidence = exactEvidence(state);
    const closed = reconcileExecutionState(state, evidence, T0 + 1_000, POLICY);
    check('fully closed checkpoint/evidence is EXACT', closed.status === 'EXACT', closed.status);
    check('close has zero observed residuals', closed.positions.every((position) => position.observedDeltaQuantity === 0));

    const serialized = serializeExecutionCheckpoint(state);
    const restored = restoreExecutionCheckpoint(serialized);
    assert.equal(restored.ok, true);
    const afterRestart = reconcileExecutionState(restored.state, evidence, T0 + 1_000, POLICY);
    check('restart produces byte-equivalent reconciliation', JSON.stringify(afterRestart) === JSON.stringify(closed));
    check('same inputs remain deterministic across repeated calls', JSON.stringify(reconcileExecutionState(state, evidence, T0 + 1_000, POLICY)) === JSON.stringify(closed));
  }

  section('10. Restart horizon and lifecycle semantics');
  {
    const coverageGapEvidence = exactEvidence(openState, T0 + 10_000);
    coverageGapEvidence.orders.metadata.coverageEndMs = openState.updatedAtMs;
    coverageGapEvidence.fills.metadata.coverageEndMs = openState.updatedAtMs;
    const coverageGap = reconcileExecutionState(openState, coverageGapEvidence, T0 + 10_000, POLICY);
    check('history ending at stale checkpoint cannot prove restart truth', coverageGap.status === 'UNAVAILABLE', coverageGap.status);
    check('snapshot-horizon coverage gap is named', coverageGap.reasons.some((item) => item.code === 'ORDERS_HISTORY_WINDOW_INCOMPLETE' || item.code === 'FILLS_HISTORY_WINDOW_INCOMPLETE'));

    const delayedEvidence = exactEvidence(openState, T0 + 1_000);
    const delayed = reconcileExecutionState(openState, delayedEvidence, T0 + 1_500, POLICY);
    check('fresh normal ingestion delay remains EXACT', delayed.status === 'EXACT', delayed.status);

    const acknowledged = await acknowledgedState();
    const canceledEvidence = exactEvidence(acknowledged);
    canceledEvidence.orders.records[0].status = 'CANCELED';
    const canceled = reconcileExecutionState(acknowledged, canceledEvidence, T0 + 1_000, POLICY);
    check('ACKNOWLEDGED checkpoint versus CANCELED venue order diverges', canceled.status === 'DIVERGED', canceled.status);
    check('terminal venue order is not called working/pending', canceled.recommendation !== 'WAIT' && !canceled.reasons.some((item) => item.code === 'WORKING_ORDER_PENDING'));

    const closing = await partiallyClosingState();
    const closingResult = reconcileExecutionState(closing, exactEvidence(closing), T0 + 1_000, POLICY);
    check('active risk-reducing close remainder is PARTIAL', closingResult.status === 'PARTIAL', closingResult.status);
    check('risk-reducing close remainder is never canceled', closingResult.recommendation === 'WAIT', closingResult.recommendation);
  }

  section('11. Malformed identities, timestamps, checkpoints, and overflow fail closed');
  {
    const numericId = exactEvidence(openState);
    numericId.orders.records[0].venueOrderId = Number.MAX_SAFE_INTEGER + 10;
    check('unsafe numeric venue ID is rejected, not coerced', (() => {
      try { reconcileExecutionState(openState, numericId, T0 + 1_000, POLICY); return false; }
      catch (error) { return error instanceof TypeError && /venueOrderId/.test(error.message); }
    })());

    const badTimestamp = exactEvidence(openState);
    badTimestamp.fills.records[0].occurredAtMs = Number.NaN;
    check('malformed timestamp is rejected', (() => {
      try { reconcileExecutionState(openState, badTimestamp, T0 + 1_000, POLICY); return false; }
      catch (error) { return error instanceof TypeError; }
    })());

    const futureEvidence = exactEvidence(openState);
    for (const order of futureEvidence.orders.records) order.updatedAtMs = T0 + 50_000;
    for (const fill of futureEvidence.fills.records) fill.occurredAtMs = T0 + 50_000;
    for (const position of futureEvidence.positions.records) position.observedAtMs = T0 + 50_000;
    check('future-dated records beyond source/evaluation horizon are rejected', (() => {
      try { reconcileExecutionState(openState, futureEvidence, T0 + 1_000, POLICY); return false; }
      catch (error) { return error instanceof TypeError && /horizon/.test(error.message); }
    })());

    const forgedClosed = clone(openState);
    forgedClosed.lifecycle = 'CLOSED';
    check('CLOSED checkpoint retaining open exposure is rejected', (() => {
      try { reconcileExecutionState(forgedClosed, exactEvidence(openState), T0 + 1_000, POLICY); return false; }
      catch (error) { return error instanceof TypeError && /CLOSED checkpoint retains/.test(error.message); }
    })());

    const forgedLeg = clone(openState);
    forgedLeg.openingLegs.SPOT.definition.clientOrderId = 'cx-valid-but-conflicting-1';
    check('runtime leg definition must bind the frozen plan definition', (() => {
      try { reconcileExecutionState(forgedLeg, exactEvidence(forgedLeg), T0 + 1_000, POLICY); return false; }
      catch (error) { return error instanceof TypeError && /diverges from frozen plan/.test(error.message); }
    })());

    const forgedDirection = clone(await closedState());
    forgedDirection.closingLegs.SPOT.definition.side = forgedDirection.openingLegs.SPOT.definition.side;
    forgedDirection.plan.closingLegs.SPOT.side = forgedDirection.plan.openingLegs.SPOT.side;
    check('close definition must reverse opening exposure', (() => {
      try { reconcileExecutionState(forgedDirection, exactEvidence(forgedDirection), T0 + 1_000, POLICY); return false; }
      catch (error) { return error instanceof TypeError && /does not reverse/.test(error.message); }
    })());

    const unknownField = exactEvidence(openState);
    unknownField.orders.records[0].unexpectedField = 'forbidden-shape';
    check('unknown evidence field is rejected', (() => {
      try { reconcileExecutionState(openState, unknownField, T0 + 1_000, POLICY); return false; }
      catch (error) { return error instanceof TypeError && /unknown fields/.test(error.message); }
    })());

    const overflow = exactEvidence(openState);
    const first = overflow.fills.records[0];
    overflow.fills.records = [
      { ...first, tradeId: 'overflow-a', quantity: 8_000_000_000_000_000 },
      { ...first, tradeId: 'overflow-b', quantity: 8_000_000_000_000_000 },
      overflow.fills.records[1],
    ];
    check('aggregate quantity overflow throws instead of rounding', (() => {
      try { reconcileExecutionState(openState, overflow, T0 + 1_000, POLICY); return false; }
      catch (error) { return error instanceof TypeError && /safe numeric range/.test(error.message); }
    })());

    check('invalid negative tolerance is rejected', (() => {
      try { reconcileExecutionState(openState, exactEvidence(openState), T0 + 1_000, { quantityTolerance: -1, normalizedHedgeTolerance: 0 }); return false; }
      catch (error) { return error instanceof TypeError; }
    })());
  }

  section('12. Safety boundary');
  check('no network request was attempted', networkAttempts === 0, `${networkAttempts} attempts`);
} finally {
  globalThis.fetch = realFetch;
  Date.now = realDateNow;
}

const passed = results.filter((item) => item.pass).length;
console.log(`\n${passed}/${results.length} reconciliation checks passed`);
if (passed !== results.length) process.exit(1);
