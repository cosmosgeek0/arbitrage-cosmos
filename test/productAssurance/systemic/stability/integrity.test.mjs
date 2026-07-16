import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancellationRestartDigest,
  captureCanonicalEvidence,
  canonicalEvidenceDigest,
  repairRestartDigest,
} from '../../../../fixtures/productAssurance/systemic/stability/integrity.mjs';

test('canonical evidence digest is SHA-256, domain-separated, and key-order independent', () => {
  const first = canonicalEvidenceDigest('s8.test.v1', { b: 2, a: 1 });
  const second = canonicalEvidenceDigest('s8.test.v1', { a: 1, b: 2 });
  assert.equal(first, 'sha256:507766a45eab2f666607ff6b24167e8f7cf137ec670dd861ea7fd3f91a88d060');
  assert.equal(second, first);
  assert.notEqual(canonicalEvidenceDigest('s8.test.v2', { a: 1, b: 2 }), first);
});

test('restart digests bind checkpoint identity, nested state, policy, and ordered attempts', () => {
  const cancellation = cancellationRestartDigest('checkpoint.1', { requestId: 'request.1', deadlineAtMs: 10 });
  assert.notEqual(
    cancellationRestartDigest('checkpoint.2', { requestId: 'request.1', deadlineAtMs: 10 }),
    cancellation,
  );
  assert.notEqual(
    cancellationRestartDigest('checkpoint.1', { requestId: 'request.1', deadlineAtMs: 11 }),
    cancellation,
  );

  const envelope = {
    checkpointRef: 'checkpoint.repair.1',
    campaignId: 'campaign.1',
    policyId: 'policy.1',
    policyRevision: 'revision.1',
    state: { remainingCostUnits: 9 },
    attempts: [{ attemptId: 'attempt.1' }, { attemptId: 'attempt.2' }],
  };
  const repair = repairRestartDigest(envelope);
  assert.notEqual(repairRestartDigest({ ...envelope, attempts: [...envelope.attempts].reverse() }), repair);
  assert.notEqual(repairRestartDigest({ ...envelope, policyRevision: 'revision.2' }), repair);
});

test('canonical evidence rejects cycles, sparse or decorated arrays, accessors, and non-finite values', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 1;
  const decorated = ['entry'];
  decorated.extra = true;
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() { throw new Error('must not execute'); },
  });
  for (const value of [
    cyclic,
    sparse,
    decorated,
    accessor,
    { value: Number.NaN },
    Array.from({ length: 4_097 }, () => null),
  ]) {
    assert.throws(() => canonicalEvidenceDigest('s8.test.v1', value), TypeError);
  }
});

test('descriptor capture reads each data property once and never invokes accessor or Proxy get traps', () => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 1;
    },
  });
  assert.throws(() => captureCanonicalEvidence(accessor), TypeError);
  assert.equal(getterCalls, 0);

  let proxyGetCalls = 0;
  let descriptorReads = 0;
  const proxied = new Proxy({ value: 7 }, {
    get(target, key, receiver) {
      proxyGetCalls += 1;
      return Reflect.get(target, key, receiver) + 1_000;
    },
    getOwnPropertyDescriptor(target, key) {
      descriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const captured = captureCanonicalEvidence(proxied);
  assert.equal(captured.value, 7);
  assert.equal(proxyGetCalls, 0);
  assert.equal(descriptorReads, 1);

  const revoked = Proxy.revocable({ value: 1 }, {});
  revoked.revoke();
  assert.throws(() => captureCanonicalEvidence(revoked.proxy), TypeError);
  assert.throws(() => canonicalEvidenceDigest('s8.test.v1', revoked.proxy), TypeError);

  let hostileMessageReads = 0;
  const hostileError = Object.create(TypeError.prototype);
  Object.defineProperty(hostileError, 'message', {
    get() {
      hostileMessageReads += 1;
      return 'attacker-controlled error detail';
    },
  });
  const throwingProxy = new Proxy({}, {
    ownKeys() {
      throw hostileError;
    },
  });
  assert.throws(() => captureCanonicalEvidence(throwingProxy), TypeError);
  assert.equal(hostileMessageReads, 0);
});
