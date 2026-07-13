import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ACTIVE_IDENTITY_EVENTS,
  CLASS_CANDIDATES,
  CLASS_POLICIES,
  CORPUS_DEDUP_REGISTRY,
  CORPUS_ITEM,
  DIAGNOSTIC_REQUEST,
  DIAGNOSTIC_TRACE,
  KILL_CONTROL_VIEW,
  KILL_READBACK_FIXTURE,
  NOW,
  OWNER_SNAPSHOT,
  PROVIDER_NOT_CONFIGURED,
  PROVIDER_SCRIPTED_OUTCOME,
  PROVIDER_STUB,
  REPAIR_EVIDENCE,
  REPAIR_POLICY,
  RETENTION_POLICY,
  RUN_VIEW_INPUT,
  SANDBOX_APPROVAL_FIXTURE,
  SANDBOX_BINDING,
  clone,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.fixtures.mjs';
import { findForbiddenKeys } from '../../../../fixtures/productAssurance/systemic/agentBoundary/canonical.mjs';
import {
  diagnosticRequestDigest,
  evaluateCorpusItemGovernance,
  evaluateRepairEvidence,
  evaluateSandboxBinding,
  evaluateSelfCorrectionPromotion,
  evaluateTracePrivacyAndRetention,
  reduceWorkloadIdentity,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/evaluators.mjs';
import { runDeterministicProviderStub } from '../../../../fixtures/productAssurance/systemic/agentBoundary/provider-stub.mjs';
import { projectDiagnosticWorkerView } from '../../../../fixtures/productAssurance/systemic/agentBoundary/view-models.mjs';
import { createSchemaValidator } from './schema-validator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewSchema = JSON.parse(readFileSync(path.join(here, '../../../../fixtures/productAssurance/systemic/agentBoundary/diagnostic-worker-view-v1.schema.json'), 'utf8'));
const boundarySchema = JSON.parse(readFileSync(path.join(here, '../../../../fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json'), 'utf8'));
const insertionRows = JSON.parse(readFileSync(path.join(here, '../../../../fixtures/productAssurance/systemic/agentBoundary/ASSURANCE_INSERTION_REQUEST_DRAFT.json'), 'utf8'));
const validateView = createSchemaValidator(viewSchema);
const validateBoundary = createSchemaValidator(boundarySchema);

function decisions(over = {}) {
  const workloadIdentityDecision = reduceWorkloadIdentity({
    configurationState: 'SYNTHETIC_ONLY',
    events: ACTIVE_IDENTITY_EVENTS,
    expectedBindingId: SANDBOX_BINDING.bindingId,
    expectedProviderId: SANDBOX_BINDING.providerId,
    expectedEnvironment: SANDBOX_BINDING.environment,
    expectedAudience: SANDBOX_BINDING.workloadAudience,
    expectedSubjectDigest: SANDBOX_BINDING.workloadSubjectDigest,
    nowMs: NOW,
  });
  const traceDecision = evaluateTracePrivacyAndRetention({ trace: DIAGNOSTIC_TRACE, policy: RETENTION_POLICY, nowMs: NOW });
  const sandboxDecision = evaluateSandboxBinding({
    binding: SANDBOX_BINDING,
    request: DIAGNOSTIC_REQUEST,
    identityEvidence: { events: ACTIVE_IDENTITY_EVENTS },
    traceEvidence: { trace: DIAGNOSTIC_TRACE, policy: RETENTION_POLICY },
    identityDecision: workloadIdentityDecision,
    privacyDecision: traceDecision,
    retentionDecision: traceDecision,
    killDecision: KILL_READBACK_FIXTURE,
    approvalDecision: SANDBOX_APPROVAL_FIXTURE,
    nowMs: NOW,
  });
  const requestDigest = diagnosticRequestDigest(DIAGNOSTIC_REQUEST);
  const providerDecision = runDeterministicProviderStub({
    provider: PROVIDER_STUB,
    requestDigest,
    boundaryDecision: sandboxDecision,
    identityDecision: workloadIdentityDecision,
    traceDecision,
    scriptedOutcome: PROVIDER_SCRIPTED_OUTCOME,
    nowMs: NOW,
  });
  const repairDecision = evaluateRepairEvidence({
    bundle: REPAIR_EVIDENCE,
    policy: REPAIR_POLICY,
    acceptedPolicyEvidenceDigest: REPAIR_POLICY.evidenceDigest,
    traceDecision,
    nowMs: NOW,
  });
  const corpusDecision = evaluateCorpusItemGovernance({
    item: CORPUS_ITEM,
    retentionDecision: traceDecision,
    dedupRegistry: CORPUS_DEDUP_REGISTRY,
    nowMs: NOW,
  });
  const promotionDecision = evaluateSelfCorrectionPromotion({
    candidate: CLASS_CANDIDATES.C,
    policy: CLASS_POLICIES.C,
    acceptedPolicyEvidenceDigest: CLASS_POLICIES.C.evidenceDigest,
    traceDecision,
    repairDecision,
    corpusDecision,
    nowMs: NOW,
  });
  return { workloadIdentityDecision, traceDecision, sandboxDecision, providerDecision, repairDecision, corpusDecision, promotionDecision, ...over };
}

function view(over = {}) {
  return projectDiagnosticWorkerView({
    sourceState: 'SYNTHETIC_ONLY',
    wiringState: 'PENDING_BACKEND:PROJECT_DIAGNOSTIC_WORKER_ASSURANCE_FIELDS',
    ownerSnapshot: OWNER_SNAPSHOT,
    provider: PROVIDER_STUB,
    ...decisions(),
    killControl: KILL_CONTROL_VIEW,
    run: RUN_VIEW_INPUT,
    nowMs: NOW,
    ...over,
  });
}

test('render-neutral view is closed, synthetic, immutable, lifecycle-separated, and authority-free', () => {
  const projected = view();
  assert.deepEqual(validateView(viewSchema, projected), []);
  assert.equal(projected.sourceState, 'SYNTHETIC_ONLY');
  assert.equal(projected.planeAvailability, 'AVAILABLE');
  assert.equal(projected.assuranceStatus, 'PASS');
  assert.equal(projected.operatingDisposition, 'ELIGIBLE_FOR_STUB_EVIDENCE');
  assert.equal(projected.observedLifecycle, 'READY');
  assert.equal(projected.capability, 'SYNTHETIC');
  assert.equal(projected.productReadinessImpact, 'NONE');
  assert.equal(projected.tradeReadinessImpact, 'NONE');
  assert.equal(projected.executionAuthorityEffect, 'NONE');
  assert.equal(projected.selfCorrection.operationalActionAllowed, false);
  assert.equal(projected.repairEvidence.recoveryDeclared, false);
  assert.equal(projected.killControl.selfReenableAllowed, false);
  assert.equal(Object.isFrozen(projected), true);
  assert.deepEqual(findForbiddenKeys(projected), []);
});

test('cockpit carries canonical owner, freshness, revision, proposal, verifier, and quiet-period fields', () => {
  const projected = view();
  assert.equal(projected.projectionId, OWNER_SNAPSHOT.projectionId);
  assert.equal(projected.owner, OWNER_SNAPSHOT.owner);
  assert.deepEqual(projected.dependencies, [...OWNER_SNAPSHOT.dependencies].sort());
  assert.equal(projected.freshness.state, 'FRESH');
  assert.equal(projected.sourceRealm, 'FIXTURE');
  assert.equal(projected.configRevision, OWNER_SNAPSHOT.configRevision);
  assert.equal(projected.schemaRevision, OWNER_SNAPSHOT.schemaRevision);
  assert.equal(projected.buildRevision, OWNER_SNAPSHOT.buildRevision);
  assert.equal(projected.capitalRelevance, 'NONE');
  assert.equal(projected.proposalAssurance.approvalStatus, 'APPROVED');
  assert.equal(projected.proposalAssurance.verifierStatus, 'PASS');
  assert.equal(projected.repairEvidence.postconditionStatus, 'PASS');
  assert.equal(projected.repairEvidence.quietPeriodStatus, 'PASS');
  assert.equal(projected.repairEvidence.verifierId, REPAIR_EVIDENCE.verifier.verifierId);
  assert.equal(projected.repairEvidence.verifierStatus, 'PASS');
});

test('cockpit repair detail is sourced only from the repair decision and cannot retain proposal green', () => {
  const incomplete = clone(REPAIR_EVIDENCE);
  incomplete.postconditions = [];
  incomplete.quietPeriod.observedThroughMs = incomplete.quietPeriod.startedAtMs;
  incomplete.verifier.status = 'UNKNOWN';
  const repairDecision = evaluateRepairEvidence({
    bundle: incomplete,
    policy: REPAIR_POLICY,
    acceptedPolicyEvidenceDigest: REPAIR_POLICY.evidenceDigest,
    traceDecision: decisions().traceDecision,
    nowMs: NOW,
  });
  const projected = view({ repairDecision });

  assert.equal(repairDecision.status, 'UNKNOWN');
  assert.equal(projected.repairEvidence.evaluation.status, 'UNKNOWN');
  assert.equal(projected.repairEvidence.eligibleForCanonicalRecoveryReadback, false);
  assert.equal(projected.repairEvidence.postconditionStatus, 'UNKNOWN');
  assert.equal(projected.repairEvidence.quietPeriodStatus, 'UNKNOWN');
  assert.equal(projected.repairEvidence.verifierStatus, 'UNKNOWN');
  assert.equal(projected.repairEvidence.verifierId, incomplete.verifier.verifierId);
  assert.deepEqual(validateView(viewSchema, projected), []);
});

test('provider self-report cannot manufacture green without independent trace evidence', () => {
  const traceUnknown = { ...decisions().traceDecision, status: 'UNKNOWN', disposition: 'TRACE_RETENTION_UNKNOWN', reasonCodes: ['APPEND_RETENTION_RECEIPT_MISSING'], lastAppendSequence: null, lastChainDigest: null, retentionOwnerId: null };
  const projected = view({ traceDecision: traceUnknown });
  assert.equal(projected.assuranceStatus, 'UNKNOWN');
  assert.equal(projected.operatingDisposition, 'BLOCKED');
  assert.equal(projected.trace.independentEvidencePass, false);
  assert.equal(projected.rootBlocker, 'APPEND_RETENTION_RECEIPT_MISSING');
});

test('cockpit rejects forged PASS envelopes and unbound run, proposal, approval, or provider identities', () => {
  const forgedProvider = view({ providerDecision: { status: 'PASS', disposition: 'STUBBED_TYPED_RESPONSE', reasonCodes: [] } });
  assert.equal(forgedProvider.assuranceStatus, 'FAIL');
  assert.equal(forgedProvider.rootBlocker, 'ASSURANCE_DECISION_ENVELOPE_INVALID');

  const changedProvider = view({ provider: { ...PROVIDER_STUB, modelId: 'model.stub.unapproved' } });
  assert.equal(changedProvider.assuranceStatus, 'FAIL');
  assert.equal(changedProvider.rootBlocker, 'ASSURANCE_DECISION_ENVELOPE_INVALID');

  for (const run of [
    { ...RUN_VIEW_INPUT, runId: 'diagnostic-run.other' },
    { ...RUN_VIEW_INPUT, incidentId: 'incident.other' },
    { ...RUN_VIEW_INPUT, correlationId: 'correlation.other' },
    { ...RUN_VIEW_INPUT, proposal: { ...RUN_VIEW_INPUT.proposal, proposalId: 'proposal.other' } },
    { ...RUN_VIEW_INPUT, proposal: { ...RUN_VIEW_INPUT.proposal, approvalRef: 'approval.other' } },
    { ...RUN_VIEW_INPUT, proposal: { ...RUN_VIEW_INPUT.proposal, verifierId: 'verifier.other' } },
  ]) {
    const projected = view({ run });
    assert.equal(projected.assuranceStatus, 'FAIL');
    assert.equal(projected.rootBlocker, 'DIAGNOSTIC_RUN_BINDING_MISMATCH');
  }
});

test('cockpit recomputes sealed sandbox and provider evidence before projecting any capability or proposal', () => {
  const base = decisions();
  const widenedSandbox = {
    ...base.sandboxDecision,
    capabilities: [...base.sandboxDecision.capabilities, 'WITHDRAW'],
  };
  const sandboxView = view({ sandboxDecision: widenedSandbox });
  assert.equal(sandboxView.assuranceStatus, 'FAIL');
  assert.equal(sandboxView.rootBlocker, 'ASSURANCE_DECISION_ENVELOPE_INVALID');
  assert.deepEqual(sandboxView.sandbox.capabilities, []);
  assert.equal(sandboxView.sandbox.permissionLevel, null);

  const liveOutput = {
    ...base.providerDecision,
    typedOutput: { ...base.providerDecision.typedOutput, operationalAuthority: 'LIVE' },
  };
  const providerView = view({ providerDecision: liveOutput });
  assert.equal(providerView.assuranceStatus, 'FAIL');
  assert.equal(providerView.rootBlocker, 'ASSURANCE_DECISION_ENVELOPE_INVALID');
  assert.equal(providerView.proposalAssurance.proposalId, null);
  assert.equal(providerView.providerEvaluation.status, 'FAIL');
  assert.equal(providerView.trace.independentEvidencePass, false);

  const liveDescriptor = view({ provider: { ...PROVIDER_STUB, mode: 'LIVE_EXTERNAL', posture: 'OUTAGE' } });
  assert.equal(liveDescriptor.assuranceStatus, 'FAIL');
  assert.equal(liveDescriptor.planeAvailability, 'UNAVAILABLE');
  assert.equal(liveDescriptor.provider.mode, 'UNKNOWN');
  assert.equal(liveDescriptor.provider.providerId, null);
  assert.equal(liveDescriptor.trace.independentEvidencePass, false);
  assert.deepEqual(validateView(viewSchema, liveDescriptor), []);
});

test('failed promotion or corpus governance blocks top-level assurance', () => {
  const failedPromotion = { ...decisions().promotionDecision, status: 'FAIL', reasonCodes: ['PROMOTION_REJECTED'] };
  const promotionView = view({ promotionDecision: failedPromotion });
  assert.equal(promotionView.assuranceStatus, 'FAIL');
  assert.equal(promotionView.operatorAttentionRequired, true);

  const failedCorpus = { ...decisions().corpusDecision, status: 'FAIL', reasonCodes: ['CORPUS_POISON_CONFIRMED'] };
  const corpusView = view({ corpusDecision: failedCorpus });
  assert.equal(corpusView.assuranceStatus, 'FAIL');
  assert.equal(corpusView.rootBlocker, 'CORPUS_POISON_CONFIRMED');
});

test('NOT_CONFIGURED nulls provider, run, proposal, and budget facts without changing product readiness', () => {
  const workloadIdentityDecision = reduceWorkloadIdentity({
    configurationState: 'NOT_CONFIGURED',
    events: [],
    expectedBindingId: SANDBOX_BINDING.bindingId,
    expectedProviderId: SANDBOX_BINDING.providerId,
    expectedEnvironment: SANDBOX_BINDING.environment,
    expectedAudience: SANDBOX_BINDING.workloadAudience,
    expectedSubjectDigest: SANDBOX_BINDING.workloadSubjectDigest,
    nowMs: NOW,
  });
  const ownerSnapshot = {
    ...OWNER_SNAPSHOT,
    desiredState: 'STOPPED',
    observedLifecycle: 'STOPPED',
    capability: 'NOT_CONFIGURED',
    freshness: { state: 'UNKNOWN', ageMs: null, evaluatedAtMs: null, maxAgeMs: null },
    heartbeatAtMs: null,
    lastMeaningfulAdvanceAtMs: null,
    queueDepth: null,
    dropCount: null,
    restartGeneration: null,
  };
  const projected = view({ sourceState: 'NOT_CONFIGURED', ownerSnapshot, provider: PROVIDER_NOT_CONFIGURED, workloadIdentityDecision });
  assert.deepEqual(validateView(viewSchema, projected), []);
  assert.equal(projected.planeAvailability, 'NOT_CONFIGURED');
  assert.equal(projected.assuranceStatus, 'UNKNOWN');
  assert.equal(projected.capability, 'NOT_CONFIGURED');
  assert.equal(projected.provider.posture, 'NOT_CONFIGURED');
  assert.equal(projected.provider.providerId, null);
  assert.equal(projected.provider.modelId, null);
  assert.equal(projected.run.runId, null);
  assert.equal(projected.run.incidentId, null);
  assert.equal(projected.proposalAssurance.proposalId, null);
  assert.equal(projected.budget.tokensUsed, null);
  assert.equal(projected.budget.callsLimit, null);
  assert.equal(projected.productReadinessImpact, 'NONE');

  const identityOnlyAbsence = view({ workloadIdentityDecision });
  assert.equal(identityOnlyAbsence.sourceState, 'SYNTHETIC_ONLY');
  assert.equal(identityOnlyAbsence.planeAvailability, 'NOT_CONFIGURED');
  assert.equal(identityOnlyAbsence.provider.providerId, null);
  assert.equal(identityOnlyAbsence.run.runId, null);
  assert.equal(identityOnlyAbsence.budget.callsLimit, null);
  assert.equal(identityOnlyAbsence.rootBlocker, 'PROVIDER_NOT_CONFIGURED');
  assert.ok(identityOnlyAbsence.reasonCodes.includes(identityOnlyAbsence.rootBlocker));
});

test('most restrictive desired/effective kill state blocks the view', () => {
  const desiredKilled = view({ killControl: { ...KILL_CONTROL_VIEW, desiredState: 'ENGAGED', effectiveState: 'DISENGAGED' } });
  assert.equal(desiredKilled.killControl.blockingState, 'ENGAGED');
  assert.equal(desiredKilled.assuranceStatus, 'FAIL');
  assert.equal(desiredKilled.rootBlocker, 'DIAGNOSTIC_KILL_ENGAGED');

  const unknownReadback = view({ killControl: { ...KILL_CONTROL_VIEW, desiredState: 'DISENGAGED', effectiveState: 'UNKNOWN' } });
  assert.equal(unknownReadback.killControl.blockingState, 'UNKNOWN');
  assert.equal(unknownReadback.assuranceStatus, 'UNKNOWN');
  assert.equal(unknownReadback.killControl.retentionContinuesWhenEngaged, true);

  const wrongControl = view({ killControl: { ...KILL_CONTROL_VIEW, controlId: 'financial.kill' } });
  assert.equal(wrongControl.killControl.blockingState, 'UNKNOWN');
  assert.equal(wrongControl.assuranceStatus, 'UNKNOWN');
  assert.equal(wrongControl.rootBlocker, 'DIAGNOSTIC_KILL_BINDING_INVALID');
  assert.ok(wrongControl.reasonCodes.includes(wrongControl.rootBlocker));
});

test('provider outage is unavailable and remains diagnostic-only', () => {
  const outageProvider = { ...PROVIDER_STUB, posture: 'OUTAGE' };
  const baseline = decisions();
  const outageDecision = runDeterministicProviderStub({
    provider: outageProvider,
    requestDigest: diagnosticRequestDigest(DIAGNOSTIC_REQUEST),
    boundaryDecision: baseline.sandboxDecision,
    identityDecision: baseline.workloadIdentityDecision,
    traceDecision: baseline.traceDecision,
    scriptedOutcome: PROVIDER_SCRIPTED_OUTCOME,
    nowMs: NOW,
  });
  const outage = view({ provider: outageProvider, providerDecision: outageDecision });
  assert.equal(outage.planeAvailability, 'UNAVAILABLE');
  assert.equal(outage.assuranceStatus, 'UNKNOWN');
  assert.equal(outage.operatingDisposition, 'UNAVAILABLE');
  assert.equal(outage.rootBlocker, 'STUBBED_PROVIDER_OUTAGE');
  assert.equal(outage.productReadinessImpact, 'NONE');
});

test('owner failure, stale freshness, deadline expiry, and budget exhaustion cannot render green', () => {
  const failed = view({ ownerSnapshot: { ...OWNER_SNAPSHOT, observedLifecycle: 'FAILED' } });
  assert.equal(failed.assuranceStatus, 'FAIL');
  assert.equal(failed.rootBlocker, 'OWNER_LIFECYCLE_FAILED');

  const stale = view({ ownerSnapshot: { ...OWNER_SNAPSHOT, freshness: { state: 'STALE', ageMs: 60_000, evaluatedAtMs: NOW, maxAgeMs: 5_000 } } });
  assert.equal(stale.assuranceStatus, 'UNKNOWN');
  assert.equal(stale.rootBlocker, 'OWNER_FRESHNESS_UNKNOWN');

  const expired = view({ run: { ...RUN_VIEW_INPUT, deadlineAtMs: NOW } });
  assert.equal(expired.assuranceStatus, 'FAIL');
  assert.equal(expired.rootBlocker, 'DIAGNOSTIC_RUN_DEADLINE_EXPIRED');

  const overBudget = view({ run: { ...RUN_VIEW_INPUT, budget: { ...RUN_VIEW_INPUT.budget, tokensUsed: RUN_VIEW_INPUT.budget.tokensLimit + 1 } } });
  assert.equal(overBudget.assuranceStatus, 'UNKNOWN');
  assert.equal(overBudget.rootBlocker, 'DIAGNOSTIC_RUN_BUDGET_INVALID');

  for (const desiredState of ['STOPPED', 'PAUSED']) {
    const desiredUnavailable = view({ ownerSnapshot: { ...OWNER_SNAPSHOT, desiredState } });
    assert.equal(desiredUnavailable.assuranceStatus, 'UNKNOWN');
    assert.equal(desiredUnavailable.rootBlocker, `OWNER_DESIRED_${desiredState}`);
    assert.ok(desiredUnavailable.reasonCodes.includes(desiredUnavailable.rootBlocker));
  }

  const inconsistentFreshness = view({
    ownerSnapshot: {
      ...OWNER_SNAPSHOT,
      heartbeatAtMs: NOW - 60_000,
      lastMeaningfulAdvanceAtMs: NOW - 60_000,
      freshness: { state: 'FRESH', ageMs: 500, evaluatedAtMs: NOW, maxAgeMs: 5_000 },
    },
  });
  assert.equal(inconsistentFreshness.assuranceStatus, 'UNKNOWN');
  assert.equal(inconsistentFreshness.rootBlocker, 'OWNER_FRESHNESS_INCONSISTENT');

  const expiredFreshness = view({
    ownerSnapshot: {
      ...OWNER_SNAPSHOT,
      heartbeatAtMs: NOW - 31_536_000_500,
      lastMeaningfulAdvanceAtMs: NOW - 31_536_000_500,
      freshness: { state: 'FRESH', ageMs: 500, evaluatedAtMs: NOW - 31_536_000_000, maxAgeMs: 5_000 },
    },
  });
  assert.equal(expiredFreshness.assuranceStatus, 'UNKNOWN');
  assert.equal(expiredFreshness.rootBlocker, 'OWNER_FRESHNESS_UNKNOWN');

  const zeroBudget = view({
    run: {
      ...RUN_VIEW_INPUT,
      budget: {
        callsUsed: 0,
        callsLimit: 0,
        tokensUsed: 0,
        tokensLimit: 0,
        costMicrounitsUsed: 0,
        costMicrounitsLimit: 0,
        latencyMs: 0,
        latencyLimitMs: 0,
      },
    },
  });
  assert.equal(zeroBudget.assuranceStatus, 'UNKNOWN');
  assert.equal(zeroBudget.rootBlocker, 'DIAGNOSTIC_RUN_BUDGET_INVALID');

  const callsAboveBinding = view({
    run: {
      ...RUN_VIEW_INPUT,
      budget: { ...RUN_VIEW_INPUT.budget, callsUsed: 2, callsLimit: 2 },
    },
  });
  assert.equal(callsAboveBinding.assuranceStatus, 'UNKNOWN');
  assert.equal(callsAboveBinding.rootBlocker, 'DIAGNOSTIC_RUN_CALL_BUDGET_EXCEEDS_BINDING');

  const redactionFailed = view({ run: { ...RUN_VIEW_INPUT, redactionState: 'FAIL' } });
  assert.equal(redactionFailed.assuranceStatus, 'FAIL');
  assert.equal(redactionFailed.rootBlocker, 'DIAGNOSTIC_RUN_REDACTION_FAILED');
  assert.equal(redactionFailed.trace.independentEvidencePass, false);

  for (const projected of [failed, stale, expired, overBudget, inconsistentFreshness, expiredFreshness, zeroBudget, callsAboveBinding, redactionFailed]) {
    assert.ok(projected.reasonCodes.includes(projected.rootBlocker), projected.rootBlocker);
    assert.deepEqual(validateView(viewSchema, projected), []);
  }
});

test('local kill, owner, deadline, and budget blockers outrank provider outage', () => {
  const outageProvider = { ...PROVIDER_STUB, posture: 'OUTAGE' };
  const baseline = decisions();
  const outageDecision = runDeterministicProviderStub({
    provider: outageProvider,
    requestDigest: diagnosticRequestDigest(DIAGNOSTIC_REQUEST),
    boundaryDecision: baseline.sandboxDecision,
    identityDecision: baseline.workloadIdentityDecision,
    traceDecision: baseline.traceDecision,
    scriptedOutcome: PROVIDER_SCRIPTED_OUTCOME,
    nowMs: NOW,
  });
  const cases = [
    ['DIAGNOSTIC_KILL_ENGAGED', { killControl: { ...KILL_CONTROL_VIEW, desiredState: 'ENGAGED' } }],
    ['OWNER_LIFECYCLE_FAILED', { ownerSnapshot: { ...OWNER_SNAPSHOT, observedLifecycle: 'FAILED' } }],
    ['OWNER_FRESHNESS_INCONSISTENT', {
      ownerSnapshot: { ...OWNER_SNAPSHOT, heartbeatAtMs: NOW - 60_000, freshness: { state: 'FRESH', ageMs: 500, evaluatedAtMs: NOW, maxAgeMs: 5_000 } },
    }],
    ['DIAGNOSTIC_RUN_DEADLINE_EXPIRED', { run: { ...RUN_VIEW_INPUT, deadlineAtMs: NOW } }],
    ['DIAGNOSTIC_RUN_CALL_BUDGET_EXCEEDS_BINDING', {
      run: { ...RUN_VIEW_INPUT, budget: { ...RUN_VIEW_INPUT.budget, callsUsed: 2, callsLimit: 2 } },
    }],
  ];
  for (const [rootBlocker, localInput] of cases) {
    const projected = view({ provider: outageProvider, providerDecision: outageDecision, ...localInput });
    assert.equal(projected.planeAvailability, 'UNAVAILABLE');
    assert.equal(projected.operatingDisposition, 'BLOCKED');
    assert.equal(projected.rootBlocker, rootBlocker);
    assert.ok(projected.reasonCodes.includes(rootBlocker));
  }
});

test('three insertion-request rows are closed DRAFT records with no fake wiring', () => {
  assert.equal(insertionRows.length, 3);
  for (const row of insertionRows) {
    assert.deepEqual(validateBoundary(boundarySchema, row), [], `${row.rowId}: ${validateBoundary(boundarySchema, row).join('; ')}`);
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.authorityCreated, false);
    assert.match(row.wiringState, /^PENDING_BACKEND:/);
    assert.notEqual(row.wiringState, 'WIRED_LIVE');
  }
});

test('diagnostic kill insertion draft carries the full I00 control-registry metadata', () => {
  const row = insertionRows.find((entry) => entry.rowId.endsWith('diagnostic-kill-control'));
  const draft = row.controlDraft;
  for (const key of ['controlId', 'backendCommandId', 'group', 'label', 'explanation', 'backendOwner', 'targetTypes', 'payloadSchema', 'safeBounds', 'defaultValue', 'desiredEffectiveSemantics', 'effect', 'requiredPosture', 'requiredAuthority', 'confirmationText', 'expiryMs', 'reversibility', 'previewProvider', 'invariants', 'telemetry', 'wiringState']) {
    assert.ok(Object.hasOwn(draft, key), key);
  }
  assert.equal(draft.controlId, 'diagnostic-plane.kill');
  assert.equal(draft.backendCommandId, 'SET_DIAGNOSTIC_PLANE_KILL');
  assert.equal(draft.defaultValue.desiredState, 'ENGAGED');
  assert.match(JSON.stringify(row), /late results/i);
  assert.match(JSON.stringify(row), /cancellation receipt/i);
  assert.match(JSON.stringify(row), /cannot re-enable itself/i);
});

test('main boundary schema owns extensions only and does not redeclare base §3.9 hierarchy', () => {
  for (const duplicate of ['PermissionLevel', 'Budget', 'DiagnosticCapabilityRequestV1', 'DiagnosticTraceV1']) {
    assert.equal(Object.hasOwn(boundarySchema.$defs, duplicate), false, duplicate);
  }
  assert.ok(boundarySchema.$defs.DiagnosticTracePrivacyRetentionExtensionV1);
  assert.equal(DIAGNOSTIC_REQUEST.baseContractRef.reuseMode, 'BASE_REUSED');
});
