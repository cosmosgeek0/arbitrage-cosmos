import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const insertionUrl = new URL('../../../fixtures/aiOps/ui/insertion-requests.v1.json', import.meta.url);
const fixtureUrl = new URL('../../../fixtures/aiOps/ui/ai-ops-shadow-fixture.v1.json', import.meta.url);
const insertionSet = JSON.parse(readFileSync(insertionUrl, 'utf8'));
const fixtureManifest = JSON.parse(readFileSync(fixtureUrl, 'utf8'));

test('fixture manifest is bound to the exact shadow base and obvious fake identities', () => {
  assert.equal(fixtureManifest.schema, 'AiOpsShadowFixtureManifestV1');
  assert.equal(fixtureManifest.version, 1);
  assert.equal(fixtureManifest.baseSha, '03857dcdaff8d8b12627d27ddcc97505da1f2f86');
  assert.equal(fixtureManifest.extensionBaseSha, 'b5f4c478223796cf7f9d73ba8c424a179aaa8551');
  assert.match(fixtureManifest.obviousFakeProvider, /\.invalid$/);
  assert.match(fixtureManifest.obviousFakeModel, /^fixture-/);
});

test('every insertion request is a unique typed draft that creates no authority', () => {
  assert.equal(insertionSet.schema, 'AiOpsShadowInsertionRequestSetV1');
  assert.equal(insertionSet.posture, 'SHADOW_SPECULATIVE');
  assert.equal(insertionSet.baseSha, '03857dcdaff8d8b12627d27ddcc97505da1f2f86');
  assert.equal(insertionSet.authorityCreated, false);
  assert.ok(insertionSet.rows.length >= 14);
  assert.equal(new Set(insertionSet.rows.map((row) => row.rowId)).size, insertionSet.rows.length);

  for (const row of insertionSet.rows) {
    assert.equal(row.schema, 'InsertionRequestRowV1', row.rowId);
    assert.equal(row.version, 1, row.rowId);
    assert.equal(row.status, 'DRAFT', row.rowId);
    assert.ok(row.requestedOwner, row.rowId);
    assert.ok(row.targetSeam, row.rowId);
    assert.ok(row.reason, row.rowId);
    assert.ok(Array.isArray(row.contract) && row.contract.length >= 3, row.rowId);
    assert.ok(Array.isArray(row.tests) && row.tests.length >= 3, row.rowId);
    assert.ok(Array.isArray(row.expectedBehavior) && row.expectedBehavior.length >= 3, row.rowId);
    assert.ok(Array.isArray(row.wiringState) && row.wiringState.length >= 1, row.rowId);
    assert.ok(row.wiringState.every((state) => state.startsWith('PENDING_BACKEND:')), row.rowId);
    assert.equal(row.authorityCreated, false, row.rowId);
  }
});

test('insertion requests cover every forbidden shared seam and unfinished owner dependency', () => {
  const serialized = JSON.stringify(insertionSet);
  for (const dependency of [
    'PRODUCT_ASSURANCE_CANONICAL_READ_OWNER_NOT_CONFIGURED',
    'INCIDENT_OWNER_NOT_CONFIGURED',
    'SET_DIAGNOSTIC_PLANE_KILL',
    'MOUNT_DIAGNOSTIC_PROVIDER_WORKLOAD_IDENTITY_PROJECTION',
    'PROJECT_DIAGNOSTIC_WORKER_ASSURANCE_FIELDS',
    'A_AGENT_DIAGNOSTIC_GOVERNANCE_OWNER_BINDING',
    'MOUNT_SYNTHETIC_UI_PROBE_OWNER_PROJECTION',
    'MOUNT_REFRESH_DOCK_AI_OPS_READBACK_PROJECTION',
    'PORT_A4_AFTER_INTEGRATED_ACCEPTED',
  ]) {
    assert.match(serialized, new RegExp(dependency), dependency);
  }
  for (const seam of ['route', 'navigation', 'auth', 'registry', 'incident', 'chat', 'provider', 'probe', 'RefreshDock', 'Logs', 'Notifications', 'test']) {
    assert.match(serialized, new RegExp(seam, 'i'), seam);
  }
});

test('the handoff contract explicitly requires a fresh port and the full acceptance loop', () => {
  const row = insertionSet.rows.find((candidate) => candidate.rowId === 'AIOPS-A4-IR-TEST-MOUNT-014');
  assert.ok(row);
  const serialized = JSON.stringify(row);
  assert.match(serialized, /fresh worktree from the accepted SHA/i);
  assert.match(serialized, /entire lane acceptance loop/i);
  assert.match(serialized, /No SHADOW artifact gains PRESTAGE_READY or acceptance status/);
  assert.match(serialized, /STATE\.md/);
});
