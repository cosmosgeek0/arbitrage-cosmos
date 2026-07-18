import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSourcedTimestamp,
} from '../../../dist/foundation/contracts/index.js';
import {
  createSystemIntegrationApplication,
} from '../../../dist/systemIntegration/application/index.js';
import {
  PASSIVE_OWNER_EVIDENCE_CORRELATION_ID,
  createPassiveOwnerEvidenceReadPort,
} from '../../../dist/systemIntegration/adapters/index.js';
import {
  readManagedControlRuntimeEffect,
} from '../../../dist/systemIntegration/composition/index.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  decodeSystemCheckpoint,
} from '../../../dist/systemIntegration/persistence/index.js';
import {
  createSystemIntegrationRouter,
  parseControlBody,
} from '../../../dist/systemIntegration/routes/index.js';
import { BoundedInMemoryLedger } from '../fixtures/memory-ledger.mjs';
import { ManualClock, ManualScheduler } from '../fixtures/manual-clock.mjs';

const T0 = 1_910_000_000_000;
const ORDINARY_DRAIN_BLOCKING_REFERENCE_TYPES = Object.freeze([
  'TICKET',
  'AMBIGUOUS_MUTATION',
  'POSITION',
  'LIABILITY',
  'RECOVERY_CAMPAIGN',
]);

function utcSeconds(value) {
  return new Date(Math.floor(value / 1_000) * 1_000).toISOString().replace('.000Z', 'Z');
}

function canonicalDrainTruth(overrides = {}) {
  return Object.freeze({
    source: 'CANONICAL_SUPERVISOR_READBACK',
    observedAtUtc: utcSeconds(T0),
    validUntilUtc: utcSeconds(T0 + 10 * 60_000),
    exposureState: 'UNKNOWN',
    ambiguityState: 'UNKNOWN',
    recoveryState: 'UNKNOWN',
    ...overrides,
  });
}

function blockingReference(referenceType) {
  const suffix = referenceType.toLowerCase().replaceAll('_', '-');
  return Object.freeze({
    referenceType,
    referenceId: `shutdown-${suffix}`,
    ownerId: `owner-${suffix}`,
    ownerRevision: 'revision-1',
    resolutionState: referenceType === 'AMBIGUOUS_MUTATION' ? 'AMBIGUOUS' : 'OPEN',
    correlationId: `shutdown-${suffix}`,
  });
}

function fixture(options = {}) {
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const order = [];
  let externalKill = options.externalKill ?? true;
  let blockingIdentityReferences = options.blockingIdentityReferences ?? [];
  let localMutationAuthority = options.localMutationAuthority ?? 'PROVEN_ABSENT';
  let ordinaryDrainTruth = options.ordinaryDrainTruth ?? canonicalDrainTruth();
  let restartTruthRefreshCalls = 0;
  let traceWindowReads = 0;
  const controlRuntimeEffects = new Map(options.controlRuntimeEffects ?? []);
  let persistenceWriteCalls = 0;
  let persistenceWriteFailureAtCall = options.persistenceWriteFailureAtCall ?? null;
  const rawLedger = options.ledger ?? new BoundedInMemoryLedger(clock);
  const ledger = new Proxy(rawLedger, {
    get(target, property, receiver) {
      if (property === 'readProductBlockingIdentityReferences') {
        if (options.identityReadUnavailable === true) return undefined;
        return (limit = 1_000) => {
          if (options.identityReadThrows === true) throw new Error('deterministic identity read failure');
          return Object.freeze(blockingIdentityReferences.slice(0, limit));
        };
      }
      if (property === 'readSchemaCompatibility') {
        if (options.schemaReadUnavailable === true) return undefined;
        return () => {
          if (options.schemaReadThrows === true) throw new Error('deterministic schema compatibility read failure');
          return options.schemaReadback ?? Object.freeze({
            state: 'AVAILABLE', currentSchemaVersion: 1, rollbackFloor: 1, reasonCode: null,
          });
        };
      }
      if (property === 'getConfigValue') {
        return (...args) => {
          order.push('ledger:load');
          return target.getConfigValue(...args);
        };
      }
      if (property === 'recentEvents') {
        return (...args) => {
          if (args[1] === 'system.integration.trace') traceWindowReads += 1;
          return target.recentEvents(...args);
        };
      }
      if (property === 'setConfigValueAndLogEvent' || property === 'compareAndSetConfigValueAndLogEvents') {
        return (...args) => {
          order.push('ledger:persist');
          persistenceWriteCalls += 1;
          if (persistenceWriteCalls === persistenceWriteFailureAtCall) {
            throw new Error('deterministic persistence write failure');
          }
          return target[property](...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  function strategy(name, stopThrows = false, startThrowsAtCall = null) {
    const state = { running: false, starts: 0, stops: 0, probes: 0 };
    let stopFailure = stopThrows;
    return {
      state,
      setStopThrows(value) { stopFailure = value; },
      port: {
        start() {
          state.starts += 1;
          order.push(`runtime:start:${name}`);
          if (state.starts === startThrowsAtCall) {
            throw new Error('hidden deterministic start failure');
          }
          state.running = true;
          return Promise.resolve();
        },
        stop() {
          state.stops += 1;
          order.push(`runtime:stop:${name}`);
          if (stopFailure) throw new Error('hidden deterministic stop failure');
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
      order.push('runtime:start:market');
      if (marketState.starts === options.marketStartThrowsAtCall) {
        throw new Error('hidden deterministic market start failure');
      }
      marketState.running = true;
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
  const intelligenceRuntime = strategy('intelligence-runtime');
  const marketIntelligence = strategy('market-intelligence');
  const basis = strategy('basis');
  const volume = strategy(
    'volume',
    options.volumeStopThrows ?? false,
    options.volumeStartThrowsAtCall ?? null,
  );
  const strategyIntakeState = { basis: false, volume: false };
  const strategyIntakeOrder = [];
  const strategySymbolPolicyState = { basis: new Set(), volume: new Set() };
  const strategySymbolPolicyOrder = [];
  const sizeCeilingState = {
    SYSTEM: options.initialSystemSizeCeiling ?? '12',
    BASIS: options.initialBasisSizeCeiling ?? '10',
    VOLUME: options.initialVolumeSizeCeiling ?? '10',
  };
  const sizeCeilingOrder = [];
  const strategyThresholdState = {
    BASIS: options.initialBasisThreshold ?? '0.25',
    VOLUME: options.initialVolumeThreshold ?? '3',
  };
  const strategyThresholdOrder = [];
  let readManagedRuntimeForControlEffect = null;
  const app = createSystemIntegrationApplication({
    ledger,
    clock,
    scheduler,
    runtimes: {
      market,
      intelligenceRuntime: intelligenceRuntime.port,
      marketIntelligence: marketIntelligence.port,
      basis: basis.port,
      volume: volume.port,
    },
    strategyIntake: Object.freeze({
      basis: Object.freeze({
        readPaused: () => strategyIntakeState.basis,
        setPaused: (paused) => {
          strategyIntakeOrder.push(`basis:${paused}`);
          order.push(`intake:set:basis:${paused}`);
          if (options.strategyIntakeRestoreThrows === 'basis') throw new Error('deterministic Basis intake restore failure');
          const changed = strategyIntakeState.basis !== paused;
          strategyIntakeState.basis = paused;
          return changed;
        },
      }),
      volume: Object.freeze({
        readPaused: () => strategyIntakeState.volume,
        setPaused: (paused) => {
          strategyIntakeOrder.push(`volume:${paused}`);
          order.push(`intake:set:volume:${paused}`);
          if (options.strategyIntakeRestoreThrows === 'volume') throw new Error('deterministic Volume intake restore failure');
          const changed = strategyIntakeState.volume !== paused;
          strategyIntakeState.volume = paused;
          return changed;
        },
      }),
    }),
    strategySymbolPolicy: Object.freeze({
      basis: Object.freeze({
        readBlockedSymbols: () => [...strategySymbolPolicyState.basis].sort(),
        setBlocked: (symbol, blocked) => {
          strategySymbolPolicyOrder.push(`basis:${blocked ? 'BLOCK' : 'ALLOW'}:${symbol}`);
          if (options.strategySymbolPolicyRestoreThrows === 'basis') throw new Error('deterministic Basis symbol-policy restore failure');
          const before = strategySymbolPolicyState.basis.has(symbol);
          if (blocked) strategySymbolPolicyState.basis.add(symbol);
          else strategySymbolPolicyState.basis.delete(symbol);
          return before !== blocked;
        },
        isAllowed: (symbol) => !strategySymbolPolicyState.basis.has(symbol),
      }),
      volume: Object.freeze({
        readBlockedSymbols: () => [...strategySymbolPolicyState.volume].sort(),
        setBlocked: (symbol, blocked) => {
          strategySymbolPolicyOrder.push(`volume:${blocked ? 'BLOCK' : 'ALLOW'}:${symbol}`);
          if (options.strategySymbolPolicyRestoreThrows === 'volume') throw new Error('deterministic Volume symbol-policy restore failure');
          const before = strategySymbolPolicyState.volume.has(symbol);
          if (blocked) strategySymbolPolicyState.volume.add(symbol);
          else strategySymbolPolicyState.volume.delete(symbol);
          return before !== blocked;
        },
        isAllowed: (symbol) => !strategySymbolPolicyState.volume.has(symbol),
      }),
    }),
    sizeCeilings: Object.freeze(Object.fromEntries(
      ['SYSTEM', 'BASIS', 'VOLUME'].map((scope) => [scope, Object.freeze({
        readCeiling: () => {
          if (options.sizeCeilingReadUnavailable === scope) return null;
          if (options.sizeCeilingReadThrows === scope) throw new Error(`deterministic ${scope} size-ceiling read failure`);
          return sizeCeilingState[scope];
        },
        setCeiling: (value) => {
          sizeCeilingOrder.push(`${scope}:${value}`);
          if (options.sizeCeilingRestoreThrows === scope) throw new Error(`deterministic ${scope} size-ceiling restore failure`);
          const before = Number(sizeCeilingState[scope]);
          const after = Number(value);
          if (!Number.isFinite(before) || !Number.isFinite(after) || after > before) throw new Error('size ceiling increase forbidden');
          const changed = sizeCeilingState[scope] !== value;
          sizeCeilingState[scope] = value;
          return changed;
        },
      })]),
    )),
    strategyThresholds: Object.freeze(Object.fromEntries(
      ['BASIS', 'VOLUME']
        .filter((strategy) => options.strategyThresholdOwnerUnavailable !== strategy)
        .map((strategy) => [strategy, Object.freeze({
          readThreshold: () => {
            if (options.strategyThresholdReadUnavailable === strategy) return null;
            if (options.strategyThresholdReadThrows === strategy) throw new Error(`deterministic ${strategy} threshold read failure`);
            return strategyThresholdState[strategy];
          },
          setThreshold: (value) => {
            strategyThresholdOrder.push(`${strategy}:${value}`);
            order.push(`threshold:set:${strategy}:${value}`);
            if (options.strategyThresholdRestoreThrows === strategy) throw new Error(`deterministic ${strategy} threshold restore failure`);
            const numeric = Number(value);
            const valid = strategy === 'BASIS'
              ? numeric >= 0.01 && numeric <= 100
              : numeric >= 1 && numeric <= 100;
            if (!Number.isFinite(numeric) || !valid) throw new Error('strategy threshold outside owner range');
            const changed = strategyThresholdState[strategy] !== value;
            strategyThresholdState[strategy] = value;
            return changed;
          },
        })]),
    )),
    ...(options.traces ? { traces: options.traces } : {}),
    lifecycleTruth: {
      ...(options.restartTruth !== undefined || options.restartTruthThrows === true
        ? {
            readRestartTruth: () => {
              order.push('lifecycle:restart-truth');
              if (options.restartTruthThrows === true) throw new Error('deterministic restart truth failure');
              return options.restartTruth;
            },
          }
        : {}),
      ...(!options.localMutationAuthorityUnavailable
        ? {
            readLocalMutationAuthority: () => {
              order.push('lifecycle:local-mutation-authority');
              if (options.localMutationAuthorityThrows === true) {
                throw new Error('deterministic local mutation authority failure');
              }
              return localMutationAuthority;
            },
          }
        : {}),
      ...(!options.ordinaryDrainTruthUnavailable
        ? {
            readOrdinaryDrainTruth: () => {
              order.push('lifecycle:ordinary-drain-truth');
              if (options.ordinaryDrainTruthThrows === true) {
                throw new Error('deterministic ordinary drain truth failure');
              }
              return ordinaryDrainTruth;
            },
          }
        : {}),
      readControlRuntimeEffect: (effectId, mutation) => {
        order.push(`lifecycle:control-runtime-effect:${effectId}`);
        if (options.managedRuntimeEffectOwner === true) {
          const readManaged = readManagedRuntimeForControlEffect;
          return readManaged === null
            ? 'UNKNOWN'
            : readManagedControlRuntimeEffect(effectId, mutation, readManaged());
        }
        return controlRuntimeEffects.get(effectId) ?? 'UNKNOWN';
      },
    },
    ...(options.refreshRestartTruth !== undefined || options.refreshRestartTruthThrows === true
      ? {
          restartTruthRefresh: {
            refreshRestartTruth: (nowMs) => {
              restartTruthRefreshCalls += 1;
              order.push('lifecycle:restart-truth-refresh');
              if (options.refreshRestartTruthThrows === true) {
                throw new Error('deterministic restart truth refresh failure');
              }
              return options.refreshRestartTruth(nowMs, restartTruthRefreshCalls);
            },
          },
        }
      : {}),
    readEnvironment: () => ({
      privateKeysAvailable: false,
      killSwitchEngaged: externalKill,
      borrowTruthPresent: false,
    }),
    tickIntervalMs: 1,
    defaultGateTimeoutMs: 20,
    defaultComponentTimeoutMs: 20,
    drainTimeoutMs: 40,
    ...(options.restartTruthRefreshIntervalMs === undefined
      ? {}
      : { restartTruthRefreshIntervalMs: options.restartTruthRefreshIntervalMs }),
  });
  readManagedRuntimeForControlEffect = () => app.managedRuntime();
  return {
    app, clock, scheduler, ledger: rawLedger, order,
    states: {
      market: marketState,
      intelligenceRuntime: intelligenceRuntime.state,
      marketIntelligence: marketIntelligence.state,
      basis: basis.state,
      volume: volume.state,
    },
    setExternalKill(value) { externalKill = value; },
    setBlockingIdentityReferences(references) { blockingIdentityReferences = references; },
    setLocalMutationAuthority(value) { localMutationAuthority = value; },
    setOrdinaryDrainTruth(value) { ordinaryDrainTruth = value; },
    setControlRuntimeEffect(effectId, value) { controlRuntimeEffects.set(effectId, value); },
    setVolumeStopThrows(value) { volume.setStopThrows(value); },
    strategyIntakeState,
    strategyIntakeOrder,
    strategySymbolPolicyState,
    strategySymbolPolicyOrder,
    sizeCeilingState,
    sizeCeilingOrder,
    strategyThresholdState,
    strategyThresholdOrder,
    failNextPersistenceWrite() { persistenceWriteFailureAtCall = persistenceWriteCalls + 1; },
    restartTruthRefreshCalls() { return restartTruthRefreshCalls; },
    traceWindowReads() { return traceWindowReads; },
  };
}

function runtimeStopCounts(f) {
  return [
    f.states.market.stops,
    f.states.intelligenceRuntime.stops,
    f.states.marketIntelligence.stops,
    f.states.basis.stops,
    f.states.volume.stops,
  ];
}

async function drive(f, count = 4) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
    f.scheduler.advanceAndRun(1);
  }
}

async function drainAndDrive(f) {
  const draining = f.app.drain();
  let settled = false;
  void draining.then(() => { settled = true; }, () => { settled = true; });
  for (let index = 0; index < 80; index += 1) {
    await Promise.resolve();
    f.scheduler.advanceAndRun(1);
    if (settled) break;
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
  const startupCheckpoint = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(startupCheckpoint.ok, true);
  assert.deepEqual(startupCheckpoint.value.restartTruth, {
    publicSourceTruth: 'UNKNOWN',
    accountTruth: 'UNAVAILABLE',
    reconciliationTruth: 'UNKNOWN',
    observedAtMs: T0,
  });

  await drive(f, 6);
  assert.equal(f.app.managedRuntime().supervisor.phase, 'RUNNING');
  const before = structuredClone(f.states);
  const supervisor = await f.app.read.supervisor();
  const graph = await f.app.read.graph();
  const controls = await f.app.read.controls();
  const events = await f.app.read.events({ limit: 20 });
  assert.equal(supervisor.components.length, 14);
  assert.equal(graph.edges.length > 0, true);
  assert.equal(controls.killSwitchEngaged, true);
  assert.equal(controls.intakePaused, true);
  assert.equal(events.items.length > 0, true);
  assert.deepEqual(f.states, before);
  for (const id of ['intelligence-runtime', 'market-intelligence']) {
    const component = supervisor.components.find((entry) => entry.componentId === id);
    assert.equal(component.truthLabel, 'SYNTHETIC_ONLY');
    assert.equal(component.releaseStatuses.includes('LIVE_PUBLIC'), false);
  }
  assert.ok(supervisor.components.find((entry) => entry.componentId === 'engine-supervisor')
    .blockerCodes.includes('EFFECTIVE_KILL_SWITCH_ENGAGED'));
});

test('MIS-072 restores each durable strategy intake posture before managed runtimes start and fails closed on effect loss', async () => {
  const first = fixture();
  assert.equal(first.app.start().ok, true);
  const paused = await first.app.controls.mutate(validControlRequest(
    first,
    { command: 'SET_BASIS_INTAKE', paused: true },
    'basis-intake-durable-restore',
  ), ACTOR);
  assert.equal(paused.ok, true);
  assert.equal(first.strategyIntakeState.basis, true);
  assert.equal(first.strategyIntakeState.volume, false);
  const durable = decodeSystemCheckpoint(first.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(durable.ok, true);
  assert.deepEqual(durable.value.strategyIntake, { basisPaused: true, volumePaused: false });

  const recovered = fixture({ ledger: first.ledger });
  const recoveredStart = recovered.app.start();
  assert.equal(recoveredStart.ok, true);
  assert.deepEqual(recovered.strategyIntakeOrder.slice(0, 2), ['basis:true', 'volume:false']);
  assert.equal(recovered.strategyIntakeState.basis, true);
  assert.equal(recovered.strategyIntakeState.volume, false);
  await drive(recovered, 4);
  assert.ok(
    recovered.order.indexOf('runtime:start:basis') > recovered.order.indexOf('intake:set:basis:true'),
    'managed Basis runtime must start only after the durable posture restore completed',
  );
  assert.deepEqual(recovered.app.strategyIntakeState('basis'), {
    strategy: 'basis', desiredPaused: true, effectivePaused: true,
    controlRevision: 1, state: 'APPLIED',
  });

  const failed = fixture({ ledger: first.ledger, strategyIntakeRestoreThrows: 'basis' });
  const failedStart = failed.app.start();
  assert.equal(failedStart.ok, false);
  assert.equal(failedStart.phase, 'FAILED');
  assert.equal(failed.states.market.starts, 0);
  assert.equal(failed.states.basis.starts, 0);
  assert.equal(failed.states.volume.starts, 0);
});

test('MIS-075 persists versioned strategy symbol policy, blocks first, guards allow, and restores before runtime admission', async () => {
  assert.equal(parseControlBody({
    command: 'SET_BASIS_SYMBOL_POLICY', expectedRevision: 0, reason: 'block canonical symbol',
    action: 'BLOCK', symbol: 'BTCUSDT',
  }).ok, true);
  assert.equal(parseControlBody({
    command: 'SET_BASIS_SYMBOL_POLICY', expectedRevision: 0, reason: 'reject normalization ambiguity',
    action: 'BLOCK', symbol: 'btcusdt',
  }).ok, false);
  assert.equal(parseControlBody({
    command: 'SET_VOLUME_SYMBOL_POLICY', expectedRevision: 0, reason: 'reject payload substitution',
    action: 'ALLOW', symbol: 'ETHUSDT', unexpected: true,
  }).ok, false);
  const restartTruth = Object.freeze({
    publicSourceTruth: 'FRESH', accountTruth: 'FRESH', reconciliationTruth: 'FRESH', observedAtMs: T0,
  });
  const first = fixture({ externalKill: false, restartTruth });
  assert.equal(first.app.start().ok, true);

  const basisBlock = await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_BASIS_SYMBOL_POLICY', action: 'BLOCK', symbol: 'BTCUSDT',
  }, 'basis-symbol-block'), ACTOR);
  assert.equal(basisBlock.ok, true);
  assert.deepEqual([...first.strategySymbolPolicyState.basis], ['BTCUSDT']);
  assert.deepEqual([...first.strategySymbolPolicyState.volume], [], 'strategy policy owners must remain isolated');

  const stale = validControlRequest(first, {
    command: 'SET_VOLUME_SYMBOL_POLICY', action: 'BLOCK', symbol: 'ETHUSDT',
  }, 'volume-symbol-stale');
  stale.expectedRevision = 0;
  const staleResult = await first.app.controls.mutate(stale, ACTOR);
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.failure.code, 'STALE_COMMAND_REVISION');

  const volumeBlock = await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_VOLUME_SYMBOL_POLICY', action: 'BLOCK', symbol: 'ETHUSDT',
  }, 'volume-symbol-block'), ACTOR);
  assert.equal(volumeBlock.ok, true);
  const blockedCheckpoint = decodeSystemCheckpoint(first.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(blockedCheckpoint.ok, true);
  assert.deepEqual(blockedCheckpoint.value.strategySymbolPolicy, {
    basisBlocked: ['BTCUSDT'], volumeBlocked: ['ETHUSDT'],
  });

  const guardedAllow = await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_BASIS_SYMBOL_POLICY', action: 'ALLOW', symbol: 'BTCUSDT',
  }, 'basis-symbol-allow-guarded'), ACTOR);
  assert.equal(guardedAllow.ok, false);
  assert.equal(guardedAllow.failure.code, 'EFFECTIVE_INTAKE_PAUSED');
  assert.equal(first.strategySymbolPolicyState.basis.has('BTCUSDT'), true);

  assert.equal((await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_KILL_SWITCH', engaged: false,
  }, 'symbol-policy-release-kill'), ACTOR)).ok, true);
  assert.equal((await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_INTAKE_PAUSED', paused: false,
  }, 'symbol-policy-release-intake'), ACTOR)).ok, true);
  const allowed = await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_BASIS_SYMBOL_POLICY', action: 'ALLOW', symbol: 'BTCUSDT',
  }, 'basis-symbol-allow'), ACTOR);
  assert.equal(allowed.ok, true);
  assert.deepEqual(first.app.strategySymbolPolicyState('basis', 'BTCUSDT'), {
    strategy: 'basis', symbol: 'BTCUSDT', desiredBlocked: false, effectiveBlocked: false,
    effectiveAllowed: true, controlRevision: 5, state: 'APPLIED',
  });

  const recovered = fixture({ ledger: first.ledger, externalKill: false });
  assert.equal(recovered.app.start().ok, true);
  assert.deepEqual(recovered.strategySymbolPolicyOrder, ['volume:BLOCK:ETHUSDT']);
  assert.equal(recovered.strategySymbolPolicyState.volume.has('ETHUSDT'), true);
  await drive(recovered, 4);
  assert.equal(recovered.states.market.starts, 1);

  const failed = fixture({ ledger: first.ledger, externalKill: false, strategySymbolPolicyRestoreThrows: 'volume' });
  const failedStart = failed.app.start();
  assert.equal(failedStart.ok, false);
  assert.equal(failedStart.phase, 'FAILED');
  assert.equal(failed.states.market.starts, 0);
  assert.equal(failed.states.basis.starts, 0);
});

test('MIS-074 reduces exact Capital/config size ceilings only and reports unavailable truth honestly', async () => {
  for (const maximumNotionalUsd of ['1e1', '08', '8.0', '0', '-1', ' 8', '8 ']) {
    assert.equal(parseControlBody({
      command: 'REDUCE_SIZE_CEILING', expectedRevision: 0, reason: 'hostile exact decimal',
      scope: 'SYSTEM', maximumNotionalUsd,
    }).ok, false, maximumNotionalUsd);
  }
  assert.equal(parseControlBody({
    command: 'REDUCE_SIZE_CEILING', expectedRevision: 0, reason: 'canonical exact decimal',
    scope: 'SYSTEM', maximumNotionalUsd: '8.5',
  }).ok, true);

  const first = fixture();
  assert.equal(first.app.start().ok, true);
  assert.deepEqual(first.app.sizeCeilingState('SYSTEM'), {
    scope: 'SYSTEM', desiredMaximumNotionalUsd: null, effectiveMaximumNotionalUsd: '12',
    controlRevision: 0, state: 'UNAVAILABLE',
  }, 'no durable desired value must not be presented as applied');

  const systemReduction = await first.app.controls.mutate(validControlRequest(first, {
    command: 'REDUCE_SIZE_CEILING', scope: 'SYSTEM', maximumNotionalUsd: '8.5',
  }, 'system-size-reduce'), ACTOR);
  assert.equal(systemReduction.ok, true);
  assert.equal(first.sizeCeilingState.SYSTEM, '8.5');
  assert.deepEqual(first.app.sizeCeilingState('SYSTEM'), {
    scope: 'SYSTEM', desiredMaximumNotionalUsd: '8.5', effectiveMaximumNotionalUsd: '8.5',
    controlRevision: 1, state: 'APPLIED',
  });

  const increase = await first.app.controls.mutate(validControlRequest(first, {
    command: 'REDUCE_SIZE_CEILING', scope: 'SYSTEM', maximumNotionalUsd: '9',
  }, 'system-size-increase'), ACTOR);
  assert.equal(increase.ok, false);
  assert.equal(increase.failure.code, 'SIZE_CEILING_INCREASE_FORBIDDEN');
  assert.equal(first.sizeCeilingState.SYSTEM, '8.5');

  for (const [scope, value] of [['BASIS', '7'], ['VOLUME', '6.25']]) {
    const reduced = await first.app.controls.mutate(validControlRequest(first, {
      command: 'REDUCE_SIZE_CEILING', scope, maximumNotionalUsd: value,
    }, `${scope.toLowerCase()}-size-reduce`), ACTOR);
    assert.equal(reduced.ok, true);
  }
  assert.deepEqual(first.sizeCeilingState, { SYSTEM: '8.5', BASIS: '7', VOLUME: '6.25' });
  const durable = decodeSystemCheckpoint(first.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(durable.ok, true);
  assert.deepEqual(durable.value.sizeCeilings, { system: '8.5', basis: '7', volume: '6.25' });

  const recovered = fixture({ ledger: first.ledger });
  assert.equal(recovered.app.start().ok, true);
  assert.deepEqual(recovered.sizeCeilingOrder, ['SYSTEM:8.5', 'BASIS:7', 'VOLUME:6.25']);
  assert.deepEqual(recovered.sizeCeilingState, { SYSTEM: '8.5', BASIS: '7', VOLUME: '6.25' });

  const unavailable = fixture({ sizeCeilingReadUnavailable: 'SYSTEM' });
  assert.equal(unavailable.app.start().ok, true);
  const refused = await unavailable.app.controls.mutate(validControlRequest(unavailable, {
    command: 'REDUCE_SIZE_CEILING', scope: 'SYSTEM', maximumNotionalUsd: '8',
  }, 'system-size-unavailable'), ACTOR);
  assert.equal(refused.ok, false);
  assert.equal(refused.failure.code, 'SIZE_CEILING_EFFECT_UNAVAILABLE');
  assert.equal(unavailable.app.sizeCeilingState('SYSTEM').state, 'UNAVAILABLE');

  const widenedRuntime = fixture({ ledger: first.ledger, initialSystemSizeCeiling: '5' });
  const failedStart = widenedRuntime.app.start();
  assert.equal(failedStart.ok, false, 'restart restore cannot widen a stricter runtime owner');
  assert.equal(failedStart.phase, 'FAILED');
  assert.equal(widenedRuntime.states.market.starts, 0);
});

test('MIS-076 mutates only approved versioned strategy thresholds, guards lowering, and restores exact owner state', async () => {
  for (const hostile of [
    { strategy: 'BASIS', threshold: 'VOLUME_1S_MULTIPLE', value: '1' },
    { strategy: 'VOLUME', threshold: 'MIN_NET_BASIS_PCT', value: '1' },
    { strategy: 'BASIS', threshold: 'MIN_NET_BASIS_PCT', value: '0.009' },
    { strategy: 'VOLUME', threshold: 'VOLUME_1S_MULTIPLE', value: '101' },
    { strategy: 'BASIS', threshold: 'MIN_NET_BASIS_PCT', value: '1e-2' },
    { strategy: 'BASIS', threshold: 'MIN_NET_BASIS_PCT', value: '0.10' },
  ]) {
    assert.equal(parseControlBody({
      command: 'SET_STRATEGY_THRESHOLD', expectedRevision: 0,
      reason: 'hostile closed-catalog threshold', ...hostile,
    }).ok, false, JSON.stringify(hostile));
  }
  assert.equal(parseControlBody({
    command: 'SET_STRATEGY_THRESHOLD', expectedRevision: 0,
    reason: 'reject arbitrary payload expansion', strategy: 'BASIS',
    threshold: 'MIN_NET_BASIS_PCT', value: '0.5', arbitrary: true,
  }).ok, false);
  assert.equal(parseControlBody({
    command: 'SET_STRATEGY_THRESHOLD', expectedRevision: 0,
    reason: 'approved bounded threshold', strategy: 'BASIS',
    threshold: 'MIN_NET_BASIS_PCT', value: '0.5',
  }).ok, true);

  const restartTruth = Object.freeze({
    publicSourceTruth: 'FRESH', accountTruth: 'FRESH', reconciliationTruth: 'FRESH', observedAtMs: T0,
  });
  const first = fixture({ externalKill: false, restartTruth });
  assert.equal(first.app.start().ok, true);
  assert.deepEqual(first.app.strategyThresholdState('BASIS'), {
    strategy: 'BASIS', threshold: 'MIN_NET_BASIS_PCT', desiredValue: null,
    effectiveValue: '0.25', controlRevision: 0, state: 'UNAVAILABLE',
  });

  const raised = await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_STRATEGY_THRESHOLD', strategy: 'BASIS',
    threshold: 'MIN_NET_BASIS_PCT', value: '0.5',
  }, 'basis-threshold-raise'), ACTOR);
  assert.equal(raised.ok, true, 'raising a selectivity threshold is risk-reducing');
  assert.equal(first.strategyThresholdState.BASIS, '0.5');

  const stale = validControlRequest(first, {
    command: 'SET_STRATEGY_THRESHOLD', strategy: 'VOLUME',
    threshold: 'VOLUME_1S_MULTIPLE', value: '4',
  }, 'volume-threshold-stale');
  stale.expectedRevision = 0;
  const staleResult = await first.app.controls.mutate(stale, ACTOR);
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.failure.code, 'STALE_COMMAND_REVISION');

  const guarded = await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_STRATEGY_THRESHOLD', strategy: 'BASIS',
    threshold: 'MIN_NET_BASIS_PCT', value: '0.2',
  }, 'basis-threshold-lower-guarded'), ACTOR);
  assert.equal(guarded.ok, false);
  assert.equal(guarded.failure.code, 'EFFECTIVE_INTAKE_PAUSED');
  assert.equal(first.strategyThresholdState.BASIS, '0.5');

  assert.equal((await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_KILL_SWITCH', engaged: false,
  }, 'threshold-release-kill'), ACTOR)).ok, true);
  assert.equal((await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_INTAKE_PAUSED', paused: false,
  }, 'threshold-release-intake'), ACTOR)).ok, true);
  const lowered = await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_STRATEGY_THRESHOLD', strategy: 'BASIS',
    threshold: 'MIN_NET_BASIS_PCT', value: '0.2',
  }, 'basis-threshold-lower'), ACTOR);
  assert.equal(lowered.ok, true);
  const volumeRaised = await first.app.controls.mutate(validControlRequest(first, {
    command: 'SET_STRATEGY_THRESHOLD', strategy: 'VOLUME',
    threshold: 'VOLUME_1S_MULTIPLE', value: '4',
  }, 'volume-threshold-raise'), ACTOR);
  assert.equal(volumeRaised.ok, true);

  assert.deepEqual(first.app.strategyThresholdState('BASIS'), {
    strategy: 'BASIS', threshold: 'MIN_NET_BASIS_PCT', desiredValue: '0.2',
    effectiveValue: '0.2', controlRevision: 5, state: 'APPLIED',
  });
  const durable = decodeSystemCheckpoint(first.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(durable.ok, true);
  assert.deepEqual(durable.value.strategyThresholds, { basisMinNetPct: '0.2', volume1sMultiple: '4' });

  const recovered = fixture({ ledger: first.ledger, externalKill: false });
  assert.equal(recovered.app.start().ok, true);
  assert.deepEqual(recovered.strategyThresholdOrder, ['BASIS:0.2', 'VOLUME:4']);
  assert.deepEqual(recovered.strategyThresholdState, { BASIS: '0.2', VOLUME: '4' });
  await drive(recovered, 4);
  assert.ok(recovered.order.indexOf('runtime:start:basis') > recovered.order.indexOf('threshold:set:BASIS:0.2'));

  const failed = fixture({ ledger: first.ledger, externalKill: false, strategyThresholdRestoreThrows: 'VOLUME' });
  const failedStart = failed.app.start();
  assert.equal(failedStart.ok, false);
  assert.equal(failedStart.phase, 'FAILED');
  assert.equal(failed.states.market.starts, 0);

  const unavailable = fixture({ strategyThresholdOwnerUnavailable: 'BASIS' });
  assert.equal(unavailable.app.start().ok, true);
  const refused = await unavailable.app.controls.mutate(validControlRequest(unavailable, {
    command: 'SET_STRATEGY_THRESHOLD', strategy: 'BASIS',
    threshold: 'MIN_NET_BASIS_PCT', value: '0.5',
  }, 'basis-threshold-owner-unavailable'), ACTOR);
  assert.equal(refused.ok, false);
  assert.equal(refused.failure.code, 'STRATEGY_THRESHOLD_OWNER_NOT_WIRED');
  assert.equal(unavailable.app.strategyThresholdState('BASIS').state, 'OWNER_NOT_WIRED');
});

test('supervisor reuses one persisted trace cut until checkpoint revision advances', async () => {
  const f = fixture({
    externalKill: false,
    restartTruth: Object.freeze({
      publicSourceTruth: 'FRESH',
      accountTruth: 'FRESH',
      reconciliationTruth: 'FRESH',
      observedAtMs: T0,
    }),
  });
  assert.equal(f.app.start().ok, true);
  await drive(f, 6);

  const beforeFirstRead = f.traceWindowReads();
  f.app.supervisor();
  assert.equal(f.traceWindowReads(), beforeFirstRead + 1);
  f.app.supervisor();
  await f.app.read.graph();
  assert.equal(f.traceWindowReads(), beforeFirstRead + 1);

  const mutation = await f.app.controls.mutate(validControlRequest(f, {
    command: 'SET_SAFE_MODE', safeMode: 'ADVISORY',
  }, 'trace-cache-revision'), ACTOR);
  assert.equal(mutation.ok, true);
  const beforeAdvancedRead = f.traceWindowReads();
  f.app.supervisor();
  assert.equal(f.traceWindowReads(), beforeAdvancedRead + 1);
  f.app.supervisor();
  assert.equal(f.traceWindowReads(), beforeAdvancedRead + 1);
});

test('startup persists only an owner-supplied current restart observation before runtime admission', () => {
  const restartTruth = Object.freeze({
    publicSourceTruth: 'FRESH',
    accountTruth: 'FRESH',
    reconciliationTruth: 'FRESH',
    observedAtMs: T0,
  });
  const f = fixture({ externalKill: false, restartTruth });
  const started = f.app.start();

  assert.equal(started.ok, true);
  assert.equal(started.restartBarrier.canOpenOrIncrease, true);
  const truthRead = f.order.indexOf('lifecycle:restart-truth');
  assert.ok(truthRead > f.order.indexOf('ledger:load'));
  assert.ok(f.order.lastIndexOf('ledger:persist') > truthRead);
  assert.ok(f.order.indexOf('runtime:init:market') > f.order.lastIndexOf('ledger:persist'));
  const checkpoint = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(checkpoint.ok, true);
  assert.deepEqual(checkpoint.value.restartTruth, restartTruth);
});

test('throwing restart observation is persisted as explicit unavailable truth and cannot open the barrier', () => {
  const f = fixture({ externalKill: false, restartTruthThrows: true });
  const started = f.app.start();

  assert.equal(started.ok, true);
  assert.equal(started.restartBarrier.canOpenOrIncrease, false);
  assert.ok(started.restartBarrier.reasonCodes.includes('ACCOUNT_TRUTH_UNAVAILABLE'));
  const checkpoint = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(checkpoint.ok, true);
  assert.deepEqual(checkpoint.value.restartTruth, {
    publicSourceTruth: 'UNKNOWN',
    accountTruth: 'UNAVAILABLE',
    reconciliationTruth: 'UNKNOWN',
    observedAtMs: T0,
  });
});

test('restart-truth persistence failure blocks every runtime before admission', () => {
  const f = fixture({
    externalKill: false,
    persistenceWriteFailureAtCall: 2,
    restartTruth: Object.freeze({
      publicSourceTruth: 'FRESH',
      accountTruth: 'FRESH',
      reconciliationTruth: 'FRESH',
      observedAtMs: T0,
    }),
  });
  const started = f.app.start();

  assert.equal(started.ok, false);
  assert.equal(started.phase, 'FAILED');
  assert.equal(started.persistenceFailureCode, 'PERSISTENCE_WRITE_FAILED');
  assert.equal(started.compositionCommand, null);
  assert.deepEqual(
    [
      f.states.market.inits,
      f.states.intelligenceRuntime.starts,
      f.states.marketIntelligence.starts,
      f.states.basis.starts,
      f.states.volume.starts,
    ],
    [0, 0, 0, 0, 0],
  );
});

test('effectful restart-truth refresh coalesces owner read plus durable commit while passive reads stay mutation-free', async () => {
  let releaseFirstRefresh;
  const firstRefresh = new Promise((resolve) => { releaseFirstRefresh = resolve; });
  const refreshedTruth = (observedAtMs) => Object.freeze({
    publicSourceTruth: 'FRESH',
    accountTruth: 'FRESH',
    reconciliationTruth: 'FRESH',
    observedAtMs,
  });
  const f = fixture({
    externalKill: false,
    restartTruthRefreshIntervalMs: 5,
    refreshRestartTruth: (nowMs, call) => (
      call === 1 ? firstRefresh : refreshedTruth(nowMs)
    ),
  });

  const started = f.app.start();
  assert.equal(started.ok, true);
  assert.equal(f.restartTruthRefreshCalls(), 1);
  const concurrentA = f.app.refreshRestartTruth();
  const concurrentB = f.app.refreshRestartTruth();
  assert.strictEqual(concurrentA, concurrentB);
  assert.equal(f.restartTruthRefreshCalls(), 1);

  await f.app.read.supervisor();
  await f.app.read.graph();
  await f.app.read.controls();
  await f.app.read.events({ limit: 20 });
  assert.equal(f.restartTruthRefreshCalls(), 1);

  releaseFirstRefresh(refreshedTruth(f.clock.nowMs()));
  const barrier = await concurrentA;
  assert.equal(barrier.canOpenOrIncrease, true);
  let checkpoint = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(checkpoint.ok, true);
  assert.deepEqual(checkpoint.value.restartTruth, refreshedTruth(T0));

  f.scheduler.advanceAndRun(5);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.restartTruthRefreshCalls(), 2);
  checkpoint = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(checkpoint.ok, true);
  assert.deepEqual(checkpoint.value.restartTruth, refreshedTruth(T0 + 5));
});

test('throwing or malformed refresh is durably unavailable and a transient persistence failure stays fail-closed', async () => {
  for (const options of [
    { refreshRestartTruthThrows: true },
    { refreshRestartTruth: () => ({ publicSourceTruth: 'FRESH' }) },
  ]) {
    const f = fixture({ externalKill: false, ...options });
    assert.equal(f.app.start().ok, true);
    const barrier = await f.app.refreshRestartTruth();
    assert.equal(barrier.canOpenOrIncrease, false);
    assert.equal(barrier.reasonCodes.includes('ACCOUNT_TRUTH_UNAVAILABLE'), true);
    const checkpoint = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.equal(checkpoint.ok, true);
    assert.deepEqual(checkpoint.value.restartTruth, {
      publicSourceTruth: 'UNKNOWN',
      accountTruth: 'UNAVAILABLE',
      reconciliationTruth: 'UNKNOWN',
      observedAtMs: T0,
    });
  }

  const recovered = fixture({
    externalKill: false,
    persistenceWriteFailureAtCall: 3,
    refreshRestartTruth: (nowMs) => ({
      publicSourceTruth: 'FRESH',
      accountTruth: 'FRESH',
      reconciliationTruth: 'FRESH',
      observedAtMs: nowMs,
    }),
  });
  assert.equal(recovered.app.start().ok, true);
  let barrier = await recovered.app.refreshRestartTruth();
  assert.deepEqual(barrier.reasonCodes, ['RESTART_TRUTH_REFRESH_PERSISTENCE_WRITE_FAILED']);
  assert.equal(recovered.app.supervisor().overallPosture, 'FAILED');
  barrier = await recovered.app.refreshRestartTruth();
  assert.equal(barrier.canOpenOrIncrease, true);
  assert.notEqual(recovered.app.supervisor().overallPosture, 'FAILED');
});

test('drain cancels a pending restart-truth owner read before it can write after the final checkpoint', async () => {
  let releaseRefresh;
  const deferred = new Promise((resolve) => { releaseRefresh = resolve; });
  const f = fixture({
    externalKill: false,
    ordinaryDrainTruth: canonicalDrainTruth({
      exposureState: 'NONE',
      ambiguityState: 'NONE',
      recoveryState: 'NONE',
    }),
    refreshRestartTruth: () => deferred,
  });
  assert.equal(f.app.start().ok, true);
  const pending = f.app.refreshRestartTruth();
  await drive(f, 6);
  const drained = await drainAndDrive(f);
  assert.equal(drained.ledgerCloseMayProceed, true);
  const sealed = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(sealed.ok, true);

  releaseRefresh({
    publicSourceTruth: 'FRESH',
    accountTruth: 'FRESH',
    reconciliationTruth: 'FRESH',
    observedAtMs: f.clock.nowMs(),
  });
  const cancelled = await pending;
  assert.deepEqual(cancelled.reasonCodes, ['RESTART_TRUTH_REFRESH_CANCELLED']);
  const afterLateRead = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(afterLateRead.ok, true);
  assert.equal(afterLateRead.value.revision, sealed.value.revision);
  assert.deepEqual(afterLateRead.value.restartTruth, sealed.value.restartTruth);
});

test('drain request fences refresh before async admission and a refusal re-arms a new epoch', async () => {
  let releaseRefresh;
  let releaseDrainTruth;
  const deferredRefresh = new Promise((resolve) => { releaseRefresh = resolve; });
  const deferredDrainTruth = new Promise((resolve) => { releaseDrainTruth = resolve; });
  const f = fixture({
    externalKill: false,
    ordinaryDrainTruth: deferredDrainTruth,
    refreshRestartTruth: (nowMs, call) => call === 1
      ? deferredRefresh
      : {
          publicSourceTruth: 'FRESH',
          accountTruth: 'FRESH',
          reconciliationTruth: 'FRESH',
          observedAtMs: nowMs,
        },
  });
  assert.equal(f.app.start().ok, true);
  const pendingRefresh = f.app.refreshRestartTruth();
  const beforeDrain = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(beforeDrain.ok, true);

  const draining = f.app.drain();
  const blockedDuringAdmission = await f.app.refreshRestartTruth();
  assert.equal(blockedDuringAdmission.canOpenOrIncrease, false);
  assert.equal(f.restartTruthRefreshCalls(), 1);
  releaseRefresh({
    publicSourceTruth: 'FRESH',
    accountTruth: 'FRESH',
    reconciliationTruth: 'FRESH',
    observedAtMs: f.clock.nowMs(),
  });
  const cancelled = await pendingRefresh;
  assert.deepEqual(cancelled.reasonCodes, ['RESTART_TRUTH_REFRESH_CANCELLED']);
  const duringAdmission = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(duringAdmission.ok, true);
  assert.equal(duringAdmission.value.revision, beforeDrain.value.revision);

  releaseDrainTruth(canonicalDrainTruth({ exposureState: 'ACTIVE' }));
  const refused = await draining;
  assert.equal(refused.disposition, 'REFUSED_RECOVERY_SUPERVISION_REQUIRED');
  assert.equal(refused.phase, 'RUNNING');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.restartTruthRefreshCalls(), 2);
  const rearmed = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(rearmed.ok, true);
  assert.equal(rearmed.value.revision, beforeDrain.value.revision + 1);
  assert.equal(rearmed.value.restartTruth.observedAtMs, f.clock.nowMs());
});

test('production facade exposes three passive unavailable-owner events without granting readiness or control', async () => {
  const passiveEvidence = createPassiveOwnerEvidenceReadPort({ evaluatedAtMs: T0 });
  const f = fixture({ externalKill: false, traces: passiveEvidence });
  assert.equal(f.app.start().ok, true);
  await drive(f, 6);
  const controlBeforeReads = f.app.controlState();

  const trace = await f.app.read.trace(PASSIVE_OWNER_EVIDENCE_CORRELATION_ID);
  assert.ok(trace);
  assert.equal(trace.events.length, 3);
  assert.equal(trace.events.every((event) => event.truthLabel === 'UNAVAILABLE'), true);
  assert.equal(trace.events.every((event) => event.releaseStatuses.includes('NOT_CONFIGURED')), true);
  assert.equal(trace.events.every((event) => event.machinePhase === null), true);
  assert.equal(trace.events.every((event) => event.failure === null), true);
  assert.equal(trace.events.some((event) => (
    event.referenceIds.includes('privateTruthState=OWNER_GATED')
  )), true);
  assert.equal(trace.events.some((event) => (
    event.referenceIds.includes('coverageState=UNKNOWN')
  )), true);

  const supervisor = f.app.supervisor();
  assert.notEqual(supervisor.overallPosture, 'READY');
  assert.equal(supervisor.truthLabel === 'LIVE_PUBLIC', false);
  assert.equal(supervisor.traceIndex.entries.some((entry) => (
    entry.correlationId === PASSIVE_OWNER_EVIDENCE_CORRELATION_ID
    && entry.truthLabels.every((truthLabel) => truthLabel === 'UNAVAILABLE')
  )), true);
  assert.deepEqual(f.app.controlState(), controlBeforeReads);
  assert.equal(passiveEvidence.readPassiveOwnerEvidence().controlAuthority, 'NONE');
  assert.equal(passiveEvidence.readPassiveOwnerEvidence().readinessAuthority, 'NONE');
  assert.equal(Object.hasOwn(passiveEvidence, 'mutate'), false);
  assert.equal(Object.hasOwn(passiveEvidence, 'refresh'), false);
});

test('warming required source becomes ready without fabricating a historical failure', async () => {
  const f = fixture({ marketUnavailableProbes: 2 });
  assert.equal(f.app.start().ok, true);
  await drive(f, 10);
  const supervisor = f.app.supervisor();
  const market = supervisor.components.find((entry) => entry.componentId === 'market-universe');
  assert.equal(market.phase, 'RUNNING');
  assert.equal(market.readiness, 'READY');
  assert.equal(market.lastFailure, null);
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
  assert.equal(drained.disposition, 'DRAINED');
  assert.equal(drained.phase, 'DRAINED');
  assert.deepEqual(drained.blockerCodes, []);
  assert.deepEqual(drained.blockingIdentityReferences, []);
  assert.equal(drained.ledgerCloseMayProceed, true);
  assert.ok(f.order.includes('lifecycle:local-mutation-authority'));
  assert.ok(f.order.includes('lifecycle:ordinary-drain-truth'));
  const stopOrder = f.order.filter((entry) => entry.startsWith('runtime:stop:'));
  assert.deepEqual(stopOrder.slice(-5), [
    'runtime:stop:volume',
    'runtime:stop:basis',
    'runtime:stop:market-intelligence',
    'runtime:stop:intelligence-runtime',
    'runtime:stop:market',
  ]);
  const decoded = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.lastShutdown.clean, true);
  assert.ok(f.order.lastIndexOf('ledger:persist') > f.order.lastIndexOf('runtime:stop:market'));
});

test('RESTART_COMPONENT stays pending until its exact supervisor correlation and generation complete', async () => {
  const f = fixture({
    externalKill: false,
    localMutationAuthority: 'PROVEN_ABSENT',
    ordinaryDrainTruth: canonicalDrainTruth({
      exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE',
    }),
  });
  assert.equal(f.app.start().ok, true);
  await drive(f, 8);
  const request = validControlRequest(f, {
    command: 'RESTART_COMPONENT', componentId: 'market-universe',
  }, 'strong-zero-restart');
  const result = await f.app.controls.mutate(request, ACTOR);

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  const pending = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(pending.ok, true);
  const pendingReceipt = pending.value.idempotencyReceipts.find(
    (entry) => entry.idempotencyKey === 'application.control.strong-zero-restart',
  );
  assert.equal(pendingReceipt.receipt.runtimePublication, 'PENDING');
  assert.ok(f.app.managedRuntime().supervisor.commandCorrelationId);
  assert.equal(f.app.restartBarrier().reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'), true);

  await drive(f, 12);
  assert.equal(f.app.managedRuntime().supervisor.commandCorrelationId, null);
  assert.equal(f.app.managedRuntime().supervisor.phase, 'RUNNING');
  const startsAfterCompletion = f.states.market.starts;
  const reconciled = await f.app.controls.mutate(request, ACTOR);
  assert.equal(reconciled.ok, true);
  assert.equal(f.states.market.starts, startsAfterCompletion, 'completion readback must not reissue restart');
  const completed = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(completed.ok, true);
  const completedReceipt = completed.value.idempotencyReceipts.find(
    (entry) => entry.idempotencyKey === 'application.control.strong-zero-restart',
  );
  assert.equal(completedReceipt.receipt.runtimePublication, 'PUBLISHED');
  assert.equal(f.app.restartBarrier().reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'), false);
});

test('bounded subsystem restart publishes only after exact dependent-closure readback', async () => {
  const f = fixture({
    externalKill: false,
    localMutationAuthority: 'PROVEN_ABSENT',
    ordinaryDrainTruth: canonicalDrainTruth({
      exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE',
    }),
  });
  assert.equal(f.app.start().ok, true);
  await drive(f, 8);
  const initialStarts = structuredClone(f.states);
  const lifecycleStart = f.order.length;
  const request = validControlRequest(f, {
    command: 'RESTART_COMPONENT', componentId: 'market-intelligence',
  }, 'bounded-subsystem-restart');

  const pendingResult = await f.app.controls.mutate(request, ACTOR);
  assert.equal(pendingResult.ok, false);
  assert.equal(pendingResult.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  const pending = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(pending.ok, true);
  assert.equal(pending.value.idempotencyReceipts.find(
    (entry) => entry.idempotencyKey === request.idempotencyKey,
  ).receipt.runtimePublication, 'PENDING');

  await drive(f, 8);
  assert.deepEqual(
    f.order.slice(lifecycleStart).filter((entry) => entry.startsWith('runtime:stop:') || entry.startsWith('runtime:start:')),
    [
      'runtime:stop:volume', 'runtime:stop:basis', 'runtime:stop:market-intelligence',
      'runtime:start:market-intelligence', 'runtime:start:basis', 'runtime:start:volume',
    ],
  );
  assert.equal(f.states.market.starts, initialStarts.market.starts, 'upstream market owner must remain running');
  assert.equal(
    f.states.intelligenceRuntime.starts,
    initialStarts.intelligenceRuntime.starts,
    'upstream intelligence runtime must remain running',
  );

  const startsAfterCompletion = structuredClone(f.states);
  const published = await f.app.controls.mutate(request, ACTOR);
  assert.equal(published.ok, true);
  assert.deepEqual(f.states, startsAfterCompletion, 'durable replay must not reissue the restart');
  const completed = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(completed.ok, true);
  assert.equal(completed.value.idempotencyReceipts.find(
    (entry) => entry.idempotencyKey === request.idempotencyKey,
  ).receipt.runtimePublication, 'PUBLISHED');
});

test('failed asynchronous restart never becomes published and exact replay never reissues it', async () => {
  const f = fixture({
    externalKill: false,
    localMutationAuthority: 'PROVEN_ABSENT',
    ordinaryDrainTruth: canonicalDrainTruth({
      exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE',
    }),
    marketStartThrowsAtCall: 2,
  });
  assert.equal(f.app.start().ok, true);
  await drive(f, 8);
  const request = validControlRequest(f, {
    command: 'RESTART_COMPONENT', componentId: 'market-universe',
  }, 'failed-async-restart');

  const pending = await f.app.controls.mutate(request, ACTOR);
  assert.equal(pending.ok, false);
  assert.equal(pending.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  await drive(f, 20);
  assert.equal(f.app.managedRuntime().supervisor.phase, 'FAILED');
  assert.equal(f.app.managedRuntime().supervisor.commandCorrelationId, null);
  const beforeReplay = structuredClone(f.states);

  const replay = await f.app.controls.mutate(request, ACTOR);
  assert.equal(replay.ok, false);
  assert.equal(replay.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  assert.deepEqual(f.states, beforeReplay, 'failed correlated restart must not be reissued');
  const decoded = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(decoded.ok, true);
  const stored = decoded.value.idempotencyReceipts.find(
    (entry) => entry.idempotencyKey === 'application.control.failed-async-restart',
  );
  assert.equal(stored.receipt.runtimePublication, 'PENDING');
  assert.equal(f.app.restartBarrier().reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'), true);
});

for (const unsafe of [
  {
    name: 'local mutation authority UNKNOWN',
    localMutationAuthority: 'UNKNOWN',
    truth: { exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE' },
    code: 'RESTART_LOCAL_MUTATION_AUTHORITY_NOT_PROVEN_ABSENT',
  },
  {
    name: 'ACTIVE exposure',
    localMutationAuthority: 'PROVEN_ABSENT',
    truth: { exposureState: 'ACTIVE', ambiguityState: 'NONE', recoveryState: 'NONE' },
    code: 'RESTART_EXPOSURE_NONE_NOT_PROVEN',
  },
  {
    name: 'UNKNOWN exposure',
    localMutationAuthority: 'PROVEN_ABSENT',
    truth: { exposureState: 'UNKNOWN', ambiguityState: 'NONE', recoveryState: 'NONE' },
    code: 'RESTART_EXPOSURE_NONE_NOT_PROVEN',
  },
  {
    name: 'AMBIGUOUS truth',
    localMutationAuthority: 'PROVEN_ABSENT',
    truth: { exposureState: 'NONE', ambiguityState: 'AMBIGUOUS', recoveryState: 'NONE' },
    code: 'RESTART_AMBIGUITY_NONE_NOT_PROVEN',
  },
  {
    name: 'RECOVERY_REQUIRED truth',
    localMutationAuthority: 'PROVEN_ABSENT',
    truth: { exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'RECOVERY_REQUIRED' },
    code: 'RESTART_RECOVERY_NONE_NOT_PROVEN',
  },
]) {
  test(`RESTART_COMPONENT fails closed for ${unsafe.name}`, async () => {
    const f = fixture({
      externalKill: false,
      localMutationAuthority: unsafe.localMutationAuthority,
      ordinaryDrainTruth: canonicalDrainTruth(unsafe.truth),
    });
    assert.equal(f.app.start().ok, true);
    await drive(f, 8);
    const before = f.app.controls.snapshot();
    const marketStarts = f.states.market.starts;
    const result = await f.app.controls.mutate(validControlRequest(f, {
      command: 'RESTART_COMPONENT', componentId: 'market-universe',
    }, `unsafe-restart-${unsafe.code.toLowerCase()}`), ACTOR);

    assert.equal(result.ok, false);
    assert.equal(result.failure.code, unsafe.code);
    assert.equal(f.app.controls.snapshot().revision, before.revision);
    assert.equal(f.app.controls.snapshot().generation, before.generation);
    assert.equal(f.states.market.starts, marketStarts);
  });
}

test('pending restart publication survives application boot and remains visible without blind reissue', async () => {
  const safety = {
    externalKill: false,
    localMutationAuthority: 'PROVEN_ABSENT',
    ordinaryDrainTruth: canonicalDrainTruth({
      exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE',
    }),
  };
  const first = fixture({ ...safety, persistenceWriteFailureAtCall: 4 });
  assert.equal(first.app.start().ok, true);
  await drive(first, 8);
  const restartRequest = validControlRequest(first, {
    command: 'RESTART_COMPONENT', componentId: 'market-universe',
  }, 'boot-pending-restart');
  const pending = await first.app.controls.mutate(restartRequest, ACTOR);
  assert.equal(pending.ok, false);
  assert.equal(pending.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');

  const restarted = fixture({ ...safety, ledger: first.ledger });
  const boot = restarted.app.start();
  assert.equal(boot.ok, true);
  assert.ok(boot.restartBarrier.reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'));
  await drive(restarted, 8);
  const supervisor = restarted.app.supervisor();
  assert.equal(supervisor.phase, 'FAILED');
  const supervisorComponent = supervisor.components.find(
    (component) => component.componentId === 'engine-supervisor',
  );
  assert.ok(supervisorComponent?.blockerCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'));
  assert.equal(supervisorComponent?.operatorAttentionRequired, true);
  const marketStarts = restarted.states.market.starts;

  const replay = await restarted.app.controls.mutate(restartRequest, ACTOR);
  assert.equal(replay.ok, false);
  assert.equal(replay.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  assert.equal(restarted.states.market.starts, marketStarts, 'UNKNOWN effect must not be reissued');
  const refusedDrain = await restarted.app.drain();
  assert.equal(refusedDrain.disposition, 'REFUSED_RECOVERY_SUPERVISION_REQUIRED');
  assert.equal(refusedDrain.blockingIdentityReferences[0].referenceType, 'AMBIGUOUS_MUTATION');
  assert.equal(refusedDrain.blockingIdentityReferences[0].resolutionState, 'RECOVERY_REQUIRED');

  const effectId = refusedDrain.blockingIdentityReferences[0].referenceId;
  restarted.setControlRuntimeEffect(effectId, 'APPLIED');
  const reconciled = await restarted.app.controls.mutate(restartRequest, ACTOR);
  assert.equal(reconciled.ok, true);
  assert.equal(restarted.states.market.starts, marketStarts, 'APPLIED readback marks without reissuing');
  assert.equal(restarted.app.restartBarrier().reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'), false);
});

test('stable boot posture cannot falsely reconcile a prior restart after correlation evidence is lost', async () => {
  const safety = {
    externalKill: false,
    localMutationAuthority: 'PROVEN_ABSENT',
    ordinaryDrainTruth: canonicalDrainTruth({
      exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE',
    }),
  };
  const first = fixture({ ...safety, persistenceWriteFailureAtCall: 4 });
  assert.equal(first.app.start().ok, true);
  await drive(first, 8);
  const request = validControlRequest(first, {
    command: 'RESTART_COMPONENT', componentId: 'market-universe',
  }, 'boot-owner-readback');
  const pending = await first.app.controls.mutate(request, ACTOR);
  assert.equal(pending.ok, false);
  assert.equal(pending.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');

  const restarted = fixture({
    ...safety,
    ledger: first.ledger,
    managedRuntimeEffectOwner: true,
  });
  assert.equal(restarted.app.start().ok, true);
  await drive(restarted, 8);
  const marketStarts = restarted.states.market.starts;

  const unresolved = await restarted.app.controls.mutate(request, ACTOR);
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');
  assert.equal(restarted.states.market.starts, marketStarts, 'boot posture must not reissue an unproved restart');
  assert.equal(restarted.app.restartBarrier().reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'), true);
});

for (const desiredState of ['STOPPED', 'PAUSED']) {
  test(`clean reboot restores persisted dependency-root ${desiredState} before readiness`, async () => {
    const safety = {
      externalKill: false,
      localMutationAuthority: 'PROVEN_ABSENT',
      ordinaryDrainTruth: canonicalDrainTruth({
        exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE',
      }),
    };
    const first = fixture(safety);
    assert.equal(first.app.start().ok, true);
    await drive(first, 8);
    const request = validControlRequest(first, {
      command: 'SET_COMPONENT_STATE', componentId: 'market-universe', desiredState,
    }, `clean-${desiredState.toLowerCase()}`);
    const applied = await first.app.controls.mutate(request, ACTOR);
    assert.equal(applied.ok, true);
    await drive(first, 8);
    assert.equal(first.app.managedRuntime().supervisor.phase, desiredState);
    assert.equal((await first.app.drain()).disposition, 'DRAINED');

    const restarted = fixture({ ...safety, ledger: first.ledger, managedRuntimeEffectOwner: true });
    const boot = restarted.app.start();
    assert.equal(boot.ok, true);
    if (desiredState === 'STOPPED') {
      assert.equal(boot.compositionCommand, null);
      assert.equal(restarted.states.market.starts, 0);
    }
    await drive(restarted, 10);
    assert.equal(restarted.app.managedRuntime().supervisor.phase, desiredState);
    assert.deepEqual(restarted.app.restartBarrier().reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'), false);
  });
}

for (const desiredState of ['STOPPED', 'PAUSED']) {
  test(`crash-window ${desiredState} intent boots to persisted posture and reconciles marker without reissue`, async () => {
    const safety = {
      externalKill: false,
      localMutationAuthority: 'PROVEN_ABSENT',
      ordinaryDrainTruth: canonicalDrainTruth({
        exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE',
      }),
    };
    const first = fixture({ ...safety, persistenceWriteFailureAtCall: 4 });
    assert.equal(first.app.start().ok, true);
    await drive(first, 8);
    const request = validControlRequest(first, {
      command: 'SET_COMPONENT_STATE', componentId: 'market-universe', desiredState,
    }, `crash-${desiredState.toLowerCase()}`);
    const pending = await first.app.controls.mutate(request, ACTOR);
    assert.equal(pending.ok, false);
    assert.equal(pending.failure.code, 'CONTROL_COMMITTED_RUNTIME_PENDING');

    const restarted = fixture({ ...safety, ledger: first.ledger, managedRuntimeEffectOwner: true });
    assert.equal(restarted.app.start().ok, true);
    await drive(restarted, 10);
    assert.equal(restarted.app.managedRuntime().supervisor.phase, desiredState);
    const beforeReplay = structuredClone(restarted.states);

    const reconciled = await restarted.app.controls.mutate(request, ACTOR);
    assert.equal(reconciled.ok, true);
    assert.deepEqual(restarted.states, beforeReplay, 'owner readback must not reissue the converged lifecycle effect');
    assert.equal(restarted.app.restartBarrier().reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'), false);
  });
}

test('unknown local mutation authority refuses ordinary drain even with canonical strong-zero truth', async () => {
  const f = fixture({
    externalKill: false,
    localMutationAuthority: 'UNKNOWN',
    ordinaryDrainTruth: canonicalDrainTruth({
      exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE',
    }),
  });
  assert.equal(f.app.start().ok, true);
  await drive(f, 6);
  const refused = await f.app.drain();

  assert.equal(refused.disposition, 'REFUSED_RECOVERY_SUPERVISION_REQUIRED');
  assert.deepEqual(refused.blockerCodes, [
    'ORDINARY_DRAIN_REFUSED_RECOVERY_SUPERVISION_REQUIRED',
    'ORDINARY_DRAIN_LOCAL_MUTATION_AUTHORITY_UNKNOWN',
  ]);
  assert.deepEqual(
    runtimeStopCounts(f),
    [0, 0, 0, 0, 0],
  );
});

test('present local mutation authority requires current canonical strong-zero reconciliation proof', async () => {
  const f = fixture({ externalKill: false, localMutationAuthority: 'PRESENT' });
  assert.equal(f.app.start().ok, true);
  await drive(f, 6);
  const refused = await f.app.drain();

  assert.equal(refused.ledgerCloseMayProceed, false);
  assert.ok(refused.blockerCodes.includes('ORDINARY_DRAIN_STRONG_ZERO_EXPOSURE_NOT_PROVEN'));
  assert.ok(refused.blockerCodes.includes('ORDINARY_DRAIN_AMBIGUITY_NOT_CLEARED'));
  assert.ok(refused.blockerCodes.includes('ORDINARY_DRAIN_RECOVERY_NOT_CLEARED'));
  assert.deepEqual(
    runtimeStopCounts(f),
    [0, 0, 0, 0, 0],
  );

  f.setOrdinaryDrainTruth(canonicalDrainTruth({
    exposureState: 'NONE', ambiguityState: 'NONE', recoveryState: 'NONE',
  }));
  const drained = await drainAndDrive(f);
  assert.equal(drained.disposition, 'DRAINED');
  assert.equal(drained.ledgerCloseMayProceed, true);
});

for (const unsafe of [
  { field: 'exposureState', value: 'ACTIVE', code: 'ORDINARY_DRAIN_EXPOSURE_ACTIVE' },
  { field: 'ambiguityState', value: 'AMBIGUOUS', code: 'ORDINARY_DRAIN_AMBIGUITY_PRESENT' },
  { field: 'recoveryState', value: 'RECOVERY_REQUIRED', code: 'ORDINARY_DRAIN_RECOVERY_REQUIRED' },
]) {
  test(`proven-absent local mutation authority still refuses explicit ${unsafe.field}`, async () => {
    const f = fixture({
      externalKill: false,
      localMutationAuthority: 'PROVEN_ABSENT',
      ordinaryDrainTruth: canonicalDrainTruth({ [unsafe.field]: unsafe.value }),
    });
    assert.equal(f.app.start().ok, true);
    await drive(f, 6);
    const refused = await f.app.drain();

    assert.equal(refused.ledgerCloseMayProceed, false);
    assert.ok(refused.blockerCodes.includes(unsafe.code));
    assert.deepEqual(
      runtimeStopCounts(f),
      [0, 0, 0, 0, 0],
    );
  });
}

for (const failure of [
  {
    name: 'unavailable',
    options: { ordinaryDrainTruthUnavailable: true },
    code: 'ORDINARY_DRAIN_CANONICAL_TRUTH_UNAVAILABLE',
  },
  {
    name: 'throwing',
    options: { ordinaryDrainTruthThrows: true },
    code: 'ORDINARY_DRAIN_CANONICAL_TRUTH_READ_FAILED',
  },
  {
    name: 'stale',
    options: {
      ordinaryDrainTruth: canonicalDrainTruth({
        observedAtUtc: utcSeconds(T0 - 2 * 60_000),
        validUntilUtc: utcSeconds(T0 + 8 * 60_000),
      }),
    },
    code: 'ORDINARY_DRAIN_CANONICAL_TRUTH_STALE',
  },
]) {
  test(`ordinary drain refuses ${failure.name} canonical external truth`, async () => {
    const f = fixture({ externalKill: false, ...failure.options });
    assert.equal(f.app.start().ok, true);
    await drive(f, 6);
    const refused = await f.app.drain();

    assert.equal(refused.ledgerCloseMayProceed, false);
    assert.ok(refused.blockerCodes.includes(failure.code));
    assert.deepEqual(
      runtimeStopCounts(f),
      [0, 0, 0, 0, 0],
    );
  });
}

test('failed reverse drain remains recoverable and seals only after repaired clean closure', async () => {
  const f = fixture({ externalKill: false, volumeStopThrows: true });
  assert.equal(f.app.start().ok, true);
  await drive(f, 6);
  const advisory = await f.app.controls.mutate(validControlRequest(f, {
    command: 'SET_SAFE_MODE', safeMode: 'ADVISORY',
  }, 'pre-drain-advisory'), ACTOR);
  assert.equal(advisory.ok, true);
  const drained = await drainAndDrive(f);
  assert.equal(drained.ok, false);
  assert.equal(drained.clean, false);
  assert.equal(drained.disposition, 'DRAIN_FAILED');
  assert.equal(drained.phase, 'MAINTENANCE');
  assert.equal(drained.ledgerCloseMayProceed, false);
  assert.ok(drained.blockerCodes.includes('DRAIN_RETAINED_OWNERSHIP'));
  assert.equal(drained.finalCheckpoint !== null, true);
  const decoded = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.lastShutdown.clean, false);

  const recoveryControl = await f.app.controls.mutate(validControlRequest(f, {
    command: 'SET_SAFE_MODE', safeMode: 'READ_ONLY',
  }, 'maintenance-read-only'), ACTOR);
  assert.equal(recoveryControl.ok, true);
  assert.equal(recoveryControl.value.applied, true);
  const unsafeControl = await f.app.controls.mutate(validControlRequest(f, {
    command: 'SET_SAFE_MODE', safeMode: 'ADVISORY',
  }, 'maintenance-advisory'), ACTOR);
  assert.equal(unsafeControl.ok, false);
  assert.equal(unsafeControl.failure.code, 'APPLICATION_NOT_READY');

  f.setVolumeStopThrows(false);
  const repaired = await drainAndDrive(f);
  assert.equal(repaired.disposition, 'DRAINED');
  assert.equal(repaired.clean, true);
  assert.equal(repaired.ledgerCloseMayProceed, true);
  assert.deepEqual(repaired.composition.remainingOwnedComponentIds, []);
  const repairedCheckpoint = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(repairedCheckpoint.ok, true);
  assert.equal(repairedCheckpoint.value.lastShutdown.clean, true);
  assert.equal(repairedCheckpoint.value.lastShutdown.correlationId, repaired.correlationId);
});

test('transient final-checkpoint failure retries cleanly without repeating physical stop', async () => {
  const f = fixture({ externalKill: false });
  assert.equal(f.app.start().ok, true);
  await drive(f, 6);
  f.failNextPersistenceWrite();
  const failed = await drainAndDrive(f);
  assert.equal(failed.disposition, 'DRAIN_FAILED');
  assert.equal(failed.persistenceFailureCode, 'PERSISTENCE_WRITE_FAILED');
  assert.equal(failed.composition.cleanShutdown, true);
  assert.equal(failed.ledgerCloseMayProceed, false);
  const stopCounts = runtimeStopCounts(f);

  const repairedPromise = f.app.drain();
  const repaired = await repairedPromise;
  assert.equal(repaired.disposition, 'DRAINED');
  assert.equal(repaired.clean, true);
  assert.equal(repaired.ledgerCloseMayProceed, true);
  assert.deepEqual(runtimeStopCounts(f), stopCounts, 'clean composition must not repeat physical stop');
  const decoded = decodeSystemCheckpoint(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.lastShutdown.clean, true);

  const replay = f.app.drain();
  assert.equal(replay, repairedPromise);
  assert.deepEqual(await replay, repaired);
});

for (const referenceType of ORDINARY_DRAIN_BLOCKING_REFERENCE_TYPES) {
  test(`ordinary drain refuses unresolved ${referenceType} without stopping recovery dependencies or sealing persistence`, async () => {
    const reference = blockingReference(referenceType);
    const f = fixture({ externalKill: false, blockingIdentityReferences: [reference] });
    assert.equal(f.app.start().ok, true);
    await drive(f, 6);
    const beforeCheckpoint = f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY);
    const refused = await f.app.drain();

    assert.equal(refused.ok, false);
    assert.equal(refused.clean, false);
    assert.equal(refused.disposition, 'REFUSED_RECOVERY_SUPERVISION_REQUIRED');
    assert.equal(refused.phase, 'RUNNING');
    assert.equal(refused.finalCheckpoint, null);
    assert.equal(refused.persistenceFailureCode, null);
    assert.equal(refused.ledgerCloseMayProceed, false);
    assert.deepEqual(refused.blockingIdentityReferences, [reference]);
    assert.deepEqual(refused.blockerCodes, [
      'ORDINARY_DRAIN_REFUSED_RECOVERY_SUPERVISION_REQUIRED',
      `UNRESOLVED_PRODUCT_IDENTITY_REFERENCE_${referenceType}`,
    ]);
    assert.equal(f.app.managedRuntime().supervisor.phase, 'RUNNING');
    assert.deepEqual(
      runtimeStopCounts(f),
      [0, 0, 0, 0, 0],
    );
    assert.equal(f.ledger.probeWritable(), true);
    assert.equal(f.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY), beforeCheckpoint);
    const refusedCheckpoint = decodeSystemCheckpoint(beforeCheckpoint);
    assert.equal(refusedCheckpoint.ok, true);
    assert.equal(refusedCheckpoint.value.lastShutdown, null);

    f.setBlockingIdentityReferences([]);
    const retried = await drainAndDrive(f);
    assert.equal(retried.disposition, 'DRAINED');
    assert.equal(retried.phase, 'DRAINED');
    assert.equal(retried.clean, true);
    assert.equal(retried.ledgerCloseMayProceed, true);
  });
}

for (const failureMode of ['identityReadUnavailable', 'identityReadThrows']) {
  test(`ordinary drain fails closed when Product shutdown truth is ${failureMode}`, async () => {
    const f = fixture({ externalKill: false, [failureMode]: true });
    assert.equal(f.app.start().ok, true);
    await drive(f, 6);
    const refused = await f.app.drain();

    assert.equal(refused.disposition, 'REFUSED_RECOVERY_SUPERVISION_REQUIRED');
    assert.equal(refused.phase, 'RUNNING');
    assert.equal(refused.persistenceFailureCode, 'PERSISTENCE_READ_FAILED');
    assert.deepEqual(refused.blockerCodes, [
      'ORDINARY_DRAIN_IDENTITY_REFERENCE_READ_UNAVAILABLE',
      'PERSISTENCE_READ_FAILED',
    ]);
    assert.equal(refused.ledgerCloseMayProceed, false);
    assert.deepEqual(
      runtimeStopCounts(f),
      [0, 0, 0, 0, 0],
    );
    assert.equal(f.ledger.probeWritable(), true);
  });
}

test('corrupt persistence leaves a router-mountable fail-closed read/control shell', async () => {
  const f = fixture();
  f.ledger.seedConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, '{"corrupt":true}');
  const router = createSystemIntegrationRouter({
    read: f.app.read,
    controls: f.app.controls,
    validateOnly: f.app,
    clock: f.clock,
    opsReadback: {
      read: () => Object.freeze({
        source: 'CANONICAL_SUPERVISOR_READBACK',
        observedAtUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
        validUntilUtc: new Date(T0 + 10 * 60_000).toISOString().replace('.000Z', 'Z'),
        deploymentFrozen: 'UNKNOWN',
        exposureState: 'UNKNOWN',
        ambiguityState: 'UNKNOWN',
        recoveryState: 'UNKNOWN',
        currentSchemaVersion: null,
        rollbackFloor: null,
      }),
    },
  });
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

for (const options of [
  { schemaReadUnavailable: true, expectedState: 'UNAVAILABLE' },
  { schemaReadThrows: true, expectedState: 'UNAVAILABLE' },
  {
    schemaReadback: Object.freeze({
      state: 'AVAILABLE', currentSchemaVersion: 1, rollbackFloor: 2, reasonCode: null,
    }),
    expectedState: 'MALFORMED',
  },
  {
    schemaReadback: Object.freeze({
      state: 'MISMATCH', currentSchemaVersion: null, rollbackFloor: null,
      reasonCode: 'LEDGER_SCHEMA_VERSION_MISMATCH',
    }),
    expectedState: 'MISMATCH',
  },
]) {
  test(`supervisor withholds Ledger schema numbers for ${options.expectedState} capability truth`, () => {
    const f = fixture(options);
    const supervisor = f.app.supervisor();
    const summary = supervisor.summaries.ledger;
    const component = supervisor.components.find((entry) => entry.componentId === 'ledger-persistence');
    assert.equal(summary.truthLabel, 'UNAVAILABLE');
    assert.equal(summary.schemaCompatibilityState, options.expectedState);
    assert.equal(summary.currentSchemaVersion, null);
    assert.equal(summary.rollbackFloor, null);
    assert.notEqual(component.readiness, 'READY');
    assert.equal(component.truthLabel, 'UNAVAILABLE');
    assert.ok(supervisor.rootBlockerComponentIds.includes('ledger-persistence'));
  });
}

test('canonical application supervisor cannot publish READY after Ledger becomes non-writable', async () => {
  const f = fixture({ externalKill: false });
  assert.equal(f.app.start().ok, true);
  await drive(f, 8);
  f.ledger.setWritable(false);

  const supervisor = f.app.supervisor();
  const ledger = supervisor.components.find((entry) => entry.componentId === 'ledger-persistence');
  assert.equal(supervisor.summaries.ledger.writable, false);
  assert.equal(ledger.readiness, 'BLOCKED');
  assert.ok(ledger.blockerCodes.includes('LEDGER_NOT_WRITABLE'));
  assert.equal(supervisor.overallPosture, 'BLOCKED');
  assert.ok(supervisor.rootBlockerComponentIds.includes('ledger-persistence'));
});
