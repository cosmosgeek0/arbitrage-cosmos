#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdtempSync,
  openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, join, resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPendingProviderDocumentSeparation,
  buildDeploymentRiskVersionForCanonicalProducer,
  executingI00EnforcementProvenance,
  inspectPrivateDirectoryEvidence,
  privateDirectoryIdentityEndpoint,
  readCanonicalDeploymentDocument,
  validateDeploymentActionRequest,
  writeExactPrivateJson,
  systemEffectEvidenceRoot,
} from '../deployment-authorization-contract.mjs';
import {
  fail, parseArgs, typedTreeDigest, verifyArtifactManifest,
} from '../lib.mjs';
import { validateSimulationRoot } from '../simulation-safety.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const I00_ROOT = resolve(SCRIPT_DIR, '..');
const INSPECT_APP_UNIT = resolve(SCRIPT_DIR, 'inspect-app-unit.mjs');
const INSPECT_EXECUTABLE = resolve(SCRIPT_DIR, 'inspect-executable.mjs');
const INSPECT_BACKUP = resolve(SCRIPT_DIR, 'inspect-backup-source.mjs');
const INSPECT_EFFECT_IDENTITY = resolve(SCRIPT_DIR, 'inspect-effect-identity.mjs');
const PREFLIGHT = resolve(SCRIPT_DIR, 'preflight.mjs');
const SANITIZE_ENV = resolve(SCRIPT_DIR, 'sanitize-donor-env.mjs');
const VALIDATE_CONFIG = resolve(SCRIPT_DIR, 'validate-config.mjs');
const VALIDATE_RELEASE = resolve(SCRIPT_DIR, 'validate-release.mjs');
const VERIFY_DONOR_ROOT = resolve(SCRIPT_DIR, 'verify-donor-root.mjs');
const VERIFY_AUTHORIZED_EFFECT_HANDOFF = resolve(
  SCRIPT_DIR,
  'verify-authorized-effect-handoff.mjs',
);
const SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin';
const DIGEST = /^[0-9a-f]{64}$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const EXACT_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const HOST_READBACK_MAX_AGE_MS = 5 * 60 * 1000;
let evidenceReferenceUtc = null;
let evidenceFreshUntilMs = Number.POSITIVE_INFINITY;
let artifactPolicy = null;
let requestForEffectPaths = null;
const EXECUTABLE_IDENTITY_KEYS = Object.freeze([
  'device', 'inode', 'mode', 'size', 'mtimeNs', 'ctimeNs',
]);
const FIXED_PRODUCTION_EFFECT_ROOTS = Object.freeze([
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

const args = parseArgs(process.argv.slice(2), new Set(['simulation-clock']));
const COMMON_ARGUMENTS = new Set([
  'request', 'class', 'output', 'simulation-clock', 'now', 'nonce',
  'simulation-command-root', 'simulation-donor-root', 'simulation-publication-now',
  'root-mode', 'proof-root',
]);
const CLASS_ARGUMENTS = Object.freeze({
  OPS_BUNDLE_INSTALL: new Set([
    'release', 'trusted-build-public-key', 'host-readback', 'host-evidence',
    'destination',
  ]),
  SERVICE_RELEASE_SWITCH: new Set([
    'release', 'trusted-build-public-key', 'host-readback', 'host-evidence',
    'runtime-env', 'deploy-env', 'sqlite', 'first-host-evidence-dir',
    'isolated-staging-root', 'app-unit-fragment',
  ]),
  SERVICE_ROLLBACK: new Set([
    'release', 'trusted-build-public-key', 'host-readback', 'host-evidence',
    'runtime-env', 'deploy-env', 'rollback-evidence-root',
    'isolated-staging-root', 'app-unit-fragment',
  ]),
  BACKUP_CREATE: new Set([
    'host-readback', 'host-evidence', 'runtime-env', 'backup-env',
  ]),
  ISOLATED_RESTORE: new Set([
    'host-readback', 'host-evidence', 'runtime-env', 'backup-env', 'backup',
    'target',
  ]),
  SECRET_MATERIALIZATION: new Set(['provider-config', 'credential-output']),
});
const REQUIRED_CLASS_ARGUMENTS = Object.freeze({
  OPS_BUNDLE_INSTALL: [
    'release', 'trusted-build-public-key', 'host-readback', 'host-evidence',
    'destination',
  ],
  SERVICE_RELEASE_SWITCH: [
    'release', 'trusted-build-public-key', 'runtime-env', 'deploy-env', 'sqlite',
  ],
  SERVICE_ROLLBACK: [
    'release', 'trusted-build-public-key', 'host-readback', 'host-evidence',
    'runtime-env', 'deploy-env', 'rollback-evidence-root',
  ],
  BACKUP_CREATE: [
    'host-readback', 'host-evidence', 'runtime-env', 'backup-env',
  ],
  ISOLATED_RESTORE: [
    'host-readback', 'host-evidence', 'runtime-env', 'backup-env', 'backup',
    'target',
  ],
  SECRET_MATERIALIZATION: ['provider-config', 'credential-output'],
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} must be one object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length
    && actual.every((key, index) => key === expected[index]),
  `${label} has an unexpected field set`);
}

function exactText(value, label) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 2_048
    && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value),
  `${label} is not exact bounded text`);
  assert(!/(?:REPLACE_ME|CHANGEME|PLACEHOLDER|TBD|TODO|FIXME|UNKNOWN|<[^>]+>|\$\{[^}]+\})/iu.test(value),
    `${label} contains unresolved text`);
  return value;
}

function canonicalExecutableIdentity(identity, label) {
  exactKeys(identity, EXECUTABLE_IDENTITY_KEYS, label);
  for (const key of EXECUTABLE_IDENTITY_KEYS) {
    const value = identity[key];
    const pattern = key === 'mode' ? /^[1-7][0-7]+$/u : /^(?:0|[1-9][0-9]*)$/u;
    assert(typeof value === 'string' && pattern.test(value),
      `${label}.${key} is not canonically encoded`);
  }
  return EXECUTABLE_IDENTITY_KEYS
    .map((key) => `${key}=${identity[key]}`)
    .join(',');
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const snapshots = new Map();
const releaseSnapshots = [];
const donorSnapshots = [];
const appUnitSnapshots = [];
const firstHostOfflineSnapshots = [];

function regularFileIdentity(info) {
  return Object.freeze({
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    mode: info.mode.toString(),
    nlink: info.nlink.toString(),
    uid: info.uid.toString(),
    size: info.size.toString(),
    mtimeNs: info.mtimeNs.toString(),
    ctimeNs: info.ctimeNs.toString(),
  });
}

function sameRegularFileIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verifyTrustedAncestorChain(path, label, leafUid) {
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  const trustedOwners = new Set([0n, leafUid]);
  if (invokingUid !== null) trustedOwners.add(invokingUid);
  let cursor = dirname(path);
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true });
    const mode = stat.mode & 0o7777n;
    assert(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(cursor) === cursor,
      `${label} ancestor chain must contain only canonical directories`);
    assert(trustedOwners.has(stat.uid), `${label} ancestor chain has an untrusted owner`);
    if ((mode & 0o022n) !== 0n) {
      assert(stat.uid === 0n && (mode & 0o1000n) !== 0n,
        `${label} ancestor chain contains an unsafe writable directory`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function canonicalFile(path, label, maximumBytes = 1024 * 1024) {
  assert(typeof path === 'string' && path.length > 0 && path.length <= 4_096
    && isAbsolute(path) && resolve(path) === path
    && !/[\u0000-\u001f\u007f]/u.test(path),
  `${label} path must be one raw canonical absolute path`);
  const absolute = resolve(path);
  const namedBefore = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  assert(namedBefore?.isFile() && !namedBefore.isSymbolicLink() && namedBefore.nlink === 1n
    && namedBefore.size > 0n && namedBefore.size <= BigInt(maximumBytes)
    && realpathSync(absolute) === absolute,
  `${label} must be one bounded canonical single-link regular file`);
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  assert((namedBefore.mode & 0o022n) === 0n, `${label} must not be group/world writable`);
  assert(invokingUid === null || namedBefore.uid === 0n || namedBefore.uid === invokingUid,
    `${label} has an untrusted owner`);
  verifyTrustedAncestorChain(absolute, label, namedBefore.uid);
  const identity = regularFileIdentity(namedBefore);
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    assert(openedBefore.isFile() && !openedBefore.isSymbolicLink()
      && openedBefore.nlink === 1n
      && sameRegularFileIdentity(regularFileIdentity(openedBefore), identity),
    `${label} identity changed before descriptor read`);
    bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    assert(sameRegularFileIdentity(regularFileIdentity(openedAfter), identity)
      && BigInt(bytes.length) === openedAfter.size,
    `${label} identity changed during descriptor read`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const namedAfter = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  assert(namedAfter?.isFile() && !namedAfter.isSymbolicLink()
    && realpathSync(absolute) === absolute
    && sameRegularFileIdentity(regularFileIdentity(namedAfter), identity),
  `${label} named identity changed after descriptor read`);
  const sha256 = sha256Bytes(bytes);
  snapshots.set(absolute, Object.freeze({
    sha256,
    identity,
    label,
    maximumBytes,
  }));
  return Object.freeze({
    absolute,
    bytes,
    sha256,
    stat: namedBefore,
    identity,
  });
}

function canonicalDirectory(path, label) {
  assert(typeof path === 'string' && isAbsolute(path) && resolve(path) === path,
    `${label} path must be one raw canonical absolute path`);
  const absolute = resolve(path);
  const stat = lstatSync(absolute, { bigint: true });
  assert(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(absolute) === absolute,
    `${label} must be one canonical non-symlink directory`);
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  assert((stat.mode & 0o022n) === 0n, `${label} must not be group/world writable`);
  assert(invokingUid === null || stat.uid === 0n || stat.uid === invokingUid,
    `${label} has an untrusted owner`);
  verifyTrustedAncestorChain(absolute, label, stat.uid);
  return absolute;
}

function boundPrivateDirectory(path, label, { rootOwned = false } = {}) {
  const evidence = inspectPrivateDirectoryEvidence(path, label);
  const stat = lstatSync(evidence.absolute, { bigint: true });
  assert((stat.mode & 0o777n) === 0o700n, `${label} mode must be 0700`);
  if (rootOwned) assert(stat.uid === 0n, `${label} must be root-owned`);
  return Object.freeze({
    path: evidence.absolute,
    identity: privateDirectoryIdentityEndpoint(evidence),
  });
}

function boundDirectory(path, label) {
  const absolute = canonicalDirectory(path, label);
  const stat = lstatSync(absolute, { bigint: true });
  return Object.freeze({
    path: absolute,
    identity: [
      `device=${stat.dev}`,
      `inode=${stat.ino}`,
      `mode=${stat.mode.toString(8)}`,
      `uid=${stat.uid}`,
      `gid=${stat.gid}`,
    ].join(','),
  });
}

function boundFutureDirectChild(path, label) {
  const target = canonicalFuturePath(path, label);
  const parent = boundDirectory(dirname(target), `${label} parent`);
  assert(dirname(target) === parent.path,
    `${label} must be one direct child of its physical bound parent`);
  return Object.freeze({ target, parent });
}

function deploymentWriteRootEndpoints(environment) {
  const cosmos = boundDirectory(environment.values.COSMOS_ROOT, 'deploy cosmos root');
  const releases = boundDirectory(environment.values.RELEASES_DIR, 'deploy releases directory');
  const currentParent = boundDirectory(
    dirname(environment.values.CURRENT_LINK),
    'deploy current-link parent',
  );
  const previousParent = boundDirectory(
    dirname(environment.values.PREVIOUS_LINK),
    'deploy previous-link parent',
  );
  const opsState = boundDirectory(
    environment.values.OPS_STATE_DIR,
    'deploy ops-state directory',
  );
  const data = boundDirectory(environment.values.DATA_DIR, 'deploy data directory');
  return Object.freeze([
    `cosmos-root-identity:${cosmos.identity}`,
    `cosmos-root-path:${cosmos.path}`,
    `current-link-parent-identity:${currentParent.identity}`,
    `current-link-parent-path:${currentParent.path}`,
    `data-dir-identity:${data.identity}`,
    `data-dir-path:${data.path}`,
    `ops-state-dir-identity:${opsState.identity}`,
    `ops-state-dir-path:${opsState.path}`,
    `previous-link-parent-identity:${previousParent.identity}`,
    `previous-link-parent-path:${previousParent.path}`,
    `releases-dir-identity:${releases.identity}`,
    `releases-dir-path:${releases.path}`,
  ]);
}

function backupWriteRootEndpoints(environment) {
  const backup = boundDirectory(environment.values.BACKUP_DIR, 'backup directory');
  const opsState = boundDirectory(
    environment.values.OPS_STATE_DIR,
    'backup ops-state directory',
  );
  return Object.freeze([
    `backup-dir:${backup.path}`,
    `backup-dir-identity:${backup.identity}`,
    `ops-state-dir-identity:${opsState.identity}`,
    `ops-state-dir-path:${opsState.path}`,
  ]);
}

function dataDirectoryEndpoints(path, label) {
  const data = boundDirectory(path, label);
  return Object.freeze([
    `data-dir:${data.path}`,
    `data-dir-identity:${data.identity}`,
    `data-dir-path:${data.path}`,
  ]);
}

function classRollbackEvidenceRoot() {
  const expected = exactClassTarget(
    '/var/lib/cosmos-action-receipts/rollback-evidence',
    'rollback-evidence',
    'rollback evidence root',
  );
  return boundPrivateDirectory(expected, 'rollback evidence root', {
    rootOwned: artifactPolicy.rootMode !== 'TEST',
  });
}

function buildArtifactPolicy(actionClass) {
  const rootMode = args['root-mode'];
  assert(['SYSTEM', 'STAGING', 'TEST'].includes(rootMode),
    '--root-mode must be SYSTEM, STAGING, or TEST');
  if (rootMode === 'SYSTEM') {
    assert(args['proof-root'] === undefined, 'SYSTEM root mode rejects --proof-root');
    const authorization = boundPrivateDirectory(
      '/var/lib/cosmos-deployment-authorization',
      'deployment authorization root',
      { rootOwned: true },
    );
    const consumption = boundPrivateDirectory(
      '/var/lib/cosmos-authorization-consumption',
      'authorization consumption root',
      { rootOwned: true },
    );
    const receipts = boundPrivateDirectory(
      '/var/lib/cosmos-action-receipts',
      'action receipt root',
      { rootOwned: true },
    );
    // Derived from the single definition, never restated. This is the copy an earlier commit
    // claimed to have removed and did not: the contract's inline copy was routed through the
    // shared definition while THIS one - the constructor that actually builds the policy - was
    // left standing. Two copies of one path is the defect the shared definition exists to end.
    const effectPath = systemEffectEvidenceRoot(actionClass);
    const effect = boundPrivateDirectory(effectPath, 'authorized effect evidence root');
    return Object.freeze({
      rootMode,
      proofRoot: 'NONE',
      proofRootIdentity: 'NONE',
      authorizationRoot: authorization.path,
      authorizationRootIdentity: authorization.identity,
      consumptionRoot: consumption.path,
      consumptionRootIdentity: consumption.identity,
      receiptRoot: receipts.path,
      receiptRootIdentity: receipts.identity,
      effectEvidenceRoot: effect.path,
      effectEvidenceRootIdentity: effect.identity,
    });
  }
  assert(typeof args['proof-root'] === 'string',
    `${rootMode} root mode requires --proof-root`);
  const proof = boundPrivateDirectory(
    args['proof-root'],
    `${rootMode} proof root`,
    { rootOwned: rootMode === 'STAGING' },
  );
  if (rootMode === 'TEST') {
    assert(args['simulation-clock'] === true,
      'TEST root mode requires --simulation-clock');
    assert(validateSimulationRoot(proof.path) === proof.path,
      'TEST proof root must be one marked simulation root');
    assert(typeof args['simulation-command-root'] === 'string'
      && args['simulation-command-root'].startsWith(`${proof.path}/`),
    'TEST simulation command root must be closed below the marked proof root');
  } else {
    assert(args['simulation-clock'] !== true,
      'STAGING root mode rejects caller clock inputs');
    assert(/^\/var\/tmp\/cosmos-df32-proof-[0-9a-f]{4}$/u.test(proof.path)
      && !pathIntersectsFixedProductionUnion(proof.path, 'STAGING proof root'),
    'STAGING proof root must be one protected-disjoint four-suffix root');
    if (['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK'].includes(actionClass)) {
      assert(args['isolated-staging-root'] === proof.path,
        'STAGING app-unit root must equal the bound proof root');
    }
  }
  const authorization = boundPrivateDirectory(
    `${proof.path}/authorization`,
    `${rootMode} authorization root`,
    { rootOwned: rootMode === 'STAGING' },
  );
  const consumption = boundPrivateDirectory(
    `${proof.path}/consumption`,
    `${rootMode} consumption root`,
    { rootOwned: rootMode === 'STAGING' },
  );
  const receipts = boundPrivateDirectory(
    `${proof.path}/receipts`,
    `${rootMode} receipt root`,
    { rootOwned: rootMode === 'STAGING' },
  );
  const effect = boundPrivateDirectory(
    `${proof.path}/effects`,
    `${rootMode} effect evidence root`,
    { rootOwned: rootMode === 'STAGING' },
  );
  return Object.freeze({
    rootMode,
    proofRoot: proof.path,
    proofRootIdentity: proof.identity,
    authorizationRoot: authorization.path,
    authorizationRootIdentity: authorization.identity,
    consumptionRoot: consumption.path,
    consumptionRootIdentity: consumption.identity,
    receiptRoot: receipts.path,
    receiptRootIdentity: receipts.identity,
    effectEvidenceRoot: effect.path,
    effectEvidenceRootIdentity: effect.identity,
  });
}

function recheckArtifactPolicy(policy) {
  const entries = policy.rootMode === 'SYSTEM'
    ? [
      ['authorizationRoot', 'authorizationRootIdentity'],
      ['consumptionRoot', 'consumptionRootIdentity'],
      ['receiptRoot', 'receiptRootIdentity'],
      ['effectEvidenceRoot', 'effectEvidenceRootIdentity'],
    ]
    : [
      ['proofRoot', 'proofRootIdentity'],
      ['authorizationRoot', 'authorizationRootIdentity'],
      ['consumptionRoot', 'consumptionRootIdentity'],
      ['receiptRoot', 'receiptRootIdentity'],
      ['effectEvidenceRoot', 'effectEvidenceRootIdentity'],
    ];
  for (const [pathKey, identityKey] of entries) {
    const current = inspectPrivateDirectoryEvidence(
      policy[pathKey],
      `artifact policy ${pathKey}`,
    );
    assert(privateDirectoryIdentityEndpoint(current) === policy[identityKey],
      `artifact policy ${pathKey} identity changed`);
  }
}

function requireNonWritableTree(root, label, relative = '') {
  const absolute = resolve(root, relative);
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  assert(stat && !stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()),
    `${label} contains an unsafe entry`);
  assert((stat.mode & 0o222) === 0, `${label} contains a writable entry`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(absolute).sort()) {
      requireNonWritableTree(root, label, relative ? `${relative}/${name}` : name);
    }
  }
}

function canonicalFuturePath(path, label) {
  assert(typeof path === 'string' && path.length > 0 && path.length <= 4_096
    && isAbsolute(path) && resolve(path) === path
    && !/[\u0000-\u001f\u007f]/u.test(path),
  `${label} must be one raw canonical bounded absolute path`);
  let cursor = path;
  const suffix = [];
  for (;;) {
    try {
      lstatSync(cursor);
      break;
    } catch (error) {
      assert(error?.code === 'ENOENT' || error?.code === 'ENOTDIR',
        `${label} cannot be inspected safely`);
      const parent = dirname(cursor);
      assert(parent !== cursor, `${label} has no existing ancestor`);
      const component = basename(cursor);
      assert(component.length > 0 && component !== '.' && component !== '..',
        `${label} has an unsafe missing suffix`);
      suffix.unshift(component);
      cursor = parent;
    }
  }
  const resolvedAncestor = realpathSync(cursor);
  const ancestor = canonicalDirectory(resolvedAncestor, `${label} existing ancestor`);
  const projected = suffix.reduce((current, part) => join(current, part), ancestor);
  assert(projected === path,
    `${label} existing ancestor chain must already be physical and canonical`);
  return projected;
}

function exactClassTarget(systemPath, proofRelativePath, label) {
  const expected = artifactPolicy.rootMode === 'SYSTEM'
    ? systemPath
    : resolve(artifactPolicy.proofRoot, proofRelativePath);
  assert(resolve(expected) === expected, `${label} policy target is not canonical`);
  return expected;
}

function canonicalProtectedRoot(path, label) {
  assert(typeof path === 'string' && path.length > 0 && path.length <= 4_096
    && isAbsolute(path) && !/[\u0000-\u001f\u007f]/u.test(path),
  `${label} must be one bounded absolute path`);
  let cursor = path;
  const suffix = [];
  const projectable = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM']);
  for (;;) {
    try {
      lstatSync(cursor);
      const ancestor = realpathSync(cursor);
      if (suffix.length > 0) {
        const stat = lstatSync(ancestor);
        assert(stat.isDirectory() && !stat.isSymbolicLink(),
          `${label} existing ancestor must be one physical directory`);
      }
      return suffix.reduce((current, part) => join(current, part), ancestor);
    } catch (error) {
      assert(projectable.has(error?.code), `${label} cannot be projected safely`);
      const parent = dirname(cursor);
      assert(parent !== cursor, `${label} has no inspectable ancestor`);
      const component = basename(cursor);
      assert(component.length > 0 && component !== '.' && component !== '..',
        `${label} has an unsafe projected suffix`);
      suffix.unshift(component);
      cursor = parent;
    }
  }
}

function pathIntersectsFixedProductionUnion(path, label) {
  for (const protectedRoot of FIXED_PRODUCTION_EFFECT_ROOTS) {
    const canonicalRoot = canonicalProtectedRoot(
      protectedRoot,
      `${label} fixed production root`,
    );
    if (path === canonicalRoot || path.startsWith(`${canonicalRoot}/`)
        || canonicalRoot.startsWith(`${path}/`)) return true;
  }
  return false;
}

function canonicalRestoreTarget(path) {
  try {
    return canonicalFuturePath(path, 'isolated restore target');
  } catch (error) {
    let projected;
    try {
      projected = canonicalProtectedRoot(path, 'isolated restore target');
    } catch {
      throw error;
    }
    assert(!pathIntersectsFixedProductionUnion(projected, 'isolated restore target'),
      'isolated restore target intersects a fixed production root');
    throw error;
  }
}

function jsonEvidence(path, label, keys) {
  const file = canonicalFile(path, label);
  let document;
  try {
    document = JSON.parse(file.bytes);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  exactKeys(document, keys, label);
  return Object.freeze({ ...file, document });
}

function parseEnvBytes(bytes, label) {
  const values = {};
  for (const [index, rawLine] of bytes.toString('utf8').split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    assert(match !== null, `${label} syntax is invalid at line ${index + 1}`);
    const [, key, raw] = match;
    assert(!Object.hasOwn(values, key), `${label} contains duplicate ${key}`);
    let value = raw;
    if ((raw.startsWith("'") && raw.endsWith("'"))
        || (raw.startsWith('"') && raw.endsWith('"'))) value = raw.slice(1, -1);
    else assert(!/\s/u.test(raw), `${label} contains ambiguous whitespace in ${key}`);
    assert(!/[\0\r\n]/u.test(value), `${label} contains a control value`);
    values[key] = value;
  }
  return Object.freeze(values);
}

function parseEnv(path, label) {
  const file = canonicalFile(path, label);
  return Object.freeze({
    ...file,
    values: parseEnvBytes(file.bytes, label),
  });
}

function runNode(script, scriptArgs, label) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    encoding: 'utf8',
    env: {
      HOME: '/nonexistent',
      LANG: 'C',
      LC_ALL: 'C',
      PATH: SAFE_PATH,
      TZ: 'UTC',
    },
    maxBuffer: 2 * 1024 * 1024,
  });
  assert(result.status === 0, `${label} failed`);
  return result.stdout.trim();
}

function inspectedExecutable(path, label) {
  const output = runNode(INSPECT_EXECUTABLE, ['--path', path], `${label} inspection`);
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error(`${label} inspection returned invalid JSON`);
  }
  exactKeys(value, ['status', 'path', 'sha256', 'identity', 'endpointIdentity'],
    `${label} inspection`);
  assert(value.status === 'EXECUTABLE_IDENTITY_VERIFIED' && DIGEST.test(value.sha256),
    `${label} inspection is invalid`);
  canonicalFile(value.path, label, 1024 * 1024 * 1024);
  return Object.freeze(value);
}

function fixedCommandPath(name, simulationRoot) {
  if (simulationRoot !== null) {
    return resolve(simulationRoot, name === 'hash-command' ? 'sha256sum' : name);
  }
  if (name === 'systemctl' && artifactPolicy?.rootMode === 'STAGING') {
    return resolve(artifactPolicy.proofRoot, 'tools', 'systemctl');
  }
  const candidates = {
    node: ['/usr/bin/node'],
    bash: ['/bin/bash'],
    env: ['/usr/bin/env', '/bin/env', '/usr/sbin/env', '/sbin/env', '/usr/local/bin/env'],
    systemctl: ['/usr/bin/systemctl', '/bin/systemctl', '/usr/sbin/systemctl', '/sbin/systemctl', '/usr/local/bin/systemctl'],
    curl: ['/usr/bin/curl', '/bin/curl', '/usr/sbin/curl', '/sbin/curl', '/usr/local/bin/curl'],
    mkdir: ['/usr/bin/mkdir', '/bin/mkdir', '/usr/sbin/mkdir', '/sbin/mkdir', '/usr/local/bin/mkdir'],
    cp: ['/usr/bin/cp', '/bin/cp', '/usr/sbin/cp', '/sbin/cp', '/usr/local/bin/cp'],
    chmod: ['/usr/bin/chmod', '/bin/chmod', '/usr/sbin/chmod', '/sbin/chmod', '/usr/local/bin/chmod'],
    mv: ['/usr/bin/mv', '/bin/mv', '/usr/sbin/mv', '/sbin/mv', '/usr/local/bin/mv'],
    rm: ['/usr/bin/rm', '/bin/rm', '/usr/sbin/rm', '/sbin/rm', '/usr/local/bin/rm'],
    tar: ['/usr/bin/tar', '/bin/tar', '/usr/sbin/tar', '/sbin/tar', '/usr/local/bin/tar'],
    gzip: ['/usr/bin/gzip', '/bin/gzip', '/usr/sbin/gzip', '/sbin/gzip', '/usr/local/bin/gzip'],
    id: ['/usr/bin/id', '/bin/id', '/usr/sbin/id', '/sbin/id', '/usr/local/bin/id'],
    getent: [
      '/usr/bin/getent', '/bin/getent', '/usr/sbin/getent', '/sbin/getent',
      '/usr/local/bin/getent',
    ],
    setpriv: [
      '/usr/bin/setpriv', '/bin/setpriv', '/usr/sbin/setpriv', '/sbin/setpriv',
      '/usr/local/bin/setpriv',
    ],
    'hash-command': [
      '/usr/bin/sha256sum', '/bin/sha256sum', '/usr/sbin/sha256sum', '/sbin/sha256sum',
      '/usr/local/bin/sha256sum', '/usr/bin/shasum', '/bin/shasum', '/usr/sbin/shasum',
      '/sbin/shasum', '/usr/local/bin/shasum',
    ],
  }[name];
  assert(candidates !== undefined, `unknown fixed command ${name}`);
  const found = candidates.find((candidate) => existsSync(candidate));
  assert(found !== undefined, `required fixed command ${name} is unavailable`);
  return realpathSync(found);
}

function commandSet(names, simulationRoot) {
  const commands = Object.fromEntries(names.map((name) => [
    name,
    inspectedExecutable(fixedCommandPath(name, simulationRoot), name),
  ]));
  if (simulationRoot === null && Object.hasOwn(commands, 'node')) {
    assert(realpathSync(process.execPath) === commands.node.path,
      'producer interpreter differs from the fixed SAFE_PATH Node executable');
  }
  return commands;
}

function executableEndpoints(name, inspection) {
  const prefix = name === 'hash-command' ? 'hash' : name;
  return [
    `${prefix}-identity:${inspection.endpointIdentity}`,
    `${prefix}-path:${inspection.path}`,
    `${prefix}-sha256:${inspection.sha256}`,
  ];
}

function endpointIdentityForStat(stat) {
  return [
    `device=${stat.dev}`,
    `inode=${stat.ino}`,
    `mode=${stat.mode.toString(8)}`,
    `size=${stat.size}`,
    `mtimeNs=${stat.mtimeNs}`,
    `ctimeNs=${stat.ctimeNs}`,
  ].join(',');
}

function appUnitLocation(simulationRoot, unit, runtime, environment, donor) {
  const fragmentSource = canonicalFile(
    resolve(donor.root, 'systemd', 'cosmos-app.service'),
    'accepted donor app unit fragment source',
  ).absolute;
  const mode = artifactPolicy.rootMode;
  if (mode === 'SYSTEM') {
    assert(simulationRoot === null
      && args['isolated-staging-root'] === undefined
      && args['app-unit-fragment'] === undefined,
    'SYSTEM app-unit evidence rejects staging path inputs');
    assert(unit === 'cosmos-app.service'
      && runtime.absolute === '/etc/cosmos/cosmos-app.env',
    'production app unit and runtime environment paths are not exact');
    return Object.freeze({
      provenanceMode: 'SYSTEM',
      stagingRoot: null,
      expectedFragment: '/etc/systemd/system/cosmos-app.service',
      fragmentSource,
      offlineUnitRoot: null,
      proofDropIn: null,
      proofDropInRuntimeLink: null,
      proofAbsentSentinel: null,
      systemdAnalyze: null,
    });
  }
  const stagingRoot = canonicalDirectory(
    artifactPolicy.proofRoot,
    `${mode} app-unit proof root`,
  );
  const unitStem = unit.slice(0, -'.service'.length);
  const expectedFragment = resolve(stagingRoot, 'systemd', unit);
  const proofDropIn = resolve(
    stagingRoot,
    'systemd',
    `${unit}.d`,
    `90-${unitStem}.conf`,
  );
  const proofAbsentSentinel = resolve(stagingRoot, `.do-not-start-${unitStem}`);
  if (mode === 'TEST') {
    assert(simulationRoot !== null && dirname(simulationRoot) === stagingRoot
      && args['isolated-staging-root'] === undefined
      && args['app-unit-fragment'] === undefined,
    'TEST app-unit evidence must derive only from the marked proof root');
    assert(runtime.absolute.startsWith(`${stagingRoot}/`),
      'TEST app-unit runtime environment escaped the proof root');
    return Object.freeze({
      provenanceMode: 'TEST',
      stagingRoot,
      expectedFragment,
      fragmentSource,
      offlineUnitRoot: null,
      proofDropIn,
      proofDropInRuntimeLink: resolve(
        stagingRoot,
        'runtime-systemd',
        `${unit}.d`,
        `90-${unitStem}.conf`,
      ),
      proofAbsentSentinel,
      systemdAnalyze: null,
    });
  }
  const suffix = basename(stagingRoot).slice('cosmos-df32-proof-'.length);
  assert(args['isolated-staging-root'] === stagingRoot
    && args['app-unit-fragment'] === expectedFragment
    && unit === `cosmos-df32-proof-${suffix}.service`
    && runtime.absolute === resolve(stagingRoot, 'runtime', 'cosmos-app.env')
    && environment === `isolated-staging-${suffix}`,
  'STAGING app-unit inputs differ from the exact proof-suffixed offline layout');
  return Object.freeze({
    provenanceMode: 'STAGING',
    stagingRoot,
    expectedFragment,
    fragmentSource,
    offlineUnitRoot: resolve(stagingRoot, 'systemd'),
    proofDropIn,
    proofDropInRuntimeLink: null,
    proofAbsentSentinel,
    systemdAnalyze: inspectedExecutable(
      '/usr/bin/systemd-analyze',
      'systemd-analyze',
    ),
  });
}

function appUnitBinding(commands, unit, runtime, environment, simulationRoot, donor) {
  const location = appUnitLocation(
    simulationRoot,
    exactText(unit, 'deploy env APP_UNIT'),
    runtime,
    environment,
    donor,
  );
  const commandArguments = [
    '--systemctl', commands.systemctl.path,
    '--unit', exactText(unit, 'deploy env APP_UNIT'),
    '--node', commands.node.path,
    '--env', commands.env.path,
    '--runtime-env', runtime.absolute,
    '--expected-fragment-path', location.expectedFragment,
    '--expected-fragment-source', location.fragmentSource,
    '--provenance-mode', location.provenanceMode,
  ];
  if (location.stagingRoot !== null) {
    commandArguments.push(
      '--staging-root', location.stagingRoot,
      '--proof-drop-in', location.proofDropIn,
      '--proof-absent-sentinel', location.proofAbsentSentinel,
    );
  }
  if (location.proofDropInRuntimeLink !== null) {
    commandArguments.push(
      '--proof-drop-in-runtime-link',
      location.proofDropInRuntimeLink,
    );
  }
  if (location.offlineUnitRoot !== null) {
    commandArguments.push(
      '--offline-unit-root', location.offlineUnitRoot,
      '--systemd-analyze', location.systemdAnalyze.path,
    );
  }
  const raw = runNode(INSPECT_APP_UNIT, commandArguments, 'app unit inspection');
  let inspected;
  try {
    inspected = JSON.parse(raw);
  } catch {
    throw new Error('app unit inspection returned invalid JSON');
  }
  exactKeys(inspected, [
    'schemaVersion', 'status', 'inspectionMode', 'systemctlPath',
    'offlineUnitRoot', 'systemdAnalyzePath', 'systemdAnalyzeSha256',
    'systemdAnalyzeIdentity', 'systemdAnalyzeEndpointIdentity',
    'unit', 'fragmentPath',
    'fragmentSha256', 'fragmentIdentity', 'fragmentEndpointIdentity',
    'fragmentSourcePath', 'fragmentSourceSha256', 'fragmentSourceIdentity',
    'fragmentSourceEndpointIdentity', 'dropInPaths', 'dropInState',
    'dropInBindings', 'dropInSetEndpoint', 'dropInSetSha256',
    'environmentFilesSha256', 'providerBindingSha256', 'providerUnit',
    'providerFragmentPath', 'providerFragmentSha256',
    'providerFragmentEndpointIdentity', 'providerState',
    'providerDeploymentRiskPath', 'providerActionPreviewPath',
    'proofDropInPath', 'proofDropInSha256', 'proofDropInIdentity',
    'proofDropInEndpointIdentity', 'proofDropInOwner',
    'proofDropInRuntimeLinkPath', 'proofDropInRuntimeLinkIdentity',
    'proofDropInRuntimeLinkEndpointIdentity', 'proofAbsentSentinel',
    'needDaemonReload', 'user', 'group', 'workingDirectory',
    'environmentFiles', 'unsetEnvironment', 'unsetEnvironmentSha256',
    'namespaceRemapState', 'executionAuthorityState', 'environmentAuthorityState',
    'identityAuthorityState', 'authorityClosureSha256', 'effectReachability',
    'runtimeEnvPath', 'runtimeEnvSha256',
    'runtimeEnvIdentity', 'runtimeEnvEndpointIdentity', 'execStart',
    'execStartSha256', 'bindingSha256',
  ], 'app unit inspection');
  exactKeys(inspected.execStart, ['path', 'argv', 'flags'], 'app unit inspection.execStart');
  const staging = location.stagingRoot !== null;
  const offline = location.offlineUnitRoot !== null;
  assert(inspected.schemaVersion === 4
    && inspected.status === 'APP_UNIT_BINDING_VERIFIED'
    && inspected.inspectionMode
      === (offline ? 'PRIVATE_OFFLINE_UNIT_ROOT' : 'LIVE_SYSTEM_MANAGER')
    && inspected.systemctlPath === commands.systemctl.path
    && inspected.offlineUnitRoot === location.offlineUnitRoot
    && inspected.systemdAnalyzePath === (location.systemdAnalyze?.path ?? null)
    && inspected.systemdAnalyzeSha256 === (location.systemdAnalyze?.sha256 ?? null)
    && inspected.systemdAnalyzeEndpointIdentity
      === (location.systemdAnalyze?.endpointIdentity ?? null)
    && inspected.unit === unit
    && DIGEST.test(inspected.fragmentSha256)
    && inspected.fragmentSourcePath === location.fragmentSource
    && inspected.fragmentSourceSha256 === inspected.fragmentSha256
    && inspected.fragmentSourceEndpointIdentity.length > 0
    && DIGEST.test(inspected.execStartSha256)
    && DIGEST.test(inspected.bindingSha256)
    && inspected.fragmentPath.startsWith('/')
    && inspected.fragmentEndpointIdentity.length > 0
    && inspected.dropInState
      === (staging ? 'EXACT_STAGING_PROOF' : 'EXACT_PROVIDER_BOUND')
    && inspected.proofDropInPath === location.proofDropIn
    && inspected.proofDropInRuntimeLinkPath === location.proofDropInRuntimeLink
    && inspected.proofAbsentSentinel === location.proofAbsentSentinel
    && Array.isArray(inspected.dropInPaths)
    && (staging
      ? inspected.dropInPaths.length === 1
      : inspected.dropInPaths.length === 3)
    && (staging
      ? inspected.dropInBindings === null
        && inspected.dropInSetEndpoint === null
        && inspected.dropInSetSha256 === null
        && inspected.environmentFilesSha256 === null
        && inspected.providerBindingSha256 === null
        && inspected.providerUnit === null
        && inspected.providerFragmentPath === null
        && inspected.providerFragmentSha256 === null
        && inspected.providerFragmentEndpointIdentity === null
        && inspected.providerState === null
        && inspected.providerDeploymentRiskPath === null
        && inspected.providerActionPreviewPath === null
      : Array.isArray(inspected.dropInBindings)
        && inspected.dropInBindings.length === 3
        && typeof inspected.dropInSetEndpoint === 'string'
        && inspected.dropInSetEndpoint.length > 0
        && DIGEST.test(inspected.dropInSetSha256)
        && DIGEST.test(inspected.environmentFilesSha256)
        && DIGEST.test(inspected.providerBindingSha256)
        && inspected.providerUnit === 'cosmos-secrets-provider.service'
        && inspected.providerFragmentPath
          === '/etc/systemd/system/cosmos-secrets-provider.service'
        && DIGEST.test(inspected.providerFragmentSha256)
        && typeof inspected.providerFragmentEndpointIdentity === 'string'
        && inspected.providerFragmentEndpointIdentity.length > 0
        && inspected.providerState === 'ACTIVE_EXITED_SUCCESS'
        && typeof inspected.providerDeploymentRiskPath === 'string'
        && inspected.providerDeploymentRiskPath.startsWith(
          '/var/lib/cosmos-deployment-authorization/',
        )
        && typeof inspected.providerActionPreviewPath === 'string'
        && inspected.providerActionPreviewPath.startsWith(
          '/var/lib/cosmos-deployment-authorization/',
        )
        && inspected.providerDeploymentRiskPath !== inspected.providerActionPreviewPath)
    && inspected.needDaemonReload === (offline ? 'not-applicable-offline' : 'no')
    && inspected.user === 'cosmos'
    && inspected.group === 'cosmos'
    && inspected.workingDirectory === '/opt/cosmos/current'
    && inspected.namespaceRemapState === 'NONE'
    && inspected.executionAuthorityState === 'CLOSED'
    && inspected.environmentAuthorityState
      === (staging ? 'CLOSED' : 'EXACT_PROVIDER_CREDENTIAL')
    && inspected.identityAuthorityState === 'CLOSED'
    && DIGEST.test(inspected.authorityClosureSha256)
    && DIGEST.test(inspected.unsetEnvironmentSha256)
    && inspected.runtimeEnvPath === runtime.absolute
    && inspected.runtimeEnvSha256 === runtime.sha256
    && inspected.runtimeEnvEndpointIdentity === runtime.endpointIdentity
    && Array.isArray(inspected.environmentFiles)
    && inspected.environmentFiles.length === (staging ? 1 : 2)
    && inspected.environmentFiles[0]?.path === runtime.absolute
    && inspected.environmentFiles[0]?.optional === false
    && (staging
      || (inspected.environmentFiles[1]?.path === '/etc/cosmos/cosmos-i00.env'
        && inspected.environmentFiles[1]?.optional === false))
    && inspected.execStart.path === commands.env.path
    && Array.isArray(inspected.execStart.argv)
    && inspected.execStart.argv[2] === commands.node.path
    && inspected.execStart.argv[3] === (staging
      ? 'server/dist/index.js'
      : '/usr/local/lib/cosmos-ops/i00/bin/app-entrypoint.mjs')
    && Array.isArray(inspected.execStart.flags)
    && inspected.execStart.flags.length === 0
    && typeof inspected.effectReachability === 'string'
    && inspected.effectReachability.length > 0,
  'app unit inspection is invalid');
  appUnitSnapshots.push(Object.freeze({
    commandArguments: Object.freeze([...commandArguments]),
    inspected: Object.freeze(inspected),
  }));
  return Object.freeze({
    endpoints: Object.freeze([
      `app-unit-authority-closure-sha256:${inspected.authorityClosureSha256}`,
      `app-unit-binding-sha256:${inspected.bindingSha256}`,
      `app-unit-drop-in-state:${inspected.dropInState}`,
      `app-unit-effect-reachability:${inspected.effectReachability}`,
      `app-unit-environment-file-identity:${inspected.runtimeEnvEndpointIdentity}`,
      'app-unit-environment-file-optional:no',
      `app-unit-environment-file-path:${inspected.runtimeEnvPath}`,
      `app-unit-environment-file-sha256:${inspected.runtimeEnvSha256}`,
      `app-unit-exec-start-env-path:${inspected.execStart.path}`,
      `app-unit-exec-start-node-path:${inspected.execStart.argv[2]}`,
      `app-unit-exec-start-sha256:${inspected.execStartSha256}`,
      `app-unit-fragment-identity:${inspected.fragmentEndpointIdentity}`,
      `app-unit-fragment-path:${inspected.fragmentPath}`,
      `app-unit-fragment-sha256:${inspected.fragmentSha256}`,
      `app-unit-fragment-source-identity:${inspected.fragmentSourceEndpointIdentity}`,
      `app-unit-fragment-source-path:${inspected.fragmentSourcePath}`,
      `app-unit-fragment-source-sha256:${inspected.fragmentSourceSha256}`,
      `app-unit-group:${inspected.group}`,
      `app-unit-inspection-mode:${inspected.inspectionMode}`,
      `app-unit-name:${inspected.unit}`,
      `app-unit-namespace-remap-state:${inspected.namespaceRemapState}`,
      `app-unit-need-daemon-reload:${inspected.needDaemonReload}`,
      `app-unit-offline-unit-root:${inspected.offlineUnitRoot ?? 'NONE'}`,
      `app-unit-proof-absent-sentinel:${inspected.proofAbsentSentinel ?? 'NONE'}`,
      `app-unit-proof-drop-in-identity:${inspected.proofDropInEndpointIdentity ?? 'NONE'}`,
      `app-unit-proof-drop-in-owner:${inspected.proofDropInOwner}`,
      `app-unit-proof-drop-in-path:${inspected.proofDropInPath ?? 'NONE'}`,
      `app-unit-proof-drop-in-runtime-link-identity:${inspected.proofDropInRuntimeLinkEndpointIdentity ?? 'NONE'}`,
      `app-unit-proof-drop-in-runtime-link-path:${inspected.proofDropInRuntimeLinkPath ?? 'NONE'}`,
      `app-unit-proof-drop-in-sha256:${inspected.proofDropInSha256 ?? 'NONE'}`,
      `app-unit-staging-root:${location.stagingRoot ?? 'NONE'}`,
      `app-unit-unset-environment-sha256:${inspected.unsetEnvironmentSha256}`,
      `app-unit-user:${inspected.user}`,
      `app-unit-working-directory:${inspected.workingDirectory}`,
      ...(!staging ? [
        `app-unit-drop-in-set:${inspected.dropInSetEndpoint}`,
        `app-unit-environment-files-sha256:${inspected.environmentFilesSha256}`,
        `app-unit-provider-action-preview-path:${inspected.providerActionPreviewPath}`,
        `app-unit-provider-binding-sha256:${inspected.providerBindingSha256}`,
        `app-unit-provider-deployment-risk-path:${inspected.providerDeploymentRiskPath}`,
        `app-unit-provider-fragment-identity:${inspected.providerFragmentEndpointIdentity}`,
        `app-unit-provider-fragment-path:${inspected.providerFragmentPath}`,
        `app-unit-provider-fragment-sha256:${inspected.providerFragmentSha256}`,
        `app-unit-provider-state:${inspected.providerState}`,
        `app-unit-provider-unit:${inspected.providerUnit}`,
      ] : []),
      `systemd-analyze-identity:${inspected.systemdAnalyzeEndpointIdentity ?? 'NONE'}`,
      `systemd-analyze-path:${inspected.systemdAnalyzePath ?? 'NONE'}`,
      `systemd-analyze-sha256:${inspected.systemdAnalyzeSha256 ?? 'NONE'}`,
    ]),
  });
}

function hostBinding(hostPath, evidencePath) {
  const host = jsonEvidence(hostPath, 'host readback', [
    'source', 'account', 'targetHost', 'environment', 'freeBytes',
    'backupReserveBytes', 'sqliteVersion', 'evidenceSha256', 'observedAtUtc',
  ]);
  const evidence = canonicalFile(evidencePath, 'host evidence');
  assert(host.document.source === 'TARGET_HOST_OWNER_READBACK',
    'host readback source is not canonical');
  for (const key of ['account', 'targetHost', 'environment']) {
    exactText(host.document[key], `host readback.${key}`);
  }
  assert(EXACT_UTC_SECONDS.test(host.document.observedAtUtc)
    && Number.isFinite(Date.parse(host.document.observedAtUtc)),
  'host readback observedAtUtc must be exact UTC seconds');
  assert(EXACT_UTC_SECONDS.test(evidenceReferenceUtc ?? '')
    && Number.isFinite(Date.parse(evidenceReferenceUtc)),
  'producer evidence reference time is unavailable');
  const hostAgeMs = Date.parse(evidenceReferenceUtc) - Date.parse(host.document.observedAtUtc);
  assert(hostAgeMs >= 0, 'host readback observedAtUtc is in the future');
  assert(hostAgeMs <= HOST_READBACK_MAX_AGE_MS, 'host readback evidence is stale');
  evidenceFreshUntilMs = Math.min(
    evidenceFreshUntilMs,
    Date.parse(host.document.observedAtUtc) + HOST_READBACK_MAX_AGE_MS,
  );
  assert(!/\s|:\/\//u.test(host.document.targetHost), 'host readback targetHost is invalid');
  assert(DIGEST.test(host.document.evidenceSha256)
    && host.document.evidenceSha256 === evidence.sha256,
  'host readback does not bind the exact host evidence bytes');
  for (const key of ['freeBytes', 'backupReserveBytes']) {
    assert(Number.isSafeInteger(host.document[key]) && host.document[key] >= 0,
      `host readback.${key} is invalid`);
  }
  // Align with the strict endpoint validator (backup-reserve-bytes requires a
  // leading 1-9 decimal), so a zero reserve is refused here, at the earliest
  // check, instead of surviving until the strict side rejects it later.
  assert(host.document.backupReserveBytes >= 1
    && /^[1-9][0-9]*$/u.test(String(host.document.backupReserveBytes)),
  `host readback.backupReserveBytes must be a strictly positive integer; got ${host.document.backupReserveBytes}`);
  return Object.freeze({
    account: host.document.account,
    environment: host.document.environment,
    host: host.document.targetHost,
    backupReserveBytes: host.document.backupReserveBytes,
    sources: Object.freeze([
      { role: 'HOST_EVIDENCE', sha256: evidence.sha256 },
      { role: 'HOST_READBACK', sha256: host.sha256 },
    ]),
  });
}

function releaseBinding(path, trustedKeyPath, label = 'release', {
  installedImmutable = false,
} = {}) {
  const root = canonicalDirectory(path, label);
  const rootStat = lstatSync(root, { bigint: true });
  const validationArguments = [
    '--release', root,
    '--trusted-build-public-key', trustedKeyPath,
  ];
  if (args['simulation-clock'] === true) validationArguments.push('--allow-simulation');
  if (installedImmutable) validationArguments.push('--installed-immutable');
  const validationOutput = runNode(
    VALIDATE_RELEASE,
    validationArguments,
    `${label} full validation`,
  );
  let validation;
  try {
    validation = JSON.parse(validationOutput);
  } catch {
    throw new Error(`${label} full validation returned invalid JSON`);
  }
  assert(validation.status === 'RELEASE_VALID_NOT_DEPLOYED',
    `${label} full validation did not accept the release`);
  const verified = verifyArtifactManifest(root, null, { installedImmutable });
  assert(FULL_SHA.test(verified.release.testedSha)
    && typeof verified.release.configRevision === 'string',
  `${label} identity is invalid`);
  const releaseJson = canonicalFile(resolve(root, 'release.json'), `${label} release.json`);
  const manifest = canonicalFile(resolve(root, 'artifact-manifest.json'), `${label} artifact manifest`);
  assert(manifest.sha256 === verified.artifactManifestSha256,
    `${label} artifact manifest digest differs from verification`);
  assert(validation.testedSha === verified.release.testedSha
    && validation.artifactManifestSha256 === verified.artifactManifestSha256,
  `${label} full validation identity differs from the artifact manifest`);
  const endpointIdentity = [
    `device=${rootStat.dev}`,
    `inode=${rootStat.ino}`,
    `mode=${rootStat.mode.toString(8)}`,
    `size=${rootStat.size}`,
    `mtimeNs=${rootStat.mtimeNs}`,
    `ctimeNs=${rootStat.ctimeNs}`,
  ].join(',');
  const treeSha256 = typedTreeDigest(root);
  releaseSnapshots.push(Object.freeze({
    root,
    testedSha: verified.release.testedSha,
    artifactManifestSha256: verified.artifactManifestSha256,
    endpointIdentity,
    treeSha256,
    installedImmutable,
  }));
  return Object.freeze({
    root,
    release: verified.release,
    artifactManifestSha256: verified.artifactManifestSha256,
    releaseJsonSha256: releaseJson.sha256,
    manifestSha256: manifest.sha256,
    endpointIdentity,
    treeSha256,
  });
}

function runtimeBinding(path, expectedSha = null) {
  const runtime = parseEnv(path, 'runtime env');
  const validationArgs = ['--env', runtime.absolute];
  if (expectedSha !== null) validationArgs.push('--expected-sha', expectedSha);
  runNode(VALIDATE_CONFIG, validationArgs, 'runtime configuration validation');
  assert(FULL_SHA.test(runtime.values.I00_TESTED_SHA)
    && FULL_SHA.test(runtime.values.I00_DEPLOYED_SHA)
    && runtime.values.I00_TESTED_SHA === runtime.values.I00_DEPLOYED_SHA,
  'runtime configuration does not bind one deployed tested SHA');
  exactText(runtime.values.I00_CONFIG_REVISION, 'runtime I00_CONFIG_REVISION');
  return Object.freeze({
    absolute: runtime.absolute,
    sha256: runtime.sha256,
    endpointIdentity: endpointIdentityForStat(runtime.stat),
    deployedSha: runtime.values.I00_DEPLOYED_SHA,
    configVersion: runtime.values.I00_CONFIG_REVISION,
    source: { role: 'RUNTIME_ENV', sha256: runtime.sha256 },
  });
}

function sanitizedEnv(path, profile, commands, {
  firstHost = false,
  requireHash = false,
} = {}) {
  const source = canonicalFile(path, `${profile} env`);
  const commandArgs = [
    '--env', source.absolute,
    '--result-fd', '3',
    '--profile', profile,
    '--node', commands.node.path,
    '--bash', commands.bash.path,
    '--env-bin', commands.env.path,
    '--require-effect-bindings',
    '--provenance-mode', artifactPolicy.rootMode,
  ];
  if (artifactPolicy.rootMode !== 'SYSTEM') {
    commandArgs.push('--provenance-root', artifactPolicy.proofRoot);
  }
  if (profile === 'deploy') {
    commandArgs.push('--systemctl', commands.systemctl.path, '--curl', commands.curl.path);
    if (firstHost) commandArgs.push('--require-first-host-no-current');
  } else {
    commandArgs.push('--sqlite', commands.sqlite.path, '--tar', commands.tar.path);
    if (requireHash) {
      commandArgs.push('--hash', commands['hash-command'].path, '--require-hash');
    }
  }
  const result = spawnSync(process.execPath, [SANITIZE_ENV, ...commandArgs], {
    encoding: null,
    env: {
      HOME: '/nonexistent',
      LANG: 'C',
      LC_ALL: 'C',
      PATH: SAFE_PATH,
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    maxBuffer: 2 * 1024 * 1024,
  });
  assert(result.error === undefined && result.status === 0,
    `${profile} env sanitization failed`);
  assert(Buffer.isBuffer(result.stdout)
    && result.stdout.equals(Buffer.from('{"status":"SANITIZED_DONOR_ENV_EMITTED"}\n'))
    && Buffer.isBuffer(result.stderr) && result.stderr.length === 0,
  `${profile} env sanitization returned unexpected control output`);
  const bytes = result.output?.[3];
  assert(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1024 * 1024,
    `${profile} env sanitization did not emit bounded descriptor bytes`);
  const values = parseEnvBytes(bytes, `sanitized ${profile} env`);
  return Object.freeze({
    bytes,
    sha256: sha256Bytes(bytes),
    values,
    sourcePath: source.absolute,
    source: {
      role: profile === 'deploy' ? 'DEPLOY_ENV' : 'BACKUP_ENV',
      sha256: source.sha256,
    },
  });
}

function effectEnvironmentEndpoints(environment) {
  return Object.freeze([
    'effect-environment-fd-token:/proc/self/fd/12',
    `effect-environment-sha256:${environment.sha256}`,
    `effect-environment-source-path:${environment.sourcePath}`,
  ]);
}

function deployHelperPolicyEndpoints(environment, donor) {
  const exposure = inspectedExecutable(
    resolve(SCRIPT_DIR, 'exposure-from-app.mjs'),
    'exposure helper',
  );
  const alert = inspectedExecutable(
    resolve(donor.root, 'bin', 'alert-log.sh'),
    'local alert helper',
  );
  const expected = Object.freeze({
    GATE_TIMEOUT_SEC: '60',
    HTTP_TIMEOUT_SEC: '5',
    LOCK_TIMEOUT_SEC: '30',
    I00_OPS_READBACK_TIMEOUT_MS: '750',
    I00_OPS_READBACK_URL:
      'http://127.0.0.1:8080/api/system-integration/ops/readback',
  });
  for (const [key, value] of Object.entries(expected)) {
    assert(environment.values[key] === value,
      `sanitized deploy env ${key} differs from the fixed helper policy`);
  }
  assert(environment.values.EXPOSURE_CMD === undefined
    && environment.values.ALERT_CMD === undefined,
  'sanitized deploy env retains named helper command authority');
  return Object.freeze([
    ...executableEndpoints('exposure-helper', exposure),
    'exposure-helper-argv-shape:NO_ARGS',
    'exposure-helper-timeout-ms:3000',
    ...executableEndpoints('alert-helper', alert),
    'alert-helper-argv-shape:SEVERITY_CODE_MESSAGE',
    'alert-helper-timeout-ms:5000',
    `gate-timeout-sec:${expected.GATE_TIMEOUT_SEC}`,
    `http-timeout-sec:${expected.HTTP_TIMEOUT_SEC}`,
    `lock-timeout-sec:${expected.LOCK_TIMEOUT_SEC}`,
    `ops-readback-timeout-ms:${expected.I00_OPS_READBACK_TIMEOUT_MS}`,
    `ops-readback-url:${expected.I00_OPS_READBACK_URL}`,
  ]);
}

function trustedBuildKey(path) {
  const key = canonicalFile(path, 'trusted build public key', 64 * 1024);
  return Object.freeze({
    sha256: key.sha256,
    source: { role: 'TRUSTED_BUILD_PUBLIC_KEY', sha256: key.sha256 },
  });
}

function effectiveDonorBinding(simulationRoot) {
  const root = canonicalDirectory(
    simulationRoot === null
      ? resolve(I00_ROOT, 'accepted-ops-live')
      : args['simulation-donor-root'],
    'effective donor root',
  );
  const contract = canonicalFile(resolve(I00_ROOT, 'donor-contract.json'), 'donor contract');
  const amendment = canonicalFile(
    resolve(I00_ROOT, 'l15-amendment-contract.json'),
    'L15 amendment contract',
  );
  const verifyArgs = [
    '--contract', contract.absolute,
    '--amendment-contract', amendment.absolute,
    '--root', root,
  ];
  if (simulationRoot === null) verifyArgs.push('--require-immutable');
  const raw = runNode(VERIFY_DONOR_ROOT, verifyArgs, 'effective donor verification');
  let verified;
  try {
    verified = JSON.parse(raw);
  } catch {
    throw new Error('effective donor verification returned invalid JSON');
  }
  assert(verified.status === 'EXECUTED_EFFECTIVE_L15_ROOT_VERIFIED'
    && verified.root === root
    && verified.immutableDonorContractSha256 === contract.sha256
    && verified.amendmentContractSha256 === amendment.sha256
    && DIGEST.test(verified.effectiveRootDigestSha256),
  'effective donor verification identity is invalid');
  const stat = lstatSync(root, { bigint: true });
  const endpointIdentity = [
    `device=${stat.dev}`,
    `inode=${stat.ino}`,
    `mode=${stat.mode.toString(8)}`,
    `size=${stat.size}`,
    `mtimeNs=${stat.mtimeNs}`,
    `ctimeNs=${stat.ctimeNs}`,
  ].join(',');
  donorSnapshots.push(Object.freeze({
    root,
    endpointIdentity,
    treeSha256: verified.effectiveRootDigestSha256,
    contractPath: contract.absolute,
    contractSha256: contract.sha256,
    amendmentPath: amendment.absolute,
    amendmentSha256: amendment.sha256,
    requireImmutable: simulationRoot === null,
  }));
  return Object.freeze({
    root,
    endpoints: Object.freeze([
      `donor-contract-sha256:${contract.sha256}`,
      `effective-donor-identity:${endpointIdentity}`,
      `effective-donor-root:${root}`,
      `effective-donor-tree-sha256:${verified.effectiveRootDigestSha256}`,
      `l15-amendment-contract-sha256:${amendment.sha256}`,
    ]),
    sources: Object.freeze([
      { role: 'DONOR_CONTRACT', sha256: contract.sha256 },
      { role: 'L15_AMENDMENT_CONTRACT', sha256: amendment.sha256 },
    ]),
  });
}

function backupBinding(path) {
  const root = canonicalDirectory(path, 'backup source');
  const raw = runNode(INSPECT_BACKUP, ['--path', root], 'backup source inspection');
  let inspected;
  try {
    inspected = JSON.parse(raw);
  } catch {
    throw new Error('backup source inspection returned invalid JSON');
  }
  exactKeys(inspected, [
    'status', 'path', 'manifestSha256', 'databaseSha256', 'createdAtUtc',
    'eventsCount', 'dataSchema', 'archiveCount', 'treeSha256', 'identity',
    'endpointIdentity',
  ], 'backup source inspection');
  assert(inspected.status === 'BACKUP_SOURCE_IDENTITY_VERIFIED'
    && DIGEST.test(inspected.manifestSha256)
    && DIGEST.test(inspected.databaseSha256)
    && DIGEST.test(inspected.treeSha256)
    && EXACT_UTC_SECONDS.test(inspected.createdAtUtc)
    && Number.isSafeInteger(inspected.eventsCount)
    && Number.isSafeInteger(inspected.archiveCount),
  'backup source inspection is invalid');
  const manifest = canonicalFile(resolve(root, 'manifest.json'), 'backup manifest');
  const database = canonicalFile(
    resolve(root, 'cosmos.db'),
    'backup database',
    128 * 1024 * 1024 * 1024,
  );
  assert(manifest.sha256 === inspected.manifestSha256
    && database.sha256 === inspected.databaseSha256,
  'backup source changed after inspection');
  return Object.freeze({
    ...inspected,
    sources: Object.freeze([
      { role: 'BACKUP_DATABASE', sha256: database.sha256 },
      { role: 'BACKUP_MANIFEST', sha256: manifest.sha256 },
    ]),
  });
}

function firstHostBinding(directory, expectedSystemctl, simulationRoot) {
  const root = canonicalDirectory(directory, 'first-host evidence directory');
  const hostPath = resolve(root, 'host.json');
  const evidencePath = resolve(root, 'collected-evidence.json');
  const files = new Map();
  for (const name of ['host.json', 'supervisor.json', 'collected-evidence.json', 'sqlite-readback.json']) {
    const file = canonicalFile(resolve(root, name), `first-host ${name}`);
    assert((file.stat.mode & 0o777n) === 0o600n, `first-host ${name} mode must be 0600`);
    files.set(name, file);
  }
  let evidenceDocument;
  try {
    evidenceDocument = JSON.parse(files.get('collected-evidence.json').bytes);
  } catch {
    throw new Error('first-host collected evidence is not valid JSON');
  }
  assert(files.get('collected-evidence.json').bytes.equals(
    Buffer.from(`${JSON.stringify(evidenceDocument, null, 2)}\n`),
  ), 'first-host collected evidence is not canonical JSON');
  exactKeys(evidenceDocument, [
    'schemaVersion', 'source', 'recoveryTarget', 'observedAtUtc', 'validUntilUtc',
    'owner', 'sanitizedDonorEnv', 'paths', 'release', 'sqliteReadback', 'disk',
    'links', 'baseline', 'derived',
  ], 'first-host collected evidence');
  exactKeys(evidenceDocument.baseline, [
    'cosmosRoot', 'releasesDir', 'releaseDestination', 'dataDir', 'opsStateDir',
    'journal', 'frozenMarker', 'moneyReadyMarker', 'unit',
  ], 'first-host evidence.baseline');
  const unit = evidenceDocument.baseline.unit;
  const offline = unit?.observationMode === 'PRIVATE_OFFLINE_UNIT_ROOT';
  let readbackSystemctl = null;
  if (offline) {
    exactKeys(unit, [
      'observationMode',
      'systemctlPath', 'systemctlSha256', 'systemctlIdentity',
      'unit', 'state', 'exitCode',
      'offlineUnitRoot', 'offlineUnitRootIdentity', 'offlineUnitTreeSha256',
    ], 'first-host evidence.baseline.unit');
  } else {
    exactKeys(unit, [
      'systemctlPath', 'systemctlSha256', 'systemctlIdentity', 'unit', 'state',
      'exitCode',
    ], 'first-host evidence.baseline.unit');
  }
  assert(evidenceDocument.schemaVersion === 1
    && evidenceDocument.source === 'FIRST_HOST_BOOTSTRAP_EVIDENCE'
    && evidenceDocument.recoveryTarget === 'NO_PRIOR_RELEASE_FIRST_HOST',
  'first-host evidence source or recovery target is invalid');
  assert(EXACT_UTC_SECONDS.test(evidenceDocument.observedAtUtc)
    && EXACT_UTC_SECONDS.test(evidenceDocument.validUntilUtc)
    && Number.isFinite(Date.parse(evidenceDocument.observedAtUtc))
    && Number.isFinite(Date.parse(evidenceDocument.validUntilUtc)),
  'first-host evidence window must use exact UTC seconds');
  const firstHostObservedMs = Date.parse(evidenceDocument.observedAtUtc);
  const firstHostValidUntilMs = Date.parse(evidenceDocument.validUntilUtc);
  const evidenceReferenceMs = Date.parse(evidenceReferenceUtc);
  assert(firstHostObservedMs < firstHostValidUntilMs,
    'first-host evidence window chronology is invalid');
  assert(firstHostObservedMs <= evidenceReferenceMs,
    'first-host evidence observedAtUtc is in the future');
  assert(evidenceReferenceMs - firstHostObservedMs <= HOST_READBACK_MAX_AGE_MS,
    'first-host evidence is stale');
  assert(evidenceReferenceMs < firstHostValidUntilMs,
    'first-host evidence has expired');
  evidenceFreshUntilMs = Math.min(evidenceFreshUntilMs, firstHostValidUntilMs);
  if (offline) {
    exactKeys(unit.offlineUnitRootIdentity, [
      'device', 'inode', 'mode', 'uid', 'gid', 'mtimeNs', 'ctimeNs',
    ], 'first-host evidence.baseline.unit.offlineUnitRootIdentity');
    for (const key of ['device', 'inode', 'uid', 'gid', 'mtimeNs', 'ctimeNs']) {
      assert(/^(?:0|[1-9][0-9]*)$/u.test(unit.offlineUnitRootIdentity[key]),
        `first-host offline root identity.${key} is not canonical`);
    }
    assert(/^[1-7][0-7]+$/u.test(unit.offlineUnitRootIdentity.mode),
      'first-host offline root identity.mode is not canonical');
    assert(artifactPolicy.rootMode === 'STAGING'
      && unit.systemctlPath === null
      && unit.systemctlSha256 === null
      && unit.systemctlIdentity === null
      && unit.state === 'INACTIVE'
      && unit.exitCode === null
      && DIGEST.test(unit.offlineUnitTreeSha256)
      && unit.offlineUnitRoot
        === resolve(artifactPolicy.proofRoot, 'first-host-offline-systemd'),
    'first-host offline unit evidence has an invalid closed state');
    const offlineRoot = canonicalDirectory(
      unit.offlineUnitRoot,
      'first-host offline unit root',
    );
    const stat = lstatSync(offlineRoot, { bigint: true });
    const identity = {
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
      mode: stat.mode.toString(8),
      uid: stat.uid.toString(),
      gid: stat.gid.toString(),
      mtimeNs: stat.mtimeNs.toString(),
      ctimeNs: stat.ctimeNs.toString(),
    };
    assert(stat.uid === 0n
      && (stat.mode & 0o7777n) === 0o700n
      && readdirSync(offlineRoot).length === 0
      && JSON.stringify(identity) === JSON.stringify(unit.offlineUnitRootIdentity)
      && typedTreeDigest(offlineRoot) === unit.offlineUnitTreeSha256
      && lstatSync(resolve(offlineRoot, unit.unit), { throwIfNoEntry: false }) === undefined,
    'first-host offline unit root differs from collected evidence');
    firstHostOfflineSnapshots.push(Object.freeze({
      root: offlineRoot,
      unit: unit.unit,
      identity: Object.freeze(identity),
      treeSha256: unit.offlineUnitTreeSha256,
    }));
  } else {
    const recordedIdentity = canonicalExecutableIdentity(
      unit.systemctlIdentity,
      'first-host evidence.baseline.unit.systemctlIdentity',
    );
    readbackSystemctl = inspectedExecutable(
      unit.systemctlPath,
      'first-host readback systemctl',
    );
    assert(artifactPolicy.rootMode !== 'STAGING'
      && DIGEST.test(unit.systemctlSha256)
      && unit.systemctlPath === readbackSystemctl.path
      && unit.systemctlSha256 === readbackSystemctl.sha256
      && recordedIdentity === readbackSystemctl.endpointIdentity
      && JSON.stringify(unit.systemctlIdentity)
        === JSON.stringify(readbackSystemctl.identity),
    'first-host systemctl evidence differs from current producer binding');
    if (artifactPolicy.rootMode === 'TEST') {
      assert(simulationRoot !== null
        && dirname(readbackSystemctl.path) === simulationRoot,
      'first-host TEST readback systemctl escaped the simulation command root');
    } else {
      assert(readbackSystemctl.path === expectedSystemctl.path
        && readbackSystemctl.sha256 === expectedSystemctl.sha256
        && readbackSystemctl.endpointIdentity === expectedSystemctl.endpointIdentity,
      'first-host SYSTEM readback systemctl differs from the effect binding');
    }
    assert((unit.state === 'INACTIVE' && unit.exitCode === 3)
      || (unit.state === 'NOT_FOUND' && unit.exitCode === 4),
    'first-host systemctl state is invalid');
  }
  const binding = hostBinding(hostPath, evidencePath);
  const evidence = files.get('collected-evidence.json').sha256;
  assert(DIGEST.test(evidence), 'first-host collected evidence digest is unavailable');
  return Object.freeze({
    ...binding,
    firstHostEvidenceSha256: evidence,
    readbackSystemctl,
    sources: Object.freeze([
      ...binding.sources,
      { role: 'FIRST_HOST_EVIDENCE', sha256: evidence },
    ]),
  });
}

function requireFirstHostSemanticPreflight(
  directory,
  release,
  deploy,
  expectedSystemctl,
  simulationRoot,
) {
  const evidenceRoot = canonicalDirectory(directory, 'first-host evidence directory');
  const offline = artifactPolicy.rootMode === 'STAGING';
  const transientParent = artifactPolicy.rootMode === 'TEST'
    ? artifactPolicy.proofRoot
    : canonicalDirectory(dirname(resolve(args.output)), 'risk output parent');
  const temporary = offline
    ? null
    : mkdtempSync(resolve(transientParent, '.first-host-preflight-'));
  if (temporary !== null) chmodSync(temporary, 0o700);
  const donorEnv = offline
    ? resolve(artifactPolicy.proofRoot, 'sanitized', 'deploy.env')
    : resolve(temporary, 'deploy.env');
  try {
    if (offline) {
      const existing = canonicalFile(donorEnv, 'STAGING first-host sanitized deploy env');
      assert(existing.sha256 === deploy.sha256 && existing.bytes.equals(deploy.bytes),
        'STAGING first-host sanitized deploy env differs from descriptor output');
    } else {
      writeFileSync(donorEnv, deploy.bytes, { flag: 'wx', mode: 0o600 });
      chmodSync(donorEnv, 0o600);
    }
    const preflightArguments = [
      '--release', release.root,
      '--host', resolve(evidenceRoot, 'host.json'),
      '--supervisor', resolve(evidenceRoot, 'supervisor.json'),
      '--mode', 'deploy',
      '--max-host-age-sec', '300',
      '--max-supervisor-age-sec', '300',
      '--required-supervisor-window-sec', '300',
      '--recovery-target', 'NO_PRIOR_RELEASE_FIRST_HOST',
      '--first-host-evidence', resolve(evidenceRoot, 'collected-evidence.json'),
      '--donor-env', donorEnv,
    ];
    if (!offline) {
      preflightArguments.push(
        '--systemctl-path', expectedSystemctl.path,
        '--systemctl-sha256', expectedSystemctl.sha256,
        '--systemctl-identity', expectedSystemctl.endpointIdentity,
      );
    }
    if (artifactPolicy.rootMode === 'TEST') {
      preflightArguments.push(
        '--simulation-clock',
        '--now', evidenceReferenceUtc,
        '--simulation-root', artifactPolicy.proofRoot,
      );
    } else {
      assert(simulationRoot === null,
        'non-TEST first-host semantic preflight rejects a simulation root');
    }
    const raw = runNode(
      PREFLIGHT,
      preflightArguments,
      'first-host canonical semantic preflight',
    );
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error('first-host canonical semantic preflight returned invalid JSON');
    }
    assert(result.status === 'PREFLIGHT_PASS_NO_MUTATION'
      && result.mode === 'deploy'
      && result.releaseId === release.release.releaseId
      && result.releaseIntegrity === 'MANIFEST_VERIFIED'
      && result.artifactManifestSha256 === release.artifactManifestSha256
      && result.blocker === null,
    'first-host canonical semantic preflight result is invalid');
  } finally {
    if (temporary !== null) rmSync(temporary, { recursive: true, force: true });
  }
}

function evidenceDocument(binding, endpoints, sources) {
  assert(artifactPolicy !== null && requestForEffectPaths !== null,
    'artifact policy is unavailable during evidence derivation');
  const existing = Object.fromEntries(endpoints
    .filter((endpoint) => endpoint.includes(':'))
    .map((endpoint) => {
      const split = endpoint.indexOf(':');
      return [endpoint.slice(0, split), endpoint.slice(split + 1)];
    }));
  const programPrefix = args.class === 'SECRET_MATERIALIZATION' ? 'node' : 'bash';
  for (const suffix of ['path', 'sha256', 'identity']) {
    assert(existing[`${programPrefix}-${suffix}`],
      `effect program ${programPrefix}-${suffix} is unavailable`);
  }
  const effectUid = existing['effect-uid'] ?? '0';
  const effectGid = existing['effect-gid'] ?? '0';
  if (['BACKUP_CREATE', 'ISOLATED_RESTORE'].includes(args.class)) {
    assert(existing['effect-uid'] !== undefined && existing['effect-gid'] !== undefined,
      'non-root effect identity is unavailable');
  }
  const evidenceName = createHash('sha256')
    .update(requestForEffectPaths.authorizationId)
    .update(Buffer.from([0]))
    .update(args.class)
    .digest('hex');
  const delegatedScriptPath = {
    OPS_BUNDLE_INSTALL: resolve(SCRIPT_DIR, 'install-ops-bundle.sh'),
    SERVICE_RELEASE_SWITCH: `${existing['effective-donor-root']}/bin/deploy.sh`,
    SERVICE_ROLLBACK: `${existing['effective-donor-root']}/bin/rollback.sh`,
    BACKUP_CREATE: `${existing['effective-donor-root']}/bin/backup.sh`,
    ISOLATED_RESTORE: `${existing['effective-donor-root']}/bin/restore.sh`,
    SECRET_MATERIALIZATION: resolve(SCRIPT_DIR, 'secrets-provider.mjs'),
  }[args.class];
  const delegatedScript = inspectedExecutable(
    delegatedScriptPath,
    'delegated effect script',
  );
  const effectCommon = args.class === 'SECRET_MATERIALIZATION'
    ? (() => {
        const source = canonicalFile(
          VERIFY_AUTHORIZED_EFFECT_HANDOFF,
          'authorized effect handoff verifier source',
        );
        return Object.freeze({
          path: source.absolute,
          sha256: source.sha256,
          endpointIdentity: endpointIdentityForStat(source.stat),
        });
      })()
    : existing['effective-donor-root'] === undefined
      ? Object.freeze({
        path: 'NONE',
        sha256: 'NONE',
        endpointIdentity: 'NONE',
      })
      : inspectedExecutable(
          resolve(existing['effective-donor-root'], 'bin', 'common.sh'),
          'delegated effect common library',
        );
  const effectEndpoints = [
    `completion-reserve-seconds:${{
      OPS_BUNDLE_INSTALL: 300,
      SERVICE_RELEASE_SWITCH: 300,
      SERVICE_ROLLBACK: 300,
      BACKUP_CREATE: 900,
      ISOLATED_RESTORE: 1800,
      SECRET_MATERIALIZATION: 300,
    }[args.class]}`,
    `effect-common-identity:${effectCommon.endpointIdentity}`,
    `effect-common-path:${effectCommon.path}`,
    `effect-common-sha256:${effectCommon.sha256}`,
    `effect-finish-evidence:${artifactPolicy.effectEvidenceRoot}/${evidenceName}.terminal.json`,
    ...(existing['effect-gid'] === undefined ? [`effect-gid:${effectGid}`] : []),
    `effect-program-identity:${existing[`${programPrefix}-identity`]}`,
    `effect-program-path:${existing[`${programPrefix}-path`]}`,
    `effect-program-sha256:${existing[`${programPrefix}-sha256`]}`,
    `effect-script-identity:${delegatedScript.endpointIdentity}`,
    `effect-script-path:${delegatedScript.path}`,
    `effect-script-sha256:${delegatedScript.sha256}`,
    `effect-start-evidence:${artifactPolicy.effectEvidenceRoot}/${evidenceName}.start.json`,
    ...(existing['effect-uid'] === undefined ? [`effect-uid:${effectUid}`] : []),
    `receipt-publication-reserve-seconds:${{
      OPS_BUNDLE_INSTALL: 60,
      SERVICE_RELEASE_SWITCH: 60,
      SERVICE_ROLLBACK: 60,
      BACKUP_CREATE: 120,
      ISOLATED_RESTORE: 300,
      SECRET_MATERIALIZATION: 60,
    }[args.class]}`,
  ];
  return Object.freeze({
    actionClass: args.class,
    deployedSha: binding.deployedSha,
    configVersion: binding.configVersion,
    account: binding.account,
    environment: binding.environment,
    host: binding.host,
    allowedEndpoints: Object.freeze([...endpoints, ...effectEndpoints].sort()),
    evidenceProvenance: Object.freeze({
      derivationMode: 'CLASS_SPECIFIC_VERIFIED_EVIDENCE',
      sources: Object.freeze([...sources].sort((left, right) => left.role.localeCompare(right.role))),
    }),
    enforcementProvenance: executingI00EnforcementProvenance(),
  });
}

function deriveOpsInstall(request, simulationRoot) {
  const host = hostBinding(args['host-readback'], args['host-evidence']);
  const release = releaseBinding(args.release, args['trusted-build-public-key']);
  const trust = trustedBuildKey(args['trusted-build-public-key']);
  const commands = commandSet([
    'node', 'bash', 'mkdir', 'cp', 'chmod', 'mv', 'rm',
  ], simulationRoot);
  const destinationBinding = boundFutureDirectChild(
    args.destination,
    'ops-bundle destination',
  );
  const destination = destinationBinding.target;
  assert(destination === exactClassTarget(
    '/usr/local/lib/cosmos-ops/i00',
    'install/i00',
    'ops-bundle destination',
  ), 'ops-bundle destination differs from its class-specific target');
  return evidenceDocument({
    deployedSha: release.release.testedSha,
    configVersion: exactText(release.release.configRevision, 'release configRevision'),
    account: host.account,
    environment: host.environment,
    host: host.host,
  }, [
    `artifact-manifest-sha256:${release.artifactManifestSha256}`,
    ...executableEndpoints('bash', commands.bash),
    ...executableEndpoints('chmod', commands.chmod),
    ...executableEndpoints('cp', commands.cp),
    `destination:${destination}`,
    `destination-parent-identity:${destinationBinding.parent.identity}`,
    `destination-parent-path:${destinationBinding.parent.path}`,
    ...executableEndpoints('mkdir', commands.mkdir),
    ...executableEndpoints('mv', commands.mv),
    ...executableEndpoints('node', commands.node),
    `release-identity:${release.endpointIdentity}`,
    `release-path:${release.root}`,
    `release-sha:${release.release.testedSha}`,
    `release-tree-sha256:${release.treeSha256}`,
    ...executableEndpoints('rm', commands.rm),
    `trusted-builder-public-key-sha256:${trust.sha256}`,
  ], [
    { role: 'ARTIFACT_MANIFEST', sha256: release.manifestSha256 },
    ...host.sources,
    { role: 'RELEASE_JSON', sha256: release.releaseJsonSha256 },
    trust.source,
  ]);
}

function deriveReleaseSwitch(request, simulationRoot) {
  const commands = commandSet(['node', 'bash', 'env', 'systemctl', 'curl'], simulationRoot);
  const isFirstHost = Boolean(args['first-host-evidence-dir']);
  const firstHost = args['first-host-evidence-dir']
    ? firstHostBinding(
        args['first-host-evidence-dir'],
        commands.systemctl,
        simulationRoot,
      )
    : hostBinding(args['host-readback'], args['host-evidence']);
  const release = releaseBinding(args.release, args['trusted-build-public-key']);
  const runtime = runtimeBinding(
    args['runtime-env'],
    release.release.testedSha,
  );
  assert(runtime.configVersion === release.release.configRevision,
    'runtime and release configuration revisions differ');
  const trust = trustedBuildKey(args['trusted-build-public-key']);
  const donor = effectiveDonorBinding(simulationRoot);
  commands.sqlite = inspectedExecutable(
    simulationRoot === null ? realpathSync(args.sqlite) : resolve(simulationRoot, 'sqlite3'),
    'sqlite',
  );
  const deploy = sanitizedEnv(args['deploy-env'], 'deploy', commands, {
    firstHost: isFirstHost,
  });
  if (isFirstHost) {
    requireFirstHostSemanticPreflight(
      args['first-host-evidence-dir'],
      release,
      deploy,
      firstHost.readbackSystemctl,
      simulationRoot,
    );
  }
  let current = null;
  let automaticRollback = null;
  let rollbackEvidenceRoot = null;
  if (!isFirstHost) {
    const currentLink = exactText(deploy.values.CURRENT_LINK, 'deploy env CURRENT_LINK');
    const currentLinkStat = lstatSync(currentLink, { throwIfNoEntry: false });
    assert(currentLinkStat?.isSymbolicLink(),
      'later release switch CURRENT_LINK must be one exact symlink');
    current = releaseBinding(
      realpathSync(currentLink),
      args['trusted-build-public-key'],
      'current release',
      { installedImmutable: true },
    );
    assert(current.root !== release.root
      && current.release.testedSha !== release.release.testedSha,
    'later release switch current and target releases must be distinct');
    automaticRollback = inspectedExecutable(
      resolve(donor.root, 'bin', 'rollback.sh'),
      'automatic rollback script',
    );
    rollbackEvidenceRoot = classRollbackEvidenceRoot();
  }
  const appUnit = appUnitBinding(
    commands,
    deploy.values.APP_UNIT,
    runtime,
    firstHost.environment,
    simulationRoot,
    donor,
  );
  const sqliteVersionOutput = spawnSync(commands.sqlite.path, ['--version'], {
    encoding: 'utf8',
    env: { LANG: 'C', LC_ALL: 'C', PATH: SAFE_PATH, TZ: 'UTC' },
    maxBuffer: 64 * 1024,
  });
  assert(sqliteVersionOutput.status === 0, 'SQLite version readback failed');
  const sqliteVersion = exactText(
    sqliteVersionOutput.stdout.trim().split(/\s+/u)[0],
    'SQLite version',
  );
  const endpoints = [
    ...appUnit.endpoints,
    `artifact-manifest-sha256:${release.artifactManifestSha256}`,
    `backup-reserve-bytes:${firstHost.backupReserveBytes}`,
    ...executableEndpoints('bash', commands.bash),
    ...executableEndpoints('curl', commands.curl),
    `data-dir:${deploy.values.DATA_DIR}`,
    ...deploymentWriteRootEndpoints(deploy),
    ...donor.endpoints,
    `donor-env-sha256:${deploy.sha256}`,
    ...effectEnvironmentEndpoints(deploy),
    ...deployHelperPolicyEndpoints(deploy, donor),
    ...executableEndpoints('env', commands.env),
    ...executableEndpoints('node', commands.node),
    `release-path:${release.root}`,
    `release-identity:${release.endpointIdentity}`,
    `release-sha:${release.release.testedSha}`,
    `release-tree-sha256:${release.treeSha256}`,
    ...executableEndpoints('sqlite', commands.sqlite),
    `sqlite-version:${sqliteVersion}`,
    ...executableEndpoints('systemctl', commands.systemctl),
    `trusted-builder-public-key-sha256:${trust.sha256}`,
  ];
  if (isFirstHost) endpoints.push(
    `first-host-account:${firstHost.account}`,
    `first-host-environment:${firstHost.environment}`,
    `first-host-evidence-sha256:${firstHost.firstHostEvidenceSha256}`,
    `first-host-target-host:${firstHost.host}`,
    'recovery-target:NO_PRIOR_RELEASE_FIRST_HOST',
  );
  else endpoints.push(
    ...executableEndpoints('automatic-rollback-script', automaticRollback),
    `current-artifact-manifest-sha256:${current.artifactManifestSha256}`,
    `current-release-identity:${current.endpointIdentity}`,
    `current-release-path:${current.root}`,
    `current-release-sha:${current.release.testedSha}`,
    `current-release-tree-sha256:${current.treeSha256}`,
    `rollback-evidence-root:${rollbackEvidenceRoot.path}`,
    `rollback-evidence-root-identity:${rollbackEvidenceRoot.identity}`,
  );
  return evidenceDocument({
    deployedSha: release.release.testedSha,
    configVersion: runtime.configVersion,
    account: firstHost.account,
    environment: firstHost.environment,
    host: firstHost.host,
  }, endpoints, [
    { role: 'ARTIFACT_MANIFEST', sha256: release.manifestSha256 },
    deploy.source,
    ...donor.sources,
    ...firstHost.sources,
    ...(current === null ? [] : [
      { role: 'CURRENT_ARTIFACT_MANIFEST', sha256: current.manifestSha256 },
      { role: 'CURRENT_RELEASE_JSON', sha256: current.releaseJsonSha256 },
    ]),
    { role: 'RELEASE_JSON', sha256: release.releaseJsonSha256 },
    runtime.source,
    trust.source,
  ]);
}

function deriveRollback(request, simulationRoot) {
  const host = hostBinding(args['host-readback'], args['host-evidence']);
  const release = releaseBinding(
    args.release,
    args['trusted-build-public-key'],
    'rollback release',
    { installedImmutable: true },
  );
  const runtime = runtimeBinding(args['runtime-env'], release.release.testedSha);
  const trust = trustedBuildKey(args['trusted-build-public-key']);
  const donor = effectiveDonorBinding(simulationRoot);
  const commands = commandSet(['node', 'bash', 'env', 'systemctl', 'curl'], simulationRoot);
  const deploy = sanitizedEnv(args['deploy-env'], 'deploy', commands);
  const appUnit = appUnitBinding(
    commands,
    deploy.values.APP_UNIT,
    runtime,
    host.environment,
    simulationRoot,
    donor,
  );
  const currentLink = exactText(deploy.values.CURRENT_LINK, 'deploy env CURRENT_LINK');
  assert(lstatSync(currentLink).isSymbolicLink(), 'deploy env CURRENT_LINK must be one symlink');
  const currentRoot = realpathSync(currentLink);
  const current = releaseBinding(
    currentRoot,
    args['trusted-build-public-key'],
    'current release',
    { installedImmutable: true },
  );
  const rollbackEvidenceRoot = classRollbackEvidenceRoot();
  assert(args['rollback-evidence-root'] === rollbackEvidenceRoot.path,
    'rollback evidence root differs from its class-specific target');
  assert(current.root !== release.root && current.release.testedSha !== release.release.testedSha,
    'rollback current and target releases must be distinct');
  return evidenceDocument({
    deployedSha: release.release.testedSha,
    configVersion: runtime.configVersion,
    account: host.account,
    environment: host.environment,
    host: host.host,
  }, [
    ...appUnit.endpoints,
    `artifact-manifest-sha256:${release.artifactManifestSha256}`,
    ...executableEndpoints('bash', commands.bash),
    ...executableEndpoints('curl', commands.curl),
    `current-artifact-manifest-sha256:${current.artifactManifestSha256}`,
    `current-release-identity:${current.endpointIdentity}`,
    `current-release-path:${current.root}`,
    `current-release-sha:${current.release.testedSha}`,
    `current-release-tree-sha256:${current.treeSha256}`,
    `data-dir:${deploy.values.DATA_DIR}`,
    ...deploymentWriteRootEndpoints(deploy),
    ...donor.endpoints,
    `donor-env-sha256:${deploy.sha256}`,
    ...effectEnvironmentEndpoints(deploy),
    ...deployHelperPolicyEndpoints(deploy, donor),
    ...executableEndpoints('env', commands.env),
    ...executableEndpoints('node', commands.node),
    `release-path:${release.root}`,
    `release-identity:${release.endpointIdentity}`,
    `release-id:${release.release.releaseId}`,
    `release-sha:${release.release.testedSha}`,
    `release-tree-sha256:${release.treeSha256}`,
    `rollback-evidence-root:${rollbackEvidenceRoot.path}`,
    `rollback-evidence-root-identity:${rollbackEvidenceRoot.identity}`,
    ...executableEndpoints('systemctl', commands.systemctl),
    `trusted-builder-public-key-sha256:${trust.sha256}`,
  ], [
    { role: 'ARTIFACT_MANIFEST', sha256: release.manifestSha256 },
    { role: 'CURRENT_ARTIFACT_MANIFEST', sha256: current.manifestSha256 },
    { role: 'CURRENT_RELEASE_JSON', sha256: current.releaseJsonSha256 },
    deploy.source,
    ...donor.sources,
    ...host.sources,
    { role: 'RELEASE_JSON', sha256: release.releaseJsonSha256 },
    runtime.source,
    trust.source,
  ]);
}

function backupCommands(simulationRoot, backupEnvPath) {
  const preliminary = parseEnv(backupEnvPath, 'backup env');
  assert((preliminary.values.EVIDENCE_PATHS ?? '') === '',
    'backup authorization rejects EVIDENCE_PATHS without explicit read-root capability');
  const commands = commandSet([
    'node', 'bash', 'env', 'tar', 'gzip', 'hash-command', 'id', 'getent', 'setpriv',
  ], simulationRoot);
  const sqlitePath = simulationRoot === null
    ? realpathSync(exactText(preliminary.values.SQLITE, 'backup env SQLITE'))
    : resolve(simulationRoot, 'sqlite3');
  commands.sqlite = inspectedExecutable(sqlitePath, 'sqlite');
  return commands;
}

function effectIdentityBinding(donor, commands, unitName) {
  const output = runNode(INSPECT_EFFECT_IDENTITY, [
    '--unit', `${donor.root}/systemd/${unitName}`,
    '--id', commands.id.path,
    '--getent', commands.getent.path,
    '--expected-user', 'cosmos',
    '--expected-group', 'cosmos',
  ], 'effect identity inspection');
  let inspected;
  try {
    inspected = JSON.parse(output);
  } catch {
    throw new Error('effect identity inspection returned invalid JSON');
  }
  exactKeys(inspected, [
    'schemaVersion', 'status', 'unitPath', 'unitSha256', 'unitIdentity',
    'user', 'group', 'uid', 'gid', 'idPath', 'idSha256', 'idIdentity',
    'getentPath', 'getentSha256', 'getentIdentity',
  ], 'effect identity inspection');
  assert(inspected.schemaVersion === 1
    && inspected.status === 'EFFECT_IDENTITY_VERIFIED'
    && inspected.user === 'cosmos'
    && inspected.group === 'cosmos'
    && /^(?:0|[1-9][0-9]*)$/u.test(inspected.uid)
    && /^(?:0|[1-9][0-9]*)$/u.test(inspected.gid)
    && DIGEST.test(inspected.unitSha256)
    && inspected.idPath === commands.id.path
    && inspected.idSha256 === commands.id.sha256
    && inspected.idIdentity === commands.id.endpointIdentity
    && inspected.getentPath === commands.getent.path
    && inspected.getentSha256 === commands.getent.sha256
    && inspected.getentIdentity === commands.getent.endpointIdentity,
  'effect identity inspection differs from the bound resolvers');
  return Object.freeze([
    `effect-gid:${inspected.gid}`,
    `effect-group:${inspected.group}`,
    `effect-unit-identity:${inspected.unitIdentity}`,
    `effect-unit-path:${inspected.unitPath}`,
    `effect-unit-sha256:${inspected.unitSha256}`,
    `effect-uid:${inspected.uid}`,
    `effect-user:${inspected.user}`,
    ...executableEndpoints('getent', commands.getent),
    ...executableEndpoints('id', commands.id),
    ...executableEndpoints('setpriv', commands.setpriv),
  ]);
}

function deriveBackup(request, simulationRoot) {
  const host = hostBinding(args['host-readback'], args['host-evidence']);
  const runtime = runtimeBinding(args['runtime-env']);
  const commands = backupCommands(simulationRoot, args['backup-env']);
  const donor = effectiveDonorBinding(simulationRoot);
  const backup = sanitizedEnv(args['backup-env'], 'backup', commands, { requireHash: true });
  assert((backup.values.EVIDENCE_PATHS ?? '') === '',
    'backup authorization rejects EVIDENCE_PATHS without explicit read-root capability');
  const effectIdentity = effectIdentityBinding(
    donor,
    commands,
    'cosmos-backup.service',
  );
  return evidenceDocument({
    deployedSha: runtime.deployedSha,
    configVersion: runtime.configVersion,
    account: host.account,
    environment: host.environment,
    host: host.host,
  }, [
    ...backupWriteRootEndpoints(backup),
    ...executableEndpoints('bash', commands.bash),
    ...dataDirectoryEndpoints(backup.values.DATA_DIR, 'backup data directory'),
    ...donor.endpoints,
    `donor-env-sha256:${backup.sha256}`,
    ...effectEnvironmentEndpoints(backup),
    ...effectIdentity,
    ...executableEndpoints('env', commands.env),
    'gzip-argv-shape:TAR_MANAGED',
    'gzip-fd-token:/proc/self/fd/39',
    ...executableEndpoints('gzip', commands.gzip),
    ...executableEndpoints('hash-command', commands['hash-command']),
    ...executableEndpoints('node', commands.node),
    ...executableEndpoints('sqlite', commands.sqlite),
    ...executableEndpoints('tar', commands.tar),
  ], [
    backup.source,
    ...donor.sources,
    ...host.sources,
    runtime.source,
  ]);
}

function deriveRestore(request, simulationRoot) {
  const host = hostBinding(args['host-readback'], args['host-evidence']);
  const runtime = runtimeBinding(args['runtime-env']);
  const commands = backupCommands(simulationRoot, args['backup-env']);
  const donor = effectiveDonorBinding(simulationRoot);
  const env = sanitizedEnv(args['backup-env'], 'backup', commands, { requireHash: true });
  const effectIdentity = effectIdentityBinding(
    donor,
    commands,
    'cosmos-restore-drill.service',
  );
  const backup = backupBinding(args.backup);
  const backupMaxAgeHoursRaw = env.values.BACKUP_MAX_AGE_HOURS ?? '26';
  assert(/^[1-9][0-9]{0,3}$/u.test(backupMaxAgeHoursRaw)
    && Number(backupMaxAgeHoursRaw) <= 8_760,
  'backup max age must be one canonical bounded positive hour count');
  const backupMaxAgeHours = Number(backupMaxAgeHoursRaw);
  const backupCreatedAtMs = Date.parse(backup.createdAtUtc);
  const restoreReferenceMs = Date.parse(evidenceReferenceUtc);
  assert(backupCreatedAtMs <= restoreReferenceMs
    && restoreReferenceMs - backupCreatedAtMs <= backupMaxAgeHours * 60 * 60 * 1_000,
  'backup source is stale or future-dated at the derivation boundary');
  evidenceFreshUntilMs = Math.min(
    evidenceFreshUntilMs,
    backupCreatedAtMs + (backupMaxAgeHours * 60 * 60 * 1_000),
  );
  const target = canonicalRestoreTarget(args.target);
  assert(!pathIntersectsFixedProductionUnion(target, 'isolated restore target'),
    'isolated restore target intersects a fixed production root');
  const targetParent = boundDirectory(dirname(target), 'isolated restore target parent');
  assert(dirname(target) === targetParent.path,
    'isolated restore target must be one direct child of its physical bound parent');
  const backupDir = boundDirectory(
    env.values.BACKUP_DIR,
    'restore observed backup directory',
  );
  const dataDir = boundDirectory(env.values.DATA_DIR, 'production data directory');
  const overlaps = (left, right) => (
    left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
  );
  assert(!overlaps(target, dataDir.path)
    && !overlaps(target, backup.path)
    && !overlaps(backup.path, dataDir.path),
  'restore target, backup source, and production data directory must be disjoint');
  return evidenceDocument({
    deployedSha: runtime.deployedSha,
    configVersion: runtime.configVersion,
    account: host.account,
    environment: host.environment,
    host: host.host,
  }, [
    `backup-database-sha256:${backup.databaseSha256}`,
    `backup-archive-count:${backup.archiveCount}`,
    `backup-created-at-utc:${backup.createdAtUtc}`,
    `backup-data-schema:${backup.dataSchema === null ? 'null' : backup.dataSchema}`,
    `backup-events-count:${backup.eventsCount}`,
    `backup-identity:${backup.endpointIdentity}`,
    `backup-manifest-sha256:${backup.manifestSha256}`,
    `backup-max-age-hours:${backupMaxAgeHours}`,
    `backup-path:${backup.path}`,
    `backup-tree-sha256:${backup.treeSha256}`,
    `backup-dir:${backupDir.path}`,
    `backup-dir-identity:${backupDir.identity}`,
    ...executableEndpoints('bash', commands.bash),
    ...dataDirectoryEndpoints(dataDir.path, 'production data directory'),
    ...donor.endpoints,
    `donor-env-sha256:${env.sha256}`,
    ...effectEnvironmentEndpoints(env),
    ...effectIdentity,
    ...executableEndpoints('env', commands.env),
    'gzip-argv-shape:TAR_MANAGED',
    'gzip-fd-token:/proc/self/fd/39',
    ...executableEndpoints('gzip', commands.gzip),
    ...executableEndpoints('hash-command', commands['hash-command']),
    `isolated-target:${target}`,
    `isolated-target-parent-identity:${targetParent.identity}`,
    `isolated-target-parent-path:${targetParent.path}`,
    ...executableEndpoints('node', commands.node),
    ...executableEndpoints('sqlite', commands.sqlite),
    ...executableEndpoints('tar', commands.tar),
  ], [
    ...backup.sources,
    ...donor.sources,
    env.source,
    ...host.sources,
    runtime.source,
  ]);
}

function deriveSecret(request, simulationRoot) {
  const provider = jsonEvidence(args['provider-config'], 'secret provider config', [
    'schemaVersion', 'secretArn', 'region', 'instanceRoleArn', 'awsCliPath',
    'awsCliSha256', 'secretVersionId', 'targetHost', 'environment', 'operator', 'deployedSha',
    'configVersion', 'deploymentRisk', 'actionPreview', 'authorizationConsumptionRoot',
    'resultReceiptTarget', 'reconciliationReceiptTarget', 'requiredKeys',
  ]);
  assert(provider.absolute === exactClassTarget(
    '/etc/cosmos/secrets-provider.json',
    'config/secrets-provider.json',
    'secret provider config',
  ), 'secret provider config differs from its class-specific target');
  const config = provider.document;
  assert(config.schemaVersion === 2 && FULL_SHA.test(config.deployedSha),
    'secret provider config identity is invalid');
  for (const key of ['targetHost', 'environment', 'operator', 'configVersion', 'region']) {
    exactText(config[key], `secret provider config.${key}`);
  }
  assert(config.operator === request.operator,
    'secret provider operator differs from the owner request');
  assert(config.resultReceiptTarget === request.receiptTargets.result
    && config.reconciliationReceiptTarget === request.receiptTargets.reconciliation,
  'secret provider receipt targets differ from the owner request');
  assert(Array.isArray(config.requiredKeys) && config.requiredKeys.length > 0
    && new Set(config.requiredKeys).size === config.requiredKeys.length,
  'secret provider requiredKeys are invalid');
  const secretMatch = /^arn:aws:secretsmanager:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/u.exec(config.secretArn);
  const roleMatch = /^arn:aws:iam::(\d{12}):role\/[A-Za-z0-9_+=,.@-]{1,64}$/u.exec(config.instanceRoleArn);
  assert(secretMatch !== null && roleMatch !== null
    && secretMatch[1] === config.region && secretMatch[2] === roleMatch[1],
  'secret provider region/account binding is invalid');
  assert(typeof config.secretVersionId === 'string'
    && /^[A-Za-z0-9-]{32,64}$/u.test(config.secretVersionId),
  'secret provider version identifier must be one exact 32-64 character alphanumeric-or-hyphen VersionId');
  const commands = commandSet(['node'], simulationRoot);
  const authorizationWrapper = inspectedExecutable(
    resolve(SCRIPT_DIR, 'secret-materialization.mjs'),
    'secret materialization authorization wrapper',
  );
  const aws = inspectedExecutable(config.awsCliPath, 'AWS CLI');
  assert(aws.sha256 === config.awsCliSha256,
    'secret provider AWS CLI digest differs from executable evidence');
  const credentialOutput = canonicalFuturePath(args['credential-output'], 'credential output');
  assert(credentialOutput === exactClassTarget(
    '/run/cosmos-secret-source/app-secrets.json',
    'credentials/app-secrets.json',
    'credential output',
  ), 'credential output differs from its class-specific target');
  const credentialOutputParent = boundPrivateDirectory(
    dirname(credentialOutput),
    'credential output parent',
  );
  assert(dirname(credentialOutput) === credentialOutputParent.path
    && lstatSync(credentialOutput, { throwIfNoEntry: false }) === undefined,
  'credential output must be one absent direct child of the bound private parent');
  return evidenceDocument({
    deployedSha: config.deployedSha,
    configVersion: config.configVersion,
    account: `aws:${secretMatch[2]}`,
    environment: config.environment,
    host: config.targetHost,
  }, [
    credentialOutput,
    config.secretArn,
    `authorization-wrapper-identity:${authorizationWrapper.endpointIdentity}`,
    `authorization-wrapper-path:${authorizationWrapper.path}`,
    `authorization-wrapper-sha256:${authorizationWrapper.sha256}`,
    `aws-cli-identity:${aws.endpointIdentity}`,
    `aws-cli-path:${aws.path}`,
    `aws-cli-sha256:${aws.sha256}`,
    `aws-region:${config.region}`,
    `instance-role-arn:${config.instanceRoleArn}`,
    ...executableEndpoints('node', commands.node),
    `credential-output-parent-identity:${credentialOutputParent.identity}`,
    `credential-output-parent-path:${credentialOutputParent.path}`,
    `credential-output-path:${credentialOutput}`,
    `provider-config-identity:${endpointIdentityForStat(provider.stat)}`,
    `provider-config-path:${provider.absolute}`,
    `provider-config-sha256:${provider.sha256}`,
    `secret-version-id:${config.secretVersionId}`,
    ...config.requiredKeys.map((key) => `required-key:${exactText(key, 'required key')}`),
  ], [
    { role: 'PROVIDER_CONFIG', sha256: provider.sha256 },
  ]);
}

function recheckSources() {
  for (const [path, expected] of snapshots.entries()) {
    const current = canonicalFile(path, expected.label, expected.maximumBytes);
    assert(current.sha256 === expected.sha256
      && sameRegularFileIdentity(current.identity, expected.identity),
    `evidence source changed before publication: ${path}`);
  }
  for (const expected of releaseSnapshots) {
    const current = verifyArtifactManifest(expected.root, null, {
      installedImmutable: expected.installedImmutable,
    });
    const currentStat = lstatSync(expected.root, { bigint: true });
    const currentIdentity = [
      `device=${currentStat.dev}`,
      `inode=${currentStat.ino}`,
      `mode=${currentStat.mode.toString(8)}`,
      `size=${currentStat.size}`,
      `mtimeNs=${currentStat.mtimeNs}`,
      `ctimeNs=${currentStat.ctimeNs}`,
    ].join(',');
    if (expected.installedImmutable) {
      requireNonWritableTree(expected.root, 'installed immutable release recheck');
    }
    assert(current.release.testedSha === expected.testedSha
      && current.artifactManifestSha256 === expected.artifactManifestSha256
      && currentIdentity === expected.endpointIdentity
      && typedTreeDigest(expected.root) === expected.treeSha256,
    'release evidence changed before publication');
  }
  for (const expected of donorSnapshots) {
    const stat = lstatSync(expected.root, { bigint: true });
    const identity = [
      `device=${stat.dev}`,
      `inode=${stat.ino}`,
      `mode=${stat.mode.toString(8)}`,
      `size=${stat.size}`,
      `mtimeNs=${stat.mtimeNs}`,
      `ctimeNs=${stat.ctimeNs}`,
    ].join(',');
    const verifyArgs = [
      '--contract', expected.contractPath,
      '--amendment-contract', expected.amendmentPath,
      '--root', expected.root,
    ];
    if (expected.requireImmutable) verifyArgs.push('--require-immutable');
    const verified = JSON.parse(
      runNode(VERIFY_DONOR_ROOT, verifyArgs, 'effective donor recheck'),
    );
    assert(identity === expected.endpointIdentity
      && verified.effectiveRootDigestSha256 === expected.treeSha256
      && verified.immutableDonorContractSha256 === expected.contractSha256
      && verified.amendmentContractSha256 === expected.amendmentSha256,
    'effective donor evidence changed before publication');
  }
  for (const expected of appUnitSnapshots) {
    const current = JSON.parse(runNode(
      INSPECT_APP_UNIT,
      [
        ...expected.commandArguments,
        '--expected-binding-sha256',
        expected.inspected.bindingSha256,
      ],
      'app unit recheck',
    ));
    assert(JSON.stringify(current) === JSON.stringify(expected.inspected),
      'app unit binding changed before publication');
  }
  for (const expected of firstHostOfflineSnapshots) {
    const root = canonicalDirectory(expected.root, 'first-host offline unit root recheck');
    const stat = lstatSync(root, { bigint: true });
    const identity = {
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
      mode: stat.mode.toString(8),
      uid: stat.uid.toString(),
      gid: stat.gid.toString(),
      mtimeNs: stat.mtimeNs.toString(),
      ctimeNs: stat.ctimeNs.toString(),
    };
    assert(stat.uid === 0n
      && (stat.mode & 0o7777n) === 0o700n
      && readdirSync(root).length === 0
      && JSON.stringify(identity) === JSON.stringify(expected.identity)
      && typedTreeDigest(root) === expected.treeSha256
      && lstatSync(resolve(root, expected.unit), { throwIfNoEntry: false }) === undefined,
    'first-host offline unit root changed before publication');
  }
}

try {
  for (const name of ['request', 'class', 'output']) {
    if (!args[name]) throw new Error(`--${name} is required`);
  }
  const classArguments = CLASS_ARGUMENTS[args.class];
  assert(classArguments !== undefined, '--class is not one supported deployment action class');
  const allowed = new Set([...COMMON_ARGUMENTS, ...classArguments]);
  for (const name of Object.keys(args)) {
    assert(allowed.has(name), `unsupported argument --${name} for ${args.class}`);
  }
  for (const name of REQUIRED_CLASS_ARGUMENTS[args.class]) {
    if (args.class === 'SERVICE_RELEASE_SWITCH'
        && ['host-readback', 'host-evidence'].includes(name)
        && args['first-host-evidence-dir']) continue;
    assert(args[name], `--${name} is required for ${args.class}`);
  }
  if (args.class === 'SERVICE_RELEASE_SWITCH') {
    const firstHost = Boolean(args['first-host-evidence-dir']);
    assert(firstHost !== Boolean(args['host-readback'] || args['host-evidence']),
      'release switch requires either complete normal-host evidence or one first-host evidence directory');
    if (!firstHost) assert(args['host-readback'] && args['host-evidence'],
      'normal release switch requires complete host evidence');
  }
  if (args['simulation-clock'] !== true && (args.now !== undefined || args.nonce !== undefined
      || args['simulation-command-root'] !== undefined
      || args['simulation-donor-root'] !== undefined
      || args['simulation-publication-now'] !== undefined)) {
    throw new Error('simulation clock inputs are accepted only with --simulation-clock');
  }
  if (args['simulation-clock'] === true && (!args.now || !args.nonce
      || !args['simulation-command-root'])) {
    throw new Error('simulation clock requires exact --now, --nonce, and --simulation-command-root');
  }
  if (args['simulation-clock'] === true
      && (args['isolated-staging-root'] || args['app-unit-fragment'])) {
    throw new Error('simulation clock derives its staging root and rejects isolated staging path inputs');
  }
  if (args['simulation-clock'] === true && args['root-mode'] !== 'TEST') {
    throw new Error('simulation clock requires TEST root mode');
  }
  if (args['simulation-clock'] !== true && args['root-mode'] === 'TEST') {
    throw new Error('TEST root mode requires the simulation clock');
  }
  const simulationRoot = args['simulation-clock'] === true
    ? canonicalDirectory(args['simulation-command-root'], 'simulation command root')
    : null;
  if (args['simulation-clock'] === true
      && ['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK', 'BACKUP_CREATE', 'ISOLATED_RESTORE'].includes(args.class)) {
    assert(args['simulation-donor-root'],
      `--simulation-donor-root is required for ${args.class}`);
  }
  const request = readCanonicalDeploymentDocument(
    args.request,
    'deployment action request',
    validateDeploymentActionRequest,
  );
  artifactPolicy = buildArtifactPolicy(args.class);
  requestForEffectPaths = request.document;
  assert(typeof args.output === 'string' && isAbsolute(args.output)
    && resolve(args.output) === args.output
    && dirname(args.output) === artifactPolicy.authorizationRoot
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/u.test(basename(args.output)),
  'risk output must be one raw canonical direct-child JSON leaf of the authorization root');
  recheckArtifactPolicy(artifactPolicy);
  const derive = {
    OPS_BUNDLE_INSTALL: deriveOpsInstall,
    SERVICE_RELEASE_SWITCH: deriveReleaseSwitch,
    SERVICE_ROLLBACK: deriveRollback,
    BACKUP_CREATE: deriveBackup,
    ISOLATED_RESTORE: deriveRestore,
    SECRET_MATERIALIZATION: deriveSecret,
  }[args.class];
  const derivationReferenceUtc = args['simulation-clock'] === true
    ? args.now
    : new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
  assert(EXACT_UTC_SECONDS.test(derivationReferenceUtc)
    && Number.isFinite(Date.parse(derivationReferenceUtc)),
  'risk derivation reference time must be exact UTC seconds');
  evidenceReferenceUtc = derivationReferenceUtc;
  const evidence = derive(request.document, simulationRoot);
  if (['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK'].includes(args.class)) {
    assertPendingProviderDocumentSeparation(evidence, [args.output]);
  }
  if (artifactPolicy.rootMode === 'STAGING') {
    const suffix = basename(artifactPolicy.proofRoot).slice('cosmos-df32-proof-'.length);
    assert(evidence.host === `cosmos-df32-proof-${suffix}.internal`
      && evidence.environment === `isolated-staging-${suffix}`,
    'STAGING host and environment must bind the proof-root suffix');
  }
  const issuedAtUtc = args['simulation-clock'] === true
    ? (args['simulation-publication-now'] ?? args.now)
    : new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
  assert(EXACT_UTC_SECONDS.test(issuedAtUtc) && Number.isFinite(Date.parse(issuedAtUtc)),
    'risk publication time must be exact UTC seconds');
  assert(Date.parse(issuedAtUtc) >= Date.parse(derivationReferenceUtc),
    'risk publication time precedes derivation');
  assert(Date.parse(issuedAtUtc) <= evidenceFreshUntilMs,
    'verified deployment evidence expired during risk derivation');
  if (args['simulation-clock'] !== true) {
    assert(Date.now() < Date.parse(request.document.startsAtUtc),
      'risk derivation crossed the authorization start boundary');
  }
  const evidenceValidUntilMs = Math.min(
    evidenceFreshUntilMs,
    Date.parse(request.document.expiresAtUtc),
  );
  assert(Number.isFinite(evidenceValidUntilMs)
    && Date.parse(request.document.startsAtUtc) < evidenceValidUntilMs,
  'verified mutable evidence does not remain active through authorization start');
  const evidenceValidUntilUtc = new Date(evidenceValidUntilMs)
    .toISOString()
    .replace('.000Z', 'Z');
  assert(EXACT_UTC_SECONDS.test(evidenceValidUntilUtc),
    'verified mutable evidence horizon is not exact UTC seconds');
  const document = buildDeploymentRiskVersionForCanonicalProducer(request.document, evidence, {
    issuedAtUtc,
    evidenceValidUntilUtc,
    artifactPolicy,
    ...(args['simulation-clock'] === true ? { nonce: args.nonce } : {}),
    provenanceMode: {
      SYSTEM: 'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
      STAGING: 'STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
      TEST: 'TEST_FIXTURE_INJECTED',
    }[artifactPolicy.rootMode],
  });
  recheckSources();
  recheckArtifactPolicy(artifactPolicy);
  assert(
    JSON.stringify(document.enforcementProvenance)
      === JSON.stringify(executingI00EnforcementProvenance()),
    'executing I00 enforcement tree changed before risk publication',
  );
  const finalPublicationNowMs = args['simulation-clock'] === true
    ? Date.parse(issuedAtUtc)
    : Date.now();
  assert(finalPublicationNowMs <= evidenceFreshUntilMs,
    'verified deployment evidence expired before risk publication');
  assert(finalPublicationNowMs < Date.parse(request.document.startsAtUtc),
    'risk publication crossed the authorization start boundary');
  recheckArtifactPolicy(artifactPolicy);
  const output = writeExactPrivateJson(
    args.output,
    document,
    'deployment risk version',
    artifactPolicy.authorizationRootIdentity,
  );
  process.stdout.write(`${JSON.stringify({
    status: document.status,
    actionClass: document.binding.actionClass,
    output: output.absolute,
  })}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
