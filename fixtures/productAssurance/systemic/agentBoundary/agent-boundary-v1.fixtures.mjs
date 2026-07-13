import { appendChainDigest, sha256Hex, stableUnique } from './canonical.mjs';
import {
  PERMANENTLY_FORBIDDEN_CAPABILITIES,
  corpusContentDigest,
  corpusDedupRegistryDigest,
  corpusReleaseReviewEvidenceDigest,
  corpusSourceProjectionDigest,
  corpusStableKey,
  diagnosticKillReadbackDigest,
  sandboxApprovalEvidenceDigest,
  repairEvidencePolicyDigest,
  selfCorrectionClassPolicyDigest,
  selfCorrectionHoldoutEvidenceDigest,
  selfCorrectionVerifierEvidenceDigest,
  workloadIdentityEventEvidenceHash,
} from './evaluators.mjs';

export const NOW = 1_900_000_000_000;
export const RETENTION_POLICY = Object.freeze({
  revision: 'retention.agent-boundary.v1',
  privacyPolicyRevision: 'trace-privacy.v1',
  minimumRetentionMs: 86_400_000,
  allowedAccessTiers: Object.freeze(['ASSURANCE_RESTRICTED']),
  expectedFirstSequence: 41,
  expectedPreviousChainDigest: h('retention-chain-anchor'),
  anchorEvidenceDigest: h('retention-anchor-proof'),
});
const REPAIR_POLICY_BASE = Object.freeze({
  schema: 'RepairEvidencePolicyFixtureV1',
  version: 1,
  authorityId: 'canonical-control-plane-command-registry',
  bindingLawRef: 'IP_ASSURANCE.md#7',
  basePolicyRef: 'IP_ASSURANCE.md#3.4:remediation-policy',
  registrySnapshotDigest: h('canonical-remediation-registry-snapshot'),
  ownerPreauthorizationDigest: h('class-A-owner-preauthorization'),
  revision: 'repair-evidence.v1',
  requiresRollback: true,
  requiresCompensation: false,
  minimumQuietPeriodMs: 5_000,
  allowedActionIds: Object.freeze(['repair-action.fixture.1']),
  allowedExecutorIds: Object.freeze(['canonical-control.fixture']),
  allowedProducerIds: Object.freeze(['diagnostic-worker.fixture']),
  requiredResourceIds: Object.freeze(['resource.fixture.worker-1']),
  requiredTestCheckIds: Object.freeze(['repair-failure-path', 'repair-success-path']),
  requiredCounterexampleCheckIds: Object.freeze(['repair-counterexample']),
  requiredPostconditionCheckIds: Object.freeze(['repair-postcondition']),
});
export const REPAIR_POLICY = Object.freeze({
  ...REPAIR_POLICY_BASE,
  evidenceDigest: repairEvidencePolicyDigest(REPAIR_POLICY_BASE),
});

export function h(label) {
  return sha256Hex(`agent-boundary-fixture:${label}`);
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const IDENTITY_COMMON = Object.freeze({
  schema: 'WorkloadIdentityEventV1',
  version: 1,
  generation: 1,
  providerId: 'provider.stub.fixture',
  identityRef: 'workload-identity.fixture.1',
  bindingId: 'sandbox-binding.fixture.1',
  environment: 'isolated-fixture',
  audience: 'diagnostic-stub.fixture',
  subjectDigest: h('identity-subject'),
  capabilityDigest: h('identity-capability'),
  notBeforeMs: NOW - 9_000,
  rotationDueAtMs: NOW + 60_000,
  expiresAtMs: NOW + 120_000,
});

function identityEvent(fields) {
  const event = { ...IDENTITY_COMMON, ...fields };
  return Object.freeze({ ...event, evidenceHash: workloadIdentityEventEvidenceHash(event) });
}

export const ACTIVE_IDENTITY_EVENTS = Object.freeze([
  identityEvent({ sequence: 1, type: 'PROVISION_REQUESTED', observedAtMs: NOW - 10_000 }),
  identityEvent({ sequence: 2, type: 'ATTESTED', observedAtMs: NOW - 8_000 }),
]);

const SANDBOX_BINDING_BASE = Object.freeze({
  schema: 'ExternalSandboxBindingV1',
  version: 1,
  revision: 1,
  bindingId: 'sandbox-binding.fixture.1',
  configurationState: 'SYNTHETIC_ONLY',
  providerMode: 'DETERMINISTIC_STUB',
  providerId: 'provider.stub.fixture',
  modelId: 'model.stub.typed-triage',
  modelVersion: 'fixture-v1',
  workloadIdentityRef: 'workload-identity.fixture.1',
  workloadAudience: 'diagnostic-stub.fixture',
  workloadSubjectDigest: h('identity-subject'),
  workloadCapabilityDigest: h('identity-capability'),
  environment: 'isolated-fixture',
  policyRevision: 'diagnostic-boundary.v1',
  permissionLevel: 'PATCH_ISOLATED_AND_TEST',
  allowedCapabilities: Object.freeze([
    'PROPOSE_TYPED_ACTION',
    'READ_REDACTED_EVIDENCE',
    'RUN_ISOLATED_TESTS',
    'WRITE_ISOLATED_PATCH',
  ]),
  allowedToolIds: Object.freeze(['fixture.read-redacted', 'fixture.write-isolated-patch', 'fixture.run-isolated-tests']),
  toolCapabilityBindings: Object.freeze([
    Object.freeze({ toolId: 'fixture.read-redacted', capability: 'READ_REDACTED_EVIDENCE', minimumPermissionLevel: 'OBSERVE_EXPLAIN' }),
    Object.freeze({ toolId: 'fixture.write-isolated-patch', capability: 'WRITE_ISOLATED_PATCH', minimumPermissionLevel: 'PATCH_ISOLATED_AND_TEST' }),
    Object.freeze({ toolId: 'fixture.run-isolated-tests', capability: 'RUN_ISOLATED_TESTS', minimumPermissionLevel: 'PATCH_ISOLATED_AND_TEST' }),
  ]),
  allowedResourceDigests: Object.freeze([h('incident-bundle'), h('isolated-workspace')]),
  forbiddenCapabilities: PERMANENTLY_FORBIDDEN_CAPABILITIES,
  networkPolicy: 'DENY_ALL',
  egressAllowlist: Object.freeze([]),
  workspace: Object.freeze({
    mode: 'EPHEMERAL_ISOLATED',
    writableRoots: Object.freeze(['/isolated-workspace']),
    readOnlyArtifactDigests: Object.freeze([h('incident-bundle')]),
  }),
  budget: Object.freeze({ maxCalls: 1, maxTokens: 4_096, maxCostMicrounits: 50_000, maxLatencyMs: 5_000, maxConcurrent: 1, rateWindowMs: 60_000, cooldownMs: 30_000 }),
  issuedAtMs: NOW - 20_000,
  expiresAtMs: NOW + 120_000,
  privacyPolicyRevision: 'trace-privacy.v1',
  retentionPolicyRevision: RETENTION_POLICY.revision,
  killControlId: 'diagnostic-plane.kill',
  killControlRevision: 1,
  killReadbackMaxAgeMs: 5_000,
  approvalRef: 'approval.fixture.isolated-only',
});

const DIAGNOSTIC_REQUEST_BASE = Object.freeze({
  schema: 'BaseDiagnosticCapabilityRequestFixtureV1',
  version: 1,
  baseContractRef: Object.freeze({
    ownerSection: 'IP_ASSURANCE.md#3.9',
    contractName: 'DiagnosticCapabilityRequest',
    reuseMode: 'BASE_REUSED',
  }),
  requestId: 'diagnostic-request.fixture.1',
  providerId: SANDBOX_BINDING_BASE.providerId,
  identityRef: SANDBOX_BINDING_BASE.workloadIdentityRef,
  environment: SANDBOX_BINDING_BASE.environment,
  policyRevision: SANDBOX_BINDING_BASE.policyRevision,
  modelId: SANDBOX_BINDING_BASE.modelId,
  modelVersion: SANDBOX_BINDING_BASE.modelVersion,
  permissionLevel: 'PATCH_ISOLATED_AND_TEST',
  capabilities: Object.freeze(['READ_REDACTED_EVIDENCE', 'PROPOSE_TYPED_ACTION', 'WRITE_ISOLATED_PATCH', 'RUN_ISOLATED_TESTS']),
  toolIds: SANDBOX_BINDING_BASE.allowedToolIds,
  resourceDigests: SANDBOX_BINDING_BASE.allowedResourceDigests,
  untrustedContentDigests: Object.freeze([h('hostile-log-text'), h('retrieved-document')]),
  budget: Object.freeze({ maxCalls: 1, maxTokens: 2_048, maxCostMicrounits: 25_000, maxLatencyMs: 2_500, maxConcurrent: 1, rateWindowMs: 60_000, cooldownMs: 30_000 }),
  approvalRef: SANDBOX_BINDING_BASE.approvalRef,
});

const SANDBOX_APPROVAL_BASE = Object.freeze({
  schema: 'BaseDiagnosticApprovalEvidenceFixtureV1',
  version: 1,
  baseContractRef: Object.freeze({
    ownerSection: 'IP_ASSURANCE.md#3.9',
    contractName: 'ExactDiagnosticApproval',
    reuseMode: 'BASE_REUSED',
  }),
  status: 'APPROVED',
  approvalRef: SANDBOX_BINDING_BASE.approvalRef,
  requestId: DIAGNOSTIC_REQUEST_BASE.requestId,
  requestDigest: sha256Hex(DIAGNOSTIC_REQUEST_BASE),
  environment: SANDBOX_BINDING_BASE.environment,
  policyRevision: SANDBOX_BINDING_BASE.policyRevision,
  modelId: SANDBOX_BINDING_BASE.modelId,
  modelVersion: SANDBOX_BINDING_BASE.modelVersion,
  capabilities: DIAGNOSTIC_REQUEST_BASE.capabilities,
  maximumEffect: 'DETERMINISTIC_STUB_ONLY',
  expiresAtMs: NOW + 30_000,
  rollbackPlanDigest: h('sandbox-approval-rollback'),
  approverId: 'human-owner.fixture',
});

const SANDBOX_APPROVAL_EVIDENCE_DIGEST = sandboxApprovalEvidenceDigest(SANDBOX_APPROVAL_BASE);

export const SANDBOX_BINDING = Object.freeze({
  ...SANDBOX_BINDING_BASE,
  approvalEvidenceDigest: SANDBOX_APPROVAL_EVIDENCE_DIGEST,
});

export const SANDBOX_NOT_CONFIGURED = Object.freeze({
  schema: 'ExternalSandboxBindingV1',
  version: 1,
  revision: 1,
  bindingId: 'sandbox-binding.not-configured',
  configurationState: 'NOT_CONFIGURED',
  sourceState: 'NOT_CONFIGURED',
  wiringState: 'PENDING_BACKEND:CONFIGURE_DIAGNOSTIC_SANDBOX',
  authorityCreated: false,
});

export const DIAGNOSTIC_REQUEST = DIAGNOSTIC_REQUEST_BASE;

export const SANDBOX_APPROVAL_FIXTURE = Object.freeze({
  ...SANDBOX_APPROVAL_BASE,
  evidenceDigest: SANDBOX_APPROVAL_EVIDENCE_DIGEST,
});

const KILL_READBACK_BASE = Object.freeze({
  schema: 'DiagnosticKillReadbackFixtureV1',
  version: 1,
  controlId: SANDBOX_BINDING.killControlId,
  controlRevision: SANDBOX_BINDING.killControlRevision,
  bindingRevision: SANDBOX_BINDING.revision,
  sourceState: 'SYNTHETIC_ONLY',
  wiringState: 'WIRED_FIXTURE',
  desiredState: 'DISENGAGED',
  effectiveState: 'DISENGAGED',
  evaluatedAtMs: NOW,
});

export const KILL_READBACK_FIXTURE = Object.freeze({
  ...KILL_READBACK_BASE,
  evidenceDigest: diagnosticKillReadbackDigest(KILL_READBACK_BASE),
});

function retentionReceipt(fields) {
  const receipt = {
    schema: 'AppendRetentionReceiptV1',
    version: 1,
    operation: 'APPEND',
    sequence: 41,
    previousChainDigest: RETENTION_POLICY.expectedPreviousChainDigest,
    payloadDigest: h('trace-payload-placeholder'),
    retainedAtMs: NOW - 1_000,
    minimumRetainUntilMs: NOW + 172_800_000,
    policyRevision: RETENTION_POLICY.revision,
    writerId: 'existing-ledger-adapter',
    verifierId: 'independent-retention-probe',
    readbackState: 'PASS',
    ...fields,
  };
  receipt.chainDigest = appendChainDigest(receipt);
  return Object.freeze(receipt);
}

const DIAGNOSTIC_TRACE_PAYLOAD = Object.freeze({
  schema: 'DiagnosticTracePrivacyRetentionExtensionV1',
  version: 1,
  baseTraceRef: Object.freeze({
    ownerSection: 'IP_ASSURANCE.md#3.9',
    contractName: 'AgentRunTrace',
    reuseMode: 'BASE_REUSED',
    baseRecordDigest: h('base-agent-run-trace'),
  }),
  traceId: 'diagnostic-trace.fixture.1',
  runId: 'diagnostic-run.fixture.1',
  incidentId: 'incident.fixture.1',
  correlationId: 'correlation.fixture.1',
  producerId: 'diagnostic-worker.fixture',
  providerId: SANDBOX_BINDING.providerId,
  environment: SANDBOX_BINDING.environment,
  evidenceRefs: Object.freeze([
    Object.freeze({
      evidenceId: 'ledger-event.fixture.1',
      ownerId: 'existing-ledger',
      digest: h('ledger-event-1'),
      trust: 'UNTRUSTED_DATA',
      rawIncludedInPrompt: false,
    }),
  ]),
  typedOutputDigest: h('typed-output'),
  diffDigest: h('isolated-diff'),
  disposition: 'TYPED_PROPOSAL_ONLY',
  privacy: Object.freeze({
    policyRevision: SANDBOX_BINDING.privacyPolicyRevision,
    classification: 'SENSITIVE_REDACTED',
    redactionState: 'PASS',
    secretScanState: 'PASS',
    instructionSeparation: 'PASS',
    rawEvidencePlacement: 'HASH_ONLY',
    accessTier: 'ASSURANCE_RESTRICTED',
  }),
});

export const APPEND_RECEIPT = retentionReceipt({ payloadDigest: sha256Hex(DIAGNOSTIC_TRACE_PAYLOAD) });

export const DIAGNOSTIC_TRACE = Object.freeze({
  ...DIAGNOSTIC_TRACE_PAYLOAD,
  retentionReceipts: Object.freeze([APPEND_RECEIPT]),
});

function check(checkId, label, verifierId = undefined) {
  return Object.freeze({
    checkId,
    status: 'PASS',
    evidenceDigest: h(label),
    ...(verifierId ? { verifierId } : {}),
  });
}

export const REPAIR_EVIDENCE = Object.freeze({
  schema: 'RepairEvidenceBundleV1',
  version: 1,
  campaignId: 'repair-campaign.fixture.1',
  actionId: 'repair-action.fixture.1',
  fingerprint: 'failure-fingerprint.fixture.1',
  policyRevision: REPAIR_POLICY.revision,
  artifactDigest: DIAGNOSTIC_TRACE.diffDigest,
  producerId: 'diagnostic-worker.fixture',
  executorId: 'canonical-control.fixture',
  actionState: 'COMPLETED',
  beforeStateDigest: h('repair-before'),
  afterStateDigest: h('repair-after'),
  lease: Object.freeze({
    resourceIds: Object.freeze(['resource.fixture.worker-1']),
    ownerId: 'canonical-control.fixture',
    completionOwnerId: 'canonical-control.fixture',
    epoch: 7,
    acquiredAtMs: NOW - 12_000,
    expiresAtMs: NOW + 10_000,
    completedAtMs: NOW - 7_000,
  }),
  producerReport: Object.freeze({ state: 'HEALTHY', reportedAtMs: NOW - 6_500 }),
  verifier: Object.freeze({
    verifierId: 'independent-sentinel.fixture',
    relationship: 'INDEPENDENT',
    status: 'PASS',
    observedAtMs: NOW - 1_000,
    evidenceDigest: h('repair-independent-readback'),
  }),
  tests: Object.freeze([check('repair-success-path', 'repair-test-success'), check('repair-failure-path', 'repair-test-failure')]),
  counterexamples: Object.freeze([check('repair-counterexample', 'repair-counterexample')]),
  postconditions: Object.freeze([check('repair-postcondition', 'repair-postcondition', 'independent-sentinel.fixture')]),
  quietPeriod: Object.freeze({ requiredMs: 5_000, startedAtMs: NOW - 6_000, observedThroughMs: NOW - 1_000, breachCount: 0 }),
  rollback: Object.freeze({ required: true, status: 'PASS', evidenceDigest: h('rollback-proof') }),
  compensation: Object.freeze({ required: false, status: 'NOT_REQUIRED', evidenceDigest: h('compensation-not-required') }),
  traceId: DIAGNOSTIC_TRACE.traceId,
  incidentId: DIAGNOSTIC_TRACE.incidentId,
});

function candidate(className, policy) {
  const candidateId = `self-correction.fixture.${className}`;
  const artifactDigest = DIAGNOSTIC_TRACE.diffDigest;
  const rollbackPlanDigest = h(`candidate-${className}-rollback`);
  const capabilities = Object.freeze(['PROPOSE_TYPED_ACTION']);
  const effectFlags = Object.freeze([...policy.allowedEffectFlags]);
  const registeredCommandId = null;
  const tests = Object.freeze([check(
    `candidate-${className}-success`,
    `candidate-${className}-test`,
    `independent-candidate-test-verifier.fixture.${className}`,
  )]);
  const approvalExpiresAtMs = NOW + 30_000;
  const approverId = `human-assurance-owner.fixture.${className}`;
  const approvalRef = `approval.fixture.class-${className}`;
  const approvalStatus = policy.requiresApproval ? 'APPROVED' : 'NOT_REQUIRED';
  const holdoutBase = Object.freeze({
    status: policy.requiresHoldout ? 'PASS' : 'NOT_REQUIRED',
    verifierId: `independent-holdout-verifier.fixture.${className}`,
    relationship: 'INDEPENDENT',
    candidateId,
    candidateRevision: 1,
    artifactDigest,
    environment: SANDBOX_BINDING.environment,
    policyRevision: 1,
  });
  const approvalBindingDigest = sha256Hex({
    approvalRef,
    candidateId,
    candidateRevision: 1,
    policyId: policy.policyId,
    artifactDigest,
    environment: SANDBOX_BINDING.environment,
    policyRevision: 1,
    capabilities: stableUnique(capabilities),
    effectFlags: stableUnique(effectFlags),
    rollbackPlanDigest,
    approverId,
    expiresAtMs: approvalExpiresAtMs,
  });
  const approval = Object.freeze({
    status: approvalStatus,
    approvalRef,
    approverId,
    candidateId,
    artifactDigest,
    environment: SANDBOX_BINDING.environment,
    policyRevision: 1,
    capabilities,
    effectFlags,
    rollbackPlanDigest,
    bindingDigest: approvalBindingDigest,
    expiresAtMs: approvalExpiresAtMs,
  });
  const verifierBase = Object.freeze({
    verifierId: 'independent-promotion-verifier.fixture',
    relationship: 'INDEPENDENT',
    status: 'PASS',
  });
  const candidateBase = {
    schema: 'SelfCorrectionCandidateV1',
    version: 1,
    candidateId,
    revision: 1,
    declaredClass: className,
    policyId: policy.policyId,
    policyRevision: 1,
    traceId: DIAGNOSTIC_TRACE.traceId,
    hypothesis: `Fixture ${className} candidate remains bounded by the accepted class law and canonical owner route.`,
    effectFlags,
    capabilities,
    registeredCommandId,
    artifactDigest,
    evidenceReportDigest: h(`candidate-${className}-evidence`),
    tests,
    independentVerifier: verifierBase,
    expiresAtMs: NOW + 60_000,
    rollback: Object.freeze({ available: true, planDigest: rollbackPlanDigest }),
    holdout: holdoutBase,
    approval,
  };
  const independentVerifier = Object.freeze({
    ...verifierBase,
    evidenceDigest: selfCorrectionVerifierEvidenceDigest({ candidate: candidateBase, policy, verifier: verifierBase }),
  });
  const candidateWithVerifier = { ...candidateBase, independentVerifier };
  const holdout = Object.freeze({
    ...holdoutBase,
    evidenceDigest: selfCorrectionHoldoutEvidenceDigest({ candidate: candidateWithVerifier, policy, holdout: holdoutBase }),
  });
  return Object.freeze({ ...candidateWithVerifier, holdout });
}

const OPAQUE_CLASS_POLICY_FIXTURE = Object.freeze({
  mode: 'OPAQUE_OWNER_BOUND_CLASS',
  route: 'CANONICAL_OWNER_REVIEW_ONLY',
  effectFlag: 'TYPED_EVIDENCE_RECOMMENDATION_ONLY',
  promotionDisposition: 'OWNER_BOUND_EVIDENCE_REVIEW_REQUIRED',
  automaticEligibility: 'NEVER',
  canonicalOwnerRef: 'IP_ASSURANCE.md/7/director-accepted-systemic-deltas',
  basePolicyRef: 'IP_ASSURANCE.md/3.9/subordinate-diagnostic-plane',
  requiresApproval: true,
  requiresRepairEvidence: true,
  requiresCorpusDecision: true,
  requiresHoldout: true,
});

function classPolicy(className) {
  const law = OPAQUE_CLASS_POLICY_FIXTURE;
  const base = {
    schema: 'SelfCorrectionClassPolicyV1',
    version: 1,
    authorityId: `director-supplied-class-policy.fixture.${className}`,
    bindingLawRef: 'IP_ASSURANCE.md#7',
    canonicalOwnerRef: law.canonicalOwnerRef,
    basePolicyRef: law.basePolicyRef,
    registrySnapshotDigest: h('accepted-self-correction-policy-registry-snapshot'),
    registrationReceiptDigest: h(`self-correction-class-${className}-registration-receipt`),
    ownerPreauthorizationDigest: h(`self-correction-class-${className}-owner-preauthorization`),
    policyId: `class-policy.fixture.${className}`,
    revision: 1,
    class: className,
    registered: true,
    mode: law.mode,
    route: law.route,
    automaticEligibility: law.automaticEligibility,
    environment: SANDBOX_BINDING.environment,
    allowedEffectFlags: Object.freeze([law.effectFlag]),
    allowedCapabilities: Object.freeze(['PROPOSE_TYPED_ACTION']),
    registeredCommandIds: Object.freeze([]),
    promotionDisposition: law.promotionDisposition,
    requiresApproval: law.requiresApproval,
    requiresRepairEvidence: law.requiresRepairEvidence,
    requiresCorpusDecision: law.requiresCorpusDecision,
    requiresHoldout: law.requiresHoldout,
  };
  return Object.freeze({ ...base, evidenceDigest: selfCorrectionClassPolicyDigest(base) });
}

export const CLASS_POLICIES = Object.freeze({
  A: classPolicy('A'),
  B: classPolicy('B'),
  C: classPolicy('C'),
  D: classPolicy('D'),
});

export const CLASS_CANDIDATES = Object.freeze({
  A: candidate('A', CLASS_POLICIES.A),
  B: candidate('B', CLASS_POLICIES.B),
  C: candidate('C', CLASS_POLICIES.C),
  D: candidate('D', CLASS_POLICIES.D),
});

const CORPUS_FINGERPRINT = 'failure-fingerprint.fixture.1';
const CORPUS_SOURCE_EVIDENCE_REFS = Object.freeze([
  Object.freeze({ kind: 'LEDGER_EVENT', evidenceId: 'ledger-event.fixture.1', ownerId: 'existing-ledger', digest: h('ledger-event-1') }),
  Object.freeze({ kind: 'TEST', evidenceId: 'test-evidence.fixture.1', ownerId: 'assurance-test-owner', digest: h('repair-test-success') }),
]);

const CORPUS_ITEM_BASE = {
  schema: 'CorpusItemV1',
  version: 1,
  corpusItemId: 'corpus-item.fixture.1',
  fingerprint: CORPUS_FINGERPRINT,
  mutationIntent: 'READ_PROJECTION_ONLY',
  sourceEvidenceRefs: CORPUS_SOURCE_EVIDENCE_REFS,
  retentionTraceId: DIAGNOSTIC_TRACE.traceId,
  provenanceState: 'VERIFIED',
  privacyState: 'SANITIZED',
  secretScanState: 'PASS',
  untrustedInstructionState: 'REMOVED',
  rightsState: 'ALLOWED_INTERNAL',
  poisonState: 'NONE',
  validation: check('corpus-validation', 'corpus-validation', 'independent-corpus-validator.fixture'),
  independentOutcome: Object.freeze({ verifierId: 'independent-corpus-outcome.fixture', relationship: 'INDEPENDENT', status: 'PASS', evidenceDigest: h('corpus-independent-outcome') }),
  partition: Object.freeze({ name: 'TRAIN', assignmentRevision: 'corpus-partition.v1', locked: true }),
  dedup: Object.freeze({ stableKey: corpusStableKey({ fingerprint: CORPUS_FINGERPRINT, sourceEvidenceRefs: CORPUS_SOURCE_EVIDENCE_REFS }), state: 'UNIQUE', existingItemId: null, existingContentDigest: null }),
  atlasProjection: Object.freeze({
    timelineEvidenceIds: Object.freeze(['ledger-event.fixture.1']),
    componentRevisions: Object.freeze([Object.freeze({ componentId: 'diagnostic-worker.fixture', revision: 'fixture-v1' })]),
    triggerCodes: Object.freeze(['INVARIANT_FAILURE']),
    symptomCodes: Object.freeze(['DIAGNOSTIC_WORKER_DEGRADED']),
    failedInvariantIds: Object.freeze(['invariant.fixture.diagnostic-worker']),
    impactCodes: Object.freeze(['CAPITAL_NONE', 'EXPOSURE_NONE', 'LIABILITY_NONE']),
    repairAttemptIds: Object.freeze([REPAIR_EVIDENCE.actionId]),
    independentPostconditionRefs: Object.freeze(['repair-postcondition']),
    causeCodes: Object.freeze(['FIXTURE_FAULT']),
    regressionFixtureIds: Object.freeze(['regression.fixture.agent-boundary']),
    faultSeedIds: Object.freeze(['fault-seed.fixture.agent-boundary']),
    playbookRevisions: Object.freeze(['playbook.fixture-v1']),
    modelRevisions: Object.freeze(['model.stub.fixture-v1']),
    reviewerId: 'independent-corpus-reviewer.fixture',
    postmortemId: 'postmortem.fixture.1',
    actionIds: Object.freeze([REPAIR_EVIDENCE.actionId]),
    recurrenceCount: 1,
  }),
  access: Object.freeze({ tier: 'ASSURANCE_RESTRICTED', policyRevision: 'corpus-access.v1' }),
  retention: Object.freeze({ policyRevision: RETENTION_POLICY.revision, decision: 'RETAIN_APPEND_ONLY', minimumRetainUntilMs: NOW + 172_800_000 }),
  governanceDisposition: Object.freeze({ inclusion: 'INCLUDE', exclusionReasonCodes: Object.freeze([]) }),
};

export const CORPUS_ITEM = Object.freeze({
  ...CORPUS_ITEM_BASE,
  contentDigest: corpusContentDigest(CORPUS_ITEM_BASE),
});

const CORPUS_DEDUP_REGISTRY_BASE = Object.freeze({
  schema: 'CorpusDedupRegistryFixtureV1',
  version: 1,
  revision: 'corpus-dedup-registry.fixture-v1',
  registered: true,
  entries: Object.freeze([]),
});

export const CORPUS_DEDUP_REGISTRY = Object.freeze({
  ...CORPUS_DEDUP_REGISTRY_BASE,
  evidenceDigest: corpusDedupRegistryDigest(CORPUS_DEDUP_REGISTRY_BASE),
});

const EXACT_CORPUS_DEDUP_REGISTRY_BASE = Object.freeze({
  ...CORPUS_DEDUP_REGISTRY_BASE,
  entries: Object.freeze([Object.freeze({
    corpusItemId: 'corpus-item.existing.1',
    stableKey: CORPUS_ITEM.dedup.stableKey,
    sourceProjectionDigest: corpusSourceProjectionDigest(CORPUS_ITEM),
    contentDigest: h('existing-corpus-item-content'),
  })]),
});

export const EXACT_CORPUS_DEDUP_REGISTRY = Object.freeze({
  ...EXACT_CORPUS_DEDUP_REGISTRY_BASE,
  evidenceDigest: corpusDedupRegistryDigest(EXACT_CORPUS_DEDUP_REGISTRY_BASE),
});

const CORPUS_PARTITIONS = Object.freeze({
  train: Object.freeze([CORPUS_ITEM.corpusItemId]),
  validation: Object.freeze([]),
  holdout: Object.freeze([]),
  retrievalOnly: Object.freeze([]),
});
const CORPUS_MANIFEST_INPUT = {
  releaseId: 'corpus-release.fixture.1',
  revision: 1,
  policyRevision: 'corpus-governance.v1',
  partitions: Object.fromEntries(Object.entries(CORPUS_PARTITIONS).map(([name, ids]) => [name, stableUnique(ids)])),
  itemBindings: Object.freeze([Object.freeze({
    corpusItemId: CORPUS_ITEM.corpusItemId,
    stableKey: CORPUS_ITEM.dedup.stableKey,
    contentDigest: CORPUS_ITEM.contentDigest,
    partition: CORPUS_ITEM.partition.name,
  })]),
};

const CORPUS_RELEASE_BASE = Object.freeze({
  schema: 'CorpusReleaseV1',
  version: 1,
  releaseId: CORPUS_MANIFEST_INPUT.releaseId,
  revision: CORPUS_MANIFEST_INPUT.revision,
  policyRevision: CORPUS_MANIFEST_INPUT.policyRevision,
  partitions: CORPUS_PARTITIONS,
  itemBindings: CORPUS_MANIFEST_INPUT.itemBindings,
  holdoutLocked: true,
  manifestDigest: sha256Hex(CORPUS_MANIFEST_INPUT),
  leakageScan: check('corpus-leakage-scan', 'corpus-leakage-scan'),
  reviewer: Object.freeze({ reviewerId: 'independent-corpus-reviewer.fixture', relationship: 'INDEPENDENT', status: 'PASS' }),
});

export const CORPUS_RELEASE = Object.freeze({
  ...CORPUS_RELEASE_BASE,
  reviewer: Object.freeze({
    ...CORPUS_RELEASE_BASE.reviewer,
    evidenceDigest: corpusReleaseReviewEvidenceDigest(CORPUS_RELEASE_BASE),
  }),
});

export const PROVIDER_STUB = Object.freeze({
  configurationState: 'SYNTHETIC_ONLY',
  mode: 'DETERMINISTIC_STUB',
  posture: 'AVAILABLE',
  providerId: SANDBOX_BINDING.providerId,
  modelId: SANDBOX_BINDING.modelId,
  modelVersion: SANDBOX_BINDING.modelVersion,
  policyRevision: SANDBOX_BINDING.policyRevision,
});

export const PROVIDER_NOT_CONFIGURED = Object.freeze({
  configurationState: 'NOT_CONFIGURED',
  mode: 'NOT_CONFIGURED',
  posture: 'NOT_CONFIGURED',
  providerId: null,
  modelId: null,
  modelVersion: null,
  policyRevision: null,
});

export const PROVIDER_SCRIPTED_OUTCOME = Object.freeze({
  schema: 'DeterministicProviderStubOutcomeV1',
  version: 1,
  status: 'TYPED_RESPONSE',
  requestDigest: sha256Hex(DIAGNOSTIC_REQUEST),
  bindingId: SANDBOX_BINDING.bindingId,
  requestId: DIAGNOSTIC_REQUEST.requestId,
  providerId: PROVIDER_STUB.providerId,
  policyRevision: PROVIDER_STUB.policyRevision,
  callOrdinal: 1,
  typedOutput: Object.freeze({
    schema: 'TypedRemediationProposalStubV1',
    version: 1,
    proposalId: 'proposal.fixture.1',
    disposition: 'PROPOSE_TYPED_ACTION',
    actionKind: 'ISOLATED_PATCH_PROPOSAL',
    evidenceDigests: Object.freeze([DIAGNOSTIC_TRACE.evidenceRefs[0].digest]),
    operationalAuthority: 'NONE',
  }),
});

export const OWNER_SNAPSHOT = Object.freeze({
  revision: 1,
  projectionId: 'diagnostic-worker.assurance.fixture',
  owner: 'I08-supervisor-read-model',
  dependencies: Object.freeze(['existing-ledger', 'independent-retention-probe', 'canonical-control-plane']),
  freshness: Object.freeze({ state: 'FRESH', ageMs: 500, evaluatedAtMs: NOW, maxAgeMs: 5_000 }),
  sourceRealm: 'FIXTURE',
  configRevision: 'diagnostic-config.fixture-v1',
  schemaRevision: 'diagnostic-view.v1',
  buildRevision: 'fixture-build.v1',
  lastErrorFingerprint: null,
  supportedControls: Object.freeze([]),
  capitalRelevance: 'NONE',
  desiredState: 'RUNNING',
  observedLifecycle: 'READY',
  capability: 'SYNTHETIC',
  heartbeatAtMs: NOW - 500,
  lastMeaningfulAdvanceAtMs: NOW - 500,
  queueDepth: 1,
  dropCount: 0,
  restartGeneration: 1,
});

export const RUN_VIEW_INPUT = Object.freeze({
  runId: DIAGNOSTIC_TRACE.runId,
  incidentId: DIAGNOSTIC_TRACE.incidentId,
  correlationId: DIAGNOSTIC_TRACE.correlationId,
  deadlineAtMs: NOW + 2_500,
  evidenceDigestCount: DIAGNOSTIC_TRACE.evidenceRefs.length,
  retrievalCount: 1,
  redactionState: 'PASS',
  permissionLevel: DIAGNOSTIC_REQUEST.permissionLevel,
  proposal: Object.freeze({
    proposalId: 'proposal.fixture.1',
    approvalRef: CLASS_CANDIDATES.C.approval.approvalRef,
    approvalStatus: CLASS_CANDIDATES.C.approval.status,
    verifierId: REPAIR_EVIDENCE.verifier.verifierId,
    verifierStatus: REPAIR_EVIDENCE.verifier.status,
    postconditionStatus: 'PASS',
    quietPeriodStatus: 'PASS',
  }),
  budget: Object.freeze({
    callsUsed: 1,
    callsLimit: 1,
    tokensUsed: 800,
    tokensLimit: 2_048,
    costMicrounitsUsed: 12_000,
    costMicrounitsLimit: 25_000,
    latencyMs: 500,
    latencyLimitMs: 2_500,
  }),
});

export const KILL_CONTROL_VIEW = Object.freeze({
  controlId: 'diagnostic-plane.kill',
  desiredState: 'DISENGAGED',
  effectiveState: 'DISENGAGED',
  wiringState: 'PENDING_BACKEND:SET_DIAGNOSTIC_PLANE_KILL',
  pendingCommandId: 'SET_DIAGNOSTIC_PLANE_KILL',
});

export function validSchemaRecords() {
  return [
    ...ACTIVE_IDENTITY_EVENTS,
    SANDBOX_BINDING,
    SANDBOX_NOT_CONFIGURED,
    APPEND_RECEIPT,
    DIAGNOSTIC_TRACE,
    ...Object.values(CLASS_POLICIES),
    ...Object.values(CLASS_CANDIDATES),
    REPAIR_POLICY,
    REPAIR_EVIDENCE,
    CORPUS_ITEM,
    CORPUS_DEDUP_REGISTRY,
    EXACT_CORPUS_DEDUP_REGISTRY,
    CORPUS_RELEASE,
  ].map(clone);
}
