import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  SCHEMA_LIMITS,
  buildAssuranceCaseViewModel,
  buildCompleteConfiguredDiagnosticFixture,
  canonicalEvidenceStatement,
  clonePlainData,
  evaluateAssuranceCase,
  validateAssuranceCasePacket,
  validateS1AssumptionProjection,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const claimById = (packet, claimId) => (
  packet.claims.find((claim) => claim.claimId === claimId)
);
const evidenceById = (packet, evidenceId) => (
  packet.evidence.find((evidence) => evidence.evidenceId === evidenceId)
);
const evaluatedEvidenceById = (evaluation, evidenceId) => (
  evaluation.evidenceResults.find((evidence) => evidence.evidenceId === evidenceId)
);
const evaluate = (packet) => evaluateAssuranceCase(
  packet,
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  FIXTURE_NOW_MS,
);

const assertValidatorRejectsWithoutThrowing = (label, validator, input) => {
  let issues;
  assert.doesNotThrow(() => { issues = validator(input); }, label);
  assert(Array.isArray(issues), `${label}: validator must return an issue array`);
  assert(issues.length > 0, `${label}: malformed input must return at least one issue`);
};

test('exported packet and S1 validators never throw on malformed nested arrays or objects', () => {
  const packetCases = [
    ['packet root ID object', (packet) => { packet.rootClaimIds = [{}]; }],
    ['packet subclaim ID object', (packet) => { packet.claims[0].subclaimIds = [{}]; }],
    ['packet evidence dependency object', (packet) => { packet.evidence[0].derivedFromEvidenceIds = [{}]; }],
    ['packet failure-domain object', (packet) => { packet.evidence[0].producer.failureDomains = [{}]; }],
    ['packet component object', (packet) => { packet.claims[0].componentDrillDown = [{}]; }],
  ];
  for (const [label, mutate] of packetCases) {
    const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
    mutate(packet);
    assertValidatorRejectsWithoutThrowing(label, validateAssuranceCasePacket, packet);
  }

  const s1Cases = [
    ['S1 assumption array object', (projection) => { projection.assumptionResults = [{}]; }],
    ['S1 assumption ID object', (projection) => { projection.assumptionResults[0].assumptionId = {}; }],
    ['S1 stale boundary object', (projection) => { projection.assumptionResults[0].staleAtMs = {}; }],
    ['S1 projection clock object', (projection) => { projection.evaluatedAtMs = {}; }],
  ];
  for (const [label, mutate] of s1Cases) {
    const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
    mutate(projection);
    assertValidatorRejectsWithoutThrowing(label, validateS1AssumptionProjection, projection);
  }
});

const configuredDiagnosticPair = (packet) => {
  const first = evidenceById(packet, packet.diagnosticPlane.containmentEvidenceIds[0]);
  const second = evidenceById(packet, packet.diagnosticPlane.privacyEvidenceIds[0]);
  return [first, second];
};

for (const scenario of [
  {
    name: 'configured diagnostic main evidence',
    packetIssueCodes: ['DIAGNOSTIC_ACTOR_ALIAS'],
    records(packet) {
      return configuredDiagnosticPair(packet);
    },
  },
  {
    name: 'configured diagnostic independence bases',
    packetIssueCodes: ['INDEPENDENCE_BASIS_ACTOR_ALIAS', 'DIAGNOSTIC_BASIS_ACTOR_ALIAS'],
    records(packet) {
      return configuredDiagnosticPair(packet).map((evidence) => (
        evidenceById(packet, evidence.independence.basisEvidenceIds[0])
      ));
    },
  },
]) {
  test(`${scenario.name} reject a producer/verifier cross-role actor alias in packet and view`, () => {
    const packet = clonePlainData(buildCompleteConfiguredDiagnosticFixture('ACTIVE'));
    const [first, second] = scenario.records(packet);
    second.producer.actorId = first.verifier.actorId;
    const codes = new Set(validateAssuranceCasePacket(packet).map((issue) => issue.code));
    for (const code of scenario.packetIssueCodes) {
      assert(codes.has(code), `${code}: ${[...codes].join(',')}`);
    }

    const validPacket = buildCompleteConfiguredDiagnosticFixture('ACTIVE');
    const evaluation = clonePlainData(evaluate(validPacket));
    const [firstSource, secondSource] = scenario.records(validPacket);
    const firstResult = evaluatedEvidenceById(evaluation, firstSource.evidenceId);
    const secondResult = evaluatedEvidenceById(evaluation, secondSource.evidenceId);
    secondResult.producerId = firstResult.verifierId;
    const view = buildAssuranceCaseViewModel(evaluation);
    assert.equal(view.status, 'UNKNOWN');
    assert.deepEqual(view.summary.reasonCodes, ['EVALUATION_INVALID']);
  });
}

for (const [name, createdAtMs, lastVerifiedAtMs, expectedFreshness] of [
  ['not-yet-valid evidence', FIXTURE_NOW_MS + 1_000, FIXTURE_NOW_MS + 2_000, 'NOT_YET_VALID'],
  ['future verification readback', FIXTURE_NOW_MS - 1_000, FIXTURE_NOW_MS + 2_000, 'INCOHERENT'],
]) {
  test(`${name} anchors invalidation and SLO origins no later than evaluation time`, () => {
    const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
    const evidence = evidenceById(packet, 'PA-S4-EVIDENCE-004');
    evidence.createdAtMs = createdAtMs;
    evidence.lastVerifiedAtMs = lastVerifiedAtMs;
    evidence.expiresAtMs = FIXTURE_NOW_MS + 20_000;
    assert.deepEqual(validateAssuranceCasePacket(packet), []);

    const evaluation = evaluate(packet);
    const evaluatedEvidence = evaluatedEvidenceById(evaluation, evidence.evidenceId);
    const directClaim = evaluation.claimResults.find((claim) => claim.claimId === 'PA-S4-CLAIM-004');
    assert.equal(evaluatedEvidence.freshnessStatus, expectedFreshness);
    assert.equal(evaluatedEvidence.result, 'UNKNOWN');
    assert.equal(evaluatedEvidence.localInvalidatedAtMs, evaluation.evaluatedAtMs);
    assert.equal(evaluatedEvidence.invalidatedAtMs, evaluation.evaluatedAtMs);
    assert.equal(directClaim.invalidatedAtMs, evaluation.evaluatedAtMs);

    const originPaths = evaluation.invalidationPaths.filter((path) => (
      path.originType === 'EVIDENCE' && path.originId === evidence.evidenceId
    ));
    assert(originPaths.length > 0);
    for (const path of originPaths) {
      assert(path.originInvalidAtMs <= evaluation.evaluatedAtMs);
      assert.equal(path.projectionDueAtMs, path.originInvalidAtMs + path.propagationSloMs);
      assert(path.observedAtMs >= path.originInvalidAtMs);
    }

    const deadlines = evaluation.recomputation.affectedClaimDeadlines.filter((deadline) => (
      deadline.invalidatedAtMs !== null
    ));
    assert(deadlines.length > 0);
    for (const deadline of deadlines) {
      assert(deadline.invalidatedAtMs <= evaluation.evaluatedAtMs);
      assert.equal(deadline.assuranceDueAtMs, deadline.invalidatedAtMs + deadline.assuranceSloMs);
    }
    assert(evaluation.recomputation.originInvalidatedAtMs <= evaluation.evaluatedAtMs);

    const view = buildAssuranceCaseViewModel(evaluation);
    assert.equal(view.status, 'UNKNOWN');
    assert(!view.summary.reasonCodes.includes('EVALUATION_INVALID'));
    assert(!view.summary.reasonCodes.includes('EVALUATION_CAPTURE_FAILED'));
  });
}

const detachResolvedDiagnosticEvidence = () => {
  const packet = clonePlainData(buildCompleteConfiguredDiagnosticFixture('ACTIVE'));
  const evidenceId = packet.diagnosticPlane.privacyEvidenceIds[0];
  const claim = claimById(packet, 'PA-S4-CLAIM-013');
  claim.supportingEvidenceIds = claim.supportingEvidenceIds.filter((id) => id !== evidenceId);
  claim.componentDrillDown[0].supportingEvidenceIds = (
    claim.componentDrillDown[0].supportingEvidenceIds.filter((id) => id !== evidenceId)
  );
  return { packet, evidenceId };
};

const detachMissingDiagnosticEvidence = () => {
  const { packet, evidenceId: resolvedEvidenceId } = detachResolvedDiagnosticEvidence();
  const resolved = evidenceById(packet, resolvedEvidenceId);
  const basisId = resolved.independence.basisEvidenceIds[0];
  const evidenceId = 'PA-S4-DIAGNOSTIC-PRIVACY-EVIDENCE-MISSING';
  packet.diagnosticPlane.privacyEvidenceIds = [evidenceId];
  packet.evidence = packet.evidence.filter((entry) => (
    entry.evidenceId !== resolvedEvidenceId && entry.evidenceId !== basisId
  ));
  return { packet, evidenceId };
};

for (const scenario of [
  {
    name: 'resolved ID',
    build: detachResolvedDiagnosticEvidence,
    expectedIssueCodes: ['DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM'],
    evidenceShouldResolve: true,
  },
  {
    name: 'missing ID',
    build: detachMissingDiagnosticEvidence,
    expectedIssueCodes: [
      'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM',
      'DIAGNOSTIC_EVIDENCE_REFERENCE_UNKNOWN',
    ],
    evidenceShouldResolve: false,
  },
]) {
  test(`configured nonfatal unbound diagnostic ${scenario.name} renders detailed UNKNOWN`, () => {
    const { packet, evidenceId } = scenario.build();
    const issues = validateAssuranceCasePacket(packet);
    const issueCodes = [...new Set(issues.map((issue) => issue.code))].sort();
    assert.deepEqual(issueCodes, [...scenario.expectedIssueCodes].sort());

    const evaluation = evaluate(packet);
    assert.equal(evaluation.status, 'UNKNOWN');
    assert.deepEqual(
      [...new Set(evaluation.packetIssues.map((issue) => issue.code))].sort(),
      [...scenario.expectedIssueCodes].sort(),
    );
    const diagnosticClaim = evaluation.claimResults.find((claim) => claim.claimId === 'PA-S4-CLAIM-013');
    assert.equal(diagnosticClaim.result, 'UNKNOWN');
    assert(diagnosticClaim.invalidatingEvidenceIds.includes(evidenceId));
    assert(evaluation.diagnosticPlane.reasonCodes.includes('DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM'));

    const view = buildAssuranceCaseViewModel(evaluation);
    assert.equal(view.status, 'UNKNOWN');
    assert(!view.summary.reasonCodes.includes('EVALUATION_INVALID'));
    assert(!view.summary.reasonCodes.includes('EVALUATION_CAPTURE_FAILED'));
    assert.equal(view.claims.length, 13);
    const renderedClaim = view.claims.find((claim) => claim.claimId === 'PA-S4-CLAIM-013');
    assert.equal(renderedClaim.status, 'UNKNOWN');
    assert(renderedClaim.invalidatingEvidenceIds.includes(evidenceId));
    assert.equal(
      view.evidence.some((evidence) => evidence.evidenceId === evidenceId),
      scenario.evidenceShouldResolve,
    );
    assert(view.invalidationPaths.some((path) => (
      path.originType === 'DIAGNOSTIC'
      && path.originId === 'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM'
      && path.dependentClaimId === 'PA-S4-CLAIM-013'
    )));
    if (!scenario.evidenceShouldResolve) {
      assert(view.invalidationPaths.some((path) => (
        path.originType === 'EVIDENCE'
        && path.originId === evidenceId
        && path.originFreshnessStatus === 'EVIDENCE_MISSING'
      )));
    }
  });
}

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

test('a valid 12-layer 1024-path truncation crosses the view boundary as FAIL and truncated', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  const origin = evidenceById(packet, 'PA-S4-EVIDENCE-001');
  const evidenceTemplate = clonePlainData(origin);
  const basisTemplate = clonePlainData(evidenceById(packet, 'PA-S4-INDEPENDENCE-BASIS-001'));
  origin.result = 'FAIL';
  origin.reasonCode = 'SOURCE_FAIL_CLOSURE_BRANCH_ORIGIN';

  let previous = [origin.evidenceId];
  let serial = 1;
  for (let layer = 1; layer <= 12; layer += 1) {
    const current = ['A', 'B'].map((suffix) => (
      `PA-S4-CLOSURE-BRANCH-${String(layer).padStart(2, '0')}-${suffix}`
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

  const claim = claimById(packet, 'PA-S4-CLAIM-001');
  claim.supportingEvidenceIds = [origin.evidenceId, ...previous];
  claim.componentDrillDown[0].supportingEvidenceIds = [origin.evidenceId, ...previous];
  assert.deepEqual(validateAssuranceCasePacket(packet), []);

  const evaluation = evaluate(packet);
  assert.equal(evaluation.status, 'FAIL');
  assert.equal(evaluation.invalidationTruncated, true);
  assert.equal(evaluation.invalidationPaths.length, SCHEMA_LIMITS.maxInvalidationPaths);
  assert.equal(evaluation.invalidationPaths.length, 1_024);
  assert(evaluation.reasonCodes.includes('INVALIDATION_PATHS_TRUNCATED'));

  const view = buildAssuranceCaseViewModel(evaluation);
  assert.equal(view.status, 'FAIL');
  assert.equal(view.summary.invalidationTruncated, true);
  assert.equal(view.summary.invalidationPathCount, 1_024);
  assert(view.summary.reasonCodes.includes('INVALIDATION_PATHS_TRUNCATED'));
  assert(!view.summary.reasonCodes.includes('EVALUATION_CAPTURE_FAILED'));
  assert(!view.summary.reasonCodes.includes('EVALUATION_INVALID'));
});
