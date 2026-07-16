import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  attachCaseProof,
  attachBudgetReceipt,
  compactCaseSnapshot,
  createCaseSnapshot,
  nextCaseGeneration,
  recordAttempt,
  recordEffect,
  resumeCaseSnapshot,
  serializeCaseSnapshot,
  setCaseBackpressure,
  transitionCase,
} from '../../../dist/aiOps/runtime/index.js';
import { createSyntheticCaseProofAuthority } from '../../../../fixtures/aiOps/a2/synthetic-runtime.mjs';
import { canonicalJson } from '../../../dist/foundation/contracts/identity.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const start = 1_700_000_100_000;
const proofAuthority = createSyntheticCaseProofAuthority();

function addProof(snapshot, proofKind, artifactId, artifactDigest, recordedAtMs) {
  return attachCaseProof(snapshot, proofAuthority.issueValidatedProof({
    proofKind,
    caseId: snapshot.caseId,
    generation: snapshot.generation,
    artifactId,
    artifactDigest,
    disposition: 'VALIDATED',
    recordedAtMs,
  }), proofAuthority);
}

function evidenceBinding(snapshot, bundleDigest, additionalPointerIds = []) {
  const evidencePointerIds = [...new Set([...snapshot.currentGenerationEvidencePointerIds, ...additionalPointerIds])].sort();
  return Object.freeze({
    pointerSetDigest: sha256(canonicalJson(evidencePointerIds)),
    bindingDigest: sha256(canonicalJson({ evidenceBundleDigest: bundleDigest, evidencePointerIds })),
  });
}

function evidenceBindingReasons(bundleDigest, binding) {
  return [`EVIDENCE_BUNDLE_BOUND:${bundleDigest}`, `EVIDENCE_POINTER_SET_BOUND:${binding.pointerSetDigest}`];
}

function request(snapshot, commandId, toState, offset, overrides = {}) {
  return {
    commandId,
    expectedRevision: snapshot.revision,
    expectedGeneration: snapshot.generation,
    toState,
    occurredAtMs: start + offset,
    reasonCodes: [`TO_${toState}`],
    evidencePointerIds: [],
    ...overrides,
  };
}

function commit(snapshot, commandId, toState, offset, overrides = {}) {
  const result = transitionCase(snapshot, request(snapshot, commandId, toState, offset, overrides), proofAuthority);
  assert.equal(result.status, 'COMMITTED', result.reasonCode);
  return result.snapshot;
}

test('case lifecycle requires evidence, budget, verification, handoff, effect readback, and quiet-period recovery proof', () => {
  let clock = 0;
  const diagnosticDigest = sha256('diagnostic-result');
  const verificationDigest = sha256('verification-result');
  const handoffDigest = sha256('model-run-handoff');
  const effectDigest = sha256('effect');
  let snapshot = createCaseSnapshot('case-flow-1', 'detect-1', start, ['SYNTHETIC_DETECTION'], ['pointer-1']);
  const next = (id, state, overrides = {}) => {
    clock += 10;
    snapshot = commit(snapshot, id, state, clock, overrides);
  };
  next('s-1', 'DEDUPED_OR_SUPPRESSED');
  next('s-2', 'CASE_OPENED');
  const evidenceBundleDigest = sha256('evidence-bundle');
  const frozenEvidence = evidenceBinding(snapshot, evidenceBundleDigest);
  clock += 1;
  snapshot = addProof(snapshot, 'EVIDENCE_BUNDLE', 'bundle-1', frozenEvidence.bindingDigest, start + clock);
  next('s-3', 'EVIDENCE_FROZEN', { reasonCodes: evidenceBindingReasons(evidenceBundleDigest, frozenEvidence) });
  const redactionDigest = sha256('redaction-report');
  clock += 1;
  snapshot = addProof(snapshot, 'REDACTION_REPORT', 'redaction-1', redactionDigest, start + clock);
  next('s-4', 'REDACTION_VERIFIED', { reasonCodes: [`REDACTION_REPORT_BOUND:${redactionDigest}`] });
  snapshot = attachBudgetReceipt(snapshot, 'budget-receipt-1');
  const budgetDigest = sha256('budget-admission');
  clock += 1;
  snapshot = addProof(snapshot, 'BUDGET_ADMISSION', 'budget-receipt-1', budgetDigest, start + clock);
  next('s-5', 'BUDGET_ADMITTED', { reasonCodes: [`BUDGET_ADMISSION_BOUND:${budgetDigest}`] });
  next('s-6', 'DIAGNOSING', { reasonCodes: [`DIAGNOSTIC_ROUND_BUDGET_BOUND:${budgetDigest}`] });
  clock += 1;
  snapshot = recordAttempt(snapshot, {
    attemptId: 'provider-attempt-1-started', sourceRecordId: 'provider-request-1', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'STARTED', recordedAtMs: start + clock, payloadDigest: diagnosticDigest,
  });
  clock += 1;
  snapshot = recordAttempt(snapshot, {
    attemptId: 'provider-attempt-1', sourceRecordId: 'provider-request-1', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'SUCCEEDED', recordedAtMs: start + clock, payloadDigest: diagnosticDigest,
  });
  const diagnosticEvidenceBindingDigest = sha256(canonicalJson({
    diagnosticResultDigest: diagnosticDigest,
    evidenceBundleDigest,
  }));
  snapshot = addProof(snapshot, 'DIAGNOSTIC_RESULT', 'diagnosis-1', diagnosticEvidenceBindingDigest, start + clock);
  const diagnosticBindingReasons = [
    `DIAGNOSTIC_RESULT_BOUND:${diagnosticDigest}`,
    `EVIDENCE_BUNDLE_BOUND:${evidenceBundleDigest}`,
    `DIAGNOSTIC_EVIDENCE_BINDING_BOUND:${diagnosticEvidenceBindingDigest}`,
  ];
  next('s-7', 'DIAGNOSIS_READY', { reasonCodes: diagnosticBindingReasons });
  next('s-8', 'PROPOSAL_READY', { reasonCodes: diagnosticBindingReasons });
  next('s-9', 'POLICY_EVALUATED');
  next('s-10', 'SANDBOX_VERIFYING');
  clock += 1;
  snapshot = recordAttempt(snapshot, {
    attemptId: 'verification-attempt-1-started', sourceRecordId: 'verification-request-1', attemptBaseline: 0, operationClass: 'DETERMINISTIC', generation: 0, attemptNumber: 1,
    disposition: 'STARTED', recordedAtMs: start + clock, payloadDigest: verificationDigest,
  });
  clock += 1;
  snapshot = recordAttempt(snapshot, {
    attemptId: 'verification-attempt-1', sourceRecordId: 'verification-request-1', attemptBaseline: 0, operationClass: 'DETERMINISTIC', generation: 0, attemptNumber: 1,
    disposition: 'SUCCEEDED', recordedAtMs: start + clock, payloadDigest: verificationDigest,
  });
  snapshot = addProof(snapshot, 'VERIFICATION_RESULT', 'verification-1', verificationDigest, start + clock);
  next('s-11', 'VERIFIED', { reasonCodes: [`VERIFICATION_RESULT_BOUND:${verificationDigest}`] });
  clock += 1;
  snapshot = recordAttempt(snapshot, {
    attemptId: 'handoff-attempt-1-started', sourceRecordId: 'handoff-request-1', attemptBaseline: 0, operationClass: 'HANDOFF', generation: 0, attemptNumber: 1,
    disposition: 'STARTED', recordedAtMs: start + clock, payloadDigest: handoffDigest,
  });
  clock += 1;
  snapshot = recordAttempt(snapshot, {
    attemptId: 'handoff-attempt-1', sourceRecordId: 'handoff-request-1', attemptBaseline: 0, operationClass: 'HANDOFF', generation: 0, attemptNumber: 1,
    disposition: 'SUCCEEDED', recordedAtMs: start + clock, payloadDigest: handoffDigest,
  });
  snapshot = addProof(snapshot, 'MODEL_RUN_HANDOFF', 'handoff-1', handoffDigest, start + clock);
  next('s-12', 'HANDED_OFF', { reasonCodes: [`MODEL_RUN_HANDOFF_BOUND:${handoffDigest}`] });
  // Same-payload effects must still be selected and proven by exact effect ID.
  const unrelatedEffectDigest = effectDigest;
  clock += 1;
  snapshot = recordEffect(snapshot, {
    effectId: 'effect-unrelated', generation: 0, state: 'INTENT', payloadDigest: unrelatedEffectDigest, recordedAtMs: start + clock,
  });
  clock += 1;
  snapshot = recordEffect(snapshot, {
    effectId: 'effect-unrelated', generation: 0, state: 'APPLIED', payloadDigest: unrelatedEffectDigest, recordedAtMs: start + clock,
  });
  snapshot = addProof(snapshot, 'EFFECT_READBACK', 'effect-unrelated', unrelatedEffectDigest, start + clock);
  clock += 1;
  snapshot = recordEffect(snapshot, {
    effectId: 'effect-1', generation: 0, state: 'INTENT', payloadDigest: effectDigest, recordedAtMs: start + clock,
  });
  snapshot = addProof(snapshot, 'EFFECT_READBACK', 'effect-readback-premature', effectDigest, start + clock);
  clock += 1;
  snapshot = recordEffect(snapshot, {
    effectId: 'effect-1', generation: 0, state: 'APPLIED', payloadDigest: effectDigest, recordedAtMs: start + clock,
  });
  const effectIdDigest = sha256('effect-1');
  const prematureAction = transitionCase(snapshot, request(snapshot, 's-13-premature-proof', 'ACTION_READBACK', clock + 1, { reasonCodes: [
    `GLOBAL_EFFECT_READBACK_BOUND:${effectDigest}`,
    `GLOBAL_EFFECT_ID_BOUND:${effectIdDigest}`,
  ] }), proofAuthority);
  assert.equal(prematureAction.status, 'GUARDRAIL_TRIPPED');
  assert.match(prematureAction.reasonCode, /SIGNED_EFFECT_READBACK_PROOF_REQUIRED/u);
  clock += 1;
  snapshot = addProof(snapshot, 'EFFECT_READBACK', 'effect-1', effectDigest, start + clock);
  const prematureRecoveryDigest = sha256('premature-recovery-readback');
  const prematureQuietDigest = sha256('premature-quiet-period');
  snapshot = addProof(snapshot, 'RECOVERY_READBACK', 'premature-recovery-readback', prematureRecoveryDigest, start + clock);
  snapshot = addProof(snapshot, 'QUIET_PERIOD', 'premature-quiet-period', prematureQuietDigest, start + clock);
  next('s-13', 'ACTION_READBACK', { reasonCodes: [
    `GLOBAL_EFFECT_READBACK_BOUND:${effectDigest}`,
    `GLOBAL_EFFECT_ID_BOUND:${effectIdDigest}`,
  ] });
  const resolutionReasons = [
    `APPLIED_EFFECT_BOUND:${effectDigest}`,
    `APPLIED_EFFECT_ID_BOUND:${effectIdDigest}`,
    `INDEPENDENT_RECOVERY_READBACK_BOUND:${prematureRecoveryDigest}`,
    `QUIET_PERIOD_EVIDENCE_BOUND:${prematureQuietDigest}`,
  ];
  const unresolvedAttempt = recordAttempt(snapshot, {
    attemptId: 'late-work-started', sourceRecordId: 'late-work', attemptBaseline: 0,
    operationClass: 'PROVIDER', generation: 0, attemptNumber: 1, disposition: 'STARTED',
    recordedAtMs: start + clock + 1, payloadDigest: sha256('late-work'),
  });
  const attemptBlockedResolution = transitionCase(
    unresolvedAttempt,
    request(unresolvedAttempt, 's-14-unresolved-attempt', 'RESOLVED', clock + 2, {
      reasonCodes: resolutionReasons, evidencePointerIds: ['pointer-1'],
    }),
    proofAuthority,
  );
  assert.equal(attemptBlockedResolution.status, 'GUARDRAIL_TRIPPED');
  assert.match(attemptBlockedResolution.reasonCode, /UNRESOLVED_DURABLE_WORK/u);
  const unresolvedEffect = recordEffect(snapshot, {
    effectId: 'late-effect', generation: 0, state: 'INTENT', payloadDigest: sha256('late-effect'),
    recordedAtMs: start + clock + 1,
  });
  const effectBlockedResolution = transitionCase(
    unresolvedEffect,
    request(unresolvedEffect, 's-14-unresolved-effect', 'RESOLVED', clock + 2, {
      reasonCodes: resolutionReasons, evidencePointerIds: ['pointer-1'],
    }),
    proofAuthority,
  );
  assert.equal(effectBlockedResolution.status, 'GUARDRAIL_TRIPPED');
  assert.match(effectBlockedResolution.reasonCode, /UNRESOLVED_DURABLE_WORK/u);
  let compensatedBranch = recordEffect(snapshot, {
    effectId: 'effect-compensation', compensatesEffectId: 'effect-1', generation: 0, state: 'INTENT',
    payloadDigest: sha256('effect-compensation'), recordedAtMs: start + clock + 1,
  });
  compensatedBranch = recordEffect(compensatedBranch, {
    effectId: 'effect-compensation', compensatesEffectId: 'effect-1', generation: 0, state: 'APPLIED',
    payloadDigest: sha256('effect-compensation'), recordedAtMs: start + clock + 2,
  });
  const compensatedResolution = transitionCase(
    compensatedBranch,
    request(compensatedBranch, 's-14-compensated-effect', 'RESOLVED', clock + 3, {
      reasonCodes: resolutionReasons, evidencePointerIds: ['pointer-1'],
    }),
    proofAuthority,
  );
  assert.equal(compensatedResolution.status, 'GUARDRAIL_TRIPPED');
  assert.match(compensatedResolution.reasonCode, /APPLIED_EFFECT_READBACK_REQUIRED/u);
  clock += 1;
  snapshot = setCaseBackpressure(snapshot, true, 'resolution-resume-cursor', 'resolution-pressure-on', start + clock);
  clock += 1;
  snapshot = setCaseBackpressure(snapshot, false, null, 'resolution-pressure-off', start + clock);
  const retainedActionBinding = snapshot.actionReadbackBinding;
  snapshot = compactCaseSnapshot(snapshot, 1);
  assert.equal(snapshot.events.some((event) => event.commandId === 's-13'), false);
  assert.deepEqual(snapshot.actionReadbackBinding, retainedActionBinding);
  const prematureResolution = transitionCase(snapshot, request(snapshot, 's-14-premature-recovery', 'RESOLVED', clock + 1, {
    reasonCodes: [
      `APPLIED_EFFECT_BOUND:${effectDigest}`,
      `APPLIED_EFFECT_ID_BOUND:${effectIdDigest}`,
      `INDEPENDENT_RECOVERY_READBACK_BOUND:${prematureRecoveryDigest}`,
      `QUIET_PERIOD_EVIDENCE_BOUND:${prematureQuietDigest}`,
    ],
    evidencePointerIds: ['pointer-1'],
  }), proofAuthority);
  assert.equal(prematureResolution.status, 'GUARDRAIL_TRIPPED');
  assert.match(prematureResolution.reasonCode, /SIGNED_RECOVERY_READBACK_PROOF_REQUIRED/u);
  const recoveryDigest = sha256('recovery-readback');
  const quietDigest = sha256('quiet-period');
  clock += 1;
  snapshot = addProof(snapshot, 'RECOVERY_READBACK', 'recovery-readback-1', recoveryDigest, start + clock);
  snapshot = addProof(snapshot, 'QUIET_PERIOD', 'quiet-period-1', quietDigest, start + clock);
  const unrelatedResolution = transitionCase(snapshot, request(snapshot, 's-14-wrong-effect', 'RESOLVED', clock + 1, {
    reasonCodes: [
      `APPLIED_EFFECT_BOUND:${unrelatedEffectDigest}`,
      `APPLIED_EFFECT_ID_BOUND:${sha256('effect-unrelated')}`,
      `INDEPENDENT_RECOVERY_READBACK_BOUND:${recoveryDigest}`,
      `QUIET_PERIOD_EVIDENCE_BOUND:${quietDigest}`,
    ],
    evidencePointerIds: ['pointer-1'],
  }), proofAuthority);
  assert.equal(unrelatedResolution.status, 'GUARDRAIL_TRIPPED');
  assert.match(unrelatedResolution.reasonCode, /APPLIED_EFFECT_READBACK_REQUIRED/u);
  next('s-14', 'RESOLVED', {
    reasonCodes: [
      `APPLIED_EFFECT_BOUND:${effectDigest}`,
      `APPLIED_EFFECT_ID_BOUND:${effectIdDigest}`,
      `INDEPENDENT_RECOVERY_READBACK_BOUND:${recoveryDigest}`,
      `QUIET_PERIOD_EVIDENCE_BOUND:${quietDigest}`,
    ],
    evidencePointerIds: ['pointer-1'],
  });
  next('s-15', 'POSTMORTEM_AND_LEARNING_RECORDED');
  assert.equal(snapshot.state, 'POSTMORTEM_AND_LEARNING_RECORDED');
  assert.throws(() => recordAttempt(snapshot, {
    attemptId: 'closed-work-started', sourceRecordId: 'closed-work', attemptBaseline: 0,
    operationClass: 'PROVIDER', generation: 0, attemptNumber: 1, disposition: 'STARTED',
    recordedAtMs: start + clock + 1, payloadDigest: sha256('closed-work'),
  }), /closed case/u);
  assert.throws(() => recordEffect(snapshot, {
    effectId: 'closed-effect', generation: 0, state: 'INTENT', payloadDigest: sha256('closed-effect'),
    recordedAtMs: start + clock + 1,
  }), /closed case/u);
  assert.equal(snapshot.revision, 17);
  assert.equal(snapshot.events.length, 3);
  assert.equal(new Set(snapshot.events.map((event) => event.chainDigest)).size, snapshot.events.length);
});

test('state-machine guardrails prevent empty evidence, fabricated verification, and manufactured recovery', () => {
  let snapshot = createCaseSnapshot('case-guards', 'detect-guards', start, ['SYNTHETIC_DETECTION']);
  snapshot = commit(snapshot, 'g-1', 'DEDUPED_OR_SUPPRESSED', 1);
  snapshot = commit(snapshot, 'g-2', 'CASE_OPENED', 2);
  const noEvidence = transitionCase(snapshot, request(snapshot, 'g-3', 'EVIDENCE_FROZEN', 3));
  assert.equal(noEvidence.status, 'GUARDRAIL_TRIPPED');
  assert.match(noEvidence.reasonCode, /VALIDATED_EVIDENCE_REQUIRED/u);
  assert.equal(snapshot.state, 'CASE_OPENED');
});

test('case proofs require independent artifact-owner readback in addition to a signature', () => {
  const snapshot = createCaseSnapshot('case-proof-readback', 'detect-proof-readback', start, ['SYNTHETIC_DETECTION']);
  const digest = sha256('artifact-owner-proof');
  const proof = proofAuthority.issueValidatedProof({
    proofKind: 'EVIDENCE_BUNDLE', caseId: snapshot.caseId, generation: 0, artifactId: 'bundle-owner-readback',
    artifactDigest: digest, disposition: 'VALIDATED', recordedAtMs: start + 1,
  });
  const unrelatedAuthority = createSyntheticCaseProofAuthority();
  assert.throws(() => attachCaseProof(snapshot, proof, unrelatedAuthority), /artifact-owner validation/u);
  assert.throws(() => attachCaseProof(snapshot, { ...proof, signature: { ...proof.signature, signature: 'f'.repeat(64) } }, proofAuthority), /signature or artifact-owner/u);
});

test('illegal transitions, revision conflicts, stale generations, and time regression fail closed', () => {
  const snapshot = createCaseSnapshot('case-flow-2', 'detect-2', start, ['SYNTHETIC_DETECTION']);
  assert.equal(transitionCase(snapshot, request(snapshot, 'illegal', 'RESOLVED', 1)).status, 'ILLEGAL_TRANSITION');
  assert.equal(transitionCase(snapshot, request(snapshot, 'revision', 'DEDUPED_OR_SUPPRESSED', 1, { expectedRevision: 99 })).status, 'REVISION_CONFLICT');
  assert.equal(transitionCase(snapshot, request(snapshot, 'generation', 'DEDUPED_OR_SUPPRESSED', 1, { expectedGeneration: 1 })).status, 'STALE_GENERATION');
  assert.throws(() => transitionCase(snapshot, request(snapshot, 'time', 'DEDUPED_OR_SUPPRESSED', -1)), /monotonic/u);
  const futureAuxiliary = recordAttempt(snapshot, {
    attemptId: 'future-auxiliary-started', sourceRecordId: 'future-auxiliary', attemptBaseline: 0,
    operationClass: 'PROVIDER', generation: 0, attemptNumber: 1, disposition: 'STARTED',
    recordedAtMs: start + 2, payloadDigest: sha256('future-auxiliary'),
  });
  assert.throws(
    () => transitionCase(futureAuxiliary, request(futureAuxiliary, 'before-auxiliary', 'DEDUPED_OR_SUPPRESSED', 1)),
    /attached auxiliary receipts/u,
  );
});

test('command replay remains idempotent after later transitions while changed content conflicts', () => {
  const initial = createCaseSnapshot('case-flow-3', 'detect-3', start, ['SYNTHETIC_DETECTION'], ['pointer-1']);
  const transition = request(initial, 'dedupe-command', 'DEDUPED_OR_SUPPRESSED', 1);
  const committed = transitionCase(initial, transition);
  assert.equal(committed.status, 'COMMITTED');
  const later = transitionCase(committed.snapshot, request(committed.snapshot, 'open-command', 'CASE_OPENED', 2));
  assert.equal(later.status, 'COMMITTED');
  const delayedReplay = transitionCase(later.snapshot, transition);
  assert.equal(delayedReplay.status, 'IDEMPOTENT');
  assert.strictEqual(delayedReplay.snapshot, later.snapshot);
  assert.throws(() => transitionCase(later.snapshot, { ...transition, reasonCodes: ['CHANGED'] }), /conflicting content/u);
});

test('compaction and restart preserve exact lineage and deep-freeze auxiliary ledgers', () => {
  let snapshot = createCaseSnapshot('case-flow-4', 'detect-4', start, ['SYNTHETIC_DETECTION'], ['pointer-a']);
  snapshot = commit(snapshot, 'd-1', 'DEDUPED_OR_SUPPRESSED', 1);
  snapshot = commit(snapshot, 'd-2', 'CASE_OPENED', 2);
  const bundleDigest = sha256('compaction-bundle');
  const frozenEvidence = evidenceBinding(snapshot, bundleDigest);
  snapshot = addProof(snapshot, 'EVIDENCE_BUNDLE', 'compaction-bundle', frozenEvidence.bindingDigest, start + 3);
  snapshot = commit(snapshot, 'd-3', 'EVIDENCE_FROZEN', 3, { reasonCodes: evidenceBindingReasons(bundleDigest, frozenEvidence) });
  snapshot = recordAttempt(snapshot, {
    attemptId: 'attempt-1-started', sourceRecordId: 'compaction-provider-request', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'STARTED', recordedAtMs: start + 4, payloadDigest: sha256('attempt'),
  });
  snapshot = recordEffect(snapshot, {
    effectId: 'effect-1', generation: 0, state: 'INTENT', payloadDigest: sha256('effect'), recordedAtMs: start + 5,
  });
  snapshot = attachBudgetReceipt(snapshot, 'budget-receipt-1');
  const compacted = compactCaseSnapshot(snapshot, 2);
  const resumed = resumeCaseSnapshot(serializeCaseSnapshot(compacted));
  assert.deepEqual(resumed, compacted);
  assert.equal(resumed.compactedThroughRevision, 1);
  assert.equal(resumed.attempts.length, 1);
  assert.equal(resumed.effects.length, 1);
  assert.equal(resumed.budgetReceiptIds.length, 1);
  assert.match(resumed.budgetReceiptIds[0], /^a2-budget-receipt:/u);
  assert.deepEqual(resumed.evidencePointerIds, ['pointer-a']);
  assert.deepEqual(resumed.currentGenerationEvidencePointerIds, ['pointer-a']);
  assert.throws(() => resumed.budgetReceiptIds.push('mutate'));
});

test('tampering event or auxiliary state is rejected on restart', () => {
  let snapshot = createCaseSnapshot('case-flow-5', 'detect-5', start, ['SYNTHETIC_DETECTION']);
  snapshot = commit(snapshot, 'd-1', 'DEDUPED_OR_SUPPRESSED', 1);
  snapshot = attachBudgetReceipt(snapshot, 'budget-1');
  const corruptEvent = JSON.parse(serializeCaseSnapshot(snapshot));
  corruptEvent.events[1].chainDigest = '0'.repeat(64);
  assert.throws(() => resumeCaseSnapshot(JSON.stringify(corruptEvent)), /snapshot digest|chain digest/u);
  const corruptAux = JSON.parse(serializeCaseSnapshot(snapshot));
  corruptAux.budgetReceiptIds.push('forged-budget');
  assert.throws(() => resumeCaseSnapshot(JSON.stringify(corruptAux)), /snapshot digest/u);
  assert.throws(() => transitionCase(corruptAux, request(corruptAux, 'forged-direct-transition', 'CASE_OPENED', 2)), /snapshot digest/u);
  assert.throws(() => attachBudgetReceipt(corruptAux, 'forged-direct-receipt'), /snapshot digest/u);
  assert.throws(() => resumeCaseSnapshot('{'), /invalid JSON/u);
  const reordered = JSON.parse(serializeCaseSnapshot(snapshot));
  reordered.events.reverse();
  assert.throws(() => resumeCaseSnapshot(JSON.stringify(reordered)), /snapshot digest|lineage/u);
});

test('backpressure transitions are themselves append-only and refused work is not acknowledged', () => {
  const snapshot = createCaseSnapshot('case-flow-6', 'detect-6', start, ['SYNTHETIC_DETECTION']);
  const pressured = setCaseBackpressure(snapshot, true, 'resume-cursor-1', 'pressure-on', start + 1);
  assert.equal(pressured.revision, snapshot.revision + 1);
  const refused = transitionCase(pressured, request(pressured, 'not-acknowledged', 'DEDUPED_OR_SUPPRESSED', 2));
  assert.equal(refused.status, 'BACKPRESSURED');
  assert.equal(refused.snapshot.commandReceipts.some((receipt) => receipt.commandId === 'not-acknowledged'), false);
  const resumed = setCaseBackpressure(pressured, false, null, 'pressure-off', start + 2);
  assert.strictEqual(setCaseBackpressure(resumed, true, 'resume-cursor-1', 'pressure-on', start + 1), resumed);
  const advanced = transitionCase(resumed, request(resumed, 'not-acknowledged', 'DEDUPED_OR_SUPPRESSED', 3));
  assert.equal(advanced.status, 'COMMITTED');
  assert.strictEqual(setCaseBackpressure(advanced.snapshot, true, 'resume-cursor-1', 'pressure-on', start + 1), advanced.snapshot);
});

test('attempt and global-effect lineages are bounded, idempotent, and intent-first', () => {
  let snapshot = createCaseSnapshot('case-flow-7', 'detect-7', start, ['SYNTHETIC_DETECTION']);
  snapshot = recordAttempt(snapshot, {
    attemptId: 'attempt-1-started', sourceRecordId: 'provider-request-1', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'STARTED', recordedAtMs: start + 1, payloadDigest: sha256('attempt'),
  });
  const attempt = {
    attemptId: 'attempt-1', sourceRecordId: 'provider-request-1', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'UNKNOWN', recordedAtMs: start + 2, payloadDigest: sha256('attempt'),
  };
  snapshot = recordAttempt(snapshot, attempt);
  assert.strictEqual(recordAttempt(snapshot, attempt), snapshot);
  assert.throws(() => recordAttempt(snapshot, { ...attempt, attemptId: 'attempt-3', attemptNumber: 3 }), /terminal or ambiguous/u);
  assert.throws(() => recordAttempt(snapshot, { ...attempt, attemptId: 'attempt-stale', generation: 1, attemptNumber: 2 }), /stale generation/u);
  assert.throws(() => recordAttempt(snapshot, { ...attempt, hiddenSecret: 'do-not-persist' }), /unsupported field/u);
  const effectDigest = sha256('effect');
  assert.throws(() => recordEffect(snapshot, {
    effectId: 'effect-1', generation: 0, state: 'APPLIED', payloadDigest: effectDigest, recordedAtMs: start + 2,
  }), /prior intent/u);
  snapshot = recordEffect(snapshot, {
    effectId: 'effect-1', generation: 0, state: 'INTENT', payloadDigest: effectDigest, recordedAtMs: start + 2,
  });
  assert.throws(() => recordEffect(snapshot, {
    effectId: 'effect-extra', generation: 0, state: 'INTENT', payloadDigest: effectDigest, recordedAtMs: start + 5,
    hiddenSecret: 'do-not-persist',
  }), /unsupported field/u);
  assert.throws(() => recordEffect(snapshot, {
    effectId: 'effect-1', generation: 0, state: 'INTENT', payloadDigest: effectDigest, recordedAtMs: start + 3,
  }), /cannot be reissued/u);
  snapshot = recordEffect(snapshot, {
    effectId: 'effect-1', generation: 0, state: 'UNKNOWN', payloadDigest: effectDigest, recordedAtMs: start + 3,
  });
  snapshot = recordEffect(snapshot, {
    effectId: 'effect-1', generation: 0, state: 'NOT_APPLIED', payloadDigest: effectDigest, recordedAtMs: start + 4,
  });
  assert.equal(snapshot.effects.at(-1).state, 'NOT_APPLIED');
  snapshot = commit(snapshot, 'attempt-replay-head-advance', 'DEDUPED_OR_SUPPRESSED', 5);
  assert.strictEqual(recordAttempt(snapshot, attempt), snapshot);
});

test('new generation preserves old attempts and fences stale completion', () => {
  let snapshot = createCaseSnapshot('case-flow-8', 'detect-8', start, ['SYNTHETIC_DETECTION'], ['pointer-1']);
  snapshot = commit(snapshot, 'n-1', 'DEDUPED_OR_SUPPRESSED', 1);
  snapshot = commit(snapshot, 'n-2', 'CASE_OPENED', 2);
  const bundleDigest = sha256('generation-bundle');
  const frozenEvidence = evidenceBinding(snapshot, bundleDigest);
  snapshot = addProof(snapshot, 'EVIDENCE_BUNDLE', 'generation-bundle', frozenEvidence.bindingDigest, start + 3);
  snapshot = commit(snapshot, 'n-3', 'EVIDENCE_FROZEN', 3, { reasonCodes: evidenceBindingReasons(bundleDigest, frozenEvidence) });
  snapshot = commit(snapshot, 'n-4', 'QUARANTINED', 4);
  snapshot = commit(snapshot, 'n-5', 'OWNER_ATTENTION_REQUIRED', 5);
  snapshot = commit(snapshot, 'n-6', 'ESCALATED', 6);
  snapshot = recordAttempt(snapshot, {
    attemptId: 'attempt-old-started', sourceRecordId: 'old-provider-request', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'STARTED', recordedAtMs: start + 7, payloadDigest: sha256('old'),
  });
  assert.throws(() => nextCaseGeneration(snapshot, 'unresolved-generation', start + 8), /cannot strand unresolved/u);
  const ambiguous = recordAttempt(snapshot, {
    attemptId: 'attempt-old-unknown', sourceRecordId: 'old-provider-request', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'UNKNOWN', recordedAtMs: start + 7, payloadDigest: sha256('old'),
  });
  assert.throws(() => nextCaseGeneration(ambiguous, 'ambiguous-generation', start + 8), /cannot strand unresolved/u);
  snapshot = recordAttempt(snapshot, {
    attemptId: 'attempt-old', sourceRecordId: 'old-provider-request', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'FAILED_TERMINAL', recordedAtMs: start + 7, payloadDigest: sha256('old'),
  });
  assert.throws(() => nextCaseGeneration(snapshot, 'failed-without-dlq-generation', start + 8), /cannot strand unresolved/u);
  snapshot = recordAttempt(snapshot, {
    attemptId: 'attempt-old-dead-letter', sourceRecordId: 'old-provider-request', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'DEAD_LETTERED', recordedAtMs: start + 8, payloadDigest: sha256('old'),
  });
  const next = nextCaseGeneration(snapshot, 'new-generation', start + 8);
  assert.equal(next.generation, 1);
  assert.equal(next.state, 'CASE_OPENED');
  assert.equal(next.attempts.length, 3);
  assert.equal(next.commandReceipts.at(-1).generation, 1);
  assert.equal(next.commandReceipts.slice(0, -1).every((receipt) => receipt.generation === 0), true);
  assert.strictEqual(nextCaseGeneration(next, 'new-generation', start + 8), next);
  assert.throws(() => nextCaseGeneration(next, 'new-generation', start + 9), /conflicting content/u);
  const oldEvidence = transitionCase(next, request(next, 'new-evidence', 'EVIDENCE_FROZEN', 9));
  assert.equal(oldEvidence.status, 'GUARDRAIL_TRIPPED');
  assert.match(oldEvidence.reasonCode, /VALIDATED_EVIDENCE_REQUIRED/u);
  assert.throws(() => recordAttempt(next, {
    attemptId: 'late-old', sourceRecordId: 'old-provider-request', attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 2,
    disposition: 'SUCCEEDED', recordedAtMs: start + 9, payloadDigest: sha256('late'),
  }), /stale generation/u);
});

test('restart rejects overcommitted attempt and effect reservation ledgers', () => {
  const base = createCaseSnapshot('case-reservation-forgery', 'detect-reservation-forgery', start, ['SYNTHETIC_DETECTION']);
  const reseal = (overrides) => {
    const { snapshotDigest: _digest, ...core } = { ...base, ...overrides };
    return { ...core, snapshotDigest: sha256(canonicalJson(core)) };
  };
  const attempts = Array.from({ length: 129 }, (_, index) => ({
    attemptId: `forged-start-${index}`,
    sourceRecordId: `forged-source-${index}`,
    attemptBaseline: 0,
    operationClass: 'PROVIDER',
    generation: 0,
    attemptNumber: 1,
    disposition: 'STARTED',
    recordedAtMs: start + 1,
    payloadDigest: sha256(`forged-attempt-${index}`),
  }));
  assert.throws(
    () => resumeCaseSnapshot(canonicalJson(reseal({ attempts }))),
    /stranded outcome reservations/u,
  );
  const effects = Array.from({ length: 86 }, (_, index) => ({
    effectId: `forged-effect-${index}`,
    generation: 0,
    state: 'INTENT',
    payloadDigest: sha256(`forged-effect-${index}`),
    recordedAtMs: start + 1,
  }));
  assert.throws(
    () => resumeCaseSnapshot(canonicalJson(reseal({ effects }))),
    /stranded readback reservations/u,
  );
});

test('duplicate command inputs canonicalize once and remain restartable', () => {
  const snapshot = createCaseSnapshot(
    'case-duplicate-inputs',
    'detect-duplicate-inputs',
    start,
    ['SYNTHETIC_DETECTION', 'SYNTHETIC_DETECTION'],
    ['pointer-duplicate', 'pointer-duplicate'],
  );
  assert.deepEqual(snapshot.events[0].reasonCodes, ['SYNTHETIC_DETECTION']);
  assert.deepEqual(snapshot.events[0].evidencePointerIds, ['pointer-duplicate']);
  assert.deepEqual(resumeCaseSnapshot(serializeCaseSnapshot(snapshot)), snapshot);
});

test('compaction preserves idempotent backpressure and generation command replays', () => {
  let pressure = createCaseSnapshot('case-compacted-pressure', 'detect-compacted-pressure', start, ['SYNTHETIC_DETECTION']);
  pressure = setCaseBackpressure(pressure, true, 'cursor-compacted', 'pressure-compacted', start + 1);
  pressure = setCaseBackpressure(pressure, false, null, 'pressure-cleared', start + 2);
  const compactedPressure = compactCaseSnapshot(pressure, 1);
  assert.equal(compactedPressure.events.some((event) => event.commandId === 'pressure-compacted'), false);
  assert.strictEqual(setCaseBackpressure(compactedPressure, true, 'cursor-compacted', 'pressure-compacted', start + 1), compactedPressure);

  let terminal = createCaseSnapshot('case-compacted-generation', 'detect-compacted-generation', start, ['SYNTHETIC_DETECTION'], ['pointer-1']);
  terminal = commit(terminal, 'cg-1', 'DEDUPED_OR_SUPPRESSED', 1);
  terminal = commit(terminal, 'cg-2', 'CASE_OPENED', 2);
  const bundleDigest = sha256('compacted-generation-bundle');
  const frozenEvidence = evidenceBinding(terminal, bundleDigest);
  terminal = addProof(terminal, 'EVIDENCE_BUNDLE', 'compacted-generation-bundle', frozenEvidence.bindingDigest, start + 3);
  terminal = commit(terminal, 'cg-3', 'EVIDENCE_FROZEN', 3, { reasonCodes: evidenceBindingReasons(bundleDigest, frozenEvidence) });
  terminal = commit(terminal, 'cg-4', 'QUARANTINED', 4);
  terminal = commit(terminal, 'cg-5', 'OWNER_ATTENTION_REQUIRED', 5);
  terminal = commit(terminal, 'cg-6', 'ESCALATED', 6);
  let generation = nextCaseGeneration(terminal, 'generation-compacted', start + 7);
  generation = setCaseBackpressure(generation, true, 'cursor-generation', 'generation-pressure', start + 8);
  generation = setCaseBackpressure(generation, false, null, 'generation-clear', start + 9);
  const compactedGeneration = compactCaseSnapshot(generation, 1);
  assert.equal(compactedGeneration.events.some((event) => event.commandId === 'generation-compacted'), false);
  assert.strictEqual(nextCaseGeneration(compactedGeneration, 'generation-compacted', start + 7), compactedGeneration);

  let boundedReceipts = createCaseSnapshot('case-bounded-receipts', 'detect-bounded-receipts', start, ['SYNTHETIC_DETECTION']);
  boundedReceipts = setCaseBackpressure(boundedReceipts, true, 'bounded-cursor', 'bounded-pressure', start + 1);
  boundedReceipts = setCaseBackpressure(boundedReceipts, false, null, 'bounded-clear', start + 2);
  boundedReceipts = compactCaseSnapshot(boundedReceipts, 1, 0);
  assert.deepEqual(boundedReceipts.commandReceipts.map((receipt) => receipt.commandId), [
    'detect-bounded-receipts', 'bounded-pressure', 'bounded-clear',
  ]);
  assert.strictEqual(
    setCaseBackpressure(boundedReceipts, true, 'bounded-cursor', 'bounded-pressure', start + 1),
    boundedReceipts,
  );
  assert.doesNotThrow(() => setCaseBackpressure(boundedReceipts, true, 'bounded-cursor-2', 'bounded-pressure-2', start + 3));
});

test('generation rollover refuses unresolved global effects and active backpressure', () => {
  let snapshot = createCaseSnapshot('case-generation-obligations', 'detect-generation-obligations', start, ['SYNTHETIC_DETECTION'], ['pointer-1']);
  snapshot = commit(snapshot, 'go-1', 'DEDUPED_OR_SUPPRESSED', 1);
  snapshot = commit(snapshot, 'go-2', 'CASE_OPENED', 2);
  const bundleDigest = sha256('generation-obligations-bundle');
  const frozen = evidenceBinding(snapshot, bundleDigest);
  snapshot = addProof(snapshot, 'EVIDENCE_BUNDLE', 'generation-obligations-bundle', frozen.bindingDigest, start + 3);
  snapshot = commit(snapshot, 'go-3', 'EVIDENCE_FROZEN', 3, { reasonCodes: evidenceBindingReasons(bundleDigest, frozen) });
  snapshot = commit(snapshot, 'go-4', 'QUARANTINED', 4);
  snapshot = commit(snapshot, 'go-5', 'OWNER_ATTENTION_REQUIRED', 5);
  snapshot = commit(snapshot, 'go-6', 'ESCALATED', 6);
  const intent = recordEffect(snapshot, {
    effectId: 'generation-effect', generation: 0, state: 'INTENT',
    payloadDigest: sha256('generation-effect'), recordedAtMs: start + 7,
  });
  assert.throws(() => nextCaseGeneration(intent, 'generation-with-effect-intent', start + 8), /unresolved attempt or effect readback/u);
  const unknown = recordEffect(intent, {
    effectId: 'generation-effect', generation: 0, state: 'UNKNOWN',
    payloadDigest: sha256('generation-effect'), recordedAtMs: start + 8,
  });
  assert.throws(() => nextCaseGeneration(unknown, 'generation-with-effect-unknown', start + 9), /unresolved attempt or effect readback/u);
  const closed = recordEffect(unknown, {
    effectId: 'generation-effect', generation: 0, state: 'NOT_APPLIED',
    payloadDigest: sha256('generation-effect'), recordedAtMs: start + 9,
  });
  const pressured = setCaseBackpressure(closed, true, 'generation-resume-cursor', 'generation-pressure-active', start + 10);
  assert.throws(() => nextCaseGeneration(pressured, 'generation-under-pressure', start + 11), /backpressure/u);
  const cleared = setCaseBackpressure(pressured, false, null, 'generation-pressure-clear', start + 11);
  assert.equal(nextCaseGeneration(cleared, 'generation-after-clear', start + 12).generation, 1);
});

test('restart enforces exact compaction revision and chain-anchor nullability', () => {
  const base = createCaseSnapshot('case-compaction-nullability', 'detect-compaction-nullability', start, ['SYNTHETIC_DETECTION']);
  const reseal = (overrides) => {
    const { snapshotDigest: _digest, ...core } = { ...base, ...overrides };
    return { ...core, snapshotDigest: sha256(canonicalJson(core)) };
  };
  assert.throws(
    () => resumeCaseSnapshot(canonicalJson(reseal({ compactedThroughRevision: 0, compactedChainDigest: null }))),
    /nullability mismatch/u,
  );
  assert.throws(
    () => resumeCaseSnapshot(canonicalJson(reseal({ compactedThroughRevision: -1, compactedChainDigest: sha256('forged-anchor') }))),
    /nullability mismatch/u,
  );
});
