#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fail, parseArgs, readJson, sha256File,
} from '../lib.mjs';
import { loadL15AmendmentContract } from '../l15-amendment.mjs';

const EXPECTED_DONOR_CONTRACT_SHA256 = '078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3';
const EXPECTED_AMENDMENT_CONTRACT_SHA256 = 'ce365e0f739d1144fd90ae0ce93572a500e9e0b4a9b8be129dd52dd72461d2bc';
const GIT_SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin';
const GIT_CANDIDATES = Object.freeze(GIT_SAFE_PATH.split(':').map((directory) => resolve(directory, 'git')));
const XCODE_SELECT_PATH = '/usr/bin/xcode-select';
const GIT_GLOBAL_ARGS = Object.freeze([
  '--no-replace-objects',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'core.hooksPath=/dev/null',
]);
const GIT_ENV = Object.freeze({
  GIT_ATTR_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
  LANG: 'C',
  LC_ALL: 'C',
  PAGER: 'cat',
  PATH: GIT_SAFE_PATH,
  TZ: 'UTC',
});

function executableIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    links: stat.nlink.toString(),
    owner: stat.uid.toString(),
    group: stat.gid.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  });
}

function sameExecutableIdentity(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function verifyExecutableAncestors(path) {
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  let cursor = dirname(path);
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { bigint: true });
    } catch {
      fail('fixed-path Git executable ancestor is unavailable');
    }
    const mode = stat.mode & 0o7777n;
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(cursor) !== cursor) {
      fail('fixed-path Git executable ancestor chain is not canonical');
    }
    if (invokingUid !== null && stat.uid !== invokingUid && stat.uid !== 0n) {
      fail('fixed-path Git executable ancestor has an untrusted owner');
    }
    if ((mode & 0o022n) !== 0n
        && !(stat.uid === 0n && (mode & 0o1000n) !== 0n)) {
      fail('fixed-path Git executable ancestor is unsafely writable');
    }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function inspectCanonicalGitExecutable(path) {
  if (typeof constants.O_NOFOLLOW !== 'number'
      || typeof path !== 'string'
      || path.length === 0
      || resolve(path) !== path) {
    fail('fixed-path Git executable path is invalid');
  }
  let namedBefore;
  try {
    namedBefore = lstatSync(path, { bigint: true });
  } catch {
    fail('fixed-path Git executable is unavailable');
  }
  const mode = namedBefore.mode & 0o7777n;
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || realpathSync(path) !== path
      || (mode & 0o111n) === 0n || (mode & 0o022n) !== 0n || (mode & 0o7000n) !== 0n
      || namedBefore.size <= 0n || namedBefore.size > 512n * 1024n * 1024n
      || (invokingUid !== null && namedBefore.uid !== invokingUid && namedBefore.uid !== 0n)) {
    fail('fixed-path Git executable identity or mode is unsafe');
  }
  verifyExecutableAncestors(path);

  let descriptor;
  let openedIdentity;
  let sha256;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor, { bigint: true });
    openedIdentity = executableIdentity(opened);
    if (!sameExecutableIdentity(executableIdentity(namedBefore), openedIdentity)) {
      fail('fixed-path Git executable changed while opening');
    }
    sha256 = createHash('sha256').update(readFileSync(descriptor)).digest('hex');
    const openedAfter = fstatSync(descriptor, { bigint: true });
    if (!sameExecutableIdentity(openedIdentity, executableIdentity(openedAfter))) {
      fail('fixed-path Git executable changed while hashing');
    }
  } catch (error) {
    if (String(error?.message ?? '').startsWith('I00_OPS_BLOCKED:')) throw error;
    fail('fixed-path Git executable inspection failed');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const namedAfter = lstatSync(path, { bigint: true });
  if (realpathSync(path) !== path
      || !sameExecutableIdentity(openedIdentity, executableIdentity(namedAfter))) {
    fail('fixed-path Git executable changed after hashing');
  }
  return Object.freeze({
    path,
    sha256,
    identity: openedIdentity,
  });
}

function resolveFixedGitExecutable() {
  if (process.platform === 'darwin') {
    const xcodeSelect = inspectCanonicalGitExecutable(XCODE_SELECT_PATH);
    const selectedDeveloperDirectory = readSelectedDeveloperDirectory(xcodeSelect);
    const implementationPath = resolve(selectedDeveloperDirectory, 'usr/bin/git');
    if (implementationPath === '/usr/bin/git') {
      fail('Darwin Git dispatcher cannot be used as the bound implementation');
    }
    const implementation = inspectCanonicalGitExecutable(implementationPath);
    return Object.freeze({
      ...implementation,
      darwinDeveloperSelection: Object.freeze({
        directory: selectedDeveloperDirectory,
        xcodeSelect,
      }),
    });
  }
  const candidate = GIT_CANDIDATES.find((path) => existsSync(path));
  if (candidate === undefined) fail('fixed SAFE_PATH Git executable is unavailable');
  let canonical;
  try {
    canonical = realpathSync(candidate);
  } catch {
    fail('fixed SAFE_PATH Git executable cannot be canonicalized');
  }
  return inspectCanonicalGitExecutable(canonical);
}

function requireSameExecutable(expected) {
  const current = inspectCanonicalGitExecutable(expected.path);
  if (current.sha256 !== expected.sha256
      || !sameExecutableIdentity(current.identity, expected.identity)) {
    fail('fixed-path Git executable identity or digest changed around use');
  }
}

function readSelectedDeveloperDirectory(xcodeSelect) {
  requireSameExecutable(xcodeSelect);
  let output;
  let commandError;
  try {
    output = execFileSync(xcodeSelect.path, ['--print-path'], {
      encoding: 'utf8',
      env: GIT_ENV,
      shell: false,
      windowsHide: true,
    }).trim();
  } catch (error) {
    commandError = error;
  }
  requireSameExecutable(xcodeSelect);
  if (commandError !== undefined) {
    fail('active Darwin developer directory cannot be resolved');
  }
  if (!output || output.includes('\n') || resolve(output) !== output
      || !existsSync(output) || lstatSync(output).isSymbolicLink()
      || !lstatSync(output).isDirectory() || realpathSync(output) !== output) {
    fail('active Darwin developer directory is not one exact canonical directory');
  }
  return output;
}

function requireSameGitExecutable(expected) {
  if (expected.darwinDeveloperSelection !== undefined) {
    const currentDirectory = readSelectedDeveloperDirectory(
      expected.darwinDeveloperSelection.xcodeSelect,
    );
    if (currentDirectory !== expected.darwinDeveloperSelection.directory) {
      fail('active Darwin developer directory changed around Git use');
    }
  }
  requireSameExecutable(expected);
}

function executeBoundGit(binding, gitArgs, options = {}) {
  requireSameGitExecutable(binding);
  let output;
  let commandError;
  try {
    output = execFileSync(binding.path, [...GIT_GLOBAL_ARGS, ...gitArgs], {
      ...options,
      env: GIT_ENV,
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    commandError = error;
  }
  requireSameGitExecutable(binding);
  if (commandError !== undefined) throw commandError;
  return output;
}

function requireExactRawCanonicalPath(value, label, kind) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096
      || /[\u0000-\u001f\u007f]/u.test(value)
      || !isAbsolute(value) || resolve(value) !== value) {
    fail(`${label} must be one exact raw canonical absolute ${kind} path`);
  }
  let stat;
  let physical;
  try {
    stat = lstatSync(value);
    physical = realpathSync(value);
  } catch {
    fail(`${label} is unavailable`);
  }
  if (stat.isSymbolicLink() || physical !== value
      || (kind === 'directory' && !stat.isDirectory())
      || (kind === 'file' && !stat.isFile())) {
    fail(`${label} must be one exact physical canonical non-symlink ${kind}`);
  }
  return value;
}

const args = parseArgs(process.argv.slice(2), new Set(['contract-only', 'integrated']));
const here = dirname(fileURLToPath(import.meta.url));
const contractPath = requireExactRawCanonicalPath(
  args.contract ?? resolve(here, '../donor-contract.json'),
  '--contract',
  'file',
);
const amendmentPath = requireExactRawCanonicalPath(
  args['amendment-contract'] ?? resolve(dirname(contractPath), 'l15-amendment-contract.json'),
  '--amendment-contract',
  'file',
);
const repo = args.repo === undefined
  ? null
  : requireExactRawCanonicalPath(args.repo, '--repo', 'directory');
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

if (repo === null) fail('--repo is required unless --contract-only is used');
const gitExecutable = resolveFixedGitExecutable();

function git(...gitArgs) {
  try {
    return executeBoundGit(
      gitExecutable,
      ['-C', repo, ...gitArgs],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    fail(`Git object verification failed: git ${gitArgs.join(' ')}`);
  }
}

function gitBuffer(...gitArgs) {
  try {
    return executeBoundGit(
      gitExecutable,
      ['-C', repo, ...gitArgs],
      { encoding: null, maxBuffer: 2 * 1024 * 1024 },
    );
  } catch {
    fail(`Git byte verification failed: git ${gitArgs.join(' ')}`);
  }
}

function gitSucceeds(...gitArgs) {
  try {
    executeBoundGit(gitExecutable, ['-C', repo, ...gitArgs], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function regularFileIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    links: stat.nlink.toString(),
    owner: stat.uid.toString(),
    group: stat.gid.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  });
}

function readExactWorkingFile(relative, label) {
  const absolute = resolve(repo, relative);
  if (absolute === repo || !absolute.startsWith(`${repo}/`)
      || realpathSync(dirname(absolute)) !== dirname(absolute)) {
    fail(`${label} working path is not exact or has an aliased ancestor`);
  }
  let namedBefore;
  try {
    namedBefore = lstatSync(absolute, { bigint: true });
  } catch {
    fail(`${label} working file is unavailable`);
  }
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    fail(`${label} working path is not one canonical regular file`);
  }
  let descriptor;
  let bytes;
  let openedIdentity;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor, { bigint: true });
    openedIdentity = regularFileIdentity(opened);
    if (!sameExecutableIdentity(regularFileIdentity(namedBefore), openedIdentity)) {
      fail(`${label} working file changed while opening`);
    }
    bytes = readFileSync(descriptor);
    if (!sameExecutableIdentity(
      openedIdentity,
      regularFileIdentity(fstatSync(descriptor, { bigint: true })),
    )) {
      fail(`${label} working file changed while reading`);
    }
  } catch (error) {
    if (String(error?.message ?? '').startsWith('I00_OPS_BLOCKED:')) throw error;
    fail(`${label} working file cannot be read safely`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (realpathSync(absolute) !== absolute
      || !sameExecutableIdentity(
        openedIdentity,
        regularFileIdentity(lstatSync(absolute, { bigint: true })),
      )) {
    fail(`${label} working file changed after reading`);
  }
  return Object.freeze({
    bytes,
    mode: (namedBefore.mode & 0o111n) === 0n ? '100644' : '100755',
  });
}

function assertWorkingFileMatchesBlob(relative, gitBlob, label, expectedMode = null) {
  const working = readExactWorkingFile(relative, label);
  const committed = gitBuffer('cat-file', 'blob', gitBlob);
  if (!working.bytes.equals(committed)
      || (expectedMode !== null && working.mode !== expectedMode)) {
    fail(`${label} working bytes or mode differ from the exact committed binding`);
  }
}

function listCanonicalWorkingTree(root, relative = '') {
  const files = [];
  const directories = [];
  for (const name of readdirSync(resolve(root, relative)).sort()) {
    const next = relative ? `${relative}/${name}` : name;
    const absolute = resolve(root, next);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || realpathSync(absolute) !== absolute) {
      fail(`integrated effective ops/live has an aliased entry: ${next}`);
    }
    if (stat.isFile()) {
      files.push(next);
      continue;
    }
    if (!stat.isDirectory()) {
      fail(`integrated effective ops/live has an unsupported entry: ${next}`);
    }
    directories.push(next);
    const nested = listCanonicalWorkingTree(root, next);
    files.push(...nested.files);
    directories.push(...nested.directories);
  }
  return Object.freeze({ files, directories });
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

  const expectedTreeEntries = effective.files.map((file) => ({
    ...file,
    path: `ops/live/${file.path}`,
  }));
  const workingLiveTree = listCanonicalWorkingTree(resolve(repo, 'ops/live'));
  const actualWorkingLivePaths = workingLiveTree.files.map((path) => `ops/live/${path}`);
  const expectedWorkingLiveDirectories = [...new Set(
    effective.files.flatMap((file) => {
      const segments = file.path.split('/');
      return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
    }),
  )].sort();
  if (actualWorkingLivePaths.length !== expectedTreeEntries.length
      || actualWorkingLivePaths.some((path, index) => path !== expectedTreeEntries[index].path)
      || workingLiveTree.directories.length !== expectedWorkingLiveDirectories.length
      || workingLiveTree.directories.some(
        (path, index) => path !== expectedWorkingLiveDirectories[index],
      )) {
    fail('integrated effective ops/live working bytes are dirty or untracked');
  }
  for (const expected of expectedTreeEntries) {
    assertWorkingFileMatchesBlob(
      expected.path,
      expected.gitBlob,
      'integrated effective ops/live',
      expected.mode,
    );
  }
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
  const diffLines = git(
    'diff', '--no-ext-diff', '--name-status', '--no-renames',
    contract.acceptedCommit, head, '--', 'ops/live',
  )
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
        'diff', '--no-ext-diff', '--name-status', '--no-renames', amendment.baseLiveTree,
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
      const headEntry = treeEntry(head, bound.path);
      if (headEntry.gitBlob !== bound.gitBlob || headEntry.mode !== bound.mode) {
        fail(`L15 amendment evidence differs from the exact committed binding: ${bound.path}`);
      }
      assertBlobSha256(bound.gitBlob, bound.sha256, bound.path);
      assertWorkingFileMatchesBlob(bound.path, bound.gitBlob, bound.path, bound.mode);
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
    const acceptedEntry = treeEntry(contract.acceptedCommit, path);
    const integratedEntry = treeEntry(head, path);
    const acceptedBlob = acceptedEntry.gitBlob;
    const integratedBlob = integratedEntry.gitBlob;
    const evolution = latestTestAfter.get(path);
    if (evolution !== undefined) {
      if (evolution.beforeGitBlob !== acceptedBlob || integratedBlob !== evolution.afterGitBlob
          || acceptedEntry.mode !== evolution.mode || integratedEntry.mode !== evolution.mode) {
        fail(`integrated donor-owned test bytes differ from their amended binding: ${path}`);
      }
      assertWorkingFileMatchesBlob(path, integratedBlob, path, evolution.mode);
      continue;
    }
    if (acceptedBlob !== integratedBlob || acceptedEntry.mode !== integratedEntry.mode) {
      fail(`integrated donor-owned test bytes differ from accepted Git: ${path}`);
    }
    assertWorkingFileMatchesBlob(path, integratedBlob, path, integratedEntry.mode);
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
  gitExecutable,
  integration,
})}\n`);
