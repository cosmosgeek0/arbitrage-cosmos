import type {
  ShadowAttemptReceipt,
  ShadowCaseProof,
  ShadowCaseProofKind,
  ShadowCaseEvent,
  ShadowCaseSnapshot,
  ShadowCaseState,
  ShadowCaseTransitionRequest,
  ShadowEffectReceipt,
} from './types.js';
import { SHADOW_A2_STATUS, SHADOW_CASE_PROOF_KINDS, SHADOW_CASE_STATES } from './types.js';
import {
  assertClosedKeys,
  assertDigest,
  assertIdentifier,
  assertPositive,
  assertSafeNonNegative,
  assertUtc,
  boundedSortedIdentifiers,
  canonicalJson,
  digestValue,
  sha256,
  shadowSpeculativeId,
  snapshotInertJson,
  snapshotInertJsonPreservingDeepFreeze,
} from './support.js';

const MAX_EVENTS = 512;
const MAX_COMMAND_RECEIPTS = 2_048;
const MAX_COMPACTED_COMMAND_RECEIPTS = 1_024;
export const SHADOW_CASE_ATTEMPT_LEDGER_LIMIT = 256;
const MAX_ATTEMPTS = SHADOW_CASE_ATTEMPT_LEDGER_LIMIT;
const MAX_EFFECTS = 256;
const MAX_PROOFS = 256;
const MAX_BUDGET_RECEIPTS = 256;
const MAX_EVIDENCE_POINTERS = 1_024;
const MAX_DIAGNOSTIC_ROUNDS = 8;
const NEW_WORK_CLOSED_STATES: readonly ShadowCaseState[] = Object.freeze([
  'REJECTED', 'EXPIRED', 'RESOLVED', 'ROLLED_BACK',
  'POSTMORTEM_AND_LEARNING_RECORDED',
]);

function states(...values: ShadowCaseState[]): readonly ShadowCaseState[] {
  return Object.freeze(values);
}

const TRANSITIONS: Readonly<Record<ShadowCaseState, readonly ShadowCaseState[]>> = Object.freeze({
  DETECTED: states('DEDUPED_OR_SUPPRESSED'),
  DEDUPED_OR_SUPPRESSED: states('CASE_OPENED'),
  CASE_OPENED: states('EVIDENCE_FROZEN'),
  EVIDENCE_FROZEN: states('REDACTION_VERIFIED', 'QUARANTINED'),
  REDACTION_VERIFIED: states('BUDGET_ADMITTED', 'OWNER_ATTENTION_REQUIRED'),
  BUDGET_ADMITTED: states('DIAGNOSING', 'PROVIDER_UNAVAILABLE'),
  DIAGNOSING: states('DIAGNOSIS_READY', 'INSUFFICIENT_EVIDENCE', 'PROVIDER_UNAVAILABLE', 'QUARANTINED'),
  DIAGNOSIS_READY: states('PROPOSAL_READY', 'OWNER_ATTENTION_REQUIRED', 'QUARANTINED'),
  INSUFFICIENT_EVIDENCE: states('DIAGNOSING', 'OWNER_ATTENTION_REQUIRED', 'QUARANTINED'),
  PROVIDER_UNAVAILABLE: states('DIAGNOSING', 'OWNER_ATTENTION_REQUIRED', 'ESCALATED'),
  PROPOSAL_READY: states('POLICY_EVALUATED', 'QUARANTINED'),
  OWNER_ATTENTION_REQUIRED: states('POLICY_EVALUATED', 'ESCALATED', 'REJECTED'),
  QUARANTINED: states('OWNER_ATTENTION_REQUIRED', 'REJECTED'),
  POLICY_EVALUATED: states('SANDBOX_VERIFYING', 'WAITING_APPROVAL', 'REJECTED'),
  SANDBOX_VERIFYING: states('VERIFIED', 'VERIFICATION_FAILED'),
  WAITING_APPROVAL: states('VERIFIED', 'REJECTED', 'EXPIRED'),
  REJECTED: states('POSTMORTEM_AND_LEARNING_RECORDED'),
  VERIFIED: states('HANDED_OFF', 'EXPIRED'),
  VERIFICATION_FAILED: states('OWNER_ATTENTION_REQUIRED', 'REJECTED'),
  HANDED_OFF: states('ACTION_READBACK', 'EXPIRED'),
  EXPIRED: states('ESCALATED', 'POSTMORTEM_AND_LEARNING_RECORDED'),
  ACTION_READBACK: states('RESOLVED', 'ROLLED_BACK', 'RECURRENT', 'ESCALATED'),
  RESOLVED: states('POSTMORTEM_AND_LEARNING_RECORDED'),
  ROLLED_BACK: states('POSTMORTEM_AND_LEARNING_RECORDED'),
  RECURRENT: states('POSTMORTEM_AND_LEARNING_RECORDED'),
  ESCALATED: states('POSTMORTEM_AND_LEARNING_RECORDED'),
  POSTMORTEM_AND_LEARNING_RECORDED: states(),
});

function isCaseState(value: unknown): value is ShadowCaseState {
  return typeof value === 'string' && (SHADOW_CASE_STATES as readonly string[]).includes(value);
}

function latestCurrentGenerationAuxiliaryTime(snapshot: Readonly<ShadowCaseSnapshot>): number {
  return Math.max(
    snapshot.updatedAtMs,
    ...snapshot.attempts.filter((entry) => entry.generation === snapshot.generation).map((entry) => entry.recordedAtMs),
    ...snapshot.effects.filter((entry) => entry.generation === snapshot.generation).map((entry) => entry.recordedAtMs),
    ...snapshot.proofs.filter((entry) => entry.generation === snapshot.generation).map((entry) => entry.recordedAtMs),
  );
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  return Object.freeze(value);
}

function commandDigest(
  caseId: string,
  generation: number,
  request: Readonly<Omit<ShadowCaseTransitionRequest, 'expectedRevision' | 'expectedGeneration'>>,
): string {
  return digestValue({
    caseId,
    generation,
    commandId: request.commandId,
    toState: request.toState,
    occurredAtMs: request.occurredAtMs,
    reasonCodes: boundedSortedIdentifiers(request.reasonCodes, 'request.reasonCodes', 32),
    evidencePointerIds: boundedSortedIdentifiers(request.evidencePointerIds, 'request.evidencePointerIds', 128),
  });
}

function eventChainDigest(previous: string | null, eventWithoutChain: object): string {
  return sha256(`${previous ?? 'GENESIS'}\0${canonicalJson(eventWithoutChain)}`);
}

function boundReasonDigest(reasonCodes: readonly string[], prefix: string): string | null {
  const matches = reasonCodes.filter((reason) => reason.startsWith(`${prefix}:`));
  if (matches.length !== 1) return null;
  const digest = matches[0].slice(prefix.length + 1);
  return /^[a-f0-9]{64}$/u.test(digest) ? digest : null;
}

function caseProofPayload(proof: Readonly<Omit<ShadowCaseProof, 'proofId' | 'proofDigest' | 'signature'>>): object {
  return {
    schema: proof.schema,
    shadowStatus: proof.shadowStatus,
    proofKind: proof.proofKind,
    caseId: proof.caseId,
    generation: proof.generation,
    artifactId: proof.artifactId,
    artifactDigest: proof.artifactDigest,
    validationReceiptDigest: proof.validationReceiptDigest,
    disposition: proof.disposition,
    recordedAtMs: proof.recordedAtMs,
    operationalAuthority: proof.operationalAuthority,
  };
}

function validateCaseProof(proof: Readonly<ShadowCaseProof>): void {
  assertClosedKeys(proof, [
    'schema', 'shadowStatus', 'proofId', 'proofKind', 'caseId', 'generation', 'artifactId', 'artifactDigest',
    'validationReceiptDigest', 'disposition', 'recordedAtMs', 'operationalAuthority', 'proofDigest', 'signature',
  ], 'case proof');
  if (proof.schema !== 'AI_OPS_A2_CASE_PROOF_V1' || proof.shadowStatus !== SHADOW_A2_STATUS) throw new TypeError('case proof schema or status invalid');
  if (!(SHADOW_CASE_PROOF_KINDS as readonly string[]).includes(proof.proofKind)) throw new TypeError('case proof kind invalid');
  assertIdentifier(proof.proofId, 'proof.proofId');
  assertIdentifier(proof.caseId, 'proof.caseId');
  assertSafeNonNegative(proof.generation, 'proof.generation');
  assertIdentifier(proof.artifactId, 'proof.artifactId');
  assertDigest(proof.artifactDigest, 'proof.artifactDigest');
  assertDigest(proof.validationReceiptDigest, 'proof.validationReceiptDigest');
  if (!(['VALIDATED', 'INVALIDATED', 'INCONCLUSIVE'] as const).includes(proof.disposition)) throw new TypeError('case proof disposition invalid');
  assertUtc(proof.recordedAtMs, 'proof.recordedAtMs');
  if (proof.operationalAuthority !== 'NONE') throw new TypeError('case proof cannot carry operational authority');
  assertDigest(proof.proofDigest, 'proof.proofDigest');
  assertClosedKeys(proof.signature, ['posture', 'algorithm', 'keyId', 'signature'], 'case proof signature');
  if (proof.signature.posture !== 'SYNTHETIC_ONLY') throw new TypeError('shadow case proof signature must remain synthetic-only');
  assertIdentifier(proof.signature.algorithm, 'proof.signature.algorithm');
  assertIdentifier(proof.signature.keyId, 'proof.signature.keyId');
  if (typeof proof.signature.signature !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/u.test(proof.signature.signature)) throw new TypeError('case proof signature bytes malformed');
  if (digestValue(caseProofPayload(proof)) !== proof.proofDigest) throw new TypeError('case proof digest mismatch');
  const expectedId = shadowSpeculativeId('a2-case-proof', {
    caseId: proof.caseId,
    generation: proof.generation,
    proofKind: proof.proofKind,
    artifactId: proof.artifactId,
    proofDigest: proof.proofDigest,
  });
  if (proof.proofId !== expectedId) throw new TypeError('case proof ID mismatch');
}

/** Readback belongs to the artifact validator; this runtime has no proof-issuing authority. */
export interface ShadowCaseProofVerifierPort {
  readonly posture: 'SYNTHETIC_ONLY';
  verifyDigest(digest: string, signature: Readonly<ShadowCaseProof['signature']>): boolean;
  verifyArtifactValidation(proof: Readonly<ShadowCaseProof>): boolean;
}

function proofVerifiedByOwnerReadback(
  proof: Readonly<ShadowCaseProof>,
  verifier: Readonly<ShadowCaseProofVerifierPort>,
): boolean {
  try {
    validateCaseProof(proof);
    return verifier.posture === 'SYNTHETIC_ONLY'
      && verifier.verifyDigest(proof.proofDigest, proof.signature) === true
      && verifier.verifyArtifactValidation(proof) === true;
  } catch {
    return false;
  }
}

function matchingProof(
  current: Readonly<ShadowCaseSnapshot>,
  proofKind: ShadowCaseProofKind,
  artifactDigest: string | null,
  atMs: number,
  verifier: Readonly<ShadowCaseProofVerifierPort> | null,
  notBeforeMs = current.firstSeenAtMs,
  artifactId: string | null = null,
): Readonly<ShadowCaseProof> | null {
  if (artifactDigest === null || verifier?.posture !== 'SYNTHETIC_ONLY') return null;
  return current.proofs.find((proof) => {
    if (
      proof.proofKind !== proofKind
      || proof.generation !== current.generation
      || proof.artifactDigest !== artifactDigest
      || (artifactId !== null && proof.artifactId !== artifactId)
      || proof.disposition !== 'VALIDATED'
      || proof.recordedAtMs < notBeforeMs
      || proof.recordedAtMs > atMs
    ) return false;
    try {
      return proofVerifiedByOwnerReadback(proof, verifier);
    } catch { return false; }
  }) ?? null;
}

function proofMatches(
  current: Readonly<ShadowCaseSnapshot>,
  proofKind: ShadowCaseProofKind,
  artifactDigest: string | null,
  atMs: number,
  verifier: Readonly<ShadowCaseProofVerifierPort> | null,
  notBeforeMs = current.firstSeenAtMs,
): boolean {
  return matchingProof(current, proofKind, artifactDigest, atMs, verifier, notBeforeMs) !== null;
}

function generationBudgetReceiptId(generation: number, receiptId: string): string {
  return shadowSpeculativeId('a2-budget-receipt', { generation, receiptId });
}

function makeEvent(
  caseId: string,
  generation: number,
  revision: number,
  fromState: ShadowCaseState | null,
  request: Readonly<Omit<ShadowCaseTransitionRequest, 'expectedRevision' | 'expectedGeneration'>>,
  previousChainDigest: string | null,
): Readonly<ShadowCaseEvent> {
  const canonicalRequest = Object.freeze({
    commandId: request.commandId,
    toState: request.toState,
    occurredAtMs: request.occurredAtMs,
    reasonCodes: boundedSortedIdentifiers(request.reasonCodes, 'request.reasonCodes', 32),
    evidencePointerIds: boundedSortedIdentifiers(request.evidencePointerIds, 'request.evidencePointerIds', 128),
  });
  const requestDigest = commandDigest(caseId, generation, canonicalRequest);
  const core = {
    schema: 'AI_OPS_A2_CASE_EVENT_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    commandId: canonicalRequest.commandId,
    commandDigest: requestDigest,
    caseId,
    generation,
    revision,
    fromState,
    toState: canonicalRequest.toState,
    occurredAtMs: canonicalRequest.occurredAtMs,
    reasonCodes: canonicalRequest.reasonCodes,
    evidencePointerIds: canonicalRequest.evidencePointerIds,
    previousChainDigest,
  };
  return Object.freeze({
    ...core,
    eventId: shadowSpeculativeId('a2-case-event', { caseId, generation, revision, commandDigest: requestDigest }),
    chainDigest: eventChainDigest(previousChainDigest, core),
  });
}

function sealSnapshot(value: Omit<ShadowCaseSnapshot, 'snapshotDigest'> | ShadowCaseSnapshot): Readonly<ShadowCaseSnapshot> {
  const { snapshotDigest: _oldDigest, ...unsealed } = value as ShadowCaseSnapshot;
  const cloned = JSON.parse(canonicalJson(unsealed)) as Omit<ShadowCaseSnapshot, 'snapshotDigest'>;
  return deepFreeze({ ...cloned, snapshotDigest: digestValue(cloned) }) as Readonly<ShadowCaseSnapshot>;
}

function transitionPrerequisiteFailure(
  current: Readonly<ShadowCaseSnapshot>,
  request: Readonly<ShadowCaseTransitionRequest>,
  proofVerifier: Readonly<ShadowCaseProofVerifierPort> | null,
): string | null {
  const pointers = new Set([...current.evidencePointerIds, ...request.evidencePointerIds]);
  const currentGenerationPointers = new Set([...current.currentGenerationEvidencePointerIds, ...request.evidencePointerIds]);
  const currentGenerationAttempts = current.attempts.filter((attempt) => attempt.generation === current.generation);
  const currentGenerationEffects = current.effects.filter((effect) => effect.generation === current.generation);
  if (['RESOLVED', 'ROLLED_BACK', 'POSTMORTEM_AND_LEARNING_RECORDED'].includes(request.toState)) {
    const attemptLineages = new Set(currentGenerationAttempts.map((attempt) => `${attempt.operationClass}\0${attempt.sourceRecordId}`));
    const unresolvedAttempt = [...attemptLineages].some((key) => {
      const [operationClass, sourceRecordId] = key.split('\0');
      const last = currentGenerationAttempts.filter((attempt) => (
        attempt.operationClass === operationClass && attempt.sourceRecordId === sourceRecordId
      )).at(-1);
      return last !== undefined && last.disposition !== 'SUCCEEDED' && last.disposition !== 'DEAD_LETTERED';
    });
    const effectLineages = new Set(currentGenerationEffects.map((effect) => effect.effectId));
    const unresolvedEffect = [...effectLineages].some((effectId) => {
      const last = currentGenerationEffects.filter((effect) => effect.effectId === effectId).at(-1);
      return last !== undefined && last.state !== 'APPLIED' && last.state !== 'NOT_APPLIED';
    });
    if (unresolvedAttempt || unresolvedEffect) return 'UNRESOLVED_DURABLE_WORK';
  }
  if (pointers.size > MAX_EVIDENCE_POINTERS) return 'EVIDENCE_POINTER_CAPACITY_EXCEEDED';
  if (
    current.currentGenerationEvidenceBundleBinding !== null
    && request.evidencePointerIds.some((pointerId) => !current.currentGenerationEvidencePointerIds.includes(pointerId))
  ) return 'FROZEN_EVIDENCE_POINTER_SET_CONTINUITY_REQUIRED';
  if (['EVIDENCE_FROZEN', 'REDACTION_VERIFIED', 'PROPOSAL_READY'].includes(request.toState) && currentGenerationPointers.size === 0) {
    return 'VALIDATED_EVIDENCE_REQUIRED';
  }
  if (request.toState === 'EVIDENCE_FROZEN') {
    const evidenceBundleDigest = boundReasonDigest(request.reasonCodes, 'EVIDENCE_BUNDLE_BOUND');
    const frozenPointerIds = [...currentGenerationPointers].sort();
    const pointerSetDigest = digestValue(frozenPointerIds);
    if (boundReasonDigest(request.reasonCodes, 'EVIDENCE_POINTER_SET_BOUND') !== pointerSetDigest) {
      return 'EVIDENCE_POINTER_SET_BINDING_REQUIRED';
    }
    const evidenceBindingDigest = evidenceBundleDigest === null
      ? null
      : digestValue({ evidenceBundleDigest, evidencePointerIds: frozenPointerIds });
    if (!proofMatches(current, 'EVIDENCE_BUNDLE', evidenceBindingDigest, request.occurredAtMs, proofVerifier)) {
      return 'SIGNED_EVIDENCE_BUNDLE_PROOF_REQUIRED';
    }
  }
  if (request.toState === 'REDACTION_VERIFIED' && !proofMatches(current, 'REDACTION_REPORT', boundReasonDigest(request.reasonCodes, 'REDACTION_REPORT_BOUND'), request.occurredAtMs, proofVerifier)) {
    return 'SIGNED_REDACTION_PROOF_REQUIRED';
  }
  if (request.toState === 'BUDGET_ADMITTED') {
    const budgetProof = matchingProof(current, 'BUDGET_ADMISSION', boundReasonDigest(request.reasonCodes, 'BUDGET_ADMISSION_BOUND'), request.occurredAtMs, proofVerifier);
    if (budgetProof === null) return 'SIGNED_BUDGET_ADMISSION_PROOF_REQUIRED';
    if (!current.budgetReceiptIds.includes(generationBudgetReceiptId(current.generation, budgetProof.artifactId))) return 'BUDGET_ADMISSION_RECEIPT_NOT_ATTACHED';
  }
  if (request.toState === 'DIAGNOSING') {
    if (current.diagnosticRoundCount >= MAX_DIAGNOSTIC_ROUNDS) return 'DIAGNOSTIC_ROUND_LIMIT_REACHED';
    const roundBudgetDigest = boundReasonDigest(request.reasonCodes, 'DIAGNOSTIC_ROUND_BUDGET_BOUND');
    const roundBudgetProof = matchingProof(
      current,
      'BUDGET_ADMISSION',
      roundBudgetDigest,
      request.occurredAtMs,
      proofVerifier,
      current.state === 'BUDGET_ADMITTED' ? current.firstSeenAtMs : current.updatedAtMs,
    );
    if (roundBudgetProof === null) return 'FRESH_DIAGNOSTIC_ROUND_BUDGET_PROOF_REQUIRED';
    if (current.diagnosticRoundBudgetProofIds.includes(roundBudgetProof.proofId)) return 'DIAGNOSTIC_ROUND_BUDGET_PROOF_ALREADY_CONSUMED';
    if (current.state !== 'BUDGET_ADMITTED' && roundBudgetProof.recordedAtMs <= current.updatedAtMs) {
      return 'FRESH_DIAGNOSTIC_ROUND_BUDGET_PROOF_REQUIRED';
    }
    if (!current.budgetReceiptIds.includes(generationBudgetReceiptId(current.generation, roundBudgetProof.artifactId))) {
      return 'DIAGNOSTIC_ROUND_BUDGET_RECEIPT_NOT_ATTACHED';
    }
  }
  if (request.toState === 'PROVIDER_UNAVAILABLE') {
    const failure = currentGenerationAttempts.find((attempt) => (
      attempt.operationClass === 'PROVIDER'
      && ['FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN'].includes(attempt.disposition)
      && attempt.recordedAtMs >= current.updatedAtMs
      && attempt.recordedAtMs <= request.occurredAtMs
    ));
    if (!failure) return 'PROVIDER_OUTAGE_ATTEMPT_RECEIPT_REQUIRED';
  }
  if (request.toState === 'INSUFFICIENT_EVIDENCE') {
    const failure = currentGenerationAttempts.find((attempt) => (
      attempt.operationClass === 'EVIDENCE_READ'
      && ['FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN'].includes(attempt.disposition)
      && attempt.recordedAtMs >= current.updatedAtMs
      && attempt.recordedAtMs <= request.occurredAtMs
    ));
    if (!failure) return 'EVIDENCE_READ_FAILURE_RECEIPT_REQUIRED';
  }
  const diagnosticResultDigest = boundReasonDigest(request.reasonCodes, 'DIAGNOSTIC_RESULT_BOUND');
  const boundEvidenceBundleDigest = boundReasonDigest(request.reasonCodes, 'EVIDENCE_BUNDLE_BOUND');
  const diagnosticEvidenceBindingDigest = boundReasonDigest(request.reasonCodes, 'DIAGNOSTIC_EVIDENCE_BINDING_BOUND');
  const expectedDiagnosticEvidenceBindingDigest = diagnosticResultDigest === null || boundEvidenceBundleDigest === null
    ? null
    : digestValue({ diagnosticResultDigest, evidenceBundleDigest: boundEvidenceBundleDigest });
  const diagnosticAttempt = request.toState === 'DIAGNOSIS_READY'
    ? currentGenerationAttempts.find((attempt) => (
      (attempt.operationClass === 'PROVIDER' || attempt.operationClass === 'DETERMINISTIC')
      && attempt.disposition === 'SUCCEEDED'
      && attempt.payloadDigest === diagnosticResultDigest
      && attempt.recordedAtMs >= current.updatedAtMs
      && attempt.recordedAtMs <= request.occurredAtMs
    )) ?? null
    : null;
  if (request.toState === 'DIAGNOSIS_READY' && diagnosticResultDigest === null) return 'DIAGNOSTIC_RESULT_BINDING_REQUIRED';
  if (
    request.toState === 'DIAGNOSIS_READY'
    && (
      current.currentGenerationEvidenceBundleBinding === null
      || current.currentGenerationEvidenceBundleBinding.generation !== current.generation
      || boundEvidenceBundleDigest !== current.currentGenerationEvidenceBundleBinding.bundleDigest
    )
  ) return 'FROZEN_EVIDENCE_BUNDLE_CONTINUITY_REQUIRED';
  if (
    request.toState === 'DIAGNOSIS_READY'
    && diagnosticEvidenceBindingDigest !== expectedDiagnosticEvidenceBindingDigest
  ) return 'DIAGNOSTIC_EVIDENCE_BINDING_REQUIRED';
  if (request.toState === 'DIAGNOSIS_READY' && diagnosticAttempt === null) return 'SUCCESSFUL_DIAGNOSTIC_ATTEMPT_REQUIRED';
  if (request.toState === 'DIAGNOSIS_READY' && !proofMatches(
    current,
    'DIAGNOSTIC_RESULT',
    diagnosticEvidenceBindingDigest,
    request.occurredAtMs,
    proofVerifier,
    diagnosticAttempt?.recordedAtMs ?? request.occurredAtMs,
  )) {
    return 'SIGNED_DIAGNOSTIC_RESULT_PROOF_REQUIRED';
  }
  if (request.toState === 'PROPOSAL_READY') {
    if (
      current.currentGenerationEvidenceBundleBinding === null
      || boundEvidenceBundleDigest !== current.currentGenerationEvidenceBundleBinding.bundleDigest
    ) return 'FROZEN_EVIDENCE_BUNDLE_CONTINUITY_REQUIRED';
    if (
      current.currentGenerationDiagnosticBinding === null
      || diagnosticResultDigest !== current.currentGenerationDiagnosticBinding.diagnosticDigest
      || boundEvidenceBundleDigest !== current.currentGenerationDiagnosticBinding.evidenceBundleDigest
      || diagnosticEvidenceBindingDigest !== current.currentGenerationDiagnosticBinding.bindingDigest
      || diagnosticEvidenceBindingDigest !== expectedDiagnosticEvidenceBindingDigest
    ) return 'DIAGNOSTIC_RESULT_CONTINUITY_REQUIRED';
    if (!proofMatches(
      current,
      'DIAGNOSTIC_RESULT',
      diagnosticEvidenceBindingDigest,
      request.occurredAtMs,
      proofVerifier,
    )) return 'SIGNED_DIAGNOSTIC_PROPOSAL_PROOF_REQUIRED';
  }
  if (request.toState === 'VERIFIED') {
    const verificationResultDigest = boundReasonDigest(request.reasonCodes, 'VERIFICATION_RESULT_BOUND');
    if (verificationResultDigest === null) return 'VERIFICATION_RESULT_BINDING_REQUIRED';
    const verificationAttempt = currentGenerationAttempts.find((attempt) => (
      attempt.operationClass === 'DETERMINISTIC'
      && attempt.disposition === 'SUCCEEDED'
      && attempt.payloadDigest === verificationResultDigest
      && attempt.recordedAtMs >= current.updatedAtMs
      && attempt.recordedAtMs <= request.occurredAtMs
    )) ?? null;
    if (verificationAttempt === null) return 'INDEPENDENT_VERIFICATION_ATTEMPT_REQUIRED';
    if (!proofMatches(
      current,
      'VERIFICATION_RESULT',
      verificationResultDigest,
      request.occurredAtMs,
      proofVerifier,
      verificationAttempt.recordedAtMs,
    )) return 'SIGNED_VERIFICATION_RESULT_PROOF_REQUIRED';
    if (current.state === 'WAITING_APPROVAL' && !request.reasonCodes.includes('OWNER_APPROVAL_BOUND')) {
      return 'OWNER_APPROVAL_BINDING_REQUIRED';
    }
    if (current.state === 'WAITING_APPROVAL' && boundReasonDigest(request.reasonCodes, 'OWNER_APPROVAL_DIGEST') === null) {
      return 'OWNER_APPROVAL_DIGEST_REQUIRED';
    }
    if (current.state === 'WAITING_APPROVAL' && !proofMatches(
      current,
      'OWNER_APPROVAL',
      boundReasonDigest(request.reasonCodes, 'OWNER_APPROVAL_DIGEST'),
      request.occurredAtMs,
      proofVerifier,
      current.updatedAtMs,
    )) {
      return 'SIGNED_OWNER_APPROVAL_PROOF_REQUIRED';
    }
  }
  const modelHandoffDigest = boundReasonDigest(request.reasonCodes, 'MODEL_RUN_HANDOFF_BOUND');
  const handoffAttempt = request.toState === 'HANDED_OFF'
    ? currentGenerationAttempts.find((attempt) => (
      attempt.operationClass === 'HANDOFF'
      && attempt.disposition === 'SUCCEEDED'
      && attempt.payloadDigest === modelHandoffDigest
      && attempt.recordedAtMs >= current.updatedAtMs
      && attempt.recordedAtMs <= request.occurredAtMs
    )) ?? null
    : null;
  if (request.toState === 'HANDED_OFF' && modelHandoffDigest === null) return 'MODEL_RUN_HANDOFF_BINDING_REQUIRED';
  if (request.toState === 'HANDED_OFF' && handoffAttempt === null) return 'HANDOFF_RECEIPT_REQUIRED';
  if (request.toState === 'HANDED_OFF' && !proofMatches(
    current,
    'MODEL_RUN_HANDOFF',
    modelHandoffDigest,
    request.occurredAtMs,
    proofVerifier,
    handoffAttempt?.recordedAtMs ?? request.occurredAtMs,
  )) {
    return 'SIGNED_MODEL_RUN_HANDOFF_PROOF_REQUIRED';
  }
  const effectReadbackDigest = boundReasonDigest(request.reasonCodes, 'GLOBAL_EFFECT_READBACK_BOUND');
  const effectReadbackIdDigest = boundReasonDigest(request.reasonCodes, 'GLOBAL_EFFECT_ID_BOUND');
  if (request.toState === 'ACTION_READBACK' && effectReadbackDigest === null) return 'GLOBAL_EFFECT_READBACK_BINDING_REQUIRED';
  if (request.toState === 'ACTION_READBACK' && effectReadbackIdDigest === null) return 'GLOBAL_EFFECT_ID_BINDING_REQUIRED';
  const effectReadback = request.toState === 'ACTION_READBACK'
    ? currentGenerationEffects.find((effect) => (
    effect.state !== 'INTENT'
    && effect.payloadDigest === effectReadbackDigest
    && sha256(effect.effectId) === effectReadbackIdDigest
    && effect.recordedAtMs >= current.updatedAtMs
    && effect.recordedAtMs <= request.occurredAtMs
    )) ?? null
    : null;
  if (request.toState === 'ACTION_READBACK' && effectReadback === null) return 'GLOBAL_EFFECT_READBACK_REQUIRED';
  const effectReadbackProof = request.toState === 'ACTION_READBACK' ? matchingProof(
    current,
    'EFFECT_READBACK',
    effectReadbackDigest,
    request.occurredAtMs,
    proofVerifier,
    effectReadback?.recordedAtMs,
    effectReadback?.effectId ?? null,
  ) : null;
  if (request.toState === 'ACTION_READBACK' && effectReadbackProof === null) return 'SIGNED_EFFECT_READBACK_PROOF_REQUIRED';
  if (request.toState === 'ACTION_READBACK') {
    if (!effectReadback || effectReadbackIdDigest !== sha256(effectReadback.effectId)) return 'GLOBAL_EFFECT_ID_BINDING_REQUIRED';
    if (effectReadbackProof?.artifactId !== effectReadback.effectId) return 'EFFECT_READBACK_PROOF_IDENTITY_MISMATCH';
  }
  if (request.toState === 'RESOLVED' || request.toState === 'ROLLED_BACK') {
    let finalizationProofNotBeforeMs = (current.actionReadbackBinding?.occurredAtMs ?? request.occurredAtMs) + 1;
    assertUtc(finalizationProofNotBeforeMs, 'finalization proof lower bound');
    const effectReasonPrefix = request.toState === 'RESOLVED' ? 'APPLIED_EFFECT_BOUND' : 'COMPENSATION_EFFECT_BOUND';
    const effectIdReasonPrefix = request.toState === 'RESOLVED' ? 'APPLIED_EFFECT_ID_BOUND' : 'COMPENSATION_EFFECT_ID_BOUND';
    const finalEffectDigest = boundReasonDigest(request.reasonCodes, effectReasonPrefix);
    const finalEffectIdDigest = boundReasonDigest(request.reasonCodes, effectIdReasonPrefix);
    const priorEffectDigest = current.actionReadbackBinding?.generation === current.generation
      ? current.actionReadbackBinding.effectDigest
      : null;
    const priorEffectIdDigest = current.actionReadbackBinding?.generation === current.generation
      ? current.actionReadbackBinding.effectIdDigest
      : null;
    if (request.toState === 'RESOLVED') {
      const appliedEffect = currentGenerationEffects.find((effect) => (
        effect.state === 'APPLIED'
        && effect.payloadDigest === finalEffectDigest
        && sha256(effect.effectId) === finalEffectIdDigest
        && effect.recordedAtMs <= request.occurredAtMs
      )) ?? null;
      const appliedProof = appliedEffect === null ? null : matchingProof(
        current,
        'EFFECT_READBACK',
        finalEffectDigest,
        request.occurredAtMs,
        proofVerifier,
        appliedEffect.recordedAtMs,
        appliedEffect.effectId,
      );
      const appliedCompensation = appliedEffect === null ? null : currentGenerationEffects.find((effect) => (
        effect.state === 'APPLIED'
        && effect.compensatesEffectId === appliedEffect.effectId
        && effect.recordedAtMs <= request.occurredAtMs
      )) ?? null;
      if (
        finalEffectDigest === null
        || finalEffectDigest !== priorEffectDigest
        || finalEffectIdDigest === null
        || finalEffectIdDigest !== priorEffectIdDigest
        || appliedEffect === null
        || appliedProof?.artifactId !== appliedEffect.effectId
        || appliedCompensation !== null
      ) return 'APPLIED_EFFECT_READBACK_REQUIRED';
      finalizationProofNotBeforeMs = Math.max(finalizationProofNotBeforeMs, appliedEffect.recordedAtMs + 1);
      assertUtc(finalizationProofNotBeforeMs, 'resolution proof lower bound');
    } else {
      const originalApplied = currentGenerationEffects.some((effect) => (
        effect.state === 'APPLIED'
        && effect.payloadDigest === priorEffectDigest
        && sha256(effect.effectId) === priorEffectIdDigest
      ));
      const originalAppliedEffect = currentGenerationEffects.find((effect) => (
        effect.state === 'APPLIED'
        && effect.payloadDigest === priorEffectDigest
        && sha256(effect.effectId) === priorEffectIdDigest
      )) ?? null;
      const originalAppliedProof = originalAppliedEffect === null ? null : matchingProof(
        current,
        'EFFECT_READBACK',
        priorEffectDigest,
        request.occurredAtMs,
        proofVerifier,
        originalAppliedEffect.recordedAtMs,
        originalAppliedEffect.effectId,
      );
      const compensation = currentGenerationEffects.find((effect) => (
        effect.state === 'APPLIED'
        && effect.compensatesEffectId === originalAppliedEffect?.effectId
        && effect.payloadDigest === finalEffectDigest
        && sha256(effect.effectId) === finalEffectIdDigest
        && effect.recordedAtMs >= Math.max(
          current.actionReadbackBinding?.occurredAtMs ?? request.occurredAtMs,
          originalAppliedEffect?.recordedAtMs ?? request.occurredAtMs,
        )
        && effect.recordedAtMs <= request.occurredAtMs
      )) ?? null;
      const compensationProof = compensation === null ? null : matchingProof(
        current,
        'EFFECT_READBACK',
        finalEffectDigest,
        request.occurredAtMs,
        proofVerifier,
        compensation.recordedAtMs,
        compensation.effectId,
      );
      if (
        !originalApplied
        || originalAppliedProof?.artifactId !== originalAppliedEffect?.effectId
        || finalEffectDigest === null
        || finalEffectIdDigest === null
        || finalEffectIdDigest === priorEffectIdDigest
        || compensation === null
        || compensationProof?.artifactId !== compensation.effectId
      ) return 'COMPENSATION_EFFECT_READBACK_REQUIRED';
      finalizationProofNotBeforeMs = Math.max(
        finalizationProofNotBeforeMs,
        (originalAppliedEffect?.recordedAtMs ?? compensation.recordedAtMs) + 1,
        compensation.recordedAtMs + 1,
      );
      assertUtc(finalizationProofNotBeforeMs, 'rollback proof lower bound');
    }
    if (boundReasonDigest(request.reasonCodes, 'INDEPENDENT_RECOVERY_READBACK_BOUND') === null) return 'INDEPENDENT_RECOVERY_READBACK_REQUIRED';
    if (boundReasonDigest(request.reasonCodes, 'QUIET_PERIOD_EVIDENCE_BOUND') === null) return 'QUIET_PERIOD_EVIDENCE_REQUIRED';
    if (!proofMatches(
      current,
      'RECOVERY_READBACK',
      boundReasonDigest(request.reasonCodes, 'INDEPENDENT_RECOVERY_READBACK_BOUND'),
      request.occurredAtMs,
      proofVerifier,
      finalizationProofNotBeforeMs,
    )) {
      return 'SIGNED_RECOVERY_READBACK_PROOF_REQUIRED';
    }
    if (!proofMatches(
      current,
      'QUIET_PERIOD',
      boundReasonDigest(request.reasonCodes, 'QUIET_PERIOD_EVIDENCE_BOUND'),
      request.occurredAtMs,
      proofVerifier,
      finalizationProofNotBeforeMs,
    )) {
      return 'SIGNED_QUIET_PERIOD_PROOF_REQUIRED';
    }
    if (
      request.evidencePointerIds.length === 0
      || request.evidencePointerIds.some((pointerId) => !current.currentGenerationEvidencePointerIds.includes(pointerId))
    ) return 'RECOVERY_EVIDENCE_REQUIRED';
  }
  return null;
}

export function createCaseSnapshot(
  caseId: string,
  commandId: string,
  detectedAtMs: number,
  reasonCodes: readonly string[],
  evidencePointerIds: readonly string[] = [],
): Readonly<ShadowCaseSnapshot> {
  assertIdentifier(caseId, 'caseId');
  assertIdentifier(commandId, 'commandId');
  assertUtc(detectedAtMs, 'detectedAtMs');
  const event = makeEvent(caseId, 0, 0, null, {
    commandId,
    toState: 'DETECTED',
    occurredAtMs: detectedAtMs,
    reasonCodes,
    evidencePointerIds,
  }, null);
  return sealSnapshot({
    schema: 'AI_OPS_A2_CASE_SNAPSHOT_V1',
    shadowStatus: SHADOW_A2_STATUS,
    caseId,
    generation: 0,
    revision: 0,
    state: 'DETECTED',
    firstSeenAtMs: detectedAtMs,
    updatedAtMs: detectedAtMs,
    events: [event],
    compactedThroughRevision: -1,
    compactedChainDigest: null,
    commandReceipts: [{
      commandId,
      commandDigest: event.commandDigest,
      revision: 0,
      generation: 0,
      commandKind: 'TRANSITION',
      toState: 'DETECTED',
      occurredAtMs: detectedAtMs,
    }],
    attempts: [],
    effects: [],
    proofs: [],
    budgetReceiptIds: [],
    evidencePointerIds: [...event.evidencePointerIds],
    currentGenerationEvidencePointerIds: [...event.evidencePointerIds],
    currentGenerationEvidenceBundleBinding: null,
    currentGenerationDiagnosticBinding: null,
    diagnosticRoundCount: 0,
    diagnosticRoundBudgetProofIds: [],
    actionReadbackBinding: null,
    backpressure: { active: false, resumeCursor: null, refusedCount: 0 },
  });
}

export type ShadowTransitionResult =
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'COMMITTED'; snapshot: Readonly<ShadowCaseSnapshot>; event: Readonly<ShadowCaseEvent> }>
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'IDEMPOTENT'; snapshot: Readonly<ShadowCaseSnapshot>; event: Readonly<ShadowCaseEvent> | null }>
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'REVISION_CONFLICT' | 'STALE_GENERATION' | 'ILLEGAL_TRANSITION' | 'BACKPRESSURED' | 'GUARDRAIL_TRIPPED'; snapshot: Readonly<ShadowCaseSnapshot>; event: null; reasonCode?: string }>;

export function transitionCase(
  current: Readonly<ShadowCaseSnapshot>,
  rawRequest: Readonly<ShadowCaseTransitionRequest>,
  proofVerifier: Readonly<ShadowCaseProofVerifierPort> | null = null,
  maximumRetainedEvents = MAX_EVENTS,
): ShadowTransitionResult {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'case snapshot') as Readonly<ShadowCaseSnapshot>;
  rawRequest = snapshotInertJson(rawRequest, 'case transition request') as Readonly<ShadowCaseTransitionRequest>;
  validateSnapshot(current);
  assertPositive(maximumRetainedEvents, 'maximumRetainedEvents');
  if (maximumRetainedEvents > MAX_EVENTS) throw new TypeError('retained event bound exceeds absolute maximum');
  assertClosedKeys(rawRequest, [
    'commandId', 'expectedRevision', 'expectedGeneration', 'toState', 'occurredAtMs', 'reasonCodes', 'evidencePointerIds',
  ], 'case transition request');
  assertIdentifier(rawRequest.commandId, 'request.commandId');
  assertSafeNonNegative(rawRequest.expectedRevision, 'request.expectedRevision');
  assertSafeNonNegative(rawRequest.expectedGeneration, 'request.expectedGeneration');
  assertUtc(rawRequest.occurredAtMs, 'request.occurredAtMs');
  if (!isCaseState(rawRequest.toState)) throw new TypeError('request.toState is unsupported');
  const request = Object.freeze({
    commandId: rawRequest.commandId,
    expectedRevision: rawRequest.expectedRevision,
    expectedGeneration: rawRequest.expectedGeneration,
    toState: rawRequest.toState,
    occurredAtMs: rawRequest.occurredAtMs,
    reasonCodes: boundedSortedIdentifiers(rawRequest.reasonCodes, 'request.reasonCodes', 32),
    evidencePointerIds: boundedSortedIdentifiers(rawRequest.evidencePointerIds, 'request.evidencePointerIds', 128),
  });
  const prospectiveDigest = commandDigest(current.caseId, request.expectedGeneration, request);
  const priorReceipt = current.commandReceipts.find((entry) => entry.commandId === request.commandId);
  if (priorReceipt) {
    if (priorReceipt.commandKind !== 'TRANSITION') throw new TypeError('command ID was already used by another command kind');
    if (priorReceipt.commandDigest !== prospectiveDigest) throw new TypeError('command ID replay has conflicting content');
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      status: 'IDEMPOTENT',
      snapshot: current,
      event: current.events.find((entry) => entry.commandId === request.commandId) ?? null,
    });
  }
  if (request.occurredAtMs < latestCurrentGenerationAuxiliaryTime(current)) {
    throw new TypeError('case transition time must be monotonic and not precede attached auxiliary receipts');
  }
  if (request.expectedGeneration !== current.generation) {
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'STALE_GENERATION', snapshot: current, event: null });
  }
  if (request.expectedRevision !== current.revision) {
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'REVISION_CONFLICT', snapshot: current, event: null });
  }
  if (current.backpressure.active || current.events.length >= maximumRetainedEvents || current.commandReceipts.length >= MAX_COMMAND_RECEIPTS) {
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'BACKPRESSURED', snapshot: current, event: null });
  }
  if (!TRANSITIONS[current.state].includes(request.toState)) {
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'ILLEGAL_TRANSITION', snapshot: current, event: null });
  }
  const guardrail = transitionPrerequisiteFailure(current, request, proofVerifier);
  if (guardrail !== null) {
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      status: 'GUARDRAIL_TRIPPED',
      snapshot: current,
      event: null,
      reasonCode: `AGENT_GUARDRAIL_TRIPPED:${guardrail}`,
    });
  }
  const previousChainDigest = current.events.at(-1)?.chainDigest ?? current.compactedChainDigest;
  const event = makeEvent(current.caseId, current.generation, current.revision + 1, current.state, request, previousChainDigest);
  const roundBudgetProof = event.toState === 'DIAGNOSING' && event.fromState !== event.toState
    ? matchingProof(
        current,
        'BUDGET_ADMISSION',
        boundReasonDigest(event.reasonCodes, 'DIAGNOSTIC_ROUND_BUDGET_BOUND'),
        event.occurredAtMs,
        proofVerifier,
        current.state === 'BUDGET_ADMITTED' ? current.firstSeenAtMs : current.updatedAtMs,
      )
    : null;
  const frozenEvidencePointerIds = [...new Set([
    ...current.currentGenerationEvidencePointerIds,
    ...event.evidencePointerIds,
  ])].sort();
  const frozenEvidenceBundleDigest = boundReasonDigest(event.reasonCodes, 'EVIDENCE_BUNDLE_BOUND');
  const snapshot = sealSnapshot({
    ...current,
    revision: event.revision,
    state: event.toState,
    updatedAtMs: event.occurredAtMs,
    events: [...current.events, event],
    commandReceipts: [...current.commandReceipts, {
      commandId: request.commandId,
      commandDigest: event.commandDigest,
      revision: event.revision,
      generation: event.generation,
      commandKind: 'TRANSITION',
      toState: event.toState,
      occurredAtMs: event.occurredAtMs,
    }],
    evidencePointerIds: [...new Set([...current.evidencePointerIds, ...event.evidencePointerIds])].sort(),
    currentGenerationEvidencePointerIds: [...new Set([
      ...current.currentGenerationEvidencePointerIds,
      ...event.evidencePointerIds,
    ])].sort(),
    currentGenerationEvidenceBundleBinding: event.toState === 'EVIDENCE_FROZEN' && event.fromState !== event.toState
      ? {
          generation: event.generation,
          bundleDigest: frozenEvidenceBundleDigest as string,
          pointerSetDigest: digestValue(frozenEvidencePointerIds),
          bindingDigest: digestValue({
            evidenceBundleDigest: frozenEvidenceBundleDigest,
            evidencePointerIds: frozenEvidencePointerIds,
          }),
          eventRevision: event.revision,
          occurredAtMs: event.occurredAtMs,
        }
      : current.currentGenerationEvidenceBundleBinding,
    currentGenerationDiagnosticBinding: event.toState === 'DIAGNOSIS_READY' && event.fromState !== event.toState
      ? {
          generation: event.generation,
          diagnosticDigest: boundReasonDigest(event.reasonCodes, 'DIAGNOSTIC_RESULT_BOUND') as string,
          evidenceBundleDigest: boundReasonDigest(event.reasonCodes, 'EVIDENCE_BUNDLE_BOUND') as string,
          bindingDigest: boundReasonDigest(event.reasonCodes, 'DIAGNOSTIC_EVIDENCE_BINDING_BOUND') as string,
          eventRevision: event.revision,
          occurredAtMs: event.occurredAtMs,
        }
      : current.currentGenerationDiagnosticBinding,
    diagnosticRoundCount: event.toState === 'DIAGNOSING' && event.fromState !== event.toState
      ? current.diagnosticRoundCount + 1
      : current.diagnosticRoundCount,
    diagnosticRoundBudgetProofIds: roundBudgetProof === null
      ? current.diagnosticRoundBudgetProofIds
      : [...current.diagnosticRoundBudgetProofIds, roundBudgetProof.proofId],
    actionReadbackBinding: event.toState === 'ACTION_READBACK' && event.fromState !== event.toState
      ? {
          generation: event.generation,
          effectDigest: boundReasonDigest(event.reasonCodes, 'GLOBAL_EFFECT_READBACK_BOUND') as string,
          effectIdDigest: boundReasonDigest(event.reasonCodes, 'GLOBAL_EFFECT_ID_BOUND') as string,
          eventRevision: event.revision,
          occurredAtMs: event.occurredAtMs,
        }
      : current.actionReadbackBinding,
  });
  return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'COMMITTED', snapshot, event });
}

export function setCaseBackpressure(
  current: Readonly<ShadowCaseSnapshot>,
  active: boolean,
  resumeCursor: string | null,
  commandId: string,
  occurredAtMs: number,
): Readonly<ShadowCaseSnapshot> {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'case snapshot') as Readonly<ShadowCaseSnapshot>;
  validateSnapshot(current);
  if (typeof active !== 'boolean') throw new TypeError('backpressure state must be boolean');
  if (resumeCursor !== null) assertIdentifier(resumeCursor, 'resumeCursor');
  if (active && resumeCursor === null) throw new TypeError('active backpressure requires a resume cursor');
  assertIdentifier(commandId, 'commandId');
  assertUtc(occurredAtMs, 'occurredAtMs');
  const reasonCodes = [
    active ? 'BACKPRESSURE_APPLIED' : 'BACKPRESSURE_CLEARED',
    active ? `RESUME_CURSOR_DIGEST:${sha256(resumeCursor as string)}` : 'RESUME_CURSOR_CLEARED',
  ];
  const priorReceipt = current.commandReceipts.find((entry) => entry.commandId === commandId);
  if (priorReceipt) {
    if (priorReceipt.commandKind !== 'BACKPRESSURE') throw new TypeError('command ID was already used by another command kind');
    const replayDigest = commandDigest(current.caseId, priorReceipt.generation, {
      commandId,
      toState: priorReceipt.toState,
      occurredAtMs,
      reasonCodes,
      evidencePointerIds: [],
    });
    if (priorReceipt.commandDigest !== replayDigest || priorReceipt.occurredAtMs !== occurredAtMs) {
      throw new TypeError('backpressure command replay has conflicting content');
    }
    return current;
  }
  const request = {
    commandId,
    toState: current.state,
    occurredAtMs,
    reasonCodes,
    evidencePointerIds: [],
  } as const;
  if (occurredAtMs < latestCurrentGenerationAuxiliaryTime(current)) {
    throw new TypeError('backpressure transition time must be monotonic and not precede attached auxiliary receipts');
  }
  if (current.events.length >= MAX_EVENTS || current.commandReceipts.length >= MAX_COMMAND_RECEIPTS) {
    throw new RangeError('case journal must be compacted before backpressure can be recorded');
  }
  const event = makeEvent(
    current.caseId,
    current.generation,
    current.revision + 1,
    current.state,
    request,
    current.events.at(-1)?.chainDigest ?? current.compactedChainDigest,
  );
  return sealSnapshot({
    ...current,
    revision: event.revision,
    updatedAtMs: occurredAtMs,
    events: [...current.events, event],
    commandReceipts: [...current.commandReceipts, {
      commandId,
      commandDigest: event.commandDigest,
      revision: event.revision,
      generation: event.generation,
      commandKind: 'BACKPRESSURE',
      toState: event.toState,
      occurredAtMs: event.occurredAtMs,
    }],
    backpressure: {
      active,
      resumeCursor: active ? resumeCursor : null,
      refusedCount: current.backpressure.refusedCount + (active ? 1 : 0),
    },
  });
}

export function recordAttempt(
  current: Readonly<ShadowCaseSnapshot>,
  attempt: Readonly<ShadowAttemptReceipt>,
  maximumAttempts = MAX_ATTEMPTS,
): Readonly<ShadowCaseSnapshot> {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'case snapshot') as Readonly<ShadowCaseSnapshot>;
  attempt = snapshotInertJson(attempt, 'attempt receipt') as Readonly<ShadowAttemptReceipt>;
  validateSnapshot(current);
  assertPositive(maximumAttempts, 'maximumAttempts');
  if (maximumAttempts > MAX_ATTEMPTS) throw new TypeError('attempt bound exceeds absolute maximum');
  assertClosedKeys(attempt, [
    'attemptId', 'sourceRecordId', 'attemptBaseline', 'operationClass', 'generation', 'attemptNumber', 'disposition', 'recordedAtMs', 'payloadDigest',
  ], 'attempt');
  assertIdentifier(attempt.attemptId, 'attempt.attemptId');
  assertIdentifier(attempt.sourceRecordId, 'attempt.sourceRecordId');
  assertSafeNonNegative(attempt.attemptBaseline, 'attempt.attemptBaseline');
  if (!(['DETERMINISTIC', 'PROVIDER', 'EVIDENCE_READ', 'HANDOFF', 'GLOBAL_EFFECT'] as const).includes(attempt.operationClass)) {
    throw new TypeError('attempt operation class unsupported');
  }
  if (!(['STARTED', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN', 'DEAD_LETTERED'] as const).includes(attempt.disposition)) {
    throw new TypeError('attempt disposition unsupported');
  }
  assertSafeNonNegative(attempt.generation, 'attempt.generation');
  assertPositive(attempt.attemptNumber, 'attempt.attemptNumber');
  assertUtc(attempt.recordedAtMs, 'attempt.recordedAtMs');
  assertDigest(attempt.payloadDigest, 'attempt.payloadDigest');
  const existing = current.attempts.find((entry) => entry.attemptId === attempt.attemptId);
  if (existing) {
    if (digestValue(existing) !== digestValue(attempt)) throw new TypeError('attempt ID replay has conflicting content');
    return current;
  }
  if (attempt.generation !== current.generation) throw new TypeError('stale generation attempt refused');
  if (attempt.recordedAtMs < current.updatedAtMs) throw new TypeError('attempt time must not precede case head');
  const prior = current.attempts.filter((entry) => (
    entry.operationClass === attempt.operationClass
    && entry.sourceRecordId === attempt.sourceRecordId
    && entry.generation === attempt.generation
  ));
  const lastPrior = prior.at(-1);
  if (lastPrior && attempt.attemptBaseline !== lastPrior.attemptBaseline) throw new TypeError('attempt baseline changed within its source lineage');
  if (lastPrior && attempt.recordedAtMs < lastPrior.recordedAtMs) throw new TypeError('attempt time must not regress within its source lineage');
  if (
    attempt.disposition === 'STARTED'
    && (lastPrior === undefined || lastPrior.disposition === 'FAILED_RETRYABLE')
    && NEW_WORK_CLOSED_STATES.includes(current.state)
  ) throw new TypeError('closed case cannot reserve new durable work');
  if (!lastPrior) {
    if (attempt.attemptNumber !== attempt.attemptBaseline + 1 || attempt.disposition !== 'STARTED') {
      throw new TypeError('attempt lineage must begin with a persisted STARTED reservation after its immutable baseline');
    }
  } else if (lastPrior.disposition === 'STARTED') {
    if (attempt.attemptNumber !== lastPrior.attemptNumber || attempt.disposition === 'STARTED' || attempt.disposition === 'DEAD_LETTERED') {
      throw new TypeError('attempt reservation requires one outcome at the same attempt number');
    }
    if (attempt.payloadDigest !== lastPrior.payloadDigest) throw new TypeError('attempt outcome changed the reserved payload');
  } else if (lastPrior.disposition === 'FAILED_RETRYABLE') {
    const retry = attempt.attemptNumber === lastPrior.attemptNumber + 1 && attempt.disposition === 'STARTED';
    const deadLetterClosure = attempt.attemptNumber === lastPrior.attemptNumber
      && attempt.disposition === 'DEAD_LETTERED'
      && attempt.payloadDigest === lastPrior.payloadDigest;
    if (!retry && !deadLetterClosure) {
      throw new TypeError('retryable failure permits only the next STARTED reservation');
    }
  } else if (lastPrior.disposition === 'FAILED_TERMINAL' || lastPrior.disposition === 'UNKNOWN') {
    if (
      attempt.disposition !== 'DEAD_LETTERED'
      || attempt.attemptNumber !== lastPrior.attemptNumber
      || attempt.payloadDigest !== lastPrior.payloadDigest
    ) throw new TypeError('terminal or ambiguous failure requires a dead-letter closure');
  } else {
    throw new TypeError('attempt cannot advance after a terminal or ambiguous outcome');
  }
  let unresolvedReservationSlots = 0;
  const lineageKeys = new Set(current.attempts.map((entry) => `${entry.generation}\0${entry.operationClass}\0${entry.sourceRecordId}`));
  for (const key of lineageKeys) {
    const [generationText, operationClass, sourceRecordId] = key.split('\0');
    const last = current.attempts.filter((entry) => (
      entry.generation === Number(generationText)
      && entry.operationClass === operationClass
      && entry.sourceRecordId === sourceRecordId
    )).at(-1);
    if (last?.disposition === 'STARTED') unresolvedReservationSlots += 1;
  }
  const resolvesReservation = lastPrior?.disposition === 'STARTED' ? 1 : 0;
  const requiredSlots = current.attempts.length
    + 1
    + unresolvedReservationSlots
    - resolvesReservation
    + (attempt.disposition === 'STARTED' ? 1 : 0);
  if (requiredSlots > maximumAttempts) throw new RangeError('attempt ledger cannot reserve a durable outcome slot');
  return sealSnapshot({ ...current, attempts: [...current.attempts, { ...attempt }] });
}

export function recordEffect(
  current: Readonly<ShadowCaseSnapshot>,
  effect: Readonly<ShadowEffectReceipt>,
  maximumEffects = MAX_EFFECTS,
): Readonly<ShadowCaseSnapshot> {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'case snapshot') as Readonly<ShadowCaseSnapshot>;
  effect = snapshotInertJson(effect, 'effect receipt') as Readonly<ShadowEffectReceipt>;
  validateSnapshot(current);
  assertPositive(maximumEffects, 'maximumEffects');
  if (maximumEffects > MAX_EFFECTS) throw new TypeError('effect bound exceeds absolute maximum');
  assertClosedKeys(effect, ['effectId', 'compensatesEffectId', 'generation', 'state', 'payloadDigest', 'recordedAtMs'], 'effect');
  assertIdentifier(effect.effectId, 'effect.effectId');
  if (effect.compensatesEffectId !== undefined) {
    assertIdentifier(effect.compensatesEffectId, 'effect.compensatesEffectId');
    if (effect.compensatesEffectId === effect.effectId) throw new TypeError('effect cannot compensate itself');
  }
  assertSafeNonNegative(effect.generation, 'effect.generation');
  if (!(['INTENT', 'APPLIED', 'NOT_APPLIED', 'UNKNOWN'] as const).includes(effect.state)) throw new TypeError('effect state unsupported');
  assertUtc(effect.recordedAtMs, 'effect.recordedAtMs');
  assertDigest(effect.payloadDigest, 'effect.payloadDigest');
  const history = current.effects.filter((entry) => entry.effectId === effect.effectId && entry.generation === effect.generation);
  const exact = history.find((entry) => digestValue(entry) === digestValue(effect));
  if (exact) return current;
  if (effect.generation !== current.generation) throw new TypeError('stale generation effect refused');
  if (effect.recordedAtMs < current.updatedAtMs) throw new TypeError('effect time must not precede case head');
  const prior = history.at(-1);
  if (prior === undefined && effect.state === 'INTENT' && NEW_WORK_CLOSED_STATES.includes(current.state)) {
    throw new TypeError('closed case cannot reserve a new global effect');
  }
  if (!prior && effect.state !== 'INTENT') throw new TypeError('effect readback requires a prior intent');
  if (prior && prior.payloadDigest !== effect.payloadDigest) throw new TypeError('effect ID replay has conflicting payload');
  if (prior && prior.compensatesEffectId !== effect.compensatesEffectId) throw new TypeError('effect compensation lineage changed');
  if (prior && effect.recordedAtMs <= prior.recordedAtMs) throw new TypeError('effect readback time must advance');
  if (prior?.state === 'APPLIED' || prior?.state === 'NOT_APPLIED') throw new TypeError('terminal effect readback cannot transition again');
  if (prior && effect.state === 'INTENT') throw new TypeError('effect intent cannot be reissued');
  if (prior?.state === 'UNKNOWN' && effect.state === 'UNKNOWN') throw new TypeError('unknown effect readback cannot be duplicated with a new time');
  let unresolvedReservationSlots = 0;
  const effectKeys = new Set(current.effects.map((entry) => `${entry.generation}\0${entry.effectId}`));
  for (const key of effectKeys) {
    const [generationText, effectId] = key.split('\0');
    const last = current.effects.filter((entry) => entry.generation === Number(generationText) && entry.effectId === effectId).at(-1);
    if (last?.state === 'INTENT') unresolvedReservationSlots += 2;
    else if (last?.state === 'UNKNOWN') unresolvedReservationSlots += 1;
  }
  const requiredSlots = prior === undefined
    ? current.effects.length + unresolvedReservationSlots + 3
    : current.effects.length + unresolvedReservationSlots;
  if (requiredSlots > maximumEffects) throw new RangeError('effect ledger cannot reserve a durable readback slot');
  return sealSnapshot({ ...current, effects: [...current.effects, { ...effect }] });
}

export function attachCaseProof(
  current: Readonly<ShadowCaseSnapshot>,
  proof: Readonly<ShadowCaseProof>,
  verifier: Readonly<ShadowCaseProofVerifierPort>,
  maximumProofs = MAX_PROOFS,
): Readonly<ShadowCaseSnapshot> {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'case snapshot') as Readonly<ShadowCaseSnapshot>;
  validateSnapshot(current);
  proof = snapshotInertJson(proof, 'case proof') as Readonly<ShadowCaseProof>;
  assertPositive(maximumProofs, 'maximumProofs');
  if (maximumProofs > MAX_PROOFS) throw new TypeError('case proof bound exceeds absolute maximum');
  validateCaseProof(proof);
  const existing = current.proofs.find((entry) => entry.proofId === proof.proofId);
  if (existing) {
    if (digestValue(existing) !== digestValue(proof)) throw new TypeError('case proof ID replay has conflicting content');
    return current;
  }
  if (!proofVerifiedByOwnerReadback(proof, verifier)) throw new TypeError('case proof signature or artifact-owner validation failed');
  if (proof.caseId !== current.caseId || proof.generation !== current.generation) throw new TypeError('case proof belongs to a different case or stale generation');
  if (proof.recordedAtMs < current.updatedAtMs) throw new TypeError('case proof time must not precede case head');
  if (current.proofs.length >= maximumProofs) throw new RangeError('case proof ledger is full');
  return sealSnapshot({ ...current, proofs: [...current.proofs, { ...proof, signature: { ...proof.signature } }] });
}

export function attachBudgetReceipt(
  current: Readonly<ShadowCaseSnapshot>,
  receiptId: string,
  maximumReceipts = MAX_BUDGET_RECEIPTS,
): Readonly<ShadowCaseSnapshot> {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'case snapshot') as Readonly<ShadowCaseSnapshot>;
  validateSnapshot(current);
  assertIdentifier(receiptId, 'receiptId');
  assertPositive(maximumReceipts, 'maximumReceipts');
  if (maximumReceipts > MAX_BUDGET_RECEIPTS) throw new TypeError('budget receipt bound exceeds absolute maximum');
  const generationReceiptId = generationBudgetReceiptId(current.generation, receiptId);
  if (current.budgetReceiptIds.includes(generationReceiptId)) return current;
  if (current.budgetReceiptIds.length >= maximumReceipts) throw new RangeError('budget receipt list is full');
  return sealSnapshot({ ...current, budgetReceiptIds: [...current.budgetReceiptIds, generationReceiptId].sort() });
}

export function compactCaseSnapshot(
  current: Readonly<ShadowCaseSnapshot>,
  retainEventCount: number,
  retainCompactedCommandReceiptCount = MAX_COMPACTED_COMMAND_RECEIPTS,
): Readonly<ShadowCaseSnapshot> {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'case snapshot') as Readonly<ShadowCaseSnapshot>;
  validateSnapshot(current);
  assertPositive(retainEventCount, 'retainEventCount');
  assertSafeNonNegative(retainCompactedCommandReceiptCount, 'retainCompactedCommandReceiptCount');
  if (retainEventCount > MAX_EVENTS) throw new TypeError('retained event count exceeds absolute maximum');
  if (retainCompactedCommandReceiptCount > MAX_COMPACTED_COMMAND_RECEIPTS) throw new TypeError('retained compacted command receipt count exceeds absolute maximum');
  if (current.events.length <= retainEventCount) return current;
  const dropCount = current.events.length - retainEventCount;
  const dropped = current.events.slice(0, dropCount);
  const retained = current.events.slice(dropCount);
  const compacted = dropped.at(-1);
  if (!compacted || retained[0]?.previousChainDigest !== compacted.chainDigest) {
    throw new TypeError('case event chain is not contiguous at compaction boundary');
  }
  return sealSnapshot({
    ...current,
    events: retained,
    compactedThroughRevision: compacted.revision,
    compactedChainDigest: compacted.chainDigest,
    // Exact command receipts are never forgotten: bounded backpressure is
    // preferable to permitting a compacted command to advance state twice.
    commandReceipts: [...current.commandReceipts],
  });
}

function validateSnapshot(snapshot: Readonly<ShadowCaseSnapshot>): void {
  assertClosedKeys(snapshot, [
    'schema', 'shadowStatus', 'caseId', 'generation', 'revision', 'state', 'firstSeenAtMs', 'updatedAtMs',
    'events', 'compactedThroughRevision', 'compactedChainDigest', 'commandReceipts', 'attempts', 'effects', 'proofs',
    'budgetReceiptIds', 'evidencePointerIds', 'currentGenerationEvidencePointerIds',
    'currentGenerationEvidenceBundleBinding', 'currentGenerationDiagnosticBinding', 'diagnosticRoundCount',
    'diagnosticRoundBudgetProofIds',
    'actionReadbackBinding', 'backpressure', 'snapshotDigest',
  ], 'case snapshot');
  if (snapshot.schema !== 'AI_OPS_A2_CASE_SNAPSHOT_V1' || snapshot.shadowStatus !== SHADOW_A2_STATUS) throw new TypeError('case snapshot schema or status invalid');
  assertIdentifier(snapshot.caseId, 'snapshot.caseId');
  assertSafeNonNegative(snapshot.generation, 'snapshot.generation');
  assertSafeNonNegative(snapshot.revision, 'snapshot.revision');
  if (!isCaseState(snapshot.state)) throw new TypeError('snapshot state invalid');
  assertUtc(snapshot.firstSeenAtMs, 'snapshot.firstSeenAtMs');
  assertUtc(snapshot.updatedAtMs, 'snapshot.updatedAtMs');
  if (snapshot.updatedAtMs < snapshot.firstSeenAtMs) throw new TypeError('snapshot time lineage invalid');
  assertDigest(snapshot.snapshotDigest, 'snapshot.snapshotDigest');
  const { snapshotDigest: _digest, ...unsealed } = snapshot;
  if (digestValue(unsealed) !== snapshot.snapshotDigest) throw new TypeError('snapshot digest mismatch');
  if (!Array.isArray(snapshot.events) || snapshot.events.length === 0 || snapshot.events.length > MAX_EVENTS) throw new TypeError('snapshot event history bound invalid');
  if (!Number.isSafeInteger(snapshot.compactedThroughRevision) || snapshot.compactedThroughRevision < -1) throw new TypeError('snapshot compaction revision invalid');
  if (snapshot.compactedChainDigest !== null) assertDigest(snapshot.compactedChainDigest, 'snapshot.compactedChainDigest');
  if ((snapshot.compactedThroughRevision === -1) !== (snapshot.compactedChainDigest === null)) {
    throw new TypeError('snapshot compaction revision and chain anchor nullability mismatch');
  }
  let previousDigest = snapshot.compactedChainDigest;
  let previousState: ShadowCaseState | null = null;
  let previousGeneration: number | null = null;
  let previousTime = snapshot.firstSeenAtMs;
  let expectedRevision = snapshot.compactedThroughRevision + 1;
  for (const event of snapshot.events) {
    assertClosedKeys(event, [
      'schema', 'shadowStatus', 'eventId', 'commandId', 'commandDigest', 'caseId', 'generation', 'revision',
      'fromState', 'toState', 'occurredAtMs', 'reasonCodes', 'evidencePointerIds', 'previousChainDigest', 'chainDigest',
    ], 'case event');
    if (event.schema !== 'AI_OPS_A2_CASE_EVENT_V1' || event.shadowStatus !== SHADOW_A2_STATUS) throw new TypeError('case event schema or status invalid');
    assertIdentifier(event.eventId, 'event.eventId');
    assertIdentifier(event.commandId, 'event.commandId');
    assertDigest(event.commandDigest, 'event.commandDigest');
    assertDigest(event.chainDigest, 'event.chainDigest');
    if (event.previousChainDigest !== null) assertDigest(event.previousChainDigest, 'event.previousChainDigest');
    if (event.caseId !== snapshot.caseId || event.revision !== expectedRevision || event.previousChainDigest !== previousDigest) {
      throw new TypeError('snapshot event chain lineage invalid');
    }
    assertSafeNonNegative(event.generation, 'event.generation');
    assertUtc(event.occurredAtMs, 'event.occurredAtMs');
    if (event.occurredAtMs < previousTime || !isCaseState(event.toState) || (event.fromState !== null && !isCaseState(event.fromState))) {
      throw new TypeError('case event temporal or state value invalid');
    }
    const recomputedCommand = commandDigest(event.caseId, event.generation, {
      commandId: event.commandId,
      toState: event.toState,
      occurredAtMs: event.occurredAtMs,
      reasonCodes: event.reasonCodes,
      evidencePointerIds: event.evidencePointerIds,
    });
    if (recomputedCommand !== event.commandDigest) throw new TypeError('case event command digest invalid');
    const expectedEventId = shadowSpeculativeId('a2-case-event', {
      caseId: event.caseId,
      generation: event.generation,
      revision: event.revision,
      commandDigest: event.commandDigest,
    });
    if (event.eventId !== expectedEventId) throw new TypeError('case event ID invalid');
    const { eventId: _eventId, chainDigest: _chainDigest, ...core } = event;
    if (eventChainDigest(previousDigest, core) !== event.chainDigest) throw new TypeError('snapshot event chain digest invalid');
    if (previousState !== null && event.fromState !== previousState) throw new TypeError('case event from-state lineage invalid');
    if (previousGeneration !== null) {
      if (event.generation === previousGeneration && event.fromState !== event.toState && !TRANSITIONS[event.fromState as ShadowCaseState].includes(event.toState)) {
        throw new TypeError('case event transition invalid');
      }
      if (event.generation !== previousGeneration) {
        if (event.generation !== previousGeneration + 1 || event.toState !== 'CASE_OPENED' || !event.reasonCodes.includes('NEW_GENERATION_FROM_TERMINAL_CASE')) {
          throw new TypeError('case generation transition invalid');
        }
      }
    }
    previousDigest = event.chainDigest;
    previousState = event.toState;
    previousGeneration = event.generation;
    previousTime = event.occurredAtMs;
    expectedRevision += 1;
  }
  const last = snapshot.events.at(-1);
  if (!last || last.revision !== snapshot.revision || last.toState !== snapshot.state || last.generation !== snapshot.generation || last.occurredAtMs !== snapshot.updatedAtMs) {
    throw new TypeError('snapshot head does not match event history');
  }
  if (!Array.isArray(snapshot.commandReceipts) || snapshot.commandReceipts.length > MAX_COMMAND_RECEIPTS) throw new TypeError('command receipt bound invalid');
  if (new Set(snapshot.commandReceipts.map((entry) => entry.commandId)).size !== snapshot.commandReceipts.length) throw new TypeError('command receipt IDs must be unique');
  for (const receipt of snapshot.commandReceipts) {
    assertClosedKeys(receipt, [
      'commandId', 'commandDigest', 'revision', 'generation', 'commandKind', 'toState', 'occurredAtMs',
    ], 'command receipt');
    assertIdentifier(receipt.commandId, 'commandReceipt.commandId');
    assertDigest(receipt.commandDigest, 'commandReceipt.commandDigest');
    assertSafeNonNegative(receipt.revision, 'commandReceipt.revision');
    assertSafeNonNegative(receipt.generation, 'commandReceipt.generation');
    if (!(['TRANSITION', 'BACKPRESSURE', 'NEW_GENERATION'] as const).includes(receipt.commandKind)) throw new TypeError('command receipt kind invalid');
    if (!isCaseState(receipt.toState)) throw new TypeError('command receipt state invalid');
    assertUtc(receipt.occurredAtMs, 'commandReceipt.occurredAtMs');
    if (receipt.revision > snapshot.revision || receipt.generation > snapshot.generation || receipt.occurredAtMs > snapshot.updatedAtMs) {
      throw new TypeError('command receipt lineage exceeds case head');
    }
  }
  for (const event of snapshot.events) {
    const receipt = snapshot.commandReceipts.find((entry) => entry.commandId === event.commandId);
    const expectedKind = event.reasonCodes.includes('NEW_GENERATION_FROM_TERMINAL_CASE')
      ? 'NEW_GENERATION'
      : event.fromState === event.toState && event.reasonCodes.some((reason: string) => reason.startsWith('BACKPRESSURE_'))
        ? 'BACKPRESSURE'
        : 'TRANSITION';
    if (
      !receipt
      || receipt.commandDigest !== event.commandDigest
      || receipt.revision !== event.revision
      || receipt.generation !== event.generation
      || receipt.toState !== event.toState
      || receipt.occurredAtMs !== event.occurredAtMs
      || receipt.commandKind !== expectedKind
    ) throw new TypeError('retained event command receipt mismatch');
  }
  for (const receipt of snapshot.commandReceipts) {
    if (
      receipt.revision > snapshot.compactedThroughRevision
      && !snapshot.events.some((event) => event.commandId === receipt.commandId && event.revision === receipt.revision)
    ) throw new TypeError('uncompacted command receipt has no event');
  }
  if (!Array.isArray(snapshot.attempts) || snapshot.attempts.length > MAX_ATTEMPTS) throw new TypeError('attempt ledger bound invalid');
  if (new Set(snapshot.attempts.map((entry) => entry.attemptId)).size !== snapshot.attempts.length) throw new TypeError('attempt IDs must be unique');
  for (const attempt of snapshot.attempts) {
    assertClosedKeys(attempt, [
      'attemptId', 'sourceRecordId', 'attemptBaseline', 'operationClass', 'generation', 'attemptNumber', 'disposition', 'recordedAtMs', 'payloadDigest',
    ], 'attempt');
    assertIdentifier(attempt.attemptId, 'attempt.attemptId');
    assertIdentifier(attempt.sourceRecordId, 'attempt.sourceRecordId');
    assertSafeNonNegative(attempt.attemptBaseline, 'attempt.attemptBaseline');
    assertDigest(attempt.payloadDigest, 'attempt.payloadDigest');
    assertSafeNonNegative(attempt.generation, 'attempt.generation');
    assertPositive(attempt.attemptNumber, 'attempt.attemptNumber');
    assertUtc(attempt.recordedAtMs, 'attempt.recordedAtMs');
    if (!(['DETERMINISTIC', 'PROVIDER', 'EVIDENCE_READ', 'HANDOFF', 'GLOBAL_EFFECT'] as const).includes(attempt.operationClass)) throw new TypeError('attempt operation class invalid');
    if (!(['STARTED', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN', 'DEAD_LETTERED'] as const).includes(attempt.disposition)) throw new TypeError('attempt disposition invalid');
    if (attempt.generation > snapshot.generation) throw new TypeError('attempt generation exceeds case head');
  }
  let unresolvedAttemptReservations = 0;
  let unsettledCurrentGenerationAttempt = false;
  for (const key of new Set(snapshot.attempts.map((attempt) => `${attempt.generation}\0${attempt.operationClass}\0${attempt.sourceRecordId}`))) {
    const [generationText, operationClass, sourceRecordId] = key.split('\0');
    const history = snapshot.attempts
      .filter((attempt) => (
        attempt.generation === Number(generationText)
        && attempt.operationClass === operationClass
        && attempt.sourceRecordId === sourceRecordId
      ));
    if (history.some((attempt, index) => index > 0 && attempt.recordedAtMs < history[index - 1].recordedAtMs)) {
      throw new TypeError('attempt time lineage invalid');
    }
    const baseline = history[0]?.attemptBaseline ?? 0;
    if (history.some((attempt) => attempt.attemptBaseline !== baseline)) throw new TypeError('attempt baseline lineage invalid');
    let expectedNumber = baseline + 1;
    let phase: 'EXPECT_START' | 'EXPECT_OUTCOME' | 'RETRY_OR_CLOSE' | 'CLOSE_ONLY' | 'TERMINAL' = 'EXPECT_START';
    let reservedPayload: string | null = null;
    for (const attempt of history) {
      if (phase === 'EXPECT_START') {
        if (attempt.disposition !== 'STARTED' || attempt.attemptNumber !== expectedNumber) {
          throw new TypeError('attempt lineage is missing a contiguous STARTED reservation');
        }
        phase = 'EXPECT_OUTCOME';
        reservedPayload = attempt.payloadDigest;
      } else if (phase === 'EXPECT_OUTCOME') {
        if (
          attempt.disposition === 'STARTED'
          || attempt.disposition === 'DEAD_LETTERED'
          || attempt.attemptNumber !== expectedNumber
          || attempt.payloadDigest !== reservedPayload
        ) {
          throw new TypeError('attempt outcome does not resolve its reservation');
        }
        if (attempt.disposition === 'FAILED_RETRYABLE') {
          expectedNumber += 1;
          phase = 'RETRY_OR_CLOSE';
        } else if (attempt.disposition === 'FAILED_TERMINAL' || attempt.disposition === 'UNKNOWN') {
          phase = 'CLOSE_ONLY';
        } else {
          phase = 'TERMINAL';
        }
      } else if (phase === 'RETRY_OR_CLOSE') {
        if (
          attempt.disposition === 'DEAD_LETTERED'
          && attempt.attemptNumber === expectedNumber - 1
          && attempt.payloadDigest === reservedPayload
        ) {
          phase = 'TERMINAL';
        } else if (attempt.disposition === 'STARTED' && attempt.attemptNumber === expectedNumber) {
          phase = 'EXPECT_OUTCOME';
          reservedPayload = attempt.payloadDigest;
        } else {
          throw new TypeError('retryable attempt lineage is missing retry or dead-letter closure');
        }
      } else if (phase === 'CLOSE_ONLY') {
        if (
          attempt.disposition !== 'DEAD_LETTERED'
          || attempt.attemptNumber !== expectedNumber
          || attempt.payloadDigest !== reservedPayload
        ) throw new TypeError('failed attempt lineage is missing its dead-letter closure');
        phase = 'TERMINAL';
      } else {
        throw new TypeError('attempt lineage continues after terminal closure');
      }
    }
    if (phase === 'EXPECT_OUTCOME') unresolvedAttemptReservations += 1;
    if (Number(generationText) === snapshot.generation && phase !== 'TERMINAL') unsettledCurrentGenerationAttempt = true;
    if (
      Number(generationText) < snapshot.generation
      && phase !== 'TERMINAL'
    ) throw new TypeError('prior generation contains an unresolved attempt obligation');
  }
  if (snapshot.attempts.length + unresolvedAttemptReservations > MAX_ATTEMPTS) {
    throw new TypeError('attempt ledger has stranded outcome reservations');
  }
  if (!Array.isArray(snapshot.effects) || snapshot.effects.length > MAX_EFFECTS) throw new TypeError('effect ledger bound invalid');
  for (const effect of snapshot.effects) {
    assertClosedKeys(effect, ['effectId', 'compensatesEffectId', 'generation', 'state', 'payloadDigest', 'recordedAtMs'], 'effect');
    assertIdentifier(effect.effectId, 'effect.effectId');
    if (effect.compensatesEffectId !== undefined) {
      assertIdentifier(effect.compensatesEffectId, 'effect.compensatesEffectId');
      if (effect.compensatesEffectId === effect.effectId) throw new TypeError('effect cannot compensate itself');
    }
    assertDigest(effect.payloadDigest, 'effect.payloadDigest');
    assertSafeNonNegative(effect.generation, 'effect.generation');
    assertUtc(effect.recordedAtMs, 'effect.recordedAtMs');
    if (!(['INTENT', 'APPLIED', 'NOT_APPLIED', 'UNKNOWN'] as const).includes(effect.state) || effect.generation > snapshot.generation) throw new TypeError('effect state or generation invalid');
  }
  let unresolvedEffectReservationSlots = 0;
  let unsettledCurrentGenerationEffect = false;
  for (const lineageKey of new Set(snapshot.effects.map((entry) => `${entry.generation}\0${entry.effectId}`))) {
    const [generationText, effectId] = lineageKey.split('\0');
    const history = snapshot.effects.filter((entry) => entry.effectId === effectId && entry.generation === Number(generationText));
    if (history[0]?.state !== 'INTENT') throw new TypeError('effect history must begin with intent');
    for (let index = 1; index < history.length; index += 1) {
      if (
        history[index].payloadDigest !== history[0].payloadDigest
        || history[index].compensatesEffectId !== history[0].compensatesEffectId
        || history[index].recordedAtMs <= history[index - 1].recordedAtMs
        || history[index].state === 'INTENT'
      ) {
        throw new TypeError('effect history lineage invalid');
      }
      if (['APPLIED', 'NOT_APPLIED'].includes(history[index - 1].state)) throw new TypeError('effect history continues after terminal readback');
    }
    if (history.at(-1)?.state === 'INTENT') unresolvedEffectReservationSlots += 2;
    else if (history.at(-1)?.state === 'UNKNOWN') unresolvedEffectReservationSlots += 1;
    if (
      Number(generationText) === snapshot.generation
      && history.at(-1)?.state !== 'APPLIED'
      && history.at(-1)?.state !== 'NOT_APPLIED'
    ) unsettledCurrentGenerationEffect = true;
    if (
      Number(generationText) < snapshot.generation
      && history.at(-1)?.state !== 'APPLIED'
      && history.at(-1)?.state !== 'NOT_APPLIED'
    ) throw new TypeError('prior generation contains an unresolved effect obligation');
  }
  if (snapshot.effects.length + unresolvedEffectReservationSlots > MAX_EFFECTS) {
    throw new TypeError('effect ledger has stranded readback reservations');
  }
  if (
    ['RESOLVED', 'ROLLED_BACK', 'POSTMORTEM_AND_LEARNING_RECORDED'].includes(snapshot.state)
    && (unsettledCurrentGenerationAttempt || unsettledCurrentGenerationEffect)
  ) throw new TypeError('terminal case contains unresolved durable work');
  if (!Array.isArray(snapshot.proofs) || snapshot.proofs.length > MAX_PROOFS) throw new TypeError('case proof ledger bound invalid');
  if (new Set(snapshot.proofs.map((proof) => proof.proofId)).size !== snapshot.proofs.length) throw new TypeError('case proof IDs must be unique');
  for (const proof of snapshot.proofs) {
    validateCaseProof(proof);
    if (proof.caseId !== snapshot.caseId || proof.generation > snapshot.generation) {
      throw new TypeError('case proof lineage invalid');
    }
  }
  if (!Array.isArray(snapshot.budgetReceiptIds) || snapshot.budgetReceiptIds.length > MAX_BUDGET_RECEIPTS) throw new TypeError('budget receipt bound invalid');
  if (!Array.isArray(snapshot.evidencePointerIds) || snapshot.evidencePointerIds.length > MAX_EVIDENCE_POINTERS) throw new TypeError('evidence pointer bound invalid');
  if (!Array.isArray(snapshot.currentGenerationEvidencePointerIds) || snapshot.currentGenerationEvidencePointerIds.length > MAX_EVIDENCE_POINTERS) {
    throw new TypeError('current-generation evidence pointer bound invalid');
  }
  for (const id of [...snapshot.budgetReceiptIds, ...snapshot.evidencePointerIds, ...snapshot.currentGenerationEvidencePointerIds]) assertIdentifier(id, 'snapshot reference ID');
  if (
    new Set(snapshot.budgetReceiptIds).size !== snapshot.budgetReceiptIds.length
    || new Set(snapshot.evidencePointerIds).size !== snapshot.evidencePointerIds.length
    || new Set(snapshot.currentGenerationEvidencePointerIds).size !== snapshot.currentGenerationEvidencePointerIds.length
  ) {
    throw new TypeError('snapshot reference IDs must be unique');
  }
  if (snapshot.currentGenerationEvidencePointerIds.some((id) => !snapshot.evidencePointerIds.includes(id))) {
    throw new TypeError('current-generation evidence pointer is missing from durable history');
  }
  assertSafeNonNegative(snapshot.diagnosticRoundCount, 'snapshot.diagnosticRoundCount');
  if (snapshot.diagnosticRoundCount > MAX_DIAGNOSTIC_ROUNDS) throw new TypeError('diagnostic round count exceeds the absolute shadow bound');
  if (
    !Array.isArray(snapshot.diagnosticRoundBudgetProofIds)
    || snapshot.diagnosticRoundBudgetProofIds.length !== snapshot.diagnosticRoundCount
    || snapshot.diagnosticRoundBudgetProofIds.length > MAX_DIAGNOSTIC_ROUNDS
  ) throw new TypeError('diagnostic round budget-proof lineage invalid');
  for (const proofId of snapshot.diagnosticRoundBudgetProofIds) assertIdentifier(proofId, 'diagnosticRoundBudgetProofIds[]');
  if (new Set(snapshot.diagnosticRoundBudgetProofIds).size !== snapshot.diagnosticRoundBudgetProofIds.length) {
    throw new TypeError('diagnostic round budget proofs must be unique');
  }
  if (snapshot.diagnosticRoundBudgetProofIds.some((proofId) => !snapshot.proofs.some((proof) => proof.proofId === proofId && proof.proofKind === 'BUDGET_ADMISSION'))) {
    throw new TypeError('diagnostic round budget proof is missing from the proof ledger');
  }
  if (snapshot.currentGenerationEvidenceBundleBinding !== null) {
    const binding = snapshot.currentGenerationEvidenceBundleBinding;
    assertClosedKeys(binding, [
      'generation', 'bundleDigest', 'pointerSetDigest', 'bindingDigest', 'eventRevision', 'occurredAtMs',
    ], 'evidence bundle binding');
    assertSafeNonNegative(binding.generation, 'evidenceBundleBinding.generation');
    assertDigest(binding.bundleDigest, 'evidenceBundleBinding.bundleDigest');
    assertDigest(binding.pointerSetDigest, 'evidenceBundleBinding.pointerSetDigest');
    assertDigest(binding.bindingDigest, 'evidenceBundleBinding.bindingDigest');
    assertSafeNonNegative(binding.eventRevision, 'evidenceBundleBinding.eventRevision');
    assertUtc(binding.occurredAtMs, 'evidenceBundleBinding.occurredAtMs');
    if (
      binding.generation !== snapshot.generation
      || binding.eventRevision > snapshot.revision
      || binding.pointerSetDigest !== digestValue(snapshot.currentGenerationEvidencePointerIds)
      || binding.bindingDigest !== digestValue({
        evidenceBundleDigest: binding.bundleDigest,
        evidencePointerIds: snapshot.currentGenerationEvidencePointerIds,
      })
    ) {
      throw new TypeError('evidence bundle binding exceeds the current case lineage');
    }
    const bindingEvent = snapshot.events.find((event) => event.revision === binding.eventRevision);
    if (bindingEvent && (
      bindingEvent.generation !== binding.generation
      || bindingEvent.toState !== 'EVIDENCE_FROZEN'
      || bindingEvent.fromState === bindingEvent.toState
      || bindingEvent.occurredAtMs !== binding.occurredAtMs
      || boundReasonDigest(bindingEvent.reasonCodes, 'EVIDENCE_BUNDLE_BOUND') !== binding.bundleDigest
      || boundReasonDigest(bindingEvent.reasonCodes, 'EVIDENCE_POINTER_SET_BOUND') !== binding.pointerSetDigest
    )) throw new TypeError('evidence bundle binding does not match its retained event');
  }
  if (snapshot.currentGenerationDiagnosticBinding !== null) {
    const binding = snapshot.currentGenerationDiagnosticBinding;
    assertClosedKeys(binding, [
      'generation', 'diagnosticDigest', 'evidenceBundleDigest', 'bindingDigest', 'eventRevision', 'occurredAtMs',
    ], 'diagnostic result binding');
    assertSafeNonNegative(binding.generation, 'diagnosticBinding.generation');
    assertDigest(binding.diagnosticDigest, 'diagnosticBinding.diagnosticDigest');
    assertDigest(binding.evidenceBundleDigest, 'diagnosticBinding.evidenceBundleDigest');
    assertDigest(binding.bindingDigest, 'diagnosticBinding.bindingDigest');
    assertSafeNonNegative(binding.eventRevision, 'diagnosticBinding.eventRevision');
    assertUtc(binding.occurredAtMs, 'diagnosticBinding.occurredAtMs');
    if (
      binding.generation !== snapshot.generation
      || binding.eventRevision > snapshot.revision
      || snapshot.currentGenerationEvidenceBundleBinding === null
      || binding.evidenceBundleDigest !== snapshot.currentGenerationEvidenceBundleBinding.bundleDigest
      || binding.bindingDigest !== digestValue({
        diagnosticResultDigest: binding.diagnosticDigest,
        evidenceBundleDigest: binding.evidenceBundleDigest,
      })
      || binding.occurredAtMs < snapshot.currentGenerationEvidenceBundleBinding.occurredAtMs
    ) throw new TypeError('diagnostic result binding exceeds its evidence or case lineage');
    const bindingEvent = snapshot.events.find((event) => event.revision === binding.eventRevision);
    if (bindingEvent && (
      bindingEvent.generation !== binding.generation
      || bindingEvent.toState !== 'DIAGNOSIS_READY'
      || bindingEvent.fromState === bindingEvent.toState
      || bindingEvent.occurredAtMs !== binding.occurredAtMs
      || boundReasonDigest(bindingEvent.reasonCodes, 'DIAGNOSTIC_RESULT_BOUND') !== binding.diagnosticDigest
      || boundReasonDigest(bindingEvent.reasonCodes, 'EVIDENCE_BUNDLE_BOUND') !== binding.evidenceBundleDigest
      || boundReasonDigest(bindingEvent.reasonCodes, 'DIAGNOSTIC_EVIDENCE_BINDING_BOUND') !== binding.bindingDigest
    )) throw new TypeError('diagnostic result binding does not match its retained event');
  }
  if (snapshot.actionReadbackBinding !== null) {
    assertClosedKeys(snapshot.actionReadbackBinding, ['generation', 'effectDigest', 'effectIdDigest', 'eventRevision', 'occurredAtMs'], 'action readback binding');
    assertSafeNonNegative(snapshot.actionReadbackBinding.generation, 'actionReadbackBinding.generation');
    assertDigest(snapshot.actionReadbackBinding.effectDigest, 'actionReadbackBinding.effectDigest');
    assertDigest(snapshot.actionReadbackBinding.effectIdDigest, 'actionReadbackBinding.effectIdDigest');
    assertSafeNonNegative(snapshot.actionReadbackBinding.eventRevision, 'actionReadbackBinding.eventRevision');
    assertUtc(snapshot.actionReadbackBinding.occurredAtMs, 'actionReadbackBinding.occurredAtMs');
    if (
      snapshot.actionReadbackBinding.generation !== snapshot.generation
      || snapshot.actionReadbackBinding.eventRevision > snapshot.revision
    ) throw new TypeError('action readback binding exceeds the current case lineage');
    const bindingEvent = snapshot.events.find((event) => event.revision === snapshot.actionReadbackBinding?.eventRevision);
    if (bindingEvent && (
      bindingEvent.generation !== snapshot.actionReadbackBinding.generation
      || bindingEvent.toState !== 'ACTION_READBACK'
      || bindingEvent.fromState === bindingEvent.toState
      || bindingEvent.occurredAtMs !== snapshot.actionReadbackBinding.occurredAtMs
      || boundReasonDigest(bindingEvent.reasonCodes, 'GLOBAL_EFFECT_READBACK_BOUND') !== snapshot.actionReadbackBinding.effectDigest
      || boundReasonDigest(bindingEvent.reasonCodes, 'GLOBAL_EFFECT_ID_BOUND') !== snapshot.actionReadbackBinding.effectIdDigest
    )) throw new TypeError('action readback binding does not match its retained event');
  }
  if (typeof snapshot.backpressure !== 'object' || snapshot.backpressure === null) throw new TypeError('backpressure projection invalid');
  assertClosedKeys(snapshot.backpressure, ['active', 'resumeCursor', 'refusedCount'], 'backpressure');
  if (typeof snapshot.backpressure.active !== 'boolean' || !Number.isSafeInteger(snapshot.backpressure.refusedCount) || snapshot.backpressure.refusedCount < 0) {
    throw new TypeError('backpressure state invalid');
  }
  if (snapshot.backpressure.active) assertIdentifier(snapshot.backpressure.resumeCursor, 'backpressure.resumeCursor');
  if (!snapshot.backpressure.active && snapshot.backpressure.resumeCursor !== null) throw new TypeError('inactive backpressure cannot retain a cursor');
}

export function serializeCaseSnapshot(snapshot: Readonly<ShadowCaseSnapshot>, maximumBytes = 512 * 1024): string {
  snapshot = snapshotInertJsonPreservingDeepFreeze(snapshot, 'case snapshot') as Readonly<ShadowCaseSnapshot>;
  assertPositive(maximumBytes, 'maximumBytes');
  validateSnapshot(snapshot);
  const serialized = canonicalJson(snapshot);
  if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) throw new RangeError('case snapshot exceeds its byte bound');
  return serialized;
}

export function resumeCaseSnapshot(serialized: string, maximumBytes = 512 * 1024): Readonly<ShadowCaseSnapshot> {
  assertPositive(maximumBytes, 'maximumBytes');
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > maximumBytes) throw new TypeError('serialized case snapshot is missing or oversized');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError('serialized case snapshot is invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TypeError('case snapshot must be an object');
  validateSnapshot(parsed as ShadowCaseSnapshot);
  return deepFreeze(parsed as ShadowCaseSnapshot) as Readonly<ShadowCaseSnapshot>;
}

/**
 * Persistence-side guard replay. Canonical binding may store only a genuine
 * initial snapshot, then one runtime transition event per CAS replacement.
 */
export function assertInitialCaseSnapshotForPersistence(
  snapshot: Readonly<ShadowCaseSnapshot>,
  proofVerifier: Readonly<ShadowCaseProofVerifierPort>,
): void {
  snapshot = snapshotInertJson(snapshot, 'initial case snapshot') as Readonly<ShadowCaseSnapshot>;
  validateSnapshot(snapshot);
  if (proofVerifier.posture !== 'SYNTHETIC_ONLY') throw new TypeError('case proof verifier must remain synthetic-only');
  if (
    snapshot.generation !== 0
    || snapshot.revision !== 0
    || snapshot.state !== 'DETECTED'
    || snapshot.compactedThroughRevision !== -1
    || snapshot.events.length !== 1
    || snapshot.commandReceipts.length !== 1
    || snapshot.currentGenerationEvidenceBundleBinding !== null
    || snapshot.currentGenerationDiagnosticBinding !== null
    || snapshot.diagnosticRoundCount !== 0
    || snapshot.diagnosticRoundBudgetProofIds.length !== 0
    || snapshot.actionReadbackBinding !== null
    || snapshot.backpressure.active
    || snapshot.backpressure.resumeCursor !== null
    || snapshot.backpressure.refusedCount !== 0
  ) throw new TypeError('canonical persistence requires a genuine initial case snapshot');
  const genesisEvent = snapshot.events[0];
  const recreated = createCaseSnapshot(
    snapshot.caseId,
    genesisEvent.commandId,
    snapshot.firstSeenAtMs,
    genesisEvent.reasonCodes,
    genesisEvent.evidencePointerIds,
  );
  if (
    genesisEvent.fromState !== null
    || genesisEvent.chainDigest !== recreated.events[0].chainDigest
    || digestValue(snapshot.evidencePointerIds) !== digestValue(recreated.evidencePointerIds)
    || digestValue(snapshot.currentGenerationEvidencePointerIds) !== digestValue(recreated.currentGenerationEvidencePointerIds)
  ) throw new TypeError('canonical persistence initial case lineage is not genuine');
  if (
    snapshot.attempts.some((attempt) => attempt.recordedAtMs < snapshot.updatedAtMs)
    || snapshot.effects.some((effect) => effect.recordedAtMs < snapshot.updatedAtMs)
    || snapshot.proofs.some((proof) => proof.recordedAtMs < snapshot.updatedAtMs)
  ) throw new TypeError('initial case auxiliary receipt predates the case head');
  for (const proof of snapshot.proofs) {
    if (!proofVerifiedByOwnerReadback(proof, proofVerifier)) throw new TypeError('initial case snapshot contains an unverified proof');
  }
}

/** Revalidates every persisted artifact proof against its canonical owner before resume. */
export function assertCaseSnapshotProofsForPersistence(
  snapshot: Readonly<ShadowCaseSnapshot>,
  proofVerifier: Readonly<ShadowCaseProofVerifierPort>,
): void {
  snapshot = snapshotInertJson(snapshot, 'persisted case snapshot') as Readonly<ShadowCaseSnapshot>;
  validateSnapshot(snapshot);
  if (proofVerifier.posture !== 'SYNTHETIC_ONLY') throw new TypeError('case proof verifier must remain synthetic-only');
  for (const proof of snapshot.proofs) {
    if (!proofVerifiedByOwnerReadback(proof, proofVerifier)) throw new TypeError('persisted case snapshot contains an unverified proof');
  }
}

export function assertCaseSnapshotSuccessorForPersistence(
  previous: Readonly<ShadowCaseSnapshot>,
  next: Readonly<ShadowCaseSnapshot>,
  proofVerifier: Readonly<ShadowCaseProofVerifierPort>,
): void {
  previous = snapshotInertJson(previous, 'previous case snapshot') as Readonly<ShadowCaseSnapshot>;
  next = snapshotInertJson(next, 'next case snapshot') as Readonly<ShadowCaseSnapshot>;
  validateSnapshot(previous);
  validateSnapshot(next);
  if (proofVerifier.posture !== 'SYNTHETIC_ONLY') throw new TypeError('case proof verifier must remain synthetic-only');
  for (const proof of next.proofs) {
    if (!proofVerifiedByOwnerReadback(proof, proofVerifier)) throw new TypeError('case snapshot contains an unverified proof');
  }
  if (
    next.attempts.slice(previous.attempts.length).some((attempt) => attempt.recordedAtMs < previous.updatedAtMs)
    || next.effects.slice(previous.effects.length).some((effect) => effect.recordedAtMs < previous.updatedAtMs)
    || next.proofs.slice(previous.proofs.length).some((proof) => proof.recordedAtMs < previous.updatedAtMs)
  ) throw new TypeError('appended auxiliary receipt predates the case head');
  if (
    next.attempts.slice(previous.attempts.length).some((attempt) => attempt.generation !== previous.generation)
    || next.effects.slice(previous.effects.length).some((effect) => effect.generation !== previous.generation)
    || next.proofs.slice(previous.proofs.length).some((proof) => proof.generation !== previous.generation)
  ) throw new TypeError('appended auxiliary receipt belongs to a stale or future generation');
  if (next.revision === previous.revision) {
    if (
      digestValue(next.commandReceipts) !== digestValue(previous.commandReceipts)
      ||
      digestValue(next.evidencePointerIds) !== digestValue(previous.evidencePointerIds)
      || digestValue(next.currentGenerationEvidencePointerIds) !== digestValue(previous.currentGenerationEvidencePointerIds)
      || digestValue(next.currentGenerationEvidenceBundleBinding) !== digestValue(previous.currentGenerationEvidenceBundleBinding)
      || digestValue(next.currentGenerationDiagnosticBinding) !== digestValue(previous.currentGenerationDiagnosticBinding)
      || next.diagnosticRoundCount !== previous.diagnosticRoundCount
      || digestValue(next.diagnosticRoundBudgetProofIds) !== digestValue(previous.diagnosticRoundBudgetProofIds)
      || digestValue(next.actionReadbackBinding) !== digestValue(previous.actionReadbackBinding)
    ) throw new TypeError('same-revision case replacement changed event-owned evidence or action bindings');
    return;
  }
  if (next.revision !== previous.revision + 1) throw new TypeError('canonical persistence requires exactly one case event per replacement');
  const event = next.events.find((candidate) => candidate.revision === next.revision);
  const receipt = event === undefined
    ? undefined
    : next.commandReceipts.find((candidate) => candidate.commandId === event.commandId);
  if (!event || !receipt || receipt.revision !== event.revision) throw new TypeError('case successor event receipt is missing');
  const generationRollover = receipt.commandKind === 'NEW_GENERATION';
  if (generationRollover) {
    const expectedBoundaryDigest = previous.events.at(-1)?.chainDigest ?? previous.compactedChainDigest;
    if (
      next.compactedThroughRevision !== previous.revision
      || next.compactedChainDigest !== expectedBoundaryDigest
    ) throw new TypeError('new generation compaction boundary does not match the prior case head');
  } else if (
    next.compactedThroughRevision !== previous.compactedThroughRevision
    || next.compactedChainDigest !== previous.compactedChainDigest
  ) throw new TypeError('case compaction and event append require separate persistence replacements');
  const preEvent = sealSnapshot({
    ...next,
    generation: previous.generation,
    revision: previous.revision,
    state: previous.state,
    updatedAtMs: previous.updatedAtMs,
    events: [...previous.events],
    compactedThroughRevision: previous.compactedThroughRevision,
    compactedChainDigest: previous.compactedChainDigest,
    commandReceipts: [...previous.commandReceipts],
    evidencePointerIds: [...previous.evidencePointerIds],
    currentGenerationEvidencePointerIds: [...previous.currentGenerationEvidencePointerIds],
    currentGenerationEvidenceBundleBinding: previous.currentGenerationEvidenceBundleBinding === null
      ? null
      : { ...previous.currentGenerationEvidenceBundleBinding },
    currentGenerationDiagnosticBinding: previous.currentGenerationDiagnosticBinding === null
      ? null
      : { ...previous.currentGenerationDiagnosticBinding },
    diagnosticRoundCount: previous.diagnosticRoundCount,
    diagnosticRoundBudgetProofIds: [...previous.diagnosticRoundBudgetProofIds],
    actionReadbackBinding: previous.actionReadbackBinding === null ? null : { ...previous.actionReadbackBinding },
    backpressure: { ...previous.backpressure },
  });
  let replayed: Readonly<ShadowCaseSnapshot>;
  if (receipt.commandKind === 'TRANSITION') {
    const result = transitionCase(preEvent, {
      commandId: event.commandId,
      expectedRevision: previous.revision,
      expectedGeneration: previous.generation,
      toState: event.toState,
      occurredAtMs: event.occurredAtMs,
      reasonCodes: event.reasonCodes,
      evidencePointerIds: event.evidencePointerIds,
    }, proofVerifier);
    if (result.status !== 'COMMITTED') throw new TypeError(`case successor guard replay failed with ${result.status}`);
    replayed = result.snapshot;
  } else if (receipt.commandKind === 'BACKPRESSURE') {
    const active = event.reasonCodes.includes('BACKPRESSURE_APPLIED');
    if (active === event.reasonCodes.includes('BACKPRESSURE_CLEARED')) throw new TypeError('case backpressure successor reason is ambiguous');
    replayed = setCaseBackpressure(
      preEvent,
      active,
      active ? next.backpressure.resumeCursor : null,
      event.commandId,
      event.occurredAtMs,
    );
  } else {
    replayed = nextCaseGeneration(preEvent, event.commandId, event.occurredAtMs);
  }
  if (replayed.snapshotDigest !== next.snapshotDigest) throw new TypeError('case successor does not match deterministic guard replay');
}

export function nextCaseGeneration(
  current: Readonly<ShadowCaseSnapshot>,
  commandId: string,
  occurredAtMs: number,
): Readonly<ShadowCaseSnapshot> {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'case snapshot') as Readonly<ShadowCaseSnapshot>;
  validateSnapshot(current);
  assertIdentifier(commandId, 'commandId');
  assertUtc(occurredAtMs, 'occurredAtMs');
  const priorReceipt = current.commandReceipts.find((receipt) => receipt.commandId === commandId);
  if (priorReceipt) {
    if (priorReceipt.commandKind !== 'NEW_GENERATION') throw new TypeError('command ID was already used by another command kind');
    const replayDigest = commandDigest(current.caseId, priorReceipt.generation, {
      commandId,
      toState: 'CASE_OPENED',
      occurredAtMs,
      reasonCodes: ['NEW_GENERATION_FROM_TERMINAL_CASE'],
      evidencePointerIds: [],
    });
    if (priorReceipt.commandDigest !== replayDigest || priorReceipt.occurredAtMs !== occurredAtMs) {
      throw new TypeError('generation command replay has conflicting content');
    }
    return current;
  }
  if (!(['RECURRENT', 'ESCALATED', 'EXPIRED'] as readonly ShadowCaseState[]).includes(current.state)) {
    throw new TypeError('a new case generation requires recurrent, escalated, or expired state');
  }
  if (current.backpressure.active) throw new TypeError('a new case generation requires explicit backpressure recovery');
  const currentAttemptLineages = new Set(current.attempts
    .filter((attempt) => attempt.generation === current.generation)
    .map((attempt) => `${attempt.operationClass}\0${attempt.sourceRecordId}`));
  const unresolvedAttempt = [...currentAttemptLineages].some((key) => {
    const [operationClass, sourceRecordId] = key.split('\0');
    const last = current.attempts.filter((attempt) => (
      attempt.generation === current.generation
      && attempt.operationClass === operationClass
      && attempt.sourceRecordId === sourceRecordId
    )).at(-1);
    return last !== undefined && last.disposition !== 'SUCCEEDED' && last.disposition !== 'DEAD_LETTERED';
  });
  const unresolvedEffect = current.effects.some((effect) => (
    effect.generation === current.generation
    && (effect.state === 'INTENT' || effect.state === 'UNKNOWN')
    && !current.effects.some((candidate) => (
      candidate.generation === effect.generation
      && candidate.effectId === effect.effectId
      && (candidate.state === 'APPLIED' || candidate.state === 'NOT_APPLIED')
    ))
  ));
  if (unresolvedAttempt || unresolvedEffect) throw new TypeError('new generation cannot strand unresolved attempt or effect readback');
  if (current.commandReceipts.length >= MAX_COMMAND_RECEIPTS) throw new RangeError('case command receipt ledger is full');
  if (occurredAtMs < latestCurrentGenerationAuxiliaryTime(current)) {
    throw new TypeError('generation time must be monotonic and not precede attached auxiliary receipts');
  }
  const generation = current.generation + 1;
  const event = makeEvent(current.caseId, generation, current.revision + 1, current.state, {
    commandId,
    toState: 'CASE_OPENED',
    occurredAtMs,
    reasonCodes: ['NEW_GENERATION_FROM_TERMINAL_CASE'],
    evidencePointerIds: [],
  }, current.events.at(-1)?.chainDigest ?? current.compactedChainDigest);
  return sealSnapshot({
    ...current,
    generation,
    revision: event.revision,
    state: 'CASE_OPENED',
    updatedAtMs: occurredAtMs,
    events: [event],
    compactedThroughRevision: current.revision,
    compactedChainDigest: current.events.at(-1)?.chainDigest ?? current.compactedChainDigest,
    commandReceipts: [...current.commandReceipts, {
      commandId,
      commandDigest: event.commandDigest,
      revision: event.revision,
      generation: event.generation,
      commandKind: 'NEW_GENERATION',
      toState: event.toState,
      occurredAtMs: event.occurredAtMs,
    }],
    currentGenerationEvidencePointerIds: [],
    currentGenerationEvidenceBundleBinding: null,
    currentGenerationDiagnosticBinding: null,
    diagnosticRoundCount: 0,
    diagnosticRoundBudgetProofIds: [],
    actionReadbackBinding: null,
    backpressure: { active: false, resumeCursor: null, refusedCount: current.backpressure.refusedCount },
  });
}
