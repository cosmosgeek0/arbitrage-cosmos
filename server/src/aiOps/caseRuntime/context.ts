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
