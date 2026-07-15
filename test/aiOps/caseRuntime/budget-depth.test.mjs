import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  canonicalizeProviderUsage as canonicalizeProviderUsageWithVerifier,
  projectProviderRateAvailability as projectProviderRateAvailabilityWithVerifier,
} from '../../../server/dist/aiOps/caseRuntime/budget.js';
import { canonicalJson } from '../../../server/dist/foundation/contracts/identity.js';
import { createSyntheticSigner } from '../../../fixtures/aiOps/caseRuntime/synthetic-runtime.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const atMs = 1_700_002_000_000;
const signer = createSyntheticSigner();
const canonicalizeProviderUsage = (input) => canonicalizeProviderUsageWithVerifier(input, signer);
const projectProviderRateAvailability = (snapshot, request, evaluatedAtMs) => (
  projectProviderRateAvailabilityWithVerifier(snapshot, request, evaluatedAtMs, signer)
);

function usageMeasurement(overrides = {}) {
  const suppliedDigest = overrides.sourceDigest;
  const suppliedSignature = overrides.sourceSignature;
  const payload = {
    schema: 'AI_OPS_A2_PROVIDER_USAGE_MEASUREMENT_V1',
    usageId: 'usage-depth-1',
    caseId: 'case-budget-depth-1',
    providerId: 'provider-neutral-a',
    modelId: 'model-neutral-a',
    occurredAtMs: atMs,
    calls: 1,
    toolCalls: 2,
    webQueries: 1,
    inputTokens: 100,
    outputTokens: 30,
    cachedInputTokens: 25,
    cacheWriteInputTokens: 5,
    reasoningOutputTokens: 10,
    costMicrounits: 900,
    costAuthority: 'OWNER_PRICE_TABLE',
    pricingRevision: 'price-table-v7',
    latencyMs: 300,
    wallTimeMs: 350,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['sourceDigest', 'sourceSignature'].includes(key))),
  };
  const sourceDigest = suppliedDigest ?? sha256(canonicalJson(payload));
  return {
    ...payload,
    sourceDigest,
    sourceSignature: suppliedSignature ?? signer.signDigest(sourceDigest),
  };
}

const knownDimension = (overrides = {}) => ({
  limit: 100,
  remaining: 20,
  resetAtMs: atMs + 60_000,
  ...overrides,
});

function rateSnapshot(overrides = {}) {
  const suppliedDigest = overrides.ownerFactDigest;
  const suppliedSignature = overrides.ownerFactSignature;
  const snapshot = {
    schema: 'AI_OPS_A2_PROVIDER_RATE_SNAPSHOT_V1',
    providerId: 'provider-neutral-a',
    modelId: 'model-neutral-a',
    policyRevision: 'rate-policy-v3',
    observedAtMs: atMs - 100,
    expiresAtMs: atMs + 1_000,
    cooldownUntilMs: null,
    concurrency: { active: 4, maximum: 5 },
    dimensions: {
      requests: knownDimension({ limit: 10, remaining: 1 }),
      inputTokens: knownDimension({ limit: 1_000, remaining: 10 }),
      outputTokens: knownDimension({ limit: 1_000, remaining: 5 }),
      totalTokens: knownDimension({ limit: 2_000, remaining: 15 }),
    },
    authority: 'OWNER_PROJECTION',
    atomicReservation: false,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['ownerFactDigest', 'ownerFactSignature'].includes(key))),
  };
  const ownerFactDigest = suppliedDigest ?? sha256(canonicalJson(snapshot));
  return {
    ...snapshot,
    ownerFactDigest,
    ownerFactSignature: suppliedSignature ?? signer.signDigest(ownerFactDigest),
  };
}

const rateRequest = (overrides = {}) => ({
  requests: 1,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  concurrencySlots: 1,
  ...overrides,
});

test('provider-neutral usage preserves cache and reasoning subsets and projects known cost', () => {
  const detail = canonicalizeProviderUsage(usageMeasurement());
  assert.deepEqual(detail.tokens, {
    inputTokens: 100,
    outputTokens: 30,
    totalTokens: 130,
    cachedInputTokens: 25,
    cacheWriteInputTokens: 5,
    uncachedInputTokens: 70,
    reasoningOutputTokens: 10,
    nonReasoningOutputTokens: 20,
  });
  assert.deepEqual(detail.cost, {
    costMicrounits: 900,
    unit: 'USD_MICRO',
    authority: 'OWNER_PRICE_TABLE',
    pricingRevision: 'price-table-v7',
  });
  assert.deepEqual(detail.budgetUsage, {
    calls: 1,
    toolCalls: 2,
    webQueries: 1,
    tokens: 130,
    costMicrounits: 900,
    latencyMs: 300,
    wallTimeMs: 350,
  });
  assert.equal(detail.operationalAuthority, 'NONE');
  assert.equal(detail.factVerification, 'SYNTHETIC_ONLY');
  assert.equal(detail.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.match(detail.detailDigest, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(detail), true);
  assert.equal(Object.isFrozen(detail.tokens), true);
  assert.equal(Object.isFrozen(detail.budgetUsage), true);
});

test('unknown cost remains null and cannot become an aggregate budget usage zero', () => {
  const detail = canonicalizeProviderUsage(usageMeasurement({
    costMicrounits: null,
    costAuthority: 'UNAVAILABLE',
    pricingRevision: null,
  }));
  assert.deepEqual(detail.cost, {
    costMicrounits: null,
    unit: 'UNAVAILABLE',
    authority: 'UNAVAILABLE',
    pricingRevision: null,
  });
  assert.equal(detail.budgetUsage, null);
  assert.equal(detail.tokens.totalTokens, 130);
});

test('usage subset arithmetic and safe-integer overflow fail closed', () => {
  assert.throws(
    () => canonicalizeProviderUsage(usageMeasurement({ inputTokens: 29, cachedInputTokens: 25, cacheWriteInputTokens: 5 })),
    /subsets of input/u,
  );
  assert.throws(
    () => canonicalizeProviderUsage(usageMeasurement({ outputTokens: 9, reasoningOutputTokens: 10 })),
    /subset of output/u,
  );
  assert.throws(
    () => canonicalizeProviderUsage(usageMeasurement({
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 1,
      reasoningOutputTokens: 0,
    })),
    /safe integer range/u,
  );
  assert.throws(
    () => canonicalizeProviderUsage(usageMeasurement({
      inputTokens: Number.MAX_SAFE_INTEGER,
      cachedInputTokens: Number.MAX_SAFE_INTEGER,
      cacheWriteInputTokens: 1,
    })),
    /safe integer range/u,
  );
});

test('cost lineage rejects fabricated zero authority and missing price revisions', () => {
  assert.throws(
    () => canonicalizeProviderUsage(usageMeasurement({
      costMicrounits: null,
      costAuthority: 'OWNER_PRICE_TABLE',
      pricingRevision: 'price-table-v7',
    })),
    /unknown provider usage cost/u,
  );
  assert.throws(
    () => canonicalizeProviderUsage(usageMeasurement({
      costMicrounits: 0,
      costAuthority: 'UNAVAILABLE',
      pricingRevision: null,
    })),
    /known provider usage cost/u,
  );
  assert.throws(
    () => canonicalizeProviderUsage(usageMeasurement({ pricingRevision: null })),
    /known provider usage cost/u,
  );
});

test('usage canonicalization snapshots inert data and rejects extra fields and accessors', () => {
  const mutable = usageMeasurement();
  const detail = canonicalizeProviderUsage(mutable);
  mutable.inputTokens = 999;
  assert.equal(detail.tokens.inputTokens, 100);
  assert.throws(
    () => canonicalizeProviderUsage({ ...usageMeasurement(), providerRequestId: 'provider-secret-shaped-id' }),
    /unsupported field/u,
  );
  const withAccessor = usageMeasurement();
  Object.defineProperty(withAccessor, 'inputTokens', { enumerable: true, get() { return 100; } });
  assert.throws(() => canonicalizeProviderUsage(withAccessor), /accessor/u);
});

test('rate projection admits the exact boundary without reserving or mutating capacity', () => {
  const snapshot = rateSnapshot();
  const request = rateRequest();
  const projection = projectProviderRateAvailability(snapshot, request, atMs);
  assert.equal(projection.available, true);
  assert.equal(projection.diagnosticState, 'READY');
  assert.deepEqual(projection.reasonCodes, []);
  assert.equal(projection.atomicReservation, false);
  assert.equal(projection.reservationCreated, false);
  assert.equal(projection.operationalAuthority, 'NONE');
  assert.equal(projection.factVerification, 'SYNTHETIC_ONLY');
  assert.equal(projection.ownerFactDigest, snapshot.ownerFactDigest);
  assert.deepEqual(projectProviderRateAvailability(snapshot, request, atMs), projection);
  assert.equal(snapshot.dimensions.requests.remaining, 1);
  assert.equal(snapshot.concurrency.active, 4);
  assert.equal(Object.isFrozen(projection), true);
});

test('rate and concurrency plus-one requests fail closed while exact independent dimensions remain explicit', () => {
  const tokenOver = projectProviderRateAvailability(rateSnapshot(), rateRequest({
    inputTokens: 11,
    outputTokens: 5,
    totalTokens: 16,
  }), atMs);
  assert.equal(tokenOver.available, false);
  assert.ok(tokenOver.reasonCodes.includes('RATE_INPUT_TOKENS_EXHAUSTED'));
  assert.ok(tokenOver.reasonCodes.includes('RATE_TOTAL_TOKENS_EXHAUSTED'));

  const concurrencyOver = projectProviderRateAvailability(rateSnapshot(), rateRequest({ concurrencySlots: 2 }), atMs);
  assert.deepEqual(concurrencyOver.reasonCodes, ['RATE_CONCURRENCY_EXHAUSTED']);
});

test('stale, future, cooldown, unknown, and elapsed-window owner facts are unavailable', () => {
  const stale = projectProviderRateAvailability(rateSnapshot(), rateRequest(), atMs + 1_000);
  assert.ok(stale.reasonCodes.includes('RATE_SNAPSHOT_STALE'));

  const future = projectProviderRateAvailability(rateSnapshot(), rateRequest(), atMs - 101);
  assert.ok(future.reasonCodes.includes('RATE_SNAPSHOT_NOT_YET_OBSERVED'));

  const cooldown = projectProviderRateAvailability(rateSnapshot({ cooldownUntilMs: atMs + 1 }), rateRequest(), atMs);
  assert.ok(cooldown.reasonCodes.includes('RATE_COOLDOWN_ACTIVE'));

  const unknown = projectProviderRateAvailability(rateSnapshot({
    concurrency: { active: null, maximum: null },
    dimensions: {
      ...rateSnapshot().dimensions,
      inputTokens: { limit: null, remaining: null, resetAtMs: null },
    },
  }), rateRequest(), atMs);
  assert.ok(unknown.reasonCodes.includes('RATE_CONCURRENCY_UNKNOWN'));
  assert.ok(unknown.reasonCodes.includes('RATE_INPUT_TOKENS_UNKNOWN'));

  const elapsed = projectProviderRateAvailability(rateSnapshot({
    dimensions: {
      ...rateSnapshot().dimensions,
      requests: knownDimension({ resetAtMs: atMs }),
    },
  }), rateRequest(), atMs);
  assert.ok(elapsed.reasonCodes.includes('RATE_REQUESTS_WINDOW_ELAPSED'));
});

test('malformed owner projections cannot claim reservation or partial rate facts', () => {
  assert.throws(
    () => projectProviderRateAvailability(rateSnapshot({ atomicReservation: true }), rateRequest(), atMs),
    /atomic reservation/u,
  );
  assert.throws(
    () => projectProviderRateAvailability(rateSnapshot({ concurrency: { active: 1, maximum: null } }), rateRequest(), atMs),
    /wholly known/u,
  );
  assert.throws(
    () => projectProviderRateAvailability(rateSnapshot({
      dimensions: {
        ...rateSnapshot().dimensions,
        requests: { limit: 10, remaining: null, resetAtMs: atMs + 60_000 },
      },
    }), rateRequest(), atMs),
    /wholly known/u,
  );
  assert.throws(
    () => projectProviderRateAvailability(rateSnapshot(), rateRequest({ totalTokens: 14 }), atMs),
    /total tokens must equal/u,
  );
  assert.throws(
    () => projectProviderRateAvailability(rateSnapshot({ expiresAtMs: atMs + 86_400_001 }), rateRequest(), atMs),
    /expiry invalid/u,
  );
});

test('usage and rate owner facts require exact signed content rather than caller-authored authority labels', () => {
  assert.throws(
    () => canonicalizeProviderUsage(usageMeasurement({ sourceDigest: sha256('forged-usage-fact') })),
    /does not bind/u,
  );
  assert.throws(
    () => canonicalizeProviderUsage(usageMeasurement({
      sourceSignature: { ...signer.signDigest(sha256('different-usage-fact')), signature: 'a'.repeat(64) },
    })),
    /signature invalid/u,
  );
  assert.throws(
    () => projectProviderRateAvailability(rateSnapshot({ ownerFactDigest: sha256('forged-rate-fact') }), rateRequest(), atMs),
    /does not bind/u,
  );
  const valid = rateSnapshot();
  assert.throws(
    () => projectProviderRateAvailability({
      ...valid,
      ownerFactSignature: { ...valid.ownerFactSignature, signature: 'a'.repeat(64) },
    }, rateRequest(), atMs),
    /signature invalid/u,
  );
});
