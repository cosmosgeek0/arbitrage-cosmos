#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync,
  readdirSync, realpathSync,
} from 'node:fs';
import {
  dirname, isAbsolute, relative, resolve, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail, parseArgs, requireExactKeys } from '../lib.mjs';
import { validateSimulationRoot } from '../simulation-safety.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const INSPECT_EXECUTABLE = resolve(SCRIPT_DIR, 'inspect-executable.mjs');
const CLOSED_ENV = Object.freeze({
  HOME: '/nonexistent',
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
  SYSTEMD_COLORS: '0',
  SYSTEMD_PAGER: 'cat',
  SYSTEMD_PAGERSECURE: '1',
  TZ: 'UTC',
});
const DIGEST = /^[0-9a-f]{64}$/u;
const IDENTITY_KEYS = Object.freeze([
  'device', 'inode', 'mode', 'links', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs',
]);
const ENDPOINT_IDENTITY_KEYS = Object.freeze([
  'device', 'inode', 'mode', 'size', 'mtimeNs', 'ctimeNs',
]);
const SHOW_PROPERTIES = Object.freeze([
  'Id',
  'Names',
  'Following',
  'LoadState',
  'FragmentPath',
  'DropInPaths',
  'NeedDaemonReload',
  'Requires',
  'Wants',
  'Requisite',
  'BindsTo',
  'PartOf',
  'After',
  'Before',
  'Conflicts',
  'OnFailure',
  'OnSuccess',
  'OnSuccessJobMode',
  'OnFailureJobMode',
  'PropagatesStopTo',
  'StopPropagatedFrom',
  'PropagatesReloadTo',
  'ReloadPropagatedFrom',
  'Upholds',
  'JoinsNamespaceOf',
  'RequiresMountsFor',
  'WantsMountsFor',
  'DefaultDependencies',
  'SuccessAction',
  'FailureAction',
  'JobTimeoutAction',
  'StartLimitAction',
  'User',
  'Group',
  'WorkingDirectory',
  'Environment',
  'EnvironmentFiles',
  'PassEnvironment',
  'UnsetEnvironment',
  'SetCredential',
  'SetCredentialEncrypted',
  'LoadCredential',
  'LoadCredentialEncrypted',
  'ImportCredential',
  'SupplementaryGroups',
  'DynamicUser',
  'PAMName',
  'CapabilityBoundingSet',
  'AmbientCapabilities',
  'NoNewPrivileges',
  'RootDirectory',
  'RootImage',
  'MountImages',
  'ExtensionImages',
  'ExtensionDirectories',
  'ExecSearchPath',
  'BindPaths',
  'BindReadOnlyPaths',
  'TemporaryFileSystem',
  'ReadWritePaths',
  'ReadOnlyPaths',
  'InaccessiblePaths',
  'ExecPaths',
  'NoExecPaths',
  'RuntimeDirectory',
  'RuntimeDirectoryMode',
  'RuntimeDirectoryPreserve',
  'StateDirectory',
  'StateDirectoryMode',
  'CacheDirectory',
  'CacheDirectoryMode',
  'LogsDirectory',
  'LogsDirectoryMode',
  'ConfigurationDirectory',
  'ConfigurationDirectoryMode',
  'RootDirectoryStartOnly',
  'Type',
  'StandardInput',
  'StandardOutput',
  'StandardError',
  'Sockets',
  'BusName',
  'PIDFile',
  'NotifyAccess',
  'FileDescriptorStoreMax',
  'FileDescriptorStorePreserve',
  'ExecCondition',
  'ExecStartPre',
  'ExecStart',
  'ExecStartEx',
  'ExecStartPost',
  'ExecReload',
  'ExecStop',
  'ExecStopPost',
]);
const EXPECTED_LEASE = 'DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases';
const EXPECTED_ENTRYPOINT = 'server/dist/index.js';
const EXPECTED_USER = 'cosmos';
const EXPECTED_GROUP = 'cosmos';
const EXPECTED_WORKING_DIRECTORY = '/opt/cosmos/current';
const PRODUCTION_UNIT = 'cosmos-app.service';
const PRODUCTION_FRAGMENT = '/etc/systemd/system/cosmos-app.service';
const PRODUCTION_RUNTIME_ENV = '/etc/cosmos/cosmos-app.env';
const EXPECTED_UNSET_ENVIRONMENT = Object.freeze([
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_EXTRA_CA_CERTS',
  'NODE_V8_COVERAGE',
  'NODE_ICU_DATA',
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'NODE_REDIRECT_WARNINGS',
  'NODE_COMPILE_CACHE',
  'NODE_DISABLE_COMPILE_CACHE',
  'NODE_PRESERVE_SYMLINKS',
  'NODE_PRESERVE_SYMLINKS_MAIN',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'LD_PROFILE',
  'LD_ORIGIN_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'OPENSSL_CONF',
  'OPENSSL_MODULES',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_USE_ENV_PROXY',
  'NODE_USE_SYSTEM_CA',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const args = parseArgs(process.argv.slice(2));
const allowedArguments = new Set([
  'systemctl', 'unit', 'node', 'env', 'runtime-env',
  'provenance-mode', 'systemd-analyze', 'offline-unit-root',
  'expected-fragment-path', 'expected-fragment-source', 'staging-root',
  'proof-drop-in', 'proof-drop-in-runtime-link', 'proof-absent-sentinel',
  'expected-binding-sha256',
]);
for (const name of Object.keys(args)) {
  if (!allowedArguments.has(name)) fail(`unsupported argument --${name}`);
}
for (const name of [
  'systemctl', 'unit', 'node', 'env', 'runtime-env', 'expected-fragment-path',
  'expected-fragment-source', 'provenance-mode',
]) {
  if (!args[name]) fail(`--${name} is required`);
}
if (args['expected-binding-sha256'] !== undefined
    && !DIGEST.test(args['expected-binding-sha256'])) {
  fail('--expected-binding-sha256 must be lowercase SHA-256');
}
if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,254}\.service$/u.test(args.unit)
    || args.unit !== args.unit.trim()) {
  fail('--unit must be one exact service unit name');
}
if (!['SYSTEM', 'STAGING', 'TEST'].includes(args['provenance-mode'])) {
  fail('--provenance-mode must be SYSTEM, STAGING, or TEST');
}

function exactAbsolute(raw, label) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4_096
      || !isAbsolute(raw) || resolve(raw) !== raw
      || /[\u0000-\u001f\u007f]/u.test(raw)) {
    fail(`${label} must be one exact canonical absolute path`);
  }
  let canonical;
  try {
    canonical = realpathSync(raw);
  } catch (error) {
    fail(`${label} cannot be canonicalized: ${error.message}`);
  }
  if (canonical !== raw) fail(`${label} or one of its ancestors is not canonical`);
  return raw;
}

function exactLexicalAbsolute(raw, label) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4_096
      || !isAbsolute(raw) || resolve(raw) !== raw
      || /[\u0000-\u001f\u007f]/u.test(raw)) {
    fail(`${label} must be one exact canonical absolute path`);
  }
  return raw;
}

function exactDirectory(raw, label) {
  const path = exactAbsolute(raw, label);
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  const mode = stat.mode & 0o7777n;
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  if (!stat.isDirectory() || stat.isSymbolicLink() || mode !== 0o700n
      || (invokingUid !== null && stat.uid !== invokingUid && stat.uid !== 0n)) {
    fail(`${label} must be one canonical owner-controlled mode-0700 directory`);
  }
  return path;
}

function isWithin(root, path) {
  const suffix = relative(root, path);
  return suffix.length > 0
    && suffix !== '..'
    && !suffix.startsWith(`..${sep}`)
    && !isAbsolute(suffix);
}

let stagingRoot = null;
let proofDropIn = null;
let proofDropInRuntimeLink = null;
let proofAbsentSentinel = null;
let offlineUnitRoot = null;
let strictProofOwnership = false;
if (args['staging-root'] !== undefined) {
  if (args['provenance-mode'] === 'SYSTEM') {
    fail('SYSTEM app-unit inspection forbids --staging-root');
  }
  stagingRoot = exactDirectory(args['staging-root'], '--staging-root');
  strictProofOwnership = args['provenance-mode'] === 'STAGING';
  if (args['provenance-mode'] === 'TEST') {
    try {
      if (validateSimulationRoot(stagingRoot) !== stagingRoot) {
        fail('TEST app-unit root differs from the marked simulation root');
      }
    } catch {
      fail('TEST app-unit inspection requires one exact marked simulation root');
    }
  }
  if (strictProofOwnership) {
    const suffix = /^\/var\/tmp\/cosmos-df32-proof-([0-9a-f]{4})$/u.exec(stagingRoot);
    const rootStat = lstatSync(stagingRoot, { bigint: true });
    if (suffix === null || rootStat.uid !== 0n) {
      fail('STAGING root must be one exact root-owned /var/tmp proof root');
    }
    const protectedRoots = Object.freeze([
      '/etc/cosmos',
      '/etc/systemd/system',
      '/opt/cosmos',
      '/run/systemd/system',
      '/usr/local/lib/cosmos-ops',
      '/var/backups/cosmos',
      '/var/lib/cosmos',
    ]);
    if (protectedRoots.some((protectedRoot) => (
      stagingRoot === protectedRoot
      || stagingRoot.startsWith(`${protectedRoot}/`)
      || protectedRoot.startsWith(`${stagingRoot}/`)
    ))) {
      fail('STAGING root must be disjoint from every protected production root');
    }
    const unitStem = `cosmos-df32-proof-${suffix[1]}`;
    const expectedUnit = `${unitStem}.service`;
    const expectedSystemctl = resolve(stagingRoot, 'tools', 'systemctl');
    if (args['offline-unit-root'] === undefined
        || args['systemd-analyze'] === undefined) {
      fail('STAGING app-unit inspection requires the private unit root and systemd analyzer');
    }
    offlineUnitRoot = exactDirectory(args['offline-unit-root'], '--offline-unit-root');
    const expectedOfflineUnitRoot = resolve(stagingRoot, 'systemd');
    const expectedFragment = resolve(offlineUnitRoot, expectedUnit);
    const expectedRuntimeEnv = resolve(stagingRoot, 'runtime', 'cosmos-app.env');
    if (args.unit !== expectedUnit
        || args.systemctl !== expectedSystemctl
        || offlineUnitRoot !== expectedOfflineUnitRoot
        || args['expected-fragment-path'] !== expectedFragment
        || args['runtime-env'] !== expectedRuntimeEnv
        || args['proof-drop-in-runtime-link'] !== undefined) {
      fail('STAGING unit, private unit root, fragment, or runtime environment is not the exact proof-suffixed offline layout');
    }
  }
  const requiredProofArguments = strictProofOwnership
    ? ['proof-drop-in', 'proof-absent-sentinel']
    : ['proof-drop-in', 'proof-drop-in-runtime-link', 'proof-absent-sentinel'];
  for (const name of requiredProofArguments) {
    if (args[name] === undefined) fail(`--${name} is required in staging mode`);
  }
  proofDropIn = exactAbsolute(args['proof-drop-in'], '--proof-drop-in');
  if (args['proof-drop-in-runtime-link'] !== undefined) {
    proofDropInRuntimeLink = exactLexicalAbsolute(
      args['proof-drop-in-runtime-link'],
      '--proof-drop-in-runtime-link',
    );
  }
  proofAbsentSentinel = exactLexicalAbsolute(
    args['proof-absent-sentinel'],
    '--proof-absent-sentinel',
  );
  if (!isWithin(stagingRoot, args['expected-fragment-path'])
      || !isWithin(stagingRoot, args['runtime-env'])
      || !isWithin(stagingRoot, proofDropIn)
      || !isWithin(stagingRoot, proofAbsentSentinel)) {
    fail('staged fragment, runtime environment, proof drop-in, and sentinel must remain below the exact staging root');
  }
  const unitStem = args.unit.slice(0, -'.service'.length);
  const expectedDropIn = resolve(
    stagingRoot,
    'systemd',
    `${args.unit}.d`,
    `90-${unitStem}.conf`,
  );
  const expectedSentinel = resolve(
    stagingRoot,
    `.do-not-start-${unitStem}`,
  );
  if (proofDropIn !== expectedDropIn || proofAbsentSentinel !== expectedSentinel) {
    fail('staging proof drop-in or absent sentinel path is not the exact unit-derived path');
  }
} else if (args['provenance-mode'] !== 'SYSTEM') {
  fail('STAGING and TEST app-unit inspection require --staging-root');
} else if (args.unit !== PRODUCTION_UNIT
    || args['expected-fragment-path'] !== PRODUCTION_FRAGMENT
    || args['runtime-env'] !== PRODUCTION_RUNTIME_ENV) {
  fail('production app-unit inspection requires the exact canonical unit, fragment, and runtime environment paths');
} else if (args['proof-drop-in'] !== undefined
    || args['proof-drop-in-runtime-link'] !== undefined
    || args['proof-absent-sentinel'] !== undefined
    || args['systemd-analyze'] !== undefined
    || args['offline-unit-root'] !== undefined) {
  fail('production app-unit inspection forbids staging proof inputs');
}

function inspectExecutable(path, label) {
  const result = spawnSync(process.execPath, [
    INSPECT_EXECUTABLE, '--path', exactAbsolute(path, label),
  ], {
    encoding: 'utf8',
    env: CLOSED_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 32 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== '') {
    fail(`${label} executable inspection failed`);
  }
  let inspected;
  try {
    inspected = JSON.parse(result.stdout);
  } catch {
    fail(`${label} executable inspection returned invalid JSON`);
  }
  requireExactKeys(
    inspected,
    ['status', 'path', 'sha256', 'identity', 'endpointIdentity'],
    `${label} executable inspection`,
  );
  if (inspected.status !== 'EXECUTABLE_IDENTITY_VERIFIED'
      || inspected.path !== path || !DIGEST.test(inspected.sha256)) {
    fail(`${label} executable inspection is invalid`);
  }
  return Object.freeze(inspected);
}

function identity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    links: stat.nlink.toString(),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  });
}

function sameIdentity(left, right) {
  return IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

function verifyTrustedAncestors(path, leafUid, label) {
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  const trustedOwners = new Set([0n, leafUid]);
  if (invokingUid !== null) trustedOwners.add(invokingUid);
  let cursor = dirname(path);
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { bigint: true });
    } catch (error) {
      fail(`${label} ancestor is unavailable: ${error.message}`);
    }
    const mode = stat.mode & 0o7777n;
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(cursor) !== cursor) {
      fail(`${label} ancestor chain must contain only canonical directories`);
    }
    if (!trustedOwners.has(stat.uid)) {
      fail(`${label} ancestor chain has an untrusted owner`);
    }
    if ((mode & 0o022n) !== 0n
        && !(stat.uid === 0n && (mode & 0o1000n) !== 0n)) {
      fail(`${label} ancestor chain contains an unsafe writable directory`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function inspectBoundFile(rawPath, label, maximumBytes) {
  const path = exactAbsolute(rawPath, label);
  let namedBefore;
  try {
    namedBefore = lstatSync(path, { bigint: true });
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1n
      || namedBefore.size <= 0n || namedBefore.size > BigInt(maximumBytes)) {
    fail(`${label} must be one bounded single-link regular file`);
  }
  if ((namedBefore.mode & 0o022n) !== 0n || (namedBefore.mode & 0o7000n) !== 0n) {
    fail(`${label} has an unsafe writable or special mode`);
  }
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  if (invokingUid !== null && namedBefore.uid !== 0n && namedBefore.uid !== invokingUid) {
    fail(`${label} has an untrusted owner`);
  }
  verifyTrustedAncestors(path, namedBefore.uid, label);
  const beforeIdentity = identity(namedBefore);
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!openedBefore.isFile() || openedBefore.nlink !== 1n
        || !sameIdentity(identity(openedBefore), beforeIdentity)) {
      fail(`${label} identity changed before descriptor read`);
    }
    bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(identity(openedAfter), beforeIdentity)
        || BigInt(bytes.length) !== openedAfter.size) {
      fail(`${label} identity changed during descriptor read`);
    }
  } catch (error) {
    if (String(error?.message ?? '').startsWith('I00_OPS_BLOCKED:')) throw error;
    fail(`${label} cannot be inspected: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const namedAfter = lstatSync(path, { bigint: true });
  if (!namedAfter.isFile() || namedAfter.isSymbolicLink()
      || realpathSync(path) !== path
      || !sameIdentity(identity(namedAfter), beforeIdentity)) {
    fail(`${label} named identity changed after descriptor read`);
  }
  return Object.freeze({
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
    identity: beforeIdentity,
    endpointIdentity: ENDPOINT_IDENTITY_KEYS
      .map((key) => `${key}=${beforeIdentity[key]}`)
      .join(','),
  });
}

function requireAbsentProofSentinel() {
  if (proofAbsentSentinel === null) return;
  let cursor = dirname(proofAbsentSentinel);
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true, throwIfNoEntry: false });
    if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()
        || realpathSync(cursor) !== cursor) {
      fail('proof absent sentinel ancestor chain is not canonical');
    }
    if (cursor === stagingRoot) break;
    const parent = dirname(cursor);
    if (parent === cursor || !isWithin(stagingRoot, cursor)) {
      fail('proof absent sentinel escaped the exact staging root');
    }
    cursor = parent;
  }
  if (lstatSync(proofAbsentSentinel, { bigint: true, throwIfNoEntry: false }) !== undefined) {
    fail('proof absent sentinel must remain absent');
  }
}

function inspectProofDropInRuntimeLink() {
  if (proofDropInRuntimeLink === null || proofDropIn === null) return null;
  const parent = dirname(proofDropInRuntimeLink);
  const parentStat = lstatSync(parent, { bigint: true, throwIfNoEntry: false });
  if (parentStat === undefined || !parentStat.isDirectory() || parentStat.isSymbolicLink()
      || realpathSync(parent) !== parent
      || (parentStat.mode & 0o022n) !== 0n
      || (strictProofOwnership && parentStat.uid !== 0n)) {
    fail('proof drop-in runtime link parent is not root-controlled and canonical');
  }
  const stat = lstatSync(proofDropInRuntimeLink, { bigint: true, throwIfNoEntry: false });
  if (stat === undefined || !stat.isSymbolicLink() || stat.nlink !== 1n
      || (strictProofOwnership && stat.uid !== 0n)) {
    fail('proof drop-in runtime link is not one exact root-owned symbolic link');
  }
  const target = resolve(parent, readlinkSync(proofDropInRuntimeLink));
  if (target !== proofDropIn || realpathSync(proofDropInRuntimeLink) !== proofDropIn) {
    fail('proof drop-in runtime link target differs from the exact staged drop-in');
  }
  const linkIdentity = identity(stat);
  return Object.freeze({
    path: proofDropInRuntimeLink,
    target,
    identity: linkIdentity,
    endpointIdentity: ENDPOINT_IDENTITY_KEYS
      .map((key) => `${key}=${linkIdentity[key]}`)
      .join(','),
  });
}

function parseShowOutput(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0 || stdout.length > 64 * 1024
      || stdout.includes('\0') || !stdout.endsWith('\n')) {
    fail('systemctl show returned malformed output');
  }
  const propertyLines = {};
  for (const line of stdout.slice(0, -1).split('\n')) {
    const split = line.indexOf('=');
    if (split <= 0) fail('systemctl show returned one malformed property');
    const key = line.slice(0, split);
    const value = line.slice(split + 1);
    if (!SHOW_PROPERTIES.includes(key)) {
      fail('systemctl show returned an unexpected property');
    }
    if (!Object.hasOwn(propertyLines, key)) propertyLines[key] = [];
    propertyLines[key].push(value);
  }
  requireExactKeys(propertyLines, SHOW_PROPERTIES, 'systemctl show properties');
  for (const [key, values] of Object.entries(propertyLines)) {
    if (key !== 'EnvironmentFiles' && values.length !== 1) {
      fail(`systemctl show returned duplicate ${key} properties`);
    }
  }
  const properties = Object.fromEntries(
    Object.entries(propertyLines).map(([key, values]) => [key, values[0]]),
  );
  if (properties.Id !== args.unit || properties.LoadState !== 'loaded') {
    fail('systemctl show did not identify the exact loaded app unit');
  }
  const dropInPaths = properties.DropInPaths.split(' ').filter(Boolean);
  const expectedDropInPaths = stagingRoot === null
    ? []
    : [proofDropInRuntimeLink];
  if (dropInPaths.length !== expectedDropInPaths.length
      || dropInPaths.some((entry, index) => entry !== expectedDropInPaths[index])) {
    fail(stagingRoot === null
      ? 'app unit DropInPaths must be empty for keyless deployment'
      : 'app unit must load only the exact isolated staging proof drop-in');
  }
  if (properties.NeedDaemonReload !== 'no') {
    fail('app unit NeedDaemonReload must be exactly no');
  }
  for (const name of [
    'SuccessAction', 'FailureAction', 'JobTimeoutAction', 'StartLimitAction',
  ]) {
    if (properties[name] !== 'none') {
      fail(`app unit ${name} must be exactly none`);
    }
  }
  if (properties.OnFailure !== '') {
    fail('app unit OnFailure must be empty');
  }
  if (properties.User !== EXPECTED_USER || properties.Group !== EXPECTED_GROUP) {
    fail('app unit must run as the exact cosmos user and group');
  }
  if (properties.WorkingDirectory !== EXPECTED_WORKING_DIRECTORY) {
    fail('app unit WorkingDirectory must be exactly /opt/cosmos/current');
  }
  for (const name of [
    'Environment', 'PassEnvironment', 'SetCredential', 'SetCredentialEncrypted',
    'LoadCredential', 'LoadCredentialEncrypted', 'ImportCredential',
  ]) {
    if (properties[name] !== '') {
      fail(`app unit ${name} must be empty`);
    }
  }
  if (properties.SupplementaryGroups !== '' || properties.DynamicUser !== 'no'
      || properties.PAMName !== '' || properties.CapabilityBoundingSet !== ''
      || properties.AmbientCapabilities !== '' || properties.NoNewPrivileges !== 'yes') {
    fail('app unit effective identity and capability authority must be exactly closed');
  }
  const fragmentPath = exactAbsolute(properties.FragmentPath, 'app unit FragmentPath');
  if (fragmentPath !== args['expected-fragment-path']) {
    fail('app unit FragmentPath differs from the exact expected fragment');
  }
  const environmentFiles = propertyLines.EnvironmentFiles;
  if (environmentFiles.length !== 1
      || environmentFiles[0] !== `${args['runtime-env']} (ignore_errors=no)`) {
    fail('app unit must use the sole exact non-optional runtime EnvironmentFile');
  }
  const unsetEnvironment = properties.UnsetEnvironment.split(' ').filter(Boolean);
  if (unsetEnvironment.length !== EXPECTED_UNSET_ENVIRONMENT.length
      || new Set(unsetEnvironment).size !== unsetEnvironment.length
      || [...unsetEnvironment].sort().join('\0')
        !== [...EXPECTED_UNSET_ENVIRONMENT].sort().join('\0')) {
    fail('app unit UnsetEnvironment does not equal the complete runtime closure');
  }
  for (const name of [
    'RootDirectory', 'RootImage', 'MountImages', 'ExtensionImages',
    'ExtensionDirectories', 'ExecSearchPath', 'BindPaths', 'BindReadOnlyPaths',
    'TemporaryFileSystem', 'ReadOnlyPaths', 'InaccessiblePaths', 'ExecPaths',
    'NoExecPaths', 'StateDirectory', 'CacheDirectory', 'LogsDirectory',
    'ConfigurationDirectory',
  ]) {
    if (properties[name] !== '') {
      fail(`app unit ${name} must be empty`);
    }
  }
  if (properties.RootDirectoryStartOnly !== 'no') {
    fail('app unit RootDirectoryStartOnly must be exactly no');
  }
  if (properties.Type !== 'simple'
      || properties.StandardInput !== 'null'
      || properties.StandardOutput !== 'journal'
      || properties.StandardError !== 'journal'
      || properties.Sockets !== ''
      || properties.BusName !== ''
      || properties.PIDFile !== ''
      || properties.NotifyAccess !== 'none'
      || properties.FileDescriptorStoreMax !== '0'
      || properties.FileDescriptorStorePreserve !== 'no') {
    fail('app unit standard I/O, socket, bus, PID, notify, or descriptor authority is not exact');
  }
  if (properties.RuntimeDirectory !== 'cosmos-app'
      || properties.RuntimeDirectoryPreserve !== 'restart'
      || properties.ReadWritePaths !== '/var/lib/cosmos /run/cosmos-app') {
    fail('app unit writable-directory authority is not exact');
  }
  for (const name of [
    'ExecCondition', 'ExecStartPre', 'ExecStartPost', 'ExecReload', 'ExecStop',
    'ExecStopPost',
  ]) {
    if (properties[name] !== '') {
      fail(`app unit ${name} must be empty`);
    }
  }
  const expectedArgv = [
    args.env,
    EXPECTED_LEASE,
    args.node,
    EXPECTED_ENTRYPOINT,
  ];
  if (expectedArgv.some((entry) => /[\s;{}]/u.test(entry))) {
    fail('app unit expected ExecStart tokens are not unambiguous');
  }
  const parseExecCommand = (raw, field, expectedAuthority) => {
    const match = /^\{ path=([^ ;{}]+) ; argv\[\]=([^;{}]+) ; (ignore_errors|flags)=([^;{}]*) ; start_time=\[([^\]\r\n]*)\] ; stop_time=\[([^\]\r\n]*)\] ; pid=([0-9]+) ; code=([^ ;{}]+) ; status=([^ ;{}]+) \}$/u
      .exec(raw);
    if (match === null || match[3] !== field || match[4] !== expectedAuthority
        || raw.indexOf('{ path=') !== 0 || raw.indexOf('{ path=', 1) !== -1) {
      fail(`app unit ${field === 'flags' ? 'ExecStartEx' : 'ExecStart'} is not one exact closed command`);
    }
    return Object.freeze({
      path: exactAbsolute(match[1], `app unit ${field === 'flags' ? 'ExecStartEx' : 'ExecStart'} env path`),
      argv: Object.freeze(match[2].split(' ')),
    });
  };
  const legacyExecStart = parseExecCommand(properties.ExecStart, 'ignore_errors', 'no');
  const extendedExecStart = parseExecCommand(properties.ExecStartEx, 'flags', '');
  if (legacyExecStart.path !== args.env
      || JSON.stringify(legacyExecStart.argv) !== JSON.stringify(expectedArgv)
      || canonicalJson(extendedExecStart) !== canonicalJson(legacyExecStart)) {
    fail('app unit ExecStart does not use the exact preview-bound env and Node');
  }
  const execStart = Object.freeze({
    path: legacyExecStart.path,
    argv: legacyExecStart.argv,
    flags: Object.freeze([]),
  });
  const authorityClosure = Object.freeze(Object.fromEntries(
    [
      'Environment', 'EnvironmentFiles', 'PassEnvironment', 'UnsetEnvironment',
      'SetCredential', 'SetCredentialEncrypted', 'LoadCredential',
      'LoadCredentialEncrypted', 'ImportCredential', 'SupplementaryGroups',
      'DynamicUser', 'PAMName', 'CapabilityBoundingSet', 'AmbientCapabilities',
      'NoNewPrivileges', 'ExecCondition', 'ExecStartPre', 'ExecStart',
      'ExecStartEx', 'ExecStartPost', 'ExecReload', 'ExecStop', 'ExecStopPost',
      'RootDirectory', 'RootImage', 'MountImages', 'ExtensionImages',
      'ExtensionDirectories', 'ExecSearchPath', 'BindPaths', 'BindReadOnlyPaths',
      'TemporaryFileSystem', 'RootDirectoryStartOnly',
      'Names', 'Following', 'Requires', 'Wants', 'Requisite', 'BindsTo',
      'PartOf', 'After', 'Before', 'Conflicts', 'OnFailure', 'OnSuccess',
      'OnSuccessJobMode', 'OnFailureJobMode', 'PropagatesStopTo',
      'StopPropagatedFrom', 'PropagatesReloadTo', 'ReloadPropagatedFrom',
      'Upholds', 'JoinsNamespaceOf', 'RequiresMountsFor', 'WantsMountsFor',
      'DefaultDependencies', 'SuccessAction', 'FailureAction',
      'JobTimeoutAction', 'StartLimitAction', 'ReadWritePaths', 'ReadOnlyPaths',
      'InaccessiblePaths', 'ExecPaths', 'NoExecPaths', 'RuntimeDirectory',
      'RuntimeDirectoryMode', 'RuntimeDirectoryPreserve', 'StateDirectory',
      'StateDirectoryMode', 'CacheDirectory', 'CacheDirectoryMode',
      'LogsDirectory', 'LogsDirectoryMode', 'ConfigurationDirectory',
      'ConfigurationDirectoryMode', 'Type', 'StandardInput', 'StandardOutput',
      'StandardError', 'Sockets', 'BusName', 'PIDFile', 'NotifyAccess',
      'FileDescriptorStoreMax', 'FileDescriptorStorePreserve',
    ].map((name) => [
      name,
      name === 'EnvironmentFiles'
        ? [...propertyLines.EnvironmentFiles]
        : name === 'UnsetEnvironment'
          ? [...unsetEnvironment].sort()
          : [
            'Names', 'Requires', 'Wants', 'Requisite', 'BindsTo', 'PartOf',
            'After', 'Before', 'Conflicts', 'OnFailure', 'OnSuccess',
            'PropagatesStopTo', 'StopPropagatedFrom', 'PropagatesReloadTo',
            'ReloadPropagatedFrom', 'Upholds', 'JoinsNamespaceOf',
            'RequiresMountsFor', 'WantsMountsFor', 'Sockets',
          ].includes(name)
            ? properties[name].split(' ').filter(Boolean).sort()
          : name === 'ExecStart'
            ? Object.freeze({
              path: execStart.path,
              argv: execStart.argv,
              ignoreErrors: false,
            })
            : name === 'ExecStartEx'
              ? execStart
              : properties[name],
    ]),
  ));
  const reachabilityListProperties = Object.freeze([
    'Names', 'Requires', 'Wants', 'Requisite', 'BindsTo', 'PartOf', 'After',
    'Before', 'Conflicts', 'OnFailure', 'OnSuccess', 'PropagatesStopTo',
    'StopPropagatedFrom', 'PropagatesReloadTo', 'ReloadPropagatedFrom',
    'Upholds', 'JoinsNamespaceOf', 'RequiresMountsFor', 'WantsMountsFor',
  ]);
  const reachabilityScalarProperties = Object.freeze([
    'Following', 'OnSuccessJobMode', 'OnFailureJobMode', 'DefaultDependencies',
  ]);
  const effectReachability = [
    'Basis=LIVE_SYSTEM_MANAGER',
    ...reachabilityListProperties.map((name) => {
      const values = properties[name].split(' ').filter(Boolean).sort();
      return `${name}=${values.length === 0 ? 'NONE' : values.join(',')}`;
    }),
    ...reachabilityScalarProperties.map(
      (name) => `${name}=${properties[name] === '' ? 'NONE' : properties[name]}`,
    ),
  ].join(';');
  if (effectReachability.length > 2_048) {
    fail('app unit effect reachability exceeds the owner-visible authorization bound');
  }
  return Object.freeze({
    unit: properties.Id,
    fragmentPath,
    dropInPaths: Object.freeze(dropInPaths),
    needDaemonReload: properties.NeedDaemonReload,
    user: properties.User,
    group: properties.Group,
    workingDirectory: properties.WorkingDirectory,
    environmentFiles: Object.freeze([Object.freeze({
      path: args['runtime-env'],
      optional: false,
    })]),
    unsetEnvironment: Object.freeze([...EXPECTED_UNSET_ENVIRONMENT].sort()),
    unsetEnvironmentSha256: createHash('sha256')
      .update(canonicalJson([...EXPECTED_UNSET_ENVIRONMENT].sort()))
      .digest('hex'),
    namespaceRemapState: 'NONE',
    executionAuthorityState: 'CLOSED',
    environmentAuthorityState: 'CLOSED',
    identityAuthorityState: 'CLOSED',
    authorityClosureSha256: createHash('sha256')
      .update(canonicalJson(authorityClosure))
      .digest('hex'),
    effectReachability,
    execStart,
    execStartSha256: createHash('sha256').update(canonicalJson(execStart)).digest('hex'),
  });
}

function inspectManager(systemctl) {
  const result = spawnSync(systemctl.path, [
    'show',
    args.unit,
    '--no-pager',
    '--all',
    ...SHOW_PROPERTIES.map((property) => `--property=${property}`),
  ], {
    encoding: 'utf8',
    env: CLOSED_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== '') {
    fail(`bound systemctl app unit inspection failed at exit ${String(result.status)}`);
  }
  return parseShowOutput(result.stdout);
}

function parseOfflineUnit(bytes) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes) || text.includes('\r') || text.includes('\0')) {
    fail('offline app unit source is not canonical UTF-8 text');
  }
  let section = null;
  const directives = {};
  for (const [index, line] of text.split('\n').entries()) {
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = /^\[([A-Za-z][A-Za-z0-9]*)\]$/u.exec(line);
    if (sectionMatch !== null) {
      section = sectionMatch[1];
      if (!Object.hasOwn(directives, section)) directives[section] = {};
      continue;
    }
    if (section === null || /^\s/u.test(line) || line.endsWith('\\')) {
      fail(`offline app unit source has unsupported syntax at line ${index + 1}`);
    }
    const match = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/u.exec(line);
    if (match === null) {
      fail(`offline app unit source has malformed syntax at line ${index + 1}`);
    }
    if (!Object.hasOwn(directives[section], match[1])) {
      directives[section][match[1]] = [];
    }
    directives[section][match[1]].push(match[2]);
  }
  return Object.freeze(directives);
}

function offlineDirective(directives, section, name, {
  defaultValue = null,
  multiple = false,
} = {}) {
  const values = directives[section]?.[name] ?? [];
  if (multiple) return Object.freeze([...values]);
  if (values.length === 0 && defaultValue !== null) return defaultValue;
  if (values.length !== 1) {
    fail(`offline app unit ${section}.${name} is not one exact directive`);
  }
  return values[0];
}

function inspectOfflineUnitInventory() {
  const unitStem = args.unit.slice(0, -'.service'.length);
  const dropInDirectory = resolve(offlineUnitRoot, `${args.unit}.d`);
  const expected = Object.freeze([
    Object.freeze({ path: args.unit, type: 'file' }),
    Object.freeze({ path: `${args.unit}.d`, type: 'directory' }),
    Object.freeze({
      path: `${args.unit}.d/90-${unitStem}.conf`,
      type: 'file',
    }),
  ]);
  const actual = [];
  const visit = (directory, relativePrefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      const relativePath = relativePrefix ? `${relativePrefix}/${name}` : name;
      const absolute = resolve(directory, name);
      const stat = lstatSync(absolute, { bigint: true });
      if (stat.isSymbolicLink()) {
        fail('offline app unit root must not contain aliases or dependency symlinks');
      }
      if (stat.isDirectory()) {
        actual.push(Object.freeze({ path: relativePath, type: 'directory' }));
        visit(absolute, relativePath);
      } else if (stat.isFile()) {
        actual.push(Object.freeze({ path: relativePath, type: 'file' }));
      } else {
        fail('offline app unit root contains an unsupported filesystem object');
      }
    }
  };
  visit(offlineUnitRoot);
  if (canonicalJson(actual) !== canonicalJson(expected)
      || dirname(proofDropIn) !== dropInDirectory) {
    fail('offline app unit root contains an alias, dependency edge, or unexpected unit object');
  }
  return Object.freeze(actual);
}

function verifyOfflineUnit(systemdAnalyze) {
  const result = spawnSync(systemdAnalyze.path, [
    '--man=no',
    '--recursive-errors=no',
    'verify',
    args['expected-fragment-path'],
  ], {
    encoding: 'utf8',
    env: Object.freeze({
      ...CLOSED_ENV,
      SYSTEMD_UNIT_PATH: offlineUnitRoot,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0
      || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
      || result.stdout.length > 64 * 1024 || result.stderr.length > 64 * 1024) {
    fail('bound systemd analyzer rejected the private offline app unit');
  }
}

function offlineManager(fragment, proof, systemdAnalyze) {
  const directives = parseOfflineUnit(fragment.bytes);
  const service = directives.Service ?? {};
  const unit = directives.Unit ?? {};
  const exactSingle = (name, expected) => {
    if (offlineDirective(directives, 'Service', name) !== expected) {
      fail(`offline app unit Service.${name} differs from the accepted authority`);
    }
  };
  exactSingle('Type', 'simple');
  exactSingle('User', EXPECTED_USER);
  exactSingle('Group', EXPECTED_GROUP);
  exactSingle('WorkingDirectory', EXPECTED_WORKING_DIRECTORY);
  exactSingle('EnvironmentFile', PRODUCTION_RUNTIME_ENV);
  exactSingle('NoNewPrivileges', 'yes');
  exactSingle('StandardOutput', 'journal');
  exactSingle('StandardError', 'journal');
  exactSingle('RuntimeDirectory', 'cosmos-app');
  exactSingle('RuntimeDirectoryMode', '0700');
  exactSingle('RuntimeDirectoryPreserve', 'restart');
  exactSingle('ReadWritePaths', '/var/lib/cosmos /run/cosmos-app');
  const execStartRaw = offlineDirective(directives, 'Service', 'ExecStart');
  const expectedExecStart = [
    args.env,
    EXPECTED_LEASE,
    args.node,
    EXPECTED_ENTRYPOINT,
  ].join(' ');
  if (execStartRaw !== expectedExecStart) {
    fail('offline app unit ExecStart differs from the exact preview-bound env and Node');
  }
  for (const name of [
    'Environment', 'PassEnvironment', 'SetCredential', 'SetCredentialEncrypted',
    'LoadCredential', 'LoadCredentialEncrypted', 'ImportCredential',
    'SupplementaryGroups', 'DynamicUser', 'PAMName', 'AmbientCapabilities',
    'ExecCondition', 'ExecStartPre', 'ExecStartPost', 'ExecReload', 'ExecStop',
    'ExecStopPost', 'RootDirectory', 'RootImage', 'MountImages', 'ExtensionImages',
    'ExtensionDirectories', 'ExecSearchPath', 'BindPaths', 'BindReadOnlyPaths',
    'TemporaryFileSystem', 'ReadOnlyPaths', 'InaccessiblePaths', 'ExecPaths',
    'NoExecPaths', 'StateDirectory', 'CacheDirectory', 'LogsDirectory',
    'ConfigurationDirectory', 'Sockets', 'BusName', 'PIDFile',
  ]) {
    if (Object.hasOwn(service, name)) {
      fail(`offline app unit Service.${name} must remain absent`);
    }
  }
  if (canonicalJson(service.CapabilityBoundingSet ?? []) !== canonicalJson([''])) {
    fail('offline app unit capability authority is not exactly empty');
  }
  const unsetEnvironment = offlineDirective(
    directives,
    'Service',
    'UnsetEnvironment',
    { multiple: true },
  ).flatMap((value) => value.split(' ').filter(Boolean));
  if (new Set(unsetEnvironment).size !== unsetEnvironment.length
      || [...unsetEnvironment].sort().join('\0')
        !== [...EXPECTED_UNSET_ENVIRONMENT].sort().join('\0')) {
    fail('offline app unit UnsetEnvironment does not equal the complete runtime closure');
  }
  const listValue = (name) => (unit[name] ?? [])
    .flatMap((value) => value.split(' ').filter(Boolean))
    .sort();
  const reachabilityPairs = [
    ['Names', [args.unit]],
    ['Requires', listValue('Requires')],
    ['Wants', listValue('Wants')],
    ['Requisite', listValue('Requisite')],
    ['BindsTo', listValue('BindsTo')],
    ['PartOf', listValue('PartOf')],
    ['After', listValue('After')],
    ['Before', listValue('Before')],
    ['Conflicts', listValue('Conflicts')],
    ['OnFailure', listValue('OnFailure')],
    ['OnSuccess', listValue('OnSuccess')],
    ['PropagatesStopTo', listValue('PropagatesStopTo')],
    ['StopPropagatedFrom', listValue('StopPropagatedFrom')],
    ['PropagatesReloadTo', listValue('PropagatesReloadTo')],
    ['ReloadPropagatedFrom', listValue('ReloadPropagatedFrom')],
    ['Upholds', listValue('Upholds')],
    ['JoinsNamespaceOf', listValue('JoinsNamespaceOf')],
    ['RequiresMountsFor', listValue('RequiresMountsFor')],
    ['WantsMountsFor', listValue('WantsMountsFor')],
  ];
  const effectReachability = [
    'Basis=PRIVATE_OFFLINE_UNIT_ROOT',
    ...reachabilityPairs.map(
      ([name, values]) => `${name}=${values.length === 0 ? 'NONE' : values.join(',')}`,
    ),
    'Following=NONE',
    `OnSuccessJobMode=${unit.OnSuccessJobMode?.[0] ?? 'replace'}`,
    `OnFailureJobMode=${unit.OnFailureJobMode?.[0] ?? 'replace'}`,
    `DefaultDependencies=${unit.DefaultDependencies?.[0] ?? 'yes'}`,
  ].join(';');
  if (effectReachability.length > 2_048) {
    fail('offline app unit effect reachability exceeds the owner-visible authorization bound');
  }
  const inventory = inspectOfflineUnitInventory();
  verifyOfflineUnit(systemdAnalyze);
  const systemdAnalyzeAfterUse = inspectExecutable(
    systemdAnalyze.path,
    '--systemd-analyze',
  );
  if (canonicalJson(systemdAnalyzeAfterUse) !== canonicalJson(systemdAnalyze)) {
    fail('systemd analyzer executable changed around offline verification');
  }
  const execStart = Object.freeze({
    path: args.env,
    argv: Object.freeze([
      args.env,
      EXPECTED_LEASE,
      args.node,
      EXPECTED_ENTRYPOINT,
    ]),
    flags: Object.freeze([]),
  });
  const authorityClosure = Object.freeze({
    inspectionMode: 'PRIVATE_OFFLINE_UNIT_ROOT',
    offlineUnitRoot,
    inventory,
    directives,
    fragmentSha256: fragment.sha256,
    proofDropInSha256: proof.sha256,
    systemdAnalyze: Object.freeze({
      path: systemdAnalyze.path,
      sha256: systemdAnalyze.sha256,
      identity: systemdAnalyze.endpointIdentity,
    }),
  });
  return Object.freeze({
    unit: args.unit,
    fragmentPath: fragment.path,
    dropInPaths: Object.freeze([proof.path]),
    needDaemonReload: 'not-applicable-offline',
    user: EXPECTED_USER,
    group: EXPECTED_GROUP,
    workingDirectory: EXPECTED_WORKING_DIRECTORY,
    environmentFiles: Object.freeze([Object.freeze({
      path: args['runtime-env'],
      optional: false,
    })]),
    unsetEnvironment: Object.freeze([...EXPECTED_UNSET_ENVIRONMENT].sort()),
    unsetEnvironmentSha256: createHash('sha256')
      .update(canonicalJson([...EXPECTED_UNSET_ENVIRONMENT].sort()))
      .digest('hex'),
    namespaceRemapState: 'NONE',
    executionAuthorityState: 'CLOSED',
    environmentAuthorityState: 'CLOSED',
    identityAuthorityState: 'CLOSED',
    authorityClosureSha256: createHash('sha256')
      .update(canonicalJson(authorityClosure))
      .digest('hex'),
    effectReachability,
    execStart,
    execStartSha256: createHash('sha256').update(canonicalJson(execStart)).digest('hex'),
  });
}

const systemctlBefore = inspectExecutable(args.systemctl, '--systemctl');
if (strictProofOwnership) {
  const stagingSystemctl = lstatSync(systemctlBefore.path, { bigint: true });
  if (stagingSystemctl.uid !== 0n
      || stagingSystemctl.nlink !== 1n
      || (stagingSystemctl.mode & 0o222n) !== 0n) {
    fail('STAGING systemctl fixture must be one root-owned non-writable file');
  }
}
const nodeBefore = inspectExecutable(args.node, '--node');
const envBefore = inspectExecutable(args.env, '--env');
const fragmentSourceBefore = inspectBoundFile(
  args['expected-fragment-source'],
  'accepted donor app unit fragment source',
  1024 * 1024,
);
const liveManagerBefore = strictProofOwnership ? null : inspectManager(systemctlBefore);
const fragmentBefore = inspectBoundFile(
  strictProofOwnership ? args['expected-fragment-path'] : liveManagerBefore.fragmentPath,
  'app unit fragment',
  1024 * 1024,
);
const runtimeEnvBefore = inspectBoundFile(
  args['runtime-env'],
  'app unit runtime environment',
  1024 * 1024,
);
const proofDropInBefore = proofDropIn === null
  ? null
  : inspectBoundFile(proofDropIn, 'isolated staging proof drop-in', 64 * 1024);
const proofDropInRuntimeLinkBefore = inspectProofDropInRuntimeLink();
requireAbsentProofSentinel();
if (!fragmentBefore.bytes.equals(fragmentSourceBefore.bytes)) {
  fail('loaded app unit fragment bytes differ from the accepted donor source');
}
if (proofDropInBefore !== null) {
  const expectedProofBytes = Buffer.from([
    '[Unit]',
    `ConditionPathExists=${proofAbsentSentinel}`,
    '',
    '[Service]',
    'EnvironmentFile=',
    `EnvironmentFile=${args['runtime-env']}`,
    '',
  ].join('\n'));
  if (!proofDropInBefore.bytes.equals(expectedProofBytes)
      || (strictProofOwnership && proofDropInBefore.identity.uid !== '0')
      || (BigInt(`0o${proofDropInBefore.identity.mode}`) & 0o222n) !== 0n) {
    fail('isolated staging proof drop-in bytes or ownership are not exact');
  }
}
const systemdAnalyzeBefore = strictProofOwnership
  ? inspectExecutable(args['systemd-analyze'], '--systemd-analyze')
  : null;
const managerBefore = strictProofOwnership
  ? offlineManager(fragmentBefore, proofDropInBefore, systemdAnalyzeBefore)
  : liveManagerBefore;
if (!strictProofOwnership && managerBefore.fragmentPath !== fragmentBefore.path) {
  fail('app unit FragmentPath changed between manager and descriptor inspection');
}
const fragmentSourceAfter = inspectBoundFile(
  args['expected-fragment-source'],
  'accepted donor app unit fragment source',
  1024 * 1024,
);
const systemdAnalyzeAfter = strictProofOwnership
  ? inspectExecutable(args['systemd-analyze'], '--systemd-analyze')
  : null;
const liveManagerAfter = strictProofOwnership ? null : inspectManager(systemctlBefore);
const fragmentAfter = inspectBoundFile(
  strictProofOwnership ? args['expected-fragment-path'] : liveManagerAfter.fragmentPath,
  'app unit fragment',
  1024 * 1024,
);
const runtimeEnvAfter = inspectBoundFile(
  args['runtime-env'],
  'app unit runtime environment',
  1024 * 1024,
);
const proofDropInAfter = proofDropIn === null
  ? null
  : inspectBoundFile(proofDropIn, 'isolated staging proof drop-in', 64 * 1024);
const proofDropInRuntimeLinkAfter = inspectProofDropInRuntimeLink();
requireAbsentProofSentinel();
const managerAfter = strictProofOwnership
  ? offlineManager(fragmentAfter, proofDropInAfter, systemdAnalyzeAfter)
  : liveManagerAfter;
if (canonicalJson(managerAfter) !== canonicalJson(managerBefore)
    || canonicalJson(fragmentSourceAfter) !== canonicalJson(fragmentSourceBefore)
    || canonicalJson(fragmentAfter) !== canonicalJson(fragmentBefore)
    || canonicalJson(runtimeEnvAfter) !== canonicalJson(runtimeEnvBefore)
    || canonicalJson(proofDropInAfter) !== canonicalJson(proofDropInBefore)
    || canonicalJson(systemdAnalyzeAfter) !== canonicalJson(systemdAnalyzeBefore)
    || canonicalJson(proofDropInRuntimeLinkAfter)
      !== canonicalJson(proofDropInRuntimeLinkBefore)) {
  fail('app unit binding changed during inspection');
}
const systemctlAfter = inspectExecutable(args.systemctl, '--systemctl');
if (strictProofOwnership) {
  const stagingSystemctl = lstatSync(systemctlAfter.path, { bigint: true });
  if (stagingSystemctl.uid !== 0n
      || stagingSystemctl.nlink !== 1n
      || (stagingSystemctl.mode & 0o222n) !== 0n) {
    fail('STAGING systemctl fixture changed ownership or mode');
  }
}
const nodeAfter = inspectExecutable(args.node, '--node');
const envAfter = inspectExecutable(args.env, '--env');
if (canonicalJson(systemctlAfter) !== canonicalJson(systemctlBefore)
    || canonicalJson(nodeAfter) !== canonicalJson(nodeBefore)
    || canonicalJson(envAfter) !== canonicalJson(envBefore)) {
  fail('app unit executable binding changed during inspection');
}

const binding = Object.freeze({
  inspectionMode: strictProofOwnership
    ? 'PRIVATE_OFFLINE_UNIT_ROOT'
    : 'LIVE_SYSTEM_MANAGER',
  offlineUnitRoot,
  systemdAnalyzePath: systemdAnalyzeBefore?.path ?? null,
  systemdAnalyzeSha256: systemdAnalyzeBefore?.sha256 ?? null,
  systemdAnalyzeIdentity: systemdAnalyzeBefore?.endpointIdentity ?? null,
  unit: managerBefore.unit,
  fragmentPath: fragmentBefore.path,
  fragmentSha256: fragmentBefore.sha256,
  fragmentIdentity: fragmentBefore.endpointIdentity,
  fragmentSourcePath: fragmentSourceBefore.path,
  fragmentSourceSha256: fragmentSourceBefore.sha256,
  fragmentSourceIdentity: fragmentSourceBefore.endpointIdentity,
  dropInPaths: managerBefore.dropInPaths,
  dropInState: proofDropInBefore === null ? 'NONE' : 'EXACT_STAGING_PROOF',
  proofDropInPath: proofDropInBefore?.path ?? null,
  proofDropInSha256: proofDropInBefore?.sha256 ?? null,
  proofDropInIdentity: proofDropInBefore?.endpointIdentity ?? null,
  proofDropInOwner: proofDropInBefore === null
    ? 'NONE'
    : proofDropInBefore.identity.uid === '0' ? 'ROOT' : 'INVOKING_TEST_OWNER',
  proofDropInRuntimeLinkPath: proofDropInRuntimeLinkBefore?.path ?? null,
  proofDropInRuntimeLinkIdentity:
    proofDropInRuntimeLinkBefore?.endpointIdentity ?? null,
  proofAbsentSentinel,
  needDaemonReload: managerBefore.needDaemonReload,
  user: managerBefore.user,
  group: managerBefore.group,
  workingDirectory: managerBefore.workingDirectory,
  environmentFiles: managerBefore.environmentFiles,
  unsetEnvironment: managerBefore.unsetEnvironment,
  unsetEnvironmentSha256: managerBefore.unsetEnvironmentSha256,
  namespaceRemapState: managerBefore.namespaceRemapState,
  executionAuthorityState: managerBefore.executionAuthorityState,
  environmentAuthorityState: managerBefore.environmentAuthorityState,
  identityAuthorityState: managerBefore.identityAuthorityState,
  authorityClosureSha256: managerBefore.authorityClosureSha256,
  effectReachability: managerBefore.effectReachability,
  runtimeEnvPath: runtimeEnvBefore.path,
  runtimeEnvSha256: runtimeEnvBefore.sha256,
  runtimeEnvIdentity: runtimeEnvBefore.endpointIdentity,
  execStartPath: managerBefore.execStart.path,
  execStartArgv: managerBefore.execStart.argv,
  execStartSha256: managerBefore.execStartSha256,
});
const bindingSha256 = createHash('sha256').update(canonicalJson(binding)).digest('hex');
if (args['expected-binding-sha256'] !== undefined
    && bindingSha256 !== args['expected-binding-sha256']) {
  fail('app unit differs from the authorized binding');
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 3,
  status: 'APP_UNIT_BINDING_VERIFIED',
  inspectionMode: binding.inspectionMode,
  systemctlPath: systemctlBefore.path,
  offlineUnitRoot: binding.offlineUnitRoot,
  systemdAnalyzePath: systemdAnalyzeBefore?.path ?? null,
  systemdAnalyzeSha256: systemdAnalyzeBefore?.sha256 ?? null,
  systemdAnalyzeIdentity: systemdAnalyzeBefore?.identity ?? null,
  systemdAnalyzeEndpointIdentity: binding.systemdAnalyzeIdentity,
  unit: managerBefore.unit,
  fragmentPath: fragmentBefore.path,
  fragmentSha256: fragmentBefore.sha256,
  fragmentIdentity: fragmentBefore.identity,
  fragmentEndpointIdentity: fragmentBefore.endpointIdentity,
  fragmentSourcePath: fragmentSourceBefore.path,
  fragmentSourceSha256: fragmentSourceBefore.sha256,
  fragmentSourceIdentity: fragmentSourceBefore.identity,
  fragmentSourceEndpointIdentity: fragmentSourceBefore.endpointIdentity,
  dropInPaths: managerBefore.dropInPaths,
  dropInState: binding.dropInState,
  proofDropInPath: binding.proofDropInPath,
  proofDropInSha256: binding.proofDropInSha256,
  proofDropInIdentity: proofDropInBefore?.identity ?? null,
  proofDropInEndpointIdentity: binding.proofDropInIdentity,
  proofDropInOwner: binding.proofDropInOwner,
  proofDropInRuntimeLinkPath: binding.proofDropInRuntimeLinkPath,
  proofDropInRuntimeLinkIdentity: proofDropInRuntimeLinkBefore?.identity ?? null,
  proofDropInRuntimeLinkEndpointIdentity:
    binding.proofDropInRuntimeLinkIdentity,
  proofAbsentSentinel: binding.proofAbsentSentinel,
  needDaemonReload: managerBefore.needDaemonReload,
  user: managerBefore.user,
  group: managerBefore.group,
  workingDirectory: managerBefore.workingDirectory,
  environmentFiles: managerBefore.environmentFiles,
  unsetEnvironment: managerBefore.unsetEnvironment,
  unsetEnvironmentSha256: managerBefore.unsetEnvironmentSha256,
  namespaceRemapState: managerBefore.namespaceRemapState,
  executionAuthorityState: managerBefore.executionAuthorityState,
  environmentAuthorityState: managerBefore.environmentAuthorityState,
  identityAuthorityState: managerBefore.identityAuthorityState,
  authorityClosureSha256: managerBefore.authorityClosureSha256,
  effectReachability: managerBefore.effectReachability,
  runtimeEnvPath: runtimeEnvBefore.path,
  runtimeEnvSha256: runtimeEnvBefore.sha256,
  runtimeEnvIdentity: runtimeEnvBefore.identity,
  runtimeEnvEndpointIdentity: runtimeEnvBefore.endpointIdentity,
  execStart: managerBefore.execStart,
  execStartSha256: managerBefore.execStartSha256,
  bindingSha256,
})}\n`);
