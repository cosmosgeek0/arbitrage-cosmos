import type { ShadowContextEntry, ShadowSignature, ShadowSignedContextManifest } from './types.js';
import { SHADOW_A2_STATUS } from './types.js';
import {
  assertClosedKeys,
  assertDigest,
  assertIdentifier,
  assertPositive,
  assertSafeNonNegative,
  assertUtc,
  canonicalJson,
  compareCodeUnitStrings,
  digestValue,
  shadowSpeculativeId,
  snapshotInertJson,
  sortedUnique,
} from './support.js';

const REQUIRED_DENIALS = Object.freeze([
  'NO_MONEY_PATHS',
  'NO_PRODUCTION_AUTHORITY',
  'NO_UNREDACTED_EVIDENCE',
] as const);
const MAX_CONTEXT_TTL_MS = 24 * 60 * 60 * 1_000;
const MANIFEST_INPUT_KEYS = Object.freeze([
  'caseId', 'caseRevision', 'generation', 'audience', 'issuedAtMs', 'expiresAtMs', 'policyRevision',
  'acceptedAuthoritySha', 'leaseId', 'fenceToken', 'budgetStateDigest', 'deadlineAtMs', 'stopCondition',
  'nextOwner', 'hardDenials', 'priorReceiptIds', 'evidenceBundleDigest', 'contextEntries', 'omittedContextIds',
] as const);
const MANIFEST_KEYS = Object.freeze([
  'schema', 'shadowStatus', 'caseId', 'caseRevision', 'generation', 'audience', 'issuedAtMs', 'expiresAtMs',
  'policyRevision', 'acceptedAuthoritySha', 'leaseId', 'fenceToken', 'budgetStateDigest', 'deadlineAtMs',
  'stopCondition', 'nextOwner', 'hardDenials', 'priorReceiptIds', 'evidenceBundleDigest', 'contextEntries',
  'omittedContextIds', 'omissionDigest', 'payloadDigest', 'signature',
] as const);

export interface ShadowSyntheticSignerPort {
  readonly posture: 'SYNTHETIC_ONLY';
  signDigest(digest: string): Readonly<ShadowSignature>;
  verifyDigest(digest: string, signature: Readonly<ShadowSignature>): boolean;
}

export interface ShadowContextLimits {
  readonly maximumEntries: number;
  readonly maximumOmittedEntries: number;
  readonly maximumPriorReceipts: number;
  readonly maximumManifestBytes: number;
  readonly maximumTtlMs: number;
}

export interface ShadowContextManifestInput {
  readonly caseId: string;
  readonly caseRevision: number;
  readonly generation: number;
  readonly audience: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly policyRevision: string;
  readonly acceptedAuthoritySha: string;
  readonly leaseId: string;
  readonly fenceToken: number;
  readonly budgetStateDigest: string;
  readonly deadlineAtMs: number;
  readonly stopCondition: string;
  readonly nextOwner: string;
  readonly hardDenials: readonly string[];
  readonly priorReceiptIds: readonly string[];
  readonly evidenceBundleDigest: string;
  readonly contextEntries: readonly Readonly<ShadowContextEntry>[];
  readonly omittedContextIds: readonly string[];
}

function validateLimits(limits: Readonly<ShadowContextLimits>): void {
  assertClosedKeys(limits, [
    'maximumEntries', 'maximumOmittedEntries', 'maximumPriorReceipts', 'maximumManifestBytes', 'maximumTtlMs',
  ], 'context limits');
  assertPositive(limits.maximumEntries, 'limits.maximumEntries');
  assertPositive(limits.maximumOmittedEntries, 'limits.maximumOmittedEntries');
  assertPositive(limits.maximumPriorReceipts, 'limits.maximumPriorReceipts');
  assertPositive(limits.maximumManifestBytes, 'limits.maximumManifestBytes');
  assertPositive(limits.maximumTtlMs, 'limits.maximumTtlMs');
  if (
    limits.maximumEntries > 128
    || limits.maximumOmittedEntries > 256
    || limits.maximumPriorReceipts > 512
    || limits.maximumManifestBytes > 1024 * 1024
    || limits.maximumTtlMs > MAX_CONTEXT_TTL_MS
  ) throw new TypeError('context limits exceed absolute shadow bounds');
}

function validateEntry(entry: Readonly<ShadowContextEntry>): void {
  assertClosedKeys(entry, ['contextId', 'ownerId', 'authority', 'digest', 'status'], 'context entry');
  assertIdentifier(entry.contextId, 'context.contextId');
  assertIdentifier(entry.ownerId, 'context.ownerId');
  assertDigest(entry.digest, 'context.digest');
  if (!(['CANONICAL_OWNER', 'SHADOW_PROJECTION'] as const).includes(entry.authority)) throw new TypeError('context authority unsupported');
  if (!(['RESOLVED', 'UNRESOLVED', 'UNAVAILABLE'] as const).includes(entry.status)) throw new TypeError('context status unsupported');
}

function validateSignature(signature: Readonly<ShadowSignature>): void {
  assertClosedKeys(signature, ['posture', 'algorithm', 'keyId', 'signature'], 'context signature');
  if (signature.posture !== 'SYNTHETIC_ONLY') throw new TypeError('A2 shadow signature must remain synthetic-only');
  assertIdentifier(signature.algorithm, 'signature.algorithm');
  assertIdentifier(signature.keyId, 'signature.keyId');
  if (typeof signature.signature !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/u.test(signature.signature)) throw new TypeError('signature bytes malformed');
}

function validateManifestFields(input: Readonly<ShadowContextManifestInput>, limits: Readonly<ShadowContextLimits>): readonly Readonly<ShadowContextEntry>[] {
  assertClosedKeys(input, MANIFEST_INPUT_KEYS, 'context manifest input');
  assertIdentifier(input.caseId, 'input.caseId');
  assertSafeNonNegative(input.caseRevision, 'input.caseRevision');
  assertSafeNonNegative(input.generation, 'input.generation');
  assertIdentifier(input.audience, 'input.audience');
  assertUtc(input.issuedAtMs, 'input.issuedAtMs');
  assertUtc(input.expiresAtMs, 'input.expiresAtMs');
  if (input.expiresAtMs <= input.issuedAtMs || input.expiresAtMs - input.issuedAtMs > limits.maximumTtlMs) throw new TypeError('context manifest expiry invalid');
  assertIdentifier(input.policyRevision, 'input.policyRevision');
  if (!/^[a-f0-9]{40}$/u.test(input.acceptedAuthoritySha)) throw new TypeError('accepted authority SHA must be full Git SHA');
  assertIdentifier(input.leaseId, 'input.leaseId');
  assertSafeNonNegative(input.fenceToken, 'input.fenceToken');
  assertDigest(input.budgetStateDigest, 'input.budgetStateDigest');
  assertUtc(input.deadlineAtMs, 'input.deadlineAtMs');
  if (input.deadlineAtMs < input.issuedAtMs || input.deadlineAtMs > input.expiresAtMs) throw new TypeError('context deadline outside manifest lifetime');
  if (input.stopCondition !== 'SHADOW_ARTIFACT_READY') throw new TypeError('context stop condition must remain SHADOW_ARTIFACT_READY');
  assertIdentifier(input.nextOwner, 'input.nextOwner');
  assertDigest(input.evidenceBundleDigest, 'input.evidenceBundleDigest');
  if (!Array.isArray(input.hardDenials) || input.hardDenials.length > 32) throw new TypeError('hard denial set exceeds its bound');
  const hardDenials = sortedUnique(input.hardDenials);
  for (const denial of hardDenials) assertIdentifier(denial, 'hardDenials[]');
  for (const required of REQUIRED_DENIALS) if (!hardDenials.includes(required)) throw new TypeError(`required hard denial missing: ${required}`);
  if (!Array.isArray(input.priorReceiptIds) || input.priorReceiptIds.length > limits.maximumPriorReceipts) throw new TypeError('prior receipt set exceeds its bound');
  if (!Array.isArray(input.omittedContextIds) || input.omittedContextIds.length > limits.maximumOmittedEntries) throw new TypeError('context omission set exceeds its bound');
  for (const id of [...input.priorReceiptIds, ...input.omittedContextIds]) assertIdentifier(id, 'context reference ID');
  if (!Array.isArray(input.contextEntries) || input.contextEntries.length === 0 || input.contextEntries.length > limits.maximumEntries) {
    throw new TypeError('context manifest entry bound invalid');
  }
  const entries = [...input.contextEntries]
    .map((entry) => {
      validateEntry(entry);
      return Object.freeze({ ...entry });
    })
    .sort((left, right) => compareCodeUnitStrings(left.contextId, right.contextId));
  if (new Set(entries.map((entry) => entry.contextId)).size !== entries.length) throw new TypeError('context IDs must be unique');
  const omittedIds = sortedUnique(input.omittedContextIds);
  if (omittedIds.some((id) => entries.some((entry) => entry.contextId === id))) {
    throw new TypeError('context ID cannot be both present and omitted');
  }
  if (entries.some((entry) => entry.status !== 'RESOLVED')) throw new TypeError('context manifest cannot use unresolved or unavailable context');
  return Object.freeze(entries);
}

function snapshotManifestInput(input: Readonly<ShadowContextManifestInput>): Readonly<ShadowContextManifestInput> {
  return snapshotInertJson(input, 'context manifest input') as Readonly<ShadowContextManifestInput>;
}

function validateSignerPort(signer: Readonly<ShadowSyntheticSignerPort>): void {
  assertClosedKeys(signer, ['posture', 'signDigest', 'verifyDigest'], 'synthetic signer port');
  if (signer.posture !== 'SYNTHETIC_ONLY') throw new TypeError('A2 signer posture must remain synthetic-only');
  if (typeof signer.signDigest !== 'function' || typeof signer.verifyDigest !== 'function') {
    throw new TypeError('A2 signer methods are unavailable');
  }
}

function manifestPayload(input: Readonly<ShadowContextManifestInput>, entries: readonly Readonly<ShadowContextEntry>[]) {
  const omissions = Object.freeze(sortedUnique(input.omittedContextIds));
  return Object.freeze({
    schema: 'AI_OPS_A2_SIGNED_CONTEXT_MANIFEST_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    caseId: input.caseId,
    caseRevision: input.caseRevision,
    generation: input.generation,
    audience: input.audience,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
    policyRevision: input.policyRevision,
    acceptedAuthoritySha: input.acceptedAuthoritySha,
    leaseId: input.leaseId,
    fenceToken: input.fenceToken,
    budgetStateDigest: input.budgetStateDigest,
    deadlineAtMs: input.deadlineAtMs,
    stopCondition: input.stopCondition,
    nextOwner: input.nextOwner,
    hardDenials: Object.freeze(sortedUnique(input.hardDenials)),
    priorReceiptIds: Object.freeze(sortedUnique(input.priorReceiptIds)),
    evidenceBundleDigest: input.evidenceBundleDigest,
    contextEntries: Object.freeze(entries),
    omittedContextIds: omissions,
    omissionDigest: digestValue(omissions),
  });
}

export function generateSignedContextManifest(
  input: Readonly<ShadowContextManifestInput>,
  limits: Readonly<ShadowContextLimits>,
  signer: Readonly<ShadowSyntheticSignerPort>,
): Readonly<ShadowSignedContextManifest> {
  limits = snapshotInertJson(limits, 'context limits') as Readonly<ShadowContextLimits>;
  validateLimits(limits);
  validateSignerPort(signer);
  const inputSnapshot = snapshotManifestInput(input);
  const entries = validateManifestFields(inputSnapshot, limits);
  const payload = manifestPayload(inputSnapshot, entries);
  const payloadDigest = digestValue(payload);
  const signature = snapshotInertJson(signer.signDigest(payloadDigest), 'context signature') as Readonly<ShadowSignature>;
  validateSignature(signature);
  if (signer.verifyDigest(payloadDigest, signature) !== true) throw new TypeError('context signer did not verify its generated signature');
  const manifest = Object.freeze({ ...payload, payloadDigest, signature: Object.freeze({ ...signature }) });
  if (Buffer.byteLength(canonicalJson(manifest), 'utf8') > limits.maximumManifestBytes) throw new RangeError('signed context manifest exceeds its byte bound');
  return manifest;
}

export interface ShadowManifestVerificationInput {
  readonly nowMs: number;
  readonly expectedCaseId: string;
  readonly expectedCaseRevision: number;
  readonly expectedGeneration: number;
  readonly expectedAudience: string;
  readonly expectedPolicyRevision: string;
  readonly expectedAcceptedAuthoritySha: string;
  readonly expectedLeaseId: string;
  readonly expectedFenceToken: number;
  readonly expectedBudgetStateDigest: string;
  readonly expectedEvidenceBundleDigest: string;
  readonly expectedDeadlineAtMs: number;
  readonly expectedStopCondition: 'SHADOW_ARTIFACT_READY';
  readonly expectedNextOwner: string;
}

function manifestAsInput(manifest: Readonly<ShadowSignedContextManifest>): ShadowContextManifestInput {
  return {
    caseId: manifest.caseId,
    caseRevision: manifest.caseRevision,
    generation: manifest.generation,
    audience: manifest.audience,
    issuedAtMs: manifest.issuedAtMs,
    expiresAtMs: manifest.expiresAtMs,
    policyRevision: manifest.policyRevision,
    acceptedAuthoritySha: manifest.acceptedAuthoritySha,
    leaseId: manifest.leaseId,
    fenceToken: manifest.fenceToken,
    budgetStateDigest: manifest.budgetStateDigest,
    deadlineAtMs: manifest.deadlineAtMs,
    stopCondition: manifest.stopCondition,
    nextOwner: manifest.nextOwner,
    hardDenials: manifest.hardDenials,
    priorReceiptIds: manifest.priorReceiptIds,
    evidenceBundleDigest: manifest.evidenceBundleDigest,
    contextEntries: manifest.contextEntries,
    omittedContextIds: manifest.omittedContextIds,
  };
}

export function verifySignedContextManifest(
  manifest: Readonly<ShadowSignedContextManifest>,
  expected: Readonly<ShadowManifestVerificationInput>,
  limits: Readonly<ShadowContextLimits>,
  signer: Readonly<ShadowSyntheticSignerPort>,
): Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; valid: boolean; reasonCodes: readonly string[] }> {
  const reasons: string[] = [];
  try {
    manifest = snapshotInertJson(manifest, 'signed context manifest') as Readonly<ShadowSignedContextManifest>;
    expected = snapshotInertJson(expected, 'manifest verification input') as Readonly<ShadowManifestVerificationInput>;
    limits = snapshotInertJson(limits, 'context limits') as Readonly<ShadowContextLimits>;
    validateLimits(limits);
    validateSignerPort(signer);
    assertClosedKeys(manifest, MANIFEST_KEYS, 'signed context manifest');
    assertClosedKeys(expected, [
      'nowMs', 'expectedCaseId', 'expectedCaseRevision', 'expectedGeneration', 'expectedAudience',
      'expectedPolicyRevision', 'expectedAcceptedAuthoritySha', 'expectedLeaseId', 'expectedFenceToken',
      'expectedBudgetStateDigest', 'expectedEvidenceBundleDigest', 'expectedDeadlineAtMs', 'expectedStopCondition',
      'expectedNextOwner',
    ], 'manifest verification input');
    assertUtc(expected.nowMs, 'expected.nowMs');
    assertIdentifier(expected.expectedCaseId, 'expected.expectedCaseId');
    assertSafeNonNegative(expected.expectedCaseRevision, 'expected.expectedCaseRevision');
    assertSafeNonNegative(expected.expectedGeneration, 'expected.expectedGeneration');
    assertIdentifier(expected.expectedAudience, 'expected.expectedAudience');
    assertIdentifier(expected.expectedPolicyRevision, 'expected.expectedPolicyRevision');
    if (!/^[a-f0-9]{40}$/u.test(expected.expectedAcceptedAuthoritySha)) throw new TypeError('expected authority SHA invalid');
    assertIdentifier(expected.expectedLeaseId, 'expected.expectedLeaseId');
    assertSafeNonNegative(expected.expectedFenceToken, 'expected.expectedFenceToken');
    assertDigest(expected.expectedBudgetStateDigest, 'expected.expectedBudgetStateDigest');
    assertDigest(expected.expectedEvidenceBundleDigest, 'expected.expectedEvidenceBundleDigest');
    assertUtc(expected.expectedDeadlineAtMs, 'expected.expectedDeadlineAtMs');
    if (expected.expectedStopCondition !== 'SHADOW_ARTIFACT_READY') throw new TypeError('expected stop condition invalid');
    assertIdentifier(expected.expectedNextOwner, 'expected.expectedNextOwner');
    if (manifest.schema !== 'AI_OPS_A2_SIGNED_CONTEXT_MANIFEST_V1' || manifest.shadowStatus !== SHADOW_A2_STATUS) reasons.push('MANIFEST_SCHEMA_OR_STATUS_INVALID');
    const manifestInputSnapshot = snapshotManifestInput(manifestAsInput(manifest));
    const entries = validateManifestFields(manifestInputSnapshot, limits);
    if (manifest.caseId !== expected.expectedCaseId) reasons.push('CASE_ID_MISMATCH');
    if (manifest.caseRevision !== expected.expectedCaseRevision) reasons.push('CASE_REVISION_MISMATCH');
    if (manifest.generation !== expected.expectedGeneration) reasons.push('GENERATION_MISMATCH');
    if (manifest.audience !== expected.expectedAudience) reasons.push('AUDIENCE_MISMATCH');
    if (manifest.policyRevision !== expected.expectedPolicyRevision) reasons.push('POLICY_REVISION_MISMATCH');
    if (manifest.acceptedAuthoritySha !== expected.expectedAcceptedAuthoritySha) reasons.push('AUTHORITY_SHA_MISMATCH');
    if (manifest.leaseId !== expected.expectedLeaseId) reasons.push('LEASE_ID_MISMATCH');
    if (manifest.fenceToken !== expected.expectedFenceToken) reasons.push('FENCE_TOKEN_MISMATCH');
    if (manifest.budgetStateDigest !== expected.expectedBudgetStateDigest) reasons.push('BUDGET_STATE_MISMATCH');
    if (manifest.evidenceBundleDigest !== expected.expectedEvidenceBundleDigest) reasons.push('EVIDENCE_BUNDLE_MISMATCH');
    if (manifest.deadlineAtMs !== expected.expectedDeadlineAtMs) reasons.push('DEADLINE_MISMATCH');
    if (manifest.stopCondition !== expected.expectedStopCondition) reasons.push('STOP_CONDITION_MISMATCH');
    if (manifest.nextOwner !== expected.expectedNextOwner) reasons.push('NEXT_OWNER_MISMATCH');
    if (expected.nowMs < manifest.issuedAtMs) reasons.push('MANIFEST_NOT_YET_VALID');
    if (expected.nowMs >= manifest.expiresAtMs) reasons.push('MANIFEST_EXPIRED');
    if (expected.nowMs >= manifest.deadlineAtMs) reasons.push('MANIFEST_DEADLINE_EXCEEDED');
    if (Buffer.byteLength(canonicalJson(manifest), 'utf8') > limits.maximumManifestBytes) reasons.push('MANIFEST_OVERSIZED');
    const payload = manifestPayload(manifestInputSnapshot, entries);
    if (
      digestValue(manifest.hardDenials) !== digestValue(payload.hardDenials)
      || digestValue(manifest.priorReceiptIds) !== digestValue(payload.priorReceiptIds)
      || digestValue(manifest.contextEntries) !== digestValue(payload.contextEntries)
      || digestValue(manifest.omittedContextIds) !== digestValue(payload.omittedContextIds)
    ) reasons.push('MANIFEST_NON_CANONICAL');
    if (manifest.omissionDigest !== digestValue(payload.omittedContextIds)) reasons.push('MANIFEST_OMISSION_DIGEST_MISMATCH');
    const digest = digestValue(payload);
    if (digest !== manifest.payloadDigest) reasons.push('MANIFEST_PAYLOAD_DIGEST_MISMATCH');
    validateSignature(manifest.signature);
    if (signer.verifyDigest(manifest.payloadDigest, manifest.signature) !== true) reasons.push('MANIFEST_SIGNATURE_INVALID');
  } catch {
    reasons.push('MANIFEST_STRUCTURE_INVALID');
  }
  return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, valid: reasons.length === 0, reasonCodes: Object.freeze([...new Set(reasons)].sort()) });
}

export interface ShadowFreshSessionHandoff {
  readonly schema: 'AI_OPS_A2_FRESH_SESSION_HANDOFF_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly handoffId: string;
  readonly sessionId: string;
  readonly audience: string;
  readonly nextOwner: string;
  readonly caseId: string;
  readonly caseRevision: number;
  readonly generation: number;
  readonly manifestDigest: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly payloadDigest: string;
  readonly signature: Readonly<ShadowSignature>;
}

export function generateFreshSessionHandoff(
  sessionId: string,
  expectedManifest: Readonly<ShadowManifestVerificationInput>,
  expectedNextOwner: string,
  manifest: Readonly<ShadowSignedContextManifest>,
  issuedAtMs: number,
  expiresAtMs: number,
  limits: Readonly<ShadowContextLimits>,
  signer: Readonly<ShadowSyntheticSignerPort>,
): Readonly<ShadowFreshSessionHandoff> {
  expectedManifest = snapshotInertJson(expectedManifest, 'manifest verification input') as Readonly<ShadowManifestVerificationInput>;
  manifest = snapshotInertJson(manifest, 'signed context manifest') as Readonly<ShadowSignedContextManifest>;
  limits = snapshotInertJson(limits, 'context limits') as Readonly<ShadowContextLimits>;
  validateSignerPort(signer);
  assertIdentifier(sessionId, 'sessionId');
  assertIdentifier(expectedNextOwner, 'expectedNextOwner');
  assertUtc(issuedAtMs, 'issuedAtMs');
  assertUtc(expiresAtMs, 'expiresAtMs');
  if (expectedManifest.nowMs !== issuedAtMs) throw new TypeError('fresh-session expected manifest time must equal handoff issuance');
  if (expectedManifest.expectedNextOwner !== expectedNextOwner) throw new TypeError('fresh-session expected next-owner mismatch');
  const manifestVerification = verifySignedContextManifest(manifest, expectedManifest, limits, signer);
  if (!manifestVerification.valid) throw new TypeError('fresh-session handoff requires a valid context manifest');
  if (manifest.nextOwner !== expectedNextOwner) throw new TypeError('fresh-session handoff next-owner mismatch');
  if (
    issuedAtMs < manifest.issuedAtMs
    || expiresAtMs <= issuedAtMs
    || expiresAtMs > manifest.expiresAtMs
    || expiresAtMs > manifest.deadlineAtMs
  ) throw new TypeError('handoff lifetime invalid');
  const handoffId = shadowSpeculativeId('a2-fresh-handoff', {
    sessionId,
    audience: expectedManifest.expectedAudience,
    nextOwner: expectedNextOwner,
    caseId: manifest.caseId,
    caseRevision: manifest.caseRevision,
    generation: manifest.generation,
    manifestDigest: manifest.payloadDigest,
    issuedAtMs,
  });
  const payload = Object.freeze({
    schema: 'AI_OPS_A2_FRESH_SESSION_HANDOFF_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    handoffId,
    sessionId,
    audience: expectedManifest.expectedAudience,
    nextOwner: expectedNextOwner,
    caseId: manifest.caseId,
    caseRevision: manifest.caseRevision,
    generation: manifest.generation,
    manifestDigest: manifest.payloadDigest,
    issuedAtMs,
    expiresAtMs,
  });
  const payloadDigest = digestValue(payload);
  const signature = snapshotInertJson(signer.signDigest(payloadDigest), 'fresh-session signature') as Readonly<ShadowSignature>;
  validateSignature(signature);
  if (signer.verifyDigest(payloadDigest, signature) !== true) throw new TypeError('fresh-session signer did not verify its generated signature');
  return Object.freeze({ ...payload, payloadDigest, signature: Object.freeze({ ...signature }) });
}

export function verifyFreshSessionHandoff(
  handoff: Readonly<ShadowFreshSessionHandoff>,
  manifest: Readonly<ShadowSignedContextManifest>,
  sessionId: string,
  expectedManifest: Readonly<ShadowManifestVerificationInput>,
  expectedNextOwner: string,
  consumedHandoffIds: readonly string[],
  limits: Readonly<ShadowContextLimits>,
  signer: Readonly<ShadowSyntheticSignerPort>,
): Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; valid: boolean; reasonCodes: readonly string[] }> {
  const reasons: string[] = [];
  try {
    handoff = snapshotInertJson(handoff, 'fresh-session handoff') as Readonly<ShadowFreshSessionHandoff>;
    manifest = snapshotInertJson(manifest, 'signed context manifest') as Readonly<ShadowSignedContextManifest>;
    expectedManifest = snapshotInertJson(expectedManifest, 'manifest verification input') as Readonly<ShadowManifestVerificationInput>;
    consumedHandoffIds = snapshotInertJson(consumedHandoffIds, 'consumed handoff IDs') as readonly string[];
    limits = snapshotInertJson(limits, 'context limits') as Readonly<ShadowContextLimits>;
    validateSignerPort(signer);
    assertIdentifier(sessionId, 'sessionId');
    assertIdentifier(expectedNextOwner, 'expectedNextOwner');
    const nowMs = expectedManifest.nowMs;
    if (expectedManifest.expectedNextOwner !== expectedNextOwner) reasons.push('HANDOFF_EXPECTED_NEXT_OWNER_MISMATCH');
    if (!Array.isArray(consumedHandoffIds) || consumedHandoffIds.length > 4_096) throw new TypeError('consumed handoff set exceeds bound');
    const consumedIds = Array.from({ length: consumedHandoffIds.length }, (_, index) => consumedHandoffIds[index]);
    for (const id of consumedIds) assertIdentifier(id, 'consumedHandoffIds[]');
    const consumedIdSet = new Set(consumedIds);
    assertClosedKeys(handoff, [
      'schema', 'shadowStatus', 'handoffId', 'sessionId', 'audience', 'nextOwner', 'caseId', 'caseRevision',
      'generation', 'manifestDigest', 'issuedAtMs', 'expiresAtMs', 'payloadDigest', 'signature',
    ], 'fresh-session handoff');
    assertIdentifier(handoff.handoffId, 'handoff.handoffId');
    assertIdentifier(handoff.sessionId, 'handoff.sessionId');
    assertIdentifier(handoff.audience, 'handoff.audience');
    assertIdentifier(handoff.nextOwner, 'handoff.nextOwner');
    assertIdentifier(handoff.caseId, 'handoff.caseId');
    assertSafeNonNegative(handoff.caseRevision, 'handoff.caseRevision');
    assertSafeNonNegative(handoff.generation, 'handoff.generation');
    assertDigest(handoff.manifestDigest, 'handoff.manifestDigest');
    assertUtc(handoff.issuedAtMs, 'handoff.issuedAtMs');
    assertUtc(handoff.expiresAtMs, 'handoff.expiresAtMs');
    assertDigest(handoff.payloadDigest, 'handoff.payloadDigest');
    const manifestVerification = verifySignedContextManifest(manifest, expectedManifest, limits, signer);
    if (!manifestVerification.valid) reasons.push('REFERENCED_MANIFEST_INVALID');
    if (handoff.schema !== 'AI_OPS_A2_FRESH_SESSION_HANDOFF_V1' || handoff.shadowStatus !== SHADOW_A2_STATUS) reasons.push('HANDOFF_SCHEMA_INVALID');
    if (handoff.sessionId !== sessionId) reasons.push('HANDOFF_SESSION_MISMATCH');
    if (handoff.audience !== expectedManifest.expectedAudience || manifest.audience !== expectedManifest.expectedAudience) reasons.push('HANDOFF_AUDIENCE_MISMATCH');
    if (handoff.nextOwner !== expectedNextOwner || manifest.nextOwner !== expectedNextOwner) reasons.push('HANDOFF_NEXT_OWNER_MISMATCH');
    if (
      handoff.caseId !== manifest.caseId
      || handoff.caseRevision !== manifest.caseRevision
      || handoff.generation !== manifest.generation
      || handoff.caseId !== expectedManifest.expectedCaseId
      || handoff.caseRevision !== expectedManifest.expectedCaseRevision
      || handoff.generation !== expectedManifest.expectedGeneration
    ) reasons.push('HANDOFF_CASE_LINEAGE_MISMATCH');
    if (handoff.manifestDigest !== manifest.payloadDigest) reasons.push('HANDOFF_MANIFEST_MISMATCH');
    if (handoff.issuedAtMs < manifest.issuedAtMs) reasons.push('HANDOFF_PREDATES_MANIFEST');
    if (handoff.expiresAtMs > manifest.expiresAtMs) reasons.push('HANDOFF_OUTLIVES_MANIFEST');
    if (handoff.expiresAtMs > manifest.deadlineAtMs) reasons.push('HANDOFF_OUTLIVES_DEADLINE');
    if (handoff.expiresAtMs <= handoff.issuedAtMs) reasons.push('HANDOFF_LIFETIME_INVALID');
    if (nowMs < handoff.issuedAtMs) reasons.push('HANDOFF_NOT_YET_VALID');
    if (nowMs >= handoff.expiresAtMs) reasons.push('HANDOFF_EXPIRED');
    if (nowMs >= manifest.deadlineAtMs) reasons.push('HANDOFF_DEADLINE_EXCEEDED');
    if (consumedIdSet.has(handoff.handoffId)) reasons.push('HANDOFF_REPLAYED');
    const payload = {
      schema: handoff.schema,
      shadowStatus: handoff.shadowStatus,
      handoffId: handoff.handoffId,
      sessionId: handoff.sessionId,
      audience: handoff.audience,
      nextOwner: handoff.nextOwner,
      caseId: handoff.caseId,
      caseRevision: handoff.caseRevision,
      generation: handoff.generation,
      manifestDigest: handoff.manifestDigest,
      issuedAtMs: handoff.issuedAtMs,
      expiresAtMs: handoff.expiresAtMs,
    };
    const expectedHandoffId = shadowSpeculativeId('a2-fresh-handoff', {
      sessionId: handoff.sessionId,
      audience: handoff.audience,
      nextOwner: handoff.nextOwner,
      caseId: handoff.caseId,
      caseRevision: handoff.caseRevision,
      generation: handoff.generation,
      manifestDigest: handoff.manifestDigest,
      issuedAtMs: handoff.issuedAtMs,
    });
    if (handoff.handoffId !== expectedHandoffId) reasons.push('HANDOFF_ID_MISMATCH');
    if (digestValue(payload) !== handoff.payloadDigest) reasons.push('HANDOFF_PAYLOAD_DIGEST_MISMATCH');
    validateSignature(handoff.signature);
    if (signer.verifyDigest(handoff.payloadDigest, handoff.signature) !== true) reasons.push('HANDOFF_SIGNATURE_INVALID');
  } catch {
    reasons.push('HANDOFF_STRUCTURE_INVALID');
  }
  return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, valid: reasons.length === 0, reasonCodes: Object.freeze([...new Set(reasons)].sort()) });
}

const MAX_HANDOFF_CONSUMPTION_RECEIPTS = 4_096;
const MAX_HANDOFF_CONSUMPTION_STATE_BYTES = 8 * 1024 * 1024;
const HANDOFF_CONSUMPTION_RECEIPT_KEYS = Object.freeze([
  'schema', 'shadowStatus', 'operationalAuthority', 'receiptId', 'stateRevision', 'handoffId', 'sessionId',
  'consumerId', 'audience', 'nextOwner', 'caseId', 'caseRevision', 'generation', 'manifestPayloadDigest',
  'manifestEnvelopeDigest', 'handoffPayloadDigest', 'handoffEnvelopeDigest', 'expectedManifestLineageDigest',
  'consumedAtMs', 'priorChainDigest', 'chainDigest', 'receiptDigest',
] as const);
const HANDOFF_CONSUMPTION_STATE_KEYS = Object.freeze([
  'schema', 'shadowStatus', 'operationalAuthority', 'revision', 'capacity', 'receipts', 'chainDigest', 'stateDigest',
] as const);

export interface ShadowHandoffConsumptionCapacity {
  readonly maximumReceipts: number;
  readonly maximumStateBytes: number;
}

export interface ShadowHandoffConsumptionReceipt {
  readonly schema: 'AI_OPS_A2_HANDOFF_CONSUMPTION_RECEIPT_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly operationalAuthority: 'NONE';
  readonly receiptId: string;
  readonly stateRevision: number;
  readonly handoffId: string;
  readonly sessionId: string;
  readonly consumerId: string;
  readonly audience: string;
  readonly nextOwner: string;
  readonly caseId: string;
  readonly caseRevision: number;
  readonly generation: number;
  readonly manifestPayloadDigest: string;
  readonly manifestEnvelopeDigest: string;
  readonly handoffPayloadDigest: string;
  readonly handoffEnvelopeDigest: string;
  readonly expectedManifestLineageDigest: string;
  readonly consumedAtMs: number;
  readonly priorChainDigest: string;
  readonly chainDigest: string;
  readonly receiptDigest: string;
}

/**
 * A deterministic, serializable shadow projection only. It neither owns a
 * store nor grants persistence authority; canonical CAS remains a Ledger
 * owner insertion request.
 */
export interface ShadowHandoffConsumptionState {
  readonly schema: 'AI_OPS_A2_HANDOFF_CONSUMPTION_STATE_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly operationalAuthority: 'NONE';
  readonly revision: number;
  readonly capacity: Readonly<ShadowHandoffConsumptionCapacity>;
  readonly receipts: readonly Readonly<ShadowHandoffConsumptionReceipt>[];
  readonly chainDigest: string;
  readonly stateDigest: string;
}

export interface ShadowHandoffConsumptionResult {
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly operationalAuthority: 'NONE';
  readonly disposition: 'CONSUMED' | 'IDEMPOTENT' | 'CONFLICT';
  readonly changed: boolean;
  readonly reasonCodes: readonly ('HANDOFF_CONSUMED' | 'HANDOFF_ALREADY_CONSUMED' | 'HANDOFF_CONSUMPTION_IDENTITY_CONFLICT' | 'STATE_REVISION_CONFLICT')[];
  readonly state: Readonly<ShadowHandoffConsumptionState>;
  readonly receipt: Readonly<ShadowHandoffConsumptionReceipt> | null;
}

export const DEFAULT_SHADOW_HANDOFF_CONSUMPTION_CAPACITY: Readonly<ShadowHandoffConsumptionCapacity> = Object.freeze({
  maximumReceipts: 1_024,
  maximumStateBytes: 2 * 1024 * 1024,
});

function validateHandoffConsumptionCapacity(capacity: Readonly<ShadowHandoffConsumptionCapacity>): void {
  assertClosedKeys(capacity, ['maximumReceipts', 'maximumStateBytes'], 'handoff consumption capacity');
  assertPositive(capacity.maximumReceipts, 'capacity.maximumReceipts');
  assertPositive(capacity.maximumStateBytes, 'capacity.maximumStateBytes');
  if (
    capacity.maximumReceipts > MAX_HANDOFF_CONSUMPTION_RECEIPTS
    || capacity.maximumStateBytes > MAX_HANDOFF_CONSUMPTION_STATE_BYTES
  ) throw new TypeError('handoff consumption capacity exceeds absolute shadow bounds');
}

function emptyHandoffConsumptionChainDigest(): string {
  return digestValue({
    schema: 'AI_OPS_A2_HANDOFF_CONSUMPTION_CHAIN_V1',
    shadowStatus: SHADOW_A2_STATUS,
    operationalAuthority: 'NONE',
    receipts: [],
  });
}

function expectedManifestLineageDigest(expected: Readonly<ShadowManifestVerificationInput>): string {
  const {
    nowMs: _nowMs,
    ...lineage
  } = expected;
  return digestValue(lineage);
}

function handoffConsumptionReceiptId(
  handoffId: string,
  consumerId: string,
  stateRevision: number,
): string {
  return shadowSpeculativeId('a2-handoff-consumption', { handoffId, consumerId, stateRevision });
}

function handoffConsumptionReceiptChainPayload(
  receipt: Readonly<Omit<ShadowHandoffConsumptionReceipt, 'chainDigest' | 'receiptDigest'>>,
): object {
  return {
    schema: receipt.schema,
    shadowStatus: receipt.shadowStatus,
    operationalAuthority: receipt.operationalAuthority,
    receiptId: receipt.receiptId,
    stateRevision: receipt.stateRevision,
    handoffId: receipt.handoffId,
    sessionId: receipt.sessionId,
    consumerId: receipt.consumerId,
    audience: receipt.audience,
    nextOwner: receipt.nextOwner,
    caseId: receipt.caseId,
    caseRevision: receipt.caseRevision,
    generation: receipt.generation,
    manifestPayloadDigest: receipt.manifestPayloadDigest,
    manifestEnvelopeDigest: receipt.manifestEnvelopeDigest,
    handoffPayloadDigest: receipt.handoffPayloadDigest,
    handoffEnvelopeDigest: receipt.handoffEnvelopeDigest,
    expectedManifestLineageDigest: receipt.expectedManifestLineageDigest,
    consumedAtMs: receipt.consumedAtMs,
    priorChainDigest: receipt.priorChainDigest,
  };
}

function sealHandoffConsumptionReceipt(
  receipt: Readonly<ShadowHandoffConsumptionReceipt>,
): Readonly<ShadowHandoffConsumptionReceipt> {
  return Object.freeze({ ...receipt });
}

function handoffConsumptionStateCore(
  revision: number,
  capacity: Readonly<ShadowHandoffConsumptionCapacity>,
  receipts: readonly Readonly<ShadowHandoffConsumptionReceipt>[],
  chainDigest: string,
): Readonly<Omit<ShadowHandoffConsumptionState, 'stateDigest'>> {
  return Object.freeze({
    schema: 'AI_OPS_A2_HANDOFF_CONSUMPTION_STATE_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    operationalAuthority: 'NONE' as const,
    revision,
    capacity: Object.freeze({ ...capacity }),
    receipts: Object.freeze(receipts.map(sealHandoffConsumptionReceipt)),
    chainDigest,
  });
}

function sealHandoffConsumptionState(
  state: Readonly<ShadowHandoffConsumptionState>,
): Readonly<ShadowHandoffConsumptionState> {
  return Object.freeze({
    ...state,
    capacity: Object.freeze({ ...state.capacity }),
    receipts: Object.freeze(state.receipts.map(sealHandoffConsumptionReceipt)),
  });
}

function validateHandoffConsumptionReceipt(
  receipt: Readonly<ShadowHandoffConsumptionReceipt>,
  expectedStateRevision: number,
  expectedPriorChainDigest: string,
): void {
  assertClosedKeys(receipt, HANDOFF_CONSUMPTION_RECEIPT_KEYS, 'handoff consumption receipt');
  if (
    receipt.schema !== 'AI_OPS_A2_HANDOFF_CONSUMPTION_RECEIPT_V1'
    || receipt.shadowStatus !== SHADOW_A2_STATUS
    || receipt.operationalAuthority !== 'NONE'
  ) throw new TypeError('handoff consumption receipt schema, status, or authority invalid');
  assertIdentifier(receipt.receiptId, 'receipt.receiptId');
  assertSafeNonNegative(receipt.stateRevision, 'receipt.stateRevision');
  if (receipt.stateRevision !== expectedStateRevision) throw new TypeError('handoff consumption receipt revision is not contiguous');
  assertIdentifier(receipt.handoffId, 'receipt.handoffId');
  assertIdentifier(receipt.sessionId, 'receipt.sessionId');
  assertIdentifier(receipt.consumerId, 'receipt.consumerId');
  assertIdentifier(receipt.audience, 'receipt.audience');
  assertIdentifier(receipt.nextOwner, 'receipt.nextOwner');
  assertIdentifier(receipt.caseId, 'receipt.caseId');
  assertSafeNonNegative(receipt.caseRevision, 'receipt.caseRevision');
  assertSafeNonNegative(receipt.generation, 'receipt.generation');
  assertDigest(receipt.manifestPayloadDigest, 'receipt.manifestPayloadDigest');
  assertDigest(receipt.manifestEnvelopeDigest, 'receipt.manifestEnvelopeDigest');
  assertDigest(receipt.handoffPayloadDigest, 'receipt.handoffPayloadDigest');
  assertDigest(receipt.handoffEnvelopeDigest, 'receipt.handoffEnvelopeDigest');
  assertDigest(receipt.expectedManifestLineageDigest, 'receipt.expectedManifestLineageDigest');
  assertUtc(receipt.consumedAtMs, 'receipt.consumedAtMs');
  assertDigest(receipt.priorChainDigest, 'receipt.priorChainDigest');
  assertDigest(receipt.chainDigest, 'receipt.chainDigest');
  assertDigest(receipt.receiptDigest, 'receipt.receiptDigest');
  if (receipt.priorChainDigest !== expectedPriorChainDigest) throw new TypeError('handoff consumption receipt chain predecessor mismatch');
  if (receipt.receiptId !== handoffConsumptionReceiptId(receipt.handoffId, receipt.consumerId, receipt.stateRevision)) {
    throw new TypeError('handoff consumption receipt identity mismatch');
  }
  const { chainDigest: _chainDigest, receiptDigest: _receiptDigest, ...withoutDigests } = receipt;
  const chainDigest = digestValue(handoffConsumptionReceiptChainPayload(withoutDigests));
  if (receipt.chainDigest !== chainDigest) throw new TypeError('handoff consumption receipt chain digest mismatch');
  if (receipt.receiptDigest !== digestValue({ ...withoutDigests, chainDigest })) {
    throw new TypeError('handoff consumption receipt digest mismatch');
  }
}

function validateHandoffConsumptionState(
  rawState: Readonly<ShadowHandoffConsumptionState>,
): Readonly<ShadowHandoffConsumptionState> {
  const state = snapshotInertJson(rawState, 'handoff consumption state') as Readonly<ShadowHandoffConsumptionState>;
  assertClosedKeys(state, HANDOFF_CONSUMPTION_STATE_KEYS, 'handoff consumption state');
  if (
    state.schema !== 'AI_OPS_A2_HANDOFF_CONSUMPTION_STATE_V1'
    || state.shadowStatus !== SHADOW_A2_STATUS
    || state.operationalAuthority !== 'NONE'
  ) throw new TypeError('handoff consumption state schema, status, or authority invalid');
  assertSafeNonNegative(state.revision, 'state.revision');
  validateHandoffConsumptionCapacity(state.capacity);
  if (!Array.isArray(state.receipts) || state.receipts.length > state.capacity.maximumReceipts) {
    throw new TypeError('handoff consumption receipt collection exceeds capacity');
  }
  if (state.revision !== state.receipts.length) throw new TypeError('handoff consumption state revision does not match its receipt ledger');
  let chainDigest = emptyHandoffConsumptionChainDigest();
  let previousConsumedAtMs = -1;
  const handoffIds = new Set<string>();
  for (let index = 0; index < state.receipts.length; index += 1) {
    const receipt = state.receipts[index];
    validateHandoffConsumptionReceipt(receipt, index + 1, chainDigest);
    if (handoffIds.has(receipt.handoffId)) throw new TypeError('handoff consumption state contains a duplicate handoff');
    if (receipt.consumedAtMs < previousConsumedAtMs) throw new TypeError('handoff consumption receipt time regressed');
    handoffIds.add(receipt.handoffId);
    previousConsumedAtMs = receipt.consumedAtMs;
    chainDigest = receipt.chainDigest;
  }
  assertDigest(state.chainDigest, 'state.chainDigest');
  assertDigest(state.stateDigest, 'state.stateDigest');
  if (state.chainDigest !== chainDigest) throw new TypeError('handoff consumption state chain digest mismatch');
  const core = handoffConsumptionStateCore(state.revision, state.capacity, state.receipts, state.chainDigest);
  if (state.stateDigest !== digestValue(core)) throw new TypeError('handoff consumption state digest mismatch');
  if (Buffer.byteLength(canonicalJson(state), 'utf8') > state.capacity.maximumStateBytes) {
    throw new RangeError('handoff consumption state exceeds its byte capacity');
  }
  return sealHandoffConsumptionState(state);
}

export function createHandoffConsumptionState(
  capacity: Readonly<ShadowHandoffConsumptionCapacity> = DEFAULT_SHADOW_HANDOFF_CONSUMPTION_CAPACITY,
): Readonly<ShadowHandoffConsumptionState> {
  capacity = snapshotInertJson(capacity, 'handoff consumption capacity') as Readonly<ShadowHandoffConsumptionCapacity>;
  validateHandoffConsumptionCapacity(capacity);
  const core = handoffConsumptionStateCore(0, capacity, [], emptyHandoffConsumptionChainDigest());
  return validateHandoffConsumptionState(Object.freeze({ ...core, stateDigest: digestValue(core) }));
}

function handoffConsumptionResult(
  disposition: ShadowHandoffConsumptionResult['disposition'],
  changed: boolean,
  reasonCode: ShadowHandoffConsumptionResult['reasonCodes'][number],
  state: Readonly<ShadowHandoffConsumptionState>,
  receipt: Readonly<ShadowHandoffConsumptionReceipt> | null,
): Readonly<ShadowHandoffConsumptionResult> {
  return Object.freeze({
    shadowStatus: SHADOW_A2_STATUS,
    operationalAuthority: 'NONE',
    disposition,
    changed,
    reasonCodes: Object.freeze([reasonCode]),
    state,
    receipt,
  });
}

function verificationInputAt(
  expected: Readonly<ShadowManifestVerificationInput>,
  nowMs: number,
): Readonly<ShadowManifestVerificationInput> {
  return Object.freeze({ ...expected, nowMs });
}

function assertConsumableHandoff(
  handoff: Readonly<ShadowFreshSessionHandoff>,
  manifest: Readonly<ShadowSignedContextManifest>,
  sessionId: string,
  expectedManifest: Readonly<ShadowManifestVerificationInput>,
  expectedNextOwner: string,
  consumedHandoffIds: readonly string[],
  limits: Readonly<ShadowContextLimits>,
  signer: Readonly<ShadowSyntheticSignerPort>,
): void {
  const verification = verifyFreshSessionHandoff(
    handoff,
    manifest,
    sessionId,
    expectedManifest,
    expectedNextOwner,
    consumedHandoffIds,
    limits,
    signer,
  );
  if (!verification.valid) {
    throw new TypeError(`fresh-session handoff cannot be consumed: ${verification.reasonCodes.join(',')}`);
  }
}

export function consumeFreshSessionHandoff(
  current: Readonly<ShadowHandoffConsumptionState>,
  expectedRevision: number,
  handoff: Readonly<ShadowFreshSessionHandoff>,
  manifest: Readonly<ShadowSignedContextManifest>,
  sessionId: string,
  expectedManifest: Readonly<ShadowManifestVerificationInput>,
  expectedNextOwner: string,
  consumerId: string,
  consumedAtMs: number,
  limits: Readonly<ShadowContextLimits>,
  signer: Readonly<ShadowSyntheticSignerPort>,
): Readonly<ShadowHandoffConsumptionResult> {
  current = validateHandoffConsumptionState(current);
  handoff = snapshotInertJson(handoff, 'fresh-session handoff consumption input') as Readonly<ShadowFreshSessionHandoff>;
  manifest = snapshotInertJson(manifest, 'fresh-session manifest consumption input') as Readonly<ShadowSignedContextManifest>;
  expectedManifest = snapshotInertJson(expectedManifest, 'fresh-session expected manifest consumption input') as Readonly<ShadowManifestVerificationInput>;
  limits = snapshotInertJson(limits, 'fresh-session context limits') as Readonly<ShadowContextLimits>;
  assertSafeNonNegative(expectedRevision, 'expectedRevision');
  assertIdentifier(handoff.handoffId, 'handoff.handoffId');
  assertIdentifier(sessionId, 'sessionId');
  assertIdentifier(expectedNextOwner, 'expectedNextOwner');
  assertIdentifier(consumerId, 'consumerId');
  assertUtc(consumedAtMs, 'consumedAtMs');
  assertUtc(expectedManifest.nowMs, 'expectedManifest.nowMs');
  if (expectedManifest.nowMs !== consumedAtMs) throw new TypeError('handoff consumption time must match manifest verification time');

  const existing = current.receipts.find((receipt) => receipt.handoffId === handoff.handoffId);
  assertConsumableHandoff(
    handoff,
    manifest,
    sessionId,
    verificationInputAt(expectedManifest, existing?.consumedAtMs ?? consumedAtMs),
    expectedNextOwner,
    current.receipts.filter((receipt) => receipt.handoffId !== handoff.handoffId).map((receipt) => receipt.handoffId),
    limits,
    signer,
  );
  const handoffEnvelopeDigest = digestValue(handoff);
  const manifestEnvelopeDigest = digestValue(manifest);
  const lineageDigest = expectedManifestLineageDigest(expectedManifest);
  if (existing !== undefined) {
    const exactRetry = (
      existing.sessionId === sessionId
      && existing.consumerId === consumerId
      && existing.nextOwner === expectedNextOwner
      && existing.handoffPayloadDigest === handoff.payloadDigest
      && existing.handoffEnvelopeDigest === handoffEnvelopeDigest
      && existing.manifestPayloadDigest === manifest.payloadDigest
      && existing.manifestEnvelopeDigest === manifestEnvelopeDigest
      && existing.expectedManifestLineageDigest === lineageDigest
    );
    if (!exactRetry) {
      return handoffConsumptionResult('CONFLICT', false, 'HANDOFF_CONSUMPTION_IDENTITY_CONFLICT', current, existing);
    }
    return handoffConsumptionResult('IDEMPOTENT', false, 'HANDOFF_ALREADY_CONSUMED', current, existing);
  }
  if (expectedRevision !== current.revision) {
    return handoffConsumptionResult('CONFLICT', false, 'STATE_REVISION_CONFLICT', current, null);
  }
  if (current.receipts.length >= current.capacity.maximumReceipts) {
    throw new RangeError('handoff consumption receipt capacity exhausted');
  }
  const lastReceipt = current.receipts.at(-1);
  if (lastReceipt !== undefined && consumedAtMs < lastReceipt.consumedAtMs) {
    throw new TypeError('handoff consumption time cannot regress');
  }
  const stateRevision = current.revision + 1;
  if (!Number.isSafeInteger(stateRevision)) throw new RangeError('handoff consumption state revision overflow');
  const withoutDigests = Object.freeze({
    schema: 'AI_OPS_A2_HANDOFF_CONSUMPTION_RECEIPT_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    operationalAuthority: 'NONE' as const,
    receiptId: handoffConsumptionReceiptId(handoff.handoffId, consumerId, stateRevision),
    stateRevision,
    handoffId: handoff.handoffId,
    sessionId,
    consumerId,
    audience: handoff.audience,
    nextOwner: expectedNextOwner,
    caseId: handoff.caseId,
    caseRevision: handoff.caseRevision,
    generation: handoff.generation,
    manifestPayloadDigest: manifest.payloadDigest,
    manifestEnvelopeDigest,
    handoffPayloadDigest: handoff.payloadDigest,
    handoffEnvelopeDigest,
    expectedManifestLineageDigest: lineageDigest,
    consumedAtMs,
    priorChainDigest: current.chainDigest,
  });
  const chainDigest = digestValue(handoffConsumptionReceiptChainPayload(withoutDigests));
  const receipt = sealHandoffConsumptionReceipt(Object.freeze({
    ...withoutDigests,
    chainDigest,
    receiptDigest: digestValue({ ...withoutDigests, chainDigest }),
  }));
  const receipts = Object.freeze([...current.receipts, receipt]);
  const core = handoffConsumptionStateCore(stateRevision, current.capacity, receipts, chainDigest);
  const state = validateHandoffConsumptionState(Object.freeze({ ...core, stateDigest: digestValue(core) }));
  return handoffConsumptionResult('CONSUMED', true, 'HANDOFF_CONSUMED', state, state.receipts.at(-1) ?? null);
}

export function serializeHandoffConsumptionState(
  state: Readonly<ShadowHandoffConsumptionState>,
): string {
  return canonicalJson(validateHandoffConsumptionState(state));
}

export function resumeHandoffConsumptionState(
  serialized: string,
): Readonly<ShadowHandoffConsumptionState> {
  if (
    typeof serialized !== 'string'
    || Buffer.byteLength(serialized, 'utf8') > MAX_HANDOFF_CONSUMPTION_STATE_BYTES
  ) throw new TypeError('serialized handoff consumption state is missing or oversized');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError('serialized handoff consumption state is invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('handoff consumption state must be an object');
  }
  if (canonicalJson(parsed) !== serialized) throw new TypeError('serialized handoff consumption state must be canonical');
  return validateHandoffConsumptionState(parsed as ShadowHandoffConsumptionState);
}
