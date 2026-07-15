import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  EFFECT_EVIDENCE,
  ROOT,
  ZERO_EFFECT,
  insertionRequestDocument,
  readJson,
} from './lib/constants.mjs';
import { digest } from './lib/receipt.mjs';
import { runAllDrills, verifyPassReceiptAgainstExecution } from './lib/runner.mjs';

const RECEIPT_PATH = 'fixtures/runbookShadow/receipts/RUNBOOK_SHADOW_RECEIPT.v1.json';
const receipt = readJson(RECEIPT_PATH);

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function gitBytes(...args) {
  return execFileSync('git', args, { cwd: ROOT });
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

test('receipt seals exact base, implementation, authority, preverify, and exclusive paths', () => {
  const head = git('rev-parse', 'HEAD');
  assert.equal(git('branch', '--show-current'), receipt.branch);
  assert.equal(git('rev-parse', 'HEAD^'), receipt.implementationCommit);
  assert.equal(git('rev-parse', `${receipt.implementationCommit}^`), receipt.baseCommit);
  assert.equal(receipt.implementationParentSha, receipt.baseCommit);
  assert.equal(git('rev-parse', `${receipt.baseCommit}^{tree}`), receipt.baseTree);
  assert.equal(git('rev-parse', `${receipt.implementationCommit}^{tree}`), receipt.implementationTree);
  assert.equal(receipt.sealCommitIdentity, 'ENCLOSING_GIT_COMMIT_IS_AUTHORITY_AND_IS_NOT_SELF_RECORDED');

  assert.equal(git('rev-parse', `${receipt.directiveEvidence.commit}^{tree}`), receipt.directiveEvidence.tree);
  assert.equal(git('rev-parse', `${receipt.directiveEvidence.commit}:${receipt.directiveEvidence.directorStatePath}`), receipt.directiveEvidence.directorStateBlob);
  assert.equal(git('rev-parse', `${receipt.directiveEvidence.commit}:${receipt.directiveEvidence.workerPromptsPath}`), receipt.directiveEvidence.workerPromptsBlob);
  assert(git('show', `${receipt.directiveEvidence.commit}:${receipt.directiveEvidence.directorStatePath}`).includes(`## ${receipt.directiveEvidence.directive} (2026-07-15): second acceleration order (${receipt.directiveEvidence.order})`));
  assert(git('show', `${receipt.directiveEvidence.commit}:${receipt.directiveEvidence.workerPromptsPath}`).includes('TASK: RUNBOOK-SHADOW — executable zero-capital owner drills'));

  assert.equal(git('rev-parse', `refs/heads/${receipt.preverifyEvidence.branch}`), receipt.preverifyEvidence.branchCommit);
  assert.equal(git('rev-parse', `${receipt.preverifyEvidence.ownerPrepCommit}:ownerPrep`), receipt.preverifyEvidence.ownerPrepTree);
  assert.equal(git('rev-parse', `${receipt.preverifyEvidence.branchCommit}:ownerPrep`), receipt.preverifyEvidence.ownerPrepTree);
  assert.equal(receipt.preverifyEvidence.classifiedPathCount, 19);

  assert.deepEqual(sorted(diffPaths(receipt.baseCommit, receipt.implementationCommit)), sorted(receipt.changedPaths.implementation));
  assert.deepEqual(sorted(diffPaths(receipt.implementationCommit, head)), sorted(receipt.changedPaths.seal));
  assert.deepEqual(sorted(diffPaths(receipt.baseCommit, head)), sorted(receipt.changedPaths.all));
  assert.equal(new Set(receipt.changedPaths.all).size, receipt.changedPaths.all.length);
  assert(receipt.changedPaths.all.every((file) => file.startsWith('fixtures/runbookShadow/') || file.startsWith('test/runbookShadow/')));
  assert.deepEqual(git('status', '--porcelain'), '');
});

test('every implementation artifact matches the immutable commit blob, mode, and raw sha256', () => {
  assert.equal(receipt.artifacts.length, receipt.changedPaths.implementation.length);
  assert.deepEqual(sorted(receipt.artifacts.map((artifact) => artifact.path)), sorted(receipt.changedPaths.implementation));
  for (const artifact of receipt.artifacts) {
    const row = git('ls-tree', receipt.implementationCommit, '--', artifact.path);
    const match = row.match(/^(\d+) blob ([0-9a-f]{40})\t(.+)$/);
    assert(match, artifact.path);
    assert.equal(match[1], artifact.mode, artifact.path);
    assert.equal(match[2], artifact.gitBlob, artifact.path);
    assert.equal(match[3], artifact.path);
    const sha256 = createHash('sha256')
      .update(gitBytes('show', `${receipt.implementationCommit}:${artifact.path}`))
      .digest('hex');
    assert.equal(sha256, artifact.sha256, artifact.path);
  }
});

test('sealed PASS receipts reproduce byte-for-byte in canonical form', async () => {
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
});

test('receipt preserves speculative boundary, insertion gate, zero effects, and limitations', () => {
  assert.equal(receipt.packetId, 'RUN-19');
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.packetName, 'RUNBOOK-SHADOW');
  assert.equal(receipt.packetDisposition, 'SHADOW_SPECULATIVE');
  assert.equal(receipt.terminalState, 'RUNBOOK_SHADOW_READY');
  assert.equal(receipt.authorityCreated, false);
  assert.equal(receipt.portingGate, 'C2_PLUS_DIRECTOR_ADJUDICATION_REQUIRED');
  assert.deepEqual(forbiddenClaimPaths(receipt), []);
  assert.deepEqual(receipt.zeroEffects, ZERO_EFFECT);
  assert.deepEqual(receipt.effectEvidence, {
    ...EFFECT_EVIDENCE,
    networkAttempts: 'OBSERVED_IN_PROCESS_DENY_GUARD_AND_OS_NETWORK_DENIAL',
  });
  assert(receipt.limitations.some((item) => item.includes('not universal machine-wide instrumentation')));
  assert(receipt.nonClaims.some((item) => item.includes('No acceptance status')));
  assert.equal(digest(receipt.limitations), '75da0faf57a37dce421ace57cb2fc57eeaded1653679392f53892af0aeff7f44');
  assert.equal(digest(receipt.nonClaims), '372aa665ad534191c3a1d9b327572a19001b37915c3ffb830f6b0db3de498cfe');
  assert.equal(digest(receipt.verification), '442e33c5b24c858947366c6065faa71edd586091543ce9f5b8b9535dd176042e');
  assert.equal(digest(receipt.insertionRequests), 'e2e43ae8005aca0ff81f0b5118f90a7156e69aa630aa88b0383794e3748fc682');
  assert.equal(receipt.insertionRequests.authorityCreated, false);
  assert.equal(receipt.insertionRequests.allRequireDirectorAdjudication, true);

  const requests = insertionRequestDocument().requests;
  assert.equal(git('rev-parse', `${receipt.implementationCommit}:${receipt.insertionRequests.manifestPath}`), receipt.insertionRequests.manifestBlobAtImplementationCommit);
  assert.deepEqual(receipt.insertionRequests.ids, requests.map((request) => request.id));
  assert(requests.every((request) => request.authorityCreated === false));
  assert(requests.every((request) => request.prerequisites.includes('DIRECTOR_ADJUDICATION')));
  assert(requests.find((request) => request.id === 'RUN19-IR-01-C2-REBIND').prerequisites.includes('EXACT_C2_COMMIT_SELECTED'));

  assert(receipt.verification.every((entry) => entry.atCommit === receipt.implementationCommit));
  assert(receipt.verification.every((entry) => entry.exitCode === 0));
  assert.equal(receipt.verification.find((entry) => entry.id === 'focused-packet-tests').passed, 15);
  assert.equal(receipt.verification.find((entry) => entry.id === 'direct-run-all').assertionPassed, 53);
  assert.equal(receipt.verification.find((entry) => entry.id === 'os-network-denied-run-all').networkAttempts, 0);
});
