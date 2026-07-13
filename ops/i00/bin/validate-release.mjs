#!/usr/bin/env node
import { existsSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fail, isFullSha, isUtc, listRegularFiles, parseArgs, readJson, requireKeys, sha256File,
  treeDigest,
} from '../lib.mjs';
import {
  assertTrustedBuildPublicKey, expectedBuildAttestation, verifyBuildAttestation,
} from './verify-build-attestation.mjs';

const args = parseArgs(process.argv.slice(2), new Set(['allow-simulation']));
if (!args.release) fail('--release is required');
const root = resolve(args.release);
const release = readJson(resolve(root, 'release.json'), 'release.json');
const manifest = readJson(resolve(root, 'artifact-manifest.json'), 'artifact-manifest.json');
requireKeys(release, [
  'releaseId', 'gitSha', 'testedSha', 'builtAtUtc', 'schemaVersion', 'rollbackBarrier',
  'configRevision', 'modelRevision', 'testedReceipt', 'testedReceiptSha256',
  'activationState', 'sourceTree', 'sourceVerification', 'packageLockSha256',
  'runtimeDepsDigestSha256', 'serverDistDigestSha256', 'webDistDigestSha256',
  'buildAttestation',
], 'release.json');
if (!isFullSha(release.gitSha) || release.gitSha !== release.testedSha) fail('release SHA fields must be one identical full Git SHA');
if (release.releaseId !== `i00-${release.testedSha}`) fail('releaseId must be keyed by the full tested SHA');
if (!isUtc(release.builtAtUtc)) fail('release builtAtUtc is invalid');
if (!Number.isInteger(release.schemaVersion) || release.schemaVersion < 0) fail('release schemaVersion is invalid');
if (typeof release.rollbackBarrier !== 'boolean') fail('release rollbackBarrier must be boolean');
if (release.activationState !== 'NOT_DEPLOYED') fail('artifact creation must not claim deployment');
if (release.testedReceipt !== 'receipts/tested.json') fail('release testedReceipt path is not canonical');
if (release.sourceVerification === 'SIMULATION_ONLY') {
  if (args['allow-simulation'] !== true || release.sourceTree !== 'SIMULATION_FIXTURE') {
    fail('simulation release is forbidden without --allow-simulation');
  }
} else if (release.sourceVerification !== 'GIT_EXACT_CLEAN' || !/^[0-9a-f]{40}$/.test(release.sourceTree)) {
  fail('release source is not bound to an exact clean Git tree');
}

for (const relative of [
  'server/dist/index.js', 'web/dist/index.html', 'server/package.json', 'package.json',
  'package-lock.json', 'node_modules', 'ops/live/RECEIPT.md', 'ops/live/bin/deploy.sh',
  'ops/live/bin/rollback.sh', 'ops/i00/donor-contract.json',
  'ops/i00/bin/install-ops-bundle.sh',
]) {
  if (!existsSync(resolve(root, relative))) fail(`release payload missing ${relative}`);
}
const testedPath = resolve(root, release.testedReceipt);
if (sha256File(testedPath) !== release.testedReceiptSha256) fail('tested receipt digest mismatch');
const tested = readJson(testedPath, 'tested receipt');
requireKeys(tested, ['schemaVersion', 'commands', 'completedAtUtc'], 'tested receipt');
if (tested.status !== 'PASS' || tested.testedSha !== release.testedSha || tested.gitDirty !== false) {
  fail('embedded tested receipt does not prove this clean SHA');
}
const requiredCommands = ['npm test', 'npm run test:all', 'bash ops/tests/i00/run-all.sh'];
if (tested.schemaVersion !== 1 || !isUtc(tested.completedAtUtc)
    || Date.parse(tested.completedAtUtc) > Date.parse(release.builtAtUtc)
    || !Array.isArray(tested.commands)
    || requiredCommands.some((command) => !tested.commands.some((entry) => entry?.command === command && entry?.exitCode === 0))) {
  fail('embedded tested receipt lacks exact successful commands or valid chronology');
}
if (tested.sourceTree !== release.sourceTree
    || tested.packageLockSha256 !== release.packageLockSha256
    || tested.runtimeDepsDigestSha256 !== release.runtimeDepsDigestSha256
    || tested.serverDistDigestSha256 !== release.serverDistDigestSha256
    || tested.webDistDigestSha256 !== release.webDistDigestSha256) {
  fail('embedded tested receipt does not match release provenance digests');
}

if (release.sourceVerification === 'SIMULATION_ONLY') {
  if (JSON.stringify(release.buildAttestation) !== JSON.stringify({ status: 'SIMULATION_ONLY_NOT_ATTESTED' })) {
    fail('simulation release must remain explicitly unattested');
  }
} else {
  const attestationKeys = [
    'status', 'algorithm', 'builderIdentity', 'attestation', 'attestationSha256',
    'signature', 'signatureSha256', 'publicKey', 'publicKeySha256',
  ];
  requireKeys(release.buildAttestation, [
    ...attestationKeys,
  ], 'release buildAttestation');
  const actualAttestationKeys = Object.keys(release.buildAttestation).sort();
  if (actualAttestationKeys.length !== attestationKeys.length
      || actualAttestationKeys.some((key, index) => key !== [...attestationKeys].sort()[index])) {
    fail('release buildAttestation has an unexpected field set');
  }
  if (release.buildAttestation.status !== 'VERIFIED_ED25519'
      || release.buildAttestation.algorithm !== 'Ed25519') {
    fail('production release lacks verified Ed25519 provenance');
  }
  if (release.buildAttestation.attestation !== 'receipts/build-attestation.json'
      || release.buildAttestation.signature !== 'receipts/build-attestation.sig'
      || release.buildAttestation.publicKey !== 'receipts/build-attestation-public-key.pem') {
    fail('production build attestation paths are not canonical release-local paths');
  }
  const attestationPath = resolve(root, release.buildAttestation.attestation);
  const signaturePath = resolve(root, release.buildAttestation.signature);
  const publicKeyPath = resolve(root, release.buildAttestation.publicKey);
  const trustedPublicKeyPath = args['trusted-build-public-key'] || process.env.I00_TRUSTED_BUILD_PUBLIC_KEY;
  if (!trustedPublicKeyPath) {
    fail('production validation requires --trusted-build-public-key or I00_TRUSTED_BUILD_PUBLIC_KEY');
  }
  assertTrustedBuildPublicKey({ embeddedPublicKeyPath: publicKeyPath, trustedPublicKeyPath });
  for (const [path, digest, label] of [
    [attestationPath, release.buildAttestation.attestationSha256, 'attestation'],
    [signaturePath, release.buildAttestation.signatureSha256, 'signature'],
    [publicKeyPath, release.buildAttestation.publicKeySha256, 'public key'],
  ]) {
    if (sha256File(path) !== digest) fail(`embedded build ${label} digest mismatch`);
  }
  const expected = expectedBuildAttestation({
    testedSha: release.testedSha,
    sourceTree: release.sourceTree,
    testedReceiptSha256: release.testedReceiptSha256,
    packageLockSha256: release.packageLockSha256,
    runtimeDepsDigestSha256: release.runtimeDepsDigestSha256,
    serverDistDigestSha256: release.serverDistDigestSha256,
    webDistDigestSha256: release.webDistDigestSha256,
    testsCompletedAtUtc: tested.completedAtUtc,
    buildCompletedAtUtc: release.builtAtUtc,
    builderIdentity: release.buildAttestation.builderIdentity,
  });
  const verified = verifyBuildAttestation({
    attestationPath,
    signaturePath,
    publicKeyPath,
    expected,
  });
  for (const field of ['attestationSha256', 'signatureSha256', 'publicKeySha256', 'builderIdentity']) {
    if (verified[field] !== release.buildAttestation[field]) fail(`build attestation ${field} mismatch`);
  }
}

requireKeys(manifest, ['schemaVersion', 'releaseId', 'testedSha', 'testedBuildOutputs', 'buildAttestation', 'files'], 'artifact manifest');
requireKeys(manifest.testedBuildOutputs, ['serverDistDigestSha256', 'webDistDigestSha256'], 'artifact manifest.testedBuildOutputs');
if (manifest.releaseId !== release.releaseId || manifest.testedSha !== release.testedSha) fail('artifact manifest identity mismatch');
if (JSON.stringify(manifest.buildAttestation) !== JSON.stringify(release.buildAttestation)) {
  fail('artifact manifest build attestation does not match release provenance');
}
if (manifest.testedBuildOutputs.serverDistDigestSha256 !== release.serverDistDigestSha256
    || manifest.testedBuildOutputs.webDistDigestSha256 !== release.webDistDigestSha256) {
  fail('artifact manifest build-output digests do not match release provenance');
}
if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('artifact manifest files must be non-empty');
const actualFiles = listRegularFiles(root).filter((file) => file !== 'artifact-manifest.json');
const declared = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
if (declared.size !== actualFiles.length || actualFiles.some((file) => !declared.has(file))) {
  fail('artifact manifest path set does not match the release');
}
for (const file of actualFiles) {
  const entry = manifest.files.find((candidate) => candidate.path === file);
  if (sha256File(resolve(root, file)) !== entry.sha256 || (lstatSync(resolve(root, file)).mode & 0o777) !== entry.mode) {
    fail(`artifact digest/mode mismatch: ${file}`);
  }
}
if (treeDigest(resolve(root, 'server/dist')) !== release.serverDistDigestSha256
    || treeDigest(resolve(root, 'web/dist')) !== release.webDistDigestSha256) {
  fail('release build-output trees do not match tested provenance');
}

process.stdout.write(`${JSON.stringify({ status: 'RELEASE_VALID_NOT_DEPLOYED', releaseId: release.releaseId, testedSha: release.testedSha, fileCount: actualFiles.length })}\n`);
