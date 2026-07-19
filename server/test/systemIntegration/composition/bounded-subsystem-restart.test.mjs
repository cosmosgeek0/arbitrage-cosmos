import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourcedTimestamp } from '../../../dist/foundation/contracts/index.js';
import { createManagedRuntimeComposition } from '../../../dist/systemIntegration/composition/index.js';

const T0 = 1_800_000_000_000;

class ManualClock {
  constructor() { this.value = T0; }
  nowMs() { return this.value; }
  advance(ms = 1) { this.value += ms; }
}

class ManualScheduler {
  tasks = new Set();
  scheduleEvery(_interval, task) {
    const row = { task };
    this.tasks.add(row);
    return { cancel: () => this.tasks.delete(row) };
  }
  runOnce() { for (const row of [...this.tasks]) row.task(); }
}

function fixture(options = {}) {
  const clock = new ManualClock();
  const scheduler = new ManualScheduler();
  const log = [];
  const runtime = (name) => {
    const state = { running: false, starts: 0, stops: 0 };
    return {
      state,
      port: {
        validate() { log.push(`validate:${name}`); },
        async start() {
          state.starts += 1;
          log.push(`start:${name}`);
          if (options.rejectRestartFor === name && state.starts === 2) {
            throw new Error('deterministic restart rejection');
          }
          state.running = true;
        },
        stop() { state.running = false; state.stops += 1; log.push(`stop:${name}`); },
        health(ctx) {
          return {
            running: state.running,
            heartbeatAt: state.running ? ctx.nowMs : null,
            timestamp: state.running ? createSourcedTimestamp({
              sourceTimeMs: ctx.nowMs, receivedAtMs: ctx.nowMs, maxAgeMs: 1_000,
              authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', sourceId: `restart.${name}`,
            }) : null,
            fatal: null,
          };
        },
      },
    };
  };
  const marketState = { running: false, starts: 0, stops: 0 };
  const market = {
    validate() { log.push('validate:market'); },
    async init() { log.push('init:market'); },
    start() { marketState.running = true; marketState.starts += 1; log.push('start:market'); },
    stop() { marketState.running = false; marketState.stops += 1; log.push('stop:market'); },
    health(ctx) {
      return {
        running: marketState.running,
        heartbeatAt: marketState.running ? ctx.nowMs : null,
        timestamp: marketState.running ? createSourcedTimestamp({
          sourceTimeMs: ctx.nowMs, receivedAtMs: ctx.nowMs, maxAgeMs: 1_000,
          authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', sourceId: 'restart.market',
        }) : null,
        fatal: null,
      };
    },
  };
  const intelligenceRuntime = runtime('intelligence-runtime');
  const marketIntelligence = runtime('market-intelligence');
  const q = runtime('q');
  const basis = runtime('basis');
  const volume = runtime('volume');
  const composition = createManagedRuntimeComposition({
    clock, scheduler,
    ports: { market, intelligenceRuntime: intelligenceRuntime.port, marketIntelligence: marketIntelligence.port, q: q.port, basis: basis.port, volume: volume.port },
    readEnvironment: () => ({ privateKeysAvailable: false, killSwitchEngaged: true, borrowTruthPresent: false }),
    tickIntervalMs: 1, defaultGateTimeoutMs: 10, defaultComponentTimeoutMs: 20, drainTimeoutMs: 50,
  });
  return { composition, clock, scheduler, log, states: { market: marketState, intelligenceRuntime: intelligenceRuntime.state, marketIntelligence: marketIntelligence.state, q: q.state, basis: basis.state, volume: volume.state } };
}

async function drive(fixture, count) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
    fixture.clock.advance();
    fixture.scheduler.runOnce();
  }
}

test('MIS-079 restarts only the dependency-safe dependent closure and retains exact readback', async () => {
  const f = fixture();
  assert.equal(f.composition.start().ok, true);
  await drive(f, 10);
  assert.equal(f.composition.read().supervisor.phase, 'RUNNING');
  f.log.length = 0;

  const accepted = f.composition.restartComponent('market-intelligence');
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.identity.closureComponentIds, [
    'market-intelligence', 'q-inference', 'basis-engine', 'volume-engine',
  ]);
  await drive(f, 12);

  assert.deepEqual(f.log, [
    'stop:volume', 'stop:basis', 'stop:q', 'stop:market-intelligence',
    'start:market-intelligence', 'start:q', 'start:basis', 'start:volume',
  ]);
  assert.equal(f.states.market.starts, 1, 'upstream market owner must not restart');
  assert.equal(f.states.intelligenceRuntime.starts, 1, 'upstream runtime owner must not restart');
  assert.equal(f.composition.readSubsystemRestart(accepted.identity), 'APPLIED');
  assert.equal(f.composition.readSubsystemRestart({
    ...accepted.identity,
    closureComponentIds: ['market-intelligence', 'basis-engine'],
  }), 'UNKNOWN', 'readback must bind the exact dependent closure');
  assert.deepEqual(
    f.composition.restartComponent('market-universe'),
    { ok: false, code: 'SUBSYSTEM_RESTART_ROOT_REQUIRES_MANAGED_RESTART' },
  );
  assert.deepEqual(
    f.composition.read().adapters.filter((row) => accepted.identity.closureComponentIds.includes(row.componentId)).map((row) => row.restartCount),
    [1, 1, 1, 1],
  );
});

test('MIS-079 contains a rejected dependent restart and retains FAILED readback', async () => {
  const f = fixture({ rejectRestartFor: 'basis' });
  assert.equal(f.composition.start().ok, true);
  await drive(f, 10);

  const accepted = f.composition.restartComponent('market-intelligence');
  assert.equal(accepted.ok, true);
  for (let index = 0; index < 12; index += 1) {
    await drive(f, 1);
    if (f.composition.readSubsystemRestart(accepted.identity) !== 'PENDING') break;
  }

  assert.equal(f.composition.readSubsystemRestart(accepted.identity), 'FAILED');
  for (const componentId of accepted.identity.closureComponentIds) {
    const stateName = componentId === 'q-inference' ? 'q'
      : componentId === 'basis-engine' ? 'basis'
        : componentId === 'volume-engine' ? 'volume'
          : 'marketIntelligence';
    assert.equal(f.states[stateName].running, false, `${componentId} must be quiesced after restart failure`);
  }
});
