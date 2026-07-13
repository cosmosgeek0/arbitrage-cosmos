import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  buildDerivedClaimExpiryFixture,
  buildDerivedEvidenceExpiryFixture,
  buildExpiredEvidenceFixture,
  buildFailedAssumptionProjection,
  buildMaxAgeBoundaryFixture,
  buildMissingEvidenceReferenceFixture,
  buildMissingAssumptionProjection,
  buildS1AssumptionProjection,
  buildStaleS1Projection,
  buildUnknownAssumptionProjection,
  clonePlainData,
  evaluateAssuranceCase,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet, projection = ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE, nowMs = FIXTURE_NOW_MS) => (
  evaluateAssuranceCase(packet, projection, nowMs)
);
const claim = (result, claimId) => result.claimResults.find((entry) => entry.claimId === claimId);

test('explicit expiry is ineligible exactly at expiresAtMs', () => {
  const result = evaluate(buildExpiredEvidenceFixture());
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.freshnessStatus, 'EXPIRED');
  assert.equal(evidence.result, 'UNKNOWN');
  assert.equal(evidence.supportUsableForNewAction, false);
  assert.equal(result.status, 'UNKNOWN');
});

test('maximum-age support is valid at the exact boundary', () => {
  const result = evaluate(buildMaxAgeBoundaryFixture());
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.ageMs, evidence.maximumAgeMs);
  assert.equal(evidence.freshnessStatus, 'CURRENT');
  assert.equal(evidence.result, 'PASS');
  assert.equal(result.status, 'PASS');
});

test('maximum-age support expires one millisecond after the boundary', () => {
  const nowMs = FIXTURE_NOW_MS + 1;
  const projection = buildS1AssumptionProjection({ evaluatedAtMs: nowMs });
  const result = evaluate(buildMaxAgeBoundaryFixture(), projection, nowMs);
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.ageMs, evidence.maximumAgeMs + 1);
  assert.equal(evidence.freshnessStatus, 'EXPIRED');
  assert.equal(evidence.result, 'UNKNOWN');
});

test('expired telemetry evidence invalidates every dependent ancestor transitively', () => {
  const result = evaluate(buildExpiredEvidenceFixture());
  for (const claimId of ['PA-S4-CLAIM-004', 'PA-S4-CLAIM-003', 'PA-S4-CLAIM-002', 'PA-S4-CLAIM-001', 'PA-S4-CLAIM-012']) {
    assert.equal(claim(result, claimId).result, 'UNKNOWN', claimId);
    assert.equal(claim(result, claimId).supportUsableForNewAction, false, claimId);
  }
  const fullPath = result.invalidationPaths.find((entry) => (
    entry.originId === 'PA-S4-EVIDENCE-004'
    && entry.dependentClaimId === 'PA-S4-CLAIM-001'
  ));
  assert.deepEqual(fullPath.path, [
    'EVIDENCE:PA-S4-EVIDENCE-004',
    'PA-S4-CLAIM-004',
    'PA-S4-CLAIM-003',
    'PA-S4-CLAIM-002',
    'PA-S4-CLAIM-001',
  ]);
  assert.equal(fullPath.supportUsableForNewAction, false);
  assert.equal(fullPath.projectionDueAtMs, FIXTURE_NOW_MS + fullPath.propagationSloMs);
  assert.equal(result.recomputation.logicalCompletedAtMs, FIXTURE_NOW_MS);
  assert.equal(result.recomputation.completedWithinDeclaredSlo, true);
  assert.equal(result.recomputation.assuranceDueAtMs, FIXTURE_NOW_MS + result.recomputation.assuranceSloMs);
});

test('transitive invalidation leaves unrelated model claim unchanged', () => {
  const result = evaluate(buildExpiredEvidenceFixture());
  assert.equal(claim(result, 'PA-S4-CLAIM-010').result, 'PASS');
});

test('derived evidence cannot remain PASS when its evidence dependency expires', () => {
  const result = evaluate(buildDerivedEvidenceExpiryFixture());
  const derived = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-010');
  assert.equal(derived.result, 'UNKNOWN');
  assert(derived.reasonCodes.includes('DERIVED_DEPENDENCY_UNKNOWN'));
  assert.equal(claim(result, 'PA-S4-CLAIM-010').result, 'UNKNOWN');
  assert(result.invalidationPaths.some((entry) => (
    entry.originId === 'PA-S4-EVIDENCE-004'
    && entry.path.includes('EVIDENCE:PA-S4-EVIDENCE-010')
    && entry.dependentClaimId === 'PA-S4-CLAIM-010'
  )));
  assert.equal(result.invalidationPaths.some((entry) => entry.originId === 'PA-S4-EVIDENCE-010'), false);
});

test('derived evidence cannot remain PASS when its claim dependency becomes UNKNOWN', () => {
  const result = evaluate(buildDerivedClaimExpiryFixture());
  const derived = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-010');
  assert.equal(derived.result, 'UNKNOWN');
  assert.equal(claim(result, 'PA-S4-CLAIM-010').result, 'UNKNOWN');
  assert(result.invalidationPaths.some((entry) => (
    entry.originId === 'PA-S4-EVIDENCE-004'
    && entry.path.includes('EVIDENCE:PA-S4-EVIDENCE-010')
    && entry.dependentClaimId === 'PA-S4-CLAIM-010'
  )));
});

test('a primitive local expiry keeps its own boundary when an inherited invalidator is earlier', () => {
  const delayedNowMs = FIXTURE_NOW_MS + 6_000;
  const packet = clonePlainData(buildDerivedEvidenceExpiryFixture());
  packet.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-010').expiresAtMs = FIXTURE_NOW_MS + 3_000;
  const projection = buildS1AssumptionProjection({ evaluatedAtMs: delayedNowMs });
  const result = evaluate(packet, projection, delayedNowMs);
  const derived = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-010');
  assert.equal(derived.localInvalidatedAtMs, FIXTURE_NOW_MS + 3_000);
  assert.equal(derived.invalidatedAtMs, FIXTURE_NOW_MS);
  const derivedOrigin = result.invalidationPaths.find((entry) => (
    entry.originType === 'EVIDENCE'
    && entry.originId === 'PA-S4-EVIDENCE-010'
    && entry.dependentClaimId === 'PA-S4-CLAIM-010'
  ));
  assert.equal(derivedOrigin.originInvalidAtMs, FIXTURE_NOW_MS + 3_000);
});

test('propagation and assurance SLOs remain anchored to the invalidation boundary', () => {
  const delayedNowMs = FIXTURE_NOW_MS + 6_000;
  const projection = buildS1AssumptionProjection({ evaluatedAtMs: delayedNowMs });
  const result = evaluate(buildExpiredEvidenceFixture(), projection, delayedNowMs);
  const path = result.invalidationPaths.find((entry) => (
    entry.originId === 'PA-S4-EVIDENCE-004'
    && entry.dependentClaimId === 'PA-S4-CLAIM-004'
  ));
  assert.equal(path.originInvalidAtMs, FIXTURE_NOW_MS);
  assert.equal(path.projectionDueAtMs, FIXTURE_NOW_MS + path.propagationSloMs);
  assert.equal(path.propagationSloMet, false);
  assert.equal(result.recomputation.originInvalidatedAtMs, FIXTURE_NOW_MS);
  assert.equal(result.recomputation.assuranceDueAtMs, FIXTURE_NOW_MS + result.recomputation.assuranceSloMs);
  assert.equal(result.recomputation.completedWithinDeclaredSlo, false);
  assert(result.reasonCodes.includes('PROPAGATION_SLO_MISSED'));
  assert(result.reasonCodes.includes('ASSURANCE_SLO_MISSED'));
  assert.equal(result.safetyBoundary.supportUsableForNewAction, false);
});

test('the immutable assurance SLO contract rejects self-consistent deadline drift', () => {
  const delayedNowMs = FIXTURE_NOW_MS + 1_500;
  const packet = clonePlainData(buildExpiredEvidenceFixture());
  packet.claims.find((entry) => entry.claimId === 'PA-S4-CLAIM-004').assuranceSloMs = 1_000;
  const projection = buildS1AssumptionProjection({ evaluatedAtMs: delayedNowMs });
  const result = evaluate(packet, projection, delayedNowMs);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.claimResults.length, 0);
  assert(result.reasonCodes.includes('ASSURANCE_PACKET_INVALID'));
  assert(result.packetIssues.some((entry) => entry.code === 'CLAIM_SLO_CONTRACT_DRIFT'));
});

test('a definite assurance SLO miss dominates an undetermined missing-evidence deadline', () => {
  const delayedNowMs = FIXTURE_NOW_MS + 6_000;
  const packet = clonePlainData(buildMissingEvidenceReferenceFixture());
  packet.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-005').expiresAtMs = FIXTURE_NOW_MS;
  const projection = buildS1AssumptionProjection({ evaluatedAtMs: delayedNowMs });
  const result = evaluate(packet, projection, delayedNowMs);
  assert(result.recomputation.affectedClaimDeadlines.some((entry) => entry.completedWithinDeclaredSlo === false));
  assert(result.recomputation.affectedClaimDeadlines.some((entry) => entry.completedWithinDeclaredSlo === null));
  assert.equal(result.recomputation.completedWithinDeclaredSlo, false);
  assert(result.reasonCodes.includes('ASSURANCE_SLO_MISSED'));
});

test('S1 UNKNOWN propagates through every claim that consumes the assumption', () => {
  const projection = buildUnknownAssumptionProjection('PA-S1-AS-008');
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, projection);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(claim(result, 'PA-S4-CLAIM-012').result, 'UNKNOWN');
  assert.equal(claim(result, 'PA-S4-CLAIM-010').result, 'PASS');
  assert(result.invalidationPaths.some((entry) => entry.originType === 'ASSUMPTION' && entry.originId === 'PA-S1-AS-008'));
});

test('S1 contradiction invalidates its affected derived claims as UNKNOWN', () => {
  const projection = buildFailedAssumptionProjection('PA-S1-AS-006');
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, projection);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(claim(result, 'PA-S4-CLAIM-004').result, 'PASS');
  assert.equal(claim(result, 'PA-S4-CLAIM-009').result, 'UNKNOWN');
  assert.equal(result.assumptionResults.find((entry) => entry.assumptionId === 'PA-S1-AS-006').result, 'FAIL');
  assert(result.invalidationPaths.some((entry) => (
    entry.originType === 'ASSUMPTION'
    && entry.originId === 'PA-S1-AS-006'
    && entry.originResult === 'FAIL'
    && entry.dependentClaimId === 'PA-S4-CLAIM-009'
    && entry.dependentResult === 'UNKNOWN'
  )));
});

test('missing accepted S1 result fails the adapter seam closed', () => {
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, buildMissingAssumptionProjection());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.claimResults.length, 0);
  assert(result.reasonCodes.includes('S1_PROJECTION_INVALID'));
  assert(result.s1ProjectionIssues.some((entry) => entry.code === 'S1_ASSUMPTION_SET_INVALID'));
});

test('cached S1 PASS cannot persist as current support at a later evaluation', () => {
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, buildStaleS1Projection());
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('S1_PROJECTION_NOT_CURRENT'));
  assert(result.assumptionResults.every((entry) => entry.supportUsableForNewAction === false));
});

test('UNKNOWN projection still preserves canonical risk-reduction boundary', () => {
  const result = evaluate(buildExpiredEvidenceFixture());
  assert.equal(result.safetyBoundary.doesNotBlockCanonicalRiskReduction, true);
  assert.equal(result.safetyBoundary.riskReductionAvailabilityOwner, 'EXISTING_CANONICAL_OWNERS');
  assert.equal(result.safetyBoundary.commandsIssued, 0);
});
