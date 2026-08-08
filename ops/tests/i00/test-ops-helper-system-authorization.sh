#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

note "helper-root SYSTEM authorization uses the counted install, release, and rollback inventories"
node --input-type=module - \
  "$I00_ROOT/deployment-authorization-contract.mjs" \
  "$I00_ROOT/ops-helper-root.mjs" \
  "$I00_ROOT/bin/install-ops-bundle.sh" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [contractPath, helperPath, installerPath] = process.argv.slice(2);
const {
  DEPLOYMENT_ENDPOINT_BUDGETS,
  DEPLOYMENT_ENDPOINT_PREFIX_INVENTORIES,
  DEPLOYMENT_SYSTEM_ROOTS,
  systemEffectEvidenceRoot,
  validateDeploymentAuthorizationEndpoints,
} = await import(pathToFileURL(contractPath).href);
const { deriveOpsHelperBinding } = await import(pathToFileURL(helperPath).href);

const TARGET_SHA = '1'.repeat(40);
const CURRENT_SHA = '2'.repeat(40);
const REBOUND_SHA = '3'.repeat(40);
const I00_DIGEST = 'a'.repeat(64);
const SHA256 = 'b'.repeat(64);
const FILE_IDENTITY =
  'device=1,inode=2,mode=100555,size=1,mtimeNs=1,ctimeNs=1';
const DIRECTORY_IDENTITY = 'device=1,inode=2,mode=40700,uid=0,gid=0';
const EXPECTED_SYSTEM_OPS_HELPER_PARENT = '/usr/local/lib/cosmos-ops';
const helper = deriveOpsHelperBinding({
  testedSha: TARGET_SHA,
  i00EnforcementTreeDigestSha256: I00_DIGEST,
  rootMode: 'SYSTEM',
});

assert.deepEqual(DEPLOYMENT_ENDPOINT_BUDGETS, {
  OPS_BUNDLE_INSTALL: 47,
  SERVICE_RELEASE_SWITCH: 138,
  SERVICE_ROLLBACK: 131,
  BACKUP_CREATE: 68,
  ISOLATED_RESTORE: 79,
});
assert.equal(
  helper.parent,
  EXPECTED_SYSTEM_OPS_HELPER_PARENT,
  'M2 SYSTEM helper parent must remain independently pinned to /usr/local/lib/cosmos-ops',
);
const installerSource = readFileSync(installerPath, 'utf8');
assert.doesNotMatch(
  installerSource,
  /\/usr\/local\/lib\/cosmos-ops/u,
  'installer must not restate the canonical SYSTEM helper parent',
);
assert.match(
  installerSource,
  /deriveOpsHelperBinding/u,
  'installer must consume deriveOpsHelperBinding from the canonical helper module',
);
assert.match(
  installerSource,
  /destination !== expectedHelperBinding\.root/u,
  'installer must reject a destination that disagrees with the canonical helper root',
);
assert.match(
  installerSource,
  /dirname\(destination\) !== expectedHelperBinding\.parent/u,
  'installer must reject a destination parent that disagrees with the canonical helper parent',
);

const dropInSet = JSON.stringify([
  {
    role: 'PRESERVED_RUNTIME',
    path: '/etc/systemd/system/cosmos-app.service.d/80-runtime-contract.conf',
    sha256: SHA256,
    identity: FILE_IDENTITY,
  },
  {
    role: 'PROVIDER_BINDING',
    path: '/etc/systemd/system/cosmos-app.service.d/90-provider-contract.conf',
    sha256: SHA256,
    identity: FILE_IDENTITY,
  },
  {
    role: 'PRESERVED_LOGGING',
    path: '/etc/systemd/system/cosmos-app.service.d/95-logging-contract.conf',
    sha256: SHA256,
    identity: FILE_IDENTITY,
  },
]);

const exactValues = new Map(Object.entries({
  'completion-reserve-seconds': '300',
  'receipt-publication-reserve-seconds': '60',
  'effect-gid': '0',
  'effect-uid': '0',
  'effect-finish-evidence': '/var/lib/cosmos-action-receipts/effects/system-helper.terminal.json',
  'effect-start-evidence': '/var/lib/cosmos-action-receipts/effects/system-helper.start.json',
  'app-unit-drop-in-state': 'EXACT_PROVIDER_BOUND',
  'app-unit-effect-reachability': 'PROVEN_LIVE_SYSTEM_MANAGER',
  'app-unit-environment-file-optional': 'no',
  'app-unit-exec-start-env-path': '/usr/bin/env',
  'app-unit-exec-start-node-path': '/usr/bin/node',
  'app-unit-group': 'cosmos',
  'app-unit-inspection-mode': 'LIVE_SYSTEM_MANAGER',
  'app-unit-name': 'cosmos-app.service',
  'app-unit-namespace-remap-state': 'NONE',
  'app-unit-need-daemon-reload': 'no',
  'app-unit-offline-unit-root': 'NONE',
  'app-unit-proof-absent-sentinel': 'NONE',
  'app-unit-proof-drop-in-identity': 'NONE',
  'app-unit-proof-drop-in-owner': 'NONE',
  'app-unit-proof-drop-in-path': 'NONE',
  'app-unit-proof-drop-in-runtime-link-identity': 'NONE',
  'app-unit-proof-drop-in-runtime-link-path': 'NONE',
  'app-unit-proof-drop-in-sha256': 'NONE',
  'app-unit-staging-root': 'NONE',
  'app-unit-user': 'cosmos',
  'app-unit-working-directory': '/opt/cosmos/current',
  'backup-reserve-bytes': '1',
  'effect-environment-fd-token': '/proc/self/fd/12',
  'exposure-helper-argv-shape': 'NO_ARGS',
  'exposure-helper-timeout-ms': '3000',
  'alert-helper-argv-shape': 'SEVERITY_CODE_MESSAGE',
  'alert-helper-timeout-ms': '5000',
  'gate-timeout-sec': '60',
  'http-timeout-sec': '5',
  'lock-timeout-sec': '30',
  'ops-readback-timeout-ms': '750',
  'ops-readback-url': 'http://127.0.0.1:8080/api/system-integration/ops/readback',
  'env-path': '/usr/bin/env',
  'node-path': '/usr/bin/node',
  'destination': helper.root,
  'destination-parent-path': EXPECTED_SYSTEM_OPS_HELPER_PARENT,
  'ops-helper-app-entrypoint-path': helper.appEntrypoint,
  'ops-helper-root': helper.root,
  'ops-helper-tree-sha256': I00_DIGEST,
  'release-id': `i00-${TARGET_SHA}`,
  'release-sha': TARGET_SHA,
  'current-release-sha': CURRENT_SHA,
  'sqlite-version': '3.46.0',
  'systemd-analyze-identity': 'NONE',
  'systemd-analyze-path': 'NONE',
  'systemd-analyze-sha256': 'NONE',
  'app-unit-drop-in-set': dropInSet,
  'app-unit-provider-state': 'ACTIVE_EXITED_SUCCESS',
  'app-unit-provider-unit': 'cosmos-secrets-provider.service',
  'rollback-evidence-root': '/var/lib/cosmos-action-receipts/rollback-evidence',
  'rollback-evidence-root-identity': DIRECTORY_IDENTITY,
}));

const directoryIdentityPrefixes = new Set([
  'destination-parent-identity',
  'data-dir-identity',
  'cosmos-root-identity',
  'releases-dir-identity',
  'current-link-parent-identity',
  'previous-link-parent-identity',
  'ops-state-dir-identity',
]);

function valueFor(prefix, actionClass) {
  if (actionClass === 'OPS_BUNDLE_INSTALL'
      && ['effect-common-identity', 'effect-common-path', 'effect-common-sha256']
        .includes(prefix)) return 'NONE';
  if (exactValues.has(prefix)) return exactValues.get(prefix);
  if (directoryIdentityPrefixes.has(prefix)) return DIRECTORY_IDENTITY;
  if (prefix.endsWith('-identity')) return FILE_IDENTITY;
  if (prefix.endsWith('-sha256')) return SHA256;
  if (prefix.endsWith('-path')
      || prefix.endsWith('-root')
      || prefix.endsWith('-dir')
      || prefix.endsWith('-target')) {
    return `/opt/cosmos/system-authorization/${prefix}`;
  }
  return `BOUND_${prefix.replaceAll('-', '_').toUpperCase()}`;
}

function endpoints(actionClass) {
  const inventory = DEPLOYMENT_ENDPOINT_PREFIX_INVENTORIES[actionClass];
  const values = inventory
    .map((prefix) => `${prefix}:${valueFor(prefix, actionClass)}`)
    .sort();
  assert.equal(values.length, DEPLOYMENT_ENDPOINT_BUDGETS[actionClass]);
  return values;
}

function systemPolicy(actionClass) {
  return {
    rootMode: 'SYSTEM',
    proofRoot: 'NONE',
    proofRootIdentity: 'NONE',
    authorizationRoot: DEPLOYMENT_SYSTEM_ROOTS.authorization,
    authorizationRootIdentity: DIRECTORY_IDENTITY,
    consumptionRoot: DEPLOYMENT_SYSTEM_ROOTS.consumption,
    consumptionRootIdentity: DIRECTORY_IDENTITY,
    receiptRoot: DEPLOYMENT_SYSTEM_ROOTS.receipts,
    receiptRootIdentity: DIRECTORY_IDENTITY,
    effectEvidenceRoot: systemEffectEvidenceRoot(actionClass),
    effectEvidenceRootIdentity: DIRECTORY_IDENTITY,
  };
}

const releaseEndpoints = endpoints('SERVICE_RELEASE_SWITCH');
const rollbackEndpoints = endpoints('SERVICE_ROLLBACK');
const installEndpoints = endpoints('OPS_BUNDLE_INSTALL');
assert.equal(releaseEndpoints.length, 138);
assert.equal(rollbackEndpoints.length, 131);
assert.equal(installEndpoints.length, 47);
validateDeploymentAuthorizationEndpoints(
  'SERVICE_RELEASE_SWITCH',
  releaseEndpoints,
  { artifactPolicy: systemPolicy('SERVICE_RELEASE_SWITCH'), deployedSha: TARGET_SHA },
);
validateDeploymentAuthorizationEndpoints(
  'SERVICE_ROLLBACK',
  rollbackEndpoints,
  { artifactPolicy: systemPolicy('SERVICE_ROLLBACK'), deployedSha: TARGET_SHA },
);
validateDeploymentAuthorizationEndpoints(
  'OPS_BUNDLE_INSTALL',
  installEndpoints,
  { artifactPolicy: systemPolicy('OPS_BUNDLE_INSTALL'), deployedSha: TARGET_SHA },
);

const replaceEndpoint = (values, prefix, replacement) => values
  .map((entry) => entry.startsWith(`${prefix}:`)
    ? `${prefix}:${replacement}`
    : entry)
  .sort();
assert.throws(
  () => validateDeploymentAuthorizationEndpoints(
    'SERVICE_RELEASE_SWITCH',
    replaceEndpoint(releaseEndpoints, 'ops-helper-root', `${helper.root}-mismatch`),
    { artifactPolicy: systemPolicy('SERVICE_RELEASE_SWITCH'), deployedSha: TARGET_SHA },
  ),
  /ops helper root differs from the release SHA and I00 tree binding/u,
  'M1 helper-root equality assertion must reject a non-derived root',
);
assert.throws(
  () => validateDeploymentAuthorizationEndpoints(
    'OPS_BUNDLE_INSTALL',
    replaceEndpoint(installEndpoints, 'destination', `${helper.root}-mismatch`),
    { artifactPolicy: systemPolicy('OPS_BUNDLE_INSTALL'), deployedSha: TARGET_SHA },
  ),
  /ops helper install destination differs from the canonical helper root/u,
  'M3 install-destination equality assertion must reject a non-derived destination',
);
assert.throws(
  () => validateDeploymentAuthorizationEndpoints(
    'SERVICE_RELEASE_SWITCH',
    replaceEndpoint(
      releaseEndpoints,
      'ops-helper-app-entrypoint-path',
      `${helper.root}/bin/not-app-entrypoint.mjs`,
    ),
    { artifactPolicy: systemPolicy('SERVICE_RELEASE_SWITCH'), deployedSha: TARGET_SHA },
  ),
  /ops helper app entrypoint differs from the canonical helper root/u,
  'M3 app-entrypoint equality assertion must reject a non-derived entrypoint',
);
assert.throws(
  () => validateDeploymentAuthorizationEndpoints(
    'SERVICE_RELEASE_SWITCH',
    replaceEndpoint(releaseEndpoints, 'release-sha', REBOUND_SHA),
    { artifactPolicy: systemPolicy('SERVICE_RELEASE_SWITCH'), deployedSha: TARGET_SHA },
  ),
  /release SHA differs from the deployment binding/u,
);

const reboundHelper = deriveOpsHelperBinding({
  testedSha: CURRENT_SHA,
  i00EnforcementTreeDigestSha256: I00_DIGEST,
  rootMode: 'SYSTEM',
});
let reboundRollback = replaceEndpoint(rollbackEndpoints, 'release-sha', CURRENT_SHA);
reboundRollback = replaceEndpoint(
  reboundRollback,
  'ops-helper-root',
  reboundHelper.root,
);
reboundRollback = replaceEndpoint(
  reboundRollback,
  'ops-helper-app-entrypoint-path',
  reboundHelper.appEntrypoint,
);
assert.throws(
  () => validateDeploymentAuthorizationEndpoints(
    'SERVICE_ROLLBACK',
    reboundRollback,
    { artifactPolicy: systemPolicy('SERVICE_ROLLBACK'), deployedSha: CURRENT_SHA },
  ),
  /current and target release SHAs must remain distinct/u,
);

process.stdout.write('SYSTEM helper-root endpoint authorization accepted 47/138/131 exact endpoints\n');
NODE
pass_assertion

finish
