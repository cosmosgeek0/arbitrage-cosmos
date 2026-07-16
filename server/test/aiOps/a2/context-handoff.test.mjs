import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  generateFreshSessionHandoff,
  generateSignedContextManifest,
  verifyFreshSessionHandoff,
  verifySignedContextManifest,
} from '../../../dist/aiOps/runtime/index.js';
import { createSyntheticSigner } from '../../../../fixtures/aiOps/a2/synthetic-runtime.mjs';
import { canonicalJson } from '../../../dist/foundation/contracts/identity.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const signer = createSyntheticSigner();
const issuedAtMs = 1_700_000_400_000;
const audience = 'synthetic-fresh-session';
const nextOwner = 'synthetic-next-owner';
const limits = Object.freeze({
  maximumEntries: 8,
  maximumOmittedEntries: 8,
  maximumPriorReceipts: 16,
  maximumManifestBytes: 16_384,
  maximumTtlMs: 60_000,
});

function input(overrides = {}) {
  return {
    caseId: 'case-context-1',
    caseRevision: 7,
    generation: 2,
    audience,
    issuedAtMs,
    expiresAtMs: issuedAtMs + 30_000,
    policyRevision: 'context-policy-v1',
    acceptedAuthoritySha: '03857dcdaff8d8b12627d27ddcc97505da1f2f86',
    leaseId: 'synthetic-lease-1',
    fenceToken: 9,
    budgetStateDigest: sha256('budget-state'),
    deadlineAtMs: issuedAtMs + 20_000,
    stopCondition: 'SHADOW_ARTIFACT_READY',
    nextOwner,
    hardDenials: ['NO_UNREDACTED_EVIDENCE', 'NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY'],
    priorReceiptIds: ['prior-receipt-1'],
    evidenceBundleDigest: sha256('bundle'),
    contextEntries: [
      { contextId: 'context-b', ownerId: 'owner-b', authority: 'SHADOW_PROJECTION', digest: sha256('b'), status: 'RESOLVED' },
      { contextId: 'context-a', ownerId: 'owner-a', authority: 'CANONICAL_OWNER', digest: sha256('a'), status: 'RESOLVED' },
    ],
    omittedContextIds: ['omitted-z'],
    ...overrides,
  };
}

function expected(manifest, nowMs = issuedAtMs + 1) {
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

test('bounded manifest is deterministic, authority-bound, explicit about omissions, and synthetic-signed', () => {
  const first = generateSignedContextManifest(input(), limits, signer);
  const second = generateSignedContextManifest(input({ contextEntries: [...input().contextEntries].reverse() }), limits, signer);
  assert.deepEqual(first, second);
  assert.deepEqual(first.contextEntries.map((entry) => entry.contextId), ['context-a', 'context-b']);
  assert.deepEqual(first.omittedContextIds, ['omitted-z']);
  assert.equal(first.acceptedAuthoritySha, '03857dcdaff8d8b12627d27ddcc97505da1f2f86');
  assert.equal(first.signature.posture, 'SYNTHETIC_ONLY');
  assert.equal(verifySignedContextManifest(first, expected(first), limits, signer).valid, true);
});

test('unresolved context, missing hard denials, item overflow, omission overflow, and byte overflow fail closed', () => {
  assert.throws(() => generateSignedContextManifest(input({
    contextEntries: [{ contextId: 'context-a', ownerId: 'owner-a', authority: 'CANONICAL_OWNER', digest: sha256('a'), status: 'UNAVAILABLE' }],
  }), limits, signer), /unresolved or unavailable/u);
  assert.throws(() => generateSignedContextManifest(input({ hardDenials: ['NO_MONEY_PATHS'] }), limits, signer), /required hard denial/u);
  assert.throws(() => generateSignedContextManifest(input(), { ...limits, maximumEntries: 1 }, signer), /entry bound/u);
  assert.throws(() => generateSignedContextManifest(input({ omittedContextIds: ['a', 'b'] }), { ...limits, maximumOmittedEntries: 1 }, signer), /omission set/u);
  assert.throws(() => generateSignedContextManifest(input({ omittedContextIds: ['context-a'] }), limits, signer), /both present and omitted/u);
  assert.throws(() => generateSignedContextManifest(input(), { ...limits, maximumManifestBytes: 100 }, signer), /byte bound/u);
});

test('manifest tamper, stale revision, wrong audience, exact expiry, and stricter consumer limits are invalid', () => {
  const manifest = generateSignedContextManifest(input(), limits, signer);
  const tampered = { ...manifest, evidenceBundleDigest: sha256('tampered') };
  const tamperResult = verifySignedContextManifest(tampered, expected(manifest), limits, signer);
  assert.equal(tamperResult.valid, false);
  assert.ok(tamperResult.reasonCodes.includes('MANIFEST_PAYLOAD_DIGEST_MISMATCH'));
  const mismatched = verifySignedContextManifest(manifest, {
    ...expected(manifest, manifest.expiresAtMs),
    expectedCaseRevision: manifest.caseRevision + 1,
    expectedAudience: 'wrong-audience',
    expectedNextOwner: 'wrong-next-owner',
  }, limits, signer);
  assert.equal(mismatched.valid, false);
  assert.ok(mismatched.reasonCodes.includes('MANIFEST_EXPIRED'));
  assert.ok(mismatched.reasonCodes.includes('CASE_REVISION_MISMATCH'));
  assert.ok(mismatched.reasonCodes.includes('AUDIENCE_MISMATCH'));
  assert.ok(mismatched.reasonCodes.includes('NEXT_OWNER_MISMATCH'));
  assert.equal(verifySignedContextManifest(manifest, expected(manifest), { ...limits, maximumEntries: 1 }, signer).valid, false);
});

test('fresh-session handoff binds a currently valid manifest and rejects replay', () => {
  const manifest = generateSignedContextManifest(input(), limits, signer);
  const handoff = generateFreshSessionHandoff('session-fresh-1', expected(manifest, issuedAtMs + 10), nextOwner, manifest, issuedAtMs + 10, issuedAtMs + 20_000, limits, signer);
  const valid = verifyFreshSessionHandoff(handoff, manifest, 'session-fresh-1', expected(manifest, issuedAtMs + 20), nextOwner, [], limits, signer);
  assert.equal(valid.valid, true);
  const replay = verifyFreshSessionHandoff(handoff, manifest, 'session-fresh-1', expected(manifest, issuedAtMs + 20), nextOwner, [handoff.handoffId], limits, signer);
  assert.equal(replay.valid, false);
  assert.ok(replay.reasonCodes.includes('HANDOFF_REPLAYED'));
});

test('handoff generation rejects tampered, expired, or pre-manifest trust roots', () => {
  const manifest = generateSignedContextManifest(input(), limits, signer);
  assert.throws(() => generateFreshSessionHandoff('session-tampered', expected(manifest, issuedAtMs + 10), nextOwner, { ...manifest, contextEntries: [] }, issuedAtMs + 10, issuedAtMs + 100, limits, signer), /valid context manifest/u);
  assert.throws(() => generateFreshSessionHandoff('session-early', expected(manifest, issuedAtMs - 1), nextOwner, manifest, issuedAtMs - 1, issuedAtMs + 100, limits, signer), /valid context manifest|lifetime/u);
  assert.throws(() => generateFreshSessionHandoff('session-expired', expected(manifest, manifest.expiresAtMs), nextOwner, manifest, manifest.expiresAtMs, manifest.expiresAtMs + 1, limits, signer), /valid context manifest|lifetime/u);
  assert.throws(() => generateFreshSessionHandoff('session-wrong-owner', expected(manifest, issuedAtMs + 10), 'other-owner', manifest, issuedAtMs + 10, issuedAtMs + 100, limits, signer), /next-owner/u);
});

test('handoff verification rejects tampered manifest, wrong session, stale lineage, and expiry', () => {
  const manifest = generateSignedContextManifest(input(), limits, signer);
  const handoff = generateFreshSessionHandoff('session-fresh-2', expected(manifest, issuedAtMs + 10), nextOwner, manifest, issuedAtMs + 10, issuedAtMs + 100, limits, signer);
  const tamperedHandoff = { ...handoff, manifestDigest: sha256('other') };
  const tamperedManifest = { ...manifest, contextEntries: [{ ...manifest.contextEntries[0], digest: sha256('forged') }] };
  const result = verifyFreshSessionHandoff(tamperedHandoff, tamperedManifest, 'wrong-session', {
    ...expected(manifest, issuedAtMs + 100),
    expectedAudience: 'wrong-audience',
    expectedCaseRevision: manifest.caseRevision + 1,
  }, 'wrong-owner', [], limits, signer);
  assert.equal(result.valid, false);
  assert.ok(result.reasonCodes.includes('REFERENCED_MANIFEST_INVALID'));
  assert.ok(result.reasonCodes.includes('HANDOFF_SESSION_MISMATCH'));
  assert.ok(result.reasonCodes.includes('HANDOFF_CASE_LINEAGE_MISMATCH') || result.reasonCodes.includes('HANDOFF_MANIFEST_MISMATCH'));
  assert.ok(result.reasonCodes.includes('HANDOFF_EXPIRED'));
  assert.ok(result.reasonCodes.includes('HANDOFF_PAYLOAD_DIGEST_MISMATCH'));
});

test('verification enforces synthetic signer posture and manifest-bounded handoff lifetime', () => {
  const manifest = generateSignedContextManifest(input(), limits, signer);
  const nonShadowSigner = {
    posture: 'PRODUCTION',
    signDigest: signer.signDigest,
    verifyDigest: signer.verifyDigest,
  };
  assert.throws(() => generateSignedContextManifest(input(), limits, nonShadowSigner), /synthetic-only/u);
  assert.equal(verifySignedContextManifest(manifest, expected(manifest), limits, nonShadowSigner).valid, false);
  assert.throws(() => generateFreshSessionHandoff(
    'session-non-shadow-signer', expected(manifest, issuedAtMs + 10), nextOwner, manifest,
    issuedAtMs + 10, issuedAtMs + 100, limits, nonShadowSigner,
  ), /synthetic-only/u);

  const valid = generateFreshSessionHandoff(
    'session-forged-lifetime', expected(manifest, issuedAtMs + 10), nextOwner, manifest,
    issuedAtMs + 10, issuedAtMs + 100, limits, signer,
  );
  const { payloadDigest: _oldDigest, signature: _oldSignature, ...payload } = {
    ...valid,
    expiresAtMs: manifest.expiresAtMs + 1,
  };
  const forgedDigest = sha256(canonicalJson(payload));
  const forged = { ...payload, payloadDigest: forgedDigest, signature: signer.signDigest(forgedDigest) };
  const verification = verifyFreshSessionHandoff(
    forged, manifest, 'session-forged-lifetime', expected(manifest, issuedAtMs + 20), nextOwner, [], limits, signer,
  );
  assert.equal(verification.valid, false);
  assert.ok(verification.reasonCodes.includes('HANDOFF_OUTLIVES_MANIFEST'));
});

test('unsigned omission changes, extra authority fields, deadline expiry, and handoff ID tamper fail closed', () => {
  const manifest = generateSignedContextManifest(input(), limits, signer);
  assert.equal(verifySignedContextManifest({ ...manifest, omissionDigest: sha256('forged') }, expected(manifest), limits, signer).valid, false);
  assert.equal(verifySignedContextManifest({ ...manifest, operationalAuthority: 'ALL' }, expected(manifest), limits, signer).valid, false);
  const deadline = verifySignedContextManifest(manifest, expected(manifest, manifest.deadlineAtMs), limits, signer);
  assert.ok(deadline.reasonCodes.includes('MANIFEST_DEADLINE_EXCEEDED'));
  const handoff = generateFreshSessionHandoff('session-fresh-3', expected(manifest, issuedAtMs + 10), nextOwner, manifest, issuedAtMs + 10, issuedAtMs + 100, limits, signer);
  const tamperedId = verifyFreshSessionHandoff({ ...handoff, handoffId: 'a2-fresh-handoff:forged' }, manifest, 'session-fresh-3', expected(manifest, issuedAtMs + 20), nextOwner, [], limits, signer);
  assert.ok(tamperedId.reasonCodes.includes('HANDOFF_ID_MISMATCH'));
});

test('fresh-session verification rejects stale authority, policy, lease, fence, budget, and evidence lineage', () => {
  const manifest = generateSignedContextManifest(input(), limits, signer);
  const handoff = generateFreshSessionHandoff('session-current-lineage', expected(manifest, issuedAtMs + 10), nextOwner, manifest, issuedAtMs + 10, issuedAtMs + 100, limits, signer);
  const stale = verifyFreshSessionHandoff(handoff, manifest, 'session-current-lineage', {
    ...expected(manifest, issuedAtMs + 20),
    expectedPolicyRevision: 'context-policy-v2',
    expectedAcceptedAuthoritySha: '1'.repeat(40),
    expectedLeaseId: 'synthetic-lease-2',
    expectedFenceToken: manifest.fenceToken + 1,
    expectedBudgetStateDigest: sha256('new-budget'),
    expectedEvidenceBundleDigest: sha256('new-evidence'),
  }, nextOwner, [], limits, signer);
  assert.equal(stale.valid, false);
  assert.ok(stale.reasonCodes.includes('REFERENCED_MANIFEST_INVALID'));
});

test('context artifacts reject acceptance terminal words', () => {
  assert.throws(() => generateSignedContextManifest(input({ stopCondition: 'INTEGRATED_ACCEPTED' }), limits, signer), /SHADOW_ARTIFACT_READY/u);
});

test('context entry ordering is ordinal and independent of locale collation', () => {
  const manifest = generateSignedContextManifest(input({
    contextEntries: [
      { contextId: 'context-z', ownerId: 'owner-z', authority: 'CANONICAL_OWNER', digest: sha256('z'), status: 'RESOLVED' },
      { contextId: 'context-Z', ownerId: 'owner-Z', authority: 'CANONICAL_OWNER', digest: sha256('Z'), status: 'RESOLVED' },
    ],
  }), limits, signer);
  assert.deepEqual(manifest.contextEntries.map((entry) => entry.contextId), ['context-Z', 'context-z']);
});

test('hostile collection hooks and signer-side mutation cannot rewrite signed context', () => {
  const hostile = input();
  Object.defineProperty(hostile.contextEntries, Symbol.iterator, {
    configurable: true,
    value: function* hostileIterator() {
      yield { contextId: 'forged', ownerId: 'forged', authority: 'CANONICAL_OWNER', digest: sha256('forged'), status: 'RESOLVED' };
    },
  });
  assert.throws(() => generateSignedContextManifest(hostile, limits, signer), /custom array fields|symbol/u);

  const mutableInput = input();
  const mutableLimits = { ...limits };
  const mutatingSigner = {
    posture: 'SYNTHETIC_ONLY',
    signDigest(digest) {
      mutableInput.nextOwner = 'forged-owner';
      mutableInput.contextEntries.length = 0;
      mutableLimits.maximumManifestBytes = 1;
      return signer.signDigest(digest);
    },
    verifyDigest: signer.verifyDigest,
  };
  const manifest = generateSignedContextManifest(mutableInput, mutableLimits, mutatingSigner);
  assert.equal(manifest.nextOwner, nextOwner);
  assert.deepEqual(manifest.contextEntries.map((entry) => entry.contextId), ['context-a', 'context-b']);
});

test('signed manifest verification rejects every noncanonical raw collection representation', () => {
  const manifest = generateSignedContextManifest(input({
    priorReceiptIds: ['prior-receipt-1', 'prior-receipt-2'],
    omittedContextIds: ['omitted-a', 'omitted-z'],
  }), limits, signer);
  const variants = [
    { ...manifest, hardDenials: [...manifest.hardDenials].reverse() },
    { ...manifest, priorReceiptIds: [...manifest.priorReceiptIds].reverse() },
    { ...manifest, priorReceiptIds: [...manifest.priorReceiptIds, manifest.priorReceiptIds[0]] },
    { ...manifest, contextEntries: [...manifest.contextEntries].reverse() },
    { ...manifest, omittedContextIds: [...manifest.omittedContextIds].reverse() },
    { ...manifest, omittedContextIds: [...manifest.omittedContextIds, manifest.omittedContextIds[0]] },
  ];
  for (const variant of variants) {
    const verification = verifySignedContextManifest(variant, expected(manifest), limits, signer);
    assert.equal(verification.valid, false);
    assert.ok(verification.reasonCodes.includes('MANIFEST_NON_CANONICAL'));
  }
});

test('Promise-shaped signature verification and handoffs beyond the manifest deadline fail closed', () => {
  const manifest = generateSignedContextManifest(input(), limits, signer);
  const asyncVerifier = {
    posture: 'SYNTHETIC_ONLY',
    signDigest: signer.signDigest,
    verifyDigest() { return Promise.resolve(false); },
  };
  const verification = verifySignedContextManifest(manifest, expected(manifest), limits, asyncVerifier);
  assert.equal(verification.valid, false);
  assert.ok(verification.reasonCodes.includes('MANIFEST_SIGNATURE_INVALID'));
  assert.throws(() => generateSignedContextManifest(input(), limits, asyncVerifier), /did not verify/u);
  assert.throws(() => generateFreshSessionHandoff(
    'session-after-deadline', expected(manifest, issuedAtMs + 10), nextOwner, manifest,
    issuedAtMs + 10, manifest.deadlineAtMs + 1, limits, signer,
  ), /lifetime invalid/u);

  const valid = generateFreshSessionHandoff(
    'session-deadline-forgery', expected(manifest, issuedAtMs + 10), nextOwner, manifest,
    issuedAtMs + 10, manifest.deadlineAtMs, limits, signer,
  );
  const { payloadDigest: _digest, signature: _signature, ...forgedPayload } = {
    ...valid,
    expiresAtMs: manifest.deadlineAtMs + 1,
  };
  const forgedDigest = sha256(canonicalJson(forgedPayload));
  const forged = { ...forgedPayload, payloadDigest: forgedDigest, signature: signer.signDigest(forgedDigest) };
  const forgedVerification = verifyFreshSessionHandoff(
    forged, manifest, 'session-deadline-forgery', expected(manifest, issuedAtMs + 20), nextOwner, [], limits, signer,
  );
  assert.equal(forgedVerification.valid, false);
  assert.ok(forgedVerification.reasonCodes.includes('HANDOFF_OUTLIVES_DEADLINE'));
});
