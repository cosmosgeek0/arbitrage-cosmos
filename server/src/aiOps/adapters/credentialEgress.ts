import { isBoundedIdentifier, isExactIdentityRole, isLowercaseSha256, isPlainRecord, type AiOpsIdentityRole } from './contracts.js';
import { isValidUtcMillis } from '../../foundation/contracts/time.js';

const EGRESS_REQUEST_KEYS = Object.freeze([
  'schema', 'requestId', 'routeId', 'principalId', 'identityRole', 'providerId', 'modelId', 'runId', 'environmentId', 'toolId',
  'toolAdmissionDigest', 'policyReceiptId', 'exactHost', 'exactPath', 'method', 'caseId', 'evidenceDigest',
  'bodySchemaId', 'bodyDigest', 'bodyClassification', 'policyRevision', 'controlRevision', 'maximumCostMicrounits', 'requestedCostMicrounits',
  'retentionPosture', 'credentialReference', 'credentialClassification', 'callerProvidedAuthorizationHeader', 'signedPolicyDecision',
  'policySignatureVerified', 'policyValidFromMs', 'policyExpiresAtMs', 'immutableAuditAvailable',
]);

function snapshotExactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (!isPlainRecord(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.some((key) => typeof key !== 'string')
      || ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key === 'string' && !keys.includes(key))
    ) return null;

    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export interface PrestageEgressRoute {
  readonly schema: 'AI_OPS_EGRESS_ROUTE_V1';
  readonly routeId: string;
  readonly providerId: string;
  readonly exactHost: string;
  readonly exactPath: string;
  readonly method: 'POST';
  readonly enabled: false;
  readonly redirects: 'DENIED';
  readonly privateAddressSpace: 'DENIED';
  readonly credentialDelivery: 'OPAQUE_REFERENCE_TO_EXTERNAL_BROKER_ONLY';
  readonly credentialClassification: 'TEST_ONLY_SYNTHETIC_INVALID';
  readonly credentialReference: string;
}

export interface EgressAdmissionRequest {
  readonly schema: 'AI_OPS_EGRESS_ADMISSION_REQUEST_V1';
  readonly requestId: string;
  readonly routeId: string;
  readonly principalId: string;
  readonly identityRole: AiOpsIdentityRole;
  readonly providerId: string;
  readonly modelId: string;
  readonly runId: string;
  readonly environmentId: string;
  readonly toolId: string;
  readonly toolAdmissionDigest: string;
  readonly policyReceiptId: string;
  readonly exactHost: string;
  readonly exactPath: string;
  readonly method: 'POST';
  readonly caseId: string;
  readonly evidenceDigest: string;
  readonly bodySchemaId: string;
  readonly bodyDigest: string;
  readonly bodyClassification: 'REDACTED_INTERNAL_ONLY';
  readonly policyRevision: string;
  readonly controlRevision: string;
  readonly maximumCostMicrounits: number;
  readonly requestedCostMicrounits: number;
  readonly retentionPosture: 'COMPATIBLE' | 'UNKNOWN';
  readonly credentialReference: string;
  readonly credentialClassification: 'TEST_ONLY_SYNTHETIC_INVALID';
  readonly callerProvidedAuthorizationHeader: boolean;
  readonly signedPolicyDecision: 'ALLOW' | 'DENY' | 'UNAVAILABLE';
  readonly policySignatureVerified: boolean;
  readonly policyValidFromMs: number;
  readonly policyExpiresAtMs: number;
  readonly immutableAuditAvailable: boolean;
}

export interface EgressAdmissionDecision {
  readonly schema: 'AI_OPS_EGRESS_ADMISSION_DECISION_V1';
  readonly allowed: false;
  readonly authorityGranted: false;
  readonly credentialMaterialReturned: false;
  readonly egressReceiptId: null;
  readonly denialAuditState: 'PENDING_I00_AUDIT_OWNER';
  readonly reasonCodes: readonly string[];
}

export const A3_PRESTAGE_EGRESS_ROUTES: readonly Readonly<PrestageEgressRoute>[] = Object.freeze([
  Object.freeze({
    schema: 'AI_OPS_EGRESS_ROUTE_V1',
    routeId: 'codex-provider-test-only',
    providerId: 'codex-subscription-worker',
    exactHost: 'codex-provider.test.invalid',
    exactPath: '/v1/test-only-never-send',
    method: 'POST',
    enabled: false,
    redirects: 'DENIED',
    privateAddressSpace: 'DENIED',
    credentialDelivery: 'OPAQUE_REFERENCE_TO_EXTERNAL_BROKER_ONLY',
    credentialClassification: 'TEST_ONLY_SYNTHETIC_INVALID',
    credentialReference: 'TEST_ONLY_INVALID_CREDENTIAL_REFERENCE_CODEX_DO_NOT_USE',
  }),
  Object.freeze({
    schema: 'AI_OPS_EGRESS_ROUTE_V1',
    routeId: 'claude-code-provider-test-only',
    providerId: 'claude-code-subscription-worker',
    exactHost: 'claude-provider.test.invalid',
    exactPath: '/v1/test-only-never-send',
    method: 'POST',
    enabled: false,
    redirects: 'DENIED',
    privateAddressSpace: 'DENIED',
    credentialDelivery: 'OPAQUE_REFERENCE_TO_EXTERNAL_BROKER_ONLY',
    credentialClassification: 'TEST_ONLY_SYNTHETIC_INVALID',
    credentialReference: 'TEST_ONLY_INVALID_CREDENTIAL_REFERENCE_CLAUDE_DO_NOT_USE',
  }),
]);

function rejectedEgressAdmission(reasonCodes: readonly string[]): Readonly<EgressAdmissionDecision> {
  return Object.freeze({
    schema: 'AI_OPS_EGRESS_ADMISSION_DECISION_V1',
    allowed: false,
    authorityGranted: false,
    credentialMaterialReturned: false,
    egressReceiptId: null,
    denialAuditState: 'PENDING_I00_AUDIT_OWNER',
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
  });
}

export function evaluatePrestageEgressAdmission(
  request: Readonly<EgressAdmissionRequest>,
  nowMs: number,
): Readonly<EgressAdmissionDecision> {
  const requestSnapshot = snapshotExactDataRecord(request, EGRESS_REQUEST_KEYS);
  if (requestSnapshot === null) return rejectedEgressAdmission(['EGRESS_ADMISSION_ENVELOPE_REJECTED']);
  if (requestSnapshot.schema !== 'AI_OPS_EGRESS_ADMISSION_REQUEST_V1') {
    return rejectedEgressAdmission(['EGRESS_ADMISSION_SCHEMA_REJECTED']);
  }
  if (!isValidUtcMillis(nowMs)) return rejectedEgressAdmission(['EGRESS_ADMISSION_CLOCK_REJECTED']);
  request = requestSnapshot as unknown as Readonly<EgressAdmissionRequest>;
  for (const [label, value] of [
    ['requestId', request.requestId],
    ['routeId', request.routeId],
    ['principalId', request.principalId],
    ['providerId', request.providerId],
    ['modelId', request.modelId],
    ['runId', request.runId],
    ['environmentId', request.environmentId],
    ['toolId', request.toolId],
    ['caseId', request.caseId],
    ['policyRevision', request.policyRevision],
    ['controlRevision', request.controlRevision],
    ['bodySchemaId', request.bodySchemaId],
    ['policyReceiptId', request.policyReceiptId],
  ] as const) {
    if (!isBoundedIdentifier(value)) return rejectedEgressAdmission([`EGRESS_ADMISSION_IDENTIFIER_REJECTED_${label.toUpperCase()}`]);
  }
  if (!isLowercaseSha256(request.evidenceDigest)) return rejectedEgressAdmission(['EGRESS_ADMISSION_EVIDENCE_DIGEST_REJECTED']);
  if (!isLowercaseSha256(request.bodyDigest)) return rejectedEgressAdmission(['EGRESS_ADMISSION_BODY_DIGEST_REJECTED']);
  if (!isLowercaseSha256(request.toolAdmissionDigest)) return rejectedEgressAdmission(['EGRESS_ADMISSION_TOOL_DIGEST_REJECTED']);
  if (!isExactIdentityRole(request.identityRole)) return rejectedEgressAdmission(['EGRESS_ADMISSION_IDENTITY_ROLE_REJECTED']);

  const reasons: string[] = [];
  const route = A3_PRESTAGE_EGRESS_ROUTES.find((candidate) => candidate.routeId === request.routeId);
  if (route === undefined) reasons.push('EGRESS_ROUTE_NOT_REGISTERED');
  else {
    if (route.providerId !== request.providerId) reasons.push('EGRESS_PROVIDER_MISMATCH');
    if (route.exactHost !== request.exactHost || route.exactPath !== request.exactPath || route.method !== request.method) {
      reasons.push('EGRESS_DESTINATION_NOT_EXACTLY_REGISTERED');
    }
    if (route.enabled !== false) reasons.push('PRESTAGE_ROUTE_STATE_INVALID');
    if (route.credentialReference !== request.credentialReference) reasons.push('CREDENTIAL_REFERENCE_NOT_EXACTLY_REGISTERED');
    reasons.push('EGRESS_ROUTE_NOT_CONFIGURED');
  }
  if (typeof request.callerProvidedAuthorizationHeader !== 'boolean') reasons.push('CALLER_AUTHORIZATION_HEADER_FLAG_INVALID');
  if (request.callerProvidedAuthorizationHeader !== false) reasons.push('CALLER_AUTHORIZATION_HEADER_FORBIDDEN');
  if (request.credentialClassification !== 'TEST_ONLY_SYNTHETIC_INVALID') reasons.push('CREDENTIAL_CLASSIFICATION_FORBIDDEN');
  if (request.bodyClassification !== 'REDACTED_INTERNAL_ONLY') reasons.push('EGRESS_BODY_CLASSIFICATION_FORBIDDEN');
  if (request.retentionPosture !== 'COMPATIBLE') reasons.push('EGRESS_RETENTION_POSTURE_BLOCKED');
  if (
    !Number.isSafeInteger(request.maximumCostMicrounits)
    || !Number.isSafeInteger(request.requestedCostMicrounits)
    || request.maximumCostMicrounits < 0
    || request.requestedCostMicrounits < 0
    || request.requestedCostMicrounits > request.maximumCostMicrounits
  ) reasons.push('EGRESS_COST_BUDGET_INVALID');
  if (request.signedPolicyDecision !== 'ALLOW') reasons.push('EGRESS_POLICY_NOT_ALLOWED');
  if (request.policySignatureVerified !== true) reasons.push('EGRESS_POLICY_SIGNATURE_UNVERIFIED');
  if (request.immutableAuditAvailable !== true) reasons.push('EGRESS_IMMUTABLE_AUDIT_UNAVAILABLE');
  if (
    !isValidUtcMillis(request.policyValidFromMs)
    || !isValidUtcMillis(request.policyExpiresAtMs)
    || request.policyExpiresAtMs <= request.policyValidFromMs
    || nowMs < request.policyValidFromMs
    || nowMs >= request.policyExpiresAtMs
  ) {
    reasons.push('EGRESS_POLICY_STALE_OR_INVALID');
  }
  reasons.push('CREDENTIAL_BROKER_AND_EGRESS_PROXY_I00_BINDING_PENDING');

  return rejectedEgressAdmission(reasons);
}
