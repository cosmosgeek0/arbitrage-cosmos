import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  MACHINE_GRAPH_ALARMS,
  MACHINE_GRAPH_CONTROL_ACTIONS,
  MACHINE_GRAPH_METRICS,
  MACHINE_GRAPH_ROLES,
  projectMachineGraphEvidence,
  validateMachineGraphEvidenceSnapshot,
} from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';
import {
  completeInput as completeL12OwnerInput,
  recoveryRequiredInput as l12RecoveryRequiredInput,
} from '../exposureRecoveryProjection/fixtures.mjs';
import {
  ASSEMBLED_AT_MS,
  OWNER_DIGEST,
  acceptedL12Snapshot,
  canonicalComponentIdsFromBindings,
  completeInput,
  l12Binding,
  makeRoleCurrent,
  observedMetric,
} from './fixtures.mjs';

test('projects deterministic deeply frozen evidence without acquiring canonical owner authority', () => {
  const input = completeInput();
  const left = projectMachineGraphEvidence(input);
  const right = projectMachineGraphEvidence(completeInput());
  assert.deepEqual(left, right);
  assert.equal(left.projectionAuthority, 'OWNER_EVIDENCE_ADAPTER_ONLY');
  assert.equal(left.graphAuthority, 'SYSTEM_INTEGRATION');
  assert.equal(left.observabilityAuthority, 'FOUNDATION_OBSERVABILITY');
  assert.equal(left.controlAuthority, 'NONE_RECORD_ONLY');
  assert.equal(left.rootCauseAuthority, 'NONE_RECORD_ONLY');
  assert.equal(left.readinessAuthority, 'NONE_RECORD_ONLY');
  assert.equal(left.alarmEvaluationAuthority, 'NONE_RECORD_ONLY');
  assert.equal(left.externalActionAuthorization, 'NONE');
  assert.equal(left.automaticActionAuthorization, 'NONE');
  assert.equal(left.truthClass, 'SYNTHETIC_ONLY_UNWIRED');
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.roles[0]), true);
  assert.equal(Object.isFrozen(left.roles[0].supportedControls), true);
  assert.equal(Object.isFrozen(left.controls), true);
  assert.equal(Object.isFrozen(left.metrics), true);
  assert.deepEqual(validateMachineGraphEvidenceSnapshot(left, input.l12Snapshot), left);
});

test('covers exact roles, canonical component IDs, controls, metrics, and alarms', () => {
  const snapshot = projectMachineGraphEvidence(completeInput());
  assert.deepEqual(snapshot.roles.map((entry) => entry.role), MACHINE_GRAPH_ROLES);
  assert.deepEqual(snapshot.roleBindings.map((entry) => entry.role), MACHINE_GRAPH_ROLES);
  const boundIds = canonicalComponentIdsFromBindings(snapshot.roleBindings);
  assert.equal(new Set(boundIds).size, boundIds.length);
  assert.equal(boundIds.every((id) => CANONICAL_SYSTEM_COMPONENT_IDS.includes(id)), true);
  assert.equal(boundIds.includes('engine-supervisor'), false);
  assert.equal(
    snapshot.roleBindings.find((entry) => entry.role === 'WATCHDOG_ALARMS').bindingState,
    'MISSING',
  );
  assert.deepEqual(snapshot.controls.map((control) => control.action), MACHINE_GRAPH_CONTROL_ACTIONS);
  assert.equal(snapshot.controls.every((control) => control.availability === 'UNAVAILABLE'), true);
  assert.equal(snapshot.roles.filter((role) => role.evidenceState === 'UNAVAILABLE')
    .every((role) => role.supportedControls.length === 0), true);
  assert.deepEqual(snapshot.metrics.map((entry) => entry.metric), MACHINE_GRAPH_METRICS);
  assert.deepEqual(snapshot.alarms.map((entry) => entry.alarm), MACHINE_GRAPH_ALARMS);
  assert.equal(snapshot.roles.length, 27);
  assert.equal(snapshot.metrics.length, 36);
  assert.equal(snapshot.alarms.length, 13);
});

test('explicitly declares every unbound role as OWNER_GATED or MISSING', () => {
  const snapshot = projectMachineGraphEvidence(completeInput());
  for (const binding of snapshot.roleBindings) {
    if (binding.bindingState === 'BOUND') {
      assert.ok(binding.componentIds.length > 0);
      assert.notEqual(binding.bindingRevision, null);
    } else {
      assert.ok(['OWNER_GATED', 'MISSING'].includes(binding.bindingState));
      assert.deepEqual(binding.componentIds, []);
      assert.equal(binding.bindingRevision, null);
    }
  }
});

test('copies the exact L12 subject, revision, recovery, and component evidence without decimal arithmetic', () => {
  const source = acceptedL12Snapshot(l12RecoveryRequiredInput());
  const input = completeInput(source);
  const snapshot = projectMachineGraphEvidence(input);
  assert.deepEqual(snapshot.l12Binding, l12Binding(source));
  const role = snapshot.roles.find((entry) => entry.role === 'EXPOSURE_POSITION_SUPERVISOR');
  assert.equal(role.ownerRevision, snapshot.l12Binding.componentEvidence.ownerRevision);
  assert.equal(role.capitalExposed, snapshot.l12Binding.componentEvidence.capitalExposed);
  assert.equal(role.operatorAttentionRequired, snapshot.l12Binding.componentEvidence.operatorAttentionRequired);
  assert.equal(role.trace.correlationId, snapshot.l12Binding.subject.correlationId);
  assert.equal(role.trace.traceRevision, snapshot.l12Binding.sourceSnapshotRevision);
  assert.equal(role.observedState, snapshot.l12Binding.projectionStatus);
  assert.equal(role.versions.schemaVersion, snapshot.l12Binding.sourceSchema);
});

test('preserves opaque L12 owner reason strings byte-for-byte outside L13 reason-code grammar', () => {
  const l12Input = completeL12OwnerInput();
  l12Input.componentEvidence.reasonCodes = ['owner.note/v1: keep byte-for-byte'];
  l12Input.recovery.reasonCodes = ['owner recovery note v1'];
  const source = acceptedL12Snapshot(l12Input);
  const snapshot = projectMachineGraphEvidence(completeInput(source));
  assert.deepEqual(snapshot.l12Binding.componentEvidence.reasonCodes, l12Input.componentEvidence.reasonCodes);
  assert.deepEqual(snapshot.l12Binding.recovery.reasonCodes, l12Input.recovery.reasonCodes);
});

test('preserves unavailable role facts as null instead of manufactured zero or health', () => {
  const snapshot = projectMachineGraphEvidence(completeInput());
  const role = snapshot.roles.find((entry) => entry.role === 'SPOT_PRIVATE_STREAM');
  assert.equal(role.evidenceState, 'UNAVAILABLE');
  assert.equal(role.heartbeatAtMs, null);
  assert.equal(role.exchangeEventAgeMs, null);
  assert.equal(role.inputRate.diagnostic, null);
  assert.equal(role.outputRate.diagnostic, null);
  assert.equal(role.controlState.authority, 'UNAVAILABLE');
  assert.equal(role.queueDepth, null);
  assert.equal(role.droppedCount, null);
  assert.equal(role.capitalExposed, null);
  assert.equal(role.operatorAttentionRequired, null);
});

test('retains injected per-role queue, drop, backpressure, single-writer windows, rates, versions, and trace', () => {
  const input = completeInput();
  const expected = makeRoleCurrent(input, 'SPOT_PUBLIC_STREAM');
  const snapshot = projectMachineGraphEvidence(input);
  const role = snapshot.roles.find((entry) => entry.role === 'SPOT_PUBLIC_STREAM');
  assert.deepEqual(role, expected);
  assert.equal(role.inputRate.diagnostic.state, 'KNOWN');
  assert.equal(role.outputRate.diagnostic.state, 'KNOWN');
  assert.equal(role.inputRate.aggregationTemporality, 'CUMULATIVE');
  assert.equal(role.inputRate.authority, 'FOUNDATION_OBSERVABILITY');
  assert.equal(role.controlState.authority, 'FOUNDATION_CONTROL');
});

test('retains typed observed metrics with fixed empty labels and owner evidence', () => {
  const input = completeInput();
  observedMetric(input, 'DEPLOYED_REVISION', '1'.repeat(40));
  observedMetric(input, 'PUBLIC_EVENT_AGE_MS', 25);
  observedMetric(input, 'RATE_LIMIT_UTILIZATION_PPM', 500_000);
  observedMetric(input, 'UNHEDGED_NOTIONAL', '0.25');
  observedMetric(input, 'BACKUP_HEALTH', 'HEALTHY');
  const snapshot = projectMachineGraphEvidence(input);
  for (const metric of snapshot.metrics.filter((entry) => entry.status === 'OBSERVED')) {
    assert.deepEqual(metric.labels, []);
    assert.equal(metric.ownerDigest, OWNER_DIGEST);
    assert.equal(metric.observedAtMs, ASSEMBLED_AT_MS - 10);
  }
});

test('retains injected alarm state while forbidding liquidation, capital mutation, and automatic action', () => {
  const input = completeInput();
  const index = MACHINE_GRAPH_ALARMS.indexOf('TRADE_UNSAFE');
  input.alarms[index] = {
    ...input.alarms[index],
    state: 'ALARM',
    ownerRevision: 'trade-safety-owner-revision-1',
    ownerDigest: OWNER_DIGEST,
    observedAtMs: ASSEMBLED_AT_MS - 5,
    haltRecommendation: true,
    trace: {
      correlationId: input.l12Snapshot.subject.correlationId,
      traceRevision: input.l12Snapshot.snapshotRevision,
    },
    reasonCodes: ['OWNER_RECOMMENDS_HALT'],
  };
  const snapshot = projectMachineGraphEvidence(input);
  const alarm = snapshot.alarms[index];
  assert.equal(alarm.state, 'ALARM');
  assert.equal(alarm.automaticAction, 'NONE');
  assert.equal(alarm.canLiquidate, false);
  assert.equal(alarm.canMutateCapital, false);
  assert.equal(alarm.haltRecommendation, true);
});

test('omits every forbidden graph, posture, root selection, readiness, trade-ready, and mode output', () => {
  const snapshot = projectMachineGraphEvidence(completeInput());
  for (const forbidden of [
    'edges', 'topology', 'overallPosture', 'firstRootCause', 'firstRootBlockerComponentId',
    'readiness', 'tradeReady', 'tradeUnsafe', 'effectiveMode', 'desiredMode', 'rootCauses',
    'attentionQueue', 'controlDispatch',
  ]) {
    assert.equal(Object.hasOwn(snapshot, forbidden), false, forbidden);
  }
});
