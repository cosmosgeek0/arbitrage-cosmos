import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSourcedTimestamp,
} from '../../../dist/foundation/contracts/index.js';
import {
  createSystemIntegrationApplication,
} from '../../../dist/systemIntegration/application/index.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  decodeSystemCheckpoint,
} from '../../../dist/systemIntegration/persistence/index.js';
import {
  createSystemIntegrationRouter,
} from '../../../dist/systemIntegration/routes/index.js';
import { BoundedInMemoryLedger } from '../fixtures/memory-ledger.mjs';
import { ManualClock, ManualScheduler } from '../fixtures/manual-clock.mjs';

const T0 = 1_910_000_000_000;

function fixture(options = {}) {
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const order = [];
  let externalKill = options.externalKill ?? true;
  const rawLedger = new BoundedInMemoryLedger(clock);
  const ledger = new Proxy(rawLedger, {
    get(target, property, receiver) {
      if (property === 'getConfigValue') {
        return (...args) => {
          order.push('ledger:load');
          return target.getConfigValue(...args);
        };
      }
      if (property === 'setConfigValueAndLogEvent' || property === 'compareAndSetConfigValueAndLogEvents') {
        return (...args) => {
          order.push('ledger:persist');
          return target[property](...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  function strategy(name, stopThrows = false) {
    const state = { running: false, starts: 0, stops: 0, probes: 0 };
    return {
      state,
      port: {
        start() {
          state.starts += 1;
          state.running = true;
          order.push(`runtime:start:${name}`);
          return Promise.resolve();
        },
        stop() {
          state.stops += 1;
          order.push(`runtime:stop:${name}`);
          if (stopThrows) throw new Error('hidden deterministic stop failure');
          state.running = false;
        },
        health(ctx) {
          state.probes += 1;
          return {
            running: state.running,
            heartbeatAt: state.running ? ctx.nowMs : null,
            timestamp: state.running ? createSourcedTimestamp({
              sourceTimeMs: ctx.nowMs,
              receivedAtMs: ctx.nowMs,
              maxAgeMs: 1_000,
              authority: 'SYNTHETIC_TEST',
              completeness: 'COMPLETE',
              sourceId: `application.test.${name}`,
            }) : null,
            fatal: null,
          };
        },
      },
    };
  }

  const marketState = { running: false, inits: 0, starts: 0, stops: 0, probes: 0 };
  const market = {
    init() {
      marketState.inits += 1;
      order.push('runtime:init:market');
      return Promise.resolve();
    },
    start() {
      marketState.starts += 1;
      marketState.running = true;
      order.push('runtime:start:market');
    },
    stop() {
      marketState.stops += 1;
      marketState.running = false;
      order.push('runtime:stop:market');
    },
    health(ctx) {
      marketState.probes += 1;
      const sourceReady = marketState.running
        && marketState.probes > (options.marketUnavailableProbes ?? 0);
      return {
        running: marketState.running,
        heartbeatAt: marketState.running ? ctx.nowMs : null,
        timestamp: sourceReady ? createSourcedTimestamp({
          sourceTimeMs: ctx.nowMs,
          receivedAtMs: ctx.nowMs,
          maxAgeMs: 1_000,
          authority: 'SYNTHETIC_TEST',
          completeness: 'COMPLETE',
          sourceId: 'application.test.market',
        }) : null,
        fatal: null,
      };
    },
  };
  const basis = strategy('basis');
  const volume = strategy('volume', options.volumeStopThrows ?? false);
  const app = createSystemIntegrationApplication({
    ledger,
    clock,
    scheduler,
    runtimes: { market, basis: basis.port, volume: volume.port },
    readEnvironment: () => ({
      privateKeysAvailable: false,
      killSwitchEngaged: externalKill,
      borrowTruthPresent: false,
    }),
    tickIntervalMs: 1,
    defaultGateTimeoutMs: 20,
    defaultComponentTimeoutMs: 20,
    drainTimeoutMs: 40,
  });
  return {
    app, clock, scheduler, ledger: rawLedger, order,
    states: { market: marketState, basis: basis.state, volume: volume.state },
    setExternalKill(value) { externalKill = value; },
  };
}

async function drive(f, count = 4) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
    f.scheduler.advanceAndRun(1);
  }
}

async function drainAndDrive(f) {
  const draining = f.app.drain();
  for (let index = 0; index < 60; index += 1) {
    await Promise.resolve();
    f.scheduler.advanceAndRun(1);
    if (f.app.managedRuntime().drainCompleted) break;
  }
  return draining;
}

function validControlRequest(f, mutation, suffix) {
  return {
    idempotencyKey: `application.control.${suffix}`,
    expectedRevision: f.app.controls.snapshot().revision,
    reason: 'Deterministic application facade regression',
    requestedAtMs: f.clock.nowMs(),
    correlationId: `application.control.${suffix}`,
    mutation,
  };
}

const ACTOR = Object.freeze({ id: 'application-test-operator', email: null, source: 'loopback' });

test('application shell persists startup before any data component and reads never restart or refresh', async () => {
  const f = fixture();
  const started = f.app.start();
  assert.equal(started.ok, true);
  assert.ok(f.order.indexOf('ledger:load') >= 0);
  assert.ok(f.order.indexOf('ledger:persist') > f.order.indexOf('ledger:load'));
  assert.ok(f.order.indexOf('runtime:init:market') > f.order.indexOf('ledger:persist'));
  assert.equal(started.restartBarrier.canOpenOrIncrease, false);

  await drive(f, 6);
  assert.equal(f.app.managedRuntime().supervisor.phase, 'RUNNING');
  const before = structuredClone(f.states);
  const supervisor = await f.app.read.supervisor();
  const graph = await f.app.read.graph();
  const controls = await f.app.read.controls();
  const events = await f.app.read.events({ limit: 20 });
  assert.equal(supervisor.components.length, 13);
  assert.equal(graph.edges.length > 0, true);
  assert.equal(controls.killSwitchEngaged, true);
  assert.equal(controls.intakePaused, true);
  assert.equal(events.items.length > 0, true);
  assert.deepEqual(f.states, before);
  for (const id of ['intelligence-runtime', 'market-intelligence']) {
    const component = supervisor.components.find((entry) => entry.componentId === id);
    assert.equal(component.truthLabel, 'UNAVAILABLE');
    assert.equal(component.releaseStatuses.includes('LIVE_PUBLIC'), false);
  }
  assert.ok(supervisor.components.find((entry) => entry.componentId === 'engine-supervisor')
    .blockerCodes.includes('EFFECTIVE_KILL_SWITCH_ENGAGED'));
});

test('recovered runtime keeps its last failure as history without reporting it as a current blocker', async () => {
  const f = fixture({ marketUnavailableProbes: 2 });
  assert.equal(f.app.start().ok, true);
  await drive(f, 10);
  const supervisor = f.app.supervisor();
  const market = supervisor.components.find((entry) => entry.componentId === 'market-universe');
  assert.equal(market.phase, 'RUNNING');
  assert.equal(market.readiness, 'READY');
  assert.equal(market.lastFailure?.code, 'REQUIRED_SOURCE_STALE');
  assert.equal(market.blockerCodes.includes('REQUIRED_SOURCE_STALE'), false);
});

test('effective external kill cannot be cleared and blocks validate-only before owner invocation', async () => {
  const f = fixture({ externalKill: true });
  f.app.start();
  await drive(f, 4);
  const beforeEvents = f.ledger.countEvents('system.integration.trace');
  const release = await f.app.controls.mutate(validControlRequest(f, {
    command: 'SET_KILL_SWITCH', engaged: false,
  }, 'external-kill'), ACTOR);
  assert.equal(release.ok, false);
  assert.equal(release.failure.code, 'EXTERNAL_KILL_SWITCH_ENGAGED');
  assert.equal(f.app.controlState().killSwitchEngaged, true);
  assert.ok(f.ledger.countEvents('system.integration.trace') > beforeEvents);
  await assert.rejects(() => f.app.executeValidateOnly({}), /VALIDATE_ONLY_BLOCKED_BY_EFFECTIVE_POSTURE/);

  const malformedLive = await f.app.controls.mutate(validControlRequest(f, {
    command: 'EXECUTION_LIVE',
  }, 'live-mode'), ACTOR);
  assert.equal(malformedLive.ok, false);
  assert.equal(malformedLive.failure.code, 'INVALID_CONTROL_REQUEST');
});

test('restart barrier remains fail-closed after the convergence kill switch is released', async () => {
  const f = fixture({ externalKill: false });
  f.app.start();
  await drive(f, 4);
  const release = await f.app.controls.mutate(validControlRequest(f, {
    command: 'SET_KILL_SWITCH', engaged: false,
  }, 'release-local-kill'), ACTOR);
  assert.equal(release.ok, true);
  assert.equal(f.app.controlState().killSwitchEngaged, false);
  const resume = await f.app.controls.mutate(validControlRequest(f, {
    command: 'SET_INTAKE_PAUSED', paused: false,
  }, 'restart-barrier'), ACTOR);
  assert.equal(resume.ok, false);
  assert.equal(resume.failure.code, 'RESTART_BARRIER_BLOCKED');
  assert.equal(f.app.controlState().intakePaused, true);
  await assert.rejects(() => f.app.executeValidateOnly({}), /VALIDATE_ONLY_BLOCKED_BY_EFFECTIVE_POSTURE/);
});

test('managed restart is bounded by the outer root and clean reverse drain persists before ledger close', async () => {
  const f = fixture({ externalKill: false });
  assert.equal(f.app.start().ok, true);
  await drive(f, 6);
  const restart = f.app.restartManagedRuntime();
  assert.equal(restart.ok, true);
  assert.equal(restart.code, 'MANAGED_RUNTIME_RESTART_ACCEPTED');
  await drive(f, 8);
  const drained = await drainAndDrive(f);
  assert.equal(drained.ok, true);
  assert.equal(drained.clean, true);
  assert.equal(drained.ledgerCloseMayProceed, true);
  const stopOrder = f.order.filter((entry) => entry.startsWith('runtime:stop:'));
  assert.deepEqual(stopOrder.slice(-3), ['runtime:stop:volume', 'runtime:stop:basis', 'runtime:stop:market']);
  const decoded = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.lastShutdown.clean, true);
  assert.ok(f.order.lastIndexOf('ledger:persist') > f.order.lastIndexOf('runtime:stop:market'));
});

test('failed reverse drain is checkpointed as failed and never reported clean', async () => {
  const f = fixture({ externalKill: false, volumeStopThrows: true });
  assert.equal(f.app.start().ok, true);
  await drive(f, 6);
  const drained = await drainAndDrive(f);
  assert.equal(drained.ok, false);
  assert.equal(drained.clean, false);
  assert.equal(drained.finalCheckpoint !== null, true);
  const decoded = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.lastShutdown.clean, false);
});

test('corrupt persistence leaves a router-mountable fail-closed read/control shell', async () => {
  const f = fixture();
  f.ledger.seedConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, '{"corrupt":true}');
  const router = createSystemIntegrationRouter({ read: f.app.read, controls: f.app.controls, clock: f.clock });
  assert.equal(typeof router, 'function');
  const started = f.app.start();
  assert.equal(started.ok, false);
  assert.equal(started.persistenceFailureCode, 'PERSISTENCE_CORRUPT');
  assert.equal(f.states.market.inits, 0);
  const supervisor = f.app.supervisor();
  assert.equal(supervisor.overallPosture, 'FAILED');
  assert.equal(supervisor.components.find((entry) => entry.componentId === 'ledger-persistence').readiness, 'FAILED');
  const mutation = await f.app.controls.mutate(validControlRequest(f, {
    command: 'SET_SAFE_MODE', safeMode: 'ADVISORY',
  }, 'corrupt-store'), ACTOR);
  assert.equal(mutation.ok, false);
  assert.equal(mutation.failure.code, 'CONTROL_PERSISTENCE_UNAVAILABLE');
  assert.equal(f.app.controlState().safeMode, 'READ_ONLY');
});
