import assert from 'node:assert/strict';
import test from 'node:test';

import {
  drillDocument,
  entryGateDocument,
  insertionRequestDocument,
  readJson,
  readText,
} from './lib/constants.mjs';

function forbiddenClaimPaths(value, trail = '$') {
  if (Array.isArray(value)) return value.flatMap((child, index) => forbiddenClaimPaths(child, `${trail}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(['acceptanceStatus', 'candidateReady', 'productionReady'].includes(key) ? [`${trail}.${key}`] : []),
    ...forbiddenClaimPaths(child, `${trail}.${key}`),
  ]);
}

function canonicalSurfaceFields(source, surfaceId) {
  const markers = [`${surfaceId}: [`, `'${surfaceId}': [`];
  const marker = markers.find((candidate) => source.includes(candidate));
  assert(marker, `canonical surface ${surfaceId} is missing`);
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf(']', start);
  assert(end > start, `canonical surface ${surfaceId} is malformed`);
  return new Set([...source.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

const CANONICAL_SOURCE_FIELDS = Object.freeze({
  'SystemSupervisorReadModel@1': new Set([
    'components[public-spot-source].readiness',
    'components[public-spot-source].freshness',
    'components[public-spot-source].blockerCodes',
    'components[].sourceTimestamp',
    'components[].freshness',
    'components[].truthLabel',
    'summaries.reconciliation.blocksNewExposure',
    'firstRootBlockerComponentId',
    'attentionQueue',
  ]),
  'RestartBarrierProjection+SystemSupervisorReadModel@1': new Set([
    'restartBarrier.canOpenOrIncrease',
    'restartBarrier.supervisionContinues',
    'restartBarrier.reasonCodes',
    'restartBarrier.reconciliationRequiredPlanIds',
    'control.generation',
  ]),
  'ProductRuntimeSupervisorEnvelope@1': new Set([
    'managedInventory.entries[identity=external-watchdog].inventoryState',
    'managedInventory.entries[identity=external-watchdog].reasonCode',
    'managedInventory.entries[identity=notification-incident-router].inventoryState',
    'managedInventory.entries[identity=backup-restore].inventoryState',
    'managedInventory.entries[identity=backup-restore].reasonCode',
    'opsReadback.deploymentFrozen',
    'opsReadback.exposureState',
    'opsReadback.ambiguityState',
    'opsReadback.recoveryState',
    'opsReadback.currentSchemaVersion',
    'opsReadback.rollbackFloor',
    'dashboard.attentionQueue',
    'dashboard.traceIndex',
    'dashboard.summaries.ledger',
  ]),
  'SystemSupervisorReadModel.summaries.reconciliation@1': new Set([
    'summaries.reconciliation.status',
    'summaries.reconciliation.blocksNewExposure',
    'summaries.reconciliation.recommendation',
    'summaries.reconciliation.reasonCodes',
    'components[reconciliation].capitalExposed',
  ]),
  'SystemSupervisorReadModel.control@1': new Set([
    'control.killSwitchEngaged',
    'control.intakePaused',
    'control.safeMode',
    'summaries.execution.barrier',
    'attentionQueue',
  ]),
});

test('all render-neutral cockpit contracts preserve the port synthetic boundary', () => {
  const document = drillDocument();
  const requests = insertionRequestDocument();
  const i00 = readJson('fixtures/i00/scenarios.json');
  const scenarioTerminal = new Map(i00.scenarios.map((scenario) => [scenario.id, scenario.expectedTerminal]));
  const requestIds = new Set(requests.map((request) => request.rowId));
  const projectionSource = readText('server/src/productIntegration/runtime/projection.ts');

  assert.equal(document.drills.length, 8);
  assert.equal(new Set(document.drills.map((drill) => drill.id)).size, 8);
  for (const drill of document.drills) {
    const contract = drill.projectionContract;
    assert.equal(drill.classification, 'ADAPT_EXISTING');
    assert.deepEqual(drill.expectedTerminals, drill.scenarioIds.map((id) => scenarioTerminal.get(id)));
    assert.equal(contract.packetDisposition, 'POST_LANDING_PORT_PRESTAGE');
    assert.equal(contract.truthLabel, 'SYNTHETIC_ONLY');
    assert.equal(contract.authority, 'SYNTHETIC_TEST');
    assert.equal(contract.integrationState, 'DIRECTOR_MOUNT_REQUIRED');
    assert(contract.canonicalOwner.length > 0);
    assert(contract.projectionOwner.length > 0);
    assert.equal(contract.mountOwner, 'PRODUCT_INTEGRATION');
    assert(contract.targetSchema.length > 0);
    assert(contract.sourceFieldPaths.length > 0);
    assert(contract.surfaceBindings.length > 0);
    for (const binding of contract.surfaceBindings) {
      assert(canonicalSurfaceFields(projectionSource, binding.surfaceId).has(binding.fieldId), `${binding.surfaceId}.${binding.fieldId}`);
    }
    const allowedFields = CANONICAL_SOURCE_FIELDS[contract.targetSchema];
    assert(allowedFields, contract.targetSchema);
    assert(contract.sourceFieldPaths.every((fieldPath) => allowedFields.has(fieldPath)), contract.targetSchema);
    assert(contract.insertionRequestIds.every((id) => requestIds.has(id)));
  }
});

test('insertion requests conform to the landed AIOPS-IR row schema and create no authority', () => {
  const requests = insertionRequestDocument();
  const schemaDocument = readJson('fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json');
  const rowSchema = schemaDocument.$defs.InsertionRequestRowV1;
  const requiredFields = [...rowSchema.required].sort();
  const expectedIds = [
    'AIOPS-IR-PERSISTENCE-003',
    'AIOPS-IR-COCKPIT-015',
    'AIOPS-IR-TEST-MOUNT-026',
  ];

  assert.equal(rowSchema.additionalProperties, false);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map((request) => request.rowId), expectedIds);
  assert.equal(new Set(requests.map((request) => request.rowId)).size, requests.length);
  for (const request of requests) {
    assert.deepEqual(Object.keys(request).sort(), requiredFields);
    assert.equal(request.schema, 'InsertionRequestRowV1');
    assert.equal(request.version, 1);
    assert.match(request.rowId, /^[A-Za-z0-9_.:/-]{1,160}$/);
    assert.equal(request.status, 'DRAFT');
    assert.equal(typeof request.requestedOwner, 'string');
    assert(request.requestedOwner.length > 0 && request.requestedOwner.length <= 512);
    assert.equal(typeof request.targetSeam, 'string');
    assert(request.targetSeam.length > 0 && request.targetSeam.length <= 512);
    assert.equal(typeof request.reason, 'string');
    assert(request.reason.length > 0 && request.reason.length <= 512);
    for (const field of ['contract', 'tests', 'expectedBehavior']) {
      assert(request[field].length > 0 && request[field].length <= 64);
      assert.equal(new Set(request[field]).size, request[field].length);
      assert(request[field].every((value) => typeof value === 'string' && value.length > 0 && value.length <= 512));
    }
    assert.equal(request.wiringState, `PENDING_BACKEND:${request.rowId}`);
    assert.equal(request.authorityCreated, false);
    assert.equal(Object.hasOwn(request, 'controlDraft'), false);
  }
  assert.deepEqual(new Set(requests.map((request) => request.requestedOwner)), new Set([
    'LEDGER',
    'PRODUCT_CONTROL_ROOM',
    'ROOT_TEST_ACCEPTANCE_OWNER',
  ]));
});

test('packet manifests contain no acceptance or readiness status keys', () => {
  assert.deepEqual(forbiddenClaimPaths(drillDocument()), []);
  assert.deepEqual(forbiddenClaimPaths(entryGateDocument()), []);
  assert.deepEqual(forbiddenClaimPaths(insertionRequestDocument()), []);
});
