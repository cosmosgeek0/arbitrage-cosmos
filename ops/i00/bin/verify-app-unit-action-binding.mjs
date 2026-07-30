#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { fail, parseArgs } from '../lib.mjs';
import { validateSimulationRoot } from '../simulation-safety.mjs';

const DIGEST = /^[0-9a-f]{64}$/u;

const args = parseArgs(process.argv.slice(2));
for (const name of Object.keys(args)) {
  if (!['action-preview', 'deployment-risk', 'test-provider-bound-root'].includes(name)) {
    fail(`unsupported argument --${name}`);
  }
}
if (!args['action-preview']) fail('--action-preview is required');
if (!args['deployment-risk']) fail('--deployment-risk is required');
for (const name of ['action-preview', 'deployment-risk']) {
  if (!isAbsolute(args[name]) || resolve(args[name]) !== args[name]) {
    fail(`--${name} must be one canonical absolute path`);
  }
}
let expectedI00Environment = '/etc/cosmos/cosmos-i00.env';
if (args['test-provider-bound-root'] !== undefined) {
  const root = args['test-provider-bound-root'];
  if (!isAbsolute(root) || resolve(root) !== root) {
    fail('--test-provider-bound-root must be one canonical absolute path');
  }
  try {
    if (validateSimulationRoot(root) !== root) {
      fail('--test-provider-bound-root differs from the marked simulation root');
    }
  } catch {
    fail('--test-provider-bound-root requires one exact marked simulation root');
  }
  expectedI00Environment = resolve(root, 'etc/cosmos/cosmos-i00.env');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 128 * 1024) fail('app unit inspection input exceeds the bound');
}

let inspected;
try {
  inspected = JSON.parse(input);
} catch {
  fail('app unit inspection is not valid JSON');
}

if (inspected?.schemaVersion !== 4
    || inspected?.status !== 'APP_UNIT_BINDING_VERIFIED'
    || inspected?.inspectionMode !== 'LIVE_SYSTEM_MANAGER'
    || inspected?.offlineUnitRoot !== null
    || inspected?.dropInState !== 'EXACT_PROVIDER_BOUND'
    || !Array.isArray(inspected?.dropInPaths)
    || inspected.dropInPaths.length !== 3
    || !Array.isArray(inspected?.dropInBindings)
    || inspected.dropInBindings.length !== 3
    || canonicalJson(inspected.dropInBindings) !== inspected?.dropInSetEndpoint
    || !DIGEST.test(inspected?.environmentFilesSha256)
    || !DIGEST.test(inspected?.providerBindingSha256)
    || inspected?.providerUnit !== 'cosmos-secrets-provider.service'
    || !DIGEST.test(inspected?.providerFragmentSha256)
    || typeof inspected?.providerFragmentPath !== 'string'
    || typeof inspected?.providerFragmentEndpointIdentity !== 'string'
    || inspected?.providerState !== 'ACTIVE_EXITED_SUCCESS'
    || typeof inspected?.providerDeploymentRiskPath !== 'string'
    || typeof inspected?.providerActionPreviewPath !== 'string'
    || inspected?.environmentFiles?.length !== 2
    || inspected.environmentFiles[0]?.path !== inspected.runtimeEnvPath
    || inspected.environmentFiles[0]?.optional !== false
    || inspected.environmentFiles[1]?.path !== expectedI00Environment
    || inspected.environmentFiles[1]?.optional !== false
    || inspected?.environmentAuthorityState !== 'EXACT_PROVIDER_CREDENTIAL'
    || inspected?.execStart?.argv?.[3]
      !== '/usr/local/lib/cosmos-ops/i00/bin/app-entrypoint.mjs'
    || !DIGEST.test(inspected?.authorityClosureSha256)
    || !DIGEST.test(inspected?.bindingSha256)) {
  fail('app unit inspection is not the exact provider-bound SYSTEM contract');
}

const logicalPendingPath = (path) => {
  if (args['test-provider-bound-root'] === undefined) return path;
  const root = args['test-provider-bound-root'];
  if (!path.startsWith(`${root}/`)) {
    fail('test pending document must remain inside the marked simulation root');
  }
  const authorizationPrefix = `${root}/authorization/`;
  if (path.startsWith(authorizationPrefix)) {
    return `/var/lib/cosmos-deployment-authorization/${path.slice(
      authorizationPrefix.length,
    )}`;
  }
  return path.slice(root.length);
};
for (const path of [
  logicalPendingPath(args['deployment-risk']),
  logicalPendingPath(args['action-preview']),
]) {
  if (path === inspected.providerDeploymentRiskPath
      || path === inspected.providerActionPreviewPath) {
    fail('pending release/rollback document reuses prior provider provenance');
  }
}

let preview;
try {
  preview = JSON.parse(readFileSync(args['action-preview'], 'utf8'));
} catch {
  fail('action preview is not valid JSON');
}

const expected = [
  `app-unit-authority-closure-sha256:${inspected.authorityClosureSha256}`,
  `app-unit-binding-sha256:${inspected.bindingSha256}`,
  `app-unit-drop-in-state:${inspected.dropInState}`,
  `app-unit-drop-in-set:${inspected.dropInSetEndpoint}`,
  `app-unit-effect-reachability:${inspected.effectReachability}`,
  `app-unit-environment-files-sha256:${inspected.environmentFilesSha256}`,
  `app-unit-environment-file-identity:${inspected.runtimeEnvEndpointIdentity}`,
  'app-unit-environment-file-optional:no',
  `app-unit-environment-file-path:${inspected.runtimeEnvPath}`,
  `app-unit-environment-file-sha256:${inspected.runtimeEnvSha256}`,
  `app-unit-exec-start-env-path:${inspected.execStart.path}`,
  `app-unit-exec-start-node-path:${inspected.execStart.argv[2]}`,
  `app-unit-exec-start-sha256:${inspected.execStartSha256}`,
  `app-unit-fragment-identity:${inspected.fragmentEndpointIdentity}`,
  `app-unit-fragment-path:${inspected.fragmentPath}`,
  `app-unit-fragment-sha256:${inspected.fragmentSha256}`,
  `app-unit-fragment-source-identity:${inspected.fragmentSourceEndpointIdentity}`,
  `app-unit-fragment-source-path:${inspected.fragmentSourcePath}`,
  `app-unit-fragment-source-sha256:${inspected.fragmentSourceSha256}`,
  `app-unit-group:${inspected.group}`,
  `app-unit-inspection-mode:${inspected.inspectionMode}`,
  `app-unit-name:${inspected.unit}`,
  `app-unit-namespace-remap-state:${inspected.namespaceRemapState}`,
  `app-unit-need-daemon-reload:${inspected.needDaemonReload}`,
  'app-unit-offline-unit-root:NONE',
  'app-unit-proof-absent-sentinel:NONE',
  'app-unit-proof-drop-in-identity:NONE',
  'app-unit-proof-drop-in-owner:NONE',
  'app-unit-proof-drop-in-path:NONE',
  'app-unit-proof-drop-in-runtime-link-identity:NONE',
  'app-unit-proof-drop-in-runtime-link-path:NONE',
  'app-unit-proof-drop-in-sha256:NONE',
  `app-unit-provider-action-preview-path:${inspected.providerActionPreviewPath}`,
  `app-unit-provider-binding-sha256:${inspected.providerBindingSha256}`,
  `app-unit-provider-deployment-risk-path:${inspected.providerDeploymentRiskPath}`,
  `app-unit-provider-fragment-identity:${inspected.providerFragmentEndpointIdentity}`,
  `app-unit-provider-fragment-path:${inspected.providerFragmentPath}`,
  `app-unit-provider-fragment-sha256:${inspected.providerFragmentSha256}`,
  `app-unit-provider-state:${inspected.providerState}`,
  `app-unit-provider-unit:${inspected.providerUnit}`,
  'app-unit-staging-root:NONE',
  `app-unit-unset-environment-sha256:${inspected.unsetEnvironmentSha256}`,
  `app-unit-user:${inspected.user}`,
  `app-unit-working-directory:${inspected.workingDirectory}`,
].sort();

const allowedEndpoints = preview?.action?.allowedEndpoints;
if (!Array.isArray(allowedEndpoints)
    || allowedEndpoints.some((endpoint) => typeof endpoint !== 'string')
    || new Set(allowedEndpoints).size !== allowedEndpoints.length) {
  fail('action preview allowed endpoints are not one unique string set');
}
const actual = allowedEndpoints
  .filter((endpoint) => endpoint.startsWith('app-unit-'))
  .sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  fail('action preview app unit endpoints differ from independent live inspection');
}

process.stdout.write('APP_UNIT_ACTION_BINDING_VERIFIED\n');
