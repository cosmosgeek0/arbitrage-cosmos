import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIXTURE_NOW_MS,
  MANDATORY_SECTION_3_COUNTEREXAMPLES,
  buildChangedTruthAfterProposalFixture,
  buildExpiredBackupPathFixture,
  buildLateFillAfterCancelFixture,
  buildLeaseLossBeforeAcknowledgementFixture,
  buildMissingRegisteredFallbackFixture,
  buildPartialFillRateLimitedRecoveryFixture,
  buildPassWithoutCanonicalOwnerDecisionFixture,
  buildStaleApprovalReplayFixture,
  buildUnboundedLiabilityFixture,
  evaluateActionEvidenceEnvelope,
  validateActionEvidenceEnvelope,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';

test('all ten mandatory IP_ASSURANCE section 3 counterexamples are unique and executable', () => {
  assert.equal(MANDATORY_SECTION_3_COUNTEREXAMPLES.length, 10);
  assert.equal(new Set(MANDATORY_SECTION_3_COUNTEREXAMPLES.map((entry) => entry.fixtureId)).size, 10);
  assert.equal(new Set(MANDATORY_SECTION_3_COUNTEREXAMPLES.map((entry) => entry.requirement)).size, 10);

  for (const counterexample of MANDATORY_SECTION_3_COUNTEREXAMPLES) {
    const actual = evaluateActionEvidenceEnvelope(counterexample.envelope, FIXTURE_NOW_MS);
    assert.equal(actual.status, counterexample.expectedStatus, counterexample.fixtureId);
    assert.equal(actual.authorityEffect, 'NONE');
    assert.equal(actual.commandsIssued, 0);
  }
});

test('owner truth changes propagate as invalidation UNKNOWN', () => {
  const result = evaluateActionEvidenceEnvelope(buildChangedTruthAfterProposalFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('EVIDENCE_INVALIDATED'));
});

test('current rate-limited recovery and missing registered fallback contradictions FAIL', () => {
  const cases = [
    [buildPartialFillRateLimitedRecoveryFixture(), 'PARTIAL_FILL_RECOVERY_RATE_LIMITED'],
    [buildMissingRegisteredFallbackFixture(), 'OWNER_REGISTERED_FALLBACK_MISSING'],
  ];
  for (const [envelope, reason] of cases) {
    assert(envelope.record.families.every((entry) => entry.assertion === 'SATISFIED'));
    assert(envelope.record.families.every((entry) => (
      entry.reasonCodes.length === 1 && entry.reasonCodes[0] === 'CURRENT_SYNTHETIC_FIXTURE'
    )));
    const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
    assert.equal(result.status, 'FAIL');
    assert(result.reasonCodes.includes(reason));
  }
});

test('lease loss and late fill after cancellation are current FAIL evidence', () => {
  const cases = [
    [buildLeaseLossBeforeAcknowledgementFixture(), 'LEASE_LOST_BEFORE_ACKNOWLEDGEMENT'],
    [buildLateFillAfterCancelFixture(), 'LATE_FILL_AFTER_CANCEL_TIMEOUT'],
  ];
  for (const [envelope, reason] of cases) {
    assert(envelope.record.families.every((entry) => entry.assertion === 'SATISFIED'));
    const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
    assert.equal(result.status, 'FAIL');
    assert(result.reasonCodes.includes(reason));
  }
});

test('stale replay, expired backup, and unbounded liability never pass', () => {
  const cases = [
    [buildStaleApprovalReplayFixture(), 'UNKNOWN'],
    [buildExpiredBackupPathFixture(), 'UNKNOWN'],
    [buildUnboundedLiabilityFixture(), 'UNKNOWN'],
  ];
  for (const [envelope, expected] of cases) {
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, expected);
  }
});

test('stale owner-decision replay is schema-valid but subject-mismatched UNKNOWN evidence', () => {
  const envelope = buildStaleApprovalReplayFixture();
  assert.deepEqual(validateActionEvidenceEnvelope(envelope), { valid: true, issues: [] });
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  const binding = result.familyResults.find((entry) => entry.family === 'ACTION_BINDING');
  assert.equal(binding.status, 'UNKNOWN');
  assert(binding.reasonCodes.includes('OWNER_REFERENCE_STALE'));
  assert(binding.reasonCodes.includes('OWNER_DECISION_REFERENCE_SUBJECT_MISMATCH'));
});

test('PASS with no canonical owner decision remains only an evidence status', () => {
  const envelope = buildPassWithoutCanonicalOwnerDecisionFixture();
  assert.deepEqual(envelope.record.ownerReferences, []);
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'PASS');
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(result.canonicalRiskReductionUnaffected, true);
});
