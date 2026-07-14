import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  isBoundedIdentifier,
  isExactIdentityRole,
  isGitCommitSha,
  isLowercaseSha256,
  isPlainRecord,
  type AiOpsIdentityRole,
} from './contracts.js';

export interface SyntheticAuthenticationProof {
  readonly schema: 'AI_OPS_SYNTHETIC_AUTHENTICATION_PROOF_V1';
  readonly algorithm: 'HMAC_SHA256_TEST_ONLY';
  readonly keyId: string;
  readonly keyClassification: 'TEST_ONLY_SYNTHETIC_INVALID';
  readonly method: 'POST' | 'INTERNAL';
  readonly routeId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly nonce: string;
  readonly authenticationProofHex: string;
}

export interface SyntheticVerificationKey {
  readonly keyId: string;
  readonly classification: 'TEST_ONLY_SYNTHETIC_INVALID';
  readonly keyBytes: Uint8Array;
}

export interface SignedJobV1 {
  readonly schema: 'AI_OPS_SIGNED_JOB_V1';
  readonly jobId: string;
  readonly attemptId: string;
  readonly caseId: string;
  readonly evidenceDigest: string;
  readonly workflowGeneration: number;
  readonly identityRole: Exclude<AiOpsIdentityRole, 'RESEARCH_TRADE_CONTEXT_ADVISOR'>;
  readonly providerId: string;
  readonly modelId: string;
  readonly baseSha: string;
  readonly toolRegistryDigest: string;
  readonly providerOperationRequestDigest: string;
  readonly purpose: 'DIAGNOSE' | 'REPAIR' | 'VERIFY';
}

export interface ProviderCallbackV1 {
  readonly schema: 'AI_OPS_PROVIDER_CALLBACK_V1';
  readonly callbackId: string;
  readonly providerEventId: string;
  readonly internalRunId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly caseId: string;
  readonly evidenceDigest: string;
  readonly workflowGeneration: number;
  readonly identityRole: Exclude<AiOpsIdentityRole, 'RESEARCH_TRADE_CONTEXT_ADVISOR'>;
  readonly providerId: string;
  readonly modelId: string;
  readonly baseSha: string;
  readonly resultDigest: string;
  readonly providerOperationRequestDigest: string;
  readonly purpose: 'DIAGNOSE' | 'REPAIR' | 'VERIFY';
}

export interface CallbackExpectedBinding {
  readonly routeId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly caseId: string;
  readonly evidenceDigest: string;
  readonly workflowGeneration: number;
  readonly identityRole: Exclude<AiOpsIdentityRole, 'RESEARCH_TRADE_CONTEXT_ADVISOR'>;
  readonly providerId: string;
  readonly modelId: string;
  readonly baseSha: string;
  readonly providerOperationRequestDigest: string;
  readonly purpose: 'DIAGNOSE' | 'REPAIR' | 'VERIFY';
}

export interface AuthenticatedCallbackReservationInput {
  readonly replayKey: string;
  readonly contentDigest: string;
  readonly expiresAtMs: number;
  readonly providerEventId: string;
  readonly internalRunId: string;
  readonly callbackId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly workflowGeneration: number;
  readonly providerId: string;
  readonly modelId: string;
}

export interface AuthenticatedJobReservationInput {
  readonly replayKey: string;
  readonly contentDigest: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly workflowGeneration: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly baseSha: string;
  readonly toolRegistryDigest: string;
  readonly providerOperationRequestDigest: string;
  readonly expiresAtMs: number;
}

export type DurableDeliveryReservationResult =
  | Readonly<{ status: 'RESERVED'; receiptId: string; deliveryAuditReceiptId: string }>
  | Readonly<{ status: 'DUPLICATE'; receiptId: string; deliveryAuditReceiptId: string }>
  | Readonly<{ status: 'CONFLICT'; receiptId: string | null; deliveryAuditReceiptId: string }>
  | Readonly<{ status: 'UNAVAILABLE'; receiptId: null; deliveryAuditReceiptId: null }>;

export interface CallbackDedupPort {
  readonly schema: 'AI_OPS_CALLBACK_DEDUP_PORT_V1';
  reserveAuthenticatedCallback(input: Readonly<AuthenticatedCallbackReservationInput>): Promise<Readonly<DurableDeliveryReservationResult>>;
  reserveAuthenticatedJob(input: Readonly<AuthenticatedJobReservationInput>): Promise<Readonly<DurableDeliveryReservationResult>>;
}

export interface CallbackAdmissionResult {
  readonly schema: 'AI_OPS_CALLBACK_ADMISSION_RESULT_V1';
  readonly acknowledged: boolean;
  readonly enqueueAuthorized: boolean;
  readonly authorityGranted: false;
  readonly httpStatus: 202 | 400 | 401 | 409 | 503;
  readonly disposition: 'DURABLY_RESERVED' | 'IDEMPOTENT_DUPLICATE' | 'REJECTED';
  readonly effectSemantics: 'EFFECT_UNKNOWN';
  readonly receiptId: string | null;
  readonly deliveryAuditReceiptId: string | null;
  readonly callback: Readonly<ProviderCallbackV1> | null;
  readonly reasonCodes: readonly string[];
}

export interface SignedJobExpectedBinding {
  readonly routeId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly caseId: string;
  readonly evidenceDigest: string;
  readonly workflowGeneration: number;
  readonly identityRole: Exclude<AiOpsIdentityRole, 'RESEARCH_TRADE_CONTEXT_ADVISOR'>;
  readonly providerId: string;
  readonly modelId: string;
  readonly baseSha: string;
  readonly toolRegistryDigest: string;
  readonly providerOperationRequestDigest: string;
  readonly purpose: 'DIAGNOSE' | 'REPAIR' | 'VERIFY';
}

export interface SignedJobAdmissionResult {
  readonly schema: 'AI_OPS_SIGNED_JOB_ADMISSION_RESULT_V1';
  readonly accepted: boolean;
  readonly dispatchAuthorized: boolean;
  readonly authorityGranted: false;
  readonly disposition: 'DURABLY_RESERVED' | 'IDEMPOTENT_DUPLICATE' | 'REJECTED';
  readonly receiptId: string | null;
  readonly deliveryAuditReceiptId: string | null;
  readonly job: Readonly<SignedJobV1> | null;
  readonly reasonCodes: readonly string[];
}

const SIGNED_JOB_KEYS = Object.freeze([
  'schema', 'jobId', 'attemptId', 'caseId', 'evidenceDigest', 'workflowGeneration', 'identityRole', 'providerId', 'modelId', 'baseSha',
  'toolRegistryDigest', 'providerOperationRequestDigest', 'purpose',
]);
const PROOF_KEYS = Object.freeze([
  'schema', 'algorithm', 'keyId', 'keyClassification', 'method', 'routeId', 'issuedAtMs', 'expiresAtMs', 'nonce', 'authenticationProofHex',
]);
const CALLBACK_KEYS = Object.freeze([
  'schema', 'callbackId', 'providerEventId', 'internalRunId', 'jobId', 'attemptId', 'caseId', 'evidenceDigest', 'workflowGeneration',
  'identityRole', 'providerId', 'modelId', 'baseSha', 'resultDigest', 'providerOperationRequestDigest', 'purpose',
]);
const SIGNED_JOB_EXPECTED_KEYS = Object.freeze([
  'routeId', 'jobId', 'attemptId', 'caseId', 'evidenceDigest', 'workflowGeneration', 'identityRole', 'providerId', 'modelId', 'baseSha',
  'toolRegistryDigest', 'providerOperationRequestDigest', 'purpose',
]);
const CALLBACK_EXPECTED_KEYS = Object.freeze([
  'routeId', 'jobId', 'attemptId', 'caseId', 'evidenceDigest', 'workflowGeneration', 'identityRole', 'providerId', 'modelId', 'baseSha',
  'providerOperationRequestDigest', 'purpose',
]);
const SIGNED_JOB_ENVELOPE_KEYS = Object.freeze(['rawBody', 'proof', 'key', 'nowMs', 'routeId']);
const SIGNED_JOB_RESERVATION_KEYS = Object.freeze(['rawBody', 'proof', 'key', 'nowMs', 'expected', 'dedup']);
const CALLBACK_RESERVATION_KEYS = SIGNED_JOB_RESERVATION_KEYS;
const MAX_BODY_BYTES = 65_536;
const MAX_PROOF_LIFETIME_MS = 300_000;

function snapshotPlainDataRecord(value: unknown, expectedKeys?: readonly string[]): Record<string, unknown> | null {
  try {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > 64) return null;
    if (expectedKeys !== undefined && (
      keys.length !== expectedKeys.length
      || keys.some((key) => !expectedKeys.includes(key))
    )) return null;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotRawBody(value: unknown): Uint8Array | null {
  try {
    return value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= MAX_BODY_BYTES ? Uint8Array.from(value) : null;
  } catch {
    return null;
  }
}

function snapshotVerificationKey(value: unknown): Readonly<SyntheticVerificationKey> | null {
  const snapshot = snapshotPlainDataRecord(value, ['keyId', 'classification', 'keyBytes']);
  if (snapshot === null) return null;
  try {
    if (!(snapshot.keyBytes instanceof Uint8Array) || !ArrayBuffer.isView(snapshot.keyBytes)) return null;
    const sourceByteLength = snapshot.keyBytes.byteLength;
    if (sourceByteLength < 16 || sourceByteLength > 4_096) return null;
    const keyBytes = new Uint8Array(sourceByteLength);
    Uint8Array.prototype.set.call(keyBytes, snapshot.keyBytes);
    if (keyBytes.byteLength !== sourceByteLength) return null;
    return Object.freeze({
      keyId: snapshot.keyId,
      classification: snapshot.classification,
      keyBytes,
    }) as Readonly<SyntheticVerificationKey>;
  } catch {
    return null;
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function callbackAuthenticationMessage(
  proof: Omit<Readonly<SyntheticAuthenticationProof>, 'authenticationProofHex'>,
  bodyDigest: string,
): string {
  return [
    proof.algorithm,
    proof.keyId,
    proof.keyClassification,
    proof.method,
    proof.routeId,
    String(proof.issuedAtMs),
    String(proof.expiresAtMs),
    proof.nonce,
    bodyDigest,
  ].join('\n');
}

function proofIssues(
  rawBody: Uint8Array,
  proof: Readonly<SyntheticAuthenticationProof>,
  key: Readonly<SyntheticVerificationKey>,
  nowMs: number,
  expectedMethod: SyntheticAuthenticationProof['method'],
  expectedRouteId: string,
): string[] {
  const issues: string[] = [];
  const bodySnapshot = snapshotRawBody(rawBody);
  const proofSnapshot = snapshotPlainDataRecord(proof, PROOF_KEYS);
  const keySnapshot = snapshotVerificationKey(key);
  if (bodySnapshot === null) return ['RAW_BODY_MUST_BE_UINT8ARRAY'];
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return ['AUTHENTICATION_CLOCK_INVALID'];
  if (proofSnapshot === null) return ['AUTHENTICATION_PROOF_SCHEMA_NOT_CLOSED'];
  if (keySnapshot === null) return ['SYNTHETIC_VERIFICATION_KEY_INVALID'];
  proof = proofSnapshot as unknown as Readonly<SyntheticAuthenticationProof>;
  key = keySnapshot;
  rawBody = bodySnapshot;
  if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_BODY_BYTES) issues.push('RAW_BODY_SIZE_INVALID');
  if (proof.schema !== 'AI_OPS_SYNTHETIC_AUTHENTICATION_PROOF_V1') issues.push('AUTHENTICATION_PROOF_SCHEMA_UNSUPPORTED');
  if (proof.algorithm !== 'HMAC_SHA256_TEST_ONLY' || proof.keyClassification !== 'TEST_ONLY_SYNTHETIC_INVALID') {
    issues.push('NON_SYNTHETIC_AUTHENTICATION_FORBIDDEN');
  }
  if (key.classification !== 'TEST_ONLY_SYNTHETIC_INVALID' || proof.keyId !== key.keyId) issues.push('SYNTHETIC_KEY_BINDING_MISMATCH');
  if (!isBoundedIdentifier(proof.keyId) || !isBoundedIdentifier(proof.routeId) || !isBoundedIdentifier(proof.nonce)) {
    issues.push('AUTHENTICATION_PROOF_IDENTIFIER_INVALID');
  }
  if (proof.method !== expectedMethod || proof.routeId !== expectedRouteId) issues.push('AUTHENTICATION_ROUTE_BINDING_MISMATCH');
  if (
    !Number.isSafeInteger(proof.issuedAtMs)
    || !Number.isSafeInteger(proof.expiresAtMs)
    || proof.expiresAtMs <= proof.issuedAtMs
    || proof.expiresAtMs - proof.issuedAtMs > MAX_PROOF_LIFETIME_MS
    || nowMs < proof.issuedAtMs
    || nowMs >= proof.expiresAtMs
  ) issues.push('AUTHENTICATION_PROOF_STALE_OR_INVALID');
  if (typeof proof.authenticationProofHex !== 'string' || !/^[a-f0-9]{64}$/.test(proof.authenticationProofHex)) issues.push('AUTHENTICATION_PROOF_ENCODING_INVALID');

  if (issues.length === 0) {
    const bodyDigest = sha256Hex(rawBody);
    const message = callbackAuthenticationMessage(proof, bodyDigest);
    const expected = createHmac('sha256', key.keyBytes).update(message).digest();
    const received = Buffer.from(proof.authenticationProofHex, 'hex');
    if (received.byteLength !== expected.byteLength || !timingSafeEqual(received, expected)) issues.push('AUTHENTICATION_PROOF_MISMATCH');
  }
  return issues;
}

function parseRawObject(rawBody: Uint8Array): Record<string, unknown> | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    const value = JSON.parse(text) as unknown;
    return isPlainRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort((left, right) => left.localeCompare(right));
  const wanted = [...expected].sort((left, right) => left.localeCompare(right));
  return actual.join('\u0000') === wanted.join('\u0000');
}

function validSharedJobFields(record: Record<string, unknown>): boolean {
  const identifiers = ['jobId', 'attemptId', 'caseId', 'providerId', 'modelId'];
  const digests = ['evidenceDigest'];
  const expectedRole = record.purpose === 'DIAGNOSE'
    ? 'RUNTIME_DIAGNOSTICIAN'
    : record.purpose === 'REPAIR'
      ? 'ENGINEERING_REPAIR_WORKER'
      : record.purpose === 'VERIFY'
        ? 'INDEPENDENT_VERIFIER'
        : null;
  return identifiers.every((field) => isBoundedIdentifier(record[field]))
    && digests.every((field) => isLowercaseSha256(record[field]))
    && isGitCommitSha(record.baseSha)
    && Number.isSafeInteger(record.workflowGeneration)
    && (record.workflowGeneration as number) >= 0
    && isExactIdentityRole(record.identityRole)
    && record.identityRole !== 'RESEARCH_TRADE_CONTEXT_ADVISOR'
    && expectedRole !== null
    && record.identityRole === expectedRole;
}

export function verifySignedJobEnvelope(input: Readonly<{
  rawBody: Uint8Array;
  proof: Readonly<SyntheticAuthenticationProof>;
  key: Readonly<SyntheticVerificationKey>;
  nowMs: number;
  routeId: string;
}>): Readonly<{ valid: boolean; authorityGranted: false; job: Readonly<SignedJobV1> | null; reasonCodes: readonly string[] }> {
  const inputSnapshot = snapshotPlainDataRecord(input, SIGNED_JOB_ENVELOPE_KEYS);
  if (inputSnapshot === null) {
    return Object.freeze({ valid: false, authorityGranted: false, job: null, reasonCodes: Object.freeze(['SIGNED_JOB_ENVELOPE_SCHEMA_REJECTED']) });
  }
  const rawBody = snapshotRawBody(inputSnapshot.rawBody);
  if (rawBody === null) {
    return Object.freeze({ valid: false, authorityGranted: false, job: null, reasonCodes: Object.freeze(['RAW_BODY_MUST_BE_UINT8ARRAY']) });
  }
  const issues = proofIssues(
    rawBody,
    inputSnapshot.proof as Readonly<SyntheticAuthenticationProof>,
    inputSnapshot.key as Readonly<SyntheticVerificationKey>,
    inputSnapshot.nowMs as number,
    'INTERNAL',
    inputSnapshot.routeId as string,
  );
  if (issues.length > 0) return Object.freeze({ valid: false, authorityGranted: false, job: null, reasonCodes: Object.freeze(issues) });
  const record = parseRawObject(rawBody);
  if (record === null || !exactKeys(record, SIGNED_JOB_KEYS) || record.schema !== 'AI_OPS_SIGNED_JOB_V1' || !validSharedJobFields(record)) {
    return Object.freeze({ valid: false, authorityGranted: false, job: null, reasonCodes: Object.freeze(['SIGNED_JOB_SCHEMA_REJECTED']) });
  }
  if (!isLowercaseSha256(record.toolRegistryDigest) || !isLowercaseSha256(record.providerOperationRequestDigest)) {
    return Object.freeze({ valid: false, authorityGranted: false, job: null, reasonCodes: Object.freeze(['SIGNED_JOB_TOOL_REGISTRY_DIGEST_INVALID']) });
  }
  return Object.freeze({ valid: true, authorityGranted: false, job: Object.freeze(record as unknown as SignedJobV1), reasonCodes: Object.freeze([]) });
}

function normalizedReservationResult(value: unknown): Readonly<DurableDeliveryReservationResult> | null {
  const snapshot = snapshotPlainDataRecord(value, ['status', 'receiptId', 'deliveryAuditReceiptId']);
  if (snapshot === null || !['RESERVED', 'DUPLICATE', 'CONFLICT', 'UNAVAILABLE'].includes(snapshot.status as string)) return null;
  if (snapshot.status === 'UNAVAILABLE') {
    return snapshot.receiptId === null && snapshot.deliveryAuditReceiptId === null
      ? Object.freeze({ status: 'UNAVAILABLE', receiptId: null, deliveryAuditReceiptId: null })
      : null;
  }
  if (!isBoundedIdentifier(snapshot.deliveryAuditReceiptId)) return null;
  if (snapshot.status === 'CONFLICT') {
    return snapshot.receiptId === null || isBoundedIdentifier(snapshot.receiptId)
      ? Object.freeze({ status: 'CONFLICT', receiptId: snapshot.receiptId as string | null, deliveryAuditReceiptId: snapshot.deliveryAuditReceiptId })
      : null;
  }
  return isBoundedIdentifier(snapshot.receiptId)
    ? Object.freeze({ status: snapshot.status as 'RESERVED' | 'DUPLICATE', receiptId: snapshot.receiptId, deliveryAuditReceiptId: snapshot.deliveryAuditReceiptId })
    : null;
}

function purposeMatchesRole(record: Record<string, unknown>): boolean {
  return (record.purpose === 'DIAGNOSE' && record.identityRole === 'RUNTIME_DIAGNOSTICIAN')
    || (record.purpose === 'REPAIR' && record.identityRole === 'ENGINEERING_REPAIR_WORKER')
    || (record.purpose === 'VERIFY' && record.identityRole === 'INDEPENDENT_VERIFIER');
}

function validExpectedShared(record: Record<string, unknown>): boolean {
  return isBoundedIdentifier(record.routeId)
    && isBoundedIdentifier(record.jobId)
    && isBoundedIdentifier(record.attemptId)
    && isBoundedIdentifier(record.caseId)
    && isBoundedIdentifier(record.providerId)
    && isBoundedIdentifier(record.modelId)
    && isLowercaseSha256(record.evidenceDigest)
    && Number.isSafeInteger(record.workflowGeneration)
    && (record.workflowGeneration as number) >= 0
    && isExactIdentityRole(record.identityRole)
    && record.identityRole !== 'RESEARCH_TRADE_CONTEXT_ADVISOR'
    && isGitCommitSha(record.baseSha)
    && isLowercaseSha256(record.providerOperationRequestDigest)
    && purposeMatchesRole(record);
}

function rejectedSignedJob(reasonCodes: readonly string[]): Readonly<SignedJobAdmissionResult> {
  return Object.freeze({
    schema: 'AI_OPS_SIGNED_JOB_ADMISSION_RESULT_V1',
    accepted: false,
    dispatchAuthorized: false,
    authorityGranted: false,
    disposition: 'REJECTED',
    receiptId: null,
    deliveryAuditReceiptId: null,
    job: null,
    reasonCodes: Object.freeze([...reasonCodes]),
  });
}

export async function verifyAndReserveSignedJobEnvelope(input: Readonly<{
  rawBody: Uint8Array;
  proof: Readonly<SyntheticAuthenticationProof>;
  key: Readonly<SyntheticVerificationKey>;
  nowMs: number;
  expected: Readonly<SignedJobExpectedBinding>;
  dedup: CallbackDedupPort;
}>): Promise<Readonly<SignedJobAdmissionResult>> {
  const outer = snapshotPlainDataRecord(input, SIGNED_JOB_RESERVATION_KEYS);
  const expectedSnapshot = outer === null ? null : snapshotPlainDataRecord(outer.expected, SIGNED_JOB_EXPECTED_KEYS);
  const proofSnapshot = outer === null ? null : snapshotPlainDataRecord(outer.proof, PROOF_KEYS);
  const keySnapshot = outer === null ? null : snapshotPlainDataRecord(outer.key, ['keyId', 'classification', 'keyBytes']);
  const dedupSnapshot = outer === null ? null : snapshotPlainDataRecord(outer.dedup);
  const rawBody = outer === null ? null : snapshotRawBody(outer.rawBody);
  if (
    outer === null
    || expectedSnapshot === null
    || proofSnapshot === null
    || keySnapshot === null
    || dedupSnapshot === null
    || rawBody === null
    || !validExpectedShared(expectedSnapshot)
    || !isLowercaseSha256(expectedSnapshot.toolRegistryDigest)
  ) return rejectedSignedJob(['SIGNED_JOB_OUTER_BINDING_SCHEMA_REJECTED']);
  const expected = expectedSnapshot as unknown as Readonly<SignedJobExpectedBinding>;
  const proof = proofSnapshot as unknown as Readonly<SyntheticAuthenticationProof>;
  const key = keySnapshot as unknown as Readonly<SyntheticVerificationKey>;
  const verification = verifySignedJobEnvelope({
    rawBody,
    proof,
    key,
    nowMs: outer.nowMs as number,
    routeId: expected.routeId,
  });
  if (!verification.valid || verification.job === null) {
    return rejectedSignedJob(verification.reasonCodes);
  }
  const job = verification.job;
  const mismatch = (['jobId', 'attemptId', 'caseId', 'evidenceDigest', 'workflowGeneration', 'identityRole', 'providerId', 'modelId', 'baseSha', 'toolRegistryDigest', 'providerOperationRequestDigest', 'purpose'] as const)
    .filter((field) => job[field] !== expected[field])
    .map((field) => `SIGNED_JOB_BINDING_MISMATCH_${field.toUpperCase()}`);
  if (mismatch.length > 0) {
    return Object.freeze({
      schema: 'AI_OPS_SIGNED_JOB_ADMISSION_RESULT_V1',
      accepted: false,
      dispatchAuthorized: false,
      authorityGranted: false,
      disposition: 'REJECTED',
      receiptId: null,
      deliveryAuditReceiptId: null,
      job: null,
      reasonCodes: Object.freeze(mismatch),
    });
  }
  let reservation: unknown;
  try {
    if (dedupSnapshot.schema !== 'AI_OPS_CALLBACK_DEDUP_PORT_V1' || typeof dedupSnapshot.reserveAuthenticatedJob !== 'function') throw new TypeError('signed job dedup port schema unsupported');
    reservation = await dedupSnapshot.reserveAuthenticatedJob({
      replayKey: `${proof.keyId}:${proof.nonce}`,
      contentDigest: sha256Hex(rawBody),
      jobId: job.jobId,
      attemptId: job.attemptId,
      workflowGeneration: job.workflowGeneration,
      providerId: job.providerId,
      modelId: job.modelId,
      baseSha: job.baseSha,
      toolRegistryDigest: job.toolRegistryDigest,
      providerOperationRequestDigest: job.providerOperationRequestDigest,
      expiresAtMs: proof.expiresAtMs,
    });
  } catch {
    reservation = null;
  }
  const normalizedReservation = normalizedReservationResult(reservation);
  if (normalizedReservation === null || normalizedReservation.status === 'UNAVAILABLE') {
    return Object.freeze({
      schema: 'AI_OPS_SIGNED_JOB_ADMISSION_RESULT_V1',
      accepted: false,
      dispatchAuthorized: false,
      authorityGranted: false,
      disposition: 'REJECTED',
      receiptId: null,
      deliveryAuditReceiptId: null,
      job: null,
      reasonCodes: Object.freeze([normalizedReservation === null ? 'SIGNED_JOB_RESERVATION_RESULT_INVALID' : 'SIGNED_JOB_RESERVATION_UNAVAILABLE']),
    });
  }
  const acceptedReservation = normalizedReservation;
  if (acceptedReservation.status === 'CONFLICT') {
    return Object.freeze({
      schema: 'AI_OPS_SIGNED_JOB_ADMISSION_RESULT_V1',
      accepted: false,
      dispatchAuthorized: false,
      authorityGranted: false,
      disposition: 'REJECTED',
      receiptId: acceptedReservation.receiptId,
      deliveryAuditReceiptId: acceptedReservation.deliveryAuditReceiptId,
      job: null,
      reasonCodes: Object.freeze(['SIGNED_JOB_DEDUP_CONFLICT']),
    });
  }
  return Object.freeze({
    schema: 'AI_OPS_SIGNED_JOB_ADMISSION_RESULT_V1',
    accepted: true,
    dispatchAuthorized: acceptedReservation.status === 'RESERVED',
    authorityGranted: false,
    disposition: acceptedReservation.status === 'RESERVED' ? 'DURABLY_RESERVED' : 'IDEMPOTENT_DUPLICATE',
    receiptId: acceptedReservation.receiptId,
    deliveryAuditReceiptId: acceptedReservation.deliveryAuditReceiptId,
    job,
    reasonCodes: Object.freeze(acceptedReservation.status === 'DUPLICATE' ? ['IDEMPOTENT_SIGNED_JOB_DUPLICATE'] : []),
  });
}

function parseCallback(rawBody: Uint8Array): Readonly<ProviderCallbackV1> | null {
  const record = parseRawObject(rawBody);
  if (record === null || !exactKeys(record, CALLBACK_KEYS) || record.schema !== 'AI_OPS_PROVIDER_CALLBACK_V1' || !validSharedJobFields(record)) return null;
  for (const field of ['callbackId', 'providerEventId', 'internalRunId', 'providerId', 'modelId'] as const) {
    if (!isBoundedIdentifier(record[field])) return null;
  }
  if (!isLowercaseSha256(record.resultDigest) || !isLowercaseSha256(record.providerOperationRequestDigest)) return null;
  return Object.freeze(record as unknown as ProviderCallbackV1);
}

function bindingIssues(callback: Readonly<ProviderCallbackV1>, expected: Readonly<CallbackExpectedBinding>): string[] {
  const issues: string[] = [];
  for (const field of ['jobId', 'attemptId', 'caseId', 'evidenceDigest', 'workflowGeneration', 'identityRole', 'providerId', 'modelId', 'baseSha', 'providerOperationRequestDigest', 'purpose'] as const) {
    if (callback[field] !== expected[field]) issues.push(`CALLBACK_BINDING_MISMATCH_${field.toUpperCase()}`);
  }
  return issues;
}

function rejected(
  httpStatus: 400 | 401 | 409 | 503,
  reasons: readonly string[],
  receiptId: string | null = null,
  deliveryAuditReceiptId: string | null = null,
): Readonly<CallbackAdmissionResult> {
  return Object.freeze({
    schema: 'AI_OPS_CALLBACK_ADMISSION_RESULT_V1',
    acknowledged: false,
    enqueueAuthorized: false,
    authorityGranted: false,
    httpStatus,
    disposition: 'REJECTED',
    effectSemantics: 'EFFECT_UNKNOWN',
    receiptId,
    deliveryAuditReceiptId,
    callback: null,
    reasonCodes: Object.freeze([...reasons]),
  });
}

export async function verifyAndReserveProviderCallback(input: Readonly<{
  rawBody: Uint8Array;
  proof: Readonly<SyntheticAuthenticationProof>;
  key: Readonly<SyntheticVerificationKey>;
  nowMs: number;
  expected: Readonly<CallbackExpectedBinding>;
  dedup: CallbackDedupPort;
}>): Promise<Readonly<CallbackAdmissionResult>> {
  const outer = snapshotPlainDataRecord(input, CALLBACK_RESERVATION_KEYS);
  const expectedSnapshot = outer === null ? null : snapshotPlainDataRecord(outer.expected, CALLBACK_EXPECTED_KEYS);
  const proofSnapshot = outer === null ? null : snapshotPlainDataRecord(outer.proof, PROOF_KEYS);
  const keySnapshot = outer === null ? null : snapshotPlainDataRecord(outer.key, ['keyId', 'classification', 'keyBytes']);
  const dedupSnapshot = outer === null ? null : snapshotPlainDataRecord(outer.dedup);
  const rawBody = outer === null ? null : snapshotRawBody(outer.rawBody);
  if (
    outer === null
    || expectedSnapshot === null
    || proofSnapshot === null
    || keySnapshot === null
    || dedupSnapshot === null
    || rawBody === null
    || !validExpectedShared(expectedSnapshot)
    || !isBoundedIdentifier(expectedSnapshot.providerId)
    || !isBoundedIdentifier(expectedSnapshot.modelId)
  ) return rejected(400, ['CALLBACK_OUTER_BINDING_SCHEMA_REJECTED']);
  const expected = expectedSnapshot as unknown as Readonly<CallbackExpectedBinding>;
  const proof = proofSnapshot as unknown as Readonly<SyntheticAuthenticationProof>;
  const key = keySnapshot as unknown as Readonly<SyntheticVerificationKey>;
  const proofFailures = proofIssues(rawBody, proof, key, outer.nowMs as number, 'POST', expected.routeId);
  if (proofFailures.length > 0) return rejected(401, proofFailures);

  const callback = parseCallback(rawBody);
  if (callback === null) return rejected(400, ['CALLBACK_SCHEMA_REJECTED']);
  const mismatches = bindingIssues(callback, expected);
  if (mismatches.length > 0) return rejected(409, mismatches);

  let reservation: unknown;
  try {
    if (dedupSnapshot.schema !== 'AI_OPS_CALLBACK_DEDUP_PORT_V1' || typeof dedupSnapshot.reserveAuthenticatedCallback !== 'function') throw new TypeError('callback dedup port schema unsupported');
    reservation = await dedupSnapshot.reserveAuthenticatedCallback({
      replayKey: `${proof.keyId}:${proof.nonce}`,
      providerEventId: callback.providerEventId,
      internalRunId: callback.internalRunId,
      callbackId: callback.callbackId,
      contentDigest: sha256Hex(rawBody),
      expiresAtMs: proof.expiresAtMs,
      jobId: callback.jobId,
      attemptId: callback.attemptId,
      workflowGeneration: callback.workflowGeneration,
      providerId: callback.providerId,
      modelId: callback.modelId,
    });
  } catch {
    reservation = null;
  }
  const normalizedReservation = normalizedReservationResult(reservation);
  if (normalizedReservation === null) return rejected(503, ['CALLBACK_DEDUP_RESULT_INVALID']);
  const acceptedReservation = normalizedReservation;
  if (acceptedReservation.status === 'UNAVAILABLE') return rejected(503, ['CALLBACK_DEDUP_RESERVATION_UNAVAILABLE']);
  if (acceptedReservation.status === 'CONFLICT') {
    return rejected(409, ['CALLBACK_DEDUP_CONFLICT'], acceptedReservation.receiptId, acceptedReservation.deliveryAuditReceiptId);
  }

  return Object.freeze({
    schema: 'AI_OPS_CALLBACK_ADMISSION_RESULT_V1',
    acknowledged: true,
    enqueueAuthorized: acceptedReservation.status === 'RESERVED',
    authorityGranted: false,
    httpStatus: 202,
    disposition: acceptedReservation.status === 'RESERVED' ? 'DURABLY_RESERVED' : 'IDEMPOTENT_DUPLICATE',
    effectSemantics: 'EFFECT_UNKNOWN',
    receiptId: acceptedReservation.receiptId,
    deliveryAuditReceiptId: acceptedReservation.deliveryAuditReceiptId,
    callback,
    reasonCodes: Object.freeze(acceptedReservation.status === 'DUPLICATE' ? ['IDEMPOTENT_CALLBACK_DUPLICATE'] : []),
  });
}
