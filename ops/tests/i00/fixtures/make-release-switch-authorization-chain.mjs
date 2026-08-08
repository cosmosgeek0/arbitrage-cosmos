#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [
  contractInput,
  rootInput,
  fixtureId,
  releaseInput,
  testedSha,
  artifactManifestSha256,
  resultInput,
  reconciliationInput,
  systemctlInput,
  curlInput,
  nodeInput,
  envInput,
  donorEnvInput,
  firstHostEvidenceSha256 = 'NONE',
  effectOutcome = 'success',
] = process.argv.slice(2);
if (!contractInput || !rootInput
    || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(fixtureId ?? '')
    || !releaseInput
    || !/^[0-9a-f]{40}$/u.test(testedSha ?? '')
    || !/^[0-9a-f]{64}$/u.test(artifactManifestSha256 ?? '')
    || !resultInput || !reconciliationInput || !systemctlInput || !curlInput
    || !nodeInput || !envInput || !donorEnvInput
    || (firstHostEvidenceSha256 !== 'NONE'
      && !/^[0-9a-f]{64}$/u.test(firstHostEvidenceSha256))
    || !['success', 'exit-1', 'signal', 'timeout'].includes(effectOutcome)) {
  process.exit(2);
}

const contractPath = resolve(contractInput);
const root = resolve(rootInput);
const release = resolve(releaseInput);
const result = resolve(resultInput);
const reconciliation = resolve(reconciliationInput);
const systemctl = resolve(systemctlInput);
const curl = resolve(curlInput);
const node = resolve(nodeInput);
const env = resolve(envInput);
const donorEnv = resolve(donorEnvInput);
if (root !== rootInput || release !== releaseInput
    || result !== resultInput || reconciliation !== reconciliationInput
    || systemctl !== systemctlInput || curl !== curlInput || node !== nodeInput
    || env !== envInput || donorEnv !== donorEnvInput
    || result === reconciliation) {
  process.exit(2);
}

const {
  buildAuthorizationConsumption,
  buildTestDeploymentActionPreview,
  buildTestDeploymentRiskVersion,
  canonicalJsonBytes,
  executingI00EnforcementProvenance,
  inspectPrivateDirectoryEvidence,
  privateDirectoryIdentityEndpoint,
  sha256Bytes,
  writeExactPrivateJson,
} = await import(pathToFileURL(contractPath).href);
const {
  authorizedEffectEvidenceBytes,
  authorizedEffectEvidenceSha256,
  validateAuthorizedEffectStart,
  validateAuthorizedEffectTerminal,
} = await import(pathToFileURL(
  resolve(dirname(contractPath), 'authorized-effect-evidence.mjs'),
).href);
const { typedTreeDigest } = await import(pathToFileURL(
  resolve(dirname(contractPath), 'lib.mjs'),
).href);
const { validateSimulationRoot } = await import(pathToFileURL(
  resolve(dirname(contractPath), 'simulation-safety.mjs'),
).href);
const { deriveOpsHelperBinding } = await import(pathToFileURL(
  resolve(dirname(contractPath), 'ops-helper-root.mjs'),
).href);

validateSimulationRoot(root);
const rootStat = lstatSync(root);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(root) !== root) {
  process.exit(2);
}
for (const name of [
  'authorization', 'consumption', 'receipts', 'effects', 'tmp',
]) {
  const path = resolve(root, name);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) mkdirSync(path, { mode: 0o700 });
  const current = lstatSync(path);
  if (!current.isDirectory() || current.isSymbolicLink()
      || (current.mode & 0o777) !== 0o700) process.exit(2);
}

const proofRootEvidence = inspectPrivateDirectoryEvidence(root, 'fixture proof root');
const authorizationRootEvidence = inspectPrivateDirectoryEvidence(
  resolve(root, 'authorization'),
  'fixture authorization root',
);
const consumptionRootEvidence = inspectPrivateDirectoryEvidence(
  resolve(root, 'consumption'),
  'fixture consumption root',
);
const receiptRootEvidence = inspectPrivateDirectoryEvidence(
  resolve(root, 'receipts'),
  'fixture receipt root',
);
const effectRootEvidence = inspectPrivateDirectoryEvidence(
  resolve(root, 'effects'),
  'fixture effect root',
);
const artifactPolicy = {
  rootMode: 'TEST',
  proofRoot: proofRootEvidence.absolute,
  proofRootIdentity: privateDirectoryIdentityEndpoint(proofRootEvidence),
  authorizationRoot: authorizationRootEvidence.absolute,
  authorizationRootIdentity: privateDirectoryIdentityEndpoint(authorizationRootEvidence),
  consumptionRoot: consumptionRootEvidence.absolute,
  consumptionRootIdentity: privateDirectoryIdentityEndpoint(consumptionRootEvidence),
  receiptRoot: receiptRootEvidence.absolute,
  receiptRootIdentity: privateDirectoryIdentityEndpoint(receiptRootEvidence),
  effectEvidenceRoot: effectRootEvidence.absolute,
  effectEvidenceRootIdentity: privateDirectoryIdentityEndpoint(effectRootEvidence),
};

const digestBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digestFile = (path) => digestBytes(readFileSync(path));
const endpointIdentity = (stat) => [
  `device=${stat.dev}`,
  `inode=${stat.ino}`,
  `mode=${stat.mode.toString(8)}`,
  `size=${stat.size}`,
  `mtimeNs=${stat.mtimeNs}`,
  `ctimeNs=${stat.ctimeNs}`,
].join(',');
const directoryIdentity = (stat) => [
  `device=${stat.dev}`,
  `inode=${stat.ino}`,
  `mode=${stat.mode.toString(8)}`,
  `uid=${stat.uid}`,
  `gid=${stat.gid}`,
].join(',');
const fileBinding = (path, { executable = false } = {}) => {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path
      || (executable && (stat.mode & 0o111n) === 0n)
      || (stat.mode & 0o022n) !== 0n) {
    process.exit(2);
  }
  return Object.freeze({
    path,
    sha256: digestFile(path),
    identity: endpointIdentity(stat),
  });
};
const directoryBinding = (path) => {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path
      || (stat.mode & 0o022n) !== 0n) process.exit(2);
  return Object.freeze({
    path,
    identity: directoryIdentity(stat),
    endpointIdentity: endpointIdentity(stat),
  });
};
const executableEndpoints = (prefix, binding) => [
  `${prefix}-identity:${binding.identity}`,
  `${prefix}-path:${binding.path}`,
  `${prefix}-sha256:${binding.sha256}`,
];
const parseEnv = (path) => Object.fromEntries(
  readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
      if (match === null) process.exit(2);
      let value = match[2];
      if ((value.startsWith("'") && value.endsWith("'"))
          || (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      return [match[1], value];
    }),
);
const writeBoundFile = (path, bytes, mode) => {
  writeFileSync(path, bytes, { flag: 'wx', mode });
  chmodSync(path, mode);
  return fileBinding(path, { executable: (mode & 0o111) !== 0 });
};

const fixtureRoot = resolve(root, 'tmp', `release-switch-${fixtureId}`);
mkdirSync(fixtureRoot, { mode: 0o700 });
const paths = Object.fromEntries([
  'cosmos',
  'data',
  'ops-state',
  'rollback-evidence',
  'donor',
  'donor/bin',
  'app-unit',
  'trusted',
  'host-evidence',
  'effect-directory',
].map((name) => {
  const path = resolve(fixtureRoot, name);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return [name, path];
}));
const donorEnvBinding = fileBinding(donorEnv);
const donorEnvValues = parseEnv(donorEnv);
const releasesDir = directoryBinding(resolve(donorEnvValues.RELEASES_DIR));
const currentLinkParent = directoryBinding(dirname(resolve(donorEnvValues.CURRENT_LINK)));
const previousLinkParent = directoryBinding(dirname(resolve(donorEnvValues.PREVIOUS_LINK)));
const cosmosRoot = directoryBinding(paths.cosmos);
const dataDir = directoryBinding(paths.data);
const opsStateDir = directoryBinding(paths['ops-state']);
const rollbackEvidenceRoot = directoryBinding(paths['rollback-evidence']);
const effectDirectory = directoryBinding(paths['effect-directory']);

const bashBinding = fileBinding(realpathSync('/bin/bash'), { executable: true });
const systemctlBinding = fileBinding(systemctl, { executable: true });
const curlBinding = fileBinding(curl, { executable: true });
const nodeBinding = fileBinding(node, { executable: true });
const envBinding = fileBinding(env, { executable: true });
const sqliteBinding = writeBoundFile(
  resolve(fixtureRoot, 'sqlite3'),
  Buffer.from('#!/bin/bash\nprintf "3.46.0 fixture\\n"\n'),
  0o500,
);
const deployScript = writeBoundFile(
  resolve(paths['donor/bin'], 'deploy.sh'),
  Buffer.from('#!/bin/bash\nexit 0\n'),
  0o555,
);
const rollbackScript = writeBoundFile(
  resolve(paths['donor/bin'], 'rollback.sh'),
  Buffer.from('#!/bin/bash\nexit 0\n'),
  0o555,
);
const commonScript = writeBoundFile(
  resolve(paths['donor/bin'], 'common.sh'),
  Buffer.from('I00_TEST_COMMON=1\nreadonly I00_TEST_COMMON\n'),
  0o444,
);
const alertHelper = writeBoundFile(
  resolve(paths['donor/bin'], 'alert-log.sh'),
  Buffer.from('#!/bin/bash\nexit 0\n'),
  0o555,
);
const exposureHelper = writeBoundFile(
  resolve(fixtureRoot, 'exposure-from-app.mjs'),
  Buffer.from('#!/usr/bin/env node\nprocess.stdout.write("{}\\\\n");\n'),
  0o500,
);
const donorContract = writeBoundFile(
  resolve(fixtureRoot, 'donor-contract.json'),
  canonicalJsonBytes({
    schemaVersion: 1,
    status: 'TEST_FIXTURE_DONOR_CONTRACT',
    fixtureId,
  }),
  0o400,
);
const l15Contract = writeBoundFile(
  resolve(fixtureRoot, 'l15-amendment-contract.json'),
  canonicalJsonBytes({
    schemaVersion: 1,
    status: 'TEST_FIXTURE_L15_CONTRACT',
    fixtureId,
  }),
  0o400,
);
const trustedKey = writeBoundFile(
  resolve(paths.trusted, 'build-public-key.pem'),
  Buffer.from(`TEST FIXTURE PUBLIC KEY ${fixtureId}\n`),
  0o400,
);
const hostEvidence = writeBoundFile(
  resolve(paths['host-evidence'], 'evidence.json'),
  canonicalJsonBytes({
    source: 'TEST_FIXTURE_HOST_EVIDENCE',
    fixtureId,
  }),
  0o400,
);
const hostReadback = writeBoundFile(
  resolve(paths['host-evidence'], 'readback.json'),
  canonicalJsonBytes({
    source: 'TEST_FIXTURE_HOST_READBACK',
    fixtureId,
  }),
  0o400,
);

const appUnitBytes = Buffer.from([
  '[Service]',
  'User=cosmos',
  'Group=cosmos',
  'WorkingDirectory=/opt/cosmos/current',
  `EnvironmentFile=${donorEnv}`,
  `ExecStart=${envBinding.path} -S ${nodeBinding.path} /opt/cosmos/current/src/server.mjs`,
  '',
].join('\n'));
const appUnitSystemdRoot = resolve(fixtureRoot, 'systemd');
const appUnitRuntimeSystemdRoot = resolve(fixtureRoot, 'runtime-systemd');
mkdirSync(appUnitSystemdRoot, { mode: 0o700 });
mkdirSync(appUnitRuntimeSystemdRoot, { mode: 0o700 });
const appUnitFragment = writeBoundFile(
  resolve(appUnitSystemdRoot, 'cosmos-app.service'),
  appUnitBytes,
  0o400,
);
const appUnitFragmentSource = writeBoundFile(
  resolve(paths['donor'], 'cosmos-app.service'),
  appUnitBytes,
  0o444,
);
const proofDropInDirectory = resolve(
  appUnitSystemdRoot,
  'cosmos-app.service.d',
);
const proofRuntimeDirectory = resolve(
  appUnitRuntimeSystemdRoot,
  'cosmos-app.service.d',
);
mkdirSync(proofDropInDirectory, { mode: 0o700 });
mkdirSync(proofRuntimeDirectory, { recursive: true, mode: 0o700 });
chmodSync(proofDropInDirectory, 0o700);
chmodSync(proofRuntimeDirectory, 0o700);
const proofDropIn = writeBoundFile(
  resolve(proofDropInDirectory, '90-cosmos-app.conf'),
  Buffer.from([
    '[Unit]',
    `ConditionPathExists=${resolve(fixtureRoot, '.do-not-start-cosmos-app')}`,
    '',
    '[Service]',
    'EnvironmentFile=',
    `EnvironmentFile=${donorEnv}`,
    '',
  ].join('\n')),
  0o400,
);
const proofDropInRuntimeLink = resolve(
  proofRuntimeDirectory,
  '90-cosmos-app.conf',
);
symlinkSync(proofDropIn.path, proofDropInRuntimeLink);
const proofDropInRuntimeLinkIdentity = endpointIdentity(
  lstatSync(proofDropInRuntimeLink, { bigint: true }),
);
const appUnitExecStartSha256 = sha256Bytes(canonicalJsonBytes({
  path: envBinding.path,
  argv: [
    envBinding.path,
    '-S',
    nodeBinding.path,
    '/opt/cosmos/current/src/server.mjs',
  ],
  flags: [],
}));
const appUnitAuthorityClosureSha256 = sha256Bytes(canonicalJsonBytes({
  environment: donorEnvBinding,
  fragment: appUnitFragment,
  fragmentSource: appUnitFragmentSource,
  execStartSha256: appUnitExecStartSha256,
  user: 'cosmos',
  group: 'cosmos',
  workingDirectory: '/opt/cosmos/current',
  namespaceRemapState: 'NONE',
}));
const appUnitBindingSha256 = sha256Bytes(canonicalJsonBytes({
  authorityClosureSha256: appUnitAuthorityClosureSha256,
  inspectionMode: 'LIVE_SYSTEM_MANAGER',
  unit: 'cosmos-app.service',
}));
const appUnitUnsetEnvironmentSha256 = sha256Bytes(canonicalJsonBytes([]));

const releaseStat = lstatSync(release, { bigint: true });
if (!releaseStat.isDirectory() || releaseStat.isSymbolicLink()
    || realpathSync(release) !== release) process.exit(2);
const releaseIdentity = endpointIdentity(releaseStat);
const releaseTreeSha256 = typedTreeDigest(release);
const releaseDocument = JSON.parse(readFileSync(resolve(release, 'release.json'), 'utf8'));
if (releaseDocument.testedSha !== testedSha) process.exit(2);
const opsHelperBinding = deriveOpsHelperBinding({
  testedSha,
  i00EnforcementTreeDigestSha256:
    releaseDocument.l15OpsProvenance.i00EnforcementTreeDigestSha256,
  rootMode: 'TEST',
  proofRoot: root,
});
const donorRoot = directoryBinding(paths.donor);
const donorTreeSha256 = typedTreeDigest(paths.donor);
const startEvidencePath = resolve(root, 'effects', `${fixtureId}.start.json`);
const finishEvidencePath = resolve(root, 'effects', `${fixtureId}.terminal.json`);
const endpoints = [
  `app-unit-authority-closure-sha256:${appUnitAuthorityClosureSha256}`,
  `app-unit-binding-sha256:${appUnitBindingSha256}`,
  'app-unit-drop-in-state:EXACT_STAGING_PROOF',
  'app-unit-effect-reachability:TEST_FIXTURE_EXECSTART_REACHES_ACCEPTED_DONOR',
  `app-unit-environment-file-identity:${donorEnvBinding.identity}`,
  'app-unit-environment-file-optional:no',
  `app-unit-environment-file-path:${donorEnvBinding.path}`,
  `app-unit-environment-file-sha256:${donorEnvBinding.sha256}`,
  `app-unit-exec-start-env-path:${envBinding.path}`,
  `app-unit-exec-start-node-path:${nodeBinding.path}`,
  `app-unit-exec-start-sha256:${appUnitExecStartSha256}`,
  `app-unit-fragment-identity:${appUnitFragment.identity}`,
  `app-unit-fragment-path:${appUnitFragment.path}`,
  `app-unit-fragment-sha256:${appUnitFragment.sha256}`,
  `app-unit-fragment-source-identity:${appUnitFragmentSource.identity}`,
  `app-unit-fragment-source-path:${appUnitFragmentSource.path}`,
  `app-unit-fragment-source-sha256:${appUnitFragmentSource.sha256}`,
  'app-unit-group:cosmos',
  'app-unit-inspection-mode:LIVE_SYSTEM_MANAGER',
  'app-unit-name:cosmos-app.service',
  'app-unit-namespace-remap-state:NONE',
  'app-unit-need-daemon-reload:no',
  'app-unit-offline-unit-root:NONE',
  `app-unit-proof-absent-sentinel:${resolve(
    fixtureRoot,
    '.do-not-start-cosmos-app',
  )}`,
  `app-unit-proof-drop-in-identity:${proofDropIn.identity}`,
  `app-unit-proof-drop-in-owner:${
    (process.getuid?.() ?? 0) === 0 ? 'ROOT' : 'INVOKING_TEST_OWNER'
  }`,
  `app-unit-proof-drop-in-path:${proofDropIn.path}`,
  `app-unit-proof-drop-in-runtime-link-identity:${proofDropInRuntimeLinkIdentity}`,
  `app-unit-proof-drop-in-runtime-link-path:${proofDropInRuntimeLink}`,
  `app-unit-proof-drop-in-sha256:${proofDropIn.sha256}`,
  `app-unit-staging-root:${fixtureRoot}`,
  `app-unit-unset-environment-sha256:${appUnitUnsetEnvironmentSha256}`,
  'app-unit-user:cosmos',
  'app-unit-working-directory:/opt/cosmos/current',
  `artifact-manifest-sha256:${artifactManifestSha256}`,
  'backup-reserve-bytes:4096',
  ...executableEndpoints('bash', bashBinding),
  `cosmos-root-identity:${cosmosRoot.identity}`,
  `cosmos-root-path:${cosmosRoot.path}`,
  `curl-identity:${curlBinding.identity}`,
  `curl-path:${curlBinding.path}`,
  `curl-sha256:${curlBinding.sha256}`,
  `current-link-parent-identity:${currentLinkParent.identity}`,
  `current-link-parent-path:${currentLinkParent.path}`,
  `data-dir:${dataDir.path}`,
  `data-dir-identity:${dataDir.identity}`,
  `data-dir-path:${dataDir.path}`,
  `donor-contract-sha256:${donorContract.sha256}`,
  `donor-env-sha256:${donorEnvBinding.sha256}`,
  `effective-donor-identity:${donorRoot.endpointIdentity}`,
  `effective-donor-root:${donorRoot.path}`,
  `effective-donor-tree-sha256:${donorTreeSha256}`,
  'effect-environment-fd-token:/proc/self/fd/12',
  `effect-environment-sha256:${donorEnvBinding.sha256}`,
  `effect-environment-source-path:${donorEnvBinding.path}`,
  'effect-finish-evidence:' + finishEvidencePath,
  `effect-gid:${process.getgid?.() ?? 0}`,
  `effect-program-identity:${bashBinding.identity}`,
  `effect-program-path:${bashBinding.path}`,
  `effect-program-sha256:${bashBinding.sha256}`,
  `effect-script-identity:${deployScript.identity}`,
  `effect-script-path:${deployScript.path}`,
  `effect-script-sha256:${deployScript.sha256}`,
  'effect-start-evidence:' + startEvidencePath,
  `effect-uid:${process.getuid?.() ?? 0}`,
  `effect-common-identity:${commonScript.identity}`,
  `effect-common-path:${commonScript.path}`,
  `effect-common-sha256:${commonScript.sha256}`,
  'completion-reserve-seconds:300',
  'receipt-publication-reserve-seconds:60',
  ...executableEndpoints('env', envBinding),
  ...executableEndpoints('exposure-helper', exposureHelper),
  'exposure-helper-argv-shape:NO_ARGS',
  'exposure-helper-timeout-ms:3000',
  ...executableEndpoints('alert-helper', alertHelper),
  'alert-helper-argv-shape:SEVERITY_CODE_MESSAGE',
  'alert-helper-timeout-ms:5000',
  'gate-timeout-sec:60',
  'http-timeout-sec:5',
  'lock-timeout-sec:30',
  'ops-readback-timeout-ms:750',
  'ops-readback-url:http://127.0.0.1:8080/api/system-integration/ops/readback',
  `l15-amendment-contract-sha256:${l15Contract.sha256}`,
  ...executableEndpoints('node', nodeBinding),
  `ops-helper-app-entrypoint-path:${opsHelperBinding.appEntrypoint}`,
  `ops-helper-root:${opsHelperBinding.root}`,
  `ops-helper-tree-sha256:${opsHelperBinding.i00EnforcementTreeDigestSha256}`,
  `ops-state-dir-identity:${opsStateDir.identity}`,
  `ops-state-dir-path:${opsStateDir.path}`,
  `previous-link-parent-identity:${previousLinkParent.identity}`,
  `previous-link-parent-path:${previousLinkParent.path}`,
  `release-identity:${releaseIdentity}`,
  `release-path:${release}`,
  `release-sha:${testedSha}`,
  `release-tree-sha256:${releaseTreeSha256}`,
  `releases-dir-identity:${releasesDir.identity}`,
  `releases-dir-path:${releasesDir.path}`,
  ...executableEndpoints('sqlite', sqliteBinding),
  'sqlite-version:3.46.0',
  ...executableEndpoints('systemctl', systemctlBinding),
  'systemd-analyze-identity:NONE',
  'systemd-analyze-path:NONE',
  'systemd-analyze-sha256:NONE',
  `trusted-builder-public-key-sha256:${trustedKey.sha256}`,
];
const evidenceSources = new Map([
  ['ARTIFACT_MANIFEST', artifactManifestSha256],
  ['DEPLOY_ENV', donorEnvBinding.sha256],
  ['DONOR_CONTRACT', donorContract.sha256],
  ['HOST_EVIDENCE', hostEvidence.sha256],
  ['HOST_READBACK', hostReadback.sha256],
  ['L15_AMENDMENT_CONTRACT', l15Contract.sha256],
  ['RELEASE_JSON', digestFile(resolve(release, 'release.json'))],
  ['RUNTIME_ENV', donorEnvBinding.sha256],
  ['TRUSTED_BUILD_PUBLIC_KEY', trustedKey.sha256],
]);

let automaticRollback = {};
const writeRoots = [
  ['cosmosRoot', 41, cosmosRoot],
  ['releasesDir', 42, releasesDir],
  ['currentLinkParent', 43, currentLinkParent],
  ['previousLinkParent', 44, previousLinkParent],
  ['opsStateDir', 45, opsStateDir],
  ['dataDir', 49, dataDir],
].map(([name, fd, binding]) => ({
  name,
  fd,
  path: binding.path,
  identity: binding.identity,
}));
if (firstHostEvidenceSha256 !== 'NONE') {
  endpoints.push(
    'first-host-account:123456789012',
    'first-host-environment:isolated-staging',
    `first-host-evidence-sha256:${firstHostEvidenceSha256}`,
    'first-host-target-host:isolated-host.internal',
    'recovery-target:NO_PRIOR_RELEASE_FIRST_HOST',
  );
  evidenceSources.set('FIRST_HOST_EVIDENCE', firstHostEvidenceSha256);
} else {
  const currentRelease = realpathSync(resolve(donorEnvValues.PREVIOUS_LINK));
  const currentReleaseStat = lstatSync(currentRelease, { bigint: true });
  const currentReleaseDocument = JSON.parse(
    readFileSync(resolve(currentRelease, 'release.json'), 'utf8'),
  );
  endpoints.push(
    ...executableEndpoints('automatic-rollback-script', rollbackScript),
    `current-artifact-manifest-sha256:${digestFile(
      resolve(currentRelease, 'artifact-manifest.json'),
    )}`,
    `current-release-identity:${endpointIdentity(currentReleaseStat)}`,
    `current-release-path:${currentRelease}`,
    `current-release-sha:${currentReleaseDocument.testedSha}`,
    `current-release-tree-sha256:${typedTreeDigest(currentRelease)}`,
    `rollback-evidence-root:${rollbackEvidenceRoot.path}`,
    `rollback-evidence-root-identity:${rollbackEvidenceRoot.identity}`,
  );
  evidenceSources.set(
    'CURRENT_ARTIFACT_MANIFEST',
    digestFile(resolve(currentRelease, 'artifact-manifest.json')),
  );
  evidenceSources.set(
    'CURRENT_RELEASE_JSON',
    digestFile(resolve(currentRelease, 'release.json')),
  );
  automaticRollback = {
    status: 'ARMED',
    handoffNonce: digestBytes(Buffer.from(`handoff:${fixtureId}`)),
    script: rollbackScript,
    delegatedArgv: [
      '-p',
      '-c',
      'source /proc/self/fd/13; source /proc/self/fd/35',
      rollbackScript.path,
      '--auto',
      '--i00-effect-environment-fd',
      '12',
    ],
    recovery:
      'switch to the retained exact compatible prior release and restart one application unit',
    scriptFd: 35,
    handoffFd: 36,
    acknowledgementFd: 37,
  };
  writeRoots.splice(5, 0, {
    name: 'rollbackEvidenceRoot',
    fd: 48,
    path: rollbackEvidenceRoot.path,
    identity: rollbackEvidenceRoot.identity,
  });
}
endpoints.sort();

const request = {
  schemaVersion: 1,
  kind: 'DEPLOYMENT_ACTION_REQUEST',
  status: 'REQUESTED_NOT_AUTHORIZED',
  authorizationId: `release-switch-${fixtureId}`,
  operator: 'isolated-staging-operator',
  approver: 'isolated-staging-owner',
  approvalReference: `fixture-${fixtureId}`,
  startsAtUtc: '2026-07-23T00:10:00Z',
  expiresAtUtc: '2026-07-23T00:20:00Z',
  receiptTargets: { result, reconciliation },
};
const risk = buildTestDeploymentRiskVersion(request, {
  actionClass: 'SERVICE_RELEASE_SWITCH',
  deployedSha: testedSha,
  configVersion: 'isolated-config-v1',
  account: '123456789012',
  environment: 'isolated-staging',
  host: 'isolated-host.internal',
  allowedEndpoints: endpoints,
  evidenceProvenance: {
    derivationMode: 'CLASS_SPECIFIC_VERIFIED_EVIDENCE',
    sources: [...evidenceSources]
      .map(([role, sha256]) => ({ role, sha256 }))
      .sort((left, right) => left.role.localeCompare(right.role)),
  },
  enforcementProvenance: executingI00EnforcementProvenance(),
}, {
  issuedAtUtc: '2026-07-23T00:00:00Z',
  evidenceValidUntilUtc: '2026-07-23T00:19:00Z',
  nonce: digestBytes(Buffer.from(`nonce:${fixtureId}`)),
  provenanceMode: 'TEST_FIXTURE_INJECTED',
  artifactPolicy,
});
const riskPath = resolve(root, 'authorization', `${fixtureId}.risk.json`);
const riskBytes = canonicalJsonBytes(risk);
writeFileSync(riskPath, riskBytes, { mode: 0o600, flag: 'wx' });
const preview = buildTestDeploymentActionPreview(
  risk,
  sha256Bytes(riskBytes),
  resolve(root, 'consumption'),
);
const previewPath = resolve(root, 'authorization', `${fixtureId}.preview.json`);
const previewBytes = canonicalJsonBytes(preview);
writeFileSync(previewPath, previewBytes, { mode: 0o600, flag: 'wx' });
const authorization = {
  schemaVersion: 2,
  authorizationId: request.authorizationId,
  operator: request.operator,
  status: 'APPROVED',
  actionClasses: ['SERVICE_RELEASE_SWITCH'],
  scope: preview.action.scope,
  deployedSha: testedSha,
  configVersion: risk.binding.configVersion,
  riskVersion: risk.riskVersion,
  nonce: risk.binding.nonce,
  serverPreviewDigest: preview.serverPreviewDigest,
  account: risk.binding.account,
  environment: risk.binding.environment,
  host: risk.binding.host,
  issuedAtUtc: risk.authorizationWindow.issuedAtUtc,
  startsAtUtc: risk.authorizationWindow.startsAtUtc,
  expiresAtUtc: risk.authorizationWindow.expiresAtUtc,
  allowedCommands: [preview.action.command],
  allowedEndpoints: preview.action.allowedEndpoints,
  allowedProducts: preview.action.allowedProducts,
  allowedCredentials: preview.action.allowedCredentials,
  preconditions: preview.action.preconditions,
  maximumEffect: preview.action.maximumEffect,
  rollback: preview.action.rollback,
  recovery: preview.action.recovery,
  ownerApproval: {
    approver: request.approver,
    approvedAtUtc: '2026-07-23T00:05:00Z',
    reference: request.approvalReference,
  },
  receiptTargets: preview.action.receiptTargets,
};
const authorizationPath = resolve(
  root,
  'authorization',
  `${fixtureId}.authorization.json`,
);
const authorizationBytes = canonicalJsonBytes(authorization);
writeFileSync(authorizationPath, authorizationBytes, { mode: 0o600, flag: 'wx' });
const consumption = buildAuthorizationConsumption({
  authorization,
  authorizationSha256: sha256Bytes(authorizationBytes),
  risk,
  riskDocumentSha256: sha256Bytes(riskBytes),
  preview,
  previewDocumentSha256: sha256Bytes(previewBytes),
  consumedAtUtc: '2026-07-23T00:15:00Z',
});
const consumptionEvidence = writeExactPrivateJson(
  resolve(root, 'consumption', `${consumption.claimKey}.json`),
  consumption,
  'fixture authorization consumption',
);

const effectExecutables = [
  ['node', 16, nodeBinding],
  ['bash', 17, bashBinding],
  ['env', 18, envBinding],
  ['systemctl', 19, systemctlBinding],
  ['curl', 20, curlBinding],
  ['sqlite', 21, sqliteBinding],
  ['exposure', 33, exposureHelper],
  ['alert', 34, alertHelper],
].map(([name, fd, binding]) => ({ name, fd, binding }));
const verifierBinding = fileBinding(
  resolve(dirname(contractPath), 'bin', 'verify-authorized-effect-handoff.mjs'),
);
const commonEffect = {
  actionClass: 'SERVICE_RELEASE_SWITCH',
  authorizationId: authorization.authorizationId,
  claimKey: consumption.claimKey,
  consumptionSha256: consumptionEvidence.sha256,
  riskVersion: risk.riskVersion,
  serverPreviewDigest: preview.serverPreviewDigest,
  effectUid: String(process.getuid?.() ?? 0),
  effectGid: String(process.getgid?.() ?? 0),
  program: bashBinding,
  verifier: verifierBinding,
  delegatedScript: deployScript,
  delegatedBootstrap: {
    kind: 'COMMON_SHELL',
    binding: commonScript,
  },
  delegatedEnvironment: {
    kind: 'SANITIZED_ENV',
    binding: donorEnvBinding,
  },
  effectExecutables,
  delegatedArgv: [
    '-p',
    '-c',
    'source /proc/self/fd/13; source /proc/self/fd/11',
    deployScript.path,
    '--i00-effect-environment-fd',
    '12',
    '--release',
    release,
  ],
  effectDirectory: {
    kind: 'CLAIM_TEMPORARY_DIRECTORY',
    path: effectDirectory.path,
    identity: effectDirectory.identity,
  },
  helperPolicy: {
    exposure: {
      program: 'node',
      script: 'exposure',
      argvShape: 'NO_ARGS',
      timeoutMs: 3000,
    },
    alert: {
      program: 'bash',
      script: 'alert',
      argvShape: 'SEVERITY_CODE_MESSAGE',
      timeoutMs: 5000,
    },
  },
  automaticRollback,
  writeRoots,
  readRoots: [{
    name: 'releaseSource',
    fd: 51,
    path: release,
    identity: releaseIdentity,
    treeSha256: releaseTreeSha256,
  }],
  observedRoots: [],
  effectOutputPolicy: {},
  authorizationExpiresAtUtc: authorization.expiresAtUtc,
  evidenceValidUntilUtc: risk.evidenceValidUntilUtc,
  receiptPublicationReserveSeconds: 60,
  startEvidencePath,
  finishEvidencePath,
  effectStartedAtUtc: '2026-07-23T00:15:00Z',
};
const start = {
  schemaVersion: 1,
  kind: 'AUTHORIZED_EFFECT_START',
  status: 'AUTHORIZED_EFFECT_STARTED',
  ...commonEffect,
};
const outcome = {
  success: {
    status: 'AUTHORIZED_EFFECT_COMPLETED',
    exitCode: 0,
    signal: null,
    forced: false,
    timedOut: false,
    programBindingRetained: true,
  },
  'exit-1': {
    status: 'AUTHORIZED_EFFECT_TERMINATED',
    exitCode: 1,
    signal: null,
    forced: false,
    timedOut: false,
    programBindingRetained: true,
  },
  signal: {
    status: 'AUTHORIZED_EFFECT_TERMINATED',
    exitCode: null,
    signal: 'SIGTERM',
    forced: false,
    timedOut: false,
    programBindingRetained: true,
  },
  timeout: {
    status: 'AUTHORIZED_EFFECT_TERMINATED',
    exitCode: null,
    signal: 'SIGKILL',
    forced: true,
    timedOut: true,
    programBindingRetained: true,
  },
}[effectOutcome];
const success = effectOutcome === 'success';
const terminal = {
  ...start,
  kind: 'AUTHORIZED_EFFECT_TERMINAL',
  status: outcome.status,
  effectFinishedAtUtc: '2026-07-23T00:15:00Z',
  startEvidenceSha256: authorizedEffectEvidenceSha256(start),
  exitCode: outcome.exitCode,
  signal: outcome.signal,
  forced: outcome.forced,
  timedOut: outcome.timedOut,
  automaticRollbackAcknowledged: false,
  automaticRollbackHandoffSha256: Object.keys(automaticRollback).length === 0
    ? null
    : sha256Bytes(canonicalJsonBytes(automaticRollback)),
  programBindingRetained: outcome.programBindingRetained,
  effectMayHaveMutated: !success,
  successRecorderEligible: success,
  effectOutput: { status: 'NOT_APPLICABLE' },
};
validateAuthorizedEffectStart(start);
validateAuthorizedEffectTerminal(terminal, start);
writeFileSync(startEvidencePath, authorizedEffectEvidenceBytes(start), {
  mode: 0o600,
  flag: 'wx',
});
writeFileSync(finishEvidencePath, authorizedEffectEvidenceBytes(terminal), {
  mode: 0o600,
  flag: 'wx',
});

process.stdout.write(`${JSON.stringify({
  authorization: authorizationPath,
  authorizationSha256: sha256Bytes(authorizationBytes),
  risk: riskPath,
  riskSha256: sha256Bytes(riskBytes),
  riskVersion: risk.riskVersion,
  preview: previewPath,
  previewSha256: sha256Bytes(previewBytes),
  serverPreviewDigest: preview.serverPreviewDigest,
  consumption: consumptionEvidence.absolute,
  consumptionSha256: consumptionEvidence.sha256,
  claimKey: consumption.claimKey,
  authorizationId: authorization.authorizationId,
  effectStart: startEvidencePath,
  effectFinish: finishEvidencePath,
})}\n`);
