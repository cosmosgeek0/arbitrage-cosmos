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
  validateMaterialEventPage,
  validateProductSupervisorEnvelope,
} from '../../src/lib/productIntegration/model.ts';
import { buildProductControlRoomFixture } from '../../src/features/productControlRoom/fixtureBinding.ts';

const NOW = 1_800_000_000_000;

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
      assert.equal(snapshot.surfaces[surfaceId].surfaceId, surfaceId);
      assert.equal(snapshot.surfaces[surfaceId].truthLabel, 'SYNTHETIC_ONLY');
    }
  });
}

test('fixture kill switch mirrors server asymmetry and does not auto-resume intake', () => {
  const initial = createFixtureSession('HEALTHY_OBSERVE', 'kill', NOW);
  const engaged = applyFixtureControl(initial, 'global.kill-switch', 'fixture-rev-1');
  assert.equal(engaged.killSwitchEngaged, true);
  assert.equal(engaged.intakePaused, true);
  const released = applyFixtureControl(engaged, 'global.kill-switch', 'fixture-rev-2');
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
    requestedAfterCursor: '5',
    nextCursor: '8',
    continuity: 'UNPROVEN',
    truncated: true,
    backfillRequired: true,
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
});

test('envelope validator rejects synthetic data without its persistent label', () => {
  const session = createFixtureSession('HEALTHY_OBSERVE', 'label', NOW);
  const snapshot = buildProductControlRoomFixture(session);
  const errors = validateProductSupervisorEnvelope({ ...snapshot, persistentSyntheticLabel: false });
  assert.ok(errors.includes('SYNTHETIC_LABEL_NOT_PERSISTENT'));
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


test('binding wrapper consumes the donor and suppresses its fixture-only control panel', async () => {
  const source = await readFile(new URL('../../src/features/productControlRoom/ProductControlRoom.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../src/features/productControlRoom/styles/productControlRoom.css', import.meta.url), 'utf8');
  assert.match(source, /systemDashboard\/SystemDashboard/);
  assert.match(css, /sdx-section\[aria-label="Controls"\]/);
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
  assert.match(hook, /initialMaterialCursor = '0'/);
  assert.match(hook, /readMaterialEvents\(afterCursor, 200\)/);
  assert.doesNotMatch(transport, /\/api\//);
});
