import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { MATERIAL_CURSOR_SCHEMA } from '../../src/lib/productIntegration/model.ts';
import { createHttpProductIntegrationTransport } from '../../src/lib/productIntegration/httpTransport.ts';
import {
  PRODUCT_MATERIAL_CATCHUP_DEADLINE_MS,
  executeProductSupervisorRefresh,
  isMaterialContinuityStillCurrent,
  proveMaterialContinuity,
  reconcileMaterialContinuity,
  useProductControlRoomBinding,
} from '../../src/lib/productIntegration/useProductControlRoomBinding.ts';

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
}) {
  return {
    schemaVersion: MATERIAL_CURSOR_SCHEMA,
    mode,
    requestedAfterCursor: after,
    retainedFromCursor: retained,
    highWaterCursor: highWater,
    nextCursor: next,
    hasMore: BigInt(next) < BigInt(highWater),
    continuity: 'PROVEN',
    truncated: false,
    backfillRequired: false,
    missingRange,
    items,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function createHookHarness(renderHook) {
  const dispatcherRef = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const slots = [];
  let hookIndex = 0;
  let pendingEffects = [];
  let value;
  let stateWrites = 0;
  const sameDependencies = (left, right) => (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => Object.is(entry, right[index]))
  );
  const dispatcher = {
    useState(initialValue) {
      const index = hookIndex++;
      if (!slots[index]) {
        const slot = {
          kind: 'state',
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
          setValue(nextValue) {
            stateWrites += 1;
            slot.value = typeof nextValue === 'function' ? nextValue(slot.value) : nextValue;
          },
        };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].setValue];
    },
    useRef(initialValue) {
      const index = hookIndex++;
      if (!slots[index]) slots[index] = { kind: 'ref', value: { current: initialValue } };
      return slots[index].value;
    },
    useCallback(callback, dependencies) {
      const index = hookIndex++;
      const slot = slots[index];
      if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
        slots[index] = { kind: 'callback', value: callback, dependencies };
      }
      return slots[index].value;
    },
    useEffect(effect, dependencies) {
      const index = hookIndex++;
      const slot = slots[index] ?? {
        kind: 'effect',
        dependencies: undefined,
        cleanup: null,
      };
      slots[index] = slot;
      if (!sameDependencies(slot.dependencies, dependencies)) {
        pendingEffects.push({ slot, effect, dependencies });
      }
    },
  };

  return {
    render() {
      hookIndex = 0;
      pendingEffects = [];
      const priorDispatcher = dispatcherRef.current;
      dispatcherRef.current = dispatcher;
      try {
        value = renderHook();
      } finally {
        dispatcherRef.current = priorDispatcher;
      }
      for (const pending of pendingEffects) {
        pending.slot.cleanup?.();
        pending.slot.dependencies = pending.dependencies;
        pending.slot.cleanup = pending.effect() ?? null;
      }
      return value;
    },
    get value() {
      return value;
    },
    get stateWrites() {
      return stateWrites;
    },
    unmount() {
      for (const slot of slots) {
        if (slot?.kind === 'effect') {
          slot.cleanup?.();
          slot.cleanup = null;
        }
      }
    },
  };
}

function createFakeWindow() {
  const timers = new Map();
  const storage = new Map();
  let nextTimerId = 1;
  return {
    location: { origin: 'https://control.example' },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    timerCount(delay) {
      return [...timers.values()].filter((timer) => timer.delay === delay).length;
    },
    runTimer(delay) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `missing ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

async function flushAsyncWork(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function supervisorSnapshot(highWater) {
  const previous = String(BigInt(highWater) - 1n);
  return {
    marker: `supervisor-${highWater}`,
    materialEvents: materialPage({
      mode: 'TAIL_BOOTSTRAP',
      after: previous,
      next: highWater,
      highWater,
      retained: '1',
      items: [materialEvent(highWater)],
    }),
  };
}

test('caught-up tail bootstrap avoids an unnecessary material-event wait', async () => {
  let reads = 0;
  const persisted = [];
  const supervisorPage = materialPage({
    mode: 'TAIL_BOOTSTRAP',
    after: '5',
    next: '6',
    retained: '1',
    items: [materialEvent('6')],
    missingRange: { fromCursor: '1', toCursor: '5', reason: 'BOOTSTRAP_HISTORY_OMITTED' },
  });

  const proof = await proveMaterialContinuity({
    client: {
      readMaterialEvents: async () => {
        reads += 1;
        throw new Error('avoidable long wait entered');
      },
    },
    supervisorPage,
    durableCursor: { state: 'ABSENT', cursor: null },
    persistCursor: (cursor) => {
      persisted.push(cursor);
      return true;
    },
  });

  assert.equal(reads, 0);
  assert.deepEqual(persisted, ['6']);
  assert.equal(proof.continuity, 'PROVEN');
  assert.equal(proof.pagesRead, 0);
  assert.equal(proof.cursor, '6');
  assert.equal(proof.page, supervisorPage);
});

test('authenticated supervisor truth publishes and foreground refresh settles before stalled catch-up', async () => {
  const supervisorRead = deferred();
  const materialRead = deferred();
  const order = [];
  const supervisorPage = materialPage({
    mode: 'TAIL_BOOTSTRAP',
    after: '0',
    next: '1',
    retained: '1',
    items: [materialEvent('1')],
  });
  const snapshot = { materialEvents: supervisorPage, marker: 'authenticated-supervisor' };
  let continuityPromise = null;
  let materialReads = 0;

  const foreground = executeProductSupervisorRefresh({
    client: {
      readSupervisor: () => supervisorRead.promise,
      readMaterialEvents: () => {
        materialReads += 1;
        return materialRead.promise;
      },
    },
    publishSnapshot: (value) => {
      order.push(`publish:${value.marker}`);
      return true;
    },
    startContinuity: (value) => {
      order.push('continuity:start');
      continuityPromise = proveMaterialContinuity({
        client: {
          readMaterialEvents: () => {
            materialReads += 1;
            return materialRead.promise;
          },
        },
        supervisorPage: value.materialEvents,
        durableCursor: { state: 'VALID', cursor: '0' },
        persistCursor: () => true,
      });
    },
  });

  assert.deepEqual(order, []);
  assert.equal(materialReads, 0);
  supervisorRead.resolve(snapshot);
  assert.equal(await foreground, snapshot);
  assert.deepEqual(order, ['publish:authenticated-supervisor', 'continuity:start']);
  assert.equal(materialReads, 1);
  assert.ok(continuityPromise);

  let continuitySettled = false;
  void continuityPromise.finally(() => {
    continuitySettled = true;
  });
  await Promise.resolve();
  assert.equal(continuitySettled, false);

  materialRead.resolve(materialPage({
    after: '0',
    next: '1',
    retained: '1',
    items: [materialEvent('1')],
  }));
  const proof = await continuityPromise;
  assert.equal(proof.continuity, 'PROVEN');
  assert.equal(proof.cursor, '1');
});

test('supervisor authentication failure starts no continuity or material read', async () => {
  const calls = [];
  await assert.rejects(
    executeProductSupervisorRefresh({
      client: {
        readSupervisor: async () => {
          calls.push('supervisor');
          throw new Error('AUTH_REQUIRED');
        },
        readMaterialEvents: async () => {
          calls.push('material');
          throw new Error('must not run');
        },
      },
      publishSnapshot: () => {
        calls.push('publish');
        return true;
      },
      startContinuity: () => {
        calls.push('continuity');
      },
    }),
    /AUTH_REQUIRED/,
  );
  assert.deepEqual(calls, ['supervisor']);
});

test('cancellation before supervisor settlement suppresses publication and catch-up', async () => {
  const supervisorRead = deferred();
  const controller = new AbortController();
  const calls = [];
  const foreground = executeProductSupervisorRefresh({
    client: { readSupervisor: () => supervisorRead.promise },
    signal: controller.signal,
    publishSnapshot: () => {
      calls.push('publish');
      return true;
    },
    startContinuity: () => {
      calls.push('continuity');
    },
  });
  controller.abort();
  supervisorRead.resolve({ materialEvents: materialPage({ after: '0', next: '0' }) });
  await assert.rejects(foreground, /aborted/);
  assert.deepEqual(calls, []);
});

test('material cancellation is checked before a cursor request begins', async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  await assert.rejects(
    proveMaterialContinuity({
      client: {
        readMaterialEvents: async () => {
          reads += 1;
          throw new Error('must not run');
        },
      },
      supervisorPage: materialPage({ after: '1', next: '2', highWater: '2' }),
      durableCursor: { state: 'VALID', cursor: '1' },
      persistCursor: () => true,
      signal: controller.signal,
    }),
    /aborted/,
  );
  assert.equal(reads, 0);
});

test('in-flight material cancellation forwards one signal and suppresses late cursor persistence', async () => {
  const materialRead = deferred();
  const readStarted = deferred();
  const controller = new AbortController();
  const persisted = [];
  let receivedSignal = null;
  const proof = proveMaterialContinuity({
    client: {
      readMaterialEvents: async (_after, limit, signal) => {
        assert.equal(limit, 200);
        receivedSignal = signal;
        readStarted.resolve();
        return materialRead.promise;
      },
    },
    supervisorPage: materialPage({ after: '1', next: '2', highWater: '2' }),
    durableCursor: { state: 'VALID', cursor: '1' },
    persistCursor: (cursor) => {
      persisted.push(cursor);
      return true;
    },
    signal: controller.signal,
  });

  await readStarted.promise;
  assert.equal(receivedSignal, controller.signal);
  controller.abort();
  materialRead.resolve(materialPage({
    after: '1',
    next: '2',
    highWater: '2',
    items: [materialEvent('2')],
  }));
  await assert.rejects(proof, /aborted/);
  assert.deepEqual(persisted, []);
});

test('default catch-up performs at most eight sequential 200-event pages', async () => {
  const calls = [];
  const persisted = [];
  const controller = new AbortController();
  const proof = await proveMaterialContinuity({
    client: {
      readMaterialEvents: async (after, limit, signal) => {
        calls.push({ after, limit, signal });
        const next = String(BigInt(after) + 1n);
        return materialPage({
          after,
          next,
          highWater: '9',
          items: [materialEvent(next)],
        });
      },
    },
    supervisorPage: materialPage({ after: '8', next: '9', highWater: '9' }),
    durableCursor: { state: 'VALID', cursor: '0' },
    persistCursor: (cursor) => {
      persisted.push(cursor);
      return true;
    },
    signal: controller.signal,
  });

  assert.equal(proof.continuity, 'BACKFILL');
  assert.equal(proof.pagesRead, 8);
  assert.equal(proof.cursor, '8');
  assert.deepEqual(calls.map(({ after }) => after), ['0', '1', '2', '3', '4', '5', '6', '7']);
  assert.ok(calls.every(({ limit, signal }) => limit === 200 && signal === controller.signal));
  assert.deepEqual(persisted, ['1', '2', '3', '4', '5', '6', '7', '8']);
});

test('older proof cannot re-promote a newer supervisor high-water', () => {
  const proofPage = materialPage({ after: '4', next: '5', highWater: '5' });
  const proof = { page: proofPage, cursor: '5', continuity: 'PROVEN', pagesRead: 1 };
  assert.deepEqual(
    reconcileMaterialContinuity(proof, materialPage({ after: '5', next: '6', highWater: '6' })),
    {
      continuity: 'BACKFILL',
      error: 'Material-event catch-up is still in progress after 1 bounded pages.',
    },
  );
  assert.deepEqual(reconcileMaterialContinuity(
    {
      ...proof,
      cursor: '6',
      page: materialPage({ after: '5', next: '6', highWater: '6' }),
    },
    materialPage({ after: '5', next: '6', highWater: '6' }),
  ), { continuity: 'PROVEN', error: null });
});

test('complete material truth ahead of supervisor is stale-supervisor, not backfill', () => {
  const proofPage = materialPage({ after: '1', next: '2', highWater: '2' });
  assert.deepEqual(reconcileMaterialContinuity(
    { page: proofPage, cursor: '2', continuity: 'PROVEN', pagesRead: 1 },
    materialPage({ after: '0', next: '1', highWater: '1' }),
  ), {
    continuity: 'UNPROVEN',
    error: 'Supervisor snapshot is behind the proven material-event high-water; awaiting a fresh supervisor read.',
  });
});

test('an endpoint that advanced beyond the supervisor cannot false-green at the old cursor', async () => {
  const supervisorPage = materialPage({
    mode: 'TAIL_BOOTSTRAP',
    after: '0',
    next: '1',
    retained: '1',
    items: [materialEvent('1')],
  });
  const advancedPage = materialPage({
    after: '0',
    next: '1',
    highWater: '1000',
    retained: '1',
    items: [materialEvent('1')],
  });
  const proof = await proveMaterialContinuity({
    client: { readMaterialEvents: async () => advancedPage },
    supervisorPage,
    durableCursor: { state: 'VALID', cursor: '0' },
    persistCursor: () => true,
    maxPages: 1,
  });

  assert.equal(proof.cursor, '1');
  assert.equal(proof.page.hasMore, true);
  assert.equal(proof.continuity, 'BACKFILL');
  assert.equal(reconcileMaterialContinuity(proof, supervisorPage).continuity, 'BACKFILL');
});

test('unchanged proven high-water reuses proof while advanced or blocked truth does not', () => {
  const atSix = materialPage({ after: '5', next: '6', highWater: '6' });
  assert.equal(isMaterialContinuityStillCurrent('PROVEN', '6', atSix), true);
  assert.equal(isMaterialContinuityStillCurrent('PROVEN', '5', atSix), false);
  assert.equal(isMaterialContinuityStillCurrent('BACKFILL', '6', atSix), false);
  assert.equal(isMaterialContinuityStillCurrent('BLOCKED', '6', atSix), false);
});

test('hook settles supervisor truth while one continuity lane stalls and fences an older proof', async () => {
  const priorWindow = globalThis.window;
  const fakeWindow = createFakeWindow();
  globalThis.window = fakeWindow;
  const supervisors = [deferred(), deferred(), deferred()];
  const materialRead = deferred();
  const supervisorSignals = [];
  let supervisorReads = 0;
  let materialReads = 0;
  const client = {
    readSupervisor: (signal) => {
      supervisorSignals.push(signal);
      return supervisors[supervisorReads++].promise;
    },
    readMaterialEvents: (_after, limit, signal) => {
      materialReads += 1;
      assert.equal(limit, 200);
      assert.equal(signal.aborted, false);
      return materialRead.promise;
    },
  };
  const harness = createHookHarness(() => useProductControlRoomBinding(
    client,
    5_000,
    { state: 'VALID', cursor: '0' },
  ));

  try {
    harness.render();
    assert.equal(supervisorReads, 1);
    const firstJoin = harness.value.refresh();
    const secondJoin = harness.value.refresh();
    assert.equal(firstJoin, secondJoin);
    assert.equal(supervisorReads, 1);

    const firstSnapshot = supervisorSnapshot('1');
    supervisors[0].resolve(firstSnapshot);
    await firstJoin;
    await flushAsyncWork();
    harness.render();
    assert.equal(harness.value.snapshot, firstSnapshot);
    assert.equal(harness.value.loading, false);
    assert.equal(harness.value.continuity, 'UNPROVEN');
    assert.equal(harness.value.error, 'Material-event continuity proof is pending.');
    assert.equal(materialReads, 1);

    const nextRefresh = harness.value.refresh();
    harness.render();
    assert.equal(harness.value.loading, true);
    assert.equal(supervisorReads, 2);
    const secondSnapshot = supervisorSnapshot('2');
    supervisors[1].resolve(secondSnapshot);
    await nextRefresh;
    await flushAsyncWork();
    harness.render();
    assert.equal(harness.value.snapshot, secondSnapshot);
    assert.equal(harness.value.loading, false);
    assert.equal(harness.value.continuity, 'UNPROVEN');
    assert.equal(materialReads, 1);

    materialRead.resolve(materialPage({
      after: '0',
      next: '1',
      highWater: '1',
      retained: '1',
      items: [materialEvent('1')],
    }));
    await flushAsyncWork();
    harness.render();
    assert.equal(harness.value.snapshot, secondSnapshot);
    assert.equal(harness.value.continuity, 'BACKFILL');
    assert.match(harness.value.error, /catch-up is still in progress/);

    const failedRefresh = harness.value.refresh();
    harness.render();
    assert.equal(harness.value.loading, true);
    supervisors[2].reject(new Error('AUTH_REQUIRED'));
    await failedRefresh;
    await flushAsyncWork();
    harness.render();
    assert.equal(harness.value.snapshot, secondSnapshot);
    assert.equal(harness.value.materialEvents.nextCursor, '1');
    assert.equal(harness.value.loading, false);
    assert.equal(harness.value.continuity, 'BLOCKED');
    assert.equal(harness.value.error, 'AUTH_REQUIRED');
    assert.ok(supervisorSignals.every((signal) => signal instanceof AbortSignal));
  } finally {
    harness.unmount();
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('hook deadline blocks, retries, polls after settlement, and aborts both lanes on cleanup', async () => {
  const priorWindow = globalThis.window;
  const fakeWindow = createFakeWindow();
  globalThis.window = fakeWindow;
  const pendingSupervisor = deferred();
  const supervisorSignals = [];
  const materialSignals = [];
  let supervisorReads = 0;
  let materialReads = 0;
  const abortableMaterialRead = (signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
  const client = {
    readSupervisor: (signal) => {
      supervisorSignals.push(signal);
      supervisorReads += 1;
      if (supervisorReads === 1 || supervisorReads === 2) return Promise.resolve(supervisorSnapshot('1'));
      if (supervisorReads === 3) return Promise.resolve(supervisorSnapshot('2'));
      return pendingSupervisor.promise;
    },
    readMaterialEvents: (after, limit, signal) => {
      materialSignals.push(signal);
      materialReads += 1;
      assert.equal(limit, 200);
      if (materialReads === 2) {
        return Promise.resolve(materialPage({
          after,
          next: '1',
          highWater: '1',
          retained: '1',
          items: [materialEvent('1')],
        }));
      }
      return abortableMaterialRead(signal);
    },
  };
  const harness = createHookHarness(() => useProductControlRoomBinding(
    client,
    5_000,
    { state: 'VALID', cursor: '0' },
  ));

  try {
    harness.render();
    const firstRefresh = harness.value.refresh();
    await firstRefresh;
    await flushAsyncWork();
    harness.render();
    assert.equal(harness.value.continuity, 'UNPROVEN');
    assert.equal(fakeWindow.timerCount(PRODUCT_MATERIAL_CATCHUP_DEADLINE_MS), 1);
    assert.equal(fakeWindow.timerCount(5_000), 1);

    fakeWindow.runTimer(PRODUCT_MATERIAL_CATCHUP_DEADLINE_MS);
    await flushAsyncWork();
    harness.render();
    assert.equal(materialSignals[0].aborted, true);
    assert.equal(harness.value.continuity, 'BLOCKED');
    assert.match(harness.value.error, /10000ms bounded deadline/);

    const retry = harness.value.refresh();
    harness.render();
    assert.equal(harness.value.loading, true);
    await retry;
    await flushAsyncWork();
    harness.render();
    assert.equal(materialReads, 2);
    assert.equal(harness.value.loading, false);
    assert.equal(harness.value.continuity, 'PROVEN');
    assert.equal(harness.value.error, null);

    fakeWindow.runTimer(5_000);
    await flushAsyncWork();
    harness.render();
    assert.equal(supervisorReads, 3);
    assert.equal(materialReads, 3);
    assert.equal(harness.value.snapshot.marker, 'supervisor-2');
    assert.equal(harness.value.continuity, 'UNPROVEN');
    assert.equal(fakeWindow.timerCount(5_000), 1);

    fakeWindow.runTimer(5_000);
    assert.equal(supervisorReads, 4);
    assert.equal(fakeWindow.timerCount(5_000), 0);
    const pendingJoin = harness.value.refresh();
    assert.equal(pendingJoin, harness.value.refresh());
    harness.render();
    assert.equal(harness.value.loading, true);

    harness.unmount();
    assert.equal(supervisorSignals[3].aborted, true);
    assert.equal(materialSignals[2].aborted, true);
    await flushAsyncWork();
    assert.equal(fakeWindow.timerCount(5_000), 0);
    assert.equal(fakeWindow.timerCount(PRODUCT_MATERIAL_CATCHUP_DEADLINE_MS), 0);
    const writesAfterCleanup = harness.stateWrites;
    pendingSupervisor.resolve(supervisorSnapshot('2'));
    await pendingJoin;
    await flushAsyncWork();
    assert.equal(harness.stateWrites, writesAfterCleanup);
  } finally {
    harness.unmount();
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('hook fences pending continuity after supervisor auth failure or high-water regression', async () => {
  for (const scenario of [
    {
      name: 'auth failure',
      settleSupervisor: (read) => read.reject(new Error('AUTH_REQUIRED')),
      expectedError: 'AUTH_REQUIRED',
    },
    {
      name: 'high-water regression',
      settleSupervisor: (read) => read.resolve(supervisorSnapshot('1')),
      expectedError: 'Supervisor material high-water regressed; last-known truth was retained.',
    },
  ]) {
    const priorWindow = globalThis.window;
    const fakeWindow = createFakeWindow();
    globalThis.window = fakeWindow;
    const supervisors = [deferred(), deferred()];
    const materialRead = deferred();
    let supervisorReads = 0;
    let materialSignal = null;
    const client = {
      readSupervisor: () => supervisors[supervisorReads++].promise,
      readMaterialEvents: (_after, _limit, signal) => {
        materialSignal = signal;
        return materialRead.promise;
      },
    };
    const harness = createHookHarness(() => useProductControlRoomBinding(
      client,
      5_000,
      { state: 'VALID', cursor: '0' },
    ));

    try {
      harness.render();
      const firstRefresh = harness.value.refresh();
      const acceptedSnapshot = supervisorSnapshot('2');
      supervisors[0].resolve(acceptedSnapshot);
      await firstRefresh;
      await flushAsyncWork();
      harness.render();
      assert.equal(harness.value.snapshot, acceptedSnapshot, scenario.name);
      assert.equal(harness.value.continuity, 'UNPROVEN', scenario.name);
      assert.equal(materialSignal.aborted, false, scenario.name);

      const invalidatingRefresh = harness.value.refresh();
      harness.render();
      assert.equal(harness.value.loading, true, scenario.name);
      scenario.settleSupervisor(supervisors[1]);
      await invalidatingRefresh;
      await flushAsyncWork();
      harness.render();
      assert.equal(materialSignal.aborted, true, scenario.name);
      assert.equal(harness.value.snapshot, acceptedSnapshot, scenario.name);
      assert.equal(harness.value.materialEvents, null, scenario.name);
      assert.equal(harness.value.loading, false, scenario.name);
      assert.equal(harness.value.continuity, 'BLOCKED', scenario.name);
      assert.equal(harness.value.error, scenario.expectedError, scenario.name);

      const writesBeforeLateProof = harness.stateWrites;
      materialRead.resolve(materialPage({
        after: '0',
        next: '2',
        highWater: '2',
        retained: '1',
        items: [materialEvent('1'), materialEvent('2')],
      }));
      await flushAsyncWork();
      harness.render();
      assert.equal(harness.stateWrites, writesBeforeLateProof, scenario.name);
      assert.equal(harness.value.snapshot, acceptedSnapshot, scenario.name);
      assert.equal(harness.value.materialEvents, null, scenario.name);
      assert.equal(harness.value.continuity, 'BLOCKED', scenario.name);
      assert.equal(harness.value.error, scenario.expectedError, scenario.name);
    } finally {
      harness.unmount();
      if (priorWindow === undefined) delete globalThis.window;
      else globalThis.window = priorWindow;
    }
  }
});

test('hook waits for stale supervisor to catch proven material high-water without rereading events', async () => {
  const priorWindow = globalThis.window;
  const fakeWindow = createFakeWindow();
  globalThis.window = fakeWindow;
  const supervisorPages = [
    supervisorSnapshot('1'),
    supervisorSnapshot('1'),
    supervisorSnapshot('2'),
  ];
  let supervisorReads = 0;
  let materialReads = 0;
  const client = {
    readSupervisor: async () => supervisorPages[supervisorReads++],
    readMaterialEvents: async (after) => {
      materialReads += 1;
      return materialPage({
        after,
        next: '2',
        highWater: '2',
        retained: '1',
        items: [materialEvent('1'), materialEvent('2')],
      });
    },
  };
  const harness = createHookHarness(() => useProductControlRoomBinding(
    client,
    5_000,
    { state: 'VALID', cursor: '0' },
  ));

  try {
    harness.render();
    await harness.value.refresh();
    await flushAsyncWork();
    harness.render();
    assert.equal(materialReads, 1);
    assert.equal(harness.value.snapshot.marker, 'supervisor-1');
    assert.equal(harness.value.materialEvents.highWaterCursor, '2');
    assert.equal(harness.value.continuity, 'UNPROVEN');
    assert.equal(
      harness.value.error,
      'Supervisor snapshot is behind the proven material-event high-water; awaiting a fresh supervisor read.',
    );

    await harness.value.refresh();
    await flushAsyncWork();
    harness.render();
    assert.equal(supervisorReads, 2);
    assert.equal(materialReads, 1);
    assert.equal(harness.value.continuity, 'UNPROVEN');

    await harness.value.refresh();
    await flushAsyncWork();
    harness.render();
    assert.equal(supervisorReads, 3);
    assert.equal(materialReads, 1);
    assert.equal(harness.value.snapshot.marker, 'supervisor-2');
    assert.equal(harness.value.continuity, 'PROVEN');
    assert.equal(harness.value.error, null);
  } finally {
    harness.unmount();
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('binding lanes keep polling, deadlines, authentication, and cancellation bounded', async () => {
  const hook = await readFile(
    new URL('../../src/lib/productIntegration/useProductControlRoomBinding.ts', import.meta.url),
    'utf8',
  );
  const transport = await readFile(
    new URL('../../src/lib/productIntegration/httpTransport.ts', import.meta.url),
    'utf8',
  );

  assert.equal(PRODUCT_MATERIAL_CATCHUP_DEADLINE_MS, 10_000);
  assert.match(hook, /supervisorInFlightRef\.current\) return supervisorInFlightRef\.current/);
  assert.match(hook, /continuityInFlightRef\.current\) return continuityInFlightRef\.current/);
  assert.match(hook, /await executeProductSupervisorRefresh/);
  assert.match(hook, /void startContinuity\(nextSnapshot, generation\)/);
  assert.match(hook, /setError\('Material-event continuity proof is pending\.'\)/);
  assert.match(hook, /if \(mountedRef\.current\) setLoading\(true\)/);
  assert.match(hook, /PRODUCT_MATERIAL_CATCHUP_DEADLINE_MS/);
  assert.match(hook, /deadlineReached = true;\s*controller\.abort\(\)/);
  assert.match(hook, /continuityAuthorityRef\.current \+= 1;\s*continuityAbortRef\.current\?\.abort\(\)/);
  assert.match(hook, /window\.setTimeout\(\(\) => \{ void poll\(\); \}, cadenceMs\)/);
  assert.match(hook, /window\.clearTimeout\(timer\)/);
  assert.doesNotMatch(hook, /setInterval/);
  assert.doesNotMatch(hook, /const inFlightRef/);

  assert.equal((transport.match(/credentials: 'same-origin'/g) ?? []).length, 6);
  assert.doesNotMatch(transport, /credentials:\s*['"]omit['"]/);
  assert.match(transport, /url\.origin !== window\.location\.origin/);
});

test('same-origin transport functionally preserves credentials and forwards cancellation', async () => {
  const priorWindow = globalThis.window;
  const priorFetch = globalThis.fetch;
  const calls = [];
  globalThis.window = {
    location: { origin: 'https://control.example' },
    setTimeout,
    clearTimeout,
  };
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const transport = createHttpProductIntegrationTransport({
      supervisor: '/supervisor',
      materialEvents: '/material-events',
      trace: (correlationId) => `/traces/${correlationId}`,
      commandResult: (commandId) => `/commands/${commandId}`,
      commandPreview: '/commands/preview',
      commandSubmit: '/commands',
    });
    const controller = new AbortController();
    await transport.readSupervisor(controller.signal);
    await transport.readMaterialEvents('4', 200, controller.signal);
    assert.deepEqual(calls.map(({ input }) => input), [
      '/supervisor',
      '/material-events?afterCursor=4&limit=200',
    ]);
    assert.ok(calls.every(({ init }) => (
      init.cache === 'no-store'
      && init.credentials === 'same-origin'
      && init.signal instanceof AbortSignal
    )));

    let forwardedSignal = null;
    globalThis.fetch = async (_input, init) => {
      forwardedSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      });
    };
    const hanging = transport.readSupervisor(controller.signal);
    controller.abort();
    await assert.rejects(hanging, (error) => error?.name === 'AbortError');
    assert.equal(forwardedSignal?.aborted, true);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
    if (priorFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = priorFetch;
  }
});
