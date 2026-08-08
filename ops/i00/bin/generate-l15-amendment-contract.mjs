#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRegularFiles } from '../lib.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const contractPath = resolve(repoRoot, 'ops/i00/l15-amendment-contract.json');
const finalFindingId = 'DEPLOY-PORTABILITY-008';
const finalAmendmentIndex = 7;
const expectedChangedFileCount = 19;
const pinPaths = Object.freeze([
  'ops/i00/bin/assemble-release.mjs',
  'ops/i00/bin/record-authorized-action-outcome.mjs',
  'ops/i00/bin/validate-release.mjs',
  'ops/i00/bin/verify-donor.mjs',
  'ops/i00/bin/verify-donor-root.mjs',
]);

function fail(message) {
  throw new Error(message);
}

function git(args, encoding = 'utf8') {
  const result = spawnSync('/usr/bin/git', ['-C', repoRoot, ...args], {
    encoding: encoding === null ? undefined : encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`git ${args.join(' ')} failed with exit ${String(result.status)}`);
  }
  return result.stdout;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function blobSha256(gitBlob) {
  return sha256(git(['cat-file', 'blob', gitBlob], null));
}

function indexEntry(path) {
  const line = git(['ls-files', '--stage', '--', path]).trim();
  const match = /^(100644|100755) ([0-9a-f]{40}) 0\t(.+)$/u.exec(line);
  if (!match || match[3] !== path) fail(`unexpected staged Git entry for ${path}`);
  return { mode: match[1], gitBlob: match[2] };
}

function treeEntry(tree, path) {
  const line = git(['ls-tree', tree, '--', path]).trim();
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(line);
  if (!match || match[3] !== path) fail(`unexpected ${tree} Git entry for ${path}`);
  return { mode: match[1], gitBlob: match[2] };
}

function currentBound(path) {
  const entry = indexEntry(path);
  return {
    path,
    mode: entry.mode,
    gitBlob: entry.gitBlob,
    sha256: blobSha256(entry.gitBlob),
  };
}

function changedBound(beforeTree, beforePath, afterPath) {
  const before = treeEntry(beforeTree, beforePath);
  const after = indexEntry(afterPath);
  const beforeSha256 = blobSha256(before.gitBlob);
  const afterSha256 = blobSha256(after.gitBlob);
  if (before.gitBlob === after.gitBlob || beforeSha256 === afterSha256) {
    fail(`${afterPath} does not identify distinct before and after bytes`);
  }
  return {
    path: afterPath,
    mode: after.mode,
    beforeGitBlob: before.gitBlob,
    beforeSha256,
    afterGitBlob: after.gitBlob,
    afterSha256,
  };
}

function sameAfterBinding(left, right) {
  return left.mode === right.mode
    && left.afterGitBlob === right.afterGitBlob
    && left.afterSha256 === right.afterSha256;
}

const originalBytes = readFileSync(contractPath);
const oldContractSha256 = sha256(originalBytes);
const contract = JSON.parse(originalBytes.toString('utf8'));
if (!Array.isArray(contract.amendments)
    || contract.amendments.length !== finalAmendmentIndex + 1) {
  fail('L15 contract does not contain the exact closed amendment sequence');
}
const finalAmendment = contract.amendments[finalAmendmentIndex];
if (finalAmendment.findingId !== finalFindingId
    || !Array.isArray(finalAmendment.changedFiles)
    || finalAmendment.changedFiles.length !== expectedChangedFileCount) {
  fail('final L15 amendment does not have the exact closed changed-file model');
}

const priorChangedFiles = finalAmendment.changedFiles;
finalAmendment.changedFiles = priorChangedFiles.map((file) => {
  if (!file.path.startsWith('ops/live/')) fail(`changed file is outside ops/live: ${file.path}`);
  return changedBound(
    finalAmendment.baseLiveTree,
    file.path.slice('ops/live/'.length),
    file.path,
  );
});
const changedAfterPaths = finalAmendment.changedFiles.flatMap((file, index) => (
  sameAfterBinding(priorChangedFiles[index], file) ? [] : [file.path]
));

finalAmendment.changedTestFiles = finalAmendment.changedTestFiles.map((file) => (
  changedBound(contract.immutableDonor.acceptedCommit, file.path, file.path)
));

let refreshedBoundFiles = 0;
for (const amendment of contract.amendments) {
  const correctionReceipt = currentBound(amendment.correctionReceipt.path);
  if (JSON.stringify(correctionReceipt) !== JSON.stringify(amendment.correctionReceipt)) {
    refreshedBoundFiles += 1;
  }
  amendment.correctionReceipt = correctionReceipt;
  amendment.regressionTests = amendment.regressionTests.map((test) => {
    const refreshed = currentBound(test.path);
    if (JSON.stringify(refreshed) !== JSON.stringify(test)) refreshedBoundFiles += 1;
    return refreshed;
  });
}
contract.authorizedEffectRuntime.runnerSha256 = blobSha256(
  indexEntry(contract.authorizedEffectRuntime.runnerPath).gitBlob,
);
contract.authorizedEffectRuntime.verifierSha256 = blobSha256(
  indexEntry(contract.authorizedEffectRuntime.verifierPath).gitBlob,
);

const liveRoot = resolve(repoRoot, 'ops/live');
const livePaths = listRegularFiles(liveRoot);
const codeUnitSortedPaths = [...livePaths].sort();
if (livePaths.length !== contract.immutableDonor.acceptedLiveFileCount
    || livePaths.some((path, index) => path !== codeUnitSortedPaths[index])) {
  fail('ops/live inventory is not the exact default code-unit ordered file set');
}
const liveFiles = livePaths.map((path) => {
  const bound = currentBound(`ops/live/${path}`);
  const workingSha256 = sha256(readFileSync(resolve(liveRoot, path)));
  if (workingSha256 !== bound.sha256) fail(`ops/live working bytes differ from the index: ${path}`);
  return {
    path,
    mode: bound.mode,
    gitBlob: bound.gitBlob,
    sha256: bound.sha256,
  };
});
const rootHash = createHash('sha256');
for (const file of liveFiles) {
  rootHash.update(file.path);
  rootHash.update('\0');
  rootHash.update(file.sha256);
  rootHash.update('\n');
}
const effectiveRootDigestSha256 = rootHash.digest('hex');
const stagedInputTree = git(['write-tree']).trim();
const effectiveLiveTree = git(['rev-parse', `${stagedInputTree}:ops/live`]).trim();
const stagedLiveEntries = git(['ls-tree', '-r', `${stagedInputTree}:ops/live`])
  .trim().split('\n').filter(Boolean);
if (stagedLiveEntries.length !== liveFiles.length) {
  fail('staged ops/live inventory count differs from the working inventory');
}
const stagedLiveByPath = new Map(stagedLiveEntries.map((line) => {
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(line);
  if (!match) fail('staged ops/live contains a non-regular entry');
  return [match[3], { mode: match[1], gitBlob: match[2] }];
}));
for (const file of liveFiles) {
  const staged = stagedLiveByPath.get(file.path);
  if (!staged || staged.mode !== file.mode || staged.gitBlob !== file.gitBlob) {
    fail(`staged ops/live entry differs from the working inventory: ${file.path}`);
  }
}

finalAmendment.effectiveLiveTree = effectiveLiveTree;
finalAmendment.effectiveRootDigestSha256 = effectiveRootDigestSha256;
contract.effectiveLive = {
  tree: effectiveLiveTree,
  rootDigestSha256: effectiveRootDigestSha256,
  fileCount: liveFiles.length,
  files: liveFiles,
};

const regeneratedBytes = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`);
const newContractSha256 = sha256(regeneratedBytes);
const contractChanged = !originalBytes.equals(regeneratedBytes);
const pinPlans = pinPaths.map((path) => {
  const absolute = resolve(repoRoot, path);
  const source = readFileSync(absolute, 'utf8');
  if (newContractSha256 === oldContractSha256) {
    if (source.split(newContractSha256).length - 1 !== 1) {
      fail(`${path} does not contain exactly one current contract pin`);
    }
    return { absolute, source, changed: false };
  }
  if (source.split(oldContractSha256).length - 1 !== 1) {
    fail(`${path} does not contain exactly one prior contract pin`);
  }
  const output = source.replace(oldContractSha256, newContractSha256);
  if (output.split(newContractSha256).length - 1 !== 1) {
    fail(`${path} would not contain exactly one regenerated contract pin`);
  }
  return { absolute, source: output, changed: true };
});

if (contractChanged) writeFileSync(contractPath, regeneratedBytes);
for (const plan of pinPlans) {
  if (plan.changed) writeFileSync(plan.absolute, plan.source);
}

process.stdout.write(`${JSON.stringify({
  stagedInputTree,
  effectiveLiveTree,
  effectiveLiveFiles: liveFiles.length,
  effectiveRootDigestSha256,
  oldContractSha256,
  newContractSha256,
  contractChanged,
  finalChangedFiles: finalAmendment.changedFiles.length,
  changedAfterEntries: changedAfterPaths.length,
  changedAfterPaths,
  refreshedBoundFiles,
  updatedPins: pinPlans.filter(({ changed }) => changed).length,
})}\n`);
