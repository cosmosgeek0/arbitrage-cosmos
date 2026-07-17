import { AI_OPS_HARD_DENIAL_IDS, type AiOpsActionClass } from './authority.js';
import { AI_OPS_IDENTITIES } from '../identity/identity.js';
import {
  AI_OPS_ARTIFACT_CREATED_AT_MS,
  canonicalPolicyJson,
  canonicalPolicySnapshot,
  exactKeys,
  hasSecretShape,
  immutableClone,
  isBoundedId,
  isCanonicalBase64Url,
  isCanonicalSafeText,
  isDenseArray,
  isPlainRecord,
  isSafeIntegerAtLeast,
  isSha256,
  sha256Canonical,
  sha256Bytes,
  sha256Text,
  sortedUnique,
} from '../contracts/shared.js';

export interface AiOpsPolicyFileDescriptor {
  readonly path: string;
  readonly digestAlgorithm: 'SHA-256';
  readonly digest: string;
  readonly mediaType: 'application/json' | 'text/plain' | 'application/vnd.openpolicyagent.rego';
}

export interface AiOpsPolicyBundlePayload {
  readonly schema: 'AI_OPS_POLICY_BUNDLE_V1';
  readonly bundleId: string;
  readonly revision: string;
  readonly policyEpoch: number;
  readonly parentBundleDigest: string | null;
  readonly bundleType: 'SNAPSHOT';
  readonly effectiveAtMs: number;
  readonly expiresAtMs: number;
  readonly fileInventory: readonly Readonly<AiOpsPolicyFileDescriptor>[];
  readonly hardDenialIds: readonly string[];
  readonly allowedActionClasses: readonly Exclude<AiOpsActionClass, 'D'>[];
  readonly authorityExpansionRequested: false;
}

export interface AiOpsPolicySignature {
  readonly schema: 'AI_OPS_POLICY_SIGNATURE_V1';
  readonly payloadType: 'application/vnd.aiops.policy-bundle.v1+jcs';
  readonly algorithm: 'ED25519' | 'ES256';
  readonly keyReference: string;
  readonly signerRole: 'AI_OPS_OWNER';
  readonly signatureBytesBase64Url: string;
  readonly signedPayloadDigest: string;
}

export interface AiOpsSignedPolicyBundle {
  readonly payload: Readonly<AiOpsPolicyBundlePayload>;
  readonly signature: Readonly<AiOpsPolicySignature> | null;
  readonly declaredBundleDigest: string;
}

export interface AiOpsPolicySignatureVerifier {
  verify(
    signature: Readonly<AiOpsPolicySignature>,
    payloadType: AiOpsPolicySignature['payloadType'],
    exactPayloadBytes: Uint8Array,
  ): boolean;
}

export interface AiOpsPolicyFileContentVerifier {
  verifyExactInventory(files: readonly Readonly<AiOpsPolicyFileDescriptor>[]): Readonly<AiOpsPolicyFileContentVerification>;
}

export interface AiOpsPolicyFileContentVerification {
  readonly profile: 'EXACT_SHA256_BYTE_MAP_V1';
  readonly verified: boolean;
  readonly exactFileSet: boolean;
  readonly verifiedFileCount: number;
  readonly inventoryDigest: string;
  readonly mismatchPaths: readonly string[];
}

export interface AiOpsPolicySemanticTestVerification {
  readonly profile: 'AI_OPS_POLICY_SEMANTIC_TEST_V1';
  readonly verified: boolean;
  readonly bundleDigest: string;
  readonly defaultDenyVerified: boolean;
  readonly executedHardDenialIds: readonly string[];
  readonly executedCaseCount: number;
  readonly testSuiteDigest: string;
  readonly evidenceReference: string;
}

export interface AiOpsPolicySemanticTestVerifier {
  verifyPolicySemantics(payload: Readonly<AiOpsPolicyBundlePayload>, exactPayloadBytes: Uint8Array): Readonly<AiOpsPolicySemanticTestVerification>;
}

export interface AiOpsPolicyLastKnownGoodVerification {
  readonly profile: 'CANONICAL_POLICY_LKG_READBACK_V1';
  readonly verified: boolean;
  readonly bundleDigest: string;
  readonly signedBundleDigest: string;
  readonly policyEpoch: number;
  readonly revision: string;
  readonly signatureVerified: true;
  readonly exactContentVerified: true;
  readonly semanticTestsVerified: true;
  readonly semanticTestSuiteDigest: string;
  readonly activationDurable: true;
  readonly activationReceiptReference: string;
  readonly readbackDigest: string;
}

export interface AiOpsPolicyLastKnownGoodVerifier {
  verifyLastKnownGood(bundle: Readonly<AiOpsSignedPolicyBundle>, exactPayloadBytes: Uint8Array): Readonly<AiOpsPolicyLastKnownGoodVerification>;
}

export interface AiOpsPolicyBundleDecision {
  readonly stageAllowed: false;
  readonly candidateValidatedForPortRecheck: boolean;
  readonly activateAllowed: false;
  readonly candidateBundleDigest: string | null;
  readonly retainedBundleDigest: string | null;
  readonly reasonCodes: readonly string[];
  readonly signatureVerified: boolean;
  readonly authorityGranted: false;
  readonly state: 'SHADOW_SPECULATIVE';
}

export const AI_OPS_POLICY_SEMANTIC_TEST_SUITE_DIGEST = sha256Canonical({
  profile: 'AI_OPS_POLICY_SEMANTIC_TEST_SUITE_V1',
  defaultDenyCase: 'DEFAULT_DENY_MUST_HOLD',
  hardDenialIds: sortedUnique(AI_OPS_HARD_DENIAL_IDS),
});

const POLICY_PAYLOAD_KEYS = ['schema', 'bundleId', 'revision', 'policyEpoch', 'parentBundleDigest', 'bundleType', 'effectiveAtMs', 'expiresAtMs', 'fileInventory', 'hardDenialIds', 'allowedActionClasses', 'authorityExpansionRequested'] as const;
const POLICY_SIGNATURE_KEYS = ['schema', 'payloadType', 'algorithm', 'keyReference', 'signerRole', 'signatureBytesBase64Url', 'signedPayloadDigest'] as const;
const POLICY_CONTENT_VERIFICATION_KEYS = ['profile', 'verified', 'exactFileSet', 'verifiedFileCount', 'inventoryDigest', 'mismatchPaths'] as const;
const POLICY_SEMANTIC_VERIFICATION_KEYS = ['profile', 'verified', 'bundleDigest', 'defaultDenyVerified', 'executedHardDenialIds', 'executedCaseCount', 'testSuiteDigest', 'evidenceReference'] as const;
const POLICY_LKG_VERIFICATION_KEYS = ['profile', 'verified', 'bundleDigest', 'signedBundleDigest', 'policyEpoch', 'revision', 'signatureVerified', 'exactContentVerified', 'semanticTestsVerified', 'semanticTestSuiteDigest', 'activationDurable', 'activationReceiptReference', 'readbackDigest'] as const;
function isSafeContractId(value: unknown): value is string {
  return isBoundedId(value);
}

function isBoundedReference(value: unknown, prefix: string): value is string {
  return isSafeContractId(value)
    && value.startsWith(prefix)
    && isSafeContractId(value.slice(prefix.length));
}

export const AI_OPS_CANONICAL_POLICY_PATH_PATTERN_SOURCE = '^(?:[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)(?:/(?:[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?))*$' as const;
const CANONICAL_POLICY_PATH_PATTERN = new RegExp(AI_OPS_CANONICAL_POLICY_PATH_PATTERN_SOURCE);

export function isCanonicalAiOpsPolicyPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 512
    && CANONICAL_POLICY_PATH_PATTERN.test(value)
    && value.split('/').every((segment) => segment !== '.' && segment !== '..');
}

function isClosedAiOpsPolicyBundlePayloadSnapshot(value: unknown): value is AiOpsPolicyBundlePayload {
  if (!exactKeys(value, POLICY_PAYLOAD_KEYS)) return false;
  if (
    value.schema !== 'AI_OPS_POLICY_BUNDLE_V1'
    || !isSafeContractId(value.bundleId)
    || !isSafeContractId(value.revision)
    || !isSafeIntegerAtLeast(value.policyEpoch, 1)
    || !(value.parentBundleDigest === null || isSha256(value.parentBundleDigest))
    || value.bundleType !== 'SNAPSHOT'
    || !isSafeIntegerAtLeast(value.effectiveAtMs, 0)
    || !isSafeIntegerAtLeast(value.expiresAtMs, 0)
    || value.authorityExpansionRequested !== false
  ) return false;
  if (!isDenseArray(value.fileInventory) || value.fileInventory.length === 0 || value.fileInventory.length > 256 || Array.from(value.fileInventory).some((file) => {
    if (!exactKeys(file, ['path', 'digestAlgorithm', 'digest', 'mediaType'])) return true;
    return !isCanonicalAiOpsPolicyPath(file.path)
      || hasSecretShape(file.path)
      || file.digestAlgorithm !== 'SHA-256'
      || !isSha256(file.digest)
      || !(['application/json', 'text/plain', 'application/vnd.openpolicyagent.rego'] as const).includes(file.mediaType as AiOpsPolicyFileDescriptor['mediaType']);
  })) return false;
  if (!isDenseArray(value.hardDenialIds) || value.hardDenialIds.length !== AI_OPS_HARD_DENIAL_IDS.length || Array.from(value.hardDenialIds).some((id) => !isBoundedId(id))) return false;
  if (!isDenseArray(value.allowedActionClasses) || value.allowedActionClasses.length !== 3 || Array.from(value.allowedActionClasses).some((entry) => !(['A', 'B', 'C'] as const).includes(entry as 'A' | 'B' | 'C'))) return false;
  try {
    canonicalPolicyJson(value);
    return true;
  } catch {
    return false;
  }
}

export function isClosedAiOpsPolicyBundlePayload(value: unknown): value is AiOpsPolicyBundlePayload {
  try {
    return isClosedAiOpsPolicyBundlePayloadSnapshot(canonicalPolicySnapshot(value));
  } catch {
    return false;
  }
}

function isClosedSignedPolicyBundleSnapshot(value: unknown): value is AiOpsSignedPolicyBundle {
  if (!exactKeys(value, ['payload', 'signature', 'declaredBundleDigest'])) return false;
  if (!isClosedAiOpsPolicyBundlePayloadSnapshot(value.payload)) return false;
  if (value.signature !== null) {
    if (!exactKeys(value.signature, POLICY_SIGNATURE_KEYS)) return false;
    if (
      value.signature.schema !== 'AI_OPS_POLICY_SIGNATURE_V1'
      || value.signature.payloadType !== 'application/vnd.aiops.policy-bundle.v1+jcs'
      || !(['ED25519', 'ES256'] as const).includes(value.signature.algorithm as 'ED25519' | 'ES256')
      || !isBoundedReference(value.signature.keyReference, 'owner-key-ref://')
      || value.signature.signerRole !== 'AI_OPS_OWNER'
      || !isCanonicalBase64Url(value.signature.signatureBytesBase64Url, 16, 4096)
      || !isSha256(value.signature.signedPayloadDigest)
    ) return false;
  }
  return isSha256(value.declaredBundleDigest);
}

export function isClosedSignedPolicyBundle(value: unknown): value is AiOpsSignedPolicyBundle {
  try {
    return isClosedSignedPolicyBundleSnapshot(canonicalPolicySnapshot(value));
  } catch {
    return false;
  }
}

function isClosedPolicyContentVerification(value: unknown): value is AiOpsPolicyFileContentVerification {
  return exactKeys(value, POLICY_CONTENT_VERIFICATION_KEYS)
    && value.profile === 'EXACT_SHA256_BYTE_MAP_V1'
    && typeof value.verified === 'boolean'
    && typeof value.exactFileSet === 'boolean'
    && typeof value.verifiedFileCount === 'number'
    && Number.isSafeInteger(value.verifiedFileCount)
    && value.verifiedFileCount >= 0
    && value.verifiedFileCount <= 256
    && isSha256(value.inventoryDigest)
    && isDenseArray(value.mismatchPaths)
    && value.mismatchPaths.length <= 257
    && Array.from(value.mismatchPaths).every((path) => typeof path === 'string' && path.length > 0 && path.length <= 512 && !hasSecretShape(path));
}

function isClosedPolicySemanticVerification(value: unknown, expectedBundleDigest: string): value is AiOpsPolicySemanticTestVerification {
  return exactKeys(value, POLICY_SEMANTIC_VERIFICATION_KEYS)
    && value.profile === 'AI_OPS_POLICY_SEMANTIC_TEST_V1'
    && value.verified === true
    && value.bundleDigest === expectedBundleDigest
    && value.defaultDenyVerified === true
    && isDenseArray(value.executedHardDenialIds)
    && value.executedHardDenialIds.length === AI_OPS_HARD_DENIAL_IDS.length
    && Array.from(value.executedHardDenialIds).every(isSafeContractId)
    && canonicalPolicyJson(sortedUnique(value.executedHardDenialIds as string[])) === canonicalPolicyJson(sortedUnique(AI_OPS_HARD_DENIAL_IDS))
    && typeof value.executedCaseCount === 'number'
    && Number.isSafeInteger(value.executedCaseCount)
    && value.executedCaseCount >= AI_OPS_HARD_DENIAL_IDS.length
    && value.executedCaseCount <= 10_000
    && value.testSuiteDigest === AI_OPS_POLICY_SEMANTIC_TEST_SUITE_DIGEST
    && isBoundedReference(value.evidenceReference, 'policy-test-evidence://');
}

function verifyLastKnownGoodBundle(
  value: Readonly<AiOpsSignedPolicyBundle> | null,
  verifier: Readonly<AiOpsPolicyLastKnownGoodVerifier> | null,
  nowMs: number,
): Readonly<{ valid: boolean; digest: string | null; reasonCodes: readonly string[] }> {
  if (value === null) return {
    valid: false,
    digest: null,
    reasonCodes: ['LAST_KNOWN_GOOD_OR_DURABLE_BOOTSTRAP_READBACK_REQUIRED'],
  };
  let bundle: Readonly<AiOpsSignedPolicyBundle>;
  try {
    bundle = canonicalPolicySnapshot(value);
  } catch {
    return { valid: false, digest: null, reasonCodes: ['LAST_KNOWN_GOOD_SCHEMA_INVALID'] };
  }
  if (!isClosedSignedPolicyBundle(bundle) || bundle.signature === null || !isSemanticallyValidPolicyPayload(bundle.payload)) return { valid: false, digest: null, reasonCodes: ['LAST_KNOWN_GOOD_SCHEMA_INVALID'] };
  const digest = sha256Canonical(bundle.payload);
  if (bundle.declaredBundleDigest !== digest || bundle.signature.signedPayloadDigest !== digest) return { valid: false, digest: null, reasonCodes: ['LAST_KNOWN_GOOD_DIGEST_BINDING_INVALID'] };
  if (verifier === null) return { valid: false, digest: null, reasonCodes: ['LAST_KNOWN_GOOD_VERIFICATION_REQUIRED'] };
  const signedBundleDigest = sha256Canonical(bundle);
  let verification: Readonly<AiOpsPolicyLastKnownGoodVerification> | null = null;
  try {
    verification = canonicalPolicySnapshot(verifier.verifyLastKnownGood(bundle, new TextEncoder().encode(canonicalPolicyJson(bundle.payload))));
  } catch {
    verification = null;
  }
  const valid = exactKeys(verification, POLICY_LKG_VERIFICATION_KEYS)
    && verification.profile === 'CANONICAL_POLICY_LKG_READBACK_V1'
    && verification.verified === true
    && verification.bundleDigest === digest
    && verification.signedBundleDigest === signedBundleDigest
    && verification.policyEpoch === bundle.payload.policyEpoch
    && verification.revision === bundle.payload.revision
    && verification.signatureVerified === true
    && verification.exactContentVerified === true
    && verification.semanticTestsVerified === true
    && verification.semanticTestSuiteDigest === AI_OPS_POLICY_SEMANTIC_TEST_SUITE_DIGEST
    && verification.activationDurable === true
    && isBoundedReference(verification.activationReceiptReference, 'ledger-receipt://')
    && verification.readbackDigest === signedBundleDigest;
  if (!valid) return { valid: false, digest: null, reasonCodes: ['LAST_KNOWN_GOOD_VERIFICATION_FAILED'] };
  // A durable expired head still owns policy lineage. Preserve its digest so a
  // successor cannot reset to genesis, while making current use fail closed.
  const reasonCodes: string[] = [];
  if (!isSafeIntegerAtLeast(nowMs, 0)) reasonCodes.push('LAST_KNOWN_GOOD_EVALUATION_TIME_INVALID');
  else {
    if (bundle.payload.expiresAtMs <= nowMs) reasonCodes.push('LAST_KNOWN_GOOD_EXPIRED');
    if (bundle.payload.effectiveAtMs > nowMs) reasonCodes.push('LAST_KNOWN_GOOD_NOT_YET_EFFECTIVE');
  }
  return { valid: true, digest, reasonCodes: sortedUnique(reasonCodes) };
}

export function verifyPolicyFileByteMap(
  files: readonly Readonly<AiOpsPolicyFileDescriptor>[],
  bytesByPath: Readonly<Record<string, Uint8Array>>,
): Readonly<AiOpsPolicyFileContentVerification> {
  const invalidInventoryDigest = sha256Canonical({ invalidPolicyFileInventory: true });
  let safeFiles: readonly Readonly<AiOpsPolicyFileDescriptor>[];
  let safeBytesByPath: Readonly<Record<string, Uint8Array>> | null = null;
  try {
    if (!Array.isArray(files) || files.length > 256) throw new TypeError('policy inventory exceeds bounds');
    safeFiles = canonicalPolicySnapshot(files);
    if (isPlainRecord(bytesByPath)) {
      const snapshot: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
      const ownKeys = Reflect.ownKeys(bytesByPath);
      if (ownKeys.length <= 256 && ownKeys.every((key) => typeof key === 'string')) {
        let valid = true;
        let totalByteLength = 0;
        for (const key of ownKeys as string[]) {
          const descriptor = Object.getOwnPropertyDescriptor(bytesByPath, key);
          if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value') || !(descriptor.value instanceof Uint8Array)) {
            valid = false;
            break;
          }
          totalByteLength += descriptor.value.byteLength;
          if (descriptor.value.byteLength > 16_777_216 || totalByteLength > 67_108_864) {
            valid = false;
            break;
          }
          snapshot[key] = new Uint8Array(descriptor.value);
        }
        if (valid) safeBytesByPath = Object.freeze(snapshot);
      }
    }
  } catch {
    safeFiles = [];
    safeBytesByPath = null;
  }
  if (
    !isDenseArray(safeFiles)
    || safeFiles.length === 0
    || safeFiles.length > 256
    || Array.from(safeFiles).some((file) => !exactKeys(file, ['path', 'digestAlgorithm', 'digest', 'mediaType'])
      || !isCanonicalAiOpsPolicyPath(file.path)
      || !isCanonicalSafeText(file.path, 512)
      || hasSecretShape(file.path)
      || file.digestAlgorithm !== 'SHA-256'
      || !isSha256(file.digest)
      || !(['application/json', 'text/plain', 'application/vnd.openpolicyagent.rego'] as const).includes(file.mediaType as AiOpsPolicyFileDescriptor['mediaType']))
    || safeBytesByPath === null
  ) {
    return immutableClone({
      profile: 'EXACT_SHA256_BYTE_MAP_V1' as const,
      verified: false,
      exactFileSet: false,
      verifiedFileCount: 0,
      inventoryDigest: invalidInventoryDigest,
      mismatchPaths: ['AI_OPS_INVALID_POLICY_FILE_INVENTORY_REDACTED'],
    });
  }
  const expectedPaths = safeFiles.map((file) => file.path).sort();
  const actualPaths = Object.keys(safeBytesByPath).sort();
  if (actualPaths.some((path) => !isCanonicalAiOpsPolicyPath(path) || !isCanonicalSafeText(path, 512))) {
    return immutableClone({
      profile: 'EXACT_SHA256_BYTE_MAP_V1' as const,
      verified: false,
      exactFileSet: false,
      verifiedFileCount: 0,
      inventoryDigest: sha256Canonical(safeFiles),
      mismatchPaths: ['AI_OPS_UNSAFE_ACTUAL_POLICY_PATH_REDACTED'],
    });
  }
  try {
    canonicalPolicyJson(actualPaths);
  } catch {
    return immutableClone({
      profile: 'EXACT_SHA256_BYTE_MAP_V1' as const,
      verified: false,
      exactFileSet: false,
      verifiedFileCount: 0,
      inventoryDigest: sha256Canonical(safeFiles),
      mismatchPaths: ['AI_OPS_UNSAFE_ACTUAL_POLICY_PATH_REDACTED'],
    });
  }
  const exactFileSet = canonicalPolicyJson(expectedPaths) === canonicalPolicyJson(actualPaths);
  const mismatchPaths = new Set<string>();
  if (!exactFileSet) {
    expectedPaths.filter((path) => !actualPaths.includes(path)).forEach((path) => mismatchPaths.add(path));
    actualPaths.filter((path) => !expectedPaths.includes(path)).forEach((path) => mismatchPaths.add(path));
  }
  let verifiedFileCount = 0;
  for (const file of safeFiles) {
    const bytes = safeBytesByPath[file.path];
    if (!(bytes instanceof Uint8Array) || sha256Bytes(bytes) !== file.digest) mismatchPaths.add(file.path);
    else verifiedFileCount += 1;
  }
  return immutableClone({
    profile: 'EXACT_SHA256_BYTE_MAP_V1' as const,
    verified: exactFileSet && mismatchPaths.size === 0 && verifiedFileCount === safeFiles.length,
    exactFileSet,
    verifiedFileCount,
    inventoryDigest: sha256Canonical(safeFiles),
    mismatchPaths: sortedUnique([...mismatchPaths]),
  });
}

function validateFileInventory(files: readonly Readonly<AiOpsPolicyFileDescriptor>[]): string[] {
  const reasons: string[] = [];
  const paths = files.map((file) => file.path);
  if (files.length === 0) reasons.push('POLICY_FILE_INVENTORY_EMPTY');
  if (new Set(paths).size !== paths.length) reasons.push('POLICY_FILE_PATH_DUPLICATE');
  if (paths.some((path) => !isCanonicalAiOpsPolicyPath(path) || hasSecretShape(path))) reasons.push('POLICY_FILE_PATH_UNSAFE');
  if (files.some((file) => file.digestAlgorithm !== 'SHA-256' || !isSha256(file.digest))) reasons.push('POLICY_FILE_DIGEST_INVALID');
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) reasons.push('POLICY_FILE_INVENTORY_NOT_SORTED');
  return reasons;
}

function isSemanticallyValidPolicyPayload(value: unknown): value is AiOpsPolicyBundlePayload {
  if (!isClosedAiOpsPolicyBundlePayload(value)) return false;
  if (value.expiresAtMs <= value.effectiveAtMs || validateFileInventory(value.fileInventory).length > 0) return false;
  if (canonicalPolicyJson(sortedUnique(value.hardDenialIds)) !== canonicalPolicyJson(sortedUnique(AI_OPS_HARD_DENIAL_IDS))) return false;
  return canonicalPolicyJson(value.allowedActionClasses) === canonicalPolicyJson(['A', 'B', 'C']);
}

export function evaluatePolicyBundle(
  candidateInput: Readonly<AiOpsSignedPolicyBundle>,
  lastKnownGood: Readonly<AiOpsSignedPolicyBundle> | null,
  verifier: Readonly<AiOpsPolicySignatureVerifier> | null,
  contentVerifier: Readonly<AiOpsPolicyFileContentVerifier> | null,
  nowMs: number,
  semanticVerifier: Readonly<AiOpsPolicySemanticTestVerifier> | null = null,
  lastKnownGoodVerifier: Readonly<AiOpsPolicyLastKnownGoodVerifier> | null = null,
): Readonly<AiOpsPolicyBundleDecision> {
  let safeLastKnownGood: Readonly<AiOpsSignedPolicyBundle> | null = null;
  let lastKnownGoodSnapshotFailed = false;
  if (lastKnownGood !== null) {
    try {
      safeLastKnownGood = canonicalPolicySnapshot(lastKnownGood);
    } catch {
      lastKnownGoodSnapshotFailed = true;
    }
  }
  const lastKnownGoodVerification = lastKnownGoodSnapshotFailed
    ? { valid: false, digest: null, reasonCodes: ['LAST_KNOWN_GOOD_SCHEMA_INVALID'] as readonly string[] }
    : verifyLastKnownGoodBundle(safeLastKnownGood, lastKnownGoodVerifier, nowMs);
  const retainedBundleDigest = lastKnownGoodVerification.digest;
  let candidate: Readonly<AiOpsSignedPolicyBundle>;
  try {
    candidate = canonicalPolicySnapshot(candidateInput);
  } catch {
    return immutableClone({
      stageAllowed: false as const,
      candidateValidatedForPortRecheck: false,
      activateAllowed: false as const,
      candidateBundleDigest: null,
      retainedBundleDigest,
      reasonCodes: sortedUnique([...lastKnownGoodVerification.reasonCodes, 'POLICY_BUNDLE_SCHEMA_INVALID']),
      signatureVerified: false,
      authorityGranted: false as const,
      state: 'SHADOW_SPECULATIVE' as const,
    });
  }
  if (!isClosedSignedPolicyBundle(candidate)) {
    return immutableClone({
      stageAllowed: false as const,
      candidateValidatedForPortRecheck: false,
      activateAllowed: false as const,
      candidateBundleDigest: null,
      retainedBundleDigest,
      reasonCodes: sortedUnique([...lastKnownGoodVerification.reasonCodes, 'POLICY_BUNDLE_SCHEMA_INVALID']),
      signatureVerified: false,
      authorityGranted: false as const,
      state: 'SHADOW_SPECULATIVE' as const,
    });
  }
  const reasons = [...validateFileInventory(candidate.payload.fileInventory), ...lastKnownGoodVerification.reasonCodes];
  const payloadBytes = new TextEncoder().encode(canonicalPolicyJson(candidate.payload));
  const candidateBundleDigest = sha256Canonical(candidate.payload);
  if (candidate.declaredBundleDigest !== candidateBundleDigest) reasons.push('DECLARED_BUNDLE_DIGEST_MISMATCH');
  if (candidate.payload.bundleType !== 'SNAPSHOT') reasons.push('UNSIGNED_DELTA_BUNDLE_DENIED');
  if (!isSafeIntegerAtLeast(nowMs, 0)) reasons.push('POLICY_EVALUATION_TIME_INVALID');
  if (!isSafeIntegerAtLeast(candidate.payload.policyEpoch, 1)) reasons.push('POLICY_EPOCH_INVALID');
  if (!isSafeIntegerAtLeast(candidate.payload.effectiveAtMs, 0) || !isSafeIntegerAtLeast(candidate.payload.expiresAtMs, 0) || candidate.payload.expiresAtMs <= candidate.payload.effectiveAtMs) reasons.push('POLICY_TIME_WINDOW_INVALID');
  if (candidate.payload.effectiveAtMs > nowMs) reasons.push('POLICY_NOT_YET_EFFECTIVE');
  if (candidate.payload.expiresAtMs <= nowMs) reasons.push('POLICY_EXPIRED');
  if (candidate.payload.authorityExpansionRequested !== false) reasons.push('POLICY_AUTHORITY_EXPANSION_DENIED');
  const expectedDenials = sortedUnique(AI_OPS_HARD_DENIAL_IDS);
  if (canonicalPolicyJson(sortedUnique(candidate.payload.hardDenialIds)) !== canonicalPolicyJson(expectedDenials)) reasons.push('HARD_DENIAL_SET_NOT_EXACT');
  if (canonicalPolicyJson(candidate.payload.allowedActionClasses) !== canonicalPolicyJson(['A', 'B', 'C'])) reasons.push('POLICY_ALLOWED_ACTION_CLASSES_INVALID');
  if (contentVerifier === null) reasons.push('POLICY_FILE_CONTENT_VERIFICATION_REQUIRED');
  else {
    let verification: Readonly<AiOpsPolicyFileContentVerification> | null = null;
    try {
      verification = canonicalPolicySnapshot(contentVerifier.verifyExactInventory(candidate.payload.fileInventory));
    } catch {
      reasons.push('POLICY_FILE_CONTENT_VERIFICATION_FAILED');
    }
    if (
      !isClosedPolicyContentVerification(verification)
      || verification.profile !== 'EXACT_SHA256_BYTE_MAP_V1'
      || !verification.verified
      || !verification.exactFileSet
      || verification.verifiedFileCount !== candidate.payload.fileInventory.length
      || verification.inventoryDigest !== sha256Canonical(candidate.payload.fileInventory)
      || verification.mismatchPaths.length !== 0
    ) {
      if (!reasons.includes('POLICY_FILE_CONTENT_VERIFICATION_FAILED')) reasons.push('POLICY_FILE_CONTENT_VERIFICATION_FAILED');
    }
  }
  if (semanticVerifier === null) reasons.push('POLICY_SEMANTIC_TEST_VERIFICATION_REQUIRED');
  else {
    let semanticVerification: Readonly<AiOpsPolicySemanticTestVerification> | null = null;
    try {
      semanticVerification = canonicalPolicySnapshot(semanticVerifier.verifyPolicySemantics(candidate.payload, payloadBytes));
    } catch {
      semanticVerification = null;
    }
    if (!isClosedPolicySemanticVerification(semanticVerification, candidateBundleDigest)) reasons.push('POLICY_SEMANTIC_TEST_VERIFICATION_FAILED');
  }
  if (safeLastKnownGood !== null && lastKnownGoodVerification.valid) {
    const lastKnownGoodDigest = retainedBundleDigest as string;
    if (candidate.payload.policyEpoch <= safeLastKnownGood.payload.policyEpoch) reasons.push('POLICY_ROLLBACK_OR_NON_MONOTONIC_EPOCH');
    if (candidate.payload.parentBundleDigest !== lastKnownGoodDigest) reasons.push('POLICY_PARENT_DIGEST_MISMATCH');
    if (candidate.payload.revision === safeLastKnownGood.payload.revision && candidateBundleDigest !== lastKnownGoodDigest) reasons.push('POLICY_REVISION_COLLISION');
    if (candidate.payload.bundleId !== safeLastKnownGood.payload.bundleId) reasons.push('POLICY_BUNDLE_ID_MISMATCH');
  } else if (candidate.payload.policyEpoch !== 1 || candidate.payload.parentBundleDigest !== null) {
    reasons.push('GENESIS_POLICY_CHAIN_INVALID');
  }
  let signatureVerified = false;
  if (candidate.signature === null || verifier === null) {
    reasons.push('POLICY_OWNER_SIGNATURE_REQUIRED');
  } else if (
    candidate.signature.payloadType !== 'application/vnd.aiops.policy-bundle.v1+jcs'
    || !(['ED25519', 'ES256'] as const).includes(candidate.signature.algorithm)
    || candidate.signature.signerRole !== 'AI_OPS_OWNER'
    || !isBoundedReference(candidate.signature.keyReference, 'owner-key-ref://')
    || candidate.signature.signedPayloadDigest !== candidateBundleDigest
  ) {
    reasons.push('POLICY_SIGNATURE_BINDING_INVALID');
  } else {
    try {
      signatureVerified = verifier.verify(candidate.signature, candidate.signature.payloadType, payloadBytes) === true;
    } catch {
      signatureVerified = false;
    }
    if (!signatureVerified) reasons.push('POLICY_SIGNATURE_VERIFICATION_FAILED');
  }
  // The lane has no mounted owner-trusted clock. Caller-supplied time is useful
  // for diagnostics but cannot produce a positive policy candidate verdict.
  reasons.push('OWNER_TRUSTED_POLICY_TIME_REQUIRED');
  const candidateValidatedForPortRecheck = false;
  reasons.push('SHADOW_SPECULATIVE_CANNOT_ACTIVATE_POLICY');
  return immutableClone({
    stageAllowed: false as const,
    candidateValidatedForPortRecheck,
    activateAllowed: false as const,
    candidateBundleDigest,
    retainedBundleDigest,
    reasonCodes: sortedUnique(reasons),
    signatureVerified,
    authorityGranted: false as const,
    state: 'SHADOW_SPECULATIVE' as const,
  });
}

const SYNTHETIC_POLICY_FILE_CONTENTS_UTF8 = Object.freeze({
  'deny.json': '{"default":"deny"}',
  'policy.rego': 'package aiops\ndefault allow := false',
});

const SYNTHETIC_POLICY_PAYLOAD: AiOpsPolicyBundlePayload = {
  schema: 'AI_OPS_POLICY_BUNDLE_V1',
  bundleId: 'aiops-shadow-policy-fixture',
  revision: 'shadow-policy-revision-1',
  policyEpoch: 1,
  parentBundleDigest: null,
  bundleType: 'SNAPSHOT',
  effectiveAtMs: AI_OPS_ARTIFACT_CREATED_AT_MS,
  expiresAtMs: AI_OPS_ARTIFACT_CREATED_AT_MS + 86_400_000,
  fileInventory: [
    { path: 'deny.json', digestAlgorithm: 'SHA-256', digest: sha256Text(SYNTHETIC_POLICY_FILE_CONTENTS_UTF8['deny.json']), mediaType: 'application/json' },
    { path: 'policy.rego', digestAlgorithm: 'SHA-256', digest: sha256Text(SYNTHETIC_POLICY_FILE_CONTENTS_UTF8['policy.rego']), mediaType: 'application/vnd.openpolicyagent.rego' },
  ],
  hardDenialIds: AI_OPS_HARD_DENIAL_IDS,
  allowedActionClasses: ['A', 'B', 'C'],
  authorityExpansionRequested: false,
};
const SYNTHETIC_POLICY_PAYLOAD_DIGEST = sha256Canonical(SYNTHETIC_POLICY_PAYLOAD);

export const AI_OPS_SYNTHETIC_POLICY_BUNDLE_FIXTURE = immutableClone({
  fixtureState: 'SYNTHETIC_UNVERIFIED' as const,
  credentialMaterialPresent: false as const,
  fileContentsUtf8: SYNTHETIC_POLICY_FILE_CONTENTS_UTF8,
  candidate: {
    payload: SYNTHETIC_POLICY_PAYLOAD,
    signature: {
      schema: 'AI_OPS_POLICY_SIGNATURE_V1' as const,
      payloadType: 'application/vnd.aiops.policy-bundle.v1+jcs' as const,
      algorithm: 'ED25519' as const,
      keyReference: 'owner-key-ref://synthetic-test-key',
      signerRole: 'AI_OPS_OWNER' as const,
      signatureBytesBase64Url: 'U1lOVEhFVElDX1VOVkVSSUZJRURfU0lHTkFUVVJF',
      signedPayloadDigest: SYNTHETIC_POLICY_PAYLOAD_DIGEST,
    },
    declaredBundleDigest: SYNTHETIC_POLICY_PAYLOAD_DIGEST,
  } satisfies AiOpsSignedPolicyBundle,
});

export const AI_OPS_DECISION_LOG_ASSURANCE_LEVELS = Object.freeze([
  'HASH_CHAIN',
  'SIGNED_CHECKPOINT',
  'TRANSPARENCY_RECEIPT',
] as const);
export type AiOpsDecisionLogAssurance = (typeof AI_OPS_DECISION_LOG_ASSURANCE_LEVELS)[number];

export interface AiOpsDecisionLogRecordInput {
  readonly sequence: number;
  readonly decisionId: string;
  readonly timestampMs: number;
  readonly actorIdentityId: string;
  readonly actorRole: string;
  readonly capabilityId: string;
  readonly actionClass: AiOpsActionClass;
  readonly outcome: 'DENY' | 'ABSTAIN' | 'UNAVAILABLE';
  readonly reasonCodes: readonly string[];
  readonly policyBundleDigest: string;
  readonly policyRevision: string;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly redactionIds: readonly string[];
  readonly previousRecordDigest: string | null;
  readonly requestedAssurance: AiOpsDecisionLogAssurance;
  readonly checkpointReceiptReference: string | null;
}

export interface AiOpsDecisionLogRecord extends AiOpsDecisionLogRecordInput {
  readonly schema: 'AI_OPS_DECISION_LOG_RECORD_V1';
  readonly assuranceVerified: false;
  readonly state: 'SHADOW_SPECULATIVE';
  readonly recordDigest: string;
  readonly authorityCreated: false;
}

const DECISION_INPUT_KEYS = ['sequence', 'decisionId', 'timestampMs', 'actorIdentityId', 'actorRole', 'capabilityId', 'actionClass', 'outcome', 'reasonCodes', 'policyBundleDigest', 'policyRevision', 'inputDigest', 'resultDigest', 'redactionIds', 'previousRecordDigest', 'requestedAssurance', 'checkpointReceiptReference'] as const;
const DECISION_RECORD_KEYS = ['schema', ...DECISION_INPUT_KEYS, 'assuranceVerified', 'state', 'authorityCreated', 'recordDigest'] as const;
const DECISION_REASON_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const DECISION_REDACTION_PATTERN = /^AI_OPS_REDACTION_[A-Z0-9_]{1,108}$/;
const DECISION_IDENTIFIER_ARRAY_MAXIMUM = 64;

function isCodeUnitSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function isClosedDecisionInput(value: unknown): value is AiOpsDecisionLogRecordInput {
  if (!exactKeys(value, DECISION_INPUT_KEYS)) return false;
  if (!isSafeIntegerAtLeast(value.sequence, 1) || value.sequence > 1_000_000_000) return false;
  if (!isSafeIntegerAtLeast(value.timestampMs, 0)) return false;
  for (const id of [value.decisionId, value.actorIdentityId, value.actorRole, value.capabilityId, value.policyRevision]) {
    if (!isSafeContractId(id)) return false;
  }
  const actorIdentity = AI_OPS_IDENTITIES.find((identity) => identity.identityId === value.actorIdentityId);
  if (actorIdentity === undefined || actorIdentity.role !== value.actorRole) return false;
  if (!actorIdentity.capabilityIds.includes(value.capabilityId as string)) return false;
  if (!(['A', 'B', 'C', 'D'] as const).includes(value.actionClass as AiOpsActionClass)) return false;
  if (!(['DENY', 'ABSTAIN', 'UNAVAILABLE'] as const).includes(value.outcome as AiOpsDecisionLogRecordInput['outcome'])) return false;
  if (value.actionClass === 'D' && value.outcome !== 'DENY') return false;
  if (!isDenseArray(value.reasonCodes) || value.reasonCodes.length === 0 || value.reasonCodes.length > DECISION_IDENTIFIER_ARRAY_MAXIMUM || Array.from(value.reasonCodes).some((reason) => typeof reason !== 'string' || !DECISION_REASON_PATTERN.test(reason) || hasSecretShape(reason))) return false;
  if (!isDenseArray(value.redactionIds) || value.redactionIds.length > DECISION_IDENTIFIER_ARRAY_MAXIMUM || Array.from(value.redactionIds).some((id) => typeof id !== 'string' || !DECISION_REDACTION_PATTERN.test(id) || hasSecretShape(id))) return false;
  if (!isCodeUnitSortedUnique(value.reasonCodes as string[]) || !isCodeUnitSortedUnique(value.redactionIds as string[])) return false;
  if (!isSha256(value.policyBundleDigest) || !isSha256(value.inputDigest) || !isSha256(value.resultDigest)) return false;
  if (!AI_OPS_DECISION_LOG_ASSURANCE_LEVELS.includes(value.requestedAssurance as AiOpsDecisionLogAssurance)) return false;
  if (value.requestedAssurance === 'HASH_CHAIN' && value.checkpointReceiptReference !== null) return false;
  if (value.requestedAssurance === 'SIGNED_CHECKPOINT' && !isBoundedReference(value.checkpointReceiptReference, 'checkpoint-receipt://')) return false;
  if (value.requestedAssurance === 'TRANSPARENCY_RECEIPT' && !isBoundedReference(value.checkpointReceiptReference, 'transparency-receipt://')) return false;
  if (value.sequence === 1 && value.previousRecordDigest !== null) return false;
  if (value.sequence > 1 && !isSha256(value.previousRecordDigest)) return false;
  return true;
}

function isClosedAiOpsDecisionLogRecordSnapshot(value: unknown): value is AiOpsDecisionLogRecord {
  if (!exactKeys(value, DECISION_RECORD_KEYS)) return false;
  const { schema, assuranceVerified, state, authorityCreated, recordDigest, ...input } = value;
  if (
    schema !== 'AI_OPS_DECISION_LOG_RECORD_V1'
    || assuranceVerified !== false
    || state !== 'SHADOW_SPECULATIVE'
    || authorityCreated !== false
    || !isSha256(recordDigest)
    || !isClosedDecisionInput(input)
  ) return false;
  return sha256Canonical({ schema, ...input, assuranceVerified, state, authorityCreated }) === recordDigest;
}

export function isClosedAiOpsDecisionLogRecord(value: unknown): value is AiOpsDecisionLogRecord {
  try {
    return isClosedAiOpsDecisionLogRecordSnapshot(canonicalPolicySnapshot(value));
  } catch {
    return false;
  }
}

export function createDecisionLogRecord(input: Readonly<AiOpsDecisionLogRecordInput>): Readonly<AiOpsDecisionLogRecord> {
  let safeInput: Readonly<AiOpsDecisionLogRecordInput>;
  try {
    safeInput = canonicalPolicySnapshot(input);
  } catch {
    throw new TypeError('decision input schema or bounded semantics are invalid');
  }
  if (!isClosedDecisionInput(safeInput)) throw new TypeError('decision input schema or bounded semantics are invalid');
  const body = {
    schema: 'AI_OPS_DECISION_LOG_RECORD_V1' as const,
    sequence: safeInput.sequence,
    decisionId: safeInput.decisionId,
    timestampMs: safeInput.timestampMs,
    actorIdentityId: safeInput.actorIdentityId,
    actorRole: safeInput.actorRole,
    capabilityId: safeInput.capabilityId,
    actionClass: safeInput.actionClass,
    outcome: safeInput.outcome,
    reasonCodes: sortedUnique(safeInput.reasonCodes),
    policyBundleDigest: safeInput.policyBundleDigest,
    policyRevision: safeInput.policyRevision,
    inputDigest: safeInput.inputDigest,
    resultDigest: safeInput.resultDigest,
    redactionIds: sortedUnique(safeInput.redactionIds),
    previousRecordDigest: safeInput.previousRecordDigest,
    requestedAssurance: safeInput.requestedAssurance,
    checkpointReceiptReference: safeInput.checkpointReceiptReference,
    assuranceVerified: false as const,
    state: 'SHADOW_SPECULATIVE' as const,
    authorityCreated: false as const,
  };
  return immutableClone({ ...body, recordDigest: sha256Canonical(body) });
}

export interface AiOpsDecisionLogAppendReceipt {
  readonly persistenceOwner: 'LEDGER';
  readonly sequence: number;
  readonly recordDigest: string;
  readonly appendReceiptReference: string;
  readonly durable: boolean;
  readonly conditionDigest: string;
  readonly atomicCompareAndAppend: true;
  readonly replacedExisting: false;
}

export interface AiOpsDecisionLogAtomicAppendCondition {
  readonly profile: 'LEDGER_ATOMIC_COMPARE_APPEND_V1';
  readonly expectedHeadSequence: number;
  readonly expectedHeadRecordDigest: string | null;
  readonly targetSequence: number;
  readonly targetSequenceMustBeEmpty: true;
  readonly recordDigest: string;
  readonly chainProofDigest: string | null;
  readonly conditionDigest: string;
}

export interface AiOpsDecisionLogPersistencePort {
  appendAtomically(
    record: Readonly<AiOpsDecisionLogRecord>,
    condition: Readonly<AiOpsDecisionLogAtomicAppendCondition>,
  ): Readonly<AiOpsDecisionLogAppendReceipt>;
  readback(sequence: number): Readonly<AiOpsDecisionLogRecord> | null;
}

export interface AiOpsDecisionLogDurabilityDecision {
  readonly durable: false;
  readonly candidateDurabilityValidatedForPortRecheck: boolean;
  readonly assuranceCandidateValidatedForPortRecheck: boolean;
  readonly reasonCodes: readonly string[];
  readonly appendReceiptReference: string | null;
  readonly persistenceOwner: 'LEDGER';
  readonly secondStoreCreated: false;
  readonly authorityCreated: false;
  readonly state: 'SHADOW_SPECULATIVE';
}

export interface AiOpsDecisionLogAnchorVerification {
  readonly profile: 'AI_OPS_DECISION_ANCHOR_READBACK_V1';
  readonly verified: boolean;
  readonly assurance: Exclude<AiOpsDecisionLogAssurance, 'HASH_CHAIN'>;
  readonly recordDigest: string;
  readonly checkpointReceiptReference: string;
  readonly anchorOwner: 'AI_OPS_OWNER' | 'INDEPENDENT_AUDIT_OWNER';
  readonly anchorId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly verifiedAtMs: number;
  readonly verificationReceiptReference: string;
  readonly proofDigest: string;
}

export interface AiOpsDecisionLogAnchorVerifier {
  verifyAnchor(
    record: Readonly<AiOpsDecisionLogRecord>,
    verificationTimeMs: number,
  ): Readonly<AiOpsDecisionLogAnchorVerification>;
}

export interface AiOpsDecisionLogChainPrefixVerification {
  readonly profile: 'LEDGER_CHAIN_PREFIX_READBACK_V1';
  readonly verified: boolean;
  readonly headSequence: number;
  readonly headRecordDigest: string;
  readonly recordCount: number;
  readonly maximumTimestampMs: number;
  readonly chainDigest: string;
  readonly readbackReceiptReference: string;
}

export interface AiOpsDecisionLogChainVerifier {
  verifyChainPrefix(record: Readonly<AiOpsDecisionLogRecord>): Readonly<AiOpsDecisionLogChainPrefixVerification>;
}

export function computeDecisionLogAnchorProofDigest(
  proof: Readonly<Omit<AiOpsDecisionLogAnchorVerification, 'proofDigest'>>,
): string {
  return sha256Canonical(proof);
}

export function computeDecisionLogAppendConditionDigest(
  condition: Readonly<Omit<AiOpsDecisionLogAtomicAppendCondition, 'conditionDigest'>>,
): string {
  return sha256Canonical(condition);
}

export function appendDecisionThroughExistingPersistence(
  recordInput: Readonly<AiOpsDecisionLogRecord>,
  port: Readonly<AiOpsDecisionLogPersistencePort> | null,
  anchorVerifier: Readonly<AiOpsDecisionLogAnchorVerifier> | null = null,
  chainVerifier: Readonly<AiOpsDecisionLogChainVerifier> | null = null,
  verificationTimeMs: number | null = null,
): Readonly<AiOpsDecisionLogDurabilityDecision> {
  const reasons: string[] = [];
  let record: Readonly<AiOpsDecisionLogRecord>;
  try {
    record = canonicalPolicySnapshot(recordInput);
  } catch {
    return immutableClone({
      durable: false as const,
      candidateDurabilityValidatedForPortRecheck: false,
      assuranceCandidateValidatedForPortRecheck: false,
      reasonCodes: ['DECISION_LOG_RECORD_SCHEMA_INVALID', 'SHADOW_SPECULATIVE_CANNOT_CLAIM_DURABILITY'],
      appendReceiptReference: null,
      persistenceOwner: 'LEDGER' as const,
      secondStoreCreated: false as const,
      authorityCreated: false as const,
      state: 'SHADOW_SPECULATIVE' as const,
    });
  }
  if (!isClosedAiOpsDecisionLogRecord(record)) {
    return immutableClone({
      durable: false as const,
      candidateDurabilityValidatedForPortRecheck: false,
      assuranceCandidateValidatedForPortRecheck: false,
      reasonCodes: ['DECISION_LOG_RECORD_SCHEMA_INVALID', 'SHADOW_SPECULATIVE_CANNOT_CLAIM_DURABILITY'],
      appendReceiptReference: null,
      persistenceOwner: 'LEDGER' as const,
      secondStoreCreated: false as const,
      authorityCreated: false as const,
      state: 'SHADOW_SPECULATIVE' as const,
    });
  }
  if (port === null) {
    return immutableClone({
      durable: false as const,
      candidateDurabilityValidatedForPortRecheck: false,
      assuranceCandidateValidatedForPortRecheck: false,
      reasonCodes: sortedUnique([...reasons, 'EXISTING_LEDGER_PERSISTENCE_PORT_NOT_MOUNTED']),
      appendReceiptReference: null,
      persistenceOwner: 'LEDGER' as const,
      secondStoreCreated: false as const,
      authorityCreated: false as const,
      state: 'SHADOW_SPECULATIVE' as const,
    });
  }
  let predecessorReadback: Readonly<AiOpsDecisionLogRecord> | null = null;
  let existingReadback: Readonly<AiOpsDecisionLogRecord> | null = null;
  try {
    if (record.sequence > 1) {
      const predecessorCandidate = port.readback(record.sequence - 1);
      predecessorReadback = predecessorCandidate === null ? null : canonicalPolicySnapshot(predecessorCandidate);
    }
    const existingCandidate = port.readback(record.sequence);
    existingReadback = existingCandidate === null ? null : canonicalPolicySnapshot(existingCandidate);
  } catch {
    reasons.push('LEDGER_PREFLIGHT_READBACK_FAILED');
  }
  let chainProofValidated = record.sequence === 1;
  let chainProofDigest: string | null = null;
  if (record.sequence > 1) {
    if (predecessorReadback === null) reasons.push('LEDGER_PREDECESSOR_READBACK_MISSING');
    else if (!isClosedAiOpsDecisionLogRecord(predecessorReadback) || predecessorReadback.sequence !== record.sequence - 1 || predecessorReadback.recordDigest !== record.previousRecordDigest) reasons.push('LEDGER_PREDECESSOR_CONTINUITY_INVALID');
    else if (record.timestampMs < predecessorReadback.timestampMs) reasons.push('LEDGER_DECISION_CLOCK_ROLLBACK');
    if (chainVerifier === null) reasons.push('DECISION_LOG_FULL_CHAIN_VERIFIER_NOT_MOUNTED');
    else {
      let chainVerification: Readonly<AiOpsDecisionLogChainPrefixVerification> | null = null;
      try {
        chainVerification = canonicalPolicySnapshot(chainVerifier.verifyChainPrefix(record));
      } catch {
        chainVerification = null;
      }
      chainProofValidated = !(
        !exactKeys(chainVerification, ['profile', 'verified', 'headSequence', 'headRecordDigest', 'recordCount', 'maximumTimestampMs', 'chainDigest', 'readbackReceiptReference'])
        || chainVerification.profile !== 'LEDGER_CHAIN_PREFIX_READBACK_V1'
        || chainVerification.verified !== true
        || chainVerification.headSequence !== record.sequence - 1
        || chainVerification.headRecordDigest !== record.previousRecordDigest
        || chainVerification.recordCount !== record.sequence - 1
        || chainVerification.recordCount < 1
        || chainVerification.recordCount > 1_000_000_000
        || typeof chainVerification.maximumTimestampMs !== 'number'
        || !isSafeIntegerAtLeast(chainVerification.maximumTimestampMs, 0)
        || predecessorReadback === null
        || chainVerification.maximumTimestampMs !== predecessorReadback.timestampMs
        || chainVerification.maximumTimestampMs > record.timestampMs
        || !isBoundedReference(chainVerification.readbackReceiptReference, 'ledger-receipt://')
        || chainVerification.chainDigest !== sha256Canonical({
          profile: chainVerification.profile,
          headSequence: chainVerification.headSequence,
          headRecordDigest: chainVerification.headRecordDigest,
          recordCount: chainVerification.recordCount,
          maximumTimestampMs: chainVerification.maximumTimestampMs,
          readbackReceiptReference: chainVerification.readbackReceiptReference,
        })
      );
      if (!chainProofValidated) reasons.push('DECISION_LOG_FULL_CHAIN_VERIFICATION_FAILED');
      else if (chainVerification !== null) chainProofDigest = chainVerification.chainDigest as string;
    }
  }
  if (existingReadback !== null) reasons.push('LEDGER_SEQUENCE_ALREADY_OCCUPIED');

  let anchorProofValidated = record.requestedAssurance === 'HASH_CHAIN';
  if (record.requestedAssurance === 'SIGNED_CHECKPOINT' || record.requestedAssurance === 'TRANSPARENCY_RECEIPT') {
    if (!isSafeIntegerAtLeast(verificationTimeMs, 0)) reasons.push('DECISION_LOG_ANCHOR_TIME_REQUIRED');
    if (anchorVerifier === null) reasons.push('DECISION_LOG_ANCHOR_VERIFIER_NOT_MOUNTED');
    else {
      let anchorVerification: Readonly<AiOpsDecisionLogAnchorVerification> | null = null;
      try {
        if (isSafeIntegerAtLeast(verificationTimeMs, 0)) anchorVerification = canonicalPolicySnapshot(anchorVerifier.verifyAnchor(record, verificationTimeMs));
      } catch {
        anchorVerification = null;
      }
      const expectedAnchorOwner = record.requestedAssurance === 'SIGNED_CHECKPOINT' ? 'AI_OPS_OWNER' : 'INDEPENDENT_AUDIT_OWNER';
      anchorProofValidated = exactKeys(anchorVerification, [
        'profile', 'verified', 'assurance', 'recordDigest', 'checkpointReceiptReference', 'anchorOwner',
        'anchorId', 'issuedAtMs', 'expiresAtMs', 'verifiedAtMs', 'verificationReceiptReference', 'proofDigest',
      ])
        && anchorVerification.profile === 'AI_OPS_DECISION_ANCHOR_READBACK_V1'
        && anchorVerification.verified === true
        && anchorVerification.assurance === record.requestedAssurance
        && anchorVerification.recordDigest === record.recordDigest
        && anchorVerification.checkpointReceiptReference === record.checkpointReceiptReference
        && anchorVerification.anchorOwner === expectedAnchorOwner
        && isSafeContractId(anchorVerification.anchorId)
        && isSafeIntegerAtLeast(anchorVerification.issuedAtMs, record.timestampMs)
        && isSafeIntegerAtLeast(anchorVerification.expiresAtMs, anchorVerification.issuedAtMs + 1)
        && anchorVerification.verifiedAtMs === verificationTimeMs
        && anchorVerification.verifiedAtMs >= anchorVerification.issuedAtMs
        && anchorVerification.verifiedAtMs < anchorVerification.expiresAtMs
        && isBoundedReference(anchorVerification.verificationReceiptReference, 'anchor-verification://')
        && anchorVerification.proofDigest === computeDecisionLogAnchorProofDigest({
          profile: anchorVerification.profile,
          verified: anchorVerification.verified,
          assurance: anchorVerification.assurance,
          recordDigest: anchorVerification.recordDigest,
          checkpointReceiptReference: anchorVerification.checkpointReceiptReference,
          anchorOwner: anchorVerification.anchorOwner,
          anchorId: anchorVerification.anchorId,
          issuedAtMs: anchorVerification.issuedAtMs,
          expiresAtMs: anchorVerification.expiresAtMs,
          verifiedAtMs: anchorVerification.verifiedAtMs,
          verificationReceiptReference: anchorVerification.verificationReceiptReference,
        });
      if (!anchorProofValidated) reasons.push('DECISION_LOG_ANCHOR_VERIFICATION_FAILED');
    }
  }

  let receipt: Readonly<AiOpsDecisionLogAppendReceipt> | null = null;
  let readback: Readonly<AiOpsDecisionLogRecord> | null = null;
  let appendCondition: Readonly<AiOpsDecisionLogAtomicAppendCondition> | null = null;
  const preflightPassed = reasons.length === 0 && chainProofValidated && anchorProofValidated;
  if (preflightPassed) {
    const conditionBody = {
      profile: 'LEDGER_ATOMIC_COMPARE_APPEND_V1' as const,
      expectedHeadSequence: record.sequence - 1,
      expectedHeadRecordDigest: record.previousRecordDigest,
      targetSequence: record.sequence,
      targetSequenceMustBeEmpty: true as const,
      recordDigest: record.recordDigest,
      chainProofDigest,
    };
    appendCondition = immutableClone({
      ...conditionBody,
      conditionDigest: computeDecisionLogAppendConditionDigest(conditionBody),
    });
    try {
      receipt = canonicalPolicySnapshot(port.appendAtomically(record, appendCondition));
      const readbackCandidate = port.readback(record.sequence);
      readback = readbackCandidate === null ? null : canonicalPolicySnapshot(readbackCandidate);
    } catch {
      reasons.push('LEDGER_APPEND_OR_READBACK_FAILED');
    }
  } else {
    reasons.push('LEDGER_APPEND_SKIPPED_PRECHECK_FAILED');
  }
  let appendReceiptReference: string | null = null;
  if (preflightPassed && (receipt === null || !exactKeys(receipt, [
    'persistenceOwner', 'sequence', 'recordDigest', 'appendReceiptReference', 'durable',
    'conditionDigest', 'atomicCompareAndAppend', 'replacedExisting',
  ]))) {
    reasons.push('LEDGER_DURABLE_RECEIPT_MISSING');
    if (receipt !== null) reasons.push('LEDGER_APPEND_RECEIPT_REFERENCE_INVALID');
  } else if (preflightPassed && receipt !== null) {
    if (receipt.persistenceOwner !== 'LEDGER' || receipt.durable !== true) reasons.push('LEDGER_DURABLE_RECEIPT_MISSING');
    if (isBoundedReference(receipt.appendReceiptReference, 'ledger-receipt://')) appendReceiptReference = receipt.appendReceiptReference;
    else reasons.push('LEDGER_APPEND_RECEIPT_REFERENCE_INVALID');
    if (receipt.sequence !== record.sequence || receipt.recordDigest !== record.recordDigest) reasons.push('LEDGER_RECEIPT_BINDING_MISMATCH');
    if (
      appendCondition === null
      || receipt.conditionDigest !== appendCondition.conditionDigest
      || receipt.atomicCompareAndAppend !== true
      || receipt.replacedExisting !== false
    ) reasons.push('LEDGER_ATOMIC_APPEND_GUARANTEE_MISSING');
  }
  if (preflightPassed && readback === null) reasons.push('LEDGER_READBACK_MISSING');
  else if (preflightPassed && readback !== null && (!isClosedAiOpsDecisionLogRecord(readback) || readback.recordDigest !== record.recordDigest)) reasons.push('LEDGER_READBACK_DIGEST_MISMATCH');
  const candidateDurabilityValidatedForPortRecheck = reasons.length === 0;
  const assuranceCandidateValidatedForPortRecheck = candidateDurabilityValidatedForPortRecheck && chainProofValidated && anchorProofValidated;
  reasons.push('SHADOW_SPECULATIVE_CANNOT_CLAIM_DURABILITY');
  return immutableClone({
    durable: false as const,
    candidateDurabilityValidatedForPortRecheck,
    assuranceCandidateValidatedForPortRecheck,
    reasonCodes: sortedUnique(reasons),
    appendReceiptReference,
    persistenceOwner: 'LEDGER' as const,
    secondStoreCreated: false as const,
    authorityCreated: false as const,
    state: 'SHADOW_SPECULATIVE' as const,
  });
}

export const AI_OPS_DECISION_LOG_DESIGN_FIXTURE = createDecisionLogRecord({
  sequence: 1,
  decisionId: 'aiops-shadow-decision-fixture-1',
  timestampMs: AI_OPS_ARTIFACT_CREATED_AT_MS,
  actorIdentityId: 'aiops-shadow-runtime-diagnostician',
  actorRole: 'RUNTIME_DIAGNOSTICIAN',
  capabilityId: 'EXPLAIN_INCIDENT',
  actionClass: 'B',
  outcome: 'DENY',
  reasonCodes: ['EXISTING_LEDGER_PERSISTENCE_PORT_NOT_MOUNTED', 'SHADOW_SPECULATIVE'],
  policyBundleDigest: SYNTHETIC_POLICY_PAYLOAD_DIGEST,
  policyRevision: SYNTHETIC_POLICY_PAYLOAD.revision,
  inputDigest: sha256Canonical({ fixture: 'synthetic-input' }),
  resultDigest: sha256Canonical({ disposition: 'DENY' }),
  redactionIds: ['AI_OPS_REDACTION_SYNTHETIC_FIXTURE'],
  previousRecordDigest: null,
  requestedAssurance: 'HASH_CHAIN',
  checkpointReceiptReference: null,
});
