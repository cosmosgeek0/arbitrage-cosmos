#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync,
  readdirSync, realpathSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, relative, resolve, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inspectPrivateDirectoryEvidence,
  privateDirectoryIdentityEndpoint,
  providerMaterializationWriteRoots,
  readCanonicalDeploymentDocument,
  validateAuthorizationConsumption,
  validateDeploymentActionPreview,
  validateDeploymentRiskVersion,
} from '../deployment-authorization-contract.mjs';
import {
  fail, parseArgs, requireExactKeys, typedTreeDigest,
} from '../lib.mjs';
import { SYSTEM_OPS_HELPER_PARENT } from '../ops-helper-root.mjs';
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
const PROVIDER_SHOW_PROPERTIES = Object.freeze([
  ...SHOW_PROPERTIES,
  'RemainAfterExit',
  'Restart',
  'SyslogIdentifier',
  'ProtectSystem',
  'ProtectHome',
  'PrivateTmp',
  'PrivateDevices',
  'ProtectKernelTunables',
  'ProtectKernelModules',
  'ProtectControlGroups',
  'RestrictSUIDSGID',
  'RestrictAddressFamilies',
  'UMask',
  'ActiveState',
  'SubState',
  'Result',
  'ExecMainCode',
  'ExecMainStatus',
]);
const EXPECTED_LEASE = 'DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases';
const EXPECTED_OFFLINE_ENTRYPOINT = 'server/dist/index.js';
const EXPECTED_USER = 'cosmos';
const EXPECTED_GROUP = 'cosmos';
const EXPECTED_WORKING_DIRECTORY = '/opt/cosmos/current';
const PRODUCTION_UNIT = 'cosmos-app.service';
const PRODUCTION_FRAGMENT = '/etc/systemd/system/cosmos-app.service';
const PRODUCTION_RUNTIME_ENV = '/etc/cosmos/cosmos-app.env';
const PRODUCTION_I00_ENV = '/etc/cosmos/cosmos-i00.env';
const PRODUCTION_DROP_IN_ROOT = '/etc/systemd/system/cosmos-app.service.d';
const PROVIDER_UNIT = 'cosmos-secrets-provider.service';
const PROVIDER_FRAGMENT = '/etc/systemd/system/cosmos-secrets-provider.service';
const PROVIDER_CREDENTIAL = 'app-secrets:/run/cosmos-secret-source/app-secrets.json';
const PROVIDER_DROP_IN_BYTES = Buffer.from([
  '# Provider-only drop-in for the accepted cosmos-app.service.',
  '# The absolute LoadCredential source is fatal when missing; no silent fallback.',
  '# Execution and EnvironmentFile directives belong to the preserved application',
  '# overlays and must not be replaced by this provider-binding contract.',
  '[Unit]',
  `Requires=${PROVIDER_UNIT}`,
  `After=${PROVIDER_UNIT}`,
  '',
  '[Service]',
  `LoadCredential=${PROVIDER_CREDENTIAL}`,
  '',
].join('\n'));
const LOGGING_DROP_IN_BYTES = Buffer.from([
  '# Dedicated staging logging overlay for cosmos-app.service.',
  '#',
  '# Node console output is physical-line priority-prefixed in production:',
  '# material log=<5>, routine info=<6>, routine debug=<7>, warning=<4>,',
  '# error=<3>. console.log and the protected audit/money/security API bypass',
  '# the application limiter.',
  '#',
  '# The accepted base unit\'s per-unit journal bucket is deliberately disabled',
  '# here: systemd drops later messages after a unit exhausts that bucket, which',
  '# could hide protected evidence. Application code bounds routine output before',
  '# journald; systemd keeps every warning, error, and protected record.',
  '[Service]',
  'SyslogLevelPrefix=yes',
  'LogLevelMax=info',
  'LogRateLimitIntervalSec=0',
  'LogRateLimitBurst=0',
  '',
].join('\n'));
const PROVIDER_BOUND_DROP_IN_COUNT = 3;
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

function runtimeDropInBytes() {
  return Buffer.from([
    '# Preserved execution/environment overlay for the accepted cosmos-app.service.',
    '# This is packaged as the recovery/source contract for the existing runtime',
    '# overlay. The provider-only overlay must not reset or replace these directives.',
    '[Service]',
    'ExecStart=',
    '# F-021: the replacement ExecStart must re-carry DATA_DIR_LOGICAL_LEASE_ROOT.',
    '# The base unit\'s EnvironmentFile still supplies NODE_ENV=production, so',
    '# dropping the env prefix arms DATA_DIR_LOGICAL_LEASE_ROOT_REQUIRED at boot.',
    '# Never move this key into cosmos-i00.env: EnvironmentFile overriding',
    '# Environment is the exact hazard test-systemd-units.sh:46 exists to prevent.',
    `ExecStart=${args.env} ${EXPECTED_LEASE} ${args.node} ${opsHelperAppEntrypoint}`,
    `EnvironmentFile=${boundSystemPath(PRODUCTION_I00_ENV)}`,
    '',
  ].join('\n'));
}

const args = parseArgs(process.argv.slice(2));
const allowedArguments = new Set([
  'systemctl', 'unit', 'node', 'env', 'runtime-env',
  'provenance-mode', 'systemd-analyze', 'offline-unit-root',
  'expected-fragment-path', 'expected-fragment-source', 'staging-root',
  'proof-drop-in', 'proof-drop-in-runtime-link', 'proof-absent-sentinel',
  'expected-binding-sha256', 'test-provider-bound-root',
  'ops-helper-root', 'ops-helper-tree-sha256', 'ops-helper-app-entrypoint',
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
const helperArgumentNames = [
  'ops-helper-root', 'ops-helper-tree-sha256', 'ops-helper-app-entrypoint',
];
const helperArgumentCount = helperArgumentNames
  .filter((name) => args[name] !== undefined).length;
if (helperArgumentCount !== 0 && helperArgumentCount !== helperArgumentNames.length) {
  fail('ops helper binding arguments must be complete or absent');
}
if ((args['provenance-mode'] === 'SYSTEM'
      || args['test-provider-bound-root'] !== undefined)
    && helperArgumentCount !== helperArgumentNames.length) {
  fail('provider-bound inspection requires the exact ops helper binding');
}
if (helperArgumentCount === 0) {
  const isolatedRoot = exactLexicalAbsolute(
    args['staging-root'],
    '--staging-root',
  );
  args['ops-helper-tree-sha256'] = '0'.repeat(64);
  args['ops-helper-root'] = resolve(
    isolatedRoot,
    'install',
    `i00-${'0'.repeat(40)}-${args['ops-helper-tree-sha256']}`,
  );
  args['ops-helper-app-entrypoint'] = resolve(
    args['ops-helper-root'],
    'bin/app-entrypoint.mjs',
  );
}
if (!DIGEST.test(args['ops-helper-tree-sha256'])) {
  fail('--ops-helper-tree-sha256 must be lowercase SHA-256');
}
const opsHelperRoot = exactLexicalAbsolute(
  args['ops-helper-root'],
  '--ops-helper-root',
);
const opsHelperAppEntrypoint = exactLexicalAbsolute(
  args['ops-helper-app-entrypoint'],
  '--ops-helper-app-entrypoint',
);
const opsHelperSecretMaterialization = resolve(
  opsHelperRoot,
  'bin/secret-materialization.mjs',
);
if (opsHelperAppEntrypoint !== resolve(opsHelperRoot, 'bin/app-entrypoint.mjs')) {
  fail('ops helper app entrypoint escaped the exact helper root');
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
let providerBoundMode = false;
let providerFilesystemRoot = null;
if (args['test-provider-bound-root'] !== undefined) {
  if (args['provenance-mode'] !== 'TEST'
      || args['staging-root'] !== undefined
      || args['proof-drop-in'] !== undefined
      || args['proof-drop-in-runtime-link'] !== undefined
      || args['proof-absent-sentinel'] !== undefined
      || args['systemd-analyze'] !== undefined
      || args['offline-unit-root'] !== undefined) {
    fail('test provider-bound inspection accepts only one marked simulation root and no staging proof inputs');
  }
  providerFilesystemRoot = exactDirectory(
    args['test-provider-bound-root'],
    '--test-provider-bound-root',
  );
  try {
    if (validateSimulationRoot(providerFilesystemRoot) !== providerFilesystemRoot) {
      fail('test provider-bound root differs from the marked simulation root');
    }
  } catch {
    fail('test provider-bound inspection requires one exact marked simulation root');
  }
  stagingRoot = providerFilesystemRoot;
  const expectedFragment = resolve(
    providerFilesystemRoot,
    PRODUCTION_FRAGMENT.slice(1),
  );
  const expectedRuntimeEnv = resolve(
    providerFilesystemRoot,
    PRODUCTION_RUNTIME_ENV.slice(1),
  );
  if (args.unit !== PRODUCTION_UNIT
      || args['expected-fragment-path'] !== expectedFragment
      || args['runtime-env'] !== expectedRuntimeEnv
      || !isWithin(providerFilesystemRoot, args.systemctl)
      || !isWithin(providerFilesystemRoot, args['expected-fragment-source'])) {
    fail('test provider-bound unit, manager, fragment, source, or runtime environment is outside the exact simulation layout');
  }
  providerBoundMode = true;
} else if (args['staging-root'] !== undefined) {
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
} else {
  providerBoundMode = true;
}

if (providerBoundMode) {
  if (dirname(opsHelperRoot) !== SYSTEM_OPS_HELPER_PARENT) {
    fail('provider-bound ops helper root must use the canonical production parent');
  }
} else if (stagingRoot === null
    || dirname(opsHelperRoot) !== resolve(stagingRoot, 'install')) {
  fail('isolated ops helper root must use the proof-root install parent');
}

function boundSystemPath(path) {
  return providerFilesystemRoot === null
    ? path
    : resolve(providerFilesystemRoot, path.slice(1));
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
  if (providerBoundMode) {
    const dropInRoot = boundSystemPath(PRODUCTION_DROP_IN_ROOT);
    if (dropInPaths.length !== PROVIDER_BOUND_DROP_IN_COUNT
        || new Set(dropInPaths).size !== dropInPaths.length) {
      fail('provider-bound app unit must expose exactly three unique preserved and provider drop-ins');
    }
    for (const path of dropInPaths) {
      if (dirname(path) !== dropInRoot
          || !/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,254}\.conf$/u.test(path.slice(dropInRoot.length + 1))) {
        fail('provider-bound app unit has a drop-in outside the exact production drop-in directory');
      }
    }
  } else if (dropInPaths.length !== 1
      || dropInPaths[0] !== proofDropInRuntimeLink) {
    fail('app unit must load only the exact isolated staging proof drop-in');
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
    'LoadCredentialEncrypted', 'ImportCredential',
  ]) {
    if (properties[name] !== '') {
      fail(`app unit ${name} must be empty`);
    }
  }
  if (properties.LoadCredential !== (providerBoundMode ? PROVIDER_CREDENTIAL : '')) {
    fail(providerBoundMode
      ? 'provider-bound app unit LoadCredential differs from the exact absolute source'
      : 'isolated app unit LoadCredential must be empty');
  }
  if (providerBoundMode) {
    const providerEdges = Object.fromEntries(
      [
        'Requires', 'Wants', 'Requisite', 'BindsTo', 'PartOf', 'After', 'Before',
        'Conflicts', 'OnFailure', 'OnSuccess', 'PropagatesStopTo',
        'StopPropagatedFrom', 'PropagatesReloadTo', 'ReloadPropagatedFrom',
        'Upholds', 'JoinsNamespaceOf',
      ].map((name) => [
        name,
        properties[name].split(' ').filter((entry) => entry === PROVIDER_UNIT),
      ]),
    );
    if (providerEdges.Requires.length !== 1 || providerEdges.After.length !== 1
        || Object.entries(providerEdges).some(([name, values]) => (
          !['Requires', 'After'].includes(name) && values.length !== 0
        ))) {
      fail('provider-bound app unit dependency and ordering edges are not exact');
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
  const expectedEnvironmentFiles = providerBoundMode
    ? [
      `${args['runtime-env']} (ignore_errors=no)`,
      `${boundSystemPath(PRODUCTION_I00_ENV)} (ignore_errors=no)`,
    ]
    : [`${args['runtime-env']} (ignore_errors=no)`];
  if (canonicalJson(environmentFiles) !== canonicalJson(expectedEnvironmentFiles)) {
    fail(providerBoundMode
      ? 'provider-bound app unit must preserve both exact ordered non-optional EnvironmentFiles'
      : 'isolated app unit must use the sole exact non-optional runtime EnvironmentFile');
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
    providerBoundMode ? opsHelperAppEntrypoint : EXPECTED_OFFLINE_ENTRYPOINT,
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
    environmentFiles: Object.freeze(
      (providerBoundMode
        ? [args['runtime-env'], boundSystemPath(PRODUCTION_I00_ENV)]
        : [args['runtime-env']])
        .map((path) => Object.freeze({ path, optional: false })),
    ),
    unsetEnvironment: Object.freeze([...EXPECTED_UNSET_ENVIRONMENT].sort()),
    unsetEnvironmentSha256: createHash('sha256')
      .update(canonicalJson([...EXPECTED_UNSET_ENVIRONMENT].sort()))
      .digest('hex'),
    namespaceRemapState: 'NONE',
    executionAuthorityState: 'CLOSED',
    environmentAuthorityState: providerBoundMode
      ? 'EXACT_PROVIDER_CREDENTIAL'
      : 'CLOSED',
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
    EXPECTED_OFFLINE_ENTRYPOINT,
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
      EXPECTED_OFFLINE_ENTRYPOINT,
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

function parseManagerPropertyOutput(stdout, expectedProperties, label) {
  if (typeof stdout !== 'string' || stdout.length === 0 || stdout.length > 128 * 1024
      || stdout.includes('\0') || !stdout.endsWith('\n')) {
    fail(`${label} systemctl show returned malformed output`);
  }
  const propertyLines = expectedProperties.includes('EnvironmentFiles')
    ? { EnvironmentFiles: [] }
    : {};
  for (const line of stdout.slice(0, -1).split('\n')) {
    const split = line.indexOf('=');
    if (split <= 0) fail(`${label} systemctl show returned one malformed property`);
    const key = line.slice(0, split);
    if (!expectedProperties.includes(key)) {
      fail(`${label} systemctl show returned an unexpected property`);
    }
    if (!Object.hasOwn(propertyLines, key)) propertyLines[key] = [];
    propertyLines[key].push(line.slice(split + 1));
  }
  requireExactKeys(propertyLines, expectedProperties, `${label} systemctl show properties`);
  for (const [key, values] of Object.entries(propertyLines)) {
    if (key !== 'EnvironmentFiles' && values.length !== 1) {
      fail(`${label} systemctl show returned duplicate ${key} properties`);
    }
  }
  return Object.freeze({
    propertyLines: Object.freeze(propertyLines),
    properties: Object.freeze(Object.fromEntries(
      Object.entries(propertyLines).map(([key, values]) => [key, values[0]]),
    )),
  });
}

function parseManagerExec(raw, label) {
  const match = /^\{ path=([^ ;{}]+) ; argv\[\]=([^;{}]+) ; ignore_errors=no ; start_time=\[([^\]\r\n]*)\] ; stop_time=\[([^\]\r\n]*)\] ; pid=([0-9]+) ; code=([^ ;{}]+) ; status=([^ ;{}]+) \}$/u
    .exec(raw);
  if (match === null || raw.indexOf('{ path=') !== 0 || raw.indexOf('{ path=', 1) !== -1) {
    fail(`${label} ExecStart is not one exact closed command`);
  }
  return Object.freeze({
    path: exactLexicalAbsolute(match[1], `${label} ExecStart path`),
    argv: Object.freeze(match[2].split(' ')),
  });
}

function parseManagerExecEx(raw, label) {
  const match = /^\{ path=([^ ;{}]+) ; argv\[\]=([^;{}]+) ; flags=([^;{}]*) ; start_time=\[([^\]\r\n]*)\] ; stop_time=\[([^\]\r\n]*)\] ; pid=([0-9]+) ; code=([^ ;{}]+) ; status=([^ ;{}]+) \}$/u
    .exec(raw);
  if (match === null || match[3] !== ''
      || raw.indexOf('{ path=') !== 0 || raw.indexOf('{ path=', 1) !== -1) {
    fail(`${label} ExecStartEx is not one exact closed command`);
  }
  return Object.freeze({
    path: exactLexicalAbsolute(match[1], `${label} ExecStartEx path`),
    argv: Object.freeze(match[2].split(' ')),
  });
}

function exactDirectiveObject(directives, section, expectedKeys, label) {
  const value = directives[section];
  if (value === undefined || value === null || typeof value !== 'object') {
    fail(`${label} is missing [${section}]`);
  }
  requireExactKeys(value, expectedKeys, `${label} [${section}]`);
  return value;
}

function exactDirectiveValues(section, name, expected, label) {
  const actual = section[name];
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} ${name} differs from the exact provider contract`);
  }
}

function exactProviderDocument(raw, label) {
  const path = exactLexicalAbsolute(raw, label);
  if (dirname(path) !== '/var/lib/cosmos-deployment-authorization'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/u.test(path.slice(
        '/var/lib/cosmos-deployment-authorization/'.length,
      ))) {
    fail(`${label} must be one exact deployment-authorization document`);
  }
  return path;
}

function exactProviderWritePath(raw, label) {
  const path = exactLexicalAbsolute(raw, label);
  if ([
    '/', '/etc', '/opt', '/run', '/usr', '/var', '/var/lib',
    '/var/lib/cosmos', '/var/backups', '/var/backups/cosmos',
  ].includes(path)) {
    fail(`${label} must not grant one broad production write root`);
  }
  return path;
}

function providerEvidencePath(logical, kind) {
  if (providerFilesystemRoot === null) return logical;
  if (kind === 'authorization-document'
      && dirname(logical) === '/var/lib/cosmos-deployment-authorization') {
    return resolve(providerFilesystemRoot, 'authorization', basename(logical));
  }
  if (kind === 'consumption-root'
      && logical === '/var/lib/cosmos-authorization-consumption') {
    return resolve(providerFilesystemRoot, 'consumption');
  }
  fail(`provider ${kind} path cannot be mapped into the marked simulation root`);
}

function inspectProviderMaterializationChain(contract) {
  const risk = readCanonicalDeploymentDocument(
    providerEvidencePath(contract.deploymentRisk, 'authorization-document'),
    'provider deployment risk',
    validateDeploymentRiskVersion,
  );
  const preview = readCanonicalDeploymentDocument(
    providerEvidencePath(contract.actionPreview, 'authorization-document'),
    'provider action preview',
    (document) => validateDeploymentActionPreview(
      document,
      risk.document,
      risk.sha256,
    ),
  );
  const testMode = providerFilesystemRoot !== null;
  if (risk.document.binding.actionClass !== 'SECRET_MATERIALIZATION'
      || preview.document.binding.actionClass !== 'SECRET_MATERIALIZATION'
      || preview.document.action.command !== 'secrets-provider'
      || preview.document.action.scope
        !== 'cosmos-production-secret-materialization'
      || risk.document.artifactPolicy.rootMode !== (testMode ? 'TEST' : 'SYSTEM')
      || risk.document.provenanceMode !== (testMode
        ? 'TEST_FIXTURE_INJECTED'
        : 'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE')
      || (testMode
        ? risk.document.artifactPolicy.proofRoot !== providerFilesystemRoot
        : risk.document.artifactPolicy.proofRoot !== 'NONE')) {
    fail('provider documents do not describe the exact materialization action');
  }
  const expectedAuthorizationRoot = testMode
    ? resolve(providerFilesystemRoot, 'authorization')
    : '/var/lib/cosmos-deployment-authorization';
  const expectedConsumptionRoot = providerEvidencePath(
    contract.authorizationConsumptionRoot,
    'consumption-root',
  );
  if (dirname(risk.absolute) !== expectedAuthorizationRoot
      || dirname(preview.absolute) !== expectedAuthorizationRoot
      || risk.document.artifactPolicy.authorizationRoot
        !== expectedAuthorizationRoot
      || preview.document.artifactPolicy.authorizationRoot
        !== expectedAuthorizationRoot
      || risk.document.artifactPolicy.consumptionRoot
        !== expectedConsumptionRoot
      || preview.document.singleUse.consumptionRoot
        !== expectedConsumptionRoot
      || risk.document.artifactPolicy.consumptionRootIdentity
        !== preview.document.singleUse.consumptionRootIdentity) {
    fail('provider documents differ from their exact artifact roots');
  }
  const consumptionRoot = inspectPrivateDirectoryEvidence(
    expectedConsumptionRoot,
    'provider authorization consumption root',
  );
  const consumptionRootIdentity = privateDirectoryIdentityEndpoint(consumptionRoot);
  if (consumptionRootIdentity
      !== preview.document.singleUse.consumptionRootIdentity) {
    fail('provider authorization consumption root identity changed');
  }
  const consumption = readCanonicalDeploymentDocument(
    resolve(
      consumptionRoot.absolute,
      `${preview.document.singleUse.claimKey}.json`,
    ),
    'provider authorization consumption',
    validateAuthorizationConsumption,
  );
  const exactConsumption = Object.freeze({
    claimKey: preview.document.singleUse.claimKey,
    authorizationId: risk.document.binding.authorizationId,
    actionClass: 'SECRET_MATERIALIZATION',
    nonce: risk.document.binding.nonce,
    riskVersion: risk.document.riskVersion,
    serverPreviewDigest: preview.document.serverPreviewDigest,
    rootMode: risk.document.artifactPolicy.rootMode,
    consumptionRoot: consumptionRoot.absolute,
    consumptionRootIdentity,
    evidenceValidUntilUtc: risk.document.evidenceValidUntilUtc,
    riskDocumentSha256: risk.sha256,
    previewDocumentSha256: preview.sha256,
  });
  for (const [name, value] of Object.entries(exactConsumption)) {
    if (consumption.document[name] !== value) {
      fail(`provider authorization consumption ${name} differs from the chain`);
    }
  }
  const consumedAt = Date.parse(consumption.document.consumedAtUtc);
  if (!DIGEST.test(consumption.document.authorizationSha256)
      || consumedAt < Date.parse(risk.document.authorizationWindow.startsAtUtc)
      || consumedAt >= Date.parse(risk.document.authorizationWindow.expiresAtUtc)) {
    fail('provider authorization consumption is not one in-window claim');
  }
  const descriptorBinding = Object.freeze({
    deploymentRisk: Object.freeze({
      logicalPath: contract.deploymentRisk,
      resolvedPath: risk.absolute,
      sha256: risk.sha256,
      identity: risk.identity,
    }),
    actionPreview: Object.freeze({
      logicalPath: contract.actionPreview,
      resolvedPath: preview.absolute,
      sha256: preview.sha256,
      identity: preview.identity,
    }),
    authorizationConsumption: Object.freeze({
      resolvedPath: consumption.absolute,
      sha256: consumption.sha256,
      identity: consumption.identity,
      claimKey: consumption.document.claimKey,
      consumedAtUtc: consumption.document.consumedAtUtc,
      authorizationSha256: consumption.document.authorizationSha256,
    }),
    consumptionRoot: Object.freeze({
      logicalPath: contract.authorizationConsumptionRoot,
      resolvedPath: consumptionRoot.absolute,
      identity: consumptionRootIdentity,
    }),
    writeRoots: providerMaterializationWriteRoots(
      risk.document.artifactPolicy,
    ),
  });
  return Object.freeze({
    ...descriptorBinding,
    chainSha256: createHash('sha256')
      .update(canonicalJson(descriptorBinding))
      .digest('hex'),
  });
}

function validateProviderFragment(fragment) {
  const directives = parseOfflineUnit(fragment.bytes);
  requireExactKeys(directives, ['Unit', 'Service', 'Install'], 'provider unit fragment');
  const unit = exactDirectiveObject(
    directives,
    'Unit',
    ['Description', 'Wants', 'After', 'Before'],
    'provider unit fragment',
  );
  exactDirectiveValues(
    unit,
    'Description',
    ['Cosmos exact-ARN Secrets Manager credential materialization'],
    'provider unit fragment',
  );
  exactDirectiveValues(unit, 'Wants', ['network-online.target'], 'provider unit fragment');
  exactDirectiveValues(unit, 'After', ['network-online.target'], 'provider unit fragment');
  exactDirectiveValues(unit, 'Before', [PRODUCTION_UNIT], 'provider unit fragment');

  const service = exactDirectiveObject(
    directives,
    'Service',
    [
      'Type', 'User', 'Group', 'RuntimeDirectory', 'RuntimeDirectoryMode',
      'RuntimeDirectoryPreserve', 'UnsetEnvironment', 'ExecStart', 'RemainAfterExit',
      'Restart', 'StandardOutput', 'StandardError', 'SyslogIdentifier',
      'NoNewPrivileges', 'ProtectSystem', 'ProtectHome', 'PrivateTmp',
      'PrivateDevices', 'ProtectKernelTunables', 'ProtectKernelModules',
      'ProtectControlGroups', 'RestrictSUIDSGID', 'RestrictAddressFamilies',
      'ReadWritePaths', 'ReadOnlyPaths', 'UMask',
    ],
    'provider unit fragment',
  );
  const exactSingles = Object.freeze({
    Type: 'oneshot',
    User: 'root',
    Group: 'root',
    RuntimeDirectory: 'cosmos-secret-source',
    RuntimeDirectoryMode: '0700',
    RuntimeDirectoryPreserve: 'restart',
    RemainAfterExit: 'yes',
    Restart: 'no',
    StandardOutput: 'journal',
    StandardError: 'journal',
    SyslogIdentifier: 'cosmos-secrets-provider',
    NoNewPrivileges: 'yes',
    ProtectSystem: 'strict',
    ProtectHome: 'yes',
    PrivateTmp: 'yes',
    PrivateDevices: 'yes',
    ProtectKernelTunables: 'yes',
    ProtectKernelModules: 'yes',
    ProtectControlGroups: 'yes',
    RestrictSUIDSGID: 'yes',
    RestrictAddressFamilies: 'AF_UNIX AF_INET AF_INET6',
    UMask: '0077',
  });
  for (const [name, value] of Object.entries(exactSingles)) {
    exactDirectiveValues(service, name, [value], 'provider unit fragment');
  }
  const unsetEnvironment = service.UnsetEnvironment
    .flatMap((value) => value.split(' ').filter(Boolean));
  if (unsetEnvironment.length !== EXPECTED_UNSET_ENVIRONMENT.length
      || new Set(unsetEnvironment).size !== unsetEnvironment.length
      || [...unsetEnvironment].sort().join('\0')
        !== [...EXPECTED_UNSET_ENVIRONMENT].sort().join('\0')) {
    fail('provider unit fragment UnsetEnvironment differs from the complete closure');
  }
  if (service.ExecStart.length !== 1 || /[\r\n\0]/u.test(service.ExecStart[0])) {
    fail('provider unit fragment ExecStart is not one canonical command');
  }
  const argv = service.ExecStart[0].split(' ');
  if (argv.length !== 10
      || argv[0] !== '/usr/bin/node'
      || argv[1] !== opsHelperSecretMaterialization
      || argv[2] !== '--authorization'
      || argv[3] !== '/etc/cosmos/external-authorization.json'
      || argv[4] !== '--deployment-risk'
      || argv[6] !== '--action-preview'
      || argv[8] !== '--authorization-consumption-root'
      || argv[9] !== '/var/lib/cosmos-authorization-consumption') {
    fail('provider unit fragment ExecStart differs from the exact bound materializer shape');
  }
  // These paths bind the already-completed SECRET_MATERIALIZATION invocation
  // represented by the active/exited provider. They deliberately remain
  // distinct from a pending release/rollback risk and preview document.
  const deploymentRisk = exactProviderDocument(
    argv[5],
    'provider deployment-risk document',
  );
  const actionPreview = exactProviderDocument(
    argv[7],
    'provider action-preview document',
  );
  if (deploymentRisk === actionPreview) {
    fail('provider deployment-risk and action-preview documents must be distinct');
  }
  const materializationChain = inspectProviderMaterializationChain({
    deploymentRisk,
    actionPreview,
    authorizationConsumptionRoot: argv[9],
  });
  const readWritePaths = service.ReadWritePaths.map(
    (path, index) => exactProviderWritePath(path, `provider ReadWritePaths[${index}]`),
  );
  if (canonicalJson(readWritePaths)
      !== canonicalJson(materializationChain.writeRoots)) {
    fail('provider unit fragment write authority is not the exact document-derived four-path closure');
  }
  exactDirectiveValues(
    service,
    'ReadOnlyPaths',
    [
      '/var/lib/cosmos-deployment-authorization',
      '/etc/cosmos /usr/local/lib/cosmos-ops',
    ],
    'provider unit fragment',
  );
  const install = exactDirectiveObject(
    directives,
    'Install',
    ['WantedBy'],
    'provider unit fragment',
  );
  exactDirectiveValues(install, 'WantedBy', ['multi-user.target'], 'provider unit fragment');
  return Object.freeze({
    directives,
    execStart: Object.freeze({
      path: argv[0],
      argv: Object.freeze(argv),
    }),
    deploymentRisk,
    actionPreview,
    authorizationConsumptionRoot: argv[9],
    materializationChain,
    readWritePaths: Object.freeze(readWritePaths),
  });
}

function inspectProviderManager(systemctl) {
  const result = spawnSync(systemctl.path, [
    'show',
    PROVIDER_UNIT,
    '--no-pager',
    '--all',
    ...PROVIDER_SHOW_PROPERTIES.map((property) => `--property=${property}`),
  ], {
    encoding: 'utf8',
    env: CLOSED_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== '') {
    fail(`bound systemctl provider unit inspection failed at exit ${String(result.status)}`);
  }
  const parsed = parseManagerPropertyOutput(
    result.stdout,
    PROVIDER_SHOW_PROPERTIES,
    'provider unit',
  );
  const { properties, propertyLines } = parsed;
  if (properties.Id !== PROVIDER_UNIT
      || properties.Names !== PROVIDER_UNIT
      || properties.Following !== ''
      || properties.LoadState !== 'loaded'
      || properties.FragmentPath !== boundSystemPath(PROVIDER_FRAGMENT)
      || properties.DropInPaths !== ''
      || properties.NeedDaemonReload !== 'no') {
    fail('provider unit manager identity, fragment, drop-in, or reload state is not exact');
  }
  if (properties.User !== 'root' || properties.Group !== 'root'
      || properties.Type !== 'oneshot' || properties.RemainAfterExit !== 'yes'
      || properties.Restart !== 'no') {
    fail('provider unit process identity or oneshot lifecycle is not exact');
  }
  if (properties.ActiveState !== 'active'
      || properties.SubState !== 'exited'
      || properties.Result !== 'success'
      || properties.ExecMainCode !== '1'
      || properties.ExecMainStatus !== '0') {
    fail('provider unit must already be one successful active/exited oneshot');
  }
  for (const name of [
    'Environment', 'PassEnvironment', 'SetCredential', 'SetCredentialEncrypted',
    'LoadCredential', 'LoadCredentialEncrypted', 'ImportCredential',
  ]) {
    if (properties[name] !== '') {
      fail(`provider unit ${name} must be empty`);
    }
  }
  if (propertyLines.EnvironmentFiles.length !== 0) {
    fail('provider unit EnvironmentFiles must be empty');
  }
  const beforeEdges = properties.Before.split(' ').filter((entry) => entry === PRODUCTION_UNIT);
  if (beforeEdges.length !== 1) {
    fail('provider unit must order before the exact application unit once');
  }
  for (const name of [
    'Requires', 'Requisite', 'BindsTo', 'PartOf', 'Conflicts', 'OnFailure',
    'OnSuccess', 'PropagatesStopTo', 'StopPropagatedFrom', 'PropagatesReloadTo',
    'ReloadPropagatedFrom', 'Upholds', 'JoinsNamespaceOf',
  ]) {
    if (properties[name].split(' ').filter((entry) => entry === PRODUCTION_UNIT).length !== 0) {
      fail(`provider unit ${name} must not target the application unit`);
    }
  }
  const execStart = parseManagerExec(properties.ExecStart, 'provider unit');
  const execStartEx = parseManagerExecEx(properties.ExecStartEx, 'provider unit');
  if (canonicalJson(execStartEx) !== canonicalJson(execStart)) {
    fail('provider unit ExecStart and ExecStartEx differ');
  }
  return Object.freeze({
    unit: properties.Id,
    fragmentPath: properties.FragmentPath,
    dropInPaths: Object.freeze([]),
    needDaemonReload: properties.NeedDaemonReload,
    execStart,
    properties: Object.freeze(Object.fromEntries(
      Object.entries(properties).map(([name, value]) => [
        name,
        [
          'Names', 'Requires', 'Wants', 'Requisite', 'BindsTo', 'PartOf',
          'After', 'Before', 'Conflicts', 'OnFailure', 'OnSuccess',
          'PropagatesStopTo', 'StopPropagatedFrom', 'PropagatesReloadTo',
          'ReloadPropagatedFrom', 'Upholds', 'JoinsNamespaceOf',
          'RequiresMountsFor', 'WantsMountsFor', 'Sockets',
        ].includes(name)
          ? Object.freeze(value.split(' ').filter(Boolean).sort())
          : name === 'EnvironmentFiles'
            ? Object.freeze([...propertyLines.EnvironmentFiles])
            : value,
      ]),
    )),
  });
}

function bindProviderManager(manager, fragment, contract) {
  if (manager.fragmentPath !== fragment.path
      || manager.execStart.path !== contract.execStart.path
      || canonicalJson(manager.execStart.argv) !== canonicalJson(contract.execStart.argv)
      || canonicalJson(manager.properties.ReadWritePaths
        .split(' ').filter(Boolean)) !== canonicalJson(contract.readWritePaths)
      || canonicalJson(manager.properties.ReadOnlyPaths
        .split(' ').filter(Boolean)) !== canonicalJson([
          '/var/lib/cosmos-deployment-authorization',
          '/etc/cosmos',
          '/usr/local/lib/cosmos-ops',
        ])) {
    fail('provider unit manager state differs from the exact rendered fragment');
  }
  const exactManagerProperties = Object.freeze({
    RuntimeDirectory: 'cosmos-secret-source',
    RuntimeDirectoryMode: '700',
    RuntimeDirectoryPreserve: 'restart',
    StandardInput: 'null',
    StandardOutput: 'journal',
    StandardError: 'journal',
    NotifyAccess: 'none',
    FileDescriptorStoreMax: '0',
    FileDescriptorStorePreserve: 'no',
    SyslogIdentifier: 'cosmos-secrets-provider',
    NoNewPrivileges: 'yes',
    ProtectSystem: 'strict',
    ProtectHome: 'yes',
    PrivateTmp: 'yes',
    PrivateDevices: 'yes',
    ProtectKernelTunables: 'yes',
    ProtectKernelModules: 'yes',
    ProtectControlGroups: 'yes',
    RestrictSUIDSGID: 'yes',
    UMask: '0077',
  });
  for (const [name, value] of Object.entries(exactManagerProperties)) {
    if (manager.properties[name] !== value) {
      fail(`provider unit manager ${name} differs from the rendered fragment`);
    }
  }
  if (canonicalJson(manager.properties.RestrictAddressFamilies
    .split(' ').filter(Boolean).sort())
      !== canonicalJson(['AF_INET', 'AF_INET6', 'AF_UNIX'])) {
    fail('provider unit manager RestrictAddressFamilies differs from the rendered fragment');
  }
  const unsetEnvironment = manager.properties.UnsetEnvironment
    .split(' ').filter(Boolean).sort();
  if (canonicalJson(unsetEnvironment)
      !== canonicalJson([...EXPECTED_UNSET_ENVIRONMENT].sort())) {
    fail('provider unit manager UnsetEnvironment differs from the rendered fragment');
  }
  const binding = Object.freeze({
    unit: manager.unit,
    fragmentPath: fragment.path,
    fragmentSha256: fragment.sha256,
    fragmentIdentity: fragment.endpointIdentity,
    dropInPaths: manager.dropInPaths,
    needDaemonReload: manager.needDaemonReload,
    execStart: manager.execStart,
    deploymentRisk: contract.deploymentRisk,
    actionPreview: contract.actionPreview,
    authorizationConsumptionRoot: contract.authorizationConsumptionRoot,
    materializationChain: contract.materializationChain,
    readWritePaths: contract.readWritePaths,
    state: 'ACTIVE_EXITED_SUCCESS',
    managerProperties: manager.properties,
  });
  return Object.freeze({
    ...binding,
    bindingSha256: createHash('sha256').update(canonicalJson(binding)).digest('hex'),
  });
}

function inspectSystemDropInSet(paths) {
  const expectedOwner = providerFilesystemRoot === null
    ? '0'
    : String(typeof process.getuid === 'function' ? process.getuid() : 0);
  const inspected = paths.map((path, index) => {
    const file = inspectBoundFile(path, `provider-bound app drop-in[${index}]`, 64 * 1024);
    if (file.identity.uid !== expectedOwner) {
      fail('provider-bound app drop-ins must remain root owned');
    }
    return file;
  });
  const provider = inspected.filter((file) => file.bytes.equals(PROVIDER_DROP_IN_BYTES));
  if (provider.length !== 1) {
    fail('provider-bound app unit must load exactly one exact provider-only drop-in');
  }
  const logging = inspected.filter((file) => file.bytes.equals(LOGGING_DROP_IN_BYTES));
  if (logging.length !== 1) {
    fail('provider-bound app unit must preserve exactly one exact logging drop-in');
  }
  const runtime = inspected.filter((file) => file.bytes.equals(runtimeDropInBytes()));
  if (runtime.length !== 1) {
    fail('provider-bound app unit must preserve exactly one exact runtime drop-in');
  }
  if (new Set([provider[0], logging[0], runtime[0]]).size !== 3) {
    fail('provider-bound app drop-in roles must resolve to three distinct files');
  }
  const bindings = Object.freeze(inspected.map((file) => Object.freeze({
    role: file === provider[0]
      ? 'PROVIDER_BINDING'
      : file === logging[0] ? 'PRESERVED_LOGGING' : 'PRESERVED_RUNTIME',
    path: file.path,
    sha256: file.sha256,
    identity: file.endpointIdentity,
  })));
  const endpoint = canonicalJson(bindings);
  if (endpoint.length > 2_048) {
    fail('provider-bound app drop-in set exceeds the owner-visible authorization bound');
  }
  return Object.freeze({
    bindings,
    endpoint,
    providerPath: provider[0].path,
    sha256: createHash('sha256').update(canonicalJson(bindings)).digest('hex'),
  });
}

function combineSystemManager(
  appManager,
  dropInSet,
  i00Environment,
  providerManager,
) {
  const environmentBindings = Object.freeze([
    Object.freeze({
      path: appManager.environmentFiles[0].path,
      optional: false,
    }),
    Object.freeze({
      path: i00Environment.path,
      optional: false,
      sha256: i00Environment.sha256,
      identity: i00Environment.endpointIdentity,
    }),
  ]);
  const authorityClosure = Object.freeze({
    appAuthorityClosureSha256: appManager.authorityClosureSha256,
    dropInSetSha256: dropInSet.sha256,
    dropIns: dropInSet.bindings,
    providerDropInPath: dropInSet.providerPath,
    environmentBindings,
    providerBindingSha256: providerManager.bindingSha256,
    providerUnit: providerManager.unit,
  });
  return Object.freeze({
    ...appManager,
    authorityClosureSha256: createHash('sha256')
      .update(canonicalJson(authorityClosure))
      .digest('hex'),
    effectReachability: [
      appManager.effectReachability,
      `ProviderUnit=${providerManager.unit}`,
      `ProviderBindingSha256=${providerManager.bindingSha256}`,
      `DropInSetSha256=${dropInSet.sha256}`,
    ].join(';'),
    dropInSetSha256: dropInSet.sha256,
    dropInBindings: dropInSet.bindings,
    dropInSetEndpoint: dropInSet.endpoint,
    environmentFilesSha256: createHash('sha256')
      .update(canonicalJson(environmentBindings))
      .digest('hex'),
    providerBindingSha256: providerManager.bindingSha256,
    providerUnit: providerManager.unit,
    providerFragmentPath: providerManager.fragmentPath,
    providerFragmentSha256: providerManager.fragmentSha256,
    providerFragmentIdentity: providerManager.fragmentIdentity,
    providerState: providerManager.state,
    providerDeploymentRiskPath: providerManager.deploymentRisk,
    providerActionPreviewPath: providerManager.actionPreview,
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
const physicalOpsHelperRoot = providerBoundMode
  ? boundSystemPath(opsHelperRoot)
  : null;
const opsHelperTreeBefore = providerBoundMode
  ? typedTreeDigest(physicalOpsHelperRoot, {
    excludeTopLevel: ['accepted-ops-live', 'install-receipt.json'],
  })
  : null;
if (opsHelperTreeBefore !== null
    && opsHelperTreeBefore !== args['ops-helper-tree-sha256']) {
  fail('loaded ops helper root differs from the release-bound tree digest');
}
const opsHelperAppBefore = providerBoundMode
  ? inspectExecutable(
    boundSystemPath(opsHelperAppEntrypoint),
    'ops helper app entrypoint',
  )
  : null;
const opsHelperSecretBefore = providerBoundMode
  ? inspectExecutable(
    boundSystemPath(opsHelperSecretMaterialization),
    'ops helper secret materialization entrypoint',
  )
  : null;
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
const systemDropInSetBefore = providerBoundMode
  ? inspectSystemDropInSet(liveManagerBefore.dropInPaths)
  : null;
const i00EnvironmentBefore = providerBoundMode
  ? inspectBoundFile(
    boundSystemPath(PRODUCTION_I00_ENV),
    'provider-bound app I00 environment',
    1024 * 1024,
  )
  : null;
if (i00EnvironmentBefore !== null
    && i00EnvironmentBefore.identity.uid !== (providerFilesystemRoot === null
      ? '0'
      : String(typeof process.getuid === 'function' ? process.getuid() : 0))) {
  fail('provider-bound app I00 environment must remain root owned');
}
const providerManagerRawBefore = providerBoundMode
  ? inspectProviderManager(systemctlBefore)
  : null;
const providerFragmentBefore = providerBoundMode
  ? inspectBoundFile(
    providerManagerRawBefore.fragmentPath,
    'provider unit fragment',
    1024 * 1024,
  )
  : null;
if (providerFragmentBefore !== null
    && providerFragmentBefore.identity.uid !== (providerFilesystemRoot === null
      ? '0'
      : String(typeof process.getuid === 'function' ? process.getuid() : 0))) {
  fail('provider unit fragment must remain root owned');
}
const providerContractBefore = providerFragmentBefore === null
  ? null
  : validateProviderFragment(providerFragmentBefore);
const providerManagerBefore = providerFragmentBefore === null
  ? null
  : bindProviderManager(
    providerManagerRawBefore,
    providerFragmentBefore,
    providerContractBefore,
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
  : providerBoundMode
    ? combineSystemManager(
      liveManagerBefore,
      systemDropInSetBefore,
      i00EnvironmentBefore,
      providerManagerBefore,
    )
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
const systemDropInSetAfter = providerBoundMode
  ? inspectSystemDropInSet(liveManagerAfter.dropInPaths)
  : null;
const i00EnvironmentAfter = providerBoundMode
  ? inspectBoundFile(
    boundSystemPath(PRODUCTION_I00_ENV),
    'provider-bound app I00 environment',
    1024 * 1024,
  )
  : null;
const providerManagerRawAfter = providerBoundMode
  ? inspectProviderManager(systemctlBefore)
  : null;
const providerFragmentAfter = providerBoundMode
  ? inspectBoundFile(
    providerManagerRawAfter.fragmentPath,
    'provider unit fragment',
    1024 * 1024,
  )
  : null;
const providerContractAfter = providerFragmentAfter === null
  ? null
  : validateProviderFragment(providerFragmentAfter);
const providerManagerAfter = providerFragmentAfter === null
  ? null
  : bindProviderManager(
    providerManagerRawAfter,
    providerFragmentAfter,
    providerContractAfter,
  );
const proofDropInAfter = proofDropIn === null
  ? null
  : inspectBoundFile(proofDropIn, 'isolated staging proof drop-in', 64 * 1024);
const proofDropInRuntimeLinkAfter = inspectProofDropInRuntimeLink();
requireAbsentProofSentinel();
const managerAfter = strictProofOwnership
  ? offlineManager(fragmentAfter, proofDropInAfter, systemdAnalyzeAfter)
  : providerBoundMode
    ? combineSystemManager(
      liveManagerAfter,
      systemDropInSetAfter,
      i00EnvironmentAfter,
      providerManagerAfter,
    )
    : liveManagerAfter;
if (canonicalJson(managerAfter) !== canonicalJson(managerBefore)
    || canonicalJson(fragmentSourceAfter) !== canonicalJson(fragmentSourceBefore)
    || canonicalJson(fragmentAfter) !== canonicalJson(fragmentBefore)
    || canonicalJson(runtimeEnvAfter) !== canonicalJson(runtimeEnvBefore)
    || canonicalJson(systemDropInSetAfter) !== canonicalJson(systemDropInSetBefore)
    || canonicalJson(i00EnvironmentAfter) !== canonicalJson(i00EnvironmentBefore)
    || canonicalJson(providerManagerAfter) !== canonicalJson(providerManagerBefore)
    || canonicalJson(providerFragmentAfter) !== canonicalJson(providerFragmentBefore)
    || canonicalJson(providerContractAfter) !== canonicalJson(providerContractBefore)
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
const opsHelperTreeAfter = providerBoundMode
  ? typedTreeDigest(physicalOpsHelperRoot, {
    excludeTopLevel: ['accepted-ops-live', 'install-receipt.json'],
  })
  : null;
const opsHelperAppAfter = providerBoundMode
  ? inspectExecutable(
    boundSystemPath(opsHelperAppEntrypoint),
    'ops helper app entrypoint',
  )
  : null;
const opsHelperSecretAfter = providerBoundMode
  ? inspectExecutable(
    boundSystemPath(opsHelperSecretMaterialization),
    'ops helper secret materialization entrypoint',
  )
  : null;
if (canonicalJson(systemctlAfter) !== canonicalJson(systemctlBefore)
    || canonicalJson(nodeAfter) !== canonicalJson(nodeBefore)
    || canonicalJson(envAfter) !== canonicalJson(envBefore)
    || opsHelperTreeAfter !== opsHelperTreeBefore
    || canonicalJson(opsHelperAppAfter) !== canonicalJson(opsHelperAppBefore)
    || canonicalJson(opsHelperSecretAfter) !== canonicalJson(opsHelperSecretBefore)) {
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
  dropInState: providerBoundMode
    ? 'EXACT_PROVIDER_BOUND'
    : 'EXACT_STAGING_PROOF',
  dropInBindings: managerBefore.dropInBindings ?? null,
  dropInSetEndpoint: managerBefore.dropInSetEndpoint ?? null,
  dropInSetSha256: managerBefore.dropInSetSha256 ?? null,
  environmentFilesSha256: managerBefore.environmentFilesSha256 ?? null,
  providerBindingSha256: managerBefore.providerBindingSha256 ?? null,
  providerUnit: managerBefore.providerUnit ?? null,
  providerFragmentPath: managerBefore.providerFragmentPath ?? null,
  providerFragmentSha256: managerBefore.providerFragmentSha256 ?? null,
  providerFragmentIdentity: managerBefore.providerFragmentIdentity ?? null,
  providerState: managerBefore.providerState ?? null,
  providerDeploymentRiskPath: managerBefore.providerDeploymentRiskPath ?? null,
  providerActionPreviewPath: managerBefore.providerActionPreviewPath ?? null,
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
  schemaVersion: 4,
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
  dropInBindings: binding.dropInBindings,
  dropInSetEndpoint: binding.dropInSetEndpoint,
  dropInSetSha256: binding.dropInSetSha256,
  environmentFilesSha256: binding.environmentFilesSha256,
  providerBindingSha256: binding.providerBindingSha256,
  providerUnit: binding.providerUnit,
  providerFragmentPath: binding.providerFragmentPath,
  providerFragmentSha256: binding.providerFragmentSha256,
  providerFragmentEndpointIdentity: binding.providerFragmentIdentity,
  providerState: binding.providerState,
  providerDeploymentRiskPath: binding.providerDeploymentRiskPath,
  providerActionPreviewPath: binding.providerActionPreviewPath,
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
