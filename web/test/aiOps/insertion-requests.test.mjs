import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createSchemaValidator } from '../../../test/productAssurance/systemic/agentBoundary/schema-validator.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INSERTION_URL = new URL('../../../fixtures/aiOps/a4/insertion-requests.v1.json', import.meta.url);
const REGISTRY_COMMIT = '08e0beaa54c4c3ca9c24276785d6a302f751a226';
const REGISTRY_PATH = 'AI_OPS_COLLISION_MAP.md';
const REGISTRY_BLOB = '5f76b29a81b6af4eee7a156afc16979fea02635e';
const LANDED_BASE = '492e3f69b054c85686bcfc4c09dbff4ababeda3f';
const ROW_SCHEMA_PATH = 'fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json';
const ROW_SCHEMA_BLOB = '042456c58b1cd5b6eb179c0c9c289f6e69d06034';

const EXPECTED_A4_REGISTRY_ROWS = [
  'AIOPS-IR-ROUTES-002',
  'AIOPS-IR-AUTH-004',
  'AIOPS-IR-NAVIGATION-005',
  'AIOPS-IR-PACKAGE-006',
  'AIOPS-IR-CONTROLS-008',
  'AIOPS-IR-EVENTS-009',
  'AIOPS-IR-TELEMETRY-012',
  'AIOPS-IR-REFRESH-013',
  'AIOPS-IR-NOTIFY-014',
  'AIOPS-IR-COCKPIT-015',
  'AIOPS-IR-INCIDENT-019',
  'AIOPS-IR-SENTINEL-020',
  'AIOPS-IR-AUDIT-021',
  'AIOPS-IR-MANAGED-INVENTORY-022',
  'AIOPS-IR-APPROVAL-023',
  'AIOPS-IR-BROWSER-PROBE-024',
  'AIOPS-IR-TEST-MOUNT-026',
];

const EXPECTED_ENVELOPE = {
  schema: 'AiOpsPortInsertionRequestSetV1',
  version: 1,
  posture: 'PORT_A4_PRESTAGE_DRAFT',
  baseSha: LANDED_BASE,
  registryCommitSha: REGISTRY_COMMIT,
  registryBlob: REGISTRY_BLOB,
  rowSchemaBlob: ROW_SCHEMA_BLOB,
  directEditAllowed: false,
  authorityCreated: false,
};

const git = (...args) => execFileSync('git', args, {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

const normalizeCell = (value) => value.replaceAll('`', '').trim();

const splitListCell = (value) => normalizeCell(value)
  .split(';')
  .map((entry) => entry.trim())
  .filter(Boolean);

function requestingLanesIncludeA4(value) {
  const lanes = normalizeCell(value);
  return lanes === 'A1-A5' || lanes.split(',').map((lane) => lane.trim()).includes('A4');
}

function extractCanonicalA4Rows(markdown) {
  const rows = [];

  for (const line of markdown.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 8 || !cells[0].startsWith('`AIOPS-IR-') || !requestingLanesIncludeA4(cells[1])) continue;

    const rowId = normalizeCell(cells[0]);
    rows.push({
      schema: 'InsertionRequestRowV1',
      version: 1,
      rowId,
      status: 'DRAFT',
      requestedOwner: normalizeCell(cells[2]),
      targetSeam: normalizeCell(cells[3]),
      reason: normalizeCell(cells[4]),
      contract: splitListCell(cells[5]),
      tests: splitListCell(cells[6]),
      expectedBehavior: splitListCell(cells[7]),
      wiringState: `PENDING_BACKEND:${rowId}`,
      authorityCreated: false,
    });
  }

  return rows;
}

const insertionSet = JSON.parse(readFileSync(INSERTION_URL, 'utf8'));
const registryMarkdown = git('show', `${REGISTRY_COMMIT}:${REGISTRY_PATH}`);
const canonicalA4Rows = extractCanonicalA4Rows(registryMarkdown);
const immutableRowSchema = JSON.parse(git('show', `${LANDED_BASE}:${ROW_SCHEMA_PATH}`));
const validateInsertionRow = createSchemaValidator(immutableRowSchema);

test('registry and row schema resolve to the immutable bound Git objects', () => {
  assert.equal(git('rev-parse', `${REGISTRY_COMMIT}^{commit}`), REGISTRY_COMMIT);
  assert.equal(git('rev-parse', `${REGISTRY_COMMIT}:${REGISTRY_PATH}`), REGISTRY_BLOB);
  assert.equal(git('rev-parse', `${LANDED_BASE}^{commit}`), LANDED_BASE);
  assert.equal(git('rev-parse', `${LANDED_BASE}:${ROW_SCHEMA_PATH}`), ROW_SCHEMA_BLOB);
  assert.equal(insertionSet.registryCommitSha, REGISTRY_COMMIT);
  assert.equal(insertionSet.registryBlob, REGISTRY_BLOB);
  assert.equal(insertionSet.rowSchemaBlob, ROW_SCHEMA_BLOB);
});

test('active insertion set exactly matches the canonical A4 allocation and strict envelope', () => {
  assert.deepEqual(canonicalA4Rows.map((row) => row.rowId), EXPECTED_A4_REGISTRY_ROWS);
  assert.deepEqual(insertionSet, {
    ...EXPECTED_ENVELOPE,
    rows: canonicalA4Rows,
  });
});

test('every canonical A4 row satisfies the immutable landed InsertionRequestRowV1 schema', () => {
  for (const row of insertionSet.rows) {
    const violations = validateInsertionRow(row);
    assert.deepEqual(violations, [], `${row.rowId}: ${violations.join('; ')}`);
    assert.equal(row.wiringState, `PENDING_BACKEND:${row.rowId}`, row.rowId);
    assert.equal(row.authorityCreated, false, row.rowId);
    assert.equal(Object.hasOwn(row, 'controlDraft'), false, row.rowId);
  }
});

test('canonical array delimiters are preserved as distinct nonempty items', () => {
  for (const row of insertionSet.rows) {
    for (const field of ['contract', 'tests', 'expectedBehavior']) {
      assert.ok(row[field].length >= 1, `${row.rowId}.${field}`);
      assert.ok(row[field].every((entry) => entry.length > 0 && !entry.includes(';') && !entry.includes('`')), `${row.rowId}.${field}`);
    }
  }
});

test('A4 creates no foreign shared-owner request or direct-edit authority', () => {
  const ids = new Set(insertionSet.rows.map((row) => row.rowId));
  assert.equal(ids.size, EXPECTED_A4_REGISTRY_ROWS.length);
  for (const foreign of ['AIOPS-IR-COMPOSITION-001', 'AIOPS-IR-PERSISTENCE-003', 'AIOPS-IR-DOCS-017']) {
    assert.equal(ids.has(foreign), false, foreign);
  }
  assert.equal(insertionSet.directEditAllowed, false);
  assert.equal(insertionSet.authorityCreated, false);
});
