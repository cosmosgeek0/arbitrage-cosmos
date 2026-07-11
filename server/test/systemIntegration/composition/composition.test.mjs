import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSourcedTimestamp,
  createStructuredFailure,
} from '../../../dist/foundation/contracts/index.js';
import {
  createManagedRuntimeComposition,
} from '../../../dist/systemIntegration/composition/index.js';
import { MarketEngine } from '../../../dist/engine/marketData.js';

const T0 = 1_800_000_000_000;

class ManualClock {
  constructor(nowMs = T0) {
    this.value = nowMs;
  }

  nowMs() {
    return this.value;
  }

  advance(ms) {
    this.value += ms;
    return this.value;
  }
}

class ManualScheduler {
  tasks = new Set();
  scheduleCalls = 0;

  scheduleEvery(_intervalMs, task) {
    this.scheduleCalls += 1;
    const record = { task, active: true };
    this.tasks.add(record);
    return {
      cancel: () => {
        if (!record.active) return;
        record.active = false;
        this.tasks.delete(record);
      },
    };
  }

  runOnce() {
    for (const record of [...this.tasks]) {
      if (record.active) record.task();
    }
  }

  get activeCount() {
    return this.tasks.size;
  }
}

function sourceTimestamp(ctx, sourceId) {
  return createSourcedTimestamp({
    sourceTimeMs: ctx.nowMs,
    receivedAtMs: ctx.nowMs,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
  });
}

function fixture(options = {}) {
  const clock = new ManualClock();
  const scheduler = new ManualScheduler();
  const log = [];

  function runtime(name, startMode = 'resolved', stopMode = 'resolved') {
    const state = {
      running: false,
      fatalCode: null,
      startCalls: 0,
      stopCalls: 0,
      validateCalls: 0,
    };
    const port = {
      validate() {
        state.validateCalls += 1;
        log.push(`validate:${name}`);
      },
      start() {
        state.startCalls += 1;
        state.running = true;
        log.push(`start:${name}`);
        if (startMode === 'pending') return new Promise(() => {});
        if (startMode === 'rejected') return Promise.reject(new Error('hidden fake error'));
        if (startMode === 'resolved-stopped') {
          state.running = false;
          return Promise.resolve();
        }
        return Promise.resolve();
      },
      stop() {
        state.stopCalls += 1;
        log.push(`stop:${name}`);
        if (stopMode === 'throw') throw new Error('hidden fake stop error');
        state.running = false;
      },
      health(ctx) {
        const fatal = state.fatalCode === null
          ? null
          : createStructuredFailure({
              component: name,
              stage: 'probe',
              code: state.fatalCode,
              message: `${name} deterministic fatal fixture`,
              occurredAt: ctx.nowMs,
              retryable: true,
              safeCurrentState: 'UNCHANGED',
              recommendedOperatorAction: `Inspect ${name}.`,
              correlationId: ctx.correlationId,
            });
        return {
          running: state.running,
          heartbeatAt: state.running ? ctx.nowMs : null,
          timestamp: state.running ? sourceTimestamp(ctx, `composition.test.${name}`) : null,
          fatal,
        };
      },
    };
    return { state, port };
  }

  const marketState = {
    running: false,
    fatalCode: null,
    initCalls: 0,
    startCalls: 0,
    stopCalls: 0,
    validateCalls: 0,
  };
  const market = {
    validate() {
      marketState.validateCalls += 1;
      log.push('validate:market');
    },
    init() {
      marketState.initCalls += 1;
      log.push('init:market');
      if (options.marketInitMode === 'pending') return new Promise(() => {});
      if (options.marketInitMode === 'rejected') return Promise.reject(new Error('hidden fake error'));
      return Promise.resolve();
    },
    start() {
      marketState.startCalls += 1;
      marketState.running = true;
      log.push('start:market');
    },
    stop() {
      marketState.stopCalls += 1;
      log.push('stop:market');
      if (options.marketStopMode === 'throw') throw new Error('hidden fake stop error');
      marketState.running = false;
    },
    health(ctx) {
      const fatal = marketState.fatalCode === null
        ? null
        : createStructuredFailure({
            component: 'market',
            stage: 'probe',
            code: marketState.fatalCode,
            message: 'market deterministic fatal fixture',
            occurredAt: ctx.nowMs,
            retryable: true,
            safeCurrentState: 'UNCHANGED',
            recommendedOperatorAction: 'Inspect market.',
            correlationId: ctx.correlationId,
          });
      return {
        running: marketState.running,
        heartbeatAt: marketState.running ? ctx.nowMs : null,
        timestamp: marketState.running ? sourceTimestamp(ctx, 'composition.test.market') : null,
        fatal,
      };
    },
  };
  const basis = runtime('basis', options.basisStartMode, options.basisStopMode);
  const volume = runtime('volume', options.volumeStartMode, options.volumeStopMode);
  const composition = createManagedRuntimeComposition({
    clock,
    scheduler,
    ports: { market, basis: basis.port, volume: volume.port },
    readEnvironment: () => ({
      privateKeysAvailable: false,
      killSwitchEngaged: true,
      borrowTruthPresent: false,
    }),
    tickIntervalMs: 1,
    defaultGateTimeoutMs: 5,
    defaultComponentTimeoutMs: options.componentTimeoutMs ?? 20,
    drainTimeoutMs: 50,
  });
  return {
    composition,
    clock,
    scheduler,
    log,
    states: { market: marketState, basis: basis.state, volume: volume.state },
  };
}

async function flushAndDrive(f, count = 1) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
    f.clock.advance(1);
    f.scheduler.runOnce();
  }
}

async function startReady(f) {
  const result = f.composition.start();
  assert.equal(result.ok, true);
  await flushAndDrive(f, 3);
  assert.equal(f.composition.read().supervisor.phase, 'RUNNING');
  return result;
}

test('cold start validates and starts in dependency order without arbitrary sleeps', async () => {
  const f = fixture();
  assert.equal(f.scheduler.scheduleCalls, 0, 'construction is inert');
  await startReady(f);

  assert.deepEqual(f.composition.read().componentOrder, [
    'market-universe',
    'basis-engine',
    'volume-engine',
  ]);
  assert.deepEqual(f.log.slice(0, 7), [
    'validate:market',
    'validate:basis',
    'validate:volume',
    'init:market',
    'start:market',
    'start:basis',
    'start:volume',
  ]);
  assert.equal(f.scheduler.scheduleCalls, 1);
  assert.equal(f.scheduler.activeCount, 1);
  assert.equal(f.composition.read().supervisor.runMode, 'INTELLIGENCE');
});

test('optional Basis fatal evidence degrades without erasing Volume', async () => {
  const f = fixture();
  await startReady(f);
  f.states.basis.fatalCode = 'BASIS_SYNTHETIC_FATAL';

  await flushAndDrive(f);
  const degraded = f.composition.read().supervisor;
  assert.equal(degraded.phase, 'DEGRADED');
  assert.equal(degraded.components.find((row) => row.name === 'basis-engine')?.phase, 'DEGRADED');
  assert.equal(degraded.components.find((row) => row.name === 'volume-engine')?.phase, 'RUNNING');
  assert.equal(f.states.volume.running, true);
  assert.equal(f.states.volume.stopCalls, 0);

  f.states.basis.fatalCode = null;
  await flushAndDrive(f);
  assert.equal(f.composition.read().supervisor.phase, 'RUNNING');
});

test('safely quiesced optional startup failure does not roll back the sibling engine', async () => {
  const f = fixture({ basisStartMode: 'rejected' });
  const result = f.composition.start();
  assert.equal(result.ok, true);
  await flushAndDrive(f, 3);

  const snapshot = f.composition.read();
  assert.equal(snapshot.supervisor.phase, 'DEGRADED');
  assert.equal(snapshot.supervisor.components.find((row) => row.name === 'basis-engine')?.phase, 'DEGRADED');
  assert.equal(snapshot.supervisor.components.find((row) => row.name === 'volume-engine')?.phase, 'RUNNING');
  assert.equal(f.states.market.running, true);
  assert.equal(f.states.basis.running, false);
  assert.equal(f.states.basis.stopCalls, 1);
  assert.equal(f.states.volume.running, true);
  assert.equal(f.states.volume.startCalls, 1);
  assert.equal(snapshot.supervisor.lastError?.code, 'BASIS_ENGINE_START_REJECTED');
});

test('optional Volume fatal evidence leaves Basis running and observable', async () => {
  const f = fixture();
  await startReady(f);
  f.states.volume.fatalCode = 'VOLUME_SYNTHETIC_FATAL';

  await flushAndDrive(f);
  const degraded = f.composition.read().supervisor;
  assert.equal(degraded.phase, 'DEGRADED');
  assert.equal(degraded.components.find((row) => row.name === 'volume-engine')?.phase, 'DEGRADED');
  assert.equal(degraded.components.find((row) => row.name === 'basis-engine')?.phase, 'RUNNING');
  assert.equal(f.states.basis.running, true);
  assert.equal(f.states.basis.stopCalls, 0);
});

test('required Market fatal evidence reverse-quiesces every owned runtime and preserves the primary failure', async () => {
  const f = fixture();
  await startReady(f);
  f.log.length = 0;
  f.states.market.fatalCode = 'MARKET_SYNTHETIC_FATAL';

  await flushAndDrive(f);
  const failed = f.composition.read();
  assert.equal(failed.supervisor.phase, 'FAILED');
  assert.equal(failed.supervisor.lastError?.code, 'MARKET_SYNTHETIC_FATAL');
  assert.deepEqual(f.log, ['stop:volume', 'stop:basis', 'stop:market']);
  assert.deepEqual(failed.remainingOwnedComponentIds, []);
  assert.equal(failed.adapters.every((row) => row.ownsUnderlyingRuntime === false), true);
  assert.equal(f.states.market.running, false);
  assert.equal(f.states.basis.running, false);
  assert.equal(f.states.volume.running, false);
});

test('outer Foundation timeout aborts a Promise-started runtime not admitted to startedComponents', async () => {
  const f = fixture({ basisStartMode: 'pending', componentTimeoutMs: 5 });
  const result = f.composition.start();
  assert.equal(result.ok, true);

  await flushAndDrive(f); // Market init settles; market starts; Basis becomes pending.
  assert.equal(f.states.basis.running, true);
  assert.equal(f.composition.read().supervisor.phase, 'STARTING');
  f.clock.advance(5);
  f.scheduler.runOnce();

  const snapshot = f.composition.read();
  assert.equal(snapshot.supervisor.phase, 'FAILED');
  assert.equal(snapshot.supervisor.lastError?.code, 'COMPONENT_START_TIMEOUT');
  assert.deepEqual(snapshot.supervisor.components.filter((row) => row.phase === 'RUNNING'), []);
  assert.equal(f.states.market.running, false);
  assert.equal(f.states.basis.running, false);
  assert.equal(f.states.basis.stopCalls, 1);
  assert.equal(snapshot.adapters.find((row) => row.componentId === 'basis-engine')?.abortCount, 1);
});

test('graceful drain uses exact reverse dependency order and stops the driver', async () => {
  const f = fixture();
  await startReady(f);
  f.log.length = 0;

  const drained = await f.composition.drain();
  assert.deepEqual(f.log, ['stop:volume', 'stop:basis', 'stop:market']);
  assert.equal(drained.supervisor.phase, 'STOPPED');
  assert.equal(drained.drainCompleted, true);
  assert.equal(drained.drainTimedOut, false);
  assert.equal(drained.drainOutcome, 'CLEAN');
  assert.equal(drained.cleanShutdown, true);
  assert.equal(drained.drainFailureCode, null);
  assert.deepEqual(drained.remainingOwnedComponentIds, []);
  assert.equal(drained.driverRunning, false);
  assert.equal(f.scheduler.activeCount, 0);
});

test('throwing stop exposes failed drain and retained ownership instead of claiming clean shutdown', async () => {
  const f = fixture({ volumeStopMode: 'throw' });
  await startReady(f);
  f.log.length = 0;

  const drained = await f.composition.drain();
  assert.equal(drained.supervisor.phase, 'FAILED');
  assert.equal(drained.supervisor.lastError?.code, 'VOLUME_ENGINE_STOP_FAILED');
  assert.equal(drained.drainCompleted, true);
  assert.equal(drained.drainOutcome, 'FAILED');
  assert.equal(drained.cleanShutdown, false);
  assert.equal(drained.drainFailureCode, 'DRAIN_RETAINED_OWNERSHIP');
  assert.deepEqual(drained.remainingOwnedComponentIds, ['volume-engine']);
  assert.equal(
    drained.adapters.find((row) => row.componentId === 'volume-engine')?.ownsUnderlyingRuntime,
    true,
  );
  assert.deepEqual(f.log, ['stop:volume', 'stop:basis', 'stop:market', 'stop:volume']);
  assert.equal(drained.driverRunning, false);
});

test('managed Market init timeout invalidates late atomic commit and a fresh generation can commit', async () => {
  let resolveFirst;
  const firstUniverse = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const universe = (symbol, base) => ({
    pairs: [{ symbol, base }],
    filters: new Map([[symbol, {
      symbol,
      base,
      quote: 'USDT',
      status: 'TRADING',
      stepSize: 0.001,
      minQty: 0.001,
      tickSize: 0.01,
      minNotional: 5,
    }]]),
  });
  let universeCalls = 0;
  const marketEngine = new MarketEngine(
    { logEvent() {} },
    () => {
      universeCalls += 1;
      return universeCalls === 1
        ? firstUniverse
        : Promise.resolve(universe('FRESHUSDT', 'FRESH'));
    },
  );
  const clock = new ManualClock();
  const scheduler = new ManualScheduler();
  const neverStartedStrategy = {
    async start() {},
    stop() {},
    health() {
      return { running: false, heartbeatAt: null, timestamp: null, fatal: null };
    },
  };
  const composition = createManagedRuntimeComposition({
    clock,
    scheduler,
    ports: {
      market: {
        init: () => marketEngine.init(),
        start: () => marketEngine.start(),
        stop: () => marketEngine.stop(),
        health: () => ({ running: false, heartbeatAt: null, timestamp: null, fatal: null }),
      },
      basis: neverStartedStrategy,
      volume: neverStartedStrategy,
    },
    readEnvironment: () => ({
      privateKeysAvailable: false,
      killSwitchEngaged: true,
      borrowTruthPresent: false,
    }),
    tickIntervalMs: 1,
    defaultGateTimeoutMs: 5,
    defaultComponentTimeoutMs: 5,
    drainTimeoutMs: 20,
  });

  assert.equal(composition.start().ok, true);
  clock.advance(5);
  scheduler.runOnce();
  assert.equal(composition.read().supervisor.phase, 'FAILED');
  assert.deepEqual(composition.read().remainingOwnedComponentIds, []);

  resolveFirst(universe('LATEUSDT', 'LATE'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(marketEngine.pairCount, 0);
  assert.equal(marketEngine.filters.size, 0);

  await marketEngine.init();
  assert.equal(marketEngine.pairCount, 1);
  assert.equal(marketEngine.filters.has('FRESHUSDT'), true);
  assert.equal(marketEngine.filters.has('LATEUSDT'), false);
  const drained = await composition.drain();
  assert.equal(drained.drainOutcome, 'CLEAN');
});

test('driver, START, and drain are idempotent at their established state', async () => {
  const f = fixture();
  const first = await startReady(f);
  const starts = {
    market: f.states.market.startCalls,
    basis: f.states.basis.startCalls,
    volume: f.states.volume.startCalls,
  };

  const second = f.composition.start();
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.value.applied, false);
  assert.deepEqual(
    {
      market: f.states.market.startCalls,
      basis: f.states.basis.startCalls,
      volume: f.states.volume.startCalls,
    },
    starts,
  );
  assert.equal(f.scheduler.scheduleCalls, 1);

  const firstDrain = f.composition.drain();
  const secondDrain = f.composition.drain();
  assert.equal(firstDrain, secondDrain);
  const drained = await firstDrain;
  assert.equal(drained.supervisor.phase, 'STOPPED');
  assert.equal(f.states.market.stopCalls, 1);
  assert.equal(f.states.basis.stopCalls, 1);
  assert.equal(f.states.volume.stopCalls, 1);
});
