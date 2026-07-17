import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIXTURE_NOW_MS,
  buildActionEvidenceEnvelope,
  buildDependencyCycleFixture,
  buildDirectInvalidationFixture,
  buildStaleContradictionFixture,
  clonePlain,
  evaluateActionEvidenceEnvelope,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';

const familyResult = (result, family) => (
  result.familyResults.find((entry) => entry.family === family)
);

test('maximum-age boundary is current through the limit and UNKNOWN immediately after it', () => {
  const envelope = buildActionEvidenceEnvelope('HALT');
  assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS + 4_500).status, 'PASS');

  const stale = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS + 4_501);
  assert.equal(stale.status, 'UNKNOWN');
  assert(stale.reasonCodes.includes('EVIDENCE_STALE'));
});
test('expiry boundary is exclusive and can never retain PASS', () => {
  const envelope = buildActionEvidenceEnvelope('HALT');
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS + 30_000);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('EVIDENCE_EXPIRED'));
});

test('a stale contradiction degrades to UNKNOWN instead of preserving a historical FAIL', () => {
  const result = evaluateActionEvidenceEnvelope(buildStaleContradictionFixture(), FIXTURE_NOW_MS);
  const binding = familyResult(result, 'ACTION_BINDING');
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(binding.status, 'UNKNOWN');
  assert(binding.reasonCodes.includes('EVIDENCE_STALE'));
  assert.equal(binding.reasonCodes.includes('EVIDENCE_CONTRADICTED'), false);
  assert.equal(binding.reasonCodes.includes('PREVIOUS_BINDING_CONTRADICTION'), false);
});

test('active invalidation propagates only through record-local evidence dependencies', () => {
  const envelope = buildDirectInvalidationFixture();
  const targetId = envelope.record.families
    .find((entry) => entry.family === 'ACTION_BINDING').evidenceIds[0];
  const result = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);

  assert.equal(result.status, 'UNKNOWN');
  assert.deepEqual(result.invalidatedEvidenceIds, [targetId]);
  assert.equal(familyResult(result, 'ACTION_BINDING').status, 'UNKNOWN');
  assert.equal(familyResult(result, 'FENCING_AND_IDEMPOTENCY').status, 'UNKNOWN');
  assert.equal(familyResult(result, 'FRESHNESS_AND_TEMPORAL_COHERENCE').status, 'PASS');
  assert(familyResult(result, 'FENCING_AND_IDEMPOTENCY').reasonCodes.includes('EVIDENCE_DEPENDENCY_UNKNOWN'));
});

test('future invalidation is inactive before its timestamp and active at the timestamp', () => {
  const envelope = clonePlain(buildDirectInvalidationFixture());
  envelope.record.invalidations[0].invalidatedAtMs = FIXTURE_NOW_MS + 1;

  assert.equal(evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS).status, 'PASS');
  const active = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS + 1);
  assert.equal(active.status, 'UNKNOWN');
  assert(active.reasonCodes.includes('EVIDENCE_INVALIDATED'));
});

test('record-local dependency cycles are explicit UNKNOWN, never recursively false-green', () => {
  const result = evaluateActionEvidenceEnvelope(buildDependencyCycleFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('EVIDENCE_DEPENDENCY_CYCLE'));
});
