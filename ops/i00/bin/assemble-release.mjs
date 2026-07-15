#!/usr/bin/env node
import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fail, isFullSha, isUtc, listRegularFiles, parseArgs, readJson,
  sha256File, treeDigest, typedTreeDigest,
} from '../lib.mjs';
import {
  COMPLETE_ACCEPTANCE_STEP_COUNT, validateCompleteAcceptanceReceipt, validateGitSourceFreeze,
} from '../complete-acceptance-receipt.mjs';
import { validateCanonicalAcceptanceEvidence } from '../canonical-acceptance-validation.mjs';
import { readCompiledLedgerCompatibility } from '../ledger-compatibility.mjs';
import { loadL15AmendmentContract, verifyEffectiveL15Root } from '../l15-amendment.mjs';
import { expectedBuildAttestation, verifyBuildAttestation } from './verify-build-attestation.mjs';
import { loadProtectedOwnerDirectiveBundle } from '../../../test/i00/performance/contract.mjs';

const EXPECTED_AMENDMENT_CONTRACT_SHA256 = 'f328449699008dc76e0839adb38a756bc9ab11449e64dab7f4a45a319c167101';
const args = parseArgs(process.argv.slice(2), new Set(['rollback-barrier', 'simulation-source']));
if (args['schema-version'] !== undefined || args['rollback-floor'] !== undefined || args['rollback-barrier'] === true) {
  fail('release compatibility is derived from the tested compiled Ledger; caller overrides are forbidden');
}
for (const key of ['source-root', 'runtime-deps', 'output-root', 'tested-sha', 'tested-receipt', 'built-at-utc', 'config-revision', 'model-revision']) {
  if (!args[key]) fail(`--${key} is required`);
}
if (!isFullSha(args['tested-sha'])) fail('--tested-sha must be a full lowercase Git SHA');
if (!isUtc(args['built-at-utc'])) fail('--built-at-utc must be exact UTC seconds (YYYY-MM-DDTHH:MM:SSZ)');

const source = resolve(args['source-root']);
const runtimeDeps = resolve(args['runtime-deps']);
const outputRoot = resolve(args['output-root']);
const testedReceiptPath = resolve(args['tested-receipt']);
const testedReceipt = readJson(testedReceiptPath, 'tested receipt');

const required = [
  'server/dist/index.js',
  'server/dist/ledger.js',
  'web/dist/index.html',
  'server/package.json',
  'package.json',
  'package-lock.json',
  'ops/live/RECEIPT.md',
  'ops/live/bin/deploy.sh',
  'ops/live/bin/rollback.sh',
  'ops/i00/donor-contract.json',
  'ops/i00/l15-amendment-contract.json',
  'ops/i00/l15-amendment.mjs',
  'ops/i00/lib.mjs',
  'ops/i00/bin/install-ops-bundle.sh',
  'ops/i00/bin/verify-donor.mjs',
  'ops/i00/bin/verify-donor-root.mjs',
  'test/i00/donor-equality.mjs',
  'test/i00/verify-scope.mjs',
  'test/i00/scope-security.mjs',
  'test/i00/performance/contract.mjs',
  'test/i00/performance/local-acceptance.mjs',
  'test/i00/performance/local-proxy-soak.mjs',
  'test/i00/performance/app-probe.mjs',
  'test/i00/performance/schema.v1.json',
  'test/i00/performance/protected-owner-directives.bundle.v1.json',
  'test/i00/performance/browser-receipt.schema.v2.json',
  'test/i00/performance/browser-measurement.schema.v1.json',
  'test/i00/performance/browser-capture.schema.v3.json',
  'test/i00/performance/browser-restart-measurement.schema.v1.json',
];
for (const relative of required) {
  if (!existsSync(resolve(source, relative))) fail(`release input missing ${relative}`);
}
loadProtectedOwnerDirectiveBundle(source);
for (const forbidden of ['accepted-ops-live', 'install-receipt.json']) {
  if (existsSync(resolve(source, 'ops/i00', forbidden))) {
    fail(`source ops/i00 contains reserved installed-bundle path ${forbidden}`);
  }
}
const trustedI00Root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trustedI00EnforcementTreeDigestSha256 = typedTreeDigest(trustedI00Root, {
  excludeTopLevel: ['accepted-ops-live', 'install-receipt.json'],
});
const sourceI00EnforcementTreeDigestSha256 = typedTreeDigest(resolve(source, 'ops/i00'));
if (sourceI00EnforcementTreeDigestSha256 !== trustedI00EnforcementTreeDigestSha256) {
  fail('source ops/i00 enforcement cohort differs from the trusted assembler cohort');
}
const sourceL15Contract = loadL15AmendmentContract(
  resolve(source, 'ops/i00/l15-amendment-contract.json'),
  EXPECTED_AMENDMENT_CONTRACT_SHA256,
);
const sourceL15Verification = verifyEffectiveL15Root({
  root: resolve(source, 'ops/live'),
  loadedContract: sourceL15Contract,
});
const l15OpsProvenance = Object.freeze({
  immutableDonorCommit: sourceL15Verification.immutableDonorCommit,
  immutableDonorLiveTree: sourceL15Verification.immutableDonorLiveTree,
  immutableDonorContractSha256: sourceL15Verification.immutableDonorContractSha256,
  amendmentContractSha256: sourceL15Verification.amendmentContractSha256,
  effectiveLiveTree: sourceL15Verification.effectiveLiveTree,
  effectiveRootDigestSha256: sourceL15Verification.effectiveRootDigestSha256,
  i00EnforcementTreeDigestSha256: sourceI00EnforcementTreeDigestSha256,
  findingIds: sourceL15Verification.findingIds,
});
let releaseCompatibility;
try {
  releaseCompatibility = readCompiledLedgerCompatibility(source);
} catch (error) {
  fail(`compiled Ledger compatibility is invalid: ${error.message}`);
}
if (!existsSync(runtimeDeps) || listRegularFiles(runtimeDeps).length === 0) {
  fail('--runtime-deps must be a non-empty, prebuilt dependency directory');
}
const packageLockSha256 = sha256File(resolve(source, 'package-lock.json'));
const runtimeDepsDigestSha256 = treeDigest(runtimeDeps);
const serverDistDigestSha256 = treeDigest(resolve(source, 'server/dist'));
const webDistDigestSha256 = treeDigest(resolve(source, 'web/dist'));

let sourceTree;
let sourceVerification;
if (args['simulation-source'] === true) {
  sourceTree = testedReceipt?.source?.treeSha;
  if (!isFullSha(sourceTree)) fail('complete local-acceptance receipt must identify a full candidate tree SHA');
  sourceVerification = 'SIMULATION_ONLY';
} else {
  try {
    const head = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    sourceTree = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    if (head !== args['tested-sha']) fail('source worktree is not the exact tested SHA/tree');
  } catch (error) {
    fail(`source Git binding failed: ${error.message}`);
  }
  sourceVerification = 'GIT_EXACT_CLEAN';
}

const acceptance = validateCompleteAcceptanceReceipt({
  receiptPath: testedReceiptPath,
  expectedSha: args['tested-sha'],
  expectedTree: sourceTree,
  evidenceRoot: source,
  verifyReferencedArtifacts: true,
  builtAtUtc: args['built-at-utc'],
});
const testedReceiptSha256 = acceptance.receiptSha256;
await validateCanonicalAcceptanceEvidence({
  receipt: acceptance.receipt,
  receiptPath: acceptance.receiptPath,
  browserPath: acceptance.browserPath,
  performancePath: acceptance.performancePath,
  artifactRoot: source,
  expectedSha: args['tested-sha'],
  expectedTree: sourceTree,
});
if (sourceVerification === 'GIT_EXACT_CLEAN') {
  validateGitSourceFreeze({ sourceRoot: source, revision: args['tested-sha'], receipt: acceptance.receipt });
  const allowedUntracked = new Set([
    acceptance.receipt.browserReceipt.relativePath,
    acceptance.receipt.performanceReceipt.relativePath,
    ...acceptance.receipt.browserReceipt.artifacts.map((artifact) => artifact.relativePath),
    ...acceptance.receipt.source.protectedOwnerDirectives.map((entry) => entry.path),
  ]);
  const receiptRelative = relative(source, testedReceiptPath);
  if (receiptRelative !== '..' && !receiptRelative.startsWith(`..${sep}`)) allowedUntracked.add(receiptRelative.split(sep).join('/'));
  let statusRecords;
  try {
    statusRecords = execFileSync('git', ['-C', source, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    fail(`source Git status binding failed: ${error.message}`);
  }
  for (const record of statusRecords) {
    const status = record.slice(0, 2);
    const relativePath = record.slice(3);
    if (status !== '??' || !allowedUntracked.has(relativePath)) {
      fail(`source worktree contains unbound state: ${status}:${relativePath}`);
    }
  }
  for (const directive of acceptance.receipt.source.protectedOwnerDirectives) {
    const absolute = resolve(source, directive.path);
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile()
        || sha256File(absolute) !== directive.sha256) {
      fail(`source protected owner directive is missing or hash-mismatched: ${directive.path}`);
    }
  }
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
    testsCompletedAtUtc: acceptance.receipt.endedAtUtc,
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
  const stagedL15Contract = loadL15AmendmentContract(
    resolve(staging, 'ops/i00/l15-amendment-contract.json'),
    EXPECTED_AMENDMENT_CONTRACT_SHA256,
  );
  const stagedL15Verification = verifyEffectiveL15Root({
    root: resolve(staging, 'ops/live'),
    loadedContract: stagedL15Contract,
  });
  const stagedI00EnforcementTreeDigestSha256 = typedTreeDigest(resolve(staging, 'ops/i00'));
  if (JSON.stringify(stagedL15Verification.findingIds) !== JSON.stringify(l15OpsProvenance.findingIds)
      || stagedL15Verification.effectiveLiveTree !== l15OpsProvenance.effectiveLiveTree
      || stagedL15Verification.effectiveRootDigestSha256 !== l15OpsProvenance.effectiveRootDigestSha256
      || stagedI00EnforcementTreeDigestSha256 !== l15OpsProvenance.i00EnforcementTreeDigestSha256) {
    throw new Error('copied effective L15 or I00 enforcement root does not match source provenance');
  }
  mkdirSync(resolve(staging, 'test/i00/performance'), { recursive: true });
  for (const relative of ['donor-equality.mjs', 'verify-scope.mjs', 'scope-security.mjs']) {
    cpSync(resolve(source, 'test/i00', relative), resolve(staging, 'test/i00', relative));
  }
  for (const relative of [
    'contract.mjs', 'local-acceptance.mjs', 'local-proxy-soak.mjs', 'app-probe.mjs',
    'schema.v1.json', 'protected-owner-directives.bundle.v1.json', 'browser-receipt.schema.v2.json', 'browser-measurement.schema.v1.json',
    'browser-capture.schema.v3.json', 'browser-restart-measurement.schema.v1.json',
  ]) cpSync(resolve(source, 'test/i00/performance', relative), resolve(staging, 'test/i00/performance', relative));
  loadProtectedOwnerDirectiveBundle(staging);
  for (const artifact of acceptance.receipt.browserReceipt.artifacts) {
    const destinationPath = resolve(staging, artifact.relativePath);
    mkdirSync(resolve(destinationPath, '..'), { recursive: true });
    cpSync(resolve(source, artifact.relativePath), destinationPath);
  }
  cpSync(runtimeDeps, resolve(staging, 'node_modules'), { recursive: true, errorOnExist: true });
  if (treeDigest(resolve(staging, 'server/dist')) !== serverDistDigestSha256
      || treeDigest(resolve(staging, 'web/dist')) !== webDistDigestSha256) {
    throw new Error('copied build-output trees do not match the tested receipt');
  }
  mkdirSync(resolve(staging, 'receipts'), { recursive: true });
  cpSync(testedReceiptPath, resolve(staging, 'receipts/complete-local-acceptance.json'));
  cpSync(acceptance.browserPath, resolve(staging, 'receipts/local-browser-acceptance.json'));
  cpSync(acceptance.performancePath, resolve(staging, 'receipts/local-proxy-performance.json'));
  if (sourceVerification === 'GIT_EXACT_CLEAN') {
    cpSync(resolve(args['build-attestation']), resolve(staging, buildAttestation.attestation));
    cpSync(resolve(args['build-attestation-signature']), resolve(staging, buildAttestation.signature));
    cpSync(resolve(args['build-attestation-public-key']), resolve(staging, buildAttestation.publicKey));
  }

  const release = {
    schemaVersion: releaseCompatibility.schemaVersion,
    rollbackFloor: releaseCompatibility.rollbackFloor,
    rollbackBarrier: releaseCompatibility.rollbackBarrier,
    compatibilitySource: releaseCompatibility.compatibilitySource,
    compatibilitySourceSha256: releaseCompatibility.compatibilitySourceSha256,
    releaseId,
    gitSha: args['tested-sha'],
    testedSha: args['tested-sha'],
    builtAtUtc: args['built-at-utc'],
    configRevision: args['config-revision'],
    modelRevision: args['model-revision'],
    testedReceipt: 'receipts/complete-local-acceptance.json',
    testedReceiptSha256,
    acceptanceEvidence: {
      truthClass: acceptance.receipt.truthClass,
      candidateSha: args['tested-sha'],
      candidateTree: sourceTree,
      requiredStepCount: COMPLETE_ACCEPTANCE_STEP_COUNT,
      browserReceipt: 'receipts/local-browser-acceptance.json',
      browserReceiptSha256: acceptance.browserSha256,
      performanceReceipt: 'receipts/local-proxy-performance.json',
      performanceReceiptSha256: acceptance.performanceSha256,
    },
    runtimeDependencies: 'BUNDLED_PREBUILT',
    runtimeDepsDigestSha256,
    packageLockSha256,
    serverDistDigestSha256,
    webDistDigestSha256,
    sourceTree,
    sourceVerification,
    l15OpsProvenance,
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
    acceptanceEvidence: release.acceptanceEvidence,
    l15OpsProvenance,
    ledgerCompatibility: releaseCompatibility,
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
