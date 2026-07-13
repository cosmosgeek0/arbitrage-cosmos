#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fail, parseArgs, readJson, sha256File,
} from '../lib.mjs';

const EXPECTED_CONTRACT_SHA256 = '078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3';
const args = parseArgs(process.argv.slice(2), new Set(['contract-only']));
const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(args.contract ?? resolve(here, '../donor-contract.json'));
if (sha256File(contractPath) !== EXPECTED_CONTRACT_SHA256) {
  fail('embedded donor contract does not match the exact accepted contract');
}
const contract = readJson(contractPath, 'donor contract');

if (args['contract-only'] === true) {
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

process.stdout.write(`${JSON.stringify({
  status: 'ACCEPTED_DONOR_VERIFIED',
  acceptedCommit: contract.acceptedCommit,
  liveTree: contract.liveTree,
  testsTree: contract.testsTree,
  acceptedSuites: contract.acceptedSuites,
  acceptedAssertions: contract.acceptedAssertions,
})}\n`);
