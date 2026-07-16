import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RECEIPT_PATH = 'fixtures/obsShadow/receipts/PORT_OBS_RECEIPT.v1.json';
const receipt = JSON.parse(readFileSync(path.join(ROOT, RECEIPT_PATH), 'utf8'));

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
    input: options.input,
  });
}

function gitText(...args) {
  return git(args).trim();
}

function gitBytes(...args) {
  return git(args, { encoding: null });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function lines(value) {
  const normalized = value.trim();
  return normalized === '' ? [] : normalized.split('\n');
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'));
}

function diffPaths(from, to) {
  return lines(gitText('diff', '--name-only', `${from}..${to}`));
}

function shaAt(revision, relativePath) {
  return sha256(gitBytes('show', `${revision}:${relativePath}`));
}

test('port receipt seals exact base, implementation, sole child, and exclusive path sets', () => {
  const head = gitText('rev-parse', 'HEAD');
  assert.equal(gitText('branch', '--show-current'), receipt.branch);
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(gitText('rev-parse', 'HEAD^'), receipt.implementationCommit);
  assert.equal(gitText('rev-parse', `${receipt.implementationCommit}^`), receipt.baseCommit);
  assert.equal(receipt.implementationParentSha, receipt.baseCommit);
  assert.equal(gitText('rev-parse', `${receipt.baseCommit}^{tree}`), receipt.baseTree);
  assert.equal(
    gitText('rev-parse', `${receipt.implementationCommit}^{tree}`),
    receipt.implementationTree,
  );
  assert.equal(lines(gitText('rev-list', '--parents', '-n', '1', 'HEAD')).length, 1);
  assert.equal(gitText('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 2);
  assert.equal(
    receipt.sealCommitIdentity,
    'ENCLOSING_GIT_COMMIT_SHA_IS_AUTHORITATIVE_AND_IS_NOT_SELF_RECORDED',
  );

  assert.deepEqual(
    sorted(diffPaths(receipt.baseCommit, receipt.implementationCommit)),
    sorted(receipt.changedPaths.implementation),
  );
  assert.deepEqual(
    sorted(diffPaths(receipt.implementationCommit, head)),
    sorted(receipt.changedPaths.seal),
  );
  assert.deepEqual(sorted(diffPaths(receipt.baseCommit, head)), sorted(receipt.changedPaths.all));
  assert.equal(new Set(receipt.changedPaths.all).size, receipt.changedPaths.all.length);
  assert.ok(receipt.changedPaths.all.every((relativePath) => (
    relativePath.startsWith('fixtures/obsShadow/')
      || relativePath.startsWith('test/obsShadow/')
  )));
  assert.equal(gitText('status', '--porcelain'), '');
  assert.equal(gitText('diff', '--check', `${receipt.baseCommit}..HEAD`), '');

  assert.equal(receipt.implementationManifest.pathCount, receipt.changedPaths.implementation.length);
  assert.equal(
    sha256(gitBytes(
      'diff-tree', '--no-commit-id', '--name-only', '-r', receipt.implementationCommit,
    )),
    receipt.implementationManifest.pathListSha256,
  );
  assert.equal(
    sha256(gitBytes(
      'ls-tree', '-r', receipt.implementationCommit, 'fixtures/obsShadow', 'test/obsShadow',
    )),
    receipt.implementationManifest.scopedLsTreeSha256,
  );
  const patchId = git(
    ['patch-id', '--stable'],
    { input: gitBytes('show', '--pretty=format:', '--binary', receipt.implementationCommit) },
  ).trim().split(/\s+/)[0];
  assert.equal(patchId, receipt.implementationManifest.stablePatchId);
});

test('launch, resume, sealed donor lineage, and historical receipt stay immutable', () => {
  const launch = receipt.directiveEvidence.launch;
  assert.equal(gitText('rev-parse', `${launch.commit}^{tree}`), launch.tree);
  assert.equal(gitText('rev-parse', `${launch.commit}:${launch.directorStatePath}`), launch.directorStateBlob);
  assert.equal(gitText('rev-parse', `${launch.commit}:${launch.workerPromptsPath}`), launch.workerPromptsBlob);
  assert.match(gitText('show', `${launch.commit}:${launch.workerPromptsPath}`), /PORT OBS PORT worker/);

  const resume = receipt.directiveEvidence.resume;
  assert.equal(gitText('rev-parse', `${resume.commit}^{tree}`), resume.tree);
  assert.equal(gitText('rev-parse', `${resume.commit}:${resume.workerPromptsPath}`), resume.workerPromptsBlob);
  assert.match(gitText('show', `${resume.commit}:${resume.workerPromptsPath}`), /Stop at PORT_OBS_READY/);
  assert.equal(receipt.terminalState, resume.effectiveTerminal);

  const source = receipt.sourceEvidence;
  assert.equal(gitText('rev-parse', `${source.shadowSealCommit}^{tree}`), source.shadowSealTree);
  assert.equal(gitText('rev-parse', `${source.shadowSealCommit}^`), source.shadowImplementationCommit);
  assert.equal(gitText('rev-parse', `${source.shadowImplementationCommit}^{tree}`), source.shadowImplementationTree);
  assert.equal(gitText('rev-parse', `${source.shadowImplementationCommit}^`), source.packetBaseCommit);
  assert.equal(gitText('rev-parse', `${source.packetBaseCommit}^{tree}`), source.packetBaseTree);
  assert.equal(diffPaths(source.packetBaseCommit, source.shadowImplementationCommit).length, source.implementationPathCount);
  assert.equal(diffPaths(source.shadowImplementationCommit, source.shadowSealCommit).length, source.sealPathCount);
  assert.deepEqual(
    sorted(diffPaths(source.packetBaseCommit, source.shadowSealCommit)),
    sorted(source.allPaths),
  );
  assert.equal(gitText('rev-parse', `${source.shadowSealCommit}:${source.historicalReceiptPath}`), source.historicalReceiptBlob);
  assert.equal(gitText('rev-parse', `${receipt.implementationCommit}:${source.historicalReceiptPath}`), source.historicalReceiptBlob);
  assert.equal(shaAt(source.shadowSealCommit, source.historicalReceiptPath), source.historicalReceiptSha256);
  assert.equal(shaAt('HEAD', source.historicalReceiptPath), source.historicalReceiptSha256);
  assert.equal(
    gitText('rev-parse', `${source.shadowSealCommit}:test/obsShadow/receipt.test.mjs`),
    source.historicalReceiptTestBlob,
  );
  assert.equal(source.historicalReceiptDisposition, 'LINEAGE_ONLY_NOT_PORT_ACCEPTANCE');
});

test('implementation artifacts and non-self-referential seal artifact are hash bound', () => {
  assert.deepEqual(
    sorted(Object.keys(receipt.implementationArtifactSha256)),
    sorted(receipt.changedPaths.implementation),
  );
  for (const [relativePath, expected] of Object.entries(receipt.implementationArtifactSha256)) {
    assert.match(expected, /^[0-9a-f]{64}$/, relativePath);
    assert.equal(shaAt(receipt.implementationCommit, relativePath), expected, relativePath);
    assert.equal(shaAt('HEAD', relativePath), expected, relativePath);
  }
  assert.deepEqual(Object.keys(receipt.sealArtifactSha256), ['test/obsShadow/receipt.test.mjs']);
  for (const [relativePath, expected] of Object.entries(receipt.sealArtifactSha256)) {
    assert.match(expected, /^[0-9a-f]{64}$/, relativePath);
    assert.equal(shaAt('HEAD', relativePath), expected, relativePath);
  }
  assert.equal(Object.hasOwn(receipt.implementationArtifactSha256, RECEIPT_PATH), false);
  assert.equal(Object.hasOwn(receipt.sealArtifactSha256, RECEIPT_PATH), false);
  assert.match(receipt.receiptSelfHashPolicy, /EXCLUDES_ITS_OWN_DIGEST/);
});

test('entry gate, canonical owners, and exact typed insertion rows remain non-authoritative', () => {
  const inventory = JSON.parse(readFileSync(
    path.join(ROOT, 'fixtures/obsShadow/entry-inventory.v1.json'),
    'utf8',
  ));
  const contracts = JSON.parse(readFileSync(
    path.join(ROOT, 'fixtures/obsShadow/view-contracts.v1.json'),
    'utf8',
  ));
  const insertion = JSON.parse(readFileSync(
    path.join(ROOT, receipt.registryEvidence.manifestPath),
    'utf8',
  ));

  assert.equal(inventory.baseSha, receipt.baseCommit);
  assert.equal(inventory.portLaw.terminalStatus, receipt.terminalState);
  assert.equal(inventory.landedInterfaceAudit.citedOwnerPathCount, 17);
  assert.equal(receipt.landedInterfaceAudit.identicalBlobCount, 18);
  assert.deepEqual(
    Object.fromEntries(inventory.items.map((item) => [item.itemId, item.classification])),
    receipt.viewAcceptance.classifications,
  );
  assert.equal(contracts.contracts.length, receipt.viewAcceptance.inventoryItemCount);
  assert.equal(contracts.contracts.filter(
    (entry) => entry.implementation.includes('view-adapter.mjs'),
  ).length, receipt.viewAcceptance.implementedAdapterCount);
  assert.equal(contracts.contracts.filter(
    (entry) => entry.implementation === 'REFERENCE_ONLY_CANONICAL_OWNER_OUTPUT_UNMOUNTED',
  ).length, receipt.viewAcceptance.adoptedOwnerCount);
  assert.ok(contracts.contracts.every(
    (entry) => entry.obsShadowMountState.startsWith('NOT_MOUNTED_PORT_PRESTAGE'),
  ));

  const registry = receipt.registryEvidence;
  assert.equal(gitText('rev-parse', `${registry.commit}^{tree}`), registry.tree);
  assert.equal(gitText('rev-parse', `${registry.commit}:${registry.collisionMapPath}`), registry.collisionMapBlob);
  assert.equal(shaAt(registry.commit, registry.collisionMapPath), registry.collisionMapSha256);
  assert.equal(gitText('rev-parse', `${receipt.baseCommit}:${registry.schemaPath}`), registry.schemaBlobAtBase);
  assert.equal(gitText('rev-parse', `${receipt.implementationCommit}:${registry.manifestPath}`), registry.manifestBlobAtImplementation);
  assert.deepEqual(insertion.requests.map((row) => row.rowId), registry.rowIds);
  assert.ok(insertion.requests.every((row) => (
    row.schema === registry.schemaDefinition
      && row.status === 'DRAFT'
      && row.wiringState === `PENDING_BACKEND:${row.rowId}`
      && row.authorityCreated === false
  )));
  assert.equal(receipt.authorityCreated, false);
  assert.equal(receipt.viewAcceptance.mountState, 'NOT_MOUNTED');
  assert.equal(receipt.viewAcceptance.greenEligible, false);
});

test('receipt records the measured lane gate, honest root observations, effects, and limits', () => {
  const verification = Object.fromEntries(receipt.verification.map((entry) => [entry.id, entry]));
  const focused = verification['focused-os-network-denied-at-implementation'];
  assert.deepEqual(
    { exitCode: focused.exitCode, tests: focused.tests, passed: focused.passed, failed: focused.failed },
    { exitCode: 0, tests: 21, passed: 21, failed: 0 },
  );
  assert.equal(focused.networkCanary, 'LOOPBACK_CONNECT_DENIED_EACCES_OR_EPERM');
  assert.deepEqual(
    { exitCode: verification['javascript-syntax'].exitCode, checked: verification['javascript-syntax'].checked },
    { exitCode: 0, checked: 4 },
  );
  assert.deepEqual(
    { exitCode: verification['json-parse'].exitCode, checked: verification['json-parse'].checked },
    { exitCode: 0, checked: 5 },
  );
  assert.equal(verification['npm-test-first-precommit-observation'].exitCode, 1);
  assert.equal(
    verification['npm-test-first-precommit-observation'].failure,
    'PRODUCT_ASSURANCE_RUN_FAILED:A_CASE_S4_SAFE_PURITY',
  );
  assert.equal(verification['npm-test-implementation-rerun'].exitCode, 0);
  assert.equal(verification['npm-test-implementation-rerun'].acceptanceContract, '43/43');
  assert.equal(verification['npm-run-test-all'].crossFamilyChange, false);
  assert.equal(verification['adversarial-self-review'].blockingFindings, 0);
  assert.deepEqual(
    {
      expectedTests: receipt.sealVerification.expectedTests,
      expectedPassed: receipt.sealVerification.expectedPassed,
      expectedFailed: receipt.sealVerification.expectedFailed,
    },
    { expectedTests: 26, expectedPassed: 26, expectedFailed: 0 },
  );
  assert.equal(receipt.rootGateDisposition.laneAcceptanceGreen, true);
  assert.equal(receipt.rootGateDisposition.precommitNondeterminismObserved, true);
  assert.equal(receipt.rootGateDisposition.portableCleanCloneRootGreenClaim, false);
  assert.deepEqual(receipt.zeroEffects, {
    capitalEffect: '0',
    notionalEffect: '0',
    credentialReads: 0,
    networkConnectAttemptsByViewCode: 0,
    networkDenyCanaryAttempts: 1,
    networkConnectionsSucceeded: 0,
    orderCalls: 0,
    externalMutations: 0,
    deploymentCalls: 0,
    mountedPageEdits: 0,
    sharedSeamEdits: 0,
  });
  assert.ok(receipt.limitations.some((entry) => entry.includes('NOT_MOUNTED')));
  assert.ok(receipt.limitations.some((entry) => entry.includes('portable clean-clone')));
  assert.ok(receipt.nonClaims.some((entry) => entry.includes('LIVE_EXECUTION_NOT_IMPLEMENTED')));
});
