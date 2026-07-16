import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  A5_FAMILY_SCENARIO_IDS,
  ORACLE_IDS,
  REQUIRED_EVIDENCE_CLASSES,
  SECTION16_SCENARIOS,
} from '../../../fixtures/aiOps/a5/campaign-catalog.mjs';
import { validateOracleRegistry } from '../../../fixtures/aiOps/a5/oracles.mjs';

const EXPECTED_FAMILIES = [
  'AI_SELF_FAILURE_AI_OFF',
  'ALERT_STORM_INHIBITION_CONTEXT_CHILD_ESCAPE',
  'ATTEMPTED_MONEY_ACTION',
  'ATTEMPTED_PERMISSION_CHANGE',
  'DUPLICATE_CALLBACK',
  'DURABLE_RESTART_STALE_APPROVAL',
  'FAILED_PATCH_TEST_CANARY_ROLLBACK',
  'HOSTILE_INVESTIGATION_EFFECT_BOUNDARY',
  'INJECTION_EXFILTRATION',
  'MALFORMED_TOOL_OUTPUT',
  'MISSING_TELEMETRY',
  'NO_DATA_CANARY_UNQUALIFIED_FAILOVER',
  'PROVIDER_OUTAGE_QUOTA_COST',
  'QUEUE_DLQ_WAL_TELEMETRY_POLICY_AUDIT_SENTINEL',
  'STALE_CONFLICTING_EVIDENCE',
  'TWO_EXECUTOR_STALE_FENCING',
  'WORKFLOW_REPLAY_POLICY_SIGNATURE_CREDENTIAL_AUDIT',
];

test('catalog enumerates every directive section 16 scenario exactly once', () => {
  assert.equal(SECTION16_SCENARIOS.length, 120);
  assert.deepEqual(SECTION16_SCENARIOS.map(({ id }) => id), Array.from({ length: 120 }, (_, index) => index + 1));
  assert.equal(new Set(SECTION16_SCENARIOS.map(({ scenarioId }) => scenarioId)).size, 120);
  assert.ok(SECTION16_SCENARIOS.every(({ shadowStatus }) => shadowStatus === 'SHADOW_SPECULATIVE'));
});

test('the 17 required A5 fault families cover all 120 scenarios', () => {
  assert.deepEqual(Object.keys(A5_FAMILY_SCENARIO_IDS).sort(), EXPECTED_FAMILIES);
  for (const [family, ids] of Object.entries(A5_FAMILY_SCENARIO_IDS)) {
    assert.ok(ids.length > 0, `${family} must not be empty`);
    assert.equal(new Set(ids).size, ids.length, `${family} contains a duplicate ID`);
  }
  const union = [...new Set(Object.values(A5_FAMILY_SCENARIO_IDS).flat())].sort((left, right) => left - right);
  assert.deepEqual(union, Array.from({ length: 120 }, (_, index) => index + 1));
  assert.ok(SECTION16_SCENARIOS.every(({ faultFamilies }) => faultFamilies.length > 0));
});

test('every declared oracle has an executable implementation', () => {
  assert.equal(validateOracleRegistry(), true);
  assert.equal(new Set(ORACLE_IDS).size, ORACLE_IDS.length);
  assert.ok(SECTION16_SCENARIOS.every(({ oracleIds }) => oracleIds.includes('O-DETERMINISM')
    && oracleIds.includes('O-HONEST-LABEL')
    && oracleIds.includes('O-SCENARIO-SEMANTICS')));
  assert.ok(SECTION16_SCENARIOS.filter(({ expectedDisposition }) => expectedDisposition === 'HARD_DENIED')
    .every(({ oracleIds }) => oracleIds.includes('O-HARD-DENIAL')));
});

test('evidence tiers state what shadow proves and what the port must still prove', () => {
  assert.deepEqual(REQUIRED_EVIDENCE_CLASSES, [
    'CONTRACT',
    'INTEGRATION',
    'RESTART',
    'FAULT_INJECTION',
    'REPLAY',
    'BROWSER',
    'SECURITY',
    'BUDGET',
    'CANARY',
    'INDEPENDENT_READBACK',
  ]);
  for (const scenario of SECTION16_SCENARIOS) {
    assert.ok(scenario.evidenceClasses.provided.includes('SYNTHETIC_FIXTURE'));
    assert.ok(scenario.evidenceClasses.provided.includes('FAULT_INJECTION'));
    assert.ok(scenario.evidenceClasses.postPortRequired.includes('CONTRACT'));
    assert.ok(scenario.evidenceClasses.postPortRequired.includes('INTEGRATION'));
    assert.ok(scenario.evidenceClasses.postPortRequired.includes('INDEPENDENT_READBACK'));
  }
});

test('typed insertion requests preserve all advisory seams without creating authority', async () => {
  const rows = JSON.parse(await readFile(new URL('../../../fixtures/aiOps/a5/INSERTION_REQUEST_ROWS.DRAFT.v1.json', import.meta.url), 'utf8'));
  assert.equal(rows.length, 21);
  const expectedIds = [
    'AIOPS-IR-COMPOSITION-001', 'AIOPS-IR-PERSISTENCE-003', 'AIOPS-IR-AUTH-004',
    'AIOPS-IR-PACKAGE-006', 'AIOPS-IR-DEPLOYMENT-007', 'AIOPS-IR-CONTROLS-008',
    'AIOPS-IR-EVENTS-009', 'AIOPS-IR-REMEDIATION-010', 'AIOPS-IR-ASSURANCE-011',
    'AIOPS-IR-TELEMETRY-012', 'AIOPS-IR-REFRESH-013', 'AIOPS-IR-NOTIFY-014',
    'AIOPS-IR-EGRESS-016', 'AIOPS-IR-INCIDENT-019', 'AIOPS-IR-SENTINEL-020',
    'AIOPS-IR-AUDIT-021', 'AIOPS-IR-MANAGED-INVENTORY-022', 'AIOPS-IR-APPROVAL-023',
    'AIOPS-IR-BROWSER-PROBE-024', 'AIOPS-IR-CONFIG-025', 'AIOPS-IR-TEST-MOUNT-026',
  ];
  assert.deepEqual(rows.map(({ rowId }) => rowId), expectedIds);
  const keys = ['authorityCreated', 'contract', 'expectedBehavior', 'reason', 'requestedOwner', 'rowId', 'schema', 'status', 'targetSeam', 'tests', 'version', 'wiringState'];
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), keys);
    assert.equal(row.schema, 'InsertionRequestRowV1');
    assert.equal(row.version, 1);
    assert.equal(row.status, 'DRAFT');
    assert.equal(row.authorityCreated, false);
    assert.equal(row.wiringState, `PENDING_BACKEND:${row.rowId}`);
    assert.ok(row.contract.length > 0 && row.tests.length > 0 && row.expectedBehavior.length > 0);
  }
});

test('landed-interface audit resolves owners and keeps missing seams non-authoritative', async () => {
  const packet = JSON.parse(await readFile(new URL('../../../fixtures/aiOps/a5/interface-assumptions.v1.json', import.meta.url), 'utf8'));
  assert.equal(packet.shadowStatus, 'SHADOW_SPECULATIVE');
  assert.equal(packet.targetBaseSha, '492e3f69b054c85686bcfc4c09dbff4ababeda3f');
  assert.equal(packet.bindingState, 'LANDED_TREE_AUDITED_NO_AUTHORITY');
  assert.ok(packet.assumptions.length >= 13);
  assert.ok(packet.assumptions.every(({ authorityCreated }) => authorityCreated === false));
  assert.ok(packet.assumptions.some(({ objectType, state }) => objectType === 'TestMount' && state === 'ROOT_SCRIPT_MOUNT_ABSENT'));
  assert.ok(packet.assumptions.some(({ objectType, state }) => objectType === 'EvidenceBoundary' && state === 'SYNTHETIC_ONLY_WITH_LANDED_OWNER_CONFORMANCE'));
  assert.ok(packet.assumptions.some(({ objectType, state }) => objectType === 'OperationalFailureAtlas' && state === 'VERIFIED_PRESENT_DEDUPED'));
});
