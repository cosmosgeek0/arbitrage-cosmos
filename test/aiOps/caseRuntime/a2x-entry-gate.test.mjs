import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixtureRoot = new URL('../../../fixtures/aiOps/caseRuntime/', import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, fixtureRoot), 'utf8'));

test('A2X entry gate is closed, exhaustive, and builds only missing or adapted rows', () => {
  const gate = readJson('entry-gate.a2x.v1.json');
  assert.deepEqual(Object.keys(gate).sort(), [
    'actualMergeBaseSha',
    'candidateReferenceIsAncestor',
    'candidateReferenceSha',
    'rows',
    'schema',
    'sealedArtifactSha',
    'shadowStatus',
  ]);
  assert.equal(gate.schema, 'AI_OPS_A2X_ENTRY_GATE_V1');
  assert.equal(gate.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(gate.candidateReferenceSha, '098f7b9449ab3b1c26bda19f51537bfea01d4c48');
  assert.equal(gate.sealedArtifactSha, 'ca1fb094e19d0ccc6a8397ee08a65a662d051bd3');
  assert.equal(gate.actualMergeBaseSha, '03857dcdaff8d8b12627d27ddcc97505da1f2f86');
  assert.equal(gate.candidateReferenceIsAncestor, false);
  assert.equal(gate.rows.length, 18);
  assert.equal(new Set(gate.rows.map((row) => row.item)).size, gate.rows.length);

  const classifications = new Set([
    'ADOPT_EXISTING',
    'ADAPT_EXISTING',
    'MISSING_BUILD',
    'REFERENCE_ONLY',
    'REJECT_DUPLICATE',
  ]);
  for (const row of gate.rows) {
    assert.deepEqual(Object.keys(row).sort(), ['buildDisposition', 'classification', 'evidence', 'item', 'owner']);
    assert.ok(classifications.has(row.classification));
    if (row.buildDisposition.startsWith('BUILD_')) {
      assert.ok(['ADAPT_EXISTING', 'MISSING_BUILD'].includes(row.classification), row.item);
    }
    if (['ADOPT_EXISTING', 'REJECT_DUPLICATE'].includes(row.classification)) {
      assert.equal(row.buildDisposition, 'NO_BUILD', row.item);
    }
    if (row.classification === 'REFERENCE_ONLY') {
      assert.equal(row.buildDisposition, 'INSERTION_REQUEST', row.item);
    }
  }
});

test('A2X insertion requests are authority-free, exact-lineage, closed rows', () => {
  const requests = readJson('insertion-requests.a2x.v1.json');
  assert.deepEqual(Object.keys(requests).sort(), [
    'actualMergeBaseSha',
    'authorityCreated',
    'candidateReferenceSha',
    'rows',
    'schema',
    'sealedArtifactSha',
    'shadowStatus',
  ]);
  assert.equal(requests.schema, 'AI_OPS_A2X_SHADOW_INSERTION_REQUESTS_V1');
  assert.equal(requests.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(requests.authorityCreated, false);
  assert.equal(requests.candidateReferenceSha, '098f7b9449ab3b1c26bda19f51537bfea01d4c48');
  assert.equal(requests.sealedArtifactSha, 'ca1fb094e19d0ccc6a8397ee08a65a662d051bd3');
  assert.equal(requests.actualMergeBaseSha, '03857dcdaff8d8b12627d27ddcc97505da1f2f86');
  assert.equal(requests.rows.length, 6);
  assert.equal(new Set(requests.rows.map((row) => row.requestId)).size, requests.rows.length);
  for (const row of requests.rows) {
    assert.deepEqual(Object.keys(row).sort(), ['missingBehavior', 'need', 'owner', 'requestId', 'seam', 'status']);
    assert.equal(row.status, 'INSERTION_REQUIRED');
  }
});
