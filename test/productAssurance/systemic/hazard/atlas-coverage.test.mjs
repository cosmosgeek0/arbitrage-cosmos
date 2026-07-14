import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXTURE_NOW_MS,
  buildCompleteHazardFixture,
  buildDuplicateAtlasRowFixture,
  buildForeignAtlasRowFixture,
  buildMissingAtlasDecisionFixture,
  buildMissingAtlasRowFixture,
  buildPermutedFixture,
  buildUnreviewedAtlasFixture,
  canonicalStringify,
  computeAtlasDenominatorFingerprint,
  evaluateFailureAtlasCoverage,
  validateHazardAssurancePacket,
} from '../../../../fixtures/productAssurance/systemic/hazard/index.mjs';

test('coverage uses the finite expected release denominator, never reporter count', () => {
  const result = evaluateFailureAtlasCoverage(buildCompleteHazardFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'PASS');
  assert.equal(result.sourceBasis, 'EXPECTED_RELEASE_MANIFEST');
  assert.equal(result.reviewState, 'OWNER_REVIEWED');
  assert.equal(result.expectedCount, 54);
  assert.equal(result.coveredCount, 54);
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.operationCoverage.length, 6);
  assert.equal(result.failureFamilyCoverage.length, 9);
});

test('one missing Atlas row fails exact denominator coverage', () => {
  const result = evaluateFailureAtlasCoverage(buildMissingAtlasRowFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.expectedCount, 54);
  assert.equal(result.coveredCount, 53);
  assert.deepEqual(result.missingAtlasPairs, ['NON_IDEMPOTENT_MUTATION|PA-S1-FF-002']);
  assert.ok(result.reasonCodes.includes('EXPECTED_ATLAS_ROW_MISSING'));
  assert.equal(result.coverageComplete, false);
});

test('a missing expected decision cannot silently shrink the reviewed grid', () => {
  const result = evaluateFailureAtlasCoverage(buildMissingAtlasDecisionFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.missingDecisionPairs, ['RISK_REDUCING_RECOVERY|PA-S1-FF-009']);
  assert.ok(result.reasonCodes.includes('EXPECTED_GRID_DECISION_MISSING'));
  assert.equal(result.expectedCount, 54);
  assert.equal(result.coveredCount, 53);
  assert.equal(result.coveragePercent, null);
  assert.equal(result.coverageComplete, false);
});

test('unreviewed denominator is UNKNOWN even when every synthetic row exists', () => {
  const result = evaluateFailureAtlasCoverage(buildUnreviewedAtlasFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reviewState, 'UNKNOWN');
  assert.equal(result.expectedCount, 54);
  assert.equal(result.coveredCount, 54);
  assert.equal(result.coverageComplete, null);
  assert.ok(result.reasonCodes.includes('OWNER_REVIEW_MISSING_OR_INCOHERENT'));
});

test('duplicate rows cannot inflate the numerator', () => {
  const result = evaluateFailureAtlasCoverage(buildDuplicateAtlasRowFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.expectedCount, 54);
  assert.equal(result.coveredCount, 54);
  assert.deepEqual(result.duplicateAtlasPairs, ['PURE_READ|PA-S1-FF-001']);
  assert.ok(result.reasonCodes.includes('EXPECTED_ATLAS_ROW_DUPLICATED'));
});

test('foreign Atlas rows are reported but never counted', () => {
  const result = evaluateFailureAtlasCoverage(buildForeignAtlasRowFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.expectedCount, 54);
  assert.equal(result.coveredCount, 54);
  assert.deepEqual(result.unexpectedAtlasPairs, ['PURE_READ|PA-S1-FF-999']);
  assert.ok(result.reasonCodes.includes('ATLAS_ROW_OUTSIDE_EXPECTED_DENOMINATOR'));
  assert.ok(result.reasonCodes.includes('PACKET_INVALID'));
});

test('declared live-operation inventory cannot self-shrink the canonical denominator', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.atlasManifest.liveOperationClasses = ['PURE_READ'];
  fixture.atlasManifest.coverageDecisions = fixture.atlasManifest.coverageDecisions.filter(
    (decision) => decision.operationClass === 'PURE_READ',
  );
  fixture.atlasRows = fixture.atlasRows.filter((row) => row.operationClass === 'PURE_READ');
  const result = evaluateFailureAtlasCoverage(fixture, FIXTURE_NOW_MS);
  assert.notEqual(result.status, 'PASS');
  assert.deepEqual(result.liveOperationClasses, [
    'PURE_READ',
    'REPLAYABLE_SUBSCRIPTION',
    'IDEMPOTENT_COMMAND',
    'NON_IDEMPOTENT_MUTATION',
    'MULTI_LEG_SAGA',
    'RISK_REDUCING_RECOVERY',
  ]);
  assert.equal(result.missingOperationClasses.length, 5);
  assert.equal(result.expectedCount, 54);
});

test('foreign-release rows make the packet unknown instead of disappearing from coverage', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.atlasRows.push({
    ...fixture.atlasRows[0],
    atlasRowId: 'PA-S1-FA-FOREIGN-RELEASE',
    releaseId: 'PA-S1-OTHER-RELEASE',
    reproduction: { fixtureId: 'PA-S1-FX-ATLAS-FOREIGN-RELEASE', exactGap: null },
  });
  fixture.fixtureRegistry.push({
    ...fixture.fixtureRegistry.find((registration) => registration.targetId === 'PA-S1-FA-PR-001'),
    fixtureId: 'PA-S1-FX-ATLAS-FOREIGN-RELEASE',
    targetId: 'PA-S1-FA-FOREIGN-RELEASE',
  });
  const result = evaluateFailureAtlasCoverage(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.reasonCodes.includes('PACKET_INVALID'));
  assert.ok(result.packetIssues.some((entry) => entry.code === 'RELEASE_ID_MISMATCH'));
});

test('owner review remains bound to the exact accepted release identity', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.release.releaseId = 'PA-S1-FIXTURE-RELEASE-002';
  fixture.atlasManifest.releaseId = fixture.release.releaseId;
  fixture.atlasRows.forEach((row) => {
    row.releaseId = fixture.release.releaseId;
  });
  const result = evaluateFailureAtlasCoverage(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.packetIssues.some((entry) => entry.code === 'OWNER_REVIEW_BINDING_MISMATCH'));
});

test('unknown-family decisions cannot be filtered into a PASS', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.atlasManifest.coverageDecisions.push({
    decisionId: 'PA-S1-AD-UNKNOWN-FAMILY',
    operationClass: 'PURE_READ',
    failureFamilyId: 'PA-S1-FF-999',
    disposition: 'NOT_APPLICABLE',
    rationale: 'Outside the registered release family inventory.',
  });
  const result = evaluateFailureAtlasCoverage(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.packetIssues.some((entry) => entry.code === 'FAILURE_FAMILY_REFERENCE_UNKNOWN'));
});

test('zero reporters remains zero of the expected denominator, not vacuous green', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.atlasRows = [];
  fixture.fixtureRegistry = fixture.fixtureRegistry.filter((registration) => registration.fixtureKind !== 'ATLAS_REPRODUCTION');
  const result = evaluateFailureAtlasCoverage(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.expectedCount, 54);
  assert.equal(result.coveredCount, 0);
  assert.equal(result.coveragePercent, 0);
  assert.equal(result.missingAtlasPairs.length, 54);
});

test('owner-reviewed NOT_APPLICABLE decision adjudicates a pair without forcing a cross-product row', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.atlasManifest.coverageDecisions = fixture.atlasManifest.coverageDecisions.map((decision) => (
    decision.decisionId === 'PA-S1-AD-PR-002'
      ? { ...decision, disposition: 'NOT_APPLICABLE', rationale: 'Synthetic contract fixture: this release has no exchange-mutation outcome in its PURE_READ instance.' }
      : decision
  ));
  fixture.atlasRows = fixture.atlasRows.filter((row) => row.atlasRowId !== 'PA-S1-FA-PR-002');
  fixture.fixtureRegistry = fixture.fixtureRegistry.filter((registration) => registration.targetId !== 'PA-S1-FA-PR-002');
  fixture.atlasManifest.denominatorFingerprint = computeAtlasDenominatorFingerprint(
    fixture.atlasManifest.liveOperationClasses,
    fixture.atlasManifest.coverageDecisions,
  );
  fixture.atlasManifest.review.reviewedDenominatorFingerprint = fixture.atlasManifest.denominatorFingerprint;
  assert.deepEqual(validateHazardAssurancePacket(fixture), []);
  const result = evaluateFailureAtlasCoverage(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'PASS');
  assert.equal(result.expectedCount, 53);
  assert.equal(result.coveredCount, 53);
  assert.equal(result.coveragePercent, 100);
});

test('UNTESTED row with an exact proof gap is represented, not mislabeled observed', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.atlasRows[0] = {
    ...fixture.atlasRows[0],
    evidenceState: 'UNTESTED',
    reproduction: {
      fixtureId: null,
      exactGap: 'Canonical owner has not supplied the release-specific reproduction fixture.',
    },
  };
  fixture.fixtureRegistry = fixture.fixtureRegistry.filter((registration) => registration.targetId !== 'PA-S1-FA-PR-001');
  assert.deepEqual(validateHazardAssurancePacket(fixture), []);
  const result = evaluateFailureAtlasCoverage(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'PASS');
  assert.equal(result.coveredCount, 54);
});

test('permutation cannot change the stable denominator report', () => {
  const baseline = evaluateFailureAtlasCoverage(buildCompleteHazardFixture(), FIXTURE_NOW_MS);
  const permuted = evaluateFailureAtlasCoverage(buildPermutedFixture(), FIXTURE_NOW_MS);
  assert.equal(canonicalStringify(permuted), canonicalStringify(baseline));
});
