import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const statePath = resolve(workspaceRoot, 'fixtures/productAssurance/systemic/cockpit/state/COCKPIT_PRESTAGE_STATE.v1.json');
const receiptPath = resolve(workspaceRoot, 'fixtures/productAssurance/systemic/cockpit/receipts/COCKPIT_PRESTAGE_RECEIPT.v1.json');

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('cockpit prestage state and immutable artifact receipt remain exact and collision-free', () => {
  const state = json(statePath);
  const receipt = json(receiptPath);
  assert.equal(state.status, 'COCKPIT_PRESTAGE_READY');
  assert.equal(state.commitState, 'DIRECTOR_COMMIT_REQUIRED');
  assert.equal(receipt.status, state.status);
  assert.equal(receipt.branch, state.branch);
  assert.equal(receipt.baseCommit, state.baseCommit);
  assert.equal(receipt.releaseManifest.manifestId, state.manifestId);
  assert.equal(receipt.releaseManifest.manifestRevision, state.manifestRevision);
  assert.equal(receipt.releaseManifest.manifestSha256, state.manifestSha256);
  assert.deepEqual(receipt.counts, {
    surfaces: 18,
    panelContracts: 20,
    dashboardRequiredFacts: 92,
    factSemantics: 255,
    informationLevels: 5,
    informationTopics: 28,
    focusedTestsPassed: 42,
    focusedTestsFailed: 0
  });
  const paths = receipt.artifacts.map((artifact) => artifact.path);
  assert.deepEqual(paths, [...new Set(paths)].sort());
  for (const artifact of receipt.artifacts) {
    assert.match(artifact.path, /^(fixtures|test)\/productAssurance\/systemic\/cockpit\//);
    assert.equal(sha256(resolve(workspaceRoot, artifact.path)), artifact.sha256, artifact.path);
  }
});
