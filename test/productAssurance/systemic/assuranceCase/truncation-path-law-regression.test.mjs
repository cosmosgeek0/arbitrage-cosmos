import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  SCHEMA_LIMITS,
  buildAssuranceCaseViewModel,
  canonicalEvidenceStatement,
  clonePlainData,
  evaluateAssuranceCase,
  validateAssuranceCasePacket,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const claimById = (packet, claimId) => (
  packet.claims.find((claim) => claim.claimId === claimId)
);

const evidenceById = (packet, evidenceId) => (
  packet.evidence.find((evidence) => evidence.evidenceId === evidenceId)
);

const evaluate = (packet) => evaluateAssuranceCase(
  packet,
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  FIXTURE_NOW_MS,
);

const assertViewRejects = (evaluation, label) => {
  const view = buildAssuranceCaseViewModel(evaluation);
  assert.equal(view.status, 'UNKNOWN', label);
  assert.deepEqual(view.summary.reasonCodes, ['EVALUATION_INVALID'], label);
};

const uniqueBranchPair = (evidenceTemplate, basisTemplate, evidenceId, dependencies, serial) => {
  const evidence = clonePlainData(evidenceTemplate);
  const basis = clonePlainData(basisTemplate);
  const basisId = `${evidenceId}-BASIS`;

  evidence.evidenceId = evidenceId;
  evidence.statement = canonicalEvidenceStatement(evidence);
  evidence.sourceIdentity.sourceId = `${evidenceId}-SOURCE`;
  evidence.sourceIdentity.revision = `${evidenceId}-REV`;
  evidence.sourceIdentity.digest = `sha256:${String(1_000 + serial).padStart(64, '0')}`;
  evidence.producer.actorId = `${evidenceId}-PRODUCER`;
  evidence.producer.failureDomains = evidence.producer.failureDomains.map((domain) => ({
    ...domain,
    id: `${evidenceId}-PRODUCER-${domain.class}`,
  }));
  evidence.verifier.actorId = `${evidenceId}-VERIFIER`;
  evidence.verifier.ownerId = `${evidenceId}-VERIFIER-OWNER`;
  evidence.verifier.failureDomains = evidence.verifier.failureDomains.map((domain) => ({
    ...domain,
    id: `${evidenceId}-VERIFIER-${domain.class}`,
  }));
  evidence.validator.validatorId = `${evidenceId}-VALIDATOR`;
  evidence.validator.version = `${evidenceId}-VALIDATOR-V1`;
  evidence.independence.basisEvidenceIds = [basisId];
  evidence.derivedFromClaimIds = [];
  evidence.derivedFromEvidenceIds = dependencies;

  basis.evidenceId = basisId;
  basis.statement = canonicalEvidenceStatement(basis);
  basis.sourceIdentity.sourceId = `${basisId}-SOURCE`;
  basis.sourceIdentity.revision = `${basisId}-REV`;
  basis.sourceIdentity.digest = `sha256:${String(2_000 + serial).padStart(64, '0')}`;
  basis.producer.actorId = `${basisId}-PRODUCER`;
  basis.producer.failureDomains = basis.producer.failureDomains.map((domain) => ({
    ...domain,
    id: `${basisId}-PRODUCER-${domain.class}`,
  }));
  basis.verifier.actorId = `${basisId}-VERIFIER`;
  basis.verifier.ownerId = `${basisId}-VERIFIER-OWNER`;
  basis.verifier.failureDomains = basis.verifier.failureDomains.map((domain) => ({
    ...domain,
    id: `${basisId}-VERIFIER-${domain.class}`,
  }));
  basis.validator.validatorId = `${basisId}-VALIDATOR`;
  basis.validator.version = `${basisId}-VALIDATOR-V1`;
  basis.certifiesEvidenceIds = [evidenceId];
  return [evidence, basis];
};

const buildCappedPacket = ({ failLaterEvidence = false } = {}) => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  const origin = evidenceById(packet, 'PA-S4-EVIDENCE-001');
  const evidenceTemplate = clonePlainData(origin);
  const basisTemplate = clonePlainData(evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-001'));
  origin.result = 'FAIL';
  origin.reasonCode = 'SOURCE_FAIL_TRUNCATION_BRANCH_ORIGIN';

  let previous = [origin.evidenceId];
  let serial = 1;
  for (let layer = 1; layer <= 12; layer += 1) {
    const current = ['A', 'B'].map((suffix) => (
      `PA-S4-TRUNCATION-BRANCH-${String(layer).padStart(2, '0')}-${suffix}`
    ));
    for (const evidenceId of current) {
      packet.evidence.push(...uniqueBranchPair(
        evidenceTemplate,
        basisTemplate,
        evidenceId,
        [...previous],
        serial,
      ));
      serial += 1;
    }
    previous = current;
  }

  const firstClaim = claimById(packet, 'PA-S4-CLAIM-001');
  firstClaim.supportingEvidenceIds = [origin.evidenceId, ...previous];
  firstClaim.componentDrillDown[0].supportingEvidenceIds = [origin.evidenceId, ...previous];

  if (failLaterEvidence) {
    const laterOrigin = evidenceById(packet, 'PA-S4-EVIDENCE-010');
    laterOrigin.result = 'FAIL';
    laterOrigin.reasonCode = 'SOURCE_FAIL_LATER_INDEPENDENT_ORIGIN';
  }

  assert.deepEqual(validateAssuranceCasePacket(packet), []);
  return packet;
};

test('truncated invalidation paths are an exact canonical sequence', () => {
  const evaluation = evaluate(buildCappedPacket());
  assert.equal(evaluation.invalidationTruncated, true);
  assert.equal(evaluation.invalidationPaths.length, SCHEMA_LIMITS.maxInvalidationPaths);
  assert.notDeepEqual(
    buildAssuranceCaseViewModel(evaluation).summary.reasonCodes,
    ['EVALUATION_INVALID'],
  );

  const removed = {
    ...evaluation,
    invalidationPaths: evaluation.invalidationPaths.filter((_, index) => index !== 1),
  };
  assertViewRejects(removed, 'removing an expected truncated path must be rejected');

  const duplicatedPaths = [...evaluation.invalidationPaths];
  duplicatedPaths[1] = duplicatedPaths[0];
  const duplicated = { ...evaluation, invalidationPaths: duplicatedPaths };
  assertViewRejects(duplicated, 'duplicating an expected truncated path must be rejected');

  const seenClaims = new Set();
  const filtered = {
    ...evaluation,
    invalidationPaths: evaluation.invalidationPaths.filter((path) => {
      if (seenClaims.has(path.dependentClaimId)) return false;
      seenClaims.add(path.dependentClaimId);
      return true;
    }),
  };
  assertViewRejects(filtered, 'filtering to one path per claim must be rejected');

  const reordered = { ...evaluation, invalidationPaths: [...evaluation.invalidationPaths].reverse() };
  assertViewRejects(reordered, 'reordering the canonical truncated path sequence must be rejected');
});

test('truncation preserves at least one invalidation path for every non-PASS claim', () => {
  const evaluation = evaluate(buildCappedPacket({ failLaterEvidence: true }));
  assert.equal(evaluation.invalidationTruncated, true);
  assert.equal(evaluation.invalidationPaths.length, SCHEMA_LIMITS.maxInvalidationPaths);

  const nonPassClaimIds = evaluation.claimResults
    .filter((claim) => claim.result !== 'PASS')
    .map((claim) => claim.claimId);
  const coveredClaimIds = new Set(evaluation.invalidationPaths.map((path) => path.dependentClaimId));
  assert(nonPassClaimIds.includes('PA-S4-CLAIM-010'));
  for (const claimId of nonPassClaimIds) {
    assert(coveredClaimIds.has(claimId), `${claimId} must retain a path at the 1024-path cap`);
  }
  assert(evaluation.invalidationPaths.some((path) => (
    path.originId === 'PA-S4-EVIDENCE-010'
    && path.dependentClaimId === 'PA-S4-CLAIM-010'
  )));

  const view = buildAssuranceCaseViewModel(evaluation);
  assert.equal(view.status, 'FAIL');
  assert(!view.summary.reasonCodes.includes('EVALUATION_INVALID'));
  assert(!view.summary.reasonCodes.includes('EVALUATION_CAPTURE_FAILED'));
});
