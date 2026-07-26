#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  authorizedEffectEvidenceBytes,
  validateAuthorizedEffectStart,
} from '../authorized-effect-evidence.mjs';
import {
  canonicalJsonBytes,
  validateAuthorizationConsumption,
  validateDeploymentActionPreview,
  validateDeploymentRiskVersion,
} from '../deployment-authorization-contract.mjs';

const REQUESTED_ROLE = process.argv[2] === '--role' ? process.argv[3] : '';
const AUTOMATIC_ROLLBACK_ROLE = REQUESTED_ROLE === 'AUTOMATIC_ROLLBACK';
const HANDOFF_FD = AUTOMATIC_ROLLBACK_ROLE ? 36 : 3;
const ACK_FD = AUTOMATIC_ROLLBACK_ROLE ? 37 : 4;
const AUTHORIZATION_FD = 5;
const RISK_FD = 6;
const PREVIEW_FD = 7;
const CONSUMPTION_FD = 8;
const CONSUMPTION_ROOT_FD = 9;
const START_FD = 10;
const SCRIPT_FD = AUTOMATIC_ROLLBACK_ROLE ? 35 : 11;
const ENVIRONMENT_FD = 12;
const BOOTSTRAP_FD = 13;
const PROGRAM_FD = 14;
const DIRECTORY_FD = 15;
const VERIFIER_FD = 38;
const ALL_INHERITED_FDS = Object.freeze(
  Array.from({ length: 51 }, (_, index) => index + 3),
);
const FD_LOCATORS = Object.freeze({
  I00_AUTHORIZED_EFFECT_FD: '3',
  I00_AUTHORIZED_EFFECT_ACK_FD: '4',
  I00_AUTHORIZATION_FD: '5',
  I00_DEPLOYMENT_RISK_FD: '6',
  I00_ACTION_PREVIEW_FD: '7',
  I00_AUTHORIZATION_CONSUMPTION_FD: '8',
  I00_AUTHORIZATION_CONSUMPTION_ROOT_FD: '9',
  I00_AUTHORIZED_EFFECT_START_FD: '10',
  I00_AUTHORIZED_EFFECT_SCRIPT_FD: '11',
  I00_AUTHORIZED_EFFECT_ENVIRONMENT_FD: '12',
  I00_AUTHORIZED_EFFECT_BOOTSTRAP_FD: '13',
  I00_AUTHORIZED_EFFECT_PROGRAM_FD: '14',
  I00_AUTHORIZED_EFFECT_DIRECTORY_FD: '15',
});
const ROLLBACK_FD_LOCATORS = Object.freeze({
  I00_AUTHORIZED_ROLLBACK_SCRIPT_FD: '35',
  I00_AUTHORIZED_ROLLBACK_HANDOFF_FD: '36',
  I00_AUTHORIZED_ROLLBACK_ACK_FD: '37',
});
const MAX_HANDOFF_BYTES = 65_536;
const MAX_BOUND_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_PROC_BYTES = 1024 * 1024;
const MAX_ANCESTRY_HOPS = 8;
const DIGEST = /^[0-9a-f]{64}$/u;
const ENDPOINT_IDENTITY =
  /^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,size=[0-9]+,mtimeNs=-?[0-9]+,ctimeNs=-?[0-9]+$/u;
const EXACT_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const RISK_VERSION = /^i00-deployment-risk-v1:sha256:[0-9a-f]{64}$/u;
const PREVIEW_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ACTION_CLASSES = new Set([
  'OPS_BUNDLE_INSTALL',
  'SERVICE_RELEASE_SWITCH',
  'SERVICE_ROLLBACK',
  'BACKUP_CREATE',
  'ISOLATED_RESTORE',
  'SECRET_MATERIALIZATION',
]);
const CLASS_WRITE_ROOTS = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze([['destinationParent', 40]]),
  SERVICE_RELEASE_SWITCH: Object.freeze([
    ['cosmosRoot', 41], ['releasesDir', 42], ['currentLinkParent', 43],
    ['previousLinkParent', 44], ['opsStateDir', 45],
    ['rollbackEvidenceRoot', 48], ['dataDir', 49],
  ]),
  SERVICE_ROLLBACK: Object.freeze([
    ['cosmosRoot', 41], ['releasesDir', 42], ['currentLinkParent', 43],
    ['previousLinkParent', 44], ['opsStateDir', 45],
    ['rollbackEvidenceRoot', 48], ['dataDir', 49],
  ]),
  BACKUP_CREATE: Object.freeze([
    ['opsStateDir', 45], ['backupDir', 46],
  ]),
  ISOLATED_RESTORE: Object.freeze([
    ['isolatedTargetParent', 47],
  ]),
  SECRET_MATERIALIZATION: Object.freeze([]),
});
const CLASS_READ_ROOTS = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze([['releaseSource', 51]]),
  SERVICE_RELEASE_SWITCH: Object.freeze([['releaseSource', 51]]),
  SERVICE_ROLLBACK: Object.freeze([['releaseSource', 51]]),
  BACKUP_CREATE: Object.freeze([['dataDir', 49]]),
  ISOLATED_RESTORE: Object.freeze([['backupSource', 50]]),
  SECRET_MATERIALIZATION: Object.freeze([]),
});
const AUTOMATIC_READ_ROOTS = Object.freeze([['automaticRollbackSource', 52]]);
const CLASS_OBSERVED_ROOTS = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze([]),
  SERVICE_RELEASE_SWITCH: Object.freeze([]),
  SERVICE_ROLLBACK: Object.freeze([]),
  BACKUP_CREATE: Object.freeze([]),
  ISOLATED_RESTORE: Object.freeze(['dataDir', 'backupDir']),
  SECRET_MATERIALIZATION: Object.freeze([]),
});
const EXECUTABLE_ENDPOINT_PREFIXES = Object.freeze({
  aws: 'aws-cli',
  exposure: 'exposure-helper',
  alert: 'alert-helper',
});
const HANDOFF_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'status',
  'handoffNonce',
  'actionClass',
  'authorizationId',
  'claimKey',
  'consumptionSha256',
  'riskVersion',
  'serverPreviewDigest',
  'authorizationExpiresAtUtc',
  'evidenceValidUntilUtc',
  'receiptPublicationReserveSeconds',
  'effectUid',
  'effectGid',
  'program',
  'verifier',
  'delegatedScript',
  'delegatedBootstrap',
  'delegatedEnvironment',
  'effectExecutables',
  'delegatedArgv',
  'effectDirectory',
  'helperPolicy',
  'automaticRollback',
  'writeRoots',
  'readRoots',
  'observedRoots',
  'effectOutput',
  'authorizationChain',
  'startEvidencePath',
  'startEvidenceSha256',
  'effectStartedAtUtc',
  'runner',
]);
const AUTOMATIC_HANDOFF_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'status',
  'handoffNonce',
  'primaryHandoffNonce',
  'actionClass',
  'authorizationId',
  'claimKey',
  'consumptionSha256',
  'riskVersion',
  'serverPreviewDigest',
  'authorizationExpiresAtUtc',
  'evidenceValidUntilUtc',
  'receiptPublicationReserveSeconds',
  'effectUid',
  'effectGid',
  'recovery',
  'program',
  'verifier',
  'delegatedScript',
  'delegatedBootstrap',
  'delegatedEnvironment',
  'effectExecutables',
  'delegatedArgv',
  'effectDirectory',
  'helperPolicy',
  'writeRoots',
  'readRoots',
  'observedRoots',
  // Required by validateCommonHandoff's non-BACKUP_CREATE branch, which
  // requires one exact empty effectOutput object. HANDOFF_KEYS already carries
  // this field; without it no automatic rollback document can pass both gates.
  'effectOutput',
  'authorizationChain',
  'startEvidencePath',
  'startEvidenceSha256',
  'effectStartedAtUtc',
  'runner',
]);
const PROGRAM_KEYS = Object.freeze(['path', 'sha256', 'identity']);
const RUNNER_KEYS = Object.freeze(['pid', 'node', 'source']);
const CHAIN_KEYS = Object.freeze([
  'authorization',
  'deploymentRisk',
  'actionPreview',
  'authorizationConsumption',
  'consumptionRoot',
]);
const ROOT_KEYS = Object.freeze(['path', 'identity']);
const DIRECTORY_IDENTITY =
  /^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,uid=[0-9]+,gid=[0-9]+$/u;
const VERIFIER_SOURCE = realpathSync(fileURLToPath(import.meta.url));
const I00_ROOT = resolve(dirname(VERIFIER_SOURCE), '..');
const L15_CONTRACT = resolve(I00_ROOT, 'l15-amendment-contract.json');
const REQUIRED_RUNNER_OPTIONS = Object.freeze([
  '--authorization',
  '--deployment-risk',
  '--action-preview',
  '--authorization-consumption',
]);
const START_COMMON_FIELDS = Object.freeze([
  'actionClass',
  'authorizationId',
  'claimKey',
  'consumptionSha256',
  'riskVersion',
  'serverPreviewDigest',
  'effectUid',
  'effectGid',
  'program',
  'verifier',
  'delegatedScript',
  'delegatedBootstrap',
  'delegatedEnvironment',
  'effectExecutables',
  'delegatedArgv',
  'effectDirectory',
  'helperPolicy',
  'automaticRollback',
  'writeRoots',
  'readRoots',
  'observedRoots',
  'authorizationExpiresAtUtc',
  'evidenceValidUntilUtc',
  'receiptPublicationReserveSeconds',
  'startEvidencePath',
  'effectStartedAtUtc',
]);

class HandoffBlocked extends Error {}

function assert(condition, message) {
  if (!condition) throw new HandoffBlocked(message);
}

function isPlainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requireExactKeys(value, keys, label) {
  assert(isPlainRecord(value), `${label} must be one plain object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length
    && actual.every((key, index) => key === expected[index]),
  `${label} has an unexpected field set`);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  assert(value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value)),
  'handoff canonical JSON contains an unsupported value');
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalValue(value), null, 2)}\n`, 'utf8');
}

function sameStat(left, right) {
  return [
    'dev',
    'ino',
    'mode',
    'nlink',
    'uid',
    'gid',
    'size',
    'mtimeNs',
    'ctimeNs',
  ].every((field) => left[field] === right[field]);
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

function exactText(value, label, { allowEmpty = false, maximum = 2_048 } = {}) {
  assert(typeof value === 'string'
    && value.length <= maximum
    && (allowEmpty || value.length > 0)
    && !/[\u0000-\u001f\u007f]/u.test(value),
  `${label} must be exact bounded text`);
  return value;
}

function canonicalAbsolute(value, label) {
  exactText(value, label, { maximum: 4_096 });
  assert(isAbsolute(value) && resolve(value) === value,
    `${label} must be one canonical absolute path`);
  return value;
}

function exactUtc(value, label) {
  assert(typeof value === 'string' && EXACT_UTC_SECONDS.test(value),
    `${label} must use exact UTC seconds`);
  const milliseconds = Date.parse(value);
  assert(Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString().replace('.000Z', 'Z') === value,
  `${label} is invalid`);
  return milliseconds;
}

function canonicalNumericString(value, label) {
  assert(typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value),
    `${label} must be one canonical numeric identifier`);
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number >= 0 && number <= 0xffff_ffff,
    `${label} is outside the supported identifier range`);
  return number;
}

function descriptorInfo(descriptor, label) {
  let text;
  try {
    text = readFileSync(`/proc/self/fdinfo/${descriptor}`, 'utf8');
  } catch {
    throw new HandoffBlocked(`${label} descriptor flags are unavailable`);
  }
  const matches = [...text.matchAll(/^flags:\s+([0-7]+)$/gmu)];
  assert(matches.length === 1, `${label} descriptor flags are invalid`);
  return Object.freeze({
    flags: BigInt(`0o${matches[0][1]}`),
  });
}

function positionalRead(descriptor, size, label) {
  assert(Number.isSafeInteger(size) && size >= 0, `${label} size is invalid`);
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    assert(count > 0, `${label} ended before its retained size`);
    offset += count;
  }
  const extra = Buffer.alloc(1);
  assert(readSync(descriptor, extra, 0, 1, size) === 0,
    `${label} exceeds its retained size`);
  return bytes;
}

function hashDescriptor(descriptor, size, label) {
  assert(size > 0n && size <= BigInt(MAX_BOUND_FILE_BYTES),
    `${label} size is outside the supported range`);
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  const numericSize = Number(size);
  assert(Number.isSafeInteger(numericSize), `${label} size is not safely readable`);
  let offset = 0;
  while (offset < numericSize) {
    const wanted = Math.min(buffer.length, numericSize - offset);
    const count = readSync(descriptor, buffer, 0, wanted, offset);
    assert(count > 0, `${label} ended before its retained size`);
    hash.update(buffer.subarray(0, count));
    offset += count;
  }
  return hash.digest('hex');
}

function verifyTrustedAncestorChain(path, label) {
  const invokingUid = typeof process.geteuid === 'function'
    ? BigInt(process.geteuid()) : null;
  let cursor = dirname(path);
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true, throwIfNoEntry: false });
    assert(stat?.isDirectory() && !stat.isSymbolicLink()
      && realpathSync(cursor) === cursor,
    `${label} ancestor chain is not canonical`);
    const mode = stat.mode & 0o7777n;
    assert(invokingUid === null || stat.uid === 0n || stat.uid === invokingUid,
      `${label} ancestor owner is untrusted`);
    if ((mode & 0o022n) !== 0n) {
      assert(stat.uid === 0n && (mode & 0o1000n) !== 0n,
        `${label} ancestor chain contains an unsafe writable directory`);
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function validateFileBinding(value, label) {
  requireExactKeys(value, PROGRAM_KEYS, label);
  canonicalAbsolute(value.path, `${label}.path`);
  assert(DIGEST.test(value.sha256), `${label}.sha256 is invalid`);
  assert(typeof value.identity === 'string' && ENDPOINT_IDENTITY.test(value.identity),
    `${label}.identity is invalid`);
  return value;
}

function stableNamedBinding(binding, label, { executable = false } = {}) {
  verifyTrustedAncestorChain(binding.path, label);
  const namedBefore = lstatSync(binding.path, { bigint: true, throwIfNoEntry: false });
  assert(namedBefore?.isFile() && !namedBefore.isSymbolicLink()
    && namedBefore.nlink === 1n && realpathSync(binding.path) === binding.path,
  `${label} is not one canonical regular file`);
  const mode = namedBefore.mode & 0o7777n;
  assert((mode & 0o022n) === 0n && (mode & 0o7000n) === 0n
    && (!executable || (mode & 0o111n) !== 0n),
  `${label} mode is unsafe`);
  const invokingUid = typeof process.geteuid === 'function'
    ? BigInt(process.geteuid()) : null;
  assert(invokingUid === null || namedBefore.uid === 0n || namedBefore.uid === invokingUid,
    `${label} owner is untrusted`);
  let descriptor;
  try {
    descriptor = openSync(
      binding.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    assert(sameStat(namedBefore, openedBefore), `${label} changed before hashing`);
    const sha256 = hashDescriptor(descriptor, openedBefore.size, label);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(binding.path, { bigint: true, throwIfNoEntry: false });
    assert(namedAfter !== undefined
      && sameStat(openedBefore, openedAfter)
      && sameStat(openedAfter, namedAfter)
      && realpathSync(binding.path) === binding.path,
    `${label} changed while hashing`);
    verifyTrustedAncestorChain(binding.path, label);
    assert(sha256 === binding.sha256
      && endpointIdentity(openedAfter) === binding.identity,
    `${label} differs from its retained binding`);
    return Object.freeze({ stat: openedAfter, sha256 });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function stablePrivateEvidence(path, expectedUid, label) {
  canonicalAbsolute(path, `${label} path`);
  verifyTrustedAncestorChain(path, label);
  const namedBefore = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  assert(namedBefore?.isFile() && !namedBefore.isSymbolicLink()
    && namedBefore.nlink === 1n && (namedBefore.mode & 0o7777n) === 0o600n
    && namedBefore.uid === BigInt(expectedUid) && realpathSync(path) === path,
  `${label} is not one private owner-bound file`);
  assert(namedBefore.size > 0n && namedBefore.size <= BigInt(MAX_HANDOFF_BYTES),
    `${label} size is outside the supported range`);
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const openedBefore = fstatSync(descriptor, { bigint: true });
    assert(sameStat(namedBefore, openedBefore), `${label} changed before read`);
    const bytes = positionalRead(descriptor, Number(openedBefore.size), label);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    assert(namedAfter !== undefined
      && sameStat(openedBefore, openedAfter)
      && sameStat(openedAfter, namedAfter)
      && realpathSync(path) === path,
    `${label} changed during read`);
    verifyTrustedAncestorChain(path, label);
    return Object.freeze({ bytes, stat: openedAfter });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readProcBytes(path, label) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new HandoffBlocked(`${label} is unavailable`);
  }
  assert(bytes.length > 0 && bytes.length <= MAX_PROC_BYTES,
    `${label} size is outside the supported range`);
  return bytes;
}

function exactUtf8(bytes, label) {
  const text = bytes.toString('utf8');
  assert(Buffer.from(text, 'utf8').equals(bytes), `${label} is not exact UTF-8`);
  return text;
}

function readProcessStat(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0, 'process identifier is invalid');
  const text = exactUtf8(readProcBytes(`/proc/${pid}/stat`, 'process stat'), 'process stat');
  assert(!text.includes('\0') && text.endsWith('\n'),
    'process stat is not canonical proc text');
  const prefix = `${pid} (`;
  const boundary = text.lastIndexOf(') ');
  assert(text.startsWith(prefix) && boundary >= prefix.length,
    'process stat identity is invalid');
  const fields = text.slice(boundary + 2).trimEnd().split(' ');
  assert(fields.length >= 20
    && /^[A-Z]$/u.test(fields[0])
    && /^(?:0|[1-9][0-9]*)$/u.test(fields[1])
    && /^(?:0|[1-9][0-9]*)$/u.test(fields[19]),
  'process stat fields are invalid');
  const ppid = Number(fields[1]);
  assert(Number.isSafeInteger(ppid), 'process parent identifier is invalid');
  assert(!['X', 'Z'].includes(fields[0]), 'process is not live');
  return Object.freeze({
    pid,
    ppid,
    state: fields[0],
    starttime: fields[19],
  });
}

function sameProcess(left, right) {
  return left.pid === right.pid
    && left.ppid === right.ppid
    && left.starttime === right.starttime;
}

function readProcessCredentials(pid) {
  const text = exactUtf8(
    readProcBytes(`/proc/${pid}/status`, 'process credentials'),
    'process credentials',
  );
  const uid = [...text.matchAll(/^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)$/gmu)];
  const gid = [...text.matchAll(/^Gid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)$/gmu)];
  assert(uid.length === 1 && gid.length === 1,
    'process credentials are invalid');
  return Object.freeze({
    euid: canonicalNumericString(uid[0][2], 'process effective uid'),
    egid: canonicalNumericString(gid[0][2], 'process effective gid'),
  });
}

function exactProcessArgv(pid) {
  const bytes = readProcBytes(`/proc/${pid}/cmdline`, 'process command line');
  assert(bytes[bytes.length - 1] === 0, 'process command line is not NUL terminated');
  const entries = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    const part = bytes.subarray(start, index);
    const value = part.toString('utf8');
    assert(Buffer.from(value, 'utf8').equals(part),
      'process command line contains invalid UTF-8');
    entries.push(value);
    start = index + 1;
  }
  assert(entries.length > 0, 'process command line is empty');
  return Object.freeze(entries);
}

function verifyProcExecutable(pid, binding, label) {
  const processBefore = readProcessStat(pid);
  let descriptor;
  try {
    descriptor = openSync(`/proc/${pid}/exe`, constants.O_RDONLY);
    const openedBefore = fstatSync(descriptor, { bigint: true });
    assert(openedBefore.isFile() && openedBefore.size > 0n
      && openedBefore.size <= BigInt(MAX_BOUND_FILE_BYTES),
    `${label} executable is invalid`);
    const path = realpathSync(`/proc/${pid}/exe`);
    assert(path === binding.path, `${label} executable path differs from its binding`);
    const sha256 = hashDescriptor(descriptor, openedBefore.size, `${label} executable`);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    assert(sameStat(openedBefore, openedAfter)
      && sha256 === binding.sha256
      && endpointIdentity(openedAfter) === binding.identity,
    `${label} executable differs from its binding`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const named = stableNamedBinding(binding, `${label} bound file`, { executable: true });
  const processAfter = readProcessStat(pid);
  assert(sameProcess(processBefore, processAfter)
    && endpointIdentity(named.stat) === binding.identity,
  `${label} process identity changed during verification`);
  return Object.freeze({
    process: processAfter,
    argv: exactProcessArgv(pid),
  });
}

function captureAncestry(runnerPid) {
  const self = readProcessStat(process.pid);
  const chain = [];
  const seen = new Set([process.pid]);
  let cursor = self.ppid;
  for (let hops = 1; hops <= MAX_ANCESTRY_HOPS; hops += 1) {
    assert(cursor > 0 && !seen.has(cursor), 'effect ancestry is invalid');
    seen.add(cursor);
    const snapshot = readProcessStat(cursor);
    chain.push(snapshot);
    if (cursor === runnerPid) {
      return Object.freeze({ self, chain: Object.freeze(chain) });
    }
    cursor = snapshot.ppid;
  }
  throw new HandoffBlocked('effect runner is absent from the bounded ancestry');
}

function recheckAncestry(ancestry) {
  const self = readProcessStat(process.pid);
  assert(sameProcess(ancestry.self, self), 'verifier process identity changed');
  for (const expected of ancestry.chain) {
    assert(sameProcess(expected, readProcessStat(expected.pid)),
      'effect ancestry changed during verification');
  }
}

function parseHandoff(bytes, keys = HANDOFF_KEYS, label = 'authorized effect handoff') {
  const text = exactUtf8(bytes, label);
  assert(!text.includes('\r') && !text.includes('\0'),
    'authorized effect handoff is not canonical text');
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new HandoffBlocked('authorized effect handoff is not valid JSON');
  }
  requireExactKeys(document, keys, label);
  assert(bytes.equals(canonicalBytes(document)),
    'authorized effect handoff is not canonical JSON');
  return document;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function endpoint(action, prefix) {
  const marker = `${prefix}:`;
  const values = action.allowedEndpoints
    .filter((value) => value.startsWith(marker))
    .map((value) => value.slice(marker.length));
  assert(values.length === 1, `authorization action lacks one exact ${prefix}`);
  return values[0];
}

function assertBindingMatchesEndpoints(binding, action, prefix, label) {
  assert(binding.path === endpoint(action, `${prefix}-path`)
    && binding.sha256 === endpoint(action, `${prefix}-sha256`)
    && binding.identity === endpoint(action, `${prefix}-identity`),
  `${label} differs from the preview binding`);
}

function writeRootEndpointPrefix(name) {
  return {
    destinationParent: 'destination-parent',
    cosmosRoot: 'cosmos-root',
    releasesDir: 'releases-dir',
    currentLinkParent: 'current-link-parent',
    previousLinkParent: 'previous-link-parent',
    opsStateDir: 'ops-state-dir',
    backupDir: 'backup-dir',
    isolatedTargetParent: 'isolated-target-parent',
    rollbackEvidenceRoot: 'rollback-evidence-root',
    dataDir: 'data-dir',
  }[name];
}

function endpointPathForDirectoryPrefix(action, prefix) {
  if (['backup-dir', 'rollback-evidence-root'].includes(prefix)) {
    return endpoint(action, prefix);
  }
  if (prefix === 'data-dir') return endpoint(action, 'data-dir-path');
  return endpoint(action, `${prefix}-path`);
}

function readRootEndpointPrefix(name) {
  return {
    dataDir: 'data-dir',
    backupSource: 'backup',
    releaseSource: 'release',
    automaticRollbackSource: 'current-release',
  }[name];
}

function assertReadRootMatchesRisk(root, action) {
  const prefix = readRootEndpointPrefix(root.name);
  assert(prefix !== undefined, `${root.name} read root has no endpoint policy`);
  const expectedPath = prefix === 'data-dir'
    ? endpoint(action, 'data-dir-path')
    : endpoint(action, `${prefix}-path`);
  const expectedTree = root.name === 'dataDir'
    ? null
    : endpoint(action, `${prefix}-tree-sha256`);
  assert(root.path === expectedPath
    && root.identity === endpoint(action, `${prefix}-identity`)
    && root.treeSha256 === expectedTree,
  `${root.name} read root differs from the preview`);
}

function directoryIdentity(stat) {
  return [
    `device=${stat.dev}`,
    `inode=${stat.ino}`,
    `mode=${stat.mode.toString(8)}`,
    `uid=${stat.uid}`,
    `gid=${stat.gid}`,
  ].join(',');
}

function readCanonicalDescriptor(descriptor, binding, label, maximum = MAX_HANDOFF_BYTES) {
  validateFileBinding(binding, `${label} binding`);
  const stat = fstatSync(descriptor, { bigint: true });
  assert(stat.isFile() && stat.nlink === 1n
    && stat.size > 0n && stat.size <= BigInt(maximum)
    && (descriptorInfo(descriptor, label).flags & 0o3n) === 0n
    && endpointIdentity(stat) === binding.identity,
  `${label} inherited descriptor identity is invalid`);
  const bytes = positionalRead(descriptor, Number(stat.size), label);
  assert(createHash('sha256').update(bytes).digest('hex') === binding.sha256,
    `${label} inherited descriptor digest differs from the handoff`);
  let document;
  try {
    document = JSON.parse(exactUtf8(bytes, label));
  } catch {
    throw new HandoffBlocked(`${label} inherited descriptor is not valid JSON`);
  }
  assert(bytes.equals(canonicalJsonBytes(document)), `${label} is not canonical JSON`);
  return Object.freeze({ bytes, document, stat });
}

function validateExternalAuthorization(authorization, risk, preview) {
  const action = risk.action;
  const binding = risk.binding;
  const window = risk.authorizationWindow;
  assert(authorization.schemaVersion === 2 && authorization.status === 'APPROVED',
    'external authorization is not approved');
  assert(sameJson(authorization.actionClasses, [binding.actionClass])
    && sameJson(authorization.allowedCommands, [action.command])
    && sameJson(authorization.allowedEndpoints, action.allowedEndpoints)
    && sameJson(authorization.allowedProducts, action.allowedProducts)
    && sameJson(authorization.allowedCredentials, action.allowedCredentials)
    && sameJson(authorization.preconditions, action.preconditions)
    && sameJson(authorization.maximumEffect, action.maximumEffect)
    && sameJson(authorization.receiptTargets, action.receiptTargets),
  'external authorization action differs from the canonical preview');
  for (const [key, expected] of [
    ['authorizationId', binding.authorizationId],
    ['operator', binding.operator],
    ['scope', action.scope],
    ['deployedSha', binding.deployedSha],
    ['configVersion', binding.configVersion],
    ['riskVersion', risk.riskVersion],
    ['nonce', binding.nonce],
    ['serverPreviewDigest', preview.serverPreviewDigest],
    ['account', binding.account],
    ['environment', binding.environment],
    ['host', binding.host],
    ['issuedAtUtc', window.issuedAtUtc],
    ['startsAtUtc', window.startsAtUtc],
    ['expiresAtUtc', window.expiresAtUtc],
    ['rollback', action.rollback],
    ['recovery', action.recovery],
  ]) {
    assert(sameJson(authorization[key], expected),
      `external authorization ${key} differs from the risk`);
  }
  return authorization;
}

function validateTypedBinding(value, kinds, label) {
  requireExactKeys(value, ['kind', 'binding'], label);
  assert(kinds.includes(value.kind), `${label} kind is invalid`);
  validateFileBinding(value.binding, `${label} binding`);
}

function validateEffectExecutables(document) {
  assert(Array.isArray(document.effectExecutables)
    && document.effectExecutables.length > 0
    && document.effectExecutables.length <= 20,
  'authorized effect executable capabilities are invalid');
  let priorFd = 15;
  const executableNames = new Set();
  for (const capability of document.effectExecutables) {
    requireExactKeys(capability, ['name', 'fd', 'binding'], 'effect executable capability');
    assert(/^[a-z][a-z0-9-]{0,31}$/u.test(capability.name)
      && !executableNames.has(capability.name)
      && Number.isSafeInteger(capability.fd)
      && capability.fd > priorFd
      && capability.fd >= 16
      && capability.fd <= 39
      && ![35, 36, 37, 38].includes(capability.fd),
    'effect executable capability name or descriptor is invalid');
    executableNames.add(capability.name);
    priorFd = capability.fd;
    validateFileBinding(capability.binding, `${capability.name} executable capability`);
  }
  const expected = {
    OPS_BUNDLE_INSTALL: [
      ['node', 16], ['bash', 17], ['mkdir', 27], ['cp', 28],
      ['chmod', 29], ['mv', 30], ['rm', 31],
    ],
    SERVICE_RELEASE_SWITCH: [
      ['node', 16], ['bash', 17], ['env', 18], ['systemctl', 19],
      ['curl', 20], ['sqlite', 21], ['exposure', 33], ['alert', 34],
    ],
    SERVICE_ROLLBACK: [
      ['node', 16], ['bash', 17], ['env', 18], ['systemctl', 19],
      ['curl', 20], ['exposure', 33], ['alert', 34],
    ],
    BACKUP_CREATE: [
      ['node', 16], ['bash', 17], ['env', 18], ['sqlite', 21], ['tar', 22],
      ['hash', 23], ['id', 24], ['getent', 25], ['setpriv', 26], ['gzip', 39],
    ],
    ISOLATED_RESTORE: [
      ['node', 16], ['bash', 17], ['env', 18], ['sqlite', 21], ['tar', 22],
      ['hash', 23], ['id', 24], ['getent', 25], ['setpriv', 26], ['gzip', 39],
    ],
    SECRET_MATERIALIZATION: [['aws', 32]],
  }[document.actionClass];
  assert(sameJson(
    document.effectExecutables.map(({ name, fd }) => [name, fd]),
    expected,
  ), 'effect executable capabilities differ from the exact class map');
}

function validateHelperPolicy(document) {
  if (!['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK'].includes(document.actionClass)) {
    assert(document.helperPolicy === 'NONE', 'helper policy differs from the class');
    return;
  }
  requireExactKeys(document.helperPolicy, ['exposure', 'alert'], 'helper policy');
  requireExactKeys(
    document.helperPolicy.exposure,
    ['program', 'script', 'argvShape', 'timeoutMs'],
    'exposure helper policy',
  );
  requireExactKeys(
    document.helperPolicy.alert,
    ['program', 'script', 'argvShape', 'timeoutMs'],
    'alert helper policy',
  );
  assert(sameJson(document.helperPolicy, {
    exposure: {
      program: 'node', script: 'exposure', argvShape: 'NO_ARGS', timeoutMs: 3_000,
    },
    alert: {
      program: 'bash', script: 'alert',
      argvShape: 'SEVERITY_CODE_MESSAGE', timeoutMs: 5_000,
    },
  }), 'helper policy differs from the fixed release policy');
}

function validateAutomaticRollbackPlan(document) {
  assert(isPlainRecord(document.automaticRollback),
    'automatic rollback plan must be one object');
  const absent = Object.keys(document.automaticRollback).length === 0;
  if (document.actionClass !== 'SERVICE_RELEASE_SWITCH' || absent) {
    assert(absent,
      'automatic rollback plan differs from the class');
    return;
  }
  requireExactKeys(document.automaticRollback, [
    'status', 'handoffNonce', 'script', 'delegatedArgv', 'recovery',
    'scriptFd', 'handoffFd', 'acknowledgementFd',
  ], 'automatic rollback plan');
  assert(document.automaticRollback.status === 'ARMED'
    && DIGEST.test(document.automaticRollback.handoffNonce)
    && document.automaticRollback.scriptFd === 35
    && document.automaticRollback.handoffFd === 36
    && document.automaticRollback.acknowledgementFd === 37,
  'automatic rollback plan constants are invalid');
  validateFileBinding(document.automaticRollback.script, 'automatic rollback script');
  assert(Array.isArray(document.automaticRollback.delegatedArgv)
    && document.automaticRollback.delegatedArgv.length > 0
    && document.automaticRollback.delegatedArgv.length <= 16,
  'automatic rollback argv is invalid');
  exactText(document.automaticRollback.recovery, 'automatic rollback recovery');
}

function validateWriteRoots(document) {
  assert(Array.isArray(document.writeRoots)
    && document.writeRoots.length <= 10,
  'write root capabilities are invalid');
  let priorFd = 39;
  const names = new Set();
  for (const root of document.writeRoots) {
    requireExactKeys(root, ['name', 'fd', 'path', 'identity'], 'write root capability');
    assert(/^[a-z][A-Za-z0-9]{0,31}$/u.test(root.name)
      && !names.has(root.name)
      && Number.isSafeInteger(root.fd)
      && root.fd > priorFd && root.fd >= 40 && root.fd <= 49,
    'write root capability name or descriptor is invalid');
    names.add(root.name);
    priorFd = root.fd;
    canonicalAbsolute(root.path, `${root.name} write root path`);
    assert(DIRECTORY_IDENTITY.test(root.identity),
      `${root.name} write root identity is invalid`);
  }
  const actual = document.writeRoots.map(({ name, fd }) => [name, fd]);
  const expected = CLASS_WRITE_ROOTS[document.actionClass];
  const firstHostExpected = document.actionClass === 'SERVICE_RELEASE_SWITCH'
    ? expected.filter(([name]) => name !== 'rollbackEvidenceRoot')
    : null;
  assert(sameJson(actual, expected)
    || (firstHostExpected !== null && sameJson(actual, firstHostExpected)),
  'write root capabilities differ from the exact class map');
}

function validateReadRoots(document) {
  assert(Array.isArray(document.readRoots)
    && document.readRoots.length <= 4,
  'read root capabilities are invalid');
  let priorFd = 39;
  const names = new Set();
  for (const root of document.readRoots) {
    requireExactKeys(
      root,
      ['name', 'fd', 'path', 'identity', 'treeSha256'],
      'read root capability',
    );
    assert(/^[a-z][A-Za-z0-9]{0,31}$/u.test(root.name)
      && !names.has(root.name)
      && Number.isSafeInteger(root.fd)
      && root.fd > priorFd && root.fd >= 40 && root.fd <= 52,
    'read root capability name or descriptor is invalid');
    names.add(root.name);
    priorFd = root.fd;
    canonicalAbsolute(root.path, `${root.name} read root path`);
    assert(DIRECTORY_IDENTITY.test(root.identity) || ENDPOINT_IDENTITY.test(root.identity),
      `${root.name} read root identity is invalid`);
    assert((root.name === 'dataDir' && root.treeSha256 === null)
      || (root.name !== 'dataDir' && DIGEST.test(root.treeSha256)),
    `${root.name} read root tree binding is invalid`);
  }
  const expected = document.kind === 'AUTHORIZED_AUTOMATIC_ROLLBACK_HANDOFF'
    ? AUTOMATIC_READ_ROOTS
    : CLASS_READ_ROOTS[document.actionClass];
  assert(sameJson(
    document.readRoots.map(({ name, fd }) => [name, fd]),
    expected,
  ), 'read root capabilities differ from the exact role map');
}

function validateObservedRoots(document) {
  assert(Array.isArray(document.observedRoots)
    && document.observedRoots.length <= 2,
  'observed root bindings are invalid');
  const expectedNames = CLASS_OBSERVED_ROOTS[document.actionClass];
  const allowedNames = new Set(expectedNames);
  const names = new Set();
  for (const root of document.observedRoots) {
    requireExactKeys(root, ['name', 'path', 'identity'], 'observed root binding');
    assert(allowedNames.has(root.name) && !names.has(root.name),
      'observed root name is invalid');
    names.add(root.name);
    canonicalAbsolute(root.path, `${root.name} observed root path`);
    assert(DIRECTORY_IDENTITY.test(root.identity),
      `${root.name} observed root identity is invalid`);
  }
  assert(sameJson(
    document.observedRoots.map(({ name }) => name),
    expectedNames,
  ), 'observed roots differ from the exact class map');
}

function validateCommonHandoff(document) {
  assert(document.schemaVersion === 1
    && DIGEST.test(document.handoffNonce)
    && ACTION_CLASSES.has(document.actionClass)
    && DIGEST.test(document.claimKey)
    && DIGEST.test(document.consumptionSha256)
    && RISK_VERSION.test(document.riskVersion)
    && PREVIEW_DIGEST.test(document.serverPreviewDigest),
  'authorized effect handoff constants are invalid');
  exactText(document.authorizationId, 'authorization identifier');
  exactUtc(document.authorizationExpiresAtUtc, 'authorization expiry');
  exactUtc(document.evidenceValidUntilUtc, 'evidence horizon');
  assert(Number.isSafeInteger(document.receiptPublicationReserveSeconds)
    && document.receiptPublicationReserveSeconds >= 1
    && document.receiptPublicationReserveSeconds <= 3_600,
  'receipt publication reserve is invalid');
  canonicalNumericString(document.effectUid, 'effect uid');
  canonicalNumericString(document.effectGid, 'effect gid');
  validateFileBinding(document.program, 'authorized effect program');
  validateFileBinding(document.verifier, 'authorized effect verifier');
  validateFileBinding(document.delegatedScript, 'authorized effect script');
  if (document.delegatedBootstrap !== 'NONE') {
    validateTypedBinding(
      document.delegatedBootstrap,
      ['COMMON_SHELL', 'VERIFIER_SOURCE'],
      'authorized effect bootstrap',
    );
  }
  if (document.delegatedEnvironment !== 'NONE') {
    validateTypedBinding(
      document.delegatedEnvironment,
      ['SANITIZED_ENV', 'PROVIDER_CONFIG'],
      'authorized effect environment',
    );
  }
  const expectedBootstrapKind = {
    OPS_BUNDLE_INSTALL: 'NONE',
    SERVICE_RELEASE_SWITCH: 'COMMON_SHELL',
    SERVICE_ROLLBACK: 'COMMON_SHELL',
    BACKUP_CREATE: 'COMMON_SHELL',
    ISOLATED_RESTORE: 'COMMON_SHELL',
    SECRET_MATERIALIZATION: 'VERIFIER_SOURCE',
  }[document.actionClass];
  assert((document.delegatedBootstrap === 'NONE'
    ? 'NONE'
    : document.delegatedBootstrap.kind) === expectedBootstrapKind,
  'authorized effect bootstrap differs from the class');
  const expectedEnvironmentKind = {
    OPS_BUNDLE_INSTALL: 'NONE',
    SERVICE_RELEASE_SWITCH: 'SANITIZED_ENV',
    SERVICE_ROLLBACK: 'SANITIZED_ENV',
    BACKUP_CREATE: 'SANITIZED_ENV',
    ISOLATED_RESTORE: 'SANITIZED_ENV',
    SECRET_MATERIALIZATION: 'PROVIDER_CONFIG',
  }[document.actionClass];
  assert((document.delegatedEnvironment === 'NONE'
    ? 'NONE'
    : document.delegatedEnvironment.kind) === expectedEnvironmentKind,
  'authorized effect environment differs from the class');
  assert(Array.isArray(document.delegatedArgv)
    && document.delegatedArgv.length > 0
    && document.delegatedArgv.length <= 256,
  'delegated argv is invalid');
  for (const argument of document.delegatedArgv) {
    exactText(argument, 'delegated argument', { maximum: 4_096 });
  }
  validateEffectExecutables(document);
  requireExactKeys(document.effectDirectory, ['kind', 'path', 'identity'], 'effect directory');
  assert(['CLAIM_TEMPORARY_DIRECTORY', 'CREDENTIAL_OUTPUT_PARENT']
    .includes(document.effectDirectory.kind),
  'effect directory kind is invalid');
  canonicalAbsolute(document.effectDirectory.path, 'effect directory path');
  assert(DIRECTORY_IDENTITY.test(document.effectDirectory.identity),
    'effect directory identity is invalid');
  assert((document.actionClass === 'SECRET_MATERIALIZATION')
    === (document.effectDirectory.kind === 'CREDENTIAL_OUTPUT_PARENT'),
  'effect directory kind differs from the class');
  validateHelperPolicy(document);
  validateWriteRoots(document);
  validateReadRoots(document);
  validateObservedRoots(document);
  if (document.actionClass === 'BACKUP_CREATE') {
    requireExactKeys(
      document.effectOutput,
      ['status', 'fd', 'schemaVersion', 'kind', 'maxBytes'],
      'authorized effect output policy',
    );
    assert(document.effectOutput.status === 'ARMED'
      && document.effectOutput.fd === 53
      && document.effectOutput.schemaVersion === 1
      && document.effectOutput.kind === 'I00_AUTHORIZED_EFFECT_OUTPUT'
      && document.effectOutput.maxBytes === 4_096,
    'authorized effect output policy is invalid');
  } else {
    requireExactKeys(document.effectOutput, [], 'authorized effect output policy');
  }
  requireExactKeys(document.authorizationChain, CHAIN_KEYS, 'authorization chain');
  for (const key of [
    'authorization', 'deploymentRisk', 'actionPreview', 'authorizationConsumption',
  ]) {
    validateFileBinding(document.authorizationChain[key], `authorization chain ${key}`);
  }
  requireExactKeys(
    document.authorizationChain.consumptionRoot,
    ROOT_KEYS,
    'authorization consumption root',
  );
  canonicalAbsolute(
    document.authorizationChain.consumptionRoot.path,
    'authorization consumption root path',
  );
  assert(DIRECTORY_IDENTITY.test(document.authorizationChain.consumptionRoot.identity),
    'authorization consumption root identity is invalid');
  canonicalAbsolute(document.startEvidencePath, 'start evidence path');
  assert(DIGEST.test(document.startEvidenceSha256), 'start evidence digest is invalid');
  exactUtc(document.effectStartedAtUtc, 'effect start');
  requireExactKeys(document.runner, RUNNER_KEYS, 'authorized effect runner');
  assert(Number.isSafeInteger(document.runner.pid)
    && document.runner.pid > 1 && document.runner.pid <= 0xffff_ffff,
  'authorized effect runner pid is invalid');
  validateFileBinding(document.runner.node, 'authorized effect runner node');
  validateFileBinding(document.runner.source, 'authorized effect runner source');
}

function validateHandoff(document) {
  requireExactKeys(document, HANDOFF_KEYS, 'authorized effect handoff');
  assert(document.kind === 'AUTHORIZED_EFFECT_HANDOFF'
    && document.status === 'ACTIVE_BOUND_EFFECT',
  'authorized effect handoff kind or status is invalid');
  validateCommonHandoff(document);
  validateAutomaticRollbackPlan(document);
  return document;
}

function validateAutomaticRollbackHandoff(document) {
  requireExactKeys(
    document,
    AUTOMATIC_HANDOFF_KEYS,
    'authorized automatic rollback handoff',
  );
  assert(document.kind === 'AUTHORIZED_AUTOMATIC_ROLLBACK_HANDOFF'
    && document.status === 'ARMED_BOUND_RECOVERY'
    && document.actionClass === 'SERVICE_RELEASE_SWITCH'
    && DIGEST.test(document.primaryHandoffNonce),
  'authorized automatic rollback handoff kind or status is invalid');
  validateCommonHandoff(document);
  exactText(document.recovery, 'automatic rollback recovery');
  return document;
}

function readL15Anchor() {
  verifyTrustedAncestorChain(L15_CONTRACT, 'L15 amendment contract');
  const stat = lstatSync(L15_CONTRACT, { bigint: true, throwIfNoEntry: false });
  assert(stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n
    && (stat.mode & 0o022n) === 0n && realpathSync(L15_CONTRACT) === L15_CONTRACT,
  'L15 amendment contract is unsafe');
  const bytes = readFileSync(L15_CONTRACT);
  let document;
  try {
    document = JSON.parse(bytes);
  } catch {
    throw new HandoffBlocked('L15 amendment contract is invalid JSON');
  }
  const runtime = document.authorizedEffectRuntime;
  requireExactKeys(runtime, [
    'nodePath', 'runnerPath', 'runnerSha256', 'verifierPath', 'verifierSha256',
  ], 'authorized effect runtime anchor');
  assert(runtime.nodePath === '/usr/bin/node'
    && runtime.runnerPath === 'ops/i00/bin/run-bound-effect.mjs'
    && runtime.verifierPath === 'ops/i00/bin/verify-authorized-effect-handoff.mjs'
    && DIGEST.test(runtime.runnerSha256)
    && DIGEST.test(runtime.verifierSha256),
  'authorized effect runtime anchor is invalid');
  const verifierSha256 = createHash('sha256')
    .update(readFileSync(VERIFIER_SOURCE))
    .digest('hex');
  assert(verifierSha256 === runtime.verifierSha256,
    'executing handoff verifier differs from the L15 anchor');
  return Object.freeze({
    runtime,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    runner: resolve(I00_ROOT, 'bin', 'run-bound-effect.mjs'),
  });
}

function requireInheritedFile(descriptor, binding, label, { executable = false } = {}) {
  const stat = fstatSync(descriptor, { bigint: true });
  assert(stat.isFile() && stat.nlink === 1n
    && stat.size > 0n && stat.size <= BigInt(MAX_BOUND_FILE_BYTES)
    && (descriptorInfo(descriptor, label).flags & 0o3n) === 0n
    && (!executable || (stat.mode & 0o111n) !== 0n)
    && endpointIdentity(stat) === binding.identity
    && hashDescriptor(descriptor, stat.size, label) === binding.sha256,
  `${label} inherited descriptor differs from the handoff binding`);
  return stat;
}

function requireNullDescriptor(descriptor, label) {
  const stat = fstatSync(descriptor, { bigint: true });
  assert(!stat.isFile() && readlinkSync(`/proc/self/fd/${descriptor}`) === '/dev/null',
    `${label} is not the fixed null capability`);
}

function requireObservedRoot(root, expectedUid, label) {
  const stat = lstatSync(root.path, { bigint: true, throwIfNoEntry: false });
  assert(stat?.isDirectory() && !stat.isSymbolicLink()
    && realpathSync(root.path) === root.path
    && (stat.mode & 0o022n) === 0n
    && (stat.mode & 0o7000n) === 0n
    && (stat.uid === 0n || stat.uid === BigInt(expectedUid))
    && directoryIdentity(stat) === root.identity,
  `${label} differs from the authorization binding`);
}

function readRootIdentity(stat, expectedIdentity) {
  return DIRECTORY_IDENTITY.test(expectedIdentity)
    ? directoryIdentity(stat)
    : endpointIdentity(stat);
}

function requireReadRoot(root, expectedUid, label) {
  const stat = fstatSync(root.fd, { bigint: true });
  const named = lstatSync(root.path, { bigint: true, throwIfNoEntry: false });
  assert(stat.isDirectory()
    && named?.isDirectory() && !named.isSymbolicLink()
    && realpathSync(root.path) === root.path
    && (descriptorInfo(root.fd, label).flags & 0o3n) === 0n
    && (named.mode & 0o022n) === 0n
    && (named.mode & 0o7000n) === 0n
    && (named.uid === 0n || named.uid === BigInt(expectedUid))
    && readRootIdentity(stat, root.identity) === root.identity
    && readRootIdentity(named, root.identity) === root.identity,
  `${label} differs from the authorization binding`);
}

function executableLocator(name) {
  if (name === 'exposure') return 'I00_AUTHORIZED_EFFECT_EXPOSURE_FD';
  if (name === 'alert') return 'I00_AUTHORIZED_EFFECT_ALERT_FD';
  return `I00_EFFECT_EXEC_${name.toUpperCase()}_FD`;
}

function writeRootLocator(name) {
  return `I00_AUTHORIZED_EFFECT_WRITE_ROOT_${
    name.replace(/[A-Z]/gu, (value) => `_${value}`).toUpperCase()
  }_FD`;
}

function readRootLocator(name) {
  return `I00_AUTHORIZED_EFFECT_READ_ROOT_${
    name.replace(/[A-Z]/gu, (value) => `_${value}`).toUpperCase()
  }_FD`;
}

function primaryParentPrelude() {
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

function automaticRollbackPrelude() {
  return [
    '[ -r "/proc/$PPID/stat" ] && [ -r "/proc/$PPID/cmdline" ] || exit 125',
    '[ "/proc/$PPID/exe" -ef /proc/self/exe ] || exit 125',
    'IFS= read -r _i00_parent_stat < "/proc/$PPID/stat" || exit 125',
    '_i00_parent_tail=${_i00_parent_stat##*) }',
    '_i00_parent_tail=${_i00_parent_tail#* }',
    '_i00_runner_pid=${_i00_parent_tail%% *}',
    'case "$_i00_runner_pid" in ""|*[!0-9]*) exit 125 ;; esac',
    '[ -r "/proc/$_i00_runner_pid/cmdline" ] || exit 125',
    'if [ "$I00_AUTHORIZED_EFFECT_ROOT_MODE" = TEST ]; then',
    '  [ "/proc/$_i00_runner_pid/exe" -ef "$I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH" ] || exit 125',
    'else',
    '  [ "/proc/$_i00_runner_pid/exe" -ef /usr/bin/node ] || exit 125',
    'fi',
    '_i00_deploy_argv=()',
    'while IFS= read -r -d "" _i00_arg; do _i00_deploy_argv[${#_i00_deploy_argv[@]}]=$_i00_arg; done < "/proc/$PPID/cmdline"',
    '[ "${_i00_deploy_argv[0]}" = "$I00_AUTHORIZED_EFFECT_PROGRAM_PATH" ] || exit 125',
    '_i00_runner_argv=()',
    'while IFS= read -r -d "" _i00_arg; do _i00_runner_argv[${#_i00_runner_argv[@]}]=$_i00_arg; done < "/proc/$_i00_runner_pid/cmdline"',
    '[ "${#_i00_runner_argv[@]}" -ge 12 ] || exit 125',
    '[ "${_i00_runner_argv[1]}" = "$I00_AUTHORIZED_EFFECT_RUNNER_PATH" ] || exit 125',
    '[ "${_i00_runner_argv[2]}" = --authorization ] || exit 125',
    '[ "${_i00_runner_argv[4]}" = --deployment-risk ] || exit 125',
    '[ "${_i00_runner_argv[6]}" = --action-preview ] || exit 125',
    '[ "${_i00_runner_argv[8]}" = --authorization-consumption ] || exit 125',
    '[ "${_i00_runner_argv[10]}" = -- ] || exit 125',
    '_I00_AUTO_PARENT_VERIFIED=1',
    'readonly _I00_AUTO_PARENT_VERIFIED',
    'unset _i00_parent_stat _i00_parent_tail _i00_runner_pid _i00_deploy_argv _i00_runner_argv _i00_arg',
  ].join('\n');
}

function classDerivedArgv(document, risk) {
  const action = risk.action;
  const actionClass = document.actionClass;
  const script = '/proc/self/fd/11';
  const bootstrap = document.delegatedBootstrap === 'NONE'
    ? `${primaryParentPrelude()}\nsource /proc/self/fd/11`
    : `${primaryParentPrelude()}\nsource /proc/self/fd/13; source /proc/self/fd/11`;
  const derivedArgvBuilders = Object.freeze({
    OPS_BUNDLE_INSTALL: () => [
      '-p', '-c', bootstrap, document.delegatedScript.path, '--authorized-effect',
      '--release', endpoint(action, 'release-path'),
      '--destination', endpoint(action, 'destination'),
    ],
    SERVICE_RELEASE_SWITCH: () => [
      '-p', '-c', bootstrap, document.delegatedScript.path,
      '--i00-effect-environment-fd', '12',
      '--release', endpoint(action, 'release-path'),
    ],
    SERVICE_ROLLBACK: () => [
      '-p', '-c', bootstrap, document.delegatedScript.path,
      '--i00-effect-environment-fd', '12',
      '--to', endpoint(action, 'release-id'),
    ],
    BACKUP_CREATE: () => [
      '-p', '-c', bootstrap, document.delegatedScript.path,
      '--i00-effect-environment-fd', '12',
    ],
    ISOLATED_RESTORE: () => [
      '-p', '-c', bootstrap, document.delegatedScript.path,
      '--i00-effect-environment-fd', '12',
      '--backup', endpoint(action, 'backup-path'),
      '--target', endpoint(action, 'isolated-target'),
    ],
    SECRET_MATERIALIZATION: () => [
      script, '--authorized-effect',
      '--config-fd', '12',
      '--output-parent-fd', '15',
      '--output-name', basename(endpoint(action, 'credential-output-path')),
      ...(risk.artifactPolicy.rootMode === 'TEST'
        ? [
            '--provenance-mode', 'TEST',
            '--simulation',
            '--simulation-root', risk.artifactPolicy.proofRoot,
          ]
        : []),
    ],
  });
  const buildDerivedArgv = derivedArgvBuilders[actionClass];
  assert(typeof buildDerivedArgv === 'function',
    'authorized effect class has no delegated argv builder');
  return Object.freeze(buildDerivedArgv());
}

function automaticRollbackDerivedArgv(document) {
  return Object.freeze([
    '-p',
    '-c',
    `${automaticRollbackPrelude()}\nsource /proc/self/fd/13; source /proc/self/fd/35`,
    document.delegatedScript.path,
    '--auto',
    '--i00-effect-environment-fd',
    '12',
  ]);
}

function expectedRunnerArgv(document) {
  const chain = document.authorizationChain;
  const delegated = document.delegatedEnvironment === 'NONE'
      || document.delegatedEnvironment.kind === 'PROVIDER_CONFIG'
    ? [document.delegatedScript.path]
    : [
      document.delegatedScript.path,
      '--i00-effect-environment',
      document.delegatedEnvironment.binding.path,
    ];
  return Object.freeze([
    document.runner.node.path,
    document.runner.source.path,
    '--authorization', chain.authorization.path,
    '--deployment-risk', chain.deploymentRisk.path,
    '--action-preview', chain.actionPreview.path,
    '--authorization-consumption', chain.authorizationConsumption.path,
    '--',
    ...delegated,
  ]);
}

let failure = null;
let ackWritten = false;
let descriptorsClaimed = false;
let safeOutput = null;

try {
  assert(process.platform === 'linux', 'authorized effect handoff requires Linux');
  assert(
    sameJson(process.argv.slice(2), ['--role', 'PRIMARY_EFFECT'])
      || sameJson(process.argv.slice(2), ['--role', 'AUTOMATIC_ROLLBACK']),
    'authorized effect handoff role is invalid');
  for (const [name, value] of Object.entries(FD_LOCATORS)) {
    assert(process.env[name] === value, `authorized effect descriptor locator ${name} is invalid`);
  }
  descriptorsClaimed = true;
  const handoffStat = fstatSync(HANDOFF_FD, { bigint: true });
  assert(handoffStat.isFile() && handoffStat.nlink === 0n
    && (handoffStat.mode & 0o7777n) === 0o600n
    && handoffStat.size > 0n && handoffStat.size <= BigInt(MAX_HANDOFF_BYTES)
    && (descriptorInfo(HANDOFF_FD, 'authorized effect handoff').flags & 0o3n) === 0n,
  'authorized effect handoff descriptor is invalid');
  const handoffBytes = positionalRead(
    HANDOFF_FD,
    Number(handoffStat.size),
    'authorized effect handoff',
  );
  const document = AUTOMATIC_ROLLBACK_ROLE
    ? validateAutomaticRollbackHandoff(parseHandoff(
        handoffBytes,
        AUTOMATIC_HANDOFF_KEYS,
        'authorized automatic rollback handoff',
      ))
    : validateHandoff(parseHandoff(handoffBytes));
  let primaryDocument = document;
  if (AUTOMATIC_ROLLBACK_ROLE) {
    const primaryStat = fstatSync(3, { bigint: true });
    assert(primaryStat.isFile() && primaryStat.nlink === 0n
      && primaryStat.size > 0n && primaryStat.size <= BigInt(MAX_HANDOFF_BYTES),
    'primary handoff descriptor is unavailable to automatic rollback');
    primaryDocument = validateHandoff(parseHandoff(positionalRead(
      3,
      Number(primaryStat.size),
      'primary authorized effect handoff',
    )));
    assert(primaryDocument.actionClass === 'SERVICE_RELEASE_SWITCH'
      && document.primaryHandoffNonce === primaryDocument.handoffNonce
      && document.handoffNonce === primaryDocument.automaticRollback.handoffNonce,
    'automatic rollback handoff is not distinct and linked to the primary handoff');
  }
  const ackStat = fstatSync(ACK_FD, { bigint: true });
  assert(ackStat.isFIFO() || ackStat.isSocket(),
    'authorized effect acknowledgement descriptor is not anonymous IPC');
  const ackTarget = readlinkSync(`/proc/self/fd/${ACK_FD}`);
  assert((ackStat.isFIFO() && /^pipe:\[[1-9][0-9]*\]$/u.test(ackTarget))
    || (ackStat.isSocket() && /^socket:\[[1-9][0-9]*\]$/u.test(ackTarget)),
  'authorized effect acknowledgement descriptor target is invalid');
  const ackAccess = descriptorInfo(ACK_FD, 'authorized effect acknowledgement').flags & 0o3n;
  assert(ackAccess === 1n || (ackStat.isSocket() && ackAccess === 2n),
    'authorized effect acknowledgement descriptor is not write-capable');

  const riskEvidence = readCanonicalDescriptor(
    RISK_FD,
    document.authorizationChain.deploymentRisk,
    'deployment risk version',
  );
  const risk = riskEvidence.document;
  try {
    validateDeploymentRiskVersion(risk);
  } catch {
    throw new HandoffBlocked('deployment risk version semantic validation failed');
  }
  const firstHostRelease = risk.binding.actionClass === 'SERVICE_RELEASE_SWITCH'
    && risk.action.allowedEndpoints
      .includes('recovery-target:NO_PRIOR_RELEASE_FIRST_HOST');
  const automaticRollbackArmed =
    Object.keys(primaryDocument.automaticRollback).length !== 0;
  assert(automaticRollbackArmed === (
    risk.binding.actionClass === 'SERVICE_RELEASE_SWITCH' && !firstHostRelease
  ) && (!AUTOMATIC_ROLLBACK_ROLE || automaticRollbackArmed),
  'automatic rollback plan differs from the release endpoint group');
  assert(process.env.I00_AUTHORIZED_EFFECT_ROOT_MODE === risk.artifactPolicy.rootMode
    && process.env.I00_AUTHORIZED_EFFECT_RUNNER_PATH === document.runner.source.path
    && process.env.I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH === document.runner.node.path
    && process.env.I00_AUTHORIZED_EFFECT_PROGRAM_PATH === document.program.path,
  'authorized effect bootstrap locator values differ from the handoff');
  const previewEvidence = readCanonicalDescriptor(
    PREVIEW_FD,
    document.authorizationChain.actionPreview,
    'deployment action preview',
  );
  const preview = previewEvidence.document;
  try {
    validateDeploymentActionPreview(
      preview,
      risk,
      document.authorizationChain.deploymentRisk.sha256,
    );
  } catch {
    throw new HandoffBlocked('deployment action preview semantic validation failed');
  }
  const authorizationEvidence = readCanonicalDescriptor(
    AUTHORIZATION_FD,
    document.authorizationChain.authorization,
    'external authorization',
  );
  const authorization = validateExternalAuthorization(
    authorizationEvidence.document,
    risk,
    preview,
  );
  const consumptionEvidence = readCanonicalDescriptor(
    CONSUMPTION_FD,
    document.authorizationChain.authorizationConsumption,
    'authorization consumption',
  );
  const consumption = consumptionEvidence.document;
  try {
    validateAuthorizationConsumption(consumption);
  } catch {
    throw new HandoffBlocked('authorization consumption semantic validation failed');
  }
  const rootStat = fstatSync(CONSUMPTION_ROOT_FD, { bigint: true });
  assert(rootStat.isDirectory()
    && (descriptorInfo(
      CONSUMPTION_ROOT_FD,
      'authorization consumption root',
    ).flags & 0o3n) === 0n
    && directoryIdentity(rootStat) === document.authorizationChain.consumptionRoot.identity,
  'authorization consumption root descriptor differs from the handoff');
  assert(document.authorizationChain.consumptionRoot.path
      === risk.artifactPolicy.consumptionRoot
    && document.authorizationChain.consumptionRoot.identity
      === risk.artifactPolicy.consumptionRootIdentity
    && document.authorizationChain.consumptionRoot.path
      === preview.singleUse.consumptionRoot
    && document.authorizationChain.consumptionRoot.identity
      === preview.singleUse.consumptionRootIdentity,
  'authorization consumption root differs across the chain');
  const exactConsumption = {
    claimKey: preview.singleUse.claimKey,
    authorizationId: authorization.authorizationId,
    actionClass: risk.binding.actionClass,
    nonce: risk.binding.nonce,
    riskVersion: risk.riskVersion,
    serverPreviewDigest: preview.serverPreviewDigest,
    rootMode: risk.artifactPolicy.rootMode,
    consumptionRoot: risk.artifactPolicy.consumptionRoot,
    consumptionRootIdentity: risk.artifactPolicy.consumptionRootIdentity,
    evidenceValidUntilUtc: risk.evidenceValidUntilUtc,
    authorizationSha256: document.authorizationChain.authorization.sha256,
    riskDocumentSha256: document.authorizationChain.deploymentRisk.sha256,
    previewDocumentSha256: document.authorizationChain.actionPreview.sha256,
  };
  for (const [key, value] of Object.entries(exactConsumption)) {
    assert(consumption[key] === value,
      `authorization consumption ${key} differs from the chain`);
  }

  const startEvidence = readCanonicalDescriptor(
    START_FD,
    {
      path: document.startEvidencePath,
      sha256: document.startEvidenceSha256,
      identity: endpointIdentity(fstatSync(START_FD, { bigint: true })),
    },
    'authorized effect start evidence',
  );
  let startDocument;
  try {
    startDocument = validateAuthorizedEffectStart(startEvidence.document);
  } catch {
    throw new HandoffBlocked('authorized effect start evidence is invalid');
  }
  assert(startEvidence.bytes.equals(authorizedEffectEvidenceBytes(startDocument)),
    'authorized effect start evidence bytes are not canonical');
  const startReference = AUTOMATIC_ROLLBACK_ROLE ? primaryDocument : document;
  for (const field of START_COMMON_FIELDS) {
    assert(sameJson(startReference[field], startDocument[field]),
      `authorized effect start ${field} differs from the handoff`);
  }
  assert(sameJson(startReference.effectOutput, startDocument.effectOutputPolicy),
    'authorized effect start output policy differs from the handoff');

  const effectUid = canonicalNumericString(document.effectUid, 'effect uid');
  const effectGid = canonicalNumericString(document.effectGid, 'effect gid');
  assertBindingMatchesEndpoints(
    document.program,
    risk.action,
    'effect-program',
    'delegated effect program',
  );
  assertBindingMatchesEndpoints(
    document.delegatedScript,
    risk.action,
    'effect-script',
    'delegated effect script',
  );
  if (document.delegatedBootstrap === 'NONE') {
    assert(endpoint(risk.action, 'effect-common-path') === 'NONE'
      && endpoint(risk.action, 'effect-common-sha256') === 'NONE'
      && endpoint(risk.action, 'effect-common-identity') === 'NONE',
    'absent delegated bootstrap differs from the preview');
  } else {
    assertBindingMatchesEndpoints(
      document.delegatedBootstrap.binding,
      risk.action,
      'effect-common',
      'delegated effect bootstrap',
    );
  }
  if (document.delegatedEnvironment !== 'NONE') {
    if (document.delegatedEnvironment.kind === 'PROVIDER_CONFIG') {
      assertBindingMatchesEndpoints(
        document.delegatedEnvironment.binding,
        risk.action,
        'provider-config',
        'delegated provider configuration',
      );
    } else {
      assert(document.delegatedEnvironment.binding.path
          === endpoint(risk.action, 'effect-environment-source-path')
        && document.delegatedEnvironment.binding.sha256
          === endpoint(risk.action, 'effect-environment-sha256'),
      'delegated effect environment differs from the preview binding');
    }
  }
  assert(document.startEvidencePath === endpoint(risk.action, 'effect-start-evidence')
    && startDocument.startEvidencePath === document.startEvidencePath
    && startDocument.finishEvidencePath === endpoint(risk.action, 'effect-finish-evidence'),
  'effect evidence paths differ from the preview');
  if (document.actionClass === 'SECRET_MATERIALIZATION') {
    assert(document.effectDirectory.path
        === endpoint(risk.action, 'credential-output-parent-path')
      && document.effectDirectory.identity
        === endpoint(risk.action, 'credential-output-parent-identity'),
    'credential output parent differs from the preview');
  } else {
    const expectedTemporaryParent = risk.artifactPolicy.rootMode === 'SYSTEM'
      ? '/tmp'
      : `${risk.artifactPolicy.proofRoot}/tmp`;
    assert(dirname(document.effectDirectory.path) === expectedTemporaryParent
      && basename(document.effectDirectory.path)
        .startsWith(`i00-bound-effect.${document.claimKey.slice(0, 16)}.`),
    'effect temporary directory differs from the claim boundary');
  }
  requireInheritedFile(SCRIPT_FD, document.delegatedScript, 'delegated effect script', {
    executable: true,
  });
  requireInheritedFile(PROGRAM_FD, document.program, 'delegated effect program', {
    executable: true,
  });
  const executingVerifierFd = document.actionClass === 'SECRET_MATERIALIZATION'
    ? BOOTSTRAP_FD
    : VERIFIER_FD;
  requireInheritedFile(
    executingVerifierFd,
    document.verifier,
    'authorized effect verifier source',
  );
  if (document.delegatedBootstrap === 'NONE') {
    requireNullDescriptor(BOOTSTRAP_FD, 'unused delegated bootstrap descriptor');
  } else {
    requireInheritedFile(
      BOOTSTRAP_FD,
      document.delegatedBootstrap.binding,
      'delegated effect bootstrap',
    );
  }
  if (document.delegatedEnvironment === 'NONE') {
    requireNullDescriptor(ENVIRONMENT_FD, 'unused delegated environment descriptor');
  } else {
    requireInheritedFile(
      ENVIRONMENT_FD,
      document.delegatedEnvironment.binding,
      'delegated effect environment',
    );
    assert(document.delegatedEnvironment.binding.sha256 === (
      document.delegatedEnvironment.kind === 'PROVIDER_CONFIG'
        ? endpoint(risk.action, 'provider-config-sha256')
        : endpoint(risk.action, 'effect-environment-sha256')
    ), 'delegated effect environment digest differs from the preview');
  }
  const directoryStat = fstatSync(DIRECTORY_FD, { bigint: true });
  assert(directoryStat.isDirectory()
    && (descriptorInfo(
      DIRECTORY_FD,
      'effect directory',
    ).flags & 0o3n) === 0n
    && directoryIdentity(directoryStat) === document.effectDirectory.identity,
  'effect directory capability differs from the handoff');
  const expectedExecutableLocatorNames = new Set();
  for (const capability of document.effectExecutables) {
    const prefix = EXECUTABLE_ENDPOINT_PREFIXES[capability.name] ?? capability.name;
    assertBindingMatchesEndpoints(
      capability.binding,
      risk.action,
      prefix,
      `${capability.name} executable capability`,
    );
    requireInheritedFile(
      capability.fd,
      capability.binding,
      `${capability.name} executable capability`,
      { executable: true },
    );
    const locator = executableLocator(capability.name);
    expectedExecutableLocatorNames.add(locator);
    assert(process.env[locator] === String(capability.fd),
      `${capability.name} executable capability locator is invalid`);
  }
  for (const name of Object.keys(process.env).filter((key) => (
    (key.startsWith('I00_EFFECT_EXEC_') && key.endsWith('_FD'))
      || key === 'I00_AUTHORIZED_EFFECT_EXPOSURE_FD'
      || key === 'I00_AUTHORIZED_EFFECT_ALERT_FD'
  ))) {
    assert(expectedExecutableLocatorNames.has(name),
      'unexpected effect executable capability locator is present');
  }
  for (const descriptor of [
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 39,
  ]) {
    if (!document.effectExecutables.some((entry) => entry.fd === descriptor)) {
      requireNullDescriptor(descriptor, `unused executable descriptor ${descriptor}`);
    }
  }
  const expectedWriteRootLocators = new Set();
  for (const root of document.writeRoots) {
    const prefix = writeRootEndpointPrefix(root.name);
    assert(prefix !== undefined
      && root.path === endpointPathForDirectoryPrefix(risk.action, prefix)
      && root.identity === endpoint(risk.action, `${prefix}-identity`),
    `${root.name} write root differs from the preview`);
    const stat = fstatSync(root.fd, { bigint: true });
    assert(stat.isDirectory()
      && (descriptorInfo(root.fd, `${root.name} write root`).flags & 0o3n) === 0n
      && directoryIdentity(stat) === root.identity,
    `${root.name} write root descriptor differs from the handoff`);
    const locator = writeRootLocator(root.name);
    expectedWriteRootLocators.add(locator);
    assert(process.env[locator] === String(root.fd),
      `${root.name} write root locator is invalid`);
  }
  for (const name of Object.keys(process.env).filter((key) => (
    key.startsWith('I00_AUTHORIZED_EFFECT_WRITE_ROOT_') && key.endsWith('_FD')
  ))) {
    assert(expectedWriteRootLocators.has(name),
      'unexpected write root capability locator is present');
  }
  assert((firstHostRelease
    && !document.writeRoots.some((root) => root.name === 'rollbackEvidenceRoot'))
    || (!firstHostRelease
      && document.writeRoots.some((root) => root.name === 'rollbackEvidenceRoot'))
    || document.actionClass !== 'SERVICE_RELEASE_SWITCH',
  'release rollback evidence write root differs from the endpoint group');
  const expectedReadRootLocators = new Set();
  const readRootDocuments = AUTOMATIC_ROLLBACK_ROLE
    ? [primaryDocument, document]
    : [document];
  for (const sourceDocument of readRootDocuments) {
    for (const root of sourceDocument.readRoots) {
      assertReadRootMatchesRisk(root, risk.action);
      requireReadRoot(root, effectUid, `${root.name} read root`);
      const locator = readRootLocator(root.name);
      expectedReadRootLocators.add(locator);
      assert(process.env[locator] === String(root.fd),
        `${root.name} read root locator is invalid`);
    }
  }
  if (automaticRollbackArmed) {
    expectedReadRootLocators.add(readRootLocator('automaticRollbackSource'));
  }
  for (const sourceDocument of readRootDocuments) {
    for (const root of sourceDocument.readRoots) {
      requireReadRoot(root, effectUid, `${root.name} read root`);
    }
  }
  for (const root of document.observedRoots) {
    const prefix = root.name === 'backupDir' ? 'backup-dir' : 'data-dir';
    assert(root.path === endpointPathForDirectoryPrefix(risk.action, prefix)
      && root.identity === endpoint(risk.action, `${prefix}-identity`),
    `${root.name} observed root differs from the preview`);
    requireObservedRoot(root, effectUid, `${root.name} observed root`);
  }
  if (document.actionClass === 'SECRET_MATERIALIZATION') {
    requireNullDescriptor(38, 'unused shell verifier descriptor');
  } else {
    assert(process.env.I00_AUTHORIZED_EFFECT_VERIFIER_FD === '38',
      'authorized effect verifier locator is invalid');
  }
  if (!AUTOMATIC_ROLLBACK_ROLE) {
    assert(sameJson(document.delegatedArgv, classDerivedArgv(document, risk)),
    'delegated effect argv differs from the exact class preview');
  } else {
    assert(sameJson(document.delegatedArgv, automaticRollbackDerivedArgv(document)),
      'automatic rollback argv differs from the exact recovery contract');
  }
  let automaticHandoffStat = null;
  let automaticHandoffBytes = null;
  let automaticHandoffDocument = null;
  if (automaticRollbackArmed) {
    assertBindingMatchesEndpoints(
      primaryDocument.automaticRollback.script,
      risk.action,
      'automatic-rollback-script',
      'automatic rollback script',
    );
    for (const [name, value] of Object.entries(ROLLBACK_FD_LOCATORS)) {
      assert(process.env[name] === value,
        `automatic rollback descriptor locator ${name} is invalid`);
    }
    assert(process.env.I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH
      === primaryDocument.automaticRollback.script.path,
    'automatic rollback script path locator is invalid');
    requireInheritedFile(
      35,
      primaryDocument.automaticRollback.script,
      'automatic rollback script',
      { executable: true },
    );
    automaticHandoffStat = fstatSync(36, { bigint: true });
    assert(automaticHandoffStat.isFile() && automaticHandoffStat.nlink === 0n
      && automaticHandoffStat.size > 0n
      && automaticHandoffStat.size <= BigInt(MAX_HANDOFF_BYTES),
    'automatic rollback handoff descriptor is invalid');
    automaticHandoffBytes = positionalRead(
      36,
      Number(automaticHandoffStat.size),
      'automatic rollback handoff',
    );
    automaticHandoffDocument = validateAutomaticRollbackHandoff(parseHandoff(
      automaticHandoffBytes,
      AUTOMATIC_HANDOFF_KEYS,
      'automatic rollback handoff',
    ));
    assert(automaticHandoffDocument.handoffNonce
      === primaryDocument.automaticRollback.handoffNonce
      && automaticHandoffDocument.primaryHandoffNonce === primaryDocument.handoffNonce
      && automaticHandoffDocument.recovery === risk.action.rollback
      && sameJson(automaticHandoffDocument.delegatedScript,
        primaryDocument.automaticRollback.script)
      && sameJson(automaticHandoffDocument.delegatedArgv,
        primaryDocument.automaticRollback.delegatedArgv),
    'automatic rollback handoff differs from the primary recovery plan');
    for (const field of [
      'actionClass', 'authorizationId', 'claimKey', 'consumptionSha256',
      'riskVersion', 'serverPreviewDigest', 'authorizationExpiresAtUtc',
      'evidenceValidUntilUtc', 'receiptPublicationReserveSeconds',
      'effectUid', 'effectGid', 'program', 'verifier', 'delegatedBootstrap',
      'delegatedEnvironment', 'effectExecutables', 'effectDirectory',
      'helperPolicy', 'authorizationChain', 'startEvidencePath',
      'writeRoots', 'observedRoots', 'startEvidenceSha256',
      'effectStartedAtUtc', 'runner',
    ]) {
      assert(sameJson(automaticHandoffDocument[field], primaryDocument[field]),
        `automatic rollback ${field} differs from the primary handoff`);
    }
    for (const root of automaticHandoffDocument.readRoots) {
      assertReadRootMatchesRisk(root, risk.action);
      requireReadRoot(root, effectUid, `${root.name} read root`);
      const locator = readRootLocator(root.name);
      assert(process.env[locator] === String(root.fd),
        `${root.name} read root locator is invalid`);
    }
    const rollbackAckStat = fstatSync(37, { bigint: true });
    const rollbackAckAccess =
      descriptorInfo(37, 'automatic rollback acknowledgement').flags & 0o3n;
    assert((rollbackAckStat.isFIFO() || rollbackAckStat.isSocket())
      && (rollbackAckAccess === 1n
        || (rollbackAckStat.isSocket() && rollbackAckAccess === 2n)),
    'automatic rollback acknowledgement descriptor is invalid');
  } else {
    requireNullDescriptor(35, 'unused automatic rollback script descriptor');
    requireNullDescriptor(36, 'unused automatic rollback handoff descriptor');
    requireNullDescriptor(37, 'unused automatic rollback acknowledgement descriptor');
    for (const name of Object.keys(ROLLBACK_FD_LOCATORS)) {
      assert(process.env[name] === undefined,
        `unused automatic rollback locator ${name} is present`);
    }
    assert(process.env.I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH === undefined,
      'unused automatic rollback script path locator is present');
  }
  const usedRootDescriptors = new Set([
    ...document.writeRoots.map(({ fd }) => fd),
    ...primaryDocument.readRoots.map(({ fd }) => fd),
    ...document.readRoots.map(({ fd }) => fd),
    ...(automaticHandoffDocument === null
      ? []
      : automaticHandoffDocument.readRoots.map(({ fd }) => fd)),
  ]);
  for (let descriptor = 40; descriptor <= 52; descriptor += 1) {
    if (!usedRootDescriptors.has(descriptor)) {
      requireNullDescriptor(descriptor, `unused root capability descriptor ${descriptor}`);
    }
  }
  if (document.actionClass === 'BACKUP_CREATE' && !AUTOMATIC_ROLLBACK_ROLE) {
    assert(process.env.I00_AUTHORIZED_EFFECT_OUTPUT_FD === '53',
      'authorized effect output descriptor locator is invalid');
    const outputStat = fstatSync(53, { bigint: true });
    const outputAccess =
      descriptorInfo(53, 'authorized effect output').flags & 0o3n;
    assert((outputStat.isFIFO() || outputStat.isSocket())
      && (outputAccess === 1n || (outputStat.isSocket() && outputAccess === 2n)),
    'authorized effect output descriptor is not one write-only pipe');
  } else {
    requireNullDescriptor(53, 'unused authorized effect output descriptor');
    assert(process.env.I00_AUTHORIZED_EFFECT_OUTPUT_FD === undefined,
      'unused authorized effect output descriptor locator is present');
  }
  for (const name of Object.keys(process.env).filter((key) => (
    key.startsWith('I00_AUTHORIZED_EFFECT_READ_ROOT_') && key.endsWith('_FD')
  ))) {
    assert(expectedReadRootLocators.has(name),
      'unexpected read root capability locator is present');
  }
  const expectedCapabilityEnvironment = new Set([
    ...Object.keys(FD_LOCATORS),
    'I00_AUTHORIZED_EFFECT_ROOT_MODE',
    'I00_AUTHORIZED_EFFECT_RUNNER_PATH',
    'I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH',
    'I00_AUTHORIZED_EFFECT_PROGRAM_PATH',
    ...expectedExecutableLocatorNames,
    ...expectedWriteRootLocators,
    ...expectedReadRootLocators,
    ...(document.actionClass === 'SECRET_MATERIALIZATION'
      ? []
      : ['I00_AUTHORIZED_EFFECT_VERIFIER_FD']),
    ...(document.actionClass === 'BACKUP_CREATE' && !AUTOMATIC_ROLLBACK_ROLE
      ? ['I00_AUTHORIZED_EFFECT_OUTPUT_FD']
      : []),
    ...(automaticRollbackArmed
      ? [...Object.keys(ROLLBACK_FD_LOCATORS), 'I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH']
      : []),
  ]);
  for (const name of Object.keys(process.env)) {
    const capabilityNamespace = name.startsWith('I00_AUTHORIZED_')
      || name.startsWith('I00_EFFECT_EXEC_')
      || [
        'I00_AUTHORIZATION_FD',
        'I00_DEPLOYMENT_RISK_FD',
        'I00_ACTION_PREVIEW_FD',
      ].includes(name);
    assert(!capabilityNamespace || expectedCapabilityEnvironment.has(name),
      'unexpected authorized capability locator is present');
  }

  if (risk.artifactPolicy.rootMode !== 'TEST') {
    const l15 = readL15Anchor();
    assert(endpoint(risk.action, 'l15-amendment-contract-sha256') === l15.sha256
      || document.actionClass === 'OPS_BUNDLE_INSTALL'
      || document.actionClass === 'SECRET_MATERIALIZATION',
    'executing L15 amendment contract differs from the preview');
    assert(document.runner.node.path === l15.runtime.nodePath
      && document.runner.source.path === l15.runner
      && document.runner.source.sha256 === l15.runtime.runnerSha256,
    'runner handoff differs from the independent L15 trust anchor');
    assert(realpathSync(process.execPath) === l15.runtime.nodePath,
      'verifier Node executable differs from the independent L15 trust anchor');
  } else {
    assert(realpathSync(process.execPath) === document.runner.node.path,
      'TEST verifier Node differs from the runner binding');
  }
  stableNamedBinding(document.runner.node, 'fixed runner Node', { executable: true });
  stableNamedBinding(document.runner.source, 'fixed runner source');

  assert(process.geteuid() === effectUid && process.getegid() === effectGid,
    'verifier identity differs from the effect identity');
  const ancestry = captureAncestry(document.runner.pid);
  assert(ancestry.chain.length === (AUTOMATIC_ROLLBACK_ROLE ? 3 : 2),
    'verifier ancestry does not match the authorized role');
  const programSnapshot = ancestry.chain[0];
  const primaryProgramSnapshot = AUTOMATIC_ROLLBACK_ROLE
    ? ancestry.chain[1]
    : programSnapshot;
  const runnerSnapshot = AUTOMATIC_ROLLBACK_ROLE
    ? ancestry.chain[2]
    : ancestry.chain[1];
  assert(programSnapshot.pid === ancestry.self.ppid
    && runnerSnapshot.pid === document.runner.pid,
  'effect ancestry differs from the handoff');
  const runnerCredentials = readProcessCredentials(runnerSnapshot.pid);
  const programCredentials = readProcessCredentials(programSnapshot.pid);
  const primaryProgramCredentials =
    readProcessCredentials(primaryProgramSnapshot.pid);
  const rootRunnerRequired = risk.artifactPolicy.rootMode !== 'TEST';
  assert((rootRunnerRequired
    ? runnerCredentials.euid === 0 && runnerCredentials.egid === 0
    : runnerCredentials.euid === Number(handoffStat.uid))
    && programCredentials.euid === effectUid && programCredentials.egid === effectGid
    && primaryProgramCredentials.euid === effectUid
    && primaryProgramCredentials.egid === effectGid
    && handoffStat.uid === BigInt(runnerCredentials.euid),
  'runner, program, or handoff ownership is invalid');
  const programProcess = verifyProcExecutable(
    programSnapshot.pid,
    document.program,
    'bound effect program',
  );
  const expectedProgramArgv = AUTOMATIC_ROLLBACK_ROLE
    ? ['/proc/self/fd/17', ...document.delegatedArgv]
    : [document.program.path, ...document.delegatedArgv];
  assert(sameJson(programProcess.argv, expectedProgramArgv),
    'bound effect program argv differs from the class preview');
  let primaryProgramProcess = programProcess;
  if (AUTOMATIC_ROLLBACK_ROLE) {
    primaryProgramProcess = verifyProcExecutable(
      primaryProgramSnapshot.pid,
      primaryDocument.program,
      'bound primary effect program',
    );
    assert(sameJson(
      primaryProgramProcess.argv,
      [primaryDocument.program.path, ...primaryDocument.delegatedArgv],
    ), 'primary effect program argv differs during automatic rollback');
  }
  const runnerProcess = verifyProcExecutable(
    runnerSnapshot.pid,
    document.runner.node,
    'bound effect runner',
  );
  assert(sameJson(runnerProcess.argv, expectedRunnerArgv(primaryDocument)),
    'bound effect runner argv differs from the four path-only controls');

  assert(document.actionClass === risk.binding.actionClass
    && document.authorizationId === authorization.authorizationId
    && document.claimKey === consumption.claimKey
    && document.consumptionSha256
      === document.authorizationChain.authorizationConsumption.sha256
    && document.riskVersion === risk.riskVersion
    && document.serverPreviewDigest === preview.serverPreviewDigest
    && document.authorizationExpiresAtUtc === authorization.expiresAtUtc
    && document.evidenceValidUntilUtc === risk.evidenceValidUntilUtc
    && document.receiptPublicationReserveSeconds
      === risk.action.receiptPublicationReserveSeconds
    && document.effectUid === endpoint(risk.action, 'effect-uid')
    && document.effectGid === endpoint(risk.action, 'effect-gid'),
  'handoff fields differ from the authorization chain');
  if (AUTOMATIC_ROLLBACK_ROLE) {
    for (const field of [
      'actionClass', 'authorizationId', 'claimKey', 'consumptionSha256',
      'riskVersion', 'serverPreviewDigest', 'authorizationExpiresAtUtc',
      'evidenceValidUntilUtc', 'receiptPublicationReserveSeconds',
      'effectUid', 'effectGid', 'program', 'verifier', 'delegatedBootstrap',
      'delegatedEnvironment', 'effectExecutables', 'effectDirectory',
      'helperPolicy', 'authorizationChain', 'startEvidencePath',
      'writeRoots', 'observedRoots', 'startEvidenceSha256',
      'effectStartedAtUtc', 'runner',
    ]) {
      assert(sameJson(document[field], primaryDocument[field]),
        `automatic rollback ${field} differs from the primary handoff`);
    }
    assert(document.recovery === risk.action.rollback
      && sameJson(document.delegatedScript,
        primaryDocument.automaticRollback.script)
      && sameJson(document.delegatedArgv,
        primaryDocument.automaticRollback.delegatedArgv),
    'automatic rollback recovery binding differs from the primary handoff');
  }
  const now = Date.now();
  const evidenceHorizon = exactUtc(document.evidenceValidUntilUtc, 'evidence horizon');
  const completionDeadline = exactUtc(
    document.authorizationExpiresAtUtc,
    'authorization expiry',
  ) - (document.receiptPublicationReserveSeconds * 1_000);
  assert(exactUtc(document.effectStartedAtUtc, 'effect start') <= now
    && now < evidenceHorizon && now < completionDeadline,
  'authorized effect handoff time window is inactive');

  for (const [descriptor, binding, label, initialBytes] of [
    [RISK_FD, document.authorizationChain.deploymentRisk,
      'deployment risk version', riskEvidence.bytes],
    [PREVIEW_FD, document.authorizationChain.actionPreview,
      'deployment action preview', previewEvidence.bytes],
    [AUTHORIZATION_FD, document.authorizationChain.authorization,
      'external authorization', authorizationEvidence.bytes],
    [CONSUMPTION_FD, document.authorizationChain.authorizationConsumption,
      'authorization consumption', consumptionEvidence.bytes],
  ]) {
    const current = readCanonicalDescriptor(descriptor, binding, label);
    assert(current.bytes.equals(initialBytes),
      `${label} changed before acknowledgement`);
  }
  const finalConsumptionRootStat = fstatSync(CONSUMPTION_ROOT_FD, { bigint: true });
  const finalNamedConsumptionRoot = lstatSync(
    document.authorizationChain.consumptionRoot.path,
    { bigint: true, throwIfNoEntry: false },
  );
  assert(finalConsumptionRootStat.isDirectory()
    && directoryIdentity(finalConsumptionRootStat)
      === document.authorizationChain.consumptionRoot.identity
    && finalNamedConsumptionRoot?.isDirectory()
    && !finalNamedConsumptionRoot.isSymbolicLink()
    && directoryIdentity(finalNamedConsumptionRoot)
      === document.authorizationChain.consumptionRoot.identity
    && realpathSync(document.authorizationChain.consumptionRoot.path)
      === document.authorizationChain.consumptionRoot.path,
  'authorization consumption root changed before acknowledgement');
  const finalStart = readCanonicalDescriptor(
    START_FD,
    {
      path: document.startEvidencePath,
      sha256: document.startEvidenceSha256,
      identity: endpointIdentity(fstatSync(START_FD, { bigint: true })),
    },
    'authorized effect start evidence',
  );
  assert(finalStart.bytes.equals(startEvidence.bytes),
    'authorized effect start evidence changed before acknowledgement');
  requireInheritedFile(SCRIPT_FD, document.delegatedScript, 'delegated effect script', {
    executable: true,
  });
  requireInheritedFile(PROGRAM_FD, document.program, 'delegated effect program', {
    executable: true,
  });
  requireInheritedFile(
    executingVerifierFd,
    document.verifier,
    'authorized effect verifier source',
  );
  if (document.delegatedBootstrap !== 'NONE') {
    requireInheritedFile(
      BOOTSTRAP_FD,
      document.delegatedBootstrap.binding,
      'delegated effect bootstrap',
    );
  }
  if (document.delegatedEnvironment !== 'NONE') {
    requireInheritedFile(
      ENVIRONMENT_FD,
      document.delegatedEnvironment.binding,
      'delegated effect environment',
    );
  }
  const finalDirectoryStat = fstatSync(DIRECTORY_FD, { bigint: true });
  const finalNamedDirectory = lstatSync(
    document.effectDirectory.path,
    { bigint: true, throwIfNoEntry: false },
  );
  assert(finalDirectoryStat.isDirectory()
    && directoryIdentity(finalDirectoryStat) === document.effectDirectory.identity
    && finalNamedDirectory?.isDirectory() && !finalNamedDirectory.isSymbolicLink()
    && directoryIdentity(finalNamedDirectory) === document.effectDirectory.identity
    && realpathSync(document.effectDirectory.path) === document.effectDirectory.path,
  'effect directory changed before acknowledgement');
  for (const capability of document.effectExecutables) {
    requireInheritedFile(
      capability.fd,
      capability.binding,
      `${capability.name} executable capability`,
      { executable: true },
    );
  }
  for (const root of document.writeRoots) {
    const finalRootStat = fstatSync(root.fd, { bigint: true });
    const finalNamedRoot = lstatSync(root.path, { bigint: true, throwIfNoEntry: false });
    assert(finalRootStat.isDirectory()
      && directoryIdentity(finalRootStat) === root.identity
      && finalNamedRoot?.isDirectory() && !finalNamedRoot.isSymbolicLink()
      && directoryIdentity(finalNamedRoot) === root.identity
      && realpathSync(root.path) === root.path,
    `${root.name} write root changed before acknowledgement`);
  }
  for (const root of document.observedRoots) {
    requireObservedRoot(root, effectUid, `${root.name} observed root`);
  }
  stableNamedBinding(document.runner.node, 'fixed runner Node', { executable: true });
  stableNamedBinding(document.runner.source, 'fixed runner source');
  if (automaticRollbackArmed) {
    requireInheritedFile(
      35,
      primaryDocument.automaticRollback.script,
      'automatic rollback script',
      { executable: true },
    );
    assert(automaticHandoffStat !== null && automaticHandoffBytes !== null
      && sameStat(automaticHandoffStat, fstatSync(36, { bigint: true }))
      && positionalRead(
        36,
        Number(automaticHandoffStat.size),
        'automatic rollback handoff',
      ).equals(automaticHandoffBytes),
    'automatic rollback handoff changed before acknowledgement');
  }
  recheckAncestry(ancestry);
  assert(sameJson(
    verifyProcExecutable(programSnapshot.pid, document.program, 'bound effect program').argv,
    programProcess.argv,
  ) && sameJson(
    verifyProcExecutable(
      primaryProgramSnapshot.pid,
      primaryDocument.program,
      'bound primary effect program',
    ).argv,
    primaryProgramProcess.argv,
  ) && sameJson(
    verifyProcExecutable(runnerSnapshot.pid, document.runner.node, 'bound effect runner').argv,
    runnerProcess.argv,
  ), 'authorized effect process identity changed during verification');
  assert(positionalRead(
    HANDOFF_FD,
    Number(handoffStat.size),
    'authorized effect handoff',
  ).equals(handoffBytes)
    && sameStat(handoffStat, fstatSync(HANDOFF_FD, { bigint: true }))
    && Date.now() < evidenceHorizon
    && Date.now() < completionDeadline,
  'authorized effect handoff changed before acknowledgement');

  const acknowledgement = Buffer.from(
    `${
      AUTOMATIC_ROLLBACK_ROLE
        ? 'AUTHORIZED_AUTOMATIC_ROLLBACK_HANDOFF_ACCEPTED'
        : 'AUTHORIZED_EFFECT_HANDOFF_ACCEPTED'
    }:sha256:${
      createHash('sha256').update(handoffBytes).digest('hex')
    }\n`,
    'utf8',
  );
  assert(writeSync(ACK_FD, acknowledgement, 0, acknowledgement.length)
    === acknowledgement.length,
  'authorized effect acknowledgement write was incomplete');
  ackWritten = true;
  const helperPolicy = document.helperPolicy === 'NONE'
    ? 'NONE'
    : Object.freeze({
        exposure: Object.freeze({
          program: '/proc/self/fd/16',
          script: '/proc/self/fd/33',
          argvShape: 'NO_ARGS',
          timeoutMs: 3_000,
        }),
        alert: Object.freeze({
          program: '/proc/self/fd/17',
          script: '/proc/self/fd/34',
          argvShape: 'SEVERITY_CODE_MESSAGE',
          timeoutMs: 5_000,
        }),
      });
  const automaticRollback = automaticRollbackArmed
    ? Object.freeze({
        status: AUTOMATIC_ROLLBACK_ROLE ? 'ACTIVE' : 'ARMED',
        scriptFd: '/proc/self/fd/35',
        handoffFd: '/proc/self/fd/36',
        ackFd: '/proc/self/fd/37',
      })
    : Object.freeze({});
  let hashPolicy = 'NONE';
  if (['BACKUP_CREATE', 'ISOLATED_RESTORE'].includes(document.actionClass)) {
    const hashPath = endpoint(risk.action, 'hash-path');
    hashPolicy = Object.freeze({
      program: '/proc/self/fd/23',
      argvShape: basename(hashPath) === 'sha256sum' ? 'FILE' : 'A_256_FILE',
    });
    assert(['sha256sum', 'shasum'].includes(basename(hashPath)),
      'bound hash executable flavor is unsupported');
  }
  safeOutput = Object.freeze({
    status: 'AUTHORIZED_EFFECT_HANDOFF_VERIFIED',
    role: REQUESTED_ROLE,
    actionClass: document.actionClass,
    claimKey: document.claimKey,
    command: AUTOMATIC_ROLLBACK_ROLE ? 'automatic-rollback' : risk.action.command,
    environment: Object.freeze({
      kind: document.delegatedEnvironment === 'NONE'
        ? 'NONE'
        : document.delegatedEnvironment.kind,
      fd: document.delegatedEnvironment === 'NONE'
        ? 'NONE'
        : '/proc/self/fd/12',
    }),
    bootstrap: Object.freeze({
      kind: document.delegatedBootstrap === 'NONE'
        ? 'NONE'
        : document.delegatedBootstrap.kind,
      fd: document.delegatedBootstrap === 'NONE'
        ? 'NONE'
        : '/proc/self/fd/13',
    }),
    directory: Object.freeze({
      kind: document.effectDirectory.kind,
      fd: '/proc/self/fd/15',
    }),
    executables: Object.freeze(Object.fromEntries(
      document.effectExecutables.map(({ name, fd }) => [name, `/proc/self/fd/${fd}`]),
    )),
    helperPolicy,
    automaticRollback,
    effectOutput: document.actionClass === 'BACKUP_CREATE'
      ? Object.freeze({
          fd: '/proc/self/fd/53',
          schemaVersion: document.effectOutput.schemaVersion,
          kind: document.effectOutput.kind,
          maxBytes: document.effectOutput.maxBytes,
        })
      : Object.freeze({}),
    hashPolicy,
    writeRoots: Object.freeze(Object.fromEntries(document.writeRoots.map((root) => [
          root.name,
          Object.freeze({
            fd: `/proc/self/fd/${root.fd}`,
            path: root.path,
            identity: root.identity,
          }),
        ]))),
    readRoots: Object.freeze(Object.fromEntries(document.readRoots.map((root) => [
          root.name,
          Object.freeze({
            fd: `/proc/self/fd/${root.fd}`,
            path: root.path,
            identity: root.identity,
            treeSha256: root.treeSha256,
          }),
        ]))),
    observedRoots: Object.freeze(Object.fromEntries(document.observedRoots.map((root) => [
          root.name,
          Object.freeze({
            path: root.path,
            identity: root.identity,
          }),
        ]))),
  });
} catch (error) {
  failure = error instanceof HandoffBlocked
    ? error
    : new HandoffBlocked('authorized effect handoff verification failed');
} finally {
  for (const name of Object.keys(process.env)) {
    if (Object.hasOwn(FD_LOCATORS, name)
      || Object.hasOwn(ROLLBACK_FD_LOCATORS, name)
      || name.startsWith('I00_EFFECT_EXEC_')
      || name.startsWith('I00_AUTHORIZED_EFFECT_')
      || name === 'I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH') {
      delete process.env[name];
    }
  }
  if (descriptorsClaimed) {
    for (const descriptor of ALL_INHERITED_FDS) {
      try {
        closeSync(descriptor);
      } catch {
        if (failure === null) {
          failure = new HandoffBlocked('authorized effect descriptor close failed');
        }
      }
    }
  }
}

if (failure !== null || !ackWritten || safeOutput === null) {
  process.stderr.write(`I00_OPS_BLOCKED: ${failure?.message
    ?? 'authorized effect acknowledgement was not written'}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(safeOutput)}\n`);
}
