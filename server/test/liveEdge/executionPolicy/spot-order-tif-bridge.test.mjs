import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXECUTION_POLICY_OWNER_BINDINGS_SCHEMA,
  evaluateExecutionPolicy,
  evaluateExecutionPolicyWithOwnerBindings,
} from '../../../dist/liveEdge/adapters/executionPolicy/index.js';
import {
  deriveSpotOrderTifDependencyRevision,
} from '../../../dist/liveEdge/adapters/binanceInstrumentSpecs/index.js';
import {
  makeSpotOrderTifCapability,
  makeSpotRegistry,
} from '../fixtures/spotOrderTif.mjs';
import {
  makeAction,
  makeCandidate,
  makeExecutionPolicyInput,
  makeScenario,
  rehashAction,
  rehashCandidate,
} from './fixtures.mjs';

function makeNormalBasisPolicy() {
  const { registry, request, capability } = makeSpotOrderTifCapability({
    registry: { maximumAgeMs: 30_000 },
  });
  const spotLeg = {
    legId: 'leg-spot',
    instrumentRevision: capability.instrumentRevision,
    filterRevision: capability.registryRevision,
    l04SizingRevision: capability.preflightRevision,
    l04SourceEvidenceRevision: capability.sourceEvidenceRevision,
    l04SnapshotRevision: capability.snapshotRevision,
    l04PreflightState: 'PASS',
    allowedOrderTypes: ['LIMIT'],
    allowedTimeInForce: [capability.timeInForce],
    product: 'SPOT',
    accountRealmId: 'realm-spot',
    symbol: capability.symbol,
    baseAsset: capability.baseAsset,
    quoteAsset: capability.quoteAsset,
    side: capability.side,
    reduceOnly: false,
    requestedQuantity: capability.requestedQuantity,
    filteredQuantity: capability.resultQuantity,
    authorizedLimitPrice: capability.requestedPrice,
    filteredNotionalQuote: capability.resultNotional,
  };
  const baseline = makeExecutionPolicyInput();
  const perpLeg = {
    ...baseline.legs[1],
    allowedOrderTypes: ['LIMIT'],
    allowedTimeInForce: ['GTC'],
    requestedQuantity: '0.1',
    filteredQuantity: '0.1',
    filteredNotionalQuote: '9.9',
  };
  const actions = [
    makeAction({ quantity: '0.1', price: '100', timeInForce: 'GTC' }),
    makeAction({
      step: 1,
      legId: 'leg-perp',
      quantity: '0.1',
      price: '99',
      timeInForce: 'GTC',
      dependsOnActualFillLegId: 'leg-spot',
    }),
  ];
  const scenarios = [
    makeScenario({
      scenarioId: 'scenario-full',
      probabilityPpm: 900_000,
      fills: [
        { legId: 'leg-spot', filledQuantity: '0.1' },
        { legId: 'leg-perp', filledQuantity: '0.1' },
      ],
    }),
    makeScenario({
      scenarioId: 'scenario-tail',
      probabilityPpm: 100_000,
      fills: [
        { legId: 'leg-spot', filledQuantity: '0' },
        { legId: 'leg-perp', filledQuantity: '0' },
      ],
      lossQuote: '8',
      adverseSelectionQuote: '8',
    }),
  ];
  const candidate = makeCandidate({ actions, scenarios });
  const input = makeExecutionPolicyInput({
    legs: [spotLeg, perpLeg],
    candidates: [candidate],
  });
  input.dependencies = input.dependencies.map((dependency) => dependency.kind === 'INSTRUMENT_FILTER'
    ? { ...dependency, revision: deriveSpotOrderTifDependencyRevision([capability]) }
    : dependency);
  const bindings = {
    schema: EXECUTION_POLICY_OWNER_BINDINGS_SCHEMA,
    spotOrderTifOwnerInputs: [{
      registrySnapshot: registry,
      sizingRequest: request,
    }],
  };
  return { input, bindings, capability, candidate };
}

test('L08.1 emits one ordered non-sendable normal-Basis plan from the exact owner binding', () => {
  const { input, bindings, capability } = makeNormalBasisPolicy();
  assert.deepEqual(evaluateExecutionPolicy(input).reasonCodes, ['INPUT_REJECTED']);

  const decision = evaluateExecutionPolicyWithOwnerBindings(input, bindings);
  assert.equal(decision.disposition, 'PLANNED');
  assert.deepEqual(decision.reasonCodes, []);
  assert.equal(decision.selectedPlan.sequenceMode, 'ORDERED');
  assert.deepEqual(decision.selectedPlan.legs.map(({ product, side }) => ({ product, side })), [
    { product: 'SPOT', side: 'BUY' },
    { product: 'USD_M_PERPETUAL', side: 'SELL' },
  ]);
  assert.deepEqual(decision.selectedPlan.actions.map((action) => action.step), [0, 1]);
  assert.equal(decision.selectedPlan.actions[0].legId, 'leg-spot');
  assert.equal(decision.selectedPlan.actions[0].orderType, 'LIMIT');
  assert.equal(decision.selectedPlan.actions[0].timeInForce, 'GTC');
  assert.equal(decision.selectedPlan.actions[1].legId, 'leg-perp');
  assert.equal(decision.selectedPlan.actions[1].quantitySource, 'ACTUAL_FILL_OF_LEG');
  assert.equal(decision.selectedPlan.actions[1].dependsOnActualFillLegId, 'leg-spot');
  assert.ok(decision.selectedPlan.evidenceRevisions.includes(
    `SPOT_ORDER_TIF_CAPABILITY:${capability.capabilityRevision}`,
  ));
  assert.equal(decision.selectedPlan.expiresAtMs, capability.validUntilMs);
  for (const value of [decision, decision.selectedPlan]) {
    assert.equal(value.sendEligible, false);
    assert.equal(value.externalActionAuthorization, 'NONE');
    assert.equal(value.actionAuthority, 'NONE_RECORD_ONLY');
  }
});

test('missing, tampered, duplicated or mismatched owner inputs never widen Spot', () => {
  const { input, bindings, capability } = makeNormalBasisPolicy();
  assert.deepEqual(evaluateExecutionPolicyWithOwnerBindings(input, {
    ...bindings,
    spotOrderTifOwnerInputs: [],
  }).reasonCodes, ['INPUT_REJECTED']);

  const tampered = structuredClone(bindings.spotOrderTifOwnerInputs[0]);
  tampered.sizingRequest.requestedQuantity = '0.2';
  assert.deepEqual(evaluateExecutionPolicyWithOwnerBindings(input, {
    ...bindings,
    spotOrderTifOwnerInputs: [tampered],
  }).reasonCodes, ['INPUT_REJECTED']);
  assert.deepEqual(evaluateExecutionPolicyWithOwnerBindings(input, {
    ...bindings,
    spotOrderTifOwnerInputs: [
      bindings.spotOrderTifOwnerInputs[0],
      structuredClone(bindings.spotOrderTifOwnerInputs[0]),
    ],
  }).reasonCodes, ['INPUT_REJECTED']);

  const mismatchedLeg = structuredClone(input);
  mismatchedLeg.legs[0].filteredQuantity = '0.09';
  assert.deepEqual(evaluateExecutionPolicyWithOwnerBindings(mismatchedLeg, bindings).reasonCodes,
    ['INPUT_REJECTED']);

  const refreshedRuntime = makeSpotRegistry({
    receivedAtMs: input.evaluatedAtMs - 500,
    evaluatedAtMs: input.evaluatedAtMs,
    maximumAgeMs: 30_000,
  });
  assert.equal(refreshedRuntime.instruments[0].instrumentRevision,
    capability.instrumentRevision);
  assert.notEqual(refreshedRuntime.instruments[0].sourceEvidenceRevision,
    capability.sourceEvidenceRevision);
  assert.notEqual(refreshedRuntime.snapshotRevision, capability.snapshotRevision);
  const receiptRefreshed = evaluateExecutionPolicyWithOwnerBindings(input, {
    ...bindings,
    spotOrderTifOwnerInputs: [{
      ...bindings.spotOrderTifOwnerInputs[0],
      registrySnapshot: refreshedRuntime,
    }],
  });
  assert.deepEqual(receiptRefreshed.reasonCodes, ['INPUT_REJECTED']);
  assert.equal(receiptRefreshed.selectedPlan, null);
});

test('the Spot capability dependency revision and validity interval are global gates', () => {
  const { input, bindings, capability } = makeNormalBasisPolicy();
  const wrongDependency = structuredClone(input);
  wrongDependency.dependencies.find((entry) => entry.kind === 'INSTRUMENT_FILTER').revision =
    'instrument-filter-revision:l08:wrong';
  const mismatch = evaluateExecutionPolicyWithOwnerBindings(wrongDependency, bindings);
  assert.deepEqual(mismatch.reasonCodes, ['OWNER_REVISION_MISMATCH']);
  assert.equal(mismatch.selectedPlan, null);

  const expired = structuredClone(input);
  expired.evaluatedAtMs = capability.validUntilMs;
  const stale = evaluateExecutionPolicyWithOwnerBindings(expired, bindings);
  assert.deepEqual(stale.reasonCodes, ['DEPENDENCY_STALE']);
  assert.equal(stale.selectedPlan, null);
});

test('candidate order type and TIF must remain inside the exact Spot binding', () => {
  const { input, bindings } = makeNormalBasisPolicy();
  const changed = structuredClone(input.candidates[0]);
  changed.actions[0] = rehashAction({ ...changed.actions[0], timeInForce: 'IOC' });
  const wrongTif = rehashCandidate(changed);
  const tifDecision = evaluateExecutionPolicyWithOwnerBindings({
    ...input,
    candidates: [wrongTif],
  }, bindings);
  assert.ok(tifDecision.reasonCodes.includes('INSTRUMENT_OR_FILTER_UNAVAILABLE'));
  assert.ok(tifDecision.reasonCodes.includes('NO_AUTHORIZED_POLICY'));

  const widenedLeg = structuredClone(input);
  widenedLeg.legs[0].allowedOrderTypes = ['LIMIT', 'MARKET'];
  assert.deepEqual(evaluateExecutionPolicyWithOwnerBindings(widenedLeg, bindings).reasonCodes,
    ['INPUT_REJECTED']);
});
