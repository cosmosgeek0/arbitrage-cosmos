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
