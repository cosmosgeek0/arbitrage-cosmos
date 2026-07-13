import assert from 'node:assert/strict';
import test from 'node:test';

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

test('accepted L08.1 plan feeds the exact Spot BUY LIMIT/GTC owner seam into L07', () => {
  const { binding, capability } = makeNormalBasisBinding({ suffix: 'chain' });
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

  const request = ownerRequest(binding, binding.ownerPlan.openingLegs.SPOT);
  const observation = makeTwinLegObservation({
    binding, ownerRequest: request, stage: 'ENTRY_SPOT',
  }).observation;
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
  assert.equal(validateNormalBasisTwinLegObservation(observation, binding), observation);
  assert.deepEqual(projectNormalBasisOwnerLegOutcome(observation, binding), {
    kind: 'FILLED', venueOrderId: null, cumulativeFilledQuantity: 0.1,
  });
  assert.equal(observation.sendEligible, false);
  assert.equal(observation.externalActionAuthorization, 'NONE');
});

test('entry and Foundation bindings are deterministic, immutable and canonically identified', () => {
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

  const replanned = makeNormalBasisBinding({ suffix: 'replanned', attempt: 1 });
  assert.equal(replanned.ownerPlan.attempt, 1);
  const replannedObservation = makeTwinLegObservation({
    binding: replanned.binding,
    ownerRequest: ownerRequest(replanned.binding, replanned.binding.ownerPlan.openingLegs.SPOT),
    stage: 'ENTRY_SPOT',
  }).observation;
  assert.equal(replannedObservation.order.fixture.l06Snapshot.identity.attempt, 0);
  assert.equal(replannedObservation.localDisposition, 'FILLED');
});

test('owner-input, capability and L06 identity tampering fail before an affirmative fill', () => {
  const { binding, entryBinding, policyInput, ownerBindings } = makeNormalBasisBinding({ suffix: 'tamper' });
  const missingOwner = evaluateNormalBasisEntryBinding(policyInput, {
    ...ownerBindings,
    spotOrderTifOwnerInputs: [],
  });
  assert.equal(missingOwner.ok, false);
  assert.deepEqual(missingOwner.reasonCodes, ['POLICY_NOT_PLANNED']);

  const request = ownerRequest(binding, binding.ownerPlan.openingLegs.SPOT);
  const { scenario } = makeTwinLegObservation({
    binding, ownerRequest: request, stage: 'ENTRY_SPOT', fixtureId: 'fixture-l09-chain-tamper',
  });
  const capabilityTampered = structuredClone(scenario);
  capabilityTampered.events = capabilityTampered.events.map((candidate) => {
    if (candidate.kind !== 'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE') return candidate;
    const expected = candidate.payload.expectedCapabilityRevision;
    const different = `${expected.slice(0, -1)}${expected.endsWith('0') ? '1' : '0'}`;
    return event(candidate.kind, candidate.sequence, candidate.occurredAtMs, {
      ...candidate.payload,
      expectedCapabilityRevision: different,
    }, { sourceSequence: candidate.sourceSequence });
  });
  assert.throws(() => runNormalBasisTwinLeg({
    binding,
    stage: 'ENTRY_SPOT',
    ownerRequest: request,
    scenario: capabilityTampered,
  }), /capability revision differs|did not retain/);

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
  assert.throws(() => runNormalBasisTwinLeg({
    binding,
    stage: 'ENTRY_SPOT',
    ownerRequest: request,
    scenario: duplicatedOwnerEvidence,
  }), /exactly one accepted L08\.2 owner-evidence event/);

  const l06Tampered = structuredClone(scenario);
  l06Tampered.fixtures[0].l06Snapshot.identity.clientOrderId = 'cx-forged-0';
  assert.throws(() => runNormalBasisTwinLeg({
    binding,
    stage: 'ENTRY_SPOT',
    ownerRequest: request,
    scenario: l06Tampered,
  }), /L06 mutation identity\/evidence alias is not exact/);

  const bindingTampered = structuredClone(entryBinding);
  bindingTampered.bindingRevision = `l09entry_${'f'.repeat(32)}`;
  assert.throws(
    () => bindNormalBasisFoundationPlan(bindingTampered, binding.ownerPlan),
    /not reproducible/,
  );
});

test('a forged observation cannot become a Foundation fill and no network boundary is touched', () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    throw new Error('network forbidden in normal-Basis proof');
  };
  try {
    const { binding } = makeNormalBasisBinding({ suffix: 'observation-tamper' });
    const request = ownerRequest(binding, binding.ownerPlan.openingLegs.SPOT);
    const observation = makeTwinLegObservation({
      binding, ownerRequest: request, stage: 'ENTRY_SPOT',
    }).observation;
    const forged = structuredClone(observation);
    forged.confirmedFilledQuantity = '0.09';
    assert.throws(
      () => projectNormalBasisOwnerLegOutcome(forged, binding),
      /summary diverges|revision mismatch/,
    );
    assert.equal(attempts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
