#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readCanonicalDeploymentDocument,
  validateAuthorizationConsumption,
  validateDeploymentActionPreview,
  validateDeploymentRiskVersion,
} from '../deployment-authorization-contract.mjs';
import { validateSimulationRoot } from '../simulation-safety.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const EXECUTABLE_INSPECTOR = resolve(SCRIPT_DIR, 'inspect-executable.mjs');
const VALIDATOR = resolve(SCRIPT_DIR, 'validate-authorization.mjs');
const RUNNER = resolve(SCRIPT_DIR, 'run-bound-effect.mjs');
const PROVIDER = resolve(SCRIPT_DIR, 'secrets-provider.mjs');
const OUTCOME_RECORDER = resolve(SCRIPT_DIR, 'record-authorized-action-outcome.mjs');
const EXACT_ARGUMENTS = Object.freeze([
  '--authorization',
  '--deployment-risk',
  '--action-preview',
  '--authorization-consumption-root',
]);
const DIGEST = /^[0-9a-f]{64}$/u;
const EXACT_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const CLOSED_ENVIRONMENT = Object.freeze({
  HOME: '/var/empty',
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  TZ: 'UTC',
});

function blocked(message, code = 1) {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(code);
}

function assert(condition, message) {
  if (!condition) blocked(message);
}

function canonicalAbsolute(value, label) {
  assert(typeof value === 'string'
    && value !== '/'
    && isAbsolute(value)
    && resolve(value) === value,
  `${label} must be one raw canonical non-root absolute path`);
  return value;
}

function exactUtc(value, label) {
  assert(typeof value === 'string'
    && EXACT_UTC_SECONDS.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString().replace('.000Z', 'Z') === value,
  `${label} must use exact UTC seconds`);
  return value;
}

function exactSingleton(value, label) {
  assert(Array.isArray(value) && value.length === 1
    && typeof value[0] === 'string' && value[0].length > 0,
  `${label} must contain exactly one value`);
  return value[0];
}

function actionEndpoint(action, prefix) {
  const marker = `${prefix}:`;
  const matches = action.allowedEndpoints
    .filter((endpoint) => endpoint.startsWith(marker))
    .map((endpoint) => endpoint.slice(marker.length));
  assert(matches.length === 1, `secret materialization must bind one ${prefix} endpoint`);
  return matches[0];
}

function readJsonOutput(result, label) {
  assert(result.error === undefined
    && Number.isInteger(result.status)
    && result.status === 0
    && result.signal === null,
  `${label} failed`);
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    blocked(`${label} returned malformed output`);
  }
  assert(output !== null && typeof output === 'object' && !Array.isArray(output),
    `${label} returned malformed output`);
  return output;
}

function runNode(script, arguments_) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    encoding: 'utf8',
    env: CLOSED_ENVIRONMENT,
    maxBuffer: 256 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const argv = process.argv.slice(2);
assert(argv.length === EXACT_ARGUMENTS.length * 2,
  'secret materialization requires exactly four path-only controls');
const controls = new Map();
for (let index = 0; index < EXACT_ARGUMENTS.length; index += 1) {
  const name = EXACT_ARGUMENTS[index];
  assert(argv[index * 2] === name,
    'secret materialization controls are missing or out of order');
  controls.set(
    name,
    canonicalAbsolute(argv[(index * 2) + 1], name),
  );
}

let risk;
let preview;
try {
  risk = readCanonicalDeploymentDocument(
    controls.get('--deployment-risk'),
    'deployment risk version',
    validateDeploymentRiskVersion,
  );
  preview = readCanonicalDeploymentDocument(
    controls.get('--action-preview'),
    'deployment action preview',
    (document) => validateDeploymentActionPreview(document, risk.document, risk.sha256),
  );
} catch {
  blocked('secret materialization producer chain is invalid');
}

const riskDocument = risk.document;
const previewDocument = preview.document;
const action = previewDocument.action;
const rootMode = riskDocument.artifactPolicy.rootMode;
assert(riskDocument.binding.actionClass === 'SECRET_MATERIALIZATION'
  && previewDocument.binding.actionClass === 'SECRET_MATERIALIZATION',
'secret materialization producer chain binds another action class');
assert(action.command === 'secrets-provider'
  && action.scope === 'cosmos-production-secret-materialization',
'secret materialization producer chain binds another command or scope');
assert(rootMode !== 'STAGING',
  'STAGING secret materialization is validation-only and cannot execute');
assert(rootMode === 'SYSTEM' || rootMode === 'TEST',
  'secret materialization root mode is unsupported');
assert(controls.get('--authorization-consumption-root')
    === riskDocument.artifactPolicy.consumptionRoot
  && controls.get('--authorization-consumption-root')
    === previewDocument.singleUse.consumptionRoot
  && riskDocument.artifactPolicy.consumptionRootIdentity
    === previewDocument.singleUse.consumptionRootIdentity,
'secret materialization consumption root differs from the producer chain');

const nodeInspection = readJsonOutput(
  runNode(EXECUTABLE_INSPECTOR, ['--path', process.execPath]),
  'secret materialization Node identity inspection',
);
assert(nodeInspection.path === actionEndpoint(action, 'node-path')
  && nodeInspection.sha256 === actionEndpoint(action, 'node-sha256')
  && nodeInspection.endpointIdentity === actionEndpoint(action, 'node-identity'),
'secret materialization executing Node differs from the producer chain');
const wrapperInspection = readJsonOutput(
  runNode(EXECUTABLE_INSPECTOR, ['--path', SCRIPT_PATH]),
  'secret materialization wrapper identity inspection',
);
assert(wrapperInspection.path === SCRIPT_PATH
  && wrapperInspection.path === actionEndpoint(action, 'authorization-wrapper-path')
  && wrapperInspection.sha256
    === actionEndpoint(action, 'authorization-wrapper-sha256')
  && wrapperInspection.endpointIdentity
    === actionEndpoint(action, 'authorization-wrapper-identity'),
'secret materialization executing wrapper differs from the producer chain');

let simulationArguments = [];
if (rootMode === 'TEST') {
  let simulationRoot;
  try {
    simulationRoot = validateSimulationRoot(riskDocument.artifactPolicy.proofRoot);
  } catch {
    blocked('TEST secret materialization requires one marked simulation root');
  }
  assert(simulationRoot === riskDocument.artifactPolicy.proofRoot,
    'TEST secret materialization proof root is not canonical');
  const testTime = exactUtc(
    riskDocument.authorizationWindow.startsAtUtc,
    'TEST secret materialization time',
  );
  assert(Date.parse(testTime) < Date.parse(riskDocument.authorizationWindow.expiresAtUtc)
    && Date.parse(testTime) < Date.parse(riskDocument.evidenceValidUntilUtc),
  'TEST secret materialization time is outside the bound horizon');
  simulationArguments = ['--simulation-clock', '--now', testTime];
}

const credentialType = exactSingleton(
  action.allowedCredentials.types,
  'secret materialization credential types',
);
const product = exactSingleton(
  action.allowedProducts,
  'secret materialization products',
);
assert(Array.isArray(action.allowedEndpoints) && action.allowedEndpoints.length > 0,
  'secret materialization endpoints are missing');
assert(Array.isArray(action.allowedCredentials.permissions)
  && action.allowedCredentials.permissions.length > 0,
'secret materialization permissions are missing');

const validatorArguments = [
  '--input', controls.get('--authorization'),
  '--class', 'SECRET_MATERIALIZATION',
  ...simulationArguments,
  '--command', action.command,
  '--expected-operator', riskDocument.binding.operator,
  '--expected-deployed-sha', riskDocument.binding.deployedSha,
  '--expected-config-version', riskDocument.binding.configVersion,
  '--deployment-risk', risk.absolute,
  '--action-preview', preview.absolute,
  '--consumption-root', controls.get('--authorization-consumption-root'),
  '--expected-host', riskDocument.binding.host,
  '--expected-environment', riskDocument.binding.environment,
  '--expected-scope', action.scope,
  '--expected-account', riskDocument.binding.account,
  '--expected-product', product,
  '--expected-credential-type', credentialType,
  ...action.allowedCredentials.permissions.flatMap(
    (permission) => ['--expected-permission', permission],
  ),
  '--expected-result-receipt', action.receiptTargets.result,
  '--expected-reconciliation-receipt', action.receiptTargets.reconciliation,
  '--expected-maximum-capital', action.maximumEffect.capital,
  '--expected-maximum-notional', action.maximumEffect.notional,
  '--expected-maximum-effect', action.maximumEffect.operational,
  ...action.allowedEndpoints.flatMap((endpoint) => ['--expected-endpoint', endpoint]),
];

assert(process.platform === 'linux',
  'authorized effects require Linux before authorization consumption');
const validation = readJsonOutput(
  runNode(VALIDATOR, validatorArguments),
  'secret authorization validator',
);
assert(validation.status === 'AUTHORIZATION_VALID'
  && validation.actionClass === 'SECRET_MATERIALIZATION'
  && validation.consumptionStatus === 'AUTHORIZATION_CONSUMED'
  && validation.rootMode === rootMode,
'secret authorization validator returned another action');
const effectStartEvidence = canonicalAbsolute(
  actionEndpoint(action, 'effect-start-evidence'),
  'secret effect start evidence',
);
const effectTerminalEvidence = canonicalAbsolute(
  actionEndpoint(action, 'effect-finish-evidence'),
  'secret effect terminal evidence',
);
const credentialOutput = canonicalAbsolute(
  actionEndpoint(action, 'credential-output-path'),
  'secret credential output',
);
assert(validation.effectStartEvidence === effectStartEvidence
  && validation.effectTerminalEvidence === effectTerminalEvidence
  && validation.resultReceiptTarget === action.receiptTargets.result
  && validation.reconciliationReceiptTarget === action.receiptTargets.reconciliation,
'secret authorization validator returned different effect or receipt paths');
const consumptionPath = canonicalAbsolute(
  validation.authorizationConsumptionPath,
  'authorization consumption',
);
assert(consumptionPath === validation.consumptionReceipt
  && validation.authorizationConsumptionSha256 === validation.consumptionSha256
  && DIGEST.test(validation.authorizationConsumptionSha256)
  && validation.authorizationConsumptionRoot
    === controls.get('--authorization-consumption-root')
  && validation.authorizationConsumptionRoot === validation.consumptionRoot
  && validation.authorizationConsumptionRootIdentity
    === riskDocument.artifactPolicy.consumptionRootIdentity
  && validation.authorizationConsumptionRootIdentity
    === validation.consumptionRootIdentity,
'secret authorization consumption result differs from the producer chain');

let consumption;
try {
  consumption = readCanonicalDeploymentDocument(
    consumptionPath,
    'authorization consumption',
    validateAuthorizationConsumption,
  );
} catch {
  blocked('secret authorization consumption receipt is invalid');
}
assert(consumption.sha256 === validation.authorizationConsumptionSha256
  && consumption.document.consumptionRoot
    === controls.get('--authorization-consumption-root')
  && consumption.document.consumptionRootIdentity
    === validation.authorizationConsumptionRootIdentity,
'secret authorization consumption receipt changed before execution');

const runner = runNode(RUNNER, [
  '--authorization', controls.get('--authorization'),
  '--deployment-risk', risk.absolute,
  '--action-preview', preview.absolute,
  '--authorization-consumption', consumption.absolute,
  '--', PROVIDER,
]);
const runnerExitCode = Number.isInteger(runner.status) ? runner.status : 1;

const outcome = runNode(OUTCOME_RECORDER, [
  '--class', 'SECRET_MATERIALIZATION',
  '--authorization', controls.get('--authorization'),
  '--deployment-risk', risk.absolute,
  '--action-preview', preview.absolute,
  '--authorization-consumption', consumption.absolute,
  '--result-receipt', action.receiptTargets.result,
  '--reconciliation-receipt', action.receiptTargets.reconciliation,
  '--primary-path', credentialOutput,
  '--effect-start-evidence', effectStartEvidence,
  '--effect-finish-evidence', effectTerminalEvidence,
  ...simulationArguments,
]);
const recorded = readJsonOutput(outcome, 'secret materialization outcome recorder');
const expectedRecordedStatus = runnerExitCode === 0
  ? 'AUTHORIZED_ACTION_OUTCOME_RECORDED'
  : 'AUTHORIZED_ACTION_FAILURE_RECORDED';
assert(recorded.status === expectedRecordedStatus
  && recorded.actionClass === 'SECRET_MATERIALIZATION',
'secret materialization outcome recorder returned another action');

if (runnerExitCode !== 0) {
  process.stdout.write('{"status":"SECRET_MATERIALIZATION_FAILED_RECORDED"}\n');
  process.exit(Math.min(255, Math.max(1, runnerExitCode)));
}
process.stdout.write('{"status":"SECRET_MATERIALIZATION_COMPLETED_RECORDED"}\n');
