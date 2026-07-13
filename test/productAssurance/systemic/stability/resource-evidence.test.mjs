import assert from 'node:assert/strict';
import test from 'node:test';

import { SYNTHETIC_RESOURCE_TRUST_BINDING } from '../../../../fixtures/productAssurance/systemic/stability/contracts.mjs';

import {
  FIXTURE_NOW_MS,
  RESOURCE_FIXTURES,
  makeResourceEvidenceBundle,
} from '../../../../fixtures/productAssurance/systemic/stability/fixtures.mjs';
import { evaluateResourceEvidence } from '../../../../fixtures/productAssurance/systemic/stability/reference-evaluator.mjs';

function clearClosedBaseline(circuit) {
  Object.assign(circuit, {
    baselineNeverOpenedEvidenceRef: null,
    baselineEvidenceOwner: null,
    baselineEvidenceFailureDomain: null,
  });
}

function moveCircuitToOpen(circuit, openedAtMs = FIXTURE_NOW_MS - 1_000) {
  clearClosedBaseline(circuit);
  Object.assign(circuit, {
    state: 'OPEN',
    unknownReason: null,
    openedAtMs,
    halfOpenAtMs: null,
    resetEligibleAtMs: null,
    closedAtMs: null,
    independentCloseEvidenceRef: null,
    independentCloseOwner: null,
    independentCloseFailureDomain: null,
  });
}

function moveCircuitToHalfOpen(circuit) {
  clearClosedBaseline(circuit);
  Object.assign(circuit, {
    state: 'HALF_OPEN',
    unknownReason: null,
    openedAtMs: FIXTURE_NOW_MS - 2_000,
    halfOpenAtMs: FIXTURE_NOW_MS - 1_000,
    resetEligibleAtMs: null,
    closedAtMs: null,
    independentCloseEvidenceRef: null,
    independentCloseOwner: null,
    independentCloseFailureDomain: null,
  });
}

for (const fixture of RESOURCE_FIXTURES) {
  test(`${fixture.id} evaluates deterministically`, () => {
    const first = evaluateResourceEvidence(fixture.input, FIXTURE_NOW_MS);
    const second = evaluateResourceEvidence(fixture.input, FIXTURE_NOW_MS);
    assert.deepEqual(first, second);
    assert.equal(first.assuranceResult, fixture.expectedResult);
    assert.equal(first.dataAuthority, 'SYNTHETIC_TEST');
    assert.equal(first.effectAuthority, 'NONE');
    if (!first.reasonCodes?.includes('CONTRACT_INVALID')) {
      assert.equal(first.mayThrottle, false);
      assert.equal(first.mayExecute, false);
      assert.equal(first.mayCloseOrResetCircuit, false);
      assert.equal(first.controllerOwner, null);
      assert.equal(first.throttleDecision, null);
      assert.deepEqual(first.commands, []);
    }
    if (fixture.expectedContractCode) {
      assert.ok(first.contractIssues.some((issue) => issue.code === fixture.expectedContractCode), first.contractIssues.map((issue) => issue.code).join(','));
    }
    if (fixture.expectedFamily) {
      const row = first.rows.find((entry) => entry.resourceFamily === fixture.expectedFamily);
      assert.ok(row);
      assert.ok(row.reasonCodes.includes(fixture.expectedReason), row.reasonCodes.join(','));
    }
  });
}

test('complete resource evidence preserves the exact denominator and protected order', () => {
  const assessment = evaluateResourceEvidence(makeResourceEvidenceBundle(), FIXTURE_NOW_MS);
  assert.equal(assessment.rows.length, 8);
  assert.deepEqual(assessment.rows.map((row) => row.resourceFamily), [
    'LLM_TOKENS', 'APIS', 'BINANCE_RATE_LIMITS', 'TELEMETRY_STORAGE',
    'REPLAY_COMPUTE', 'DATABASE_WAL_GROWTH', 'CLOUD_COST', 'BACKGROUND_JOB_CONCURRENCY',
  ]);
  const firstProtected = assessment.loadSheddingOrder.indexOf('ACTIVE_POSITION_SUPERVISION');
  assert.ok(assessment.loadSheddingOrder.indexOf('BROAD_ENRICHMENT') < firstProtected);
  assert.ok(assessment.loadSheddingOrder.indexOf('SAFE_RISK_REDUCTION') >= firstProtected);
});

test('unknown forecast stays null and visible, never zero', () => {
  const fixture = RESOURCE_FIXTURES.find((entry) => entry.id === 'E02_UNKNOWN_FORECAST_REMAINS_NULL');
  const assessment = evaluateResourceEvidence(fixture.input, FIXTURE_NOW_MS);
  const telemetry = assessment.rows.find((row) => row.resourceFamily === 'TELEMETRY_STORAGE');
  assert.equal(telemetry.forecast, null);
  assert.equal(telemetry.forecastHorizonMs, null);
  assert.equal(telemetry.unknownReason, 'forecast owner has not supplied a bounded projection');
});

test('over-budget evidence remains a read-only owner recommendation', () => {
  const fixture = RESOURCE_FIXTURES.find((entry) => entry.id === 'E07_RESOURCE_BUDGET_EXHAUSTION_IS_VISIBLE_EVIDENCE_ONLY');
  const assessment = evaluateResourceEvidence(fixture.input, FIXTURE_NOW_MS);
  const row = assessment.rows.find((entry) => entry.resourceFamily === 'LLM_TOKENS');
  assert.equal(row.assuranceResult, 'FAIL');
  assert.equal(row.throttleDecision, null);
  assert.deepEqual(row.commands, []);
  assert.equal(row.canonicalResponse.kind, 'UNKNOWN');
});

test('projected exhaustion is surfaced without issuing a throttle or circuit command', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].forecast.value = 70;
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  const row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'FAIL');
  assert.ok(row.reasonCodes.includes('PROJECTED_RESOURCE_EXHAUSTION'));
  assert.equal(assessment.mayThrottle, false);
  assert.equal(assessment.mayCloseOrResetCircuit, false);
  assert.deepEqual(assessment.commands, []);
});

test('forecast equality is exhaustion at the declared horizon boundary', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].forecast.value = bundle.rows[0].budget.remaining;
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  const row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'FAIL');
  assert.ok(row.reasonCodes.includes('PROJECTED_RESOURCE_EXHAUSTION'));
});

test('known exhaustion remains FAIL when an unrelated numeric dimension is UNKNOWN', () => {
  const exhaustedBudget = structuredClone(makeResourceEvidenceBundle());
  exhaustedBudget.rows[0].burn.value = exhaustedBudget.rows[0].budget.limit;
  exhaustedBudget.rows[0].budget.remaining = 0;
  exhaustedBudget.rows[0].forecast = {
    value: null,
    horizonMs: null,
    unknownReason: 'forecast owner has not supplied a bounded projection',
  };
  let assessment = evaluateResourceEvidence(exhaustedBudget, FIXTURE_NOW_MS);
  let row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'FAIL');
  assert.ok(row.reasonCodes.includes('RESOURCE_BUDGET_EXHAUSTED'));
  assert.ok(row.reasonCodes.includes('BURN_BUDGET_OR_FORECAST_UNKNOWN'));

  const exhaustedForecast = structuredClone(makeResourceEvidenceBundle());
  exhaustedForecast.rows[0].burn = {
    value: null,
    unknownReason: 'burn owner has not supplied a bounded measurement',
  };
  exhaustedForecast.rows[0].forecast.value = exhaustedForecast.rows[0].budget.remaining;
  assessment = evaluateResourceEvidence(exhaustedForecast, FIXTURE_NOW_MS);
  row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'FAIL');
  assert.ok(row.reasonCodes.includes('PROJECTED_RESOURCE_EXHAUSTION'));
  assert.ok(row.reasonCodes.includes('BURN_BUDGET_OR_FORECAST_UNKNOWN'));
});

test('every statically visible attention state requires an exact response or unavailable blocker', () => {
  const mutations = [
    (row) => {
      row.burn.value = 100;
      row.budget.remaining = 0;
    },
    (row) => { row.protections.auditEvidencePreserved = 'FAIL'; },
    (row) => {
      moveCircuitToOpen(row.circuit);
    },
  ];
  for (const mutate of mutations) {
    const bundle = structuredClone(makeResourceEvidenceBundle());
    const row = bundle.rows[0];
    mutate(row);
    row.canonicalResponse = {
      kind: 'NONE',
      referenceId: null,
      owner: row.canonicalOwner,
      wiringState: 'OWNER_GATED',
      unknownReason: null,
    };
    const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(assessment.contractIssues.some((issue) => issue.code === 'ATTENTION_RESPONSE_REQUIRED'));
  }
});

test('temporal attention with no source response becomes an honest unavailable blocker', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].observedAtMs = FIXTURE_NOW_MS - 10_000;
  bundle.rows[0].canonicalResponse = {
    kind: 'NONE',
    referenceId: null,
    owner: bundle.rows[0].canonicalOwner,
    wiringState: 'OWNER_GATED',
    unknownReason: null,
  };
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  const row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'UNKNOWN');
  assert.ok(row.reasonCodes.includes('CANONICAL_RESPONSE_UNAVAILABLE_FOR_ATTENTION'));
  assert.deepEqual(row.canonicalResponse, {
    kind: 'UNKNOWN',
    referenceId: null,
    owner: bundle.rows[0].canonicalOwner,
    wiringState: 'UNAVAILABLE',
    unknownReason: 'canonical owner response evidence is unavailable for this resource attention state',
  });
});

test('unknown top-consumer and circuit evidence remains UNKNOWN with exact blockers', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].topConsumers[0] = {
    consumerId: 'synthetic.consumer.unknown',
    amount: null,
    unknownReason: 'accepted owner did not supply an attributable amount',
    evidenceRef: null,
  };
  bundle.rows[0].circuit = {
    state: 'UNKNOWN',
    canonicalOwner: SYNTHETIC_RESOURCE_TRUST_BINDING.circuitOwner,
    ownerFailureDomain: null,
    observedAtMs: null,
    maxAgeMs: 5_000,
    evidenceRef: null,
    unknownReason: 'accepted owner did not supply circuit state',
    baselineNeverOpenedEvidenceRef: null,
    baselineEvidenceOwner: null,
    baselineEvidenceFailureDomain: null,
    openedAtMs: null,
    halfOpenAtMs: null,
    closedAtMs: null,
    resetEligibleAtMs: null,
    independentCloseEvidenceRef: null,
    independentCloseOwner: null,
    independentCloseFailureDomain: null,
    mayCloseOrReset: false,
  };
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  const row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'UNKNOWN');
  assert.ok(row.reasonCodes.includes('TOP_CONSUMERS_UNPROVED'));
  assert.ok(row.reasonCodes.includes('CIRCUIT_STATE_UNKNOWN'));
});

test('throttling evidence has an injected-clock freshness boundary', () => {
  const stale = structuredClone(makeResourceEvidenceBundle());
  stale.rows[0].throttling.observedAtMs = FIXTURE_NOW_MS - 10_000;
  let assessment = evaluateResourceEvidence(stale, FIXTURE_NOW_MS);
  assert.equal(assessment.rows[0].assuranceResult, 'UNKNOWN');
  assert.ok(assessment.rows[0].reasonCodes.includes('THROTTLING_EVIDENCE_STALE'));

  const future = structuredClone(makeResourceEvidenceBundle());
  future.rows[0].throttling.observedAtMs = FIXTURE_NOW_MS + 1;
  assessment = evaluateResourceEvidence(future, FIXTURE_NOW_MS);
  assert.equal(assessment.rows[0].assuranceResult, 'FAIL');
  assert.ok(assessment.rows[0].reasonCodes.includes('THROTTLING_EVIDENCE_FROM_FUTURE'));
});

test('top-consumer identities are unique and known attribution cannot exceed burn', () => {
  const duplicate = structuredClone(makeResourceEvidenceBundle());
  duplicate.rows[0].topConsumers.push(structuredClone(duplicate.rows[0].topConsumers[0]));
  let assessment = evaluateResourceEvidence(duplicate, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'DUPLICATE_CONSUMER_ID'));

  const impossible = structuredClone(makeResourceEvidenceBundle());
  impossible.rows[0].topConsumers[0].amount = impossible.rows[0].burn.value + 1;
  assessment = evaluateResourceEvidence(impossible, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'TOP_CONSUMER_ATTRIBUTION_EXCEEDS_BURN'));
});

test('circuit transition claims are fully ordered, conditionally present, and independently sourced', () => {
  const cases = [
    ['INDEPENDENT_CIRCUIT_CLOSE_EVIDENCE_REQUIRED', (circuit) => { circuit.independentCloseEvidenceRef = 'synthetic.orphan.close-proof'; }],
    ['INDEPENDENT_CIRCUIT_CLOSE_EVIDENCE_REQUIRED', (circuit) => { circuit.resetEligibleAtMs = FIXTURE_NOW_MS - 1_000; }],
    ['INDEPENDENT_CIRCUIT_CLOSE_EVIDENCE_REQUIRED', (circuit) => {
      Object.assign(circuit, {
        openedAtMs: FIXTURE_NOW_MS - 4_000,
        halfOpenAtMs: FIXTURE_NOW_MS - 3_000,
        resetEligibleAtMs: FIXTURE_NOW_MS - 5_000,
        closedAtMs: FIXTURE_NOW_MS - 1_000,
        independentCloseEvidenceRef: 'synthetic.independent.close-proof',
        independentCloseOwner: 'independent.circuit.verifier',
        independentCloseFailureDomain: 'independent.circuit-verifier-domain',
      });
    }],
    ['COMMON_MODE_CIRCUIT_CLOSE_FORBIDDEN', (circuit) => {
      Object.assign(circuit, {
        openedAtMs: FIXTURE_NOW_MS - 4_000,
        halfOpenAtMs: FIXTURE_NOW_MS - 3_000,
        resetEligibleAtMs: FIXTURE_NOW_MS - 2_000,
        closedAtMs: FIXTURE_NOW_MS - 1_000,
        independentCloseEvidenceRef: 'synthetic.different-reference.same-owner',
        independentCloseOwner: circuit.canonicalOwner,
        independentCloseFailureDomain: 'independent.circuit-verifier-domain',
      });
    }],
  ];
  for (const [code, mutate] of cases) {
    const bundle = structuredClone(makeResourceEvidenceBundle());
    clearClosedBaseline(bundle.rows[0].circuit);
    mutate(bundle.rows[0].circuit);
    const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(assessment.contractIssues.some((issue) => issue.code === code), assessment.contractIssues.map((issue) => issue.code).join(','));
  }
});

test('CLOSED baseline proof is complete and structurally independent', () => {
  const valid = evaluateResourceEvidence(makeResourceEvidenceBundle(), FIXTURE_NOW_MS);
  assert.equal(valid.assuranceResult, 'UNKNOWN');
  assert.deepEqual(valid.contractIssues, []);

  const cases = [
    (circuit) => clearClosedBaseline(circuit),
    (circuit) => {
      clearClosedBaseline(circuit);
      circuit.baselineNeverOpenedEvidenceRef = 'synthetic.partial-baseline-proof';
    },
    (circuit) => { circuit.baselineEvidenceOwner = circuit.canonicalOwner; },
    (circuit) => { circuit.baselineEvidenceFailureDomain = circuit.ownerFailureDomain; },
  ];
  for (const mutate of cases) {
    const bundle = structuredClone(makeResourceEvidenceBundle());
    mutate(bundle.rows[0].circuit);
    const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(
      assessment.contractIssues.some((issue) => issue.code === 'INDEPENDENT_CIRCUIT_BASELINE_EVIDENCE_REQUIRED'),
      assessment.contractIssues.map((issue) => issue.code).join(','),
    );
  }
});

test('UNAVAILABLE canonical response wiring cannot carry an affirmative recommendation', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].canonicalResponse.kind = 'RECOMMENDATION';
  bundle.rows[0].canonicalResponse.referenceId = 'synthetic.owner-action.resource.001';
  bundle.rows[0].canonicalResponse.unknownReason = null;
  bundle.rows[0].canonicalResponse.wiringState = 'UNAVAILABLE';
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'UNAVAILABLE_RESPONSE_MUST_BE_UNKNOWN'));
});

test('burn, budget, and forecast preserve distinct exact UNKNOWN blockers', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].burn = { value: null, unknownReason: 'burn owner evidence missing' };
  bundle.rows[0].budget = { limit: null, remaining: null, unknownReason: 'budget owner evidence missing' };
  bundle.rows[0].forecast = { value: null, horizonMs: null, unknownReason: 'forecast owner evidence missing' };
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  const row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'UNKNOWN');
  assert.deepEqual(row.unknownReasons, {
    burn: 'burn owner evidence missing',
    budget: 'budget owner evidence missing',
    forecast: 'forecast owner evidence missing',
  });
});

test('resource evaluation freezes only reconstructed output, never caller-owned evidence', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  const before = structuredClone(bundle);
  const consumerInput = bundle.rows[0].topConsumers;
  const circuitInput = bundle.rows[0].circuit;
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  assert.deepEqual(bundle, before);
  assert.equal(Object.isFrozen(bundle), false);
  assert.equal(Object.isFrozen(consumerInput), false);
  assert.equal(Object.isFrozen(circuitInput), false);
  assert.equal(Object.isFrozen(assessment), true);
  assert.notEqual(assessment.rows[0].topConsumers, consumerInput);
  assert.notEqual(assessment.rows[0].circuitEvidence, circuitInput);
});

test('paired resource owner and circuit relabeling cannot manufacture trusted evidence', () => {
  const ownerForgery = structuredClone(makeResourceEvidenceBundle());
  ownerForgery.rows[0].canonicalOwner = 'forged.resource.owner';
  ownerForgery.rows[0].throttling.canonicalOwner = 'forged.resource.owner';
  ownerForgery.rows[0].canonicalResponse.owner = 'forged.resource.owner';
  let assessment = evaluateResourceEvidence(ownerForgery, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'SYNTHETIC_RESOURCE_OWNER_TRUST_BINDING_MISMATCH'));

  const circuitForgery = structuredClone(makeResourceEvidenceBundle());
  const circuit = circuitForgery.rows[0].circuit;
  circuit.canonicalOwner = 'forged.circuit.owner';
  circuit.ownerFailureDomain = 'forged.circuit.domain';
  circuit.baselineEvidenceOwner = 'forged.baseline.owner';
  circuit.baselineEvidenceFailureDomain = 'forged.baseline.domain';
  assessment = evaluateResourceEvidence(circuitForgery, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'SYNTHETIC_RESOURCE_CIRCUIT_TRUST_BINDING_MISMATCH'));
});

test('future circuit evidence fails and cannot close or reset owner state', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.rows[0].circuit.observedAtMs = FIXTURE_NOW_MS + 1;
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  const row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'FAIL');
  assert.ok(row.reasonCodes.includes('CIRCUIT_EVIDENCE_FROM_FUTURE'));
  assert.equal(row.circuitEvidence.mayCloseOrReset, false);
  assert.equal(assessment.mayCloseOrResetCircuit, false);
});

test('OPEN, HALF_OPEN, and stale circuit evidence remain visible without circuit authority', () => {
  const open = structuredClone(makeResourceEvidenceBundle());
  moveCircuitToOpen(open.rows[0].circuit);
  let assessment = evaluateResourceEvidence(open, FIXTURE_NOW_MS);
  let row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'FAIL');
  assert.ok(row.reasonCodes.includes('RESOURCE_CIRCUIT_OPEN'));
  assert.equal(row.circuitEvidence.mayCloseOrReset, false);

  const halfOpen = structuredClone(makeResourceEvidenceBundle());
  moveCircuitToHalfOpen(halfOpen.rows[0].circuit);
  assessment = evaluateResourceEvidence(halfOpen, FIXTURE_NOW_MS);
  row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'UNKNOWN');
  assert.ok(row.reasonCodes.includes('RESOURCE_CIRCUIT_HALF_OPEN'));
  assert.equal(row.circuitEvidence.mayCloseOrReset, false);

  const stale = structuredClone(makeResourceEvidenceBundle());
  stale.rows[0].circuit.observedAtMs = FIXTURE_NOW_MS - 10_000;
  assessment = evaluateResourceEvidence(stale, FIXTURE_NOW_MS);
  row = assessment.rows[0];
  assert.equal(row.assuranceResult, 'UNKNOWN');
  assert.ok(row.reasonCodes.includes('CIRCUIT_EVIDENCE_STALE'));
  assert.equal(assessment.mayCloseOrResetCircuit, false);
  assert.deepEqual(assessment.commands, []);
});

test('malformed shedding order fails closed instead of throwing', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  bundle.loadSheddingOrder = null;
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'STRING_ARRAY_REQUIRED'));
});

test('malformed resource subobjects fail closed instead of throwing', () => {
  for (const mutate of [
    (bundle) => { bundle.rows[0].burn = null; },
    (bundle) => { bundle.rows[0].budget = null; },
    (bundle) => { bundle.rows[0] = {}; },
  ]) {
    const bundle = structuredClone(makeResourceEvidenceBundle());
    mutate(bundle);
    let assessment;
    assert.doesNotThrow(() => { assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS); });
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(assessment.reasonCodes.includes('CONTRACT_INVALID'));
  }
});

test('resource evaluation rejects changing measurement accessors without invoking them', () => {
  const bundle = structuredClone(makeResourceEvidenceBundle());
  let getterCalls = 0;
  Object.defineProperty(bundle.rows[0].burn, 'value', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return getterCalls < 3 ? 40 : 100;
    },
  });
  const assessment = evaluateResourceEvidence(bundle, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.deepEqual(assessment.reasonCodes, ['CONTRACT_INVALID']);
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'PLAIN_DATA_SNAPSHOT_REQUIRED'));
  assert.equal(getterCalls, 0);
});
