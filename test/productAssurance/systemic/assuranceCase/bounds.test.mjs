import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  SCHEMA_LIMITS,
  canonicalEvidenceStatement,
  canonicalStringify,
  clonePlainData,
  evaluateAssuranceCase,
  validateAssuranceCasePacket,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evidenceById = (packet, evidenceId) => packet.evidence.find((entry) => entry.evidenceId === evidenceId);
const uniquePair = (evidenceTemplate, basisTemplate, evidenceId, dependencies, serial) => {
  const evidence = clonePlainData(evidenceTemplate);
  const basis = clonePlainData(basisTemplate);
  const basisId = `${evidenceId}-BASIS`;
  evidence.evidenceId = evidenceId;
  evidence.statement = canonicalEvidenceStatement(evidence);
  evidence.sourceIdentity.sourceId = `${evidenceId}-SOURCE`;
  evidence.sourceIdentity.revision = `${evidenceId}-REV`;
  evidence.sourceIdentity.digest = `sha256:${String(1_000 + serial).padStart(64, '0')}`;
  evidence.producer.actorId = `${evidenceId}-PRODUCER`;
  evidence.verifier.actorId = `${evidenceId}-VERIFIER`;
  evidence.independence.basisEvidenceIds = [basisId];
  evidence.derivedFromClaimIds = [];
  evidence.derivedFromEvidenceIds = dependencies;
  basis.evidenceId = basisId;
  basis.statement = canonicalEvidenceStatement(basis);
  basis.sourceIdentity.sourceId = `${basisId}-SOURCE`;
  basis.sourceIdentity.revision = `${basisId}-REV`;
  basis.sourceIdentity.digest = `sha256:${String(2_000 + serial).padStart(64, '0')}`;
  basis.producer.actorId = `${basisId}-PRODUCER`;
  basis.verifier.actorId = `${basisId}-VERIFIER`;
  basis.verifier.ownerId = `${basisId}-VERIFIER-OWNER`;
  basis.validator.validatorId = `${basisId}-VALIDATOR`;
  basis.validator.version = `${basisId}-VALIDATOR-V1`;
  basis.producer.failureDomains = basis.producer.failureDomains.map((entry) => ({
    ...entry,
    id: `${basisId}-PRODUCER-${entry.class}`,
  }));
  basis.verifier.failureDomains = basis.verifier.failureDomains.map((entry) => ({
    ...entry,
    id: `${basisId}-VERIFIER-${entry.class}`,
  }));
  basis.certifiesEvidenceIds = [evidenceId];
  return [evidence, basis];
};
const evaluate = (packet) => evaluateAssuranceCase(
  packet,
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  FIXTURE_NOW_MS,
);

test('combined claim/evidence DAG depth is rejected before recursive evaluation', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  const template = evidenceById(packet, 'PA-S4-EVIDENCE-001');
  const basisTemplate = evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-001');
  let dependency = 'PA-S4-EVIDENCE-001';
  for (let position = 1; position <= SCHEMA_LIMITS.maxInvalidationPathLength; position += 1) {
    const evidenceId = `PA-S4-DEPTH-${String(position).padStart(3, '0')}`;
    packet.evidence.push(...uniquePair(template, basisTemplate, evidenceId, [dependency], position));
    dependency = evidenceId;
  }
  const claim = packet.claims.find((entry) => entry.claimId === 'PA-S4-CLAIM-001');
  claim.supportingEvidenceIds.push(dependency);
  claim.componentDrillDown[0].supportingEvidenceIds.push(dependency);
  const issues = validateAssuranceCasePacket(packet);
  assert(issues.some((entry) => entry.code === 'ASSURANCE_GRAPH_DEPTH_EXCEEDED'));
  const result = evaluate(packet);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.claimResults.length, 0);
  assert(result.reasonCodes.includes('ASSURANCE_PACKET_INVALID'));
});

test('branching reverse invalidation is hard-bounded and reports truncation', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  const origin = evidenceById(packet, 'PA-S4-EVIDENCE-001');
  const template = clonePlainData(origin);
  const basisTemplate = clonePlainData(evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-001'));
  origin.result = 'FAIL';
  origin.reasonCode = 'SOURCE_FAIL_BOUND_TEST';
  let previous = [origin.evidenceId];
  let serial = 1;
  for (let layer = 1; layer <= 12; layer += 1) {
    const current = ['A', 'B'].map((suffix) => `PA-S4-BRANCH-${String(layer).padStart(2, '0')}-${suffix}`);
    for (const evidenceId of current) {
      packet.evidence.push(...uniquePair(template, basisTemplate, evidenceId, [...previous], serial));
      serial += 1;
    }
    previous = current;
  }
  const claim = packet.claims.find((entry) => entry.claimId === 'PA-S4-CLAIM-001');
  claim.supportingEvidenceIds = [origin.evidenceId, ...previous];
  claim.componentDrillDown[0].supportingEvidenceIds = [origin.evidenceId, ...previous];
  assert.deepEqual(validateAssuranceCasePacket(packet), []);
  const startedAt = performance.now();
  const result = evaluate(packet);
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.status, 'FAIL');
  assert.equal(result.invalidationTruncated, true);
  assert(result.reasonCodes.includes('INVALIDATION_PATHS_TRUNCATED'));
  assert(result.invalidationPaths.length <= SCHEMA_LIMITS.maxInvalidationPaths);
  assert.equal(result.safetyBoundary.supportUsableForNewAction, false);
  assert.deepEqual(
    result.evidenceResults.filter((entry) => entry.primitiveInvalidator).map((entry) => entry.evidenceId),
    [origin.evidenceId],
  );
  assert(elapsedMs < 2_000, `bounded traversal took ${elapsedMs}ms`);

  const reordered = clonePlainData(packet);
  reordered.claims.reverse();
  reordered.evidence.reverse();
  reordered.rootClaimIds.reverse();
  reordered.mandatoryClaimIds.reverse();
  for (const claimNode of reordered.claims) {
    claimNode.subclaimIds.reverse();
    claimNode.assumptionIds.reverse();
    claimNode.supportingEvidenceIds.reverse();
    claimNode.counterEvidenceIds.reverse();
    claimNode.componentDrillDown.reverse();
    for (const component of claimNode.componentDrillDown) component.supportingEvidenceIds.reverse();
  }
  for (const evidenceNode of reordered.evidence) {
    evidenceNode.derivedFromClaimIds.reverse();
    evidenceNode.derivedFromEvidenceIds.reverse();
    evidenceNode.certifiesEvidenceIds.reverse();
    evidenceNode.independence.basisEvidenceIds.reverse();
    evidenceNode.independence.commonModeDependencyIds.reverse();
    evidenceNode.producer.failureDomains.reverse();
    evidenceNode.verifier.failureDomains.reverse();
  }
  for (const ids of Object.values(reordered.diagnosticPlane).filter(Array.isArray)) ids.reverse();
  const reorderedResult = evaluate(reordered);
  assert.equal(reorderedResult.invalidationTruncated, true);
  assert.equal(canonicalStringify(reorderedResult), canonicalStringify(result));
});
