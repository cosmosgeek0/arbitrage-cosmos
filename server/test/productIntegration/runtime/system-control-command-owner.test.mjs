import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import { createSourceIsolationOwner } from '../../../dist/intelligenceRuntime/lifecycle/index.js';
import {
  createProductIntegrationRuntime,
} from '../../../dist/productIntegration/runtime/index.js';
import { buildProductRuntimeControlRegistry } from '../../../dist/productIntegration/runtime/controls.js';
import {
  createProductRuntimeSystemControlCommandOwner,
} from '../../../dist/productIntegration/runtime/systemControlCommandOwner.js';
import { SystemControlService } from '../../../dist/systemIntegration/controls/index.js';
import { SystemLedgerPersistenceAdapter } from '../../../dist/systemIntegration/persistence/index.js';
import { createSourceIsolationPersistence } from '../../../dist/services/sourceIsolationPersistence.js';
import { makeRead, makeSupervisor } from './testSupport.mjs';

const T0 = 1_900_000_000_000;
const ACTOR = Object.freeze({ id: 'local-operator', email: null, source: 'loopback' });
const FOREIGN_ACTOR = Object.freeze({ id: 'foreign-operator', email: null, source: 'loopback' });

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-product-system-control-owner-'));
}

function controlIntent(controlId, expectedRevision, nowMs, operator = ACTOR) {
  if (controlId === 'strategy.basis.intake' || controlId === 'strategy.volume.intake') {
    const basis = controlId === 'strategy.basis.intake';
    return Object.freeze({
      controlId,
      backendCommandId: basis ? 'SET_BASIS_INTAKE' : 'SET_VOLUME_INTAKE',
      targetType: 'COMPONENT',
      targetId: basis ? 'basis-engine' : 'volume-engine',
      payload: Object.freeze({ paused: true }),
      expectedRevision: String(expectedRevision),
      nowMs,
      operator,
    });
  }
  if (controlId === 'global.safe-mode.read-only') return Object.freeze({
    controlId,
    backendCommandId: 'SET_SAFE_MODE',
    targetType: 'SYSTEM',
    targetId: 'machine',
    payload: Object.freeze({ safeMode: 'READ_ONLY' }),
    expectedRevision: String(expectedRevision),
    nowMs,
    operator,
  });
  if (controlId === 'global.kill-switch.engage') return Object.freeze({
    controlId,
    backendCommandId: 'SET_KILL_SWITCH',
    targetType: 'SYSTEM',
    targetId: 'machine',
    payload: Object.freeze({ engaged: true }),
    expectedRevision: String(expectedRevision),
    nowMs,
    operator,
  });
  if (controlId === 'global.intake.pause') return Object.freeze({
    controlId,
    backendCommandId: 'SET_INTAKE_PAUSED',
    targetType: 'SYSTEM',
    targetId: 'machine',
    payload: Object.freeze({ paused: true }),
    expectedRevision: String(expectedRevision),
    nowMs,
    operator,
  });
  return Object.freeze({
    controlId: 'component.engine-supervisor.restart',
    backendCommandId: 'RESTART_COMPONENT',
    targetType: 'COMPONENT',
    targetId: 'engine-supervisor',
    payload: Object.freeze({ componentId: 'engine-supervisor' }),
    expectedRevision: String(expectedRevision),
    nowMs,
    operator,
  });
}

function commandRequest(intent, preview, idempotencyKey) {
  return Object.freeze({
    schemaVersion: 'product-command.v1',
    idempotencyKey,
    controlId: intent.controlId,
    backendCommandId: intent.backendCommandId,
    targetType: intent.targetType,
    targetId: intent.targetId,
    payload: intent.payload,
    currentRevision: intent.expectedRevision,
    expectedRevision: intent.expectedRevision,
    previewId: preview.previewId,
    previewDigest: preview.digest,
    expiresAtMs: preview.expiresAtMs,
    reason: 'Confirmed bounded fail-safe Product control',
  });
}

function sourceControlIntent(sourceId, action, expectedRevision, nowMs, operator = ACTOR) {
  return Object.freeze({
    controlId: `source.${sourceId}.lifecycle`,
    backendCommandId: 'SET_PUBLIC_SOURCE_LIFECYCLE',
    targetType: 'COMPONENT',
    targetId: sourceId,
    payload: Object.freeze({ sourceId, action }),
    expectedRevision: String(expectedRevision),
    nowMs,
    operator,
  });
}

function focusControlIntent(symbol, pinned, expectedRevision, nowMs, operator = ACTOR) {
  const action = pinned ? 'pin' : 'unpin';
  return Object.freeze({
    controlId: `attention.focus.${symbol.toLowerCase()}.${action}`,
    backendCommandId: 'PIN_FOCUS',
    targetType: 'SYMBOL',
    targetId: symbol,
    payload: Object.freeze({ symbol, pinned }),
    expectedRevision: String(expectedRevision),
    nowMs,
    operator,
  });
}

function createWorld(dataDir = tempDataDir(), publicationEffect = 'APPLIED', focusOptions = null) {
  const ledger = new Ledger(dataDir);
  const persistence = new SystemLedgerPersistenceAdapter(ledger);
  const loaded = persistence.load(T0, 'product.control.owner.bootstrap');
  assert.equal(loaded.ok, true);
  const inspections = [];
  const publications = [];
  const publicationEffects = new Map();
  let currentPublicationEffect = publicationEffect;
  const strategyEffective = { basis: false, volume: false };
  const focusPins = new Set();
  const focusEligibleSymbols = new Set(focusOptions?.eligibleSymbols ?? []);
  const focusCapacity = focusOptions?.capacity ?? 25;
  const composition = {
    async inspectMutation(mutation) {
      inspections.push(mutation);
      const restartAccepted = mutation.command !== 'RESTART_COMPONENT'
        || mutation.componentId === 'market-universe';
      return Object.freeze({
        ok: restartAccepted,
        code: restartAccepted ? 'CONTROL_ACCEPTED' : 'INDIVIDUAL_RUNTIME_RESTART_NOT_SUPPORTED',
        message: restartAccepted ? '' : 'Only the dependency root may restart.',
        applied: restartAccepted,
        riskIncreasing: false,
      });
    },
    async publishCommitted(request, actor, receipt) {
      publications.push(Object.freeze({ request, actor, receipt }));
      if (request.mutation.command === 'SET_BASIS_INTAKE') strategyEffective.basis = request.mutation.paused;
      if (request.mutation.command === 'SET_VOLUME_INTAKE') strategyEffective.volume = request.mutation.paused;
      if (request.mutation.command === 'PIN_FOCUS') {
        if (request.mutation.pinned) focusPins.add(request.mutation.symbol);
        else focusPins.delete(request.mutation.symbol);
      }
      if (currentPublicationEffect !== null) {
        publicationEffects.set(
          `${request.idempotencyKey}:${receipt.after.revision}:${receipt.after.generation}`,
          currentPublicationEffect,
        );
      }
    },
    inspectCommittedPublication(request, receipt) {
      return publicationEffects.get(
        `${request.idempotencyKey}:${receipt.after.revision}:${receipt.after.generation}`,
      ) ?? currentPublicationEffect ?? 'UNKNOWN';
    },
  };
  const controls = new SystemControlService({
    initialState: loaded.state.control,
    persistence,
    composition,
  });
  let sourcePhysical = {
    'public-spot-source': { lifecycle: 'LIVE', generation: 7 },
    'public-usdm-source': { lifecycle: 'LIVE', generation: 11 },
  };
  let sourceEffectFailure = false;
  const sourcePersistence = createSourceIsolationPersistence(ledger);
  const sourcePhysicalPort = {
    read(sourceId) { return Object.freeze({ ...sourcePhysical[sourceId] }); },
    isolate(sourceId) {
      if (sourceEffectFailure) throw new Error('deterministic source isolation failure');
      sourcePhysical = {
        ...sourcePhysical,
        [sourceId]: { lifecycle: 'ISOLATED', generation: sourcePhysical[sourceId].generation + 1 },
      };
    },
    restart(sourceId) {
      if (sourceEffectFailure) throw new Error('deterministic source restart failure');
      sourcePhysical = {
        ...sourcePhysical,
        [sourceId]: { lifecycle: 'WARMING', generation: sourcePhysical[sourceId].generation + 1 },
      };
    },
  };
  const sourceIsolation = createSourceIsolationOwner({
    clock: { nowMs: () => T0 },
    persistence: sourcePersistence,
    physical: sourcePhysicalPort,
  });
  const strategyIntakeFor = (controlOwner) => Object.freeze({
    readState(strategy) {
      const state = persistence.currentState();
      assert.equal(state.ok, true);
      const pending = persistence.readPendingControlRuntimePublications();
      assert.equal(pending.ok, true);
      const desiredPaused = strategy === 'basis'
        ? state.value.strategyIntake.basisPaused
        : state.value.strategyIntake.volumePaused;
      return Object.freeze({
        strategy,
        desiredPaused,
        effectivePaused: strategyEffective[strategy],
        controlRevision: controlOwner.snapshot().revision,
        state: pending.value.length === 0 && desiredPaused === strategyEffective[strategy]
          ? 'APPLIED'
          : 'EFFECT_UNAVAILABLE',
      });
    },
  });
  const attentionFocusFor = (controlOwner) => focusOptions === null ? undefined : Object.freeze({
    readPinnedSymbols: () => focusOptions?.pinnedSymbolsOverride
      ?? Object.freeze([...focusPins].sort()),
    readState(symbol) {
      const persisted = persistence.currentState();
      const pending = persistence.readPendingControlRuntimePublications();
      assert.equal(persisted.ok, true);
      assert.equal(pending.ok, true);
      const pinned = focusPins.has(symbol);
      const desiredPinned = persisted.value.focusPins.symbols.includes(symbol);
      const eligible = focusEligibleSymbols.has(symbol);
      const readback = {
        symbol,
        desiredPinned,
        ownerPinned: pinned,
        eligible,
        canPin: eligible && (pinned || focusPins.size < focusCapacity),
        effectivePinned: pinned,
        effectiveTier: pinned ? 'FOCUS' : 'UNIVERSE',
        attentionPlanId: 'attention-plan:product-focus-test',
        attentionPlanAtMs: T0,
        pinCount: focusPins.size,
        pinCapacity: focusCapacity,
        controlRevision: controlOwner.snapshot().revision,
        state: pending.value.length === 0 && desiredPinned === pinned ? 'APPLIED' : 'UNAVAILABLE',
      };
      return Object.freeze(focusOptions?.readbackTransform
        ? focusOptions.readbackTransform(structuredClone(readback))
        : readback);
    },
  });
  const strategyIntake = strategyIntakeFor(controls);
  const attentionFocus = attentionFocusFor(controls);
  const owner = createProductRuntimeSystemControlCommandOwner({
    controls,
    sourceIsolation,
    strategyIntake,
    ...(attentionFocus === undefined ? {} : { attentionFocus }),
  });
  const reconstructControlOwner = () => {
    const state = persistence.currentState();
    assert.equal(state.ok, true);
    const recoveredControls = new SystemControlService({
      initialState: state.value.control,
      persistence,
      composition,
    });
    const recoveredStrategyIntake = strategyIntakeFor(recoveredControls);
    const recoveredAttentionFocus = attentionFocusFor(recoveredControls);
    const recoveredOwner = createProductRuntimeSystemControlCommandOwner({
      controls: recoveredControls,
      sourceIsolation,
      strategyIntake: recoveredStrategyIntake,
      ...(recoveredAttentionFocus === undefined ? {} : { attentionFocus: recoveredAttentionFocus }),
    });
    return Object.freeze({
      controls: recoveredControls,
      owner: recoveredOwner,
      strategyIntake: recoveredStrategyIntake,
      attentionFocus: recoveredAttentionFocus,
    });
  };
  return {
    dataDir, ledger, persistence, composition, controls, owner, sourceIsolation,
    sourcePersistence, sourcePhysicalPort,
    setSourceEffectFailure: (value) => { sourceEffectFailure = value; },
    sourcePhysical: () => structuredClone(sourcePhysical), inspections, publications,
    strategyEffective, strategyIntake, focusPins, attentionFocus,
    setPublicationEffect: (value) => { currentPublicationEffect = value; },
    reconstructControlOwner,
  };
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function resultIdentity(idempotencyKey, controlId) {
  const digest = createHash('sha256').update(canonical({
    schema: 'product-command.v1', idempotencyKey, controlId,
  }), 'utf8').digest('hex');
  return Object.freeze({ commandId: `sysctrl_${digest}`, idempotencyKey, controlId });
}

function runtime(world, now) {
  const base = makeRead();
  return createProductIntegrationRuntime({
    read: Object.freeze({
      ...base,
      supervisor: () => makeSupervisor({ control: world.controls.snapshot() }),
    }),
    clock: { nowMs: () => now.value },
    commandOwner: world.owner,
  });
}

test('Product owner delegates one durable fail-safe mutation and exact replay survives owner reconstruction', async () => {
  const world = createWorld();
  try {
    const now = { value: T0 + 10 };
    let service = runtime(world, now);
    const preview = await service.previewCommand({
      controlId: 'component.engine-supervisor.restart',
      expectedRevision: '0',
      operator: ACTOR,
    });
    const intent = controlIntent('component.engine-supervisor.restart', 0, now.value);
    const request = commandRequest(intent, preview, 'product.restart.root.0002');
    now.value += 1;
    const first = await service.submitCommand(request, ACTOR);
    assert.equal(first.status, 'ACCEPTED_ASYNC');
    assert.match(first.receiptId, /^ledger-event:[1-9][0-9]*$/);
    assert.equal(world.controls.snapshot().revision, 1);
    assert.equal(world.controls.snapshot().generation, 1);
    assert.equal(world.publications.length, 1);
    const eventCount = world.ledger.countEvents();

    const firstReadback = await service.readCommandResult(Object.freeze({
      commandId: first.commandId,
      idempotencyKey: request.idempotencyKey,
      controlId: request.controlId,
    }));
    assert.equal(firstReadback.state, 'TERMINAL');
    assert.equal(firstReadback.result.status, 'APPLIED');
    assert.equal(firstReadback.result.receiptId, first.receiptId);

    now.value += 1;
    const replay = await service.submitCommand(request, ACTOR);
    assert.equal(replay.status, 'ALREADY_APPLIED');
    assert.equal(replay.receiptId, first.receiptId);
    assert.equal(replay.commandId, first.commandId);
    assert.equal(world.ledger.countEvents(), eventCount);

    const reloadedPersistence = new SystemLedgerPersistenceAdapter(world.ledger);
    const reloaded = reloadedPersistence.load(now.value, 'product.control.owner.reload');
    assert.equal(reloaded.ok, true);
    const reloadedControls = new SystemControlService({
      initialState: reloaded.state.control,
      persistence: reloadedPersistence,
      composition: world.composition,
    });
    world.controls = reloadedControls;
    world.owner = createProductRuntimeSystemControlCommandOwner({ controls: reloadedControls });
    service = runtime(world, now);
    now.value += 1;
    const restartReplay = await service.submitCommand(request, ACTOR);
    assert.equal(restartReplay.status, 'ALREADY_APPLIED');
    assert.equal(restartReplay.receiptId, first.receiptId);
    assert.equal(world.ledger.countEvents(), eventCount);
    const restartedReadback = await service.readCommandResult(Object.freeze({
      commandId: first.commandId,
      idempotencyKey: request.idempotencyKey,
      controlId: request.controlId,
    }));
    assert.equal(restartedReadback.state, 'TERMINAL');
    assert.deepEqual(restartedReadback.result, firstReadback.result);
  } finally {
    world.ledger.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }
});

test('MIS-072 exposes independent durable strategy intake controls and fails closed until owner effect readback', async () => {
  const world = createWorld();
  try {
    const now = { value: T0 + 200 };
    const service = runtime(world, now);
    const stalePeerPreview = await service.previewCommand({
      controlId: 'strategy.volume.intake', expectedRevision: '0', operator: ACTOR,
    });
    const intent = controlIntent('strategy.basis.intake', 0, now.value);
    const preview = await service.previewCommand({
      controlId: intent.controlId, expectedRevision: '0', operator: ACTOR,
    });
    const request = commandRequest(intent, preview, 'product.strategy.basis.pause.0001');
    const applied = await service.submitCommand(request, ACTOR);
    assert.equal(applied.status, 'APPLIED');
    assert.match(applied.receiptId, /^ledger-event:[1-9][0-9]*$/);
    assert.equal(world.strategyEffective.basis, true);
    assert.equal(world.strategyEffective.volume, false, 'Basis pause cannot mutate Volume');
    const durable = world.persistence.currentState();
    assert.equal(durable.ok, true);
    assert.deepEqual(durable.value.strategyIntake, { basisPaused: true, volumePaused: false });
    assert.equal(world.publications[0].request.mutation.command, 'SET_BASIS_INTAKE');

    const terminal = await service.readCommandResult(resultIdentity(request.idempotencyKey, request.controlId));
    assert.equal(terminal.state, 'TERMINAL');
    assert.equal(terminal.result.status, 'APPLIED');

    const stalePeer = await service.submitCommand(commandRequest(
      controlIntent('strategy.volume.intake', 0, T0 + 200),
      stalePeerPreview,
      'product.strategy.volume.pause.stale.0001',
    ), ACTOR);
    assert.equal(stalePeer.status, 'REJECTED_STALE_REVISION');

    const reloadedPersistence = new SystemLedgerPersistenceAdapter(world.ledger);
    const reloaded = reloadedPersistence.load(T0 + 201, 'product.strategy.intake.reload');
    assert.equal(reloaded.ok, true);
    assert.deepEqual(reloaded.state.strategyIntake, { basisPaused: true, volumePaused: false });
  } finally {
    world.ledger.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }

  for (const strategy of ['basis', 'volume']) {
    const pendingWorld = createWorld(tempDataDir(), null);
    try {
      const now = { value: T0 + 300 };
      const service = runtime(pendingWorld, now);
      const intent = controlIntent(`strategy.${strategy}.intake`, 0, now.value);
      const preview = await service.previewCommand({
        controlId: intent.controlId, expectedRevision: '0', operator: ACTOR,
      });
      const request = commandRequest(intent, preview, `product.strategy.${strategy}.pending.0001`);
      const submitted = await service.submitCommand(request, ACTOR);
      assert.equal(submitted.status, 'FAILED_ATTENTION_REQUIRED');
      assert.equal(
        pendingWorld.strategyEffective[strategy],
        true,
        `${strategy} publication was attempted before readback remained unknown`,
      );
      const pending = await service.readCommandResult(resultIdentity(request.idempotencyKey, request.controlId));
      assert.equal(pending.state, 'PENDING');
      assert.equal(pending.result.status, 'ACCEPTED_ASYNC');
      const pendingState = pendingWorld.persistence.readPendingControlRuntimePublications();
      assert.equal(pendingState.ok, true);
      assert.equal(pendingState.value.length, 1);
      const durableBeforeReplay = pendingWorld.persistence.currentState();
      assert.equal(durableBeforeReplay.ok, true);
      const mutationTraceCount = durableBeforeReplay.value.traceIndex
        .filter((entry) => entry.eventId.startsWith('control.mutation')).length;
      const idempotencyReceiptCount = durableBeforeReplay.value.idempotencyReceipts.length;

      now.value = preview.expiresAtMs + 60_000;
      await assert.rejects(
        service.submitCommand(Object.freeze({
          ...request,
          idempotencyKey: `product.strategy.${strategy}.pending.different.0001`,
        }), ACTOR),
        (error) => error?.code === 'CONTROL_NOT_CONFIGURED',
      );

      const recovered = pendingWorld.reconstructControlOwner();
      const recoveredService = runtime(Object.freeze({ ...pendingWorld, ...recovered }), now);
      pendingWorld.setPublicationEffect('APPLIED');
      const replay = await recoveredService.submitCommand(request, ACTOR);
      assert.equal(replay.status, 'ALREADY_APPLIED');
      assert.equal(replay.receiptId, pending.result.receiptId);
      const durableAfterReplay = pendingWorld.persistence.currentState();
      assert.equal(durableAfterReplay.ok, true);
      assert.equal(
        durableAfterReplay.value.traceIndex.filter((entry) => entry.eventId.startsWith('control.mutation')).length,
        mutationTraceCount,
        'exact replay must not append another control-mutation event',
      );
      assert.equal(durableAfterReplay.value.idempotencyReceipts.length, idempotencyReceiptCount);
      const cleared = pendingWorld.persistence.readPendingControlRuntimePublications();
      assert.equal(cleared.ok, true);
      assert.equal(cleared.value.length, 0);
      const terminal = await recoveredService.readCommandResult(resultIdentity(request.idempotencyKey, request.controlId));
      assert.equal(terminal.state, 'TERMINAL');
      assert.equal(terminal.result.status, 'APPLIED');
    } finally {
      pendingWorld.ledger.close();
      rmSync(pendingWorld.dataDir, { recursive: true, force: true });
    }
  }
});

test('I00-037 exposes revision-bound 30-second focus pin controls with durable result and bounded readback', async () => {
  const world = createWorld(
    tempDataDir(),
    'APPLIED',
    { eligibleSymbols: ['BTCUSDT', 'ETHUSDT'], capacity: 1 },
  );
  try {
    const now = { value: T0 + 4_000 };
    const service = runtime(world, now);
    const pinControlId = 'attention.focus.btcusdt.pin';
    const unpinControlId = 'attention.focus.btcusdt.unpin';

    const expiredPreview = await service.previewCommand({
      controlId: pinControlId,
      expectedRevision: '0',
      operator: ACTOR,
    });
    assert.equal(expiredPreview.expiresAtMs, now.value + 30_000);
    const expiredRequest = commandRequest(
      focusControlIntent('BTCUSDT', true, 0, now.value),
      expiredPreview,
      'product.focus.btcusdt.expired.0001',
    );
    now.value = expiredPreview.expiresAtMs;
    await assert.rejects(
      service.submitCommand(expiredRequest, ACTOR),
      (error) => error?.code === 'EXPIRED',
    );
    assert.equal(world.controls.snapshot().revision, 0);
    assert.deepEqual([...world.focusPins], []);

    now.value += 1;
    const staleUnpinPreview = await service.previewCommand({
      controlId: unpinControlId,
      expectedRevision: '0',
      operator: ACTOR,
    });
    const staleUnpinRequest = commandRequest(
      focusControlIntent('BTCUSDT', false, 0, now.value),
      staleUnpinPreview,
      'product.focus.btcusdt.unpin.stale.0001',
    );
    const pinPreview = await service.previewCommand({
      controlId: pinControlId,
      expectedRevision: '0',
      operator: ACTOR,
    });
    assert.equal(pinPreview.expiresAtMs, now.value + 30_000);
    const pinRequest = commandRequest(
      focusControlIntent('BTCUSDT', true, 0, now.value),
      pinPreview,
      'product.focus.btcusdt.pin.0001',
    );
    const pinned = await service.submitCommand(pinRequest, ACTOR);
    assert.equal(pinned.status, 'APPLIED');
    assert.match(pinned.receiptId, /^ledger-event:[1-9][0-9]*$/);
    assert.deepEqual([...world.focusPins], ['BTCUSDT']);
    assert.equal(world.controls.snapshot().revision, 1);
    const persistedPin = world.persistence.currentState();
    assert.equal(persistedPin.ok, true);
    assert.deepEqual(persistedPin.value.focusPins, { symbols: ['BTCUSDT'] });

    const pinReadback = await service.readCommandResult(resultIdentity(
      pinRequest.idempotencyKey,
      pinRequest.controlId,
    ));
    assert.equal(pinReadback.state, 'TERMINAL');
    assert.equal(pinReadback.result.status, 'APPLIED');
    assert.equal(pinReadback.result.receiptId, pinned.receiptId);

    const registry = buildProductRuntimeControlRegistry(
      makeSupervisor({ control: world.controls.snapshot() }),
      world.owner,
    );
    const exposedUnpin = registry.find((control) => control.controlId === unpinControlId);
    assert.ok(exposedUnpin);
    assert.equal(exposedUnpin.wiringState, 'WIRED_LIVE');
    assert.equal(exposedUnpin.currentStateRevision, '1');
    assert.equal(exposedUnpin.currentDesiredValue, 'PINNED');
    assert.equal(exposedUnpin.currentEffectiveValue, 'FOCUS');

    await assert.rejects(
      service.previewCommand({
        controlId: 'attention.focus.ethusdt.pin',
        expectedRevision: '1',
        operator: ACTOR,
      }),
      (error) => error?.code === 'CONTROL_NOT_CONFIGURED'
        && error?.message === 'FOCUS_CAPACITY_UNAVAILABLE',
    );

    now.value += 1;
    const staleUnpin = await service.submitCommand(staleUnpinRequest, ACTOR);
    assert.equal(staleUnpin.status, 'REJECTED_STALE_REVISION');
    assert.deepEqual([...world.focusPins], ['BTCUSDT']);

    const unpinPreview = await service.previewCommand({
      controlId: unpinControlId,
      expectedRevision: '1',
      operator: ACTOR,
    });
    const unpinRequest = commandRequest(
      focusControlIntent('BTCUSDT', false, 1, now.value),
      unpinPreview,
      'product.focus.btcusdt.unpin.0001',
    );
    const unpinned = await service.submitCommand(unpinRequest, ACTOR);
    assert.equal(unpinned.status, 'APPLIED');
    assert.deepEqual([...world.focusPins], []);
    assert.equal(world.controls.snapshot().revision, 2);
    const persistedUnpin = world.persistence.currentState();
    assert.equal(persistedUnpin.ok, true);
    assert.deepEqual(persistedUnpin.value.focusPins, { symbols: [] });

    const unpinReadback = await service.readCommandResult(resultIdentity(
      unpinRequest.idempotencyKey,
      unpinRequest.controlId,
    ));
    assert.equal(unpinReadback.state, 'TERMINAL');
    assert.equal(unpinReadback.result.status, 'APPLIED');
    assert.equal(unpinReadback.result.receiptId, unpinned.receiptId);
  } finally {
    world.ledger.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }
});

test('I00-037 recovers only the exact durable pending focus publication after expiry and reconstruction', async () => {
  const world = createWorld(
    tempDataDir(),
    null,
    { eligibleSymbols: ['BTCUSDT'], capacity: 1 },
  );
  try {
    const now = { value: T0 + 8_000 };
    const service = runtime(world, now);
    const intent = focusControlIntent('BTCUSDT', true, 0, now.value);
    const preview = await service.previewCommand({
      controlId: intent.controlId,
      expectedRevision: '0',
      operator: ACTOR,
    });
    const request = commandRequest(intent, preview, 'product.focus.btcusdt.pending.0001');
    const first = await service.submitCommand(request, ACTOR);
    assert.equal(first.status, 'FAILED_ATTENTION_REQUIRED');
    assert.deepEqual(world.persistence.currentState().value.focusPins, { symbols: ['BTCUSDT'] });
    const pending = world.persistence.readPendingControlRuntimePublications();
    assert.equal(pending.ok, true);
    assert.equal(pending.value.length, 1);
    const durableBeforeReplay = world.persistence.currentState();
    assert.equal(durableBeforeReplay.ok, true);
    const mutationTraceCount = durableBeforeReplay.value.traceIndex
      .filter((entry) => entry.eventId.startsWith('control.mutation')).length;
    const idempotencyReceiptCount = durableBeforeReplay.value.idempotencyReceipts.length;
    now.value = preview.expiresAtMs + 60_000;

    await assert.rejects(
      service.submitCommand(Object.freeze({
        ...request,
        payload: Object.freeze({ symbol: 'BTCUSDT', pinned: false }),
      }), ACTOR),
      (error) => error?.code === 'CONTROL_NOT_CONFIGURED',
    );
    await assert.rejects(
      service.submitCommand(Object.freeze({
        ...request,
        previewDigest: `${request.previewDigest.slice(0, -1)}${request.previewDigest.endsWith('0') ? '1' : '0'}`,
      }), ACTOR),
      (error) => error?.code === 'CONTROL_NOT_CONFIGURED',
    );

    const recovered = world.reconstructControlOwner();
    const recoveredService = runtime(Object.freeze({ ...world, ...recovered }), now);
    world.setPublicationEffect('APPLIED');
    const replay = await recoveredService.submitCommand(request, ACTOR);
    assert.equal(replay.status, 'ALREADY_APPLIED');
    assert.match(replay.receiptId, /^ledger-event:[1-9][0-9]*$/);
    const durableAfterReplay = world.persistence.currentState();
    assert.equal(durableAfterReplay.ok, true);
    assert.equal(
      durableAfterReplay.value.traceIndex.filter((entry) => entry.eventId.startsWith('control.mutation')).length,
      mutationTraceCount,
    );
    assert.equal(durableAfterReplay.value.idempotencyReceipts.length, idempotencyReceiptCount);
    const cleared = world.persistence.readPendingControlRuntimePublications();
    assert.equal(cleared.ok, true);
    assert.equal(cleared.value.length, 0);
    const terminal = await recoveredService.readCommandResult(resultIdentity(request.idempotencyKey, request.controlId));
    assert.equal(terminal.state, 'TERMINAL');
    assert.equal(terminal.result.status, 'APPLIED');
  } finally {
    world.ledger.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }
});

test('I00-037 rejects malformed focus owner readback instead of normalizing a false green', () => {
  const malformed = [
    (state) => ({ ...state, extra: true }),
    (state) => ({ ...state, effectivePinned: true, ownerPinned: true, desiredPinned: true, effectiveTier: 'UNIVERSE' }),
    (state) => ({ ...state, attentionPlanAtMs: null }),
    (state) => ({ ...state, pinCount: 2, pinCapacity: 1 }),
    (state) => ({ ...state, desiredPinned: true, ownerPinned: false, state: 'APPLIED' }),
  ];
  for (const readbackTransform of malformed) {
    const world = createWorld(tempDataDir(), 'APPLIED', {
      eligibleSymbols: ['BTCUSDT'],
      readbackTransform,
    });
    try {
      assert.equal(world.owner.readFocusControlState('BTCUSDT'), null);
    } finally {
      world.ledger.close();
      rmSync(world.dataDir, { recursive: true, force: true });
    }
  }

  const duplicates = createWorld(tempDataDir(), 'APPLIED', {
    eligibleSymbols: ['BTCUSDT'],
    pinnedSymbolsOverride: Object.freeze(['BTCUSDT', 'BTCUSDT']),
  });
  try {
    assert.deepEqual(duplicates.owner.readFocusPinnedSymbols(), []);
  } finally {
    duplicates.ledger.close();
    rmSync(duplicates.dataDir, { recursive: true, force: true });
  }
});

test('durable result lookup survives restart and rejects forged or cross-control identities before fabricating success', async () => {
  const world = createWorld(tempDataDir(), null);
  try {
    const now = { value: T0 + 500 };
    const service = runtime(world, now);
    const intent = controlIntent('component.engine-supervisor.restart', 0, now.value);
    const preview = await service.previewCommand({
      controlId: intent.controlId, expectedRevision: '0', operator: ACTOR,
    });
    const request = commandRequest(intent, preview, 'product.restart.pending.0001');
    now.value += 1;
    const submitted = await service.submitCommand(request, ACTOR);
    assert.equal(submitted.status, 'FAILED_ATTENTION_REQUIRED');

    const identity = resultIdentity(request.idempotencyKey, request.controlId);
    const pending = await service.readCommandResult(identity);
    assert.equal(pending.state, 'PENDING');
    assert.equal(pending.result.status, 'ACCEPTED_ASYNC');
    assert.match(pending.result.receiptId, /^ledger-event:[1-9][0-9]*$/);

    let durableReads = 0;
    const instrumentedOwner = createProductRuntimeSystemControlCommandOwner({
      controls: {
        snapshot: () => world.controls.snapshot(),
        mutate: (value, actor) => world.controls.mutate(value, actor),
        readResult: (key) => {
          durableReads += 1;
          return world.controls.readResult(key);
        },
      },
    });
    const forgedId = `${identity.commandId.slice(0, -1)}${identity.commandId.endsWith('0') ? '1' : '0'}`;
    const forged = await instrumentedOwner.readResult({ ...identity, commandId: forgedId });
    assert.equal(forged.state, 'FAIL_CLOSED');
    assert.equal(forged.failureCode, 'COMMAND_RESULT_IDENTITY_MISMATCH');
    assert.equal(durableReads, 0, 'forged command identity must fail before durable lookup');

    const crossControl = await instrumentedOwner.readResult(resultIdentity(
      request.idempotencyKey,
      'global.kill-switch.engage',
    ));
    assert.equal(crossControl.state, 'FAIL_CLOSED');
    assert.equal(crossControl.failureCode, 'DURABLE_COMMAND_RECEIPT_INVALID');
    assert.equal(durableReads, 1);

    const absent = await instrumentedOwner.readResult(resultIdentity(
      'product.restart.absent.0001',
      request.controlId,
    ));
    assert.equal(absent.state, 'NOT_FOUND');

    const reloadedPersistence = new SystemLedgerPersistenceAdapter(world.ledger);
    const reloaded = reloadedPersistence.load(now.value + 1, 'product.control.result.reload');
    assert.equal(reloaded.ok, true);
    const reloadedControls = new SystemControlService({
      initialState: reloaded.state.control,
      persistence: reloadedPersistence,
      composition: world.composition,
    });
    const reloadedOwner = createProductRuntimeSystemControlCommandOwner({ controls: reloadedControls });
    const afterRestart = await reloadedOwner.readResult(identity);
    assert.equal(afterRestart.state, 'PENDING');
    assert.deepEqual(afterRestart.result, pending.result);
  } finally {
    world.ledger.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }
});

test('forged, actor-mismatched, expired, and stale previews cannot mutate canonical control state', async () => {
  const world = createWorld();
  try {
    const now = { value: T0 + 100 };
    const service = runtime(world, now);
    const killPreview = await service.previewCommand({
      controlId: 'global.kill-switch.engage', expectedRevision: '0', operator: ACTOR,
    });
    const killIntent = controlIntent('global.kill-switch.engage', 0, now.value);
    const killRequest = commandRequest(killIntent, killPreview, 'product.kill.engage.0002');
    const stalePreview = await service.previewCommand({
      controlId: 'global.safe-mode.read-only', expectedRevision: '0', operator: ACTOR,
    });
    const staleIntent = controlIntent('global.safe-mode.read-only', 0, now.value);
    const staleRequest = commandRequest(staleIntent, stalePreview, 'product.read.only.0002');
    const restartPreview = await service.previewCommand({
      controlId: 'component.engine-supervisor.restart', expectedRevision: '0', operator: ACTOR,
    });
    const restartIntent = controlIntent('component.engine-supervisor.restart', 0, now.value);
    const restartRequest = commandRequest(restartIntent, restartPreview, 'product.restart.root.0003');
    const eventCount = world.ledger.countEvents();

    const forged = await service.submitCommand({
      ...killRequest,
      previewDigest: `sha256:${'f'.repeat(64)}`,
    }, ACTOR);
    assert.equal(forged.status, 'REJECTED_AUTHORITY');
    assert.equal(world.ledger.countEvents(), eventCount);

    const actorMismatch = await service.submitCommand(killRequest, FOREIGN_ACTOR);
    assert.equal(actorMismatch.status, 'REJECTED_AUTHORITY');
    assert.equal(world.ledger.countEvents(), eventCount);

    now.value = killPreview.expiresAtMs;
    await assert.rejects(service.submitCommand(killRequest, ACTOR), (error) => error?.code === 'EXPIRED');
    assert.equal(world.ledger.countEvents(), eventCount);

    now.value = T0 + 101;
    assert.equal((await service.submitCommand(restartRequest, ACTOR)).status, 'ACCEPTED_ASYNC');
    const stale = await service.submitCommand(staleRequest, ACTOR);
    assert.equal(stale.status, 'REJECTED_STALE_REVISION');
    assert.equal(world.controls.snapshot().safeMode, 'READ_ONLY');
  } finally {
    world.ledger.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }
});

test('registered operator lifecycle control isolates and restarts one source without taking the healthy peer down', async () => {
  const world = createWorld();
  try {
    const now = { value: T0 + 1_000 };
    const service = runtime(world, now);
    const isolateIntent = sourceControlIntent('public-spot-source', 'ISOLATE', 0, now.value);
    const stalePreview = await service.previewCommand({
      controlId: isolateIntent.controlId,
      expectedRevision: '0',
      operator: ACTOR,
    });
    const isolated = await service.submitCommand(
      commandRequest(isolateIntent, stalePreview, 'product.source.spot.isolate.0001'),
      ACTOR,
    );
    assert.equal(isolated.status, 'APPLIED');
    assert.match(isolated.receiptId, /^source-control:sha256:[a-f0-9]{64}$/);
    assert.equal(world.sourcePhysical()['public-spot-source'].lifecycle, 'ISOLATED');
    assert.equal(world.sourcePhysical()['public-usdm-source'].lifecycle, 'LIVE');
    assert.equal(world.ledger.recentEvents(10, 'intelligence_runtime.source_control').length, 2);

    await assert.rejects(
      service.submitCommand(
        commandRequest(isolateIntent, stalePreview, 'product.source.spot.isolate.stale.0002'),
        ACTOR,
      ),
      (error) => error?.code === 'REJECTED_STALE_REVISION',
    );

    now.value += 1;
    const restartIntent = sourceControlIntent('public-spot-source', 'RESTART', 1, now.value);
    const restartPreview = await service.previewCommand({
      controlId: restartIntent.controlId,
      expectedRevision: '1',
      operator: ACTOR,
    });
    const restarted = await service.submitCommand(
      commandRequest(restartIntent, restartPreview, 'product.source.spot.restart.0001'),
      ACTOR,
    );
    assert.equal(restarted.status, 'APPLIED');
    assert.equal(world.sourcePhysical()['public-spot-source'].lifecycle, 'WARMING');
    assert.equal(world.sourcePhysical()['public-usdm-source'].lifecycle, 'LIVE');
    assert.equal(world.ledger.recentEvents(10, 'intelligence_runtime.source_control').length, 4);
  } finally {
    world.ledger.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }
});

test('source command result readback is durable, identity-bound, pending-aware, and recoverable', async () => {
  const world = createWorld();
  try {
    const now = { value: T0 + 2_000 };
    let service = runtime(world, now);
    const intent = sourceControlIntent('public-usdm-source', 'ISOLATE', 0, now.value);
    const preview = await service.previewCommand({
      controlId: intent.controlId, expectedRevision: '0', operator: ACTOR,
    });
    const request = commandRequest(intent, preview, 'product.source.usdm.isolate.result.0001');
    const submitted = await service.submitCommand(request, ACTOR);
    const identity = resultIdentity(request.idempotencyKey, request.controlId);
    const terminal = await service.readCommandResult(identity);
    assert.equal(terminal.state, 'TERMINAL');
    assert.equal(terminal.result.status, 'APPLIED');
    assert.equal(terminal.result.receiptId, submitted.receiptId);
    assert.equal(JSON.parse(terminal.result.after).observedLifecycle, 'ISOLATED');

    const recoveredSourceOwner = createSourceIsolationOwner({
      clock: { nowMs: () => T0 + 2_100 },
      persistence: world.sourcePersistence,
      physical: world.sourcePhysicalPort,
    });
    world.owner = createProductRuntimeSystemControlCommandOwner({
      controls: world.controls,
      sourceIsolation: recoveredSourceOwner,
    });
    service = runtime(world, now);
    assert.deepEqual(await service.readCommandResult(identity), terminal);

    const crossSource = await world.owner.readResult(resultIdentity(
      request.idempotencyKey,
      'source.public-spot-source.lifecycle',
    ));
    assert.equal(crossSource.state, 'FAIL_CLOSED');
    assert.equal(crossSource.failureCode, 'DURABLE_SOURCE_RECEIPT_INVALID');
  } finally {
    world.ledger.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }

  const pendingWorld = createWorld();
  try {
    pendingWorld.setSourceEffectFailure(true);
    const now = { value: T0 + 3_000 };
    const service = runtime(pendingWorld, now);
    const intent = sourceControlIntent('public-spot-source', 'ISOLATE', 0, now.value);
    const preview = await service.previewCommand({
      controlId: intent.controlId, expectedRevision: '0', operator: ACTOR,
    });
    const request = commandRequest(intent, preview, 'product.source.spot.pending.result.0001');
    const submitted = await service.submitCommand(request, ACTOR);
    assert.equal(submitted.status, 'FAILED_ATTENTION_REQUIRED');
    const identity = resultIdentity(request.idempotencyKey, request.controlId);
    const pending = await service.readCommandResult(identity);
    assert.equal(pending.state, 'PENDING');
    assert.equal(pending.result.status, 'ACCEPTED_ASYNC');
    assert.equal(JSON.parse(pending.result.after).observedLifecycle, 'LIVE');

    pendingWorld.setSourceEffectFailure(false);
    const recovered = await service.submitCommand(request, ACTOR);
    assert.equal(recovered.status, 'ALREADY_APPLIED');
    const terminal = await service.readCommandResult(identity);
    assert.equal(terminal.state, 'TERMINAL');
    assert.equal(terminal.result.status, 'APPLIED');
    assert.equal(JSON.parse(terminal.result.after).observedLifecycle, 'ISOLATED');
  } finally {
    pendingWorld.ledger.close();
    rmSync(pendingWorld.dataDir, { recursive: true, force: true });
  }
});

test('only bounded fail-safe and source-local directions exist and managed restart maps to the canonical dependency root', async () => {
  const world = createWorld();
  try {
    const unsafe = [
      { ...controlIntent('global.safe-mode.read-only', 0, T0 + 10), payload: { safeMode: 'VALIDATE_ONLY' } },
      { ...controlIntent('global.kill-switch.engage', 0, T0 + 10), payload: { engaged: false } },
      { ...controlIntent('global.intake.pause', 0, T0 + 10), payload: { paused: false } },
      { ...controlIntent('component.engine-supervisor.restart', 0, T0 + 10), targetId: 'basis-engine', payload: { componentId: 'basis-engine' } },
      { ...controlIntent('component.engine-supervisor.restart', 0, T0 + 10), backendCommandId: 'SPAWN_PROCESS' },
    ];
    for (const intent of unsafe) {
      await assert.rejects(world.owner.preview(intent), /invalid or unsupported/);
    }
    assert.equal(world.ledger.countEvents(), 0, 'preview and rejected unsafe directions write nothing');

    const previewIntent = controlIntent('component.engine-supervisor.restart', 0, T0 + 20);
    const preview = await world.owner.preview(previewIntent);
    const request = commandRequest(previewIntent, preview, 'product.restart.root.0001');
    const restarted = await world.owner.submit({
      request,
      intent: Object.freeze({ ...previewIntent, nowMs: T0 + 21 }),
    });
    assert.equal(restarted.status, 'ACCEPTED_ASYNC');
    assert.match(restarted.receiptId, /^ledger-event:[1-9][0-9]*$/);
    assert.deepEqual(world.inspections, [
      { command: 'RESTART_COMPONENT', componentId: 'market-universe' },
    ]);
    assert.equal(world.publications[0].request.mutation.componentId, 'market-universe');
    assert.equal(world.controls.snapshot().generation, 1);

    const source = readFileSync(new URL('../../../src/productIntegration/runtime/systemControlCommandOwner.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:borrow|repay|transfer|withdraw|leverage|margin)\b/i);
    assert.doesNotMatch(source, /child_process|spawn\s*\(|exec\s*\(|fetch\s*\(|WebSocket|process\.env|Binance/i);
  } finally {
    world.ledger.close();
    rmSync(world.dataDir, { recursive: true, force: true });
  }
});
