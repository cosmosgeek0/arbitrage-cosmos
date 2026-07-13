import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIAGNOSTIC_TRACE,
  NOW,
  RETENTION_POLICY,
  clone,
  h,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.fixtures.mjs';
import { appendChainDigest } from '../../../../fixtures/productAssurance/systemic/agentBoundary/canonical.mjs';
import {
  diagnosticTracePayloadDigest,
  evaluateTracePrivacyAndRetention,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/evaluators.mjs';

function evaluate(trace = DIAGNOSTIC_TRACE, policy = RETENTION_POLICY) {
  return evaluateTracePrivacyAndRetention({ trace, policy, nowMs: NOW });
}

function resealTrace(trace) {
  const receipt = trace.retentionReceipts[0];
  receipt.payloadDigest = diagnosticTracePayloadDigest(trace);
  receipt.chainDigest = appendChainDigest(receipt);
  return trace;
}

function mutateReceipt(overrides) {
  const trace = clone(DIAGNOSTIC_TRACE);
  Object.assign(trace.retentionReceipts[0], overrides);
  trace.retentionReceipts[0].chainDigest = appendChainDigest(trace.retentionReceipts[0]);
  return trace;
}

test('redacted extension trace with independent append receipt passes deterministically', () => {
  const first = evaluate();
  const second = evaluate(clone(DIAGNOSTIC_TRACE));
  assert.deepEqual(first, second);
  assert.equal(first.status, 'PASS');
  assert.equal(first.disposition, 'TRACE_PRIVACY_AND_RETENTION_PROVEN');
  assert.equal(first.decisionKind, 'TRACE_PRIVACY_RETENTION');
  assert.equal(first.lastAppendSequence, RETENTION_POLICY.expectedFirstSequence);
  assert.equal(first.retentionOwnerId, 'existing-ledger-adapter');
  assert.ok(first.retentionCoverageUntilMs > NOW);
});

test('extension explicitly reuses the base §3.9 run trace instead of redefining it', () => {
  assert.equal(DIAGNOSTIC_TRACE.baseTraceRef.ownerSection, 'IP_ASSURANCE.md#3.9');
  assert.equal(DIAGNOSTIC_TRACE.baseTraceRef.reuseMode, 'BASE_REUSED');
  assert.equal(DIAGNOSTIC_TRACE.schema, 'DiagnosticTracePrivacyRetentionExtensionV1');
  for (const duplicateBaseField of ['modelId', 'modelVersion', 'promptRevision', 'retrievalIds', 'toolEvents', 'budgetUse']) {
    assert.equal(Object.hasOwn(DIAGNOSTIC_TRACE, duplicateBaseField), false, duplicateBaseField);
  }
});

test('edit, delete, and reorder operations can never count as append-only retention', () => {
  for (const operation of ['EDIT', 'DELETE', 'REORDER']) {
    const result = evaluate(mutateReceipt({ operation }));
    assert.equal(result.status, 'FAIL', operation);
    assert.ok(result.reasonCodes.includes('RETENTION_MUTATION_FORBIDDEN'));
  }
});

test('tamper, chain break, payload mismatch, and sequence reorder fail exact integrity checks', () => {
  const tampered = clone(DIAGNOSTIC_TRACE);
  tampered.retentionReceipts[0].payloadDigest = 'a'.repeat(64);
  assert.ok(evaluate(tampered).reasonCodes.includes('APPEND_PAYLOAD_DIGEST_MISMATCH'));
  assert.ok(evaluate(tampered).reasonCodes.includes('APPEND_CHAIN_DIGEST_MISMATCH'));

  const brokenPrevious = mutateReceipt({ previousChainDigest: 'b'.repeat(64) });
  assert.ok(evaluate(brokenPrevious).reasonCodes.includes('APPEND_CHAIN_PREVIOUS_DIGEST_MISMATCH'));

  const reordered = mutateReceipt({ sequence: RETENTION_POLICY.expectedFirstSequence + 1 });
  assert.ok(evaluate(reordered).reasonCodes.includes('APPEND_SEQUENCE_GAP_OR_REORDER'));
});

test('append chain digest binds operation and independent readback state', () => {
  const base = clone(DIAGNOSTIC_TRACE.retentionReceipts[0]);
  const edited = { ...base, operation: 'EDIT' };
  const unknownReadback = { ...base, readbackState: 'UNKNOWN' };
  assert.notEqual(appendChainDigest(base), appendChainDigest(edited));
  assert.notEqual(appendChainDigest(base), appendChainDigest(unknownReadback));
});

test('producer-retained and common-mode verified traces cannot prove independence', () => {
  const cases = [
    mutateReceipt({ writerId: DIAGNOSTIC_TRACE.producerId }),
    mutateReceipt({ verifierId: 'existing-ledger-adapter' }),
    mutateReceipt({ verifierId: DIAGNOSTIC_TRACE.providerId }),
  ];
  for (const trace of cases) assert.equal(evaluate(trace).status, 'FAIL');
  assert.ok(evaluate(cases[0]).reasonCodes.includes('RETENTION_WRITER_NOT_INDEPENDENT'));
  assert.ok(evaluate(cases[1]).reasonCodes.includes('RETENTION_VERIFIER_NOT_INDEPENDENT'));
});

test('append retention rejects empty writer/verifier identities and unsupported receipt schema', () => {
  const cases = [
    ['RETENTION_WRITER_NOT_INDEPENDENT', mutateReceipt({ writerId: '' })],
    ['RETENTION_VERIFIER_NOT_INDEPENDENT', mutateReceipt({ verifierId: '' })],
    ['RETENTION_RECEIPT_SCHEMA_UNSUPPORTED', mutateReceipt({ version: 2 })],
  ];
  for (const [reason, trace] of cases) {
    const result = evaluate(trace);
    assert.equal(result.status, 'FAIL', reason);
    assert.ok(result.reasonCodes.includes(reason), reason);
  }
});

test('missing append or independent readback stays UNKNOWN and blocks evidence promotion', () => {
  const noReceipt = clone(DIAGNOSTIC_TRACE);
  noReceipt.retentionReceipts = [];
  const missing = evaluate(noReceipt);
  assert.equal(missing.status, 'UNKNOWN');
  assert.ok(missing.reasonCodes.includes('APPEND_RETENTION_RECEIPT_MISSING'));

  const noReadback = mutateReceipt({ readbackState: 'UNKNOWN' });
  const unknown = evaluate(noReadback);
  assert.equal(unknown.status, 'UNKNOWN');
  assert.ok(unknown.reasonCodes.includes('RETENTION_READBACK_UNKNOWN'));
});

test('privacy, provenance, instruction separation, and retention duration fail closed after exact reseal', () => {
  const raw = resealTrace({ ...clone(DIAGNOSTIC_TRACE), rawEvidence: 'not permitted' });
  assert.ok(evaluate(raw).reasonCodes.includes('TRACE_SECRET_BEARING_FIELD_FORBIDDEN'));

  const noProvenance = clone(DIAGNOSTIC_TRACE);
  noProvenance.evidenceRefs = [];
  assert.equal(evaluate(resealTrace(noProvenance)).status, 'UNKNOWN');

  const instructionFailure = clone(DIAGNOSTIC_TRACE);
  instructionFailure.privacy.instructionSeparation = 'FAIL';
  assert.ok(evaluate(resealTrace(instructionFailure)).reasonCodes.includes('TRACE_INSTRUCTION_SEPARATION_FAILED'));

  const unregisteredPrivacyPolicy = clone(DIAGNOSTIC_TRACE);
  unregisteredPrivacyPolicy.privacy.policyRevision = 'attacker-self-asserted.v999';
  assert.ok(evaluate(resealTrace(unregisteredPrivacyPolicy)).reasonCodes.includes('TRACE_PRIVACY_POLICY_REVISION_MISMATCH'));

  const shortened = mutateReceipt({ minimumRetainUntilMs: NOW + 10 });
  assert.ok(evaluate(shortened).reasonCodes.includes('RETENTION_PERIOD_SHORTENED'));

  const expiredCoverage = mutateReceipt({ retainedAtMs: NOW - 172_800_000, minimumRetainUntilMs: NOW });
  assert.ok(evaluate(expiredCoverage).reasonCodes.includes('RETENTION_COVERAGE_EXPIRED'));
});

test('append receipts cannot regress retention time or shorten coverage across the chain', () => {
  const trace = clone(DIAGNOSTIC_TRACE);
  const first = trace.retentionReceipts[0];
  const second = {
    ...first,
    sequence: first.sequence + 1,
    previousChainDigest: first.chainDigest,
    retainedAtMs: first.retainedAtMs - 10_000,
  };
  second.chainDigest = appendChainDigest(second);
  trace.retentionReceipts.push(second);
  const regressed = evaluate(trace);
  assert.equal(regressed.status, 'FAIL');
  assert.ok(regressed.reasonCodes.includes('RETENTION_TIME_REGRESSION'));

  const shortened = clone(DIAGNOSTIC_TRACE);
  const initial = shortened.retentionReceipts[0];
  const later = {
    ...initial,
    sequence: initial.sequence + 1,
    previousChainDigest: initial.chainDigest,
    retainedAtMs: initial.retainedAtMs + 1,
    minimumRetainUntilMs: initial.minimumRetainUntilMs - 1,
  };
  later.chainDigest = appendChainDigest(later);
  shortened.retentionReceipts.push(later);
  assert.ok(evaluate(shortened).reasonCodes.includes('RETENTION_COVERAGE_SHORTENED_ACROSS_APPENDS'));
});

test('trace payload changes cannot reuse an old append receipt', () => {
  const changed = clone(DIAGNOSTIC_TRACE);
  changed.disposition = 'SANDBOX_DENIED';
  assert.ok(evaluate(changed).reasonCodes.includes('APPEND_PAYLOAD_DIGEST_MISMATCH'));
  assert.equal(evaluate(resealTrace(changed)).status, 'PASS');
});

test('invalid retention policy and inconsistent genesis anchor never throw or pass', () => {
  assert.doesNotThrow(() => evaluate(DIAGNOSTIC_TRACE, null));
  assert.equal(evaluate(DIAGNOSTIC_TRACE, null).status, 'UNKNOWN');

  const invalidGenesis = { ...RETENTION_POLICY, expectedPreviousChainDigest: 'GENESIS', expectedFirstSequence: 41, anchorEvidenceDigest: h('genesis-anchor') };
  const result = evaluate(DIAGNOSTIC_TRACE, invalidGenesis);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.reasonCodes.includes('GENESIS_SEQUENCE_MUST_START_AT_ONE'));
});

test('provider outage and denied diagnostic attempts may still retain valid evidence', () => {
  for (const disposition of ['DIAGNOSTIC_PLANE_UNAVAILABLE', 'DIAGNOSTIC_BUDGET_EXHAUSTED', 'SANDBOX_DENIED']) {
    const trace = clone(DIAGNOSTIC_TRACE);
    trace.disposition = disposition;
    assert.equal(evaluate(resealTrace(trace)).status, 'PASS', disposition);
  }
});

test('trace PASS binds the full retention policy and rejects producer-provider common mode', () => {
  const baseline = evaluate();
  const weakenedPolicy = { ...RETENTION_POLICY, minimumRetentionMs: 1 };
  const weakened = evaluate(DIAGNOSTIC_TRACE, weakenedPolicy);
  assert.equal(weakened.status, 'PASS');
  assert.notEqual(weakened.tracePolicyDigest, baseline.tracePolicyDigest);
  assert.notEqual(weakened.sourceEvidenceDigest, baseline.sourceEvidenceDigest);
  assert.notEqual(weakened.decisionDigest, baseline.decisionDigest);

  const commonMode = clone(DIAGNOSTIC_TRACE);
  commonMode.producerId = commonMode.providerId;
  const rejected = evaluate(resealTrace(commonMode));
  assert.equal(rejected.status, 'FAIL');
  assert.ok(rejected.reasonCodes.includes('TRACE_PRODUCER_PROVIDER_COMMON_MODE'));
});

test('allowed trace string slots reject raw secret material without reflecting it', () => {
  const trace = clone(DIAGNOSTIC_TRACE);
  trace.evidenceRefs[0].evidenceId = 'sk-live-rawsecret123';
  const result = evaluate(resealTrace(trace));
  assert.equal(result.status, 'FAIL');
  assert.ok(result.reasonCodes.includes('TRACE_SECRET_BEARING_FIELD_FORBIDDEN'));
  assert.doesNotMatch(JSON.stringify(result), /sk-live-rawsecret123/);
});

test('retention independence includes every historical writer and verifier', () => {
  const trace = clone(DIAGNOSTIC_TRACE);
  const first = trace.retentionReceipts[0];
  const second = {
    ...first,
    sequence: first.sequence + 1,
    previousChainDigest: first.chainDigest,
    retainedAtMs: first.retainedAtMs + 1,
    writerId: first.verifierId,
    verifierId: 'independent-retention-probe-2',
  };
  second.chainDigest = appendChainDigest(second);
  trace.retentionReceipts.push(second);
  const result = evaluate(trace);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.reasonCodes.includes('RETENTION_CROSS_RECEIPT_COMMON_MODE'));
});
