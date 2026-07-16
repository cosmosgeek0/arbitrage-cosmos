import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createBudgetState,
  createCriticalityProof,
  createUsageReceipt,
  evaluateUsageAdmission,
  projectProviderRoute,
  recordUsage,
} from '../../../dist/aiOps/runtime/index.js';
import { createSyntheticSigner, runSyntheticProvider } from '../../../../fixtures/aiOps/a2/synthetic-runtime.mjs';
import { canonicalJson } from '../../../dist/foundation/contracts/identity.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const atMs = 1_700_000_200_000;
const signer = createSyntheticSigner();
const usage = (overrides = {}) => ({
  calls: 0,
  toolCalls: 0,
  webQueries: 0,
  tokens: 0,
  costMicrounits: 0,
  latencyMs: 0,
  wallTimeMs: 0,
  ...overrides,
});
const caps = Object.freeze({
  policyRevision: 'budget-policy-v1',
  perCase: Object.freeze(usage({ calls: 5, toolCalls: 5, webQueries: 5, tokens: 1_000, costMicrounits: 10_000, latencyMs: 20_000, wallTimeMs: 30_000 })),
  hourly: Object.freeze(usage({ calls: 10, toolCalls: 10, webQueries: 10, tokens: 2_000, costMicrounits: 20_000, latencyMs: 40_000, wallTimeMs: 60_000 })),
  daily: Object.freeze(usage({ calls: 20, toolCalls: 20, webQueries: 20, tokens: 4_000, costMicrounits: 40_000, latencyMs: 80_000, wallTimeMs: 120_000 })),
  monthly: Object.freeze(usage({ calls: 100, toolCalls: 100, webQueries: 100, tokens: 20_000, costMicrounits: 200_000, latencyMs: 400_000, wallTimeMs: 600_000 })),
  globalHourly: Object.freeze(usage({ calls: 10, toolCalls: 10, webQueries: 10, tokens: 2_000, costMicrounits: 20_000, latencyMs: 40_000, wallTimeMs: 60_000 })),
  globalDaily: Object.freeze(usage({ calls: 20, toolCalls: 20, webQueries: 20, tokens: 4_000, costMicrounits: 40_000, latencyMs: 80_000, wallTimeMs: 120_000 })),
  globalMonthly: Object.freeze(usage({ calls: 100, toolCalls: 100, webQueries: 100, tokens: 20_000, costMicrounits: 200_000, latencyMs: 400_000, wallTimeMs: 600_000 })),
  criticalReserve: Object.freeze(usage({ calls: 2, toolCalls: 2, webQueries: 2, tokens: 200, costMicrounits: 2_000, latencyMs: 4_000, wallTimeMs: 6_000 })),
});
const criticality = (critical, caseId = 'case-budget-1', policyRevision = 'budget-policy-v1', occurredAtMs = atMs) => createCriticalityProof({
  caseId,
  policyRevision,
  critical,
  issuedAtMs: occurredAtMs - 1,
  expiresAtMs: occurredAtMs + 1_000,
}, signer);

function receipt(receiptId, measuredUsage, overrides = {}) {
  const {
    critical = false,
    criticalityProof,
    budgetAdmission,
    ...fields
  } = overrides;
  const caseId = fields.caseId ?? 'case-budget-1';
  const providerId = fields.providerId ?? 'synthetic-provider-a2';
  const modelId = fields.modelId ?? 'synthetic-model-a2';
  const policyRevision = fields.policyRevision ?? 'budget-policy-v1';
  const occurredAtMs = fields.occurredAtMs ?? atMs;
  const recordedAtMs = fields.recordedAtMs ?? occurredAtMs;
  const proof = criticalityProof ?? createCriticalityProof({
    caseId,
    policyRevision,
    critical,
    issuedAtMs: recordedAtMs - 1,
    expiresAtMs: recordedAtMs + 1_000,
  }, signer);
  const admissionProof = createCriticalityProof({
    caseId,
    policyRevision,
    critical: proof.critical,
    issuedAtMs: occurredAtMs - 1,
    expiresAtMs: occurredAtMs + 1_000,
  }, signer);
  const admissionCaps = policyRevision === caps.policyRevision ? caps : Object.freeze({ ...caps, policyRevision });
  const admission = budgetAdmission ?? evaluateUsageAdmission(
    createBudgetState(policyRevision),
    admissionCaps,
    caseId,
    providerId,
    modelId,
    occurredAtMs,
    usage({ calls: 1 }),
    admissionProof,
    signer,
  );
  return createUsageReceipt({
    receiptId,
    caseId,
    providerId,
    modelId,
    policyRevision,
    occurredAtMs,
    recordedAtMs,
    usage: measuredUsage,
    criticalityProof: proof,
    ...fields,
  }, admission, signer);
}

function record(state, usageReceipt, trustedRecordTime = usageReceipt.recordedAtMs) {
  return recordUsage(state, caps, usageReceipt, trustedRecordTime, signer);
}

function routeBudgetContext({
  state = createBudgetState('budget-policy-v1'),
  budgetCaps = caps,
  caseId = 'case-route',
  requested = usage({ calls: 1 }),
  critical = true,
} = {}) {
  const proof = criticality(critical, caseId);
  return Object.freeze({ state, caps: budgetCaps, caseId, evaluatedAtMs: atMs, requested, criticality: proof });
}

test('budget admission is exact at the per-case boundary and rejects plus one', () => {
  const state = createBudgetState('budget-policy-v1');
  const exact = evaluateUsageAdmission(state, caps, 'case-budget-1', 'synthetic-provider-a2', 'synthetic-model-a2', atMs, caps.perCase, criticality(true), signer);
  assert.equal(exact.admitted, true);
  const over = evaluateUsageAdmission(state, caps, 'case-budget-1', 'synthetic-provider-a2', 'synthetic-model-a2', atMs, { ...caps.perCase, calls: 6 }, criticality(true), signer);
  assert.equal(over.admitted, false);
  assert.ok(over.reasonCodes.includes('PER_CASE_BUDGET_CALLS_EXHAUSTED'));
});

test('noncritical work preserves aggregate reserve while critical work may consume it', () => {
  let state = createBudgetState('budget-policy-v1');
  state = record(state, receipt('reserve-a', usage({ calls: 5 }), { caseId: 'case-reserve-a', critical: true })).state;
  state = record(state, receipt('reserve-b', usage({ calls: 3 }), { caseId: 'case-reserve-b', critical: true })).state;
  const noncritical = evaluateUsageAdmission(state, caps, 'case-reserve-c', 'synthetic-provider-a2', 'synthetic-model-a2', atMs, usage({ calls: 1 }), criticality(false, 'case-reserve-c'), signer);
  assert.equal(noncritical.admitted, false);
  assert.ok(noncritical.reasonCodes.includes('PROVIDER_HOURLY_BUDGET_CALLS_EXHAUSTED'));
  const critical = evaluateUsageAdmission(state, caps, 'case-reserve-c', 'synthetic-provider-a2', 'synthetic-model-a2', atMs, usage({ calls: 1 }), criticality(true, 'case-reserve-c'), signer);
  assert.equal(critical.admitted, true);
});

test('usage receipts cover tool, web, token, cost, latency, and wall time and remain conflict-safe', () => {
  let state = createBudgetState('budget-policy-v1');
  const first = receipt('receipt-1', usage({ calls: 1, toolCalls: 1, webQueries: 1, tokens: 100, costMicrounits: 500, latencyMs: 250, wallTimeMs: 300 }));
  const recorded = record(state, first);
  assert.equal(recorded.status, 'RECORDED');
  state = recorded.state;
  assert.equal(record(state, first, atMs + 1).status, 'IDEMPOTENT');
  assert.throws(() => record(state, { ...first, usage: { ...first.usage, tokens: 101 } }), /digest mismatch/u);
  const admissionForAnotherProvider = evaluateUsageAdmission(
    createBudgetState('budget-policy-v1'), caps, 'case-budget-1', 'provider-a', 'model-a',
    atMs, usage({ calls: 1 }), criticality(false), signer,
  );
  assert.throws(() => receipt('cross-provider-lineage', usage({ calls: 1 }), {
    providerId: 'provider-b', modelId: 'model-b', budgetAdmission: admissionForAnotherProvider,
  }), /provider budget lineage/u);
  assert.throws(() => receipt('negative', usage({ calls: -1 })), /non-negative/u);
  const validProof = criticality(false);
  const validAdmission = evaluateUsageAdmission(
    createBudgetState('budget-policy-v1'), caps, 'case-budget-1', 'synthetic-provider-a2', 'synthetic-model-a2',
    atMs, usage({ calls: 1 }), validProof, signer,
  );
  assert.throws(() => createUsageReceipt({
    receiptId: 'bad-flag', caseId: 'case-budget-1', providerId: 'synthetic-provider-a2', modelId: 'synthetic-model-a2',
    policyRevision: 'budget-policy-v1', occurredAtMs: atMs, recordedAtMs: atMs, usage: usage(), criticalityProof: { ...validProof, critical: 'yes' },
  }, validAdmission, signer), /boolean|criticality|digest mismatch/u);
  assert.throws(() => record(state, receipt('wrong-policy', usage({ calls: 1 }), { policyRevision: 'other-policy' })), /policy revision mismatch/u);
  const forgedCritical = { ...criticality(true), signature: { ...criticality(true).signature, signature: 'f'.repeat(64) } };
  assert.throws(() => evaluateUsageAdmission(state, caps, 'case-budget-1', 'synthetic-provider-a2', 'synthetic-model-a2', atMs, usage({ calls: 1 }), forgedCritical, signer), /signature invalid/u);
});

test('trusted record time prevents future, backdated-bucket, and nonmonotonic usage accounting', () => {
  let state = createBudgetState('budget-policy-v1');
  const backdatedOccurrence = receipt('backdated-occurrence', usage({ calls: 2 }), {
    occurredAtMs: atMs - 86_400_000,
    recordedAtMs: atMs,
    critical: true,
  });
  state = record(state, backdatedOccurrence, atMs).state;
  const current = evaluateUsageAdmission(state, caps, 'case-other', 'synthetic-provider-a2', 'synthetic-model-a2', atMs, usage(), criticality(true, 'case-other'), signer);
  assert.equal(current.usage.hourly.calls, 2);
  assert.throws(() => evaluateUsageAdmission(
    state,
    caps,
    'case-other',
    'synthetic-provider-a2',
    'synthetic-model-a2',
    atMs - 1,
    usage({ calls: 1 }),
    criticality(true, 'case-other', 'budget-policy-v1', atMs - 1),
    signer,
  ), /latest usage receipt/u);

  const futureRecord = receipt('future-record', usage({ calls: 1 }), { recordedAtMs: atMs + 1, critical: true });
  assert.throws(() => record(state, futureRecord, atMs), /trusted current record time/u);
  const regressed = receipt('regressed-record', usage({ calls: 1 }), {
    occurredAtMs: atMs - 1,
    recordedAtMs: atMs - 1,
    critical: true,
  });
  assert.throws(() => record(state, regressed, atMs - 1), /monotonic/u);
  const occurrenceProof = criticality(false);
  const occurrenceAdmission = evaluateUsageAdmission(
    createBudgetState('budget-policy-v1'), caps, 'case-budget-1', 'synthetic-provider-a2', 'synthetic-model-a2',
    atMs, usage({ calls: 1 }), occurrenceProof, signer,
  );
  assert.throws(() => createUsageReceipt({
    receiptId: 'future-occurrence', caseId: 'case-budget-1', providerId: 'synthetic-provider-a2', modelId: 'synthetic-model-a2',
    policyRevision: 'budget-policy-v1', occurredAtMs: atMs + 1, recordedAtMs: atMs, usage: usage(), criticalityProof: occurrenceProof,
  }, occurrenceAdmission, signer), /occurrence cannot follow/u);
});

test('actual over-cap usage remains ledgered and changes diagnostics only', () => {
  let state = createBudgetState('budget-policy-v1');
  const full = receipt('receipt-full', caps.perCase, { critical: true });
  state = record(state, full).state;
  const blocked = record(state, receipt('receipt-blocked', usage({ calls: 1 })));
  assert.equal(blocked.status, 'BUDGET_EXHAUSTED');
  assert.equal(blocked.state.receipts.length, 2);
  assert.equal(blocked.state.receipts.at(-1).receiptId, 'receipt-blocked');
  const admission = evaluateUsageAdmission(blocked.state, caps, 'case-budget-1', 'synthetic-provider-a2', 'synthetic-model-a2', atMs, usage({ calls: 1 }), criticality(false), signer);
  assert.equal(admission.diagnosticState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.equal(admission.productReadinessChanged, false);
  assert.equal(admission.deterministicSafetyChanged, false);
  assert.equal(admission.executionChanged, false);
});

test('provider budgets are isolated and calendar-month windows reset at UTC month boundary', () => {
  const january = Date.UTC(2026, 0, 31, 23, 59, 0);
  const february = Date.UTC(2026, 1, 1, 0, 1, 0);
  let state = createBudgetState('budget-policy-v1');
  state = record(state, receipt('january-use', usage({ calls: 5 }), {
    caseId: 'case-january', providerId: 'provider-january', occurredAtMs: january, critical: true,
  })).state;
  const differentProvider = evaluateUsageAdmission(state, caps, 'case-new', 'provider-other', 'model-other', january, usage({ calls: 5 }), criticality(true, 'case-new', 'budget-policy-v1', january), signer);
  assert.equal(differentProvider.usage.hourly.calls, 0);
  const nextMonth = evaluateUsageAdmission(state, caps, 'case-february', 'provider-january', 'model-january', february, usage({ calls: 5 }), criticality(true, 'case-february', 'budget-policy-v1', february), signer);
  assert.equal(nextMonth.usage.monthly.calls, 0);
  assert.equal(nextMonth.admitted, true);
});

test('per-case caps aggregate across provider fallback changes', () => {
  let state = createBudgetState('budget-policy-v1');
  state = record(state, receipt('provider-a-case-cap', usage({ calls: 5 }), {
    caseId: 'case-provider-switch', providerId: 'provider-a', critical: true,
  })).state;
  const switched = evaluateUsageAdmission(
    state,
    caps,
    'case-provider-switch',
    'provider-b',
    'model-b',
    atMs,
    usage({ calls: 1 }),
    criticality(true, 'case-provider-switch'),
    signer,
  );
  assert.equal(switched.admitted, false);
  assert.ok(switched.reasonCodes.includes('PER_CASE_BUDGET_CALLS_EXHAUSTED'));
});

test('provider outage selects only a prequalified route and fences ambiguous global effects', () => {
  const primary = { providerId: 'primary-provider', modelId: 'primary-model', state: 'UNAVAILABLE', prequalified: true };
  const fallbacks = [
    { providerId: 'fallback-z', modelId: 'model-z', state: 'READY', prequalified: false },
    { providerId: 'fallback-a', modelId: 'model-a', state: 'READY', prequalified: true },
  ];
  const route = projectProviderRoute(
    primary,
    fallbacks,
    routeBudgetContext(),
    false,
    signer,
  );
  assert.equal(route.selectedProviderId, 'fallback-a');
  const unqualified = { providerId: 'primary-provider', modelId: 'primary-model', state: 'READY', prequalified: false };
  const unqualifiedPrimary = projectProviderRoute(
    unqualified, [], routeBudgetContext(), false, signer,
  );
  assert.equal(unqualifiedPrimary.diagnosticState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.equal(unqualifiedPrimary.selectedProviderId, null);
  const readyPrimary = { providerId: 'primary-provider', modelId: 'primary-model', state: 'READY', prequalified: true };
  const fenced = projectProviderRoute(
    readyPrimary, [], routeBudgetContext(), true, signer,
  );
  assert.deepEqual(fenced.reasonCodes, ['AMBIGUOUS_GLOBAL_EFFECT_FENCE']);
});

test('budget exhaustion cannot be bypassed by fallback selection and malformed route facts fail closed', () => {
  const primary = { providerId: 'primary-provider', modelId: 'primary-model', state: 'READY', prequalified: true };
  const fallback = { providerId: 'fallback-a', modelId: 'model-a', state: 'READY', prequalified: true };
  const blockedContext = routeBudgetContext({ requested: usage({ calls: 6 }) });
  const route = projectProviderRoute(
    primary,
    [fallback],
    blockedContext,
    false,
    signer,
  );
  assert.equal(route.diagnosticState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.equal(route.selectedProviderId, null);
  assert.deepEqual(route.reasonCodes, ['DIAGNOSTIC_BUDGET_EXHAUSTED']);
  assert.throws(() => projectProviderRoute(
    { ...primary, prequalified: 'yes' }, [], blockedContext, false, signer,
  ), /boolean/u);
});

test('fallback routing requires the selected provider-model to own a current budget admission', () => {
  let state = createBudgetState('budget-policy-v1');
  state = record(state, receipt('fallback-cap-a', usage({ calls: 5 }), {
    caseId: 'case-fallback-cap-a', providerId: 'fallback-capped', modelId: 'fallback-model', critical: true,
  })).state;
  state = record(state, receipt('fallback-cap-b', usage({ calls: 5 }), {
    caseId: 'case-fallback-cap-b', providerId: 'fallback-capped', modelId: 'fallback-model', critical: true,
  })).state;
  const routeCaps = {
    ...caps,
    globalHourly: usage({ calls: 100, toolCalls: 100, webQueries: 100, tokens: 20_000, costMicrounits: 200_000, latencyMs: 400_000, wallTimeMs: 600_000 }),
    globalDaily: usage({ calls: 100, toolCalls: 100, webQueries: 100, tokens: 20_000, costMicrounits: 200_000, latencyMs: 400_000, wallTimeMs: 600_000 }),
    globalMonthly: usage({ calls: 100, toolCalls: 100, webQueries: 100, tokens: 20_000, costMicrounits: 200_000, latencyMs: 400_000, wallTimeMs: 600_000 }),
  };
  const primary = { providerId: 'primary-open', modelId: 'primary-model', state: 'UNAVAILABLE', prequalified: true };
  const fallback = { providerId: 'fallback-capped', modelId: 'fallback-model', state: 'READY', prequalified: true };
  const context = routeBudgetContext({ state, budgetCaps: routeCaps, caseId: 'case-fallback-route' });
  const admissions = [primary, fallback].map((candidate) => evaluateUsageAdmission(
    context.state, context.caps, context.caseId, candidate.providerId, candidate.modelId,
    context.evaluatedAtMs, context.requested, context.criticality, signer,
  ));
  assert.equal(admissions[0].admitted, true);
  assert.equal(admissions[1].admitted, false);
  const route = projectProviderRoute(primary, [fallback], context, false, signer);
  assert.equal(route.selectedProviderId, null);
  assert.deepEqual(route.reasonCodes, ['DIAGNOSTIC_BUDGET_EXHAUSTED']);
});

test('synthetic provider is deterministic, network-denied, and has no operational authority', () => {
  const input = Object.freeze({ providerState: 'READY', classificationHint: 'SYNTHETIC_CLASS' });
  const first = runSyntheticProvider(input);
  assert.deepEqual(first, runSyntheticProvider(input));
  assert.equal(first.operationalAuthority, 'NONE');
  assert.equal(first.networkAccess, 'DENIED');
  assert.equal(first.output.confidence, null);
  const outage = runSyntheticProvider({ providerState: 'UNAVAILABLE' });
  assert.equal(outage.diagnosticState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.equal(outage.output, null);
});

test('route computes admissions from one inert budget snapshot and cannot consume caller-authored projections', () => {
  const primary = { providerId: 'primary-owner', modelId: 'model-owner', state: 'READY', prequalified: true };
  const mutableState = { ...createBudgetState('budget-policy-v1'), receipts: [] };
  const mutableCaps = JSON.parse(JSON.stringify(caps));
  const mutableRequested = usage({ calls: 1 });
  const mutableProof = JSON.parse(JSON.stringify(criticality(true, 'case-route-snapshot')));
  const context = {
    state: mutableState,
    caps: mutableCaps,
    caseId: 'case-route-snapshot',
    evaluatedAtMs: atMs,
    requested: mutableRequested,
    criticality: mutableProof,
  };
  const mutatingVerifier = {
    posture: 'SYNTHETIC_ONLY',
    signDigest: signer.signDigest,
    verifyDigest(digest, signature) {
      mutableCaps.perCase.calls = 0;
      mutableRequested.calls = 99;
      mutableState.receipts.push({ forged: true });
      mutableProof.critical = false;
      return signer.verifyDigest(digest, signature);
    },
  };
  const route = projectProviderRoute(primary, [], context, false, mutatingVerifier);
  assert.equal(route.selectedProviderId, primary.providerId);
  assert.throws(
    () => projectProviderRoute(primary, [], [evaluateUsageAdmission(
      createBudgetState('budget-policy-v1'), caps, 'case-route-snapshot', primary.providerId, primary.modelId,
      atMs, usage({ calls: 1 }), criticality(true, 'case-route-snapshot'), signer,
    )], false, signer),
    /provider budget context|unsupported field/u,
  );
});

test('budget admissions bind state, caps, and criticality while Promise-shaped verification fails closed', () => {
  const state = createBudgetState('budget-policy-v1');
  const proof = criticality(true, 'case-budget-binding');
  const admission = evaluateUsageAdmission(
    state, caps, 'case-budget-binding', 'provider-binding', 'model-binding', atMs, usage({ calls: 1 }), proof, signer,
  );
  assert.equal(admission.budgetStateDigest, sha256(canonicalJson(state)));
  assert.equal(admission.budgetCapsDigest, sha256(canonicalJson(caps)));
  assert.equal(admission.criticalityProofDigest, proof.proofDigest);
  const asyncVerifier = {
    posture: 'SYNTHETIC_ONLY',
    signDigest: signer.signDigest,
    verifyDigest() { return Promise.resolve(false); },
  };
  assert.throws(
    () => evaluateUsageAdmission(
      state, caps, 'case-budget-binding', 'provider-binding', 'model-binding', atMs,
      usage({ calls: 1 }), proof, asyncVerifier,
    ),
    /signature invalid/u,
  );
});

test('synthetic provider rejects accessors, mutation-shaped classifications, and acceptance vocabulary', () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'providerState', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'READY';
    },
  });
  assert.throws(() => runSyntheticProvider(accessor), /accessor/u);
  assert.equal(getterCalls, 0);
  assert.throws(() => runSyntheticProvider({ providerState: 'READY', classificationHint: { value: 'SYNTHETIC_CLASS' } }), /closed vocabulary/u);
  assert.throws(() => runSyntheticProvider({ providerState: 'READY', classificationHint: 'INTEGRATED_ACCEPTED' }), /closed vocabulary/u);
  assert.throws(() => runSyntheticProvider({ providerState: 'READY', classificationHint: 'X'.repeat(10_000) }), /closed vocabulary/u);
});

test('read-only budget admission is not an atomic reservation and remains an explicit owner insertion seam', () => {
  const state = createBudgetState('budget-policy-v1');
  const proof = criticality(true, 'case-concurrent-budget');
  const args = [state, caps, 'case-concurrent-budget', 'provider-concurrent', 'model-concurrent', atMs, caps.perCase, proof, signer];
  const first = evaluateUsageAdmission(...args);
  const second = evaluateUsageAdmission(...args);
  assert.equal(first.admitted, true);
  assert.deepEqual(second, first);
  assert.equal(state.receipts.length, 0);
});
