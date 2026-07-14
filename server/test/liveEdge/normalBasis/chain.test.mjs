import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  canonicalJson,
} from '../../../dist/foundation/contracts/index.js';
import {
  createExecutionCoordinator,
  restoreExecutionCheckpoint,
} from '../../../dist/foundation/execution/index.js';
import {
  reconcileExecutionState,
} from '../../../dist/foundation/reconciliation/index.js';
import {
  deriveTransportRequestId,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/identity.js';
import {
  evaluateSyntheticSubmissionBoundary,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  bindNormalBasisFoundationPlan,
  evaluateNormalBasisEntryBinding,
  projectNormalBasisOwnerLegOutcome,
  runNormalBasisTwinLeg,
  validateNormalBasisTwinLegObservation,
} from '../../../dist/liveEdge/adapters/normalBasis/index.js';
import {
  event,
} from '../exchangeTwin/fixtures.mjs';
import {
  T0 as L06_T0,
  inputFixture as mutationInputFixture,
  submittingPersisted,
} from '../mutationJournal/fixtures.mjs';
import {
  ManualClock,
  makeNormalBasisBinding,
  makeTwinLegObservation,
} from './fixtures.mjs';

const ownerCheckpointHydrator = Object.freeze({
  hydrateExecutionCheckpoint(serializedCheckpoint) {
    return restoreExecutionCheckpoint(serializedCheckpoint);
  },
});

const reconciliationPolicy = Object.freeze({
  quantityTolerance: 1e-9,
  normalizedHedgeTolerance: 1e-9,
});

function ownerOrderStatus(observation) {
  if (observation.order.localTruth !== 'OBSERVED') return 'UNKNOWN';
  if (observation.order.venueStatus === 'BLOCKED') return 'REJECTED';
  if (observation.order.venueStatus === 'CANCELED') return 'CANCELED';
  if (observation.order.venueStatus === 'EXPIRED'
    || observation.order.venueStatus === 'EXPIRED_IN_MATCH') return 'EXPIRED';
  if (observation.order.venueStatus === 'REJECTED') return 'REJECTED';
  if (observation.order.venueStatus === 'FILLED') return 'FILLED';
  if (observation.order.venueStatus === 'PARTIALLY_FILLED') return 'PARTIALLY_FILLED';
  return 'NEW';
}

function canonicalOwnerEvidence(state, artifacts, evaluatedAtMs) {
  const rows = artifacts.map((artifact) => {
    const { observation, ownerRequest } = artifact;
    const cumulativeFilledQuantity = observation.order.localTruth === 'OBSERVED'
      ? Number(observation.order.filledQuantity) : 0;
    return {
      observation,
      ownerRequest,
      cumulativeFilledQuantity,
      venueOrderId: `twin-order-${observation.twinFixtureId}`,
      updatedAtMs: Math.min(
        observation.order.lastLocalObservationAtMs
          ?? observation.order.lastVenueEffectAtMs
          ?? evaluatedAtMs,
        evaluatedAtMs,
      ),
    };
  });
  const metadata = {
    sourceId: 'normal-basis.chain-owner-evidence',
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceTimeMs: evaluatedAtMs,
    receivedAtMs: evaluatedAtMs,
    maxAgeMs: 5_000,
    coverageStartMs: state.createdAtMs,
    coverageEndMs: evaluatedAtMs,
  };
  const orders = rows.map((row) => ({
    venue: row.ownerRequest.leg.venue,
    symbol: row.ownerRequest.symbol,
    clientOrderId: row.ownerRequest.leg.clientOrderId,
    venueOrderId: row.venueOrderId,
    side: row.ownerRequest.leg.side,
    originalQuantity: row.ownerRequest.leg.quantity,
    cumulativeFilledQuantity: row.cumulativeFilledQuantity,
    status: ownerOrderStatus(row.observation),
    reduceOnly: row.ownerRequest.leg.reduceOnly,
    updatedAtMs: row.updatedAtMs,
  }));
  const fills = rows.filter((row) => row.cumulativeFilledQuantity > 0).map((row) => ({
    venue: row.ownerRequest.leg.venue,
    symbol: row.ownerRequest.symbol,
    tradeId: `twin-fill-${row.ownerRequest.leg.clientOrderId}`,
    clientOrderId: row.ownerRequest.leg.clientOrderId,
    venueOrderId: row.venueOrderId,
    side: row.ownerRequest.leg.side,
    quantity: row.cumulativeFilledQuantity,
    price: Number(row.observation.order.fixture.price),
    occurredAtMs: row.updatedAtMs,
  }));
  const observedPosition = (venue) => rows.filter((row) => (
    row.ownerRequest.leg.venue === venue
  )).reduce((quantity, row) => (
    quantity + (row.ownerRequest.leg.side === 'BUY'
      ? row.cumulativeFilledQuantity : -row.cumulativeFilledQuantity)
  ), 0);
  return {
    orders: { metadata, records: orders },
    fills: { metadata, records: fills },
    positions: {
      metadata: { ...metadata, coverageStartMs: null, coverageEndMs: null },
      records: [
        {
          venue: 'BINANCE_SPOT',
          symbol: state.plan.symbol,
          positionSide: 'NET',
          quantity: observedPosition('BINANCE_SPOT'),
          baselineQuantity: 0,
          observedAtMs: evaluatedAtMs,
        },
        {
          venue: 'BINANCE_USDM',
          symbol: state.plan.symbol,
          positionSide: 'BOTH',
          quantity: observedPosition('BINANCE_USDM'),
          baselineQuantity: 0,
          observedAtMs: evaluatedAtMs,
        },
      ],
    },
  };
}

function stageFor(request) {
  if (request.phase === 'OPEN') return request.leg.key === 'SPOT'
    ? 'ENTRY_SPOT' : 'ENTRY_HEDGE';
  return request.leg.key === 'SPOT' ? 'EXIT_SPOT' : 'EXIT_PERP';
}

function expectedOwnerLeg(binding, request) {
  return request.phase === 'OPEN'
    ? binding.ownerPlan.openingLegs[request.leg.key]
    : binding.ownerPlan.closingLegs[request.leg.key];
}

function lifecycleHarness(options = {}) {
  const built = makeNormalBasisBinding(options);
  const identityClaims = new Map();
  const observations = [];
  const artifacts = [];
  const reconciliations = [];
  const calls = [];
  let coordinator = null;
  const ports = {
    claimPlanIdentity(planId, termsFingerprint) {
      const existing = identityClaims.get(planId);
      if (existing === undefined) {
        identityClaims.set(planId, termsFingerprint);
        return 'CLAIMED';
      }
      return existing === termsFingerprint ? 'EXISTING_SAME' : 'CONFLICT';
    },
    async preflight(plan) {
      calls.push({ method: 'preflight', planId: plan.planId });
      assert.equal(plan.planId, built.binding.ownerPlan.planId);
      assert.equal(plan.termsFingerprint, built.binding.ownerPlan.termsFingerprint);
      assert.equal(built.riskInput.intent.planId, plan.planId);
      assert.equal(built.riskInput.intent.proposalRef, plan.proposal.canonicalProposalId);
      assert.equal(built.riskVerdict.allowed, true);
      assert.deepEqual(built.riskVerdict.blockingCodes, []);
      assert.equal(built.riskVerdict.evaluatedAt, built.riskInput.nowMs);
      assert.ok(built.riskVerdict.expiresAt > clock.nowMs());
      assert.ok(built.riskVerdict.checks.some((check) => (
        check.code === 'APPROVAL_PRESENT'
          && check.status === 'PASS'
          && check.observed === plan.planId
      )));
      return { ok: true };
    },
    async validateLeg(request) {
      calls.push({ method: 'validateLeg', request });
      const expected = expectedOwnerLeg(built.binding, request);
      assert.equal(request.planId, built.binding.ownerPlan.planId);
      assert.equal(request.correlationId, built.binding.ownerPlan.correlationId);
      assert.equal(request.leg.legId, expected.legId);
      assert.equal(request.leg.clientOrderId, expected.clientOrderId);
      assert.equal(built.riskVerdict.allowed, true);
      return { ok: true };
    },
    async submitPaper(request) {
      calls.push({ method: 'submitPaper', request });
      assert.ok(coordinator, 'Foundation coordinator must exist before submission');
      const ownerCheckpoint = coordinator.checkpoint();
      const artifact = makeTwinLegObservation({
        binding: built.binding,
        ownerRequest: request,
        stage: stageFor(request),
        ownerCheckpoint,
        ownerCheckpointHydrator,
      });
      const retained = {
        ...artifact,
        ownerCheckpoint,
        ownerRequest: request,
      };
      artifacts.push(retained);
      observations.push(artifact.observation);
      return projectNormalBasisOwnerLegOutcome(
        artifact.observation,
        built.binding,
        ownerCheckpointHydrator,
      );
    },
    async lookupByClientOrderId(request) {
      calls.push({ method: 'lookupByClientOrderId', request });
      throw new Error('full-fill identity proof must not require an owner lookup');
    },
    async reconcile(state) {
      calls.push({ method: 'reconcile', planId: state.plan.planId });
      assert.equal(state.lifecycle, 'RECONCILING');
      const evaluatedAtMs = Math.max(clock.nowMs(), state.updatedAtMs);
      const reconciliation = reconcileExecutionState(
        state,
        canonicalOwnerEvidence(state, artifacts, evaluatedAtMs),
        evaluatedAtMs,
        reconciliationPolicy,
      );
      reconciliations.push(reconciliation);
      if (reconciliation.status === 'EXACT'
        && reconciliation.recommendation === 'NO_ACTION'
        && reconciliation.executionAuthority === 'NONE'
        && reconciliation.legs.length === 4
        && reconciliation.legs.every((leg) => leg.status === 'EXACT')
        && reconciliation.positions.length === 2
        && new Set(reconciliation.positions.map((position) => position.venue)).size === 2
        && reconciliation.positions.every((position) => (
          position.status === 'EXACT'
            && position.observedDeltaQuantity !== null
            && Math.abs(position.observedDeltaQuantity) <= reconciliationPolicy.quantityTolerance
        ))) {
        return { kind: 'CLOSED' };
      }
      return {
        kind: 'UNRESOLVED',
        failure: {
          code: `FOUNDATION_RECONCILIATION_${reconciliation.status}`,
          message: `Canonical Foundation reconciliation did not prove an exact closed aggregate: ${reconciliation.reasons
            .map((reason) => reason.code).join(',') || 'NO_REASON_CODE'}.`,
          retryable: true,
          recommendedOperatorAction: 'Refresh owner evidence before retrying reconciliation.',
        },
      };
    },
  };
  const clock = new ManualClock();
  coordinator = createExecutionCoordinator(built.foundationInput, clock, ports);
  return {
    ...built,
    artifacts,
    calls,
    clock,
    coordinator,
    observations,
    reconciliations,
  };
}

async function completeLifecycle(options = {}) {
  const harness = lifecycleHarness(options);
  const preflight = await harness.coordinator.preflight();
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  const open = await harness.coordinator.open();
  assert.equal(open.ok, true, JSON.stringify(open));
  assert.equal(harness.coordinator.snapshot().lifecycle, 'HEDGED_OPEN');
  const close = await harness.coordinator.close();
  assert.equal(close.ok, true, JSON.stringify(close));
  assert.equal(harness.coordinator.snapshot().lifecycle, 'CLOSED');
  assert.equal(harness.reconciliations.length, 1);
  assert.equal(harness.reconciliations[0].status, 'EXACT');
  assert.equal(harness.reconciliations[0].recommendation, 'NO_ACTION');
  return harness;
}

function runRetainedScenario(harness, artifact, scenario) {
  return runNormalBasisTwinLeg({
    binding: harness.binding,
    stage: artifact.observation.stage,
    ownerRequest: artifact.ownerRequest,
    scenario,
    ownerCheckpoint: artifact.ownerCheckpoint,
    ownerCheckpointHydrator,
    privateTruthEvidence: artifact.observation.positionModeEvidence,
  });
}

function differentHexRevision(value) {
  const last = value.at(-1);
  return `${value.slice(0, -1)}${last === '0' ? '1' : '0'}`;
}

function coherentZeroSequenceScenario(scenario) {
  const substituted = structuredClone(scenario);
  const fixture = substituted.fixtures[0];
  const snapshot = fixture.l06Snapshot;
  const requestSequence = 0;
  const requestId = deriveTransportRequestId({
    contractId: snapshot.identity.contractId,
    product: snapshot.identity.product,
    environment: snapshot.identity.environment,
    signerProfile: snapshot.identity.signerProfile,
    correlationId: snapshot.identity.globalCorrelationId,
    requestSequence,
    intentFingerprint: snapshot.identity.intentFingerprint,
  }).requestId;
  const created = snapshot.entries[0];
  const persisted = submittingPersisted(mutationInputFixture({
    identity: {
      ...snapshot.identity,
      requestSequence,
      requestId,
    },
    bindings: snapshot.bindings,
    preflightResult: created.payload.preflightResult,
    requestedQuantity: snapshot.requestedQuantity,
    createdAtMs: created.receivedAtMs,
  }));
  substituted.fixtures[0] = {
    ...fixture,
    l06Snapshot: persisted.snapshot,
    l06Boundary: evaluateSyntheticSubmissionBoundary(persisted, L06_T0 + 4),
  };
  return substituted;
}

test('accepted L08.1 plan feeds the exact Spot BUY LIMIT/GTC owner seam into L07', async () => {
  const harness = await completeLifecycle({ suffix: 'chain' });
  const { binding, capability } = harness;
  assert.equal(binding.entry.plan.sequenceMode, 'ORDERED');
  assert.deepEqual(binding.entry.plan.actions.map((action) => ({
    step: action.step,
    product: binding.entry.plan.legs.find((leg) => leg.legId === action.legId).product,
    side: binding.entry.plan.legs.find((leg) => leg.legId === action.legId).side,
    orderType: action.orderType,
    timeInForce: action.timeInForce,
    quantitySource: action.quantitySource,
  })), [
    {
      step: 0, product: 'SPOT', side: 'BUY', orderType: 'LIMIT', timeInForce: 'GTC',
      quantitySource: 'AUTHORIZED_FILTERED_QUANTITY',
    },
    {
      step: 1, product: 'USD_M_PERPETUAL', side: 'SELL', orderType: 'LIMIT', timeInForce: 'GTC',
      quantitySource: 'ACTUAL_FILL_OF_LEG',
    },
  ]);
  assert.equal(binding.entry.perpAction.dependsOnActualFillLegId, binding.entry.spotLeg.legId);
  assert.ok(binding.entry.plan.evidenceRevisions.includes(
    `SPOT_ORDER_TIF_CAPABILITY:${capability.capabilityRevision}`,
  ));

  const observation = harness.observations[0];
  assert.equal(observation.stage, 'ENTRY_SPOT');
  assert.equal(observation.localDisposition, 'FILLED');
  assert.equal(observation.confirmedFilledQuantity, '0.1');
  assert.equal(observation.order.venueStatus, 'FILLED');
  assert.deepEqual(observation.order.blockedReasonCodes, []);
  assert.equal(observation.state.preflights[0].ownerEvidenceKind, 'L081_SPOT_LIMIT_TIF');
  assert.equal(observation.state.preflights[0].result.ok, true);
  assert.equal(
    observation.state.preflights[0].expectedCapabilityRevision,
    capability.capabilityRevision,
  );
  assert.equal(validateNormalBasisTwinLegObservation(
    observation,
    binding,
    ownerCheckpointHydrator,
  ), observation);
  assert.deepEqual(projectNormalBasisOwnerLegOutcome(
    observation,
    binding,
    ownerCheckpointHydrator,
  ), {
    kind: 'FILLED', venueOrderId: null, cumulativeFilledQuantity: 0.1,
  });
  assert.equal(observation.sendEligible, false);
  assert.equal(observation.externalActionAuthorization, 'NONE');
});

test('entry venue arrival at the accepted policy expiry is rejected before twin mutation', async () => {
  const harness = await completeLifecycle({ suffix: 'entry-expiry-boundary' });
  const artifact = harness.artifacts.find((candidate) => (
    candidate.observation.stage === 'ENTRY_SPOT'
  ));
  const staleScenario = structuredClone(artifact.scenario);
  const arrivalIndex = staleScenario.events.findIndex((candidate) => (
    candidate.kind === 'VENUE_ARRIVAL'
  ));
  const prior = staleScenario.events[arrivalIndex];
  staleScenario.events[arrivalIndex] = event(
    'VENUE_ARRIVAL',
    prior.sequence,
    harness.binding.entry.plan.expiresAtMs,
    prior.payload,
    { sourceSequence: prior.sourceSequence },
  );
  assert.throws(
    () => runRetainedScenario(harness, artifact, staleScenario),
    /at or after accepted policy\/proposal expiry/,
  );
});

test('all four semantic owner legs retain distinct exact mutation identities and real checkpoints', async () => {
  const harness = await completeLifecycle({ suffix: 'four-leg-lineage' });
  const observations = harness.observations;
  assert.deepEqual(observations.map((value) => value.stage), [
    'ENTRY_SPOT', 'ENTRY_HEDGE', 'EXIT_SPOT', 'EXIT_PERP',
  ]);
  assert.deepEqual(observations.map((value) => value.mutationLineage.requestSequence), [1, 2, 3, 4]);

  for (const field of [
    'requestSequence',
    'requestId',
    'intentFingerprint',
    'sanitizedRequestContentHash',
  ]) {
    assert.equal(
      new Set(observations.map((value) => String(value.mutationLineage[field]))).size,
      4,
      `${field} must be distinct for every semantic owner leg`,
    );
  }
  assert.equal(new Set(observations.map((value) => value.l06MutationId)).size, 4);
  assert.equal(new Set(observations.map((value) => value.ownerCheckpoint)).size, 4);

  for (const observation of observations) {
    const restored = restoreExecutionCheckpoint(observation.ownerCheckpoint);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    assert.equal(restored.state.plan.planId, harness.binding.ownerPlan.planId);
    assert.equal(restored.state.lastSequence, observation.ownerStateLastSequence);
    assert.equal(restored.state.stateRevisionId, observation.ownerStateRevision);
    assert.equal(restored.state.eventLog.at(-1).type, 'LEG_SUBMISSION_STARTED');
    const identity = observation.order.fixture.l06Snapshot.identity;
    const bindings = observation.order.fixture.l06Snapshot.bindings;
    assert.equal(identity.attempt, 0);
    assert.equal(observation.mutationLineage.requestSequence, identity.requestSequence);
    assert.equal(observation.mutationLineage.requestId, identity.requestId);
    assert.equal(observation.mutationLineage.intentFingerprint, identity.intentFingerprint);
    assert.equal(
      observation.mutationLineage.sanitizedRequestContentHash,
      bindings.sanitizedRequestContentHash,
    );
    assert.equal(
      observation.mutationLineage.privateProjectionRevision,
      bindings.privateProjectionRevision,
    );
    assert.equal(
      observation.mutationLineage.foundationReconciliationResultRevision,
      bindings.foundationReconciliationResultRevision,
    );
    assert.equal(observation.positionModeProjectionRevision, bindings.privateProjectionRevision);
    assert.equal(
      observation.positionModeEvidence.projection.reconciliationObservation.resultRevision,
      bindings.foundationReconciliationResultRevision,
    );
    assert.equal(validateNormalBasisTwinLegObservation(
      observation,
      harness.binding,
      ownerCheckpointHydrator,
    ), observation);
  }
});

test('entry and Foundation bindings are deterministic, immutable and canonically identified', async () => {
  const left = makeNormalBasisBinding({ suffix: 'deterministic' });
  const right = makeNormalBasisBinding({ suffix: 'deterministic' });
  assert.deepEqual(right.binding, left.binding);
  assert.equal(right.binding.foundationBindingRevision, left.binding.foundationBindingRevision);
  assert.ok(Object.isFrozen(left.binding));
  assert.ok(Object.isFrozen(left.binding.ownerPlan.openingLegs.SPOT));

  const forgedPlan = {
    ...left.ownerPlan,
    termsFingerprint: `terms_${'0'.repeat(32)}`,
  };
  const rejected = bindNormalBasisFoundationPlan(left.entryBinding, forgedPlan);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.reasonCodes.includes('FOUNDATION_PLAN_IDENTITY_NOT_EXACT'));

  const unequal = makeNormalBasisBinding({
    suffix: 'unequal-quantities',
    spotQuantity: '0.1',
    perpQuantity: '0.08',
    expectedBindingOk: false,
  });
  assert.equal(unequal.bindingResult.ok, false);
  assert.ok(unequal.bindingResult.reasonCodes.includes('FOUNDATION_QUANTITY_PROJECTION_NOT_EXACT'));

  const replanned = lifecycleHarness({ suffix: 'replanned', attempt: 1 });
  assert.equal(replanned.ownerPlan.attempt, 1);
  const replannedPreflight = await replanned.coordinator.preflight();
  assert.equal(replannedPreflight.ok, true, JSON.stringify(replannedPreflight));
  const replannedOpen = await replanned.coordinator.open();
  assert.equal(replannedOpen.ok, true, JSON.stringify(replannedOpen));
  const replannedObservation = replanned.observations[0];
  assert.equal(replannedObservation.order.fixture.l06Snapshot.identity.attempt, 0);
  assert.equal(
    replannedObservation.order.fixture.l06Snapshot.identity.clientOrderId,
    replanned.binding.ownerPlan.openingLegs.SPOT.clientOrderId,
  );
  assert.equal(replannedObservation.localDisposition, 'FILLED');
});

test('owner-input, capability and every exact mutation-lineage substitution fail closed', async () => {
  const harness = lifecycleHarness({ suffix: 'tamper' });
  const { binding, entryBinding, policyInput, ownerBindings } = harness;
  const missingOwner = evaluateNormalBasisEntryBinding(policyInput, {
    ...ownerBindings,
    spotOrderTifOwnerInputs: [],
  });
  assert.equal(missingOwner.ok, false);
  assert.deepEqual(missingOwner.reasonCodes, ['POLICY_NOT_PLANNED']);

  const preflight = await harness.coordinator.preflight();
  assert.equal(preflight.ok, true, JSON.stringify(preflight));
  const open = await harness.coordinator.open();
  assert.equal(open.ok, true, JSON.stringify(open));
  const artifact = harness.artifacts[0];
  const { observation, scenario } = artifact;
  const capabilityTampered = structuredClone(scenario);
  capabilityTampered.events = capabilityTampered.events.map((candidate) => {
    if (candidate.kind !== 'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE') return candidate;
    return event(candidate.kind, candidate.sequence, candidate.occurredAtMs, {
      ...candidate.payload,
      expectedCapabilityRevision: differentHexRevision(
        candidate.payload.expectedCapabilityRevision,
      ),
    }, { sourceSequence: candidate.sourceSequence });
  });
  assert.throws(
    () => runRetainedScenario(harness, artifact, capabilityTampered),
    /capability revision differs|did not retain/,
  );

  const requestSemanticTampered = structuredClone(scenario);
  const dispatchIndex = requestSemanticTampered.events.findIndex((candidate) => (
    candidate.kind === 'PLACE_DISPATCH'
  ));
  const dispatch = requestSemanticTampered.events[dispatchIndex];
  const requestEvidence = structuredClone(dispatch.payload.requestEvidence);
  requestEvidence.reduceOnly = true;
  const {
    schema: _requestSchema,
    evidenceRevision: _requestRevision,
    ...requestMaterial
  } = requestEvidence;
  requestEvidence.evidenceRevision = `l07request_${createHash('sha256')
    .update(canonicalJson(requestMaterial)).digest('hex')}`;
  requestSemanticTampered.events[dispatchIndex] = event(
    dispatch.kind,
    dispatch.sequence,
    dispatch.occurredAtMs,
    { ...dispatch.payload, requestEvidence },
    { sourceSequence: dispatch.sourceSequence },
  );
  assert.throws(
    () => runRetainedScenario(harness, artifact, requestSemanticTampered),
    /request semantic evidence is not canonical|request semantics do not bind/,
  );

  const duplicatedOwnerEvidence = structuredClone(scenario);
  const retainedOwnerEvidence = duplicatedOwnerEvidence.events.find((candidate) => (
    candidate.kind === 'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE'
  ));
  duplicatedOwnerEvidence.events.push(event(
    retainedOwnerEvidence.kind,
    Math.max(...duplicatedOwnerEvidence.events.map((candidate) => candidate.sequence)) + 1,
    retainedOwnerEvidence.occurredAtMs + 1,
    retainedOwnerEvidence.payload,
  ));
  assert.throws(
    () => runRetainedScenario(harness, artifact, duplicatedOwnerEvidence),
    /exactly one accepted L08\.2 owner-evidence event/,
  );

  const l06Tampered = structuredClone(scenario);
  l06Tampered.fixtures[0].l06Snapshot.identity.clientOrderId = 'cx-forged-0';
  assert.throws(
    () => runRetainedScenario(harness, artifact, l06Tampered),
    /L06 mutation|mutation snapshot|journal/,
  );

  const coherentZeroSequence = coherentZeroSequenceScenario(scenario);
  const zeroFixture = coherentZeroSequence.fixtures[0];
  const zeroSnapshot = zeroFixture.l06Snapshot;
  assert.equal(zeroSnapshot.identity.requestSequence, 0);
  assert.notEqual(zeroSnapshot.mutationId, observation.l06MutationId);
  assert.equal(zeroFixture.l06Boundary.mutationId, zeroSnapshot.mutationId);
  assert.equal(zeroFixture.l06Boundary.state, 'SYNTHETIC_OBSERVATION_ELIGIBLE');
  assert.notEqual(zeroSnapshot.identity.requestId, observation.mutationLineage.requestId);
  assert.equal(
    zeroSnapshot.identity.requestId,
    deriveTransportRequestId({
      contractId: zeroSnapshot.identity.contractId,
      product: zeroSnapshot.identity.product,
      environment: zeroSnapshot.identity.environment,
      signerProfile: zeroSnapshot.identity.signerProfile,
      correlationId: zeroSnapshot.identity.globalCorrelationId,
      requestSequence: 0,
      intentFingerprint: zeroSnapshot.identity.intentFingerprint,
    }).requestId,
  );
  assert.throws(
    () => runRetainedScenario(harness, artifact, coherentZeroSequence),
    /L06 mutation identity\/evidence alias is not exact|L07 request semantics do not bind/,
  );

  const lineageSubstitutions = {
    requestSequence: observation.mutationLineage.requestSequence + 100,
    requestId: differentHexRevision(observation.mutationLineage.requestId),
    intentFingerprint: differentHexRevision(observation.mutationLineage.intentFingerprint),
    sanitizedRequestContentHash: differentHexRevision(
      observation.mutationLineage.sanitizedRequestContentHash,
    ),
    privateProjectionRevision: differentHexRevision(
      observation.mutationLineage.privateProjectionRevision,
    ),
    foundationReconciliationResultRevision: differentHexRevision(
      observation.mutationLineage.foundationReconciliationResultRevision,
    ),
  };
  for (const [field, replacement] of Object.entries(lineageSubstitutions)) {
    const substitutedScenario = structuredClone(scenario);
    const snapshot = substitutedScenario.fixtures[0].l06Snapshot;
    const owner = ['requestSequence', 'requestId', 'intentFingerprint'].includes(field)
      ? snapshot.identity : snapshot.bindings;
    owner[field] = replacement;
    assert.throws(
      () => runRetainedScenario(harness, artifact, substitutedScenario),
      /mutation|journal|owner cut|scenario fixture|request semantics/,
      `${field} substitution in the retained mutation evidence must fail`,
    );
  }
  for (const [field, replacement] of Object.entries(lineageSubstitutions)) {
    const forged = structuredClone(observation);
    forged.mutationLineage[field] = replacement;
    assert.throws(
      () => validateNormalBasisTwinLegObservation(
        forged,
        binding,
        ownerCheckpointHydrator,
      ),
      /summary diverges|revision mismatch|mutation lineage/,
      `${field} substitution must fail`,
    );
  }

  const bindingTampered = structuredClone(entryBinding);
  bindingTampered.bindingRevision = `l09entry_${'f'.repeat(32)}`;
  assert.throws(
    () => bindNormalBasisFoundationPlan(bindingTampered, binding.ownerPlan),
    /not reproducible/,
  );
});

test('a forged observation cannot become a Foundation fill and no network boundary is touched', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    throw new Error('network forbidden in normal-Basis proof');
  };
  try {
    const harness = lifecycleHarness({ suffix: 'observation-tamper' });
    const preflight = await harness.coordinator.preflight();
    assert.equal(preflight.ok, true, JSON.stringify(preflight));
    const open = await harness.coordinator.open();
    assert.equal(open.ok, true, JSON.stringify(open));
    const observation = harness.observations[0];
    const forged = structuredClone(observation);
    forged.confirmedFilledQuantity = '0.09';
    assert.throws(
      () => projectNormalBasisOwnerLegOutcome(
        forged,
        harness.binding,
        ownerCheckpointHydrator,
      ),
      /summary diverges|revision mismatch/,
    );
    assert.equal(attempts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
