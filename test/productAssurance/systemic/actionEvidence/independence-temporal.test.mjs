import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIXTURE_NOW_MS,
  buildActionEvidenceEnvelope,
  buildFreshButIncoherentFixture,
  buildMissingVerifierFixture,
  buildProducerVerifierCollisionFixture,
  clonePlain,
  evaluateActionEvidenceEnvelope,
  validateActionEvidenceEnvelope,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';

const family = (envelope, familyName) => (
  envelope.record.families.find((entry) => entry.family === familyName)
);

test('producer and verifier actor collision is an explicit FAIL', () => {
  const envelope = buildProducerVerifierCollisionFixture();
  assert.deepEqual(validateActionEvidenceEnvelope(envelope), { valid: true, issues: [] });
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert(result.reasonCodes.includes('PRODUCER_VERIFIER_NOT_INDEPENDENT'));
});
test('missing independent verifier is UNKNOWN rather than PASS', () => {
  const envelope = buildMissingVerifierFixture();
  assert.deepEqual(validateActionEvidenceEnvelope(envelope), { valid: true, issues: [] });
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('INDEPENDENT_VERIFIER_MISSING'));
});

test('every baseline family names distinct producer and verifier actors', () => {
  for (const actionClass of ['ORDER_INTENT', 'CANCELLATION', 'REPAIR_STEP', 'HALT', 'RECOVERY_STEP']) {
    for (const entry of buildActionEvidenceEnvelope(actionClass).record.families) {
      assert.notEqual(entry.producedBy.actorId, entry.verifiedBy.actorId);
      assert.equal(entry.producedBy.role, 'PRODUCER');
      assert.equal(entry.verifiedBy.role, 'VERIFIER');
    }
  }
});

test('individually fresh but mutually incoherent sources are UNKNOWN', () => {
  const result = evaluateActionEvidenceEnvelope(buildFreshButIncoherentFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('TEMPORAL_SKEW_EXCEEDED'));
});

test('temporal skew is accepted at the exact bound and UNKNOWN beyond it', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
  envelope.record.temporalContext.maximumPairwiseSkewMs = 100;
  assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');

  envelope.record.temporalContext.maximumPairwiseSkewMs = 99;
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('TEMPORAL_SKEW_EXCEEDED'));
});

test('sequence gaps, unbounded clocks, and misordered timestamps each force UNKNOWN', () => {
  const mutators = [
    (envelope) => { envelope.record.temporalContext.sources[0].sequenceGap = 'PRESENT'; },
    (envelope) => { envelope.record.temporalContext.sources[0].clockQuality = 'UNBOUNDED'; },
    (envelope) => {
      const source = envelope.record.temporalContext.sources[0];
      source.receivedAtMs = source.eventAtMs - 1;
    },
  ];

  for (const mutate of mutators) {
    const envelope = clonePlain(buildActionEvidenceEnvelope('ORDER_INTENT'));
    mutate(envelope);
    assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'UNKNOWN');
  }
});

test('invalid evaluation clocks are explicit UNKNOWN with no fabricated timestamp', () => {
  const envelope = buildActionEvidenceEnvelope('ORDER_INTENT');
  for (const nowMs of [null, 0, Number.NaN, '1800000000000']) {
    const result = evaluateActionEvidenceEnvelope(envelope, nowMs);
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.evaluatedAtMs, null);
    assert.deepEqual(result.reasonCodes, ['EVALUATION_TIME_INVALID']);
  }
});

test('future record and family truth cannot be consumed early', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('HALT'));
  envelope.record.createdAtMs = FIXTURE_NOW_MS + 1;
  for (const entry of envelope.record.families) {
    entry.producedAtMs = FIXTURE_NOW_MS + 1;
    entry.verifiedAtMs = FIXTURE_NOW_MS + 2;
  }
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('EVIDENCE_NOT_YET_VALID'));
});
