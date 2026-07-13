import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  buildAssuranceCaseViewModel,
  buildCommonModeEvidenceFixture,
  buildCompleteConfiguredDiagnosticFixture,
  buildDerivedEvidenceExpiryFixture,
  buildExpiredEvidenceFixture,
  buildMissingEvidenceReferenceFixture,
  buildS1AssumptionProjection,
  clonePlainData,
  evaluateAssuranceCase,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet = COMPLETE_ASSURANCE_CASE_FIXTURE) => evaluateAssuranceCase(
  packet,
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  FIXTURE_NOW_MS,
);

test('render-neutral view preserves baseline truth without recomputation', () => {
  const evaluation = evaluate();
  const view = buildAssuranceCaseViewModel(evaluation);
  assert.equal(view.status, evaluation.status);
  assert.equal(view.summary.mandatoryClaimCount, 13);
  assert.equal(view.summary.passingClaimCount, 13);
  assert.equal(view.summary.failingClaimCount, 0);
  assert.equal(view.summary.unknownClaimCount, 0);
  assert.equal(view.summary.attentionRequired, false);
  assert.equal(view.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(view.authorityEffect, 'NONE');
  assert.equal(view.runtimeProjectionOwner, 'I08.machine-supervisor');
  assert.equal(view.summary.evidenceCount, 26);
  assert.equal(view.evidence.length, 26);
});

test('view exposes source, producer, verifier, failure domains, and independence basis', () => {
  const view = buildAssuranceCaseViewModel(evaluate());
  const evidence = view.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.sourceIdentity.sourceId, 'PA-S4-SOURCE-004');
  assert.equal(evidence.producer.ownerId, 'IP-ASSURANCE.invariant-atlas-owner');
  assert.match(evidence.verifier.ownerId, /^IP-ASSURANCE\.independent-verifier-/);
  assert(evidence.producer.failureDomains.length > 0);
  assert(evidence.verifier.failureDomains.length > 0);
  assert.deepEqual(evidence.independence.basisEvidenceIds, ['PA-S4-INDEPENDENCE-BASIS-004']);
});

test('view explains the exact common mode behind UNKNOWN support', () => {
  const view = buildAssuranceCaseViewModel(evaluate(buildCommonModeEvidenceFixture()));
  const evidence = view.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.equal(evidence.status, 'UNKNOWN');
  assert(evidence.reasonCodes.includes('COMMON_MODE_FAILURE_DOMAIN'));
  assert.deepEqual(evidence.independence.sharedFailureDomains, ['CLOCK:PRODUCER-CLOCK-004']);
});

test('view exposes invalidator, dependent path, SLO, age boundary, and owner', () => {
  const evaluation = evaluate(buildExpiredEvidenceFixture());
  const view = buildAssuranceCaseViewModel(evaluation);
  assert.equal(view.status, 'UNKNOWN');
  assert.equal(view.summary.attentionRequired, true);
  assert(view.invalidationPaths.length > 0);
  const path = view.invalidationPaths.find((entry) => entry.dependentClaimId === 'PA-S4-CLAIM-001');
  assert.equal(path.originId, 'PA-S4-EVIDENCE-004');
  assert.equal(path.originAgeMs, 1_000);
  assert.equal(path.originFreshnessStatus, 'EXPIRED');
  assert.equal(path.originInvalidAtMs, FIXTURE_NOW_MS);
  assert(path.path.length >= 5);
  assert.equal(path.supportUsableForNewAction, false);
  assert(path.projectionDueAtMs > path.observedAtMs);
  assert.equal(typeof path.ownerId, 'string');
  assert(view.recomputation.affectedClaimDeadlines.length > 0);
  assert(view.recomputation.affectedClaimDeadlines.every((deadline) => (
    deadline.assuranceDueAtMs === deadline.invalidatedAtMs + deadline.assuranceSloMs
  )));
});

test('view preserves a primitive local boundary when inherited invalidation is earlier', () => {
  const delayedNowMs = FIXTURE_NOW_MS + 6_000;
  const packet = clonePlainData(buildDerivedEvidenceExpiryFixture());
  packet.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-010').expiresAtMs = FIXTURE_NOW_MS + 3_000;
  const evaluation = evaluateAssuranceCase(
    packet,
    buildS1AssumptionProjection({ evaluatedAtMs: delayedNowMs }),
    delayedNowMs,
  );
  const view = buildAssuranceCaseViewModel(evaluation);
  assert.notDeepEqual(view.summary.reasonCodes, ['EVALUATION_INVALID']);
  const evidence = view.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-010');
  assert.equal(evidence.localInvalidatedAtMs, FIXTURE_NOW_MS + 3_000);
  assert.equal(evidence.invalidatedAtMs, FIXTURE_NOW_MS);
  const path = view.invalidationPaths.find((entry) => (
    entry.originId === 'PA-S4-EVIDENCE-010'
    && entry.dependentClaimId === 'PA-S4-CLAIM-010'
  ));
  assert.equal(path.originInvalidAtMs, FIXTURE_NOW_MS + 3_000);
});

test('view carries exact validators, owner paths, projections, component drill-down, and evidence statements', () => {
  const view = buildAssuranceCaseViewModel(evaluate());
  const claim = view.claims.find((entry) => entry.claimId === 'PA-S4-CLAIM-004');
  const evidence = view.evidence.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004');
  assert.deepEqual(claim.validator, {
    validatorId: 'PA-S4-DERIVED-CLAIM-EVALUATOR',
    version: 'PA-S4-DERIVED-CLAIM-EVALUATOR-V1',
  });
  assert.equal(claim.canonicalOwner.ownerId, 'IP-ASSURANCE.invariant-atlas-owner');
  assert.equal(claim.canonicalOwner.ownerPath, 'server/src/productAssurance/** canonical worker only');
  assert.equal(claim.resultConsumerOwner.ownerId, 'I08.machine-supervisor');
  assert.equal(claim.invariantProjection.eventRecommendationType, 'ASSURANCE_CLAIM_INVALIDATED');
  assert.equal(claim.cockpitProjection.surface, 'HEALTH');
  assert.equal(claim.componentResults[0].canonicalOwnerId, claim.canonicalOwner.ownerId);
  assert.equal(claim.componentResults[0].status, 'PASS');
  assert.match(evidence.statement, /Telemetry completeness/);
  assert.equal(evidence.validator.validatorId, 'PA-S4-VALIDATOR-004');
  assert.deepEqual(evidence.certifiesEvidenceIds, []);
});

test('view carries the explicit read-only LLM and prohibited-command boundary', () => {
  const view = buildAssuranceCaseViewModel(evaluate());
  assert.equal(view.safetyBoundary.readOnly, true);
  assert.equal(view.safetyBoundary.llmMayExplain, true);
  assert.equal(view.safetyBoundary.llmMayRestoreSupport, false);
  assert.deepEqual(view.safetyBoundary.prohibitedCommands, [
    'HALT', 'CLOSE', 'REPAIR', 'DEMOTION', 'DEPLOYMENT', 'CAPITAL',
    'ORDER', 'BORROW', 'REPAY', 'TRANSFER', 'WITHDRAWAL',
  ]);
  assert.equal(view.safetyBoundary.commandsIssued, 0);
});

test('missing evidence remains a bounded UNKNOWN with an explicit cockpit path', () => {
  const view = buildAssuranceCaseViewModel(evaluate(buildMissingEvidenceReferenceFixture()));
  assert.equal(view.status, 'UNKNOWN');
  const path = view.invalidationPaths.find((entry) => entry.originId === 'PA-S4-EVIDENCE-MISSING');
  assert(path);
  assert.equal(path.originType, 'EVIDENCE');
  assert.equal(path.originFreshnessStatus, 'EVIDENCE_MISSING');
  assert.equal(path.originInvalidAtMs, null);
  assert.equal(path.propagationSloMet, null);
});

test('view never contains active controls or command authority', () => {
  const view = buildAssuranceCaseViewModel(evaluate(buildExpiredEvidenceFixture()));
  assert.deepEqual(view.controls, []);
  assert(view.recommendations.every((entry) => entry.commandAuthority === 'NONE'));
});

test('malformed evaluation returns bounded UNKNOWN view', () => {
  const view = buildAssuranceCaseViewModel({ status: 'PASS' });
  assert.equal(view.status, 'UNKNOWN');
  assert.deepEqual(view.summary.reasonCodes, ['EVALUATION_INVALID']);
  assert.deepEqual(view.claims, []);
});

test('expected-version empty or internally inconsistent green evaluations are rejected', () => {
  const empty = clonePlainData(evaluate());
  empty.claimResults = [];
  assert.equal(buildAssuranceCaseViewModel(empty).status, 'UNKNOWN');

  const forged = clonePlainData(evaluate(buildExpiredEvidenceFixture()));
  forged.status = 'PASS';
  forged.safetyBoundary.supportUsableForNewAction = true;
  assert.equal(buildAssuranceCaseViewModel(forged).status, 'UNKNOWN');
});

test('forged leaf, component, or claim PASS cannot create a green view', () => {
  const leaf = clonePlainData(evaluate());
  leaf.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-004').declaredResult = 'UNKNOWN';
  assert.deepEqual(buildAssuranceCaseViewModel(leaf).summary.reasonCodes, ['EVALUATION_INVALID']);

  const component = clonePlainData(evaluate(buildExpiredEvidenceFixture()));
  const affectedComponent = component.claimResults
    .find((entry) => entry.claimId === 'PA-S4-CLAIM-004').componentResults[0];
  affectedComponent.result = 'PASS';
  affectedComponent.invalidatingEvidenceIds = [];
  affectedComponent.supportUsableForNewAction = true;
  assert.deepEqual(buildAssuranceCaseViewModel(component).summary.reasonCodes, ['EVALUATION_INVALID']);

  const claim = clonePlainData(evaluate(buildExpiredEvidenceFixture()));
  const affectedClaim = claim.claimResults.find((entry) => entry.claimId === 'PA-S4-CLAIM-004');
  affectedClaim.result = 'PASS';
  affectedClaim.invalidatingEvidenceIds = [];
  affectedClaim.supportUsableForNewAction = true;
  assert.deepEqual(buildAssuranceCaseViewModel(claim).summary.reasonCodes, ['EVALUATION_INVALID']);
});

test('mandatory claim contract drift is rejected at the view boundary', () => {
  for (const mutate of [
    (claim) => { claim.statement = 'Invented assurance statement.'; },
    (claim) => { claim.scope = 'Invented scope.'; },
    (claim) => { claim.capitalCritical = false; },
    (claim) => { claim.validator.version = 'FORGED'; },
    (claim) => { claim.invariantProjection.eventRecommendationType = 'HALT'; },
    (claim) => { claim.cockpitProjection.drillDown = 'Opaque summary.'; },
  ]) {
    const evaluation = clonePlainData(evaluate());
    mutate(evaluation.claimResults[0]);
    assert.deepEqual(buildAssuranceCaseViewModel(evaluation).summary.reasonCodes, ['EVALUATION_INVALID']);
  }
});

test('unknown fields are rejected at every security-sensitive nested boundary', () => {
  const mutations = [
    (evaluation) => { evaluation.unexpected = true; },
    (evaluation) => { evaluation.claimResults[0].canonicalOwner.unexpected = true; },
    (evaluation) => { evaluation.claimResults[0].cockpitProjection.unexpected = true; },
    (evaluation) => { evaluation.claimResults[0].componentResults[0].unexpected = true; },
    (evaluation) => { evaluation.evidenceResults[0].sourceIdentity.unexpected = true; },
    (evaluation) => { evaluation.evidenceResults[0].producerFailureDomains[0].unexpected = true; },
    (evaluation) => { evaluation.recomputation.unexpected = true; },
    (evaluation) => { evaluation.safetyBoundary.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const evaluation = clonePlainData(evaluate());
    mutate(evaluation);
    assert.deepEqual(buildAssuranceCaseViewModel(evaluation).summary.reasonCodes, ['EVALUATION_INVALID']);
  }

  const expired = clonePlainData(evaluate(buildExpiredEvidenceFixture()));
  expired.recommendations[0].eventRecommendation.unexpected = true;
  assert.deepEqual(buildAssuranceCaseViewModel(expired).summary.reasonCodes, ['EVALUATION_INVALID']);

  const deadline = clonePlainData(evaluate(buildExpiredEvidenceFixture()));
  deadline.recomputation.affectedClaimDeadlines[0].unexpected = true;
  assert.deepEqual(buildAssuranceCaseViewModel(deadline).summary.reasonCodes, ['EVALUATION_INVALID']);
});

test('basis reciprocity, evidence-purpose law, and direct claim binding cannot be forged', () => {
  const backlink = clonePlainData(evaluate());
  backlink.evidenceResults
    .find((entry) => entry.evidenceId === 'PA-S4-INDEPENDENCE-BASIS-001')
    .certifiesEvidenceIds = ['PA-S4-EVIDENCE-002'];
  assert.deepEqual(buildAssuranceCaseViewModel(backlink).summary.reasonCodes, ['EVALUATION_INVALID']);

  const purpose = clonePlainData(evaluate());
  const basis = purpose.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-INDEPENDENCE-BASIS-001');
  basis.purpose = 'CLAIM_SUPPORT';
  basis.capitalCritical = true;
  assert.deepEqual(buildAssuranceCaseViewModel(purpose).summary.reasonCodes, ['EVALUATION_INVALID']);

  const directOwner = clonePlainData(evaluate());
  directOwner.evidenceResults
    .find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-001')
    .producerOwnerId = 'IP-ASSURANCE.invented-owner';
  assert.deepEqual(buildAssuranceCaseViewModel(directOwner).summary.reasonCodes, ['EVALUATION_INVALID']);
});

test('direct source aliases and unreachable evidence cannot enter a view', () => {
  const sourceAlias = clonePlainData(evaluate());
  const source = sourceAlias.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-001');
  const alias = sourceAlias.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-002');
  alias.sourceIdentity.sourceId = source.sourceIdentity.sourceId;
  assert.deepEqual(buildAssuranceCaseViewModel(sourceAlias).summary.reasonCodes, ['EVALUATION_INVALID']);

  const unreachable = clonePlainData(evaluate());
  const extra = clonePlainData(unreachable.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-EVIDENCE-001'));
  const extraBasis = clonePlainData(unreachable.evidenceResults.find((entry) => entry.evidenceId === 'PA-S4-INDEPENDENCE-BASIS-001'));
  extra.evidenceId = 'PA-S4-UNREACHABLE-EVIDENCE';
  extra.sourceIdentity.sourceId = 'PA-S4-UNREACHABLE-SOURCE';
  extra.sourceIdentity.revision = 'PA-S4-UNREACHABLE-REV-001';
  extra.sourceIdentity.digest = `sha256:${'a'.repeat(64)}`;
  extra.independenceBasisEvidenceIds = ['PA-S4-UNREACHABLE-BASIS'];
  extraBasis.evidenceId = 'PA-S4-UNREACHABLE-BASIS';
  extraBasis.sourceIdentity.sourceId = 'PA-S4-UNREACHABLE-BASIS-SOURCE';
  extraBasis.sourceIdentity.revision = 'PA-S4-UNREACHABLE-BASIS-REV-001';
  extraBasis.sourceIdentity.digest = `sha256:${'b'.repeat(64)}`;
  extraBasis.certifiesEvidenceIds = [extra.evidenceId];
  unreachable.evidenceResults.push(extra, extraBasis);
  assert.deepEqual(buildAssuranceCaseViewModel(unreachable).summary.reasonCodes, ['EVALUATION_INVALID']);
});

test('configured diagnostic families cannot share any typed failure domain', () => {
  const evaluation = clonePlainData(evaluate(buildCompleteConfiguredDiagnosticFixture('ACTIVE')));
  const containment = evaluation.evidenceResults.find((entry) => (
    entry.purpose === 'DIAGNOSTIC_CONTAINMENT'
  ));
  const privacy = evaluation.evidenceResults.find((entry) => entry.purpose === 'DIAGNOSTIC_PRIVACY');
  privacy.producerFailureDomains[0] = clonePlainData(containment.producerFailureDomains[0]);
  assert.deepEqual(buildAssuranceCaseViewModel(evaluation).summary.reasonCodes, ['EVALUATION_INVALID']);
});

test('claim invalidation time, path edges, and assurance ceiling are relationally closed', () => {
  const invalidation = clonePlainData(evaluate(buildExpiredEvidenceFixture()));
  invalidation.claimResults.find((entry) => entry.claimId === 'PA-S4-CLAIM-004').invalidatedAtMs += 1;
  assert.deepEqual(buildAssuranceCaseViewModel(invalidation).summary.reasonCodes, ['EVALUATION_INVALID']);

  const pathEvaluation = clonePlainData(evaluate(buildExpiredEvidenceFixture()));
  const path = pathEvaluation.invalidationPaths.find((entry) => entry.dependentClaimId === 'PA-S4-CLAIM-001');
  const claimThreeIndex = path.path.indexOf('PA-S4-CLAIM-003');
  const claimTwoIndex = path.path.indexOf('PA-S4-CLAIM-002');
  [path.path[claimThreeIndex], path.path[claimTwoIndex]] = [path.path[claimTwoIndex], path.path[claimThreeIndex]];
  assert.deepEqual(buildAssuranceCaseViewModel(pathEvaluation).summary.reasonCodes, ['EVALUATION_INVALID']);

  const ceiling = clonePlainData(evaluate());
  ceiling.recomputation.assuranceSloMs = 4_999;
  assert.deepEqual(buildAssuranceCaseViewModel(ceiling).summary.reasonCodes, ['EVALUATION_INVALID']);
});

test('a definite assurance miss dominates an undetermined deadline at the view boundary', () => {
  const delayedNowMs = FIXTURE_NOW_MS + 6_000;
  const packet = clonePlainData(buildExpiredEvidenceFixture());
  const missingClaim = packet.claims.find((entry) => entry.claimId === 'PA-S4-CLAIM-001');
  missingClaim.supportingEvidenceIds = ['PA-S4-EVIDENCE-MISSING'];
  missingClaim.componentDrillDown[0].supportingEvidenceIds = ['PA-S4-EVIDENCE-MISSING'];
  packet.evidence = packet.evidence.filter((entry) => ![
    'PA-S4-EVIDENCE-001',
    'PA-S4-INDEPENDENCE-BASIS-001',
  ].includes(entry.evidenceId));
  const evaluation = evaluateAssuranceCase(
    packet,
    buildS1AssumptionProjection({ evaluatedAtMs: delayedNowMs }),
    delayedNowMs,
  );
  assert.equal(evaluation.recomputation.completedWithinDeclaredSlo, false);
  assert.notDeepEqual(buildAssuranceCaseViewModel(evaluation).summary.reasonCodes, ['EVALUATION_INVALID']);
  const forged = clonePlainData(evaluation);
  forged.recomputation.completedWithinDeclaredSlo = null;
  assert.deepEqual(buildAssuranceCaseViewModel(forged).summary.reasonCodes, ['EVALUATION_INVALID']);
});

test('null nested evaluation records return bounded UNKNOWN without throwing', () => {
  for (const mutate of [
    (evaluation) => { evaluation.claimResults[0] = null; },
    (evaluation) => { evaluation.evidenceResults[0] = null; },
    (evaluation) => { evaluation.invalidationPaths = [null]; },
  ]) {
    const evaluation = clonePlainData(evaluate(buildExpiredEvidenceFixture()));
    mutate(evaluation);
    const view = buildAssuranceCaseViewModel(evaluation);
    assert.equal(view.status, 'UNKNOWN');
    assert.deepEqual(view.summary.reasonCodes, ['EVALUATION_INVALID']);
  }
});

test('hostile accessor evaluation is rejected without invocation', () => {
  let invoked = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'schemaVersion', {
    enumerable: true,
    get() {
      invoked += 1;
      return 'pa.s4.assurance-evaluation.v1';
    },
  });
  const view = buildAssuranceCaseViewModel(hostile);
  assert.equal(invoked, 0);
  assert.equal(view.status, 'UNKNOWN');
  assert.deepEqual(view.summary.reasonCodes, ['EVALUATION_CAPTURE_FAILED']);
});

test('view output is deeply frozen', () => {
  const view = buildAssuranceCaseViewModel(evaluate());
  assert(Object.isFrozen(view));
  assert(Object.isFrozen(view.claims));
  assert(Object.isFrozen(view.claims[0]));
});
