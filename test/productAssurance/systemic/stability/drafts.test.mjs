import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CANCELLATION_LATE_RESULT_LAW,
  REPAIR_LATE_RESULT_LAW,
  REPAIR_RESTART_BEHAVIOR,
  RESOURCE_FAMILIES,
  STABILITY_SCHEMA_VERSION,
} from '../../../../fixtures/productAssurance/systemic/stability/contracts.mjs';
import {
  ASSURANCE_INSERTION_REQUEST_DRAFT_ROWS,
  AUTONOMY_CLOSURE_REPORT_DRAFT_ROWS,
  RELIABILITY_POLICY_REGISTRY_DRAFT_ROWS,
  RESOURCE_AND_BACKPRESSURE_REPORT_DRAFT_ROWS,
} from '../../../../fixtures/productAssurance/systemic/stability/drafts/rows.mjs';

const fanInRequired = [
  'schemaVersion', 'draftState', 'evidenceState', 'canonicalTarget',
  'runtimeOwner', 'proposedRuntimeOwner', 'runtimeOwnerConfirmationStatus',
  'runtimePath', 'runtimePathConfirmationStatus', 'insertionSha',
  'insertionShaStatus', 'ipProofScenarioIds', 'configurationState',
  'capabilityStatus', 'supersessionDisposition',
];

function assertFanInMetadata(row, id) {
  for (const field of fanInRequired) assert.ok(Object.hasOwn(row, field), `${id}:${field}`);
  assert.equal(row.schemaVersion, STABILITY_SCHEMA_VERSION);
  assert.equal(row.draftState, 'DRAFT_INSERTION_REQUEST');
  assert.equal(row.evidenceState, 'SYNTHETIC_ONLY');
  assert.equal(row.runtimeOwner, null);
  assert.equal(row.runtimePath, null);
  assert.equal(row.insertionSha, null);
  assert.equal(row.runtimeOwnerConfirmationStatus, 'OWNER_CONFIRMATION_REQUIRED');
  assert.equal(row.runtimePathConfirmationStatus, 'OWNER_CONFIRMATION_REQUIRED');
  assert.ok(row.insertionShaStatus.includes('PENDING'));
  assert.ok(Array.isArray(row.ipProofScenarioIds));
  assert.ok(row.ipProofScenarioIds.length > 0);
}

function assertNoAuthority(authority, id) {
  for (const field of ['mayCloseCircuit', 'mayResetCircuit', 'mayThrottle', 'mayShed', 'mayExecute']) {
    assert.equal(authority[field], false, `${id}:${field}`);
  }
}

test('reliability registry drafts contain four abstract S8 laws without pre-registering operations', () => {
  assert.deepEqual(RELIABILITY_POLICY_REGISTRY_DRAFT_ROWS.map((row) => row.draftRowId), [
    'draft.s8.bounded-request-tree',
    'draft.s8.long-lived-lease-heartbeat-fence',
    'draft.s8.external-mutation-cancel-intent-and-late-truth',
    'draft.s8.automatic-local-repair-control-loop',
  ]);
  for (const row of RELIABILITY_POLICY_REGISTRY_DRAFT_ROWS) {
    assertFanInMetadata(row, row.draftRowId);
    assert.equal(row.stableOperationId, null);
    assert.equal(row.operationClass, null);
    assert.equal(row.registeredCommandIdentity, null);
    assert.equal(row.canonicalOwner, null);
    assert.equal(row.implementationPath, null);
    assert.equal(row.executionAuthority, 'NONE_IN_IP_ASSURANCE');
    assertNoAuthority(row.authority, row.draftRowId);
  }
  assert.ok(RELIABILITY_POLICY_REGISTRY_DRAFT_ROWS.slice(0, 3).every((row) => row.lateResultLaw === CANCELLATION_LATE_RESULT_LAW));
  const repair = RELIABILITY_POLICY_REGISTRY_DRAFT_ROWS[3];
  assert.equal(repair.lateResultLaw, REPAIR_LATE_RESULT_LAW);
  assert.equal(repair.restartBehavior, REPAIR_RESTART_BEHAVIOR);
});

test('automatic repair row points to the strict fixture contract while production mapping remains unresolved', () => {
  const row = RELIABILITY_POLICY_REGISTRY_DRAFT_ROWS.find((entry) => entry.draftRowId === 'draft.s8.automatic-local-repair-control-loop');
  assert.ok(row);
  assert.equal(row.s8ExtensionSchemaId, 'ip-assurance.s8.repair-policy-extension');
  assert.match(row.fixtureContractRef, /makeRepairPolicy/);
  assert.deepEqual(row.repairContractMapping, {
    policyId: null,
    operationPolicyId: null,
    operationClass: null,
    registeredCommandIdentity: null,
    registeredFencingOwner: null,
    fencingOwnerEvidenceRef: null,
    canonicalOwner: null,
    implementationPath: null,
    confirmationStatus: 'OWNER_CONFIRMATION_REQUIRED',
  });
});

test('resource drafts cover exactly eight families with read-only circuit placeholders', () => {
  assert.deepEqual(RESOURCE_AND_BACKPRESSURE_REPORT_DRAFT_ROWS.map((row) => row.resourceFamily), RESOURCE_FAMILIES);
  for (const row of RESOURCE_AND_BACKPRESSURE_REPORT_DRAFT_ROWS) {
    assertFanInMetadata(row, row.rowId);
    assert.equal(row.canonicalOwner, null);
    assert.equal(row.controllerOwner, null);
    assert.equal(row.circuitEvidenceDraft.readOnly, true);
    assert.equal(row.circuitEvidenceDraft.currentBurn, null);
    assert.equal(row.circuitEvidenceDraft.forecast, null);
    assert.equal(row.circuitEvidenceDraft.state, 'UNKNOWN');
    assert.equal(row.circuitEvidenceDraft.canonicalOwner, null);
    assert.equal(row.circuitEvidenceDraft.observedAtMs, null);
    assert.equal(row.circuitEvidenceDraft.baselineNeverOpenedEvidenceRef, null);
    assert.equal(row.circuitEvidenceDraft.baselineEvidenceOwner, null);
    assert.equal(row.circuitEvidenceDraft.baselineEvidenceFailureDomain, null);
    assert.equal(row.circuitEvidenceDraft.independentCloseEvidenceRef, null);
    assert.equal(row.circuitEvidenceDraft.independentCloseOwner, null);
    assert.equal(row.circuitEvidenceDraft.independentCloseFailureDomain, null);
    assert.equal(row.circuitEvidenceDraft.throttling.observedAtMs, null);
    assert.equal(row.circuitEvidenceDraft.throttling.maxAgeMs, null);
    assert.ok(row.requiredEvidence.some((entry) => entry.includes('circuit posture')));
    assert.match(row.cockpitProjection, /circuit posture\/freshness\/independent-close evidence/);
    assert.match(row.circuitEvidenceDraft.unknownReason, /RUNTIME_EVIDENCE_NOT_SUPPLIED/);
    assertNoAuthority(row.authority, row.rowId);
    assert.equal(row.authority.mayDiscardMaterialMoneyEvidence, false);
    assert.equal(row.authority.mayDiscardAuditEvidence, false);
    assert.equal(row.authority.mayBlockIndependentlySafeRiskReduction, false);
  }
});

test('autonomy closure rows remain owner-gated evidence with no action authority', () => {
  assert.equal(AUTONOMY_CLOSURE_REPORT_DRAFT_ROWS.length, 5);
  for (const row of AUTONOMY_CLOSURE_REPORT_DRAFT_ROWS) {
    assertFanInMetadata(row, row.rowId);
    for (const field of ['rowId', 'layer', 'limit', 'failurePosture', 'ownerOverride', 'fixtureIds']) assert.ok(Object.hasOwn(row, field), `${row.rowId}:${field}`);
    assert.equal(row.authorityOwner, null);
    assertNoAuthority(row.authority, row.rowId);
  }
});

test('seven insertion requests carry owner/path/SHA/scenario fan-in fields', () => {
  assert.deepEqual(ASSURANCE_INSERTION_REQUEST_DRAFT_ROWS.map((row) => row.requestId), [
    'S8-IR-01', 'S8-IR-02', 'S8-IR-03', 'S8-IR-04', 'S8-IR-05', 'S8-IR-06', 'S8-IR-07',
  ]);
  for (const row of ASSURANCE_INSERTION_REQUEST_DRAFT_ROWS) {
    assertFanInMetadata(row, row.requestId);
    for (const field of ['owner', 'proposedOwner', 'targetSeam', 'reason', 'contract', 'tests', 'expectedBehavior']) assert.ok(Object.hasOwn(row, field), `${row.requestId}:${field}`);
    assert.equal(row.owner, null);
    assertNoAuthority(row.authority, row.requestId);
  }
});

test('draft artifacts never claim integration, deployment, live proof, or I00 acceptance', () => {
  const serialized = JSON.stringify({
    RELIABILITY_POLICY_REGISTRY_DRAFT_ROWS,
    RESOURCE_AND_BACKPRESSURE_REPORT_DRAFT_ROWS,
    AUTONOMY_CLOSURE_REPORT_DRAFT_ROWS,
    ASSURANCE_INSERTION_REQUEST_DRAFT_ROWS,
  });
  for (const forbiddenClaim of ['"integrationStatus":"INTEGRATED"', 'DEPLOYED_PROVED', 'LIVE_OBSERVED', 'I00_ACCEPTED']) {
    assert.equal(serialized.includes(forbiddenClaim), false, forbiddenClaim);
  }
});

test('human-readable index repeats draft, null-unknown, fan-in, and no-authority boundaries', () => {
  const source = readFileSync('fixtures/productAssurance/systemic/stability/drafts/DRAFT_INSERTION_ROWS.md', 'utf8');
  assert.match(source, /DRAFT_INSERTION_REQUEST/);
  assert.match(source, /SYNTHETIC_ONLY/);
  assert.match(source, /insertion SHA/);
  assert.match(source, /IP-PROOF scenario IDs/);
  assert.match(source, /no close, reset, throttle, shed, or execute authority/);
  assert.match(source, /Unknown values[\s\S]*`null`/);
});
