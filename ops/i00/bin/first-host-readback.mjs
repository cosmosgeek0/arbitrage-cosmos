#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync, closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, readdirSync, realpathSync, statfsSync, writeFileSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, join, parse, resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasPlaceholder, typedTreeDigest, verifyArtifactManifest } from '../lib.mjs';
import { validateSimulationRoot } from '../simulation-safety.mjs';

const RECOVERY_TARGET = 'NO_PRIOR_RELEASE_FIRST_HOST';
const EVIDENCE_SOURCE = 'FIRST_HOST_BOOTSTRAP_EVIDENCE';
const SQLITE_SOURCE = 'PINNED_SQLITE_EXECUTABLE_READBACK';
const CLOSED_ENV = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: '/',
  TMPDIR: '/tmp',
  LANG: 'C',
  LC_ALL: 'C',
});
const COMMAND_TIMEOUT_MS = 5_000;
const COMMAND_MAX_BUFFER = 16 * 1024;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const SYSTEM_FIRST_HOST_EVIDENCE_ROOT =
  '/var/lib/cosmos-deployment-authorization/first-host-evidence';
const FIRST_HOST_BUNDLE_NAME = /^first-host-readback\.[A-Za-z0-9]+$/;
const STAGING_PROOF_ROOT = /^\/var\/tmp\/cosmos-df32-proof-([0-9a-f]{4})$/;
const PROTECTED_ROOTS = Object.freeze([
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
const INSPECT_EXECUTABLE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspect-executable.mjs',
);

class Blocked extends Error {}
const block = (message) => { throw new Blocked(message); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function physicalPotentialPath(raw, label) {
  if (typeof raw !== 'string' || raw === '/' || !isAbsolute(raw) || resolve(raw) !== raw) {
    block(`${label} must be one canonical non-root absolute path`);
  }
  let cursor = raw;
  const suffix = [];
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { bigint: true, throwIfNoEntry: false });
    } catch (error) {
      block(`${label} existing ancestor cannot be inspected: ${error.message}`);
    }
    if (stat !== undefined) {
      let physical;
      try {
        physical = realpathSync.native(cursor);
      } catch (error) {
        block(`${label} existing ancestor cannot be physically resolved: ${error.message}`);
      }
      const physicalStat = lstatSync(physical, { bigint: true });
      if (suffix.length > 0 && !physicalStat.isDirectory()) {
        block(`${label} deepest existing ancestor is not one directory`);
      }
      return resolve(physical, ...suffix);
    }
    const parent = dirname(cursor);
    const component = basename(cursor);
    if (parent === cursor || component === '' || component === '.' || component === '..') {
      block(`${label} has an unsafe missing suffix`);
    }
    suffix.unshift(component);
    cursor = parent;
  }
}

function parseCli(argv) {
  const flags = new Set(['sqlite-only', 'simulation-clock']);
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) block(`unexpected argument ${raw}`);
    const key = raw.slice(2);
    if (Object.hasOwn(out, key)) block(`duplicate argument --${key}`);
    if (flags.has(key)) {
      out[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) block(`${raw} requires a value`);
    out[key] = value;
    index += 1;
  }
  return out;
}

function requireOnlyArgs(args, allowed) {
  for (const key of Object.keys(args)) if (!allowed.has(key)) block(`unexpected argument --${key}`);
}

function canonicalUtc(raw, label) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw)) {
    block(`${label} must be canonical UTC seconds`);
  }
  const millis = Date.parse(raw);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== raw.replace('Z', '.000Z')) {
    block(`${label} must be a real canonical UTC instant`);
  }
  return millis;
}

function validateProvenance(args) {
  const mode = args['provenance-mode'];
  if (!['SYSTEM', 'STAGING', 'TEST'].includes(mode)) {
    block('--provenance-mode must be SYSTEM, STAGING, or TEST');
  }
  if (mode === 'SYSTEM') {
    if (args['provenance-root'] !== undefined) {
      block('SYSTEM provenance rejects --provenance-root');
    }
    return { mode, root: null };
  }
  if (typeof args['provenance-root'] !== 'string') {
    block(`${mode} provenance requires --provenance-root`);
  }
  if (mode === 'TEST') {
    try {
      return { mode, root: validateSimulationRoot(args['provenance-root']) };
    } catch {
      block('TEST provenance root must be one canonical marked simulation root');
    }
  }
  const match = STAGING_PROOF_ROOT.exec(args['provenance-root']);
  if (!match) {
    block('STAGING provenance root must match the exact isolated-proof grammar');
  }
  const root = requireRealExisting(
    args['provenance-root'],
    'STAGING provenance root',
    'directory',
  );
  if ((root.stat.mode & 0o7777n) !== 0o700n || root.stat.uid !== 0n) {
    block('STAGING provenance root must be root-owned mode 0700');
  }
  const overlaps = (left, right) => (
    left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
  );
  const protectedPhysicalRoots = PROTECTED_ROOTS.map((protectedRoot) => (
    physicalPotentialPath(protectedRoot, 'protected production root')
  ));
  if (protectedPhysicalRoots.some((protectedRoot) => overlaps(root.path, protectedRoot))) {
    block('STAGING provenance root intersects the protected production root union');
  }
  return { mode, root: root.path, suffix: match[1] };
}

function observationTime(args, provenance) {
  if (args['simulation-clock'] !== true) {
    if (args.now !== undefined) block('--now is accepted only with --simulation-clock');
    if (args['simulation-root'] !== undefined) {
      block('--simulation-root is accepted only with --simulation-clock');
    }
    return new Date(Math.floor(Date.now() / 1000) * 1000)
      .toISOString().replace('.000Z', 'Z');
  }
  if (args.now === undefined || args['simulation-root'] === undefined) {
    block('--simulation-clock requires exact --now and --simulation-root');
  }
  if (provenance.mode !== 'TEST'
      || provenance.root !== args['simulation-root']) {
    block('--simulation-clock requires matching TEST provenance');
  }
  canonicalUtc(args.now, '--now');
  try {
    validateSimulationRoot(args['simulation-root']);
  } catch {
    block('--simulation-root is not one canonical marked simulation root');
  }
  return args.now;
}

function directoryIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
  };
}

function offlineUnitRootIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function validateOutputProvenance(args, provenance) {
  if (!args['evidence-root']) block('--evidence-root is required');
  const expectedEvidenceRoot = provenance.mode === 'SYSTEM'
    ? SYSTEM_FIRST_HOST_EVIDENCE_ROOT
    : join(provenance.root, 'first-host-evidence');
  if (args['evidence-root'] !== expectedEvidenceRoot) {
    block(`${provenance.mode} evidence root is outside the canonical first-host category`);
  }
  const evidenceRoot = requireRealExisting(
    args['evidence-root'],
    '--evidence-root',
    'directory',
  );
  const output = requireRealExisting(args['output-dir'], '--output-dir', 'directory');
  const expectedUid = provenance.mode === 'TEST'
    ? (typeof process.getuid === 'function' ? BigInt(process.getuid()) : output.stat.uid)
    : 0n;
  if ((evidenceRoot.stat.mode & 0o7777n) !== 0o700n
      || evidenceRoot.stat.uid !== expectedUid) {
    block('--evidence-root must have the provenance owner and mode 0700');
  }
  if ((output.stat.mode & 0o7777n) !== 0o700n
      || output.stat.uid !== expectedUid
      || dirname(output.path) !== evidenceRoot.path
      || !FIRST_HOST_BUNDLE_NAME.test(basename(output.path))) {
    block('--output-dir must be one direct provenance-owned mode-0700 first-host bundle');
  }
  if (provenance.mode === 'STAGING'
      && basename(output.path) !== `first-host-readback.${provenance.suffix}`) {
    block('STAGING first-host bundle leaf must match the proof-root suffix');
  }
  if (readdirSync(output.path).length !== 0) block('--output-dir must be empty');
  return { output, identity: directoryIdentity(output.stat) };
}

function verifyPublishedBundle(outputPath, expectedIdentity) {
  const output = requireRealExisting(outputPath, '--output-dir', 'directory');
  if (!sameJson(directoryIdentity(output.stat), expectedIdentity)) {
    block('--output-dir identity changed during publication');
  }
  const expectedFiles = [
    'collected-evidence.json', 'host.json', 'sqlite-readback.json', 'supervisor.json',
  ];
  if (!sameJson(readdirSync(output.path).sort(), expectedFiles)) {
    block('first-host bundle must contain exactly four direct evidence files');
  }
  const expectedUid = output.stat.uid;
  for (const name of expectedFiles) {
    const file = requireRealExisting(join(output.path, name), `bundle ${name}`, 'file');
    if ((file.stat.mode & 0o7777n) !== 0o600n
        || file.stat.uid !== expectedUid
        || file.stat.nlink !== 1n) {
      block('first-host bundle file identity or mode is invalid');
    }
  }
}

function validateSqliteOutput(args, provenance) {
  if (!args.output) return null;
  const output = requireCanonicalPath(args.output, '--output');
  if (basename(output) !== 'sqlite-readback.json') {
    block('--output must use the exact sqlite-readback.json leaf');
  }
  if (provenance.mode === 'SYSTEM') {
    const bundle = dirname(output);
    if (dirname(bundle) !== SYSTEM_FIRST_HOST_EVIDENCE_ROOT
        || !FIRST_HOST_BUNDLE_NAME.test(basename(bundle))) {
      block('SYSTEM --output must be an exact child of one canonical first-host bundle');
    }
    const systemRoot = requireRealExisting(
      SYSTEM_FIRST_HOST_EVIDENCE_ROOT,
      'SYSTEM first-host evidence root',
      'directory',
    );
    const bundleRoot = requireRealExisting(bundle, 'SYSTEM first-host bundle', 'directory');
    if ((systemRoot.stat.mode & 0o7777n) !== 0o700n || systemRoot.stat.uid !== 0n
        || (bundleRoot.stat.mode & 0o7777n) !== 0o700n || bundleRoot.stat.uid !== 0n) {
      block('SYSTEM first-host output roots must be root-owned mode 0700');
    }
  } else if (dirname(output) !== provenance.root) {
    block(`${provenance.mode} --output must be one exact child of the bound provenance root`);
  }
  return output;
}

function requireCanonicalPath(raw, label) {
  if (typeof raw !== 'string' || raw === '/' || !isAbsolute(raw) || resolve(raw) !== raw) {
    block(`${label} must be one non-root canonical absolute path`);
  }
  return raw;
}

function lstatOrEnoent(path, label) {
  try {
    return { status: 'PRESENT', stat: lstatSync(path, { bigint: true }) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'ENOENT' };
    block(`${label} lstat is not provable: ${error?.code ?? error.message}`);
  }
}

// lstat(child) also reports ENOENT when an ancestor is missing or a dangling
// link. Walk every existing parent first so only an unambiguous absent leaf is
// ever admitted.
function assertRealAncestors(path, label) {
  const { root } = parse(path);
  const parts = path.slice(root.length).split('/').filter(Boolean);
  let cursor = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = join(cursor, parts[index]);
    const observed = lstatOrEnoent(cursor, `${label} ancestor ${cursor}`);
    if (observed.status === 'ENOENT') return;
    if (observed.stat.isSymbolicLink()) block(`${label} has a symbolic-link ancestor: ${cursor}`);
    if (!observed.stat.isDirectory()) block(`${label} has a non-directory ancestor: ${cursor}`);
    try { accessSync(cursor, constants.R_OK | constants.X_OK); }
    catch (error) { block(`${label} has an unreadable/untraversable ancestor: ${cursor}: ${error.message}`); }
  }
}

function requireRealExisting(raw, label, kind) {
  const path = requireCanonicalPath(raw, label);
  assertRealAncestors(path, label);
  const observed = lstatOrEnoent(path, label);
  if (observed.status === 'ENOENT') block(`${label} does not exist`);
  if (observed.stat.isSymbolicLink()) block(`${label} must not be a symbolic link`);
  if (kind === 'file' && !observed.stat.isFile()) block(`${label} must be a regular file`);
  if (kind === 'directory' && !observed.stat.isDirectory()) block(`${label} must be a directory`);
  let real;
  try { real = realpathSync.native(path); } catch (error) { block(`${label} realpath failed: ${error.message}`); }
  if (real !== path) block(`${label} is not its canonical real path`);
  return { path, stat: observed.stat };
}

function requireExecutable(raw, label) {
  const result = requireRealExisting(raw, label, 'file');
  if ((result.stat.mode & 0o111n) === 0n) block(`${label} is not executable`);
  if ((result.stat.mode & 0o022n) !== 0n) block(`${label} must not be group/world writable`);
  return result;
}

function executableIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireExactObjectKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    block(`${label} must be one object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    block(`${label} has an unexpected field set`);
  }
}

function runBounded(executable, argv, label) {
  const result = spawnSync(executable, argv, {
    encoding: 'utf8',
    env: CLOSED_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
    windowsHide: true,
  });
  if (result.error) block(`${label} failed: ${result.error.code ?? result.error.message}`);
  if (result.signal) block(`${label} was terminated by ${result.signal}`);
  return result;
}

function inspectExecutable(rawPath, label) {
  const result = runBounded(
    process.execPath,
    [INSPECT_EXECUTABLE, '--path', rawPath],
    `${label} inspection`,
  );
  if (result.status !== 0 || result.stderr !== '') {
    block(`${label} inspection failed`);
  }
  let inspected;
  try {
    inspected = JSON.parse(result.stdout);
  } catch {
    block(`${label} inspection returned invalid JSON`);
  }
  requireExactObjectKeys(
    inspected,
    ['status', 'path', 'sha256', 'identity', 'endpointIdentity'],
    `${label} inspection`,
  );
  requireExactObjectKeys(
    inspected.identity,
    ['device', 'inode', 'mode', 'size', 'mtimeNs', 'ctimeNs'],
    `${label} identity`,
  );
  if (inspected.status !== 'EXECUTABLE_IDENTITY_VERIFIED'
      || !/^[0-9a-f]{64}$/.test(inspected.sha256)) {
    block(`${label} inspection is invalid`);
  }
  return inspected;
}

function sqliteReadback(rawPath, observedAtUtc) {
  const before = requireExecutable(rawPath, '--sqlite');
  const beforeIdentity = executableIdentity(before.stat);
  let beforeBytes;
  try { beforeBytes = readFileSync(before.path); } catch (error) { block(`--sqlite is unreadable: ${error.message}`); }
  const beforeSha = sha256(beforeBytes);
  const result = runBounded(before.path, ['--version'], 'SQLite --version');
  if (result.status !== 0) block(`SQLite --version exited ${String(result.status)}`);
  if (result.stderr !== '') block('SQLite --version wrote unexpected stderr');
  const match = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:[ \t][^\r\n]*)?\n?$/.exec(result.stdout);
  if (!match) block('SQLite --version output is malformed');
  const version = match[1];
  const policy = runBounded(
    process.execPath,
    [resolve(dirname(fileURLToPath(import.meta.url)), 'verify-sqlite-version.mjs'), '--version', version],
    'SQLite version policy',
  );
  if (policy.status !== 0) block(`SQLite version ${version} is outside the accepted policy`);

  const after = requireExecutable(rawPath, '--sqlite');
  const afterIdentity = executableIdentity(after.stat);
  let afterBytes;
  try { afterBytes = readFileSync(after.path); } catch (error) { block(`--sqlite re-read failed: ${error.message}`); }
  const afterSha = sha256(afterBytes);
  if (after.path !== before.path || !sameJson(afterIdentity, beforeIdentity) || afterSha !== beforeSha) {
    block('SQLite executable identity or bytes changed during readback');
  }
  return {
    schemaVersion: 1,
    source: SQLITE_SOURCE,
    observedAtUtc,
    path: before.path,
    sha256: beforeSha,
    version,
    identity: beforeIdentity,
  };
}

function exactCreate(entries) {
  if (!Array.isArray(entries) || entries.length === 0) block('exact-create requires output entries');
  const parentPath = dirname(entries[0][0]);
  if (entries.some(([path]) => requireCanonicalPath(path, 'exact-create output') !== path
      || dirname(path) !== parentPath)) {
    block('exact-create outputs must share one canonical parent');
  }
  const parentBefore = requireRealExisting(
    parentPath,
    'exact-create output parent',
    'directory',
  );
  if ((parentBefore.stat.mode & 0o777n) !== 0o700n) {
    block('exact-create output parent must have mode 0700');
  }
  if (typeof process.getuid === 'function'
      && parentBefore.stat.uid !== BigInt(process.getuid())) {
    block('exact-create output parent owner must be the invoking identity');
  }
  const directoryIdentity = (stat) => ({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
  });
  const fileObjectIdentity = (stat) => ({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    links: stat.nlink.toString(),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
  });
  const parentIdentity = directoryIdentity(parentBefore.stat);
  const recheckParent = () => {
    const current = requireRealExisting(
      parentPath,
      'exact-create output parent',
      'directory',
    );
    if (!sameJson(directoryIdentity(current.stat), parentIdentity)) {
      block('exact-create output parent path identity changed');
    }
  };
  const opened = [];
  let parentDescriptor;
  try {
    parentDescriptor = openSync(
      parentPath,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const openedParent = fstatSync(parentDescriptor, { bigint: true });
    if (!openedParent.isDirectory()
        || !sameJson(directoryIdentity(openedParent), parentIdentity)) {
      block('exact-create output parent descriptor identity changed');
    }
    recheckParent();
    for (const [path] of entries) {
      if (lstatOrEnoent(path, 'exact-create output').status !== 'ENOENT') {
        block('exact-create output must be absent');
      }
    }
    for (const [path] of entries) {
      recheckParent();
      const anchoredPath = process.platform === 'linux'
        ? `/proc/self/fd/${parentDescriptor}/${basename(path)}`
        : path;
      const fd = openSync(
        anchoredPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
          | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      fchmodSync(fd, 0o600);
      const stat = fstatSync(fd, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
          || (stat.mode & 0o777n) !== 0o600n) {
        block('exact-create output claim is not one private single-link regular file');
      }
      if (typeof process.getuid === 'function'
          && stat.uid !== BigInt(process.getuid())) {
        block('exact-create output owner changed');
      }
      opened.push({ path, fd, identity: fileObjectIdentity(stat) });
    }
    for (let index = 0; index < entries.length; index += 1) {
      writeFileSync(opened[index].fd, entries[index][1], 'utf8');
      fsyncSync(opened[index].fd);
      const written = fstatSync(opened[index].fd, { bigint: true });
      if (!sameJson(fileObjectIdentity(written), opened[index].identity)
          || written.size !== BigInt(Buffer.byteLength(entries[index][1], 'utf8'))) {
        block('exact-create output identity changed during write');
      }
    }
    recheckParent();
    for (const item of opened) {
      const named = lstatSync(item.path, { bigint: true, throwIfNoEntry: false });
      const descriptor = fstatSync(item.fd, { bigint: true });
      if (!named?.isFile() || named.isSymbolicLink() || named.nlink !== 1n
          || realpathSync.native(item.path) !== item.path
          || !sameJson(fileObjectIdentity(named), fileObjectIdentity(descriptor))) {
        block('exact-create output final identity is invalid');
      }
    }
    fsyncSync(parentDescriptor);
    recheckParent();
  } catch (error) {
    for (const item of opened) {
      try { closeSync(item.fd); } catch {}
    }
    if (parentDescriptor !== undefined) {
      try { closeSync(parentDescriptor); } catch {}
      parentDescriptor = undefined;
    }
    if (error instanceof Blocked) throw error;
    block(`exact-create output failed: ${error.message}`);
  }
  for (const item of opened) closeSync(item.fd);
  closeSync(parentDescriptor);
}

function parseSanitizedEnv(rawPath) {
  const { path, stat } = requireRealExisting(rawPath, '--env', 'file');
  if ((stat.mode & 0o777n) !== 0o600n) block('--env must have mode 0600');
  let bytes;
  try { bytes = readFileSync(path); } catch (error) { block(`--env is unreadable: ${error.message}`); }
  const text = bytes.toString('utf8');
  if (!text.endsWith('\n')) block('--env is not canonical sanitized output');
  const values = {};
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)='([^']*)'$/.exec(line);
    if (!match) block('--env is not canonical sanitized output');
    if (Object.hasOwn(values, match[1])) block(`--env duplicates ${match[1]}`);
    values[match[1]] = match[2];
  }
  for (const key of [
    'COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'DATA_DIR', 'OPS_STATE_DIR',
    'APP_UNIT', 'FROZEN_MARKER', 'MONEY_READY_MARKER',
  ]) if (!values[key]) block(`--env is missing ${key}`);
  if (values.COSMOS_DEPLOY_VIA_I00_WRAPPER !== '1'
      || values.I00_REQUIRE_FIRST_HOST_NO_CURRENT !== '1') {
    block('--env is not the first-host I00 delegation profile');
  }
  return { path, bytes, sha256: sha256(bytes), values };
}

function validateLayout(values) {
  const paths = {
    cosmosRoot: requireCanonicalPath(values.COSMOS_ROOT, 'COSMOS_ROOT'),
    releasesDir: requireCanonicalPath(values.RELEASES_DIR, 'RELEASES_DIR'),
    currentLink: requireCanonicalPath(values.CURRENT_LINK, 'CURRENT_LINK'),
    previousLink: requireCanonicalPath(values.PREVIOUS_LINK, 'PREVIOUS_LINK'),
    dataDir: requireCanonicalPath(values.DATA_DIR, 'DATA_DIR'),
    opsStateDir: requireCanonicalPath(values.OPS_STATE_DIR, 'OPS_STATE_DIR'),
  };
  if (paths.releasesDir !== `${paths.cosmosRoot}/releases`
      || paths.currentLink !== `${paths.cosmosRoot}/current`
      || paths.previousLink !== `${paths.cosmosRoot}/previous`) {
    block('sanitized release-layout relationships are invalid');
  }
  const overlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  if (overlap(paths.dataDir, paths.opsStateDir)
      || overlap(paths.dataDir, paths.cosmosRoot)
      || overlap(paths.opsStateDir, paths.cosmosRoot)) {
    block('sanitized durable/release paths overlap');
  }
  paths.journalFile = `${paths.dataDir}/journal-compat.json`;
  paths.frozenMarker = requireCanonicalPath(values.FROZEN_MARKER, 'FROZEN_MARKER');
  paths.moneyReadyMarker = requireCanonicalPath(values.MONEY_READY_MARKER, 'MONEY_READY_MARKER');
  if (paths.frozenMarker !== `${paths.opsStateDir}/deploy-frozen.json`
      || paths.moneyReadyMarker !== `${paths.opsStateDir}/money-ready`) {
    block('sanitized marker relationships are invalid');
  }
  for (const [key, path] of Object.entries(paths)) assertRealAncestors(path, key);
  return paths;
}

function requireAbsent(path, label) {
  assertRealAncestors(path, label);
  const observed = lstatOrEnoent(path, label);
  if (observed.status !== 'ENOENT') {
    const kind = observed.stat.isSymbolicLink() ? 'symbolic link'
      : observed.stat.isDirectory() ? 'directory' : observed.stat.isFile() ? 'regular file' : 'special entry';
    block(`${label} must be absent; found ${kind}`);
  }
  return { path, state: 'ABSENT' };
}

function cleanDirectory(path, label) {
  assertRealAncestors(path, label);
  const observed = lstatOrEnoent(path, label);
  if (observed.status === 'ENOENT') return { path, state: 'ABSENT', entryCount: 0 };
  if (observed.stat.isSymbolicLink() || !observed.stat.isDirectory()) {
    block(`${label} must be absent or an empty real directory`);
  }
  let entries;
  try { entries = readdirSync(path); } catch (error) { block(`${label} is unreadable: ${error.message}`); }
  if (entries.length !== 0) block(`${label} contains residual state`);
  return { path, state: 'EMPTY_DIRECTORY', entryCount: 0 };
}

function cleanCosmosRoot(path, releasesDir) {
  assertRealAncestors(path, 'cosmosRoot');
  const observed = lstatOrEnoent(path, 'cosmosRoot');
  if (observed.status === 'ENOENT') return { path, state: 'ABSENT', entryCount: 0 };
  if (observed.stat.isSymbolicLink() || !observed.stat.isDirectory()) {
    block('cosmosRoot must be absent or a clean real directory');
  }
  let entries;
  try { entries = readdirSync(path).sort(); }
  catch (error) { block(`cosmosRoot is unreadable: ${error.message}`); }
  if (entries.length === 0) return { path, state: 'EMPTY_DIRECTORY', entryCount: 0 };
  if (entries.length === 1 && entries[0] === 'releases') {
    const releases = cleanDirectory(releasesDir, 'releasesDir');
    if (releases.state === 'EMPTY_DIRECTORY') {
      return { path, state: 'ONLY_EMPTY_RELEASES_DIRECTORY', entryCount: 1 };
    }
  }
  block('cosmosRoot contains residual state');
}

function liveUnitObservation(systemctlPath, unit) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.service$/.test(unit)) block('APP_UNIT is not canonical');
  const before = inspectExecutable(systemctlPath, '--systemctl');
  const result = runBounded(before.path, ['is-active', unit], 'systemctl is-active');
  if (result.stderr !== '') block('systemctl is-active wrote unexpected stderr');
  let state;
  let exitCode;
  if (result.stdout === 'inactive\n' && result.status === 3) {
    state = 'INACTIVE';
    exitCode = 3;
  } else if (result.stdout === 'unknown\n' && result.status === 4) {
    state = 'NOT_FOUND';
    exitCode = 4;
  } else {
    block(`APP_UNIT is not exactly inactive/not-found (rc=${String(result.status)})`);
  }
  const after = inspectExecutable(systemctlPath, '--systemctl');
  if (!sameJson(after, before)) {
    block('systemctl executable identity or bytes changed during readback');
  }
  return {
    systemctlPath: before.path,
    systemctlSha256: before.sha256,
    systemctlIdentity: before.identity,
    unit,
    state,
    exitCode,
  };
}

function offlineUnitObservation(rawRoot, unit, provenance) {
  if (provenance.mode !== 'STAGING') {
    block('--offline-unit-root is accepted only with STAGING provenance');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.service$/.test(unit)) {
    block('APP_UNIT is not canonical');
  }
  const expectedRoot = join(provenance.root, 'first-host-offline-systemd');
  if (rawRoot !== expectedRoot) {
    block('STAGING offline unit root is outside the exact proof-root category');
  }
  const before = requireRealExisting(rawRoot, '--offline-unit-root', 'directory');
  if ((before.stat.mode & 0o7777n) !== 0o700n || before.stat.uid !== 0n) {
    block('STAGING offline unit root must be root-owned mode 0700');
  }
  if (readdirSync(before.path).length !== 0) {
    block('STAGING offline unit root must be one exact empty typed tree');
  }
  const identity = offlineUnitRootIdentity(before.stat);
  const treeSha256 = typedTreeDigest(before.path);
  const unitPath = join(before.path, unit);
  if (lstatOrEnoent(unitPath, 'STAGING offline application unit').status !== 'ENOENT') {
    block('STAGING offline application unit must be absent');
  }
  const after = requireRealExisting(rawRoot, '--offline-unit-root', 'directory');
  if ((after.stat.mode & 0o7777n) !== 0o700n
      || after.stat.uid !== 0n
      || !sameJson(offlineUnitRootIdentity(after.stat), identity)
      || readdirSync(after.path).length !== 0
      || typedTreeDigest(after.path) !== treeSha256
      || lstatOrEnoent(unitPath, 'STAGING offline application unit').status !== 'ENOENT') {
    block('STAGING offline unit root changed during readback');
  }
  return {
    observationMode: 'PRIVATE_OFFLINE_UNIT_ROOT',
    systemctlPath: null,
    systemctlSha256: null,
    systemctlIdentity: null,
    unit,
    state: 'INACTIVE',
    exitCode: null,
    offlineUnitRoot: before.path,
    offlineUnitRootIdentity: identity,
    offlineUnitTreeSha256: treeSha256,
  };
}

function nearestExistingDirectory(path) {
  let cursor = path;
  while (true) {
    const observed = lstatOrEnoent(cursor, `statfs path ${cursor}`);
    if (observed.status === 'PRESENT') {
      if (observed.stat.isSymbolicLink() || !observed.stat.isDirectory()) {
        block(`nearest statfs ancestor is not a real directory: ${cursor}`);
      }
      const real = realpathSync.native(cursor);
      if (real !== cursor) block(`nearest statfs ancestor is not canonical: ${cursor}`);
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) block('no real ancestor exists for release destination');
    cursor = parent;
  }
}

function diskObservation(targetPath) {
  assertRealAncestors(targetPath, 'release destination');
  const measuredPath = nearestExistingDirectory(targetPath);
  let stat;
  try { stat = statfsSync(measuredPath, { bigint: true }); }
  catch (error) { block(`statfs failed for release destination: ${error.message}`); }
  if (stat.bsize <= 0n || stat.bavail < 0n) block('statfs returned invalid available-space values');
  const free = stat.bsize * stat.bavail;
  if (free < 0n || free > MAX_SAFE_BIGINT) block('statfs freeBytes is not a safe integer');
  return {
    targetPath,
    measuredPath,
    blockSize: stat.bsize.toString(),
    availableBlocks: stat.bavail.toString(),
    freeBytes: Number(free),
  };
}

function canonicalOwnerValue(raw, flag) {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 253
      || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(raw) || hasPlaceholder(raw)) {
    block(`${flag} is not an exact owner value`);
  }
  return raw;
}

function canonicalUint(raw, flag) {
  if (!/^(?:0|[1-9]\d*)$/.test(raw ?? '')) block(`${flag} must be a canonical non-negative safe integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) block(`${flag} must be a canonical non-negative safe integer`);
  return value;
}

function runSqliteOnly(args) {
  requireOnlyArgs(args, new Set([
    'sqlite-only', 'sqlite', 'output', 'provenance-mode', 'provenance-root',
    'simulation-clock', 'simulation-root', 'now',
  ]));
  if (!args.sqlite) block('--sqlite is required with --sqlite-only');
  const provenance = validateProvenance(args);
  const observedAtUtc = observationTime(args, provenance);
  const document = sqliteReadback(args.sqlite, observedAtUtc);
  const bytes = canonicalJson(document);
  if (args.output) {
    const output = validateSqliteOutput(args, provenance);
    const parent = requireRealExisting(dirname(output), '--output parent', 'directory');
    if ((parent.stat.mode & 0o777n) !== 0o700n) block('--output parent must have mode 0700');
    exactCreate([[output, bytes]]);
  } else {
    process.stdout.write(bytes);
  }
}

function runFull(args) {
  requireOnlyArgs(args, new Set([
    'env', 'release', 'output-dir', 'account', 'target-host', 'environment',
    'backup-reserve-bytes', 'sqlite', 'systemctl', 'offline-unit-root',
    'evidence-root', 'provenance-mode', 'provenance-root',
    'simulation-clock', 'simulation-root', 'now',
  ]));
  for (const key of [
    'env', 'release', 'output-dir', 'account', 'target-host', 'environment',
    'backup-reserve-bytes', 'sqlite',
  ]) if (!args[key]) block(`--${key} is required`);

  const provenance = validateProvenance(args);
  if (provenance.mode === 'STAGING') {
    if (!args['offline-unit-root']) block('--offline-unit-root is required for STAGING');
    if (args.systemctl !== undefined) block('STAGING first-host readback rejects --systemctl');
  } else {
    if (!args.systemctl) block('--systemctl is required for SYSTEM and TEST');
    if (args['offline-unit-root'] !== undefined) {
      block('--offline-unit-root is accepted only with STAGING provenance');
    }
  }
  const observedAtUtc = observationTime(args, provenance);
  const observedMs = canonicalUtc(observedAtUtc, 'observation time');
  const validUntilUtc = new Date(observedMs + 600_000).toISOString().replace('.000Z', 'Z');
  const publication = validateOutputProvenance(args, provenance);
  const { output } = publication;

  const env = parseSanitizedEnv(args.env);
  const paths = validateLayout(env.values);
  const owner = {
    account: canonicalOwnerValue(args.account, '--account'),
    targetHost: canonicalOwnerValue(args['target-host'], '--target-host'),
    environment: canonicalOwnerValue(args.environment, '--environment'),
    backupReserveBytes: canonicalUint(args['backup-reserve-bytes'], '--backup-reserve-bytes'),
  };
  if (provenance.mode === 'STAGING') {
    const expectedHost = `cosmos-df32-proof-${provenance.suffix}.internal`;
    const expectedEnvironment = `isolated-staging-${provenance.suffix}`;
    const expectedUnit = `cosmos-df32-proof-${provenance.suffix}.service`;
    if (owner.targetHost !== expectedHost
        || owner.environment !== expectedEnvironment
        || env.values.APP_UNIT !== expectedUnit) {
      block('STAGING host, environment, and application unit must match the proof-root suffix');
    }
    if (env.path !== join(provenance.root, 'sanitized', 'deploy.env')
        || paths.cosmosRoot !== join(provenance.root, 'cosmos')
        || paths.releasesDir !== join(provenance.root, 'cosmos', 'releases')
        || paths.currentLink !== join(provenance.root, 'cosmos', 'current')
        || paths.previousLink !== join(provenance.root, 'cosmos', 'previous')
        || paths.dataDir !== join(provenance.root, 'data')
        || paths.opsStateDir !== join(provenance.root, 'ops-state')) {
      block('STAGING environment paths must use the exact proof-root categories');
    }
  }
  const releasePath = requireRealExisting(args.release, '--release', 'directory').path;
  if (provenance.mode === 'STAGING'
      && !releasePath.startsWith(`${provenance.root}/`)) {
    block('STAGING release must remain below the exact proof root');
  }
  const verified = verifyArtifactManifest(releasePath);
  if (!/^[A-Za-z0-9._-]+$/.test(verified.release.releaseId)
      || !/^[0-9a-f]{40}$/.test(verified.release.testedSha)) block('release identity is invalid');
  paths.releaseDestination = `${paths.releasesDir}/${verified.release.releaseId}`;
  requireCanonicalPath(paths.releaseDestination, 'releaseDestination');
  assertRealAncestors(paths.releaseDestination, 'releaseDestination');

  const sqlite = sqliteReadback(args.sqlite, observedAtUtc);
  const unit = provenance.mode === 'STAGING'
    ? offlineUnitObservation(args['offline-unit-root'], env.values.APP_UNIT, provenance)
    : liveUnitObservation(args.systemctl, env.values.APP_UNIT);
  const links = {
    current: { path: paths.currentLink, lstat: requireAbsent(paths.currentLink, 'current').state === 'ABSENT' ? 'ENOENT' : null },
    previous: { path: paths.previousLink, lstat: requireAbsent(paths.previousLink, 'previous').state === 'ABSENT' ? 'ENOENT' : null },
  };
  const baseline = {
    cosmosRoot: cleanCosmosRoot(paths.cosmosRoot, paths.releasesDir),
    releasesDir: cleanDirectory(paths.releasesDir, 'releasesDir'),
    releaseDestination: requireAbsent(paths.releaseDestination, 'releaseDestination'),
    dataDir: cleanDirectory(paths.dataDir, 'dataDir'),
    opsStateDir: cleanDirectory(paths.opsStateDir, 'opsStateDir'),
    journal: requireAbsent(paths.journalFile, 'journal'),
    frozenMarker: requireAbsent(paths.frozenMarker, 'frozenMarker'),
    moneyReadyMarker: requireAbsent(paths.moneyReadyMarker, 'moneyReadyMarker'),
    unit,
  };
  const disk = diskObservation(paths.releaseDestination);
  // Bind the exact sanitized bytes, not merely the parsed values, and refuse a
  // late replacement before publishing any evidence.
  const envAfter = parseSanitizedEnv(args.env);
  if (envAfter.sha256 !== env.sha256) block('--env changed during readback');

  const derived = {
    cleanBaseline: true,
    deploymentFrozen: false,
    exposureState: 'NONE',
    ambiguityState: 'NONE',
    recoveryState: 'NONE',
    currentSchemaVersion: 0,
    rollbackFloor: 0,
  };
  const evidence = {
    schemaVersion: 1,
    source: EVIDENCE_SOURCE,
    recoveryTarget: RECOVERY_TARGET,
    observedAtUtc,
    validUntilUtc,
    owner,
    sanitizedDonorEnv: { sha256: env.sha256 },
    paths,
    release: {
      path: releasePath,
      releaseId: verified.release.releaseId,
      testedSha: verified.release.testedSha,
      artifactManifestSha256: verified.artifactManifestSha256,
    },
    sqliteReadback: sqlite,
    disk,
    links,
    baseline,
    derived,
  };
  const evidenceBytes = canonicalJson(evidence);
  const host = {
    source: 'TARGET_HOST_OWNER_READBACK',
    account: owner.account,
    targetHost: owner.targetHost,
    environment: owner.environment,
    freeBytes: disk.freeBytes,
    backupReserveBytes: owner.backupReserveBytes,
    sqliteVersion: sqlite.version,
    evidenceSha256: sha256(evidenceBytes),
    observedAtUtc,
  };
  const supervisor = {
    source: 'FIRST_HOST_BOOTSTRAP_READBACK',
    observedAtUtc,
    validUntilUtc,
    deploymentFrozen: derived.deploymentFrozen,
    exposureState: derived.exposureState,
    ambiguityState: derived.ambiguityState,
    recoveryState: derived.recoveryState,
    currentSchemaVersion: derived.currentSchemaVersion,
    rollbackFloor: derived.rollbackFloor,
  };
  exactCreate([
    [join(output.path, 'host.json'), canonicalJson(host)],
    [join(output.path, 'supervisor.json'), canonicalJson(supervisor)],
    [join(output.path, 'collected-evidence.json'), evidenceBytes],
    [join(output.path, 'sqlite-readback.json'), canonicalJson(sqlite)],
  ]);
  verifyPublishedBundle(output.path, publication.identity);
  process.stdout.write(`${JSON.stringify({ status: 'FIRST_HOST_READBACK_CREATED', outputDir: output.path })}\n`);
}

try {
  const args = parseCli(process.argv.slice(2));
  if (args['sqlite-only']) runSqliteOnly(args);
  else runFull(args);
} catch (error) {
  if (error instanceof Blocked) {
    process.stderr.write(`I00_OPS_BLOCKED: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write(`I00_OPS_BLOCKED: first-host readback failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
