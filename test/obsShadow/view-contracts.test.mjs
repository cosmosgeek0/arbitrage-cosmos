import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  projectIncidentDrillView,
  projectPagingReceiptView,
  validateObsShadowView,
} from '../../fixtures/obsShadow/view-adapter.mjs';
import { evaluateConservationAccounting } from '../../fixtures/productAssurance/systemic/observability/conservation-evaluator.mjs';
import { evaluateHistoricalSeries } from '../../fixtures/productAssurance/systemic/observability/historical-series-evaluator.mjs';
import { evaluateReleaseBoundExpectedManifest } from '../../fixtures/productAssurance/systemic/observability/release-manifest-evaluator.mjs';
import {
  FIXTURE_NOW_MS,
  RESOURCE_FIXTURES,
} from '../../fixtures/productAssurance/systemic/stability/fixtures.mjs';
import { evaluateResourceEvidence } from '../../fixtures/productAssurance/systemic/stability/reference-evaluator.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(ROOT, relativePath), 'utf8'));
const inventory = await readJson('fixtures/obsShadow/entry-inventory.v1.json');
const contracts = await readJson('fixtures/obsShadow/view-contracts.v1.json');
const cases = await readJson('fixtures/obsShadow/cases.v1.json');
const insertionRequests = await readJson('fixtures/obsShadow/insertion-requests.v1.json');
const faultHarness = await readJson('fixtures/productAssurance/fixtures-root/fault-harness-synthetic.json');

const EXPECTED_ITEMS = [
  'COST_BUDGET_PROJECTIONS',
  'EXPECTED_VS_OBSERVED_INVENTORY',
  'HISTORICAL_TRENDS',
  'INCIDENT_DRILL_FIXTURES',
  'PAGING_RECEIPTS',
  'TELEMETRY_LOSS_DETECTION',
];

function byItem(itemId) {
  return inventory.items.find((item) => item.itemId === itemId);
}

test('entry gate binds the exact base and classifies every requested item before build', () => {
  assert.equal(inventory.packetId, 'RUN-18');
  assert.equal(inventory.packetPosture, 'SHADOW_SPECULATIVE');
  assert.equal(inventory.acceptanceStatus, null);
  assert.equal(inventory.authorityEffect, 'NONE');
  assert.equal(inventory.baseSha, '098f7b9449ab3b1c26bda19f51537bfea01d4c48');
  assert.equal(inventory.branch, 'obs-shadow-20260715');
  assert.deepEqual(inventory.shadowLaw, {
    directive: 'D-LAUNCH-37',
    orderId: '90dcac299155',
    sourceCommit: 'd090d006019e21b150fa7b74831240695d8791e3',
    portingGate: 'C2_PLUS_DIRECTOR_ADJUDICATION',
  });
  assert.deepEqual(inventory.items.map((item) => item.itemId).sort(), EXPECTED_ITEMS);
  assert.deepEqual(
    inventory.items.filter((item) => item.classification === 'ADAPT_EXISTING').map((item) => item.itemId).sort(),
    ['INCIDENT_DRILL_FIXTURES', 'PAGING_RECEIPTS'],
  );
  assert.deepEqual(
    inventory.items.filter((item) => item.classification === 'ADOPT_EXISTING').map((item) => item.itemId).sort(),
    [
      'COST_BUDGET_PROJECTIONS',
      'EXPECTED_VS_OBSERVED_INVENTORY',
      'HISTORICAL_TRENDS',
      'TELEMETRY_LOSS_DETECTION',
    ],
  );
  assert.equal(inventory.items.some((item) => item.classification === 'MISSING_BUILD'), false);
  assert.deepEqual(
    inventory.items.filter((item) => item.buildDecision !== 'NO_NEW_IMPLEMENTATION')
      .map((item) => item.itemId).sort(),
    ['INCIDENT_DRILL_FIXTURES', 'PAGING_RECEIPTS'],
  );
  for (const item of inventory.items) {
    assert.ok(item.evidence.length > 0, item.itemId);
    for (const evidence of item.evidence) {
      assert.equal(existsSync(path.join(ROOT, evidence.path)), true, evidence.path);
    }
  }
});

test('view catalog adopts four owners and implements only the two approved adapters', () => {
  assert.equal(contracts.packetPosture, 'SHADOW_SPECULATIVE');
  assert.equal(contracts.acceptanceStatus, null);
  assert.equal(contracts.authorityEffect, 'NONE');
  assert.equal(contracts.baseSha, inventory.baseSha);
  assert.deepEqual(contracts.contracts.map((contract) => contract.itemId).sort(), EXPECTED_ITEMS);
  assert.equal(new Set(contracts.contracts.map((contract) => contract.viewId)).size, 6);

  for (const contract of contracts.contracts) {
    const item = byItem(contract.itemId);
    assert.ok(item);
    assert.equal(contract.classification, item.classification);
    assert.equal(contract.obsShadowMountState.startsWith('NOT_MOUNTED'), true);
    assert.equal(new Set(contract.requiredViewFields).size, contract.requiredViewFields.length);
    assert.equal(new Set(contract.invariants).size, contract.invariants.length);
    for (const sourceContract of contract.sourceContracts) {
      const sourcePath = sourceContract.split('#')[0];
      assert.equal(existsSync(path.join(ROOT, sourcePath)), true, sourcePath);
    }
  }

  assert.deepEqual(
    contracts.contracts.filter((contract) => contract.implementation.includes('view-adapter.mjs'))
      .map((contract) => contract.itemId).sort(),
    ['INCIDENT_DRILL_FIXTURES', 'PAGING_RECEIPTS'],
  );
  assert.equal(
    contracts.contracts.filter((contract) => contract.implementation === 'CANONICAL_OWNER_OUTPUT_DIRECT').length,
    4,
  );
});

test('insertion requests are drafts with no mount authority before C2 and director adjudication', () => {
  assert.equal(insertionRequests.packetPosture, 'SHADOW_SPECULATIVE');
  assert.equal(insertionRequests.authorityEffect, 'NONE');
  assert.equal(insertionRequests.requests.length, 3);
  assert.equal(new Set(insertionRequests.requests.map((request) => request.requestId)).size, 3);
  for (const request of insertionRequests.requests) {
    assert.equal(request.status, 'DRAFT');
    assert.equal(request.mountAuthority, 'DIRECTOR_MOUNT_REQUIRED');
    assert.equal(request.dependency, 'C2_PLUS_DIRECTOR_ADJUDICATION');
    assert.equal(request.currentRuntimeState, 'NOT_CONFIGURED');
    assert.ok(request.requiredVerification.length > 0);
  }
});

test('adopted historical owner remains the exact 23-family non-live projection', async () => {
  const input = await readJson('fixtures/productAssurance/systemic/observability/cases/historical-series-complete.json');
  const catalog = await readJson('fixtures/productAssurance/systemic/observability/cases/slo-catalog-complete.json');
  const output = evaluateHistoricalSeries(input, catalog);
  assert.equal(output.contractResult, 'PASS');
  assert.equal(output.expectedSeriesCount, 23);
  assert.equal(output.series.length, 23);
  assert.equal(output.liveGreenEligible, false);
  assert.equal(Object.isFrozen(output), true);
});

test('adopted inventory owner preserves exact expected and observed identity sets', async () => {
  const input = await readJson('fixtures/productAssurance/systemic/observability/cases/release-manifest-healthy.json');
  const output = evaluateReleaseBoundExpectedManifest(input);
  assert.equal(output.denominatorCount, 80);
  assert.equal(output.ids.missing.length, 0);
  assert.equal(output.ids.unexpectedObserved.length, 0);
  assert.deepEqual(output.ids.current, output.ids.expected);
  assert.equal(output.liveGreenEligible, false);
  assert.equal(Object.isFrozen(output), true);
});

test('adopted telemetry accounting owner keeps a missing tuple UNKNOWN instead of zero', async () => {
  const input = await readJson('fixtures/productAssurance/systemic/observability/cases/conservation-replay-balanced.json');
  const balanced = evaluateConservationAccounting(input);
  assert.equal(balanced.overallResult, 'PASS');
  const missing = structuredClone(input);
  missing.records.pop();
  const output = evaluateConservationAccounting(missing);
  assert.equal(output.overallResult, 'UNKNOWN');
  assert.equal(output.greenEligible, false);
  assert.equal(output.missingTupleCount, 1);
});

test('adopted stability owner keeps an unknown cost forecast null and non-actionable', () => {
  const fixture = RESOURCE_FIXTURES.find((entry) => entry.id === 'E02_UNKNOWN_FORECAST_REMAINS_NULL');
  assert.ok(fixture);
  const output = evaluateResourceEvidence(fixture.input, FIXTURE_NOW_MS);
  const row = output.rows.find((entry) => entry.resourceFamily === 'TELEMETRY_STORAGE');
  assert.ok(row);
  assert.equal(row.forecast, null);
  assert.equal(row.forecastHorizonMs, null);
  assert.equal(output.assuranceResult, 'UNKNOWN');
  assert.equal(output.mayThrottle, false);
  assert.equal(output.mayExecute, false);
  assert.deepEqual(output.commands, []);
  assert.equal(typeof row.canonicalOwner, 'string');
  assert.equal(typeof row.provenance, 'string');
  assert.equal(Number.isSafeInteger(row.observedAtMs), true);
  assert.equal(Number.isSafeInteger(row.maxAgeMs), true);
  assert.equal(Object.hasOwn(row, 'currency'), false);
  assert.equal(Object.hasOwn(row, 'unit'), false);
  const contract = contracts.contracts.find((entry) => entry.itemId === 'COST_BUDGET_PROJECTIONS');
  for (const required of [
    'canonicalOwner',
    'provenance',
    'observedAtMs',
    'maxAgeMs',
    'assessmentFreshness',
    'unknownReasons',
    'protections',
  ]) assert.ok(contract.requiredViewFields.includes(required), required);
});

test('paging fixtures keep route, delivery, acknowledgement, and resolution orthogonal', () => {
  for (const fixture of cases.pagingCases) {
    const before = structuredClone(fixture.input);
    const view = projectPagingReceiptView(fixture.input);
    assert.equal(view.pagingReceiptState, fixture.expectedPagingReceiptState, fixture.caseId);
    assert.equal(view.actionRequired, fixture.expectedActionRequired, fixture.caseId);
    assert.equal(view.incidentResolutionState, 'NOT_PROJECTED');
    assert.equal(view.packetPosture, 'SHADOW_SPECULATIVE');
    assert.equal(view.acceptanceStatus, null);
    assert.equal(view.authorityEffect, 'NONE');
    assert.equal(view.mountState, 'NOT_MOUNTED');
    assert.equal(view.truthLabel, 'SYNTHETIC_ONLY');
    assert.equal(view.greenEligible, false);
    assert.deepEqual(validateObsShadowView(view), []);
    assert.deepEqual(fixture.input, before);
    assert.equal(Object.isFrozen(view), true);
    assert.equal(Object.isFrozen(view.deliveryEvidence), true);
  }

  const retryAfterDelivery = cases.pagingCases.find(
    (fixture) => fixture.caseId === 'PAGING_DELIVERED_NOT_ACKNOWLEDGED',
  );
  const retryView = projectPagingReceiptView(retryAfterDelivery.input);
  assert.equal(retryView.deliveryEvidence.ownerVerdict, 'PROVED');
  assert.equal(retryView.pagingReceiptState, 'AWAITING_ACKNOWLEDGEMENT');
  assert.notEqual(retryView.pagingReceiptState, 'DELIVERY_UNPROVEN');
  assert.equal(retryView.evidenceBindingState, 'REFERENCE_BOUND_UNVERIFIED');
});

test('paging adapter fails closed on forged owners, lifecycle inversions, and route contradictions', () => {
  const acknowledged = cases.pagingCases.find(
    (fixture) => fixture.caseId === 'PAGING_DELIVERED_AND_ACKNOWLEDGED',
  ).input;

  const inverted = structuredClone(acknowledged);
  inverted.acknowledgementEvidence.observedAtMs = inverted.deliveryEvidence.observedAtMs - 1;
  let view = projectPagingReceiptView(inverted);
  assert.equal(view.pagingReceiptState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('PAGING_ACK_BEFORE_DELIVERY'));

  const forged = structuredClone(acknowledged);
  forged.deliveryEvidence.ownerId = 'CALLER_FORGED_OWNER';
  view = projectPagingReceiptView(forged);
  assert.equal(view.pagingReceiptState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('PAGING_DELIVERY_RECEIPT_OWNER_INVALID'));

  const acknowledgementWithoutDelivery = structuredClone(acknowledged);
  Object.assign(acknowledgementWithoutDelivery.deliveryEvidence, {
    evidenceRef: null,
    ownerVerdict: 'UNPROVEN',
    observedAtMs: null,
  });
  view = projectPagingReceiptView(acknowledgementWithoutDelivery);
  assert.equal(view.pagingReceiptState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('PAGING_ACK_WITHOUT_DELIVERY'));

  const notConfiguredWithProof = structuredClone(acknowledged);
  notConfiguredWithProof.routingState = 'NOT_CONFIGURED';
  view = projectPagingReceiptView(notConfiguredWithProof);
  assert.equal(view.pagingReceiptState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('PAGING_PROOF_FOR_NOT_CONFIGURED_ROUTE'));

  const extraField = structuredClone(acknowledged);
  extraField.providerAccepted = true;
  view = projectPagingReceiptView(extraField);
  assert.equal(view.pagingReceiptState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('PAGING_INPUT_SHAPE_INVALID'));

  const crossIncidentSplice = structuredClone(acknowledged);
  crossIncidentSplice.deliveryEvidence = structuredClone(
    cases.pagingCases.find((fixture) => fixture.caseId === 'PAGING_DELIVERED_NOT_ACKNOWLEDGED')
      .input.deliveryEvidence,
  );
  view = projectPagingReceiptView(crossIncidentSplice);
  assert.equal(view.pagingReceiptState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('PAGING_DELIVERY_RECEIPT_RECEIPT_BINDING_INVALID'));
  assert.ok(view.reasonCodes.includes('PAGING_DELIVERY_RECEIPT_INCIDENT_BINDING_INVALID'));
  assert.ok(view.reasonCodes.includes('PAGING_DELIVERY_RECEIPT_CORRELATION_BINDING_INVALID'));
  assert.ok(view.reasonCodes.includes('PAGING_ATTEMPT_BINDING_MISMATCH'));
});

test('incident drill fixtures compare recorded owner runs without claiming recovery or acceptance', () => {
  assert.equal(faultHarness.truthLabel, 'SYNTHETIC_ONLY');
  for (const fixture of cases.incidentDrillCases) {
    const run = faultHarness.runs.find((entry) => entry.runId === fixture.sourceRunRef.runId);
    assert.ok(run, fixture.caseId);
    const beforeRun = structuredClone(run);
    const beforeSpec = structuredClone(fixture.spec);
    const view = projectIncidentDrillView(run, fixture.spec);
    assert.equal(view.drillOutcomeState, fixture.expectedDrillOutcomeState, fixture.caseId);
    assert.equal(view.actionRequired, fixture.expectedActionRequired, fixture.caseId);
    assert.equal(view.sourceRunDigest, run.runDigest);
    assert.equal(view.sourceContentSha256, fixture.spec.sourceRunContentSha256);
    assert.equal(view.sourceBindingState, 'VERIFIED_PACKET_CONTENT_SHA256');
    assert.equal(view.identityBindingState, 'SHADOW_FIXTURE_ONLY');
    assert.equal(view.ownerIncidentId, null);
    assert.equal(view.ownerCorrelationId, null);
    assert.equal(view.incidentLifecycleState, 'NOT_PROJECTED');
    assert.equal(view.pagingReceiptState, 'NOT_PROJECTED');
    assert.equal(view.recoveryProofState, 'UNPROVEN');
    assert.equal(view.recoveryProofRef, null);
    assert.equal(view.greenEligible, false);
    assert.equal(view.acceptanceStatus, null);
    assert.deepEqual(validateObsShadowView(view), []);
    assert.ok(view.timeline.every((entry) => entry.occurredAtMs === null && entry.evidenceRef === null));
    assert.deepEqual(run, beforeRun);
    assert.deepEqual(fixture.spec, beforeSpec);
    assert.equal(Object.isFrozen(view), true);
    assert.equal(Object.isFrozen(view.timeline), true);
  }
});

test('incident drill adapter rejects missing fault evidence, stale content, chronology, and common-mode domains', () => {
  const fixture = cases.incidentDrillCases.find(
    (entry) => entry.caseId === 'INCIDENT_DRILL_WATCHDOG_LOSS',
  );
  const source = faultHarness.runs.find((entry) => entry.runId === fixture.sourceRunRef.runId);

  const missingFaultTransition = structuredClone(source);
  missingFaultTransition.transitionCodes = missingFaultTransition.transitionCodes
    .filter((code) => code !== 'FAULT_INJECTED');
  let view = projectIncidentDrillView(missingFaultTransition, fixture.spec);
  assert.equal(view.drillOutcomeState, 'UNKNOWN');
  assert.deepEqual(view.comparison.missingTransitionCodes, ['FAULT_INJECTED']);
  assert.ok(view.reasonCodes.includes('DRILL_REQUIRED_TRANSITION_MISSING'));
  assert.ok(view.reasonCodes.includes('DRILL_SOURCE_CONTENT_SHA256_MISMATCH'));

  const failedProof = structuredClone(source);
  failedProof.proofVerdicts.find((proof) => proof.proofId === 'LOST_DELIVERY_VISIBLE').verdict = 'FAIL';
  view = projectIncidentDrillView(failedProof, fixture.spec);
  assert.equal(view.drillOutcomeState, 'UNKNOWN');
  assert.deepEqual(view.comparison.failingProofIds, ['LOST_DELIVERY_VISIBLE']);
  assert.ok(view.reasonCodes.includes('DRILL_SOURCE_CONTENT_SHA256_MISMATCH'));

  const staleDigest = structuredClone(source);
  staleDigest.iterationsCompleted += 1;
  view = projectIncidentDrillView(staleDigest, fixture.spec);
  assert.equal(view.drillOutcomeState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('DRILL_SOURCE_CONTENT_SHA256_MISMATCH'));

  const commonMode = structuredClone(fixture.spec);
  commonMode.detectorFailureDomain = commonMode.subjectFailureDomain;
  view = projectIncidentDrillView(source, commonMode);
  assert.equal(view.drillOutcomeState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('DRILL_INDEPENDENT_FAILURE_DOMAIN_NOT_PROVEN'));

  const duplicateTransition = structuredClone(source);
  duplicateTransition.transitionCodes.push(duplicateTransition.transitionCodes[0]);
  view = projectIncidentDrillView(duplicateTransition, fixture.spec);
  assert.equal(view.drillOutcomeState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('DRILL_TRANSITIONS_INVALID'));

  const reversedTime = structuredClone(source);
  reversedTime.completedAtMs = reversedTime.startedAtMs - 1;
  view = projectIncidentDrillView(reversedTime, fixture.spec);
  assert.equal(view.drillOutcomeState, 'UNKNOWN');
  assert.ok(view.reasonCodes.includes('DRILL_SOURCE_TIME_INVALID'));

  const referencedRecovery = structuredClone(fixture.spec);
  referencedRecovery.recoveryProofRef = 'evidence:independent-recovery:unadjudicated';
  view = projectIncidentDrillView(source, referencedRecovery);
  assert.equal(view.drillOutcomeState, 'MATCH');
  assert.equal(view.recoveryProofState, 'REFERENCE_ONLY');
  assert.equal(view.actionRequired, 'OWNER_ADJUDICATION_REQUIRED');
  assert.equal(view.incidentLifecycleState, 'NOT_PROJECTED');
  assert.equal(view.greenEligible, false);
});

test('all generated views are deterministic and cannot elevate shadow posture', () => {
  for (const fixture of cases.pagingCases) {
    assert.deepEqual(projectPagingReceiptView(fixture.input), projectPagingReceiptView(fixture.input));
  }
  for (const fixture of cases.incidentDrillCases) {
    const run = faultHarness.runs.find((entry) => entry.runId === fixture.sourceRunRef.runId);
    assert.deepEqual(projectIncidentDrillView(run, fixture.spec), projectIncidentDrillView(run, fixture.spec));
  }

  const outputs = [
    ...cases.pagingCases.map((fixture) => projectPagingReceiptView(fixture.input)),
    ...cases.incidentDrillCases.map((fixture) => projectIncidentDrillView(
      faultHarness.runs.find((entry) => entry.runId === fixture.sourceRunRef.runId),
      fixture.spec,
    )),
  ];
  for (const output of outputs) {
    assert.equal(output.packetPosture, 'SHADOW_SPECULATIVE');
    assert.equal(output.acceptanceStatus, null);
    assert.equal(output.authorityEffect, 'NONE');
    assert.equal(output.mountState, 'NOT_MOUNTED');
    assert.equal(output.truthLabel, 'SYNTHETIC_ONLY');
    assert.equal(output.greenEligible, false);
    assert.equal(Object.hasOwn(output, 'machineReady'), false);
    assert.equal(Object.hasOwn(output, 'tradeReady'), false);
    assert.equal(Object.hasOwn(output, 'commands'), false);
  }

  const injectedField = structuredClone(outputs[0]);
  injectedField.liveAuthority = true;
  assert.ok(validateObsShadowView(injectedField).includes('VIEW_SHAPE_INVALID'));

  const malformedEvidence = structuredClone(outputs[0]);
  delete malformedEvidence.deliveryEvidence.evidenceDigest;
  assert.ok(validateObsShadowView(malformedEvidence).includes('VIEW_PAGING_EVIDENCE_INVALID'));

  const malformedDrill = structuredClone(outputs.at(-1));
  malformedDrill.timeline[0].unexpected = true;
  assert.ok(validateObsShadowView(malformedDrill).includes('VIEW_DRILL_TIMELINE_INVALID'));

  const falseClearPaging = structuredClone(outputs.find(
    (output) => output.pagingReceiptState === 'ACKNOWLEDGED_REFERENCE_ONLY',
  ));
  falseClearPaging.actionRequired = 'NONE';
  assert.ok(validateObsShadowView(falseClearPaging).includes('VIEW_PAGING_STATE_ACTION_INCONSISTENT'));

  const falseClearDrill = structuredClone(outputs.at(-1));
  falseClearDrill.actionRequired = 'NONE';
  assert.ok(validateObsShadowView(falseClearDrill).includes('VIEW_DRILL_STATE_ACTION_INCONSISTENT'));
});
