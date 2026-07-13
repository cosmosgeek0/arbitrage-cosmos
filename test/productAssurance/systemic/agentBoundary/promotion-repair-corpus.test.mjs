import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLASS_CANDIDATES,
  CLASS_POLICIES,
  CORPUS_DEDUP_REGISTRY,
  CORPUS_ITEM,
  CORPUS_RELEASE,
  DIAGNOSTIC_TRACE,
  EXACT_CORPUS_DEDUP_REGISTRY,
  NOW,
  REPAIR_EVIDENCE,
  REPAIR_POLICY,
  RETENTION_POLICY,
  clone,
  h,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.fixtures.mjs';
import {
  corpusContentDigest,
  corpusManifestDigest,
  corpusReleaseReviewEvidenceDigest,
  deriveSelfCorrectionClass,
  evaluateCorpusItemGovernance,
  evaluateCorpusReleaseGovernance,
  evaluateRepairEvidence,
  evaluateSelfCorrectionPromotion,
  evaluateTracePrivacyAndRetention,
  selfCorrectionClassPolicyDigest,
  selfCorrectionHoldoutEvidenceDigest,
} from '../../../../fixtures/productAssurance/systemic/agentBoundary/evaluators.mjs';
import { appendChainDigest, sha256Hex, stableUnique } from '../../../../fixtures/productAssurance/systemic/agentBoundary/canonical.mjs';

function traceDecision() {
  return evaluateTracePrivacyAndRetention({ trace: DIAGNOSTIC_TRACE, policy: RETENTION_POLICY, nowMs: NOW });
}

function repair(bundle = REPAIR_EVIDENCE, trace = traceDecision(), policy = REPAIR_POLICY) {
  return evaluateRepairEvidence({
    bundle,
    policy,
    acceptedPolicyEvidenceDigest: REPAIR_POLICY.evidenceDigest,
    traceDecision: trace,
    nowMs: NOW,
  });
}

function corpus(item = CORPUS_ITEM, retention = traceDecision(), dedupRegistry = CORPUS_DEDUP_REGISTRY) {
  return evaluateCorpusItemGovernance({ item, retentionDecision: retention, dedupRegistry, nowMs: NOW });
}

function promote(className, overrides = {}) {
  return evaluateSelfCorrectionPromotion({
    candidate: CLASS_CANDIDATES[className],
    policy: CLASS_POLICIES[className],
    acceptedPolicyEvidenceDigest: CLASS_POLICIES[className].evidenceDigest,
    traceDecision: traceDecision(),
    repairDecision: repair(),
    corpusDecision: corpus(),
    nowMs: NOW,
    ...overrides,
  });
}

test('§7.6 independent repair evidence passes without declaring recovery', () => {
  const result = repair();
  assert.equal(result.status, 'PASS');
  assert.equal(result.disposition, 'REPAIR_EVIDENCE_ELIGIBLE_FOR_CANONICAL_READBACK');
  assert.equal(result.eligibleForCanonicalRecoveryReadback, true);
  assert.equal(result.mayDeclareRecovery, false);
  assert.equal(result.producerClaim, 'HEALTHY');
  assert.equal(result.allowed, false);
});

test('action completion and producer self-report alone are never repair or recovery proof', () => {
  const incomplete = clone(REPAIR_EVIDENCE);
  incomplete.tests = [];
  incomplete.counterexamples = [];
  incomplete.postconditions = [];
  incomplete.quietPeriod.observedThroughMs = incomplete.quietPeriod.startedAtMs;
  const result = repair(incomplete);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.eligibleForCanonicalRecoveryReadback, false);
  assert.equal(result.mayDeclareRecovery, false);
  assert.ok(result.reasonCodes.includes('REPAIR_POSTCONDITION_MISSING'));
});

test('lease ownership, resource set, epoch, and strict acquisition/completion/expiry order are fail closed', () => {
  const cases = [
    ['STALE_OR_HANDOFF_COMPLETION', (bundle) => { bundle.lease.ownerId = 'rogue-executor.fixture'; }],
    ['STALE_OR_HANDOFF_COMPLETION', (bundle) => { bundle.lease.completionOwnerId = 'replacement-controller.fixture'; }],
    ['REPAIR_RESOURCE_LEASE_SET_INVALID', (bundle) => { bundle.lease.resourceIds = []; }],
    ['REPAIR_LEASE_EPOCH_INVALID', (bundle) => { bundle.lease.epoch = 0; }],
    ['REPAIR_LEASE_EXPIRED_OR_TIME_INVALID', (bundle) => { bundle.lease.acquiredAtMs = bundle.lease.completedAtMs; }],
    ['REPAIR_LEASE_EXPIRED_OR_TIME_INVALID', (bundle) => { bundle.lease.acquiredAtMs = bundle.lease.completedAtMs + 1; }],
    ['REPAIR_LEASE_EXPIRED_OR_TIME_INVALID', (bundle) => { bundle.lease.completedAtMs = bundle.lease.expiresAtMs; }],
  ];
  for (const [reason, mutate] of cases) {
    const bundle = clone(REPAIR_EVIDENCE);
    mutate(bundle);
    const result = repair(bundle);
    assert.equal(result.status, 'FAIL', reason);
    assert.ok(result.reasonCodes.includes(reason), reason);
  }
});

test('repair policy binds registered action, canonical executor, and diagnostic producer identities', () => {
  const cases = [
    ['REPAIR_ACTION_NOT_REGISTERED', (bundle) => { bundle.actionId = 'repair-action.unregistered'; }],
    ['REPAIR_EXECUTOR_NOT_REGISTERED', (bundle) => { bundle.executorId = 'canonical-control.other'; bundle.lease.ownerId = bundle.executorId; bundle.lease.completionOwnerId = bundle.executorId; }],
    ['REPAIR_PRODUCER_NOT_REGISTERED', (bundle) => { bundle.producerId = 'diagnostic-worker.other'; }],
    ['REPAIR_RESOURCE_POLICY_MISMATCH', (bundle) => { bundle.lease.resourceIds = ['resource.fixture.unregistered']; }],
  ];
  for (const [reason, mutate] of cases) {
    const bundle = clone(REPAIR_EVIDENCE);
    mutate(bundle);
    const result = repair(bundle);
    assert.equal(result.status, 'FAIL', reason);
    assert.ok(result.reasonCodes.includes(reason), reason);
  }
});

test('repair completion requires a state change and the exact policy-owned evidence checks', () => {
  const noChange = clone(REPAIR_EVIDENCE);
  noChange.afterStateDigest = noChange.beforeStateDigest;
  assert.ok(repair(noChange).reasonCodes.includes('REPAIR_NO_STATE_CHANGE_PROVEN'));

  for (const mutate of [
    (bundle) => { bundle.tests[0].checkId = 'repair-test.unregistered'; },
    (bundle) => { bundle.counterexamples[0].checkId = 'repair-counterexample.unregistered'; },
    (bundle) => { bundle.postconditions[0].checkId = 'repair-postcondition.unregistered'; },
  ]) {
    const bundle = clone(REPAIR_EVIDENCE);
    mutate(bundle);
    assert.ok(repair(bundle).reasonCodes.includes('REPAIR_REQUIRED_CHECK_SET_MISMATCH'));
  }
});

test('independent readback, tests, counterexamples, postconditions, and quiet period are all required', () => {
  const cases = [
    ['REPAIR_VERIFIER_NOT_INDEPENDENT', (bundle) => { bundle.verifier.relationship = 'COMMON_MODE'; }],
    ['REPAIR_VERIFIER_NOT_INDEPENDENT', (bundle) => { bundle.verifier.verifierId = ''; }],
    ['REPAIR_POSTCONDITION_FAILED', (bundle) => { bundle.postconditions[0].status = 'FAIL'; }],
    ['REPAIR_CHECK_CONTRACT_INVALID', (bundle) => { bundle.tests[0].evidenceDigest = 'bad'; }],
    ['REPAIR_POSTCONDITION_VERIFIER_MISMATCH', (bundle) => { bundle.postconditions[0].verifierId = 'other-verifier.fixture'; }],
    ['QUIET_PERIOD_BREACHED', (bundle) => { bundle.quietPeriod.breachCount = 1; }],
    ['QUIET_PERIOD_TIME_INVALID', (bundle) => { bundle.quietPeriod.startedAtMs = bundle.lease.completedAtMs - 1; }],
    ['QUIET_PERIOD_EVIDENCE_MISSING', (bundle) => { bundle.quietPeriod.requiredMs = 0; }],
    ['QUIET_PERIOD_EVIDENCE_MISSING', (bundle) => { bundle.quietPeriod.breachCount = -1; }],
  ];
  for (const [reason, mutate] of cases) {
    const bundle = clone(REPAIR_EVIDENCE);
    mutate(bundle);
    assert.ok(repair(bundle).reasonCodes.includes(reason), reason);
  }
});

test('repair quiet-period duration is owned by injected policy, never by the claimant', () => {
  const abbreviated = clone(REPAIR_EVIDENCE);
  abbreviated.quietPeriod.requiredMs = 1;
  abbreviated.quietPeriod.startedAtMs = abbreviated.lease.completedAtMs;
  abbreviated.quietPeriod.observedThroughMs = abbreviated.lease.completedAtMs + 1;
  const result = repair(abbreviated);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.reasonCodes.includes('QUIET_PERIOD_POLICY_MISMATCH'));
  assert.equal(result.quietPeriodStatus, 'FAIL');
});

test('failed producer state rejects repair evidence and degraded or unknown state stays incomplete', () => {
  const failed = clone(REPAIR_EVIDENCE);
  failed.producerReport.state = 'FAILED';
  assert.ok(repair(failed).reasonCodes.includes('REPAIR_PRODUCER_REPORT_FAILED'));
  assert.equal(repair(failed).status, 'FAIL');

  for (const state of ['DEGRADED', 'UNKNOWN']) {
    const bundle = clone(REPAIR_EVIDENCE);
    bundle.producerReport.state = state;
    const result = repair(bundle);
    assert.equal(result.status, 'UNKNOWN', state);
    assert.ok(result.reasonCodes.includes('REPAIR_PRODUCER_REPORT_NOT_HEALTHY'));
  }
});

test('repair policy owns rollback/compensation requirements and contradictory evidence is rejected', () => {
  const rollbackDisabled = clone(REPAIR_EVIDENCE);
  rollbackDisabled.rollback.required = false;
  rollbackDisabled.rollback.status = 'NOT_REQUIRED';
  assert.ok(repair(rollbackDisabled).reasonCodes.includes('ROLLBACK_POLICY_COHERENCE_INVALID'));

  const compensationClaim = clone(REPAIR_EVIDENCE);
  compensationClaim.compensation.required = true;
  compensationClaim.compensation.status = 'FAIL';
  assert.ok(repair(compensationClaim).reasonCodes.includes('COMPENSATION_POLICY_COHERENCE_INVALID'));

  const failedAction = clone(REPAIR_EVIDENCE);
  failedAction.actionState = 'FAILED';
  assert.ok(repair(failedAction).reasonCodes.includes('REPAIR_ACTION_FAILED'));
});

test('repair evidence must bind the independently retained trace and exact artifact', () => {
  const unrelatedTrace = { ...traceDecision(), traceId: 'diagnostic-trace.other' };
  assert.ok(repair(REPAIR_EVIDENCE, unrelatedTrace).reasonCodes.includes('REPAIR_TRACE_BINDING_MISMATCH'));

  const unrelatedArtifact = clone(REPAIR_EVIDENCE);
  unrelatedArtifact.artifactDigest = h('other-repair-artifact');
  assert.ok(repair(unrelatedArtifact).reasonCodes.includes('REPAIR_TRACE_BINDING_MISMATCH'));

  const forgedTrace = { status: 'PASS', traceId: REPAIR_EVIDENCE.traceId, diffDigest: REPAIR_EVIDENCE.artifactDigest };
  assert.ok(repair(REPAIR_EVIDENCE, forgedTrace).reasonCodes.includes('REPAIR_TRACE_DECISION_ENVELOPE_INVALID'));

  const unrelatedIncident = clone(REPAIR_EVIDENCE);
  unrelatedIncident.incidentId = 'incident.other';
  assert.ok(repair(unrelatedIncident).reasonCodes.includes('REPAIR_TRACE_BINDING_MISMATCH'));
});

test('§7.7 corpus admits only sanitized provenance-preserved content-bound read projections', () => {
  const result = corpus();
  assert.equal(result.status, 'PASS');
  assert.equal(result.disposition, 'CORPUS_READ_PROJECTION_ELIGIBLE');
  assert.equal(result.canonicalEvidenceMutationAllowed, false);
  assert.equal(result.appendOnlyEvidenceDeletionAllowed, false);
  assert.equal(result.contentDigest, CORPUS_ITEM.contentDigest);
  assert.equal(corpusContentDigest(CORPUS_ITEM), CORPUS_ITEM.contentDigest);

  const exactDuplicate = clone(CORPUS_ITEM);
  exactDuplicate.dedup.state = 'EXACT_MATCH';
  exactDuplicate.dedup.existingItemId = 'corpus-item.existing.1';
  exactDuplicate.dedup.existingContentDigest = EXACT_CORPUS_DEDUP_REGISTRY.entries[0].contentDigest;
  exactDuplicate.contentDigest = corpusContentDigest(exactDuplicate);
  assert.equal(corpus(exactDuplicate, traceDecision(), EXACT_CORPUS_DEDUP_REGISTRY).disposition, 'CORPUS_DEDUPLICATE_REFERENCE');
});

test('corpus governance rejects mutation, privacy failure, injection, poison, and dedup conflict', () => {
  const cases = [
    ['CANONICAL_EVIDENCE_MUTATION_FORBIDDEN', (item) => { item.mutationIntent = 'OVERWRITE_SOURCE'; }],
    ['CORPUS_PRIVACY_REJECTED', (item) => { item.privacyState = 'UNSANITIZED'; }],
    ['CORPUS_UNTRUSTED_INSTRUCTION_PRESENT', (item) => { item.untrustedInstructionState = 'PRESENT'; }],
    ['CORPUS_POISON_CONFIRMED', (item) => { item.poisonState = 'CONFIRMED'; }],
    ['CORPUS_DEDUP_CONFLICT', (item) => { item.dedup.state = 'CONFLICT'; }],
  ];
  for (const [reason, mutate] of cases) {
    const item = clone(CORPUS_ITEM);
    mutate(item);
    const result = corpus(item);
    assert.equal(result.status, 'FAIL', reason);
    assert.ok(result.reasonCodes.includes(reason), reason);
  }
});

test('unknown poison, quarantined instructions, missing Atlas facts, and missing provenance remain quarantined', () => {
  const cases = [
    (item) => { item.poisonState = 'UNKNOWN'; },
    (item) => { item.untrustedInstructionState = 'QUARANTINED'; },
    (item) => { item.atlasProjection.causeCodes = []; item.contentDigest = corpusContentDigest(item); },
    (item) => { item.sourceEvidenceRefs = []; item.dedup.stableKey = h('empty-source-stable-key'); item.contentDigest = corpusContentDigest(item); },
  ];
  for (const mutate of cases) {
    const item = clone(CORPUS_ITEM);
    mutate(item);
    assert.notEqual(corpus(item).status, 'PASS');
  }
});

test('dedup state and target are coherent, and content cannot change under the old digest', () => {
  const exactWithoutTarget = clone(CORPUS_ITEM);
  exactWithoutTarget.dedup.state = 'EXACT_MATCH';
  assert.ok(corpus(exactWithoutTarget).reasonCodes.includes('CORPUS_DEDUP_TARGET_MISSING'));

  const uniqueWithTarget = clone(CORPUS_ITEM);
  uniqueWithTarget.dedup.existingItemId = 'corpus-item.other';
  assert.ok(corpus(uniqueWithTarget).reasonCodes.includes('CORPUS_UNIQUE_TARGET_MUST_BE_NULL'));

  const changedContent = clone(CORPUS_ITEM);
  changedContent.atlasProjection.recurrenceCount += 1;
  assert.ok(corpus(changedContent).reasonCodes.includes('CORPUS_CONTENT_DIGEST_MISMATCH'));

  const nonexistent = clone(CORPUS_ITEM);
  nonexistent.dedup.state = 'EXACT_MATCH';
  nonexistent.dedup.existingItemId = 'corpus-item.nonexistent';
  nonexistent.dedup.existingContentDigest = EXACT_CORPUS_DEDUP_REGISTRY.entries[0].contentDigest;
  nonexistent.contentDigest = corpusContentDigest(nonexistent);
  const unproven = corpus(nonexistent, traceDecision(), EXACT_CORPUS_DEDUP_REGISTRY);
  assert.equal(unproven.status, 'FAIL');
  assert.ok(unproven.reasonCodes.includes('CORPUS_DEDUP_TARGET_NOT_REGISTERED'));

  const missingRegistry = evaluateCorpusItemGovernance({
    item: CORPUS_ITEM,
    retentionDecision: traceDecision(),
    dedupRegistry: null,
    nowMs: NOW,
  });
  assert.equal(missingRegistry.status, 'UNKNOWN');
  assert.ok(missingRegistry.reasonCodes.includes('CORPUS_DEDUP_REGISTRY_MISSING_OR_INVALID'));
});

test('corpus retention binds trace, policy, coverage, and independent owner', () => {
  const wrongTrace = clone(CORPUS_ITEM);
  wrongTrace.retentionTraceId = 'diagnostic-trace.other';
  wrongTrace.contentDigest = corpusContentDigest(wrongTrace);
  assert.ok(corpus(wrongTrace).reasonCodes.includes('CORPUS_RETENTION_TRACE_MISMATCH'));

  const expired = clone(CORPUS_ITEM);
  expired.retention.minimumRetainUntilMs = NOW;
  expired.contentDigest = corpusContentDigest(expired);
  assert.ok(corpus(expired).reasonCodes.includes('CORPUS_RETENTION_POLICY_INVALID'));

  const forgedRetention = {
    status: 'PASS',
    traceId: CORPUS_ITEM.retentionTraceId,
    retentionPolicyRevision: CORPUS_ITEM.retention.policyRevision,
    retentionCoverageUntilMs: CORPUS_ITEM.retention.minimumRetainUntilMs,
    retentionOwnerId: 'independent-retention-owner',
  };
  assert.ok(corpus(CORPUS_ITEM, forgedRetention).reasonCodes.includes('CORPUS_RETENTION_DECISION_ENVELOPE_INVALID'));

  const insufficientCoverage = { ...traceDecision(), retentionCoverageUntilMs: CORPUS_ITEM.retention.minimumRetainUntilMs - 1 };
  assert.ok(corpus(CORPUS_ITEM, insufficientCoverage).reasonCodes.includes('CORPUS_RETENTION_COVERAGE_INSUFFICIENT'));
});

test('corpus content digest seals validation, outcome, dedup, poison, and mutation states', () => {
  const mutations = [
    (item) => { item.validation.evidenceDigest = h('changed-validation-proof'); },
    (item) => { item.independentOutcome.evidenceDigest = h('changed-outcome-proof'); },
    (item) => { item.dedup.state = 'EXACT_MATCH'; item.dedup.existingItemId = 'corpus-item.other'; item.dedup.existingContentDigest = h('corpus-item-other-content'); },
    (item) => { item.poisonState = 'SUSPECTED'; },
    (item) => { item.mutationIntent = 'RETIRE_ELIGIBILITY_ONLY'; },
  ];
  for (const mutate of mutations) {
    const item = clone(CORPUS_ITEM);
    mutate(item);
    assert.ok(corpus(item).reasonCodes.includes('CORPUS_CONTENT_DIGEST_MISMATCH'));
  }
});

test('corpus governance rejects semantically contradictory inclusion and dedup states after reseal', () => {
  const cases = [
    ['CANONICAL_EVIDENCE_MUTATION_FORBIDDEN', (item) => { item.mutationIntent = 'RETIRE_ELIGIBILITY_ONLY'; }],
    ['CORPUS_GOVERNANCE_REASON_COHERENCE_INVALID', (item) => { item.governanceDisposition.exclusionReasonCodes = ['SHOULD_NOT_EXIST_WHEN_INCLUDED']; }],
    ['CORPUS_DEDUP_SELF_REFERENCE', (item) => { item.dedup.state = 'EXACT_MATCH'; item.dedup.existingItemId = item.corpusItemId; item.dedup.existingContentDigest = item.contentDigest; }],
  ];
  for (const [reason, mutate] of cases) {
    const item = clone(CORPUS_ITEM);
    mutate(item);
    item.contentDigest = corpusContentDigest(item);
    const result = corpus(item);
    assert.equal(result.status, 'FAIL', reason);
    assert.ok(result.reasonCodes.includes(reason), reason);
  }
});

test('corpus validators and outcomes remain independent from retention writer/verifier actors', () => {
  for (const [field, actor, reason] of [
    ['writerId', CORPUS_ITEM.validation.verifierId, 'CORPUS_VALIDATOR_RETENTION_COMMON_MODE'],
    ['verifierId', CORPUS_ITEM.independentOutcome.verifierId, 'CORPUS_OUTCOME_RETENTION_COMMON_MODE'],
  ]) {
    const trace = clone(DIAGNOSTIC_TRACE);
    trace.retentionReceipts[0][field] = actor;
    trace.retentionReceipts[0].chainDigest = appendChainDigest(trace.retentionReceipts[0]);
    const retained = evaluateTracePrivacyAndRetention({ trace, policy: RETENTION_POLICY, nowMs: NOW });
    assert.equal(retained.status, 'PASS');
    assert.ok(corpus(CORPUS_ITEM, retained).reasonCodes.includes(reason), reason);
  }
});

test('corpus independence considers every append actor, not only the final receipt', () => {
  const trace = clone(DIAGNOSTIC_TRACE);
  const first = trace.retentionReceipts[0];
  first.writerId = CORPUS_ITEM.validation.verifierId;
  first.chainDigest = appendChainDigest(first);
  const second = {
    ...first,
    sequence: first.sequence + 1,
    previousChainDigest: first.chainDigest,
    retainedAtMs: first.retainedAtMs + 1,
    writerId: 'existing-ledger-adapter',
    verifierId: 'independent-retention-probe',
  };
  second.chainDigest = appendChainDigest(second);
  trace.retentionReceipts.push(second);
  const retained = evaluateTracePrivacyAndRetention({ trace, policy: RETENTION_POLICY, nowMs: NOW });
  assert.equal(retained.status, 'PASS');
  assert.ok(retained.retentionWriterIds.includes(CORPUS_ITEM.validation.verifierId));
  const governed = corpus(CORPUS_ITEM, retained);
  assert.equal(governed.status, 'FAIL');
  assert.ok(governed.reasonCodes.includes('CORPUS_VALIDATOR_RETENTION_COMMON_MODE'));
});

test('corpus release manifest binds each item ID, stable key, content digest, and partition', () => {
  const itemDecision = corpus();
  const accepted = evaluateCorpusReleaseGovernance({ release: CORPUS_RELEASE, itemDecisions: [itemDecision], nowMs: NOW });
  assert.equal(accepted.status, 'PASS');
  assert.equal(accepted.corpusStorageMutationAllowed, false);

  const moved = clone(CORPUS_RELEASE);
  moved.partitions.train = [];
  moved.partitions.holdout = [CORPUS_ITEM.corpusItemId];
  moved.itemBindings[0].partition = 'HOLDOUT';
  moved.manifestDigest = corpusManifestDigest(moved);
  const rejected = evaluateCorpusReleaseGovernance({ release: moved, itemDecisions: [itemDecision], nowMs: NOW });
  assert.equal(rejected.status, 'FAIL');
  assert.ok(rejected.reasonCodes.includes('CORPUS_ITEM_RELEASE_BINDING_MISMATCH'));

  const contentChanged = clone(CORPUS_RELEASE);
  contentChanged.itemBindings[0].contentDigest = h('changed-release-content');
  assert.notEqual(corpusManifestDigest(contentChanged), CORPUS_RELEASE.manifestDigest);
});

test('corpus release rejects leakage, incomplete decisions, and fabricated PASS decisions', () => {
  const itemDecision = corpus();
  const leaked = clone(CORPUS_RELEASE);
  leaked.partitions.holdout = [CORPUS_ITEM.corpusItemId];
  leaked.manifestDigest = corpusManifestDigest(leaked);
  assert.ok(evaluateCorpusReleaseGovernance({ release: leaked, itemDecisions: [itemDecision, itemDecision], nowMs: NOW }).reasonCodes.includes('CORPUS_CROSS_PARTITION_LEAKAGE'));

  assert.equal(evaluateCorpusReleaseGovernance({ release: CORPUS_RELEASE, itemDecisions: [], nowMs: NOW }).status, 'UNKNOWN');
  const forged = { status: 'PASS', corpusItemId: CORPUS_ITEM.corpusItemId, stableKey: CORPUS_ITEM.dedup.stableKey, contentDigest: CORPUS_ITEM.contentDigest, partition: 'TRAIN' };
  assert.ok(evaluateCorpusReleaseGovernance({ release: CORPUS_RELEASE, itemDecisions: [forged], nowMs: NOW }).reasonCodes.includes('CORPUS_ITEM_DECISION_ENVELOPE_INVALID'));

  const badReview = clone(CORPUS_RELEASE);
  badReview.reviewer.evidenceDigest = h('unbound-corpus-release-review');
  assert.ok(evaluateCorpusReleaseGovernance({ release: badReview, itemDecisions: [itemDecision], nowMs: NOW }).reasonCodes.includes('CORPUS_RELEASE_REVIEW_EVIDENCE_INVALID'));

  const commonModeReview = clone(CORPUS_RELEASE);
  commonModeReview.reviewer.reviewerId = CORPUS_ITEM.sourceEvidenceRefs[0].ownerId;
  commonModeReview.reviewer.evidenceDigest = corpusReleaseReviewEvidenceDigest(commonModeReview);
  assert.ok(evaluateCorpusReleaseGovernance({ release: commonModeReview, itemDecisions: [itemDecision], nowMs: NOW }).reasonCodes.includes('CORPUS_RELEASE_REVIEWER_NOT_INDEPENDENT'));
});

test('Class A-D resolve only under the exact accepted, content-bound owner policy projection', () => {
  for (const className of ['A', 'B', 'C', 'D']) {
    assert.equal(deriveSelfCorrectionClass(CLASS_CANDIDATES[className], CLASS_POLICIES[className]), className);
    assert.equal(deriveSelfCorrectionClass(CLASS_CANDIDATES[className], null), 'UNKNOWN');
  }
  const wrongRevision = clone(CLASS_POLICIES.A);
  wrongRevision.revision += 1;
  assert.equal(deriveSelfCorrectionClass(CLASS_CANDIDATES.A, wrongRevision), 'UNKNOWN');
});

test('Class A-D route exactly to registered command, canonical recovery, normal release, or abstain/demote', () => {
  const results = Object.fromEntries(['A', 'B', 'C', 'D'].map((className) => [className, promote(className)]));
  assert.equal(results.A.disposition, 'REGISTERED_LOCAL_CONTROL_COMMAND_EVIDENCE_ELIGIBLE');
  assert.equal(results.B.disposition, 'CANONICAL_RECONCILIATION_RECOVERY_REQUIRED');
  assert.equal(results.C.disposition, 'OWNER_APPROVED_HASH_BOUND_RELEASE_REQUIRED');
  assert.equal(results.D.disposition, 'ABSTAIN_OR_DEMOTE_REQUIRED');
  assert.equal(results.A.registeredCommandId, REPAIR_EVIDENCE.actionId);
  assert.equal(results.B.classRoute, 'CANONICAL_RECONCILIATION_AND_RECOVERY');
  assert.equal(results.C.classRoute, 'EXISTING_HASH_BOUND_RELEASE_PIPELINE');
  assert.equal(results.D.classRoute, 'EXISTING_Q_RUNTIME_OWNER');
  for (const result of Object.values(results)) {
    assert.equal(result.status, 'PASS');
    assert.equal(result.operationalActionAllowed, false);
    assert.equal(result.mayDeclareRecovery, false);
    assert.equal(result.allowed, false);
  }
});

test('no class receives a caller-defined law, automatic privilege, weakened policy, or unknown capability', () => {
  assert.notEqual(promote('A', { policy: null }).status, 'PASS');

  const automaticB = clone(CLASS_POLICIES.B);
  automaticB.mode = 'AUTOMATIC_ELIGIBILITY';
  assert.ok(promote('B', { policy: automaticB }).reasonCodes.includes('CLASS_POLICY_LAW_MISMATCH'));

  const unsupportedPolicy = clone(CLASS_POLICIES.B);
  unsupportedPolicy.version = 2;
  assert.ok(promote('B', { policy: unsupportedPolicy }).reasonCodes.includes('CLASS_POLICY_SCHEMA_UNSUPPORTED'));

  const weakened = clone(CLASS_POLICIES.C);
  weakened.requiresApproval = false;
  assert.ok(promote('C', { policy: weakened }).reasonCodes.includes('CLASS_POLICY_LAW_MISMATCH'));

  const callerDefined = clone(CLASS_POLICIES.A);
  callerDefined.allowedEffectFlags = ['ATTACKER_DEFINED_EFFECT'];
  callerDefined.evidenceDigest = selfCorrectionClassPolicyDigest(callerDefined);
  const callerCandidate = clone(CLASS_CANDIDATES.A);
  callerCandidate.effectFlags = ['ATTACKER_DEFINED_EFFECT'];
  const callerResult = promote('A', { candidate: callerCandidate, policy: callerDefined });
  assert.equal(callerResult.status, 'FAIL');
  assert.ok(callerResult.reasonCodes.includes('CLASS_POLICY_NOT_ACCEPTED_BY_OWNER'));

  const unknownCapability = clone(CLASS_CANDIDATES.B);
  unknownCapability.capabilities = ['UNKNOWN_CAPABILITY'];
  assert.equal(promote('B', { candidate: unknownCapability }).status, 'FAIL');
});

test('promotion binds exact effect, trace artifact, repair artifact, corpus trace, and approval envelope', () => {
  const badEffect = clone(CLASS_CANDIDATES.B);
  badEffect.effectFlags = ['RISK'];
  assert.equal(promote('B', { candidate: badEffect }).status, 'FAIL');

  const badArtifact = clone(CLASS_CANDIDATES.B);
  badArtifact.artifactDigest = h('bad-promotion-artifact');
  assert.ok(promote('B', { candidate: badArtifact }).reasonCodes.includes('PROMOTION_TRACE_ARTIFACT_BINDING_MISMATCH'));

  const staleApproval = clone(CLASS_CANDIDATES.C);
  staleApproval.approval.expiresAtMs = NOW;
  assert.ok(promote('C', { candidate: staleApproval }).reasonCodes.includes('APPROVAL_NOT_EXACT_OR_EXPIRED'));

  const widenedApproval = clone(CLASS_CANDIDATES.C);
  widenedApproval.approval.effectFlags = ['NON_MONEY_MAIN_PATCH_HANDOFF', 'RISK'];
  assert.ok(promote('C', { candidate: widenedApproval }).reasonCodes.includes('APPROVAL_NOT_EXACT_OR_EXPIRED'));

  const unrelatedApproval = clone(CLASS_CANDIDATES.C);
  unrelatedApproval.approval.approvalRef = 'approval.unrelated';
  assert.ok(promote('C', { candidate: unrelatedApproval }).reasonCodes.includes('APPROVAL_NOT_EXACT_OR_EXPIRED'));

  const commonModeApproval = clone(CLASS_CANDIDATES.C);
  commonModeApproval.approval.approverId = commonModeApproval.independentVerifier.verifierId;
  assert.ok(promote('C', { candidate: commonModeApproval }).reasonCodes.includes('APPROVAL_NOT_EXACT_OR_EXPIRED'));

  const commonModeVerifier = clone(CLASS_CANDIDATES.B);
  commonModeVerifier.independentVerifier.verifierId = DIAGNOSTIC_TRACE.producerId;
  const commonModePromotion = promote('B', { candidate: commonModeVerifier });
  assert.equal(commonModePromotion.status, 'FAIL');
  assert.ok(commonModePromotion.reasonCodes.includes('PROMOTION_VERIFIER_PREREQUISITE_COMMON_MODE'));

  const commonModePrerequisiteApprover = clone(CLASS_CANDIDATES.C);
  commonModePrerequisiteApprover.approval.approverId = DIAGNOSTIC_TRACE.producerId;
  commonModePrerequisiteApprover.approval.bindingDigest = sha256Hex({
    approvalRef: commonModePrerequisiteApprover.approval.approvalRef,
    candidateId: commonModePrerequisiteApprover.candidateId,
    candidateRevision: commonModePrerequisiteApprover.revision,
    policyId: commonModePrerequisiteApprover.policyId,
    artifactDigest: commonModePrerequisiteApprover.artifactDigest,
    environment: CLASS_POLICIES.C.environment,
    policyRevision: commonModePrerequisiteApprover.policyRevision,
    capabilities: stableUnique(commonModePrerequisiteApprover.capabilities),
    effectFlags: stableUnique(commonModePrerequisiteApprover.effectFlags),
    rollbackPlanDigest: commonModePrerequisiteApprover.rollback.planDigest,
    approverId: commonModePrerequisiteApprover.approval.approverId,
    expiresAtMs: commonModePrerequisiteApprover.approval.expiresAtMs,
  });
  const commonModeApprovalResult = promote('C', { candidate: commonModePrerequisiteApprover });
  assert.equal(commonModeApprovalResult.status, 'FAIL');
  assert.ok(commonModeApprovalResult.reasonCodes.includes('APPROVAL_PREREQUISITE_COMMON_MODE'));

  const unboundHoldout = clone(CLASS_CANDIDATES.C);
  unboundHoldout.holdout.evidenceDigest = h('arbitrary-holdout-claim');
  assert.ok(promote('C', { candidate: unboundHoldout }).reasonCodes.includes('HOLDOUT_BINDING_INVALID'));

  const commonModeHoldout = clone(CLASS_CANDIDATES.C);
  commonModeHoldout.holdout.verifierId = DIAGNOSTIC_TRACE.providerId;
  commonModeHoldout.holdout.evidenceDigest = selfCorrectionHoldoutEvidenceDigest({
    candidate: commonModeHoldout,
    policy: CLASS_POLICIES.C,
  });
  const commonModeHoldoutResult = promote('C', { candidate: commonModeHoldout });
  assert.equal(commonModeHoldoutResult.status, 'FAIL');
  assert.ok(commonModeHoldoutResult.reasonCodes.includes('HOLDOUT_VERIFIER_NOT_INDEPENDENT'));

  const forgedRepair = { status: 'PASS', artifactDigest: CLASS_CANDIDATES.A.artifactDigest, evidenceRefs: [] };
  assert.ok(promote('A', { repairDecision: forgedRepair }).reasonCodes.includes('REPAIR_EVIDENCE_DECISION_ENVELOPE_INVALID'));

  const crossEnvironmentPolicy = clone(CLASS_POLICIES.B);
  crossEnvironmentPolicy.environment = 'production';
  const crossEnvironmentCandidate = clone(CLASS_CANDIDATES.B);
  crossEnvironmentCandidate.approval.environment = 'production';
  crossEnvironmentCandidate.approval.bindingDigest = h('cross-environment-approval-placeholder');
  const crossEnvironment = promote('B', { candidate: crossEnvironmentCandidate, policy: crossEnvironmentPolicy });
  assert.ok(crossEnvironment.reasonCodes.includes('PROMOTION_TRACE_ENVIRONMENT_MISMATCH'));
});
