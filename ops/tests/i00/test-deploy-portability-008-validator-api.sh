#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

VALIDATOR="$I00_ROOT/bin/validate-authorization.mjs"

ASSERTIONS="$(
node --input-type=module - "$VALIDATOR" "$TEST_TMP" \
  "$I00_ROOT/deployment-authorization-contract.mjs" <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [validatorSource, testRoot, contractSource] = process.argv.slice(2);
const { DEPLOYMENT_ENDPOINT_BUDGETS } = await import(
  pathToFileURL(contractSource).href
);
const countedEndpointBudgets = Object.freeze({
  OPS_BUNDLE_INSTALL: 47,
  SERVICE_RELEASE_SWITCH: 138,
  SERVICE_ROLLBACK: 131,
  BACKUP_CREATE: 68,
  ISOLATED_RESTORE: 79,
});
assert.deepEqual(
  DEPLOYMENT_ENDPOINT_BUDGETS,
  countedEndpointBudgets,
  'validator API fixture endpoint budgets must equal real DEPLOYMENT_ENDPOINT_BUDGETS',
);
const fixtureEndpointBudgets = Object.freeze({
  ...countedEndpointBudgets,
  SECRET_MATERIALIZATION: 47,
});
const fixtureRoot = resolve(testRoot, 'validator-api');
const fixtureBin = resolve(fixtureRoot, 'bin');
mkdirSync(fixtureBin, { recursive: true, mode: 0o700 });
const validator = resolve(fixtureBin, 'validate-authorization.mjs');
copyFileSync(validatorSource, validator);
chmodSync(validator, 0o500);

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
};
const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(canonicalValue(value))}\n`);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

writeFileSync(resolve(fixtureRoot, 'lib.mjs'), `
export function fail(message) {
  process.stderr.write(\`I00_OPS_BLOCKED: \${message}\\n\`);
  process.exit(1);
}
export function isUtc(value) {
  return typeof value === 'string'
    && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}
export function parseArgs(argv, flags = new Set()) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) fail('unexpected positional argument');
    const name = raw.slice(2);
    if (Object.hasOwn(out, name)) fail(\`duplicate argument --\${name}\`);
    if (flags.has(name)) {
      out[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(\`--\${name} requires a value\`);
    out[name] = value;
    index += 1;
  }
  return out;
}
export function requireKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(\`\${label} must be an object\`);
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(\`\${label} missing \${key}\`);
}
`, { mode: 0o400 });

writeFileSync(resolve(fixtureRoot, 'deployment-authorization-contract.mjs'), `
import { createHash } from 'node:crypto';
import {
  chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
};
const canonicalBytes = (value) => Buffer.from(\`\${JSON.stringify(canonicalValue(value))}\\n\`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
export function deploymentEndpointBudget(actionClass) {
  const budgets = ${JSON.stringify(fixtureEndpointBudgets)};
  if (!Number.isSafeInteger(budgets[actionClass])) throw new Error('class budget unavailable');
  return budgets[actionClass];
}
const exactPath = (path, label) => {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(\`\${label} path must be one raw canonical absolute path\`);
  }
  return path;
};
const fileIdentity = (stat) => ({
  dev: stat.dev.toString(),
  ino: stat.ino.toString(),
  mode: stat.mode.toString(),
  nlink: stat.nlink.toString(),
  uid: stat.uid.toString(),
  size: stat.size.toString(),
  mtimeNs: stat.mtimeNs.toString(),
  ctimeNs: stat.ctimeNs.toString(),
});
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function inspectPrivateDirectoryEvidence(path, label = 'private directory') {
  const absolute = exactPath(path, label);
  const stat = lstatSync(absolute, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute
      || (stat.mode & 0o777n) !== 0o700n) {
    throw new Error(\`\${label} is not one private canonical directory\`);
  }
  return {
    absolute,
    identity: {
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
      mode: stat.mode.toString(8),
      uid: stat.uid.toString(),
      gid: stat.gid.toString(),
    },
  };
}
export function privateDirectoryIdentityEndpoint(evidence) {
  const value = evidence.identity ?? evidence;
  return [
    \`device=\${value.device}\`,
    \`inode=\${value.inode}\`,
    \`mode=\${value.mode}\`,
    \`uid=\${value.uid}\`,
    \`gid=\${value.gid}\`,
  ].join(',');
}
export function readCanonicalDeploymentDocument(path, label, validate) {
  const absolute = exactPath(path, label);
  const before = lstatSync(absolute, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || (before.mode & 0o777n) !== 0o600n || realpathSync(absolute) !== absolute) {
    throw new Error(\`\${label} is missing or unsafe\`);
  }
  const bytes = readFileSync(absolute);
  const document = JSON.parse(bytes);
  if (!bytes.equals(canonicalBytes(document))) throw new Error(\`\${label} bytes are not canonical\`);
  validate(document);
  const after = lstatSync(absolute, { bigint: true });
  if (!same(fileIdentity(before), fileIdentity(after))) throw new Error(\`\${label} changed\`);
  return {
    absolute,
    bytes,
    sha256: sha256(bytes),
    identity: fileIdentity(after),
    document,
  };
}
export function recheckCanonicalDeploymentDocument(evidence, label, validate) {
  const current = readCanonicalDeploymentDocument(evidence.absolute, label, validate);
  if (current.sha256 !== evidence.sha256 || !same(current.identity, evidence.identity)) {
    throw new Error(\`\${label} changed before claim\`);
  }
  return current;
}
export function validateDeploymentRiskVersion(document) {
  if (document?.kind !== 'DEPLOYMENT_RISK_VERSION') throw new Error('risk invalid');
  return document;
}
export function validateDeploymentActionPreview(document, risk, riskSha256) {
  if (document?.kind !== 'DEPLOYMENT_ACTION_PREVIEW'
      || document.binding.riskVersion !== risk.riskVersion
      || document.riskDocumentSha256 !== riskSha256) throw new Error('preview invalid');
  return document;
}
export function validateAuthorizationConsumption(document) {
  if (document?.kind !== 'AUTHORIZATION_CONSUMPTION'
      || Date.parse(document.consumedAtUtc) >= Date.parse(document.evidenceValidUntilUtc)) {
    throw new Error('authorization consumption is stale or invalid');
  }
  return document;
}
export function buildAuthorizationConsumption({
  authorization, authorizationSha256, risk, riskDocumentSha256, preview,
  previewDocumentSha256, consumedAtUtc,
}) {
  return validateAuthorizationConsumption({
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
  });
}
export function consumeAuthorization(root, document, expectedRootIdentity) {
  const evidence = inspectPrivateDirectoryEvidence(root, 'authorization consumption root');
  if (privateDirectoryIdentityEndpoint(evidence) !== expectedRootIdentity) {
    throw new Error('authorization consumption root differs from preview identity');
  }
  const output = resolve(root, \`\${document.claimKey}.json\`);
  const bytes = canonicalBytes(document);
  const descriptor = openSync(
    output,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(output, 0o600);
  return { absolute: output, sha256: sha256(bytes), byteLength: bytes.length };
}
`, { mode: 0o400 });

const nodePath = realpathSync(process.execPath);
const nodeStat = lstatSync(nodePath, { bigint: true });
const nodeSha256 = digest(readFileSync(nodePath));
const nodeIdentity = [
  `device=${nodeStat.dev}`,
  `inode=${nodeStat.ino}`,
  `mode=${nodeStat.mode.toString(8)}`,
  `size=${nodeStat.size}`,
  `mtimeNs=${nodeStat.mtimeNs}`,
  `ctimeNs=${nodeStat.ctimeNs}`,
].join(',');
const directoryIdentity = (path) => {
  const stat = lstatSync(path, { bigint: true });
  return [
    `device=${stat.dev}`,
    `inode=${stat.ino}`,
    `mode=${stat.mode.toString(8)}`,
    `uid=${stat.uid}`,
    `gid=${stat.gid}`,
  ].join(',');
};
const writeDocument = (path, document) => {
  writeFileSync(path, canonicalBytes(document), { flag: 'wx', mode: 0o600 });
  chmodSync(path, 0o600);
};
const utc = (milliseconds) => new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/u, 'Z');

function fixture(mode, name, {
  actionClass = 'OPS_BUNDLE_INSTALL',
  endpointCount = null,
  provenanceMode = {
    SYSTEM: 'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
    STAGING: 'STAGING_SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
    TEST: 'TEST_FIXTURE_INJECTED',
  }[mode],
  stale = false,
  missingConsumptionIdentity = false,
} = {}) {
  const root = resolve(fixtureRoot, name);
  const authorizationRoot = resolve(root, 'authorization');
  const consumptionRoot = resolve(root, 'consumption');
  const receiptRoot = resolve(root, 'receipts');
  const effectRoot = resolve(root, 'effects');
  for (const path of [root, authorizationRoot, consumptionRoot, receiptRoot, effectRoot]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
  const now = Date.now();
  const issuedAtUtc = utc(now - 20_000);
  const startsAtUtc = utc(now - 10_000);
  const expiresAtUtc = utc(now + 600_000);
  const evidenceValidUntilUtc = stale ? utc(now - 1_000) : utc(now + 500_000);
  const artifactPolicy = {
    rootMode: mode,
    proofRoot: mode === 'SYSTEM' ? 'NONE' : root,
    proofRootIdentity: mode === 'SYSTEM' ? 'NONE' : directoryIdentity(root),
    authorizationRoot,
    authorizationRootIdentity: directoryIdentity(authorizationRoot),
    consumptionRoot,
    consumptionRootIdentity: directoryIdentity(consumptionRoot),
    receiptRoot,
    receiptRootIdentity: directoryIdentity(receiptRoot),
    effectEvidenceRoot: effectRoot,
    effectEvidenceRootIdentity: directoryIdentity(effectRoot),
  };
  const result = resolve(receiptRoot, 'result.json');
  const reconciliation = resolve(receiptRoot, 'reconciliation.json');
  const allowedEndpoints = [
    'completion-reserve-seconds:300',
    `effect-finish-evidence:${resolve(effectRoot, 'terminal.json')}`,
    'effect-gid:0',
    `effect-program-path:${nodePath}`,
    `effect-script-path:${validator}`,
    `effect-start-evidence:${resolve(effectRoot, 'start.json')}`,
    'effect-uid:0',
    `node-identity:${nodeIdentity}`,
    `node-path:${nodePath}`,
    `node-sha256:${nodeSha256}`,
    'receipt-publication-reserve-seconds:60',
  ];
  if (endpointCount !== null) {
    if (!Number.isSafeInteger(endpointCount) || endpointCount < allowedEndpoints.length) {
      throw new Error('endpointCount must preserve the executable validator bindings');
    }
    for (let index = allowedEndpoints.length; index < endpointCount; index += 1) {
      allowedEndpoints.push(`validator-budget-slot-${String(index + 1).padStart(3, '0')}:bound`);
    }
  }
  const action = {
    command: 'validator-api-proof',
    scope: 'validator-api-proof-scope',
    allowedEndpoints: allowedEndpoints.sort(),
    allowedProducts: ['Validator API proof'],
    allowedCredentials: {
      types: ['ROOT_LOCAL_OPERATOR_SESSION'],
      permissions: ['filesystem:ValidatorApiProof'],
    },
    preconditions: [
      'exact target evidence is current and complete',
      'owner approval follows this exact preview',
    ],
    maximumEffect: {
      capital: 'ZERO',
      notional: 'ZERO',
      operational: 'validate one isolated authorization chain',
    },
    rollback: 'leave the isolated fixture unchanged',
    recovery: 'retain the isolated fixture evidence',
    completionReserveSeconds: 300,
    receiptPublicationReserveSeconds: 60,
    receiptTargets: { result, reconciliation },
  };
  const binding = {
    authorizationId: `validator-api-${name}`,
    actionClass,
    operator: 'validator-api-operator',
    approver: 'validator-api-owner',
    approvalReference: `validator-api-${name}`,
    deployedSha: '0123456789abcdef0123456789abcdef01234567',
    configVersion: 'validator-api-config',
    nonce: digest(Buffer.from(name)),
    account: '123456789012',
    environment: mode === 'STAGING' ? 'isolated-staging-a1b2' : `validator-${mode.toLowerCase()}`,
    host: mode === 'STAGING' ? 'cosmos-df32-proof-a1b2.internal' : 'validator.internal',
  };
  const risk = {
    kind: 'DEPLOYMENT_RISK_VERSION',
    provenanceMode,
    evidenceValidUntilUtc,
    artifactPolicy,
    binding,
    authorizationWindow: { issuedAtUtc, startsAtUtc, expiresAtUtc },
    action,
    riskVersion: `i00-deployment-risk-v1:sha256:${digest(Buffer.from(`risk:${name}`))}`,
  };
  const riskPath = resolve(authorizationRoot, 'risk.json');
  writeDocument(riskPath, risk);
  const preview = {
    kind: 'DEPLOYMENT_ACTION_PREVIEW',
    provenanceMode,
    evidenceValidUntilUtc,
    artifactPolicy,
    binding: { ...binding, riskVersion: risk.riskVersion },
    authorizationWindow: risk.authorizationWindow,
    action,
    riskDocumentSha256: digest(readFileSync(riskPath)),
    singleUse: {
      claimKey: digest(Buffer.from(`claim:${name}`)),
      claimRequired: true,
      consumptionRoot,
      ...(missingConsumptionIdentity
        ? {}
        : { consumptionRootIdentity: artifactPolicy.consumptionRootIdentity }),
      reuseDisposition: 'REJECT',
    },
    serverPreviewDigest: `sha256:${digest(Buffer.from(`preview:${name}`))}`,
  };
  const previewPath = resolve(authorizationRoot, 'preview.json');
  writeDocument(previewPath, preview);
  const authorization = {
    schemaVersion: 2,
    authorizationId: binding.authorizationId,
    operator: binding.operator,
    status: 'APPROVED',
    actionClasses: [binding.actionClass],
    scope: action.scope,
    deployedSha: binding.deployedSha,
    configVersion: binding.configVersion,
    riskVersion: risk.riskVersion,
    nonce: binding.nonce,
    serverPreviewDigest: preview.serverPreviewDigest,
    account: binding.account,
    environment: binding.environment,
    host: binding.host,
    issuedAtUtc,
    startsAtUtc,
    expiresAtUtc,
    allowedCommands: [action.command],
    allowedEndpoints: action.allowedEndpoints,
    allowedProducts: action.allowedProducts,
    allowedCredentials: action.allowedCredentials,
    preconditions: action.preconditions,
    maximumEffect: action.maximumEffect,
    rollback: action.rollback,
    recovery: action.recovery,
    ownerApproval: {
      approver: binding.approver,
      approvedAtUtc: issuedAtUtc,
      reference: binding.approvalReference,
    },
    receiptTargets: action.receiptTargets,
  };
  const authorizationPath = resolve(authorizationRoot, 'authorization.json');
  writeDocument(authorizationPath, authorization);
  return {
    root,
    authorizationRoot,
    consumptionRoot,
    receiptRoot,
    effectRoot,
    authorizationPath,
    riskPath,
    previewPath,
    action,
    binding,
    risk,
    preview,
    nowUtc: utc(now),
  };
}

function validatorArguments(value, overrides = {}) {
  const input = overrides.input ?? value.authorizationPath;
  const risk = overrides.risk ?? value.riskPath;
  const preview = overrides.preview ?? value.previewPath;
  const consumptionRoot = overrides.consumptionRoot ?? value.consumptionRoot;
  const argv = [
    '--input', input,
    '--class', value.binding.actionClass,
    '--command', value.action.command,
    '--expected-operator', value.binding.operator,
    '--expected-deployed-sha', value.binding.deployedSha,
    '--expected-config-version', value.binding.configVersion,
    '--deployment-risk', risk,
    '--action-preview', preview,
    '--consumption-root', consumptionRoot,
    '--expected-host', value.binding.host,
    '--expected-environment', value.binding.environment,
    '--expected-scope', value.action.scope,
    '--expected-account', value.binding.account,
    '--expected-product', value.action.allowedProducts[0],
    '--expected-credential-type', value.action.allowedCredentials.types[0],
    '--expected-result-receipt', value.action.receiptTargets.result,
    '--expected-reconciliation-receipt', value.action.receiptTargets.reconciliation,
    '--expected-maximum-capital', value.action.maximumEffect.capital,
    '--expected-maximum-notional', value.action.maximumEffect.notional,
    '--expected-maximum-effect', value.action.maximumEffect.operational,
  ];
  for (const permission of value.action.allowedCredentials.permissions) {
    argv.push('--expected-permission', permission);
  }
  for (const endpoint of value.action.allowedEndpoints) {
    argv.push('--expected-endpoint', endpoint);
  }
  if (overrides.simulationClock === true) {
    argv.push('--simulation-clock', '--now', overrides.now ?? value.nowUtc);
  }
  return argv;
}

function run(value, overrides = {}) {
  return spawnSync(nodePath, [validator, ...validatorArguments(value, overrides)], {
    encoding: 'utf8',
    env: {
      HOME: '/nonexistent',
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

let assertions = 0;
const expect = (condition, label) => {
  if (!condition) throw new Error(label);
  assertions += 1;
};
const expectPass = (result, label) => {
  expect(result.status === 0 && result.stderr === '', `${label}: ${result.stderr}`);
  return JSON.parse(result.stdout);
};
const expectBlock = (result, fragment, label) => {
  expect(result.status !== 0 && result.stderr.includes(fragment), `${label}: ${result.stderr}`);
};

for (const mode of ['SYSTEM', 'STAGING', 'TEST']) {
  const value = fixture(mode, `positive-${mode.toLowerCase()}`);
  const output = expectPass(
    run(value, {
      simulationClock: mode === 'TEST',
      now: value.nowUtc,
    }),
    `${mode} positive`,
  );
  expect(output.rootMode === mode, `${mode} output rootMode`);
  expect(output.provenanceMode === value.risk.provenanceMode, `${mode} output provenance`);
  expect(output.authorizationSha256 === digest(readFileSync(value.authorizationPath)),
    `${mode} authorization digest`);
  expect(output.riskDocumentSha256 === digest(readFileSync(value.riskPath)),
    `${mode} risk digest`);
  expect(output.previewDocumentSha256 === digest(readFileSync(value.previewPath)),
    `${mode} preview digest`);
  expect(output.consumptionRoot === value.consumptionRoot
    && output.consumptionRootIdentity === directoryIdentity(value.consumptionRoot),
  `${mode} consumption root binding`);
  expect(output.claimKey === value.preview.singleUse.claimKey
    && output.consumptionSha256 === digest(readFileSync(output.consumptionReceipt)),
  `${mode} claim digest`);
  expect(output.authorizationConsumptionPath === output.consumptionReceipt
    && output.authorizationConsumptionSha256 === output.consumptionSha256
    && output.authorizationConsumptionRoot === output.consumptionRoot
    && output.authorizationConsumptionRootIdentity === output.consumptionRootIdentity,
  `${mode} canonical consumption API`);
  expect(output.evidenceValidUntilUtc === value.risk.evidenceValidUntilUtc
    && output.effectStartEvidence === resolve(value.effectRoot, 'start.json')
    && output.effectTerminalEvidence === resolve(value.effectRoot, 'terminal.json'),
  `${mode} evidence output`);
  expect(output.completionReserveSeconds === 300
    && output.receiptPublicationReserveSeconds === 60,
  `${mode} reserve output`);
}

const releaseSwitchBudget = fixture('TEST', 'release-switch-budget', {
  actionClass: 'SERVICE_RELEASE_SWITCH',
  endpointCount: 138,
});
expect(releaseSwitchBudget.action.allowedEndpoints.length === 138,
  'release-switch fixture must carry the exact 138 endpoint budget');
expectPass(
  run(releaseSwitchBudget, {
    simulationClock: true,
    now: releaseSwitchBudget.nowUtc,
  }),
  'real validator accepts the exact release-switch endpoint budget',
);

const reuse = fixture('TEST', 'single-use');
expectPass(run(reuse, { simulationClock: true, now: reuse.nowUtc }), 'single-use first');
expectBlock(
  run(reuse, { simulationClock: true, now: reuse.nowUtc }),
  'EEXIST',
  'single-use replay',
);

const relocated = fixture('TEST', 'relocated');
const relocatedPath = resolve(relocated.root, 'relocated-authorization.json');
copyFileSync(relocated.authorizationPath, relocatedPath);
chmodSync(relocatedPath, 0o600);
expectBlock(
  run(relocated, {
    input: relocatedPath,
    simulationClock: true,
    now: relocated.nowUtc,
  }),
  'direct-child JSON leaf',
  'relocated authorization',
);

const rawAlias = fixture('TEST', 'raw-alias');
expectBlock(
  run(rawAlias, {
    input: `${rawAlias.authorizationRoot}/../authorization/authorization.json`,
    simulationClock: true,
    now: rawAlias.nowUtc,
  }),
  'raw canonical absolute path',
  'noncanonical authorization alias',
);

const swapped = fixture('TEST', 'root-swap');
const oldAuthorizationRoot = `${swapped.authorizationRoot}.old`;
renameSync(swapped.authorizationRoot, oldAuthorizationRoot);
mkdirSync(swapped.authorizationRoot, { mode: 0o700 });
chmodSync(swapped.authorizationRoot, 0o700);
for (const name of ['authorization.json', 'risk.json', 'preview.json']) {
  copyFileSync(resolve(oldAuthorizationRoot, name), resolve(swapped.authorizationRoot, name));
  chmodSync(resolve(swapped.authorizationRoot, name), 0o600);
}
expectBlock(
  run(swapped, {
    input: resolve(swapped.authorizationRoot, 'authorization.json'),
    risk: resolve(swapped.authorizationRoot, 'risk.json'),
    preview: resolve(swapped.authorizationRoot, 'preview.json'),
    simulationClock: true,
    now: swapped.nowUtc,
  }),
  'producer-bound path or identity',
  'authorization root swap',
);

const missingIdentity = fixture('TEST', 'missing-identity', {
  missingConsumptionIdentity: true,
});
expectBlock(
  run(missingIdentity, {
    simulationClock: true,
    now: missingIdentity.nowUtc,
  }),
  'authorization consumption root',
  'missing consumption identity',
);

const stale = fixture('TEST', 'stale', { stale: true });
expectBlock(
  run(stale, { simulationClock: true, now: stale.nowUtc }),
  'stale or invalid',
  'stale evidence horizon',
);

const crossMode = fixture('STAGING', 'cross-mode', {
  provenanceMode: 'SYSTEM_CLOCK_CRYPTOGRAPHIC_NONCE',
});
expectBlock(
  run(crossMode),
  'provenance mode does not match',
  'cross-mode provenance',
);

const systemWithSimulation = fixture('SYSTEM', 'system-with-simulation');
expectBlock(
  run(systemWithSimulation, {
    simulationClock: true,
    now: systemWithSimulation.nowUtc,
  }),
  'simulation clock mode does not match',
  'SYSTEM simulation downgrade',
);

const testWithoutSimulation = fixture('TEST', 'test-without-simulation');
expectBlock(
  run(testWithoutSimulation),
  'simulation clock mode does not match',
  'TEST production upgrade',
);

process.stdout.write(String(assertions));
NODE
)"

[ "$ASSERTIONS" -ge 40 ] || fail_test "validator API proof returned too few assertions"
finish
