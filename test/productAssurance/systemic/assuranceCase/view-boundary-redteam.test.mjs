import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  SCHEMA_LIMITS,
  buildAssuranceCaseViewModel,
  buildCompleteConfiguredDiagnosticFixture,
  buildExpiredEvidenceFixture,
  buildFailedAssumptionProjection,
  buildIncompleteConfiguredDiagnosticFixture,
  clonePlainData,
  evaluateAssuranceCase,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet = COMPLETE_ASSURANCE_CASE_FIXTURE) => evaluateAssuranceCase(
  packet,
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  FIXTURE_NOW_MS,
);

const evidenceById = (evaluation, evidenceId) => (
  evaluation.evidenceResults.find((entry) => entry.evidenceId === evidenceId)
);

const evidenceByPurpose = (evaluation, purpose) => (
  evaluation.evidenceResults.find((entry) => entry.purpose === purpose)
);

const assertViewRejects = (evaluation) => {
  const view = buildAssuranceCaseViewModel(evaluation);
  assert.equal(view.status, 'UNKNOWN');
  assert.deepEqual(view.summary.reasonCodes, ['EVALUATION_INVALID']);
};

test('view rejects a self-referential evidence dependency cycle', () => {
  const evaluation = clonePlainData(evaluate());
  const evidence = evidenceById(evaluation, 'PA-S4-EVIDENCE-001');
  evidence.derivedFromEvidenceIds = [evidence.evidenceId];
  assertViewRejects(evaluation);
});

test('view rejects a multi-node evidence dependency cycle', () => {
  const evaluation = clonePlainData(evaluate());
  const first = evidenceById(evaluation, 'PA-S4-EVIDENCE-001');
  const second = evidenceById(evaluation, 'PA-S4-EVIDENCE-002');
  first.derivedFromEvidenceIds = [second.evidenceId];
  second.derivedFromEvidenceIds = [first.evidenceId];
  assertViewRejects(evaluation);
});

test('view rejects PASS S1 support with no declared stale boundary', () => {
  const evaluation = clonePlainData(evaluate());
  const assumption = evaluation.assumptionResults.find((entry) => entry.result === 'PASS');
  assumption.staleAtMs = null;
  assertViewRejects(evaluation);
});

test('view rejects PASS S1 support whose stale boundary predates its evaluation', () => {
  const evaluation = clonePlainData(evaluate());
  const assumption = evaluation.assumptionResults.find((entry) => entry.result === 'PASS');
  assumption.staleAtMs = assumption.sourceEvaluatedAtMs - 1;
  assertViewRejects(evaluation);
});

test('view rejects forged CURRENT freshness on a missing diagnostic path', () => {
  const evaluation = clonePlainData(evaluate(buildIncompleteConfiguredDiagnosticFixture()));
  const missingPath = evaluation.invalidationPaths.find((entry) => entry.originType === 'DIAGNOSTIC');
  assert(missingPath);
  missingPath.originFreshnessStatus = 'CURRENT';
  assertViewRejects(evaluation);
});

test('view rejects configured diagnostic common mode shared across producer and verifier legs', () => {
  const evaluation = clonePlainData(evaluate(buildCompleteConfiguredDiagnosticFixture('ACTIVE')));
  const containment = evidenceByPurpose(evaluation, 'DIAGNOSTIC_CONTAINMENT');
  const privacy = evidenceByPurpose(evaluation, 'DIAGNOSTIC_PRIVACY');
  privacy.producerFailureDomains[0] = clonePlainData(containment.verifierFailureDomains[0]);
  assertViewRejects(evaluation);
});

test('view rejects semantic clones among configured diagnostic independence bases', () => {
  const evaluation = clonePlainData(evaluate(buildCompleteConfiguredDiagnosticFixture('ACTIVE')));
  const containment = evidenceByPurpose(evaluation, 'DIAGNOSTIC_CONTAINMENT');
  const privacy = evidenceByPurpose(evaluation, 'DIAGNOSTIC_PRIVACY');
  const sourceBasis = evidenceById(evaluation, containment.independenceBasisEvidenceIds[0]);
  const clonedBasis = evidenceById(evaluation, privacy.independenceBasisEvidenceIds[0]);

  clonedBasis.sourceIdentity = clonePlainData(sourceBasis.sourceIdentity);
  clonedBasis.validator = clonePlainData(sourceBasis.validator);
  clonedBasis.producerId = sourceBasis.producerId;
  clonedBasis.producerOwnerId = sourceBasis.producerOwnerId;
  clonedBasis.producerFailureDomains = clonePlainData(sourceBasis.producerFailureDomains);
  clonedBasis.verifierId = sourceBasis.verifierId;
  clonedBasis.verifierOwnerId = sourceBasis.verifierOwnerId;
  clonedBasis.verifierFailureDomains = clonePlainData(sourceBasis.verifierFailureDomains);

  assertViewRejects(evaluation);
});

test('view rejects a verifier owner shared by configured diagnostic families', () => {
  const evaluation = clonePlainData(evaluate(buildCompleteConfiguredDiagnosticFixture('ACTIVE')));
  const containment = evidenceByPurpose(evaluation, 'DIAGNOSTIC_CONTAINMENT');
  const privacy = evidenceByPurpose(evaluation, 'DIAGNOSTIC_PRIVACY');
  privacy.verifierOwnerId = containment.verifierOwnerId;
  assertViewRejects(evaluation);
});

test('view rejects malformed identifiers at a security-sensitive evidence boundary', () => {
  const evaluation = clonePlainData(evaluate());
  evidenceById(evaluation, 'PA-S4-EVIDENCE-001').verifierOwnerId = 'INVALID OWNER';
  assertViewRejects(evaluation);
});

test('view rejects malformed evidence digests', () => {
  const evaluation = clonePlainData(evaluate());
  evidenceById(evaluation, 'PA-S4-EVIDENCE-001').sourceIdentity.digest = 'sha256:not-a-real-digest';
  assertViewRejects(evaluation);
});

test('view rejects oversized reason identifiers', () => {
  const evaluation = clonePlainData(evaluate());
  evidenceById(evaluation, 'PA-S4-EVIDENCE-001').reasonCodes = [
    `R${'X'.repeat(SCHEMA_LIMITS.maxIdLength)}`,
  ];
  assertViewRejects(evaluation);
});

test('configured missing evidence cannot overwrite a definite diagnostic FAIL', () => {
  const packet = clonePlainData(buildIncompleteConfiguredDiagnosticFixture());
  const failedEvidence = packet.evidence.find((entry) => entry.purpose === 'DIAGNOSTIC_CONTAINMENT');
  failedEvidence.result = 'FAIL';
  failedEvidence.reasonCode = 'SOURCE_FAIL_DIAGNOSTIC_CONTAINMENT';

  const evaluation = evaluate(packet);
  assert.equal(evaluation.status, 'FAIL');
  assert.equal(
    evaluation.claimResults.find((entry) => entry.claimId === 'PA-S4-CLAIM-013').result,
    'FAIL',
  );

  const view = buildAssuranceCaseViewModel(evaluation);
  assert.notDeepEqual(view.summary.reasonCodes, ['EVALUATION_INVALID']);
  assert.equal(view.status, 'FAIL');
  assert.equal(view.claims.find((entry) => entry.claimId === 'PA-S4-CLAIM-013').status, 'FAIL');
});

test('view accepts current evidence with a valid max-TTL age above the SLO ceiling', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  const evidence = packet.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-001');
  evidence.maximumAgeMs = SCHEMA_LIMITS.maxTtlMs;
  evidence.lastVerifiedAtMs = FIXTURE_NOW_MS - SCHEMA_LIMITS.maxSloMs - 1;
  evidence.createdAtMs = evidence.lastVerifiedAtMs - 1_000;
  evidence.expiresAtMs = FIXTURE_NOW_MS + SCHEMA_LIMITS.maxSloMs;

  const evaluation = evaluate(packet);
  assert.equal(evaluation.status, 'PASS');
  const view = buildAssuranceCaseViewModel(evaluation);
  assert.equal(view.status, 'PASS');
  const renderedEvidence = view.evidence.find((entry) => entry.evidenceId === evidence.evidenceId);
  assert.equal(renderedEvidence.status, 'PASS');
  assert.equal(renderedEvidence.maximumAgeMs, SCHEMA_LIMITS.maxTtlMs);
  assert(renderedEvidence.ageMs > SCHEMA_LIMITS.maxSloMs);
});

test('nontruncated views require every path from every primitive invalidator', () => {
  const evaluation = clonePlainData(evaluateAssuranceCase(
    buildExpiredEvidenceFixture('PA-S4-EVIDENCE-004'),
    buildFailedAssumptionProjection('PA-S1-AS-008'),
    FIXTURE_NOW_MS,
  ));
  assert.equal(evaluation.invalidationTruncated, false);
  assert(evaluation.invalidationPaths.some((path) => path.originId === 'PA-S4-EVIDENCE-004'));
  assert(evaluation.invalidationPaths.some((path) => path.originId === 'PA-S1-AS-008'));

  evaluation.invalidationPaths = evaluation.invalidationPaths.filter((path) => (
    path.originId !== 'PA-S1-AS-008'
  ));
  const coveredClaimIds = new Set(evaluation.invalidationPaths.map((path) => path.dependentClaimId));
  assert(evaluation.claimResults
    .filter((claim) => claim.result !== 'PASS')
    .every((claim) => coveredClaimIds.has(claim.claimId)));

  assertViewRejects(evaluation);
});

test('assumption and subclaim invalidation close component support and forged green rows are rejected', () => {
  const assumptionEvaluation = evaluateAssuranceCase(
    COMPLETE_ASSURANCE_CASE_FIXTURE,
    buildFailedAssumptionProjection('PA-S1-AS-008'),
    FIXTURE_NOW_MS,
  );
  const assumptionAffected = assumptionEvaluation.claimResults.find((claim) => (
    claim.claimId === 'PA-S4-CLAIM-004'
  )).componentResults[0];
  assert.notEqual(assumptionAffected.result, 'PASS');
  assert.equal(assumptionAffected.supportUsableForNewAction, false);

  const subclaimEvaluation = evaluate(buildExpiredEvidenceFixture('PA-S4-EVIDENCE-004'));
  const subclaimAffected = subclaimEvaluation.claimResults.find((claim) => (
    claim.claimId === 'PA-S4-CLAIM-003'
  ));
  assert(subclaimAffected.invalidatingSubclaimIds.includes('PA-S4-CLAIM-004'));
  assert.deepEqual(subclaimAffected.componentResults[0].invalidatingEvidenceIds, []);
  assert.notEqual(subclaimAffected.componentResults[0].result, 'PASS');
  assert.equal(subclaimAffected.componentResults[0].supportUsableForNewAction, false);

  const forged = clonePlainData(subclaimEvaluation);
  const forgedComponent = forged.claimResults.find((claim) => (
    claim.claimId === 'PA-S4-CLAIM-003'
  )).componentResults[0];
  forgedComponent.result = 'PASS';
  forgedComponent.supportUsableForNewAction = true;
  assertViewRejects(forged);
});

test('view rejects self-consistent SLO inflation away from the pinned packet policy', () => {
  const evaluation = clonePlainData(evaluate(buildExpiredEvidenceFixture('PA-S4-EVIDENCE-004')));
  const inflatedPropagationSloMs = 2_000;
  const inflatedAssuranceSloMs = 6_000;

  for (const claim of evaluation.claimResults) {
    claim.propagationSloMs = inflatedPropagationSloMs;
    claim.assuranceSloMs = inflatedAssuranceSloMs;
  }
  for (const path of evaluation.invalidationPaths) {
    path.propagationSloMs = inflatedPropagationSloMs;
    path.projectionDueAtMs = path.originInvalidAtMs === null
      ? null
      : path.originInvalidAtMs + inflatedPropagationSloMs;
    path.propagationSloMet = path.projectionDueAtMs === null
      ? null
      : evaluation.evaluatedAtMs <= path.projectionDueAtMs;
  }
  evaluation.recomputation.assuranceSloMs = inflatedAssuranceSloMs;
  evaluation.recomputation.assuranceDueAtMs = evaluation.recomputation.originInvalidatedAtMs === null
    ? null
    : evaluation.recomputation.originInvalidatedAtMs + inflatedAssuranceSloMs;
  evaluation.recomputation.completedWithinDeclaredSlo = evaluation.recomputation.assuranceDueAtMs === null
    ? null
    : evaluation.evaluatedAtMs <= evaluation.recomputation.assuranceDueAtMs;
  for (const deadline of evaluation.recomputation.affectedClaimDeadlines) {
    deadline.assuranceSloMs = inflatedAssuranceSloMs;
    deadline.assuranceDueAtMs = deadline.invalidatedAtMs === null
      ? null
      : deadline.invalidatedAtMs + inflatedAssuranceSloMs;
    deadline.completedWithinDeclaredSlo = deadline.assuranceDueAtMs === null
      ? null
      : evaluation.evaluatedAtMs <= deadline.assuranceDueAtMs;
  }

  assertViewRejects(evaluation);
});

test('view rejects a forged claim whose combined support and counterevidence exceed the edge bound', () => {
  const evaluation = clonePlainData(evaluate());
  const claim = evaluation.claimResults.find((entry) => entry.claimId === 'PA-S4-CLAIM-004');
  const directTemplate = evidenceById(evaluation, 'PA-S4-EVIDENCE-004');
  const basisTemplate = evidenceById(evaluation, 'PA-S4-INDEPENDENCE-BASIS-004');
  evaluation.evidenceResults = evaluation.evidenceResults.filter((entry) => ![
    directTemplate.evidenceId,
    basisTemplate.evidenceId,
  ].includes(entry.evidenceId));

  const directEvidence = [];
  const basisEvidence = [];
  for (const [role, tag, offset] of [
    ['SUPPORT', 'SUP', 1_000],
    ['COUNTERCHECK', 'CTR', 2_000],
  ]) {
    for (let index = 0; index < 33; index += 1) {
      const serial = String(index + 1).padStart(3, '0');
      const digestSerial = offset + index;
      const direct = clonePlainData(directTemplate);
      const basis = clonePlainData(basisTemplate);

      direct.evidenceId = `PA-S4-FORGED-${tag}-${serial}`;
      direct.role = role;
      direct.sourceIdentity = {
        sourceId: `PA-S4-FORGED-SOURCE-${tag}-${serial}`,
        sourceType: direct.kind,
        revision: `PA-S4-FORGED-REV-${tag}-${serial}`,
        digest: `sha256:${digestSerial.toString(16).padStart(64, '0')}`,
      };
      direct.validator.validatorId = `PA-S4-FORGED-VALIDATOR-${tag}-${serial}`;
      direct.producerId = `PA-S4-FORGED-PRODUCER-${tag}-${serial}`;
      direct.verifierId = `PA-S4-FORGED-VERIFIER-${tag}-${serial}`;
      direct.verifierOwnerId = `IP-ASSURANCE.forged-verifier-${tag}-${serial}`;
      direct.producerFailureDomains = direct.producerFailureDomains.map((domain) => ({
        ...domain,
        id: `${domain.id}-${tag}-${serial}`,
      }));
      direct.verifierFailureDomains = direct.verifierFailureDomains.map((domain) => ({
        ...domain,
        id: `${domain.id}-${tag}-${serial}`,
      }));

      basis.evidenceId = `PA-S4-FORGED-BASIS-${tag}-${serial}`;
      basis.sourceIdentity = {
        sourceId: `PA-S4-FORGED-BASIS-SOURCE-${tag}-${serial}`,
        sourceType: basis.kind,
        revision: `PA-S4-FORGED-BASIS-REV-${tag}-${serial}`,
        digest: `sha256:${(digestSerial + 3_000).toString(16).padStart(64, '0')}`,
      };
      basis.validator.validatorId = `PA-S4-FORGED-BASIS-VALIDATOR-${tag}-${serial}`;
      basis.producerId = `PA-S4-FORGED-BASIS-PRODUCER-${tag}-${serial}`;
      basis.verifierId = `PA-S4-FORGED-BASIS-VERIFIER-${tag}-${serial}`;
      basis.verifierOwnerId = `IP-ASSURANCE.forged-basis-verifier-${tag}-${serial}`;
      basis.producerFailureDomains = basis.producerFailureDomains.map((domain) => ({
        ...domain,
        id: `${domain.id}-${tag}-${serial}`,
      }));
      basis.verifierFailureDomains = basis.verifierFailureDomains.map((domain) => ({
        ...domain,
        id: `${domain.id}-${tag}-${serial}`,
      }));

      direct.independenceBasisEvidenceIds = [basis.evidenceId];
      basis.certifiesEvidenceIds = [direct.evidenceId];
      directEvidence.push(direct);
      basisEvidence.push(basis);
    }
  }

  evaluation.evidenceResults.push(...directEvidence, ...basisEvidence);
  claim.supportingEvidenceIds = directEvidence
    .filter((entry) => entry.role === 'SUPPORT')
    .map((entry) => entry.evidenceId);
  claim.counterEvidenceIds = directEvidence
    .filter((entry) => entry.role === 'COUNTERCHECK')
    .map((entry) => entry.evidenceId);
  claim.componentResults[0].supportingEvidenceIds = [...claim.supportingEvidenceIds];

  assert.equal(claim.supportingEvidenceIds.length, 33);
  assert.equal(claim.counterEvidenceIds.length, 33);
  assertViewRejects(evaluation);
});
