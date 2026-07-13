import { createHash } from 'node:crypto';
import {
  ASSURANCE_VERDICTS,
  assertCode,
  assertDigestOrNull,
  assertIdentifier,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  evaluateEvidenceRef,
  sortedUnique,
  type AssuranceEvidenceRef,
  type AssuranceVerdict,
} from '../common.js';

export const ACTION_SAFETY_CHECKS = Object.freeze([
  'DURABLE_INTENT',
  'ACTION_IDENTITY',
  'CURRENT_PRIVATE_TRUTH',
  'CAPITAL_VERDICT',
  'RISK_VERDICT',
  'EXECUTION_FENCE',
  'KILL_AND_MODE_POSTURE',
  'RECONCILIATION',
  'RISK_REDUCTION_CAPACITY',
] as const);
export type ActionSafetyCheck = (typeof ACTION_SAFETY_CHECKS)[number];

export const ACTION_SAFETY_CLASSES = Object.freeze([
  'OBSERVATION',
  'CONTROL',
  'MONEY_MUTATION',
  'RISK_REDUCING_RECOVERY',
] as const);
export type ActionSafetyClass = (typeof ACTION_SAFETY_CLASSES)[number];

export const ACTION_EVIDENCE_REALMS = Object.freeze(['PUBLIC', 'PRIVATE', 'INTERNAL'] as const);
export type ActionEvidenceRealm = (typeof ACTION_EVIDENCE_REALMS)[number];

export const ACTION_SAFETY_CHECK_OWNERS: Readonly<Record<ActionSafetyCheck, string>> = Object.freeze({
  DURABLE_INTENT: 'EXISTING_LEDGER',
  ACTION_IDENTITY: 'BACKEND_FOUNDATION_EXECUTION',
  CURRENT_PRIVATE_TRUTH: 'SYSTEM_INTEGRATION',
  CAPITAL_VERDICT: 'CAPITAL_SUPERVISION',
  RISK_VERDICT: 'BACKEND_FOUNDATION_RISK',
  EXECUTION_FENCE: 'BACKEND_FOUNDATION_EXECUTION',
  KILL_AND_MODE_POSTURE: 'BACKEND_FOUNDATION_CONTROL',
  RECONCILIATION: 'BACKEND_FOUNDATION_RECONCILIATION',
  RISK_REDUCTION_CAPACITY: 'SYSTEM_INTEGRATION',
});

export const ACTION_SAFETY_CHECK_SUBJECTS: Readonly<Record<ActionSafetyCheck, string>> = Object.freeze({
  DURABLE_INTENT: 'action.durable_intent',
  ACTION_IDENTITY: 'action.identity',
  CURRENT_PRIVATE_TRUTH: 'account.private_truth',
  CAPITAL_VERDICT: 'capital.verdict',
  RISK_VERDICT: 'risk.verdict',
  EXECUTION_FENCE: 'execution.fence',
  KILL_AND_MODE_POSTURE: 'control.kill_and_mode',
  RECONCILIATION: 'reconciliation.verdict',
  RISK_REDUCTION_CAPACITY: 'rate.risk_reduction_capacity',
});

export const ACTION_SAFETY_CHECK_REALMS: Readonly<Record<ActionSafetyCheck, ActionEvidenceRealm>> = Object.freeze({
  DURABLE_INTENT: 'INTERNAL',
  ACTION_IDENTITY: 'INTERNAL',
  CURRENT_PRIVATE_TRUTH: 'PRIVATE',
  CAPITAL_VERDICT: 'INTERNAL',
  RISK_VERDICT: 'INTERNAL',
  EXECUTION_FENCE: 'INTERNAL',
  KILL_AND_MODE_POSTURE: 'INTERNAL',
  RECONCILIATION: 'PRIVATE',
  RISK_REDUCTION_CAPACITY: 'INTERNAL',
});

export interface ActionSafetyCheckEvidence {
  readonly check: ActionSafetyCheck;
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly evidence: Readonly<AssuranceEvidenceRef>;
  readonly boundActionDigest: string | null;
  readonly evidenceSubjectId: string;
  readonly evidenceRealm: ActionEvidenceRealm;
  readonly expectedOwnerId: string;
  readonly bindingDigest: string;
}

export interface ActionSafetyEnvelopeBindingContext {
  readonly schema: 'PRODUCT_ASSURANCE_ACTION_SAFETY_EVIDENCE_V1';
  readonly revision: number;
  readonly envelopeId: string;
  readonly actionId: string;
  readonly actionRevision: string;
  readonly actionDigest: string;
  readonly actionClass: ActionSafetyClass;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly producerId: string;
  readonly verifierId: string;
  readonly commonModeGroupId: string | null;
  readonly verifierCommonModeGroupId: string | null;
}

export function computeActionSafetyEvidenceBindingDigest(
  check: Omit<ActionSafetyCheckEvidence, 'bindingDigest'>,
  envelope: Readonly<ActionSafetyEnvelopeBindingContext>,
): string {
  return createHash('sha256').update(JSON.stringify([
    'PRODUCT_ASSURANCE_ACTION_CHECK_BINDING_V2',
    envelope.schema,
    envelope.revision,
    envelope.envelopeId,
    envelope.actionId,
    envelope.actionRevision,
    envelope.actionDigest,
    envelope.actionClass,
    envelope.createdAtMs,
    envelope.expiresAtMs,
    envelope.producerId,
    envelope.verifierId,
    envelope.commonModeGroupId,
    envelope.verifierCommonModeGroupId,
    check.check,
    check.verdict,
    check.reasonCodes,
    check.boundActionDigest,
    check.evidenceSubjectId,
    check.evidenceRealm,
    check.expectedOwnerId,
    check.evidence.evidenceId,
    check.evidence.digest,
    check.evidence.ownerId,
    check.evidence.sourcePath,
    check.evidence.observedAtMs,
    check.evidence.expiresAtMs,
    check.evidence.truthLabel,
    check.evidence.producerId,
    check.evidence.verifierId,
  ])).digest('hex');
}

export interface ActionSafetyEvidenceEnvelope {
  readonly schema: 'PRODUCT_ASSURANCE_ACTION_SAFETY_EVIDENCE_V1';
  readonly revision: number;
  readonly envelopeId: string;
  readonly actionId: string;
  readonly actionRevision: string;
  readonly actionDigest: string;
  readonly actionClass: ActionSafetyClass;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly producerId: string;
  readonly verifierId: string;
  readonly commonModeGroupId: string | null;
  readonly verifierCommonModeGroupId: string | null;
  readonly checks: readonly Readonly<ActionSafetyCheckEvidence>[];
}

interface ActionSafetyBaseResult {
  readonly envelopeId: string;
  readonly actionId: string;
  readonly actionRevision: string;
  readonly actionDigest: string;
  readonly envelopeCreatedAtMs: number;
  readonly envelopeExpiresAtMs: number;
  readonly producerId: string;
  readonly verifierId: string;
  readonly commonModeGroupId: string | null;
  readonly verifierCommonModeGroupId: string | null;
  readonly earliestEvidenceExpiresAtMs: number | null;
  readonly oldestEvidenceObservedAtMs: number | null;
  readonly evaluatedAtMs: number;
  readonly authorityGranted: false;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
}

export type ActionSafetyEvidenceResult = Readonly<
  | (ActionSafetyBaseResult & { verdict: 'PASS'; failSafeAction: 'NONE_FROM_ASSURANCE_EVALUATOR' })
  | (ActionSafetyBaseResult & { verdict: 'FAIL'; failSafeAction: 'NO_NEW_EXPOSURE' })
  | (ActionSafetyBaseResult & { verdict: 'UNKNOWN'; failSafeAction: 'NO_NEW_EXPOSURE' })
>;

export function evaluateActionSafetyEvidence(
  envelope: Readonly<ActionSafetyEvidenceEnvelope>,
  nowMs: number,
): ActionSafetyEvidenceResult {
  if (envelope.schema !== 'PRODUCT_ASSURANCE_ACTION_SAFETY_EVIDENCE_V1') throw new TypeError('action safety envelope schema unsupported');
  assertSafeNonNegativeInteger(envelope.revision, 'envelope.revision');
  assertIdentifier(envelope.envelopeId, 'envelope.envelopeId');
  assertIdentifier(envelope.actionId, 'envelope.actionId');
  assertIdentifier(envelope.actionRevision, 'envelope.actionRevision');
  assertIdentifier(envelope.producerId, 'envelope.producerId');
  assertIdentifier(envelope.verifierId, 'envelope.verifierId');
  if (envelope.commonModeGroupId !== null) assertIdentifier(envelope.commonModeGroupId, 'envelope.commonModeGroupId');
  if (envelope.verifierCommonModeGroupId !== null) assertIdentifier(envelope.verifierCommonModeGroupId, 'envelope.verifierCommonModeGroupId');
  assertDigestOrNull(envelope.actionDigest, 'envelope.actionDigest');
  if (envelope.actionDigest === null) throw new TypeError('envelope.actionDigest is required');
  if (!(ACTION_SAFETY_CLASSES as readonly unknown[]).includes(envelope.actionClass)) {
    throw new TypeError('envelope.actionClass is unsupported');
  }
  assertUtcMs(envelope.createdAtMs, 'envelope.createdAtMs');
  assertUtcMs(envelope.expiresAtMs, 'envelope.expiresAtMs');
  assertUtcMs(nowMs, 'nowMs');
  if (envelope.expiresAtMs <= envelope.createdAtMs) throw new TypeError('action safety envelope expiry must follow creation');
  const failReasons: string[] = [];
  const unknownReasons: string[] = [];
  const evidenceIds: string[] = [];
  if (envelope.createdAtMs > nowMs) failReasons.push('ACTION_EVIDENCE_ENVELOPE_NOT_YET_VALID');
  if (nowMs >= envelope.expiresAtMs) failReasons.push('ACTION_EVIDENCE_ENVELOPE_EXPIRED');
  if (envelope.producerId === envelope.verifierId) failReasons.push('ACTION_EVIDENCE_VERIFIER_NOT_INDEPENDENT');
  if (envelope.commonModeGroupId === null || envelope.verifierCommonModeGroupId === null) {
    unknownReasons.push('ACTION_EVIDENCE_COMMON_MODE_INDEPENDENCE_UNKNOWN');
  } else if (envelope.commonModeGroupId === envelope.verifierCommonModeGroupId) {
    failReasons.push('ACTION_EVIDENCE_COMMON_MODE_VERIFIER');
  }
  if (!Array.isArray(envelope.checks)) throw new TypeError('envelope.checks must be an array');
  const checkIds = envelope.checks.map((check) => check.check);
  if (new Set(checkIds).size !== checkIds.length) failReasons.push('ACTION_EVIDENCE_DUPLICATE_CHECK');
  for (const required of ACTION_SAFETY_CHECKS) {
    if (!checkIds.includes(required)) unknownReasons.push(`ACTION_EVIDENCE_${required}_MISSING`);
  }
  const seenEvidenceIds = new Set<string>();
  const seenEvidenceDigests = new Set<string>();
  for (const check of envelope.checks) {
    if (!(ACTION_SAFETY_CHECKS as readonly unknown[]).includes(check.check)) {
      throw new TypeError(`action safety check ${String(check.check)} is unsupported`);
    }
    const checkId = check.check as ActionSafetyCheck;
    if (!(ASSURANCE_VERDICTS as readonly unknown[]).includes(check.verdict)) {
      throw new TypeError(`action safety check ${String(check.check)} verdict unsupported`);
    }
    if (!Array.isArray(check.reasonCodes)) throw new TypeError('action safety check reasonCodes must be an array');
    for (const reasonCode of check.reasonCodes) assertCode(reasonCode, 'check.reasonCode');
    if (new Set(check.reasonCodes).size !== check.reasonCodes.length) throw new TypeError('action safety check reasonCodes must be unique');
    if (check.verdict === 'PASS' && check.reasonCodes.length > 0) throw new TypeError('PASS action safety check cannot carry reason codes');
    if (check.verdict !== 'PASS' && check.reasonCodes.length === 0) throw new TypeError('non-PASS action safety check requires a reason code');
    assertIdentifier(check.evidenceSubjectId, 'check.evidenceSubjectId');
    if (!(ACTION_EVIDENCE_REALMS as readonly unknown[]).includes(check.evidenceRealm)) {
      throw new TypeError(`action safety check ${checkId} evidence realm is unsupported`);
    }
    assertIdentifier(check.expectedOwnerId, 'check.expectedOwnerId');
    assertDigestOrNull(check.bindingDigest, 'check.bindingDigest');
    if (check.expectedOwnerId !== ACTION_SAFETY_CHECK_OWNERS[checkId]) failReasons.push(`ACTION_CHECK_${checkId}_EXPECTED_OWNER_MISMATCH`);
    if (check.evidenceSubjectId !== ACTION_SAFETY_CHECK_SUBJECTS[checkId]) failReasons.push(`ACTION_CHECK_${checkId}_SUBJECT_MISMATCH`);
    if (check.evidenceRealm !== ACTION_SAFETY_CHECK_REALMS[checkId]) failReasons.push(`ACTION_CHECK_${checkId}_EVIDENCE_REALM_MISMATCH`);
    if (check.evidence.ownerId !== check.expectedOwnerId) failReasons.push(`ACTION_CHECK_${checkId}_EVIDENCE_OWNER_MISMATCH`);
    if (check.bindingDigest !== computeActionSafetyEvidenceBindingDigest(check, envelope)) failReasons.push(`ACTION_CHECK_${checkId}_BINDING_DIGEST_MISMATCH`);
    const evidenceResult = evaluateEvidenceRef(check.evidence, nowMs, true);
    evidenceIds.push(...evidenceResult.evidenceIds);
    if (seenEvidenceIds.has(check.evidence.evidenceId)) failReasons.push('ACTION_EVIDENCE_ID_REUSED_ACROSS_CHECKS');
    seenEvidenceIds.add(check.evidence.evidenceId);
    if (check.evidence.digest !== null) {
      if (seenEvidenceDigests.has(check.evidence.digest)) failReasons.push('ACTION_EVIDENCE_DIGEST_REUSED_ACROSS_CHECKS');
      seenEvidenceDigests.add(check.evidence.digest);
    }
    if (evidenceResult.verdict === 'FAIL') failReasons.push(...evidenceResult.reasonCodes);
    if (evidenceResult.verdict === 'UNKNOWN') unknownReasons.push(...evidenceResult.reasonCodes);
    if (check.verdict === 'FAIL') failReasons.push(...check.reasonCodes, `ACTION_CHECK_${checkId}_FAILED`);
    if (check.verdict === 'UNKNOWN') unknownReasons.push(...check.reasonCodes, `ACTION_CHECK_${checkId}_UNKNOWN`);
    assertDigestOrNull(check.boundActionDigest, 'check.boundActionDigest');
    if (check.boundActionDigest === null) unknownReasons.push(`ACTION_CHECK_${checkId}_DIGEST_MISSING`);
    else if (check.boundActionDigest !== envelope.actionDigest) failReasons.push(`ACTION_CHECK_${checkId}_DIGEST_MISMATCH`);
  }
  const base = {
    envelopeId: envelope.envelopeId,
    actionId: envelope.actionId,
    actionRevision: envelope.actionRevision,
    actionDigest: envelope.actionDigest,
    envelopeCreatedAtMs: envelope.createdAtMs,
    envelopeExpiresAtMs: envelope.expiresAtMs,
    producerId: envelope.producerId,
    verifierId: envelope.verifierId,
    commonModeGroupId: envelope.commonModeGroupId,
    verifierCommonModeGroupId: envelope.verifierCommonModeGroupId,
    earliestEvidenceExpiresAtMs: envelope.checks.reduce<number | null>((earliest, check) => {
      const expiresAtMs = check.evidence.expiresAtMs;
      if (expiresAtMs === null) return earliest;
      return earliest === null ? expiresAtMs : Math.min(earliest, expiresAtMs);
    }, null),
    oldestEvidenceObservedAtMs: envelope.checks.reduce<number | null>((oldest, check) => (
      oldest === null ? check.evidence.observedAtMs : Math.min(oldest, check.evidence.observedAtMs)
    ), null),
    evaluatedAtMs: nowMs,
    authorityGranted: false as const,
    reasonCodes: sortedUnique([...failReasons, ...unknownReasons]),
    evidenceIds: sortedUnique(evidenceIds),
  };
  if (failReasons.length > 0) return Object.freeze({ ...base, verdict: 'FAIL', failSafeAction: 'NO_NEW_EXPOSURE' });
  if (unknownReasons.length > 0) return Object.freeze({ ...base, verdict: 'UNKNOWN', failSafeAction: 'NO_NEW_EXPOSURE' });
  return Object.freeze({ ...base, verdict: 'PASS', failSafeAction: 'NONE_FROM_ASSURANCE_EVALUATOR' });
}
