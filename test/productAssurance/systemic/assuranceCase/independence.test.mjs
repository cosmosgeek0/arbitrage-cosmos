import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  INDEPENDENCE_REQUIRED_FAILURE_DOMAIN_CLASSES,
  buildCommonModeEvidenceFixture,
  buildDeclaredCommonModeFixture,
  buildEvidenceCycleFixture,
  buildExpiredIndependenceBasisFixture,
  buildFailureDomainCoverageGapFixture,
  buildSameOwnerEvidenceFixture,
  buildSelfCertifiedIndependenceFixture,
  buildSelfVerifiedEvidenceFixture,
  clonePlainData,
  evaluateAssuranceCase,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet) => evaluateAssuranceCase(
  packet,
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  FIXTURE_NOW_MS,
);

test('a producer cannot be its only verifier', () => {
  const result = evaluate(buildSelfVerifiedEvidenceFixture());
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.result, 'UNKNOWN');
  assert.equal(evidence.independenceStatus, 'UNKNOWN');
  assert(evidence.reasonCodes.includes('PRODUCER_VERIFIER_NOT_INDEPENDENT'));
  assert.equal(result.status, 'UNKNOWN');
});

test('shared typed failure domain invalidates independence', () => {
  const result = evaluate(buildCommonModeEvidenceFixture());
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.result, 'UNKNOWN');
  assert(evidence.reasonCodes.includes('COMMON_MODE_FAILURE_DOMAIN'));
  assert.deepEqual(evidence.sharedFailureDomains, ['CLOCK:PRODUCER-CLOCK-004']);
});

test('shared producer/verifier owner is treated as managerial common mode', () => {
  const result = evaluate(buildSameOwnerEvidenceFixture());
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-005');
  assert.equal(evidence.result, 'UNKNOWN');
  assert(evidence.reasonCodes.includes('PRODUCER_VERIFIER_OWNER_COMMON_MODE'));
});

test('declared common-mode dependency makes positive support UNKNOWN', () => {
  const result = evaluate(buildDeclaredCommonModeFixture());
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.result, 'UNKNOWN');
  assert(evidence.reasonCodes.includes('DECLARED_COMMON_MODE_DEPENDENCY'));
  assert.deepEqual(evidence.commonModeDependencyIds, ['SHARED-TELEMETRY-EXPORTER-001']);
});

test('baseline producer and verifier identities and failure domains are disjoint', () => {
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE);
  assert(result.evidenceResults.every((entry) => entry.producerId !== entry.verifierId));
  assert(result.evidenceResults.every((entry) => entry.independenceStatus === 'PROVEN'));
  assert(result.evidenceResults.every((entry) => entry.sharedFailureDomains.length === 0));
  assert(result.evidenceResults.every((entry) => entry.commonModeDependencyIds.length === 0));
  const evidenceById = new Map(result.evidenceResults.map((entry) => [entry.evidenceId, entry]));
  for (const entry of result.evidenceResults.filter((evidence) => evidence.purpose !== 'INDEPENDENCE_BASIS')) {
    assert(entry.independenceBasisEvidenceIds.length > 0, entry.evidenceId);
    assert(entry.independenceBasisEvidenceIds.every((id) => evidenceById.get(id)?.result === 'PASS'), entry.evidenceId);
  }
});

test('expired independence basis invalidates positive support transitively', () => {
  const result = evaluate(buildExpiredIndependenceBasisFixture());
  const basis = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-INDEPENDENCE-BASIS-004');
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(basis.result, 'UNKNOWN');
  assert.equal(evidence.result, 'UNKNOWN');
  assert.equal(evidence.independenceStatus, 'UNKNOWN');
  assert(evidence.reasonCodes.includes('INDEPENDENCE_BASIS_UNKNOWN'));
  assert(result.invalidationPaths.some((entry) => (
    entry.originId === basis.evidenceId
    && entry.path.includes('EVIDENCE:PA-S4-EVIDENCE-004')
    && entry.dependentClaimId === 'PA-S4-CLAIM-004'
  )));
});

test('declared independence class requires domain coverage on both legs', () => {
  const result = evaluate(buildFailureDomainCoverageGapFixture());
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.result, 'UNKNOWN');
  assert(evidence.reasonCodes.includes('VERIFIER_FAILURE_DOMAIN_COVERAGE_MISSING'));
  assert(evidence.missingVerifierFailureDomainClasses.includes('CODE_PATH'));
});

test('every named common-mode class is mandatory on both OUT_OF_BAND legs', () => {
  const requiredClasses = [
    'CLOCK',
    'STORE',
    'NETWORK',
    'CREDENTIAL',
    'CODE_PATH',
    'TELEMETRY_EXPORTER',
    'MODEL_FAMILY',
    'PROCESS',
    'HOST',
    'ORGANIZATION',
  ];
  assert.deepEqual(INDEPENDENCE_REQUIRED_FAILURE_DOMAIN_CLASSES.OUT_OF_BAND, requiredClasses);
  for (const leg of ['producer', 'verifier']) {
    for (const className of requiredClasses) {
      const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
      const inputEvidence = packet.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
      inputEvidence.independence.declaredClass = 'OUT_OF_BAND';
      inputEvidence[leg].failureDomains = inputEvidence[leg].failureDomains.filter((domain) => domain.class !== className);
      const result = evaluate(packet);
      const evidence = result.evidenceResults.find((entry) => entry.evidenceId === inputEvidence.evidenceId);
      const expectedCode = `${leg.toUpperCase()}_FAILURE_DOMAIN_COVERAGE_MISSING`;
      const expectedField = leg === 'producer'
        ? 'missingProducerFailureDomainClasses'
        : 'missingVerifierFailureDomainClasses';
      assert.equal(evidence.result, 'UNKNOWN', `${leg}:${className}`);
      assert(evidence.reasonCodes.includes(expectedCode), `${leg}:${className}`);
      assert(evidence[expectedField].includes(className), `${leg}:${className}`);
    }
  }
});

test('self-referential independence basis fails the packet closed', () => {
  const result = evaluate(buildSelfCertifiedIndependenceFixture());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.claimResults.length, 0);
  assert(result.reasonCodes.includes('ASSURANCE_PACKET_INVALID'));
});

test('strongly connected evidence self-certification fails the packet closed', () => {
  const result = evaluate(buildEvidenceCycleFixture());
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('ASSURANCE_PACKET_INVALID'));
  assert(result.packetIssues.some((entry) => entry.code === 'ASSURANCE_GRAPH_CYCLE'));
  assert.equal(result.claimResults.length, 0);
});

test('independence failure never grants control or runtime authority', () => {
  const result = evaluate(buildSelfVerifiedEvidenceFixture());
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(result.safetyBoundary.commandsIssued, 0);
  assert.equal(result.safetyBoundary.doesNotBlockCanonicalRiskReduction, true);
});
