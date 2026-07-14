import {
  assertIdentifier,
  assertUtcMillis,
  canonicalStringify,
  deepFreeze,
  hasExactKeys,
  immutableClone,
  isPlainRecord,
  sha256Hex,
  stableUnique,
} from './canonical.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const SHADOW_BASE_SHA = '03857dcdaff8d8b12627d27ddcc97505da1f2f86';
const FIXTURE_CREATED_AT_MS = 1_784_070_000_000;
const FIXTURE_MAX_EXPIRY_MS = FIXTURE_CREATED_AT_MS + 3_600_000;
const FIXTURE_RESOURCE_SCOPE = deepFreeze(['fixture-resource-001']);
const FIXTURE_TOOL_AUDIT_FIELDS = deepFreeze(['caseId', 'toolId', 'contentHash']);
const FIXTURE_TOOL_PRECONDITIONS = deepFreeze(['SHADOW_ONLY']);
const FIXTURE_TOOL_POSTCONDITIONS = deepFreeze(['ZERO_PRODUCT_EFFECT']);
const FIXTURE_LIVE_PRECONDITIONS = deepFreeze(['SHADOW_ONLY', 'NO_NETWORK', 'NO_PRODUCT_WRITE']);
const FIXTURE_ACTION_POSTCONDITIONS = deepFreeze(['PRODUCT_SAFETY_DIGEST_UNCHANGED']);
const FIXTURE_TOOL_INPUT_SCHEMA_HASH = sha256Hex('A5_SHADOW_SPECULATIVE:tool-input-schema');
const FIXTURE_TOOL_OUTPUT_SCHEMA_HASH = sha256Hex('A5_SHADOW_SPECULATIVE:tool-output-schema');
const FIXTURE_PROVIDER_SCHEMA_PARITY_HASH = sha256Hex('A5_SHADOW_SPECULATIVE:provider-schema-parity');
const FIXTURE_PROVIDER_TOOL_PARITY_HASH = sha256Hex('A5_SHADOW_SPECULATIVE:provider-tool-parity');
const FIXTURE_METADATA_BY_TYPE = deepFreeze({
  ActionEnvelope: ['a1-action-001', 'A1_SHADOW_ASSUMED', 'NOT_EXECUTABLE', 'acceptedA1ActionSchema'],
  ApprovalRequest: ['a1-approval-request-001', 'A1_SHADOW_ASSUMED', 'NOT_SENT', 'acceptedA1ApprovalRequestSchema'],
  ApprovalReceipt: ['a1-approval-001', 'A1_SHADOW_ASSUMED', 'UNUSED', 'acceptedA1ApprovalSchema'],
  AgentBudgetPolicy: ['a1-budget-001', 'A1_SHADOW_ASSUMED', 'FIXTURE_ONLY', 'acceptedA1BudgetSchema'],
  AgentPermissionProfile: ['a1-permission-001', 'A1_SHADOW_ASSUMED', 'FIXTURE_ONLY', 'acceptedA1PermissionSchema'],
  PolicyDecision: ['a1-policy-001', 'A1_SHADOW_ASSUMED', 'DENIED', 'acceptedA1PolicySchema'],
  AgentCase: ['a2-case-001', 'A2_SHADOW_ASSUMED', 'CASE_OPENED', 'acceptedA2CaseSchema'],
  DiagnosticReport: ['a2-diagnostic-001', 'A2_SHADOW_ASSUMED', 'INCONCLUSIVE', 'acceptedA2DiagnosticSchema'],
  IncidentEvidenceBundle: ['a2-evidence-001', 'A2_SHADOW_ASSUMED', 'EVIDENCE_FROZEN', 'acceptedA2EvidenceSchema'],
  DurableWorkflowCheckpoint: ['a2-checkpoint-001', 'A2_SHADOW_ASSUMED', 'CHECKPOINTED', 'acceptedA2CheckpointSchema'],
  ProviderCallback: ['a3-callback-001', 'A3_SHADOW_ASSUMED', 'VALIDATED', 'acceptedA3CallbackSchema'],
  CredentialProxyRequest: ['a3-credential-request-001', 'A3_SHADOW_ASSUMED', 'NOT_SENT', 'acceptedA3CredentialProxySchema'],
  AgentProviderDescriptor: ['a3-provider-001', 'A3_SHADOW_ASSUMED', 'FIXTURE_ONLY', 'acceptedA3ProviderSchema'],
  ToolCapabilityDescriptor: ['a3-tool-001', 'A3_SHADOW_ASSUMED', 'FIXTURE_ONLY', 'acceptedA3ToolSchema'],
  TypedToolOutput: ['a3-tool-output-001', 'A3_SHADOW_ASSUMED', 'SCHEMA_VALID', 'acceptedA3ToolOutputSchema'],
  AgentAuditProjection: ['assurance-audit-001', 'A3_SHADOW_ASSUMED', 'FIXTURE_ONLY', 'acceptedAuditProjectionSchema'],
  BreakGlassRecoveryReceipt: ['assurance-break-glass-001', 'A1_SHADOW_ASSUMED', 'UNUSED', 'acceptedBreakGlassSchema'],
  CanaryReceipt: ['assurance-canary-001', 'A3_SHADOW_ASSUMED', 'INCONCLUSIVE', 'acceptedCanaryReceiptSchema'],
  ControlChangeSet: ['assurance-control-set-001', 'A1_SHADOW_ASSUMED', 'REJECTED', 'acceptedControlChangeSetSchema'],
  AgentGuardrailTripEvent: ['assurance-guardrail-001', 'A1_SHADOW_ASSUMED', 'HARD_DENIED', 'acceptedGuardrailTripSchema'],
  ProviderUsageReceipt: ['assurance-usage-001', 'A3_SHADOW_ASSUMED', 'ZERO_CALLS', 'acceptedProviderUsageReceiptSchema'],
  RollbackReceipt: ['assurance-rollback-001', 'A3_SHADOW_ASSUMED', 'NOT_REQUIRED', 'acceptedRollbackReceiptSchema'],
  VerificationReceipt: ['assurance-verification-001', 'A3_SHADOW_ASSUMED', 'INCONCLUSIVE', 'acceptedVerificationReceiptSchema'],
});
const BREAK_GLASS_ALLOWED_CONTROL_IDS = new Set(['AI_OPS_KILL_SWITCH']);
const CONTRACT_KEYS = Object.freeze([
  'contentHash',
  'createdAtMs',
  'environment',
  'missingFields',
  'objectType',
  'owner',
  'payload',
  'provenance',
  'schemaVersion',
  'shadowStatus',
  'sourceRevision',
  'stableId',
  'state',
  'unknownFields',
]);

export const PROVIDER_STATES = deepFreeze([
  'NOT_CONFIGURED',
  'SUBSCRIPTION_CODEX_WORKER',
  'SUBSCRIPTION_CLAUDE_CODE_WORKER',
  'API_CONFIGURED',
  'DIAGNOSTIC_PLANE_UNAVAILABLE',
]);

export const OPERATING_MODES = deepFreeze([
  'OFF',
  'OBSERVE',
  'SHADOW',
  'ADVISE',
  'SANDBOX_PATCH',
  'BOUNDED_AUTOREMEDIATE',
  'APPROVAL_HANDOFF',
]);

export const INCIDENT_SEVERITIES = deepFreeze([
  'SEV0_SAFETY',
  'SEV1_CRITICAL',
  'SEV2_MAJOR',
  'SEV3_DEGRADED',
  'SEV4_INFORMATIONAL',
]);

export const REASONING_DEPTHS = deepFreeze([
  'L0_DETERMINISTIC',
  'L1_CLASSIFY',
  'L2_DIAGNOSE',
  'L3_RESEARCH',
  'L4_REPAIR',
  'L5_ADJUDICATE',
]);

export const DIAGNOSIS_DISPOSITIONS = deepFreeze(['VALIDATED', 'INVALIDATED', 'INCONCLUSIVE']);

export const CASE_STATES = deepFreeze([
  'DETECTED',
  'DEDUPED_OR_SUPPRESSED',
  'CASE_OPENED',
  'EVIDENCE_FROZEN',
  'REDACTION_VERIFIED',
  'BUDGET_ADMITTED',
  'DIAGNOSING',
  'DIAGNOSIS_READY',
  'INSUFFICIENT_EVIDENCE',
  'PROVIDER_UNAVAILABLE',
  'PROPOSAL_READY',
  'OWNER_ATTENTION_REQUIRED',
  'QUARANTINED',
  'POLICY_EVALUATED',
  'SANDBOX_VERIFYING',
  'WAITING_APPROVAL',
  'REJECTED',
  'VERIFIED',
  'VERIFICATION_FAILED',
  'HANDED_OFF',
  'EXPIRED',
  'ACTION_READBACK',
  'RESOLVED',
  'ROLLED_BACK',
  'RECURRENT',
  'ESCALATED',
  'POSTMORTEM_AND_LEARNING_RECORDED',
]);

export const HARD_DENIAL_CAPABILITIES = deepFreeze({
  ORDER_MUTATION_DIRECT: 'sign submit amend or cancel an order directly',
  FUNDS_MUTATION: 'borrow repay transfer withdraw bridge reserve or move funds',
  RISK_CAPITAL_MUTATION: 'change leverage margin position capital risk symbol or loss limits',
  SAFETY_GATE_BYPASS: 'bypass Risk Capital mandate reconciliation lease or kill switch',
  PRIVATE_CREDENTIAL_ACCESS: 'read reveal export rotate or alter private credentials',
  SELF_AUTHORITY_MUTATION: 'change own permissions policy audit budgets or hard denials',
  EVIDENCE_REWRITE: 'delete or rewrite incident evidence audit ledger receipt or trace history',
  LIVE_WRITE: 'write Main live checkout production persistence or live binary',
  SELF_MERGE_DEPLOY: 'merge or deploy itself',
  SELF_APPROVE_VERIFY: 'approve or verify its own proposal',
  ARBITRARY_TOOL_ACCESS: 'use arbitrary shell network MCP or filesystem',
  SAFETY_MONITOR_DISABLE: 'disable monitoring sentinel kill reconciliation or verification',
  DUPLICATE_AUTHORITY_CREATE: 'create a new control execution risk or ledger authority',
  UNTRUSTED_TEXT_EXECUTION: 'treat untrusted text as executable instructions',
});

const PAYLOAD_KEYS = deepFreeze({
  PolicyDecision: [
    'allowed', 'artifactHash', 'attemptBudget', 'blastRadius', 'capability', 'capitalPosture',
    'caseId', 'concurrencyBudget', 'costBudgetMicrounits', 'environment', 'evidenceBundleHash',
    'expiresAtMs', 'hardDenialResult', 'incidentId', 'mode', 'modelId', 'policyRevision',
    'principalId', 'providerId', 'requiredApprovers', 'resourceScope', 'reversible', 'riskClass',
    'runId',
  ],
  AgentPermissionProfile: [
    'allowedCapabilities', 'allowedEnvironments', 'allowedModes', 'allowedToolIds', 'deniedCapabilities',
    'expiresAtMs', 'policyRevision', 'principalId', 'resourceScope', 'role',
  ],
  AgentBudgetPolicy: [
    'approvalBurstLimit', 'attemptLimit', 'childCaseLimit', 'concurrencyLimit', 'costBudgetMicrounits',
    'emergencyReserveMicrounits', 'globalAttemptUsage', 'globalCostUsageMicrounits', 'policyId',
    'principalId', 'resetPolicy', 'revision', 'tokenLimit',
  ],
  ApprovalRequest: [
    'approvalRequestId', 'argumentHash', 'artifactHash', 'baseSha', 'candidateSha', 'capability',
    'caseId', 'controlRegistryRevision', 'createdAtMs', 'deployedSha', 'environment', 'evidenceBundleHash',
    'exactToolId', 'expiresAtMs', 'incidentId', 'livePreconditions', 'maximumEffect', 'nonce',
    'policyRevision', 'resourceScope',
  ],
  ApprovalReceipt: [
    'approvalId', 'approverId', 'argumentHash', 'artifactHash', 'authenticationStrength', 'baseSha',
    'candidateSha', 'capability', 'caseId', 'controlRegistryRevision', 'createdAtMs', 'deployedSha',
    'environment', 'evidenceBundleHash', 'exactToolId', 'expiresAtMs', 'incidentId', 'livePreconditions',
    'maximumEffect', 'nonce', 'policyRevision', 'remainingActionCount', 'resourceScope', 'used',
  ],
  ActionEnvelope: [
    'actionId', 'approvalReceiptIds', 'attemptBudget', 'blastRadius', 'capitalPostureRequirement',
    'caseId', 'concurrencyBudget', 'deadlineMs', 'fencingEpoch', 'idempotencyKey', 'incidentId',
    'independentVerifierId', 'leaseId', 'maximumEffect', 'policyRevision', 'preconditions',
    'proposalHash', 'registeredActionType', 'requiredPostconditions', 'rollbackOrCompensation',
    'runbookRevision', 'targetResourceIds', 'ttlMs',
  ],
  IncidentEvidenceBundle: [
    'affectedResources', 'browserProbeRefs', 'bundleId', 'capitalPosture', 'configRevision',
    'conflictingEvidence', 'contentHashes', 'correlationIds', 'createdAtMs', 'dependencies',
    'deployedSha', 'environment', 'evidenceWindow', 'expectedInventoryRevision', 'fingerprint',
    'freshnessReport', 'incidentId', 'invariants', 'knownIssueRefs', 'lifecycleStates', 'logSamples',
    'materiality', 'metricSummaries', 'missingEvidence', 'recentReceiptRefs', 'reconciliationSummary',
    'redactionReport', 'runbookRefs', 'schemaRevisions', 'severity', 'signatures', 'testRefs',
    'timezone', 'traceIds', 'unknowns',
  ],
  AgentCase: [
    'attemptBudgetRemaining', 'caseId', 'contextHash', 'effectBudgetRemaining', 'evidenceBundleHash',
    'fingerprint', 'generation', 'reasoningDepth', 'severity', 'state', 'transitions',
    'workflowVersion',
  ],
  DurableWorkflowCheckpoint: [
    'attemptBudgetRemaining', 'baseSha', 'caseId', 'checkpointHash', 'contextHash', 'deployedSha',
    'effectBudgetRemaining', 'evidenceBundleHash', 'fencingEpoch', 'generation', 'leaseId',
    'nextAction', 'policyRevision', 'state', 'workflowVersion',
  ],
  DiagnosticReport: [
    'affectedCapabilities', 'caseId', 'conflictingEvidence', 'diagnosisId', 'evidenceBundleHash',
    'disposition', 'escalationReason', 'expiresAtMs', 'falsificationTests', 'forbiddenOrUnavailableActions',
    'hypotheses', 'immediateSafetyPosture', 'likelyRootCause', 'missingEvidence', 'modelRevision',
    'observedFacts', 'ownerAttentionRequired', 'patchRecommended', 'policyRevision', 'promptRevision',
    'proposedQueriesOrTests', 'recommendedNextStep', 'recommendedRunbookIds', 'supportingEvidence',
    'toolRevision', 'uncertainty',
  ],
  AgentProviderDescriptor: [
    'authType', 'backgroundCompatible', 'budgetMicrounits', 'capabilities', 'emergencyReserveMicrounits',
    'evalQualificationRevision', 'healthState', 'modelId', 'modelVersion', 'providerId',
    'providerState', 'region', 'retentionPosture', 'schemaParityHash', 'storeBehavior', 'toolParityHash',
  ],
  ToolCapabilityDescriptor: [
    'allowedModes', 'allowedPrincipals', 'approvalRequired', 'auditFields', 'byteLimit', 'capability',
    'costLimitMicrounits', 'dataClassification', 'environment', 'inputSchemaHash', 'networkAllowlist',
    'outputSchemaHash', 'pathAllowlist', 'postconditions', 'preconditions', 'rateLimit', 'redactionPolicy',
    'resourceScope', 'resultLimit', 'rowLimit', 'sandboxIdentity', 'schemaVersion', 'timeoutMs',
    'toolId', 'ttlMs',
  ],
  ProviderCallback: [
    'caseId', 'evidenceBundleHash', 'internalRunId', 'modelId', 'occurredAtMs', 'providerEventId',
    'payloadHash', 'providerId', 'receivedAtMs', 'signatureKeyRevision', 'signatureMaterial',
    'signatureState', 'timestampState', 'workflowGeneration',
  ],
  TypedToolOutput: [
    'additionalPropertiesPresent', 'contentHash', 'data', 'injectionDetected', 'schemaHash',
    'schemaValid', 'toolId',
  ],
  CredentialProxyRequest: [
    'bodyClassification', 'budgetMicrounits', 'caseId', 'controlRevision', 'endpoint', 'expiresAtMs',
    'method', 'modelRoute', 'policyRevision', 'requestSchemaHash', 'toolId',
  ],
  VerificationReceipt: [
    'candidateSha', 'caseId', 'disposition', 'evidenceBundleHash', 'expectedPostconditions',
    'observedPostconditions', 'recurrenceState', 'rollbackRequired', 'sharedAncestry',
    'unchangedSafetyInvariants', 'unresolvedAmbiguity', 'verificationId', 'verifierId', 'verifierRevision',
  ],
  CanaryReceipt: [
    'candidateSha', 'canaryId', 'caseId', 'cohortId', 'cohortState', 'comparisonState', 'disposition',
    'evidenceHashes', 'finiteMetrics', 'promotionAllowed', 'rollbackRequired', 'sampleCount',
  ],
  RollbackReceipt: [
    'caseId', 'completedAtMs', 'disposition', 'evidenceHashes', 'fromSha', 'independentReadbackState',
    'postconditionState', 'rollbackId', 'startedAtMs', 'toSha',
  ],
  ProviderUsageReceipt: [
    'budgetRemainingMicrounits', 'caseId', 'costMicrounits', 'inputTokens', 'modelId', 'outputTokens',
    'providerId', 'requestCount', 'reserveUsedMicrounits', 'usageId', 'windowEndMs', 'windowStartMs',
  ],
  AgentAuditProjection: [
    'actorId', 'auditId', 'caseId', 'contentHash', 'eventType', 'exportState', 'occurredAtMs',
    'policyRevision', 'previousHash', 'redactionState', 'wormReadbackState',
  ],
  ControlChangeSet: [
    'appliedCount', 'baseRegistryRevision', 'caseId', 'casState', 'changeSetId', 'changes',
    'independentReadbackState', 'lastKnownGoodRevision', 'rollbackState', 'validationState',
  ],
  AgentGuardrailTripEvent: [
    'auditHash', 'capability', 'caseId', 'decision', 'effectCount', 'eventId', 'networkAttemptCount',
    'occurredAtMs', 'policyRevision', 'reasonCode',
  ],
  BreakGlassRecoveryReceipt: [
    'allowedControlIds', 'argumentHash', 'authenticationStrength', 'caseId', 'createdAtMs',
    'expiresAtMs', 'forbiddenCapabilities', 'nonce', 'operatorId', 'readbackState', 'recoveryId', 'used',
  ],
});

function contractDraft({
  objectType,
  stableId,
  createdAtMs,
  environment,
  sourceRevision,
  provenance,
  state,
  owner,
  unknownFields,
  missingFields = [],
  payload,
}) {
  if (!Object.hasOwn(PAYLOAD_KEYS, objectType)) throw new TypeError(`unsupported objectType ${String(objectType)}`);
  assertIdentifier(stableId, 'stableId');
  assertIdentifier(environment, 'environment');
  assertIdentifier(sourceRevision, 'sourceRevision');
  assertIdentifier(provenance, 'provenance');
  assertIdentifier(state, 'state');
  assertIdentifier(owner, 'owner');
  assertUtcMillis(createdAtMs, 'createdAtMs');
  if (!hasExactKeys(payload, PAYLOAD_KEYS[objectType])) {
    throw new TypeError(`${objectType} payload keys do not match the shadow shape`);
  }
  return {
    schemaVersion: 'AIOPS_A5_SHADOW_CONTRACT_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    objectType,
    stableId,
    createdAtMs,
    environment,
    sourceRevision,
    provenance,
    state,
    owner,
    unknownFields: stableUnique(unknownFields),
    missingFields: stableUnique(missingFields),
    payload: immutableClone(payload),
  };
}

export function makeShadowContract(input) {
  const draft = contractDraft(input);
  return immutableClone({ ...draft, contentHash: sha256Hex(draft) });
}

function validStringArray(value, { allowEmpty = true } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((entry) => typeof entry === 'string');
}

function validIdentifier(value) {
  try {
    assertIdentifier(value, 'value');
    return true;
  } catch {
    return false;
  }
}

function matchesExactStringArray(value, expected) {
  return validStringArray(value)
    && canonicalStringify(value) === canonicalStringify(expected);
}

function validFixtureResourceScope(value) {
  return matchesExactStringArray(value, FIXTURE_RESOURCE_SCOPE);
}

function payloadSemantics(contract) {
  const payload = contract.payload;
  const hardDeniedCapabilities = new Set(Object.keys(HARD_DENIAL_CAPABILITIES));
  switch (contract.objectType) {
    case 'PolicyDecision':
      return OPERATING_MODES.includes(payload.mode)
        && typeof payload.allowed === 'boolean'
        && contract.state === (payload.allowed ? 'ALLOWED' : 'DENIED')
        && ['DENY', 'NOT_APPLICABLE'].includes(payload.hardDenialResult)
        && !(payload.allowed && payload.hardDenialResult === 'DENY')
        && (!hardDeniedCapabilities.has(payload.capability)
          || (!payload.allowed && payload.hardDenialResult === 'DENY'))
        && payload.environment === 'SYNTHETIC_ONLY'
        && payload.blastRadius === 'SYNTHETIC_RESOURCE_ONLY'
        && validFixtureResourceScope(payload.resourceScope)
        && Number.isSafeInteger(payload.attemptBudget) && payload.attemptBudget >= 0
        && Number.isSafeInteger(payload.concurrencyBudget) && payload.concurrencyBudget >= 0
        && Number.isSafeInteger(payload.costBudgetMicrounits) && payload.costBudgetMicrounits >= 0
        && Number.isSafeInteger(payload.expiresAtMs)
        && payload.expiresAtMs > contract.createdAtMs
        && payload.expiresAtMs <= FIXTURE_MAX_EXPIRY_MS
        && HASH.test(payload.evidenceBundleHash)
        && HASH.test(payload.artifactHash)
        && validStringArray(payload.requiredApprovers, { allowEmpty: false });
    case 'AgentPermissionProfile':
      return payload.role === 'SHADOW_EVALUATOR'
        && validStringArray(payload.allowedCapabilities)
        && payload.allowedCapabilities.every((capability) => !hardDeniedCapabilities.has(capability))
        && validStringArray(payload.allowedEnvironments, { allowEmpty: false })
        && payload.allowedEnvironments.every((environment) => environment === 'SYNTHETIC_ONLY')
        && validStringArray(payload.allowedModes, { allowEmpty: false })
        && payload.allowedModes.every((mode) => OPERATING_MODES.includes(mode))
        && validStringArray(payload.allowedToolIds)
        && validFixtureResourceScope(payload.resourceScope)
        && validStringArray(payload.deniedCapabilities, { allowEmpty: false })
        && payload.deniedCapabilities.length === hardDeniedCapabilities.size
        && [...hardDeniedCapabilities].every((capability) => payload.deniedCapabilities.includes(capability))
        && payload.allowedCapabilities.every((capability) => !payload.deniedCapabilities.includes(capability))
        && Number.isSafeInteger(payload.expiresAtMs)
        && payload.expiresAtMs > contract.createdAtMs
        && payload.expiresAtMs <= FIXTURE_MAX_EXPIRY_MS;
    case 'AgentBudgetPolicy':
      return [
        payload.approvalBurstLimit,
        payload.attemptLimit,
        payload.childCaseLimit,
        payload.concurrencyLimit,
        payload.costBudgetMicrounits,
        payload.emergencyReserveMicrounits,
        payload.globalAttemptUsage,
        payload.globalCostUsageMicrounits,
        payload.tokenLimit,
      ].every((value) => Number.isSafeInteger(value) && value >= 0)
        && payload.globalAttemptUsage <= payload.attemptLimit
        && payload.globalCostUsageMicrounits <= payload.costBudgetMicrounits
        && payload.emergencyReserveMicrounits <= payload.costBudgetMicrounits
        && payload.resetPolicy === 'DURABLE_OWNER_ONLY';
    case 'ApprovalRequest':
      return HASH.test(payload.argumentHash)
        && HASH.test(payload.artifactHash)
        && HASH.test(payload.evidenceBundleHash)
        && validIdentifier(payload.exactToolId)
        && payload.exactToolId === 'fixture-tool'
        && !hardDeniedCapabilities.has(payload.capability)
        && payload.environment === 'SYNTHETIC_ONLY'
        && payload.maximumEffect === 'ZERO_PRODUCT_EFFECT'
        && payload.baseSha === SHADOW_BASE_SHA
        && payload.candidateSha === SHADOW_BASE_SHA
        && payload.deployedSha === SHADOW_BASE_SHA
        && validFixtureResourceScope(payload.resourceScope)
        && matchesExactStringArray(payload.livePreconditions, FIXTURE_LIVE_PRECONDITIONS)
        && Number.isSafeInteger(payload.createdAtMs)
        && Number.isSafeInteger(payload.expiresAtMs)
        && payload.expiresAtMs > payload.createdAtMs
        && payload.expiresAtMs <= FIXTURE_MAX_EXPIRY_MS;
    case 'ApprovalReceipt':
      return HASH.test(payload.argumentHash)
        && HASH.test(payload.artifactHash)
        && HASH.test(payload.evidenceBundleHash)
        && typeof payload.used === 'boolean'
        && contract.state === (payload.used ? 'USED' : 'UNUSED')
        && payload.authenticationStrength === 'SYNTHETIC_FIXTURE_ONLY'
        && validIdentifier(payload.exactToolId)
        && payload.exactToolId === 'fixture-tool'
        && !hardDeniedCapabilities.has(payload.capability)
        && payload.environment === 'SYNTHETIC_ONLY'
        && payload.maximumEffect === 'ZERO_PRODUCT_EFFECT'
        && payload.baseSha === SHADOW_BASE_SHA
        && payload.candidateSha === SHADOW_BASE_SHA
        && payload.deployedSha === SHADOW_BASE_SHA
        && validFixtureResourceScope(payload.resourceScope)
        && matchesExactStringArray(payload.livePreconditions, FIXTURE_LIVE_PRECONDITIONS)
        && Number.isSafeInteger(payload.remainingActionCount)
        && payload.remainingActionCount >= 0
        && Number.isSafeInteger(payload.createdAtMs)
        && Number.isSafeInteger(payload.expiresAtMs)
        && payload.expiresAtMs > payload.createdAtMs
        && payload.expiresAtMs <= FIXTURE_MAX_EXPIRY_MS;
    case 'ActionEnvelope':
      return contract.state === 'NOT_EXECUTABLE'
        && Number.isSafeInteger(payload.fencingEpoch)
        && payload.fencingEpoch >= 1
        && Number.isSafeInteger(payload.attemptBudget) && payload.attemptBudget >= 0
        && Number.isSafeInteger(payload.concurrencyBudget) && payload.concurrencyBudget >= 0
        && Number.isSafeInteger(payload.ttlMs)
        && payload.ttlMs > 0
        && contract.createdAtMs + payload.ttlMs <= FIXTURE_MAX_EXPIRY_MS
        && Number.isSafeInteger(payload.deadlineMs)
        && payload.deadlineMs > contract.createdAtMs
        && payload.deadlineMs <= contract.createdAtMs + payload.ttlMs
        && payload.maximumEffect === 'ZERO_PRODUCT_EFFECT'
        && payload.blastRadius === 'SYNTHETIC_RESOURCE_ONLY'
        && payload.capitalPostureRequirement === 'NOT_APPLICABLE'
        && payload.rollbackOrCompensation === 'NO_EFFECT_TO_ROLL_BACK'
        && validIdentifier(payload.independentVerifierId)
        && !hardDeniedCapabilities.has(payload.registeredActionType)
        && validStringArray(payload.approvalReceiptIds, { allowEmpty: false })
        && validFixtureResourceScope(payload.targetResourceIds)
        && matchesExactStringArray(payload.preconditions, FIXTURE_LIVE_PRECONDITIONS)
        && matchesExactStringArray(payload.requiredPostconditions, FIXTURE_ACTION_POSTCONDITIONS)
        && HASH.test(payload.proposalHash);
    case 'IncidentEvidenceBundle':
      return INCIDENT_SEVERITIES.includes(payload.severity)
        && payload.environment === 'SYNTHETIC_ONLY'
        && payload.deployedSha === SHADOW_BASE_SHA
        && validFixtureResourceScope(payload.affectedResources)
        && payload.capitalPosture === 'UNKNOWN'
        && payload.materiality === 'SYNTHETIC_ONLY'
        && HASH.test(payload.contentHashes.bundle)
        && hasExactKeys(payload.contentHashes, ['bundle'])
        && hasExactKeys(payload.freshnessReport, ['observedAtMs', 'state'])
        && payload.freshnessReport.state === 'FRESH'
        && payload.freshnessReport.observedAtMs === contract.createdAtMs
        && hasExactKeys(payload.evidenceWindow, ['fromMs', 'toMs'])
        && payload.evidenceWindow.fromMs === contract.createdAtMs - 60_000
        && payload.evidenceWindow.toMs === contract.createdAtMs
        && matchesExactStringArray(payload.lifecycleStates, ['RUNNING'])
        && hasExactKeys(payload.redactionReport, ['rawBytesExported', 'secretMatches'])
        && payload.redactionReport.rawBytesExported === false
        && payload.redactionReport.secretMatches === 0
        && payload.reconciliationSummary === 'NOT_MOUNTED_IN_SHADOW'
        && Array.isArray(payload.signatures) && payload.signatures.length === 1
        && hasExactKeys(payload.signatures[0], ['signer', 'state'])
        && payload.signatures[0].signer === 'SYNTHETIC_FIXTURE'
        && payload.signatures[0].state === 'VALID_FIXTURE_ONLY'
        && validStringArray(payload.missingEvidence)
        && validStringArray(payload.conflictingEvidence)
        && matchesExactStringArray(payload.unknowns, ['I00_INCIDENT_OWNER_UNFINISHED']);
    case 'AgentCase':
      return payload.state === 'CASE_OPENED'
        && INCIDENT_SEVERITIES.includes(payload.severity)
        && REASONING_DEPTHS.includes(payload.reasoningDepth)
        && HASH.test(payload.contextHash)
        && HASH.test(payload.evidenceBundleHash)
        && Number.isSafeInteger(payload.generation)
        && payload.generation >= 1
        && Number.isSafeInteger(payload.attemptBudgetRemaining)
        && payload.attemptBudgetRemaining >= 0
        && Number.isSafeInteger(payload.effectBudgetRemaining)
        && payload.effectBudgetRemaining === 0
        && Array.isArray(payload.transitions)
        && payload.transitions.length === 1
        && payload.transitions.every((transition) => hasExactKeys(transition, ['atMs', 'from', 'to'])
          && CASE_STATES.includes(transition.from)
          && CASE_STATES.includes(transition.to)
          && transition.from === 'DETECTED'
          && transition.to === payload.state
          && transition.atMs === contract.createdAtMs);
    case 'DurableWorkflowCheckpoint':
      return payload.state === 'CASE_OPENED'
        && HASH.test(payload.checkpointHash)
        && (() => {
          const { checkpointHash, ...checkpointDraft } = payload;
          return checkpointHash === sha256Hex(checkpointDraft);
        })()
        && HASH.test(payload.contextHash)
        && HASH.test(payload.evidenceBundleHash)
        && payload.baseSha === SHADOW_BASE_SHA
        && payload.deployedSha === SHADOW_BASE_SHA
        && payload.nextAction === 'DETERMINISTIC_REVALIDATION'
        && validIdentifier(payload.leaseId)
        && Number.isSafeInteger(payload.attemptBudgetRemaining)
        && payload.attemptBudgetRemaining >= 0
        && Number.isSafeInteger(payload.effectBudgetRemaining)
        && payload.effectBudgetRemaining === 0
        && Number.isSafeInteger(payload.fencingEpoch)
        && payload.fencingEpoch >= 1;
    case 'DiagnosticReport':
      return DIAGNOSIS_DISPOSITIONS.includes(payload.disposition)
        && contract.state === payload.disposition
        && ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'].includes(payload.uncertainty)
        && [true, false, 'UNKNOWN'].includes(payload.patchRecommended)
        && typeof payload.ownerAttentionRequired === 'boolean'
        && HASH.test(payload.evidenceBundleHash)
        && validStringArray(payload.falsificationTests, { allowEmpty: false })
        && Number.isSafeInteger(payload.expiresAtMs)
        && payload.expiresAtMs > contract.createdAtMs
        && payload.expiresAtMs <= FIXTURE_MAX_EXPIRY_MS;
    case 'AgentProviderDescriptor':
      return PROVIDER_STATES.includes(payload.providerState)
        && ['AVAILABLE', 'OUTAGE', 'QUOTA_EXHAUSTED', 'COST_EXHAUSTED', 'AUTH_EXPIRED', 'UNKNOWN'].includes(payload.healthState)
        && !(payload.providerState === 'NOT_CONFIGURED' && payload.healthState === 'AVAILABLE')
        && !(payload.providerState === 'DIAGNOSTIC_PLANE_UNAVAILABLE' && payload.healthState === 'AVAILABLE')
        && Number.isSafeInteger(payload.budgetMicrounits) && payload.budgetMicrounits >= 0
        && Number.isSafeInteger(payload.emergencyReserveMicrounits) && payload.emergencyReserveMicrounits >= 0
        && payload.emergencyReserveMicrounits <= payload.budgetMicrounits
        && payload.authType === 'SYNTHETIC_FIXTURE'
        && payload.backgroundCompatible === false
        && payload.evalQualificationRevision === 'fixture-eval-r1'
        && payload.modelId === 'synthetic-model'
        && payload.modelVersion === 'fixture-v1'
        && payload.providerId === 'fixture-provider'
        && payload.region === 'fixture-region'
        && payload.retentionPosture === 'NO_RETENTION_FIXTURE'
        && payload.schemaParityHash === FIXTURE_PROVIDER_SCHEMA_PARITY_HASH
        && payload.storeBehavior === 'DISABLED'
        && payload.toolParityHash === FIXTURE_PROVIDER_TOOL_PARITY_HASH
        && matchesExactStringArray(payload.capabilities, ['READ_ONLY_DIAGNOSIS']);
    case 'ToolCapabilityDescriptor':
      return payload.inputSchemaHash === FIXTURE_TOOL_INPUT_SCHEMA_HASH
        && payload.outputSchemaHash === FIXTURE_TOOL_OUTPUT_SCHEMA_HASH
        && !hardDeniedCapabilities.has(payload.capability)
        && payload.capability === 'READ_ONLY_DIAGNOSIS'
        && payload.toolId === 'fixture-tool'
        && payload.dataClassification === 'SYNTHETIC_ONLY'
        && matchesExactStringArray(payload.allowedPrincipals, ['fixture-principal'])
        && matchesExactStringArray(payload.allowedModes, ['SHADOW'])
        && matchesExactStringArray(payload.networkAllowlist, ['fixture://provider/diagnose'])
        && matchesExactStringArray(payload.pathAllowlist, [])
        && matchesExactStringArray(payload.auditFields, FIXTURE_TOOL_AUDIT_FIELDS)
        && matchesExactStringArray(payload.preconditions, FIXTURE_TOOL_PRECONDITIONS)
        && matchesExactStringArray(payload.postconditions, FIXTURE_TOOL_POSTCONDITIONS)
        && validFixtureResourceScope(payload.resourceScope)
        && payload.approvalRequired === true
        && payload.environment === 'SYNTHETIC_ONLY'
        && payload.redactionPolicy === 'REMOVE_SECRET_LIKE_TEXT'
        && payload.sandboxIdentity === 'fixture-sandbox'
        && payload.schemaVersion === 'fixture-tool-v1'
        && Number.isSafeInteger(payload.byteLimit) && payload.byteLimit >= 0
        && Number.isSafeInteger(payload.costLimitMicrounits) && payload.costLimitMicrounits >= 0
        && Number.isSafeInteger(payload.rateLimit) && payload.rateLimit >= 0
        && Number.isSafeInteger(payload.resultLimit) && payload.resultLimit >= 0
        && Number.isSafeInteger(payload.rowLimit) && payload.rowLimit >= 0
        && Number.isSafeInteger(payload.timeoutMs)
        && payload.timeoutMs > 0
        && Number.isSafeInteger(payload.ttlMs)
        && payload.ttlMs > 0
        && payload.timeoutMs <= payload.ttlMs;
    case 'ProviderCallback':
      return payload.signatureState === 'VALID'
        && payload.timestampState === 'FRESH'
        && payload.providerId === 'fixture-provider'
        && payload.modelId === 'synthetic-model'
        && HASH.test(payload.evidenceBundleHash)
        && HASH.test(payload.payloadHash)
        && typeof payload.signatureKeyRevision === 'string'
        && typeof payload.signatureMaterial === 'string'
        && (payload.signatureState !== 'VALID'
          || payload.signatureMaterial === sha256Hex(`fixture-signature:${payload.payloadHash}:${payload.signatureKeyRevision}`))
        && Number.isSafeInteger(payload.occurredAtMs)
        && Number.isSafeInteger(payload.receivedAtMs)
        && payload.receivedAtMs >= payload.occurredAtMs
        && Number.isSafeInteger(payload.workflowGeneration)
        && payload.workflowGeneration >= 1;
    case 'TypedToolOutput':
      return payload.schemaValid === true
        && payload.additionalPropertiesPresent === false
        && payload.injectionDetected === false
        && payload.toolId === 'fixture-tool'
        && payload.schemaHash === FIXTURE_TOOL_OUTPUT_SCHEMA_HASH
        && HASH.test(payload.contentHash)
        && hasExactKeys(payload.data, ['classification', 'finding'])
        && payload.data.classification === 'SYNTHETIC_ONLY'
        && payload.data.finding === 'NO_EFFECT'
        && payload.contentHash === sha256Hex(payload.data)
        && !payload.additionalPropertiesPresent && !payload.injectionDetected;
    case 'CredentialProxyRequest':
      return ['GET', 'POST'].includes(payload.method)
        && payload.toolId === 'fixture-tool'
        && payload.modelRoute === 'synthetic-model'
        && payload.endpoint === 'fixture://provider/diagnose'
        && payload.bodyClassification === 'SYNTHETIC_ONLY'
        && payload.requestSchemaHash === FIXTURE_TOOL_INPUT_SCHEMA_HASH
        && Number.isSafeInteger(payload.budgetMicrounits)
        && payload.budgetMicrounits >= 0
        && Number.isSafeInteger(payload.expiresAtMs)
        && payload.expiresAtMs > contract.createdAtMs
        && payload.expiresAtMs <= FIXTURE_MAX_EXPIRY_MS;
    case 'VerificationReceipt':
      return ['VERIFICATION_FAILED', 'INCONCLUSIVE'].includes(payload.disposition)
        && contract.state === payload.disposition
        && payload.candidateSha === SHADOW_BASE_SHA
        && payload.verificationId === 'verification-001'
        && payload.verifierId === 'fixture-independent-verifier'
        && payload.verifierRevision === 'fixture-verifier-r1'
        && HASH.test(payload.evidenceBundleHash)
        && matchesExactStringArray(payload.expectedPostconditions, FIXTURE_ACTION_POSTCONDITIONS)
        && matchesExactStringArray(payload.observedPostconditions, ['SHADOW_FIXTURE_ONLY'])
        && matchesExactStringArray(payload.sharedAncestry, ['A1_A3_RECEIPTS_UNAVAILABLE'])
        && matchesExactStringArray(payload.unchangedSafetyInvariants, ['LIVE_EXECUTION_NOT_IMPLEMENTED'])
        && matchesExactStringArray(payload.unresolvedAmbiguity, ['POST_PORT_INDEPENDENT_READBACK_REQUIRED'])
        && payload.recurrenceState === 'UNKNOWN'
        && payload.rollbackRequired === false
        && payload.disposition !== 'VERIFIED';
    case 'CanaryReceipt':
      return payload.candidateSha === SHADOW_BASE_SHA
        && payload.cohortState === 'NO_DATA'
        && payload.comparisonState === 'INCOMPARABLE'
        && payload.disposition === 'INCONCLUSIVE'
        && Number.isSafeInteger(payload.sampleCount) && payload.sampleCount >= 0
        && payload.sampleCount === 0
        && payload.finiteMetrics === false
        && payload.promotionAllowed === false
        && payload.rollbackRequired === false
        && validStringArray(payload.evidenceHashes);
    case 'RollbackReceipt':
      return payload.disposition === 'NOT_REQUIRED'
        && contract.state === 'NOT_REQUIRED'
        && Number.isSafeInteger(payload.startedAtMs)
        && Number.isSafeInteger(payload.completedAtMs)
        && payload.completedAtMs >= payload.startedAtMs
        && validStringArray(payload.evidenceHashes)
        && payload.fromSha === SHADOW_BASE_SHA
        && payload.toSha === SHADOW_BASE_SHA
        && payload.independentReadbackState === 'POST_PORT_REQUIRED'
        && payload.postconditionState === 'SHADOW_FIXTURE_ONLY';
    case 'ProviderUsageReceipt':
      return [
        payload.budgetRemainingMicrounits,
        payload.costMicrounits,
        payload.inputTokens,
        payload.outputTokens,
        payload.requestCount,
        payload.reserveUsedMicrounits,
      ].every((value) => Number.isSafeInteger(value) && value >= 0)
        && contract.state === 'ZERO_CALLS'
        && payload.costMicrounits === 0
        && payload.inputTokens === 0
        && payload.outputTokens === 0
        && payload.requestCount === 0
        && payload.reserveUsedMicrounits === 0
        && payload.providerId === 'fixture-provider'
        && payload.modelId === 'synthetic-model'
        && Number.isSafeInteger(payload.windowStartMs)
        && Number.isSafeInteger(payload.windowEndMs)
        && payload.windowEndMs >= payload.windowStartMs;
    case 'AgentAuditProjection':
      return HASH.test(payload.contentHash)
        && HASH.test(payload.previousHash)
        && payload.exportState === 'DELIVERED'
        && payload.wormReadbackState === 'MATCH'
        && payload.redactionState === 'NO_SECRET_FIELDS'
        && Number.isSafeInteger(payload.occurredAtMs);
    case 'ControlChangeSet':
      return Array.isArray(payload.changes)
        && payload.changes.length > 0
        && payload.changes.every((change) => hasExactKeys(change, ['controlId', 'from', 'to']))
        && ['VALID', 'INVALID'].includes(payload.validationState)
        && ['REJECTED', 'STALE'].includes(payload.casState)
        && contract.state === 'REJECTED'
        && Number.isSafeInteger(payload.appliedCount)
        && payload.appliedCount === 0
        && !(payload.validationState === 'INVALID' && payload.appliedCount > 0)
        && (payload.casState !== 'STALE' || payload.appliedCount === 0)
        && payload.rollbackState === 'NOT_REQUIRED'
        && payload.baseRegistryRevision === 'fixture-controls-r1'
        && payload.lastKnownGoodRevision === payload.baseRegistryRevision
        && payload.independentReadbackState === 'UNCHANGED';
    case 'AgentGuardrailTripEvent':
      return Object.hasOwn(HARD_DENIAL_CAPABILITIES, payload.capability)
        && payload.decision === 'HARD_DENIED'
        && payload.reasonCode === 'AGENT_GUARDRAIL_TRIPPED'
        && Number.isSafeInteger(payload.effectCount) && payload.effectCount === 0
        && Number.isSafeInteger(payload.networkAttemptCount) && payload.networkAttemptCount === 0
        && HASH.test(payload.auditHash)
        && Number.isSafeInteger(payload.occurredAtMs);
    case 'BreakGlassRecoveryReceipt':
      return validStringArray(payload.allowedControlIds, { allowEmpty: false })
        && payload.allowedControlIds.every((controlId) => BREAK_GLASS_ALLOWED_CONTROL_IDS.has(controlId))
        && validStringArray(payload.forbiddenCapabilities, { allowEmpty: false })
        && payload.forbiddenCapabilities.length === hardDeniedCapabilities.size
        && [...hardDeniedCapabilities].every((capability) => payload.forbiddenCapabilities.includes(capability))
        && HASH.test(payload.argumentHash)
        && payload.used === false
        && contract.state === 'UNUSED'
        && payload.authenticationStrength === 'SYNTHETIC_FIXTURE_ONLY'
        && payload.readbackState === 'NOT_USED'
        && Number.isSafeInteger(payload.createdAtMs)
        && Number.isSafeInteger(payload.expiresAtMs)
        && payload.expiresAtMs <= FIXTURE_MAX_EXPIRY_MS
        && payload.expiresAtMs > payload.createdAtMs;
    default:
      return false;
  }
}

export function validateShadowContract(contract, expectedType = null) {
  const issues = [];
  if (!hasExactKeys(contract, CONTRACT_KEYS)) return ['CONTRACT_KEYS_MISMATCH'];
  if (contract.schemaVersion !== 'AIOPS_A5_SHADOW_CONTRACT_V1') issues.push('SCHEMA_VERSION_MISMATCH');
  if (contract.shadowStatus !== 'SHADOW_SPECULATIVE') issues.push('SHADOW_STATUS_MISMATCH');
  if (expectedType !== null && contract.objectType !== expectedType) issues.push('OBJECT_TYPE_MISMATCH');
  if (!Object.hasOwn(PAYLOAD_KEYS, contract.objectType)) issues.push('OBJECT_TYPE_UNKNOWN');
  if (!hasExactKeys(contract.payload, PAYLOAD_KEYS[contract.objectType] ?? [])) issues.push('PAYLOAD_KEYS_MISMATCH');
  const expectedMetadata = FIXTURE_METADATA_BY_TYPE[contract.objectType];
  if (!expectedMetadata
    || contract.stableId !== expectedMetadata[0]
    || contract.owner !== expectedMetadata[1]
    || contract.state !== expectedMetadata[2]
    || contract.createdAtMs !== FIXTURE_CREATED_AT_MS
    || contract.environment !== 'SYNTHETIC_ONLY'
    || contract.sourceRevision !== SHADOW_BASE_SHA
    || contract.provenance !== 'A5_DIRECTIVE_LOCAL_FIXTURE'
    || !matchesExactStringArray(contract.unknownFields, [expectedMetadata[3]])
    || !matchesExactStringArray(contract.missingFields, [])) {
    issues.push('FIXTURE_METADATA_MISMATCH');
  }
  try {
    assertIdentifier(contract.stableId, 'stableId');
    assertIdentifier(contract.environment, 'environment');
    assertIdentifier(contract.sourceRevision, 'sourceRevision');
    assertIdentifier(contract.provenance, 'provenance');
    assertIdentifier(contract.state, 'state');
    assertIdentifier(contract.owner, 'owner');
    assertUtcMillis(contract.createdAtMs, 'createdAtMs');
    if (contract.environment !== 'SYNTHETIC_ONLY') throw new TypeError('environment must be synthetic');
  } catch {
    issues.push('COMMON_FIELD_INVALID');
  }
  if (!HASH.test(contract.contentHash ?? '')) issues.push('CONTENT_HASH_INVALID');
  const { contentHash, ...draft } = contract;
  try {
    if (contentHash !== sha256Hex(draft)) issues.push('CONTENT_HASH_MISMATCH');
  } catch {
    issues.push('CONTENT_NOT_CANONICAL');
  }
  if (!validStringArray(contract.unknownFields)) issues.push('UNKNOWN_FIELDS_INVALID');
  if (!validStringArray(contract.missingFields)) issues.push('MISSING_FIELDS_INVALID');
  try {
    if (!payloadSemantics(contract)) issues.push('PAYLOAD_SEMANTICS_INVALID');
  } catch {
    issues.push('PAYLOAD_SEMANTICS_INVALID');
  }
  return stableUnique(issues);
}

export const INTERFACE_BUNDLE_KEYS = deepFreeze([
  'a1ActionEnvelope',
  'a1ApprovalRequest',
  'a1ApprovalReceipt',
  'a1BudgetPolicy',
  'a1PermissionProfile',
  'a1PolicyDecision',
  'a2AgentCase',
  'a2DiagnosticReport',
  'a2EvidenceBundle',
  'a2WorkflowCheckpoint',
  'a3Callback',
  'a3CredentialProxyRequest',
  'a3ProviderDescriptor',
  'a3ToolDescriptor',
  'a3ToolOutput',
  'assuranceAuditProjection',
  'assuranceBreakGlassReceipt',
  'assuranceCanaryReceipt',
  'assuranceControlChangeSet',
  'assuranceGuardrailTrip',
  'assuranceProviderUsageReceipt',
  'assuranceRollbackReceipt',
  'assuranceVerificationReceipt',
]);

const BUNDLE_TYPE_BY_KEY = deepFreeze({
  a1ActionEnvelope: 'ActionEnvelope',
  a1ApprovalRequest: 'ApprovalRequest',
  a1ApprovalReceipt: 'ApprovalReceipt',
  a1BudgetPolicy: 'AgentBudgetPolicy',
  a1PermissionProfile: 'AgentPermissionProfile',
  a1PolicyDecision: 'PolicyDecision',
  a2AgentCase: 'AgentCase',
  a2DiagnosticReport: 'DiagnosticReport',
  a2EvidenceBundle: 'IncidentEvidenceBundle',
  a2WorkflowCheckpoint: 'DurableWorkflowCheckpoint',
  a3Callback: 'ProviderCallback',
  a3CredentialProxyRequest: 'CredentialProxyRequest',
  a3ProviderDescriptor: 'AgentProviderDescriptor',
  a3ToolDescriptor: 'ToolCapabilityDescriptor',
  a3ToolOutput: 'TypedToolOutput',
  assuranceAuditProjection: 'AgentAuditProjection',
  assuranceBreakGlassReceipt: 'BreakGlassRecoveryReceipt',
  assuranceCanaryReceipt: 'CanaryReceipt',
  assuranceControlChangeSet: 'ControlChangeSet',
  assuranceGuardrailTrip: 'AgentGuardrailTripEvent',
  assuranceProviderUsageReceipt: 'ProviderUsageReceipt',
  assuranceRollbackReceipt: 'RollbackReceipt',
  assuranceVerificationReceipt: 'VerificationReceipt',
});

export function validateInterfaceBundle(bundle) {
  if (!hasExactKeys(bundle, INTERFACE_BUNDLE_KEYS)) return ['INTERFACE_BUNDLE_KEYS_MISMATCH'];
  const issues = Object.entries(BUNDLE_TYPE_BY_KEY).flatMap(([key, type]) => (
    validateShadowContract(bundle[key], type).map((issue) => `${key}:${issue}`)
  ));
  if (issues.length > 0) return stableUnique(issues);

  const evidenceHash = bundle.a2EvidenceBundle.contentHash;
  const caseIds = [
    bundle.a1ActionEnvelope.payload.caseId,
    bundle.a1ApprovalRequest.payload.caseId,
    bundle.a1ApprovalReceipt.payload.caseId,
    bundle.a1PolicyDecision.payload.caseId,
    bundle.a2AgentCase.payload.caseId,
    bundle.a2DiagnosticReport.payload.caseId,
    bundle.a2WorkflowCheckpoint.payload.caseId,
    bundle.a3Callback.payload.caseId,
    bundle.a3CredentialProxyRequest.payload.caseId,
    bundle.assuranceAuditProjection.payload.caseId,
    bundle.assuranceBreakGlassReceipt.payload.caseId,
    bundle.assuranceCanaryReceipt.payload.caseId,
    bundle.assuranceControlChangeSet.payload.caseId,
    bundle.assuranceGuardrailTrip.payload.caseId,
    bundle.assuranceProviderUsageReceipt.payload.caseId,
    bundle.assuranceRollbackReceipt.payload.caseId,
    bundle.assuranceVerificationReceipt.payload.caseId,
  ];
  if (new Set(caseIds).size !== 1) issues.push('CROSS_CONTRACT_CASE_ID_MISMATCH');

  const incidentIds = [
    bundle.a1ActionEnvelope.payload.incidentId,
    bundle.a1ApprovalRequest.payload.incidentId,
    bundle.a1ApprovalReceipt.payload.incidentId,
    bundle.a1PolicyDecision.payload.incidentId,
    bundle.a2EvidenceBundle.payload.incidentId,
  ];
  if (new Set(incidentIds).size !== 1) issues.push('CROSS_CONTRACT_INCIDENT_ID_MISMATCH');

  const evidenceHashes = [
    bundle.a1ApprovalReceipt.payload.evidenceBundleHash,
    bundle.a1ApprovalRequest.payload.evidenceBundleHash,
    bundle.a1PolicyDecision.payload.evidenceBundleHash,
    bundle.a2AgentCase.payload.evidenceBundleHash,
    bundle.a2DiagnosticReport.payload.evidenceBundleHash,
    bundle.a2WorkflowCheckpoint.payload.evidenceBundleHash,
    bundle.a3Callback.payload.evidenceBundleHash,
    bundle.assuranceVerificationReceipt.payload.evidenceBundleHash,
  ];
  if (evidenceHashes.some((value) => value !== evidenceHash)) {
    issues.push('CROSS_CONTRACT_EVIDENCE_HASH_MISMATCH');
  }

  const policyRevisions = [
    bundle.a1ActionEnvelope.payload.policyRevision,
    bundle.a1ApprovalRequest.payload.policyRevision,
    bundle.a1ApprovalReceipt.payload.policyRevision,
    bundle.a1PolicyDecision.payload.policyRevision,
    bundle.a2DiagnosticReport.payload.policyRevision,
    bundle.a2WorkflowCheckpoint.payload.policyRevision,
    bundle.a3CredentialProxyRequest.payload.policyRevision,
    bundle.a1PermissionProfile.payload.policyRevision,
    bundle.assuranceAuditProjection.payload.policyRevision,
    bundle.assuranceGuardrailTrip.payload.policyRevision,
  ];
  if (new Set(policyRevisions).size !== 1) issues.push('CROSS_CONTRACT_POLICY_REVISION_MISMATCH');
  if (bundle.a2AgentCase.payload.contextHash !== bundle.a2WorkflowCheckpoint.payload.contextHash) {
    issues.push('CROSS_CONTRACT_CONTEXT_HASH_MISMATCH');
  }
  if (bundle.a2AgentCase.payload.workflowVersion !== bundle.a2WorkflowCheckpoint.payload.workflowVersion) {
    issues.push('CROSS_CONTRACT_WORKFLOW_VERSION_MISMATCH');
  }
  if (bundle.a2AgentCase.payload.generation !== bundle.a2WorkflowCheckpoint.payload.generation
    || bundle.a2AgentCase.payload.generation !== bundle.a3Callback.payload.workflowGeneration) {
    issues.push('CROSS_CONTRACT_WORKFLOW_GENERATION_MISMATCH');
  }
  if (bundle.a1ActionEnvelope.payload.fencingEpoch !== bundle.a2WorkflowCheckpoint.payload.fencingEpoch) {
    issues.push('CROSS_CONTRACT_FENCING_EPOCH_MISMATCH');
  }
  if (bundle.a1ActionEnvelope.payload.leaseId !== bundle.a2WorkflowCheckpoint.payload.leaseId) {
    issues.push('CROSS_CONTRACT_LEASE_ID_MISMATCH');
  }
  if (bundle.a2WorkflowCheckpoint.payload.baseSha !== bundle.a1ApprovalRequest.payload.baseSha
    || bundle.a2WorkflowCheckpoint.payload.deployedSha !== bundle.a1ApprovalRequest.payload.deployedSha
    || bundle.a2WorkflowCheckpoint.payload.deployedSha !== bundle.a2EvidenceBundle.payload.deployedSha) {
    issues.push('CROSS_CONTRACT_SHA_BINDING_MISMATCH');
  }
  const shadowShaBindings = [
    bundle.a1ApprovalRequest.payload.baseSha,
    bundle.a1ApprovalReceipt.payload.baseSha,
    bundle.a2WorkflowCheckpoint.payload.baseSha,
    bundle.a1ApprovalRequest.payload.deployedSha,
    bundle.a1ApprovalReceipt.payload.deployedSha,
    bundle.a2WorkflowCheckpoint.payload.deployedSha,
    bundle.a2EvidenceBundle.payload.deployedSha,
    bundle.a1ApprovalRequest.payload.candidateSha,
    bundle.a1ApprovalReceipt.payload.candidateSha,
  ];
  if (shadowShaBindings.some((sha) => sha !== SHADOW_BASE_SHA)) {
    issues.push('CROSS_CONTRACT_PAYLOAD_BASE_SHA_MISMATCH');
  }
  if (bundle.a1ApprovalReceipt.payload.exactToolId !== bundle.a3ToolDescriptor.payload.toolId
    || bundle.a1ApprovalRequest.payload.exactToolId !== bundle.a3ToolDescriptor.payload.toolId
    || bundle.a3ToolOutput.payload.toolId !== bundle.a3ToolDescriptor.payload.toolId
    || bundle.a3CredentialProxyRequest.payload.toolId !== bundle.a3ToolDescriptor.payload.toolId) {
    issues.push('CROSS_CONTRACT_TOOL_ID_MISMATCH');
  }
  const capabilities = [
    bundle.a1ActionEnvelope.payload.registeredActionType,
    bundle.a1ApprovalRequest.payload.capability,
    bundle.a1ApprovalReceipt.payload.capability,
    bundle.a1PolicyDecision.payload.capability,
    bundle.a3ToolDescriptor.payload.capability,
  ];
  if (new Set(capabilities).size !== 1) issues.push('CROSS_CONTRACT_CAPABILITY_MISMATCH');
  const boundCapability = bundle.a3ToolDescriptor.payload.capability;
  if (!bundle.a1PermissionProfile.payload.allowedCapabilities.includes(boundCapability)
    || bundle.a1PermissionProfile.payload.deniedCapabilities.includes(boundCapability)
    || !bundle.a3ProviderDescriptor.payload.capabilities.includes(boundCapability)) {
    issues.push('CROSS_CONTRACT_PERMISSION_CAPABILITY_MISMATCH');
  }
  const boundToolId = bundle.a3ToolDescriptor.payload.toolId;
  if (!bundle.a1PermissionProfile.payload.allowedToolIds.includes(boundToolId)) {
    issues.push('CROSS_CONTRACT_PERMISSION_TOOL_MISMATCH');
  }
  const principalIds = [
    bundle.a1PermissionProfile.payload.principalId,
    bundle.a1BudgetPolicy.payload.principalId,
    bundle.a1PolicyDecision.payload.principalId,
  ];
  if (new Set(principalIds).size !== 1
    || !bundle.a3ToolDescriptor.payload.allowedPrincipals.includes(principalIds[0])) {
    issues.push('CROSS_CONTRACT_PRINCIPAL_MISMATCH');
  }
  if (bundle.a1ActionEnvelope.payload.independentVerifierId !== bundle.assuranceVerificationReceipt.payload.verifierId
    || bundle.a1ActionEnvelope.payload.independentVerifierId === principalIds[0]
    || bundle.assuranceVerificationReceipt.payload.verifierId === bundle.a1ApprovalReceipt.payload.approverId) {
    issues.push('CROSS_CONTRACT_INDEPENDENT_VERIFIER_MISMATCH');
  }
  if (!bundle.a1PermissionProfile.payload.allowedModes.includes(bundle.a1PolicyDecision.payload.mode)
    || !bundle.a3ToolDescriptor.payload.allowedModes.includes(bundle.a1PolicyDecision.payload.mode)) {
    issues.push('CROSS_CONTRACT_MODE_MISMATCH');
  }
  if (bundle.a1PolicyDecision.payload.providerId !== bundle.a3ProviderDescriptor.payload.providerId
    || bundle.a1PolicyDecision.payload.modelId !== bundle.a3ProviderDescriptor.payload.modelId
    || bundle.a3Callback.payload.providerId !== bundle.a3ProviderDescriptor.payload.providerId
    || bundle.a3Callback.payload.modelId !== bundle.a3ProviderDescriptor.payload.modelId
    || bundle.a3Callback.payload.internalRunId !== bundle.a1PolicyDecision.payload.runId) {
    issues.push('CROSS_CONTRACT_PROVIDER_IDENTITY_MISMATCH');
  }
  if (bundle.a1ActionEnvelope.payload.maximumEffect !== 'ZERO_PRODUCT_EFFECT'
    || bundle.a1ApprovalRequest.payload.maximumEffect !== 'ZERO_PRODUCT_EFFECT'
    || bundle.a1ApprovalReceipt.payload.maximumEffect !== 'ZERO_PRODUCT_EFFECT') {
    issues.push('CROSS_CONTRACT_MAXIMUM_EFFECT_MISMATCH');
  }
  if (bundle.a1ActionEnvelope.payload.approvalReceiptIds.length !== 1
    || bundle.a1ActionEnvelope.payload.approvalReceiptIds[0] !== bundle.a1ApprovalReceipt.payload.approvalId) {
    issues.push('CROSS_CONTRACT_APPROVAL_RECEIPT_ID_MISMATCH');
  }
  if (bundle.a1ApprovalReceipt.payload.used
    || bundle.a1ApprovalReceipt.payload.remainingActionCount < 1
    || !bundle.a1PolicyDecision.payload.requiredApprovers.includes(bundle.a1ApprovalReceipt.payload.approverId)
    || bundle.a1ApprovalReceipt.payload.authenticationStrength !== 'SYNTHETIC_FIXTURE_ONLY') {
    issues.push('CROSS_CONTRACT_APPROVAL_AUTHORITY_MISMATCH');
  }
  const approvalBindingFields = [
    'argumentHash',
    'artifactHash',
    'baseSha',
    'candidateSha',
    'capability',
    'controlRegistryRevision',
    'deployedSha',
    'environment',
    'evidenceBundleHash',
    'exactToolId',
    'expiresAtMs',
    'incidentId',
    'livePreconditions',
    'maximumEffect',
    'nonce',
    'policyRevision',
    'resourceScope',
  ];
  if (approvalBindingFields.some((field) => canonicalStringify(bundle.a1ApprovalRequest.payload[field])
    !== canonicalStringify(bundle.a1ApprovalReceipt.payload[field]))) {
    issues.push('CROSS_CONTRACT_APPROVAL_BINDING_MISMATCH');
  }
  if (bundle.a1ApprovalRequest.payload.artifactHash !== bundle.a1PolicyDecision.payload.artifactHash) {
    issues.push('CROSS_CONTRACT_ARTIFACT_HASH_MISMATCH');
  }
  if (bundle.a1ActionEnvelope.payload.proposalHash !== bundle.a1ApprovalRequest.payload.argumentHash) {
    issues.push('CROSS_CONTRACT_PROPOSAL_HASH_MISMATCH');
  }
  if (canonicalStringify(bundle.a1ActionEnvelope.payload.preconditions)
    !== canonicalStringify(bundle.a1ApprovalReceipt.payload.livePreconditions)
    || canonicalStringify(bundle.a1ActionEnvelope.payload.targetResourceIds)
      !== canonicalStringify(bundle.a1ApprovalReceipt.payload.resourceScope)
    || bundle.a1ActionEnvelope.payload.deadlineMs > bundle.a1ApprovalReceipt.payload.expiresAtMs) {
    issues.push('CROSS_CONTRACT_ACTION_APPROVAL_SCOPE_MISMATCH');
  }
  const earliestExpiry = Math.min(
    bundle.a1PolicyDecision.payload.expiresAtMs,
    bundle.a1PermissionProfile.payload.expiresAtMs,
    bundle.a1ApprovalRequest.payload.expiresAtMs,
    bundle.a1ApprovalReceipt.payload.expiresAtMs,
  );
  if (bundle.a1ActionEnvelope.payload.deadlineMs > earliestExpiry) {
    issues.push('CROSS_CONTRACT_ACTION_EXPIRY_MISMATCH');
  }
  const toolAuthorityExpiresAt = bundle.a3ToolDescriptor.createdAtMs
    + bundle.a3ToolDescriptor.payload.ttlMs;
  if (bundle.a1ActionEnvelope.payload.deadlineMs > toolAuthorityExpiresAt
    || bundle.a3CredentialProxyRequest.payload.expiresAtMs > earliestExpiry
    || bundle.a3CredentialProxyRequest.payload.expiresAtMs > toolAuthorityExpiresAt
    || bundle.a3CredentialProxyRequest.payload.expiresAtMs > bundle.a1ActionEnvelope.payload.deadlineMs) {
    issues.push('CROSS_CONTRACT_TOOL_AUTHORITY_EXPIRY_MISMATCH');
  }
  const budget = bundle.a1BudgetPolicy.payload;
  const policy = bundle.a1PolicyDecision.payload;
  const action = bundle.a1ActionEnvelope.payload;
  if (policy.attemptBudget > budget.attemptLimit - budget.globalAttemptUsage
    || policy.concurrencyBudget > budget.concurrencyLimit
    || policy.costBudgetMicrounits > budget.costBudgetMicrounits - budget.globalCostUsageMicrounits
    || action.attemptBudget > policy.attemptBudget
    || action.concurrencyBudget > policy.concurrencyBudget
    || bundle.a3ProviderDescriptor.payload.budgetMicrounits > policy.costBudgetMicrounits
    || bundle.a3ProviderDescriptor.payload.emergencyReserveMicrounits > budget.emergencyReserveMicrounits
    || bundle.a3ProviderDescriptor.payload.emergencyReserveMicrounits > bundle.a3ProviderDescriptor.payload.budgetMicrounits
    || bundle.a3ToolDescriptor.payload.costLimitMicrounits
      + bundle.a3CredentialProxyRequest.payload.budgetMicrounits > policy.costBudgetMicrounits
    || bundle.a3ToolDescriptor.payload.costLimitMicrounits
      + bundle.a3CredentialProxyRequest.payload.budgetMicrounits
      > budget.costBudgetMicrounits - budget.globalCostUsageMicrounits) {
    issues.push('CROSS_CONTRACT_BUDGET_EXCEEDED');
  }
  const usage = bundle.assuranceProviderUsageReceipt.payload;
  if (usage.providerId !== bundle.a3ProviderDescriptor.payload.providerId
    || usage.modelId !== bundle.a3ProviderDescriptor.payload.modelId
    || usage.budgetRemainingMicrounits !== bundle.a3ProviderDescriptor.payload.budgetMicrounits
    || usage.costMicrounits > policy.costBudgetMicrounits
    || usage.reserveUsedMicrounits > budget.emergencyReserveMicrounits
    || usage.inputTokens + usage.outputTokens > budget.tokenLimit) {
    issues.push('CROSS_CONTRACT_PROVIDER_USAGE_MISMATCH');
  }
  if (bundle.a2AgentCase.payload.attemptBudgetRemaining !== bundle.a2WorkflowCheckpoint.payload.attemptBudgetRemaining
    || bundle.a2AgentCase.payload.effectBudgetRemaining !== bundle.a2WorkflowCheckpoint.payload.effectBudgetRemaining
    || bundle.a2AgentCase.payload.attemptBudgetRemaining > policy.attemptBudget
    || bundle.a2AgentCase.payload.attemptBudgetRemaining > budget.attemptLimit - budget.globalAttemptUsage
    || bundle.a2AgentCase.payload.effectBudgetRemaining !== 0
    || bundle.a2AgentCase.payload.state !== bundle.a2WorkflowCheckpoint.payload.state) {
    issues.push('CROSS_CONTRACT_DURABLE_BUDGET_MISMATCH');
  }
  if (bundle.a3ToolOutput.payload.schemaHash !== bundle.a3ToolDescriptor.payload.outputSchemaHash) {
    issues.push('CROSS_CONTRACT_TOOL_SCHEMA_MISMATCH');
  }
  if (!bundle.a3ToolDescriptor.payload.networkAllowlist.includes(bundle.a3CredentialProxyRequest.payload.endpoint)
    || bundle.a3CredentialProxyRequest.payload.budgetMicrounits > bundle.a3ToolDescriptor.payload.costLimitMicrounits
    || bundle.a3CredentialProxyRequest.payload.requestSchemaHash !== bundle.a3ToolDescriptor.payload.inputSchemaHash
    || bundle.a3CredentialProxyRequest.payload.modelRoute !== bundle.a3ProviderDescriptor.payload.modelId) {
    issues.push('CROSS_CONTRACT_CREDENTIAL_TOOL_SCOPE_MISMATCH');
  }
  if (canonicalStringify(bundle.a3ToolDescriptor.payload.resourceScope)
      !== canonicalStringify(bundle.a1PermissionProfile.payload.resourceScope)
    || canonicalStringify(bundle.a3ToolDescriptor.payload.resourceScope)
      !== canonicalStringify(bundle.a1ActionEnvelope.payload.targetResourceIds)
    || canonicalStringify(bundle.a3ToolDescriptor.payload.resourceScope)
      !== canonicalStringify(bundle.a1PolicyDecision.payload.resourceScope)
    || canonicalStringify(bundle.a3ToolDescriptor.payload.resourceScope)
      !== canonicalStringify(bundle.a1ApprovalRequest.payload.resourceScope)
    || canonicalStringify(bundle.a3ToolDescriptor.payload.resourceScope)
      !== canonicalStringify(bundle.a1ApprovalReceipt.payload.resourceScope)) {
    issues.push('CROSS_CONTRACT_RESOURCE_SCOPE_MISMATCH');
  }
  if (bundle.a1ActionEnvelope.payload.blastRadius !== bundle.a1PolicyDecision.payload.blastRadius
    || bundle.a1ActionEnvelope.payload.blastRadius !== 'SYNTHETIC_RESOURCE_ONLY') {
    issues.push('CROSS_CONTRACT_BLAST_RADIUS_MISMATCH');
  }
  if (bundle.a2AgentCase.payload.fingerprint !== bundle.a2EvidenceBundle.payload.fingerprint) {
    issues.push('CROSS_CONTRACT_FINGERPRINT_MISMATCH');
  }
  const candidateShas = [
    bundle.a1ApprovalRequest.payload.candidateSha,
    bundle.a1ApprovalReceipt.payload.candidateSha,
    bundle.assuranceCanaryReceipt.payload.candidateSha,
    bundle.assuranceVerificationReceipt.payload.candidateSha,
  ];
  if (new Set(candidateShas).size !== 1) issues.push('CROSS_CONTRACT_CANDIDATE_SHA_MISMATCH');
  if (bundle.assuranceRollbackReceipt.payload.fromSha !== SHADOW_BASE_SHA
    || bundle.assuranceRollbackReceipt.payload.toSha !== SHADOW_BASE_SHA
    || bundle.assuranceRollbackReceipt.payload.disposition !== 'NOT_REQUIRED') {
    issues.push('CROSS_CONTRACT_ROLLBACK_TARGET_MISMATCH');
  }
  if (bundle.assuranceGuardrailTrip.payload.auditHash !== bundle.assuranceAuditProjection.contentHash) {
    issues.push('CROSS_CONTRACT_GUARDRAIL_AUDIT_MISMATCH');
  }
  if (bundle.a3CredentialProxyRequest.payload.controlRevision !== bundle.assuranceControlChangeSet.payload.baseRegistryRevision
    || bundle.a1ApprovalRequest.payload.controlRegistryRevision !== bundle.assuranceControlChangeSet.payload.baseRegistryRevision) {
    issues.push('CROSS_CONTRACT_CONTROL_REVISION_MISMATCH');
  }
  const sourceRevisions = Object.values(bundle).map((entry) => entry.sourceRevision);
  if (new Set(sourceRevisions).size !== 1) issues.push('CROSS_CONTRACT_SOURCE_REVISION_MISMATCH');
  if (sourceRevisions.some((revision) => revision !== SHADOW_BASE_SHA)) issues.push('CROSS_CONTRACT_BASE_SHA_MISMATCH');
  return stableUnique(issues);
}

export function contractDigest(contract) {
  const issues = validateShadowContract(contract);
  if (issues.length > 0) throw new TypeError(`invalid shadow contract: ${canonicalStringify(issues)}`);
  return sha256Hex(contract);
}
