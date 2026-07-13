import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import test from 'node:test';

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const statePath = resolve(workspaceRoot, 'fixtures/productAssurance/systemic/cockpit/state/COCKPIT_PRESTAGE_STATE.v1.json');
const receiptPath = resolve(workspaceRoot, 'fixtures/productAssurance/systemic/cockpit/receipts/COCKPIT_PRESTAGE_RECEIPT.v1.json');
const receiptRelativePath = relative(workspaceRoot, receiptPath);
const packetRoots = [
  'fixtures/productAssurance/systemic/cockpit',
  'fixtures/productAssurance/systemic/observability',
  'test/productAssurance/systemic/cockpit',
  'test/productAssurance/systemic/observability',
];

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function filesUnder(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(path, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [relative(workspaceRoot, entryPath)];
  });
}

test('cockpit prestage state and immutable full-packet receipt remain exact and collision-free', () => {
  const state = json(statePath);
  const receipt = json(receiptPath);
  assert.equal(state.status, 'COCKPIT_PRESTAGE_READY');
  assert.equal(state.commitState, 'FEATURE_BRANCH_SEALED_DIRECTOR_LANDING_REQUIRED');
  assert.equal(state.nextSubtask, null);
  assert.equal(receipt.status, state.status);
  assert.equal(receipt.branch, state.branch);
  assert.equal(receipt.baseCommit, state.baseCommit);
  assert.equal(receipt.implementationCommit, state.implementationCommit);
  assert.equal(receipt.releaseManifest.manifestId, state.manifestId);
  assert.equal(receipt.releaseManifest.manifestRevision, state.manifestRevision);
  assert.equal(receipt.releaseManifest.manifestSha256, state.manifestSha256);
  assert.deepEqual(receipt.counts, {
    releaseExpectedItems: 84,
    releaseRequiredItems: 80,
    semanticSourceStreams: 7,
    systemCommandPaths: 8,
    surfaces: 18,
    panelContracts: 25,
    visibleControls: 6,
    dashboardRequiredFacts: 96,
    factSemantics: 295,
    informationLevels: 5,
    informationTopics: 28,
    historicalMetricContracts: 23,
    sloSubobjectives: 25,
    cockpitFocusedTestsPassed: 50,
    observabilityFocusedTestsPassed: 100,
    focusedTestsFailed: 0,
  });
  assert.deepEqual(receipt.verification.cockpit.result, { passed: 50, failed: 0, exitCode: 0 });
  assert.deepEqual(receipt.verification.observability.result, { passed: 100, failed: 0, exitCode: 0 });
  assert.equal(receipt.verification.npmTest.exitCode, 0);
  assert.equal(receipt.verification.npmTestAll.exitCode, 0);
  assert.equal(receipt.verification.networkUsedByPacketTests, false);
  assert.equal(receipt.verification.productionCodeTouched, false);

  const expectedPaths = packetRoots
    .flatMap((path) => filesUnder(resolve(workspaceRoot, path)))
    .filter((path) => path !== receiptRelativePath)
    .sort();
  const paths = receipt.artifacts.map((artifact) => artifact.path);
  assert.deepEqual(paths, expectedPaths);
  assert.deepEqual(paths, [...new Set(paths)].sort());
  for (const artifact of receipt.artifacts) {
    assert.match(artifact.path, /^(fixtures|test)\/productAssurance\/systemic\/(cockpit|observability)\//);
    assert.notEqual(artifact.path, receiptRelativePath);
    assert.equal(sha256(resolve(workspaceRoot, artifact.path)), artifact.sha256, artifact.path);
  }
});
