import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  I00_MANAGED_COMPONENT_IDENTITIES,
  PRODUCT_RUNTIME_TRACE_STAGES,
  buildProductRuntimeSupervisorEnvelope,
  createProductIntegrationRuntime,
  projectProductCorrelationTrace,
  projectProductMaterialEventPage,
} from '../../../dist/productIntegration/runtime/index.js';
import {
  T0,
  makeBootReleaseReadback,
  makeOpsInterlock,
  makeOpsReadback,
  makeRead,
  makeRecords,
  makeSupervisor,
  traceEvent,
} from './testSupport.mjs';

const OPS_PROJECTION = Object.freeze({
  applicationStartOk: true,
  opsReadback: makeOpsReadback(),
  opsIntakeInterlock: makeOpsInterlock(),
});

const SURFACE_BLOCKING_TRUTH = new Set(['BLOCKED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING', 'UNKNOWN']);

function requiredSurfaceBlocker(surface) {
  return surface.evidence.find((datum) => datum.value === null || SURFACE_BLOCKING_TRUTH.has(datum.truthLabel)) ?? null;
}

test('Product readiness consumes the exact canonical application-start result', async () => {
  const service = createProductIntegrationRuntime({
    read: makeRead({
      applicationStartOk: false,
      applicationStartFailureCodes: ['BOOT_RELEASE_READ_FAILED'],
    }),
    clock: { nowMs: () => T0 },
  });
  const envelope = await service.readSupervisor();
  assert.equal(envelope.dashboard.overallPosture, 'READY');
  assert.equal(envelope.ownerView.machineReady, 'UNKNOWN');
  assert.equal(envelope.ownerView.topRootBlocker, 'BOOT_RELEASE_READ_FAILED');
  assert.equal(envelope.ownerView.tradeReady, 'NO');
});

test('production runtime barrel is fixture-free and supervisor envelope is exact and non-money', async () => {
  const source = await readFile(new URL('../../../src/productIntegration/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fixtures/);
  const service = createProductIntegrationRuntime({ read: makeRead(), clock: { nowMs: () => T0 } });
  const envelope = await service.readSupervisor();
  assert.equal(envelope.schemaVersion, 'product-supervisor.v1');
  assert.equal(envelope.ownerView.machineReady, 'YES');
  assert.equal(envelope.ownerView.tradeReady, 'NO');
  assert.deepEqual(envelope.opsReadback, makeOpsReadback());
  assert.equal(envelope.opsIntakeInterlock.state, 'OPS_INTERLOCK_CLEAR');
  assert.equal(envelope.opsIntakeInterlock.blocksNewEntries, false);
  assert.equal(envelope.opsIntakeInterlock.externalActionAuthorization, 'NONE');
  assert.equal(envelope.dashboard.overallPosture, 'READY');
  assert.deepEqual({
    state: envelope.dashboard.summaries.ledger.schemaCompatibilityState,
    current: envelope.dashboard.summaries.ledger.currentSchemaVersion,
    floor: envelope.dashboard.summaries.ledger.rollbackFloor,
  }, { state: 'AVAILABLE', current: 1, floor: 1 });
  assert.equal(envelope.components.length, 14);
  const publicSpot = envelope.components.find((component) => component.componentId === 'public-spot-source');
  const basis = envelope.components.find((component) => component.componentId === 'basis-engine');
  assert.deepEqual(publicSpot.canonicalPresentation, {
    status: 'operational', tone: 'ok', statusLabel: 'Live Public', stateLabel: 'READY · LIVE PUBLIC · LIVE PUBLIC',
  });
  assert.deepEqual(basis.canonicalPresentation, {
    status: 'degraded', tone: 'warn', statusLabel: 'Validate Only', stateLabel: 'READY · VALIDATE ONLY · BUILT AND TESTED',
  });
  assert.deepEqual(envelope.canonicalCockpit, {
    source: 'CANONICAL_SUPERVISOR_PRODUCT_PROJECTION',
    marketFeedReadiness: {
      proven: true,
      label: 'Market Feed Readiness Proven',
      detail: 'Canonical Spot and USD-M sources are READY · LIVE PUBLIC · LIVE PUBLIC; owner freshness 900ms max public-source age.',
    },
    strategyRuntime: { tone: 'warn', label: 'Validate-Only Ready', livePublicCount: 0 },
    watchmanOverall: { status: 'degraded', label: 'Validate Only' },
  });
  assert.equal(Object.keys(envelope.surfaces).length, 18);
  assert.equal(envelope.surfaces.dashboard.bindingState, 'BLOCKED_BACKEND');
  assert.equal(envelope.surfaces.dashboard.truthLabel, 'MISSING');
  assert.equal(envelope.surfaces.dashboard.blocker, 'REQUIRED_EVIDENCE_MISSING:pnl-drawdown');
  assert.equal(envelope.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.equal(envelope.surfaces.account.truthLabel, 'MISSING');
  assert.equal(envelope.surfaces.borrow.truthLabel, 'MISSING');
  assert.equal(envelope.surfaces.notifications.truthLabel, 'MISSING');
  assert.equal(envelope.surfaces.notifications.bindingState, 'BLOCKED_BACKEND');
  for (const surface of Object.values(envelope.surfaces)) {
    const blocker = requiredSurfaceBlocker(surface);
    if (blocker === null) continue;
    assert.equal(surface.bindingState, 'BLOCKED_BACKEND', `${surface.surfaceId} cannot bind with ${blocker.fieldId} missing`);
    assert.ok(SURFACE_BLOCKING_TRUTH.has(surface.truthLabel), `${surface.surfaceId} cannot stay green with ${blocker.fieldId} missing`);
    assert.match(surface.blocker ?? '', /^REQUIRED_EVIDENCE_/);
  }
  for (const surfaceId of ['control-room', 'health']) {
    const evidence = Object.fromEntries(envelope.surfaces[surfaceId].evidence.map((datum) => [datum.fieldId, datum]));
    assert.equal(evidence['deployment-frozen'].value, 'NOT_FROZEN');
    assert.equal(evidence['exposure-state'].value, 'NONE');
    assert.equal(evidence['ambiguity-state'].value, 'NONE');
    assert.equal(evidence['recovery-state'].value, 'NONE');
    assert.equal(evidence['ledger-schema-compatibility'].value, 'CURRENT 1 · ROLLBACK FLOOR 1');
    assert.equal(evidence['ops-interlock'].value, 'OPS_INTERLOCK_CLEAR');
  }
  assert.equal(envelope.ownerView.unresolvedRecovery, null);
  assert.equal(envelope.ownerView.topRootBlocker, null);
  assert.deepEqual(
    envelope.components.filter((component) => component.lastAdvanceAtMs !== null).map((component) => ({
      componentId: component.componentId,
      lastAdvanceAtMs: component.lastAdvanceAtMs,
    })),
    [{ componentId: 'public-usdm-source', lastAdvanceAtMs: T0 - 1_000 }],
  );
  const advanceEvidence = envelope.surfaces.health.evidence.find((datum) => datum.fieldId === 'heartbeat-advance');
  assert.equal(advanceEvidence.value, `public-usdm-source · ${T0 - 1_000}`);
  assert.equal(advanceEvidence.truthLabel, 'BUILT_AND_TESTED');
  assert.equal(advanceEvidence.unavailableReason, null);
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

test('I00 managed inventory reconciles all 33 roles without widening the 14-component supervisor', async () => {
  const service = createProductIntegrationRuntime({ read: makeRead(), clock: { nowMs: () => T0 } });
  const envelope = await service.readSupervisor();
  const inventory = envelope.managedInventory;
  const expectedI00IdentitySequence = [
    'operator-auth',
    'configuration-authority',
    'ledger-persistence',
    'database',
    'clock-sync',
    'spot-public-source',
    'usdm-public-source',
    'spot-private-truth',
    'usdm-private-truth',
    'margin-private-truth',
    'instrument-filter-registry',
    'universe',
    'evidence-attention-runtime',
    'q-inference',
    'basis-engine',
    'volume-engine',
    'opportunity-authority',
    'capital-supervision',
    'risk-gate',
    'execution-hand',
    'normal-basis-coordinator',
    'reverse-basis-coordinator',
    'volume-position-lifecycle',
    'reconciliation',
    'exposure-position-recovery',
    'outcome-feedback',
    'machine-supervisor',
    'api-read-model',
    'notification-incident-router',
    'web-cockpit',
    'backup-restore',
    'external-watchdog',
    'cloudflare-tunnel-access',
  ];

  assert.equal(inventory.schemaVersion, 'i00-managed-inventory.v1');
  assert.deepEqual({
    expected: inventory.expectedIdentityCount,
    mapped: inventory.mappedIdentityCount,
    evidencePresent: inventory.evidencePresentCount,
    ownerGated: inventory.ownerGatedCount,
    notConfigured: inventory.notConfiguredCount,
    missing: inventory.missingCount,
    canonical: inventory.canonicalComponentCount,
    referencedCanonical: inventory.referencedCanonicalComponentCount,
    observedCanonical: inventory.observedCanonicalComponentCount,
  }, {
    expected: 33,
    mapped: 14,
    evidencePresent: 14,
    ownerGated: 13,
    notConfigured: 3,
    missing: 3,
    canonical: 14,
    referencedCanonical: 14,
    observedCanonical: 14,
  });
  assert.equal(envelope.components.length, 14);
  assert.deepEqual(I00_MANAGED_COMPONENT_IDENTITIES, expectedI00IdentitySequence);
  assert.deepEqual(inventory.entries.map((entry) => entry.identity), expectedI00IdentitySequence);
  assert.equal(new Set(inventory.entries.map((entry) => entry.identity)).size, 33);
  assert.deepEqual(
    [...new Set(inventory.entries.flatMap((entry) => entry.canonicalComponentIds))].sort(),
    envelope.components.map((component) => component.componentId).sort(),
  );

  for (const entry of inventory.entries) {
    if (entry.inventoryState === 'EVIDENCE_PRESENT') {
      assert.equal(entry.reasonCode, null);
      assert.equal(entry.evidence.length, entry.canonicalComponentIds.length);
      entry.canonicalComponentIds.forEach((componentId, index) => {
        const canonical = envelope.components.find((component) => component.componentId === componentId);
        assert.deepEqual(entry.evidence[index], {
          source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION',
          componentId,
          componentProjectionIndex: envelope.components.indexOf(canonical),
        });
        assert.strictEqual(envelope.components[entry.evidence[index].componentProjectionIndex], canonical);
      });
    } else {
      assert.deepEqual(entry.canonicalComponentIds, []);
      assert.equal(entry.evidence, null);
      assert.match(entry.reasonCode, /^[A-Z][A-Z0-9_]+$/);
    }
  }

  const privateTruth = inventory.entries.filter((entry) => entry.identity.endsWith('-private-truth'));
  assert.equal(privateTruth.length, 3);
  assert.ok(privateTruth.every((entry) => entry.inventoryState === 'OWNER_GATED' && entry.evidence === null));
  const qInventory = inventory.entries.find((entry) => entry.identity === 'q-inference');
  const qCanonical = envelope.components.find((component) => component.componentId === 'q-inference');
  assert.strictEqual(envelope.components[qInventory.evidence[0].componentProjectionIndex], qCanonical);
  assert.equal(envelope.components[qInventory.evidence[0].componentProjectionIndex].truthLabel, qCanonical.truthLabel);
});

test('managed inventory withholds partial or duplicate canonical evidence instead of false-green coverage', () => {
  const source = makeSupervisor();
  const page = projectProductMaterialEventPage('0', 200, makeRead().events({ afterCursor: '0', limit: 200 }));

  const missingMarketIntelligence = buildProductRuntimeSupervisorEnvelope({
    ...OPS_PROJECTION,
    snapshot: makeSupervisor({
      components: Object.freeze(source.components.filter((component) => component.componentId !== 'market-intelligence')),
    }),
    materialEvents: page,
    traces: [],
    nowMs: T0,
  });
  const attention = missingMarketIntelligence.managedInventory.entries.find(
    (entry) => entry.identity === 'evidence-attention-runtime',
  );
  assert.deepEqual(attention.canonicalComponentIds, ['intelligence-runtime', 'market-intelligence']);
  assert.equal(attention.inventoryState, 'MISSING');
  assert.equal(attention.evidence, null);
  assert.equal(attention.reasonCode, 'CANONICAL_COMPONENT_EVIDENCE_MISSING');
  assert.deepEqual({
    evidencePresent: missingMarketIntelligence.managedInventory.evidencePresentCount,
    missing: missingMarketIntelligence.managedInventory.missingCount,
    observedCanonical: missingMarketIntelligence.managedInventory.observedCanonicalComponentCount,
  }, { evidencePresent: 13, missing: 4, observedCanonical: 13 });

  const q = source.components.find((component) => component.componentId === 'q-inference');
  const duplicatedQ = buildProductRuntimeSupervisorEnvelope({
    ...OPS_PROJECTION,
    snapshot: makeSupervisor({ components: Object.freeze([...source.components, q]) }),
    materialEvents: page,
    traces: [],
    nowMs: T0,
  });
  const qInventory = duplicatedQ.managedInventory.entries.find((entry) => entry.identity === 'q-inference');
  assert.equal(qInventory.inventoryState, 'MISSING');
  assert.equal(qInventory.evidence, null);
  assert.equal(qInventory.reasonCode, 'CANONICAL_COMPONENT_EVIDENCE_DUPLICATED');
  assert.equal(duplicatedQ.managedInventory.mappedIdentityCount, 14);
  assert.equal(duplicatedQ.managedInventory.evidencePresentCount, 13);
  assert.equal(duplicatedQ.managedInventory.missingCount, 4);
  assert.equal(duplicatedQ.managedInventory.observedCanonicalComponentCount, 13);
});

test('Product revisions project only current canonical boot identity without changing schema ownership', async () => {
  const service = createProductIntegrationRuntime({
    read: makeRead({ bootReleaseReadback: makeBootReleaseReadback() }),
    clock: { nowMs: () => T0 },
  });
  const envelope = await service.readSupervisor();
  assert.deepEqual(envelope.ownerView.revisions, {
    testedCommit: 'a'.repeat(40),
    deployedCommit: 'b'.repeat(40),
    modelRevision: 'model.champion.4',
    configRevision: 'config.release.17',
    schemaRevision: 'product-supervisor.v1',
  });
  assert.deepEqual({
    currentSchemaVersion: envelope.opsReadback.currentSchemaVersion,
    rollbackFloor: envelope.opsReadback.rollbackFloor,
  }, { currentSchemaVersion: 1, rollbackFloor: 1 });
});

test('boot identity corruption, stale lifecycle, and read failure withhold every release claim', async () => {
  const invalidReadbacks = [
    makeBootReleaseReadback({}, { state: 'UNAVAILABLE', latest: null, history: Object.freeze([]) }),
    makeBootReleaseReadback({ lifecycleState: 'CRASH_PENDING' }),
    makeBootReleaseReadback({ identityState: 'UNKNOWN' }),
    makeBootReleaseReadback({ testedCommit: 'A'.repeat(40) }),
    makeBootReleaseReadback({ schemaRevision: 'UNKNOWN' }),
  ];
  for (const bootReleaseReadback of invalidReadbacks) {
    const service = createProductIntegrationRuntime({
      read: makeRead({ bootReleaseReadback }),
      clock: { nowMs: () => T0 },
    });
    const envelope = await service.readSupervisor();
    assert.deepEqual(envelope.ownerView.revisions, {
      testedCommit: null,
      deployedCommit: null,
      modelRevision: null,
      configRevision: null,
      schemaRevision: 'product-supervisor.v1',
    });
  }

  const base = makeRead();
  const failedRead = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      bootReleaseReadback: () => { throw new Error('readback unavailable'); },
    }),
    clock: { nowMs: () => T0 },
  });
  assert.equal((await failedRead.readSupervisor()).ownerView.revisions.testedCommit, null);
});

test('a tested commit never fabricates an absent deployed commit', async () => {
  const readback = makeBootReleaseReadback({
    deployedCommit: null,
    identityState: 'PARTIAL',
    identityIssues: Object.freeze(['DEPLOYED_COMMIT_UNKNOWN']),
  }, {
    reasonCodes: Object.freeze(['DEPLOYED_COMMIT_UNKNOWN']),
  });
  const service = createProductIntegrationRuntime({
    read: makeRead({ bootReleaseReadback: readback }),
    clock: { nowMs: () => T0 },
  });
  const revisions = (await service.readSupervisor()).ownerView.revisions;
  assert.equal(revisions.testedCommit, 'a'.repeat(40));
  assert.equal(revisions.deployedCommit, null);
});

test('Product supervisor rejects stale or malformed ops readback instead of hiding the cockpit interlock', async () => {
  for (const opsReadback of [
    makeOpsReadback({ observedAtUtc: new Date(T0 - 60_000).toISOString().replace('.000Z', 'Z') }),
    Object.freeze({ ...makeOpsReadback(), unexpected: true }),
  ]) {
    const base = makeRead();
    const service = createProductIntegrationRuntime({
      read: Object.freeze({ ...base, opsReadback: () => opsReadback }),
      clock: { nowMs: () => T0 },
    });
    await assert.rejects(
      service.readSupervisor(),
      (error) => error?.code === 'OPS_READBACK_UNAVAILABLE' && error?.status === 503,
    );
  }
});

test('generic control revisions never masquerade as canonical config provenance', () => {
  const source = makeSupervisor();
  const page = projectProductMaterialEventPage('0', 200, makeRead().events({ afterCursor: '0', limit: 200 }));
  for (const revision of [0, 1, 999_999]) {
    const snapshot = makeSupervisor({
      control: Object.freeze({ ...source.control, revision }),
    });
    const envelope = buildProductRuntimeSupervisorEnvelope({ ...OPS_PROJECTION, snapshot, materialEvents: page, traces: [], nowMs: T0 });
    assert.equal(envelope.dashboard.control.revision, revision);
    assert.equal(envelope.ownerView.revisions.configRevision, null);
  }
});

test('supervisor READY with unavailable canonical public advance cannot mint Product machine readiness', () => {
  const source = makeSupervisor();
  const components = source.components.map((component) => {
    if (component.componentId === 'market-intelligence') return Object.freeze({ ...component, truthLabel: 'UNKNOWN' });
    if (component.componentId === 'public-spot-source' || component.componentId === 'public-usdm-source') {
      return Object.freeze({ ...component, sourceTimestamp: null, freshness: null });
    }
    return component;
  });
  const snapshot = makeSupervisor({ components: Object.freeze(components), overallPosture: 'READY' });
  const page = projectProductMaterialEventPage('0', 200, makeRead().events({ afterCursor: '0', limit: 200 }));
  const envelope = buildProductRuntimeSupervisorEnvelope({ ...OPS_PROJECTION, snapshot, materialEvents: page, traces: [], nowMs: T0 });
  assert.equal(envelope.ownerView.machineReady, 'UNKNOWN');
  assert.equal(envelope.ownerView.tradeReady, 'NO');
  assert.equal(envelope.dashboard.overallPosture, 'READY');
  const intelligence = envelope.components.find((component) => component.componentId === 'market-intelligence');
  assert.equal(intelligence.truthLabel, 'UNKNOWN');
  assert.equal(intelligence.capability, 'UNKNOWN');
  assert.equal(envelope.ownerView.topRootBlocker, 'MEANINGFUL_ADVANCE_NOT_SUPPLIED');

  const unknownSnapshot = makeSupervisor({ truthLabel: 'UNKNOWN', overallPosture: 'BLOCKED' });
  const unknown = buildProductRuntimeSupervisorEnvelope({ ...OPS_PROJECTION, snapshot: unknownSnapshot, materialEvents: page, traces: [], nowMs: T0 });
  assert.equal(unknown.truthLabel, 'UNKNOWN');
  assert.equal(unknown.surfaces.dashboard.truthLabel, 'UNKNOWN');
  assert.equal(unknown.surfaces.dashboard.summary, 'Dashboard required evidence overall-posture is UNKNOWN.');
  assert.equal(unknown.surfaces.dashboard.blocker, 'REQUIRED_EVIDENCE_UNKNOWN:overall-posture');

  const unavailableSnapshot = makeSupervisor({ truthLabel: 'UNAVAILABLE', overallPosture: 'BLOCKED' });
  const unavailable = buildProductRuntimeSupervisorEnvelope({ ...OPS_PROJECTION, snapshot: unavailableSnapshot, materialEvents: page, traces: [], nowMs: T0 });
  assert.equal(unavailable.truthLabel, 'UNAVAILABLE');
  assert.equal(unavailable.surfaces.dashboard.truthLabel, 'MISSING');
  assert.equal(unavailable.surfaces.dashboard.bindingState, 'BLOCKED_BACKEND');
  assert.equal(unavailable.surfaces.dashboard.blocker, 'REQUIRED_EVIDENCE_UNAVAILABLE:overall-posture');
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
      ...OPS_PROJECTION,
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
  const prefixEnvelope = buildProductRuntimeSupervisorEnvelope({ ...OPS_PROJECTION, snapshot: makeSupervisor(), materialEvents: prefix, traces: [], nowMs: T0 });
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
  const envelope = buildProductRuntimeSupervisorEnvelope({ ...OPS_PROJECTION, snapshot, materialEvents: page, traces: [], nowMs: T0 });
  assert.equal(envelope.truthLabel, 'BUILT_AND_TESTED');
  assert.equal(envelope.persistentSyntheticLabel, true);
  assert.equal(envelope.surfaces.account.truthLabel, 'MISSING');
  assert.equal(envelope.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.equal(envelope.surfaces.borrow.truthLabel, 'MISSING');
  assert.equal(envelope.surfaces.borrow.bindingState, 'BLOCKED_BACKEND');

  const unknownAccountSummaries = Object.freeze({
    ...source.summaries,
    capital: Object.freeze({
      ...source.summaries.capital,
      truthLabel: 'DRY_RUN',
      accountTruthState: 'UNRECOGNIZED_READYISH_STATE',
    }),
  });
  const unknownAccount = buildProductRuntimeSupervisorEnvelope({
    ...OPS_PROJECTION,
    snapshot: makeSupervisor({ summaries: unknownAccountSummaries }),
    materialEvents: page,
    traces: [],
    nowMs: T0,
  });
  assert.equal(unknownAccount.surfaces.account.truthLabel, 'UNKNOWN');
  assert.equal(unknownAccount.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.equal(unknownAccount.surfaces.borrow.truthLabel, 'UNKNOWN');
});

test('supervisor trace index preserves the exact last-200 embedded bound', async () => {
  const correlationId = 'cor_trace_1';
  const base = makeRead();
  const oversizedTrace = Object.freeze({
    correlationId,
    evaluatedAtMs: T0,
    truncated: true,
    events: Object.freeze(Array.from({ length: 201 }, (_, index) => (
      traceEvent(`trace-${index + 1}`, index + 1, 'SOURCE', 'public-spot-source', correlationId)
    ))),
  });
  const snapshot = makeSupervisor({
    recentCorrelatedDecisions: Object.freeze([Object.freeze({ correlationId })]),
    traceIndex: Object.freeze({
      evaluatedAtMs: T0,
      entries: Object.freeze([Object.freeze({
        correlationId,
        firstOccurredAtMs: T0 - 1_000,
        lastOccurredAtMs: T0 - 800,
        componentIds: Object.freeze(['public-spot-source']),
        truthLabels: Object.freeze(['LIVE_PUBLIC']),
        eventCount: oversizedTrace.events.length,
        failureCount: 0,
        snapshot: oversizedTrace,
      })]),
      totalInputEvents: oversizedTrace.events.length,
      uniqueEventCount: oversizedTrace.events.length,
      duplicateEventCount: 0,
      truncated: true,
    }),
  });
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      supervisor: () => snapshot,
    }),
    clock: { nowMs: () => T0 },
  });
  const envelope = await service.readSupervisor();
  assert.equal(envelope.traces.length, 1);
  assert.equal(envelope.traces[0].correlationId, correlationId);
  assert.equal(envelope.traces[0].truncated, true);
  assert.equal(envelope.traces[0].completeness, 'TRUNCATED');
  assert.equal(envelope.traces[0].stages[0].referenceId, 'projection-trace-201');
});

test('Product supervisor reuses one canonical snapshot for ops and embedded traces', async () => {
  const correlationId = 'cor_trace_1';
  const event = traceEvent('trace-shared-cut', 1, 'SOURCE', 'public-spot-source', correlationId);
  const trace = Object.freeze({
    correlationId,
    evaluatedAtMs: T0,
    truncated: false,
    events: Object.freeze([event]),
  });
  const source = makeSupervisor();
  const snapshot = makeSupervisor({
    recentCorrelatedDecisions: Object.freeze([Object.freeze({
      eventId: event.id,
      correlationId,
      componentId: event.componentId,
      kind: event.kind,
      occurredAtMs: event.occurredAtMs,
      truthLabel: event.truthLabel,
      ownerId: event.ownerId,
      canonicalProjectionId: event.canonicalProjectionId,
      revisionDigest: event.revisionDigest,
      failureCode: null,
      referenceIds: event.referenceIds,
    })]),
    traceIndex: Object.freeze({
      ...source.traceIndex,
      entries: Object.freeze([Object.freeze({
        correlationId,
        firstOccurredAtMs: event.occurredAtMs,
        lastOccurredAtMs: event.occurredAtMs,
        componentIds: Object.freeze([event.componentId]),
        truthLabels: Object.freeze([event.truthLabel]),
        eventCount: 1,
        failureCount: 0,
        snapshot: trace,
      })]),
      totalInputEvents: 1,
      uniqueEventCount: 1,
    }),
  });
  const base = makeRead();
  let supervisorReads = 0;
  let opsCut = null;
  let tracePortReads = 0;
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      supervisor: () => {
        supervisorReads += 1;
        return snapshot;
      },
      opsReadback: (received) => {
        opsCut = received;
        return makeOpsReadback();
      },
      trace: () => {
        tracePortReads += 1;
        return trace;
      },
    }),
    clock: { nowMs: () => T0 },
  });
  const envelope = await service.readSupervisor();
  assert.equal(supervisorReads, 1);
  assert.equal(opsCut, snapshot);
  assert.equal(tracePortReads, 0);
  assert.equal(envelope.traces.length, 1);
  assert.equal(envelope.traces[0].correlationId, correlationId);
  assert.equal(envelope.traces[0].stages[0].referenceId, event.canonicalProjectionId);
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

  const noReadbackOwner = {
    ...commandOwner,
    capability: Object.freeze({ ...commandOwner.capability, durableReceipts: true }),
  };
  const noReadbackService = createProductIntegrationRuntime({
    read: makeRead(), clock: { nowMs: () => T0 }, commandOwner: noReadbackOwner,
  });
  const noReadbackEnvelope = await noReadbackService.readSupervisor();
  assert.ok(noReadbackEnvelope.controls.every((control) => (
    control.wiringState === 'UNAVAILABLE:DURABLE_RESULT_READBACK_NOT_PROVEN'
  )));
});
