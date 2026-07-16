import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixtureRoot = new URL('../../../../fixtures/aiOps/a2/', import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, fixtureRoot), 'utf8'));
const targetBaseSha = '492e3f69b054c85686bcfc4c09dbff4ababeda3f';
const sourceArtifactSha = 'ca1fb094e19d0ccc6a8397ee08a65a662d051bd3';
const sourceExtensionSha = '9ae6c22012e7c23ebebff827b527d4d64a263884';
const sourceMergeBaseSha = '03857dcdaff8d8b12627d27ddcc97505da1f2f86';
const registryCommitSha = '08e0beaa54c4c3ca9c24276785d6a302f751a226';

test('A2 port entry gate binds the landed base, ratified paths, and noncanonical runtime status', () => {
  const gate = readJson('entry-gate.a2x.v1.json');
  assert.deepEqual(Object.keys(gate).sort(), [
    'authorityCreated',
    'portStatus',
    'ratifiedNamespaces',
    'registryCommitSha',
    'rows',
    'runtimeContractStatus',
    'schema',
    'sourceArtifactSha',
    'sourceExtensionSha',
    'sourceMergeBaseSha',
    'targetBaseSha',
    'version',
  ]);
  assert.equal(gate.schema, 'AI_OPS_A2_PORT_ENTRY_GATE_V1');
  assert.equal(gate.version, 1);
  assert.equal(gate.portStatus, 'PORT_A2_PRESTAGE');
  assert.equal(gate.runtimeContractStatus, 'SHADOW_SPECULATIVE');
  assert.equal(gate.targetBaseSha, targetBaseSha);
  assert.equal(gate.sourceArtifactSha, sourceArtifactSha);
  assert.equal(gate.sourceExtensionSha, sourceExtensionSha);
  assert.equal(gate.sourceMergeBaseSha, sourceMergeBaseSha);
  assert.equal(gate.registryCommitSha, registryCommitSha);
  assert.equal(gate.authorityCreated, false);
  assert.deepEqual(gate.ratifiedNamespaces, [
    'server/src/aiOps/runtime/**',
    'server/test/aiOps/a2/**',
    'fixtures/aiOps/a2/**',
    'docs/archive/aiOps/a2/**',
  ]);
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

  const encodedGate = JSON.stringify(gate);
  assert.doesNotMatch(encodedGate, /caseRuntime/u);
  assert.doesNotMatch(encodedGate, /098f7b9449ab3b1c26bda19f51537bfea01d4c48/u);
});

test('legacy shadow insertion rows deduplicate to canonical AIOPS-IR rows without creating authority', () => {
  const requests = readJson('insertion-requests.v1.json');
  const dedup = readJson('insertion-requests.a2x.v1.json');
  assert.deepEqual(Object.keys(dedup).sort(), [
    'authorityCreated',
    'mappings',
    'registryCommitSha',
    'schema',
    'sourceArtifactSha',
    'sourceExtensionSha',
    'targetBaseSha',
    'version',
  ]);
  assert.equal(dedup.schema, 'AI_OPS_A2_PORT_INSERTION_DEDUP_MAP_V1');
  assert.equal(dedup.version, 1);
  assert.equal(dedup.authorityCreated, false);
  assert.equal(dedup.targetBaseSha, targetBaseSha);
  assert.equal(dedup.sourceArtifactSha, sourceArtifactSha);
  assert.equal(dedup.sourceExtensionSha, sourceExtensionSha);
  assert.equal(dedup.registryCommitSha, registryCommitSha);

  const expectedLegacyIds = [
    'A2-I00-CONTRACT-001',
    'A2-I00-PERSIST-001',
    'A2-I00-QUEUE-001',
    'A2-I00-INCIDENT-001',
    'A2-I00-EVIDENCE-001',
    'A2-I00-MATERIAL-001',
    'A2-I00-EFFECT-001',
    'A2-I00-PROVIDER-001',
    'A2-I00-SIGNING-001',
    'A2-I00-GATES-001',
    'A2X-I00-INTAKE-001',
    'A2X-I00-PERSIST-001',
    'A2X-I00-ESCALATION-001',
    'A2X-A3-PROVIDER-001',
    'A2X-I00-TRUST-001',
    'A2X-I00-GATES-001',
  ];
  assert.deepEqual(dedup.mappings.map((row) => row.legacyRequestId), expectedLegacyIds);
  assert.equal(new Set(expectedLegacyIds).size, dedup.mappings.length);

  const activeIds = new Set(requests.rows.map((row) => row.rowId));
  const referenceOnlyIds = new Set([
    'AIOPS-IR-AUTH-004',
    'AIOPS-IR-CONTROLS-008',
    'AIOPS-IR-EGRESS-016',
    'AIOPS-IR-DOCS-017',
    'AIOPS-IR-BARREL-018',
    'AIOPS-IR-CONFIG-025',
  ]);
  const dispositions = new Set([
    'DEDUPLICATED_TO_CANONICAL_REGISTRY',
    'NO_ONE_TO_ONE_REGISTRY_ROW',
  ]);
  for (const row of dedup.mappings) {
    assert.deepEqual(Object.keys(row).sort(), [
      'disposition',
      'legacyRequestId',
      'primaryRowIds',
      'referenceOnlyRowIds',
    ]);
    assert.ok(dispositions.has(row.disposition), row.legacyRequestId);
    assert.ok(row.primaryRowIds.length > 0, row.legacyRequestId);
    for (const rowId of row.primaryRowIds) assert.ok(activeIds.has(rowId), `${row.legacyRequestId}: ${rowId}`);
    for (const rowId of row.referenceOnlyRowIds) {
      assert.ok(referenceOnlyIds.has(rowId), `${row.legacyRequestId}: ${rowId}`);
      assert.equal(activeIds.has(rowId), false, `${rowId} must remain reference-only`);
    }
  }
});
