import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AI_OPS_DONOR_IDENTITIES,
  readAiOpsGitIdentity,
} from './git-identity.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

function git(repository, args) {
  return execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function assertClean(repository) {
  assert.equal(git(repository, ['status', '--porcelain=v1', '--untracked-files=all']), '');
}

function assertDetached(repository) {
  const result = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
}

function assertIntegrated(repository, commit, tree) {
  const identity = readAiOpsGitIdentity(repository, 'A5');
  assert.equal(identity.mode, 'INTEGRATED');
  assert.equal(identity.verificationTarget, 'CURRENT_HEAD_TREE');
  assert.equal(identity.headCommit, commit);
  assert.equal(identity.headTree, tree);
}

test('FIX-172 exact Git environments preserve branch-independent AI-Ops identity', { timeout: 60_000 }, () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cosmos-ai-ops-identity-'));
  try {
    const integratedCommit = git(ROOT, ['rev-parse', '--verify', 'HEAD^{commit}']);
    const integratedTree = git(ROOT, ['rev-parse', '--verify', 'HEAD^{tree}']);
    assert.notEqual(integratedCommit, AI_OPS_DONOR_IDENTITIES.A5.commit);

    const attached = path.join(temporaryRoot, 'attached-source');
    git(temporaryRoot, ['clone', '--quiet', '--no-local', '--no-checkout', ROOT, attached]);
    git(attached, ['checkout', '--quiet', '-b', 'port-a5-20260716', integratedCommit]);
    assert.equal(git(attached, ['symbolic-ref', '--short', 'HEAD']), 'port-a5-20260716');
    assertIntegrated(attached, integratedCommit, integratedTree);
    assertClean(attached);

    const detached = path.join(temporaryRoot, 'detached-worktree');
    git(attached, ['worktree', 'add', '--quiet', '--detach', detached, integratedCommit]);
    assertDetached(detached);
    assertIntegrated(detached, integratedCommit, integratedTree);
    assertClean(detached);

    const cleanClone = path.join(temporaryRoot, 'clean-clone');
    git(temporaryRoot, [
      'clone', '--quiet', '--no-local', '--branch', 'port-a5-20260716', attached, cleanClone,
    ]);
    assert.equal(git(cleanClone, ['symbolic-ref', '--short', 'HEAD']), 'port-a5-20260716');
    assertIntegrated(cleanClone, integratedCommit, integratedTree);
    assertClean(cleanClone);

    const donor = path.join(temporaryRoot, 'exact-donor-worktree');
    git(attached, [
      'worktree', 'add', '--quiet', '--detach', donor, AI_OPS_DONOR_IDENTITIES.A5.commit,
    ]);
    assertDetached(donor);
    const donorIdentity = readAiOpsGitIdentity(donor, 'A5');
    assert.equal(donorIdentity.mode, 'DONOR');
    assert.equal(donorIdentity.verificationTarget, 'SEALED_DONOR_HISTORY');
    assert.equal(donorIdentity.headCommit, AI_OPS_DONOR_IDENTITIES.A5.commit);
    assert.equal(donorIdentity.headTree, AI_OPS_DONOR_IDENTITIES.A5.tree);
    assertClean(donor);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
