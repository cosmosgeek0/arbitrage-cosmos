import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  buildAliasedConfiguredDiagnosticFixture,
  buildCompleteConfiguredDiagnosticFixture,
  buildDiagnosticSemanticCloneFixture,
  buildFailedAssumptionProjection,
  buildIncompleteConfiguredDiagnosticFixture,
  buildUnknownAssumptionProjection,
  clonePlainData,
  evaluateAssuranceCase,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet, projection = ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE) => evaluateAssuranceCase(
  packet,
  projection,
  FIXTURE_NOW_MS,
);
const diagnosticClaim = (result) => result.claimResults.find((claim) => claim.claimId === 'PA-S4-CLAIM-013');

test('explicit NOT_CONFIGURED is valid and does not degrade deterministic readiness', () => {
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE);
  assert.equal(result.diagnosticPlane.posture, 'NOT_CONFIGURED');
  assert.equal(result.diagnosticPlane.status, 'PASS');
  assert(diagnosticClaim(result).reasonCodes.includes('DIAGNOSTIC_NOT_CONFIGURED_VALID'));
  assert.equal(result.status, 'PASS');
});

for (const posture of ['SHADOW', 'OWNER_GATED', 'ACTIVE']) {
  test(`${posture} passes only with all five current evidence families`, () => {
    const result = evaluate(buildCompleteConfiguredDiagnosticFixture(posture));
    assert.equal(result.diagnosticPlane.posture, posture);
    assert.equal(result.diagnosticPlane.status, 'PASS');
    assert.equal(result.status, 'PASS');
  });
}

test('configured posture with missing privacy evidence is UNKNOWN', () => {
  const result = evaluate(buildIncompleteConfiguredDiagnosticFixture());
  assert.equal(result.diagnosticPlane.posture, 'ACTIVE');
  assert.equal(result.diagnosticPlane.status, 'UNKNOWN');
  assert(diagnosticClaim(result).reasonCodes.includes('DIAGNOSTIC_PRIVACY_EVIDENCE_MISSING'));
  assert.equal(result.status, 'UNKNOWN');
  assert(result.invalidationPaths.some((entry) => entry.originId === 'DIAGNOSTIC_PRIVACY_EVIDENCE_MISSING'));
});

test('configured posture evidence must be directly bound to its claim', () => {
  const packet = clonePlainData(buildCompleteConfiguredDiagnosticFixture());
  const claim = packet.claims.find((entry) => entry.claimId === 'PA-S4-CLAIM-013');
  const privacyEvidenceId = packet.diagnosticPlane.privacyEvidenceIds[0];
  claim.supportingEvidenceIds = claim.supportingEvidenceIds.filter((id) => id !== privacyEvidenceId);
  claim.componentDrillDown[0].supportingEvidenceIds = claim.componentDrillDown[0].supportingEvidenceIds.filter((id) => id !== privacyEvidenceId);
  const result = evaluate(packet);
  assert.equal(result.diagnosticPlane.status, 'UNKNOWN');
  assert(diagnosticClaim(result).reasonCodes.includes('DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM'));
});

test('configured posture inherits common-mode UNKNOWN from required evidence', () => {
  const packet = clonePlainData(buildCompleteConfiguredDiagnosticFixture());
  const evidenceId = packet.diagnosticPlane.independentEvidenceIds[0];
  const evidence = packet.evidence.find((entry) => entry.evidenceId === evidenceId);
  evidence.verifier.failureDomains[0] = clonePlainData(evidence.producer.failureDomains[0]);
  const result = evaluate(packet);
  assert.equal(result.diagnosticPlane.status, 'UNKNOWN');
  assert.equal(result.status, 'UNKNOWN');
});

test('one evidence ID cannot alias the five configured diagnostic families', () => {
  const result = evaluate(buildAliasedConfiguredDiagnosticFixture());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.claimResults.length, 0);
  assert(result.packetIssues.some((entry) => entry.code === 'DIAGNOSTIC_EVIDENCE_ALIAS'));
  assert(result.packetIssues.some((entry) => entry.code === 'DIAGNOSTIC_EVIDENCE_FAMILY_MISMATCH'));
});

test('distinct diagnostic IDs cannot clone one semantic evidence source', () => {
  const result = evaluate(buildDiagnosticSemanticCloneFixture());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.claimResults.length, 0);
  for (const code of [
    'DIAGNOSTIC_SOURCE_ID_ALIAS',
    'DIAGNOSTIC_SOURCE_DIGEST_ALIAS',
    'DIAGNOSTIC_PRODUCER_ALIAS',
    'DIAGNOSTIC_VERIFIER_ALIAS',
    'DIAGNOSTIC_COMMON_MODE_FAILURE_DOMAIN',
  ]) assert(result.packetIssues.some((entry) => entry.code === code), code);
});

test('NOT_CONFIGURED retains but does not apply configured-only S1 assumptions', () => {
  const projection = buildFailedAssumptionProjection('PA-S1-AS-002');
  const notConfigured = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, projection);
  const notConfiguredClaim = diagnosticClaim(notConfigured);
  assert.deepEqual(notConfiguredClaim.assumptionIds, ['PA-S1-AS-002', 'PA-S1-AS-007', 'PA-S1-AS-009']);
  assert.deepEqual(notConfiguredClaim.appliedAssumptionIds, []);
  assert.equal(notConfiguredClaim.result, 'PASS');

  const configured = evaluate(buildCompleteConfiguredDiagnosticFixture(), projection);
  const configuredClaim = diagnosticClaim(configured);
  assert.deepEqual(configuredClaim.appliedAssumptionIds, configuredClaim.assumptionIds);
  assert.equal(configuredClaim.result, 'UNKNOWN');
});

for (const diagnosticAssumptionStatus of ['FAIL', 'UNKNOWN']) {
  test(`NOT_CONFIGURED isolates diagnostic-only AS009 ${diagnosticAssumptionStatus} from deterministic readiness`, () => {
    const projection = diagnosticAssumptionStatus === 'FAIL'
      ? buildFailedAssumptionProjection('PA-S1-AS-009')
      : buildUnknownAssumptionProjection('PA-S1-AS-009');
    const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, projection);
    assert.equal(result.status, 'PASS');
    assert(result.claimResults.every((entry) => entry.result === 'PASS'));
    assert(result.claimResults.every((entry) => !entry.appliedAssumptionIds.includes('PA-S1-AS-009')));
    assert.equal(result.invalidationPaths.some((entry) => entry.originId === 'PA-S1-AS-009'), false);
    assert.equal(result.recomputation.applicable, false);
  });
}

test('configured posture applies diagnostic-only AS009 as UNKNOWN support with an owner-visible path', () => {
  const result = evaluate(
    buildCompleteConfiguredDiagnosticFixture(),
    buildFailedAssumptionProjection('PA-S1-AS-009'),
  );
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(diagnosticClaim(result).result, 'UNKNOWN');
  assert(result.invalidationPaths.some((entry) => (
    entry.originType === 'ASSUMPTION'
    && entry.originId === 'PA-S1-AS-009'
    && entry.originResult === 'FAIL'
    && entry.dependentClaimId === 'PA-S4-CLAIM-013'
  )));
});

test('diagnostic posture projection remains explanatory and commandless', () => {
  const result = evaluate(buildIncompleteConfiguredDiagnosticFixture());
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(result.safetyBoundary.commandsIssued, 0);
  assert(result.recommendations.every((entry) => entry.commandAuthority === 'NONE'));
});
