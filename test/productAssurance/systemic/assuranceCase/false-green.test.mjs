import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  buildMandatoryDependencyDriftFixture,
  clonePlainData,
  evaluateAssuranceCase,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet) => evaluateAssuranceCase(
  packet,
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  FIXTURE_NOW_MS,
);
const mutate = (change) => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  change(packet);
  return packet;
};

for (const [name, change] of [
  ['truth label', (packet) => { packet.truthLabel = 'LIVE'; }],
  ['authority effect', (packet) => { packet.authorityEffect = 'EXECUTE'; }],
  ['dependency mode', (packet) => { packet.propagationPolicy.requiredDependencyMode = 'ANY'; }],
  ['failure precedence', (packet) => { packet.propagationPolicy.failurePrecedence = 'UNKNOWN_THEN_PASS'; }],
  ['expiry result', (packet) => { packet.propagationPolicy.expiryResult = 'PASS'; }],
  ['missing-data behavior', (packet) => { packet.claims[0].missingDataBehavior = 'PASS'; }],
  ['support role', (packet) => { packet.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-001').role = 'COUNTERCHECK'; }],
  ['evidence purpose', (packet) => { packet.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-001').purpose = 'INDEPENDENCE_BASIS'; }],
]) {
  test(`invalid ${name} cannot coexist with usable PASS`, () => {
    const result = evaluate(mutate(change));
    assert.notEqual(result.status, 'PASS');
    assert.equal(result.safetyBoundary.supportUsableForNewAction, false);
    assert(result.packetIssues.length > 0);
  });
}

test('stripping the mandatory dependency graph is a visible coverage failure', () => {
  const result = evaluate(buildMandatoryDependencyDriftFixture());
  assert.equal(result.status, 'FAIL');
  assert.equal(result.claimResults.length, 0);
  assert(result.packetIssues.some((entry) => entry.code === 'MANDATORY_CLAIM_DEPENDENCY_DRIFT'));
});

test('an extra capital-critical claim cannot be excluded from overall status', () => {
  const packet = mutate((value) => {
    const extra = clonePlainData(value.claims[12]);
    extra.claimId = 'PA-S4-CLAIM-014';
    extra.requirementKey = 'EXTRA_CAPITAL_CRITICAL_ROOT';
    extra.statement = 'An unauthorized extra root claim.';
    extra.subclaimIds = [];
    extra.assumptionIds = [];
    extra.supportingEvidenceIds = ['PA-S4-EVIDENCE-013'];
    value.claims.push(extra);
    value.rootClaimIds.push(extra.claimId);
    value.mandatoryClaimIds.push(extra.claimId);
  });
  const result = evaluate(packet);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.claimResults.length, 0);
  assert(result.packetIssues.some((entry) => entry.code === 'MANDATORY_CLAIM_SET_INVALID'));
  assert.equal(result.safetyBoundary.supportUsableForNewAction, false);
});
