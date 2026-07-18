import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeploymentFreezeClearOwner } from '../../../dist/systemIntegration/ops/index.js';
import { parseControlBody } from '../../../dist/systemIntegration/routes/index.js';

const T0 = 1_800_000_000_000;
const ACTOR = Object.freeze({ id: 'operator-1', email: null, source: 'loopback' });

function freezeProjection(state = 'FROZEN', overrides = {}) {
  return Object.freeze({
    source: 'CANONICAL_DEPLOYMENT_FREEZE_MARKER_READBACK',
    state,
    ambiguity: state === 'UNKNOWN_FROZEN' ? 'UNKNOWN' : 'NONE',
    reasons: Object.freeze(state === 'FROZEN' ? ['DEPLOYMENT_FREEZE_MARKER_PRESENT'] : []),
    observedAtUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
    validUntilUtc: new Date(T0 + 600_000).toISOString().replace('.000Z', 'Z'),
    deploymentFrozen: state === 'FROZEN' ? true : state === 'NOT_FROZEN' ? false : 'UNKNOWN',
    ...overrides,
  });
}

function opsReadback(overrides = {}) {
  return Object.freeze({
    source: 'CANONICAL_SUPERVISOR_READBACK',
    observedAtUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
    validUntilUtc: new Date(T0 + 600_000).toISOString().replace('.000Z', 'Z'),
    deploymentFrozen: true,
    exposureState: 'NONE',
    ambiguityState: 'NONE',
    recoveryState: 'NONE',
    currentSchemaVersion: 1,
    rollbackFloor: 1,
    ...overrides,
  });
}

function fixture() {
  let marker = freezeProjection();
  let ops = opsReadback();
  let removeCalls = 0;
  let failPersistence = false;
  const records = new Map();
  const persistence = {
    async read(key) { return records.get(key) ?? null; },
    async append(record) {
      if (failPersistence) throw new Error('deterministic persistence outage');
      const prior = records.get(record.idempotencyKey);
      if (prior && prior.requestDigest !== record.requestDigest) return Object.freeze({ kind: 'CONFLICT', record: prior });
      if (prior) return Object.freeze({ kind: 'REPLAY', record: prior });
      const durable = Object.freeze({ ...record, receiptId: `ledger:${records.size + 1}` });
      records.set(record.idempotencyKey, durable);
      return Object.freeze({ kind: 'APPENDED', record: durable });
    },
  };
  const owner = createDeploymentFreezeClearOwner({
    markerPath: '/var/lib/cosmos/ops-state/deploy-frozen.json',
    clock: { nowMs: () => T0 + 1_000 },
    readCanonicalOps: () => ops,
    readFreeze: () => marker,
    persistence,
    fileSystem: {
      removeRegularFileNoFollow(path) {
        assert.equal(path, '/var/lib/cosmos/ops-state/deploy-frozen.json');
        removeCalls += 1;
        marker = freezeProjection('NOT_FROZEN', {
          observedAtUtc: new Date(T0 + 1_000).toISOString().replace('.000Z', 'Z'),
          validUntilUtc: new Date(T0 + 601_000).toISOString().replace('.000Z', 'Z'),
        });
      },
    },
  });
  return {
    owner,
    persistence,
    records,
    removeCalls: () => removeCalls,
    setOps: (value) => { ops = value; },
    setMarker: (value) => { marker = value; },
    failPersistence: () => { failPersistence = true; },
  };
}

function request(overrides = {}) {
  return Object.freeze({
    idempotencyKey: 'freeze.clear.0001',
    expectedObservedAtUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
    reason: 'Canonical recovery is healthy and the release may continue.',
    requestedAtMs: T0 + 1_000,
    actor: ACTOR,
    ...overrides,
  });
}

test('denies unknown, stale, or unhealthy recovery truth without removing the marker', async () => {
  const unknown = fixture();
  unknown.setMarker(freezeProjection('UNKNOWN_FROZEN'));
  const unknownResult = await unknown.owner.clear(request());
  assert.equal(unknownResult.ok, false);
  assert.equal(unknownResult.code, 'DEPLOYMENT_FREEZE_READBACK_UNKNOWN');
  assert.equal(unknown.removeCalls(), 0);

  const stale = fixture();
  const staleObservedAtUtc = new Date(T0 - 600_000).toISOString().replace('.000Z', 'Z');
  stale.setOps(opsReadback({
    observedAtUtc: staleObservedAtUtc,
    validUntilUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
  }));
  const staleResult = await stale.owner.clear(request({ expectedObservedAtUtc: staleObservedAtUtc }));
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.code, 'CANONICAL_RECOVERY_READBACK_STALE');
  assert.equal(stale.removeCalls(), 0);

  const exposed = fixture();
  exposed.setOps(opsReadback({ exposureState: 'ACTIVE' }));
  const exposedResult = await exposed.owner.clear(request());
  assert.equal(exposedResult.ok, false);
  assert.equal(exposedResult.code, 'CANONICAL_RECOVERY_NOT_HEALTHY');
  assert.equal(exposed.removeCalls(), 0);
});

test('durably records the bound operator action before atomic removal and replays idempotently', async () => {
  const world = fixture();
  const first = await world.owner.clear(request());
  assert.equal(first.ok, true);
  assert.equal(first.status, 'CLEARED');
  assert.equal(world.removeCalls(), 1);
  assert.equal(world.records.size, 1);
  const durable = world.records.get('freeze.clear.0001');
  assert.equal(durable.actor.id, ACTOR.id);
  assert.equal(durable.reason, request().reason);
  assert.equal(durable.requestedAtMs, T0 + 1_000);
  assert.equal(durable.result, 'CLEAR_AUTHORIZED');
  assert.equal(durable.expectedObservedAtUtc, request().expectedObservedAtUtc);

  const replay = await world.owner.clear(request());
  assert.deepEqual(replay, first);
  assert.equal(world.removeCalls(), 1);

  const conflict = await world.owner.clear(request({ reason: 'Different intent under the same key.' }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(world.removeCalls(), 1);
});

test('persistence failure and post-remove readback ambiguity both fail closed', async () => {
  const unavailable = fixture();
  unavailable.failPersistence();
  const unavailableResult = await unavailable.owner.clear(request());
  assert.equal(unavailableResult.ok, false);
  assert.equal(unavailableResult.code, 'FREEZE_CLEAR_PERSISTENCE_UNAVAILABLE');
  assert.equal(unavailable.removeCalls(), 0);

  const ambiguous = fixture();
  // The hostile filesystem acknowledges unlink without changing canonical readback.
  const badOwner = createDeploymentFreezeClearOwner({
    markerPath: '/var/lib/cosmos/ops-state/deploy-frozen.json',
    clock: { nowMs: () => T0 + 1_000 },
    readCanonicalOps: () => opsReadback(),
    readFreeze: () => freezeProjection('FROZEN'),
    persistence: ambiguous.persistence,
    fileSystem: { removeRegularFileNoFollow() {} },
  });
  const result = await badOwner.clear(request());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FREEZE_CLEAR_READBACK_UNCONFIRMED');
});

test('canonical control API accepts only the exact revision-bound clear shape', () => {
  const parsed = parseControlBody({
    command: 'CLEAR_DEPLOYMENT_FREEZE',
    expectedRevision: 7,
    reason: 'Recovery is healthy.',
    expectedObservedAtUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.mutation, {
    command: 'CLEAR_DEPLOYMENT_FREEZE',
    expectedObservedAtUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
  });
  assert.equal(parseControlBody({ ...parsed, command: 'CLEAR_DEPLOYMENT_FREEZE' }).ok, false);
});
