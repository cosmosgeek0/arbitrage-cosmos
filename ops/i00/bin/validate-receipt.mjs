#!/usr/bin/env node
import { lstatSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  fail,
  isFullSha,
  isUtc,
  parseArgs,
  readJson,
  requireKeys,
  sha256File,
} from '../lib.mjs';

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

function requireEvidenceRoot(rootArgument, label) {
  if (!rootArgument) fail(`--evidence-root is required for ${label}`);
  const root = resolve(rootArgument);
  let stat;
  try {
    stat = lstatSync(root);
  } catch (error) {
    fail(`${label} evidence root is unavailable: ${error.message}`);
  }
  if (stat.isSymbolicLink()) fail(`${label} evidence root must not be a symlink`);
  if (!stat.isDirectory()) fail(`${label} evidence root must be a directory`);
  return root;
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
  const root = requireEvidenceRoot(rootArgument, label);
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

function validateRollbackEvidence(value, documents) {
  const { preTargetReadback, postTargetReadback, cloudflareBoundary, watchdog, databaseSchema, backup, recovery, reconciliation, authorization } = documents;
  if (preTargetReadback?.status !== 'DEPLOYMENT_READBACK_VALID' || preTargetReadback?.deployedSha !== value.fromSha
      || postTargetReadback?.status !== 'DEPLOYMENT_READBACK_VALID' || postTargetReadback?.deployedSha !== value.toSha
      || postTargetReadback?.releaseId !== `i00-${value.toSha}` || postTargetReadback?.blocker !== null) fail('rollback pre/post target readback evidence is semantically invalid');
  requireEvidenceUtc(preTargetReadback, 'observedAtUtc', 'rollback pre-target evidence', value.recordedAtUtc);
  requireEvidenceUtc(postTargetReadback, 'observedAtUtc', 'rollback post-target evidence', value.recordedAtUtc);
  if (cloudflareBoundary?.status !== 'CLOUDFLARE_BOUNDARY_VERIFIED') fail('rollback boundary evidence is semantically invalid');
  requireEvidenceUtc(cloudflareBoundary, 'observedAtUtc', 'rollback boundary evidence', value.recordedAtUtc);
  if (watchdog?.status !== 'WATCHDOG_HEALTHY' || watchdog?.source !== 'OWNER_READBACK') fail('rollback watchdog evidence is semantically invalid');
  requireEvidenceUtc(watchdog, 'observedAtUtc', 'rollback watchdog evidence', value.recordedAtUtc);
  if (databaseSchema?.status !== 'SCHEMA_COMPATIBLE' || databaseSchema?.toSha !== value.toSha) fail('rollback database/schema evidence is semantically invalid');
  if (backup?.kind !== 'BACKUP' || backup?.status !== 'BACKUP_VERIFIED' || backup?.sourceSha !== value.fromSha) fail('rollback backup evidence is semantically invalid');
  if (recovery?.status !== 'RECOVERY_READY' || recovery?.source !== 'CANONICAL_SUPERVISOR_READBACK') fail('rollback recovery evidence is semantically invalid');
  requireEvidenceUtc(recovery, 'observedAtUtc', 'rollback recovery evidence', value.recordedAtUtc);
  if (reconciliation?.status !== 'RECONCILED' || reconciliation?.deployedSha !== value.toSha) fail('rollback reconciliation evidence is semantically invalid');
  requireEvidenceUtc(reconciliation, 'observedAtUtc', 'rollback reconciliation evidence', value.recordedAtUtc);
  if (authorization?.status !== 'APPROVED' || !Array.isArray(authorization.actionClasses)
      || authorization.actionClasses.length !== 1 || authorization.actionClasses[0] !== 'SERVICE_ROLLBACK'
      || typeof authorization.authorizationId !== 'string' || authorization.authorizationId.length === 0) fail('rollback authorization evidence is semantically invalid');
}

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.kind) fail('--input and --kind are required');
const value = readJson(args.input, 'operation receipt');
if (value.kind !== args.kind) fail('receipt kind does not match --kind');
if (value.schemaVersion !== 1) fail('receipt schemaVersion must be 1');
const sha = (field) => { if (!isFullSha(value[field])) fail(`${field} must be a full Git SHA`); };
const utc = (field) => { if (!isUtc(value[field])) fail(`${field} must be exact UTC seconds`); };

switch (args.kind) {
  case 'RELEASE':
    requireKeys(value, ['releaseId', 'testedSha', 'artifactManifestSha256', 'status', 'recordedAtUtc'], 'release receipt');
    sha('testedSha'); utc('recordedAtUtc');
    if (value.releaseId !== `i00-${value.testedSha}` || !/^[0-9a-f]{64}$/.test(value.artifactManifestSha256)) fail('release receipt identity/digest is invalid');
    if (!['ASSEMBLED_NOT_DEPLOYED', 'VALIDATED_NOT_DEPLOYED'].includes(value.status)) fail('release receipt cannot claim deployment');
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
    requireExactKeys(value, ['schemaVersion', 'kind', 'fromSha', 'toSha', 'evidence', 'status', 'startedAtUtc', 'completedAtUtc', 'recordedAtUtc'], 'rollback receipt');
    sha('fromSha'); sha('toSha');
    if (value.fromSha === value.toSha || value.status !== 'ROLLED_BACK_PROVED') fail('rollback receipt is contradictory');
    requireChronology(value, 'rollback receipt');
    validateRollbackEvidence(value, validateEvidence(args['evidence-root'], value.evidence, ROLLBACK_EVIDENCE, 'rollback receipt'));
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

process.stdout.write(`${JSON.stringify({ status: 'RECEIPT_VALID', kind: args.kind })}\n`);
