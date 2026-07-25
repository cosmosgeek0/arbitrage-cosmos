import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync,
  realpathSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileJsonSchemaFile } from './json-schema.mjs';
import { typedTreeDigest } from './lib.mjs';
import { validateSimulationRoot } from './simulation-safety.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REQUEST_SCHEMA = compileJsonSchemaFile(
  resolve(MODULE_DIR, 'schemas/deployment-action-request.schema.json'),
  'deployment action request schema',
);
const RISK_SCHEMA = compileJsonSchemaFile(
  resolve(MODULE_DIR, 'schemas/deployment-risk-version.schema.json'),
  'deployment risk version schema',
);
const PREVIEW_SCHEMA = compileJsonSchemaFile(
  resolve(MODULE_DIR, 'schemas/deployment-action-preview.schema.json'),
  'deployment action preview schema',
);
const CONSUMPTION_SCHEMA = compileJsonSchemaFile(
  resolve(MODULE_DIR, 'schemas/authorization-consumption.schema.json'),
  'authorization consumption schema',
);

const FORBIDDEN_AUTHORITIES = Object.freeze([
  'BORROW_REPAY',
  'LEVERAGE_MARGIN_MUTATION',
  'LIVE_ORDERS',
  'PRIVATE_EXCHANGE_CALLS',
  'TRANSFER_OUT',
  'WITHDRAWAL',
]);
const POLICY = Object.freeze({
  executionMode: 'VALIDATE_ONLY',
  maximumCapital: 'ZERO',
  maximumNotional: 'ZERO',
  moneyPaths: 'FORBIDDEN',
  privateExchangeCalls: 'FORBIDDEN',
  forbiddenAuthorities: FORBIDDEN_AUTHORITIES,
});
const COMMON_PRECONDITIONS = Object.freeze([
  'exact target evidence is current and complete',
  'owner approval follows this exact preview',
]);

export const DEPLOYMENT_COMPLETION_RESERVE_SECONDS = Object.freeze({
  OPS_BUNDLE_INSTALL: 300,
  SERVICE_RELEASE_SWITCH: 300,
  SERVICE_ROLLBACK: 300,
  BACKUP_CREATE: 900,
  ISOLATED_RESTORE: 1_800,
  SECRET_MATERIALIZATION: 300,
});
export const DEPLOYMENT_RECEIPT_PUBLICATION_RESERVE_SECONDS = Object.freeze({
  OPS_BUNDLE_INSTALL: 60,
  SERVICE_RELEASE_SWITCH: 60,
  SERVICE_ROLLBACK: 60,
  BACKUP_CREATE: 120,
  ISOLATED_RESTORE: 300,
  SECRET_MATERIALIZATION: 60,
});
export const DEPLOYMENT_SYSTEM_ROOTS = Object.freeze({
  authorization: '/var/lib/cosmos-deployment-authorization',
  consumption: '/var/lib/cosmos-authorization-consumption',
  receipts: '/var/lib/cosmos-action-receipts',
});

// THE one definition of the per-class effect-evidence root. Everything that needs the path, or
// only its final component, derives it from here. Two programs restating the same interpolation is
// what produced the defect this replaced; a literal copy elsewhere would reintroduce it one step
// further out.
export function systemEffectEvidenceRoot(actionClass) {
  return ['BACKUP_CREATE', 'ISOLATED_RESTORE'].includes(actionClass)
    ? `/var/backups/cosmos/.i00-${actionClass === 'BACKUP_CREATE' ? 'backup' : 'restore'}-effects`
    : `${DEPLOYMENT_SYSTEM_ROOTS.receipts}/effects`;
}

const COMMON_EFFECT_ENDPOINT_PREFIXES = Object.freeze([
  'completion-reserve-seconds',
  'effect-common-identity',
  'effect-common-path',
  'effect-common-sha256',
  'effect-finish-evidence',
  'effect-gid',
  'effect-program-identity',
  'effect-program-path',
  'effect-program-sha256',
  'effect-script-identity',
  'effect-script-path',
  'effect-script-sha256',
  'effect-start-evidence',
  'effect-uid',
  'receipt-publication-reserve-seconds',
]);
const EFFECT_IDENTITY_ENDPOINT_PREFIXES = Object.freeze([
  'effect-group',
  'effect-unit-identity',
  'effect-unit-path',
  'effect-unit-sha256',
  'effect-user',
  'getent-identity',
  'getent-path',
  'getent-sha256',
  'id-identity',
  'id-path',
  'id-sha256',
  'setpriv-identity',
  'setpriv-path',
  'setpriv-sha256',
]);

const ACTION_CLASSES = Object.freeze({
  OPS_BUNDLE_INSTALL: Object.freeze({
    command: 'install-ops-bundle',
    scope: 'cosmos-production-ops-bundle-install',
    product: 'Cosmos I00 ops bundle',
    credentialType: 'ROOT_LOCAL_OPERATOR_SESSION',
    permission: 'filesystem:InstallImmutableOpsBundle',
    operational: 'install one exact immutable ops bundle without service mutation',
    rollback: 'remove only the unactivated exact immutable ops bundle',
    recovery: 'leave services unchanged and retain the rejected installation evidence',
    evidenceRoles: Object.freeze([
      'ARTIFACT_MANIFEST',
      'HOST_EVIDENCE',
      'HOST_READBACK',
      'RELEASE_JSON',
      'TRUSTED_BUILD_PUBLIC_KEY',
    ]),
    endpointPrefixes: Object.freeze([
      ...COMMON_EFFECT_ENDPOINT_PREFIXES,
      'artifact-manifest-sha256',
      'bash-identity',
      'bash-path',
      'bash-sha256',
      'chmod-identity',
      'chmod-path',
      'chmod-sha256',
      'cp-identity',
      'cp-path',
      'cp-sha256',
      'destination',
      'destination-parent-identity',
      'destination-parent-path',
      'mkdir-identity',
      'mkdir-path',
      'mkdir-sha256',
      'mv-identity',
      'mv-path',
      'mv-sha256',
      'node-identity',
      'node-path',
      'node-sha256',
      'release-identity',
      'release-path',
      'release-sha',
      'release-tree-sha256',
      'rm-identity',
      'rm-path',
      'rm-sha256',
      'trusted-builder-public-key-sha256',
    ]),
  }),
  SERVICE_RELEASE_SWITCH: Object.freeze({
    command: 'release-switch',
    scope: 'cosmos-production-release-switch',
    product: 'Cosmos I00 immutable release',
    credentialType: 'ROOT_LOCAL_OPERATOR_SESSION',
    permission: 'systemd:RestartExactCosmosAppUnit',
    operational: 'install one exact immutable release and restart one exact application unit',
    rollback: 'switch to the retained exact compatible prior release and restart one application unit',
    recovery: 'stop the application unit and retain exact release and reconciliation evidence',
    evidenceRoles: Object.freeze([
      'ARTIFACT_MANIFEST',
      'DEPLOY_ENV',
      'DONOR_CONTRACT',
      'HOST_EVIDENCE',
      'HOST_READBACK',
      'L15_AMENDMENT_CONTRACT',
      'RELEASE_JSON',
      'RUNTIME_ENV',
      'TRUSTED_BUILD_PUBLIC_KEY',
    ]),
    optionalEvidenceRoleGroups: Object.freeze([
      Object.freeze(['FIRST_HOST_EVIDENCE']),
      Object.freeze(['CURRENT_ARTIFACT_MANIFEST', 'CURRENT_RELEASE_JSON']),
    ]),
    endpointPrefixes: Object.freeze([
      ...COMMON_EFFECT_ENDPOINT_PREFIXES,
      'app-unit-authority-closure-sha256',
      'app-unit-binding-sha256',
      'app-unit-drop-in-state',
      'app-unit-effect-reachability',
      'app-unit-environment-file-identity',
      'app-unit-environment-file-optional',
      'app-unit-environment-file-path',
      'app-unit-environment-file-sha256',
      'app-unit-exec-start-env-path',
      'app-unit-exec-start-node-path',
      'app-unit-exec-start-sha256',
      'app-unit-fragment-identity',
      'app-unit-fragment-path',
      'app-unit-fragment-sha256',
      'app-unit-fragment-source-identity',
      'app-unit-fragment-source-path',
      'app-unit-fragment-source-sha256',
      'app-unit-group',
      'app-unit-inspection-mode',
      'app-unit-name',
      'app-unit-namespace-remap-state',
      'app-unit-need-daemon-reload',
      'app-unit-offline-unit-root',
      'app-unit-proof-absent-sentinel',
      'app-unit-proof-drop-in-identity',
      'app-unit-proof-drop-in-owner',
      'app-unit-proof-drop-in-path',
      'app-unit-proof-drop-in-runtime-link-identity',
      'app-unit-proof-drop-in-runtime-link-path',
      'app-unit-proof-drop-in-sha256',
      'app-unit-staging-root',
      'app-unit-unset-environment-sha256',
      'app-unit-user',
      'app-unit-working-directory',
      'artifact-manifest-sha256',
      'backup-reserve-bytes',
      'bash-identity',
      'bash-path',
      'bash-sha256',
      'data-dir',
      'data-dir-identity',
      'data-dir-path',
      'cosmos-root-identity',
      'cosmos-root-path',
      'releases-dir-identity',
      'releases-dir-path',
      'current-link-parent-identity',
      'current-link-parent-path',
      'previous-link-parent-identity',
      'previous-link-parent-path',
      'ops-state-dir-identity',
      'ops-state-dir-path',
      'donor-contract-sha256',
      'donor-env-sha256',
      'effective-donor-identity',
      'effective-donor-root',
      'effective-donor-tree-sha256',
      'effect-environment-fd-token',
      'effect-environment-sha256',
      'effect-environment-source-path',
      'exposure-helper-argv-shape',
      'exposure-helper-identity',
      'exposure-helper-path',
      'exposure-helper-sha256',
      'exposure-helper-timeout-ms',
      'alert-helper-argv-shape',
      'alert-helper-identity',
      'alert-helper-path',
      'alert-helper-sha256',
      'alert-helper-timeout-ms',
      'gate-timeout-sec',
      'http-timeout-sec',
      'lock-timeout-sec',
      'ops-readback-timeout-ms',
      'ops-readback-url',
      'env-identity',
      'env-path',
      'env-sha256',
      'curl-identity',
      'curl-path',
      'curl-sha256',
      'node-identity',
      'node-path',
      'node-sha256',
      'release-path',
      'release-identity',
      'release-sha',
      'release-tree-sha256',
      'sqlite-identity',
      'sqlite-path',
      'sqlite-sha256',
      'sqlite-version',
      'systemctl-identity',
      'systemctl-path',
      'systemctl-sha256',
      'systemd-analyze-identity',
      'systemd-analyze-path',
      'systemd-analyze-sha256',
      'l15-amendment-contract-sha256',
      'trusted-builder-public-key-sha256',
    ]),
    optionalEndpointGroups: Object.freeze([
      Object.freeze([
        'first-host-account',
        'first-host-environment',
        'first-host-evidence-sha256',
        'first-host-target-host',
        'recovery-target',
      ]),
      Object.freeze([
        'automatic-rollback-script-identity',
        'automatic-rollback-script-path',
        'automatic-rollback-script-sha256',
        'current-artifact-manifest-sha256',
        'current-release-identity',
        'current-release-path',
        'current-release-sha',
        'current-release-tree-sha256',
        'rollback-evidence-root',
        'rollback-evidence-root-identity',
      ]),
    ]),
  }),
  SERVICE_ROLLBACK: Object.freeze({
    command: 'rollback-switch',
    scope: 'cosmos-production-rollback',
    product: 'Cosmos I00 immutable release',
    credentialType: 'ROOT_LOCAL_OPERATOR_SESSION',
    permission: 'systemd:RestartExactCosmosAppUnit',
    operational: 'switch to one exact schema-compatible immutable rollback release and restart one exact application unit',
    rollback: 'return to the retained exact pre-rollback release if compatibility remains proved',
    recovery: 'stop the application unit and retain exact rollback and reconciliation evidence',
    evidenceRoles: Object.freeze([
      'ARTIFACT_MANIFEST',
      'CURRENT_ARTIFACT_MANIFEST',
      'CURRENT_RELEASE_JSON',
      'DEPLOY_ENV',
      'DONOR_CONTRACT',
      'HOST_EVIDENCE',
      'HOST_READBACK',
      'L15_AMENDMENT_CONTRACT',
      'RELEASE_JSON',
      'RUNTIME_ENV',
      'TRUSTED_BUILD_PUBLIC_KEY',
    ]),
    endpointPrefixes: Object.freeze([
      ...COMMON_EFFECT_ENDPOINT_PREFIXES,
      'app-unit-authority-closure-sha256',
      'app-unit-binding-sha256',
      'app-unit-drop-in-state',
      'app-unit-effect-reachability',
      'app-unit-environment-file-identity',
      'app-unit-environment-file-optional',
      'app-unit-environment-file-path',
      'app-unit-environment-file-sha256',
      'app-unit-exec-start-env-path',
      'app-unit-exec-start-node-path',
      'app-unit-exec-start-sha256',
      'app-unit-fragment-identity',
      'app-unit-fragment-path',
      'app-unit-fragment-sha256',
      'app-unit-fragment-source-identity',
      'app-unit-fragment-source-path',
      'app-unit-fragment-source-sha256',
      'app-unit-group',
      'app-unit-inspection-mode',
      'app-unit-name',
      'app-unit-namespace-remap-state',
      'app-unit-need-daemon-reload',
      'app-unit-offline-unit-root',
      'app-unit-proof-absent-sentinel',
      'app-unit-proof-drop-in-identity',
      'app-unit-proof-drop-in-owner',
      'app-unit-proof-drop-in-path',
      'app-unit-proof-drop-in-runtime-link-identity',
      'app-unit-proof-drop-in-runtime-link-path',
      'app-unit-proof-drop-in-sha256',
      'app-unit-staging-root',
      'app-unit-unset-environment-sha256',
      'app-unit-user',
      'app-unit-working-directory',
      'artifact-manifest-sha256',
      'bash-identity',
      'bash-path',
      'bash-sha256',
      'curl-identity',
      'curl-path',
      'curl-sha256',
      'current-artifact-manifest-sha256',
      'current-release-identity',
      'current-release-path',
      'current-release-sha',
      'current-release-tree-sha256',
      'data-dir',
      'data-dir-identity',
      'data-dir-path',
      'cosmos-root-identity',
      'cosmos-root-path',
      'releases-dir-identity',
      'releases-dir-path',
      'current-link-parent-identity',
      'current-link-parent-path',
      'previous-link-parent-identity',
      'previous-link-parent-path',
      'ops-state-dir-identity',
      'ops-state-dir-path',
      'donor-contract-sha256',
      'donor-env-sha256',
      'effective-donor-identity',
      'effective-donor-root',
      'effective-donor-tree-sha256',
      'effect-environment-fd-token',
      'effect-environment-sha256',
      'effect-environment-source-path',
      'exposure-helper-argv-shape',
      'exposure-helper-identity',
      'exposure-helper-path',
      'exposure-helper-sha256',
      'exposure-helper-timeout-ms',
      'alert-helper-argv-shape',
      'alert-helper-identity',
      'alert-helper-path',
      'alert-helper-sha256',
      'alert-helper-timeout-ms',
      'gate-timeout-sec',
      'http-timeout-sec',
      'lock-timeout-sec',
      'ops-readback-timeout-ms',
      'ops-readback-url',
      'env-identity',
      'env-path',
      'env-sha256',
      'node-identity',
      'node-path',
      'node-sha256',
      'release-path',
      'release-identity',
      'release-id',
      'release-sha',
      'release-tree-sha256',
      'rollback-evidence-root',
      'rollback-evidence-root-identity',
      'systemctl-identity',
      'systemctl-path',
      'systemctl-sha256',
      'systemd-analyze-identity',
      'systemd-analyze-path',
      'systemd-analyze-sha256',
      'l15-amendment-contract-sha256',
      'trusted-builder-public-key-sha256',
    ]),
  }),
  BACKUP_CREATE: Object.freeze({
    command: 'backup-verify',
    scope: 'cosmos-production-backup',
    product: 'Cosmos I00 state backup',
    credentialType: 'ROOT_LOCAL_OPERATOR_SESSION',
    permission: 'filesystem:CreateExactCosmosBackup',
    operational: 'create and verify one exact database evidence and model backup',
    rollback: 'remove only an incomplete unpublished backup staging directory',
    recovery: 'leave the source state unchanged and retain the rejected backup evidence',
    evidenceRoles: Object.freeze([
      'BACKUP_ENV',
      'DONOR_CONTRACT',
      'HOST_EVIDENCE',
      'HOST_READBACK',
      'L15_AMENDMENT_CONTRACT',
      'RUNTIME_ENV',
    ]),
    endpointPrefixes: Object.freeze([
      ...COMMON_EFFECT_ENDPOINT_PREFIXES,
      ...EFFECT_IDENTITY_ENDPOINT_PREFIXES,
      'backup-dir',
      'backup-dir-identity',
      'bash-identity',
      'bash-path',
      'bash-sha256',
      'data-dir',
      'data-dir-identity',
      'data-dir-path',
      'ops-state-dir-identity',
      'ops-state-dir-path',
      'donor-contract-sha256',
      'donor-env-sha256',
      'effective-donor-identity',
      'effective-donor-root',
      'effective-donor-tree-sha256',
      'effect-environment-fd-token',
      'effect-environment-sha256',
      'effect-environment-source-path',
      'env-identity',
      'env-path',
      'env-sha256',
      'hash-identity',
      'hash-path',
      'hash-sha256',
      'gzip-identity',
      'gzip-fd-token',
      'gzip-argv-shape',
      'gzip-path',
      'gzip-sha256',
      'node-identity',
      'node-path',
      'node-sha256',
      'sqlite-identity',
      'sqlite-path',
      'sqlite-sha256',
      'tar-identity',
      'tar-path',
      'tar-sha256',
      'l15-amendment-contract-sha256',
    ]),
  }),
  ISOLATED_RESTORE: Object.freeze({
    command: 'restore-drill-verify',
    scope: 'cosmos-production-isolated-restore',
    product: 'Cosmos I00 isolated restore drill',
    credentialType: 'ROOT_LOCAL_OPERATOR_SESSION',
    permission: 'filesystem:CreateExactIsolatedRestore',
    operational: 'restore and verify one exact backup into one exact isolated target',
    rollback: 'remove only the exact isolated restore target',
    recovery: 'leave production state unchanged and retain the rejected restore evidence',
    evidenceRoles: Object.freeze([
      'BACKUP_DATABASE',
      'BACKUP_ENV',
      'BACKUP_MANIFEST',
      'DONOR_CONTRACT',
      'HOST_EVIDENCE',
      'HOST_READBACK',
      'L15_AMENDMENT_CONTRACT',
      'RUNTIME_ENV',
    ]),
    endpointPrefixes: Object.freeze([
      ...COMMON_EFFECT_ENDPOINT_PREFIXES,
      ...EFFECT_IDENTITY_ENDPOINT_PREFIXES,
      'backup-archive-count',
      'backup-created-at-utc',
      'backup-data-schema',
      'backup-database-sha256',
      'backup-dir',
      'backup-dir-identity',
      'backup-events-count',
      'backup-identity',
      'backup-manifest-sha256',
      'backup-max-age-hours',
      'backup-path',
      'backup-tree-sha256',
      'bash-identity',
      'bash-path',
      'bash-sha256',
      'data-dir',
      'data-dir-identity',
      'data-dir-path',
      'isolated-target-parent-identity',
      'isolated-target-parent-path',
      'donor-contract-sha256',
      'donor-env-sha256',
      'effective-donor-identity',
      'effective-donor-root',
      'effective-donor-tree-sha256',
      'effect-environment-fd-token',
      'effect-environment-sha256',
      'effect-environment-source-path',
      'env-identity',
      'env-path',
      'env-sha256',
      'hash-identity',
      'hash-path',
      'hash-sha256',
      'gzip-identity',
      'gzip-fd-token',
      'gzip-argv-shape',
      'gzip-path',
      'gzip-sha256',
      'isolated-target',
      'node-identity',
      'node-path',
      'node-sha256',
      'sqlite-identity',
      'sqlite-path',
      'sqlite-sha256',
      'tar-identity',
      'tar-path',
      'tar-sha256',
      'l15-amendment-contract-sha256',
    ]),
  }),
  SECRET_MATERIALIZATION: Object.freeze({
    command: 'secrets-provider',
    scope: 'cosmos-production-secret-materialization',
    product: 'AWS Secrets Manager',
    credentialType: 'AWS_INSTANCE_PROFILE_ROLE',
    permissions: Object.freeze([
      'secretsmanager:GetSecretValue',
      'sts:GetCallerIdentity',
    ]),
    operational: 'read one exact secret version into one exact 0600 runtime credential',
    rollback: 'stop the provider and remove only the exact runtime credential',
    recovery: 'leave the service stopped and preserve a redacted failure receipt',
    evidenceRoles: Object.freeze(['PROVIDER_CONFIG']),
    secretEndpoints: true,
  }),
});

export const DEPLOYMENT_ACTION_CLASSES = Object.freeze(Object.keys(ACTION_CLASSES));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObjectKeys(value, keys, label) {
  assert(isPlainRecord(value), `${label} must be one plain object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length
    && actual.every((key, index) => key === expected[index]),
  `${label} has an unexpected field set`);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  assert(value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value)), 'canonical JSON contains an unsupported value');
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalValue(value), null, 2)}\n`, 'utf8');
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function domainDigest(domain, value) {
  return sha256Bytes(Buffer.concat([
    Buffer.from(domain, 'utf8'),
    Buffer.from([0]),
    Buffer.from(canonicalJson(value), 'utf8'),
  ]));
}

function exactText(value, label, { broad = false } = {}) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 2_048
    && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value), `${label} is not exact bounded text`);
  assert(!/(?:REPLACE_ME|CHANGEME|PLACEHOLDER|TBD|TODO|FIXME|UNKNOWN|UNAVAILABLE|<[^>]+>|\$\{[^}]+\}|example\.com)/iu.test(value),
    `${label} contains unresolved text`);
  if (!broad) assert(!value.includes('*') && !/^(?:ALL|ANY|GLOBAL)$/iu.test(value), `${label} is broader than one exact value`);
  assert(!/\bwithdraw(?:al)?\b|\btransfer[ _-]*out\b/iu.test(value), `${label} contains forbidden authority`);
  return value;
}

function exactUtc(value, label) {
  assert(typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)), `${label} must be exact UTC seconds`);
  return value;
}

const DIRECTORY_IDENTITY = /^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,uid=[0-9]+,gid=[0-9]+$/u;
const CANONICAL_ABSOLUTE = (value) => (
  typeof value === 'string' && value.startsWith('/') && resolve(value) === value
);
const directChild = (root, value) => dirname(value) === root && value !== root;

export function validateDeploymentArtifactPolicy(value, actionClass) {
  exactObjectKeys(value, [
    'rootMode',
    'proofRoot',
    'proofRootIdentity',
    'authorizationRoot',
    'authorizationRootIdentity',
    'consumptionRoot',
    'consumptionRootIdentity',
    'receiptRoot',
    'receiptRootIdentity',
    'effectEvidenceRoot',
    'effectEvidenceRootIdentity',
  ], 'artifactPolicy');
  assert(['SYSTEM', 'STAGING', 'TEST'].includes(value.rootMode),
    'artifactPolicy.rootMode is invalid');
  for (const key of [
    'authorizationRoot',
    'consumptionRoot',
    'receiptRoot',
    'effectEvidenceRoot',
  ]) {
    assert(CANONICAL_ABSOLUTE(value[key]), `artifactPolicy.${key} is not canonical`);
    assert(DIRECTORY_IDENTITY.test(value[`${key}Identity`]),
      `artifactPolicy.${key}Identity is invalid`);
  }
  if (value.rootMode === 'SYSTEM') {
    assert(value.proofRoot === 'NONE' && value.proofRootIdentity === 'NONE',
      'SYSTEM artifact policy rejects a proof root');
    assert(value.authorizationRoot === DEPLOYMENT_SYSTEM_ROOTS.authorization
      && value.consumptionRoot === DEPLOYMENT_SYSTEM_ROOTS.consumption
      && value.receiptRoot === DEPLOYMENT_SYSTEM_ROOTS.receipts,
    'SYSTEM artifact policy differs from the exact production roots');
    const expectedEffectRoot = systemEffectEvidenceRoot(actionClass);
    assert(value.effectEvidenceRoot === expectedEffectRoot,
      'SYSTEM effect evidence root differs from the exact class category');
  } else {
    assert(CANONICAL_ABSOLUTE(value.proofRoot)
      && DIRECTORY_IDENTITY.test(value.proofRootIdentity),
    `${value.rootMode} artifact policy proof root is invalid`);
    const expected = {
      authorizationRoot: `${value.proofRoot}/authorization`,
      consumptionRoot: `${value.proofRoot}/consumption`,
      receiptRoot: `${value.proofRoot}/receipts`,
      effectEvidenceRoot: `${value.proofRoot}/effects`,
    };
    for (const [key, path] of Object.entries(expected)) {
      assert(value[key] === path && directChild(value.proofRoot, value[key]),
        `${value.rootMode} artifact policy ${key} is not the exact direct-child category`);
    }
  }
  return Object.freeze(structuredClone(value));
}

function endpointPrefix(endpoint) {
  return endpoint.slice(0, endpoint.indexOf(':'));
}

function endpointValueValid(prefix, value) {
  if (prefix === 'effect-common-sha256') {
    return value === 'NONE' || /^[0-9a-f]{64}$/u.test(value);
  }
  if (prefix === 'app-unit-proof-drop-in-sha256') {
    return value === 'NONE' || /^[0-9a-f]{64}$/u.test(value);
  }
  if (['artifact-manifest-sha256', 'backup-database-sha256', 'backup-manifest-sha256',
    'app-unit-authority-closure-sha256', 'app-unit-binding-sha256',
    'app-unit-environment-file-sha256',
    'app-unit-exec-start-sha256',
    'app-unit-fragment-sha256',
    'app-unit-fragment-source-sha256',
    'app-unit-unset-environment-sha256',
    'current-artifact-manifest-sha256', 'current-release-tree-sha256',
    'bash-sha256', 'chmod-sha256', 'cp-sha256', 'curl-sha256',
    'donor-contract-sha256', 'donor-env-sha256', 'env-sha256',
    'effective-donor-tree-sha256', 'first-host-evidence-sha256', 'hash-sha256',
    'l15-amendment-contract-sha256', 'mkdir-sha256', 'mv-sha256', 'node-sha256',
    'rm-sha256', 'sqlite-sha256', 'provider-config-sha256', 'systemctl-sha256',
    'tar-sha256', 'release-tree-sha256',
    'backup-tree-sha256', 'effect-environment-sha256',
    'effect-program-sha256', 'effect-script-sha256',
    'authorization-wrapper-sha256',
    'automatic-rollback-script-sha256',
    'exposure-helper-sha256', 'alert-helper-sha256', 'gzip-sha256',
    'effect-unit-sha256',
    'getent-sha256', 'id-sha256', 'setpriv-sha256',
    'trusted-builder-public-key-sha256'].includes(prefix)) return /^[0-9a-f]{64}$/u.test(value);
  if (['current-release-sha', 'release-sha'].includes(prefix)) return /^[0-9a-f]{40}$/u.test(value);
  if (prefix === 'release-id') return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
  if (prefix === 'backup-reserve-bytes') return /^[1-9][0-9]*$/u.test(value);
  if (prefix === 'completion-reserve-seconds'
      || prefix === 'receipt-publication-reserve-seconds'
      || prefix === 'backup-max-age-hours') return /^[1-9][0-9]*$/u.test(value);
  if (['effect-uid', 'effect-gid', 'backup-archive-count'].includes(prefix)) {
    return /^(?:0|[1-9][0-9]*)$/u.test(value);
  }
  if (prefix === 'backup-events-count') return /^(?:-1|0|[1-9][0-9]*)$/u.test(value);
  if (prefix === 'backup-data-schema') return value === 'null' || /^(?:0|[1-9][0-9]*)$/u.test(value);
  if (prefix === 'backup-created-at-utc') {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
      && Number.isFinite(Date.parse(value));
  }
  if (prefix === 'aws-region') return /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(value);
  if (prefix === 'aws-cli-sha256') return /^[0-9a-f]{64}$/u.test(value);
  if (prefix === 'aws-cli-path') return value.startsWith('/') && resolve(value) === value;
  if (prefix === 'instance-role-arn') {
    return /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9_+=,.@-]{1,64}$/u.test(value);
  }
  if (prefix === 'required-key') return /^[A-Z][A-Z0-9_]{0,127}$/u.test(value);
  if (prefix === 'secret-version-id') {
    return /^[A-Za-z0-9-]{32,64}$/u.test(value);
  }
  if (prefix === 'recovery-target') return value === 'NO_PRIOR_RELEASE_FIRST_HOST';
  if (prefix === 'app-unit-name') return /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,254}\.service$/u.test(value);
  if (prefix === 'app-unit-drop-in-state') {
    return value === 'NONE' || value === 'EXACT_STAGING_PROOF';
  }
  if (prefix === 'app-unit-proof-drop-in-owner') {
    return ['NONE', 'ROOT', 'INVOKING_TEST_OWNER'].includes(value);
  }
  if (prefix === 'app-unit-environment-file-optional') return value === 'no';
  if (prefix === 'app-unit-user' || prefix === 'app-unit-group') return value === 'cosmos';
  if (prefix === 'app-unit-working-directory') {
    return value.startsWith('/') && resolve(value) === value;
  }
  if (prefix === 'app-unit-namespace-remap-state') return value === 'NONE';
  if (prefix === 'app-unit-staging-root') {
    return value === 'NONE' || (value.startsWith('/') && resolve(value) === value);
  }
  if (prefix === 'app-unit-need-daemon-reload') {
    return value === 'no' || value === 'not-applicable-offline';
  }
  if (prefix === 'effect-environment-fd-token') return value === '/proc/self/fd/12';
  if (prefix === 'exposure-helper-argv-shape') return value === 'NO_ARGS';
  if (prefix === 'exposure-helper-timeout-ms') return value === '3000';
  if (prefix === 'alert-helper-argv-shape') return value === 'SEVERITY_CODE_MESSAGE';
  if (prefix === 'alert-helper-timeout-ms') return value === '5000';
  if (prefix === 'gate-timeout-sec') return value === '60';
  if (prefix === 'http-timeout-sec') return value === '5';
  if (prefix === 'lock-timeout-sec') return value === '30';
  if (prefix === 'ops-readback-timeout-ms') return value === '750';
  if (prefix === 'ops-readback-url') {
    return value === 'http://127.0.0.1:8080/api/system-integration/ops/readback';
  }
  if ([
    'credential-output-parent-identity',
    'destination-parent-identity',
    'cosmos-root-identity',
    'releases-dir-identity',
    'current-link-parent-identity',
    'previous-link-parent-identity',
    'ops-state-dir-identity',
    'backup-dir-identity',
    'isolated-target-parent-identity',
    'data-dir-identity',
  ].includes(prefix)) {
    return DIRECTORY_IDENTITY.test(value);
  }
  if (prefix === 'rollback-evidence-root-identity') {
    return DIRECTORY_IDENTITY.test(value);
  }
  if (prefix === 'gzip-fd-token') return value === '/proc/self/fd/39';
  if (prefix === 'gzip-argv-shape') return value === 'TAR_MANAGED';
  if (prefix === 'app-unit-inspection-mode') {
    return value === 'LIVE_SYSTEM_MANAGER' || value === 'PRIVATE_OFFLINE_UNIT_ROOT';
  }
  if (prefix === 'app-unit-offline-unit-root') {
    return value === 'NONE' || (value.startsWith('/') && resolve(value) === value);
  }
  if (prefix === 'systemd-analyze-sha256') {
    return value === 'NONE' || /^[0-9a-f]{64}$/u.test(value);
  }
  if (['app-unit-environment-file-identity', 'app-unit-fragment-identity',
    'app-unit-fragment-source-identity', 'app-unit-proof-drop-in-identity',
    'app-unit-proof-drop-in-runtime-link-identity',
    'authorization-wrapper-identity',
    'aws-cli-identity', 'backup-identity', 'bash-identity',
    'chmod-identity', 'cp-identity',
    'curl-identity', 'current-release-identity', 'effective-donor-identity',
    'effect-common-identity', 'effect-program-identity',
    'automatic-rollback-script-identity',
    'effect-script-identity', 'effect-unit-identity',
    'env-identity', 'getent-identity', 'gzip-identity', 'hash-identity', 'id-identity',
    'mkdir-identity', 'mv-identity', 'node-identity', 'provider-config-identity',
    'exposure-helper-identity', 'alert-helper-identity',
    'release-identity', 'rm-identity', 'sqlite-identity', 'systemctl-identity',
    'systemd-analyze-identity',
    'setpriv-identity', 'tar-identity'].includes(prefix)) {
    if (value === 'NONE'
        && (prefix.startsWith('app-unit-proof-')
          || prefix === 'effect-common-identity'
          || prefix === 'systemd-analyze-identity')) {
      return true;
    }
    return /^device=[0-9]+,inode=[0-9]+,mode=[0-7]+,size=[0-9]+,mtimeNs=-?[0-9]+,ctimeNs=-?[0-9]+$/u.test(value);
  }
  if (['app-unit-environment-file-path', 'app-unit-exec-start-env-path',
    'app-unit-exec-start-node-path',
    'app-unit-fragment-path', 'app-unit-fragment-source-path',
    'app-unit-proof-absent-sentinel', 'app-unit-proof-drop-in-path',
    'app-unit-proof-drop-in-runtime-link-path',
    'authorization-wrapper-path',
    'backup-dir', 'backup-path', 'bash-path',
    'chmod-path', 'cp-path', 'curl-path', 'data-dir', 'destination', 'env-path',
    'effect-common-path', 'effect-environment-source-path',
    'effect-finish-evidence', 'effect-program-path', 'effect-script-path',
    'automatic-rollback-script-path',
    'effect-start-evidence',
    'effect-unit-path', 'getent-path', 'gzip-path', 'hash-path', 'id-path', 'mkdir-path', 'mv-path',
    'current-release-path', 'effective-donor-root', 'isolated-target', 'node-path',
    'provider-config-path', 'credential-output-path', 'credential-output-parent-path',
    'destination-parent-path', 'cosmos-root-path', 'releases-dir-path',
    'current-link-parent-path', 'previous-link-parent-path', 'ops-state-dir-path',
    'isolated-target-parent-path', 'data-dir-path',
    'exposure-helper-path', 'alert-helper-path',
    'release-path', 'rm-path', 'rollback-evidence-root', 'sqlite-path', 'systemctl-path',
    'systemd-analyze-path',
    'setpriv-path', 'tar-path'].includes(prefix)) {
    if (value === 'NONE'
        && (prefix.startsWith('app-unit-proof-')
          || prefix === 'effect-common-path'
          || prefix === 'systemd-analyze-path')) {
      return true;
    }
    return value.startsWith('/') && resolve(value) === value;
  }
  return value.length > 0;
}

function validateEndpoints(actionClass, endpoints) {
  const contract = ACTION_CLASSES[actionClass];
  assert(Array.isArray(endpoints) && endpoints.length > 0 && endpoints.length <= 128,
    'allowedEndpoints must contain 1 to 128 exact values');
  const values = endpoints.map((entry, index) => exactText(entry, `allowedEndpoints[${index}]`));
  assert(new Set(values).size === values.length, 'allowedEndpoints contains a duplicate');
  assert(values.every((value, index) => value === [...values].sort()[index]),
    'allowedEndpoints must be lexically sorted');
  if (contract.secretEndpoints) {
    const secretArns = values.filter((value) => /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/u.test(value));
    const outputPaths = values.filter((value) => value.startsWith('/') && resolve(value) === value);
    const regions = values.filter((value) => value.startsWith('aws-region:'));
    const cliPaths = values.filter((value) => value.startsWith('aws-cli-path:'));
    const cliDigests = values.filter((value) => value.startsWith('aws-cli-sha256:'));
    const cliIdentities = values.filter((value) => value.startsWith('aws-cli-identity:'));
    const roleArns = values.filter((value) => value.startsWith('instance-role-arn:'));
    const requiredKeys = values.filter((value) => value.startsWith('required-key:'));
    const nodePaths = values.filter((value) => value.startsWith('node-path:'));
    const nodeDigests = values.filter((value) => value.startsWith('node-sha256:'));
    const nodeIdentities = values.filter((value) => value.startsWith('node-identity:'));
    const authorizationWrapperPaths = values
      .filter((value) => value.startsWith('authorization-wrapper-path:'));
    const authorizationWrapperDigests = values
      .filter((value) => value.startsWith('authorization-wrapper-sha256:'));
    const authorizationWrapperIdentities = values
      .filter((value) => value.startsWith('authorization-wrapper-identity:'));
    const providerConfigDigests = values.filter((value) => value.startsWith('provider-config-sha256:'));
    const providerConfigPaths = values.filter((value) => value.startsWith('provider-config-path:'));
    const providerConfigIdentities = values.filter((value) => value.startsWith('provider-config-identity:'));
    const credentialOutputPaths = values.filter((value) => value.startsWith('credential-output-path:'));
    const credentialOutputParentPaths = values
      .filter((value) => value.startsWith('credential-output-parent-path:'));
    const credentialOutputParentIdentities = values
      .filter((value) => value.startsWith('credential-output-parent-identity:'));
    const secretVersionIds = values.filter((value) => value.startsWith('secret-version-id:'));
    const commonEffect = Object.fromEntries(COMMON_EFFECT_ENDPOINT_PREFIXES.map((prefix) => [
      prefix,
      values.filter((value) => value.startsWith(`${prefix}:`)),
    ]));
    const commonEffectCount = Object.values(commonEffect)
      .reduce((count, entries) => count + entries.length, 0);
    assert(secretArns.length === 1 && outputPaths.length === 1 && regions.length === 1
      && cliPaths.length === 1 && cliDigests.length === 1 && cliIdentities.length === 1
      && roleArns.length === 1
      && nodePaths.length === 1 && nodeDigests.length === 1 && nodeIdentities.length === 1
      && authorizationWrapperPaths.length === 1
      && authorizationWrapperDigests.length === 1
      && authorizationWrapperIdentities.length === 1
      && providerConfigDigests.length === 1
      && providerConfigPaths.length === 1
      && providerConfigIdentities.length === 1
      && credentialOutputPaths.length === 1
      && credentialOutputParentPaths.length === 1
      && credentialOutputParentIdentities.length === 1
      && secretVersionIds.length === 1
      && Object.values(commonEffect).every((entries) => entries.length === 1)
      && requiredKeys.length > 0
      && secretArns.length + outputPaths.length + regions.length + cliPaths.length
        + cliDigests.length + cliIdentities.length + roleArns.length
        + nodePaths.length + nodeDigests.length
        + nodeIdentities.length + authorizationWrapperPaths.length
        + authorizationWrapperDigests.length + authorizationWrapperIdentities.length
        + providerConfigDigests.length + providerConfigPaths.length
        + providerConfigIdentities.length
        + credentialOutputPaths.length + credentialOutputParentPaths.length
        + credentialOutputParentIdentities.length + secretVersionIds.length
        + commonEffectCount + requiredKeys.length === values.length,
    'SECRET_MATERIALIZATION requires one provider config digest, secret version, secret ARN, output, region, CLI identity, Node identity, role ARN, effect binding, and exact required keys');
    assert(endpointValueValid('aws-region', regions[0].slice('aws-region:'.length)),
      'SECRET_MATERIALIZATION region is invalid');
    assert(endpointValueValid('aws-cli-path', cliPaths[0].slice('aws-cli-path:'.length)),
      'SECRET_MATERIALIZATION AWS CLI path is invalid');
    assert(endpointValueValid('aws-cli-sha256', cliDigests[0].slice('aws-cli-sha256:'.length)),
      'SECRET_MATERIALIZATION AWS CLI digest is invalid');
    assert(endpointValueValid(
      'aws-cli-identity',
      cliIdentities[0].slice('aws-cli-identity:'.length),
    ), 'SECRET_MATERIALIZATION AWS CLI identity is invalid');
    assert(endpointValueValid('instance-role-arn', roleArns[0].slice('instance-role-arn:'.length)),
      'SECRET_MATERIALIZATION instance role ARN is invalid');
    assert(endpointValueValid('node-path', nodePaths[0].slice('node-path:'.length))
      && endpointValueValid('node-sha256', nodeDigests[0].slice('node-sha256:'.length))
      && endpointValueValid('node-identity', nodeIdentities[0].slice('node-identity:'.length)),
    'SECRET_MATERIALIZATION Node executable identity is invalid');
    assert(endpointValueValid(
      'authorization-wrapper-path',
      authorizationWrapperPaths[0].slice('authorization-wrapper-path:'.length),
    ) && endpointValueValid(
      'authorization-wrapper-sha256',
      authorizationWrapperDigests[0].slice('authorization-wrapper-sha256:'.length),
    ) && endpointValueValid(
      'authorization-wrapper-identity',
      authorizationWrapperIdentities[0].slice('authorization-wrapper-identity:'.length),
    ), 'SECRET_MATERIALIZATION authorization wrapper identity is invalid');
    assert(endpointValueValid(
      'provider-config-sha256',
      providerConfigDigests[0].slice('provider-config-sha256:'.length),
    ), 'SECRET_MATERIALIZATION provider config digest is invalid');
    assert(endpointValueValid(
      'provider-config-path',
      providerConfigPaths[0].slice('provider-config-path:'.length),
    ) && endpointValueValid(
      'provider-config-identity',
      providerConfigIdentities[0].slice('provider-config-identity:'.length),
    ) && endpointValueValid(
      'credential-output-path',
      credentialOutputPaths[0].slice('credential-output-path:'.length),
    ) && endpointValueValid(
      'credential-output-parent-path',
      credentialOutputParentPaths[0].slice('credential-output-parent-path:'.length),
    ) && endpointValueValid(
      'credential-output-parent-identity',
      credentialOutputParentIdentities[0].slice('credential-output-parent-identity:'.length),
    ), 'SECRET_MATERIALIZATION provider or output path is invalid');
    assert(dirname(credentialOutputPaths[0].slice('credential-output-path:'.length))
      === credentialOutputParentPaths[0].slice('credential-output-parent-path:'.length),
    'SECRET_MATERIALIZATION credential output parent differs from its leaf');
    assert(requiredKeys.every((value) => endpointValueValid('required-key', value.slice('required-key:'.length))),
      'SECRET_MATERIALIZATION required key is invalid');
    assert(endpointValueValid(
      'secret-version-id',
      secretVersionIds[0].slice('secret-version-id:'.length),
    ), 'SECRET_MATERIALIZATION secret version is invalid');
    for (const [prefix, entries] of Object.entries(commonEffect)) {
      assert(endpointValueValid(prefix, entries[0].slice(prefix.length + 1)),
        `SECRET_MATERIALIZATION ${prefix} is invalid`);
    }
    assert(commonEffect['effect-common-path'][0] !== 'effect-common-path:NONE'
      && commonEffect['effect-common-sha256'][0] !== 'effect-common-sha256:NONE'
      && commonEffect['effect-common-identity'][0] !== 'effect-common-identity:NONE',
    'SECRET_MATERIALIZATION requires the exact verifier bootstrap binding');
    assert(secretArns[0].split(':')[3] === regions[0].slice('aws-region:'.length),
      'SECRET_MATERIALIZATION ARN and region differ');
    assert(secretArns[0].split(':')[4] === roleArns[0].split(':')[5],
      'SECRET_MATERIALIZATION secret and instance role accounts differ');
    return Object.freeze(values);
  }
  const prefixes = values.map(endpointPrefix);
  assert(prefixes.every((prefix) => prefix.length > 0), 'allowedEndpoints contains an unclassified endpoint');
  const required = contract.endpointPrefixes;
  const optionalGroups = contract.optionalEndpointGroups
    ?? (contract.optionalEndpointPrefixes
      ? [contract.optionalEndpointPrefixes]
      : []);
  const selectedOptionalGroups = optionalGroups.filter(
    (group) => group.some((prefix) => prefixes.includes(prefix)),
  );
  for (const group of selectedOptionalGroups) {
    assert(group.every((prefix) => prefixes.includes(prefix)),
      'optional endpoint class must be complete or absent');
  }
  const expected = [
    ...required,
    ...selectedOptionalGroups.flatMap((group) => group),
  ].sort();
  assert(prefixes.length === expected.length
    && [...prefixes].sort().every((prefix, index) => prefix === expected[index]),
  'allowedEndpoints does not equal the exact class-specific endpoint set');
  for (const endpoint of values) {
    const split = endpoint.indexOf(':');
    assert(endpointValueValid(endpoint.slice(0, split), endpoint.slice(split + 1)),
      `allowed endpoint ${endpoint.slice(0, split)} has an invalid exact value`);
  }
  const commonPath = prefixes.includes('effect-common-path')
    ? values.find((entry) => entry.startsWith('effect-common-path:'))
      .slice('effect-common-path:'.length)
    : null;
  assert(actionClass === 'OPS_BUNDLE_INSTALL'
    ? commonPath === 'NONE'
    : commonPath !== 'NONE',
  'effect common bootstrap binding differs from the class policy');
  if (actionClass === 'SERVICE_RELEASE_SWITCH' || actionClass === 'SERVICE_ROLLBACK') {
    const endpointValue = (prefix) => values
      .find((entry) => entry.startsWith(`${prefix}:`))
      ?.slice(prefix.length + 1);
    assert(endpointValue('app-unit-exec-start-env-path') === endpointValue('env-path'),
      'app unit ExecStart env path differs from the bound env executable');
    assert(endpointValue('app-unit-exec-start-node-path') === endpointValue('node-path'),
      'app unit ExecStart Node path differs from the bound Node executable');
    assert(endpointValue('app-unit-environment-file-optional') === 'no'
      && endpointValue('app-unit-user') === 'cosmos'
      && endpointValue('app-unit-group') === 'cosmos'
      && endpointValue('app-unit-working-directory') === '/opt/cosmos/current'
      && endpointValue('app-unit-namespace-remap-state') === 'NONE',
    'app unit runtime authority closure differs from the exact policy');
    const inspectionMode = endpointValue('app-unit-inspection-mode');
    const offlineRoot = endpointValue('app-unit-offline-unit-root');
    const analyzePath = endpointValue('systemd-analyze-path');
    const analyzeSha256 = endpointValue('systemd-analyze-sha256');
    const analyzeIdentity = endpointValue('systemd-analyze-identity');
    assert(
      (inspectionMode === 'LIVE_SYSTEM_MANAGER'
        && endpointValue('app-unit-need-daemon-reload') === 'no'
        && offlineRoot === 'NONE'
        && analyzePath === 'NONE'
        && analyzeSha256 === 'NONE'
        && analyzeIdentity === 'NONE')
      || (inspectionMode === 'PRIVATE_OFFLINE_UNIT_ROOT'
        && endpointValue('app-unit-need-daemon-reload') === 'not-applicable-offline'
        && offlineRoot !== 'NONE'
        && analyzePath !== 'NONE'
        && analyzeSha256 !== 'NONE'
        && analyzeIdentity !== 'NONE'),
    'app unit inspection authority mode is internally inconsistent');
    const stagingRoot = endpointValue('app-unit-staging-root');
    const proofState = endpointValue('app-unit-drop-in-state');
    const proofAbsentSentinel = endpointValue('app-unit-proof-absent-sentinel');
    const proofIdentity = endpointValue('app-unit-proof-drop-in-identity');
    const proofOwner = endpointValue('app-unit-proof-drop-in-owner');
    const proofPath = endpointValue('app-unit-proof-drop-in-path');
    const proofRuntimeLinkIdentity = endpointValue(
      'app-unit-proof-drop-in-runtime-link-identity',
    );
    const proofRuntimeLinkPath = endpointValue(
      'app-unit-proof-drop-in-runtime-link-path',
    );
    const proofSha256 = endpointValue('app-unit-proof-drop-in-sha256');
    const unit = endpointValue('app-unit-name');
    const unitStem = unit.slice(0, -'.service'.length);
    if (proofState === 'NONE') {
      assert(inspectionMode === 'LIVE_SYSTEM_MANAGER'
        && stagingRoot === 'NONE'
        && [
          proofAbsentSentinel,
          proofIdentity,
          proofOwner,
          proofPath,
          proofRuntimeLinkIdentity,
          proofRuntimeLinkPath,
          proofSha256,
        ].every((value) => value === 'NONE'),
      'live absent app unit proof group is internally inconsistent');
    } else {
      const proofLeaf = `90-${unitStem}.conf`;
      assert(stagingRoot !== 'NONE'
        && proofAbsentSentinel === `${stagingRoot}/.do-not-start-${unitStem}`
        && proofPath === `${stagingRoot}/systemd/${unit}.d/${proofLeaf}`
        && proofIdentity !== 'NONE'
        && proofOwner !== 'NONE'
        && proofSha256 !== 'NONE'
        && (
          (inspectionMode === 'LIVE_SYSTEM_MANAGER'
            && proofRuntimeLinkPath
              === `${stagingRoot}/runtime-systemd/${unit}.d/${proofLeaf}`
            && proofRuntimeLinkIdentity !== 'NONE'
            && ['ROOT', 'INVOKING_TEST_OWNER'].includes(proofOwner))
          || (inspectionMode === 'PRIVATE_OFFLINE_UNIT_ROOT'
            && proofRuntimeLinkPath === 'NONE'
            && proofRuntimeLinkIdentity === 'NONE'
            && proofOwner === 'ROOT')
        ),
      'exact staging app unit proof group is internally inconsistent');
    }
    if (actionClass === 'SERVICE_RELEASE_SWITCH') {
      const firstHost = endpointValue('recovery-target') === 'NO_PRIOR_RELEASE_FIRST_HOST';
      const automaticRollback = endpointValue('automatic-rollback-script-path') !== undefined;
      assert(firstHost !== automaticRollback,
        'release switch must bind exactly one first-host or automatic-rollback class');
    }
  }
  return Object.freeze(values);
}

function classAction(actionClass, endpoints, receiptTargets) {
  const contract = ACTION_CLASSES[actionClass];
  assert(contract !== undefined, 'actionClass is not supported');
  const allowedEndpoints = validateEndpoints(actionClass, endpoints);
  const endpointValue = (prefix) => allowedEndpoints
    .find((entry) => entry.startsWith(`${prefix}:`))
    ?.slice(prefix.length + 1);
  const completionReserveSeconds = DEPLOYMENT_COMPLETION_RESERVE_SECONDS[actionClass];
  const receiptPublicationReserveSeconds =
    DEPLOYMENT_RECEIPT_PUBLICATION_RESERVE_SECONDS[actionClass];
  assert(endpointValue('completion-reserve-seconds') === String(completionReserveSeconds)
    && endpointValue('receipt-publication-reserve-seconds')
      === String(receiptPublicationReserveSeconds),
  'action reserve endpoints differ from the fixed class policy');
  return Object.freeze({
    command: contract.command,
    scope: contract.scope,
    allowedEndpoints,
    allowedProducts: Object.freeze([contract.product]),
    allowedCredentials: Object.freeze({
      types: Object.freeze([contract.credentialType]),
      permissions: Object.freeze([...(contract.permissions ?? [contract.permission])]),
    }),
    preconditions: COMMON_PRECONDITIONS,
    maximumEffect: Object.freeze({
      capital: 'ZERO',
      notional: 'ZERO',
      operational: contract.operational,
    }),
    rollback: contract.rollback,
    recovery: contract.recovery,
    completionReserveSeconds,
    receiptPublicationReserveSeconds,
    receiptTargets: Object.freeze({ ...receiptTargets }),
  });
}

function validateReceiptTargets(value) {
  assert(isPlainRecord(value)
    && Object.keys(value).sort().join('\0') === 'reconciliation\0result', 'receiptTargets has an invalid field set');
  const result = exactText(value.result, 'receiptTargets.result');
  const reconciliation = exactText(value.reconciliation, 'receiptTargets.reconciliation');
  assert(result.startsWith('/') && reconciliation.startsWith('/')
    && resolve(result) === result && resolve(reconciliation) === reconciliation,
  'receipt targets must be canonical absolute paths');
  assert(result !== reconciliation, 'receipt targets must be distinct');
  return Object.freeze({ result, reconciliation });
}

export function validateDeploymentActionRequest(request) {
  const schema = REQUEST_SCHEMA(request);
  assert(schema.valid, `deployment action request schema rejected: ${schema.error}`);
  for (const key of ['authorizationId', 'operator', 'approver', 'approvalReference']) {
    exactText(request[key], key);
  }
  exactUtc(request.startsAtUtc, 'startsAtUtc');
  exactUtc(request.expiresAtUtc, 'expiresAtUtc');
  assert(Date.parse(request.startsAtUtc) < Date.parse(request.expiresAtUtc),
    'authorization window must satisfy start < expiry');
  assert(Date.parse(request.expiresAtUtc) - Date.parse(request.startsAtUtc) <= 60 * 60 * 1_000,
    'authorization active window exceeds one hour');
  const receiptTargets = validateReceiptTargets(request.receiptTargets);
  return Object.freeze({
    ...structuredClone(request),
    receiptTargets,
  });
}

function requestFromRisk(risk) {
  return {
    schemaVersion: 1,
    kind: 'DEPLOYMENT_ACTION_REQUEST',
    status: 'REQUESTED_NOT_AUTHORIZED',
    authorizationId: risk.binding.authorizationId,
    operator: risk.binding.operator,
    approver: risk.binding.approver,
    approvalReference: risk.binding.approvalReference,
    startsAtUtc: risk.authorizationWindow.startsAtUtc,
    expiresAtUtc: risk.authorizationWindow.expiresAtUtc,
    receiptTargets: { ...risk.action.receiptTargets },
  };
}

function validateEvidenceProvenance(actionClass, value) {
  exactObjectKeys(value, ['derivationMode', 'sources'], 'evidenceProvenance');
  assert(value.derivationMode === 'CLASS_SPECIFIC_VERIFIED_EVIDENCE',
    'evidenceProvenance derivation mode is invalid');
  assert(Array.isArray(value.sources), 'evidenceProvenance.sources must be an array');
  const sources = value.sources.map((source, index) => {
    exactObjectKeys(source, ['role', 'sha256'], `evidenceProvenance.sources[${index}]`);
    exactText(source.role, `evidenceProvenance.sources[${index}].role`);
    assert(/^[0-9a-f]{64}$/u.test(source.sha256),
      `evidenceProvenance.sources[${index}].sha256 is invalid`);
    return Object.freeze({ role: source.role, sha256: source.sha256 });
  });
  assert(sources.length > 0 && sources.length <= 16,
    'evidenceProvenance.sources must contain 1 to 16 exact sources');
  assert(new Set(sources.map(({ role }) => role)).size === sources.length,
    'evidenceProvenance contains a duplicate source role');
  assert(sources.every((source, index) => (
    source.role === [...sources].map(({ role }) => role).sort()[index]
  )), 'evidenceProvenance sources must be lexically sorted by role');
  const contract = ACTION_CLASSES[actionClass];
  assert(contract !== undefined, 'actionClass is not supported');
  const required = contract.evidenceRoles;
  const optionalGroups = contract.optionalEvidenceRoleGroups
    ?? (contract.optionalEvidenceRoles ? [contract.optionalEvidenceRoles] : []);
  const selectedOptionalGroups = optionalGroups.filter(
    (group) => group.some((role) => sources.some((source) => source.role === role)),
  );
  for (const group of selectedOptionalGroups) {
    assert(group.every((role) => sources.some((source) => source.role === role)),
      'optional evidence source class must be complete or absent');
  }
  const expected = [
    ...required,
    ...selectedOptionalGroups.flatMap((group) => group),
  ].sort();
  assert(sources.length === expected.length
    && sources.every((source, index) => source.role === expected[index]),
  'evidenceProvenance does not equal the exact class-specific source set');
  return Object.freeze({
    derivationMode: 'CLASS_SPECIFIC_VERIFIED_EVIDENCE',
    sources: Object.freeze(sources),
  });
}

export function executingI00EnforcementProvenance() {
  const producerRelativePath = 'bin/produce-deployment-risk-version.mjs';
  const producerPath = resolve(MODULE_DIR, producerRelativePath);
  return Object.freeze({
    source: 'EXECUTING_I00_ENFORCEMENT_TREE',
    producerRelativePath,
    producerSha256: sha256Bytes(readFileSync(producerPath)),
    i00TreeDigestSha256: typedTreeDigest(MODULE_DIR, {
      excludeTopLevel: ['accepted-ops-live', 'install-receipt.json'],
    }),
  });
}

function validateEnforcementProvenance(value) {
  exactObjectKeys(value, [
    'source', 'producerRelativePath', 'producerSha256', 'i00TreeDigestSha256',
  ], 'enforcementProvenance');
  const expected = executingI00EnforcementProvenance();
  assert(canonicalJson(value) === canonicalJson(expected),
    'risk version is not bound to the executing I00 enforcement tree');
  return expected;
}

function validateDerivedDeploymentEvidence(value) {
  exactObjectKeys(value, [
    'actionClass', 'deployedSha', 'configVersion', 'account', 'environment',
    'host', 'allowedEndpoints', 'evidenceProvenance', 'enforcementProvenance',
  ], 'derived deployment evidence');
  assert(ACTION_CLASSES[value.actionClass] !== undefined, 'actionClass is not supported');
  for (const key of ['configVersion', 'account', 'environment', 'host']) {
    exactText(value[key], `derived deployment evidence.${key}`);
  }
  assert(/^[0-9a-f]{40}$/u.test(value.deployedSha)
    && !/^0{40}$/u.test(value.deployedSha),
  'derived deployedSha must be one resolved full lowercase Git SHA');
  assert(!/\s|:\/\//u.test(value.host), 'derived host must be one exact host name or address');
  const allowedEndpoints = validateEndpoints(value.actionClass, value.allowedEndpoints);
  const evidenceProvenance = validateEvidenceProvenance(
    value.actionClass,
    value.evidenceProvenance,
  );
  const enforcementProvenance = validateEnforcementProvenance(value.enforcementProvenance);
  return Object.freeze({
    actionClass: value.actionClass,
    deployedSha: value.deployedSha,
    configVersion: value.configVersion,
    account: value.account,
    environment: value.environment,
    host: value.host,
    allowedEndpoints,
    evidenceProvenance,
    enforcementProvenance,
  });
}

function buildDeploymentRiskVersionInternal(requestInput, derivedEvidenceInput, {
  issuedAtUtc,
  evidenceValidUntilUtc,
  artifactPolicy,
  nonce = randomBytes(32).toString('hex'),
  provenanceMode = 'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
} = {}) {
  const request = validateDeploymentActionRequest(requestInput);
  const evidence = validateDerivedDeploymentEvidence(derivedEvidenceInput);
  const issued = exactUtc(issuedAtUtc, 'issuedAtUtc');
  const evidenceValidUntil = exactUtc(evidenceValidUntilUtc, 'evidenceValidUntilUtc');
  assert(/^(?:[0-9a-f]{2}){16,64}$/u.test(nonce), 'nonce must be 128 to 512 bits of lowercase hexadecimal');
  assert([
    'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
    'STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
    'TEST_FIXTURE_INJECTED',
  ].includes(provenanceMode),
    'risk producer provenance mode is invalid');
  assert(Date.parse(issued) <= Date.parse(request.startsAtUtc), 'risk production must not occur after authorization start');
  assert(Date.parse(request.expiresAtUtc) - Date.parse(issued) <= 60 * 60 * 1_000,
    'risk-to-expiry window exceeds one hour');
  assert(Date.parse(request.startsAtUtc) < Date.parse(evidenceValidUntil)
    && Date.parse(evidenceValidUntil) <= Date.parse(request.expiresAtUtc),
  'mutable evidence horizon must remain active after start and not exceed authorization expiry');
  const action = classAction(evidence.actionClass, evidence.allowedEndpoints, request.receiptTargets);
  const boundArtifactPolicy = validateDeploymentArtifactPolicy(
    artifactPolicy,
    evidence.actionClass,
  );
  if (['SERVICE_RELEASE_SWITCH', 'SERVICE_ROLLBACK'].includes(evidence.actionClass)) {
    const endpointValue = (prefix) => action.allowedEndpoints
      .find((entry) => entry.startsWith(`${prefix}:`))
      ?.slice(prefix.length + 1);
    if (boundArtifactPolicy.rootMode === 'STAGING') {
      assert(endpointValue('app-unit-inspection-mode') === 'PRIVATE_OFFLINE_UNIT_ROOT'
        && endpointValue('app-unit-offline-unit-root')
          === `${boundArtifactPolicy.proofRoot}/systemd`,
      'STAGING service evidence must use the exact private offline unit root');
    } else {
      assert(endpointValue('app-unit-inspection-mode') === 'LIVE_SYSTEM_MANAGER'
        && endpointValue('app-unit-offline-unit-root') === 'NONE',
      'SYSTEM and TEST service evidence must use the live-system-manager shape');
    }
  }
  assert(directChild(boundArtifactPolicy.receiptRoot, action.receiptTargets.result)
    && directChild(boundArtifactPolicy.receiptRoot, action.receiptTargets.reconciliation),
  'receipt targets must be exact direct children of the bound receipt root');
  const actionEndpoint = (prefix) => action.allowedEndpoints
    .find((entry) => entry.startsWith(`${prefix}:`))
    ?.slice(prefix.length + 1);
  assert(directChild(
    boundArtifactPolicy.effectEvidenceRoot,
    actionEndpoint('effect-start-evidence'),
  ) && directChild(
    boundArtifactPolicy.effectEvidenceRoot,
    actionEndpoint('effect-finish-evidence'),
  ) && actionEndpoint('effect-start-evidence') !== actionEndpoint('effect-finish-evidence'),
  'effect evidence targets must be distinct direct children of the bound effect root');
  const body = {
    schemaVersion: 1,
    kind: 'DEPLOYMENT_RISK_VERSION',
    status: 'BOUND_NOT_AUTHORIZED',
    provenanceMode,
    evidenceValidUntilUtc: evidenceValidUntil,
    artifactPolicy: boundArtifactPolicy,
    requestSha256: domainDigest('I00_DEPLOYMENT_ACTION_REQUEST_V1', request),
    evidenceProvenance: evidence.evidenceProvenance,
    enforcementProvenance: evidence.enforcementProvenance,
    binding: {
      authorizationId: request.authorizationId,
      actionClass: evidence.actionClass,
      operator: request.operator,
      approver: request.approver,
      approvalReference: request.approvalReference,
      deployedSha: evidence.deployedSha,
      configVersion: evidence.configVersion,
      nonce,
      account: evidence.account,
      environment: evidence.environment,
      host: evidence.host,
    },
    authorizationWindow: {
      issuedAtUtc: issued,
      startsAtUtc: request.startsAtUtc,
      expiresAtUtc: request.expiresAtUtc,
    },
    action,
    actionDigest: `sha256:${domainDigest('I00_DEPLOYMENT_ACTION_V1', action)}`,
    policy: POLICY,
  };
  return Object.freeze({
    ...body,
    riskVersion: `i00-deployment-risk-v1:sha256:${domainDigest('I00_DEPLOYMENT_RISK_VERSION_DIGEST_V1', body)}`,
  });
}

function requireCanonicalProducerInvocation(scriptName) {
  const expected = resolve(MODULE_DIR, 'bin', scriptName);
  assert(typeof process.argv[1] === 'string'
    && CANONICAL_ABSOLUTE(process.argv[1])
    && realpathSync(process.argv[1]) === expected,
  `${scriptName} production builder requires the canonical producer entrypoint`);
  if (process.platform === 'linux') {
    const entries = readFileSync('/proc/self/cmdline')
      .toString('utf8')
      .split('\0')
      .filter((value) => value.length > 0);
    assert(entries.length >= 2
      && CANONICAL_ABSOLUTE(entries[1])
      && realpathSync(entries[1]) === expected,
    `${scriptName} production builder process identity is invalid`);
  }
}

export function buildDeploymentRiskVersionForCanonicalProducer(
  requestInput,
  derivedEvidenceInput,
  options,
) {
  requireCanonicalProducerInvocation('produce-deployment-risk-version.mjs');
  return buildDeploymentRiskVersionInternal(requestInput, derivedEvidenceInput, options);
}

export function buildTestDeploymentRiskVersion(
  requestInput,
  derivedEvidenceInput,
  options,
) {
  assert(options?.provenanceMode === 'TEST_FIXTURE_INJECTED'
    && options?.artifactPolicy?.rootMode === 'TEST'
    && validateSimulationRoot(options.artifactPolicy.proofRoot)
      === options.artifactPolicy.proofRoot,
  'TEST fixture risk builder requires one marked simulation artifact policy');
  return buildDeploymentRiskVersionInternal(requestInput, derivedEvidenceInput, options);
}

export function validateDeploymentRiskVersion(risk) {
  const schema = RISK_SCHEMA(risk);
  assert(schema.valid, `deployment risk version schema rejected: ${schema.error}`);
  const request = validateDeploymentActionRequest(requestFromRisk(risk));
  const derivedEvidence = {
    actionClass: risk.binding.actionClass,
    deployedSha: risk.binding.deployedSha,
    configVersion: risk.binding.configVersion,
    account: risk.binding.account,
    environment: risk.binding.environment,
    host: risk.binding.host,
    allowedEndpoints: risk.action.allowedEndpoints,
    evidenceProvenance: risk.evidenceProvenance,
    enforcementProvenance: risk.enforcementProvenance,
  };
  const expected = buildDeploymentRiskVersionInternal(request, derivedEvidence, {
    issuedAtUtc: risk.authorizationWindow.issuedAtUtc,
    nonce: risk.binding.nonce,
    provenanceMode: risk.provenanceMode,
    evidenceValidUntilUtc: risk.evidenceValidUntilUtc,
    artifactPolicy: risk.artifactPolicy,
  });
  assert(canonicalJson(risk) === canonicalJson(expected), 'deployment risk version semantic digest or class binding is invalid');
  return Object.freeze({ document: risk, request, action: risk.action });
}

function previewClaimKey(risk) {
  return domainDigest('I00_DEPLOYMENT_AUTHORIZATION_CLAIM_V1', {
    authorizationId: risk.binding.authorizationId,
    actionClass: risk.binding.actionClass,
    nonce: risk.binding.nonce,
    riskVersion: risk.riskVersion,
    resultReceiptTarget: risk.action.receiptTargets.result,
  });
}

function buildDeploymentActionPreviewInternal(riskInput, riskDocumentSha256, consumptionRoot) {
  const { document: risk } = validateDeploymentRiskVersion(riskInput);
  assert(/^[0-9a-f]{64}$/u.test(riskDocumentSha256), 'riskDocumentSha256 is invalid');
  assert(CANONICAL_ABSOLUTE(consumptionRoot)
    && consumptionRoot === risk.artifactPolicy.consumptionRoot,
  'authorization consumption root differs from the risk artifact policy');
  const body = {
    schemaVersion: 1,
    kind: 'DEPLOYMENT_ACTION_PREVIEW',
    status: 'PREVIEW_READY_NOT_AUTHORIZED',
    provenanceMode: risk.provenanceMode,
    evidenceValidUntilUtc: risk.evidenceValidUntilUtc,
    artifactPolicy: risk.artifactPolicy,
    requestSha256: risk.requestSha256,
    binding: {
      ...risk.binding,
      riskVersion: risk.riskVersion,
    },
    authorizationWindow: risk.authorizationWindow,
    action: risk.action,
    actionDigest: risk.actionDigest,
    riskDocumentSha256,
    singleUse: {
      claimKey: previewClaimKey(risk),
      claimRequired: true,
      consumptionRoot,
      consumptionRootIdentity: risk.artifactPolicy.consumptionRootIdentity,
      reuseDisposition: 'REJECT',
    },
  };
  return Object.freeze({
    ...body,
    serverPreviewDigest: `sha256:${domainDigest('I00_DEPLOYMENT_ACTION_PREVIEW_DIGEST_V1', body)}`,
  });
}

export function buildDeploymentActionPreviewForCanonicalProducer(
  riskInput,
  riskDocumentSha256,
  consumptionRoot,
) {
  requireCanonicalProducerInvocation('produce-deployment-action-preview.mjs');
  return buildDeploymentActionPreviewInternal(
    riskInput,
    riskDocumentSha256,
    consumptionRoot,
  );
}

export function buildTestDeploymentActionPreview(
  riskInput,
  riskDocumentSha256,
  consumptionRoot,
) {
  assert(riskInput?.provenanceMode === 'TEST_FIXTURE_INJECTED'
    && riskInput?.artifactPolicy?.rootMode === 'TEST'
    && validateSimulationRoot(riskInput.artifactPolicy.proofRoot)
      === riskInput.artifactPolicy.proofRoot,
  'TEST fixture preview builder requires one marked simulation artifact policy');
  return buildDeploymentActionPreviewInternal(
    riskInput,
    riskDocumentSha256,
    consumptionRoot,
  );
}

export function validateDeploymentActionPreview(preview, risk, riskDocumentSha256) {
  const schema = PREVIEW_SCHEMA(preview);
  assert(schema.valid, `deployment action preview schema rejected: ${schema.error}`);
  const expected = buildDeploymentActionPreviewInternal(
    risk,
    riskDocumentSha256,
    preview.singleUse.consumptionRoot,
  );
  assert(canonicalJson(preview) === canonicalJson(expected), 'deployment action preview digest or risk binding is invalid');
  return Object.freeze({ document: preview, action: preview.action });
}

function regularFileIdentity(info) {
  return Object.freeze({
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    mode: info.mode.toString(),
    nlink: info.nlink.toString(),
    uid: info.uid.toString(),
    size: info.size.toString(),
    mtimeNs: info.mtimeNs.toString(),
    ctimeNs: info.ctimeNs.toString(),
  });
}

function sameRegularFileIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function readCanonicalDeploymentDocument(path, label, validate) {
  assert(CANONICAL_ABSOLUTE(path), `${label} path must be one raw canonical absolute path`);
  const absolute = resolve(path);
  const namedBefore = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  assert(namedBefore?.isFile() && !namedBefore.isSymbolicLink()
    && namedBefore.nlink === 1n && realpathSync(absolute) === absolute,
    `${label} is missing or unsafe`);
  assert(namedBefore.size > 0n && namedBefore.size <= 1024n * 1024n,
    `${label} size is invalid`);
  assert((namedBefore.mode & 0o777n) === 0o600n,
    `${label} mode must be 0600`);
  if (typeof process.getuid === 'function') {
    const invokingUid = BigInt(process.getuid());
    assert(namedBefore.uid === invokingUid || namedBefore.uid === 0n,
      `${label} owner is not trusted`);
  }
  const expectedIdentity = regularFileIdentity(namedBefore);
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    assert(openedBefore.isFile() && !openedBefore.isSymbolicLink()
      && openedBefore.nlink === 1n
      && sameRegularFileIdentity(regularFileIdentity(openedBefore), expectedIdentity),
    `${label} identity changed before descriptor read`);
    bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    assert(sameRegularFileIdentity(regularFileIdentity(openedAfter), expectedIdentity)
      && BigInt(bytes.length) === openedAfter.size,
    `${label} identity changed during descriptor read`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const namedAfter = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  assert(namedAfter?.isFile() && !namedAfter.isSymbolicLink()
    && realpathSync(absolute) === absolute
    && sameRegularFileIdentity(regularFileIdentity(namedAfter), expectedIdentity),
  `${label} named identity changed after descriptor read`);
  let document;
  try {
    document = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  assert(bytes.equals(canonicalJsonBytes(document)), `${label} bytes are not canonical`);
  const validated = validate(document);
  return Object.freeze({
    absolute,
    bytes,
    sha256: sha256Bytes(bytes),
    identity: expectedIdentity,
    document,
    validated,
  });
}

export function recheckCanonicalDeploymentDocument(evidence, label, validate) {
  assert(isPlainRecord(evidence)
    && typeof evidence.absolute === 'string'
    && typeof evidence.sha256 === 'string'
    && isPlainRecord(evidence.identity),
  `${label} stored evidence identity is invalid`);
  const current = readCanonicalDeploymentDocument(evidence.absolute, label, validate);
  assert(current.absolute === evidence.absolute
    && current.sha256 === evidence.sha256
    && sameRegularFileIdentity(current.identity, evidence.identity),
  `${label} changed before single-use claim`);
  return current;
}

export function inspectPrivateDirectoryEvidence(path, label = 'private directory') {
  assert(CANONICAL_ABSOLUTE(path), `${label} path must be one raw canonical absolute path`);
  const absolute = resolve(path);
  const info = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
  assert(info?.isDirectory() && !info.isSymbolicLink() && realpathSync(absolute) === absolute,
    `${label} must be one canonical existing directory`);
  assert((info.mode & 0o777n) === 0o700n, `${label} mode must be 0700`);
  if (typeof process.getuid === 'function') {
    assert(info.uid === BigInt(process.getuid()), `${label} owner must be the invoking identity`);
  }
  return Object.freeze({
    absolute,
    identity: Object.freeze({
      device: info.dev.toString(),
      inode: info.ino.toString(),
      mode: info.mode.toString(8),
      uid: info.uid.toString(),
      gid: info.gid.toString(),
    }),
  });
}

export function privateDirectoryIdentityEndpoint(evidence) {
  const identity = evidence?.identity ?? evidence;
  exactObjectKeys(identity, ['device', 'inode', 'mode', 'uid', 'gid'], 'private directory identity');
  const endpoint = [
    `device=${identity.device}`,
    `inode=${identity.inode}`,
    `mode=${identity.mode}`,
    `uid=${identity.uid}`,
    `gid=${identity.gid}`,
  ].join(',');
  assert(DIRECTORY_IDENTITY.test(endpoint), 'private directory identity is invalid');
  return endpoint;
}

function privateDirectory(path, label) {
  return inspectPrivateDirectoryEvidence(path, label).absolute;
}

function recheckPrivateDirectory(evidence, label) {
  const current = inspectPrivateDirectoryEvidence(evidence.absolute, label);
  assert(canonicalJson(current.identity) === canonicalJson(evidence.identity),
    `${label} path identity changed`);
  return current;
}

export function writeExactPrivateJson(
  output,
  document,
  label = 'output',
  expectedParentIdentity = null,
) {
  assert(CANONICAL_ABSOLUTE(output), `${label} path must be one raw canonical absolute path`);
  const absolute = resolve(output);
  const parent = inspectPrivateDirectoryEvidence(dirname(absolute), `${label} parent`);
  assert(dirname(absolute) === parent.absolute, `${label} parent path is not canonical`);
  if (expectedParentIdentity !== null) {
    assert(privateDirectoryIdentityEndpoint(parent) === expectedParentIdentity,
      `${label} parent differs from the recorded identity binding`);
  }
  const bytes = canonicalJsonBytes(document);
  let parentDescriptor;
  let descriptor;
  let completed = false;
  try {
    parentDescriptor = openSync(
      parent.absolute,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    const openedParent = fstatSync(parentDescriptor, { bigint: true });
    const openedParentIdentity = {
      device: openedParent.dev.toString(),
      inode: openedParent.ino.toString(),
      mode: openedParent.mode.toString(8),
      uid: openedParent.uid.toString(),
      gid: openedParent.gid.toString(),
    };
    assert(openedParent.isDirectory()
      && canonicalJson(openedParentIdentity) === canonicalJson(parent.identity),
    `${label} parent identity changed before exact create`);
    recheckPrivateDirectory(parent, `${label} parent`);
    const anchoredOutput = process.platform === 'linux'
      ? `/proc/self/fd/${parentDescriptor}/${basename(absolute)}`
      : absolute;
    descriptor = openSync(
      anchoredOutput,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const opened = fstatSync(descriptor, { bigint: true });
    assert(opened.isFile() && !opened.isSymbolicLink() && opened.nlink === 1n
      && (opened.mode & 0o777n) === 0o600n,
    `${label} claim is not a private single-link regular file`);
    if (typeof process.getuid === 'function') {
      assert(opened.uid === BigInt(process.getuid()), `${label} claim owner changed`);
    }
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const createdIdentity = regularFileIdentity(opened);
    const writtenIdentity = regularFileIdentity(openedAfter);
    assert(['dev', 'ino', 'mode', 'nlink', 'uid'].every(
      (key) => createdIdentity[key] === writtenIdentity[key],
    ) && openedAfter.size === BigInt(bytes.length),
    `${label} claim identity changed during write`);
    recheckPrivateDirectory(parent, `${label} parent`);
    const final = lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
    assert(final?.isFile() && !final.isSymbolicLink() && final.nlink === 1n
      && realpathSync(absolute) === absolute
      && sameRegularFileIdentity(regularFileIdentity(final), regularFileIdentity(openedAfter)),
    `${label} final identity is invalid`);
    const openedParentAfter = fstatSync(parentDescriptor, { bigint: true });
    const openedParentAfterIdentity = {
      device: openedParentAfter.dev.toString(),
      inode: openedParentAfter.ino.toString(),
      mode: openedParentAfter.mode.toString(8),
      uid: openedParentAfter.uid.toString(),
      gid: openedParentAfter.gid.toString(),
    };
    assert(openedParentAfter.isDirectory()
      && canonicalJson(openedParentAfterIdentity) === canonicalJson(parent.identity),
    `${label} parent descriptor identity changed before durability sync`);
    if (typeof process.getuid === 'function') {
      assert(openedParentAfter.uid === BigInt(process.getuid()),
        `${label} parent owner changed before durability sync`);
    }
    fsyncSync(parentDescriptor);
    recheckPrivateDirectory(parent, `${label} parent`);
    completed = true;
  } finally {
    if (!completed && descriptor !== undefined) {
      // Pre-completion failure after the exclusive create: remove only the record
      // this call itself created, so an aborted claim leaves no residue that would
      // block a legitimate retry. A call that reaches completion never enters this
      // branch, so a COMPLETED record stays in place and still collides on any
      // single-use replay via the O_EXCL create above.
      try {
        const residuePath = process.platform === 'linux' && parentDescriptor !== undefined
          ? `/proc/self/fd/${parentDescriptor}/${basename(absolute)}`
          : absolute;
        const residue = lstatSync(residuePath, { bigint: true, throwIfNoEntry: false });
        if (residue !== undefined && residue.isFile() && !residue.isSymbolicLink()
            && sameRegularFileIdentity(
              regularFileIdentity(residue),
              regularFileIdentity(fstatSync(descriptor, { bigint: true })),
            )) {
          unlinkSync(residuePath);
        }
      } catch {
        // Residue removal is best effort and must never mask the original refusal.
      }
    }
    if (descriptor !== undefined) closeSync(descriptor);
    if (parentDescriptor !== undefined) closeSync(parentDescriptor);
  }
  return Object.freeze({ absolute, sha256: sha256Bytes(bytes), byteLength: bytes.length });
}

export function buildAuthorizationConsumption({
  authorization,
  authorizationSha256,
  risk,
  riskDocumentSha256,
  preview,
  previewDocumentSha256,
  consumedAtUtc,
}) {
  exactUtc(consumedAtUtc, 'consumedAtUtc');
  const document = {
    schemaVersion: 1,
    kind: 'AUTHORIZATION_CONSUMPTION',
    status: 'AUTHORIZATION_CONSUMED',
    claimKey: preview.singleUse.claimKey,
    authorizationId: authorization.authorizationId,
    actionClass: risk.binding.actionClass,
    nonce: risk.binding.nonce,
    riskVersion: risk.riskVersion,
    serverPreviewDigest: preview.serverPreviewDigest,
    rootMode: preview.artifactPolicy.rootMode,
    consumptionRoot: preview.singleUse.consumptionRoot,
    consumptionRootIdentity: preview.singleUse.consumptionRootIdentity,
    evidenceValidUntilUtc: preview.evidenceValidUntilUtc,
    authorizationSha256,
    riskDocumentSha256,
    previewDocumentSha256,
    consumedAtUtc,
  };
  return validateAuthorizationConsumption(document);
}

export function validateAuthorizationConsumption(document) {
  const schema = CONSUMPTION_SCHEMA(document);
  assert(schema.valid, `authorization consumption schema rejected: ${schema.error}`);
  exactUtc(document.consumedAtUtc, 'authorization consumption consumedAtUtc');
  exactUtc(document.evidenceValidUntilUtc, 'authorization consumption evidenceValidUntilUtc');
  assert(Date.parse(document.consumedAtUtc) < Date.parse(document.evidenceValidUntilUtc),
    'authorization consumption occurred after the evidence horizon');
  assert(['SYSTEM', 'STAGING', 'TEST'].includes(document.rootMode)
    && CANONICAL_ABSOLUTE(document.consumptionRoot)
    && DIRECTORY_IDENTITY.test(document.consumptionRootIdentity),
  'authorization consumption root binding is invalid');
  return Object.freeze(document);
}

export function consumeAuthorization(root, document, expectedRootIdentity) {
  const evidence = inspectPrivateDirectoryEvidence(root, 'authorization consumption root');
  assert(privateDirectoryIdentityEndpoint(evidence) === expectedRootIdentity,
  'authorization consumption root differs from the preview identity binding');
  const parent = evidence.absolute;
  return writeExactPrivateJson(
    resolve(parent, `${document.claimKey}.json`),
    document,
    'authorization consumption',
    expectedRootIdentity,
  );
}
