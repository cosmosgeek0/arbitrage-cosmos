import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  attachBudgetReceipt,
  attachCaseProof,
  buildEvidenceBundle,
  createBudgetState,
  createCaseSnapshot,
  createCriticalityProof,
  createDiagnosticResult,
  evaluateUsageAdmission,
  recordAttempt,
  transitionCase,
} from '../../../dist/aiOps/runtime/index.js';
import {
  assertShadowEscalationIntentIntegrity as assertShadowEscalationIntentIntegrityWithVerifier,
  createShadowEscalationIntent as createShadowEscalationIntentWithVerifier,
} from '../../../dist/aiOps/runtime/escalation.js';
import {
  createSyntheticCaseProofAuthority,
  createSyntheticClaimValidationPort,
  createSyntheticSigner,
} from '../../../../fixtures/aiOps/a2/synthetic-runtime.mjs';
import { canonicalJson } from '../../../dist/foundation/contracts/identity.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const start = 1_700_001_000_000;
const diagnosticAtMs = start + 60;
const evaluationAtMs = start + 80;
const zeroUsage = Object.freeze({
  calls: 0, toolCalls: 0, webQueries: 0, tokens: 0, costMicrounits: 0, latencyMs: 0, wallTimeMs: 0,
});
const usageLimit = Object.freeze({
  calls: 10, toolCalls: 10, webQueries: 10, tokens: 10_000, costMicrounits: 100_000,
  latencyMs: 100_000, wallTimeMs: 100_000,
});
const policyRevision = 'policy-a2x-v1';
const providerId = 'synthetic-provider-a2x';
const modelId = 'synthetic-model-a2x';
const caseId = 'case-a2x-escalation';
const proofAuthority = createSyntheticCaseProofAuthority();
const escalationBindingSigner = createSyntheticSigner();
const createShadowEscalationIntent = (input) => (
  createShadowEscalationIntentWithVerifier(input, escalationBindingSigner)
);
const assertShadowEscalationIntentIntegrity = (intent) => (
  assertShadowEscalationIntentIntegrityWithVerifier(intent, escalationBindingSigner)
);

const evidenceLimits = Object.freeze({
  maximumItems: 4,
  maximumOmittedItems: 4,
  maximumRawBytes: 2_048,
  maximumItemBytes: 1_024,
  maximumAgeMs: 10_000,
});
const evidenceText = 'synthetic owner-attention evidence';
const evidenceItem = Object.freeze({
  pointerId: 'pointer-a2x-escalation',
  ownerId: 'synthetic-evidence-owner',
  artifactId: 'artifact-a2x-escalation',
  rawDigest: sha256(evidenceText),
  byteLength: Buffer.byteLength(evidenceText),
  capturedAtMs: start + 40,
  sourceKind: 'LOG',
  text: evidenceText,
});
const evidenceBundle = buildEvidenceBundle(Object.freeze({
  caseId,
  incidentId: 'incident-a2x-escalation',
  fingerprint: sha256('a2x-escalation-fingerprint'),
  correlationIds: ['correlation-a2x-escalation'],
  policyRevision,
  createdAtMs: start + 50,
  evidenceWindowStartMs: start + 30,
  evidenceWindowEndMs: start + 50,
  timezone: 'UTC',
  environmentId: 'synthetic-test',
  deployedSha: '098f7b9449ab3b1c26bda19f51537bfea01d4c48',
  configRevision: 'config-a2x-v1',
  schemaRevisions: ['schema-a2x-v1'],
  expectedInventoryRevision: 'inventory-a2x-v1',
  affectedResourceIds: ['resource-a2x'],
  dependencyIds: [],
  lifecycleStateCodes: ['DEGRADED'],
  safetyPostureDigest: sha256('a2x-safety-posture'),
  triggeredInvariantIds: ['invariant-a2x'],
  severity: 'SEV2_MAJOR',
  materiality: 'MATERIAL',
  freshness: 'FRESH',
  temporalCoherence: 'COHERENT',
  missingEvidenceCodes: [],
  conflictingEvidenceCodes: [],
  unknownCodes: [],
}), [evidenceItem], evidenceLimits);

const evidencePort = Object.freeze({
  readEvidencePointer(pointer) {
    if (pointer.pointerId !== evidenceItem.pointerId) return Object.freeze({ state: 'UNKNOWN' });
    return Object.freeze({
      state: 'AVAILABLE',
      rawDigest: evidenceItem.rawDigest,
      byteLength: evidenceItem.byteLength,
      observedAtMs: diagnosticAtMs,
      sourceKind: evidenceItem.sourceKind,
      rawText: evidenceItem.text,
    });
  },
});
const budgetSigner = createSyntheticSigner();
const budgetCaps = Object.freeze({
  policyRevision,
  perCase: usageLimit,
  hourly: usageLimit,
  daily: usageLimit,
  monthly: usageLimit,
  globalHourly: usageLimit,
  globalDaily: usageLimit,
  globalMonthly: usageLimit,
  criticalReserve: zeroUsage,
});
const budgetAdmission = evaluateUsageAdmission(
  createBudgetState(policyRevision),
  budgetCaps,
  caseId,
  providerId,
  modelId,
  diagnosticAtMs,
  Object.freeze({ ...zeroUsage, calls: 1, tokens: 100 }),
  createCriticalityProof(Object.freeze({
    caseId,
    policyRevision,
    critical: true,
    issuedAtMs: diagnosticAtMs - 1,
    expiresAtMs: diagnosticAtMs + 1_000,
  }), budgetSigner),
  budgetSigner,
);
const versions = Object.freeze({
  providerId,
  modelId,
  promptRevision: 'prompt-a2x-v1',
  toolRevision: 'tool-a2x-v1',
  policyRevision,
  contextManifestDigest: sha256('context-a2x'),
  budgetAdmissionDigest: budgetAdmission.admissionDigest,
  usageRequestDigest: budgetAdmission.usageRequestDigest,
});
const diagnosticInput = Object.freeze({
  caseId,
  generation: 0,
  evidenceBundleDigest: evidenceBundle.bundleDigest,
  createdAtMs: diagnosticAtMs,
  expiresAtMs: start + 900,
  observedFacts: Object.freeze([Object.freeze({
    claimId: 'fact-owner-attention',
    claimDigest: sha256('fact-owner-attention'),
    evidencePointerIds: Object.freeze([evidenceItem.pointerId]),
    disposition: 'VALIDATED',
  })]),
  hypotheses: Object.freeze([Object.freeze({
    claimId: 'hypothesis-owner-attention',
    claimDigest: sha256('hypothesis-owner-attention'),
    evidencePointerIds: Object.freeze([evidenceItem.pointerId]),
    disposition: 'VALIDATED',
    falsificationTestIds: Object.freeze(['test-owner-attention']),
  })]),
  supportingEvidencePointerIds: Object.freeze([evidenceItem.pointerId]),
  conflictingEvidencePointerIds: Object.freeze([]),
  uncertainty: 'MEDIUM',
  missingEvidenceCodes: Object.freeze([]),
  falsificationTestIds: Object.freeze(['test-owner-attention']),
  affectedCapabilityIds: Object.freeze(['capability-diagnostics']),
  immediateSafetyPostureDigest: sha256('a2x-safety-posture'),
  recommendedNextStep: 'ESCALATE_TO_OWNER',
  forbiddenOrUnavailableActionCodes: Object.freeze(['NO_MONEY_PATHS', 'NO_PRODUCTION_AUTHORITY']),
  versions,
  likelyRootCause: 'hypothesis-owner-attention',
  recommendedRunbookIds: Object.freeze(['runbook-owner-review']),
  proposedQueryOrTestIds: Object.freeze(['test-owner-attention']),
  patchRecommended: 'UNKNOWN',
  ownerAttentionRequired: true,
  escalationReasonCode: 'OWNER_REVIEW_REQUIRED',
});
const claimValidationPort = createSyntheticClaimValidationPort([
  {
    claimKind: 'OBSERVED_FACT',
    claimId: 'fact-owner-attention',
    claimDigest: sha256('fact-owner-attention'),
    evidencePointerIds: [evidenceItem.pointerId],
    falsificationTestIds: [],
    disposition: 'VALIDATED',
  },
  {
    claimKind: 'HYPOTHESIS',
    claimId: 'hypothesis-owner-attention',
    claimDigest: sha256('hypothesis-owner-attention'),
    evidencePointerIds: [evidenceItem.pointerId],
    falsificationTestIds: ['test-owner-attention'],
    disposition: 'VALIDATED',
  },
]);
const diagnostic = createDiagnosticResult(
  diagnosticInput,
  evidenceBundle,
  diagnosticAtMs,
  evidenceLimits,
  evidencePort,
  claimValidationPort,
  budgetAdmission,
);

function addProof(snapshot, proofKind, artifactId, artifactDigest, recordedAtMs) {
  return attachCaseProof(snapshot, proofAuthority.issueValidatedProof({
    proofKind,
    caseId: snapshot.caseId,
    generation: snapshot.generation,
    artifactId,
    artifactDigest,
    disposition: 'VALIDATED',
    recordedAtMs,
  }), proofAuthority);
}

function commit(snapshot, commandId, toState, occurredAtMs, reasonCodes = [`TO_${toState}`]) {
  const result = transitionCase(snapshot, Object.freeze({
    commandId,
    expectedRevision: snapshot.revision,
    expectedGeneration: snapshot.generation,
    toState,
    occurredAtMs,
    reasonCodes,
    evidencePointerIds: [],
  }), proofAuthority);
  assert.equal(result.status, 'COMMITTED', result.reasonCode);
  return result.snapshot;
}

function createOwnerAttentionSnapshot() {
  let snapshot = createCaseSnapshot(caseId, 'detect-a2x', start, ['SYNTHETIC_DETECTION'], [evidenceItem.pointerId]);
  snapshot = commit(snapshot, 'dedup-a2x', 'DEDUPED_OR_SUPPRESSED', start + 10);
  snapshot = commit(snapshot, 'open-a2x', 'CASE_OPENED', start + 20);
  const pointerIds = [...snapshot.currentGenerationEvidencePointerIds].sort();
  const pointerSetDigest = sha256(canonicalJson(pointerIds));
  const evidenceBindingDigest = sha256(canonicalJson({
    evidenceBundleDigest: evidenceBundle.bundleDigest,
    evidencePointerIds: pointerIds,
  }));
  snapshot = addProof(snapshot, 'EVIDENCE_BUNDLE', 'bundle-a2x', evidenceBindingDigest, start + 21);
  snapshot = commit(snapshot, 'freeze-a2x', 'EVIDENCE_FROZEN', start + 22, [
    `EVIDENCE_BUNDLE_BOUND:${evidenceBundle.bundleDigest}`,
    `EVIDENCE_POINTER_SET_BOUND:${pointerSetDigest}`,
  ]);
  const redactionDigest = sha256('redaction-a2x');
  snapshot = addProof(snapshot, 'REDACTION_REPORT', 'redaction-a2x', redactionDigest, start + 23);
  snapshot = commit(snapshot, 'redaction-verified-a2x', 'REDACTION_VERIFIED', start + 24, [
    `REDACTION_REPORT_BOUND:${redactionDigest}`,
  ]);
  const budgetDigest = sha256('case-budget-a2x');
  snapshot = attachBudgetReceipt(snapshot, 'budget-a2x');
  snapshot = addProof(snapshot, 'BUDGET_ADMISSION', 'budget-a2x', budgetDigest, start + 25);
  snapshot = commit(snapshot, 'budget-admitted-a2x', 'BUDGET_ADMITTED', start + 26, [
    `BUDGET_ADMISSION_BOUND:${budgetDigest}`,
  ]);
  snapshot = commit(snapshot, 'diagnosing-a2x', 'DIAGNOSING', start + 27, [
    `DIAGNOSTIC_ROUND_BUDGET_BOUND:${budgetDigest}`,
  ]);
  snapshot = recordAttempt(snapshot, Object.freeze({
    attemptId: 'diagnostic-attempt-a2x-started',
    sourceRecordId: 'diagnostic-request-a2x',
    attemptBaseline: 0,
    operationClass: 'PROVIDER',
    generation: 0,
    attemptNumber: 1,
    disposition: 'STARTED',
    recordedAtMs: start + 70,
    payloadDigest: diagnostic.diagnosisDigest,
  }));
  snapshot = recordAttempt(snapshot, Object.freeze({
    attemptId: 'diagnostic-attempt-a2x-succeeded',
    sourceRecordId: 'diagnostic-request-a2x',
    attemptBaseline: 0,
    operationClass: 'PROVIDER',
    generation: 0,
    attemptNumber: 1,
    disposition: 'SUCCEEDED',
    recordedAtMs: start + 71,
    payloadDigest: diagnostic.diagnosisDigest,
  }));
  const diagnosticBindingDigest = sha256(canonicalJson({
    diagnosticResultDigest: diagnostic.diagnosisDigest,
    evidenceBundleDigest: diagnostic.evidenceBundleDigest,
  }));
  snapshot = addProof(snapshot, 'DIAGNOSTIC_RESULT', 'diagnosis-a2x', diagnosticBindingDigest, start + 72);
  snapshot = commit(snapshot, 'diagnosis-ready-a2x', 'DIAGNOSIS_READY', start + 73, [
    `DIAGNOSTIC_RESULT_BOUND:${diagnostic.diagnosisDigest}`,
    `EVIDENCE_BUNDLE_BOUND:${diagnostic.evidenceBundleDigest}`,
    `DIAGNOSTIC_EVIDENCE_BINDING_BOUND:${diagnosticBindingDigest}`,
  ]);
  return commit(snapshot, 'owner-attention-a2x', 'OWNER_ATTENTION_REQUIRED', start + 74, ['OWNER_ATTENTION_REQUIRED']);
}

const ownerAttentionSnapshot = createOwnerAttentionSnapshot();
const proposedArtifactDigest = diagnostic.diagnosisDigest;
const registeredActionId = 'owner-handoff-a2x-v1';
const maximumEffect = 'OWNER_REVIEW_ONLY';
const rollbackId = 'rollback-not-applicable-a2x';
const approverId = 'owner-approver-a2x';
const baseProposal = Object.freeze({
  schema: 'PRODUCT_ASSURANCE_DIAGNOSTIC_PROPOSAL_V1',
  proposalId: 'proposal-owner-handoff-a2x',
  proposalKind: 'REQUEST_OWNER_HANDOFF',
  requestedPermission: 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY',
  requestedCapabilities: Object.freeze(['REQUEST_OWNER_HANDOFF']),
  evidenceBundleDigest: diagnostic.evidenceBundleDigest,
  proposedArtifactDigest,
  incidentId: 'incident-a2x-escalation',
  registeredActionId,
  providerId,
  modelId,
  policyRevision,
  createdAtMs: start + 61,
  expiresAtMs: start + 500,
  tokenBudget: 100,
  costBudgetMicrounits: 1_000,
  approval: Object.freeze({
    approvalId: 'approval-owner-handoff-a2x',
    artifactDigest: proposedArtifactDigest,
    actionId: registeredActionId,
    environmentId: 'synthetic-test',
    policyRevision,
    capability: 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY',
    maximumEffect,
    expiresAtMs: start + 400,
    rollbackId,
    approverId,
  }),
});
const baseContext = Object.freeze({
  nowMs: evaluationAtMs,
  providerState: 'READY',
  maximumTokenBudget: 1_000,
  maximumCostBudgetMicrounits: 10_000,
  allowedPermission: 'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY',
  environmentId: 'synthetic-test',
  approvedMaximumEffect: maximumEffect,
  requiredRollbackId: rollbackId,
  authorizedApproverIds: Object.freeze([approverId]),
  externalSandbox: Object.freeze({
    schema: 'PRODUCT_ASSURANCE_DIAGNOSTIC_SANDBOX_V1',
    sandboxId: 'sandbox-a2x',
    providerId,
    defaultPolicy: 'DENY_BY_DEFAULT',
    allowedCapabilities: Object.freeze(['REQUEST_OWNER_HANDOFF']),
    arbitraryShellAccess: 'DENIED',
    arbitraryNetworkAccess: 'DENIED',
    secretAccess: 'DENIED',
    mainWorkspaceWriteAccess: 'DENIED',
    productionPersistenceWriteAccess: 'DENIED',
  }),
  tracePrivacy: Object.freeze({
    schema: 'PRODUCT_ASSURANCE_DIAGNOSTIC_TRACE_PRIVACY_V1',
    traceId: 'trace-a2x-owner-handoff',
    evidenceBundleDigest: diagnostic.evidenceBundleDigest,
    policyRevision,
    redactionApplied: true,
    instructionDataBoundaryApplied: true,
    rawEvidenceStoredOutsidePrompt: true,
    secretMaterialPresentInPrompt: false,
  }),
  independentRetention: Object.freeze({
    schema: 'PRODUCT_ASSURANCE_DIAGNOSTIC_RETENTION_V1',
    retentionId: 'retention-a2x',
    retentionPolicyId: 'retention-policy-a2x',
    ownerId: 'independent-audit-owner-a2x',
    evidenceBundleDigest: diagnostic.evidenceBundleDigest,
    independentFromProvider: true,
    providerWriteAccess: 'DENIED',
    providerDeleteAccess: 'DENIED',
  }),
});

function incidentOwnerBinding(overrides = {}) {
  const suppliedDigest = overrides.bindingDigest;
  const suppliedSignature = overrides.signature;
  const payload = Object.freeze({
    schema: 'AI_OPS_A2_ESCALATION_INCIDENT_OWNER_BINDING_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    posture: 'SYNTHETIC_ONLY',
    caseId,
    generation: diagnostic.generation,
    diagnosticDigest: diagnostic.diagnosisDigest,
    evidenceBundleDigest: diagnostic.evidenceBundleDigest,
    policyRevision,
    incidentId: baseProposal.incidentId,
    targetOwnerId: 'incident-owner-a2x',
    issuedAtMs: evaluationAtMs - 1,
    expiresAtMs: start + 350,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['bindingDigest', 'signature'].includes(key))),
  });
  const bindingDigest = suppliedDigest ?? sha256(canonicalJson(payload));
  return Object.freeze({
    ...payload,
    bindingDigest,
    signature: Object.freeze(suppliedSignature ?? escalationBindingSigner.signDigest(bindingDigest)),
  });
}

function intentInput(overrides = {}) {
  return {
    caseSnapshot: ownerAttentionSnapshot,
    diagnosticResult: diagnostic,
    proposal: baseProposal,
    evaluationContext: baseContext,
    incidentOwnerBinding: incidentOwnerBinding(),
    createdAtMs: evaluationAtMs,
    expiresAtMs: start + 300,
    ...overrides,
  };
}

test('owner handoff readiness binds case, diagnostic, proposal, and Product Assurance without claiming delivery or authority', () => {
  const intent = createShadowEscalationIntent(intentInput());
  assert.equal(intent.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(intent.readiness, 'READY_FOR_OWNER_HANDOFF');
  assert.deepEqual(intent.reasonCodes, ['OWNER_HANDOFF_READY_SHADOW_ONLY']);
  assert.equal(intent.caseRevision, ownerAttentionSnapshot.revision);
  assert.equal(intent.caseGeneration, ownerAttentionSnapshot.generation);
  assert.equal(intent.caseSnapshotDigest, ownerAttentionSnapshot.snapshotDigest);
  assert.equal(intent.diagnosticDigest, diagnostic.diagnosisDigest);
  assert.equal(intent.boundaryDecision.allowed, true);
  assert.equal(intent.boundaryDecision.authorityGranted, false);
  assert.equal(intent.incidentId, baseProposal.incidentId);
  assert.equal(intent.targetOwnerId, 'incident-owner-a2x');
  assert.equal(intent.incidentOwnerBinding.posture, 'SYNTHETIC_ONLY');
  assert.equal(intent.authorityGranted, false);
  assert.equal(intent.operationalAuthority, 'NONE');
  assert.equal(intent.deliveryState, 'NOT_ATTEMPTED');
  assert.match(intent.escalationIntentId, /^a2-escalation-intent:/u);
  assert.ok(Object.isFrozen(intent));
  assert.ok(Object.isFrozen(intent.boundaryDecision));
  assert.doesNotThrow(() => assertShadowEscalationIntentIntegrity(intent));
});

test('case-local escalation fails closed when owner-attention state and diagnostic binding are absent', () => {
  const unbound = createCaseSnapshot(caseId, 'detect-unbound-a2x', start, ['SYNTHETIC_DETECTION']);
  const intent = createShadowEscalationIntent(intentInput({ caseSnapshot: unbound }));
  assert.equal(intent.readiness, 'BLOCKED');
  assert.ok(intent.reasonCodes.includes('CASE_OWNER_ATTENTION_STATE_MISSING'));
  assert.ok(intent.reasonCodes.includes('CASE_DIAGNOSTIC_BINDING_MISSING'));
  assert.equal(intent.deliveryState, 'NOT_ATTEMPTED');
  assert.equal(intent.authorityGranted, false);
});

test('Product Assurance unknown or denied decisions cannot become ready handoff intents', () => {
  const proposalWithoutApproval = Object.freeze({ ...baseProposal, approval: null });
  const missingApproval = createShadowEscalationIntent(intentInput({ proposal: proposalWithoutApproval }));
  assert.equal(missingApproval.readiness, 'BLOCKED');
  assert.equal(missingApproval.boundaryDecision.allowed, false);
  assert.ok(missingApproval.reasonCodes.includes('OWNER_APPROVAL_MISSING'));
  assert.ok(missingApproval.reasonCodes.includes('PRODUCT_ASSURANCE_OWNER_HANDOFF_DENIED'));

  const unavailable = createShadowEscalationIntent(intentInput({
    evaluationContext: Object.freeze({ ...baseContext, providerState: 'UNAVAILABLE' }),
  }));
  assert.equal(unavailable.readiness, 'BLOCKED');
  assert.ok(unavailable.reasonCodes.includes('DIAGNOSTIC_PLANE_UNAVAILABLE'));
  assert.equal(unavailable.authorityGranted, false);
});

test('wrong proposal kind, forged diagnostic, and overlong intent lifetime are rejected', () => {
  assert.throws(() => createShadowEscalationIntent(intentInput({
    proposal: Object.freeze({
      ...baseProposal,
      proposalKind: 'EXPLAIN_INCIDENT',
      requestedPermission: 'OBSERVE_EXPLAIN',
      requestedCapabilities: Object.freeze(['EXPLAIN_CAUSAL_CHAIN']),
      registeredActionId: null,
      proposedArtifactDigest: null,
      approval: null,
    }),
  })), /REQUEST_OWNER_HANDOFF/u);

  assert.throws(() => createShadowEscalationIntent(intentInput({
    diagnosticResult: Object.freeze({ ...diagnostic, diagnosisDigest: sha256('forged-diagnostic') }),
  })), /diagnostic result digest mismatch/u);

  assert.throws(() => createShadowEscalationIntent(intentInput({ expiresAtMs: start + 401 })), /outlives/u);
});

test('incident and recipient readiness require an exact signed owner binding', () => {
  const wrongIncident = createShadowEscalationIntent(intentInput({
    incidentOwnerBinding: incidentOwnerBinding({ incidentId: 'incident-a2x-other' }),
  }));
  assert.equal(wrongIncident.readiness, 'BLOCKED');
  assert.ok(wrongIncident.reasonCodes.includes('ESCALATION_OWNER_BINDING_INCIDENT_MISMATCH'));

  const foreignCase = createShadowEscalationIntent(intentInput({
    incidentOwnerBinding: incidentOwnerBinding({ caseId: 'case-a2x-foreign' }),
  }));
  assert.equal(foreignCase.readiness, 'BLOCKED');
  assert.ok(foreignCase.reasonCodes.includes('ESCALATION_OWNER_BINDING_CASE_MISMATCH'));

  const validBinding = incidentOwnerBinding();
  assert.throws(() => createShadowEscalationIntent(intentInput({
    incidentOwnerBinding: Object.freeze({
      ...validBinding,
      targetOwnerId: 'forged-owner-a2x',
    }),
  })), /binding digest mismatch/u);
  assert.throws(() => createShadowEscalationIntent(intentInput({
    incidentOwnerBinding: incidentOwnerBinding({
      signature: { ...validBinding.signature, signature: 'a'.repeat(64) },
    }),
  })), /binding signature invalid/u);
});

test('Product Assurance proposal, approval, and context inputs remain closed at the A2 adapter boundary', () => {
  assert.throws(() => createShadowEscalationIntent(intentInput({
    proposal: Object.freeze({ ...baseProposal, accepted: true }),
  })), /unsupported field/u);
  assert.throws(() => createShadowEscalationIntent(intentInput({
    proposal: Object.freeze({
      ...baseProposal,
      approval: Object.freeze({ ...baseProposal.approval, operationalAuthority: 'ALL' }),
    }),
  })), /unsupported field/u);
  assert.throws(() => createShadowEscalationIntent(intentInput({
    evaluationContext: Object.freeze({ ...baseContext, authorityGranted: true }),
  })), /unsupported field/u);
});

test('tampered intent cannot claim delivery, authority, or unsupported readiness', () => {
  const intent = createShadowEscalationIntent(intentInput());
  assert.throws(() => assertShadowEscalationIntentIntegrity({
    ...intent,
    deliveryState: 'DELIVERED',
  }), /cannot claim delivery/u);
  assert.throws(() => assertShadowEscalationIntentIntegrity({
    ...intent,
    authorityGranted: true,
  }), /cannot carry operational authority/u);
  assert.throws(() => assertShadowEscalationIntentIntegrity({
    ...intent,
    caseDiagnosticBindingDigest: sha256('wrong-binding'),
  }), /readiness is not supported|digest mismatch/u);
});
