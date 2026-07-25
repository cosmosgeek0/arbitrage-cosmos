#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { constants as osConstants } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  authorizedEffectEvidenceBytes,
  validateAuthorizedEffectOutput,
  validateAuthorizedEffectStart,
  validateAuthorizedEffectTerminal,
} from '../authorized-effect-evidence.mjs';
import {
  canonicalJsonBytes,
  inspectPrivateDirectoryEvidence,
  privateDirectoryIdentityEndpoint,
  readCanonicalDeploymentDocument,
  recheckCanonicalDeploymentDocument,
  validateAuthorizationConsumption,
  validateDeploymentActionPreview,
  validateDeploymentRiskVersion,
} from '../deployment-authorization-contract.mjs';

const RUNNER_SOURCE = realpathSync(fileURLToPath(import.meta.url));
const ACTION_CLASSES = new Set([
  'OPS_BUNDLE_INSTALL',
  'SERVICE_RELEASE_SWITCH',
  'SERVICE_ROLLBACK',
  'BACKUP_CREATE',
  'ISOLATED_RESTORE',
  'SECRET_MATERIALIZATION',
]);
const AUTHORIZATION_KEYS = Object.freeze([
  'schemaVersion',
  'authorizationId',
  'operator',
  'status',
  'actionClasses',
  'scope',
  'deployedSha',
  'configVersion',
  'riskVersion',
  'nonce',
  'serverPreviewDigest',
  'account',
  'environment',
  'host',
  'issuedAtUtc',
  'startsAtUtc',
  'expiresAtUtc',
  'allowedCommands',
  'allowedEndpoints',
  'allowedProducts',
  'allowedCredentials',
  'preconditions',
  'maximumEffect',
  'rollback',
  'recovery',
  'ownerApproval',
  'receiptTargets',
]);
const ENDPOINT_IDENTITY =
  /^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,size=[0-9]+,mtimeNs=-?[0-9]+,ctimeNs=-?[0-9]+$/u;
const EXACT_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const MAX_BOUND_FILE_BYTES = 1024n * 1024n * 1024n;
const MAX_OPEN_FILE_BYTES = 128n * 1024n * 1024n * 1024n;
const BACKUP_OUTPUT_MAX_BYTES = 4_096;
const BACKUP_OUTPUT_FD = 53;
const BACKUP_NAME = /^[0-9]{8}T[0-9]{6}Z(?:-[1-9][0-9]*)?$/u;
const EXECUTABLE_SLOTS = Object.freeze({
  node: 16,
  bash: 17,
  env: 18,
  systemctl: 19,
  curl: 20,
  sqlite: 21,
  tar: 22,
  hash: 23,
  id: 24,
  getent: 25,
  setpriv: 26,
  mkdir: 27,
  cp: 28,
  chmod: 29,
  mv: 30,
  rm: 31,
  aws: 32,
  exposure: 33,
  alert: 34,
  gzip: 39,
});
const EXECUTABLE_ENDPOINT_PREFIXES = Object.freeze({
  aws: 'aws-cli',
  exposure: 'exposure-helper',
  alert: 'alert-helper',
});
const CLASS_EXECUTABLES = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze([
    'node', 'bash', 'mkdir', 'cp', 'chmod', 'mv', 'rm',
  ]),
  SERVICE_RELEASE_SWITCH: Object.freeze([
    'node', 'bash', 'env', 'systemctl', 'curl', 'sqlite', 'exposure', 'alert',
  ]),
  SERVICE_ROLLBACK: Object.freeze([
    'node', 'bash', 'env', 'systemctl', 'curl', 'exposure', 'alert',
  ]),
  BACKUP_CREATE: Object.freeze([
    'node', 'bash', 'env', 'sqlite', 'tar', 'hash', 'id', 'getent', 'setpriv', 'gzip',
  ]),
  ISOLATED_RESTORE: Object.freeze([
    'node', 'bash', 'env', 'sqlite', 'tar', 'hash', 'id', 'getent', 'setpriv', 'gzip',
  ]),
  SECRET_MATERIALIZATION: Object.freeze(['aws']),
});
const WRITE_ROOT_SLOTS = Object.freeze({
  destinationParent: 40,
  cosmosRoot: 41,
  releasesDir: 42,
  currentLinkParent: 43,
  previousLinkParent: 44,
  opsStateDir: 45,
  backupDir: 46,
  isolatedTargetParent: 47,
  rollbackEvidenceRoot: 48,
  dataDir: 49,
});
const READ_ROOT_SLOTS = Object.freeze({
  dataDir: 49,
  backupSource: 50,
  releaseSource: 51,
  automaticRollbackSource: 52,
});
const CLASS_WRITE_ROOTS = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze([
    ['destinationParent', 'destination-parent'],
  ]),
  SERVICE_RELEASE_SWITCH: Object.freeze([
    ['cosmosRoot', 'cosmos-root'],
    ['releasesDir', 'releases-dir'],
    ['currentLinkParent', 'current-link-parent'],
    ['previousLinkParent', 'previous-link-parent'],
    ['opsStateDir', 'ops-state-dir'],
    ['rollbackEvidenceRoot', 'rollback-evidence-root'],
    ['dataDir', 'data-dir'],
  ]),
  SERVICE_ROLLBACK: Object.freeze([
    ['cosmosRoot', 'cosmos-root'],
    ['releasesDir', 'releases-dir'],
    ['currentLinkParent', 'current-link-parent'],
    ['previousLinkParent', 'previous-link-parent'],
    ['opsStateDir', 'ops-state-dir'],
    ['rollbackEvidenceRoot', 'rollback-evidence-root'],
    ['dataDir', 'data-dir'],
  ]),
  BACKUP_CREATE: Object.freeze([
    ['opsStateDir', 'ops-state-dir'],
    ['backupDir', 'backup-dir'],
  ]),
  ISOLATED_RESTORE: Object.freeze([
    ['isolatedTargetParent', 'isolated-target-parent'],
  ]),
  SECRET_MATERIALIZATION: Object.freeze([]),
});
const CLASS_OBSERVED_ROOTS = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze([]),
  SERVICE_RELEASE_SWITCH: Object.freeze([]),
  SERVICE_ROLLBACK: Object.freeze([]),
  BACKUP_CREATE: Object.freeze([]),
  ISOLATED_RESTORE: Object.freeze([
    ['dataDir', 'data-dir'],
    ['backupDir', 'backup-dir'],
  ]),
  SECRET_MATERIALIZATION: Object.freeze([]),
});
const CLASS_READ_ROOTS = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze([
    ['releaseSource', 'release', 'TYPED_TREE'],
  ]),
  SERVICE_RELEASE_SWITCH: Object.freeze([
    ['releaseSource', 'release', 'TYPED_TREE'],
  ]),
  SERVICE_ROLLBACK: Object.freeze([
    ['releaseSource', 'release', 'TYPED_TREE'],
  ]),
  BACKUP_CREATE: Object.freeze([
    ['dataDir', 'data-dir', null],
  ]),
  ISOLATED_RESTORE: Object.freeze([
    ['backupSource', 'backup', 'BACKUP_TREE'],
  ]),
  SECRET_MATERIALIZATION: Object.freeze([]),
});

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

// Deferred refusal carrier. process.exit takes effect immediately and skips every
// remaining cleanup, so a refusal raised inside a region that still owns residue
// (the effect temporary directory) would leave that residue behind. While the
// deferral scope below is active a refusal is thrown as this error instead of being
// taken on the spot; the guarded region captures it, lets the cleanup run, and then
// re-issues it through blocked() with the identical message and exit code. The
// refusal wording, stream, and exit status seen by callers never change.
class DeferredRefusal extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DeferredRefusal';
    this.refusalCode = code;
  }
}

const DEFERRED_REFUSAL_SCOPE = { active: false };

function blocked(message, code = 1) {
  if (DEFERRED_REFUSAL_SCOPE.active) throw new DeferredRefusal(message, code);
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(code);
}

function assert(condition, message) {
  if (!condition) blocked(message);
}

function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} must be one object`);
  assert(Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'),
    `${label} has an unexpected field set`);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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

function currentUtcSecond() {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

function canonicalId(value, label) {
  assert(typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value),
    `${label} is not one canonical numeric identifier`);
  const parsed = Number(value);
  assert(Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 0xffff_ffff,
    `${label} is outside the supported identifier range`);
  return parsed;
}

function endpoint(action, prefix) {
  const marker = `${prefix}:`;
  const matches = action.allowedEndpoints
    .filter((value) => value.startsWith(marker))
    .map((value) => value.slice(marker.length));
  assert(matches.length === 1, `authorization chain lacks one exact ${prefix} endpoint`);
  return matches[0];
}

function statIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
  });
}

function endpointFileIdentity(stat) {
  return [
    `device=${stat.dev}`,
    `inode=${stat.ino}`,
    `mode=${stat.mode.toString(8)}`,
    `size=${stat.size}`,
    `mtimeNs=${stat.mtimeNs}`,
    `ctimeNs=${stat.ctimeNs}`,
  ].join(',');
}

function sameIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inspectTrustedAncestorChain(path, expected = null, reject = blocked) {
  const chain = [];
  let cursor = dirname(path);
  for (;;) {
    const stat = lstatSync(cursor, { bigint: true, throwIfNoEntry: false });
    if (!stat?.isDirectory() || stat.isSymbolicLink() || realpathSync(cursor) !== cursor) {
      reject('delegated effect program ancestor chain is not canonical');
    }
    const mode = stat.mode & 0o7777n;
    if ((mode & 0o022n) !== 0n) {
      reject('delegated effect program ancestor chain contains a writable directory');
    }
    if (stat.uid !== 0n) {
      reject('delegated effect program ancestor chain is not root-owned');
    }
    chain.push(Object.freeze({ path: cursor, identity: statIdentity(stat) }));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const frozen = Object.freeze(chain);
  if (expected !== null && !sameJson(frozen, expected)) {
    reject('delegated effect program ancestor identity changed');
  }
  return frozen;
}

function inspectBoundFile(
  path,
  label,
  {
    executable,
    expectedSha256 = null,
    expectedIdentity = null,
    expectedAncestors = null,
    rootAncestorChain = false,
    reject = blocked,
  },
) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
      || realpathSync(path) !== path) {
    reject(`${label} path is not one canonical absolute file`);
  }
  let ancestorChain = null;
  if (rootAncestorChain) {
    ancestorChain = inspectTrustedAncestorChain(path, expectedAncestors, reject);
  }
  const before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  const invokingUid = typeof process.geteuid === 'function'
    ? BigInt(process.geteuid()) : null;
  if (!before?.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || before.size <= 0n || before.size > MAX_BOUND_FILE_BYTES
      || (before.mode & 0o022n) !== 0n
      || (before.mode & 0o7000n) !== 0n
      || (executable && (before.mode & 0o111n) === 0n)
      || (invokingUid !== null && before.uid !== 0n && before.uid !== invokingUid)) {
    reject(`${label} identity is unsafe`);
  }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const openedBefore = fstatSync(descriptor, { bigint: true });
    const fields = ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'];
    if (!fields.every((key) => openedBefore[key] === before[key])) {
      reject(`${label} changed before hashing`);
    }
    const sha256 = hashOpenFile(
      descriptor,
      openedBefore.size,
      label,
      MAX_BOUND_FILE_BYTES,
      reject,
    );
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (!after || !fields.every((key) => (
      openedAfter[key] === openedBefore[key] && after[key] === openedAfter[key]
    )) || realpathSync(path) !== path) {
      reject(`${label} changed while hashing`);
    }
    if (rootAncestorChain) {
      inspectTrustedAncestorChain(path, ancestorChain, reject);
    }
    const identity = endpointFileIdentity(openedAfter);
    if ((expectedSha256 !== null && sha256 !== expectedSha256)
        || (expectedIdentity !== null && identity !== expectedIdentity)) {
      reject(`${label} differs from its authorization binding`);
    }
    return Object.freeze({
      path,
      sha256,
      identity,
      ancestorChain,
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateExternalAuthorization(authorization, risk, preview) {
  exactKeys(authorization, AUTHORIZATION_KEYS, 'external authorization');
  const action = risk.action;
  const binding = risk.binding;
  const window = risk.authorizationWindow;
  assert(authorization.schemaVersion === 2 && authorization.status === 'APPROVED',
    'external authorization is not one approved v2 document');
  assert(sameJson(authorization.actionClasses, [binding.actionClass])
    && sameJson(authorization.allowedCommands, [action.command])
    && sameJson(authorization.allowedEndpoints, action.allowedEndpoints)
    && sameJson(authorization.allowedProducts, action.allowedProducts)
    && sameJson(authorization.allowedCredentials, action.allowedCredentials)
    && sameJson(authorization.preconditions, action.preconditions)
    && sameJson(authorization.maximumEffect, action.maximumEffect)
    && sameJson(authorization.receiptTargets, action.receiptTargets),
  'external authorization action differs from the canonical preview');
  for (const [authorizationKey, riskValue] of [
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
    assert(authorization[authorizationKey] === riskValue,
      `external authorization ${authorizationKey} differs from the canonical preview`);
  }
  exactKeys(authorization.ownerApproval, ['approver', 'approvedAtUtc', 'reference'],
    'external authorization ownerApproval');
  assert(authorization.ownerApproval.approver === binding.approver
    && authorization.ownerApproval.reference === binding.approvalReference,
  'external authorization owner approval differs from the risk binding');
  const approval = exactUtc(
    authorization.ownerApproval.approvedAtUtc,
    'external authorization owner approval',
  );
  assert(approval >= exactUtc(authorization.issuedAtUtc, 'external authorization issue')
    && approval <= exactUtc(authorization.startsAtUtc, 'external authorization start'),
  'external authorization owner approval chronology is invalid');
  return authorization;
}

function validateChainPaths(control) {
  const riskEvidence = readCanonicalDeploymentDocument(
    control.get('--deployment-risk'),
    'deployment risk version',
    validateDeploymentRiskVersion,
  );
  const previewEvidence = readCanonicalDeploymentDocument(
    control.get('--action-preview'),
    'deployment action preview',
    (preview) => validateDeploymentActionPreview(
      preview,
      riskEvidence.document,
      riskEvidence.sha256,
    ),
  );
  const authorizationEvidence = readCanonicalDeploymentDocument(
    control.get('--authorization'),
    'external authorization',
    (authorization) => validateExternalAuthorization(
      authorization,
      riskEvidence.document,
      previewEvidence.document,
    ),
  );
  const consumptionEvidence = readCanonicalDeploymentDocument(
    control.get('--authorization-consumption'),
    'authorization consumption',
    validateAuthorizationConsumption,
  );
  const risk = riskEvidence.document;
  const preview = previewEvidence.document;
  const authorization = authorizationEvidence.document;
  const consumption = consumptionEvidence.document;
  const consumptionRoot = inspectPrivateDirectoryEvidence(
    preview.singleUse.consumptionRoot,
    'authorization consumption root',
  );
  const consumptionRootIdentity = privateDirectoryIdentityEndpoint(consumptionRoot);
  assert(consumptionRootIdentity === preview.singleUse.consumptionRootIdentity
    && consumptionRootIdentity === risk.artifactPolicy.consumptionRootIdentity,
  'authorization consumption root identity differs from the producer binding');
  assert(consumptionEvidence.absolute
      === `${consumptionRoot.absolute}/${preview.singleUse.claimKey}.json`,
  'authorization consumption path is not the exact bound claim leaf');
  const exactConsumption = {
    claimKey: preview.singleUse.claimKey,
    authorizationId: authorization.authorizationId,
    actionClass: risk.binding.actionClass,
    nonce: risk.binding.nonce,
    riskVersion: risk.riskVersion,
    serverPreviewDigest: preview.serverPreviewDigest,
    rootMode: risk.artifactPolicy.rootMode,
    consumptionRoot: consumptionRoot.absolute,
    consumptionRootIdentity,
    evidenceValidUntilUtc: risk.evidenceValidUntilUtc,
    authorizationSha256: authorizationEvidence.sha256,
    riskDocumentSha256: riskEvidence.sha256,
    previewDocumentSha256: previewEvidence.sha256,
  };
  for (const [key, value] of Object.entries(exactConsumption)) {
    assert(consumption[key] === value,
      `authorization consumption ${key} differs from the exact chain binding`);
  }
  const consumedAt = exactUtc(consumption.consumedAtUtc, 'authorization consumption time');
  assert(consumedAt >= exactUtc(authorization.startsAtUtc, 'authorization start')
    && consumedAt < exactUtc(authorization.expiresAtUtc, 'authorization expiry'),
  'authorization consumption is outside the approved window');
  return Object.freeze({
    authorizationEvidence,
    riskEvidence,
    previewEvidence,
    consumptionEvidence,
    authorization,
    risk,
    preview,
    consumption,
  });
}

function recheckChain(chain) {
  recheckCanonicalDeploymentDocument(
    chain.riskEvidence,
    'deployment risk version',
    validateDeploymentRiskVersion,
  );
  recheckCanonicalDeploymentDocument(
    chain.previewEvidence,
    'deployment action preview',
    (preview) => validateDeploymentActionPreview(
      preview,
      chain.riskEvidence.document,
      chain.riskEvidence.sha256,
    ),
  );
  recheckCanonicalDeploymentDocument(
    chain.authorizationEvidence,
    'external authorization',
    (authorization) => validateExternalAuthorization(
      authorization,
      chain.risk,
      chain.preview,
    ),
  );
  recheckCanonicalDeploymentDocument(
    chain.consumptionEvidence,
    'authorization consumption',
    validateAuthorizationConsumption,
  );
  const root = inspectPrivateDirectoryEvidence(
    chain.preview.singleUse.consumptionRoot,
    'authorization consumption root',
  );
  assert(privateDirectoryIdentityEndpoint(root)
    === chain.preview.singleUse.consumptionRootIdentity,
  'authorization consumption root identity changed');
}

function inspectEvidenceParent(path, expectedRoot, expectedIdentity) {
  assert(typeof path === 'string' && isAbsolute(path) && resolve(path) === path,
    'effect evidence path is not raw canonical absolute');
  const parent = inspectPrivateDirectoryEvidence(dirname(path), 'effect evidence root');
  assert(parent.absolute === expectedRoot
    && privateDirectoryIdentityEndpoint(parent) === expectedIdentity,
  'effect evidence root differs from the risk artifact policy');
  return parent;
}

function writeEvidence(parent, path, document, label) {
  const current = inspectPrivateDirectoryEvidence(parent.absolute, 'effect evidence root');
  assert(sameIdentity(current.identity, parent.identity),
    'effect evidence root identity changed');
  const bytes = authorizedEffectEvidenceBytes(document);
  let parentDescriptor;
  let descriptor;
  let completed = false;
  try {
    parentDescriptor = openSync(
      parent.absolute,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const openedParent = fstatSync(parentDescriptor, { bigint: true });
    assert(openedParent.isDirectory()
      && sameIdentity(statIdentity(openedParent), parent.identity),
    'effect evidence root descriptor identity changed');
    const anchored = process.platform === 'linux'
      ? `/proc/self/fd/${parentDescriptor}/${basename(path)}`
      : path;
    descriptor = openSync(
      anchored,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const opened = fstatSync(descriptor, { bigint: true });
    assert(opened.isFile() && opened.nlink === 1n
      && (opened.mode & 0o777n) === 0o600n
      && opened.uid === BigInt(process.geteuid()),
    `${label} claim is not one private owner-bound file`);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const finalOpened = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    assert(named?.isFile() && !named.isSymbolicLink()
      && finalOpened.dev === opened.dev && finalOpened.ino === opened.ino
      && finalOpened.size === BigInt(bytes.length)
      && named.dev === finalOpened.dev && named.ino === finalOpened.ino
      && named.size === finalOpened.size && realpathSync(path) === path,
    `${label} identity changed during exact publication`);
    fsyncSync(parentDescriptor);
    const published = Object.freeze({
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    completed = true;
    return published;
  } finally {
    if (!completed && descriptor !== undefined) {
      // Pre-completion failure after the exclusive create: remove only the record
      // this call itself created, so an aborted run leaves no residue that would
      // block a legitimate retry on the same deterministic evidence pathname. A
      // call that reaches completion never enters this branch, so a COMPLETED
      // record stays in place and still collides on the O_EXCL create above.
      try {
        const residuePath = process.platform === 'linux' && parentDescriptor !== undefined
          ? `/proc/self/fd/${parentDescriptor}/${basename(path)}`
          : path;
        const residue = lstatSync(residuePath, { bigint: true, throwIfNoEntry: false });
        if (residue !== undefined && residue.isFile() && !residue.isSymbolicLink()
            && sameIdentity(
              statIdentity(residue),
              statIdentity(fstatSync(descriptor, { bigint: true })),
            )) {
          unlinkSync(residuePath);
        }
      } catch {
        // Residue removal is best effort and must never mask the original refusal.
      }
    }
    if (descriptor !== undefined) closeSync(descriptor);
    if (parentDescriptor !== undefined) closeSync(parentDescriptor);
  }
}

function createAnonymousHandoff(bytes, temporaryParent) {
  assert(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 65_536,
    'authorized effect handoff size is invalid');
  let temporaryRoot;
  if (temporaryParent === '/tmp') {
    temporaryRoot = lstatSync('/tmp', { bigint: true, throwIfNoEntry: false });
    assert(temporaryRoot?.isDirectory() && !temporaryRoot.isSymbolicLink()
      && realpathSync('/tmp') === '/tmp'
      && temporaryRoot.uid === 0n && temporaryRoot.gid === 0n
      && (temporaryRoot.mode & 0o7777n) === 0o1777n,
    'SYSTEM temporary root is not the exact root-owned sticky boundary');
  } else {
    temporaryRoot = lstatSync(
      temporaryParent,
      { bigint: true, throwIfNoEntry: false },
    );
    assert(temporaryRoot?.isDirectory() && !temporaryRoot.isSymbolicLink()
      && realpathSync(temporaryParent) === temporaryParent
      && (temporaryRoot.mode & 0o777n) === 0o700n,
    'handoff temporary root is not one exact private directory');
  }
  let parentDescriptor;
  let directory;
  let path;
  let writer;
  let reader;
  try {
    parentDescriptor = openSync(
      temporaryParent,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const openedParent = fstatSync(parentDescriptor, { bigint: true });
    assert(openedParent.isDirectory()
      && openedParent.dev === temporaryRoot.dev
      && openedParent.ino === temporaryRoot.ino
      && openedParent.uid === temporaryRoot.uid
      && openedParent.gid === temporaryRoot.gid
      && openedParent.mode === temporaryRoot.mode,
    'handoff temporary root changed while opening');
    directory = mkdtempSync(join(`/proc/self/fd/${parentDescriptor}`, 'handoff.'));
    chmodSync(directory, 0o700);
    path = join(directory, 'handoff.json');
    writer = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeFileSync(writer, bytes);
    fsyncSync(writer);
    closeSync(writer);
    writer = undefined;
    reader = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(reader, { bigint: true });
    assert(before.isFile() && before.nlink === 1n
      && before.size === BigInt(bytes.length)
      && (before.mode & 0o777n) === 0o600n
      && before.uid === BigInt(process.geteuid()),
    'authorized effect handoff descriptor is unsafe');
    unlinkSync(path);
    rmdirSync(directory);
    const anonymous = fstatSync(reader, { bigint: true });
    assert(anonymous.isFile() && anonymous.nlink === 0n
      && anonymous.dev === before.dev && anonymous.ino === before.ino
      && anonymous.size === before.size && anonymous.mode === before.mode
      && anonymous.uid === before.uid,
    'authorized effect handoff is not one retained anonymous file');
    const finalParent = lstatSync(
      temporaryParent,
      { bigint: true, throwIfNoEntry: false },
    );
    assert(finalParent?.isDirectory() && !finalParent.isSymbolicLink()
      && finalParent.dev === openedParent.dev && finalParent.ino === openedParent.ino
      && finalParent.uid === openedParent.uid && finalParent.gid === openedParent.gid
      && finalParent.mode === openedParent.mode
      && realpathSync(temporaryParent) === temporaryParent,
    'handoff temporary root identity changed during anchored creation');
    closeSync(parentDescriptor);
    parentDescriptor = undefined;
    return reader;
  } catch (error) {
    if (reader !== undefined) closeSync(reader);
    try {
      if (writer !== undefined) closeSync(writer);
    } catch {}
    try {
      if (path !== undefined) unlinkSync(path);
    } catch {}
    try {
      if (directory !== undefined) rmdirSync(directory);
    } catch {}
    try {
      if (parentDescriptor !== undefined) closeSync(parentDescriptor);
    } catch {}
    throw error;
  }
}

function openFixedNullCapability() {
  const path = '/dev/null';
  let descriptor;
  try {
    const namedBefore = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    assert(namedBefore?.isCharacterDevice() && !namedBefore.isSymbolicLink()
      && namedBefore.nlink === 1n
      && namedBefore.uid === 0n && namedBefore.gid === 0n
      && (namedBefore.mode & 0o7777n) === 0o666n
      && realpathSync(path) === path,
    'fixed null capability path is invalid');
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    const fields = ['dev', 'ino', 'rdev', 'mode', 'nlink', 'uid', 'gid'];
    assert(opened.isCharacterDevice() && namedAfter?.isCharacterDevice()
      && !namedAfter.isSymbolicLink()
      && fields.every((field) => (
        opened[field] === namedBefore[field]
          && namedAfter[field] === opened[field]
      ))
      && realpathSync(path) === path,
    'fixed null capability identity changed while opening');
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    throw error;
  }
}

function createEffectTemporaryDirectory(policy, claimKey, uid, gid) {
  const parent = policy.rootMode === 'SYSTEM'
    ? '/tmp'
    : `${policy.proofRoot}/tmp`;
  assert(isAbsolute(parent) && resolve(parent) === parent,
    'effect temporary parent path is invalid');
  let parentStat;
  if (policy.rootMode === 'SYSTEM') {
    parentStat = lstatSync(parent, { bigint: true, throwIfNoEntry: false });
    assert(parent === '/tmp'
      && parentStat?.isDirectory() && !parentStat.isSymbolicLink()
      && realpathSync(parent) === parent
      && parentStat.uid === 0n && parentStat.gid === 0n
      && (parentStat.mode & 0o7777n) === 0o1777n,
    'SYSTEM effect temporary root is not the exact root-owned sticky boundary');
  } else {
    parentStat = lstatSync(parent, { bigint: true, throwIfNoEntry: false });
    assert(parentStat?.isDirectory() && !parentStat.isSymbolicLink()
      && realpathSync(parent) === parent
      && (parentStat.mode & 0o777n) === 0o700n,
    `${policy.rootMode} effect temporary parent is not one private directory`);
    if (policy.rootMode === 'STAGING') {
      assert(parentStat.uid === 0n, 'STAGING effect temporary parent is not root-owned');
    }
  }
  let parentDescriptor;
  let descriptor;
  let anchoredPath;
  try {
    parentDescriptor = openSync(
      parent,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const openedParent = fstatSync(parentDescriptor, { bigint: true });
    assert(openedParent.isDirectory()
      && openedParent.dev === parentStat.dev && openedParent.ino === parentStat.ino
      && openedParent.uid === parentStat.uid && openedParent.gid === parentStat.gid
      && openedParent.mode === parentStat.mode,
    'effect temporary parent changed while opening');
    anchoredPath = mkdtempSync(join(
      `/proc/self/fd/${parentDescriptor}`,
      `i00-bound-effect.${claimKey.slice(0, 16)}.`,
    ));
    const name = basename(anchoredPath);
    const path = join(parent, name);
    chmodSync(anchoredPath, 0o700);
    if (process.geteuid() === 0 && (uid !== 0 || gid !== 0)) {
      chownSync(anchoredPath, uid, gid);
    }
    const stat = lstatSync(anchoredPath, { bigint: true });
    descriptor = openSync(
      anchoredPath,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    const namedParent = lstatSync(parent, { bigint: true, throwIfNoEntry: false });
    assert(stat.isDirectory() && !stat.isSymbolicLink()
      && opened.dev === stat.dev && opened.ino === stat.ino
      && (stat.mode & 0o777n) === 0o700n
      && stat.uid === BigInt(uid) && stat.gid === BigInt(gid)
      && namedParent?.isDirectory() && !namedParent.isSymbolicLink()
      && namedParent.dev === openedParent.dev && namedParent.ino === openedParent.ino
      && realpathSync(parent) === parent && realpathSync(path) === path,
    'effect temporary directory identity is invalid');
    return Object.freeze({
      path,
      name,
      identity: privateDirectoryIdentityEndpoint(statIdentity(opened)),
      descriptor,
      parent,
      parentDescriptor,
      parentIdentity: privateDirectoryIdentityEndpoint(statIdentity(openedParent)),
    });
  } catch (error) {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } catch {}
    try {
      if (anchoredPath !== undefined) rmSync(anchoredPath, { recursive: true, force: false });
    } catch {}
    try {
      if (parentDescriptor !== undefined) closeSync(parentDescriptor);
    } catch {}
    throw error;
  }
}

function recheckEffectTemporaryDirectory(temporary) {
  const opened = fstatSync(temporary.descriptor, { bigint: true });
  const openedParent = fstatSync(temporary.parentDescriptor, { bigint: true });
  const anchored = `/proc/self/fd/${temporary.parentDescriptor}/${temporary.name}`;
  const named = lstatSync(anchored, { bigint: true, throwIfNoEntry: false });
  const namedParent = lstatSync(
    temporary.parent,
    { bigint: true, throwIfNoEntry: false },
  );
  assert(opened.isDirectory() && named?.isDirectory() && !named.isSymbolicLink()
    && opened.dev === named.dev && opened.ino === named.ino
    && privateDirectoryIdentityEndpoint(statIdentity(opened)) === temporary.identity
    && openedParent.isDirectory()
    && privateDirectoryIdentityEndpoint(statIdentity(openedParent))
      === temporary.parentIdentity
    && namedParent?.isDirectory() && !namedParent.isSymbolicLink()
    && namedParent.dev === openedParent.dev && namedParent.ino === openedParent.ino
    && realpathSync(temporary.parent) === temporary.parent
    && realpathSync(temporary.path) === temporary.path,
  'effect temporary directory identity changed');
}

function cleanupEffectTemporaryDirectory(temporary) {
  recheckEffectTemporaryDirectory(temporary);
  const anchored = `/proc/self/fd/${temporary.parentDescriptor}/${temporary.name}`;
  rmSync(anchored, { recursive: true, force: false });
  assert(lstatSync(anchored, { throwIfNoEntry: false }) === undefined,
    'effect temporary directory cleanup did not complete');
  closeSync(temporary.descriptor);
  closeSync(temporary.parentDescriptor);
}

function positionalRead(descriptor, size, label) {
  assert(Number.isSafeInteger(size) && size > 0 && size <= 1024 * 1024,
    `${label} size is invalid`);
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    assert(count > 0, `${label} descriptor ended early`);
    offset += count;
  }
  return bytes;
}

function evidenceIdentity(stat) {
  return Object.freeze({
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    mode: stat.mode.toString(),
    nlink: stat.nlink.toString(),
    uid: stat.uid.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  });
}

function openDocumentDescriptor(evidence, label) {
  let descriptor;
  try {
    descriptor = openSync(
      evidence.absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor, { bigint: true });
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n
      && (stat.mode & 0o777n) === 0o600n
      && sameJson(evidenceIdentity(stat), evidence.identity),
    `${label} inherited descriptor identity differs from the validated document`);
    const bytes = positionalRead(descriptor, Number(stat.size), label);
    assert(bytes.equals(evidence.bytes)
      && createHash('sha256').update(bytes).digest('hex') === evidence.sha256,
    `${label} inherited descriptor bytes differ from the validated document`);
    return Object.freeze({
      descriptor,
      evidence,
      binding: Object.freeze({
        path: evidence.absolute,
        sha256: evidence.sha256,
        identity: endpointFileIdentity(stat),
      }),
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function recheckDocumentDescriptor(held, label) {
  const stat = fstatSync(held.descriptor, { bigint: true });
  assert(stat.isFile() && stat.nlink === 1n
    && sameJson(evidenceIdentity(stat), held.evidence.identity),
  `${label} inherited descriptor identity changed`);
  const bytes = positionalRead(held.descriptor, Number(stat.size), label);
  assert(bytes.equals(held.evidence.bytes)
    && createHash('sha256').update(bytes).digest('hex') === held.evidence.sha256,
  `${label} inherited descriptor bytes changed`);
  recheckCanonicalDeploymentDocument(
    held.evidence,
    label,
    held.validate,
  );
}

function openBoundDescriptor(binding, label, {
  rootAncestorChain,
  executable = true,
} = {}) {
  const inspected = inspectBoundFile(binding.path, label, {
    executable,
    expectedSha256: binding.sha256,
    expectedIdentity: binding.identity,
    rootAncestorChain,
  });
  let descriptor;
  try {
    descriptor = openSync(
      inspected.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor, { bigint: true });
    assert(stat.isFile() && stat.nlink === 1n
      && (!executable || (stat.mode & 0o111n) !== 0n)
      && endpointFileIdentity(stat) === inspected.identity,
    `${label} inherited descriptor identity differs from the authorization binding`);
    const sha256 = hashOpenFile(descriptor, stat.size, label, MAX_BOUND_FILE_BYTES);
    const after = fstatSync(descriptor, { bigint: true });
    assert(endpointFileIdentity(after) === inspected.identity
      && sha256 === inspected.sha256,
      `${label} inherited descriptor digest differs from the authorization binding`);
    return Object.freeze({ descriptor, executable, ...inspected });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function recheckBoundDescriptor(held, label, rootAncestorChain) {
  const before = fstatSync(held.descriptor, { bigint: true });
  assert(before.isFile() && before.nlink === 1n
    && (!held.executable || (before.mode & 0o111n) !== 0n)
    && endpointFileIdentity(before) === held.identity,
  `${label} inherited descriptor identity changed`);
  const sha256 = hashOpenFile(
    held.descriptor,
    before.size,
    label,
    MAX_BOUND_FILE_BYTES,
  );
  const after = fstatSync(held.descriptor, { bigint: true });
  assert(endpointFileIdentity(after) === held.identity
    && sha256 === held.sha256,
    `${label} inherited descriptor digest changed`);
  inspectBoundFile(held.path, label, {
    executable: held.executable,
    expectedSha256: held.sha256,
    expectedIdentity: held.identity,
    expectedAncestors: held.ancestorChain,
    rootAncestorChain,
  });
}

function openDataDescriptor(path, label, expectedSha256) {
  assert(typeof path === 'string' && isAbsolute(path) && resolve(path) === path
    && realpathSync(path) === path,
  `${label} path is not one raw canonical absolute file`);
  const named = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  assert(named?.isFile() && !named.isSymbolicLink() && named.nlink === 1n
    && named.size > 0n && named.size <= 1024n * 1024n
    && (named.mode & 0o777n) === 0o600n
    && (named.uid === 0n || named.uid === BigInt(process.geteuid())),
  `${label} identity is unsafe`);
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor, { bigint: true });
    assert(endpointFileIdentity(stat) === endpointFileIdentity(named),
      `${label} changed before descriptor read`);
    const bytes = positionalRead(descriptor, Number(stat.size), label);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert(sha256 === expectedSha256,
      `${label} digest differs from the authorization binding`);
    return Object.freeze({
      descriptor,
      path,
      sha256,
      identity: endpointFileIdentity(stat),
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function recheckDataDescriptor(held, label) {
  const stat = fstatSync(held.descriptor, { bigint: true });
  assert(stat.isFile() && stat.nlink === 1n
    && endpointFileIdentity(stat) === held.identity,
  `${label} inherited descriptor identity changed`);
  const bytes = positionalRead(held.descriptor, Number(stat.size), label);
  assert(createHash('sha256').update(bytes).digest('hex') === held.sha256,
    `${label} inherited descriptor digest changed`);
  const named = lstatSync(held.path, { bigint: true, throwIfNoEntry: false });
  assert(named?.isFile() && !named.isSymbolicLink()
    && realpathSync(held.path) === held.path
    && endpointFileIdentity(named) === held.identity,
  `${label} named identity changed`);
}

function openDirectoryDescriptor(evidence, label) {
  let descriptor;
  try {
    descriptor = openSync(
      evidence.absolute,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor, { bigint: true });
    assert(stat.isDirectory()
      && privateDirectoryIdentityEndpoint(statIdentity(stat))
        === privateDirectoryIdentityEndpoint(evidence),
    `${label} descriptor identity differs from the producer binding`);
    return Object.freeze({ descriptor, evidence });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function recheckDirectoryDescriptor(held, label) {
  const stat = fstatSync(held.descriptor, { bigint: true });
  assert(stat.isDirectory()
    && privateDirectoryIdentityEndpoint(statIdentity(stat))
      === privateDirectoryIdentityEndpoint(held.evidence),
  `${label} descriptor identity changed`);
  const current = inspectPrivateDirectoryEvidence(held.evidence.absolute, label);
  assert(privateDirectoryIdentityEndpoint(current)
    === privateDirectoryIdentityEndpoint(held.evidence),
  `${label} named identity changed`);
}

function openWriteRootDescriptor(path, expectedIdentity, expectedOwnerUid, label) {
  assert(typeof path === 'string' && isAbsolute(path) && resolve(path) === path
    && realpathSync(path) === path,
  `${label} path is not one raw canonical directory`);
  const named = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  assert(named?.isDirectory() && !named.isSymbolicLink()
    && (named.mode & 0o022n) === 0n
    && (named.mode & 0o7000n) === 0n
    && (named.uid === 0n || named.uid === BigInt(expectedOwnerUid))
    && privateDirectoryIdentityEndpoint(statIdentity(named)) === expectedIdentity,
  `${label} identity differs from the authorization binding`);
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    assert(opened.isDirectory()
      && privateDirectoryIdentityEndpoint(statIdentity(opened)) === expectedIdentity,
    `${label} descriptor differs from the authorization binding`);
    return Object.freeze({
      descriptor,
      path,
      identity: expectedIdentity,
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function recheckWriteRootDescriptor(held, label) {
  const opened = fstatSync(held.descriptor, { bigint: true });
  const named = lstatSync(held.path, { bigint: true, throwIfNoEntry: false });
  assert(opened.isDirectory() && named?.isDirectory() && !named.isSymbolicLink()
    && privateDirectoryIdentityEndpoint(statIdentity(opened)) === held.identity
    && privateDirectoryIdentityEndpoint(statIdentity(named)) === held.identity
    && realpathSync(held.path) === held.path,
  `${label} identity changed`);
}

function inspectObservedRoot(path, expectedIdentity, expectedOwnerUid, label) {
  assert(typeof path === 'string' && isAbsolute(path) && resolve(path) === path
    && realpathSync(path) === path,
  `${label} path is not one raw canonical directory`);
  const named = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  assert(named?.isDirectory() && !named.isSymbolicLink()
    && (named.mode & 0o022n) === 0n
    && (named.mode & 0o7000n) === 0n
    && (named.uid === 0n || named.uid === BigInt(expectedOwnerUid))
    && privateDirectoryIdentityEndpoint(statIdentity(named)) === expectedIdentity,
  `${label} identity differs from the authorization binding`);
  return Object.freeze({ path, identity: expectedIdentity });
}

function recheckObservedRoot(observed, expectedOwnerUid, label) {
  inspectObservedRoot(
    observed.path,
    observed.identity,
    expectedOwnerUid,
    label,
  );
}

function readRootIdentity(stat, expectedIdentity) {
  if (/^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,uid=[0-9]+,gid=[0-9]+$/u
    .test(expectedIdentity)) {
    return privateDirectoryIdentityEndpoint(statIdentity(stat));
  }
  if (ENDPOINT_IDENTITY.test(expectedIdentity)) return endpointFileIdentity(stat);
  blocked('read root identity binding has an unsupported shape');
}

function hashOpenFile(
  descriptor,
  size,
  label,
  maximum = MAX_OPEN_FILE_BYTES,
  reject = blocked,
) {
  if (!(typeof size === 'bigint'
    && typeof maximum === 'bigint'
    && maximum > 0n
    && size >= 0n
    && size <= maximum)) {
    reject(`${label} size is outside the supported range`);
  }
  const numericSize = Number(size);
  if (!Number.isSafeInteger(numericSize)) {
    reject(`${label} size is not safely readable`);
  }
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  let offset = 0;
  while (offset < numericSize) {
    const wanted = Math.min(buffer.length, numericSize - offset);
    const count = readSync(descriptor, buffer, 0, wanted, offset);
    if (count <= 0) reject(`${label} ended before its retained size`);
    hash.update(buffer.subarray(0, count));
    offset += count;
  }
  return hash.digest('hex');
}

function backupSourceFile(rootDescriptor, name, maximum, { capture = false } = {}) {
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(name),
    'backup source member name is invalid');
  let descriptor;
  try {
    descriptor = openSync(
      `/proc/self/fd/${rootDescriptor}/${name}`,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor, { bigint: true });
    assert(stat.isFile() && stat.nlink === 1n
      && stat.size > 0n && stat.size <= BigInt(maximum),
    `backup source member ${name} is invalid`);
    const sha256 = hashOpenFile(descriptor, stat.size, `backup source member ${name}`);
    let bytes = null;
    if (capture) {
      bytes = Buffer.alloc(Number(stat.size));
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
        assert(count > 0, `backup source member ${name} ended early`);
        offset += count;
      }
    }
    return Object.freeze({ name, sha256, bytes: Number(stat.size), content: bytes });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function backupSourceTreeDigest(rootDescriptor) {
  const manifestFile = backupSourceFile(
    rootDescriptor,
    'manifest.json',
    1024 * 1024,
    { capture: true },
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.content);
  } catch {
    blocked('backup read root manifest is invalid JSON');
  }
  assert(Array.isArray(manifest.evidence), 'backup read root manifest evidence is invalid');
  const database = backupSourceFile(
    rootDescriptor,
    'cosmos.db',
    128 * 1024 * 1024 * 1024,
  );
  const records = [
    { name: 'cosmos.db', sha256: database.sha256, bytes: database.bytes },
    { name: 'manifest.json', sha256: manifestFile.sha256, bytes: manifestFile.bytes },
  ];
  let archiveNumber = 0;
  for (const item of manifest.evidence) {
    assert(item !== null && typeof item === 'object' && !Array.isArray(item),
      'backup read root manifest evidence entry is invalid');
    if (item.missing === true) continue;
    archiveNumber += 1;
    const name = `evidence-${archiveNumber}.tar.gz`;
    assert(item.archive === name, 'backup read root archive sequence is invalid');
    const archive = backupSourceFile(
      rootDescriptor,
      name,
      64 * 1024 * 1024 * 1024,
    );
    records.push({ name, sha256: archive.sha256, bytes: archive.bytes });
  }
  assert(sameJson(readdirSync(`/proc/self/fd/${rootDescriptor}`).sort(),
    records.map(({ name }) => name).sort()),
  'backup read root inventory is invalid');
  return createHash('sha256')
    .update('I00_BACKUP_SOURCE_TREE_V1\0')
    .update(JSON.stringify(records))
    .digest('hex');
}

function outputRequire(condition, message) {
  if (!condition) throw new Error(message);
}

function outputExactKeys(value, keys, label) {
  outputRequire(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'),
  `${label} has an unexpected field set`);
}

function outputIdentity(stat) {
  return [
    `device=${stat.dev}`,
    `inode=${stat.ino}`,
    `mode=${stat.mode.toString(8)}`,
    `uid=${stat.uid}`,
    `gid=${stat.gid}`,
  ].join(',');
}

function outputEntryIdentity(stat) {
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

function snapshotBackupWriteRoot(root) {
  outputRequire(process.platform === 'linux',
    'backup output inventory requires Linux descriptor paths');
  const verifyRoot = () => {
    const opened = fstatSync(root.held.descriptor, { bigint: true });
    const named = lstatSync(root.path, { bigint: true, throwIfNoEntry: false });
    outputRequire(opened.isDirectory()
      && named?.isDirectory() && !named.isSymbolicLink()
      && privateDirectoryIdentityEndpoint(statIdentity(opened)) === root.identity
      && privateDirectoryIdentityEndpoint(statIdentity(named)) === root.identity
      && realpathSync(root.path) === root.path,
    'backupDir capability identity changed');
  };
  verifyRoot();
  const anchoredRoot = `/proc/self/fd/${root.held.descriptor}`;
  const entries = readdirSync(anchoredRoot).sort().map((name) => {
    outputRequire(name.length > 0 && name !== '.' && name !== '..'
      && !name.includes('/') && !name.includes('\0'),
    'backup root contains an unsafe direct-child name');
    const stat = lstatSync(`${anchoredRoot}/${name}`, { bigint: true });
    return Object.freeze({ name, identity: outputEntryIdentity(stat) });
  });
  verifyRoot();
  return Object.freeze(entries);
}

function backupInventorySha256(entries) {
  return createHash('sha256')
    .update('I00_BACKUP_WRITE_ROOT_INVENTORY_V1\0')
    .update(canonicalJsonBytes(entries))
    .digest('hex');
}

function readBackupOutputFile(
  directoryDescriptor,
  namedDirectory,
  name,
  label,
  maximumBytes,
  expectedUid,
  expectedGid,
  { capture = false } = {},
) {
  outputRequire(typeof name === 'string' && name.length > 0
    && name !== '.' && name !== '..' && !name.startsWith('-')
    && !/[\\/\u0000-\u001f\u007f]/u.test(name),
  `${label} name is unsafe`);
  const anchored = `/proc/self/fd/${directoryDescriptor}/${name}`;
  const expectedPath = resolve(namedDirectory, name);
  let descriptor;
  try {
    const before = lstatSync(anchored, { bigint: true });
    outputRequire(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n
      && before.size > 0n && before.size <= BigInt(maximumBytes)
      && before.uid === BigInt(expectedUid) && before.gid === BigInt(expectedGid)
      && (before.mode & 0o022n) === 0n
      && realpathSync(anchored) === expectedPath,
    `${label} is not one exact bound regular file`);
    descriptor = openSync(
      anchored,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    outputRequire(sameJson(outputEntryIdentity(openedBefore), outputEntryIdentity(before)),
      `${label} changed before reading`);
    const hash = createHash('sha256');
    const chunks = [];
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < Number(openedBefore.size)) {
      const count = readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, Number(openedBefore.size) - offset),
        offset,
      );
      outputRequire(count > 0, `${label} ended before its retained size`);
      const chunk = buffer.subarray(0, count);
      hash.update(chunk);
      if (capture) chunks.push(Buffer.from(chunk));
      offset += count;
    }
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const after = lstatSync(anchored, { bigint: true });
    outputRequire(sameJson(outputEntryIdentity(openedAfter), outputEntryIdentity(openedBefore))
      && sameJson(outputEntryIdentity(after), outputEntryIdentity(openedAfter))
      && realpathSync(anchored) === expectedPath,
    `${label} changed while reading`);
    return Object.freeze({
      sha256: hash.digest('hex'),
      bytes: Number(openedAfter.size),
      ...(capture ? { content: Buffer.concat(chunks) } : {}),
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function inspectBoundBackupOutput({
  writeRoot,
  before,
  after,
  document,
  expectedUid,
  expectedGid,
}) {
  const beforeByName = new Map(before.map((entry) => [entry.name, entry]));
  const afterByName = new Map(after.map((entry) => [entry.name, entry]));
  const added = after.filter((entry) => !beforeByName.has(entry.name));
  outputRequire(added.length === 1
    && before.every((entry) => {
      const retained = afterByName.get(entry.name);
      return retained !== undefined && sameJson(retained, entry);
    })
    && after.length === before.length + 1,
  'backup root delta is not exactly one new direct child');
  const outputName = added[0].name;
  outputRequire(document.outputRelativePath === outputName
    && document.receiptRelativePath === `${outputName}/manifest.json`
    && BACKUP_NAME.test(outputName)
    && added[0].identity.kind === 'DIRECTORY',
  'backup output claim differs from the exact root delta');
  const anchored = `/proc/self/fd/${writeRoot.held.descriptor}/${outputName}`;
  const named = resolve(writeRoot.path, outputName);
  let directoryDescriptor;
  try {
    const beforeDirectory = lstatSync(anchored, { bigint: true });
    outputRequire(beforeDirectory.isDirectory() && !beforeDirectory.isSymbolicLink()
      && beforeDirectory.uid === BigInt(expectedUid)
      && beforeDirectory.gid === BigInt(expectedGid)
      && (beforeDirectory.mode & 0o022n) === 0n
      && realpathSync(anchored) === named,
    'backup output is not one exact no-follow direct-child directory');
    directoryDescriptor = openSync(
      anchored,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const openedBefore = fstatSync(directoryDescriptor, { bigint: true });
    outputRequire(sameJson(
      outputEntryIdentity(openedBefore),
      outputEntryIdentity(beforeDirectory),
    ), 'backup output changed while opening its retained capability');
    const namesBefore = readdirSync(`/proc/self/fd/${directoryDescriptor}`).sort();
    outputRequire(sameJson(namesBefore, ['cosmos.db', 'manifest.json']),
      'authorized backup output inventory is not database-only');
    const manifestEvidence = readBackupOutputFile(
      directoryDescriptor,
      named,
      'manifest.json',
      'backup output manifest',
      1024 * 1024,
      expectedUid,
      expectedGid,
      { capture: true },
    );
    let manifest;
    try {
      manifest = JSON.parse(manifestEvidence.content);
    } catch {
      throw new Error('backup output manifest is not valid JSON');
    }
    outputRequire(manifestEvidence.content.equals(canonicalJsonBytes(manifest)),
      'backup output manifest is not canonical JSON');
    outputExactKeys(manifest, [
      'backupId', 'createdAtUtc', 'dbFile', 'dbSha256', 'dbBytes',
      'eventsCount', 'dataSchema', 'integrityCheck', 'evidence',
    ], 'backup output manifest');
    outputRequire(manifest.backupId === outputName
      && typeof manifest.createdAtUtc === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(manifest.createdAtUtc)
      && Number.isFinite(Date.parse(manifest.createdAtUtc))
      && manifest.dbFile === 'cosmos.db'
      && DIGEST.test(manifest.dbSha256)
      && Number.isSafeInteger(manifest.dbBytes) && manifest.dbBytes > 0
      && Number.isSafeInteger(manifest.eventsCount) && manifest.eventsCount >= 0
      && (manifest.dataSchema === null
        || (Number.isSafeInteger(manifest.dataSchema) && manifest.dataSchema >= 0))
      && manifest.integrityCheck === 'ok'
      && sameJson(manifest.evidence, []),
    'backup output manifest does not describe one database-only artifact');
    const database = readBackupOutputFile(
      directoryDescriptor,
      named,
      'cosmos.db',
      'backup output database',
      128 * 1024 * 1024 * 1024,
      expectedUid,
      expectedGid,
    );
    outputRequire(database.sha256 === manifest.dbSha256
      && database.bytes === manifest.dbBytes,
    'backup output database differs from its manifest');
    const records = [
      { name: 'cosmos.db', sha256: database.sha256, bytes: database.bytes },
      {
        name: 'manifest.json',
        sha256: manifestEvidence.sha256,
        bytes: manifestEvidence.bytes,
      },
    ];
    const treeSha256 = createHash('sha256')
      .update('I00_BACKUP_SOURCE_TREE_V1\0')
      .update(JSON.stringify(records))
      .digest('hex');
    const namesAfter = readdirSync(`/proc/self/fd/${directoryDescriptor}`).sort();
    const openedAfter = fstatSync(directoryDescriptor, { bigint: true });
    const namedAfter = lstatSync(anchored, { bigint: true });
    outputRequire(sameJson(namesAfter, namesBefore)
      && sameJson(outputEntryIdentity(openedAfter), outputEntryIdentity(openedBefore))
      && sameJson(outputEntryIdentity(namedAfter), outputEntryIdentity(openedAfter))
      && realpathSync(anchored) === named,
    'backup output changed during complete verification');
    return Object.freeze({
      outputPath: named,
      outputRelativePath: outputName,
      outputIdentity: outputIdentity(openedAfter),
      outputTreeSha256: treeSha256,
      receiptRelativePath: document.receiptRelativePath,
      receiptSha256: manifestEvidence.sha256,
      databaseSha256: database.sha256,
      databaseBytes: database.bytes,
    });
  } finally {
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
  }
}

function publishEffectOutputEvidence(parent, path, document) {
  const bytes = authorizedEffectEvidenceBytes(document);
  outputRequire(bytes.length > 0 && bytes.length <= BACKUP_OUTPUT_MAX_BYTES,
    'authorized effect output evidence size is invalid');
  const current = inspectPrivateDirectoryEvidence(parent.absolute, 'effect evidence root');
  outputRequire(sameIdentity(current.identity, parent.identity),
    'effect evidence root identity changed before output publication');
  let parentDescriptor;
  let descriptor;
  let completed = false;
  try {
    parentDescriptor = openSync(
      parent.absolute,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const openedParent = fstatSync(parentDescriptor, { bigint: true });
    outputRequire(openedParent.isDirectory()
      && sameIdentity(statIdentity(openedParent), parent.identity),
    'effect evidence root descriptor changed before output publication');
    const anchored = `/proc/self/fd/${parentDescriptor}/${basename(path)}`;
    descriptor = openSync(
      anchored,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const opened = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    outputRequire(opened.isFile() && opened.nlink === 1n
      && (opened.mode & 0o777n) === 0o600n
      && opened.size === BigInt(bytes.length)
      && named?.isFile() && !named.isSymbolicLink()
      && named.dev === opened.dev && named.ino === opened.ino
      && realpathSync(path) === path,
    'authorized effect output evidence publication is not exact');
    fsyncSync(parentDescriptor);
    const published = Object.freeze({
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    completed = true;
    return published;
  } finally {
    if (!completed && descriptor !== undefined) {
      // Pre-completion failure after the exclusive create: remove only the output
      // evidence record this call itself created, so an aborted run leaves no
      // residue on the deterministic output-evidence pathname. A call that reaches
      // completion never enters this branch, so a COMPLETED record stays in place
      // and still collides on the O_EXCL create above.
      try {
        const residuePath = parentDescriptor === undefined
          ? path
          : `/proc/self/fd/${parentDescriptor}/${basename(path)}`;
        const residue = lstatSync(residuePath, { bigint: true, throwIfNoEntry: false });
        if (residue !== undefined && residue.isFile() && !residue.isSymbolicLink()
            && sameIdentity(
              statIdentity(residue),
              statIdentity(fstatSync(descriptor, { bigint: true })),
            )) {
          unlinkSync(residuePath);
        }
      } catch {
        // Residue removal is best effort and must never mask the original refusal.
      }
    }
    if (descriptor !== undefined) closeSync(descriptor);
    if (parentDescriptor !== undefined) closeSync(parentDescriptor);
  }
}

function typedReadRootTreeDigest(rootDescriptor) {
  const rootStat = fstatSync(rootDescriptor, { bigint: true });
  assert(rootStat.isDirectory(), 'typed read root descriptor is not a directory');
  const hash = createHash('sha256');
  const visit = (relative = '') => {
    const anchored = relative
      ? `/proc/self/fd/${rootDescriptor}/${relative}`
      : `/proc/self/fd/${rootDescriptor}`;
    const names = readdirSync(anchored).sort();
    for (const name of names) {
      assert(name !== '.' && name !== '..'
        && !name.includes('/') && !name.includes('\0'),
      'typed read root entry name is invalid');
      const next = relative ? `${relative}/${name}` : name;
      const childPath = `/proc/self/fd/${rootDescriptor}/${next}`;
      const stat = lstatSync(childPath, { bigint: true });
      assert(!stat.isSymbolicLink(), `typed read root contains a symlink: ${next}`);
      if (stat.isDirectory()) {
        hash.update('directory\0');
        hash.update(next);
        hash.update('\n');
        visit(next);
        continue;
      }
      assert(stat.isFile(), `typed read root entry is unsupported: ${next}`);
      const mode = stat.mode & 0o7777n;
      assert((mode & 0o7000n) === 0n,
        `typed read root file has unsafe special mode: ${next}`);
      const executableBits = mode & 0o111n;
      assert(executableBits === 0n || executableBits === 0o111n,
        `typed read root file has ambiguous executable mode: ${next}`);
      let descriptor;
      try {
        descriptor = openSync(
          childPath,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        const opened = fstatSync(descriptor, { bigint: true });
        assert(opened.isFile()
          && opened.dev === stat.dev && opened.ino === stat.ino
          && opened.size === stat.size && opened.mtimeNs === stat.mtimeNs
          && opened.ctimeNs === stat.ctimeNs,
        `typed read root file changed while opening: ${next}`);
        hash.update(next);
        hash.update('\0');
        hash.update(executableBits === 0o111n ? '100755' : '100644');
        hash.update('\0');
        hash.update(hashOpenFile(descriptor, opened.size, `typed read root file ${next}`));
        hash.update('\n');
        const final = fstatSync(descriptor, { bigint: true });
        assert(final.dev === opened.dev && final.ino === opened.ino
          && final.size === opened.size && final.mtimeNs === opened.mtimeNs
          && final.ctimeNs === opened.ctimeNs,
        `typed read root file changed while hashing: ${next}`);
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    }
  };
  visit();
  const finalRoot = fstatSync(rootDescriptor, { bigint: true });
  assert(finalRoot.dev === rootStat.dev && finalRoot.ino === rootStat.ino
    && finalRoot.mode === rootStat.mode && finalRoot.mtimeNs === rootStat.mtimeNs
    && finalRoot.ctimeNs === rootStat.ctimeNs,
  'typed read root changed while hashing');
  return hash.digest('hex');
}

function readRootTreeDigest(held) {
  if (held.treeKind === null) return null;
  if (held.treeKind === 'TYPED_TREE') {
    return typedReadRootTreeDigest(held.descriptor);
  }
  assert(held.treeKind === 'BACKUP_TREE', 'read root tree policy is invalid');
  return backupSourceTreeDigest(held.descriptor);
}

function openReadRootDescriptor(
  path,
  expectedIdentity,
  expectedTreeSha256,
  treeKind,
  expectedOwnerUid,
  label,
) {
  assert(typeof path === 'string' && isAbsolute(path) && resolve(path) === path
    && realpathSync(path) === path,
  `${label} path is not one raw canonical directory`);
  const named = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  assert(named?.isDirectory() && !named.isSymbolicLink()
    && (named.mode & 0o022n) === 0n
    && (named.mode & 0o7000n) === 0n
    && (named.uid === 0n || named.uid === BigInt(expectedOwnerUid))
    && readRootIdentity(named, expectedIdentity) === expectedIdentity,
  `${label} identity differs from the authorization binding`);
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    const held = Object.freeze({
      descriptor,
      path,
      identity: expectedIdentity,
      treeSha256: expectedTreeSha256,
      treeKind,
    });
    assert(opened.isDirectory()
      && readRootIdentity(opened, expectedIdentity) === expectedIdentity
      && readRootTreeDigest(held) === expectedTreeSha256,
    `${label} descriptor or tree differs from the authorization binding`);
    return held;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function recheckReadRootDescriptor(held, expectedOwnerUid, label) {
  const opened = fstatSync(held.descriptor, { bigint: true });
  const named = lstatSync(held.path, { bigint: true, throwIfNoEntry: false });
  assert(opened.isDirectory() && named?.isDirectory() && !named.isSymbolicLink()
    && readRootIdentity(opened, held.identity) === held.identity
    && readRootIdentity(named, held.identity) === held.identity
    && (named.uid === 0n || named.uid === BigInt(expectedOwnerUid))
    && realpathSync(held.path) === held.path
    && readRootTreeDigest(held) === held.treeSha256,
  `${label} identity or tree changed`);
}

const separator = process.argv.indexOf('--', 2);
if (separator < 0) blocked('effect runner requires -- before delegated arguments');
const controls = process.argv.slice(2, separator);
const delegated = process.argv.slice(separator + 1);
const requiredControls = Object.freeze([
  '--authorization',
  '--deployment-risk',
  '--action-preview',
  '--authorization-consumption',
]);
const values = new Map();
assert(controls.length === requiredControls.length * 2,
  'effect runner requires exactly four path-only controls');
for (let index = 0; index < controls.length; index += 2) {
  const name = controls[index];
  const value = controls[index + 1];
  if (name !== requiredControls[index / 2] || typeof value !== 'string'
      || !isAbsolute(value) || resolve(value) !== value) {
    blocked('effect runner control arguments are invalid');
  }
  if (values.has(name)) blocked(`duplicate effect runner argument ${name}`);
  values.set(name, value);
}
if (values.size !== requiredControls.length) {
  blocked('effect runner requires the complete exact authorization-chain control set');
}
assert(delegated.length > 0 && delegated.length <= 256
  && delegated.every((value) => (
    typeof value === 'string' && value.length > 0 && value.length <= 4_096
    && !value.includes('\0')
  )), 'delegated effect argv is invalid');

const chain = validateChainPaths(values);
const { authorization, risk, preview, consumption } = chain;
const action = risk.action;
const actionClass = risk.binding.actionClass;
assert(ACTION_CLASSES.has(actionClass), 'authorization action class is unsupported');
const firstHostRelease = actionClass === 'SERVICE_RELEASE_SWITCH'
  && action.allowedEndpoints.includes('recovery-target:NO_PRIOR_RELEASE_FIRST_HOST');
const automaticRollbackEnabled = actionClass === 'SERVICE_RELEASE_SWITCH'
  && !firstHostRelease;
assert(process.platform === 'linux',
  'authorized effect descriptor execution requires Linux');
const expectedUid = canonicalId(endpoint(action, 'effect-uid'), 'effect uid');
const expectedGid = canonicalId(endpoint(action, 'effect-gid'), 'effect gid');
assert(typeof process.geteuid === 'function' && typeof process.getegid === 'function',
  'effect runner identity is unavailable');
const currentUid = process.geteuid();
const currentGid = process.getegid();
assert(currentUid === 0 || (currentUid === expectedUid && currentGid === expectedGid),
  'runner identity cannot assume the authorization-bound effect identity');
const productionBinding = risk.artifactPolicy.rootMode !== 'TEST';
if (productionBinding) {
  assert(currentUid === 0 && currentGid === 0,
    'SYSTEM and STAGING effect runners require root');
}
const nodeBinding = Object.freeze({
  path: endpoint(action, 'node-path'),
  sha256: endpoint(action, 'node-sha256'),
  identity: endpoint(action, 'node-identity'),
});
assert(realpathSync(process.execPath) === nodeBinding.path,
  'runner Node path differs from the risk-bound Node executable');
if (productionBinding) {
  assert(nodeBinding.path === '/usr/bin/node',
    'SYSTEM and STAGING effect runners require fixed /usr/bin/node');
}
const runnerNode = inspectBoundFile(nodeBinding.path, 'runner Node executable', {
  executable: true,
  expectedSha256: nodeBinding.sha256,
  expectedIdentity: nodeBinding.identity,
  rootAncestorChain: productionBinding,
});
const runnerSource = inspectBoundFile(RUNNER_SOURCE, 'runner source', {
  executable: false,
  rootAncestorChain: productionBinding,
});
const program = openBoundDescriptor(Object.freeze({
  path: endpoint(action, 'effect-program-path'),
  sha256: endpoint(action, 'effect-program-sha256'),
  identity: endpoint(action, 'effect-program-identity'),
}), 'delegated effect program', {
  rootAncestorChain: productionBinding,
});
const programPrefix = actionClass === 'SECRET_MATERIALIZATION' ? 'node' : 'bash';
assert(program.path === endpoint(action, `${programPrefix}-path`)
  && program.sha256 === endpoint(action, `${programPrefix}-sha256`)
  && program.identity === endpoint(action, `${programPrefix}-identity`),
'delegated effect interpreter differs from its class-bound executable');
const delegatedScript = openBoundDescriptor(Object.freeze({
  path: endpoint(action, 'effect-script-path'),
  sha256: endpoint(action, 'effect-script-sha256'),
  identity: endpoint(action, 'effect-script-identity'),
}), 'delegated effect script', {
  rootAncestorChain: productionBinding,
});
assert(delegated[0] === delegatedScript.path,
  'delegated effect argv does not begin with the authorization-bound script');
const commonBinding = Object.freeze({
  path: endpoint(action, 'effect-common-path'),
  sha256: endpoint(action, 'effect-common-sha256'),
  identity: endpoint(action, 'effect-common-identity'),
});
const commonIsNone = Object.values(commonBinding).every((value) => value === 'NONE');
assert(commonIsNone || Object.values(commonBinding).every((value) => value !== 'NONE'),
  'delegated common binding must be completely present or absent');
const delegatedBootstrapDescriptor = commonIsNone
  ? null
  : openBoundDescriptor(commonBinding, 'delegated effect bootstrap', {
    rootAncestorChain: productionBinding,
    executable: false,
  });
const delegatedBootstrapKind = {
  OPS_BUNDLE_INSTALL: 'NONE',
  SERVICE_RELEASE_SWITCH: 'COMMON_SHELL',
  SERVICE_ROLLBACK: 'COMMON_SHELL',
  BACKUP_CREATE: 'COMMON_SHELL',
  ISOLATED_RESTORE: 'COMMON_SHELL',
  SECRET_MATERIALIZATION: 'VERIFIER_SOURCE',
}[actionClass];
assert(
  delegatedBootstrapKind === 'NONE'
    ? delegatedBootstrapDescriptor === null
    : delegatedBootstrapDescriptor !== null,
'delegated bootstrap binding differs from the class policy');
if (delegatedBootstrapKind === 'VERIFIER_SOURCE') {
  assert(delegatedBootstrapDescriptor.path
    === resolve(dirname(RUNNER_SOURCE), 'verify-authorized-effect-handoff.mjs'),
  'secret verifier bootstrap is not the canonical handoff verifier');
}
const verifierSourceDescriptor = delegatedBootstrapKind === 'VERIFIER_SOURCE'
  ? delegatedBootstrapDescriptor
  : (() => {
      const inspected = inspectBoundFile(
        resolve(dirname(RUNNER_SOURCE), 'verify-authorized-effect-handoff.mjs'),
        'authorized effect verifier source',
        {
          executable: false,
          rootAncestorChain: productionBinding,
        },
      );
      return openBoundDescriptor(Object.freeze({
        path: inspected.path,
        sha256: inspected.sha256,
        identity: inspected.identity,
      }), 'authorized effect verifier source', {
        executable: false,
        rootAncestorChain: productionBinding,
      });
    })();
const effectExecutables = Object.freeze(
  CLASS_EXECUTABLES[actionClass].map((name) => {
    const prefix = EXECUTABLE_ENDPOINT_PREFIXES[name] ?? name;
    const held = openBoundDescriptor(Object.freeze({
      path: endpoint(action, `${prefix}-path`),
      sha256: endpoint(action, `${prefix}-sha256`),
      identity: endpoint(action, `${prefix}-identity`),
    }), `delegated ${name} executable`, {
      rootAncestorChain: productionBinding,
    });
    return Object.freeze({
      name,
      fd: EXECUTABLE_SLOTS[name],
      held,
      binding: Object.freeze({
        path: held.path,
        sha256: held.sha256,
        identity: held.identity,
      }),
    });
  }).sort((left, right) => left.fd - right.fd),
);
const automaticRollbackDescriptor = automaticRollbackEnabled
  ? openBoundDescriptor(Object.freeze({
      path: endpoint(action, 'automatic-rollback-script-path'),
      sha256: endpoint(action, 'automatic-rollback-script-sha256'),
      identity: endpoint(action, 'automatic-rollback-script-identity'),
    }), 'automatic rollback script', {
      rootAncestorChain: productionBinding,
    })
  : null;
const automaticRollbackArgv = automaticRollbackDescriptor === null
  ? null
  : Object.freeze([
      '-p',
      '-c',
      `${automaticRollbackPrelude()}\nsource /proc/self/fd/13; source /proc/self/fd/35`,
      automaticRollbackDescriptor.path,
      '--auto',
      '--i00-effect-environment-fd',
      '12',
    ]);
const automaticRollbackNonce = automaticRollbackDescriptor === null
  ? null
  : randomBytes(32).toString('hex');
const helperPolicy = ['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK'].includes(actionClass)
  ? Object.freeze({
      exposure: Object.freeze({
        program: 'node',
        script: 'exposure',
        argvShape: 'NO_ARGS',
        timeoutMs: 3_000,
      }),
      alert: Object.freeze({
        program: 'bash',
        script: 'alert',
        argvShape: 'SEVERITY_CODE_MESSAGE',
        timeoutMs: 5_000,
      }),
    })
  : 'NONE';
for (const [prefix, expected] of [
  ['exposure-helper-argv-shape', 'NO_ARGS'],
  ['exposure-helper-timeout-ms', '3000'],
  ['alert-helper-argv-shape', 'SEVERITY_CODE_MESSAGE'],
  ['alert-helper-timeout-ms', '5000'],
]) {
  if (['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK'].includes(actionClass)) {
    assert(endpoint(action, prefix) === expected,
      `${prefix} differs from the fixed helper policy`);
  }
}
let delegatedEnvironmentDescriptor = null;
let delegatedEnvironmentKind = 'NONE';
if (['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK', 'BACKUP_CREATE', 'ISOLATED_RESTORE']
  .includes(actionClass)) {
  assert(delegated.length === 3
    && delegated[1] === '--i00-effect-environment'
    && isAbsolute(delegated[2])
    && resolve(delegated[2]) === delegated[2],
  'env-bearing effect requires one exact delegated environment path');
  const environmentProfile = ['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK']
    .includes(actionClass) ? 'deploy' : 'backup';
  const environmentPath = delegated[2];
  if (risk.artifactPolicy.rootMode === 'STAGING'
      || risk.artifactPolicy.rootMode === 'TEST') {
    assert(environmentPath
      === `${risk.artifactPolicy.proofRoot}/sanitized/${environmentProfile}.env`,
    `${risk.artifactPolicy.rootMode} delegated environment path is not exact`);
  } else {
    const family = {
      SERVICE_RELEASE_SWITCH: 'release-switch',
      SERVICE_ROLLBACK: 'rollback-switch',
      BACKUP_CREATE: 'backup-verify',
      ISOLATED_RESTORE: 'restore-verify',
    }[actionClass];
    assert(new RegExp(
      `^/tmp/i00-${family}\\.[A-Za-z0-9_-]{1,128}/${environmentProfile}\\.env$`,
      'u',
    ).test(environmentPath),
    'SYSTEM delegated environment path is outside its exact transient family');
  }
  delegatedEnvironmentDescriptor = openDataDescriptor(
    environmentPath,
    'delegated effect environment',
    endpoint(action, 'effect-environment-sha256'),
  );
  delegatedEnvironmentKind = 'SANITIZED_ENV';
  assert(endpoint(action, 'effect-environment-fd-token') === '/proc/self/fd/12',
    'delegated environment descriptor token differs from the fixed contract');
} else if (actionClass === 'SECRET_MATERIALIZATION') {
  assert(delegated.length === 1,
    'secret effect rejects caller-selected delegated arguments');
  delegatedEnvironmentDescriptor = openDataDescriptor(
    endpoint(action, 'provider-config-path'),
    'delegated provider configuration',
    endpoint(action, 'provider-config-sha256'),
  );
  assert(delegatedEnvironmentDescriptor.identity
    === endpoint(action, 'provider-config-identity'),
  'delegated provider configuration identity differs from the authorization binding');
  delegatedEnvironmentKind = 'PROVIDER_CONFIG';
} else {
  assert(delegated.length === 1,
    'non-environment effect rejects caller-selected delegated arguments');
}
const scriptToken = '/proc/self/fd/11';
const parentPrelude = primaryParentPrelude();
const bashBootstrap = delegatedBootstrapDescriptor === null
  ? `${parentPrelude}\nsource /proc/self/fd/11`
  : `${parentPrelude}\nsource /proc/self/fd/13; source /proc/self/fd/11`;
const delegatedForChildBuilders = Object.freeze({
  OPS_BUNDLE_INSTALL: () => [
    '-p', '-c', bashBootstrap, delegatedScript.path,
    '--authorized-effect',
    '--release', endpoint(action, 'release-path'),
    '--destination', endpoint(action, 'destination'),
  ],
  SERVICE_RELEASE_SWITCH: () => [
    '-p', '-c', bashBootstrap, delegatedScript.path,
    '--i00-effect-environment-fd', '12',
    '--release', endpoint(action, 'release-path'),
  ],
  SERVICE_ROLLBACK: () => [
    '-p', '-c', bashBootstrap, delegatedScript.path,
    '--i00-effect-environment-fd', '12',
    '--to', endpoint(action, 'release-id'),
  ],
  BACKUP_CREATE: () => [
    '-p', '-c', bashBootstrap, delegatedScript.path,
    '--i00-effect-environment-fd', '12',
  ],
  ISOLATED_RESTORE: () => [
    '-p', '-c', bashBootstrap, delegatedScript.path,
    '--i00-effect-environment-fd', '12',
    '--backup', endpoint(action, 'backup-path'),
    '--target', endpoint(action, 'isolated-target'),
  ],
  SECRET_MATERIALIZATION: () => [
    scriptToken,
    '--authorized-effect',
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
const delegatedForChild = Object.freeze(
  delegatedForChildBuilders[actionClass](),
);
assert(actionClass !== 'SECRET_MATERIALIZATION'
  || risk.artifactPolicy.rootMode !== 'STAGING',
'STAGING secret materialization is evidence-only and cannot execute');
assert(Array.isArray(delegatedForChild)
  && delegatedForChild.every((value) => (
    typeof value === 'string' && value.length > 0 && value.length <= 4_096
    && !value.includes('\0')
  )),
'class-derived effect argv is invalid');
const authorizationExpiresAtUtc = authorization.expiresAtUtc;
const evidenceValidUntilUtc = risk.evidenceValidUntilUtc;
const authorizationExpiresMs = exactUtc(
  authorizationExpiresAtUtc,
  'authorization expiry',
);
const evidenceValidUntilMs = exactUtc(evidenceValidUntilUtc, 'evidence horizon');
const receiptReserveSeconds = action.receiptPublicationReserveSeconds;
assert(Number.isSafeInteger(receiptReserveSeconds)
  && receiptReserveSeconds >= 1 && receiptReserveSeconds <= 3_600,
'receipt publication reserve is invalid');
const completionDeadlineMs = authorizationExpiresMs - (receiptReserveSeconds * 1_000);
const completionReserveSeconds = action.completionReserveSeconds;
assert(Number.isSafeInteger(completionReserveSeconds)
  && completionReserveSeconds >= receiptReserveSeconds
  && completionReserveSeconds <= 3_600,
'effect completion reserve is invalid');
assert(Number.isSafeInteger(completionDeadlineMs) && Date.now() < completionDeadlineMs,
  'effect completion deadline is not active');
assert(Date.now() + (completionReserveSeconds * 1_000) < authorizationExpiresMs,
  'effect completion reserve is not active');
assert(Date.now() < evidenceValidUntilMs,
  'mutable evidence horizon is no longer active');

const startEvidencePath = endpoint(action, 'effect-start-evidence');
const finishEvidencePath = endpoint(action, 'effect-finish-evidence');
const outputEvidencePath = actionClass === 'BACKUP_CREATE'
  ? startEvidencePath.replace(/[.]start[.]json$/u, '.output.json')
  : null;
assert(startEvidencePath !== finishEvidencePath
  && dirname(startEvidencePath) === dirname(finishEvidencePath)
  && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/u.test(basename(startEvidencePath))
  && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/u.test(basename(finishEvidencePath)),
'effect evidence paths must be distinct direct-child JSON paths');
assert(actionClass !== 'BACKUP_CREATE' || (
  outputEvidencePath !== startEvidencePath
  && outputEvidencePath !== finishEvidencePath
  && dirname(outputEvidencePath) === dirname(startEvidencePath)
  && basename(finishEvidencePath)
    === `${basename(startEvidencePath).replace(/[.]start[.]json$/u, '')}.terminal.json`
), 'backup output evidence path is not the deterministic effect sibling');
const evidenceParent = inspectEvidenceParent(
  startEvidencePath,
  risk.artifactPolicy.effectEvidenceRoot,
  risk.artifactPolicy.effectEvidenceRootIdentity,
);
inspectEvidenceParent(
  finishEvidencePath,
  risk.artifactPolicy.effectEvidenceRoot,
  risk.artifactPolicy.effectEvidenceRootIdentity,
);
assert(lstatSync(startEvidencePath, { throwIfNoEntry: false }) === undefined
  && lstatSync(finishEvidencePath, { throwIfNoEntry: false }) === undefined
  && (outputEvidencePath === null
    || lstatSync(outputEvidencePath, { throwIfNoEntry: false }) === undefined),
'effect evidence paths must both be absent');

recheckChain(chain);
recheckBoundDescriptor(program, 'delegated effect program', productionBinding);
recheckBoundDescriptor(delegatedScript, 'delegated effect script', productionBinding);
inspectBoundFile(runnerNode.path, 'runner Node executable', {
  executable: true,
  expectedSha256: runnerNode.sha256,
  expectedIdentity: runnerNode.identity,
  expectedAncestors: runnerNode.ancestorChain,
  rootAncestorChain: productionBinding,
});
if (Date.now() >= evidenceValidUntilMs || Date.now() >= completionDeadlineMs) {
  blocked('effect start boundary expired during final identity recheck');
}
const effectStartedAtUtc = currentUtcSecond();
assert(Date.parse(effectStartedAtUtc) < evidenceValidUntilMs
  && Date.parse(effectStartedAtUtc) < completionDeadlineMs,
'actual effect start is outside the active bounded window');
let effectDirectory;
if (actionClass === 'SECRET_MATERIALIZATION') {
  const credentialOutput = endpoint(action, 'credential-output-path');
  const outputParent = inspectPrivateDirectoryEvidence(
    dirname(credentialOutput),
    'credential output parent',
  );
  assert(outputParent.absolute === endpoint(action, 'credential-output-parent-path')
    && privateDirectoryIdentityEndpoint(outputParent)
      === endpoint(action, 'credential-output-parent-identity')
    && lstatSync(credentialOutput, { throwIfNoEntry: false }) === undefined,
  'credential output parent or closed leaf differs from the authorization binding');
  const held = openDirectoryDescriptor(outputParent, 'credential output parent');
  effectDirectory = Object.freeze({
    kind: 'CREDENTIAL_OUTPUT_PARENT',
    path: outputParent.absolute,
    identity: privateDirectoryIdentityEndpoint(outputParent),
    descriptor: held.descriptor,
    evidence: held.evidence,
  });
} else {
  effectDirectory = Object.freeze({
    kind: 'CLAIM_TEMPORARY_DIRECTORY',
    ...createEffectTemporaryDirectory(
      risk.artifactPolicy,
      consumption.claimKey,
      expectedUid,
      expectedGid,
    ),
  });
}
const writeRoots = Object.freeze(CLASS_WRITE_ROOTS[actionClass]
  .filter(([name]) => !(firstHostRelease && name === 'rollbackEvidenceRoot'))
  .map(([name, prefix]) => {
  const pathEndpoint = prefix === 'data-dir'
    ? 'data-dir-path'
    : (['backup-dir', 'rollback-evidence-root'].includes(prefix)
        ? prefix
        : `${prefix}-path`);
  const path = endpoint(action, pathEndpoint);
  const identity = endpoint(action, `${prefix}-identity`);
  const held = openWriteRootDescriptor(
    path,
    identity,
    expectedUid,
    `${name} capability`,
  );
  return Object.freeze({
    name,
    fd: WRITE_ROOT_SLOTS[name],
    path,
    identity,
    held,
  });
}).sort((left, right) => left.fd - right.fd));
const readRoots = Object.freeze(
  CLASS_READ_ROOTS[actionClass].map(([name, prefix, treeKind]) => {
    const path = prefix === 'data-dir'
      ? endpoint(action, 'data-dir-path')
      : endpoint(action, `${prefix}-path`);
    const identity = endpoint(action, `${prefix}-identity`);
    const treeSha256 = treeKind === null
      ? null
      : endpoint(action, `${prefix}-tree-sha256`);
    const held = openReadRootDescriptor(
      path,
      identity,
      treeSha256,
      treeKind,
      expectedUid,
      `${name} read root`,
    );
    return Object.freeze({
      name,
      fd: READ_ROOT_SLOTS[name],
      path,
      identity,
      treeSha256,
      held,
    });
  }).sort((left, right) => left.fd - right.fd),
);
const automaticRollbackReadRoots = automaticRollbackEnabled
  ? Object.freeze([
      (() => {
        const path = endpoint(action, 'current-release-path');
        const identity = endpoint(action, 'current-release-identity');
        const treeSha256 = endpoint(action, 'current-release-tree-sha256');
        const held = openReadRootDescriptor(
          path,
          identity,
          treeSha256,
          'TYPED_TREE',
          expectedUid,
          'automatic rollback source read root',
        );
        return Object.freeze({
          name: 'automaticRollbackSource',
          fd: READ_ROOT_SLOTS.automaticRollbackSource,
          path,
          identity,
          treeSha256,
          held,
        });
      })(),
    ])
  : Object.freeze([]);
const observedRoots = Object.freeze(
  CLASS_OBSERVED_ROOTS[actionClass].map(([name, prefix]) => {
    const path = prefix === 'backup-dir'
      ? endpoint(action, 'backup-dir')
      : endpoint(action, `${prefix}-path`);
    const identity = endpoint(action, `${prefix}-identity`);
    return Object.freeze({
      name,
      ...inspectObservedRoot(
        path,
        identity,
        expectedUid,
        `${name} observed root`,
      ),
    });
  }),
);
const backupWriteRoot = actionClass === 'BACKUP_CREATE'
  ? writeRoots.find(({ name }) => name === 'backupDir')
  : null;
assert(actionClass !== 'BACKUP_CREATE' || backupWriteRoot !== undefined,
  'backup effect lacks its retained output root');
let backupInventoryBefore = null;
if (backupWriteRoot !== null) {
  try {
    backupInventoryBefore = snapshotBackupWriteRoot(backupWriteRoot);
  } catch {
    blocked('backup output root cannot be inventoried before the effect');
  }
}
const effectOutputPolicy = actionClass === 'BACKUP_CREATE'
  ? Object.freeze({
      status: 'ARMED',
      fd: BACKUP_OUTPUT_FD,
      schemaVersion: 1,
      kind: 'I00_AUTHORIZED_EFFECT_OUTPUT',
      maxBytes: BACKUP_OUTPUT_MAX_BYTES,
    })
  : Object.freeze({});
const commonEvidence = Object.freeze({
  actionClass,
  authorizationId: authorization.authorizationId,
  claimKey: consumption.claimKey,
  consumptionSha256: chain.consumptionEvidence.sha256,
  riskVersion: risk.riskVersion,
  serverPreviewDigest: preview.serverPreviewDigest,
  effectUid: String(expectedUid),
  effectGid: String(expectedGid),
  program: Object.freeze({
    path: program.path,
    sha256: program.sha256,
    identity: program.identity,
  }),
  verifier: Object.freeze({
    path: verifierSourceDescriptor.path,
    sha256: verifierSourceDescriptor.sha256,
    identity: verifierSourceDescriptor.identity,
  }),
  delegatedScript: Object.freeze({
    path: delegatedScript.path,
    sha256: delegatedScript.sha256,
    identity: delegatedScript.identity,
  }),
  delegatedBootstrap: delegatedBootstrapDescriptor === null
    ? 'NONE'
    : Object.freeze({
      kind: delegatedBootstrapKind,
      binding: Object.freeze({
        path: delegatedBootstrapDescriptor.path,
        sha256: delegatedBootstrapDescriptor.sha256,
        identity: delegatedBootstrapDescriptor.identity,
      }),
    }),
  delegatedEnvironment: delegatedEnvironmentDescriptor === null
    ? 'NONE'
    : Object.freeze({
      kind: delegatedEnvironmentKind,
      binding: Object.freeze({
        path: delegatedEnvironmentDescriptor.path,
        sha256: delegatedEnvironmentDescriptor.sha256,
        identity: delegatedEnvironmentDescriptor.identity,
      }),
    }),
  effectExecutables: Object.freeze(effectExecutables.map(({ name, fd, binding }) => (
    Object.freeze({ name, fd, binding })
  ))),
  delegatedArgv: delegatedForChild,
  effectDirectory: Object.freeze({
    kind: effectDirectory.kind,
    path: effectDirectory.path,
    identity: effectDirectory.identity,
  }),
  helperPolicy,
  automaticRollback: automaticRollbackDescriptor === null
    ? Object.freeze({})
    : Object.freeze({
      status: 'ARMED',
      handoffNonce: automaticRollbackNonce,
      script: Object.freeze({
        path: automaticRollbackDescriptor.path,
        sha256: automaticRollbackDescriptor.sha256,
        identity: automaticRollbackDescriptor.identity,
      }),
      delegatedArgv: automaticRollbackArgv,
      recovery: action.rollback,
      scriptFd: 35,
      handoffFd: 36,
      acknowledgementFd: 37,
    }),
  writeRoots: Object.freeze(writeRoots.map(({ name, fd, path, identity }) => (
    Object.freeze({ name, fd, path, identity })
  ))),
  readRoots: Object.freeze(readRoots.map(({
    name, fd, path, identity, treeSha256,
  }) => Object.freeze({
    name, fd, path, identity, treeSha256,
  }))),
  observedRoots,
  effectOutputPolicy,
  authorizationExpiresAtUtc,
  evidenceValidUntilUtc,
  receiptPublicationReserveSeconds: receiptReserveSeconds,
  startEvidencePath,
  finishEvidencePath,
});
const startDocument = Object.freeze({
  schemaVersion: 1,
  kind: 'AUTHORIZED_EFFECT_START',
  status: 'AUTHORIZED_EFFECT_STARTED',
  ...commonEvidence,
  effectStartedAtUtc,
});
validateAuthorizedEffectStart(startDocument);
const startEvidence = writeEvidence(
  evidenceParent,
  startEvidencePath,
  startDocument,
  'authorized effect start evidence',
);

const documentDescriptors = Object.freeze([
  Object.freeze({
    ...openDocumentDescriptor(chain.authorizationEvidence, 'external authorization'),
    validate: (document) => validateExternalAuthorization(
      document,
      chain.risk,
      chain.preview,
    ),
  }),
  Object.freeze({
    ...openDocumentDescriptor(chain.riskEvidence, 'deployment risk version'),
    validate: validateDeploymentRiskVersion,
  }),
  Object.freeze({
    ...openDocumentDescriptor(chain.previewEvidence, 'deployment action preview'),
    validate: (document) => validateDeploymentActionPreview(
      document,
      chain.risk,
      chain.riskEvidence.sha256,
    ),
  }),
  Object.freeze({
    ...openDocumentDescriptor(chain.consumptionEvidence, 'authorization consumption'),
    validate: validateAuthorizationConsumption,
  }),
]);
const consumptionRootDescriptor = openDirectoryDescriptor(
  inspectPrivateDirectoryEvidence(
    risk.artifactPolicy.consumptionRoot,
    'authorization consumption root',
  ),
  'authorization consumption root',
);
let startEvidenceDescriptor;
try {
  startEvidenceDescriptor = openSync(
    startEvidencePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  const startStat = fstatSync(startEvidenceDescriptor, { bigint: true });
  assert(startStat.isFile() && startStat.nlink === 1n
    && (startStat.mode & 0o777n) === 0o600n
    && startStat.uid === BigInt(currentUid)
    && createHash('sha256').update(
      positionalRead(
        startEvidenceDescriptor,
        Number(startStat.size),
        'authorized effect start evidence',
      ),
    ).digest('hex') === startEvidence.sha256,
  'authorized effect start descriptor differs from durable evidence');
} catch (error) {
  if (startEvidenceDescriptor !== undefined) closeSync(startEvidenceDescriptor);
  throw error;
}

const handoffDocument = Object.freeze({
  schemaVersion: 1,
  kind: 'AUTHORIZED_EFFECT_HANDOFF',
  status: 'ACTIVE_BOUND_EFFECT',
  handoffNonce: randomBytes(32).toString('hex'),
  actionClass,
  authorizationId: authorization.authorizationId,
  claimKey: consumption.claimKey,
  consumptionSha256: chain.consumptionEvidence.sha256,
  riskVersion: risk.riskVersion,
  serverPreviewDigest: preview.serverPreviewDigest,
  authorizationExpiresAtUtc,
  evidenceValidUntilUtc,
  receiptPublicationReserveSeconds: receiptReserveSeconds,
  effectUid: String(expectedUid),
  effectGid: String(expectedGid),
  program: Object.freeze({
    path: program.path,
    sha256: program.sha256,
    identity: program.identity,
  }),
  verifier: commonEvidence.verifier,
  delegatedScript: Object.freeze({
    path: delegatedScript.path,
    sha256: delegatedScript.sha256,
    identity: delegatedScript.identity,
  }),
  delegatedBootstrap: delegatedBootstrapDescriptor === null
    ? 'NONE'
    : Object.freeze({
      kind: delegatedBootstrapKind,
      binding: Object.freeze({
        path: delegatedBootstrapDescriptor.path,
        sha256: delegatedBootstrapDescriptor.sha256,
        identity: delegatedBootstrapDescriptor.identity,
      }),
    }),
  delegatedEnvironment: delegatedEnvironmentDescriptor === null
    ? 'NONE'
    : Object.freeze({
      kind: delegatedEnvironmentKind,
      binding: Object.freeze({
        path: delegatedEnvironmentDescriptor.path,
        sha256: delegatedEnvironmentDescriptor.sha256,
        identity: delegatedEnvironmentDescriptor.identity,
      }),
    }),
  effectExecutables: Object.freeze(effectExecutables.map(({ name, fd, binding }) => (
    Object.freeze({ name, fd, binding })
  ))),
  delegatedArgv: delegatedForChild,
  authorizationChain: Object.freeze({
    authorization: documentDescriptors[0].binding,
    deploymentRisk: documentDescriptors[1].binding,
    actionPreview: documentDescriptors[2].binding,
    authorizationConsumption: documentDescriptors[3].binding,
    consumptionRoot: Object.freeze({
      path: consumptionRootDescriptor.evidence.absolute,
      identity: privateDirectoryIdentityEndpoint(consumptionRootDescriptor.evidence),
    }),
  }),
  startEvidencePath,
  startEvidenceSha256: startEvidence.sha256,
  effectStartedAtUtc,
  effectDirectory: Object.freeze({
    kind: effectDirectory.kind,
    path: effectDirectory.path,
    identity: effectDirectory.identity,
  }),
  helperPolicy,
  automaticRollback: commonEvidence.automaticRollback,
  writeRoots: commonEvidence.writeRoots,
  readRoots: commonEvidence.readRoots,
  observedRoots: commonEvidence.observedRoots,
  effectOutput: commonEvidence.effectOutputPolicy,
  runner: Object.freeze({
    pid: process.pid,
    node: Object.freeze({
      path: runnerNode.path,
      sha256: runnerNode.sha256,
      identity: runnerNode.identity,
    }),
    source: Object.freeze({
      path: runnerSource.path,
      sha256: runnerSource.sha256,
      identity: runnerSource.identity,
    }),
  }),
});
const handoffBytes = canonicalJsonBytes(handoffDocument);
assert(handoffBytes.length <= 65_536,
  'authorized effect handoff exceeds the fixed size limit');
const handoffSha256 = createHash('sha256').update(handoffBytes).digest('hex');
const expectedAck =
  `AUTHORIZED_EFFECT_HANDOFF_ACCEPTED:sha256:${handoffSha256}\n`;
let handoffDescriptor = createAnonymousHandoff(
  handoffBytes,
  risk.artifactPolicy.rootMode === 'SYSTEM'
    ? '/tmp'
    : `${risk.artifactPolicy.proofRoot}/tmp`,
);
const automaticRollbackHandoffDocument = automaticRollbackDescriptor === null
  ? null
  : Object.freeze({
      schemaVersion: 1,
      kind: 'AUTHORIZED_AUTOMATIC_ROLLBACK_HANDOFF',
      status: 'ARMED_BOUND_RECOVERY',
      handoffNonce: automaticRollbackNonce,
      primaryHandoffNonce: handoffDocument.handoffNonce,
      actionClass,
      authorizationId: authorization.authorizationId,
      claimKey: consumption.claimKey,
      consumptionSha256: chain.consumptionEvidence.sha256,
      riskVersion: risk.riskVersion,
      serverPreviewDigest: preview.serverPreviewDigest,
      authorizationExpiresAtUtc,
      evidenceValidUntilUtc,
      receiptPublicationReserveSeconds: receiptReserveSeconds,
      effectUid: String(expectedUid),
      effectGid: String(expectedGid),
      recovery: action.rollback,
      program: commonEvidence.program,
      verifier: commonEvidence.verifier,
      delegatedScript: commonEvidence.automaticRollback.script,
      delegatedBootstrap: commonEvidence.delegatedBootstrap,
      delegatedEnvironment: commonEvidence.delegatedEnvironment,
      effectExecutables: commonEvidence.effectExecutables,
      delegatedArgv: automaticRollbackArgv,
      effectDirectory: commonEvidence.effectDirectory,
      helperPolicy,
      writeRoots: commonEvidence.writeRoots,
      readRoots: Object.freeze(automaticRollbackReadRoots.map(({
        name, fd, path, identity, treeSha256,
      }) => Object.freeze({
        name, fd, path, identity, treeSha256,
      }))),
      observedRoots: commonEvidence.observedRoots,
      authorizationChain: handoffDocument.authorizationChain,
      startEvidencePath,
      startEvidenceSha256: startEvidence.sha256,
      effectStartedAtUtc,
      runner: handoffDocument.runner,
    });
const automaticRollbackHandoffBytes = automaticRollbackHandoffDocument === null
  ? null
  : canonicalJsonBytes(automaticRollbackHandoffDocument);
assert(automaticRollbackHandoffBytes === null
  || automaticRollbackHandoffBytes.length <= 65_536,
'automatic rollback handoff exceeds the fixed size limit');
const automaticRollbackExpectedAck = automaticRollbackHandoffBytes === null
  ? null
  : `AUTHORIZED_AUTOMATIC_ROLLBACK_HANDOFF_ACCEPTED:sha256:${
      createHash('sha256').update(automaticRollbackHandoffBytes).digest('hex')
    }\n`;
let automaticRollbackHandoffDescriptor = automaticRollbackHandoffBytes === null
  ? null
  : createAnonymousHandoff(
      automaticRollbackHandoffBytes,
      risk.artifactPolicy.rootMode === 'SYSTEM'
        ? '/tmp'
        : `${risk.artifactPolicy.proofRoot}/tmp`,
    );

let child;
let ackBytes = '';
let ackOverflow = false;
let effectOutputBytes = Buffer.alloc(0);
let effectOutputOverflow = false;
let automaticRollbackAckBytes = '';
let automaticRollbackAckOverflow = false;
let fixedNullCapabilityDescriptor;
let fixedNullCapabilityClosed = true;
try {
  const childEnv = {
    HOME: '/',
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: '/proc/self/fd/15',
    TZ: 'UTC',
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
    I00_AUTHORIZED_EFFECT_ROOT_MODE: risk.artifactPolicy.rootMode,
    I00_AUTHORIZED_EFFECT_RUNNER_PATH: runnerSource.path,
    I00_AUTHORIZED_EFFECT_RUNNER_NODE_PATH: runnerNode.path,
    I00_AUTHORIZED_EFFECT_PROGRAM_PATH: program.path,
  };
  if (actionClass === 'BACKUP_CREATE') {
    childEnv.I00_AUTHORIZED_EFFECT_OUTPUT_FD = String(BACKUP_OUTPUT_FD);
  }
  if (actionClass !== 'SECRET_MATERIALIZATION') {
    childEnv.I00_AUTHORIZED_EFFECT_VERIFIER_FD = '38';
  }
  if (automaticRollbackDescriptor !== null) {
    childEnv.I00_AUTHORIZED_ROLLBACK_SCRIPT_FD = '35';
    childEnv.I00_AUTHORIZED_ROLLBACK_HANDOFF_FD = '36';
    childEnv.I00_AUTHORIZED_ROLLBACK_ACK_FD = '37';
    childEnv.I00_AUTHORIZED_ROLLBACK_SCRIPT_PATH = automaticRollbackDescriptor.path;
  }
  for (const executable of effectExecutables) {
    childEnv[executableLocator(executable.name)] = String(executable.fd);
  }
  for (const root of writeRoots) {
    childEnv[writeRootLocator(root.name)] = String(root.fd);
  }
  for (const root of [...readRoots, ...automaticRollbackReadRoots]) {
    childEnv[readRootLocator(root.name)] = String(root.fd);
  }
  fixedNullCapabilityDescriptor = openFixedNullCapability();
  fixedNullCapabilityClosed = false;
  const childStdio = [
    'inherit',
    'inherit',
    'inherit',
    handoffDescriptor,
    'pipe',
    documentDescriptors[0].descriptor,
    documentDescriptors[1].descriptor,
    documentDescriptors[2].descriptor,
    documentDescriptors[3].descriptor,
    consumptionRootDescriptor.descriptor,
    startEvidenceDescriptor,
    delegatedScript.descriptor,
    delegatedEnvironmentDescriptor === null
      ? fixedNullCapabilityDescriptor
      : delegatedEnvironmentDescriptor.descriptor,
    delegatedBootstrapDescriptor === null
      ? fixedNullCapabilityDescriptor
      : delegatedBootstrapDescriptor.descriptor,
    program.descriptor,
    effectDirectory.descriptor,
  ];
  for (let descriptor = 16; descriptor <= 34; descriptor += 1) {
    const executable = effectExecutables.find((entry) => entry.fd === descriptor);
    childStdio[descriptor] =
      executable?.held.descriptor ?? fixedNullCapabilityDescriptor;
  }
  childStdio[35] =
    automaticRollbackDescriptor?.descriptor ?? fixedNullCapabilityDescriptor;
  childStdio[36] =
    automaticRollbackHandoffDescriptor ?? fixedNullCapabilityDescriptor;
  childStdio[37] = automaticRollbackHandoffDescriptor === null
    ? fixedNullCapabilityDescriptor
    : 'pipe';
  childStdio[38] = actionClass === 'SECRET_MATERIALIZATION'
    ? fixedNullCapabilityDescriptor
    : verifierSourceDescriptor.descriptor;
  childStdio[39] = effectExecutables
    .find((entry) => entry.fd === 39)?.held.descriptor
      ?? fixedNullCapabilityDescriptor;
  for (let descriptor = 40; descriptor <= 52; descriptor += 1) {
    childStdio[descriptor] = writeRoots
      .find((entry) => entry.fd === descriptor)?.held.descriptor
      ?? [...readRoots, ...automaticRollbackReadRoots]
        .find((entry) => entry.fd === descriptor)?.held.descriptor
      ?? fixedNullCapabilityDescriptor;
  }
  childStdio[BACKUP_OUTPUT_FD] = actionClass === 'BACKUP_CREATE'
    ? 'pipe'
    : fixedNullCapabilityDescriptor;
  child = spawn('/proc/self/fd/14', delegatedForChild, {
    argv0: program.path,
    detached: true,
    env: childEnv,
    gid: expectedGid,
    uid: expectedUid,
    stdio: childStdio,
    windowsHide: true,
  });
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', (chunk) => {
    ackBytes += chunk;
    if (Buffer.byteLength(ackBytes) > 8_192) {
      ackOverflow = true;
      ackBytes = ackBytes.slice(0, 8_192);
    }
  });
  if (automaticRollbackHandoffDescriptor !== null) {
    child.stdio[37].setEncoding('utf8');
    child.stdio[37].on('data', (chunk) => {
      automaticRollbackAckBytes += chunk;
      if (Buffer.byteLength(automaticRollbackAckBytes) > 8_192) {
        automaticRollbackAckOverflow = true;
        automaticRollbackAckBytes = automaticRollbackAckBytes.slice(0, 8_192);
      }
    });
  }
  if (actionClass === 'BACKUP_CREATE') {
    child.stdio[BACKUP_OUTPUT_FD].on('data', (chunk) => {
      effectOutputBytes = Buffer.concat([effectOutputBytes, chunk]);
      if (effectOutputBytes.length > BACKUP_OUTPUT_MAX_BYTES) {
        effectOutputOverflow = true;
        effectOutputBytes = effectOutputBytes.subarray(0, BACKUP_OUTPUT_MAX_BYTES);
      }
    });
  }
} catch {
  child = null;
} finally {
  if (fixedNullCapabilityDescriptor !== undefined) {
    try {
      closeSync(fixedNullCapabilityDescriptor);
      fixedNullCapabilityClosed = true;
    } catch {
      fixedNullCapabilityClosed = false;
    }
    fixedNullCapabilityDescriptor = undefined;
  }
}
closeSync(handoffDescriptor);
handoffDescriptor = undefined;
if (automaticRollbackHandoffDescriptor !== null) {
  closeSync(automaticRollbackHandoffDescriptor);
  automaticRollbackHandoffDescriptor = null;
}

let timedOut = false;
let forced = false;
let forwardedSignal = null;

function signalGroup(signal) {
  if (!Number.isInteger(child?.pid)) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function groupExists() {
  if (!Number.isInteger(child?.pid)) return false;
  try {
    if (process.platform === 'win32') return child.exitCode === null;
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

let forceTimer;
function beginTermination(reason, signal = 'SIGTERM') {
  if (reason === 'deadline') timedOut = true;
  else forwardedSignal = signal;
  signalGroup(signal);
  if (forceTimer === undefined) {
    forceTimer = setTimeout(() => {
      forced = true;
      signalGroup('SIGKILL');
    }, 5_000);
  }
}

let result;
if (child === null) {
  result = { error: new Error('spawn failed'), code: null, signal: null };
} else {
  const remainingMs = completionDeadlineMs - Date.now();
  if (remainingMs <= 0) beginTermination('deadline');
  const deadlineTimer = remainingMs > 0
    ? setTimeout(() => beginTermination('deadline'), remainingMs)
    : undefined;
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    process.once(signal, () => beginTermination('parent', signal));
  }
  result = await new Promise((complete) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      complete(value);
    };
    child.once('error', (error) => settle({ error, code: null, signal: null }));
    child.once('close', (code, signal) => settle({ error: null, code, signal }));
  });
  if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
}
if (forceTimer !== undefined) clearTimeout(forceTimer);
if (groupExists()) {
  forced = true;
  signalGroup('SIGKILL');
}
if (groupExists()) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
}
const quiescent = !groupExists();
timedOut ||= Date.now() >= completionDeadlineMs;
let programRemainedBound = false;
let chainRemainedBound = false;
// The rechecks below already treat a thrown failure as "did not remain bound" and
// carry on, but an assert() refusal inside them called process.exit and skipped the
// effect-directory cleanup further down — the only step that removes this run's
// temporary-directory residue. Inside this scope a refusal is thrown instead (the
// same throwing-reject shape already passed to inspectBoundFile below), captured
// here, and re-issued unchanged once that cleanup has run.
let pendingRefusal = null;
const captureGuardedFailure = (error) => {
  if (error instanceof DeferredRefusal && pendingRefusal === null) pendingRefusal = error;
};
DEFERRED_REFUSAL_SCOPE.active = true;
try {
  recheckBoundDescriptor(program, 'delegated effect program', productionBinding);
  recheckBoundDescriptor(
    delegatedScript,
    'delegated effect script',
    productionBinding,
  );
  if (delegatedBootstrapDescriptor !== null) {
    recheckBoundDescriptor(
      delegatedBootstrapDescriptor,
      'delegated effect bootstrap',
      productionBinding,
    );
  }
  if (delegatedBootstrapKind !== 'VERIFIER_SOURCE') {
    recheckBoundDescriptor(
      verifierSourceDescriptor,
      'authorized effect verifier source',
      productionBinding,
    );
  }
  if (automaticRollbackDescriptor !== null) {
    recheckBoundDescriptor(
      automaticRollbackDescriptor,
      'automatic rollback script',
      productionBinding,
    );
  }
  for (const executable of effectExecutables) {
    recheckBoundDescriptor(
      executable.held,
      `delegated ${executable.name} executable`,
      productionBinding,
    );
  }
  inspectBoundFile(runnerNode.path, 'runner Node executable', {
    executable: true,
    expectedSha256: runnerNode.sha256,
    expectedIdentity: runnerNode.identity,
    expectedAncestors: runnerNode.ancestorChain,
    rootAncestorChain: productionBinding,
    reject: (message) => { throw new Error(message); },
  });
  programRemainedBound = true;
} catch (error) { captureGuardedFailure(error); }
// The second region is read-only verification, so it is safe to run even with a
// refusal already pending; the first refusal is the one re-issued.
try {
  recheckChain(chain);
  documentDescriptors.forEach((held, index) => recheckDocumentDescriptor(
    held,
    [
      'external authorization',
      'deployment risk version',
      'deployment action preview',
      'authorization consumption',
    ][index],
  ));
  recheckDirectoryDescriptor(
    consumptionRootDescriptor,
    'authorization consumption root',
  );
  const startStat = fstatSync(startEvidenceDescriptor, { bigint: true });
  const startBytes = positionalRead(
    startEvidenceDescriptor,
    Number(startStat.size),
    'authorized effect start evidence',
  );
  assert(createHash('sha256').update(startBytes).digest('hex') === startEvidence.sha256,
    'authorized effect start inherited descriptor changed');
  if (delegatedEnvironmentDescriptor !== null) {
    recheckDataDescriptor(
      delegatedEnvironmentDescriptor,
      delegatedEnvironmentKind === 'PROVIDER_CONFIG'
        ? 'delegated provider configuration'
        : 'delegated effect environment',
    );
  }
  if (effectDirectory.kind === 'CLAIM_TEMPORARY_DIRECTORY') {
    recheckEffectTemporaryDirectory(effectDirectory);
  } else {
    recheckDirectoryDescriptor(effectDirectory, 'credential output parent');
    const outputPath = endpoint(action, 'credential-output-path');
    const outputStat = lstatSync(outputPath, { bigint: true, throwIfNoEntry: false });
    assert(outputStat?.isFile() && !outputStat.isSymbolicLink()
      && outputStat.nlink === 1n
      && (outputStat.mode & 0o7777n) === 0o600n
      && outputStat.uid === BigInt(expectedUid)
      && outputStat.gid === BigInt(expectedGid)
      && outputStat.size > 0n && outputStat.size <= 1024n * 1024n
      && realpathSync(outputPath) === outputPath,
    'credential output leaf was not published exactly');
  }
  for (const root of writeRoots) {
    recheckWriteRootDescriptor(root.held, `${root.name} capability`);
  }
  for (const root of [...readRoots, ...automaticRollbackReadRoots]) {
    recheckReadRootDescriptor(root.held, expectedUid, `${root.name} read root`);
  }
  for (const root of observedRoots) {
    recheckObservedRoot(root, expectedUid, `${root.name} observed root`);
  }
  chainRemainedBound = true;
} catch (error) { captureGuardedFailure(error); }
// Outside the guarded region refusals are taken immediately again, exactly as
// before; while a refusal is pending the scope stays active so that a second
// refusal raised by the cleanup below cannot replace the one being carried.
if (pendingRefusal === null) DEFERRED_REFUSAL_SCOPE.active = false;
let effectOutput = Object.freeze({ status: 'NOT_APPLICABLE' });
if (pendingRefusal === null && actionClass === 'BACKUP_CREATE') {
  if (effectOutputBytes.length === 0) {
    effectOutput = Object.freeze({ status: 'MISSING' });
  } else if (effectOutputOverflow) {
    effectOutput = Object.freeze({ status: 'AMBIGUOUS' });
  } else {
    try {
      const outputDocument = JSON.parse(effectOutputBytes);
      validateAuthorizedEffectOutput(outputDocument);
      outputRequire(effectOutputBytes.equals(authorizedEffectEvidenceBytes(outputDocument)),
        'authorized effect output bytes are not canonical');
      outputRequire(outputDocument.claimKey === consumption.claimKey,
        'authorized effect output claim differs from the consumed action');
      outputRequire(programRemainedBound && chainRemainedBound,
        'authorized effect output chain did not remain bound');
      const inventoryAfter = snapshotBackupWriteRoot(backupWriteRoot);
      const artifact = inspectBoundBackupOutput({
        writeRoot: backupWriteRoot,
        before: backupInventoryBefore,
        after: inventoryAfter,
        document: outputDocument,
        expectedUid,
        expectedGid,
      });
      const outputEvidence = publishEffectOutputEvidence(
        evidenceParent,
        outputEvidencePath,
        outputDocument,
      );
      const inventoryFinal = snapshotBackupWriteRoot(backupWriteRoot);
      outputRequire(sameJson(inventoryFinal, inventoryAfter),
        'backup root changed after exact output verification');
      effectOutput = Object.freeze({
        status: 'BOUND',
        outputEvidencePath: outputEvidence.path,
        outputEvidenceSha256: outputEvidence.sha256,
        writeRootName: outputDocument.writeRootName,
        outputPath: artifact.outputPath,
        outputRelativePath: artifact.outputRelativePath,
        outputIdentity: artifact.outputIdentity,
        outputTreeSha256: artifact.outputTreeSha256,
        receiptRelativePath: artifact.receiptRelativePath,
        receiptSha256: artifact.receiptSha256,
        databaseSha256: artifact.databaseSha256,
        databaseBytes: artifact.databaseBytes,
        beforeInventorySha256: backupInventorySha256(backupInventoryBefore),
        afterInventorySha256: backupInventorySha256(inventoryAfter),
      });
    } catch {
      effectOutput = Object.freeze({ status: 'INVALID' });
    }
  }
}
let effectDirectoryFinalized = false;
try {
  if (effectDirectory.kind === 'CLAIM_TEMPORARY_DIRECTORY') {
    cleanupEffectTemporaryDirectory(effectDirectory);
  } else {
    recheckDirectoryDescriptor(effectDirectory, 'credential output parent');
    closeSync(effectDirectory.descriptor);
  }
  effectDirectoryFinalized = true;
} catch {}
if (pendingRefusal !== null) {
  // Cleanup has now run. Re-issue the captured refusal exactly as blocked() would
  // have issued it at the original refusal point: same message, same exit code,
  // same stream, and still before any terminal evidence is written.
  DEFERRED_REFUSAL_SCOPE.active = false;
  blocked(pendingRefusal.message, pendingRefusal.refusalCode);
}
const ackLines = ackBytes.match(/[^\n]*\n/gu) ?? [];
const ackAccepted = !ackOverflow
  && ackLines.length === 1
  && ackBytes === expectedAck;
const automaticRollbackAckLines =
  automaticRollbackAckBytes.match(/[^\n]*\n/gu) ?? [];
const automaticRollbackAcknowledged = automaticRollbackExpectedAck !== null
  && !automaticRollbackAckOverflow
  && automaticRollbackAckLines.length === 1
  && automaticRollbackAckBytes === automaticRollbackExpectedAck;
const automaticRollbackAckValid = automaticRollbackExpectedAck === null
  ? automaticRollbackAckBytes === ''
  : automaticRollbackAckBytes === '' || automaticRollbackAcknowledged;
const effectFinishedAtUtc = currentUtcSecond();
const success = result.error === null
  && result.code === 0
  && result.signal === null
  && forwardedSignal === null
  && !timedOut
  && !forced
  && quiescent
  && ackAccepted
  && automaticRollbackAckValid
  && !automaticRollbackAcknowledged
  && effectDirectoryFinalized
  && fixedNullCapabilityClosed
  && programRemainedBound
  && chainRemainedBound
  && (actionClass !== 'BACKUP_CREATE' || effectOutput.status === 'BOUND')
  && Date.parse(effectFinishedAtUtc) < completionDeadlineMs;
const terminalDocument = Object.freeze({
  schemaVersion: 1,
  kind: 'AUTHORIZED_EFFECT_TERMINAL',
  status: success ? 'AUTHORIZED_EFFECT_COMPLETED' : 'AUTHORIZED_EFFECT_TERMINATED',
  ...commonEvidence,
  effectStartedAtUtc,
  effectFinishedAtUtc,
  startEvidenceSha256: startEvidence.sha256,
  exitCode: Number.isInteger(result.code) ? result.code : null,
  signal: typeof result.signal === 'string' ? result.signal : null,
  forced,
  timedOut,
  automaticRollbackAcknowledged,
  automaticRollbackHandoffSha256: automaticRollbackHandoffBytes === null
    ? null
    : createHash('sha256').update(automaticRollbackHandoffBytes).digest('hex'),
  programBindingRetained:
    programRemainedBound && chainRemainedBound && ackAccepted
      && automaticRollbackAckValid && effectDirectoryFinalized,
  effectMayHaveMutated: !success,
  successRecorderEligible: success,
  effectOutput,
});
validateAuthorizedEffectTerminal(terminalDocument, startDocument);
writeEvidence(
  evidenceParent,
  finishEvidencePath,
  terminalDocument,
  'authorized effect terminal evidence',
);

for (const descriptor of new Set([
  ...documentDescriptors.map((held) => held.descriptor),
  consumptionRootDescriptor.descriptor,
  startEvidenceDescriptor,
  delegatedScript.descriptor,
  ...(delegatedEnvironmentDescriptor === null
    ? []
    : [delegatedEnvironmentDescriptor.descriptor]),
  ...(delegatedBootstrapDescriptor === null
    ? []
    : [delegatedBootstrapDescriptor.descriptor]),
  verifierSourceDescriptor.descriptor,
  ...(automaticRollbackDescriptor === null
    ? []
    : [automaticRollbackDescriptor.descriptor]),
  ...effectExecutables.map((entry) => entry.held.descriptor),
  ...writeRoots.map((entry) => entry.held.descriptor),
  ...readRoots.map((entry) => entry.held.descriptor),
  ...automaticRollbackReadRoots.map((entry) => entry.held.descriptor),
  program.descriptor,
  ...(effectDirectoryFinalized ? [] : [effectDirectory.descriptor]),
])) {
  try {
    closeSync(descriptor);
  } catch {}
}

if (success) process.exit(0);
if (Number.isInteger(result.code) && result.code > 0 && result.code <= 255) {
  process.exit(result.code);
}
if (typeof result.signal === 'string') {
  const signalNumber = osConstants.signals?.[result.signal];
  if (Number.isInteger(signalNumber)) process.exit(Math.min(255, 128 + signalNumber));
}
process.exit(timedOut ? 124 : 1);
