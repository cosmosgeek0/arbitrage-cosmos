import assert from 'node:assert/strict';
import test from 'node:test';

import { loadContracts } from './_network-denied-env.mjs';

const contracts = await loadContracts();

test('the mechanical registry projection contains exactly AI_OPS A01 through L10', () => {
  assert.deepEqual(contracts.validateControlInsertionRequests(), []);
  const expected = [];
  for (const category of 'ABCDEFGHIJKL') {
    for (let index = 1; index <= 10; index += 1) expected.push(`AI_OPS.${category}${String(index).padStart(2, '0')}`);
  }
  assert.deepEqual(contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.map((row) => row.controlId), expected);
  for (const row of contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS) {
    assert.equal(row.recordKind, 'INSERTION_REQUEST');
    assert.equal(row.currentStatus, 'NOT_WIRED');
    assert.equal(row.effectHandler, null);
    assert.equal(row.readbackHandler, null);
    assert.equal(row.effectiveState, 'DISABLED');
    assert.equal(row.authorityCreated, false);
    assert.deepEqual(row.hardDenialIds, contracts.AI_OPS_HARD_DENIAL_IDS);
  }
});

test('permanent locks have internally consistent safe defaults', () => {
  const locked = contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.filter((row) => row.permanentlyLocked);
  assert.ok(locked.length >= 8);
  for (const row of locked) {
    assert.ok(row.allowedValues.some((value) => JSON.stringify(value) === JSON.stringify(row.safeDefault)), row.controlId);
  }
  assert.equal(contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.find((row) => row.controlId === 'AI_OPS.E02').safeDefault, false);
  assert.equal(contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.find((row) => row.controlId === 'AI_OPS.F09').safeDefault, true);
  assert.equal(contracts.AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.find((row) => row.controlId === 'AI_OPS.L10').safeDefault, true);
});

test('provisional control change sets are atomic no-effect decisions', () => {
  const decision = contracts.evaluateProvisionalControlChangeSet({
    schema: 'AI_OPS_CONTROL_CHANGE_SET_INSERTION_REQUEST_V1',
    expectedRegistryRevision: 12,
    changes: [
      { controlId: 'AI_OPS.A01', requestedValue: true },
      { controlId: 'AI_OPS.E02', requestedValue: true },
      { controlId: 'AI_OPS.UNKNOWN', requestedValue: true },
    ],
    ownerSignatureReference: 'synthetic-signature-ref://unverified',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.appliedCount, 0);
  assert.ok(decision.reasonCodes.includes('PERMANENT_LOCK:AI_OPS.E02'));
  assert.ok(decision.reasonCodes.includes('CONTROL_UNKNOWN_REDACTED'));
  assert.ok(decision.reasonCodes.includes('SHADOW_SPECULATIVE_CANNOT_APPLY_CONTROLS'));
});

test('control change-set boundary rejects accessors and secret-shaped identifiers without echo', () => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({
    schema: 'AI_OPS_CONTROL_CHANGE_SET_INSERTION_REQUEST_V1',
    expectedRegistryRevision: 0,
    changes: [],
    ownerSignatureReference: null,
  }, 'changes', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return [];
    },
  });
  const accessorDecision = contracts.evaluateProvisionalControlChangeSet(accessor);
  assert.ok(accessorDecision.reasonCodes.includes('CONTROL_CHANGE_SET_SCHEMA_INVALID'));
  assert.equal(getterCalls, 0);
  const secret = 'sk-proj-1234567890abcdef';
  const secretDecision = contracts.evaluateProvisionalControlChangeSet({
    schema: 'AI_OPS_CONTROL_CHANGE_SET_INSERTION_REQUEST_V1',
    expectedRegistryRevision: 0,
    changes: [{ controlId: secret, requestedValue: true }],
    ownerSignatureReference: null,
  });
  assert.ok(secretDecision.reasonCodes.includes('CONTROL_CHANGE_SET_SCHEMA_INVALID'));
  assert.equal(JSON.stringify(secretDecision).includes(secret), false);
});

test('shared needs remain typed S6-compatible draft insertion requests', () => {
  assert.deepEqual(contracts.validateInsertionRequests(), []);
  const expectedIds = [
    'AIOPS-IR-PERSISTENCE-003', 'AIOPS-IR-AUTH-004', 'AIOPS-IR-PACKAGE-006',
    'AIOPS-IR-CONTROLS-008', 'AIOPS-IR-REMEDIATION-010', 'AIOPS-IR-ASSURANCE-011',
    'AIOPS-IR-DOCS-017', 'AIOPS-IR-BARREL-018', 'AIOPS-IR-INCIDENT-019',
    'AIOPS-IR-AUDIT-021', 'AIOPS-IR-APPROVAL-023', 'AIOPS-IR-CONFIG-025',
    'AIOPS-IR-TEST-MOUNT-026',
  ];
  assert.deepEqual(contracts.AI_OPS_INSERTION_REQUESTS.map((row) => row.rowId), expectedIds);
  for (const row of contracts.AI_OPS_INSERTION_REQUESTS) {
    assert.deepEqual(Object.keys(row).sort(), ['authorityCreated', 'contract', 'expectedBehavior', 'reason', 'requestedOwner', 'rowId', 'schema', 'status', 'targetSeam', 'tests', 'version', 'wiringState'].sort());
    assert.equal(row.schema, 'InsertionRequestRowV1');
    assert.equal(row.status, 'DRAFT');
    assert.match(row.wiringState, /^PENDING_BACKEND:/);
    assert.equal(row.authorityCreated, false);
  }
});

test('every unfinished interface names a real insertion request and no acceptance state', () => {
  const requestIds = new Set(contracts.AI_OPS_INSERTION_REQUESTS.map((row) => row.rowId));
  assert.ok(contracts.AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES.length >= 8);
  for (const dependency of contracts.AI_OPS_UNFINISHED_INTERFACE_DEPENDENCIES) {
    assert.notEqual(dependency.currentState, 'READY');
    assert.notEqual(dependency.currentState, 'ACCEPTED');
    assert.ok(dependency.insertionRequestIds.length > 0);
    for (const id of dependency.insertionRequestIds) assert.ok(requestIds.has(id), `${dependency.dependencyId}:${id}`);
  }
});
