import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  projectIncidentDrillView,
  projectPagingReceiptView,
  validateObsPortView,
} from '../../fixtures/obsShadow/view-adapter.mjs';
import { sha256CanonicalJson } from '../../fixtures/productAssurance/systemic/observability/canonical-sha256.mjs';
import { evaluateConservationAccounting } from '../../fixtures/productAssurance/systemic/observability/conservation-evaluator.mjs';
import { evaluateHistoricalSeries } from '../../fixtures/productAssurance/systemic/observability/historical-series-evaluator.mjs';
import { evaluateReleaseBoundExpectedManifest } from '../../fixtures/productAssurance/systemic/observability/release-manifest-evaluator.mjs';
import { RESOURCE_FAMILIES } from '../../fixtures/productAssurance/systemic/stability/contracts.mjs';
import {
  FIXTURE_NOW_MS,
  RESOURCE_FIXTURES,
} from '../../fixtures/productAssurance/systemic/stability/fixtures.mjs';
import { evaluateResourceEvidence } from '../../fixtures/productAssurance/systemic/stability/reference-evaluator.mjs';
import { createSchemaValidator } from '../productAssurance/systemic/agentBoundary/schema-validator.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJson = async (relativePath) => JSON.parse(
  await readFile(path.join(ROOT, relativePath), 'utf8'),
);
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitShow = (revision, relativePath) => execFileSync(
  'git',
  ['show', `${revision}:${relativePath}`],
  { cwd: ROOT, encoding: 'utf8' },
);
const gitBlob = (revision, relativePath) => git('rev-parse', `${revision}:${relativePath}`);

const inventory = await readJson('fixtures/obsShadow/entry-inventory.v1.json');
const contracts = await readJson('fixtures/obsShadow/view-contracts.v1.json');
const cases = await readJson('fixtures/obsShadow/cases.v1.json');
const insertionRequests = await readJson('fixtures/obsShadow/insertion-requests.v1.json');
const faultHarness = await readJson(
  'fixtures/productAssurance/fixtures-root/fault-harness-synthetic.json',
);
const insertionSchema = await readJson(
  'fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json',
);

const EXPECTED_ITEMS = [
  'COST_BUDGET_PROJECTIONS',
  'EXPECTED_VS_OBSERVED_INVENTORY',
  'HISTORICAL_TRENDS',
  'INCIDENT_DRILL_FIXTURES',
  'PAGING_RECEIPTS',
  'TELEMETRY_LOSS_DETECTION',
];
const EXPECTED_ROW_IDS = [
  'AIOPS-IR-COCKPIT-015',
  'AIOPS-IR-INCIDENT-019',
  'AIOPS-IR-NOTIFY-014',
  'AIOPS-IR-TELEMETRY-012',
  'AIOPS-IR-TEST-MOUNT-026',
];
const MAX_UTC_MS = 4_102_444_800_000;

function byItem(itemId) {
  return inventory.items.find((item) => item.itemId === itemId);
}

function contractByItem(itemId) {
  return contracts.contracts.find((contract) => contract.itemId === itemId);
}

function assertCommonPortPosture(view) {
  assert.equal(view.packetPosture, 'PORT_PRESTAGE');
  assert.equal(view.acceptanceStatus, null);
  assert.equal(view.authorityEffect, 'NONE');
  assert.equal(view.mountState, 'NOT_MOUNTED');
  assert.equal(view.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(view.greenEligible, false);
  for (const forbidden of [
    'actionRequired',
    'commands',
    'machineReady',
    'tradeReady',
    'liveAuthority',
  ]) assert.equal(Object.hasOwn(view, forbidden), false, forbidden);
}

function assertBoundDrillView(view, run, spec) {
  assert.equal(sha256CanonicalJson(run), spec.sourceRunContentSha256);
  assert.equal(view.sourceRunDigest, run.runDigest);
  assert.equal(view.sourceRunDigest, spec.expectedRunDigest);
  assert.equal(view.sourceContentSha256, spec.sourceRunContentSha256);
  assert.deepEqual(validateObsPortView(view, { run, spec }), []);
}

function stripTicks(value) {
  return value.trim().replaceAll('`', '');
}

function splitRegistryList(value) {
  return stripTicks(value).split(';').map((entry) => entry.trim()).filter(Boolean);
}

const registryMarkdown = gitShow(
  insertionRequests.registry.commitSha,
  insertionRequests.registry.registryPath,
);

function canonicalRegistryRow(rowId) {
  const line = registryMarkdown.split('\n')
    .find((candidate) => candidate.startsWith(`| \`${rowId}\` |`));
  assert.ok(line, `missing pinned registry row ${rowId}`);
  const cells = line.split('|').slice(1, -1).map(stripTicks);
  assert.equal(cells.length, 8, rowId);
  return {
    schema: 'InsertionRequestRowV1',
    version: 1,
    rowId,
    status: 'DRAFT',
    requestedOwner: cells[2],
    targetSeam: cells[3],
    reason: cells[4],
    contract: splitRegistryList(cells[5]),
    tests: splitRegistryList(cells[6]),
    expectedBehavior: splitRegistryList(cells[7]),
    wiringState: `PENDING_BACKEND:${rowId}`,
    authorityCreated: false,
  };
}

test('entry gate binds the landed base, source seal, and exact owner blobs', () => {
  assert.equal(inventory.schemaVersion, 'OBS_PORT_ENTRY_INVENTORY_V1');
  assert.equal(inventory.packetId, 'D-LAUNCH-51-PORT-OBS');
  assert.equal(inventory.packetPosture, 'PORT_PRESTAGE');
  assert.equal(inventory.acceptanceStatus, null);
  assert.equal(inventory.authorityEffect, 'NONE');
  assert.equal(inventory.baseSha, '492e3f69b054c85686bcfc4c09dbff4ababeda3f');
  assert.equal(inventory.branch, 'port-obs-20260716');
  assert.equal(
    inventory.sourceArtifact.sealCommitSha,
    '20608c4b041b552b67c43c1f328038b0c492942f',
  );
  assert.deepEqual(inventory.portLaw.exclusiveNamespaces, [
    'fixtures/obsShadow/**',
    'test/obsShadow/**',
  ]);
  assert.equal(inventory.portLaw.sharedSeamPolicy, 'TYPED_INSERTION_REQUEST_ROWS_ONLY');
  assert.equal(inventory.portLaw.terminalStatus, 'PORT_OBS_READY');

  assert.deepEqual(inventory.items.map((item) => item.itemId).sort(), EXPECTED_ITEMS);
  assert.deepEqual(
    Object.fromEntries(inventory.items.map((item) => [item.itemId, item.classification])),
    {
      HISTORICAL_TRENDS: 'ADOPT_EXISTING',
      PAGING_RECEIPTS: 'MISSING_BUILD',
      INCIDENT_DRILL_FIXTURES: 'ADAPT_EXISTING',
      EXPECTED_VS_OBSERVED_INVENTORY: 'ADOPT_EXISTING',
      TELEMETRY_LOSS_DETECTION: 'ADOPT_EXISTING',
      COST_BUDGET_PROJECTIONS: 'ADOPT_EXISTING',
    },
  );

  const ownerPaths = [...new Set(inventory.items.flatMap(
    (item) => item.evidence.map((entry) => entry.path),
  ))].sort();
  assert.equal(ownerPaths.length, inventory.landedInterfaceAudit.citedOwnerPathCount);
  assert.equal(ownerPaths.length, 17);
  const dependencyPaths = [...new Set([
    ...ownerPaths,
    inventory.landedInterfaceAudit.canonicalSha256Path,
  ])];
  assert.equal(
    dependencyPaths.length,
    inventory.landedInterfaceAudit.citedOwnerPathCount
      + inventory.landedInterfaceAudit.adapterDependencyPathCount,
  );
  assert.equal(dependencyPaths.length, 18);

  for (const ownerPath of dependencyPaths) {
    assert.equal(existsSync(path.join(ROOT, ownerPath)), true, ownerPath);
    assert.equal(
      gitBlob(inventory.landedInterfaceAudit.sourceComparisonSha, ownerPath),
      gitBlob(inventory.landedInterfaceAudit.targetSha, ownerPath),
      ownerPath,
    );
  }
  assert.equal(
    gitBlob(inventory.baseSha, inventory.landedInterfaceAudit.canonicalSha256Path),
    inventory.landedInterfaceAudit.canonicalSha256Blob,
  );
  assert.equal(
    gitBlob(inventory.baseSha, insertionRequests.registry.schemaPath),
    inventory.landedInterfaceAudit.insertionRequestSchemaBlob,
  );
  assert.equal(
    gitShow(
      inventory.sourceArtifact.sealCommitSha,
      inventory.sourceArtifact.historicalReceiptPath,
    ),
    readFileSync(path.join(ROOT, inventory.sourceArtifact.historicalReceiptPath), 'utf8'),
  );
});

test('view catalog implements only the two unmounted adapters with landed field paths', () => {
  assert.equal(contracts.packetPosture, 'PORT_PRESTAGE');
  assert.equal(contracts.acceptanceStatus, null);
  assert.equal(contracts.authorityEffect, 'NONE');
  assert.equal(contracts.baseSha, inventory.baseSha);
  assert.deepEqual(contracts.contracts.map((entry) => entry.itemId).sort(), EXPECTED_ITEMS);
  assert.equal(new Set(contracts.contracts.map((entry) => entry.viewId)).size, 6);

  for (const contract of contracts.contracts) {
    assert.equal(contract.classification, byItem(contract.itemId).classification);
    assert.match(contract.obsShadowMountState, /^NOT_MOUNTED_PORT_PRESTAGE/);
    assert.equal(new Set(contract.requiredViewFields).size, contract.requiredViewFields.length);
    assert.equal(new Set(contract.invariants).size, contract.invariants.length);
    assert.ok(contract.sourceContractState.length > 0);
    for (const source of contract.sourceContracts) {
      assert.equal(existsSync(path.join(ROOT, source.split('#')[0])), true, source);
    }
  }
  assert.deepEqual(
    contracts.contracts.filter((entry) => entry.implementation.includes('view-adapter.mjs'))
      .map((entry) => entry.itemId).sort(),
    ['INCIDENT_DRILL_FIXTURES', 'PAGING_RECEIPTS'],
  );
  assert.equal(contracts.contracts.filter(
    (entry) => entry.implementation === 'REFERENCE_ONLY_CANONICAL_OWNER_OUTPUT_UNMOUNTED',
  ).length, 4);

  assert.ok(contractByItem('HISTORICAL_TRENDS').requiredViewFields.includes('series[].points'));
  const paging = contractByItem('PAGING_RECEIPTS');
  assert.ok(paging.requiredViewFields.includes('actionRequiredCode'));
  assert.equal(paging.requiredViewFields.includes('actionRequired'), false);
  assert.ok(paging.invariants.includes('DIRECT_MOUNT_FORBIDDEN'));
  assert.equal(paging.sourceContracts.some(
    (source) => /#PAGING_(DELIVERY|ACKNOWLEDGEMENT)_RECEIPT/.test(source),
  ), false);
  const release = contractByItem('EXPECTED_VS_OBSERVED_INVENTORY');
  assert.ok(release.requiredViewFields.includes('counts.current'));
  assert.equal(release.requiredViewFields.includes('observedCount'), false);
  const cost = contractByItem('COST_BUDGET_PROJECTIONS');
  assert.ok(cost.requiredViewFields.includes('rows[].forecast'));
  assert.equal(cost.requiredViewFields.includes('assessmentFreshness'), false);
});

test('shared seams are exact typed rows from the pinned AIOPS-IR registry', () => {
  assert.equal(insertionRequests.packetPosture, 'PORT_PRESTAGE');
  assert.equal(insertionRequests.authorityEffect, 'NONE');
  assert.equal(
    gitBlob(insertionRequests.registry.commitSha, insertionRequests.registry.registryPath),
    insertionRequests.registry.registryBlob,
  );
  assert.equal(
    gitBlob(inventory.baseSha, insertionRequests.registry.schemaPath),
    insertionRequests.registry.schemaBlob,
  );
  assert.deepEqual(insertionRequests.requests.map((row) => row.rowId).sort(), EXPECTED_ROW_IDS);
  assert.equal(new Set(insertionRequests.requests.map((row) => row.rowId)).size, 5);

  const validateSchema = createSchemaValidator(insertionSchema);
  for (const row of insertionRequests.requests) {
    assert.deepEqual(validateSchema(insertionSchema, row), [], row.rowId);
    assert.equal(row.wiringState, `PENDING_BACKEND:${row.rowId}`);
    assert.equal(row.authorityCreated, false);
    assert.equal(Object.hasOwn(row, 'controlDraft'), false);
    assert.deepEqual(row, canonicalRegistryRow(row.rowId), row.rowId);
  }
  assert.deepEqual(
    [...new Set(insertionRequests.dedupDisposition.flatMap((entry) => entry.rowIds))].sort(),
    EXPECTED_ROW_IDS,
  );
});

test('adopted history owner remains the exact 23-family non-live projection', async () => {
  const input = await readJson(
    'fixtures/productAssurance/systemic/observability/cases/historical-series-complete.json',
  );
  const catalog = await readJson(
    'fixtures/productAssurance/systemic/observability/cases/slo-catalog-complete.json',
  );
  const output = evaluateHistoricalSeries(input, catalog);
  assert.equal(output.contractResult, 'PASS');
  assert.equal(output.expectedSeriesCount, 23);
  assert.equal(output.series.length, 23);
  assert.equal(output.liveGreenEligible, false);
  assert.ok(output.series.every((series) => Array.isArray(series.points)));
  assert.equal(Object.isFrozen(output), true);
});

test('adopted manifest owner keeps its denominator separate from current count', async () => {
  const input = await readJson(
    'fixtures/productAssurance/systemic/observability/cases/release-manifest-healthy.json',
  );
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.denominatorCount, 80);
  assert.equal(output.counts.expected, 84);
  assert.equal(output.counts.current, 84);
  assert.equal(output.ids.current.length, 84);
  assert.deepEqual(output.ids.missing, []);
  assert.deepEqual(output.ids.unexpectedObserved, []);
  assert.equal(Object.hasOwn(output, 'observedCount'), false);
  assert.equal(output.liveGreenEligible, false);
});

test('adopted telemetry owner keeps missing tuples UNKNOWN rather than zero', async () => {
  const input = await readJson(
    'fixtures/productAssurance/systemic/observability/cases/conservation-replay-balanced.json',
  );
  assert.equal(evaluateConservationAccounting(input).overallResult, 'PASS');
  const missing = structuredClone(input);
  missing.records.pop();
  const output = evaluateConservationAccounting(missing);
  assert.equal(output.overallResult, 'UNKNOWN');
  assert.equal(output.greenEligible, false);
  assert.equal(output.missingTupleCount, 1);
});

test('adopted stability owner preserves null forecast and no action authority', () => {
  const fixture = RESOURCE_FIXTURES.find(
    (entry) => entry.id === 'E02_UNKNOWN_FORECAST_REMAINS_NULL',
  );
  assert.ok(fixture);
  const output = evaluateResourceEvidence(fixture.input, FIXTURE_NOW_MS);
  assert.deepEqual(
    output.rows.map((entry) => entry.resourceFamily).sort(),
    [...RESOURCE_FAMILIES].sort(),
  );
  assert.equal(output.rows.length, 8);
  const row = output.rows.find((entry) => entry.resourceFamily === 'TELEMETRY_STORAGE');
  assert.ok(row);
  assert.equal(row.forecast, null);
  assert.equal(row.forecastHorizonMs, null);
  assert.equal(output.assuranceResult, 'UNKNOWN');
  assert.equal(output.mayThrottle, false);
  assert.equal(output.mayExecute, false);
  assert.deepEqual(output.commands, []);
  assert.equal(Object.hasOwn(row, 'currency'), false);
  assert.equal(Object.hasOwn(row, 'unit'), false);
});

test('paging fixtures keep routing, delivery, acknowledgement, and resolution orthogonal', () => {
  for (const fixture of cases.pagingCases) {
    const before = structuredClone(fixture.input);
    const view = projectPagingReceiptView(fixture.input);
    assert.equal(view.pagingReceiptState, fixture.expectedPagingReceiptState, fixture.caseId);
    assert.equal(view.actionRequiredCode, fixture.expectedActionRequiredCode, fixture.caseId);
    assert.equal(view.incidentResolutionState, 'NOT_PROJECTED');
    assertCommonPortPosture(view);
    assert.deepEqual(validateObsPortView(view, fixture.input), [], fixture.caseId);
    assert.deepEqual(fixture.input, before);
    assert.equal(Object.isFrozen(view), true);
  }
  const delivered = cases.pagingCases.find(
    (entry) => entry.caseId === 'PAGING_DELIVERED_NOT_ACKNOWLEDGED',
  );
  const view = projectPagingReceiptView(delivered.input);
  assert.equal(view.deliveryEvidence.ownerVerdict, 'PROVED');
  assert.equal(view.pagingReceiptState, 'AWAITING_ACKNOWLEDGEMENT');
  assert.equal(view.evidenceBindingState, 'REFERENCE_BOUND_UNVERIFIED');
});

test('malformed paging sources project fail-closed with explicit reasons', () => {
  const acknowledged = cases.pagingCases.find(
    (entry) => entry.caseId === 'PAGING_DELIVERED_AND_ACKNOWLEDGED',
  ).input;
  const delivered = cases.pagingCases.find(
    (entry) => entry.caseId === 'PAGING_DELIVERED_NOT_ACKNOWLEDGED',
  ).input;
  const mutations = [
    ['ack before delivery', 'PAGING_ACK_BEFORE_DELIVERY', (input) => {
      input.acknowledgementEvidence.observedAtMs = input.deliveryEvidence.observedAtMs - 1;
    }],
    ['forged owner', 'PAGING_DELIVERY_RECEIPT_OWNER_INVALID', (input) => {
      input.deliveryEvidence.ownerId = 'CALLER_FORGED_OWNER';
    }],
    ['forged fixture revision', 'PAGING_DELIVERY_RECEIPT_OWNER_REVISION_INVALID', (input) => {
      input.deliveryEvidence.ownerRevision = 'I08_PAGING_EVIDENCE_V1';
    }],
    ['ack without delivery', 'PAGING_ACK_WITHOUT_DELIVERY', (input) => {
      Object.assign(input.deliveryEvidence, {
        evidenceRef: null,
        evidenceDigest: null,
        ownerVerdict: 'UNPROVEN',
        observedAtMs: null,
      });
    }],
    ['proof on unconfigured route', 'PAGING_PROOF_FOR_NOT_CONFIGURED_ROUTE', (input) => {
      input.routingState = 'NOT_CONFIGURED';
    }],
    ['cross-incident splice', 'PAGING_DELIVERY_RECEIPT_RECEIPT_BINDING_INVALID', (input) => {
      input.deliveryEvidence = structuredClone(delivered.deliveryEvidence);
    }],
    ['attempt mismatch', 'PAGING_ATTEMPT_BINDING_MISMATCH', (input) => {
      input.acknowledgementEvidence.attemptId = 'other-attempt';
    }],
    ['future timestamp', 'PAGING_DELIVERY_RECEIPT_TIME_INVALID', (input) => {
      input.deliveryEvidence.observedAtMs = MAX_UTC_MS + 1;
    }],
    ['partial proof tuple', 'PAGING_DELIVERY_RECEIPT_REFERENCE_TIME_DIGEST_INCOMPLETE', (input) => {
      input.deliveryEvidence.evidenceDigest = null;
    }],
    ['unknown caller field', 'PAGING_INPUT_SHAPE_INVALID', (input) => {
      input.providerAccepted = true;
    }],
  ];

  for (const [name, code, mutate] of mutations) {
    const input = structuredClone(acknowledged);
    mutate(input);
    const view = projectPagingReceiptView(input);
    assert.equal(view.pagingReceiptState, 'UNKNOWN', name);
    assert.equal(view.actionRequiredCode, 'INSPECT_INVALID_EVIDENCE', name);
    assert.equal(view.evidenceBindingState, 'UNKNOWN', name);
    assert.ok(view.reasonCodes.includes(code), name);
    assertCommonPortPosture(view);
    assert.equal(
      validateObsPortView(view, input).includes('VIEW_PAGING_SOURCE_PROJECTION_MISMATCH'),
      false,
      name,
    );
  }
});

test('paging validator rejects false clears, malformed evidence, and source substitution', () => {
  const source = cases.pagingCases.find(
    (entry) => entry.caseId === 'PAGING_DELIVERED_AND_ACKNOWLEDGED',
  ).input;
  const alternate = cases.pagingCases.find(
    (entry) => entry.caseId === 'PAGING_DELIVERED_NOT_ACKNOWLEDGED',
  ).input;
  const valid = projectPagingReceiptView(source);
  const mutations = [
    (view) => { view.liveAuthority = true; },
    (view) => { delete view.deliveryEvidence.evidenceDigest; },
    (view) => { view.actionRequiredCode = 'NONE'; },
    (view) => { view.pagingReceiptState = 'NOT_CONFIGURED'; },
    (view) => { view.evidenceBindingState = 'NOT_CONFIGURED'; },
    (view) => { view.incidentResolutionState = 'RESOLVED'; },
    (view) => { view.acceptanceStatus = 'ACCEPTED'; },
    (view) => { view.greenEligible = true; },
  ];
  for (const mutate of mutations) {
    const hostile = structuredClone(valid);
    mutate(hostile);
    assert.notDeepEqual(validateObsPortView(hostile, source), []);
  }
  assert.ok(validateObsPortView(valid).includes('VIEW_SOURCE_CONTEXT_REQUIRED'));
  assert.ok(validateObsPortView(valid, alternate).includes('VIEW_PAGING_SOURCE_PROJECTION_MISMATCH'));
});

test('incident drill fixtures are exact source-bound synthetic comparisons', () => {
  assert.equal(faultHarness.truthLabel, 'SYNTHETIC_ONLY');
  for (const fixture of cases.incidentDrillCases) {
    const run = faultHarness.runs.find((entry) => entry.runId === fixture.sourceRunRef.runId);
    assert.ok(run, fixture.caseId);
    const beforeRun = structuredClone(run);
    const beforeSpec = structuredClone(fixture.spec);
    const view = projectIncidentDrillView(run, fixture.spec);
    assert.equal(view.drillOutcomeState, fixture.expectedDrillOutcomeState, fixture.caseId);
    assert.equal(view.actionRequiredCode, fixture.expectedActionRequiredCode, fixture.caseId);
    assert.equal(view.sourceBindingState, 'VERIFIED_PACKET_CONTENT_SHA256');
    assert.equal(view.identityBindingState, 'SHADOW_FIXTURE_ONLY');
    assert.equal(view.ownerIncidentId, null);
    assert.equal(view.ownerCorrelationId, null);
    assert.equal(view.incidentLifecycleState, 'NOT_PROJECTED');
    assert.equal(view.pagingReceiptState, 'NOT_PROJECTED');
    assert.equal(view.recoveryProofState, 'UNPROVEN');
    assert.deepEqual(view.timeline.map((entry) => entry.stage), run.transitionCodes);
    assert.ok(view.timeline.every(
      (entry) => entry.occurredAtMs === null && entry.evidenceRef === null,
    ));
    assertCommonPortPosture(view);
    assertBoundDrillView(view, run, fixture.spec);
    assert.deepEqual(run, beforeRun);
    assert.deepEqual(fixture.spec, beforeSpec);
  }
});

test('valid spec-only drill difference remains mismatch, not invalid source', () => {
  const fixture = cases.incidentDrillCases[0];
  const run = faultHarness.runs.find((entry) => entry.runId === fixture.sourceRunRef.runId);
  const spec = structuredClone(fixture.spec);
  spec.expectedRootCauseCode = 'DIFFERENT_EXPECTED_ROOT_CAUSE';
  const view = projectIncidentDrillView(run, spec);
  assert.equal(view.sourceBindingState, 'VERIFIED_PACKET_CONTENT_SHA256');
  assert.equal(view.drillOutcomeState, 'MISMATCH');
  assert.equal(view.actionRequiredCode, 'REVIEW_DRILL_MISMATCH');
  assert.ok(view.reasonCodes.includes('DRILL_ROOT_CAUSE_MISMATCH'));
  assert.deepEqual(validateObsPortView(view, { run, spec }), []);
});

test('malformed drill sources project UNKNOWN with explicit reasons', () => {
  const fixture = cases.incidentDrillCases.find(
    (entry) => entry.caseId === 'INCIDENT_DRILL_WATCHDOG_LOSS',
  );
  const source = faultHarness.runs.find((entry) => entry.runId === fixture.sourceRunRef.runId);
  const mutations = [
    ['missing transition', 'DRILL_REQUIRED_TRANSITION_MISSING', (run) => {
      run.transitionCodes = run.transitionCodes.filter((entry) => entry !== 'FAULT_INJECTED');
    }],
    ['changed content', 'DRILL_SOURCE_CONTENT_SHA256_MISMATCH', (run) => {
      run.iterationsCompleted += 1;
    }],
    ['duplicate transition', 'DRILL_TRANSITIONS_INVALID', (run) => {
      run.transitionCodes.push(run.transitionCodes[0]);
    }],
    ['reversed source time', 'DRILL_SOURCE_TIME_INVALID', (run) => {
      run.completedAtMs = run.startedAtMs - 1;
    }],
    ['out-of-range source time', 'DRILL_SOURCE_TIME_INVALID', (run) => {
      run.completedAtMs = MAX_UTC_MS + 1;
    }],
    ['unknown source field', 'DRILL_SOURCE_RUN_SHAPE_INVALID', (run) => {
      run.providerAccepted = true;
    }],
  ];
  for (const [name, code, mutate] of mutations) {
    const run = structuredClone(source);
    mutate(run);
    const view = projectIncidentDrillView(run, fixture.spec);
    assert.equal(view.drillOutcomeState, 'UNKNOWN', name);
    assert.equal(view.actionRequiredCode, 'INSPECT_INVALID_SOURCE', name);
    assert.equal(view.sourceBindingState, 'UNKNOWN', name);
    assert.ok(view.reasonCodes.includes(code), name);
    assertCommonPortPosture(view);
    assert.equal(
      validateObsPortView(view, { run, spec: fixture.spec })
        .includes('VIEW_DRILL_SOURCE_PROJECTION_MISMATCH'),
      false,
      name,
    );
  }

  const reorderedSpec = structuredClone(fixture.spec);
  reorderedSpec.requiredTransitionCodes.reverse();
  let view = projectIncidentDrillView(source, reorderedSpec);
  assert.equal(view.drillOutcomeState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('DRILL_REQUIRED_TRANSITION_ORDER_INVALID'));
  assert.deepEqual(validateObsPortView(view, { run: source, spec: reorderedSpec }), []);

  const commonModeSpec = structuredClone(fixture.spec);
  commonModeSpec.detectorFailureDomain = commonModeSpec.subjectFailureDomain;
  view = projectIncidentDrillView(source, commonModeSpec);
  assert.equal(view.drillOutcomeState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('DRILL_INDEPENDENT_FAILURE_DOMAIN_NOT_PROVEN'));
  assert.deepEqual(validateObsPortView(view, { run: source, spec: commonModeSpec }), []);

  const badRecoverySpec = structuredClone(fixture.spec);
  badRecoverySpec.recoveryProofRef = {};
  view = projectIncidentDrillView(source, badRecoverySpec);
  assert.equal(view.drillOutcomeState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('DRILL_RECOVERY_REFERENCE_INVALID'));
  assert.deepEqual(validateObsPortView(view, { run: source, spec: badRecoverySpec }), []);
});

test('drill validator rejects false MATCH, structural substitution, and forged hashes', () => {
  const fixture = cases.incidentDrillCases[0];
  const run = faultHarness.runs.find((entry) => entry.runId === fixture.sourceRunRef.runId);
  const valid = projectIncidentDrillView(run, fixture.spec);
  const context = { run, spec: fixture.spec };
  const mutations = [
    (view) => {
      view.drillId = null;
      view.scenarioId = null;
      view.runId = null;
      view.shadowIncidentId = null;
      view.shadowCorrelationId = null;
    },
    (view) => {
      view.expected.rootCauseCode = null;
      view.observed.rootCauseCode = null;
    },
    (view) => {
      view.expected.independentDetectorRequired = false;
      view.expected.subjectFailureDomain = null;
      view.expected.detectorFailureDomain = null;
    },
    (view) => {
      view.observed.startedAtMs = null;
      view.observed.completedAtMs = null;
    },
    (view) => { view.timeline[0].stage = 'FORGED_STAGE'; },
    (view) => { view.comparison.missingProofIds = ['FORGED_PROOF']; },
    (view) => { view.reasonCodes = ['DRILL_SOURCE_CONTENT_SHA256_MISMATCH']; },
    (view) => { view.sourceState = 'UNKNOWN'; },
    (view) => { view.ownerIncidentId = 'incident:forged-owner'; },
    (view) => { view.incidentLifecycleState = 'RESOLVED'; },
    (view) => {
      view.recoveryProofState = 'REFERENCE_ONLY';
      view.recoveryProofRef = 'forged:recovery';
      view.actionRequiredCode = 'OWNER_ADJUDICATION_REQUIRED';
    },
    (view) => {
      view.sourceRunDigest = '0'.repeat(64);
      view.sourceContentSha256 = '1'.repeat(64);
    },
    (view) => { view.greenEligible = true; },
  ];
  for (const mutate of mutations) {
    const hostile = structuredClone(valid);
    mutate(hostile);
    assert.notDeepEqual(validateObsPortView(hostile, context), []);
  }
  assert.ok(validateObsPortView(valid).includes('VIEW_SOURCE_CONTEXT_REQUIRED'));
  const wrongContext = {
    run: faultHarness.runs.find((entry) => entry.runId !== run.runId),
    spec: fixture.spec,
  };
  assert.ok(validateObsPortView(valid, wrongContext).includes('VIEW_DRILL_SOURCE_PROJECTION_MISMATCH'));
});

test('all generated views are deterministic, immutable, and non-elevating', () => {
  for (const fixture of cases.pagingCases) {
    const first = projectPagingReceiptView(fixture.input);
    assert.deepEqual(first, projectPagingReceiptView(fixture.input));
    assertCommonPortPosture(first);
    assert.equal(Object.isFrozen(first), true);
    assert.deepEqual(validateObsPortView(first, fixture.input), []);
  }
  for (const fixture of cases.incidentDrillCases) {
    const run = faultHarness.runs.find((entry) => entry.runId === fixture.sourceRunRef.runId);
    const first = projectIncidentDrillView(run, fixture.spec);
    assert.deepEqual(first, projectIncidentDrillView(run, fixture.spec));
    assertCommonPortPosture(first);
    assert.equal(Object.isFrozen(first), true);
    assert.deepEqual(validateObsPortView(first, { run, spec: fixture.spec }), []);
  }
  assert.deepEqual(validateObsPortView(null), ['VIEW_OBJECT_REQUIRED']);
  assert.ok(validateObsPortView({ schemaVersion: 'UNKNOWN' }).includes('VIEW_SCHEMA_UNKNOWN'));
});
