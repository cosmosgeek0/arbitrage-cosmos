import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExecutionCoordinator,
  recommendExecutionRecovery,
  restoreExecutionCoordinator,
} from '../../../dist/foundation/execution/index.js';
import {
  checkpointExchangeTwin,
  restoreExchangeTwin,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  evaluateNormalBasisOwnerAgreement,
  projectNormalBasisOwnerLegOutcome,
  runNormalBasisTwinLeg,
} from '../../../dist/liveEdge/adapters/normalBasis/index.js';
import {
  event,
} from '../exchangeTwin/fixtures.mjs';
import {
  buildNormalBasisL05Projection,
} from './l05-fixture.mjs';
import {
  ManualClock,
  VENUE_ARRIVAL_MS,
  failure,
  makeNormalBasisBinding,
  makeTwinLegObservation,
} from './fixtures.mjs';

function recommendations(state, atMs) {
  return recommendExecutionRecovery(state, atMs).map((item) => ({
    action: item.action,
    riskEffect: item.riskEffect,
    automatic: item.automatic,
  }));
}

class TwinBackedFoundationPorts {
  constructor(binding, modeProjection, modes = {}) {
    this.binding = binding;
    this.modeProjection = modeProjection;
    this.modes = new Map(Object.entries(modes));
    this.identityClaims = new Map();
    this.calls = [];
    this.observations = [];
    this.lookups = new Map();
    this.reconciliations = [];
    this.artifacts = new Map();
    this.coordinator = null;
    this.recoveryMode = false;
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
    return { ok: true };
  }

  async validateLeg(request) {
    this.calls.push({ method: 'validateLeg', request });
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
    const priorSpotObservation = stage === 'ENTRY_HEDGE'
      ? this.observations.find((item) => item.stage === 'ENTRY_SPOT') ?? null
      : null;
    const ownerState = request.phase === 'CLOSE' ? this.coordinator.snapshot() : null;
    const artifact = makeTwinLegObservation({
      binding: this.binding,
      ownerRequest: request,
      stage,
      priorSpotObservation,
      ownerState,
      modeProjection: this.modeProjection,
      localMode: mode.localMode ?? 'OBSERVED',
      fillQuantity: mode.fillQuantity,
    });
    const { observation } = artifact;
    this.artifacts.set(request.leg.clientOrderId, {
      ...artifact,
      ownerRequest: request,
      stage,
    });
    this.observations.push(observation);
    return projectNormalBasisOwnerLegOutcome(observation, this.binding);
  }

  queueLookup(key, ...outcomes) {
    this.lookups.set(key, [...outcomes]);
    return this;
  }

  queueReconciliation(...outcomes) {
    this.reconciliations.push(...outcomes);
    return this;
  }

  async lookupByClientOrderId(request) {
    this.calls.push({ method: 'lookupByClientOrderId', request });
    const queue = this.lookups.get(`${request.phase}:${request.leg.key}`);
    const outcome = queue?.shift()
      ?? { kind: 'UNRESOLVED', failure: failure('TWIN_LOOKUP_UNRESOLVED') };
    if (outcome.kind === 'FOUND' && outcome.status === 'FILLED') {
      const stage = this.stage(request);
      const existingIndex = this.observations.findIndex((item) => (
        item.stage === stage
          && item.deterministicClientOrderId === request.leg.clientOrderId
      ));
      assert.notEqual(existingIndex, -1, 'lookup must refresh an existing twin observation');
      const existing = this.observations[existingIndex];
      const priorArtifact = this.artifacts.get(request.leg.clientOrderId);
      assert.ok(priorArtifact, 'lookup must retain the original one-dispatch twin scenario');
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
        priorSpotObservation: existing.priorSpotObservationEvidence,
        ownerState: existing.ownerStateEvidence,
        positionModeEvidence: existing.positionModeEvidence,
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
    if (this.reconciliations.length > 0) return this.reconciliations.shift();
    const spot = Math.max(
      0,
      state.openingLegs.SPOT.cumulativeFilledQuantity
        - state.closingLegs.SPOT.cumulativeFilledQuantity,
    );
    const perp = Math.max(
      0,
      state.openingLegs.PERP.cumulativeFilledQuantity
        - state.closingLegs.PERP.cumulativeFilledQuantity,
    );
    if (spot === 0 && perp === 0) return { kind: 'CLOSED' };
    const spotRatio = spot / state.openingLegs.SPOT.definition.quantity;
    const perpRatio = perp / state.openingLegs.PERP.definition.quantity;
    return Math.abs(spotRatio - perpRatio) < 1e-12
      ? { kind: 'HEDGED_OPEN' }
      : { kind: 'ONE_LEG_EXPOSED' };
  }
}

function harness(suffix, modes = {}, maxNakedDurationMs = 1_000) {
  const built = makeNormalBasisBinding({ suffix, maxNakedDurationMs });
  const projection = buildNormalBasisL05Projection({
    accountRealmId: built.binding.entry.perpLeg.accountRealmId,
    targetSymbol: built.binding.ownerPlan.symbol,
    evaluatedAtMs: VENUE_ARRIVAL_MS,
  });
  const clock = new ManualClock();
  const ports = new TwinBackedFoundationPorts(built.binding, projection, modes);
  const coordinator = createExecutionCoordinator(built.foundationInput, clock, ports);
  ports.attach(coordinator);
  return { ...built, clock, coordinator, ports, projection };
}

test('full staged open hedges the confirmed Spot fill, then both canonical closes reconcile CLOSED', async () => {
  const { binding, clock, coordinator, ports, projection } = harness('full-loop');
  assert.equal((await coordinator.preflight()).ok, true);
  const opened = await coordinator.open();
  assert.equal(opened.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'HEDGED_OPEN');
  const [spotOpen, perpOpen] = ports.observations;
  assert.equal(spotOpen.stage, 'ENTRY_SPOT');
  assert.equal(spotOpen.confirmedFilledQuantity, '0.1');
  assert.equal(perpOpen.stage, 'ENTRY_HEDGE');
  assert.equal(perpOpen.requestedQuantity, spotOpen.confirmedFilledQuantity);
  assert.equal(perpOpen.priorObservationRevision, spotOpen.observationRevision);
  assert.equal(perpOpen.positionModeProjectionRevision, projection.projectionRevision);
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
  assert.equal(closed.ok, true);
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
  assert.equal(perpClose.positionModeProjectionRevision, projection.projectionRevision);

  const state = coordinator.snapshot();
  const agreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: state,
    observations: ports.observations,
    recoveryRecommendations: recommendations(state, clock.nowMs()),
  });
  assert.equal(agreement.state, 'PASS', agreement.reasonCodes.join(','));
  assert.equal(agreement.residualSpotQuantity, '0');
  assert.equal(agreement.residualPerpQuantity, '0');
  assert.equal(agreement.netBaseQuantity, '0');
});

test('partial first fill hedges only the confirmed amount and retains the GTC remainder visibly', async () => {
  const { binding, clock, coordinator, ports } = harness('partial-spot', {
    'OPEN:SPOT': { fillQuantity: '0.04' },
  });
  assert.equal((await coordinator.preflight()).ok, true);
  const opened = await coordinator.open();
  assert.equal(opened.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'ONE_LEG_EXPOSED');
  const [spot, hedge] = ports.observations;
  assert.equal(spot.localDisposition, 'PARTIALLY_FILLED');
  assert.equal(spot.confirmedFilledQuantity, '0.04');
  assert.equal(spot.remainingQuantity, '0.06');
  assert.equal(spot.terminalStatus, null);
  assert.equal(hedge.requestedQuantity, '0.04');
  assert.equal(hedge.confirmedFilledQuantity, '0.04');
  const hedgeCall = ports.calls.find((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'PERP'
  ));
  assert.equal(hedgeCall.request.leg.quantity, 0.04);
  const state = coordinator.snapshot();
  const recs = recommendations(state, clock.nowMs());
  assert.ok(recs.some((item) => item.action === 'CANCEL_REMAINDER'));
  assert.ok(recs.every((item) => item.automatic === false && item.riskEffect !== 'RISK_INCREASING'));
  const agreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: state,
    observations: ports.observations,
    recoveryRecommendations: recs,
  });
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.manualActionRequired, true);
  assert.equal(agreement.workingRemainderVisible, true);
  assert.equal(agreement.unhedgedBaseQuantity, '0');

  const spotSubmit = ports.calls.find((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'SPOT'
  ));
  ports.queueReconciliation({
    kind: 'UNRESOLVED',
    failure: failure('PARTIAL_SPOT_REMAINDER_UNRESOLVED'),
  });
  const reconciled = await coordinator.reconcile();
  assert.equal(reconciled.ok, false);
  assert.equal(coordinator.snapshot().lifecycle, 'RECOVERY_REQUIRED');
  const recovery = recommendExecutionRecovery(coordinator.snapshot(), clock.nowMs());
  assert.ok(recovery.some((item) => (
    item.action === 'CANCEL_REMAINDER'
      && item.clientOrderId === spotSubmit.request.leg.clientOrderId
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
  const state = coordinator.snapshot();
  const agreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: state,
    observations: ports.observations,
    recoveryRecommendations: recommendations(state, clock.nowMs()),
  });
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.manualActionRequired, true);
  assert.equal(agreement.residualSpotQuantity, '0.1');
  assert.equal(agreement.residualPerpQuantity, '0.04');
  assert.equal(agreement.unhedgedBaseQuantity, '0.06');

  const hedgeSubmit = ports.calls.find((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'PERP'
  ));
  ports.queueReconciliation({
    kind: 'UNRESOLVED',
    failure: failure('PARTIAL_HEDGE_REMAINDER_UNRESOLVED'),
  });
  const reconciled = await coordinator.reconcile();
  assert.equal(reconciled.ok, false);
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
  assert.equal(recovered.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'CLOSED');
  const recoveryCloses = ports.observations.filter((item) => item.stage.startsWith('RECOVERY_CLOSE_'));
  assert.deepEqual(recoveryCloses.map((item) => item.stage), ['RECOVERY_CLOSE_SPOT']);
  assert.equal(recoveryCloses[0].side, 'SELL');
  assert.equal(recoveryCloses[0].reduceOnly, false);
  assert.ok(coordinator.snapshot().eventLog.some((item) => (
    item.type === 'CLOSE_REQUESTED' && item.emergency === true
  )));

  const state = coordinator.snapshot();
  const agreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: state,
    observations: ports.observations,
    recoveryRecommendations: recommendations(state, clock.nowMs()),
  });
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
  const recs = recommendations(state, clock.nowMs());
  assert.ok(recs.some((item) => item.action === 'VERIFY_AMBIGUOUS_ORDER'));
  assert.ok(recs.some((item) => item.action === 'MANUAL_REVIEW'));
  const agreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: state,
    observations: ports.observations,
    recoveryRecommendations: recs,
  });
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED');
  assert.equal(agreement.manualActionRequired, true);
  assert.equal(agreement.ambiguityVisible, true);

  const foundationCheckpoint = coordinator.checkpoint();
  assert.equal(coordinator.checkpoint(), foundationCheckpoint);
  const twinRestored = restoreExchangeTwin(checkpointExchangeTwin(observation.state));
  assert.deepEqual(twinRestored, observation.state);
  const restoredResult = restoreExecutionCoordinator(foundationCheckpoint, clock, ports);
  assert.equal(restoredResult.ok, true);
  const restored = restoredResult.coordinator;
  ports.attach(restored);

  ports.queueLookup('OPEN:SPOT', {
    kind: 'FOUND',
    status: 'FILLED',
    venueOrderId: 'lookup-ambiguous-spot',
    cumulativeFilledQuantity: 0.1,
  });
  const resolved = await restored.resolveOutstandingAmbiguity('OPEN', 'SPOT');
  assert.equal(resolved.ok, true);
  const refreshedSpot = ports.observations.find((item) => item.stage === 'ENTRY_SPOT');
  assert.equal(refreshedSpot.deterministicClientOrderId, observation.deterministicClientOrderId);
  assert.notEqual(refreshedSpot.observationRevision, observation.observationRevision);
  assert.equal(refreshedSpot.localDisposition, 'FILLED');
  assert.equal(refreshedSpot.confirmedFilledQuantity, '0.1');
  const spotSubmits = ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'SPOT'
  ));
  const spotLookups = ports.calls.filter((item) => (
    item.method === 'lookupByClientOrderId' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'SPOT'
  ));
  assert.equal(spotSubmits.length, 1);
  assert.equal(spotLookups.length, 2);
  assert.ok(spotLookups.every((item) => (
    item.request.leg.clientOrderId === spotSubmits[0].request.leg.clientOrderId
  )));
  assert.ok(restored.snapshot().eventLog.some((item) => (
    item.type === 'LEG_RESPONSE_AMBIGUOUS'
  )));
  const resolvedArtifact = ports.artifacts.get(spotSubmits[0].request.leg.clientOrderId);
  assert.ok(resolvedArtifact);
  assert.equal(resolvedArtifact.scenario.events.filter((item) => (
    item.kind === 'PLACE_DISPATCH'
  )).length, 1);
  assert.equal(resolvedArtifact.observation.state.processedEvents.filter((item) => (
    item.kind === 'PLACE_DISPATCH'
  )).length, 1);
  assert.equal(resolvedArtifact.observation.state.processedEvents.filter((item) => (
    item.kind === 'RECONCILIATION_OBSERVATION'
  )).length, 1);

  const reconciled = await restored.reconcile();
  assert.equal(reconciled.ok, true);
  assert.equal(restored.snapshot().lifecycle, 'ONE_LEG_EXPOSED');
  const hedged = await restored.submitNextOpeningLeg();
  assert.equal(hedged.ok, true);
  assert.equal(restored.snapshot().lifecycle, 'HEDGED_OPEN');
  const closed = await restored.close();
  assert.equal(closed.ok, true);
  assert.equal(restored.snapshot().lifecycle, 'CLOSED');
  const finalState = restored.snapshot();
  assert.equal(finalState.eventLog.filter((item) => (
    item.type === 'LEG_SUBMISSION_STARTED'
      && item.phase === 'OPEN' && item.legKey === 'SPOT'
  )).length, 1);
  assert.equal(finalState.eventLog.filter((item) => (
    item.type === 'LEG_RESPONSE_AMBIGUOUS'
      && item.phase === 'OPEN' && item.legKey === 'SPOT'
  )).length, 1);
  assert.equal(finalState.eventLog.filter((item) => (
    item.type === 'LEG_AMBIGUITY_RESOLVED'
      && item.phase === 'OPEN' && item.legKey === 'SPOT'
  )).length, 1);
  const finalAgreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: finalState,
    observations: ports.observations,
    recoveryRecommendations: recommendations(finalState, clock.nowMs()),
  });
  assert.equal(finalAgreement.state, 'PASS', finalAgreement.reasonCodes.join(','));
  assert.equal(finalAgreement.residualSpotQuantity, '0');
  assert.equal(finalAgreement.residualPerpQuantity, '0');
});

test('Foundation and twin checkpoints restore between legs without resubmitting Spot', async () => {
  const { binding, clock, coordinator, ports } = harness('restart');
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal(coordinator.beginOpen().ok, true);
  assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'ONE_LEG_EXPOSED');
  const spot = ports.observations[0];
  const twinRestored = restoreExchangeTwin(checkpointExchangeTwin(spot.state));
  assert.deepEqual(twinRestored, spot.state);
  const checkpointA = coordinator.checkpoint();
  const checkpointB = coordinator.checkpoint();
  assert.equal(checkpointB, checkpointA);
  const restoredResult = restoreExecutionCoordinator(checkpointA, clock, ports);
  assert.equal(restoredResult.ok, true);
  const restored = restoredResult.coordinator;
  ports.attach(restored);
  assert.equal((await restored.submitNextOpeningLeg()).ok, true);
  assert.equal(restored.snapshot().lifecycle, 'HEDGED_OPEN');
  assert.equal(ports.calls.filter((item) => (
    item.method === 'submitPaper' && item.request.phase === 'OPEN'
      && item.request.leg.key === 'SPOT'
  )).length, 1);
  const hedge = ports.observations.find((item) => item.stage === 'ENTRY_HEDGE');
  assert.equal(hedge.requestedQuantity, spot.confirmedFilledQuantity);
  assert.equal(hedge.priorObservationRevision, spot.observationRevision);
  assert.equal(restored.snapshot().plan.correlationId, binding.ownerPlan.correlationId);
});

test('first-leg rejection has no exposure, reaches FAILED and never admits a hedge', async () => {
  const { coordinator, ports } = harness('spot-reject', {
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
  const state = coordinator.snapshot();
  const agreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: state,
    observations: ports.observations,
    recoveryRecommendations: recommendations(state, clock.nowMs()),
  });
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.manualActionRequired, true);
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
  const reconciled = await coordinator.reconcile();
  assert.equal(reconciled.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'HEDGED_OPEN');
  const closed = await coordinator.close();
  assert.equal(closed.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'CLOSED');
  const finalState = coordinator.snapshot();
  const finalAgreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: finalState,
    observations: ports.observations,
    recoveryRecommendations: recommendations(finalState, clock.nowMs()),
  });
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
  const state = coordinator.snapshot();
  const agreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: state,
    observations: ports.observations,
    recoveryRecommendations: recommendations(state, clock.nowMs()),
  });
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED', agreement.reasonCodes.join(','));
  assert.equal(agreement.manualActionRequired, true);
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
  const finalState = coordinator.snapshot();
  const finalAgreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: finalState,
    observations: ports.observations,
    recoveryRecommendations: recommendations(finalState, clock.nowMs()),
  });
  assert.equal(finalAgreement.state, 'PASS', finalAgreement.reasonCodes.join(','));
  assert.equal(finalAgreement.residualSpotQuantity, '0');
  assert.equal(finalAgreement.residualPerpQuantity, '0');
});
