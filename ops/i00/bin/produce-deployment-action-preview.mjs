#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import {
  basename, dirname, isAbsolute, resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPendingProviderDocumentSeparation,
  buildDeploymentActionPreviewForCanonicalProducer,
  inspectPrivateDirectoryEvidence,
  privateDirectoryIdentityEndpoint,
  readCanonicalDeploymentDocument,
  validateDeploymentRiskVersion,
  writeExactPrivateJson,
} from '../deployment-authorization-contract.mjs';
import { fail, parseArgs } from '../lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const INSPECT_APP_UNIT = resolve(SCRIPT_DIR, 'inspect-app-unit.mjs');
const INSPECT_EXECUTABLE = resolve(SCRIPT_DIR, 'inspect-executable.mjs');
const SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin';

function nodeEvidence(action) {
  const values = Object.fromEntries(action.allowedEndpoints
    .filter((endpoint) => endpoint.startsWith('node-'))
    .map((endpoint) => {
      const split = endpoint.indexOf(':');
      return [endpoint.slice(0, split), endpoint.slice(split + 1)];
    }));
  if (Object.keys(values).sort().join('\0') !== 'node-identity\0node-path\0node-sha256') {
    throw new Error('risk action lacks one exact Node executable identity');
  }
  const inspected = spawnSync(process.execPath, [
    INSPECT_EXECUTABLE, '--path', values['node-path'],
  ], {
    encoding: 'utf8',
    env: {
      HOME: '/nonexistent',
      LANG: 'C',
      LC_ALL: 'C',
      PATH: SAFE_PATH,
      TZ: 'UTC',
    },
    maxBuffer: 1024 * 1024,
  });
  if (inspected.status !== 0) throw new Error('risk action Node executable inspection failed');
  let identity;
  try {
    identity = JSON.parse(inspected.stdout);
  } catch {
    throw new Error('risk action Node executable inspection returned invalid JSON');
  }
  if (identity.path !== values['node-path']
      || identity.sha256 !== values['node-sha256']
      || identity.endpointIdentity !== values['node-identity']) {
    throw new Error('risk action Node executable identity changed before preview publication');
  }
  return Object.freeze({
    path: identity.path,
    sha256: identity.sha256,
    endpointIdentity: identity.endpointIdentity,
  });
}

function actionEndpoint(action, prefix) {
  const marker = `${prefix}:`;
  const values = action.allowedEndpoints
    .filter((endpoint) => endpoint.startsWith(marker))
    .map((endpoint) => endpoint.slice(marker.length));
  if (values.length !== 1) throw new Error(`risk action lacks one exact ${prefix} endpoint`);
  return values[0];
}

function appUnitEvidence(risk) {
  if (!['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK'].includes(risk.binding.actionClass)) {
    return null;
  }
  const action = risk.action;
  const stagingRoot = actionEndpoint(action, 'app-unit-staging-root');
  const offlineUnitRoot = actionEndpoint(action, 'app-unit-offline-unit-root');
  const proofDropIn = actionEndpoint(action, 'app-unit-proof-drop-in-path');
  const proofDropInRuntimeLink = actionEndpoint(
    action,
    'app-unit-proof-drop-in-runtime-link-path',
  );
  const proofAbsentSentinel = actionEndpoint(
    action,
    'app-unit-proof-absent-sentinel',
  );
  const systemdAnalyze = actionEndpoint(action, 'systemd-analyze-path');
  const provenanceMode = risk.artifactPolicy.rootMode;
  const inspectionArguments = [
    INSPECT_APP_UNIT,
    '--systemctl', actionEndpoint(action, 'systemctl-path'),
    '--unit', actionEndpoint(action, 'app-unit-name'),
    '--node', actionEndpoint(action, 'node-path'),
    '--env', actionEndpoint(action, 'env-path'),
    '--runtime-env', actionEndpoint(action, 'app-unit-environment-file-path'),
    '--expected-fragment-path', actionEndpoint(action, 'app-unit-fragment-path'),
    '--expected-fragment-source', actionEndpoint(
      action,
      'app-unit-fragment-source-path',
    ),
    '--provenance-mode', provenanceMode,
    '--expected-binding-sha256', actionEndpoint(action, 'app-unit-binding-sha256'),
    '--ops-helper-root', actionEndpoint(action, 'ops-helper-root'),
    '--ops-helper-tree-sha256', actionEndpoint(action, 'ops-helper-tree-sha256'),
    '--ops-helper-app-entrypoint', actionEndpoint(
      action,
      'ops-helper-app-entrypoint-path',
    ),
  ];
  if (stagingRoot !== 'NONE') {
    inspectionArguments.push(
      '--staging-root', stagingRoot,
      '--proof-drop-in', proofDropIn,
      '--proof-absent-sentinel', proofAbsentSentinel,
    );
  }
  if (proofDropInRuntimeLink !== 'NONE') {
    inspectionArguments.push(
      '--proof-drop-in-runtime-link',
      proofDropInRuntimeLink,
    );
  }
  if (offlineUnitRoot !== 'NONE') {
    inspectionArguments.push(
      '--offline-unit-root', offlineUnitRoot,
      '--systemd-analyze', systemdAnalyze,
    );
  }
  const result = spawnSync(process.execPath, inspectionArguments, {
    encoding: 'utf8',
    env: {
      HOME: '/nonexistent',
      LANG: 'C',
      LC_ALL: 'C',
      PATH: SAFE_PATH,
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== '') {
    throw new Error('risk action app unit inspection failed');
  }
  let inspected;
  try {
    inspected = JSON.parse(result.stdout);
  } catch {
    throw new Error('risk action app unit inspection returned invalid JSON');
  }
  if (inspected.schemaVersion !== 4
      || inspected.status !== 'APP_UNIT_BINDING_VERIFIED'
      || inspected.inspectionMode !== actionEndpoint(
        action,
        'app-unit-inspection-mode',
      )
      || (inspected.offlineUnitRoot ?? 'NONE') !== offlineUnitRoot
      || (inspected.systemdAnalyzePath ?? 'NONE') !== systemdAnalyze
      || (inspected.systemdAnalyzeSha256 ?? 'NONE') !== actionEndpoint(
        action,
        'systemd-analyze-sha256',
      )
      || (inspected.systemdAnalyzeEndpointIdentity ?? 'NONE') !== actionEndpoint(
        action,
        'systemd-analyze-identity',
      )
      || inspected.systemctlPath !== actionEndpoint(action, 'systemctl-path')
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
      || (stagingRoot === 'NONE'
        && (inspected.dropInPaths.length !== 3
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
          || inspected.providerUnit !== actionEndpoint(
            action,
            'app-unit-provider-unit',
          )
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
          )))
      || inspected.dropInState !== actionEndpoint(action, 'app-unit-drop-in-state')
      || (inspected.proofDropInPath ?? 'NONE') !== proofDropIn
      || (inspected.proofDropInSha256 ?? 'NONE') !== actionEndpoint(
        action,
        'app-unit-proof-drop-in-sha256',
      )
      || (inspected.proofDropInEndpointIdentity ?? 'NONE') !== actionEndpoint(
        action,
        'app-unit-proof-drop-in-identity',
      )
      || inspected.proofDropInOwner !== actionEndpoint(
        action,
        'app-unit-proof-drop-in-owner',
      )
      || (inspected.proofDropInRuntimeLinkPath ?? 'NONE')
        !== proofDropInRuntimeLink
      || (inspected.proofDropInRuntimeLinkEndpointIdentity ?? 'NONE')
        !== actionEndpoint(action, 'app-unit-proof-drop-in-runtime-link-identity')
      || (inspected.proofAbsentSentinel ?? 'NONE') !== proofAbsentSentinel
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
      || inspected.environmentFiles?.length !== (stagingRoot === 'NONE' ? 2 : 1)
      || inspected.environmentFiles?.[0]?.path !== inspected.runtimeEnvPath
      || inspected.environmentFiles?.[0]?.optional !== false
      || (stagingRoot === 'NONE'
        && (inspected.environmentFiles?.[1]?.path !== '/etc/cosmos/cosmos-i00.env'
          || inspected.environmentFiles?.[1]?.optional !== false))
      || inspected.user !== actionEndpoint(action, 'app-unit-user')
      || inspected.user !== 'cosmos'
      || inspected.group !== actionEndpoint(action, 'app-unit-group')
      || inspected.group !== 'cosmos'
      || inspected.workingDirectory !== actionEndpoint(
        action,
        'app-unit-working-directory',
      )
      || inspected.workingDirectory !== '/opt/cosmos/current'
      || inspected.namespaceRemapState !== actionEndpoint(
        action,
        'app-unit-namespace-remap-state',
      )
      || inspected.namespaceRemapState !== 'NONE'
      || inspected.executionAuthorityState !== 'CLOSED'
      || inspected.environmentAuthorityState !== (stagingRoot === 'NONE'
        ? 'EXACT_PROVIDER_CREDENTIAL'
        : 'CLOSED')
      || inspected.identityAuthorityState !== 'CLOSED'
      || inspected.effectReachability !== actionEndpoint(
        action,
        'app-unit-effect-reachability',
      )
      || inspected.authorityClosureSha256 !== actionEndpoint(
        action,
        'app-unit-authority-closure-sha256',
      )
      || inspected.unsetEnvironmentSha256 !== actionEndpoint(
        action,
        'app-unit-unset-environment-sha256',
      )
      || inspected.needDaemonReload !== actionEndpoint(
        action,
        'app-unit-need-daemon-reload',
      )
      || inspected.execStart?.path !== actionEndpoint(
        action,
        'app-unit-exec-start-env-path',
      )
      || inspected.execStart?.argv?.[2] !== actionEndpoint(
        action,
        'app-unit-exec-start-node-path',
      )
      || inspected.execStart?.argv?.[3] !== (stagingRoot === 'NONE'
        ? actionEndpoint(action, 'ops-helper-app-entrypoint-path')
        : 'server/dist/index.js')
      || inspected.execStartSha256 !== actionEndpoint(
        action,
        'app-unit-exec-start-sha256',
      )
      || inspected.bindingSha256 !== actionEndpoint(action, 'app-unit-binding-sha256')) {
    throw new Error('risk action app unit differs from the recorded binding');
  }
  return Object.freeze(inspected);
}

const args = parseArgs(process.argv.slice(2));
const ALLOWED_ARGUMENTS = new Set(['deployment-risk', 'consumption-root', 'output']);
for (const name of Object.keys(args)) if (!ALLOWED_ARGUMENTS.has(name)) fail(`unsupported argument --${name}`);
for (const name of ['deployment-risk', 'consumption-root', 'output']) if (!args[name]) fail(`--${name} is required`);

try {
  const risk = readCanonicalDeploymentDocument(
    args['deployment-risk'],
    'deployment risk version',
    validateDeploymentRiskVersion,
  );
  const policy = risk.document.artifactPolicy;
  const authorizationRoot = inspectPrivateDirectoryEvidence(
    policy.authorizationRoot,
    'deployment authorization root',
  );
  if (privateDirectoryIdentityEndpoint(authorizationRoot)
      !== policy.authorizationRootIdentity
      || dirname(risk.absolute) !== authorizationRoot.absolute) {
    throw new Error('deployment risk is not a direct leaf of its bound authorization root');
  }
  const consumptionRoot = inspectPrivateDirectoryEvidence(
    args['consumption-root'],
    'authorization consumption root',
  );
  if (consumptionRoot.absolute !== policy.consumptionRoot
      || privateDirectoryIdentityEndpoint(consumptionRoot)
        !== policy.consumptionRootIdentity) {
    throw new Error('authorization consumption root differs from the risk artifact policy');
  }
  if (typeof args.output !== 'string' || !isAbsolute(args.output)
      || resolve(args.output) !== args.output
      || dirname(args.output) !== authorizationRoot.absolute
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}\.json$/u.test(basename(args.output))) {
    throw new Error('preview output must be one raw canonical direct-child JSON leaf of the authorization root');
  }
  if (['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK'].includes(
    risk.document.binding.actionClass,
  )) {
    assertPendingProviderDocumentSeparation(
      risk.document.action,
      [risk.absolute, args.output],
    );
  }
  const nodeBefore = nodeEvidence(risk.document.action);
  const appUnitBefore = appUnitEvidence(risk.document);
  if (['SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
    'STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE'].includes(
    risk.document.provenanceMode,
  )
      && realpathSync(process.execPath) !== nodeBefore.path) {
    throw new Error('preview producer interpreter differs from the risk-bound SAFE_PATH Node executable');
  }
  const document = buildDeploymentActionPreviewForCanonicalProducer(
    risk.document,
    risk.sha256,
    args['consumption-root'],
  );
  const nodeAfter = nodeEvidence(risk.document.action);
  const appUnitAfter = appUnitEvidence(risk.document);
  if (JSON.stringify(nodeAfter) !== JSON.stringify(nodeBefore)) {
    throw new Error('risk action Node executable changed during preview production');
  }
  if (JSON.stringify(appUnitAfter) !== JSON.stringify(appUnitBefore)) {
    throw new Error('risk action app unit changed during preview production');
  }
  const finalAuthorizationRoot = inspectPrivateDirectoryEvidence(
    policy.authorizationRoot,
    'deployment authorization root',
  );
  const finalConsumptionRoot = inspectPrivateDirectoryEvidence(
    policy.consumptionRoot,
    'authorization consumption root',
  );
  if (privateDirectoryIdentityEndpoint(finalAuthorizationRoot)
      !== policy.authorizationRootIdentity
      || privateDirectoryIdentityEndpoint(finalConsumptionRoot)
        !== policy.consumptionRootIdentity) {
    throw new Error('deployment artifact root identity changed during preview production');
  }
  const output = writeExactPrivateJson(
    args.output,
    document,
    'deployment action preview',
    policy.authorizationRootIdentity,
  );
  process.stdout.write(`${JSON.stringify({
    status: document.status,
    actionClass: document.binding.actionClass,
    output: output.absolute,
  })}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
