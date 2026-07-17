import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ROOT,
  ZERO_EFFECT,
  insertionRequestDocument,
  readJson,
} from './lib/constants.mjs';
import { digest } from './lib/receipt.mjs';
import { runAllDrills, verifyPassReceiptAgainstExecution } from './lib/runner.mjs';

const RECEIPT_PATH = 'fixtures/runbookShadow/receipts/PORT_RUNBOOK_PRESTAGE_RECEIPT.v1.json';
const receipt = readJson(RECEIPT_PATH);

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function gitBytes(...args) {
  return execFileSync('git', args, { cwd: ROOT });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'));
}

function diffPaths(from, to) {
  const output = git('diff', '--name-only', `${from}..${to}`);
  return output === '' ? [] : output.split('\n');
}

function forbiddenClaimPaths(value, trail = '$') {
  if (Array.isArray(value)) return value.flatMap((child, index) => forbiddenClaimPaths(child, `${trail}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(['acceptanceStatus', 'candidateReady', 'productionReady'].includes(key) ? [`${trail}.${key}`] : []),
    ...forbiddenClaimPaths(child, `${trail}.${key}`),
  ]);
}

test('receipt seals exact base, implementation, enclosing HEAD, and exclusive paths', () => {
  const head = git('rev-parse', 'HEAD');
  assert.equal(git('branch', '--show-current'), receipt.branch);
  assert.equal(git('rev-parse', 'HEAD^'), receipt.implementationCommit);
  assert.equal(git('rev-parse', `${receipt.implementationCommit}^`), receipt.baseCommit);
  assert.equal(receipt.implementationParentSha, receipt.baseCommit);
  assert.equal(git('rev-parse', `${receipt.baseCommit}^{tree}`), receipt.baseTree);
  assert.equal(git('rev-parse', `${receipt.implementationCommit}^{tree}`), receipt.implementationTree);
  assert.equal(receipt.sealCommitIdentity, 'ENCLOSING_GIT_COMMIT_SHA_IS_AUTHORITATIVE_AND_IS_NOT_SELF_RECORDED');
  assert.match(head, /^[0-9a-f]{40}$/);

  assert.deepEqual(sorted(diffPaths(receipt.baseCommit, receipt.implementationCommit)), sorted(receipt.changedPaths.implementation));
  assert.deepEqual(sorted(diffPaths(receipt.implementationCommit, head)), sorted(receipt.changedPaths.seal));
  assert.deepEqual(sorted(diffPaths(receipt.baseCommit, head)), sorted(receipt.changedPaths.all));
  assert.equal(new Set(receipt.changedPaths.all).size, receipt.changedPaths.all.length);
  assert(receipt.changedPaths.all.every((file) => file.startsWith('fixtures/runbookShadow/') || file.startsWith('test/runbookShadow/')));
  assert.equal(git('status', '--porcelain'), '');

  assert.equal(receipt.implementationManifest.pathCount, receipt.changedPaths.implementation.length);
  assert.equal(sha256(gitBytes('diff-tree', '--no-commit-id', '--name-only', '-r', receipt.implementationCommit)), receipt.implementationManifest.pathListSha256);
  assert.equal(sha256(gitBytes('ls-tree', '-r', receipt.implementationCommit, 'fixtures/runbookShadow', 'test/runbookShadow')), receipt.implementationManifest.scopedLsTreeSha256);
  const patch = gitBytes('show', '--pretty=format:', '--binary', receipt.implementationCommit);
  const patchId = execFileSync('git', ['patch-id', '--stable'], { cwd: ROOT, input: patch, encoding: 'utf8' }).trim().split(/\s+/)[0];
  assert.equal(patchId, receipt.implementationManifest.stablePatchId);
});

test('directive, shadow source, port plan, registry, and typed rows remain immutable', () => {
  const directive = receipt.directiveEvidence;
  assert.equal(git('rev-parse', `${directive.commit}^{tree}`), directive.tree);
  assert.equal(git('rev-parse', `${directive.commit}:${directive.directorStatePath}`), directive.directorStateBlob);
  assert.equal(git('rev-parse', `${directive.commit}:${directive.workerPromptsPath}`), directive.workerPromptsBlob);
  assert(git('show', `${directive.commit}:${directive.directorStatePath}`).includes('## D-LAUNCH-51 (2026-07-16): CI red diagnosed + post-landing burst launched (11 chats)'));
  assert(git('show', `${directive.commit}:${directive.workerPromptsPath}`).includes('You are the PORT RUNBOOK PORT worker'));

  const source = receipt.sourceEvidence;
  assert.equal(git('rev-parse', `refs/heads/${source.branch}`), source.sealedCommit);
  assert.equal(git('rev-parse', `${source.sealedCommit}^{tree}`), source.sealedTree);
  assert.equal(git('rev-parse', `${source.sealedCommit}^`), source.shadowImplementationCommit);
  assert.equal(git('rev-parse', `${source.sealedCommit}:${source.shadowReceiptPath}`), source.shadowReceiptBlob);
  assert.equal(diffPaths(source.payloadBase, source.sealedCommit).length, source.sourcePathCount);
  assert.equal(source.shadowReceiptDisposition, 'LINEAGE_ONLY_NOT_ACCEPTANCE');

  assert.equal(sha256(readFileSync(receipt.portPlanEvidence.scriptPath)), receipt.portPlanEvidence.scriptSha256);
  assert.equal(sha256(readFileSync(receipt.portPlanEvidence.conflictReportPath)), receipt.portPlanEvidence.conflictReportSha256);
  assert.equal(receipt.portPlanEvidence.applyDisposition, 'NOT_RUN_OBSOLETE_RELOCATION_CONFLICTS_WITH_D_LAUNCH_51_ROOTS');

  const registry = receipt.registryEvidence;
  assert.equal(git('rev-parse', `refs/heads/${registry.branch}`), registry.commit);
  assert.equal(git('rev-parse', `${registry.commit}^{tree}`), registry.tree);
  assert.equal(git('rev-parse', `${registry.commit}:${registry.collisionMapPath}`), registry.collisionMapBlob);
  assert.equal(git('rev-parse', `${receipt.baseCommit}:${registry.schemaPath}`), registry.schemaBlobAtBase);
  assert.equal(git('rev-parse', `${receipt.implementationCommit}:${receipt.insertionRequests.manifestPath}`), receipt.insertionRequests.manifestBlobAtImplementationCommit);

  const requests = insertionRequestDocument();
  assert.deepEqual(requests.map((request) => request.rowId), receipt.insertionRequests.ids);
  assert(requests.every((request) => request.schema === registry.schemaDefinition));
  assert(requests.every((request) => request.status === 'DRAFT'));
  assert(requests.every((request) => request.wiringState === `PENDING_BACKEND:${request.rowId}`));
  assert(requests.every((request) => request.authorityCreated === false));
  assert.equal(receipt.insertionRequests.serializedVerbatimFromImmutableRegistry, true);
  assert.equal(receipt.insertionRequests.authorityCreated, false);
});

test('sealed drill receipts reproduce canonically with zero effects', async () => {
  const current = await runAllDrills();
  assert.equal(current.length, 8);
  assert.equal(receipt.drillReceipts.length, 8);
  for (let index = 0; index < current.length; index += 1) {
    const actual = current[index];
    const sealed = receipt.drillReceipts[index];
    assert.equal(actual.drillId, sealed.drillId);
    assert.equal(actual.result, sealed.result);
    assert.equal(actual.exitCode, sealed.exitCode);
    assert.equal(actual.assertions.passed, sealed.assertionPassed);
    assert.equal(actual.assertions.total, sealed.assertionTotal);
    assert.equal(digest(actual), sealed.receiptDigestSha256);
    assert.equal(actual.ownerEvidenceDigestSha256, sealed.ownerEvidenceDigestSha256);
    assert.deepEqual(actual.ownerEvidence.scenarios.map((scenario) => scenario.terminal), sealed.observedTerminals);
    assert.equal(await verifyPassReceiptAgainstExecution(actual), true);
  }
  assert.equal(current.reduce((total, item) => total + item.assertions.passed, 0), 53);
  assert(current.every((item) => item.effects.networkAttempts === 0));
  assert.deepEqual(receipt.zeroEffects, ZERO_EFFECT);
});

test('receipt preserves prestage boundary, honest root failures, and integration limitations', () => {
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.packetId, 'PORT-RUNBOOK');
  assert.equal(receipt.packetDisposition, 'POST_LANDING_PORT_PRESTAGE');
  assert.equal(receipt.terminalState, 'PORT_RUNBOOK_PRESTAGE_READY');
  assert.equal(receipt.authorityCreated, false);
  assert.deepEqual(forbiddenClaimPaths(receipt), []);
  assert.equal(receipt.effectEvidence.networkAttempts, 'OBSERVED_CANONICAL_EGRESS_TRIPWIRE_RUNBOOK_SUPPLEMENT_AND_OS_NETWORK_DENIAL');
  assert.equal(receipt.effectEvidence.orderCalls, 'ENFORCED_NO_MONEY_PATH_AND_SYNTHETIC_OWNER_INPUTS');

  const focused = receipt.verification.find((entry) => entry.id === 'focused-os-network-denied-preseal');
  const runAll = receipt.verification.find((entry) => entry.id === 'direct-run-all-os-network-denied');
  const npmTest = receipt.verification.find((entry) => entry.id === 'npm-test');
  const npmTestAll = receipt.verification.find((entry) => entry.id === 'npm-test-all');
  assert.equal(focused.exitCode, 0);
  assert.deepEqual({ passed: focused.passed, failed: focused.failed }, { passed: 15, failed: 0 });
  assert.equal(runAll.assertionPassed, 53);
  assert.equal(runAll.networkAttempts, 0);
  assert.equal(npmTest.exitCode, 1);
  assert.equal(npmTestAll.exitCode, 1);
  assert.equal(npmTest.typecheck, 'PASS');
  assert.equal(npmTest.build, 'PASS');
  assert.equal(npmTest.failure, 'PRODUCT_ASSURANCE_RUN_FAILED:A_CASE_S4_SAFE_PURITY');
  assert.equal(npmTestAll.failure, npmTest.failure);
  assert.equal(receipt.rootGateDisposition.laneAcceptanceGreen, true);
  assert.equal(receipt.rootGateDisposition.rootCommandsGreen, false);
  assert.equal(receipt.rootGateDisposition.workerAction, 'NO_OUT_OF_SCOPE_FIX_OR_SYNTHETIC_OWNER_FILE');

  assert.equal(receipt.sealVerification.expectedPassed, 19);
  assert.equal(receipt.sealVerification.expectedFailed, 0);
  assert(receipt.limitations.some((item) => item.includes('PRESTAGE_ONLY')));
  assert(receipt.limitations.some((item) => item.includes('must not be registered unchanged')));
  assert(receipt.limitations.some((item) => item.includes('runtimeExecutions is the declared operation plan')));
  assert(receipt.limitations.some((item) => item.includes('no root-green claim')));
  assert(receipt.nonClaims.some((item) => item.includes('No root npm green status')));
  assert(receipt.nonClaims.some((item) => item.includes('LIVE_EXECUTION_NOT_IMPLEMENTED')));
});
