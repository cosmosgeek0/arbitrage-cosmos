#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync, constants, cpSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, relative, resolve, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fail, isFullSha, isUtc, listRegularFiles, parseArgs, readJson,
  sha256File, treeDigest, typedTreeDigest,
} from '../lib.mjs';
import {
  COMPLETE_ACCEPTANCE_STEP_COUNT, validateCompleteAcceptanceReceipt, validateGitSourceFreeze,
} from '../complete-acceptance-receipt.mjs';
import { validateCanonicalAcceptanceEvidence } from '../canonical-acceptance-validation.mjs';
import { readCompiledLedgerCompatibility } from '../ledger-compatibility.mjs';
import { loadL15AmendmentContract, verifyEffectiveL15Root } from '../l15-amendment.mjs';
import { expectedBuildAttestation, verifyBuildAttestation } from './verify-build-attestation.mjs';
import { requireAssemblyOutputDisjoint } from './assembly-output-policy.mjs';
import { loadProtectedOwnerDirectiveBundle } from '../../../test/i00/performance/contract.mjs';

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
const GIT_BOUND_RELEASE_PATHS = Object.freeze([
  'server/package.json',
  'package.json',
  'package-lock.json',
  'ops/live',
  'ops/i00',
  'ops/templates/i00',
  'ops/docs/i00',
  'test/i00/donor-equality.mjs',
  'test/i00/verify-scope.mjs',
  'test/i00/scope-security.mjs',
  'test/i00/performance/contract.mjs',
  'test/i00/performance/local-acceptance.mjs',
  'test/i00/performance/local-proxy-soak.mjs',
  'test/i00/performance/app-probe.mjs',
  'test/i00/performance/schema.v1.json',
  'test/i00/performance/protected-owner-directives.bundle.v1.json',
  'test/i00/performance/browser-receipt.schema.v2.json',
  'test/i00/performance/browser-measurement.schema.v1.json',
  'test/i00/performance/browser-capture.schema.v3.json',
  'test/i00/performance/browser-restart-measurement.schema.v1.json',
]);
const GIT_OPTIONAL_ATTESTED_BUILD_PATHS = Object.freeze([
  'server/dist',
  'web/dist',
]);
const PROTECTED_ASSEMBLY_ROOTS = Object.freeze([
  '/opt/cosmos',
  '/var/lib/cosmos',
  '/var/backups/cosmos',
  '/etc/cosmos',
  '/run/cosmos-app',
  '/run/cosmos-secret-source',
  '/usr/local/lib/cosmos-ops',
  '/var/lib/cosmos-deployment-authorization',
  '/var/lib/cosmos-authorization-consumption',
  '/var/lib/cosmos-action-receipts',
]);

function requireExactRawAbsolutePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096
      || /[\u0000-\u001f\u007f]/u.test(value)
      || !isAbsolute(value) || resolve(value) !== value) {
    fail(`${label} must be one exact raw canonical absolute path`);
  }
  return value;
}

function requireCanonicalExistingPath(path, label, kind) {
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch {
    fail(`${label} is unavailable`);
  }
  if (stat.isSymbolicLink() || realpathSync(path) !== path
      || (kind === 'directory' && !stat.isDirectory())
      || (kind === 'file' && (!stat.isFile() || stat.nlink !== 1n))) {
    fail(`${label} must be one exact canonical ${kind}`);
  }
  return stat;
}

function directoryBinding(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    owner: stat.uid.toString(),
    group: stat.gid.toString(),
  });
}

function sameDirectoryBinding(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function verifyCanonicalDirectoryAncestors(path, label) {
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  let cursor = path;
  for (;;) {
    const stat = requireCanonicalExistingPath(cursor, label, 'directory');
    const mode = stat.mode & 0o7777n;
    if (invokingUid !== null && stat.uid !== 0n && stat.uid !== invokingUid) {
      fail(`${label} ancestor owner is untrusted`);
    }
    if ((mode & 0o022n) !== 0n
        && !(stat.uid === 0n && (mode & 0o1000n) !== 0n)) {
      fail(`${label} ancestor chain is unsafely writable`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function inspectOutputRootPolicy(outputRoot) {
  requireAssemblyOutputDisjoint(outputRoot, PROTECTED_ASSEMBLY_ROOTS);
  const parent = dirname(outputRoot);
  if (parent === outputRoot || basename(outputRoot).length === 0) {
    fail('release assembly output root cannot be a filesystem root');
  }
  verifyCanonicalDirectoryAncestors(parent, 'release assembly output parent');
  const parentStat = requireCanonicalExistingPath(
    parent,
    'release assembly output parent',
    'directory',
  );
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  if (invokingUid !== null && parentStat.uid !== 0n && parentStat.uid !== invokingUid) {
    fail('release assembly output parent owner is untrusted');
  }
  const existing = lstatSync(outputRoot, { bigint: true, throwIfNoEntry: false });
  if (existing !== undefined) {
    requireCanonicalExistingPath(outputRoot, 'release assembly output root', 'directory');
    if ((existing.mode & 0o7777n) !== 0o700n
        || (invokingUid !== null && existing.uid !== invokingUid)) {
      fail('release assembly output root must be owner-private mode 0700');
    }
  }
  return Object.freeze({
    path: outputRoot,
    existed: existing !== undefined,
    parent,
    parentBinding: directoryBinding(parentStat),
    rootBinding: existing === undefined ? null : directoryBinding(existing),
  });
}

function claimOutputRoot(initial) {
  const current = inspectOutputRootPolicy(initial.path);
  if (current.existed !== initial.existed
      || current.parent !== initial.parent
      || !sameDirectoryBinding(current.parentBinding, initial.parentBinding)
      || (initial.rootBinding !== null
        && !sameDirectoryBinding(current.rootBinding, initial.rootBinding))) {
    fail('release assembly output root identity changed before claim');
  }
  if (!current.existed) {
    try {
      mkdirSync(current.path, { mode: 0o700, recursive: false });
    } catch {
      fail('release assembly could not claim its owner-private output root');
    }
  }
  const claimed = inspectOutputRootPolicy(current.path);
  if (!claimed.existed || claimed.rootBinding === null) {
    fail('release assembly output root claim is unavailable');
  }
  let descriptor;
  try {
    descriptor = openSync(
      claimed.path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | constants.O_NOFOLLOW,
    );
  } catch {
    fail('release assembly output root descriptor cannot be retained');
  }
  const opened = fstatSync(descriptor, { bigint: true });
  if (!opened.isDirectory()
      || !sameDirectoryBinding(directoryBinding(opened), claimed.rootBinding)) {
    closeSync(descriptor);
    fail('release assembly output root descriptor identity changed');
  }
  return Object.freeze({
    ...claimed,
    descriptor,
  });
}

function recheckOutputRoot(binding) {
  const current = inspectOutputRootPolicy(binding.path);
  const opened = fstatSync(binding.descriptor, { bigint: true });
  if (!current.existed || current.rootBinding === null
      || !opened.isDirectory()
      || !sameDirectoryBinding(directoryBinding(opened), binding.rootBinding)
      || !sameDirectoryBinding(current.rootBinding, binding.rootBinding)) {
    fail('release assembly output root identity changed around mutation');
  }
}

function inspectPrivateStaging(path, outputBinding) {
  if (dirname(path) !== outputBinding.path) {
    fail('release assembly staging path is not one exact output-root child');
  }
  const stat = requireCanonicalExistingPath(path, 'release assembly staging root', 'directory');
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  if ((stat.mode & 0o7777n) !== 0o700n
      || (invokingUid !== null && stat.uid !== invokingUid)) {
    fail('release assembly staging root must be owner-private mode 0700');
  }
  return Object.freeze({
    path,
    binding: directoryBinding(stat),
  });
}

function recheckPrivateStaging(staging, outputBinding) {
  recheckOutputRoot(outputBinding);
  const current = inspectPrivateStaging(staging.path, outputBinding);
  if (!sameDirectoryBinding(current.binding, staging.binding)) {
    fail('release assembly staging root identity changed around mutation');
  }
}

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

function parseGitTreeEntries(bytes, label) {
  const entries = bytes.toString('utf8').split('\0').filter(Boolean).map((line) => {
    const match = line.match(/^([0-9]{6}) blob ([0-9a-f]{40})\t([A-Za-z0-9._/-]+)$/);
    if (!match || !['100644', '100755'].includes(match[1])
        || match[3].startsWith('/') || match[3].split('/').includes('..')) {
      fail(`${label} contains a non-regular or unsafe Git tree entry`);
    }
    return Object.freeze({
      mode: match[1],
      gitBlob: match[2],
      path: match[3],
    });
  });
  const paths = entries.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length
      || paths.some((path, index) => index > 0 && path <= paths[index - 1])) {
    fail(`${label} is duplicated or not in canonical path order`);
  }
  return Object.freeze(entries);
}

function readBoundGitBlobs(binding, sourceRoot, entries) {
  if (entries.length === 0) return new Map();
  let batch;
  try {
    batch = executeBoundGit(
      binding,
      ['-C', sourceRoot, 'cat-file', '--batch'],
      {
        encoding: null,
        input: `${entries.map((entry) => entry.gitBlob).join('\n')}\n`,
        maxBuffer: 128 * 1024 * 1024,
      },
    );
  } catch (error) {
    fail(`bound Git blob material cannot be read: ${error.message}`);
  }
  const blobs = new Map();
  let offset = 0;
  for (const entry of entries) {
    const lineEnd = batch.indexOf(0x0a, offset);
    if (lineEnd < 0) fail('bound Git blob batch header is truncated');
    const header = batch.subarray(offset, lineEnd).toString('ascii');
    const match = header.match(/^([0-9a-f]{40}) blob ([0-9]+)$/);
    if (!match || match[1] !== entry.gitBlob) {
      fail(`bound Git blob batch identity changed: ${entry.path}`);
    }
    const size = Number(match[2]);
    const start = lineEnd + 1;
    const end = start + size;
    if (!Number.isSafeInteger(size) || size < 0 || end >= batch.length
        || batch[end] !== 0x0a) {
      fail(`bound Git blob batch body is invalid: ${entry.path}`);
    }
    if (blobs.has(entry.gitBlob)) {
      if (!blobs.get(entry.gitBlob).equals(batch.subarray(start, end))) {
        fail(`bound Git blob bytes are inconsistent: ${entry.path}`);
      }
    } else {
      blobs.set(entry.gitBlob, Buffer.from(batch.subarray(start, end)));
    }
    offset = end + 1;
  }
  if (offset !== batch.length) fail('bound Git blob batch has trailing bytes');
  return blobs;
}

function stagedRegularFileIdentity(stat) {
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

function readExactStagedFile(stagingRoot, relativePath) {
  const absolute = resolve(stagingRoot, relativePath);
  if (absolute === stagingRoot || !absolute.startsWith(`${stagingRoot}/`)
      || realpathSync(dirname(absolute)) !== dirname(absolute)) {
    fail(`staged Git-bound path is not exact: ${relativePath}`);
  }
  let namedBefore;
  try {
    namedBefore = lstatSync(absolute, { bigint: true });
  } catch {
    fail(`staged Git-bound file is unavailable: ${relativePath}`);
  }
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    fail(`staged Git-bound path is not one canonical regular file: ${relativePath}`);
  }
  let descriptor;
  let openedIdentity;
  let bytes;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    openedIdentity = stagedRegularFileIdentity(fstatSync(descriptor, { bigint: true }));
    if (!sameExecutableIdentity(stagedRegularFileIdentity(namedBefore), openedIdentity)) {
      fail(`staged Git-bound file changed while opening: ${relativePath}`);
    }
    bytes = readFileSync(descriptor);
    if (!sameExecutableIdentity(
      openedIdentity,
      stagedRegularFileIdentity(fstatSync(descriptor, { bigint: true })),
    )) {
      fail(`staged Git-bound file changed while reading: ${relativePath}`);
    }
  } catch (error) {
    if (String(error?.message ?? '').startsWith('I00_OPS_BLOCKED:')) throw error;
    fail(`staged Git-bound file cannot be read safely: ${relativePath}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (realpathSync(absolute) !== absolute
      || !sameExecutableIdentity(
        openedIdentity,
        stagedRegularFileIdentity(lstatSync(absolute, { bigint: true })),
      )) {
    fail(`staged Git-bound file changed after reading: ${relativePath}`);
  }
  return Object.freeze({
    bytes,
    mode: (namedBefore.mode & 0o111n) === 0n ? '100644' : '100755',
  });
}

function listSelectedStagedFiles(stagingRoot, selections) {
  const files = [];
  for (const selection of selections) {
    const absolute = resolve(stagingRoot, selection);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`staged Git-bound selection is a symlink: ${selection}`);
    if (stat.isFile()) {
      files.push(selection);
      continue;
    }
    if (!stat.isDirectory()) fail(`staged Git-bound selection is unsupported: ${selection}`);
    files.push(...listRegularFiles(absolute).map((path) => `${selection}/${path}`));
  }
  return files.sort();
}

function readSelectedGitEntries(binding, sourceRoot, sourceTree, selections, label) {
  let output;
  try {
    output = executeBoundGit(
      binding,
      ['-C', sourceRoot, 'ls-tree', '-r', '-z', '--full-tree', sourceTree, '--', ...selections],
      { encoding: null, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    fail(`${label} cannot be read from the bound source tree: ${error.message}`);
  }
  return parseGitTreeEntries(output, label);
}

function verifyStagedGitBoundInputs(binding, sourceRoot, sourceTree, stagingRoot) {
  const requiredEntries = readSelectedGitEntries(
    binding,
    sourceRoot,
    sourceTree,
    GIT_BOUND_RELEASE_PATHS,
    'required release source',
  );
  const stagedRequiredPaths = listSelectedStagedFiles(stagingRoot, GIT_BOUND_RELEASE_PATHS);
  if (requiredEntries.length !== stagedRequiredPaths.length
      || requiredEntries.some((entry, index) => entry.path !== stagedRequiredPaths[index])) {
    fail('staged tracked release path set differs from the bound source tree');
  }
  const buildEntries = readSelectedGitEntries(
    binding,
    sourceRoot,
    sourceTree,
    GIT_OPTIONAL_ATTESTED_BUILD_PATHS,
    'tracked attested build output',
  );
  const allEntries = [...requiredEntries, ...buildEntries]
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const blobs = readBoundGitBlobs(binding, sourceRoot, allEntries);
  for (const entry of allEntries) {
    const staged = readExactStagedFile(stagingRoot, entry.path);
    if (staged.mode !== entry.mode || !staged.bytes.equals(blobs.get(entry.gitBlob))) {
      fail(`staged tracked bytes or mode differ from the bound source tree: ${entry.path}`);
    }
  }
}

const args = parseArgs(process.argv.slice(2), new Set(['rollback-barrier', 'simulation-source']));
if (args['schema-version'] !== undefined || args['rollback-floor'] !== undefined || args['rollback-barrier'] === true) {
  fail('release compatibility is derived from the tested compiled Ledger; caller overrides are forbidden');
}
for (const key of ['source-root', 'runtime-deps', 'output-root', 'tested-sha', 'tested-receipt', 'built-at-utc', 'config-revision', 'model-revision']) {
  if (!args[key]) fail(`--${key} is required`);
}
const source = requireExactRawAbsolutePath(args['source-root'], '--source-root');
const runtimeDeps = requireExactRawAbsolutePath(args['runtime-deps'], '--runtime-deps');
const outputRoot = requireExactRawAbsolutePath(args['output-root'], '--output-root');
const testedReceiptPath = requireExactRawAbsolutePath(args['tested-receipt'], '--tested-receipt');
for (const key of [
  'build-attestation',
  'build-attestation-signature',
  'build-attestation-public-key',
]) {
  if (args[key] !== undefined) requireExactRawAbsolutePath(args[key], `--${key}`);
}
requireCanonicalExistingPath(source, '--source-root', 'directory');
requireCanonicalExistingPath(runtimeDeps, '--runtime-deps', 'directory');
requireCanonicalExistingPath(testedReceiptPath, '--tested-receipt', 'file');
const outputPolicy = inspectOutputRootPolicy(outputRoot);
if (!isFullSha(args['tested-sha'])) fail('--tested-sha must be a full lowercase Git SHA');
if (!isUtc(args['built-at-utc'])) fail('--built-at-utc must be exact UTC seconds (YYYY-MM-DDTHH:MM:SSZ)');

const testedReceipt = readJson(testedReceiptPath, 'tested receipt');

const required = [
  'server/dist/index.js',
  'server/dist/ledger.js',
  'web/dist/index.html',
  'server/package.json',
  'package.json',
  'package-lock.json',
  'ops/live/RECEIPT.md',
  'ops/live/bin/deploy.sh',
  'ops/live/bin/rollback.sh',
  'ops/i00/donor-contract.json',
  'ops/i00/l15-amendment-contract.json',
  'ops/i00/l15-amendment.mjs',
  'ops/i00/lib.mjs',
  'ops/i00/bin/install-ops-bundle.sh',
  'ops/i00/bin/publish-install-tree.mjs',
  'ops/i00/bin/verify-donor.mjs',
  'ops/i00/bin/verify-donor-root.mjs',
  'test/i00/donor-equality.mjs',
  'test/i00/verify-scope.mjs',
  'test/i00/scope-security.mjs',
  'test/i00/performance/contract.mjs',
  'test/i00/performance/local-acceptance.mjs',
  'test/i00/performance/local-proxy-soak.mjs',
  'test/i00/performance/app-probe.mjs',
  'test/i00/performance/schema.v1.json',
  'test/i00/performance/protected-owner-directives.bundle.v1.json',
  'test/i00/performance/browser-receipt.schema.v2.json',
  'test/i00/performance/browser-measurement.schema.v1.json',
  'test/i00/performance/browser-capture.schema.v3.json',
  'test/i00/performance/browser-restart-measurement.schema.v1.json',
];
for (const relative of required) {
  if (!existsSync(resolve(source, relative))) fail(`release input missing ${relative}`);
}
loadProtectedOwnerDirectiveBundle(source);
for (const forbidden of ['accepted-ops-live', 'install-receipt.json']) {
  if (existsSync(resolve(source, 'ops/i00', forbidden))) {
    fail(`source ops/i00 contains reserved installed-bundle path ${forbidden}`);
  }
}
const trustedI00Root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trustedI00EnforcementTreeDigestSha256 = typedTreeDigest(trustedI00Root, {
  excludeTopLevel: ['accepted-ops-live', 'install-receipt.json'],
});
const sourceI00EnforcementTreeDigestSha256 = typedTreeDigest(resolve(source, 'ops/i00'));
if (sourceI00EnforcementTreeDigestSha256 !== trustedI00EnforcementTreeDigestSha256) {
  fail('source ops/i00 enforcement cohort differs from the trusted assembler cohort');
}
const sourceL15Contract = loadL15AmendmentContract(
  resolve(source, 'ops/i00/l15-amendment-contract.json'),
  EXPECTED_AMENDMENT_CONTRACT_SHA256,
);
const sourceL15Verification = verifyEffectiveL15Root({
  root: resolve(source, 'ops/live'),
  loadedContract: sourceL15Contract,
});
const l15OpsProvenance = Object.freeze({
  immutableDonorCommit: sourceL15Verification.immutableDonorCommit,
  immutableDonorLiveTree: sourceL15Verification.immutableDonorLiveTree,
  immutableDonorContractSha256: sourceL15Verification.immutableDonorContractSha256,
  amendmentContractSha256: sourceL15Verification.amendmentContractSha256,
  effectiveLiveTree: sourceL15Verification.effectiveLiveTree,
  effectiveRootDigestSha256: sourceL15Verification.effectiveRootDigestSha256,
  i00EnforcementTreeDigestSha256: sourceI00EnforcementTreeDigestSha256,
  findingIds: sourceL15Verification.findingIds,
});
let releaseCompatibility;
try {
  releaseCompatibility = readCompiledLedgerCompatibility(source);
} catch (error) {
  fail(`compiled Ledger compatibility is invalid: ${error.message}`);
}
if (!existsSync(runtimeDeps) || listRegularFiles(runtimeDeps).length === 0) {
  fail('--runtime-deps must be a non-empty, prebuilt dependency directory');
}
const packageLockSha256 = sha256File(resolve(source, 'package-lock.json'));
const runtimeDepsDigestSha256 = treeDigest(runtimeDeps);
const serverDistDigestSha256 = treeDigest(resolve(source, 'server/dist'));
const webDistDigestSha256 = treeDigest(resolve(source, 'web/dist'));

let sourceTree;
let sourceVerification;
let sourceGitExecutable = null;
if (args['simulation-source'] === true) {
  sourceTree = testedReceipt?.source?.treeSha;
  if (!isFullSha(sourceTree)) fail('complete local-acceptance receipt must identify a full candidate tree SHA');
  sourceVerification = 'SIMULATION_ONLY';
} else {
  sourceGitExecutable = resolveFixedGitExecutable();
  try {
    const head = executeBoundGit(
      sourceGitExecutable,
      ['-C', source, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();
    sourceTree = executeBoundGit(
      sourceGitExecutable,
      ['-C', source, 'rev-parse', 'HEAD^{tree}'],
      { encoding: 'utf8' },
    ).trim();
    if (head !== args['tested-sha']) fail('source worktree is not the exact tested SHA/tree');
  } catch (error) {
    fail(`source Git binding failed: ${error.message}`);
  }
  sourceVerification = 'GIT_EXACT_CLEAN';
}

const acceptance = validateCompleteAcceptanceReceipt({
  receiptPath: testedReceiptPath,
  expectedSha: args['tested-sha'],
  expectedTree: sourceTree,
  evidenceRoot: source,
  verifyReferencedArtifacts: true,
  builtAtUtc: args['built-at-utc'],
});
const testedReceiptSha256 = acceptance.receiptSha256;
await validateCanonicalAcceptanceEvidence({
  receipt: acceptance.receipt,
  receiptPath: acceptance.receiptPath,
  browserPath: acceptance.browserPath,
  performancePath: acceptance.performancePath,
  artifactRoot: source,
  expectedSha: args['tested-sha'],
  expectedTree: sourceTree,
});
if (sourceVerification === 'GIT_EXACT_CLEAN') {
  validateGitSourceFreeze({
    sourceRoot: source,
    revision: args['tested-sha'],
    receipt: acceptance.receipt,
    executeGit: (gitArgs, options) => executeBoundGit(sourceGitExecutable, gitArgs, options),
  });
  const allowedUntracked = new Set([
    acceptance.receipt.browserReceipt.relativePath,
    acceptance.receipt.performanceReceipt.relativePath,
    ...acceptance.receipt.browserReceipt.artifacts.map((artifact) => artifact.relativePath),
    ...acceptance.receipt.source.protectedOwnerDirectives.map((entry) => entry.path),
  ]);
  const receiptRelative = relative(source, testedReceiptPath);
  if (receiptRelative !== '..' && !receiptRelative.startsWith(`..${sep}`)) allowedUntracked.add(receiptRelative.split(sep).join('/'));
  let statusRecords;
  try {
    statusRecords = executeBoundGit(
      sourceGitExecutable,
      ['-C', source, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    fail(`source Git status binding failed: ${error.message}`);
  }
  for (const record of statusRecords) {
    const status = record.slice(0, 2);
    const relativePath = record.slice(3);
    if (status !== '??' || !allowedUntracked.has(relativePath)) {
      fail(`source worktree contains unbound state: ${status}:${relativePath}`);
    }
  }
  for (const directive of acceptance.receipt.source.protectedOwnerDirectives) {
    const absolute = resolve(source, directive.path);
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile()
        || sha256File(absolute) !== directive.sha256) {
      fail(`source protected owner directive is missing or hash-mismatched: ${directive.path}`);
    }
  }
}

const attestationArgs = [
  args['build-attestation'], args['build-attestation-signature'], args['build-attestation-public-key'],
];
let buildAttestation;
if (sourceVerification === 'SIMULATION_ONLY') {
  if (attestationArgs.some(Boolean)) fail('simulation assembly must not claim a production build attestation');
  buildAttestation = { status: 'SIMULATION_ONLY_NOT_ATTESTED' };
} else {
  if (attestationArgs.some(Boolean) && !attestationArgs.every(Boolean)) {
    fail('production assembly requires all build attestation, signature, and public-key paths');
  }
  if (!attestationArgs.every(Boolean)) {
    fail('production assembly requires an owner/CI Ed25519 build attestation');
  }
  for (const [path, label] of [
    [args['build-attestation'], 'build attestation'],
    [args['build-attestation-signature'], 'build attestation signature'],
    [args['build-attestation-public-key'], 'build attestation public key'],
  ]) {
    requireCanonicalExistingPath(path, label, 'file');
  }
  const attestation = readJson(args['build-attestation'], 'build attestation');
  const expected = expectedBuildAttestation({
    testedSha: args['tested-sha'],
    sourceTree,
    testedReceiptSha256,
    packageLockSha256,
    runtimeDepsDigestSha256,
    serverDistDigestSha256,
    webDistDigestSha256,
    testsCompletedAtUtc: acceptance.receipt.endedAtUtc,
    buildCompletedAtUtc: args['built-at-utc'],
    builderIdentity: attestation.builderIdentity,
  });
  buildAttestation = verifyBuildAttestation({
    attestationPath: args['build-attestation'],
    signaturePath: args['build-attestation-signature'],
    publicKeyPath: args['build-attestation-public-key'],
    expected,
  });
  buildAttestation = {
    ...buildAttestation,
    attestation: 'receipts/build-attestation.json',
    signature: 'receipts/build-attestation.sig',
    publicKey: 'receipts/build-attestation-public-key.pem',
  };
}

const releaseId = `i00-${args['tested-sha']}`;
const destination = resolve(outputRoot, releaseId);
if (dirname(destination) !== outputRoot || existsSync(destination)) {
  fail(`immutable release already exists or is not an exact output-root child: ${destination}`);
}
const outputBinding = claimOutputRoot(outputPolicy);
const staging = resolve(outputRoot, `.partial-${releaseId}-${process.pid}`);
if (dirname(staging) !== outputRoot || existsSync(staging)) {
  closeSync(outputBinding.descriptor);
  fail('release assembly private staging path is already claimed or is not exact');
}
recheckOutputRoot(outputBinding);
try {
  mkdirSync(staging, { mode: 0o700, recursive: false });
} catch {
  closeSync(outputBinding.descriptor);
  fail('release assembly could not claim its private staging directory');
}
const stagingBinding = inspectPrivateStaging(staging, outputBinding);

try {
  cpSync(resolve(source, 'server/dist'), resolve(staging, 'server/dist'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'web/dist'), resolve(staging, 'web/dist'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'server/package.json'), resolve(staging, 'server/package.json'));
  cpSync(resolve(source, 'package.json'), resolve(staging, 'package.json'));
  cpSync(resolve(source, 'package-lock.json'), resolve(staging, 'package-lock.json'));
  cpSync(resolve(source, 'ops/live'), resolve(staging, 'ops/live'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'ops/i00'), resolve(staging, 'ops/i00'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'ops/templates/i00'), resolve(staging, 'ops/templates/i00'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'ops/docs/i00'), resolve(staging, 'ops/docs/i00'), { recursive: true, errorOnExist: true });
  const stagedL15Contract = loadL15AmendmentContract(
    resolve(staging, 'ops/i00/l15-amendment-contract.json'),
    EXPECTED_AMENDMENT_CONTRACT_SHA256,
  );
  const stagedL15Verification = verifyEffectiveL15Root({
    root: resolve(staging, 'ops/live'),
    loadedContract: stagedL15Contract,
  });
  const stagedI00EnforcementTreeDigestSha256 = typedTreeDigest(resolve(staging, 'ops/i00'));
  if (JSON.stringify(stagedL15Verification.findingIds) !== JSON.stringify(l15OpsProvenance.findingIds)
      || stagedL15Verification.effectiveLiveTree !== l15OpsProvenance.effectiveLiveTree
      || stagedL15Verification.effectiveRootDigestSha256 !== l15OpsProvenance.effectiveRootDigestSha256
      || stagedI00EnforcementTreeDigestSha256 !== l15OpsProvenance.i00EnforcementTreeDigestSha256) {
    throw new Error('copied effective L15 or I00 enforcement root does not match source provenance');
  }
  mkdirSync(resolve(staging, 'test/i00/performance'), { recursive: true });
  for (const relative of ['donor-equality.mjs', 'verify-scope.mjs', 'scope-security.mjs']) {
    cpSync(resolve(source, 'test/i00', relative), resolve(staging, 'test/i00', relative));
  }
  for (const relative of [
    'contract.mjs', 'local-acceptance.mjs', 'local-proxy-soak.mjs', 'app-probe.mjs',
    'schema.v1.json', 'protected-owner-directives.bundle.v1.json', 'browser-receipt.schema.v2.json', 'browser-measurement.schema.v1.json',
    'browser-capture.schema.v3.json', 'browser-restart-measurement.schema.v1.json',
  ]) cpSync(resolve(source, 'test/i00/performance', relative), resolve(staging, 'test/i00/performance', relative));
  if (sourceVerification === 'GIT_EXACT_CLEAN') {
    verifyStagedGitBoundInputs(
      sourceGitExecutable,
      source,
      sourceTree,
      staging,
    );
  }
  loadProtectedOwnerDirectiveBundle(staging);
  for (const artifact of acceptance.receipt.browserReceipt.artifacts) {
    const destinationPath = resolve(staging, artifact.relativePath);
    mkdirSync(resolve(destinationPath, '..'), { recursive: true });
    cpSync(resolve(source, artifact.relativePath), destinationPath);
  }
  cpSync(runtimeDeps, resolve(staging, 'node_modules'), { recursive: true, errorOnExist: true });
  if (treeDigest(resolve(staging, 'server/dist')) !== serverDistDigestSha256
      || treeDigest(resolve(staging, 'web/dist')) !== webDistDigestSha256) {
    throw new Error('copied build-output trees do not match the tested receipt');
  }
  mkdirSync(resolve(staging, 'receipts'), { recursive: true });
  cpSync(testedReceiptPath, resolve(staging, 'receipts/complete-local-acceptance.json'));
  cpSync(acceptance.browserPath, resolve(staging, 'receipts/local-browser-acceptance.json'));
  cpSync(acceptance.performancePath, resolve(staging, 'receipts/local-proxy-performance.json'));
  if (sourceVerification === 'GIT_EXACT_CLEAN') {
    cpSync(resolve(args['build-attestation']), resolve(staging, buildAttestation.attestation));
    cpSync(resolve(args['build-attestation-signature']), resolve(staging, buildAttestation.signature));
    cpSync(resolve(args['build-attestation-public-key']), resolve(staging, buildAttestation.publicKey));
  }

  const release = {
    schemaVersion: releaseCompatibility.schemaVersion,
    rollbackFloor: releaseCompatibility.rollbackFloor,
    rollbackBarrier: releaseCompatibility.rollbackBarrier,
    compatibilitySource: releaseCompatibility.compatibilitySource,
    compatibilitySourceSha256: releaseCompatibility.compatibilitySourceSha256,
    releaseId,
    gitSha: args['tested-sha'],
    testedSha: args['tested-sha'],
    builtAtUtc: args['built-at-utc'],
    configRevision: args['config-revision'],
    modelRevision: args['model-revision'],
    testedReceipt: 'receipts/complete-local-acceptance.json',
    testedReceiptSha256,
    acceptanceEvidence: {
      truthClass: acceptance.receipt.truthClass,
      candidateSha: args['tested-sha'],
      candidateTree: sourceTree,
      requiredStepCount: COMPLETE_ACCEPTANCE_STEP_COUNT,
      browserReceipt: 'receipts/local-browser-acceptance.json',
      browserReceiptSha256: acceptance.browserSha256,
      performanceReceipt: 'receipts/local-proxy-performance.json',
      performanceReceiptSha256: acceptance.performanceSha256,
    },
    runtimeDependencies: 'BUNDLED_PREBUILT',
    runtimeDepsDigestSha256,
    packageLockSha256,
    serverDistDigestSha256,
    webDistDigestSha256,
    sourceTree,
    sourceVerification,
    l15OpsProvenance,
    buildAttestation,
    activationState: 'NOT_DEPLOYED',
  };
  writeFileSync(resolve(staging, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, { mode: 0o600 });

  const files = listRegularFiles(staging).filter((file) => file !== 'artifact-manifest.json');
  const manifest = {
    schemaVersion: 1,
    releaseId,
    testedSha: args['tested-sha'],
    testedBuildOutputs: {
      serverDistDigestSha256,
      webDistDigestSha256,
    },
    acceptanceEvidence: release.acceptanceEvidence,
    l15OpsProvenance,
    ledgerCompatibility: releaseCompatibility,
    buildAttestation,
    files: files.map((file) => ({
      path: file,
      sha256: sha256File(resolve(staging, file)),
      mode: lstatSync(resolve(staging, file)).mode & 0o777,
    })),
  };
  writeFileSync(resolve(staging, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  recheckPrivateStaging(stagingBinding, outputBinding);
  if (existsSync(destination)) {
    throw new Error('immutable release destination appeared before publication');
  }
  renameSync(staging, destination);
  recheckOutputRoot(outputBinding);
} catch (error) {
  try {
    recheckPrivateStaging(stagingBinding, outputBinding);
    rmSync(staging, { recursive: true, force: true });
    recheckOutputRoot(outputBinding);
  } catch {
    closeSync(outputBinding.descriptor);
    fail('release assembly failed and private staging cleanup was refused');
  }
  closeSync(outputBinding.descriptor);
  fail(`release assembly failed: ${error.message}`);
}
closeSync(outputBinding.descriptor);

process.stdout.write(`${JSON.stringify({
  status: 'RELEASE_ASSEMBLED_NOT_DEPLOYED',
  releaseId,
  path: destination,
  gitExecutable: sourceGitExecutable,
})}\n`);
