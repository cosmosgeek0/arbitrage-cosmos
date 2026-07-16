import { lstatSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  fail, listRegularFiles, readJson, requireExactKeys, sha256File, treeDigest,
} from './lib.mjs';

const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_OBJECT_RE = /^[0-9a-f]{40}$/;
const SAFE_PATH_RE = /^[A-Za-z0-9._/-]+$/;
const GIT_MODES = new Set(['100644', '100755']);

const IMMUTABLE_DONOR = Object.freeze({
  contractSha256: '078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3',
  acceptedCommit: '2cec412927fa2f64f05a0b2774b18e45f8ce4fa5',
  acceptedLiveTree: '584163858a0333cb1ccb9eff756e91a851b1cb71',
  acceptedTestsTree: 'f3348a74ef22d9ca2faee431ea8cc5df63f552af',
  acceptedReceipt: Object.freeze({
    path: 'ops/live/RECEIPT.md',
    gitBlob: '7fc3520d4fede577937c6dd48c191b1e5d212061',
    sha256: 'd5159d60419faf11b153557ce830a0d563c723a1b6d74bf7af8fd0517edc7293',
  }),
  acceptedLiveRootDigestSha256: '6c0f6ed75273758a05cc009d0ee2ecab77f0c009c2f783043550706d4a3bc0bf',
  acceptedLiveFileCount: 31,
  acceptedDonorTestFileCount: 17,
  acceptedSuites: 11,
  acceptedAssertions: 347,
});

const FINDING_ORDER = Object.freeze(['R3-D-WATCHDOG-007', 'R3-D-BACKUP-008']);
const FINDING_PATHS = Object.freeze({
  'R3-D-WATCHDOG-007': Object.freeze([
    'ops/live/bin/common.sh',
    'ops/live/bin/watchdog.sh',
  ]),
  'R3-D-BACKUP-008': Object.freeze([
    'ops/live/bin/restore-drill.sh',
    'ops/live/bin/restore.sh',
  ]),
});
const FINDING_TESTS = Object.freeze({
  'R3-D-WATCHDOG-007': 'ops/tests/i00/test-r3-d-watchdog-007.sh',
  'R3-D-BACKUP-008': 'ops/tests/i00/test-r3-d-backup-008.sh',
});

function assertSafePath(value, label, prefix = '') {
  if (typeof value !== 'string' || !SAFE_PATH_RE.test(value) || value.startsWith('/')
      || value.split('/').includes('..') || (prefix && !value.startsWith(prefix))) {
    fail(`${label} is unsafe or outside its closed path family`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) fail(`${label} must be an exact SHA-256`);
}

function assertGitObject(value, label) {
  if (typeof value !== 'string' || !GIT_OBJECT_RE.test(value)) fail(`${label} must be an exact Git object ID`);
}

function assertExactValue(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} does not match immutable L15 provenance`);
}

function validateBoundFile(value, label, pathPrefix) {
  requireExactKeys(value, ['path', 'gitBlob', 'sha256'], label);
  assertSafePath(value.path, `${label}.path`, pathPrefix);
  assertGitObject(value.gitBlob, `${label}.gitBlob`);
  assertSha256(value.sha256, `${label}.sha256`);
}

function validateAmendment(contract, amendment, index, priorTree, priorDigest, seenPaths) {
  const label = `L15 amendment[${index}]`;
  requireExactKeys(amendment, [
    'findingId', 'baseLiveTree', 'effectiveLiveTree', 'baseRootDigestSha256',
    'effectiveRootDigestSha256', 'changedFiles', 'correctionReceipt', 'regressionTests',
  ], label);
  const expectedId = FINDING_ORDER[index];
  if (amendment.findingId !== expectedId) fail(`${label}.findingId is out of the closed correction order`);
  assertGitObject(amendment.baseLiveTree, `${label}.baseLiveTree`);
  assertGitObject(amendment.effectiveLiveTree, `${label}.effectiveLiveTree`);
  assertSha256(amendment.baseRootDigestSha256, `${label}.baseRootDigestSha256`);
  assertSha256(amendment.effectiveRootDigestSha256, `${label}.effectiveRootDigestSha256`);
  if (amendment.baseLiveTree !== priorTree || amendment.baseRootDigestSha256 !== priorDigest) {
    fail(`${label} does not chain from the preceding exact effective root`);
  }
  if (amendment.effectiveLiveTree === amendment.baseLiveTree
      || amendment.effectiveRootDigestSha256 === amendment.baseRootDigestSha256) {
    fail(`${label} does not identify a real bounded correction`);
  }
  if (!Array.isArray(amendment.changedFiles)) fail(`${label}.changedFiles must be an array`);
  const expectedPaths = FINDING_PATHS[expectedId];
  if (amendment.changedFiles.length !== expectedPaths.length) {
    fail(`${label}.changedFiles has the wrong closed path count`);
  }
  amendment.changedFiles.forEach((file, fileIndex) => {
    const fileLabel = `${label}.changedFiles[${fileIndex}]`;
    requireExactKeys(file, [
      'path', 'mode', 'beforeGitBlob', 'beforeSha256', 'afterGitBlob', 'afterSha256',
    ], fileLabel);
    assertSafePath(file.path, `${fileLabel}.path`, 'ops/live/');
    if (file.path !== expectedPaths[fileIndex] || seenPaths.has(file.path)) {
      fail(`${fileLabel}.path is not the exact finding-owned replacement`);
    }
    seenPaths.add(file.path);
    if (!GIT_MODES.has(file.mode)) fail(`${fileLabel}.mode is not a supported regular-file Git mode`);
    assertGitObject(file.beforeGitBlob, `${fileLabel}.beforeGitBlob`);
    assertGitObject(file.afterGitBlob, `${fileLabel}.afterGitBlob`);
    assertSha256(file.beforeSha256, `${fileLabel}.beforeSha256`);
    assertSha256(file.afterSha256, `${fileLabel}.afterSha256`);
    if (file.beforeGitBlob === file.afterGitBlob || file.beforeSha256 === file.afterSha256) {
      fail(`${fileLabel} does not bind distinct before and after bytes`);
    }
  });
  validateBoundFile(amendment.correctionReceipt, `${label}.correctionReceipt`, 'docs/archive/i00-phase4/');
  if (amendment.correctionReceipt.path !== `docs/archive/i00-phase4/${expectedId}_CORRECTION_RECEIPT.md`) {
    fail(`${label}.correctionReceipt.path is not canonical`);
  }
  if (!Array.isArray(amendment.regressionTests) || amendment.regressionTests.length !== 1) {
    fail(`${label}.regressionTests must bind one focused additive test`);
  }
  validateBoundFile(amendment.regressionTests[0], `${label}.regressionTests[0]`, 'ops/tests/i00/');
  if (amendment.regressionTests[0].path !== FINDING_TESTS[expectedId]) {
    fail(`${label}.regressionTests[0].path is not the finding-owned regression`);
  }
}

export function loadL15AmendmentContract(contractPath, expectedSha256) {
  assertSha256(expectedSha256, 'embedded L15 amendment contract hash');
  if (sha256File(contractPath) !== expectedSha256) {
    fail('embedded L15 amendment contract does not match the exact accepted correction contract');
  }
  const contract = readJson(contractPath, 'L15 amendment contract');
  requireExactKeys(contract, [
    'schemaVersion', 'contractId', 'immutableDonor', 'amendments', 'effectiveLive',
  ], 'L15 amendment contract');
  if (contract.schemaVersion !== 1
      || contract.contractId !== 'i00-l15-post-integration-amendments.v1') {
    fail('L15 amendment contract identity is invalid');
  }
  requireExactKeys(contract.immutableDonor, [
    'contractSha256', 'acceptedCommit', 'acceptedLiveTree', 'acceptedTestsTree',
    'acceptedReceipt', 'acceptedLiveRootDigestSha256', 'acceptedLiveFileCount',
    'acceptedDonorTestFileCount', 'acceptedSuites', 'acceptedAssertions',
  ], 'L15 amendment contract.immutableDonor');
  requireExactKeys(contract.immutableDonor.acceptedReceipt, [
    'path', 'gitBlob', 'sha256',
  ], 'L15 amendment contract.immutableDonor.acceptedReceipt');
  assertExactValue(contract.immutableDonor, IMMUTABLE_DONOR, 'L15 immutable donor anchor');
  if (!Array.isArray(contract.amendments) || contract.amendments.length < 1
      || contract.amendments.length > FINDING_ORDER.length) {
    fail('L15 amendment contract must contain a nonempty closed correction prefix');
  }
  const seenPaths = new Set();
  let priorTree = IMMUTABLE_DONOR.acceptedLiveTree;
  let priorDigest = IMMUTABLE_DONOR.acceptedLiveRootDigestSha256;
  contract.amendments.forEach((amendment, index) => {
    validateAmendment(contract, amendment, index, priorTree, priorDigest, seenPaths);
    priorTree = amendment.effectiveLiveTree;
    priorDigest = amendment.effectiveRootDigestSha256;
  });
  requireExactKeys(contract.effectiveLive, [
    'tree', 'rootDigestSha256', 'fileCount', 'files',
  ], 'L15 amendment contract.effectiveLive');
  assertGitObject(contract.effectiveLive.tree, 'L15 amendment contract.effectiveLive.tree');
  assertSha256(contract.effectiveLive.rootDigestSha256, 'L15 amendment contract.effectiveLive.rootDigestSha256');
  if (contract.effectiveLive.tree !== priorTree
      || contract.effectiveLive.rootDigestSha256 !== priorDigest
      || contract.effectiveLive.fileCount !== IMMUTABLE_DONOR.acceptedLiveFileCount
      || !Array.isArray(contract.effectiveLive.files)
      || contract.effectiveLive.files.length !== contract.effectiveLive.fileCount) {
    fail('L15 final effective root does not match the closed amendment chain');
  }
  let priorPath = '';
  const effectiveFiles = new Map();
  contract.effectiveLive.files.forEach((file, index) => {
    const label = `L15 amendment contract.effectiveLive.files[${index}]`;
    requireExactKeys(file, ['path', 'mode', 'gitBlob', 'sha256'], label);
    assertSafePath(file.path, `${label}.path`);
    if (file.path.startsWith('ops/live/') || file.path <= priorPath) {
      fail(`${label}.path is not a unique sorted root-relative path`);
    }
    priorPath = file.path;
    if (!GIT_MODES.has(file.mode)) fail(`${label}.mode is invalid`);
    assertGitObject(file.gitBlob, `${label}.gitBlob`);
    assertSha256(file.sha256, `${label}.sha256`);
    effectiveFiles.set(file.path, file);
  });
  for (const amendment of contract.amendments) {
    for (const changed of amendment.changedFiles) {
      const finalFile = effectiveFiles.get(changed.path.slice('ops/live/'.length));
      if (!finalFile || finalFile.mode !== changed.mode
          || finalFile.gitBlob !== changed.afterGitBlob
          || finalFile.sha256 !== changed.afterSha256) {
        fail(`L15 final effective root does not retain ${changed.path}`);
      }
    }
  }
  return Object.freeze({
    contract,
    amendmentContractSha256: expectedSha256,
    findingIds: Object.freeze(contract.amendments.map((entry) => entry.findingId)),
  });
}

function requireImmutableDirectory(path, label) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o222) !== 0) {
    fail(`executed effective L15 directory is mutable or unsafe: ${label}`);
  }
}

function listDirectories(root, relative = '') {
  const absolute = resolve(root, relative);
  return readdirSync(absolute).sort().flatMap((name) => {
    const next = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(resolve(root, next));
    if (stat.isSymbolicLink()) fail(`symlink is forbidden in effective L15 root: ${next}`);
    if (stat.isDirectory()) return [next, ...listDirectories(root, next)];
    return [];
  });
}

export function verifyEffectiveL15Root({ root, loadedContract, requireImmutable = false }) {
  const absoluteRoot = resolve(root);
  let rootStat;
  try {
    rootStat = lstatSync(absoluteRoot);
  } catch {
    fail('executed effective L15 root does not exist');
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail('executed effective L15 root must be a real directory');
  }
  if (requireImmutable) requireImmutableDirectory(absoluteRoot, '.');
  const expectedFiles = loadedContract.contract.effectiveLive.files;
  const actualPaths = listRegularFiles(absoluteRoot);
  if (actualPaths.length !== expectedFiles.length
      || actualPaths.some((path, index) => path !== expectedFiles[index].path)) {
    fail('executed effective L15 root path inventory does not match the correction contract');
  }
  const expectedDirectories = [...new Set(expectedFiles.flatMap((file) => {
    const parts = file.path.split('/');
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  }))].sort();
  const actualDirectories = listDirectories(absoluteRoot);
  if (actualDirectories.length !== expectedDirectories.length
      || actualDirectories.some((path, index) => path !== expectedDirectories[index])) {
    fail('executed effective L15 directory inventory does not match the correction contract');
  }
  const checkedDirectories = new Set([absoluteRoot]);
  for (const expected of expectedFiles) {
    const absolute = resolve(absoluteRoot, expected.path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || sha256File(absolute) !== expected.sha256) {
      fail(`executed effective L15 file does not match the correction contract: ${expected.path}`);
    }
    const mode = stat.mode & 0o7777;
    const expectedExecutable = expected.mode === '100755';
    if ((mode & 0o7000) !== 0
        || (expectedExecutable ? (mode & 0o111) !== 0o111 : (mode & 0o111) !== 0)) {
      fail(`executed effective L15 file mode is unsafe: ${expected.path}`);
    }
    if (requireImmutable && (mode & 0o222) !== 0) {
      fail(`executed effective L15 file is mutable: ${expected.path}`);
    }
    if (requireImmutable) {
      let directory = dirname(absolute);
      while (directory.startsWith(`${absoluteRoot}/`) && !checkedDirectories.has(directory)) {
        requireImmutableDirectory(directory, directory.slice(absoluteRoot.length + 1));
        checkedDirectories.add(directory);
        directory = dirname(directory);
      }
    }
  }
  const rootDigestSha256 = treeDigest(absoluteRoot);
  if (rootDigestSha256 !== loadedContract.contract.effectiveLive.rootDigestSha256) {
    fail('executed effective L15 root digest does not match the correction contract');
  }
  return Object.freeze({
    root: absoluteRoot,
    immutableDonorCommit: IMMUTABLE_DONOR.acceptedCommit,
    immutableDonorLiveTree: IMMUTABLE_DONOR.acceptedLiveTree,
    immutableDonorContractSha256: IMMUTABLE_DONOR.contractSha256,
    amendmentContractSha256: loadedContract.amendmentContractSha256,
    effectiveLiveTree: loadedContract.contract.effectiveLive.tree,
    effectiveRootDigestSha256: rootDigestSha256,
    effectiveFileCount: actualPaths.length,
    findingIds: loadedContract.findingIds,
    immutable: requireImmutable,
  });
}
