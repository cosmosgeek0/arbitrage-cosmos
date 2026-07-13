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
  diagnosticKillReadbackDigest,
  diagnosticRequestDigest,
  diagnosticTracePayloadDigest,
  evaluateSandboxBinding,
  evaluateTracePrivacyAndRetention,
  reduceWorkloadIdentity,
  workloadIdentityEventEvidenceHash,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/evaluators.mjs';
import { appendChainDigest } from '../../../../fixtures/productAssurance/systemic/agentBoundary/canonical.mjs';
import { runDeterministicProviderStub } from '../../../../fixtures/productAssurance/systemic/agentBoundary/provider-stub.mjs';

function activeIdentity(events = ACTIVE_IDENTITY_EVENTS, over = {}) {
  return reduceWorkloadIdentity({
    configurationState: 'SYNTHETIC_ONLY',
    events,
    expectedBindingId: SANDBOX_BINDING.bindingId,
    expectedProviderId: SANDBOX_BINDING.providerId,
    expectedEnvironment: SANDBOX_BINDING.environment,
    expectedAudience: SANDBOX_BINDING.workloadAudience,
    expectedSubjectDigest: SANDBOX_BINDING.workloadSubjectDigest,
    nowMs: NOW,
    ...over,
  });
}

function sealIdentityEvent(event) {
  const { evidenceHash: _oldEvidenceHash, ...content } = event;
  return { ...content, evidenceHash: workloadIdentityEventEvidenceHash(content) };
}

function traceDecision() {
  return evaluateTracePrivacyAndRetention({ trace: DIAGNOSTIC_TRACE, policy: RETENTION_POLICY, nowMs: NOW });
}

function boundary(over = {}) {
  const trace = traceDecision();
  return evaluateSandboxBinding({
    binding: SANDBOX_BINDING,
    request: DIAGNOSTIC_REQUEST,
    identityEvidence: { events: ACTIVE_IDENTITY_EVENTS },
    traceEvidence: { trace: DIAGNOSTIC_TRACE, policy: RETENTION_POLICY },
    identityDecision: activeIdentity(),
    privacyDecision: trace,
    retentionDecision: trace,
    killDecision: KILL_READBACK_FIXTURE,
    approvalDecision: SANDBOX_APPROVAL_FIXTURE,
    nowMs: NOW,
    ...over,
  });
}

function killReadback(overrides = {}) {
  const readback = { ...KILL_READBACK_FIXTURE, ...overrides };
  return { ...readback, evidenceDigest: diagnosticKillReadbackDigest(readback) };
}

function stub(over = {}) {
  const requestDigest = diagnosticRequestDigest(DIAGNOSTIC_REQUEST);
  return runDeterministicProviderStub({
    provider: PROVIDER_STUB,
    requestDigest,
    boundaryDecision: boundary(),
    identityDecision: activeIdentity(),
    traceDecision: traceDecision(),
    scriptedOutcome: PROVIDER_SCRIPTED_OUTCOME,
    nowMs: NOW,
    ...over,
  });
}

test('workload identity lifecycle accepts exact active synthetic evidence', () => {
  const first = activeIdentity();
  const second = activeIdentity(clone(ACTIVE_IDENTITY_EVENTS));
  assert.equal(first.status, 'PASS');
  assert.equal(first.disposition, 'IDENTITY_ACTIVE');
  assert.equal(first.identityState, 'ACTIVE');
  assert.equal(first.environment, SANDBOX_BINDING.environment);
  assert.equal(first.decisionKind, 'WORKLOAD_IDENTITY');
  assert.match(first.sourceEvidenceDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(first, second);
});

test('NOT_CONFIGURED is valid, visible, and changes no deterministic product authority', () => {
  const result = reduceWorkloadIdentity({
    configurationState: 'NOT_CONFIGURED',
    events: [],
    expectedBindingId: SANDBOX_BINDING.bindingId,
    expectedProviderId: SANDBOX_BINDING.providerId,
    expectedEnvironment: SANDBOX_BINDING.environment,
    expectedAudience: SANDBOX_BINDING.workloadAudience,
    expectedSubjectDigest: SANDBOX_BINDING.workloadSubjectDigest,
    nowMs: NOW,
  });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.disposition, 'NOT_CONFIGURED');
  assert.equal(result.allowed, false);
  assert.equal(result.productReadinessImpact, 'NONE');
  assert.equal(result.diagnosticAuthorityEffect, 'NONE');
});

test('identity sequence, binding, environment, audience, and capability remain generation-pinned', () => {
  const cases = [
    ['IDENTITY_SEQUENCE_GAP', (events) => { events[1].sequence = 3; }],
    ['IDENTITY_BINDING_MISMATCH', (events) => { events[1].bindingId = 'sandbox-binding.other'; }],
    ['IDENTITY_ENVIRONMENT_MISMATCH', (events) => { events[1].environment = 'other-environment'; }],
    ['IDENTITY_AUDIENCE_MISMATCH', (events) => { events[1].audience = 'other-audience'; }],
    ['IDENTITY_SCOPE_CHANGE_ON_ROTATION', (events) => { events[1].capabilityDigest = h('changed-capability'); }],
    ['IDENTITY_SAME_GENERATION_FACT_CHANGED', (events) => { events[1].subjectDigest = h('changed-subject'); }],
  ];
  for (const [reason, mutate] of cases) {
    const events = clone(ACTIVE_IDENTITY_EVENTS);
    mutate(events);
    assert.ok(activeIdentity(events).reasonCodes.includes(reason), reason);
  }
});

test('identity events reject unsupported schema, empty identity, and invalid lifetime order', () => {
  const cases = [
    ['IDENTITY_EVENT_SCHEMA_UNSUPPORTED', (events) => { events[0].version = 2; }],
    ['IDENTITY_EVENT_IDENTITY_INVALID', (events) => { events[1].identityRef = ''; }],
    ['IDENTITY_LIFETIME_ORDER_INVALID', (events) => { events.forEach((event) => { event.rotationDueAtMs = event.expiresAtMs + 1; }); }],
    ['IDENTITY_EVIDENCE_HASH_REUSED', (events) => { events[1].evidenceHash = events[0].evidenceHash; }],
  ];
  for (const [reason, mutate] of cases) {
    const events = clone(ACTIVE_IDENTITY_EVENTS);
    mutate(events);
    const result = activeIdentity(events);
    assert.equal(result.status, 'FAIL', reason);
    assert.ok(result.reasonCodes.includes(reason), reason);
  }
});

test('ROTATED requires a one-step generation advance and cannot widen capability', () => {
  const rotating = clone(ACTIVE_IDENTITY_EVENTS);
  rotating.push(sealIdentityEvent({ ...rotating[1], sequence: 3, type: 'ROTATION_DUE', observedAtMs: NOW - 6_000 }));
  rotating.push(sealIdentityEvent({ ...rotating[1], sequence: 4, type: 'ROTATION_STARTED', observedAtMs: NOW - 5_000 }));

  const sameGeneration = clone(rotating);
  sameGeneration.push(sealIdentityEvent({ ...sameGeneration[1], sequence: 5, type: 'ROTATED', observedAtMs: NOW - 4_000 }));
  assert.ok(activeIdentity(sameGeneration).reasonCodes.includes('IDENTITY_ROTATION_GENERATION_NOT_ADVANCED'));

  const widened = clone(rotating);
  widened.push(sealIdentityEvent({ ...widened[1], sequence: 5, type: 'ROTATED', generation: 2, subjectDigest: h('rotated-subject'), capabilityDigest: h('widened-capability'), observedAtMs: NOW - 4_000 }));
  assert.ok(activeIdentity(widened).reasonCodes.includes('IDENTITY_SCOPE_CHANGE_ON_ROTATION'));

  const valid = clone(rotating);
  valid.push(sealIdentityEvent({ ...valid[1], sequence: 5, type: 'ROTATED', generation: 2, subjectDigest: h('rotated-subject'), notBeforeMs: NOW - 4_000, rotationDueAtMs: NOW + 120_000, expiresAtMs: NOW + 240_000, observedAtMs: NOW - 4_000 }));
  const rotatedIdentity = activeIdentity(valid, { expectedSubjectDigest: h('rotated-subject') });
  assert.equal(rotatedIdentity.status, 'PASS');
  assert.equal(rotatedIdentity.generation, 2);
});

test('revocation and expiry immediately block optional diagnostic eligibility', () => {
  const revoked = clone(ACTIVE_IDENTITY_EVENTS);
  revoked.push(sealIdentityEvent({ ...revoked[1], sequence: 3, type: 'REVOKED', observedAtMs: NOW - 1_000 }));
  assert.equal(activeIdentity(revoked).identityState, 'REVOKED');
  assert.equal(activeIdentity(revoked).status, 'FAIL');

  const expired = clone(ACTIVE_IDENTITY_EVENTS).map((event) => sealIdentityEvent({
    ...event,
    rotationDueAtMs: NOW - 1,
    expiresAtMs: NOW,
  }));
  assert.equal(activeIdentity(expired).identityState, 'EXPIRED');
});

test('exact coherent binding permits only the local deterministic stub', () => {
  const result = boundary();
  assert.equal(result.status, 'PASS');
  assert.equal(result.disposition, 'ALLOW_DETERMINISTIC_STUB');
  assert.equal(result.allowed, true);
  assert.equal(result.stubEligible, true);
  assert.equal(result.decisionKind, 'SANDBOX_BINDING');
  assert.equal(result.providerInvocationMode, 'DETERMINISTIC_STUB_ONLY');
  assert.equal(result.operationalAuthorityEffect, 'NONE');
  assert.equal(result.requestDigest, diagnosticRequestDigest(DIAGNOSTIC_REQUEST));
});

test('sandbox denies missing or noncanonical kill readback and most-restrictive kill states', () => {
  assert.ok(boundary({ killDecision: null }).reasonCodes.includes('DIAGNOSTIC_KILL_READBACK_INVALID'));
  for (const effectiveState of ['ENGAGED', 'UNKNOWN']) {
    const result = boundary({ killDecision: { ...KILL_READBACK_FIXTURE, effectiveState } });
    assert.equal(result.status, 'FAIL');
    assert.ok(result.reasonCodes.some((reason) => reason.startsWith('DIAGNOSTIC_KILL_')));
  }
  const wrongControl = { ...KILL_READBACK_FIXTURE, controlId: 'financial.kill' };
  assert.ok(boundary({ killDecision: wrongControl }).reasonCodes.includes('DIAGNOSTIC_KILL_READBACK_INVALID'));
  const stale = { ...KILL_READBACK_FIXTURE, evaluatedAtMs: NOW - SANDBOX_BINDING.killReadbackMaxAgeMs - 1 };
  assert.ok(boundary({ killDecision: stale }).reasonCodes.includes('DIAGNOSTIC_KILL_READBACK_INVALID'));

  const desiredEngaged = boundary({ killDecision: killReadback({ desiredState: 'ENGAGED', effectiveState: 'DISENGAGED' }) });
  assert.equal(desiredEngaged.status, 'FAIL');
  assert.ok(desiredEngaged.reasonCodes.includes('DIAGNOSTIC_KILL_ENGAGED'));

  const overlongFreshness = clone(SANDBOX_BINDING);
  overlongFreshness.killReadbackMaxAgeMs = 365 * 24 * 60 * 60 * 1_000;
  assert.ok(boundary({ binding: overlongFreshness }).reasonCodes.includes('DIAGNOSTIC_KILL_READBACK_INVALID'));
});

test('sandbox denies unlisted tools, forbidden capability, network, stale binding, and zero invocation budget', () => {
  const extraTool = clone(DIAGNOSTIC_REQUEST);
  extraTool.toolIds.push('fixture.arbitrary-shell');
  assert.ok(boundary({ request: extraTool }).reasonCodes.includes('REQUEST_TOOL_NOT_ALLOWLISTED'));

  const forbidden = clone(DIAGNOSTIC_REQUEST);
  forbidden.capabilities.push('CHANGE_RISK');
  assert.ok(boundary({ request: forbidden }).reasonCodes.includes('PERMANENT_AUTHORITY_BOUNDARY'));

  const networked = clone(SANDBOX_BINDING);
  networked.networkPolicy = 'ALLOWLIST';
  networked.egressAllowlist = ['provider.invalid'];
  assert.ok(boundary({ binding: networked }).reasonCodes.includes('NETWORK_NOT_DENY_ALL'));

  const expired = clone(SANDBOX_BINDING);
  expired.expiresAtMs = NOW;
  assert.ok(boundary({ binding: expired }).reasonCodes.includes('SANDBOX_BINDING_EXPIRED_OR_NOT_YET_VALID'));

  const zeroCalls = clone(DIAGNOSTIC_REQUEST);
  zeroCalls.budget.maxCalls = 0;
  assert.ok(boundary({ request: zeroCalls }).reasonCodes.includes('INVOCATION_CALL_BUDGET_EXHAUSTED'));
});

test('sandbox rejects forged prerequisite decisions, expired cached identity, and unbound base contract', () => {
  const forged = {
    status: 'PASS', providerId: SANDBOX_BINDING.providerId, bindingId: SANDBOX_BINDING.bindingId,
    identityRef: SANDBOX_BINDING.workloadIdentityRef, audience: SANDBOX_BINDING.workloadAudience,
    environment: SANDBOX_BINDING.environment, capabilityDigest: SANDBOX_BINDING.workloadCapabilityDigest,
    expiresAtMs: NOW + 1_000,
  };
  assert.ok(boundary({ identityDecision: forged }).reasonCodes.includes('WORKLOAD_IDENTITY_DECISION_ENVELOPE_INVALID'));
  assert.ok(boundary({ privacyDecision: forged }).reasonCodes.includes('TRACE_PRIVACY_DECISION_ENVELOPE_INVALID'));
  assert.ok(boundary({ retentionDecision: forged }).reasonCodes.includes('INDEPENDENT_RETENTION_DECISION_ENVELOPE_INVALID'));
  assert.ok(boundary({ approvalDecision: forged }).reasonCodes.includes('SANDBOX_EXACT_APPROVAL_EVIDENCE_INVALID'));

  const changedEvidence = clone(ACTIVE_IDENTITY_EVENTS);
  changedEvidence[1].subjectDigest = h('forged-identity-source');
  assert.ok(boundary({ identityEvidence: { events: changedEvidence } }).reasonCodes.includes('WORKLOAD_IDENTITY_RECOMPUTE_MISMATCH'));

  const missingTraceEvidence = boundary({ traceEvidence: null });
  assert.ok(missingTraceEvidence.reasonCodes.includes('TRACE_PRIVACY_RETENTION_RECOMPUTE_MISMATCH'));

  const expiredIdentity = { ...activeIdentity(), expiresAtMs: NOW };
  assert.ok(boundary({ identityDecision: expiredIdentity }).reasonCodes.includes('IDENTITY_EVIDENCE_EXPIRED'));

  const unbound = clone(DIAGNOSTIC_REQUEST);
  unbound.baseContractRef.reuseMode = 'LOCAL_REBUILD';
  assert.ok(boundary({ request: unbound }).reasonCodes.includes('SANDBOX_REQUEST_BASE_CONTRACT_UNBOUND'));

  const widenedApproval = clone(SANDBOX_APPROVAL_FIXTURE);
  widenedApproval.capabilities.push('CHANGE_RISK');
  assert.ok(boundary({ approvalDecision: widenedApproval }).reasonCodes.includes('SANDBOX_EXACT_APPROVAL_EVIDENCE_INVALID'));

  const expiredApproval = { ...SANDBOX_APPROVAL_FIXTURE, expiresAtMs: NOW };
  assert.ok(boundary({ approvalDecision: expiredApproval }).reasonCodes.includes('SANDBOX_EXACT_APPROVAL_EVIDENCE_INVALID'));

  for (const approvalDecision of [
    { ...SANDBOX_APPROVAL_FIXTURE, approverId: 'other-approver.fixture' },
    { ...SANDBOX_APPROVAL_FIXTURE, rollbackPlanDigest: h('other-rollback-plan') },
  ]) {
    assert.ok(boundary({ approvalDecision }).reasonCodes.includes('SANDBOX_EXACT_APPROVAL_EVIDENCE_INVALID'));
  }

  const replacedModel = clone(SANDBOX_BINDING);
  replacedModel.modelId = 'model.stub.unapproved';
  assert.ok(boundary({ binding: replacedModel }).reasonCodes.includes('SANDBOX_EXACT_APPROVAL_EVIDENCE_INVALID'));
});

test('closed deterministic provider stub returns evidence but never operational authority', () => {
  const first = stub();
  const second = stub({ provider: clone(PROVIDER_STUB), scriptedOutcome: clone(PROVIDER_SCRIPTED_OUTCOME) });
  assert.deepEqual(first, second);
  assert.equal(first.status, 'PASS');
  assert.equal(first.allowed, false);
  assert.equal(first.externalCallAttempted, false);
  assert.equal(first.toolExecuted, false);
  assert.equal(first.operationalAuthorityEffect, 'NONE');
  assert.equal(first.typedOutput.operationalAuthority, 'NONE');
});

test('provider stub rejects forged boundary, bad digest, stale boundary, and binding mismatch', () => {
  const requestDigest = diagnosticRequestDigest(DIAGNOSTIC_REQUEST);
  assert.equal(stub({ boundaryDecision: { status: 'PASS', disposition: 'ALLOW_DETERMINISTIC_STUB', allowed: true } }).status, 'FAIL');
  assert.equal(stub({ requestDigest: 'z'.repeat(64) }).status, 'FAIL');
  assert.equal(stub({ boundaryDecision: { ...boundary(), expiresAtMs: NOW } }).status, 'FAIL');
  assert.equal(stub({ provider: { ...PROVIDER_STUB, providerId: 'provider.other' } }).status, 'FAIL');
  assert.match(requestDigest, /^[a-f0-9]{64}$/);
});

test('provider stub rejects arbitrary, secret-bearing, authority-bearing, or over-budget typed output', () => {
  const cases = [
    { ...clone(PROVIDER_SCRIPTED_OUTCOME), extra: true },
    { ...clone(PROVIDER_SCRIPTED_OUTCOME), callOrdinal: 2 },
    { ...clone(PROVIDER_SCRIPTED_OUTCOME), typedOutput: { rawPrompt: 'x', operationalAuthority: 'LIVE' } },
    { ...clone(PROVIDER_SCRIPTED_OUTCOME), typedOutput: { ...clone(PROVIDER_SCRIPTED_OUTCOME.typedOutput), operationalAuthority: 'LIVE' } },
    { ...clone(PROVIDER_SCRIPTED_OUTCOME), typedOutput: { ...clone(PROVIDER_SCRIPTED_OUTCOME.typedOutput), capabilities: ['CHANGE_RISK'] } },
  ];
  for (const scriptedOutcome of cases) {
    const result = stub({ scriptedOutcome });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.allowed, false);
    assert.equal(result.externalCallAttempted, false);
  }
});

test('provider outage, cost exhaustion, and NOT_CONFIGURED remain diagnostic-only', () => {
  for (const provider of [
    { ...PROVIDER_STUB, posture: 'OUTAGE' },
    { ...PROVIDER_STUB, posture: 'COST_EXHAUSTED' },
    PROVIDER_NOT_CONFIGURED,
  ]) {
    const result = stub({ provider });
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.allowed, false);
    assert.equal(result.productReadinessImpact, 'NONE');
    assert.equal(result.externalCallAttempted, false);
  }
});

test('coherently rehashed identity swaps and cross-trace decision replay fail closed', () => {
  const swappedEvents = clone(ACTIVE_IDENTITY_EVENTS).map((event) => sealIdentityEvent({
    ...event,
    subjectDigest: h('identity-swapped-subject'),
  }));
  const swappedIdentity = activeIdentity(swappedEvents);
  assert.equal(swappedIdentity.status, 'FAIL');
  assert.ok(swappedIdentity.reasonCodes.includes('IDENTITY_SUBJECT_MISMATCH'));

  const replayedTrace = clone(DIAGNOSTIC_TRACE);
  replayedTrace.traceId = 'diagnostic-trace.replayed';
  const receipt = replayedTrace.retentionReceipts[0];
  receipt.payloadDigest = diagnosticTracePayloadDigest(replayedTrace);
  receipt.chainDigest = appendChainDigest(receipt);
  const replayedDecision = evaluateTracePrivacyAndRetention({ trace: replayedTrace, policy: RETENTION_POLICY, nowMs: NOW });
  assert.equal(replayedDecision.status, 'PASS');
  const rejected = boundary({ retentionDecision: replayedDecision, privacyDecision: replayedDecision });
  assert.equal(rejected.status, 'FAIL');
  assert.ok(rejected.reasonCodes.includes('TRACE_PRIVACY_RETENTION_RECOMPUTE_MISMATCH'));
});

test('sandbox input rejects raw secret material and every prerequisite PASS envelope is closed', () => {
  const secretRequest = clone(DIAGNOSTIC_REQUEST);
  secretRequest.requestId = 'sk-live-sandboxsecret123';
  const secretResult = boundary({ request: secretRequest });
  assert.equal(secretResult.status, 'FAIL');
  assert.ok(secretResult.reasonCodes.includes('SECRET_BEARING_FIELD_FORBIDDEN'));
  assert.doesNotMatch(JSON.stringify(secretResult), /sk-live-sandboxsecret123/);

  for (const [field, decision] of [
    ['identityDecision', { ...activeIdentity(), unexpected: true }],
    ['privacyDecision', { ...traceDecision(), unexpected: true }],
    ['retentionDecision', { ...traceDecision(), unexpected: true }],
  ]) {
    const result = boundary({ [field]: decision });
    assert.equal(result.status, 'FAIL', field);
    assert.equal(result.allowed, false, field);
    assert.ok(result.reasonCodes.some((reason) => reason.endsWith('DECISION_ENVELOPE_INVALID')), field);
  }
});

test('sandbox expiry is the earliest prerequisite expiry and never an optimistic binding expiry', () => {
  const result = boundary();
  assert.equal(result.status, 'PASS');
  assert.equal(result.expiresAtMs, NOW + SANDBOX_BINDING.killReadbackMaxAgeMs);
  assert.ok(result.expiresAtMs < SANDBOX_BINDING.expiresAtMs);
  assert.ok(result.expiresAtMs < SANDBOX_APPROVAL_FIXTURE.expiresAtMs);
});
