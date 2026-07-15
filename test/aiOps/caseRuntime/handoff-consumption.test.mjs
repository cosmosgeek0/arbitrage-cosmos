import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  consumeFreshSessionHandoff,
  createHandoffConsumptionState,
  generateFreshSessionHandoff,
  generateSignedContextManifest,
  resumeHandoffConsumptionState,
  serializeHandoffConsumptionState,
} from '../../../server/dist/aiOps/caseRuntime/index.js';
import { createSyntheticSigner } from '../../../fixtures/aiOps/caseRuntime/synthetic-runtime.mjs';
import { canonicalJson } from '../../../server/dist/foundation/contracts/identity.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const signer = createSyntheticSigner();
const issuedAtMs = 1_700_000_500_000;
const audience = 'synthetic-consumption-session';
const nextOwner = 'synthetic-consumption-owner';
const consumerId = 'synthetic-consumer-a';
const limits = Object.freeze({
  maximumEntries: 8,
  maximumOmittedEntries: 8,
  maximumPriorReceipts: 16,
  maximumManifestBytes: 16_384,
  maximumTtlMs: 60_000,
});

function manifestInput(overrides = {}) {
  return {
    caseId: 'case-consumption-1',
    caseRevision: 7,
    generation: 2,
    audience,
    issuedAtMs,
    expiresAtMs: issuedAtMs + 30_000,
    policyRevision: 'context-consumption-policy-v1',
    acceptedAuthoritySha: '03857dcdaff8d8b12627d27ddcc97505da1f2f86',
    leaseId: 'synthetic-consumption-lease-1',
    fenceToken: 9,
    budgetStateDigest: sha256('consumption-budget-state'),
    deadlineAtMs: issuedAtMs + 20_000,
    stopCondition: 'SHADOW_ARTIFACT_READY',
    nextOwner,
    hardDenials: ['NO_UNREDACTED_EVIDENCE', 'NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY'],
    priorReceiptIds: ['prior-consumption-receipt-1'],
    evidenceBundleDigest: sha256('consumption-evidence-bundle'),
    contextEntries: [
      {
        contextId: 'consumption-context-a',
        ownerId: 'consumption-owner-a',
        authority: 'CANONICAL_OWNER',
        digest: sha256('consumption-context-a'),
        status: 'RESOLVED',
      },
    ],
    omittedContextIds: [],
    ...overrides,
  };
}

function expected(manifest, nowMs) {
  return {
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
  };
}

function fixture(sessionId = 'session-consumption-1', handoffIssuedAtMs = issuedAtMs + 10) {
  const manifest = generateSignedContextManifest(manifestInput(), limits, signer);
  const handoff = generateFreshSessionHandoff(
    sessionId,
    expected(manifest, handoffIssuedAtMs),
    nextOwner,
    manifest,
    handoffIssuedAtMs,
    issuedAtMs + 10_000,
    limits,
    signer,
  );
  return { manifest, handoff, sessionId };
}

function consume(current, currentExpectedRevision, source, atMs, overrides = {}) {
  return consumeFreshSessionHandoff(
    current,
    currentExpectedRevision,
    source.handoff,
    source.manifest,
    overrides.sessionId ?? source.sessionId,
    overrides.expectedManifest ?? expected(source.manifest, atMs),
    overrides.expectedNextOwner ?? nextOwner,
    overrides.consumerId ?? consumerId,
    atMs,
    limits,
    overrides.signer ?? signer,
  );
}

test('empty consumption state is deterministic, bounded, immutable, and grants no operational authority', () => {
  const first = createHandoffConsumptionState();
  const second = createHandoffConsumptionState();
  assert.deepEqual(first, second);
  assert.equal(first.revision, 0);
  assert.equal(first.receipts.length, 0);
  assert.equal(first.operationalAuthority, 'NONE');
  assert.equal(first.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.capacity), true);
  assert.equal(Object.isFrozen(first.receipts), true);
  assert.throws(() => createHandoffConsumptionState({ maximumReceipts: 4_097, maximumStateBytes: 8_192 }), /absolute shadow bounds/u);
  assert.throws(() => createHandoffConsumptionState({ maximumReceipts: 1, maximumStateBytes: 1 }), /byte capacity/u);
});

test('valid fresh-session handoff produces one immutable, hash-chained, authority-free receipt', () => {
  const source = fixture();
  const initial = createHandoffConsumptionState();
  const result = consume(initial, 0, source, issuedAtMs + 20);
  assert.equal(result.disposition, 'CONSUMED');
  assert.equal(result.changed, true);
  assert.deepEqual(result.reasonCodes, ['HANDOFF_CONSUMED']);
  assert.equal(result.operationalAuthority, 'NONE');
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.receipts.length, 1);
  assert.equal(result.receipt, result.state.receipts[0]);
  assert.equal(result.receipt.operationalAuthority, 'NONE');
  assert.equal(result.receipt.handoffId, source.handoff.handoffId);
  assert.equal(result.receipt.manifestPayloadDigest, source.manifest.payloadDigest);
  assert.equal(result.receipt.handoffPayloadDigest, source.handoff.payloadDigest);
  assert.equal(result.receipt.priorChainDigest, initial.chainDigest);
  assert.equal(result.receipt.chainDigest, result.state.chainDigest);
  assert.equal(initial.revision, 0);
  assert.equal(initial.receipts.length, 0);
  assert.equal(Object.isFrozen(result.state), true);
  assert.equal(Object.isFrozen(result.receipt), true);
});

test('an exact retry is idempotent despite a stale expected revision and later caller time', () => {
  const source = fixture();
  const consumed = consume(createHandoffConsumptionState(), 0, source, issuedAtMs + 20);
  const retry = consume(consumed.state, 0, source, issuedAtMs + 100);
  assert.equal(retry.disposition, 'IDEMPOTENT');
  assert.equal(retry.changed, false);
  assert.deepEqual(retry.reasonCodes, ['HANDOFF_ALREADY_CONSUMED']);
  assert.deepEqual(retry.state, consumed.state);
  assert.deepEqual(retry.receipt, consumed.receipt);
});

test('same handoff identity cannot be rebound while a new handoff obeys CAS revision checks', () => {
  const source = fixture();
  const consumed = consume(createHandoffConsumptionState(), 0, source, issuedAtMs + 20);
  const wrongConsumer = consume(consumed.state, 1, source, issuedAtMs + 30, { consumerId: 'synthetic-consumer-b' });
  assert.equal(wrongConsumer.disposition, 'CONFLICT');
  assert.deepEqual(wrongConsumer.reasonCodes, ['HANDOFF_CONSUMPTION_IDENTITY_CONFLICT']);
  assert.equal(wrongConsumer.changed, false);
  assert.deepEqual(wrongConsumer.state, consumed.state);

  const changedSignature = {
    ...source,
    handoff: {
      ...source.handoff,
      signature: { ...source.handoff.signature, signature: 'a'.repeat(64) },
    },
  };
  assert.throws(
    () => consume(consumed.state, 1, changedSignature, issuedAtMs + 30),
    /cannot be consumed/u,
  );

  const second = fixture('session-consumption-2', issuedAtMs + 11);
  const staleCas = consume(consumed.state, 0, second, issuedAtMs + 30);
  assert.equal(staleCas.disposition, 'CONFLICT');
  assert.deepEqual(staleCas.reasonCodes, ['STATE_REVISION_CONFLICT']);
  assert.equal(staleCas.receipt, null);
  assert.deepEqual(staleCas.state, consumed.state);
});

test('successive consumptions advance a contiguous chain and survive canonical replay', () => {
  const first = fixture('session-consumption-chain-1', issuedAtMs + 10);
  const second = fixture('session-consumption-chain-2', issuedAtMs + 11);
  let result = consume(createHandoffConsumptionState(), 0, first, issuedAtMs + 20);
  const firstChainDigest = result.state.chainDigest;
  result = consume(result.state, 1, second, issuedAtMs + 30);
  assert.equal(result.disposition, 'CONSUMED');
  assert.equal(result.state.revision, 2);
  assert.equal(result.state.receipts[1].stateRevision, 2);
  assert.equal(result.state.receipts[1].priorChainDigest, firstChainDigest);
  assert.equal(result.state.chainDigest, result.state.receipts[1].chainDigest);
  const serialized = serializeHandoffConsumptionState(result.state);
  assert.equal(serialized, canonicalJson(JSON.parse(serialized)));
  assert.deepEqual(resumeHandoffConsumptionState(serialized), result.state);
});

test('receipt-count and canonical-byte capacities fail closed without changing prior state', () => {
  const first = fixture('session-consumption-capacity-1', issuedAtMs + 10);
  const second = fixture('session-consumption-capacity-2', issuedAtMs + 11);
  const bounded = createHandoffConsumptionState({ maximumReceipts: 1, maximumStateBytes: 16_384 });
  const consumed = consume(bounded, 0, first, issuedAtMs + 20);
  assert.throws(() => consume(consumed.state, 1, second, issuedAtMs + 30), /capacity exhausted/u);
  assert.equal(consumed.state.revision, 1);

  const byteBounded = createHandoffConsumptionState({ maximumReceipts: 2, maximumStateBytes: 1_024 });
  assert.throws(() => consume(byteBounded, 0, first, issuedAtMs + 20), /byte capacity/u);
  assert.equal(byteBounded.revision, 0);
});

test('resume rejects receipt, chain, state, capacity, and noncanonical serialization tamper', () => {
  const source = fixture();
  const consumed = consume(createHandoffConsumptionState(), 0, source, issuedAtMs + 20);
  const serialized = serializeHandoffConsumptionState(consumed.state);
  const parsed = JSON.parse(serialized);
  const variants = [
    { ...parsed, stateDigest: sha256('forged-state') },
    { ...parsed, chainDigest: sha256('forged-chain') },
    { ...parsed, capacity: { ...parsed.capacity, maximumReceipts: parsed.capacity.maximumReceipts - 1 } },
    { ...parsed, receipts: [{ ...parsed.receipts[0], consumerId: 'synthetic-consumer-forged' }] },
    { ...parsed, receipts: [] },
  ];
  for (const variant of variants) {
    assert.throws(() => resumeHandoffConsumptionState(canonicalJson(variant)), /mismatch|revision|capacity|identity/u);
  }
  assert.throws(() => resumeHandoffConsumptionState(`${serialized}\n`), /must be canonical/u);
  assert.throws(() => resumeHandoffConsumptionState('{'), /invalid JSON/u);
});

test('invalid timing, regressing clocks, forged handoffs, and mutable state tamper are rejected', () => {
  const first = fixture('session-consumption-hostile-1', issuedAtMs + 10);
  const second = fixture('session-consumption-hostile-2', issuedAtMs + 11);
  const initial = createHandoffConsumptionState();
  assert.throws(() => consumeFreshSessionHandoff(
    initial, 0, first.handoff, first.manifest, first.sessionId,
    expected(first.manifest, issuedAtMs + 21), nextOwner, consumerId, issuedAtMs + 20, limits, signer,
  ), /time must match/u);
  assert.throws(() => consumeFreshSessionHandoff(
    initial, Number.MAX_SAFE_INTEGER + 1, first.handoff, first.manifest, first.sessionId,
    expected(first.manifest, issuedAtMs + 20), nextOwner, consumerId, issuedAtMs + 20, limits, signer,
  ), /safe integer/u);
  const forged = { ...first, handoff: { ...first.handoff, payloadDigest: sha256('forged-handoff') } };
  assert.throws(() => consume(initial, 0, forged, issuedAtMs + 20), /cannot be consumed/u);

  const consumed = consume(initial, 0, first, issuedAtMs + 30);
  assert.throws(() => consume(consumed.state, 1, second, issuedAtMs + 20), /cannot regress/u);
  assert.throws(() => serializeHandoffConsumptionState({ ...consumed.state, operationalAuthority: 'ALL' }), /authority invalid/u);
  assert.throws(() => serializeHandoffConsumptionState({ ...consumed.state, receipts: [...consumed.state.receipts, consumed.receipt] }), /capacity|revision|duplicate/u);
});
