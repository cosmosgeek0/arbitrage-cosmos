#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readlinkSync, readSync, readdirSync,
  realpathSync, rmSync, rmdirSync, writeFileSync, writeSync,
} from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAuthorizationConsumption,
  canonicalJson,
  canonicalJsonBytes,
  sha256Bytes,
  validateDeploymentActionPreview,
  validateDeploymentRiskVersion,
} from '../deployment-authorization-contract.mjs';
import {
  validateAuthorizedEffectOutput,
  validateAuthorizedEffectStart,
  validateAuthorizedEffectTerminal,
} from '../authorized-effect-evidence.mjs';
import { compileJsonSchemaFile } from '../json-schema.mjs';
import { loadL15AmendmentContract } from '../l15-amendment.mjs';
import { fail, parseArgs, verifyArtifactManifest } from '../lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RESULT_SCHEMA = compileJsonSchemaFile(
  resolve(SCRIPT_DIR, '../schemas/authorized-action-result.schema.json'),
  'authorized action result schema',
);
const RECONCILIATION_SCHEMA = compileJsonSchemaFile(
  resolve(SCRIPT_DIR, '../schemas/authorized-action-reconciliation.schema.json'),
  'authorized action reconciliation schema',
);
const ROLLBACK_SCHEMA = compileJsonSchemaFile(
  resolve(SCRIPT_DIR, '../schemas/rollback-receipt.schema.json'),
  'rollback receipt schema',
);
const ROLLBACK_EFFECT_SCHEMA = compileJsonSchemaFile(
  resolve(SCRIPT_DIR, '../schemas/authorized-rollback-effect.schema.json'),
  'authorized rollback effect schema',
);
const ROLLBACK_REFUSAL_SCHEMA = compileJsonSchemaFile(
  resolve(SCRIPT_DIR, '../schemas/authorized-rollback-refusal.schema.json'),
  'authorized rollback refusal schema',
);
const I00_ROOT = resolve(SCRIPT_DIR, '..');
const EXPECTED_DONOR_CONTRACT_SHA256 =
  '078cc2a3d8bc79026f1de6985284856794e53ba34ffd7fda5d1140e46e31a1b3';
const EXPECTED_AMENDMENT_CONTRACT_SHA256 =
  'd4069053fecf4c7b7c8034956bebc2c95c4f6e6e3299daa02c1fe9e0d70031b9';
const INSTALL_RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'testedSha', 'sourceReleaseId', 'installedTreeDigestSha256',
  'effectiveOpsRoot', 'immutableDonorCommit', 'immutableDonorLiveTree',
  'immutableDonorContractSha256', 'amendmentContractSha256', 'effectiveLiveTree',
  'effectiveRootDigestSha256', 'i00EnforcementTreeDigestSha256',
  'authorizedCorrectionFindingIds', 'serviceMutationPerformed',
]);
const BACKUP_MANIFEST_KEYS = Object.freeze([
  'backupId', 'createdAtUtc', 'dbFile', 'dbSha256', 'dbBytes', 'eventsCount',
  'dataSchema', 'integrityCheck', 'evidence',
]);
const RESTORE_REPORT_KEYS = Object.freeze([
  'ts', 'backupId', 'target', 'production', 'dbSha256',
  'declaredEventsCount', 'eventsCount', 'declaredEvidenceArchives',
  'evidenceArchives', 'verifiedEvidenceArchives', 'archiveVerification',
]);
const ROLLBACK_EVIDENCE_FILES = Object.freeze({
  preTargetReadback: 'pre-target-readback.json',
  postTargetReadback: 'post-target-readback.json',
  cloudflareBoundary: 'cloudflare-boundary.json',
  watchdog: 'watchdog.json',
  databaseSchema: 'database-schema.json',
  backup: 'backup.json',
  recovery: 'recovery.json',
  reconciliation: 'reconciliation.json',
  authorization: 'authorization.json',
});
const ROLLBACK_EFFECT_FILE = 'rollback-effect.json';
const ROLLBACK_REFUSAL_FILE = 'rollback-refusal.json';
const ROLLBACK_REFUSAL_READBACK_FILE = 'refusal-readback.json';
const ROLLBACK_FROZEN_MARKER_FILE = 'frozen-marker.json';
const ROLLBACK_REFUSAL_CLASSES = Object.freeze({
  1: 'PRE_SWITCH_REFUSAL',
  4: 'DEPLOY_LOCK_BUSY',
  5: 'SCHEMA_INCOMPATIBLE',
  6: 'POLICY_REFUSED',
});
const CLOSED_ENV = Object.freeze({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
  HOME: '/',
  TMPDIR: '/tmp',
  LANG: 'C',
  LC_ALL: 'C',
  TZ: 'UTC',
});

const CLASS_OUTCOMES = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze({
    status: 'OPS_BUNDLE_INSTALLED_NO_SERVICE_MUTATION',
    disposition: 'SERVICE_MUTATION_NOT_PERFORMED',
    detail: 'immutable I00 bundle installed; service mutation absent',
  }),
  BACKUP_CREATE: Object.freeze({
    status: 'BACKUP_VERIFIED',
    disposition: 'SOURCE_PATH_NOT_MUTATED_BY_ACTION',
    detail: 'published backup passed integrity and foreign-key verification',
  }),
  ISOLATED_RESTORE: Object.freeze({
    status: 'ISOLATED_RESTORE_VERIFIED_NO_PRODUCTION_MUTATION',
    disposition: 'PRODUCTION_PATH_NOT_TARGETED',
    detail: 'isolated target passed integrity and foreign-key verification',
  }),
  SECRET_MATERIALIZATION: Object.freeze({
    status: 'SECRET_MATERIALIZED_WITHOUT_DISCLOSURE',
    disposition: 'ONLY_EXACT_PRIVATE_OUTPUT_PUBLISHED',
    detail: 'exact private runtime credential path published without value disclosure',
  }),
});
const CLASS_FAILURE_OUTCOMES = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze({
    status: 'OPS_BUNDLE_INSTALL_FAILED_AFTER_EFFECT',
    detail: 'authorized installation effect terminated; mutation remains possible',
  }),
  BACKUP_CREATE: Object.freeze({
    status: 'BACKUP_CREATE_FAILED_AFTER_EFFECT',
    detail: 'authorized backup effect terminated; mutation remains possible',
  }),
  ISOLATED_RESTORE: Object.freeze({
    status: 'ISOLATED_RESTORE_FAILED_AFTER_EFFECT',
    detail: 'authorized isolated restore effect terminated; mutation remains possible',
  }),
  SECRET_MATERIALIZATION: Object.freeze({
    status: 'SECRET_MATERIALIZATION_FAILED_AFTER_EFFECT',
    detail: 'authorized secret materialization effect terminated; mutation remains possible',
  }),
});
const BACKUP_OUTPUT_UNRESOLVED_OUTCOME = Object.freeze({
  status: 'BACKUP_OUTPUT_UNRESOLVED_REQUIRES_OWNER_ACTION',
  disposition: 'BACKUP_OUTPUT_UNRESOLVED_REQUIRES_OWNER_ACTION',
  detail: 'authorized backup terminal could not bind one exact created output; owner action required',
});

const TOP_LEVEL_AUTHORIZATION_KEYS = Object.freeze([
  'schemaVersion', 'authorizationId', 'operator', 'status', 'actionClasses',
  'scope', 'deployedSha', 'configVersion', 'riskVersion', 'nonce',
  'serverPreviewDigest', 'account', 'environment', 'host', 'issuedAtUtc',
  'startsAtUtc', 'expiresAtUtc', 'allowedCommands', 'allowedEndpoints',
  'allowedProducts', 'allowedCredentials', 'preconditions', 'maximumEffect',
  'rollback', 'recovery', 'ownerApproval', 'receiptTargets',
].sort());

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactObjectKeys(value, keys, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length
    && actual.every((key, index) => key === expected[index]),
  `${label} has an unexpected field set`);
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameStatIdentity(left, right) {
  return ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs']
    .every((field) => left[field] === right[field]);
}

function sameNamedObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function exactUtcSeconds(value, label) {
  assert(typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)),
  `${label} must be exact UTC seconds`);
  return value;
}

function provenanceBoundTimestamp(args, risk, label, {
  terminalTestFallback,
} = {}) {
  if (risk.provenanceMode === 'TEST_FIXTURE_INJECTED') {
    assert(args['simulation-clock'] === true,
      `${label} for test provenance requires --simulation-clock`);
    if (args.now !== undefined) return exactUtcSeconds(args.now, label);
    assert(terminalTestFallback !== undefined,
      `${label} for test provenance requires --now or validated terminal evidence`);
    return exactUtcSeconds(
      terminalTestFallback,
      `${label} from authorized effect terminal evidence`,
    );
  }
  assert([
    'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
    'STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
  ].includes(risk.provenanceMode),
    'deployment risk provenance mode is unsupported');
  assert(args['simulation-clock'] !== true && args.now === undefined,
    `${label} for production provenance forbids a caller clock`);
  return new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

function validateCompletionChronology(completedAtUtc, authorization, risk, consumption) {
  const issuedAt = Date.parse(risk.authorizationWindow.issuedAtUtc);
  const startsAt = Date.parse(risk.authorizationWindow.startsAtUtc);
  const expiresAt = Date.parse(risk.authorizationWindow.expiresAtUtc);
  const approvedAt = Date.parse(authorization.ownerApproval.approvedAtUtc);
  const consumedAt = Date.parse(consumption.consumedAtUtc);
  const completedAt = Date.parse(completedAtUtc);
  assert([issuedAt, startsAt, expiresAt, approvedAt, consumedAt, completedAt]
    .every(Number.isFinite), 'authorized action chronology contains an invalid instant');
  assert(issuedAt <= approvedAt && approvedAt <= startsAt
    && startsAt <= consumedAt && consumedAt <= completedAt
    && completedAt < expiresAt,
  'authorized action chronology must satisfy issue <= approval <= start <= consumption <= completion < expiry');
}

function endpointIdentity(stat) {
  return [
    ['device', stat.dev],
    ['inode', stat.ino],
    ['mode', stat.mode.toString(8)],
    ['size', stat.size],
    ['mtimeNs', stat.mtimeNs],
    ['ctimeNs', stat.ctimeNs],
  ].map(([key, value]) => `${key}=${value.toString()}`).join(',');
}

function stableRegular(path, label, {
  maximumBytes = 1024 * 1024,
  privateMode = false,
  requireOwner = false,
  allowRootOwner = false,
  capture = true,
} = {}) {
  const absolute = resolve(path);
  assert(absolute === path, `${label} path must be canonical absolute`);
  assert(typeof constants.O_NOFOLLOW === 'number'
    && typeof constants.O_NONBLOCK === 'number',
  `${label} runtime lacks required no-follow evidence support`);
  let descriptor;
  try {
    const namedBefore = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    assert(namedBefore?.isFile() && !namedBefore.isSymbolicLink()
      && namedBefore.nlink === 1n && realpathSync(absolute) === absolute,
    `${label} must be one canonical single-link regular file`);
    assert(namedBefore.size > 0n && namedBefore.size <= BigInt(maximumBytes),
      `${label} size is invalid`);
    if (privateMode) {
      assert((namedBefore.mode & 0o777n) === 0o600n, `${label} mode must be 0600`);
    }
    if ((privateMode || requireOwner) && typeof process.getuid === 'function') {
      assert(namedBefore.uid === BigInt(process.getuid())
        || (allowRootOwner && namedBefore.uid === 0n),
        `${label} owner is not the invoking identity`);
    }
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    assert(sameStatIdentity(namedBefore, openedBefore),
      `${label} identity changed before reading`);
    const hash = createHash('sha256');
    const chunks = [];
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const chunk = buffer.subarray(0, count);
      hash.update(chunk);
      if (capture) chunks.push(Buffer.from(chunk));
    }
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(absolute, { bigint: true });
    assert(sameStatIdentity(openedBefore, openedAfter)
      && sameStatIdentity(openedAfter, namedAfter)
      && realpathSync(absolute) === absolute,
    `${label} identity changed while reading`);
    return Object.freeze({
      absolute,
      ...(capture ? { bytes: Buffer.concat(chunks) } : {}),
      sha256: hash.digest('hex'),
      size: Number(openedAfter.size),
      stat: openedAfter,
      maximumBytes,
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function stableRegularHash(path, label, { maximumBytes }) {
  return stableRegular(path, label, { maximumBytes, capture: false });
}

function assertStableEvidence(initial, label) {
  const current = stableRegular(initial.absolute, label, {
    maximumBytes: initial.maximumBytes,
    capture: false,
  });
  assert(current.sha256 === initial.sha256
    && sameStatIdentity(current.stat, initial.stat),
  `${label} changed before outcome publication`);
}

function canonicalDirectory(path, label, { requireOwner = false, requirePrivate = false } = {}) {
  const absolute = resolve(path);
  assert(absolute === path, `${label} path must be canonical absolute`);
  const info = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  assert(info?.isDirectory() && !info.isSymbolicLink() && realpathSync(absolute) === absolute,
    `${label} must be a canonical non-symlink directory`);
  if (requirePrivate) {
    assert((info.mode & 0o777n) === 0o700n, `${label} mode must be 0700`);
  }
  if ((requireOwner || requirePrivate) && typeof process.getuid === 'function') {
    assert(info.uid === BigInt(process.getuid()),
      `${label} owner is not the invoking identity`);
  }
  return Object.freeze({ absolute, stat: info });
}

function canonicalExistingOrFuturePath(path, label) {
  const absolute = resolve(path);
  assert(absolute === path, `${label} must be one canonical absolute path`);
  const suffix = [];
  let cursor = absolute;
  for (;;) {
    try {
      const stat = lstatSync(cursor);
      assert(stat.isDirectory() && !stat.isSymbolicLink(),
        `${label} existing ancestor must be a real directory`);
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = dirname(cursor);
      assert(parent !== cursor, `${label} has no existing directory ancestor`);
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
  const canonical = resolve(realpathSync(cursor), ...suffix);
  assert(canonical === absolute, `${label} contains a symlinked or noncanonical ancestor`);
  return canonical;
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function scanTree(root, label, {
  excludeTopLevel = [],
  requireImmutable = false,
  requireOwner = false,
} = {}) {
  const rootInfo = canonicalDirectory(root, label, { requireOwner });
  const excluded = new Set(excludeTopLevel);
  const entries = [];
  let totalBytes = 0;
  let entryCount = 0;
  function walk(directory, relative = '') {
    const before = lstatSync(directory, { bigint: true });
    assert(before.isDirectory() && !before.isSymbolicLink()
      && realpathSync(directory) === directory,
    `${label} contains an unsafe directory`);
    const mode = before.mode & 0o7777n;
    assert((mode & 0o7000n) === 0n, `${label} contains a directory with special mode bits`);
    if (requireImmutable) {
      assert((mode & 0o222n) === 0n, `${label} contains a writable directory`);
    }
    if (requireOwner && typeof process.getuid === 'function') {
      assert(before.uid === BigInt(process.getuid()),
        `${label} contains a directory owned by another identity`);
    }
    const names = readdirSync(directory).sort();
    for (const name of names) {
      const next = relative ? `${relative}/${name}` : name;
      if (!relative && excluded.has(name)) continue;
      entryCount += 1;
      assert(entryCount <= 20_000, `${label} entry count exceeds its closed limit`);
      const absolute = resolve(directory, name);
      const named = lstatSync(absolute, { bigint: true });
      assert(!named.isSymbolicLink() && realpathSync(absolute) === absolute,
        `${label} contains a link or noncanonical entry`);
      if (named.isDirectory()) {
        entries.push(Object.freeze({ path: next, type: 'directory' }));
        walk(absolute, next);
        continue;
      }
      assert(named.isFile(), `${label} contains a special filesystem entry`);
      const fileMode = named.mode & 0o7777n;
      assert((fileMode & 0o7000n) === 0n, `${label} contains a file with special mode bits`);
      if (requireImmutable) {
        assert((fileMode & 0o222n) === 0n, `${label} contains a writable file`);
      }
      const executable = fileMode & 0o111n;
      assert(executable === 0n || executable === 0o111n,
        `${label} contains an ambiguous executable mode`);
      const evidence = stableRegular(absolute, `${label} file`, {
        maximumBytes: 512 * 1024 * 1024,
        capture: false,
        requireOwner,
      });
      totalBytes += evidence.size;
      assert(Number.isSafeInteger(totalBytes) && totalBytes <= 4 * 1024 * 1024 * 1024,
        `${label} byte count exceeds its closed limit`);
      entries.push(Object.freeze({
        path: next,
        type: 'file',
        mode: executable === 0o111n ? '100755' : '100644',
        sha256: evidence.sha256,
      }));
    }
    const after = lstatSync(directory, { bigint: true });
    assert(sameStatIdentity(before, after) && realpathSync(directory) === directory,
      `${label} directory identity changed while scanning`);
  }
  walk(rootInfo.absolute);
  const rootAfter = lstatSync(rootInfo.absolute, { bigint: true });
  assert(sameStatIdentity(rootInfo.stat, rootAfter),
    `${label} root identity changed while scanning`);
  return Object.freeze({ root: rootInfo.absolute, entries: Object.freeze(entries) });
}

function stableTree(root, label, options = {}) {
  const before = scanTree(root, label, options);
  const after = scanTree(root, label, options);
  assert(sameJson(before.entries, after.entries), `${label} changed while being verified`);
  return before;
}

function typedTreeDigest(entries) {
  const hash = createHash('sha256');
  for (const entry of entries) {
    if (entry.type === 'directory') {
      hash.update('directory\0');
      hash.update(entry.path);
      hash.update('\n');
      continue;
    }
    hash.update(entry.path);
    hash.update('\0');
    hash.update(entry.mode);
    hash.update('\0');
    hash.update(entry.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function regularTreeDigest(entries) {
  const hash = createHash('sha256');
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    hash.update(entry.path);
    hash.update('\0');
    hash.update(entry.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function directoryIdentityEndpoint(stat) {
  return [
    `device=${stat.dev}`,
    `inode=${stat.ino}`,
    `mode=${stat.mode.toString(8)}`,
    `uid=${stat.uid}`,
    `gid=${stat.gid}`,
  ].join(',');
}

function receiptRootBinding(risk) {
  const policy = risk?.artifactPolicy;
  assert(policy && typeof policy.receiptRoot === 'string'
    && typeof policy.receiptRootIdentity === 'string',
  'deployment risk lacks its receipt-root identity binding');
  return Object.freeze({
    path: policy.receiptRoot,
    identity: policy.receiptRootIdentity,
  });
}

function privateReceiptTarget(path, label, expectedRoot = null) {
  const absolute = resolve(path);
  assert(absolute === path, `${label} must be a canonical absolute path`);
  const parent = dirname(absolute);
  const parentInfo = lstatSync(parent, { bigint: true, throwIfNoEntry: false });
  assert(parentInfo?.isDirectory() && !parentInfo.isSymbolicLink()
    && realpathSync(parent) === parent
    && (parentInfo.mode & 0o777n) === 0o700n,
  `${label} parent must be one canonical mode-0700 directory`);
  if (expectedRoot !== null) {
    assert(parent === expectedRoot.path
      && directoryIdentityEndpoint(parentInfo) === expectedRoot.identity,
    `${label} parent differs from the deployment receipt-root binding`);
  }
  if (typeof process.getuid === 'function') {
    assert(parentInfo.uid === BigInt(process.getuid()),
      `${label} parent owner is not the invoking identity`);
  }
  assert(lstatSync(absolute, { throwIfNoEntry: false }) === undefined,
    `${label} must be absent before the authorized action`);
  return absolute;
}

function endpoint(action, prefix) {
  const marker = `${prefix}:`;
  const values = action.allowedEndpoints
    .filter((entry) => entry.startsWith(marker))
    .map((entry) => entry.slice(marker.length));
  assert(values.length === 1, `action preview must bind one ${prefix} endpoint`);
  return values[0];
}

function standalonePathEndpoint(action, path) {
  return action.allowedEndpoints.filter((entry) => entry === path).length === 1;
}

function readCanonicalEvidence(path, label, validate) {
  assert(typeof path === 'string' && resolve(path) === path,
    `${label} path must be one raw canonical absolute path`);
  const evidence = stableRegular(path, label, { maximumBytes: 4 * 1024 * 1024 });
  let document;
  try {
    document = JSON.parse(evidence.bytes);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  assert(evidence.bytes.equals(canonicalJsonBytes(document)), `${label} bytes are not canonical`);
  const validated = validate(document);
  return Object.freeze({ ...evidence, document, validated });
}

function parseEvidenceJson(evidence, label) {
  try {
    return JSON.parse(evidence.bytes);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertExactJsonSerialization(evidence, value, label, { pretty = true } = {}) {
  const expected = Buffer.from(
    `${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`,
    'utf8',
  );
  assert(evidence.bytes.equals(expected),
    `${label} bytes differ from the exact producer serialization`);
}

function verifyTrustedExecutableAncestors(path) {
  let child = path;
  let cursor = dirname(path);
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true });
    assert(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(cursor) === cursor,
      'SQLite executable ancestor chain must contain only canonical directories');
    const mode = stat.mode & 0o7777n;
    if (invokingUid !== null) {
      assert(stat.uid === 0n || stat.uid === invokingUid,
        'SQLite executable ancestor chain has an untrusted owner');
    }
    if ((mode & 0o022n) !== 0n) {
      const childStat = lstatSync(child, { bigint: true });
      assert((mode & 0o1000n) !== 0n && stat.uid === 0n
        && !childStat.isSymbolicLink()
        && (invokingUid === null || childStat.uid === 0n || childStat.uid === invokingUid),
      'SQLite executable ancestor chain contains an unsafe writable boundary');
    }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    child = cursor;
    cursor = parent;
  }
}

function verifyTrustedDirectoryChain(path, label) {
  let cursor = path;
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true });
    assert(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(cursor) === cursor,
      `${label} ancestor chain must contain only canonical directories`);
    const mode = stat.mode & 0o7777n;
    if (invokingUid !== null) {
      assert(stat.uid === 0n || stat.uid === invokingUid,
        `${label} ancestor chain has an untrusted owner`);
    }
    if ((mode & 0o022n) !== 0n) {
      assert(stat.uid === 0n && (mode & 0o1000n) !== 0n,
        `${label} ancestor chain contains an unsafe writable directory`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function inspectSqliteExecutable(action) {
  const path = endpoint(action, 'sqlite-path');
  const evidence = stableRegular(path, 'SQLite executable', {
    maximumBytes: 512 * 1024 * 1024,
    capture: false,
    requireOwner: true,
    allowRootOwner: true,
  });
  const mode = evidence.stat.mode & 0o7777n;
  assert((mode & 0o111n) !== 0n && (mode & 0o022n) === 0n
    && (mode & 0o7000n) === 0n,
  'SQLite executable mode is unsafe');
  verifyTrustedExecutableAncestors(path);
  assert(evidence.sha256 === endpoint(action, 'sqlite-sha256'),
    'SQLite executable digest differs from the consumed preview');
  assert(endpointIdentity(evidence.stat) === endpoint(action, 'sqlite-identity'),
    'SQLite executable identity differs from the consumed preview');
  return evidence;
}

function assertSameSqlite(initial, action) {
  const current = inspectSqliteExecutable(action);
  assert(current.absolute === initial.absolute && current.sha256 === initial.sha256
    && sameStatIdentity(current.stat, initial.stat),
  'SQLite executable identity changed around outcome verification');
}

function withIsolatedDatabaseCopy(database, label, callback) {
  const source = stableRegularHash(database, `${label} source database`, {
    maximumBytes: 128 * 1024 * 1024 * 1024,
  });
  verifyTrustedDirectoryChain(realpathSync('/tmp'), `${label} temporary base`);
  const temporaryBaseInfo = canonicalDirectory(
    realpathSync('/tmp'),
    `${label} temporary base`,
  );
  const temporaryBase = temporaryBaseInfo.absolute;
  const temporaryBaseMode = temporaryBaseInfo.stat.mode & 0o7777n;
  assert(temporaryBaseInfo.stat.uid === 0n
    && ((temporaryBaseMode & 0o022n) === 0n
      || (temporaryBaseMode & 0o1000n) !== 0n),
  `${label} temporary base is not a trusted root-owned sticky boundary`);
  const temporaryRoot = mkdtempSync(resolve(temporaryBase, 'i00-outcome-sqlite-'));
  chmodSync(temporaryRoot, 0o700);
  const temporaryIdentity = lstatSync(temporaryRoot, { bigint: true });
  assert(temporaryIdentity.isDirectory() && !temporaryIdentity.isSymbolicLink()
    && (temporaryIdentity.mode & 0o777n) === 0o700n
    && realpathSync(temporaryRoot) === temporaryRoot,
  `${label} isolated SQLite directory is unsafe`);
  if (typeof process.getuid === 'function') {
    assert(temporaryIdentity.uid === BigInt(process.getuid()),
      `${label} isolated SQLite directory owner changed`);
  }
  const copy = resolve(temporaryRoot, 'cosmos.db');
  let input;
  let output;
  let heldCopy;
  try {
    input = openSync(
      source.absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const inputBefore = fstatSync(input, { bigint: true });
    assert(sameStatIdentity(inputBefore, source.stat),
      `${label} source database changed before isolated copy`);
    output = openSync(
      copy,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let copied = 0n;
    for (;;) {
      const count = readSync(input, buffer, 0, buffer.length, null);
      if (count === 0) break;
      let offset = 0;
      while (offset < count) {
        offset += writeSync(output, buffer, offset, count - offset, null);
      }
      copied += BigInt(count);
    }
    fsyncSync(output);
    const inputAfter = fstatSync(input, { bigint: true });
    const sourceNamedAfter = lstatSync(source.absolute, { bigint: true });
    const outputAfter = fstatSync(output, { bigint: true });
    assert(sameStatIdentity(inputBefore, inputAfter)
      && sameStatIdentity(inputAfter, sourceNamedAfter)
      && copied === inputBefore.size
      && outputAfter.isFile() && outputAfter.nlink === 1n
      && outputAfter.size === copied && (outputAfter.mode & 0o777n) === 0o600n,
    `${label} database changed while creating its isolated copy`);
    closeSync(output);
    output = undefined;
    closeSync(input);
    input = undefined;
    const copiedEvidence = stableRegularHash(copy, `${label} isolated database`, {
      maximumBytes: 128 * 1024 * 1024 * 1024,
    });
    assert(copiedEvidence.sha256 === source.sha256
      && copiedEvidence.size === source.size,
    `${label} isolated database differs from its descriptor-held source`);
    heldCopy = openSync(
      copy,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const heldCopyIdentity = fstatSync(heldCopy, { bigint: true });
    assert(sameStatIdentity(heldCopyIdentity, copiedEvidence.stat),
      `${label} isolated database changed before descriptor-held verification`);
    const value = callback(Object.freeze({
      descriptor: heldCopy,
      path: process.platform === 'linux' ? '/proc/self/fd/3' : '/dev/fd/3',
    }));
    const heldCopyAfter = fstatSync(heldCopy, { bigint: true });
    assert(sameStatIdentity(heldCopyIdentity, heldCopyAfter),
      `${label} isolated database descriptor changed during SQLite verification`);
    const copiedAfter = stableRegularHash(copy, `${label} isolated database`, {
      maximumBytes: 128 * 1024 * 1024 * 1024,
    });
    assert(copiedAfter.sha256 === copiedEvidence.sha256
      && sameStatIdentity(copiedAfter.stat, copiedEvidence.stat),
    `${label} isolated database changed during SQLite verification`);
    const sourceAfter = stableRegularHash(source.absolute, `${label} source database`, {
      maximumBytes: 128 * 1024 * 1024 * 1024,
    });
    assert(sourceAfter.sha256 === source.sha256
      && sameStatIdentity(sourceAfter.stat, source.stat),
    `${label} source database changed around isolated SQLite verification`);
    return value;
  } finally {
    if (heldCopy !== undefined) closeSync(heldCopy);
    if (output !== undefined) closeSync(output);
    if (input !== undefined) closeSync(input);
    const current = lstatSync(temporaryRoot, { bigint: true, throwIfNoEntry: false });
    if (current !== undefined) {
      assert(current.isDirectory() && !current.isSymbolicLink()
        && sameNamedObject(current, temporaryIdentity)
        && realpathSync(temporaryRoot) === temporaryRoot,
      `${label} isolated SQLite cleanup identity changed`);
      rmSync(temporaryRoot, { recursive: true, force: false });
    }
  }
}

function sqliteQuery(initial, action, database, sql, label) {
  const held = database !== null && typeof database === 'object'
    && Number.isInteger(database.descriptor) && typeof database.path === 'string';
  const before = held
    ? fstatSync(database.descriptor, { bigint: true })
    : stableRegularHash(database, `${label} database`, {
        maximumBytes: 128 * 1024 * 1024 * 1024,
      });
  if (held) {
    assert(before.isFile() && before.nlink === 1n && before.size > 0n,
      `${label} descriptor-held database identity is invalid`);
  }
  assertSameSqlite(initial, action);
  const result = spawnSync(initial.absolute, ['-readonly', held ? database.path : database, sql], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: '/',
      LANG: 'C',
      LC_ALL: 'C',
    },
    maxBuffer: 1024 * 1024,
    ...(held ? { stdio: ['ignore', 'pipe', 'pipe', database.descriptor] } : {}),
    timeout: 60_000,
    windowsHide: true,
  });
  assert(!result.error && result.status === 0 && result.signal === null,
    `${label} SQLite verification failed`);
  assertSameSqlite(initial, action);
  const after = held
    ? fstatSync(database.descriptor, { bigint: true })
    : stableRegularHash(database, `${label} database`, {
        maximumBytes: 128 * 1024 * 1024 * 1024,
      });
  assert(held
    ? sameStatIdentity(before, after)
    : before.sha256 === after.sha256 && sameStatIdentity(before.stat, after.stat),
  `${label} database changed during SQLite verification`);
  return result.stdout;
}

function verifySqliteDatabase(action, database, label, { expectedEvents = null } = {}) {
  const initial = inspectSqliteExecutable(action);
  return withIsolatedDatabaseCopy(database, label, (isolated) => {
    const integrity = sqliteQuery(
      initial,
      action,
      isolated,
      'PRAGMA integrity_check;',
      label,
    );
    assert(integrity.trim() === 'ok', `${label} integrity_check did not return ok`);
    const foreignKeys = sqliteQuery(
      initial,
      action,
      isolated,
      'PRAGMA foreign_key_check;',
      label,
    );
    assert(foreignKeys.trim() === '', `${label} foreign_key_check returned violations`);
    if (expectedEvents === null || expectedEvents === -1) {
      return Object.freeze({ eventsCount: expectedEvents });
    }
    assert(Number.isSafeInteger(expectedEvents) && expectedEvents >= 0,
      `${label} expected events count is invalid`);
    const events = sqliteQuery(
      initial,
      action,
      isolated,
      'SELECT COUNT(*) FROM events;',
      `${label} events count`,
    ).trim();
    const eventCount = Number(events);
    assert(/^(?:0|[1-9][0-9]*)$/u.test(events)
      && Number.isSafeInteger(eventCount) && eventCount === expectedEvents,
    `${label} events count differs from its manifest`);
    return Object.freeze({ eventsCount: eventCount });
  });
}

function validateAuthorizationBinding(authorization, risk, preview) {
  exactObjectKeys(authorization, TOP_LEVEL_AUTHORIZATION_KEYS, 'external authorization');
  assert(authorization.schemaVersion === 2 && authorization.status === 'APPROVED',
    'external authorization is not one approved v2 record');
  const action = preview.action;
  const binding = preview.binding;
  const window = preview.authorizationWindow;
  assert(sameJson(authorization.actionClasses, [binding.actionClass])
    && authorization.authorizationId === binding.authorizationId
    && authorization.operator === binding.operator
    && authorization.deployedSha === binding.deployedSha
    && authorization.configVersion === binding.configVersion
    && authorization.riskVersion === binding.riskVersion
    && authorization.nonce === binding.nonce
    && authorization.serverPreviewDigest === preview.serverPreviewDigest
    && authorization.account === binding.account
    && authorization.environment === binding.environment
    && authorization.host === binding.host,
  'external authorization identity differs from the consumed preview');
  assert(authorization.issuedAtUtc === window.issuedAtUtc
    && authorization.startsAtUtc === window.startsAtUtc
    && authorization.expiresAtUtc === window.expiresAtUtc,
  'external authorization window differs from the consumed preview');
  assert(sameJson(authorization.allowedCommands, [action.command])
    && sameJson(authorization.allowedEndpoints, action.allowedEndpoints)
    && sameJson(authorization.allowedProducts, action.allowedProducts)
    && sameJson(authorization.allowedCredentials, action.allowedCredentials)
    && sameJson(authorization.preconditions, action.preconditions)
    && sameJson(authorization.maximumEffect, action.maximumEffect)
    && authorization.scope === action.scope
    && authorization.rollback === action.rollback
    && authorization.recovery === action.recovery
    && sameJson(authorization.receiptTargets, action.receiptTargets),
  'external authorization action differs from the consumed preview');
  exactObjectKeys(authorization.ownerApproval, ['approvedAtUtc', 'approver', 'reference'],
    'external authorization ownerApproval');
  assert(authorization.ownerApproval.approver === risk.binding.approver
    && authorization.ownerApproval.reference === risk.binding.approvalReference,
  'external authorization approval identity differs from the consumed risk');
}

function validateConsumedClaim(consumption, evidence, authorization, risk, preview) {
  const expected = buildAuthorizationConsumption({
    authorization,
    authorizationSha256: evidence.authorization.sha256,
    risk,
    riskDocumentSha256: evidence.risk.sha256,
    preview,
    previewDocumentSha256: evidence.preview.sha256,
    consumedAtUtc: consumption.document.consumedAtUtc,
  });
  assert(sameJson(consumption.document, expected),
    'authorization consumption receipt is not the exact producer-bound claim');
  const expectedPath = resolve(
    preview.singleUse.consumptionRoot,
    `${preview.singleUse.claimKey}.json`,
  );
  assert(consumption.absolute === expectedPath,
    'authorization consumption receipt path is not the preview-bound claim');
}

function validateBackupManifest(manifest, backup, label) {
  exactObjectKeys(manifest, BACKUP_MANIFEST_KEYS, `${label} manifest`);
  assert(typeof manifest.backupId === 'string' && manifest.backupId === basename(backup)
    && manifest.backupId.length <= 256
    && !/[\u0000-\u001f\u007f]/u.test(manifest.backupId),
  `${label} manifest backup identity is invalid`);
  assert(typeof manifest.createdAtUtc === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(manifest.createdAtUtc)
    && Number.isFinite(Date.parse(manifest.createdAtUtc)),
  `${label} manifest time is invalid`);
  assert(manifest.dbFile === 'cosmos.db'
    && /^[0-9a-f]{64}$/u.test(manifest.dbSha256)
    && Number.isSafeInteger(manifest.dbBytes) && manifest.dbBytes > 0
    && Number.isSafeInteger(manifest.eventsCount) && manifest.eventsCount >= -1
    && (manifest.dataSchema === null
      || (Number.isSafeInteger(manifest.dataSchema) && manifest.dataSchema >= 0))
    && manifest.integrityCheck === 'ok'
    && Array.isArray(manifest.evidence) && manifest.evidence.length <= 10_000,
  `${label} manifest database metadata is invalid`);
}

function backupRootEntryIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    nlink: stat.nlink.toString(),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    kind: stat.isDirectory() ? 'DIRECTORY'
      : (stat.isFile() ? 'FILE' : (stat.isSymbolicLink() ? 'SYMLINK' : 'OTHER')),
  });
}

function backupRootInventorySha256(path, label) {
  const root = canonicalDirectory(path, label);
  const entries = readdirSync(root.absolute).sort().map((name) => {
    assert(name.length > 0 && name !== '.' && name !== '..'
      && !name.includes('/') && !name.includes('\0'),
    `${label} contains an unsafe direct-child name`);
    return Object.freeze({
      name,
      identity: backupRootEntryIdentity(
        lstatSync(resolve(root.absolute, name), { bigint: true }),
      ),
    });
  });
  const after = lstatSync(root.absolute, { bigint: true });
  assert(sameStatIdentity(root.stat, after)
    && realpathSync(root.absolute) === root.absolute,
  `${label} changed while inventorying`);
  return createHash('sha256')
    .update('I00_BACKUP_WRITE_ROOT_INVENTORY_V1\0')
    .update(canonicalJsonBytes(entries))
    .digest('hex');
}

function inspectBackupSource(path, label) {
  const directory = canonicalDirectory(path, label);
  assert((directory.stat.mode & 0o022n) === 0n,
    `${label} must not be group/world writable`);
  const namesBefore = readdirSync(directory.absolute).sort();
  const manifestEvidence = stableRegular(
    resolve(directory.absolute, 'manifest.json'),
    `${label} manifest`,
    { maximumBytes: 1024 * 1024 },
  );
  const manifest = parseEvidenceJson(manifestEvidence, `${label} manifest`);
  assertExactJsonSerialization(manifestEvidence, manifest, `${label} manifest`);
  validateBackupManifest(manifest, directory.absolute, label);
  const database = stableRegularHash(
    resolve(directory.absolute, 'cosmos.db'),
    `${label} database`,
    { maximumBytes: 128 * 1024 * 1024 * 1024 },
  );
  assert(database.sha256 === manifest.dbSha256 && database.size === manifest.dbBytes,
    `${label} database differs from its manifest`);

  const expectedNames = new Set(['cosmos.db', 'manifest.json']);
  let archiveNumber = 0;
  let archiveBytes = 0;
  const seenSources = new Set();
  const archiveEvidence = [];
  for (let index = 0; index < manifest.evidence.length; index += 1) {
    const item = manifest.evidence[index];
    const itemLabel = `${label} evidence item`;
    assert(item !== null && typeof item === 'object' && !Array.isArray(item),
      `${itemLabel} must be an object`);
    assert(typeof item.source === 'string' && item.source.length > 0
      && item.source.length <= 4_096
      && !/[\u0000-\u001f\u007f]/u.test(item.source)
      && !seenSources.has(item.source),
    `${itemLabel} source is invalid or duplicated`);
    seenSources.add(item.source);
    if (item.missing === true) {
      exactObjectKeys(item, ['source', 'missing'], itemLabel);
      continue;
    }
    exactObjectKeys(item, ['source', 'archive', 'sha256'], itemLabel);
    archiveNumber += 1;
    const expectedArchive = `evidence-${archiveNumber}.tar.gz`;
    assert(item.archive === expectedArchive && /^[0-9a-f]{64}$/u.test(item.sha256),
      `${itemLabel} archive identity is invalid`);
    const archive = stableRegularHash(
      resolve(directory.absolute, expectedArchive),
      `${label} evidence archive`,
      { maximumBytes: 64 * 1024 * 1024 * 1024 },
    );
    assert(archive.sha256 === item.sha256, `${itemLabel} archive digest differs`);
    archiveEvidence.push(archive);
    archiveBytes += archive.size;
    assert(Number.isSafeInteger(archiveBytes)
      && archiveBytes <= 128 * 1024 * 1024 * 1024,
    `${label} evidence archives exceed their aggregate limit`);
    expectedNames.add(expectedArchive);
  }
  assert(!namesBefore.includes('cosmos.db-shm') && !namesBefore.includes('cosmos.db-wal'),
    `${label} must not depend on unmanifested SQLite sidecars`);
  const expectedInventory = [...expectedNames].sort();
  assert(namesBefore.length === expectedInventory.length
    && namesBefore.every((name, index) => name === expectedInventory[index]),
  `${label} inventory differs from its manifest`);
  const namesAfter = readdirSync(directory.absolute).sort();
  const directoryAfter = lstatSync(directory.absolute, { bigint: true });
  assert(namesAfter.length === namesBefore.length
    && namesAfter.every((name, index) => name === namesBefore[index])
    && sameStatIdentity(directory.stat, directoryAfter)
    && realpathSync(directory.absolute) === directory.absolute,
  `${label} identity changed while inspecting`);
  assertStableEvidence(manifestEvidence, `${label} manifest`);
  const databaseAfter = stableRegularHash(
    resolve(directory.absolute, 'cosmos.db'),
    `${label} database`,
    { maximumBytes: 128 * 1024 * 1024 * 1024 },
  );
  assert(databaseAfter.sha256 === database.sha256
    && sameStatIdentity(databaseAfter.stat, database.stat),
  `${label} database changed while inspecting`);
  for (const archive of archiveEvidence) {
    assertStableEvidence(archive, `${label} evidence archive`);
  }
  const treeRecords = [
    { name: 'cosmos.db', sha256: database.sha256, bytes: database.size },
    {
      name: 'manifest.json',
      sha256: manifestEvidence.sha256,
      bytes: manifestEvidence.size,
    },
    ...archiveEvidence.map((archive, index) => ({
      name: `evidence-${index + 1}.tar.gz`,
      sha256: archive.sha256,
      bytes: archive.size,
    })),
  ];
  const treeSha256 = createHash('sha256')
    .update('I00_BACKUP_SOURCE_TREE_V1\0')
    .update(JSON.stringify(treeRecords))
    .digest('hex');
  return Object.freeze({
    path: directory.absolute,
    stat: directoryAfter,
    manifest,
    manifestEvidence,
    database,
    archiveCount: archiveNumber,
    treeSha256,
  });
}

function treeEntriesBelow(entries, prefix) {
  const marker = `${prefix}/`;
  return entries.filter((entry) => entry.path.startsWith(marker))
    .map((entry) => Object.freeze({ ...entry, path: entry.path.slice(marker.length) }));
}

function validateInstalledBundle(destination, evidenceFile, action) {
  const installed = canonicalDirectory(destination, 'installed ops bundle', {
    requireOwner: true,
  });
  assert(endpoint(action, 'destination') === installed.absolute,
    'installed ops bundle differs from the authorized destination');
  const expectedEvidence = resolve(installed.absolute, 'install-receipt.json');
  assert(evidenceFile === expectedEvidence,
    'installed ops evidence must be the destination install receipt');
  const receiptEvidence = stableRegular(expectedEvidence, 'installed ops receipt', {
    maximumBytes: 1024 * 1024,
    requireOwner: true,
  });
  const receipt = parseEvidenceJson(receiptEvidence, 'installed ops receipt');
  assertExactJsonSerialization(receiptEvidence, receipt, 'installed ops receipt');
  exactObjectKeys(receipt, INSTALL_RECEIPT_KEYS, 'installed ops receipt');
  const releaseSha = endpoint(action, 'release-sha');
  assert(receipt.schemaVersion === 2
    && receipt.testedSha === releaseSha
    && receipt.sourceReleaseId === `i00-${releaseSha}`
    && receipt.effectiveOpsRoot === 'accepted-ops-live'
    && receipt.serviceMutationPerformed === false
    && /^[0-9a-f]{64}$/u.test(receipt.installedTreeDigestSha256)
    && /^[0-9a-f]{64}$/u.test(receipt.i00EnforcementTreeDigestSha256),
  'installed ops receipt identity is invalid');

  const trustedDonorContract = stableRegular(
    resolve(I00_ROOT, 'donor-contract.json'),
    'trusted donor contract',
    { maximumBytes: 1024 * 1024 },
  );
  const trustedAmendmentContract = stableRegular(
    resolve(I00_ROOT, 'l15-amendment-contract.json'),
    'trusted L15 amendment contract',
    { maximumBytes: 4 * 1024 * 1024 },
  );
  assert(trustedDonorContract.sha256 === EXPECTED_DONOR_CONTRACT_SHA256
    && trustedAmendmentContract.sha256 === EXPECTED_AMENDMENT_CONTRACT_SHA256,
  'trusted installed-bundle contract anchor differs from the accepted cohort');
  const installedDonorContract = stableRegular(
    resolve(installed.absolute, 'donor-contract.json'),
    'installed donor contract',
    { maximumBytes: 1024 * 1024, requireOwner: true },
  );
  const installedAmendmentContract = stableRegular(
    resolve(installed.absolute, 'l15-amendment-contract.json'),
    'installed L15 amendment contract',
    { maximumBytes: 4 * 1024 * 1024, requireOwner: true },
  );
  assert(installedDonorContract.sha256 === EXPECTED_DONOR_CONTRACT_SHA256
    && installedAmendmentContract.sha256 === EXPECTED_AMENDMENT_CONTRACT_SHA256
    && installedDonorContract.bytes.equals(trustedDonorContract.bytes)
    && installedAmendmentContract.bytes.equals(trustedAmendmentContract.bytes),
  'installed bundle contract bytes differ from the accepted cohort');
  const loaded = loadL15AmendmentContract(
    trustedAmendmentContract.absolute,
    EXPECTED_AMENDMENT_CONTRACT_SHA256,
  );
  assert(sameJson(
    parseEvidenceJson(installedAmendmentContract, 'installed L15 amendment contract'),
    loaded.contract,
  ), 'descriptor-held installed L15 amendment contract differs from its validated document');

  const targetTree = stableTree(installed.absolute, 'installed ops bundle', {
    requireImmutable: true,
    requireOwner: true,
  });
  const trustedEnforcement = stableTree(I00_ROOT, 'trusted I00 enforcement cohort', {
    excludeTopLevel: ['accepted-ops-live', 'install-receipt.json'],
  });
  const installedEnforcementEntries = targetTree.entries.filter((entry) => {
    const top = entry.path.split('/')[0];
    return top !== 'accepted-ops-live' && top !== 'install-receipt.json';
  });
  const trustedI00Digest = typedTreeDigest(trustedEnforcement.entries);
  const installedI00Digest = typedTreeDigest(installedEnforcementEntries);
  assert(installedI00Digest === trustedI00Digest
    && receipt.i00EnforcementTreeDigestSha256 === trustedI00Digest,
  'installed I00 enforcement cohort differs from the trusted cohort');

  const donorEntries = treeEntriesBelow(targetTree.entries, 'accepted-ops-live');
  const actualDonorFiles = donorEntries.filter((entry) => entry.type === 'file');
  const actualDonorDirectories = donorEntries
    .filter((entry) => entry.type === 'directory')
    .map((entry) => entry.path);
  const expectedDonorFiles = loaded.contract.effectiveLive.files;
  const expectedDonorDirectories = [...new Set(expectedDonorFiles.flatMap((file) => {
    const parts = file.path.split('/');
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  }))].sort();
  assert(actualDonorFiles.length === expectedDonorFiles.length
    && actualDonorFiles.every((file, index) => (
      file.path === expectedDonorFiles[index].path
      && file.mode === expectedDonorFiles[index].mode
      && file.sha256 === expectedDonorFiles[index].sha256
    ))
    && actualDonorDirectories.length === expectedDonorDirectories.length
    && actualDonorDirectories.every((path, index) => path === expectedDonorDirectories[index]),
  'installed effective L15 donor inventory differs from the accepted contract');
  assert(regularTreeDigest(actualDonorFiles)
    === loaded.contract.effectiveLive.rootDigestSha256,
  'installed effective L15 donor digest differs from the accepted contract');

  const immutable = loaded.contract.immutableDonor;
  assert(receipt.immutableDonorCommit === immutable.acceptedCommit
    && receipt.immutableDonorLiveTree === immutable.acceptedLiveTree
    && receipt.immutableDonorContractSha256 === EXPECTED_DONOR_CONTRACT_SHA256
    && receipt.amendmentContractSha256 === EXPECTED_AMENDMENT_CONTRACT_SHA256
    && receipt.effectiveLiveTree === loaded.contract.effectiveLive.tree
    && receipt.effectiveRootDigestSha256 === loaded.contract.effectiveLive.rootDigestSha256
    && sameJson(receipt.authorizedCorrectionFindingIds, loaded.findingIds),
  'installed ops receipt differs from the accepted L15 provenance');
  const preReceiptEntries = targetTree.entries.filter(
    (entry) => entry.path !== 'install-receipt.json',
  );
  assert(receipt.installedTreeDigestSha256 === regularTreeDigest(preReceiptEntries),
    'installed ops receipt does not bind the complete installed tree');
  assertStableEvidence(receiptEvidence, 'installed ops receipt');
  assertStableEvidence(installedDonorContract, 'installed donor contract');
  assertStableEvidence(installedAmendmentContract, 'installed L15 amendment contract');
  assertStableEvidence(trustedDonorContract, 'trusted donor contract');
  assertStableEvidence(trustedAmendmentContract, 'trusted L15 amendment contract');
  const finalTargetTree = stableTree(installed.absolute, 'installed ops bundle', {
    requireImmutable: true,
    requireOwner: true,
  });
  assert(sameJson(finalTargetTree.entries, targetTree.entries),
    'installed ops bundle changed around complete outcome verification');
  return Object.freeze({
    primaryPath: installed.absolute,
    evidenceSha256: receiptEvidence.sha256,
  });
}

function validateOutcomeEvidence(actionClass, action, args, effect) {
  if (actionClass === 'OPS_BUNDLE_INSTALL') {
    const primaryPath = resolve(args['primary-path']);
    assert(primaryPath === args['primary-path'],
      'primary result path must be canonical absolute');
    assert(args['source-path'] === undefined,
      'installed ops outcome rejects a source path');
    return validateInstalledBundle(primaryPath, args['evidence-file'], action);
  }
  if (actionClass === 'BACKUP_CREATE') {
    assert(args['primary-path'] === undefined
      && args['evidence-file'] === undefined
      && args['source-path'] === undefined,
    'backup outcome derives its artifact only from terminal evidence');
    const output = effect.terminal.document.effectOutput;
    assert(output.status === 'BOUND',
      'backup terminal evidence lacks one exact bound output');
    const outputEvidence = readCanonicalEvidence(
      output.outputEvidencePath,
      'authorized backup output evidence',
      validateAuthorizedEffectOutput,
    );
    assert(outputEvidence.sha256 === output.outputEvidenceSha256
      && outputEvidence.document.claimKey === effect.start.document.claimKey
      && outputEvidence.document.writeRootName === output.writeRootName
      && outputEvidence.document.outputRelativePath === output.outputRelativePath
      && outputEvidence.document.receiptRelativePath === output.receiptRelativePath,
    'authorized backup output document differs from terminal evidence');
    const backupDirectory = canonicalDirectory(
      endpoint(action, 'backup-dir'),
      'authorized backup directory',
    ).absolute;
    const dataDirectory = canonicalExistingOrFuturePath(
      endpoint(action, 'data-dir'),
      'authorized data directory',
    );
    assert(output.beforeInventorySha256 !== output.afterInventorySha256,
      'runner-bound backup inventories do not prove one output delta');
    const rootInventoryBefore = backupRootInventorySha256(
      backupDirectory,
      'authorized backup directory',
    );
    assert(rootInventoryBefore === output.afterInventorySha256,
      'authorized backup root differs from the runner-bound post inventory');
    const backup = inspectBackupSource(output.outputPath, 'published backup');
    assert(dirname(backup.path) === backupDirectory
      && basename(backup.path) === output.outputRelativePath
      && output.receiptRelativePath === `${output.outputRelativePath}/manifest.json`,
      'published backup is not one direct child of the authorized backup directory');
    assert(!pathsOverlap(backup.path, dataDirectory),
      'published backup overlaps the authorized data directory');
    assert(endpointIdentity(backup.stat) === output.outputIdentity
      && backup.manifestEvidence.sha256 === output.receiptSha256
      && backup.database.sha256 === output.databaseSha256
      && backup.database.size === output.databaseBytes
      && backup.treeSha256 === output.outputTreeSha256
      && backup.archiveCount === 0
      && sameJson(backup.manifest.evidence, []),
    'published backup differs from the runner-bound terminal artifact');
    verifySqliteDatabase(action, resolve(backup.path, 'cosmos.db'), 'published backup', {
      expectedEvents: backup.manifest.eventsCount,
    });
    const after = inspectBackupSource(backup.path, 'published backup');
    assert(endpointIdentity(after.stat) === endpointIdentity(backup.stat)
      && after.manifestEvidence.sha256 === backup.manifestEvidence.sha256
      && after.database.sha256 === backup.database.sha256
      && after.treeSha256 === backup.treeSha256,
    'published backup changed around independent SQLite verification');
    assertStableEvidence(outputEvidence, 'authorized backup output evidence');
    const rootInventoryAfter = backupRootInventorySha256(
      backupDirectory,
      'authorized backup directory',
    );
    assert(rootInventoryAfter === output.afterInventorySha256,
      'authorized backup root changed during independent outcome verification');
    return {
      primaryPath: backup.path,
      evidenceSha256: backup.manifestEvidence.sha256,
    };
  }
  if (actionClass === 'ISOLATED_RESTORE') {
    const primaryPath = resolve(args['primary-path']);
    assert(primaryPath === args['primary-path'],
      'primary result path must be canonical absolute');
    const target = canonicalDirectory(primaryPath, 'isolated restore target', {
      requireOwner: true,
    }).absolute;
    assert(target === endpoint(action, 'isolated-target'),
      'isolated restore target differs from the authorized target');
    assert(args['source-path'] === endpoint(action, 'backup-path'),
      'isolated restore source differs from the authorized backup');
    const source = inspectBackupSource(args['source-path'], 'isolated restore source');
    assert(source.manifestEvidence.sha256 === endpoint(action, 'backup-manifest-sha256')
      && source.database.sha256 === endpoint(action, 'backup-database-sha256')
      && endpointIdentity(source.stat) === endpoint(action, 'backup-identity'),
    'isolated restore source differs from the preview-bound backup identity');
    const dataDirectory = canonicalExistingOrFuturePath(
      endpoint(action, 'data-dir'),
      'authorized production data directory',
    );
    assert(!pathsOverlap(target, dataDirectory),
      'isolated restore target overlaps the authorized production data directory');
    assert(!pathsOverlap(target, source.path),
      'isolated restore target overlaps the preview-bound backup source');
    assert(!pathsOverlap(source.path, dataDirectory),
      'preview-bound backup source overlaps the authorized production data directory');
    const expectedEvidence = resolve(target, 'restore-report.json');
    assert(args['evidence-file'] === expectedEvidence,
      'restore evidence must be the exact restore report');
    const evidence = stableRegular(expectedEvidence, 'isolated restore report', {
      maximumBytes: 1024 * 1024,
      requireOwner: true,
    });
    const report = parseEvidenceJson(evidence, 'isolated restore report');
    assertExactJsonSerialization(evidence, report, 'isolated restore report');
    exactObjectKeys(report, RESTORE_REPORT_KEYS, 'isolated restore report');
    assert(typeof report.ts === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(report.ts)
      && Number.isFinite(Date.parse(report.ts))
      && report.backupId === source.manifest.backupId
      && report.target === target
      && report.production === false
      && report.dbSha256 === source.database.sha256
      && report.declaredEventsCount === source.manifest.eventsCount
      && Number.isSafeInteger(report.eventsCount)
      && report.declaredEvidenceArchives === source.archiveCount
      && report.evidenceArchives === source.archiveCount
      && report.verifiedEvidenceArchives === source.archiveCount
      && report.archiveVerification
        === 'EXACT_MANIFEST_INVENTORY_HASH_SIZE_MEMBER_VERIFIED',
    'isolated restore report does not prove the preview-bound source and target');
    const database = stableRegularHash(resolve(target, 'cosmos.db'), 'isolated restore database',
      { maximumBytes: 128 * 1024 * 1024 * 1024 });
    assert(database.sha256 === source.database.sha256
      && database.size === source.database.size,
    'isolated restore database differs from the preview-bound backup');
    const sqlite = verifySqliteDatabase(
      action,
      resolve(target, 'cosmos.db'),
      'isolated restore',
      { expectedEvents: source.manifest.eventsCount },
    );
    if (source.manifest.eventsCount === -1) {
      assert(report.eventsCount === -1,
        'isolated restore report events count differs from its source policy');
    } else {
      assert(sqlite.eventsCount === source.manifest.eventsCount
        && report.eventsCount === source.manifest.eventsCount,
      'isolated restore events count differs from the preview-bound backup');
    }
    assertStableEvidence(evidence, 'isolated restore report');
    const sourceAfter = inspectBackupSource(source.path, 'isolated restore source');
    assert(endpointIdentity(sourceAfter.stat) === endpointIdentity(source.stat)
      && sourceAfter.manifestEvidence.sha256 === source.manifestEvidence.sha256
      && sourceAfter.database.sha256 === source.database.sha256,
    'isolated restore source changed around outcome verification');
    const databaseAfter = stableRegularHash(
      resolve(target, 'cosmos.db'),
      'isolated restore database',
      { maximumBytes: 128 * 1024 * 1024 * 1024 },
    );
    assert(databaseAfter.sha256 === database.sha256
      && sameStatIdentity(databaseAfter.stat, database.stat),
    'isolated restore database changed around outcome verification');
    return { primaryPath: target, evidenceSha256: evidence.sha256 };
  }
  assert(actionClass === 'SECRET_MATERIALIZATION',
    'authorized outcome class is unsupported');
  const primaryPath = resolve(args['primary-path']);
  assert(primaryPath === args['primary-path'], 'primary result path must be canonical absolute');
  assert(standalonePathEndpoint(action, primaryPath),
    'credential output differs from the authorized standalone output endpoint');
  assert(args['evidence-file'] === undefined && args['source-path'] === undefined,
    'secret outcome rejects evidence and source paths');
  canonicalDirectory(dirname(primaryPath), 'runtime credential output parent', {
    requirePrivate: true,
  });
  const output = stableRegular(primaryPath, 'runtime credential output', {
    maximumBytes: 64 * 1024,
    privateMode: true,
  });
  const materialized = parseEvidenceJson(output, 'runtime credential output');
  assertExactJsonSerialization(output, materialized, 'runtime credential output', {
    pretty: false,
  });
  const requiredKeys = action.allowedEndpoints
    .filter((entry) => entry.startsWith('required-key:'))
    .map((entry) => entry.slice('required-key:'.length));
  assert(requiredKeys.length > 0 && requiredKeys.length <= 12,
    'secret preview does not contain an exact required-key set');
  exactObjectKeys(materialized, requiredKeys, 'runtime credential output');
  assert(requiredKeys.every((key) => (
    typeof materialized[key] === 'string'
    && materialized[key].length >= 8
    && materialized[key].length <= 4_096
    && !/[\r\n\u0000]/u.test(materialized[key])
  )), 'runtime credential output contains a missing or malformed required value');
  const evidenceSha256 = sha256Bytes(canonicalJsonBytes({
    requiredKeys,
    mode: '0600',
    output: output.absolute,
  }));
  assertStableEvidence(output, 'runtime credential output');
  return { primaryPath: output.absolute, evidenceSha256 };
}

function readRollbackProducerChain(args) {
  const risk = readCanonicalEvidence(
    args['deployment-risk'],
    'deployment risk version',
    validateDeploymentRiskVersion,
  );
  const preview = readCanonicalEvidence(
    args['action-preview'],
    'deployment action preview',
    (document) => validateDeploymentActionPreview(document, risk.document, risk.sha256),
  );
  assert(risk.document.binding.actionClass === 'SERVICE_ROLLBACK',
    'rollback producer chain does not bind SERVICE_ROLLBACK');
  requireRecorderNodeBinding(risk.document, preview.document.action);
  return Object.freeze({ risk, preview });
}

function readAuthorizedRollbackChain(args) {
  const authorization = readCanonicalEvidence(
    args.authorization,
    'external authorization',
    (document) => document,
  );
  const { risk, preview } = readRollbackProducerChain(args);
  const consumption = readCanonicalEvidence(
    args['authorization-consumption'],
    'authorization consumption receipt',
    (document) => document,
  );
  validateAuthorizationBinding(authorization.document, risk.document, preview.document);
  validateConsumedClaim(consumption, {
    authorization,
    risk,
    preview,
  }, authorization.document, risk.document, preview.document);
  return Object.freeze({ authorization, risk, preview, consumption });
}

function rollbackBoundFile(action, prefix) {
  return Object.freeze({
    path: endpoint(action, `${prefix}-path`),
    sha256: endpoint(action, `${prefix}-sha256`),
    identity: endpoint(action, `${prefix}-identity`),
  });
}

function rollbackParentPrelude() {
  return [
    '[ -r "/proc/$PPID/cmdline" ] && [ -r "/proc/$PPID/status" ] || exit 125',
    'if [ "$I00_AUTHORIZED_EFFECT_ROOT_MODE" = TEST ]; then',
    '  [ "/proc/$PPID/exe" -ef "$I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH" ] || exit 125',
    'else',
    '  [ "/proc/$PPID/exe" -ef /usr/bin/node ] || exit 125',
    'fi',
    '_i00_parent_uid= _i00_parent_euid=',
    'while IFS=" \t" read -r _i00_key _i00_real _i00_effective _i00_rest; do',
    '  if [ "$_i00_key" = "Uid:" ]; then _i00_parent_uid=$_i00_real; _i00_parent_euid=$_i00_effective; break; fi',
    'done < "/proc/$PPID/status"',
    '[ -n "$_i00_parent_uid" ] && [ -n "$_i00_parent_euid" ] || exit 125',
    'if [ "$I00_AUTHORIZED_EFFECT_ROOT_MODE" != TEST ]; then [ "$_i00_parent_euid" = 0 ] || exit 125; fi',
    '_i00_parent_argv=()',
    'while IFS= read -r -d "" _i00_arg; do _i00_parent_argv[${#_i00_parent_argv[@]}]=$_i00_arg; done < "/proc/$PPID/cmdline"',
    '[ "${#_i00_parent_argv[@]}" -ge 12 ] || exit 125',
    '[ "${_i00_parent_argv[1]}" = "$I00_AUTHORIZED_EFFECT_RUNNER_PATH" ] || exit 125',
    '[ "${_i00_parent_argv[2]}" = --authorization ] || exit 125',
    '[ "${_i00_parent_argv[4]}" = --deployment-risk ] || exit 125',
    '[ "${_i00_parent_argv[6]}" = --action-preview ] || exit 125',
    '[ "${_i00_parent_argv[8]}" = --authorization-consumption ] || exit 125',
    '[ "${_i00_parent_argv[10]}" = -- ] || exit 125',
    '_I00_RUNNER_PARENT_VERIFIED=1',
    'readonly _I00_RUNNER_PARENT_VERIFIED',
    'unset _i00_parent_uid _i00_parent_euid _i00_key _i00_real _i00_effective _i00_rest _i00_arg _i00_parent_argv',
  ].join('\n');
}

function validateRollbackEffectCapabilities(args, chain, start) {
  const action = chain.preview.document.action;
  const risk = chain.risk.document;
  const verifier = stableRegularHash(
    resolve(SCRIPT_DIR, 'verify-authorized-effect-handoff.mjs'),
    'authorized effect verifier source',
    { maximumBytes: 4 * 1024 * 1024 },
  );
  const verifierBinding = Object.freeze({
    path: verifier.absolute,
    sha256: verifier.sha256,
    identity: endpointIdentity(verifier.stat),
  });
  const sanitized = readSanitizedRollbackEnv(resolve(args['env-file']), action);
  const environmentBinding = Object.freeze({
    path: sanitized.evidence.absolute,
    sha256: sanitized.evidence.sha256,
    identity: endpointIdentity(sanitized.evidence.stat),
  });
  assert(environmentBinding.sha256 === endpoint(action, 'effect-environment-sha256'),
    'authorized effect environment differs from the consumed preview');

  const executableSpecs = Object.freeze([
    ['node', 16, 'node'],
    ['bash', 17, 'bash'],
    ['env', 18, 'env'],
    ['systemctl', 19, 'systemctl'],
    ['curl', 20, 'curl'],
    ['exposure', 33, 'exposure-helper'],
    ['alert', 34, 'alert-helper'],
  ]);
  const expectedExecutables = executableSpecs.map(([name, fd, prefix]) => (
    Object.freeze({ name, fd, binding: rollbackBoundFile(action, prefix) })
  ));
  const writeRootSpecs = Object.freeze([
    ['cosmosRoot', 41, 'cosmos-root', 'cosmos-root-path'],
    ['releasesDir', 42, 'releases-dir', 'releases-dir-path'],
    ['currentLinkParent', 43, 'current-link-parent', 'current-link-parent-path'],
    ['previousLinkParent', 44, 'previous-link-parent', 'previous-link-parent-path'],
    ['opsStateDir', 45, 'ops-state-dir', 'ops-state-dir-path'],
    ['rollbackEvidenceRoot', 48, 'rollback-evidence-root', 'rollback-evidence-root'],
    ['dataDir', 49, 'data-dir', 'data-dir-path'],
  ]);
  const expectedWriteRoots = writeRootSpecs.map(([name, fd, prefix, pathPrefix]) => (
    Object.freeze({
      name,
      fd,
      path: endpoint(action, pathPrefix),
      identity: endpoint(action, `${prefix}-identity`),
    })
  ));
  const expectedReadRoots = [Object.freeze({
    name: 'releaseSource',
    fd: 51,
    path: endpoint(action, 'release-path'),
    identity: endpoint(action, 'release-identity'),
    treeSha256: endpoint(action, 'release-tree-sha256'),
  })];
  const expectedHelperPolicy = Object.freeze({
    exposure: Object.freeze({
      program: 'node',
      script: 'exposure',
      argvShape: endpoint(action, 'exposure-helper-argv-shape'),
      timeoutMs: Number(endpoint(action, 'exposure-helper-timeout-ms')),
    }),
    alert: Object.freeze({
      program: 'bash',
      script: 'alert',
      argvShape: endpoint(action, 'alert-helper-argv-shape'),
      timeoutMs: Number(endpoint(action, 'alert-helper-timeout-ms')),
    }),
  });
  assert(expectedHelperPolicy.exposure.argvShape === 'NO_ARGS'
      && expectedHelperPolicy.exposure.timeoutMs === 3_000
      && expectedHelperPolicy.alert.argvShape === 'SEVERITY_CODE_MESSAGE'
      && expectedHelperPolicy.alert.timeoutMs === 5_000,
  'authorized effect helper policy differs from the fixed rollback policy');
  const expectedArgv = Object.freeze([
    '-p',
    '-c',
    `${rollbackParentPrelude()}\nsource /proc/self/fd/13; source /proc/self/fd/11`,
    endpoint(action, 'effect-script-path'),
    '--i00-effect-environment-fd',
    '12',
    '--to',
    endpoint(action, 'release-id'),
  ]);
  const expectedBootstrap = Object.freeze({
    kind: 'COMMON_SHELL',
    binding: rollbackBoundFile(action, 'effect-common'),
  });
  const expectedEnvironment = Object.freeze({
    kind: 'SANITIZED_ENV',
    binding: environmentBinding,
  });
  assert(sameJson(start.verifier, verifierBinding)
      && sameJson(start.delegatedScript, rollbackBoundFile(action, 'effect-script'))
      && sameJson(start.delegatedBootstrap, expectedBootstrap)
      && sameJson(start.delegatedEnvironment, expectedEnvironment)
      && sameJson(start.effectExecutables, expectedExecutables)
      && sameJson(start.delegatedArgv, expectedArgv)
      && sameJson(start.helperPolicy, expectedHelperPolicy)
      && sameJson(start.automaticRollback, {})
      && sameJson(start.writeRoots, expectedWriteRoots)
      && sameJson(start.readRoots, expectedReadRoots)
      && sameJson(start.observedRoots, []),
  'authorized rollback effect capabilities differ from the consumed preview');

  const temporaryParent = risk.artifactPolicy.rootMode === 'SYSTEM'
    ? '/tmp'
    : resolve(risk.artifactPolicy.proofRoot, 'tmp');
  const temporaryName = basename(start.effectDirectory.path);
  const directoryIdentity = new RegExp(
    `^device=[0-9]+,inode=[0-9]+,mode=40700,uid=${
      endpoint(action, 'effect-uid')
    },gid=${endpoint(action, 'effect-gid')}$`,
    'u',
  );
  assert(start.effectDirectory.kind === 'CLAIM_TEMPORARY_DIRECTORY'
      && dirname(start.effectDirectory.path) === temporaryParent
      && new RegExp(
        `^i00-bound-effect\\.${chain.preview.document.singleUse.claimKey.slice(0, 16)
        }\\.[A-Za-z0-9_-]{6}$`,
        'u',
      ).test(temporaryName)
      && directoryIdentity.test(start.effectDirectory.identity),
  'authorized rollback effect temporary directory differs from the runner policy');
  assertStableEvidence(verifier, 'authorized effect verifier source');
  assertStableEvidence(sanitized.evidence, 'sanitized rollback environment');
}

function readAuthorizedEffectOutcome(args, chain) {
  const start = readCanonicalEvidence(
    args['effect-start-evidence'],
    'authorized effect start evidence',
    validateAuthorizedEffectStart,
  );
  const terminal = readCanonicalEvidence(
    args['effect-finish-evidence'],
    'authorized effect terminal evidence',
    (document) => validateAuthorizedEffectTerminal(document, start.document),
  );
  const action = chain.preview.document.action;
  const risk = chain.risk.document;
  const expectedProgram = {
    path: endpoint(action, 'effect-program-path'),
    sha256: endpoint(action, 'effect-program-sha256'),
    identity: endpoint(action, 'effect-program-identity'),
  };
  const receiptReserve = Number(endpoint(action, 'receipt-publication-reserve-seconds'));
  assert(Number.isSafeInteger(receiptReserve)
    && receiptReserve === risk.action.receiptPublicationReserveSeconds,
  'authorized effect receipt reserve differs from the risk');
  assert(start.absolute === endpoint(action, 'effect-start-evidence')
    && terminal.absolute === endpoint(action, 'effect-finish-evidence')
    && start.document.actionClass === risk.binding.actionClass
    && start.document.authorizationId === chain.authorization.document.authorizationId
    && start.document.claimKey === chain.preview.document.singleUse.claimKey
    && start.document.claimKey === chain.consumption.document.claimKey
    && start.document.consumptionSha256 === chain.consumption.sha256
    && start.document.riskVersion === risk.riskVersion
    && start.document.serverPreviewDigest === chain.preview.document.serverPreviewDigest
    && start.document.effectUid === endpoint(action, 'effect-uid')
    && start.document.effectGid === endpoint(action, 'effect-gid')
    && sameJson(start.document.program, expectedProgram)
    && start.document.authorizationExpiresAtUtc
      === chain.authorization.document.expiresAtUtc
    && start.document.authorizationExpiresAtUtc
      === risk.authorizationWindow.expiresAtUtc
    && start.document.evidenceValidUntilUtc === risk.evidenceValidUntilUtc
    && start.document.receiptPublicationReserveSeconds === receiptReserve
    && start.document.startEvidencePath === start.absolute
    && start.document.finishEvidencePath === terminal.absolute,
  'authorized effect evidence differs from the consumed producer chain');
  assert(endpoint(action, 'completion-reserve-seconds')
      === String(risk.action.completionReserveSeconds),
  'authorized effect completion reserve differs from the risk');
  if (risk.binding.actionClass === 'SERVICE_ROLLBACK') {
    validateRollbackEffectCapabilities(args, chain, start.document);
  }
  const success = terminal.document.status === 'AUTHORIZED_EFFECT_COMPLETED';
  if (success) {
    assert(terminal.document.exitCode === 0
      && terminal.document.signal === null
      && terminal.document.forced === false
      && terminal.document.timedOut === false
      && terminal.document.programBindingRetained === true
      && terminal.document.effectMayHaveMutated === false
      && terminal.document.successRecorderEligible === true,
    'completed authorized effect terminal is not eligible for success publication');
  } else {
    assert(terminal.document.status === 'AUTHORIZED_EFFECT_TERMINATED'
      && terminal.document.effectMayHaveMutated === true
      && terminal.document.successRecorderEligible === false,
    'terminated authorized effect terminal is not eligible for failure publication');
  }
  assert(Date.parse(start.document.effectStartedAtUtc)
      >= Date.parse(chain.consumption.document.consumedAtUtc),
  'authorized effect predates authorization consumption');
  assert(Date.parse(terminal.document.effectFinishedAtUtc)
      >= Date.parse(start.document.effectStartedAtUtc),
  'authorized effect terminal predates its start');
  return Object.freeze({ start, terminal, receiptReserve, success });
}

function assertAuthorizedEffectEvidenceAbsent(action) {
  const paths = Object.freeze({
    start: endpoint(action, 'effect-start-evidence'),
    terminal: endpoint(action, 'effect-finish-evidence'),
  });
  for (const [name, path] of Object.entries(paths)) {
    assert(lstatSync(path, { throwIfNoEntry: false }) === undefined,
      `pre-effect refusal requires absent authorized effect ${name} evidence`);
  }
  return paths;
}

function authorizedEffectReceiptBinding(chain, effect, rootBinding) {
  return Object.freeze({
    claimKey: chain.preview.document.singleUse.claimKey,
    startEvidencePath: effect.start.absolute,
    startEvidenceSha256: effect.start.sha256,
    terminalEvidencePath: effect.terminal.absolute,
    terminalEvidenceSha256: effect.terminal.sha256,
    effectStartedAtUtc: effect.start.document.effectStartedAtUtc,
    effectFinishedAtUtc: effect.terminal.document.effectFinishedAtUtc,
    program: effect.start.document.program,
    chain: Object.freeze({
      authorizationSha256: chain.authorization.sha256,
      riskDocumentSha256: chain.risk.sha256,
      previewDocumentSha256: chain.preview.sha256,
      authorizationConsumptionSha256: chain.consumption.sha256,
    }),
    receiptRoot: Object.freeze({
      path: rootBinding.path,
      identity: rootBinding.identity,
    }),
  });
}

function readSanitizedRollbackEnv(path, action) {
  const evidence = stableRegular(resolve(path), 'sanitized rollback environment', {
    maximumBytes: 64 * 1024,
    privateMode: true,
  });
  assert(evidence.absolute === path,
    'sanitized rollback environment path must be canonical absolute');
  assert(evidence.sha256 === endpoint(action, 'donor-env-sha256'),
    'sanitized rollback environment digest differs from the preview');
  const text = evidence.bytes.toString('utf8');
  assert(Buffer.from(text, 'utf8').equals(evidence.bytes) && text.endsWith('\n'),
    'sanitized rollback environment encoding is invalid');
  const values = {};
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)='([^']*)'$/u.exec(line);
    assert(match !== null && !Object.hasOwn(values, match[1]),
      'sanitized rollback environment serialization is invalid');
    values[match[1]] = match[2];
  }
  for (const key of [
    'COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK',
    'DATA_DIR', 'OPS_STATE_DIR', 'APP_UNIT', 'HEALTH_BASE',
    'POST_SWITCH_GATE_PATHS', 'DEPLOY_LOCK', 'FROZEN_MARKER',
  ]) {
    assert(typeof values[key] === 'string' && values[key].length > 0,
      `sanitized rollback environment is missing ${key}`);
  }
  for (const key of [
    'COSMOS_ROOT', 'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK',
    'DATA_DIR', 'OPS_STATE_DIR', 'DEPLOY_LOCK', 'FROZEN_MARKER',
  ]) {
    assert(values[key] !== '/' && resolve(values[key]) === values[key],
      `sanitized rollback environment ${key} is not canonical absolute`);
  }
  assert(values.RELEASES_DIR === resolve(values.COSMOS_ROOT, 'releases')
    && values.CURRENT_LINK === resolve(values.COSMOS_ROOT, 'current')
    && values.PREVIOUS_LINK === resolve(values.COSMOS_ROOT, 'previous')
    && values.FROZEN_MARKER === resolve(values.OPS_STATE_DIR, 'deploy-frozen.json'),
  'sanitized rollback environment release layout is contradictory');
  assert(values.APP_UNIT === 'cosmos-app.service'
    && values.POST_SWITCH_GATE_PATHS === '/health/live /health/ready',
  'sanitized rollback service/readiness contract is not exact');
  let health;
  try {
    health = new URL(values.HEALTH_BASE);
  } catch {
    throw new Error('sanitized rollback health base is invalid');
  }
  assert(health.protocol === 'http:'
    && ['127.0.0.1', '[::1]'].includes(health.hostname)
    && health.port.length > 0
    && health.username === '' && health.password === ''
    && health.pathname === '/' && health.search === '' && health.hash === '',
  'sanitized rollback health base is not one numeric-loopback HTTP origin');
  return Object.freeze({ evidence, values: Object.freeze(values) });
}

function inspectInstalledRelease(path, label) {
  const directory = canonicalDirectory(path, label, { requireOwner: true });
  const mode = directory.stat.mode & 0o7777n;
  assert((mode & 0o222n) === 0n && (mode & 0o7000n) === 0n,
    `${label} must be one immutable directory without special mode bits`);
  const before = stableTree(directory.absolute, label, {
    requireImmutable: true,
    requireOwner: true,
  });
  const verified = verifyArtifactManifest(
    directory.absolute,
    null,
    { installedImmutable: true },
  );
  assert(/^i00-[0-9a-f]{40}$/u.test(verified.release.releaseId)
    && verified.release.releaseId === `i00-${verified.release.testedSha}`,
  `${label} release identity is invalid`);
  const after = stableTree(directory.absolute, label, {
    requireImmutable: true,
    requireOwner: true,
  });
  const finalStat = lstatSync(directory.absolute, { bigint: true });
  assert(sameJson(before.entries, after.entries)
    && sameStatIdentity(directory.stat, finalStat),
  `${label} changed during complete tree verification`);
  return Object.freeze({
    path: directory.absolute,
    releaseId: verified.release.releaseId,
    testedSha: verified.release.testedSha,
    artifactManifestSha256: verified.artifactManifestSha256,
    treeSha256: typedTreeDigest(before.entries),
    identity: endpointIdentity(finalStat),
  });
}

function inspectReleaseLink(link, releasesDirectory, label, { allowAbsent = false } = {}) {
  const absolute = resolve(link);
  assert(absolute === link, `${label} path must be canonical absolute`);
  const named = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  if (named === undefined) {
    assert(allowAbsent, `${label} must exist`);
    return Object.freeze({ link: absolute, state: 'ABSENT' });
  }
  assert(named.isSymbolicLink(), `${label} must be one symbolic link`);
  const rawTarget = readlinkSync(absolute);
  const target = resolve(dirname(absolute), rawTarget);
  assert(dirname(target) === releasesDirectory
    && /^i00-[0-9a-f]{40}$/u.test(basename(target))
    && realpathSync(absolute) === target,
  `${label} must resolve to one direct immutable release child`);
  const release = inspectInstalledRelease(target, `${label} target`);
  assert(release.releaseId === basename(target),
    `${label} target release identity is contradictory`);
  const after = lstatSync(absolute, { bigint: true });
  assert(sameStatIdentity(named, after) && readlinkSync(absolute) === rawTarget,
    `${label} changed while being inspected`);
  return Object.freeze({
    link: absolute,
    state: 'PRESENT',
    linkIdentity: endpointIdentity(after),
    ...release,
  });
}

function assertReleaseEndpointBinding(binding, action, prefix = '') {
  const endpointPrefix = (name) => `${prefix}${name}`;
  assert(binding.path === endpoint(action, endpointPrefix('release-path'))
    && binding.testedSha === endpoint(action, endpointPrefix('release-sha'))
    && binding.artifactManifestSha256
      === endpoint(action, endpointPrefix('artifact-manifest-sha256'))
    && binding.identity === endpoint(action, endpointPrefix('release-identity'))
    && binding.treeSha256 === endpoint(action, endpointPrefix('release-tree-sha256')),
  `${prefix || 'target-'}release identity differs from the consumed preview`);
}

function inspectBoundExecutable(action, prefix, requested) {
  const path = endpoint(action, `${prefix}-path`);
  assert(requested === path, `${prefix} executable path differs from the consumed preview`);
  const evidence = stableRegularHash(path, `${prefix} executable`, {
    maximumBytes: 512 * 1024 * 1024,
  });
  const mode = evidence.stat.mode & 0o7777n;
  assert((mode & 0o111n) !== 0n && (mode & 0o022n) === 0n
    && (mode & 0o7000n) === 0n,
  `${prefix} executable mode is unsafe`);
  verifyTrustedExecutableAncestors(path);
  assert(evidence.sha256 === endpoint(action, `${prefix}-sha256`)
    && endpointIdentity(evidence.stat) === endpoint(action, `${prefix}-identity`),
  `${prefix} executable identity differs from the consumed preview`);
  return evidence;
}

function requireRecorderNodeBinding(risk, action) {
  if (!['SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
    'STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE'].includes(risk.provenanceMode)) return;
  const executingNode = realpathSync(process.execPath);
  inspectBoundExecutable(action, 'node', executingNode);
}

function requireBoundAppUnit(action, env, systemctlPath, risk) {
  if (risk.provenanceMode === 'TEST_FIXTURE_INJECTED') return;
  const nodePath = endpoint(action, 'node-path');
  const envPath = endpoint(action, 'env-path');
  const bindingSha256 = endpoint(action, 'app-unit-binding-sha256');
  const stagingRoot = endpoint(action, 'app-unit-staging-root');
  const offlineUnitRoot = endpoint(action, 'app-unit-offline-unit-root');
  const proofDropIn = endpoint(action, 'app-unit-proof-drop-in-path');
  const proofDropInRuntimeLink = endpoint(
    action,
    'app-unit-proof-drop-in-runtime-link-path',
  );
  const proofAbsentSentinel = endpoint(
    action,
    'app-unit-proof-absent-sentinel',
  );
  const systemdAnalyze = endpoint(action, 'systemd-analyze-path');
  const inspectionArguments = [
    resolve(SCRIPT_DIR, 'inspect-app-unit.mjs'),
    '--systemctl', systemctlPath,
    '--unit', env.APP_UNIT,
    '--node', nodePath,
    '--env', envPath,
    '--runtime-env', endpoint(action, 'app-unit-environment-file-path'),
    '--expected-fragment-path', endpoint(action, 'app-unit-fragment-path'),
    '--expected-fragment-source', endpoint(
      action,
      'app-unit-fragment-source-path',
    ),
    '--provenance-mode', risk.artifactPolicy.rootMode,
    '--expected-binding-sha256', bindingSha256,
  ];
  if (stagingRoot !== 'NONE') {
    inspectionArguments.push(
      '--staging-root', stagingRoot,
      '--proof-drop-in', proofDropIn,
      '--proof-absent-sentinel', proofAbsentSentinel,
    );
  }
  if (proofDropInRuntimeLink !== 'NONE') {
    inspectionArguments.push(
      '--proof-drop-in-runtime-link',
      proofDropInRuntimeLink,
    );
  }
  if (offlineUnitRoot !== 'NONE') {
    inspectionArguments.push(
      '--offline-unit-root', offlineUnitRoot,
      '--systemd-analyze', systemdAnalyze,
    );
  }
  const result = spawnSync(process.execPath, inspectionArguments, {
    encoding: 'utf8',
    env: CLOSED_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  assert(!result.error && result.signal === null && result.status === 0
    && result.stderr === '',
  'bound application unit inspection failed');
  let inspected;
  try {
    inspected = JSON.parse(result.stdout);
  } catch {
    throw new Error('bound application unit inspection returned invalid JSON');
  }
  exactObjectKeys(inspected, [
    'schemaVersion', 'status', 'inspectionMode', 'systemctlPath',
    'offlineUnitRoot', 'systemdAnalyzePath', 'systemdAnalyzeSha256',
    'systemdAnalyzeIdentity', 'systemdAnalyzeEndpointIdentity',
    'unit', 'fragmentPath',
    'fragmentSha256', 'fragmentIdentity', 'fragmentEndpointIdentity',
    'fragmentSourcePath', 'fragmentSourceSha256', 'fragmentSourceIdentity',
    'fragmentSourceEndpointIdentity', 'dropInPaths', 'dropInState',
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
  ], 'bound application unit inspection');
  assert(inspected.schemaVersion === 3
    && inspected.status === 'APP_UNIT_BINDING_VERIFIED'
    && inspected.inspectionMode === endpoint(action, 'app-unit-inspection-mode')
    && (inspected.offlineUnitRoot ?? 'NONE') === offlineUnitRoot
    && (inspected.systemdAnalyzePath ?? 'NONE') === systemdAnalyze
    && (inspected.systemdAnalyzeSha256 ?? 'NONE')
      === endpoint(action, 'systemd-analyze-sha256')
    && (inspected.systemdAnalyzeEndpointIdentity ?? 'NONE')
      === endpoint(action, 'systemd-analyze-identity')
    && inspected.systemctlPath === systemctlPath
    && inspected.unit === endpoint(action, 'app-unit-name')
    && inspected.unit === env.APP_UNIT
    && inspected.fragmentPath === endpoint(action, 'app-unit-fragment-path')
    && inspected.fragmentSha256 === endpoint(action, 'app-unit-fragment-sha256')
    && inspected.fragmentEndpointIdentity
      === endpoint(action, 'app-unit-fragment-identity')
    && inspected.fragmentSourcePath
      === endpoint(action, 'app-unit-fragment-source-path')
    && inspected.fragmentSourceSha256
      === endpoint(action, 'app-unit-fragment-source-sha256')
    && inspected.fragmentSourceEndpointIdentity
      === endpoint(action, 'app-unit-fragment-source-identity')
    && Array.isArray(inspected.dropInPaths)
    && inspected.dropInState === endpoint(action, 'app-unit-drop-in-state')
    && (inspected.proofDropInPath ?? 'NONE') === proofDropIn
    && (inspected.proofDropInSha256 ?? 'NONE')
      === endpoint(action, 'app-unit-proof-drop-in-sha256')
    && (inspected.proofDropInEndpointIdentity ?? 'NONE')
      === endpoint(action, 'app-unit-proof-drop-in-identity')
    && inspected.proofDropInOwner
      === endpoint(action, 'app-unit-proof-drop-in-owner')
    && (inspected.proofDropInRuntimeLinkPath ?? 'NONE')
      === proofDropInRuntimeLink
    && (inspected.proofDropInRuntimeLinkEndpointIdentity ?? 'NONE')
      === endpoint(action, 'app-unit-proof-drop-in-runtime-link-identity')
    && (inspected.proofAbsentSentinel ?? 'NONE') === proofAbsentSentinel
    && inspected.runtimeEnvPath === endpoint(
      action,
      'app-unit-environment-file-path',
    )
    && inspected.runtimeEnvSha256 === endpoint(
      action,
      'app-unit-environment-file-sha256',
    )
    && inspected.runtimeEnvEndpointIdentity === endpoint(
      action,
      'app-unit-environment-file-identity',
    )
    && endpoint(action, 'app-unit-environment-file-optional') === 'no'
    && inspected.environmentFiles?.length === 1
    && inspected.environmentFiles?.[0]?.path === inspected.runtimeEnvPath
    && inspected.environmentFiles?.[0]?.optional === false
    && inspected.user === 'cosmos'
    && inspected.user === endpoint(action, 'app-unit-user')
    && inspected.group === 'cosmos'
    && inspected.group === endpoint(action, 'app-unit-group')
    && inspected.workingDirectory === '/opt/cosmos/current'
    && inspected.workingDirectory === endpoint(
      action,
      'app-unit-working-directory',
    )
    && inspected.namespaceRemapState === 'NONE'
    && inspected.namespaceRemapState === endpoint(
      action,
      'app-unit-namespace-remap-state',
    )
    && inspected.executionAuthorityState === 'CLOSED'
    && inspected.environmentAuthorityState === 'CLOSED'
    && inspected.identityAuthorityState === 'CLOSED'
    && inspected.effectReachability
      === endpoint(action, 'app-unit-effect-reachability')
    && inspected.authorityClosureSha256 === endpoint(
      action,
      'app-unit-authority-closure-sha256',
    )
    && inspected.unsetEnvironmentSha256 === endpoint(
      action,
      'app-unit-unset-environment-sha256',
    )
    && inspected.needDaemonReload === endpoint(
      action,
      'app-unit-need-daemon-reload',
    )
    && inspected.execStart?.path
      === endpoint(action, 'app-unit-exec-start-env-path')
    && inspected.execStart?.path === envPath
    && inspected.execStart?.argv?.[2]
      === endpoint(action, 'app-unit-exec-start-node-path')
    && inspected.execStart?.argv?.[2] === nodePath
    && inspected.execStartSha256
      === endpoint(action, 'app-unit-exec-start-sha256')
    && inspected.bindingSha256 === bindingSha256,
  'application unit differs from the consumed preview');
}

function requireActiveService(action, env, systemctlPath) {
  const executable = inspectBoundExecutable(action, 'systemctl', systemctlPath);
  const result = spawnSync(executable.absolute, ['is-active', env.APP_UNIT], {
    encoding: 'utf8',
    env: CLOSED_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 4_096,
    windowsHide: true,
  });
  assert(!result.error && result.signal === null && result.status === 0
    && result.stdout === 'active\n' && result.stderr === '',
  'rollback application unit is not exactly active');
  assertStableEvidence(executable, 'systemctl executable');
}

function requireRollbackHealth(action, env, curlPath) {
  const executable = inspectBoundExecutable(action, 'curl', curlPath);
  for (const gatePath of env.POST_SWITCH_GATE_PATHS.split(' ')) {
    const result = spawnSync(executable.absolute, [
      '--disable', '--fail', '--silent', '--show-error',
      '--connect-timeout', '2', '--max-time', '5', '--max-redirs', '0',
      '--proto', '=http', '--noproxy', '*',
      '--output', '/dev/null', '--write-out', '%{http_code}',
      `${env.HEALTH_BASE}${gatePath}`,
    ], {
      encoding: 'utf8',
      env: CLOSED_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 7_000,
      maxBuffer: 4_096,
      windowsHide: true,
    });
    assert(!result.error && result.signal === null && result.status === 0
      && result.stdout === '200' && result.stderr === '',
    `rollback loopback health failed for ${gatePath}`);
  }
  assertStableEvidence(executable, 'curl executable');
}

function readbackRelease(linkState) {
  assert(linkState.state === 'PRESENT', 'rollback readback release must be present');
  return Object.freeze({
    link: linkState.link,
    linkIdentity: linkState.linkIdentity,
    path: linkState.path,
    releaseId: linkState.releaseId,
    testedSha: linkState.testedSha,
    artifactManifestSha256: linkState.artifactManifestSha256,
    treeSha256: linkState.treeSha256,
    identity: linkState.identity,
  });
}

function releaseBindingFromReadback(value) {
  return Object.freeze({
    path: value.path,
    releaseId: value.releaseId,
    testedSha: value.testedSha,
    artifactManifestSha256: value.artifactManifestSha256,
    treeSha256: value.treeSha256,
    identity: value.identity,
  });
}

function captureRollbackReadback({
  phase,
  action,
  risk,
  targetPath,
  envPath,
  systemctlPath,
  curlPath,
  clockArgs,
  requireActiveWindow = true,
  frozen = false,
  terminalTestFallback = undefined,
}) {
  assert(['PRE', 'POST', 'AMBIGUOUS'].includes(phase),
    'rollback readback phase is invalid');
  assert(phase === 'POST' || frozen === false,
    'only a post-rollback readback may be frozen');
  const ambiguous = phase === 'AMBIGUOUS';
  const sanitized = readSanitizedRollbackEnv(envPath, action);
  const env = sanitized.values;
  const releases = canonicalDirectory(env.RELEASES_DIR, 'rollback releases directory', {
    requireOwner: true,
  }).absolute;
  const target = inspectInstalledRelease(targetPath, 'authorized rollback target');
  assert(target.path === targetPath
    && target.path === resolve(releases, target.releaseId),
  'authorized rollback target must be its canonical installed release path');
  assertReleaseEndpointBinding(target, action);
  const current = inspectReleaseLink(env.CURRENT_LINK, releases, 'rollback current link');
  const previous = inspectReleaseLink(
    env.PREVIOUS_LINK,
    releases,
    'rollback previous link',
    { allowAbsent: true },
  );
  const observedAtUtc = provenanceBoundTimestamp(
    clockArgs,
    risk,
    'rollback readback time',
    { terminalTestFallback },
  );
  const observed = Date.parse(observedAtUtc);
  const starts = Date.parse(risk.authorizationWindow.startsAtUtc);
  const expires = Date.parse(risk.authorizationWindow.expiresAtUtc);
  if (requireActiveWindow) {
    assert(starts <= observed && observed < expires,
      'rollback readback must occur inside the producer-bound authorization window');
  }
  if (phase === 'PRE') {
    assert(current.path !== target.path,
      'pre-rollback current release must differ from the authorized target');
    assertReleaseEndpointBinding(
      releaseBindingFromReadback(current),
      action,
      'current-',
    );
  } else if (phase === 'POST') {
    assert(sameJson(releaseBindingFromReadback(current), target),
      'post-rollback current release differs from the authorized target');
    requireBoundAppUnit(action, env, systemctlPath, risk);
    if (!frozen) {
      requireActiveService(action, env, systemctlPath);
      requireRollbackHealth(action, env, curlPath);
    }
  } else {
    requireBoundAppUnit(action, env, systemctlPath, risk);
  }
  assertStableEvidence(sanitized.evidence, 'sanitized rollback environment');
  const base = {
    schemaVersion: 1,
    kind: 'ROLLBACK_TARGET_READBACK',
    phase,
    status: ambiguous
      ? 'DEPLOYMENT_EFFECT_STATE_AMBIGUOUS'
      : (frozen ? 'DEPLOYMENT_SWITCHED_FROZEN' : 'DEPLOYMENT_READBACK_VALID'),
    testedSha: current.testedSha,
    deployedSha: current.testedSha,
    releaseId: current.releaseId,
    blocker: ambiguous
      ? 'AUTHORIZED_EFFECT_TERMINATED_STATE_UNRESOLVED'
      : (frozen ? 'POST_SWITCH_GATE_FAILED' : null),
    observedAtUtc,
    current: readbackRelease(current),
    previous: previous.state === 'ABSENT'
      ? { link: previous.link, state: 'ABSENT' }
      : { ...readbackRelease(previous), state: 'PRESENT' },
  };
  return Object.freeze(phase !== 'PRE'
    ? {
        ...base,
        service: {
          unit: env.APP_UNIT,
          state: (frozen || ambiguous) ? 'UNKNOWN' : 'ACTIVE',
        },
        postSwitchGate: {
          base: env.HEALTH_BASE,
          paths: env.POST_SWITCH_GATE_PATHS.split(' '),
          status: ambiguous ? 'UNKNOWN' : (frozen ? 'FAIL' : 'PASS'),
        },
      }
    : base);
}

function validateRollbackReadback(value, phase, label, {
  frozen = false,
  ambiguous = false,
} = {}) {
  const commonKeys = [
    'schemaVersion', 'kind', 'phase', 'status', 'testedSha', 'deployedSha',
    'releaseId', 'blocker', 'observedAtUtc', 'current', 'previous',
  ];
  exactObjectKeys(
    value,
    phase !== 'PRE' ? [...commonKeys, 'service', 'postSwitchGate'] : commonKeys,
    label,
  );
  assert(ambiguous === (phase === 'AMBIGUOUS'),
    `${label} ambiguous phase option is invalid`);
  assert(value.schemaVersion === 1 && value.kind === 'ROLLBACK_TARGET_READBACK'
    && value.phase === phase
    && value.status === (ambiguous
      ? 'DEPLOYMENT_EFFECT_STATE_AMBIGUOUS'
      : (frozen ? 'DEPLOYMENT_SWITCHED_FROZEN' : 'DEPLOYMENT_READBACK_VALID'))
    && value.blocker === (ambiguous
      ? 'AUTHORIZED_EFFECT_TERMINATED_STATE_UNRESOLVED'
      : (frozen ? 'POST_SWITCH_GATE_FAILED' : null))
    && value.testedSha === value.deployedSha
    && value.releaseId === `i00-${value.deployedSha}`,
  `${label} identity is invalid`);
  exactUtcSeconds(value.observedAtUtc, `${label}.observedAtUtc`);
  const releaseKeys = [
    'link', 'linkIdentity', 'path', 'releaseId', 'testedSha',
    'artifactManifestSha256', 'treeSha256', 'identity',
  ];
  exactObjectKeys(value.current, releaseKeys, `${label}.current`);
  assert(value.current.releaseId === value.releaseId
    && value.current.testedSha === value.deployedSha
    && value.current.path.startsWith('/')
    && value.current.link.startsWith('/')
    && /^[0-9a-f]{64}$/u.test(value.current.artifactManifestSha256)
    && /^[0-9a-f]{64}$/u.test(value.current.treeSha256),
  `${label}.current is invalid`);
  assert(value.previous !== null && typeof value.previous === 'object'
    && !Array.isArray(value.previous), `${label}.previous must be an object`);
  if (value.previous.state === 'ABSENT') {
    exactObjectKeys(value.previous, ['link', 'state'], `${label}.previous`);
  } else {
    exactObjectKeys(value.previous, [...releaseKeys, 'state'], `${label}.previous`);
    assert(value.previous.state === 'PRESENT'
      && value.previous.path !== value.current.path,
    `${label}.previous is invalid`);
  }
  if (phase !== 'PRE') {
    exactObjectKeys(value.service, ['unit', 'state'], `${label}.service`);
    exactObjectKeys(
      value.postSwitchGate,
      ['base', 'paths', 'status'],
      `${label}.postSwitchGate`,
    );
    assert(value.service.unit === 'cosmos-app.service'
      && value.service.state === ((frozen || ambiguous) ? 'UNKNOWN' : 'ACTIVE')
      && sameJson(value.postSwitchGate.paths, ['/health/live', '/health/ready'])
      && value.postSwitchGate.status
        === (ambiguous ? 'UNKNOWN' : (frozen ? 'FAIL' : 'PASS')),
    `${label} service/readiness proof is invalid`);
  }
  return value;
}

function sameRollbackLinkState(left, right) {
  const comparable = (value) => ({
    status: value.status,
    blocker: value.blocker,
    current: value.current,
    previous: value.previous,
    ...(value.phase !== 'PRE'
      ? { service: value.service, postSwitchGate: value.postSwitchGate }
      : {}),
  });
  return sameJson(comparable(left), comparable(right));
}

function validateRollbackTransition(pre, post, target) {
  assert(pre.current.path !== target.path
    && sameJson(releaseBindingFromReadback(post.current), target),
  'rollback transition does not move from a distinct release to the authorized target');
  assert(post.previous.state === 'PRESENT'
    && sameJson(
      releaseBindingFromReadback(post.previous),
      releaseBindingFromReadback(pre.current),
    ),
  'rollback previous link does not retain the exact pre-rollback release');
  assert(Date.parse(pre.observedAtUtc) <= Date.parse(post.observedAtUtc),
    'rollback post-target readback predates the pre-target readback');
}

function rollbackClaimPaths(action, preview, evidenceRootArgument) {
  const expectedRoot = endpoint(action, 'rollback-evidence-root');
  const expectedRootIdentity = endpoint(action, 'rollback-evidence-root-identity');
  const rootEvidence = canonicalDirectory(evidenceRootArgument, 'rollback evidence root', {
    requirePrivate: true,
  });
  const root = rootEvidence.absolute;
  assert(root === evidenceRootArgument && root === expectedRoot,
    'rollback evidence root differs from the consumed preview');
  assert(directoryIdentityEndpoint(rootEvidence.stat) === expectedRootIdentity,
    'rollback evidence root identity differs from the consumed preview');
  const claimKey = preview.singleUse.claimKey;
  const claimDirectory = resolve(root, claimKey);
  return Object.freeze({
    root,
    rootIdentity: expectedRootIdentity,
    claimKey,
    claimDirectory,
    effect: resolve(claimDirectory, ROLLBACK_EFFECT_FILE),
    refusal: resolve(claimDirectory, ROLLBACK_REFUSAL_FILE),
    evidence: Object.freeze(Object.fromEntries(
      Object.entries(ROLLBACK_EVIDENCE_FILES)
        .map(([key, name]) => [key, resolve(claimDirectory, name)]),
    )),
  });
}

function assertRollbackRootStillBound(paths, label) {
  const root = canonicalDirectory(paths.root, label, { requirePrivate: true });
  assert(directoryIdentityEndpoint(root.stat) === paths.rootIdentity,
    `${label} identity differs from the consumed preview`);
  return root;
}

function createPrivateClaimDirectory(paths, {
  allowPortableTestFallback = false,
} = {}) {
  const rootBefore = assertRollbackRootStillBound(
    paths,
    'rollback evidence root before claim creation',
  );
  assert(lstatSync(paths.claimDirectory, { throwIfNoEntry: false }) === undefined,
    'rollback claim evidence directory already exists');
  let descriptor;
  let claimCreated = false;
  let completed = false;
  try {
    descriptor = openSync(
      paths.root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const opened = fstatSync(descriptor, { bigint: true });
    const namedBefore = lstatSync(paths.root, { bigint: true });
    assert(opened.isDirectory() && !namedBefore.isSymbolicLink()
      && sameNamedObject(opened, rootBefore.stat)
      && sameNamedObject(opened, namedBefore)
      && directoryIdentityEndpoint(opened) === paths.rootIdentity
      && (opened.mode & 0o777n) === 0o700n
      && realpathSync(paths.root) === paths.root,
    'rollback evidence root changed before claim creation');
    if (typeof process.getuid === 'function') {
      assert(opened.uid === BigInt(process.getuid()),
        'rollback evidence root owner changed before claim creation');
    }
    assert(process.platform === 'linux' || allowPortableTestFallback,
      'production rollback claim creation requires Linux descriptor-relative semantics');
    const anchoredClaim = process.platform === 'linux'
      ? `/proc/self/fd/${descriptor}/${basename(paths.claimDirectory)}`
      : paths.claimDirectory;
    mkdirSync(anchoredClaim, { mode: 0o700 });
    claimCreated = true;
    const claim = canonicalDirectory(
      paths.claimDirectory,
      'rollback claim evidence directory',
      { requirePrivate: true },
    );
    assert(dirname(claim.absolute) === paths.root,
      'rollback claim evidence directory is not one direct child');
    const rootAfter = lstatSync(paths.root, { bigint: true });
    const openedAfter = fstatSync(descriptor, { bigint: true });
    assert(!rootAfter.isSymbolicLink()
      && sameNamedObject(opened, openedAfter)
      && sameNamedObject(openedAfter, rootAfter)
      && directoryIdentityEndpoint(openedAfter) === paths.rootIdentity
      && realpathSync(paths.root) === paths.root,
    'rollback evidence root identity changed during claim creation');
    fsyncSync(descriptor);
    const durableRoot = lstatSync(paths.root, { bigint: true });
    const durableOpened = fstatSync(descriptor, { bigint: true });
    assert(!durableRoot.isSymbolicLink()
      && sameNamedObject(opened, durableOpened)
      && sameNamedObject(durableOpened, durableRoot)
      && directoryIdentityEndpoint(durableOpened) === paths.rootIdentity
      && realpathSync(paths.root) === paths.root,
    'rollback evidence root identity changed during claim durability sync');
    completed = true;
  } finally {
    if (claimCreated && !completed && descriptor !== undefined) {
      // Pre-completion failure after the claim mkdir: remove only the empty claim
      // directory this call just created so an aborted run leaves no residue that
      // would trip the already-exists collision on a legitimate retry. rmdirSync
      // refuses non-empty directories, so anything already recorded inside a claim
      // is never destroyed, and a call that reached completion never enters this
      // branch — the completed claim still collides on reuse.
      try {
        const residueClaim = process.platform === 'linux'
          ? `/proc/self/fd/${descriptor}/${basename(paths.claimDirectory)}`
          : paths.claimDirectory;
        const residue = lstatSync(residueClaim, { bigint: true, throwIfNoEntry: false });
        if (residue !== undefined && residue.isDirectory() && !residue.isSymbolicLink()) {
          rmdirSync(residueClaim);
        }
      } catch {
        // Residue removal is best effort and must never mask the original refusal.
      }
    }
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readPrivateCanonicalJson(path, label, validate = (document) => document) {
  const evidence = stableRegular(path, label, {
    maximumBytes: 4 * 1024 * 1024,
    privateMode: true,
  });
  const document = parseEvidenceJson(evidence, label);
  assert(evidence.bytes.equals(canonicalJsonBytes(document)),
    `${label} bytes are not canonical`);
  validate(document);
  return Object.freeze({ ...evidence, document });
}

function publishSinglePrivateJson(path, document, label, {
  allowPortableTestFallback = false,
  rollbackPaths = null,
} = {}) {
  if (rollbackPaths !== null) {
    assertRollbackRootStillBound(rollbackPaths, `${label} rollback evidence root before publication`);
  }
  const bytes = canonicalJsonBytes(document);
  const reservation = reserveReceipt(path, label, { allowPortableTestFallback });
  try {
    writeReservedReceipt(reservation, bytes);
    closeReservation(reservation);
  } catch (error) {
    try { closeReservation(reservation); } catch {}
    throw error;
  }
  if (rollbackPaths !== null) {
    assertRollbackRootStillBound(rollbackPaths, `${label} rollback evidence root after publication`);
  }
  return Object.freeze({
    absolute: path,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length,
  });
}

function requireClaimInventory(paths, expectedNames, label) {
  assertRollbackRootStillBound(paths, `${label} rollback evidence root`);
  const claim = canonicalDirectory(paths.claimDirectory, label, {
    requirePrivate: true,
  });
  assert(dirname(claim.absolute) === paths.root,
    `${label} is not one direct evidence-root child`);
  const names = readdirSync(claim.absolute).sort();
  const expected = [...expectedNames].sort();
  assert(names.length === expected.length
    && names.every((name, index) => name === expected[index]),
  `${label} inventory is not exact`);
}

function assertRollbackReceiptTargets(args, risk, preview, claimDirectory) {
  const rootBinding = receiptRootBinding(risk);
  const result = privateReceiptTarget(
    args['result-receipt'],
    'rollback result receipt',
    rootBinding,
  );
  const reconciliation = privateReceiptTarget(
    args['reconciliation-receipt'],
    'rollback authorized reconciliation',
    rootBinding,
  );
  assert(result !== reconciliation
    && !pathsOverlap(result, claimDirectory)
    && !pathsOverlap(reconciliation, claimDirectory),
  'rollback receipt targets must be distinct from each other and claim evidence');
  assert(preview.action.receiptTargets.result === result
    && preview.action.receiptTargets.reconciliation === reconciliation,
  'rollback receipt targets differ from the consumed preview');
  return Object.freeze({ result, reconciliation });
}

function reserveReceipt(path, label, {
  allowPortableTestFallback = false,
  expectedRoot = null,
} = {}) {
  const absolute = privateReceiptTarget(path, label, expectedRoot);
  const parent = dirname(absolute);
  assert(typeof constants.O_NOFOLLOW === 'number'
    && typeof constants.O_DIRECTORY === 'number',
  `${label} runtime lacks required no-follow reservation support`);
  let parentDescriptor;
  let descriptor;
  try {
    parentDescriptor = openSync(
      parent,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const parentOpened = fstatSync(parentDescriptor, { bigint: true });
    const parentNamed = lstatSync(parent, { bigint: true });
    assert(parentOpened.isDirectory() && !parentNamed.isSymbolicLink()
      && sameNamedObject(parentOpened, parentNamed)
      && (parentOpened.mode & 0o777n) === 0o700n
      && realpathSync(parent) === parent,
    `${label} parent identity changed before reservation`);
    if (expectedRoot !== null) {
      assert(parent === expectedRoot.path
        && directoryIdentityEndpoint(parentOpened) === expectedRoot.identity,
      `${label} parent differs from the deployment receipt-root binding`);
    }
    if (typeof process.getuid === 'function') {
      assert(parentOpened.uid === BigInt(process.getuid()),
        `${label} parent owner changed before reservation`);
    }
    assert(process.platform === 'linux' || allowPortableTestFallback,
      `${label} production publication requires Linux descriptor-relative semantics`);
    const anchoredOutput = process.platform === 'linux'
      ? `/proc/self/fd/${parentDescriptor}/${basename(absolute)}`
      : absolute;
    descriptor = openSync(
      anchoredOutput,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
        | constants.O_NOFOLLOW,
      0o600,
    );
    const opened = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(absolute, { bigint: true });
    assert(opened.isFile() && opened.nlink === 1n
      && !named.isSymbolicLink() && sameStatIdentity(opened, named)
      && opened.size === 0n && (opened.mode & 0o777n) === 0o600n
      && realpathSync(absolute) === absolute,
    `${label} reservation is not one exact private regular file`);
    if (typeof process.getuid === 'function') {
      assert(opened.uid === BigInt(process.getuid()),
        `${label} reservation owner changed`);
    }
    return {
      absolute,
      parent,
      parentDescriptor,
      parentIdentity: parentOpened,
      descriptor,
      identity: opened,
      label,
      descriptorClosed: false,
      parentClosed: false,
    };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (parentDescriptor !== undefined) closeSync(parentDescriptor);
    throw error;
  }
}

function closeReservation(reservation) {
  if (!reservation) return;
  let firstError;
  if (!reservation.descriptorClosed) {
    try {
      closeSync(reservation.descriptor);
    } catch (error) {
      firstError = error;
    }
    reservation.descriptorClosed = true;
  }
  if (!reservation.parentClosed) {
    try {
      closeSync(reservation.parentDescriptor);
    } catch (error) {
      firstError ??= error;
    }
    reservation.parentClosed = true;
  }
  if (firstError) throw firstError;
}

function assertParentStillBound(reservation) {
  const opened = fstatSync(reservation.parentDescriptor, { bigint: true });
  const named = lstatSync(reservation.parent, { bigint: true });
  assert(opened.isDirectory() && !named.isSymbolicLink()
    && sameNamedObject(opened, reservation.parentIdentity)
    && sameNamedObject(opened, named)
    && (opened.mode & 0o777n) === 0o700n
    && realpathSync(reservation.parent) === reservation.parent,
  `${reservation.label} parent identity changed during publication`);
  if (typeof process.getuid === 'function') {
    assert(opened.uid === BigInt(process.getuid()),
      `${reservation.label} parent owner changed during publication`);
  }
}

function writeReservedReceipt(reservation, bytes) {
  const before = fstatSync(reservation.descriptor, { bigint: true });
  assert(sameNamedObject(before, reservation.identity) && before.size === 0n,
    `${reservation.label} reservation changed before publication`);
  writeFileSync(reservation.descriptor, bytes);
  fsyncSync(reservation.descriptor);
  const after = fstatSync(reservation.descriptor, { bigint: true });
  const named = lstatSync(reservation.absolute, { bigint: true });
  assert(after.isFile() && after.nlink === 1n && !named.isSymbolicLink()
    && sameStatIdentity(after, named)
    && sameNamedObject(after, reservation.identity)
    && after.size === BigInt(bytes.length)
    && (after.mode & 0o777n) === 0o600n
    && realpathSync(reservation.absolute) === reservation.absolute,
  `${reservation.label} final identity is invalid`);
  const readback = Buffer.alloc(bytes.length);
  let offset = 0;
  while (offset < readback.length) {
    const count = readSync(
      reservation.descriptor,
      readback,
      offset,
      readback.length - offset,
      offset,
    );
    assert(count > 0, `${reservation.label} readback ended early`);
    offset += count;
  }
  const extra = Buffer.alloc(1);
  assert(readSync(reservation.descriptor, extra, 0, 1, offset) === 0
    && readback.equals(bytes),
  `${reservation.label} readback differs from the canonical document`);
  assertParentStillBound(reservation);
  fsyncSync(reservation.parentDescriptor);
}

function publishReceiptPair({
  resultPath,
  resultBytes,
  reconciliationPath,
  reconciliationBytes,
  failAfterResult = false,
  allowPortableTestFallback = false,
  expectedRoot = null,
}) {
  let resultReservation;
  let reconciliationReservation;
  try {
    resultReservation = reserveReceipt(
      resultPath,
      'authorized action result',
      { allowPortableTestFallback, expectedRoot },
    );
    reconciliationReservation = reserveReceipt(
      reconciliationPath,
      'authorized action reconciliation',
      { allowPortableTestFallback, expectedRoot },
    );
    writeReservedReceipt(resultReservation, resultBytes);
    if (failAfterResult) {
      throw new Error('authorized action test fault after result publication');
    }
    // Reconciliation is the commit marker. It must never become durable before
    // the exact result bytes named by resultReceiptSha256.
    writeReservedReceipt(reconciliationReservation, reconciliationBytes);
    closeReservation(reconciliationReservation);
    closeReservation(resultReservation);
    return Object.freeze({
      result: Object.freeze({
        absolute: resultPath,
        sha256: sha256Bytes(resultBytes),
        byteLength: resultBytes.length,
      }),
      reconciliation: Object.freeze({
        absolute: reconciliationPath,
        sha256: sha256Bytes(reconciliationBytes),
        byteLength: reconciliationBytes.length,
      }),
    });
  } catch (error) {
    let closeFailed = false;
    for (const reservation of [reconciliationReservation, resultReservation]) {
      try {
        closeReservation(reservation);
      } catch {
        closeFailed = true;
      }
    }
    if (closeFailed) {
      throw new Error('authorized action receipt reservations remain fail-closed after close failure');
    }
    // There is no portable conditional-unlink primitive in Node. Once an
    // O_EXCL receipt pathname is visible, path-based cleanup would reintroduce
    // a lstat/unlink race that can delete a replacement inode. Leave both
    // private reservations fail-closed for explicit owner reconciliation.
    throw error;
  }
}

function assertRollbackEvidenceStable(chain, ...extraEvidence) {
  for (const evidence of [
    chain.authorization,
    chain.risk,
    chain.preview,
    chain.consumption,
    ...extraEvidence,
  ].filter(Boolean)) {
    assertStableEvidence(evidence, 'rollback authorization/evidence');
  }
}

function readRollbackFrozenMarker(env, target, chain, completedAtUtc) {
  const source = stableRegular(
    env.FROZEN_MARKER,
    'rollback frozen marker',
    { maximumBytes: 16 * 1024, requireOwner: true },
  );
  const mode = source.stat.mode & 0o7777n;
  assert(mode === 0o400n,
    'rollback frozen marker must be sealed mode 0400');
  const document = parseEvidenceJson(source, 'rollback frozen marker');
  exactObjectKeys(
    document,
    ['ts', 'releaseId', 'exposure', 'reason', 'operatorAction'],
    'rollback frozen marker',
  );
  exactUtcSeconds(document.ts, 'rollback frozen marker.ts');
  assert(document.releaseId === target.releaseId
    && document.exposure === 'NONE'
    && document.operatorAction === 'required'
    && [
      'rollback: systemctl ' + 'restart cosmos-app.service failed',
      'rollback: post-rollback health gate failed',
    ].includes(document.reason),
  'rollback frozen marker does not describe the exact authorized failed effect');
  const markerAt = Date.parse(document.ts);
  assert(Date.parse(chain.consumption.document.consumedAtUtc) <= markerAt
    && markerAt <= Date.parse(completedAtUtc),
  'rollback frozen marker chronology is invalid');
  return Object.freeze({ source, document });
}

function validateRollbackEffectRecord(
  effect,
  chain,
  pre,
  post,
  target,
  {
    expectedDonorExitCode = null,
    expectedEffectBinding = null,
  } = {},
) {
  const schema = ROLLBACK_EFFECT_SCHEMA(effect);
  assert(schema.valid, `authorized rollback effect schema rejected: ${schema.error}`);
  if (expectedDonorExitCode !== null) {
    assert(effect.donorExitCode === expectedDonorExitCode,
      'authorized rollback effect donor disposition is unexpected');
  }
  const completed = effect.terminal.status === 'AUTHORIZED_EFFECT_COMPLETED';
  const frozen = effect.terminal.status === 'AUTHORIZED_EFFECT_TERMINATED'
    && effect.donorExitCode === 3
    && effect.terminal.signal === null
    && effect.terminal.forced === false
    && effect.terminal.timedOut === false;
  const ambiguous = effect.terminal.status === 'AUTHORIZED_EFFECT_TERMINATED'
    && !frozen;
  assert(effect.donorExitCode === effect.terminal.exitCode,
    'authorized rollback effect donor exit differs from its terminal evidence');
  assert((frozen
    && effect.status === 'ROLLBACK_SWITCHED_FROZEN_PENDING_OWNER_ACTION'
    && /^[0-9a-f]{64}$/u.test(effect.frozenMarkerSha256)
    && post.status === 'DEPLOYMENT_SWITCHED_FROZEN')
    || (completed
      && effect.status === 'ROLLBACK_EFFECT_RECORDED_PENDING_RECONCILIATION'
      && effect.frozenMarkerSha256 === null
      && post.status === 'DEPLOYMENT_READBACK_VALID')
    || (ambiguous
      && effect.status === 'ROLLBACK_EFFECT_AMBIGUOUS_PENDING_OWNER_ACTION'
      && effect.frozenMarkerSha256 === null
      && post.status === 'DEPLOYMENT_EFFECT_STATE_AMBIGUOUS'),
  'authorized rollback effect status differs from its donor disposition');
  assert(effect.authorizationId === chain.authorization.document.authorizationId
    && effect.riskVersion === chain.risk.document.riskVersion
    && effect.serverPreviewDigest === chain.preview.document.serverPreviewDigest
    && effect.authorizationSha256 === chain.authorization.sha256
    && effect.riskDocumentSha256 === chain.risk.sha256
    && effect.previewDocumentSha256 === chain.preview.sha256
    && effect.authorizationConsumptionSha256 === chain.consumption.sha256
    && effect.claimKey === chain.preview.document.singleUse.claimKey,
  'authorized rollback effect provenance differs from the consumed chain');
  assert(expectedEffectBinding !== null
    && sameJson(effect.effect, expectedEffectBinding)
    && effect.startedAtUtc === expectedEffectBinding.effectStartedAtUtc,
  'authorized rollback effect runner evidence binding is invalid');
  assert(sameJson(effect.from, releaseBindingFromReadback(pre.current))
    && sameJson(effect.to, target)
    && effect.preTargetReadbackSha256 === sha256Bytes(canonicalJsonBytes(pre))
    && effect.postTargetReadbackSha256 === sha256Bytes(canonicalJsonBytes(post)),
  'authorized rollback effect release/readback binding is contradictory');
  if (!ambiguous) validateRollbackTransition(pre, post, target);
  validateCompletionChronology(
    effect.completedAtUtc,
    chain.authorization.document,
    chain.risk.document,
    chain.consumption.document,
  );
  assert(Date.parse(effect.startedAtUtc) >= Date.parse(chain.consumption.document.consumedAtUtc)
    && Date.parse(effect.startedAtUtc) <= Date.parse(effect.completedAtUtc),
  'authorized rollback effect start/completion chronology is invalid');
}

function stageRollback(args) {
  const chain = readRollbackProducerChain(args);
  const allowPortableTestFallback =
    chain.risk.document.provenanceMode === 'TEST_FIXTURE_INJECTED';
  const paths = rollbackClaimPaths(
    chain.preview.document.action,
    chain.preview.document,
    args['evidence-root'],
  );
  assertRollbackReceiptTargets(
    args,
    chain.risk.document,
    chain.preview.document,
    paths.claimDirectory,
  );
  assert(lstatSync(paths.claimDirectory, { throwIfNoEntry: false }) === undefined,
    'rollback claim evidence directory must be absent before staging');
  const capture = {
    phase: 'PRE',
    action: chain.preview.document.action,
    risk: chain.risk.document,
    targetPath: resolve(args['primary-path']),
    envPath: resolve(args['env-file']),
    systemctlPath: args.systemctl,
    curlPath: args.curl,
    clockArgs: args,
  };
  const first = captureRollbackReadback(capture);
  const second = captureRollbackReadback(capture);
  assert(sameRollbackLinkState(first, second),
    'pre-rollback release state changed during staging');
  assertStableEvidence(chain.risk, 'rollback risk');
  assertStableEvidence(chain.preview, 'rollback preview');
  createPrivateClaimDirectory(paths, { allowPortableTestFallback });
  const pre = publishSinglePrivateJson(
    paths.evidence.preTargetReadback,
    second,
    'pre-rollback target readback',
    { allowPortableTestFallback, rollbackPaths: paths },
  );
  requireClaimInventory(
    paths,
    [ROLLBACK_EVIDENCE_FILES.preTargetReadback],
    'staged rollback claim evidence',
  );
  return Object.freeze({
    status: 'ROLLBACK_STAGE_READY_NOT_AUTHORIZED',
    claimKey: paths.claimKey,
    preTargetReadbackSha256: pre.sha256,
  });
}

function verifyRollbackStage(args) {
  const chain = readAuthorizedRollbackChain(args);
  const paths = rollbackClaimPaths(
    chain.preview.document.action,
    chain.preview.document,
    args['evidence-root'],
  );
  assertRollbackReceiptTargets(
    args,
    chain.risk.document,
    chain.preview.document,
    paths.claimDirectory,
  );
  requireClaimInventory(
    paths,
    [ROLLBACK_EVIDENCE_FILES.preTargetReadback],
    'staged rollback claim evidence',
  );
  const pre = readPrivateCanonicalJson(
    paths.evidence.preTargetReadback,
    'pre-rollback target readback',
    (document) => validateRollbackReadback(document, 'PRE', 'pre-rollback target readback'),
  );
  const consumedAt = Date.parse(chain.consumption.document.consumedAtUtc);
  assert(Date.parse(pre.document.observedAtUtc) <= consumedAt,
    'pre-rollback readback must predate authorization consumption');
  const current = captureRollbackReadback({
    phase: 'PRE',
    action: chain.preview.document.action,
    risk: chain.risk.document,
    targetPath: resolve(args['primary-path']),
    envPath: resolve(args['env-file']),
    systemctlPath: args.systemctl,
    curlPath: args.curl,
    clockArgs: args,
  });
  assert(consumedAt <= Date.parse(current.observedAtUtc)
    && sameRollbackLinkState(pre.document, current),
  'pre-rollback release state changed between staging and effect authorization');
  assertRollbackEvidenceStable(chain, pre);
  requireClaimInventory(
    paths,
    [ROLLBACK_EVIDENCE_FILES.preTargetReadback],
    'verified rollback claim evidence',
  );
  return Object.freeze({
    status: 'ROLLBACK_STAGE_VERIFIED_FOR_EFFECT',
    claimKey: paths.claimKey,
    preTargetReadbackSha256: pre.sha256,
  });
}

function recordRollbackRefusal(args) {
  const chain = readAuthorizedRollbackChain(args);
  const allowPortableTestFallback =
    chain.risk.document.provenanceMode === 'TEST_FIXTURE_INJECTED';
  const paths = rollbackClaimPaths(
    chain.preview.document.action,
    chain.preview.document,
    args['evidence-root'],
  );
  const targets = assertRollbackReceiptTargets(
    args,
    chain.risk.document,
    chain.preview.document,
    paths.claimDirectory,
  );
  requireClaimInventory(
    paths,
    [ROLLBACK_EVIDENCE_FILES.preTargetReadback],
    'pre-refusal rollback claim evidence',
  );
  const refusalPhase = args['refusal-phase'];
  assert(['STAGE_VERIFY_FAILED', 'DONOR_TERMINATED'].includes(refusalPhase),
    'rollback refusal phase is invalid');
  let authorizedEffect = null;
  let effectBinding = null;
  let donorExitCode = null;
  let refusalClass = 'STAGE_VERIFY_FAILED';
  if (refusalPhase === 'STAGE_VERIFY_FAILED') {
    assertAuthorizedEffectEvidenceAbsent(chain.preview.document.action);
  } else {
    authorizedEffect = readAuthorizedEffectOutcome(args, chain);
    donorExitCode = authorizedEffect.terminal.document.exitCode;
    refusalClass = ROLLBACK_REFUSAL_CLASSES[donorExitCode];
    assert(authorizedEffect.success === false
      && refusalClass !== undefined,
    'donor refusal requires one bound terminated effect with exit code 1, 4, 5, or 6');
    effectBinding = authorizedEffectReceiptBinding(
      chain,
      authorizedEffect,
      receiptRootBinding(chain.risk.document),
    );
  }
  const pre = readPrivateCanonicalJson(
    paths.evidence.preTargetReadback,
    'pre-rollback target readback',
    (document) => validateRollbackReadback(
      document,
      'PRE',
      'pre-rollback target readback',
    ),
  );
  assert(Date.parse(pre.document.observedAtUtc)
    <= Date.parse(chain.consumption.document.consumedAtUtc),
  'pre-rollback readback must predate authorization consumption');
  const target = inspectInstalledRelease(
    resolve(args['primary-path']),
    'authorized rollback target',
  );
  assertReleaseEndpointBinding(target, chain.preview.document.action);
  const sanitized = readSanitizedRollbackEnv(
    resolve(args['env-file']),
    chain.preview.document.action,
  );
  requireBoundAppUnit(
    chain.preview.document.action,
    sanitized.values,
    resolve(args.systemctl),
    chain.risk.document,
  );
  const capture = {
    phase: 'PRE',
    action: chain.preview.document.action,
    risk: chain.risk.document,
    targetPath: target.path,
    envPath: resolve(args['env-file']),
    systemctlPath: resolve(args.systemctl),
    curlPath: resolve(args.curl),
    clockArgs: args,
    terminalTestFallback:
      authorizedEffect?.terminal.document.effectFinishedAtUtc,
  };
  const refusalReadback = captureRollbackReadback(capture);
  const confirmation = captureRollbackReadback(capture);
  assert(sameRollbackLinkState(pre.document, refusalReadback)
    && sameRollbackLinkState(refusalReadback, confirmation),
  'rollback refusal did not retain the exact staged release links');
  const completedAtUtc = confirmation.observedAtUtc;
  assert(Date.parse(chain.consumption.document.consumedAtUtc)
      <= Date.parse(refusalReadback.observedAtUtc)
    && (authorizedEffect === null
      || Date.parse(authorizedEffect.terminal.document.effectFinishedAtUtc)
        <= Date.parse(refusalReadback.observedAtUtc)),
  'rollback refusal readback chronology is invalid');
  validateCompletionChronology(
    completedAtUtc,
    chain.authorization.document,
    chain.risk.document,
    chain.consumption.document,
  );
  const refusalReadbackSha256 =
    sha256Bytes(canonicalJsonBytes(refusalReadback));
  const refusal = {
    schemaVersion: 1,
    kind: 'AUTHORIZED_ROLLBACK_REFUSAL',
    status: 'ROLLBACK_REFUSED_NO_EFFECT',
    authorizationId: chain.authorization.document.authorizationId,
    riskVersion: chain.risk.document.riskVersion,
    serverPreviewDigest: chain.preview.document.serverPreviewDigest,
    authorizationSha256: chain.authorization.sha256,
    riskDocumentSha256: chain.risk.sha256,
    previewDocumentSha256: chain.preview.sha256,
    authorizationConsumptionSha256: chain.consumption.sha256,
    claimKey: paths.claimKey,
    target,
    retainedCurrent: releaseBindingFromReadback(pre.document.current),
    preTargetReadbackSha256: pre.sha256,
    refusalReadbackSha256,
    refusalPhase,
    donorExitCode,
    refusalClass,
    effect: effectBinding,
    completedAtUtc,
  };
  const refusalSchema = ROLLBACK_REFUSAL_SCHEMA(refusal);
  assert(refusalSchema.valid,
    `authorized rollback refusal schema rejected: ${refusalSchema.error}`);
  const refusalReadbackEvidence = publishSinglePrivateJson(
    resolve(paths.claimDirectory, ROLLBACK_REFUSAL_READBACK_FILE),
    refusalReadback,
    'rollback refusal readback',
    { allowPortableTestFallback, rollbackPaths: paths },
  );
  assert(refusalReadbackEvidence.sha256 === refusalReadbackSha256,
    'published rollback refusal readback differs from the refusal record');
  const authorizationEvidence = publishSinglePrivateJson(
    paths.evidence.authorization,
    chain.authorization.document,
    'rollback refusal authorization evidence',
    { allowPortableTestFallback, rollbackPaths: paths },
  );
  assert(authorizationEvidence.sha256 === chain.authorization.sha256,
    'published rollback refusal authorization differs from the consumed authorization');
  const refusalEvidence = publishSinglePrivateJson(
    paths.refusal,
    refusal,
    'authorized rollback refusal record',
    { allowPortableTestFallback, rollbackPaths: paths },
  );
  const copiedRefusalReadback = readPrivateCanonicalJson(
    resolve(paths.claimDirectory, ROLLBACK_REFUSAL_READBACK_FILE),
    'rollback refusal readback',
    (document) => validateRollbackReadback(
      document,
      'PRE',
      'rollback refusal readback',
    ),
  );
  const copiedAuthorization = readPrivateCanonicalJson(
    paths.evidence.authorization,
    'rollback refusal authorization evidence',
  );
  const copiedRefusal = readPrivateCanonicalJson(
    paths.refusal,
    'authorized rollback refusal record',
    (document) => {
      const schema = ROLLBACK_REFUSAL_SCHEMA(document);
      assert(schema.valid,
        `authorized rollback refusal schema rejected: ${schema.error}`);
    },
  );
  assert(copiedRefusalReadback.sha256 === refusalReadbackEvidence.sha256
    && copiedAuthorization.sha256 === authorizationEvidence.sha256
    && copiedRefusal.sha256 === refusalEvidence.sha256,
  'rollback refusal evidence changed before terminal outcome publication');
  assertRollbackEvidenceStable(
    chain,
    pre,
    copiedRefusalReadback,
    copiedAuthorization,
    copiedRefusal,
    sanitized.evidence,
    authorizedEffect?.start,
    authorizedEffect?.terminal,
  );
  requireClaimInventory(paths, [
    ROLLBACK_EVIDENCE_FILES.preTargetReadback,
    ROLLBACK_REFUSAL_READBACK_FILE,
    ROLLBACK_EVIDENCE_FILES.authorization,
    ROLLBACK_REFUSAL_FILE,
  ], 'terminal refused rollback claim evidence');
  const result = {
    schemaVersion: 1,
    kind: 'AUTHORIZED_ACTION_RESULT',
    status: 'ACTION_REFUSED_NO_EFFECT',
    actionClass: 'SERVICE_ROLLBACK',
    authorizationId: chain.authorization.document.authorizationId,
    deployedSha: refusal.retainedCurrent.testedSha,
    riskVersion: chain.risk.document.riskVersion,
    serverPreviewDigest: chain.preview.document.serverPreviewDigest,
    authorizationConsumptionSha256: chain.consumption.sha256,
    completedAtUtc,
    outcome: {
      status: 'ROLLBACK_REFUSED_NO_EFFECT',
      primaryPath: paths.refusal,
      evidenceSha256: refusalEvidence.sha256,
      detail: 'authorized rollback refused before switch; release links retained',
    },
    ...(effectBinding === null ? {} : { effect: effectBinding }),
  };
  const resultSchema = RESULT_SCHEMA(result);
  assert(resultSchema.valid,
    `authorized rollback refusal result schema rejected: ${resultSchema.error}`);
  const resultBytes = canonicalJsonBytes(result);
  const reconciliation = {
    schemaVersion: 1,
    kind: 'AUTHORIZED_ACTION_RECONCILIATION',
    status: 'RECONCILED',
    actionClass: 'SERVICE_ROLLBACK',
    authorizationId: result.authorizationId,
    deployedSha: result.deployedSha,
    riskVersion: result.riskVersion,
    serverPreviewDigest: result.serverPreviewDigest,
    authorizationConsumptionSha256: result.authorizationConsumptionSha256,
    resultReceiptSha256: sha256Bytes(resultBytes),
    reconciledAtUtc: completedAtUtc,
    disposition: 'ROLLBACK_REFUSED_NO_EFFECT_RECONCILED',
    ...(effectBinding === null ? {} : { effect: effectBinding }),
  };
  const reconciliationSchema = RECONCILIATION_SCHEMA(reconciliation);
  assert(reconciliationSchema.valid,
    `authorized rollback refusal reconciliation schema rejected: ${reconciliationSchema.error}`);
  publishReceiptPair({
    resultPath: targets.result,
    resultBytes,
    reconciliationPath: targets.reconciliation,
    reconciliationBytes: canonicalJsonBytes(reconciliation),
    allowPortableTestFallback,
    expectedRoot: receiptRootBinding(chain.risk.document),
  });
  return Object.freeze({
    status: 'ROLLBACK_REFUSED_NO_EFFECT_RECONCILED',
    claimKey: paths.claimKey,
    refusalRecordSha256: refusalEvidence.sha256,
  });
}

function recordRollbackEffect(args) {
  const chain = readAuthorizedRollbackChain(args);
  const allowPortableTestFallback =
    chain.risk.document.provenanceMode === 'TEST_FIXTURE_INJECTED';
  const paths = rollbackClaimPaths(
    chain.preview.document.action,
    chain.preview.document,
    args['evidence-root'],
  );
  const targets = assertRollbackReceiptTargets(
    args,
    chain.risk.document,
    chain.preview.document,
    paths.claimDirectory,
  );
  requireClaimInventory(
    paths,
    [ROLLBACK_EVIDENCE_FILES.preTargetReadback],
    'pre-effect rollback claim evidence',
  );
  const authorizedEffect = readAuthorizedEffectOutcome(args, chain);
  const donorExitCode = authorizedEffect.terminal.document.exitCode;
  assert(authorizedEffect.success === false || donorExitCode === 0,
    'completed rollback effect requires bound runner exit 0');
  const effectBinding = authorizedEffectReceiptBinding(
    chain,
    authorizedEffect,
    receiptRootBinding(chain.risk.document),
  );
  const frozen = !authorizedEffect.success
    && donorExitCode === 3
    && authorizedEffect.terminal.document.signal === null
    && authorizedEffect.terminal.document.forced === false
    && authorizedEffect.terminal.document.timedOut === false;
  const ambiguous = !authorizedEffect.success && !frozen;
  const pre = readPrivateCanonicalJson(
    paths.evidence.preTargetReadback,
    'pre-rollback target readback',
    (document) => validateRollbackReadback(document, 'PRE', 'pre-rollback target readback'),
  );
  assert(Date.parse(pre.document.observedAtUtc)
    <= Date.parse(chain.consumption.document.consumedAtUtc),
  'pre-rollback readback must predate authorization consumption');
  const target = inspectInstalledRelease(
    resolve(args['primary-path']),
    'authorized rollback target',
  );
  assertReleaseEndpointBinding(target, chain.preview.document.action);
  const post = captureRollbackReadback({
    phase: ambiguous ? 'AMBIGUOUS' : 'POST',
    action: chain.preview.document.action,
    risk: chain.risk.document,
    targetPath: target.path,
    envPath: resolve(args['env-file']),
    systemctlPath: resolve(args.systemctl),
    curlPath: resolve(args.curl),
    clockArgs: args,
    frozen,
    terminalTestFallback:
      authorizedEffect.terminal.document.effectFinishedAtUtc,
  });
  const startedAtUtc = authorizedEffect.start.document.effectStartedAtUtc;
  const completedAtUtc = post.observedAtUtc;
  validateCompletionChronology(
    completedAtUtc,
    chain.authorization.document,
    chain.risk.document,
    chain.consumption.document,
  );
  assert(Date.parse(startedAtUtc) >= Date.parse(chain.consumption.document.consumedAtUtc)
    && Date.parse(authorizedEffect.terminal.document.effectFinishedAtUtc)
      <= Date.parse(completedAtUtc),
  'rollback effect start/completion chronology is invalid');
  if (!ambiguous) validateRollbackTransition(pre.document, post, target);
  const confirmation = captureRollbackReadback({
    phase: ambiguous ? 'AMBIGUOUS' : 'POST',
    action: chain.preview.document.action,
    risk: chain.risk.document,
    targetPath: target.path,
    envPath: resolve(args['env-file']),
    systemctlPath: resolve(args.systemctl),
    curlPath: resolve(args.curl),
    clockArgs: args,
    frozen,
    terminalTestFallback:
      authorizedEffect.terminal.document.effectFinishedAtUtc,
  });
  assert(sameRollbackLinkState(post, confirmation),
    'post-rollback release state changed before effect recording');
  assertRollbackEvidenceStable(chain, pre);
  const frozenMarker = frozen
    ? readRollbackFrozenMarker(
        readSanitizedRollbackEnv(
          resolve(args['env-file']),
          chain.preview.document.action,
        ).values,
        target,
        chain,
        completedAtUtc,
      )
    : null;
  const frozenMarkerSha256 = frozen === true
    ? sha256Bytes(canonicalJsonBytes(frozenMarker.document))
    : null;
  const effect = {
    schemaVersion: 1,
    kind: 'AUTHORIZED_ROLLBACK_EFFECT',
    status: frozen
      ? 'ROLLBACK_SWITCHED_FROZEN_PENDING_OWNER_ACTION'
      : (ambiguous
          ? 'ROLLBACK_EFFECT_AMBIGUOUS_PENDING_OWNER_ACTION'
          : 'ROLLBACK_EFFECT_RECORDED_PENDING_RECONCILIATION'),
    authorizationId: chain.authorization.document.authorizationId,
    riskVersion: chain.risk.document.riskVersion,
    serverPreviewDigest: chain.preview.document.serverPreviewDigest,
    authorizationSha256: chain.authorization.sha256,
    riskDocumentSha256: chain.risk.sha256,
    previewDocumentSha256: chain.preview.sha256,
    authorizationConsumptionSha256: chain.consumption.sha256,
    claimKey: paths.claimKey,
    from: releaseBindingFromReadback(pre.document.current),
    to: target,
    preTargetReadbackSha256: pre.sha256,
    postTargetReadbackSha256: sha256Bytes(canonicalJsonBytes(post)),
    frozenMarkerSha256,
    donorExitCode,
    startedAtUtc,
    completedAtUtc,
    effect: effectBinding,
    terminal: {
      status: authorizedEffect.terminal.document.status,
      exitCode: authorizedEffect.terminal.document.exitCode,
      signal: authorizedEffect.terminal.document.signal,
      forced: authorizedEffect.terminal.document.forced,
      timedOut: authorizedEffect.terminal.document.timedOut,
    },
  };
  validateRollbackEffectRecord(
    effect,
    chain,
    pre.document,
    post,
    target,
    { expectedEffectBinding: effectBinding },
  );
  const postEvidence = publishSinglePrivateJson(
    paths.evidence.postTargetReadback,
    post,
    'post-rollback target readback',
    { allowPortableTestFallback, rollbackPaths: paths },
  );
  assert(postEvidence.sha256 === effect.postTargetReadbackSha256,
    'published post-rollback readback digest differs from the effect');
  const authorizationEvidence = publishSinglePrivateJson(
    paths.evidence.authorization,
    chain.authorization.document,
    'rollback authorization evidence',
    { allowPortableTestFallback, rollbackPaths: paths },
  );
  assert(authorizationEvidence.sha256 === chain.authorization.sha256,
    'published rollback authorization bytes differ from the consumed authorization');
  let frozenMarkerEvidence = null;
  if (frozenMarker !== null) {
    frozenMarkerEvidence = publishSinglePrivateJson(
      resolve(paths.claimDirectory, ROLLBACK_FROZEN_MARKER_FILE),
      frozenMarker.document,
      'rollback frozen marker evidence',
      { allowPortableTestFallback, rollbackPaths: paths },
    );
    assert(frozenMarkerEvidence.sha256 === effect.frozenMarkerSha256,
      'published rollback frozen marker digest differs from the effect');
  }
  const effectEvidence = publishSinglePrivateJson(
    paths.effect,
    effect,
    'authorized rollback effect record',
    { allowPortableTestFallback, rollbackPaths: paths },
  );
  const pendingInventory = [
    ROLLBACK_EVIDENCE_FILES.preTargetReadback,
    ROLLBACK_EVIDENCE_FILES.postTargetReadback,
    ROLLBACK_EVIDENCE_FILES.authorization,
    ROLLBACK_EFFECT_FILE,
    ...(frozen ? [ROLLBACK_FROZEN_MARKER_FILE] : []),
  ];
  requireClaimInventory(paths, pendingInventory, 'pending rollback claim evidence');
  if (frozen || ambiguous) {
    const copiedMarker = frozen
      ? readPrivateCanonicalJson(
          resolve(paths.claimDirectory, ROLLBACK_FROZEN_MARKER_FILE),
          'rollback frozen marker evidence',
        )
      : null;
    const copiedEffect = readPrivateCanonicalJson(
      paths.effect,
      'authorized rollback terminal effect record',
      (document) => {
        const schema = ROLLBACK_EFFECT_SCHEMA(document);
        assert(schema.valid, `authorized rollback effect schema rejected: ${schema.error}`);
      },
    );
    const copiedPost = readPrivateCanonicalJson(
      paths.evidence.postTargetReadback,
      'terminal post-rollback target readback',
      (document) => validateRollbackReadback(
        document,
        ambiguous ? 'AMBIGUOUS' : 'POST',
        'terminal post-rollback target readback',
        { frozen, ambiguous },
      ),
    );
    const copiedAuthorization = readPrivateCanonicalJson(
      paths.evidence.authorization,
      'rollback authorization evidence',
    );
    assert((!frozen || copiedMarker.sha256 === frozenMarkerEvidence.sha256)
      && copiedEffect.sha256 === effectEvidence.sha256
      && copiedPost.sha256 === postEvidence.sha256
      && copiedAuthorization.sha256 === authorizationEvidence.sha256,
    'rollback terminal evidence changed before failed outcome publication');
    assertRollbackEvidenceStable(
      chain,
      pre,
      copiedPost,
      copiedAuthorization,
      copiedMarker,
      copiedEffect,
      frozenMarker?.source,
      authorizedEffect.start,
      authorizedEffect.terminal,
    );
    const result = {
      schemaVersion: 1,
      kind: 'AUTHORIZED_ACTION_RESULT',
      status: 'ACTION_FAILED_AFTER_EFFECT',
      actionClass: 'SERVICE_ROLLBACK',
      authorizationId: chain.authorization.document.authorizationId,
      deployedSha: ambiguous ? copiedPost.document.deployedSha : target.testedSha,
      riskVersion: chain.risk.document.riskVersion,
      serverPreviewDigest: chain.preview.document.serverPreviewDigest,
      authorizationConsumptionSha256: chain.consumption.sha256,
      completedAtUtc,
      outcome: {
        status: ambiguous
          ? 'ROLLBACK_EFFECT_AMBIGUOUS_REQUIRES_OWNER_ACTION'
          : 'ROLLBACK_SWITCHED_FROZEN_REQUIRES_OWNER_ACTION',
        primaryPath: paths.effect,
        evidenceSha256: effectEvidence.sha256,
        detail: ambiguous
          ? 'authorized rollback runner terminated; live link evidence retained; owner action required'
          : 'exact rollback target switched; post-switch gate failed; frozen owner action required',
      },
      effect: effectBinding,
    };
    const resultSchema = RESULT_SCHEMA(result);
    assert(resultSchema.valid,
      `authorized rollback failed result schema rejected: ${resultSchema.error}`);
    const resultBytes = canonicalJsonBytes(result);
    const reconciliation = {
      schemaVersion: 1,
      kind: 'AUTHORIZED_ACTION_RECONCILIATION',
      status: 'RECONCILED',
      actionClass: 'SERVICE_ROLLBACK',
      authorizationId: result.authorizationId,
      deployedSha: result.deployedSha,
      riskVersion: result.riskVersion,
      serverPreviewDigest: result.serverPreviewDigest,
      authorizationConsumptionSha256: result.authorizationConsumptionSha256,
      resultReceiptSha256: sha256Bytes(resultBytes),
      reconciledAtUtc: completedAtUtc,
      disposition: ambiguous
        ? 'ROLLBACK_EFFECT_AMBIGUOUS_REQUIRES_OWNER_ACTION'
        : 'ROLLBACK_SWITCHED_FROZEN_REQUIRES_OWNER_ACTION',
      effect: effectBinding,
    };
    const reconciliationSchema = RECONCILIATION_SCHEMA(reconciliation);
    assert(reconciliationSchema.valid,
      `authorized rollback failed reconciliation schema rejected: ${reconciliationSchema.error}`);
    publishReceiptPair({
      resultPath: targets.result,
      resultBytes,
      reconciliationPath: targets.reconciliation,
      reconciliationBytes: canonicalJsonBytes(reconciliation),
      allowPortableTestFallback,
      expectedRoot: receiptRootBinding(chain.risk.document),
    });
    return Object.freeze({
      status: ambiguous
        ? 'ROLLBACK_EFFECT_AMBIGUOUS_RECONCILED'
        : 'ROLLBACK_SWITCHED_FROZEN_RECONCILED',
      claimKey: paths.claimKey,
      effectRecordSha256: effectEvidence.sha256,
    });
  }
  return Object.freeze({
    status: 'ROLLBACK_EFFECT_RECORDED_PENDING_RECONCILIATION',
    claimKey: paths.claimKey,
    effectRecordSha256: effectEvidence.sha256,
  });
}

function recordRollbackTerminal(args) {
  const chain = readAuthorizedRollbackChain(args);
  const authorizedEffect = readAuthorizedEffectOutcome(args, chain);
  const terminal = authorizedEffect.terminal.document;
  const donorExitCode = terminal.exitCode;
  const refusalClass = terminal.status === 'AUTHORIZED_EFFECT_TERMINATED'
    ? ROLLBACK_REFUSAL_CLASSES[donorExitCode]
    : undefined;
  if (refusalClass !== undefined
      && terminal.signal === null
      && terminal.timedOut === false
      && terminal.forced === false) {
    try {
      const result = recordRollbackRefusal({
        ...args,
        'refusal-phase': 'DONOR_TERMINATED',
      });
      return Object.freeze({
        ...result,
        terminalDisposition: 'DONOR_REFUSAL',
        terminalExitCode: donorExitCode,
      });
    } catch {
      const result = recordRollbackEffect(args);
      return Object.freeze({
        ...result,
        terminalDisposition: 'AMBIGUOUS_EFFECT',
        terminalExitCode: donorExitCode,
      });
    }
  }
  const result = recordRollbackEffect(args);
  return Object.freeze({
    ...result,
    terminalDisposition: authorizedEffect.success
      ? 'COMPLETED'
      : (donorExitCode === 3
          && terminal.signal === null
          && terminal.forced === false
          && terminal.timedOut === false
          ? 'FROZEN'
          : 'AMBIGUOUS_EFFECT'),
    terminalExitCode: donorExitCode,
  });
}

function evidenceInstant(document, field, label, {
  minimum = null,
  maximum,
} = {}) {
  const value = exactUtcSeconds(document?.[field], `${label}.${field}`);
  const instant = Date.parse(value);
  assert((minimum === null || instant >= Date.parse(minimum))
    && instant <= Date.parse(maximum),
  `${label}.${field} is outside the permitted evidence chronology`);
  return value;
}

function validateRollbackFinalEvidence({
  documents,
  evidence,
  chain,
  effect,
  pre,
  post,
  recordedAtUtc,
  expectedEffectBinding,
}) {
  const {
    cloudflareBoundary,
    watchdog,
    databaseSchema,
    backup,
    recovery,
    reconciliation,
    authorization,
  } = documents;
  assert(authorization.bytes.equals(chain.authorization.bytes)
    && authorization.sha256 === chain.authorization.sha256
    && sameJson(authorization.document, chain.authorization.document),
  'rollback authorization evidence is not the exact consumed authorization');
  assert(cloudflareBoundary.document?.status === 'CLOUDFLARE_BOUNDARY_VERIFIED'
    && typeof cloudflareBoundary.document.hostname === 'string'
    && cloudflareBoundary.document.hostname.length > 0,
  'rollback Cloudflare boundary evidence is semantically invalid');
  evidenceInstant(
    cloudflareBoundary.document,
    'observedAtUtc',
    'rollback Cloudflare boundary evidence',
    { minimum: effect.completedAtUtc, maximum: recordedAtUtc },
  );
  assert(watchdog.document?.status === 'WATCHDOG_HEALTHY'
    && watchdog.document.source === 'OWNER_READBACK',
  'rollback watchdog evidence is semantically invalid');
  evidenceInstant(watchdog.document, 'observedAtUtc', 'rollback watchdog evidence', {
    minimum: effect.completedAtUtc,
    maximum: recordedAtUtc,
  });
  assert(databaseSchema.document?.status === 'SCHEMA_COMPATIBLE'
    && databaseSchema.document.toSha === effect.to.testedSha,
  'rollback database/schema evidence is semantically invalid');
  if (databaseSchema.document.observedAtUtc !== undefined) {
    evidenceInstant(
      databaseSchema.document,
      'observedAtUtc',
      'rollback database/schema evidence',
      { minimum: effect.completedAtUtc, maximum: recordedAtUtc },
    );
  }
  assert(backup.document?.kind === 'BACKUP'
    && backup.document.status === 'BACKUP_VERIFIED'
    && backup.document.sourceSha === effect.from.testedSha,
  'rollback backup evidence is semantically invalid');
  evidenceInstant(backup.document, 'recordedAtUtc', 'rollback backup evidence', {
    maximum: effect.startedAtUtc,
  });
  assert(recovery.document?.status === 'RECOVERY_READY'
    && recovery.document.source === 'CANONICAL_SUPERVISOR_READBACK',
  'rollback recovery evidence is semantically invalid');
  evidenceInstant(recovery.document, 'observedAtUtc', 'rollback recovery evidence', {
    minimum: effect.completedAtUtc,
    maximum: recordedAtUtc,
  });
  assert(reconciliation.document?.status === 'RECONCILED'
    && reconciliation.document.deployedSha === effect.to.testedSha,
  'rollback semantic reconciliation evidence is invalid');
  evidenceInstant(
    reconciliation.document,
    'observedAtUtc',
    'rollback semantic reconciliation evidence',
    { minimum: effect.completedAtUtc, maximum: recordedAtUtc },
  );
  assert(evidence.preTargetReadback.sha256 === effect.preTargetReadbackSha256
    && evidence.postTargetReadback.sha256 === effect.postTargetReadbackSha256,
  'rollback semantic readback evidence differs from the effect record');
  validateRollbackEffectRecord(
    effect,
    chain,
    pre.document,
    post.document,
    effect.to,
    { expectedEffectBinding },
  );
}

function rollbackReceiptValidatorArguments(receipt, paths, targets, inputPath) {
  const argumentsList = [
    '--input', inputPath,
    '--kind', 'ROLLBACK',
    '--evidence-root', paths.root,
    '--expected-authorization-id', receipt.authorizationId,
    '--expected-risk-version', receipt.riskVersion,
    '--expected-server-preview-digest', receipt.serverPreviewDigest,
    '--expected-authorization-sha256', receipt.authorizationSha256,
    '--expected-risk-document-sha256', receipt.riskDocumentSha256,
    '--expected-preview-document-sha256', receipt.previewDocumentSha256,
    '--expected-authorization-consumption-sha256',
    receipt.authorizationConsumptionSha256,
    '--expected-claim-key', receipt.claimKey,
    '--expected-effect-record-sha256', receipt.effectRecordSha256,
    '--expected-result-receipt', targets.result,
    '--expected-reconciliation-receipt', targets.reconciliation,
  ];
  for (const [prefix, binding] of [['from', receipt.from], ['to', receipt.to]]) {
    for (const [name, value] of [
      ['path', binding.path],
      ['release-id', binding.releaseId],
      ['sha', binding.testedSha],
      ['artifact-manifest-sha256', binding.artifactManifestSha256],
      ['tree-sha256', binding.treeSha256],
      ['identity', binding.identity],
    ]) {
      argumentsList.push(`--expected-${prefix}-${name}`, value);
    }
  }
  return argumentsList;
}

function validateRollbackReceiptCandidate(receipt, paths, targets, {
  allowPortableTestFallback = false,
} = {}) {
  const bytes = canonicalJsonBytes(receipt);
  verifyTrustedDirectoryChain(
    realpathSync('/tmp'),
    'rollback receipt validation temporary base',
  );
  const temporaryBase = canonicalDirectory(
    realpathSync('/tmp'),
    'rollback receipt validation temporary base',
  );
  const temporaryRoot = mkdtempSync(
    resolve(temporaryBase.absolute, 'i00-rollback-receipt-'),
  );
  chmodSync(temporaryRoot, 0o700);
  const temporaryIdentity = lstatSync(temporaryRoot, { bigint: true });
  assert(temporaryIdentity.isDirectory() && !temporaryIdentity.isSymbolicLink()
    && (temporaryIdentity.mode & 0o777n) === 0o700n
    && realpathSync(temporaryRoot) === temporaryRoot,
  'rollback receipt validation temporary directory is invalid');
  if (typeof process.getuid === 'function') {
    assert(temporaryIdentity.uid === BigInt(process.getuid()),
      'rollback receipt validation temporary directory owner is invalid');
  }
  const candidate = resolve(temporaryRoot, 'candidate.json');
  let reservation;
  try {
    reservation = reserveReceipt(
      candidate,
      'rollback receipt validation candidate',
      { allowPortableTestFallback },
    );
    writeReservedReceipt(reservation, bytes);
    closeReservation(reservation);
    chmodSync(candidate, 0o400);
    const before = stableRegular(
      candidate,
      'rollback receipt validation candidate',
      { maximumBytes: 4 * 1024 * 1024, requireOwner: true },
    );
    assert((before.stat.mode & 0o777n) === 0o400n && before.bytes.equals(bytes),
      'rollback receipt validation candidate differs from the canonical receipt');
    const result = spawnSync(
      process.execPath,
      [
        resolve(SCRIPT_DIR, 'validate-receipt.mjs'),
        ...rollbackReceiptValidatorArguments(receipt, paths, targets, candidate),
      ],
      {
        encoding: 'utf8',
        env: CLOSED_ENV,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
    );
    assert(!result.error && result.signal === null && result.status === 0
      && result.stderr === ''
      && result.stdout === '{"status":"RECEIPT_VALID","kind":"ROLLBACK"}\n',
    'canonical rollback receipt validator rejected the candidate');
    const after = stableRegular(
      candidate,
      'rollback receipt validation candidate readback',
      { maximumBytes: 4 * 1024 * 1024, requireOwner: true },
    );
    assert((after.stat.mode & 0o777n) === 0o400n
      && after.bytes.equals(bytes) && sameStatIdentity(after.stat, before.stat),
      'rollback receipt validation candidate changed during validation');
    return bytes;
  } finally {
    try { closeReservation(reservation); } catch {}
    const current = lstatSync(temporaryRoot, {
      bigint: true,
      throwIfNoEntry: false,
    });
    if (current !== undefined) {
      assert(current.isDirectory() && !current.isSymbolicLink()
        && sameNamedObject(current, temporaryIdentity)
        && realpathSync(temporaryRoot) === temporaryRoot
        && sameJson(readdirSync(temporaryRoot).sort(), ['candidate.json']),
      'rollback receipt validation temporary directory changed before cleanup');
      rmSync(temporaryRoot, { recursive: true, force: false });
    }
  }
}

function finalizeRollback(args) {
  const chain = readAuthorizedRollbackChain(args);
  const allowPortableTestFallback =
    chain.risk.document.provenanceMode === 'TEST_FIXTURE_INJECTED';
  const paths = rollbackClaimPaths(
    chain.preview.document.action,
    chain.preview.document,
    args['evidence-root'],
  );
  const targets = assertRollbackReceiptTargets(
    args,
    chain.risk.document,
    chain.preview.document,
    paths.claimDirectory,
  );
  requireClaimInventory(paths, [
    ...Object.values(ROLLBACK_EVIDENCE_FILES),
    ROLLBACK_EFFECT_FILE,
  ], 'final rollback claim evidence');
  const pre = readPrivateCanonicalJson(
    paths.evidence.preTargetReadback,
    'pre-rollback target readback',
    (document) => validateRollbackReadback(document, 'PRE', 'pre-rollback target readback'),
  );
  const post = readPrivateCanonicalJson(
    paths.evidence.postTargetReadback,
    'post-rollback target readback',
    (document) => validateRollbackReadback(document, 'POST', 'post-rollback target readback'),
  );
  const effect = readPrivateCanonicalJson(
    paths.effect,
    'authorized rollback effect record',
    (document) => {
      const schema = ROLLBACK_EFFECT_SCHEMA(document);
      assert(schema.valid, `authorized rollback effect schema rejected: ${schema.error}`);
    },
  );
  const authorizedEffect = readAuthorizedEffectOutcome({
    'effect-start-evidence': effect.document.effect.startEvidencePath,
    'effect-finish-evidence': effect.document.effect.terminalEvidencePath,
    'env-file': args['env-file'],
  }, chain);
  const expectedEffectBinding = authorizedEffectReceiptBinding(
    chain,
    authorizedEffect,
    receiptRootBinding(chain.risk.document),
  );
  const documents = {};
  for (const key of [
    'cloudflareBoundary',
    'watchdog',
    'databaseSchema',
    'backup',
    'recovery',
    'reconciliation',
    'authorization',
  ]) {
    documents[key] = readPrivateCanonicalJson(
      paths.evidence[key],
      `rollback ${key} evidence`,
    );
  }
  const recordedAtUtc = provenanceBoundTimestamp(
    args,
    chain.risk.document,
    'rollback finalization time',
  );
  assert(Date.parse(recordedAtUtc) >= Date.parse(effect.document.completedAtUtc),
    'rollback finalization predates the recorded effect');
  const target = inspectInstalledRelease(
    resolve(args['primary-path']),
    'authorized rollback target',
  );
  assertReleaseEndpointBinding(target, chain.preview.document.action);
  validateRollbackEffectRecord(
    effect.document,
    chain,
    pre.document,
    post.document,
    target,
    {
      expectedDonorExitCode: 0,
      expectedEffectBinding,
    },
  );
  const live = captureRollbackReadback({
    phase: 'POST',
    action: chain.preview.document.action,
    risk: chain.risk.document,
    targetPath: target.path,
    envPath: resolve(args['env-file']),
    systemctlPath: resolve(args.systemctl),
    curlPath: resolve(args.curl),
    clockArgs: args,
    requireActiveWindow: false,
  });
  assert(sameRollbackLinkState(post.document, live),
    'live rollback state differs from the recorded post-effect readback');
  const evidence = {
    preTargetReadback: pre,
    postTargetReadback: post,
    ...documents,
  };
  validateRollbackFinalEvidence({
    documents,
    evidence,
    chain,
    effect: effect.document,
    pre,
    post,
    recordedAtUtc,
    expectedEffectBinding,
  });
  const references = Object.fromEntries(
    Object.keys(ROLLBACK_EVIDENCE_FILES).map((key) => [
      key,
      {
        path: relative(paths.root, paths.evidence[key]),
        sha256: evidence[key].sha256,
      },
    ]),
  );
  const receipt = {
    schemaVersion: 2,
    kind: 'ROLLBACK',
    authorizationId: chain.authorization.document.authorizationId,
    riskVersion: chain.risk.document.riskVersion,
    serverPreviewDigest: chain.preview.document.serverPreviewDigest,
    authorizationSha256: chain.authorization.sha256,
    riskDocumentSha256: chain.risk.sha256,
    previewDocumentSha256: chain.preview.sha256,
    authorizationConsumptionSha256: chain.consumption.sha256,
    claimKey: paths.claimKey,
    effectRecordSha256: effect.sha256,
    fromSha: effect.document.from.testedSha,
    toSha: effect.document.to.testedSha,
    from: effect.document.from,
    to: effect.document.to,
    evidence: references,
    status: 'ROLLED_BACK_PROVED',
    startedAtUtc: effect.document.startedAtUtc,
    completedAtUtc: effect.document.completedAtUtc,
    recordedAtUtc,
  };
  const schema = ROLLBACK_SCHEMA(receipt);
  assert(schema.valid, `rollback receipt schema rejected: ${schema.error}`);
  const resultBytes = validateRollbackReceiptCandidate(receipt, paths, targets, {
    allowPortableTestFallback,
  });
  const resultSha256 = sha256Bytes(resultBytes);
  const reconciliation = {
    schemaVersion: 1,
    kind: 'AUTHORIZED_ACTION_RECONCILIATION',
    status: 'RECONCILED',
    actionClass: 'SERVICE_ROLLBACK',
    authorizationId: receipt.authorizationId,
    deployedSha: receipt.toSha,
    riskVersion: receipt.riskVersion,
    serverPreviewDigest: receipt.serverPreviewDigest,
    authorizationConsumptionSha256: receipt.authorizationConsumptionSha256,
    resultReceiptSha256: resultSha256,
    reconciledAtUtc: recordedAtUtc,
    disposition: 'ROLLBACK_SEMANTIC_PROOF_RECONCILED',
    effect: expectedEffectBinding,
  };
  const reconciliationSchema = RECONCILIATION_SCHEMA(reconciliation);
  assert(reconciliationSchema.valid,
    `authorized rollback reconciliation schema rejected: ${reconciliationSchema.error}`);
  assertRollbackEvidenceStable(
    chain,
    pre,
    post,
    effect,
    authorizedEffect.start,
    authorizedEffect.terminal,
    ...Object.values(documents),
  );
  requireClaimInventory(paths, [
    ...Object.values(ROLLBACK_EVIDENCE_FILES),
    ROLLBACK_EFFECT_FILE,
  ], 'stable final rollback claim evidence');
  const finalLive = captureRollbackReadback({
    phase: 'POST',
    action: chain.preview.document.action,
    risk: chain.risk.document,
    targetPath: target.path,
    envPath: resolve(args['env-file']),
    systemctlPath: resolve(args.systemctl),
    curlPath: resolve(args.curl),
    clockArgs: args,
    requireActiveWindow: false,
  });
  assert(sameRollbackLinkState(live, finalLive),
    'live rollback state changed before receipt publication');
  publishReceiptPair({
    resultPath: targets.result,
    resultBytes,
    reconciliationPath: targets.reconciliation,
    reconciliationBytes: canonicalJsonBytes(reconciliation),
    failAfterResult: args['test-fail-after-result'] === true,
    allowPortableTestFallback,
    expectedRoot: receiptRootBinding(chain.risk.document),
  });
  return Object.freeze({
    status: 'ROLLBACK_FINALIZED',
    claimKey: paths.claimKey,
    resultReceipt: targets.result,
    reconciliationReceipt: targets.reconciliation,
  });
}

const MODE_FLAGS = Object.freeze([
  'stage-rollback',
  'verify-rollback-stage',
  'record-rollback-refusal',
  'record-rollback-effect',
  'record-rollback-terminal',
  'finalize-rollback',
]);
const args = parseArgs(process.argv.slice(2), new Set([
  'simulation-clock',
  'stage-rollback',
  'verify-rollback-stage',
  'record-rollback-refusal',
  'record-rollback-effect',
  'record-rollback-terminal',
  'finalize-rollback',
  'test-fail-after-result',
]));
const allowed = new Set([
  'class', 'authorization', 'deployment-risk', 'action-preview',
  'authorization-consumption', 'result-receipt', 'reconciliation-receipt',
  'primary-path', 'evidence-file', 'source-path',
  'effect-start-evidence', 'effect-finish-evidence',
  'env-file', 'evidence-root', 'systemctl', 'curl',
  'refusal-phase',
  'simulation-clock', 'now', 'test-fail-after-result',
  ...MODE_FLAGS,
]);
for (const name of Object.keys(args)) if (!allowed.has(name)) fail(`unsupported argument --${name}`);
const selectedModes = MODE_FLAGS.filter((name) => args[name] === true);
if (selectedModes.length > 1) {
  fail('exactly one outcome mode may be selected');
}
if (args['simulation-clock'] !== true && args.now !== undefined) {
  fail('--now is accepted only with --simulation-clock');
}
if (selectedModes.length === 1) {
  const mode = selectedModes[0];
  const modeAllowed = {
    'stage-rollback': new Set([
      'stage-rollback', 'class', 'deployment-risk', 'action-preview',
      'result-receipt', 'reconciliation-receipt', 'primary-path',
      'env-file', 'evidence-root', 'simulation-clock', 'now',
    ]),
    'verify-rollback-stage': new Set([
      'verify-rollback-stage', 'class', 'authorization', 'deployment-risk',
      'action-preview', 'authorization-consumption', 'result-receipt',
      'reconciliation-receipt', 'primary-path', 'env-file', 'evidence-root',
      'simulation-clock', 'now',
    ]),
    'record-rollback-refusal': new Set([
      'record-rollback-refusal', 'class', 'authorization', 'deployment-risk',
      'action-preview', 'authorization-consumption', 'result-receipt',
      'reconciliation-receipt', 'primary-path', 'env-file', 'evidence-root',
      'systemctl', 'curl', 'refusal-phase',
      'effect-start-evidence', 'effect-finish-evidence',
      'simulation-clock', 'now',
    ]),
    'record-rollback-effect': new Set([
      'record-rollback-effect', 'class', 'authorization', 'deployment-risk',
      'action-preview', 'authorization-consumption', 'result-receipt',
      'reconciliation-receipt', 'primary-path', 'env-file', 'evidence-root',
      'systemctl', 'curl', 'effect-start-evidence', 'effect-finish-evidence',
      'simulation-clock', 'now',
    ]),
    'record-rollback-terminal': new Set([
      'record-rollback-terminal', 'class', 'authorization', 'deployment-risk',
      'action-preview', 'authorization-consumption', 'result-receipt',
      'reconciliation-receipt', 'primary-path', 'env-file', 'evidence-root',
      'systemctl', 'curl', 'effect-start-evidence', 'effect-finish-evidence',
      'simulation-clock', 'now',
    ]),
    'finalize-rollback': new Set([
      'finalize-rollback', 'class', 'authorization', 'deployment-risk',
      'action-preview', 'authorization-consumption', 'result-receipt',
      'reconciliation-receipt', 'primary-path', 'env-file', 'evidence-root',
      'systemctl', 'curl', 'simulation-clock', 'now', 'test-fail-after-result',
    ]),
  }[mode];
  for (const name of Object.keys(args)) {
    if (!modeAllowed.has(name)) fail(`--${name} is not accepted with --${mode}`);
  }
  const required = [
    'class', 'deployment-risk', 'action-preview', 'result-receipt',
    'reconciliation-receipt', 'primary-path', 'env-file', 'evidence-root',
  ];
  if (mode !== 'stage-rollback') required.push('authorization', 'authorization-consumption');
  if ([
    'record-rollback-refusal',
    'record-rollback-effect',
    'record-rollback-terminal',
    'finalize-rollback',
  ].includes(mode)) {
    required.push('systemctl', 'curl');
  }
  if (mode === 'record-rollback-refusal') {
    required.push('refusal-phase');
    if (args['refusal-phase'] === 'DONOR_TERMINATED') {
      required.push('effect-start-evidence', 'effect-finish-evidence');
    } else if (args['refusal-phase'] !== 'STAGE_VERIFY_FAILED') {
      fail('--refusal-phase must be STAGE_VERIFY_FAILED or DONOR_TERMINATED');
    } else if (
      args['effect-start-evidence'] !== undefined
      || args['effect-finish-evidence'] !== undefined
    ) {
      fail('STAGE_VERIFY_FAILED forbids effect evidence arguments');
    }
  }
  if (['record-rollback-effect', 'record-rollback-terminal'].includes(mode)) {
    required.push('effect-start-evidence', 'effect-finish-evidence');
  }
  for (const name of required) if (!args[name]) fail(`--${name} is required with --${mode}`);
  if (args.class !== 'SERVICE_ROLLBACK') {
    fail(`--${mode} requires --class SERVICE_ROLLBACK`);
  }
  if (args['test-fail-after-result'] === true && args['simulation-clock'] !== true) {
    fail('--test-fail-after-result requires test provenance');
  }
  try {
    const result = {
      'stage-rollback': stageRollback,
      'verify-rollback-stage': verifyRollbackStage,
      'record-rollback-refusal': recordRollbackRefusal,
      'record-rollback-effect': recordRollbackEffect,
      'record-rollback-terminal': recordRollbackTerminal,
      'finalize-rollback': finalizeRollback,
    }[mode](args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

for (const name of [
  'class', 'authorization', 'deployment-risk', 'action-preview',
  'authorization-consumption', 'result-receipt', 'reconciliation-receipt',
  'effect-start-evidence', 'effect-finish-evidence',
]) {
  if (!args[name]) fail(`--${name} is required`);
}
if (!CLASS_OUTCOMES[args.class]) fail('--class does not publish an authorized action outcome');
if (args.class !== 'BACKUP_CREATE' && !args['primary-path']) {
  fail('--primary-path is required');
}
if (args['test-fail-after-result'] === true && args['simulation-clock'] !== true) {
  fail('--test-fail-after-result requires test provenance');
}

try {
  const authorization = readCanonicalEvidence(
    args.authorization,
    'external authorization',
    (document) => document,
  );
  const risk = readCanonicalEvidence(
    args['deployment-risk'],
    'deployment risk version',
    validateDeploymentRiskVersion,
  );
  const preview = readCanonicalEvidence(
    args['action-preview'],
    'deployment action preview',
    (document) => validateDeploymentActionPreview(document, risk.document, risk.sha256),
  );
  requireRecorderNodeBinding(risk.document, preview.document.action);
  const consumption = readCanonicalEvidence(
    args['authorization-consumption'],
    'authorization consumption receipt',
    (document) => document,
  );
  assert(risk.document.binding.actionClass === args.class,
    'risk document does not bind the requested outcome class');
  assert(args['test-fail-after-result'] !== true
    || risk.document.provenanceMode === 'TEST_FIXTURE_INJECTED',
  'outcome publication fault injection requires test provenance');
  validateAuthorizationBinding(authorization.document, risk.document, preview.document);
  validateConsumedClaim(consumption, {
    authorization,
    risk,
    preview,
  }, authorization.document, risk.document, preview.document);
  const effect = readAuthorizedEffectOutcome(args, {
    authorization,
    risk,
    preview,
    consumption,
  });
  const completedAtUtc = provenanceBoundTimestamp(
    args,
    risk.document,
    'completion time',
    {
      terminalTestFallback: effect.terminal.document.effectFinishedAtUtc,
    },
  );
  validateCompletionChronology(
    completedAtUtc,
    authorization.document,
    risk.document,
    consumption.document,
  );
  assert(Date.parse(completedAtUtc) >= Date.parse(effect.terminal.document.effectFinishedAtUtc)
    && Date.parse(completedAtUtc)
      < Date.parse(authorization.document.expiresAtUtc) - (effect.receiptReserve * 1_000),
  'outcome publication time is outside the authorized effect receipt reserve');
  assert(preview.document.action.receiptTargets.result === resolve(args['result-receipt'])
    && preview.document.action.receiptTargets.reconciliation === resolve(args['reconciliation-receipt']),
  'outcome receipt paths differ from the consumed preview');
  const expectedReceiptRoot = receiptRootBinding(risk.document);
  const resultPath = privateReceiptTarget(
    args['result-receipt'],
    'authorized action result',
    expectedReceiptRoot,
  );
  const reconciliationPath = privateReceiptTarget(
    args['reconciliation-receipt'],
    'authorized action reconciliation',
    expectedReceiptRoot,
  );
  assert(resultPath !== reconciliationPath,
    'authorized action receipt targets must be distinct');

  const evidence = effect.success
    ? validateOutcomeEvidence(args.class, preview.document.action, args, effect)
    : Object.freeze({
        primaryPath: effect.terminal.absolute,
        evidenceSha256: effect.terminal.sha256,
      });
  for (const document of [
    authorization, risk, preview, consumption, effect.start, effect.terminal,
  ]) {
    assertStableEvidence(document, 'authorization evidence');
  }

  const classOutcome = CLASS_OUTCOMES[args.class];
  const backupOutputUnresolved = args.class === 'BACKUP_CREATE'
    && effect.success === false
    && effect.terminal.document.status === 'AUTHORIZED_EFFECT_TERMINATED'
    && effect.terminal.document.exitCode === 0
    && effect.terminal.document.signal === null
    && effect.terminal.document.forced === false
    && effect.terminal.document.timedOut === false
    && ['MISSING', 'INVALID', 'AMBIGUOUS']
      .includes(effect.terminal.document.effectOutput.status);
  const failureOutcome = backupOutputUnresolved
    ? BACKUP_OUTPUT_UNRESOLVED_OUTCOME
    : CLASS_FAILURE_OUTCOMES[args.class];
  const effectBinding = authorizedEffectReceiptBinding(
    { authorization, risk, preview, consumption },
    effect,
    expectedReceiptRoot,
  );
  const result = {
    schemaVersion: 1,
    kind: 'AUTHORIZED_ACTION_RESULT',
    status: effect.success ? 'ACTION_COMPLETED' : 'ACTION_FAILED_AFTER_EFFECT',
    actionClass: args.class,
    authorizationId: authorization.document.authorizationId,
    deployedSha: authorization.document.deployedSha,
    riskVersion: risk.document.riskVersion,
    serverPreviewDigest: preview.document.serverPreviewDigest,
    authorizationConsumptionSha256: consumption.sha256,
    completedAtUtc,
    outcome: {
      status: effect.success ? classOutcome.status : failureOutcome.status,
      primaryPath: evidence.primaryPath,
      evidenceSha256: evidence.evidenceSha256,
      detail: effect.success ? classOutcome.detail : failureOutcome.detail,
    },
    effect: effectBinding,
  };
  const resultSchema = RESULT_SCHEMA(result);
  assert(resultSchema.valid, `authorized action result schema rejected: ${resultSchema.error}`);
  const resultBytes = canonicalJsonBytes(result);
  const resultSha256 = sha256Bytes(resultBytes);

  const reconciliation = {
    schemaVersion: 1,
    kind: 'AUTHORIZED_ACTION_RECONCILIATION',
    status: 'RECONCILED',
    actionClass: args.class,
    authorizationId: authorization.document.authorizationId,
    deployedSha: authorization.document.deployedSha,
    riskVersion: risk.document.riskVersion,
    serverPreviewDigest: preview.document.serverPreviewDigest,
    authorizationConsumptionSha256: consumption.sha256,
    resultReceiptSha256: resultSha256,
    reconciledAtUtc: completedAtUtc,
    disposition: effect.success
      ? classOutcome.disposition
      : (backupOutputUnresolved
          ? BACKUP_OUTPUT_UNRESOLVED_OUTCOME.disposition
          : 'EFFECT_TERMINATED_MUTATION_POSSIBLE'),
    effect: effectBinding,
  };
  const reconciliationSchema = RECONCILIATION_SCHEMA(reconciliation);
  assert(reconciliationSchema.valid,
    `authorized action reconciliation schema rejected: ${reconciliationSchema.error}`);
  const reconciliationBytes = canonicalJsonBytes(reconciliation);
  publishReceiptPair({
    resultPath,
    resultBytes,
    reconciliationPath,
    reconciliationBytes,
    failAfterResult: args['test-fail-after-result'] === true,
    allowPortableTestFallback:
      risk.document.provenanceMode === 'TEST_FIXTURE_INJECTED',
    expectedRoot: expectedReceiptRoot,
  });
  process.stdout.write(`${JSON.stringify({
    status: effect.success
      ? 'AUTHORIZED_ACTION_OUTCOME_RECORDED'
      : 'AUTHORIZED_ACTION_FAILURE_RECORDED',
    actionClass: args.class,
    resultReceipt: resultPath,
    reconciliationReceipt: reconciliationPath,
  })}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
