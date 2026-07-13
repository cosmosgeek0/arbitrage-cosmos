import {
  appendChainDigest,
  assertUtcMillis,
  canonicalStringify,
  compareCodeUnits,
  findForbiddenKeys,
  immutableClone,
  makeEvaluation,
  sha256Hex,
  stableUnique,
} from './canonical.mjs';

export const PERMISSION_LEVELS = Object.freeze([
  'OBSERVE_EXPLAIN',
  'BOUNDED_QUERY_REPLAY',
  'PROPOSE_TYPED_ACTION',
  'PATCH_ISOLATED_AND_TEST',
  'OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY',
]);

export const SAFE_DIAGNOSTIC_CAPABILITIES = Object.freeze([
  'READ_REDACTED_EVIDENCE',
  'QUERY_BOUNDED_REPLAY',
  'PROPOSE_TYPED_ACTION',
  'WRITE_ISOLATED_PATCH',
  'RUN_ISOLATED_TESTS',
  'PREPARE_NON_MONEY_HANDOFF',
]);

export const PERMANENTLY_FORBIDDEN_CAPABILITIES = Object.freeze([
  'ARBITRARY_NETWORK',
  'ARBITRARY_SHELL',
  'AUTONOMOUS_DEPLOY',
  'AUTONOMOUS_MERGE',
  'BORROW',
  'CANCEL_ORDER',
  'CHANGE_CAPITAL',
  'CHANGE_HARD_CEILING',
  'CHANGE_LEVERAGE',
  'CHANGE_MARGIN_MODE',
  'CHANGE_RISK',
  'DECLARE_RECOVERY',
  'DELETE_EVIDENCE',
  'EDIT_GUARDRAILS',
  'EDIT_PERMISSIONS',
  'READ_ENVIRONMENT',
  'READ_SECRET',
  'REPAY',
  'RESERVE_CAPITAL',
  'SIGN_ORDER',
  'TRANSFER',
  'WITHDRAW',
  'WRITE_MAIN',
  'WRITE_PRODUCTION_PERSISTENCE',
]);

const FORBIDDEN_CAPABILITY_SET = new Set(PERMANENTLY_FORBIDDEN_CAPABILITIES);
const SAFE_CAPABILITY_SET = new Set(SAFE_DIAGNOSTIC_CAPABILITIES);
const PERMISSION_CAPABILITY_CEILINGS = Object.freeze({
  OBSERVE_EXPLAIN: Object.freeze(['READ_REDACTED_EVIDENCE']),
  BOUNDED_QUERY_REPLAY: Object.freeze(['READ_REDACTED_EVIDENCE', 'QUERY_BOUNDED_REPLAY']),
  PROPOSE_TYPED_ACTION: Object.freeze(['READ_REDACTED_EVIDENCE', 'QUERY_BOUNDED_REPLAY', 'PROPOSE_TYPED_ACTION']),
  PATCH_ISOLATED_AND_TEST: Object.freeze(['READ_REDACTED_EVIDENCE', 'QUERY_BOUNDED_REPLAY', 'PROPOSE_TYPED_ACTION', 'WRITE_ISOLATED_PATCH', 'RUN_ISOLATED_TESTS']),
  OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY: SAFE_DIAGNOSTIC_CAPABILITIES,
});
const SAFE_STUB_TOOL_CAPABILITIES = Object.freeze({
  'fixture.read-redacted': 'READ_REDACTED_EVIDENCE',
  'fixture.query-bounded-replay': 'QUERY_BOUNDED_REPLAY',
  'fixture.propose-typed-action': 'PROPOSE_TYPED_ACTION',
  'fixture.write-isolated-patch': 'WRITE_ISOLATED_PATCH',
  'fixture.run-isolated-tests': 'RUN_ISOLATED_TESTS',
  'fixture.prepare-non-money-handoff': 'PREPARE_NON_MONEY_HANDOFF',
});
const HASH = /^[a-f0-9]{64}$/;
const ACTIVE_IDENTITY_STATES = new Set(['ACTIVE', 'ROTATION_DUE']);
const SELF_CORRECTION_CLASSES = new Set(['A', 'B', 'C', 'D']);
export const IP_ASSURANCE_CLASS_LAW = Object.freeze({
  source: 'c57610c:IP_ASSURANCE.md#7.1',
  packetSha256: '49dcd690275ff35cb32566af307ad572d2a527e06d7388885f98826560968e84',
  classATriggerCodes: Object.freeze([
    'DIAGNOSTIC_COLLECTION',
    'FAILOVER_ACCEPTED_SOURCE',
    'INVALIDATE_CACHE',
    'RECONNECT',
    'RECOVER_TELEMETRY_EXPORT',
    'RESTART_BOUNDED_WORKER',
    'RESYNC_CLOCK',
    'RESNAPSHOT_SEQUENCE_GAP',
    'RESUBSCRIBE',
  ]),
  classATriggerEvidenceRequirements: Object.freeze({
    FAILOVER_ACCEPTED_SOURCE: Object.freeze([
      'BACKUP_PATH_COHERENCE_PROVEN',
      'BACKUP_PATH_CURRENT_PROOF',
      'BACKUP_PATH_IDENTITY_PROVEN',
      'BACKUP_PATH_SAME_TRUTH_SEMANTICS',
    ]),
    RECOVER_TELEMETRY_EXPORT: Object.freeze(['MATERIAL_EVENTS_PRESERVED_OR_VISIBLE_GAP']),
    RESNAPSHOT_SEQUENCE_GAP: Object.freeze(['MATERIAL_EVENTS_PRESERVED_OR_VISIBLE_GAP']),
    RESYNC_CLOCK: Object.freeze(['NO_IN_PROCESS_WALL_CLOCK_STEP']),
  }),
  classBTriggerCodes: Object.freeze([
    'ACCOUNTING_MISMATCH',
    'BORROW_LIABILITY',
    'CAPITAL_AFFECTING_STATE',
    'FUNDING_LIABILITY',
    'PARTIAL_FILL',
    'POSITION_AMBIGUITY',
    'UNKNOWN_EXCHANGE_OUTCOME',
  ]),
  classCTriggerCodes: Object.freeze([
    'AGENT_CODE_CHANGE',
    'AWS_CHANGE',
    'CLOUDFLARE_CHANGE',
    'CONFIGURATION_CHANGE',
    'DEPLOYMENT_CHANGE',
    'HOST_CHANGE',
    'HUMAN_CODE_CHANGE',
    'PROVIDER_ACTIVATION',
    'SECRETS_CHANGE',
    'SERVICE_CHANGE',
  ]),
  classDTriggerCodes: Object.freeze([
    'CALIBRATION_LOSS',
    'LABEL_DRIFT',
    'MODEL_DRIFT',
    'STRATEGY_UNDERPERFORMANCE',
    'UNKNOWN_RESEARCH_EVIDENCE',
    'UNSUPPORTED_COHORT',
  ]),
  classADemotionTriggerCodes: Object.freeze(['ASSUMPTIONS_CHANGED', 'DRIFT_DETECTED', 'RECURRENCE_DETECTED']),
  classAPromotionEvidenceIds: Object.freeze([
    'DETERMINISTIC_FAILURE_REPRODUCTION',
    'EXACT_REGISTERED_COMMAND_IDENTITY',
    'FOCUSED_REGRESSION_FAULT_TESTS',
    'SHADOW_OR_NO_AUTHORITY_EXERCISE',
    'INDEPENDENT_POSTCONDITION_VERIFIER',
    'DECLARED_QUIET_PERIOD_NO_RECURRENCE',
    'OWNER_PREAUTHORIZED_NARROW_CLASS',
    'BOUNDED_RATE_RESOURCE_ATTEMPT_EXPOSURE',
    'AUTOMATIC_DEMOTION_ON_RECURRENCE_DRIFT_OR_CHANGED_ASSUMPTIONS',
  ]),
});
const CLASS_TRIGGER_CODES = Object.freeze({
  A: IP_ASSURANCE_CLASS_LAW.classATriggerCodes,
  B: IP_ASSURANCE_CLASS_LAW.classBTriggerCodes,
  C: IP_ASSURANCE_CLASS_LAW.classCTriggerCodes,
  D: IP_ASSURANCE_CLASS_LAW.classDTriggerCodes,
});
const CLASS_ROUTES = Object.freeze({
  A: 'CANONICAL_CONTROL_PLANE_REGISTERED_COMMAND',
  B: 'CANONICAL_RECONCILIATION_RECOVERY',
  C: 'OWNER_APPROVED_HASH_BOUND_RELEASE',
  D: 'ACCEPTED_Q_RUNTIME_ABSTAIN_OR_DEMOTION',
});
const CLASS_MODES = Object.freeze({
  A: 'REGISTERED_DETERMINISTIC_LOCAL_NON_CAPITAL',
  B: 'CANONICAL_RECOVERY_NEVER_AGENT_REPAIR',
  C: 'OWNER_APPROVED_NORMAL_RELEASE',
  D: 'ABSTAIN_OR_RECOMMEND_DEMOTION',
});
const CLASS_DISPOSITIONS = Object.freeze({
  A: 'CLASS_A_REGISTERED_ELIGIBILITY_PROVEN',
  B: 'CLASS_B_CANONICAL_RECOVERY_REQUIRED',
  C: 'CLASS_C_OWNER_APPROVED_RELEASE_REQUIRED',
  D: 'CLASS_D_ABSTAIN_OR_DEMOTION_REQUIRED',
});
const CLASS_POLICY_EXPECTATIONS = Object.freeze({
  A: Object.freeze({
    automaticEligibility: 'REGISTERED_ONLY',
    effectFlags: Object.freeze(['LOCAL_NON_CAPITAL_CONTROL_COMMAND']),
    registeredCommandIds: Object.freeze(['RESTART_BOUNDED_WORKER']),
    requiresApproval: false,
    requiresRepairEvidence: true,
    requiresCorpusDecision: true,
    requiresHoldout: false,
    shadowRequirement: 'SHADOW_OR_NO_AUTHORITY_REQUIRED',
    externalAuthorizationRequirement: 'NEVER',
    promotionEvidenceIds: IP_ASSURANCE_CLASS_LAW.classAPromotionEvidenceIds,
    requiredTestKinds: Object.freeze(['FAULT', 'FOCUSED', 'REGRESSION']),
    automaticBounds: Object.freeze({ maxAttempts: 2, maxRatePerWindow: 1, maxResourceCount: 1, rateWindowMs: 60_000 }),
  }),
  B: Object.freeze({
    automaticEligibility: 'NEVER',
    effectFlags: Object.freeze(['CANONICAL_RECOVERY_ROUTE_ONLY']),
    registeredCommandIds: Object.freeze([]),
    requiresApproval: false,
    requiresRepairEvidence: false,
    requiresCorpusDecision: true,
    requiresHoldout: false,
    shadowRequirement: 'NOT_REQUIRED',
    externalAuthorizationRequirement: 'NEVER',
    promotionEvidenceIds: Object.freeze([]),
    requiredTestKinds: Object.freeze([]),
    automaticBounds: null,
  }),
  C: Object.freeze({
    automaticEligibility: 'NEVER',
    effectFlags: Object.freeze(['HASH_BOUND_RELEASE_HANDOFF_ONLY']),
    registeredCommandIds: Object.freeze([]),
    requiresApproval: true,
    requiresRepairEvidence: true,
    requiresCorpusDecision: true,
    requiresHoldout: true,
    shadowRequirement: 'NOT_REQUIRED',
    externalAuthorizationRequirement: 'I00_SECTION_20_FOR_EXTERNAL_ACTIVATION',
    promotionEvidenceIds: Object.freeze([]),
    requiredTestKinds: Object.freeze(['FAULT', 'FOCUSED', 'REGRESSION']),
    automaticBounds: null,
  }),
  D: Object.freeze({
    automaticEligibility: 'NEVER',
    effectFlags: Object.freeze(['ABSTAIN_OR_DEMOTION_RECOMMENDATION_ONLY']),
    registeredCommandIds: Object.freeze([]),
    requiresApproval: false,
    requiresRepairEvidence: false,
    requiresCorpusDecision: true,
    requiresHoldout: false,
    shadowRequirement: 'NOT_REQUIRED',
    externalAuthorizationRequirement: 'NEVER',
    promotionEvidenceIds: Object.freeze([]),
    requiredTestKinds: Object.freeze([]),
    automaticBounds: null,
  }),
});
const EXTERNAL_CLASS_C_TRIGGERS = new Set([
  'AWS_CHANGE', 'CLOUDFLARE_CHANGE', 'CONFIGURATION_CHANGE', 'DEPLOYMENT_CHANGE',
  'HOST_CHANGE', 'PROVIDER_ACTIVATION', 'SECRETS_CHANGE', 'SERVICE_CHANGE',
]);
const PERMANENTLY_FORBIDDEN_EFFECTS = new Set([
  'ARBITRARY_NETWORK', 'ARBITRARY_SHELL', 'AUTONOMOUS_DEPLOY', 'AUTONOMOUS_MERGE',
  'CAPITAL', 'EVIDENCE_DELETION', 'GUARDRAIL', 'HARD_CEILING', 'MONEY', 'PERMISSION',
  'PRODUCTION_PERSISTENCE', 'RISK',
]);
const SELF_CORRECTION_CLASS_POLICY_KEYS = Object.freeze([
  'allowedCapabilities', 'allowedEffectFlags', 'authorityId', 'automaticEligibility', 'basePolicyRef',
  'bindingLawRef', 'canonicalOwnerRef', 'class', 'demotionTriggerCodes', 'environment', 'evidenceDigest',
  'externalAuthorizationRequirement', 'mode', 'ownerLawDigest', 'ownerPreauthorizationDigest',
  'policyId', 'promotionDisposition', 'registered', 'registeredCommandIds', 'registrationReceiptDigest',
  'registrySnapshotDigest', 'requiredTestKinds', 'requiresApproval', 'requiresCorpusDecision',
  'requiresHoldout', 'requiresRepairEvidence', 'revision', 'route', 'schema', 'shadowRequirement',
  'triggerCodes', 'version', 'automaticBounds', 'promotionEvidenceIds',
]);
const SELF_CORRECTION_CANDIDATE_KEYS = Object.freeze([
  'approval', 'artifactDigest', 'candidateId', 'capabilities', 'declaredClass', 'effectFlags',
  'bounds', 'demotionGuard', 'evidenceReportDigest', 'expiresAtMs', 'failureReproduction', 'holdout',
  'hypothesis', 'independentVerifier', 'policyId', 'policyRevision', 'quietPeriod', 'registeredCommandId',
  'revision', 'rollback', 'schema', 'shadowExercise', 'tests', 'traceId', 'trigger', 'version',
]);
const SELF_CORRECTION_AUTOMATIC_BOUNDS_KEYS = Object.freeze([
  'maxAttempts', 'maxRatePerWindow', 'maxResourceCount', 'rateWindowMs',
]);
const SELF_CORRECTION_TRIGGER_KEYS = Object.freeze(['deterministic', 'evidenceDigest', 'status', 'triggerCode']);
const SELF_CORRECTION_FAILURE_REPRODUCTION_KEYS = Object.freeze([
  'deterministic', 'evidenceDigest', 'fixtureId', 'status',
]);
const SELF_CORRECTION_SHADOW_KEYS = Object.freeze([
  'authorityEffect', 'evidenceDigest', 'mode', 'status',
]);
const SELF_CORRECTION_QUIET_PERIOD_KEYS = Object.freeze([
  'evidenceDigest', 'observedMs', 'recurrenceCount', 'requiredMs', 'status',
]);
const SELF_CORRECTION_BOUNDS_KEYS = Object.freeze([
  'attemptLimit', 'capitalEffect', 'evidenceDigest', 'exposureEffect', 'externalEnvironmentEffect',
  'rateLimitPerWindow', 'rateWindowMs', 'resourceIds', 'resourceLimit', 'status',
]);
const SELF_CORRECTION_DEMOTION_KEYS = Object.freeze([
  'activeTriggerCodes', 'automatic', 'evidenceDigest', 'monitoredTriggerCodes', 'status',
]);
const REPAIR_EVIDENCE_POLICY_KEYS = Object.freeze([
  'allowedActionIds', 'allowedExecutorIds', 'allowedProducerIds', 'authorityId', 'basePolicyRef',
  'bindingLawRef', 'evidenceDigest', 'minimumQuietPeriodMs', 'ownerPreauthorizationDigest',
  'registrySnapshotDigest', 'requiredCounterexampleCheckIds', 'requiredPostconditionCheckIds',
  'requiredResourceIds', 'requiredTestCheckIds', 'requiresCompensation', 'requiresRollback',
  'revision', 'schema', 'version',
]);
const REPAIR_EVIDENCE_BUNDLE_KEYS = Object.freeze([
  'actionId', 'actionState', 'afterStateDigest', 'artifactDigest', 'beforeStateDigest', 'campaignId',
  'compensation', 'counterexamples', 'executorId', 'fingerprint', 'incidentId', 'lease', 'policyRevision',
  'postconditions', 'producerId', 'producerReport', 'quietPeriod', 'rollback', 'schema', 'tests', 'traceId',
  'verifier', 'version',
]);
const REPAIR_LEASE_KEYS = Object.freeze([
  'acquiredAtMs', 'completedAtMs', 'completionOwnerId', 'epoch', 'expiresAtMs', 'ownerId', 'resourceIds',
]);
const REPAIR_PRODUCER_REPORT_KEYS = Object.freeze(['reportedAtMs', 'state']);
const REPAIR_VERIFIER_KEYS = Object.freeze(['evidenceDigest', 'observedAtMs', 'relationship', 'status', 'verifierId']);
const EVIDENCE_CHECK_KEYS = Object.freeze(['checkId', 'evidenceDigest', 'status']);
const VERIFIED_EVIDENCE_CHECK_KEYS = Object.freeze([...EVIDENCE_CHECK_KEYS, 'verifierId']);
const REPAIR_QUIET_PERIOD_KEYS = Object.freeze(['breachCount', 'observedThroughMs', 'requiredMs', 'startedAtMs']);
const REPAIR_CONTINGENCY_KEYS = Object.freeze(['evidenceDigest', 'required', 'status']);
const CORPUS_SOURCE_REFERENCE_KEYS = Object.freeze(['digest', 'evidenceId', 'kind', 'ownerId']);
const CORPUS_INDEPENDENT_OUTCOME_KEYS = Object.freeze(['evidenceDigest', 'relationship', 'status', 'verifierId']);
const CORPUS_PARTITION_KEYS = Object.freeze(['assignmentRevision', 'locked', 'name']);
const CORPUS_DEDUP_KEYS = Object.freeze(['existingContentDigest', 'existingItemId', 'stableKey', 'state']);
const CORPUS_ATLAS_KEYS = Object.freeze([
  'actionIds', 'causeCodes', 'componentRevisions', 'failedInvariantIds', 'faultSeedIds', 'impactCodes',
  'independentPostconditionRefs', 'modelRevisions', 'playbookRevisions', 'postmortemId', 'recurrenceCount',
  'regressionFixtureIds', 'repairAttemptIds', 'reviewerId', 'symptomCodes', 'timelineEvidenceIds', 'triggerCodes',
]);
const CORPUS_COMPONENT_REVISION_KEYS = Object.freeze(['componentId', 'revision']);
const CORPUS_ACCESS_KEYS = Object.freeze(['policyRevision', 'tier']);
const CORPUS_RETENTION_KEYS = Object.freeze(['decision', 'minimumRetainUntilMs', 'policyRevision']);
const CORPUS_GOVERNANCE_DISPOSITION_KEYS = Object.freeze(['exclusionReasonCodes', 'inclusion']);
const CORPUS_RELEASE_KEYS = Object.freeze([
  'holdoutLocked', 'itemBindings', 'leakageScan', 'manifestDigest', 'partitions', 'policyRevision',
  'releaseId', 'reviewer', 'revision', 'schema', 'version',
]);
const CORPUS_RELEASE_PARTITION_KEYS = Object.freeze(['holdout', 'retrievalOnly', 'train', 'validation']);
const CORPUS_RELEASE_ITEM_BINDING_KEYS = Object.freeze(['contentDigest', 'corpusItemId', 'partition', 'stableKey']);
const CORPUS_RELEASE_REVIEWER_KEYS = Object.freeze(['evidenceDigest', 'relationship', 'reviewerId', 'status']);
const EVALUATION_PASS_COMMON_KEYS = Object.freeze([
  'allowed', 'decisionDigest', 'decisionKind', 'disposition', 'evaluatedAtMs', 'evidenceRefs',
  'productReadinessImpact', 'reasonCodes', 'schema', 'sourceEvidenceDigest', 'status', 'version',
]);
const EVALUATION_PASS_KEYS = Object.freeze({
  WORKLOAD_IDENTITY: Object.freeze([...EVALUATION_PASS_COMMON_KEYS,
    'audience', 'bindingId', 'capabilityDigest', 'diagnosticAuthorityEffect', 'environment',
    'expiresAtMs', 'generation', 'identityRef', 'identityState', 'providerId', 'rotationDueAtMs',
    'subjectDigest']),
  TRACE_PRIVACY_RETENTION: Object.freeze([...EVALUATION_PASS_COMMON_KEYS,
    'accessTier', 'correlationId', 'diffDigest', 'environment', 'forbiddenFieldPaths', 'incidentId',
    'lastAppendSequence', 'lastChainDigest', 'privacyPolicyRevision', 'retentionCoverageUntilMs',
    'retentionOwnerId', 'retentionPolicyRevision', 'retentionVerifierId', 'retentionVerifierIds',
    'retentionWriterIds', 'runId', 'traceId', 'tracePolicyDigest', 'traceProducerId', 'traceProviderId',
    'typedOutputDigest']),
  REPAIR_EVIDENCE: Object.freeze([...EVALUATION_PASS_COMMON_KEYS,
    'actionId', 'artifactDigest', 'campaignId', 'eligibleForCanonicalRecoveryReadback', 'executorId',
    'incidentId', 'mayDeclareRecovery', 'policyDigest', 'policyRevision', 'postconditionStatus',
    'producerClaim', 'producerId', 'quietPeriodStatus', 'traceDecisionDigest', 'traceId', 'verifierId', 'verifierStatus']),
  CORPUS_ITEM_GOVERNANCE: Object.freeze([...EVALUATION_PASS_COMMON_KEYS,
    'appendOnlyEvidenceDeletionAllowed', 'canonicalEvidenceMutationAllowed', 'contentDigest',
    'corpusItemId', 'dedupRegistryEvidenceDigest', 'dedupRegistryRevision', 'dedupTargetContentDigest', 'dedupTargetId',
    'outcomeVerifierId', 'partition', 'retentionOwnerId', 'retentionTraceId', 'traceDecisionDigest',
    'retentionVerifierId', 'retentionVerifierIds', 'retentionWriterIds', 'sourceOwnerIds', 'stableKey',
    'validationVerifierId']),
  SELF_CORRECTION_PROMOTION: Object.freeze([...EVALUATION_PASS_COMMON_KEYS,
    'activeDemotionTriggerCodes', 'automaticDemotionRequired', 'automaticEligibility',
    'approvalRef', 'approvalStatus', 'artifactDigest', 'candidateId', 'candidateRevision',
    'boundsStatus', 'candidateBounds', 'classRoute', 'declaredClass', 'demotionStatus',
    'derivedClass', 'effectiveClass',
    'externalAuthorizationRequired', 'failureReproductionStatus', 'independentVerifierStatus',
    'mayDeclareRecovery', 'monitoredDemotionTriggerCodes', 'operationalActionAllowed',
    'ownerLawDigest', 'ownerPreauthorizationStatus', 'policyBounds', 'policyEvidenceDigest',
    'policyId', 'policyRevision', 'promotionEvidenceIds',
    'promotionEvidenceSatisfied', 'quietPeriodStatus', 'registeredCommandId', 'shadowExerciseMode',
    'shadowExerciseStatus', 'shadowRequirement', 'satisfiedTriggerEvidenceIds', 'testEvidenceStatus',
    'traceDecisionDigest', 'traceId', 'triggerCode', 'triggerStatus', 'requiredTriggerEvidenceIds',
    'validUntilMs']),
});
const WORKLOAD_IDENTITY_EVENT_KEYS = Object.freeze([
  'audience', 'bindingId', 'capabilityDigest', 'environment', 'evidenceHash', 'expiresAtMs',
  'generation', 'identityRef', 'notBeforeMs', 'observedAtMs', 'providerId', 'rotationDueAtMs',
  'schema', 'sequence', 'subjectDigest', 'type', 'version',
]);
const SANDBOX_BINDING_KEYS = Object.freeze([
  'allowedCapabilities', 'allowedResourceDigests', 'allowedToolIds', 'approvalEvidenceDigest',
  'approvalRef', 'bindingId', 'budget', 'configurationState', 'egressAllowlist', 'environment',
  'expiresAtMs', 'forbiddenCapabilities', 'issuedAtMs', 'killControlId', 'killControlRevision',
  'killReadbackMaxAgeMs', 'modelId', 'modelVersion', 'networkPolicy', 'permissionLevel',
  'policyRevision', 'privacyPolicyRevision', 'providerId', 'providerMode', 'retentionPolicyRevision',
  'revision', 'schema', 'toolCapabilityBindings', 'version', 'workloadAudience',
  'workloadCapabilityDigest', 'workloadIdentityRef', 'workloadSubjectDigest', 'workspace',
]);
const DIAGNOSTIC_REQUEST_KEYS = Object.freeze([
  'approvalRef', 'baseContractRef', 'budget', 'capabilities', 'environment', 'identityRef',
  'modelId', 'modelVersion', 'permissionLevel', 'policyRevision', 'providerId', 'requestId',
  'resourceDigests', 'schema', 'toolIds', 'untrustedContentDigests', 'version',
]);
const BASE_DIAGNOSTIC_APPROVAL_KEYS = Object.freeze([
  'approvalRef', 'approverId', 'baseContractRef', 'capabilities', 'environment', 'evidenceDigest',
  'expiresAtMs', 'maximumEffect', 'modelId', 'modelVersion', 'policyRevision', 'requestDigest',
  'requestId', 'rollbackPlanDigest', 'schema', 'status', 'version',
]);
const KILL_READBACK_KEYS = Object.freeze([
  'bindingRevision', 'controlId', 'controlRevision', 'desiredState', 'effectiveState',
  'evaluatedAtMs', 'evidenceDigest', 'schema', 'sourceState', 'version', 'wiringState',
]);
const TRACE_RETENTION_POLICY_KEYS = Object.freeze([
  'allowedAccessTiers', 'anchorEvidenceDigest', 'expectedFirstSequence', 'expectedPreviousChainDigest',
  'minimumRetentionMs', 'privacyPolicyRevision', 'revision',
]);
const TRACE_EXTENSION_KEYS = Object.freeze([
  'baseTraceRef', 'correlationId', 'diffDigest', 'disposition', 'environment', 'evidenceRefs',
  'incidentId', 'privacy', 'producerId', 'providerId', 'retentionReceipts', 'runId', 'schema',
  'traceId', 'typedOutputDigest', 'version',
]);
const TRACE_EVIDENCE_REFERENCE_KEYS = Object.freeze([
  'digest', 'evidenceId', 'ownerId', 'rawIncludedInPrompt', 'trust',
]);
const RETENTION_RECEIPT_KEYS = Object.freeze([
  'chainDigest', 'minimumRetainUntilMs', 'operation', 'payloadDigest', 'policyRevision',
  'previousChainDigest', 'readbackState', 'retainedAtMs', 'schema', 'sequence', 'verifierId',
  'version', 'writerId',
]);
const CORPUS_ITEM_KEYS = Object.freeze([
  'access', 'atlasProjection', 'contentDigest', 'corpusItemId', 'dedup', 'fingerprint',
  'governanceDisposition', 'independentOutcome', 'mutationIntent', 'partition', 'poisonState',
  'privacyState', 'provenanceState', 'retention', 'retentionTraceId', 'rightsState', 'schema',
  'secretScanState', 'sourceEvidenceRefs', 'untrustedInstructionState', 'validation', 'version',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function allStrings(values) {
  return Array.isArray(values) && values.every(isNonEmptyString);
}

function uniqueStrings(values) {
  return allStrings(values) && new Set(values).size === values.length;
}

function hasExactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && canonicalStringify(Object.keys(value).sort()) === canonicalStringify([...expected].sort());
}

function exactSubset(requested, allowed) {
  if (!allStrings(requested) || !allStrings(allowed)) return false;
  const allowedSet = new Set(allowed);
  return requested.every((entry) => allowedSet.has(entry));
}

function canonicalEqual(left, right) {
  try {
    return canonicalStringify(left) === canonicalStringify(right);
  } catch {
    return false;
  }
}

function hasHash(value) {
  return typeof value === 'string' && HASH.test(value);
}

function statusReason(decision, prefix) {
  if (!decision || !['PASS', 'FAIL', 'UNKNOWN'].includes(decision.status)) return `${prefix}_MISSING`;
  return decision.status === 'PASS' ? null : `${prefix}_${decision.status}`;
}

export function decisionContractDigest(decision) {
  const common = {
    schema: decision?.schema ?? null,
    version: decision?.version ?? null,
    status: decision?.status ?? null,
    disposition: decision?.disposition ?? null,
    allowed: decision?.allowed ?? null,
    productReadinessImpact: decision?.productReadinessImpact ?? null,
    evaluatedAtMs: decision?.evaluatedAtMs ?? null,
    reasonCodes: stableUnique(decision?.reasonCodes ?? []),
    evidenceRefs: stableUnique(decision?.evidenceRefs ?? []),
    decisionKind: decision?.decisionKind ?? null,
    sourceEvidenceDigest: decision?.sourceEvidenceDigest ?? null,
  };
  if (decision?.decisionKind === 'SANDBOX_BINDING') {
    return sha256Hex({ ...common, providerInvocationMode: decision.providerInvocationMode ?? null,
      operationalAuthorityEffect: decision.operationalAuthorityEffect ?? null,
      bindingId: decision.bindingId ?? null, requestId: decision.requestId ?? null,
      requestDigest: decision.requestDigest ?? null, providerId: decision.providerId ?? null,
      modelId: decision.modelId ?? null, modelVersion: decision.modelVersion ?? null,
      policyRevision: decision.policyRevision ?? null, permissionLevel: decision.permissionLevel ?? null,
      identityRef: decision.identityRef ?? null, workloadAudience: decision.workloadAudience ?? null,
      workloadCapabilityDigest: decision.workloadCapabilityDigest ?? null,
      workloadSubjectDigest: decision.workloadSubjectDigest ?? null, environment: decision.environment ?? null,
      identityDecisionDigest: decision.identityDecisionDigest ?? null,
      traceDecisionDigest: decision.traceDecisionDigest ?? null,
      capabilities: stableUnique(decision.capabilities ?? []), toolIds: stableUnique(decision.toolIds ?? []),
      expiresAtMs: decision.expiresAtMs ?? null, maxCalls: decision.maxCalls ?? null,
      boundaryDigest: decision.boundaryDigest ?? null,
      forbiddenFieldPaths: stableUnique(decision.forbiddenFieldPaths ?? []),
      stubEligible: decision.stubEligible ?? null });
  }
  if (decision?.decisionKind === 'WORKLOAD_IDENTITY') {
    return sha256Hex({ ...common, identityState: decision.identityState ?? null, generation: decision.generation ?? null,
      identityRef: decision.identityRef ?? null, providerId: decision.providerId ?? null, bindingId: decision.bindingId ?? null,
      audience: decision.audience ?? null, environment: decision.environment ?? null, capabilityDigest: decision.capabilityDigest ?? null,
      subjectDigest: decision.subjectDigest ?? null,
      expiresAtMs: decision.expiresAtMs ?? null, rotationDueAtMs: decision.rotationDueAtMs ?? null,
      diagnosticAuthorityEffect: decision.diagnosticAuthorityEffect ?? null });
  }
  if (decision?.decisionKind === 'TRACE_PRIVACY_RETENTION') {
    return sha256Hex({ ...common, traceId: decision.traceId ?? null, privacyPolicyRevision: decision.privacyPolicyRevision ?? null,
      retentionPolicyRevision: decision.retentionPolicyRevision ?? null, retentionCoverageUntilMs: decision.retentionCoverageUntilMs ?? null,
      tracePolicyDigest: decision.tracePolicyDigest ?? null,
      accessTier: decision.accessTier ?? null, diffDigest: decision.diffDigest ?? null, typedOutputDigest: decision.typedOutputDigest ?? null,
      lastAppendSequence: decision.lastAppendSequence ?? null, lastChainDigest: decision.lastChainDigest ?? null,
      retentionOwnerId: decision.retentionOwnerId ?? null, retentionVerifierId: decision.retentionVerifierId ?? null,
      retentionWriterIds: stableUnique(decision.retentionWriterIds ?? []),
      retentionVerifierIds: stableUnique(decision.retentionVerifierIds ?? []),
      traceProducerId: decision.traceProducerId ?? null, traceProviderId: decision.traceProviderId ?? null,
      runId: decision.runId ?? null, incidentId: decision.incidentId ?? null, correlationId: decision.correlationId ?? null,
      environment: decision.environment ?? null });
  }
  if (decision?.decisionKind === 'CORPUS_ITEM_GOVERNANCE') {
    return sha256Hex({ ...common, corpusItemId: decision.corpusItemId ?? null, stableKey: decision.stableKey ?? null,
      contentDigest: decision.contentDigest ?? null, retentionTraceId: decision.retentionTraceId ?? null,
      traceDecisionDigest: decision.traceDecisionDigest ?? null,
      partition: decision.partition ?? null, canonicalEvidenceMutationAllowed: decision.canonicalEvidenceMutationAllowed ?? null,
      appendOnlyEvidenceDeletionAllowed: decision.appendOnlyEvidenceDeletionAllowed ?? null,
      validationVerifierId: decision.validationVerifierId ?? null, outcomeVerifierId: decision.outcomeVerifierId ?? null,
      retentionOwnerId: decision.retentionOwnerId ?? null, retentionVerifierId: decision.retentionVerifierId ?? null,
      retentionWriterIds: stableUnique(decision.retentionWriterIds ?? []),
      retentionVerifierIds: stableUnique(decision.retentionVerifierIds ?? []),
      dedupRegistryRevision: decision.dedupRegistryRevision ?? null,
      dedupRegistryEvidenceDigest: decision.dedupRegistryEvidenceDigest ?? null,
      dedupTargetId: decision.dedupTargetId ?? null,
      dedupTargetContentDigest: decision.dedupTargetContentDigest ?? null,
      sourceOwnerIds: stableUnique(decision.sourceOwnerIds ?? []) });
  }
  if (decision?.decisionKind === 'REPAIR_EVIDENCE') {
    return sha256Hex({ ...common, campaignId: decision.campaignId ?? null, actionId: decision.actionId ?? null,
      artifactDigest: decision.artifactDigest ?? null, policyRevision: decision.policyRevision ?? null,
      policyDigest: decision.policyDigest ?? null,
      traceId: decision.traceId ?? null, traceDecisionDigest: decision.traceDecisionDigest ?? null,
      incidentId: decision.incidentId ?? null,
      producerClaim: decision.producerClaim ?? null,
      producerId: decision.producerId ?? null, executorId: decision.executorId ?? null,
      verifierId: decision.verifierId ?? null, verifierStatus: decision.verifierStatus ?? null,
      postconditionStatus: decision.postconditionStatus ?? null, quietPeriodStatus: decision.quietPeriodStatus ?? null,
      eligibleForCanonicalRecoveryReadback: decision.eligibleForCanonicalRecoveryReadback ?? null,
      mayDeclareRecovery: decision.mayDeclareRecovery ?? null });
  }
  if (decision?.decisionKind === 'SELF_CORRECTION_PROMOTION') {
    return sha256Hex({ ...common, candidateId: decision.candidateId ?? null, candidateRevision: decision.candidateRevision ?? null,
      policyId: decision.policyId ?? null, policyRevision: decision.policyRevision ?? null,
      policyEvidenceDigest: decision.policyEvidenceDigest ?? null,
      traceId: decision.traceId ?? null, traceDecisionDigest: decision.traceDecisionDigest ?? null,
      artifactDigest: decision.artifactDigest ?? null,
      classRoute: decision.classRoute ?? null, registeredCommandId: decision.registeredCommandId ?? null,
      approvalRef: decision.approvalRef ?? null, approvalStatus: decision.approvalStatus ?? null,
      declaredClass: decision.declaredClass ?? null, derivedClass: decision.derivedClass ?? null,
      effectiveClass: decision.effectiveClass ?? null, triggerCode: decision.triggerCode ?? null,
      triggerStatus: decision.triggerStatus ?? null,
      requiredTriggerEvidenceIds: stableUnique(Array.isArray(decision.requiredTriggerEvidenceIds)
        ? decision.requiredTriggerEvidenceIds : []),
      satisfiedTriggerEvidenceIds: stableUnique(Array.isArray(decision.satisfiedTriggerEvidenceIds)
        ? decision.satisfiedTriggerEvidenceIds : []),
      failureReproductionStatus: decision.failureReproductionStatus ?? null,
      testEvidenceStatus: decision.testEvidenceStatus ?? null,
      shadowRequirement: decision.shadowRequirement ?? null,
      shadowExerciseMode: decision.shadowExerciseMode ?? null,
      shadowExerciseStatus: decision.shadowExerciseStatus ?? null,
      independentVerifierStatus: decision.independentVerifierStatus ?? null,
      quietPeriodStatus: decision.quietPeriodStatus ?? null,
      ownerPreauthorizationStatus: decision.ownerPreauthorizationStatus ?? null,
      ownerLawDigest: decision.ownerLawDigest ?? null,
      boundsStatus: decision.boundsStatus ?? null,
      policyBounds: decision.policyBounds ?? null,
      candidateBounds: decision.candidateBounds ?? null,
      demotionStatus: decision.demotionStatus ?? null,
      monitoredDemotionTriggerCodes: stableUnique(Array.isArray(decision.monitoredDemotionTriggerCodes)
        ? decision.monitoredDemotionTriggerCodes : []),
      promotionEvidenceIds: stableUnique(Array.isArray(decision.promotionEvidenceIds) ? decision.promotionEvidenceIds : []),
      promotionEvidenceSatisfied: stableUnique(Array.isArray(decision.promotionEvidenceSatisfied) ? decision.promotionEvidenceSatisfied : []),
      activeDemotionTriggerCodes: stableUnique(Array.isArray(decision.activeDemotionTriggerCodes) ? decision.activeDemotionTriggerCodes : []),
      automaticEligibility: decision.automaticEligibility ?? null,
      automaticDemotionRequired: decision.automaticDemotionRequired ?? null,
      externalAuthorizationRequired: decision.externalAuthorizationRequired ?? null,
      operationalActionAllowed: decision.operationalActionAllowed ?? null,
      mayDeclareRecovery: decision.mayDeclareRecovery ?? null, validUntilMs: decision.validUntilMs ?? null });
  }
  return null;
}

function sealedEvidencePass(nowMs, disposition, evidenceRefs, extra) {
  const normalizedEvidenceRefs = stableUnique(evidenceRefs);
  const normalized = {
    schema: 'AgentBoundaryEvaluationV1',
    version: 1,
    status: 'PASS',
    disposition,
    allowed: false,
    productReadinessImpact: 'NONE',
    evaluatedAtMs: nowMs,
    reasonCodes: [],
    evidenceRefs: normalizedEvidenceRefs,
    ...extra,
  };
  return pass(nowMs, disposition, normalizedEvidenceRefs, {
    ...extra,
    decisionDigest: decisionContractDigest(normalized),
  });
}

export function isEvaluationEnvelope(decision, nowMs, decisionKind) {
  const commonValid = Boolean(
    decision
    && decision.schema === 'AgentBoundaryEvaluationV1'
    && decision.version === 1
    && decision.decisionKind === decisionKind
    && ['PASS', 'FAIL', 'UNKNOWN'].includes(decision.status)
    && decision.allowed === false
    && Number.isSafeInteger(decision.evaluatedAtMs)
    && decision.evaluatedAtMs <= nowMs
    && Array.isArray(decision.reasonCodes)
    && allStrings(decision.reasonCodes)
    && new Set(decision.reasonCodes).size === decision.reasonCodes.length
    && Array.isArray(decision.evidenceRefs)
    && decision.evidenceRefs.every(hasHash)
    && new Set(decision.evidenceRefs).size === decision.evidenceRefs.length
    && hasHash(decision.sourceEvidenceDigest)
  );
  if (!commonValid) return false;
  const allowedEnvelopeKeys = new Set(EVALUATION_PASS_KEYS[decisionKind] ?? []);
  if (Object.keys(decision).some((key) => !allowedEnvelopeKeys.has(key)) || findForbiddenKeys(decision).length > 0) return false;
  if (decisionKind === 'SELF_CORRECTION_PROMOTION'
    && (!Number.isSafeInteger(decision.validUntilMs) || nowMs >= decision.validUntilMs)) return false;
  if (decision.status !== 'PASS') return true;
  if (decision.evidenceRefs.length === 0) return false;
  if (!hasExactKeys(decision, EVALUATION_PASS_KEYS[decisionKind] ?? [])) return false;
  const canonicalPosture = decision.reasonCodes.length === 0
    && decision.productReadinessImpact === 'NONE'
    && hasHash(decision.decisionDigest)
    && decision.decisionDigest === decisionContractDigest(decision);
  if (!canonicalPosture) return false;
  if (decisionKind === 'WORKLOAD_IDENTITY') {
    return ['IDENTITY_ACTIVE', 'IDENTITY_ROTATION_DUE'].includes(decision.disposition)
      && ['ACTIVE', 'ROTATION_DUE'].includes(decision.identityState)
      && isNonEmptyString(decision.identityRef)
      && isNonEmptyString(decision.providerId)
      && isNonEmptyString(decision.bindingId)
      && isNonEmptyString(decision.audience)
      && isNonEmptyString(decision.environment)
      && hasHash(decision.subjectDigest)
      && hasHash(decision.capabilityDigest)
      && Number.isSafeInteger(decision.generation)
      && decision.generation >= 1
      && Number.isSafeInteger(decision.rotationDueAtMs)
      && Number.isSafeInteger(decision.expiresAtMs)
      && decision.rotationDueAtMs < decision.expiresAtMs
      && nowMs < decision.expiresAtMs
      && (decision.identityState === 'ROTATION_DUE' || nowMs < decision.rotationDueAtMs)
      && decision.diagnosticAuthorityEffect === 'NONE';
  }
  if (decisionKind === 'TRACE_PRIVACY_RETENTION') {
    const writerIds = new Set(decision.retentionWriterIds ?? []);
    const verifierIds = new Set(decision.retentionVerifierIds ?? []);
    return decision.disposition === 'TRACE_PRIVACY_AND_RETENTION_PROVEN'
      && isNonEmptyString(decision.traceId)
      && isNonEmptyString(decision.runId)
      && isNonEmptyString(decision.incidentId)
      && isNonEmptyString(decision.correlationId)
      && isNonEmptyString(decision.environment)
      && isNonEmptyString(decision.privacyPolicyRevision)
      && isNonEmptyString(decision.retentionPolicyRevision)
      && hasHash(decision.tracePolicyDigest)
      && isNonEmptyString(decision.accessTier)
      && hasHash(decision.diffDigest)
      && hasHash(decision.typedOutputDigest)
      && Number.isSafeInteger(decision.lastAppendSequence)
      && decision.lastAppendSequence >= 1
      && hasHash(decision.lastChainDigest)
      && Array.isArray(decision.forbiddenFieldPaths)
      && decision.forbiddenFieldPaths.length === 0
      && isNonEmptyString(decision.retentionOwnerId)
      && isNonEmptyString(decision.retentionVerifierId)
      && uniqueStrings(decision.retentionWriterIds)
      && decision.retentionWriterIds.length > 0
      && uniqueStrings(decision.retentionVerifierIds)
      && decision.retentionVerifierIds.length > 0
      && decision.retentionWriterIds.includes(decision.retentionOwnerId)
      && decision.retentionVerifierIds.includes(decision.retentionVerifierId)
      && isNonEmptyString(decision.traceProducerId)
      && isNonEmptyString(decision.traceProviderId)
      && decision.traceProducerId !== decision.traceProviderId
      && !writerIds.has(decision.traceProducerId)
      && !writerIds.has(decision.traceProviderId)
      && !verifierIds.has(decision.traceProducerId)
      && !verifierIds.has(decision.traceProviderId)
      && ![...writerIds].some((actor) => verifierIds.has(actor))
      && Number.isSafeInteger(decision.retentionCoverageUntilMs)
      && decision.retentionCoverageUntilMs > nowMs;
  }
  if (decisionKind === 'CORPUS_ITEM_GOVERNANCE') {
    return ['CORPUS_READ_PROJECTION_ELIGIBLE', 'CORPUS_DEDUPLICATE_REFERENCE'].includes(decision.disposition)
      && isNonEmptyString(decision.corpusItemId)
      && hasHash(decision.stableKey)
      && hasHash(decision.contentDigest)
      && isNonEmptyString(decision.retentionTraceId)
      && hasHash(decision.traceDecisionDigest)
      && ['TRAIN', 'VALIDATION', 'HOLDOUT', 'RETRIEVAL_ONLY'].includes(decision.partition)
      && isNonEmptyString(decision.validationVerifierId)
      && isNonEmptyString(decision.outcomeVerifierId)
      && isNonEmptyString(decision.retentionOwnerId)
      && isNonEmptyString(decision.retentionVerifierId)
      && uniqueStrings(decision.retentionWriterIds)
      && decision.retentionWriterIds.length > 0
      && uniqueStrings(decision.retentionVerifierIds)
      && decision.retentionVerifierIds.length > 0
      && isNonEmptyString(decision.dedupRegistryRevision)
      && hasHash(decision.dedupRegistryEvidenceDigest)
      && (decision.disposition !== 'CORPUS_DEDUPLICATE_REFERENCE'
        || (isNonEmptyString(decision.dedupTargetId) && hasHash(decision.dedupTargetContentDigest)))
      && uniqueStrings(decision.sourceOwnerIds)
      && decision.validationVerifierId !== decision.outcomeVerifierId
      && !decision.retentionWriterIds.includes(decision.validationVerifierId)
      && !decision.retentionVerifierIds.includes(decision.validationVerifierId)
      && !decision.retentionWriterIds.includes(decision.outcomeVerifierId)
      && !decision.retentionVerifierIds.includes(decision.outcomeVerifierId)
      && decision.canonicalEvidenceMutationAllowed === false
      && decision.appendOnlyEvidenceDeletionAllowed === false;
  }
  if (decisionKind === 'REPAIR_EVIDENCE') {
    return decision.disposition === 'REPAIR_EVIDENCE_ELIGIBLE_FOR_CANONICAL_READBACK'
      && decision.eligibleForCanonicalRecoveryReadback === true
      && isNonEmptyString(decision.campaignId)
      && isNonEmptyString(decision.actionId)
      && hasHash(decision.artifactDigest)
      && isNonEmptyString(decision.policyRevision)
      && isNonEmptyString(decision.traceId)
      && hasHash(decision.traceDecisionDigest)
      && isNonEmptyString(decision.incidentId)
      && hasHash(decision.policyDigest)
      && isNonEmptyString(decision.producerId)
      && isNonEmptyString(decision.executorId)
      && isNonEmptyString(decision.verifierId)
      && decision.verifierId !== decision.producerId
      && decision.verifierId !== decision.executorId
      && decision.producerClaim === 'HEALTHY'
      && decision.verifierStatus === 'PASS'
      && decision.postconditionStatus === 'PASS'
      && decision.quietPeriodStatus === 'PASS'
      && decision.mayDeclareRecovery === false;
  }
  if (decisionKind === 'SELF_CORRECTION_PROMOTION') {
    const promotionEvidenceIds = Array.isArray(decision.promotionEvidenceIds) ? decision.promotionEvidenceIds : [];
    const promotionEvidenceSatisfied = Array.isArray(decision.promotionEvidenceSatisfied)
      ? decision.promotionEvidenceSatisfied : [];
    const requiredTriggerEvidenceIds = Array.isArray(decision.requiredTriggerEvidenceIds)
      ? decision.requiredTriggerEvidenceIds : [];
    const satisfiedTriggerEvidenceIds = Array.isArray(decision.satisfiedTriggerEvidenceIds)
      ? decision.satisfiedTriggerEvidenceIds : [];
    const activeDemotionTriggerCodes = Array.isArray(decision.activeDemotionTriggerCodes)
      ? decision.activeDemotionTriggerCodes : [];
    const monitoredDemotionTriggerCodes = Array.isArray(decision.monitoredDemotionTriggerCodes)
      ? decision.monitoredDemotionTriggerCodes : [];
    const classAProjection = decision.declaredClass === 'A';
    const classADemoted = classAProjection && decision.effectiveClass === 'D';
    const expectedTriggerEvidenceIds = classAProjection
      ? (IP_ASSURANCE_CLASS_LAW.classATriggerEvidenceRequirements[decision.triggerCode] ?? []) : [];
    const policyBoundsValid = classAProjection
      ? hasExactKeys(decision.policyBounds, SELF_CORRECTION_AUTOMATIC_BOUNDS_KEYS)
        && automaticBoundsMatch(decision.policyBounds, CLASS_POLICY_EXPECTATIONS.A.automaticBounds)
      : decision.policyBounds === null;
    const candidateBoundsValid = classAProjection
      ? hasExactKeys(decision.candidateBounds, [
        'attemptLimit', 'capitalEffect', 'exposureEffect', 'externalEnvironmentEffect',
        'rateLimitPerWindow', 'rateWindowMs', 'resourceIds', 'resourceLimit',
      ])
        && Number.isSafeInteger(decision.candidateBounds.attemptLimit)
        && decision.candidateBounds.attemptLimit >= 1
        && decision.candidateBounds.attemptLimit <= decision.policyBounds.maxAttempts
        && Number.isSafeInteger(decision.candidateBounds.rateLimitPerWindow)
        && decision.candidateBounds.rateLimitPerWindow >= 1
        && decision.candidateBounds.rateLimitPerWindow <= decision.policyBounds.maxRatePerWindow
        && Number.isSafeInteger(decision.candidateBounds.rateWindowMs)
        && decision.candidateBounds.rateWindowMs >= decision.policyBounds.rateWindowMs
        && Number.isSafeInteger(decision.candidateBounds.resourceLimit)
        && decision.candidateBounds.resourceLimit >= 1
        && decision.candidateBounds.resourceLimit <= decision.policyBounds.maxResourceCount
        && uniqueStrings(decision.candidateBounds.resourceIds)
        && decision.candidateBounds.resourceIds.length >= 1
        && decision.candidateBounds.resourceIds.length <= decision.candidateBounds.resourceLimit
        && decision.candidateBounds.capitalEffect === 'NONE'
        && decision.candidateBounds.exposureEffect === 'NONE'
        && decision.candidateBounds.externalEnvironmentEffect === 'NONE'
      : decision.candidateBounds === null;
    const classRouteValid = decision.classRoute === (classADemoted ? CLASS_ROUTES.D : CLASS_ROUTES[decision.declaredClass]);
    const classDispositionValid = decision.disposition === (classADemoted
      ? 'CLASS_A_AUTOMATIC_DEMOTION_REQUIRED'
      : CLASS_DISPOSITIONS[decision.declaredClass]);
    const classIdentityValid = classADemoted
      ? decision.derivedClass === 'A'
      : decision.declaredClass === decision.effectiveClass && decision.derivedClass === decision.effectiveClass;
    const classAEvidenceValid = !classAProjection || (
      canonicalStringify(stableUnique(promotionEvidenceIds))
        === canonicalStringify(stableUnique(IP_ASSURANCE_CLASS_LAW.classAPromotionEvidenceIds))
      && canonicalStringify(stableUnique(promotionEvidenceSatisfied))
        === canonicalStringify(stableUnique(IP_ASSURANCE_CLASS_LAW.classAPromotionEvidenceIds))
      && decision.failureReproductionStatus === 'PASS'
      && decision.testEvidenceStatus === 'PASS'
      && decision.shadowRequirement === 'SHADOW_OR_NO_AUTHORITY_REQUIRED'
      && ['SHADOW', 'NO_AUTHORITY'].includes(decision.shadowExerciseMode)
      && decision.shadowExerciseStatus === 'PASS'
      && decision.independentVerifierStatus === 'PASS'
      && decision.quietPeriodStatus === 'PASS'
      && decision.ownerPreauthorizationStatus === 'PASS'
      && decision.boundsStatus === 'PASS'
      && policyBoundsValid
      && candidateBoundsValid
      && decision.demotionStatus === 'PASS'
      && exactStringSet(monitoredDemotionTriggerCodes, IP_ASSURANCE_CLASS_LAW.classADemotionTriggerCodes)
      && exactStringSet(requiredTriggerEvidenceIds, expectedTriggerEvidenceIds)
      && exactStringSet(satisfiedTriggerEvidenceIds, expectedTriggerEvidenceIds)
      && decision.registeredCommandId !== null
      && decision.approvalStatus === 'NOT_REQUIRED'
      && decision.externalAuthorizationRequired === false
      && decision.automaticEligibility === (classADemoted ? 'DEMOTED_TO_CLASS_D' : 'ELIGIBLE_REGISTERED_ONLY')
      && decision.automaticDemotionRequired === classADemoted
      && (classADemoted
        ? activeDemotionTriggerCodes.length > 0
        : activeDemotionTriggerCodes.length === 0)
    );
    const nonClassAEvidenceValid = classAProjection || (
      promotionEvidenceIds.length === 0
      && promotionEvidenceSatisfied.length === 0
      && decision.failureReproductionStatus === 'NOT_REQUIRED'
      && decision.shadowRequirement === 'NOT_REQUIRED'
      && decision.shadowExerciseMode === 'NOT_REQUIRED'
      && decision.shadowExerciseStatus === 'NOT_REQUIRED'
      && decision.quietPeriodStatus === 'NOT_REQUIRED'
      && decision.boundsStatus === 'NOT_REQUIRED'
      && decision.demotionStatus === 'NOT_REQUIRED'
      && policyBoundsValid
      && candidateBoundsValid
      && decision.registeredCommandId === null
      && decision.automaticEligibility === 'NEVER'
      && decision.automaticDemotionRequired === false
      && activeDemotionTriggerCodes.length === 0
      && monitoredDemotionTriggerCodes.length === 0
      && requiredTriggerEvidenceIds.length === 0
      && satisfiedTriggerEvidenceIds.length === 0
    );
    return classDispositionValid
      && classRouteValid
      && classIdentityValid
      && SELF_CORRECTION_CLASSES.has(decision.effectiveClass)
      && SELF_CORRECTION_CLASSES.has(decision.declaredClass)
      && isNonEmptyString(decision.candidateId)
      && Number.isSafeInteger(decision.candidateRevision)
      && decision.candidateRevision >= 1
      && isNonEmptyString(decision.policyId)
      && Number.isSafeInteger(decision.policyRevision)
      && decision.policyRevision >= 1
      && isNonEmptyString(decision.traceId)
      && hasHash(decision.traceDecisionDigest)
      && (decision.registeredCommandId === null || isNonEmptyString(decision.registeredCommandId))
      && hasHash(decision.artifactDigest)
      && hasHash(decision.policyEvidenceDigest)
      && decision.ownerLawDigest === IP_ASSURANCE_CLASS_LAW.packetSha256
      && CLASS_TRIGGER_CODES[decision.declaredClass]?.includes(decision.triggerCode)
      && decision.triggerStatus === 'PASS'
      && Number.isSafeInteger(decision.validUntilMs)
      && nowMs < decision.validUntilMs
      && ['APPROVED', 'NOT_REQUIRED'].includes(decision.approvalStatus)
      && decision.independentVerifierStatus === 'PASS'
      && decision.ownerPreauthorizationStatus === 'PASS'
      && decision.externalAuthorizationRequired === false
      && classAEvidenceValid
      && nonClassAEvidenceValid
      && decision.operationalActionAllowed === false
      && decision.mayDeclareRecovery === false;
  }
  return false;
}

function fail(nowMs, disposition, reasonCodes, evidenceRefs = [], extra = {}) {
  return makeEvaluation({ status: 'FAIL', disposition, evaluatedAtMs: nowMs, reasonCodes, evidenceRefs, extra });
}

function unknown(nowMs, disposition, reasonCodes, evidenceRefs = [], extra = {}) {
  return makeEvaluation({ status: 'UNKNOWN', disposition, evaluatedAtMs: nowMs, reasonCodes, evidenceRefs, extra });
}

function pass(nowMs, disposition, evidenceRefs = [], extra = {}, allowed = false) {
  return makeEvaluation({ status: 'PASS', disposition, evaluatedAtMs: nowMs, evidenceRefs, allowed, extra });
}

/**
 * Reduces non-secret, synthetic provider-workload evidence. It never acquires,
 * refreshes, or exposes a credential.
 */
export function reduceWorkloadIdentity({
  configurationState,
  events,
  expectedBindingId,
  expectedProviderId,
  expectedEnvironment,
  expectedAudience,
  expectedSubjectDigest,
  nowMs,
}) {
  assertUtcMillis(nowMs);
  const baseExtra = { diagnosticAuthorityEffect: 'NONE' };
  if (configurationState === 'NOT_CONFIGURED') {
    return unknown(nowMs, 'NOT_CONFIGURED', ['PROVIDER_WORKLOAD_IDENTITY_NOT_CONFIGURED'], [], {
      ...baseExtra,
      identityState: 'NOT_CONFIGURED',
      generation: null,
      identityRef: null,
      expiresAtMs: null,
      rotationDueAtMs: null,
    });
  }
  if (configurationState !== 'SYNTHETIC_ONLY') {
    return fail(nowMs, 'IDENTITY_BLOCKED', ['EXTERNAL_IDENTITY_MODE_FORBIDDEN_IN_PACKET'], [], {
      ...baseExtra,
      identityState: 'BLOCKED',
      generation: null,
      identityRef: null,
      expiresAtMs: null,
      rotationDueAtMs: null,
    });
  }
  if (!Array.isArray(events) || events.length === 0) {
    return unknown(nowMs, 'IDENTITY_UNKNOWN', ['IDENTITY_EVENTS_MISSING'], [], {
      ...baseExtra,
      identityState: 'UNKNOWN',
      generation: null,
      identityRef: null,
      expiresAtMs: null,
      rotationDueAtMs: null,
    });
  }

  let state = 'UNKNOWN';
  let last = null;
  let previousSequence = 0;
  let previousObservedAtMs = 0;
  let generation = null;
  let capabilityDigest = null;
  let priorEvent = null;
  const reasons = [];
  if (findForbiddenKeys(events).length > 0) reasons.push('IDENTITY_SECRET_BEARING_FIELD_FORBIDDEN');

  for (const event of events) {
    if (!hasExactKeys(event, WORKLOAD_IDENTITY_EVENT_KEYS)) reasons.push('IDENTITY_EVENT_SCHEMA_UNSUPPORTED');
    if (event.schema !== 'WorkloadIdentityEventV1' || event.version !== 1) reasons.push('IDENTITY_EVENT_SCHEMA_UNSUPPORTED');
    if (![event.providerId, event.identityRef, event.bindingId, event.environment, event.audience].every(isNonEmptyString)) {
      reasons.push('IDENTITY_EVENT_IDENTITY_INVALID');
    }
    if (!Number.isSafeInteger(event.sequence) || event.sequence !== previousSequence + 1) reasons.push('IDENTITY_SEQUENCE_GAP');
    if (!Number.isSafeInteger(event.observedAtMs) || event.observedAtMs < previousObservedAtMs || event.observedAtMs > nowMs) {
      reasons.push('IDENTITY_EVENT_TIME_INVALID');
    }
    if (event.providerId !== expectedProviderId) reasons.push('IDENTITY_PROVIDER_MISMATCH');
    if (event.bindingId !== expectedBindingId) reasons.push('IDENTITY_BINDING_MISMATCH');
    if (event.environment !== expectedEnvironment) reasons.push('IDENTITY_ENVIRONMENT_MISMATCH');
    if (event.audience !== expectedAudience) reasons.push('IDENTITY_AUDIENCE_MISMATCH');
    if (!hasHash(event.subjectDigest) || !hasHash(event.capabilityDigest) || !hasHash(event.evidenceHash)) {
      reasons.push('IDENTITY_DIGEST_INVALID');
    }
    if (hasHash(event.evidenceHash) && event.evidenceHash !== workloadIdentityEventEvidenceHash(event)) {
      reasons.push('IDENTITY_EVENT_EVIDENCE_HASH_MISMATCH');
    }
    if (!Number.isSafeInteger(event.generation) || event.generation < 1) reasons.push('IDENTITY_GENERATION_INVALID');
    if (!Number.isSafeInteger(event.notBeforeMs) || !Number.isSafeInteger(event.rotationDueAtMs) || !Number.isSafeInteger(event.expiresAtMs)
      || event.notBeforeMs >= event.rotationDueAtMs || event.rotationDueAtMs >= event.expiresAtMs) {
      reasons.push('IDENTITY_LIFETIME_ORDER_INVALID');
    }
    if (generation !== null && event.generation < generation) reasons.push('IDENTITY_STALE_GENERATION');
    if (priorEvent) {
      if (event.providerId !== priorEvent.providerId || event.bindingId !== priorEvent.bindingId
        || event.environment !== priorEvent.environment || event.audience !== priorEvent.audience
        || event.identityRef !== priorEvent.identityRef) reasons.push('IDENTITY_BOUND_FACT_CHANGED');
      if (event.capabilityDigest !== priorEvent.capabilityDigest) reasons.push('IDENTITY_SCOPE_CHANGE_ON_ROTATION');
      if (event.generation === priorEvent.generation
        && (event.subjectDigest !== priorEvent.subjectDigest || event.notBeforeMs !== priorEvent.notBeforeMs
          || event.rotationDueAtMs !== priorEvent.rotationDueAtMs || event.expiresAtMs !== priorEvent.expiresAtMs)) {
        reasons.push('IDENTITY_SAME_GENERATION_FACT_CHANGED');
      }
      if (event.generation > priorEvent.generation
        && !(event.type === 'ROTATED' && state === 'ROTATING' && event.generation === priorEvent.generation + 1)) {
        reasons.push('IDENTITY_GENERATION_TRANSITION_INVALID');
      }
      if (event.type === 'ROTATED' && state === 'ROTATING' && event.generation !== priorEvent.generation + 1) {
        reasons.push('IDENTITY_ROTATION_GENERATION_NOT_ADVANCED');
      }
      if (event.type !== 'ROTATED' && event.generation !== priorEvent.generation) {
        reasons.push('IDENTITY_GENERATION_CHANGED_OUTSIDE_ROTATION');
      }
    }

    const transition = `${state}:${event.type}`;
    if (transition === 'UNKNOWN:PROVISION_REQUESTED') state = 'PROVISIONING';
    else if (transition === 'PROVISIONING:ATTESTED') state = 'ACTIVE';
    else if (transition === 'ACTIVE:ROTATION_DUE') state = 'ROTATION_DUE';
    else if (transition === 'ROTATION_DUE:ROTATION_STARTED') state = 'ROTATING';
    else if (transition === 'ROTATING:ROTATED') state = 'ACTIVE';
    else if (event.type === 'REVOKED' && !['REVOKED', 'EXPIRED'].includes(state)) state = 'REVOKED';
    else if (event.type === 'FAILED' && !['REVOKED', 'EXPIRED'].includes(state)) state = 'FAILED';
    else reasons.push('IDENTITY_ILLEGAL_TRANSITION');

    previousSequence = event.sequence;
    previousObservedAtMs = event.observedAtMs;
    generation = event.generation;
    capabilityDigest ??= event.capabilityDigest;
    last = event;
    priorEvent = event;
  }

  const evidenceRefs = stableUnique(events.map((event) => event.evidenceHash).filter(hasHash));
  if (hasHash(expectedSubjectDigest) && last?.subjectDigest !== expectedSubjectDigest) reasons.push('IDENTITY_SUBJECT_MISMATCH');
  if (evidenceRefs.length !== events.length) reasons.push('IDENTITY_EVIDENCE_HASH_REUSED');
  const decisionEvidence = {
    decisionKind: 'WORKLOAD_IDENTITY',
    sourceEvidenceDigest: sha256Hex(events),
  };
  if (reasons.length > 0) {
    return fail(nowMs, 'IDENTITY_BLOCKED', reasons, evidenceRefs, {
      ...baseExtra,
      ...decisionEvidence,
      identityState: 'BLOCKED',
      generation,
      identityRef: last?.identityRef ?? null,
      expiresAtMs: last?.expiresAtMs ?? null,
      rotationDueAtMs: last?.rotationDueAtMs ?? null,
    });
  }
  if (!last || !Number.isSafeInteger(last.notBeforeMs) || !Number.isSafeInteger(last.expiresAtMs) || !Number.isSafeInteger(last.rotationDueAtMs)) {
    return unknown(nowMs, 'IDENTITY_UNKNOWN', ['IDENTITY_LIFETIME_UNKNOWN'], evidenceRefs, {
      ...baseExtra,
      ...decisionEvidence,
      identityState: 'UNKNOWN',
      generation,
      identityRef: last?.identityRef ?? null,
      expiresAtMs: last?.expiresAtMs ?? null,
      rotationDueAtMs: last?.rotationDueAtMs ?? null,
    });
  }
  if (nowMs < last.notBeforeMs) state = 'PROVISIONING';
  if (nowMs >= last.expiresAtMs) state = 'EXPIRED';
  else if (state === 'ACTIVE' && nowMs >= last.rotationDueAtMs) state = 'ROTATION_DUE';

  if (!ACTIVE_IDENTITY_STATES.has(state)) {
    return fail(nowMs, 'IDENTITY_BLOCKED', [`IDENTITY_${state}`], evidenceRefs, {
      ...baseExtra,
      ...decisionEvidence,
      identityState: state,
      generation,
      identityRef: last.identityRef,
      expiresAtMs: last.expiresAtMs,
      rotationDueAtMs: last.rotationDueAtMs,
    });
  }
  return sealedEvidencePass(nowMs, state === 'ACTIVE' ? 'IDENTITY_ACTIVE' : 'IDENTITY_ROTATION_DUE', evidenceRefs, {
    ...baseExtra,
    ...decisionEvidence,
    identityState: state,
    generation,
    identityRef: last.identityRef,
    providerId: last.providerId,
    bindingId: last.bindingId,
    audience: last.audience,
    environment: last.environment,
    capabilityDigest: last.capabilityDigest,
    subjectDigest: last.subjectDigest,
    expiresAtMs: last.expiresAtMs,
    rotationDueAtMs: last.rotationDueAtMs,
  });
}

/**
 * Deny-by-default sandbox reference decision. PASS permits only the local
 * deterministic stub represented by this packet, never an external provider.
 */
export function evaluateSandboxBinding({
  binding,
  request,
  identityEvidence,
  traceEvidence,
  identityDecision,
  privacyDecision,
  retentionDecision,
  killDecision,
  approvalDecision,
  nowMs,
}) {
  assertUtcMillis(nowMs);
  const noAuthority = { providerInvocationMode: 'DETERMINISTIC_STUB_ONLY', operationalAuthorityEffect: 'NONE' };
  if (!binding || binding.configurationState === 'NOT_CONFIGURED') {
    return unknown(nowMs, 'NOT_CONFIGURED', ['EXTERNAL_SANDBOX_NOT_CONFIGURED'], [], noAuthority);
  }
  if (!request) return fail(nowMs, 'DENY', ['SANDBOX_REQUEST_MISSING'], [], noAuthority);

  const reasons = [];
  const evidenceRefs = [];
  if (!hasExactKeys(binding, SANDBOX_BINDING_KEYS)
    || !hasExactKeys(binding.workspace, ['mode', 'readOnlyArtifactDigests', 'writableRoots'])
    || !hasExactKeys(binding.budget, ['cooldownMs', 'maxCalls', 'maxConcurrent', 'maxCostMicrounits', 'maxLatencyMs', 'maxTokens', 'rateWindowMs'])
    || !Array.isArray(binding.toolCapabilityBindings)
    || binding.toolCapabilityBindings.some((entry) => !hasExactKeys(entry, ['capability', 'minimumPermissionLevel', 'toolId']))) {
    reasons.push('SANDBOX_SCHEMA_UNSUPPORTED');
  }
  if (!hasExactKeys(request, DIAGNOSTIC_REQUEST_KEYS)
    || !hasExactKeys(request.baseContractRef, ['contractName', 'ownerSection', 'reuseMode'])
    || !hasExactKeys(request.budget, ['cooldownMs', 'maxCalls', 'maxConcurrent', 'maxCostMicrounits', 'maxLatencyMs', 'maxTokens', 'rateWindowMs'])) {
    reasons.push('SANDBOX_REQUEST_SCHEMA_UNSUPPORTED');
  }
  if (!hasExactKeys(identityEvidence, ['events']) || !hasExactKeys(traceEvidence, ['policy', 'trace'])) {
    reasons.push('SANDBOX_PREREQUISITE_EVIDENCE_SCHEMA_UNSUPPORTED');
  }
  if (!hasExactKeys(approvalDecision, BASE_DIAGNOSTIC_APPROVAL_KEYS)
    || !hasExactKeys(approvalDecision?.baseContractRef, ['contractName', 'ownerSection', 'reuseMode'])) {
    reasons.push('SANDBOX_EXACT_APPROVAL_EVIDENCE_INVALID');
  }
  if (!hasExactKeys(killDecision, KILL_READBACK_KEYS)) reasons.push('DIAGNOSTIC_KILL_READBACK_INVALID');
  if (findForbiddenKeys({ binding, request, identityEvidence, traceEvidence, approvalDecision, killDecision }).length > 0) {
    reasons.push('SECRET_BEARING_FIELD_FORBIDDEN');
  }
  if (binding.schema !== 'ExternalSandboxBindingV1' || binding.version !== 1) reasons.push('SANDBOX_SCHEMA_UNSUPPORTED');
  if (request.schema !== 'BaseDiagnosticCapabilityRequestFixtureV1' || request.version !== 1
    || request.baseContractRef?.ownerSection !== 'IP_ASSURANCE.md#3.9'
    || request.baseContractRef?.contractName !== 'DiagnosticCapabilityRequest'
    || request.baseContractRef?.reuseMode !== 'BASE_REUSED') reasons.push('SANDBOX_REQUEST_BASE_CONTRACT_UNBOUND');
  if (binding.configurationState !== 'SYNTHETIC_ONLY' || binding.providerMode !== 'DETERMINISTIC_STUB') {
    reasons.push('EXTERNAL_PROVIDER_MODE_FORBIDDEN_IN_PACKET');
  }
  let recomputedIdentity = null;
  let recomputedTrace = null;
  try {
    recomputedIdentity = reduceWorkloadIdentity({
      configurationState: 'SYNTHETIC_ONLY',
      events: identityEvidence?.events,
      expectedBindingId: binding.bindingId,
      expectedProviderId: binding.providerId,
      expectedEnvironment: binding.environment,
      expectedAudience: binding.workloadAudience,
      expectedSubjectDigest: binding.workloadSubjectDigest,
      nowMs,
    });
    recomputedTrace = evaluateTracePrivacyAndRetention({ trace: traceEvidence?.trace, policy: traceEvidence?.policy, nowMs });
  } catch {
    reasons.push('SANDBOX_PREREQUISITE_RECOMPUTE_FAILED');
  }
  if (!recomputedIdentity || !canonicalEqual(recomputedIdentity, identityDecision)) {
    reasons.push('WORKLOAD_IDENTITY_RECOMPUTE_MISMATCH');
  }
  if (!recomputedTrace || !canonicalEqual(recomputedTrace, privacyDecision)
    || !canonicalEqual(recomputedTrace, retentionDecision)) {
    reasons.push('TRACE_PRIVACY_RETENTION_RECOMPUTE_MISMATCH');
  }
  if (binding.networkPolicy !== 'DENY_ALL' || !Array.isArray(binding.egressAllowlist) || binding.egressAllowlist.length !== 0) {
    reasons.push('NETWORK_NOT_DENY_ALL');
  }
  if (binding.workspace?.mode !== 'EPHEMERAL_ISOLATED') reasons.push('WORKSPACE_NOT_EPHEMERAL_ISOLATED');
  if (!Array.isArray(binding.workspace?.writableRoots) || binding.workspace.writableRoots.some((root) => root !== '/isolated-workspace')) {
    reasons.push('WRITABLE_ROOT_NOT_ISOLATED');
  }
  if (!Array.isArray(binding.allowedResourceDigests)
    || binding.allowedResourceDigests.some((digest) => !hasHash(digest))
    || new Set(binding.allowedResourceDigests).size !== binding.allowedResourceDigests.length
    || !Array.isArray(binding.workspace?.readOnlyArtifactDigests)
    || binding.workspace.readOnlyArtifactDigests.some((digest) => !hasHash(digest))
    || new Set(binding.workspace.readOnlyArtifactDigests).size !== binding.workspace.readOnlyArtifactDigests.length) {
    reasons.push('SANDBOX_RESOURCE_DIGEST_SET_INVALID');
  }
  if (!allStrings(binding.allowedCapabilities) || binding.allowedCapabilities.some((capability) => !SAFE_CAPABILITY_SET.has(capability))) {
    reasons.push('BINDING_CAPABILITY_NOT_SAFE');
  }
  if (new Set(binding.allowedCapabilities ?? []).size !== binding.allowedCapabilities?.length
    || !uniqueStrings(binding.allowedToolIds)) reasons.push('SANDBOX_ALLOWLIST_DUPLICATE_OR_INVALID');
  if (!exactSubset(binding.allowedCapabilities, PERMISSION_CAPABILITY_CEILINGS[binding.permissionLevel] ?? [])) {
    reasons.push('BINDING_CAPABILITY_EXCEEDS_PERMISSION');
  }
  const toolBindings = Array.isArray(binding.toolCapabilityBindings) ? binding.toolCapabilityBindings : [];
  if (toolBindings.length !== binding.allowedToolIds?.length
    || new Set(toolBindings.map((entry) => entry.toolId)).size !== toolBindings.length
    || toolBindings.some((entry) => !binding.allowedToolIds.includes(entry.toolId)
      || !binding.allowedCapabilities.includes(entry.capability)
      || SAFE_STUB_TOOL_CAPABILITIES[entry.toolId] !== entry.capability
      || !PERMISSION_LEVELS.includes(entry.minimumPermissionLevel)
      || PERMISSION_LEVELS.indexOf(entry.minimumPermissionLevel) > PERMISSION_LEVELS.indexOf(binding.permissionLevel))) {
    reasons.push('BINDING_TOOL_CAPABILITY_MAP_INVALID');
  }
  if (!allStrings(binding.forbiddenCapabilities)
    || PERMANENTLY_FORBIDDEN_CAPABILITIES.some((capability) => !binding.forbiddenCapabilities.includes(capability))) {
    reasons.push('PERMANENT_DENY_LIST_INCOMPLETE');
  }
  if (!Number.isSafeInteger(binding.issuedAtMs) || !Number.isSafeInteger(binding.expiresAtMs)
    || binding.issuedAtMs > nowMs || nowMs >= binding.expiresAtMs) reasons.push('SANDBOX_BINDING_EXPIRED_OR_NOT_YET_VALID');

  const killEnvelopeValid = killDecision?.schema === 'DiagnosticKillReadbackFixtureV1'
    && killDecision?.version === 1
    && killDecision?.controlId === binding.killControlId
    && killDecision?.controlRevision === binding.killControlRevision
    && killDecision?.bindingRevision === binding.revision
    && killDecision?.sourceState === 'SYNTHETIC_ONLY'
    && killDecision?.wiringState === 'WIRED_FIXTURE'
    && Number.isSafeInteger(killDecision?.evaluatedAtMs)
    && killDecision.evaluatedAtMs <= nowMs
    && killDecision.evaluatedAtMs >= binding.issuedAtMs
    && Number.isSafeInteger(binding.killReadbackMaxAgeMs)
    && binding.killReadbackMaxAgeMs >= 1
    && binding.killReadbackMaxAgeMs <= 60_000
    && nowMs - killDecision.evaluatedAtMs <= binding.killReadbackMaxAgeMs
    && ['ENGAGED', 'DISENGAGED', 'UNKNOWN'].includes(killDecision?.desiredState)
    && ['ENGAGED', 'DISENGAGED', 'UNKNOWN'].includes(killDecision?.effectiveState)
    && hasHash(killDecision?.evidenceDigest)
    && killDecision.evidenceDigest === diagnosticKillReadbackDigest(killDecision);
  if (!killEnvelopeValid) reasons.push('DIAGNOSTIC_KILL_READBACK_INVALID');
  const killStates = [killDecision?.desiredState, killDecision?.effectiveState];
  if (killStates.some((state) => state !== 'DISENGAGED')) {
    reasons.push(killStates.includes('ENGAGED') ? 'DIAGNOSTIC_KILL_ENGAGED' : 'DIAGNOSTIC_KILL_UNKNOWN');
  }
  const requestDigestForApproval = diagnosticRequestDigest(request);
  const approvalEnvelopeValid = approvalDecision?.schema === 'BaseDiagnosticApprovalEvidenceFixtureV1'
    && approvalDecision?.version === 1
    && approvalDecision?.baseContractRef?.ownerSection === 'IP_ASSURANCE.md#3.9'
    && approvalDecision?.baseContractRef?.contractName === 'ExactDiagnosticApproval'
    && approvalDecision?.baseContractRef?.reuseMode === 'BASE_REUSED'
    && approvalDecision?.status === 'APPROVED'
    && approvalDecision?.approvalRef === binding.approvalRef
    && approvalDecision?.requestId === request.requestId
    && approvalDecision?.requestDigest === requestDigestForApproval
    && approvalDecision?.environment === binding.environment
    && approvalDecision?.policyRevision === binding.policyRevision
    && approvalDecision?.modelId === binding.modelId
    && approvalDecision?.modelVersion === binding.modelVersion
    && allStrings(approvalDecision?.capabilities)
    && allStrings(request.capabilities)
    && canonicalStringify(stableUnique(approvalDecision?.capabilities ?? [])) === canonicalStringify(stableUnique(request.capabilities ?? []))
    && approvalDecision?.maximumEffect === 'DETERMINISTIC_STUB_ONLY'
    && Number.isSafeInteger(approvalDecision?.expiresAtMs)
    && approvalDecision.expiresAtMs > nowMs
    && hasHash(approvalDecision?.rollbackPlanDigest)
    && isNonEmptyString(approvalDecision?.approverId)
    && approvalDecision?.evidenceDigest === binding.approvalEvidenceDigest
    && hasHash(approvalDecision?.evidenceDigest)
    && approvalDecision.evidenceDigest === sandboxApprovalEvidenceDigest(approvalDecision);
  if (!approvalEnvelopeValid) reasons.push('SANDBOX_EXACT_APPROVAL_EVIDENCE_INVALID');
  const identityEnvelopeValid = isEvaluationEnvelope(identityDecision, nowMs, 'WORKLOAD_IDENTITY');
  const privacyEnvelopeValid = isEvaluationEnvelope(privacyDecision, nowMs, 'TRACE_PRIVACY_RETENTION');
  const retentionEnvelopeValid = isEvaluationEnvelope(retentionDecision, nowMs, 'TRACE_PRIVACY_RETENTION');
  if (!identityEnvelopeValid) reasons.push('WORKLOAD_IDENTITY_DECISION_ENVELOPE_INVALID');
  if (!privacyEnvelopeValid) reasons.push('TRACE_PRIVACY_DECISION_ENVELOPE_INVALID');
  if (!retentionEnvelopeValid) reasons.push('INDEPENDENT_RETENTION_DECISION_ENVELOPE_INVALID');
  const identityReason = statusReason(identityDecision, 'WORKLOAD_IDENTITY');
  const privacyReason = statusReason(privacyDecision, 'TRACE_PRIVACY');
  const retentionReason = statusReason(retentionDecision, 'INDEPENDENT_RETENTION');
  if (identityReason) reasons.push(identityReason);
  if (privacyReason) reasons.push(privacyReason);
  if (retentionReason) reasons.push(retentionReason);
  if (privacyDecision?.privacyPolicyRevision !== binding.privacyPolicyRevision) reasons.push('TRACE_PRIVACY_POLICY_MISMATCH');
  if (retentionDecision?.retentionPolicyRevision !== binding.retentionPolicyRevision) reasons.push('TRACE_RETENTION_POLICY_MISMATCH');
  if (privacyDecision?.sourceEvidenceDigest !== retentionDecision?.sourceEvidenceDigest) reasons.push('TRACE_PRIVACY_RETENTION_EVIDENCE_MISMATCH');
  if (!Number.isSafeInteger(retentionDecision?.retentionCoverageUntilMs) || retentionDecision.retentionCoverageUntilMs <= nowMs) {
    reasons.push('TRACE_RETENTION_COVERAGE_EXPIRED');
  }
  evidenceRefs.push(...(identityDecision?.evidenceRefs ?? []), ...(privacyDecision?.evidenceRefs ?? []), ...(retentionDecision?.evidenceRefs ?? []));
  if (hasHash(approvalDecision?.evidenceDigest)) evidenceRefs.push(approvalDecision.evidenceDigest);

  if (request.providerId !== binding.providerId) reasons.push('REQUEST_PROVIDER_MISMATCH');
  if (request.modelId !== binding.modelId || request.modelVersion !== binding.modelVersion) reasons.push('REQUEST_MODEL_MISMATCH');
  if (!isNonEmptyString(binding.modelId) || !isNonEmptyString(binding.modelVersion)) reasons.push('SANDBOX_MODEL_BINDING_MISSING');
  if (identityDecision?.providerId !== binding.providerId || identityDecision?.bindingId !== binding.bindingId) {
    reasons.push('IDENTITY_BINDING_EVIDENCE_MISMATCH');
  }
  if (identityDecision?.audience !== binding.workloadAudience) reasons.push('IDENTITY_AUDIENCE_EVIDENCE_MISMATCH');
  if (identityDecision?.environment !== binding.environment) reasons.push('IDENTITY_ENVIRONMENT_EVIDENCE_MISMATCH');
  if (identityDecision?.capabilityDigest !== binding.workloadCapabilityDigest) reasons.push('IDENTITY_CAPABILITY_EVIDENCE_MISMATCH');
  if (identityDecision?.subjectDigest !== binding.workloadSubjectDigest) reasons.push('IDENTITY_SUBJECT_EVIDENCE_MISMATCH');
  if (!Number.isSafeInteger(identityDecision?.expiresAtMs) || identityDecision.expiresAtMs <= nowMs) reasons.push('IDENTITY_EVIDENCE_EXPIRED');
  if (request.identityRef !== binding.workloadIdentityRef || identityDecision?.identityRef !== binding.workloadIdentityRef) {
    reasons.push('REQUEST_IDENTITY_MISMATCH');
  }
  if (request.environment !== binding.environment) reasons.push('REQUEST_ENVIRONMENT_MISMATCH');
  if (request.policyRevision !== binding.policyRevision) reasons.push('REQUEST_POLICY_MISMATCH');
  if (request.approvalRef !== binding.approvalRef) reasons.push('REQUEST_APPROVAL_MISMATCH');
  if (!PERMISSION_LEVELS.includes(request.permissionLevel) || !PERMISSION_LEVELS.includes(binding.permissionLevel)
    || PERMISSION_LEVELS.indexOf(request.permissionLevel) > PERMISSION_LEVELS.indexOf(binding.permissionLevel)) {
    reasons.push('REQUEST_PERMISSION_EXCEEDS_BINDING');
  }
  if (!exactSubset(request.capabilities, binding.allowedCapabilities)) reasons.push('REQUEST_CAPABILITY_NOT_ALLOWLISTED');
  if (!uniqueStrings(request.capabilities) || !uniqueStrings(request.toolIds)
    || !uniqueStrings(request.resourceDigests) || !uniqueStrings(request.untrustedContentDigests)) {
    reasons.push('REQUEST_DUPLICATE_OR_INVALID_SET');
  }
  if (!exactSubset(request.capabilities, PERMISSION_CAPABILITY_CEILINGS[request.permissionLevel] ?? [])) {
    reasons.push('REQUEST_CAPABILITY_EXCEEDS_PERMISSION');
  }
  if (request.capabilities?.some((capability) => FORBIDDEN_CAPABILITY_SET.has(capability))) reasons.push('PERMANENT_AUTHORITY_BOUNDARY');
  if (!exactSubset(request.toolIds, binding.allowedToolIds)) reasons.push('REQUEST_TOOL_NOT_ALLOWLISTED');
  if (request.toolIds?.some((toolId) => {
    const tool = toolBindings.find((entry) => entry.toolId === toolId);
    return !tool || !request.capabilities.includes(tool.capability)
      || PERMISSION_LEVELS.indexOf(tool.minimumPermissionLevel) > PERMISSION_LEVELS.indexOf(request.permissionLevel);
  })) reasons.push('REQUEST_TOOL_EXCEEDS_PERMISSION');
  if (!exactSubset(request.resourceDigests, binding.allowedResourceDigests)) reasons.push('REQUEST_RESOURCE_NOT_BOUND');
  if (request.resourceDigests?.some((digest) => !hasHash(digest))) reasons.push('REQUEST_RESOURCE_DIGEST_INVALID');
  if (!Array.isArray(request.untrustedContentDigests) || request.untrustedContentDigests.some((digest) => !hasHash(digest))) {
    reasons.push('UNTRUSTED_CONTENT_NOT_HASH_BOUND');
  }
  for (const key of ['maxCalls', 'maxTokens', 'maxCostMicrounits', 'maxLatencyMs', 'maxConcurrent', 'rateWindowMs', 'cooldownMs']) {
    if (!Number.isSafeInteger(request.budget?.[key]) || request.budget[key] < 0
      || !Number.isSafeInteger(binding.budget?.[key]) || request.budget[key] > binding.budget[key]) {
      reasons.push(`REQUEST_${key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_EXCEEDED`);
    }
  }
  if (request.budget?.maxCalls < 1 || binding.budget?.maxCalls < 1) reasons.push('INVOCATION_CALL_BUDGET_EXHAUSTED');
  if (request.budget?.maxConcurrent < 1 || binding.budget?.maxConcurrent < 1) reasons.push('INVOCATION_CONCURRENCY_BUDGET_EXHAUSTED');
  const forbiddenKeys = findForbiddenKeys({ binding, request, identityEvidence, traceEvidence, approvalDecision, killDecision });
  if (forbiddenKeys.length > 0) reasons.push('SECRET_BEARING_FIELD_FORBIDDEN');

  if (reasons.length > 0) {
    return fail(nowMs, 'DENY', reasons, evidenceRefs, { ...noAuthority, forbiddenFieldPaths: forbiddenKeys });
  }
  const requestDigest = diagnosticRequestDigest(request);
  const expiryCandidates = [
    binding.expiresAtMs,
    identityDecision.expiresAtMs,
    retentionDecision.retentionCoverageUntilMs,
    approvalDecision.expiresAtMs,
    killDecision.evaluatedAtMs + binding.killReadbackMaxAgeMs,
  ]
    .filter(Number.isSafeInteger);
  const expiresAtMs = Math.min(...expiryCandidates);
  const sourceEvidenceDigest = sha256Hex({ binding, request, identity: identityDecision.sourceEvidenceDigest, retention: retentionDecision.sourceEvidenceDigest, kill: killDecision.evidenceDigest, approval: approvalDecision.evidenceDigest });
  const boundaryFields = {
    ...noAuthority,
    decisionKind: 'SANDBOX_BINDING',
    sourceEvidenceDigest,
    bindingId: binding.bindingId,
    requestId: request.requestId,
    requestDigest,
    providerId: binding.providerId,
    modelId: binding.modelId,
    modelVersion: binding.modelVersion,
    policyRevision: binding.policyRevision,
    permissionLevel: request.permissionLevel,
    identityRef: binding.workloadIdentityRef,
    workloadAudience: binding.workloadAudience,
    workloadCapabilityDigest: binding.workloadCapabilityDigest,
    workloadSubjectDigest: binding.workloadSubjectDigest,
    environment: binding.environment,
    identityDecisionDigest: identityDecision.decisionDigest,
    traceDecisionDigest: retentionDecision.decisionDigest,
    capabilities: stableUnique(request.capabilities),
    toolIds: stableUnique(request.toolIds),
    expiresAtMs,
    maxCalls: request.budget.maxCalls,
    forbiddenFieldPaths: [],
    stubEligible: true,
  };
  const boundaryDigest = sandboxBoundaryDigest(boundaryFields);
  const normalizedDecision = {
    schema: 'AgentBoundaryEvaluationV1',
    version: 1,
    status: 'PASS',
    disposition: 'ALLOW_DETERMINISTIC_STUB',
    allowed: true,
    productReadinessImpact: 'NONE',
    evaluatedAtMs: nowMs,
    reasonCodes: [],
    evidenceRefs: stableUnique(evidenceRefs),
    ...boundaryFields,
    boundaryDigest,
  };
  return pass(nowMs, 'ALLOW_DETERMINISTIC_STUB', evidenceRefs, {
    ...boundaryFields,
    boundaryDigest,
    decisionDigest: decisionContractDigest(normalizedDecision),
  }, true);
}

export function diagnosticTracePayloadDigest(trace) {
  if (!trace || typeof trace !== 'object') throw new TypeError('trace must be an object');
  const { retentionReceipts: _receipts, ...payload } = trace;
  return sha256Hex(payload);
}

export function traceRetentionPolicyDigest(policy) {
  return sha256Hex({
    revision: policy?.revision ?? null,
    privacyPolicyRevision: policy?.privacyPolicyRevision ?? null,
    minimumRetentionMs: policy?.minimumRetentionMs ?? null,
    allowedAccessTiers: stableUnique(policy?.allowedAccessTiers ?? []),
    expectedFirstSequence: policy?.expectedFirstSequence ?? null,
    expectedPreviousChainDigest: policy?.expectedPreviousChainDigest ?? null,
    anchorEvidenceDigest: policy?.anchorEvidenceDigest ?? null,
  });
}

/** Evaluates privacy and append-only retention evidence without persisting it. */
export function evaluateTracePrivacyAndRetention({ trace, policy, nowMs }) {
  assertUtcMillis(nowMs);
  if (!trace) return unknown(nowMs, 'TRACE_EVIDENCE_UNKNOWN', ['TRACE_MISSING']);
  if (policy && (!hasExactKeys(policy, TRACE_RETENTION_POLICY_KEYS) || findForbiddenKeys(policy).length > 0)) {
    return fail(nowMs, 'TRACE_RETENTION_REJECTED', ['TRACE_RETENTION_POLICY_CONTRACT_INVALID']);
  }
  if (!policy || !isNonEmptyString(policy.revision) || !isNonEmptyString(policy.privacyPolicyRevision)
    || !Number.isSafeInteger(policy.minimumRetentionMs)
    || policy.minimumRetentionMs < 1 || policy.minimumRetentionMs > 31_536_000_000
    || !uniqueStrings(policy.allowedAccessTiers) || policy.allowedAccessTiers.length === 0
    || !Number.isSafeInteger(policy.expectedFirstSequence) || policy.expectedFirstSequence < 1
    || policy.expectedFirstSequence > 2_147_483_647
    || !(policy.expectedPreviousChainDigest === 'GENESIS' || hasHash(policy.expectedPreviousChainDigest))
    || !hasHash(policy.anchorEvidenceDigest)) {
    return unknown(nowMs, 'TRACE_POLICY_UNKNOWN', ['TRACE_RETENTION_POLICY_MISSING_OR_INVALID'], [], {
      traceId: trace.traceId ?? null,
      privacyPolicyRevision: trace.privacy?.policyRevision ?? null,
      retentionPolicyRevision: policy?.revision ?? null,
    });
  }
  if (policy.expectedPreviousChainDigest === 'GENESIS' && policy.expectedFirstSequence !== 1) {
    return fail(nowMs, 'TRACE_RETENTION_REJECTED', ['GENESIS_SEQUENCE_MUST_START_AT_ONE'], [policy.anchorEvidenceDigest]);
  }
  const failReasons = [];
  const unknownReasons = [];
  const policyDigest = traceRetentionPolicyDigest(policy);
  const evidenceRefs = [policy.anchorEvidenceDigest, policyDigest];
  const traceContext = {
    traceId: trace?.traceId ?? null,
    runId: trace?.runId ?? null,
    incidentId: trace?.incidentId ?? null,
    correlationId: trace?.correlationId ?? null,
    environment: trace?.environment ?? null,
    traceProducerId: trace?.producerId ?? null,
    traceProviderId: trace?.providerId ?? null,
    privacyPolicyRevision: trace?.privacy?.policyRevision ?? null,
    retentionPolicyRevision: policy?.revision ?? null,
    diffDigest: trace?.diffDigest ?? null,
    typedOutputDigest: trace?.typedOutputDigest ?? null,
    decisionKind: 'TRACE_PRIVACY_RETENTION',
    sourceEvidenceDigest: sha256Hex({
      tracePayloadDigest: diagnosticTracePayloadDigest(trace),
      tracePolicyDigest: policyDigest,
    }),
    tracePolicyDigest: policyDigest,
    accessTier: trace?.privacy?.accessTier ?? null,
  };
  const forbiddenKeys = findForbiddenKeys(trace);
  if (forbiddenKeys.length > 0) failReasons.push('TRACE_SECRET_BEARING_FIELD_FORBIDDEN');
  if (!hasExactKeys(trace, TRACE_EXTENSION_KEYS)
    || !hasExactKeys(trace.baseTraceRef, ['baseRecordDigest', 'contractName', 'ownerSection', 'reuseMode'])
    || !hasExactKeys(trace.privacy, ['accessTier', 'classification', 'instructionSeparation', 'policyRevision',
      'rawEvidencePlacement', 'redactionState', 'secretScanState'])
    || !Array.isArray(trace.evidenceRefs)
    || trace.evidenceRefs.some((ref) => !hasExactKeys(ref, TRACE_EVIDENCE_REFERENCE_KEYS))
    || !Array.isArray(trace.retentionReceipts)
    || trace.retentionReceipts.some((receipt) => !hasExactKeys(receipt, RETENTION_RECEIPT_KEYS))) {
    failReasons.push('TRACE_SCHEMA_UNSUPPORTED');
  }
  if (trace.schema !== 'DiagnosticTracePrivacyRetentionExtensionV1' || trace.version !== 1
    || trace.baseTraceRef?.ownerSection !== 'IP_ASSURANCE.md#3.9'
    || trace.baseTraceRef?.contractName !== 'AgentRunTrace'
    || trace.baseTraceRef?.reuseMode !== 'BASE_REUSED') failReasons.push('TRACE_BASE_CONTRACT_UNBOUND');
  if (![trace.traceId, trace.runId, trace.incidentId, trace.correlationId, trace.producerId, trace.providerId, trace.environment]
    .every(isNonEmptyString)) failReasons.push('TRACE_ACTOR_OR_RUN_IDENTITY_INVALID');
  if (trace.producerId === trace.providerId) failReasons.push('TRACE_PRODUCER_PROVIDER_COMMON_MODE');
  if (!hasHash(trace.baseTraceRef?.baseRecordDigest) || !hasHash(trace.typedOutputDigest) || !hasHash(trace.diffDigest)) failReasons.push('TRACE_DIGEST_INVALID');
  if (!Array.isArray(trace.evidenceRefs) || trace.evidenceRefs.length === 0) unknownReasons.push('TRACE_PROVENANCE_MISSING');
  else {
    for (const ref of trace.evidenceRefs) {
      if (!hasHash(ref.digest) || !isNonEmptyString(ref.ownerId) || ref.rawIncludedInPrompt !== false) failReasons.push('TRACE_EVIDENCE_REFERENCE_INVALID');
      if (ref.trust !== 'UNTRUSTED_DATA') failReasons.push('UNTRUSTED_EVIDENCE_NOT_SEPARATED');
      if (hasHash(ref.digest)) evidenceRefs.push(ref.digest);
    }
  }
  if (trace.privacy?.redactionState !== 'PASS') failReasons.push('TRACE_REDACTION_FAILED');
  if (trace.privacy?.policyRevision !== policy.privacyPolicyRevision) failReasons.push('TRACE_PRIVACY_POLICY_REVISION_MISMATCH');
  if (trace.privacy?.secretScanState !== 'PASS') failReasons.push('TRACE_SECRET_SCAN_FAILED');
  if (trace.privacy?.instructionSeparation !== 'PASS') failReasons.push('TRACE_INSTRUCTION_SEPARATION_FAILED');
  if (trace.privacy?.rawEvidencePlacement !== 'HASH_ONLY') failReasons.push('TRACE_RAW_EVIDENCE_NOT_HASH_ONLY');
  if (!policy?.allowedAccessTiers?.includes(trace.privacy?.accessTier)) failReasons.push('TRACE_ACCESS_TIER_NOT_ALLOWED');
  const receipts = trace.retentionReceipts;
  if (!Array.isArray(receipts) || receipts.length === 0) unknownReasons.push('APPEND_RETENTION_RECEIPT_MISSING');
  else {
    const payloadDigest = diagnosticTracePayloadDigest(trace);
    let previousDigest = policy.expectedPreviousChainDigest;
    let expectedSequence = policy.expectedFirstSequence;
    let previousRetainedAtMs = null;
    let previousMinimumRetainUntilMs = null;
    for (const receipt of receipts) {
      if (receipt.schema !== 'AppendRetentionReceiptV1' || receipt.version !== 1) failReasons.push('RETENTION_RECEIPT_SCHEMA_UNSUPPORTED');
      if (receipt.operation !== 'APPEND') failReasons.push('RETENTION_MUTATION_FORBIDDEN');
      if (receipt.sequence !== expectedSequence) failReasons.push('APPEND_SEQUENCE_GAP_OR_REORDER');
      if (receipt.previousChainDigest !== previousDigest) failReasons.push('APPEND_CHAIN_PREVIOUS_DIGEST_MISMATCH');
      if (!hasHash(receipt.payloadDigest) || !hasHash(receipt.chainDigest)) failReasons.push('APPEND_DIGEST_INVALID');
      if (receipt.payloadDigest !== payloadDigest) failReasons.push('APPEND_PAYLOAD_DIGEST_MISMATCH');
      if (hasHash(receipt.chainDigest) && receipt.chainDigest !== appendChainDigest(receipt)) failReasons.push('APPEND_CHAIN_DIGEST_MISMATCH');
      if (!isNonEmptyString(receipt.writerId) || receipt.writerId === trace.producerId || receipt.writerId === trace.providerId) failReasons.push('RETENTION_WRITER_NOT_INDEPENDENT');
      if (!isNonEmptyString(receipt.verifierId) || receipt.verifierId === receipt.writerId || receipt.verifierId === trace.producerId || receipt.verifierId === trace.providerId) {
        failReasons.push('RETENTION_VERIFIER_NOT_INDEPENDENT');
      }
      if (receipt.readbackState === 'FAIL') failReasons.push('RETENTION_READBACK_FAILED');
      else if (receipt.readbackState !== 'PASS') unknownReasons.push('RETENTION_READBACK_UNKNOWN');
      if (receipt.policyRevision !== policy?.revision) failReasons.push('RETENTION_POLICY_REVISION_MISMATCH');
      if (!Number.isSafeInteger(receipt.retainedAtMs) || receipt.retainedAtMs > nowMs) failReasons.push('RETENTION_TIME_INVALID');
      if (previousRetainedAtMs !== null && receipt.retainedAtMs < previousRetainedAtMs) failReasons.push('RETENTION_TIME_REGRESSION');
      if (!Number.isSafeInteger(receipt.minimumRetainUntilMs)
        || receipt.minimumRetainUntilMs < receipt.retainedAtMs + policy.minimumRetentionMs) failReasons.push('RETENTION_PERIOD_SHORTENED');
      if (!Number.isSafeInteger(receipt.minimumRetainUntilMs) || receipt.minimumRetainUntilMs <= nowMs) failReasons.push('RETENTION_COVERAGE_EXPIRED');
      if (previousMinimumRetainUntilMs !== null && receipt.minimumRetainUntilMs < previousMinimumRetainUntilMs) failReasons.push('RETENTION_COVERAGE_SHORTENED_ACROSS_APPENDS');
      if (hasHash(receipt.chainDigest)) evidenceRefs.push(receipt.chainDigest);
      previousDigest = receipt.chainDigest;
      previousRetainedAtMs = receipt.retainedAtMs;
      previousMinimumRetainUntilMs = receipt.minimumRetainUntilMs;
      expectedSequence += 1;
    }
    const writerIds = new Set(receipts.map((receipt) => receipt.writerId).filter(isNonEmptyString));
    const verifierIds = new Set(receipts.map((receipt) => receipt.verifierId).filter(isNonEmptyString));
    if ([...writerIds].some((actor) => verifierIds.has(actor))) failReasons.push('RETENTION_CROSS_RECEIPT_COMMON_MODE');
  }

  if (failReasons.length > 0) {
    return fail(nowMs, 'TRACE_RETENTION_REJECTED', failReasons, evidenceRefs, { ...traceContext, forbiddenFieldPaths: forbiddenKeys });
  }
  if (unknownReasons.length > 0) {
    return unknown(nowMs, 'TRACE_RETENTION_UNKNOWN', unknownReasons, evidenceRefs, { ...traceContext, forbiddenFieldPaths: forbiddenKeys });
  }
  return sealedEvidencePass(nowMs, 'TRACE_PRIVACY_AND_RETENTION_PROVEN', evidenceRefs, {
    ...traceContext,
    lastAppendSequence: receipts.at(-1).sequence,
    lastChainDigest: receipts.at(-1).chainDigest,
    retentionOwnerId: receipts.at(-1).writerId,
    retentionVerifierId: receipts.at(-1).verifierId,
    retentionWriterIds: stableUnique(receipts.map((receipt) => receipt.writerId)),
    retentionVerifierIds: stableUnique(receipts.map((receipt) => receipt.verifierId)),
    retentionCoverageUntilMs: Math.min(...receipts.map((receipt) => receipt.minimumRetainUntilMs)),
    forbiddenFieldPaths: [],
  });
}

export function selfCorrectionClassPolicyDigest(policy) {
  return sha256Hex({
    schema: policy?.schema ?? null,
    version: policy?.version ?? null,
    authorityId: policy?.authorityId ?? null,
    bindingLawRef: policy?.bindingLawRef ?? null,
    ownerLawDigest: policy?.ownerLawDigest ?? null,
    canonicalOwnerRef: policy?.canonicalOwnerRef ?? null,
    basePolicyRef: policy?.basePolicyRef ?? null,
    registrySnapshotDigest: policy?.registrySnapshotDigest ?? null,
    registrationReceiptDigest: policy?.registrationReceiptDigest ?? null,
    ownerPreauthorizationDigest: policy?.ownerPreauthorizationDigest ?? null,
    policyId: policy?.policyId ?? null,
    revision: policy?.revision ?? null,
    class: policy?.class ?? null,
    registered: policy?.registered ?? null,
    mode: policy?.mode ?? null,
    route: policy?.route ?? null,
    automaticEligibility: policy?.automaticEligibility ?? null,
    triggerCodes: stableUnique(Array.isArray(policy?.triggerCodes) ? policy.triggerCodes : []),
    shadowRequirement: policy?.shadowRequirement ?? null,
    automaticBounds: policy?.automaticBounds ?? null,
    demotionTriggerCodes: stableUnique(Array.isArray(policy?.demotionTriggerCodes) ? policy.demotionTriggerCodes : []),
    promotionEvidenceIds: stableUnique(Array.isArray(policy?.promotionEvidenceIds) ? policy.promotionEvidenceIds : []),
    requiredTestKinds: stableUnique(Array.isArray(policy?.requiredTestKinds) ? policy.requiredTestKinds : []),
    externalAuthorizationRequirement: policy?.externalAuthorizationRequirement ?? null,
    environment: policy?.environment ?? null,
    allowedEffectFlags: stableUnique(policy?.allowedEffectFlags ?? []),
    allowedCapabilities: stableUnique(policy?.allowedCapabilities ?? []),
    registeredCommandIds: stableUnique(policy?.registeredCommandIds ?? []),
    promotionDisposition: policy?.promotionDisposition ?? null,
    requiresApproval: policy?.requiresApproval ?? null,
    requiresRepairEvidence: policy?.requiresRepairEvidence ?? null,
    requiresCorpusDecision: policy?.requiresCorpusDecision ?? null,
    requiresHoldout: policy?.requiresHoldout ?? null,
  });
}

function exactStringSet(actual, expected) {
  return allStrings(actual)
    && canonicalStringify(stableUnique(actual)) === canonicalStringify(stableUnique(expected));
}

function automaticBoundsMatch(actual, expected) {
  if (expected === null) return actual === null;
  return Boolean(actual
    && hasExactKeys(actual, SELF_CORRECTION_AUTOMATIC_BOUNDS_KEYS)
    && findForbiddenKeys(actual).length === 0
    && Number.isSafeInteger(actual.maxAttempts) && actual.maxAttempts === expected.maxAttempts
    && Number.isSafeInteger(actual.maxRatePerWindow) && actual.maxRatePerWindow === expected.maxRatePerWindow
    && Number.isSafeInteger(actual.maxResourceCount) && actual.maxResourceCount === expected.maxResourceCount
    && Number.isSafeInteger(actual.rateWindowMs) && actual.rateWindowMs === expected.rateWindowMs);
}

function isExactSelfCorrectionClassPolicy(policy) {
  const expected = CLASS_POLICY_EXPECTATIONS[policy?.class];
  return Boolean(expected
    && SELF_CORRECTION_CLASSES.has(policy?.class)
    && hasExactKeys(policy, SELF_CORRECTION_CLASS_POLICY_KEYS)
    && findForbiddenKeys(policy).length === 0
    && policy.schema === 'SelfCorrectionClassPolicyV1'
    && policy.version === 1
    && isNonEmptyString(policy.authorityId)
    && policy.bindingLawRef === IP_ASSURANCE_CLASS_LAW.source
    && policy.ownerLawDigest === IP_ASSURANCE_CLASS_LAW.packetSha256
    && policy.canonicalOwnerRef === 'IP_ASSURANCE.md/7.1/class-a-d-self-correction-taxonomy'
    && policy.basePolicyRef === 'IP_ASSURANCE.md/3.9/subordinate-diagnostic-plane'
    && hasHash(policy.registrySnapshotDigest)
    && hasHash(policy.registrationReceiptDigest)
    && hasHash(policy.ownerPreauthorizationDigest)
    && isNonEmptyString(policy.policyId)
    && Number.isSafeInteger(policy.revision)
    && policy.revision >= 1
    && policy.registered === true
    && policy.mode === CLASS_MODES[policy.class]
    && policy.route === CLASS_ROUTES[policy.class]
    && policy.automaticEligibility === expected.automaticEligibility
    && exactStringSet(policy.triggerCodes, CLASS_TRIGGER_CODES[policy.class])
    && policy.shadowRequirement === expected.shadowRequirement
    && automaticBoundsMatch(policy.automaticBounds, expected.automaticBounds)
    && exactStringSet(policy.demotionTriggerCodes,
      policy.class === 'A' ? IP_ASSURANCE_CLASS_LAW.classADemotionTriggerCodes : [])
    && exactStringSet(policy.promotionEvidenceIds, expected.promotionEvidenceIds)
    && exactStringSet(policy.requiredTestKinds, expected.requiredTestKinds)
    && policy.externalAuthorizationRequirement === expected.externalAuthorizationRequirement
    && isNonEmptyString(policy.environment)
    && exactStringSet(policy.allowedEffectFlags, expected.effectFlags)
    && !policy.allowedEffectFlags.some((effect) => PERMANENTLY_FORBIDDEN_EFFECTS.has(effect))
    && exactStringSet(policy.allowedCapabilities, ['PROPOSE_TYPED_ACTION'])
    && policy.allowedCapabilities.every((capability) => SAFE_CAPABILITY_SET.has(capability))
    && exactStringSet(policy.registeredCommandIds, expected.registeredCommandIds)
    && policy.promotionDisposition === CLASS_DISPOSITIONS[policy.class]
    && policy.requiresApproval === expected.requiresApproval
    && policy.requiresRepairEvidence === expected.requiresRepairEvidence
    && policy.requiresCorpusDecision === expected.requiresCorpusDecision
    && policy.requiresHoldout === expected.requiresHoldout
    && hasHash(policy.evidenceDigest)
    && policy.evidenceDigest === selfCorrectionClassPolicyDigest(policy));
}

/** The owner-defined trigger plus the exact accepted policy determines the class. */
export function deriveSelfCorrectionClass(candidate, policy) {
  if (!candidate || !policy || !SELF_CORRECTION_CLASSES.has(candidate.declaredClass)) return 'UNKNOWN';
  if (policy.class !== candidate.declaredClass || policy.policyId !== candidate.policyId
    || policy.revision !== candidate.policyRevision || !isExactSelfCorrectionClassPolicy(policy)) return 'UNKNOWN';
  if (!hasExactKeys(candidate.trigger, SELF_CORRECTION_TRIGGER_KEYS)
    || candidate.trigger.deterministic !== true
    || candidate.trigger.status !== 'PASS'
    || !hasHash(candidate.trigger.evidenceDigest)
    || !policy.triggerCodes.includes(candidate.trigger.triggerCode)) return 'UNKNOWN';
  return policy.class;
}

export function selfCorrectionVerifierEvidenceDigest({ candidate, policy, verifier = candidate?.independentVerifier }) {
  return sha256Hex({
    candidateId: candidate?.candidateId ?? null,
    candidateRevision: candidate?.revision ?? null,
    declaredClass: candidate?.declaredClass ?? null,
    policyId: candidate?.policyId ?? null,
    policyRevision: candidate?.policyRevision ?? null,
    policyEvidenceDigest: policy?.evidenceDigest ?? null,
    environment: policy?.environment ?? null,
    traceId: candidate?.traceId ?? null,
    hypothesis: candidate?.hypothesis ?? null,
    artifactDigest: candidate?.artifactDigest ?? null,
    evidenceReportDigest: candidate?.evidenceReportDigest ?? null,
    trigger: candidate?.trigger ?? null,
    failureReproduction: candidate?.failureReproduction ?? null,
    shadowExercise: candidate?.shadowExercise ?? null,
    quietPeriod: candidate?.quietPeriod ?? null,
    bounds: candidate?.bounds ?? null,
    demotionGuard: candidate?.demotionGuard ?? null,
    effectFlags: stableUnique(candidate?.effectFlags ?? []),
    capabilities: stableUnique(candidate?.capabilities ?? []),
    registeredCommandId: candidate?.registeredCommandId ?? null,
    tests: [...(candidate?.tests ?? [])]
      .map(({ checkId, kind, status, evidenceDigest, verifierId }) => ({ checkId, kind, status, evidenceDigest, verifierId }))
      .sort((left, right) => compareCodeUnits(canonicalStringify(left), canonicalStringify(right))),
    verifierId: verifier?.verifierId ?? null,
    relationship: verifier?.relationship ?? null,
    status: verifier?.status ?? null,
  });
}

export function selfCorrectionHoldoutEvidenceDigest({ candidate, policy, holdout = candidate?.holdout }) {
  return sha256Hex({
    candidateId: candidate?.candidateId ?? null,
    candidateRevision: candidate?.revision ?? null,
    artifactDigest: candidate?.artifactDigest ?? null,
    traceId: candidate?.traceId ?? null,
    hypothesis: candidate?.hypothesis ?? null,
    evidenceReportDigest: candidate?.evidenceReportDigest ?? null,
    trigger: candidate?.trigger ?? null,
    failureReproduction: candidate?.failureReproduction ?? null,
    shadowExercise: candidate?.shadowExercise ?? null,
    quietPeriod: candidate?.quietPeriod ?? null,
    bounds: candidate?.bounds ?? null,
    demotionGuard: candidate?.demotionGuard ?? null,
    effectFlags: stableUnique(candidate?.effectFlags ?? []),
    capabilities: stableUnique(candidate?.capabilities ?? []),
    registeredCommandId: candidate?.registeredCommandId ?? null,
    tests: [...(candidate?.tests ?? [])]
      .map(({ checkId, kind, status, evidenceDigest, verifierId }) => ({ checkId, kind, status, evidenceDigest, verifierId }))
      .sort((left, right) => compareCodeUnits(canonicalStringify(left), canonicalStringify(right))),
    policyId: candidate?.policyId ?? null,
    policyRevision: candidate?.policyRevision ?? null,
    policyEvidenceDigest: policy?.evidenceDigest ?? null,
    environment: policy?.environment ?? null,
    verifierId: holdout?.verifierId ?? null,
    relationship: holdout?.relationship ?? null,
    status: holdout?.status ?? null,
  });
}

/**
 * Pure promotion recommendation. A PASS is evidence for the canonical owner;
 * it never applies a change, declares recovery, merges, or deploys.
 */
export function evaluateSelfCorrectionPromotion({
  candidate,
  policy,
  acceptedPolicyEvidenceDigest,
  traceDecision,
  repairDecision,
  corpusDecision,
  nowMs,
}) {
  assertUtcMillis(nowMs);
  if (!candidate) return unknown(nowMs, 'PROMOTION_UNKNOWN', ['PROMOTION_CANDIDATE_MISSING']);
  const failReasons = [];
  const unknownReasons = [];
  const evidenceRefs = [];
  const derivedClass = deriveSelfCorrectionClass(candidate, policy);
  const declaredClass = candidate.declaredClass;
  if (!SELF_CORRECTION_CLASSES.has(declaredClass)) failReasons.push('DECLARED_CLASS_INVALID');
  if (derivedClass === 'UNKNOWN') unknownReasons.push('SELF_CORRECTION_CLASS_POLICY_UNRESOLVED');
  let effectiveClass = derivedClass;
  let classRoute = policy?.route ?? 'UNKNOWN';
  let finalDisposition = policy?.promotionDisposition ?? 'PROMOTION_BLOCKED_UNKNOWN';
  let automaticEligibility = 'NEVER';
  let automaticDemotionRequired = false;
  let externalAuthorizationRequired = false;
  const promotionEvidenceSatisfied = [];
  const activeDemotionTriggerCodes = allStrings(candidate.demotionGuard?.activeTriggerCodes)
    ? stableUnique(candidate.demotionGuard.activeTriggerCodes) : [];
  const requiredTriggerEvidenceIds = declaredClass === 'A' && isNonEmptyString(candidate.trigger?.triggerCode)
    ? stableUnique(IP_ASSURANCE_CLASS_LAW.classATriggerEvidenceRequirements[candidate.trigger.triggerCode] ?? [])
    : [];
  let satisfiedTriggerEvidenceIds = [];
  if (!policy) unknownReasons.push('CLASS_POLICY_MISSING');
  else {
    if (!hasExactKeys(policy, SELF_CORRECTION_CLASS_POLICY_KEYS) || findForbiddenKeys(policy).length > 0) {
      failReasons.push('CLASS_POLICY_CONTRACT_INVALID');
    }
    if (policy.schema !== 'SelfCorrectionClassPolicyV1' || policy.version !== 1) failReasons.push('CLASS_POLICY_SCHEMA_UNSUPPORTED');
    if (policy.class !== declaredClass || policy.policyId !== candidate.policyId || policy.revision !== candidate.policyRevision) failReasons.push('CLASS_POLICY_MISMATCH');
    if (policy.registered !== true) unknownReasons.push('CLASS_POLICY_NOT_REGISTERED');
    if (!hasHash(acceptedPolicyEvidenceDigest) || acceptedPolicyEvidenceDigest !== policy.evidenceDigest) {
      failReasons.push('CLASS_POLICY_NOT_ACCEPTED_BY_OWNER');
    }
    if (!isExactSelfCorrectionClassPolicy(policy)) failReasons.push('CLASS_POLICY_LAW_MISMATCH');
    if (!exactSubset(candidate.effectFlags, policy.allowedEffectFlags)) failReasons.push('EFFECT_NOT_REGISTERED');
    if (!exactSubset(candidate.capabilities, policy.allowedCapabilities)) failReasons.push('CAPABILITY_NOT_REGISTERED_BY_CLASS_POLICY');
    if (!isNonEmptyString(policy.mode) || !isNonEmptyString(policy.route)
      || !['NEVER', 'REGISTERED_ONLY'].includes(policy.automaticEligibility)
      || !isNonEmptyString(policy.promotionDisposition)) failReasons.push('CLASS_POLICY_MODE_DISPOSITION_MISMATCH');
    if (!isNonEmptyString(policy.environment)) failReasons.push('CLASS_POLICY_ENVIRONMENT_MISSING');
  }
  if (!hasExactKeys(candidate, SELF_CORRECTION_CANDIDATE_KEYS) || findForbiddenKeys(candidate).length > 0) {
    failReasons.push('PROMOTION_CANDIDATE_CONTRACT_INVALID');
  }
  if (candidate.schema !== 'SelfCorrectionCandidateV1' || candidate.version !== 1
    || !Number.isSafeInteger(candidate.revision) || candidate.revision < 1) failReasons.push('PROMOTION_CANDIDATE_SCHEMA_UNSUPPORTED');
  if (!hasExactKeys(candidate.trigger, SELF_CORRECTION_TRIGGER_KEYS)
    || findForbiddenKeys(candidate.trigger).length > 0
    || !isNonEmptyString(candidate.trigger?.triggerCode)
    || typeof candidate.trigger?.deterministic !== 'boolean'
    || !['PASS', 'FAIL', 'UNKNOWN'].includes(candidate.trigger?.status)
    || !hasHash(candidate.trigger?.evidenceDigest)) {
    failReasons.push('CLASS_TRIGGER_CONTRACT_INVALID');
  } else {
    evidenceRefs.push(candidate.trigger.evidenceDigest);
    if (candidate.trigger.status === 'FAIL' || candidate.trigger.deterministic !== true) failReasons.push('CLASS_TRIGGER_REJECTED');
    else if (candidate.trigger.status !== 'PASS') unknownReasons.push('CLASS_TRIGGER_UNKNOWN');
    if (!policy?.triggerCodes?.includes(candidate.trigger.triggerCode)) failReasons.push('CLASS_TRIGGER_NOT_ALLOWED');
  }
  if (candidate.registeredCommandId !== null
    && (!isNonEmptyString(candidate.registeredCommandId)
      || !policy?.registeredCommandIds?.includes(candidate.registeredCommandId))) {
    failReasons.push('REGISTERED_COMMAND_BINDING_INVALID');
  }
  if (!Array.isArray(candidate.capabilities) || candidate.capabilities.some((capability) => !SAFE_CAPABILITY_SET.has(capability))) {
    failReasons.push('UNREGISTERED_OR_FORBIDDEN_CAPABILITY');
  }
  if (candidate.capabilities?.some((capability) => FORBIDDEN_CAPABILITY_SET.has(capability))) failReasons.push('PERMANENT_AUTHORITY_BOUNDARY');
  if (candidate.effectFlags?.some((effect) => PERMANENTLY_FORBIDDEN_EFFECTS.has(effect))) failReasons.push('PERMANENT_EFFECT_BOUNDARY');
  if (!hasHash(candidate.artifactDigest) || !hasHash(candidate.evidenceReportDigest)) failReasons.push('PROMOTION_DIGEST_INVALID');
  else evidenceRefs.push(candidate.artifactDigest, candidate.evidenceReportDigest);
  const candidateTestKeys = ['checkId', 'evidenceDigest', 'kind', 'status', 'verifierId'];
  if (!Array.isArray(candidate.tests)) failReasons.push('PROMOTION_TEST_CONTRACT_INVALID');
  else if (policy?.requiredTestKinds?.length > 0 && candidate.tests.length === 0) unknownReasons.push('PROMOTION_TESTS_MISSING');
  else {
    if (candidate.tests.some((entry) => entry.status === 'FAIL')) failReasons.push('PROMOTION_TEST_FAILED');
    if (candidate.tests.some((entry) => entry.status !== 'PASS')) unknownReasons.push('PROMOTION_TEST_UNKNOWN');
    if (candidate.tests.some((entry) => !hasExactKeys(entry, candidateTestKeys)
      || !isNonEmptyString(entry.checkId) || !hasHash(entry.evidenceDigest)
      || !['FAULT', 'FOCUSED', 'REGRESSION'].includes(entry.kind)
      || !isNonEmptyString(entry.verifierId) || findForbiddenKeys(entry).length > 0)) {
      failReasons.push('PROMOTION_TEST_CONTRACT_INVALID');
    }
    if (!exactStringSet(candidate.tests.map((entry) => entry.kind), policy?.requiredTestKinds ?? [])) {
      failReasons.push('PROMOTION_REQUIRED_TEST_KINDS_MISMATCH');
    }
    evidenceRefs.push(...candidate.tests.map((entry) => entry.evidenceDigest).filter(hasHash));
  }
  const failureReproductionContractValid = hasExactKeys(candidate.failureReproduction,
    SELF_CORRECTION_FAILURE_REPRODUCTION_KEYS)
    && findForbiddenKeys(candidate.failureReproduction).length === 0
    && ['PASS', 'FAIL', 'UNKNOWN', 'NOT_REQUIRED'].includes(candidate.failureReproduction?.status)
    && typeof candidate.failureReproduction?.deterministic === 'boolean'
    && isNonEmptyString(candidate.failureReproduction?.fixtureId)
    && hasHash(candidate.failureReproduction?.evidenceDigest);
  const shadowContractValid = hasExactKeys(candidate.shadowExercise, SELF_CORRECTION_SHADOW_KEYS)
    && findForbiddenKeys(candidate.shadowExercise).length === 0
    && ['PASS', 'FAIL', 'UNKNOWN', 'NOT_REQUIRED'].includes(candidate.shadowExercise?.status)
    && ['SHADOW', 'NO_AUTHORITY', 'NOT_REQUIRED'].includes(candidate.shadowExercise?.mode)
    && candidate.shadowExercise?.authorityEffect === 'NONE'
    && hasHash(candidate.shadowExercise?.evidenceDigest);
  const quietPeriodContractValid = hasExactKeys(candidate.quietPeriod, SELF_CORRECTION_QUIET_PERIOD_KEYS)
    && findForbiddenKeys(candidate.quietPeriod).length === 0
    && ['PASS', 'FAIL', 'UNKNOWN', 'NOT_REQUIRED'].includes(candidate.quietPeriod?.status)
    && Number.isSafeInteger(candidate.quietPeriod?.requiredMs) && candidate.quietPeriod.requiredMs >= 0
    && Number.isSafeInteger(candidate.quietPeriod?.observedMs) && candidate.quietPeriod.observedMs >= 0
    && Number.isSafeInteger(candidate.quietPeriod?.recurrenceCount) && candidate.quietPeriod.recurrenceCount >= 0
    && hasHash(candidate.quietPeriod?.evidenceDigest);
  const boundsContractValid = hasExactKeys(candidate.bounds, SELF_CORRECTION_BOUNDS_KEYS)
    && findForbiddenKeys(candidate.bounds).length === 0
    && ['PASS', 'FAIL', 'UNKNOWN', 'NOT_REQUIRED'].includes(candidate.bounds?.status)
    && Number.isSafeInteger(candidate.bounds?.attemptLimit) && candidate.bounds.attemptLimit >= 0
    && Number.isSafeInteger(candidate.bounds?.rateLimitPerWindow) && candidate.bounds.rateLimitPerWindow >= 0
    && Number.isSafeInteger(candidate.bounds?.rateWindowMs) && candidate.bounds.rateWindowMs >= 0
    && Number.isSafeInteger(candidate.bounds?.resourceLimit) && candidate.bounds.resourceLimit >= 0
    && uniqueStrings(candidate.bounds?.resourceIds)
    && candidate.bounds.resourceIds.length <= candidate.bounds.resourceLimit
    && candidate.bounds?.capitalEffect === 'NONE'
    && candidate.bounds?.exposureEffect === 'NONE'
    && candidate.bounds?.externalEnvironmentEffect === 'NONE'
    && hasHash(candidate.bounds?.evidenceDigest);
  const demotionContractValid = hasExactKeys(candidate.demotionGuard, SELF_CORRECTION_DEMOTION_KEYS)
    && findForbiddenKeys(candidate.demotionGuard).length === 0
    && ['PASS', 'FAIL', 'UNKNOWN', 'NOT_REQUIRED'].includes(candidate.demotionGuard?.status)
    && typeof candidate.demotionGuard?.automatic === 'boolean'
    && uniqueStrings(candidate.demotionGuard?.monitoredTriggerCodes)
    && allStrings(candidate.demotionGuard?.activeTriggerCodes)
    && new Set(candidate.demotionGuard.activeTriggerCodes).size === candidate.demotionGuard.activeTriggerCodes.length
    && candidate.demotionGuard.activeTriggerCodes.every((code) => candidate.demotionGuard.monitoredTriggerCodes.includes(code))
    && hasHash(candidate.demotionGuard?.evidenceDigest);
  const policyBoundsProjection = declaredClass === 'A'
    && automaticBoundsMatch(policy?.automaticBounds, CLASS_POLICY_EXPECTATIONS.A.automaticBounds)
    ? { ...policy.automaticBounds } : null;
  const candidateBoundsProjection = declaredClass === 'A' && boundsContractValid
    ? {
      attemptLimit: candidate.bounds.attemptLimit,
      rateLimitPerWindow: candidate.bounds.rateLimitPerWindow,
      rateWindowMs: candidate.bounds.rateWindowMs,
      resourceLimit: candidate.bounds.resourceLimit,
      resourceIds: stableUnique(candidate.bounds.resourceIds),
      capitalEffect: candidate.bounds.capitalEffect,
      exposureEffect: candidate.bounds.exposureEffect,
      externalEnvironmentEffect: candidate.bounds.externalEnvironmentEffect,
    } : null;
  const monitoredDemotionTriggerCodes = declaredClass === 'A' && demotionContractValid
    ? stableUnique(candidate.demotionGuard.monitoredTriggerCodes) : [];
  if (!failureReproductionContractValid || !shadowContractValid || !quietPeriodContractValid
    || !boundsContractValid || !demotionContractValid) failReasons.push('CLASS_A_PROMOTION_EVIDENCE_CONTRACT_INVALID');
  else evidenceRefs.push(
    candidate.failureReproduction.evidenceDigest,
    candidate.shadowExercise.evidenceDigest,
    candidate.quietPeriod.evidenceDigest,
    candidate.bounds.evidenceDigest,
    candidate.demotionGuard.evidenceDigest,
  );

  if (declaredClass === 'A') {
    if (candidate.failureReproduction.status === 'FAIL' || candidate.failureReproduction.deterministic !== true) {
      failReasons.push('CLASS_A_FAILURE_REPRODUCTION_FAILED');
    } else if (candidate.failureReproduction.status !== 'PASS') unknownReasons.push('CLASS_A_FAILURE_REPRODUCTION_UNKNOWN');
    else promotionEvidenceSatisfied.push('DETERMINISTIC_FAILURE_REPRODUCTION');

    if (!isNonEmptyString(candidate.registeredCommandId)
      || !policy?.registeredCommandIds?.includes(candidate.registeredCommandId)) {
      failReasons.push('CLASS_A_REGISTERED_COMMAND_REQUIRED');
    } else promotionEvidenceSatisfied.push('EXACT_REGISTERED_COMMAND_IDENTITY');

    const testKindsPass = Array.isArray(candidate.tests) && candidate.tests.length > 0
      && candidate.tests.every((entry) => entry.status === 'PASS')
      && exactStringSet(candidate.tests.map((entry) => entry.kind), policy?.requiredTestKinds ?? []);
    if (testKindsPass) promotionEvidenceSatisfied.push('FOCUSED_REGRESSION_FAULT_TESTS');
    satisfiedTriggerEvidenceIds = Array.isArray(candidate.tests)
      ? requiredTriggerEvidenceIds.filter((requirementId) => candidate.tests.some(
        (entry) => entry.checkId === requirementId && entry.status === 'PASS',
      )) : [];
    if (!exactStringSet(satisfiedTriggerEvidenceIds, requiredTriggerEvidenceIds)) {
      unknownReasons.push('CLASS_A_TRIGGER_SPECIFIC_EVIDENCE_INCOMPLETE');
    }

    if (candidate.shadowExercise.status === 'FAIL'
      || !['SHADOW', 'NO_AUTHORITY'].includes(candidate.shadowExercise.mode)
      || candidate.shadowExercise.authorityEffect !== 'NONE') failReasons.push('CLASS_A_SHADOW_EXERCISE_FAILED');
    else if (candidate.shadowExercise.status !== 'PASS') unknownReasons.push('CLASS_A_SHADOW_EXERCISE_UNKNOWN');
    else promotionEvidenceSatisfied.push('SHADOW_OR_NO_AUTHORITY_EXERCISE');

    if (candidate.quietPeriod.status === 'FAIL' || candidate.quietPeriod.recurrenceCount > 0) {
      failReasons.push('CLASS_A_QUIET_PERIOD_BREACHED');
    } else if (candidate.quietPeriod.status !== 'PASS'
      || candidate.quietPeriod.requiredMs < 1
      || candidate.quietPeriod.observedMs < candidate.quietPeriod.requiredMs) {
      unknownReasons.push('CLASS_A_QUIET_PERIOD_INCOMPLETE');
    } else promotionEvidenceSatisfied.push('DECLARED_QUIET_PERIOD_NO_RECURRENCE');

    if (!policy || !hasHash(policy.ownerPreauthorizationDigest)
      || policy.ownerLawDigest !== IP_ASSURANCE_CLASS_LAW.packetSha256) {
      unknownReasons.push('CLASS_A_OWNER_PREAUTHORIZATION_UNKNOWN');
    } else promotionEvidenceSatisfied.push('OWNER_PREAUTHORIZED_NARROW_CLASS');

    const automaticBounds = policy?.automaticBounds;
    const boundsWithinPolicy = boundsContractValid && automaticBounds
      && candidate.bounds.status === 'PASS'
      && candidate.bounds.attemptLimit >= 1 && candidate.bounds.attemptLimit <= automaticBounds.maxAttempts
      && candidate.bounds.rateLimitPerWindow >= 1 && candidate.bounds.rateLimitPerWindow <= automaticBounds.maxRatePerWindow
      && candidate.bounds.rateWindowMs >= automaticBounds.rateWindowMs
      && candidate.bounds.resourceLimit >= 1 && candidate.bounds.resourceLimit <= automaticBounds.maxResourceCount
      && candidate.bounds.resourceIds.length >= 1;
    const boundsExceeded = automaticBounds && candidate.bounds.status === 'PASS'
      && (candidate.bounds.attemptLimit > automaticBounds.maxAttempts
        || candidate.bounds.rateLimitPerWindow > automaticBounds.maxRatePerWindow
        || candidate.bounds.resourceLimit > automaticBounds.maxResourceCount);
    if (candidate.bounds.status === 'FAIL') failReasons.push('CLASS_A_BOUNDS_FAILED');
    else if (boundsExceeded) failReasons.push('CLASS_A_BOUNDS_EXCEEDED');
    else if (!boundsWithinPolicy) unknownReasons.push('CLASS_A_BOUNDS_UNKNOWN');
    else promotionEvidenceSatisfied.push('BOUNDED_RATE_RESOURCE_ATTEMPT_EXPOSURE');

    const demotionGuardBound = demotionContractValid
      && candidate.demotionGuard.status === 'PASS'
      && candidate.demotionGuard.automatic === true
      && exactStringSet(candidate.demotionGuard.monitoredTriggerCodes, policy?.demotionTriggerCodes ?? []);
    if (candidate.demotionGuard.status === 'FAIL') failReasons.push('CLASS_A_DEMOTION_GUARD_FAILED');
    else if (!demotionGuardBound) unknownReasons.push('CLASS_A_DEMOTION_GUARD_UNKNOWN');
    else promotionEvidenceSatisfied.push('AUTOMATIC_DEMOTION_ON_RECURRENCE_DRIFT_OR_CHANGED_ASSUMPTIONS');

    if (demotionGuardBound && activeDemotionTriggerCodes.length > 0) {
      automaticDemotionRequired = true;
      automaticEligibility = 'DEMOTED_TO_CLASS_D';
      effectiveClass = 'D';
      classRoute = CLASS_ROUTES.D;
      finalDisposition = 'CLASS_A_AUTOMATIC_DEMOTION_REQUIRED';
    } else {
      automaticEligibility = 'ELIGIBLE_REGISTERED_ONLY';
    }
  } else {
    const nonClassAEvidenceCoherent = failureReproductionContractValid
      && candidate.failureReproduction.status === 'NOT_REQUIRED'
      && candidate.failureReproduction.deterministic === false
      && shadowContractValid && candidate.shadowExercise.status === 'NOT_REQUIRED'
      && candidate.shadowExercise.mode === 'NOT_REQUIRED'
      && quietPeriodContractValid && candidate.quietPeriod.status === 'NOT_REQUIRED'
      && candidate.quietPeriod.requiredMs === 0 && candidate.quietPeriod.observedMs === 0
      && candidate.quietPeriod.recurrenceCount === 0
      && boundsContractValid && candidate.bounds.status === 'NOT_REQUIRED'
      && candidate.bounds.attemptLimit === 0 && candidate.bounds.rateLimitPerWindow === 0
      && candidate.bounds.rateWindowMs === 0 && candidate.bounds.resourceLimit === 0
      && candidate.bounds.resourceIds.length === 0
      && demotionContractValid && candidate.demotionGuard.status === 'NOT_REQUIRED'
      && candidate.demotionGuard.automatic === false
      && candidate.demotionGuard.monitoredTriggerCodes.length === 0
      && candidate.demotionGuard.activeTriggerCodes.length === 0;
    if (!nonClassAEvidenceCoherent) failReasons.push('NON_CLASS_A_PROMOTION_EVIDENCE_MUST_BE_NOT_REQUIRED');
    if (candidate.registeredCommandId !== null) failReasons.push('NON_CLASS_A_REGISTERED_COMMAND_FORBIDDEN');
    if (declaredClass === 'C' && EXTERNAL_CLASS_C_TRIGGERS.has(candidate.trigger?.triggerCode)) {
      externalAuthorizationRequired = true;
      unknownReasons.push('I00_SECTION_20_EXTERNAL_AUTHORIZATION_REQUIRED');
    }
  }
  if (!hasExactKeys(candidate.independentVerifier, ['evidenceDigest', 'relationship', 'status', 'verifierId'])
    || findForbiddenKeys(candidate.independentVerifier).length > 0
    || candidate.independentVerifier?.relationship !== 'INDEPENDENT'
    || !isNonEmptyString(candidate.independentVerifier?.verifierId)) failReasons.push('PROMOTION_VERIFIER_NOT_INDEPENDENT');
  const prerequisiteActors = new Set([
    traceDecision?.traceProducerId,
    traceDecision?.traceProviderId,
    ...(traceDecision?.retentionWriterIds ?? []),
    ...(traceDecision?.retentionVerifierIds ?? []),
    repairDecision?.producerId,
    repairDecision?.executorId,
    repairDecision?.verifierId,
    corpusDecision?.validationVerifierId,
    corpusDecision?.outcomeVerifierId,
    corpusDecision?.retentionOwnerId,
    corpusDecision?.retentionVerifierId,
    ...(corpusDecision?.retentionWriterIds ?? []),
    ...(corpusDecision?.retentionVerifierIds ?? []),
    ...(corpusDecision?.sourceOwnerIds ?? []),
  ].filter(isNonEmptyString));
  const testVerifierIds = stableUnique((candidate.tests ?? []).map((entry) => entry?.verifierId).filter(isNonEmptyString));
  if (testVerifierIds.some((verifierId) => prerequisiteActors.has(verifierId)
    || verifierId === candidate.independentVerifier?.verifierId
    || verifierId === candidate.approval?.approverId
    || verifierId === candidate.holdout?.verifierId)) {
    failReasons.push('PROMOTION_TEST_VERIFIER_COMMON_MODE');
  }
  const corpusIndependentActors = new Set([
    corpusDecision?.validationVerifierId,
    corpusDecision?.outcomeVerifierId,
    ...(corpusDecision?.sourceOwnerIds ?? []),
  ].filter(isNonEmptyString));
  if (isNonEmptyString(repairDecision?.verifierId) && corpusIndependentActors.has(repairDecision.verifierId)) {
    failReasons.push('PROMOTION_PREREQUISITE_COMMON_MODE');
  }
  if (prerequisiteActors.has(candidate.independentVerifier?.verifierId)
    || candidate.independentVerifier?.verifierId === candidate.approval?.approverId
    || candidate.independentVerifier?.verifierId === candidate.holdout?.verifierId) {
    failReasons.push('PROMOTION_VERIFIER_PREREQUISITE_COMMON_MODE');
  }
  if (candidate.independentVerifier?.status === 'FAIL') failReasons.push('PROMOTION_VERIFIER_FAILED');
  else if (candidate.independentVerifier?.status !== 'PASS') unknownReasons.push('PROMOTION_VERIFIER_UNKNOWN');
  if (hasHash(candidate.independentVerifier?.evidenceDigest)
    && candidate.independentVerifier.evidenceDigest === selfCorrectionVerifierEvidenceDigest({ candidate, policy })) {
    evidenceRefs.push(candidate.independentVerifier.evidenceDigest);
    if (declaredClass === 'A' && candidate.independentVerifier.status === 'PASS'
      && candidate.independentVerifier.relationship === 'INDEPENDENT') {
      promotionEvidenceSatisfied.push('INDEPENDENT_POSTCONDITION_VERIFIER');
    }
  } else failReasons.push('PROMOTION_VERIFIER_DIGEST_INVALID');
  if (!Number.isSafeInteger(candidate.expiresAtMs) || nowMs >= candidate.expiresAtMs) failReasons.push('PROMOTION_CANDIDATE_EXPIRED');
  if (!hasExactKeys(candidate.rollback, ['available', 'planDigest']) || findForbiddenKeys(candidate.rollback).length > 0) {
    failReasons.push('PROMOTION_ROLLBACK_CONTRACT_INVALID');
  }
  if (candidate.rollback?.available !== true || !hasHash(candidate.rollback?.planDigest)) unknownReasons.push('PROMOTION_ROLLBACK_EVIDENCE_MISSING');
  else evidenceRefs.push(candidate.rollback.planDigest);
  if (!hasExactKeys(candidate.holdout, ['artifactDigest', 'candidateId', 'candidateRevision', 'environment',
    'evidenceDigest', 'policyRevision', 'relationship', 'status', 'verifierId'])
    || findForbiddenKeys(candidate.holdout).length > 0) failReasons.push('HOLDOUT_CONTRACT_INVALID');
  if (policy?.requiresHoldout) {
    if (candidate.holdout?.status === 'FAIL') failReasons.push('HOLDOUT_FAILED');
    else if (candidate.holdout?.status !== 'PASS' || !hasHash(candidate.holdout?.evidenceDigest)) unknownReasons.push('HOLDOUT_EVIDENCE_UNKNOWN');
    else {
      const holdoutBound = candidate.holdout.candidateId === candidate.candidateId
        && candidate.holdout.candidateRevision === candidate.revision
        && candidate.holdout.artifactDigest === candidate.artifactDigest
        && candidate.holdout.environment === policy.environment
        && candidate.holdout.policyRevision === candidate.policyRevision
        && candidate.holdout.relationship === 'INDEPENDENT'
        && isNonEmptyString(candidate.holdout.verifierId)
        && candidate.holdout.evidenceDigest === selfCorrectionHoldoutEvidenceDigest({ candidate, policy });
      if (!holdoutBound) failReasons.push('HOLDOUT_BINDING_INVALID');
      if (prerequisiteActors.has(candidate.holdout.verifierId)
        || candidate.holdout.verifierId === candidate.independentVerifier?.verifierId
        || candidate.holdout.verifierId === candidate.approval?.approverId) {
        failReasons.push('HOLDOUT_VERIFIER_NOT_INDEPENDENT');
      }
      if (holdoutBound) evidenceRefs.push(candidate.holdout.evidenceDigest);
    }
  } else if (candidate.holdout?.status !== 'NOT_REQUIRED') {
    failReasons.push('CLASS_POLICY_HOLDOUT_COHERENCE_INVALID');
  } else if (candidate.holdout.candidateId !== candidate.candidateId
    || candidate.holdout.candidateRevision !== candidate.revision
    || candidate.holdout.artifactDigest !== candidate.artifactDigest
    || candidate.holdout.environment !== policy?.environment
    || candidate.holdout.policyRevision !== candidate.policyRevision
    || candidate.holdout.evidenceDigest !== selfCorrectionHoldoutEvidenceDigest({ candidate, policy })) {
    failReasons.push('HOLDOUT_BINDING_INVALID');
  }
  if (!hasExactKeys(candidate.approval, ['approvalRef', 'approverId', 'artifactDigest', 'bindingDigest',
    'candidateId', 'capabilities', 'effectFlags', 'environment', 'expiresAtMs', 'policyRevision',
    'rollbackPlanDigest', 'status']) || findForbiddenKeys(candidate.approval).length > 0) {
    failReasons.push('APPROVAL_CONTRACT_INVALID');
  }
  if (policy?.requiresApproval) {
    if (candidate.approval?.status === 'REJECTED' || candidate.approval?.status === 'EXPIRED') failReasons.push(`APPROVAL_${candidate.approval.status}`);
    else if (candidate.approval?.status !== 'APPROVED' || !hasHash(candidate.approval?.bindingDigest)) unknownReasons.push('APPROVAL_MISSING');
    else {
      const candidateCapabilities = allStrings(candidate.capabilities) ? stableUnique(candidate.capabilities) : [];
      const candidateEffectFlags = allStrings(candidate.effectFlags) ? stableUnique(candidate.effectFlags) : [];
      const approvalCapabilities = allStrings(candidate.approval.capabilities) ? stableUnique(candidate.approval.capabilities) : [];
      const approvalEffectFlags = allStrings(candidate.approval.effectFlags) ? stableUnique(candidate.approval.effectFlags) : [];
      const expectedBindingDigest = sha256Hex({
        approvalRef: candidate.approval.approvalRef ?? null,
        candidateId: candidate.candidateId ?? null,
        candidateRevision: candidate.revision ?? null,
        policyId: candidate.policyId ?? null,
        artifactDigest: candidate.artifactDigest ?? null,
        environment: policy.environment ?? null,
        policyRevision: candidate.policyRevision ?? null,
        capabilities: candidateCapabilities,
        effectFlags: candidateEffectFlags,
        rollbackPlanDigest: candidate.rollback?.planDigest ?? null,
        approverId: candidate.approval.approverId ?? null,
        expiresAtMs: candidate.approval.expiresAtMs ?? null,
      });
      if (candidate.approval.candidateId !== candidate.candidateId
        || !isNonEmptyString(candidate.approval.approvalRef)
        || candidate.approval.artifactDigest !== candidate.artifactDigest
        || candidate.approval.environment !== policy.environment
        || candidate.approval.policyRevision !== candidate.policyRevision
        || !allStrings(candidate.approval.capabilities)
        || !allStrings(candidate.approval.effectFlags)
        || canonicalStringify(approvalCapabilities) !== canonicalStringify(candidateCapabilities)
        || canonicalStringify(approvalEffectFlags) !== canonicalStringify(candidateEffectFlags)
        || candidate.approval.rollbackPlanDigest !== candidate.rollback?.planDigest
        || !isNonEmptyString(candidate.approval.approverId)
        || candidate.approval.approverId === candidate.independentVerifier?.verifierId
        || candidate.approval.approverId === candidate.holdout?.verifierId
        || !Number.isSafeInteger(candidate.approval.expiresAtMs)
        || candidate.approval.expiresAtMs <= nowMs
        || candidate.approval.bindingDigest !== expectedBindingDigest) failReasons.push('APPROVAL_NOT_EXACT_OR_EXPIRED');
      if (prerequisiteActors.has(candidate.approval.approverId)) failReasons.push('APPROVAL_PREREQUISITE_COMMON_MODE');
      else evidenceRefs.push(candidate.approval.bindingDigest);
    }
  } else if (candidate.approval?.status !== 'NOT_REQUIRED') {
    failReasons.push('CLASS_POLICY_APPROVAL_COHERENCE_INVALID');
  }
  if (policy?.requiresRepairEvidence) {
    if (!isEvaluationEnvelope(repairDecision, nowMs, 'REPAIR_EVIDENCE')) failReasons.push('REPAIR_EVIDENCE_DECISION_ENVELOPE_INVALID');
    const reason = statusReason(repairDecision, 'REPAIR_EVIDENCE');
    if (reason) (repairDecision?.status === 'FAIL' ? failReasons : unknownReasons).push(reason);
    if (repairDecision?.status === 'PASS' && repairDecision.artifactDigest !== candidate.artifactDigest) {
      failReasons.push('REPAIR_ARTIFACT_BINDING_MISMATCH');
    }
    if (repairDecision?.status === 'PASS' && repairDecision.traceDecisionDigest !== traceDecision?.decisionDigest) {
      failReasons.push('REPAIR_TRACE_DECISION_REPLAY_OR_MISMATCH');
    }
    if (isNonEmptyString(candidate.registeredCommandId) && repairDecision?.status === 'PASS'
      && repairDecision.actionId !== candidate.registeredCommandId) {
      failReasons.push('REPAIR_REGISTERED_COMMAND_BINDING_MISMATCH');
    }
    evidenceRefs.push(...(repairDecision?.evidenceRefs ?? []));
  }
  if (policy?.requiresCorpusDecision) {
    if (!isEvaluationEnvelope(corpusDecision, nowMs, 'CORPUS_ITEM_GOVERNANCE')) failReasons.push('CORPUS_GOVERNANCE_DECISION_ENVELOPE_INVALID');
    const reason = statusReason(corpusDecision, 'CORPUS_GOVERNANCE');
    if (reason) (corpusDecision?.status === 'FAIL' ? failReasons : unknownReasons).push(reason);
    evidenceRefs.push(...(corpusDecision?.evidenceRefs ?? []));
    if (corpusDecision?.status === 'PASS' && corpusDecision.retentionTraceId !== candidate.traceId) failReasons.push('CORPUS_PROMOTION_TRACE_MISMATCH');
    if (corpusDecision?.status === 'PASS' && corpusDecision.traceDecisionDigest !== traceDecision?.decisionDigest) {
      failReasons.push('CORPUS_TRACE_DECISION_REPLAY_OR_MISMATCH');
    }
  }
  const traceReason = statusReason(traceDecision, 'TRACE_RETENTION');
  if (traceReason) (traceDecision?.status === 'FAIL' ? failReasons : unknownReasons).push(traceReason);
  if (traceDecision?.status === 'PASS'
    && (traceDecision.traceId !== candidate.traceId || traceDecision.diffDigest !== candidate.artifactDigest)) {
    failReasons.push('PROMOTION_TRACE_ARTIFACT_BINDING_MISMATCH');
  }
  if (policy && traceDecision?.status === 'PASS' && traceDecision.environment !== policy.environment) failReasons.push('PROMOTION_TRACE_ENVIRONMENT_MISMATCH');
  evidenceRefs.push(...(traceDecision?.evidenceRefs ?? []));
  if (!isEvaluationEnvelope(traceDecision, nowMs, 'TRACE_PRIVACY_RETENTION')) failReasons.push('PROMOTION_TRACE_DECISION_ENVELOPE_INVALID');
  if (declaredClass === 'A'
    && !exactStringSet(promotionEvidenceSatisfied, IP_ASSURANCE_CLASS_LAW.classAPromotionEvidenceIds)) {
    unknownReasons.push('CLASS_A_NINE_POINT_PROMOTION_EVIDENCE_INCOMPLETE');
  }

  const promotionValidityCandidates = [
    candidate.expiresAtMs,
    traceDecision?.retentionCoverageUntilMs,
    ...(policy?.requiresApproval ? [candidate.approval?.expiresAtMs] : []),
  ].filter(Number.isSafeInteger);
  const validUntilMs = promotionValidityCandidates.length > 0 ? Math.min(...promotionValidityCandidates) : null;
  const fixedExtra = {
    decisionKind: 'SELF_CORRECTION_PROMOTION',
    sourceEvidenceDigest: sha256Hex({
      candidate,
      policy,
      traceDecisionDigest: traceDecision?.decisionDigest ?? null,
      repairDecisionDigest: repairDecision?.decisionDigest ?? null,
      corpusDecisionDigest: corpusDecision?.decisionDigest ?? null,
    }),
    candidateId: candidate.candidateId,
    candidateRevision: candidate.revision,
    policyId: candidate.policyId,
    policyRevision: candidate.policyRevision,
    policyEvidenceDigest: policy?.evidenceDigest ?? null,
    traceId: candidate.traceId,
    traceDecisionDigest: traceDecision?.decisionDigest ?? null,
    artifactDigest: candidate.artifactDigest,
    classRoute,
    registeredCommandId: candidate.registeredCommandId ?? null,
    approvalRef: policy?.requiresApproval ? (candidate.approval?.approvalRef ?? null) : null,
    approvalStatus: policy?.requiresApproval ? (candidate.approval?.status ?? 'UNKNOWN') : 'NOT_REQUIRED',
    declaredClass,
    derivedClass,
    effectiveClass,
    triggerCode: candidate.trigger?.triggerCode ?? null,
    triggerStatus: candidate.trigger?.status ?? 'UNKNOWN',
    requiredTriggerEvidenceIds,
    satisfiedTriggerEvidenceIds: stableUnique(satisfiedTriggerEvidenceIds),
    failureReproductionStatus: declaredClass === 'A' ? (candidate.failureReproduction?.status ?? 'UNKNOWN') : 'NOT_REQUIRED',
    testEvidenceStatus: policy?.requiredTestKinds?.length > 0
      ? (Array.isArray(candidate.tests) && candidate.tests.some((entry) => entry.status === 'FAIL')
        ? 'FAIL'
        : (Array.isArray(candidate.tests) && candidate.tests.length > 0
          && exactStringSet(candidate.tests.map((entry) => entry.kind), policy.requiredTestKinds)
          && candidate.tests.every((entry) => entry.status === 'PASS') ? 'PASS' : 'UNKNOWN'))
      : 'NOT_REQUIRED',
    shadowRequirement: ['SHADOW_OR_NO_AUTHORITY_REQUIRED', 'NOT_REQUIRED'].includes(policy?.shadowRequirement)
      ? policy.shadowRequirement : 'UNKNOWN',
    shadowExerciseMode: declaredClass === 'A' ? (candidate.shadowExercise?.mode ?? 'NOT_REQUIRED') : 'NOT_REQUIRED',
    shadowExerciseStatus: declaredClass === 'A' ? (candidate.shadowExercise?.status ?? 'UNKNOWN') : 'NOT_REQUIRED',
    independentVerifierStatus: candidate.independentVerifier?.status ?? 'UNKNOWN',
    quietPeriodStatus: declaredClass === 'A' ? (candidate.quietPeriod?.status ?? 'UNKNOWN') : 'NOT_REQUIRED',
    ownerPreauthorizationStatus: policy?.ownerLawDigest === IP_ASSURANCE_CLASS_LAW.packetSha256
      && hasHash(policy?.ownerPreauthorizationDigest) ? 'PASS' : 'UNKNOWN',
    ownerLawDigest: hasHash(policy?.ownerLawDigest) ? policy.ownerLawDigest : null,
    boundsStatus: declaredClass === 'A' ? (candidate.bounds?.status ?? 'UNKNOWN') : 'NOT_REQUIRED',
    policyBounds: policyBoundsProjection,
    candidateBounds: candidateBoundsProjection,
    demotionStatus: declaredClass === 'A' ? (candidate.demotionGuard?.status ?? 'UNKNOWN') : 'NOT_REQUIRED',
    monitoredDemotionTriggerCodes,
    promotionEvidenceIds: declaredClass === 'A' ? stableUnique(IP_ASSURANCE_CLASS_LAW.classAPromotionEvidenceIds) : [],
    promotionEvidenceSatisfied: declaredClass === 'A' ? stableUnique(promotionEvidenceSatisfied) : [],
    activeDemotionTriggerCodes: declaredClass === 'A' ? activeDemotionTriggerCodes : [],
    automaticEligibility,
    automaticDemotionRequired,
    externalAuthorizationRequired,
    validUntilMs,
    operationalActionAllowed: false,
    mayDeclareRecovery: false,
  };
  if (failReasons.length > 0) return fail(nowMs, 'PROMOTION_REJECTED', failReasons, evidenceRefs, fixedExtra);
  if (unknownReasons.length > 0) return unknown(nowMs, 'PROMOTION_BLOCKED_UNKNOWN', unknownReasons, evidenceRefs, fixedExtra);
  return sealedEvidencePass(nowMs, finalDisposition, evidenceRefs, fixedExtra);
}

export function repairEvidencePolicyDigest(policy) {
  return sha256Hex({
    schema: policy?.schema ?? null,
    version: policy?.version ?? null,
    authorityId: policy?.authorityId ?? null,
    bindingLawRef: policy?.bindingLawRef ?? null,
    basePolicyRef: policy?.basePolicyRef ?? null,
    registrySnapshotDigest: policy?.registrySnapshotDigest ?? null,
    ownerPreauthorizationDigest: policy?.ownerPreauthorizationDigest ?? null,
    revision: policy?.revision ?? null,
    requiresRollback: policy?.requiresRollback ?? null,
    requiresCompensation: policy?.requiresCompensation ?? null,
    minimumQuietPeriodMs: policy?.minimumQuietPeriodMs ?? null,
    allowedActionIds: stableUnique(policy?.allowedActionIds ?? []),
    allowedExecutorIds: stableUnique(policy?.allowedExecutorIds ?? []),
    allowedProducerIds: stableUnique(policy?.allowedProducerIds ?? []),
    requiredResourceIds: stableUnique(policy?.requiredResourceIds ?? []),
    requiredTestCheckIds: stableUnique(policy?.requiredTestCheckIds ?? []),
    requiredCounterexampleCheckIds: stableUnique(policy?.requiredCounterexampleCheckIds ?? []),
    requiredPostconditionCheckIds: stableUnique(policy?.requiredPostconditionCheckIds ?? []),
  });
}

/** Folded S6 repair evidence law; never an operational recovery declaration. */
export function evaluateRepairEvidence({ bundle, policy, acceptedPolicyEvidenceDigest, traceDecision, nowMs }) {
  assertUtcMillis(nowMs);
  if (!bundle) return unknown(nowMs, 'REPAIR_EVIDENCE_UNKNOWN', ['REPAIR_BUNDLE_MISSING']);
  const failReasons = [];
  const unknownReasons = [];
  const evidenceRefs = [];
  if (!hasExactKeys(bundle, REPAIR_EVIDENCE_BUNDLE_KEYS) || findForbiddenKeys(bundle).length > 0) {
    failReasons.push('REPAIR_BUNDLE_CONTRACT_INVALID');
  }
  const evidenceCheckContractValid = (entry) => hasExactKeys(entry, EVIDENCE_CHECK_KEYS)
    || hasExactKeys(entry, VERIFIED_EVIDENCE_CHECK_KEYS);
  if (!hasExactKeys(bundle.lease, REPAIR_LEASE_KEYS)
    || !hasExactKeys(bundle.producerReport, REPAIR_PRODUCER_REPORT_KEYS)
    || !hasExactKeys(bundle.verifier, REPAIR_VERIFIER_KEYS)
    || !Array.isArray(bundle.tests) || bundle.tests.some((entry) => !evidenceCheckContractValid(entry))
    || !Array.isArray(bundle.counterexamples) || bundle.counterexamples.some((entry) => !evidenceCheckContractValid(entry))
    || !Array.isArray(bundle.postconditions) || bundle.postconditions.some((entry) => !hasExactKeys(entry, VERIFIED_EVIDENCE_CHECK_KEYS))
    || !hasExactKeys(bundle.quietPeriod, REPAIR_QUIET_PERIOD_KEYS)
    || !hasExactKeys(bundle.rollback, REPAIR_CONTINGENCY_KEYS)
    || !hasExactKeys(bundle.compensation, REPAIR_CONTINGENCY_KEYS)) {
    failReasons.push('REPAIR_NESTED_CONTRACT_INVALID');
  }
  if (bundle.schema !== 'RepairEvidenceBundleV1' || bundle.version !== 1) failReasons.push('REPAIR_SCHEMA_UNSUPPORTED');
  if (bundle.actionState === 'FAILED' || bundle.actionState === 'ROLLED_BACK') failReasons.push('REPAIR_ACTION_FAILED');
  else if (bundle.actionState !== 'COMPLETED') unknownReasons.push('REPAIR_ACTION_NOT_COMPLETE');
  for (const value of [bundle.campaignId, bundle.actionId, bundle.fingerprint, bundle.producerId, bundle.executorId, bundle.traceId, bundle.incidentId]) {
    if (!isNonEmptyString(value)) failReasons.push('REPAIR_IDENTITY_INVALID');
  }
  if (!hasHash(bundle.artifactDigest) || !hasHash(bundle.beforeStateDigest) || !hasHash(bundle.afterStateDigest)) {
    failReasons.push('REPAIR_DIGEST_INVALID');
  } else evidenceRefs.push(bundle.artifactDigest, bundle.beforeStateDigest, bundle.afterStateDigest);
  if (hasHash(bundle.beforeStateDigest) && bundle.afterStateDigest === bundle.beforeStateDigest) failReasons.push('REPAIR_NO_STATE_CHANGE_PROVEN');
  if (!policy || !hasExactKeys(policy, REPAIR_EVIDENCE_POLICY_KEYS) || findForbiddenKeys(policy).length > 0
    || policy.schema !== 'RepairEvidencePolicyFixtureV1' || policy.version !== 1
    || policy.authorityId !== 'canonical-control-plane-command-registry'
    || policy.bindingLawRef !== 'IP_ASSURANCE.md#7'
    || policy.basePolicyRef !== 'IP_ASSURANCE.md#3.4:remediation-policy'
    || !hasHash(policy.registrySnapshotDigest) || !hasHash(policy.ownerPreauthorizationDigest)
    || !isNonEmptyString(policy.revision) || typeof policy.requiresRollback !== 'boolean'
    || typeof policy.requiresCompensation !== 'boolean' || !allStrings(policy.allowedActionIds)
    || !allStrings(policy.allowedExecutorIds) || !allStrings(policy.allowedProducerIds)
    || !allStrings(policy.requiredResourceIds) || !allStrings(policy.requiredTestCheckIds)
    || !allStrings(policy.requiredCounterexampleCheckIds) || !allStrings(policy.requiredPostconditionCheckIds)
    || !Number.isSafeInteger(policy.minimumQuietPeriodMs) || policy.minimumQuietPeriodMs < 1
    || policy.minimumQuietPeriodMs > 31_536_000_000 || !hasHash(policy.evidenceDigest)
    || policy.evidenceDigest !== repairEvidencePolicyDigest(policy)) unknownReasons.push('REPAIR_POLICY_MISSING_OR_INVALID');
  else if (!hasHash(acceptedPolicyEvidenceDigest) || acceptedPolicyEvidenceDigest !== policy.evidenceDigest) {
    failReasons.push('REPAIR_POLICY_NOT_ACCEPTED_BY_OWNER');
  }
  else if (bundle.policyRevision !== policy.revision) failReasons.push('REPAIR_POLICY_REVISION_MISMATCH');
  else {
    if (!policy.allowedActionIds.includes(bundle.actionId)) failReasons.push('REPAIR_ACTION_NOT_REGISTERED');
    if (!policy.allowedExecutorIds.includes(bundle.executorId)) failReasons.push('REPAIR_EXECUTOR_NOT_REGISTERED');
    if (!policy.allowedProducerIds.includes(bundle.producerId)) failReasons.push('REPAIR_PRODUCER_NOT_REGISTERED');
  }
  const resources = bundle.lease?.resourceIds;
  if (!allStrings(resources) || resources.length === 0
    || canonicalStringify(resources) !== canonicalStringify(stableUnique(resources))) failReasons.push('REPAIR_RESOURCE_LEASE_SET_INVALID');
  if (policy && allStrings(resources) && allStrings(policy.requiredResourceIds)
    && canonicalStringify(stableUnique(resources)) !== canonicalStringify(stableUnique(policy.requiredResourceIds))) {
    failReasons.push('REPAIR_RESOURCE_POLICY_MISMATCH');
  }
  if (!Number.isSafeInteger(bundle.lease?.epoch) || bundle.lease.epoch < 1) failReasons.push('REPAIR_LEASE_EPOCH_INVALID');
  if (bundle.lease?.ownerId !== bundle.executorId || bundle.lease?.completionOwnerId !== bundle.lease?.ownerId) {
    failReasons.push('STALE_OR_HANDOFF_COMPLETION');
  }
  if (!Number.isSafeInteger(bundle.lease?.acquiredAtMs) || !Number.isSafeInteger(bundle.lease?.completedAtMs)
    || !Number.isSafeInteger(bundle.lease?.expiresAtMs) || bundle.lease.acquiredAtMs >= bundle.lease.completedAtMs
    || bundle.lease.completedAtMs >= bundle.lease.expiresAtMs || bundle.lease.completedAtMs > nowMs
    || bundle.lease.acquiredAtMs > nowMs) {
    failReasons.push('REPAIR_LEASE_EXPIRED_OR_TIME_INVALID');
  }
  if (!isNonEmptyString(bundle.verifier?.verifierId) || bundle.verifier?.relationship !== 'INDEPENDENT'
    || bundle.verifier?.verifierId === bundle.executorId
    || bundle.verifier?.verifierId === bundle.producerId
    || bundle.verifier?.verifierId === bundle.lease?.ownerId) failReasons.push('REPAIR_VERIFIER_NOT_INDEPENDENT');
  const traceActors = new Set([
    traceDecision?.traceProducerId,
    traceDecision?.traceProviderId,
    traceDecision?.retentionOwnerId,
    traceDecision?.retentionVerifierId,
    ...(traceDecision?.retentionWriterIds ?? []),
    ...(traceDecision?.retentionVerifierIds ?? []),
  ].filter(isNonEmptyString));
  if (traceActors.has(bundle.verifier?.verifierId)) failReasons.push('REPAIR_VERIFIER_TRACE_COMMON_MODE');
  if (bundle.verifier?.status === 'FAIL') failReasons.push('REPAIR_READBACK_FAILED');
  else if (bundle.verifier?.status !== 'PASS') unknownReasons.push('REPAIR_READBACK_UNKNOWN');
  if (!Number.isSafeInteger(bundle.verifier?.observedAtMs)
    || bundle.verifier.observedAtMs < bundle.lease?.completedAtMs
    || bundle.verifier.observedAtMs > nowMs) failReasons.push('REPAIR_READBACK_TIME_INVALID');
  if (!hasHash(bundle.verifier?.evidenceDigest)) failReasons.push('REPAIR_READBACK_DIGEST_INVALID');
  else evidenceRefs.push(bundle.verifier.evidenceDigest);
  if (!Number.isSafeInteger(bundle.producerReport?.reportedAtMs) || bundle.producerReport.reportedAtMs < bundle.lease?.completedAtMs
    || bundle.producerReport.reportedAtMs > nowMs) failReasons.push('REPAIR_PRODUCER_REPORT_TIME_INVALID');
  if (bundle.producerReport?.state === 'FAILED') failReasons.push('REPAIR_PRODUCER_REPORT_FAILED');
  else if (bundle.producerReport?.state !== 'HEALTHY') unknownReasons.push('REPAIR_PRODUCER_REPORT_NOT_HEALTHY');

  const validateChecks = (entries, requiredCheckIds, missingReason, failedReason, unknownReason, requireVerifier = false) => {
    if (!Array.isArray(entries) || entries.length === 0) {
      unknownReasons.push(missingReason);
      return;
    }
    const checkIds = entries.map((entry) => entry?.checkId).filter(isNonEmptyString);
    if (!allStrings(requiredCheckIds)
      || canonicalStringify(stableUnique(checkIds)) !== canonicalStringify(stableUnique(requiredCheckIds))
      || checkIds.length !== new Set(checkIds).size) failReasons.push('REPAIR_REQUIRED_CHECK_SET_MISMATCH');
    for (const entry of entries) {
      if (!isNonEmptyString(entry?.checkId) || !hasHash(entry?.evidenceDigest)) failReasons.push('REPAIR_CHECK_CONTRACT_INVALID');
      if (entry?.status === 'FAIL') failReasons.push(failedReason);
      else if (entry?.status !== 'PASS') unknownReasons.push(unknownReason);
      if (requireVerifier && entry?.verifierId !== bundle.verifier?.verifierId) failReasons.push('REPAIR_POSTCONDITION_VERIFIER_MISMATCH');
      if (hasHash(entry?.evidenceDigest)) evidenceRefs.push(entry.evidenceDigest);
    }
  };
  validateChecks(bundle.tests, policy?.requiredTestCheckIds, 'REPAIR_TEST_EVIDENCE_MISSING', 'REPAIR_TEST_FAILED', 'REPAIR_TEST_UNKNOWN');
  validateChecks(bundle.counterexamples, policy?.requiredCounterexampleCheckIds, 'REPAIR_COUNTEREXAMPLE_EVIDENCE_MISSING', 'REPAIR_COUNTEREXAMPLE_FAILED', 'REPAIR_COUNTEREXAMPLE_UNKNOWN');
  validateChecks(bundle.postconditions, policy?.requiredPostconditionCheckIds, 'REPAIR_POSTCONDITION_MISSING', 'REPAIR_POSTCONDITION_FAILED', 'REPAIR_POSTCONDITION_UNKNOWN', true);
  if (!Number.isSafeInteger(bundle.quietPeriod?.startedAtMs) || !Number.isSafeInteger(bundle.quietPeriod?.observedThroughMs)
    || !Number.isSafeInteger(bundle.quietPeriod?.requiredMs) || bundle.quietPeriod.requiredMs < 1
    || !Number.isSafeInteger(bundle.quietPeriod?.breachCount) || bundle.quietPeriod.breachCount < 0) unknownReasons.push('QUIET_PERIOD_EVIDENCE_MISSING');
  else {
    if (Number.isSafeInteger(policy?.minimumQuietPeriodMs)
      && bundle.quietPeriod.requiredMs !== policy.minimumQuietPeriodMs) failReasons.push('QUIET_PERIOD_POLICY_MISMATCH');
    if (bundle.quietPeriod.breachCount > 0) failReasons.push('QUIET_PERIOD_BREACHED');
    if (bundle.quietPeriod.startedAtMs < bundle.lease?.completedAtMs
      || bundle.quietPeriod.observedThroughMs < bundle.quietPeriod.startedAtMs) failReasons.push('QUIET_PERIOD_TIME_INVALID');
    if (bundle.quietPeriod.observedThroughMs - bundle.quietPeriod.startedAtMs < bundle.quietPeriod.requiredMs
      || bundle.quietPeriod.observedThroughMs > nowMs) unknownReasons.push('QUIET_PERIOD_INCOMPLETE');
    if (bundle.verifier?.observedAtMs < bundle.quietPeriod.observedThroughMs) unknownReasons.push('QUIET_PERIOD_NOT_INDEPENDENTLY_OBSERVED');
  }
  const evaluateContingency = (entry, requiredByPolicy, label) => {
    if (!entry || entry.required !== requiredByPolicy) {
      failReasons.push(`${label}_POLICY_COHERENCE_INVALID`);
      return;
    }
    if (!hasHash(entry.evidenceDigest)) {
      failReasons.push(`${label}_EVIDENCE_DIGEST_INVALID`);
      return;
    }
    evidenceRefs.push(entry.evidenceDigest);
    if (requiredByPolicy) {
      if (entry.status === 'FAIL') failReasons.push(label === 'ROLLBACK' ? 'ROLLBACK_PROOF_FAILED' : 'COMPENSATION_FAILED');
      else if (entry.status !== 'PASS') unknownReasons.push(label === 'ROLLBACK' ? 'ROLLBACK_PROOF_UNKNOWN' : 'COMPENSATION_UNKNOWN');
    } else if (entry.status !== 'NOT_REQUIRED') failReasons.push(`${label}_NOT_REQUIRED_STATE_INVALID`);
  };
  if (policy) {
    evaluateContingency(bundle.rollback, policy.requiresRollback, 'ROLLBACK');
    evaluateContingency(bundle.compensation, policy.requiresCompensation, 'COMPENSATION');
  }
  const traceReason = statusReason(traceDecision, 'TRACE_RETENTION');
  if (traceReason) (traceDecision?.status === 'FAIL' ? failReasons : unknownReasons).push(traceReason);
  if (!isEvaluationEnvelope(traceDecision, nowMs, 'TRACE_PRIVACY_RETENTION')) failReasons.push('REPAIR_TRACE_DECISION_ENVELOPE_INVALID');
  if (traceDecision?.status === 'PASS' && (traceDecision.traceId !== bundle.traceId
    || traceDecision.incidentId !== bundle.incidentId
    || traceDecision.diffDigest !== bundle.artifactDigest)) failReasons.push('REPAIR_TRACE_BINDING_MISMATCH');
  evidenceRefs.push(...(traceDecision?.evidenceRefs ?? []));

  const fixedExtra = {
    decisionKind: 'REPAIR_EVIDENCE',
    sourceEvidenceDigest: sha256Hex({ bundle, policy, traceDecisionDigest: traceDecision?.decisionDigest ?? null }),
    campaignId: bundle.campaignId,
    actionId: bundle.actionId,
    artifactDigest: bundle.artifactDigest,
    policyRevision: bundle.policyRevision,
    policyDigest: policy?.evidenceDigest ?? sha256Hex(policy ?? null),
    traceId: bundle.traceId,
    traceDecisionDigest: traceDecision?.decisionDigest ?? null,
    incidentId: bundle.incidentId,
    producerClaim: bundle.producerReport?.state ?? 'UNKNOWN',
    producerId: isNonEmptyString(bundle.producerId) ? bundle.producerId : null,
    executorId: isNonEmptyString(bundle.executorId) ? bundle.executorId : null,
    verifierId: isNonEmptyString(bundle.verifier?.verifierId) ? bundle.verifier.verifierId : null,
    verifierStatus: failReasons.some((reason) => ['REPAIR_VERIFIER_NOT_INDEPENDENT', 'REPAIR_VERIFIER_TRACE_COMMON_MODE',
      'REPAIR_READBACK_FAILED', 'REPAIR_READBACK_TIME_INVALID', 'REPAIR_READBACK_DIGEST_INVALID'].includes(reason))
      ? 'FAIL' : (unknownReasons.includes('REPAIR_READBACK_UNKNOWN') ? 'UNKNOWN' : 'PASS'),
    postconditionStatus: failReasons.some((reason) => ['REPAIR_POSTCONDITION_FAILED', 'REPAIR_CHECK_CONTRACT_INVALID', 'REPAIR_POSTCONDITION_VERIFIER_MISMATCH'].includes(reason))
      ? 'FAIL' : (unknownReasons.some((reason) => ['REPAIR_POSTCONDITION_MISSING', 'REPAIR_POSTCONDITION_UNKNOWN'].includes(reason)) ? 'UNKNOWN' : 'PASS'),
    quietPeriodStatus: failReasons.some((reason) => reason.startsWith('REPAIR_POLICY_')
      || ['QUIET_PERIOD_POLICY_MISMATCH', 'QUIET_PERIOD_BREACHED', 'QUIET_PERIOD_TIME_INVALID'].includes(reason))
      ? 'FAIL' : (unknownReasons.some((reason) => reason.startsWith('REPAIR_POLICY_')
        || ['QUIET_PERIOD_EVIDENCE_MISSING', 'QUIET_PERIOD_INCOMPLETE', 'QUIET_PERIOD_NOT_INDEPENDENTLY_OBSERVED'].includes(reason)) ? 'UNKNOWN' : 'PASS'),
    eligibleForCanonicalRecoveryReadback: false,
    mayDeclareRecovery: false,
  };
  if (failReasons.length > 0) return fail(nowMs, 'REPAIR_EVIDENCE_REJECTED', failReasons, evidenceRefs, fixedExtra);
  if (unknownReasons.length > 0) return unknown(nowMs, 'REPAIR_EVIDENCE_INCOMPLETE', unknownReasons, evidenceRefs, fixedExtra);
  return sealedEvidencePass(nowMs, 'REPAIR_EVIDENCE_ELIGIBLE_FOR_CANONICAL_READBACK', evidenceRefs, {
    ...fixedExtra,
    eligibleForCanonicalRecoveryReadback: true,
  });
}

export function corpusStableKey(item) {
  const sourceEvidenceRefs = [...(item?.sourceEvidenceRefs ?? [])]
    .map(({ kind, evidenceId, ownerId, digest }) => ({ kind, evidenceId, ownerId, digest }))
    .sort((left, right) => compareCodeUnits(canonicalStringify(left), canonicalStringify(right)));
  return sha256Hex({ fingerprint: item?.fingerprint ?? null, sourceEvidenceRefs });
}

export function corpusSourceProjectionDigest(item) {
  const sourceEvidenceRefs = [...(item?.sourceEvidenceRefs ?? [])]
    .map(({ kind, evidenceId, ownerId, digest }) => ({ kind, evidenceId, ownerId, digest }))
    .sort((left, right) => compareCodeUnits(canonicalStringify(left), canonicalStringify(right)));
  return sha256Hex({ fingerprint: item?.fingerprint ?? null, sourceEvidenceRefs });
}

export function corpusDedupRegistryDigest(registry) {
  const entries = [...(registry?.entries ?? [])]
    .map(({ corpusItemId, stableKey, sourceProjectionDigest, contentDigest }) => ({
      corpusItemId, stableKey, sourceProjectionDigest, contentDigest,
    }))
    .sort((left, right) => compareCodeUnits(canonicalStringify(left), canonicalStringify(right)));
  return sha256Hex({
    schema: registry?.schema ?? null,
    version: registry?.version ?? null,
    revision: registry?.revision ?? null,
    registered: registry?.registered ?? null,
    entries,
  });
}

export function corpusContentDigest(item) {
  return sha256Hex({
    schema: item?.schema ?? null,
    version: item?.version ?? null,
    corpusItemId: item?.corpusItemId ?? null,
    fingerprint: item?.fingerprint ?? null,
    mutationIntent: item?.mutationIntent ?? null,
    sourceEvidenceRefs: item?.sourceEvidenceRefs ?? [],
    retentionTraceId: item?.retentionTraceId ?? null,
    provenanceState: item?.provenanceState ?? null,
    privacyState: item?.privacyState ?? null,
    secretScanState: item?.secretScanState ?? null,
    untrustedInstructionState: item?.untrustedInstructionState ?? null,
    rightsState: item?.rightsState ?? null,
    poisonState: item?.poisonState ?? null,
    validation: item?.validation ?? null,
    independentOutcome: item?.independentOutcome ?? null,
    dedup: item?.dedup ?? null,
    atlasProjection: item?.atlasProjection ?? null,
    access: item?.access ?? null,
    retention: item?.retention ?? null,
    governanceDisposition: item?.governanceDisposition ?? null,
    partition: item?.partition ?? null,
  });
}

/** Folded S6 item governance for a read projection; never a corpus store write. */
export function evaluateCorpusItemGovernance({ item, retentionDecision, dedupRegistry, nowMs }) {
  assertUtcMillis(nowMs);
  if (!item) return unknown(nowMs, 'CORPUS_ITEM_UNKNOWN', ['CORPUS_ITEM_MISSING']);
  const failReasons = [];
  const unknownReasons = [];
  const evidenceRefs = [];
  if (!hasExactKeys(item, CORPUS_ITEM_KEYS) || findForbiddenKeys(item).length > 0) {
    failReasons.push('CORPUS_ITEM_CONTRACT_INVALID');
  }
  if (!Array.isArray(item.sourceEvidenceRefs)
    || item.sourceEvidenceRefs.some((ref) => !hasExactKeys(ref, CORPUS_SOURCE_REFERENCE_KEYS))
    || !hasExactKeys(item.validation, VERIFIED_EVIDENCE_CHECK_KEYS)
    || !hasExactKeys(item.independentOutcome, CORPUS_INDEPENDENT_OUTCOME_KEYS)
    || !hasExactKeys(item.partition, CORPUS_PARTITION_KEYS)
    || !hasExactKeys(item.dedup, CORPUS_DEDUP_KEYS)
    || !hasExactKeys(item.atlasProjection, CORPUS_ATLAS_KEYS)
    || !Array.isArray(item.atlasProjection?.componentRevisions)
    || item.atlasProjection.componentRevisions.some((entry) => !hasExactKeys(entry, CORPUS_COMPONENT_REVISION_KEYS))
    || !hasExactKeys(item.access, CORPUS_ACCESS_KEYS)
    || !hasExactKeys(item.retention, CORPUS_RETENTION_KEYS)
    || !hasExactKeys(item.governanceDisposition, CORPUS_GOVERNANCE_DISPOSITION_KEYS)) {
    failReasons.push('CORPUS_ITEM_NESTED_CONTRACT_INVALID');
  }
  if (item.schema !== 'CorpusItemV1' || item.version !== 1) failReasons.push('CORPUS_ITEM_SCHEMA_UNSUPPORTED');
  if (item.mutationIntent !== 'READ_PROJECTION_ONLY') failReasons.push('CANONICAL_EVIDENCE_MUTATION_FORBIDDEN');
  const sourceOwnerIds = new Set();
  if (!Array.isArray(item.sourceEvidenceRefs) || item.sourceEvidenceRefs.length === 0) unknownReasons.push('CORPUS_PROVENANCE_MISSING');
  else {
    for (const ref of item.sourceEvidenceRefs) {
      if (!['INCIDENT', 'LEDGER_EVENT', 'MATERIAL_EVENT', 'TEST', 'SOAK', 'POSTMORTEM'].includes(ref.kind)
        || !isNonEmptyString(ref.ownerId) || !hasHash(ref.digest)) failReasons.push('CORPUS_SOURCE_REFERENCE_INVALID');
      if (hasHash(ref.digest)) evidenceRefs.push(ref.digest);
      if (isNonEmptyString(ref.ownerId)) sourceOwnerIds.add(ref.ownerId);
    }
  }
  if (item.provenanceState !== 'VERIFIED') (item.provenanceState === 'FAILED' ? failReasons : unknownReasons).push('CORPUS_PROVENANCE_NOT_VERIFIED');
  if (item.privacyState !== 'SANITIZED' || item.secretScanState !== 'PASS') failReasons.push('CORPUS_PRIVACY_REJECTED');
  if (item.untrustedInstructionState === 'PRESENT') failReasons.push('CORPUS_UNTRUSTED_INSTRUCTION_PRESENT');
  else if (item.untrustedInstructionState !== 'REMOVED') unknownReasons.push('CORPUS_INSTRUCTION_QUARANTINE_REQUIRED');
  if (item.rightsState === 'PROHIBITED') failReasons.push('CORPUS_RIGHTS_PROHIBITED');
  else if (item.rightsState !== 'ALLOWED_INTERNAL') unknownReasons.push('CORPUS_RIGHTS_UNKNOWN');
  if (item.poisonState === 'CONFIRMED') failReasons.push('CORPUS_POISON_CONFIRMED');
  else if (item.poisonState !== 'NONE') unknownReasons.push('CORPUS_POISON_QUARANTINE');
  if (item.validation?.status === 'FAIL') failReasons.push('CORPUS_VALIDATION_FAILED');
  else if (item.validation?.status !== 'PASS' || !hasHash(item.validation?.evidenceDigest)) unknownReasons.push('CORPUS_VALIDATION_UNKNOWN');
  else {
    if (!isNonEmptyString(item.validation.verifierId) || sourceOwnerIds.has(item.validation.verifierId)) failReasons.push('CORPUS_VALIDATOR_NOT_INDEPENDENT');
    evidenceRefs.push(item.validation.evidenceDigest);
  }
  if (item.independentOutcome?.relationship !== 'INDEPENDENT') failReasons.push('CORPUS_OUTCOME_NOT_INDEPENDENT');
  if (!isNonEmptyString(item.independentOutcome?.verifierId) || sourceOwnerIds.has(item.independentOutcome.verifierId)) {
    failReasons.push('CORPUS_OUTCOME_VERIFIER_NOT_INDEPENDENT');
  }
  if (item.independentOutcome?.status === 'FAIL') failReasons.push('CORPUS_OUTCOME_FAILED');
  else if (item.independentOutcome?.status !== 'PASS' || !hasHash(item.independentOutcome?.evidenceDigest)) unknownReasons.push('CORPUS_OUTCOME_UNKNOWN');
  else evidenceRefs.push(item.independentOutcome.evidenceDigest);
  if (!['TRAIN', 'VALIDATION', 'HOLDOUT', 'RETRIEVAL_ONLY'].includes(item.partition?.name) || item.partition?.locked !== true) {
    unknownReasons.push('CORPUS_PARTITION_NOT_LOCKED');
  }
  if (item.validation?.verifierId === item.independentOutcome?.verifierId) failReasons.push('CORPUS_VALIDATION_OUTCOME_COMMON_MODE');
  const registryKeys = ['entries', 'evidenceDigest', 'registered', 'revision', 'schema', 'version'];
  const registryEntryKeys = ['contentDigest', 'corpusItemId', 'sourceProjectionDigest', 'stableKey'];
  const registryEntries = Array.isArray(dedupRegistry?.entries) ? dedupRegistry.entries : [];
  const dedupRegistryValid = hasExactKeys(dedupRegistry, registryKeys)
    && dedupRegistry.schema === 'CorpusDedupRegistryFixtureV1'
    && dedupRegistry.version === 1
    && dedupRegistry.registered === true
    && isNonEmptyString(dedupRegistry.revision)
    && registryEntries.length <= 10_000
    && registryEntries.every((entry) => hasExactKeys(entry, registryEntryKeys)
      && isNonEmptyString(entry.corpusItemId)
      && hasHash(entry.stableKey)
      && hasHash(entry.sourceProjectionDigest)
      && hasHash(entry.contentDigest))
    && new Set(registryEntries.map((entry) => entry.corpusItemId)).size === registryEntries.length
    && hasHash(dedupRegistry.evidenceDigest)
    && dedupRegistry.evidenceDigest === corpusDedupRegistryDigest(dedupRegistry);
  if (!dedupRegistryValid) unknownReasons.push('CORPUS_DEDUP_REGISTRY_MISSING_OR_INVALID');
  else evidenceRefs.push(dedupRegistry.evidenceDigest);
  if (item.dedup?.state === 'CONFLICT') failReasons.push('CORPUS_DEDUP_CONFLICT');
  else if (!['UNIQUE', 'EXACT_MATCH'].includes(item.dedup?.state)) unknownReasons.push('CORPUS_DEDUP_UNKNOWN');
  if (item.dedup?.state === 'EXACT_MATCH' && !isNonEmptyString(item.dedup?.existingItemId)) failReasons.push('CORPUS_DEDUP_TARGET_MISSING');
  if (item.dedup?.state === 'EXACT_MATCH' && !hasHash(item.dedup?.existingContentDigest)) failReasons.push('CORPUS_DEDUP_TARGET_CONTENT_DIGEST_MISSING');
  if (item.dedup?.state === 'EXACT_MATCH' && item.dedup?.existingItemId === item.corpusItemId) failReasons.push('CORPUS_DEDUP_SELF_REFERENCE');
  if (item.dedup?.state === 'UNIQUE' && item.dedup?.existingItemId !== null) failReasons.push('CORPUS_UNIQUE_TARGET_MUST_BE_NULL');
  if (item.dedup?.state === 'UNIQUE' && item.dedup?.existingContentDigest !== null) failReasons.push('CORPUS_UNIQUE_TARGET_CONTENT_DIGEST_MUST_BE_NULL');
  const expectedStableKey = corpusStableKey(item);
  const expectedSourceProjectionDigest = corpusSourceProjectionDigest(item);
  if (item.dedup?.stableKey !== expectedStableKey) failReasons.push('CORPUS_STABLE_KEY_MISMATCH');
  if (dedupRegistryValid) {
    const exactMatches = registryEntries.filter((entry) => entry.stableKey === expectedStableKey
      && entry.sourceProjectionDigest === expectedSourceProjectionDigest);
    if (item.dedup?.state === 'UNIQUE' && exactMatches.length > 0) failReasons.push('CORPUS_UNIQUE_CONTRADICTS_REGISTERED_MATCH');
    if (item.dedup?.state === 'EXACT_MATCH') {
      const target = registryEntries.find((entry) => entry.corpusItemId === item.dedup.existingItemId);
      if (!target) failReasons.push('CORPUS_DEDUP_TARGET_NOT_REGISTERED');
      else if (target.stableKey !== expectedStableKey || target.sourceProjectionDigest !== expectedSourceProjectionDigest) {
        failReasons.push('CORPUS_DEDUP_TARGET_MISMATCH');
      } else if (target.contentDigest !== item.dedup.existingContentDigest) failReasons.push('CORPUS_DEDUP_TARGET_CONTENT_DIGEST_MISMATCH');
    }
  }
  const expectedContentDigest = corpusContentDigest(item);
  if (item.contentDigest !== expectedContentDigest) failReasons.push('CORPUS_CONTENT_DIGEST_MISMATCH');
  else evidenceRefs.push(expectedContentDigest);
  const atlas = item.atlasProjection;
  for (const field of ['timelineEvidenceIds', 'componentRevisions', 'triggerCodes', 'symptomCodes', 'failedInvariantIds', 'impactCodes', 'repairAttemptIds', 'independentPostconditionRefs', 'causeCodes', 'regressionFixtureIds', 'faultSeedIds', 'playbookRevisions', 'modelRevisions', 'actionIds']) {
    if (!Array.isArray(atlas?.[field]) || atlas[field].length === 0) unknownReasons.push('CORPUS_ATLAS_PROJECTION_INCOMPLETE');
  }
  if (!isNonEmptyString(atlas?.reviewerId) || !isNonEmptyString(atlas?.postmortemId)
    || !Number.isSafeInteger(atlas?.recurrenceCount) || atlas.recurrenceCount < 0) unknownReasons.push('CORPUS_ATLAS_REVIEW_METADATA_INCOMPLETE');
  if (item.access?.tier !== 'ASSURANCE_RESTRICTED' || !isNonEmptyString(item.access?.policyRevision)) failReasons.push('CORPUS_ACCESS_POLICY_INVALID');
  if (item.retention?.decision !== 'RETAIN_APPEND_ONLY' || item.retention?.policyRevision !== retentionDecision?.retentionPolicyRevision
    || !Number.isSafeInteger(item.retention?.minimumRetainUntilMs) || item.retention.minimumRetainUntilMs <= nowMs) {
    failReasons.push('CORPUS_RETENTION_POLICY_INVALID');
  }
  if (item.governanceDisposition?.inclusion === 'EXCLUDE' || item.governanceDisposition?.inclusion === 'RETIRE') failReasons.push('CORPUS_ITEM_NOT_INCLUDED');
  else if (item.governanceDisposition?.inclusion !== 'INCLUDE') unknownReasons.push('CORPUS_ITEM_GOVERNANCE_QUARANTINED');
  if (!allStrings(item.governanceDisposition?.exclusionReasonCodes)
    || (item.governanceDisposition?.inclusion === 'INCLUDE' && item.governanceDisposition.exclusionReasonCodes.length !== 0)) {
    failReasons.push('CORPUS_GOVERNANCE_REASON_COHERENCE_INVALID');
  }
  const retentionReason = statusReason(retentionDecision, 'CORPUS_RETENTION');
  if (retentionReason) (retentionDecision?.status === 'FAIL' ? failReasons : unknownReasons).push(retentionReason);
  if (!isEvaluationEnvelope(retentionDecision, nowMs, 'TRACE_PRIVACY_RETENTION')) failReasons.push('CORPUS_RETENTION_DECISION_ENVELOPE_INVALID');
  evidenceRefs.push(...(retentionDecision?.evidenceRefs ?? []));
  if (retentionDecision?.status === 'PASS' && retentionDecision.traceId !== item.retentionTraceId) failReasons.push('CORPUS_RETENTION_TRACE_MISMATCH');
  if (retentionDecision?.status === 'PASS' && retentionDecision.accessTier !== item.access?.tier) failReasons.push('CORPUS_RETENTION_ACCESS_TIER_MISMATCH');
  if (retentionDecision?.status === 'PASS' && (!Number.isSafeInteger(retentionDecision.retentionCoverageUntilMs)
    || retentionDecision.retentionCoverageUntilMs < item.retention?.minimumRetainUntilMs)) failReasons.push('CORPUS_RETENTION_COVERAGE_INSUFFICIENT');
  if (retentionDecision?.status === 'PASS' && sourceOwnerIds.has(retentionDecision.retentionOwnerId)) failReasons.push('CORPUS_RETENTION_OWNER_NOT_INDEPENDENT');
  if (retentionDecision?.status === 'PASS') {
    const retentionActors = new Set([
      retentionDecision.retentionOwnerId,
      retentionDecision.retentionVerifierId,
      ...(retentionDecision.retentionWriterIds ?? []),
      ...(retentionDecision.retentionVerifierIds ?? []),
    ]);
    if ([...sourceOwnerIds].some((actor) => retentionActors.has(actor))) failReasons.push('CORPUS_RETENTION_OWNER_NOT_INDEPENDENT');
    if (retentionActors.has(item.validation?.verifierId)) failReasons.push('CORPUS_VALIDATOR_RETENTION_COMMON_MODE');
    if (retentionActors.has(item.independentOutcome?.verifierId)) failReasons.push('CORPUS_OUTCOME_RETENTION_COMMON_MODE');
  }

  const fixedExtra = {
    decisionKind: 'CORPUS_ITEM_GOVERNANCE',
    sourceEvidenceDigest: sha256Hex({
      itemContentDigest: expectedContentDigest,
      dedupRegistryEvidenceDigest: dedupRegistryValid ? dedupRegistry.evidenceDigest : null,
      retentionDecisionDigest: retentionDecision?.decisionDigest ?? null,
    }),
    corpusItemId: item.corpusItemId,
    stableKey: expectedStableKey,
    contentDigest: expectedContentDigest,
    retentionTraceId: item.retentionTraceId,
    traceDecisionDigest: retentionDecision?.decisionDigest ?? null,
    partition: item.partition?.name ?? 'UNKNOWN',
    validationVerifierId: item.validation?.verifierId ?? null,
    outcomeVerifierId: item.independentOutcome?.verifierId ?? null,
    retentionOwnerId: retentionDecision?.retentionOwnerId ?? null,
    retentionVerifierId: retentionDecision?.retentionVerifierId ?? null,
    retentionWriterIds: stableUnique(retentionDecision?.retentionWriterIds ?? []),
    retentionVerifierIds: stableUnique(retentionDecision?.retentionVerifierIds ?? []),
    dedupRegistryRevision: dedupRegistryValid ? dedupRegistry.revision : null,
    dedupRegistryEvidenceDigest: dedupRegistryValid ? dedupRegistry.evidenceDigest : null,
    dedupTargetId: item.dedup?.state === 'EXACT_MATCH' ? (item.dedup?.existingItemId ?? null) : null,
    dedupTargetContentDigest: item.dedup?.state === 'EXACT_MATCH' ? (item.dedup?.existingContentDigest ?? null) : null,
    sourceOwnerIds: stableUnique([...sourceOwnerIds]),
    canonicalEvidenceMutationAllowed: false,
    appendOnlyEvidenceDeletionAllowed: false,
  };
  if (failReasons.length > 0) return fail(nowMs, 'CORPUS_ITEM_REJECTED', failReasons, evidenceRefs, fixedExtra);
  if (unknownReasons.length > 0) return unknown(nowMs, 'CORPUS_ITEM_QUARANTINED', unknownReasons, evidenceRefs, fixedExtra);
  return sealedEvidencePass(nowMs, item.dedup.state === 'EXACT_MATCH' ? 'CORPUS_DEDUPLICATE_REFERENCE' : 'CORPUS_READ_PROJECTION_ELIGIBLE', evidenceRefs, fixedExtra);
}

/** Release/holdout governance; output is a deterministic eligibility digest only. */
export function evaluateCorpusReleaseGovernance({ release, itemDecisions, nowMs }) {
  assertUtcMillis(nowMs);
  if (!release) return unknown(nowMs, 'CORPUS_RELEASE_UNKNOWN', ['CORPUS_RELEASE_MISSING']);
  const failReasons = [];
  const unknownReasons = [];
  const evidenceRefs = [];
  if (!hasExactKeys(release, CORPUS_RELEASE_KEYS) || findForbiddenKeys(release).length > 0
    || !hasExactKeys(release.partitions, CORPUS_RELEASE_PARTITION_KEYS)
    || !Array.isArray(release.itemBindings)
    || release.itemBindings.some((entry) => !hasExactKeys(entry, CORPUS_RELEASE_ITEM_BINDING_KEYS))
    || (!hasExactKeys(release.leakageScan, EVIDENCE_CHECK_KEYS)
      && !hasExactKeys(release.leakageScan, VERIFIED_EVIDENCE_CHECK_KEYS))
    || !hasExactKeys(release.reviewer, CORPUS_RELEASE_REVIEWER_KEYS)) {
    failReasons.push('CORPUS_RELEASE_CONTRACT_INVALID');
  }
  if (release.schema !== 'CorpusReleaseV1' || release.version !== 1) failReasons.push('CORPUS_RELEASE_SCHEMA_UNSUPPORTED');
  const partitions = release.partitions ?? {};
  const names = ['train', 'validation', 'holdout', 'retrievalOnly'];
  const allIds = [];
  const partitionForId = new Map();
  const partitionNames = Object.freeze({ train: 'TRAIN', validation: 'VALIDATION', holdout: 'HOLDOUT', retrievalOnly: 'RETRIEVAL_ONLY' });
  for (const name of names) {
    if (!Array.isArray(partitions[name]) || !partitions[name].every(isNonEmptyString)) unknownReasons.push(`CORPUS_${name.toUpperCase()}_PARTITION_UNKNOWN`);
    else {
      allIds.push(...partitions[name]);
      for (const id of partitions[name]) partitionForId.set(id, partitionNames[name]);
    }
  }
  if (new Set(allIds).size !== allIds.length) failReasons.push('CORPUS_CROSS_PARTITION_LEAKAGE');
  if (release.holdoutLocked !== true) failReasons.push('CORPUS_HOLDOUT_NOT_LOCKED');
  if (release.leakageScan?.status === 'FAIL') failReasons.push('CORPUS_LEAKAGE_SCAN_FAILED');
  else if (release.leakageScan?.status !== 'PASS' || !hasHash(release.leakageScan?.evidenceDigest)) unknownReasons.push('CORPUS_LEAKAGE_SCAN_UNKNOWN');
  else evidenceRefs.push(release.leakageScan.evidenceDigest);
  if (release.reviewer?.relationship !== 'INDEPENDENT' || release.reviewer?.status !== 'PASS') {
    (release.reviewer?.status === 'FAIL' ? failReasons : unknownReasons).push('CORPUS_RELEASE_REVIEW_NOT_PROVEN');
  } else if (hasHash(release.reviewer.evidenceDigest) && isNonEmptyString(release.reviewer.reviewerId)
    && release.reviewer.evidenceDigest === corpusReleaseReviewEvidenceDigest(release)) evidenceRefs.push(release.reviewer.evidenceDigest);
  else failReasons.push('CORPUS_RELEASE_REVIEW_EVIDENCE_INVALID');
  const bindings = release.itemBindings;
  if (!Array.isArray(bindings) || bindings.length !== allIds.length) unknownReasons.push('CORPUS_ITEM_BINDINGS_INCOMPLETE');
  else if (new Set(bindings.map((binding) => binding.corpusItemId)).size !== bindings.length) failReasons.push('CORPUS_ITEM_BINDING_DUPLICATE');
  if (!Array.isArray(itemDecisions) || itemDecisions.length !== allIds.length) unknownReasons.push('CORPUS_ITEM_DECISIONS_INCOMPLETE');
  else {
    const itemActorIds = new Set(itemDecisions.flatMap((decision) => [
      decision.validationVerifierId, decision.outcomeVerifierId, decision.retentionOwnerId, decision.retentionVerifierId,
      ...(decision.retentionWriterIds ?? []), ...(decision.retentionVerifierIds ?? []),
      ...(decision.sourceOwnerIds ?? []),
    ]).filter(isNonEmptyString));
    if (itemActorIds.has(release.reviewer?.reviewerId)) failReasons.push('CORPUS_RELEASE_REVIEWER_NOT_INDEPENDENT');
    if (itemDecisions.some((decision) => decision.status === 'FAIL')) failReasons.push('CORPUS_ITEM_REJECTED');
    if (itemDecisions.some((decision) => decision.status !== 'PASS')) unknownReasons.push('CORPUS_ITEM_UNKNOWN');
    evidenceRefs.push(...itemDecisions.flatMap((decision) => decision.evidenceRefs ?? []));
    const decisionIds = stableUnique(itemDecisions.map((decision) => decision.corpusItemId).filter(isNonEmptyString));
    if (canonicalStringify(decisionIds) !== canonicalStringify(stableUnique(allIds))) failReasons.push('CORPUS_ITEM_DECISION_ID_MISMATCH');
    for (const decision of itemDecisions) {
      if (!isEvaluationEnvelope(decision, nowMs, 'CORPUS_ITEM_GOVERNANCE')) failReasons.push('CORPUS_ITEM_DECISION_ENVELOPE_INVALID');
      const binding = bindings?.find((entry) => entry.corpusItemId === decision.corpusItemId);
      if (!binding || decision.stableKey !== binding.stableKey || decision.contentDigest !== binding.contentDigest
        || decision.partition !== binding.partition || partitionForId.get(decision.corpusItemId) !== decision.partition) {
        failReasons.push('CORPUS_ITEM_RELEASE_BINDING_MISMATCH');
      }
    }
  }
  const digestInput = {
    releaseId: release.releaseId,
    revision: release.revision,
    policyRevision: release.policyRevision,
    partitions: Object.fromEntries(names.map((name) => [name, stableUnique(partitions[name] ?? [])])),
    itemBindings: [...(release.itemBindings ?? [])]
      .map(({ corpusItemId, stableKey, contentDigest, partition }) => ({ corpusItemId, stableKey, contentDigest, partition }))
      .sort((left, right) => compareCodeUnits(canonicalStringify(left), canonicalStringify(right))),
  };
  const expectedManifestDigest = sha256Hex(digestInput);
  if (release.manifestDigest !== expectedManifestDigest) failReasons.push('CORPUS_MANIFEST_DIGEST_MISMATCH');
  else evidenceRefs.push(expectedManifestDigest);
  const fixedExtra = { releaseId: release.releaseId, manifestDigest: expectedManifestDigest, corpusStorageMutationAllowed: false };
  if (failReasons.length > 0) return fail(nowMs, 'CORPUS_RELEASE_REJECTED', failReasons, evidenceRefs, fixedExtra);
  if (unknownReasons.length > 0) return unknown(nowMs, 'CORPUS_RELEASE_QUARANTINED', unknownReasons, evidenceRefs, fixedExtra);
  return pass(nowMs, 'CORPUS_RELEASE_ELIGIBLE', evidenceRefs, fixedExtra);
}

export function corpusManifestDigest(release) {
  const names = ['train', 'validation', 'holdout', 'retrievalOnly'];
  return sha256Hex({
    releaseId: release.releaseId,
    revision: release.revision,
    policyRevision: release.policyRevision,
    partitions: Object.fromEntries(names.map((name) => [name, stableUnique(release.partitions?.[name] ?? [])])),
    itemBindings: [...(release.itemBindings ?? [])]
      .map(({ corpusItemId, stableKey, contentDigest, partition }) => ({ corpusItemId, stableKey, contentDigest, partition }))
      .sort((left, right) => compareCodeUnits(canonicalStringify(left), canonicalStringify(right))),
  });
}

export function corpusReleaseReviewEvidenceDigest(release) {
  return sha256Hex({
    releaseId: release?.releaseId ?? null,
    revision: release?.revision ?? null,
    policyRevision: release?.policyRevision ?? null,
    manifestDigest: release?.manifestDigest ?? null,
    holdoutLocked: release?.holdoutLocked ?? null,
    leakageScanEvidenceDigest: release?.leakageScan?.evidenceDigest ?? null,
    reviewerId: release?.reviewer?.reviewerId ?? null,
    relationship: release?.reviewer?.relationship ?? null,
    status: release?.reviewer?.status ?? null,
  });
}

export function diagnosticRequestDigest(request) {
  return sha256Hex(request);
}

export function workloadIdentityEventEvidenceHash(event) {
  return sha256Hex({
    schema: event?.schema ?? null,
    version: event?.version ?? null,
    sequence: event?.sequence ?? null,
    type: event?.type ?? null,
    observedAtMs: event?.observedAtMs ?? null,
    generation: event?.generation ?? null,
    providerId: event?.providerId ?? null,
    identityRef: event?.identityRef ?? null,
    bindingId: event?.bindingId ?? null,
    environment: event?.environment ?? null,
    audience: event?.audience ?? null,
    subjectDigest: event?.subjectDigest ?? null,
    capabilityDigest: event?.capabilityDigest ?? null,
    notBeforeMs: event?.notBeforeMs ?? null,
    rotationDueAtMs: event?.rotationDueAtMs ?? null,
    expiresAtMs: event?.expiresAtMs ?? null,
  });
}

export function sandboxBoundaryDigest(decision) {
  return sha256Hex({
    bindingId: decision?.bindingId ?? null,
    requestId: decision?.requestId ?? null,
    requestDigest: decision?.requestDigest ?? null,
    providerId: decision?.providerId ?? null,
    modelId: decision?.modelId ?? null,
    modelVersion: decision?.modelVersion ?? null,
    policyRevision: decision?.policyRevision ?? null,
    identityRef: decision?.identityRef ?? null,
    workloadAudience: decision?.workloadAudience ?? null,
    workloadCapabilityDigest: decision?.workloadCapabilityDigest ?? null,
    workloadSubjectDigest: decision?.workloadSubjectDigest ?? null,
    environment: decision?.environment ?? null,
    identityDecisionDigest: decision?.identityDecisionDigest ?? null,
    traceDecisionDigest: decision?.traceDecisionDigest ?? null,
    expiresAtMs: decision?.expiresAtMs ?? null,
    maxCalls: decision?.maxCalls ?? null,
    sourceEvidenceDigest: decision?.sourceEvidenceDigest ?? null,
    permissionLevel: decision?.permissionLevel ?? null,
    capabilities: decision?.capabilities ?? null,
    toolIds: decision?.toolIds ?? null,
  });
}

export function diagnosticKillReadbackDigest(readback) {
  return sha256Hex({
    schema: readback?.schema ?? null,
    version: readback?.version ?? null,
    controlId: readback?.controlId ?? null,
    controlRevision: readback?.controlRevision ?? null,
    bindingRevision: readback?.bindingRevision ?? null,
    sourceState: readback?.sourceState ?? null,
    wiringState: readback?.wiringState ?? null,
    desiredState: readback?.desiredState ?? null,
    effectiveState: readback?.effectiveState ?? null,
    evaluatedAtMs: readback?.evaluatedAtMs ?? null,
  });
}

export function sandboxApprovalEvidenceDigest(approval) {
  return sha256Hex({
    schema: approval?.schema ?? null,
    version: approval?.version ?? null,
    baseContractRef: approval?.baseContractRef ?? null,
    status: approval?.status ?? null,
    approvalRef: approval?.approvalRef ?? null,
    requestId: approval?.requestId ?? null,
    requestDigest: approval?.requestDigest ?? null,
    environment: approval?.environment ?? null,
    policyRevision: approval?.policyRevision ?? null,
    modelId: approval?.modelId ?? null,
    modelVersion: approval?.modelVersion ?? null,
    capabilities: stableUnique(approval?.capabilities ?? []),
    maximumEffect: approval?.maximumEffect ?? null,
    expiresAtMs: approval?.expiresAtMs ?? null,
    rollbackPlanDigest: approval?.rollbackPlanDigest ?? null,
    approverId: approval?.approverId ?? null,
  });
}

export function snapshotEvaluation(value) {
  return immutableClone(value);
}
