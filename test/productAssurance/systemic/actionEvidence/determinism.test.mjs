import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIXTURE_NOW_MS,
  MANDATORY_SECTION_3_COUNTEREXAMPLES,
  buildActionEvidenceEnvelope,
  canonicalStringify,
  clonePlain,
  evaluateActionEvidenceEnvelope,
} from '../../../../fixtures/productAssurance/systemic/actionEvidence/index.mjs';

const assertDeepFrozen = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
};

test('repeated evaluation is byte-identical and deeply frozen', () => {
  const envelope = buildActionEvidenceEnvelope('ORDER_INTENT');
  const first = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  const second = evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assertDeepFrozen(first);
});
test('family and source input order cannot perturb canonical output', () => {
  const canonical = buildActionEvidenceEnvelope('ORDER_INTENT');
  const reordered = clonePlain(canonical);
  reordered.record.families.reverse();
  reordered.record.temporalContext.sources.reverse();

  assert.equal(
    JSON.stringify(evaluateActionEvidenceEnvelope(canonical, FIXTURE_NOW_MS)),
    JSON.stringify(evaluateActionEvidenceEnvelope(reordered, FIXTURE_NOW_MS)),
  );
});

test('evaluation does not mutate caller-owned plain data', () => {
  const envelope = clonePlain(buildActionEvidenceEnvelope('RECOVERY_STEP'));
  const before = canonicalStringify(envelope);
  evaluateActionEvidenceEnvelope(envelope, FIXTURE_NOW_MS);
  assert.equal(canonicalStringify(envelope), before);
});

test('canonical stringify is independent of object insertion order', () => {
  assert.equal(
    canonicalStringify({ z: 1, nested: { b: 2, a: 1 }, a: 0 }),
    canonicalStringify({ a: 0, nested: { a: 1, b: 2 }, z: 1 }),
  );
});

test('mandatory hostile fixtures are deeply immutable and repeatable', () => {
  assertDeepFrozen(MANDATORY_SECTION_3_COUNTEREXAMPLES);
  for (const entry of MANDATORY_SECTION_3_COUNTEREXAMPLES) {
    const first = evaluateActionEvidenceEnvelope(entry.envelope, FIXTURE_NOW_MS);
    const second = evaluateActionEvidenceEnvelope(entry.envelope, FIXTURE_NOW_MS);
    assert.equal(JSON.stringify(first), JSON.stringify(second), entry.fixtureId);
  }
});
