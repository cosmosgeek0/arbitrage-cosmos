import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  adaptProviderNeutralEvent,
  canonicalizeProviderUsage,
  consumeFreshSessionHandoff,
  createHandoffConsumptionState,
  generateFreshSessionHandoff,
  generateSignedContextManifest,
  projectProviderRateAvailability,
  resumeHandoffConsumptionState,
  serializeHandoffConsumptionState,
} from '../../../server/dist/aiOps/caseRuntime/index.js';
import { canonicalJson } from '../../../server/dist/foundation/contracts/identity.js';
import { createSyntheticSigner } from '../../../fixtures/aiOps/caseRuntime/synthetic-runtime.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fixturePath = new URL('../../../fixtures/aiOps/caseRuntime/a2x-replay-fixtures.v1.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

function withoutPayloadDigest(value) {
  const { payloadDigest: _payloadDigest, ...payload } = value;
  return payload;
}

const contextLimits = Object.freeze({
  maximumEntries: 8,
  maximumOmittedEntries: 8,
  maximumPriorReceipts: 16,
  maximumManifestBytes: 32_768,
  maximumTtlMs: 60_000,
});

function createSessionArtifacts() {
  const seed = fixture.session;
  const signer = createSyntheticSigner();
  const manifest = generateSignedContextManifest(Object.freeze({
    caseId: seed.caseId,
    caseRevision: seed.caseRevision,
    generation: seed.generation,
    audience: seed.audience,
    issuedAtMs: seed.manifestIssuedAtMs,
    expiresAtMs: seed.manifestExpiresAtMs,
    policyRevision: seed.policyRevision,
    acceptedAuthoritySha: seed.acceptedAuthoritySha,
    leaseId: seed.leaseId,
    fenceToken: seed.fenceToken,
    budgetStateDigest: sha256('synthetic-a2x-replay-budget'),
    deadlineAtMs: seed.deadlineAtMs,
    stopCondition: seed.stopCondition,
    nextOwner: seed.nextOwner,
    hardDenials: Object.freeze(['NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY', 'NO_UNREDACTED_EVIDENCE']),
    priorReceiptIds: Object.freeze(['synthetic-prior-receipt-a2x']),
    evidenceBundleDigest: sha256('synthetic-a2x-replay-evidence'),
    contextEntries: Object.freeze([Object.freeze({
      contextId: 'synthetic-context-a2x',
      ownerId: 'synthetic-context-owner-a2x',
      authority: 'SHADOW_PROJECTION',
      digest: sha256('synthetic-context-a2x'),
      status: 'RESOLVED',
    })]),
    omittedContextIds: Object.freeze([]),
  }), contextLimits, signer);
  const expectedAt = (nowMs) => Object.freeze({
    nowMs,
    expectedCaseId: manifest.caseId,
    expectedCaseRevision: manifest.caseRevision,
    expectedGeneration: manifest.generation,
    expectedAudience: manifest.audience,
    expectedPolicyRevision: manifest.policyRevision,
    expectedAcceptedAuthoritySha: manifest.acceptedAuthoritySha,
    expectedLeaseId: manifest.leaseId,
    expectedFenceToken: manifest.fenceToken,
    expectedBudgetStateDigest: manifest.budgetStateDigest,
    expectedEvidenceBundleDigest: manifest.evidenceBundleDigest,
    expectedDeadlineAtMs: manifest.deadlineAtMs,
    expectedStopCondition: 'SHADOW_ARTIFACT_READY',
    expectedNextOwner: manifest.nextOwner,
  });
  const handoff = generateFreshSessionHandoff(
    seed.sessionId,
    expectedAt(seed.issuedAtMs),
    seed.nextOwner,
    manifest,
    seed.issuedAtMs,
    seed.expiresAtMs,
    contextLimits,
    signer,
  );
  return Object.freeze({ seed, signer, manifest, handoff, expectedAt });
}

test('immutable replay fixture is exact, synthetic, bounded, and authority-free', () => {
  assert.deepEqual(Object.keys(fixture).sort(), [
    'intake',
    'operationalAuthority',
    'payloadDigest',
    'schema',
    'session',
    'shadowStatus',
    'syntheticOnly',
    'usage',
  ]);
  assert.equal(fixture.schema, 'AI_OPS_A2X_REPLAY_FIXTURES_V1');
  assert.equal(fixture.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(fixture.syntheticOnly, true);
  assert.equal(fixture.operationalAuthority, 'NONE');
  assert.equal(sha256(canonicalJson(withoutPayloadDigest(fixture))), fixture.payloadDigest);
  assert.ok(Buffer.byteLength(canonicalJson(fixture), 'utf8') < 64 * 1_024);
  assert.doesNotMatch(canonicalJson(fixture), /(?:PRESTAGE_READY|INTEGRATED_ACCEPTED|LIVE_EXECUTION_IMPLEMENTED)/u);
});

test('multi-provider event fixtures replay deterministically and missing sequence stays quarantined', () => {
  const { observedAtMs, primaryEvent, secondProviderEvent, missingSequenceEvent } = fixture.intake;
  const first = adaptProviderNeutralEvent(primaryEvent, observedAtMs);
  const exactReplay = adaptProviderNeutralEvent(primaryEvent, observedAtMs);
  assert.deepEqual(exactReplay, first);
  assert.equal(first.receipt.status, 'ADAPTED');
  assert.equal(first.receipt.operationalAuthority, 'NONE');

  const second = adaptProviderNeutralEvent(secondProviderEvent, observedAtMs);
  assert.equal(second.receipt.status, 'ADAPTED');
  assert.notEqual(second.receipt.sourceEventKey, first.receipt.sourceEventKey);
  assert.notEqual(second.observation.source, first.observation.source);

  const missingSequence = adaptProviderNeutralEvent(missingSequenceEvent, observedAtMs);
  assert.equal(missingSequence.receipt.status, 'QUARANTINED');
  assert.deepEqual(missingSequence.receipt.reasonCodes, ['SOURCE_SEQUENCE_UNAVAILABLE']);
  assert.equal(missingSequence.observation, null);
});

test('usage and rate fixtures preserve token/cost depth without fabricating cost or reservation', () => {
  const factSigner = createSyntheticSigner();
  const measured = canonicalizeProviderUsage(fixture.usage.measured, factSigner);
  assert.equal(measured.tokens.totalTokens, 140);
  assert.equal(measured.tokens.uncachedInputTokens, 70);
  assert.equal(measured.tokens.nonReasoningOutputTokens, 28);
  assert.equal(measured.cost.costMicrounits, 2500);
  assert.equal(measured.budgetUsage.tokens, 140);

  const unknownCost = canonicalizeProviderUsage(fixture.usage.unknownCost, factSigner);
  assert.equal(unknownCost.cost.costMicrounits, null);
  assert.equal(unknownCost.cost.unit, 'UNAVAILABLE');
  assert.equal(unknownCost.budgetUsage, null);

  const availability = projectProviderRateAvailability(
    fixture.usage.rateSnapshot,
    fixture.usage.rateRequest,
    fixture.usage.rateSnapshot.observedAtMs + 100,
    factSigner,
  );
  assert.equal(availability.available, true);
  assert.equal(availability.atomicReservation, false);
  assert.equal(availability.reservationCreated, false);
  assert.equal(availability.operationalAuthority, 'NONE');
});

test('fresh-session consumption survives canonical cold restart and exact replay stays idempotent', () => {
  const { seed, signer, manifest, handoff, expectedAt } = createSessionArtifacts();
  const initial = createHandoffConsumptionState(Object.freeze({
    maximumReceipts: 4,
    maximumStateBytes: 64 * 1_024,
  }));
  const consumed = consumeFreshSessionHandoff(
    initial,
    initial.revision,
    handoff,
    manifest,
    seed.sessionId,
    expectedAt(seed.consumedAtMs),
    seed.nextOwner,
    seed.consumerId,
    seed.consumedAtMs,
    contextLimits,
    signer,
  );
  assert.equal(consumed.disposition, 'CONSUMED');
  assert.equal(consumed.changed, true);
  assert.equal(consumed.state.revision, 1);
  assert.equal(consumed.receipt.operationalAuthority, 'NONE');

  const serialized = serializeHandoffConsumptionState(consumed.state);
  const resumed = resumeHandoffConsumptionState(serialized);
  assert.deepEqual(resumed, consumed.state);
  assert.equal(serializeHandoffConsumptionState(resumed), serialized);

  const retryAtMs = seed.consumedAtMs + 1;
  const retry = consumeFreshSessionHandoff(
    resumed,
    0,
    handoff,
    manifest,
    seed.sessionId,
    expectedAt(retryAtMs),
    seed.nextOwner,
    seed.consumerId,
    retryAtMs,
    contextLimits,
    signer,
  );
  assert.equal(retry.disposition, 'IDEMPOTENT');
  assert.equal(retry.changed, false);
  assert.deepEqual(retry.state, resumed);

  const conflict = consumeFreshSessionHandoff(
    resumed,
    resumed.revision,
    handoff,
    manifest,
    seed.sessionId,
    expectedAt(retryAtMs),
    seed.nextOwner,
    seed.conflictingConsumerId,
    retryAtMs,
    contextLimits,
    signer,
  );
  assert.equal(conflict.disposition, 'CONFLICT');
  assert.deepEqual(conflict.reasonCodes, ['HANDOFF_CONSUMPTION_IDENTITY_CONFLICT']);
  assert.deepEqual(conflict.state, resumed);
});

test('replay fixture restart rejects truncation, forged state, and non-canonical bytes', () => {
  const { seed, signer, manifest, handoff, expectedAt } = createSessionArtifacts();
  const initial = createHandoffConsumptionState(Object.freeze({
    maximumReceipts: 4,
    maximumStateBytes: 64 * 1_024,
  }));
  const consumed = consumeFreshSessionHandoff(
    initial,
    0,
    handoff,
    manifest,
    seed.sessionId,
    expectedAt(seed.consumedAtMs),
    seed.nextOwner,
    seed.consumerId,
    seed.consumedAtMs,
    contextLimits,
    signer,
  );
  const serialized = serializeHandoffConsumptionState(consumed.state);
  assert.throws(() => resumeHandoffConsumptionState(serialized.slice(0, -1)), /invalid JSON/u);

  const forged = JSON.parse(serialized);
  forged.receipts[0].consumerId = seed.conflictingConsumerId;
  assert.throws(() => resumeHandoffConsumptionState(canonicalJson(forged)), /identity mismatch|digest mismatch/u);
  assert.throws(() => resumeHandoffConsumptionState(` ${serialized}`), /canonical/u);
});
