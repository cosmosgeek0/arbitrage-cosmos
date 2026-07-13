import { createHash } from 'node:crypto';

import { isValidUtcMillis } from '../foundation/contracts/time.js';
import {
  SYSTEM_TRUTH_LABELS,
  type SystemTruthLabel,
} from '../systemIntegration/contracts/constants.js';

export const ASSURANCE_VERDICTS = Object.freeze(['PASS', 'FAIL', 'UNKNOWN'] as const);
export type AssuranceVerdict = (typeof ASSURANCE_VERDICTS)[number];

export const ASSURANCE_SEVERITIES = Object.freeze([
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL',
] as const);
export type AssuranceSeverity = (typeof ASSURANCE_SEVERITIES)[number];

export interface AssuranceEvidenceRef {
  readonly evidenceId: string;
  readonly ownerId: string;
  readonly sourcePath: string;
  readonly observedAtMs: number;
  readonly expiresAtMs: number | null;
  readonly truthLabel: SystemTruthLabel;
  readonly digest: string | null;
  readonly producerId: string;
  readonly verifierId: string | null;
}

/**
 * Exact consumer-policy binding for one evidence artifact. The tuple digest
 * prevents splicing independently valid owner, release, subject, and artifact
 * fields. It is evidence integrity only and never grants domain authority.
 */
export interface AssuranceEvidenceBinding {
  readonly schema: 'PRODUCT_ASSURANCE_EVIDENCE_BINDING_V1';
  readonly ownerId: string;
  readonly releaseId: string;
  readonly testedCommit: string;
  readonly subjectId: string;
  readonly digestAlgorithm: 'sha256';
  readonly evidenceDigest: string;
  readonly tupleDigest: string;
}

export interface AssuranceEvidenceExpectation {
  readonly ownerId: string;
  readonly releaseId: string;
  readonly testedCommit: string;
  readonly subjectId: string;
  readonly evidenceDigest: string;
}

export interface AssuranceIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly severity: AssuranceSeverity;
}

export interface AssuranceEvaluation {
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,99}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new TypeError(`${label} must be a stable non-empty identifier (<=200 chars)`);
  }
}

export function assertCode(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !CODE.test(value)) {
    throw new TypeError(`${label} must be an UPPER_SNAKE code`);
  }
}

export function assertUtcMs(value: unknown, label: string): asserts value is number {
  if (!isValidUtcMillis(value)) throw new TypeError(`${label} must be a valid UTC millisecond value`);
}

export function assertSafeNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

export function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

export function assertFiniteNonNegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
}

export function assertDigestOrNull(value: unknown, label: string): asserts value is string | null {
  if (value !== null && (typeof value !== 'string' || !SHA256.test(value))) {
    throw new TypeError(`${label} must be null or a lowercase SHA-256 digest`);
  }
}

export function computeEvidenceBindingTupleDigest(
  binding: Omit<AssuranceEvidenceBinding, 'tupleDigest'>,
): string {
  return createHash('sha256').update(JSON.stringify([
    binding.schema,
    binding.ownerId,
    binding.releaseId,
    binding.testedCommit,
    binding.subjectId,
    binding.digestAlgorithm,
    binding.evidenceDigest,
  ]), 'utf8').digest('hex');
}

export function bindEvidenceTuple(
  expectation: Readonly<AssuranceEvidenceExpectation>,
): Readonly<AssuranceEvidenceBinding> {
  assertIdentifier(expectation.ownerId, 'expectation.ownerId');
  assertIdentifier(expectation.releaseId, 'expectation.releaseId');
  if (!/^[a-f0-9]{40}$/u.test(expectation.testedCommit)) {
    throw new TypeError('expectation.testedCommit must be a full lowercase Git SHA-1');
  }
  assertIdentifier(expectation.subjectId, 'expectation.subjectId');
  assertDigestOrNull(expectation.evidenceDigest, 'expectation.evidenceDigest');
  if (expectation.evidenceDigest === null) throw new TypeError('expectation.evidenceDigest is required');
  const withoutDigest = Object.freeze({
    schema: 'PRODUCT_ASSURANCE_EVIDENCE_BINDING_V1' as const,
    ownerId: expectation.ownerId,
    releaseId: expectation.releaseId,
    testedCommit: expectation.testedCommit,
    subjectId: expectation.subjectId,
    digestAlgorithm: 'sha256' as const,
    evidenceDigest: expectation.evidenceDigest,
  });
  return Object.freeze({
    ...withoutDigest,
    tupleDigest: computeEvidenceBindingTupleDigest(withoutDigest),
  });
}

export function evaluateEvidenceBinding(
  evidence: Readonly<AssuranceEvidenceRef>,
  binding: Readonly<AssuranceEvidenceBinding>,
  expectation: Readonly<AssuranceEvidenceExpectation>,
): Readonly<AssuranceEvaluation> {
  const failed: string[] = [];
  const exactKeys = [
    'digestAlgorithm', 'evidenceDigest', 'ownerId', 'releaseId',
    'schema', 'subjectId', 'testedCommit', 'tupleDigest',
  ];
  if (!isPlainRecord(binding)) {
    failed.push('EVIDENCE_BINDING_FIELD_SET_MISMATCH');
    return Object.freeze({
      verdict: 'FAIL',
      reasonCodes: sortedUnique(failed),
      evidenceIds: Object.freeze([evidence.evidenceId]),
    });
  }
  if (Object.keys(binding).sort().join('\n') !== exactKeys.join('\n')) {
    failed.push('EVIDENCE_BINDING_FIELD_SET_MISMATCH');
  }
  const bindingCandidate = binding as unknown as Readonly<AssuranceEvidenceBinding>;
  try { assertIdentifier(expectation.ownerId, 'expectation.ownerId'); } catch { failed.push('EVIDENCE_EXPECTATION_OWNER_INVALID'); }
  try { assertIdentifier(expectation.releaseId, 'expectation.releaseId'); } catch { failed.push('EVIDENCE_EXPECTATION_RELEASE_INVALID'); }
  if (!/^[a-f0-9]{40}$/u.test(expectation.testedCommit)) failed.push('EVIDENCE_EXPECTATION_TESTED_COMMIT_INVALID');
  try { assertIdentifier(expectation.subjectId, 'expectation.subjectId'); } catch { failed.push('EVIDENCE_EXPECTATION_SUBJECT_INVALID'); }
  try { assertDigestOrNull(expectation.evidenceDigest, 'expectation.evidenceDigest'); } catch { failed.push('EVIDENCE_EXPECTATION_DIGEST_INVALID'); }
  if (bindingCandidate.schema !== 'PRODUCT_ASSURANCE_EVIDENCE_BINDING_V1') failed.push('EVIDENCE_BINDING_SCHEMA_MISMATCH');
  try { assertIdentifier(bindingCandidate.ownerId, 'binding.ownerId'); } catch { failed.push('EVIDENCE_BINDING_OWNER_INVALID'); }
  try { assertIdentifier(bindingCandidate.releaseId, 'binding.releaseId'); } catch { failed.push('EVIDENCE_BINDING_RELEASE_INVALID'); }
  if (!/^[a-f0-9]{40}$/u.test(bindingCandidate.testedCommit)) failed.push('EVIDENCE_BINDING_TESTED_COMMIT_INVALID');
  try { assertIdentifier(bindingCandidate.subjectId, 'binding.subjectId'); } catch { failed.push('EVIDENCE_BINDING_SUBJECT_INVALID'); }
  if (bindingCandidate.digestAlgorithm !== 'sha256') failed.push('EVIDENCE_BINDING_DIGEST_ALGORITHM_MISMATCH');
  try { assertDigestOrNull(bindingCandidate.evidenceDigest, 'binding.evidenceDigest'); } catch { failed.push('EVIDENCE_BINDING_DIGEST_INVALID'); }
  try { assertDigestOrNull(bindingCandidate.tupleDigest, 'binding.tupleDigest'); } catch { failed.push('EVIDENCE_BINDING_TUPLE_DIGEST_INVALID'); }
  if (bindingCandidate.ownerId !== expectation.ownerId || bindingCandidate.ownerId !== evidence.ownerId) failed.push('EVIDENCE_BINDING_OWNER_MISMATCH');
  if (bindingCandidate.releaseId !== expectation.releaseId) failed.push('EVIDENCE_BINDING_RELEASE_MISMATCH');
  if (bindingCandidate.testedCommit !== expectation.testedCommit) failed.push('EVIDENCE_BINDING_TESTED_COMMIT_MISMATCH');
  if (bindingCandidate.subjectId !== expectation.subjectId) failed.push('EVIDENCE_BINDING_SUBJECT_MISMATCH');
  if (bindingCandidate.evidenceDigest !== expectation.evidenceDigest || bindingCandidate.evidenceDigest !== evidence.digest) {
    failed.push('EVIDENCE_BINDING_DIGEST_MISMATCH');
  }
  let computed: string | null = null;
  try {
    computed = computeEvidenceBindingTupleDigest({
      schema: bindingCandidate.schema,
      ownerId: bindingCandidate.ownerId,
      releaseId: bindingCandidate.releaseId,
      testedCommit: bindingCandidate.testedCommit,
      subjectId: bindingCandidate.subjectId,
      digestAlgorithm: bindingCandidate.digestAlgorithm,
      evidenceDigest: bindingCandidate.evidenceDigest,
    });
  } catch {
    failed.push('EVIDENCE_BINDING_TUPLE_INVALID');
  }
  if (computed === null || bindingCandidate.tupleDigest !== computed) failed.push('EVIDENCE_BINDING_TUPLE_DIGEST_MISMATCH');
  return Object.freeze({
    verdict: failed.length > 0 ? 'FAIL' : 'PASS',
    reasonCodes: sortedUnique(failed),
    evidenceIds: Object.freeze([evidence.evidenceId]),
  });
}

export function assertSourcePath(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.trim() !== value
    || CONTROL_CHARACTER.test(value)
  ) {
    throw new TypeError(`${label} must be a non-empty source path without whitespace padding or control characters`);
  }
}

export function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

export function freezeRecord<T extends Record<string, unknown>>(value: T): Readonly<T> {
  return Object.freeze({ ...value });
}

export function verdictFromReasons(
  failReasons: readonly string[],
  unknownReasons: readonly string[],
): AssuranceVerdict {
  if (failReasons.length > 0) return 'FAIL';
  if (unknownReasons.length > 0) return 'UNKNOWN';
  return 'PASS';
}

export function evaluateEvidenceRef(
  evidence: Readonly<AssuranceEvidenceRef>,
  nowMs: number,
  requireIndependentVerifier: boolean,
): Readonly<AssuranceEvaluation> {
  assertUtcMs(nowMs, 'nowMs');
  if (typeof requireIndependentVerifier !== 'boolean') {
    throw new TypeError('requireIndependentVerifier must be boolean');
  }
  assertIdentifier(evidence.evidenceId, 'evidence.evidenceId');
  assertIdentifier(evidence.ownerId, 'evidence.ownerId');
  assertSourcePath(evidence.sourcePath, 'evidence.sourcePath');
  assertIdentifier(evidence.producerId, 'evidence.producerId');
  if (evidence.verifierId !== null) assertIdentifier(evidence.verifierId, 'evidence.verifierId');
  if (!(SYSTEM_TRUTH_LABELS as readonly unknown[]).includes(evidence.truthLabel)) {
    throw new TypeError('evidence.truthLabel is unsupported');
  }
  assertUtcMs(evidence.observedAtMs, 'evidence.observedAtMs');
  if (evidence.expiresAtMs !== null) assertUtcMs(evidence.expiresAtMs, 'evidence.expiresAtMs');
  assertDigestOrNull(evidence.digest, 'evidence.digest');

  const failed: string[] = [];
  const unknown: string[] = [];
  if (evidence.observedAtMs > nowMs) failed.push('EVIDENCE_OBSERVED_IN_FUTURE');
  if (evidence.expiresAtMs !== null && evidence.expiresAtMs <= evidence.observedAtMs) {
    failed.push('EVIDENCE_LIFETIME_INVALID');
  }
  if (evidence.expiresAtMs !== null && nowMs >= evidence.expiresAtMs) failed.push('EVIDENCE_EXPIRED');
  if (evidence.expiresAtMs === null) unknown.push('EVIDENCE_EXPIRY_MISSING');
  if (evidence.truthLabel === 'UNAVAILABLE' || evidence.truthLabel === 'UNKNOWN') {
    unknown.push('EVIDENCE_TRUTH_UNKNOWN');
  } else if (evidence.truthLabel !== 'LIVE_PUBLIC') {
    unknown.push('EVIDENCE_TRUTH_NOT_LIVE_PUBLIC');
  }
  if (evidence.digest === null) unknown.push('EVIDENCE_DIGEST_MISSING');
  if (requireIndependentVerifier) {
    if (evidence.verifierId === null) unknown.push('INDEPENDENT_VERIFIER_MISSING');
    else if (evidence.verifierId === evidence.producerId) failed.push('PRODUCER_VERIFIER_NOT_INDEPENDENT');
  }

  return Object.freeze({
    verdict: verdictFromReasons(failed, unknown),
    reasonCodes: sortedUnique([...failed, ...unknown]),
    evidenceIds: Object.freeze([evidence.evidenceId]),
  });
}
