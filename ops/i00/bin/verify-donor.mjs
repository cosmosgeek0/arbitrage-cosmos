#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fail, parseArgs, readJson, sha256File,
} from '../lib.mjs';
import { loadL15AmendmentContract } from '../l15-amendment.mjs';

const EXPECTED_DONOR_CONTRACT_SHA256 = '078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3';
const EXPECTED_AMENDMENT_CONTRACT_SHA256 = 'b574044daa93296c74f900dba488a77db6f19501a63430740854047dff038656';
const args = parseArgs(process.argv.slice(2), new Set(['contract-only', 'integrated']));
const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(args.contract ?? resolve(here, '../donor-contract.json'));
const amendmentPath = resolve(
  args['amendment-contract'] ?? resolve(dirname(contractPath), 'l15-amendment-contract.json'),
);
if (sha256File(contractPath) !== EXPECTED_DONOR_CONTRACT_SHA256) {
  fail('embedded donor contract does not match the exact accepted contract');
}
const contract = readJson(contractPath, 'donor contract');
const loadedAmendment = loadL15AmendmentContract(
  amendmentPath,
  EXPECTED_AMENDMENT_CONTRACT_SHA256,
);

if (args['contract-only'] === true) {
  if (args.integrated === true) {
    fail('--integrated requires --repo and cannot be combined with --contract-only');
  }
  process.stdout.write(`${JSON.stringify({
    status: 'ACCEPTED_DONOR_CONTRACT_VERIFIED',
    acceptedCommit: contract.acceptedCommit,
    immutableDonorLiveTree: contract.liveTree,
    testsTree: contract.testsTree,
    donorContractSha256: EXPECTED_DONOR_CONTRACT_SHA256,
    amendmentContractSha256: EXPECTED_AMENDMENT_CONTRACT_SHA256,
    effectiveLiveTree: loadedAmendment.contract.effectiveLive.tree,
    effectiveRootDigestSha256: loadedAmendment.contract.effectiveLive.rootDigestSha256,
    findingIds: loadedAmendment.findingIds,
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

function gitBuffer(...gitArgs) {
  try {
    return execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 });
  } catch {
    fail(`Git byte verification failed: git ${gitArgs.join(' ')}`);
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseTreeLine(line, label) {
  const match = line.match(/^([0-9]{6}) blob ([0-9a-f]{40})\t(.+)$/);
  if (!match) fail(`${label} is not a regular Git blob entry`);
  return { mode: match[1], gitBlob: match[2], path: match[3] };
}

function treeEntry(tree, relative) {
  const output = git('ls-tree', tree, '--', relative);
  if (!output || output.includes('\n')) fail(`L15 tree entry is missing or ambiguous: ${tree}:${relative}`);
  return parseTreeLine(output, `L15 tree entry ${relative}`);
}

function assertBlobSha256(gitBlob, expectedSha256, label) {
  if (sha256(gitBuffer('cat-file', 'blob', gitBlob)) !== expectedSha256) {
    fail(`${label} Git bytes do not match their bound SHA-256`);
  }
}

if (git('rev-parse', '--verify', '--end-of-options', `${contract.acceptedCommit}^{commit}`)
    !== contract.acceptedCommit) {
  fail('accepted donor commit does not resolve exactly');
}
if (git('rev-parse', '--verify', '--end-of-options', `${contract.acceptedCommit}:ops/live`)
    !== contract.liveTree) {
  fail('accepted donor ops/live tree hash changed');
}
if (git('rev-parse', '--verify', '--end-of-options', `${contract.acceptedCommit}:ops/tests`)
    !== contract.testsTree) {
  fail('accepted donor ops/tests tree hash changed');
}
if (git('rev-parse', '--verify', '--end-of-options', `${contract.implementationCommit}^`)
    !== contract.baseCommit) {
  fail('donor implementation ancestry does not match the accepted base');
}
const acceptedReceipt = loadedAmendment.contract.immutableDonor.acceptedReceipt;
if (git('rev-parse', '--verify', '--end-of-options', `${contract.acceptedCommit}:${acceptedReceipt.path}`)
    !== acceptedReceipt.gitBlob) {
  fail('accepted donor receipt blob does not match immutable Git');
}
assertBlobSha256(acceptedReceipt.gitBlob, acceptedReceipt.sha256, 'accepted donor receipt');

let integration = null;
if (args.integrated === true) {
  const head = git('rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}');
  if (!gitSucceeds('merge-base', '--is-ancestor', contract.acceptedCommit, head)) {
    fail('accepted donor commit is not an ancestor of the integration HEAD');
  }
  const effective = loadedAmendment.contract.effectiveLive;
  if (git('rev-parse', '--verify', '--end-of-options', `${head}:ops/live`) !== effective.tree) {
    fail('integrated ops/live tree is not the exact authorized effective L15 tree');
  }
  if (!gitSucceeds('diff', '--quiet', 'HEAD', '--', 'ops/live')
      || git('ls-files', '--others', '--exclude-standard', '--', 'ops/live') !== '') {
    fail('integrated effective ops/live working bytes are dirty or untracked');
  }

  const expectedTreeEntries = effective.files.map((file) => ({
    ...file,
    path: `ops/live/${file.path}`,
  }));
  const actualTreeEntries = git('ls-tree', '-r', head, '--', 'ops/live')
    .split('\n').filter(Boolean).map((line) => parseTreeLine(line, 'integrated effective ops/live tree'));
  if (actualTreeEntries.length !== expectedTreeEntries.length) {
    fail('integrated effective ops/live path count does not match the correction contract');
  }
  const rootDigest = createHash('sha256');
  expectedTreeEntries.forEach((expected, index) => {
    const actual = actualTreeEntries[index];
    if (actual.path !== expected.path || actual.mode !== expected.mode
        || actual.gitBlob !== expected.gitBlob) {
      fail(`integrated effective ops/live entry differs from the correction contract: ${expected.path}`);
    }
    assertBlobSha256(actual.gitBlob, expected.sha256, `integrated ${expected.path}`);
    rootDigest.update(expected.path.slice('ops/live/'.length));
    rootDigest.update('\0');
    rootDigest.update(expected.sha256);
    rootDigest.update('\n');
  });
  if (rootDigest.digest('hex') !== effective.rootDigestSha256) {
    fail('integrated effective ops/live root digest does not match the correction contract');
  }

  const changedPaths = loadedAmendment.contract.amendments
    .flatMap((amendment) => amendment.changedFiles.map((file) => file.path))
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
  const diffLines = git('diff', '--name-status', '--no-renames', contract.acceptedCommit, head, '--', 'ops/live')
    .split('\n').filter(Boolean);
  if (diffLines.length !== changedPaths.length
      || diffLines.some((line, index) => line !== `M\t${changedPaths[index]}`)) {
    fail('integrated ops/live drift exceeds the exact finding-owned amendment path set');
  }

  // Historical amendment trees may be unreachable on a fresh clone (they were
  // intermediate correction states that never became main-line subtrees). The
  // per-file blob chain below is always verified from reachable objects; the
  // exact tree-transition walk additionally runs whenever both trees exist.
  const blobChain = new Map();
  for (const amendment of loadedAmendment.contract.amendments) {
    const treesReachable = gitSucceeds('cat-file', '-e', amendment.baseLiveTree)
      && gitSucceeds('cat-file', '-e', amendment.effectiveLiveTree);
    if (treesReachable) {
      const expectedTransition = amendment.changedFiles
        .map((file) => `M\t${file.path.slice('ops/live/'.length)}`)
        .sort();
      const actualTransition = git(
        'diff', '--name-status', '--no-renames', amendment.baseLiveTree,
        amendment.effectiveLiveTree, '--',
      ).split('\n').filter(Boolean);
      if (actualTransition.length !== expectedTransition.length
          || actualTransition.some((line, index) => line !== expectedTransition[index])) {
        fail(`L15 amendment transition exceeds its exact finding-owned path set: ${amendment.findingId}`);
      }
    }
    for (const file of amendment.changedFiles) {
      const relative = file.path.slice('ops/live/'.length);
      const chainExpected = blobChain.has(file.path)
        ? blobChain.get(file.path)
        : treeEntry(`${contract.acceptedCommit}:ops/live`, relative).gitBlob;
      if (file.beforeGitBlob !== chainExpected) {
        fail(`L15 amendment blob chain is discontinuous: ${file.path} (${amendment.findingId})`);
      }
      blobChain.set(file.path, file.afterGitBlob);
      if (treesReachable) {
        const before = treeEntry(amendment.baseLiveTree, relative);
        const after = treeEntry(amendment.effectiveLiveTree, relative);
        if (before.path !== relative || before.mode !== file.mode || before.gitBlob !== file.beforeGitBlob
            || after.path !== relative || after.mode !== file.mode || after.gitBlob !== file.afterGitBlob) {
          fail(`L15 amendment before/after Git binding changed: ${file.path}`);
        }
      }
      assertBlobSha256(file.beforeGitBlob, file.beforeSha256, `${file.path} before`);
      assertBlobSha256(file.afterGitBlob, file.afterSha256, `${file.path} after`);
    }
    for (const bound of [amendment.correctionReceipt, ...amendment.regressionTests]) {
      const headBlob = git('rev-parse', '--verify', '--end-of-options', `${head}:${bound.path}`);
      if (headBlob !== bound.gitBlob || !gitSucceeds('diff', '--quiet', 'HEAD', '--', bound.path)) {
        fail(`L15 amendment evidence differs from the exact committed binding: ${bound.path}`);
      }
      assertBlobSha256(bound.gitBlob, bound.sha256, bound.path);
    }
  }

  const donorTestPaths = git(
    'ls-tree', '-r', '--name-only', contract.acceptedCommit, '--', 'ops/tests',
  ).split('\n').filter(Boolean);
  if (donorTestPaths.length !== loadedAmendment.contract.immutableDonor.acceptedDonorTestFileCount) {
    fail('accepted donor test path set count changed');
  }
  // A donor-owned test may evolve only through a receipted amendment that binds
  // its exact before/after bytes; the latest amendment's after-bytes govern.
  const latestTestAfter = new Map();
  for (const amendment of loadedAmendment.contract.amendments) {
    for (const changed of amendment.changedTestFiles ?? []) {
      latestTestAfter.set(changed.path, changed);
    }
  }
  for (const path of donorTestPaths) {
    const acceptedBlob = git('rev-parse', '--verify', '--end-of-options', `${contract.acceptedCommit}:${path}`);
    const integratedBlob = git('rev-parse', '--verify', '--end-of-options', `${head}:${path}`);
    const evolution = latestTestAfter.get(path);
    if (evolution !== undefined) {
      if (evolution.beforeGitBlob !== acceptedBlob || integratedBlob !== evolution.afterGitBlob
          || !gitSucceeds('diff', '--quiet', 'HEAD', '--', path)) {
        fail(`integrated donor-owned test bytes differ from their amended binding: ${path}`);
      }
      continue;
    }
    if (acceptedBlob !== integratedBlob || !gitSucceeds('diff', '--quiet', 'HEAD', '--', path)) {
      fail(`integrated donor-owned test bytes differ from accepted Git: ${path}`);
    }
  }
  integration = Object.freeze({
    head,
    acceptedDonorAncestor: true,
    immutableDonorLiveTree: contract.liveTree,
    effectiveLiveTree: effective.tree,
    effectiveRootDigestSha256: effective.rootDigestSha256,
    authorizedCorrectionFindingIds: loadedAmendment.findingIds,
    integratedDonorTestFiles: donorTestPaths.length,
    workingBytesExact: true,
  });
}

process.stdout.write(`${JSON.stringify({
  status: args.integrated === true
    ? 'INTEGRATED_ACCEPTED_DONOR_WITH_AUTHORIZED_CORRECTIONS_VERIFIED'
    : 'ACCEPTED_DONOR_VERIFIED',
  acceptedCommit: contract.acceptedCommit,
  immutableDonorLiveTree: contract.liveTree,
  testsTree: contract.testsTree,
  acceptedSuites: contract.acceptedSuites,
  acceptedAssertions: contract.acceptedAssertions,
  amendmentContractSha256: EXPECTED_AMENDMENT_CONTRACT_SHA256,
  effectiveLiveTree: loadedAmendment.contract.effectiveLive.tree,
  effectiveRootDigestSha256: loadedAmendment.contract.effectiveLive.rootDigestSha256,
  integration,
})}\n`);
