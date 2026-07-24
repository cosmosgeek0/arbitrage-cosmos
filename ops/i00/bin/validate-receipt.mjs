#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import {
  dirname, isAbsolute, relative, resolve,
} from 'node:path';
import {
  fail,
  isFullSha,
  isUtc,
  parseArgs,
  readJson,
  requireKeys,
  sha256File,
} from '../lib.mjs';
import { compileJsonSchemaFile } from '../json-schema.mjs';
import { canonicalJsonBytes } from '../deployment-authorization-contract.mjs';
import {
  readBoundJsonInput,
  recheckBoundJsonInput,
} from '../bound-json-input.mjs';

let primaryReceiptBinding = null;

const RECEIPT_SCHEMAS = Object.freeze({
  RELEASE: 'release-receipt.schema.json',
  RELEASE_SWITCH: 'release-switch-receipt.schema.json',
  DEPLOYMENT: 'deployment-receipt.schema.json',
  ROLLBACK: 'rollback-receipt.schema.json',
  BACKUP: 'backup-receipt.schema.json',
  RESTORE: 'restore-receipt.schema.json',
  INCIDENT: 'incident-receipt.schema.json',
});

const DEPLOYMENT_EVIDENCE = [
  'releaseManifest',
  'targetReadback',
  'cloudflareBoundary',
  'watchdog',
  'backup',
  'restore',
  'reconciliation',
  'authorization',
];

const ROLLBACK_EVIDENCE = [
  'preTargetReadback',
  'postTargetReadback',
  'cloudflareBoundary',
  'watchdog',
  'databaseSchema',
  'backup',
  'recovery',
  'reconciliation',
  'authorization',
];
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

function requireExactKeys(value, keys, label) {
  requireKeys(value, keys, label);
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) fail(`${label} has unexpected fields: ${unexpected.sort().join(', ')}`);
}

function requireChronology(value, label) {
  for (const field of ['startedAtUtc', 'completedAtUtc', 'recordedAtUtc']) {
    if (!isUtc(value[field])) fail(`${label}.${field} must be exact UTC seconds`);
  }
  if (Date.parse(value.completedAtUtc) < Date.parse(value.startedAtUtc)) {
    fail(`${label} completed before it started`);
  }
  if (Date.parse(value.recordedAtUtc) < Date.parse(value.completedAtUtc)) {
    fail(`${label} was recorded before it completed`);
  }
}

function requireCanonicalChronology(value, label) {
  requireChronology(value, label);
  for (const field of ['startedAtUtc', 'completedAtUtc', 'recordedAtUtc']) {
    const normalized = new Date(Date.parse(value[field])).toISOString().replace('.000Z', 'Z');
    if (normalized !== value[field]) fail(`${label}.${field} is not one real canonical UTC instant`);
  }
}

function requireCanonicalAbsolutePath(value, label) {
  if (typeof value !== 'string' || value === '/' || !isAbsolute(value) || resolve(value) !== value) {
    fail(`${label} must be one canonical non-root absolute path`);
  }
}

function requireEvidenceRoot(rootArgument, label) {
  if (!rootArgument) fail(`--evidence-root is required for ${label}`);
  if (typeof rootArgument !== 'string' || rootArgument === '/'
      || !isAbsolute(rootArgument) || resolve(rootArgument) !== rootArgument
      || /[\u0000-\u001f\u007f]/u.test(rootArgument)) {
    fail(`${label} evidence root must be one absolute lexical canonical path`);
  }
  const root = rootArgument;
  let stat;
  try {
    stat = lstatSync(root, { bigint: true });
  } catch (error) {
    fail(`${label} evidence root is unavailable: ${error.message}`);
  }
  if (stat.isSymbolicLink()) fail(`${label} evidence root must not be a symlink`);
  if (!stat.isDirectory()) fail(`${label} evidence root must be a directory`);
  let physical;
  try {
    physical = realpathSync.native(root);
  } catch (error) {
    fail(`${label} evidence root cannot be physically canonicalized: ${error.message}`);
  }
  if (physical !== root) {
    fail(`${label} evidence root or one of its ancestors is not physically canonical`);
  }
  return {
    path: root,
    identity: {
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
      mode: stat.mode.toString(8),
      mtimeNs: stat.mtimeNs.toString(),
      ctimeNs: stat.ctimeNs.toString(),
    },
  };
}

function requireRelativeEvidencePath(path, label) {
  if (typeof path !== 'string' || path.length === 0) fail(`${label}.path must be a non-empty relative path`);
  if (isAbsolute(path) || path.includes('\\')) fail(`${label}.path must use a portable relative path`);
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${label}.path contains a forbidden path segment`);
  }
  return segments;
}

function validateEvidence(rootArgument, evidence, names, label) {
  const rootBefore = requireEvidenceRoot(rootArgument, label);
  const root = rootBefore.path;
  requireExactKeys(evidence, names, `${label}.evidence`);
  const seenPaths = new Set();
  const documents = {};

  for (const name of names) {
    const reference = evidence[name];
    const referenceLabel = `${label}.evidence.${name}`;
    requireExactKeys(reference, ['path', 'sha256'], referenceLabel);
    if (!/^[0-9a-f]{64}$/.test(reference.sha256)) fail(`${referenceLabel}.sha256 must be lowercase SHA-256`);

    const segments = requireRelativeEvidencePath(reference.path, referenceLabel);
    const absolute = resolve(root, ...segments);
    const fromRoot = relative(root, absolute);
    if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
      fail(`${referenceLabel}.path escapes the evidence root`);
    }
    if (seenPaths.has(reference.path)) fail(`${referenceLabel}.path duplicates another evidence reference`);
    seenPaths.add(reference.path);

    let cursor = root;
    for (let index = 0; index < segments.length; index += 1) {
      cursor = resolve(cursor, segments[index]);
      let stat;
      try {
        stat = lstatSync(cursor);
      } catch (error) {
        fail(`${referenceLabel}.path is unavailable: ${error.message}`);
      }
      if (stat.isSymbolicLink()) fail(`${referenceLabel}.path traverses a symlink`);
      if (index < segments.length - 1 && !stat.isDirectory()) {
        fail(`${referenceLabel}.path has a non-directory parent`);
      }
      if (index === segments.length - 1 && !stat.isFile()) {
        fail(`${referenceLabel}.path must identify a regular file`);
      }
    }

    if (sha256File(absolute) !== reference.sha256) fail(`${referenceLabel}.sha256 does not match the evidence file`);
    documents[name] = readJson(absolute, referenceLabel);
  }
  const rootAfter = requireEvidenceRoot(rootArgument, label);
  if (JSON.stringify(rootAfter) !== JSON.stringify(rootBefore)) {
    fail(`${label} evidence root identity changed during validation`);
  }
  return documents;
}

function requireEvidenceUtc(document, field, label, recordedAtUtc) {
  if (!isUtc(document?.[field]) || Date.parse(document[field]) > Date.parse(recordedAtUtc)) fail(`${label}.${field} is invalid or later than the receipt`);
}

function validateDeploymentEvidence(value, documents, expectedSha) {
  const { releaseManifest, targetReadback, cloudflareBoundary, watchdog, backup, restore, reconciliation, authorization } = documents;
  if (releaseManifest?.releaseId !== `i00-${expectedSha}` || releaseManifest?.testedSha !== expectedSha
      || !Array.isArray(releaseManifest?.files) || releaseManifest.files.length === 0) fail('deployment release manifest evidence is semantically invalid');
  if (targetReadback?.status !== 'DEPLOYMENT_READBACK_VALID' || targetReadback?.testedSha !== expectedSha
      || targetReadback?.deployedSha !== expectedSha || targetReadback?.releaseId !== `i00-${expectedSha}`
      || targetReadback?.blocker !== null) fail('deployment target readback evidence is semantically invalid');
  requireEvidenceUtc(targetReadback, 'observedAtUtc', 'deployment target readback', value.recordedAtUtc);
  if (cloudflareBoundary?.status !== 'CLOUDFLARE_BOUNDARY_VERIFIED' || typeof cloudflareBoundary.hostname !== 'string') fail('deployment Cloudflare evidence is semantically invalid');
  requireEvidenceUtc(cloudflareBoundary, 'observedAtUtc', 'deployment Cloudflare evidence', value.recordedAtUtc);
  if (watchdog?.status !== 'WATCHDOG_HEALTHY' || watchdog?.source !== 'OWNER_READBACK') fail('deployment watchdog evidence is semantically invalid');
  requireEvidenceUtc(watchdog, 'observedAtUtc', 'deployment watchdog evidence', value.recordedAtUtc);
  if (backup?.kind !== 'BACKUP' || backup?.status !== 'BACKUP_VERIFIED' || backup?.sourceSha !== value.deployedSha) fail('deployment backup evidence is semantically invalid');
  requireEvidenceUtc(backup, 'recordedAtUtc', 'deployment backup evidence', value.recordedAtUtc);
  if (restore?.kind !== 'RESTORE' || restore?.status !== 'ISOLATED_DRILL_PASS' || restore?.isolated !== true) fail('deployment restore evidence is semantically invalid');
  requireEvidenceUtc(restore, 'recordedAtUtc', 'deployment restore evidence', value.recordedAtUtc);
  if (reconciliation?.status !== 'RECONCILED' || reconciliation?.deployedSha !== value.deployedSha) fail('deployment reconciliation evidence is semantically invalid');
  requireEvidenceUtc(reconciliation, 'observedAtUtc', 'deployment reconciliation evidence', value.recordedAtUtc);
  if (authorization?.status !== 'APPROVED' || !Array.isArray(authorization.actionClasses)
      || authorization.actionClasses.length !== 1 || authorization.actionClasses[0] !== 'SERVICE_RELEASE_SWITCH'
      || typeof authorization.authorizationId !== 'string' || authorization.authorizationId.length === 0) fail('deployment authorization evidence is semantically invalid');
}

function requireExpectedArgument(args, name, pattern, label = name) {
  const value = args[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail(`--${name} is invalid or missing for ROLLBACK`);
  }
  return value;
}

function validateRollbackBinding(binding, prefix, args) {
  const label = `rollback ${prefix} binding`;
  requireExactKeys(binding, [
    'path', 'releaseId', 'testedSha', 'artifactManifestSha256',
    'treeSha256', 'identity',
  ], label);
  requireCanonicalAbsolutePath(binding.path, `${label}.path`);
  if (!isFullSha(binding.testedSha)
      || binding.releaseId !== `i00-${binding.testedSha}`
      || !/^[0-9a-f]{64}$/.test(binding.artifactManifestSha256)
      || !/^[0-9a-f]{64}$/.test(binding.treeSha256)
      || !/^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,size=[0-9]+,mtimeNs=-?[0-9]+,ctimeNs=-?[0-9]+$/.test(binding.identity)) {
    fail(`${label} is invalid`);
  }
  const expectations = {
    path: binding.path,
    'release-id': binding.releaseId,
    sha: binding.testedSha,
    'artifact-manifest-sha256': binding.artifactManifestSha256,
    'tree-sha256': binding.treeSha256,
    identity: binding.identity,
  };
  for (const [suffix, actual] of Object.entries(expectations)) {
    if (args[`expected-${prefix}-${suffix}`] !== actual) {
      fail(`${label} differs from --expected-${prefix}-${suffix}`);
    }
  }
}

function sameRollbackBinding(left, right) {
  return canonicalJsonBytes(left).equals(canonicalJsonBytes(right));
}

function rollbackReadbackBinding(value) {
  return {
    path: value.path,
    releaseId: value.releaseId,
    testedSha: value.testedSha,
    artifactManifestSha256: value.artifactManifestSha256,
    treeSha256: value.treeSha256,
    identity: value.identity,
  };
}

function validateRollbackReadback(value, phase, expectedBinding, label) {
  const commonKeys = [
    'schemaVersion', 'kind', 'phase', 'status', 'testedSha', 'deployedSha',
    'releaseId', 'blocker', 'observedAtUtc', 'current', 'previous',
  ];
  requireExactKeys(
    value,
    phase === 'POST' ? [...commonKeys, 'service', 'postSwitchGate'] : commonKeys,
    label,
  );
  if (value.schemaVersion !== 1 || value.kind !== 'ROLLBACK_TARGET_READBACK'
      || value.phase !== phase || value.status !== 'DEPLOYMENT_READBACK_VALID'
      || value.blocker !== null || value.testedSha !== expectedBinding.testedSha
      || value.deployedSha !== expectedBinding.testedSha
      || value.releaseId !== expectedBinding.releaseId || !isUtc(value.observedAtUtc)) {
    fail(`${label} identity is invalid`);
  }
  const releaseKeys = [
    'link', 'linkIdentity', 'path', 'releaseId', 'testedSha',
    'artifactManifestSha256', 'treeSha256', 'identity',
  ];
  requireExactKeys(value.current, releaseKeys, `${label}.current`);
  requireCanonicalAbsolutePath(value.current.link, `${label}.current.link`);
  if (!sameRollbackBinding(rollbackReadbackBinding(value.current), expectedBinding)
      || !/^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,size=[0-9]+,mtimeNs=-?[0-9]+,ctimeNs=-?[0-9]+$/.test(value.current.linkIdentity)) {
    fail(`${label}.current differs from the exact release binding`);
  }
  if (value.previous?.state === 'ABSENT') {
    requireExactKeys(value.previous, ['link', 'state'], `${label}.previous`);
    requireCanonicalAbsolutePath(value.previous.link, `${label}.previous.link`);
  } else {
    requireExactKeys(value.previous, [...releaseKeys, 'state'], `${label}.previous`);
    requireCanonicalAbsolutePath(value.previous.link, `${label}.previous.link`);
    if (value.previous.state !== 'PRESENT'
        || value.previous.path === value.current.path) {
      fail(`${label}.previous is invalid`);
    }
  }
  if (phase === 'POST') {
    requireExactKeys(value.service, ['unit', 'state'], `${label}.service`);
    requireExactKeys(value.postSwitchGate, ['base', 'paths', 'status'],
      `${label}.postSwitchGate`);
    if (value.service.unit !== 'cosmos-app.service' || value.service.state !== 'ACTIVE'
        || JSON.stringify(value.postSwitchGate.paths)
          !== JSON.stringify(['/health/live', '/health/ready'])
        || value.postSwitchGate.status !== 'PASS') {
      fail(`${label} service/readiness proof is invalid`);
    }
  }
}

function requireRollbackEvidenceInstant(document, field, label, {
  minimum = null,
  maximum,
} = {}) {
  if (!isUtc(document?.[field])) fail(`${label}.${field} is invalid`);
  const instant = Date.parse(document[field]);
  if ((minimum !== null && instant < Date.parse(minimum))
      || instant > Date.parse(maximum)) {
    fail(`${label}.${field} is outside the rollback chronology`);
  }
}

function validateRollbackClaimLayout(value, rootArgument) {
  const rootBinding = requireEvidenceRoot(rootArgument, 'rollback receipt');
  const root = rootBinding.path;
  if (realpathSync(root) !== root) fail('rollback receipt evidence root must be canonical');
  const claimDirectory = resolve(root, value.claimKey);
  const claim = lstatSync(claimDirectory, { throwIfNoEntry: false });
  if (!claim?.isDirectory() || claim.isSymbolicLink()
      || realpathSync(claimDirectory) !== claimDirectory
      || (claim.mode & 0o777) !== 0o700) {
    fail('rollback claim evidence directory is not one canonical private directory');
  }
  if (typeof process.getuid === 'function' && claim.uid !== process.getuid()) {
    fail('rollback claim evidence directory owner is not the invoking identity');
  }
  const expectedInventory = [
    ...Object.values(ROLLBACK_EVIDENCE_FILES),
    ROLLBACK_EFFECT_FILE,
  ].sort();
  const inventory = readdirSync(claimDirectory).sort();
  if (inventory.length !== expectedInventory.length
      || !inventory.every((name, index) => name === expectedInventory[index])) {
    fail('rollback claim evidence inventory is not exact');
  }
  for (const name of expectedInventory) {
    const path = resolve(claimDirectory, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
        || realpathSync(path) !== path || (stat.mode & 0o777) !== 0o600
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      fail('rollback claim evidence contains a non-private or unstable file');
    }
    const document = readJson(path, `rollback claim ${name}`);
    if (!readFileSync(path).equals(canonicalJsonBytes(document))) {
      fail(`rollback claim ${name} is not canonical JSON`);
    }
  }
  for (const [key, name] of Object.entries(ROLLBACK_EVIDENCE_FILES)) {
    if (value.evidence[key].path !== `${value.claimKey}/${name}`) {
      fail(`rollback evidence ${key} is not at its fixed claim-bound path`);
    }
  }
  const effectPath = resolve(claimDirectory, ROLLBACK_EFFECT_FILE);
  if (sha256File(effectPath) !== value.effectRecordSha256) {
    fail('rollback effect record digest differs from the receipt');
  }
  const rootAfter = requireEvidenceRoot(rootArgument, 'rollback receipt');
  if (JSON.stringify(rootAfter) !== JSON.stringify(rootBinding)) {
    fail('rollback receipt evidence root identity changed during claim validation');
  }
  return Object.freeze({
    root,
    claimDirectory,
    effect: readJson(effectPath, 'rollback effect record'),
  });
}

function validateRollbackEvidence(value, documents, args, claim) {
  const {
    preTargetReadback,
    postTargetReadback,
    cloudflareBoundary,
    watchdog,
    databaseSchema,
    backup,
    recovery,
    reconciliation,
    authorization,
  } = documents;
  validateRollbackReadback(preTargetReadback, 'PRE', value.from,
    'rollback pre-target evidence');
  validateRollbackReadback(postTargetReadback, 'POST', value.to,
    'rollback post-target evidence');
  if (postTargetReadback.previous?.state !== 'PRESENT'
      || !sameRollbackBinding(
        rollbackReadbackBinding(postTargetReadback.previous),
        value.from,
      )
      || preTargetReadback.current.path === value.to.path
      || preTargetReadback.current.link !== postTargetReadback.current.link
      || preTargetReadback.previous.link !== postTargetReadback.previous.link) {
    fail('rollback pre/post transition is not exact');
  }
  if (Date.parse(preTargetReadback.observedAtUtc) > Date.parse(value.startedAtUtc)
      || postTargetReadback.observedAtUtc !== value.completedAtUtc) {
    fail('rollback pre/post readback chronology is invalid');
  }
  if (cloudflareBoundary?.status !== 'CLOUDFLARE_BOUNDARY_VERIFIED'
      || typeof cloudflareBoundary.hostname !== 'string'
      || cloudflareBoundary.hostname.length === 0) {
    fail('rollback boundary evidence is semantically invalid');
  }
  requireRollbackEvidenceInstant(cloudflareBoundary, 'observedAtUtc',
    'rollback boundary evidence',
    { minimum: value.completedAtUtc, maximum: value.recordedAtUtc });
  if (watchdog?.status !== 'WATCHDOG_HEALTHY'
      || watchdog?.source !== 'OWNER_READBACK') {
    fail('rollback watchdog evidence is semantically invalid');
  }
  requireRollbackEvidenceInstant(watchdog, 'observedAtUtc',
    'rollback watchdog evidence',
    { minimum: value.completedAtUtc, maximum: value.recordedAtUtc });
  if (databaseSchema?.status !== 'SCHEMA_COMPATIBLE'
      || databaseSchema?.toSha !== value.toSha) {
    fail('rollback database/schema evidence is semantically invalid');
  }
  if (databaseSchema.observedAtUtc !== undefined) {
    requireRollbackEvidenceInstant(databaseSchema, 'observedAtUtc',
      'rollback database/schema evidence',
      { minimum: value.completedAtUtc, maximum: value.recordedAtUtc });
  }
  if (backup?.kind !== 'BACKUP' || backup?.status !== 'BACKUP_VERIFIED'
      || backup?.sourceSha !== value.fromSha) {
    fail('rollback backup evidence is semantically invalid');
  }
  requireRollbackEvidenceInstant(backup, 'recordedAtUtc', 'rollback backup evidence',
    { maximum: value.startedAtUtc });
  if (recovery?.status !== 'RECOVERY_READY'
      || recovery?.source !== 'CANONICAL_SUPERVISOR_READBACK') {
    fail('rollback recovery evidence is semantically invalid');
  }
  requireRollbackEvidenceInstant(recovery, 'observedAtUtc',
    'rollback recovery evidence',
    { minimum: value.completedAtUtc, maximum: value.recordedAtUtc });
  if (reconciliation?.status !== 'RECONCILED'
      || reconciliation?.deployedSha !== value.toSha) {
    fail('rollback reconciliation evidence is semantically invalid');
  }
  requireRollbackEvidenceInstant(reconciliation, 'observedAtUtc',
    'rollback reconciliation evidence',
    { minimum: value.completedAtUtc, maximum: value.recordedAtUtc });
  if (authorization?.status !== 'APPROVED'
      || !Array.isArray(authorization.actionClasses)
      || authorization.actionClasses.length !== 1
      || authorization.actionClasses[0] !== 'SERVICE_ROLLBACK'
      || authorization.authorizationId !== value.authorizationId
      || authorization.riskVersion !== value.riskVersion
      || authorization.serverPreviewDigest !== value.serverPreviewDigest
      || authorization.deployedSha !== value.toSha
      || authorization.receiptTargets?.result !== args['expected-result-receipt']
      || authorization.receiptTargets?.reconciliation
        !== args['expected-reconciliation-receipt']) {
    fail('rollback authorization evidence is semantically invalid');
  }
  if (value.evidence.authorization.sha256 !== value.authorizationSha256) {
    fail('rollback authorization evidence digest differs from the receipt');
  }
  const effect = claim.effect;
  let effectValidator;
  try {
    effectValidator = compileJsonSchemaFile(
      new URL('../schemas/authorized-rollback-effect.schema.json', import.meta.url),
      'authorized rollback effect schema',
    );
  } catch (error) {
    fail(`authorized rollback effect schema compilation failed: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
  const effectResult = effectValidator(effect);
  if (!effectResult.valid) {
    fail(`authorized rollback effect schema rejected input: ${effectResult.error}`);
  }
  requireExactKeys(effect, [
    'schemaVersion', 'kind', 'status', 'authorizationId', 'riskVersion',
    'serverPreviewDigest', 'authorizationSha256', 'riskDocumentSha256',
    'previewDocumentSha256', 'authorizationConsumptionSha256', 'claimKey',
    'from', 'to', 'preTargetReadbackSha256', 'postTargetReadbackSha256',
    'frozenMarkerSha256', 'donorExitCode', 'startedAtUtc', 'completedAtUtc',
    'effect', 'terminal',
  ], 'authorized rollback effect');
  const effectBinding = effect.effect;
  const terminal = effect.terminal;
  const receiptRootPath = dirname(args['expected-result-receipt']);
  let receiptRoot;
  try {
    receiptRoot = lstatSync(receiptRootPath, { bigint: true });
  } catch (error) {
    fail(`authorized rollback receipt root is unavailable: ${error.message}`);
  }
  const receiptRootIdentity = [
    ['device', receiptRoot.dev],
    ['inode', receiptRoot.ino],
    ['mode', receiptRoot.mode.toString(8)],
    ['uid', receiptRoot.uid],
    ['gid', receiptRoot.gid],
  ].map(([key, entry]) => `${key}=${entry}`).join(',');
  if (effect.schemaVersion !== 1 || effect.kind !== 'AUTHORIZED_ROLLBACK_EFFECT'
      || effect.status !== 'ROLLBACK_EFFECT_RECORDED_PENDING_RECONCILIATION'
      || effect.authorizationId !== value.authorizationId
      || effect.riskVersion !== value.riskVersion
      || effect.serverPreviewDigest !== value.serverPreviewDigest
      || effect.authorizationSha256 !== value.authorizationSha256
      || effect.riskDocumentSha256 !== value.riskDocumentSha256
      || effect.previewDocumentSha256 !== value.previewDocumentSha256
      || effect.authorizationConsumptionSha256
        !== value.authorizationConsumptionSha256
      || effect.claimKey !== value.claimKey || effect.donorExitCode !== 0
      || effect.frozenMarkerSha256 !== null
      || effect.startedAtUtc !== value.startedAtUtc
      || effect.completedAtUtc !== value.completedAtUtc
      || !sameRollbackBinding(effect.from, value.from)
      || !sameRollbackBinding(effect.to, value.to)
      || effect.preTargetReadbackSha256
        !== value.evidence.preTargetReadback.sha256
      || effect.postTargetReadbackSha256
        !== value.evidence.postTargetReadback.sha256
      || effectBinding.claimKey !== value.claimKey
      || effectBinding.effectStartedAtUtc !== value.startedAtUtc
      || Date.parse(effectBinding.effectFinishedAtUtc)
        > Date.parse(value.completedAtUtc)
      || effectBinding.chain.authorizationSha256 !== value.authorizationSha256
      || effectBinding.chain.riskDocumentSha256 !== value.riskDocumentSha256
      || effectBinding.chain.previewDocumentSha256 !== value.previewDocumentSha256
      || effectBinding.chain.authorizationConsumptionSha256
        !== value.authorizationConsumptionSha256
      || effectBinding.receiptRoot.path !== receiptRootPath
      || dirname(args['expected-reconciliation-receipt']) !== receiptRootPath
      || !receiptRoot.isDirectory() || receiptRoot.isSymbolicLink()
      || realpathSync.native(receiptRootPath) !== receiptRootPath
      || effectBinding.receiptRoot.identity !== receiptRootIdentity
      || effectBinding.startEvidencePath === effectBinding.terminalEvidencePath
      || terminal.status !== 'AUTHORIZED_EFFECT_COMPLETED'
      || terminal.exitCode !== 0 || terminal.signal !== null
      || terminal.forced !== false || terminal.timedOut !== false) {
    fail('authorized rollback effect differs from the final receipt');
  }
}

function validateReleaseSwitch(value, args) {
  if (!isFullSha(args['expected-sha'])) fail('--expected-sha must be a full Git SHA for RELEASE_SWITCH');
  for (const [name, pattern] of [
    ['expected-artifact-manifest-sha256', /^[0-9a-f]{64}$/],
    ['expected-authorization-id', /^.{1,2048}$/],
    ['expected-authorization-sha256', /^[0-9a-f]{64}$/],
    ['expected-risk-version', /^i00-deployment-risk-v1:sha256:[0-9a-f]{64}$/],
    ['expected-risk-document-sha256', /^[0-9a-f]{64}$/],
    ['expected-server-preview-digest', /^sha256:[0-9a-f]{64}$/],
    ['expected-preview-document-sha256', /^[0-9a-f]{64}$/],
    ['expected-authorization-consumption-sha256', /^[0-9a-f]{64}$/],
    ['expected-authorization-claim-key', /^[0-9a-f]{64}$/],
  ]) {
    if (!pattern.test(args[name] ?? '')) {
      fail(`--${name} is invalid or missing for RELEASE_SWITCH`);
    }
  }
  requireCanonicalAbsolutePath(args.reconciliation, '--reconciliation');
  requireExactKeys(value, [
    'schemaVersion', 'kind', 'releaseId', 'testedSha', 'deployedSha',
    'artifactManifestSha256', 'authorizationId', 'authorizationSha256',
    'riskVersion', 'riskDocumentSha256', 'serverPreviewDigest',
    'previewDocumentSha256', 'authorizationConsumption', 'authorizedEffect',
    'recoveryTarget',
    'firstHostEvidenceSha256', 'current', 'previous', 'service', 'postSwitchGate',
    'donorExitCode', 'status', 'startedAtUtc', 'completedAtUtc', 'recordedAtUtc',
  ], 'release-switch receipt');
  requireExactKeys(
    value.authorizationConsumption,
    ['claimKey', 'sha256', 'consumedAtUtc'],
    'release-switch authorization consumption',
  );
  requireExactKeys(value.authorizedEffect, [
    'startEvidencePath',
    'startEvidenceSha256', 'terminalEvidenceSha256',
    'terminalEvidencePath',
    'effectStartedAtUtc', 'effectFinishedAtUtc', 'terminalStatus', 'exitCode',
    'receiptPublicationReserveSeconds', 'claimKey', 'consumptionSha256',
    'program', 'signal', 'forced', 'timedOut', 'programBindingRetained',
    'effectMayHaveMutated', 'successRecorderEligible', 'runnerExitCode',
    'receiptRoot',
  ], 'release-switch authorized effect');
  requireExactKeys(
    value.authorizedEffect.program,
    ['path', 'sha256', 'identity'],
    'release-switch authorized effect program',
  );
  requireExactKeys(
    value.authorizedEffect.receiptRoot,
    ['path', 'identity'],
    'release-switch authorized effect receipt root',
  );
  const expectedSha = args['expected-sha'];
  const succeeded = value.status === 'RELEASE_SWITCH_PROVED';
  if (value.releaseId !== `i00-${expectedSha}` || value.testedSha !== expectedSha
      || (succeeded
        ? value.deployedSha !== expectedSha || value.donorExitCode !== 0
        : value.status !== 'RELEASE_SWITCH_FAILED_AFTER_EFFECT'
          || value.deployedSha !== null
          || value.donorExitCode !== value.authorizedEffect.exitCode)) {
    fail('release-switch receipt SHA/status is contradictory');
  }
  if (value.artifactManifestSha256 !== args['expected-artifact-manifest-sha256']
      || value.authorizationId !== args['expected-authorization-id']
      || value.authorizationSha256 !== args['expected-authorization-sha256']
      || value.riskVersion !== args['expected-risk-version']
      || value.riskDocumentSha256 !== args['expected-risk-document-sha256']
      || value.serverPreviewDigest !== args['expected-server-preview-digest']
      || value.previewDocumentSha256 !== args['expected-preview-document-sha256']
      || value.authorizationConsumption.sha256
        !== args['expected-authorization-consumption-sha256']
      || value.authorizationConsumption.claimKey
        !== args['expected-authorization-claim-key']) {
    fail('release-switch receipt provenance differs from the authorized inputs');
  }
  const firstHost = args['expected-recovery-target'] !== undefined;
  if (firstHost) {
    if (args['expected-recovery-target'] !== 'NO_PRIOR_RELEASE_FIRST_HOST'
        || !/^[0-9a-f]{64}$/.test(args['expected-first-host-evidence-sha256'] ?? '')
        || value.recoveryTarget !== args['expected-recovery-target']
        || value.firstHostEvidenceSha256 !== args['expected-first-host-evidence-sha256']
        || (succeeded
          ? value.previous.state !== 'ABSENT' || value.previous.target !== null
          : value.previous !== null)) {
      fail('release-switch first-host evidence is contradictory');
    }
  } else if (args['expected-first-host-evidence-sha256'] !== undefined
      || value.recoveryTarget !== null || value.firstHostEvidenceSha256 !== null
      || (succeeded
        ? value.previous.state !== 'PRESENT'
          || typeof value.previous.target !== 'string'
        : value.previous !== null)) {
    fail('release-switch later-release evidence is contradictory');
  }
  if (succeeded) {
    requireCanonicalAbsolutePath(value.current.link, 'release-switch current.link');
    requireCanonicalAbsolutePath(value.current.target, 'release-switch current.target');
    requireCanonicalAbsolutePath(value.previous.link, 'release-switch previous.link');
    if (value.previous.target !== null) {
      requireCanonicalAbsolutePath(value.previous.target, 'release-switch previous.target');
    }
    const releaseRoot = value.current.target.slice(0, -value.current.releaseId.length);
    if (value.current.releaseId !== value.releaseId
        || value.current.target !== `${releaseRoot}${value.releaseId}`
        || !releaseRoot.endsWith('/releases/')
        || value.current.link !== `${releaseRoot.slice(0, -'releases/'.length)}current`
        || value.previous.link !== `${releaseRoot.slice(0, -'releases/'.length)}previous`) {
      fail('release-switch link identity is contradictory');
    }
    if (!firstHost) {
      const previousReleaseId = value.previous.target.startsWith(releaseRoot)
        ? value.previous.target.slice(releaseRoot.length) : '';
      if (!/^i00-[0-9a-f]{40}$/.test(previousReleaseId)
          || value.previous.target === value.current.target) {
        fail('release-switch previous target is not one distinct direct release child');
      }
    }
  } else if (value.current !== null || value.previous !== null) {
    fail('failed release-switch receipt cannot claim a resolved release state');
  }
  if (value.service.unit !== 'cosmos-app.service'
      || value.postSwitchGate.base !== 'http://127.0.0.1:8080'
      || JSON.stringify(value.postSwitchGate.paths)
        !== JSON.stringify(['/health/live', '/health/ready'])
      || (succeeded
        ? value.service.state !== 'ACTIVE' || value.postSwitchGate.status !== 'PASS'
        : value.service.state !== 'UNKNOWN' || value.postSwitchGate.status !== 'UNKNOWN')) {
    fail('release-switch Gate-5 service/readiness evidence is invalid');
  }
  requireCanonicalChronology(value, 'release-switch receipt');
  requireCanonicalAbsolutePath(
    value.authorizedEffect.program.path,
    'release-switch authorized effect program.path',
  );
  requireCanonicalAbsolutePath(
    value.authorizedEffect.startEvidencePath,
    'release-switch authorized effect startEvidencePath',
  );
  requireCanonicalAbsolutePath(
    value.authorizedEffect.terminalEvidencePath,
    'release-switch authorized effect terminalEvidencePath',
  );
  requireCanonicalAbsolutePath(
    value.authorizedEffect.receiptRoot.path,
    'release-switch authorized effect receiptRoot.path',
  );
  for (const [field, candidate] of [
    ['startEvidenceSha256', value.authorizedEffect.startEvidenceSha256],
    ['terminalEvidenceSha256', value.authorizedEffect.terminalEvidenceSha256],
    ['program.sha256', value.authorizedEffect.program.sha256],
  ]) {
    if (!/^[0-9a-f]{64}$/u.test(candidate)) {
      fail(`release-switch authorized effect ${field} is invalid`);
    }
  }
  const receiptRootPath = dirname(primaryReceiptBinding.absolute);
  const receiptRootStat = lstatSync(receiptRootPath, { bigint: true });
  const receiptRootIdentity = [
    `device=${receiptRootStat.dev}`,
    `inode=${receiptRootStat.ino}`,
    `mode=${receiptRootStat.mode.toString(8)}`,
    `uid=${receiptRootStat.uid}`,
    `gid=${receiptRootStat.gid}`,
  ].join(',');
  if (!/^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,size=[0-9]+,mtimeNs=-?[0-9]+,ctimeNs=-?[0-9]+$/u
    .test(value.authorizedEffect.program.identity)
      || !Number.isSafeInteger(value.authorizedEffect.receiptPublicationReserveSeconds)
      || value.authorizedEffect.receiptPublicationReserveSeconds < 1
      || value.authorizedEffect.receiptPublicationReserveSeconds > 3_600
      || value.authorizedEffect.claimKey !== value.authorizationConsumption.claimKey
      || value.authorizedEffect.consumptionSha256 !== value.authorizationConsumption.sha256
      || !isUtc(value.authorizedEffect.effectStartedAtUtc)
      || !isUtc(value.authorizedEffect.effectFinishedAtUtc)
      || value.authorizedEffect.effectStartedAtUtc !== value.startedAtUtc
      || Date.parse(value.authorizedEffect.effectFinishedAtUtc)
        < Date.parse(value.authorizedEffect.effectStartedAtUtc)
      || Date.parse(value.authorizedEffect.effectFinishedAtUtc)
        > Date.parse(value.completedAtUtc)
      || value.authorizedEffect.startEvidencePath
        === value.authorizedEffect.terminalEvidencePath
      || !Number.isSafeInteger(value.authorizedEffect.runnerExitCode)
      || value.authorizedEffect.runnerExitCode < 0
      || value.authorizedEffect.runnerExitCode > 255
      || value.authorizedEffect.receiptRoot.path !== receiptRootPath
      || !receiptRootStat.isDirectory() || receiptRootStat.isSymbolicLink()
      || realpathSync.native(receiptRootPath) !== receiptRootPath
      || value.authorizedEffect.receiptRoot.identity !== receiptRootIdentity
      || (succeeded
        ? value.authorizedEffect.terminalStatus !== 'AUTHORIZED_EFFECT_COMPLETED'
          || value.authorizedEffect.exitCode !== 0
          || value.authorizedEffect.signal !== null
          || value.authorizedEffect.forced !== false
          || value.authorizedEffect.timedOut !== false
          || value.authorizedEffect.programBindingRetained !== true
          || value.authorizedEffect.effectMayHaveMutated !== false
          || value.authorizedEffect.successRecorderEligible !== true
          || value.authorizedEffect.runnerExitCode !== 0
        : value.authorizedEffect.terminalStatus !== 'AUTHORIZED_EFFECT_TERMINATED'
          || value.authorizedEffect.effectMayHaveMutated !== true
          || value.authorizedEffect.successRecorderEligible !== false
          || value.authorizedEffect.runnerExitCode === 0)) {
    fail('release-switch authorized effect is contradictory');
  }
  if (!isUtc(value.authorizationConsumption.consumedAtUtc)
      || Date.parse(value.authorizationConsumption.consumedAtUtc)
        > Date.parse(value.startedAtUtc)) {
    fail('release-switch authorization consumption chronology is invalid');
  }
  const reconciliationBinding = readBoundJsonInput(
    args.reconciliation,
    'release-switch reconciliation',
  );
  if (dirname(reconciliationBinding.absolute) !== receiptRootPath) {
    fail('release-switch reconciliation is not a direct child of the authorized receipt root');
  }
  const reconciliation = reconciliationBinding.document;
  let reconciliationValidator;
  try {
    reconciliationValidator = compileJsonSchemaFile(
      new URL('../schemas/release-switch-reconciliation.schema.json', import.meta.url),
      'release-switch reconciliation schema',
    );
  } catch (error) {
    fail(`release-switch reconciliation schema compilation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const reconciliationResult = reconciliationValidator(reconciliation);
  if (!reconciliationResult.valid) {
    fail(`release-switch reconciliation schema rejected input: ${reconciliationResult.error}`);
  }
  if (createHash('sha256').update(canonicalJsonBytes(reconciliation)).digest('hex')
      !== reconciliationBinding.sha256) {
    fail('release-switch reconciliation is not canonical JSON');
  }
  requireExactKeys(reconciliation.authorizationConsumption, [
    'claimKey', 'sha256', 'consumedAtUtc',
  ], 'release-switch reconciliation authorization consumption');
  if (reconciliation.authorizationId !== value.authorizationId
      || reconciliation.deployedSha !== value.deployedSha
      || reconciliation.riskVersion !== value.riskVersion
      || reconciliation.riskDocumentSha256 !== value.riskDocumentSha256
      || reconciliation.serverPreviewDigest !== value.serverPreviewDigest
      || reconciliation.previewDocumentSha256 !== value.previewDocumentSha256
      || JSON.stringify(reconciliation.authorizationConsumption)
        !== JSON.stringify(value.authorizationConsumption)
      || !canonicalJsonBytes(reconciliation.authorizedEffect)
        .equals(canonicalJsonBytes(value.authorizedEffect))
      || reconciliation.resultReceiptSha256 !== primaryReceiptBinding.sha256
      || !isUtc(reconciliation.reconciledAtUtc)
      || Date.parse(reconciliation.reconciledAtUtc) < Date.parse(value.recordedAtUtc)
      || (succeeded
        ? reconciliation.status !== 'GATE_5_RECONCILED'
          || reconciliation.disposition
            !== 'GATE_5_RELEASE_SWITCH_PROVED_LATER_GATES_PENDING'
        : reconciliation.status !== 'EFFECT_FAILURE_RECONCILED'
          || reconciliation.disposition
            !== 'RELEASE_SWITCH_FAILED_AFTER_EFFECT_RECORDED')) {
    fail('release-switch reconciliation differs from the exact Gate-5 result');
  }
  recheckBoundJsonInput(
    reconciliationBinding,
    'release-switch reconciliation',
  );
}

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.kind) fail('--input and --kind are required');
primaryReceiptBinding = readBoundJsonInput(args.input, 'operation receipt');
const value = primaryReceiptBinding.document;
if (createHash('sha256').update(canonicalJsonBytes(value)).digest('hex')
    !== primaryReceiptBinding.sha256) {
  fail('operation receipt is not canonical JSON');
}
if (value.kind !== args.kind) fail('receipt kind does not match --kind');
const schemaName = RECEIPT_SCHEMAS[args.kind];
if (!schemaName) fail(`unsupported receipt kind ${args.kind}`);
let structuralValidator;
try {
  structuralValidator = compileJsonSchemaFile(
    new URL(`../schemas/${schemaName}`, import.meta.url),
    `${args.kind} receipt schema`,
  );
} catch (error) {
  fail(`receipt schema compilation failed: ${error instanceof Error ? error.message : String(error)}`);
}
const structuralResult = structuralValidator(value);
if (!structuralResult.valid) fail(`${args.kind} receipt schema rejected input: ${structuralResult.error}`);
const expectedSchemaVersion = ['RELEASE_SWITCH', 'ROLLBACK'].includes(args.kind) ? 2 : 1;
if (value.schemaVersion !== expectedSchemaVersion) {
  fail(`receipt schemaVersion must be ${expectedSchemaVersion}`);
}
const sha = (field) => { if (!isFullSha(value[field])) fail(`${field} must be a full Git SHA`); };
const utc = (field) => { if (!isUtc(value[field])) fail(`${field} must be exact UTC seconds`); };

switch (args.kind) {
  case 'RELEASE':
    requireKeys(value, ['releaseId', 'testedSha', 'artifactManifestSha256', 'status', 'recordedAtUtc'], 'release receipt');
    sha('testedSha'); utc('recordedAtUtc');
    if (value.releaseId !== `i00-${value.testedSha}` || !/^[0-9a-f]{64}$/.test(value.artifactManifestSha256)) fail('release receipt identity/digest is invalid');
    if (!['ASSEMBLED_NOT_DEPLOYED', 'VALIDATED_NOT_DEPLOYED'].includes(value.status)) fail('release receipt cannot claim deployment');
    break;
  case 'RELEASE_SWITCH':
    validateReleaseSwitch(value, args);
    break;
  case 'DEPLOYMENT':
    if (!isFullSha(args['expected-sha'])) fail('--expected-sha must be a full Git SHA for DEPLOYMENT');
    requireExactKeys(value, ['schemaVersion', 'kind', 'releaseId', 'testedSha', 'deployedSha', 'evidence', 'status', 'startedAtUtc', 'completedAtUtc', 'recordedAtUtc'], 'deployment receipt');
    sha('testedSha'); sha('deployedSha');
    if (value.status !== 'DEPLOYED_PROVED' || value.testedSha !== args['expected-sha']
        || value.deployedSha !== args['expected-sha'] || value.releaseId !== `i00-${args['expected-sha']}`) fail('deployment receipt SHA/status is contradictory');
    requireChronology(value, 'deployment receipt');
    validateDeploymentEvidence(value, validateEvidence(args['evidence-root'], value.evidence, DEPLOYMENT_EVIDENCE, 'deployment receipt'), args['expected-sha']);
    break;
  case 'ROLLBACK':
    requireExactKeys(value, [
      'schemaVersion', 'kind', 'authorizationId', 'riskVersion',
      'serverPreviewDigest', 'authorizationSha256', 'riskDocumentSha256',
      'previewDocumentSha256', 'authorizationConsumptionSha256', 'claimKey',
      'effectRecordSha256', 'fromSha', 'toSha', 'from', 'to', 'evidence',
      'status', 'startedAtUtc', 'completedAtUtc', 'recordedAtUtc',
    ], 'rollback receipt');
    sha('fromSha'); sha('toSha');
    validateRollbackBinding(value.from, 'from', args);
    validateRollbackBinding(value.to, 'to', args);
    for (const [name, pattern] of [
      ['expected-authorization-id', /^.{1,256}$/],
      ['expected-risk-version', /^i00-deployment-risk-v1:sha256:[0-9a-f]{64}$/],
      ['expected-server-preview-digest', /^sha256:[0-9a-f]{64}$/],
      ['expected-authorization-sha256', /^[0-9a-f]{64}$/],
      ['expected-risk-document-sha256', /^[0-9a-f]{64}$/],
      ['expected-preview-document-sha256', /^[0-9a-f]{64}$/],
      ['expected-authorization-consumption-sha256', /^[0-9a-f]{64}$/],
      ['expected-claim-key', /^[0-9a-f]{64}$/],
      ['expected-effect-record-sha256', /^[0-9a-f]{64}$/],
    ]) {
      requireExpectedArgument(args, name, pattern);
    }
    requireCanonicalAbsolutePath(
      args['expected-result-receipt'],
      '--expected-result-receipt',
    );
    requireCanonicalAbsolutePath(
      args['expected-reconciliation-receipt'],
      '--expected-reconciliation-receipt',
    );
    if (args['expected-result-receipt'] === args['expected-reconciliation-receipt']) {
      fail('rollback expected receipt targets must be distinct');
    }
    if (value.authorizationId !== args['expected-authorization-id']
        || value.riskVersion !== args['expected-risk-version']
        || value.serverPreviewDigest !== args['expected-server-preview-digest']
        || value.authorizationSha256 !== args['expected-authorization-sha256']
        || value.riskDocumentSha256 !== args['expected-risk-document-sha256']
        || value.previewDocumentSha256 !== args['expected-preview-document-sha256']
        || value.authorizationConsumptionSha256
          !== args['expected-authorization-consumption-sha256']
        || value.claimKey !== args['expected-claim-key']
        || value.effectRecordSha256 !== args['expected-effect-record-sha256']) {
      fail('rollback receipt provenance differs from the expected authorized chain');
    }
    if (value.fromSha === value.toSha || value.fromSha !== value.from.testedSha
        || value.toSha !== value.to.testedSha || value.from.path === value.to.path
        || value.status !== 'ROLLED_BACK_PROVED') {
      fail('rollback receipt is contradictory');
    }
    requireCanonicalChronology(value, 'rollback receipt');
    {
      const claim = validateRollbackClaimLayout(value, args['evidence-root']);
      validateRollbackEvidence(
        value,
        validateEvidence(
          args['evidence-root'],
          value.evidence,
          ROLLBACK_EVIDENCE,
          'rollback receipt',
        ),
        args,
        claim,
      );
    }
    break;
  case 'BACKUP':
    requireKeys(value, ['backupId', 'sourceSha', 'databaseSha256', 'integrityCheck', 'foreignKeyViolations', 'evidencePaths', 'status', 'recordedAtUtc'], 'backup receipt');
    sha('sourceSha'); utc('recordedAtUtc');
    if (!/^[0-9a-f]{64}$/.test(value.databaseSha256) || value.integrityCheck !== 'ok' || value.foreignKeyViolations !== 0 || value.status !== 'BACKUP_VERIFIED' || !Array.isArray(value.evidencePaths)) fail('backup receipt proof is incomplete');
    break;
  case 'RESTORE':
    requireKeys(value, ['backupId', 'isolated', 'appInactive', 'integrityCheck', 'foreignKeyViolations', 'target', 'status', 'authorizationReference', 'recordedAtUtc'], 'restore receipt');
    utc('recordedAtUtc');
    if (value.integrityCheck !== 'ok' || value.foreignKeyViolations !== 0) fail('restore integrity proof is incomplete');
    if (value.status === 'ISOLATED_DRILL_PASS' && (value.isolated !== true || value.authorizationReference !== null)) fail('isolated restore receipt is contradictory');
    if (value.status === 'PRODUCTION_RESTORE_PROVED' && (value.isolated !== false || value.appInactive !== true || !value.authorizationReference)) fail('production restore receipt is contradictory');
    if (!['ISOLATED_DRILL_PASS', 'PRODUCTION_RESTORE_PROVED'].includes(value.status)) fail('restore status is invalid');
    break;
  case 'INCIDENT':
    requireExactKeys(value, ['schemaVersion', 'kind', 'incidentId', 'fingerprint', 'severity', 'rootCause', 'capitalRelevance', 'firstSeenUtc', 'lastSeenUtc', 'status', 'operatorAction', 'correlationIds'], 'incident receipt');
    utc('firstSeenUtc'); utc('lastSeenUtc');
    for (const field of ['incidentId', 'fingerprint', 'rootCause', 'operatorAction']) {
      if (typeof value[field] !== 'string' || value[field].trim().length === 0) fail(`incident ${field} must be non-empty`);
    }
    if (!['INFO', 'WARNING', 'CRITICAL'].includes(value.severity)
        || !['NONE', 'POTENTIAL', 'ACTIVE_EXPOSURE', 'UNKNOWN'].includes(value.capitalRelevance)
        || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED_WITH_PROOF'].includes(value.status)) fail('incident enum value is invalid');
    if (Date.parse(value.lastSeenUtc) < Date.parse(value.firstSeenUtc) || !Array.isArray(value.correlationIds) || value.correlationIds.length === 0
        || value.correlationIds.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
        || new Set(value.correlationIds).size !== value.correlationIds.length) fail('incident chronology/correlation is invalid');
    if (value.status === 'RESOLVED_WITH_PROOF' && value.capitalRelevance === 'UNKNOWN') fail('unknown capital relevance cannot be resolved');
    break;
  default:
    fail(`unsupported receipt kind ${args.kind}`);
}

const finalPrimaryReceiptBinding = recheckBoundJsonInput(
  primaryReceiptBinding,
  'operation receipt',
);
if (createHash('sha256').update(canonicalJsonBytes(finalPrimaryReceiptBinding.document))
  .digest('hex') !== finalPrimaryReceiptBinding.sha256) {
  fail('operation receipt is not canonical JSON');
}
process.stdout.write(`${JSON.stringify({ status: 'RECEIPT_VALID', kind: args.kind })}\n`);
