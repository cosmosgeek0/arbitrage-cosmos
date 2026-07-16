import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  buildCounterevidenceFixture,
  buildS1AssumptionProjection,
  clonePlainData,
  evaluateAssuranceCase,
  validateS1AssumptionProjection,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet, projection, nowMs = FIXTURE_NOW_MS) => (
  evaluateAssuranceCase(packet, projection, nowMs)
);

test('an accepted S1 EXPIRED result cannot declare a future stale boundary', () => {
  const projection = buildS1AssumptionProjection({
    overrides: {
      'PA-S1-AS-008': {
        result: 'UNKNOWN',
        reasonCode: 'EXPIRED',
        freshnessStatus: 'EXPIRED',
        staleAtMs: FIXTURE_NOW_MS + 1,
      },
    },
  });

  const issues = validateS1AssumptionProjection(projection);
  assert(issues.some((issue) => (
    issue.path === '$.assumptionResults.PA-S1-AS-008.staleAtMs'
    && issue.code === 'S1_EXPIRED_STALE_BOUNDARY_IN_FUTURE'
  )));

  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, projection);
  assert.deepEqual(result.reasonCodes, ['S1_PROJECTION_INVALID']);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.assumptionResults.length, 0);
  assert.equal(result.claimResults.length, 0);
  assert.equal(result.invalidationPaths.length, 0);
  assert.equal(result.recomputation.originInvalidatedAtMs, null);
  assert.equal(result.recomputation.assuranceDueAtMs, null);
});

const buildMissingSupportWithKnownUnknownCountercheck = () => {
  const packet = clonePlainData(buildCounterevidenceFixture('UNKNOWN'));
  const claim = packet.claims.find((entry) => entry.claimId === 'PA-S4-CLAIM-004');
  claim.supportingEvidenceIds = ['PA-S4-EVIDENCE-MISSING'];
  claim.componentDrillDown[0].supportingEvidenceIds = ['PA-S4-EVIDENCE-MISSING'];
  return packet;
};

test('a missing primitive origin keeps assurance completion undetermined until a definite miss dominates', () => {
  const packet = buildMissingSupportWithKnownUnknownCountercheck();
  const currentProjection = buildS1AssumptionProjection();
  const current = evaluate(packet, currentProjection);
  const missingPaths = current.invalidationPaths.filter((path) => (
    path.originType === 'EVIDENCE'
    && path.originId === 'PA-S4-EVIDENCE-MISSING'
  ));

  assert(missingPaths.length > 0);
  assert(missingPaths.every((path) => path.originInvalidAtMs === null));
  const missingAffectedClaimIds = new Set(missingPaths.map((path) => path.dependentClaimId));
  const missingAffectedDeadlines = current.recomputation.affectedClaimDeadlines.filter((deadline) => (
    missingAffectedClaimIds.has(deadline.claimId)
  ));
  assert.equal(missingAffectedDeadlines.length, missingAffectedClaimIds.size);
  assert(missingAffectedDeadlines.every((deadline) => deadline.completedWithinDeclaredSlo === null));
  assert.equal(current.recomputation.completedWithinDeclaredSlo, null);
  assert(current.reasonCodes.includes('ASSURANCE_SLO_UNDETERMINED'));
  assert(!current.reasonCodes.includes('ASSURANCE_SLO_MISSED'));

  const delayedNowMs = FIXTURE_NOW_MS + 6_000;
  const delayedProjection = buildS1AssumptionProjection({ evaluatedAtMs: delayedNowMs });
  const delayed = evaluate(packet, delayedProjection, delayedNowMs);
  assert(delayed.invalidationPaths.some((path) => (
    path.originId === 'PA-S4-EVIDENCE-MISSING'
    && path.originInvalidAtMs === null
  )));
  assert(delayed.recomputation.affectedClaimDeadlines.some((deadline) => (
    deadline.completedWithinDeclaredSlo === false
  )));
  assert.equal(delayed.recomputation.completedWithinDeclaredSlo, false);
  assert(delayed.reasonCodes.includes('ASSURANCE_SLO_MISSED'));
  assert(!delayed.reasonCodes.includes('ASSURANCE_SLO_UNDETERMINED'));
});
