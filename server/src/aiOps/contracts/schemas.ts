import {
  AI_OPS_ACTION_CLASSES,
  AI_OPS_HARD_DENIAL_IDS,
  AI_OPS_IDENTITY_ROLES,
  AI_OPS_OPERATING_MODES,
  AI_OPS_PROVIDER_STATES,
} from '../policy/authority.js';
import { AI_OPS_RESOURCE_KINDS } from '../manifests/classification.js';
import { AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS } from './controls.js';
import { AI_OPS_INSERTION_REQUESTS } from './insertionRequests.js';
import { AI_OPS_AUTH_MODES, AI_OPS_BILLING_DOMAINS, AI_OPS_IDENTITIES, AI_OPS_PROVIDER_CREDENTIAL_MATRIX } from '../identity/identity.js';
import {
  AI_OPS_CANONICAL_POLICY_PATH_PATTERN_SOURCE,
  isCanonicalAiOpsPolicyPath,
  isClosedAiOpsDecisionLogRecord,
  isClosedSignedPolicyBundle,
} from '../policy/policy.js';
import { AI_OPS_CLASS_A_ACTION_IDS, isClosedAiOpsRunbookTemplate } from '../reliability/runbooks.js';
import {
  canonicalPolicyJson,
  canonicalPolicySnapshot,
  exactKeys,
  immutableClone,
  isBoundedId,
  isCanonicalSafeText,
  isDenseArray,
  isPlainRecord,
  isSafeIntegerAtLeast,
  isSha256,
  sha256Canonical,
} from './shared.js';

export const AI_OPS_CLOSED_KEYSETS = immutableClone({
  ProviderCredentialMatrixRow: ['rowId', 'identityId', 'role', 'providerState', 'providerId', 'intendedAuthMode', 'observedAuthMode', 'billingDomain', 'credentialReference', 'credentialMaterialPresent', 'executableCapabilityIds', 'maximumCostMicrounits', 'disposition', 'reasonCodes', 'paidFallbackAllowed', 'authorityCreated'],
  RunbookManifestTemplate: ['schema', 'runbookId', 'revision', 'owner', 'actionId', 'actionClass', 'registrationState', 'triggerIds', 'eligibleFingerprintPatterns', 'preconditionIds', 'typedParameterSchema', 'idempotencyKeyFields', 'leaseRequired', 'fencingRequired', 'conflictGraphIds', 'maximumAttempts', 'maximumEffects', 'maximumDurationMs', 'maximumBlastRadiusResources', 'rollbackOrCompensationId', 'independentPostconditionIds', 'manualFallbackId', 'requiredTelemetryIds', 'requiredEvidenceIds', 'expiresAtMs', 'revocationState', 'recurrenceEscalationClass', 'graduationTarget', 'ownerSignature', 'ownerSignatureState', 'authorityCreated'],
  ControlRegistryInsertionRequest: ['recordKind', 'requestId', 'controlId', 'category', 'label', 'canonicalOwnerId', 'delegatedEffectOwnerId', 'type', 'allowedValues', 'safeDefault', 'minimumSafetyFloor', 'scope', 'environment', 'modeCeiling', 'effectHandler', 'readbackHandler', 'approvalRequirement', 'ttlMs', 'revision', 'lastChangedBy', 'reason', 'receiptId', 'currentStatus', 'requestedState', 'effectiveState', 'permanentlyLocked', 'hardDenialIds', 'authorityCreated'],
  InsertionRequestRowV1: ['schema', 'version', 'rowId', 'status', 'requestedOwner', 'targetSeam', 'reason', 'contract', 'tests', 'expectedBehavior', 'wiringState', 'authorityCreated'],
  ClassificationResource: ['resourceId', 'kind', 'classifiedPath', 'evidencePath', 'evidenceDigest', 'evidenceDigestAlgorithm', 'evidenceRevision', 'directDependencyIds', 'registeredActionId', 'requestedActionClass', 'attemptedActionIds', 'hardDenialIds', 'sensitiveOwnerKinds'],
  SignedPolicyBundle: ['payload', 'signature', 'declaredBundleDigest'],
  DecisionLogRecord: ['schema', 'sequence', 'decisionId', 'timestampMs', 'actorIdentityId', 'actorRole', 'capabilityId', 'actionClass', 'outcome', 'reasonCodes', 'policyBundleDigest', 'policyRevision', 'inputDigest', 'resultDigest', 'redactionIds', 'previousRecordDigest', 'requestedAssurance', 'checkpointReceiptReference', 'assuranceVerified', 'state', 'authorityCreated', 'recordDigest'],
} as const);

export type AiOpsClosedContractName = keyof typeof AI_OPS_CLOSED_KEYSETS;

type JsonSchema = Readonly<Record<string, unknown>>;

// JSON Schema `pattern` has no portable flags field. Spell every secret-shape
// prefix case-insensitively so the published schema cannot accept an identifier
// that the runtime's `/i` guard rejects.
const SECRET_SHAPE_SCHEMA_FRAGMENT = '(?:[Aa](?:[Kk]|[Ss])[Ii][Aa][A-Za-z0-9]{16}|[Aa][Ii][Zz][Aa][A-Za-z0-9_-]{20,}|(?:[Ss][Kk]|[Rr][Kk])-[A-Za-z0-9_-]{12,}|[Pp][Kk]-(?:[Ll][Ii][Vv][Ee]|[Pp][Rr][Oo][Dd]|[Tt][Ee][Ss][Tt]|[Pp][Rr][Oo][Jj])-[A-Za-z0-9_-]{8,}|[Gg][Hh](?:[Pp]|[Oo]|[Uu]|[Ss]|[Rr])_[A-Za-z0-9]{20,}|[Gg][Ii][Tt][Hh][Uu][Bb]_[Pp][Aa][Tt]_[A-Za-z0-9_]{20,}|[Xx][Oo][Xx][BbAaPpRrSs]-[A-Za-z0-9-]{8,})';
const IDENTIFIER_PATTERN = `^(?!.*${SECRET_SHAPE_SCHEMA_FRAGMENT})[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$`;
const SAFE_TEXT_PATTERN = `^(?!.*[\\u0000-\\u001F\\u007F])(?!.*${SECRET_SHAPE_SCHEMA_FRAGMENT})(?!.*[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF]))(?!.*(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]).+$`;
const SHA256_PATTERN = '^[a-f0-9]{64}$';
const GIT_BLOB_SHA1_PATTERN = '^[a-f0-9]{40}$';
const BASE64URL_PATTERN = '^(?:[A-Za-z0-9_-]{4}){4,1024}(?:[A-Za-z0-9_-][AQgw]|[A-Za-z0-9_-]{2}[AEIMQUYcgkosw048])?$';
const NONEMPTY_STRING: JsonSchema = { type: 'string', minLength: 1, maxLength: 512, pattern: SAFE_TEXT_PATTERN };
const BOUNDED_ID: JsonSchema = { type: 'string', pattern: IDENTIFIER_PATTERN, maxLength: 192 };
const SHA256: JsonSchema = { type: 'string', pattern: SHA256_PATTERN };
const NONNEGATIVE_INTEGER: JsonSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const POSITIVE_INTEGER: JsonSchema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const RUN_COUNT_INTEGER: JsonSchema = { type: 'integer', minimum: 0, maximum: 1_000_000_000 };
const MEASUREMENT_INTEGER: JsonSchema = { type: 'integer', minimum: 0, maximum: 1_000_000_000_000 };
const POSITIVE_MEASUREMENT_INTEGER: JsonSchema = { type: 'integer', minimum: 1, maximum: 1_000_000_000_000 };
const FALSE_SCHEMA: JsonSchema = { const: false };
const NULL_SCHEMA: JsonSchema = { type: 'null' };

function stringArray(minItems = 0, maxItems = 256): JsonSchema {
  return { type: 'array', minItems, maxItems, uniqueItems: true, items: BOUNDED_ID };
}

function textArray(minItems = 0, maxItems = 256): JsonSchema {
  return { type: 'array', minItems, maxItems, uniqueItems: true, items: NONEMPTY_STRING };
}

function enumSchema(values: readonly (string | number | boolean)[]): JsonSchema {
  return { enum: values };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { oneOf: [schema, NULL_SCHEMA] };
}

function closedObjectSchema(
  keys: readonly string[],
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[] = keys,
): JsonSchema {
  const propertyKeys = Object.keys(properties);
  if (propertyKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(properties, key))) {
    throw new TypeError('adapted schema properties do not match the closed keyset');
  }
  if (propertyKeys.some((key) => Object.keys(properties[key] ?? {}).length === 0)) {
    throw new TypeError('adapted schema property constraints must not be empty');
  }
  return {
    type: 'object',
    additionalProperties: false,
    unevaluatedProperties: false,
    required,
    properties,
  };
}

const GRADUATION_TARGET_KEYS = [
  'capabilityId',
  'minimumLabeledCases',
  'minimumShadowRuns',
  'minimumSuccessfulRuns',
  'minimumSuccessRatePermillion',
  'maximumFailureRatePermillion',
  'minimumReplayPassRatePermillion',
  'maximumFalsePositiveRatePermillion',
  'maximumFalseRepairRatePermillion',
  'minimumCalibrationScorePermillion',
  'minimumAbstentionPrecisionPermillion',
  'maximumRollbackRatePermillion',
  'maximumRecurrenceRatePermillion',
  'minimumEvidenceCompletenessPermillion',
  'maximumUnresolvedSeverityRank',
  'maximumP99LatencyMs',
  'maximumConsecutiveFailures',
  'maximumRetryAttemptsPerIncident',
  'maximumResourceBytesPerRun',
  'maximumCostMicrounitsPerRun',
  'minimumQuietPeriodMs',
  'maximumRecurrenceCount',
  'targetRevision',
] as const;

const PERMILLION_TARGET_KEYS = new Set<string>([
  'minimumSuccessRatePermillion',
  'maximumFailureRatePermillion',
  'minimumReplayPassRatePermillion',
  'maximumFalsePositiveRatePermillion',
  'maximumFalseRepairRatePermillion',
  'minimumCalibrationScorePermillion',
  'minimumAbstentionPrecisionPermillion',
  'maximumRollbackRatePermillion',
  'maximumRecurrenceRatePermillion',
  'minimumEvidenceCompletenessPermillion',
]);

const graduationTargetProperties: Readonly<Record<string, JsonSchema>> = Object.fromEntries(
  GRADUATION_TARGET_KEYS.map((key) => {
    if (key === 'capabilityId') return [key, BOUNDED_ID];
    if (key === 'targetRevision') return [key, { const: 1 }];
    if (PERMILLION_TARGET_KEYS.has(key)) return [key, { type: 'integer', minimum: 0, maximum: 1_000_000 }];
    if (key === 'minimumLabeledCases' || key === 'minimumShadowRuns' || key === 'minimumSuccessfulRuns') return [key, { type: 'integer', minimum: 1, maximum: 1_000_000_000 }];
    return [key, MEASUREMENT_INTEGER];
  }),
);

const GRADUATION_TARGET_SCHEMA = closedObjectSchema(GRADUATION_TARGET_KEYS, graduationTargetProperties);
const CONTROL_VALUE_SCHEMA: JsonSchema = {
  oneOf: [
    { type: 'boolean' },
    NONNEGATIVE_INTEGER,
    NONEMPTY_STRING,
    { type: 'array', maxItems: 256, uniqueItems: true, items: NONEMPTY_STRING },
    { type: 'object', maxProperties: 128, propertyNames: BOUNDED_ID, additionalProperties: NONNEGATIVE_INTEGER },
  ],
};

const POLICY_FILE_KEYS = ['path', 'digestAlgorithm', 'digest', 'mediaType'] as const;
const POLICY_FILE_SCHEMA = closedObjectSchema(POLICY_FILE_KEYS, {
  path: { allOf: [NONEMPTY_STRING, { type: 'string', pattern: AI_OPS_CANONICAL_POLICY_PATH_PATTERN_SOURCE }] },
  digestAlgorithm: { const: 'SHA-256' },
  digest: SHA256,
  mediaType: enumSchema(['application/json', 'text/plain', 'application/vnd.openpolicyagent.rego']),
});
const POLICY_PAYLOAD_KEYS = ['schema', 'bundleId', 'revision', 'policyEpoch', 'parentBundleDigest', 'bundleType', 'effectiveAtMs', 'expiresAtMs', 'fileInventory', 'hardDenialIds', 'allowedActionClasses', 'authorityExpansionRequested'] as const;
const POLICY_PAYLOAD_SCHEMA = closedObjectSchema(POLICY_PAYLOAD_KEYS, {
  schema: { const: 'AI_OPS_POLICY_BUNDLE_V1' },
  bundleId: BOUNDED_ID,
  revision: BOUNDED_ID,
  policyEpoch: POSITIVE_INTEGER,
  parentBundleDigest: nullable(SHA256),
  bundleType: { const: 'SNAPSHOT' },
  effectiveAtMs: NONNEGATIVE_INTEGER,
  expiresAtMs: NONNEGATIVE_INTEGER,
  fileInventory: { type: 'array', minItems: 1, maxItems: 256, items: POLICY_FILE_SCHEMA },
  hardDenialIds: { type: 'array', minItems: AI_OPS_HARD_DENIAL_IDS.length, maxItems: AI_OPS_HARD_DENIAL_IDS.length, uniqueItems: true, items: enumSchema(AI_OPS_HARD_DENIAL_IDS) },
  allowedActionClasses: { type: 'array', minItems: 3, maxItems: 3, uniqueItems: true, items: enumSchema(['A', 'B', 'C']) },
  authorityExpansionRequested: FALSE_SCHEMA,
});

const POLICY_SIGNATURE_KEYS = ['schema', 'payloadType', 'algorithm', 'keyReference', 'signerRole', 'signatureBytesBase64Url', 'signedPayloadDigest'] as const;
const POLICY_SIGNATURE_SCHEMA = closedObjectSchema(POLICY_SIGNATURE_KEYS, {
  schema: { const: 'AI_OPS_POLICY_SIGNATURE_V1' },
  payloadType: { const: 'application/vnd.aiops.policy-bundle.v1+jcs' },
  algorithm: enumSchema(['ED25519', 'ES256']),
  keyReference: { allOf: [BOUNDED_ID, { type: 'string', pattern: '^owner-key-ref://[A-Za-z0-9][A-Za-z0-9._:/-]{0,175}$' }] },
  signerRole: { const: 'AI_OPS_OWNER' },
  signatureBytesBase64Url: { type: 'string', minLength: 16, maxLength: 4096, pattern: BASE64URL_PATTERN },
  signedPayloadDigest: SHA256,
});

const schemaProperties: Readonly<Record<AiOpsClosedContractName, Readonly<Record<string, JsonSchema>>>> = {
  ProviderCredentialMatrixRow: {
    rowId: BOUNDED_ID,
    identityId: BOUNDED_ID,
    role: enumSchema(AI_OPS_IDENTITY_ROLES),
    providerState: enumSchema(AI_OPS_PROVIDER_STATES),
    providerId: nullable(enumSchema(['SYNTHETIC_SUBSCRIPTION_PROVIDER', 'SYNTHETIC_API_PROVIDER'])),
    intendedAuthMode: enumSchema(AI_OPS_AUTH_MODES),
    observedAuthMode: enumSchema(AI_OPS_AUTH_MODES),
    billingDomain: enumSchema(AI_OPS_BILLING_DOMAINS),
    credentialReference: nullable(BOUNDED_ID),
    credentialMaterialPresent: FALSE_SCHEMA,
    executableCapabilityIds: stringArray(0, 64),
    maximumCostMicrounits: nullable(NONNEGATIVE_INTEGER),
    disposition: enumSchema(['SYNTHETIC_FIXTURE_ONLY', 'DENIED', 'UNAVAILABLE']),
    reasonCodes: stringArray(1, 32),
    paidFallbackAllowed: FALSE_SCHEMA,
    authorityCreated: FALSE_SCHEMA,
  },
  RunbookManifestTemplate: {
    schema: { const: 'AI_OPS_RUNBOOK_MANIFEST_TEMPLATE_V1' },
    runbookId: BOUNDED_ID,
    revision: { const: 1 },
    owner: { const: 'PRODUCT_ASSURANCE_REMEDIATION_OWNER_REQUIRED' },
    actionId: enumSchema(AI_OPS_CLASS_A_ACTION_IDS),
    actionClass: { const: 'A' },
    registrationState: { const: 'INSERTION_REQUEST_ONLY' },
    triggerIds: stringArray(1, 64),
    eligibleFingerprintPatterns: stringArray(1, 64),
    preconditionIds: stringArray(1, 64),
    typedParameterSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'additionalProperties', 'required', 'properties'],
      properties: {
        type: { const: 'object' },
        additionalProperties: { const: false },
        required: { const: ['resourceId'] },
        properties: {
          type: 'object',
          additionalProperties: false,
          unevaluatedProperties: false,
          required: ['resourceId'],
          properties: {
            resourceId: {
              type: 'object',
              additionalProperties: false,
              unevaluatedProperties: false,
              required: ['type', 'minLength', 'maxLength'],
              properties: {
              type: { const: 'string' },
              minLength: { type: 'integer', minimum: 1, maximum: 4096 },
              maxLength: { type: 'integer', minimum: 1, maximum: 4096 },
              },
            },
          },
        },
      },
    },
    idempotencyKeyFields: stringArray(1, 64),
    leaseRequired: { const: true },
    fencingRequired: { const: true },
    conflictGraphIds: stringArray(1, 64),
    maximumAttempts: POSITIVE_MEASUREMENT_INTEGER,
    maximumEffects: POSITIVE_MEASUREMENT_INTEGER,
    maximumDurationMs: POSITIVE_MEASUREMENT_INTEGER,
    maximumBlastRadiusResources: POSITIVE_MEASUREMENT_INTEGER,
    rollbackOrCompensationId: BOUNDED_ID,
    independentPostconditionIds: stringArray(1, 64),
    manualFallbackId: BOUNDED_ID,
    requiredTelemetryIds: stringArray(1, 64),
    requiredEvidenceIds: stringArray(1, 64),
    expiresAtMs: POSITIVE_INTEGER,
    revocationState: { const: 'UNSIGNED_INACTIVE' },
    recurrenceEscalationClass: { const: 'B' },
    graduationTarget: GRADUATION_TARGET_SCHEMA,
    ownerSignature: NULL_SCHEMA,
    ownerSignatureState: { const: 'OWNER_SIGNATURE_REQUIRED' },
    authorityCreated: FALSE_SCHEMA,
  },
  ControlRegistryInsertionRequest: {
    recordKind: { const: 'INSERTION_REQUEST' },
    requestId: { type: 'string', pattern: '^AI_OPS_CONTROL_INSERT_[A-L](?:0[1-9]|10)$' },
    controlId: { type: 'string', pattern: '^AI_OPS\\.[A-L](?:0[1-9]|10)$' },
    category: enumSchema(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']),
    label: NONEMPTY_STRING,
    canonicalOwnerId: { const: 'PRODUCT_RUNTIME_CONTROL_REGISTRY' },
    delegatedEffectOwnerId: enumSchema(['PRODUCT_RUNTIME_CONTROL_REGISTRY', 'PRODUCT_ASSURANCE_REMEDIATION', 'NOTIFICATIONS', 'RISK']),
    type: enumSchema(['BOOLEAN', 'ENUM', 'INTEGER', 'DURATION_MS', 'STRING_LIST', 'STRUCTURED_LIMITS']),
    allowedValues: { type: 'array', minItems: 1, maxItems: 64, items: CONTROL_VALUE_SCHEMA },
    safeDefault: CONTROL_VALUE_SCHEMA,
    minimumSafetyFloor: NONEMPTY_STRING,
    scope: { const: 'AI_OPS' },
    environment: { const: 'SHADOW' },
    modeCeiling: enumSchema(AI_OPS_OPERATING_MODES),
    effectHandler: NULL_SCHEMA,
    readbackHandler: NULL_SCHEMA,
    approvalRequirement: { const: 'OWNER_SIGNED_CONTROL_CHANGE_SET' },
    ttlMs: NULL_SCHEMA,
    revision: { const: 0 },
    lastChangedBy: NULL_SCHEMA,
    reason: { const: 'PROVISIONAL_A1_INSERTION_REQUEST' },
    receiptId: NULL_SCHEMA,
    currentStatus: { const: 'NOT_WIRED' },
    requestedState: { const: 'DRAFT' },
    effectiveState: { const: 'DISABLED' },
    permanentlyLocked: { type: 'boolean' },
    hardDenialIds: { type: 'array', minItems: AI_OPS_HARD_DENIAL_IDS.length, maxItems: AI_OPS_HARD_DENIAL_IDS.length, uniqueItems: true, items: enumSchema(AI_OPS_HARD_DENIAL_IDS) },
    authorityCreated: FALSE_SCHEMA,
  },
  InsertionRequestRowV1: {
    schema: { const: 'InsertionRequestRowV1' },
    version: { const: 1 },
    rowId: { allOf: [BOUNDED_ID, { type: 'string', pattern: '^AIOPS-IR-[A-Z0-9-]{1,176}$', maxLength: 192 }] },
    status: { const: 'DRAFT' },
    requestedOwner: BOUNDED_ID,
    targetSeam: NONEMPTY_STRING,
    reason: NONEMPTY_STRING,
    contract: textArray(1, 64),
    tests: textArray(1, 64),
    expectedBehavior: textArray(1, 64),
    wiringState: { allOf: [BOUNDED_ID, { type: 'string', pattern: '^PENDING_BACKEND:[A-Za-z0-9][A-Za-z0-9._:/-]{0,175}$' }] },
    authorityCreated: FALSE_SCHEMA,
  },
  ClassificationResource: {
    resourceId: BOUNDED_ID,
    kind: enumSchema(AI_OPS_RESOURCE_KINDS),
    classifiedPath: NONEMPTY_STRING,
    evidencePath: NONEMPTY_STRING,
    evidenceDigest: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' },
    evidenceDigestAlgorithm: enumSchema(['GIT_BLOB_SHA1', 'SHA-256']),
    evidenceRevision: { type: 'string', minLength: 1, maxLength: 192, pattern: SAFE_TEXT_PATTERN },
    directDependencyIds: stringArray(0, 256),
    registeredActionId: nullable(BOUNDED_ID),
    requestedActionClass: nullable(enumSchema(AI_OPS_ACTION_CLASSES)),
    attemptedActionIds: stringArray(0, 128),
    hardDenialIds: { type: 'array', maxItems: AI_OPS_HARD_DENIAL_IDS.length, uniqueItems: true, items: enumSchema(AI_OPS_HARD_DENIAL_IDS) },
    sensitiveOwnerKinds: { type: 'array', maxItems: 5, uniqueItems: true, items: enumSchema(['CONTROL', 'EXECUTION', 'RISK', 'LEDGER', 'CREDENTIAL']) },
  },
  SignedPolicyBundle: {
    payload: POLICY_PAYLOAD_SCHEMA,
    signature: nullable(POLICY_SIGNATURE_SCHEMA),
    declaredBundleDigest: SHA256,
  },
  DecisionLogRecord: {
    schema: { const: 'AI_OPS_DECISION_LOG_RECORD_V1' },
    sequence: { type: 'integer', minimum: 1, maximum: 1_000_000_000 },
    decisionId: BOUNDED_ID,
    timestampMs: NONNEGATIVE_INTEGER,
    actorIdentityId: BOUNDED_ID,
    actorRole: BOUNDED_ID,
    capabilityId: BOUNDED_ID,
    actionClass: enumSchema(AI_OPS_ACTION_CLASSES),
    outcome: enumSchema(['DENY', 'ABSTAIN', 'UNAVAILABLE']),
    reasonCodes: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: { type: 'string', pattern: `^(?!.*${SECRET_SHAPE_SCHEMA_FRAGMENT})[A-Z][A-Z0-9_]{0,127}$` } },
    policyBundleDigest: SHA256,
    policyRevision: BOUNDED_ID,
    inputDigest: SHA256,
    resultDigest: SHA256,
    redactionIds: { type: 'array', maxItems: 64, uniqueItems: true, items: { type: 'string', pattern: `^(?!.*${SECRET_SHAPE_SCHEMA_FRAGMENT})AI_OPS_REDACTION_[A-Z0-9_]{1,108}$` } },
    previousRecordDigest: nullable(SHA256),
    requestedAssurance: enumSchema(['HASH_CHAIN', 'SIGNED_CHECKPOINT', 'TRANSPARENCY_RECEIPT']),
    checkpointReceiptReference: nullable(BOUNDED_ID),
    assuranceVerified: FALSE_SCHEMA,
    state: { const: 'SHADOW_SPECULATIVE' },
    authorityCreated: FALSE_SCHEMA,
    recordDigest: SHA256,
  },
};

export const AI_OPS_ADAPTED_SCHEMA_BUNDLE = immutableClone({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://shadow.invalid/schemas/ai-ops-a1-contracts-v1',
  title: 'AI Ops A1 closed shadow contract shapes adapted from S6/A-AGENT',
  description: 'Closed structural and semantic constraints. Runtime evaluators remain fail-closed and no authority is created.',
  $defs: Object.fromEntries(
    Object.entries(AI_OPS_CLOSED_KEYSETS).map(([name, keys]) => [
      name,
      (() => {
        const base = closedObjectSchema(keys, schemaProperties[name as AiOpsClosedContractName]);
        if (name === 'ProviderCredentialMatrixRow') {
          return {
            ...base,
            oneOf: AI_OPS_PROVIDER_CREDENTIAL_MATRIX.map((row) => ({
              properties: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, { const: value }])),
              required: Object.keys(row),
            })),
          };
        }
        if (name === 'ControlRegistryInsertionRequest') {
          return {
            ...base,
            oneOf: AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.map((row) => ({
              properties: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, { const: value }])),
              required: Object.keys(row),
            })),
          };
        }
        if (name === 'InsertionRequestRowV1') {
          return {
            ...base,
            oneOf: AI_OPS_INSERTION_REQUESTS.map((row) => ({
              properties: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, { const: value }])),
              required: Object.keys(row),
            })),
          };
        }
        if (name === 'RunbookManifestTemplate') {
          return {
            ...base,
            allOf: AI_OPS_CLASS_A_ACTION_IDS.map((actionId) => ({
              if: { properties: { actionId: { const: actionId } }, required: ['actionId'] },
              then: {
                properties: {
                  runbookId: { const: `AI_OPS_RUNBOOK_${actionId}` },
                  graduationTarget: { properties: { capabilityId: { const: actionId } } },
                },
              },
            })),
          };
        }
        if (name === 'ClassificationResource') {
          return {
            ...base,
            allOf: [
              { if: { properties: { evidenceDigestAlgorithm: { const: 'GIT_BLOB_SHA1' } }, required: ['evidenceDigestAlgorithm'] }, then: { properties: { evidenceDigest: { type: 'string', pattern: '^[a-f0-9]{40}$' } } } },
              { if: { properties: { evidenceDigestAlgorithm: { const: 'SHA-256' } }, required: ['evidenceDigestAlgorithm'] }, then: { properties: { evidenceDigest: SHA256 } } },
            ],
          };
        }
        if (name === 'DecisionLogRecord') {
          return {
            ...base,
            allOf: [
              { if: { properties: { actionClass: { const: 'D' } }, required: ['actionClass'] }, then: { properties: { outcome: { const: 'DENY' } } } },
              { if: { properties: { requestedAssurance: { const: 'HASH_CHAIN' } }, required: ['requestedAssurance'] }, then: { properties: { checkpointReceiptReference: NULL_SCHEMA } } },
              { if: { properties: { requestedAssurance: { const: 'SIGNED_CHECKPOINT' } }, required: ['requestedAssurance'] }, then: { properties: { checkpointReceiptReference: { allOf: [BOUNDED_ID, { type: 'string', pattern: '^checkpoint-receipt://[A-Za-z0-9][A-Za-z0-9._:/-]{0,170}$' }] } } } },
              { if: { properties: { requestedAssurance: { const: 'TRANSPARENCY_RECEIPT' } }, required: ['requestedAssurance'] }, then: { properties: { checkpointReceiptReference: { allOf: [BOUNDED_ID, { type: 'string', pattern: '^transparency-receipt://[A-Za-z0-9][A-Za-z0-9._:/-]{0,168}$' }] } } } },
            ],
          };
        }
        return base;
      })(),
    ]),
  ),
});

function isEnumMember<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function isNonemptyString(value: unknown, maximumLength = 512): value is string {
  return isCanonicalSafeText(value, maximumLength);
}

function isStringArray(value: unknown, minimum: number, maximum: number, boundedIds = true): value is string[] {
  return isDenseArray(value)
    && value.length >= minimum
    && value.length <= maximum
    && Array.from(value).every((entry) => boundedIds ? isBoundedId(entry) : isNonemptyString(entry))
    && new Set(value).size === value.length;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function isProviderCredentialMatrixRow(value: Record<string, unknown>): boolean {
  if (
    !isBoundedId(value.rowId)
    || !isBoundedId(value.identityId)
    || !isEnumMember(value.role, AI_OPS_IDENTITY_ROLES)
    || !isEnumMember(value.providerState, AI_OPS_PROVIDER_STATES)
    || !isEnumMember(value.intendedAuthMode, AI_OPS_AUTH_MODES)
    || !isEnumMember(value.observedAuthMode, AI_OPS_AUTH_MODES)
    || !isEnumMember(value.billingDomain, AI_OPS_BILLING_DOMAINS)
    || !isStringArray(value.executableCapabilityIds, 0, 64)
    || !isStringArray(value.reasonCodes, 1, 32)
    || !['SYNTHETIC_FIXTURE_ONLY', 'DENIED', 'UNAVAILABLE'].includes(value.disposition as string)
    || value.credentialMaterialPresent !== false
    || value.paidFallbackAllowed !== false
    || value.authorityCreated !== false
    || !(value.maximumCostMicrounits === null || isSafeIntegerAtLeast(value.maximumCostMicrounits, 0))
    || !(value.credentialReference === null || isBoundedId(value.credentialReference))
  ) return false;
  const identity = AI_OPS_IDENTITIES.find((candidate) => candidate.identityId === value.identityId);
  if (!identity || identity.role !== value.role || value.rowId !== `${value.identityId}:${value.providerState}`) return false;
  const canonicalRow = AI_OPS_PROVIDER_CREDENTIAL_MATRIX.find((candidate) => candidate.rowId === value.rowId);
  if (canonicalRow === undefined) return false;
  if (identity.role === 'RESEARCH_TRADE_CONTEXT_ADVISOR' && value.providerState !== 'NOT_CONFIGURED') return false;

  const stateTuple: Readonly<Record<string, readonly unknown[]>> = {
    NOT_CONFIGURED: [null, 'NONE', 'NONE', 'NONE', null, null, 'DENIED'],
    SUBSCRIPTION_CODEX_WORKER: ['SYNTHETIC_SUBSCRIPTION_PROVIDER', 'CHATGPT_SUBSCRIPTION', 'NONE', 'CHATGPT_SUBSCRIPTION', 'REFERENCE', null, 'SYNTHETIC_FIXTURE_ONLY'],
    SUBSCRIPTION_CLAUDE_CODE_WORKER: ['SYNTHETIC_SUBSCRIPTION_PROVIDER', 'CLAUDE_SUBSCRIPTION', 'NONE', 'CLAUDE_SUBSCRIPTION', 'REFERENCE', null, 'SYNTHETIC_FIXTURE_ONLY'],
    API_CONFIGURED: ['SYNTHETIC_API_PROVIDER', 'API_KEY', 'NONE', 'SYNTHETIC_API_BUDGET', 'REFERENCE', null, 'SYNTHETIC_FIXTURE_ONLY'],
    DIAGNOSTIC_PLANE_UNAVAILABLE: [null, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', null, null, 'UNAVAILABLE'],
  };
  const tuple = stateTuple[value.providerState];
  if (!tuple) return false;
  const expectedReference = tuple[4] === 'REFERENCE';
  const expectedCredentialPrefix: Readonly<Record<string, string | null>> = {
    NOT_CONFIGURED: null,
    SUBSCRIPTION_CODEX_WORKER: 'synthetic-ref://openai-codex/',
    SUBSCRIPTION_CLAUDE_CODE_WORKER: 'synthetic-ref://anthropic-claude-code/',
    API_CONFIGURED: 'synthetic-ref://fake-api/',
    DIAGNOSTIC_PLANE_UNAVAILABLE: null,
  };
  const expectedReasonCodes: Readonly<Record<string, readonly string[]>> = {
    NOT_CONFIGURED: identity.role === 'RESEARCH_TRADE_CONTEXT_ADVISOR' ? ['ADVISOR_NOT_CONFIGURED'] : ['PROVIDER_NOT_CONFIGURED'],
    SUBSCRIPTION_CODEX_WORKER: ['NO_EXECUTION_CAPABILITY', 'NOT_MOUNTED', 'SYNTHETIC_FIXTURE_ONLY'],
    SUBSCRIPTION_CLAUDE_CODE_WORKER: ['NO_EXECUTION_CAPABILITY', 'NOT_MOUNTED', 'SYNTHETIC_FIXTURE_ONLY'],
    API_CONFIGURED: ['NO_EXECUTION_CAPABILITY', 'NOT_MOUNTED', 'SYNTHETIC_FIXTURE_ONLY'],
    DIAGNOSTIC_PLANE_UNAVAILABLE: ['DIAGNOSTIC_EVIDENCE_UNAVAILABLE', 'FAIL_CLOSED'],
  };
  const credentialPrefix = expectedCredentialPrefix[value.providerState];
  if (
    value.providerId !== tuple[0]
    || value.intendedAuthMode !== tuple[1]
    || value.observedAuthMode !== tuple[2]
    || value.billingDomain !== tuple[3]
    || (expectedReference ? !isBoundedId(value.credentialReference) : value.credentialReference !== null)
    || (credentialPrefix !== null && !(value.credentialReference as string).startsWith(credentialPrefix))
    || value.maximumCostMicrounits !== tuple[5]
    || value.disposition !== tuple[6]
    || !sameStringSet(value.reasonCodes, expectedReasonCodes[value.providerState] ?? [])
  ) return false;
  return value.executableCapabilityIds.length === 0
    && canonicalPolicyJson(value) === canonicalPolicyJson(canonicalRow);
}

function isGraduationTarget(value: unknown, actionId: string): boolean {
  if (!exactKeys(value, GRADUATION_TARGET_KEYS)) return false;
  if (value.capabilityId !== actionId || value.targetRevision !== 1) return false;
  for (const key of GRADUATION_TARGET_KEYS) {
    if (key === 'capabilityId' || key === 'targetRevision') continue;
    const numericValue = value[key];
    if (!isSafeIntegerAtLeast(numericValue, 0)) return false;
    if (PERMILLION_TARGET_KEYS.has(key) && numericValue > 1_000_000) return false;
  }
  return (value.minimumSuccessfulRuns as number) <= (value.minimumShadowRuns as number)
    && (value.minimumSuccessRatePermillion as number) + (value.maximumFailureRatePermillion as number) === 1_000_000;
}

function isTypedParameterSchema(value: unknown): boolean {
  if (!exactKeys(value, ['type', 'additionalProperties', 'required', 'properties'])) return false;
  if (value.type !== 'object' || value.additionalProperties !== false || !isStringArray(value.required, 1, 64)) return false;
  if (!isPlainRecord(value.properties)) return false;
  const propertyNames = Object.keys(value.properties);
  return propertyNames.length === 1
    && propertyNames[0] === 'resourceId'
    && value.required.length === 1
    && value.required[0] === 'resourceId'
    && Object.values(value.properties).every((property) => {
      if (!exactKeys(property, ['type', 'minLength', 'maxLength'])) return false;
      return property.type === 'string'
        && isSafeIntegerAtLeast(property.minLength, 1)
        && isSafeIntegerAtLeast(property.maxLength, property.minLength)
        && property.maxLength <= 4096;
    });
}

function isRunbookManifestTemplate(value: Record<string, unknown>): boolean {
  if (!isClosedAiOpsRunbookTemplate(value)) return false;
  const actionId = value.actionId;
  return value.schema === 'AI_OPS_RUNBOOK_MANIFEST_TEMPLATE_V1'
    && isBoundedId(value.runbookId)
    && value.runbookId === `AI_OPS_RUNBOOK_${actionId}`
    && value.revision === 1
    && value.owner === 'PRODUCT_ASSURANCE_REMEDIATION_OWNER_REQUIRED'
    && isEnumMember(actionId, AI_OPS_CLASS_A_ACTION_IDS)
    && value.actionClass === 'A'
    && value.registrationState === 'INSERTION_REQUEST_ONLY'
    && isStringArray(value.triggerIds, 1, 64)
    && isStringArray(value.eligibleFingerprintPatterns, 1, 64)
    && isStringArray(value.preconditionIds, 1, 64)
    && isTypedParameterSchema(value.typedParameterSchema)
    && isStringArray(value.idempotencyKeyFields, 1, 64)
    && value.leaseRequired === true
    && value.fencingRequired === true
    && isStringArray(value.conflictGraphIds, 1, 64)
    && isSafeIntegerAtLeast(value.maximumAttempts, 1)
    && isSafeIntegerAtLeast(value.maximumEffects, 1)
    && isSafeIntegerAtLeast(value.maximumDurationMs, 1)
    && isSafeIntegerAtLeast(value.maximumBlastRadiusResources, 1)
    && isBoundedId(value.rollbackOrCompensationId)
    && isStringArray(value.independentPostconditionIds, 1, 64)
    && isBoundedId(value.manualFallbackId)
    && isStringArray(value.requiredTelemetryIds, 1, 64)
    && isStringArray(value.requiredEvidenceIds, 1, 64)
    && isSafeIntegerAtLeast(value.expiresAtMs, 1)
    && value.revocationState === 'UNSIGNED_INACTIVE'
    && value.recurrenceEscalationClass === 'B'
    && isGraduationTarget(value.graduationTarget, actionId)
    && value.ownerSignature === null
    && value.ownerSignatureState === 'OWNER_SIGNATURE_REQUIRED'
    && value.authorityCreated === false;
}

function isControlValue(value: unknown): boolean {
  if (typeof value === 'boolean' || isNonemptyString(value) || isSafeIntegerAtLeast(value, 0)) return true;
  if (isDenseArray(value)) return value.length <= 256 && Array.from(value).every((entry) => isNonemptyString(entry)) && new Set(value).size === value.length;
  return isPlainRecord(value)
    && Object.keys(value).every(isBoundedId)
    && Object.keys(value).length <= 128
    && Object.values(value).every((entry) => isSafeIntegerAtLeast(entry, 0));
}

function controlValueMatchesType(type: unknown, value: unknown): boolean {
  if (type === 'BOOLEAN') return typeof value === 'boolean';
  if (type === 'ENUM') return isNonemptyString(value);
  if (type === 'INTEGER' || type === 'DURATION_MS') return isSafeIntegerAtLeast(value, 0);
  if (type === 'STRING_LIST') return isDenseArray(value) && Array.from(value).every((entry) => isNonemptyString(entry)) && new Set(value).size === value.length;
  if (type === 'STRUCTURED_LIMITS') return isPlainRecord(value) && Object.keys(value).every(isBoundedId) && Object.values(value).every((entry) => isSafeIntegerAtLeast(entry, 0));
  return false;
}

function isControlRegistryInsertionRequest(value: Record<string, unknown>): boolean {
  if (
    value.recordKind !== 'INSERTION_REQUEST'
    || typeof value.requestId !== 'string'
    || !/^AI_OPS_CONTROL_INSERT_[A-L](0[1-9]|10)$/.test(value.requestId)
    || typeof value.controlId !== 'string'
    || !/^AI_OPS\.[A-L](0[1-9]|10)$/.test(value.controlId)
    || !isEnumMember(value.category, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const)
    || value.category !== value.controlId.slice(7, 8)
    || value.requestId.slice(-3) !== value.controlId.slice(-3)
    || !isNonemptyString(value.label)
    || value.canonicalOwnerId !== 'PRODUCT_RUNTIME_CONTROL_REGISTRY'
    || !['PRODUCT_RUNTIME_CONTROL_REGISTRY', 'PRODUCT_ASSURANCE_REMEDIATION', 'NOTIFICATIONS', 'RISK'].includes(value.delegatedEffectOwnerId as string)
    || !['BOOLEAN', 'ENUM', 'INTEGER', 'DURATION_MS', 'STRING_LIST', 'STRUCTURED_LIMITS'].includes(value.type as string)
    || !isDenseArray(value.allowedValues)
    || value.allowedValues.length < 1
    || value.allowedValues.length > 64
    || !Array.from(value.allowedValues).every(isControlValue)
    || new Set(value.allowedValues.map((allowed) => canonicalPolicyJson(allowed))).size !== value.allowedValues.length
    || !isControlValue(value.safeDefault)
    || !Array.from(value.allowedValues).some((allowed) => canonicalPolicyJson(allowed) === canonicalPolicyJson(value.safeDefault))
    || !Array.from(value.allowedValues).every((allowed) => controlValueMatchesType(value.type, allowed))
    || !controlValueMatchesType(value.type, value.safeDefault)
    || !isNonemptyString(value.minimumSafetyFloor)
    || value.scope !== 'AI_OPS'
    || value.environment !== 'SHADOW'
    || !isEnumMember(value.modeCeiling, AI_OPS_OPERATING_MODES)
    || value.effectHandler !== null
    || value.readbackHandler !== null
    || value.approvalRequirement !== 'OWNER_SIGNED_CONTROL_CHANGE_SET'
    || value.ttlMs !== null
    || value.revision !== 0
    || value.lastChangedBy !== null
    || value.reason !== 'PROVISIONAL_A1_INSERTION_REQUEST'
    || value.receiptId !== null
    || value.currentStatus !== 'NOT_WIRED'
    || value.requestedState !== 'DRAFT'
    || value.effectiveState !== 'DISABLED'
    || typeof value.permanentlyLocked !== 'boolean'
    || !isStringArray(value.hardDenialIds, AI_OPS_HARD_DENIAL_IDS.length, AI_OPS_HARD_DENIAL_IDS.length)
    || !sameStringSet(value.hardDenialIds, AI_OPS_HARD_DENIAL_IDS)
    || value.authorityCreated !== false
  ) return false;
  const canonicalRow = AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.find((row) => row.controlId === value.controlId);
  return canonicalRow !== undefined && canonicalPolicyJson(value) === canonicalPolicyJson(canonicalRow);
}

function isInsertionRequestRow(value: Record<string, unknown>): boolean {
  if (!(value.schema === 'InsertionRequestRowV1'
    && value.version === 1
    && typeof value.rowId === 'string'
    && isBoundedId(value.rowId)
    && /^AIOPS-IR-[A-Z0-9-]{1,176}$/.test(value.rowId)
    && value.status === 'DRAFT'
    && isBoundedId(value.requestedOwner)
    && isNonemptyString(value.targetSeam)
    && isNonemptyString(value.reason)
    && isStringArray(value.contract, 1, 64, false)
    && isStringArray(value.tests, 1, 64, false)
    && isStringArray(value.expectedBehavior, 1, 64, false)
    && typeof value.wiringState === 'string'
    && isBoundedId(value.wiringState)
    && /^PENDING_BACKEND:[A-Za-z0-9][A-Za-z0-9._:/-]{0,175}$/.test(value.wiringState)
    && value.wiringState === `PENDING_BACKEND:${value.rowId}`
    && value.authorityCreated === false)) return false;
  const canonicalRow = AI_OPS_INSERTION_REQUESTS.find((row) => row.rowId === value.rowId);
  return canonicalRow !== undefined && canonicalPolicyJson(value) === canonicalPolicyJson(canonicalRow);
}

function isClassificationResource(value: Record<string, unknown>): boolean {
  if (
    !isBoundedId(value.resourceId)
    || !isEnumMember(value.kind, AI_OPS_RESOURCE_KINDS)
    || !isNonemptyString(value.classifiedPath)
    || !isNonemptyString(value.evidencePath)
    || !isNonemptyString(value.evidenceRevision, 192)
    || !(value.evidenceDigestAlgorithm === 'GIT_BLOB_SHA1' || value.evidenceDigestAlgorithm === 'SHA-256')
    || typeof value.evidenceDigest !== 'string'
    || (value.evidenceDigestAlgorithm === 'GIT_BLOB_SHA1' ? !new RegExp(GIT_BLOB_SHA1_PATTERN).test(value.evidenceDigest) : !isSha256(value.evidenceDigest))
    || !isStringArray(value.directDependencyIds, 0, 256)
    || !(value.registeredActionId === null || isBoundedId(value.registeredActionId))
    || !(value.requestedActionClass === null || isEnumMember(value.requestedActionClass, AI_OPS_ACTION_CLASSES))
    || !isStringArray(value.attemptedActionIds, 0, 128)
    || !isStringArray(value.hardDenialIds, 0, AI_OPS_HARD_DENIAL_IDS.length)
    || value.hardDenialIds.some((id) => !AI_OPS_HARD_DENIAL_IDS.includes(id))
    || !isStringArray(value.sensitiveOwnerKinds, 0, 5)
    || value.sensitiveOwnerKinds.some((kind) => !['CONTROL', 'EXECUTION', 'RISK', 'LEDGER', 'CREDENTIAL'].includes(kind))
  ) return false;
  return true;
}

function isSignedPolicyBundle(value: Record<string, unknown>): boolean {
  if (!isClosedSignedPolicyBundle(value)) return false;
  const payload = value.payload;
  const paths = payload.fileInventory.map((file) => file.path);
  if (
    payload.effectiveAtMs < 0
    || payload.expiresAtMs <= payload.effectiveAtMs
    || !sameStringSet(payload.hardDenialIds, AI_OPS_HARD_DENIAL_IDS)
    || !sameStringSet(payload.allowedActionClasses, ['A', 'B', 'C'])
    || new Set(paths).size !== paths.length
    || paths.some((path) => !isCanonicalAiOpsPolicyPath(path))
    || canonicalPolicyJson(paths) !== canonicalPolicyJson([...paths].sort())
    || value.declaredBundleDigest !== sha256Canonical(payload)
    || (value.signature !== null && value.signature.signedPayloadDigest !== value.declaredBundleDigest)
  ) return false;
  return true;
}

function isDecisionLogRecord(value: Record<string, unknown>): boolean {
  return isClosedAiOpsDecisionLogRecord(value);
}

export function isClosedAiOpsContract(name: AiOpsClosedContractName, value: unknown): boolean {
  if (typeof name !== 'string') return false;
  if (!Object.hasOwn(AI_OPS_CLOSED_KEYSETS, name)) return false;
  const keys = AI_OPS_CLOSED_KEYSETS[name];
  let snapshot: unknown;
  try {
    snapshot = canonicalPolicySnapshot(value);
  } catch {
    return false;
  }
  if (!keys || !exactKeys(snapshot, keys)) return false;
  switch (name) {
    case 'ProviderCredentialMatrixRow': return isProviderCredentialMatrixRow(snapshot);
    case 'RunbookManifestTemplate': return isRunbookManifestTemplate(snapshot);
    case 'ControlRegistryInsertionRequest': return isControlRegistryInsertionRequest(snapshot);
    case 'InsertionRequestRowV1': return isInsertionRequestRow(snapshot);
    case 'ClassificationResource': return isClassificationResource(snapshot);
    case 'SignedPolicyBundle': return isSignedPolicyBundle(snapshot);
    case 'DecisionLogRecord': return isDecisionLogRecord(snapshot);
  }
}
