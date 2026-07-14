#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fail, parseArgs, readJson, sha256File,
} from '../lib.mjs';

const EXPECTED_CONTRACT_SHA256 = '078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3';
const args = parseArgs(process.argv.slice(2), new Set(['contract-only', 'integrated']));
const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(args.contract ?? resolve(here, '../donor-contract.json'));
if (sha256File(contractPath) !== EXPECTED_CONTRACT_SHA256) {
  fail('embedded donor contract does not match the exact accepted contract');
}
const contract = readJson(contractPath, 'donor contract');

if (args['contract-only'] === true) {
  if (args.integrated === true) fail('--integrated requires --repo and cannot be combined with --contract-only');
  process.stdout.write(`${JSON.stringify({
    status: 'ACCEPTED_DONOR_CONTRACT_VERIFIED',
    acceptedCommit: contract.acceptedCommit,
    liveTree: contract.liveTree,
    testsTree: contract.testsTree,
    contractSha256: EXPECTED_CONTRACT_SHA256,
  })}\n`);
  process.exit(0);
}

if (!args.repo) fail('--repo is required unless --contract-only is used');
const repo = resolve(args.repo);

function git(...gitArgs) {
  try {
    return execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8' }).trim();
  } catch {
    fail(`Git object verification failed: git ${gitArgs.join(' ')}`);
  }
}

function gitSucceeds(...gitArgs) {
  try {
    execFileSync('git', ['-C', repo, ...gitArgs], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (git('rev-parse', '--verify', '--end-of-options', `${contract.acceptedCommit}^{commit}`) !== contract.acceptedCommit) {
  fail('accepted donor commit does not resolve exactly');
}
if (git('rev-parse', '--verify', '--end-of-options', `${contract.acceptedCommit}:ops/live`) !== contract.liveTree) {
  fail('accepted donor ops/live tree hash changed');
}
if (git('rev-parse', '--verify', '--end-of-options', `${contract.acceptedCommit}:ops/tests`) !== contract.testsTree) {
  fail('accepted donor ops/tests tree hash changed');
}
if (git('rev-parse', '--verify', '--end-of-options', `${contract.implementationCommit}^`) !== contract.baseCommit) {
  fail('donor implementation ancestry does not match the accepted base');
}

let integration = null;
if (args.integrated === true) {
  const head = git('rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}');
  if (!gitSucceeds('merge-base', '--is-ancestor', contract.acceptedCommit, head)) {
    fail('accepted donor commit is not an ancestor of the integration HEAD');
  }
  if (git('rev-parse', '--verify', '--end-of-options', `${head}:ops/live`) !== contract.liveTree) {
    fail('integrated ops/live tree differs from the exact accepted donor tree');
  }
  if (!gitSucceeds('diff', '--quiet', 'HEAD', '--', 'ops/live')
      || git('ls-files', '--others', '--exclude-standard', '--', 'ops/live') !== '') {
    fail('integrated ops/live working bytes are dirty or untracked');
  }
  const donorTestPaths = git(
    'ls-tree', '-r', '--name-only', contract.acceptedCommit, '--', 'ops/tests',
  ).split('\n').filter(Boolean);
  if (donorTestPaths.length === 0) fail('accepted donor test path set is empty');
  for (const path of donorTestPaths) {
    const acceptedBlob = git('rev-parse', '--verify', '--end-of-options', `${contract.acceptedCommit}:${path}`);
    const integratedBlob = git('rev-parse', '--verify', '--end-of-options', `${head}:${path}`);
    if (acceptedBlob !== integratedBlob || !gitSucceeds('diff', '--quiet', 'HEAD', '--', path)) {
      fail(`integrated donor-owned test bytes differ from accepted Git: ${path}`);
    }
  }
  integration = Object.freeze({
    head,
    acceptedDonorAncestor: true,
    integratedLiveTree: contract.liveTree,
    integratedDonorTestFiles: donorTestPaths.length,
    workingBytesExact: true,
  });
}

process.stdout.write(`${JSON.stringify({
  status: args.integrated === true ? 'INTEGRATED_ACCEPTED_DONOR_VERIFIED' : 'ACCEPTED_DONOR_VERIFIED',
  acceptedCommit: contract.acceptedCommit,
  liveTree: contract.liveTree,
  testsTree: contract.testsTree,
  acceptedSuites: contract.acceptedSuites,
  acceptedAssertions: contract.acceptedAssertions,
  integration,
})}\n`);
