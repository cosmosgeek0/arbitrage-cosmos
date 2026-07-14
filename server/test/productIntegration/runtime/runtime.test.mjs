import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PRODUCT_RUNTIME_TRACE_STAGES,
  buildProductRuntimeSupervisorEnvelope,
  createProductIntegrationRuntime,
  projectProductCorrelationTrace,
  projectProductMaterialEventPage,
} from '../../../dist/productIntegration/runtime/index.js';
import { T0, makeRead, makeRecords, makeSupervisor, traceEvent } from './testSupport.mjs';

test('production runtime barrel is fixture-free and supervisor envelope is exact and non-money', async () => {
  const source = await readFile(new URL('../../../src/productIntegration/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fixtures/);
  const service = createProductIntegrationRuntime({ read: makeRead(), clock: { nowMs: () => T0 } });
  const envelope = await service.readSupervisor();
  assert.equal(envelope.schemaVersion, 'product-supervisor.v1');
  assert.equal(envelope.ownerView.machineReady, 'YES');
  assert.equal(envelope.ownerView.tradeReady, 'NO');
  assert.equal(envelope.dashboard.overallPosture, 'READY');
  assert.equal(envelope.components.length, 13);
  assert.equal(Object.keys(envelope.surfaces).length, 18);
  assert.equal(envelope.surfaces.dashboard.bindingState, 'BINDING_READY');
  assert.equal(envelope.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.equal(envelope.surfaces.account.truthLabel, 'NOT_CONFIGURED');
  assert.equal(envelope.surfaces.borrow.truthLabel, 'NOT_CONFIGURED');
  assert.equal(envelope.surfaces.notifications.truthLabel, 'NOT_CONFIGURED');
  assert.equal(envelope.surfaces.notifications.bindingState, 'BLOCKED_BACKEND');
  assert.equal(envelope.ownerView.unresolvedRecovery, null);
  assert.ok(envelope.components.every((component) => component.lastAdvanceAtMs === null));
  const advanceEvidence = envelope.surfaces.health.evidence.find((datum) => datum.fieldId === 'heartbeat-advance');
  assert.equal(advanceEvidence.value, null);
  assert.equal(advanceEvidence.truthLabel, 'UNKNOWN');
  assert.equal(advanceEvidence.unavailableReason, 'CANONICAL_MEANINGFUL_ADVANCE_NOT_PUBLISHED');
  assert.deepEqual(envelope.incidentAvailability, {
    state: 'NOT_CONFIGURED', truthLabel: 'NOT_CONFIGURED', blocker: 'INCIDENT_OWNER_NOT_CONFIGURED',
  });
  assert.deepEqual(envelope.incidents, []);
  assert.equal(envelope.persistentSyntheticLabel, false);
  assert.equal(envelope.materialEvents.mode, 'TAIL_BOOTSTRAP');
  assert.equal(envelope.materialEvents.requestedAfterCursor, '0');
  assert.equal(envelope.materialEvents.retainedFromCursor, '1');
  assert.equal(envelope.materialEvents.highWaterCursor, '2');
  assert.equal(envelope.materialEvents.continuity, 'PROVEN');
  assert.equal(envelope.materialEvents.nextCursor, '2');
  assert.equal(envelope.materialEvents.hasMore, false);
  assert.equal(envelope.materialEvents.missingRange, null);
  assert.equal(envelope.ownerView.revisions.configRevision, null);
  assert.match(envelope.digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(envelope.controls.map((control) => control.backendCommandId), [
    'SET_SAFE_MODE', 'SET_KILL_SWITCH', 'SET_INTAKE_PAUSED', 'RESTART_COMPONENT',
  ]);
  assert.ok(envelope.controls.every((control) => control.wiringState === 'UNAVAILABLE:COMMAND_OWNER_NOT_CONFIGURED'));
  assert.ok(envelope.controls.every((control) => control.preview === null && control.disabledReason === 'COMMAND_OWNER_NOT_CONFIGURED'));
});

test('generic control revisions never masquerade as canonical config provenance', () => {
  const source = makeSupervisor();
  const page = projectProductMaterialEventPage('0', 200, makeRead().events({ afterCursor: '0', limit: 200 }));
  for (const revision of [0, 1, 999_999]) {
    const snapshot = makeSupervisor({
      control: Object.freeze({ ...source.control, revision }),
    });
    const envelope = buildProductRuntimeSupervisorEnvelope({ snapshot, materialEvents: page, traces: [], nowMs: T0 });
    assert.equal(envelope.dashboard.control.revision, revision);
    assert.equal(envelope.ownerView.revisions.configRevision, null);
  }
});

test('Product preserves canonical readiness and UNKNOWN without creating a second posture owner', () => {
  const source = makeSupervisor();
  const components = source.components.map((component) => component.componentId === 'market-intelligence'
    ? Object.freeze({ ...component, truthLabel: 'UNKNOWN' }) : component);
  const snapshot = makeSupervisor({ components: Object.freeze(components), overallPosture: 'READY' });
  const page = projectProductMaterialEventPage('0', 200, makeRead().events({ afterCursor: '0', limit: 200 }));
  const envelope = buildProductRuntimeSupervisorEnvelope({ snapshot, materialEvents: page, traces: [], nowMs: T0 });
  assert.equal(envelope.ownerView.machineReady, 'YES');
  assert.equal(envelope.ownerView.tradeReady, 'NO');
  assert.equal(envelope.dashboard.overallPosture, 'READY');
  const intelligence = envelope.components.find((component) => component.componentId === 'market-intelligence');
  assert.equal(intelligence.truthLabel, 'UNKNOWN');
  assert.equal(intelligence.capability, 'UNKNOWN');
  assert.equal(envelope.ownerView.topRootBlocker, null);

  const unknownSnapshot = makeSupervisor({ truthLabel: 'UNKNOWN', overallPosture: 'BLOCKED' });
  const unknown = buildProductRuntimeSupervisorEnvelope({ snapshot: unknownSnapshot, materialEvents: page, traces: [], nowMs: T0 });
  assert.equal(unknown.truthLabel, 'UNKNOWN');
  assert.equal(unknown.surfaces.dashboard.truthLabel, 'UNKNOWN');
  assert.equal(unknown.surfaces.dashboard.summary, 'Dashboard owner evidence is unknown.');
  assert.equal(unknown.surfaces.dashboard.blocker, 'CANONICAL_OWNER_UNKNOWN');

  const unavailableSnapshot = makeSupervisor({ truthLabel: 'UNAVAILABLE', overallPosture: 'BLOCKED' });
  const unavailable = buildProductRuntimeSupervisorEnvelope({ snapshot: unavailableSnapshot, materialEvents: page, traces: [], nowMs: T0 });
  assert.equal(unavailable.truthLabel, 'UNAVAILABLE');
  assert.equal(unavailable.surfaces.dashboard.truthLabel, 'UNAVAILABLE');
  assert.equal(unavailable.surfaces.dashboard.bindingState, 'BLOCKED_BACKEND');
  assert.equal(unavailable.surfaces.dashboard.blocker, 'CANONICAL_OWNER_UNAVAILABLE');
});

test('public-source freshness is unknown unless both canonical source owners are present', () => {
  const source = makeSupervisor();
  const withoutSources = Object.freeze(source.components.filter((component) => (
    component.componentId !== 'public-spot-source' && component.componentId !== 'public-usdm-source'
  )));
  const onlySpot = Object.freeze(source.components.filter((component) => component.componentId !== 'public-usdm-source'));
  const page = projectProductMaterialEventPage('0', 200, makeRead().events({ afterCursor: '0', limit: 200 }));
  for (const components of [withoutSources, onlySpot]) {
    const envelope = buildProductRuntimeSupervisorEnvelope({
      snapshot: makeSupervisor({ components }), materialEvents: page, traces: [], nowMs: T0,
    });
    assert.equal(envelope.ownerView.dataFreshness, null);
    assert.doesNotMatch(JSON.stringify(envelope), /Infinity/);
  }
});

test('material cursor projection proves contiguous pages and fails closed on retention and internal gaps', () => {
  const proven = projectProductMaterialEventPage('0', 10, makeRead().events({ afterCursor: '0', limit: 10 }));
  assert.deepEqual({
    mode: proven.mode, retained: proven.retainedFromCursor, highWater: proven.highWaterCursor,
    continuity: proven.continuity, next: proven.nextCursor, hasMore: proven.hasMore,
    backfill: proven.backfillRequired, missing: proven.missingRange,
  }, {
    mode: 'CURSOR', retained: '1', highWater: '2', continuity: 'PROVEN', next: '2',
    hasMore: false, backfill: false, missing: null,
  });

  const retained = makeRecords().map((record, index) => Object.freeze({ ...record, cursor: String(index + 5) }));
  const gap = projectProductMaterialEventPage('0', 10, {
    requestedAfterCursor: '0', retainedFromCursor: '5', highWaterCursor: '6', continuity: 'GAP', truncated: true, items: retained,
  });
  assert.equal(gap.continuity, 'GAP');
  assert.equal(gap.truncated, true);
  assert.equal(gap.backfillRequired, true);
  assert.deepEqual(gap.missingRange, { fromCursor: '1', toCursor: '4', reason: 'RETENTION_GAP' });

  const internal = projectProductMaterialEventPage('0', 10, {
    requestedAfterCursor: '0', retainedFromCursor: '1', highWaterCursor: '3', continuity: 'PROVEN', truncated: false,
    items: [makeRecords()[0], Object.freeze({ ...makeRecords()[1], cursor: '3' })],
  });
  assert.equal(internal.continuity, 'GAP');
  assert.equal(internal.nextCursor, '1');
  assert.equal(internal.backfillRequired, true);
  assert.equal(internal.truncated, false);
  assert.deepEqual(internal.missingRange, { fromCursor: '2', toCursor: '2', reason: 'INTERIOR_GAP' });

  const prefix = projectProductMaterialEventPage('0', 1, {
    requestedAfterCursor: '0', retainedFromCursor: '1', highWaterCursor: '2', continuity: 'PROVEN', truncated: false,
    items: [makeRecords()[0]],
  });
  const prefixEnvelope = buildProductRuntimeSupervisorEnvelope({ snapshot: makeSupervisor(), materialEvents: prefix, traces: [], nowMs: T0 });
  assert.equal(prefix.hasMore, true);
  assert.equal(prefixEnvelope.ownerView.latestMaterialChange, null);
});

test('material service rejects cursors outside SQLite row-id bounds before calling its owner', async () => {
  const base = makeRead();
  let ownerReads = 0;
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      events: (input) => { ownerReads += 1; return base.events(input); },
    }),
    clock: { nowMs: () => T0 },
  });
  await assert.rejects(
    service.readMaterialEvents('9223372036854775808', 1),
    (error) => error?.code === 'INVALID_MATERIAL_CURSOR' && error?.status === 400,
  );
  assert.equal(ownerReads, 0);
});

function materialRecords(first, last) {
  return Object.freeze(Array.from({ length: last - first + 1 }, (_, offset) => {
    const cursor = first + offset;
    return Object.freeze({
      cursor: String(cursor),
      event: traceEvent(`evt-${cursor}`, cursor, 'STRATEGY', 'basis-engine', `cor_tail_${cursor}`),
    });
  }));
}

test('supervisor tail bootstrap exposes current material truth and a recoverable retained floor', async () => {
  const complete = createProductIntegrationRuntime({
    read: makeRead({ records: materialRecords(1, 600) }),
    clock: { nowMs: () => T0 },
  });
  const current = await complete.readSupervisor();
  assert.equal(current.materialEvents.mode, 'TAIL_BOOTSTRAP');
  assert.equal(current.materialEvents.requestedAfterCursor, '100');
  assert.equal(current.materialEvents.nextCursor, '600');
  assert.equal(current.materialEvents.highWaterCursor, '600');
  assert.equal(current.materialEvents.hasMore, false);
  assert.equal(current.materialEvents.continuity, 'PROVEN');
  assert.equal(current.materialEvents.backfillRequired, false);
  assert.deepEqual(current.materialEvents.missingRange, {
    fromCursor: '1', toCursor: '100', reason: 'BOOTSTRAP_HISTORY_OMITTED',
  });
  assert.equal(current.ownerView.latestMaterialChange, 'STRATEGY:evt-600');

  const retained = createProductIntegrationRuntime({
    read: makeRead({ records: materialRecords(101, 400) }),
    clock: { nowMs: () => T0 },
  });
  const recovered = await retained.readSupervisor();
  assert.equal(recovered.materialEvents.requestedAfterCursor, '100');
  assert.equal(recovered.materialEvents.continuity, 'GAP');
  assert.equal(recovered.materialEvents.nextCursor, '400');
  assert.equal(recovered.materialEvents.highWaterCursor, '400');
  assert.equal(recovered.materialEvents.hasMore, false);
  assert.equal(recovered.materialEvents.truncated, true);
  assert.equal(recovered.materialEvents.backfillRequired, true);
  assert.deepEqual(recovered.materialEvents.missingRange, {
    fromCursor: '1', toCursor: '100', reason: 'RETENTION_GAP',
  });
  assert.equal(recovered.ownerView.latestMaterialChange, null);
});

test('correlation trace always has the exact 12 stages and exposes missing owners honestly', () => {
  const correlationId = 'cor_trace_1';
  const snapshot = Object.freeze({
    correlationId, evaluatedAtMs: T0, truncated: false,
    events: Object.freeze([
      traceEvent('source-1', 1, 'SOURCE', 'public-spot-source', correlationId),
      traceEvent('strategy-1', 2, 'STRATEGY', 'basis-engine', correlationId),
      traceEvent('risk-1', 3, 'RISK', 'multileg-risk', correlationId),
    ]),
  });
  const trace = projectProductCorrelationTrace(correlationId, snapshot);
  assert.equal(trace.stages.length, 12);
  assert.equal(trace.truncated, false);
  assert.equal(trace.completeness, 'COMPLETE');
  assert.deepEqual(trace.stages.map((stage) => stage.stage), PRODUCT_RUNTIME_TRACE_STAGES);
  assert.equal(trace.stages[0].truthLabel, 'LIVE_PUBLIC');
  assert.equal(trace.stages[0].evidenceState, 'PRESENT');
  assert.equal(trace.stages[3].outcome, 'NO_EVENT_PUBLISHED');
  assert.equal(trace.stages[3].truthLabel, 'MISSING');
  assert.equal(trace.stages[3].evidenceState, 'ABSENT');
  assert.equal(trace.stages[7].truthLabel, 'MISSING');
  assert.equal(trace.stages[11].truthLabel, 'MISSING');
});

test('bounded trace uncertainty never fabricates omitted or configured stages', async () => {
  const correlationId = 'cor_trace_1';
  const sourceEvents = Object.freeze([
    traceEvent('source-1', 1, 'SOURCE', 'public-spot-source', correlationId),
    traceEvent('strategy-1', 2, 'STRATEGY', 'basis-engine', correlationId),
    traceEvent('risk-1', 3, 'RISK', 'multileg-risk', correlationId),
  ]);
  const base = makeRead();
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      trace(id, limit) {
        if (id !== correlationId) return null;
        return Object.freeze({
          correlationId: id,
          evaluatedAtMs: T0,
          events: Object.freeze(sourceEvents.slice(-limit)),
          truncated: sourceEvents.length > limit,
        });
      },
    }),
    clock: { nowMs: () => T0 },
  });
  const trace = await service.readTrace(correlationId, 1);
  assert.equal(trace.truncated, true);
  assert.equal(trace.completeness, 'TRUNCATED');
  const source = trace.stages.find((stage) => stage.stage === 'Market Source');
  assert.deepEqual({ truth: source.truthLabel, outcome: source.outcome, evidence: source.evidenceState }, {
    truth: 'UNKNOWN', outcome: 'UNKNOWN_DUE_TO_TRACE_TRUNCATION', evidence: 'UNKNOWN_DUE_TO_TRUNCATION',
  });
  assert.equal(trace.stages.find((stage) => stage.stage === 'Risk Verdict').evidenceState, 'PRESENT');
  const ticket = trace.stages.find((stage) => stage.stage === 'Ticket / Plan');
  assert.equal(ticket.evidenceState, 'UNKNOWN_DUE_TO_TRUNCATION');
  assert.equal(ticket.truthLabel, 'UNKNOWN');
  assert.notEqual(ticket.outcome, 'NOT_CONFIGURED');
});

test('nested synthetic owner evidence forces the persistent label while account truth stays exact', () => {
  const source = makeSupervisor();
  const summaries = Object.freeze({
    ...source.summaries,
    capital: Object.freeze({
      ...source.summaries.capital,
      truthLabel: 'DRY_RUN',
      accountTruthState: 'SYNTHETIC_FIXTURE',
    }),
  });
  const snapshot = makeSupervisor({ summaries, truthLabel: 'DRY_RUN' });
  const page = projectProductMaterialEventPage('0', 10, makeRead().events({ afterCursor: '0', limit: 10 }));
  const envelope = buildProductRuntimeSupervisorEnvelope({ snapshot, materialEvents: page, traces: [], nowMs: T0 });
  assert.equal(envelope.truthLabel, 'BUILT_AND_TESTED');
  assert.equal(envelope.persistentSyntheticLabel, true);
  assert.equal(envelope.surfaces.account.truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(envelope.surfaces.borrow.truthLabel, 'SYNTHETIC_ONLY');

  const unknownAccountSummaries = Object.freeze({
    ...source.summaries,
    capital: Object.freeze({
      ...source.summaries.capital,
      truthLabel: 'DRY_RUN',
      accountTruthState: 'UNRECOGNIZED_READYISH_STATE',
    }),
  });
  const unknownAccount = buildProductRuntimeSupervisorEnvelope({
    snapshot: makeSupervisor({ summaries: unknownAccountSummaries }),
    materialEvents: page,
    traces: [],
    nowMs: T0,
  });
  assert.equal(unknownAccount.surfaces.account.truthLabel, 'UNKNOWN');
  assert.equal(unknownAccount.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.equal(unknownAccount.surfaces.borrow.truthLabel, 'UNKNOWN');
});

test('supervisor trace owner cannot exceed the requested embedded bound', async () => {
  const correlationId = 'cor_trace_1';
  const base = makeRead();
  const snapshot = makeSupervisor({
    recentCorrelatedDecisions: Object.freeze([Object.freeze({ correlationId })]),
  });
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      supervisor: () => snapshot,
      trace: () => Object.freeze({
        correlationId,
        evaluatedAtMs: T0,
        truncated: true,
        events: Object.freeze(Array.from({ length: 201 }, (_, index) => (
          traceEvent(`trace-${index + 1}`, index + 1, 'SOURCE', 'public-spot-source', correlationId)
        ))),
      }),
    }),
    clock: { nowMs: () => T0 },
  });
  await assert.rejects(service.readSupervisor(), (error) => error?.code === 'TRACE_SOURCE_INVALID');
});

test('an owner that lacks any durability gate leaves every affected control disabled', async () => {
  const commandOwner = {
    capability: Object.freeze({
      ownerId: 'system-control', supportedBackendCommandIds: Object.freeze(['SET_SAFE_MODE', 'SET_KILL_SWITCH', 'SET_INTAKE_PAUSED', 'RESTART_COMPONENT']),
      serverDerivedActor: true, durableIdempotency: true, revisionCompareAndSet: true, durableReceipts: false, managedRestartComponentId: 'engine-supervisor',
    }),
    preview: async () => { throw new Error('must not be called'); },
    submit: async () => { throw new Error('must not be called'); },
  };
  const service = createProductIntegrationRuntime({ read: makeRead(), clock: { nowMs: () => T0 }, commandOwner });
  const envelope = await service.readSupervisor();
  assert.ok(envelope.controls.every((control) => control.wiringState === 'UNAVAILABLE:DURABLE_RECEIPTS_NOT_PROVEN'));
});
