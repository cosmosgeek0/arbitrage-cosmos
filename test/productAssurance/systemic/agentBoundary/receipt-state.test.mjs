import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const receiptPath = 'fixtures/productAssurance/systemic/agentBoundary/receipts/AGENT_BOUNDARY_PRESTAGE_RECEIPT.v1.json';
const statePath = 'fixtures/productAssurance/systemic/agentBoundary/AGENT_BOUNDARY_STATE.md';
const receiptBytes = readFileSync(path.join(repoRoot, receiptPath));
const receipt = JSON.parse(receiptBytes);
const state = readFileSync(path.join(repoRoot, statePath), 'utf8');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: repoRoot, encoding }).trim();
}

test('D-LAUNCH-13 receipt and state seal the exact verified implementation', () => {
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.status, 'AGENT_PRESTAGE_READY');
  assert.equal(receipt.branch, git(['branch', '--show-current']));
  assert.doesNotThrow(() => git(['merge-base', '--is-ancestor', receipt.baseCommit, receipt.implementationCommit]));
  assert.doesNotThrow(() => git(['merge-base', '--is-ancestor', receipt.implementationCommit, 'HEAD']));
  assert.equal(git(['rev-parse', `${receipt.implementationCommit}^{tree}`]), receipt.implementationTree);
  assert.equal(git(['rev-parse', `${receipt.implementationCommit}:fixtures/productAssurance/systemic/agentBoundary`]),
    receipt.implementationTrees.fixtures);
  assert.equal(git(['rev-parse', `${receipt.implementationCommit}:test/productAssurance/systemic/agentBoundary`]),
    receipt.implementationTrees.tests);

  assert.equal(git(['rev-parse', receipt.ownerLaw.sourceCommit]), receipt.ownerLaw.sourceCommit);
  assert.equal(git(['rev-parse', `${receipt.ownerLaw.sourceCommit}:IP_ASSURANCE.md`]), receipt.ownerLaw.sourceBlob);
  const ownerLawBytes = execFileSync('git', ['show', `${receipt.ownerLaw.sourceCommit}:IP_ASSURANCE.md`], {
    cwd: repoRoot,
  });
  assert.equal(sha256(ownerLawBytes), receipt.ownerLaw.packetSha256);

  const changedPaths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', receipt.implementationCommit])
    .split('\n').filter(Boolean).sort();
  assert.deepEqual(receipt.artifacts.map((artifact) => artifact.path).sort(), changedPaths);
  for (const artifact of receipt.artifacts) {
    const bytes = execFileSync('git', ['show', `${receipt.implementationCommit}:${artifact.path}`], { cwd: repoRoot });
    assert.equal(sha256(bytes), artifact.sha256, artifact.path);
  }

  const protectedI00 = readFileSync(path.join(repoRoot, 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'));
  assert.equal(sha256(protectedI00), receipt.inputHashes.protectedI00Sha256);
  assert.equal(receipt.counts.classAPromotionEvidencePoints, 9);
  assert.equal(receipt.counts.focusedTestsPassed, 111);
  assert.equal(receipt.counts.focusedTestsFailed, 0);
  assert.equal(receipt.projection.operationalActionAllowed, false);
  assert.equal(receipt.projection.mayDeclareRecovery, false);
  assert.equal(receipt.sealCommitIdentity, 'ENCLOSING_GIT_COMMIT_IS_AUTHORITY_AND_IS_NOT_SELF_RECORDED');

  const receiptDigest = sha256(receiptBytes);
  assert.match(state, /Status: `AGENT_PRESTAGE_READY`/);
  assert.ok(state.includes(receipt.implementationCommit));
  assert.ok(state.includes(receipt.ownerLaw.packetSha256));
  assert.ok(state.includes(receiptPath));
  assert.ok(state.includes(receiptDigest));
  assert.match(state, /Terminal state: `AGENT_PRESTAGE_READY`\./);
});
