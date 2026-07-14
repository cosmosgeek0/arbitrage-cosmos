import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PRODUCT_RUNTIME_MATERIAL_DELIVERY_PAGE_LIMIT,
  parseProductRuntimeMaterialDeliveryAfterCursor,
  projectProductRuntimeSupervisorDelta,
  projectProductRuntimeMaterialDeliveryPage,
} from '../../../dist/productIntegration/runtime/index.js';

const EVENT = Object.freeze({
  cursor: '6',
  eventId: 'event-6',
  occurredAtMs: 1_800_000_000_000,
  componentId: 'engine-supervisor',
  kind: 'CONTROL_APPLIED',
  correlationId: 'correlation-6',
  truthLabel: 'BUILT_AND_TESTED',
});

function materialPage(overrides = {}) {
  return {
    schemaVersion: 'material-cursor.v1',
    mode: 'CURSOR',
    requestedAfterCursor: '5',
    retainedFromCursor: '1',
    highWaterCursor: '6',
    nextCursor: '6',
    hasMore: false,
    continuity: 'PROVEN',
    truncated: false,
    backfillRequired: false,
    missingRange: null,
    items: [EVENT],
    ...overrides,
  };
}

test('WebSocket material page exposes the exact bounded cursor contract', () => {
  const projected = projectProductRuntimeMaterialDeliveryPage('5', materialPage());
  assert.deepEqual(Object.keys(projected), [
    'afterCursor',
    'nextCursor',
    'events',
    'continuity',
    'missingFromCursor',
    'missingToCursor',
    'hasMore',
  ]);
  assert.deepEqual(projected, {
    afterCursor: '5',
    nextCursor: '6',
    events: [EVENT],
    continuity: 'CONTINUOUS',
    missingFromCursor: null,
    missingToCursor: null,
    hasMore: false,
  });
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.events), true);
});

test('retention loss is never repaired and maps to explicit truncation backfill', () => {
  const projected = projectProductRuntimeMaterialDeliveryPage('5', materialPage({
    retainedFromCursor: '9',
    highWaterCursor: '12',
    nextCursor: '5',
    hasMore: true,
    continuity: 'GAP',
    truncated: true,
    backfillRequired: true,
    missingRange: { fromCursor: '6', toCursor: '8', reason: 'RETENTION_GAP' },
    items: [],
  }));
  assert.equal(projected.continuity, 'TRUNCATED_REQUIRES_BACKFILL');
  assert.equal(projected.missingFromCursor, '6');
  assert.equal(projected.missingToCursor, '8');
  assert.equal(projected.nextCursor, '5');
  assert.equal(projected.hasMore, true);
  assert.deepEqual(projected.events, []);
});

test('interior gaps and unproven owner evidence both require explicit gap backfill', () => {
  for (const continuity of ['GAP', 'UNPROVEN']) {
    const reason = continuity === 'GAP' ? 'INTERIOR_GAP' : 'EVIDENCE_UNPROVEN';
    const projected = projectProductRuntimeMaterialDeliveryPage('5', materialPage({
      highWaterCursor: '9',
      nextCursor: '5',
      hasMore: true,
      continuity,
      backfillRequired: true,
      missingRange: { fromCursor: '6', toCursor: '9', reason },
      items: [],
    }));
    assert.equal(projected.continuity, 'GAP_REQUIRES_BACKFILL');
    assert.equal(projected.missingFromCursor, '6');
    assert.equal(projected.missingToCursor, '9');
    assert.equal(projected.nextCursor, '5');
  }
});

test('delivery projection rejects cursor substitution and pages over its bound', () => {
  assert.throws(
    () => projectProductRuntimeMaterialDeliveryPage('4', materialPage()),
    /does not match the requested cursor/,
  );
  assert.throws(
    () => projectProductRuntimeMaterialDeliveryPage('5', materialPage({
      items: Array.from({ length: PRODUCT_RUNTIME_MATERIAL_DELIVERY_PAGE_LIMIT + 1 }, () => EVENT),
    })),
    /exceeds the delivery bound/,
  );
});

test('connection resume cursor is preserved exactly and malformed restart input fails closed', () => {
  assert.equal(parseProductRuntimeMaterialDeliveryAfterCursor('/ws'), '0');
  assert.equal(parseProductRuntimeMaterialDeliveryAfterCursor('/ws?afterCursor=42'), '42');
  assert.equal(parseProductRuntimeMaterialDeliveryAfterCursor('/ws?afterCursor=0042'), null);
  assert.equal(parseProductRuntimeMaterialDeliveryAfterCursor('/ws?afterCursor=42&afterCursor=43'), null);
  assert.equal(parseProductRuntimeMaterialDeliveryAfterCursor('/ws?afterCursor=9223372036854775808'), null);
});

test('supervisor invalidation is a stable bounded canonical delta, not a duplicate snapshot', () => {
  const delta = projectProductRuntimeSupervisorDelta({
    revision: 'system-7-runtime-3-control-2',
    truthLabel: 'UNKNOWN',
    dashboard: {
      overallPosture: 'BLOCKED',
      firstRootBlockerComponentId: 'engine-supervisor',
      runtimeGeneration: 3,
      controlGeneration: 2,
      control: {
        revision: 7,
        safeMode: 'READ_ONLY',
        killSwitchEngaged: true,
        intakePaused: true,
      },
    },
  });
  assert.deepEqual(Object.keys(delta), [
    'schemaVersion',
    'revision',
    'truthLabel',
    'overallPosture',
    'firstRootBlockerComponentId',
    'runtimeGeneration',
    'controlGeneration',
    'controlRevision',
    'safeMode',
    'killSwitchEngaged',
    'intakePaused',
  ]);
  assert.equal(delta.schemaVersion, 'canonical-supervisor-delta.v1');
  assert.equal(delta.overallPosture, 'BLOCKED');
  assert.equal(delta.firstRootBlockerComponentId, 'engine-supervisor');
  assert.equal(delta.killSwitchEngaged, true);
  assert.equal('components' in delta, false);
  assert.equal('materialEvents' in delta, false);
  assert.equal('evaluatedAtMs' in delta, false);
});

test('application socket has no legacy state timer or push and preserves its safety boundaries', async () => {
  const serverSource = await readFile(new URL('../../../src/index.ts', import.meta.url), 'utf8');
  const storeSource = await readFile(new URL('../../../../web/src/store.tsx', import.meta.url), 'utf8');
  const deliveryStart = serverSource.indexOf('async function publishCanonicalWebSocketUpdates');
  const deliveryEnd = serverSource.indexOf('function startServerTimers', deliveryStart);
  assert.ok(deliveryStart >= 0 && deliveryEnd > deliveryStart);
  const deliverySource = serverSource.slice(deliveryStart, deliveryEnd);
  assert.doesNotMatch(serverSource, /\bstateBroadcastTimer\b|server\.state_broadcast/);
  assert.doesNotMatch(serverSource, /broadcast\s*\(\s*\{\s*type:\s*['"]state['"]/);
  assert.doesNotMatch(storeSource, /data\.type\s*===\s*['"]state['"]/);
  assert.doesNotMatch(deliverySource, /buildState|recentEvents|ledger\.|raw[_ -]?(?:log|metric)/i);
  assert.match(serverSource, /productIntegrationRuntime\.readSupervisor\(\)/);
  assert.match(serverSource, /productIntegrationRuntime\.readMaterialEvents\(/);
  assert.match(serverSource, /type:\s*['"]canonical-supervisor-delta['"]/);
  assert.match(serverSource, /type:\s*['"]material-event-page['"]/);
  assert.match(storeSource, /isCanonicalSupervisorDeltaMessage\(data\)\) requestCompatibilityState\(\)/);
  assert.match(serverSource, /operatorAccess\.verify\(request, \{ websocket: true \}\)/);
  assert.match(serverSource, /client\.close\(1012, ['"]service restart['"]\)/);
  assert.match(serverSource, /bookHub\.handleMessage\(ws, decoded\)/);
  assert.match(serverSource, /client\.bufferedAmount > WS_MAX_BUFFERED_BYTES/);
  assert.match(serverSource, /client\.close\(1013, ['"]slow consumer['"]\)/);
  assert.match(serverSource, /client\.close\(1009, ['"]canonical message exceeds bound['"]\)/);
  assert.match(serverSource, /client\.close\(1011, ['"]canonical event read failed['"]\)/);
  assert.match(serverSource, /parseProductRuntimeMaterialDeliveryAfterCursor\(request\.url\)/);
  assert.match(serverSource, /record\.type === ['"]resume-material-events['"]/);
  assert.match(storeSource, /readDurableMaterialCursor\(\)/);
  assert.match(storeSource, /socketUrl\.searchParams\.set\(['"]afterCursor['"], durableCursor\.cursor\)/);
});
