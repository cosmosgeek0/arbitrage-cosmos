import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  buildCounterevidenceFixture,
  buildFailedEvidenceFixture,
  buildMissingEvidenceReferenceFixture,
  buildMissingMandatoryClaimFixture,
  buildReorderedFixture,
  buildStaleFailedEvidenceFixture,
  canonicalStringify,
  clonePlainData,
  evaluateAssuranceCase,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet = COMPLETE_ASSURANCE_CASE_FIXTURE, projection = ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE, nowMs = FIXTURE_NOW_MS) => (
  evaluateAssuranceCase(packet, projection, nowMs)
);

test('baseline evaluates all mandatory claims PASS without authority', () => {
  const result = evaluate();
  assert.equal(result.status, 'PASS');
  assert.equal(result.claimResults.length, 13);
  assert.equal(result.evidenceResults.length, 26);
  assert(result.claimResults.every((claim) => claim.result === 'PASS'));
  assert(result.evidenceResults.every((entry) => entry.result === 'PASS'));
  assert.equal(result.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(result.authorityEffect, 'NONE');
  assert.equal(result.runtimeProjectionOwner, 'I08.machine-supervisor');
  assert.equal(result.safetyBoundary.commandsIssued, 0);
  assert.equal(result.safetyBoundary.readOnly, true);
  assert.equal(result.safetyBoundary.doesNotBlockCanonicalRiskReduction, true);
  assert.equal(result.safetyBoundary.llmMayExplain, true);
  assert.equal(result.safetyBoundary.llmMayRestoreSupport, false);
  assert.deepEqual(result.safetyBoundary.prohibitedCommands, [
    'HALT', 'CLOSE', 'REPAIR', 'DEMOTION', 'DEPLOYMENT', 'CAPITAL',
    'ORDER', 'BORROW', 'REPAY', 'TRANSFER', 'WITHDRAWAL',
  ]);
  assert.equal(result.recomputation.applicable, false);
  assert.equal(result.recomputation.assuranceDueAtMs, null);
});

test('evaluation is deterministic under packet record reordering', () => {
  const first = evaluate();
  const second = evaluate(buildReorderedFixture());
  assert.equal(canonicalStringify(first), canonicalStringify(second));
});

test('typed failure-domain record order does not change canonical evaluation', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  for (const evidence of packet.evidence) {
    evidence.producer.failureDomains.reverse();
    evidence.verifier.failureDomains.reverse();
  }
  assert.equal(canonicalStringify(evaluate()), canonicalStringify(evaluate(packet)));
});

test('evaluation does not mutate caller inputs and freezes its output', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  const beforePacket = canonicalStringify(packet);
  const beforeProjection = canonicalStringify(projection);
  const result = evaluate(packet, projection);
  assert.equal(canonicalStringify(packet), beforePacket);
  assert.equal(canonicalStringify(projection), beforeProjection);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.claimResults));
  assert(Object.isFrozen(result.claimResults[0]));
});

test('invalid clock fails closed without fabricating an evaluation time', () => {
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE, Number.NaN);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.evaluatedAtMs, null);
  assert.deepEqual(result.reasonCodes, ['CLOCK_INVALID']);
});

test('future-dated assurance packet fails closed', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  packet.generatedAtMs = FIXTURE_NOW_MS + 1;
  const result = evaluate(packet);
  assert.equal(result.status, 'UNKNOWN');
  assert.deepEqual(result.reasonCodes, ['PACKET_GENERATED_IN_FUTURE']);
  assert.equal(result.claimResults.length, 0);
  assert.equal(result.safetyBoundary.supportUsableForNewAction, false);
});

test('missing mandatory claim is a visible coverage failure', () => {
  const result = evaluate(buildMissingMandatoryClaimFixture());
  assert.equal(result.status, 'FAIL');
  assert(result.reasonCodes.includes('MANDATORY_CLAIM_COVERAGE_FAILURE'));
  assert(result.packetIssues.some((entry) => entry.code === 'MANDATORY_CLAIM_MISSING'));
  assert.equal(result.safetyBoundary.supportUsableForNewAction, false);
});

test('missing required evidence becomes UNKNOWN rather than fabricated PASS', () => {
  const result = evaluate(buildMissingEvidenceReferenceFixture());
  assert.equal(result.status, 'UNKNOWN');
  const telemetry = result.claimResults.find((claim) => claim.claimId === 'PA-S4-CLAIM-004');
  assert.equal(telemetry.result, 'UNKNOWN');
  assert(telemetry.reasonCodes.includes('EVIDENCE_REFERENCE_MISSING'));
  assert(telemetry.invalidatingEvidenceIds.includes('PA-S4-EVIDENCE-MISSING'));
  const path = result.invalidationPaths.find((entry) => (
    entry.originType === 'EVIDENCE'
    && entry.originId === 'PA-S4-EVIDENCE-MISSING'
    && entry.dependentClaimId === 'PA-S4-CLAIM-004'
  ));
  assert(path);
  assert.equal(path.originFreshnessStatus, 'EVIDENCE_MISSING');
  assert.equal(path.originInvalidAtMs, null);
  assert.equal(path.projectionDueAtMs, null);
  assert.equal(path.propagationSloMet, null);
  assert.equal(path.ownerId, 'I08.machine-supervisor');
});

test('known failed evidence dominates other uncertainty', () => {
  const packet = clonePlainData(buildFailedEvidenceFixture());
  packet.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004').verifier.actorId = (
    packet.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004').producer.actorId
  );
  const result = evaluate(packet);
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.result, 'FAIL');
  assert(evidence.reasonCodes.includes('DECLARED_EVIDENCE_FAILURE'));
  assert.equal(result.status, 'FAIL');
});

test('explicit counterevidence IDs participate in conservative evaluation', () => {
  const failed = evaluate(buildCounterevidenceFixture('FAIL'));
  const failedClaim = failed.claimResults.find((claim) => claim.claimId === 'PA-S4-CLAIM-004');
  assert.equal(failedClaim.result, 'FAIL');
  assert.deepEqual(failedClaim.counterEvidenceIds, ['PA-S4-COUNTEREVIDENCE-004']);
  assert(failedClaim.invalidatingEvidenceIds.includes('PA-S4-COUNTEREVIDENCE-004'));

  const cleared = evaluate(buildCounterevidenceFixture('PASS'));
  assert.equal(cleared.status, 'PASS');
});

test('known failed evidence remains FAIL after expiry and self-verification', () => {
  const result = evaluate(buildStaleFailedEvidenceFixture());
  const evidence = result.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.freshnessStatus, 'EXPIRED');
  assert.equal(evidence.independenceStatus, 'UNKNOWN');
  assert.equal(evidence.result, 'FAIL');
  assert.equal(result.status, 'FAIL');
});

test('non-PASS claims emit recommendations only to existing owners', () => {
  const result = evaluate(buildFailedEvidenceFixture());
  assert(result.recommendations.length > 0);
  assert(result.recommendations.every((entry) => entry.commandAuthority === 'NONE'));
  assert(result.recommendations.every((entry) => entry.eventRecommendation.ownerId.length > 0));
  assert.equal(result.safetyBoundary.commandsIssued, 0);
});
