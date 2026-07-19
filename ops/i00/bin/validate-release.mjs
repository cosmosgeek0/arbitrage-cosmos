#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fail, isFullSha, isUtc, listRegularFiles, parseArgs, readJson, requireExactKeys, sha256File,
  treeDigest, typedTreeDigest,
} from '../lib.mjs';
import {
  COMPLETE_ACCEPTANCE_STEP_COUNT, COMPLETE_ACCEPTANCE_TRUTH,
  validateCompleteAcceptanceReceipt,
} from '../complete-acceptance-receipt.mjs';
import { validateCanonicalAcceptanceEvidence } from '../canonical-acceptance-validation.mjs';
import { assertReleaseMatchesCompiledLedger } from '../ledger-compatibility.mjs';
import { loadL15AmendmentContract, verifyEffectiveL15Root } from '../l15-amendment.mjs';
import {
  assertTrustedBuildPublicKey, expectedBuildAttestation, verifyBuildAttestation,
} from './verify-build-attestation.mjs';

const EXPECTED_AMENDMENT_CONTRACT_SHA256 = '5477f84d41701364c8ad90be5f490d762633eadebedb80996e6467368aa458f6';
const args = parseArgs(process.argv.slice(2), new Set(['allow-simulation']));
if (!args.release) fail('--release is required');
const root = resolve(args.release);
const release = readJson(resolve(root, 'release.json'), 'release.json');
const manifestPath = resolve(root, 'artifact-manifest.json');
let manifestBytes;
let manifest;
try {
  manifestBytes = readFileSync(manifestPath);
  manifest = JSON.parse(manifestBytes);
} catch (error) {
  fail(`artifact-manifest.json is unreadable or invalid JSON: ${error.message}`);
}
const artifactManifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
const releaseKeys = [
  'releaseId', 'gitSha', 'testedSha', 'builtAtUtc', 'schemaVersion', 'rollbackBarrier',
  'rollbackFloor', 'compatibilitySource', 'compatibilitySourceSha256',
  'configRevision', 'modelRevision', 'testedReceipt', 'testedReceiptSha256', 'acceptanceEvidence',
  'activationState', 'sourceTree', 'sourceVerification', 'packageLockSha256',
  'runtimeDepsDigestSha256', 'serverDistDigestSha256', 'webDistDigestSha256',
  'runtimeDependencies', 'l15OpsProvenance', 'buildAttestation',
];
requireExactKeys(release, releaseKeys, 'release.json');
if (!isFullSha(release.gitSha) || release.gitSha !== release.testedSha) fail('release SHA fields must be one identical full Git SHA');
if (release.releaseId !== `i00-${release.testedSha}`) fail('releaseId must be keyed by the full tested SHA');
if (!isUtc(release.builtAtUtc)) fail('release builtAtUtc is invalid');
if (!Number.isSafeInteger(release.schemaVersion) || release.schemaVersion < 0
    || !Number.isSafeInteger(release.rollbackFloor) || release.rollbackFloor < 0
    || release.rollbackFloor > release.schemaVersion) {
  fail('release Ledger compatibility range is invalid');
}
if (release.rollbackFloor !== 0 && release.rollbackFloor !== release.schemaVersion) {
  fail('release rollbackFloor cannot be represented by the accepted donor contract');
}
if (typeof release.rollbackBarrier !== 'boolean'
    || release.rollbackBarrier !== (release.rollbackFloor > 0)) {
  fail('release rollbackBarrier does not match its Ledger rollback floor');
}
if (release.runtimeDependencies !== 'BUNDLED_PREBUILT') fail('release runtime dependency posture is invalid');
if (release.activationState !== 'NOT_DEPLOYED') fail('artifact creation must not claim deployment');
if (release.testedReceipt !== 'receipts/complete-local-acceptance.json') fail('release testedReceipt path is not canonical');
if (release.sourceVerification === 'SIMULATION_ONLY') {
  if (args['allow-simulation'] !== true || !isFullSha(release.sourceTree)) {
    fail('simulation release is forbidden without --allow-simulation');
  }
} else if (release.sourceVerification !== 'GIT_EXACT_CLEAN' || !/^[0-9a-f]{40}$/.test(release.sourceTree)) {
  fail('release source is not bound to an exact clean Git tree');
}

for (const relative of [
  'server/dist/index.js', 'server/dist/ledger.js', 'web/dist/index.html', 'server/package.json', 'package.json',
  'package-lock.json', 'node_modules', 'ops/live/RECEIPT.md', 'ops/live/bin/deploy.sh',
  'ops/live/bin/rollback.sh', 'ops/i00/donor-contract.json', 'ops/i00/l15-amendment-contract.json',
  'ops/i00/l15-amendment.mjs', 'ops/i00/lib.mjs', 'ops/i00/bin/install-ops-bundle.sh',
  'ops/i00/bin/verify-donor.mjs', 'ops/i00/bin/verify-donor-root.mjs',
]) {
  if (!existsSync(resolve(root, relative))) fail(`release payload missing ${relative}`);
}
for (const forbidden of ['accepted-ops-live', 'install-receipt.json']) {
  if (existsSync(resolve(root, 'ops/i00', forbidden))) {
    fail(`release ops/i00 contains reserved installed-bundle path ${forbidden}`);
  }
}
const trustedI00Root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trustedI00EnforcementTreeDigestSha256 = typedTreeDigest(trustedI00Root, {
  excludeTopLevel: ['accepted-ops-live', 'install-receipt.json'],
});
const releaseI00EnforcementTreeDigestSha256 = typedTreeDigest(resolve(root, 'ops/i00'));
if (releaseI00EnforcementTreeDigestSha256 !== trustedI00EnforcementTreeDigestSha256) {
  fail('release ops/i00 enforcement cohort differs from the trusted validator cohort');
}
const loadedL15Contract = loadL15AmendmentContract(
  resolve(root, 'ops/i00/l15-amendment-contract.json'),
  EXPECTED_AMENDMENT_CONTRACT_SHA256,
);
const l15Verification = verifyEffectiveL15Root({
  root: resolve(root, 'ops/live'),
  loadedContract: loadedL15Contract,
});
const expectedL15OpsProvenance = {
  immutableDonorCommit: l15Verification.immutableDonorCommit,
  immutableDonorLiveTree: l15Verification.immutableDonorLiveTree,
  immutableDonorContractSha256: l15Verification.immutableDonorContractSha256,
  amendmentContractSha256: l15Verification.amendmentContractSha256,
  effectiveLiveTree: l15Verification.effectiveLiveTree,
  effectiveRootDigestSha256: l15Verification.effectiveRootDigestSha256,
  i00EnforcementTreeDigestSha256: releaseI00EnforcementTreeDigestSha256,
  findingIds: l15Verification.findingIds,
};
requireExactKeys(release.l15OpsProvenance, [
  'immutableDonorCommit', 'immutableDonorLiveTree', 'immutableDonorContractSha256',
  'amendmentContractSha256', 'effectiveLiveTree', 'effectiveRootDigestSha256',
  'i00EnforcementTreeDigestSha256', 'findingIds',
], 'release l15OpsProvenance');
if (JSON.stringify(release.l15OpsProvenance) !== JSON.stringify(expectedL15OpsProvenance)) {
  fail('release effective L15 provenance does not match the pinned amendment contract');
}
let compiledCompatibility;
try {
  compiledCompatibility = assertReleaseMatchesCompiledLedger(release, root);
} catch (error) {
  fail(`release compatibility verification failed: ${error.message}`);
}
const testedPath = resolve(root, release.testedReceipt);
if (sha256File(testedPath) !== release.testedReceiptSha256) fail('tested receipt digest mismatch');
requireExactKeys(release.acceptanceEvidence, [
  'truthClass', 'candidateSha', 'candidateTree', 'requiredStepCount',
  'browserReceipt', 'browserReceiptSha256', 'performanceReceipt',
  'performanceReceiptSha256',
], 'release acceptanceEvidence');
if (release.acceptanceEvidence.truthClass !== COMPLETE_ACCEPTANCE_TRUTH
    || release.acceptanceEvidence.candidateSha !== release.testedSha
    || release.acceptanceEvidence.candidateTree !== release.sourceTree
    || release.acceptanceEvidence.requiredStepCount !== COMPLETE_ACCEPTANCE_STEP_COUNT
    || release.acceptanceEvidence.browserReceipt !== 'receipts/local-browser-acceptance.json'
    || release.acceptanceEvidence.performanceReceipt !== 'receipts/local-proxy-performance.json') {
  fail('release acceptanceEvidence identity or canonical paths are invalid');
}
for (const field of ['browserReceiptSha256', 'performanceReceiptSha256']) {
  if (!/^[0-9a-f]{64}$/.test(release.acceptanceEvidence[field])) fail(`release acceptanceEvidence.${field} is invalid`);
}
const acceptance = validateCompleteAcceptanceReceipt({
  receiptPath: testedPath,
  expectedSha: release.testedSha,
  expectedTree: release.sourceTree,
  browserPath: resolve(root, release.acceptanceEvidence.browserReceipt),
  performancePath: resolve(root, release.acceptanceEvidence.performanceReceipt),
  builtAtUtc: release.builtAtUtc,
});
const tested = acceptance.receipt;
if (acceptance.receiptSha256 !== release.testedReceiptSha256
    || acceptance.browserSha256 !== release.acceptanceEvidence.browserReceiptSha256
    || acceptance.performanceSha256 !== release.acceptanceEvidence.performanceReceiptSha256) {
  fail('release acceptanceEvidence hashes do not match the validated local-acceptance bytes');
}
await validateCanonicalAcceptanceEvidence({
  receipt: tested,
  receiptPath: testedPath,
  browserPath: acceptance.browserPath,
  performancePath: acceptance.performancePath,
  artifactRoot: root,
  expectedSha: release.testedSha,
  expectedTree: release.sourceTree,
});

if (release.sourceVerification === 'SIMULATION_ONLY') {
  if (JSON.stringify(release.buildAttestation) !== JSON.stringify({ status: 'SIMULATION_ONLY_NOT_ATTESTED' })) {
    fail('simulation release must remain explicitly unattested');
  }
} else {
  const attestationKeys = [
    'status', 'algorithm', 'builderIdentity', 'attestation', 'attestationSha256',
    'signature', 'signatureSha256', 'publicKey', 'publicKeySha256',
  ];
  requireExactKeys(release.buildAttestation, [
    ...attestationKeys,
  ], 'release buildAttestation');
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
    testsCompletedAtUtc: tested.endedAtUtc,
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

requireExactKeys(manifest, [
  'schemaVersion', 'releaseId', 'testedSha', 'testedBuildOutputs',
  'acceptanceEvidence', 'l15OpsProvenance', 'ledgerCompatibility', 'buildAttestation', 'files',
], 'artifact manifest');
requireExactKeys(manifest.testedBuildOutputs, ['serverDistDigestSha256', 'webDistDigestSha256'], 'artifact manifest.testedBuildOutputs');
requireExactKeys(manifest.ledgerCompatibility, [
  'schemaVersion', 'rollbackFloor', 'rollbackBarrier',
  'compatibilitySource', 'compatibilitySourceSha256',
], 'artifact manifest.ledgerCompatibility');
if (manifest.schemaVersion !== 1) fail('artifact manifest schemaVersion must be 1');
if (manifest.releaseId !== release.releaseId || manifest.testedSha !== release.testedSha) fail('artifact manifest identity mismatch');
if (JSON.stringify(manifest.acceptanceEvidence) !== JSON.stringify(release.acceptanceEvidence)) {
  fail('artifact manifest acceptance evidence does not match release provenance');
}
if (JSON.stringify(manifest.l15OpsProvenance) !== JSON.stringify(release.l15OpsProvenance)) {
  fail('artifact manifest effective L15 provenance does not match release provenance');
}
for (const key of Object.keys(compiledCompatibility)) {
  if (manifest.ledgerCompatibility[key] !== compiledCompatibility[key]) {
    fail(`artifact manifest Ledger compatibility ${key} mismatch`);
  }
}
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
if (sha256File(manifestPath) !== artifactManifestSha256) {
  fail('artifact manifest changed during validation');
}

process.stdout.write(`${JSON.stringify({
  status: 'RELEASE_VALID_NOT_DEPLOYED',
  releaseId: release.releaseId,
  testedSha: release.testedSha,
  artifactManifestSha256,
  fileCount: actualFiles.length,
})}\n`);
