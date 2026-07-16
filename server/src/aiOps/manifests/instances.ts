import {
  AI_OPS_ACTION_CLASS_DEFINITIONS,
  AI_OPS_HARD_DENIALS,
  AI_OPS_LIVE_EXECUTION_STATE,
  type AiOpsActionClass,
} from '../policy/authority.js';
import { AI_OPS_IDENTITIES } from '../identity/identity.js';
import {
  generateClassificationManifest,
  type AiOpsClassificationManifest,
  type AiOpsClassificationResource,
} from './classification.js';
import {
  AI_OPS_CAPABILITY_RELIABILITY_TARGETS,
  AI_OPS_RUNBOOK_TEMPLATES,
  type AiOpsCapabilityReliabilityTarget,
  type AiOpsNumericalGraduationTarget,
  type AiOpsRunbookTemplate,
} from '../reliability/runbooks.js';
import {
  AI_OPS_PORT_BASE_SHA,
  AI_OPS_SHADOW_A1_IMPLEMENTATION_SHA,
  AI_OPS_SHADOW_A1_SEALED_SHA,
  canonicalPolicyJson,
  canonicalPolicySnapshot,
  exactKeys,
  immutableClone,
  isSha256,
  sha256Canonical,
  sortedUnique,
} from '../contracts/shared.js';

export const AI_OPS_PRESTAGE_DRAFT_COMMIT_SHA = '08e0beaa54c4c3ca9c24276785d6a302f751a226' as const;
/** Sealed A1X compatibility names retained for downstream accepted consumers. */
export const AI_OPS_A1X_SEALED_BASE_SHA = AI_OPS_SHADOW_A1_SEALED_SHA;
export const AI_OPS_A1_IMPLEMENTATION_SHA = AI_OPS_SHADOW_A1_IMPLEMENTATION_SHA;

export interface AiOpsDraftReference {
  readonly branch: 'aiops-prestage-20260714';
  readonly commitSha: typeof AI_OPS_PRESTAGE_DRAFT_COMMIT_SHA;
  readonly path: 'AI_OPS_IDENTITY_MATRIX_DRAFT.md' | 'AI_OPS_RELIABILITY_TARGETS_DRAFT.md';
  readonly gitBlobSha1: string;
  readonly sha256: string;
  readonly status: 'DRAFT-REQUIRES-OWNER-SIGNATURE';
  readonly readOnly: true;
}

export const AI_OPS_PRESTAGE_DRAFT_REFERENCES: Readonly<{
  readonly identity: Readonly<AiOpsDraftReference>;
  readonly reliabilityTargets: Readonly<AiOpsDraftReference>;
}> = immutableClone({
  identity: {
    branch: 'aiops-prestage-20260714',
    commitSha: AI_OPS_PRESTAGE_DRAFT_COMMIT_SHA,
    path: 'AI_OPS_IDENTITY_MATRIX_DRAFT.md',
    gitBlobSha1: '82c6ca2b6a166a512a61e978f5d9afb86dd7c1d6',
    sha256: 'f177b6f2fcbb4668303996bfc50cf0517e1888fa62908675fdca2a4937b02cb7',
    status: 'DRAFT-REQUIRES-OWNER-SIGNATURE',
    readOnly: true,
  },
  reliabilityTargets: {
    branch: 'aiops-prestage-20260714',
    commitSha: AI_OPS_PRESTAGE_DRAFT_COMMIT_SHA,
    path: 'AI_OPS_RELIABILITY_TARGETS_DRAFT.md',
    gitBlobSha1: '4097bb6a5234f4c5dc456dac4c9928e7ef3266c5',
    sha256: '12196c54cc5cb81888b59fd0e388df129a79bc69a30c1d8e88421158ea537269',
    status: 'DRAFT-REQUIRES-OWNER-SIGNATURE',
    readOnly: true,
  },
});

export interface AiOpsOwnerSignaturePlaceholder {
  readonly schema: 'AI_OPS_OWNER_SIGNATURE_PLACEHOLDER_V1';
  readonly signerRole: 'AI_OPS_OWNER';
  readonly signerIdentityId: null;
  readonly algorithm: null;
  readonly keyReference: null;
  readonly signatureBytesBase64Url: null;
  readonly signedPayloadDigest: string;
  readonly signedAtMs: null;
  readonly expiresAtMs: null;
  readonly signatureState: 'OWNER_SIGNATURE_REQUIRED';
  readonly authorityCreated: false;
}

export function createAiOpsOwnerSignaturePlaceholder(
  signedPayloadDigest: string,
): Readonly<AiOpsOwnerSignaturePlaceholder> {
  if (!isSha256(signedPayloadDigest)) throw new TypeError('invalid owner-signature payload digest');
  return immutableClone({
    schema: 'AI_OPS_OWNER_SIGNATURE_PLACEHOLDER_V1' as const,
    signerRole: 'AI_OPS_OWNER' as const,
    signerIdentityId: null,
    algorithm: null,
    keyReference: null,
    signatureBytesBase64Url: null,
    signedPayloadDigest,
    signedAtMs: null,
    expiresAtMs: null,
    signatureState: 'OWNER_SIGNATURE_REQUIRED' as const,
    authorityCreated: false as const,
  });
}

export interface AiOpsCapabilityGraduationTargetInstance {
  readonly schema: 'AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCE_V1';
  readonly targetInstanceId: string;
  readonly targetKind: AiOpsCapabilityReliabilityTarget['targetKind'];
  readonly capabilityId: string;
  readonly targetRevision: 1;
  readonly shadowA1SealedSha: typeof AI_OPS_SHADOW_A1_SEALED_SHA;
  readonly portBaseSha: typeof AI_OPS_PORT_BASE_SHA;
  readonly reliabilityDraft: Readonly<AiOpsDraftReference>;
  readonly identityDraft: Readonly<AiOpsDraftReference>;
  readonly measurementProfile: string;
  readonly target: Readonly<AiOpsNumericalGraduationTarget>;
  readonly evidenceState: 'UNMEASURED';
  readonly decisionStatus: 'DRAFT-REQUIRES-OWNER-SIGNATURE';
  readonly activationState: 'UNSIGNED_INACTIVE';
  readonly providerState: 'NOT_CONFIGURED';
  readonly operatingMode: 'SHADOW';
  readonly authorityCreated: false;
  readonly unsignedPayloadDigest: string;
  readonly ownerSignature: Readonly<AiOpsOwnerSignaturePlaceholder>;
}

const MEASUREMENT_PROFILE_BY_TARGET_KIND: Readonly<Record<AiOpsCapabilityReliabilityTarget['targetKind'], string>> = Object.freeze({
  RUNBOOK: 'LEDGER_GRADUATION_EVIDENCE_READBACK_V1',
  PROMPT_REVISION: 'PROMPT_CASE_OUTCOME_AND_REPLAY_V1',
  PROVIDER_ROUTE: 'PROVIDER_ROUTE_CASE_OUTCOME_COST_AND_LATENCY_V1',
  MODEL_REVISION: 'MODEL_GOLDEN_ADVERSARIAL_AND_PRIOR_INCIDENT_REPLAY_V1',
  PATCH_CATEGORY: 'PATCH_TEST_CANARY_ROLLBACK_OUTCOME_V1',
});

function graduationTargetInstanceId(capabilityId: string): string {
  return `AI_OPS_GRADUATION_TARGET_${capabilityId}_V1`;
}

function makeCapabilityGraduationTargetInstance(
  row: Readonly<AiOpsCapabilityReliabilityTarget>,
): Readonly<AiOpsCapabilityGraduationTargetInstance> {
  const unsignedPayload = {
    schema: 'AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCE_V1' as const,
    targetInstanceId: graduationTargetInstanceId(row.target.capabilityId),
    targetKind: row.targetKind,
    capabilityId: row.target.capabilityId,
    targetRevision: 1 as const,
    shadowA1SealedSha: AI_OPS_SHADOW_A1_SEALED_SHA,
    portBaseSha: AI_OPS_PORT_BASE_SHA,
    reliabilityDraft: AI_OPS_PRESTAGE_DRAFT_REFERENCES.reliabilityTargets,
    identityDraft: AI_OPS_PRESTAGE_DRAFT_REFERENCES.identity,
    measurementProfile: MEASUREMENT_PROFILE_BY_TARGET_KIND[row.targetKind],
    target: row.target,
    evidenceState: 'UNMEASURED' as const,
    decisionStatus: 'DRAFT-REQUIRES-OWNER-SIGNATURE' as const,
    activationState: 'UNSIGNED_INACTIVE' as const,
    providerState: 'NOT_CONFIGURED' as const,
    operatingMode: 'SHADOW' as const,
    authorityCreated: false as const,
  };
  const unsignedPayloadDigest = sha256Canonical(unsignedPayload);
  return immutableClone({
    ...unsignedPayload,
    unsignedPayloadDigest,
    ownerSignature: createAiOpsOwnerSignaturePlaceholder(unsignedPayloadDigest),
  });
}

export const AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES: readonly Readonly<AiOpsCapabilityGraduationTargetInstance>[] = immutableClone(
  AI_OPS_CAPABILITY_RELIABILITY_TARGETS.map(makeCapabilityGraduationTargetInstance),
);

export interface AiOpsTypedParameterDescriptor {
  readonly parameterId: string;
  readonly valueType: 'BOUNDED_ID' | 'NONNEGATIVE_INTEGER' | 'UTC_MILLIS' | 'DURATION_MS';
  readonly required: true;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly maximumLength: number | null;
}

export interface AiOpsResourceSelector {
  readonly resourceKind: string;
  readonly selectorParameter: string;
  readonly accessMode: string;
  readonly maximumResources: 1;
  readonly capitalMutationAllowed: false;
}

interface AiOpsRunbookInstanceConfig {
  readonly eligibleFingerprintPatterns: readonly string[];
  readonly preconditionIds: readonly string[];
  readonly typedParameters: readonly Readonly<AiOpsTypedParameterDescriptor>[];
  readonly resourceSelectors: readonly Readonly<AiOpsResourceSelector>[];
  readonly conflictKeys: readonly string[];
  readonly independentPostconditionIds: readonly string[];
  readonly rollbackOrCompensationId: string;
  readonly manualFallbackId: string;
  readonly requiredTelemetryIds: readonly string[];
  readonly requiredEvidenceIds: readonly string[];
}

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function idParameter(parameterId: string): Readonly<AiOpsTypedParameterDescriptor> {
  return { parameterId, valueType: 'BOUNDED_ID', required: true, minimum: null, maximum: null, maximumLength: 192 };
}

function integerParameter(
  parameterId: string,
  valueType: 'NONNEGATIVE_INTEGER' | 'UTC_MILLIS' | 'DURATION_MS',
  maximum: number,
): Readonly<AiOpsTypedParameterDescriptor> {
  return { parameterId, valueType, required: true, minimum: 0, maximum, maximumLength: null };
}

function selector(resourceKind: string, selectorParameter: string, accessMode: string): Readonly<AiOpsResourceSelector> {
  return { resourceKind, selectorParameter, accessMode, maximumResources: 1, capitalMutationAllowed: false };
}

const RUNBOOK_INSTANCE_CONFIGS: Readonly<Record<string, Readonly<AiOpsRunbookInstanceConfig>>> = immutableClone({
  RECONNECT_STREAM: {
    eligibleFingerprintPatterns: ['PUBLIC_STREAM_DISCONNECTED_V1', 'PUBLIC_STREAM_BACKOFF_EXHAUSTED_V1'],
    preconditionIds: ['SHADOW_MODE', 'PUBLIC_STREAM_OWNER_CONFIRMED', 'NO_ACTIVE_RECONNECT_LEASE', 'REPLAY_CURSOR_VALID'],
    typedParameters: [idParameter('streamId'), integerParameter('expectedGeneration', 'NONNEGATIVE_INTEGER', 1_000_000_000), integerParameter('maximumDowntimeMs', 'DURATION_MS', 30_000), idParameter('replayCursorRef')],
    resourceSelectors: [selector('PUBLIC_STREAM', 'streamId', 'RECONNECT_CONNECTION_ONLY')],
    conflictKeys: ['PUBLIC_STREAM_CONNECTION/{streamId}'],
    independentPostconditionIds: ['PUBLIC_STREAM_OWNER_READBACK_READY', 'STREAM_GENERATION_ADVANCED', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'STOP_RECONNECT_AND_RESTORE_OWNER_BACKOFF',
    manualFallbackId: 'OWNER_RESTART_PUBLIC_STREAM',
    requiredTelemetryIds: ['STREAM_LIFECYCLE', 'STREAM_SEQUENCE_GAP', 'STREAM_RECONNECT_ATTEMPT'],
    requiredEvidenceIds: ['TRIGGER_EVENT', 'OWNER_READBACK_BEFORE', 'OWNER_READBACK_AFTER', 'REPLAY_CURSOR_PROOF'],
  },
  RESUBSCRIBE_REPLAY_SAFE: {
    eligibleFingerprintPatterns: ['PUBLIC_SUBSCRIPTION_MISSING_V1', 'PUBLIC_SUBSCRIPTION_CURSOR_GAP_V1'],
    preconditionIds: ['SHADOW_MODE', 'SUBSCRIPTION_OWNER_CONFIRMED', 'CURSOR_REPLAY_SAFE', 'NO_ACTIVE_SUBSCRIPTION_LEASE'],
    typedParameters: [idParameter('subscriptionId'), idParameter('sourceId'), idParameter('replayCursorRef'), integerParameter('maximumReplayEvents', 'NONNEGATIVE_INTEGER', 10_000)],
    resourceSelectors: [selector('PUBLIC_SUBSCRIPTION', 'subscriptionId', 'RESUBSCRIBE_WITH_CURSOR_ONLY')],
    conflictKeys: ['PUBLIC_SUBSCRIPTION/{subscriptionId}'],
    independentPostconditionIds: ['SUBSCRIPTION_OWNER_READBACK_READY', 'CURSOR_CONTINUITY_PROVED', 'NO_DUPLICATE_DELIVERY', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'STOP_RESUBSCRIBE_AND_PRESERVE_GAP',
    manualFallbackId: 'OWNER_REVIEW_SUBSCRIPTION_GAP',
    requiredTelemetryIds: ['SUBSCRIPTION_LIFECYCLE', 'SOURCE_SEQUENCE', 'REPLAY_EVENT_COUNT'],
    requiredEvidenceIds: ['TRIGGER_EVENT', 'CURSOR_BEFORE', 'CURSOR_AFTER', 'DEDUPE_READBACK'],
  },
  RESNAPSHOT_READ_MODEL: {
    eligibleFingerprintPatterns: ['READ_MODEL_REVISION_STALLED_V1', 'READ_MODEL_SNAPSHOT_MISSING_V1'],
    preconditionIds: ['SHADOW_MODE', 'READ_MODEL_OWNER_CONFIRMED', 'SOURCE_REVISION_STABLE', 'NO_ACTIVE_SNAPSHOT_LEASE'],
    typedParameters: [idParameter('projectionId'), integerParameter('expectedRevision', 'NONNEGATIVE_INTEGER', 1_000_000_000), integerParameter('maximumSnapshotBytes', 'NONNEGATIVE_INTEGER', 16_000_000)],
    resourceSelectors: [selector('CANONICAL_READ_MODEL', 'projectionId', 'RESNAPSHOT_DERIVED_PROJECTION_ONLY')],
    conflictKeys: ['READ_MODEL_SNAPSHOT/{projectionId}'],
    independentPostconditionIds: ['READ_MODEL_REVISION_MATCH', 'SNAPSHOT_CONTENT_HASH_MATCH', 'NO_CANONICAL_SOURCE_MUTATION', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'DISCARD_DERIVED_SNAPSHOT_AND_RETAIN_PRIOR',
    manualFallbackId: 'OWNER_REVIEW_READ_MODEL_SOURCE',
    requiredTelemetryIds: ['READ_MODEL_REVISION', 'SNAPSHOT_BYTE_COUNT', 'SNAPSHOT_HASH'],
    requiredEvidenceIds: ['SOURCE_REVISION', 'PRIOR_SNAPSHOT_HASH', 'NEW_SNAPSHOT_HASH', 'OWNER_READBACK_AFTER'],
  },
  REFRESH_BOUNDED_METADATA_CACHE: {
    eligibleFingerprintPatterns: ['METADATA_CACHE_STALE_V1', 'METADATA_CACHE_ENTRY_MISSING_V1'],
    preconditionIds: ['SHADOW_MODE', 'CACHE_OWNER_CONFIRMED', 'PUBLIC_SOURCE_ONLY', 'NO_ACTIVE_CACHE_LEASE'],
    typedParameters: [idParameter('cacheId'), integerParameter('expectedRevision', 'NONNEGATIVE_INTEGER', 1_000_000_000), integerParameter('maximumEntries', 'NONNEGATIVE_INTEGER', 10_000)],
    resourceSelectors: [selector('BOUNDED_METADATA_CACHE', 'cacheId', 'REFRESH_PUBLIC_METADATA_ONLY')],
    conflictKeys: ['METADATA_CACHE/{cacheId}'],
    independentPostconditionIds: ['CACHE_REVISION_MATCH', 'CACHE_ENTRY_BOUND_RESPECTED', 'NO_PRIVATE_SOURCE', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'RESTORE_PRIOR_CACHE_REVISION',
    manualFallbackId: 'OWNER_INVALIDATE_METADATA_CACHE',
    requiredTelemetryIds: ['CACHE_REVISION', 'CACHE_ENTRY_COUNT', 'CACHE_REFRESH_DURATION'],
    requiredEvidenceIds: ['SOURCE_REVISION', 'PRIOR_CACHE_HASH', 'NEW_CACHE_HASH', 'CACHE_OWNER_READBACK'],
  },
  REBUILD_BOUNDED_DERIVED_CACHE: {
    eligibleFingerprintPatterns: ['DERIVED_CACHE_CORRUPT_V1', 'DERIVED_CACHE_REVISION_MISMATCH_V1'],
    preconditionIds: ['SHADOW_MODE', 'DERIVED_CACHE_OWNER_CONFIRMED', 'CANONICAL_SOURCE_UNCHANGED', 'NO_ACTIVE_CACHE_LEASE'],
    typedParameters: [idParameter('cacheId'), integerParameter('sourceRevision', 'NONNEGATIVE_INTEGER', 1_000_000_000), integerParameter('maximumEntries', 'NONNEGATIVE_INTEGER', 100_000)],
    resourceSelectors: [selector('BOUNDED_DERIVED_CACHE', 'cacheId', 'REBUILD_FROM_CANONICAL_READ_ONLY_SOURCE')],
    conflictKeys: ['DERIVED_CACHE/{cacheId}'],
    independentPostconditionIds: ['DERIVED_CACHE_HASH_MATCH', 'SOURCE_REVISION_UNCHANGED', 'CACHE_ENTRY_BOUND_RESPECTED', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'RESTORE_PRIOR_DERIVED_CACHE',
    manualFallbackId: 'OWNER_QUARANTINE_DERIVED_CACHE',
    requiredTelemetryIds: ['DERIVED_CACHE_REVISION', 'DERIVED_CACHE_ENTRY_COUNT', 'DERIVED_CACHE_REBUILD_DURATION'],
    requiredEvidenceIds: ['CANONICAL_SOURCE_HASH', 'PRIOR_CACHE_HASH', 'NEW_CACHE_HASH', 'CACHE_OWNER_READBACK'],
  },
  RESTART_CLASSIFIED_STATELESS_CHILD: {
    eligibleFingerprintPatterns: ['CLASSIFIED_STATELESS_CHILD_STOPPED_V1', 'CLASSIFIED_STATELESS_CHILD_CRASH_LOOP_V1'],
    preconditionIds: ['SHADOW_MODE', 'COMPONENT_CLASSIFIED_STATELESS', 'NO_ACTIVE_COMPONENT_LEASE', 'RESTART_BUDGET_AVAILABLE'],
    typedParameters: [idParameter('componentId'), integerParameter('expectedGeneration', 'NONNEGATIVE_INTEGER', 1_000_000_000), integerParameter('maximumRestartAttempts', 'NONNEGATIVE_INTEGER', 1)],
    resourceSelectors: [selector('CLASSIFIED_STATELESS_CHILD', 'componentId', 'RESTART_CHILD_PROCESS_ONLY')],
    conflictKeys: ['STATELESS_CHILD/{componentId}'],
    independentPostconditionIds: ['COMPONENT_GENERATION_ADVANCED', 'COMPONENT_OWNER_READBACK_READY', 'DEPENDENCIES_UNCHANGED', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'STOP_CHILD_AND_QUARANTINE_RESTART',
    manualFallbackId: 'OWNER_REVIEW_STATELESS_CHILD',
    requiredTelemetryIds: ['COMPONENT_LIFECYCLE', 'COMPONENT_GENERATION', 'RESTART_BUDGET'],
    requiredEvidenceIds: ['CLASSIFICATION_MANIFEST_ENTRY', 'COMPONENT_READBACK_BEFORE', 'COMPONENT_READBACK_AFTER', 'DEPENDENCY_HEALTH_READBACK'],
  },
  ROTATE_STUCK_LOCAL_DIAGNOSTIC_WORKER: {
    eligibleFingerprintPatterns: ['LOCAL_DIAGNOSTIC_WORKER_DEADLINE_EXCEEDED_V1', 'LOCAL_DIAGNOSTIC_WORKER_SCHEMA_LOOP_V1'],
    preconditionIds: ['SHADOW_MODE', 'DIAGNOSTIC_WORKER_LOCAL_ONLY', 'NO_EFFECT_IN_FLIGHT', 'NO_ACTIVE_WORKER_LEASE'],
    typedParameters: [idParameter('workerId'), integerParameter('leaseEpoch', 'NONNEGATIVE_INTEGER', 1_000_000_000), integerParameter('maximumRuntimeMs', 'DURATION_MS', 60_000)],
    resourceSelectors: [selector('LOCAL_DIAGNOSTIC_WORKER', 'workerId', 'ROTATE_DIAGNOSTIC_PROCESS_ONLY')],
    conflictKeys: ['DIAGNOSTIC_WORKER/{workerId}'],
    independentPostconditionIds: ['OLD_WORKER_FENCED', 'NEW_WORKER_GENERATION_READBACK', 'NO_PROVIDER_FALLBACK', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'STOP_REPLACEMENT_AND_PRESERVE_CASE',
    manualFallbackId: 'OWNER_DISABLE_DIAGNOSTIC_ROUTE',
    requiredTelemetryIds: ['WORKER_LEASE_EPOCH', 'WORKER_DEADLINE', 'WORKER_SCHEMA_FAILURE_COUNT'],
    requiredEvidenceIds: ['WORKER_READBACK_BEFORE', 'LEASE_FENCE_RECEIPT', 'WORKER_READBACK_AFTER', 'CASE_CHECKPOINT_REFERENCE'],
  },
  COLLECT_BOUNDED_DIAGNOSTIC_BUNDLE: {
    eligibleFingerprintPatterns: ['DIAGNOSTIC_EVIDENCE_REQUESTED_V1', 'INCIDENT_EVIDENCE_INCOMPLETE_V1'],
    preconditionIds: ['SHADOW_MODE', 'CASE_ADMITTED', 'EVIDENCE_POINTERS_VALID', 'REDACTION_POLICY_AVAILABLE'],
    typedParameters: [idParameter('caseId'), integerParameter('windowStartMs', 'UTC_MILLIS', MAX_SAFE_INTEGER), integerParameter('windowEndMs', 'UTC_MILLIS', MAX_SAFE_INTEGER), integerParameter('maximumBytes', 'NONNEGATIVE_INTEGER', 32_000_000)],
    resourceSelectors: [selector('DIAGNOSTIC_EVIDENCE_BUNDLE', 'caseId', 'COLLECT_REDACTED_POINTERS_ONLY')],
    conflictKeys: ['DIAGNOSTIC_BUNDLE/{caseId}'],
    independentPostconditionIds: ['BUNDLE_HASH_READBACK', 'BUNDLE_BYTE_BOUND_RESPECTED', 'REDACTION_PROOF_PRESENT', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'DISCARD_UNVERIFIED_BUNDLE',
    manualFallbackId: 'OWNER_COLLECT_DIAGNOSTIC_REFERENCES',
    requiredTelemetryIds: ['BUNDLE_BYTE_COUNT', 'BUNDLE_POINTER_COUNT', 'REDACTION_COUNT'],
    requiredEvidenceIds: ['CASE_REFERENCE', 'WINDOW_BOUNDS', 'BUNDLE_HASH', 'REDACTION_RECEIPT'],
  },
  RERUN_SAFE_READ_ONLY_RECONCILIATION_QUERY: {
    eligibleFingerprintPatterns: ['READ_ONLY_RECONCILIATION_STALE_V1', 'READ_ONLY_RECONCILIATION_QUERY_FAILED_V1'],
    preconditionIds: ['SHADOW_MODE', 'READ_ONLY_QUERY_REGISTERED', 'RECONCILIATION_OWNER_CONFIRMED', 'NO_MUTATION_CAPABILITY'],
    typedParameters: [idParameter('reconciliationScopeId'), integerParameter('expectedRevision', 'NONNEGATIVE_INTEGER', 1_000_000_000), integerParameter('maximumRecords', 'NONNEGATIVE_INTEGER', 10_000)],
    resourceSelectors: [selector('READ_ONLY_RECONCILIATION_QUERY', 'reconciliationScopeId', 'QUERY_AND_READBACK_ONLY')],
    conflictKeys: ['READ_ONLY_RECONCILIATION/{reconciliationScopeId}'],
    independentPostconditionIds: ['QUERY_RECEIPT_READBACK', 'RECONCILIATION_REVISION_UNCHANGED', 'NO_PRIVATE_CREDENTIAL_EXPOSURE', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'ABANDON_QUERY_AND_PRESERVE_UNKNOWN',
    manualFallbackId: 'OWNER_RUN_REGISTERED_READ_ONLY_QUERY',
    requiredTelemetryIds: ['RECONCILIATION_QUERY_DURATION', 'RECONCILIATION_RESULT_COUNT', 'RECONCILIATION_REVISION'],
    requiredEvidenceIds: ['QUERY_REGISTRATION', 'OWNER_READBACK_BEFORE', 'QUERY_RECEIPT', 'OWNER_READBACK_AFTER'],
  },
  REPAIR_LOCAL_OBSERVATION_SUBSCRIPTION: {
    eligibleFingerprintPatterns: ['LOCAL_OBSERVATION_SUBSCRIPTION_LOST_V1', 'LOCAL_OBSERVATION_CURSOR_STALLED_V1'],
    preconditionIds: ['SHADOW_MODE', 'OBSERVATION_OWNER_CONFIRMED', 'LOCAL_SUBSCRIPTION_ONLY', 'DESIRED_CAPITAL_STATE_UNCHANGED'],
    typedParameters: [idParameter('subscriptionId'), idParameter('observationSourceId'), idParameter('replayCursorRef'), integerParameter('maximumReplayEvents', 'NONNEGATIVE_INTEGER', 10_000)],
    resourceSelectors: [selector('LOCAL_OBSERVATION_SUBSCRIPTION', 'subscriptionId', 'REPAIR_OBSERVATION_DELIVERY_ONLY')],
    conflictKeys: ['LOCAL_OBSERVATION_SUBSCRIPTION/{subscriptionId}'],
    independentPostconditionIds: ['OBSERVATION_CURSOR_ADVANCED', 'OBSERVATION_OWNER_READBACK_READY', 'DESIRED_CAPITAL_STATE_UNCHANGED', 'NO_CAPITAL_EFFECT'],
    rollbackOrCompensationId: 'STOP_REPAIR_AND_PRESERVE_SUBSCRIPTION_GAP',
    manualFallbackId: 'OWNER_RECREATE_LOCAL_OBSERVATION_SUBSCRIPTION',
    requiredTelemetryIds: ['OBSERVATION_CURSOR', 'OBSERVATION_DELIVERY_COUNT', 'OBSERVATION_GAP_COUNT'],
    requiredEvidenceIds: ['SUBSCRIPTION_READBACK_BEFORE', 'CURSOR_BEFORE', 'CURSOR_AFTER', 'SUBSCRIPTION_READBACK_AFTER'],
  },
});

export interface AiOpsRunbookManifestInstance {
  readonly schema: 'AI_OPS_RUNBOOK_MANIFEST_INSTANCE_V1';
  readonly manifestInstanceId: string;
  readonly runbookId: string;
  readonly revision: 1;
  readonly shadowA1SealedSha: typeof AI_OPS_SHADOW_A1_SEALED_SHA;
  readonly portBaseSha: typeof AI_OPS_PORT_BASE_SHA;
  readonly sourceTemplateDigest: string;
  readonly identityDraft: Readonly<AiOpsDraftReference>;
  readonly reliabilityDraft: Readonly<AiOpsDraftReference>;
  readonly owner: 'PRODUCT_ASSURANCE_REMEDIATION_OWNER_REQUIRED';
  readonly ownerBindingState: 'MISSING_REQUIRED';
  readonly actionId: string;
  readonly actionClass: 'A';
  readonly registrationState: 'UNSIGNED_INACTIVE';
  readonly executionBindingState: 'NOT_WIRED';
  readonly effectOwnerId: 'PRODUCT_ASSURANCE_REMEDIATION';
  readonly effectOwnerInsertionRequestId: 'AIOPS-IR-REMEDIATION-010';
  readonly selectorIdentityId: 'aiops-shadow-runtime-diagnostician';
  readonly selectorIdentityRole: 'RUNTIME_DIAGNOSTICIAN';
  readonly selectorProviderState: 'NOT_CONFIGURED';
  readonly selectorAuthority: 'RECOMMEND_ONLY';
  readonly triggerIds: readonly string[];
  readonly eligibleFingerprintPatterns: readonly string[];
  readonly preconditionIds: readonly string[];
  readonly typedParameters: readonly Readonly<AiOpsTypedParameterDescriptor>[];
  readonly resourceSelectors: readonly Readonly<AiOpsResourceSelector>[];
  readonly conflictKeys: readonly string[];
  readonly idempotencyKeyFields: readonly string[];
  readonly leaseRequired: true;
  readonly fencingRequired: true;
  readonly maximumAttempts: number;
  readonly maximumEffects: 1;
  readonly maximumDurationMs: number;
  readonly maximumBlastRadiusResources: 1;
  readonly independentPostconditionIds: readonly string[];
  readonly quietPeriodMs: number;
  readonly recurrenceThreshold: Readonly<{
    readonly maximumCount: number;
    readonly maximumRatePermillion: number;
    readonly escalationClass: 'B';
  }>;
  readonly rollbackOrCompensationId: string;
  readonly manualFallbackId: string;
  readonly requiredTelemetryIds: readonly string[];
  readonly requiredEvidenceIds: readonly string[];
  readonly graduationTargetInstanceId: string;
  readonly expiresAtMs: number;
  readonly revocationState: 'UNSIGNED_INACTIVE';
  readonly networkPermitted: false;
  readonly credentialAccessPermitted: false;
  readonly effectPermitted: false;
  readonly liveExecutionState: typeof AI_OPS_LIVE_EXECUTION_STATE;
  readonly authorityCreated: false;
  readonly unsignedPayloadDigest: string;
  readonly ownerSignature: Readonly<AiOpsOwnerSignaturePlaceholder>;
}

function runbookManifestInstanceId(actionId: string): string {
  return `AI_OPS_RUNBOOK_MANIFEST_${actionId}_INSTANCE_V1`;
}

function makeRunbookManifestInstance(
  template: Readonly<AiOpsRunbookTemplate>,
): Readonly<AiOpsRunbookManifestInstance> {
  const config = RUNBOOK_INSTANCE_CONFIGS[template.actionId];
  if (config === undefined) throw new TypeError(`missing runbook instance config: ${template.actionId}`);
  const selectorIdentity = AI_OPS_IDENTITIES.find((identity) => identity.role === 'RUNTIME_DIAGNOSTICIAN');
  if (selectorIdentity?.identityId !== 'aiops-shadow-runtime-diagnostician') throw new TypeError('runtime diagnostician identity mismatch');
  const primarySelector = config.resourceSelectors[0]?.selectorParameter;
  if (primarySelector === undefined) throw new TypeError(`missing runbook resource selector: ${template.actionId}`);
  const unsignedPayload = {
    schema: 'AI_OPS_RUNBOOK_MANIFEST_INSTANCE_V1' as const,
    manifestInstanceId: runbookManifestInstanceId(template.actionId),
    runbookId: template.runbookId,
    revision: 1 as const,
    shadowA1SealedSha: AI_OPS_SHADOW_A1_SEALED_SHA,
    portBaseSha: AI_OPS_PORT_BASE_SHA,
    sourceTemplateDigest: sha256Canonical(template),
    identityDraft: AI_OPS_PRESTAGE_DRAFT_REFERENCES.identity,
    reliabilityDraft: AI_OPS_PRESTAGE_DRAFT_REFERENCES.reliabilityTargets,
    owner: 'PRODUCT_ASSURANCE_REMEDIATION_OWNER_REQUIRED' as const,
    ownerBindingState: 'MISSING_REQUIRED' as const,
    actionId: template.actionId,
    actionClass: 'A' as const,
    registrationState: 'UNSIGNED_INACTIVE' as const,
    executionBindingState: 'NOT_WIRED' as const,
    effectOwnerId: 'PRODUCT_ASSURANCE_REMEDIATION' as const,
    effectOwnerInsertionRequestId: 'AIOPS-IR-REMEDIATION-010' as const,
    selectorIdentityId: 'aiops-shadow-runtime-diagnostician' as const,
    selectorIdentityRole: 'RUNTIME_DIAGNOSTICIAN' as const,
    selectorProviderState: 'NOT_CONFIGURED' as const,
    selectorAuthority: 'RECOMMEND_ONLY' as const,
    triggerIds: template.triggerIds,
    eligibleFingerprintPatterns: config.eligibleFingerprintPatterns,
    preconditionIds: config.preconditionIds,
    typedParameters: config.typedParameters,
    resourceSelectors: config.resourceSelectors,
    conflictKeys: config.conflictKeys,
    idempotencyKeyFields: ['caseId', 'actionId', primarySelector, 'policyRevision'],
    leaseRequired: true as const,
    fencingRequired: true as const,
    maximumAttempts: template.maximumAttempts,
    maximumEffects: 1 as const,
    maximumDurationMs: template.maximumDurationMs,
    maximumBlastRadiusResources: 1 as const,
    independentPostconditionIds: config.independentPostconditionIds,
    quietPeriodMs: template.graduationTarget.minimumQuietPeriodMs,
    recurrenceThreshold: {
      maximumCount: template.graduationTarget.maximumRecurrenceCount,
      maximumRatePermillion: template.graduationTarget.maximumRecurrenceRatePermillion,
      escalationClass: 'B' as const,
    },
    rollbackOrCompensationId: config.rollbackOrCompensationId,
    manualFallbackId: config.manualFallbackId,
    requiredTelemetryIds: config.requiredTelemetryIds,
    requiredEvidenceIds: config.requiredEvidenceIds,
    graduationTargetInstanceId: graduationTargetInstanceId(template.actionId),
    expiresAtMs: template.expiresAtMs,
    revocationState: 'UNSIGNED_INACTIVE' as const,
    networkPermitted: false as const,
    credentialAccessPermitted: false as const,
    effectPermitted: false as const,
    liveExecutionState: AI_OPS_LIVE_EXECUTION_STATE,
    authorityCreated: false as const,
  };
  const unsignedPayloadDigest = sha256Canonical(unsignedPayload);
  return immutableClone({
    ...unsignedPayload,
    unsignedPayloadDigest,
    ownerSignature: createAiOpsOwnerSignaturePlaceholder(unsignedPayloadDigest),
  });
}

export const AI_OPS_RUNBOOK_MANIFEST_INSTANCES: readonly Readonly<AiOpsRunbookManifestInstance>[] = immutableClone(
  AI_OPS_RUNBOOK_TEMPLATES.map(makeRunbookManifestInstance),
);

export interface AiOpsActionClassFixtureInstance {
  readonly schema: 'AI_OPS_ACTION_CLASS_FIXTURE_INSTANCE_V1';
  readonly fixtureId: string;
  readonly fixtureRevision: 1;
  readonly shadowA1SealedSha: typeof AI_OPS_SHADOW_A1_SEALED_SHA;
  readonly portBaseSha: typeof AI_OPS_PORT_BASE_SHA;
  readonly requestedActionClass: AiOpsActionClass;
  readonly actionId: string;
  readonly resourceId: string;
  readonly runbookManifestInstanceId: string | null;
  readonly graduationTargetInstanceId: string | null;
  readonly requestingIdentityId: 'aiops-shadow-runtime-diagnostician';
  readonly providerState: 'NOT_CONFIGURED';
  readonly operatingMode: 'SHADOW';
  readonly requestedParameters: Readonly<Record<string, string | number>>;
  readonly expectedEffectiveActionClass: AiOpsActionClass;
  readonly expectedDisposition: 'SHADOW_CANDIDATE_ONLY' | 'PROPOSAL_ONLY' | 'ISOLATED_PATCH_ONLY' | 'PERMANENTLY_DENIED';
  readonly ownerApprovalRequired: boolean;
  readonly isolatedPatchRequired: boolean;
  readonly hardDenialIds: readonly string[];
  readonly expectedReasonCodes: readonly string[];
  readonly syntheticOnly: true;
  readonly networkPermitted: false;
  readonly credentialMaterialPresent: false;
  readonly effectPermitted: false;
  readonly authorityCreated: false;
}

const AI_OPS_ACTION_CLASS_FIXTURE_INSTANCE_INPUTS: readonly AiOpsActionClassFixtureInstance[] = [
  {
    schema: 'AI_OPS_ACTION_CLASS_FIXTURE_INSTANCE_V1', fixtureId: 'AI_OPS_ACTION_FIXTURE_CLASS_A_RECONNECT_STREAM_V1', fixtureRevision: 1, shadowA1SealedSha: AI_OPS_SHADOW_A1_SEALED_SHA, portBaseSha: AI_OPS_PORT_BASE_SHA,
    requestedActionClass: 'A', actionId: 'RECONNECT_STREAM', resourceId: 'synthetic-public-stream-fixture',
    runbookManifestInstanceId: runbookManifestInstanceId('RECONNECT_STREAM'), graduationTargetInstanceId: graduationTargetInstanceId('RECONNECT_STREAM'),
    requestingIdentityId: 'aiops-shadow-runtime-diagnostician', providerState: 'NOT_CONFIGURED', operatingMode: 'SHADOW',
    requestedParameters: { streamId: 'synthetic-public-stream-fixture', expectedGeneration: 7, maximumDowntimeMs: 5_000, replayCursorRef: 'synthetic-cursor-1042' },
    expectedEffectiveActionClass: 'C', expectedDisposition: 'SHADOW_CANDIDATE_ONLY', ownerApprovalRequired: true, isolatedPatchRequired: false,
    hardDenialIds: [], expectedReasonCodes: ['OWNER_SIGNATURE_REQUIRED', 'RUNBOOK_EXECUTION_BINDING_NOT_WIRED', 'SHADOW_SPECULATIVE_CANNOT_GRANT_AUTHORITY'],
    syntheticOnly: true, networkPermitted: false, credentialMaterialPresent: false, effectPermitted: false, authorityCreated: false,
  },
  {
    schema: 'AI_OPS_ACTION_CLASS_FIXTURE_INSTANCE_V1', fixtureId: 'AI_OPS_ACTION_FIXTURE_CLASS_B_SERVICE_RESTART_V1', fixtureRevision: 1, shadowA1SealedSha: AI_OPS_SHADOW_A1_SEALED_SHA, portBaseSha: AI_OPS_PORT_BASE_SHA,
    requestedActionClass: 'B', actionId: 'HOST_OR_SYSTEM_SERVICE_RESTART', resourceId: 'synthetic-stateless-service-fixture',
    runbookManifestInstanceId: null, graduationTargetInstanceId: null,
    requestingIdentityId: 'aiops-shadow-runtime-diagnostician', providerState: 'NOT_CONFIGURED', operatingMode: 'SHADOW',
    requestedParameters: { serviceId: 'synthetic-stateless-service-fixture', expectedGeneration: 4 },
    expectedEffectiveActionClass: 'B', expectedDisposition: 'PROPOSAL_ONLY', ownerApprovalRequired: true, isolatedPatchRequired: false,
    hardDenialIds: [], expectedReasonCodes: ['HUMAN_OWNER_APPROVAL_REQUIRED', 'CANONICAL_EFFECT_OWNER_REQUIRED', 'EFFECT_NOT_PERMITTED_IN_SHADOW'],
    syntheticOnly: true, networkPermitted: false, credentialMaterialPresent: false, effectPermitted: false, authorityCreated: false,
  },
  {
    schema: 'AI_OPS_ACTION_CLASS_FIXTURE_INSTANCE_V1', fixtureId: 'AI_OPS_ACTION_FIXTURE_CLASS_C_CODE_TEST_PATCH_V1', fixtureRevision: 1, shadowA1SealedSha: AI_OPS_SHADOW_A1_SEALED_SHA, portBaseSha: AI_OPS_PORT_BASE_SHA,
    requestedActionClass: 'C', actionId: 'CODE_OR_TEST_MODIFICATION', resourceId: 'synthetic-isolated-worktree-fixture',
    runbookManifestInstanceId: null, graduationTargetInstanceId: graduationTargetInstanceId('PATCH_CATEGORY_CODE_AND_TEST'),
    requestingIdentityId: 'aiops-shadow-runtime-diagnostician', providerState: 'NOT_CONFIGURED', operatingMode: 'SHADOW',
    requestedParameters: { patchTaskId: 'synthetic-isolated-patch-task', baseRevision: AI_OPS_SHADOW_A1_SEALED_SHA },
    expectedEffectiveActionClass: 'C', expectedDisposition: 'ISOLATED_PATCH_ONLY', ownerApprovalRequired: true, isolatedPatchRequired: true,
    hardDenialIds: [], expectedReasonCodes: ['ISOLATED_WORKTREE_REQUIRED', 'INDEPENDENT_VERIFICATION_REQUIRED', 'NO_MAIN_WRITE'],
    syntheticOnly: true, networkPermitted: false, credentialMaterialPresent: false, effectPermitted: false, authorityCreated: false,
  },
  {
    schema: 'AI_OPS_ACTION_CLASS_FIXTURE_INSTANCE_V1', fixtureId: 'AI_OPS_ACTION_FIXTURE_CLASS_D_SIGN_ORDER_V1', fixtureRevision: 1, shadowA1SealedSha: AI_OPS_SHADOW_A1_SEALED_SHA, portBaseSha: AI_OPS_PORT_BASE_SHA,
    requestedActionClass: 'D', actionId: 'SIGN_ORDER', resourceId: 'synthetic-denied-order-resource',
    runbookManifestInstanceId: null, graduationTargetInstanceId: null,
    requestingIdentityId: 'aiops-shadow-runtime-diagnostician', providerState: 'NOT_CONFIGURED', operatingMode: 'SHADOW',
    requestedParameters: { requestId: 'synthetic-denied-order-request' },
    expectedEffectiveActionClass: 'D', expectedDisposition: 'PERMANENTLY_DENIED', ownerApprovalRequired: false, isolatedPatchRequired: false,
    hardDenialIds: ['AI_OPS_DENY_ORDER_MUTATION'], expectedReasonCodes: ['HARD_DENIAL_MATCH', 'OWNER_APPROVAL_CANNOT_OVERRIDE_HARD_DENIAL'],
    syntheticOnly: true, networkPermitted: false, credentialMaterialPresent: false, effectPermitted: false, authorityCreated: false,
  },
];

export const AI_OPS_ACTION_CLASS_FIXTURE_INSTANCES: readonly Readonly<AiOpsActionClassFixtureInstance>[] = immutableClone(
  AI_OPS_ACTION_CLASS_FIXTURE_INSTANCE_INPUTS,
);

const OWNER_SIGNATURE_PLACEHOLDER_KEYS = [
  'schema', 'signerRole', 'signerIdentityId', 'algorithm', 'keyReference', 'signatureBytesBase64Url',
  'signedPayloadDigest', 'signedAtMs', 'expiresAtMs', 'signatureState', 'authorityCreated',
] as const;
const TARGET_INSTANCE_KEYS = [
  'schema', 'targetInstanceId', 'targetKind', 'capabilityId', 'targetRevision', 'shadowA1SealedSha', 'portBaseSha',
  'reliabilityDraft', 'identityDraft', 'measurementProfile', 'target', 'evidenceState', 'decisionStatus',
  'activationState', 'providerState', 'operatingMode', 'authorityCreated', 'unsignedPayloadDigest', 'ownerSignature',
] as const;
const RUNBOOK_INSTANCE_KEYS = [
  'schema', 'manifestInstanceId', 'runbookId', 'revision', 'shadowA1SealedSha', 'portBaseSha', 'sourceTemplateDigest',
  'identityDraft', 'reliabilityDraft', 'owner', 'ownerBindingState', 'actionId', 'actionClass',
  'registrationState', 'executionBindingState', 'effectOwnerId', 'effectOwnerInsertionRequestId',
  'selectorIdentityId', 'selectorIdentityRole', 'selectorProviderState', 'selectorAuthority',
  'triggerIds', 'eligibleFingerprintPatterns', 'preconditionIds', 'typedParameters', 'resourceSelectors', 'conflictKeys',
  'idempotencyKeyFields', 'leaseRequired', 'fencingRequired', 'maximumAttempts', 'maximumEffects',
  'maximumDurationMs', 'maximumBlastRadiusResources', 'independentPostconditionIds', 'quietPeriodMs',
  'recurrenceThreshold', 'rollbackOrCompensationId', 'manualFallbackId', 'requiredTelemetryIds',
  'requiredEvidenceIds', 'graduationTargetInstanceId', 'expiresAtMs', 'revocationState', 'networkPermitted',
  'credentialAccessPermitted', 'effectPermitted', 'liveExecutionState', 'authorityCreated',
  'unsignedPayloadDigest', 'ownerSignature',
] as const;
const ACTION_FIXTURE_KEYS = [
  'schema', 'fixtureId', 'fixtureRevision', 'shadowA1SealedSha', 'portBaseSha', 'requestedActionClass', 'actionId',
  'resourceId', 'runbookManifestInstanceId', 'graduationTargetInstanceId', 'requestingIdentityId',
  'providerState', 'operatingMode', 'requestedParameters', 'expectedEffectiveActionClass',
  'expectedDisposition', 'ownerApprovalRequired', 'isolatedPatchRequired', 'hardDenialIds',
  'expectedReasonCodes', 'syntheticOnly', 'networkPermitted', 'credentialMaterialPresent',
  'effectPermitted', 'authorityCreated',
] as const;

export function isAiOpsOwnerSignaturePlaceholder(
  value: unknown,
  expectedPayloadDigest: string,
): value is Readonly<AiOpsOwnerSignaturePlaceholder> {
  if (!isSha256(expectedPayloadDigest)) return false;
  let snapshot: unknown;
  try {
    snapshot = canonicalPolicySnapshot(value);
  } catch {
    return false;
  }
  return exactKeys(snapshot, OWNER_SIGNATURE_PLACEHOLDER_KEYS)
    && snapshot.schema === 'AI_OPS_OWNER_SIGNATURE_PLACEHOLDER_V1'
    && snapshot.signerRole === 'AI_OPS_OWNER'
    && snapshot.signerIdentityId === null
    && snapshot.algorithm === null
    && snapshot.keyReference === null
    && snapshot.signatureBytesBase64Url === null
    && snapshot.signedPayloadDigest === expectedPayloadDigest
    && snapshot.signedAtMs === null
    && snapshot.expiresAtMs === null
    && snapshot.signatureState === 'OWNER_SIGNATURE_REQUIRED'
    && snapshot.authorityCreated === false;
}

function unsignedPayloadDigestMatches(snapshot: Record<string, unknown>): boolean {
  const { unsignedPayloadDigest, ownerSignature, ...unsignedPayload } = snapshot;
  return isSha256(unsignedPayloadDigest)
    && sha256Canonical(unsignedPayload) === unsignedPayloadDigest
    && isAiOpsOwnerSignaturePlaceholder(ownerSignature, unsignedPayloadDigest);
}

export function isClosedAiOpsCapabilityGraduationTargetInstance(
  value: unknown,
): value is Readonly<AiOpsCapabilityGraduationTargetInstance> {
  let snapshot: unknown;
  try {
    snapshot = canonicalPolicySnapshot(value);
  } catch {
    return false;
  }
  if (!exactKeys(snapshot, TARGET_INSTANCE_KEYS) || typeof snapshot.targetInstanceId !== 'string') return false;
  const canonical = AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES.find((row) => row.targetInstanceId === snapshot.targetInstanceId);
  return canonical !== undefined
    && unsignedPayloadDigestMatches(snapshot)
    && canonicalPolicyJson(snapshot) === canonicalPolicyJson(canonical);
}

export function isClosedAiOpsRunbookManifestInstance(
  value: unknown,
): value is Readonly<AiOpsRunbookManifestInstance> {
  let snapshot: unknown;
  try {
    snapshot = canonicalPolicySnapshot(value);
  } catch {
    return false;
  }
  if (!exactKeys(snapshot, RUNBOOK_INSTANCE_KEYS) || typeof snapshot.manifestInstanceId !== 'string') return false;
  const canonical = AI_OPS_RUNBOOK_MANIFEST_INSTANCES.find((row) => row.manifestInstanceId === snapshot.manifestInstanceId);
  return canonical !== undefined
    && unsignedPayloadDigestMatches(snapshot)
    && canonicalPolicyJson(snapshot) === canonicalPolicyJson(canonical);
}

export function isClosedAiOpsActionClassFixtureInstance(
  value: unknown,
): value is Readonly<AiOpsActionClassFixtureInstance> {
  let snapshot: unknown;
  try {
    snapshot = canonicalPolicySnapshot(value);
  } catch {
    return false;
  }
  if (!exactKeys(snapshot, ACTION_FIXTURE_KEYS) || typeof snapshot.fixtureId !== 'string') return false;
  const canonical = AI_OPS_ACTION_CLASS_FIXTURE_INSTANCES.find((row) => row.fixtureId === snapshot.fixtureId);
  return canonical !== undefined && canonicalPolicyJson(snapshot) === canonicalPolicyJson(canonical);
}

export function validateA1xConcreteInstances(): readonly string[] {
  const failures: string[] = [];
  const targetCapabilityIds = AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES.map((row) => row.capabilityId);
  const sourceTargetCapabilityIds = AI_OPS_CAPABILITY_RELIABILITY_TARGETS.map((row) => row.target.capabilityId);
  if (new Set(targetCapabilityIds).size !== targetCapabilityIds.length) failures.push('DUPLICATE_GRADUATION_TARGET_INSTANCE');
  if (canonicalPolicyJson([...targetCapabilityIds].sort()) !== canonicalPolicyJson([...sourceTargetCapabilityIds].sort())) failures.push('GRADUATION_TARGET_COVERAGE_MISMATCH');
  for (const target of AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES) {
    const targetInstanceId = target.targetInstanceId;
    if (!isClosedAiOpsCapabilityGraduationTargetInstance(target)) failures.push(`TARGET_INSTANCE_INVALID:${targetInstanceId}`);
  }

  const runbookActionIds = AI_OPS_RUNBOOK_MANIFEST_INSTANCES.map((row) => row.actionId);
  const templateActionIds = AI_OPS_RUNBOOK_TEMPLATES.map((row) => row.actionId);
  if (new Set(runbookActionIds).size !== runbookActionIds.length) failures.push('DUPLICATE_RUNBOOK_MANIFEST_INSTANCE');
  if (canonicalPolicyJson([...runbookActionIds].sort()) !== canonicalPolicyJson([...templateActionIds].sort())) failures.push('RUNBOOK_MANIFEST_COVERAGE_MISMATCH');
  for (const runbook of AI_OPS_RUNBOOK_MANIFEST_INSTANCES) {
    const manifestInstanceId = runbook.manifestInstanceId;
    if (!isClosedAiOpsRunbookManifestInstance(runbook)) failures.push(`RUNBOOK_INSTANCE_INVALID:${manifestInstanceId}`);
    if (!AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES.some((row) => row.targetInstanceId === runbook.graduationTargetInstanceId)) {
      failures.push(`RUNBOOK_TARGET_MISSING:${runbook.manifestInstanceId}`);
    }
    if (runbook.effectPermitted || runbook.networkPermitted || runbook.credentialAccessPermitted || runbook.authorityCreated) {
      failures.push(`RUNBOOK_AUTHORITY_LEAK:${runbook.manifestInstanceId}`);
    }
  }

  const fixtureClasses = AI_OPS_ACTION_CLASS_FIXTURE_INSTANCES.map((row) => row.requestedActionClass);
  if (canonicalPolicyJson(fixtureClasses) !== canonicalPolicyJson(['A', 'B', 'C', 'D'])) failures.push('ACTION_FIXTURE_CLASS_COVERAGE_MISMATCH');
  for (const fixture of AI_OPS_ACTION_CLASS_FIXTURE_INSTANCES) {
    const fixtureId = fixture.fixtureId;
    if (!isClosedAiOpsActionClassFixtureInstance(fixture)) failures.push(`ACTION_FIXTURE_INVALID:${fixtureId}`);
    const definition = AI_OPS_ACTION_CLASS_DEFINITIONS.find((row) => row.actionClass === fixture.requestedActionClass);
    if (fixture.requestedActionClass === 'D') {
      const denial = AI_OPS_HARD_DENIALS.find((row) => row.examples.includes(fixture.actionId));
      if (denial === undefined || !fixture.hardDenialIds.includes(denial.denialId)) failures.push(`ACTION_FIXTURE_DENIAL_MISMATCH:${fixture.fixtureId}`);
    } else if (definition === undefined || !definition.eligibleActions.includes(fixture.actionId)) {
      failures.push(`ACTION_FIXTURE_ACTION_MISMATCH:${fixture.fixtureId}`);
    }
    if (fixture.effectPermitted || fixture.networkPermitted || fixture.credentialMaterialPresent || fixture.authorityCreated) {
      failures.push(`ACTION_FIXTURE_AUTHORITY_LEAK:${fixture.fixtureId}`);
    }
  }
  return sortedUnique(failures);
}

export type AiOpsAuthorityManifestRootKind = 'GRADUATION_TARGET' | 'RUNBOOK' | 'ACTION_FIXTURE';

export interface AiOpsMechanicalAuthorityManifestInstance {
  readonly schema: 'AI_OPS_MECHANICAL_AUTHORITY_MANIFEST_INSTANCE_V1';
  readonly rootKind: AiOpsAuthorityManifestRootKind;
  readonly rootResourceId: string;
  readonly declaredActionClass: AiOpsActionClass;
  readonly effectiveActionClass: AiOpsActionClass;
  readonly directDependencyIds: readonly string[];
  readonly transitiveDependencyIds: readonly string[];
  readonly unresolvedDependencyIds: readonly string[];
  readonly cycleMemberIds: readonly string[];
  readonly hardDenialIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly entryDigest: string;
  readonly authorityCreated: false;
}

export interface AiOpsMechanicalAuthorityManifestSet {
  readonly schema: 'AI_OPS_MECHANICAL_AUTHORITY_MANIFEST_SET_V1';
  readonly sourceRevision: string;
  readonly shadowA1SealedSha: typeof AI_OPS_SHADOW_A1_SEALED_SHA;
  readonly portBaseSha: typeof AI_OPS_PORT_BASE_SHA;
  readonly algorithm: 'REUSED_SORTED_DFS_TRANSITIVE_CLOSURE_V1';
  readonly identityDraft: Readonly<AiOpsDraftReference>;
  readonly reliabilityDraft: Readonly<AiOpsDraftReference>;
  readonly classificationInputDigest: string;
  readonly classificationManifestDigest: string;
  readonly classification: Readonly<AiOpsClassificationManifest>;
  readonly rootManifests: readonly Readonly<AiOpsMechanicalAuthorityManifestInstance>[];
  readonly state: 'SHADOW_SPECULATIVE';
  readonly activationState: 'UNSIGNED_INACTIVE';
  readonly operationalAuthorityCreated: false;
  readonly unsignedPayloadDigest: string;
  readonly ownerSignature: Readonly<AiOpsOwnerSignaturePlaceholder>;
}

interface AiOpsAuthorityRootDescriptor {
  readonly rootKind: AiOpsAuthorityManifestRootKind;
  readonly rootResourceId: string;
  readonly declaredActionClass: AiOpsActionClass;
}

function targetAuthorityResourceId(capabilityId: string): string {
  return `a1x-target-${capabilityId}`;
}

function runbookAuthorityResourceId(actionId: string): string {
  return `a1x-runbook-${actionId}`;
}

function actionFixtureAuthorityResourceId(requestedActionClass: AiOpsActionClass): string {
  return `a1x-action-fixture-class-${requestedActionClass}`;
}

function authorityResource(
  resourceId: string,
  kind: AiOpsClassificationResource['kind'],
  classifiedPath: string,
  evidenceDigest: string,
  evidenceRevision: string,
  directDependencyIds: readonly string[],
  requestedActionClass: AiOpsActionClass,
  attemptedActionIds: readonly string[] = [],
  registeredActionId: string | null = null,
  hardDenialIds: readonly string[] = [],
): Readonly<AiOpsClassificationResource> {
  return immutableClone({
    resourceId,
    kind,
    classifiedPath,
    evidencePath: classifiedPath,
    evidenceDigest,
    evidenceDigestAlgorithm: 'SHA-256' as const,
    evidenceRevision,
    directDependencyIds,
    registeredActionId,
    requestedActionClass,
    attemptedActionIds,
    hardDenialIds,
    sensitiveOwnerKinds: [],
  });
}

export function createA1xAuthorityClassificationResources(
  evidenceRevision: string,
): Readonly<{
  readonly resources: readonly Readonly<AiOpsClassificationResource>[];
  readonly roots: readonly Readonly<AiOpsAuthorityRootDescriptor>[];
}> {
  const identityDraftResource = authorityResource(
    'a1x-identity-draft',
    'DONOR_CONTRACT',
    `aiops-prestage-20260714:${AI_OPS_PRESTAGE_DRAFT_REFERENCES.identity.path}`,
    AI_OPS_PRESTAGE_DRAFT_REFERENCES.identity.sha256,
    AI_OPS_PRESTAGE_DRAFT_COMMIT_SHA,
    [],
    'C',
  );
  const reliabilityDraftResource = authorityResource(
    'a1x-reliability-targets-draft',
    'DONOR_CONTRACT',
    `aiops-prestage-20260714:${AI_OPS_PRESTAGE_DRAFT_REFERENCES.reliabilityTargets.path}`,
    AI_OPS_PRESTAGE_DRAFT_REFERENCES.reliabilityTargets.sha256,
    AI_OPS_PRESTAGE_DRAFT_COMMIT_SHA,
    [],
    'C',
  );

  const targetResources = AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES.map((target) => authorityResource(
    targetAuthorityResourceId(target.capabilityId),
    'POLICY',
    `fixtures/aiOps/a1/capability-graduation-target-instances.v1.json#${target.targetInstanceId}`,
    sha256Canonical(target),
    evidenceRevision,
    ['a1x-identity-draft', 'a1x-reliability-targets-draft'],
    'C',
  ));
  const targetResourceIds = new Set(targetResources.map((resource) => resource.resourceId));

  const runbookResources = AI_OPS_RUNBOOK_MANIFEST_INSTANCES.map((runbook) => {
    const targetResourceId = targetAuthorityResourceId(runbook.actionId);
    if (!targetResourceIds.has(targetResourceId)) throw new TypeError(`missing authority target: ${runbook.actionId}`);
    return authorityResource(
      runbookAuthorityResourceId(runbook.actionId),
      'RUNBOOK',
      `fixtures/aiOps/a1/runbook-manifest-instances.v1.json#${runbook.manifestInstanceId}`,
      sha256Canonical(runbook),
      evidenceRevision,
      [
        targetResourceId,
        'a1x-identity-draft',
        'a1x-reliability-targets-draft',
        'aiops-runbook-templates',
        'remediation-owner',
        'command-owner',
      ],
      'A',
      [],
      `AI_OPS_ACTION_${runbook.actionId}`,
    );
  });
  const runbookResourceIds = new Set(runbookResources.map((resource) => resource.resourceId));

  const actionFixtureResources = AI_OPS_ACTION_CLASS_FIXTURE_INSTANCES.map((fixture) => {
    const directDependencyIds = ['a1x-identity-draft', 'a1x-reliability-targets-draft'];
    if (fixture.requestedActionClass === 'A') {
      const runbookResourceId = runbookAuthorityResourceId(fixture.actionId);
      if (!runbookResourceIds.has(runbookResourceId)) throw new TypeError(`missing authority runbook: ${fixture.actionId}`);
      directDependencyIds.push(runbookResourceId);
    }
    if (fixture.requestedActionClass === 'B') directDependencyIds.push('command-owner');
    if (fixture.graduationTargetInstanceId !== null) {
      const targetResourceId = targetAuthorityResourceId(
        fixture.graduationTargetInstanceId.replace(/^AI_OPS_GRADUATION_TARGET_/, '').replace(/_V1$/, ''),
      );
      if (!targetResourceIds.has(targetResourceId)) throw new TypeError(`missing fixture authority target: ${fixture.fixtureId}`);
      directDependencyIds.push(targetResourceId);
    }
    return authorityResource(
      actionFixtureAuthorityResourceId(fixture.requestedActionClass),
      'FIXTURE',
      `fixtures/aiOps/a1/action-class-fixture-instances.v1.json#${fixture.fixtureId}`,
      sha256Canonical(fixture),
      evidenceRevision,
      sortedUnique(directDependencyIds),
      fixture.requestedActionClass,
      fixture.requestedActionClass === 'D' ? [fixture.actionId] : [],
      fixture.requestedActionClass === 'A' ? `AI_OPS_ACTION_${fixture.actionId}` : null,
      fixture.hardDenialIds,
    );
  });

  const resources = immutableClone([
    identityDraftResource,
    reliabilityDraftResource,
    ...targetResources,
    ...runbookResources,
    ...actionFixtureResources,
  ]);
  const roots: readonly Readonly<AiOpsAuthorityRootDescriptor>[] = immutableClone([
    ...AI_OPS_CAPABILITY_GRADUATION_TARGET_INSTANCES.map((target) => ({
      rootKind: 'GRADUATION_TARGET' as const,
      rootResourceId: targetAuthorityResourceId(target.capabilityId),
      declaredActionClass: 'C' as const,
    })),
    ...AI_OPS_RUNBOOK_MANIFEST_INSTANCES.map((runbook) => ({
      rootKind: 'RUNBOOK' as const,
      rootResourceId: runbookAuthorityResourceId(runbook.actionId),
      declaredActionClass: 'A' as const,
    })),
    ...AI_OPS_ACTION_CLASS_FIXTURE_INSTANCES.map((fixture) => ({
      rootKind: 'ACTION_FIXTURE' as const,
      rootResourceId: actionFixtureAuthorityResourceId(fixture.requestedActionClass),
      declaredActionClass: fixture.requestedActionClass,
    })),
  ]);
  return immutableClone({ resources, roots });
}

export function generateA1xMechanicalAuthorityManifestSet(
  sourceRevision: string,
  baseResources: readonly Readonly<AiOpsClassificationResource>[],
  evidenceRevision = sourceRevision,
): Readonly<AiOpsMechanicalAuthorityManifestSet> {
  const authorityInputs = createA1xAuthorityClassificationResources(evidenceRevision);
  const classification = generateClassificationManifest(
    sourceRevision,
    immutableClone([...baseResources, ...authorityInputs.resources]),
  );
  const entriesById = new Map(classification.entries.map((entry) => [entry.resourceId, entry]));
  const rootManifests = authorityInputs.roots.map((root): AiOpsMechanicalAuthorityManifestInstance => {
    const entry = entriesById.get(root.rootResourceId);
    if (entry === undefined) throw new TypeError(`authority root classification missing: ${root.rootResourceId}`);
    return {
      schema: 'AI_OPS_MECHANICAL_AUTHORITY_MANIFEST_INSTANCE_V1',
      rootKind: root.rootKind,
      rootResourceId: root.rootResourceId,
      declaredActionClass: root.declaredActionClass,
      effectiveActionClass: entry.actionClass,
      directDependencyIds: entry.directDependencyIds,
      transitiveDependencyIds: entry.transitiveDependencyIds,
      unresolvedDependencyIds: entry.unresolvedDependencyIds,
      cycleMemberIds: entry.cycleMemberIds,
      hardDenialIds: entry.hardDenialIds,
      reasonCodes: entry.reasonCodes,
      entryDigest: sha256Canonical(entry),
      authorityCreated: false,
    };
  });
  const unsignedPayload = {
    schema: 'AI_OPS_MECHANICAL_AUTHORITY_MANIFEST_SET_V1' as const,
    sourceRevision,
    shadowA1SealedSha: AI_OPS_SHADOW_A1_SEALED_SHA,
    portBaseSha: AI_OPS_PORT_BASE_SHA,
    algorithm: 'REUSED_SORTED_DFS_TRANSITIVE_CLOSURE_V1' as const,
    identityDraft: AI_OPS_PRESTAGE_DRAFT_REFERENCES.identity,
    reliabilityDraft: AI_OPS_PRESTAGE_DRAFT_REFERENCES.reliabilityTargets,
    classificationInputDigest: classification.inputDigest,
    classificationManifestDigest: classification.manifestDigest,
    classification,
    rootManifests,
    state: 'SHADOW_SPECULATIVE' as const,
    activationState: 'UNSIGNED_INACTIVE' as const,
    operationalAuthorityCreated: false as const,
  };
  const unsignedPayloadDigest = sha256Canonical(unsignedPayload);
  return immutableClone({
    ...unsignedPayload,
    unsignedPayloadDigest,
    ownerSignature: createAiOpsOwnerSignaturePlaceholder(unsignedPayloadDigest),
  });
}
