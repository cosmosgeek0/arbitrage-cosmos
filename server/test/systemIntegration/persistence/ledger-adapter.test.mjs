import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  SYSTEM_PERSISTENCE_EVENT_KIND,
  SystemLedgerPersistenceAdapter,
  upsertReservationReference,
} from '../../../dist/systemIntegration/persistence/index.js';

const T0 = 1_800_000_000_000;

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-system-persistence-'));
}

function trace(id, sequence, correlationId, occurredAtMs, kind = 'CAPITAL') {
  return Object.freeze({
    id,
    sequence,
    kind,
    componentId: kind === 'CAPITAL' ? 'capital-supervision' : 'ledger-persistence',
    correlationId,
    occurredAtMs,
    persistedAtMs: null,
    truthLabel: 'RECORDED_REPLAY',
    releaseStatuses: Object.freeze(['WIRED']),
    ownerId: null,
    canonicalProjectionId: null,
    revisionDigest: null,
    domainLifecycle: 'RESERVED',
    machinePhase: 'RUNNING',
    failure: null,
    referenceIds: Object.freeze([]),
    lossCodes: Object.freeze([]),
  });
}

test('existing Ledger atomically commits checkpoint plus audit before changing adapter memory', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const adapter = new SystemLedgerPersistenceAdapter(ledger);
    const loaded = adapter.load(T0, 'ledger.atomic');
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, 'EMPTY');

    const startup = adapter.persistStartup({ startedAtMs: T0 + 1, correlationId: 'ledger.atomic.start' });
    assert.equal(startup.ok, true);
    const beforeFailure = adapter.currentState();
    assert.equal(beforeFailure.ok, true);
    assert.equal(beforeFailure.value.revision, 1);
    assert.equal(ledger.recentEvents(10, SYSTEM_PERSISTENCE_EVENT_KIND).length, 1);
    assert.notEqual(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY), null);

    ledger.close();
    const failed = adapter.persistRestartTruth({
      publicSourceTruth: 'FRESH',
      accountTruth: 'FRESH',
      reconciliationTruth: 'FRESH',
      observedAtMs: T0 + 2,
    }, 'ledger.atomic.truth');
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'PERSISTENCE_WRITE_FAILED');
    const afterFailure = adapter.currentState();
    assert.equal(afterFailure.ok, true);
    assert.deepEqual(afterFailure.value, beforeFailure.value);
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('corrupt durable checkpoints fail closed and post-commit listener failure is reconciled from Ledger truth', () => {
  const corruptDir = tempDataDir();
  const corruptLedger = new Ledger(corruptDir);
  try {
    corruptLedger.setConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, '{"schema":"corrupt"}');
    const corruptAdapter = new SystemLedgerPersistenceAdapter(corruptLedger);
    const loaded = corruptAdapter.load(T0, 'corrupt.load');
    assert.equal(loaded.ok, false);
    assert.equal(loaded.code, 'PERSISTENCE_CORRUPT');
    assert.equal(loaded.barrier.canOpenOrIncrease, false);
    assert.equal(loaded.barrier.supervisionContinues, true);
    assert.equal(corruptAdapter.currentState().ok, false);
  } finally {
    corruptLedger.close();
    rmSync(corruptDir, { recursive: true, force: true });
  }

  const listenerDir = tempDataDir();
  const listenerLedger = new Ledger(listenerDir);
  try {
    const adapter = new SystemLedgerPersistenceAdapter(listenerLedger);
    adapter.load(T0, 'listener.load');
    listenerLedger.on('event', () => { throw new Error('listener failure after durable commit'); });
    const committed = adapter.persistStartup({ startedAtMs: T0 + 1, correlationId: 'listener.start' });
    assert.equal(committed.ok, true);
    assert.equal(adapter.currentState().value.revision, 1);
    assert.equal(listenerLedger.recentEvents(10, SYSTEM_PERSISTENCE_EVENT_KIND).length, 1);
  } finally {
    listenerLedger.close();
    rmSync(listenerDir, { recursive: true, force: true });
  }
});

test('two independent adapters admit one checkpoint writer and refresh the stale loser without a loser event', () => {
  const dataDir = tempDataDir();
  const winnerLedger = new Ledger(dataDir);
  const loserLedger = new Ledger(dataDir);
  try {
    const winnerAdapter = new SystemLedgerPersistenceAdapter(winnerLedger);
    const loserAdapter = new SystemLedgerPersistenceAdapter(loserLedger);
    assert.equal(winnerAdapter.load(T0, 'race.winner.load').ok, true);
    assert.equal(loserAdapter.load(T0, 'race.loser.load').ok, true);

    const winner = winnerAdapter.persistStartup({
      startedAtMs: T0 + 1,
      correlationId: 'race.winner.start',
    });
    assert.equal(winner.ok, true);
    const durableAfterWinner = winnerLedger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY);
    const eventsAfterWinner = winnerLedger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND);
    assert.notEqual(durableAfterWinner, null);
    assert.equal(eventsAfterWinner.length, 1);

    const loser = loserAdapter.persistStartup({
      startedAtMs: T0 + 2,
      correlationId: 'race.loser.start',
    });
    assert.equal(loser.ok, false);
    assert.equal(loser.code, 'CHECKPOINT_REVISION_CONFLICT');
    assert.equal(loserLedger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY), durableAfterWinner);
    assert.equal(loserLedger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, eventsAfterWinner.length);

    const winnerState = winnerAdapter.currentState();
    const recoveredLoserState = loserAdapter.currentState();
    assert.equal(winnerState.ok, true);
    assert.equal(recoveredLoserState.ok, true);
    assert.deepEqual(recoveredLoserState.value, winnerState.value);
    assert.equal(recoveredLoserState.value.lastStartup.correlationId, 'race.winner.start');
  } finally {
    winnerLedger.close();
    loserLedger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a stale compare-and-set conflict with invalid durable truth fails the adapter closed without an audit event', () => {
  const dataDir = tempDataDir();
  const writerLedger = new Ledger(dataDir);
  const staleLedger = new Ledger(dataDir);
  try {
    const staleAdapter = new SystemLedgerPersistenceAdapter(staleLedger);
    assert.equal(staleAdapter.load(T0, 'race.corrupt.load').ok, true);
    writerLedger.setConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, '{"schema":"corrupt"}');

    const stale = staleAdapter.persistStartup({
      startedAtMs: T0 + 1,
      correlationId: 'race.corrupt.start',
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'CHECKPOINT_REVISION_CONFLICT');
    assert.equal(staleLedger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, 0);
    const failedClosed = staleAdapter.currentState();
    assert.equal(failedClosed.ok, false);
    assert.equal(failedClosed.code, 'PERSISTENCE_CORRUPT');
  } finally {
    writerLedger.close();
    staleLedger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('idempotency survives process restart and prevents duplicate allocation and duplicate ledger events', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    let adapter = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(adapter.load(T0, 'replay.empty').ok, true);
    assert.equal(adapter.persistStartup({ startedAtMs: T0 + 1, correlationId: 'replay.start' }).ok, true);
    const input = {
      idempotencyKey: 'reservation.create.0001',
      requestDigest: 'a'.repeat(64),
      correlationId: 'replay.reservation',
      occurredAtMs: T0 + 2,
      traceEvent: trace('reservation.persisted.1', 2, 'replay.reservation', T0 + 2),
      transition: (state) => ({
        nextState: upsertReservationReference(state, {
          reservationId: 'reservation-1',
          allocationKey: 'BTCUSDT:basis:budget-1',
          ownerRevision: 'capital-revision-1',
          domainState: 'RESERVED',
          blocksAllocation: true,
          correlationId: 'replay.reservation',
          updatedAtMs: T0 + 2,
        }),
        receipt: { reservationId: 'reservation-1', state: 'RESERVED' },
      }),
    };
    const first = adapter.applyIdempotentTransition(input);
    assert.equal(first.ok, true);
    assert.equal(first.value.replayed, false);
    const eventCount = ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length;
    ledger.close();

    ledger = new Ledger(dataDir);
    adapter = new SystemLedgerPersistenceAdapter(ledger);
    const reloaded = adapter.load(T0 + 3, 'replay.reload');
    assert.equal(reloaded.ok, true);
    assert.equal(reloaded.source, 'CHECKPOINT');
    assert.equal(reloaded.state.reservations.length, 1);
    let transitionCalls = 0;
    const replay = adapter.applyIdempotentTransition({
      ...input,
      transition: () => {
        transitionCalls += 1;
        throw new Error('replayed transition must never execute');
      },
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.value.replayed, true);
    assert.equal(transitionCalls, 0);
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, eventCount);

    const conflict = adapter.applyIdempotentTransition({ ...input, requestDigest: 'b'.repeat(64) });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, 'IDEMPOTENCY_KEY_CONFLICT');

    const duplicate = adapter.applyIdempotentTransition({
      idempotencyKey: 'reservation.create.0002',
      requestDigest: 'c'.repeat(64),
      correlationId: 'replay.duplicate',
      occurredAtMs: T0 + 4,
      traceEvent: trace('reservation.persisted.2', 3, 'replay.duplicate', T0 + 4),
      transition: (state) => ({
        nextState: upsertReservationReference(state, {
          reservationId: 'reservation-2',
          allocationKey: 'BTCUSDT:basis:budget-1',
          ownerRevision: 'capital-revision-2',
          domainState: 'RESERVED',
          blocksAllocation: true,
          correlationId: 'replay.duplicate',
          updatedAtMs: T0 + 4,
        }),
        receipt: { reservationId: 'reservation-2' },
      }),
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, 'CHECKPOINT_INVALID');
    assert.equal(adapter.currentState().value.reservations.length, 1);
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, eventCount);
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('trace queries are exact, deterministic, and strictly bounded', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const adapter = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(adapter.load(T0, 'trace.empty').ok, true);
    assert.equal(adapter.persistStartup({ startedAtMs: T0 + 1, correlationId: 'trace.start' }).ok, true);
    for (let index = 0; index < 5; index += 1) {
      const correlationId = index === 3 ? 'trace.other' : 'trace.target';
      const appended = adapter.appendTraceEvent(trace(`trace.event.${index}`, index + 2, correlationId, T0 + 10 + index, 'PERSISTENCE'));
      assert.equal(appended.ok, true);
    }
    const result = adapter.queryTrace({ correlationId: 'trace.target', limit: 2 });
    assert.equal(result.ok, true);
    assert.equal(result.value.events.length, 2);
    assert.equal(result.value.truncated, true);
    assert.deepEqual(result.value.events.map((entry) => entry.event.sequence), [4, 6]);
    assert.ok(result.value.events.every((entry) => entry.event.correlationId === 'trace.target'));
    assert.ok(result.value.events.every((entry) => entry.event.persistedAtMs === entry.persistedAtMs));

    const invalid = adapter.queryTrace({ correlationId: 'trace.target', limit: 201 });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'INVALID_PERSISTENCE_REQUEST');
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
