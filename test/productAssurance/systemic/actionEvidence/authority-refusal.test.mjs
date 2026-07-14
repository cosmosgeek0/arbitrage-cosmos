import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_EVIDENCE_USE_SCHEMA_VERSION,
  AUTHORITY_REFUSAL_FIXTURES,
  AUTHORITY_USE_PURPOSES,
  FIXTURE_NOW_MS,
  buildActionEvidenceEnvelope,
  buildAuthorityUseAttempts,
  buildForgedApprovalEnvelope,
  buildForgedAuthorityEffectEnvelope,
  buildForgedAuthorizationEnvelope,
  buildForgedBlockingEnvelope,
  buildForgedRankingEnvelope,
  buildPartialFillRateLimitedRecoveryFixture,
  buildStaleApprovalReplayFixture,
  buildStaleContradictionFixture,
  clonePlain,
  evaluateActionEvidenceEnvelope,
  projectSupportingEvidenceUse,
  validateActionEvidenceEnvelope,
  validateActionEvidenceResult,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';

const supportingRequest = (recordId) => ({
  schemaVersion: ACTION_EVIDENCE_USE_SCHEMA_VERSION,
  purpose: 'SUPPORTING_EVIDENCE_ONLY',
  consumerId: 'PA-S2-SYNTHETIC-REPORT-CONSUMER',
  recordId,
  canonicalOwnerDecisionIds: [],
});

test('all authority purposes have mandatory refusal fixtures', () => {
  assert.deepEqual(
    AUTHORITY_REFUSAL_FIXTURES.map((entry) => entry.request.purpose).sort(),
    [...AUTHORITY_USE_PURPOSES].sort(),
  );
});

test('approval, admission, blocking, ranking, execution, and dispatch attempts all throw', () => {
  const evaluation = evaluateActionEvidenceEnvelope(
    buildActionEvidenceEnvelope('ORDER_INTENT'),
    FIXTURE_NOW_MS,
  );
  const envelope = buildActionEvidenceEnvelope('ORDER_INTENT');
  for (const attempt of buildAuthorityUseAttempts(evaluation.recordId)) {
    assert.throws(
      () => projectSupportingEvidenceUse(envelope, FIXTURE_NOW_MS, attempt.request),
      (error) => error instanceof TypeError && error.code === attempt.expectedErrorCode,
      attempt.request.purpose,
    );
  }
});

test('authority refusal is status-independent for PASS, FAIL, and UNKNOWN evidence', () => {
  const envelopes = [
    buildActionEvidenceEnvelope('ORDER_INTENT'),
    buildPartialFillRateLimitedRecoveryFixture(),
    buildStaleContradictionFixture(),
  ];
  const evaluations = envelopes.map((envelope) => evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS));
  assert.deepEqual(evaluations.map((entry) => entry.status).sort(), ['FAIL', 'PASS', 'UNKNOWN']);

  for (const [index, evaluation] of evaluations.entries()) {
    for (const attempt of buildAuthorityUseAttempts(evaluation.recordId)) {
      assert.throws(
        () => projectSupportingEvidenceUse(envelopes[index], FIXTURE_NOW_MS, attempt.request),
        (error) => error?.code === 'ACTION_EVIDENCE_NOT_AUTHORITY',
      );
    }
  }
});

test('the sole legal projection preserves evidence status and emits no authority', () => {
  const envelope = buildActionEvidenceEnvelope('ORDER_INTENT');
  const evaluation = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  const projection = projectSupportingEvidenceUse(
    envelope,
    FIXTURE_NOW_MS,
    supportingRequest(evaluation.recordId),
  );
  assert.equal(projection.evidenceStatus, 'PASS');
  assert.equal(projection.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(projection.useClass, 'SUPPORTING_EVIDENCE_ONLY');
  assert.equal(projection.authorityEffect, 'NONE');
  assert.equal(projection.commandsIssued, 0);
  assert.equal(projection.evaluatedAtMs, FIXTURE_NOW_MS);
  assert.equal(projection.nextCurrentnessBoundaryAtMs, FIXTURE_NOW_MS + 4_501);
  for (const forbidden of ['approved', 'authorized', 'allow', 'block', 'rank', 'score', 'decision', 'execute', 'sendEligible']) {
    assert.equal(Object.hasOwn(projection, forbidden), false);
  }
});

test('malformed supporting-use requests fail closed', () => {
  const evaluation = evaluateActionEvidenceEnvelope(
    buildActionEvidenceEnvelope('ORDER_INTENT'),
    FIXTURE_NOW_MS,
  );
  const request = { ...supportingRequest(evaluation.recordId), approved: true };
  assert.throws(
    () => projectSupportingEvidenceUse(
      buildActionEvidenceEnvelope('ORDER_INTENT'),
      FIXTURE_NOW_MS,
      request,
    ),
    (error) => error?.code === 'ACTION_EVIDENCE_USE_INVALID',
  );

  const hiddenApproval = supportingRequest(evaluation.recordId);
  Object.defineProperty(hiddenApproval, 'approved', { value: true, enumerable: false });
  assert.throws(
    () => projectSupportingEvidenceUse(
      buildActionEvidenceEnvelope('ORDER_INTENT'),
      FIXTURE_NOW_MS,
      hiddenApproval,
    ),
    (error) => error?.code === 'ACTION_EVIDENCE_USE_INVALID',
  );

  const accessor = supportingRequest(evaluation.recordId);
  Object.defineProperty(accessor, 'recordId', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.throws(
    () => projectSupportingEvidenceUse(
      buildActionEvidenceEnvelope('ORDER_INTENT'),
      FIXTURE_NOW_MS,
      accessor,
    ),
    (error) => error?.code === 'ACTION_EVIDENCE_USE_INVALID',
  );
});

test('supporting-use requests are snapshotted before iterable consumption', () => {
  const envelope = buildActionEvidenceEnvelope('ORDER_INTENT');
  const request = supportingRequest(envelope.record.recordId);
  request.canonicalOwnerDecisionIds = new Proxy([], {
    get(target, key, receiver) {
      if (key === Symbol.iterator) {
        const error = new Error('hostile iterator must never run');
        error.code = 'HOSTILE';
        throw error;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const projection = projectSupportingEvidenceUse(envelope, FIXTURE_NOW_MS, request);
  assert.equal(projection.evidenceStatus, 'PASS');
  assert.deepEqual(projection.canonicalOwnerDecisionIds, []);

  let purposeReads = 0;
  const togglingRequest = new Proxy(supportingRequest(envelope.record.recordId), {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (key !== 'purpose') return descriptor;
      purposeReads += 1;
      return {
        ...descriptor,
        value: purposeReads === 1 ? 'SUPPORTING_EVIDENCE_ONLY' : 'APPROVAL',
      };
    },
  });
  assert.throws(
    () => projectSupportingEvidenceUse(envelope, FIXTURE_NOW_MS, togglingRequest),
    (error) => error?.code === 'ACTION_EVIDENCE_NOT_AUTHORITY',
  );
});

test('projection cannot invent canonical owner decision references', () => {
  const envelope = buildActionEvidenceEnvelope('ORDER_INTENT');
  const request = supportingRequest(envelope.record.recordId);
  request.canonicalOwnerDecisionIds = ['invented_capital_approval_001'];
  assert.throws(
    () => projectSupportingEvidenceUse(envelope, FIXTURE_NOW_MS, request),
    (error) => error?.code === 'ACTION_EVIDENCE_USE_INVALID',
  );

  const staleReplay = buildStaleApprovalReplayFixture();
  const staleRequest = supportingRequest(staleReplay.record.recordId);
  staleRequest.canonicalOwnerDecisionIds = staleReplay.record.ownerReferences
    .map((reference) => reference.referenceId);
  assert.throws(
    () => projectSupportingEvidenceUse(staleReplay, FIXTURE_NOW_MS, staleRequest),
    (error) => error?.code === 'ACTION_EVIDENCE_USE_INVALID',
  );
});

test('schema-invalid envelopes and invalid clocks cannot produce even a supporting projection', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  envelope.record.actionFacts.ownerDecisionReferenceState = 'CURRENT_EXACT_SUBJECT';
  envelope.record.ownerReferences.push({
    sourceRole: 'OWNER_DECISION',
    ownerId: 'PA-S2-SHADOW-APPROVER',
    referenceId: 'forged_owner_decision_001',
    revision: 'forged_owner_decision_revision_001',
    digest: 'a'.repeat(64),
    observedAtMs: FIXTURE_NOW_MS - 100,
    maximumAgeMs: 5_000,
    expiresAtMs: FIXTURE_NOW_MS + 10_000,
    binding: {
      subjectDigest: envelope.record.subjectDigest,
      releaseId: envelope.record.versions.releaseId,
      policyRevision: envelope.record.versions.policyRevision,
      authorityMapCommit: envelope.record.versions.authorityMapCommit,
    },
  });
  const forgedRequest = supportingRequest(envelope.record.recordId);
  forgedRequest.canonicalOwnerDecisionIds = ['forged_owner_decision_001'];
  assert.throws(
    () => projectSupportingEvidenceUse(envelope, FIXTURE_NOW_MS, forgedRequest),
    (error) => error?.code === 'ACTION_EVIDENCE_USE_INVALID',
  );

  const valid = buildActionEvidenceEnvelope('ORDER_INTENT');
  for (const nowMs of [null, 0, Number.NaN]) {
    assert.throws(
      () => projectSupportingEvidenceUse(
        valid,
        nowMs,
        supportingRequest(valid.record.recordId),
      ),
      (error) => error?.code === 'ACTION_EVIDENCE_USE_INVALID',
    );
  }

  const sparseRequest = supportingRequest(valid.record.recordId);
  sparseRequest.canonicalOwnerDecisionIds = Array(1);
  assert.throws(
    () => projectSupportingEvidenceUse(valid, FIXTURE_NOW_MS, sparseRequest),
    (error) => error?.code === 'ACTION_EVIDENCE_USE_INVALID',
  );
});

test('result validator rejects forged shallow and altered PASS objects', () => {
  const envelope = buildActionEvidenceEnvelope('ORDER_INTENT');
  const valid = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.deepEqual(validateActionEvidenceResult(valid), { valid: true, issues: [] });

  const mutations = [
    (result) => { result.familyResults = []; },
    (result) => { result.status = 'FAIL'; },
    (result) => { result.commandsIssued = 1; },
    (result) => { result.canonicalRiskReductionUnaffected = false; },
    (result) => { result.approved = true; },
  ];
  for (const mutate of mutations) {
    const forged = clonePlain(valid);
    mutate(forged);
    assert.equal(validateActionEvidenceResult(forged).valid, false);
  }

  const contradictoryPass = clonePlain(valid);
  contradictoryPass.familyResults[0].reasonCodes = ['EVIDENCE_CONTRADICTED'];
  contradictoryPass.reasonCodes = [...new Set(contradictoryPass.familyResults
    .flatMap((entry) => entry.reasonCodes)
    .concat(contradictoryPass.assumptionResults.flatMap((entry) => entry.reasonCodes))
    .concat(contradictoryPass.invariantResults.flatMap((entry) => entry.reasonCodes)))].sort();
  assert.equal(validateActionEvidenceResult(contradictoryPass).valid, false);

  const malformedDiagnostic = clonePlain(evaluateActionEvidenceEnvelope({}, FIXTURE_NOW_MS));
  malformedDiagnostic.recordId = { evil: true };
  malformedDiagnostic.actionClass = 123;
  malformedDiagnostic.evaluatedAtMs = 'bad';
  assert.equal(validateActionEvidenceResult(malformedDiagnostic).valid, false);

  const forgedFailDiagnostic = clonePlain(evaluateActionEvidenceEnvelope({}, FIXTURE_NOW_MS));
  forgedFailDiagnostic.status = 'FAIL';
  assert.equal(validateActionEvidenceResult(forgedFailDiagnostic).valid, false);

  const forgedPassReasonDiagnostic = clonePlain(evaluateActionEvidenceEnvelope({}, FIXTURE_NOW_MS));
  forgedPassReasonDiagnostic.reasonCodes.push('EVIDENCE_SATISFIED');
  assert.equal(validateActionEvidenceResult(forgedPassReasonDiagnostic).valid, false);

  const failWithPassOutcome = clonePlain(valid);
  failWithPassOutcome.familyResults[0].status = 'FAIL';
  failWithPassOutcome.familyResults[0].reasonCodes = [
    'EVIDENCE_CONTRADICTED',
    'EVIDENCE_SATISFIED',
  ];
  failWithPassOutcome.status = 'FAIL';
  failWithPassOutcome.reasonCodes = [...new Set(failWithPassOutcome.familyResults
    .flatMap((entry) => entry.reasonCodes)
    .concat(failWithPassOutcome.assumptionResults.flatMap((entry) => entry.reasonCodes))
    .concat(failWithPassOutcome.invariantResults.flatMap((entry) => entry.reasonCodes)))].sort();
  assert.equal(validateActionEvidenceResult(failWithPassOutcome).valid, false);
});

test('projection no longer accepts caller-supplied evaluation objects', () => {
  const evaluation = evaluateActionEvidenceEnvelope(
    buildActionEvidenceEnvelope('ORDER_INTENT'),
    FIXTURE_NOW_MS,
  );
  assert.throws(
    () => projectSupportingEvidenceUse(evaluation, supportingRequest(evaluation.recordId)),
    (error) => error?.code === 'ACTION_EVIDENCE_USE_INVALID',
  );
});

test('forged authority-bearing envelopes are schema-invalid and never PASS', () => {
  const forged = [
    buildForgedApprovalEnvelope(),
    buildForgedBlockingEnvelope(),
    buildForgedRankingEnvelope(),
    buildForgedAuthorizationEnvelope(),
    buildForgedAuthorityEffectEnvelope(),
  ];
  for (const envelope of forged) {
    const validation = validateActionEvidenceEnvelope(envelope);
    assert.equal(validation.valid, false);
    assert.notEqual(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');
  }
});
