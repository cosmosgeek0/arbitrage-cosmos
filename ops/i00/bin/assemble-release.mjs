#!/usr/bin/env node
import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  fail, isFullSha, isUtc, listRegularFiles, parseArgs, readJson, requireKeys,
  sha256File, treeDigest,
} from '../lib.mjs';
import { expectedBuildAttestation, verifyBuildAttestation } from './verify-build-attestation.mjs';

const args = parseArgs(process.argv.slice(2), new Set(['rollback-barrier', 'simulation-source']));
for (const key of ['source-root', 'runtime-deps', 'output-root', 'tested-sha', 'tested-receipt', 'built-at-utc', 'schema-version', 'config-revision', 'model-revision']) {
  if (!args[key]) fail(`--${key} is required`);
}
if (!isFullSha(args['tested-sha'])) fail('--tested-sha must be a full lowercase Git SHA');
if (!isUtc(args['built-at-utc'])) fail('--built-at-utc must be exact UTC seconds (YYYY-MM-DDTHH:MM:SSZ)');
if (!/^\d+$/.test(args['schema-version'])) fail('--schema-version must be a non-negative integer');

const source = resolve(args['source-root']);
const runtimeDeps = resolve(args['runtime-deps']);
const outputRoot = resolve(args['output-root']);
const testedReceiptPath = resolve(args['tested-receipt']);
const testedReceipt = readJson(testedReceiptPath, 'tested receipt');
requireKeys(testedReceipt, [
  'schemaVersion', 'status', 'testedSha', 'gitDirty', 'commands', 'completedAtUtc',
  'sourceTree', 'packageLockSha256', 'runtimeDepsDigestSha256',
  'serverDistDigestSha256', 'webDistDigestSha256',
], 'tested receipt');
if (testedReceipt.status !== 'PASS' || testedReceipt.testedSha !== args['tested-sha'] || testedReceipt.gitDirty !== false) {
  fail('tested receipt must be PASS, clean, and match --tested-sha');
}
const requiredCommands = ['npm test', 'npm run test:all', 'bash ops/tests/i00/run-all.sh'];
if (!Array.isArray(testedReceipt.commands)
    || requiredCommands.some((command) => !testedReceipt.commands.some((entry) => entry?.command === command && entry?.exitCode === 0))) {
  fail('tested receipt must contain the exact successful repository and I00 commands');
}

const required = [
  'server/dist/index.js',
  'web/dist/index.html',
  'server/package.json',
  'package.json',
  'package-lock.json',
  'ops/live/RECEIPT.md',
  'ops/live/bin/deploy.sh',
  'ops/live/bin/rollback.sh',
  'ops/i00/donor-contract.json',
  'ops/i00/bin/install-ops-bundle.sh',
];
for (const relative of required) {
  if (!existsSync(resolve(source, relative))) fail(`release input missing ${relative}`);
}
if (!existsSync(runtimeDeps) || listRegularFiles(runtimeDeps).length === 0) {
  fail('--runtime-deps must be a non-empty, prebuilt dependency directory');
}
const packageLockSha256 = sha256File(resolve(source, 'package-lock.json'));
const testedReceiptSha256 = sha256File(testedReceiptPath);
const runtimeDepsDigestSha256 = treeDigest(runtimeDeps);
const serverDistDigestSha256 = treeDigest(resolve(source, 'server/dist'));
const webDistDigestSha256 = treeDigest(resolve(source, 'web/dist'));
if (testedReceipt.packageLockSha256 !== packageLockSha256
    || testedReceipt.runtimeDepsDigestSha256 !== runtimeDepsDigestSha256
    || testedReceipt.serverDistDigestSha256 !== serverDistDigestSha256
    || testedReceipt.webDistDigestSha256 !== webDistDigestSha256) {
  fail('tested receipt does not bind the lockfile, runtime dependencies, and exact build-output trees');
}

let sourceTree;
let sourceVerification;
if (args['simulation-source'] === true) {
  sourceTree = 'SIMULATION_FIXTURE';
  sourceVerification = 'SIMULATION_ONLY';
  if (testedReceipt.sourceTree !== sourceTree) fail('simulation receipt sourceTree mismatch');
} else {
  try {
    const head = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['-C', source, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim();
    sourceTree = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    if (head !== args['tested-sha'] || status !== '' || testedReceipt.sourceTree !== sourceTree) {
      fail('source worktree is not the exact clean tested SHA/tree');
    }
  } catch (error) {
    fail(`source Git binding failed: ${error.message}`);
  }
  sourceVerification = 'GIT_EXACT_CLEAN';
}

const attestationArgs = [
  args['build-attestation'], args['build-attestation-signature'], args['build-attestation-public-key'],
];
let buildAttestation;
if (sourceVerification === 'SIMULATION_ONLY') {
  if (attestationArgs.some(Boolean)) fail('simulation assembly must not claim a production build attestation');
  buildAttestation = { status: 'SIMULATION_ONLY_NOT_ATTESTED' };
} else {
  if (attestationArgs.some(Boolean) && !attestationArgs.every(Boolean)) {
    fail('production assembly requires all build attestation, signature, and public-key paths');
  }
  if (!attestationArgs.every(Boolean)) {
    fail('production assembly requires an owner/CI Ed25519 build attestation');
  }
  const attestation = readJson(resolve(args['build-attestation']), 'build attestation');
  const expected = expectedBuildAttestation({
    testedSha: args['tested-sha'],
    sourceTree,
    testedReceiptSha256,
    packageLockSha256,
    runtimeDepsDigestSha256,
    serverDistDigestSha256,
    webDistDigestSha256,
    testsCompletedAtUtc: testedReceipt.completedAtUtc,
    buildCompletedAtUtc: args['built-at-utc'],
    builderIdentity: attestation.builderIdentity,
  });
  buildAttestation = verifyBuildAttestation({
    attestationPath: args['build-attestation'],
    signaturePath: args['build-attestation-signature'],
    publicKeyPath: args['build-attestation-public-key'],
    expected,
  });
  buildAttestation = {
    ...buildAttestation,
    attestation: 'receipts/build-attestation.json',
    signature: 'receipts/build-attestation.sig',
    publicKey: 'receipts/build-attestation-public-key.pem',
  };
}

const releaseId = `i00-${args['tested-sha']}`;
const destination = resolve(outputRoot, releaseId);
if (existsSync(destination)) fail(`immutable release already exists: ${destination}`);
mkdirSync(outputRoot, { recursive: true });
const staging = resolve(outputRoot, `.partial-${releaseId}-${process.pid}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

try {
  cpSync(resolve(source, 'server/dist'), resolve(staging, 'server/dist'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'web/dist'), resolve(staging, 'web/dist'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'server/package.json'), resolve(staging, 'server/package.json'));
  cpSync(resolve(source, 'package.json'), resolve(staging, 'package.json'));
  cpSync(resolve(source, 'package-lock.json'), resolve(staging, 'package-lock.json'));
  cpSync(resolve(source, 'ops/live'), resolve(staging, 'ops/live'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'ops/i00'), resolve(staging, 'ops/i00'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'ops/templates/i00'), resolve(staging, 'ops/templates/i00'), { recursive: true, errorOnExist: true });
  cpSync(resolve(source, 'ops/docs/i00'), resolve(staging, 'ops/docs/i00'), { recursive: true, errorOnExist: true });
  cpSync(runtimeDeps, resolve(staging, 'node_modules'), { recursive: true, errorOnExist: true });
  if (treeDigest(resolve(staging, 'server/dist')) !== serverDistDigestSha256
      || treeDigest(resolve(staging, 'web/dist')) !== webDistDigestSha256) {
    throw new Error('copied build-output trees do not match the tested receipt');
  }
  mkdirSync(resolve(staging, 'receipts'), { recursive: true });
  cpSync(testedReceiptPath, resolve(staging, 'receipts/tested.json'));
  if (sourceVerification === 'GIT_EXACT_CLEAN') {
    cpSync(resolve(args['build-attestation']), resolve(staging, buildAttestation.attestation));
    cpSync(resolve(args['build-attestation-signature']), resolve(staging, buildAttestation.signature));
    cpSync(resolve(args['build-attestation-public-key']), resolve(staging, buildAttestation.publicKey));
  }

  const release = {
    schemaVersion: Number(args['schema-version']),
    releaseId,
    gitSha: args['tested-sha'],
    testedSha: args['tested-sha'],
    builtAtUtc: args['built-at-utc'],
    rollbackBarrier: Boolean(args['rollback-barrier']),
    configRevision: args['config-revision'],
    modelRevision: args['model-revision'],
    testedReceipt: 'receipts/tested.json',
    testedReceiptSha256,
    runtimeDependencies: 'BUNDLED_PREBUILT',
    runtimeDepsDigestSha256,
    packageLockSha256,
    serverDistDigestSha256,
    webDistDigestSha256,
    sourceTree,
    sourceVerification,
    buildAttestation,
    activationState: 'NOT_DEPLOYED',
  };
  writeFileSync(resolve(staging, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, { mode: 0o600 });

  const files = listRegularFiles(staging).filter((file) => file !== 'artifact-manifest.json');
  const manifest = {
    schemaVersion: 1,
    releaseId,
    testedSha: args['tested-sha'],
    testedBuildOutputs: {
      serverDistDigestSha256,
      webDistDigestSha256,
    },
    buildAttestation,
    files: files.map((file) => ({
      path: file,
      sha256: sha256File(resolve(staging, file)),
      mode: lstatSync(resolve(staging, file)).mode & 0o777,
    })),
  };
  writeFileSync(resolve(staging, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(staging, destination);
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  fail(`release assembly failed: ${error.message}`);
}

process.stdout.write(`${JSON.stringify({ status: 'RELEASE_ASSEMBLED_NOT_DEPLOYED', releaseId, path: destination })}\n`);
