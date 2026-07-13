import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_IDENTITY_EVENTS,
  DIAGNOSTIC_REQUEST,
  DIAGNOSTIC_TRACE,
  KILL_READBACK_FIXTURE,
  NOW,
  PROVIDER_NOT_CONFIGURED,
  PROVIDER_SCRIPTED_OUTCOME,
  PROVIDER_STUB,
  RETENTION_POLICY,
  SANDBOX_APPROVAL_FIXTURE,
  SANDBOX_BINDING,
  clone,
  h,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.fixtures.mjs';
import {
  diagnosticRequestDigest,
  evaluateSandboxBinding,
  evaluateTracePrivacyAndRetention,
  reduceWorkloadIdentity,
  sandboxBoundaryDigest,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/evaluators.mjs';
import { runDeterministicProviderStub } from '../../../../fixtures/productAssurance/systemic/agentBoundary/provider-stub.mjs';

function identityDecision() {
  return reduceWorkloadIdentity({
    configurationState: 'SYNTHETIC_ONLY',
    events: ACTIVE_IDENTITY_EVENTS,
    expectedBindingId: SANDBOX_BINDING.bindingId,
    expectedProviderId: SANDBOX_BINDING.providerId,
    expectedEnvironment: SANDBOX_BINDING.environment,
    expectedAudience: SANDBOX_BINDING.workloadAudience,
    expectedSubjectDigest: SANDBOX_BINDING.workloadSubjectDigest,
    nowMs: NOW,
  });
}

function traceDecision() {
  return evaluateTracePrivacyAndRetention({
    trace: DIAGNOSTIC_TRACE,
    policy: RETENTION_POLICY,
    nowMs: NOW,
  });
}

function sandboxDecision() {
  const identity = identityDecision();
  const trace = traceDecision();
  return evaluateSandboxBinding({
    binding: SANDBOX_BINDING,
    request: DIAGNOSTIC_REQUEST,
    identityEvidence: { events: ACTIVE_IDENTITY_EVENTS },
    traceEvidence: { trace: DIAGNOSTIC_TRACE, policy: RETENTION_POLICY },
    identityDecision: identity,
    privacyDecision: trace,
    retentionDecision: trace,
    killDecision: KILL_READBACK_FIXTURE,
    approvalDecision: SANDBOX_APPROVAL_FIXTURE,
    nowMs: NOW,
  });
}

function runStub(overrides = {}) {
  return runDeterministicProviderStub({
    provider: PROVIDER_STUB,
    requestDigest: diagnosticRequestDigest(DIAGNOSTIC_REQUEST),
    boundaryDecision: sandboxDecision(),
    identityDecision: identityDecision(),
    traceDecision: traceDecision(),
    scriptedOutcome: PROVIDER_SCRIPTED_OUTCOME,
    nowMs: NOW,
    ...overrides,
  });
}

test('provider stub binds the exact provider, model, version, and policy from the sealed sandbox decision', () => {
  const boundary = sandboxDecision();
  const result = runStub({ boundaryDecision: boundary });

  assert.equal(boundary.status, 'PASS');
  assert.equal(boundary.modelId, PROVIDER_STUB.modelId);
  assert.equal(boundary.modelVersion, PROVIDER_STUB.modelVersion);
  assert.equal(result.status, 'PASS');
  assert.equal(result.providerId, PROVIDER_STUB.providerId);
  assert.equal(result.modelId, PROVIDER_STUB.modelId);
  assert.equal(result.modelVersion, PROVIDER_STUB.modelVersion);
  assert.equal(result.policyRevision, PROVIDER_STUB.policyRevision);
  assert.equal(result.allowed, false);
  assert.equal(result.externalCallAttempted, false);
  assert.equal(result.operationalAuthorityEffect, 'NONE');
});

test('provider stub rejects every provider descriptor mismatch independently', () => {
  const cases = [
    ['providerId', 'provider.stub.other'],
    ['modelId', 'model.stub.other'],
    ['modelVersion', 'fixture-v2'],
    ['policyRevision', 'diagnostic-boundary.v2'],
  ];

  for (const [field, value] of cases) {
    const provider = { ...PROVIDER_STUB, [field]: value };
    const result = runStub({ provider });
    assert.equal(result.status, 'FAIL', field);
    assert.equal(result.allowed, false, field);
    assert.equal(result.externalCallAttempted, false, field);
    assert.ok(result.reasonCodes.includes('PROVIDER_BOUNDARY_BINDING_MISMATCH'), field);
  }

  const openDescriptor = runStub({ provider: { ...PROVIDER_STUB, unexpectedField: true } });
  assert.equal(openDescriptor.status, 'FAIL');
  assert.ok(openDescriptor.reasonCodes.includes('PROVIDER_DESCRIPTOR_SCHEMA_REJECTED'));
});

test('provider stub rejects future, dirty, or digest-tampered sandbox PASS envelopes', () => {
  const boundary = sandboxDecision();
  const cases = [
    { ...boundary, evaluatedAtMs: NOW + 1 },
    { ...boundary, reasonCodes: ['FORGED_PASS'] },
    { ...boundary, operationalAuthorityEffect: 'MUTATED' },
    { ...boundary, evidenceRefs: [] },
    { ...boundary, boundaryDigest: h('tampered-sandbox-boundary') },
  ];

  for (const boundaryDecision of cases) {
    const result = runStub({ boundaryDecision });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.allowed, false);
    assert.equal(result.externalCallAttempted, false);
    assert.ok(result.reasonCodes.includes('SANDBOX_BINDING_DID_NOT_ALLOW_STUB'));
  }

  const widened = {
    ...boundary,
    capabilities: [...boundary.capabilities, 'WITHDRAW'],
    maxCalls: 1_000,
  };
  widened.boundaryDigest = sandboxBoundaryDigest(widened);
  const highOrdinal = clone(PROVIDER_SCRIPTED_OUTCOME);
  highOrdinal.callOrdinal = 1_000;
  const widenedResult = runStub({ boundaryDecision: widened, scriptedOutcome: highOrdinal });
  assert.equal(widenedResult.status, 'FAIL');
  assert.ok(widenedResult.reasonCodes.includes('SANDBOX_BINDING_DID_NOT_ALLOW_STUB'));
});

test('provider hardening preserves the closed deterministic typed-output contract', () => {
  const scriptedOutcome = clone(PROVIDER_SCRIPTED_OUTCOME);
  scriptedOutcome.typedOutput.modelVersion = 'unbound-output-field';
  const result = runStub({ scriptedOutcome });

  assert.equal(result.status, 'FAIL');
  assert.equal(result.disposition, 'STUB_RESPONSE_REJECTED');
  assert.equal(result.allowed, false);
  assert.equal(result.toolExecuted, false);
  assert.ok(result.reasonCodes.includes('STUB_TYPED_OUTPUT_SCHEMA_REJECTED'));

  const incoherent = clone(PROVIDER_SCRIPTED_OUTCOME);
  incoherent.typedOutput.disposition = 'EXPLAIN_ONLY';
  const incoherentResult = runStub({ scriptedOutcome: incoherent });
  assert.equal(incoherentResult.status, 'FAIL');
  assert.ok(incoherentResult.reasonCodes.includes('STUB_TYPED_OUTPUT_SCHEMA_REJECTED'));
});

test('NOT_CONFIGURED remains valid only as a complete provider-fact absence state', () => {
  const absent = runStub({ provider: PROVIDER_NOT_CONFIGURED });
  assert.equal(absent.status, 'UNKNOWN');
  assert.equal(absent.disposition, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.equal(absent.productReadinessImpact, 'NONE');

  const invented = runStub({ provider: { ...PROVIDER_NOT_CONFIGURED, modelId: 'invented-model' } });
  assert.equal(invented.status, 'FAIL');
  assert.equal(invented.allowed, false);
  assert.ok(invented.reasonCodes.includes('PROVIDER_NOT_CONFIGURED_FACTS_INVALID'));
});
