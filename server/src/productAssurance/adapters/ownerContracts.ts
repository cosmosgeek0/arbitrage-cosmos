import { createHash } from 'node:crypto';

import {
  assertDigestOrNull,
  assertIdentifier,
  isPlainRecord,
  sortedUnique,
  type AssuranceVerdict,
} from '../common.js';

/**
 * These surfaces already have a canonical satellite/runtime owner. Product
 * Assurance may bind and pass through an accepted owner artifact; it may not
 * recreate the owner's evaluator, allocator, graph, or runtime truth.
 */
export const OWNER_CONTRACT_SURFACES = Object.freeze([
  'ACTION_EVIDENCE',
  'ASSURANCE_CASE',
  'DIAGNOSTIC_GOVERNANCE',
  'COVERAGE',
  'RATE_BUDGET',
] as const);
export type OwnerContractSurface = (typeof OWNER_CONTRACT_SURFACES)[number];

export const OWNER_CONTRACT_WAITING_SEAMS: Readonly<Record<OwnerContractSurface, Readonly<{
  ownerId: string;
  targetSeam: string;
  blocker: string;
}>>> = Object.freeze({
  ACTION_EVIDENCE: Object.freeze({
    ownerId: 'ACTION_EVIDENCE_SATELLITE',
    targetSeam: 'fixtures/productAssurance/systemic/actionEvidence/**',
    blocker: 'DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING',
  }),
  ASSURANCE_CASE: Object.freeze({
    ownerId: 'ASSURANCE_CASE_SATELLITE',
    targetSeam: 'fixtures/productAssurance/systemic/assuranceCase/**',
    blocker: 'DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING',
  }),
  DIAGNOSTIC_GOVERNANCE: Object.freeze({
    ownerId: 'A_AGENT_DIAGNOSTIC_GOVERNANCE',
    targetSeam: 'fixtures/productAssurance/systemic/agentBoundary/**',
    blocker: 'DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING',
  }),
  COVERAGE: Object.freeze({
    ownerId: 'I08_S5_COVERAGE_OWNER',
    targetSeam: 'canonical systemIntegration supervisor plus accepted S5 coverage contract',
    blocker: 'DIRECTOR_ACCEPTED_S5_AND_I08_OWNER_CONTRACT_MISSING',
  }),
  RATE_BUDGET: Object.freeze({
    ownerId: 'INTELLIGENCE_RUNTIME_RATE_BUDGET',
    targetSeam: 'server/src/intelligenceRuntime lifecycle and aggregate snapshot contract',
    blocker: 'AGGREGATE_RATE_BUDGET_OWNER_CONTRACT_NOT_CONFIGURED',
  }),
});

export interface OwnerContractTuple {
  readonly schema: 'PRODUCT_ASSURANCE_OWNER_CONTRACT_TUPLE_V1';
  readonly surface: OwnerContractSurface;
  readonly ownerId: string;
  readonly releaseId: string;
  readonly subjectId: string;
  readonly digestAlgorithm: 'sha256';
  readonly digest: string;
}

export interface OwnerContractEnvelope<TPayload> {
  readonly schema: 'PRODUCT_ASSURANCE_OWNER_CONTRACT_ENVELOPE_V1';
  readonly tuple: Readonly<OwnerContractTuple>;
  /** SHA-256 over the exact ordered tuple, including the payload digest. */
  readonly tupleDigest: string;
  readonly payload: TPayload;
}

export interface OwnerContractExpectation {
  readonly surface: OwnerContractSurface;
  readonly ownerId: string;
  readonly releaseId: string;
  readonly subjectId: string;
  readonly digestAlgorithm: 'sha256';
  readonly digest: string;
}

export interface OwnerContractConsumption<TPayload> {
  readonly surface: OwnerContractSurface;
  readonly state: 'WAITING' | 'REJECTED' | 'CONSUMED';
  readonly verdict: AssuranceVerdict;
  readonly ownerId: string;
  readonly releaseId: string | null;
  readonly subjectId: string | null;
  readonly digest: string | null;
  /** Present only after exact tuple verification succeeds. */
  readonly tupleDigest: string | null;
  /** Canonical frozen envelope retained so downstream adapters can reverify against their own trusted expectation. */
  readonly envelope: Readonly<OwnerContractEnvelope<TPayload>> | null;
  readonly reasonCodes: readonly string[];
  readonly payload: TPayload | null;
  readonly authorityGranted: false;
}

function canonicalValue(value: unknown, label: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError(`${label} must be a dense JSON array without additional properties`);
    }
    return Object.freeze(value.map((entry, index) => canonicalValue(entry, `${label}[${index}]`)));
  }
  if (!isPlainRecord(value)) throw new TypeError(`${label} must contain only plain JSON values`);
  // A null prototype makes keys such as "__proto__" ordinary data. Using `{}`
  // here would silently drop that own key from the digest by invoking the
  // legacy prototype setter and would permit a payload-digest collision.
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry === undefined) throw new TypeError(`${label}.${key} cannot be undefined`);
    output[key] = canonicalValue(entry, `${label}.${key}`);
  }
  return Object.freeze(output);
}

function snapshotOwnerContractPayload<TPayload>(payload: TPayload): TPayload {
  return canonicalValue(payload, 'ownerContract') as TPayload;
}

export function canonicalOwnerContractJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, 'ownerContract'));
}

export function digestOwnerContractPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalOwnerContractJson(payload), 'utf8').digest('hex');
}

export function computeOwnerContractTupleDigest(tuple: Readonly<OwnerContractTuple>): string {
  return createHash('sha256').update(JSON.stringify([
    tuple.schema,
    tuple.surface,
    tuple.ownerId,
    tuple.releaseId,
    tuple.subjectId,
    tuple.digestAlgorithm,
    tuple.digest,
  ]), 'utf8').digest('hex');
}

function validateExpectation(expectation: Readonly<OwnerContractExpectation>): void {
  if (!(OWNER_CONTRACT_SURFACES as readonly unknown[]).includes(expectation.surface)) {
    throw new TypeError('owner contract expectation surface unsupported');
  }
  assertIdentifier(expectation.ownerId, 'expectation.ownerId');
  assertIdentifier(expectation.releaseId, 'expectation.releaseId');
  assertIdentifier(expectation.subjectId, 'expectation.subjectId');
  if (expectation.digestAlgorithm !== 'sha256') throw new TypeError('owner contract digest algorithm must be sha256');
  assertDigestOrNull(expectation.digest, 'expectation.digest');
  if (expectation.digest === null) throw new TypeError('owner contract expectation digest is required');
}

function rejectedOwnerContract<TPayload>(
  expectation: Readonly<OwnerContractExpectation>,
  canonicalOwnerId: string,
  failed: readonly string[],
  tuple: Readonly<Record<string, unknown>> | null = null,
): Readonly<OwnerContractConsumption<TPayload>> {
  return Object.freeze({
    surface: expectation.surface,
    state: 'REJECTED',
    verdict: 'FAIL',
    ownerId: canonicalOwnerId,
    releaseId: typeof tuple?.releaseId === 'string' ? tuple.releaseId : null,
    subjectId: typeof tuple?.subjectId === 'string' ? tuple.subjectId : null,
    digest: typeof tuple?.digest === 'string' ? tuple.digest : null,
    tupleDigest: null,
    envelope: null,
    reasonCodes: sortedUnique(failed),
    payload: null,
    authorityGranted: false,
  });
}

export function bindOwnerContract<TPayload>(
  identity: Omit<OwnerContractTuple, 'schema' | 'digestAlgorithm' | 'digest'>,
  payload: TPayload,
): Readonly<OwnerContractEnvelope<TPayload>> {
  if (!(OWNER_CONTRACT_SURFACES as readonly unknown[]).includes(identity.surface)) {
    throw new TypeError('owner contract surface unsupported');
  }
  assertIdentifier(identity.ownerId, 'identity.ownerId');
  assertIdentifier(identity.releaseId, 'identity.releaseId');
  assertIdentifier(identity.subjectId, 'identity.subjectId');
  const canonicalOwnerId = OWNER_CONTRACT_WAITING_SEAMS[identity.surface].ownerId;
  if (identity.ownerId !== canonicalOwnerId) {
    throw new TypeError(`identity.ownerId must equal the registered canonical owner ${canonicalOwnerId}`);
  }
  const payloadSnapshot = snapshotOwnerContractPayload(payload);
  const tuple = Object.freeze({
    schema: 'PRODUCT_ASSURANCE_OWNER_CONTRACT_TUPLE_V1' as const,
    surface: identity.surface,
    ownerId: identity.ownerId,
    releaseId: identity.releaseId,
    subjectId: identity.subjectId,
    digestAlgorithm: 'sha256' as const,
    digest: digestOwnerContractPayload(payloadSnapshot),
  });
  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_OWNER_CONTRACT_ENVELOPE_V1' as const,
    tuple,
    tupleDigest: computeOwnerContractTupleDigest(tuple),
    payload: payloadSnapshot,
  });
}

/**
 * Verifies the exact owner/release/subject/digest tuple as one conjunction.
 * A tuple mismatch never yields payload and never grants owner authority.
 */
export function consumeOwnerContract<TPayload>(
  envelope: Readonly<OwnerContractEnvelope<TPayload>> | null,
  expectation: Readonly<OwnerContractExpectation>,
): Readonly<OwnerContractConsumption<TPayload>> {
  validateExpectation(expectation);
  const canonicalOwnerId = OWNER_CONTRACT_WAITING_SEAMS[expectation.surface].ownerId;
  const expectationFailures: string[] = [];
  if (expectation.ownerId !== canonicalOwnerId) {
    expectationFailures.push('OWNER_CONTRACT_EXPECTATION_OWNER_NOT_CANONICAL');
  }
  if (envelope === null) {
    if (expectationFailures.length > 0) {
      return rejectedOwnerContract(expectation, canonicalOwnerId, expectationFailures);
    }
    return Object.freeze({
      surface: expectation.surface,
      state: 'WAITING',
      verdict: 'UNKNOWN',
      ownerId: canonicalOwnerId,
      releaseId: null,
      subjectId: null,
      digest: null,
      tupleDigest: null,
      envelope: null,
      reasonCodes: Object.freeze(['OWNER_CONTRACT_WAITING']),
      payload: null,
      authorityGranted: false,
    });
  }
  const failed: string[] = [...expectationFailures];
  const envelopeKeys = ['payload', 'schema', 'tuple', 'tupleDigest'];
  const tupleKeys = ['digest', 'digestAlgorithm', 'ownerId', 'releaseId', 'schema', 'subjectId', 'surface'];
  if (!isPlainRecord(envelope)) {
    failed.push('OWNER_CONTRACT_ENVELOPE_FIELD_SET_MISMATCH');
    return rejectedOwnerContract(expectation, canonicalOwnerId, failed);
  }
  if (Object.keys(envelope).sort().join('\n') !== envelopeKeys.join('\n')) {
    failed.push('OWNER_CONTRACT_ENVELOPE_FIELD_SET_MISMATCH');
  }
  if (envelope.schema !== 'PRODUCT_ASSURANCE_OWNER_CONTRACT_ENVELOPE_V1') failed.push('OWNER_CONTRACT_ENVELOPE_SCHEMA_MISMATCH');
  const tupleRecord = isPlainRecord(envelope.tuple) ? envelope.tuple : null;
  if (tupleRecord === null) {
    failed.push('OWNER_CONTRACT_TUPLE_FIELD_SET_MISMATCH');
    return rejectedOwnerContract(expectation, canonicalOwnerId, failed);
  }
  if (Object.keys(tupleRecord).sort().join('\n') !== tupleKeys.join('\n')) {
    failed.push('OWNER_CONTRACT_TUPLE_FIELD_SET_MISMATCH');
  }
  const tuple = tupleRecord as unknown as Readonly<OwnerContractTuple>;
  if (tuple.schema !== 'PRODUCT_ASSURANCE_OWNER_CONTRACT_TUPLE_V1') failed.push('OWNER_CONTRACT_TUPLE_SCHEMA_MISMATCH');
  if (!(OWNER_CONTRACT_SURFACES as readonly unknown[]).includes(tuple.surface)) failed.push('OWNER_CONTRACT_SURFACE_UNSUPPORTED');
  if (tuple.surface !== expectation.surface) failed.push('OWNER_CONTRACT_SURFACE_MISMATCH');
  try { assertIdentifier(tuple.ownerId, 'tuple.ownerId'); } catch { failed.push('OWNER_CONTRACT_OWNER_INVALID'); }
  try { assertIdentifier(tuple.releaseId, 'tuple.releaseId'); } catch { failed.push('OWNER_CONTRACT_RELEASE_INVALID'); }
  try { assertIdentifier(tuple.subjectId, 'tuple.subjectId'); } catch { failed.push('OWNER_CONTRACT_SUBJECT_INVALID'); }
  if (tuple.ownerId !== canonicalOwnerId) failed.push('OWNER_CONTRACT_OWNER_NOT_CANONICAL');
  if (tuple.ownerId !== expectation.ownerId) failed.push('OWNER_CONTRACT_OWNER_MISMATCH');
  if (tuple.releaseId !== expectation.releaseId) failed.push('OWNER_CONTRACT_RELEASE_MISMATCH');
  if (tuple.subjectId !== expectation.subjectId) failed.push('OWNER_CONTRACT_SUBJECT_MISMATCH');
  if (tuple.digestAlgorithm !== 'sha256' || tuple.digestAlgorithm !== expectation.digestAlgorithm) {
    failed.push('OWNER_CONTRACT_DIGEST_ALGORITHM_MISMATCH');
  }
  try { assertDigestOrNull(tuple.digest, 'tuple.digest'); } catch { failed.push('OWNER_CONTRACT_DIGEST_INVALID'); }
  let actualPayloadDigest: string | null = null;
  let payloadSnapshot: TPayload | null = null;
  try {
    payloadSnapshot = snapshotOwnerContractPayload(envelope.payload as TPayload);
    actualPayloadDigest = digestOwnerContractPayload(payloadSnapshot);
  } catch {
    failed.push('OWNER_CONTRACT_PAYLOAD_NOT_CANONICAL');
  }
  if (tuple.digest !== expectation.digest) failed.push('OWNER_CONTRACT_DIGEST_MISMATCH');
  if (actualPayloadDigest === null || tuple.digest !== actualPayloadDigest) failed.push('OWNER_CONTRACT_PAYLOAD_DIGEST_MISMATCH');
  let actualTupleDigest: string | null = null;
  try { actualTupleDigest = computeOwnerContractTupleDigest(tuple); } catch { failed.push('OWNER_CONTRACT_TUPLE_INVALID'); }
  try { assertDigestOrNull(envelope.tupleDigest, 'envelope.tupleDigest'); } catch { failed.push('OWNER_CONTRACT_TUPLE_DIGEST_INVALID'); }
  if (actualTupleDigest === null || envelope.tupleDigest !== actualTupleDigest) failed.push('OWNER_CONTRACT_TUPLE_DIGEST_MISMATCH');

  if (failed.length > 0) {
    return rejectedOwnerContract(expectation, canonicalOwnerId, failed, tupleRecord);
  }
  const verifiedTuple = Object.freeze({
    schema: tuple.schema,
    surface: tuple.surface,
    ownerId: tuple.ownerId,
    releaseId: tuple.releaseId,
    subjectId: tuple.subjectId,
    digestAlgorithm: tuple.digestAlgorithm,
    digest: tuple.digest,
  });
  const verifiedEnvelope = Object.freeze({
    schema: 'PRODUCT_ASSURANCE_OWNER_CONTRACT_ENVELOPE_V1' as const,
    tuple: verifiedTuple,
    tupleDigest: envelope.tupleDigest,
    payload: payloadSnapshot as TPayload,
  });
  return Object.freeze({
    surface: expectation.surface,
    state: 'CONSUMED',
    verdict: 'PASS',
    ownerId: tuple.ownerId,
    releaseId: tuple.releaseId,
    subjectId: tuple.subjectId,
    digest: tuple.digest,
    tupleDigest: envelope.tupleDigest,
    envelope: verifiedEnvelope,
    reasonCodes: Object.freeze([]),
    payload: payloadSnapshot as TPayload,
    authorityGranted: false,
  });
}
