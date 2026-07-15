import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadContracts } from './_network-denied-env.mjs';

const contracts = await loadContracts();
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const receiptRoot = resolve(repositoryRoot, 'fixtures/aiOps/contracts/receipts');
const baseSha = '03857dcdaff8d8b12627d27ddcc97505da1f2f86';
const implementationSha = '21ac214798bea6402c50ece3e026c00df4d582d8';
const a1xBaseSha = '83c1624d4a582eace27321182de35c372babbc1a';
const a1xImplementationSha = '8c8bcf27c915c12946a7913a9c55351124b8180f';

const implementationPaths = [
  'fixtures/aiOps/contracts/action-classes.v1.json',
  'fixtures/aiOps/contracts/adapted-schemas.v1.json',
  'fixtures/aiOps/contracts/capability-matrix.v1.json',
  'fixtures/aiOps/contracts/classification-manifest.v1.json',
  'fixtures/aiOps/contracts/control-insertion-requests.v1.json',
  'fixtures/aiOps/contracts/decision-log-design.synthetic.v1.json',
  'fixtures/aiOps/contracts/entry-inventory.v1.json',
  'fixtures/aiOps/contracts/generate-artifacts.mjs',
  'fixtures/aiOps/contracts/hard-denials.v1.json',
  'fixtures/aiOps/contracts/identity-provider-matrix.v1.json',
  'fixtures/aiOps/contracts/insertion-requests.v1.json',
  'fixtures/aiOps/contracts/policy-bundle.synthetic.v1.json',
  'fixtures/aiOps/contracts/reliability-targets.v1.json',
  'fixtures/aiOps/contracts/runbook-templates.v1.json',
  'fixtures/aiOps/contracts/schema-reuse-map.v1.json',
  'fixtures/aiOps/contracts/unfinished-interfaces.v1.json',
  'server/src/aiOps/contracts/artifacts.ts',
  'server/src/aiOps/contracts/authority.ts',
  'server/src/aiOps/contracts/classification.ts',
  'server/src/aiOps/contracts/controls.ts',
  'server/src/aiOps/contracts/identity.ts',
  'server/src/aiOps/contracts/index.ts',
  'server/src/aiOps/contracts/insertionRequests.ts',
  'server/src/aiOps/contracts/policy.ts',
  'server/src/aiOps/contracts/runbooks.ts',
  'server/src/aiOps/contracts/schemas.ts',
  'server/src/aiOps/contracts/shared.ts',
  'test/aiOps/contracts/_network-denied-env.mjs',
  'test/aiOps/contracts/artifacts-purity.test.mjs',
  'test/aiOps/contracts/authority-identity.test.mjs',
  'test/aiOps/contracts/classification.test.mjs',
  'test/aiOps/contracts/controls-insertion.test.mjs',
  'test/aiOps/contracts/runbook-policy.test.mjs',
  'test/aiOps/contracts/schema-closure.test.mjs',
];

const a1xImplementationPaths = [
  'fixtures/aiOps/contracts/action-class-fixture-instances.v1.json',
  'fixtures/aiOps/contracts/capability-graduation-target-instances.v1.json',
  'fixtures/aiOps/contracts/classification-manifest.v1.json',
  'fixtures/aiOps/contracts/entry-inventory.v1.json',
  'fixtures/aiOps/contracts/generate-artifacts.mjs',
  'fixtures/aiOps/contracts/mechanical-authority-manifests.v1.json',
  'fixtures/aiOps/contracts/runbook-manifest-instances.v1.json',
  'fixtures/aiOps/contracts/schema-reuse-map.v1.json',
  'server/src/aiOps/contracts/artifacts.ts',
  'server/src/aiOps/contracts/index.ts',
  'server/src/aiOps/contracts/instances.ts',
  'test/aiOps/contracts/artifacts-purity.test.mjs',
  'test/aiOps/contracts/instances.test.mjs',
];

test('shadow ready receipt binds exact base, implementation commit and changed paths', async () => {
  const receipt = await readFile(resolve(receiptRoot, 'SHADOW_ARTIFACT_READY_RECEIPT.md'), 'utf8');
  assert.match(receipt, /Status: `SHADOW_SPECULATIVE`/);
  assert.ok(receipt.includes(baseSha));
  assert.ok(receipt.includes(implementationSha));
  assert.ok(receipt.includes('Implementation changed paths: 34'));
  assert.ok(receipt.includes('51 tests, 51 passed, 0 failed'));
  assert.ok(receipt.includes('53 tests, 53 passed, 0 failed'));
  assert.ok(receipt.includes('expected `filesScanned=515`; observed `filesScanned=526`'));
  assert.ok(receipt.includes('`AIOPS-IR-TEST-MOUNT-026`'));
  assert.ok(receipt.trimEnd().endsWith('`SHADOW_ARTIFACT_READY`'));
  for (const path of implementationPaths) assert.ok(receipt.includes(`\`${path}\``), path);
});

test('receipts enumerate every insertion request and unfinished interface without acceptance claims', async () => {
  const ready = await readFile(resolve(receiptRoot, 'SHADOW_ARTIFACT_READY_RECEIPT.md'), 'utf8');
  const reuse = await readFile(resolve(receiptRoot, 'AI_OPS_REUSE_AND_GAP_RECEIPT.md'), 'utf8');
  for (const row of contracts.AI_OPS_INSERTION_REQUESTS) assert.ok(ready.includes(`\`${row.rowId}\``), row.rowId);
  for (const dependency of contracts.AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES) {
    assert.ok(ready.includes(`\`${dependency.dependencyId}\``), dependency.dependencyId);
    assert.ok(ready.includes(`\`${dependency.currentState}\``), dependency.dependencyId);
  }
  for (const receipt of [ready, reuse]) {
    assert.ok(receipt.includes('SHADOW_SPECULATIVE'));
    assert.ok(receipt.includes('fresh worktree from the accepted SHA'));
    assert.doesNotMatch(receipt, /^Status: `(?:ACCEPTED|PRESTAGE_READY)`$/m);
  }
});

test('A1X shadow receipt binds the sealed A1 base, implementation, exact paths and honest limitation', async () => {
  const receipt = await readFile(resolve(receiptRoot, 'A1X_SHADOW_READY_RECEIPT.md'), 'utf8');
  assert.match(receipt, /Status: `SHADOW_SPECULATIVE`/);
  assert.ok(receipt.includes(a1xBaseSha));
  assert.ok(receipt.includes(a1xImplementationSha));
  assert.ok(receipt.includes('Exactly 13 paths changed'));
  assert.ok(receipt.includes('10 instances'));
  assert.ok(receipt.includes('17 instances'));
  assert.ok(receipt.includes('31 root manifests and 71 classification entries'));
  assert.ok(receipt.includes('60 tests, 59 passed, one failed'));
  assert.ok(receipt.includes('db90f7165ec577e19bab0dd4abca29b647ffb7b2d5be677c9b7f4faa5de80878'));
  assert.ok(receipt.includes('b02f4ee62a8903b6a70c5409c2a6bd358edcdff2ca88bf518b6e9e77890c62fa'));
  assert.ok(receipt.includes('focused tests only'));
  assert.ok(receipt.includes('Main is outside A1X scope and was not touched'));
  assert.ok(receipt.includes('No `ACCEPTED`, `PRESTAGE_READY`'));
  for (const path of a1xImplementationPaths) assert.ok(receipt.includes(`\`${path}\``), path);
  for (const row of contracts.AI_OPS_INSERTION_REQUESTS) assert.ok(receipt.includes(`\`${row.rowId}\``), row.rowId);
  assert.ok(receipt.trimEnd().endsWith('`A1X_SHADOW_READY`'));
});
