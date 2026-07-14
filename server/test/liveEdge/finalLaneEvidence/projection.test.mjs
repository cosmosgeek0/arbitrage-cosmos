import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FINAL_LANE_EVIDENCE_SCHEMA,
  FINAL_LANE_SUBJECTS,
  projectFinalLaneEvidence,
  validateFinalLaneEvidenceSnapshot,
} from '../../../dist/liveEdge/adapters/finalLaneEvidence/index.js';
import { completeInput } from './fixtures.mjs';

function assertDeeplyFrozen(value) {
  const pending = [value];
  const seen = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    assert.equal(Object.isFrozen(current), true);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(current))) {
      if (Object.hasOwn(descriptor, 'value')) pending.push(descriptor.value);
    }
  }
}

test('projects exact local gate evidence without minting lane or production readiness', () => {
  const input = completeInput();
  const snapshot = projectFinalLaneEvidence(input);

  assert.equal(snapshot.schema, FINAL_LANE_EVIDENCE_SCHEMA);
  assert.equal(snapshot.version, 1);
  assert.match(snapshot.snapshotRevision, /^l17_[a-f0-9]{32}$/);
  assert.equal(snapshot.implementationRevision, input.implementationRevision);
  assert.deepEqual(snapshot.evidence.map(({ subject }) => subject), FINAL_LANE_SUBJECTS);
  assert.equal(snapshot.evidenceDisposition, 'LOCAL_GATE_EVIDENCE_COMPLETE');
  assert.equal(snapshot.acceptanceState, 'PENDING_IMMUTABLE_RECEIPT_ACCEPTANCE');
  assert.equal(snapshot.evidenceTrust, 'INJECTED_UNATTESTED');
  assert.equal(snapshot.measurementAuthority, 'INJECTED_RECORD_ONLY');
  assert.equal(snapshot.laneApplicability, 'L_LANE_LOCAL_ONLY');
  assert.equal(snapshot.releaseState, 'SYNTHETIC_ONLY');
  assert.equal(snapshot.integrationState, 'UNWIRED');
  assert.equal(snapshot.combinedChainState, 'DEFERRED_TO_I00');
  assert.equal(snapshot.injectedLocalGateEvidenceComplete, true);
  assert.equal(snapshot.cryptographicAttestation, false);
  assert.equal(snapshot.gateExecutionObservedByAdapter, false);
  for (const key of [
    'externalCalls', 'filesystemAccess', 'gitAccess', 'environmentAccess',
    'sendEligible', 'combinedAcceptance', 'integratedProof', 'deployedProof',
    'livePublicProof', 'livePrivateProof', 'tradeReadyProof',
    'productionReadinessProof', 'laneReadyProof', 'moneyMutationProof',
  ]) assert.equal(snapshot[key], false, key);
  assert.equal(snapshot.credentialAccess, 'NONE');
  assert.equal(snapshot.runnerAuthority, 'NONE');
  assert.equal(snapshot.controlAuthority, 'NONE');
  assert.equal(snapshot.deploymentAuthority, 'NONE');
  assert.equal(snapshot.restartAuthority, 'NONE');
  assert.equal(snapshot.readinessAuthority, 'NONE');
  assert.equal(snapshot.actionAuthority, 'NONE');
  assert.equal(snapshot.liveExecution, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
  assert.equal(Object.hasOwn(snapshot, 'l12Snapshot'), false);
  assert.equal(Object.hasOwn(snapshot, 'l13Snapshot'), false);
  assert.equal(Object.hasOwn(snapshot, 'l16Snapshot'), false);
  assertDeeplyFrozen(snapshot);
});

test('is deterministic, detached, non-mutating and validates only exact reproduction', () => {
  const input = completeInput();
  const before = structuredClone(input);
  const first = projectFinalLaneEvidence(input);
  const second = projectFinalLaneEvidence(structuredClone(input));

  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.deepEqual(
    validateFinalLaneEvidenceSnapshot(
      first,
      input.l12Snapshot,
      input.l13Snapshot,
      input.l16Snapshot,
    ),
    first,
  );
  input.commands[0].assertions += 1;
  assert.notEqual(input.commands[0].assertions, first.commands[0].assertions);

  const forged = structuredClone(first);
  forged.laneReadyProof = true;
  assert.throws(
    () => validateFinalLaneEvidenceSnapshot(
      forged,
      before.l12Snapshot,
      before.l13Snapshot,
      before.l16Snapshot,
    ),
    /not reproducible/,
  );
});

test('snapshot revision binds implementation, measured scope and command timing', () => {
  const first = projectFinalLaneEvidence(completeInput());
  const revision = projectFinalLaneEvidence(completeInput({
    implementationRevision: '3'.repeat(40),
  }));
  const scope = projectFinalLaneEvidence(completeInput({ workerCommitCount: 9 }));
  const commandInput = completeInput();
  commandInput.commands[0].verifiedAtMs -= 1;
  const command = projectFinalLaneEvidence(commandInput);

  assert.notEqual(revision.snapshotRevision, first.snapshotRevision);
  assert.notEqual(scope.snapshotRevision, first.snapshotRevision);
  assert.notEqual(command.snapshotRevision, first.snapshotRevision);
});

test('emits the exact closed classification map and no caller-authored class seam', () => {
  const snapshot = projectFinalLaneEvidence(completeInput());
  assert.deepEqual(
    Object.fromEntries(snapshot.evidence.map(({ subject, classification }) => [subject, classification])),
    {
      PROTOCOL_CONFORMANCE: 'UNPROVEN',
      SECURITY_BOUNDARY: 'UNPROVEN',
      SYNTHETIC_FAULT_REPLAY: 'SYNTHETIC_REPLAY',
      SERVICE_RESTART: 'OWNER_GATED',
      ROLLBACK: 'NOT_PERFORMED',
      BACKUP_RESTORE: 'NOT_PERFORMED',
      CANARY_PREFLIGHT: 'NOT_PERFORMED',
      REAL_CANARY: 'NOT_PERFORMED',
      AWS_CLOUDFLARE_DEPLOYMENT: 'UNPROVEN',
      PUBLIC_RUNTIME_OBSERVATION: 'NOT_PERFORMED',
      PRIVATE_ACCOUNT_RECONCILIATION: 'OWNER_GATED',
      SIGNED_TEST_ORDERS: 'PROHIBITED',
      MARGIN_BORROW_REPAY: 'PROHIBITED',
      LIVE_EXECUTION: 'PROHIBITED',
      L15_DEPLOYMENT_SATELLITE: 'ACCEPTED_SATELLITE',
      LANE_RUNTIME_WIRING: 'UNWIRED',
      Q_L_COMBINED_CHAIN: 'DEFERRED_TO_I00',
      CURRENT_FILTER_ADMISSION: 'UNPROVEN',
    },
  );
  assert.ok(snapshot.evidence.every((entry) => entry.provesIntegrated === false));
  assert.ok(snapshot.evidence.every((entry) => entry.provesDeployed === false));
  assert.ok(snapshot.evidence.every((entry) => entry.provesPrivate === false));
  assert.ok(snapshot.evidence.every((entry) => entry.provesTradeReady === false));
  assert.ok(snapshot.evidence.every((entry) => entry.provesLive === false));
  assert.ok(snapshot.evidence.every((entry) => entry.provesProductionReadiness === false));
  assert.ok(snapshot.evidence.every((entry) => entry.provesMoneyMutation === false));
});
