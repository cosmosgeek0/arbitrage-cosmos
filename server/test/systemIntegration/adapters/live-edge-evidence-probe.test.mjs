import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveRecoveryCampaignTraceDigest,
  projectExposureRecoverySnapshot,
} from '../../../dist/liveEdge/adapters/exposureRecoveryProjection/index.js';
import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  MACHINE_GRAPH_ALARMS,
  MACHINE_GRAPH_METRICS,
  MACHINE_GRAPH_ROLES,
  projectMachineGraphEvidence,
} from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';
import {
  LIVE_EDGE_EVIDENCE_PROBE_SCHEMA,
  LIVE_EDGE_EVIDENCE_TRACE_KIND_BY_COMPONENT,
  MAX_LIVE_EDGE_EVIDENCE_TRACE_EVENTS,
  createLiveEdgeEvidenceTraceReadPort,
  projectLiveEdgeEvidenceProbe,
} from '../../../dist/systemIntegration/adapters/liveEdgeEvidenceProbe.js';
import { SYSTEM_COMPONENT_IDS } from '../../../dist/systemIntegration/contracts/constants.js';
import { validateSystemTraceEvent } from '../../../dist/systemIntegration/contracts/validation.js';
import { buildSystemTraceIndex } from '../../../dist/systemIntegration/supervisor/traceIndex.js';
import { completeInput as completeL12Input } from '../../liveEdge/exposureRecoveryProjection/fixtures.mjs';
import {
  completeInput as completeL13Input,
  makeRoleCurrent,
  observedMetric,
} from '../../liveEdge/machineGraphEvidence/fixtures.mjs';

function acceptedPair() {
  const l12Snapshot = projectExposureRecoverySnapshot(completeL12Input());
  const machineGraphSnapshot = projectMachineGraphEvidence(completeL13Input(l12Snapshot));
  return { l12Snapshot, machineGraphSnapshot };
}

function resealCampaign(campaign) {
  const { traceDigest: _discarded, ...material } = campaign;
  return { ...material, traceDigest: deriveRecoveryCampaignTraceDigest(material) };
}

function rebindSubject(input, subject) {
  input.subject = subject;
  input.canonicalTruth = { ...input.canonicalTruth, subject };
  input.chain = input.chain.map((stage) => ({ ...stage, subject }));
  input.riskRecheck = { ...input.riskRecheck, subject };
  input.control = { ...input.control, subject };
  input.exposure = { ...input.exposure, subject };
  input.capital = { ...input.capital, subject };
  input.reconciliation = { ...input.reconciliation, subject };
  input.outstanding = { ...input.outstanding, subject };
  input.recovery = { ...input.recovery, subject };
  input.campaigns = input.campaigns.map((campaign) => resealCampaign({ ...campaign, subject }));
  return input;
}

test('projects one deterministic, deeply frozen, synthetic evidence-only seam', () => {
  const input = acceptedPair();
  const left = projectLiveEdgeEvidenceProbe(input);
  const right = projectLiveEdgeEvidenceProbe(input);

  assert.deepEqual(left, right);
  assert.equal(left.schema, LIVE_EDGE_EVIDENCE_PROBE_SCHEMA);
  assert.equal(left.truthClass, 'SYNTHETIC_ONLY');
  assert.equal(left.exposureSource, 'CONFIRMED_FILLS_AND_RECONCILED_EXCHANGE_TRUTH');
  assert.equal(left.privateReadAuthority, 'NONE');
  assert.equal(left.persistenceAuthority, 'NONE');
  assert.equal(left.externalActionAuthorization, 'NONE');
  assert.equal(left.automaticActionAuthorization, 'NONE');
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.roles), true);
  assert.equal(Object.isFrozen(left.roles[0]), true);
  assert.equal(Object.isFrozen(left.traceEvents), true);

  const port = createLiveEdgeEvidenceTraceReadPort(input);
  assert.equal(Object.isFrozen(port), true);
  assert.deepEqual(port.readTraceEvents(), left.traceEvents);
  assert.strictEqual(port.readTraceEvents(), port.readTraceEvents());
});

test('binds one exact owner subject and accounting scope and rejects subject or revision drift', () => {
  const input = acceptedPair();
  const projection = projectLiveEdgeEvidenceProbe(input);
  assert.deepEqual(projection.subject, input.l12Snapshot.subject);
  assert.equal(projection.canonicalTruth.accountingScopeId, input.l12Snapshot.canonicalTruth.accountingScopeId);
  assert.equal(projection.canonicalTruth.exposureTruthRevision, input.l12Snapshot.exposure.truthRevision);
  assert.equal(projection.canonicalTruth.capitalPositionRevision, input.l12Snapshot.capital.positionRevision);
  assert.equal(projection.canonicalTruth.reconciliationRevision, input.l12Snapshot.reconciliation.revision);

  const subjectDrift = acceptedPair();
  subjectDrift.l12Snapshot = structuredClone(subjectDrift.l12Snapshot);
  subjectDrift.l12Snapshot.chain[0].subject = {
    ...subjectDrift.l12Snapshot.chain[0].subject,
    accountRealmId: 'foreign-account-realm',
  };
  assert.throws(
    () => projectLiveEdgeEvidenceProbe(subjectDrift),
    /different (?:owner )?subject/,
  );

  const revisionDrift = acceptedPair();
  revisionDrift.machineGraphSnapshot = structuredClone(revisionDrift.machineGraphSnapshot);
  revisionDrift.machineGraphSnapshot.l12Binding.sourceSnapshotRevision = 'l12_forged_revision';
  assert.throws(
    () => projectLiveEdgeEvidenceProbe(revisionDrift),
    /not reproducible|exact L12|revision/i,
  );
});

test('rejects requested quantities before any System Integration evidence can be emitted', () => {
  const input = acceptedPair();
  input.l12Snapshot = structuredClone(input.l12Snapshot);
  input.l12Snapshot.exposure.source = 'REQUESTED_ORDER_QUANTITY';
  assert.throws(
    () => projectLiveEdgeEvidenceProbe(input),
    /confirmed-fill/,
  );
});

test('keeps private/account truth absent and cold start halted', () => {
  const projection = projectLiveEdgeEvidenceProbe(acceptedPair());
  const privateRoles = new Set([
    'SPOT_PRIVATE_STREAM',
    'USD_M_PRIVATE_STREAM',
    'MARGIN_PRIVATE_STREAM',
    'ACCOUNT_TRUTH',
  ]);
  const projectedPrivate = projection.roles.filter((role) => privateRoles.has(role.role));

  assert.equal(projectedPrivate.length, 4);
  assert.equal(projectedPrivate.every((role) => role.bindingState === 'OWNER_GATED'), true);
  assert.equal(projectedPrivate.every((role) => role.evidenceState === 'UNAVAILABLE'), true);
  assert.equal(projectedPrivate.every((role) => role.availability === 'OWNER_GATED'), true);
  assert.equal(projectedPrivate.every((role) => role.componentIds.length === 0), true);
  assert.equal(projection.coldStartPosture, 'HALTED');
  assert.equal(projection.privateReadAuthority, 'NONE');
  assert.equal(projection.traceEvents.some((event) => event.truthLabel === 'LIVE_PUBLIC'), false);
});

test('preserves the exact 27-role binding contract without inventing a component or topology', () => {
  const projection = projectLiveEdgeEvidenceProbe(acceptedPair());
  const counts = Object.fromEntries(['BOUND', 'OWNER_GATED', 'MISSING'].map((state) => [
    state,
    projection.roles.filter((role) => role.bindingState === state).length,
  ]));
  const projectedIds = projection.roles.flatMap((role) => role.componentIds);

  assert.deepEqual(projection.roles.map((role) => role.role), MACHINE_GRAPH_ROLES);
  assert.deepEqual(counts, { BOUND: 11, OWNER_GATED: 13, MISSING: 3 });
  assert.equal(projectedIds.length, 12);
  assert.equal(new Set(projectedIds).size, projectedIds.length);
  assert.equal(projectedIds.every((id) => SYSTEM_COMPONENT_IDS.includes(id)), true);
  assert.deepEqual(
    CANONICAL_SYSTEM_COMPONENT_IDS,
    SYSTEM_COMPONENT_IDS.filter((componentId) => componentId !== 'q-inference'),
  );
  assert.deepEqual(
    SYSTEM_COMPONENT_IDS.filter(
      (componentId) => !CANONICAL_SYSTEM_COMPONENT_IDS.includes(componentId),
    ),
    ['q-inference'],
  );
  assert.equal(LIVE_EDGE_EVIDENCE_TRACE_KIND_BY_COMPONENT['q-inference'], 'INTELLIGENCE');
  assert.deepEqual(
    Object.keys(LIVE_EDGE_EVIDENCE_TRACE_KIND_BY_COMPONENT),
    SYSTEM_COMPONENT_IDS,
  );
  assert.equal(projection.traceEvents.every((event) => SYSTEM_COMPONENT_IDS.includes(event.componentId)), true);
  assert.equal(Object.hasOwn(projection, 'edges'), false);
  assert.equal(Object.hasOwn(projection, 'dependencies'), false);
  assert.equal(Object.hasOwn(projection, 'topology'), false);
  assert.equal(Object.hasOwn(projection, 'controls'), false);
});

test('preserves UNAVAILABLE, PARTIAL, OWNER_GATED, MISSING, UNKNOWN, and STALE evidence without promotion', () => {
  const baseline = projectLiveEdgeEvidenceProbe(acceptedPair());
  assert.equal(baseline.roles.some((role) => role.availability === 'UNAVAILABLE'), true);
  assert.equal(baseline.roles.some((role) => role.availability === 'NOT_CONFIGURED'), false);
  assert.equal(baseline.roles.filter((role) => role.availability === 'OWNER_GATED').length, 13);
  assert.equal(baseline.roles.filter((role) => role.availability === 'MISSING').length, 3);

  const { l12Snapshot } = acceptedPair();
  const source = completeL13Input(l12Snapshot);
  const unknown = source.roles.find((role) => role.role === 'SECRETS_BOUNDARY');
  unknown.evidenceState = 'UNKNOWN';
  unknown.backpressure = 'UNKNOWN';
  unknown.sourceType = 'UNKNOWN';
  unknown.completeness = 'UNKNOWN';
  const stale = makeRoleCurrent(source, 'SPOT_PUBLIC_STREAM');
  stale.evidenceState = 'STALE';
  const partial = makeRoleCurrent(source, 'USD_M_PUBLIC_STREAM');
  partial.evidenceState = 'PARTIAL';
  partial.completeness = 'PARTIAL';
  const machineGraphSnapshot = projectMachineGraphEvidence(source);
  const projection = projectLiveEdgeEvidenceProbe({ l12Snapshot, machineGraphSnapshot });

  assert.equal(projection.roles.find((role) => role.role === 'SECRETS_BOUNDARY').availability, 'OWNER_GATED');
  assert.equal(projection.roles.find((role) => role.role === 'SECRETS_BOUNDARY').evidenceState, 'UNKNOWN');
  assert.equal(projection.roles.find((role) => role.role === 'SPOT_PUBLIC_STREAM').availability, 'STALE');
  assert.equal(projection.roles.find((role) => role.role === 'USD_M_PUBLIC_STREAM').availability, 'PARTIAL');
  assert.equal(projection.traceEvents.every((event) => event.truthLabel === 'SYNTHETIC_ONLY'), true);
  assert.equal(projection.traceEvents.every((event) => !event.releaseStatuses.includes('LIVE_PUBLIC')), true);
});

test('retains all 36 metric and 13 alarm states as record-only owner evidence', () => {
  const { l12Snapshot } = acceptedPair();
  const input = completeL13Input(l12Snapshot);
  observedMetric(input, 'STREAM_RECONNECT_COUNT', 4);
  const machineGraphSnapshot = projectMachineGraphEvidence(input);
  const projection = projectLiveEdgeEvidenceProbe({ l12Snapshot, machineGraphSnapshot });
  assert.deepEqual(projection.metrics.map((metric) => metric.metric), MACHINE_GRAPH_METRICS);
  assert.equal(projection.metrics.length, 36);
  const observed = projection.metrics.find((metric) => metric.metric === 'STREAM_RECONNECT_COUNT');
  assert.equal(observed.status, 'OBSERVED');
  assert.equal(observed.value, 4);
  assert.equal(observed.instrument, 'COUNTER');
  assert.equal(observed.window.continuity, 'CONTIGUOUS');
  assert.deepEqual(observed.reasonCodes, []);
  const unavailable = projection.metrics.find((metric) => metric.metric === 'DEPLOYED_REVISION');
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.value, null);
  assert.equal(unavailable.window, null);
  assert.deepEqual(unavailable.reasonCodes, ['OWNER_METRIC_UNAVAILABLE']);
  assert.deepEqual(projection.alarms.map((alarm) => alarm.alarm), MACHINE_GRAPH_ALARMS);
  assert.equal(projection.alarms.length, 13);
  assert.equal(projection.alarms.every((alarm) => alarm.state === 'UNAVAILABLE'), true);
  assert.equal(projection.alarms.every((alarm) => alarm.owner === 'FOUNDATION_OBSERVABILITY'), true);
  assert.equal(projection.alarms.every((alarm) => alarm.reasonCodes.includes('OWNER_ALARM_UNAVAILABLE')), true);
  assert.equal(projection.alarms.every((alarm) => alarm.haltRecommendation === false), true);
  assert.equal(projection.alarmAuthority, 'NONE_RECORD_ONLY');
  assert.equal(projection.controlAuthority, 'NONE_RECORD_ONLY');
});

test('leaves first-root, readiness, control, and alarm decisions with canonical owners', () => {
  const projection = projectLiveEdgeEvidenceProbe(acceptedPair());
  assert.equal(projection.topologyAuthority, 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY');
  assert.equal(projection.firstRootSelectionAuthority, 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY');
  assert.equal(projection.rootCauseAuthority, 'NONE_RECORD_ONLY');
  assert.equal(projection.readinessAuthority, 'NONE_RECORD_ONLY');
  assert.equal(Object.hasOwn(projection, 'firstRootBlockerComponentId'), false);
  assert.equal(projection.roles.every((role) => !Object.hasOwn(role, 'rootCauseReference')), true);
  assert.equal(projection.roles.every((role) => !Object.hasOwn(role, 'controlState')), true);
  assert.equal(projection.traceEvents.every((event) => event.machinePhase === null), true);
  assert.equal(projection.traceEvents.every((event) => event.failure === null), true);

  const index = buildSystemTraceIndex(projection.traceEvents, projection.assembledAtMs);
  const indexedEvents = index.entries.flatMap((entry) => entry.snapshot.events);
  assert.equal(indexedEvents.every((event) => ['SYNTHETIC_ONLY', 'DRY_RUN'].includes(event.truthLabel)), true);
  assert.equal(indexedEvents.some((event) => event.truthLabel === 'LIVE_PUBLIC'), false);
});

test('rejects forged role mappings, topology, controls, and secret-bearing evidence', () => {
  const invented = acceptedPair();
  invented.machineGraphSnapshot = structuredClone(invented.machineGraphSnapshot);
  invented.machineGraphSnapshot.roleBindings.find((entry) => entry.bindingState === 'BOUND').componentIds[0] = 'shadow-supervisor';
  assert.throws(
    () => projectLiveEdgeEvidenceProbe(invented),
    /non-canonical component ID|not reproducible/,
  );

  const smuggledTopology = acceptedPair();
  smuggledTopology.machineGraphSnapshot = structuredClone(smuggledTopology.machineGraphSnapshot);
  smuggledTopology.machineGraphSnapshot.topology = [{ from: 'shadow', to: 'engine-supervisor' }];
  assert.throws(
    () => projectLiveEdgeEvidenceProbe(smuggledTopology),
    /not reproducible|closed schema/,
  );

  const forgedControl = acceptedPair();
  forgedControl.machineGraphSnapshot = structuredClone(forgedControl.machineGraphSnapshot);
  forgedControl.machineGraphSnapshot.controls[0].availability = 'AVAILABLE';
  assert.throws(
    () => projectLiveEdgeEvidenceProbe(forgedControl),
    /unavailable and non-dispatching|not reproducible/,
  );

  const secret = acceptedPair();
  secret.l12Snapshot = structuredClone(secret.l12Snapshot);
  secret.l12Snapshot.apiKey = 'forbidden-secret-material';
  assert.throws(
    () => projectLiveEdgeEvidenceProbe(secret),
    /forbids sensitive field apiKey/,
  );

  assert.throws(
    () => projectLiveEdgeEvidenceProbe({ ...acceptedPair(), commandOwner: 'shadow-control' }),
    /exact closed schema/,
  );
});

test('enforces trace bounds and target trace contracts without truncation or mutable aliases', () => {
  const projection = projectLiveEdgeEvidenceProbe(acceptedPair());
  assert.equal(projection.traceEvents.length, 16);
  assert.equal(projection.traceEvents.length <= MAX_LIVE_EDGE_EVIDENCE_TRACE_EVENTS, true);
  for (const event of projection.traceEvents) {
    assert.deepEqual(validateSystemTraceEvent(event), []);
    assert.equal(event.referenceIds.length <= 64, true);
    assert.equal(event.referenceIds.every((referenceId) => referenceId.length <= 256), true);
    assert.equal(new Set(event.referenceIds).size, event.referenceIds.length);
  }

  const longCorrelationInput = completeL12Input();
  rebindSubject(longCorrelationInput, {
    ...longCorrelationInput.subject,
    correlationId: 'c'.repeat(129),
  });
  const l12Snapshot = projectExposureRecoverySnapshot(longCorrelationInput);
  const machineGraphSnapshot = projectMachineGraphEvidence(completeL13Input(l12Snapshot));
  assert.throws(
    () => projectLiveEdgeEvidenceProbe({ l12Snapshot, machineGraphSnapshot }),
    /cannot be represented by the bounded System Integration trace contract/,
  );

  const hidden = acceptedPair();
  Object.defineProperty(hidden, 'hiddenTopology', { value: [], enumerable: false });
  assert.throws(
    () => projectLiveEdgeEvidenceProbe(hidden),
    /exact closed schema/,
  );
});
