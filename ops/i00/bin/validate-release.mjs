#!/usr/bin/env node
import {
  existsSync, lstatSync, readFileSync, readdirSync, realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_KEYS, fail, isFullSha, isUtc, listRegularFiles, parseArgs, readJson, requireExactKeys,
  sha256File, treeDigest, typedTreeDigest, verifyArtifactManifest,
} from '../lib.mjs';
import {
  COMPLETE_ACCEPTANCE_STEP_COUNT, COMPLETE_ACCEPTANCE_TRUTH,
  validateCompleteAcceptanceReceipt,
} from '../complete-acceptance-receipt.mjs';
import { validateCanonicalAcceptanceEvidence } from '../canonical-acceptance-validation.mjs';
import {
  classifyValidatorCohort,
  EXACT_TRUSTED_COHORT,
  provePinnedLegacyValidatorCohort,
  selectExpectedL15AmendmentContractSha256,
} from '../cohort-compatibility.mjs';
import { assertReleaseMatchesCompiledLedger } from '../ledger-compatibility.mjs';
import { loadL15AmendmentContract, verifyEffectiveL15Root } from '../l15-amendment.mjs';
import {
  expectedBuildAttestation, verifyBuildAttestation,
} from './verify-build-attestation.mjs';

const EXPECTED_AMENDMENT_CONTRACT_SHA256 = 'ce365e0f739d1144fd90ae0ce93572a500e9e0b4a9b8be129dd52dd72461d2bc';
const args = parseArgs(
  process.argv.slice(2),
  new Set(['allow-simulation', 'require-exact-cohort', 'installed-immutable']),
);
if (!args.release) fail('--release is required');

function directoryIdentity(stat) {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(8),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function exactReleaseRoot(raw) {
  if (typeof raw !== 'string' || raw === '/' || !isAbsolute(raw)
      || resolve(raw) !== raw || /[\u0000-\u001f\u007f]/u.test(raw)) {
    fail('--release must be one absolute lexical canonical path');
  }
  let stat;
  try {
    stat = lstatSync(raw, { bigint: true });
  } catch (error) {
    fail(`--release is unavailable: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail('--release must identify one non-symlink unpacked release directory');
  }
  let physical;
  try {
    physical = realpathSync.native(raw);
  } catch (error) {
    fail(`--release cannot be physically canonicalized: ${error.message}`);
  }
  if (physical !== raw) {
    fail('--release path or one of its ancestors is not physically canonical');
  }
  return { path: raw, identity: directoryIdentity(stat) };
}

const rootBefore = exactReleaseRoot(args.release);
const root = rootBefore.path;

function requireInstalledImmutableTree(path, relative = '') {
  const absolute = resolve(path, relative);
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink()
      || (!stat.isFile() && !stat.isDirectory())) {
    fail(`installed immutable release contains an unsafe entry: ${relative || '.'}`);
  }
  if ((stat.mode & 0o222) !== 0) {
    fail(`installed immutable release contains a writable entry: ${relative || '.'}`);
  }
  if (stat.isDirectory()) {
    for (const name of readdirSync(absolute).sort()) {
      requireInstalledImmutableTree(path, relative ? `${relative}/${name}` : name);
    }
  }
}

if (args['installed-immutable'] === true) {
  const rootStat = lstatSync(root, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()
      || realpathSync(root) !== root) {
    fail('installed immutable release root must be one canonical real directory');
  }
  requireInstalledImmutableTree(root);
}
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
requireExactKeys(release, RELEASE_KEYS, 'release.json');
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
const validatorCohortFacts = {
  trustedI00EnforcementTreeDigestSha256,
  releaseI00EnforcementTreeDigestSha256,
  testedSha: release.testedSha,
  sourceTree: release.sourceTree,
  artifactManifestSha256,
  testedReceiptSha256: release.testedReceiptSha256,
  browserReceiptSha256: release.acceptanceEvidence?.browserReceiptSha256,
  performanceReceiptSha256: release.acceptanceEvidence?.performanceReceiptSha256,
  attestationSha256: release.buildAttestation?.attestationSha256,
  signatureSha256: release.buildAttestation?.signatureSha256,
  publicKeySha256: release.buildAttestation?.publicKeySha256,
};
const validatorCohortMode = classifyValidatorCohort(validatorCohortFacts);
if (validatorCohortMode === null) {
  fail('release ops/i00 enforcement cohort differs from the trusted validator cohort');
}
if (args['require-exact-cohort'] === true && validatorCohortMode !== EXACT_TRUSTED_COHORT) {
  fail('validation-only legacy cohort compatibility cannot authorize a release effect');
}
const expectedL15AmendmentContractSha256 = selectExpectedL15AmendmentContractSha256(
  validatorCohortMode,
  EXPECTED_AMENDMENT_CONTRACT_SHA256,
);
if (expectedL15AmendmentContractSha256 === null) {
  fail('validator cohort has no exact L15 amendment-contract binding');
}
const pinnedLegacyValidatorCohortProof = provePinnedLegacyValidatorCohort(
  validatorCohortFacts,
);
const loadedL15Contract = loadL15AmendmentContract(
  resolve(root, 'ops/i00/l15-amendment-contract.json'),
  expectedL15AmendmentContractSha256,
  { pinnedLegacyValidatorCohortProof },
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
  const trustedPublicKeyPath = args['trusted-build-public-key'];
  if (typeof trustedPublicKeyPath !== 'string' || trustedPublicKeyPath.length === 0) {
    fail('production validation requires explicit --trusted-build-public-key');
  }
  if (trustedPublicKeyPath === root || trustedPublicKeyPath.startsWith(`${root}/`)) {
    fail('--trusted-build-public-key must be external to the release tree');
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
    trustedPublicKeyPath,
    expected,
  });
  for (const field of [
    'attestationSha256', 'signatureSha256', 'publicKeySha256', 'builderIdentity',
  ]) {
    if (verified[field] !== release.buildAttestation[field]) fail(`build attestation ${field} mismatch`);
  }
}

// The artifact-manifest core (exact keys, identity, provenance equality,
// path-set equality, per-file sha256+mode, tree digests, TOCTOU re-read) is
// shared with preflight.mjs via lib.mjs so the two gates can never drift.
const verifiedArtifacts = verifyArtifactManifest(root, release, {
  installedImmutable: args['installed-immutable'] === true,
});
const verifiedFileCount = verifiedArtifacts.fileCount;
for (const key of Object.keys(compiledCompatibility)) {
  if (manifest.ledgerCompatibility[key] !== compiledCompatibility[key]) {
    fail(`artifact manifest Ledger compatibility ${key} mismatch`);
  }
}
if (verifiedArtifacts.artifactManifestSha256 !== artifactManifestSha256) {
  fail('artifact manifest changed during validation');
}
const rootAfter = exactReleaseRoot(args.release);
if (JSON.stringify(rootAfter) !== JSON.stringify(rootBefore)) {
  fail('--release root identity changed during validation');
}

process.stdout.write(`${JSON.stringify({
  status: 'RELEASE_VALID_NOT_DEPLOYED',
  releaseId: release.releaseId,
  testedSha: release.testedSha,
  artifactManifestSha256,
  validatorCohortMode,
  fileCount: verifiedFileCount,
})}\n`);
