import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  buildAssuranceCaseViewModel,
  buildCompleteConfiguredDiagnosticFixture,
  clonePlainData,
  evaluateAssuranceCase,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet) => evaluateAssuranceCase(
  packet,
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  FIXTURE_NOW_MS,
);

const claimById = (collection, claimId) => (
  collection.find((claim) => claim.claimId === claimId)
);

const evidenceById = (collection, evidenceId) => (
  collection.find((evidence) => evidence.evidenceId === evidenceId)
);

const assertViewRejects = (evaluation) => {
  const view = buildAssuranceCaseViewModel(evaluation);
  assert.equal(view.status, 'UNKNOWN');
  assert.deepEqual(view.summary.reasonCodes, ['EVALUATION_INVALID']);
};

test('view rejects forged root, claim, and evidence reason-code semantics', async (t) => {
  const baseline = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE);
  assert.equal(buildAssuranceCaseViewModel(baseline).status, 'PASS');

  const forgeries = [
    {
      name: 'PASS root reports failed derived claim',
      mutate(evaluation) {
        evaluation.reasonCodes = ['DERIVED_CLAIM_FAILED'];
      },
    },
    {
      name: 'PASS claim reports failed evidence',
      mutate(evaluation) {
        claimById(evaluation.claimResults, 'PA-S4-CLAIM-001').reasonCodes = ['EVIDENCE_FAILED'];
      },
    },
    {
      name: 'PASS evidence reports a declared failure',
      mutate(evaluation) {
        evidenceById(evaluation.evidenceResults, 'PA-S4-EVIDENCE-001').reasonCodes = ['DECLARED_FAIL'];
      },
    },
  ];

  for (const forgery of forgeries) {
    await t.test(forgery.name, () => {
      const evaluation = clonePlainData(baseline);
      forgery.mutate(evaluation);
      assertViewRejects(evaluation);
    });
  }
});

const buildUnboundPrivacyEvaluation = () => {
  const packet = clonePlainData(buildCompleteConfiguredDiagnosticFixture('ACTIVE'));
  const evidenceId = packet.diagnosticPlane.privacyEvidenceIds[0];
  const diagnosticClaim = claimById(packet.claims, 'PA-S4-CLAIM-013');
  diagnosticClaim.supportingEvidenceIds = diagnosticClaim.supportingEvidenceIds.filter((id) => (
    id !== evidenceId
  ));
  diagnosticClaim.componentDrillDown[0].supportingEvidenceIds = (
    diagnosticClaim.componentDrillDown[0].supportingEvidenceIds.filter((id) => id !== evidenceId)
  );

  const evaluation = evaluate(packet);
  assert(evaluation.packetIssues.some((issue) => (
    issue.code === 'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM'
    && issue.path === '$.diagnosticPlane.privacyEvidenceIds'
    && issue.message === evidenceId
  )));
  const baselineView = buildAssuranceCaseViewModel(evaluation);
  assert.equal(baselineView.status, 'UNKNOWN');
  assert(!baselineView.summary.reasonCodes.includes('EVALUATION_INVALID'));
  return { evaluation, evidenceId };
};

test('diagnostic unbound-evidence issue cannot bridge an orphan with the wrong family semantics', async (t) => {
  const { evaluation: baseline, evidenceId } = buildUnboundPrivacyEvaluation();

  const mutations = [
    {
      name: 'wrong role',
      mutate(evaluation, orphan) {
        orphan.role = 'COUNTERCHECK';
      },
    },
    {
      name: 'wrong purpose',
      mutate(evaluation, orphan) {
        orphan.purpose = 'CLAIM_SUPPORT';
      },
    },
    {
      name: 'wrong kind with internally consistent source type',
      mutate(evaluation, orphan) {
        orphan.kind = 'INVENTORY_MANIFEST';
        orphan.sourceIdentity.sourceType = orphan.kind;
      },
    },
    {
      name: 'wrong claim binding with internally consistent basis binding',
      mutate(evaluation, orphan) {
        const wrongClaim = claimById(evaluation.claimResults, 'PA-S4-CLAIM-001');
        const wrongBinding = {
          claimId: wrongClaim.claimId,
          requirementKey: wrongClaim.requirementKey,
          scope: wrongClaim.scope,
        };
        orphan.claimBinding = clonePlainData(wrongBinding);
        const basis = evidenceById(
          evaluation.evidenceResults,
          orphan.independenceBasisEvidenceIds[0],
        );
        basis.claimBinding = clonePlainData(wrongBinding);
      },
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const evaluation = clonePlainData(baseline);
      const orphan = evidenceById(evaluation.evidenceResults, evidenceId);
      assert(orphan, 'the issue-referenced resolved orphan must remain in the evaluation');
      mutation.mutate(evaluation, orphan);
      assertViewRejects(evaluation);
    });
  }
});
