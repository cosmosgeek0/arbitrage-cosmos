#!/usr/bin/env node
/**
 * Two-leg execution coordinator synthetic proof.
 * ZERO network: only injected fake ports and a manual clock are used.
 * Run after `npm run build -w server`:
 *   node server/test/foundation/execution/execution.mjs
 */
import assert from 'node:assert/strict';
import {
  createExecutionCheckpoint,
  createExecutionCoordinator,
  createExecutionEvent,
  createExecutionPlanDefinition,
  recommendExecutionRecovery,
  reduceExecutionEvent,
  restoreExecutionCheckpoint,
  restoreExecutionCoordinator,
  serializeExecutionCheckpoint,
} from '../../../dist/foundation/execution/index.js';
import {
  canonicalJson,
  derivePlanId,
  stableHash128Hex,
} from '../../../dist/foundation/contracts/index.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

const T0 = 1_800_000_000_000;

class ManualClock {
  constructor(nowMs = T0) { this.value = nowMs; }
  nowMs() { return this.value; }
  set(nowMs) { this.value = nowMs; }
  advance(ms) { this.value += ms; }
}

const okPort = Object.freeze({ ok: true });
const portFailure = (code, message = code) => ({
  code,
  message,
  retryable: false,
  recommendedOperatorAction: 'Inspect synthetic evidence.',
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function resignCheckpointObject(checkpoint) {
  const { checksum: _discarded, ...payload } = checkpoint;
  return canonicalJson({ ...payload, checksum: stableHash128Hex(canonicalJson(payload)) });
}

class FakePorts {
  constructor() {
    this.calls = [];
    this.identityClaims = new Map();
    this.preflightResult = okPort;
    this.validationResults = new Map();
    this.submissions = new Map();
    this.lookups = new Map();
    this.reconciliations = [];
  }
  claimPlanIdentity(planId, termsFingerprint) {
    const existing = this.identityClaims.get(planId);
    if (existing === undefined) {
      this.identityClaims.set(planId, termsFingerprint);
      return 'CLAIMED';
    }
    return existing === termsFingerprint ? 'EXISTING_SAME' : 'CONFLICT';
  }
  key(request) { return `${request.phase}:${request.leg.key}`; }
  queueSubmission(key, ...outcomes) { this.submissions.set(key, [...outcomes]); return this; }
  queueLookup(key, ...outcomes) { this.lookups.set(key, [...outcomes]); return this; }
  failValidation(key, code = 'VALIDATION_REJECTED') {
    this.validationResults.set(key, { ok: false, failure: portFailure(code) });
    return this;
  }
  async preflight(plan) {
    this.calls.push({ method: 'preflight', planId: plan.planId });
    return this.preflightResult;
  }
  async validateLeg(request) {
    this.calls.push({ method: 'validateLeg', request });
    return this.validationResults.get(this.key(request)) ?? okPort;
  }
  async submitPaper(request) {
    this.calls.push({ method: 'submitPaper', request });
    const queue = this.submissions.get(this.key(request));
    if (queue?.length) {
      const next = queue.shift();
      if (next === 'THROW') throw new Error('synthetic response loss');
      if (typeof next === 'function') return next(request);
      return next;
    }
    return {
      kind: 'FILLED',
      venueOrderId: `paper-${request.phase}-${request.leg.key}`,
      cumulativeFilledQuantity: request.leg.quantity,
    };
  }
  async lookupByClientOrderId(request) {
    this.calls.push({ method: 'lookupByClientOrderId', request });
    const queue = this.lookups.get(this.key(request));
    if (queue?.length) {
      const next = queue.shift();
      if (next === 'THROW') throw new Error('synthetic lookup loss');
      return next;
    }
    return { kind: 'UNRESOLVED', failure: portFailure('LOOKUP_UNRESOLVED') };
  }
  async reconcile(state) {
    this.calls.push({ method: 'reconcile', planId: state.plan.planId });
    if (this.reconciliations.length) return this.reconciliations.shift();
    const spot = Math.max(0, state.openingLegs.SPOT.cumulativeFilledQuantity - state.closingLegs.SPOT.cumulativeFilledQuantity);
    const perp = Math.max(0, state.openingLegs.PERP.cumulativeFilledQuantity - state.closingLegs.PERP.cumulativeFilledQuantity);
    if (spot === 0 && perp === 0) return { kind: 'CLOSED' };
    const spotRatio = spot / state.openingLegs.SPOT.definition.quantity;
    const perpRatio = perp / state.openingLegs.PERP.definition.quantity;
    return Math.abs(spotRatio - perpRatio) < 1e-12 ? { kind: 'HEDGED_OPEN' } : { kind: 'ONE_LEG_EXPOSED' };
  }
}

let proposalCounter = 0;
function planInput(over = {}) {
  proposalCounter += 1;
  const proposal = over.proposal ?? {
    canonicalProposalId: `cprop_exec_${proposalCounter}`,
    observedAtMs: T0 - 100,
    maxAgeMs: 5_000,
    expiresAtMs: T0 + 60_000,
  };
  return {
    strategy: 'BASIS',
    direction: 'LONG_SPOT_SHORT_PERP',
    symbol: 'TESTUSDT',
    proposal,
    attempt: 0,
    mode: 'PAPER',
    requiresApproval: false,
    maxNakedDurationMs: 1_000,
    spotQuantity: 1,
    perpQuantity: 2,
    ...over,
    proposal,
  };
}

async function readyCoordinator(over = {}, ports = new FakePorts(), clock = new ManualClock()) {
  const coordinator = createExecutionCoordinator(planInput(over), clock, ports);
  if (coordinator.snapshot().plan.requiresApproval) {
    coordinator.requestApproval(5_000);
    coordinator.approve();
  }
  const preflight = await coordinator.preflight();
  assert.equal(preflight.ok, true, preflight.ok ? '' : preflight.failure.code);
  return { coordinator, ports, clock };
}

let networkAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error('network forbidden in execution proof');
};

try {
  section('1. Deterministic plan identity and both Basis directions');
  {
    const input = planInput({ proposal: {
      canonicalProposalId: 'cprop_direction_law', observedAtMs: T0 - 1, maxAgeMs: 5_000, expiresAtMs: T0 + 10_000,
    } });
    const a = createExecutionPlanDefinition(input);
    const b = createExecutionPlanDefinition({ ...input });
    check('same semantic plan reproduces plan ID', a.planId === b.planId);
    check('plan ID matches frozen identity kernel', a.planId === derivePlanId({ canonicalProposalId: input.proposal.canonicalProposalId, attempt: 0 }));
    check('one correlation ID is shared by the plan', a.correlationId.startsWith('cor_'));
    check('all four legs have deterministic distinct client-order IDs', new Set([
      a.openingLegs.SPOT.clientOrderId, a.openingLegs.PERP.clientOrderId,
      a.closingLegs.SPOT.clientOrderId, a.closingLegs.PERP.clientOrderId,
    ]).size === 4);
    check('client-order IDs obey venue-safe format', [
      a.openingLegs.SPOT.clientOrderId, a.openingLegs.PERP.clientOrderId,
      a.closingLegs.SPOT.clientOrderId, a.closingLegs.PERP.clientOrderId,
    ].every((id) => /^[a-zA-Z0-9_-]{1,36}$/.test(id)));
    check('long-spot/short-perp open sides are BUY/SELL', a.openingLegs.SPOT.side === 'BUY' && a.openingLegs.PERP.side === 'SELL');
    check('long-spot/short-perp close sides reverse independently', a.closingLegs.SPOT.side === 'SELL' && a.closingLegs.PERP.side === 'BUY');
    check('only futures close declares reduceOnly', !a.closingLegs.SPOT.reduceOnly && a.closingLegs.PERP.reduceOnly);

    const reverse = createExecutionPlanDefinition(planInput({
      direction: 'SHORT_SPOT_LONG_PERP',
      proposal: { canonicalProposalId: 'cprop_reverse_law', observedAtMs: T0 - 1, maxAgeMs: 5_000, expiresAtMs: T0 + 10_000 },
    }));
    check('short-spot/long-perp open sides are SELL/BUY', reverse.openingLegs.SPOT.side === 'SELL' && reverse.openingLegs.PERP.side === 'BUY');
    check('short-spot/long-perp close sides reverse independently', reverse.closingLegs.SPOT.side === 'BUY' && reverse.closingLegs.PERP.side === 'SELL');
    check('opening legs are explicitly risk-increasing', Object.values(reverse.openingLegs).every((leg) => leg.riskEffect === 'RISK_INCREASING'));
    check('closing legs are explicitly risk-reducing', Object.values(reverse.closingLegs).every((leg) => leg.riskEffect === 'RISK_REDUCING'));

    const conflicting = createExecutionPlanDefinition({
      ...input,
      direction: 'SHORT_SPOT_LONG_PERP',
      spotQuantity: 3,
    });
    check('frozen PlanId collision is exposed by different terms fingerprints', conflicting.planId === a.planId && conflicting.termsFingerprint !== a.termsFingerprint);
    check('conflicting terms cannot collide on client-order IDs', conflicting.openingLegs.SPOT.clientOrderId !== a.openingLegs.SPOT.clientOrderId && conflicting.openingLegs.PERP.clientOrderId !== a.openingLegs.PERP.clientOrderId);
    const registryPorts = new FakePorts();
    createExecutionCoordinator(input, new ManualClock(), registryPorts);
    let conflictCode = null;
    try {
      createExecutionCoordinator({ ...input, direction: 'SHORT_SPOT_LONG_PERP', spotQuantity: 3 }, new ManualClock(), registryPorts);
    } catch (error) {
      conflictCode = error?.code ?? null;
    }
    check('injected identity registry rejects same PlanId with conflicting terms', conflictCode === 'PLAN_TERMS_CONFLICT');
    check('incremented attempt is the explicit replan seam', createExecutionCoordinator({ ...input, attempt: 1, direction: 'SHORT_SPOT_LONG_PERP', spotQuantity: 3 }, new ManualClock(), registryPorts).snapshot().plan.planId !== a.planId);
  }

  section('2. Pure reducer: duplicate suppression, order, revision, transitions');
  {
    const definition = createExecutionPlanDefinition(planInput({
      proposal: { canonicalProposalId: 'cprop_reducer', observedAtMs: T0 - 1, maxAgeMs: 5_000, expiresAtMs: T0 + 10_000 },
    }));
    const createdEvent = createExecutionEvent(definition.planId, 1, T0, 'PLAN_CREATED', { plan: definition });
    const created = reduceExecutionEvent(null, createdEvent);
    assert.equal(created.applied, true);
    const duplicate = reduceExecutionEvent(created.state, createdEvent);
    check('duplicate event ID is suppressed', !duplicate.applied && duplicate.reason === 'DUPLICATE_EVENT');
    check('duplicate does not advance revision', duplicate.state.revision === 1);
    const conflictingDuplicate = reduceExecutionEvent(created.state, { ...createdEvent, type: 'PLAN_CANCELLED' });
    check('same event ID with different intent is rejected', !conflictingDuplicate.applied && conflictingDuplicate.reason === 'INVALID_EVENT');
    const forgedIdentity = reduceExecutionEvent(created.state, {
      ...createExecutionEvent(definition.planId, 2, T0 + 1, 'PLAN_CANCELLED'),
      eventId: 'evt_forged_identity',
    });
    check('event ID must match stream and sequence', !forgedIdentity.applied && forgedIdentity.reason === 'INVALID_EVENT');
    const stale = createExecutionEvent(definition.planId, 0, T0 + 1, 'PLAN_CANCELLED');
    const staleResult = reduceExecutionEvent(created.state, stale);
    check('out-of-order unique event is suppressed', !staleResult.applied && staleResult.reason === 'STALE_EVENT');
    const gap = reduceExecutionEvent(created.state, createExecutionEvent(definition.planId, 999, T0 + 1, 'PLAN_CANCELLED'));
    check('forward sequence gap is rejected explicitly', !gap.applied && gap.reason === 'EVENT_SEQUENCE_GAP');
    const invalid = createExecutionEvent(definition.planId, 2, T0 + 1, 'OPENING_STARTED');
    const invalidResult = reduceExecutionEvent(created.state, invalid);
    check('illegal lifecycle transition is rejected', !invalidResult.applied && invalidResult.reason === 'INVALID_PLAN_TRANSITION');
    check('rejected transition preserves state object', invalidResult.state === created.state);
    const cancelled = reduceExecutionEvent(created.state, createExecutionEvent(definition.planId, 2, T0 + 2, 'PLAN_CANCELLED'));
    check('legal event advances monotonic revision', cancelled.applied && cancelled.state.revision === 2);
    check('state revision ID changes with revision', cancelled.applied && cancelled.state.stateRevisionId !== created.state.stateRevisionId);
    check('event stream and processed IDs stay immutable', cancelled.applied && Object.isFrozen(cancelled.state.eventLog) && Object.isFrozen(cancelled.state.processedEventIds));
  }

  section('3. VALIDATE_ONLY and LIVE_MANUAL are hard-blocked');
  {
    const ports = new FakePorts();
    const clock = new ManualClock();
    const c = createExecutionCoordinator(planInput({ mode: 'VALIDATE_ONLY' }), clock, ports);
    const preflight = await c.preflight();
    check('validate-only completes preflight', preflight.ok && c.snapshot().lifecycle === 'READY');
    const open = await c.open();
    check('validate-only submission is blocked by named failure', !open.ok && open.failure.code === 'VALIDATE_ONLY_SUBMISSION_BLOCKED');
    check('validate-only never calls submission port', ports.calls.every((call) => call.method !== 'submitPaper'));
    const validateState = c.snapshot();
    const forgedOpen = reduceExecutionEvent(
      validateState,
      createExecutionEvent(validateState.plan.planId, validateState.lastSequence + 1, clock.nowMs(), 'OPENING_STARTED'),
    );
    check('pure reducer rejects VALIDATE_ONLY order lifecycle events', !forgedOpen.applied && forgedOpen.reason === 'INVARIANT_VIOLATION');
    check('submission primitive is native-private at runtime', typeof c.submitLeg === 'undefined');

    const livePorts = new FakePorts();
    const live = createExecutionCoordinator(planInput({ mode: 'LIVE_MANUAL' }), clock, livePorts);
    const livePreflight = await live.preflight();
    check('LIVE_MANUAL remains explicitly blocked', !livePreflight.ok && livePreflight.failure.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED');
    check('live block occurs before any injected port', livePorts.calls.length === 0);
  }

  section('4. PAPER open/close lifecycle — long spot, short perp');
  {
    const { coordinator, ports } = await readyCoordinator();
    const opened = await coordinator.open();
    check('fake open reaches HEDGED_OPEN', opened.ok && coordinator.snapshot().lifecycle === 'HEDGED_OPEN');
    check('both opening legs are FILLED', Object.values(coordinator.snapshot().openingLegs).every((leg) => leg.lifecycle === 'FILLED'));
    check('open requests are risk-increasing PAPER only', ports.calls.filter((call) => call.method === 'submitPaper' && call.request.phase === 'OPEN').every((call) => call.request.mode === 'PAPER' && call.request.leg.riskEffect === 'RISK_INCREASING'));
    const closed = await coordinator.close();
    check('fake close reconciles to CLOSED', closed.ok && coordinator.snapshot().lifecycle === 'CLOSED');
    check('opening lifecycle remains intact after close', Object.values(coordinator.snapshot().openingLegs).every((leg) => leg.lifecycle === 'FILLED'));
    check('closing lifecycle is independent and FILLED', Object.values(coordinator.snapshot().closingLegs).every((leg) => leg.lifecycle === 'FILLED'));
    check('close requests are risk-reducing', ports.calls.filter((call) => call.method === 'submitPaper' && call.request.phase === 'CLOSE').every((call) => call.request.leg.riskEffect === 'RISK_REDUCING'));
    check('close is followed by injected reconciliation', ports.calls.some((call) => call.method === 'reconcile'));
  }

  section('5. PAPER open/close lifecycle — short spot, long perp');
  {
    const { coordinator, ports } = await readyCoordinator({ direction: 'SHORT_SPOT_LONG_PERP' });
    const opened = await coordinator.open();
    check('reverse Basis direction reaches HEDGED_OPEN', opened.ok && coordinator.snapshot().lifecycle === 'HEDGED_OPEN');
    const openCalls = ports.calls.filter((call) => call.method === 'submitPaper' && call.request.phase === 'OPEN');
    check('reverse direction submits spot SELL and perp BUY', openCalls.some((c) => c.request.leg.key === 'SPOT' && c.request.leg.side === 'SELL') && openCalls.some((c) => c.request.leg.key === 'PERP' && c.request.leg.side === 'BUY'));
    const closed = await coordinator.close();
    check('reverse direction closes cleanly', closed.ok && coordinator.snapshot().lifecycle === 'CLOSED');
    const closeCalls = ports.calls.filter((call) => call.method === 'submitPaper' && call.request.phase === 'CLOSE');
    check('reverse close uses spot BUY and perp SELL', closeCalls.some((c) => c.request.leg.key === 'SPOT' && c.request.leg.side === 'BUY') && closeCalls.some((c) => c.request.leg.key === 'PERP' && c.request.leg.side === 'SELL'));
  }

  section('6. Approval and proposal expiry fail closed');
  {
    const clock = new ManualClock();
    const ports = new FakePorts();
    const c = createExecutionCoordinator(planInput({ requiresApproval: true }), clock, ports);
    check('approval request enters AWAITING_APPROVAL', c.requestApproval(1_000).ok && c.snapshot().lifecycle === 'AWAITING_APPROVAL');
    clock.advance(1_000);
    const approved = c.approve();
    check('approval is expired at exact boundary', !approved.ok && approved.failure.code === 'APPROVAL_EXPIRED');
    check('expired approval is terminal before exposure', c.snapshot().lifecycle === 'EXPIRED');
    check('expired approval never calls a port', ports.calls.length === 0);

    const staleClock = new ManualClock();
    const stalePorts = new FakePorts();
    const stale = createExecutionCoordinator(planInput({ proposal: {
      canonicalProposalId: 'cprop_stale', observedAtMs: T0 - 10_000, maxAgeMs: 100, expiresAtMs: T0 + 10_000,
    } }), staleClock, stalePorts);
    const staleResult = await stale.preflight();
    check('stale proposal is rejected by name', !staleResult.ok && staleResult.failure.code === 'PROPOSAL_STALE');
    check('stale proposal becomes EXPIRED, not READY', stale.snapshot().lifecycle === 'EXPIRED');
    check('stale proposal rejection occurs before ports', stalePorts.calls.length === 0);
  }

  section('6b. Entry authority is rechecked after READY and before submit');
  {
    const approvalClock = new ManualClock();
    const approvalPorts = new FakePorts();
    const approvalPlan = createExecutionCoordinator(planInput({
      requiresApproval: true,
      proposal: {
        canonicalProposalId: 'cprop_ready_approval_expiry',
        observedAtMs: T0 - 1,
        maxAgeMs: 10_000,
        expiresAtMs: T0 + 20_000,
      },
    }), approvalClock, approvalPorts);
    approvalPlan.requestApproval(100);
    approvalPlan.approve();
    assert.equal((await approvalPlan.preflight()).ok, true);
    approvalClock.advance(100);
    const expiredApprovalOpen = await approvalPlan.open();
    check('approval expiring after READY blocks beginOpen', !expiredApprovalOpen.ok && expiredApprovalOpen.failure.code === 'APPROVAL_EXPIRED');
    check('expired READY plan never reaches submission port', !approvalPorts.calls.some((call) => call.method === 'submitPaper'));
    check('pre-exposure entry-window expiry becomes EXPIRED', approvalPlan.snapshot().lifecycle === 'EXPIRED');

    const proposalClock = new ManualClock();
    const proposalPorts = new FakePorts();
    const proposalPlan = createExecutionCoordinator(planInput({
      proposal: {
        canonicalProposalId: 'cprop_ready_proposal_expiry',
        observedAtMs: T0 - 1,
        maxAgeMs: 10_000,
        expiresAtMs: T0 + 50,
      },
    }), proposalClock, proposalPorts);
    assert.equal((await proposalPlan.preflight()).ok, true);
    proposalClock.advance(50);
    const expiredProposalOpen = await proposalPlan.open();
    check('proposal expiring after READY blocks beginOpen', !expiredProposalOpen.ok && expiredProposalOpen.failure.code === 'PROPOSAL_EXPIRED');
    check('post-READY proposal expiry emits no submission', !proposalPorts.calls.some((call) => call.method === 'submitPaper'));
  }

  section('6c. Failures name the safe state after reducer transitions');
  {
    const preflightPorts = new FakePorts();
    preflightPorts.preflightResult = {
      ok: false,
      failure: portFailure('RISK_PREFLIGHT_REJECTED'),
    };
    const preflightCoordinator = createExecutionCoordinator(planInput(), new ManualClock(), preflightPorts);
    const preflightRejected = await preflightCoordinator.preflight();
    check('preflight rejection reaches FAILED', !preflightRejected.ok && preflightCoordinator.snapshot().lifecycle === 'FAILED');
    check('preflight failure names post-transition FAILED state', !preflightRejected.ok && preflightRejected.failure.safeCurrentState === preflightCoordinator.snapshot().lifecycle);
  }

  section('7. First-leg rejection stops the sequence');
  {
    const ports = new FakePorts().queueSubmission('OPEN:SPOT', {
      kind: 'REJECTED', failure: portFailure('FIRST_LEG_REJECTED'),
    });
    const { coordinator } = await readyCoordinator({}, ports);
    const result = await coordinator.open();
    check('first-leg rejection returns named failure', !result.ok && result.failure.code === 'FIRST_LEG_REJECTED');
    check('first-leg rejection with no exposure becomes FAILED', coordinator.snapshot().lifecycle === 'FAILED');
    check('first-leg rejection names post-transition FAILED state', !result.ok && result.failure.safeCurrentState === coordinator.snapshot().lifecycle);
    check('second leg is never submitted', !ports.calls.some((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'PERP'));
  }

  section('8. Working opening partials are terminalized before dependent hedge sizing');
  {
    const partialPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'PARTIALLY_FILLED', venueOrderId: 'paper-spot', cumulativeFilledQuantity: 0.4 })
      .queueLookup('OPEN:SPOT', {
        kind: 'FOUND', status: 'CANCELLED', venueOrderId: 'paper-spot', cumulativeFilledQuantity: 0.6,
      })
      .queueSubmission('OPEN:PERP', { kind: 'FILLED', venueOrderId: 'paper-perp', cumulativeFilledQuantity: 1.2 });
    const { coordinator: partial, clock } = await readyCoordinator({}, partialPorts);
    const partialResult = await partial.open();
    check('opening partial is refreshed to a terminal fact before hedge submission', partialResult.ok && partial.snapshot().openingLegs.SPOT.lifecycle === 'CANCELLED' && partial.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 0.6);
    check('dependent hedge follows the terminal 60% fill, not the stale 40% observation', partialPorts.calls.some((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'PERP' && Math.abs(c.request.leg.quantity - 1.2) < 1e-12));
    const partialLookupIndex = partialPorts.calls.findIndex((c) => c.method === 'lookupByClientOrderId' && c.request.phase === 'OPEN' && c.request.leg.key === 'SPOT');
    const partialHedgeIndex = partialPorts.calls.findIndex((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'PERP');
    check('opening refresh happens before the dependent hedge port call', partialLookupIndex >= 0 && partialHedgeIndex > partialLookupIndex);
    check('terminalized matched partial can become safely HEDGED_OPEN', partial.snapshot().lifecycle === 'HEDGED_OPEN' && partial.snapshot().exposedSinceMs === null);
    const recs = recommendExecutionRecovery(partial.snapshot(), clock.nowMs());
    check('recovery recommends only explicit non-entry effects', recs.filter((r) => r.action !== 'NO_ACTION').every((r) => r.riskEffect !== 'RISK_INCREASING'));

    const driftingPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'PARTIALLY_FILLED', venueOrderId: 'drifting-spot', cumulativeFilledQuantity: 0.4 })
      .queueLookup('OPEN:SPOT', {
        kind: 'FOUND', status: 'PARTIALLY_FILLED', venueOrderId: 'drifting-spot', cumulativeFilledQuantity: 0.6,
      }, {
        kind: 'FOUND', status: 'PARTIALLY_FILLED', venueOrderId: 'drifting-spot', cumulativeFilledQuantity: 0.65,
      }, {
        kind: 'FOUND', status: 'CANCELLED', venueOrderId: 'drifting-spot', cumulativeFilledQuantity: 0.7,
      })
      .queueSubmission('OPEN:PERP', (request) => ({
        kind: 'FILLED', venueOrderId: 'stable-hedge', cumulativeFilledQuantity: request.leg.quantity,
      }));
    const { coordinator: drifting, clock: driftingClock } = await readyCoordinator({}, driftingPorts);
    assert.equal((await drifting.submitNextOpeningLeg()).ok, true);
    const workingPartialState = drifting.snapshot();
    const forgedEarlyHedge = reduceExecutionEvent(
      workingPartialState,
      createExecutionEvent(
        workingPartialState.plan.planId,
        workingPartialState.lastSequence + 1,
        driftingClock.nowMs(),
        'LEG_SUBMISSION_STARTED',
        { phase: 'OPEN', legKey: 'PERP', submittedQuantity: 0.8 },
      ),
    );
    check('pure reducer rejects a dependent hedge while its predecessor is still working', !forgedEarlyHedge.applied && forgedEarlyHedge.reason === 'INVALID_LEG_TRANSITION');
    const stillWorking = await drifting.submitNextOpeningLeg();
    check('a refreshed but still-working opening partial blocks dependent hedge', !stillWorking.ok && stillWorking.failure.code === 'OPENING_REMAINDER_FINALIZATION_REQUIRED');
    check('the increased 60% fill is retained before cancellation finalizes', drifting.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 0.6);
    check('the lifecycle records cancellation is required without adding a send port', drifting.snapshot().openingLegs.SPOT.lifecycle === 'CANCEL_PENDING' && drifting.snapshot().eventLog.some((event) => event.type === 'LEG_CANCEL_REQUESTED' && event.phase === 'OPEN' && event.legKey === 'SPOT'));
    check('no dependent hedge is submitted while the opening remainder can still fill', !driftingPorts.calls.some((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'PERP'));
    const pendingRecs = recommendExecutionRecovery(drifting.snapshot(), driftingClock.nowMs());
    check('working remainder stays an explicit risk-reducing recovery concern', pendingRecs.some((r) => r.action === 'CANCEL_REMAINDER' && r.legKey === 'SPOT') && pendingRecs.every((r) => r.riskEffect !== 'RISK_INCREASING'));
    const cancelPendingState = drifting.snapshot();
    const terminalizedForReducer = reduceExecutionEvent(
      cancelPendingState,
      createExecutionEvent(
        cancelPendingState.plan.planId,
        cancelPendingState.lastSequence + 1,
        driftingClock.nowMs(),
        'LEG_CANCELLED',
        { phase: 'OPEN', legKey: 'SPOT', venueOrderId: 'drifting-spot', cumulativeFilledQuantity: 0.7 },
      ),
    );
    assert.equal(terminalizedForReducer.applied, true);
    const staleHedge = reduceExecutionEvent(
      terminalizedForReducer.state,
      createExecutionEvent(
        terminalizedForReducer.state.plan.planId,
        terminalizedForReducer.state.lastSequence + 1,
        driftingClock.nowMs(),
        'LEG_SUBMISSION_STARTED',
        { phase: 'OPEN', legKey: 'PERP', submittedQuantity: 0.8 },
      ),
    );
    check('pure reducer rejects a hedge sized from a stale pre-finalization partial', !staleHedge.applied && staleHedge.reason === 'INVALID_LEG_TRANSITION');
    const exactHedge = reduceExecutionEvent(
      terminalizedForReducer.state,
      createExecutionEvent(
        terminalizedForReducer.state.plan.planId,
        terminalizedForReducer.state.lastSequence + 1,
        driftingClock.nowMs(),
        'LEG_SUBMISSION_STARTED',
        { phase: 'OPEN', legKey: 'PERP', submittedQuantity: 1.4 },
      ),
    );
    check('pure reducer accepts only the hedge sized from terminal final fill truth', exactHedge.applied);
    const pendingUpdate = await drifting.submitNextOpeningLeg();
    check('cancel-pending refresh retains a newer partial fill without advancing', !pendingUpdate.ok && pendingUpdate.failure.code === 'WORKING_ORDER_FINALIZATION_PENDING' && drifting.snapshot().openingLegs.SPOT.lifecycle === 'CANCEL_PENDING' && drifting.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 0.65);
    const blockedClose = await drifting.requestClose();
    check('close sizing is blocked while an opening remainder can still fill', !blockedClose.ok && blockedClose.failure.code === 'OPENING_ORDER_NOT_FINAL' && !driftingPorts.calls.some((c) => c.method === 'submitPaper' && c.request.phase === 'CLOSE'));
    const finalized = await drifting.submitNextOpeningLeg();
    check('terminal cancellation refresh permits progression', finalized.ok && drifting.snapshot().openingLegs.SPOT.lifecycle === 'CANCELLED');
    check('hedge uses the final 70% opening fill after the cancel/fill race', driftingPorts.calls.some((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'PERP' && Math.abs(c.request.leg.quantity - 1.4) < 1e-12));
    check('finalized partial and dependent hedge are normalized exactly', drifting.snapshot().lifecycle === 'HEDGED_OPEN');

    const concurrentLookup = deferred();
    const concurrentPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'PARTIALLY_FILLED', venueOrderId: 'concurrent-spot', cumulativeFilledQuantity: 0.4 })
      .queueLookup('OPEN:SPOT', concurrentLookup.promise, {
        kind: 'FOUND', status: 'CANCELLED', venueOrderId: 'concurrent-spot', cumulativeFilledQuantity: 0.7,
      });
    const { coordinator: concurrent, clock: concurrentClock } = await readyCoordinator({}, concurrentPorts);
    assert.equal((await concurrent.submitNextOpeningLeg()).ok, true);
    const concurrentProgressA = concurrent.submitNextOpeningLeg();
    const concurrentProgressB = concurrent.submitNextOpeningLeg();
    for (let i = 0; i < 6 && !concurrentPorts.calls.some((c) => c.method === 'lookupByClientOrderId'); i += 1) {
      await Promise.resolve();
    }
    check('concurrent progression shares one predecessor lookup', concurrentPorts.calls.filter((c) => c.method === 'lookupByClientOrderId' && c.request.phase === 'OPEN' && c.request.leg.key === 'SPOT').length === 1);
    concurrentLookup.resolve({
      kind: 'FOUND', status: 'CANCELLED', venueOrderId: 'concurrent-spot', cumulativeFilledQuantity: 0.6,
    });
    const [concurrentResultA, concurrentResultB] = await Promise.all([concurrentProgressA, concurrentProgressB]);
    check('concurrent progression produces one hedge from one terminal fact', concurrentResultA.ok && concurrentResultB.ok && concurrentPorts.calls.filter((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'PERP' && Math.abs(c.request.leg.quantity - 1.2) < 1e-12).length === 1);
    const concurrentState = concurrent.snapshot();
    const lateTerminalRewrite = reduceExecutionEvent(
      concurrentState,
      createExecutionEvent(
        concurrentState.plan.planId,
        concurrentState.lastSequence + 1,
        concurrentClock.nowMs(),
        'LEG_CANCELLED',
        { phase: 'OPEN', legKey: 'SPOT', venueOrderId: 'concurrent-spot', cumulativeFilledQuantity: 0.7 },
      ),
    );
    check('pure reducer makes a terminal predecessor fill immutable after hedge sizing', !lateTerminalRewrite.applied && lateTerminalRewrite.reason === 'INVALID_LEG_TRANSITION');

    const lifecycleRaceLookup = deferred();
    const lifecycleRacePorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'PARTIALLY_FILLED', venueOrderId: 'race-spot', cumulativeFilledQuantity: 0.4 })
      .queueLookup('OPEN:SPOT', lifecycleRaceLookup.promise);
    lifecycleRacePorts.reconciliations.push({
      kind: 'UNRESOLVED', failure: portFailure('RACE_RECONCILIATION_UNRESOLVED'),
    });
    const { coordinator: lifecycleRace } = await readyCoordinator({}, lifecycleRacePorts);
    assert.equal((await lifecycleRace.submitNextOpeningLeg()).ok, true);
    const racedProgress = lifecycleRace.submitNextOpeningLeg();
    for (let i = 0; i < 6 && !lifecycleRacePorts.calls.some((c) => c.method === 'lookupByClientOrderId'); i += 1) {
      await Promise.resolve();
    }
    const racedReconciliation = await lifecycleRace.reconcile();
    check('concurrent reconciliation can durably move the plan to recovery while refresh waits', !racedReconciliation.ok && lifecycleRace.snapshot().lifecycle === 'RECOVERY_REQUIRED');
    lifecycleRaceLookup.resolve({
      kind: 'FOUND', status: 'CANCELLED', venueOrderId: 'race-spot', cumulativeFilledQuantity: 0.6,
    });
    const racedResult = await racedProgress;
    check('post-refresh lifecycle gate blocks a hedge after concurrent recovery transition', !racedResult.ok && racedResult.failure.code === 'OPENING_PROGRESS_STATE_CHANGED' && !lifecycleRacePorts.calls.some((c) => c.method === 'submitPaper' && c.request.leg.key === 'PERP'));

    const rejectPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'FILLED', venueOrderId: 'paper-spot', cumulativeFilledQuantity: 1 })
      .queueSubmission('OPEN:PERP', { kind: 'REJECTED', failure: portFailure('SECOND_LEG_REJECTED') });
    const { coordinator: rejected } = await readyCoordinator({}, rejectPorts);
    const rejectedResult = await rejected.open();
    check('second-leg reject returns its failure', !rejectedResult.ok && rejectedResult.failure.code === 'SECOND_LEG_REJECTED');
    check('filled first + rejected second is ONE_LEG_EXPOSED', rejected.snapshot().lifecycle === 'ONE_LEG_EXPOSED');
    check('second-leg rejection names retained exposure state', !rejectedResult.ok && rejectedResult.failure.safeCurrentState === rejected.snapshot().lifecycle);
    check('failed second leg does not erase first fill', rejected.snapshot().openingLegs.SPOT.lifecycle === 'FILLED' && rejected.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 1);
  }

  section('9. Lost acknowledgement: evidence-backed resolution and unresolved recovery');
  {
    const resolvedPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'AMBIGUOUS', failure: portFailure('RESPONSE_LOST') })
      .queueLookup('OPEN:SPOT', {
        kind: 'FOUND', status: 'FILLED', venueOrderId: 'venue-found', cumulativeFilledQuantity: 1,
      });
    const { coordinator: resolved } = await readyCoordinator({}, resolvedPorts);
    const resolvedResult = await resolved.open();
    check('lost acknowledgement resolves through client-order lookup', resolvedResult.ok && resolved.snapshot().lifecycle === 'HEDGED_OPEN');
    check('ambiguous leg resolves to FILLED', resolved.snapshot().openingLegs.SPOT.lifecycle === 'FILLED');
    check('lookup uses the deterministic submitted client ID', (() => {
      const submit = resolvedPorts.calls.find((c) => c.method === 'submitPaper' && c.request.leg.key === 'SPOT');
      const lookup = resolvedPorts.calls.find((c) => c.method === 'lookupByClientOrderId' && c.request.leg.key === 'SPOT');
      return submit?.request.leg.clientOrderId === lookup?.request.leg.clientOrderId;
    })());
    check('ambiguity evidence remains in the event log after resolution', resolved.snapshot().eventLog.some((e) => e.type === 'LEG_RESPONSE_AMBIGUOUS') && resolved.snapshot().eventLog.some((e) => e.type === 'LEG_AMBIGUITY_RESOLVED'));

    const unresolvedPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', 'THROW')
      .queueLookup('OPEN:SPOT', { kind: 'UNRESOLVED', failure: portFailure('LOOKUP_UNAVAILABLE') });
    const { coordinator: unresolved, clock } = await readyCoordinator({}, unresolvedPorts);
    const unresolvedResult = await unresolved.open();
    check('thrown submission becomes AMBIGUOUS, never rejected/success', !unresolvedResult.ok && unresolved.snapshot().openingLegs.SPOT.lifecycle === 'AMBIGUOUS');
    check('unresolved lookup escalates RECOVERY_REQUIRED', unresolved.snapshot().lifecycle === 'RECOVERY_REQUIRED');
    check('unresolved lookup failure names recovery state', !unresolvedResult.ok && unresolvedResult.failure.safeCurrentState === unresolved.snapshot().lifecycle);
    check('unknown first leg blocks second risk-increasing submission', !unresolvedPorts.calls.some((c) => c.method === 'submitPaper' && c.request.leg.key === 'PERP'));
    const recs = recommendExecutionRecovery(unresolved.snapshot(), clock.nowMs());
    check('recovery names exact ambiguous client-order ID', recs.some((r) => r.action === 'VERIFY_AMBIGUOUS_ORDER' && r.clientOrderId === unresolved.snapshot().openingLegs.SPOT.definition.clientOrderId));
    const unresolvedState = unresolved.snapshot();
    const forgedAckWithFill = reduceExecutionEvent(
      unresolvedState,
      createExecutionEvent(
        unresolvedState.plan.planId,
        unresolvedState.lastSequence + 1,
        clock.nowMs(),
        'LEG_AMBIGUITY_RESOLVED',
        {
          phase: 'OPEN', legKey: 'SPOT', ambiguityResolution: 'ACKNOWLEDGED',
          venueOrderId: 'forged-ack', cumulativeFilledQuantity: 0.25,
        },
      ),
    );
    check('pure reducer rejects an acknowledgement that hides positive fill evidence', !forgedAckWithFill.applied && forgedAckWithFill.reason === 'INVALID_EVENT');
    const forgedAckCheckpoint = JSON.parse(unresolved.checkpoint());
    const forgedAckEvent = createExecutionEvent(
      unresolvedState.plan.planId,
      unresolvedState.lastSequence + 1,
      clock.nowMs(),
      'LEG_AMBIGUITY_RESOLVED',
      {
        phase: 'OPEN', legKey: 'SPOT', ambiguityResolution: 'ACKNOWLEDGED',
        venueOrderId: 'forged-checkpoint-ack', cumulativeFilledQuantity: 0.25,
      },
    );
    forgedAckCheckpoint.state.eventLog.push(forgedAckEvent);
    forgedAckCheckpoint.state.processedEventIds.push(forgedAckEvent.eventId);
    forgedAckCheckpoint.state.lastSequence = forgedAckEvent.sequence;
    forgedAckCheckpoint.state.revision += 1;
    forgedAckCheckpoint.revision = forgedAckCheckpoint.state.revision;
    const forgedAckRestore = restoreExecutionCheckpoint(resignCheckpointObject(forgedAckCheckpoint));
    check('checkpoint replay rejects an acknowledgement that hides positive fill evidence', !forgedAckRestore.ok && forgedAckRestore.code === 'CHECKPOINT_STATE_INVALID');
    const cancelled = unresolved.cancel();
    check('ambiguous exposure cannot be silently cancelled', !cancelled.ok && cancelled.failure.code === 'UNRESOLVED_EXPOSURE');

    const absentPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'AMBIGUOUS', failure: portFailure('RESPONSE_LOST_ABSENT') })
      .queueLookup('OPEN:SPOT', { kind: 'PROVEN_ABSENT', failure: portFailure('ORDER_PROVEN_ABSENT') });
    const { coordinator: provenAbsent } = await readyCoordinator({}, absentPorts);
    const absentResult = await provenAbsent.open();
    check('read-only lookup can prove an ambiguous first order absent', !absentResult.ok && absentResult.failure.code === 'ORDER_PROVEN_ABSENT');
    check('proven-absent first order exits OPENING as FAILED', provenAbsent.snapshot().lifecycle === 'FAILED');
    check('proven-absent failure names post-transition FAILED state', !absentResult.ok && absentResult.failure.safeCurrentState === provenAbsent.snapshot().lifecycle);
    check('proven-absent first order never permits second-leg submission', !absentPorts.calls.some((call) => call.method === 'submitPaper' && call.request.leg.key === 'PERP'));

    const cancelledFillPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'AMBIGUOUS', failure: portFailure('RESPONSE_LOST_CANCELLED') })
      .queueLookup('OPEN:SPOT', {
        kind: 'FOUND', status: 'CANCELLED', venueOrderId: 'venue-cancelled', cumulativeFilledQuantity: 0.4,
      })
      .queueSubmission('OPEN:PERP', {
        kind: 'FILLED', venueOrderId: 'paper-scaled-hedge', cumulativeFilledQuantity: 0.8,
      });
    const { coordinator: cancelledFill } = await readyCoordinator({}, cancelledFillPorts);
    const cancelledFillResult = await cancelledFill.open();
    check('lookup CANCELLED preserves its cumulative partial fill', cancelledFillResult.ok && cancelledFill.snapshot().openingLegs.SPOT.lifecycle === 'CANCELLED' && cancelledFill.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 0.4);
    check('cancelled partial is hedged only at matching normalized size', cancelledFill.snapshot().lifecycle === 'HEDGED_OPEN' && cancelledFill.snapshot().openingLegs.PERP.cumulativeFilledQuantity === 0.8);
    check('cancelled-partial hedge request is scaled, never full-size', cancelledFillPorts.calls.some((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'PERP' && c.request.leg.quantity === 0.8));
  }

  section('10. Naked-duration expiry and emergency close');
  {
    const ports = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'FILLED', venueOrderId: 'paper-spot', cumulativeFilledQuantity: 1 })
      .queueSubmission('OPEN:PERP', { kind: 'REJECTED', failure: portFailure('HEDGE_REJECTED') });
    const { coordinator, clock } = await readyCoordinator({ maxNakedDurationMs: 1_000 }, ports);
    await coordinator.open();
    const exposedAt = coordinator.snapshot().exposedSinceMs;
    clock.set(exposedAt + 999);
    check('before naked deadline state remains exposed', coordinator.evaluateNakedDuration().ok && coordinator.snapshot().lifecycle === 'ONE_LEG_EXPOSED');
    clock.advance(1);
    check('exact naked deadline becomes RECOVERY_REQUIRED', coordinator.evaluateNakedDuration().ok && coordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED');
    const closed = await coordinator.close(true);
    check('emergency close is allowed from recovery state', closed.ok && coordinator.snapshot().lifecycle === 'CLOSED');
    check('emergency flag is auditable in event stream', coordinator.snapshot().eventLog.some((e) => e.type === 'CLOSE_REQUESTED' && e.emergency === true));
    const closeSubmits = ports.calls.filter((c) => c.method === 'submitPaper' && c.request.phase === 'CLOSE');
    check('emergency closes only the known exposed leg', closeSubmits.length === 1 && closeSubmits[0].request.leg.key === 'SPOT');
    check('emergency submission remains risk-reducing', closeSubmits.every((c) => c.request.leg.riskEffect === 'RISK_REDUCING'));
  }

  section('10b. In-flight cancellation and naked deadlines cannot erase exposure');
  {
    const inFlight = deferred();
    const inFlightPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', () => inFlight.promise)
      .queueSubmission('OPEN:PERP', { kind: 'REJECTED', failure: portFailure('SECOND_AFTER_INFLIGHT_REJECTED') });
    const { coordinator: inFlightCoordinator } = await readyCoordinator({}, inFlightPorts);
    const openingPromise = inFlightCoordinator.open();
    await Promise.resolve();
    check('first leg is visibly SUBMITTING while port promise is pending', inFlightCoordinator.snapshot().openingLegs.SPOT.lifecycle === 'SUBMITTING');
    const pendingState = inFlightCoordinator.snapshot();
    const forgedCancel = reduceExecutionEvent(
      pendingState,
      createExecutionEvent(pendingState.plan.planId, pendingState.lastSequence + 1, T0, 'PLAN_CANCELLED'),
    );
    check('pure reducer rejects terminal cancellation with active order', !forgedCancel.applied && forgedCancel.reason === 'UNRESOLVED_EXPOSURE');
    const cancelWhileSubmitting = inFlightCoordinator.cancel();
    check('coordinator rejects cancel while SUBMITTING', !cancelWhileSubmitting.ok && cancelWhileSubmitting.failure.code === 'UNRESOLVED_EXPOSURE');
    inFlight.resolve({ kind: 'FILLED', venueOrderId: 'late-fill', cumulativeFilledQuantity: 1 });
    await openingPromise;
    check('late fill remains recorded after rejected cancellation', inFlightCoordinator.snapshot().lifecycle !== 'CANCELLED' && inFlightCoordinator.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 1);

    const ackPorts = new FakePorts().queueSubmission('OPEN:SPOT', { kind: 'ACKNOWLEDGED', venueOrderId: 'working-zero-fill' });
    const { coordinator: acknowledged } = await readyCoordinator({}, ackPorts);
    const acknowledgedResult = await acknowledged.open();
    check('acknowledged zero-fill order is looked up and cannot advance the hedge', !acknowledgedResult.ok && ackPorts.calls.some((call) => call.method === 'lookupByClientOrderId' && call.request.leg.key === 'SPOT') && !ackPorts.calls.some((call) => call.method === 'submitPaper' && call.request.leg.key === 'PERP'));
    const cancelAcknowledged = acknowledged.cancel();
    check('unresolved acknowledged order remains recovery truth and blocks cancellation', !cancelAcknowledged.ok && acknowledged.snapshot().openingLegs.SPOT.lifecycle === 'AMBIGUOUS' && acknowledged.snapshot().lifecycle === 'RECOVERY_REQUIRED');

    const cancelAckPorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'ACKNOWLEDGED', venueOrderId: 'cancel-ack' })
      .queueLookup('OPEN:SPOT', {
        kind: 'FOUND', status: 'ACKNOWLEDGED', venueOrderId: 'cancel-ack', cumulativeFilledQuantity: 0,
      }, {
        kind: 'FOUND', status: 'ACKNOWLEDGED', venueOrderId: 'cancel-ack', cumulativeFilledQuantity: 0,
      });
    const { coordinator: cancelAcknowledgedCoordinator } = await readyCoordinator({}, cancelAckPorts);
    const firstCancelAck = await cancelAcknowledgedCoordinator.open();
    const secondCancelAck = await cancelAcknowledgedCoordinator.submitNextOpeningLeg();
    check('cancel-pending zero-fill acknowledgement remains a named finalization wait', !firstCancelAck.ok && !secondCancelAck.ok && secondCancelAck.failure.code === 'WORKING_ORDER_FINALIZATION_PENDING' && cancelAcknowledgedCoordinator.snapshot().openingLegs.SPOT.lifecycle === 'CANCEL_PENDING' && !cancelAckPorts.calls.some((call) => call.method === 'submitPaper' && call.request.leg.key === 'PERP'));

    const deadlineDeferred = deferred();
    const deadlineClock = new ManualClock();
    const deadlinePorts = new FakePorts().queueSubmission('OPEN:SPOT', () => deadlineDeferred.promise);
    const { coordinator: deadlineCoordinator } = await readyCoordinator({ maxNakedDurationMs: 100 }, deadlinePorts, deadlineClock);
    const deadlineOpen = deadlineCoordinator.open();
    await Promise.resolve();
    check('naked timer starts at submission, before response receipt', deadlineCoordinator.snapshot().exposedSinceMs === T0);
    deadlineClock.advance(100);
    deadlineDeferred.resolve({ kind: 'FILLED', venueOrderId: 'delayed-first-fill', cumulativeFilledQuantity: 1 });
    const deadlineResult = await deadlineOpen;
    check('elapsed naked deadline blocks second leg after first response', !deadlineResult.ok && deadlineResult.failure.code === 'NAKED_DURATION_EXPIRED' && deadlineCoordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED');
    check('naked-deadline failure names recovery state', !deadlineResult.ok && deadlineResult.failure.safeCurrentState === deadlineCoordinator.snapshot().lifecycle);
    check('deadline breach submits no second risk-increasing leg', !deadlinePorts.calls.some((c) => c.method === 'submitPaper' && c.request.leg.key === 'PERP'));
  }

  section('10c. Over-close is divergent and partial close can progress by read-only refresh');
  {
    const overClosePorts = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'FILLED', venueOrderId: 'open-spot', cumulativeFilledQuantity: 1 })
      .queueSubmission('OPEN:PERP', { kind: 'REJECTED', failure: portFailure('OPEN_HEDGE_REJECTED') })
      .queueSubmission('CLOSE:SPOT', { kind: 'FILLED', venueOrderId: 'bad-over-close', cumulativeFilledQuantity: 2 });
    const { coordinator: overClose } = await readyCoordinator({}, overClosePorts);
    await overClose.open();
    const overCloseResult = await overClose.close(true);
    check('over-close quantity is rejected as an ambiguous invalid outcome', !overCloseResult.ok && overCloseResult.failure.code === 'SUBMISSION_OUTCOME_INVALID');
    check('over-close never reduces retained exposure', overClose.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 1 && overClose.snapshot().closingLegs.SPOT.cumulativeFilledQuantity === 0);
    check('over-close cannot falsely reconcile CLOSED', overClose.snapshot().lifecycle === 'RECOVERY_REQUIRED' && !overClosePorts.calls.some((c) => c.method === 'reconcile'));

    const partialClosePorts = new FakePorts()
      .queueSubmission('CLOSE:SPOT', { kind: 'PARTIALLY_FILLED', venueOrderId: 'partial-close-spot', cumulativeFilledQuantity: 0.4 });
    const { coordinator: partialClose } = await readyCoordinator({}, partialClosePorts);
    await partialClose.open();
    const firstClose = await partialClose.close();
    check('partial close remains explicitly incomplete', !firstClose.ok && firstClose.failure.code === 'CLOSE_INCOMPLETE' && partialClose.snapshot().closingLegs.SPOT.lifecycle === 'PARTIALLY_FILLED');
    partialClosePorts.queueLookup('CLOSE:SPOT', {
      kind: 'FOUND', status: 'FILLED', venueOrderId: 'partial-close-spot', cumulativeFilledQuantity: 1,
    });
    const retriedClose = await partialClose.close();
    check('partial close progresses through read-only client-order refresh', retriedClose.ok && partialClose.snapshot().lifecycle === 'CLOSED');
    check('partial close is submitted once, never duplicated', partialClosePorts.calls.filter((c) => c.method === 'submitPaper' && c.request.phase === 'CLOSE' && c.request.leg.key === 'SPOT').length === 1);
    check('partial close retry uses lookup on the same client-order ID', partialClosePorts.calls.some((c) => c.method === 'lookupByClientOrderId' && c.request.phase === 'CLOSE' && c.request.leg.clientOrderId === partialClose.snapshot().closingLegs.SPOT.definition.clientOrderId));
  }

  section('11. Restart between legs and deterministic checkpoint restore');
  {
    const preCrashPorts = new FakePorts();
    const { coordinator, clock } = await readyCoordinator({}, preCrashPorts);
    coordinator.beginOpen();
    const first = await coordinator.submitNextOpeningLeg();
    check('first leg can checkpoint before second leg', first.ok && coordinator.snapshot().lifecycle === 'ONE_LEG_EXPOSED');
    const bytes1 = coordinator.checkpoint();
    const bytes2 = coordinator.checkpoint();
    check('same state yields byte-identical checkpoint', bytes1 === bytes2);
    const coldPorts = new FakePorts()
      .queueLookup('OPEN:SPOT', {
        kind: 'FOUND', status: 'FILLED', venueOrderId: 'paper-OPEN-SPOT', cumulativeFilledQuantity: 1,
      });
    coldPorts.reconciliations.push({ kind: 'ONE_LEG_EXPOSED' });
    const restoredResult = restoreExecutionCoordinator(bytes1, clock, coldPorts);
    assert.equal(restoredResult.ok, true);
    const restored = restoredResult.coordinator;
    check('checkpoint restore preserves exact state', canonicalJson(restored.snapshot()) === canonicalJson(coordinator.snapshot()));
    check('checkpoint restore preserves one correlation ID', restored.snapshot().plan.correlationId === coordinator.snapshot().plan.correlationId);
    const resumed = await restored.submitNextOpeningLeg();
    check('cold restart resumes second leg without resubmitting first', resumed.ok && restored.snapshot().lifecycle === 'HEDGED_OPEN' && !coldPorts.calls.some((c) => c.method === 'submitPaper' && c.request.leg.key === 'SPOT'));
    const coldLookupIndex = coldPorts.calls.findIndex((c) => c.method === 'lookupByClientOrderId' && c.request.phase === 'OPEN' && c.request.leg.key === 'SPOT');
    const coldReconcileIndex = coldPorts.calls.findIndex((c) => c.method === 'reconcile');
    const coldHedgeIndex = coldPorts.calls.findIndex((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'PERP');
    check('cold restart hydrates owner order truth before aggregate reconciliation', coldLookupIndex >= 0 && coldReconcileIndex > coldLookupIndex);
    check('cold restart reconciles before dependent hedge progression', coldHedgeIndex > coldReconcileIndex);
    check('first client-order ID is submitted exactly once across fresh processes', preCrashPorts.calls.filter((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'SPOT').length === 1 && !coldPorts.calls.some((c) => c.method === 'submitPaper' && c.request.leg.key === 'SPOT'));

    const unresolvedPorts = new FakePorts();
    unresolvedPorts.reconciliations.push({ kind: 'ONE_LEG_EXPOSED' });
    const unresolvedRestore = restoreExecutionCoordinator(bytes1, clock, unresolvedPorts);
    assert.equal(unresolvedRestore.ok, true);
    const unresolvedRecovery = await unresolvedRestore.coordinator.submitNextOpeningLeg();
    check('unresolved cold lookup cannot fall through to stale checkpoint hedge sizing', !unresolvedRecovery.ok && unresolvedRecovery.failure.code === 'LOOKUP_UNRESOLVED' && unresolvedRestore.coordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED' && unresolvedRestore.coordinator.restartRecoveryRequired());
    check('unresolved terminal lookup is durable and blocks aggregate fallthrough', unresolvedRestore.coordinator.snapshot().eventLog.some((event) => event.type === 'RESTART_RECOVERY_BLOCKED' && event.phase === 'OPEN' && event.legKey === 'SPOT' && event.failure?.code === 'LOOKUP_UNRESOLVED') && !unresolvedPorts.calls.some((c) => c.method === 'reconcile' || c.method === 'submitPaper'));
    const unresolvedRoundTrip = restoreExecutionCheckpoint(unresolvedRestore.coordinator.checkpoint());
    check('restart lookup failure survives deterministic checkpoint replay', unresolvedRoundTrip.ok && canonicalJson(unresolvedRoundTrip.state) === canonicalJson(unresolvedRestore.coordinator.snapshot()));

    const malformedTerminalPorts = new FakePorts().queueLookup('OPEN:SPOT', {
      kind: 'FOUND', status: 'REJECTED', venueOrderId: null, cumulativeFilledQuantity: 0.5,
      failure: portFailure('MALFORMED_REJECTED_WITH_FILL'),
    });
    const malformedTerminalRestore = restoreExecutionCoordinator(bytes1, clock, malformedTerminalPorts);
    assert.equal(malformedTerminalRestore.ok, true);
    const malformedTerminalRecovery = await malformedTerminalRestore.coordinator.submitNextOpeningLeg();
    check('malformed restart status/fill pair cannot erase checkpoint exposure', !malformedTerminalRecovery.ok && malformedTerminalRecovery.failure.code === 'LOOKUP_OUTCOME_INVALID' && malformedTerminalRestore.coordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED' && malformedTerminalRestore.coordinator.snapshot().openingLegs.SPOT.lifecycle === 'FILLED' && malformedTerminalRestore.coordinator.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 1 && !malformedTerminalPorts.calls.some((call) => call.method === 'submitPaper'));

    const nullTerminalPorts = new FakePorts().queueLookup('OPEN:SPOT', null);
    const nullTerminalRestore = restoreExecutionCoordinator(bytes1, clock, nullTerminalPorts);
    assert.equal(nullTerminalRestore.ok, true);
    const nullTerminalRecovery = await nullTerminalRestore.coordinator.submitNextOpeningLeg();
    check('null restart lookup fails durably without erasing checkpoint exposure', !nullTerminalRecovery.ok && nullTerminalRecovery.failure.code === 'LOOKUP_OUTCOME_INVALID' && nullTerminalRestore.coordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED' && nullTerminalRestore.coordinator.snapshot().openingLegs.SPOT.lifecycle === 'FILLED' && nullTerminalRestore.coordinator.snapshot().openingLegs.SPOT.cumulativeFilledQuantity === 1 && !nullTerminalPorts.calls.some((call) => call.method === 'reconcile' || call.method === 'submitPaper'));

    const checkpoint = createExecutionCheckpoint(restored.snapshot());
    check('checkpoint schema and revision are explicit', checkpoint.schema === 'cosmos.foundation.execution.checkpoint' && checkpoint.version === 1 && checkpoint.revision === restored.snapshot().revision);
    const directRestore = restoreExecutionCheckpoint(serializeExecutionCheckpoint(restored.snapshot()));
    check('direct checkpoint round-trip replays successfully', directRestore.ok && canonicalJson(directRestore.state) === canonicalJson(restored.snapshot()));

    const corrupt = JSON.parse(bytes1);
    corrupt.state.lifecycle = 'FAILED';
    const corruptResult = restoreExecutionCheckpoint(JSON.stringify(corrupt));
    check('payload mutation fails checksum', !corruptResult.ok && corruptResult.code === 'CHECKPOINT_CHECKSUM_MISMATCH');

    const replayMismatch = JSON.parse(bytes1);
    replayMismatch.state.lifecycle = 'FAILED';
    const { checksum: _old, ...payload } = replayMismatch;
    replayMismatch.checksum = stableHash128Hex(canonicalJson(payload));
    const replayMismatchResult = restoreExecutionCheckpoint(canonicalJson(replayMismatch));
    check('checksum-valid state forgery fails deterministic replay', !replayMismatchResult.ok && replayMismatchResult.code === 'CHECKPOINT_REPLAY_MISMATCH');
  }

  section('11a. Cold restart recovers SUBMITTING and pre-venue proven-absent cuts');
  {
    const pendingResponse = deferred();
    const preCrashPorts = new FakePorts().queueSubmission('OPEN:SPOT', () => pendingResponse.promise);
    const { coordinator: preCrash, clock } = await readyCoordinator({}, preCrashPorts);
    const preCrashOpen = preCrash.open();
    await Promise.resolve();
    check('crash-cut fixture checkpoints the first opening leg in SUBMITTING', preCrash.snapshot().openingLegs.SPOT.lifecycle === 'SUBMITTING');
    const pendingCheckpoint = preCrash.checkpoint();

    const coldPorts = new FakePorts()
      .queueLookup('OPEN:SPOT', {
        kind: 'FOUND', status: 'FILLED', venueOrderId: 'cold-found-fill', cumulativeFilledQuantity: 1,
      });
    coldPorts.reconciliations.push({ kind: 'ONE_LEG_EXPOSED' });
    const coldRestore = restoreExecutionCoordinator(pendingCheckpoint, clock, coldPorts);
    assert.equal(coldRestore.ok, true);
    const coldResumeA = coldRestore.coordinator.submitNextOpeningLeg();
    const coldResumeB = coldRestore.coordinator.submitNextOpeningLeg();
    const [coldResumed, coldResumedConcurrent] = await Promise.all([coldResumeA, coldResumeB]);
    check('restored SUBMITTING resolves by deterministic client-order lookup', coldResumed.ok && coldResumedConcurrent.ok && coldRestore.coordinator.snapshot().openingLegs.SPOT.lifecycle === 'FILLED');
    const submittingLookupIndex = coldPorts.calls.findIndex((c) => c.method === 'lookupByClientOrderId' && c.request.phase === 'OPEN' && c.request.leg.key === 'SPOT');
    const submittingReconcileIndex = coldPorts.calls.findIndex((c) => c.method === 'reconcile');
    const submittingHedgeIndex = coldPorts.calls.findIndex((c) => c.method === 'submitPaper' && c.request.phase === 'OPEN' && c.request.leg.key === 'PERP');
    check('SUBMITTING recovery orders lookup then reconcile then hedge', submittingLookupIndex >= 0 && submittingReconcileIndex > submittingLookupIndex && submittingHedgeIndex > submittingReconcileIndex);
    check('concurrent restart progression is single-flight through owner recovery', coldPorts.calls.filter((c) => c.method === 'lookupByClientOrderId' && c.request.leg.key === 'SPOT').length === 1 && coldPorts.calls.filter((c) => c.method === 'reconcile').length === 1 && coldPorts.calls.filter((c) => c.method === 'submitPaper' && c.request.leg.key === 'PERP').length === 1);
    check('fresh restart ports contain no pre-crash observation or first-leg resubmit', !coldPorts.calls.some((c) => c.method === 'submitPaper' && c.request.leg.key === 'SPOT'));
    check('pre-ack uncertainty is durable before lookup resolution', coldRestore.coordinator.snapshot().eventLog.some((event) => event.type === 'LEG_RESPONSE_AMBIGUOUS' && event.failure?.code === 'RESTART_PRE_ACK_OUTCOME_UNKNOWN'));

    const malformedColdPorts = new FakePorts().queueLookup('OPEN:SPOT', {
      kind: 'FOUND', status: 'REJECTED', venueOrderId: null, cumulativeFilledQuantity: 0.5,
      failure: portFailure('MALFORMED_PRE_ACK_REJECTION'),
    });
    const malformedColdRestore = restoreExecutionCoordinator(pendingCheckpoint, clock, malformedColdPorts);
    assert.equal(malformedColdRestore.ok, true);
    const malformedPreAck = await malformedColdRestore.coordinator.submitNextOpeningLeg();
    check('malformed pre-ack lookup remains ambiguous instead of fabricating zero exposure', !malformedPreAck.ok && malformedPreAck.failure.code === 'LOOKUP_OUTCOME_INVALID' && malformedColdRestore.coordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED' && malformedColdRestore.coordinator.snapshot().openingLegs.SPOT.lifecycle === 'AMBIGUOUS' && !malformedColdPorts.calls.some((call) => call.method === 'reconcile' || call.method === 'submitPaper'));

    const malformedAbsentPorts = new FakePorts().queueLookup('OPEN:SPOT', {
      kind: 'PROVEN_ABSENT', failure: null,
    });
    const malformedAbsentRestore = restoreExecutionCoordinator(pendingCheckpoint, clock, malformedAbsentPorts);
    assert.equal(malformedAbsentRestore.ok, true);
    const malformedAbsent = await malformedAbsentRestore.coordinator.submitNextOpeningLeg();
    check('malformed proven-absent evidence remains ambiguous and restart-blocked', !malformedAbsent.ok && malformedAbsent.failure.code === 'LOOKUP_OUTCOME_INVALID' && malformedAbsentRestore.coordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED' && malformedAbsentRestore.coordinator.snapshot().openingLegs.SPOT.lifecycle === 'AMBIGUOUS' && !malformedAbsentPorts.calls.some((call) => call.method === 'reconcile' || call.method === 'submitPaper'));

    const malformedFailureTextPorts = new FakePorts().queueLookup('OPEN:SPOT', {
      kind: 'PROVEN_ABSENT',
      failure: {
        code: 'ORDER_PROVEN_ABSENT_AFTER_RESTART',
        message: '   ',
        retryable: false,
        recommendedOperatorAction: 'Do not resubmit.',
      },
    });
    const malformedFailureTextRestore = restoreExecutionCoordinator(pendingCheckpoint, clock, malformedFailureTextPorts);
    assert.equal(malformedFailureTextRestore.ok, true);
    const malformedFailureText = await malformedFailureTextRestore.coordinator.submitNextOpeningLeg();
    check('malformed lookup failure text becomes durable recovery instead of a thrown promise', !malformedFailureText.ok && malformedFailureText.failure.code === 'LOOKUP_OUTCOME_INVALID' && malformedFailureTextRestore.coordinator.snapshot().lifecycle === 'RECOVERY_REQUIRED' && malformedFailureTextRestore.coordinator.snapshot().openingLegs.SPOT.lifecycle === 'AMBIGUOUS' && malformedFailureTextRestore.coordinator.snapshot().eventLog.some((event) => event.type === 'LEG_AMBIGUITY_UNRESOLVED' && event.failure?.code === 'LOOKUP_OUTCOME_INVALID') && !malformedFailureTextPorts.calls.some((call) => call.method === 'reconcile' || call.method === 'submitPaper'));
    pendingResponse.resolve({ kind: 'FILLED', venueOrderId: 'old-process-late-fill', cumulativeFilledQuantity: 1 });
    await preCrashOpen;

    const absentResponse = deferred();
    const absentPreCrashPorts = new FakePorts().queueSubmission('OPEN:SPOT', () => absentResponse.promise);
    const { coordinator: absentPreCrash, clock: absentClock } = await readyCoordinator({}, absentPreCrashPorts);
    const absentOldOpen = absentPreCrash.open();
    await Promise.resolve();
    const absentCheckpoint = absentPreCrash.checkpoint();
    const absentColdPorts = new FakePorts().queueLookup('OPEN:SPOT', {
      kind: 'PROVEN_ABSENT', failure: portFailure('ORDER_PROVEN_ABSENT_AFTER_RESTART'),
    });
    const absentRestore = restoreExecutionCoordinator(absentCheckpoint, absentClock, absentColdPorts);
    assert.equal(absentRestore.ok, true);
    const absentRecovery = await absentRestore.coordinator.submitNextOpeningLeg();
    const absentState = absentRestore.coordinator.snapshot();
    check('pre-venue crash proven absent remains a named non-success', !absentRecovery.ok && absentRecovery.failure.code === 'ORDER_PROVEN_ABSENT_AFTER_RESTART');
    check('proven absence is distinct from a venue rejection in durable events', absentState.eventLog.some((event) => event.type === 'LEG_AMBIGUITY_RESOLVED' && event.ambiguityResolution === 'PROVEN_ABSENT'));
    check('proven absence retains an explicit current-state disposition with null venue and zero fill truth', absentState.openingLegs.SPOT.lifecycle === 'REJECTED' && absentState.openingLegs.SPOT.lastAmbiguityResolution === 'PROVEN_ABSENT' && absentState.openingLegs.SPOT.venueOrderId === null && absentState.openingLegs.SPOT.cumulativeFilledQuantity === 0);
    check('proven-absent restart cannot progress or resubmit through fresh ports', absentState.lifecycle === 'FAILED' && !absentColdPorts.calls.some((c) => c.method === 'submitPaper'));
    const absentRoundTrip = restoreExecutionCheckpoint(absentRestore.coordinator.checkpoint());
    check('pre-venue proven-absent evidence survives checkpoint replay', absentRoundTrip.ok && canonicalJson(absentRoundTrip.state) === canonicalJson(absentState));
    absentResponse.resolve({ kind: 'REJECTED', failure: portFailure('OLD_PROCESS_NOT_ACCEPTED') });
    await absentOldOpen;
  }

  section('11b. Recomputed checksums cannot bless forbidden streams');
  {
    const { coordinator: paper } = await readyCoordinator();
    const secretForged = JSON.parse(paper.checkpoint());
    secretForged.state.eventLog[secretForged.state.eventLog.length - 1].apiKey = 'synthetic-only';
    const secretResult = restoreExecutionCheckpoint(resignCheckpointObject(secretForged));
    check('secret-bearing unknown event field is rejected despite recomputed checksum', !secretResult.ok && secretResult.code === 'CHECKPOINT_SECRET_FIELD_REJECTED');

    const unknownForged = JSON.parse(paper.checkpoint());
    unknownForged.state.eventLog[unknownForged.state.eventLog.length - 1].debugMarker = 'synthetic';
    const unknownResult = restoreExecutionCheckpoint(resignCheckpointObject(unknownForged));
    check('non-secret unknown event field is rejected by strict event schema', !unknownResult.ok && unknownResult.code === 'CHECKPOINT_STATE_INVALID');

    const validateClock = new ManualClock();
    const validatePorts = new FakePorts();
    const validate = createExecutionCoordinator(planInput({ mode: 'VALIDATE_ONLY' }), validateClock, validatePorts);
    assert.equal((await validate.preflight()).ok, true);
    const validateForged = JSON.parse(validate.checkpoint());
    const validateState = validate.snapshot();
    const forbiddenOpen = createExecutionEvent(
      validateState.plan.planId,
      validateState.lastSequence + 1,
      validateClock.nowMs(),
      'OPENING_STARTED',
    );
    validateForged.state.eventLog.push(forbiddenOpen);
    validateForged.state.processedEventIds.push(forbiddenOpen.eventId);
    validateForged.state.lastSequence = forbiddenOpen.sequence;
    validateForged.state.revision += 1;
    validateForged.revision = validateForged.state.revision;
    validateForged.state.lifecycle = 'OPENING';
    const validateRestore = restoreExecutionCheckpoint(resignCheckpointObject(validateForged));
    check('VALIDATE_ONLY forged submission stream is rejected on checkpoint replay', !validateRestore.ok && validateRestore.code === 'CHECKPOINT_STATE_INVALID');
  }

  section('12. Reducer cannot close or cancel unresolved exposure');
  {
    const ports = new FakePorts()
      .queueSubmission('OPEN:SPOT', { kind: 'FILLED', venueOrderId: 'paper-spot', cumulativeFilledQuantity: 1 })
      .queueSubmission('OPEN:PERP', { kind: 'REJECTED', failure: portFailure('SECOND_REJECT') });
    const { coordinator } = await readyCoordinator({}, ports);
    await coordinator.open();
    const state = coordinator.snapshot();
    const cancelEvent = createExecutionEvent(state.plan.planId, state.lastSequence + 1, state.updatedAtMs + 1, 'PLAN_CANCELLED');
    const cancelled = reduceExecutionEvent(state, cancelEvent);
    check('pure reducer rejects cancellation with known exposure', !cancelled.applied && cancelled.reason === 'UNRESOLVED_EXPOSURE');
    check('exposure evidence survives rejected cancellation', cancelled.state.openingLegs.SPOT.cumulativeFilledQuantity === 1);
    check('all recorded failures retain plan correlation ID', state.failures.every((failure) => failure.correlationId === state.plan.correlationId));
  }

  section('13. No concrete transport or network is reachable');
  {
    check('test attempted no network request', networkAttempts === 0);
    const sourceMethods = Object.getOwnPropertyNames(FakePorts.prototype);
    check('only injected fake submission boundary exists', sourceMethods.includes('submitPaper') && !sourceMethods.some((name) => /live|placeOrder/i.test(name)));
  }
} finally {
  globalThis.fetch = originalFetch;
}

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed}/${results.length} execution checks passed`);
if (failed > 0) process.exit(1);
