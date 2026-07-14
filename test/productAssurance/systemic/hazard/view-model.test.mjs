import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXTURE_NOW_MS,
  buildCompleteHazardFixture,
  buildExpiredAssumptionFixture,
  buildHazardAssuranceViewModel,
  buildMissingAtlasRowFixture,
  buildPermutedFixture,
  canonicalStringify,
  validateHazardViewModel,
} from '../../../../fixtures/productAssurance/systemic/hazard/index.mjs';

test('render-neutral view model is valid, synthetic, and explicitly non-authoritative', () => {
  const view = buildHazardAssuranceViewModel(buildCompleteHazardFixture(), FIXTURE_NOW_MS);
  assert.deepEqual(validateHazardViewModel(view), []);
  assert.equal(view.assuranceProjectionStatus, 'PASS');
  assert.equal(view.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(view.authorityEffect, 'NONE');
  assert.equal(view.machineResponseOwner, 'CANONICAL_I00_DOMAIN_OWNERS');
  assert.equal(view.summary.activeHazardCount, 10);
  assert.equal(view.summary.unacceptableLossFamilyCount, 10);
  assert.equal(view.summary.assumptionCount, 9);
  assert.equal(view.summary.atlasExpectedCount, 54);
  assert.equal(view.summary.atlasCoveredCount, 54);
});

test('view model exposes progressive summary, annunciators, and drill-down records', () => {
  const view = buildHazardAssuranceViewModel(buildCompleteHazardFixture(), FIXTURE_NOW_MS);
  assert.deepEqual(view.annunciators.map((entry) => entry.annunciatorId), [
    'PA-S1-ANN-ASSUMPTIONS',
    'PA-S1-ANN-LOSSES',
    'PA-S1-ANN-ATLAS',
  ]);
  assert.ok(view.annunciators.every((entry) => entry.status === 'PASS' && entry.attentionRequired === false));
  assert.equal(view.hazards[0].hazardId, 'PA-S1-HZ-001');
  assert.equal(view.hazards[0].cockpitProjection.surface, 'RISK');
  assert.equal(view.assumptions[0].assumptionId, 'PA-S1-AS-001');
  assert.equal(view.atlas.operationCoverage.length, 6);
  assert.equal(view.atlas.failureFamilyCoverage.length, 9);
});

test('critical expired evidence remains UNKNOWN and visible', () => {
  const view = buildHazardAssuranceViewModel(buildExpiredAssumptionFixture(), FIXTURE_NOW_MS);
  assert.equal(view.assuranceProjectionStatus, 'UNKNOWN');
  assert.equal(view.summary.unknownAssumptionCount, 1);
  assert.ok(view.summary.invalidatedConsumerCount > 0);
  const assumption = view.assumptions.find((entry) => entry.assumptionId === 'PA-S1-AS-003');
  assert.equal(assumption?.result, 'UNKNOWN');
  assert.equal(assumption?.reasonCode, 'EXPIRED');
  const annunciator = view.annunciators.find((entry) => entry.annunciatorId === 'PA-S1-ANN-ASSUMPTIONS');
  assert.equal(annunciator?.attentionRequired, true);
});

test('missing expected Atlas row remains a visible denominator failure', () => {
  const view = buildHazardAssuranceViewModel(buildMissingAtlasRowFixture(), FIXTURE_NOW_MS);
  assert.deepEqual(validateHazardViewModel(view), []);
  assert.equal(view.assuranceProjectionStatus, 'FAIL');
  assert.equal(view.atlas.status, 'FAIL');
  assert.equal(view.atlas.expectedCount, 54);
  assert.equal(view.atlas.coveredCount, 53);
  assert.deepEqual(view.atlas.missingAtlasPairs, ['NON_IDEMPOTENT_MUTATION|PA-S1-FF-002']);
  const annunciator = view.annunciators.find((entry) => entry.annunciatorId === 'PA-S1-ANN-ATLAS');
  assert.equal(annunciator?.attentionRequired, true);
});

test('uncovered unacceptable-loss families make the top-level projection FAIL', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.hazards.find((hazard) => hazard.hazardId === 'PA-S1-HZ-009').active = false;
  const view = buildHazardAssuranceViewModel(fixture, FIXTURE_NOW_MS);
  assert.equal(view.assuranceProjectionStatus, 'FAIL');
  const annunciator = view.annunciators.find((entry) => entry.annunciatorId === 'PA-S1-ANN-LOSSES');
  assert.equal(annunciator?.status, 'FAIL');
  assert.equal(annunciator?.attentionRequired, true);
});

test('malformed packets render as a deterministic UNKNOWN projection instead of throwing', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.hazards[0].unsafeControlAction = null;
  const view = buildHazardAssuranceViewModel(fixture, FIXTURE_NOW_MS);
  assert.equal(view.assuranceProjectionStatus, 'UNKNOWN');
  assert.equal(view.hazards.length, 0);
  assert.ok(view.annunciators.every((entry) => entry.status === 'UNKNOWN'));
  assert.deepEqual(validateHazardViewModel(view), []);

  const nullHazardFixture = structuredClone(buildCompleteHazardFixture());
  nullHazardFixture.hazards[0] = null;
  assert.equal(buildHazardAssuranceViewModel(nullHazardFixture, FIXTURE_NOW_MS).assuranceProjectionStatus, 'UNKNOWN');

  const nullConsumerFixture = structuredClone(buildCompleteHazardFixture());
  nullConsumerFixture.assumptionConsumers[0] = null;
  assert.equal(buildHazardAssuranceViewModel(nullConsumerFixture, FIXTURE_NOW_MS).assuranceProjectionStatus, 'UNKNOWN');
});

test('view-model schema closes and bounds nested render data', () => {
  const view = structuredClone(buildHazardAssuranceViewModel(buildCompleteHazardFixture(), FIXTURE_NOW_MS));
  view.summary = { garbage: true };
  view.hazards = [null];
  view.atlas = {};
  const issues = validateHazardViewModel(view);
  assert.ok(issues.some((entry) => entry.code === 'SCHEMA_UNKNOWN_FIELD' && entry.path === '$.summary.garbage'));
  assert.ok(issues.some((entry) => entry.code === 'SCHEMA_TYPE' && entry.path === '$.hazards[0]'));
  assert.ok(issues.some((entry) => entry.code === 'SCHEMA_REQUIRED' && entry.path === '$.atlas.status'));
});

test('view construction does not freeze mutable packet objects', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  buildHazardAssuranceViewModel(fixture, FIXTURE_NOW_MS);
  assert.equal(Object.isFrozen(fixture.hazards[0].cockpitProjection), false);
  assert.equal(Object.isFrozen(fixture.hazards[0].ownerDisposition), false);
  assert.equal(Object.isFrozen(fixture.assumptions[0].consequence), false);
});

test('view model is deterministic under packet permutation', () => {
  const baseline = buildHazardAssuranceViewModel(buildCompleteHazardFixture(), FIXTURE_NOW_MS);
  const permuted = buildHazardAssuranceViewModel(buildPermutedFixture(), FIXTURE_NOW_MS);
  assert.equal(canonicalStringify(permuted), canonicalStringify(baseline));
});

test('view model contains no UI implementation or machine-readiness verdict', () => {
  const view = buildHazardAssuranceViewModel(buildCompleteHazardFixture(), FIXTURE_NOW_MS);
  const serialized = canonicalStringify(view);
  assert.equal(Object.hasOwn(view, 'tradeReady'), false);
  assert.equal(Object.hasOwn(view, 'machineReady'), false);
  assert.doesNotMatch(serialized, /#[0-9a-f]{3,8}|className|onClick|button|css/i);
});

test('view model is deeply frozen', () => {
  const view = buildHazardAssuranceViewModel(buildCompleteHazardFixture(), FIXTURE_NOW_MS);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.summary), true);
  assert.equal(Object.isFrozen(view.hazards), true);
  assert.equal(Object.isFrozen(view.atlas.operationCoverage), true);
  assert.throws(() => {
    view.annunciators.push({});
  }, TypeError);
});
