import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANCELLATION_FIXTURES,
  FIXTURE_NOW_MS,
  makeCancellationEvidence,
} from '../../../../fixtures/productAssurance/systemic/stability/fixtures.mjs';
import { CANCELLATION_LATE_RESULT_LAW } from '../../../../fixtures/productAssurance/systemic/stability/contracts.mjs';
import { evaluateCancellationEvidence } from '../../../../fixtures/productAssurance/systemic/stability/reference-evaluator.mjs';
import { cancellationRestartDigest } from '../../../../fixtures/productAssurance/systemic/stability/integrity.mjs';

for (const fixture of CANCELLATION_FIXTURES) {
  test(`${fixture.id} evaluates deterministically`, () => {
    const first = evaluateCancellationEvidence(fixture.input, FIXTURE_NOW_MS);
    const second = evaluateCancellationEvidence(fixture.input, FIXTURE_NOW_MS);
    assert.deepEqual(first, second);
    assert.equal(first.assuranceResult, fixture.expectedResult);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(first.dataAuthority, 'SYNTHETIC_TEST');
    assert.equal(first.effectAuthority, 'NONE');
    assert.equal(first.cancellationProvesMutationAbsence, false);
    if (fixture.expectedReason) assert.ok(first.reasonCodes.includes(fixture.expectedReason), first.reasonCodes.join(','));
    if (fixture.expectedLeaseEvidence) assert.equal(first.leaseEvidence, fixture.expectedLeaseEvidence);
  });
}

test('deadline expiry is inclusive at now == effective deadline', () => {
  const record = makeCancellationEvidence({
    startedAtMs: FIXTURE_NOW_MS - 5_000,
    inheritedDeadlineAtMs: FIXTURE_NOW_MS,
    childBudgetMs: 5_000,
    localDeadlineAtMs: FIXTURE_NOW_MS,
  });
  const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.deadlineEvidence, 'EXPIRED');
  assert.equal(assessment.mayInitiateNewLocalEffects, false);
  assert.equal(assessment.assuranceResult, 'PASS');
});

test('bounded inherited and local deadlines cannot precede request start', () => {
  for (const field of ['inheritedDeadlineAtMs', 'localDeadlineAtMs']) {
    const record = makeCancellationEvidence({ [field]: FIXTURE_NOW_MS - 6_000 });
    const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(assessment.contractIssues.some((issue) => issue.code === 'DEADLINE_PRECEDES_REQUEST_START'));
  }
});

test('cancel intent never erases committed external truth', () => {
  const fixture = CANCELLATION_FIXTURES.find((entry) => entry.id === 'C03_EXTERNAL_CANCEL_INTENT_REQUIRES_RECONCILIATION');
  const assessment = evaluateCancellationEvidence(fixture.input, FIXTURE_NOW_MS);
  assert.equal(assessment.authoritativeReconciliationRequired, true);
  assert.equal(assessment.cancellationProvesMutationAbsence, false);
  assert.equal(assessment.cancellationSupported, false);
});

test('requested cancellation is visible while child observation remains unproved', () => {
  const record = makeCancellationEvidence({
    cancelRequestedAtMs: FIXTURE_NOW_MS - 1_000,
    cancelObservedAtMs: null,
  });
  const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'UNKNOWN');
  assert.equal(assessment.cancelIntentObserved, false);
  assert.equal(assessment.mayInitiateNewLocalEffects, false);
  assert.ok(assessment.reasonCodes.includes('CANCELLATION_PROPAGATION_UNPROVED'));

  const raced = makeCancellationEvidence({
    cancelRequestedAtMs: FIXTURE_NOW_MS - 1_000,
    cancelObservedAtMs: null,
    effect: {
      kind: 'LOCAL',
      initiatedAtMs: FIXTURE_NOW_MS - 500,
      committedAtMs: FIXTURE_NOW_MS - 400,
    },
  });
  const racedAssessment = evaluateCancellationEvidence(raced, FIXTURE_NOW_MS);
  assert.equal(racedAssessment.assuranceResult, 'UNKNOWN');
  assert.equal(racedAssessment.mayInitiateNewLocalEffects, false);
  assert.ok(racedAssessment.reasonCodes.includes('CANCELLATION_PROPAGATION_UNPROVED'));
});

test('late stale fact is retained while stale authority is rejected', () => {
  const fixture = CANCELLATION_FIXTURES.find((entry) => entry.id === 'C05_STALE_EPOCH_LATE_FILL_IS_TRUTH_NOT_AUTHORITY');
  const assessment = evaluateCancellationEvidence(fixture.input, FIXTURE_NOW_MS);
  assert.equal(assessment.lateFactDisposition, 'INGEST_DURABLY_AND_RECONCILE');
  assert.equal(assessment.staleAuthorityRejected, true);
  assert.equal(assessment.assuranceResult, 'PASS');
});

test('registered fenced reconciliation survives the initiating request timeout', () => {
  const fixture = CANCELLATION_FIXTURES.find((entry) => entry.id === 'C09_REGISTERED_FENCED_RECOVERY_SURVIVES_PARENT_TIMEOUT');
  const assessment = evaluateCancellationEvidence(fixture.input, FIXTURE_NOW_MS);
  assert.equal(assessment.deadlineEvidence, 'EXPIRED');
  assert.equal(assessment.detachedRecoveryContinuationRequired, true);
  assert.equal(assessment.authoritativeReconciliationRequired, true);
});

test('invalid injected clocks fail explicitly', () => {
  assert.throws(() => evaluateCancellationEvidence(makeCancellationEvidence(), Number.NaN), TypeError);
  assert.throws(() => evaluateCancellationEvidence(makeCancellationEvidence(), -1), TypeError);
});

test('external or already-accepted mutation requires reconciliation even when effect timing is unknown', () => {
  const record = makeCancellationEvidence({
    operationClass: 'NON_IDEMPOTENT_MUTATION',
    effect: { kind: 'EXTERNAL_OR_ALREADY_ACCEPTED', initiatedAtMs: null, committedAtMs: null },
    reconciliationEvidence: {
      required: true,
      operationLookupRef: 'synthetic.lookup.ambiguous-external',
      durableEvidenceRef: 'synthetic.reconciliation.ambiguous-external',
    },
  });
  const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'PASS');
  assert.equal(assessment.authoritativeReconciliationRequired, true);
  assert.equal(assessment.cancellationProvesMutationAbsence, false);
});

test('external mutation without durable reconciliation references fails at the contract boundary', () => {
  const record = structuredClone(makeCancellationEvidence({
    operationClass: 'NON_IDEMPOTENT_MUTATION',
    effect: { kind: 'EXTERNAL_OR_ALREADY_ACCEPTED', initiatedAtMs: null, committedAtMs: null },
    reconciliationEvidence: {
      required: true,
      operationLookupRef: 'synthetic.lookup.external',
      durableEvidenceRef: 'synthetic.reconciliation.external',
    },
  }));
  record.reconciliationEvidence.durableEvidenceRef = null;
  const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'RECONCILIATION_EVIDENCE_REQUIRED'));
});

test('future cancellation, effect, lease, and late-fact observations cannot prove current truth', () => {
  const cases = [];
  cases.push(makeCancellationEvidence({ cancelRequestedAtMs: FIXTURE_NOW_MS + 1 }));
  cases.push(makeCancellationEvidence({
    effect: { kind: 'LOCAL', initiatedAtMs: FIXTURE_NOW_MS + 1, committedAtMs: null },
  }));

  const currentLease = structuredClone(CANCELLATION_FIXTURES.find((entry) => entry.id === 'C07_LONG_LIVED_CONTROLLER_USES_CURRENT_LEASE').input);
  currentLease.lease.acquiredAtMs = FIXTURE_NOW_MS + 1;
  currentLease.lease.lastRenewedAtMs = FIXTURE_NOW_MS + 2;
  currentLease.lease.lastHeartbeatAtMs = FIXTURE_NOW_MS + 3;
  currentLease.lease.expiresAtMs = FIXTURE_NOW_MS + 10_000;
  cases.push(currentLease);

  const late = structuredClone(CANCELLATION_FIXTURES.find((entry) => entry.id === 'C05_STALE_EPOCH_LATE_FILL_IS_TRUTH_NOT_AUTHORITY').input);
  late.lateFact.occurredAtMs = FIXTURE_NOW_MS + 1;
  late.lateFact.receivedAtMs = FIXTURE_NOW_MS + 2;
  cases.push(late);

  for (const record of cases) {
    const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL', assessment.reasonCodes.join(','));
    assert.ok(assessment.reasonCodes.some((code) => code.includes('FUTURE')), assessment.reasonCodes.join(','));
  }
});

test('long-lived lease identity must map to the declared canonical owner', () => {
  const record = structuredClone(CANCELLATION_FIXTURES.find((entry) => entry.id === 'C07_LONG_LIVED_CONTROLLER_USES_CURRENT_LEASE').input);
  record.lease.ownerId = 'different.runtime.owner';
  const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('LEASE_OWNER_NOT_CANONICAL_OWNER'));
});

test('a long-lived lease cannot retrospectively authorize effects from before acquisition', () => {
  const record = structuredClone(CANCELLATION_FIXTURES.find((entry) => entry.id === 'C07_LONG_LIVED_CONTROLLER_USES_CURRENT_LEASE').input);
  record.effect = {
    kind: 'LOCAL',
    initiatedAtMs: record.lease.acquiredAtMs - 3_000,
    committedAtMs: record.lease.acquiredAtMs - 2_000,
  };
  const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('LEASED_EFFECT_INITIATED_BEFORE_ACQUISITION'));
  assert.equal(assessment.mayInitiateNewLocalEffects, false);
});

test('late-result behavior is one exact retained-truth law identity', () => {
  assert.equal(makeCancellationEvidence().lateResultLaw, CANCELLATION_LATE_RESULT_LAW);
  const record = structuredClone(makeCancellationEvidence());
  record.lateResultLaw = 'discard all late facts and permit new work';
  const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'LATE_RESULT_LAW_INVALID'));
});

test('already-authorized risk reduction detach needs both registry and prior-authorization evidence', () => {
  const record = structuredClone(makeCancellationEvidence({
    operationClass: 'RISK_REDUCING_RECOVERY',
    detachedRecovery: {
      reason: 'ALREADY_AUTHORIZED_RISK_REDUCTION',
      operationRegistered: true,
      operationRegistryRef: 'synthetic.registry.risk-reduction',
      priorAuthorizationRef: 'synthetic.authorization.risk-reduction',
      operationClass: 'RISK_REDUCING_RECOVERY',
      canonicalOwner: 'canonical.control-plane.owner',
      fencedRecoveryContextId: 'synthetic.recovery-context.risk-reduction',
      leaseId: 'synthetic.detached-lease.risk-reduction',
      leaseOwner: 'canonical.control-plane.owner',
      fenceEpoch: 3,
      activeFenceEpoch: 3,
      leaseExpiresAtMs: FIXTURE_NOW_MS + 1_000,
      fenceObservedAtMs: FIXTURE_NOW_MS - 1,
      fenceMaxAgeMs: 5_000,
      fenceEvidenceRef: 'synthetic.detached-fence.risk-reduction',
    },
  }));
  record.detachedRecovery.priorAuthorizationRef = null;
  const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.contractIssues.some((issue) => issue.code === 'PRIOR_AUTHORIZATION_EVIDENCE_REQUIRED'));
});

test('a stale lease completion is rejected as authority and can never be applied', () => {
  const current = CANCELLATION_FIXTURES.find((entry) => entry.id === 'C07_LONG_LIVED_CONTROLLER_USES_CURRENT_LEASE');
  const record = structuredClone(current.input);
  record.lease.completionEpoch = record.lease.activeFenceEpoch - 1;
  record.lease.completionDisposition = 'APPLIED';
  let assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'FAIL');
  assert.ok(assessment.violationCodes.includes('STALE_COMPLETION_APPLIED_AFTER_HANDOFF'));

  record.lease.completionDisposition = 'REJECTED';
  assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
  assert.equal(assessment.assuranceResult, 'PASS');
  assert.equal(assessment.staleAuthorityRejected, true);
  assert.ok(assessment.reasonCodes.includes('STALE_COMPLETION_REJECTED_AS_AUTHORITY'));
});

test('detached recovery requires a current observed fence and an unexpired lease', () => {
  const fixture = CANCELLATION_FIXTURES.find((entry) => entry.id === 'C09_REGISTERED_FENCED_RECOVERY_SURVIVES_PARENT_TIMEOUT');
  const cases = [
    (record) => { record.detachedRecovery.activeFenceEpoch += 1; },
    (record) => { record.detachedRecovery.leaseExpiresAtMs = FIXTURE_NOW_MS; },
    (record) => { record.detachedRecovery.fenceObservedAtMs = FIXTURE_NOW_MS + 1; },
    (record) => { record.detachedRecovery.fenceObservedAtMs = FIXTURE_NOW_MS - record.detachedRecovery.fenceMaxAgeMs - 1; },
  ];
  for (const mutate of cases) {
    const record = structuredClone(fixture.input);
    mutate(record);
    const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(assessment.violationCodes.includes('DETACHED_RECOVERY_NOT_REGISTERED_OR_FENCED'));
  }
});

test('restart evidence is tied to request, cancellation context, and stable state digest', () => {
  const fixture = CANCELLATION_FIXTURES.find((entry) => entry.id === 'C11_RESTART_CANNOT_LOSE_LATE_RESULT_LAW');
  const valid = structuredClone(fixture.input);
  valid.restartEvidence.preservedLateResultLaw = true;
  const validAssessment = evaluateCancellationEvidence(valid, FIXTURE_NOW_MS);
  assert.equal(validAssessment.assuranceResult, 'PASS');
  assert.equal(validAssessment.lateResultLaw, valid.lateResultLaw);

  for (const mutate of [
    (record) => { record.restartEvidence.restoredRequestId = 'different.request'; },
    (record) => { record.restartEvidence.restoredCancellationContextId = 'different.cancel-context'; },
  ]) {
    const record = structuredClone(valid);
    mutate(record);
    const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(assessment.violationCodes.includes('RESTART_LOST_CANCELLATION_OR_LATE_RESULT_IDENTITY'));
  }

  const wrongDigest = structuredClone(valid);
  wrongDigest.restartEvidence.stateDigestAfterRestart = `sha256:${'0'.repeat(64)}`;
  const wrongDigestAssessment = evaluateCancellationEvidence(wrongDigest, FIXTURE_NOW_MS);
  assert.equal(wrongDigestAssessment.assuranceResult, 'FAIL');
  assert.ok(wrongDigestAssessment.contractIssues
    .some((issue) => issue.code === 'RESTART_CHECKPOINT_DIGEST_MISMATCH'));

  const wrongLaw = structuredClone(valid);
  wrongLaw.restartEvidence.restoredLateResultLaw = 'different late-result law';
  const wrongLawAssessment = evaluateCancellationEvidence(wrongLaw, FIXTURE_NOW_MS);
  assert.equal(wrongLawAssessment.assuranceResult, 'FAIL');
  assert.ok(wrongLawAssessment.contractIssues.some((issue) => issue.code === 'RESTORED_LATE_RESULT_LAW_INVALID'));

  for (const mutate of [
    (record) => { record.operationId = 'forged.operation'; },
    (record) => { record.canonicalOwner = 'forged.owner'; },
    (record) => { record.localDeadlineAtMs += 1_000; },
    (record) => { record.effect.initiatedAtMs = FIXTURE_NOW_MS - 1_000; },
    (record) => { record.restartEvidence.stateAfterRestart.effect.initiatedAtMs = FIXTURE_NOW_MS - 1_000; },
  ]) {
    const record = structuredClone(valid);
    mutate(record);
    const assessment = evaluateCancellationEvidence(record, FIXTURE_NOW_MS);
    assert.equal(assessment.assuranceResult, 'FAIL');
    assert.ok(
      assessment.contractIssues.some((issue) => issue.code === 'RESTART_STATE_SNAPSHOT_MISMATCH'),
      assessment.contractIssues.map((issue) => issue.code).join(','),
    );
  }

  const missingSnapshot = structuredClone(valid);
  missingSnapshot.restartEvidence.stateBeforeRestart = null;
  const missingAssessment = evaluateCancellationEvidence(missingSnapshot, FIXTURE_NOW_MS);
  assert.equal(missingAssessment.assuranceResult, 'FAIL');
  assert.ok(missingAssessment.contractIssues.some((issue) => issue.code === 'RESTART_STATE_SNAPSHOT_REQUIRED'));

  const unchangedDigestForgery = structuredClone(valid);
  for (const record of [
    unchangedDigestForgery,
    unchangedDigestForgery.restartEvidence.stateBeforeRestart,
    unchangedDigestForgery.restartEvidence.stateAfterRestart,
  ]) record.localDeadlineAtMs += 1_000;
  const unchangedDigestAssessment = evaluateCancellationEvidence(unchangedDigestForgery, FIXTURE_NOW_MS);
  assert.equal(unchangedDigestAssessment.assuranceResult, 'FAIL');
  assert.ok(unchangedDigestAssessment.contractIssues
    .some((issue) => issue.code === 'RESTART_CHECKPOINT_DIGEST_MISMATCH'));

  const recomputedDigestForgery = structuredClone(unchangedDigestForgery);
  const recomputedDigest = cancellationRestartDigest(
    recomputedDigestForgery.restartEvidence.checkpointRef,
    recomputedDigestForgery.restartEvidence.stateBeforeRestart,
  );
  recomputedDigestForgery.restartEvidence.stateDigestBeforeRestart = recomputedDigest;
  recomputedDigestForgery.restartEvidence.stateDigestAfterRestart = recomputedDigest;
  const recomputedDigestAssessment = evaluateCancellationEvidence(recomputedDigestForgery, FIXTURE_NOW_MS);
  assert.equal(recomputedDigestAssessment.assuranceResult, 'FAIL');
  assert.ok(recomputedDigestAssessment.violationCodes
    .includes('SYNTHETIC_RESTART_TRUST_BINDING_MISMATCH'));
});

test('cancellation evaluation snapshots once and rejects accessors without invoking them', () => {
  const accessorRecord = structuredClone(makeCancellationEvidence());
  let getterCalls = 0;
  Object.defineProperty(accessorRecord, 'localDeadlineAtMs', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return getterCalls < 7 ? FIXTURE_NOW_MS + 1_000 : FIXTURE_NOW_MS - 1;
    },
  });
  const rejected = evaluateCancellationEvidence(accessorRecord, FIXTURE_NOW_MS);
  assert.equal(rejected.assuranceResult, 'FAIL');
  assert.deepEqual(rejected.reasonCodes, ['CONTRACT_INVALID']);
  assert.ok(rejected.contractIssues.some((issue) => issue.code === 'PLAIN_DATA_SNAPSHOT_REQUIRED'));
  assert.equal(getterCalls, 0);

  const target = structuredClone(makeCancellationEvidence());
  let proxyGetCalls = 0;
  const proxy = new Proxy(target, {
    get(source, key, receiver) {
      proxyGetCalls += 1;
      return key === 'recordId' ? 'forged.after.validation' : Reflect.get(source, key, receiver);
    },
  });
  const captured = evaluateCancellationEvidence(proxy, FIXTURE_NOW_MS);
  assert.equal(captured.assuranceResult, 'PASS');
  assert.equal(captured.recordId, target.recordId);
  assert.equal(captured.sourceEvidence.recordId, target.recordId);
  assert.equal(proxyGetCalls, 0);

  const revoked = Proxy.revocable(structuredClone(makeCancellationEvidence()), {});
  revoked.revoke();
  const revokedAssessment = evaluateCancellationEvidence(revoked.proxy, FIXTURE_NOW_MS);
  assert.equal(revokedAssessment.assuranceResult, 'FAIL');
  assert.ok(revokedAssessment.contractIssues
    .some((issue) => issue.code === 'PLAIN_DATA_SNAPSHOT_REQUIRED'));
});
