import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExecutionCoordinator,
  recommendExecutionRecovery,
  replayExecutionEvents,
  restoreExecutionCheckpoint,
  restoreExecutionCoordinator,
} from '../../../dist/foundation/execution/index.js';
import {
  reconcileExecutionState,
} from '../../../dist/foundation/reconciliation/index.js';
import {
  evaluateNormalBasisOwnerAgreement,
  projectNormalBasisOwnerLegOutcome,
  runNormalBasisTwinLeg,
} from '../../../dist/liveEdge/adapters/normalBasis/index.js';
import {
  event,
  feeEvidence,
} from '../exchangeTwin/fixtures.mjs';
import {
  ManualClock,
  failure,
  makeNormalBasisBinding,
  makeTwinLegObservation,
} from './fixtures.mjs';

const RECONCILIATION_POLICY = Object.freeze({
  quantityTolerance: 1e-9,
  normalizedHedgeTolerance: 1e-9,
});

const OWNER_CHECKPOINT_HYDRATOR = Object.freeze({
  hydrateExecutionCheckpoint(serializedCheckpoint) {
    return restoreExecutionCheckpoint(serializedCheckpoint);
  },
});

const OWNER_RECOVERY_PROVIDER = Object.freeze({
  recommendExecutionRecovery(state, evaluatedAtMs) {
    return recommendExecutionRecovery(state, evaluatedAtMs);
  },
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForLifecycle(coordinator, lifecycle) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (coordinator.snapshot().lifecycle === lifecycle) return;
    await Promise.resolve();
  }
  assert.fail(`coordinator did not reach ${lifecycle}`);
}

function ownerOrderStatus(observation) {
  if (observation.venueStatus === 'BLOCKED') return 'REJECTED';
  if (observation.localTruth !== 'OBSERVED') return 'UNKNOWN';
  if (observation.venueStatus === 'CANCELED') return 'CANCELED';
  if (observation.venueStatus === 'EXPIRED'
    || observation.venueStatus === 'EXPIRED_IN_MATCH') return 'EXPIRED';
  if (observation.venueStatus === 'REJECTED') return 'REJECTED';
  if (observation.venueStatus === 'FILLED') return 'FILLED';
  if (observation.venueStatus === 'PARTIALLY_FILLED') return 'PARTIALLY_FILLED';
  return 'NEW';
}

function foundationLookupStatus(status) {
  if (status === 'ACKNOWLEDGED') return 'NEW';
  if (status === 'CANCELLED') return 'CANCELED';
  return status;
}

class TwinBackedFoundationPorts {
  constructor(binding, clock, ownerProof, modes = {}) {
    this.binding = binding;
    this.clock = clock;
    this.ownerProof = ownerProof;
    this.modes = new Map(Object.entries(modes));
    this.identityClaims = new Map();
    this.calls = [];
    this.observations = [];
    this.lookups = new Map();
    this.artifacts = new Map();
    this.ownerOrders = new Map();
    this.lastOwnerReconciliation = null;
    this.lastReconciliationOutcome = null;
    this.coordinator = null;
    this.recoveryMode = false;
    this.reconcileBarrier = null;
  }

  attach(coordinator) { this.coordinator = coordinator; }

  claimPlanIdentity(planId, termsFingerprint) {
    const existing = this.identityClaims.get(planId);
    if (existing === undefined) {
      this.identityClaims.set(planId, termsFingerprint);
      return 'CLAIMED';
    }
    return existing === termsFingerprint ? 'EXISTING_SAME' : 'CONFLICT';
  }

  async preflight(plan) {
    this.calls.push({ method: 'preflight', planId: plan.planId });
    assert.equal(plan.planId, this.binding.ownerPlan.planId);
    assert.equal(plan.correlationId, this.binding.ownerPlan.correlationId);
    assert.equal(plan.termsFingerprint, this.binding.ownerPlan.termsFingerprint);
    assert.equal(this.ownerProof.riskInput.intent.planId, plan.planId);
    assert.equal(
      this.ownerProof.riskInput.intent.proposalRef,
      plan.proposal.canonicalProposalId,
    );
    assert.equal(this.ownerProof.riskVerdict.allowed, true);
    assert.deepEqual(this.ownerProof.riskVerdict.blockingCodes, []);
    assert.equal(
      this.ownerProof.riskVerdict.evaluatedAt,
      this.ownerProof.riskInput.nowMs,
    );
    assert.ok(this.ownerProof.riskVerdict.expiresAt > this.clock.nowMs());
    assert.ok(this.ownerProof.riskVerdict.checks.some((check) => (
      check.code === 'APPROVAL_PRESENT'
        && check.status === 'PASS'
        && check.observed === plan.planId
    )));
    return { ok: true };
  }

  async validateLeg(request) {
    this.calls.push({ method: 'validateLeg', request });
    const expected = request.phase === 'OPEN'
      ? this.binding.ownerPlan.openingLegs[request.leg.key]
      : this.binding.ownerPlan.closingLegs[request.leg.key];
    assert.equal(request.planId, this.binding.ownerPlan.planId);
    assert.equal(request.correlationId, this.binding.ownerPlan.correlationId);
    assert.equal(request.leg.legId, expected.legId);
    assert.equal(request.leg.clientOrderId, expected.clientOrderId);
    assert.equal(request.leg.venue, expected.venue);
    assert.equal(request.leg.side, expected.side);
    assert.equal(request.leg.reduceOnly, expected.reduceOnly);
    assert.ok(request.leg.quantity > 0 && request.leg.quantity <= expected.quantity);
    assert.equal(this.ownerProof.riskVerdict.allowed, true);
    return { ok: true };
  }

  stage(request) {
    if (request.phase === 'OPEN') return request.leg.key === 'SPOT'
      ? 'ENTRY_SPOT' : 'ENTRY_HEDGE';
    if (request.leg.key === 'SPOT') return this.recoveryMode
      ? 'RECOVERY_CLOSE_SPOT' : 'EXIT_SPOT';
    return this.recoveryMode ? 'RECOVERY_CLOSE_PERP' : 'EXIT_PERP';
  }

  async submitPaper(request) {
    this.calls.push({ method: 'submitPaper', request });
    assert.ok(this.coordinator, 'Foundation coordinator must be attached before use');
    const stage = this.stage(request);
    const mode = this.modes.get(`${request.phase}:${request.leg.key}`) ?? {};
    const ownerCheckpoint = this.coordinator.checkpoint();
    const artifact = makeTwinLegObservation({
      binding: this.binding,
      ownerRequest: request,
      stage,
      ownerCheckpoint,
      ownerCheckpointHydrator: OWNER_CHECKPOINT_HYDRATOR,
      localMode: mode.localMode ?? 'OBSERVED',
      fillQuantity: mode.fillQuantity,
      fee: mode.fee,
    });
    const { observation } = artifact;
    this.artifacts.set(request.leg.clientOrderId, {
      ...artifact,
      ownerRequest: request,
      stage,
    });
    this.observations.push(observation);
    this.recordObservation(request, observation);
    return projectNormalBasisOwnerLegOutcome(
      observation,
      this.binding,
      OWNER_CHECKPOINT_HYDRATOR,
    );
  }

  queueLookup(key, ...outcomes) {
    this.lookups.set(key, [...outcomes]);
    return this;
  }

  recordObservation(request, observation) {
    const status = ownerOrderStatus(observation);
    const cumulativeFilledQuantity = observation.localTruth === 'OBSERVED'
      ? Number(observation.confirmedFilledQuantity) : 0;
    this.ownerOrders.set(request.leg.clientOrderId, {
      request,
      status,
      cumulativeFilledQuantity,
      venueOrderId: `twin-order-${observation.twinFixtureId}`,
      updatedAtMs: observation.order.lastLocalObservationAtMs
        ?? observation.order.lastVenueEffectAtMs
        ?? this.clock.nowMs(),
    });
  }

  recordLookup(request, outcome) {
    if (outcome.kind === 'PROVEN_ABSENT') {
      this.ownerOrders.delete(request.leg.clientOrderId);
      return;
    }
    if (outcome.kind !== 'FOUND') return;
    this.ownerOrders.set(request.leg.clientOrderId, {
      request,
      status: foundationLookupStatus(outcome.status),
      cumulativeFilledQuantity: outcome.cumulativeFilledQuantity,
      venueOrderId: outcome.venueOrderId ?? `lookup-order-${request.leg.clientOrderId}`,
      updatedAtMs: this.clock.nowMs(),
    });
  }

  ownerEvidence(state, evaluatedAtMs = Math.max(this.clock.nowMs(), state.updatedAtMs)) {
    assert.ok(Number.isSafeInteger(evaluatedAtMs) && evaluatedAtMs >= state.updatedAtMs);
    const rows = [...this.ownerOrders.values()].sort((left, right) => (
      left.request.leg.clientOrderId < right.request.leg.clientOrderId ? -1 : 1
    ));
    const orders = rows.map((row) => ({
      venue: row.request.leg.venue,
      symbol: row.request.symbol,
      clientOrderId: row.request.leg.clientOrderId,
      venueOrderId: row.venueOrderId,
      side: row.request.leg.side,
      originalQuantity: row.request.leg.quantity,
      cumulativeFilledQuantity: row.cumulativeFilledQuantity,
      status: row.status,
      reduceOnly: row.request.leg.reduceOnly,
      updatedAtMs: Math.min(row.updatedAtMs, evaluatedAtMs),
    }));
    const fills = rows.filter((row) => row.cumulativeFilledQuantity > 0).map((row) => ({
      venue: row.request.leg.venue,
      symbol: row.request.symbol,
      tradeId: `twin-fill-${row.request.leg.clientOrderId}`,
      clientOrderId: row.request.leg.clientOrderId,
      venueOrderId: row.venueOrderId,
      side: row.request.leg.side,
      quantity: row.cumulativeFilledQuantity,
      price: row.request.leg.venue === 'BINANCE_SPOT' ? 100 : 99,
      occurredAtMs: Math.min(row.updatedAtMs, evaluatedAtMs),
    }));
    const signed = (side, quantity) => side === 'BUY' ? quantity : -quantity;
    const positionQuantity = (venue) => rows.filter((row) => (
      row.request.leg.venue === venue
    )).reduce((sum, row) => (
      sum + signed(row.request.leg.side, row.cumulativeFilledQuantity)
    ), 0);
    const metadata = {
      sourceId: 'normal-basis.synthetic-owner-evidence',
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceTimeMs: evaluatedAtMs,
      receivedAtMs: evaluatedAtMs,
      maxAgeMs: 5_000,
      coverageStartMs: state.createdAtMs,
      coverageEndMs: evaluatedAtMs,
    };
    return {
      evaluatedAtMs,
      input: {
        orders: { metadata, records: orders },
        fills: { metadata, records: fills },
        positions: {
          metadata: { ...metadata, coverageStartMs: null, coverageEndMs: null },
          records: [
            {
              venue: 'BINANCE_SPOT',
              symbol: state.plan.symbol,
              positionSide: 'NET',
              quantity: positionQuantity('BINANCE_SPOT'),
              baselineQuantity: 0,
              observedAtMs: evaluatedAtMs,
            },
            {
              venue: 'BINANCE_USDM',
              symbol: state.plan.symbol,
              positionSide: 'BOTH',
              quantity: positionQuantity('BINANCE_USDM'),
              baselineQuantity: 0,
              observedAtMs: evaluatedAtMs,
            },
          ],
        },
      },
    };
  }

  canonicalReconciliation(
    state,
    evaluatedAtMs = Math.max(this.clock.nowMs(), state.updatedAtMs),
  ) {
    const evidence = this.ownerEvidence(state, evaluatedAtMs);
    const result = reconcileExecutionState(
      state,
      evidence.input,
      evidence.evaluatedAtMs,
      RECONCILIATION_POLICY,
    );
    this.lastOwnerReconciliation = result;
    return result;
  }

  reconciliationOutcome(result, state) {
    if (result.status !== 'EXACT' || result.executionAuthority !== 'NONE') {
      return {
        kind: 'UNRESOLVED',
        failure: failure(`FOUNDATION_RECONCILIATION_${result.status}`),
      };
    }
    const priorOwner = replayExecutionEvents(state.eventLog.slice(0, -1));
    if (!priorOwner.applied
      || state.eventLog.at(-1)?.type !== 'RECONCILIATION_STARTED') {
      return {
        kind: 'UNRESOLVED',
        failure: failure('FOUNDATION_OWNER_REPLAY_UNAVAILABLE'),
      };
    }
    const flat = result.positions.every((position) => (
      position.status === 'EXACT'
        && position.observedDeltaQuantity === 0
        && position.expectedDeltaQuantity === 0
    ));
    if (flat) {
      return { kind: 'CLOSED' };
    }
    if (['HEDGED_OPEN', 'ONE_LEG_EXPOSED'].includes(priorOwner.state.lifecycle)) {
      return { kind: priorOwner.state.lifecycle };
    }
    return {
      kind: 'UNRESOLVED',
      failure: failure(`FOUNDATION_OWNER_LIFECYCLE_${priorOwner.state.lifecycle}`),
    };
  }

  async lookupByClientOrderId(request) {
    this.calls.push({ method: 'lookupByClientOrderId', request });
    const queue = this.lookups.get(`${request.phase}:${request.leg.key}`);
    const outcome = queue?.shift()
      ?? { kind: 'UNRESOLVED', failure: failure('TWIN_LOOKUP_UNRESOLVED') };
    this.recordLookup(request, outcome);
    if (outcome.kind === 'FOUND' && outcome.status === 'FILLED') {
      const stage = this.stage(request);
      const existingIndex = this.observations.findIndex((item) => (
        item.stage === stage
          && item.deterministicClientOrderId === request.leg.clientOrderId
      ));
      const priorArtifact = this.artifacts.get(request.leg.clientOrderId);
      if (existingIndex === -1 || priorArtifact === undefined) return outcome;
      const existing = this.observations[existingIndex];
      assert.equal(
        String(outcome.cumulativeFilledQuantity),
        existing.venueFilledQuantity,
        'lookup evidence must equal retained venue fill truth',
      );
      const nextSequence = Math.max(...priorArtifact.scenario.events.map((item) => item.sequence)) + 1;
      const nextOccurredAtMs = Math.max(
        ...priorArtifact.scenario.events.map((item) => item.occurredAtMs),
      ) + 1;
      const reconciliationEvent = event('RECONCILIATION_OBSERVATION', nextSequence, nextOccurredAtMs, {
        fixtureId: existing.twinFixtureId,
        ownerObservationRevision: `normal-basis-owner-reconcile:${'7'.repeat(24)}`,
        observedVenueRevision: existing.order.venueRevision,
        observedStatus: existing.order.venueStatus,
        observedFilledQuantity: existing.order.filledQuantity,
      });
      const scenario = {
        ...priorArtifact.scenario,
        scenarioId: `${priorArtifact.scenario.scenarioId}-reconciled`,
        events: [...priorArtifact.scenario.events, reconciliationEvent],
      };
      const observation = runNormalBasisTwinLeg({
        binding: this.binding,
        ownerRequest: request,
        stage,
        scenario,
        ownerCheckpoint: existing.ownerCheckpoint,
        ownerCheckpointHydrator: OWNER_CHECKPOINT_HYDRATOR,
        privateTruthEvidence: existing.positionModeEvidence,
      });
      assert.equal(
        observation.deterministicClientOrderId,
        existing.deterministicClientOrderId,
      );
      this.observations.splice(existingIndex, 1, observation);
      this.artifacts.set(request.leg.clientOrderId, {
        ...priorArtifact,
        observation,
        scenario,
      });
    }
    return outcome;
  }

  async reconcile(state) {
    this.calls.push({ method: 'reconcile', planId: state.plan.planId });
    if (this.reconcileBarrier !== null) await this.reconcileBarrier.promise;
    const result = this.canonicalReconciliation(state);
    const outcome = this.reconciliationOutcome(result, state);
    this.lastReconciliationOutcome = outcome;
    return outcome;
  }
}

function harness(suffix, modes = {}, maxNakedDurationMs = 1_000) {
  const built = makeNormalBasisBinding({ suffix, maxNakedDurationMs });
  const clock = new ManualClock();
  const ports = new TwinBackedFoundationPorts(built.binding, clock, {
    riskInput: built.riskInput,
    riskVerdict: built.riskVerdict,
  }, modes);
  const coordinator = createExecutionCoordinator(built.foundationInput, clock, ports);
  ports.attach(coordinator);
  return { ...built, clock, coordinator, ports };
}

function ownerAgreement(
  binding,
  coordinator,
  ports,
  clock,
  observations = ports.observations,
) {
  const state = coordinator.snapshot();
  const evaluatedAtMs = Math.max(clock.nowMs(), state.updatedAtMs);
  return evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerCheckpoint: coordinator.checkpoint(),
    ownerCheckpointHydrator: OWNER_CHECKPOINT_HYDRATOR,
    ownerReconciliationProvider: Object.freeze({
      reconcileExecutionState(ownerState, ownerEvaluatedAtMs) {
        return ports.canonicalReconciliation(ownerState, ownerEvaluatedAtMs);
      },
    }),
    ownerReconciliationEvaluatedAtMs: evaluatedAtMs,
    recoveryProvider: OWNER_RECOVERY_PROVIDER,
    recoveryEvaluatedAtMs: evaluatedAtMs,
    observations,
  });
}

test('full staged open hedges the confirmed Spot fill, then both canonical closes reconcile CLOSED', async () => {
  const { binding, clock, coordinator, ports } = harness('full-loop');
  assert.equal((await coordinator.preflight()).ok, true);
  const opened = await coordinator.open();
  assert.equal(opened.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'HEDGED_OPEN');
  const [spotOpen, perpOpen] = ports.observations;
  assert.equal(spotOpen.stage, 'ENTRY_SPOT');
  assert.equal(spotOpen.confirmedFilledQuantity, '0.1');
  assert.equal(perpOpen.stage, 'ENTRY_HEDGE');
  assert.equal(perpOpen.requestedQuantity, spotOpen.confirmedFilledQuantity);
  const hedgeOwnerCut = restoreExecutionCheckpoint(perpOpen.ownerCheckpoint);
  assert.equal(hedgeOwnerCut.ok, true);
  assert.equal(hedgeOwnerCut.state.openingLegs.SPOT.lifecycle, 'FILLED');
  assert.equal(hedgeOwnerCut.state.openingLegs.SPOT.cumulativeFilledQuantity, 0.1);
  assert.equal(
    perpOpen.positionModeProjectionRevision,
    perpOpen.mutationLineage.privateProjectionRevision,
  );
  assert.deepEqual(ports.calls.filter((item) => item.method === 'submitPaper').map((item) => ({
    phase: item.request.phase,
    key: item.request.leg.key,
    side: item.request.leg.side,
    quantity: item.request.leg.quantity,
    reduceOnly: item.request.leg.reduceOnly,
  })), [
    { phase: 'OPEN', key: 'SPOT', side: 'BUY', quantity: 0.1, reduceOnly: false },
    { phase: 'OPEN', key: 'PERP', side: 'SELL', quantity: 0.1, reduceOnly: false },
  ]);

  const closed = await coordinator.close();
  assert.equal(closed.ok, true, JSON.stringify({
    closed,
    status: ports.lastOwnerReconciliation?.status,
    reasons: ports.lastOwnerReconciliation?.reasons,
    outcome: ports.lastReconciliationOutcome,
  }));
  assert.equal(coordinator.snapshot().lifecycle, 'CLOSED');
  const closeCalls = ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'CLOSE'
  ));
  assert.deepEqual(closeCalls.map((item) => ({
    key: item.request.leg.key,
    side: item.request.leg.side,
    reduceOnly: item.request.leg.reduceOnly,
    riskEffect: item.request.leg.riskEffect,
  })), [
    { key: 'SPOT', side: 'SELL', reduceOnly: false, riskEffect: 'RISK_REDUCING' },
    { key: 'PERP', side: 'BUY', reduceOnly: true, riskEffect: 'RISK_REDUCING' },
  ]);
  const perpClose = ports.observations.find((item) => item.stage === 'EXIT_PERP');
  assert.equal(perpClose.positionSide, 'BOTH');
  assert.equal(perpClose.reduceOnly, true);
  assert.equal(
    perpClose.positionModeProjectionRevision,
    perpClose.mutationLineage.privateProjectionRevision,
  );

  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'PASS', agreement.reasonCodes.join(','));
  assert.equal(agreement.residualSpotQuantity, '0');
  assert.equal(agreement.residualPerpQuantity, '0');
  assert.equal(agreement.netBaseQuantity, '0');
});

test('base-asset Spot commission remains separate from gross fill and blocks false hedge agreement', async () => {
  const baseFee = feeEvidence({
    chargeBasis: 'BASE_QUANTITY',
    feeAsset: 'BTC',
    takerRate: '0.001',
    quoteConversionRate: null,
  });
  const { binding, clock, coordinator, ports } = harness('base-fee-exposure', {
    'OPEN:SPOT': { fee: baseFee },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  const spot = ports.observations.find((item) => item.stage === 'ENTRY_SPOT');
  const perp = ports.observations.find((item) => item.stage === 'ENTRY_HEDGE');
  assert.equal(spot.confirmedFilledQuantity, '0.1');
  assert.equal(spot.baseAssetCommissionQuantity, '0.0001');
  assert.equal(spot.feeAdjustedConfirmedQuantity, '0.0999');
  assert.equal(perp.confirmedFilledQuantity, '0.1');
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.canonicalOutcome, 'HEDGED_OPEN');
  assert.equal(agreement.openingSpotQuantity, '0.1');
  assert.equal(agreement.openingSpotBaseAssetCommissionQuantity, '0.0001');
  assert.equal(agreement.feeAdjustedSpotBaseQuantity, '0.0999');
  assert.equal(agreement.netBaseQuantity, '-0.0001');
  assert.equal(agreement.unhedgedBaseQuantity, '0.0001');
  assert.equal(agreement.state, 'BLOCKED');
  assert.ok(agreement.reasonCodes.includes('OWNER_HEDGED_OPEN_WITH_UNRESOLVED_TRUTH'));
});

test('base-asset Spot commission on SELL close increases disposed quantity and preserves residual exposure', async () => {
  const baseFee = feeEvidence({
    chargeBasis: 'BASE_QUANTITY',
    feeAsset: 'BTC',
    takerRate: '0.001',
    quoteConversionRate: null,
  });
  const { binding, clock, coordinator, ports } = harness('base-fee-close-exposure', {
    'CLOSE:SPOT': { fee: baseFee },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  assert.equal((await coordinator.close()).ok, true);
  const spotClose = ports.observations.find((item) => item.stage === 'EXIT_SPOT');
  assert.equal(spotClose.confirmedFilledQuantity, '0.1');
  assert.equal(spotClose.baseAssetCommissionQuantity, '0.0001');
  assert.equal(spotClose.feeAdjustedConfirmedQuantity, '0.1001');
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.canonicalOutcome, 'CLOSED');
  assert.equal(agreement.closingSpotBaseAssetCommissionQuantity, '0.0001');
  assert.equal(agreement.feeAdjustedSpotBaseQuantity, '-0.0001');
  assert.equal(agreement.netBaseQuantity, '-0.0001');
  assert.equal(agreement.unhedgedBaseQuantity, '0.0001');
  assert.equal(agreement.state, 'BLOCKED');
  assert.ok(agreement.reasonCodes.includes('OWNER_CLOSED_WITH_UNRESOLVED_TRUTH'));
});

test('missing Spot fee evidence is unavailable and cannot produce a passing agreement', async () => {
  const { binding, clock, coordinator, ports } = harness('missing-fee-evidence', {
    'OPEN:SPOT': { fee: null },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  const spot = ports.observations.find((item) => item.stage === 'ENTRY_SPOT');
  assert.equal(spot.confirmedFilledQuantity, '0.1');
  assert.equal(spot.baseAssetCommissionQuantity, null);
  assert.equal(spot.feeAdjustedConfirmedQuantity, null);
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.netBaseQuantity, null);
  assert.equal(agreement.unhedgedBaseQuantity, null);
  assert.equal(agreement.state, 'BLOCKED');
  assert.ok(agreement.reasonCodes.includes('SPOT_FEE_TRUTH_UNAVAILABLE'));
});

test('partial first fill waits for canonical terminal lookup before hedging the final fill', async () => {
  const { binding, clock, coordinator, ports } = harness('partial-spot', {
    'OPEN:SPOT': { fillQuantity: '0.04' },
  });
  ports.queueLookup('OPEN:SPOT',
    {
      kind: 'FOUND',
      status: 'PARTIALLY_FILLED',
      venueOrderId: null,
      cumulativeFilledQuantity: 0.04,
    },
    {
      kind: 'FOUND',
      status: 'CANCELLED',
      venueOrderId: null,
      cumulativeFilledQuantity: 0.04,
    });
  assert.equal((await coordinator.preflight()).ok, true);
  const opened = await coordinator.open();
  assert.equal(opened.ok, false);
  assert.equal(opened.failure.code, 'OPENING_REMAINDER_FINALIZATION_REQUIRED');
  assert.equal(coordinator.snapshot().openingLegs.SPOT.lifecycle, 'CANCEL_PENDING');
  assert.equal(coordinator.snapshot().openingLegs.SPOT.cumulativeFilledQuantity, 0.04);
  assert.equal(ports.observations.some((item) => item.stage === 'ENTRY_HEDGE'), false);
  const finalized = await coordinator.submitNextOpeningLeg();
  assert.equal(finalized.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'HEDGED_OPEN');
  const spot = ports.observations.find((item) => item.stage === 'ENTRY_SPOT');
  const hedge = ports.observations.find((item) => item.stage === 'ENTRY_HEDGE');
  assert.equal(spot.localDisposition, 'PARTIALLY_FILLED');
  assert.equal(spot.confirmedFilledQuantity, '0.04');
  assert.equal(spot.remainingQuantity, '0.06');
  assert.equal(spot.terminalStatus, null);
  assert.equal(hedge.requestedQuantity, '0.04');
  assert.equal(hedge.confirmedFilledQuantity, '0.04');
  const hedgeOwnerCut = restoreExecutionCheckpoint(hedge.ownerCheckpoint);
  assert.equal(hedgeOwnerCut.ok, true);
  assert.equal(hedgeOwnerCut.state.openingLegs.SPOT.lifecycle, 'CANCELLED');
  assert.equal(hedgeOwnerCut.state.openingLegs.SPOT.cumulativeFilledQuantity, 0.04);
  const hedgeCall = ports.calls.find((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'PERP'
  ));
  assert.equal(hedgeCall.request.leg.quantity, 0.04);
  const terminalLookupIndex = ports.calls.reduce((latest, item, index) => (
    item.method === 'lookupByClientOrderId' ? index : latest
  ), -1);
  const hedgeSubmitIndex = ports.calls.findIndex((item) => (
    item.method === 'submitPaper' && item.request.leg.key === 'PERP'
  ));
  assert.ok(terminalLookupIndex >= 0 && hedgeSubmitIndex > terminalLookupIndex);
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.reconciliationStatus, 'PARTIAL');
  assert.deepEqual(agreement.reasonCodes, []);
  assert.equal(agreement.manualActionRequired, true);
  assert.equal(agreement.workingRemainderVisible, false);
  assert.equal(agreement.unhedgedBaseQuantity, '0');
  const spotSubmit = ports.calls.find((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'SPOT'
  ));
  const spotSubmits = ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'SPOT'
  ));
  assert.equal(spotSubmits.length, 1);
  assert.equal(spotSubmits[0].request.leg.clientOrderId, spotSubmit.request.leg.clientOrderId);
});

test('partial hedge retains exact one-leg exposure and never promotes the book to HEDGED_OPEN', async () => {
  const { binding, clock, coordinator, ports } = harness('partial-hedge', {
    'OPEN:PERP': { fillQuantity: '0.04' },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  const opened = await coordinator.open();
  assert.equal(opened.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'ONE_LEG_EXPOSED');
  const [spot, hedge] = ports.observations;
  assert.equal(spot.confirmedFilledQuantity, '0.1');
  assert.equal(hedge.localDisposition, 'PARTIALLY_FILLED');
  assert.equal(hedge.confirmedFilledQuantity, '0.04');
  assert.equal(hedge.remainingQuantity, '0.06');
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.reconciliationStatus, 'PARTIAL');
  assert.equal(agreement.manualActionRequired, true);
  assert.deepEqual(agreement.reasonCodes, []);
  assert.equal(agreement.residualSpotQuantity, '0.1');
  assert.equal(agreement.residualPerpQuantity, '0.04');
  assert.equal(agreement.unhedgedBaseQuantity, '0.06');

  const hedgeSubmit = ports.calls.find((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'PERP'
  ));
  const retainedCancel = agreement.ownerRecommendationsRetained.find((item) => (
    item.action === 'CANCEL_REMAINDER' && item.legKey === 'PERP'
  ));
  assert.ok(retainedCancel);
  assert.equal(retainedCancel.planId, binding.ownerPlan.planId);
  assert.equal(retainedCancel.correlationId, binding.ownerPlan.correlationId);
  assert.equal(retainedCancel.phase, 'OPEN');
  assert.equal(retainedCancel.legId, binding.ownerPlan.openingLegs.PERP.legId);
  assert.equal(retainedCancel.clientOrderId, hedgeSubmit.request.leg.clientOrderId);
  assert.ok(retainedCancel.reason.length > 0);
  assert.equal(retainedCancel.ownerStateRevision, coordinator.snapshot().stateRevisionId);
  assert.equal(retainedCancel.reconciliationEvidenceRevision, agreement.reconciliationEvidenceRevision);
  assert.ok(retainedCancel.recommendationRevision.startsWith('l09recovery_'));
  const reconciled = await coordinator.reconcile();
  assert.equal(reconciled.ok, false);
  assert.equal(reconciled.failure.code, 'FOUNDATION_RECONCILIATION_PARTIAL');
  assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  const recovery = recommendExecutionRecovery(coordinator.snapshot(), clock.nowMs());
  assert.ok(recovery.some((item) => (
    item.action === 'CANCEL_REMAINDER'
      && item.clientOrderId === hedgeSubmit.request.leg.clientOrderId
      && item.automatic === false
  )));
  assert.ok(recovery.some((item) => (
    item.action === 'MANUAL_REVIEW'
      && item.automatic === false
      && item.riskEffect === 'NEUTRAL'
  )));
  const blockedResume = await coordinator.open();
  assert.equal(blockedResume.ok, false);
  assert.equal(blockedResume.failure.code, 'PLAN_NOT_READY');
  const hedgeSubmits = ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'PERP'
  ));
  assert.equal(hedgeSubmits.length, 1);
  assert.equal(hedgeSubmits[0].request.leg.clientOrderId, hedgeSubmit.request.leg.clientOrderId);
});

test('second-leg rejection retains exposure and emergency recovery closes only the known Spot leg', async () => {
  const { binding, clock, coordinator, ports } = harness('hedge-reject', {
    'OPEN:PERP': { localMode: 'REJECTED' },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  const opened = await coordinator.open();
  assert.equal(opened.ok, false);
  assert.equal(coordinator.snapshot().lifecycle, 'ONE_LEG_EXPOSED');
  assert.equal(coordinator.snapshot().openingLegs.SPOT.cumulativeFilledQuantity, 0.1);
  assert.equal(coordinator.snapshot().openingLegs.PERP.cumulativeFilledQuantity, 0);
  const exposedAt = coordinator.snapshot().exposedSinceMs;
  clock.set(exposedAt + binding.ownerPlan.maxNakedDurationMs);
  assert.equal(coordinator.evaluateNakedDuration().ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  ports.recoveryMode = true;
  const recovered = await coordinator.close(true);
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(coordinator.snapshot().lifecycle, 'CLOSED');
  const recoveryCloses = ports.observations.filter((item) => item.stage.startsWith('RECOVERY_CLOSE_'));
  assert.deepEqual(recoveryCloses.map((item) => item.stage), ['RECOVERY_CLOSE_SPOT']);
  assert.equal(recoveryCloses[0].side, 'SELL');
  assert.equal(recoveryCloses[0].reduceOnly, false);
  assert.ok(coordinator.snapshot().eventLog.some((item) => (
    item.type === 'CLOSE_REQUESTED' && item.emergency === true
  )));

  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'PASS');
  assert.equal(agreement.residualSpotQuantity, '0');
  assert.equal(agreement.residualPerpQuantity, '0');
});

test('timeout after venue effect keeps fill UNKNOWN, blocks the hedge and requires same-ID recovery', async () => {
  const { binding, clock, coordinator, ports } = harness('ambiguous-spot', {
    'OPEN:SPOT': { localMode: 'AMBIGUOUS' },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  const opened = await coordinator.open();
  assert.equal(opened.ok, false);
  assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  const observation = ports.observations[0];
  assert.equal(observation.venueFilledQuantity, '0.1');
  assert.equal(observation.confirmedFilledQuantity, '0');
  assert.equal(observation.localTruth, 'UNKNOWN');
  assert.equal(observation.localDisposition, 'AMBIGUOUS');
  assert.equal(observation.recoveryRequired, true);
  assert.equal(ports.observations.some((item) => item.stage === 'ENTRY_HEDGE'), false);
  const submit = ports.calls.find((item) => item.method === 'submitPaper');
  const lookup = ports.calls.find((item) => item.method === 'lookupByClientOrderId');
  assert.equal(lookup.request.leg.clientOrderId, submit.request.leg.clientOrderId);
  const state = coordinator.snapshot();
  const recs = recommendExecutionRecovery(state, clock.nowMs());
  assert.ok(recs.some((item) => item.action === 'VERIFY_AMBIGUOUS_ORDER'));
  assert.ok(recs.some((item) => item.action === 'MANUAL_REVIEW'));
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'BLOCKED');
  assert.equal(agreement.manualActionRequired, false);
  assert.ok(agreement.reasonCodes.includes('OWNER_RECONCILIATION_BLOCKED'));
  assert.equal(agreement.ambiguityVisible, true);
  const spotSubmits = ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'SPOT'
  ));
  const spotLookups = ports.calls.filter((item) => (
    item.method === 'lookupByClientOrderId' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'SPOT'
  ));
  assert.equal(spotSubmits.length, 1);
  assert.equal(spotLookups.length, 1);
  assert.ok(spotLookups.every((item) => (
    item.request.leg.clientOrderId === spotSubmits[0].request.leg.clientOrderId
  )));
  assert.ok(coordinator.snapshot().eventLog.some((item) => (
    item.type === 'LEG_RESPONSE_AMBIGUOUS'
  )));
});

test('cold Foundation restore verifies owner truth before hedging and never reuses pre-crash observation', async () => {
  const {
    binding, clock, coordinator, ports, riskInput, riskVerdict,
  } = harness('restart');
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal(coordinator.beginOpen().ok, true);
  assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'ONE_LEG_EXPOSED');
  assert.deepEqual(ports.observations.map((item) => item.stage), ['ENTRY_SPOT']);
  const durableSpotObservationBytes = JSON.stringify(ports.observations[0]);
  const checkpointA = coordinator.checkpoint();
  const checkpointB = coordinator.checkpoint();
  assert.equal(checkpointB, checkpointA);
  const coldPorts = new TwinBackedFoundationPorts(binding, clock, { riskInput, riskVerdict });
  coldPorts.queueLookup('OPEN:SPOT', {
    kind: 'FOUND',
    status: 'FILLED',
    venueOrderId: null,
    cumulativeFilledQuantity: 0.1,
  });
  const restoredResult = restoreExecutionCoordinator(checkpointA, clock, coldPorts);
  assert.equal(restoredResult.ok, true);
  const restored = restoredResult.coordinator;
  coldPorts.attach(restored);
  assert.equal(restored.restartRecoveryRequired(), true);
  assert.equal((await restored.submitNextOpeningLeg()).ok, true);
  assert.equal(restored.snapshot().lifecycle, 'HEDGED_OPEN');
  assert.equal(ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'SPOT'
  )).length, 1);
  assert.equal(coldPorts.calls.some((item) => (
    item.method === 'submitPaper' && item.request.leg.key === 'SPOT'
  )), false);
  assert.deepEqual(coldPorts.observations.map((item) => item.stage), ['ENTRY_HEDGE']);
  const lookupIndex = coldPorts.calls.findIndex((item) => (
    item.method === 'lookupByClientOrderId' && item.request.leg.key === 'SPOT'
  ));
  const reconcileIndex = coldPorts.calls.findIndex((item) => item.method === 'reconcile');
  const hedgeIndex = coldPorts.calls.findIndex((item) => (
    item.method === 'submitPaper' && item.request.leg.key === 'PERP'
  ));
  assert.ok(lookupIndex >= 0 && reconcileIndex > lookupIndex && hedgeIndex > reconcileIndex);
  const hedge = coldPorts.observations.find((item) => item.stage === 'ENTRY_HEDGE');
  assert.equal(hedge.requestedQuantity, String(binding.ownerPlan.openingLegs.SPOT.quantity));
  const ownerCut = restoreExecutionCheckpoint(hedge.ownerCheckpoint);
  assert.equal(ownerCut.ok, true);
  assert.equal(ownerCut.state.openingLegs.SPOT.lifecycle, 'FILLED');
  assert.equal(ownerCut.state.openingLegs.SPOT.cumulativeFilledQuantity, 0.1);
  assert.equal(restored.snapshot().plan.correlationId, binding.ownerPlan.correlationId);
  const durableSpotObservation = JSON.parse(durableSpotObservationBytes);
  assert.notEqual(durableSpotObservation, ports.observations[0]);
  assert.deepEqual(durableSpotObservation, ports.observations[0]);
  const agreement = ownerAgreement(
    binding,
    restored,
    coldPorts,
    clock,
    [durableSpotObservation, ...coldPorts.observations],
  );
  assert.equal(agreement.state, 'PASS', agreement.reasonCodes.join(','));
  assert.deepEqual(agreement.observationRevisions, [
    durableSpotObservation.observationRevision,
    hedge.observationRevision,
  ]);
});

test('first-leg rejection has no exposure, reaches FAILED and never admits a hedge', async () => {
  const { binding, clock, coordinator, ports } = harness('spot-reject', {
    'OPEN:SPOT': { localMode: 'REJECTED' },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  const opened = await coordinator.open();
  assert.equal(opened.ok, false);
  assert.equal(coordinator.snapshot().lifecycle, 'FAILED');
  assert.equal(coordinator.snapshot().openingLegs.SPOT.cumulativeFilledQuantity, 0);
  assert.equal(ports.observations.length, 1);
  assert.equal(ports.observations[0].localDisposition, 'REJECTED');
  assert.equal(ports.calls.some((item) => (
    item.method === 'submitPaper' && item.request.leg.key === 'PERP'
  )), false);
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.canonicalOutcome, 'FAILED');
  assert.equal(agreement.state, 'PASS', agreement.reasonCodes.join(','));
  assert.equal(agreement.reconciliationStatus, 'EXACT');
  assert.equal(agreement.residualSpotQuantity, '0');
  assert.equal(agreement.residualPerpQuantity, '0');
  assert.equal(agreement.netBaseQuantity, '0');
  assert.equal(agreement.manualActionRequired, false);
  assert.deepEqual(agreement.reasonCodes, []);
  assert.deepEqual(agreement.observationRevisions, [ports.observations[0].observationRevision]);
  assert.ok(agreement.ownerRecommendationsRetained.every((item) => item.action === 'NO_ACTION'));
});

test('ambiguous hedge retains Spot exposure and cannot claim HEDGED_OPEN', async () => {
  const { binding, clock, coordinator, ports } = harness('ambiguous-hedge', {
    'OPEN:PERP': { localMode: 'AMBIGUOUS' },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  const opened = await coordinator.open();
  assert.equal(opened.ok, false);
  assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  const hedge = ports.observations.find((item) => item.stage === 'ENTRY_HEDGE');
  assert.equal(hedge.venueFilledQuantity, '0.1');
  assert.equal(hedge.confirmedFilledQuantity, '0');
  assert.equal(hedge.localDisposition, 'AMBIGUOUS');
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'BLOCKED', agreement.reasonCodes.join(','));
  assert.equal(agreement.manualActionRequired, false);
  assert.ok(agreement.reasonCodes.includes('OWNER_RECONCILIATION_BLOCKED'));
  assert.equal(agreement.residualSpotQuantity, '0.1');
  assert.equal(agreement.residualPerpQuantity, '0');

  ports.queueLookup('OPEN:PERP', {
    kind: 'FOUND',
    status: 'FILLED',
    venueOrderId: 'lookup-ambiguous-hedge',
    cumulativeFilledQuantity: 0.1,
  });
  const resolved = await coordinator.resolveOutstandingAmbiguity('OPEN', 'PERP');
  assert.equal(resolved.ok, true);
  const refreshedHedge = ports.observations.find((item) => item.stage === 'ENTRY_HEDGE');
  assert.equal(refreshedHedge.deterministicClientOrderId, hedge.deterministicClientOrderId);
  assert.notEqual(refreshedHedge.observationRevision, hedge.observationRevision);
  assert.equal(refreshedHedge.localDisposition, 'FILLED');
  assert.equal(refreshedHedge.confirmedFilledQuantity, '0.1');
  const hedgeSubmits = ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'PERP'
  ));
  const hedgeLookups = ports.calls.filter((item) => (
    item.method === 'lookupByClientOrderId' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'PERP'
  ));
  assert.equal(hedgeSubmits.length, 1);
  assert.equal(hedgeLookups.length, 2);
  assert.ok(hedgeLookups.every((item) => (
    item.request.leg.clientOrderId === hedgeSubmits[0].request.leg.clientOrderId
  )));
  ports.recoveryMode = true;
  const closed = await coordinator.close(true);
  assert.equal(closed.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'CLOSED');
  const finalAgreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(finalAgreement.state, 'PASS', finalAgreement.reasonCodes.join(','));
  assert.equal(finalAgreement.residualSpotQuantity, '0');
  assert.equal(finalAgreement.residualPerpQuantity, '0');
});

test('ambiguous close stays RECOVERY_REQUIRED and never advances to the Perp close', async () => {
  const { binding, clock, coordinator, ports } = harness('ambiguous-close');
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  ports.modes.set('CLOSE:SPOT', { localMode: 'AMBIGUOUS' });
  const closed = await coordinator.close();
  assert.equal(closed.ok, false);
  assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  const spotClose = ports.observations.find((item) => item.stage === 'EXIT_SPOT');
  assert.equal(spotClose.localDisposition, 'AMBIGUOUS');
  assert.equal(spotClose.confirmedFilledQuantity, '0');
  assert.equal(ports.observations.some((item) => item.stage === 'EXIT_PERP'), false);
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'BLOCKED', agreement.reasonCodes.join(','));
  assert.equal(agreement.manualActionRequired, false);
  assert.ok(agreement.reasonCodes.includes('OWNER_RECONCILIATION_BLOCKED'));
  assert.equal(agreement.ambiguityVisible, true);

  ports.queueLookup('CLOSE:SPOT', {
    kind: 'FOUND',
    status: 'FILLED',
    venueOrderId: 'lookup-ambiguous-close',
    cumulativeFilledQuantity: 0.1,
  });
  const resolved = await coordinator.resolveOutstandingAmbiguity('CLOSE', 'SPOT');
  assert.equal(resolved.ok, true);
  const refreshedClose = ports.observations.find((item) => item.stage === 'EXIT_SPOT');
  assert.equal(refreshedClose.deterministicClientOrderId, spotClose.deterministicClientOrderId);
  assert.notEqual(refreshedClose.observationRevision, spotClose.observationRevision);
  assert.equal(refreshedClose.localDisposition, 'FILLED');
  assert.equal(refreshedClose.confirmedFilledQuantity, '0.1');
  const closeSubmitsBeforeResume = ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'CLOSE'
      && item.request.leg.key === 'SPOT'
  ));
  const closeLookups = ports.calls.filter((item) => (
    item.method === 'lookupByClientOrderId' && item.request.phase === 'CLOSE'
      && item.request.leg.key === 'SPOT'
  ));
  assert.equal(closeSubmitsBeforeResume.length, 1);
  assert.equal(closeLookups.length, 2);
  assert.ok(closeLookups.every((item) => (
    item.request.leg.clientOrderId
      === closeSubmitsBeforeResume[0].request.leg.clientOrderId
  )));
  const resumedClose = await coordinator.close();
  assert.equal(resumedClose.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'CLOSED');
  assert.equal(ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'CLOSE'
      && item.request.leg.key === 'SPOT'
  )).length, 1);
  assert.equal(ports.observations.some((item) => item.stage === 'EXIT_PERP'), true);
  const finalAgreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(finalAgreement.state, 'PASS', finalAgreement.reasonCodes.join(','));
  assert.equal(finalAgreement.residualSpotQuantity, '0');
  assert.equal(finalAgreement.residualPerpQuantity, '0');
});

test('working partial close stays visible and repeated close performs same-ID lookup only', async () => {
  const { binding, clock, coordinator, ports } = harness('working-partial-close');
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  ports.modes.set('CLOSE:SPOT', { fillQuantity: '0.04' });
  const closed = await coordinator.close();
  assert.equal(closed.ok, false);
  assert.equal(closed.failure.code, 'CLOSE_INCOMPLETE');
  assert.equal(coordinator.snapshot().lifecycle, 'ONE_LEG_EXPOSED');
  assert.equal(coordinator.snapshot().closingLegs.SPOT.lifecycle, 'PARTIALLY_FILLED');
  assert.equal(coordinator.snapshot().closingLegs.SPOT.cumulativeFilledQuantity, 0.04);
  assert.equal(coordinator.snapshot().closingLegs.PERP.lifecycle, 'FILLED');
  const spotClose = ports.observations.find((item) => item.stage === 'EXIT_SPOT');
  assert.equal(spotClose.localDisposition, 'PARTIALLY_FILLED');
  assert.equal(spotClose.terminalStatus, null);
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.residualSpotQuantity, '0.06');
  assert.equal(agreement.residualPerpQuantity, '0');
  assert.equal(agreement.workingRemainderVisible, true);

  ports.queueLookup('CLOSE:SPOT', {
    kind: 'FOUND',
    status: 'PARTIALLY_FILLED',
    venueOrderId: null,
    cumulativeFilledQuantity: 0.04,
  });
  const retried = await coordinator.close();
  assert.equal(retried.ok, false);
  assert.equal(retried.failure.code, 'CLOSE_INCOMPLETE');
  assert.ok(ports.calls.some((item) => (
    item.method === 'lookupByClientOrderId' && item.request.phase === 'CLOSE'
      && item.request.leg.key === 'SPOT'
  )));
  assert.equal(ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'CLOSE'
      && item.request.leg.key === 'SPOT'
  )).length, 1);
});

test('venue-rejected close enters recovery without submitting the second close leg', async () => {
  const { binding, clock, coordinator, ports } = harness('venue-rejected-close');
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  ports.modes.set('CLOSE:SPOT', { localMode: 'REJECTED' });
  const closed = await coordinator.close();
  assert.equal(closed.ok, false);
  assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  assert.equal(coordinator.snapshot().closingLegs.SPOT.lifecycle, 'REJECTED');
  const spotClose = ports.observations.find((item) => item.stage === 'EXIT_SPOT');
  assert.equal(spotClose.venueStatus, 'REJECTED');
  assert.equal(spotClose.localDisposition, 'REJECTED');
  assert.equal(spotClose.terminalStatus, 'REJECTED');
  assert.equal(ports.observations.some((item) => item.stage === 'EXIT_PERP'), false);
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.residualSpotQuantity, '0.1');
  assert.equal(agreement.residualPerpQuantity, '0.1');
  assert.equal(agreement.workingRemainderVisible, false);
  assert.ok(agreement.ownerRecommendationsRetained.some((item) => (
    item.action === 'MANUAL_REVIEW'
  )));
});

test('terminal-partial close becomes canonical CANCELLED and retains exact residual', async () => {
  const { binding, clock, coordinator, ports } = harness('terminal-partial-close');
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  ports.modes.set('CLOSE:SPOT', {
    localMode: 'EXPIRED_IN_MATCH',
    fillQuantity: '0.04',
  });
  const closed = await coordinator.close();
  assert.equal(closed.ok, false);
  assert.equal(closed.failure.code, 'CLOSE_INCOMPLETE');
  const state = coordinator.snapshot();
  assert.equal(state.lifecycle, 'ONE_LEG_EXPOSED');
  assert.equal(state.closingLegs.SPOT.lifecycle, 'CANCELLED');
  assert.equal(state.closingLegs.SPOT.cumulativeFilledQuantity, 0.04);
  assert.equal(state.closingLegs.PERP.lifecycle, 'FILLED');
  assert.equal(
    String(state.openingLegs.SPOT.cumulativeFilledQuantity
      - state.closingLegs.SPOT.cumulativeFilledQuantity),
    '0.060000000000000005',
  );
  const spotClose = ports.observations.find((item) => item.stage === 'EXIT_SPOT');
  assert.equal(spotClose.venueStatus, 'EXPIRED_IN_MATCH');
  assert.equal(spotClose.localDisposition, 'TERMINAL_PARTIALLY_FILLED');
  assert.equal(spotClose.terminalStatus, 'EXPIRED_IN_MATCH');
  assert.equal(projectNormalBasisOwnerLegOutcome(
    spotClose,
    binding,
    OWNER_CHECKPOINT_HYDRATOR,
  ).kind, 'CANCELLED');
  const agreement = ownerAgreement(binding, coordinator, ports, clock);
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.residualSpotQuantity, '0.06');
  assert.equal(agreement.residualPerpQuantity, '0');
  assert.equal(agreement.feeAdjustedSpotBaseQuantity, '0.06');
  assert.equal(agreement.unhedgedBaseQuantity, '0.06');
  assert.equal(agreement.workingRemainderVisible, false);
  assert.equal(ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'CLOSE'
      && item.request.leg.key === 'SPOT'
  )).length, 1);
});

test('full-close cold restart verifies all four terminal IDs before reconciling CLOSED', async () => {
  const {
    binding, clock, coordinator, ports, riskInput, riskVerdict,
  } = harness('full-close-cold-restart');
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  const barrier = deferred();
  ports.reconcileBarrier = barrier;
  const pendingClose = coordinator.close();
  await waitForLifecycle(coordinator, 'RECONCILING');
  const checkpoint = coordinator.checkpoint();
  const durableObservations = structuredClone(ports.observations);

  const coldPorts = new TwinBackedFoundationPorts(binding, clock, { riskInput, riskVerdict });
  for (const [phase, key, status, quantity] of [
    ['OPEN', 'SPOT', 'FILLED', 0.1],
    ['OPEN', 'PERP', 'FILLED', 0.1],
    ['CLOSE', 'SPOT', 'FILLED', 0.1],
    ['CLOSE', 'PERP', 'FILLED', 0.1],
  ]) {
    coldPorts.queueLookup(`${phase}:${key}`, {
      kind: 'FOUND', status, venueOrderId: null, cumulativeFilledQuantity: quantity,
    });
  }
  const restoredResult = restoreExecutionCoordinator(checkpoint, clock, coldPorts);
  assert.equal(restoredResult.ok, true);
  const restored = restoredResult.coordinator;
  coldPorts.attach(restored);
  const recovered = await restored.recoverAfterRestart();
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(restored.snapshot().lifecycle, 'CLOSED');
  assert.equal(coldPorts.calls.filter((item) => item.method === 'lookupByClientOrderId').length, 4);
  assert.equal(coldPorts.calls.some((item) => item.method === 'submitPaper'), false);
  const lookupLast = coldPorts.calls.reduce((last, item, index) => (
    item.method === 'lookupByClientOrderId' ? index : last
  ), -1);
  const reconcileIndex = coldPorts.calls.findIndex((item) => item.method === 'reconcile');
  assert.ok(reconcileIndex > lookupLast);
  const agreement = ownerAgreement(
    binding,
    restored,
    coldPorts,
    clock,
    durableObservations,
  );
  assert.equal(agreement.state, 'PASS', agreement.reasonCodes.join(','));
  assert.equal(agreement.residualSpotQuantity, '0');
  assert.equal(agreement.residualPerpQuantity, '0');

  barrier.resolve();
  assert.equal((await pendingClose).ok, true);
});

test('emergency-recovery cold restart verifies three terminal IDs and preserves recovery close', async () => {
  const {
    binding, clock, coordinator, ports, riskInput, riskVerdict,
  } = harness('recovery-close-cold-restart', {
    'OPEN:PERP': { localMode: 'REJECTED' },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, false);
  ports.recoveryMode = true;
  const barrier = deferred();
  ports.reconcileBarrier = barrier;
  const pendingRecovery = coordinator.close(true);
  await waitForLifecycle(coordinator, 'RECONCILING');
  const checkpoint = coordinator.checkpoint();
  const durableObservations = structuredClone(ports.observations);
  assert.ok(coordinator.snapshot().eventLog.some((item) => (
    item.type === 'CLOSE_REQUESTED' && item.emergency === true
  )));
  assert.ok(durableObservations.some((item) => item.stage === 'RECOVERY_CLOSE_SPOT'));

  const coldPorts = new TwinBackedFoundationPorts(binding, clock, { riskInput, riskVerdict });
  coldPorts.queueLookup('OPEN:SPOT', {
    kind: 'FOUND', status: 'FILLED', venueOrderId: null, cumulativeFilledQuantity: 0.1,
  });
  coldPorts.queueLookup('OPEN:PERP', {
    kind: 'FOUND', status: 'REJECTED', venueOrderId: null, cumulativeFilledQuantity: 0,
    failure: failure('TWIN_VENUE_REJECTED'),
  });
  coldPorts.queueLookup('CLOSE:SPOT', {
    kind: 'FOUND', status: 'FILLED', venueOrderId: null, cumulativeFilledQuantity: 0.1,
  });
  const restoredResult = restoreExecutionCoordinator(checkpoint, clock, coldPorts);
  assert.equal(restoredResult.ok, true);
  const restored = restoredResult.coordinator;
  coldPorts.attach(restored);
  assert.equal((await restored.recoverAfterRestart()).ok, true);
  assert.equal(restored.snapshot().lifecycle, 'CLOSED');
  assert.equal(coldPorts.calls.filter((item) => item.method === 'lookupByClientOrderId').length, 3);
  assert.equal(coldPorts.calls.some((item) => item.method === 'submitPaper'), false);
  const agreement = ownerAgreement(
    binding,
    restored,
    coldPorts,
    clock,
    durableObservations,
  );
  assert.equal(agreement.state, 'PASS', agreement.reasonCodes.join(','));
  assert.equal(agreement.residualSpotQuantity, '0');
  assert.equal(agreement.residualPerpQuantity, '0');

  barrier.resolve();
  assert.equal((await pendingRecovery).ok, true);
});

test('terminal-partial cold restart preserves CANCELLED residual and never resubmits', async () => {
  const {
    binding, clock, coordinator, ports, riskInput, riskVerdict,
  } = harness('terminal-partial-cold-restart');
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  ports.modes.set('CLOSE:SPOT', {
    localMode: 'EXPIRED_IN_MATCH',
    fillQuantity: '0.04',
  });
  assert.equal((await coordinator.close()).ok, false);
  const checkpoint = coordinator.checkpoint();
  const durableObservations = structuredClone(ports.observations);

  const coldPorts = new TwinBackedFoundationPorts(binding, clock, { riskInput, riskVerdict });
  for (const [phase, key, status, quantity] of [
    ['OPEN', 'SPOT', 'FILLED', 0.1],
    ['OPEN', 'PERP', 'FILLED', 0.1],
    ['CLOSE', 'SPOT', 'CANCELLED', 0.04],
    ['CLOSE', 'PERP', 'FILLED', 0.1],
  ]) {
    coldPorts.queueLookup(`${phase}:${key}`, {
      kind: 'FOUND', status, venueOrderId: null, cumulativeFilledQuantity: quantity,
    });
  }
  const restoredResult = restoreExecutionCoordinator(checkpoint, clock, coldPorts);
  assert.equal(restoredResult.ok, true);
  const restored = restoredResult.coordinator;
  coldPorts.attach(restored);
  const terminalRecovered = await restored.recoverAfterRestart();
  assert.equal(terminalRecovered.ok, false);
  assert.equal(terminalRecovered.failure.code, 'FOUNDATION_RECONCILIATION_PARTIAL');
  assert.equal(restored.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  assert.equal(restored.snapshot().closingLegs.SPOT.lifecycle, 'CANCELLED');
  assert.equal(restored.snapshot().closingLegs.SPOT.cumulativeFilledQuantity, 0.04);
  assert.equal(coldPorts.calls.filter((item) => item.method === 'lookupByClientOrderId').length, 4);
  assert.equal(coldPorts.calls.some((item) => item.method === 'submitPaper'), false);
  const agreement = ownerAgreement(
    binding,
    restored,
    coldPorts,
    clock,
    durableObservations,
  );
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.residualSpotQuantity, '0.06');
  assert.equal(agreement.residualPerpQuantity, '0');
  assert.equal(agreement.workingRemainderVisible, false);
});
