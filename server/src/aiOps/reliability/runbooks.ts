import { AI_OPS_ACTION_CLASS_DEFINITIONS } from '../policy/authority.js';
import { AI_OPS_ARTIFACT_CREATED_AT_MS, canonicalPolicyJson, canonicalPolicySnapshot, exactKeys, immutableClone, isBoundedId, isCanonicalBase64Url, isDenseArray, isPlainRecord, isSha256, sha256Canonical, sortedUnique } from '../contracts/shared.js';

export const AI_OPS_CLASS_A_ACTION_IDS = Object.freeze(
  AI_OPS_ACTION_CLASS_DEFINITIONS.find((row) => row.actionClass === 'A')?.eligibleActions ?? [],
);

export interface AiOpsNumericalGraduationTarget {
  readonly capabilityId: string;
  readonly minimumLabeledCases: number;
  readonly minimumShadowRuns: number;
  readonly minimumSuccessfulRuns: number;
  readonly minimumSuccessRatePermillion: number;
  readonly maximumFailureRatePermillion: number;
  readonly minimumReplayPassRatePermillion: number;
  readonly maximumFalsePositiveRatePermillion: number;
  readonly maximumFalseRepairRatePermillion: number;
  readonly minimumCalibrationScorePermillion: number;
  readonly minimumAbstentionPrecisionPermillion: number;
  readonly maximumRollbackRatePermillion: number;
  readonly maximumRecurrenceRatePermillion: number;
  readonly minimumEvidenceCompletenessPermillion: number;
  readonly maximumUnresolvedSeverityRank: number;
  readonly maximumP99LatencyMs: number;
  readonly maximumConsecutiveFailures: number;
  readonly maximumRetryAttemptsPerIncident: number;
  readonly maximumResourceBytesPerRun: number;
  readonly maximumCostMicrounitsPerRun: number;
  readonly minimumQuietPeriodMs: number;
  readonly maximumRecurrenceCount: number;
  readonly targetRevision: 1;
}

export interface AiOpsRunbookTemplate {
  readonly schema: 'AI_OPS_RUNBOOK_MANIFEST_TEMPLATE_V1';
  readonly runbookId: string;
  readonly revision: 1;
  readonly owner: 'PRODUCT_ASSURANCE_REMEDIATION_OWNER_REQUIRED';
  readonly actionId: string;
  readonly actionClass: 'A';
  readonly registrationState: 'INSERTION_REQUEST_ONLY';
  readonly triggerIds: readonly string[];
  readonly eligibleFingerprintPatterns: readonly string[];
  readonly preconditionIds: readonly string[];
  readonly typedParameterSchema: Readonly<{ readonly type: 'object'; readonly additionalProperties: false; readonly required: readonly string[]; readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>> }>;
  readonly idempotencyKeyFields: readonly string[];
  readonly leaseRequired: true;
  readonly fencingRequired: true;
  readonly conflictGraphIds: readonly string[];
  readonly maximumAttempts: number;
  readonly maximumEffects: number;
  readonly maximumDurationMs: number;
  readonly maximumBlastRadiusResources: number;
  readonly rollbackOrCompensationId: string;
  readonly independentPostconditionIds: readonly string[];
  readonly manualFallbackId: string;
  readonly requiredTelemetryIds: readonly string[];
  readonly requiredEvidenceIds: readonly string[];
  readonly expiresAtMs: number;
  readonly revocationState: 'UNSIGNED_INACTIVE';
  readonly recurrenceEscalationClass: 'B';
  readonly graduationTarget: Readonly<AiOpsNumericalGraduationTarget>;
  readonly ownerSignature: null;
  readonly ownerSignatureState: 'OWNER_SIGNATURE_REQUIRED';
  readonly authorityCreated: false;
}

const COMMON_GRADUATION_TARGETS = Object.freeze({
  minimumLabeledCases: 500,
  minimumReplayPassRatePermillion: 999_000,
  maximumFalsePositiveRatePermillion: 1_000,
  maximumFalseRepairRatePermillion: 0,
  minimumCalibrationScorePermillion: 950_000,
  minimumAbstentionPrecisionPermillion: 990_000,
  maximumRollbackRatePermillion: 1_000,
  maximumRecurrenceRatePermillion: 5_000,
  minimumEvidenceCompletenessPermillion: 1_000_000,
  maximumUnresolvedSeverityRank: 0,
});

const TARGETS: Readonly<Record<string, Omit<AiOpsNumericalGraduationTarget, 'capabilityId' | 'targetRevision'>>> = Object.freeze({
  RECONNECT_STREAM: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 500, minimumSuccessfulRuns: 499, minimumSuccessRatePermillion: 998_000, maximumFailureRatePermillion: 2_000, maximumP99LatencyMs: 5_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 3, maximumResourceBytesPerRun: 2_000_000, maximumCostMicrounitsPerRun: 0, minimumQuietPeriodMs: 3_600_000, maximumRecurrenceCount: 2 },
  RESUBSCRIBE_REPLAY_SAFE: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 500, minimumSuccessfulRuns: 499, minimumSuccessRatePermillion: 998_000, maximumFailureRatePermillion: 2_000, maximumP99LatencyMs: 8_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 2, maximumResourceBytesPerRun: 4_000_000, maximumCostMicrounitsPerRun: 0, minimumQuietPeriodMs: 3_600_000, maximumRecurrenceCount: 2 },
  RESNAPSHOT_READ_MODEL: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 1_000, minimumSuccessfulRuns: 999, minimumSuccessRatePermillion: 999_000, maximumFailureRatePermillion: 1_000, maximumP99LatencyMs: 15_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 2, maximumResourceBytesPerRun: 16_000_000, maximumCostMicrounitsPerRun: 0, minimumQuietPeriodMs: 7_200_000, maximumRecurrenceCount: 1 },
  REFRESH_BOUNDED_METADATA_CACHE: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 750, minimumSuccessfulRuns: 749, minimumSuccessRatePermillion: 998_666, maximumFailureRatePermillion: 1_334, maximumP99LatencyMs: 10_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 2, maximumResourceBytesPerRun: 8_000_000, maximumCostMicrounitsPerRun: 0, minimumQuietPeriodMs: 3_600_000, maximumRecurrenceCount: 2 },
  REBUILD_BOUNDED_DERIVED_CACHE: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 1_000, minimumSuccessfulRuns: 999, minimumSuccessRatePermillion: 999_000, maximumFailureRatePermillion: 1_000, maximumP99LatencyMs: 30_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 1, maximumResourceBytesPerRun: 64_000_000, maximumCostMicrounitsPerRun: 0, minimumQuietPeriodMs: 14_400_000, maximumRecurrenceCount: 1 },
  RESTART_CLASSIFIED_STATELESS_CHILD: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 2_000, minimumSuccessfulRuns: 1_999, minimumSuccessRatePermillion: 999_500, maximumFailureRatePermillion: 500, maximumP99LatencyMs: 20_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 1, maximumResourceBytesPerRun: 16_000_000, maximumCostMicrounitsPerRun: 0, minimumQuietPeriodMs: 21_600_000, maximumRecurrenceCount: 1 },
  ROTATE_STUCK_LOCAL_DIAGNOSTIC_WORKER: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 2_000, minimumSuccessfulRuns: 1_999, minimumSuccessRatePermillion: 999_500, maximumFailureRatePermillion: 500, maximumP99LatencyMs: 30_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 1, maximumResourceBytesPerRun: 32_000_000, maximumCostMicrounitsPerRun: 250_000, minimumQuietPeriodMs: 21_600_000, maximumRecurrenceCount: 1 },
  COLLECT_BOUNDED_DIAGNOSTIC_BUNDLE: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 1_000, minimumSuccessfulRuns: 999, minimumSuccessRatePermillion: 999_000, maximumFailureRatePermillion: 1_000, maximumP99LatencyMs: 20_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 1, maximumResourceBytesPerRun: 32_000_000, maximumCostMicrounitsPerRun: 0, minimumQuietPeriodMs: 7_200_000, maximumRecurrenceCount: 2 },
  RERUN_SAFE_READ_ONLY_RECONCILIATION_QUERY: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 2_500, minimumSuccessfulRuns: 2_499, minimumSuccessRatePermillion: 999_600, maximumFailureRatePermillion: 400, maximumP99LatencyMs: 15_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 1, maximumResourceBytesPerRun: 8_000_000, maximumCostMicrounitsPerRun: 0, minimumQuietPeriodMs: 21_600_000, maximumRecurrenceCount: 1 },
  REPAIR_LOCAL_OBSERVATION_SUBSCRIPTION: { ...COMMON_GRADUATION_TARGETS, minimumShadowRuns: 2_500, minimumSuccessfulRuns: 2_499, minimumSuccessRatePermillion: 999_600, maximumFailureRatePermillion: 400, maximumP99LatencyMs: 10_000, maximumConsecutiveFailures: 1, maximumRetryAttemptsPerIncident: 1, maximumResourceBytesPerRun: 8_000_000, maximumCostMicrounitsPerRun: 0, minimumQuietPeriodMs: 21_600_000, maximumRecurrenceCount: 1 },
});

function makeTemplate(actionId: string): AiOpsRunbookTemplate {
  const target = TARGETS[actionId];
  if (!target) throw new TypeError(`missing graduation target: ${actionId}`);
  return {
    schema: 'AI_OPS_RUNBOOK_MANIFEST_TEMPLATE_V1',
    runbookId: `AI_OPS_RUNBOOK_${actionId}`,
    revision: 1,
    owner: 'PRODUCT_ASSURANCE_REMEDIATION_OWNER_REQUIRED',
    actionId,
    actionClass: 'A',
    registrationState: 'INSERTION_REQUEST_ONLY',
    triggerIds: [`AI_OPS_TRIGGER_${actionId}`],
    eligibleFingerprintPatterns: [`AI_OPS_FINGERPRINT_${actionId}_V1`],
    preconditionIds: ['AI_OPS_PRECONDITION_SHADOW_MODE', `AI_OPS_PRECONDITION_${actionId}_BOUNDED`],
    typedParameterSchema: { type: 'object', additionalProperties: false, required: ['resourceId'], properties: { resourceId: { type: 'string', minLength: 1, maxLength: 192 } } },
    idempotencyKeyFields: ['incidentId', 'actionId', 'resourceId', 'policyRevision'],
    leaseRequired: true,
    fencingRequired: true,
    conflictGraphIds: [`AI_OPS_CONFLICT_GRAPH_${actionId}`],
    maximumAttempts: target.maximumRetryAttemptsPerIncident,
    maximumEffects: 1,
    maximumDurationMs: target.maximumP99LatencyMs * 2,
    maximumBlastRadiusResources: 1,
    rollbackOrCompensationId: `AI_OPS_COMPENSATE_${actionId}`,
    independentPostconditionIds: [`AI_OPS_POSTCONDITION_${actionId}`, 'AI_OPS_POSTCONDITION_NO_CAPITAL_EFFECT'],
    manualFallbackId: `AI_OPS_MANUAL_FALLBACK_${actionId}`,
    requiredTelemetryIds: [`AI_OPS_TELEMETRY_${actionId}`, 'AI_OPS_TELEMETRY_CAPITAL_EFFECT_NONE'],
    requiredEvidenceIds: ['AI_OPS_EVIDENCE_TRIGGER', 'AI_OPS_EVIDENCE_PRECONDITION', 'AI_OPS_EVIDENCE_POSTCONDITION', 'AI_OPS_EVIDENCE_QUIET_PERIOD'],
    expiresAtMs: AI_OPS_ARTIFACT_CREATED_AT_MS + 31_536_000_000,
    revocationState: 'UNSIGNED_INACTIVE',
    recurrenceEscalationClass: 'B',
    graduationTarget: { capabilityId: actionId, ...target, targetRevision: 1 },
    ownerSignature: null,
    ownerSignatureState: 'OWNER_SIGNATURE_REQUIRED',
    authorityCreated: false,
  };
}

export const AI_OPS_RUNBOOK_TEMPLATES: readonly Readonly<AiOpsRunbookTemplate>[] = immutableClone(
  AI_OPS_CLASS_A_ACTION_IDS.map(makeTemplate),
);

export interface AiOpsCapabilityReliabilityTarget {
  readonly targetKind: 'RUNBOOK' | 'PROMPT_REVISION' | 'PROVIDER_ROUTE' | 'MODEL_REVISION' | 'PATCH_CATEGORY';
  readonly target: Readonly<AiOpsNumericalGraduationTarget>;
  readonly ownerSignature: null;
  readonly ownerSignatureState: 'OWNER_SIGNATURE_REQUIRED';
  readonly activationState: 'UNSIGNED_INACTIVE';
  readonly authorityCreated: false;
}

const AUXILIARY_CAPABILITY_TARGETS = Object.freeze([
  ['PROMPT_REVISION', 'PROMPT_REVISION_INCIDENT_DIAGNOSIS'],
  ['PROVIDER_ROUTE', 'PROVIDER_ROUTE_RUNTIME_DIAGNOSTIC'],
  ['MODEL_REVISION', 'MODEL_REVISION_RUNTIME_DIAGNOSTIC'],
  ['PATCH_CATEGORY', 'PATCH_CATEGORY_CODE_AND_TEST'],
  ['PATCH_CATEGORY', 'PATCH_CATEGORY_UI'],
  ['PATCH_CATEGORY', 'PATCH_CATEGORY_ALGORITHM_FEATURE_MODEL'],
  ['PATCH_CATEGORY', 'PATCH_CATEGORY_RUNBOOK_POLICY'],
] as const);

const AUXILIARY_NUMERICAL_TARGET = Object.freeze({
  ...COMMON_GRADUATION_TARGETS,
  minimumLabeledCases: 1_000,
  minimumShadowRuns: 5_000,
  minimumSuccessfulRuns: 4_999,
  minimumSuccessRatePermillion: 999_800,
  maximumFailureRatePermillion: 200,
  minimumReplayPassRatePermillion: 999_800,
  maximumFalsePositiveRatePermillion: 200,
  maximumFalseRepairRatePermillion: 0,
  minimumCalibrationScorePermillion: 975_000,
  minimumAbstentionPrecisionPermillion: 995_000,
  maximumRollbackRatePermillion: 200,
  maximumRecurrenceRatePermillion: 0,
  minimumEvidenceCompletenessPermillion: 1_000_000,
  maximumUnresolvedSeverityRank: 0,
  maximumP99LatencyMs: 60_000,
  maximumConsecutiveFailures: 1,
  maximumRetryAttemptsPerIncident: 1,
  maximumResourceBytesPerRun: 64_000_000,
  maximumCostMicrounitsPerRun: 250_000,
  minimumQuietPeriodMs: 86_400_000,
  maximumRecurrenceCount: 0,
});

export const AI_OPS_CAPABILITY_RELIABILITY_TARGETS: readonly Readonly<AiOpsCapabilityReliabilityTarget>[] = immutableClone([
  ...AI_OPS_RUNBOOK_TEMPLATES.map((template) => ({
    targetKind: 'RUNBOOK' as const,
    target: template.graduationTarget,
    ownerSignature: null,
    ownerSignatureState: 'OWNER_SIGNATURE_REQUIRED' as const,
    activationState: 'UNSIGNED_INACTIVE' as const,
    authorityCreated: false as const,
  })),
  ...AUXILIARY_CAPABILITY_TARGETS.map(([targetKind, capabilityId]) => ({
    targetKind,
    target: { capabilityId, ...AUXILIARY_NUMERICAL_TARGET, targetRevision: 1 as const },
    ownerSignature: null,
    ownerSignatureState: 'OWNER_SIGNATURE_REQUIRED' as const,
    activationState: 'UNSIGNED_INACTIVE' as const,
    authorityCreated: false as const,
  })),
]);

export interface AiOpsGraduationEvidence {
  readonly runbookId: string;
  readonly capabilityId: string;
  readonly shadowRuns: number;
  readonly labeledCases: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly successRatePermillion: number;
  readonly failureRatePermillion: number;
  readonly replayPassRatePermillion: number;
  readonly falsePositiveRatePermillion: number;
  readonly falseRepairRatePermillion: number;
  readonly calibrationScorePermillion: number;
  readonly abstentionPrecisionPermillion: number;
  readonly rollbackRatePermillion: number;
  readonly evidenceCompletenessPermillion: number;
  readonly maximumUnresolvedSeverityRankObserved: number;
  readonly p99LatencyMs: number;
  readonly maximumConsecutiveFailuresObserved: number;
  readonly maximumRetryAttemptsObserved: number;
  readonly maximumResourceBytesObserved: number;
  readonly maximumCostMicrounitsObserved: number;
  readonly quietPeriodObservedMs: number;
  readonly recurrenceCount: number;
  readonly recurrenceRatePermillion: number;
  readonly evidenceDigest: string;
}

export function computeGraduationEvidenceDigest(
  evidence: Readonly<Omit<AiOpsGraduationEvidence, 'evidenceDigest'>>,
): string {
  return sha256Canonical(evidence);
}

export interface AiOpsOwnerSignatureEnvelope {
  readonly schema: 'AI_OPS_OWNER_SIGNATURE_V1';
  readonly signatureId: string;
  readonly signedPayloadDigest: string;
  readonly signerRole: 'AI_OPS_OWNER';
  readonly algorithm: 'ED25519' | 'ES256';
  readonly keyReference: string;
  readonly signatureBytesBase64Url: string;
  readonly policyRevision: number;
  readonly expiresAtMs: number;
}

export interface AiOpsOwnerSignatureVerifier {
  verify(signature: Readonly<AiOpsOwnerSignatureEnvelope>, payloadBytes: Uint8Array): boolean;
}

export interface AiOpsGraduationEvidenceVerification {
  readonly profile: 'LEDGER_GRADUATION_EVIDENCE_READBACK_V1';
  readonly verified: boolean;
  readonly evidenceDigest: string;
  readonly runbookId: string;
  readonly capabilityId: string;
  readonly labeledCaseCount: number;
  readonly shadowRunCount: number;
  readonly evidenceReceiptReference: string;
}

export interface AiOpsGraduationEvidenceVerifier {
  verifyEvidence(evidence: Readonly<AiOpsGraduationEvidence>): Readonly<AiOpsGraduationEvidenceVerification>;
}

export interface AiOpsRunbookGraduationDecision {
  readonly eligible: boolean;
  readonly meetsNumericalAndSignatureRequirements: boolean;
  readonly reasonCodes: readonly string[];
  readonly runbookDigest: string;
  readonly evidenceDigest: string;
  readonly evidenceVerified: boolean;
  readonly ownerSignatureVerified: boolean;
  readonly candidateValidatedForPortRecheck: boolean;
  readonly authorityGranted: false;
  readonly state: 'SHADOW_SPECULATIVE';
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0;
}

const AI_OPS_PERMILLION_MAXIMUM = 1_000_000;
const AI_OPS_RUN_COUNT_MAXIMUM = 1_000_000_000;
const AI_OPS_MEASUREMENT_MAXIMUM = 1_000_000_000_000;
const AI_OPS_CONTRACT_ARRAY_MAXIMUM = 64;

const GRADUATION_TARGET_KEYS = [
  'capabilityId', 'minimumLabeledCases', 'minimumShadowRuns', 'minimumSuccessfulRuns',
  'minimumSuccessRatePermillion', 'maximumFailureRatePermillion', 'minimumReplayPassRatePermillion',
  'maximumFalsePositiveRatePermillion', 'maximumFalseRepairRatePermillion', 'minimumCalibrationScorePermillion',
  'minimumAbstentionPrecisionPermillion', 'maximumRollbackRatePermillion', 'maximumRecurrenceRatePermillion', 'minimumEvidenceCompletenessPermillion',
  'maximumUnresolvedSeverityRank', 'maximumP99LatencyMs', 'maximumConsecutiveFailures',
  'maximumRetryAttemptsPerIncident', 'maximumResourceBytesPerRun', 'maximumCostMicrounitsPerRun',
  'minimumQuietPeriodMs', 'maximumRecurrenceCount', 'targetRevision',
] as const;

const RUNBOOK_TEMPLATE_KEYS = [
  'schema', 'runbookId', 'revision', 'owner', 'actionId', 'actionClass', 'registrationState', 'triggerIds',
  'eligibleFingerprintPatterns', 'preconditionIds', 'typedParameterSchema', 'idempotencyKeyFields',
  'leaseRequired', 'fencingRequired', 'conflictGraphIds', 'maximumAttempts', 'maximumEffects',
  'maximumDurationMs', 'maximumBlastRadiusResources', 'rollbackOrCompensationId',
  'independentPostconditionIds', 'manualFallbackId', 'requiredTelemetryIds', 'requiredEvidenceIds',
  'expiresAtMs', 'revocationState', 'recurrenceEscalationClass', 'graduationTarget', 'ownerSignature',
  'ownerSignatureState', 'authorityCreated',
] as const;

const GRADUATION_EVIDENCE_KEYS = [
  'runbookId', 'capabilityId', 'shadowRuns', 'labeledCases', 'successfulRuns', 'failedRuns',
  'successRatePermillion', 'failureRatePermillion', 'replayPassRatePermillion', 'falsePositiveRatePermillion',
  'falseRepairRatePermillion', 'calibrationScorePermillion', 'abstentionPrecisionPermillion', 'rollbackRatePermillion',
  'evidenceCompletenessPermillion', 'maximumUnresolvedSeverityRankObserved', 'p99LatencyMs',
  'maximumConsecutiveFailuresObserved', 'maximumRetryAttemptsObserved', 'maximumResourceBytesObserved',
  'maximumCostMicrounitsObserved', 'quietPeriodObservedMs', 'recurrenceCount', 'recurrenceRatePermillion', 'evidenceDigest',
] as const;

const OWNER_SIGNATURE_KEYS = [
  'schema', 'signatureId', 'signedPayloadDigest', 'signerRole', 'algorithm', 'keyReference',
  'signatureBytesBase64Url', 'policyRevision', 'expiresAtMs',
] as const;
const EVIDENCE_VERIFICATION_KEYS = ['profile', 'verified', 'evidenceDigest', 'runbookId', 'capabilityId', 'labeledCaseCount', 'shadowRunCount', 'evidenceReceiptReference'] as const;

const RATE_TARGET_KEYS = [
  'minimumSuccessRatePermillion', 'maximumFailureRatePermillion', 'minimumReplayPassRatePermillion',
  'maximumFalsePositiveRatePermillion', 'maximumFalseRepairRatePermillion', 'minimumCalibrationScorePermillion',
  'minimumAbstentionPrecisionPermillion', 'maximumRollbackRatePermillion', 'maximumRecurrenceRatePermillion', 'minimumEvidenceCompletenessPermillion',
] as const;

const RATE_EVIDENCE_KEYS = [
  'successRatePermillion', 'failureRatePermillion', 'replayPassRatePermillion', 'falsePositiveRatePermillion',
  'falseRepairRatePermillion', 'calibrationScorePermillion', 'abstentionPrecisionPermillion', 'rollbackRatePermillion',
  'recurrenceRatePermillion', 'evidenceCompletenessPermillion',
] as const;

function isBoundedIdArray(value: unknown, minimumLength = 0): value is readonly string[] {
  return isDenseArray(value)
    && value.length >= minimumLength
    && value.length <= AI_OPS_CONTRACT_ARRAY_MAXIMUM
    && Array.from(value).every(isBoundedId)
    && new Set(value).size === value.length;
}

function isBoundedReference(value: unknown, prefix: string): value is string {
  return isBoundedId(value)
    && value.startsWith(prefix)
    && isBoundedId(value.slice(prefix.length));
}

function isValidGraduationTarget(value: unknown): value is AiOpsNumericalGraduationTarget {
  if (!exactKeys(value, GRADUATION_TARGET_KEYS) || !isBoundedId(value.capabilityId)) return false;
  if (value.targetRevision !== 1) return false;
  for (const key of RATE_TARGET_KEYS) {
    const metric = value[key];
    if (!isNonNegativeFinite(metric as number) || (metric as number) > AI_OPS_PERMILLION_MAXIMUM) return false;
  }
  const countKeys = ['minimumLabeledCases', 'minimumShadowRuns', 'minimumSuccessfulRuns'] as const;
  if (countKeys.some((key) => !isNonNegativeFinite(value[key] as number) || (value[key] as number) > AI_OPS_RUN_COUNT_MAXIMUM)) return false;
  if (countKeys.some((key) => (value[key] as number) < 1)) return false;
  const remainingKeys = [
    'maximumUnresolvedSeverityRank', 'maximumP99LatencyMs', 'maximumConsecutiveFailures',
    'maximumRetryAttemptsPerIncident', 'maximumResourceBytesPerRun', 'maximumCostMicrounitsPerRun',
    'minimumQuietPeriodMs', 'maximumRecurrenceCount',
  ] as const;
  return remainingKeys.every((key) => isNonNegativeFinite(value[key] as number) && (value[key] as number) <= AI_OPS_MEASUREMENT_MAXIMUM)
    && (value.minimumSuccessfulRuns as number) <= (value.minimumShadowRuns as number)
    && (value.minimumSuccessRatePermillion as number) + (value.maximumFailureRatePermillion as number) === AI_OPS_PERMILLION_MAXIMUM;
}

function isClosedAiOpsRunbookTemplateSnapshot(value: unknown): value is AiOpsRunbookTemplate {
  if (!exactKeys(value, RUNBOOK_TEMPLATE_KEYS)) return false;
  if (
    value.schema !== 'AI_OPS_RUNBOOK_MANIFEST_TEMPLATE_V1'
    || value.revision !== 1
    || value.owner !== 'PRODUCT_ASSURANCE_REMEDIATION_OWNER_REQUIRED'
    || !isBoundedId(value.runbookId)
    || !isBoundedId(value.actionId)
    || !AI_OPS_CLASS_A_ACTION_IDS.includes(value.actionId as string)
    || value.runbookId !== `AI_OPS_RUNBOOK_${value.actionId}`
    || value.actionClass !== 'A'
    || value.registrationState !== 'INSERTION_REQUEST_ONLY'
    || value.leaseRequired !== true
    || value.fencingRequired !== true
    || value.revocationState !== 'UNSIGNED_INACTIVE'
    || value.recurrenceEscalationClass !== 'B'
    || value.ownerSignature !== null
    || value.ownerSignatureState !== 'OWNER_SIGNATURE_REQUIRED'
    || value.authorityCreated !== false
    || !isNonNegativeFinite(value.expiresAtMs as number)
  ) return false;
  for (const arrayKey of ['triggerIds', 'eligibleFingerprintPatterns', 'preconditionIds', 'idempotencyKeyFields', 'conflictGraphIds', 'independentPostconditionIds', 'requiredTelemetryIds', 'requiredEvidenceIds'] as const) {
    if (!isBoundedIdArray(value[arrayKey], 1)) return false;
  }
  for (const idKey of ['rollbackOrCompensationId', 'manualFallbackId'] as const) {
    if (!isBoundedId(value[idKey])) return false;
  }
  for (const boundKey of ['maximumAttempts', 'maximumEffects', 'maximumDurationMs', 'maximumBlastRadiusResources'] as const) {
    if (!isNonNegativeFinite(value[boundKey] as number) || (value[boundKey] as number) < 1 || (value[boundKey] as number) > AI_OPS_MEASUREMENT_MAXIMUM) return false;
  }
  if (!exactKeys(value.typedParameterSchema, ['type', 'additionalProperties', 'required', 'properties'])) return false;
  if (value.typedParameterSchema.type !== 'object' || value.typedParameterSchema.additionalProperties !== false || !isBoundedIdArray(value.typedParameterSchema.required, 1)) return false;
  if (!isPlainRecord(value.typedParameterSchema.properties) || Object.keys(value.typedParameterSchema.properties).length > AI_OPS_CONTRACT_ARRAY_MAXIMUM) return false;
  const propertyNames = Object.keys(value.typedParameterSchema.properties).sort();
  if (propertyNames.length !== 1 || propertyNames[0] !== 'resourceId' || value.typedParameterSchema.required.length !== 1 || value.typedParameterSchema.required[0] !== 'resourceId') return false;
  if (Object.entries(value.typedParameterSchema.properties).some(([key, schema]) => {
    if (!isBoundedId(key) || !exactKeys(schema, ['type', 'minLength', 'maxLength'])) return true;
    return schema.type !== 'string'
      || !Number.isSafeInteger(schema.minLength)
      || (schema.minLength as number) < 1
      || !Number.isSafeInteger(schema.maxLength)
      || (schema.maxLength as number) < (schema.minLength as number)
      || (schema.maxLength as number) > 4096;
  })) return false;
  return isValidGraduationTarget(value.graduationTarget) && value.graduationTarget.capabilityId === value.actionId;
}

export function isClosedAiOpsRunbookTemplate(value: unknown): value is AiOpsRunbookTemplate {
  try {
    return isClosedAiOpsRunbookTemplateSnapshot(canonicalPolicySnapshot(value));
  } catch {
    return false;
  }
}

function isClosedGraduationEvidence(value: unknown): value is AiOpsGraduationEvidence {
  if (!exactKeys(value, GRADUATION_EVIDENCE_KEYS) || !isBoundedId(value.runbookId) || !isBoundedId(value.capabilityId) || !isSha256(value.evidenceDigest)) return false;
  for (const key of RATE_EVIDENCE_KEYS) {
    const metric = value[key];
    if (!isNonNegativeFinite(metric as number) || (metric as number) > AI_OPS_PERMILLION_MAXIMUM) return false;
  }
  const countKeys = ['shadowRuns', 'labeledCases', 'successfulRuns', 'failedRuns'] as const;
  if (countKeys.some((key) => !isNonNegativeFinite(value[key] as number) || (value[key] as number) > AI_OPS_RUN_COUNT_MAXIMUM)) return false;
  const remainingKeys = [
    'maximumUnresolvedSeverityRankObserved', 'p99LatencyMs', 'maximumConsecutiveFailuresObserved',
    'maximumRetryAttemptsObserved', 'maximumResourceBytesObserved', 'maximumCostMicrounitsObserved',
    'quietPeriodObservedMs', 'recurrenceCount',
  ] as const;
  if (!remainingKeys.every((key) => isNonNegativeFinite(value[key] as number) && (value[key] as number) <= AI_OPS_MEASUREMENT_MAXIMUM)) return false;
  const { evidenceDigest, ...evidenceBody } = value;
  return computeGraduationEvidenceDigest(evidenceBody as unknown as Omit<AiOpsGraduationEvidence, 'evidenceDigest'>) === evidenceDigest;
}

function isClosedOwnerSignature(value: unknown): value is AiOpsOwnerSignatureEnvelope {
  return exactKeys(value, OWNER_SIGNATURE_KEYS)
    && value.schema === 'AI_OPS_OWNER_SIGNATURE_V1'
    && isBoundedId(value.signatureId)
    && isSha256(value.signedPayloadDigest)
    && value.signerRole === 'AI_OPS_OWNER'
    && (value.algorithm === 'ED25519' || value.algorithm === 'ES256')
    && isBoundedReference(value.keyReference, 'owner-key-ref://')
    && isCanonicalBase64Url(value.signatureBytesBase64Url, 16, 4096)
    && Number.isSafeInteger(value.policyRevision)
    && (value.policyRevision as number) >= 1
    && isNonNegativeFinite(value.expiresAtMs as number);
}

function ownerSignatureVerificationPayload(
  signedPayload: Readonly<{ readonly template: Readonly<AiOpsRunbookTemplate>; readonly evidence: Readonly<AiOpsGraduationEvidence> }>,
  signature: Readonly<AiOpsOwnerSignatureEnvelope>,
): Readonly<Record<string, unknown>> {
  return {
    signedPayload,
    signatureBinding: {
      schema: signature.schema,
      signatureId: signature.signatureId,
      signedPayloadDigest: signature.signedPayloadDigest,
      signerRole: signature.signerRole,
      algorithm: signature.algorithm,
      keyReference: signature.keyReference,
      policyRevision: signature.policyRevision,
      expiresAtMs: signature.expiresAtMs,
    },
  };
}

export function evaluateRunbookGraduation(
  templateInput: Readonly<AiOpsRunbookTemplate>,
  evidenceInput: Readonly<AiOpsGraduationEvidence>,
  ownerSignatureInput: Readonly<AiOpsOwnerSignatureEnvelope> | null,
  verifier: Readonly<AiOpsOwnerSignatureVerifier> | null,
  nowMs: number,
  evidenceVerifier: Readonly<AiOpsGraduationEvidenceVerifier> | null = null,
): Readonly<AiOpsRunbookGraduationDecision> {
  const reasons: string[] = [];
  let template: Readonly<AiOpsRunbookTemplate>;
  let evidence: Readonly<AiOpsGraduationEvidence>;
  let ownerSignature: Readonly<AiOpsOwnerSignatureEnvelope> | null;
  try {
    template = canonicalPolicySnapshot(templateInput);
    evidence = canonicalPolicySnapshot(evidenceInput);
    ownerSignature = ownerSignatureInput === null ? null : canonicalPolicySnapshot(ownerSignatureInput);
  } catch {
    return immutableClone({
      eligible: false,
      meetsNumericalAndSignatureRequirements: false,
      reasonCodes: ['GRADUATION_INPUT_SNAPSHOT_INVALID', 'SHADOW_SPECULATIVE_CANNOT_GRANT_AUTHORITY'],
      runbookDigest: sha256Canonical({ invalidContract: 'AI_OPS_RUNBOOK_OR_EVIDENCE' }),
      evidenceDigest: '0'.repeat(64),
      evidenceVerified: false,
      ownerSignatureVerified: false,
      candidateValidatedForPortRecheck: false,
      authorityGranted: false as const,
      state: 'SHADOW_SPECULATIVE' as const,
    });
  }
  if (!isClosedAiOpsRunbookTemplate(template)) reasons.push('RUNBOOK_TEMPLATE_SCHEMA_INVALID');
  if (!isClosedGraduationEvidence(evidence)) reasons.push('GRADUATION_EVIDENCE_SCHEMA_INVALID');
  if (reasons.length > 0) {
    return immutableClone({
      eligible: false,
      meetsNumericalAndSignatureRequirements: false,
      reasonCodes: sortedUnique([...reasons, 'SHADOW_SPECULATIVE_CANNOT_GRANT_AUTHORITY']),
      runbookDigest: sha256Canonical({ invalidContract: 'AI_OPS_RUNBOOK_OR_EVIDENCE' }),
      evidenceDigest: isSha256((evidence as unknown as Record<string, unknown>)?.evidenceDigest)
        ? (evidence as unknown as Record<string, string>).evidenceDigest
        : '0'.repeat(64),
      evidenceVerified: false,
      ownerSignatureVerified: false,
      candidateValidatedForPortRecheck: false,
      authorityGranted: false as const,
      state: 'SHADOW_SPECULATIVE' as const,
    });
  }
  const target = template.graduationTarget;
  const numericValues = [evidence.shadowRuns, evidence.labeledCases, evidence.successfulRuns, evidence.failedRuns, evidence.successRatePermillion, evidence.failureRatePermillion, evidence.replayPassRatePermillion, evidence.falsePositiveRatePermillion, evidence.falseRepairRatePermillion, evidence.calibrationScorePermillion, evidence.abstentionPrecisionPermillion, evidence.rollbackRatePermillion, evidence.recurrenceRatePermillion, evidence.evidenceCompletenessPermillion, evidence.maximumUnresolvedSeverityRankObserved, evidence.p99LatencyMs, evidence.maximumConsecutiveFailuresObserved, evidence.maximumRetryAttemptsObserved, evidence.maximumResourceBytesObserved, evidence.maximumCostMicrounitsObserved, evidence.quietPeriodObservedMs, evidence.recurrenceCount];
  if (numericValues.some((value) => !isNonNegativeFinite(value))) reasons.push('NON_INTEGER_OR_NEGATIVE_EVIDENCE');
  if (!isNonNegativeFinite(nowMs)) reasons.push('EVALUATION_TIME_INVALID');
  if (evidence.runbookId !== template.runbookId || evidence.capabilityId !== target.capabilityId) reasons.push('EVIDENCE_BINDING_MISMATCH');
  if (!isSha256(evidence.evidenceDigest)) reasons.push('EVIDENCE_DIGEST_INVALID');
  if (evidence.shadowRuns !== evidence.successfulRuns + evidence.failedRuns) reasons.push('RUN_COUNT_INCONSISTENT');
  if (evidence.successRatePermillion + evidence.failureRatePermillion !== 1_000_000) reasons.push('CLAIMED_RATE_SUM_INCONSISTENT');
  if (evidence.shadowRuns > 0) {
    const derivedSuccessRate = Math.floor((evidence.successfulRuns * 1_000_000) / evidence.shadowRuns);
    const derivedFailureRate = 1_000_000 - derivedSuccessRate;
    if (evidence.successRatePermillion !== derivedSuccessRate || evidence.failureRatePermillion !== derivedFailureRate) reasons.push('CLAIMED_RATES_DO_NOT_MATCH_COUNTS');
    const derivedRecurrenceRate = Math.ceil((evidence.recurrenceCount * 1_000_000) / evidence.shadowRuns);
    if (evidence.recurrenceRatePermillion !== derivedRecurrenceRate) reasons.push('CLAIMED_RECURRENCE_RATE_DOES_NOT_MATCH_COUNTS');
  } else reasons.push('ZERO_SHADOW_RUNS_INVALID');
  if (evidence.labeledCases < target.minimumLabeledCases) reasons.push('MINIMUM_LABELED_CASES_NOT_MET');
  if (evidence.shadowRuns < target.minimumShadowRuns) reasons.push('MINIMUM_SHADOW_RUNS_NOT_MET');
  if (evidence.successfulRuns < target.minimumSuccessfulRuns) reasons.push('MINIMUM_SUCCESSFUL_RUNS_NOT_MET');
  if (evidence.successRatePermillion < target.minimumSuccessRatePermillion) reasons.push('SUCCESS_RATE_TARGET_NOT_MET');
  if (evidence.failureRatePermillion > target.maximumFailureRatePermillion) reasons.push('FAILURE_RATE_TARGET_EXCEEDED');
  if (evidence.replayPassRatePermillion < target.minimumReplayPassRatePermillion) reasons.push('REPLAY_PASS_RATE_TARGET_NOT_MET');
  if (evidence.falsePositiveRatePermillion > target.maximumFalsePositiveRatePermillion) reasons.push('FALSE_POSITIVE_TARGET_EXCEEDED');
  if (evidence.falseRepairRatePermillion > target.maximumFalseRepairRatePermillion) reasons.push('FALSE_REPAIR_TARGET_EXCEEDED');
  if (evidence.calibrationScorePermillion < target.minimumCalibrationScorePermillion) reasons.push('CALIBRATION_TARGET_NOT_MET');
  if (evidence.abstentionPrecisionPermillion < target.minimumAbstentionPrecisionPermillion) reasons.push('ABSTENTION_TARGET_NOT_MET');
  if (evidence.rollbackRatePermillion > target.maximumRollbackRatePermillion) reasons.push('ROLLBACK_RATE_TARGET_EXCEEDED');
  if (evidence.recurrenceRatePermillion > target.maximumRecurrenceRatePermillion) reasons.push('RECURRENCE_RATE_TARGET_EXCEEDED');
  if (evidence.evidenceCompletenessPermillion < target.minimumEvidenceCompletenessPermillion) reasons.push('EVIDENCE_COMPLETENESS_TARGET_NOT_MET');
  if (evidence.maximumUnresolvedSeverityRankObserved > target.maximumUnresolvedSeverityRank) reasons.push('UNRESOLVED_SEVERITY_TARGET_EXCEEDED');
  if (evidence.p99LatencyMs > target.maximumP99LatencyMs) reasons.push('P99_LATENCY_TARGET_EXCEEDED');
  if (evidence.maximumConsecutiveFailuresObserved > target.maximumConsecutiveFailures) reasons.push('CONSECUTIVE_FAILURE_TARGET_EXCEEDED');
  if (evidence.maximumRetryAttemptsObserved > target.maximumRetryAttemptsPerIncident) reasons.push('RETRY_TARGET_EXCEEDED');
  if (evidence.maximumResourceBytesObserved > target.maximumResourceBytesPerRun) reasons.push('RESOURCE_TARGET_EXCEEDED');
  if (evidence.maximumCostMicrounitsObserved > target.maximumCostMicrounitsPerRun) reasons.push('COST_TARGET_EXCEEDED');
  if (evidence.quietPeriodObservedMs < target.minimumQuietPeriodMs) reasons.push('QUIET_PERIOD_TARGET_NOT_MET');
  if (evidence.recurrenceCount > target.maximumRecurrenceCount) reasons.push('RECURRENCE_TARGET_EXCEEDED');

  let evidenceVerified = false;
  if (evidenceVerifier === null) reasons.push('GRADUATION_EVIDENCE_VERIFICATION_REQUIRED');
  else {
    let verification: Readonly<AiOpsGraduationEvidenceVerification> | null = null;
    try {
      verification = canonicalPolicySnapshot(evidenceVerifier.verifyEvidence(evidence));
    } catch {
      verification = null;
    }
    evidenceVerified = exactKeys(verification, EVIDENCE_VERIFICATION_KEYS)
      && verification.profile === 'LEDGER_GRADUATION_EVIDENCE_READBACK_V1'
      && verification.verified === true
      && verification.evidenceDigest === evidence.evidenceDigest
      && verification.runbookId === template.runbookId
      && verification.capabilityId === target.capabilityId
      && verification.labeledCaseCount === evidence.labeledCases
      && verification.shadowRunCount === evidence.shadowRuns
      && isBoundedReference(verification.evidenceReceiptReference, 'ledger-receipt://');
    if (!evidenceVerified) reasons.push('GRADUATION_EVIDENCE_VERIFICATION_FAILED');
  }

  const signedPayload = { template, evidence };
  const runbookDigest = sha256Canonical(template);
  const signedPayloadDigest = sha256Canonical(signedPayload);
  let ownerSignatureVerified = false;
  if (template.expiresAtMs <= nowMs) reasons.push('RUNBOOK_TEMPLATE_EXPIRED');
  if (template.revocationState !== 'UNSIGNED_INACTIVE') reasons.push('RUNBOOK_REVOCATION_STATE_INVALID');
  if (ownerSignature === null || verifier === null) {
    reasons.push('OWNER_SIGNATURE_REQUIRED');
  } else if (
    !isClosedOwnerSignature(ownerSignature)
    ||
    ownerSignature.signedPayloadDigest !== signedPayloadDigest
    || ownerSignature.signerRole !== 'AI_OPS_OWNER'
    || ownerSignature.policyRevision !== template.revision
    || ownerSignature.expiresAtMs <= nowMs
    || !isBoundedReference(ownerSignature.keyReference, 'owner-key-ref://')
  ) {
    reasons.push('OWNER_SIGNATURE_BINDING_INVALID');
  } else {
    try {
      ownerSignatureVerified = verifier.verify(
        ownerSignature,
        new TextEncoder().encode(canonicalPolicyJson(ownerSignatureVerificationPayload(signedPayload, ownerSignature))),
      ) === true;
    } catch {
      reasons.push('OWNER_SIGNATURE_VERIFICATION_FAILED');
    }
    if (!ownerSignatureVerified) reasons.push('OWNER_SIGNATURE_VERIFICATION_FAILED');
  }
  // The ported A1 contract receives only summary scalars and a caller-supplied
  // clock. Those inputs cannot independently prove cohorts, raw outcomes,
  // percentile samples, one-use evidence, or owner-trusted evaluation time.
  // Keep graduation ineligible until the ratified owners mount richer
  // readbacks; do not promote a caller-claimed summary into authority.
  reasons.push('RAW_METRIC_COHORT_READBACK_REQUIRED');
  reasons.push('OWNER_TRUSTED_EVALUATION_TIME_REQUIRED');
  const requirementsMet = false;
  reasons.push('SHADOW_SPECULATIVE_CANNOT_GRANT_AUTHORITY');
  return immutableClone({
    eligible: false,
    meetsNumericalAndSignatureRequirements: requirementsMet,
    reasonCodes: sortedUnique(reasons),
    runbookDigest,
    evidenceDigest: evidence.evidenceDigest,
    evidenceVerified: false,
    ownerSignatureVerified: false,
    candidateValidatedForPortRecheck: requirementsMet,
    authorityGranted: false as const,
    state: 'SHADOW_SPECULATIVE' as const,
  });
}

export function validateRunbookTemplates(): readonly string[] {
  const failures: string[] = [];
  if (AI_OPS_RUNBOOK_TEMPLATES.length !== AI_OPS_CLASS_A_ACTION_IDS.length) failures.push('RUNBOOK_COUNT_MISMATCH');
  for (const template of AI_OPS_RUNBOOK_TEMPLATES) {
    const runbookId = template.runbookId;
    if (!isClosedAiOpsRunbookTemplate(template)) failures.push(`TEMPLATE_SCHEMA_INVALID:${runbookId}`);
    const values = Object.entries(template.graduationTarget).filter(([, value]) => typeof value === 'number');
    if (values.some(([, value]) => !Number.isFinite(value as number) || (value as number) < 0)) failures.push(`INVALID_NUMERICAL_TARGET:${template.runbookId}`);
    if (template.ownerSignature !== null || template.ownerSignatureState !== 'OWNER_SIGNATURE_REQUIRED') failures.push(`TEMPLATE_IMPROPERLY_SIGNED:${template.runbookId}`);
    if (template.authorityCreated !== false || template.registrationState !== 'INSERTION_REQUEST_ONLY') failures.push(`TEMPLATE_CREATES_AUTHORITY:${template.runbookId}`);
  }
  return sortedUnique(failures);
}
