import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { I00_SURFACE_IDS } from '../../../../fixtures/productAssurance/systemic/cockpit/reference/cockpit-view-model.mjs';

function json(relativePath) {
  return JSON.parse(readFileSync(new URL(
    `../../../../fixtures/productAssurance/systemic/cockpit/${relativePath}`,
    import.meta.url,
  ), 'utf8'));
}

function assertClosedObjectSchemas(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertClosedObjectSchemas(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (value.type === 'object') {
    assert.equal(value.additionalProperties, false, `${path} is not a closed object schema`);
  }
  for (const [key, child] of Object.entries(value)) {
    assertClosedObjectSchemas(child, `${path}.${key}`);
  }
}

test('all cockpit JSON schemas are versioned and recursively close object shapes', () => {
  const names = [
    'cockpit-contract-set.v1.schema.json',
    'cockpit-view-model.v1.schema.json',
    'generated-row-drafts.v1.schema.json',
    'insertion-request-draft.v1.schema.json',
    'surface-projection-matrix.v1.schema.json',
  ];
  for (const name of names) {
    const schema = json(`schemas/${name}`);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /^urn:ip-assurance:systemic:cockpit:/);
    assertClosedObjectSchemas(schema);
  }
});

test('generated closure-row drafts use exact report columns and remain director-mount-only', () => {
  const telemetry = json('drafts/TELEMETRY_COVERAGE_ROWS_DRAFT.v1.json');
  assert.equal(telemetry.artifactState, 'DRAFT_ONLY');
  assert.equal(telemetry.targetArtifact, 'TELEMETRY_COVERAGE_MATRIX.md');
  assert.deepEqual(telemetry.columns, [
    'Subject Kind/ID', 'Metric', 'Structured Log', 'Ledger/Material Event',
    'Trace', 'Incident', 'Freshness/Hysteresis', 'Missing-Data Law', 'Severity',
    'Cockpit Surface', 'Repair/Control', 'Fixture', 'Proof',
  ]);
  assert.equal(telemetry.rows.length, 5);

  const resources = json('drafts/RESOURCE_BACKPRESSURE_ROWS_DRAFT.v1.json');
  assert.equal(resources.artifactState, 'DRAFT_ONLY');
  assert.equal(resources.targetArtifact, 'RESOURCE_AND_BACKPRESSURE_REPORT.md');
  assert.deepEqual(resources.rows.map((row) => row.values.Category), [
    'CPU and event-loop pressure', 'memory and process growth', 'disk/WAL/evidence/log growth',
    'public/private event rate', 'Q inference rate and latency', 'queue depth and processing lag',
    'dropped, coalesced, or superseded events', 'database write latency',
    'Binance request weight/rate-budget use', 'reconnects and resynchronization',
    'focus-symbol capacity', 'active-ticket/position priority', 'API/browser stream pressure',
    'degradation and load-shedding order',
  ]);
  for (const draft of [telemetry, resources]) {
    assert.equal(new Set(draft.rows.map((row) => row.rowId)).size, draft.rows.length);
    for (const row of draft.rows) {
      assert.equal(row.status, 'DRAFT');
      assert.equal(row.integrationState, 'DIRECTOR_MOUNT_REQUIRED');
      assert.deepEqual(Object.keys(row.values), draft.columns);
    }
  }
});

test('contract schema admits only the accepted lowercase IP-CONTROL SurfaceId strings', () => {
  const schema = json('schemas/cockpit-contract-set.v1.schema.json');
  assert.deepEqual(schema.$defs.surfaceId.enum, I00_SURFACE_IDS);
});

test('draft insertion rows are exact, machine-checkable, and make no integration claim', () => {
  const draft = json('drafts/INSERTION_REQUEST_ROWS_DRAFT.v1.json');
  assert.equal(draft.artifactState, 'DRAFT_ONLY');
  assert.equal(draft.rows.length, 5);
  const expectedKeys = [
    'contract', 'expectedBehavior', 'integrationState', 'reason', 'requestId',
    'requestedOwner', 'status', 'targetSeam', 'tests',
  ];
  for (const row of draft.rows) {
    assert.deepEqual(Object.keys(row).sort(), expectedKeys);
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.integrationState, 'DIRECTOR_MOUNT_REQUIRED');
    assert.doesNotMatch(row.expectedBehavior, /\b(?:INTEGRATED|DEPLOYED_PROVED|I00_ACCEPTED)\b/);
  }

  const telemetry = draft.rows.find((row) => row.contract.kind === 'TELEMETRY_COVERAGE_COLUMNS');
  for (const column of [
    'Expected Item ID', 'Canonical Owner', 'Source Schema ID', 'Source Schema Version',
    'Supervisor Snapshot Revision', 'Expected Manifest ID', 'Expected Manifest SHA-256',
    'Accepted Release SHA', 'Running Release SHA', 'Manifest Evaluation Result',
    'Expected Count', 'Visible Count',
    'Filtered Count', 'Hidden Count', 'Unknown Count', 'Registered Failure ID',
    'Detector Path', 'Telemetry Path', 'Browser Path', 'Detection SLO', 'Out-of-Band Proof Path',
  ]) assert.ok(telemetry.contract.columns.includes(column), column);

  const resource = draft.rows.find((row) => row.contract.kind === 'RESOURCE_BACKPRESSURE_CATEGORIES');
  assert.deepEqual(resource.contract.categories, [
    'CPU and event-loop pressure', 'memory and process growth', 'disk/WAL/evidence/log growth',
    'public/private event rate', 'Q inference rate and latency', 'queue depth and processing lag',
    'dropped, coalesced, or superseded events', 'database write latency',
    'Binance request weight/rate-budget use', 'reconnects and resynchronization',
    'focus-symbol capacity', 'active-ticket/position priority', 'API/browser stream pressure',
    'degradation and load-shedding order',
  ]);
  assert.deepEqual(resource.contract.shedFirst, [
    'optional research', 'replay', 'news', 'chart detail', 'broad enrichment',
  ]);
  assert.deepEqual(resource.contract.protectedSafetyOwners, [
    'active-position supervision', 'reconciliation', 'recovery', 'private truth', 'ledger', 'operator control',
  ]);

  const pages = draft.rows.find((row) => row.contract.kind === 'I17_PAGE_MATRIX');
  assert.deepEqual(pages.contract.columns, [
    'Page', 'routeKind', 'canonicalRoute', 'pageOwner', 'Canonical APIs', 'Live/Synthetic/Unwired Status', 'Controls',
    'Empty/Error Behavior', 'Acceptance Evidence', 'Remaining Blocker',
  ]);
  assert.deepEqual(pages.contract.rows.map((row) => row.Page), I00_SURFACE_IDS);
  assert.ok(pages.contract.rows.every((row) => (
    row['Live/Synthetic/Unwired Status'] === 'SYNTHETIC_ONLY | WIRED_FIXTURE | DIRECTOR_MOUNT_REQUIRED'
  )));
  const aliases = pages.contract.rows.filter((row) => ['execution', 'orders', 'positions', 'fills', 'pnl'].includes(row.Page));
  assert.ok(aliases.every((row) => row['Canonical APIs'].startsWith('Account-owned')));
  assert.ok(aliases.every((row) => row.routeKind === 'ACCOUNT_ALIAS'
    && row.canonicalRoute === 'account' && row.pageOwner === 'account'));
  assert.ok(pages.contract.rows.filter((row) => !aliases.includes(row)).every((row) => (
    row.routeKind === 'CANONICAL_SURFACE'
      && row.canonicalRoute === row.Page
      && row.pageOwner === row.Page
  )));
  assert.match(pages.contract.rows.find((row) => row.Page === 'borrow').Controls, /no borrow, repay, transfer, withdrawal, leverage, or margin mutation UI/i);

  const sweep = draft.rows.find((row) => row.contract.kind === 'IP_PROOF_S5_BROWSER_SWEEP');
  assert.ok(sweep.contract.cases.length >= 12);
  assert.ok(sweep.contract.cases.some((entry) => entry.caseId === 'FIVE_SECOND_CONNECTED_PATH'));
  assert.ok(sweep.contract.cases.some((entry) => entry.caseId === 'DEAD_BROWSER_OUT_OF_BAND'));
  assert.ok(sweep.contract.cases.some((entry) => entry.caseId === 'BORROW_READ_ONLY_NO_MONEY_UI'));

  const assurance = draft.rows.find((row) => row.contract.kind === 'ASSURANCE_PACKET_FOLD');
  assert.deepEqual(assurance.contract.forbiddenClaims, [
    'INTEGRATED', 'LIVE', 'DEPLOYED_PROVED', 'I00_ACCEPTED',
    'production ownership', 'runtime wiring', 'browser proof',
  ]);
});
