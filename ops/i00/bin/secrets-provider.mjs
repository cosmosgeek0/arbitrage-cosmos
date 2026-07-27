#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fail as exitBlocked,
  hasPlaceholder,
  parseArgs,
  requireExactKeys,
} from '../lib.mjs';
import { isWithinSimulationRoot, validateSimulationRoot } from '../simulation-safety.mjs';

const AWS_COMMAND_TIMEOUT_MS = 30_000;
const HANDOFF_VERIFIER_TIMEOUT_MS = 30_000;
const AUTHORIZED_EFFECT_DESCRIPTOR_LOCATORS = Object.freeze({
  I00_AUTHORIZED_EFFECT_FD: 3,
  I00_AUTHORIZED_EFFECT_ACK_FD: 4,
  I00_AUTHORIZATION_FD: 5,
  I00_DEPLOYMENT_RISK_FD: 6,
  I00_ACTION_PREVIEW_FD: 7,
  I00_AUTHORIZATION_CONSUMPTION_FD: 8,
  I00_AUTHORIZATION_CONSUMPTION_ROOT_FD: 9,
  I00_AUTHORIZED_EFFECT_START_FD: 10,
  I00_AUTHORIZED_EFFECT_SCRIPT_FD: 11,
  I00_AUTHORIZED_EFFECT_ENVIRONMENT_FD: 12,
  I00_AUTHORIZED_EFFECT_BOOTSTRAP_FD: 13,
  I00_AUTHORIZED_EFFECT_PROGRAM_FD: 14,
  I00_AUTHORIZED_EFFECT_DIRECTORY_FD: 15,
  I00_EFFECT_EXEC_AWS_FD: 32,
});
const AUTHORIZED_EFFECT_BOOTSTRAP_LOCATORS = Object.freeze([
  'I00_AUTHORIZED_EFFECT_ROOT_MODE',
  'I00_AUTHORIZED_EFFECT_RUNNER_PATH',
  'I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH',
  'I00_AUTHORIZED_EFFECT_PROGRAM_PATH',
]);
const AUTHORIZED_EFFECT_FDS = Object.freeze(
  Array.from({ length: 51 }, (_, index) => index + 3),
);
const RETAINED_SECRET_EFFECT_FDS = new Set([12, 15, 32]);
const PROTECTED_MUTATION_ROOTS = Object.freeze([
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
const closedLocalEnvironment = Object.freeze({
  HOME: '/var/empty',
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  TZ: 'UTC',
});
let retainedCredentialDescriptor;
let retainedOutputParentDescriptor;
const retainedAuthorizedEffectDescriptors = new Set();
const PREPUBLICATION_TERMINAL_PREFIX = 'PRECREDENTIAL_PROVIDER_TERMINAL ';
const PREPUBLICATION_SAFE_RETRY = 'REFUSED_REQUIRES_FRESH_AUTHORIZATION';
const PREPUBLICATION_STAGES = new Set([
  'ENTRY_GUARD',
  'HANDOFF_VERIFICATION',
  'CONFIG_VALIDATION',
  'OUTPUT_PRECHECK',
  'PROVIDER_BINDING',
  'CALLER_IDENTITY',
  'SECRET_FETCH',
  'SECRET_VALIDATION',
  'CREDENTIAL_PUBLICATION',
]);
const PREPUBLICATION_CAUSES = new Set([
  'POLICY_REFUSAL',
  'HANDOFF_REJECTED',
  'CONFIG_REJECTED',
  'OUTPUT_REJECTED',
  'PROVIDER_BINDING_REJECTED',
  'BOUND_INPUT_CHANGED',
  'IDENTITY_MISMATCH',
  'COMMAND_FAILED',
  'RESPONSE_REJECTED',
]);
let prepublicationStage = 'ENTRY_GUARD';
let prepublicationCause = 'POLICY_REFUSAL';
let credentialPublicationStarted = false;
let prepublicationTerminalEmitted = false;

function setPrepublicationFailure(stage, cause) {
  if (!PREPUBLICATION_STAGES.has(stage) || !PREPUBLICATION_CAUSES.has(cause)) {
    prepublicationStage = 'ENTRY_GUARD';
    prepublicationCause = 'POLICY_REFUSAL';
    return;
  }
  prepublicationStage = stage;
  prepublicationCause = cause;
}

process.once('exit', (code) => {
  if (code === 0 || credentialPublicationStarted || prepublicationTerminalEmitted) return;
  prepublicationTerminalEmitted = true;
  writeSync(2, `${PREPUBLICATION_TERMINAL_PREFIX}${JSON.stringify({
    status: 'PRECREDENTIAL_PROVIDER_FAILURE',
    stage: prepublicationStage,
    cause: prepublicationCause,
    credentialPublished: false,
    safeRetry: PREPUBLICATION_SAFE_RETRY,
  })}\n`);
});

function fail(message, code = 1) {
  for (const descriptor of retainedAuthorizedEffectDescriptors) {
    try {
      closeSync(descriptor);
    } catch {}
  }
  retainedAuthorizedEffectDescriptors.clear();
  if (retainedCredentialDescriptor !== undefined) {
    try {
      closeSync(retainedCredentialDescriptor);
    } catch {}
    retainedCredentialDescriptor = undefined;
  }
  if (retainedOutputParentDescriptor !== undefined) {
    try {
      closeSync(retainedOutputParentDescriptor);
    } catch {}
    retainedOutputParentDescriptor = undefined;
  }
  exitBlocked(message, code);
}

function fileIdentity(stats) {
  return [
    stats.dev,
    stats.ino,
    stats.mode,
    stats.nlink,
    stats.uid,
    stats.gid,
    stats.size,
    stats.mtimeNs,
    stats.ctimeNs,
  ].map(String).join(':');
}

function requireCanonicalAbsolutePath(value, label) {
  if (typeof value !== 'string' || value === '/' || !isAbsolute(value)
      || resolve(value) !== value) {
    fail(`${label} must be one lexical-canonical non-root absolute path`);
  }
  return value;
}

function canonicalPotentialPath(value, label) {
  requireCanonicalAbsolutePath(value, label);
  let cursor = value;
  const suffix = [];
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { throwIfNoEntry: false });
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM') {
        fail(`${label} existing ancestor cannot be inspected`);
      }
      stat = undefined;
    }
    if (stat !== undefined) {
      let ancestor;
      try {
        ancestor = realpathSync(cursor);
      } catch (error) {
        if (error?.code !== 'EACCES' && error?.code !== 'EPERM') {
          fail(`${label} existing ancestor cannot be canonicalized`);
        }
        ancestor = undefined;
      }
      if (ancestor === undefined) {
        const parent = dirname(cursor);
        if (parent === cursor) fail(`${label} is unreadable`);
        suffix.unshift(basename(cursor));
        cursor = parent;
        continue;
      }
      if (suffix.length > 0) {
        let ancestorStat;
        try {
          ancestorStat = lstatSync(ancestor, { bigint: true });
        } catch {
          fail(`${label} projected ancestor cannot be inspected`);
        }
        if (!ancestorStat.isDirectory()) fail(`${label} existing ancestor is not a directory`);
      }
      return resolve(ancestor, ...suffix);
    }
    const parent = dirname(cursor);
    if (parent === cursor) fail(`${label} has no existing ancestor`);
    const leaf = basename(cursor);
    if (!leaf || leaf === '.' || leaf === '..') fail(`${label} has an unsafe missing component`);
    suffix.unshift(leaf);
    cursor = parent;
  }
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function requirePhysicalProtectedUnionDisjoint(path, label) {
  const physicalCandidate = canonicalPotentialPath(path, label);
  for (const protectedInput of PROTECTED_MUTATION_ROOTS) {
    const protectedPhysical = canonicalPotentialPath(
      protectedInput,
      'protected production root',
    );
    if (pathsOverlap(physicalCandidate, protectedPhysical)) {
      fail(`${label} intersects the physically projected protected production root union`);
    }
  }
  return physicalCandidate;
}

function namedObjectIdentity(stats) {
  return [stats.dev, stats.ino].map(String).join(':');
}

function inspectPublishedCredential(capabilityPath, expectedPath) {
  const stats = lstatSync(capabilityPath, { bigint: true, throwIfNoEntry: false });
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n
      || realpathSync(capabilityPath) !== expectedPath
      || (stats.mode & 0o7777n) !== 0o600n) {
    fail('credential output publication did not produce one exact private regular file');
  }
  if (typeof process.getuid === 'function' && stats.uid !== BigInt(process.getuid())) {
    fail('credential output publication owner does not match the invoking identity');
  }
  return stats;
}

function verifyTrustedAncestors(path, label) {
  let cursor = dirname(path);
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true });
    const mode = stat.mode & 0o7777n;
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(cursor) !== cursor) {
      fail(`${label} ancestor chain must contain only canonical directories`);
    }
    if (invokingUid !== null && stat.uid !== invokingUid && stat.uid !== 0n) {
      fail(`${label} ancestor chain has an untrusted owner`);
    }
    if ((mode & 0o022n) !== 0n) {
      const rootOwnedStickyBoundary = stat.uid === 0n && (mode & 0o1000n) !== 0n;
      if (!rootOwnedStickyBoundary) {
        fail(`${label} ancestor chain contains an unsafe writable directory`);
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function verifyPrivateOutputParent(output) {
  const parent = dirname(output);
  let stats;
  try {
    stats = lstatSync(parent, { bigint: true });
  } catch {
    fail('credential output parent must already exist');
  }
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(parent) !== parent) {
    fail('credential output parent must be one canonical non-symlink directory');
  }
  if ((stats.mode & 0o7777n) !== 0o700n) {
    fail('credential output parent mode must be exactly 0700');
  }
  if (typeof process.getuid === 'function' && stats.uid !== BigInt(process.getuid())) {
    fail('credential output parent owner must match the invoking identity');
  }
  verifyTrustedAncestors(output, 'credential output');
  return Object.freeze({
    path: parent,
    identity: namedObjectIdentity(stats),
  });
}

function requireSameOutputParent(expected) {
  const current = verifyPrivateOutputParent(resolve(expected.path, 'credential-output-placeholder'));
  if (current.path !== expected.path || current.identity !== expected.identity) {
    fail('credential output parent identity changed before publication');
  }
}

function requireSameOutputParentDescriptor(expected, descriptor) {
  let opened;
  try {
    opened = fstatSync(descriptor, { bigint: true });
  } catch {
    fail('credential output parent descriptor became unavailable');
  }
  if (!opened.isDirectory()
      || namedObjectIdentity(opened) !== expected.identity
      || (opened.mode & 0o7777n) !== 0o700n) {
    fail('credential output parent descriptor identity changed');
  }
  if (typeof process.getuid === 'function'
      && opened.uid !== BigInt(process.getuid())) {
    fail('credential output parent descriptor owner changed');
  }
  requireSameOutputParent(expected);
}

function openPrivateOutputParent(expected) {
  let descriptor;
  try {
    descriptor = openSync(
      expected.path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    requireSameOutputParentDescriptor(expected, descriptor);
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof Error && error.message.startsWith('credential output')) {
      fail(error.message);
    }
    fail('credential output parent could not be opened exactly');
  }
}

function inspectAuthorizedOutputParent(output, descriptor) {
  const expectedPath = dirname(output);
  let stats;
  try {
    stats = fstatSync(descriptor, { bigint: true });
  } catch {
    fail('credential output parent capability is unavailable');
  }
  if (!stats.isDirectory() || (stats.mode & 0o7777n) !== 0o700n) {
    fail('credential output parent capability is not one exact private directory');
  }
  if (typeof process.geteuid === 'function'
      && stats.uid !== BigInt(process.geteuid())) {
    fail('credential output parent capability owner differs from the effect identity');
  }
  let capabilityPath;
  try {
    capabilityPath = realpathSync(`/proc/self/fd/${descriptor}`);
  } catch {
    fail('credential output parent capability path is unavailable');
  }
  if (capabilityPath !== expectedPath) {
    fail('credential output parent capability differs from the class-bound output');
  }
  return Object.freeze({
    path: expectedPath,
    identity: namedObjectIdentity(stats),
  });
}

function requireSameAuthorizedOutputParent(expected, descriptor) {
  const current = inspectAuthorizedOutputParent(
    resolve(expected.path, 'credential-output-placeholder'),
    descriptor,
  );
  if (current.path !== expected.path || current.identity !== expected.identity) {
    fail('credential output parent capability identity changed');
  }
}

function readBoundProviderConfig(path) {
  const label = 'Secrets Manager provider config';
  const absolute = requireCanonicalAbsolutePath(path, label);
  let descriptor;
  try {
    const namedBefore = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    if (!namedBefore?.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1n
        || realpathSync(absolute) !== absolute) {
      fail(`${label} must be one canonical single-link regular file`);
    }
    if (namedBefore.size <= 0n || namedBefore.size > 1024n * 1024n) {
      fail(`${label} size is invalid`);
    }
    const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
    if (invokingUid !== null && namedBefore.uid !== invokingUid && namedBefore.uid !== 0n) {
      fail(`${label} owner is untrusted`);
    }
    if ((namedBefore.mode & 0o022n) !== 0n) fail(`${label} mode is unsafe`);
    verifyTrustedAncestors(absolute, label);
    descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (fileIdentity(openedBefore) !== fileIdentity(namedBefore)) {
      fail(`${label} identity changed while opening`);
    }
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(absolute, { bigint: true });
    if (fileIdentity(openedAfter) !== fileIdentity(openedBefore)
        || fileIdentity(namedAfter) !== fileIdentity(openedBefore)
        || realpathSync(absolute) !== absolute) {
      fail(`${label} identity changed while reading`);
    }
    let document;
    try {
      document = JSON.parse(bytes.toString('utf8'));
    } catch {
      fail(`${label} is not valid JSON`);
    }
    return Object.freeze({
      absolute,
      document,
      identity: fileIdentity(openedAfter),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) fail(error.message);
    fail(`${label} exact inspection failed`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requireSameProviderConfig(expected) {
  const current = readBoundProviderConfig(expected.absolute);
  if (current.absolute !== expected.absolute
      || current.identity !== expected.identity
      || current.sha256 !== expected.sha256) {
    fail('Secrets Manager provider config changed after authorization binding');
  }
}

function readStableDescriptor(descriptor, label, maximumBytes) {
  let before;
  try {
    before = fstatSync(descriptor, { bigint: true });
  } catch {
    fail(`${label} inherited descriptor is unavailable`);
  }
  if (!before.isFile() || before.nlink !== 1n || before.size <= 0n
      || before.size > BigInt(maximumBytes)) {
    fail(`${label} inherited descriptor identity is unsafe`);
  }
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.length) {
    let count;
    try {
      count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    } catch {
      fail(`${label} inherited descriptor could not be read positionally`);
    }
    if (count <= 0) fail(`${label} inherited descriptor ended unexpectedly`);
    offset += count;
  }
  const after = fstatSync(descriptor, { bigint: true });
  if (fileIdentity(after) !== fileIdentity(before)) {
    fail(`${label} inherited descriptor changed while reading`);
  }
  return Object.freeze({
    bytes,
    identity: fileIdentity(after),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

function readAuthorizedProviderConfig(path, descriptor) {
  const absolute = requireCanonicalAbsolutePath(path, 'Secrets Manager provider config');
  const held = readStableDescriptor(
    descriptor,
    'Secrets Manager provider config',
    1024 * 1024,
  );
  let document;
  try {
    document = JSON.parse(held.bytes.toString('utf8'));
  } catch {
    fail('Secrets Manager provider config is not valid JSON');
  }
  return Object.freeze({
    absolute,
    descriptor,
    document,
    identity: held.identity,
    sha256: held.sha256,
  });
}

function requireSameAuthorizedProviderConfig(expected) {
  const current = readStableDescriptor(
    expected.descriptor,
    'Secrets Manager provider config',
    1024 * 1024,
  );
  if (current.identity !== expected.identity || current.sha256 !== expected.sha256) {
    fail('Secrets Manager provider config descriptor changed after handoff verification');
  }
}

function inspectAuthorizedExecutableDescriptor(
  descriptor,
  expectedPath,
  expectedSha256,
  label,
) {
  requireCanonicalAbsolutePath(expectedPath, `${label} path`);
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    fail(`${label} digest must be one exact SHA-256 value`);
  }
  const held = readStableDescriptor(descriptor, label, 512 * 1024 * 1024);
  const stats = fstatSync(descriptor, { bigint: true });
  const mode = stats.mode & 0o7777n;
  if ((mode & 0o111n) === 0n || (mode & 0o6222n) !== 0n) {
    fail(`${label} inherited descriptor mode is unsafe`);
  }
  if (held.sha256 !== expectedSha256) {
    fail(`${label} inherited descriptor digest differs from the provider config`);
  }
  let descriptorPath;
  try {
    descriptorPath = realpathSync(`/proc/self/fd/${descriptor}`);
  } catch {
    fail(`${label} inherited descriptor path is unavailable`);
  }
  if (descriptorPath !== expectedPath) {
    fail(`${label} inherited descriptor path differs from the provider config`);
  }
  return Object.freeze({
    descriptor,
    path: expectedPath,
    identity: held.identity,
    sha256: held.sha256,
  });
}

function requireSameAuthorizedExecutable(expected, label) {
  const current = inspectAuthorizedExecutableDescriptor(
    expected.descriptor,
    expected.path,
    expected.sha256,
    label,
  );
  if (current.identity !== expected.identity) {
    fail(`${label} inherited descriptor identity changed before use`);
  }
}

function requireSamePublishedCredential(
  capabilityPath,
  expectedPath,
  descriptor,
  expectedIdentity,
) {
  const current = inspectPublishedCredential(capabilityPath, expectedPath);
  const opened = fstatSync(descriptor, { bigint: true });
  if (fileIdentity(current) !== expectedIdentity
      || fileIdentity(opened) !== expectedIdentity) {
    fail('credential output identity changed after publication');
  }
}

function inspectBoundExecutable(path, expectedSha256, label) {
  if (typeof path !== 'string' || path.length === 0 || path !== resolve(path)) {
    fail(`${label} path must be one canonical absolute path`);
  }
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    fail(`${label} digest must be one exact SHA-256 value`);
  }
  let descriptor;
  try {
    const pathStats = lstatSync(path, { bigint: true });
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) fail(`${label} must be one regular non-symlink executable`);
    if (realpathSync(path) !== path) fail(`${label} path must already be canonical`);
    verifyTrustedAncestors(path, label);
    const mode = Number(pathStats.mode & 0o7777n);
    if ((mode & 0o111) === 0 || (mode & 0o022) !== 0 || (mode & 0o6000) !== 0) {
      fail(`${label} executable mode is unsafe`);
    }
    const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
    if (invokingUid !== null && pathStats.uid !== invokingUid && pathStats.uid !== 0n) {
      fail(`${label} executable has an untrusted owner`);
    }
    if (pathStats.size <= 0n || pathStats.size > 512n * 1024n * 1024n) fail(`${label} executable size is invalid`);
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStats = fstatSync(descriptor, { bigint: true });
    if (fileIdentity(openedStats) !== fileIdentity(pathStats)) fail(`${label} identity changed while opening`);
    const bytes = readFileSync(descriptor);
    const finalDescriptorStats = fstatSync(descriptor, { bigint: true });
    const finalPathStats = lstatSync(path, { bigint: true });
    if (fileIdentity(finalDescriptorStats) !== fileIdentity(openedStats)
        || fileIdentity(finalPathStats) !== fileIdentity(openedStats)) {
      fail(`${label} identity changed while hashing`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== expectedSha256) fail(`${label} digest does not match the exact configuration`);
    const endpointIdentity = [
      ['device', openedStats.dev],
      ['inode', openedStats.ino],
      ['mode', openedStats.mode.toString(8)],
      ['size', openedStats.size],
      ['mtimeNs', openedStats.mtimeNs],
      ['ctimeNs', openedStats.ctimeNs],
    ].map(([key, value]) => `${key}=${String(value)}`).join(',');
    return Object.freeze({
      path,
      sha256,
      identity: fileIdentity(openedStats),
      endpointIdentity,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) fail(error.message);
    fail(`${label} exact executable inspection failed`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requireSameExecutable(expected, current, label) {
  if (expected.path !== current.path
      || expected.sha256 !== current.sha256
      || expected.identity !== current.identity) {
    fail(`${label} exact executable identity changed before use`);
  }
}

function validateCallerIdentity(stdout, instanceRoleArn, secretAccount) {
  let identity;
  try { identity = JSON.parse(stdout); } catch { fail('AWS STS caller identity was not valid JSON'); }
  requireExactKeys(identity, ['Account', 'Arn', 'UserId'], 'AWS STS caller identity');
  if (identity.Account !== secretAccount) fail('AWS STS caller account does not match the exact secret account');
  if (typeof identity.Arn !== 'string') fail('AWS STS caller identity is malformed');
  const match = instanceRoleArn.match(/^arn:aws:iam::(\d{12}):role\/([A-Za-z0-9_+=,.@-]{1,64})$/u);
  if (!match || match[1] !== secretAccount) fail('instanceRoleArn must bind one exact same-account IAM role without a path');
  const caller = identity.Arn.match(/^arn:aws:sts::(\d{12}):assumed-role\/([A-Za-z0-9_+=,.@-]{1,64})\/([A-Za-z0-9_+=,.@-]{1,64})$/u);
  if (!caller || caller[1] !== match[1] || caller[2] !== match[2]) {
    fail('AWS STS caller identity does not match the exact configured instance role');
  }
  if (typeof identity.UserId !== 'string' || identity.UserId.length === 0 || identity.UserId.length > 256
      || /[\u0000-\u001f\u007f]/u.test(identity.UserId)) {
    fail('AWS STS caller identity is malformed');
  }
}

function validateAuthorizedEffectHandoffResult(result) {
  requireExactKeys(
    result,
    [
      'status', 'role', 'actionClass', 'claimKey', 'command', 'environment',
      'bootstrap', 'directory', 'executables', 'writeRoots', 'readRoots',
      'observedRoots', 'helperPolicy', 'automaticRollback', 'effectOutput',
      'hashPolicy',
    ],
    'authorized secret effect handoff result',
  );
  if (result.status !== 'AUTHORIZED_EFFECT_HANDOFF_VERIFIED'
      || result.role !== 'PRIMARY_EFFECT'
      || result.actionClass !== 'SECRET_MATERIALIZATION'
      || typeof result.claimKey !== 'string'
      || !/^[a-f0-9]{64}$/u.test(result.claimKey)
      || result.command !== 'secrets-provider') {
    fail('authorized secret effect handoff result differed from the exact class');
  }
  requireExactKeys(
    result.environment,
    ['kind', 'fd'],
    'authorized secret effect environment capability',
  );
  requireExactKeys(
    result.bootstrap,
    ['kind', 'fd'],
    'authorized secret effect bootstrap capability',
  );
  requireExactKeys(
    result.directory,
    ['kind', 'fd'],
    'authorized secret effect directory capability',
  );
  requireExactKeys(
    result.executables,
    ['aws'],
    'authorized secret effect executable capabilities',
  );
  requireExactKeys(
    result.effectOutput,
    [],
    'authorized secret effect output capability',
  );
  for (const [value, label] of [
    [result.writeRoots, 'authorized secret effect write roots'],
    [result.readRoots, 'authorized secret effect read roots'],
    [result.observedRoots, 'authorized secret effect observed roots'],
    [result.automaticRollback, 'authorized secret effect automatic rollback'],
  ]) {
    requireExactKeys(value, [], label);
  }
  if (result.environment.kind !== 'PROVIDER_CONFIG'
      || result.environment.fd !== '/proc/self/fd/12'
      || result.bootstrap.kind !== 'VERIFIER_SOURCE'
      || result.bootstrap.fd !== '/proc/self/fd/13'
      || result.directory.kind !== 'CREDENTIAL_OUTPUT_PARENT'
      || result.directory.fd !== '/proc/self/fd/15'
      || result.executables.aws !== '/proc/self/fd/32'
      || result.helperPolicy !== 'NONE'
      || result.hashPolicy !== 'NONE') {
    fail('authorized secret effect capabilities differed from the exact class');
  }
}

function verifyAuthorizedEffectHandoff() {
  if (process.platform !== 'linux') {
    fail('authorized secret effect handoff requires Linux');
  }
  const descriptorEntries = Object.entries(AUTHORIZED_EFFECT_DESCRIPTOR_LOCATORS);
  for (const [name, descriptor] of descriptorEntries) {
    if (process.env[name] !== String(descriptor)) {
      fail(`authorized secret effect descriptor locator ${name} is invalid`);
    }
    try {
      fstatSync(descriptor);
    } catch {
      fail(`authorized secret effect descriptor ${descriptor} is unavailable`);
    }
  }
  for (const descriptor of AUTHORIZED_EFFECT_FDS) {
    try {
      fstatSync(descriptor);
    } catch {
      fail(`authorized secret effect descriptor ${descriptor} is unavailable`);
    }
  }
  const bootstrapEntries = AUTHORIZED_EFFECT_BOOTSTRAP_LOCATORS.map((name) => {
    const value = process.env[name];
    if (typeof value !== 'string' || value.length === 0 || value.length > 4_096
        || /[\u0000\r\n]/u.test(value)) {
      fail(`authorized secret effect bootstrap locator ${name} is invalid`);
    }
    return [name, value];
  });
  const stdio = Array.from({ length: 54 }, () => 'ignore');
  stdio[0] = 'ignore';
  stdio[1] = 'pipe';
  stdio[2] = 'pipe';
  for (const descriptor of AUTHORIZED_EFFECT_FDS) {
    stdio[descriptor] = descriptor;
  }
  const verifierEnvironment = {
    ...closedLocalEnvironment,
    ...Object.fromEntries(descriptorEntries.map(
      ([name, descriptor]) => [name, String(descriptor)],
    )),
    ...Object.fromEntries(bootstrapEntries),
  };
  const verified = spawnSync('/proc/self/fd/14', [
    '/proc/self/fd/13',
    '--role', 'PRIMARY_EFFECT',
  ], {
    argv0: '/usr/bin/node',
    encoding: 'utf8',
    env: verifierEnvironment,
    maxBuffer: 128 * 1024,
    stdio,
    timeout: HANDOFF_VERIFIER_TIMEOUT_MS,
  });
  if (verified.status !== 0 || verified.stderr !== '') {
    fail('authorized secret effect handoff verification failed');
  }
  let result;
  try {
    result = JSON.parse(verified.stdout);
  } catch {
    fail('authorized secret effect handoff result was malformed');
  }
  validateAuthorizedEffectHandoffResult(result);
  for (const descriptor of AUTHORIZED_EFFECT_FDS) {
    if (RETAINED_SECRET_EFFECT_FDS.has(descriptor)) {
      retainedAuthorizedEffectDescriptors.add(descriptor);
      continue;
    }
    try {
      closeSync(descriptor);
    } catch {
      fail('authorized secret effect descriptors could not be closed after acknowledgement');
    }
  }
  for (const name of Object.keys(process.env)) {
    if (Object.hasOwn(AUTHORIZED_EFFECT_DESCRIPTOR_LOCATORS, name)
        || name.startsWith('I00_EFFECT_EXEC_')) {
      delete process.env[name];
    }
  }
  return result;
}

const args = parseArgs(
  process.argv.slice(2),
  new Set(['simulation', 'authorized-effect']),
);
const supportedArguments = new Set([
  'config', 'output', 'config-fd', 'output-parent-fd', 'output-name',
  'simulation', 'simulation-root', 'authorized-effect',
  'provenance-mode', 'provenance-root',
]);
for (const key of Object.keys(args)) {
  if (!supportedArguments.has(key)) fail(`unsupported argument --${key}`);
}
const provenanceMode = args['provenance-mode'] ?? (args.simulation ? 'TEST' : 'SYSTEM');
const authorizedEffectMode = args['authorized-effect'] === true;
if (!['SYSTEM', 'STAGING', 'TEST'].includes(provenanceMode)) {
  fail('--provenance-mode must be SYSTEM, STAGING, or TEST');
}
if (provenanceMode === 'STAGING') {
  fail('STAGING secret materialization is forbidden; use producer path classification without provider execution');
}
if ((provenanceMode === 'TEST') !== Boolean(args.simulation)) {
  fail('TEST provenance and --simulation must be selected together');
}
if (provenanceMode === 'SYSTEM') {
  if (args['provenance-root'] !== undefined || args['simulation-root'] !== undefined) {
    fail('SYSTEM provider rejects provenance and simulation roots');
  }
  if (!authorizedEffectMode) {
    fail('SYSTEM provider requires one verified authorized-effect handoff');
  }
  if (args.config !== undefined || args.output !== undefined) {
    fail('SYSTEM provider rejects named config and output inputs');
  }
  if (args['config-fd'] !== '12'
      || args['output-parent-fd'] !== '15'
      || args['output-name'] !== 'app-secrets.json') {
    fail('SYSTEM provider requires the exact descriptor-only config and output contract');
  }
} else {
  if (args['provenance-root'] !== undefined
      && args['provenance-root'] !== args['simulation-root']) {
    fail('TEST provenance root must equal the simulation root');
  }
  if (!args['simulation-root']) fail('simulation provider requires --simulation-root');
  if (authorizedEffectMode) {
    if (args.config !== undefined || args.output !== undefined) {
      fail('authorized TEST provider rejects named config and output inputs');
    }
    if (args['config-fd'] !== '12'
        || args['output-parent-fd'] !== '15'
        || args['output-name'] !== 'app-secrets.json') {
      fail('authorized TEST provider requires the exact descriptor-only config and output contract');
    }
  } else {
    if (args['config-fd'] !== undefined
        || args['output-parent-fd'] !== undefined
        || args['output-name'] !== undefined) {
      fail('TEST provider rejects SYSTEM descriptor selectors');
    }
    for (const key of ['config', 'output']) if (!args[key]) fail(`--${key} is required`);
  }
}
let simulationRoot;
let simulationTmp;
if (provenanceMode !== 'SYSTEM') {
  try {
    simulationRoot = validateSimulationRoot(args['simulation-root']);
    requirePhysicalProtectedUnionDisjoint(simulationRoot, 'TEST simulation root');
  } catch {
    fail('TEST provider requires one canonical marked simulation root');
  }
  simulationTmp = resolve(simulationRoot, 'tmp');
  let tempStat;
  try {
    tempStat = lstatSync(simulationTmp, { bigint: true });
  } catch {
    fail('TEST provider requires the exact marked-root tmp directory');
  }
  if (!tempStat.isDirectory() || tempStat.isSymbolicLink()
      || realpathSync(simulationTmp) !== simulationTmp
      || (tempStat.mode & 0o7777n) !== 0o700n
      || (typeof process.getuid === 'function'
        && tempStat.uid !== BigInt(process.getuid()))) {
    fail('TEST provider requires the exact marked-root tmp directory');
  }
}
const rawConfig = provenanceMode === 'SYSTEM'
  ? '/etc/cosmos/secrets-provider.json'
  : authorizedEffectMode
    ? resolve(simulationRoot, 'config', 'secrets-provider.json')
    : requireCanonicalAbsolutePath(args.config, 'Secrets Manager provider config');
const rawOutput = provenanceMode === 'SYSTEM'
  ? `/run/cosmos-secret-source/${args['output-name']}`
  : authorizedEffectMode
    ? resolve(simulationRoot, 'credentials', args['output-name'])
    : requireCanonicalAbsolutePath(args.output, 'credential output');
if (provenanceMode !== 'SYSTEM') {
  let configSafe = false;
  let outputSafe = false;
  try {
    configSafe = isWithinSimulationRoot(simulationRoot, rawConfig);
  } catch {
    configSafe = false;
  }
  try {
    outputSafe = isWithinSimulationRoot(simulationRoot, rawOutput);
  } catch {
    outputSafe = false;
  }
  if (!configSafe) fail('TEST provider config must remain below the marked simulation root');
  if (!outputSafe) fail('TEST credential output must remain below the marked simulation root');
  if (rawConfig !== resolve(simulationRoot, 'config', 'secrets-provider.json')) {
    fail('TEST provider config must equal the exact marked-root config category path');
  }
  if (rawOutput !== resolve(simulationRoot, 'credentials', 'app-secrets.json')) {
    fail('TEST credential output must equal the exact marked-root credential category path');
  }
}
if (authorizedEffectMode) {
  setPrepublicationFailure('HANDOFF_VERIFICATION', 'HANDOFF_REJECTED');
  verifyAuthorizedEffectHandoff();
}
setPrepublicationFailure('CONFIG_VALIDATION', 'CONFIG_REJECTED');
const providerConfig = authorizedEffectMode
  ? readAuthorizedProviderConfig(rawConfig, 12)
  : readBoundProviderConfig(rawConfig);
const config = providerConfig.document;
requireExactKeys(config, [
  'schemaVersion', 'secretArn', 'region', 'instanceRoleArn', 'awsCliPath', 'awsCliSha256',
  'secretVersionId', 'requiredKeys', 'targetHost', 'environment',
  'operator', 'deployedSha', 'configVersion', 'deploymentRisk', 'actionPreview',
  'authorizationConsumptionRoot', 'resultReceiptTarget', 'reconciliationReceiptTarget',
], 'Secrets Manager provider config');
if (config.schemaVersion !== 2) fail('Secrets Manager provider config schemaVersion must be 2');
if (hasPlaceholder(config.secretArn) || !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(config.secretArn)) {
  fail('secretArn must be one exact, fully suffixed Secrets Manager ARN');
}
if (hasPlaceholder(config.secretVersionId)
    || typeof config.secretVersionId !== 'string'
    || !/^[A-Za-z0-9-]{32,64}$/u.test(config.secretVersionId)) {
  fail('secretVersionId must bind one exact 32-64 character Secrets Manager version');
}
if (hasPlaceholder(config.region) || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(config.region)) fail('provider region is invalid');
if (config.secretArn.split(':')[3] !== config.region) fail('provider region must equal the exact secret ARN region');
const secretAccount = config.secretArn.split(':')[4];
if (hasPlaceholder(config.instanceRoleArn)
    || !/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9_+=,.@-]{1,64}$/u.test(config.instanceRoleArn)
    || config.instanceRoleArn.split(':')[4] !== secretAccount) {
  fail('instanceRoleArn must bind one exact same-account IAM role without a path');
}
if (hasPlaceholder(config.awsCliPath) || typeof config.awsCliPath !== 'string') {
  fail('awsCliPath must bind one exact executable');
}
if (!Array.isArray(config.requiredKeys) || config.requiredKeys.length === 0 || config.requiredKeys.length > 12) {
  fail('requiredKeys must contain 1 to 12 exact names');
}
if (new Set(config.requiredKeys).size !== config.requiredKeys.length
    || config.requiredKeys.some((key, index) => !/^[A-Z][A-Z0-9_]{0,127}$/.test(key)
      || key !== [...config.requiredKeys].sort()[index])) {
  fail('requiredKeys must be unique lexically sorted exact names');
}
for (const variable of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE']) {
  if (process.env[variable]) fail(`static or ambient AWS credential source ${variable} is forbidden`);
}

setPrepublicationFailure('OUTPUT_PRECHECK', 'OUTPUT_REJECTED');
const output = rawOutput;
let outputParent;
let outputParentDescriptor;
if (authorizedEffectMode) {
  outputParentDescriptor = 15;
  outputParent = inspectAuthorizedOutputParent(output, outputParentDescriptor);
} else {
  outputParent = verifyPrivateOutputParent(output);
  outputParentDescriptor = openPrivateOutputParent(outputParent);
}
retainedOutputParentDescriptor = outputParentDescriptor;
const anchoredOutput = process.platform === 'linux'
  ? `/proc/self/fd/${outputParentDescriptor}/${basename(output)}`
  : output;
if (lstatSync(anchoredOutput, { throwIfNoEntry: false }) !== undefined) {
  fail('credential output must be absent before provider access');
}

setPrepublicationFailure('PROVIDER_BINDING', 'PROVIDER_BINDING_REJECTED');
let aws = config.awsCliPath;
let initialAwsCli;
if (authorizedEffectMode) {
  if (process.env.AWS_CLI) {
    fail('authorized provider does not accept an AWS_CLI override');
  }
  initialAwsCli = inspectAuthorizedExecutableDescriptor(
    32,
    config.awsCliPath,
    config.awsCliSha256,
    'AWS CLI',
  );
  aws = '/proc/self/fd/32';
} else if (args.simulation) {
  if (!process.env.AWS_CLI) fail('simulation AWS_CLI provider command is not configured');
  const checked = spawnSync(process.execPath, [
    resolve(dirname(fileURLToPath(import.meta.url)), 'verify-simulation-command.mjs'),
    '--root', simulationRoot, '--command', process.env.AWS_CLI,
  ], {
    encoding: 'utf8',
    env: {
      ...closedLocalEnvironment,
      TMPDIR: simulationTmp,
    },
  });
  if (checked.status !== 0) fail('simulation AWS_CLI is outside the declared fake root');
  aws = checked.stdout.trim();
  if (aws !== config.awsCliPath) fail('simulation AWS_CLI does not match the exact configured path');
  initialAwsCli = inspectBoundExecutable(aws, config.awsCliSha256, 'AWS CLI');
} else if (process.env.AWS_CLI) {
  fail('real provider mode does not accept an AWS_CLI override');
}

const awsEnvironment = Object.freeze({
  ...closedLocalEnvironment,
  PATH: '/usr/local/bin:/usr/bin:/bin',
  AWS_CONFIG_FILE: '/dev/null',
  AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
  AWS_EC2_METADATA_DISABLED: args.simulation ? 'true' : 'false',
  AWS_REGION: config.region,
  AWS_DEFAULT_REGION: config.region,
  AWS_PAGER: '',
  AWS_CLI_AUTO_PROMPT: 'off',
});

function requireSameEffectInputs() {
  if (authorizedEffectMode) {
    requireSameAuthorizedOutputParent(outputParent, outputParentDescriptor);
    requireSameAuthorizedProviderConfig(providerConfig);
    requireSameAuthorizedExecutable(initialAwsCli, 'AWS CLI');
  } else {
    requireSameOutputParentDescriptor(outputParent, outputParentDescriptor);
    requireSameProviderConfig(providerConfig);
    requireSameExecutable(
      initialAwsCli,
      inspectBoundExecutable(aws, config.awsCliSha256, 'AWS CLI'),
      'AWS CLI',
    );
  }
}

function requireSameOutputParentBinding() {
  if (authorizedEffectMode) {
    requireSameAuthorizedOutputParent(outputParent, outputParentDescriptor);
  } else {
    requireSameOutputParentDescriptor(outputParent, outputParentDescriptor);
  }
}

function spawnAws(arguments_, maxBuffer) {
  const options = {
    argv0: config.awsCliPath,
    encoding: 'utf8',
    env: awsEnvironment,
    maxBuffer,
    timeout: AWS_COMMAND_TIMEOUT_MS,
  };
  if (authorizedEffectMode) {
    const stdio = Array.from({ length: 33 }, () => 'ignore');
    stdio[1] = 'pipe';
    stdio[2] = 'pipe';
    stdio[32] = 32;
    options.stdio = stdio;
  }
  return spawnSync(aws, arguments_, options);
}

setPrepublicationFailure('PROVIDER_BINDING', 'BOUND_INPUT_CHANGED');
requireSameEffectInputs();
setPrepublicationFailure('CALLER_IDENTITY', 'COMMAND_FAILED');
const caller = spawnAws([
  'sts', 'get-caller-identity', '--output', 'json', '--no-cli-pager',
], 128 * 1024);
if (caller.status !== 0) fail('AWS STS caller identity check failed without disclosing output');
setPrepublicationFailure('CALLER_IDENTITY', 'IDENTITY_MISMATCH');
validateCallerIdentity(caller.stdout, config.instanceRoleArn, secretAccount);
setPrepublicationFailure('PROVIDER_BINDING', 'BOUND_INPUT_CHANGED');
requireSameEffectInputs();
setPrepublicationFailure('SECRET_FETCH', 'COMMAND_FAILED');
const fetched = spawnAws([
  'secretsmanager', 'get-secret-value', '--secret-id', config.secretArn,
  '--region', config.region, '--version-id', config.secretVersionId,
  '--version-stage', 'AWSCURRENT', '--query', 'SecretString',
  '--output', 'text', '--no-cli-pager',
], 1024 * 1024);
if (fetched.status !== 0) fail('Secrets Manager provider failed without disclosing output');
setPrepublicationFailure('SECRET_VALIDATION', 'RESPONSE_REJECTED');
let secret;
try { secret = JSON.parse(fetched.stdout); } catch { fail('Secrets Manager response was not a JSON object'); }
if (!secret || typeof secret !== 'object' || Array.isArray(secret)) fail('Secrets Manager response was not a JSON object');
const materialized = {};
for (const key of config.requiredKeys) {
  const value = secret[key];
  if (typeof value !== 'string' || value.length < 8 || value.length > 4096 || /[\r\n\0]/.test(value)) {
    fail(`required secret field ${key} is missing or malformed`);
  }
  materialized[key] = value;
}

setPrepublicationFailure('PROVIDER_BINDING', 'BOUND_INPUT_CHANGED');
requireSameEffectInputs();
let outputDescriptor;
let retainedOutputIdentity;
try {
  requireSameEffectInputs();
  setPrepublicationFailure('CREDENTIAL_PUBLICATION', 'OUTPUT_REJECTED');
  outputDescriptor = openSync(
    anchoredOutput,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  credentialPublicationStarted = true;
  retainedCredentialDescriptor = outputDescriptor;
  const opened = fstatSync(outputDescriptor, { bigint: true });
  if (!opened.isFile() || (opened.mode & 0o7777n) !== 0o600n) {
    fail('credential output claim is not one exact private regular file');
  }
  if (typeof process.getuid === 'function' && opened.uid !== BigInt(process.getuid())) {
    fail('credential output claim owner does not match the invoking identity');
  }
  writeFileSync(outputDescriptor, `${JSON.stringify(materialized)}\n`);
  fsyncSync(outputDescriptor);
  const createdOutput = fstatSync(outputDescriptor, { bigint: true });
  const createdOutputIdentity = fileIdentity(createdOutput);
  retainedOutputIdentity = createdOutputIdentity;
  requireSameOutputParentBinding();
  requireSamePublishedCredential(
    anchoredOutput,
    output,
    outputDescriptor,
    createdOutputIdentity,
  );
} catch (error) {
  if (error instanceof Error && error.message.startsWith('credential output')) fail(error.message);
  fail('credential output already exists or could not be claimed exactly');
}
try {
  requireSameOutputParentBinding();
  fsyncSync(outputParentDescriptor);
  requireSameOutputParentBinding();
  requireSamePublishedCredential(
    anchoredOutput,
    output,
    outputDescriptor,
    retainedOutputIdentity,
  );
  requireSameEffectInputs();
  requireSamePublishedCredential(
    anchoredOutput,
    output,
    outputDescriptor,
    retainedOutputIdentity,
  );
  closeSync(outputDescriptor);
  retainedCredentialDescriptor = undefined;
  closeSync(outputParentDescriptor);
  retainedAuthorizedEffectDescriptors.delete(outputParentDescriptor);
  retainedOutputParentDescriptor = undefined;
  if (authorizedEffectMode) {
    for (const descriptor of [12, 32]) {
      closeSync(descriptor);
      retainedAuthorizedEffectDescriptors.delete(descriptor);
    }
  }
} catch {
  fail('credential output post-publication verification failed without disclosure');
}
process.stdout.write(`${JSON.stringify({ status: 'SECRET_MATERIALIZED_WITHOUT_DISCLOSURE', keyCount: Object.keys(materialized).length, output })}\n`);
