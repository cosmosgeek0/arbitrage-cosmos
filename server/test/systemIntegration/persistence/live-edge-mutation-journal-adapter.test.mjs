import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import { Ledger } from '../../../dist/ledger.js';
import { canonicalPersistenceJson } from '../../../dist/systemIntegration/persistence/codec.js';
import {
  LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND,
  LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY,
  LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND,
  LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS,
  LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_SCHEMA,
  LiveEdgeMutationJournalAdapterError,
  LiveEdgeMutationJournalPersistenceAdapter,
  liveEdgeMutationJournalMutationKey,
} from '../../../dist/systemIntegration/persistence/liveEdgeMutationJournalAdapter.js';
import {
  evaluateSyntheticSubmissionBoundary,
  mutationObservationId,
  prepareInitialMutationAppend,
  prepareMutationObservationAppend,
  preparePreflightMutationAppend,
  prepareSubmissionIntentAppend,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import {
  inputFixture,
  persist,
} from '../../liveEdge/mutationJournal/fixtures.mjs';

const T = 1_700_000_000_000;

function tempDataDir(label = 'cosmos-live-edge-journal-') {
  return mkdtempSync(path.join(tmpdir(), label));
}

function canonicalInput(
  index = 0,
  assessmentId = `assessment:canonical-${index}`,
  atMs = T,
) {
  return inputFixture({
    identity: { assessmentId },
    preflightResult: {
      evaluatedAtMs: atMs - 100,
      instrumentValidUntilMs: atMs + 10_000,
    },
    bindings: {
      sourceExchangeEventAtMs: atMs - 400,
      sourceLocalReceiveAtMs: atMs - 390,
      featuresReadyAtMs: atMs - 300,
      decisionAtMs: atMs - 250,
      approvalAtMs: atMs - 150,
      preflightEvaluatedAtMs: atMs - 100,
      privateEvaluatedAtMs: atMs - 50,
      validUntilMs: atMs + 10_000,
    },
    createdAtMs: atMs,
  });
}

function telemetryPrepared(current, subsystem, atMs, marker) {
  const material = {
    kind: 'TELEMETRY_DEGRADED',
    occurredAtMs: atMs,
    receivedAtMs: atMs,
    sourceRevision: `l06-test-source:${marker}`,
    payload: {
      subsystem,
      reasonCode: `${subsystem}_DEGRADED`,
    },
  };
  const result = prepareMutationObservationAppend(current, {
    observationId: mutationObservationId(current, material),
    ...material,
  });
  assert.equal(result.kind, 'PREPARED');
  return result.prepared;
}

function registryFromSnapshots(snapshots) {
  return {
    schema: LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_SCHEMA,
    version: 1,
    journals: snapshots.map((snapshot) => ({
      mutationKey: liveEdgeMutationJournalMutationKey(snapshot.mutationId),
      mutationId: snapshot.mutationId,
      snapshot,
    })).sort((left, right) => left.mutationKey.localeCompare(right.mutationKey)),
  };
}

function appendAndRead(adapter, prepared) {
  const acknowledgement = adapter.append(prepared.request);
  assert.equal(acknowledgement.disposition, 'COMMITTED_NEW');
  assert.equal(acknowledgement.appendedCount, 1);
  assert.ok(Number.isSafeInteger(acknowledgement.ledgerEventId));
  assert.ok(acknowledgement.ledgerEventId > 0);
  const persisted = adapter.read(prepared.request.mutationId);
  assert.ok(persisted);
  return persisted;
}

test('fixed-key registry atomically persists donor-reduced state and reconstructs exact replay after restart', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger);
    const prepared = prepareInitialMutationAppend(canonicalInput());
    ledger.on('event', () => {
      throw new Error('hostile listener failed after commit');
    });
    const acknowledgement = adapter.append(prepared.request);
    assert.equal(acknowledgement.disposition, 'COMMITTED_NEW');
    assert.equal(acknowledgement.externalActionAuthorization, 'NONE');
    assert.equal(acknowledgement.appendedCount, 1);
    assert.ok(acknowledgement.ledgerEventId > 0);

    const stored = ledger.getConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY);
    assert.ok(stored);
    const decoded = JSON.parse(stored);
    assert.equal(decoded.journals.length, 1);
    assert.equal(decoded.journals[0].mutationKey, liveEdgeMutationJournalMutationKey(prepared.request.mutationId));
    assert.equal(decoded.journals[0].snapshot.persistenceProven, false);
    assert.equal(decoded.journals[0].snapshot.externalActionAuthorization, 'NONE');

    const events = ledger.recentEvents(10, undefined, prepared.request.mutationId).sort((a, b) => a.id - b.id);
    assert.deepEqual(events.map((event) => event.kind), [
      LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND,
      LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND,
    ]);
    assert.equal(events[1].id, events[0].id + 1);
    assert.equal(events[1].ts, events[0].ts);
    assert.equal(events[0].data.appendRequestDigest, prepared.request.appendRequestDigest);
    assert.equal(events[1].data.sendAuthorized, false);

    const replay = adapter.append(prepared.request);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(replay.appendedCount, 0);
    assert.equal(replay.ledgerEventId, acknowledgement.ledgerEventId);
    assert.equal(ledger.countEvents(), 2);
    ledger.close();

    const restartedLedger = new Ledger(dataDir);
    try {
      const restarted = new LiveEdgeMutationJournalPersistenceAdapter(restartedLedger);
      const restored = restarted.read(prepared.request.mutationId);
      assert.ok(restored);
      assert.equal(restored.snapshot.headDigest, prepared.request.nextHeadDigest);
      assert.equal(restored.snapshot.outcomeRevision, prepared.request.nextOutcomeRevision);
      assert.equal(restored.acknowledgement.disposition, 'IDEMPOTENT_REPLAY');
      assert.equal(restored.persistenceProven, false);
      assert.equal(restored.provenance, 'INJECTED_ACKNOWLEDGEMENT_ONLY');
      assert.equal(restored.externalActionAuthorization, 'NONE');
    } finally {
      restartedLedger.close();
    }
  } finally {
    if (ledger.db.open) ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('post-commit listener and return-path failure recover the exact committed pair without a second append', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    ledger.on('event', () => {
      throw new Error('hostile listener failed after commit');
    });
    let injected = false;
    const postCommitFailurePort = {
      getConfigValue: (...args) => ledger.getConfigValue(...args),
      recentEvents: (...args) => ledger.recentEvents(...args),
      compareAndSetConfigValueAndLogEvents(...args) {
        const result = ledger.compareAndSetConfigValueAndLogEvents(...args);
        if (result.committed && !injected) {
          injected = true;
          throw new Error('injected failure after the canonical Ledger returned its commit');
        }
        return result;
      },
    };
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(postCommitFailurePort);
    const prepared = prepareInitialMutationAppend(canonicalInput(40));
    const acknowledgement = adapter.append(prepared.request);
    assert.equal(acknowledgement.disposition, 'COMMITTED_NEW');
    assert.equal(acknowledgement.appendedCount, 1);
    assert.ok(acknowledgement.ledgerEventId > 0);
    assert.equal(acknowledgement.externalActionAuthorization, 'NONE');
    assert.equal(ledger.countEvents(), 2);

    const replay = adapter.append(prepared.request);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(replay.appendedCount, 0);
    assert.equal(replay.ledgerEventId, acknowledgement.ledgerEventId);
    assert.equal(replay.externalActionAuthorization, 'NONE');
    assert.equal(ledger.countEvents(), 2);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('two independently opened adapters serialize the whole registry and a same-version different digest loses without rows', () => {
  const dataDir = tempDataDir();
  const firstLedger = new Ledger(dataDir);
  const secondLedger = new Ledger(dataDir);
  try {
    const winnerAdapter = new LiveEdgeMutationJournalPersistenceAdapter(firstLedger);
    const initial = prepareInitialMutationAppend(canonicalInput(1));
    const current = appendAndRead(winnerAdapter, initial);
    const winner = telemetryPrepared(current, 'TRACE', T + 1, 'winner');
    const loser = telemetryPrepared(current, 'READ_MODEL', T + 1, 'loser');

    let interleaved = false;
    let winnerAcknowledgement = null;
    const interleavingPort = {
      getConfigValue: (...args) => secondLedger.getConfigValue(...args),
      recentEvents: (...args) => secondLedger.recentEvents(...args),
      compareAndSetConfigValueAndLogEvents(...args) {
        if (!interleaved) {
          interleaved = true;
          winnerAcknowledgement = winnerAdapter.append(winner.request);
        }
        return secondLedger.compareAndSetConfigValueAndLogEvents(...args);
      },
    };
    const losingAdapter = new LiveEdgeMutationJournalPersistenceAdapter(interleavingPort);
    const countBefore = secondLedger.countEvents();
    const losingAcknowledgement = losingAdapter.append(loser.request);

    assert.equal(winnerAcknowledgement.disposition, 'COMMITTED_NEW');
    assert.equal(losingAcknowledgement.disposition, 'VERSION_CONFLICT');
    assert.equal(losingAcknowledgement.failureCode, 'IDEMPOTENCY_CONFLICT');
    assert.equal(losingAcknowledgement.appendedCount, 0);
    assert.equal(secondLedger.countEvents(), countBefore + 2);
    assert.equal(secondLedger.recentEvents(10, LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND, loser.request.mutationId).length, 2);
    assert.equal(secondLedger.recentEvents(10, LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND, loser.request.mutationId).length, 2);
    assert.equal(secondLedger.recentEvents(
      10,
      LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND,
      loser.request.mutationId,
    ).some((event) => event.data.appendRequestDigest === loser.request.appendRequestDigest), false);
    assert.equal(secondLedger.recentEvents(
      10,
      LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND,
      loser.request.mutationId,
    ).some((event) => event.data.appendRequestDigest === loser.request.appendRequestDigest), false);

    const replay = losingAdapter.append(winner.request);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(secondLedger.countEvents(), countBefore + 2);
  } finally {
    firstLedger.close();
    secondLedger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('two Worker-loaded adapters race one SQLite revision and exactly one commits', { timeout: 15_000 }, async () => {
  const dataDir = tempDataDir('cosmos-live-edge-worker-race-');
  const initialized = new Ledger(dataDir);
  initialized.close();
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const barrier = new Int32Array(shared);
  const ledgerModuleUrl = pathToFileURL(path.resolve('server/dist/ledger.js')).href;
  const adapterModuleUrl = pathToFileURL(path.resolve(
    'server/dist/systemIntegration/persistence/liveEdgeMutationJournalAdapter.js',
  )).href;
  const workerSource = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { Ledger } from ${JSON.stringify(ledgerModuleUrl)};
    import { LiveEdgeMutationJournalPersistenceAdapter } from ${JSON.stringify(adapterModuleUrl)};
    let ledger = null;
    try {
      const barrier = new Int32Array(workerData.shared);
      ledger = new Ledger(workerData.dataDir);
      const adapter = new LiveEdgeMutationJournalPersistenceAdapter(
        ledger,
        Object.freeze({ nowMs: () => workerData.nowMs }),
      );
      Atomics.add(barrier, 0, 1);
      Atomics.notify(barrier, 0);
      Atomics.wait(barrier, 1, 0);
      const acknowledgement = adapter.append(workerData.request);
      ledger.close();
      ledger = null;
      parentPort.postMessage({ mutationId: workerData.request.mutationId, acknowledgement });
    } catch (error) {
      if (ledger?.db?.open) ledger.close();
      parentPort.postMessage({
        mutationId: workerData.request.mutationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  `;
  const workerUrl = new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`);
  const requests = [
    prepareInitialMutationAppend(canonicalInput(41)).request,
    prepareInitialMutationAppend(canonicalInput(42)).request,
  ];
  const workers = requests.map((request) => new Worker(workerUrl, {
    workerData: { dataDir, shared, request, nowMs: T },
  }));
  const workerMessages = workers.map((worker) => new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  }));
  const workerExits = workers.map((worker) => new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`CAS race Worker exited ${code}`)));
  }));
  try {
    const readyDeadline = Date.now() + 10_000;
    while (Atomics.load(barrier, 0) < workers.length && Date.now() < readyDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(Atomics.load(barrier, 0), workers.length, 'both adapters must load before release');
    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1, workers.length);
    const results = await Promise.all(workerMessages);
    await Promise.all(workerExits);
    assert.deepEqual(results.map((result) => result.error ?? null), [null, null]);
    assert.deepEqual(
      results.map((result) => result.acknowledgement.disposition).sort(),
      ['COMMITTED_NEW', 'VERSION_CONFLICT'],
    );
    const winner = results.find((result) => result.acknowledgement.disposition === 'COMMITTED_NEW');
    const loser = results.find((result) => result.acknowledgement.disposition === 'VERSION_CONFLICT');
    assert.ok(winner);
    assert.ok(loser);
    assert.equal(winner.acknowledgement.appendedCount, 1);
    assert.equal(winner.acknowledgement.externalActionAuthorization, 'NONE');
    assert.equal(loser.acknowledgement.appendedCount, 0);
    assert.equal(loser.acknowledgement.ledgerEventId, null);
    assert.equal(loser.acknowledgement.failureCode, 'VERSION_CONFLICT');
    assert.equal(loser.acknowledgement.externalActionAuthorization, 'NONE');

    const ledger = new Ledger(dataDir);
    try {
      assert.equal(ledger.countEvents(), 2);
      assert.equal(ledger.recentEvents(
        10,
        LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND,
        loser.mutationId,
      ).length, 0);
      assert.equal(ledger.recentEvents(
        10,
        LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND,
        loser.mutationId,
      ).length, 0);
      const registry = JSON.parse(ledger.getConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY));
      assert.equal(registry.journals.length, 1);
      assert.equal(registry.journals[0].mutationId, winner.mutationId);
    } finally {
      ledger.close();
    }
  } finally {
    for (const worker of workers) {
      if (worker.threadId !== -1) await worker.terminate();
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('restart exact replay and different digest conflict cannot reopen the synthetic boundary', () => {
  const dataDir = tempDataDir('cosmos-live-edge-restart-replay-');
  let ledger = new Ledger(dataDir);
  try {
    let adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger, { nowMs: () => T + 10 });
    const initial = appendAndRead(adapter, prepareInitialMutationAppend(canonicalInput(43)));
    const preflight = appendAndRead(adapter, preparePreflightMutationAppend(initial, T + 1));
    const exact = prepareSubmissionIntentAppend(preflight, T + 2);
    const differentDigest = prepareSubmissionIntentAppend(preflight, T + 3);
    assert.notEqual(exact.request.appendRequestDigest, differentDigest.request.appendRequestDigest);
    const committed = adapter.append(exact.request);
    assert.equal(committed.disposition, 'COMMITTED_NEW');
    assert.equal(committed.externalActionAuthorization, 'NONE');
    const countAtCommit = ledger.countEvents();
    ledger.close();

    ledger = new Ledger(dataDir);
    adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger, { nowMs: () => T + 10 });
    const replay = adapter.append(exact.request);
    const conflict = adapter.append(differentDigest.request);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(replay.appendedCount, 0);
    assert.equal(replay.externalActionAuthorization, 'NONE');
    assert.equal(conflict.disposition, 'VERSION_CONFLICT');
    assert.equal(conflict.appendedCount, 0);
    assert.equal(conflict.externalActionAuthorization, 'NONE');
    assert.equal(ledger.countEvents(), countAtCommit);

    const reconstructed = adapter.read(exact.request.mutationId);
    assert.ok(reconstructed);
    assert.equal(reconstructed.acknowledgement.disposition, 'IDEMPOTENT_REPLAY');
    const boundary = evaluateSyntheticSubmissionBoundary(reconstructed, T + 4);
    assert.equal(boundary.state, 'BLOCKED');
    assert.ok(boundary.reasonCodes.includes('REPLAYED_ACK_CANNOT_OPEN_BOUNDARY'));
    assert.equal(boundary.sendAuthorized, false);
    assert.equal(boundary.externalActionAuthorization, 'NONE');
  } finally {
    if (ledger.db.open) ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('an unrelated mutation winning the fixed-registry CAS yields version conflict and zero target rows', () => {
  const dataDir = tempDataDir();
  const firstLedger = new Ledger(dataDir);
  const secondLedger = new Ledger(dataDir);
  try {
    const winnerAdapter = new LiveEdgeMutationJournalPersistenceAdapter(firstLedger);
    const winner = prepareInitialMutationAppend(canonicalInput(20));
    const target = prepareInitialMutationAppend(canonicalInput(21));
    assert.notEqual(winner.request.mutationId, target.request.mutationId);

    let interleaved = false;
    let winnerAcknowledgement = null;
    const interleavingPort = {
      getConfigValue: (...args) => secondLedger.getConfigValue(...args),
      recentEvents: (...args) => secondLedger.recentEvents(...args),
      compareAndSetConfigValueAndLogEvents(...args) {
        if (!interleaved) {
          interleaved = true;
          winnerAcknowledgement = winnerAdapter.append(winner.request);
        }
        return secondLedger.compareAndSetConfigValueAndLogEvents(...args);
      },
    };
    const targetAdapter = new LiveEdgeMutationJournalPersistenceAdapter(interleavingPort);
    const acknowledgement = targetAdapter.append(target.request);

    assert.equal(winnerAcknowledgement.disposition, 'COMMITTED_NEW');
    assert.equal(acknowledgement.disposition, 'VERSION_CONFLICT');
    assert.equal(acknowledgement.failureCode, 'VERSION_CONFLICT');
    assert.equal(acknowledgement.appendedCount, 0);
    assert.equal(secondLedger.recentEvents(
      10,
      LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND,
      target.request.mutationId,
    ).length, 0);
    assert.equal(secondLedger.recentEvents(
      10,
      LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND,
      target.request.mutationId,
    ).length, 0);
    assert.equal(secondLedger.recentEvents(
      10,
      LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND,
      winner.request.mutationId,
    ).length, 1);
    assert.equal(secondLedger.recentEvents(
      10,
      LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND,
      winner.request.mutationId,
    ).length, 1);
  } finally {
    firstLedger.close();
    secondLedger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('audit insert failure rolls back registry and dedicated event as an unsplit pair', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  let reopenedLedger = null;
  try {
    ledger.db.exec(`
      CREATE TRIGGER reject_live_edge_audit
      BEFORE INSERT ON events WHEN NEW.kind = '${LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND}'
      BEGIN SELECT RAISE(ABORT, 'live-edge audit rejected'); END;
    `);
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger);
    const prepared = prepareInitialMutationAppend(canonicalInput(2));
    const acknowledgement = adapter.append(prepared.request);
    assert.equal(acknowledgement.disposition, 'FAILED');
    assert.equal(acknowledgement.failureCode, 'PERSISTENCE_WRITE_FAILED');
    assert.equal(ledger.getConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY), null);
    assert.equal(ledger.countEvents(), 0);
    ledger.close();

    reopenedLedger = new Ledger(dataDir);
    assert.equal(reopenedLedger.getConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY), null);
    assert.equal(reopenedLedger.countEvents(), 0);
    reopenedLedger.db.exec('DROP TRIGGER reject_live_edge_audit');
    const restartedAdapter = new LiveEdgeMutationJournalPersistenceAdapter(reopenedLedger);
    const committed = appendAndRead(restartedAdapter, prepared);
    assert.equal(committed.snapshot.journalVersion, 1);
    assert.equal(reopenedLedger.countEvents(), 2);
    const replay = restartedAdapter.append(prepared.request);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(reopenedLedger.countEvents(), 2);
  } finally {
    if (reopenedLedger?.db.open) reopenedLedger.close();
    if (ledger.db.open) ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('corrupt, noncanonical, secret-bearing, and unavailable persistence fail closed without fallback', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const prepared = prepareInitialMutationAppend(canonicalInput(3));
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger);
    ledger.setConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY, '{"version":1}');
    const corrupt = adapter.append(prepared.request);
    assert.equal(corrupt.disposition, 'FAILED');
    assert.equal(corrupt.failureCode, 'PERSISTENCE_CORRUPT');
    assert.equal(ledger.countEvents(), 0);

    ledger.setConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY, canonicalPersistenceJson(registryFromSnapshots([])));
    const secretBearing = { ...prepared.request, apiSecret: 'never-persist-this-secret-value' };
    assert.throws(
      () => adapter.append(secretBearing),
      (error) => error instanceof LiveEdgeMutationJournalAdapterError
        && error.code === 'INVALID_APPEND_REQUEST',
    );
    assert.equal(ledger.countEvents(), 0);

    const unavailable = new LiveEdgeMutationJournalPersistenceAdapter({
      getConfigValue: () => null,
      recentEvents: () => [],
    });
    const unavailableAck = unavailable.append(prepared.request);
    assert.equal(unavailableAck.disposition, 'FAILED');
    assert.equal(unavailableAck.failureCode, 'PERSISTENCE_UNAVAILABLE');
    assert.equal(unavailableAck.externalActionAuthorization, 'NONE');
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('hard registry count capacity refuses the 65th journal without eviction or events', () => {
  const dataDir = tempDataDir('cosmos-live-edge-count-capacity-');
  const ledger = new Ledger(dataDir);
  try {
    const snapshots = Array.from(
      { length: LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS.maximumJournals },
      (_, index) => prepareInitialMutationAppend(canonicalInput(100 + index)).nextSnapshot,
    );
    const serialized = canonicalPersistenceJson(registryFromSnapshots(snapshots));
    assert.ok(Buffer.byteLength(serialized, 'utf8') < LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS.maximumSerializedBytes);
    ledger.setConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY, serialized);
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger);
    const overflow = prepareInitialMutationAppend(canonicalInput(1_000));
    const acknowledgement = adapter.append(overflow.request);
    assert.equal(acknowledgement.disposition, 'CAPACITY_EXHAUSTED');
    assert.equal(acknowledgement.failureCode, 'CAPACITY_EXHAUSTED');
    assert.equal(ledger.getConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY), serialized);
    assert.equal(ledger.countEvents(), 0);
    assert.equal(JSON.parse(serialized).journals.length, 64);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('aggregate 512 KiB registry capacity refuses growth without unsafe eviction', () => {
  const dataDir = tempDataDir('cosmos-live-edge-byte-capacity-');
  const ledger = new Ledger(dataDir);
  try {
    const persistedJournals = [];
    for (let index = 0; index < 59; index += 1) {
      const initial = persist(prepareInitialMutationAppend(canonicalInput(
        200 + index,
        `assessment:bxxx${index.toString(36)}`,
      )));
      persistedJournals.push(index < 58
        ? persist(preparePreflightMutationAppend(initial, T + 1))
        : initial);
    }
    const serialized = canonicalPersistenceJson(
      registryFromSnapshots(persistedJournals.map((current) => current.snapshot)),
    );
    const bytesBefore = Buffer.byteLength(serialized, 'utf8');
    assert.ok(bytesBefore < LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS.maximumSerializedBytes);
    assert.ok(bytesBefore > LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS.maximumSerializedBytes - 2_000);
    ledger.setConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY, serialized);

    const growth = preparePreflightMutationAppend(persistedJournals[58], T + 1);
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger);
    const acknowledgement = adapter.append(growth.request);
    assert.equal(acknowledgement.disposition, 'CAPACITY_EXHAUSTED');
    assert.equal(acknowledgement.failureCode, 'CAPACITY_EXHAUSTED');
    assert.equal(ledger.getConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY), serialized);
    assert.equal(ledger.countEvents(), 0);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('duplicate dedicated rows are corruption rather than a silently accepted replay', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger);
    const prepared = prepareInitialMutationAppend(canonicalInput(4));
    appendAndRead(adapter, prepared);
    const originals = ledger.recentEvents(10, undefined, prepared.request.mutationId)
      .sort((left, right) => left.id - right.id);
    ledger.logEventsAtomically(originals.map((event) => ({
      kind: event.kind,
      symbol: event.symbol,
      data: event.data,
    })));
    assert.throws(
      () => adapter.read(prepared.request.mutationId),
      (error) => error instanceof LiveEdgeMutationJournalAdapterError
        && error.code === 'PERSISTENCE_CORRUPT',
    );
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('missing interior journal and audit rows poison read and block every later append', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger);
    const initial = appendAndRead(adapter, prepareInitialMutationAppend(canonicalInput(5)));
    const second = appendAndRead(adapter, telemetryPrepared(initial, 'TRACE', T + 1, 'middle'));
    const thirdPrepared = telemetryPrepared(second, 'READ_MODEL', T + 2, 'tail');
    const third = appendAndRead(adapter, thirdPrepared);
    const rows = ledger.recentEvents(20, undefined, third.snapshot.mutationId);
    const middleJournal = rows.find((event) => (
      event.kind === LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND
      && event.data.nextJournalVersion === 2
    ));
    const middleAudit = rows.find((event) => (
      event.kind === LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND
      && event.data.committedJournalVersion === 2
    ));
    assert.ok(middleJournal);
    assert.ok(middleAudit);
    ledger.db.prepare('DELETE FROM events WHERE id IN (?, ?)').run(middleJournal.id, middleAudit.id);
    const countAfterDamage = ledger.countEvents();

    assert.throws(
      () => adapter.read(third.snapshot.mutationId),
      (error) => error instanceof LiveEdgeMutationJournalAdapterError
        && error.code === 'PERSISTENCE_CORRUPT',
    );
    const later = telemetryPrepared(
      third,
      'INTELLIGENCE_RUNTIME_RECORDING',
      T + 3,
      'after-missing-middle',
    );
    const acknowledgement = adapter.append(later.request);
    assert.equal(acknowledgement.disposition, 'FAILED');
    assert.equal(acknowledgement.failureCode, 'PERSISTENCE_CORRUPT');
    assert.equal(ledger.countEvents(), countAfterDamage);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a donor-valid forged config lineage cannot be laundered by one legitimate later append', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger);
    const initial = appendAndRead(adapter, prepareInitialMutationAppend(canonicalInput(6)));
    appendAndRead(adapter, telemetryPrepared(initial, 'TRACE', T + 1, 'committed-middle'));
    const forgedMiddle = telemetryPrepared(initial, 'READ_MODEL', T + 1, 'forged-middle');
    const forgedCurrent = persist(forgedMiddle);
    ledger.setConfigValue(
      LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY,
      canonicalPersistenceJson(registryFromSnapshots([forgedCurrent.snapshot])),
    );
    const countBefore = ledger.countEvents();

    assert.throws(
      () => adapter.read(forgedCurrent.snapshot.mutationId),
      (error) => error instanceof LiveEdgeMutationJournalAdapterError
        && error.code === 'PERSISTENCE_CORRUPT',
    );
    const later = telemetryPrepared(forgedCurrent, 'TRACE', T + 2, 'after-forgery');
    const acknowledgement = adapter.append(later.request);
    assert.equal(acknowledgement.disposition, 'FAILED');
    assert.equal(acknowledgement.failureCode, 'PERSISTENCE_CORRUPT');
    assert.equal(ledger.countEvents(), countBefore);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('orphan recovery rows without the fixed registry key block a replacement initial append', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(ledger);
    const prepared = prepareInitialMutationAppend(canonicalInput(7));
    appendAndRead(adapter, prepared);
    ledger.db.prepare('DELETE FROM config WHERE key = ?').run(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY);
    const countBefore = ledger.countEvents();

    assert.throws(
      () => adapter.read(prepared.request.mutationId),
      (error) => error instanceof LiveEdgeMutationJournalAdapterError
        && error.code === 'PERSISTENCE_CORRUPT',
    );
    const acknowledgement = adapter.append(prepared.request);
    assert.equal(acknowledgement.disposition, 'FAILED');
    assert.equal(acknowledgement.failureCode, 'PERSISTENCE_CORRUPT');
    assert.equal(ledger.getConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY), null);
    assert.equal(ledger.countEvents(), countBefore);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a donor-valid future receipt time is rejected before CAS and cannot become a false post-commit failure', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const observedNow = Date.now();
    const futureAtMs = observedNow + 60 * 60 * 1_000;
    const prepared = prepareInitialMutationAppend(canonicalInput(
      8,
      'assessment:future-receipt-time',
      futureAtMs,
    ));
    const adapter = new LiveEdgeMutationJournalPersistenceAdapter(
      ledger,
      Object.freeze({ nowMs: () => observedNow }),
    );
    const acknowledgement = adapter.append(prepared.request);

    assert.equal(acknowledgement.disposition, 'FAILED');
    assert.equal(acknowledgement.failureCode, 'UNSAFE_APPEND_REQUEST');
    assert.equal(acknowledgement.appendedCount, 0);
    assert.equal(acknowledgement.ledgerEventId, null);
    assert.equal(ledger.getConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY), null);
    assert.equal(ledger.countEvents(), 0);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('adapter source has no network, exchange, signer, money, retry, or authority-granting dependency', () => {
  const source = readFileSync(
    path.resolve('server/src/systemIntegration/persistence/liveEdgeMutationJournalAdapter.ts'),
    'utf8',
  );
  for (const forbidden of [
    /\bfetch\s*\(/,
    /axios/,
    /WebSocket/,
    /from ['"].*services\//,
    /from ['"].*binance\//,
    /LIVE_EXECUTION_NOT_IMPLEMENTED\s*=\s*false/,
    /sendAuthorized:\s*true/,
    /externalActionAuthorization:\s*['"](?!NONE)/,
    /persistenceProven:\s*true/,
    /setTimeout|setInterval|Math\.random/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
  assert.match(source, /compareAndSetConfigValueAndLogEvents/);
  assert.match(source, /applyMutationAppendRequest\(prior, request\)/);
  assert.match(source, /confirmMutationAppend/);
  assert.match(source, /reconstructPersistedMutationJournal/);
});
