#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync,
} from 'node:fs';
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';
import {
  buildAuthorizationConsumption,
  canonicalJson,
  consumeAuthorization,
  deploymentEndpointBudget,
  inspectPrivateDirectoryEvidence,
  privateDirectoryIdentityEndpoint,
  readCanonicalDeploymentDocument,
  recheckCanonicalDeploymentDocument,
  validateAuthorizationConsumption,
  validateDeploymentActionPreview,
  validateDeploymentRiskVersion,
} from '../deployment-authorization-contract.mjs';
import { fail, isUtc, parseArgs, requireKeys } from '../lib.mjs';

function extractRepeatable(argv, name) {
  const values = [];
  const remaining = [];
  const option = `--${name}`;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== option) {
      remaining.push(argv[index]);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${option} requires a value`);
    values.push(value);
    index += 1;
  }
  return { values, remaining };
}

const endpointArguments = extractRepeatable(process.argv.slice(2), 'expected-endpoint');
const expectedEndpoints = endpointArguments.values;
const permissionArguments = extractRepeatable(endpointArguments.remaining, 'expected-permission');
const expectedPermissions = permissionArguments.values;
const args = parseArgs(permissionArguments.remaining, new Set(['simulation-clock']));
const REQUIRED_EXPECTATIONS = [
  'input', 'class', 'command', 'expected-operator', 'expected-deployed-sha',
  'expected-config-version', 'deployment-risk', 'action-preview', 'consumption-root',
  'expected-host', 'expected-environment',
  'expected-scope', 'expected-account', 'expected-product',
  'expected-credential-type', 'expected-result-receipt',
  'expected-reconciliation-receipt', 'expected-maximum-capital',
  'expected-maximum-notional', 'expected-maximum-effect',
];
const missingExpectations = REQUIRED_EXPECTATIONS.filter((name) => !args[name]);
if (missingExpectations.length > 0 || expectedEndpoints.length === 0 || expectedPermissions.length === 0) {
  const missing = [
    ...missingExpectations,
    ...(expectedEndpoints.length === 0 ? ['expected-endpoint'] : []),
    ...(expectedPermissions.length === 0 ? ['expected-permission'] : []),
  ];
  fail(`complete independent expectations are required: ${missing.map((name) => `--${name}`).join(', ')}`);
}
const ALLOWED_ARGUMENTS = new Set([...REQUIRED_EXPECTATIONS, 'simulation-clock', 'now']);
for (const name of Object.keys(args)) if (!ALLOWED_ARGUMENTS.has(name)) fail(`unsupported argument --${name}`);
if (args['simulation-clock'] !== true && args.now !== undefined) fail('--now is accepted only with --simulation-clock');
if (args['simulation-clock'] === true && !isUtc(args.now)) fail('simulation clock requires exact --now UTC seconds');

const currentUtcSecond = () => new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
const initialEvaluationTime = args['simulation-clock'] === true
  ? args.now
  : currentUtcSecond();

function exactCanonicalPath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
    fail(`${label} must be one raw canonical absolute path`);
  }
  return value;
}

function exactDirectJsonLeaf(value, root, label) {
  const path = exactCanonicalPath(value, label);
  if (dirname(path) !== root
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/u.test(basename(path))) {
    fail(`${label} must be one direct-child JSON leaf of the bound authorization root`);
  }
  return path;
}

function inspectBoundPrivateRoot(path, expectedIdentity, label) {
  let evidence;
  try {
    evidence = inspectPrivateDirectoryEvidence(path, label);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (evidence.absolute !== path
      || privateDirectoryIdentityEndpoint(evidence) !== expectedIdentity) {
    fail(`${label} differs from the producer-bound path or identity`);
  }
  return evidence;
}

let riskEvidence;
try {
  riskEvidence = readCanonicalDeploymentDocument(
    args['deployment-risk'],
    'deployment risk version',
    validateDeploymentRiskVersion,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const riskDocument = riskEvidence.document;
const artifactPolicy = riskDocument.artifactPolicy;
const authorizationRoot = exactCanonicalPath(
  artifactPolicy.authorizationRoot,
  'artifact policy authorization root',
);
const authorizationRootEvidence = inspectBoundPrivateRoot(
  authorizationRoot,
  artifactPolicy.authorizationRootIdentity,
  'deployment authorization root',
);
const authorizationPath = exactDirectJsonLeaf(
  args.input,
  authorizationRoot,
  'external authorization',
);
const riskPath = exactDirectJsonLeaf(
  args['deployment-risk'],
  authorizationRoot,
  'deployment risk version',
);
const previewPath = exactDirectJsonLeaf(
  args['action-preview'],
  authorizationRoot,
  'deployment action preview',
);
if (new Set([authorizationPath, riskPath, previewPath]).size !== 3) {
  fail('authorization, risk, and preview must be three distinct direct-child documents');
}
const consumptionRootPath = exactCanonicalPath(
  args['consumption-root'],
  'authorization consumption root',
);
if (consumptionRootPath !== artifactPolicy.consumptionRoot) {
  fail('authorization consumption root does not match the risk artifact policy');
}
const consumptionRootEvidence = inspectBoundPrivateRoot(
  consumptionRootPath,
  artifactPolicy.consumptionRootIdentity,
  'authorization consumption root',
);

let authorizationEvidence;
let previewEvidence;
try {
  authorizationEvidence = readCanonicalDeploymentDocument(
    authorizationPath,
    'external authorization',
    (document) => document,
  );
  previewEvidence = readCanonicalDeploymentDocument(
    previewPath,
    'deployment action preview',
    (preview) => validateDeploymentActionPreview(
      preview,
      riskEvidence.document,
      riskEvidence.sha256,
    ),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const authorizationSha256 = authorizationEvidence.sha256;
const authorization = authorizationEvidence.document;
const previewDocument = previewEvidence.document;
const expectedProducerMode = {
  SYSTEM: 'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
  STAGING: 'STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
  TEST: 'TEST_FIXTURE_INJECTED',
}[artifactPolicy.rootMode];
if (expectedProducerMode === undefined) fail('artifact policy root mode is unsupported');
if (riskDocument.provenanceMode !== expectedProducerMode
    || previewDocument.provenanceMode !== expectedProducerMode) {
  fail('producer provenance mode does not match the bound artifact root mode');
}
if ((artifactPolicy.rootMode === 'TEST') !== (args['simulation-clock'] === true)) {
  fail('simulation clock mode does not match the bound artifact root mode');
}
if (previewDocument.artifactPolicy.rootMode !== artifactPolicy.rootMode
    || previewDocument.singleUse.consumptionRoot !== consumptionRootPath
    || previewDocument.singleUse.consumptionRootIdentity
      !== artifactPolicy.consumptionRootIdentity) {
  fail('authorization consumption root does not match the class-specific preview');
}

const TOP_LEVEL_KEYS = [
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
];

function requireExactObject(value, keys, label) {
  requireKeys(value, keys, label);
  const extras = Object.keys(value).filter((key) => !keys.includes(key));
  if (extras.length > 0) fail(`${label} contains unsupported fields: ${extras.sort().join(', ')}`);
}

function unresolved(value) {
  return /(?:\b(?:REPLACE_ME|CHANGEME|PLACEHOLDER|TBD|TODO|FIXME|UNKNOWN|UNAVAILABLE)\b|<[^>]+>|\$\{[^}]+\}|example\.com|000000000000|X{4,})/i.test(value);
}

function exactText(value, label, { forbidBroad = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    fail(`${label} must be a non-empty trimmed string`);
  }
  if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} contains invalid characters`);
  if (unresolved(value)) fail(`${label} contains an unresolved placeholder`);
  if (forbidBroad && (value.includes('*') || /^(?:ALL|ANY|GLOBAL)$/i.test(value))) {
    fail(`${label} is broader than an exact value`);
  }
  return value;
}

function exactList(value, label, options = {}) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  const maximum = options.maximum ?? 128;
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    fail(`${label} has an invalid authorization size bound`);
  }
  if (value.length > maximum) fail(`${label} exceeds the bounded authorization size ${maximum}`);
  const normalized = value.map((item, index) => exactText(item, `${label}[${index}]`, options));
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicate values`);
  return normalized;
}

function bindExact(name, actual, label) {
  const expected = args[name];
  if (actual !== expected) fail(`${label} does not match --${name}`);
}

function bindExactSingleton(name, actual, label) {
  const expected = args[name];
  if (actual.length !== 1 || actual[0] !== expected) fail(`${label} is not the complete exact --${name} set`);
}

function bindExactSet(expected, actual, label, options = {}) {
  const expectedSet = exactList(expected, `independent ${label} expectations`, {
    forbidBroad: true,
    ...options,
  });
  if (expectedSet.length !== actual.length
      || [...expectedSet].sort().some((value, index) => value !== [...actual].sort()[index])) {
    fail(`${label} does not equal the complete independent expectation set`);
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function executableIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function sameExecutableIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function inspectRunningNode() {
  let path;
  try {
    path = realpathSync(process.execPath);
  } catch (error) {
    fail(`validator Node executable cannot be canonicalized: ${error.message}`);
  }
  const invokingUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  const validateStat = (stat, label) => {
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111n) === 0n
        || (stat.mode & 0o022n) !== 0n || (stat.mode & 0o7000n) !== 0n) {
      fail(`${label} is not one safe executable regular file`);
    }
    if (invokingUid !== null && stat.uid !== invokingUid && stat.uid !== 0n) {
      fail(`${label} has an untrusted owner`);
    }
  };

  let namedBefore;
  try {
    namedBefore = lstatSync(path, { bigint: true });
  } catch (error) {
    fail(`validator Node executable is unavailable: ${error.message}`);
  }
  validateStat(namedBefore, 'validator Node executable');
  if (realpathSync(path) !== path) fail('validator Node executable path is not canonical');
  for (let cursor = dirname(path);;) {
    const stat = lstatSync(cursor, { bigint: true });
    const mode = stat.mode & 0o7777n;
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(cursor) !== cursor) {
      fail('validator Node executable ancestor chain is not canonical');
    }
    if (invokingUid !== null && stat.uid !== invokingUid && stat.uid !== 0n) {
      fail('validator Node executable ancestor chain has an untrusted owner');
    }
    if ((mode & 0o022n) !== 0n
        && !(stat.uid === 0n && (mode & 0o1000n) !== 0n)) {
      fail('validator Node executable ancestor chain contains an unsafe writable directory');
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  let descriptor;
  let openedBefore;
  let openedAfter;
  let sha256;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    openedBefore = fstatSync(descriptor, { bigint: true });
    validateStat(openedBefore, 'opened validator Node executable');
    if (!sameExecutableIdentity(namedBefore, openedBefore)) {
      fail('validator Node executable changed before hashing');
    }
    sha256 = createHash('sha256').update(readFileSync(descriptor)).digest('hex');
    openedAfter = fstatSync(descriptor, { bigint: true });
  } catch (error) {
    if (String(error?.message ?? '').startsWith('I00_OPS_BLOCKED:')) throw error;
    fail(`validator Node executable inspection failed: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (!sameExecutableIdentity(openedBefore, openedAfter)) {
    fail('validator Node executable changed while hashing');
  }
  const namedAfter = lstatSync(path, { bigint: true });
  validateStat(namedAfter, 'validator Node executable');
  if (realpathSync(path) !== path || !sameExecutableIdentity(openedAfter, namedAfter)) {
    fail('validator Node executable changed after hashing');
  }
  const identity = executableIdentity(openedAfter);
  return Object.freeze({
    path,
    sha256,
    identity: Object.entries(identity).map(([key, value]) => `${key}=${value}`).join(','),
  });
}

function actionEndpoint(action, prefix) {
  const marker = `${prefix}:`;
  const values = action.allowedEndpoints
    .filter((endpoint) => endpoint.startsWith(marker))
    .map((endpoint) => endpoint.slice(marker.length));
  if (values.length !== 1) fail(`action preview must bind one ${prefix} endpoint`);
  return values[0];
}

function optionalActionEndpoint(action, prefix) {
  const marker = `${prefix}:`;
  const values = action.allowedEndpoints
    .filter((endpoint) => endpoint.startsWith(marker))
    .map((endpoint) => endpoint.slice(marker.length));
  if (values.length > 1) fail(`action preview contains multiple ${prefix} endpoints`);
  return values[0] ?? null;
}

function authorizedRunningNode(action) {
  const inspected = inspectRunningNode();
  if (actionEndpoint(action, 'node-path') !== inspected.path
      || actionEndpoint(action, 'node-sha256') !== inspected.sha256
      || actionEndpoint(action, 'node-identity') !== inspected.identity) {
    fail('validator Node executable differs from the authorized preview binding');
  }
  return inspected;
}

function recheckRunningNode(expected) {
  if (!sameJson(inspectRunningNode(), expected)) {
    fail('validator Node executable changed around authorization claim');
  }
}

requireExactObject(authorization, TOP_LEVEL_KEYS, 'external authorization');
if (authorization.schemaVersion !== 2) fail('external authorization schemaVersion must be 2');
if (authorization.status !== 'APPROVED') fail('external authorization is not APPROVED');

const authorizationId = exactText(authorization.authorizationId, 'authorizationId', { forbidBroad: true });
const operator = exactText(authorization.operator, 'operator', { forbidBroad: true });
const actionClasses = exactList(authorization.actionClasses, 'actionClasses', { forbidBroad: true });
if (actionClasses.length !== 1) fail('authorization must grant exactly one separate action class');
if (actionClasses[0] !== args.class) fail(`authorization does not grant exact action class ${args.class}`);
const allowedEndpointBudget = deploymentEndpointBudget(actionClasses[0]);

const scope = exactText(authorization.scope, 'scope', { forbidBroad: true });
const deployedSha = exactText(authorization.deployedSha, 'deployedSha', { forbidBroad: true });
if (!/^[a-f0-9]{40}$/.test(deployedSha)) fail('deployedSha must be one exact lowercase full Git SHA');
const configVersion = exactText(authorization.configVersion, 'configVersion', { forbidBroad: true });
const riskVersion = exactText(authorization.riskVersion, 'riskVersion', { forbidBroad: true });
const nonce = exactText(authorization.nonce, 'nonce', { forbidBroad: true });
if (!/^(?:[a-f0-9]{2}){16,64}$/.test(nonce)) fail('nonce must be a bounded 128- to 512-bit lowercase cryptographic identifier');
const serverPreviewDigest = exactText(authorization.serverPreviewDigest, 'serverPreviewDigest', { forbidBroad: true });
if (!/^sha256:[a-f0-9]{64}$/.test(serverPreviewDigest)) fail('serverPreviewDigest must be one exact SHA-256 digest');
const account = exactText(authorization.account, 'account', { forbidBroad: true });
const environment = exactText(authorization.environment, 'environment', { forbidBroad: true });
const host = exactText(authorization.host, 'host', { forbidBroad: true });
if (/\s|:\/\//.test(host)) fail('host must be an exact host name or address, not a URL');

if (!isUtc(authorization.issuedAtUtc) || !isUtc(authorization.startsAtUtc) || !isUtc(authorization.expiresAtUtc)) {
  fail('authorization issued/start/expiry timestamps must be exact UTC seconds');
}
const issuedAt = Date.parse(authorization.issuedAtUtc);
const startsAt = Date.parse(authorization.startsAtUtc);
const expiresAt = Date.parse(authorization.expiresAtUtc);
if (issuedAt > startsAt) {
  fail(`authorization time ordering must be issued <= start < expiry: issuedAtUtc ${authorization.issuedAtUtc} is AFTER startsAtUtc ${authorization.startsAtUtc}`);
}
if (startsAt >= expiresAt) {
  fail(`authorization time ordering must be issued <= start < expiry: startsAtUtc ${authorization.startsAtUtc} is not BEFORE expiresAtUtc ${authorization.expiresAtUtc}`);
}
if (Date.parse(initialEvaluationTime) < startsAt) {
  fail(`external authorization is not active yet: evaluation time ${initialEvaluationTime} is BEFORE startsAtUtc ${authorization.startsAtUtc}`);
}
if (Date.parse(initialEvaluationTime) >= expiresAt) {
  fail(`external authorization has expired: evaluation time ${initialEvaluationTime} is AT OR AFTER expiresAtUtc ${authorization.expiresAtUtc}`);
}

const allowedCommands = exactList(authorization.allowedCommands, 'allowedCommands', { forbidBroad: true });
const allowedEndpoints = exactList(authorization.allowedEndpoints, 'allowedEndpoints', {
  forbidBroad: true,
  maximum: allowedEndpointBudget,
});
const allowedProducts = exactList(authorization.allowedProducts, 'allowedProducts', { forbidBroad: true });
if (allowedCommands.length !== 1 || allowedCommands[0] !== args.command) {
  fail(`authorization does not grant only exact command ${args.command}`);
}

requireExactObject(authorization.allowedCredentials, ['types', 'permissions'], 'allowedCredentials');
const credentialTypes = exactList(authorization.allowedCredentials.types, 'allowedCredentials.types', { forbidBroad: true });
const credentialPermissions = exactList(authorization.allowedCredentials.permissions, 'allowedCredentials.permissions', { forbidBroad: true });

const preconditions = exactList(authorization.preconditions, 'preconditions', { forbidBroad: true });
requireExactObject(authorization.maximumEffect, ['capital', 'notional', 'operational'], 'maximumEffect');
const maximumCapital = exactText(authorization.maximumEffect.capital, 'maximumEffect.capital', { forbidBroad: true });
const maximumNotional = exactText(authorization.maximumEffect.notional, 'maximumEffect.notional', { forbidBroad: true });
const maximumOperationalEffect = exactText(authorization.maximumEffect.operational, 'maximumEffect.operational', { forbidBroad: true });
const rollback = exactText(authorization.rollback, 'rollback', { forbidBroad: true });
const recovery = exactText(authorization.recovery, 'recovery', { forbidBroad: true });

requireExactObject(authorization.ownerApproval, ['approver', 'approvedAtUtc', 'reference'], 'ownerApproval');
const approver = exactText(authorization.ownerApproval.approver, 'ownerApproval.approver', { forbidBroad: true });
const approvalReference = exactText(authorization.ownerApproval.reference, 'ownerApproval.reference', { forbidBroad: true });
if (!isUtc(authorization.ownerApproval.approvedAtUtc)) fail('owner approval timestamp must be exact UTC seconds');
const approvedAt = Date.parse(authorization.ownerApproval.approvedAtUtc);
if (approvedAt < issuedAt) {
  fail(`owner approval must occur at or after issue and no later than start: ownerApproval.approvedAtUtc ${authorization.ownerApproval.approvedAtUtc} is BEFORE issuedAtUtc ${authorization.issuedAtUtc}`);
}
if (approvedAt > startsAt) {
  fail(`owner approval must occur at or after issue and no later than start: ownerApproval.approvedAtUtc ${authorization.ownerApproval.approvedAtUtc} is AFTER startsAtUtc ${authorization.startsAtUtc}`);
}

requireExactObject(authorization.receiptTargets, ['result', 'reconciliation'], 'receiptTargets');
const resultReceiptTarget = exactText(authorization.receiptTargets.result, 'receiptTargets.result', { forbidBroad: true });
const reconciliationReceiptTarget = exactText(authorization.receiptTargets.reconciliation, 'receiptTargets.reconciliation', { forbidBroad: true });
if (resultReceiptTarget === reconciliationReceiptTarget) fail('result and reconciliation receipt targets must be distinct');

const authorizationStrings = [
  authorizationId, operator, scope, deployedSha, configVersion, riskVersion, nonce,
  serverPreviewDigest, account, environment, host,
  ...actionClasses, ...allowedCommands, ...allowedEndpoints, ...allowedProducts,
  ...credentialTypes, ...credentialPermissions, ...preconditions,
  maximumCapital, maximumNotional, maximumOperationalEffect,
  rollback, recovery, approver, approvalReference,
  resultReceiptTarget, reconciliationReceiptTarget,
];
if (authorizationStrings.some((value) => /\bwithdraw(?:al)?\b|\btransfer[ _-]*out\b/i.test(value))) {
  fail('withdrawal and transfer-out authority are forbidden');
}

const producerAction = previewDocument.action;
const nodeBinding = authorizedRunningNode(producerAction);
if (authorizationId !== riskDocument.binding.authorizationId
    || actionClasses[0] !== riskDocument.binding.actionClass
    || operator !== riskDocument.binding.operator
    || approver !== riskDocument.binding.approver
    || approvalReference !== riskDocument.binding.approvalReference
    || deployedSha !== riskDocument.binding.deployedSha
    || configVersion !== riskDocument.binding.configVersion
    || riskVersion !== riskDocument.riskVersion
    || nonce !== riskDocument.binding.nonce
    || serverPreviewDigest !== previewDocument.serverPreviewDigest
    || account !== riskDocument.binding.account
    || environment !== riskDocument.binding.environment
    || host !== riskDocument.binding.host) {
  fail('authorization identity does not match the canonical producer binding');
}
if (authorization.issuedAtUtc !== riskDocument.authorizationWindow.issuedAtUtc
    || authorization.startsAtUtc !== riskDocument.authorizationWindow.startsAtUtc
    || authorization.expiresAtUtc !== riskDocument.authorizationWindow.expiresAtUtc) {
  fail('authorization window does not match the canonical producer binding');
}
if (!sameJson(allowedCommands, [producerAction.command])
    || !sameJson([...allowedEndpoints].sort(), [...producerAction.allowedEndpoints].sort())
    || !sameJson(allowedProducts, producerAction.allowedProducts)
    || !sameJson(credentialTypes, producerAction.allowedCredentials.types)
    || !sameJson(credentialPermissions, producerAction.allowedCredentials.permissions)
    || !sameJson(preconditions, producerAction.preconditions)
    || maximumCapital !== producerAction.maximumEffect.capital
    || maximumNotional !== producerAction.maximumEffect.notional
    || maximumOperationalEffect !== producerAction.maximumEffect.operational
    || rollback !== producerAction.rollback
    || recovery !== producerAction.recovery
    || resultReceiptTarget !== producerAction.receiptTargets.result
    || reconciliationReceiptTarget !== producerAction.receiptTargets.reconciliation
    || scope !== producerAction.scope) {
  fail('authorization action does not match the canonical class-specific preview');
}

if (host !== args['expected-host']) fail('authorization host does not match the target host');
if (environment !== args['expected-environment']) fail('authorization environment does not match the target environment');
bindExact('expected-operator', operator, 'authorization operator');
bindExact('expected-deployed-sha', deployedSha, 'deployed SHA');
bindExact('expected-config-version', configVersion, 'configuration version');
bindExact('expected-scope', scope, 'authorization scope');
bindExact('expected-account', account, 'authorization account');
bindExactSet(expectedEndpoints, allowedEndpoints, 'allowedEndpoints', {
  maximum: allowedEndpointBudget,
});
bindExactSingleton('expected-product', allowedProducts, 'allowedProducts');
bindExactSingleton('expected-credential-type', credentialTypes, 'allowedCredentials.types');
bindExactSet(expectedPermissions, credentialPermissions, 'allowedCredentials.permissions');
bindExact('expected-result-receipt', resultReceiptTarget, 'result receipt target');
bindExact('expected-reconciliation-receipt', reconciliationReceiptTarget, 'reconciliation receipt target');
bindExact('expected-maximum-capital', maximumCapital, 'maximum capital');
bindExact('expected-maximum-notional', maximumNotional, 'maximum notional');
bindExact('expected-maximum-effect', maximumOperationalEffect, 'maximum operational effect');

let consumption;
let consumptionEvidence;
let consumptionReadback;
let consumedAtUtc;
try {
  inspectBoundPrivateRoot(
    authorizationRootEvidence.absolute,
    artifactPolicy.authorizationRootIdentity,
    'deployment authorization root',
  );
  inspectBoundPrivateRoot(
    consumptionRootEvidence.absolute,
    previewDocument.singleUse.consumptionRootIdentity,
    'authorization consumption root',
  );
  recheckCanonicalDeploymentDocument(
    authorizationEvidence,
    'external authorization',
    (document) => document,
  );
  recheckCanonicalDeploymentDocument(
    riskEvidence,
    'deployment risk version',
    validateDeploymentRiskVersion,
  );
  recheckCanonicalDeploymentDocument(
    previewEvidence,
    'deployment action preview',
    (preview) => validateDeploymentActionPreview(
      preview,
      riskEvidence.document,
      riskEvidence.sha256,
    ),
  );
  consumedAtUtc = args['simulation-clock'] === true
    ? args.now
    : currentUtcSecond();
  if (Date.parse(consumedAtUtc) < startsAt || Date.parse(consumedAtUtc) >= expiresAt) {
    fail('external authorization expired before single-use claim');
  }
  consumption = buildAuthorizationConsumption({
    authorization,
    authorizationSha256,
    risk: riskDocument,
    riskDocumentSha256: riskEvidence.sha256,
    preview: previewDocument,
    previewDocumentSha256: previewEvidence.sha256,
    consumedAtUtc,
  });
  recheckRunningNode(nodeBinding);
  consumptionEvidence = consumeAuthorization(
    consumptionRootPath,
    consumption,
    previewDocument.singleUse.consumptionRootIdentity,
  );
  consumptionReadback = readCanonicalDeploymentDocument(
    consumptionEvidence.absolute,
    'authorization consumption',
    validateAuthorizationConsumption,
  );
  if (dirname(consumptionReadback.absolute) !== consumptionRootPath
      || basename(consumptionReadback.absolute) !== `${consumption.claimKey}.json`
      || consumptionReadback.sha256 !== consumptionEvidence.sha256
      || canonicalJson(consumptionReadback.document) !== canonicalJson(consumption)) {
    fail('authorization consumption receipt differs from the exact preview-bound claim');
  }
  inspectBoundPrivateRoot(
    authorizationRootEvidence.absolute,
    artifactPolicy.authorizationRootIdentity,
    'deployment authorization root',
  );
  inspectBoundPrivateRoot(
    consumptionRootEvidence.absolute,
    previewDocument.singleUse.consumptionRootIdentity,
    'authorization consumption root',
  );
  recheckRunningNode(nodeBinding);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

process.stdout.write(`${JSON.stringify({
  status: 'AUTHORIZATION_VALID',
  rootMode: artifactPolicy.rootMode,
  provenanceMode: riskDocument.provenanceMode,
  actionClass: riskDocument.binding.actionClass,
  consumptionStatus: consumption.status,
  consumptionReceipt: consumptionReadback.absolute,
  consumptionSha256: consumptionReadback.sha256,
  consumptionRoot: consumption.consumptionRoot,
  consumptionRootIdentity: consumption.consumptionRootIdentity,
  authorizationConsumptionPath: consumptionReadback.absolute,
  authorizationConsumptionSha256: consumptionReadback.sha256,
  authorizationConsumptionRoot: consumption.consumptionRoot,
  authorizationConsumptionRootIdentity: consumption.consumptionRootIdentity,
  claimKey: consumption.claimKey,
  authorizationSha256,
  riskDocumentSha256: riskEvidence.sha256,
  previewDocumentSha256: previewEvidence.sha256,
  riskVersion: riskDocument.riskVersion,
  serverPreviewDigest: previewDocument.serverPreviewDigest,
  startsAtUtc: riskDocument.authorizationWindow.startsAtUtc,
  expiresAtUtc: riskDocument.authorizationWindow.expiresAtUtc,
  evidenceValidUntilUtc: riskDocument.evidenceValidUntilUtc,
  evaluatedAtUtc: consumption.consumedAtUtc,
  effectStartEvidence: actionEndpoint(producerAction, 'effect-start-evidence'),
  effectTerminalEvidence: actionEndpoint(producerAction, 'effect-finish-evidence'),
  effectUid: actionEndpoint(producerAction, 'effect-uid'),
  effectGid: actionEndpoint(producerAction, 'effect-gid'),
  effectProgramPath: actionEndpoint(producerAction, 'effect-program-path'),
  effectScriptPath: actionEndpoint(producerAction, 'effect-script-path'),
  effectEnvironmentSha256: optionalActionEndpoint(
    producerAction,
    'effect-environment-sha256',
  ),
  completionReserveSeconds: producerAction.completionReserveSeconds,
  receiptPublicationReserveSeconds: producerAction.receiptPublicationReserveSeconds,
  resultReceiptTarget: producerAction.receiptTargets.result,
  reconciliationReceiptTarget: producerAction.receiptTargets.reconciliation,
})}\n`);
