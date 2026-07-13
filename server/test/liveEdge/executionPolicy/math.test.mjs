import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addPolicyDecimals,
  comparePolicyDecimals,
  compareRationals,
  evaluateExecutionPolicy,
  rationalWithinLimit,
  signedPolicyDecimal,
  weightedPolicyDecimal,
} from '../../../dist/liveEdge/adapters/executionPolicy/index.js';
import {
  makeCandidate,
  makeExecutionPolicyInput,
  makeScenario,
  rehashAction,
  rehashCandidate,
} from './fixtures.mjs';

const SMALLEST_TEST_UNIT = '0.000000000000000000000001';

function planned(input) {
  const decision = evaluateExecutionPolicy(input);
  assert.equal(decision.disposition, 'PLANNED', decision.reasonCodes.join(','));
  assert.ok(decision.selectedPlan);
  return decision;
}

function rejected(input, reasonCode) {
  const decision = evaluateExecutionPolicy(input);
  assert.equal(decision.disposition, 'REJECTED');
  assert.ok(decision.reasonCodes.includes(reasonCode), decision.reasonCodes.join(','));
  assert.equal(decision.selectedPlan, null);
  return decision;
}

function partialAtomScenarios() {
  return [
    makeScenario({
      scenarioId: 'scenario-worst',
      probabilityPpm: 30_000,
      feeOrRebateQuote: '-10',
      adverseSelectionQuote: '40',
      opportunityDecayQuote: '20',
      cancelRaceQuote: '10',
      unhedgedLossQuote: '20',
      recoveryCostQuote: '20',
      lossQuote: '100',
      maxNakedQuantity: '1',
      maxNakedNotionalQuote: '100',
      maxNakedDurationMs: 5_000,
    }),
    makeScenario({
      scenarioId: 'scenario-boundary',
      probabilityPpm: 40_000,
      feeOrRebateQuote: '-5',
      adverseSelectionQuote: '15',
      opportunityDecayQuote: '10',
      cancelRaceQuote: '5',
      unhedgedLossQuote: '15',
      recoveryCostQuote: '10',
      lossQuote: '50',
      maxNakedQuantity: '1',
      maxNakedNotionalQuote: '100',
      maxNakedDurationMs: 5_000,
    }),
    makeScenario({
      scenarioId: 'scenario-common',
      probabilityPpm: 930_000,
      feeOrRebateQuote: '-1',
      adverseSelectionQuote: '1',
      opportunityDecayQuote: '0',
      cancelRaceQuote: '0',
      unhedgedLossQuote: '0',
      recoveryCostQuote: '0',
      lossQuote: '0',
      maxNakedQuantity: '1',
      maxNakedNotionalQuote: '100',
      maxNakedDurationMs: 5_000,
    }),
  ];
}

function inputForScenarios(scenarios, authority = {}) {
  return makeExecutionPolicyInput({
    authority: {
      authorizedMaxRecoveryCostQuote: '20',
      authorizedMaxTailLossQuote: '100',
      minimumCompletionPpm: 1_000_000,
      ...authority,
    },
    candidates: [makeCandidate({ posture: 'AGGRESSIVE', scenarios })],
  });
}

function equalityScenario(overrides = {}) {
  const recoveryCostQuote = overrides.recoveryCostQuote ?? '10';
  const lossQuote = overrides.lossQuote ?? recoveryCostQuote;
  return makeScenario({
    scenarioId: 'scenario-bound-equality',
    probabilityPpm: 1_000_000,
    feeOrRebateQuote: '0',
    adverseSelectionQuote: '0',
    opportunityDecayQuote: '0',
    cancelRaceQuote: '0',
    unhedgedLossQuote: '0',
    recoveryCostQuote,
    lossQuote,
    maxNakedQuantity: '1',
    maxNakedNotionalQuote: '100',
    maxNakedDurationMs: 5_000,
    ...structuredClone(overrides),
  });
}

function equalityInput(scenario = equalityScenario(), authority = {}) {
  return inputForScenarios([scenario], {
    authorizedMaxRecoveryCostQuote: '10',
    authorizedMaxTailLossQuote: '10',
    authorizedMaxNakedQuantity: '1',
    authorizedMaxNakedNotionalQuote: '100',
    authorizedMaxNakedDurationMs: 5_000,
    ...authority,
  });
}

test('exact policy arithmetic retains signed rebates and rational boundaries', () => {
  assert.equal(signedPolicyDecimal('-10'), '-10');
  assert.equal(addPolicyDecimals('-10', '40'), '30');
  assert.equal(weightedPolicyDecimal('100', 30_000), '3000000');
  assert.equal(comparePolicyDecimals('80.000000000000000000000001', '80'), 1);
  assert.equal(compareRationals('4000000', 50_000, '80', 1), 0);
  assert.equal(rationalWithinLimit('4000000', 50_000, '80'), true);
  assert.equal(rationalWithinLimit('4000000', 50_000, '79.999999999999999999999999'), false);
});

test('exported rational and PPM helpers reject invalid denominators and weights', () => {
  for (const denominator of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 1_000_001]) {
    assert.throws(() => compareRationals('1', denominator, '2', 1), TypeError);
    assert.throws(() => rationalWithinLimit('1', denominator, '2'), TypeError);
  }
  for (const probability of [-1, 1.5, 1_000_001, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => weightedPolicyDecimal('1', probability), TypeError);
  }
  const large = '999999999999999999999999999999999999999999999999999999999999999999999999';
  assert.equal(compareRationals(large, 1_000_000, large, 1_000_000), 0);
});

test('exact expectations and CVaR include only the required part of a VaR boundary atom', () => {
  const decision = planned(inputForScenarios(partialAtomScenarios(), {
    authorizedMaxScenarioLossQuote: '100',
    authorizedMaxTailLossQuote: '80',
  }));
  const metrics = decision.selectedPlan.metrics;

  assert.deepEqual(metrics.expectedFilledQuantityByLeg, [
    { legId: 'leg-perp', evidence: { weightedNumerator: '1000000', denominatorPpm: 1_000_000 } },
    { legId: 'leg-spot', evidence: { weightedNumerator: '1000000', denominatorPpm: 1_000_000 } },
  ]);
  assert.deepEqual(metrics.expectedLossQuote, {
    weightedNumerator: '5000000',
    denominatorPpm: 1_000_000,
  });
  assert.deepEqual(metrics.expectedRecoveryCostQuote, {
    weightedNumerator: '1000000',
    denominatorPpm: 1_000_000,
  });
  assert.equal(metrics.expectedNakedDurationMsNumerator, '5000000000');
  assert.equal(metrics.expectedFillLatencyMsNumerator, '500000000');
  assert.equal(metrics.maximumFillLatencyMs, 500);
  assert.equal(metrics.maximumLossQuote, '100');
  assert.deepEqual(metrics.cvarLossQuote, {
    confidencePpm: 950_000,
    tailMassPpm: 50_000,
    varLossQuote: '50',
    strictlyWorseMassPpm: 30_000,
    boundaryAtomMassPpm: 40_000,
    boundaryIncludedMassPpm: 20_000,
    weightedLossNumerator: '4000000',
    denominatorPpm: 50_000,
  });
  assert.equal(rationalWithinLimit(
    metrics.cvarLossQuote.weightedLossNumerator,
    metrics.cvarLossQuote.denominatorPpm,
    '80',
  ), true);
});

test('latency evidence is required, exact, deadline-bounded, and retained in the objective', () => {
  const equal = makeCandidate({
    scenarios: [makeScenario({ probabilityPpm: 1_000_000, fillLatencyMs: 2_000 })],
  });
  const plannedDecision = planned(makeExecutionPolicyInput({ candidates: [equal] }));
  assert.equal(plannedDecision.selectedPlan.metrics.expectedFillLatencyMsNumerator, '2000000000');
  assert.equal(plannedDecision.selectedPlan.metrics.maximumFillLatencyMs, 2_000);

  const late = makeCandidate({
    scenarios: [makeScenario({ probabilityPpm: 1_000_000, fillLatencyMs: 2_001 })],
  });
  rejected(makeExecutionPolicyInput({ candidates: [late] }), 'DISTRIBUTION_UNAVAILABLE');

  const missing = structuredClone(equal);
  delete missing.distribution.scenarios[0].fillLatencyMs;
  rejected(makeExecutionPolicyInput({ candidates: [rehashCandidate(missing)] }), 'INPUT_REJECTED');
});

test('owner-supplied calibration sample threshold passes equality and rejects below', () => {
  const equal = makeCandidate({ distribution: { sampleCount: 7, minimumRequiredSampleCount: 7 } });
  planned(makeExecutionPolicyInput({ candidates: [equal] }));
  const below = makeCandidate({ distribution: { sampleCount: 6, minimumRequiredSampleCount: 7 } });
  rejected(makeExecutionPolicyInput({ candidates: [below] }), 'DISTRIBUTION_UNCALIBRATED');
});

test('CVaR equality passes and one exact unit below it rejects without conflating the scenario-loss cap', () => {
  const scenarios = partialAtomScenarios();
  planned(inputForScenarios(scenarios, {
    authorizedMaxScenarioLossQuote: '100',
    authorizedMaxTailLossQuote: '80',
  }));

  const belowCvar = addPolicyDecimals('80', `-${SMALLEST_TEST_UNIT}`);
  const decision = rejected(inputForScenarios(scenarios, {
    authorizedMaxScenarioLossQuote: '100',
    authorizedMaxTailLossQuote: belowCvar,
  }), 'TAIL_LOSS_EXCEEDED');
  assert.equal(decision.candidateEvaluations[0].metrics.maximumLossQuote, '100');
  assert.equal(decision.candidateEvaluations[0].metrics.cvarLossQuote.weightedLossNumerator, '4000000');
});

test('signed rebate is retained in loss arithmetic and a mismatched retained loss fails closed', () => {
  planned(inputForScenarios(partialAtomScenarios()));

  const scenarios = partialAtomScenarios();
  scenarios[0].feeOrRebateQuote = '-10.000000000000000000000001';
  rejected(inputForScenarios(scenarios), 'INPUT_REJECTED');
});

test('scenario insertion order cannot change policy identity or evidence', () => {
  const input = inputForScenarios(partialAtomScenarios());
  const permuted = structuredClone(input);
  permuted.candidates[0].distribution.scenarios.reverse();
  permuted.candidates[0] = rehashCandidate(permuted.candidates[0]);

  assert.deepEqual(evaluateExecutionPolicy(permuted), evaluateExecutionPolicy(input));
});

test('equal-loss VaR atoms are grouped before the exact boundary cut', () => {
  const scenarios = [
    makeScenario({ scenarioId: 'equal-a', probabilityPpm: 40_000, lossQuote: '50', adverseSelectionQuote: '50' }),
    makeScenario({ scenarioId: 'equal-b', probabilityPpm: 40_000, lossQuote: '50', adverseSelectionQuote: '50' }),
    makeScenario({ scenarioId: 'common', probabilityPpm: 920_000, lossQuote: '0', adverseSelectionQuote: '0' }),
  ];
  const evidence = planned(inputForScenarios(scenarios)).selectedPlan.metrics.cvarLossQuote;
  assert.equal(evidence.varLossQuote, '50');
  assert.equal(evidence.boundaryAtomMassPpm, 80_000);
  assert.equal(evidence.boundaryIncludedMassPpm, 50_000);
  assert.equal(evidence.weightedLossNumerator, '2500000');
});

test('a one-PPM tail at the maximum confidence boundary is exact', () => {
  const scenarios = [
    makeScenario({ scenarioId: 'scenario-one-ppm-tail', probabilityPpm: 1, lossQuote: '100', adverseSelectionQuote: '100' }),
    makeScenario({ scenarioId: 'scenario-rest', probabilityPpm: 999_999, lossQuote: '0', adverseSelectionQuote: '0' }),
  ];
  const decision = planned(inputForScenarios(scenarios, {
    cvarConfidencePpm: 999_999,
    authorizedMaxTailLossQuote: '100',
  }));
  assert.deepEqual(decision.selectedPlan.metrics.cvarLossQuote, {
    confidencePpm: 999_999,
    tailMassPpm: 1,
    varLossQuote: '0',
    strictlyWorseMassPpm: 1,
    boundaryAtomMassPpm: 999_999,
    boundaryIncludedMassPpm: 0,
    weightedLossNumerator: '100',
    denominatorPpm: 1,
  });
});

for (const [name, probabilities] of [
  ['under', [30_000, 40_000, 929_999]],
  ['over', [30_000, 40_000, 930_001]],
  ['zero atom', [0, 40_000, 960_000]],
]) {
  test(`probability mass ${name} fails closed`, () => {
    const scenarios = partialAtomScenarios().map((scenario, index) => ({
      ...scenario,
      probabilityPpm: probabilities[index],
    }));
    rejected(inputForScenarios(scenarios), 'INPUT_REJECTED');
  });
}

test('FOK rejects a distribution that assigns a partial fill', () => {
  const candidate = makeCandidate({ posture: 'AGGRESSIVE' });
  candidate.actions[0] = rehashAction({ ...candidate.actions[0], timeInForce: 'FOK' });
  candidate.distribution.scenarios[1].fills[0].filledQuantity = '0.5';
  const input = makeExecutionPolicyInput({ candidates: [rehashCandidate(candidate)] });

  const decision = rejected(input, 'DISTRIBUTION_UNAVAILABLE');
  assert.deepEqual(decision.candidateEvaluations[0].reasonCodes, ['DISTRIBUTION_UNAVAILABLE']);
});

test('tail, recovery, and naked exposure equalities are inclusive', () => {
  const decision = planned(equalityInput());
  assert.equal(decision.selectedPlan.metrics.maximumLossQuote, '10');
  assert.equal(decision.selectedPlan.metrics.cvarLossQuote.weightedLossNumerator, '500000');
  assert.equal(decision.selectedPlan.metrics.cvarLossQuote.denominatorPpm, 50_000);
});

test('an exact unit above the tail-loss limit is rejected', () => {
  const loss = addPolicyDecimals('10', SMALLEST_TEST_UNIT);
  const scenario = equalityScenario({
    adverseSelectionQuote: loss,
    recoveryCostQuote: '0',
    lossQuote: loss,
  });
  rejected(equalityInput(scenario), 'TAIL_LOSS_EXCEEDED');
});

test('an exact unit above the recovery budget is rejected independently of the tail bound', () => {
  const recovery = addPolicyDecimals('10', SMALLEST_TEST_UNIT);
  const scenario = equalityScenario({ recoveryCostQuote: recovery, lossQuote: recovery });
  rejected(equalityInput(scenario, { authorizedMaxTailLossQuote: '100' }), 'RECOVERY_BUDGET_EXCEEDED');
});

test('exact units above naked quantity and notional limits are rejected', () => {
  const quantity = addPolicyDecimals('1', SMALLEST_TEST_UNIT);
  const notional = addPolicyDecimals('100', SMALLEST_TEST_UNIT);
  rejected(equalityInput(equalityScenario({ maxNakedQuantity: quantity })), 'CAPITAL_OR_RISK_LIMIT_EXCEEDED');
  rejected(equalityInput(equalityScenario({ maxNakedNotionalQuote: notional })), 'CAPITAL_OR_RISK_LIMIT_EXCEEDED');
});

test('one millisecond above the naked-duration limit is rejected', () => {
  rejected(equalityInput(equalityScenario({ maxNakedDurationMs: 5_001 })), 'NAKED_DURATION_EXCEEDED');
});

function rankedCandidate(scenarios) {
  return makeCandidate({ posture: 'AGGRESSIVE', scenarios });
}

function selectedFrom(left, right) {
  const decision = planned(makeExecutionPolicyInput({
    authority: {
      authorizedMaxRecoveryCostQuote: '100',
      authorizedMaxScenarioLossQuote: '100',
      authorizedMaxTailLossQuote: '100',
      minimumCompletionPpm: 0,
    },
    candidates: [right, left],
  }));
  return decision.selectedPlan.selectedCandidateId;
}

test('lexicographic objective reaches and proves each ranking tier', () => {
  const lossScenario = (scenarioId, probabilityPpm, lossQuote, overrides = {}) => makeScenario({
    scenarioId,
    probabilityPpm,
    feeOrRebateQuote: '0',
    adverseSelectionQuote: lossQuote,
    opportunityDecayQuote: '0',
    cancelRaceQuote: '0',
    unhedgedLossQuote: '0',
    recoveryCostQuote: '0',
    lossQuote,
    ...structuredClone(overrides),
  });

  const lowerMaximum = rankedCandidate([
    lossScenario('b-worst', 50_000, '20'),
    lossScenario('b-rest', 950_000, '0'),
  ]);
  const sameCvarHigherMaximum = rankedCandidate([
    lossScenario('a-worst', 10_000, '100'),
    lossScenario('a-rest', 990_000, '0'),
  ]);
  assert.equal(selectedFrom(lowerMaximum, sameCvarHigherMaximum), lowerMaximum.candidateId);

  const lowerMean = rankedCandidate([
    lossScenario('mean-worst', 50_000, '100'),
    lossScenario('mean-rest', 950_000, '0'),
  ]);
  const higherMean = rankedCandidate([
    lossScenario('mean2-worst', 50_000, '100'),
    lossScenario('mean2-rest', 950_000, '1'),
  ]);
  assert.equal(selectedFrom(lowerMean, higherMean), lowerMean.candidateId);

  const lowerRecovery = rankedCandidate([lossScenario('recovery-low', 1_000_000, '10')]);
  const higherRecovery = rankedCandidate([lossScenario('recovery-high', 1_000_000, '10', {
    adverseSelectionQuote: '8', recoveryCostQuote: '2',
  })]);
  assert.equal(selectedFrom(lowerRecovery, higherRecovery), lowerRecovery.candidateId);

  const lowerLatency = rankedCandidate([lossScenario('latency-low', 1_000_000, '10', { fillLatencyMs: 100 })]);
  const higherLatency = rankedCandidate([lossScenario('latency-high', 1_000_000, '10', { fillLatencyMs: 200 })]);
  assert.equal(selectedFrom(lowerLatency, higherLatency), lowerLatency.candidateId);

  const lowerExpectedLatency = rankedCandidate([
    lossScenario('latency-mixed-fast', 500_000, '10', { fillLatencyMs: 0 }),
    lossScenario('latency-mixed-slow', 500_000, '10', { fillLatencyMs: 1_000 }),
  ]);
  const higherExpectedLatency = rankedCandidate([
    lossScenario('latency-always-slow', 1_000_000, '10', { fillLatencyMs: 1_000 }),
  ]);
  assert.equal(selectedFrom(lowerExpectedLatency, higherExpectedLatency), lowerExpectedLatency.candidateId);

  const lowerDuration = rankedCandidate([lossScenario('duration-low', 1_000_000, '10', { maxNakedDurationMs: 100 })]);
  const higherDuration = rankedCandidate([lossScenario('duration-high', 1_000_000, '10', { maxNakedDurationMs: 200 })]);
  assert.equal(selectedFrom(lowerDuration, higherDuration), lowerDuration.candidateId);

  const higherFill = rankedCandidate([lossScenario('fill-high', 1_000_000, '10', {
    fills: [
      { legId: 'leg-spot', filledQuantity: '1' },
      { legId: 'leg-perp', filledQuantity: '0.5' },
    ],
  })]);
  const lowerFill = rankedCandidate([lossScenario('fill-low', 1_000_000, '10', {
    fills: [
      { legId: 'leg-spot', filledQuantity: '1' },
      { legId: 'leg-perp', filledQuantity: '0.4' },
    ],
  })]);
  assert.equal(selectedFrom(higherFill, lowerFill), higherFill.candidateId);

  const higherCompletion = rankedCandidate([
    lossScenario('completion-full', 500_000, '10'),
    lossScenario('completion-zero', 500_000, '10', {
      fills: [
        { legId: 'leg-spot', filledQuantity: '0' },
        { legId: 'leg-perp', filledQuantity: '0' },
      ],
    }),
  ]);
  const lowerCompletion = rankedCandidate([lossScenario('completion-half', 1_000_000, '10', {
    fills: [
      { legId: 'leg-spot', filledQuantity: '0.5' },
      { legId: 'leg-perp', filledQuantity: '0.5' },
    ],
  })]);
  assert.equal(selectedFrom(higherCompletion, lowerCompletion), higherCompletion.candidateId);
});
