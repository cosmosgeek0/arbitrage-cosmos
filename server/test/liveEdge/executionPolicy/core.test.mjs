import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateExecutionPolicy,
} from '../../../dist/liveEdge/adapters/executionPolicy/index.js';
import {
  T0,
  makeCandidate,
  makeExecutionPolicyInput,
  rehashAction,
  rehashCandidate,
} from './fixtures.mjs';

function candidateWithAction(candidate, index, overrides) {
  const changed = structuredClone(candidate);
  changed.actions[index] = rehashAction({ ...changed.actions[index], ...overrides });
  return rehashCandidate(changed);
}

function reasonCodesFor(decision, candidateId) {
  const evaluation = decision.candidateEvaluations.find((item) => item.candidateId === candidateId);
  assert.ok(evaluation, `missing evaluation for ${candidateId}`);
  return evaluation.reasonCodes;
}

function assertFrozenGraph(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertFrozenGraph(child, seen);
}

test('candidate and evidence insertion permutations produce one byte-identical decision', () => {
  const passive = makeCandidate({ posture: 'PASSIVE', successLossQuote: '1', tailLossQuote: '5' });
  const aggressive = makeCandidate({ posture: 'AGGRESSIVE', successLossQuote: '2', tailLossQuote: '4' });
  const baselineInput = makeExecutionPolicyInput({ candidates: [passive, aggressive] });
  const baseline = evaluateExecutionPolicy(baselineInput);
  assert.equal(baseline.disposition, 'PLANNED');

  const permutedPassive = structuredClone(passive);
  permutedPassive.actions.reverse();
  permutedPassive.distribution.scenarios.reverse();
  for (const scenario of permutedPassive.distribution.scenarios) scenario.fills.reverse();
  const canonicalPermutedPassive = rehashCandidate(permutedPassive);
  assert.equal(canonicalPermutedPassive.candidateId, passive.candidateId);
  assert.equal(canonicalPermutedPassive.candidateRevision, passive.candidateRevision);

  const permuted = makeExecutionPolicyInput({
    candidates: [aggressive, canonicalPermutedPassive],
    dependencies: [...baselineInput.dependencies].reverse(),
  });
  assert.deepEqual(evaluateExecutionPolicy(permuted), baseline);
});

test('passive posture wins only when its injected conservative tail is better', () => {
  const passive = makeCandidate({ posture: 'PASSIVE', successLossQuote: '1', tailLossQuote: '3' });
  const aggressive = makeCandidate({ posture: 'AGGRESSIVE', successLossQuote: '1', tailLossQuote: '7' });
  const decision = evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [aggressive, passive] }));
  assert.equal(decision.disposition, 'PLANNED');
  assert.equal(decision.selectedPlan.selectedCandidateId, passive.candidateId);
  assert.equal(decision.selectedPlan.posture, 'PASSIVE');
});

test('aggressive posture wins when passive wait and decay tail evidence is worse', () => {
  const passive = makeCandidate({ posture: 'PASSIVE', successLossQuote: '1', tailLossQuote: '9' });
  const aggressive = makeCandidate({ posture: 'AGGRESSIVE', successLossQuote: '2', tailLossQuote: '4' });
  const decision = evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [passive, aggressive] }));
  assert.equal(decision.disposition, 'PLANNED');
  assert.equal(decision.selectedPlan.selectedCandidateId, aggressive.candidateId);
  assert.equal(decision.selectedPlan.posture, 'AGGRESSIVE');
});

test('candidate owner revisions must exactly match the accepted authority projection', () => {
  const mismatch = makeCandidate({ authorizationRevision: 'authorization-revision:l08:other' });
  const decision = evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [mismatch] }));
  assert.equal(decision.disposition, 'REJECTED');
  assert.deepEqual(reasonCodesFor(decision, mismatch.candidateId), ['OWNER_REVISION_MISMATCH']);
  assert.ok(decision.reasonCodes.includes('NO_AUTHORIZED_POLICY'));
});

test('staged-plan and approval revisions are exact candidate and plan bindings', () => {
  const mismatch = makeCandidate({ stagedPlanRevision: 'staged-plan-revision:l08:other' });
  const rejected = evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [mismatch] }));
  assert.ok(reasonCodesFor(rejected, mismatch.candidateId).includes('OWNER_REVISION_MISMATCH'));

  const planned = evaluateExecutionPolicy(makeExecutionPolicyInput());
  assert.equal(planned.disposition, 'PLANNED');
  assert.equal(planned.selectedPlan.stagedPlanRevision, 'staged-plan-revision:l08:001');
  assert.equal(planned.selectedPlan.operatorApprovalRevision, 'operator-approval-revision:l08:001');
});

test('every owner constraint envelope remains independent and non-widenable', () => {
  const decision = evaluateExecutionPolicy(makeExecutionPolicyInput({
    authority: { capitalConstraints: { maxQuantity: '0.5' } },
  }));
  assert.equal(decision.disposition, 'REJECTED');
  assert.ok(decision.reasonCodes.includes('QUANTITY_OR_NOTIONAL_EXCEEDED'));

  const missing = makeExecutionPolicyInput();
  delete missing.authority.riskConstraints;
  assert.deepEqual(evaluateExecutionPolicy(missing).reasonCodes, ['INPUT_REJECTED']);
});

test('side-correct price and exact quantity bounds reject candidate widening', () => {
  const baseline = makeCandidate();
  const priceWidened = candidateWithAction(baseline, 0, { price: '100.000000000000000000000001' });
  const quantityWidened = candidateWithAction(baseline, 0, { quantity: '1.000000000000000000000001' });
  const decision = evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [priceWidened, quantityWidened] }));
  assert.equal(decision.disposition, 'REJECTED');
  assert.ok(reasonCodesFor(decision, priceWidened.candidateId).includes('PRICE_BOUND_EXCEEDED'));
  assert.ok(reasonCodesFor(decision, quantityWidened.candidateId).includes('QUANTITY_OR_NOTIONAL_EXCEEDED'));
});

test('MARKET remains unavailable because it cannot mechanically enforce the L08 price bound', () => {
  const candidate = makeCandidate({ posture: 'AGGRESSIVE' });
  for (let index = 0; index < candidate.actions.length; index += 1) {
    candidate.actions[index] = rehashAction({
      ...candidate.actions[index],
      orderType: 'MARKET',
      timeInForce: null,
      price: null,
    });
  }
  const bounded = rehashCandidate(candidate);
  const decision = evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [bounded] }));
  assert.ok(reasonCodesFor(decision, bounded.candidateId).includes('PRICE_BOUND_EXCEEDED'));
});

test('accepted L04 capability/readiness projections fail closed for Spot TIF', () => {
  const input = makeExecutionPolicyInput();
  input.legs[0] = {
    ...input.legs[0],
    product: 'SPOT',
    l04PreflightState: 'BLOCKED',
    allowedTimeInForce: [],
  };
  const decision = evaluateExecutionPolicy(input);
  assert.equal(decision.disposition, 'REJECTED');
  assert.ok(decision.reasonCodes.includes('INSTRUMENT_OR_FILTER_UNAVAILABLE'));

  input.legs[0].l04PreflightState = 'PASS';
  assert.deepEqual(evaluateExecutionPolicy(input).reasonCodes, ['INPUT_REJECTED']);
});

test('authorization and dependencies fail closed at exact expiry and unavailable states', () => {
  const expiredAuthorization = evaluateExecutionPolicy(makeExecutionPolicyInput({
    authority: { validUntilMs: T0 },
  }));
  assert.equal(expiredAuthorization.disposition, 'REJECTED');
  assert.ok(expiredAuthorization.reasonCodes.includes('AUTHORIZATION_EXPIRED'));

  const baseline = makeExecutionPolicyInput();
  const expiredBook = baseline.dependencies.map((dependency) => dependency.kind === 'BOOK'
    ? { ...dependency, validUntilMs: T0 }
    : dependency);
  const stale = evaluateExecutionPolicy(makeExecutionPolicyInput({ dependencies: expiredBook }));
  assert.deepEqual(stale.reasonCodes, ['DEPENDENCY_STALE']);

  const unavailableBook = baseline.dependencies.map((dependency) => dependency.kind === 'BOOK'
    ? { ...dependency, state: 'UNAVAILABLE' }
    : dependency);
  const unavailable = evaluateExecutionPolicy(makeExecutionPolicyInput({ dependencies: unavailableBook }));
  assert.ok(unavailable.reasonCodes.includes('BOOK_OR_COST_EVIDENCE_UNAVAILABLE'));
});

test('dependency kind bindings and model/calibration/twin lineage are preserved', () => {
  const baselineInput = makeExecutionPolicyInput();
  const baseline = evaluateExecutionPolicy(baselineInput);
  assert.equal(baseline.disposition, 'PLANNED');
  assert.ok(baseline.selectedPlan.evidenceRevisions.includes('BOOK:book-revision:l08:001'));
  assert.ok(baseline.selectedPlan.evidenceRevisions.includes('COST:cost-revision:l08:001'));

  const swapped = structuredClone(baselineInput);
  const book = swapped.dependencies.find((dependency) => dependency.kind === 'BOOK');
  const cost = swapped.dependencies.find((dependency) => dependency.kind === 'COST');
  [book.revision, cost.revision] = [cost.revision, book.revision];
  const swappedDecision = evaluateExecutionPolicy(swapped);
  assert.equal(swappedDecision.disposition, 'PLANNED');
  assert.notEqual(swappedDecision.decisionRevision, baseline.decisionRevision);

  const mismatchedModel = structuredClone(baselineInput);
  mismatchedModel.dependencies.find((dependency) => dependency.kind === 'MODEL').revision = 'model:other';
  const mismatch = evaluateExecutionPolicy(mismatchedModel);
  assert.ok(mismatch.reasonCodes.includes('OWNER_REVISION_MISMATCH'));
});

test('unavailable or uncalibrated distributions retain named rejection truth', () => {
  const unavailable = makeCandidate({ distribution: { state: 'UNAVAILABLE' } });
  const uncalibrated = makeCandidate({ distribution: { state: 'UNCALIBRATED', sampleCount: 1 } });
  const decision = evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [unavailable, uncalibrated] }));
  assert.equal(decision.disposition, 'REJECTED');
  assert.ok(reasonCodesFor(decision, unavailable.candidateId).includes('DISTRIBUTION_UNAVAILABLE'));
  assert.ok(reasonCodesFor(decision, unavailable.candidateId).includes('DISTRIBUTION_UNCALIBRATED'));
  assert.deepEqual(reasonCodesFor(decision, uncalibrated.candidateId), ['DISTRIBUTION_UNCALIBRATED']);
});

test('duplicate and conflicting content identities fail closed without a selected plan', () => {
  const candidate = makeCandidate();
  const duplicate = evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [candidate, candidate] }));
  assert.equal(duplicate.disposition, 'REJECTED');
  assert.deepEqual(duplicate.reasonCodes, ['INPUT_REJECTED']);
  assert.equal(duplicate.selectedPlan, null);

  const conflicting = makeCandidate({ posture: 'AGGRESSIVE' });
  conflicting.candidateId = candidate.candidateId;
  const conflict = evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [candidate, conflicting] }));
  assert.equal(conflict.disposition, 'REJECTED');
  assert.deepEqual(conflict.reasonCodes, ['INPUT_REJECTED']);
  assert.equal(conflict.selectedPlan, null);
});

test('all decisions and plans are deeply frozen, synthetic-only and mechanically non-sendable', () => {
  const decision = evaluateExecutionPolicy(makeExecutionPolicyInput());
  assert.equal(decision.disposition, 'PLANNED');
  assertFrozenGraph(decision);
  for (const value of [decision, decision.selectedPlan]) {
    assert.equal(value.policyAuthority, 'ADVISORY_EXECUTION_MECHANICS_ONLY');
    assert.equal(value.simulationAuthority, 'SYNTHETIC_FIXTURE');
    assert.equal(value.sendEligible, false);
    assert.equal(value.actionAuthority, 'NONE_RECORD_ONLY');
    assert.equal(value.externalActionAuthorization, 'NONE');
  }
  assert.throws(() => {
    decision.selectedPlan.actions[0].price = '999';
  }, TypeError);
});
