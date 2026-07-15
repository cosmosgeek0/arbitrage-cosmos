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

test('all render-neutral cockpit contracts preserve the speculative synthetic boundary', () => {
  const document = drillDocument();
  const requests = insertionRequestDocument();
  const i00 = readJson('fixtures/i00/scenarios.json');
  const scenarioTerminal = new Map(i00.scenarios.map((scenario) => [scenario.id, scenario.expectedTerminal]));
  const requestIds = new Set(requests.requests.map((request) => request.id));
  const projectionSource = readText('server/src/productIntegration/runtime/projection.ts');

  assert.equal(document.drills.length, 8);
  assert.equal(new Set(document.drills.map((drill) => drill.id)).size, 8);
  for (const drill of document.drills) {
    const contract = drill.projectionContract;
    assert.equal(drill.classification, 'ADAPT_EXISTING');
    assert.deepEqual(drill.expectedTerminals, drill.scenarioIds.map((id) => scenarioTerminal.get(id)));
    assert.equal(contract.packetDisposition, 'SHADOW_SPECULATIVE');
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

test('insertion requests create no authority and require director adjudication', () => {
  const requests = insertionRequestDocument().requests;
  assert.equal(requests.length, 5);
  assert.equal(new Set(requests.map((request) => request.id)).size, 5);
  for (const request of requests) {
    assert.equal(request.state, 'DIRECTOR_ADJUDICATION_REQUIRED');
    assert.equal(request.authorityCreated, false);
    assert(request.prerequisites.includes('DIRECTOR_ADJUDICATION'));
  }
  const c2 = requests.find((request) => request.id === 'RUN19-IR-01-C2-REBIND');
  assert(c2.prerequisites.includes('EXACT_C2_COMMIT_SELECTED'));
  assert.equal(c2.target, 'exact director-selected C2 commit');
});

test('packet manifests contain no acceptance or readiness status keys', () => {
  assert.deepEqual(forbiddenClaimPaths(drillDocument()), []);
  assert.deepEqual(forbiddenClaimPaths(entryGateDocument()), []);
  assert.deepEqual(forbiddenClaimPaths(insertionRequestDocument()), []);
});
