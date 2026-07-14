import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { createSyntheticCallbackDedupPort, SYNTHETIC_TEST_KEY } from '../../../fixtures/aiOps/providerAdapters/syntheticPorts.mjs';
import { loadA3 } from './networkDeny.mjs';

const a3 = await loadA3();
const nowMs = 1_700_000_000_000;
const digest = 'c'.repeat(64);
const baseSha = '03857dcdaff8d8b12627d27ddcc97505da1f2f86';

function encode(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function proof(rawBody, overrides = {}) {
  const unsigned = {
    schema: 'AI_OPS_SYNTHETIC_AUTHENTICATION_PROOF_V1',
    algorithm: 'HMAC_SHA256_TEST_ONLY',
    keyId: SYNTHETIC_TEST_KEY.keyId,
    keyClassification: 'TEST_ONLY_SYNTHETIC_INVALID',
    method: 'POST',
    routeId: 'provider-callback-test-only',
    issuedAtMs: nowMs - 1,
    expiresAtMs: nowMs + 60_000,
    nonce: 'nonce-test-only-1',
    ...overrides,
  };
  const bodyDigest = createHash('sha256').update(rawBody).digest('hex');
  const authenticationProofHex = createHmac('sha256', SYNTHETIC_TEST_KEY.keyBytes)
    .update(a3.callbackAuthenticationMessage(unsigned, bodyDigest))
    .digest('hex');
  return { ...unsigned, authenticationProofHex };
}

function callback(overrides = {}) {
  return {
    schema: 'AI_OPS_PROVIDER_CALLBACK_V1',
    callbackId: 'callback-test-only',
    providerEventId: 'provider-event-test-only',
    internalRunId: 'internal-run-test-only',
    jobId: 'job-test-only',
    attemptId: 'attempt-test-only',
    caseId: 'case-test-only',
    evidenceDigest: digest,
    workflowGeneration: 3,
    identityRole: 'RUNTIME_DIAGNOSTICIAN',
    providerId: 'provider-test-only',
    modelId: 'model-test-only',
    baseSha,
    resultDigest: 'd'.repeat(64),
    providerOperationRequestDigest: '4'.repeat(64),
    purpose: 'DIAGNOSE',
    ...overrides,
  };
}

function expected(overrides = {}) {
  return {
    routeId: 'provider-callback-test-only',
    jobId: 'job-test-only',
    attemptId: 'attempt-test-only',
    caseId: 'case-test-only',
    evidenceDigest: digest,
    workflowGeneration: 3,
    identityRole: 'RUNTIME_DIAGNOSTICIAN',
    providerId: 'provider-test-only',
    modelId: 'model-test-only',
    baseSha,
    providerOperationRequestDigest: '4'.repeat(64),
    purpose: 'DIAGNOSE',
    ...overrides,
  };
}

function signedJob(overrides = {}) {
  return {
    schema: 'AI_OPS_SIGNED_JOB_V1',
    jobId: 'job-test-only',
    attemptId: 'attempt-test-only',
    caseId: 'case-test-only',
    evidenceDigest: digest,
    workflowGeneration: 3,
    identityRole: 'ENGINEERING_REPAIR_WORKER',
    providerId: 'provider-test-only',
    modelId: 'model-test-only',
    baseSha,
    toolRegistryDigest: a3.toolRegistryDigest(),
    providerOperationRequestDigest: '4'.repeat(64),
    purpose: 'REPAIR',
    ...overrides,
  };
}

function expectedJob() {
  const job = signedJob();
  return {
    routeId: 'job-dispatch-test-only',
    jobId: job.jobId,
    attemptId: job.attemptId,
    caseId: job.caseId,
    evidenceDigest: job.evidenceDigest,
    workflowGeneration: job.workflowGeneration,
    identityRole: job.identityRole,
    providerId: job.providerId,
    modelId: job.modelId,
    baseSha: job.baseSha,
    toolRegistryDigest: job.toolRegistryDigest,
    providerOperationRequestDigest: job.providerOperationRequestDigest,
    purpose: job.purpose,
  };
}

describe('A3 signed job envelope', () => {
  it('verifies raw synthetic proof before accepting a strict job shape', () => {
    const job = signedJob();
    const rawBody = encode(job);
    const result = a3.verifySignedJobEnvelope({
      rawBody,
      proof: proof(rawBody, { method: 'INTERNAL', routeId: 'job-dispatch-test-only' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      routeId: 'job-dispatch-test-only',
    });
    assert.equal(result.valid, true);
    assert.equal(result.authorityGranted, false);
    assert.equal(result.job.jobId, job.jobId);
  });

  it('binds and atomically deduplicates authenticated job dispatch', async () => {
    const rawBody = encode(signedJob());
    const dedup = createSyntheticCallbackDedupPort();
    const first = await a3.verifyAndReserveSignedJobEnvelope({
      rawBody,
      proof: proof(rawBody, { method: 'INTERNAL', routeId: 'job-dispatch-test-only', nonce: 'job-nonce-test-only-first' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expectedJob(),
      dedup,
    });
    assert.equal(first.accepted, true);
    assert.equal(first.dispatchAuthorized, true);
    assert.equal(first.disposition, 'DURABLY_RESERVED');

    const duplicate = await a3.verifyAndReserveSignedJobEnvelope({
      rawBody,
      proof: proof(rawBody, { method: 'INTERNAL', routeId: 'job-dispatch-test-only', nonce: 'job-nonce-test-only-second' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expectedJob(),
      dedup,
    });
    assert.equal(duplicate.accepted, true);
    assert.equal(duplicate.dispatchAuthorized, false);
    assert.equal(duplicate.disposition, 'IDEMPOTENT_DUPLICATE');
    assert.notEqual(duplicate.deliveryAuditReceiptId, first.deliveryAuditReceiptId);
  });

  it('rejects proof tampering and extra job properties', () => {
    const job = {
      schema: 'AI_OPS_SIGNED_JOB_V1',
      jobId: 'job-test-only',
      attemptId: 'attempt-test-only',
      caseId: 'case-test-only',
      evidenceDigest: digest,
      workflowGeneration: 3,
      identityRole: 'INDEPENDENT_VERIFIER',
      providerId: 'provider-test-only',
      modelId: 'model-test-only',
      baseSha,
      toolRegistryDigest: a3.toolRegistryDigest(),
      providerOperationRequestDigest: '4'.repeat(64),
      purpose: 'VERIFY',
      hidden: true,
    };
    const rawBody = encode(job);
    const validProof = proof(rawBody, { method: 'INTERNAL', routeId: 'job-dispatch-test-only' });
    const schemaRejected = a3.verifySignedJobEnvelope({ rawBody, proof: validProof, key: SYNTHETIC_TEST_KEY, nowMs, routeId: 'job-dispatch-test-only' });
    assert.equal(schemaRejected.valid, false);
    assert.match(schemaRejected.reasonCodes.join(','), /SIGNED_JOB_SCHEMA_REJECTED/);

    const tampered = { ...validProof, authenticationProofHex: '0'.repeat(64) };
    const proofRejected = a3.verifySignedJobEnvelope({ rawBody, proof: tampered, key: SYNTHETIC_TEST_KEY, nowMs, routeId: 'job-dispatch-test-only' });
    assert.equal(proofRejected.valid, false);
    assert.match(proofRejected.reasonCodes.join(','), /AUTHENTICATION_PROOF_MISMATCH/);
  });

  it('fails closed on malformed proof, key, body and clock values', () => {
    const rawBody = encode(signedJob());
    const baseInput = {
      rawBody,
      proof: proof(rawBody, { method: 'INTERNAL', routeId: 'job-dispatch-test-only' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      routeId: 'job-dispatch-test-only',
    };
    for (const hostile of [
      { ...baseInput, proof: null },
      { ...baseInput, proof: { ...baseInput.proof, authenticationProofHex: { toString: () => baseInput.proof.authenticationProofHex } } },
      { ...baseInput, key: null },
      { ...baseInput, key: { ...SYNTHETIC_TEST_KEY, keyBytes: new Proxy(SYNTHETIC_TEST_KEY.keyBytes, {}) } },
      { ...baseInput, key: { ...SYNTHETIC_TEST_KEY, keyBytes: new Uint8Array(4_097) } },
      { ...baseInput, rawBody: null },
      { ...baseInput, nowMs: Number.NaN },
    ]) {
      assert.doesNotThrow(() => a3.verifySignedJobEnvelope(hostile));
      assert.equal(a3.verifySignedJobEnvelope(hostile).valid, false);
    }
    const accessorProof = { ...baseInput.proof };
    Object.defineProperty(accessorProof, 'routeId', { enumerable: true, get: () => 'job-dispatch-test-only' });
    assert.equal(a3.verifySignedJobEnvelope({ ...baseInput, proof: accessorProof }).valid, false);
    assert.doesNotThrow(() => a3.verifySignedJobEnvelope(null));
    assert.equal(a3.verifySignedJobEnvelope(null).valid, false);
  });

  it('rejects malformed outer reservation bindings without throwing', async () => {
    const rawBody = encode(signedJob());
    const baseInput = {
      rawBody,
      proof: proof(rawBody, { method: 'INTERNAL', routeId: 'job-dispatch-test-only' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expectedJob(),
      dedup: createSyntheticCallbackDedupPort(),
    };
    const accessorExpected = expectedJob();
    Object.defineProperty(accessorExpected, 'providerId', {
      enumerable: true,
      get() {
        throw new Error('TEST_ONLY_SIGNED_JOB_EXPECTED_PROVIDER_ACCESSOR_MUST_NOT_RUN');
      },
    });
    for (const hostile of [null, { ...baseInput, expected: null }, { ...baseInput, expected: accessorExpected }, { ...baseInput, dedup: null }]) {
      await assert.doesNotReject(async () => a3.verifyAndReserveSignedJobEnvelope(hostile));
      assert.equal((await a3.verifyAndReserveSignedJobEnvelope(hostile)).accepted, false);
    }
  });

  it('binds provider and model in the signed body, expected subject and durable reservation', async () => {
    const recordedReservations = [];
    const backing = createSyntheticCallbackDedupPort();
    const dedup = Object.freeze({
      schema: 'AI_OPS_CALLBACK_DEDUP_PORT_V1',
      reserveAuthenticatedCallback: (input) => backing.reserveAuthenticatedCallback(input),
      reserveAuthenticatedJob(input) {
        recordedReservations.push(input);
        return backing.reserveAuthenticatedJob(input);
      },
    });
    const job = signedJob();
    const rawBody = encode(job);
    const admitted = await a3.verifyAndReserveSignedJobEnvelope({
      rawBody,
      proof: proof(rawBody, { method: 'INTERNAL', routeId: 'job-dispatch-test-only', nonce: 'job-provider-model-binding-test-only' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expectedJob(),
      dedup,
    });
    assert.equal(admitted.accepted, true);
    assert.equal(recordedReservations.length, 1);
    assert.equal(recordedReservations[0].providerId, job.providerId);
    assert.equal(recordedReservations[0].modelId, job.modelId);

    for (const [field, changed] of [
      ['providerId', 'different-provider-test-only'],
      ['modelId', 'different-model-test-only'],
    ]) {
      const driftedJob = signedJob({ [field]: changed });
      const driftedBody = encode(driftedJob);
      const rejected = await a3.verifyAndReserveSignedJobEnvelope({
        rawBody: driftedBody,
        proof: proof(driftedBody, {
          method: 'INTERNAL',
          routeId: 'job-dispatch-test-only',
          nonce: `job-${field.toLowerCase()}-drift-test-only`,
        }),
        key: SYNTHETIC_TEST_KEY,
        nowMs,
        expected: expectedJob(),
        dedup: createSyntheticCallbackDedupPort(),
      });
      assert.equal(rejected.accepted, false);
      assert.match(rejected.reasonCodes.join(','), new RegExp(`SIGNED_JOB_BINDING_MISMATCH_${field.toUpperCase()}`));
    }
  });

  it('rejects malformed signed-job provider and model identifiers', () => {
    for (const [field, changed] of [
      ['providerId', 'provider with spaces'],
      ['modelId', 'm'.repeat(129)],
    ]) {
      const malformedJob = signedJob({ [field]: changed });
      const rawBody = encode(malformedJob);
      const result = a3.verifySignedJobEnvelope({
        rawBody,
        proof: proof(rawBody, { method: 'INTERNAL', routeId: 'job-dispatch-test-only', nonce: `malformed-${field.toLowerCase()}-test-only` }),
        key: SYNTHETIC_TEST_KEY,
        nowMs,
        routeId: 'job-dispatch-test-only',
      });
      assert.equal(result.valid, false);
      assert.match(result.reasonCodes.join(','), /SIGNED_JOB_SCHEMA_REJECTED/);
    }
  });
});

describe('A3 callback authentication and dedup', () => {
  it('durably reserves a bound callback and reports only EFFECT_UNKNOWN', async () => {
    const rawBody = encode(callback());
    const dedup = createSyntheticCallbackDedupPort();
    const result = await a3.verifyAndReserveProviderCallback({
      rawBody,
      proof: proof(rawBody),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup,
    });
    assert.equal(result.acknowledged, true);
    assert.equal(result.enqueueAuthorized, true);
    assert.equal(result.disposition, 'DURABLY_RESERVED');
    assert.equal(result.effectSemantics, 'EFFECT_UNKNOWN');
    assert.equal(result.authorityGranted, false);
    assert.deepEqual(dedup.snapshot(), { replayReservations: 1, callbackReservations: 1, jobReservations: 0, deliveryAudits: 1 });
  });

  it('passes callback provider and model bindings directly to durable reservation', async () => {
    const recordedReservations = [];
    const backing = createSyntheticCallbackDedupPort();
    const dedup = Object.freeze({
      schema: 'AI_OPS_CALLBACK_DEDUP_PORT_V1',
      reserveAuthenticatedCallback(input) {
        recordedReservations.push(input);
        return backing.reserveAuthenticatedCallback(input);
      },
      reserveAuthenticatedJob: (input) => backing.reserveAuthenticatedJob(input),
    });
    const callbackBody = callback();
    const rawBody = encode(callbackBody);
    const result = await a3.verifyAndReserveProviderCallback({
      rawBody,
      proof: proof(rawBody, { nonce: 'callback-provider-model-binding-test-only' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup,
    });
    assert.equal(result.acknowledged, true);
    assert.equal(recordedReservations.length, 1);
    assert.equal(recordedReservations[0].providerId, callbackBody.providerId);
    assert.equal(recordedReservations[0].modelId, callbackBody.modelId);
  });

  it('idempotently acknowledges semantic retries and byte-identical signed replays', async () => {
    const rawBody = encode(callback());
    const dedup = createSyntheticCallbackDedupPort();
    const firstProof = proof(rawBody, { nonce: 'nonce-test-only-first' });
    const first = await a3.verifyAndReserveProviderCallback({ rawBody, proof: firstProof, key: SYNTHETIC_TEST_KEY, nowMs, expected: expected(), dedup });
    assert.equal(first.disposition, 'DURABLY_RESERVED');

    const duplicate = await a3.verifyAndReserveProviderCallback({
      rawBody,
      proof: proof(rawBody, { nonce: 'nonce-test-only-second' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup,
    });
    assert.equal(duplicate.disposition, 'IDEMPOTENT_DUPLICATE');
    assert.equal(duplicate.enqueueAuthorized, false);

    const replayed = await a3.verifyAndReserveProviderCallback({ rawBody, proof: firstProof, key: SYNTHETIC_TEST_KEY, nowMs, expected: expected(), dedup });
    assert.equal(replayed.httpStatus, 202);
    assert.equal(replayed.disposition, 'IDEMPOTENT_DUPLICATE');
    assert.equal(replayed.enqueueAuthorized, false);
    assert.notEqual(replayed.deliveryAuditReceiptId, first.deliveryAuditReceiptId);
  });

  it('rejects semantic conflicts, stale proofs, binding drift and unavailable durable reservation', async () => {
    const dedup = createSyntheticCallbackDedupPort();
    const rawBody = encode(callback());
    await a3.verifyAndReserveProviderCallback({ rawBody, proof: proof(rawBody), key: SYNTHETIC_TEST_KEY, nowMs, expected: expected(), dedup });

    const changedBody = encode(callback({ resultDigest: 'e'.repeat(64) }));
    const conflict = await a3.verifyAndReserveProviderCallback({
      rawBody: changedBody,
      proof: proof(changedBody, { nonce: 'nonce-test-only-conflict' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup,
    });
    assert.equal(conflict.httpStatus, 409);
    assert.match(conflict.reasonCodes.join(','), /CALLBACK_DEDUP_CONFLICT/);

    const stale = await a3.verifyAndReserveProviderCallback({
      rawBody,
      proof: proof(rawBody, { issuedAtMs: nowMs - 2000, expiresAtMs: nowMs }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup: createSyntheticCallbackDedupPort(),
    });
    assert.equal(stale.httpStatus, 401);
    assert.match(stale.reasonCodes.join(','), /AUTHENTICATION_PROOF_STALE_OR_INVALID/);

    const driftBody = encode(callback({ workflowGeneration: 4 }));
    const drift = await a3.verifyAndReserveProviderCallback({
      rawBody: driftBody,
      proof: proof(driftBody, { nonce: 'nonce-test-only-drift' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup: createSyntheticCallbackDedupPort(),
    });
    assert.equal(drift.httpStatus, 409);
    assert.match(drift.reasonCodes.join(','), /CALLBACK_BINDING_MISMATCH_WORKFLOWGENERATION/);

    const unavailable = await a3.verifyAndReserveProviderCallback({
      rawBody,
      proof: proof(rawBody, { nonce: 'nonce-test-only-unavailable' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup: createSyntheticCallbackDedupPort({ unavailable: true }),
    });
    assert.equal(unavailable.httpStatus, 503);
    assert.equal(unavailable.acknowledged, false);
  });

  it('deduplicates provider event, run, callback, job and attempt IDs as independent callback dimensions', async () => {
    const original = encode(callback());

    const eventDedup = createSyntheticCallbackDedupPort();
    await a3.verifyAndReserveProviderCallback({ rawBody: original, proof: proof(original), key: SYNTHETIC_TEST_KEY, nowMs, expected: expected(), dedup: eventDedup });
    const reusedEventBody = encode(callback({
      internalRunId: 'different-internal-run-test-only',
      callbackId: 'different-callback-test-only',
      resultDigest: '8'.repeat(64),
    }));
    const reusedEvent = await a3.verifyAndReserveProviderCallback({
      rawBody: reusedEventBody,
      proof: proof(reusedEventBody, { nonce: 'nonce-reused-event-test-only' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup: eventDedup,
    });
    assert.equal(reusedEvent.httpStatus, 409);

    const runDedup = createSyntheticCallbackDedupPort();
    await a3.verifyAndReserveProviderCallback({ rawBody: original, proof: proof(original), key: SYNTHETIC_TEST_KEY, nowMs, expected: expected(), dedup: runDedup });
    const reusedRunBody = encode(callback({
      providerEventId: 'different-provider-event-test-only',
      callbackId: 'different-callback-test-only',
      resultDigest: '7'.repeat(64),
    }));
    const reusedRun = await a3.verifyAndReserveProviderCallback({
      rawBody: reusedRunBody,
      proof: proof(reusedRunBody, { nonce: 'nonce-reused-run-test-only' }),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup: runDedup,
    });
    assert.equal(reusedRun.httpStatus, 409);

    for (const [dimension, override] of [
      ['job', { attemptId: 'different-attempt-test-only' }],
      ['attempt', { jobId: 'different-job-test-only' }],
    ]) {
      const dimensionDedup = createSyntheticCallbackDedupPort();
      await a3.verifyAndReserveProviderCallback({ rawBody: original, proof: proof(original), key: SYNTHETIC_TEST_KEY, nowMs, expected: expected(), dedup: dimensionDedup });
      const reusedBody = encode(callback({
        providerEventId: `different-provider-event-${dimension}-test-only`,
        internalRunId: `different-internal-run-${dimension}-test-only`,
        callbackId: `different-callback-${dimension}-test-only`,
        resultDigest: dimension === 'job' ? '6'.repeat(64) : '5'.repeat(64),
        ...override,
      }));
      const expectedBinding = expected({ ...override });
      const reused = await a3.verifyAndReserveProviderCallback({
        rawBody: reusedBody,
        proof: proof(reusedBody, { nonce: `nonce-reused-${dimension}-test-only` }),
        key: SYNTHETIC_TEST_KEY,
        nowMs,
        expected: expectedBinding,
        dedup: dimensionDedup,
      });
      assert.equal(reused.httpStatus, 409, dimension);
    }
  });

  it('fails closed on throwing, unknown or receipt-less durable ports', async () => {
    const rawBody = encode(callback());
    const hostilePorts = [
      createSyntheticCallbackDedupPort({ throwError: true }),
      createSyntheticCallbackDedupPort({ invalidResult: { status: 'UNKNOWN', receiptId: undefined } }),
      createSyntheticCallbackDedupPort({ invalidResult: { status: 'RESERVED', receiptId: undefined, deliveryAuditReceiptId: undefined } }),
      createSyntheticCallbackDedupPort({ invalidResult: Object.defineProperty({ receiptId: null, deliveryAuditReceiptId: null }, 'status', { enumerable: true, get: () => 'RESERVED' }) }),
    ];
    for (const [index, dedup] of hostilePorts.entries()) {
      const result = await a3.verifyAndReserveProviderCallback({
        rawBody,
        proof: proof(rawBody, { nonce: `nonce-invalid-port-test-only-${index}` }),
        key: SYNTHETIC_TEST_KEY,
        nowMs,
        expected: expected(),
        dedup,
      });
      assert.equal(result.httpStatus, 503);
      assert.equal(result.acknowledged, false);
      assert.equal(result.receiptId, null);
    }
  });

  it('rejects malformed callback outer bindings without throwing', async () => {
    const rawBody = encode(callback());
    const baseInput = {
      rawBody,
      proof: proof(rawBody),
      key: SYNTHETIC_TEST_KEY,
      nowMs,
      expected: expected(),
      dedup: createSyntheticCallbackDedupPort(),
    };
    for (const hostile of [null, { ...baseInput, expected: null }, { ...baseInput, dedup: null }]) {
      await assert.doesNotReject(async () => a3.verifyAndReserveProviderCallback(hostile));
      assert.equal((await a3.verifyAndReserveProviderCallback(hostile)).acknowledged, false);
    }
  });
});
