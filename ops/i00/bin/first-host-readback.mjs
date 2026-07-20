#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync, closeSync, constants, fchmodSync, fsyncSync, lstatSync, openSync, readFileSync,
  readdirSync, realpathSync, statfsSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasPlaceholder, verifyArtifactManifest } from '../lib.mjs';

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

class Blocked extends Error {}
const block = (message) => { throw new Blocked(message); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function parseCli(argv) {
  const flags = new Set(['sqlite-only']);
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

function observationTime(raw) {
  if (raw !== undefined) {
    canonicalUtc(raw, '--now');
    return raw;
  }
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
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
  const opened = [];
  try {
    for (const [path] of entries) {
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      fchmodSync(fd, 0o600);
      opened.push({ path, fd });
    }
    for (let index = 0; index < entries.length; index += 1) {
      writeFileSync(opened[index].fd, entries[index][1], 'utf8');
      fsyncSync(opened[index].fd);
    }
    for (const item of opened) closeSync(item.fd);
  } catch (error) {
    for (const item of opened) {
      try { closeSync(item.fd); } catch {}
      try { unlinkSync(item.path); } catch {}
    }
    block(`exact-create output failed: ${error.message}`);
  }
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

function unitObservation(systemctlPath, unit) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.service$/.test(unit)) block('APP_UNIT is not canonical');
  const executable = requireExecutable(systemctlPath, '--systemctl').path;
  const result = runBounded(executable, ['is-active', unit], 'systemctl is-active');
  if (result.stderr !== '') block('systemctl is-active wrote unexpected stderr');
  if (result.stdout === 'inactive\n' && result.status === 3) {
    return { systemctlPath: executable, unit, state: 'INACTIVE', exitCode: 3 };
  }
  if (result.stdout === 'unknown\n' && result.status === 4) {
    return { systemctlPath: executable, unit, state: 'NOT_FOUND', exitCode: 4 };
  }
  block(`APP_UNIT is not exactly inactive/not-found (rc=${String(result.status)})`);
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
  requireOnlyArgs(args, new Set(['sqlite-only', 'sqlite', 'output', 'now']));
  if (!args.sqlite) block('--sqlite is required with --sqlite-only');
  const observedAtUtc = observationTime(args.now);
  const document = sqliteReadback(args.sqlite, observedAtUtc);
  const bytes = canonicalJson(document);
  if (args.output) {
    const output = requireCanonicalPath(args.output, '--output');
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
    'backup-reserve-bytes', 'sqlite', 'systemctl', 'now',
  ]));
  for (const key of [
    'env', 'release', 'output-dir', 'account', 'target-host', 'environment',
    'backup-reserve-bytes', 'sqlite', 'systemctl',
  ]) if (!args[key]) block(`--${key} is required`);

  const observedAtUtc = observationTime(args.now);
  const observedMs = canonicalUtc(observedAtUtc, 'observation time');
  const validUntilUtc = new Date(observedMs + 600_000).toISOString().replace('.000Z', 'Z');
  const output = requireRealExisting(args['output-dir'], '--output-dir', 'directory');
  if ((output.stat.mode & 0o777n) !== 0o700n) block('--output-dir must have mode 0700');
  if (readdirSync(output.path).length !== 0) block('--output-dir must be empty');

  const env = parseSanitizedEnv(args.env);
  const paths = validateLayout(env.values);
  const owner = {
    account: canonicalOwnerValue(args.account, '--account'),
    targetHost: canonicalOwnerValue(args['target-host'], '--target-host'),
    environment: canonicalOwnerValue(args.environment, '--environment'),
    backupReserveBytes: canonicalUint(args['backup-reserve-bytes'], '--backup-reserve-bytes'),
  };
  const releasePath = requireRealExisting(args.release, '--release', 'directory').path;
  const verified = verifyArtifactManifest(releasePath);
  if (!/^[A-Za-z0-9._-]+$/.test(verified.release.releaseId)
      || !/^[0-9a-f]{40}$/.test(verified.release.testedSha)) block('release identity is invalid');
  paths.releaseDestination = `${paths.releasesDir}/${verified.release.releaseId}`;
  requireCanonicalPath(paths.releaseDestination, 'releaseDestination');
  assertRealAncestors(paths.releaseDestination, 'releaseDestination');

  const sqlite = sqliteReadback(args.sqlite, observedAtUtc);
  const unit = unitObservation(args.systemctl, env.values.APP_UNIT);
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
