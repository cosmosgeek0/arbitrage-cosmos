import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadContracts } from './_network-denied-env.mjs';

const contracts = await loadContracts();
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const shadowReceiptRoot = resolve(repositoryRoot, 'docs/archive/aiOps/a1/shadow');
const portReceiptPath = resolve(repositoryRoot, 'docs/archive/aiOps/a1/PORT_A1_PRESTAGE_RECEIPT.md');

const SHADOW_RECEIPTS = Object.freeze({
  'A1X_SHADOW_READY_RECEIPT.md': {
    sha256: '16c7797788606e9569caff38df445a25e46e4b45919e6a2708529cc3d172263f',
    terminal: '`A1X_SHADOW_READY`',
  },
  'AI_OPS_REUSE_AND_GAP_RECEIPT.md': {
    sha256: 'd4c29401afab23561daa28932552aec73ae0de242c69c9ccb2cae3d29fbb0753',
    terminal: null,
  },
  'SHADOW_ARTIFACT_READY_RECEIPT.md': {
    sha256: '22bd861974c4a622e57a247bf581f9f71558d3084560d7c10bdef26abd535a36',
    terminal: '`SHADOW_ARTIFACT_READY`',
  },
});

test('three archived shadow receipts remain immutable provenance and never become real acceptance', async () => {
  for (const [name, expected] of Object.entries(SHADOW_RECEIPTS)) {
    const bytes = await readFile(resolve(shadowReceiptRoot, name));
    const text = bytes.toString('utf8');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
    assert.match(text, /SHADOW_SPECULATIVE/);
    assert.doesNotMatch(text, /PORT_A1_PRESTAGE_READY/);
    if (expected.terminal !== null) assert.ok(text.trimEnd().endsWith(expected.terminal), name);
  }
});

test('shadow lineage is preserved separately from current port provenance', async () => {
  const a1 = await readFile(resolve(shadowReceiptRoot, 'SHADOW_ARTIFACT_READY_RECEIPT.md'), 'utf8');
  const a1x = await readFile(resolve(shadowReceiptRoot, 'A1X_SHADOW_READY_RECEIPT.md'), 'utf8');
  for (const sha of [
    contracts.AI_OPS_SHADOW_ORIGIN_BASE_SHA,
    contracts.AI_OPS_SHADOW_A1_IMPLEMENTATION_SHA,
  ]) assert.ok(a1.includes(sha), sha);
  for (const sha of [
    contracts.AI_OPS_SHADOW_A1_SEALED_SHA,
    contracts.AI_OPS_SHADOW_A1X_IMPLEMENTATION_SHA,
  ]) assert.ok(a1x.includes(sha), sha);
  assert.equal(a1.includes(contracts.AI_OPS_SHADOW_A1_SEALED_SHA), false, 'a receipt cannot name its enclosing A1 seal');
  assert.equal(a1x.includes(contracts.AI_OPS_SHADOW_TIP_SHA), false, 'a receipt cannot name its enclosing A1X seal');
  assert.notEqual(contracts.AI_OPS_PORT_BASE_SHA, contracts.AI_OPS_SHADOW_ORIGIN_BASE_SHA);
});

test('current lane owns 11 exact requests and treats docs/barrel rows as external integrator dependencies', () => {
  assert.equal(contracts.AI_OPS_INSERTION_REQUESTS.length, 11);
  assert.deepEqual(contracts.AI_OPS_EXTERNAL_INTEGRATOR_DEPENDENCY_IDS, [
    'AIOPS-IR-DOCS-017',
    'AIOPS-IR-BARREL-018',
  ]);
  const laneIds = new Set(contracts.AI_OPS_INSERTION_REQUESTS.map((row) => row.rowId));
  for (const externalId of contracts.AI_OPS_EXTERNAL_INTEGRATOR_DEPENDENCY_IDS) assert.equal(laneIds.has(externalId), false);
});

test('final seal mode requires a real receipt bound to the tested implementation', async (context) => {
  if (process.env.AI_OPS_REQUIRE_PORT_RECEIPT !== '1') {
    context.skip('implementation-phase run; final seal mode is not enabled');
    return;
  }
  const expectedImplementationSha = process.env.AI_OPS_EXPECTED_IMPLEMENTATION_SHA;
  assert.match(expectedImplementationSha ?? '', /^[a-f0-9]{40}$/);
  const receipt = await readFile(portReceiptPath, 'utf8');
  assert.match(receipt, /Schema: `PORT_A1_PRESTAGE_RECEIPT_V1`/);
  assert.match(receipt, /Status: `PORT_A1_PRESTAGE_READY`/);
  assert.ok(receipt.includes(contracts.AI_OPS_PORT_BASE_SHA));
  assert.ok(receipt.includes(expectedImplementationSha));
  assert.ok(receipt.includes(contracts.AI_OPS_SHADOW_TIP_SHA));
  assert.ok(receipt.includes('AIOPS-IR-TEST-MOUNT-026'));
  assert.ok(receipt.includes('LIVE_EXECUTION_NOT_IMPLEMENTED'));
  assert.ok(receipt.trimEnd().endsWith('`PORT_A1_PRESTAGE_READY`'));
});
