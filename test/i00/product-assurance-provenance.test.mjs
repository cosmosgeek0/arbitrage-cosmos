import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  listProductAssuranceTrackedTestFiles,
  validateProductAssuranceManifest,
  verifyProductAssuranceDonor,
  verifyProductAssuranceDonors,
  verifyProductAssuranceOperationReport,
  verifyProductAssuranceSuiteInventory,
} from './git-provenance.mjs';
import { runGitEvidence } from './verify-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/i00/product-assurance-manifest.v1.json');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const clone = (value) => structuredClone(value);
const S4_TEST_ROOT = 'test/productAssurance/systemic/assuranceCase';
const S4_COMPLETE_TRACKED_FILES = Object.freeze([
  `${S4_TEST_ROOT}/artifacts.test.mjs`,
  `${S4_TEST_ROOT}/basis-certified-separation-redteam.test.mjs`,
  `${S4_TEST_ROOT}/bounds.test.mjs`,
  `${S4_TEST_ROOT}/closure-redteam.test.mjs`,
  `${S4_TEST_ROOT}/contract-boundary-redteam.test.mjs`,
  `${S4_TEST_ROOT}/contracts.test.mjs`,
  `${S4_TEST_ROOT}/diagnostic-posture.test.mjs`,
  `${S4_TEST_ROOT}/evaluator.test.mjs`,
  `${S4_TEST_ROOT}/expiry-transitive.test.mjs`,
  `${S4_TEST_ROOT}/expiry-unknown-origin-redteam.test.mjs`,
  `${S4_TEST_ROOT}/false-green.test.mjs`,
  `${S4_TEST_ROOT}/final-law-closure.test.mjs`,
  `${S4_TEST_ROOT}/hostile-input.test.mjs`,
  `${S4_TEST_ROOT}/independence.test.mjs`,
  `${S4_TEST_ROOT}/purity-scope.test.mjs`,
  `${S4_TEST_ROOT}/reason-diagnostic-bridge-redteam.test.mjs`,
  `${S4_TEST_ROOT}/s1-provenance.test.mjs`,
  `${S4_TEST_ROOT}/truncation-path-law-regression.test.mjs`,
  `${S4_TEST_ROOT}/view-boundary-redteam.test.mjs`,
  `${S4_TEST_ROOT}/view-model.test.mjs`,
]);
const S4_NON_CONTEXT_TRACKED_FILES = Object.freeze([
  `${S4_TEST_ROOT}/artifacts.test.mjs`,
  `${S4_TEST_ROOT}/basis-certified-separation-redteam.test.mjs`,
  `${S4_TEST_ROOT}/bounds.test.mjs`,
  `${S4_TEST_ROOT}/closure-redteam.test.mjs`,
  `${S4_TEST_ROOT}/contract-boundary-redteam.test.mjs`,
  `${S4_TEST_ROOT}/contracts.test.mjs`,
  `${S4_TEST_ROOT}/diagnostic-posture.test.mjs`,
  `${S4_TEST_ROOT}/evaluator.test.mjs`,
  `${S4_TEST_ROOT}/expiry-transitive.test.mjs`,
  `${S4_TEST_ROOT}/expiry-unknown-origin-redteam.test.mjs`,
  `${S4_TEST_ROOT}/false-green.test.mjs`,
  `${S4_TEST_ROOT}/final-law-closure.test.mjs`,
  `${S4_TEST_ROOT}/hostile-input.test.mjs`,
  `${S4_TEST_ROOT}/independence.test.mjs`,
  `${S4_TEST_ROOT}/reason-diagnostic-bridge-redteam.test.mjs`,
  `${S4_TEST_ROOT}/s1-provenance.test.mjs`,
  `${S4_TEST_ROOT}/truncation-path-law-regression.test.mjs`,
  `${S4_TEST_ROOT}/view-boundary-redteam.test.mjs`,
  `${S4_TEST_ROOT}/view-model.test.mjs`,
]);

function git(cwd, ...args) {
  return runGitEvidence({ cwd, args }).stdout.trim();
}

function assertTrackedInventoryMatchesCleanClone() {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'product-assurance-s4-clean-clone-'));
  const source = path.join(temporaryRoot, 'dirty-source');
  const cleanClone = path.join(temporaryRoot, 'clean-clone');
  const ignoredDecoy = `${S4_TEST_ROOT}/ignored-decoy.test.mjs`;
  const untrackedDecoy = `${S4_TEST_ROOT}/untracked-decoy.test.mjs`;
  try {
    mkdirSync(source, { recursive: true });
    git(source, 'init', '--initial-branch=main');
    writeFileSync(path.join(source, '.gitignore'), `${ignoredDecoy}\n`, 'utf8');
    for (const relativePath of S4_COMPLETE_TRACKED_FILES) {
      const absolutePath = path.join(source, relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, `// tracked clean-clone fixture: ${relativePath}\n`, 'utf8');
    }
    git(source, 'add', '--', '.gitignore', ...S4_COMPLETE_TRACKED_FILES);
    git(
      source,
      '-c', 'user.name=Product Assurance Fixture',
      '-c', 'user.email=product-assurance-fixture.invalid@example.invalid',
      'commit', '--no-gpg-sign', '-m', 'fixture: tracked S4 inventory',
    );
    writeFileSync(path.join(source, ignoredDecoy), '// ignored decoy\n', 'utf8');
    writeFileSync(path.join(source, untrackedDecoy), '// untracked decoy\n', 'utf8');

    const dirtyStatus = git(source, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored');
    assert(dirtyStatus.includes(`?? ${untrackedDecoy}`), dirtyStatus);
    assert(dirtyStatus.includes(`!! ${ignoredDecoy}`), dirtyStatus);
    runGitEvidence({
      cwd: temporaryRoot,
      args: ['clone', '--no-hardlinks', '--quiet', source, cleanClone],
    });
    assert.equal(git(cleanClone, 'status', '--porcelain=v1', '--untracked-files=all'), '');
    assert.deepEqual(
      listProductAssuranceTrackedTestFiles(S4_TEST_ROOT, source),
      S4_COMPLETE_TRACKED_FILES,
    );
    assert.deepEqual(
      listProductAssuranceTrackedTestFiles(S4_TEST_ROOT, cleanClone),
      S4_COMPLETE_TRACKED_FILES,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

test('Product Assurance manifest closes 801 donor callbacks plus one live replacement as effective 802 behavior', () => {
  const validation = validateProductAssuranceManifest(manifest);
  const inventory = verifyProductAssuranceSuiteInventory(manifest);
  assert.equal(validation.passed, true, JSON.stringify(validation));
  assert.equal(inventory.passed, true, JSON.stringify(inventory.suites.filter((entry) => !entry.passed)));
  assert.equal(validation.donorBehaviorTotal, 801);
  assert.equal(validation.integrationReplacementBehavior, 1);
  assert.equal(validation.effectiveBehaviorTotal, 802);
  assert.equal(validation.skippedCallbacks, 6);
  assert.equal(validation.gitObjectContextProofs, 6);
  assert.equal(validation.liveContextReplacements, 1);
  assert.equal(validation.contextReplacementRows, 7);
  assert.equal(validation.postIntegrationReplacementRows, 7);

  const core = manifest.suites.find((suite) => suite.id === 'A_CORE_BEHAVIOR');
  assert.equal(core.expectedPasses, 31);
  assert.deepEqual(core.excludedContextTests, [{
    file: 'server/test/productAssurance/core-policy-inventory.test.mjs',
    exactName: 'operation policies and reviewed news read cover all 143 production sites',
    replacementKind: 'LIVE_OPERATION_POLICY',
    replacementProofId: 'A_CORE_LIVE_OPERATION_POLICY_ASSEMBLED_SCAN',
  }]);

  const s4 = manifest.suites.find((suite) => suite.id === 'A_CASE_S4_BEHAVIOR');
  const s4Inventory = inventory.suites.find((suite) => suite.id === 'A_CASE_S4_BEHAVIOR');
  const s4NonContextRun = s4.runs.find((run) => run.id === 'A_CASE_S4_NINETEEN_NON_CONTEXT_FILES');
  assert.deepEqual(s4.completeTestInventory, S4_COMPLETE_TRACKED_FILES);
  assert.deepEqual(s4Inventory.actualFiles, S4_COMPLETE_TRACKED_FILES);
  assert.deepEqual(s4NonContextRun.files, S4_NON_CONTEXT_TRACKED_FILES);
  assertTrackedInventoryMatchesCleanClone();
  assert.equal(s4.expectedPasses, 231);

  const agent = manifest.suites.find((suite) => suite.id === 'A_AGENT_BEHAVIOR');
  const agentReceiptProofs = agent.excludedContextTests.filter((entry) => (
    entry.file === 'test/productAssurance/systemic/agentBoundary/receipt-state.test.mjs'
      && entry.exactName === 'D-LAUNCH-13 receipt and state seal the exact verified implementation'
  ));
  assert.equal(agentReceiptProofs.length, 2);
  assert.deepEqual(agentReceiptProofs.map((entry) => entry.replacementProofId).sort(), [
    'A_AGENT_RECEIPT_BRANCH_GIT_OBJECT_PROVENANCE',
    'A_AGENT_RECEIPT_STATE_GIT_OBJECT_PROVENANCE',
  ]);
  assert.equal(manifest.contextProofPolicy,
    'SIX_GIT_OBJECT_PROOFS_REPLACE_FIVE_DONOR_CONTEXT_CALLBACKS_ONE_LIVE_OPERATION_POLICY_REPLACES_THE_A_CORE_DENOMINATOR_CALLBACK');
});

test('all six accepted assurance donors are exact Git-object ancestors with immutable receipts and blobs', () => {
  const result = verifyProductAssuranceDonors(manifest);
  assert.equal(result.passed, true, JSON.stringify(result.donors.filter((entry) => !entry.passed)));
  assert.equal(result.mergeCutBlobCount, 193);
  assert.equal(result.donorIdenticalHeadBlobCount, 186);
  assert.equal(result.postIntegrationReplacementCount, 7);
  assert(result.postIntegrationReplacements.every((entry) => entry.passed));
  assert.deepEqual(result.donors.map((entry) => [entry.id, entry.pathCount, entry.blobMismatches.length]), [
    ['A_CORE', 36, 0],
    ['A_HAZARD', 24, 0],
    ['A_COCKPIT', 53, 0],
    ['A_AGENT', 20, 0],
    ['A_STABILITY', 19, 0],
    ['A_CASE_S4', 41, 0],
  ]);
  assert(result.donors.every((entry) => entry.donorReceiptPassed && entry.integrationReceiptPassed));
});

test('donor provenance fails closed on object ancestry path blob and receipt substitutions', () => {
  const canonical = manifest.donors[0];
  assert.equal(verifyProductAssuranceDonor(canonical).passed, true);
  const mutations = [
    (entry) => { entry.deltaBase = '0'.repeat(40); },
    (entry) => { entry.acceptedTip = '0'.repeat(40); entry.mergeParents[1] = entry.acceptedTip; },
    (entry) => { entry.donorTree = '0'.repeat(40); },
    (entry) => { entry.deltaPathCount += 1; },
    (entry) => { entry.deltaPathSetSha256 = '0'.repeat(64); },
    (entry) => { entry.mergeCommit = '0'.repeat(40); },
    (entry) => { entry.mergeTree = '0'.repeat(40); },
    (entry) => { entry.mergeParents.reverse(); },
    (entry) => { entry.donorReceipt.path = '../escape.md'; },
    (entry) => { entry.donorReceipt.gitBlob = '0'.repeat(40); },
    (entry) => { entry.donorReceipt.sha256 = '0'.repeat(64); },
    (entry) => { entry.donorReceipt.terminalNeedle = 'FORGED_READY'; },
    (entry) => { entry.integrationReceipt.commit = '0'.repeat(40); },
    (entry) => { entry.integrationReceipt.path = '../escape.md'; },
    (entry) => { entry.integrationReceipt.gitBlob = '0'.repeat(40); },
    (entry) => { entry.integrationReceipt.sha256 = '0'.repeat(64); },
    (entry) => { entry.integrationReceipt.statusNeedle = 'FORGED_INTEGRATED'; },
    (entry) => { entry.requiredAncestry.push({ ancestor: entry.acceptedTip, descendant: entry.deltaBase }); },
    (entry) => { entry.requiredObjects.push('0'.repeat(40)); },
    (entry) => { entry.postIntegrationReplacements = []; },
    (entry) => { entry.postIntegrationReplacements[0].path = entry.donorReceipt.path; },
    (entry) => { entry.postIntegrationReplacements[0].donorBlob = '0'.repeat(40); },
    (entry) => { entry.postIntegrationReplacements[0].replacementCommit = '0'.repeat(40); },
    (entry) => { entry.postIntegrationReplacements[0].replacementBlob = entry.postIntegrationReplacements[0].donorBlob; },
    (entry) => { entry.postIntegrationReplacements.push(structuredClone(entry.postIntegrationReplacements[0])); },
  ];
  for (const mutate of mutations) {
    const hostile = clone(canonical);
    mutate(hostile);
    assert.equal(verifyProductAssuranceDonor(hostile).passed, false);
  }
});

test('manifest selection and operation coverage mutations fail closed without executing donor-context callbacks', () => {
  const manifestMutations = [
    (document) => { document.expectedBehaviorPasses = 803; },
    (document) => { document.donors.pop(); },
    (document) => { document.suites[1].id = document.suites[0].id; },
    (document) => { document.suites[0].completeTestInventory.push('server/test/productAssurance/zz-forged.test.mjs'); },
    (document) => { delete document.suites[0].runs[0].files; },
    (document) => { document.suites[4].runs[1].exactNames.push(document.suites[4].excludedContextTests[2].exactName); },
    (document) => { document.suites[4].excludedContextTests[0].replacementProofId = ''; },
    (document) => { document.suites[5].expectedPasses += 1; },
    (document) => { document.expectedSkippedCallbacks = 7; },
    (document) => { document.expectedPostIntegrationReplacementRows = 5; },
    (document) => { document.donors[0].postIntegrationReplacements.pop(); },
    (document) => { document.donors[1].postIntegrationReplacements.push(structuredClone(document.donors[0].postIntegrationReplacements[0])); },
    (document) => { document.donors[0].postIntegrationReplacements[0].replacementBlob = '0'.repeat(40); },
    (document) => { document.donors[0].postIntegrationReplacements[0].unknown = true; },
    (document) => { document.contextProofPolicy = 'SIX_SKIPPED_CALLBACKS'; },
  ];
  for (const mutate of manifestMutations) {
    const hostile = clone(manifest);
    mutate(hostile);
    assert.equal(validateProductAssuranceManifest(hostile).passed, false);
  }

  const report = Object.freeze({
    schemaVersion: manifest.operationScan.schemaVersion,
    scannedRoot: 'server/src',
    filesScanned: manifest.operationScan.filesScanned,
    discovered: manifest.operationScan.discovered,
    covered: manifest.operationScan.covered,
    uncovered: manifest.operationScan.uncovered,
    sites: Object.freeze(Array.from({ length: manifest.operationScan.discovered }, (_, index) => Object.freeze({
      siteId: `HOSTILE_PROOF_SITE_${index}`,
      operationId: 'REGISTERED_FOR_VERIFIER_FIXTURE',
    }))),
    uncoveredSites: Object.freeze([]),
  });
  assert.equal(verifyProductAssuranceOperationReport(manifest, report).passed, true);
  for (const hostile of [
    { ...report, schemaVersion: 'production-operation-scan.v2' },
    { ...report, filesScanned: report.filesScanned + 1 },
    { ...report, discovered: report.discovered + 1 },
    { ...report, covered: report.covered - 1, uncovered: 1 },
    { ...report, uncoveredSites: [{ operationId: null }] },
    { ...report, sites: report.sites.slice(1) },
  ]) assert.equal(verifyProductAssuranceOperationReport(manifest, hostile).passed, false);
});
