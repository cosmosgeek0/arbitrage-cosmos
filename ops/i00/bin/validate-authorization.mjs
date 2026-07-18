#!/usr/bin/env node
import { fail, isUtc, parseArgs, readJson, requireKeys } from '../lib.mjs';

const args = parseArgs(process.argv.slice(2), new Set(['simulation-clock']));
if (!args.input || !args.class || !args.command || !args['expected-host'] || !args['expected-environment']) {
  fail('--input, --class, --command, --expected-host, and --expected-environment are required');
}
if (args['simulation-clock'] !== true && args.now) fail('--now is accepted only with --simulation-clock');
if (args['simulation-clock'] === true && !isUtc(args.now)) fail('simulation clock requires exact --now UTC seconds');

const effectiveNow = args['simulation-clock'] === true ? args.now : new Date().toISOString();
const authorization = readJson(args.input, 'external authorization');

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
  if (value.length > 64) fail(`${label} exceeds the bounded authorization size`);
  const normalized = value.map((item, index) => exactText(item, `${label}[${index}]`, options));
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicate values`);
  return normalized;
}

function bindOptional(name, actual, label) {
  const expected = args[name];
  if (expected !== undefined && actual !== expected) fail(`${label} does not match --${name}`);
}

function bindOptionalMember(name, actual, label) {
  const expected = args[name];
  if (expected !== undefined && !actual.includes(expected)) fail(`${label} does not include exact --${name}`);
}

requireExactObject(authorization, TOP_LEVEL_KEYS, 'external authorization');
if (authorization.schemaVersion !== 2) fail('external authorization schemaVersion must be 2');
if (authorization.status !== 'APPROVED') fail('external authorization is not APPROVED');

const authorizationId = exactText(authorization.authorizationId, 'authorizationId', { forbidBroad: true });
const operator = exactText(authorization.operator, 'operator', { forbidBroad: true });
const actionClasses = exactList(authorization.actionClasses, 'actionClasses', { forbidBroad: true });
if (actionClasses.length !== 1) fail('authorization must grant exactly one separate action class');
if (actionClasses[0] !== args.class) fail(`authorization does not grant exact action class ${args.class}`);

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
if (issuedAt > startsAt || startsAt >= expiresAt) fail('authorization time ordering must be issued <= start < expiry');
if (Date.parse(effectiveNow) < startsAt || Date.parse(effectiveNow) >= expiresAt) {
  fail('external authorization is not active at the evaluation time');
}

const allowedCommands = exactList(authorization.allowedCommands, 'allowedCommands', { forbidBroad: true });
const allowedEndpoints = exactList(authorization.allowedEndpoints, 'allowedEndpoints', { forbidBroad: true });
const allowedProducts = exactList(authorization.allowedProducts, 'allowedProducts', { forbidBroad: true });
if (!allowedCommands.includes(args.command)) fail(`authorization does not include exact command ${args.command}`);

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
if (approvedAt < issuedAt || approvedAt > startsAt) fail('owner approval must occur at or after issue and no later than start');

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

if (host !== args['expected-host']) fail('authorization host does not match the target host');
if (environment !== args['expected-environment']) fail('authorization environment does not match the target environment');
bindOptional('expected-scope', scope, 'authorization scope');
bindOptional('expected-account', account, 'authorization account');
bindOptionalMember('expected-endpoint', allowedEndpoints, 'allowedEndpoints');
bindOptionalMember('expected-product', allowedProducts, 'allowedProducts');
bindOptionalMember('expected-credential-type', credentialTypes, 'allowedCredentials.types');
bindOptionalMember('expected-permission', credentialPermissions, 'allowedCredentials.permissions');
bindOptional('expected-result-receipt', resultReceiptTarget, 'result receipt target');
bindOptional('expected-reconciliation-receipt', reconciliationReceiptTarget, 'reconciliation receipt target');
bindOptional('expected-maximum-capital', maximumCapital, 'maximum capital');
bindOptional('expected-maximum-notional', maximumNotional, 'maximum notional');
bindOptional('expected-maximum-effect', maximumOperationalEffect, 'maximum operational effect');

process.stdout.write(`${JSON.stringify({
  status: 'AUTHORIZATION_VALID',
  authorizationId,
  operator,
  actionClass: args.class,
  scope,
  deployedSha,
  configVersion,
  riskVersion,
  nonce,
  serverPreviewDigest,
  account,
  host,
  environment,
  startsAtUtc: authorization.startsAtUtc,
  expiresAtUtc: authorization.expiresAtUtc,
  evaluatedAtUtc: effectiveNow,
  resultReceiptTarget,
  reconciliationReceiptTarget,
})}\n`);
