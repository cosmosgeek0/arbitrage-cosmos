import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson,
  stableHash128Hex,
} from '../../../dist/foundation/contracts/index.js';
import {
  createExecutionCoordinator,
} from '../../../dist/foundation/execution/index.js';
import {
  checkpointExchangeTwin,
  reduceExchangeTwinEvent,
  restoreExchangeTwin,
  runExchangeTwinScenario,
} from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  evaluateNormalBasisOwnerAgreement,
  projectNormalBasisOwnerLegOutcome,
  runNormalBasisTwinLeg,
  validateNormalBasisTwinLegObservation,
} from '../../../dist/liveEdge/adapters/normalBasis/index.js';
import {
  event,
  orderByFixtureId,
} from '../exchangeTwin/fixtures.mjs';
import {
  buildNormalBasisL05Projection,
} from './l05-fixture.mjs';
import {
  ManualClock,
  TWIN_T0,
  VENUE_ARRIVAL_MS,
  failure,
  makeNormalBasisBinding,
  makeTwinLegObservation,
} from './fixtures.mjs';

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

function modeProjection(binding, evaluatedAtMs = VENUE_ARRIVAL_MS) {
  return buildNormalBasisL05Projection({
    accountRealmId: binding.entry.perpLeg.accountRealmId,
    targetSymbol: binding.ownerPlan.symbol,
    evaluatedAtMs,
  });
}

function agreementState(binding, {
  lifecycle,
  revisionHex,
  spotOpen = 0,
  perpOpen = 0,
  spotClose = 0,
  perpClose = 0,
}) {
  return {
    plan: binding.ownerPlan,
    lifecycle,
    revision: 1,
    stateRevisionId: `rev_${revisionHex}`,
    openingLegs: {
      SPOT: {
        definition: binding.ownerPlan.openingLegs.SPOT,
        cumulativeFilledQuantity: spotOpen,
      },
      PERP: {
        definition: binding.ownerPlan.openingLegs.PERP,
        cumulativeFilledQuantity: perpOpen,
      },
    },
    closingLegs: {
      SPOT: {
        definition: binding.ownerPlan.closingLegs.SPOT,
        cumulativeFilledQuantity: spotClose,
      },
      PERP: {
        definition: binding.ownerPlan.closingLegs.PERP,
        cumulativeFilledQuantity: perpClose,
      },
    },
  };
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

class FilledOwnerPorts {
  constructor() { this.claims = new Map(); }
  claimPlanIdentity(planId, fingerprint) {
    const prior = this.claims.get(planId);
    if (prior === undefined) {
      this.claims.set(planId, fingerprint);
      return 'CLAIMED';
    }
    return prior === fingerprint ? 'EXISTING_SAME' : 'CONFLICT';
  }
  async preflight() { return { ok: true }; }
  async validateLeg() { return { ok: true }; }
  async submitPaper(request) {
    return {
      kind: 'FILLED', venueOrderId: null,
      cumulativeFilledQuantity: request.leg.quantity,
    };
  }
  async lookupByClientOrderId() {
    return { kind: 'UNRESOLVED', failure: failure('LOOKUP_UNRESOLVED') };
  }
  async reconcile(state) {
    const spot = state.openingLegs.SPOT.cumulativeFilledQuantity
      - state.closingLegs.SPOT.cumulativeFilledQuantity;
    const perp = state.openingLegs.PERP.cumulativeFilledQuantity
      - state.closingLegs.PERP.cumulativeFilledQuantity;
    if (spot === 0 && perp === 0) return { kind: 'CLOSED' };
    return Math.abs(spot - perp) < 1e-12
      ? { kind: 'HEDGED_OPEN' } : { kind: 'ONE_LEG_EXPOSED' };
  }
}

test('close sizing requires the canonical Foundation residual and exact reduce-only leg definition', async () => {
  const built = makeNormalBasisBinding({ suffix: 'residual-guard' });
  const ports = new FilledOwnerPorts();
  const coordinator = createExecutionCoordinator(built.foundationInput, new ManualClock(), ports);
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  const state = coordinator.snapshot();
  assert.equal(state.lifecycle, 'HEDGED_OPEN');

  const undersizedSpot = {
    ...built.binding.ownerPlan.closingLegs.SPOT,
    quantity: 0.09,
  };
  assert.throws(() => makeTwinLegObservation({
    binding: built.binding,
    ownerRequest: ownerRequest(built.binding, undersizedSpot),
    stage: 'EXIT_SPOT',
    ownerState: state,
  }), /quantity must equal confirmed residual owner truth/);

  const forgedPerpClose = {
    ...built.binding.ownerPlan.closingLegs.PERP,
    reduceOnly: false,
  };
  assert.throws(() => makeTwinLegObservation({
    binding: built.binding,
    ownerRequest: ownerRequest(built.binding, forgedPerpClose),
    stage: 'EXIT_PERP',
    ownerState: state,
    modeProjection: modeProjection(built.binding),
  }), /leg request is not exact/);

  assert.throws(() => makeTwinLegObservation({
    binding: built.binding,
    ownerRequest: ownerRequest(built.binding, built.binding.ownerPlan.closingLegs.SPOT),
    stage: 'EXIT_SPOT',
    ownerState: null,
  }), /canonical Foundation state is required/);
});

test('only a validated current L05 one-way projection can prove positionSide=BOTH', () => {
  const { binding } = makeNormalBasisBinding({ suffix: 'position-mode-guard' });
  const spot = makeTwinLegObservation({
    binding,
    ownerRequest: ownerRequest(binding, binding.ownerPlan.openingLegs.SPOT),
    stage: 'ENTRY_SPOT',
  }).observation;
  const hedgeRequest = ownerRequest(binding, binding.ownerPlan.openingLegs.PERP);
  const current = modeProjection(binding);
  assert.equal(current.completeness, 'PARTIAL');
  assert.equal(current.entryEvidenceComplete, false);
  assert.ok(current.reasonCodes.some((reason) => reason.includes('UNAVAILABLE_L02_CONTRACT_GAP')));
  const accepted = makeTwinLegObservation({
    binding,
    ownerRequest: hedgeRequest,
    stage: 'ENTRY_HEDGE',
    priorSpotObservation: spot,
    modeProjection: current,
  }).observation;
  assert.equal(accepted.positionSide, 'BOTH');
  assert.equal(accepted.positionModeProjectionRevision, current.projectionRevision);

  const stale = modeProjection(binding, VENUE_ARRIVAL_MS - 2_000);
  assert.throws(() => makeTwinLegObservation({
    binding,
    ownerRequest: hedgeRequest,
    stage: 'ENTRY_HEDGE',
    priorSpotObservation: spot,
    modeProjection: stale,
  }), /does not prove current one-way/);

  const tampered = structuredClone(current);
  tampered.permissions[0].usdmDualSidePosition = true;
  assert.throws(() => makeTwinLegObservation({
    binding,
    ownerRequest: hedgeRequest,
    stage: 'ENTRY_HEDGE',
    priorSpotObservation: spot,
    modeProjection: tampered,
  }), /projection validation|not reproducible|not revision-coherent|does not prove/);
});

test('owner agreement blocks empty, duplicate, residual and recommendation false greens', () => {
  const { binding } = makeNormalBasisBinding({ suffix: 'agreement-guard' });
  const request = ownerRequest(binding, binding.ownerPlan.openingLegs.SPOT);
  const filled = makeTwinLegObservation({
    binding, ownerRequest: request, stage: 'ENTRY_SPOT',
  }).observation;
  const ambiguous = makeTwinLegObservation({
    binding, ownerRequest: request, stage: 'ENTRY_SPOT', localMode: 'AMBIGUOUS',
    fixtureId: 'fixture-l09-agreement-ambiguous',
  }).observation;
  const meaningful = [{
    action: 'CLOSE_EXPOSED_LEG', riskEffect: 'RISK_REDUCING', automatic: false,
  }];

  const falseClosed = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: agreementState(binding, {
      lifecycle: 'CLOSED', revisionHex: '1111111111111111', spotOpen: 0.1,
    }),
    observations: [filled],
    recoveryRecommendations: [],
  });
  assert.equal(falseClosed.state, 'BLOCKED');
  assert.ok(falseClosed.reasonCodes.includes('OWNER_CLOSED_WITH_UNRESOLVED_TRUTH'));

  const emptyExposed = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: agreementState(binding, {
      lifecycle: 'ONE_LEG_EXPOSED', revisionHex: '2222222222222222',
    }),
    observations: [],
    recoveryRecommendations: meaningful,
  });
  assert.equal(emptyExposed.state, 'BLOCKED');
  assert.ok(emptyExposed.reasonCodes.includes('OWNER_ONE_LEG_EXPOSED_WITHOUT_EXPOSURE'));

  const noActionRecovery = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: agreementState(binding, {
      lifecycle: 'RECOVERY_REQUIRED', revisionHex: '3333333333333333',
    }),
    observations: [ambiguous],
    recoveryRecommendations: [{ action: 'NO_ACTION', riskEffect: 'NEUTRAL', automatic: false }],
  });
  assert.equal(noActionRecovery.state, 'BLOCKED');
  assert.ok(noActionRecovery.reasonCodes.includes('OWNER_RECOVERY_RECOMMENDATION_MISSING'));

  assert.throws(() => evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: agreementState(binding, {
      lifecycle: 'ONE_LEG_EXPOSED', revisionHex: '4444444444444444', spotOpen: 0.1,
    }),
    observations: [filled, filled],
    recoveryRecommendations: meaningful,
  }), /one canonical observation per owner order/);
});

test('a recomputed observation checksum cannot relabel the accepted owner chain', () => {
  const { binding } = makeNormalBasisBinding({ suffix: 'rehashed-alias-guard' });
  const filled = makeTwinLegObservation({
    binding,
    ownerRequest: ownerRequest(binding, binding.ownerPlan.openingLegs.SPOT),
    stage: 'ENTRY_SPOT',
  }).observation;
  const validState = agreementState(binding, {
    lifecycle: 'ONE_LEG_EXPOSED',
    revisionHex: '5555555555555555',
    spotOpen: 0.1,
  });
  const validAgreement = evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: validState,
    observations: [filled],
    recoveryRecommendations: [{
      action: 'CLOSE_EXPOSED_LEG', riskEffect: 'RISK_REDUCING', automatic: false,
    }],
  });
  assert.equal(validAgreement.state, 'MANUAL_ACTION_REQUIRED');

  const forged = rehashObservation(structuredClone(filled));
  forged.policyPlanId = 'epplan_relabelled';
  forged.policyLegId = 'leg-relabelled';
  rehashObservation(forged);
  assert.throws(
    () => validateNormalBasisTwinLegObservation(forged, binding),
    /summary diverges from retained twin truth/,
  );
  assert.throws(() => evaluateNormalBasisOwnerAgreement({
    foundationBinding: binding,
    ownerState: validState,
    observations: [forged],
    recoveryRecommendations: [{
      action: 'CLOSE_EXPOSED_LEG', riskEffect: 'RISK_REDUCING', automatic: false,
    }],
  }), /summary diverges from retained twin truth/);
});

test('a rehashed L07 fill cannot bypass retained entry admission', () => {
  const { binding } = makeNormalBasisBinding({ suffix: 'retained-admission-guard' });
  const request = ownerRequest(binding, binding.ownerPlan.openingLegs.SPOT);
  const acceptedArtifact = makeTwinLegObservation({
    binding,
    ownerRequest: request,
    stage: 'ENTRY_SPOT',
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

  const forged = structuredClone(acceptedArtifact.observation);
  forged.state = duplicatedState;
  forged.order = duplicatedOrder;
  forged.twinOutcomeRevision = duplicatedState.outcomeRevision;
  rehashObservation(forged);
  assert.throws(
    () => validateNormalBasisTwinLegObservation(forged, binding),
    /exactly one accepted L08\.2 owner-evidence event/,
  );
  assert.throws(
    () => projectNormalBasisOwnerLegOutcome(forged, binding),
    /exactly one accepted L08\.2 owner-evidence event/,
  );
});

test('one canonical close order cannot be double-counted under a recovery stage label', async () => {
  const built = makeNormalBasisBinding({ suffix: 'close-stage-dedup' });
  const ports = new FilledOwnerPorts();
  const coordinator = createExecutionCoordinator(
    built.foundationInput,
    new ManualClock(),
    ports,
  );
  assert.equal((await coordinator.preflight()).ok, true);
  assert.equal((await coordinator.open()).ok, true);
  const ownerState = coordinator.snapshot();
  const close = makeTwinLegObservation({
    binding: built.binding,
    ownerRequest: ownerRequest(built.binding, built.binding.ownerPlan.closingLegs.SPOT),
    stage: 'EXIT_SPOT',
    ownerState,
  }).observation;
  const relabelled = structuredClone(close);
  relabelled.stage = 'RECOVERY_CLOSE_SPOT';
  rehashObservation(relabelled);
  assert.equal(
    validateNormalBasisTwinLegObservation(relabelled, built.binding),
    relabelled,
  );
  assert.throws(() => evaluateNormalBasisOwnerAgreement({
    foundationBinding: built.binding,
    ownerState,
    observations: [close, relabelled],
    recoveryRecommendations: [],
  }), /one canonical observation per owner order/);
});

test('a forged prior fill cannot size the hedge', () => {
  const { binding } = makeNormalBasisBinding({ suffix: 'prior-fill-guard' });
  const spot = makeTwinLegObservation({
    binding,
    ownerRequest: ownerRequest(binding, binding.ownerPlan.openingLegs.SPOT),
    stage: 'ENTRY_SPOT',
  }).observation;
  const forged = structuredClone(spot);
  forged.confirmedFilledQuantity = '0.04';
  const scaledHedge = {
    ...binding.ownerPlan.openingLegs.PERP,
    quantity: 0.04,
  };
  assert.throws(() => makeTwinLegObservation({
    binding,
    ownerRequest: ownerRequest(binding, scaledHedge),
    stage: 'ENTRY_HEDGE',
    priorSpotObservation: forged,
    modeProjection: modeProjection(binding),
  }), /summary diverges|revision mismatch/);
});

test('crash after venue effect restores exact twin truth and reconciles without a second dispatch', () => {
  const { binding } = makeNormalBasisBinding({ suffix: 'crash-reconcile' });
  const request = ownerRequest(binding, binding.ownerPlan.openingLegs.SPOT);
  const initial = makeTwinLegObservation({
    binding,
    ownerRequest: request,
    stage: 'ENTRY_SPOT',
    localMode: 'AMBIGUOUS',
    fixtureId: 'fixture-l09-crash-reconcile',
  });
  const venueEvents = initial.scenario.events.filter((candidate) => (
    candidate.kind !== 'HTTP_DELIVERY'
  ));
  const venueState = runExchangeTwinScenario({
    ...initial.scenario,
    events: venueEvents,
  });
  const restoredVenue = restoreExchangeTwin(checkpointExchangeTwin(venueState));
  assert.deepEqual(restoredVenue, venueState);
  const crash = event('CRASH', 9, TWIN_T0 + 41, {
    crashId: 'normal-basis-crash-reconcile-0001',
    dropLocalDeliveries: true,
    dropPendingCommands: true,
  });
  const restart = event('RESTART', 10, TWIN_T0 + 50, {
    crashId: 'normal-basis-crash-reconcile-0001',
  });
  const restarted = reduceExchangeTwinEvent(
    reduceExchangeTwinEvent(restoredVenue, crash),
    restart,
  );
  const restartedOrder = orderByFixtureId(restarted, initial.fixture.fixtureId);
  assert.equal(restartedOrder.localTruth, 'RECOVERY_REQUIRED');
  const ownerObservation = event('RECONCILIATION_OBSERVATION', 11, TWIN_T0 + 60, {
    fixtureId: initial.fixture.fixtureId,
    ownerObservationRevision: `normal-basis-owner-reconcile:${'7'.repeat(24)}`,
    observedVenueRevision: restartedOrder.venueRevision,
    observedStatus: restartedOrder.venueStatus,
    observedFilledQuantity: restartedOrder.filledQuantity,
  });
  const scenario = {
    ...initial.scenario,
    scenarioId: 'scenario-l09-crash-reconciled',
    events: [...venueEvents, crash, restart, ownerObservation],
  };
  const reconciled = runNormalBasisTwinLeg({
    binding,
    stage: 'ENTRY_SPOT',
    ownerRequest: request,
    scenario,
  });
  assert.equal(reconciled.localDisposition, 'FILLED');
  assert.equal(reconciled.confirmedFilledQuantity, '0.1');
  assert.equal(reconciled.localTruth, 'OBSERVED');
  assert.equal(scenario.events.filter((candidate) => candidate.kind === 'PLACE_DISPATCH').length, 1);
});
