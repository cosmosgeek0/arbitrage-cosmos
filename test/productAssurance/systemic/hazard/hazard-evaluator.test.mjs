import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXTURE_NOW_MS,
  buildCompleteHazardFixture,
  buildContradictedAssumptionFixture,
  buildExpiredAssumptionFixture,
  buildMissingAssumptionFixture,
  buildPermutedFixture,
  canonicalStringify,
  evaluateAssumptionAt,
  evaluateHazardAssurance,
} from '../../../../fixtures/productAssurance/systemic/hazard/index.mjs';

test('complete finite registry passes without acquiring machine authority', () => {
  const result = evaluateHazardAssurance(buildCompleteHazardFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'PASS');
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(result.machineResponseOwner, 'CANONICAL_I00_DOMAIN_OWNERS');
  assert.deepEqual(result.registryCoverage.unregisteredAssumptionIds, []);
  assert.deepEqual(result.lossFamilyCoverage.uncoveredLossFamilyIds, []);
  assert.equal(result.assumptionResults.length, 9);
  assert.equal(result.hazardResults.length, 10);
  assert.deepEqual(result.invalidatedConsumers, []);
});

test('unregistered assumption is a fail-closed coverage failure with exact consumers', () => {
  const result = evaluateHazardAssurance(buildMissingAssumptionFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.registryCoverage.unregisteredAssumptionIds, ['PA-S1-AS-003']);
  assert.ok(result.reasonCodes.includes('ASSUMPTION_REGISTRY_COVERAGE_FAILURE'));
  assert.ok(result.invalidatedAssuranceClaimIds.includes('PA-S1-CONS-CLAIM-001'));
  assert.deepEqual(
    result.invalidatedConsumers.find((consumer) => consumer.consumerId === 'PA-S1-HZ-001')?.invalidatingAssumptionIds,
    ['PA-S1-AS-003'],
  );
});

test('expired critical assumption becomes UNKNOWN and directly invalidates dependents', () => {
  const result = evaluateHazardAssurance(buildExpiredAssumptionFixture(), FIXTURE_NOW_MS);
  const assumption = result.assumptionResults.find((entry) => entry.assumptionId === 'PA-S1-AS-003');
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(assumption?.declaredResult, 'PASS');
  assert.equal(assumption?.result, 'UNKNOWN');
  assert.equal(assumption?.reasonCode, 'EXPIRED');
  assert.ok(result.invalidatedAssuranceClaimIds.includes('PA-S1-CONS-CLAIM-001'));
  assert.equal(result.hazardResults.find((hazard) => hazard.hazardId === 'PA-S1-HZ-001')?.status, 'UNKNOWN');
});

test('maximum-age boundary is inclusive, then expires one millisecond later', () => {
  const assumption = buildCompleteHazardFixture().assumptions.find((entry) => entry.assumptionId === 'PA-S1-AS-003');
  assert.ok(assumption);
  const atBoundary = evaluateAssumptionAt(assumption, assumption.lastVerifiedAtMs + assumption.maximumAgeMs);
  const afterBoundary = evaluateAssumptionAt(assumption, assumption.lastVerifiedAtMs + assumption.maximumAgeMs + 1);
  assert.equal(atBoundary.result, 'PASS');
  assert.equal(afterBoundary.result, 'UNKNOWN');
  assert.equal(afterBoundary.reasonCode, 'EXPIRED');
});

test('explicit expiry boundary is exclusive of validity', () => {
  const assumption = buildCompleteHazardFixture().assumptions[0];
  const atExpiry = evaluateAssumptionAt(assumption, assumption.expiresAtMs);
  assert.equal(atExpiry.result, 'UNKNOWN');
  assert.equal(atExpiry.reasonCode, 'EXPIRED');
});

test('contradicted model-cohort assumption fails only the direct S1 consumers', () => {
  const result = evaluateHazardAssurance(buildContradictedAssumptionFixture(), FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.reasonCodes.includes('CRITICAL_ASSUMPTION_FAILED'));
  assert.equal(result.hazardResults.find((hazard) => hazard.hazardId === 'PA-S1-HZ-005')?.status, 'FAIL');
  assert.ok(result.invalidatedConsumers.some((consumer) => consumer.consumerId === 'PA-S1-CONS-MODEL-001'));
  assert.equal(result.invalidatedConsumers.some((consumer) => consumer.consumerId === 'PA-S1-HZ-001'), false);
});

test('permuting registries cannot change deterministic evaluation', () => {
  const baseline = evaluateHazardAssurance(buildCompleteHazardFixture(), FIXTURE_NOW_MS);
  const permuted = evaluateHazardAssurance(buildPermutedFixture(), FIXTURE_NOW_MS);
  assert.equal(canonicalStringify(permuted), canonicalStringify(baseline));
});

test('invalid injected clock returns UNKNOWN without reading ambient time', () => {
  const result = evaluateHazardAssurance(buildCompleteHazardFixture(), Number.NaN);
  assert.equal(result.status, 'UNKNOWN');
  assert.deepEqual(result.reasonCodes, ['CLOCK_INVALID']);
  assert.equal(result.evaluatedAtMs, null);
});

test('public assumption primitive rejects an invalid injected clock', () => {
  const assumption = buildCompleteHazardFixture().assumptions[0];
  const result = evaluateAssumptionAt(assumption, Number.NaN);
  assert.equal(result.result, 'UNKNOWN');
  assert.equal(result.reasonCode, 'CLOCK_INVALID');
  assert.equal(result.freshnessStatus, 'CLOCK_INVALID');
  assert.equal(result.evaluatedAtMs, null);
});

test('unknown reverse references make the packet UNKNOWN instead of PASS', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.assumptions[0].dependents.hazardIds.push('PA-S1-HZ-999');
  const result = evaluateHazardAssurance(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.reasonCodes.includes('PACKET_INVALID'));
  assert.ok(result.packetIssues.some((entry) => entry.code === 'HAZARD_REFERENCE_UNKNOWN'));
});

test('unknown cockpit dependencies and boundary-incoherent losses cannot pass', () => {
  const cockpitFixture = structuredClone(buildCompleteHazardFixture());
  cockpitFixture.assumptions[0].dependents.cockpitProjectionIds.push('PA-S1-CP-HZ-999');
  assert.equal(evaluateHazardAssurance(cockpitFixture, FIXTURE_NOW_MS).status, 'UNKNOWN');

  const boundaryFixture = structuredClone(buildCompleteHazardFixture());
  boundaryFixture.hazards.forEach((hazard) => {
    hazard.affectedBoundaries = ['COST'];
    hazard.unacceptableLossIds = ['PA-S1-UL-001'];
  });
  boundaryFixture.hazards[0].unacceptableLossIds = Array.from({ length: 10 }, (_, index) => `PA-S1-UL-${String(index + 1).padStart(3, '0')}`);
  assert.equal(evaluateHazardAssurance(boundaryFixture, FIXTURE_NOW_MS).status, 'UNKNOWN');
});

test('structurally malformed consumer records return UNKNOWN without throwing', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.hazards[0] = null;
  const result = evaluateHazardAssurance(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.reasonCodes.includes('PACKET_INVALID'));

  const consumerFixture = structuredClone(buildCompleteHazardFixture());
  consumerFixture.assumptionConsumers[0] = null;
  assert.equal(evaluateHazardAssurance(consumerFixture, FIXTURE_NOW_MS).status, 'UNKNOWN');
});

test('every required unacceptable-loss family must be covered by an active hazard', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.hazards.find((hazard) => hazard.hazardId === 'PA-S1-HZ-009').active = false;
  const result = evaluateHazardAssurance(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.lossFamilyCoverage.uncoveredLossFamilyIds, ['PA-S1-UL-010']);
  assert.ok(result.reasonCodes.includes('UNACCEPTABLE_LOSS_FAMILY_COVERAGE_FAILURE'));
});

test('an empty finite registry cannot vacuously pass active capital-critical hazards', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.assumptions = [];
  fixture.assumptionConsumers = [];
  fixture.hazards.forEach((hazard) => {
    hazard.assumptionIds = [];
  });
  const result = evaluateHazardAssurance(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.registryCoverage.unboundCriticalConsumerIds.length, 10);
  assert.ok(result.reasonCodes.includes('ASSUMPTION_REGISTRY_BINDING_MISSING'));
});

test('unknown assumption on an inactive record remains malformed and non-PASS', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.hazards[0].active = false;
  fixture.hazards[0].assumptionIds.push('PA-S1-AS-999');
  const result = evaluateHazardAssurance(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.reasonCodes.includes('PACKET_INVALID'));
});

test('bidirectional dependency drift invalidates the packet before claim projection', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  const claim = fixture.assumptionConsumers.find((consumer) => consumer.consumerId === 'PA-S1-CONS-CLAIM-001');
  claim.assumptionIds = claim.assumptionIds.filter((assumptionId) => assumptionId !== 'PA-S1-AS-002');
  const result = evaluateHazardAssurance(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.packetIssues.some((entry) => entry.code === 'DEPENDENT_FORWARD_REFERENCE_MISSING'));
});

test('orphaned capital-critical assumptions are explicit coverage failures', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  fixture.assumptions.push({
    ...fixture.assumptions[0],
    assumptionId: 'PA-S1-AS-ORPHAN-001',
    dependents: {
      hazardIds: [], claimIds: [], controlIds: [], modelIds: [], actionIds: [], cockpitProjectionIds: [],
    },
  });
  const result = evaluateHazardAssurance(fixture, FIXTURE_NOW_MS);
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.registryCoverage.orphanedCriticalAssumptionIds, ['PA-S1-AS-ORPHAN-001']);
  assert.ok(result.reasonCodes.includes('CRITICAL_ASSUMPTION_ORPHANED'));
});

test('known contradiction remains FAIL when its evidence later becomes stale', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  const assumption = fixture.assumptions.find((entry) => entry.assumptionId === 'PA-S1-AS-005');
  assumption.result = 'FAIL';
  assumption.reasonCode = 'CONTRADICTED';
  assumption.lastVerifiedAtMs = FIXTURE_NOW_MS - 20_000;
  assumption.maximumAgeMs = 5_000;
  const result = evaluateHazardAssurance(fixture, FIXTURE_NOW_MS);
  const evaluated = result.assumptionResults.find((entry) => entry.assumptionId === 'PA-S1-AS-005');
  assert.equal(evaluated?.result, 'FAIL');
  assert.equal(evaluated?.reasonCode, 'CONTRADICTED');
  assert.equal(evaluated?.freshnessStatus, 'EXPIRED');
});

test('evaluation does not mutate or freeze mutable caller input', () => {
  const fixture = structuredClone(buildCompleteHazardFixture());
  const before = canonicalStringify(fixture);
  assert.equal(Object.isFrozen(fixture.assumptions[0].consequence), false);
  assert.equal(Object.isFrozen(fixture.hazards[0].cockpitProjection), false);
  evaluateHazardAssurance(fixture, FIXTURE_NOW_MS);
  assert.equal(canonicalStringify(fixture), before);
  assert.equal(Object.isFrozen(fixture.assumptions[0].consequence), false);
  assert.equal(Object.isFrozen(fixture.hazards[0].cockpitProjection), false);
});
