import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNetworkPermissionDenied, loadContracts } from './_network-denied-env.mjs';

const contracts = await loadContracts();

function providerRow(identityId, providerState) {
  const row = contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX.find(
    (candidate) => candidate.identityId === identityId && candidate.providerState === providerState,
  );
  assert.ok(row, `missing provider row for ${identityId}:${providerState}`);
  return row;
}

function transitionRequest({
  identityId = 'aiops-shadow-runtime-diagnostician',
  fromState = 'SUBSCRIPTION_CLAUDE_CODE_WORKER',
  toState = 'DIAGNOSTIC_PLANE_UNAVAILABLE',
  trigger = 'AUTH_FAILURE',
  nowMs = contracts.AI_OPS_ARTIFACT_CREATED_AT_MS,
  authorization = null,
} = {}) {
  const fromRow = providerRow(identityId, fromState);
  const toRow = providerRow(identityId, toState);
  return {
    identityId,
    providerMatrixRevision: contracts.AI_OPS_PROVIDER_MATRIX_REVISION,
    fromProviderRowId: fromRow.rowId,
    toProviderRowId: toRow.rowId,
    fromCredentialReference: fromRow.credentialReference,
    toCredentialReference: toRow.credentialReference,
    fromState,
    toState,
    fromBillingDomain: fromRow.billingDomain,
    toBillingDomain: toRow.billingDomain,
    trigger,
    nowMs,
    authorization,
  };
}

function ownerAuthorization(request) {
  return {
    authorizationId: 'synthetic-owner-authorization-1',
    identityId: request.identityId,
    providerMatrixRevision: request.providerMatrixRevision,
    fromProviderRowId: request.fromProviderRowId,
    toProviderRowId: request.toProviderRowId,
    fromCredentialReference: request.fromCredentialReference,
    toCredentialReference: request.toCredentialReference,
    fromBillingDomain: request.fromBillingDomain,
    toBillingDomain: request.toBillingDomain,
    previousRevision: 6,
    revision: 7,
    ownerSignatureReference: 'synthetic-signature-ref://owner-test-signature',
    approvalReceiptReference: 'approval-receipt-ref://synthetic-owner/7',
    readbackRevision: 7,
    expiresAtMs: request.nowMs + 60_000,
  };
}

test('all fourteen directive hard denials are closed and permanent', () => {
  assert.equal(contracts.AI_OPS_LIVE_EXECUTION_STATE, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
  assert.equal(contracts.AI_OPS_HARD_DENIALS.length, 14);
  assert.deepEqual(contracts.AI_OPS_HARD_DENIALS.map((row) => row.directiveRow), Array.from({ length: 14 }, (_, index) => index + 1));
  assert.equal(new Set(contracts.AI_OPS_HARD_DENIAL_IDS).size, 14);
  for (const row of contracts.AI_OPS_HARD_DENIALS) {
    assert.equal(row.actionClass, 'D');
    assert.equal(row.permanent, true);
    assert.ok(row.examples.length > 0);
  }
  for (const row of contracts.AI_OPS_CAPABILITY_MATRIX) {
    assert.equal(row.liveExecutionState, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
    assert.equal(row.moneyAuthority, 'NONE');
  }
});

test('AI Ops A-D is a distinct dialect and S6 letters are never cast', () => {
  assert.deepEqual(contracts.AI_OPS_ACTION_CLASS_DEFINITIONS.map((row) => row.actionClass), ['A', 'B', 'C', 'D']);
  assert.equal(contracts.AI_OPS_ACTION_CLASS_DEFINITIONS[0].eligibleActions.length, 10);
  assert.deepEqual(contracts.AI_OPS_ACTION_CLASS_DEFINITIONS[3].eligibleActions, contracts.AI_OPS_HARD_DENIAL_IDS);
  for (const sourceClass of ['A', 'B', 'C', 'D']) {
    const adapted = contracts.describeS6ClassAdaptation(sourceClass);
    assert.equal(adapted.directCastAllowed, false);
    assert.equal(adapted.targetClass, null);
    assert.ok(adapted.lossReasons.length >= 2);
  }
  assert.throws(() => contracts.describeS6ClassAdaptation('E'), /unsupported/);
});

test('three operational identities are isolated and advisor remains non-operational', () => {
  assert.deepEqual(contracts.validateIdentityAndProviderMatrix(), []);
  assert.equal(contracts.AI_OPS_IDENTITIES.length, 4);
  assert.equal(contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX.length, 16);
  const operational = contracts.AI_OPS_IDENTITIES.filter((row) => row.role !== 'RESEARCH_TRADE_CONTEXT_ADVISOR');
  assert.equal(operational.length, 3);
  for (const identity of operational) {
    assert.equal(identity.isolatedFromIdentityIds.length, 3);
    assert.equal(identity.credentialInheritance, 'DENIED');
    assert.equal(identity.crossRoleFallback, 'DENIED');
  }
  const advisor = contracts.AI_OPS_IDENTITIES.find((row) => row.role === 'RESEARCH_TRADE_CONTEXT_ADVISOR');
  assert.deepEqual(advisor.capabilityIds, []);
  const advisorRows = contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX.filter((row) => row.role === advisor.role);
  assert.equal(advisorRows.length, 1);
  assert.equal(advisorRows[0].providerState, 'NOT_CONFIGURED');
  assert.equal(advisorRows[0].credentialReference, null);
});

test('the provider vocabulary is exactly five states and unavailability is epistemically separate', () => {
  assert.deepEqual(contracts.AI_OPS_PROVIDER_STATES, [
    'NOT_CONFIGURED',
    'SUBSCRIPTION_CODEX_WORKER',
    'SUBSCRIPTION_CLAUDE_CODE_WORKER',
    'API_CONFIGURED',
    'DIAGNOSTIC_PLANE_UNAVAILABLE',
  ]);
  const unavailable = contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX.filter((row) => row.providerState === 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.equal(unavailable.length, 3);
  for (const row of unavailable) {
    assert.equal(row.disposition, 'UNAVAILABLE');
    assert.deepEqual(row.executableCapabilityIds, []);
    assert.equal(row.observedAuthMode, 'UNKNOWN');
  }
  for (const row of contracts.AI_OPS_PROVIDER_CREDENTIAL_MATRIX) {
    assert.deepEqual(row.executableCapabilityIds, []);
    assert.ok(row.observedAuthMode === 'NONE' || row.observedAuthMode === 'UNKNOWN');
    if (row.providerId !== null) {
      assert.match(row.providerId, /^SYNTHETIC_/);
      assert.equal(row.disposition, 'SYNTHETIC_FIXTURE_ONLY');
      assert.equal(row.maximumCostMicrounits, null);
    }
  }
});

test('every failure trigger requires an honest unavailable candidate and never silently switches billing', () => {
  for (const trigger of ['AUTH_FAILURE', 'QUOTA_EXHAUSTED', 'ENVIRONMENT_CREDENTIAL_DETECTED', 'DIAGNOSTIC_FAILURE']) {
    for (const toState of ['SUBSCRIPTION_CLAUDE_CODE_WORKER', 'API_CONFIGURED']) {
      const decision = contracts.evaluateProviderTransition(transitionRequest({ trigger, toState }));
      assert.equal(decision.allowed, false);
      assert.equal(decision.candidateValidatedForPortRecheck, false);
      assert.equal(decision.billingSwitchPerformed, false);
      assert.equal(decision.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
      assert.equal(decision.state, 'SHADOW_SPECULATIVE');
      assert.ok(decision.reasonCodes.includes('FAILURE_TRIGGER_REQUIRES_DIAGNOSTIC_PLANE_UNAVAILABLE'));
    }
    const unavailableCandidate = contracts.evaluateProviderTransition(transitionRequest({ trigger }));
    assert.equal(unavailableCandidate.allowed, false);
    assert.equal(unavailableCandidate.candidateValidatedForPortRecheck, true);
    assert.equal(unavailableCandidate.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
    assert.equal(unavailableCandidate.billingSwitchPerformed, false);
    assert.equal(unavailableCandidate.state, 'SHADOW_SPECULATIVE');
    assert.ok(unavailableCandidate.reasonCodes.includes(`TRIGGER_${trigger}_REQUIRES_UNAVAILABLE`));
  }
});

test('malformed transition enums, shapes and authorization field types fail closed without throwing', () => {
  const valid = transitionRequest();
  for (const malformed of [
    null,
    {},
    { ...valid, fromState: 'EVIL' },
    { ...valid, toState: 'EVIL' },
    { ...valid, fromBillingDomain: 'EVIL' },
    { ...valid, trigger: 'EVIL' },
    { ...valid, providerMatrixRevision: 2 },
    { ...valid, extra: true },
    { ...valid, authorization: 17 },
    { ...valid, authorization: { ownerSignatureReference: null } },
  ]) {
    let decision;
    assert.doesNotThrow(() => {
      decision = contracts.evaluateProviderTransition(malformed);
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.candidateValidatedForPortRecheck, false);
    assert.equal(decision.billingSwitchPerformed, false);
    assert.equal(decision.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
    assert.equal(decision.state, 'SHADOW_SPECULATIVE');
    assert.ok(decision.reasonCodes.includes('TRANSITION_REQUEST_SCHEMA_INVALID'));
  }
  let getterCalls = 0;
  const accessor = Object.defineProperty({ ...valid }, 'trigger', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'AUTH_FAILURE';
    },
  });
  const accessorDecision = contracts.evaluateProviderTransition(accessor);
  assert.equal(accessorDecision.candidateValidatedForPortRecheck, false);
  assert.ok(accessorDecision.reasonCodes.includes('TRANSITION_REQUEST_SCHEMA_INVALID'));
  assert.equal(getterCalls, 0, 'provider transition accessors must not be invoked');
});

test('even an exact synthetic authorization cannot validate a provider-route change before owner seams are mounted', () => {
  const unsignedRequest = transitionRequest({
    identityId: 'aiops-shadow-engineering-repair-worker',
    fromState: 'NOT_CONFIGURED',
    toState: 'API_CONFIGURED',
    trigger: 'OWNER_REQUEST',
  });
  const request = { ...unsignedRequest, authorization: ownerAuthorization(unsignedRequest) };
  const verifier = {
    verify(authorization, exactBytes) {
      assert.equal(new TextDecoder().decode(exactBytes), contracts.canonicalPolicyJson(authorization));
      return true;
    },
  };
  const validated = contracts.evaluateProviderTransition(request, verifier);
  assert.equal(validated.allowed, false);
  assert.equal(validated.candidateValidatedForPortRecheck, false);
  assert.equal(validated.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.equal(validated.billingSwitchPerformed, false);
  assert.equal(validated.authorityCreated, false);
  assert.equal(validated.state, 'SHADOW_SPECULATIVE');
  for (const reason of [
    'AIOPS_IR_AUTH_004_OWNER_MOUNT_REQUIRED',
    'AIOPS_IR_APPROVAL_023_ONE_USE_RECEIPT_REQUIRED',
    'OWNER_TRUSTED_TIME_AND_CURRENT_REVISION_READBACK_REQUIRED',
    'SHADOW_SPECULATIVE_CANNOT_PERFORM_PROVIDER_OR_BILLING_SWITCH',
  ]) assert.ok(validated.reasonCodes.includes(reason));

  const replayed = contracts.evaluateProviderTransition(request, verifier);
  assert.deepEqual(replayed, validated);
  const staleAdjacent = contracts.evaluateProviderTransition({
    ...request,
    authorization: {
      ...request.authorization,
      previousRevision: 5,
      revision: 6,
      readbackRevision: 6,
    },
  }, verifier);
  assert.equal(staleAdjacent.candidateValidatedForPortRecheck, false);
  assert.equal(staleAdjacent.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  const rolledBackClock = contracts.evaluateProviderTransition({
    ...request,
    nowMs: request.nowMs - 1,
  }, verifier);
  assert.equal(rolledBackClock.candidateValidatedForPortRecheck, false);
  assert.equal(rolledBackClock.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  const stale = contracts.evaluateProviderTransition({ ...request, authorization: { ...request.authorization, revision: 8 } }, verifier);
  assert.equal(stale.allowed, false);
  assert.equal(stale.candidateValidatedForPortRecheck, false);
  assert.equal(stale.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.ok(stale.reasonCodes.includes('EXPLICIT_OWNER_PROVIDER_AND_BILLING_AUTHORIZATION_REQUIRED'));
  const expiresAtBoundary = contracts.evaluateProviderTransition({
    ...request,
    authorization: { ...request.authorization, expiresAtMs: request.nowMs },
  }, verifier);
  assert.equal(expiresAtBoundary.candidateValidatedForPortRecheck, false);
  assert.equal(expiresAtBoundary.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.ok(expiresAtBoundary.reasonCodes.includes('EXPLICIT_OWNER_PROVIDER_AND_BILLING_AUTHORIZATION_REQUIRED'));
  const unsafeRevision = contracts.evaluateProviderTransition({
    ...request,
    authorization: {
      ...request.authorization,
      previousRevision: Number.MAX_SAFE_INTEGER,
      revision: Number.MAX_SAFE_INTEGER + 1,
      readbackRevision: Number.MAX_SAFE_INTEGER + 1,
    },
  }, verifier);
  assert.equal(unsafeRevision.candidateValidatedForPortRecheck, false);
  assert.equal(unsafeRevision.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  const selfAttested = contracts.evaluateProviderTransition(request, null);
  assert.equal(selfAttested.allowed, false);
  assert.equal(selfAttested.candidateValidatedForPortRecheck, false);
  const tupleSpoof = contracts.evaluateProviderTransition({ ...request, toBillingDomain: 'NONE' }, verifier);
  assert.equal(tupleSpoof.allowed, false);
  assert.equal(tupleSpoof.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.ok(tupleSpoof.reasonCodes.includes('PROVIDER_MATRIX_BINDING_INVALID'));
  const malformedAuthorization = contracts.evaluateProviderTransition({
    ...request,
    authorization: { ...request.authorization, ownerSignatureReference: null },
  }, verifier);
  assert.equal(malformedAuthorization.allowed, false);
  assert.equal(malformedAuthorization.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.ok(malformedAuthorization.reasonCodes.includes('EXPLICIT_OWNER_PROVIDER_AND_BILLING_AUTHORIZATION_REQUIRED'));
  for (const [field, value] of [
    ['authorizationId', 'synthetic-owner-authorization-'],
    ['ownerSignatureReference', 'synthetic-signature-ref://'],
    ['approvalReceiptReference', 'approval-receipt-ref://'],
  ]) {
    const prefixOnly = contracts.evaluateProviderTransition({
      ...request,
      authorization: { ...request.authorization, [field]: value },
    }, verifier);
    assert.equal(prefixOnly.candidateValidatedForPortRecheck, false);
    assert.equal(prefixOnly.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
    assert.ok(prefixOnly.reasonCodes.includes('EXPLICIT_OWNER_PROVIDER_AND_BILLING_AUTHORIZATION_REQUIRED'));
  }
  assertNetworkPermissionDenied();
});

test('matrix revision, row and credential bindings prevent same-domain account substitution', () => {
  const sameRoute = transitionRequest({
    fromState: 'SUBSCRIPTION_CODEX_WORKER',
    toState: 'SUBSCRIPTION_CODEX_WORKER',
    trigger: 'OWNER_REQUEST',
  });
  const unchanged = contracts.evaluateProviderTransition(sameRoute);
  assert.equal(unchanged.allowed, false);
  assert.equal(unchanged.candidateValidatedForPortRecheck, true);
  assert.equal(unchanged.billingSwitchPerformed, false);
  assert.equal(unchanged.state, 'SHADOW_SPECULATIVE');

  for (const spoofed of [
    { ...sameRoute, toCredentialReference: 'synthetic-ref://openai-codex/silent-other-account' },
    { ...sameRoute, toProviderRowId: 'aiops-shadow-runtime-diagnostician:SUBSCRIPTION_CODEX_WORKER:silent-other-route' },
    { ...sameRoute, providerMatrixRevision: 2 },
  ]) {
    const decision = contracts.evaluateProviderTransition(spoofed);
    assert.equal(decision.allowed, false);
    assert.equal(decision.candidateValidatedForPortRecheck, false);
    assert.equal(decision.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
    assert.equal(decision.billingSwitchPerformed, false);
  }

  const routedRequest = transitionRequest({
    fromState: 'SUBSCRIPTION_CODEX_WORKER',
    toState: 'SUBSCRIPTION_CLAUDE_CODE_WORKER',
    trigger: 'OWNER_REQUEST',
  });
  const mismatchedAuthorization = ownerAuthorization(routedRequest);
  const decision = contracts.evaluateProviderTransition({
    ...routedRequest,
    authorization: {
      ...mismatchedAuthorization,
      toProviderRowId: routedRequest.fromProviderRowId,
      toCredentialReference: routedRequest.fromCredentialReference,
    },
  }, { verify: () => true });
  assert.equal(decision.allowed, false);
  assert.equal(decision.candidateValidatedForPortRecheck, false);
  assert.equal(decision.nextState, 'DIAGNOSTIC_PLANE_UNAVAILABLE');
  assert.ok(decision.reasonCodes.includes('EXPLICIT_OWNER_PROVIDER_AND_BILLING_AUTHORIZATION_REQUIRED'));
});
