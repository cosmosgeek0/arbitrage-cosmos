import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_DONOR_ROWS,
  PHASE2_GRAPH_BOUNDARY,
  RECEIPT_BOUND_AUTHORITY,
  collectDonorEqualityEvidence,
  collectReceiptBoundDonorEqualityEvidence,
  evaluateDonorEquality,
  verifyDonorEquality,
} from '../donor-equality.mjs';

const OBSERVATION = collectDonorEqualityEvidence({ candidateRef: 'HEAD' });

function receiptBoundFixture() {
  const observation = OBSERVATION.evidenceMode === RECEIPT_BOUND_AUTHORITY.mode
    ? structuredClone(OBSERVATION)
    : collectReceiptBoundDonorEqualityEvidence({ candidateRef: 'HEAD' });
  if (!observation.receiptBound.cloneBoundary.qualifiesForReceiptBoundMode) {
    const branch = 'truth-campaign-20260716';
    Object.assign(observation.receiptBound.cloneBoundary, {
      worktreeCount: 1,
      soleWorktreeMatchesRepo: true,
      detached: true,
      fetchRefspecs: [`+refs/heads/${branch}:refs/remotes/origin/${branch}`],
      branch,
      localBranches: [`refs/heads/${branch}`],
      remoteBranches: [`refs/remotes/origin/${branch}`],
      singleBranchRefsExact: true,
      currentMainPresent: false,
      shallow: false,
      alternatesPresent: false,
      qualifiesForReceiptBoundMode: true,
    });
    observation.receiptBound.authoritySourceAncestorOfCheckout = true;
  }
  return observation;
}

const RECEIPT_BOUND_OBSERVATION = receiptBoundFixture();

function hostile(mutator) {
  const copy = structuredClone(OBSERVATION);
  mutator(copy);
  return evaluateDonorEquality(copy);
}

function assertBlocked(proof, failure) {
  assert.equal(proof.status, 'BLOCKED');
  assert.ok(proof.failures.includes(failure), `${failure}: ${proof.failures.join(', ')}`);
}

test('Git-backed donor proof measures exact 16/16/16/16 equality', () => {
  const proof = evaluateDonorEquality(OBSERVATION);
  assert.equal(proof.status, 'PASS');
  assert.deepEqual(proof.counts, {
    expected: 16,
    discovered: 16,
    accepted: 16,
    integrated: 16,
  });
  assert.deepEqual(proof.exactSets.expected, EXPECTED_DONOR_ROWS.map((entry) => entry.id));
  assert.deepEqual(proof.exactSets.expected, proof.exactSets.discovered);
  assert.deepEqual(proof.exactSets.expected, proof.exactSets.accepted);
  assert.deepEqual(proof.exactSets.expected, proof.exactSets.integrated);
  assert.equal(proof.donors.reduce((sum, donor) => sum + donor.acceptanceReceipts.length, 0), 17);
  assert.equal(proof.donors.length, 16);
  assert.deepEqual(proof.failures, []);
  assert.match(proof.proofSha256, /^[a-f0-9]{64}$/);
  assert.equal(evaluateDonorEquality(OBSERVATION).proofSha256, proof.proofSha256);
});

test('receipt-bound mode is pinned to the tracked manifest and exact isolated-clone boundary', () => {
  const proof = evaluateDonorEquality(RECEIPT_BOUND_OBSERVATION);
  assert.equal(RECEIPT_BOUND_OBSERVATION.evidenceMode, 'TRACKED_RECEIPT_SINGLE_BRANCH');
  assert.equal(RECEIPT_BOUND_OBSERVATION.receiptBound.authority.sourceCommit, 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561');
  assert.equal(RECEIPT_BOUND_OBSERVATION.receiptBound.authority.observedSha256, RECEIPT_BOUND_AUTHORITY.sha256);
  assert.deepEqual(RECEIPT_BOUND_OBSERVATION.receiptBound.authority.donorRows, EXPECTED_DONOR_ROWS);
  assert.equal(RECEIPT_BOUND_OBSERVATION.receiptBound.cloneBoundary.qualifiesForReceiptBoundMode, true);
  assert.equal(proof.status, 'PASS');
  assert.deepEqual(proof.counts, { expected: 16, discovered: 16, accepted: 16, integrated: 16 });

  const alteredAuthority = structuredClone(RECEIPT_BOUND_OBSERVATION);
  alteredAuthority.receiptBound.authority.observedSha256 = '0'.repeat(64);
  assertBlocked(evaluateDonorEquality(alteredAuthority), 'RECEIPT_BOUND_AUTHORITY_INVALID');

  const missingMergeDonor = structuredClone(RECEIPT_BOUND_OBSERVATION);
  missingMergeDonor.receiptBound.unavailableDonorIds.push('F-BRIDGE');
  missingMergeDonor.receiptBound.unexpectedUnavailableDonorIds.push('F-BRIDGE');
  assertBlocked(evaluateDonorEquality(missingMergeDonor), 'UNEXPECTED_UNAVAILABLE_DONOR_OBJECT');
});

test('required-last L proof pins exact merge, parents, and authorized post-L topology', () => {
  const proof = evaluateDonorEquality(OBSERVATION);
  assert.deepEqual(proof.requiredLast, {
    merge: 'ec82bc51d5311dfb3f505216bfb3fa41733f038c',
    firstParent: '139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9',
    donor: 'df6b472993ca9659ce09cf5f72004981c6835f0d',
    authorizedLaterMerges: PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges,
    postLTopologyExact: true,
  });
  assert.equal(proof.mergeWindow.authorizedLaterMerges.length, 16);
  assert.deepEqual(proof.requiredLast.authorizedLaterMerges, proof.mergeWindow.authorizedLaterMerges);
  assert.deepEqual(proof.mergeWindow.laterMerges, proof.mergeWindow.authorizedLaterMerges);
  const lane = proof.donors.find((donor) => donor.id === 'L-LANE');
  assert.deepEqual(lane.integration.observedParents, [
    proof.requiredLast.firstParent,
    proof.requiredLast.donor,
  ]);
  assert.equal(lane.integration.methodProof.donorIsSecondParent, true);
});

test('dashboard is accepted only by exact 21-file equivalence at its sealed cut', () => {
  const proof = evaluateDonorEquality(OBSERVATION);
  const dashboard = proof.donors.find((donor) => donor.id === 'DASHBOARD-SHELL');
  assert.equal(dashboard.integration.method, 'RECEIPTED_EQUIVALENCE');
  assert.equal(dashboard.integration.methodProof.donorFileCount, 21);
  assert.equal(dashboard.integration.methodProof.cutFileCount, 21);
  assert.equal(dashboard.integration.methodProof.exactEntries, true);
  assert.equal(dashboard.integration.methodProof.donorTipAncestorOfCandidate, false);

  const wrongCut = hostile((value) => {
    value.donors.find((donor) => donor.id === 'DASHBOARD-SHELL').integration.methodProof.cutSubtree = '0'.repeat(40);
  });
  assertBlocked(wrongCut, 'DASHBOARD-SHELL_EQUIVALENCE_CUT_INVALID');
});

test('wrong donor object, missing ID, and extra donor fail closed', () => {
  const wrongTree = hostile((value) => {
    value.donors[0].tip.observedTree = '0'.repeat(40);
  });
  assertBlocked(wrongTree, 'F-BRIDGE_DONOR_OBJECT_INVALID');

  const wrongType = hostile((value) => {
    value.donors[0].tip.objectType = 'tree';
  });
  assertBlocked(wrongType, 'F-BRIDGE_DONOR_OBJECT_INVALID');

  const missing = hostile((value) => {
    value.donors.pop();
  });
  assertBlocked(missing, 'DONOR_ID_SET_INVALID');
  assert.ok(missing.failures.includes('L-LANE_MISSING'));

  const extra = hostile((value) => {
    value.donors.push({ id: 'UNRECEIPTED-EXTRA' });
  });
  assertBlocked(extra, 'DONOR_ID_SET_INVALID');
});

test('wrong merge parent, extra phase merge, or non-allowlisted post-L topology fails closed', () => {
  const wrongParent = hostile((value) => {
    value.donors.find((donor) => donor.id === 'Q-LANE').integration.observedParents[1] = '0'.repeat(40);
  });
  assertBlocked(wrongParent, 'Q-LANE_INTEGRATION_OBJECT_INVALID');

  const extraPhaseMerge = hostile((value) => {
    value.mergeWindow.observedSequence.splice(-1, 0, '1'.repeat(40));
  });
  assertBlocked(extraPhaseMerge, 'PHASE2_MERGE_SEQUENCE_INVALID');

  const missingAuthorizedPostL = hostile((value) => {
    value.mergeWindow.laterMerges.pop();
  });
  assertBlocked(missingAuthorizedPostL, 'POST_L_MERGE_ALLOWLIST_MISMATCH');

  const substitutedPostL = hostile((value) => {
    value.mergeWindow.laterMerges[0] = '2'.repeat(40);
  });
  assertBlocked(substitutedPostL, 'POST_L_MERGE_ALLOWLIST_MISMATCH');

  const unlistedPostL = hostile((value) => {
    value.mergeWindow.laterMerges.push('2'.repeat(40));
  });
  assertBlocked(unlistedPostL, 'POST_L_MERGE_ALLOWLIST_MISMATCH');

  const widenedAllowlist = hostile((value) => {
    value.mergeWindow.authorizedLaterMerges.push('2'.repeat(40));
  });
  assertBlocked(widenedAllowlist, 'POST_L_MERGE_ALLOWLIST_MISMATCH');
});

test('altered acceptance or integration receipt hash fails closed', () => {
  const acceptance = hostile((value) => {
    value.donors.find((donor) => donor.id === 'A-CORE').acceptanceReceipts[0].observedSha256 = '0'.repeat(64);
  });
  assertBlocked(acceptance, 'A-CORE_ACCEPTANCE_RECEIPT_INVALID');

  const integration = hostile((value) => {
    value.donors.find((donor) => donor.id === 'L15-INFRASTRUCTURE').integration.receipt.worktreeSha256 = '0'.repeat(64);
  });
  assertBlocked(integration, 'L15-INFRASTRUCTURE_INTEGRATION_RECEIPT_INVALID');
});

test('dirty, partial, or wrong-head donor worktree fails closed', () => {
  const dirty = hostile((value) => {
    value.donors.find((donor) => donor.id === 'IP-OPS').worktree.trackedChanges.push(' M ops/i00/lib.mjs');
  });
  assertBlocked(dirty, 'IP-OPS_WORKTREE_DIRTY_OR_PARTIAL');

  const partial = hostile((value) => {
    value.donors.find((donor) => donor.id === 'A-STABILITY').worktree.observedUntracked.push('partial/new-source.mjs');
  });
  assertBlocked(partial, 'A-STABILITY_WORKTREE_DIRTY_OR_PARTIAL');

  const wrongHead = hostile((value) => {
    value.donors.find((donor) => donor.id === 'SI-RECON').worktree.observedHead = '0'.repeat(40);
  });
  assertBlocked(wrongHead, 'SI-RECON_WORKTREE_IDENTITY_INVALID');
});

test('A-FORMAL and S2 remain post-landing reference admissions while preverify remains a non-ancestor', () => {
  const proof = evaluateDonorEquality(OBSERVATION);
  assert.deepEqual(proof.exclusions.map(({ id, disposition, excluded }) => ({ id, disposition, excluded })), [
    { id: 'A-FORMAL', disposition: 'POSTLANDING_INTEGRATED_REFERENCE_ONLY', excluded: true },
    { id: 'A-ACTION-EVIDENCE-S2', disposition: 'POSTLANDING_INTEGRATED_REFERENCE_ONLY', excluded: true },
    { id: 'PREVERIFY', disposition: 'NON_DONOR_NOT_CONFIGURED', excluded: true },
  ]);

  const smuggled = hostile((value) => {
    value.exclusions.find((entry) => entry.id === 'A-FORMAL').tip.ancestorOfCandidate = false;
  });
  assertBlocked(smuggled, 'A-FORMAL_EXCLUSION_PROOF_INVALID');
});

test('caller-supplied expected table cannot weaken or reorder donor law', () => {
  const weakened = structuredClone(EXPECTED_DONOR_ROWS);
  weakened.pop();
  assertBlocked(evaluateDonorEquality(OBSERVATION, { expectedRows: weakened }), 'CALLER_EXPECTED_DONOR_TABLE_MISMATCH');

  const reordered = structuredClone(EXPECTED_DONOR_ROWS);
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assertBlocked(evaluateDonorEquality(OBSERVATION, { expectedRows: reordered }), 'CALLER_EXPECTED_DONOR_TABLE_MISMATCH');

  const direct = verifyDonorEquality({ candidateRef: 'HEAD', expectedRows: weakened });
  assertBlocked(direct, 'CALLER_EXPECTED_DONOR_TABLE_MISMATCH');
});
