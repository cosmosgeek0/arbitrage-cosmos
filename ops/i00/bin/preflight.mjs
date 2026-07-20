#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  accessSync, constants, lstatSync, readFileSync, readdirSync, realpathSync, statfsSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fail, hasPlaceholder, isUtc, listRegularFiles, parseArgs, readJson, requireExactKeys,
  sha256File, verifyArtifactManifest,
} from '../lib.mjs';

const FIRST_HOST_TARGET = 'NO_PRIOR_RELEASE_FIRST_HOST';
const FIRST_HOST_SUPERVISOR_SOURCE = 'FIRST_HOST_BOOTSTRAP_READBACK';
const FIRST_HOST_EVIDENCE_SOURCE = 'FIRST_HOST_BOOTSTRAP_EVIDENCE';
const SQLITE_SOURCE = 'PINNED_SQLITE_EXECUTABLE_READBACK';
const CLOSED_COMMAND_ENV = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: '/',
  TMPDIR: '/tmp',
  LANG: 'C',
  LC_ALL: 'C',
});
const canonicalJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function requireCanonicalAbsolute(path, label) {
  if (typeof path !== 'string' || path === '/' || !isAbsolute(path) || resolve(path) !== path) {
    fail(`${label} must be a non-root canonical absolute path`);
  }
}

function assertSafeAncestors(path, label) {
  requireCanonicalAbsolute(path, label);
  const parsed = parse(path);
  const parts = path.slice(parsed.root.length).split(sep).filter(Boolean);
  let cursor = parsed.root;
  for (const part of parts.slice(0, -1)) {
    cursor = join(cursor, part);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      fail(`${label} ancestor ${cursor} is unreadable: ${error.message}`);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(`${label} ancestor ${cursor} is not a real directory`);
    }
    try {
      accessSync(cursor, constants.R_OK | constants.X_OK);
    } catch (error) {
      fail(`${label} ancestor ${cursor} is not readable/traversable: ${error.message}`);
    }
  }
}

function lstatAfterSafeAncestors(path, label, options = undefined) {
  assertSafeAncestors(path, label);
  try {
    return lstatSync(path, options);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(`${label} lstat is ambiguous or unreadable: ${error.message}`);
  }
}

function requireLiveAbsent(path, label) {
  if (lstatAfterSafeAncestors(path, label) !== null) fail(`${label} must have lstat=ENOENT`);
  // Repeat the ancestor proof after the leaf observation. This catches a
  // concurrent parent replacement instead of accepting ENOENT through a
  // dangling or otherwise ambiguous ancestor.
  assertSafeAncestors(path, label);
  if (lstatAfterSafeAncestors(path, label) !== null) fail(`${label} changed during preflight`);
  return 'ABSENT';
}

function classifyEmptyDirectory(path, label) {
  const stat = lstatAfterSafeAncestors(path, label);
  if (stat === null) return { state: 'ABSENT', entryCount: 0 };
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} must be absent or a real empty directory`);
  try {
    accessSync(path, constants.R_OK | constants.X_OK);
  } catch (error) {
    fail(`${label} is not readable/traversable: ${error.message}`);
  }
  let entries;
  try {
    entries = readdirSync(path);
  } catch (error) {
    fail(`${label} is unreadable: ${error.message}`);
  }
  if (entries.length !== 0) fail(`${label} must be empty`);
  return { state: 'EMPTY_DIRECTORY', entryCount: 0 };
}

function classifyCosmosRoot(path, releasesDir) {
  const stat = lstatAfterSafeAncestors(path, 'first-host cosmosRoot');
  if (stat === null) return { state: 'ABSENT', entryCount: 0 };
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail('first-host cosmosRoot must be absent or a real clean directory');
  }
  try { accessSync(path, constants.R_OK | constants.X_OK); } catch (error) {
    fail(`first-host cosmosRoot is not readable/traversable: ${error.message}`);
  }
  let entries;
  try { entries = readdirSync(path).sort(); } catch (error) { fail(`first-host cosmosRoot is unreadable: ${error.message}`); }
  if (entries.length === 0) return { state: 'EMPTY_DIRECTORY', entryCount: 0 };
  if (entries.length === 1 && entries[0] === 'releases') {
    const releases = classifyEmptyDirectory(releasesDir, 'first-host releasesDir');
    if (releases.state === 'EMPTY_DIRECTORY') {
      return { state: 'ONLY_EMPTY_RELEASES_DIRECTORY', entryCount: 1 };
    }
  }
  fail('first-host cosmosRoot contains residual state');
}

function requireExactFile(path, mode, label) {
  requireCanonicalAbsolute(path, label);
  const stat = lstatAfterSafeAncestors(path, label);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) fail(`${label} must be a real regular file`);
  if ((stat.mode & 0o777) !== mode) fail(`${label} mode must be ${mode.toString(8)}`);
  let canonical;
  try { canonical = realpathSync(path); } catch (error) { fail(`${label} cannot be canonicalized: ${error.message}`); }
  if (canonical !== path) fail(`${label} must not traverse symlinks`);
  return stat;
}

function readCanonicalJson(path, label) {
  let bytes;
  let value;
  try {
    bytes = readFileSync(path);
    value = JSON.parse(bytes);
  } catch (error) {
    fail(`${label} is unreadable or invalid JSON: ${error.message}`);
  }
  if (!bytes.equals(Buffer.from(canonicalJson(value)))) fail(`${label} is not canonical JSON`);
  return { bytes, value };
}

function parseSanitizedEnv(path) {
  requireExactFile(path, 0o600, 'sanitized donor env');
  const bytes = readFileSync(path);
  if (bytes.length === 0 || bytes.at(-1) !== 0x0a) fail('sanitized donor env must end in one newline');
  const values = {};
  for (const [index, line] of bytes.toString('utf8').split('\n').entries()) {
    if (line === '' && index === bytes.toString('utf8').split('\n').length - 1) continue;
    const match = /^([A-Z][A-Z0-9_]*)='([^']*)'$/.exec(line);
    if (!match) fail(`sanitized donor env line ${index + 1} is not canonical`);
    if (Object.hasOwn(values, match[1])) fail(`sanitized donor env duplicates ${match[1]}`);
    values[match[1]] = match[2];
  }
  return { bytes, values };
}

function sqliteIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function verifyPinnedSqlite(readback, evidenceObservedAtUtc) {
  requireExactKeys(readback, [
    'schemaVersion', 'source', 'observedAtUtc', 'path', 'sha256', 'version', 'identity',
  ], 'first-host evidence.sqliteReadback');
  requireExactKeys(readback.identity, [
    'device', 'inode', 'mode', 'size', 'mtimeNs', 'ctimeNs',
  ], 'first-host evidence.sqliteReadback.identity');
  if (readback.schemaVersion !== 1 || readback.source !== SQLITE_SOURCE
      || readback.observedAtUtc !== evidenceObservedAtUtc
      || !/^[0-9a-f]{64}$/.test(readback.sha256)
      || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(readback.version)) {
    fail('first-host SQLite readback identity/version policy is invalid');
  }
  for (const [key, value] of Object.entries(readback.identity)) {
    const pattern = key === 'mode' ? /^[1-7][0-7]+$/ : /^(?:0|[1-9][0-9]*)$/;
    if (typeof value !== 'string' || !pattern.test(value)) {
      fail(`first-host SQLite identity.${key} is not canonically encoded`);
    }
  }
  requireCanonicalAbsolute(readback.path, 'first-host SQLite path');
  const before = lstatAfterSafeAncestors(readback.path, 'first-host SQLite path', { bigint: true });
  if (!before || before.isSymbolicLink() || !before.isFile()) fail('first-host SQLite path must be a real regular file');
  if ((before.mode & 0o022n) !== 0n) fail('first-host SQLite path must not be group/world writable');
  try { accessSync(readback.path, constants.X_OK); } catch (error) { fail(`first-host SQLite path is not executable: ${error.message}`); }
  let real;
  try { real = realpathSync(readback.path); } catch (error) { fail(`first-host SQLite path cannot be canonicalized: ${error.message}`); }
  if (real !== readback.path || !sameValue(sqliteIdentity(before), readback.identity)
      || sha256File(readback.path) !== readback.sha256) {
    fail('first-host SQLite executable differs from collected evidence');
  }
  const result = spawnSync(readback.path, ['--version'], {
    encoding: 'utf8', env: CLOSED_COMMAND_ENV, timeout: 5_000, maxBuffer: 16 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== '') {
    fail(`first-host SQLite executable readback failed: ${result.error?.code ?? result.signal ?? `exit ${String(result.status)}`}`);
  }
  const match = /^((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))(?:[ \t][^\r\n]*)?\n?$/.exec(result.stdout);
  if (!match || match[1] !== readback.version) fail('first-host SQLite live version differs from collected evidence');
  const policy = spawnSync(process.execPath, [
    resolve(dirname(fileURLToPath(import.meta.url)), 'verify-sqlite-version.mjs'),
    '--version', readback.version,
  ], {
    encoding: 'utf8', env: CLOSED_COMMAND_ENV, timeout: 5_000, maxBuffer: 16 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  if (policy.error || policy.signal || policy.status !== 0) {
    fail(`first-host SQLite version ${readback.version} is outside the accepted policy`);
  }
  const after = lstatAfterSafeAncestors(readback.path, 'first-host SQLite path', { bigint: true });
  if (!after || after.isSymbolicLink() || !after.isFile() || (after.mode & 0o022n) !== 0n
      || !sameValue(sqliteIdentity(after), readback.identity)
      || sha256File(readback.path) !== readback.sha256) {
    fail('first-host SQLite executable changed during preflight');
  }
}

function nearestExistingDirectory(path) {
  let cursor = path;
  while (true) {
    let stat;
    try { stat = lstatSync(cursor); }
    catch (error) {
      if (error?.code !== 'ENOENT') fail(`first-host disk target is unreadable: ${error.message}`);
      stat = null;
    }
    if (stat !== null) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail('first-host disk measurement target is not a real directory');
      try { return realpathSync(cursor); } catch (error) { fail(`first-host disk target cannot be canonicalized: ${error.message}`); }
    }
    const parent = dirname(cursor);
    if (parent === cursor) fail('first-host disk target has no existing containing filesystem');
    cursor = parent;
  }
}

function verifyUnitBaseline(unit) {
  requireExactKeys(unit, ['systemctlPath', 'unit', 'state', 'exitCode'], 'first-host evidence.baseline.unit');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.service$/.test(unit.unit)) {
    fail('first-host APP_UNIT is not canonical');
  }
  requireCanonicalAbsolute(unit.systemctlPath, 'first-host systemctl path');
  const stat = lstatAfterSafeAncestors(unit.systemctlPath, 'first-host systemctl path', { bigint: true });
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111n) === 0n
      || (stat.mode & 0o022n) !== 0n || realpathSync(unit.systemctlPath) !== unit.systemctlPath) {
    fail('first-host systemctl path must be a canonical real non-writable executable');
  }
  const result = spawnSync(unit.systemctlPath, ['is-active', unit.unit], {
    encoding: 'utf8', env: CLOSED_COMMAND_ENV, timeout: 5_000, maxBuffer: 16 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  if (result.error || result.signal) {
    fail('first-host systemctl live readback failed');
  }
  const actual = result.stdout === 'inactive\n' && result.status === 3
    ? { state: 'INACTIVE', exitCode: 3 }
    : result.stdout === 'unknown\n' && result.status === 4
      ? { state: 'NOT_FOUND', exitCode: 4 }
      : null;
  if (!actual || unit.state !== actual.state || unit.exitCode !== actual.exitCode) {
    fail('first-host unit state differs from exact live inactive/not-found readback');
  }
}

function validateFirstHostEvidence({ args, releaseRoot, release, artifactManifestSha256, host, supervisor }) {
  if (args.mode !== 'deploy') fail('first-host bootstrap evidence is deploy-only');
  if (args['recovery-target'] !== FIRST_HOST_TARGET) fail(`first-host recovery target must be ${FIRST_HOST_TARGET}`);
  if (!args['first-host-evidence'] || !args['donor-env']) {
    fail('--first-host-evidence and --donor-env are required for first-host bootstrap');
  }

  const evidencePath = resolve(args['first-host-evidence']);
  if (evidencePath !== args['first-host-evidence'] || evidencePath !== join(dirname(evidencePath), 'collected-evidence.json')) {
    fail('--first-host-evidence must be the canonical collected-evidence.json path');
  }
  const evidenceDir = dirname(evidencePath);
  const evidenceDirStat = lstatAfterSafeAncestors(evidenceDir, 'first-host evidence directory');
  if (!evidenceDirStat || evidenceDirStat.isSymbolicLink() || !evidenceDirStat.isDirectory()
      || (evidenceDirStat.mode & 0o777) !== 0o700 || realpathSync(evidenceDir) !== evidenceDir) {
    fail('first-host evidence directory must be one canonical mode-0700 real directory');
  }
  const expectedBundleNames = ['collected-evidence.json', 'host.json', 'sqlite-readback.json', 'supervisor.json'];
  if (!sameValue(readdirSync(evidenceDir).sort(), expectedBundleNames)) {
    fail('first-host evidence directory has an unexpected field set');
  }
  for (const name of expectedBundleNames) requireExactFile(join(evidenceDir, name), 0o600, `first-host ${name}`);
  const hostPath = join(evidenceDir, 'host.json');
  const supervisorPath = join(evidenceDir, 'supervisor.json');
  if (args.host !== hostPath || args.supervisor !== supervisorPath) {
    fail('first-host host/supervisor JSON must be the producer bundle files');
  }
  const canonicalHost = readCanonicalJson(hostPath, 'first-host host.json');
  const canonicalSupervisor = readCanonicalJson(supervisorPath, 'first-host supervisor.json');
  if (!sameValue(canonicalHost.value, host) || !sameValue(canonicalSupervisor.value, supervisor)) {
    fail('first-host host/supervisor JSON changed during preflight');
  }

  const { bytes: evidenceBytes, value: evidence } = readCanonicalJson(evidencePath, 'first-host collected evidence');
  requireExactKeys(evidence, [
    'schemaVersion', 'source', 'recoveryTarget', 'observedAtUtc', 'validUntilUtc', 'owner',
    'sanitizedDonorEnv', 'paths', 'release', 'sqliteReadback', 'disk', 'links', 'baseline', 'derived',
  ], 'first-host collected evidence');
  requireExactKeys(evidence.owner, ['account', 'targetHost', 'environment', 'backupReserveBytes'], 'first-host evidence.owner');
  requireExactKeys(evidence.sanitizedDonorEnv, ['sha256'], 'first-host evidence.sanitizedDonorEnv');
  requireExactKeys(evidence.paths, [
    'cosmosRoot', 'releasesDir', 'currentLink', 'previousLink', 'dataDir', 'opsStateDir',
    'journalFile', 'frozenMarker', 'moneyReadyMarker', 'releaseDestination',
  ], 'first-host evidence.paths');
  requireExactKeys(evidence.release, ['path', 'releaseId', 'testedSha', 'artifactManifestSha256'], 'first-host evidence.release');
  requireExactKeys(evidence.disk, ['targetPath', 'measuredPath', 'blockSize', 'availableBlocks', 'freeBytes'], 'first-host evidence.disk');
  requireExactKeys(evidence.links, ['current', 'previous'], 'first-host evidence.links');
  for (const key of ['current', 'previous']) requireExactKeys(evidence.links[key], ['path', 'lstat'], `first-host evidence.links.${key}`);
  requireExactKeys(evidence.baseline, [
    'cosmosRoot', 'releasesDir', 'releaseDestination', 'dataDir', 'opsStateDir', 'journal',
    'frozenMarker', 'moneyReadyMarker', 'unit',
  ], 'first-host evidence.baseline');
  for (const key of ['cosmosRoot', 'releasesDir', 'dataDir', 'opsStateDir']) {
    requireExactKeys(evidence.baseline[key], ['path', 'state', 'entryCount'], `first-host evidence.baseline.${key}`);
  }
  for (const key of ['releaseDestination', 'journal', 'frozenMarker', 'moneyReadyMarker']) {
    requireExactKeys(evidence.baseline[key], ['path', 'state'], `first-host evidence.baseline.${key}`);
  }
  requireExactKeys(evidence.baseline.unit, ['systemctlPath', 'unit', 'state', 'exitCode'], 'first-host evidence.baseline.unit');
  requireExactKeys(evidence.derived, [
    'cleanBaseline', 'deploymentFrozen', 'exposureState', 'ambiguityState', 'recoveryState',
    'currentSchemaVersion', 'rollbackFloor',
  ], 'first-host evidence.derived');

  if (evidence.schemaVersion !== 1 || evidence.source !== FIRST_HOST_EVIDENCE_SOURCE
      || evidence.recoveryTarget !== FIRST_HOST_TARGET
      || evidence.observedAtUtc !== host.observedAtUtc
      || evidence.observedAtUtc !== supervisor.observedAtUtc
      || evidence.validUntilUtc !== supervisor.validUntilUtc
      || host.evidenceSha256 !== sha256Bytes(evidenceBytes)) {
    fail('first-host evidence source, chronology, or digest binding is invalid');
  }
  if (!sameValue(evidence.owner, {
    account: host.account,
    targetHost: host.targetHost,
    environment: host.environment,
    backupReserveBytes: host.backupReserveBytes,
  })) fail('first-host owner inputs differ from host readback');
  for (const [key, value] of Object.entries({
    account: evidence.owner.account,
    targetHost: evidence.owner.targetHost,
    environment: evidence.owner.environment,
  })) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 253
        || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value) || hasPlaceholder(value)) {
      fail(`first-host owner.${key} is not an exact owner value`);
    }
  }

  const donorEnvPath = resolve(args['donor-env']);
  if (donorEnvPath !== args['donor-env']) fail('--donor-env must be canonical absolute');
  const donorEnv = parseSanitizedEnv(donorEnvPath);
  if (!/^[0-9a-f]{64}$/.test(evidence.sanitizedDonorEnv.sha256)
      || sha256Bytes(donorEnv.bytes) !== evidence.sanitizedDonorEnv.sha256) {
    fail('first-host sanitized donor env digest is invalid');
  }
  const env = donorEnv.values;
  for (const key of [
    'COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'DATA_DIR', 'OPS_STATE_DIR',
    'APP_UNIT', 'FROZEN_MARKER', 'MONEY_READY_MARKER',
  ]) if (!env[key]) fail(`first-host sanitized donor env is missing ${key}`);
  if (env.I00_REQUIRE_FIRST_HOST_NO_CURRENT !== '1' || env.COSMOS_DEPLOY_VIA_I00_WRAPPER !== '1') {
    fail('first-host sanitized donor env lacks wrapper-owned refusal markers');
  }
  const expectedPaths = {
    cosmosRoot: env.COSMOS_ROOT,
    releasesDir: env.RELEASES_DIR,
    currentLink: env.CURRENT_LINK,
    previousLink: env.PREVIOUS_LINK,
    dataDir: env.DATA_DIR,
    opsStateDir: env.OPS_STATE_DIR,
    journalFile: `${env.DATA_DIR}/journal-compat.json`,
    frozenMarker: env.FROZEN_MARKER,
    moneyReadyMarker: env.MONEY_READY_MARKER,
    releaseDestination: `${env.RELEASES_DIR}/${release.releaseId}`,
  };
  if (!sameValue(evidence.paths, expectedPaths)) fail('first-host evidence paths differ from sanitized donor env');
  for (const [key, path] of Object.entries(expectedPaths)) requireCanonicalAbsolute(path, `first-host path ${key}`);
  if (env.RELEASES_DIR !== `${env.COSMOS_ROOT}/releases`
      || env.CURRENT_LINK !== `${env.COSMOS_ROOT}/current`
      || env.PREVIOUS_LINK !== `${env.COSMOS_ROOT}/previous`
      || env.FROZEN_MARKER !== `${env.OPS_STATE_DIR}/deploy-frozen.json`
      || env.MONEY_READY_MARKER !== `${env.OPS_STATE_DIR}/money-ready`) {
    fail('first-host sanitized donor env release layout is not canonical');
  }
  const overlaps = (left, right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  if (overlaps(env.DATA_DIR, env.OPS_STATE_DIR)
      || overlaps(env.DATA_DIR, env.COSMOS_ROOT)
      || overlaps(env.OPS_STATE_DIR, env.COSMOS_ROOT)
      || overlaps(evidenceDir, env.DATA_DIR)
      || overlaps(evidenceDir, env.OPS_STATE_DIR)
      || overlaps(evidenceDir, env.COSMOS_ROOT)) {
    fail('first-host evidence and state paths are not disjoint');
  }

  if (!sameValue(evidence.release, {
    path: releaseRoot,
    releaseId: release.releaseId,
    testedSha: release.testedSha,
    artifactManifestSha256,
  })) fail('first-host release evidence differs from the verified candidate');

  const sqliteFile = readCanonicalJson(join(evidenceDir, 'sqlite-readback.json'), 'first-host sqlite-readback.json');
  if (!sameValue(sqliteFile.value, evidence.sqliteReadback)) fail('first-host SQLite file differs from collected evidence');
  verifyPinnedSqlite(evidence.sqliteReadback, evidence.observedAtUtc);
  if (host.sqliteVersion !== evidence.sqliteReadback.version) fail('host SQLite version differs from live pinned readback');

  for (const field of ['blockSize', 'availableBlocks']) {
    if (typeof evidence.disk[field] !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(evidence.disk[field])) {
      fail(`first-host evidence.disk.${field} must be a canonical non-negative integer string`);
    }
  }
  if (!Number.isSafeInteger(evidence.disk.freeBytes) || evidence.disk.freeBytes < 0) {
    fail('first-host evidence.disk.freeBytes must be a non-negative safe integer');
  }
  const blockSize = BigInt(evidence.disk.blockSize);
  const availableBlocks = BigInt(evidence.disk.availableBlocks);
  if (blockSize <= 0n
      || blockSize * availableBlocks !== BigInt(evidence.disk.freeBytes)
      || evidence.disk.freeBytes !== host.freeBytes
      || evidence.disk.targetPath !== evidence.paths.releaseDestination
      || evidence.disk.measuredPath !== nearestExistingDirectory(evidence.paths.releaseDestination)) {
    fail('first-host disk evidence does not identify the release-destination filesystem');
  }
  let liveFilesystem;
  try { liveFilesystem = statfsSync(evidence.disk.measuredPath, { bigint: true }); }
  catch (error) { fail(`first-host release-destination statfs failed: ${error.message}`); }
  if (liveFilesystem.bsize <= 0n || liveFilesystem.bavail < 0n
      || liveFilesystem.bsize.toString() !== evidence.disk.blockSize) {
    fail('first-host release-destination filesystem block identity changed');
  }
  const liveFreeBytes = liveFilesystem.bsize * liveFilesystem.bavail;
  if (liveFreeBytes < 0n || liveFreeBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail('first-host live release-destination free bytes are not a safe integer');
  }

  for (const key of ['current', 'previous']) {
    const pathKey = key === 'current' ? 'currentLink' : 'previousLink';
    if (!sameValue(evidence.links[key], { path: evidence.paths[pathKey], lstat: 'ENOENT' })) {
      fail(`first-host evidence.links.${key} must record exact lstat=ENOENT`);
    }
    requireLiveAbsent(evidence.paths[pathKey], `first-host ${key}`);
  }

  const cosmosRootState = classifyCosmosRoot(evidence.paths.cosmosRoot, evidence.paths.releasesDir);
  if (!sameValue(evidence.baseline.cosmosRoot, { path: evidence.paths.cosmosRoot, ...cosmosRootState })) {
    fail('first-host cosmosRoot baseline differs from live state');
  }
  for (const key of ['releasesDir', 'dataDir', 'opsStateDir']) {
    const actual = classifyEmptyDirectory(evidence.paths[key], `first-host ${key}`);
    if (!sameValue(evidence.baseline[key], { path: evidence.paths[key], ...actual })) {
      fail(`first-host ${key} baseline differs from live state`);
    }
  }
  for (const [key, pathKey] of [
    ['releaseDestination', 'releaseDestination'], ['journal', 'journalFile'],
    ['frozenMarker', 'frozenMarker'], ['moneyReadyMarker', 'moneyReadyMarker'],
  ]) {
    if (!sameValue(evidence.baseline[key], { path: evidence.paths[pathKey], state: 'ABSENT' })) {
      fail(`first-host ${key} baseline must record ABSENT`);
    }
    requireLiveAbsent(evidence.paths[pathKey], `first-host ${key}`);
  }
  const unit = evidence.baseline.unit;
  if (unit.unit !== env.APP_UNIT
      || !((unit.state === 'INACTIVE' && unit.exitCode === 3)
        || (unit.state === 'NOT_FOUND' && unit.exitCode === 4))) {
    fail('first-host unit state must be exact inactive or not-found readback');
  }
  verifyUnitBaseline(unit);
  if (!sameValue(evidence.derived, {
    cleanBaseline: true,
    deploymentFrozen: false,
    exposureState: 'NONE',
    ambiguityState: 'NONE',
    recoveryState: 'NONE',
    currentSchemaVersion: 0,
    rollbackFloor: 0,
  })) fail('first-host derived clean-baseline predicates are invalid');
  for (const key of [
    'deploymentFrozen', 'exposureState', 'ambiguityState', 'recoveryState',
    'currentSchemaVersion', 'rollbackFloor',
  ]) if (supervisor[key] !== evidence.derived[key]) fail(`first-host supervisor.${key} differs from collected evidence`);
  if (sha256File(donorEnvPath) !== evidence.sanitizedDonorEnv.sha256) {
    fail('first-host sanitized donor env changed during preflight');
  }
  return Number(liveFreeBytes);
}

for (const singleton of ['--recovery-target', '--first-host-evidence', '--donor-env']) {
  if (process.argv.slice(2).filter((argument) => argument === singleton).length > 1) {
    fail(`duplicate first-host argument ${singleton}`);
  }
}
const args = parseArgs(process.argv.slice(2));
for (const key of ['release', 'host', 'supervisor', 'mode', 'now', 'max-host-age-sec', 'max-supervisor-age-sec', 'required-supervisor-window-sec']) {
  if (!args[key]) fail(`--${key} is required`);
}
if (!['deploy', 'rollback'].includes(args.mode)) fail('--mode must be deploy or rollback');

// The operator-facing gate must never be weaker than the release validator:
// before this call, a tampered payload and a 192-byte stub containing only a
// hand-written release.json both preflighted green while validate-release.mjs
// rejected the identical artifacts. The manifest-verification core (exact
// keys, per-file sha256+mode, tree digests, TOCTOU re-read) is shared from
// lib.mjs — a re-use, not a re-implementation, so the two cannot drift.
const releaseRoot = resolve(args.release);
const { release, artifactManifestSha256 } = verifyArtifactManifest(releaseRoot);
const host = readJson(args.host, 'host preflight');
const supervisor = readJson(args.supervisor, 'supervisor readback');
requireExactKeys(host, ['source', 'account', 'targetHost', 'environment', 'freeBytes', 'backupReserveBytes', 'sqliteVersion', 'evidenceSha256', 'observedAtUtc'], 'host preflight');
requireExactKeys(supervisor, ['source', 'observedAtUtc', 'validUntilUtc', 'deploymentFrozen', 'exposureState', 'ambiguityState', 'recoveryState', 'currentSchemaVersion', 'rollbackFloor'], 'supervisor readback');
const nowMs = Date.parse(args.now);
const hostObservedMs = Date.parse(host.observedAtUtc);
const supervisorObservedMs = Date.parse(supervisor.observedAtUtc);
const validUntilMs = Date.parse(supervisor.validUntilUtc);
const maxHostAgeMs = Number(args['max-host-age-sec']) * 1000;
const maxSupervisorAgeMs = Number(args['max-supervisor-age-sec']) * 1000;
const requiredWindowMs = Number(args['required-supervisor-window-sec']) * 1000;
if (![args.now, host.observedAtUtc, supervisor.observedAtUtc, supervisor.validUntilUtc].every(isUtc)
    || ![nowMs, hostObservedMs, supervisorObservedMs, validUntilMs, maxHostAgeMs, maxSupervisorAgeMs, requiredWindowMs].every(Number.isFinite)
    || maxHostAgeMs <= 0 || maxSupervisorAgeMs <= 0 || requiredWindowMs <= 0) fail('preflight times/windows are invalid');
if (hostObservedMs > nowMs || nowMs - hostObservedMs > maxHostAgeMs) fail('host preflight is stale or future-dated');
if (host.source !== 'TARGET_HOST_OWNER_READBACK' || hasPlaceholder(host.account) || hasPlaceholder(host.targetHost)
    || !/^[0-9a-f]{64}$/.test(host.evidenceSha256)) fail('host preflight is not exact owner readback evidence');

const hasFirstHostArguments = Object.hasOwn(args, 'recovery-target')
  || Object.hasOwn(args, 'first-host-evidence') || Object.hasOwn(args, 'donor-env');
let firstHostLiveFreeBytes = null;
if (supervisor.source === FIRST_HOST_SUPERVISOR_SOURCE) {
  firstHostLiveFreeBytes = validateFirstHostEvidence({
    args, releaseRoot, release, artifactManifestSha256, host, supervisor,
  });
} else {
  if (supervisor.source !== 'CANONICAL_SUPERVISOR_READBACK') fail('supervisor source is not canonical readback');
  if (hasFirstHostArguments) fail('canonical supervisor readback rejects first-host arguments');
}
if (supervisorObservedMs > nowMs || nowMs - supervisorObservedMs > maxSupervisorAgeMs
    || validUntilMs <= supervisorObservedMs || validUntilMs - nowMs < requiredWindowMs) {
  fail('supervisor readback is stale or its lease is too short for the operation');
}

for (const field of ['freeBytes', 'backupReserveBytes']) {
  if (!Number.isSafeInteger(host[field]) || host[field] < 0) fail(`host preflight ${field} must be a non-negative safe integer`);
}
const releaseBytes = listRegularFiles(releaseRoot).reduce((total, file) => total + lstatSync(resolve(releaseRoot, file)).size, 0);
const requiredBytes = releaseBytes * 2 + host.backupReserveBytes;
const effectiveFreeBytes = firstHostLiveFreeBytes === null
  ? host.freeBytes : Math.min(host.freeBytes, firstHostLiveFreeBytes);
if (effectiveFreeBytes < requiredBytes) fail(`insufficient disk: free=${effectiveFreeBytes} required=${requiredBytes}`);
if (supervisor.deploymentFrozen !== false) fail('canonical supervisor reports deployment frozen');
if (supervisor.exposureState !== 'NONE') fail(`deployment freezes on exposureState=${supervisor.exposureState}`);
if (supervisor.ambiguityState !== 'NONE') fail(`deployment freezes on ambiguityState=${supervisor.ambiguityState}`);
if (supervisor.recoveryState !== 'NONE') fail(`deployment freezes on recoveryState=${supervisor.recoveryState}`);
if (!Number.isSafeInteger(supervisor.currentSchemaVersion) || supervisor.currentSchemaVersion < 0
    || !Number.isSafeInteger(supervisor.rollbackFloor) || supervisor.rollbackFloor < 0
    || supervisor.rollbackFloor > supervisor.currentSchemaVersion) {
  fail('canonical schema readback must contain a safe currentSchemaVersion >= rollbackFloor >= 0');
}
if (!Number.isSafeInteger(release.schemaVersion) || release.schemaVersion < 0
    || !Number.isSafeInteger(release.rollbackFloor) || release.rollbackFloor < 0
    || release.rollbackFloor > release.schemaVersion
    || (release.rollbackFloor !== 0 && release.rollbackFloor !== release.schemaVersion)
    || typeof release.rollbackBarrier !== 'boolean'
    || release.rollbackBarrier !== (release.rollbackFloor > 0)) {
  fail('candidate release Ledger compatibility is invalid');
}
if (release.schemaVersion < supervisor.rollbackFloor) {
  fail(`candidate schema ${release.schemaVersion} is below rollback floor ${supervisor.rollbackFloor}`);
}
if (args.mode === 'rollback' && release.schemaVersion > supervisor.currentSchemaVersion) {
  fail('rollback candidate cannot be newer than the current schema');
}

process.stdout.write(`${JSON.stringify({
  status: 'PREFLIGHT_PASS_NO_MUTATION',
  mode: args.mode,
  releaseId: release.releaseId,
  requiredBytes,
  targetHost: host.targetHost,
  account: host.account,
  releaseBytes,
  environment: host.environment,
  supervisorValidUntilUtc: supervisor.validUntilUtc,
  releaseIntegrity: 'MANIFEST_VERIFIED',
  artifactManifestSha256,
  blocker: null,
})}\n`);
