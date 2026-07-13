import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson,
  stableHash128Hex,
} from '../../../dist/foundation/contracts/index.js';
import {
  createExecutionCoordinator,
  recommendExecutionRecovery,
  restoreExecutionCheckpoint,
  restoreExecutionCoordinator,
} from '../../../dist/foundation/execution/index.js';
import {
  reconcileExecutionState,
} from '../../../dist/foundation/reconciliation/index.js';
import {
  evaluateMultiLegRisk,
} from '../../../dist/foundation/risk/index.js';
import {
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  evaluateNormalBasisOwnerAgreement,
  projectNormalBasisOwnerLegOutcome,
  validateNormalBasisTwinLegObservation,
} from '../../../dist/liveEdge/adapters/normalBasis/index.js';
import {
  event,
  orderByFixtureId,
} from '../exchangeTwin/fixtures.mjs';
import {
  buildL05SpotOwnerEvidence,
} from '../mutationJournal/l05-owner-fixture.mjs';
import {
  buildNormalBasisL05Projection,
} from './l05-fixture.mjs';
import {
  ManualClock,
  VENUE_ARRIVAL_MS,
  failure,
  makeNormalBasisBinding,
  makeTwinLegObservation,
  positionModeEvidence,
} from './fixtures.mjs';

const CHECKPOINT_HYDRATOR = Object.freeze({
  hydrateExecutionCheckpoint: restoreExecutionCheckpoint,
});
const RECOVERY_PROVIDER = Object.freeze({
  recommendExecutionRecovery,
});
const RECONCILIATION_POLICY = Object.freeze({
  quantityTolerance: 1e-12,
  normalizedHedgeTolerance: 1e-12,
});
const OWNER_EVIDENCE_AT_MS = VENUE_ARRIVAL_MS - 170;

function ownerRequest(binding, leg) {
  return {
    planId: binding.ownerPlan.planId,
    correlationId: binding.ownerPlan.correlationId,
    symbol: binding.ownerPlan.symbol,
    direction: binding.ownerPlan.direction,
    mode: 'PAPER',
    phase: leg.phase,
    leg,
  };
}

function modeProjection(binding, evaluatedAtMs = OWNER_EVIDENCE_AT_MS) {
  return buildNormalBasisL05Projection({
    accountRealmId: binding.entry.perpLeg.accountRealmId,
    targetSymbol: binding.ownerPlan.symbol,
    evaluatedAtMs,
  });
}

function privateTruth(binding, evaluatedAtMs = OWNER_EVIDENCE_AT_MS) {
  return positionModeEvidence(modeProjection(binding, evaluatedAtMs));
}

function spotPrivateTruth(binding, evaluatedAtMs = OWNER_EVIDENCE_AT_MS) {
  const input = {
    accountRealmId: binding.entry.spotLeg.accountRealmId,
    targetSymbol: binding.ownerPlan.symbol,
    evaluatedAtMs,
  };
  const seed = buildL05SpotOwnerEvidence({
    ...input,
    resultRevision: `foundation-reconciliation-result:${'0'.repeat(24)}`,
  });
  return positionModeEvidence(buildL05SpotOwnerEvidence({
    ...input,
    resultRevision: `foundation-reconciliation-result:${seed.projection
      .reconciliationObservation.sourceCutRevision.slice(-24)}`,
  }).projection);
}

function rehashObservation(value) {
  const {
    schema: _schema,
    observationRevision: _priorRevision,
    ...material
  } = value;
  value.observationRevision = `l09observation_${stableHash128Hex(canonicalJson(material))}`;
  return value;
}

function rehashMutationLineageObservation(value) {
  const {
    lineageRevision: _priorLineageRevision,
    ...lineageMaterial
  } = value.mutationLineage;
  value.mutationLineage.lineageRevision = `l09mutationlineage_${
    stableHash128Hex(canonicalJson(lineageMaterial))
  }`;
  return rehashObservation(value);
}

function differentIdentity(value) {
  return `${value.slice(0, -1)}${value.endsWith('0') ? '1' : '0'}`;
}

function resignCheckpoint(checkpoint) {
  const { checksum: _priorChecksum, ...payload } = checkpoint;
  return canonicalJson({
    ...payload,
    checksum: stableHash128Hex(canonicalJson(payload)),
  });
}

function metadata(nowMs, state, overrides = {}) {
  return {
    sourceId: 'synthetic.normal-basis.owner-evidence',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: nowMs,
    receivedAtMs: nowMs,
    maxAgeMs: 5_000,
    coverageStartMs: state.createdAtMs,
    coverageEndMs: Math.max(state.updatedAtMs, nowMs),
    ...overrides,
  };
}

function orderStatus(lifecycle) {
  if (lifecycle === 'FILLED') return 'FILLED';
  if (lifecycle === 'PARTIALLY_FILLED') return 'PARTIALLY_FILLED';
  if (lifecycle === 'CANCELLED') return 'CANCELED';
  if (lifecycle === 'REJECTED') return 'REJECTED';
  return 'NEW';
}

function signed(side, quantity) {
  return side === 'BUY' ? quantity : -quantity;
}

function expectedDelta(state, key) {
  const opening = state.openingLegs[key];
  const closing = state.closingLegs[key];
  return signed(opening.definition.side, opening.cumulativeFilledQuantity)
    + signed(closing.definition.side, closing.cumulativeFilledQuantity);
}

function exactOwnerEvidence(state, nowMs) {
  const orders = [];
  const fills = [];
  let tradeSequence = 0;
  for (const [phase, record] of [
    ['OPEN', state.openingLegs],
    ['CLOSE', state.closingLegs],
  ]) {
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
      if (leg.cumulativeFilledQuantity <= 0) continue;
      tradeSequence += 1;
      fills.push({
        venue: leg.definition.venue,
        symbol: state.plan.symbol,
        tradeId: `normal-basis-${phase}-${key}-${tradeSequence}`,
        clientOrderId: tradeSequence % 2 === 0 ? null : leg.definition.clientOrderId,
        venueOrderId: leg.venueOrderId,
        side: leg.definition.side,
        quantity: leg.cumulativeFilledQuantity,
        price: 100 + tradeSequence,
        occurredAtMs: nowMs - 200 + tradeSequence,
      });
    }
  }
  return {
    orders: { metadata: metadata(nowMs, state), records: orders },
    fills: { metadata: metadata(nowMs, state), records: fills },
    positions: {
      metadata: metadata(nowMs, state, {
        coverageStartMs: null,
        coverageEndMs: null,
      }),
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

function reconciliationTime(state) {
  return Math.max(VENUE_ARRIVAL_MS + 1_000, state.updatedAtMs + 1_000);
}

function canonicalOwnerReconciliation(state, nowMs = reconciliationTime(state)) {
  return reconcileExecutionState(
    state,
    exactOwnerEvidence(state, nowMs),
    nowMs,
    RECONCILIATION_POLICY,
  );
}

const OWNER_RECONCILIATION_PROVIDER = Object.freeze({
  reconcileExecutionState: canonicalOwnerReconciliation,
});

class CanonicalOwnerPorts {
  constructor() {
    this.claims = new Map();
    this.calls = [];
    this.submissions = new Map();
    this.lookups = new Map();
    this.reconciliationOutcomes = [];
    this.reconciliationResults = [];
    this.submissionCheckpoints = new Map();
    this.coordinator = null;
    this.ownerTruth = null;
  }

  attach(coordinator) {
    this.coordinator = coordinator;
    return this;
  }

  attachOwnerTruth(ownerPlan, riskInput, riskVerdict, clock) {
    assert.equal(typeof clock?.nowMs, 'function', 'owner risk requires the injected clock');
    this.ownerTruth = { ownerPlan, riskInput, riskVerdict, clock };
    return this;
  }

  key(request) {
    return `${request.phase}:${request.leg.key}`;
  }

  queueSubmission(key, ...outcomes) {
    this.submissions.set(key, [...outcomes]);
    return this;
  }

  queueLookup(key, ...outcomes) {
    this.lookups.set(key, [...outcomes]);
    return this;
  }

  queueReconciliation(...outcomes) {
    this.reconciliationOutcomes.push(...outcomes);
    return this;
  }

  claimPlanIdentity(planId, fingerprint) {
    const prior = this.claims.get(planId);
    if (prior === undefined) {
      this.claims.set(planId, fingerprint);
      return 'CLAIMED';
    }
    return prior === fingerprint ? 'EXISTING_SAME' : 'CONFLICT';
  }

  assertCurrentOwnerRisk(plan) {
    const truth = this.ownerTruth;
    assert.ok(truth, 'actual Foundation owner risk truth must be attached');
    assert.equal(
      canonicalJson(plan),
      canonicalJson(truth.ownerPlan),
      'preflight plan must equal the exact Foundation owner plan',
    );
    assert.equal(truth.riskInput.intent.planId, plan.planId);
    assert.equal(truth.riskInput.intent.proposalRef, plan.proposal.canonicalProposalId);
    assert.equal(
      truth.riskInput.intent.declaredMaxNakedDurationMs,
      plan.maxNakedDurationMs,
    );
    for (const key of ['SPOT', 'PERP']) {
      const planLeg = plan.openingLegs[key];
      const riskLeg = truth.riskInput.intent.legs.find((candidate) => (
        candidate.venue === planLeg.venue
      ));
      assert.ok(riskLeg, `risk input must retain the ${key} owner leg`);
      assert.equal(riskLeg.symbol, plan.symbol);
      assert.equal(riskLeg.side, planLeg.side);
      assert.equal(riskLeg.intendedQty, planLeg.quantity);
    }
    const reproduced = evaluateMultiLegRisk(truth.riskInput);
    assert.equal(
      canonicalJson(reproduced),
      canonicalJson(truth.riskVerdict),
      'risk verdict must reproduce from the exact injected owner input',
    );
    assert.equal(truth.riskVerdict.allowed, true, 'owner risk verdict must allow the plan');
    assert.deepEqual(truth.riskVerdict.blockingCodes, []);
    assert.ok(truth.riskVerdict.evaluatedAt <= truth.clock.nowMs());
    assert.ok(truth.clock.nowMs() < truth.riskVerdict.expiresAt, 'owner risk verdict must be current');
    assert.ok(truth.riskVerdict.checks.some((check) => (
      check.code === 'APPROVAL_PRESENT'
        && check.status === 'PASS'
        && check.observed === plan.planId
    )), 'risk verdict must retain exact plan approval evidence');
  }

  async preflight(plan) {
    this.calls.push({ method: 'preflight', planId: plan.planId });
    this.assertCurrentOwnerRisk(plan);
    return { ok: true };
  }

  async validateLeg(request) {
    this.calls.push({ method: 'validateLeg', request });
    const truth = this.ownerTruth;
    assert.ok(truth, 'actual Foundation owner risk truth must be attached');
    this.assertCurrentOwnerRisk(truth.ownerPlan);
    const expectedLeg = request.phase === 'OPEN'
      ? truth.ownerPlan.openingLegs[request.leg.key]
      : truth.ownerPlan.closingLegs[request.leg.key];
    const expectedRequest = {
      planId: truth.ownerPlan.planId,
      correlationId: truth.ownerPlan.correlationId,
      symbol: truth.ownerPlan.symbol,
      direction: truth.ownerPlan.direction,
      mode: truth.ownerPlan.mode,
      phase: request.phase,
      leg: expectedLeg,
    };
    assert.equal(
      canonicalJson(request),
      canonicalJson(expectedRequest),
      'validated leg request must equal one exact Foundation owner leg',
    );
    return { ok: true };
  }

  async submitPaper(request) {
    this.calls.push({ method: 'submitPaper', request });
    assert.ok(this.coordinator, 'Foundation coordinator must be attached before submission');
    this.submissionCheckpoints.set(this.key(request), this.coordinator.checkpoint());
    const queue = this.submissions.get(this.key(request));
    if (queue?.length) {
      const next = queue.shift();
      return typeof next === 'function' ? next(request) : next;
    }
    return {
      kind: 'FILLED',
      venueOrderId: `normal-basis-${request.phase}-${request.leg.key}`,
      cumulativeFilledQuantity: request.leg.quantity,
    };
  }

  async lookupByClientOrderId(request) {
    this.calls.push({ method: 'lookupByClientOrderId', request });
    const queue = this.lookups.get(this.key(request));
    if (queue?.length) return queue.shift();
    return { kind: 'UNRESOLVED', failure: failure('LOOKUP_UNRESOLVED') };
  }

  async reconcile(state) {
    this.calls.push({ method: 'reconcile', planId: state.plan.planId });
    const canonical = canonicalOwnerReconciliation(state);
    this.reconciliationResults.push(canonical);
    const kind = this.reconciliationOutcomes.shift();
    if (canonical.status !== 'EXACT' || kind === undefined) {
      return {
        kind: 'UNRESOLVED',
        failure: failure('CANONICAL_RECONCILIATION_UNRESOLVED'),
      };
    }
    return { kind };
  }
}

async function ownerHarness(suffix, ports = new CanonicalOwnerPorts()) {
  const built = makeNormalBasisBinding({ suffix });
  const clock = new ManualClock();
  ports.attachOwnerTruth(built.ownerPlan, built.riskInput, built.riskVerdict, clock);
  const coordinator = createExecutionCoordinator(built.foundationInput, clock, ports);
  ports.attach(coordinator);
  assert.equal((await coordinator.preflight()).ok, true);
  return { ...built, clock, coordinator, ports };
}

function submittedRequest(ports, identity) {
  const call = ports.calls.find((candidate) => (
    candidate.method === 'submitPaper'
      && `${candidate.request.phase}:${candidate.request.leg.key}` === identity
  ));
  assert.ok(call, `missing ${identity} submission`);
  return call.request;
}

function submissionCheckpoint(ports, identity) {
  const checkpoint = ports.submissionCheckpoints.get(identity);
  assert.equal(typeof checkpoint, 'string', `missing ${identity} submission checkpoint`);
  return checkpoint;
}

function observe({
  binding,
  request,
  stage,
  checkpoint,
  evidence,
  ...overrides
}) {
  return makeTwinLegObservation({
    binding,
    ownerRequest: request,
    stage,
    ownerCheckpoint: checkpoint,
    ownerCheckpointHydrator: CHECKPOINT_HYDRATOR,
    privateTruthEvidence: evidence,
    ...overrides,
  });
}

function agreementInput(binding, coordinator, observations, overrides = {}) {
  const state = coordinator.snapshot();
  const ownerReconciliationEvaluatedAtMs = reconciliationTime(state);
  return {
    foundationBinding: binding,
    ownerCheckpoint: coordinator.checkpoint(),
    ownerCheckpointHydrator: CHECKPOINT_HYDRATOR,
    ownerReconciliationProvider: OWNER_RECONCILIATION_PROVIDER,
    ownerReconciliationEvaluatedAtMs,
    recoveryProvider: RECOVERY_PROVIDER,
    recoveryEvaluatedAtMs: ownerReconciliationEvaluatedAtMs + 1,
    observations,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('owner preflight and leg validation require exact current Foundation risk truth', async () => {
  const built = makeNormalBasisBinding({ suffix: 'risk-bound-owner-ports' });
  const clock = new ManualClock();
  const ports = new CanonicalOwnerPorts().attachOwnerTruth(
    built.ownerPlan,
    built.riskInput,
    built.riskVerdict,
    clock,
  );
  assert.equal((await ports.preflight(built.ownerPlan)).ok, true);
  const spotRequest = ownerRequest(built.binding, built.ownerPlan.openingLegs.SPOT);
  assert.equal((await ports.validateLeg(spotRequest)).ok, true);

  await assert.rejects(
    () => ports.preflight({ ...built.ownerPlan, symbol: 'ETHUSDT' }),
    /exact Foundation owner plan/,
  );
  await assert.rejects(
    () => ports.validateLeg({
      ...spotRequest,
      leg: { ...spotRequest.leg, quantity: 0.09 },
    }),
    /one exact Foundation owner leg/,
  );
  clock.set(built.riskVerdict.expiresAt);
  await assert.rejects(
    () => ports.preflight(built.ownerPlan),
    /risk verdict must be current/,
  );
});

test('close sizing requires a replayed Foundation checkpoint and the exact reduce-only leg definition', async () => {
  const { binding, coordinator, ports } = await ownerHarness('residual-guard');
  assert.equal((await coordinator.open()).ok, true);
  ports.queueReconciliation('CLOSED');
  assert.equal((await coordinator.close()).ok, true);
  const spotEvidence = spotPrivateTruth(binding);
  const perpEvidence = privateTruth(binding);
  const spotCheckpoint = submissionCheckpoint(ports, 'CLOSE:SPOT');
  const perpCheckpoint = submissionCheckpoint(ports, 'CLOSE:PERP');

  const undersizedSpot = {
    ...binding.ownerPlan.closingLegs.SPOT,
    quantity: 0.09,
  };
  assert.throws(() => observe({
    binding,
    request: ownerRequest(binding, undersizedSpot),
    stage: 'EXIT_SPOT',
    checkpoint: spotCheckpoint,
    evidence: spotEvidence,
  }), /exact leg submission cut/);

  const alteredPerpClose = {
    ...binding.ownerPlan.closingLegs.PERP,
    reduceOnly: false,
  };
  assert.throws(() => observe({
    binding,
    request: ownerRequest(binding, alteredPerpClose),
    stage: 'EXIT_PERP',
    checkpoint: perpCheckpoint,
    evidence: perpEvidence,
  }), /leg request is not exact/);

  assert.throws(() => observe({
    binding,
    request: submittedRequest(ports, 'CLOSE:SPOT'),
    stage: 'EXIT_SPOT',
    checkpoint: '',
    evidence: spotEvidence,
  }), /checkpoint/);
});

test('current private truth and exact mutation identity bind both owner submissions', async () => {
  const { binding, coordinator, ports } = await ownerHarness('mutation-lineage-guard');
  assert.equal((await coordinator.open()).ok, true);
  const projection = modeProjection(binding);
  const evidence = positionModeEvidence(projection);
  const spotEvidence = spotPrivateTruth(binding);
  const spot = observe({
    binding,
    request: submittedRequest(ports, 'OPEN:SPOT'),
    stage: 'ENTRY_SPOT',
    checkpoint: submissionCheckpoint(ports, 'OPEN:SPOT'),
    evidence: spotEvidence,
  }).observation;
  const hedge = observe({
    binding,
    request: submittedRequest(ports, 'OPEN:PERP'),
    stage: 'ENTRY_HEDGE',
    checkpoint: submissionCheckpoint(ports, 'OPEN:PERP'),
    evidence,
  }).observation;

  assert.equal(hedge.positionSide, 'BOTH');
  assert.equal(hedge.positionModeProjectionRevision, projection.projectionRevision);
  assert.deepEqual(new Set([
    spot.mutationLineage.requestSequence,
    hedge.mutationLineage.requestSequence,
  ]).size, 2);
  assert.ok(spot.mutationLineage.requestSequence > 0);
  assert.ok(hedge.mutationLineage.requestSequence > 0);
  for (const key of [
    'requestId',
    'intentFingerprint',
    'sanitizedRequestContentHash',
  ]) {
    assert.equal(new Set([
      spot.mutationLineage[key],
      hedge.mutationLineage[key],
    ]).size, 2, `${key} must identify the exact owner mutation`);
  }
  for (const [observation, ownerEvidence] of [
    [spot, spotEvidence],
    [hedge, evidence],
  ]) {
    assert.equal(
      observation.mutationLineage.privateProjectionRevision,
      ownerEvidence.projection.projectionRevision,
    );
    assert.equal(
      observation.mutationLineage.foundationReconciliationResultRevision,
      ownerEvidence.projection.reconciliationObservation.resultRevision,
    );
  }

  const fullAgreementInput = agreementInput(binding, coordinator, [spot, hedge]);
  const fullAgreement = evaluateNormalBasisOwnerAgreement(fullAgreementInput);
  assert.equal(fullAgreement.state, 'PASS');
  assert.deepEqual(fullAgreement.observationRevisions, [
    spot.observationRevision,
    hedge.observationRevision,
  ]);
  assert.throws(() => evaluateNormalBasisOwnerAgreement({
    ...fullAgreementInput,
    observations: [spot],
  }), /one observation for every submitted owner leg/);

  const stale = positionModeEvidence(modeProjection(binding, VENUE_ARRIVAL_MS - 2_000));
  assert.throws(() => observe({
    binding,
    request: submittedRequest(ports, 'OPEN:PERP'),
    stage: 'ENTRY_HEDGE',
    checkpoint: submissionCheckpoint(ports, 'OPEN:PERP'),
    evidence: stale,
  }), /mutation evidence binding time\/state is invalid|not current owner evidence|does not prove current one-way/);

  const altered = structuredClone(evidence);
  altered.projection.permissions[0].usdmDualSidePosition = true;
  assert.throws(() => observe({
    binding,
    request: submittedRequest(ports, 'OPEN:PERP'),
    stage: 'ENTRY_HEDGE',
    checkpoint: submissionCheckpoint(ports, 'OPEN:PERP'),
    evidence: altered,
  }), /projection validation|not reproducible|not revision-coherent|does not prove/);
});

test('agreement replays owner state, consumes full reconciliation, and retains recovery lineage', async () => {
  const ports = new CanonicalOwnerPorts().queueSubmission('OPEN:SPOT', {
    kind: 'PARTIALLY_FILLED',
    venueOrderId: 'normal-basis-partial-owner-spot',
    cumulativeFilledQuantity: 0.04,
  });
  const { binding, coordinator } = await ownerHarness('agreement-guard', ports);
  assert.equal(coordinator.beginOpen().ok, true);
  assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
  const state = coordinator.snapshot();
  assert.equal(state.lifecycle, 'ONE_LEG_EXPOSED');
  assert.equal(state.openingLegs.SPOT.lifecycle, 'PARTIALLY_FILLED');
  const spot = observe({
    binding,
    request: submittedRequest(ports, 'OPEN:SPOT'),
    stage: 'ENTRY_SPOT',
    checkpoint: submissionCheckpoint(ports, 'OPEN:SPOT'),
    evidence: spotPrivateTruth(binding),
    fillQuantity: '0.04',
  }).observation;
  const input = agreementInput(binding, coordinator, [spot]);
  const replayed = restoreExecutionCheckpoint(input.ownerCheckpoint);
  assert.equal(replayed.ok, true);
  assert.equal(canonicalJson(replayed.state), canonicalJson(state));
  const reconciliation = input.ownerReconciliationProvider.reconcileExecutionState(
    state,
    input.ownerReconciliationEvaluatedAtMs,
  );
  assert.equal(reconciliation.status, 'PARTIAL');
  assert.ok(input.recoveryEvaluatedAtMs >= input.ownerReconciliationEvaluatedAtMs);

  const agreement = evaluateNormalBasisOwnerAgreement(input);
  assert.equal(agreement.state, 'MANUAL_ACTION_REQUIRED');
  assert.deepEqual(agreement.reasonCodes, []);
  const retained = agreement.ownerRecommendationsRetained.find((candidate) => (
    candidate.action === 'CANCEL_REMAINDER'
  ));
  const raw = recommendExecutionRecovery(state, input.recoveryEvaluatedAtMs).find((candidate) => (
    candidate.action === 'CANCEL_REMAINDER'
  ));
  assert.ok(retained);
  assert.ok(raw);
  assert.equal(retained.planId, state.plan.planId);
  assert.equal(retained.correlationId, state.plan.correlationId);
  assert.equal(retained.ownerCheckpointChecksum, JSON.parse(input.ownerCheckpoint).checksum);
  assert.equal(retained.ownerRevision, state.revision);
  assert.equal(retained.ownerStateRevision, state.stateRevisionId);
  assert.equal(retained.reconciliationEvidenceRevision, agreement.reconciliationEvidenceRevision);
  assert.equal(retained.evaluatedAtMs, input.recoveryEvaluatedAtMs);
  assert.equal(retained.riskEffect, raw.riskEffect);
  assert.equal(retained.automatic, false);
  assert.equal(retained.phase, 'OPEN');
  assert.equal(retained.legKey, 'SPOT');
  assert.equal(retained.legId, state.openingLegs.SPOT.definition.legId);
  assert.equal(retained.clientOrderId, state.openingLegs.SPOT.definition.clientOrderId);
  assert.equal(retained.reason, raw.reason);
  assert.match(retained.recommendationRevision, /^l09recovery_[0-9a-f]{32}$/);

  const alteredCheckpoint = JSON.parse(input.ownerCheckpoint);
  alteredCheckpoint.state.lifecycle = 'CLOSED';
  const replayMismatch = resignCheckpoint(alteredCheckpoint);
  assert.equal(restoreExecutionCheckpoint(replayMismatch).ok, false);
  assert.throws(() => evaluateNormalBasisOwnerAgreement({
    ...input,
    ownerCheckpoint: replayMismatch,
  }), /checkpoint hydration failed/);

  const alteredReconciliationProvider = {
    reconcileExecutionState(ownerState, evaluatedAtMs) {
      const alteredReconciliation = structuredClone(canonicalOwnerReconciliation(
        ownerState,
        evaluatedAtMs,
      ));
      alteredReconciliation.legs.find((leg) => (
        leg.phase === 'OPEN' && leg.legKey === 'SPOT'
      )).clientOrderId = 'client-order-altered';
      return alteredReconciliation;
    },
  };
  assert.throws(() => evaluateNormalBasisOwnerAgreement({
    ...input,
    ownerReconciliationProvider: alteredReconciliationProvider,
  }), /reconciliation leg lineage diverges/);

  assert.throws(() => evaluateNormalBasisOwnerAgreement({
    ...input,
    recoveryEvaluatedAtMs: input.ownerReconciliationEvaluatedAtMs - 1,
  }), /recovery provider and evaluation time are required/);

  const alteredRecoveryProvider = {
    recommendExecutionRecovery(ownerState, evaluatedAtMs) {
      return recommendExecutionRecovery(ownerState, evaluatedAtMs).map((candidate) => (
        candidate.action !== 'CANCEL_REMAINDER'
          ? candidate
          : { ...candidate, clientOrderId: 'client-order-altered' }
      ));
    },
  };
  assert.throws(() => evaluateNormalBasisOwnerAgreement({
    ...input,
    recoveryProvider: alteredRecoveryProvider,
  }), /different client-order ID/);
});

test('a recomputed observation checksum cannot relabel the accepted owner chain or mutation cut', async () => {
  const { binding, coordinator, ports } = await ownerHarness('rehashed-alias-guard');
  assert.equal(coordinator.beginOpen().ok, true);
  assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
  const filled = observe({
    binding,
    request: submittedRequest(ports, 'OPEN:SPOT'),
    stage: 'ENTRY_SPOT',
    checkpoint: submissionCheckpoint(ports, 'OPEN:SPOT'),
    evidence: spotPrivateTruth(binding),
  }).observation;
  const validInput = agreementInput(binding, coordinator, [filled]);
  assert.equal(evaluateNormalBasisOwnerAgreement(validInput).state, 'MANUAL_ACTION_REQUIRED');

  const relabelled = structuredClone(filled);
  relabelled.policyPlanId = 'epplan_relabelled';
  relabelled.policyLegId = 'leg-relabelled';
  rehashObservation(relabelled);
  assert.throws(
    () => validateNormalBasisTwinLegObservation(
      relabelled,
      binding,
      CHECKPOINT_HYDRATOR,
    ),
    /summary diverges from retained twin truth/,
  );
  assert.throws(() => evaluateNormalBasisOwnerAgreement({
    ...validInput,
    observations: [relabelled],
  }), /summary diverges from retained twin truth/);

  const lineageChanges = {
    requestSequence: 0,
    requestId: differentIdentity(filled.mutationLineage.requestId),
    intentFingerprint: differentIdentity(filled.mutationLineage.intentFingerprint),
    sanitizedRequestContentHash:
      differentIdentity(filled.mutationLineage.sanitizedRequestContentHash),
    privateProjectionRevision:
      differentIdentity(filled.mutationLineage.privateProjectionRevision),
    foundationReconciliationResultRevision:
      differentIdentity(filled.mutationLineage.foundationReconciliationResultRevision),
  };
  for (const [field, alteredValue] of Object.entries(lineageChanges)) {
    const alteredLineage = structuredClone(filled);
    alteredLineage.mutationLineage[field] = alteredValue;
    rehashMutationLineageObservation(alteredLineage);
    assert.throws(() => validateNormalBasisTwinLegObservation(
      alteredLineage,
      binding,
      CHECKPOINT_HYDRATOR,
    ), /summary diverges from retained twin truth/, field);
  }
});

test('recomputed L07 fill evidence cannot bypass retained entry admission', async () => {
  const { binding, coordinator, ports } = await ownerHarness('retained-admission-guard');
  assert.equal(coordinator.beginOpen().ok, true);
  assert.equal((await coordinator.submitNextOpeningLeg()).ok, true);
  const acceptedArtifact = observe({
    binding,
    request: submittedRequest(ports, 'OPEN:SPOT'),
    stage: 'ENTRY_SPOT',
    checkpoint: submissionCheckpoint(ports, 'OPEN:SPOT'),
    evidence: spotPrivateTruth(binding),
    fixtureId: 'fixture-l09-retained-admission-accepted',
  });
  const duplicatedScenario = structuredClone(acceptedArtifact.scenario);
  const retainedOwnerEvidence = duplicatedScenario.events.find((candidate) => (
    candidate.kind === 'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE'
  ));
  const nextSourceSequence = Math.max(...duplicatedScenario.events.map((candidate) => (
    candidate.sourceSequence ?? 0
  ))) + 1;
  duplicatedScenario.events.push(event(
    retainedOwnerEvidence.kind,
    Math.max(...duplicatedScenario.events.map((candidate) => candidate.sequence)) + 1,
    retainedOwnerEvidence.occurredAtMs,
    structuredClone(retainedOwnerEvidence.payload),
    { sourceSequence: nextSourceSequence },
  ));
  const duplicatedState = runExchangeTwinScenario(duplicatedScenario);
  const duplicatedOrder = orderByFixtureId(
    duplicatedState,
    acceptedArtifact.fixture.fixtureId,
  );
  assert.equal(duplicatedOrder.venueStatus, 'FILLED');
  assert.equal(duplicatedOrder.localTruth, 'OBSERVED');
  assert.equal(duplicatedState.preflights.length, 2);

  const altered = structuredClone(acceptedArtifact.observation);
  altered.state = duplicatedState;
  altered.order = duplicatedOrder;
  altered.twinOutcomeRevision = duplicatedState.outcomeRevision;
  rehashObservation(altered);
  assert.throws(
    () => validateNormalBasisTwinLegObservation(
      altered,
      binding,
      CHECKPOINT_HYDRATOR,
    ),
    /exactly one accepted L08\.2 owner-evidence event/,
  );
  assert.throws(
    () => projectNormalBasisOwnerLegOutcome(
      altered,
      binding,
      CHECKPOINT_HYDRATOR,
    ),
    /exactly one accepted L08\.2 owner-evidence event/,
  );
});

test('one canonical close order cannot be counted twice under a recovery label', async () => {
  const { binding, coordinator, ports } = await ownerHarness('close-stage-dedup');
  assert.equal((await coordinator.open()).ok, true);
  ports.queueReconciliation('CLOSED');
  assert.equal((await coordinator.close()).ok, true);
  const close = observe({
    binding,
    request: submittedRequest(ports, 'CLOSE:SPOT'),
    stage: 'EXIT_SPOT',
    checkpoint: submissionCheckpoint(ports, 'CLOSE:SPOT'),
    evidence: spotPrivateTruth(binding),
  }).observation;
  const relabelled = structuredClone(close);
  relabelled.stage = 'RECOVERY_CLOSE_SPOT';
  rehashObservation(relabelled);
  assert.equal(
    validateNormalBasisTwinLegObservation(
      relabelled,
      binding,
      CHECKPOINT_HYDRATOR,
    ),
    relabelled,
  );
  assert.throws(() => evaluateNormalBasisOwnerAgreement(
    agreementInput(binding, coordinator, [close, relabelled]),
  ), /unique mutation identity per owner order/);
});

test('partial opening fill is terminalized through Foundation lookup before checkpoint-sized hedge evidence', async () => {
  const ports = new CanonicalOwnerPorts()
    .queueSubmission('OPEN:SPOT', {
      kind: 'PARTIALLY_FILLED',
      venueOrderId: 'normal-basis-partial-refresh-spot',
      cumulativeFilledQuantity: 0.04,
    })
    .queueLookup('OPEN:SPOT', {
      kind: 'FOUND',
      status: 'CANCELLED',
      venueOrderId: 'normal-basis-partial-refresh-spot',
      cumulativeFilledQuantity: 0.06,
    });
  const { binding, coordinator } = await ownerHarness('partial-fill-owner-seam', ports);
  const opened = await coordinator.open();
  assert.equal(opened.ok, true);
  assert.equal(coordinator.snapshot().lifecycle, 'HEDGED_OPEN');
  assert.equal(coordinator.snapshot().openingLegs.SPOT.lifecycle, 'CANCELLED');
  const hedgeRequest = submittedRequest(ports, 'OPEN:PERP');
  assert.equal(hedgeRequest.leg.quantity, 0.06);
  const lookupIndex = ports.calls.findIndex((candidate) => (
    candidate.method === 'lookupByClientOrderId'
  ));
  const hedgeIndex = ports.calls.findIndex((candidate) => (
    candidate.method === 'submitPaper' && candidate.request.leg.key === 'PERP'
  ));
  assert.ok(lookupIndex >= 0 && hedgeIndex > lookupIndex);
  const reconciliation = canonicalOwnerReconciliation(coordinator.snapshot());
  assert.equal(reconciliation.status, 'PARTIAL', canonicalJson(reconciliation));
  assert.ok(reconciliation.reasons.some((reason) => reason.code === 'PARTIAL_FILL_CONFIRMED'));

  const hedge = observe({
    binding,
    request: hedgeRequest,
    stage: 'ENTRY_HEDGE',
    checkpoint: submissionCheckpoint(ports, 'OPEN:PERP'),
    evidence: privateTruth(binding),
  }).observation;
  assert.equal(hedge.requestedQuantity, '0.06');
  assert.equal(hedge.confirmedFilledQuantity, '0.06');

  const staleSizedHedge = {
    ...binding.ownerPlan.openingLegs.PERP,
    quantity: 0.04,
  };
  assert.throws(() => observe({
    binding,
    request: ownerRequest(binding, staleSizedHedge),
    stage: 'ENTRY_HEDGE',
    checkpoint: submissionCheckpoint(ports, 'OPEN:PERP'),
    evidence: privateTruth(binding),
  }), /exact leg submission cut/);
});

test('cold restart uses Foundation lookup, canonical reconciliation, and checkpoint progression before hedge', async () => {
  const pending = deferred();
  const preCrashPorts = new CanonicalOwnerPorts().queueSubmission(
    'OPEN:SPOT',
    () => pending.promise,
  );
  const {
    binding,
    clock,
    coordinator: preCrash,
  } = await ownerHarness('cold-restart-owner-seam', preCrashPorts);
  const oldOpen = preCrash.open();
  await Promise.resolve();
  assert.equal(preCrash.snapshot().openingLegs.SPOT.lifecycle, 'SUBMITTING');
  const checkpoint = preCrash.checkpoint();

  const coldPorts = new CanonicalOwnerPorts()
    .queueLookup('OPEN:SPOT', {
      kind: 'FOUND',
      status: 'FILLED',
      venueOrderId: 'normal-basis-cold-found-spot',
      cumulativeFilledQuantity: 0.1,
    })
    .queueReconciliation('ONE_LEG_EXPOSED');
  const restored = restoreExecutionCoordinator(checkpoint, clock, coldPorts);
  assert.equal(restored.ok, true);
  coldPorts.attach(restored.coordinator);
  const resumed = await restored.coordinator.submitNextOpeningLeg();
  assert.equal(resumed.ok, true);
  assert.equal(restored.coordinator.snapshot().lifecycle, 'HEDGED_OPEN');
  assert.equal(coldPorts.reconciliationResults.length, 1);
  assert.equal(coldPorts.reconciliationResults[0].status, 'EXACT');
  const lookupIndex = coldPorts.calls.findIndex((candidate) => (
    candidate.method === 'lookupByClientOrderId'
  ));
  const reconcileIndex = coldPorts.calls.findIndex((candidate) => candidate.method === 'reconcile');
  const hedgeIndex = coldPorts.calls.findIndex((candidate) => (
    candidate.method === 'submitPaper' && candidate.request.leg.key === 'PERP'
  ));
  assert.ok(lookupIndex >= 0 && reconcileIndex > lookupIndex && hedgeIndex > reconcileIndex);
  assert.equal(coldPorts.calls.some((candidate) => (
    candidate.method === 'submitPaper' && candidate.request.leg.key === 'SPOT'
  )), false);
  const replayed = restoreExecutionCheckpoint(restored.coordinator.checkpoint());
  assert.equal(replayed.ok, true);
  assert.equal(canonicalJson(replayed.state), canonicalJson(restored.coordinator.snapshot()));

  pending.resolve({
    kind: 'FILLED',
    venueOrderId: 'normal-basis-old-process-spot',
    cumulativeFilledQuantity: 0.1,
  });
  await oldOpen;
  assert.equal(binding.ownerPlan.planId, restored.coordinator.snapshot().plan.planId);
});
