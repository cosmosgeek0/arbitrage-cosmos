#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, readlinkSync, readSync, realpathSync, writeFileSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';
import { constants as osConstants } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  buildAuthorizationConsumption,
  canonicalJson,
  canonicalJsonBytes,
  readCanonicalDeploymentDocument,
  recheckCanonicalDeploymentDocument,
  sha256Bytes,
  validateDeploymentActionPreview,
  validateDeploymentRiskVersion,
} from '../deployment-authorization-contract.mjs';
import {
  validateAuthorizedEffectStart,
  validateAuthorizedEffectTerminal,
} from '../authorized-effect-evidence.mjs';
import { compileJsonSchemaFile } from '../json-schema.mjs';
import {
  fail, isUtc, requireExactKeys, sha256File, verifyArtifactManifest,
} from '../lib.mjs';

const FIRST_HOST_TARGET = 'NO_PRIOR_RELEASE_FIRST_HOST';
const SHA256_RE = /^[0-9a-f]{64}$/;
const FULL_SHA_RE = /^[0-9a-f]{40}$/;
const INSPECT_EXECUTABLE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspect-executable.mjs',
);
const INSPECT_APP_UNIT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'inspect-app-unit.mjs',
);
const AUTHORIZATION_KEYS = Object.freeze([
  'schemaVersion', 'authorizationId', 'operator', 'status', 'actionClasses',
  'scope', 'deployedSha', 'configVersion', 'riskVersion', 'nonce',
  'serverPreviewDigest', 'account', 'environment', 'host', 'issuedAtUtc',
  'startsAtUtc', 'expiresAtUtc', 'allowedCommands', 'allowedEndpoints',
  'allowedProducts', 'allowedCredentials', 'preconditions', 'maximumEffect',
  'rollback', 'recovery', 'ownerApproval', 'receiptTargets',
]);
const RELEASE_SWITCH_SCHEMA = compileJsonSchemaFile(
  new URL('../schemas/release-switch-receipt.schema.json', import.meta.url),
  'release-switch receipt schema',
);
const RECONCILIATION_SCHEMA = compileJsonSchemaFile(
  new URL('../schemas/release-switch-reconciliation.schema.json', import.meta.url),
  'release-switch reconciliation schema',
);
const CLOSED_ENV = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: '/',
  TMPDIR: '/tmp',
  LANG: 'C',
  LC_ALL: 'C',
});

function parseCli(argv) {
  const flags = new Set(['simulation-clock']);
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) fail(`unexpected argument ${raw}`);
    const key = raw.slice(2);
    if (Object.hasOwn(out, key)) fail(`duplicate argument --${key}`);
    if (flags.has(key)) {
      out[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${raw} requires a value`);
    out[key] = value;
    index += 1;
  }
  return out;
}

function requireOnly(args, allowed) {
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) fail(`unexpected argument --${key}`);
  }
}

function canonicalAbsolute(raw, label) {
  if (typeof raw !== 'string' || raw === '/' || !isAbsolute(raw) || resolve(raw) !== raw) {
    fail(`${label} must be one non-root canonical absolute path`);
  }
  return raw;
}

function safeAncestors(path, label, includeLeaf = true) {
  const parts = path.split('/').filter(Boolean);
  let cursor = '/';
  const limit = includeLeaf ? parts.length : parts.length - 1;
  for (let index = 0; index < limit; index += 1) {
    cursor = resolve(cursor, parts[index]);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      fail(`${label} is unavailable: ${error.message}`);
    }
    if (stat.isSymbolicLink()) fail(`${label} must not traverse a symbolic link`);
    if (index < limit - 1 && !stat.isDirectory()) fail(`${label} has a non-directory ancestor`);
  }
}

function preflightOutput(raw, label) {
  const output = canonicalAbsolute(raw, label);
  safeAncestors(output, `${label} parent`, false);
  const parent = dirname(output);
  let parentStat;
  try {
    parentStat = lstatSync(parent, { bigint: true });
  } catch (error) {
    fail(`${label} parent is unavailable: ${error.message}`);
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent) !== parent) {
    fail(`${label} parent must be one canonical real directory`);
  }
  if ((parentStat.mode & 0o777n) !== 0o700n) {
    fail(`${label} parent must be one canonical mode-0700 directory`);
  }
  if (typeof process.getuid === 'function' && parentStat.uid !== BigInt(process.getuid())) {
    fail(`${label} parent owner must be the invoking identity`);
  }
  try {
    lstatSync(output);
    fail(`${label} must be absent`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return {
    output,
    parent,
    identity: {
      device: parentStat.dev.toString(),
      inode: parentStat.ino.toString(),
      mode: parentStat.mode.toString(8),
      uid: parentStat.uid.toString(),
      gid: parentStat.gid.toString(),
    },
    label,
  };
}

function receiptParentIdentity(output) {
  return [
    `device=${output.identity.device}`,
    `inode=${output.identity.inode}`,
    `mode=${output.identity.mode}`,
    `uid=${output.identity.uid}`,
    `gid=${output.identity.gid}`,
  ].join(',');
}

function requireReceiptRootBinding(risk, ...outputs) {
  const policy = risk.document.artifactPolicy;
  if (!policy || typeof policy.receiptRoot !== 'string'
      || typeof policy.receiptRootIdentity !== 'string') {
    fail('deployment risk lacks its receipt-root identity binding');
  }
  for (const output of outputs) {
    if (output.parent !== policy.receiptRoot
        || receiptParentIdentity(output) !== policy.receiptRootIdentity) {
      fail(`${output.label} parent differs from the deployment receipt-root binding`);
    }
  }
}

function sameEvidenceIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function readSanitizedEnv(raw) {
  const path = canonicalAbsolute(raw, '--env');
  safeAncestors(path, '--env');
  if (typeof constants.O_NOFOLLOW !== 'number'
      || typeof constants.O_NONBLOCK !== 'number') {
    fail('--env runtime lacks required no-follow evidence support');
  }
  let descriptor;
  let namedBefore;
  let openedBefore;
  let openedAfter;
  let namedAfter;
  let bytes;
  try {
    namedBefore = lstatSync(path, { bigint: true });
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink()
        || namedBefore.nlink !== 1n || realpathSync(path) !== path
        || (namedBefore.mode & 0o777n) !== 0o600n
        || namedBefore.size <= 0n || namedBefore.size > 64n * 1024n) {
      fail('--env must be one canonical single-link mode-0600 real file');
    }
    if (typeof process.getuid === 'function'
        && namedBefore.uid !== BigInt(process.getuid())) {
      fail('--env owner must be the invoking identity');
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    openedBefore = fstatSync(descriptor, { bigint: true });
    if (!sameEvidenceIdentity(namedBefore, openedBefore)) {
      fail('--env identity changed before reading');
    }
    const chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > 64 * 1024) fail('--env is too large');
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    bytes = Buffer.concat(chunks);
    openedAfter = fstatSync(descriptor, { bigint: true });
    namedAfter = lstatSync(path, { bigint: true });
    if (!sameEvidenceIdentity(openedBefore, openedAfter)
        || !sameEvidenceIdentity(openedAfter, namedAfter)
        || realpathSync(path) !== path) {
      fail('--env identity changed while reading');
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes) || !text.endsWith('\n')) {
    fail('--env is not canonical sanitized output');
  }
  if (!openedAfter || bytes.length !== Number(openedAfter.size)) {
    fail('--env read length differs from its bound identity');
  }
  if (!openedAfter.isFile() || (openedAfter.mode & 0o777n) !== 0o600n) {
    fail('--env must be one canonical mode-0600 real file');
  }
  const values = {};
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)='([^']*)'$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) fail('--env is not canonical sanitized output');
    values[match[1]] = match[2];
  }
  for (const key of [
    'RELEASES_DIR', 'CURRENT_LINK', 'PREVIOUS_LINK', 'APP_UNIT',
    'HEALTH_BASE', 'POST_SWITCH_GATE_PATHS',
  ]) if (!values[key]) fail(`--env is missing ${key}`);
  return Object.freeze({
    path,
    sha256: sha256Bytes(bytes),
    identity: openedAfter,
    values: Object.freeze(values),
  });
}

function assertSanitizedEnvStable(initial) {
  const current = readSanitizedEnv(initial.path);
  if (current.sha256 !== initial.sha256
      || !sameEvidenceIdentity(current.identity, initial.identity)) {
    fail('--env changed before Gate-5 receipt publication');
  }
}

function canonicalUtc(raw, label) {
  if (!isUtc(raw) || new Date(Date.parse(raw)).toISOString() !== raw.replace('Z', '.000Z')) {
    fail(`${label} must be canonical UTC seconds`);
  }
  return raw;
}

function publicationTime(args) {
  if (args.now !== undefined) {
    if (!args['simulation-clock']) fail('--now is simulation-only');
    return canonicalUtc(args.now, '--now');
  }
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function actionEndpoint(action, prefix, { optional = false } = {}) {
  const marker = `${prefix}:`;
  const values = action.allowedEndpoints
    .filter((entry) => entry.startsWith(marker))
    .map((entry) => entry.slice(marker.length));
  if (optional && values.length === 0) return null;
  if (values.length !== 1) fail(`action preview must bind one ${prefix} endpoint`);
  return values[0];
}

function validateAuthorizationBinding(authorization, risk, preview) {
  requireExactKeys(authorization, AUTHORIZATION_KEYS, 'external authorization');
  if (authorization.schemaVersion !== 2 || authorization.status !== 'APPROVED') {
    fail('external authorization is not one approved v2 record');
  }
  const action = preview.action;
  const binding = preview.binding;
  const window = preview.authorizationWindow;
  if (!sameJson(authorization.actionClasses, [binding.actionClass])
      || authorization.authorizationId !== binding.authorizationId
      || authorization.operator !== binding.operator
      || authorization.deployedSha !== binding.deployedSha
      || authorization.configVersion !== binding.configVersion
      || authorization.riskVersion !== binding.riskVersion
      || authorization.nonce !== binding.nonce
      || authorization.serverPreviewDigest !== preview.serverPreviewDigest
      || authorization.account !== binding.account
      || authorization.environment !== binding.environment
      || authorization.host !== binding.host) {
    fail('external authorization identity differs from the consumed preview');
  }
  if (authorization.issuedAtUtc !== window.issuedAtUtc
      || authorization.startsAtUtc !== window.startsAtUtc
      || authorization.expiresAtUtc !== window.expiresAtUtc) {
    fail('external authorization window differs from the consumed preview');
  }
  if (!sameJson(authorization.allowedCommands, [action.command])
      || !sameJson(authorization.allowedEndpoints, action.allowedEndpoints)
      || !sameJson(authorization.allowedProducts, action.allowedProducts)
      || !sameJson(authorization.allowedCredentials, action.allowedCredentials)
      || !sameJson(authorization.preconditions, action.preconditions)
      || !sameJson(authorization.maximumEffect, action.maximumEffect)
      || authorization.scope !== action.scope
      || authorization.rollback !== action.rollback
      || authorization.recovery !== action.recovery
      || !sameJson(authorization.receiptTargets, action.receiptTargets)) {
    fail('external authorization action differs from the consumed preview');
  }
  requireExactKeys(
    authorization.ownerApproval,
    ['approvedAtUtc', 'approver', 'reference'],
    'external authorization ownerApproval',
  );
  canonicalUtc(authorization.ownerApproval.approvedAtUtc, 'owner approval time');
  if (authorization.ownerApproval.approver !== risk.binding.approver
      || authorization.ownerApproval.reference !== risk.binding.approvalReference) {
    fail('external authorization approval identity differs from the consumed risk');
  }
}

function readAuthorizationChain(args, {
  output,
  reconciliationOutput,
  release,
  testedSha,
  artifactManifestSha256,
  firstHost,
}) {
  let authorization;
  let risk;
  let preview;
  let consumption;
  try {
    authorization = readCanonicalDeploymentDocument(
      canonicalAbsolute(args.authorization, '--authorization'),
      'external authorization',
      (document) => document,
    );
    risk = readCanonicalDeploymentDocument(
      canonicalAbsolute(args['deployment-risk'], '--deployment-risk'),
      'deployment risk version',
      validateDeploymentRiskVersion,
    );
    preview = readCanonicalDeploymentDocument(
      canonicalAbsolute(args['action-preview'], '--action-preview'),
      'deployment action preview',
      (document) => validateDeploymentActionPreview(document, risk.document, risk.sha256),
    );
    consumption = readCanonicalDeploymentDocument(
      canonicalAbsolute(args['authorization-consumption'], '--authorization-consumption'),
      'authorization consumption receipt',
      (document) => document,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  validateAuthorizationBinding(authorization.document, risk.document, preview.document);
  if (risk.document.binding.actionClass !== 'SERVICE_RELEASE_SWITCH') {
    fail('producer chain does not bind SERVICE_RELEASE_SWITCH');
  }
  const permittedModes = args['simulation-clock']
    ? ['TEST_FIXTURE_INJECTED']
    : [
        'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
        'STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
      ];
  if (!permittedModes.includes(risk.document.provenanceMode)
      || preview.document.provenanceMode !== risk.document.provenanceMode) {
    fail('producer provenance mode does not match receipt recording mode');
  }
  let expectedConsumption;
  try {
    expectedConsumption = buildAuthorizationConsumption({
      authorization: authorization.document,
      authorizationSha256: authorization.sha256,
      risk: risk.document,
      riskDocumentSha256: risk.sha256,
      preview: preview.document,
      previewDocumentSha256: preview.sha256,
      consumedAtUtc: consumption.document.consumedAtUtc,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!sameJson(consumption.document, expectedConsumption)) {
    fail('authorization consumption receipt is not the exact producer-bound claim');
  }
  const expectedConsumptionPath = resolve(
    preview.document.singleUse.consumptionRoot,
    `${preview.document.singleUse.claimKey}.json`,
  );
  if (consumption.absolute !== expectedConsumptionPath) {
    fail('authorization consumption receipt path is not the preview-bound claim');
  }
  if (authorization.sha256 !== args['authorization-sha256']) {
    fail('external authorization digest differs from the pre-effect binding');
  }
  if (preview.document.action.receiptTargets.result !== output.output
      || preview.document.action.receiptTargets.reconciliation !== reconciliationOutput.output
      || authorization.document.receiptTargets.result !== output.output
      || authorization.document.receiptTargets.reconciliation !== reconciliationOutput.output) {
    fail('Gate-5 receipt targets differ from the consumed preview');
  }
  if (risk.document.binding.deployedSha !== testedSha
      || actionEndpoint(preview.document.action, 'release-sha') !== testedSha
      || actionEndpoint(preview.document.action, 'artifact-manifest-sha256')
        !== artifactManifestSha256
      || actionEndpoint(preview.document.action, 'release-path') !== release) {
    fail('producer chain differs from the exact Gate-5 release');
  }
  const optionalEndpoints = [
    'recovery-target', 'first-host-evidence-sha256', 'first-host-account',
    'first-host-target-host', 'first-host-environment',
  ];
  if (firstHost) {
    if (actionEndpoint(preview.document.action, 'recovery-target') !== FIRST_HOST_TARGET
        || actionEndpoint(preview.document.action, 'first-host-evidence-sha256')
          !== args['first-host-evidence-sha256']
        || actionEndpoint(preview.document.action, 'first-host-account')
          !== authorization.document.account
        || actionEndpoint(preview.document.action, 'first-host-target-host')
          !== authorization.document.host
        || actionEndpoint(preview.document.action, 'first-host-environment')
          !== authorization.document.environment) {
      fail('producer chain differs from the exact first-host recovery evidence');
    }
  } else if (optionalEndpoints.some(
    (prefix) => actionEndpoint(preview.document.action, prefix, { optional: true }) !== null,
  )) {
    fail('later-release producer chain unexpectedly binds first-host recovery');
  }
  return Object.freeze({ authorization, risk, preview, consumption });
}

function assertAuthorizationChainStable(chain) {
  for (const [label, evidence] of Object.entries(chain)) {
    if (sha256File(evidence.absolute) !== evidence.sha256) {
      fail(`${label} evidence changed before Gate-5 receipt publication`);
    }
  }
}

function readAuthorizedEffect(args, chain) {
  let start;
  let terminal;
  try {
    start = readCanonicalDeploymentDocument(
      canonicalAbsolute(args['effect-start-evidence'], '--effect-start-evidence'),
      'authorized effect start evidence',
      validateAuthorizedEffectStart,
    );
    terminal = readCanonicalDeploymentDocument(
      canonicalAbsolute(args['effect-finish-evidence'], '--effect-finish-evidence'),
      'authorized effect terminal evidence',
      (document) => validateAuthorizedEffectTerminal(document, start.document),
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const action = chain.preview.document.action;
  const risk = chain.risk.document;
  const expectedProgram = {
    path: actionEndpoint(action, 'effect-program-path'),
    sha256: actionEndpoint(action, 'effect-program-sha256'),
    identity: actionEndpoint(action, 'effect-program-identity'),
  };
  const expectedReserve = Number(
    actionEndpoint(action, 'receipt-publication-reserve-seconds'),
  );
  if (!Number.isSafeInteger(expectedReserve) || expectedReserve <= 0) {
    fail('receipt publication reserve endpoint is invalid');
  }
  const permittedProvenance = args['simulation-clock']
    ? ['TEST_FIXTURE_INJECTED']
    : [
        'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
        'STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
      ];
  if (!permittedProvenance.includes(risk.provenanceMode)) {
    fail('Gate-5 outcome publication provenance differs from the recording mode');
  }
  if (start.absolute !== actionEndpoint(action, 'effect-start-evidence')
      || terminal.absolute !== actionEndpoint(action, 'effect-finish-evidence')
      || start.document.actionClass !== 'SERVICE_RELEASE_SWITCH'
      || start.document.authorizationId !== chain.authorization.document.authorizationId
      || start.document.claimKey !== chain.consumption.document.claimKey
      || start.document.consumptionSha256 !== chain.consumption.sha256
      || start.document.riskVersion !== risk.riskVersion
      || start.document.serverPreviewDigest
        !== chain.preview.document.serverPreviewDigest
      || start.document.effectUid !== actionEndpoint(action, 'effect-uid')
      || start.document.effectGid !== actionEndpoint(action, 'effect-gid')
      || !sameJson(start.document.program, expectedProgram)
      || start.document.authorizationExpiresAtUtc
        !== chain.authorization.document.expiresAtUtc
      || start.document.authorizationExpiresAtUtc
        !== risk.authorizationWindow.expiresAtUtc
      || start.document.evidenceValidUntilUtc !== risk.evidenceValidUntilUtc
      || start.document.receiptPublicationReserveSeconds !== expectedReserve
      || start.document.startEvidencePath !== start.absolute
      || start.document.finishEvidencePath !== terminal.absolute) {
    fail('authorized effect evidence differs from the consumed producer chain');
  }
  if (risk.action.receiptPublicationReserveSeconds !== expectedReserve
      || actionEndpoint(action, 'completion-reserve-seconds')
        !== String(risk.action.completionReserveSeconds)) {
    fail('authorized effect reserve controls differ from the consumed risk');
  }
  const success = terminal.document.status === 'AUTHORIZED_EFFECT_COMPLETED';
  if (success) {
    if (terminal.document.exitCode !== 0
        || terminal.document.signal !== null
        || terminal.document.forced !== false
        || terminal.document.timedOut !== false
        || terminal.document.programBindingRetained !== true
        || terminal.document.effectMayHaveMutated !== false
        || terminal.document.successRecorderEligible !== true) {
      fail('completed authorized effect terminal is not eligible for success publication');
    }
  } else if (terminal.document.status !== 'AUTHORIZED_EFFECT_TERMINATED'
      || terminal.document.effectMayHaveMutated !== true
      || terminal.document.successRecorderEligible !== false) {
    fail('terminated authorized effect terminal is not eligible for failure publication');
  }
  let expectedRunnerExitCode;
  if (success) {
    expectedRunnerExitCode = 0;
  } else if (Number.isInteger(terminal.document.exitCode)
      && terminal.document.exitCode > 0 && terminal.document.exitCode <= 255) {
    expectedRunnerExitCode = terminal.document.exitCode;
  } else if (typeof terminal.document.signal === 'string'
      && Number.isInteger(osConstants.signals?.[terminal.document.signal])) {
    expectedRunnerExitCode = Math.min(
      255,
      128 + osConstants.signals[terminal.document.signal],
    );
  } else {
    expectedRunnerExitCode = terminal.document.timedOut ? 124 : 1;
  }
  if (Number(args['donor-exit-code']) !== expectedRunnerExitCode) {
    fail('runner exit code differs from the authorized effect terminal');
  }
  const authorizedEffect = Object.freeze({
    startEvidencePath: start.absolute,
    startEvidenceSha256: start.sha256,
    terminalEvidencePath: terminal.absolute,
    terminalEvidenceSha256: terminal.sha256,
    effectStartedAtUtc: start.document.effectStartedAtUtc,
    effectFinishedAtUtc: terminal.document.effectFinishedAtUtc,
    terminalStatus: terminal.document.status,
    exitCode: terminal.document.exitCode,
    receiptPublicationReserveSeconds: start.document.receiptPublicationReserveSeconds,
    claimKey: start.document.claimKey,
    consumptionSha256: start.document.consumptionSha256,
    program: Object.freeze({ ...start.document.program }),
    signal: terminal.document.signal,
    forced: terminal.document.forced,
    timedOut: terminal.document.timedOut,
    programBindingRetained: terminal.document.programBindingRetained,
    effectMayHaveMutated: terminal.document.effectMayHaveMutated,
    successRecorderEligible: terminal.document.successRecorderEligible,
    runnerExitCode: Number(args['donor-exit-code']),
    receiptRoot: Object.freeze({
      path: risk.artifactPolicy.receiptRoot,
      identity: risk.artifactPolicy.receiptRootIdentity,
    }),
  });
  return Object.freeze({
    start, terminal, authorizedEffect, success,
  });
}

function assertAuthorizedEffectStable(effect) {
  try {
    recheckCanonicalDeploymentDocument(
      effect.start,
      'authorized effect start evidence',
      validateAuthorizedEffectStart,
    );
    recheckCanonicalDeploymentDocument(
      effect.terminal,
      'authorized effect terminal evidence',
      (document) => validateAuthorizedEffectTerminal(document, effect.start.document),
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function validateAuthorizedChronology({
  startedAtUtc,
  effectFinishedAtUtc,
  completedAtUtc,
  authorization,
  risk,
  consumption,
}) {
  const issuedAt = Date.parse(risk.authorizationWindow.issuedAtUtc);
  const startsAt = Date.parse(risk.authorizationWindow.startsAtUtc);
  const expiresAt = Date.parse(risk.authorizationWindow.expiresAtUtc);
  const approvedAt = Date.parse(authorization.ownerApproval.approvedAtUtc);
  const consumedAt = Date.parse(consumption.consumedAtUtc);
  const startedAt = Date.parse(startedAtUtc);
  const effectFinishedAt = Date.parse(effectFinishedAtUtc);
  const completedAtValue = Date.parse(completedAtUtc);
  if (![issuedAt, startsAt, expiresAt, approvedAt, consumedAt, startedAt,
    effectFinishedAt, completedAtValue].every(Number.isFinite)
      || !(issuedAt <= approvedAt && approvedAt <= startsAt
        && startsAt <= consumedAt && consumedAt <= startedAt
        && startedAt <= effectFinishedAt && effectFinishedAt <= completedAtValue
        && completedAtValue < expiresAt)) {
    fail('Gate-5 chronology must satisfy issue <= approval <= authorization start <= consumption <= effect start <= effect finish <= completion < expiry');
  }
}

function statIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function safeSymlinkState(path, expectedTarget, label) {
  safeAncestors(path, label, false);
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  if (!stat.isSymbolicLink()) fail(`${label} must be a symbolic link`);
  const target = resolve(dirname(path), readlinkSync(path));
  if (expectedTarget && target !== expectedTarget) fail(`${label} target differs from the exact release`);
  if (realpathSync(path) !== target) fail(`${label} does not resolve to its recorded target`);
  return { link: path, target, identity: statIdentity(stat) };
}

function absentPath(path, label) {
  safeAncestors(path, label, false);
  try {
    lstatSync(path);
    fail(`${label} must be absent`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function inspectExecutableBinding(raw, label) {
  const path = canonicalAbsolute(raw, label);
  const result = spawnSync(
    process.execPath,
    [INSPECT_EXECUTABLE, '--path', path],
    {
      encoding: 'utf8',
      env: CLOSED_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
      maxBuffer: 16 * 1024,
      windowsHide: true,
    },
  );
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
  requireExactKeys(
    inspected.identity,
    ['device', 'inode', 'mode', 'size', 'mtimeNs', 'ctimeNs'],
    `${label} executable identity`,
  );
  if (inspected.status !== 'EXECUTABLE_IDENTITY_VERIFIED'
      || inspected.path !== path
      || !SHA256_RE.test(inspected.sha256)
      || typeof inspected.endpointIdentity !== 'string') {
    fail(`${label} executable inspection is invalid`);
  }
  return inspected;
}

function authorizedExecutableBinding(action, prefix, raw) {
  const label = `--${prefix}`;
  const inspected = inspectExecutableBinding(raw, label);
  if (actionEndpoint(action, `${prefix}-path`) !== inspected.path
      || actionEndpoint(action, `${prefix}-sha256`) !== inspected.sha256
      || actionEndpoint(action, `${prefix}-identity`) !== inspected.endpointIdentity) {
    fail(`${label} executable differs from the authorized preview binding`);
  }
  return Object.freeze(inspected);
}

function recheckExecutableBinding(expected, label) {
  const current = inspectExecutableBinding(expected.path, label);
  if (!sameJson(current, expected)) {
    fail(`${label} executable changed around Gate-5 use`);
  }
}

function requireSystemctl(binding, unit) {
  recheckExecutableBinding(binding, '--systemctl');
  const result = spawnSync(binding.path, ['is-active', unit], {
    encoding: 'utf8',
    env: CLOSED_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 4_096,
    windowsHide: true,
  });
  recheckExecutableBinding(binding, '--systemctl');
  if (result.error || result.signal || result.status !== 0
      || result.stdout !== 'active\n' || result.stderr !== '') {
    fail(`application unit is not exactly active after the switch: ${result.error?.message ?? result.signal ?? `exit ${String(result.status)}`}`);
  }
}

function requireBoundAppUnit(action, {
  systemctlBinding,
  nodeBinding,
  envBinding,
  unit,
}) {
  const bindingSha256 = actionEndpoint(action, 'app-unit-binding-sha256');
  const stagingRoot = actionEndpoint(action, 'app-unit-staging-root');
  const inspectionArguments = [
    INSPECT_APP_UNIT,
    '--systemctl', systemctlBinding.path,
    '--unit', unit,
    '--node', nodeBinding.path,
    '--env', envBinding.path,
    '--runtime-env', actionEndpoint(action, 'app-unit-environment-file-path'),
    '--provenance-mode', 'SYSTEM',
    '--expected-fragment-path', actionEndpoint(action, 'app-unit-fragment-path'),
    '--expected-fragment-source', actionEndpoint(
      action,
      'app-unit-fragment-source-path',
    ),
    '--expected-binding-sha256', bindingSha256,
  ];
  if (stagingRoot !== 'NONE') fail('Gate-5 SYSTEM publication rejects staging app authority');
  const result = spawnSync(process.execPath, inspectionArguments, {
    encoding: 'utf8',
    env: CLOSED_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== '') {
    fail('Gate-5 bound application unit inspection failed');
  }
  let inspected;
  try {
    inspected = JSON.parse(result.stdout);
  } catch {
    fail('Gate-5 bound application unit inspection returned invalid JSON');
  }
  requireExactKeys(inspected, [
    'schemaVersion', 'status', 'inspectionMode', 'systemctlPath',
    'offlineUnitRoot', 'systemdAnalyzePath', 'systemdAnalyzeSha256',
    'systemdAnalyzeIdentity', 'systemdAnalyzeEndpointIdentity', 'unit', 'fragmentPath',
    'fragmentSha256', 'fragmentIdentity', 'fragmentEndpointIdentity',
    'fragmentSourcePath', 'fragmentSourceSha256', 'fragmentSourceIdentity',
    'fragmentSourceEndpointIdentity',
    'dropInPaths', 'needDaemonReload', 'user', 'group', 'workingDirectory',
    'dropInState', 'proofDropInPath', 'proofDropInSha256',
    'dropInBindings', 'dropInSetEndpoint', 'dropInSetSha256',
    'environmentFilesSha256', 'providerBindingSha256', 'providerUnit',
    'providerFragmentPath', 'providerFragmentSha256',
    'providerFragmentEndpointIdentity', 'providerState',
    'providerDeploymentRiskPath', 'providerActionPreviewPath',
    'proofDropInIdentity', 'proofDropInEndpointIdentity', 'proofDropInOwner',
    'proofDropInRuntimeLinkPath', 'proofDropInRuntimeLinkIdentity',
    'proofDropInRuntimeLinkEndpointIdentity', 'proofAbsentSentinel',
    'environmentFiles', 'unsetEnvironment', 'unsetEnvironmentSha256',
    'namespaceRemapState', 'executionAuthorityState', 'environmentAuthorityState',
    'identityAuthorityState', 'authorityClosureSha256', 'effectReachability',
    'runtimeEnvPath', 'runtimeEnvSha256',
    'runtimeEnvIdentity', 'runtimeEnvEndpointIdentity', 'execStart',
    'execStartSha256', 'bindingSha256',
  ], 'Gate-5 bound application unit inspection');
  if (inspected.schemaVersion !== 4
      || inspected.status !== 'APP_UNIT_BINDING_VERIFIED'
      || inspected.inspectionMode !== 'LIVE_SYSTEM_MANAGER'
      || inspected.inspectionMode !== actionEndpoint(action, 'app-unit-inspection-mode')
      || inspected.systemctlPath !== systemctlBinding.path
      || inspected.offlineUnitRoot !== null
      || inspected.systemdAnalyzePath !== null
      || inspected.systemdAnalyzeSha256 !== null
      || inspected.systemdAnalyzeIdentity !== null
      || inspected.systemdAnalyzeEndpointIdentity !== null
      || actionEndpoint(action, 'app-unit-offline-unit-root') !== 'NONE'
      || actionEndpoint(action, 'systemd-analyze-path') !== 'NONE'
      || actionEndpoint(action, 'systemd-analyze-sha256') !== 'NONE'
      || actionEndpoint(action, 'systemd-analyze-identity') !== 'NONE'
      || inspected.unit !== unit
      || inspected.unit !== actionEndpoint(action, 'app-unit-name')
      || inspected.fragmentPath !== actionEndpoint(action, 'app-unit-fragment-path')
      || inspected.fragmentSha256 !== actionEndpoint(action, 'app-unit-fragment-sha256')
      || inspected.fragmentEndpointIdentity !== actionEndpoint(
        action,
        'app-unit-fragment-identity',
      )
      || inspected.fragmentSourcePath !== actionEndpoint(
        action,
        'app-unit-fragment-source-path',
      )
      || inspected.fragmentSourceSha256 !== actionEndpoint(
        action,
        'app-unit-fragment-source-sha256',
      )
      || inspected.fragmentSourceEndpointIdentity !== actionEndpoint(
        action,
        'app-unit-fragment-source-identity',
      )
      || !Array.isArray(inspected.dropInPaths)
      || inspected.dropInPaths.length !== 3
      || !Array.isArray(inspected.dropInBindings)
      || inspected.dropInBindings.length !== 3
      || inspected.dropInSetEndpoint !== actionEndpoint(
        action,
        'app-unit-drop-in-set',
      )
      || inspected.environmentFilesSha256 !== actionEndpoint(
        action,
        'app-unit-environment-files-sha256',
      )
      || inspected.providerBindingSha256 !== actionEndpoint(
        action,
        'app-unit-provider-binding-sha256',
      )
      || inspected.providerUnit !== actionEndpoint(action, 'app-unit-provider-unit')
      || inspected.providerFragmentPath !== actionEndpoint(
        action,
        'app-unit-provider-fragment-path',
      )
      || inspected.providerFragmentSha256 !== actionEndpoint(
        action,
        'app-unit-provider-fragment-sha256',
      )
      || inspected.providerFragmentEndpointIdentity !== actionEndpoint(
        action,
        'app-unit-provider-fragment-identity',
      )
      || inspected.providerState !== actionEndpoint(
        action,
        'app-unit-provider-state',
      )
      || inspected.providerDeploymentRiskPath !== actionEndpoint(
        action,
        'app-unit-provider-deployment-risk-path',
      )
      || inspected.providerActionPreviewPath !== actionEndpoint(
        action,
        'app-unit-provider-action-preview-path',
      )
      || actionEndpoint(action, 'app-unit-drop-in-state') !== 'EXACT_PROVIDER_BOUND'
      || inspected.dropInState !== 'EXACT_PROVIDER_BOUND'
      || inspected.proofDropInPath !== null
      || inspected.proofDropInSha256 !== null
      || inspected.proofDropInIdentity !== null
      || inspected.proofDropInEndpointIdentity !== null
      || inspected.proofDropInOwner !== 'NONE'
      || inspected.proofDropInRuntimeLinkPath !== null
      || inspected.proofDropInRuntimeLinkIdentity !== null
      || inspected.proofDropInRuntimeLinkEndpointIdentity !== null
      || inspected.proofAbsentSentinel !== null
      || actionEndpoint(action, 'app-unit-proof-drop-in-path') !== 'NONE'
      || actionEndpoint(action, 'app-unit-proof-drop-in-sha256') !== 'NONE'
      || actionEndpoint(action, 'app-unit-proof-drop-in-identity') !== 'NONE'
      || actionEndpoint(action, 'app-unit-proof-drop-in-owner') !== 'NONE'
      || actionEndpoint(action, 'app-unit-proof-drop-in-runtime-link-path') !== 'NONE'
      || actionEndpoint(action, 'app-unit-proof-drop-in-runtime-link-identity') !== 'NONE'
      || actionEndpoint(action, 'app-unit-proof-absent-sentinel') !== 'NONE'
      || inspected.runtimeEnvPath !== actionEndpoint(
        action,
        'app-unit-environment-file-path',
      )
      || inspected.runtimeEnvSha256 !== actionEndpoint(
        action,
        'app-unit-environment-file-sha256',
      )
      || inspected.runtimeEnvEndpointIdentity !== actionEndpoint(
        action,
        'app-unit-environment-file-identity',
      )
      || actionEndpoint(action, 'app-unit-environment-file-optional') !== 'no'
      || inspected.environmentFiles?.length !== 2
      || inspected.environmentFiles?.[0]?.path !== inspected.runtimeEnvPath
      || inspected.environmentFiles?.[0]?.optional !== false
      || inspected.environmentFiles?.[1]?.path !== '/etc/cosmos/cosmos-i00.env'
      || inspected.environmentFiles?.[1]?.optional !== false
      || inspected.user !== 'cosmos'
      || inspected.user !== actionEndpoint(action, 'app-unit-user')
      || inspected.group !== 'cosmos'
      || inspected.group !== actionEndpoint(action, 'app-unit-group')
      || inspected.workingDirectory !== '/opt/cosmos/current'
      || inspected.workingDirectory !== actionEndpoint(
        action,
        'app-unit-working-directory',
      )
      || inspected.namespaceRemapState !== 'NONE'
      || inspected.namespaceRemapState !== actionEndpoint(
        action,
        'app-unit-namespace-remap-state',
      )
      || inspected.executionAuthorityState !== 'CLOSED'
      || inspected.environmentAuthorityState !== 'EXACT_PROVIDER_CREDENTIAL'
      || inspected.identityAuthorityState !== 'CLOSED'
      || inspected.authorityClosureSha256 !== actionEndpoint(
        action,
        'app-unit-authority-closure-sha256',
      )
      || inspected.effectReachability !== actionEndpoint(
        action,
        'app-unit-effect-reachability',
      )
      || inspected.unsetEnvironmentSha256 !== actionEndpoint(
        action,
        'app-unit-unset-environment-sha256',
      )
      || inspected.needDaemonReload !== 'no'
      || inspected.needDaemonReload !== actionEndpoint(
        action,
        'app-unit-need-daemon-reload',
      )
      || inspected.execStart?.path !== envBinding.path
      || inspected.execStart?.path !== actionEndpoint(
        action,
        'app-unit-exec-start-env-path',
      )
      || inspected.execStart?.argv?.[2] !== nodeBinding.path
      || inspected.execStart?.argv?.[2] !== actionEndpoint(
        action,
        'app-unit-exec-start-node-path',
      )
      || inspected.execStart?.argv?.[3]
        !== '/usr/local/lib/cosmos-ops/i00/bin/app-entrypoint.mjs'
      || inspected.execStartSha256 !== actionEndpoint(
        action,
        'app-unit-exec-start-sha256',
      )
      || inspected.bindingSha256 !== bindingSha256) {
    fail('Gate-5 application unit differs from the consumed preview');
  }
}

function requireHealth(binding, base, paths) {
  for (const gatePath of paths) {
    recheckExecutableBinding(binding, '--curl');
    const result = spawnSync(binding.path, [
      '--fail', '--silent', '--show-error',
      '--connect-timeout', '2', '--max-time', '5', '--max-redirs', '0',
      '--proto', '=http', '--noproxy', '*',
      '--output', '/dev/null', '--write-out', '%{http_code}',
      `${base}${gatePath}`,
    ], {
      encoding: 'utf8',
      env: CLOSED_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 7_000,
      maxBuffer: 4_096,
      windowsHide: true,
    });
    recheckExecutableBinding(binding, '--curl');
    if (result.error || result.signal || result.status !== 0
        || result.stdout !== '200' || result.stderr !== '') {
      fail(`Gate-5 loopback health failed for ${gatePath}: ${result.error?.message ?? result.signal ?? `exit ${String(result.status)}`}`);
    }
  }
}

function captureSwitchState(env, verified, artifactManifestSha256, firstHost) {
  const releaseDestination = `${env.RELEASES_DIR}/${verified.release.releaseId}`;
  const currentLink = safeSymlinkState(env.CURRENT_LINK, releaseDestination, 'CURRENT_LINK');
  let currentStat;
  try {
    currentStat = lstatSync(currentLink.target, { bigint: true });
  } catch (error) {
    fail(`deployed release target is unavailable: ${error.message}`);
  }
  if (currentStat.isSymbolicLink() || !currentStat.isDirectory()
      || (currentStat.mode & 0o222n) !== 0n
      || realpathSync(currentLink.target) !== currentLink.target) {
    fail('deployed release target must be one canonical immutable real directory');
  }
  const deployed = verifyArtifactManifest(
    currentLink.target, null, { installedImmutable: true },
  );
  if (deployed.release.releaseId !== verified.release.releaseId
      || deployed.release.testedSha !== verified.release.testedSha
      || deployed.artifactManifestSha256 !== artifactManifestSha256) {
    fail('deployed release target differs from the authorized artifact');
  }

  let previous;
  let previousIdentity;
  if (firstHost) {
    absentPath(env.PREVIOUS_LINK, 'PREVIOUS_LINK');
    previous = { link: env.PREVIOUS_LINK, state: 'ABSENT', target: null };
    previousIdentity = { state: 'ABSENT' };
  } else {
    const previousLink = safeSymlinkState(env.PREVIOUS_LINK, null, 'PREVIOUS_LINK');
    const prefix = `${env.RELEASES_DIR}/`;
    const releaseName = previousLink.target.startsWith(prefix)
      ? previousLink.target.slice(prefix.length) : '';
    if (!/^i00-[0-9a-f]{40}$/.test(releaseName)
        || previousLink.target === currentLink.target) {
      fail('PREVIOUS_LINK is not one distinct direct release child');
    }
    let previousStat;
    try {
      previousStat = lstatSync(previousLink.target, { bigint: true });
    } catch (error) {
      fail(`previous release target is unavailable: ${error.message}`);
    }
    if (previousStat.isSymbolicLink() || !previousStat.isDirectory()
        || (previousStat.mode & 0o222n) !== 0n
        || realpathSync(previousLink.target) !== previousLink.target) {
      fail('previous release target must be one canonical immutable real directory');
    }
    const previousRelease = verifyArtifactManifest(
      previousLink.target, null, { installedImmutable: true },
    );
    if (previousRelease.release.releaseId !== releaseName
        || previousRelease.release.testedSha !== releaseName.slice('i00-'.length)) {
      fail('previous release target identity is contradictory');
    }
    previous = { link: env.PREVIOUS_LINK, state: 'PRESENT', target: previousLink.target };
    previousIdentity = {
      link: previousLink,
      target: statIdentity(previousStat),
      artifactManifestSha256: previousRelease.artifactManifestSha256,
    };
  }

  return {
    current: {
      link: env.CURRENT_LINK,
      target: currentLink.target,
      releaseId: verified.release.releaseId,
    },
    previous,
    identity: {
      currentLink,
      currentTarget: statIdentity(currentStat),
      deployedArtifactManifestSha256: deployed.artifactManifestSha256,
      previous: previousIdentity,
    },
  };
}

function exactCreate(output, bytes, parentBefore, requireLinuxAnchor) {
  if (typeof constants.O_NOFOLLOW !== 'number'
      || typeof constants.O_DIRECTORY !== 'number') {
    fail(`${parentBefore.label} runtime lacks required no-follow publication support`);
  }
  let fd;
  let parentFd;
  let anchoredOutput;
  try {
    parentFd = openSync(
      parentBefore.parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const openedParent = fstatSync(parentFd, { bigint: true });
    const namedParent = lstatSync(parentBefore.parent, { bigint: true });
    if (!openedParent.isDirectory() || namedParent.isSymbolicLink()
        || openedParent.dev !== namedParent.dev || openedParent.ino !== namedParent.ino
        || openedParent.dev.toString() !== parentBefore.identity.device
        || openedParent.ino.toString() !== parentBefore.identity.inode
        || openedParent.mode.toString(8) !== parentBefore.identity.mode
        || openedParent.uid.toString() !== parentBefore.identity.uid
        || openedParent.gid.toString() !== parentBefore.identity.gid
        || (openedParent.mode & 0o777n) !== 0o700n
        || realpathSync(parentBefore.parent) !== parentBefore.parent) {
      throw new Error(`${parentBefore.label} parent identity changed before receipt creation`);
    }
    if (process.platform === 'linux') {
      const descriptorParent = `/proc/self/fd/${parentFd}`;
      if (realpathSync(descriptorParent) !== parentBefore.parent) {
        throw new Error(
          `${parentBefore.label} descriptor-relative parent is not the bound directory`,
        );
      }
      anchoredOutput = `${descriptorParent}/${basename(output)}`;
    } else {
      if (requireLinuxAnchor) {
        throw new Error(
          `${parentBefore.label} production publication requires Linux descriptor-relative creation`,
        );
      }
      anchoredOutput = output;
    }
    fd = openSync(
      anchoredOutput,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const created = fstatSync(fd, { bigint: true });
    fchmodSync(fd, 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    const opened = fstatSync(fd, { bigint: true });
    const named = lstatSync(output, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || named.isSymbolicLink()
        || opened.dev !== created.dev || opened.ino !== created.ino
        || opened.dev !== named.dev || opened.ino !== named.ino
        || opened.size !== BigInt(bytes.length)
        || (opened.mode & 0o777n) !== 0o600n
        || realpathSync(output) !== output) {
      throw new Error(`${parentBefore.label} is not one canonical mode-0600 file`);
    }
    const readback = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < readback.length) {
      const count = readSync(fd, readback, offset, readback.length - offset, offset);
      if (count <= 0) throw new Error(`${parentBefore.label} readback ended early`);
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(fd, extra, 0, 1, offset) !== 0 || !readback.equals(bytes)) {
      throw new Error(`${parentBefore.label} readback differs from the canonical receipt`);
    }
    fsyncSync(parentFd);
    const finalParent = lstatSync(parentBefore.parent, { bigint: true });
    if (finalParent.isSymbolicLink()
        || finalParent.dev.toString() !== parentBefore.identity.device
        || finalParent.ino.toString() !== parentBefore.identity.inode
        || finalParent.mode.toString(8) !== parentBefore.identity.mode
        || finalParent.uid.toString() !== parentBefore.identity.uid
        || finalParent.gid.toString() !== parentBefore.identity.gid
        || realpathSync(parentBefore.parent) !== parentBefore.parent) {
      throw new Error(`${parentBefore.label} parent identity changed during receipt creation`);
    }
  } catch (error) {
    fail(
      `${parentBefore.label} exact-create failed; any created reservation is retained `
      + `for owner reconciliation: ${error.message}`,
    );
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
    if (parentFd !== undefined) {
      try { closeSync(parentFd); } catch {}
    }
  }
}

const args = parseCli(process.argv.slice(2));

requireOnly(args, new Set([
  'output', 'release', 'env', 'authorization-sha256', 'artifact-manifest-sha256',
  'authorization', 'deployment-risk', 'action-preview', 'authorization-consumption',
  'reconciliation-output',
  'recovery-target', 'first-host-evidence-sha256', 'systemctl', 'curl',
  'donor-exit-code', 'effect-start-evidence', 'effect-finish-evidence',
  'simulation-clock', 'now',
]));
for (const key of [
  'output', 'release', 'env', 'authorization-sha256', 'artifact-manifest-sha256',
  'authorization', 'deployment-risk', 'action-preview', 'authorization-consumption',
  'reconciliation-output',
  'systemctl', 'curl', 'donor-exit-code', 'effect-start-evidence',
  'effect-finish-evidence',
]) if (!args[key]) fail(`--${key} is required`);
if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(args['donor-exit-code'])
    || Number(args['donor-exit-code']) > 255) {
  fail('--donor-exit-code must be one decimal runner exit code');
}
if (!SHA256_RE.test(args['authorization-sha256'])) fail('--authorization-sha256 must be lowercase SHA-256');
if (!SHA256_RE.test(args['artifact-manifest-sha256'])) fail('--artifact-manifest-sha256 must be lowercase SHA-256');
const firstHost = args['recovery-target'] !== undefined;
if (firstHost) {
  if (args['recovery-target'] !== FIRST_HOST_TARGET) fail(`--recovery-target must be ${FIRST_HOST_TARGET}`);
  if (!SHA256_RE.test(args['first-host-evidence-sha256'] ?? '')) {
    fail('--first-host-evidence-sha256 is required for first-host receipts');
  }
} else if (args['first-host-evidence-sha256'] !== undefined) {
  fail('--first-host-evidence-sha256 requires the exact first-host recovery target');
}

const output = preflightOutput(args.output, '--output');
const reconciliationOutput = preflightOutput(
  args['reconciliation-output'],
  '--reconciliation-output',
);
if (output.output === reconciliationOutput.output) {
  fail('Gate-5 receipt targets must be distinct');
}
const release = canonicalAbsolute(args.release, '--release');
safeAncestors(release, '--release');
const verified = verifyArtifactManifest(release);
const testedSha = verified.release.testedSha;
if (!FULL_SHA_RE.test(testedSha) || verified.release.releaseId !== `i00-${testedSha}`) {
  fail('release identity is invalid');
}
if (verified.artifactManifestSha256 !== args['artifact-manifest-sha256']
    || sha256File(resolve(release, 'artifact-manifest.json')) !== args['artifact-manifest-sha256']) {
  fail('artifact manifest differs from the authorized release');
}
const chain = readAuthorizationChain(args, {
  output,
  reconciliationOutput,
  release,
  testedSha,
  artifactManifestSha256: args['artifact-manifest-sha256'],
  firstHost,
});
requireReceiptRootBinding(chain.risk, output, reconciliationOutput);
const effect = readAuthorizedEffect(args, chain);
const nodeBinding = authorizedExecutableBinding(
  chain.preview.document.action,
  'node',
  realpathSync(process.execPath),
);
const systemctlBinding = authorizedExecutableBinding(
  chain.preview.document.action,
  'systemctl',
  args.systemctl,
);
const curlBinding = authorizedExecutableBinding(
  chain.preview.document.action,
  'curl',
  args.curl,
);
const productionEvidence = chain.risk.document.provenanceMode
  === 'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE';
const envBinding = productionEvidence
  ? authorizedExecutableBinding(
    chain.preview.document.action,
    'env',
    actionEndpoint(chain.preview.document.action, 'env-path'),
  )
  : null;
const sanitizedEnv = readSanitizedEnv(args.env);
if (sanitizedEnv.sha256
    !== actionEndpoint(chain.preview.document.action, 'donor-env-sha256')) {
  fail('--env digest differs from the consumed preview');
}
const env = sanitizedEnv.values;
if (env.APP_UNIT !== 'cosmos-app.service'
    || env.HEALTH_BASE !== 'http://127.0.0.1:8080'
    || env.POST_SWITCH_GATE_PATHS !== '/health/live /health/ready') {
  fail('Gate-5 service or post-switch health contract is not exact');
}
if (!effect.success) {
  if (args['donor-exit-code'] === '0') {
    fail('terminated release effect requires a nonzero runner exit code');
  }
  recheckExecutableBinding(nodeBinding, 'release failure recorder Node');
  assertSanitizedEnvStable(sanitizedEnv);
  assertAuthorizationChainStable(chain);
  assertAuthorizedEffectStable(effect);
  const recordedAtUtc = publicationTime(args);
  validateAuthorizedChronology({
    startedAtUtc: effect.authorizedEffect.effectStartedAtUtc,
    effectFinishedAtUtc: effect.authorizedEffect.effectFinishedAtUtc,
    completedAtUtc: recordedAtUtc,
    authorization: chain.authorization.document,
    risk: chain.risk.document,
    consumption: chain.consumption.document,
  });
  const failedReceipt = {
    schemaVersion: 2,
    kind: 'RELEASE_SWITCH',
    releaseId: verified.release.releaseId,
    testedSha,
    deployedSha: null,
    artifactManifestSha256: args['artifact-manifest-sha256'],
    authorizationId: chain.authorization.document.authorizationId,
    authorizationSha256: chain.authorization.sha256,
    riskVersion: chain.risk.document.riskVersion,
    riskDocumentSha256: chain.risk.sha256,
    serverPreviewDigest: chain.preview.document.serverPreviewDigest,
    previewDocumentSha256: chain.preview.sha256,
    authorizationConsumption: {
      claimKey: chain.consumption.document.claimKey,
      sha256: chain.consumption.sha256,
      consumedAtUtc: chain.consumption.document.consumedAtUtc,
    },
    authorizedEffect: effect.authorizedEffect,
    recoveryTarget: firstHost ? FIRST_HOST_TARGET : null,
    firstHostEvidenceSha256: firstHost ? args['first-host-evidence-sha256'] : null,
    current: null,
    previous: null,
    service: { unit: env.APP_UNIT, state: 'UNKNOWN' },
    postSwitchGate: {
      base: env.HEALTH_BASE,
      paths: env.POST_SWITCH_GATE_PATHS.split(' '),
      status: 'UNKNOWN',
    },
    donorExitCode: effect.terminal.document.exitCode,
    status: 'RELEASE_SWITCH_FAILED_AFTER_EFFECT',
    startedAtUtc: effect.authorizedEffect.effectStartedAtUtc,
    completedAtUtc: effect.authorizedEffect.effectFinishedAtUtc,
    recordedAtUtc,
  };
  const failedValidation = RELEASE_SWITCH_SCHEMA(failedReceipt);
  if (!failedValidation.valid) {
    fail(`release-switch failure receipt schema rejected output: ${failedValidation.error}`);
  }
  const failedBytes = canonicalJsonBytes(failedReceipt);
  exactCreate(output.output, failedBytes, output, productionEvidence);
  recheckExecutableBinding(nodeBinding, 'release failure recorder Node');
  assertSanitizedEnvStable(sanitizedEnv);
  assertAuthorizationChainStable(chain);
  assertAuthorizedEffectStable(effect);
  const reconciledAtUtc = publicationTime(args);
  if (Date.parse(reconciledAtUtc) < Date.parse(recordedAtUtc)) {
    fail('release failure reconciliation predates result publication');
  }
  const failedReconciliation = {
    schemaVersion: 1,
    kind: 'RELEASE_SWITCH_RECONCILIATION',
    status: 'EFFECT_FAILURE_RECONCILED',
    actionClass: 'SERVICE_RELEASE_SWITCH',
    authorizationId: chain.authorization.document.authorizationId,
    deployedSha: null,
    riskVersion: chain.risk.document.riskVersion,
    riskDocumentSha256: chain.risk.sha256,
    serverPreviewDigest: chain.preview.document.serverPreviewDigest,
    previewDocumentSha256: chain.preview.sha256,
    authorizationConsumption: {
      claimKey: chain.consumption.document.claimKey,
      sha256: chain.consumption.sha256,
      consumedAtUtc: chain.consumption.document.consumedAtUtc,
    },
    authorizedEffect: effect.authorizedEffect,
    resultReceiptSha256: sha256Bytes(failedBytes),
    reconciledAtUtc,
    disposition: 'RELEASE_SWITCH_FAILED_AFTER_EFFECT_RECORDED',
  };
  const reconciliationValidation = RECONCILIATION_SCHEMA(failedReconciliation);
  if (!reconciliationValidation.valid) {
    fail(`release-switch failure reconciliation schema rejected output: ${reconciliationValidation.error}`);
  }
  exactCreate(
    reconciliationOutput.output,
    canonicalJsonBytes(failedReconciliation),
    reconciliationOutput,
    productionEvidence,
  );
  process.stdout.write(`${JSON.stringify({
    status: 'RELEASE_SWITCH_FAILURE_RECEIPTS_RECORDED',
    output: output.output,
    reconciliation: reconciliationOutput.output,
  })}\n`);
  process.exit(0);
}
if (args['donor-exit-code'] !== '0') {
  fail('completed release effect requires runner exit code 0');
}
const stateBeforeReadback = captureSwitchState(
  env, verified, args['artifact-manifest-sha256'], firstHost,
);
if (productionEvidence) {
  requireBoundAppUnit(chain.preview.document.action, {
    systemctlBinding,
    nodeBinding,
    envBinding,
    unit: env.APP_UNIT,
  });
}
requireSystemctl(systemctlBinding, env.APP_UNIT);
requireHealth(curlBinding, env.HEALTH_BASE, env.POST_SWITCH_GATE_PATHS.split(' '));
if (productionEvidence) {
  requireBoundAppUnit(chain.preview.document.action, {
    systemctlBinding,
    nodeBinding,
    envBinding,
    unit: env.APP_UNIT,
  });
}
const stateAfterReadback = captureSwitchState(
  env, verified, args['artifact-manifest-sha256'], firstHost,
);
if (JSON.stringify(stateAfterReadback.identity) !== JSON.stringify(stateBeforeReadback.identity)) {
  fail('release link or deployed artifact identity changed during Gate-5 readback');
}
const startedAtUtc = effect.authorizedEffect.effectStartedAtUtc;
recheckExecutableBinding(systemctlBinding, '--systemctl');
recheckExecutableBinding(curlBinding, '--curl');
recheckExecutableBinding(nodeBinding, 'Gate-5 Node');
if (productionEvidence) recheckExecutableBinding(envBinding, 'Gate-5 env');
assertAuthorizationChainStable(chain);
assertAuthorizedEffectStable(effect);
const requireGate5LiveState = (label) => {
  recheckExecutableBinding(systemctlBinding, '--systemctl');
  recheckExecutableBinding(curlBinding, '--curl');
  recheckExecutableBinding(nodeBinding, 'Gate-5 Node');
  if (productionEvidence) {
    recheckExecutableBinding(envBinding, 'Gate-5 env');
    requireBoundAppUnit(chain.preview.document.action, {
      systemctlBinding,
      nodeBinding,
      envBinding,
      unit: env.APP_UNIT,
    });
  }
  requireSystemctl(systemctlBinding, env.APP_UNIT);
  requireHealth(curlBinding, env.HEALTH_BASE, env.POST_SWITCH_GATE_PATHS.split(' '));
  const current = captureSwitchState(
    env, verified, args['artifact-manifest-sha256'], firstHost,
  );
  if (JSON.stringify(current) !== JSON.stringify(stateAfterReadback)) {
    fail(`release link or deployed artifact identity changed before ${label}`);
  }
  assertSanitizedEnvStable(sanitizedEnv);
  assertAuthorizationChainStable(chain);
  assertAuthorizedEffectStable(effect);
};

const receiptBase = {
  schemaVersion: 2,
  kind: 'RELEASE_SWITCH',
  releaseId: verified.release.releaseId,
  testedSha,
  deployedSha: testedSha,
  artifactManifestSha256: args['artifact-manifest-sha256'],
  authorizationId: chain.authorization.document.authorizationId,
  authorizationSha256: chain.authorization.sha256,
  riskVersion: chain.risk.document.riskVersion,
  riskDocumentSha256: chain.risk.sha256,
  serverPreviewDigest: chain.preview.document.serverPreviewDigest,
  previewDocumentSha256: chain.preview.sha256,
  authorizationConsumption: {
    claimKey: chain.consumption.document.claimKey,
    sha256: chain.consumption.sha256,
    consumedAtUtc: chain.consumption.document.consumedAtUtc,
  },
  authorizedEffect: effect.authorizedEffect,
  recoveryTarget: firstHost ? FIRST_HOST_TARGET : null,
  firstHostEvidenceSha256: firstHost ? args['first-host-evidence-sha256'] : null,
  current: stateAfterReadback.current,
  previous: stateAfterReadback.previous,
  service: { unit: env.APP_UNIT, state: 'ACTIVE' },
  postSwitchGate: {
    base: env.HEALTH_BASE,
    paths: env.POST_SWITCH_GATE_PATHS.split(' '),
    status: 'PASS',
  },
  donorExitCode: Number(args['donor-exit-code']),
  status: 'RELEASE_SWITCH_PROVED',
  startedAtUtc,
};

// The Gate-5 reconciliation is the durable commit marker. The result is
// published and directory-synced first; the preview-bound marker is created
// and directory-synced only after those exact result bytes are durable.
recheckExecutableBinding(nodeBinding, 'Gate-5 Node');
assertSanitizedEnvStable(sanitizedEnv);
requireGate5LiveState('result receipt publication');
const resultPublicationUtc = publicationTime(args);
validateAuthorizedChronology({
  startedAtUtc,
  effectFinishedAtUtc: effect.authorizedEffect.effectFinishedAtUtc,
  completedAtUtc: resultPublicationUtc,
  authorization: chain.authorization.document,
  risk: chain.risk.document,
  consumption: chain.consumption.document,
});
const receipt = {
  ...receiptBase,
  completedAtUtc: resultPublicationUtc,
  recordedAtUtc: resultPublicationUtc,
};
requireExactKeys(receipt, [
  'schemaVersion', 'kind', 'releaseId', 'testedSha', 'deployedSha',
  'artifactManifestSha256', 'authorizationId', 'authorizationSha256',
  'riskVersion', 'riskDocumentSha256', 'serverPreviewDigest',
  'previewDocumentSha256', 'authorizationConsumption', 'recoveryTarget',
  'authorizedEffect',
  'firstHostEvidenceSha256', 'current', 'previous', 'service', 'postSwitchGate',
  'donorExitCode', 'status', 'startedAtUtc', 'completedAtUtc', 'recordedAtUtc',
], 'release-switch receipt');
const receiptValidation = RELEASE_SWITCH_SCHEMA(receipt);
if (!receiptValidation.valid) {
  fail(`release-switch receipt schema rejected output: ${receiptValidation.error}`);
}
const receiptBytes = canonicalJsonBytes(receipt);
const receiptSha256 = sha256Bytes(receiptBytes);
exactCreate(output.output, receiptBytes, output, productionEvidence);
recheckExecutableBinding(nodeBinding, 'Gate-5 Node');
assertSanitizedEnvStable(sanitizedEnv);
requireGate5LiveState('reconciliation publication');
const reconciliationPublicationUtc = publicationTime(args);
validateAuthorizedChronology({
  startedAtUtc,
  effectFinishedAtUtc: effect.authorizedEffect.effectFinishedAtUtc,
  completedAtUtc: reconciliationPublicationUtc,
  authorization: chain.authorization.document,
  risk: chain.risk.document,
  consumption: chain.consumption.document,
});
if (Date.parse(reconciliationPublicationUtc) < Date.parse(resultPublicationUtc)) {
  fail('Gate-5 reconciliation publication must not precede result publication');
}
const reconciliation = {
  schemaVersion: 1,
  kind: 'RELEASE_SWITCH_RECONCILIATION',
  status: 'GATE_5_RECONCILED',
  actionClass: 'SERVICE_RELEASE_SWITCH',
  authorizationId: chain.authorization.document.authorizationId,
  deployedSha: testedSha,
  riskVersion: chain.risk.document.riskVersion,
  riskDocumentSha256: chain.risk.sha256,
  serverPreviewDigest: chain.preview.document.serverPreviewDigest,
  previewDocumentSha256: chain.preview.sha256,
  authorizationConsumption: {
    claimKey: chain.consumption.document.claimKey,
    sha256: chain.consumption.sha256,
    consumedAtUtc: chain.consumption.document.consumedAtUtc,
  },
  authorizedEffect: effect.authorizedEffect,
  resultReceiptSha256: receiptSha256,
  reconciledAtUtc: reconciliationPublicationUtc,
  disposition: 'GATE_5_RELEASE_SWITCH_PROVED_LATER_GATES_PENDING',
};
const reconciliationValidation = RECONCILIATION_SCHEMA(reconciliation);
if (!reconciliationValidation.valid) {
  fail(`release-switch reconciliation schema rejected output: ${reconciliationValidation.error}`);
}
const reconciliationBytes = canonicalJsonBytes(reconciliation);
exactCreate(
  reconciliationOutput.output,
  reconciliationBytes,
  reconciliationOutput,
  productionEvidence,
);
recheckExecutableBinding(nodeBinding, 'Gate-5 Node');
assertSanitizedEnvStable(sanitizedEnv);
process.stdout.write(`${JSON.stringify({
  status: 'RELEASE_SWITCH_RECEIPTS_RECORDED',
  output: output.output,
  reconciliation: reconciliationOutput.output,
})}\n`);
