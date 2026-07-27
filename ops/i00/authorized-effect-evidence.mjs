import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileJsonSchemaFile } from './json-schema.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const START_SCHEMA = compileJsonSchemaFile(
  resolve(MODULE_DIR, 'schemas/authorized-effect-start.schema.json'),
  'authorized effect start schema',
);
const TERMINAL_SCHEMA = compileJsonSchemaFile(
  resolve(MODULE_DIR, 'schemas/authorized-effect-terminal.schema.json'),
  'authorized effect terminal schema',
);
const OUTPUT_SCHEMA = compileJsonSchemaFile(
  resolve(MODULE_DIR, 'schemas/authorized-effect-output.schema.json'),
  'authorized effect output schema',
);
const COMMON_FIELDS = Object.freeze([
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
  'effectOutputPolicy',
  'authorizationExpiresAtUtc',
  'evidenceValidUntilUtc',
  'receiptPublicationReserveSeconds',
  'startEvidencePath',
  'finishEvidencePath',
  'effectStartedAtUtc',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function authorizedEffectEvidenceBytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value), null, 2)}\n`);
}

export function authorizedEffectEvidenceSha256(value) {
  return createHash('sha256').update(authorizedEffectEvidenceBytes(value)).digest('hex');
}

export function validateAuthorizedEffectOutput(document) {
  const schema = OUTPUT_SCHEMA(document);
  assert(schema.valid, `authorized effect output schema rejected: ${schema.error}`);
  assert(document.receiptRelativePath
    === `${document.outputRelativePath}/manifest.json`,
  'authorized effect output receipt is not below its exact output');
  return Object.freeze(document);
}

export function validateAuthorizedEffectStart(document) {
  const schema = START_SCHEMA(document);
  assert(schema.valid, `authorized effect start schema rejected: ${schema.error}`);
  const start = Date.parse(document.effectStartedAtUtc);
  const horizon = Date.parse(document.evidenceValidUntilUtc);
  const expiry = Date.parse(document.authorizationExpiresAtUtc);
  assert(Number.isSafeInteger(document.receiptPublicationReserveSeconds)
    && document.receiptPublicationReserveSeconds >= 1
    && document.receiptPublicationReserveSeconds <= 3_600,
  'authorized effect receipt publication reserve is invalid');
  assert(Number.isFinite(start) && Number.isFinite(horizon) && Number.isFinite(expiry)
    && start < horizon
    && start < expiry - (document.receiptPublicationReserveSeconds * 1_000),
  'authorized effect start chronology is invalid');
  assert(dirname(document.startEvidencePath) === dirname(document.finishEvidencePath)
    && document.startEvidencePath !== document.finishEvidencePath,
  'authorized effect evidence paths are not distinct siblings');
  assert(Array.isArray(document.effectExecutables)
    && document.effectExecutables.length >= 1
    && document.effectExecutables.length <= 20
    && Array.isArray(document.delegatedArgv)
    && document.delegatedArgv.length >= 1
    && document.delegatedArgv.length <= 256
    && document.delegatedArgv.every((value) => (
      typeof value === 'string' && value.length >= 1 && value.length <= 4_096
    ))
    && Array.isArray(document.writeRoots) && document.writeRoots.length <= 10
    && Array.isArray(document.readRoots) && document.readRoots.length <= 4
    && Array.isArray(document.observedRoots) && document.observedRoots.length <= 2,
  'authorized effect bounded capability collections are invalid');
  const outputArmed = document.actionClass === 'BACKUP_CREATE';
  assert(outputArmed === (
    document.effectOutputPolicy?.status === 'ARMED'
    && document.effectOutputPolicy?.fd === 53
    && document.effectOutputPolicy?.schemaVersion === 1
    && document.effectOutputPolicy?.kind === 'I00_AUTHORIZED_EFFECT_OUTPUT'
    && document.effectOutputPolicy?.maxBytes === 4_096
  ) && (outputArmed || (
    document.effectOutputPolicy !== null
    && typeof document.effectOutputPolicy === 'object'
    && !Array.isArray(document.effectOutputPolicy)
    && Object.keys(document.effectOutputPolicy).length === 0
  )), 'authorized effect output policy differs from its action class');
  if (Object.keys(document.automaticRollback).length !== 0) {
    assert(document.automaticRollback.delegatedArgv.length <= 16
      && document.automaticRollback.recovery.length <= 4_096,
    'authorized effect automatic rollback bounds are invalid');
  }
  return Object.freeze(document);
}

export function validateAuthorizedEffectTerminal(document, startDocument = null) {
  const schema = TERMINAL_SCHEMA(document);
  assert(schema.valid, `authorized effect terminal schema rejected: ${schema.error}`);
  const started = Date.parse(document.effectStartedAtUtc);
  const finished = Date.parse(document.effectFinishedAtUtc);
  const deadline = Date.parse(document.authorizationExpiresAtUtc)
    - (document.receiptPublicationReserveSeconds * 1_000);
  assert(Number.isFinite(started) && Number.isFinite(finished)
    && Number.isFinite(deadline) && started <= finished,
  'authorized effect terminal chronology is invalid');
  const success = document.status === 'AUTHORIZED_EFFECT_COMPLETED';
  const automaticRollbackAbsent =
    Object.keys(document.automaticRollback).length === 0;
  assert((automaticRollbackAbsent
    && document.automaticRollbackAcknowledged === false
    && document.automaticRollbackHandoffSha256 === null)
    || (!automaticRollbackAbsent
      && typeof document.automaticRollbackHandoffSha256 === 'string'
      && /^[0-9a-f]{64}$/u.test(document.automaticRollbackHandoffSha256)),
  'authorized effect automatic rollback evidence is inconsistent');
  assert(document.exitCode === null || (
    Number.isSafeInteger(document.exitCode)
    && document.exitCode >= 0
    && document.exitCode <= 255
  ), 'authorized effect terminal exit code is invalid');
  assert(success === (
    document.exitCode === 0
    && document.signal === null
    && document.forced === false
    && document.timedOut === false
    && document.automaticRollbackAcknowledged === false
    && document.programBindingRetained === true
    && document.effectMayHaveMutated === false
    && document.successRecorderEligible === true
    && finished < deadline
  ), 'authorized effect terminal success semantics are invalid');
  const backupOutputBound = document.actionClass === 'BACKUP_CREATE'
    && document.effectOutput?.status === 'BOUND';
  const outputPolicyAbsent = document.actionClass !== 'BACKUP_CREATE'
    && document.effectOutput?.status === 'NOT_APPLICABLE';
  assert((backupOutputBound || outputPolicyAbsent || (
    document.actionClass === 'BACKUP_CREATE'
    && ['MISSING', 'INVALID', 'AMBIGUOUS'].includes(document.effectOutput?.status)
  )), 'authorized effect terminal output status is invalid');
  assert(!success || backupOutputBound || outputPolicyAbsent,
    'authorized effect completion lacks its class output binding');
  if (backupOutputBound) {
    assert(Number.isSafeInteger(document.effectOutput.databaseBytes)
      && document.effectOutput.databaseBytes > 0
      && document.effectOutput.databaseBytes <= 128 * 1024 * 1024 * 1024
      && document.effectOutput.outputPath.endsWith(
        `/${document.effectOutput.outputRelativePath}`,
      )
      && document.effectOutput.receiptRelativePath
        === `${document.effectOutput.outputRelativePath}/manifest.json`
      && document.effectOutput.beforeInventorySha256
        !== document.effectOutput.afterInventorySha256,
    'authorized effect bound output semantics are invalid');
  }
  assert(!(document.actionClass === 'BACKUP_CREATE'
    && document.exitCode === 0
    && document.signal === null
    && document.forced === false
    && document.timedOut === false
    && document.programBindingRetained === true
    && ['MISSING', 'INVALID', 'AMBIGUOUS'].includes(document.effectOutput.status))
    || (!success
      && document.effectMayHaveMutated === true
      && document.successRecorderEligible === false),
  'authorized effect unresolved-output semantics are invalid');
  if (!success) {
    assert(document.effectMayHaveMutated === true
      && document.successRecorderEligible === false,
    'terminated effect must remain ineligible for success recording');
  }
  if (startDocument !== null) {
    validateAuthorizedEffectStart(startDocument);
    assert(COMMON_FIELDS.every((field) => (
      JSON.stringify(document[field]) === JSON.stringify(startDocument[field])
    )), 'authorized effect terminal does not bind the exact start controls');
    assert(document.startEvidenceSha256 === authorizedEffectEvidenceSha256(startDocument),
      'authorized effect terminal does not bind the exact start evidence digest');
  }
  return Object.freeze(document);
}

// ONE AGREED CONTRACT for the backup write-root inventory, imported by both the effect runner
// and the outcome recorder so neither can drift from the other.
//
// SYSTEM effect evidence is a mutable direct child of the backup write root. TEST/STAGING effect
// evidence is instead a sibling of that root. Exclude the evidence entry only when the two exact,
// already-bound paths prove the direct-child relationship; a basename alone is not authority to
// hide an otherwise ordinary backup-root entry.
export function backupComparableInventory(entries, {
  backupRoot,
  effectEvidenceRoot,
}) {
  assert(typeof backupRoot === 'string' && resolve(backupRoot) === backupRoot,
    'backup comparable inventory root is not canonical absolute');
  assert(typeof effectEvidenceRoot === 'string'
    && resolve(effectEvidenceRoot) === effectEvidenceRoot,
    'backup comparable inventory effect evidence root is not canonical absolute');
  const excluded = dirname(effectEvidenceRoot) === backupRoot
    ? basename(effectEvidenceRoot)
    : null;
  return excluded === null ? entries : entries.filter((entry) => entry.name !== excluded);
}
