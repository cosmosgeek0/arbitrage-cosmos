import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import { createSourceIsolationOwner } from '../../../dist/intelligenceRuntime/lifecycle/index.js';
import { createSourceIsolationPersistence } from '../../../dist/services/sourceIsolationPersistence.js';

const T0 = 1_800_000_000_000;
const ACTOR = Object.freeze({ id: 'operator-1', email: null, source: 'loopback' });

function world() {
  let durable = null;
  let physical = {
    'public-spot-source': { lifecycle: 'LIVE', generation: 3 },
    'public-usdm-source': { lifecycle: 'LIVE', generation: 5 },
  };
  let failPhysical = false;
  const calls = [];
  const owner = createSourceIsolationOwner({
    clock: { nowMs: () => T0 },
    persistence: {
      load: () => durable,
      compareAndSet(expected, next, audit) {
        if (JSON.stringify(durable) !== JSON.stringify(expected)) return false;
        durable = structuredClone(next);
        calls.push({ kind: 'persist', audit });
        return true;
      },
    },
    physical: {
      read(sourceId) { return Object.freeze({ ...physical[sourceId] }); },
      isolate(sourceId) {
        calls.push({ kind: 'isolate', sourceId });
        if (failPhysical) throw new Error('deterministic source failure');
        physical = { ...physical, [sourceId]: { lifecycle: 'ISOLATED', generation: physical[sourceId].generation + 1 } };
      },
      restart(sourceId) {
        calls.push({ kind: 'restart', sourceId });
        if (failPhysical) throw new Error('deterministic source failure');
        physical = { ...physical, [sourceId]: { lifecycle: 'WARMING', generation: physical[sourceId].generation + 1 } };
      },
    },
  });
  return {
    owner,
    calls,
    durable: () => structuredClone(durable),
    physical: () => structuredClone(physical),
    failPhysical: () => { failPhysical = true; },
    corrupt: (mutate) => { durable = mutate(structuredClone(durable)); },
  };
}

function request(sourceId, action, expectedSourceRevision, idempotencyKey) {
  return Object.freeze({
    idempotencyKey,
    sourceId,
    action,
    expectedSourceRevision,
    requestedAtMs: T0,
    reason: `${action} the selected public source only.`,
    actor: ACTOR,
  });
}

test('isolate is source-specific, CAS-bound, Ledger-first, and exact-readback proven', async () => {
  const w = world();
  const result = await w.owner.apply(request('public-spot-source', 'ISOLATE', 0, 'source.isolate.0001'));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'APPLIED');
  assert.equal(result.snapshot.sourceRevision, 1);
  assert.equal(result.snapshot.desiredLifecycle, 'ISOLATED');
  assert.equal(result.snapshot.observedLifecycle, 'ISOLATED');
  assert.deepEqual(w.calls.map((row) => row.kind), ['persist', 'isolate', 'persist']);
  assert.equal(w.physical()['public-usdm-source'].lifecycle, 'LIVE');
  assert.equal(w.durable().receipts[0].actor.id, ACTOR.id);
  assert.equal(w.durable().receipts[0].reason, request('public-spot-source', 'ISOLATE', 0, 'source.isolate.0001').reason);

  const replay = await w.owner.apply(request('public-spot-source', 'ISOLATE', 0, 'source.isolate.0001'));
  assert.equal(replay.ok, true);
  assert.equal(replay.status, 'ALREADY_APPLIED');
  assert.equal(replay.receiptId, result.receiptId);
  assert.deepEqual(replay.snapshot, result.snapshot);
  assert.deepEqual(w.calls.map((row) => row.kind), ['persist', 'isolate', 'persist']);
  assert.equal(w.owner.readResult('source.isolate.0001').state, 'TERMINAL');
});

test('stale revision and idempotency conflict append no effect, while restart is independently bound', async () => {
  const w = world();
  await w.owner.apply(request('public-spot-source', 'ISOLATE', 0, 'source.isolate.0001'));

  const stale = await w.owner.apply(request('public-spot-source', 'RESTART', 0, 'source.restart.0001'));
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'STALE_SOURCE_REVISION');
  assert.equal(w.calls.filter((row) => row.kind === 'restart').length, 0);

  const conflict = await w.owner.apply(request('public-usdm-source', 'ISOLATE', 0, 'source.isolate.0001'));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT');

  const restarted = await w.owner.apply(request('public-spot-source', 'RESTART', 1, 'source.restart.0002'));
  assert.equal(restarted.ok, true);
  assert.equal(restarted.snapshot.sourceRevision, 2);
  assert.equal(restarted.snapshot.observedLifecycle, 'WARMING');
  assert.equal(w.physical()['public-usdm-source'].generation, 5);
});

test('physical failure remains durable pending and exact readback never false-greens', async () => {
  const w = world();
  w.failPhysical();
  const result = await w.owner.apply(request('public-spot-source', 'ISOLATE', 0, 'source.isolate.0001'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SOURCE_CONTROL_EFFECT_PENDING');
  assert.equal(w.durable().revision, 1);
  assert.equal(w.durable().sources['public-spot-source'].desiredLifecycle, 'ISOLATED');
  assert.equal(w.owner.readEffect('public-spot-source'), 'NOT_APPLIED');
  assert.equal(w.owner.readResult('source.isolate.0001').state, 'PENDING');
});

test('canonical Ledger CAS keeps source intent and audit atomic across owner reconstruction', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-source-isolation-'));
  const ledger = new Ledger(dataDir);
  let physical = {
    'public-spot-source': { lifecycle: 'LIVE', generation: 8 },
    'public-usdm-source': { lifecycle: 'LIVE', generation: 13 },
  };
  const physicalPort = Object.freeze({
    read(sourceId) { return Object.freeze({ ...physical[sourceId] }); },
    isolate(sourceId) {
      physical = {
        ...physical,
        [sourceId]: { lifecycle: 'ISOLATED', generation: physical[sourceId].generation + 1 },
      };
    },
    restart(sourceId) {
      physical = {
        ...physical,
        [sourceId]: { lifecycle: 'WARMING', generation: physical[sourceId].generation + 1 },
      };
    },
  });
  const persistence = createSourceIsolationPersistence(ledger);
  try {
    const firstOwner = createSourceIsolationOwner({
      clock: { nowMs: () => T0 }, persistence, physical: physicalPort,
    });
    const command = request('public-usdm-source', 'ISOLATE', 0, 'source.isolate.ledger.0001');
    const applied = await firstOwner.apply(command);
    assert.equal(applied.ok, true);
    assert.equal(applied.snapshot.observedLifecycle, 'ISOLATED');
    assert.equal(physical['public-spot-source'].lifecycle, 'LIVE');

    const events = ledger.recentEvents(10, 'intelligence_runtime.source_control');
    assert.equal(events.length, 2);
    assert.equal(events[0].data.sourceId, 'public-usdm-source');
    assert.equal(events[0].data.actor.id, ACTOR.id);
    assert.equal(JSON.parse(ledger.getConfigValue('ops.public-source-isolation.v1')).revision, 2);

    const recoveredOwner = createSourceIsolationOwner({
      clock: { nowMs: () => T0 + 50 }, persistence, physical: physicalPort,
    });
    const replay = await recoveredOwner.apply(command);
    assert.equal(replay.ok, true);
    assert.equal(replay.snapshot.sourceRevision, 1);
    assert.equal(ledger.recentEvents(10, 'intelligence_runtime.source_control').length, 2);
    assert.equal(recoveredOwner.readResult(command.idempotencyKey).state, 'TERMINAL');

    ledger.setConfigValue('ops.public-source-isolation.v1', '{"schema":"cosmos.source-isolation.v1","revision":3,"sources":{},"receipts":[]}');
    const corrupt = recoveredOwner.readResult(command.idempotencyKey);
    assert.equal(corrupt.state, 'FAIL_CLOSED');
    assert.equal(corrupt.failureCode, 'SOURCE_RESULT_STATE_UNAVAILABLE');
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
