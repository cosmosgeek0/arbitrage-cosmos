import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEG_LIFECYCLES,
  PLAN_LIFECYCLES,
  canonicalJson,
} from '../../../dist/foundation/contracts/index.js';
import {
  createExecutionCoordinator,
  restoreExecutionCheckpoint,
  restoreExecutionCoordinator,
  serializeExecutionCheckpoint,
} from '../../../dist/foundation/execution/index.js';

const T0 = 1_800_000_000_000;

class ManualClock {
  constructor(nowMs = T0) { this.value = nowMs; this.deadlines = []; }
  nowMs() { return this.value; }
  schedule(delayMs, task) {
    const deadline = { dueAtMs: this.value + delayMs, task, cancelled: false, fired: false };
    this.deadlines.push(deadline);
    return { cancel: () => { deadline.cancelled = true; } };
  }
  set(nowMs) {
    this.value = nowMs;
    for (const deadline of this.deadlines) {
      if (!deadline.cancelled && !deadline.fired && deadline.dueAtMs <= this.value) {
        deadline.fired = true;
        deadline.task();
      }
    }
  }
}

const okPort = Object.freeze({ ok: true });
const portFailure = (code) => Object.freeze({
  code,
  message: code,
  retryable: false,
  recommendedOperatorAction: 'Inspect deterministic synthetic evidence.',
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
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

  key(request) { return `${request.phase}:${request.leg.key}`; }

  claimPlanIdentity(planId, termsFingerprint) {
    const current = this.identityClaims.get(planId);
    if (current === undefined) {
      this.identityClaims.set(planId, termsFingerprint);
      return 'CLAIMED';
    }
    return current === termsFingerprint ? 'EXISTING_SAME' : 'CONFLICT';
  }

  queueSubmission(key, ...outcomes) {
    this.submissions.set(key, [...outcomes]);
    return this;
  }

  queueLookup(key, ...outcomes) {
    this.lookups.set(key, [...outcomes]);
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
      const outcome = queue.shift();
      return typeof outcome === 'function' ? outcome(request) : outcome;
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
      const outcome = queue.shift();
      return typeof outcome === 'function' ? outcome(request) : outcome;
    }
    return { kind: 'UNRESOLVED', failure: portFailure('LOOKUP_UNRESOLVED') };
  }

  async reconcile(state) {
    this.calls.push({ method: 'reconcile', planId: state.plan.planId });
    if (this.reconciliations.length) {
      const outcome = this.reconciliations.shift();
      return typeof outcome === 'function' ? outcome(state) : outcome;
    }
    const spot = Math.max(
      0,
      state.openingLegs.SPOT.cumulativeFilledQuantity - state.closingLegs.SPOT.cumulativeFilledQuantity,
    );
    const perp = Math.max(
      0,
      state.openingLegs.PERP.cumulativeFilledQuantity - state.closingLegs.PERP.cumulativeFilledQuantity,
    );
    if (spot === 0 && perp === 0) return { kind: 'CLOSED' };
    const spotRatio = spot / state.openingLegs.SPOT.definition.quantity;
    const perpRatio = perp / state.openingLegs.PERP.definition.quantity;
    return Math.abs(spotRatio - perpRatio) < 1e-12
      ? { kind: 'HEDGED_OPEN' }
      : { kind: 'ONE_LEG_EXPOSED' };
  }
}

let proposalCounter = 0;
function planInput(label, over = {}) {
  proposalCounter += 1;
  return {
    strategy: 'BASIS',
    direction: 'LONG_SPOT_SHORT_PERP',
    symbol: 'TESTUSDT',
    proposal: {
      canonicalProposalId: `cprop_l12_all_state_${label}_${proposalCounter}`,
      observedAtMs: T0 - 100,
      maxAgeMs: 120_000,
      expiresAtMs: T0 + 60_000,
    },
    attempt: 0,
    mode: 'PAPER',
    requiresApproval: false,
    maxNakedDurationMs: 1_000,
    spotQuantity: 1,
    perpQuantity: 2,
    ...over,
  };
}

function createCoordinator(label, ports = new FakePorts(), clock = new ManualClock(), over = {}) {
  return {
    coordinator: createExecutionCoordinator(planInput(label, over), clock, ports),
    ports,
    clock,
  };
}

async function readyCoordinator(label, ports = new FakePorts(), clock = new ManualClock(), over = {}) {
  const fixture = createCoordinator(label, ports, clock, over);
  if (fixture.coordinator.snapshot().plan.requiresApproval) {
    assert.equal(fixture.coordinator.requestApproval(5_000).ok, true);
    assert.equal(fixture.coordinator.approve().ok, true);
  }
  const result = await fixture.coordinator.preflight();
  assert.equal(result.ok, true, result.ok ? undefined : result.failure.code);
  return fixture;
}

function identityAndFillEvidence(state) {
  const evidence = {};
  for (const phase of ['OPEN', 'CLOSE']) {
    const record = phase === 'OPEN' ? state.openingLegs : state.closingLegs;
    for (const key of ['SPOT', 'PERP']) {
      const leg = record[key];
      evidence[`${phase}:${key}`] = {
        legId: leg.definition.legId,
        clientOrderId: leg.definition.clientOrderId,
        submittedQuantity: leg.submittedQuantity,
        cumulativeFilledQuantity: leg.cumulativeFilledQuantity,
        venueOrderId: leg.venueOrderId,
      };
    }
  }
  return evidence;
}

function terminalLookup(leg) {
  if (leg.lifecycle === 'FILLED') {
    return {
      kind: 'FOUND',
      status: 'FILLED',
      venueOrderId: leg.venueOrderId,
      cumulativeFilledQuantity: leg.cumulativeFilledQuantity,
    };
  }
  if (leg.lifecycle === 'CANCELLED') {
    return {
      kind: 'FOUND',
      status: 'CANCELLED',
      venueOrderId: leg.venueOrderId,
      cumulativeFilledQuantity: leg.cumulativeFilledQuantity,
    };
  }
  if (leg.lifecycle === 'REJECTED') {
    if (leg.lastAmbiguityResolution === 'PROVEN_ABSENT') {
      return { kind: 'PROVEN_ABSENT', failure: portFailure('PROVEN_ABSENT') };
    }
    return {
      kind: 'FOUND',
      status: 'REJECTED',
      venueOrderId: leg.venueOrderId,
      cumulativeFilledQuantity: 0,
      failure: portFailure('REJECTED'),
    };
  }
  if (leg.lifecycle === 'ACKNOWLEDGED') {
    return {
      kind: 'FOUND',
      status: 'CANCELLED',
      venueOrderId: leg.venueOrderId,
      cumulativeFilledQuantity: 0,
    };
  }
  if (leg.lifecycle === 'PARTIALLY_FILLED' || leg.lifecycle === 'CANCEL_PENDING') {
    return {
      kind: 'FOUND',
      status: 'CANCELLED',
      venueOrderId: leg.venueOrderId,
      cumulativeFilledQuantity: leg.cumulativeFilledQuantity,
    };
  }
  if (leg.lifecycle === 'SUBMITTING' || leg.lifecycle === 'AMBIGUOUS') {
    return {
      kind: 'FOUND',
      status: 'FILLED',
      venueOrderId: `restart-${leg.definition.phase}-${leg.definition.key}`,
      cumulativeFilledQuantity: leg.submittedQuantity,
    };
  }
  throw new Error(`submitted leg has unsupported restart lifecycle ${leg.lifecycle}`);
}

function freshRecoveryPorts(state) {
  const ports = new FakePorts();
  for (const phase of ['OPEN', 'CLOSE']) {
    const record = phase === 'OPEN' ? state.openingLegs : state.closingLegs;
    for (const key of ['SPOT', 'PERP']) {
      const leg = record[key];
      if (leg.submittedQuantity > 0) {
        ports.queueLookup(`${phase}:${key}`, terminalLookup(leg));
      }
    }
  }
  return ports;
}

test('every canonical Foundation plan and leg state survives an exact crash checkpoint and safe cold restore', async () => {
  const observedPlans = new Set();
  const observedLegs = new Set();
  const checkedCuts = [];
  let networkAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('network is forbidden in canonical-state crash proof');
  };

  async function checkCut(label, coordinator, clock) {
    const before = coordinator.snapshot();
    assert.ok(PLAN_LIFECYCLES.includes(before.lifecycle), `${label}: unknown plan lifecycle`);
    observedPlans.add(before.lifecycle);
    for (const record of [before.openingLegs, before.closingLegs]) {
      for (const key of ['SPOT', 'PERP']) {
        assert.ok(LEG_LIFECYCLES.includes(record[key].lifecycle), `${label}: unknown leg lifecycle`);
        observedLegs.add(record[key].lifecycle);
      }
    }

    const bytesA = coordinator.checkpoint();
    const bytesB = coordinator.checkpoint();
    assert.equal(bytesA, bytesB, `${label}: checkpoint bytes changed without state change`);

    const direct = restoreExecutionCheckpoint(bytesA);
    assert.equal(direct.ok, true, `${label}: direct restore rejected`);
    assert.equal(canonicalJson(direct.state), canonicalJson(before), `${label}: direct restore drifted`);
    assert.equal(serializeExecutionCheckpoint(direct.state), bytesA, `${label}: restored bytes are not stable`);
    assert.deepEqual(
      identityAndFillEvidence(direct.state),
      identityAndFillEvidence(before),
      `${label}: direct restore changed client IDs or fill evidence`,
    );

    const freshPorts = freshRecoveryPorts(before);
    const restoredResult = restoreExecutionCoordinator(bytesA, clock, freshPorts);
    assert.equal(restoredResult.ok, true, `${label}: coordinator restore rejected`);
    const restored = restoredResult.coordinator;
    assert.equal(canonicalJson(restored.snapshot()), canonicalJson(before), `${label}: coordinator restore drifted`);
    assert.deepEqual(
      identityAndFillEvidence(restored.snapshot()),
      identityAndFillEvidence(before),
      `${label}: coordinator restore changed client IDs or fill evidence`,
    );

    const checkpointedLegs = [];
    for (const phase of ['OPEN', 'CLOSE']) {
      const record = phase === 'OPEN' ? before.openingLegs : before.closingLegs;
      for (const key of ['SPOT', 'PERP']) {
        if (record[key].submittedQuantity > 0) checkpointedLegs.push(`${phase}:${key}`);
      }
    }
    const recoveryRequired = checkpointedLegs.length > 0 && !['CLOSED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(before.lifecycle);
    assert.equal(restored.restartRecoveryRequired(), recoveryRequired, `${label}: cold-restart risk gate mismatch`);

    if (recoveryRequired) {
      const idsBeforeRecovery = Object.values(identityAndFillEvidence(restored.snapshot()))
        .map((entry) => entry.clientOrderId);
      const fillsBeforeRecovery = identityAndFillEvidence(restored.snapshot());
      const recovered = await restored.recoverAfterRestart();
      assert.equal(recovered.ok, true, `${label}: fresh owner recovery failed${recovered.ok ? '' : ` (${recovered.failure.code})`}`);
      const lookupKeys = freshPorts.calls
        .filter((call) => call.method === 'lookupByClientOrderId')
        .map((call) => `${call.request.phase}:${call.request.leg.key}`);
      assert.deepEqual(lookupKeys, checkpointedLegs, `${label}: cold restart did not look up every checkpointed leg exactly once`);
      const reconcileIndex = freshPorts.calls.findIndex((call) => call.method === 'reconcile');
      const lookupIndexes = freshPorts.calls
        .map((call, index) => ({ call, index }))
        .filter(({ call }) => call.method === 'lookupByClientOrderId')
        .map(({ index }) => index);
      assert.equal(
        freshPorts.calls.filter((call) => call.method === 'reconcile').length,
        1,
        `${label}: cold restart did not reconcile exactly once`,
      );
      assert.ok(
        lookupIndexes.every((index) => index < reconcileIndex),
        `${label}: aggregate reconciliation ran before checkpointed owner lookups completed`,
      );
      assert.equal(
        freshPorts.calls.some((call) => call.method === 'submitPaper'),
        false,
        `${label}: cold restart resubmitted a checkpointed leg`,
      );
      assert.deepEqual(
        Object.values(identityAndFillEvidence(restored.snapshot())).map((entry) => entry.clientOrderId),
        idsBeforeRecovery,
        `${label}: cold recovery changed deterministic client IDs`,
      );
      const fillsAfterRecovery = identityAndFillEvidence(restored.snapshot());
      for (const identity of Object.keys(fillsBeforeRecovery)) {
        assert.ok(
          fillsAfterRecovery[identity].cumulativeFilledQuantity >= fillsBeforeRecovery[identity].cumulativeFilledQuantity,
          `${label}: cold recovery regressed cumulative fills for ${identity}`,
        );
      }
      const recoveredState = restored.snapshot();
      const residual = ['SPOT', 'PERP'].map((key) => (
        recoveredState.openingLegs[key].cumulativeFilledQuantity
        - recoveredState.closingLegs[key].cumulativeFilledQuantity
      ));
      assert.ok(residual.every((quantity) => quantity >= 0), `${label}: cold recovery created negative residual exposure`);
      if (recoveredState.lifecycle === 'CLOSED') {
        assert.deepEqual(residual, [0, 0], `${label}: CLOSED recovery hid residual exposure`);
      } else {
        assert.ok(residual.some((quantity) => quantity > 0), `${label}: non-CLOSED recovery hid a zero-residual terminal fact`);
      }
    } else {
      assert.equal(freshPorts.calls.length, 0, `${label}: non-risk restore touched owner ports`);
    }
    checkedCuts.push(label);
  }

  try {
    {
      const { coordinator, clock } = createCoordinator('plan-created');
      await checkCut('plan:CREATED', coordinator, clock);
    }
    {
      const { coordinator, clock } = createCoordinator('plan-awaiting-approval', new FakePorts(), new ManualClock(), {
        requiresApproval: true,
      });
      assert.equal(coordinator.requestApproval(5_000).ok, true);
      assert.equal(coordinator.snapshot().lifecycle, 'AWAITING_APPROVAL');
      await checkCut('plan:AWAITING_APPROVAL', coordinator, clock);
    }
    {
      const pending = deferred();
      const ports = new FakePorts();
      ports.preflightResult = pending.promise;
      const { coordinator, clock } = createCoordinator('plan-preflighting', ports);
      const inFlight = coordinator.preflight();
      await Promise.resolve();
      assert.equal(coordinator.snapshot().lifecycle, 'PREFLIGHTING');
      await checkCut('plan:PREFLIGHTING', coordinator, clock);
      pending.resolve(okPort);
      assert.equal((await inFlight).ok, true);
    }
    {
      const { coordinator, clock } = await readyCoordinator('plan-ready');
      assert.equal(coordinator.snapshot().lifecycle, 'READY');
      await checkCut('plan:READY-leg:VALIDATED', coordinator, clock);
    }
    {
      const { coordinator, clock } = await readyCoordinator('plan-opening');
      assert.equal(coordinator.beginOpen().ok, true);
      assert.equal(coordinator.snapshot().lifecycle, 'OPENING');
      await checkCut('plan:OPENING', coordinator, clock);
    }
    {
      const { coordinator, clock } = await readyCoordinator('plan-one-leg-exposed');
      assert.equal(coordinator.beginOpen().ok, true);
      assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
      assert.equal(coordinator.snapshot().lifecycle, 'ONE_LEG_EXPOSED');
      await checkCut('plan:ONE_LEG_EXPOSED-leg:FILLED', coordinator, clock);
    }
    {
      const { coordinator, clock } = await readyCoordinator('plan-hedged-open');
      assert.equal((await coordinator.open()).ok, true);
      assert.equal(coordinator.snapshot().lifecycle, 'HEDGED_OPEN');
      await checkCut('plan:HEDGED_OPEN', coordinator, clock);
    }
    {
      const { coordinator, clock } = await readyCoordinator('plan-close-requested');
      assert.equal((await coordinator.open()).ok, true);
      assert.equal((await coordinator.requestClose()).ok, true);
      assert.equal(coordinator.snapshot().lifecycle, 'CLOSE_REQUESTED');
      await checkCut('plan:CLOSE_REQUESTED', coordinator, clock);
    }
    {
      const ports = new FakePorts();
      const { coordinator, clock } = await readyCoordinator('plan-closing-corrected', ports);
      assert.equal((await coordinator.open()).ok, true);
      ports.reconciliations.push({ kind: 'UNRESOLVED', failure: portFailure('FORCED_OWNER_UNRESOLVED') });
      const unresolved = await coordinator.reconcile();
      assert.equal(unresolved.ok, false);
      assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
      assert.equal((await coordinator.requestClose()).ok, true);
      assert.equal(coordinator.snapshot().lifecycle, 'CLOSING');
      assert.equal(coordinator.snapshot().eventLog.at(-3).type, 'CLOSE_REQUESTED');
      assert.equal(coordinator.snapshot().eventLog.some((event) => event.type === 'CLOSING_STARTED'), false);
      await checkCut('plan:CLOSING-via-recovery-close-request', coordinator, clock);
    }
    {
      const pending = deferred();
      const ports = new FakePorts();
      const { coordinator, clock } = await readyCoordinator('plan-reconciling', ports);
      assert.equal((await coordinator.open()).ok, true);
      ports.reconciliations.push(() => pending.promise);
      const inFlight = coordinator.reconcile();
      await Promise.resolve();
      assert.equal(coordinator.snapshot().lifecycle, 'RECONCILING');
      await checkCut('plan:RECONCILING', coordinator, clock);
      pending.resolve({ kind: 'HEDGED_OPEN' });
      assert.equal((await inFlight).ok, true);
    }
    {
      const { coordinator, clock } = await readyCoordinator('plan-closed');
      assert.equal((await coordinator.open()).ok, true);
      assert.equal((await coordinator.close()).ok, true);
      assert.equal(coordinator.snapshot().lifecycle, 'CLOSED');
      await checkCut('plan:CLOSED', coordinator, clock);
    }
    {
      const ports = new FakePorts();
      const { coordinator, clock } = await readyCoordinator('plan-recovery-required', ports);
      assert.equal((await coordinator.open()).ok, true);
      ports.reconciliations.push({ kind: 'UNRESOLVED', failure: portFailure('RECOVERY_REQUIRED') });
      const outcome = await coordinator.reconcile();
      assert.equal(outcome.ok, false);
      assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
      await checkCut('plan:RECOVERY_REQUIRED', coordinator, clock);
    }
    {
      const ports = new FakePorts();
      ports.preflightResult = { ok: false, failure: portFailure('PREFLIGHT_FAILED') };
      const { coordinator, clock } = createCoordinator('plan-failed', ports);
      const outcome = await coordinator.preflight();
      assert.equal(outcome.ok, false);
      assert.equal(coordinator.snapshot().lifecycle, 'FAILED');
      await checkCut('plan:FAILED', coordinator, clock);
    }
    {
      const { coordinator, clock } = createCoordinator('plan-cancelled');
      assert.equal(coordinator.cancel().ok, true);
      assert.equal(coordinator.snapshot().lifecycle, 'CANCELLED');
      await checkCut('plan:CANCELLED', coordinator, clock);
    }
    {
      const clock = new ManualClock();
      const { coordinator } = createCoordinator('plan-expired', new FakePorts(), clock, {
        requiresApproval: true,
      });
      assert.equal(coordinator.requestApproval(5_000).ok, true);
      clock.set(T0 + 5_000);
      const outcome = coordinator.approve();
      assert.equal(outcome.ok, false);
      assert.equal(coordinator.snapshot().lifecycle, 'EXPIRED');
      await checkCut('plan:EXPIRED', coordinator, clock);
    }

    {
      const pending = deferred();
      const ports = new FakePorts().queueSubmission('OPEN:SPOT', () => pending.promise);
      const { coordinator, clock } = await readyCoordinator('leg-submitting', ports);
      assert.equal(coordinator.beginOpen().ok, true);
      const inFlight = coordinator.submitNextOpeningLeg();
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(coordinator.snapshot().openingLegs.SPOT.lifecycle, 'SUBMITTING');
      await checkCut('leg:SUBMITTING', coordinator, clock);
      pending.resolve({ kind: 'FILLED', venueOrderId: 'old-process-fill', cumulativeFilledQuantity: 1 });
      assert.equal((await inFlight).ok, true);
    }
    {
      const ports = new FakePorts().queueSubmission('OPEN:SPOT', {
        kind: 'ACKNOWLEDGED', venueOrderId: 'working-ack',
      });
      const { coordinator, clock } = await readyCoordinator('leg-acknowledged', ports);
      assert.equal(coordinator.beginOpen().ok, true);
      assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
      assert.equal(coordinator.snapshot().openingLegs.SPOT.lifecycle, 'ACKNOWLEDGED');
      await checkCut('leg:ACKNOWLEDGED', coordinator, clock);
    }
    {
      const ports = new FakePorts().queueSubmission('OPEN:SPOT', {
        kind: 'PARTIALLY_FILLED', venueOrderId: 'working-partial', cumulativeFilledQuantity: 0.4,
      });
      const { coordinator, clock } = await readyCoordinator('leg-partially-filled', ports);
      assert.equal(coordinator.beginOpen().ok, true);
      assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
      assert.equal(coordinator.snapshot().openingLegs.SPOT.lifecycle, 'PARTIALLY_FILLED');
      await checkCut('leg:PARTIALLY_FILLED', coordinator, clock);
    }
    {
      const ports = new FakePorts()
        .queueSubmission('OPEN:SPOT', {
          kind: 'PARTIALLY_FILLED', venueOrderId: 'cancel-race', cumulativeFilledQuantity: 0.4,
        })
        .queueLookup('OPEN:SPOT', {
          kind: 'FOUND', status: 'PARTIALLY_FILLED', venueOrderId: 'cancel-race', cumulativeFilledQuantity: 0.4,
        });
      const { coordinator, clock } = await readyCoordinator('leg-cancel-pending', ports);
      assert.equal(coordinator.beginOpen().ok, true);
      assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
      const outcome = await coordinator.refreshOpeningLeg('SPOT');
      assert.equal(outcome.ok, false);
      assert.equal(coordinator.snapshot().openingLegs.SPOT.lifecycle, 'CANCEL_PENDING');
      await checkCut('leg:CANCEL_PENDING', coordinator, clock);
    }
    {
      const ports = new FakePorts().queueSubmission('OPEN:SPOT', {
        kind: 'CANCELLED', venueOrderId: 'cancelled-partial', cumulativeFilledQuantity: 0.4,
      });
      const { coordinator, clock } = await readyCoordinator('leg-cancelled', ports);
      assert.equal(coordinator.beginOpen().ok, true);
      assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
      assert.equal(coordinator.snapshot().openingLegs.SPOT.lifecycle, 'CANCELLED');
      await checkCut('leg:CANCELLED', coordinator, clock);
    }
    {
      const ports = new FakePorts().queueSubmission('OPEN:SPOT', {
        kind: 'REJECTED', failure: portFailure('OWNER_REJECTED'),
      });
      const { coordinator, clock } = await readyCoordinator('leg-rejected', ports);
      assert.equal(coordinator.beginOpen().ok, true);
      const outcome = await coordinator.submitNextOpeningLeg();
      assert.equal(outcome.ok, false);
      assert.equal(coordinator.snapshot().openingLegs.SPOT.lifecycle, 'REJECTED');
      await checkCut('leg:REJECTED', coordinator, clock);
    }
    {
      const ports = new FakePorts()
        .queueSubmission('OPEN:SPOT', {
          kind: 'AMBIGUOUS', failure: portFailure('SUBMISSION_RESPONSE_LOST'),
        })
        .queueLookup('OPEN:SPOT', {
          kind: 'UNRESOLVED', failure: portFailure('LOOKUP_UNRESOLVED'),
        });
      const { coordinator, clock } = await readyCoordinator('leg-ambiguous', ports);
      assert.equal(coordinator.beginOpen().ok, true);
      const outcome = await coordinator.submitNextOpeningLeg();
      assert.equal(outcome.ok, false);
      assert.equal(coordinator.snapshot().openingLegs.SPOT.lifecycle, 'AMBIGUOUS');
      assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
      await checkCut('leg:AMBIGUOUS', coordinator, clock);
    }

    assert.deepEqual(
      [...observedPlans].sort(),
      [...PLAN_LIFECYCLES].sort(),
      'checkpoint cuts must equal the exact canonical PLAN_LIFECYCLES union',
    );
    assert.deepEqual(
      [...observedLegs].sort(),
      [...LEG_LIFECYCLES].sort(),
      'checkpoint cuts must equal the exact canonical LEG_LIFECYCLES union',
    );

    const hostilePorts = new FakePorts();
    const { coordinator: hostileSource, clock: hostileClock } = await readyCoordinator(
      'hostile-unresolved-restore',
      new FakePorts(),
    );
    assert.equal(hostileSource.beginOpen().ok, true);
    assert.equal((await hostileSource.submitNextOpeningLeg()).ok, true);
    const hostileRestore = restoreExecutionCoordinator(hostileSource.checkpoint(), hostileClock, hostilePorts);
    assert.equal(hostileRestore.ok, true);
    assert.equal(hostileRestore.coordinator.restartRecoveryRequired(), true);
    const hostileCheckpointEvidence = identityAndFillEvidence(hostileRestore.coordinator.snapshot());
    const hostile = await hostileRestore.coordinator.recoverAfterRestart();
    assert.equal(hostile.ok, false);
    assert.equal(hostile.failure.code, 'LOOKUP_UNRESOLVED');
    assert.equal(hostileRestore.coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
    assert.equal(hostileRestore.coordinator.restartRecoveryRequired(), true);
    assert.equal(hostilePorts.calls.some((call) => call.method === 'submitPaper'), false);
    assert.equal(hostilePorts.calls.some((call) => call.method === 'reconcile'), false);
    assert.equal(
      hostilePorts.calls.filter((call) => call.method === 'lookupByClientOrderId').length,
      1,
      'hostile restore must make one read-only owner lookup',
    );
    assert.deepEqual(
      identityAndFillEvidence(hostileRestore.coordinator.snapshot()),
      hostileCheckpointEvidence,
      'hostile unresolved lookup must not erase or rewrite checkpointed client IDs and fills',
    );

    assert.ok(checkedCuts.length >= PLAN_LIFECYCLES.length + 7);
    assert.equal(networkAttempts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
