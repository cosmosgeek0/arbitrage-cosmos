import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  MATERIAL_CURSOR_SCHEMA,
  REQUIRED_FIXTURE_SCENARIOS,
  REQUIRED_SURFACE_IDS,
  advanceFixtureSession,
  applyFixtureCommand,
  applyFixtureControl,
  buildFixtureBinding,
  createFixtureSession,
  isFunctionalWiringState,
  productMachineReadinessTone,
  productSurfaceReadinessBlocker,
  productTraceHasSyntheticEvidence,
  validateMaterialEventPage,
  validateProductCorrelationTrace,
  validateProductSupervisorEnvelope,
} from '../../src/lib/productIntegration/model.ts';
import {
  PRODUCT_MATERIAL_CURSOR_STORAGE_KEY,
  persistDurableMaterialCursor,
  proveMaterialContinuity,
  readDurableMaterialCursor,
} from '../../src/lib/productIntegration/useProductControlRoomBinding.ts';
import { buildProductControlRoomFixture } from '../../src/features/productControlRoom/fixtureBinding.ts';
import { controlResultTruthLabel } from '../../src/features/productControlRoom/components/ControlRegistryPanel.tsx';

const NOW = 1_800_000_000_000;

const materialEvent = (cursor) => ({
  cursor,
  eventId: `evt-${cursor}`,
  occurredAtMs: NOW,
  componentId: 'source',
  kind: 'material',
  correlationId: `corr-${cursor}`,
  truthLabel: 'LIVE_PUBLIC',
});

function materialPage({
  mode = 'CURSOR',
  after,
  next,
  highWater = next,
  retained = highWater === '0' ? null : '1',
  items = [],
  missingRange = null,
  continuity = 'PROVEN',
  truncated = false,
  backfillRequired = false,
}) {
  return {
    schemaVersion: MATERIAL_CURSOR_SCHEMA,
    mode,
    requestedAfterCursor: after,
    retainedFromCursor: retained,
    highWaterCursor: highWater,
    nextCursor: next,
    hasMore: BigInt(next) < BigInt(highWater),
    continuity,
    truncated,
    backfillRequired,
    missingRange,
    items,
  };
}

test('required fixture registry is exact and stable', () => {
  assert.deepEqual(REQUIRED_FIXTURE_SCENARIOS, [
    'HEALTHY_OBSERVE',
    'DEGRADED_STALE_SOURCES',
    'VALIDATE_ONLY_SLICE_RUNNING',
    'RECOVERY_REQUIRED_ONE_LEG',
    'TINY_LIVE_CANARY_OWNER_GATED',
  ]);
});

for (const scenarioId of REQUIRED_FIXTURE_SCENARIOS) {
  test(`${scenarioId} advances on an injected monotonic clock and remains synthetic`, () => {
    const initial = createFixtureSession(scenarioId, `test-${scenarioId}`, NOW);
    const advanced = advanceFixtureSession(initial, NOW + 11_000);
    const snapshot = buildProductControlRoomFixture(advanced);
    assert.equal(advanced.tick, 2);
    assert.equal(snapshot.truthLabel, 'SYNTHETIC_ONLY');
    assert.equal(snapshot.persistentSyntheticLabel, true);
    assert.equal(snapshot.ownerView.tradeReady, 'NO');
    if (scenarioId === 'RECOVERY_REQUIRED_ONE_LEG') assert.equal(snapshot.dashboard.summaries.capital.activeExposureAmount, snapshot.ownerView.exposedCapital);
    if (scenarioId === 'TINY_LIVE_CANARY_OWNER_GATED') assert.equal(snapshot.dashboard.overallPosture, 'BLOCKED');
    assert.equal(snapshot.materialEvents.continuity, 'PROVEN');
    assert.deepEqual(validateProductSupervisorEnvelope(snapshot), []);
    assert.equal(snapshot.traces[0].stages.length, 12);
    assert.equal(Object.keys(snapshot.surfaces).length, REQUIRED_SURFACE_IDS.length);
    for (const surfaceId of REQUIRED_SURFACE_IDS) {
      const surface = snapshot.surfaces[surfaceId];
      assert.equal(surface.surfaceId, surfaceId);
      const blocker = productSurfaceReadinessBlocker(surface);
      if (blocker !== null) {
        assert.equal(surface.bindingState, 'BLOCKED_BACKEND');
        assert.ok(['BLOCKED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING', 'UNKNOWN'].includes(surface.truthLabel));
        assert.equal(surface.blocker, blocker);
      }
    }
  });
}

test('a shape-valid surface cannot claim LIVE_PUBLIC or BINDING_READY with required MISSING evidence', () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'surface-false-green', NOW));
  const dashboard = snapshot.surfaces.dashboard;
  const relationalBlocker = productSurfaceReadinessBlocker(dashboard);
  assert.match(relationalBlocker ?? '', /^REQUIRED_EVIDENCE_MISSING:/);

  const hostile = {
    ...snapshot,
    surfaces: {
      ...snapshot.surfaces,
      dashboard: {
        ...dashboard,
        bindingState: 'BINDING_READY',
        truthLabel: 'LIVE_PUBLIC',
        blocker: null,
      },
    },
  };
  const errors = validateProductSupervisorEnvelope(hostile);
  assert.ok(errors.includes(`SURFACE_REQUIRED_EVIDENCE_FALSE_GREEN:dashboard:${relationalBlocker}`));
  assert.ok(errors.includes(`SURFACE_REQUIRED_EVIDENCE_TRUTH_CONTRADICTION:dashboard:${relationalBlocker}`));
  assert.ok(errors.includes(`SURFACE_REQUIRED_EVIDENCE_BLOCKER_MISSING:dashboard:${relationalBlocker}`));
});

test('fixture kill switch mirrors server asymmetry and does not auto-resume intake', () => {
  const initial = createFixtureSession('HEALTHY_OBSERVE', 'kill', NOW);
  const engaged = applyFixtureControl(initial, 'global.kill-switch.engage', 'fixture-rev-1');
  assert.equal(engaged.killSwitchEngaged, true);
  assert.equal(engaged.intakePaused, true);
  const released = applyFixtureControl(engaged, 'global.kill-switch.engage', 'fixture-rev-2');
  assert.equal(released.killSwitchEngaged, false);
  assert.equal(released.intakePaused, true);
});

test('stale fixture command rejects without changing the revision', () => {
  const initial = createFixtureSession('VALIDATE_ONLY_SLICE_RUNNING', 'stale', NOW);
  const rejected = applyFixtureControl(initial, 'global.safe-mode', 'fixture-rev-999');
  assert.equal(rejected.controlRevision, initial.controlRevision);
  assert.equal(rejected.lastResult?.status, 'REJECTED_STALE_REVISION');
});

test('owner-gated controls are nonfunctional and have no preview', () => {
  const session = createFixtureSession('TINY_LIVE_CANARY_OWNER_GATED', 'canary', NOW);
  const snapshot = buildFixtureBinding(session, {});
  const canary = snapshot.controls.find((control) => control.controlId === 'canary.request');
  assert.ok(canary);
  assert.equal(isFunctionalWiringState(canary.wiringState), false);
  assert.equal(canary.preview, null);
  assert.match(canary.disabledReason ?? '', /Owner authorization/);
});

test('cursor validator rejects gaps, truncation, and unproven continuity', () => {
  const page = {
    schemaVersion: MATERIAL_CURSOR_SCHEMA,
    mode: 'CURSOR',
    requestedAfterCursor: '5',
    retainedFromCursor: '1',
    highWaterCursor: '8',
    nextCursor: '8',
    hasMore: false,
    continuity: 'UNPROVEN',
    truncated: true,
    backfillRequired: true,
    missingRange: { fromCursor: '6', toCursor: '7', reason: 'INTERIOR_GAP' },
    items: [{ cursor: '8', eventId: 'evt-8', occurredAtMs: NOW, componentId: 'source', kind: 'material', correlationId: null, truthLabel: 'LIVE_PUBLIC' }],
  };
  const errors = validateMaterialEventPage('5', page);
  assert.ok(errors.includes('MATERIAL_CURSOR_UNPROVEN'));
  assert.ok(errors.includes('MATERIAL_BACKFILL_REQUIRED'));
  assert.ok(errors.includes('MATERIAL_CURSOR_NOT_GAP_FREE'));
});

test('cursor validator bounds hostile payloads without throwing', () => {
  assert.deepEqual(validateMaterialEventPage('0', null), ['MATERIAL_PAGE_INVALID']);
  const malformed = validateMaterialEventPage('9'.repeat(41), { schemaVersion: MATERIAL_CURSOR_SCHEMA, items: null });
  assert.ok(malformed.includes('MATERIAL_CURSOR_INVALID'));
  assert.ok(malformed.includes('MATERIAL_ITEMS_INVALID'));
  assert.ok(validateMaterialEventPage('9223372036854775808', { schemaVersion: MATERIAL_CURSOR_SCHEMA, items: [] }).includes('MATERIAL_CURSOR_INVALID'));
});

test('tail bootstrap accepts only fully retained omission and rejects false-proven retention loss', () => {
  const ordinaryTail = materialPage({
    mode: 'TAIL_BOOTSTRAP',
    after: '5',
    next: '6',
    retained: '1',
    items: [materialEvent('6')],
    missingRange: { fromCursor: '1', toCursor: '5', reason: 'BOOTSTRAP_HISTORY_OMITTED' },
  });
  assert.deepEqual(validateMaterialEventPage('5', ordinaryTail, 'TAIL_BOOTSTRAP'), []);

  const retainedTail = materialPage({
    mode: 'TAIL_BOOTSTRAP',
    after: '9',
    next: '10',
    retained: '10',
    items: [materialEvent('10')],
    missingRange: { fromCursor: '1', toCursor: '9', reason: 'RETENTION_GAP' },
  });
  assert.ok(validateMaterialEventPage('9', retainedTail, 'TAIL_BOOTSTRAP').includes('MATERIAL_RETENTION_STATE_CONTRADICTION'));
  const honestRetainedTail = {
    ...retainedTail,
    continuity: 'GAP',
    truncated: true,
    backfillRequired: true,
  };
  const honestErrors = validateMaterialEventPage('9', honestRetainedTail, 'TAIL_BOOTSTRAP');
  assert.ok(honestErrors.includes('MATERIAL_CURSOR_GAP'));
  assert.ok(honestErrors.includes('MATERIAL_BACKFILL_REQUIRED'));
  assert.ok(!honestErrors.includes('MATERIAL_RETENTION_STATE_CONTRADICTION'));
  assert.ok(validateMaterialEventPage('9', { ...retainedTail, retainedFromCursor: '8' }, 'TAIL_BOOTSTRAP').includes('MATERIAL_RETENTION_RANGE_INVALID'));
  assert.ok(validateMaterialEventPage('9', retainedTail, 'CURSOR').includes('MATERIAL_PAGE_MODE_MISMATCH'));
});

test('cursor pages require progress, exact high-water geometry, and no missing range', () => {
  const valid = materialPage({ after: '7', next: '8', highWater: '8', items: [materialEvent('8')] });
  assert.deepEqual(validateMaterialEventPage('7', valid), []);
  const stalled = materialPage({ after: '7', next: '7', highWater: '8', items: [] });
  assert.ok(validateMaterialEventPage('7', stalled).includes('MATERIAL_CURSOR_NO_PROGRESS'));
  const hiddenGap = { ...valid, missingRange: { fromCursor: '1', toCursor: '7', reason: 'BOOTSTRAP_HISTORY_OMITTED' } };
  assert.ok(validateMaterialEventPage('7', hiddenGap).includes('MATERIAL_BACKFILL_REQUIRED'));
});

test('durable cursor storage is monotonic and verifies persistence', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.deepEqual(readDurableMaterialCursor(storage), { state: 'ABSENT', cursor: null });
  assert.equal(persistDurableMaterialCursor('12', storage), true);
  assert.equal(values.get(PRODUCT_MATERIAL_CURSOR_STORAGE_KEY), '12');
  assert.deepEqual(readDurableMaterialCursor(storage), { state: 'VALID', cursor: '12' });
  assert.equal(persistDurableMaterialCursor('11', storage), false);
  assert.deepEqual(readDurableMaterialCursor(storage), { state: 'VALID', cursor: '12' });
  assert.equal(persistDurableMaterialCursor('9223372036854775807', storage), true);
  assert.equal(persistDurableMaterialCursor('9223372036854775808', storage), false);
  assert.deepEqual(readDurableMaterialCursor(storage), { state: 'VALID', cursor: '9223372036854775807' });
  values.set(PRODUCT_MATERIAL_CURSOR_STORAGE_KEY, 'not-a-cursor');
  assert.deepEqual(readDurableMaterialCursor(storage), { state: 'INVALID', cursor: null });
  assert.equal(persistDurableMaterialCursor('13', storage), false);
  assert.equal(values.get(PRODUCT_MATERIAL_CURSOR_STORAGE_KEY), 'not-a-cursor');
  const unavailable = { getItem: () => { throw new Error('storage denied'); }, setItem: () => undefined };
  assert.deepEqual(readDurableMaterialCursor(unavailable), { state: 'UNAVAILABLE', cursor: null });
});

test('malformed or unavailable durable evidence cannot enter tail bootstrap', async () => {
  let reads = 0;
  const client = { readMaterialEvents: async () => { reads += 1; throw new Error('must not read'); } };
  const tail = materialPage({ mode: 'TAIL_BOOTSTRAP', after: '0', next: '0', highWater: '0', retained: null });
  await assert.rejects(
    proveMaterialContinuity({ client, supervisorPage: tail, durableCursor: { state: 'INVALID', cursor: null } }),
    /malformed/,
  );
  await assert.rejects(
    proveMaterialContinuity({ client, supervisorPage: tail, durableCursor: { state: 'UNAVAILABLE', cursor: null } }),
    /unavailable/,
  );
  assert.equal(reads, 0);
});

test('saved nonzero cursor is honored before the supervisor tail', async () => {
  const calls = [];
  const persisted = [];
  const client = {
    readMaterialEvents: async (after) => {
      calls.push(after);
      return materialPage({ after, next: '8', highWater: '8', items: [materialEvent('8')] });
    },
  };
  const supervisorPage = materialPage({
    mode: 'TAIL_BOOTSTRAP', after: '99', next: '100', retained: '1', items: [materialEvent('100')],
    missingRange: { fromCursor: '1', toCursor: '99', reason: 'BOOTSTRAP_HISTORY_OMITTED' },
  });
  const proof = await proveMaterialContinuity({
    client,
    supervisorPage,
    durableCursor: { state: 'VALID', cursor: '7' },
    persistCursor: (cursor) => { persisted.push(cursor); return true; },
  });
  assert.deepEqual(calls, ['7']);
  assert.deepEqual(persisted, ['8']);
  assert.equal(proof.continuity, 'PROVEN');
});

test('first run durably accepts the tail baseline, then proves a cursor page', async () => {
  const calls = [];
  const persisted = [];
  const supervisorPage = materialPage({
    mode: 'TAIL_BOOTSTRAP', after: '5', next: '6', retained: '1', items: [materialEvent('6')],
    missingRange: { fromCursor: '1', toCursor: '5', reason: 'BOOTSTRAP_HISTORY_OMITTED' },
  });
  const proof = await proveMaterialContinuity({
    client: {
      readMaterialEvents: async (after) => {
        calls.push(after);
        return materialPage({ after, next: after, highWater: after, retained: '1' });
      },
    },
    supervisorPage,
    durableCursor: { state: 'ABSENT', cursor: null },
    persistCursor: (cursor) => { persisted.push(cursor); return true; },
  });
  assert.deepEqual(calls, ['6']);
  assert.deepEqual(persisted, ['6', '6']);
  assert.equal(proof.continuity, 'PROVEN');
});

test('bounded catch-up stays blocked and persistence failure rejects', async () => {
  const client = {
    readMaterialEvents: async (after) => {
      const next = String(BigInt(after) + 1n);
      return materialPage({ after, next, highWater: '5', items: [materialEvent(next)] });
    },
  };
  const tail = materialPage({ mode: 'TAIL_BOOTSTRAP', after: '0', next: '0', highWater: '0', retained: null });
  const proof = await proveMaterialContinuity({ client, supervisorPage: tail, durableCursor: { state: 'VALID', cursor: '0' }, persistCursor: () => true, maxPages: 2 });
  assert.equal(proof.continuity, 'BACKFILL');
  assert.equal(proof.cursor, '2');
  await assert.rejects(
    proveMaterialContinuity({ client, supervisorPage: tail, durableCursor: { state: 'ABSENT', cursor: null }, persistCursor: () => false }),
    /durably persisted/,
  );
});

test('envelope validator rejects synthetic data without its persistent label', () => {
  const session = createFixtureSession('HEALTHY_OBSERVE', 'label', NOW);
  const snapshot = buildProductControlRoomFixture(session);
  const errors = validateProductSupervisorEnvelope({ ...snapshot, persistentSyntheticLabel: false });
  assert.ok(errors.includes('SYNTHETIC_LABEL_NOT_PERSISTENT'));
});

test('nested synthetic truth requires the persistent banner even when top-level truth is not synthetic', () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'nested-label', NOW));
  const errors = validateProductSupervisorEnvelope({
    ...snapshot,
    truthLabel: 'BUILT_AND_TESTED',
    persistentSyntheticLabel: false,
  });
  assert.ok(errors.includes('SYNTHETIC_LABEL_NOT_PERSISTENT'));
});

test('trace validator distinguishes complete absence from truncation uncertainty', () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'trace', NOW));
  const complete = snapshot.traces[0];
  assert.deepEqual(validateProductCorrelationTrace(complete, complete.correlationId), []);
  const truncated = {
    ...complete,
    truncated: true,
    completeness: 'TRUNCATED',
    stages: complete.stages.map((stage) => stage.evidenceState === 'PRESENT' ? stage : {
      ...stage,
      truthLabel: 'UNKNOWN',
      outcome: 'UNKNOWN_DUE_TO_TRACE_TRUNCATION',
      evidenceState: 'UNKNOWN_DUE_TO_TRUNCATION',
    }),
  };
  assert.deepEqual(validateProductCorrelationTrace(truncated, complete.correlationId), []);
  assert.ok(validateProductCorrelationTrace({
    ...complete,
    stages: [complete.stages[1], complete.stages[0], ...complete.stages.slice(2)],
  }).includes('TRACE_STAGE_ORDER_INVALID'));
  assert.ok(validateProductCorrelationTrace({
    ...truncated,
    stages: truncated.stages.map((stage, index) => index === 11 ? { ...stage, evidenceState: 'ABSENT' } : stage),
  }).includes('TRACE_STAGE_ABSENT_ON_TRUNCATED_TRACE'));
  assert.ok(validateProductCorrelationTrace({ ...complete, completeness: 'TRUNCATED' }).includes('TRACE_COMPLETENESS_INVALID'));
  const absentIndex = complete.stages.findIndex((stage) => stage.evidenceState === 'ABSENT');
  assert.ok(absentIndex >= 0);
  const falseGreenAbsent = {
    ...complete,
    stages: complete.stages.map((stage, index) => index === absentIndex ? { ...stage, truthLabel: 'LIVE_PUBLIC' } : stage),
  };
  assert.ok(validateProductCorrelationTrace(falseGreenAbsent).includes('TRACE_STAGE_ABSENT_TRUTH_INVALID'));
  const arbitraryAbsent = {
    ...complete,
    stages: complete.stages.map((stage, index) => index === absentIndex ? { ...stage, outcome: 'READY' } : stage),
  };
  assert.ok(validateProductCorrelationTrace(arbitraryAbsent).includes('TRACE_STAGE_ABSENT_OUTCOME_INVALID'));
  const arbitraryTruncation = {
    ...truncated,
    stages: truncated.stages.map((stage) => stage.evidenceState === 'UNKNOWN_DUE_TO_TRUNCATION' ? { ...stage, outcome: 'MAYBE' } : stage),
  };
  assert.ok(validateProductCorrelationTrace(arbitraryTruncation).includes('TRACE_STAGE_TRUNCATION_OUTCOME_INVALID'));
});

test('UNAVAILABLE and UNKNOWN product truth values remain distinct and valid', () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'unknown-truth', NOW));
  const unavailableTrace = {
    ...snapshot.traces[0],
    stages: snapshot.traces[0].stages.map((stage, index) => index === 0 ? { ...stage, truthLabel: 'UNAVAILABLE' } : stage),
  };
  assert.deepEqual(validateProductCorrelationTrace(unavailableTrace), []);
  const unknownTrace = {
    ...snapshot.traces[0],
    stages: snapshot.traces[0].stages.map((stage, index) => index === 0 ? { ...stage, truthLabel: 'UNKNOWN' } : stage),
  };
  assert.deepEqual(validateProductCorrelationTrace(unknownTrace), []);
});

test('standalone synthetic trace evidence requires the persistent page banner', async () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'live-trace-banner', NOW));
  assert.equal(productTraceHasSyntheticEvidence(snapshot.traces[0]), true);
  const source = await readFile(new URL('../../src/features/productControlRoom/ProductControlRoom.tsx', import.meta.url), 'utf8');
  assert.match(source, /productTraceHasSyntheticEvidence\(liveTrace\)/);
  assert.match(source, /SYNTHETIC EVIDENCE · NO LIVE AUTHORITY/);
});

test('incident availability prevents an empty array from becoming false all-clear', () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('DEGRADED_STALE_SOURCES', 'incidents', NOW));
  const unavailable = {
    ...snapshot,
    incidentAvailability: { state: 'NOT_CONFIGURED', truthLabel: 'NOT_CONFIGURED', blocker: 'INCIDENT_OWNER_NOT_CONFIGURED' },
  };
  assert.ok(validateProductSupervisorEnvelope(unavailable).includes('INCIDENTS_PUBLISHED_WHILE_UNAVAILABLE'));
  assert.ok(validateProductSupervisorEnvelope({ ...snapshot, incidentAvailability: undefined }).includes('INCIDENT_AVAILABILITY_INVALID'));
  const falseAvailable = {
    ...snapshot,
    incidents: [],
    incidentAvailability: { state: 'AVAILABLE', truthLabel: 'UNAVAILABLE', blocker: null },
  };
  assert.ok(validateProductSupervisorEnvelope(falseAvailable).includes('INCIDENT_AVAILABILITY_TRUTH_MISMATCH'));
});

test('owner machine readiness requires dashboard READY plus published advance evidence', () => {
  const ready = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'ready-map', NOW));
  assert.ok(validateProductSupervisorEnvelope({ ...ready, ownerView: { ...ready.ownerView, machineReady: 'NO' } }).includes('OWNER_DASHBOARD_READINESS_MISMATCH'));
  const degraded = buildProductControlRoomFixture(createFixtureSession('DEGRADED_STALE_SOURCES', 'degraded-map', NOW));
  assert.ok(validateProductSupervisorEnvelope({ ...degraded, ownerView: { ...degraded.ownerView, machineReady: 'YES' } }).includes('OWNER_DASHBOARD_READINESS_MISMATCH'));
  assert.ok(validateProductSupervisorEnvelope({ ...ready, ownerView: { ...ready.ownerView, tradeReady: 'YES' } }).includes('OWNER_TRADE_READY_INVALID'));
});

test('browser accepts only fail-closed relational Ledger schema compatibility truth', () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'ledger-schema', NOW));
  const ledger = snapshot.dashboard.summaries.ledger;
  assert.deepEqual({
    state: ledger.schemaCompatibilityState,
    current: ledger.currentSchemaVersion,
    floor: ledger.rollbackFloor,
  }, { state: 'AVAILABLE', current: 1, floor: 1 });
  assert.deepEqual(validateProductSupervisorEnvelope(snapshot), []);

  const withLedger = (next) => ({
    ...snapshot,
    dashboard: {
      ...snapshot.dashboard,
      summaries: { ...snapshot.dashboard.summaries, ledger: { ...ledger, ...next } },
    },
  });
  for (const hostile of [
    { rollbackFloor: 2 },
    { currentSchemaVersion: 1.5 },
    { schemaCompatibilityReason: 'SHOULD_BE_NULL' },
    { schemaCompatibilityState: 'MISMATCH', schemaCompatibilityReason: 'LEDGER_SCHEMA_VERSION_MISMATCH', currentSchemaVersion: 1, rollbackFloor: 1, truthLabel: 'UNAVAILABLE' },
    { schemaCompatibilityState: 'UNAVAILABLE', schemaCompatibilityReason: 'LEDGER_SCHEMA_COMPATIBILITY_UNAVAILABLE', currentSchemaVersion: null, rollbackFloor: null, truthLabel: 'LIVE_PUBLIC' },
  ]) {
    assert.ok(validateProductSupervisorEnvelope(withLedger(hostile)).includes('DASHBOARD_SUMMARY_INVALID:ledger'));
  }
  const unavailable = withLedger({
    truthLabel: 'UNAVAILABLE',
    schemaCompatibilityState: 'UNAVAILABLE',
    schemaCompatibilityReason: 'LEDGER_SCHEMA_COMPATIBILITY_UNAVAILABLE',
    currentSchemaVersion: null,
    rollbackFloor: null,
  });
  assert.equal(validateProductSupervisorEnvelope(unavailable).includes('DASHBOARD_SUMMARY_INVALID:ledger'), false);
});

test('READY posture with null meaningful advance cannot validate YES or render header green', () => {
  const ready = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'null-advance', NOW));
  const health = ready.surfaces.health;
  const withoutAdvance = {
    ...ready,
    surfaces: {
      ...ready.surfaces,
      health: {
        ...health,
        evidence: health.evidence.map((datum) => datum.fieldId === 'heartbeat-advance' ? {
          ...datum,
          value: null,
          truthLabel: 'UNKNOWN',
          unavailableReason: 'CANONICAL_MEANINGFUL_ADVANCE_NOT_PUBLISHED',
        } : datum),
      },
    },
  };
  assert.ok(validateProductSupervisorEnvelope(withoutAdvance).includes('OWNER_MEANINGFUL_ADVANCE_REQUIRED'));
  const conservative = {
    ...withoutAdvance,
    ownerView: {
      ...withoutAdvance.ownerView,
      machineReady: 'UNKNOWN',
      topRootBlocker: 'CANONICAL_MEANINGFUL_ADVANCE_NOT_PUBLISHED',
    },
  };
  assert.equal(validateProductSupervisorEnvelope(conservative).includes('OWNER_MEANINGFUL_ADVANCE_REQUIRED'), false);
  assert.equal(productMachineReadinessTone(conservative.ownerView.machineReady), 'warn');
  assert.equal(productMachineReadinessTone('NO'), 'warn');
  assert.equal(productMachineReadinessTone('YES'), 'ok');
});

test('owner latest material change is unavailable until the material page reaches high water', () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'material-prefix', NOW));
  const highWaterCursor = String(BigInt(snapshot.materialEvents.nextCursor) + 1n);
  const prefix = {
    ...snapshot,
    materialEvents: {
      ...snapshot.materialEvents,
      highWaterCursor,
      hasMore: true,
    },
  };
  assert.notEqual(prefix.ownerView.latestMaterialChange, null);
  assert.ok(validateProductSupervisorEnvelope(prefix).includes('OWNER_MATERIAL_LATEST_CHANGE_NOT_AT_HIGH_WATER'));
  assert.ok(validateProductSupervisorEnvelope({
    ...prefix,
    materialEvents: { ...prefix.materialEvents, hasMore: false },
  }).includes('OWNER_MATERIAL_LATEST_CHANGE_NOT_AT_HIGH_WATER'));
});

test('control result truth never labels absence as canonical evidence', () => {
  assert.equal(controlResultTruthLabel(null), 'NO_RESULT_TRUTH');
  assert.equal(controlResultTruthLabel({ synthetic: true }), 'SYNTHETIC');
  assert.equal(controlResultTruthLabel({ synthetic: false }), 'CANONICAL');
});

test('envelope validator fails closed on empty owner and dashboard records', () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('HEALTHY_OBSERVE', 'hostile', NOW));
  const errors = validateProductSupervisorEnvelope({ ...snapshot, ownerView: {}, dashboard: {} });
  assert.ok(errors.includes('OWNER_PROCESS_ALIVE_INVALID'));
  assert.ok(errors.includes('DASHBOARD_SCHEMA_INVALID'));
});

test('envelope validator rejects contradictory capital and malformed control truth', () => {
  const snapshot = buildProductControlRoomFixture(createFixtureSession('RECOVERY_REQUIRED_ONE_LEG', 'adversarial', NOW));
  const malformedControl = {
    ...snapshot.controls[0],
    payload: { limit: Number.NaN },
    latestResult: {
      commandId: 'wrong', controlId: 'another-control', status: 'APPLIED', before: 'A', after: 'B',
      receiptId: null, correlationId: 'correlation', completedAtMs: NOW, synthetic: true,
    },
  };
  const errors = validateProductSupervisorEnvelope({
    ...snapshot,
    ownerView: { ...snapshot.ownerView, exposedCapital: '0.00 USDT SYNTHETIC', unresolvedRecovery: null },
    controls: [malformedControl, ...snapshot.controls.slice(1)],
  });
  assert.ok(errors.includes('OWNER_DASHBOARD_EXPOSURE_MISMATCH'));
  assert.ok(errors.includes('CONTROL_PAYLOAD_INVALID'));
  assert.ok(errors.includes('CONTROL_RESULT_INVALID'));
  assert.ok(errors.includes('CONTROL_RESULT_ID_MISMATCH'));
});

test('fixture command validates full preview authority, is idempotent, and resolves async recovery', () => {
  const initial = createFixtureSession('RECOVERY_REQUIRED_ONE_LEG', 'recovery', NOW);
  const snapshot = buildProductControlRoomFixture(initial);
  const control = snapshot.controls.find((entry) => entry.controlId === 'recovery.execute-plan');
  assert.ok(control?.preview);
  const request = {
    schemaVersion: 'product-command.v1',
    idempotencyKey: 'fixture-idempotency-recovery-1',
    controlId: control.controlId,
    backendCommandId: control.backendCommandId,
    targetType: control.targetType,
    targetId: control.targetId,
    payload: control.payload,
    currentRevision: control.currentStateRevision,
    expectedRevision: control.preview.expectedRevision,
    previewId: control.preview.previewId,
    previewDigest: control.preview.digest,
    expiresAtMs: control.preview.expiresAtMs,
    reason: 'Focused synthetic recovery proof.',
  };
  const accepted = applyFixtureCommand(initial, request);
  assert.equal(accepted.lastResult?.status, 'ACCEPTED_ASYNC');
  assert.equal(applyFixtureCommand(accepted, request), accepted);
  const resolved = advanceFixtureSession(accepted, NOW + 5_000);
  assert.equal(resolved.lastResult?.status, 'APPLIED');
  const resolvedSnapshot = buildProductControlRoomFixture(resolved);
  assert.equal(resolvedSnapshot.ownerView.unresolvedRecovery, 'NONE');
  assert.equal(resolvedSnapshot.ownerView.exposedCapital, '0.00 USDT SYNTHETIC');
  assert.equal(resolvedSnapshot.incidents.length, 0);
  assert.equal(resolvedSnapshot.dashboard.summaries.capital.activeExposureAmount, resolvedSnapshot.ownerView.exposedCapital);
  assert.deepEqual(validateProductSupervisorEnvelope(resolvedSnapshot), []);
});


test('binding wrapper consumes the donor through a structural read-only projection', async () => {
  const source = await readFile(new URL('../../src/features/productControlRoom/ProductControlRoom.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../src/features/productControlRoom/styles/productControlRoom.css', import.meta.url), 'utf8');
  assert.match(source, /systemDashboard\/SystemDashboard/);
  assert.match(source, /readOnlyProjection/);
  assert.doesNotMatch(source, /mutate=\{\(\) => undefined\}/);
  assert.doesNotMatch(css, /sdx-section\[aria-label="Controls"\]/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.match(source, /pcr-binding-blocker/);
});

test('pure product model has no ambient clock, randomness, environment, or network access', async () => {
  const source = await readFile(new URL('../../src/lib/productIntegration/model.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test('route binding cadence and event page are bounded without hardcoded endpoints', async () => {
  const hook = await readFile(new URL('../../src/lib/productIntegration/useProductControlRoomBinding.ts', import.meta.url), 'utf8');
  const transport = await readFile(new URL('../../src/lib/productIntegration/httpTransport.ts', import.meta.url), 'utf8');
  assert.match(hook, /cadenceMs = 5_000/);
  assert.match(hook, /initialMaterialCursor: Readonly<DurableMaterialCursorRead>/);
  assert.match(hook, /PRODUCT_MATERIAL_PAGE_LIMIT = 200/);
  assert.match(hook, /PRODUCT_MATERIAL_MAX_PAGES_PER_REFRESH = 8/);
  assert.doesNotMatch(transport, /\/api\//);
});
