#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVolumeForwardMeasurementScheduler,
  validateVolumeForwardMeasurementActivation,
  VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA,
  VOLUME_FORWARD_MEASUREMENT_DEFAULT_ACTIVATION,
} from '../dist/engine/volume/forwardMeasurementScheduler.js';

const ACTIVATION_ID = `ve2_activation_${'1'.repeat(64)}`;
const WARMUP_START_MS = Date.UTC(2026, 7, 1);
const CADENCE_MS = 2_000;

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

class ManualTimers {
  handles = [];
  setCount = 0;
  clearCount = 0;
  unrefCount = 0;

  setTimeout(callback, delayMs) {
    this.setCount += 1;
    const handle = {
      callback,
      delayMs,
      cleared: false,
      unref: () => {
        this.unrefCount += 1;
      },
    };
    this.handles.push(handle);
    return handle;
  }

  clearTimeout(handle) {
    this.clearCount += 1;
    handle.cleared = true;
  }

  latest() {
    return this.handles.at(-1);
  }

  fire(handle = this.latest()) {
    handle.callback();
  }
}

function activation({
  resume = false,
  runtimeGeneration = 1,
  warmupStartMs = WARMUP_START_MS,
  maturityAtMs = WARMUP_START_MS + 8_000,
} = {}) {
  return {
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA,
    captureEnabled: true,
    activationId: ACTIVATION_ID,
    runtimeGeneration,
    resume,
    warmupStartMs,
    maturityAtMs,
    detectorCadenceMs: CADENCE_MS,
  };
}

function createCapture({
  expectedWarmupCutCount = 2,
  expectedDetectorCutCount = 2,
  recordedWarmupCutCount = 0,
  recordedDetectorCutCount = 0,
  runtimeGeneration = null,
  initialState = 'SCHEDULED',
  observeFailureAt = null,
  cursorJumpAt = null,
} = {}) {
  let state = initialState;
  let warmup = recordedWarmupCutCount;
  let detector = recordedDetectorCutCount;
  let observes = 0;
  let advances = 0;
  let closes = 0;
  const snapshot = () => ({
    state,
    activationId: ACTIVATION_ID,
    recordedWarmupCutCount: warmup,
    expectedWarmupCutCount,
    recordedDetectorCutCount: detector,
    expectedDetectorCutCount,
    runtimeGeneration,
  });
  return {
    observe(cut) {
      observes += 1;
      if (observes === observeFailureAt) {
        throw new Error('durable capture unavailable');
      }
      runtimeGeneration = cut.runtimeGeneration;
      if (warmup < expectedWarmupCutCount) {
        warmup += 1;
        state = 'WARMING';
      } else {
        detector += 1;
        state = 'CAPTURING';
      }
      if (observes === cursorJumpAt) warmup += 1;
    },
    advanceTime() {
      advances += 1;
      state =
        warmup === expectedWarmupCutCount
          && detector === expectedDetectorCutCount
          ? 'READY_TO_TERMINALIZE'
          : 'FAILED';
    },
    snapshot,
    close() {
      closes += 1;
    },
    counts() {
      return { observes, advances, closes, warmup, detector };
    },
  };
}

test('default activation is immutable OFF and performs zero timer, detector, or capture work', () => {
  const timers = new ManualTimers();
  let ticks = 0;
  const scheduler = createVolumeForwardMeasurementScheduler({
    clock: () => WARMUP_START_MS,
    timers,
    runDetectorTick: () => {
      ticks += 1;
    },
  });

  assert.deepEqual(
    validateVolumeForwardMeasurementActivation(undefined),
    VOLUME_FORWARD_MEASUREMENT_DEFAULT_ACTIVATION,
  );
  assert.equal(Object.isFrozen(VOLUME_FORWARD_MEASUREMENT_DEFAULT_ACTIVATION), true);
  assert.equal(scheduler.start().state, 'OFF');
  assert.equal(scheduler.wantsDetectorCut(), false);
  assert.equal(timers.setCount, 0);
  assert.equal(ticks, 0);
  assert.deepEqual(scheduler.snapshot().reasonCodes, [
    'CAPTURE_ACTIVATION_OFF',
  ]);
});

test('activation validation rejects ambiguous, extra-key, and incoherent schedules', () => {
  for (const invalid of [
    null,
    {},
    {
      schemaVersion: VOLUME_FORWARD_MEASUREMENT_ACTIVATION_SCHEMA,
      captureEnabled: false,
      activationId: ACTIVATION_ID,
    },
    { ...activation(), detectorCadenceMs: 1_000 },
    { ...activation(), maturityAtMs: WARMUP_START_MS + 8_001 },
    { ...activation(), runtimeGeneration: 0 },
    { ...activation(), resume: 'false' },
    { ...activation(), extra: true },
  ]) {
    assert.throws(
      () => validateVolumeForwardMeasurementActivation(invalid),
      /VOLUME_FORWARD_MEASUREMENT_ACTIVATION_INVALID/,
    );
  }

  const timers = new ManualTimers();
  assert.throws(
    () => createVolumeForwardMeasurementScheduler({
      config: activation(),
      clock: () => WARMUP_START_MS,
      timers,
      runDetectorTick() {},
    }),
    /CAPTURE_PORT_INVALID/,
  );
  assert.throws(
    () => createVolumeForwardMeasurementScheduler({
      config: VOLUME_FORWARD_MEASUREMENT_DEFAULT_ACTIVATION,
      capture: createCapture(),
      clock: () => WARMUP_START_MS,
      timers,
      runDetectorTick() {},
    }),
    /CAPTURE_WITHOUT_ACTIVATION/,
  );
});

test('recursive one-shot cadence aligns absolute cuts, forwards once, and terminalizes READY', async () => {
  let nowMs = WARMUP_START_MS - 2_000;
  const timers = new ManualTimers();
  const capture = createCapture();
  const captureFlags = [];
  const admittedTimes = [];
  let detached = 0;
  let scheduler;
  scheduler = createVolumeForwardMeasurementScheduler({
    config: activation(),
    capture,
    clock: () => nowMs,
    timers,
    runDetectorTick: (captureCut, admittedAtMs) => {
      captureFlags.push(captureCut);
      admittedTimes.push(admittedAtMs);
      if (captureCut) scheduler.observe({ runtimeGeneration: 1 });
    },
    onCaptureDetached: () => {
      detached += 1;
    },
  });

  let snapshot = scheduler.start();
  assert.equal(snapshot.state, 'WAITING');
  assert.equal(timers.latest().delayMs, 2_000);
  assert.equal(timers.unrefCount, 1);

  nowMs = WARMUP_START_MS;
  timers.fire();
  await flush();
  assert.deepEqual(captureFlags, [true]);
  assert.equal(scheduler.snapshot().state, 'WARMING');
  assert.equal(scheduler.snapshot().nextDeadlineMs, WARMUP_START_MS + 2_000);

  for (const offset of [2_000, 4_000, 6_000]) {
    nowMs = WARMUP_START_MS + offset;
    timers.fire();
    await flush();
  }
  snapshot = scheduler.snapshot();
  assert.equal(snapshot.state, 'CAPTURING');
  assert.equal(snapshot.forwardedCutCount, 4);
  assert.deepEqual(admittedTimes, [
    WARMUP_START_MS,
    WARMUP_START_MS + 2_000,
    WARMUP_START_MS + 4_000,
    WARMUP_START_MS + 6_000,
  ]);
  assert.equal(snapshot.nextDeadlineMs, WARMUP_START_MS + 8_000);
  assert.equal(timers.setCount, 5);
  assert.equal(timers.unrefCount, 5);

  nowMs = WARMUP_START_MS + 8_000;
  timers.fire();
  await flush();
  snapshot = scheduler.snapshot();
  assert.equal(snapshot.state, 'READY');
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.timerPending, false);
  assert.equal(snapshot.closeCount, 1);
  assert.equal(detached, 1);
  assert.deepEqual(capture.counts(), {
    observes: 4,
    advances: 1,
    closes: 1,
    warmup: 2,
    detector: 2,
  });
});

test('one in-flight callback suppresses overlap without queueing a backlog', async () => {
  let nowMs = WARMUP_START_MS - 4_000;
  const timers = new ManualTimers();
  const capture = createCapture();
  let releases;
  let runs = 0;
  const pending = new Promise((resolve) => {
    releases = resolve;
  });
  const scheduler = createVolumeForwardMeasurementScheduler({
    config: activation(),
    capture,
    clock: () => nowMs,
    timers,
    runDetectorTick: () => {
      runs += 1;
      return pending;
    },
  });
  scheduler.start();
  const handle = timers.latest();
  nowMs += 2_000;
  timers.fire(handle);
  timers.fire(handle);
  assert.equal(runs, 1);
  assert.equal(scheduler.snapshot().tickInFlight, true);
  assert.equal(scheduler.snapshot().overlapPreventedCount, 1);
  releases();
  await flush();
  assert.equal(runs, 1);
  assert.equal(timers.setCount, 2);
  timers.fire(handle);
  await flush();
  assert.equal(runs, 1);
  assert.equal(timers.setCount, 2);
  assert.equal(scheduler.snapshot().timerPending, true);
  scheduler.dispose();
});

test('runner failure detaches and closes exactly once while preserving terminal reason', async () => {
  let nowMs = WARMUP_START_MS;
  const timers = new ManualTimers();
  const capture = createCapture({ observeFailureAt: 1 });
  let detached = 0;
  let scheduler;
  scheduler = createVolumeForwardMeasurementScheduler({
    config: activation(),
    capture,
    clock: () => nowMs,
    timers,
    runDetectorTick: () => scheduler.observe({ runtimeGeneration: 1 }),
    onCaptureDetached: () => {
      detached += 1;
    },
  });
  scheduler.start();
  timers.fire();
  await flush();

  assert.equal(scheduler.snapshot().state, 'FAILED');
  assert.deepEqual(scheduler.snapshot().reasonCodes, [
    'CAPTURE_RUNNER_OBSERVER_FAILED',
  ]);
  assert.equal(scheduler.snapshot().closeCount, 1);
  assert.equal(capture.counts().closes, 1);
  assert.equal(detached, 1);
  scheduler.stop();
  scheduler.dispose();
  assert.equal(capture.counts().closes, 1);
  assert.equal(detached, 1);
  assert.equal(timers.setCount, 1);
});

test('runner cursor drift fails closed before a second cut can be scheduled', async () => {
  const timers = new ManualTimers();
  const capture = createCapture({ cursorJumpAt: 1 });
  let scheduler;
  scheduler = createVolumeForwardMeasurementScheduler({
    config: activation(),
    capture,
    clock: () => WARMUP_START_MS,
    timers,
    runDetectorTick: () =>
      scheduler.observe({ runtimeGeneration: 1 }),
  });
  scheduler.start();
  timers.fire();
  await flush();

  assert.equal(scheduler.snapshot().state, 'FAILED');
  assert.deepEqual(scheduler.snapshot().reasonCodes, [
    'CAPTURE_RUNNER_CURSOR_DRIFT',
  ]);
  assert.equal(scheduler.snapshot().forwardedCutCount, 0);
  assert.equal(timers.setCount, 1);
  assert.equal(capture.counts().closes, 1);
});

test('recursive observer entry cannot resurrect a terminal scheduler', async () => {
  const timers = new ManualTimers();
  const baseCapture = createCapture();
  let scheduler;
  const capture = {
    observe(cut) {
      scheduler.observe(cut);
      baseCapture.observe(cut);
    },
    advanceTime: (...args) => baseCapture.advanceTime(...args),
    snapshot: () => baseCapture.snapshot(),
    close: () => baseCapture.close(),
  };
  scheduler = createVolumeForwardMeasurementScheduler({
    config: activation(),
    capture,
    clock: () => WARMUP_START_MS,
    timers,
    runDetectorTick: () =>
      scheduler.observe({ runtimeGeneration: 1 }),
  });
  scheduler.start();
  timers.fire();
  await flush();

  assert.equal(scheduler.snapshot().state, 'FAILED');
  assert.deepEqual(scheduler.snapshot().reasonCodes, [
    'CAPTURE_FORWARD_OUTSIDE_SCHEDULED_TICK',
  ]);
  assert.equal(scheduler.snapshot().forwardedCutCount, 0);
  assert.equal(scheduler.snapshot().closeCount, 1);
  assert.equal(timers.setCount, 1);
});

test('stop cancels and unrefs once, and a stale callback cannot cross the epoch fence', async () => {
  let nowMs = WARMUP_START_MS - 10_000;
  const timers = new ManualTimers();
  const capture = createCapture();
  let runs = 0;
  const scheduler = createVolumeForwardMeasurementScheduler({
    config: activation(),
    capture,
    clock: () => nowMs,
    timers,
    runDetectorTick: () => {
      runs += 1;
    },
  });
  scheduler.start();
  const stale = timers.latest();
  assert.equal(timers.unrefCount, 1);
  assert.equal(scheduler.stop().state, 'STOPPED');
  assert.equal(timers.clearCount, 1);
  assert.equal(stale.cleared, true);
  assert.equal(capture.counts().closes, 1);

  nowMs += 2_000;
  timers.fire(stale);
  await flush();
  assert.equal(runs, 0);
  assert.equal(timers.setCount, 1);
  scheduler.dispose();
  assert.equal(capture.counts().closes, 1);
});

test('resume generation is fenced and missed absolute slots fail without catch-up', async () => {
  const timers = new ManualTimers();
  const resumable = createCapture({
    initialState: 'WARMING',
    recordedWarmupCutCount: 1,
    runtimeGeneration: 4,
  });
  assert.throws(
    () => createVolumeForwardMeasurementScheduler({
      config: activation({ resume: true, runtimeGeneration: 4 }),
      capture: resumable,
      clock: () => WARMUP_START_MS,
      timers,
      runDetectorTick() {},
    }),
    /ACTIVATION_RUNNER_MISMATCH/,
  );

  let nowMs = WARMUP_START_MS;
  const capture = createCapture();
  let scheduler;
  scheduler = createVolumeForwardMeasurementScheduler({
    config: activation(),
    capture,
    clock: () => nowMs,
    timers,
    runDetectorTick: () => scheduler.observe({ runtimeGeneration: 1 }),
  });
  scheduler.start();
  nowMs += 4_000;
  timers.fire();
  await flush();
  assert.equal(scheduler.snapshot().state, 'FAILED');
  assert.deepEqual(scheduler.snapshot().reasonCodes, [
    'CAPTURE_DETECTOR_SLOT_MISSED',
  ]);
  assert.equal(capture.counts().observes, 0);
});
