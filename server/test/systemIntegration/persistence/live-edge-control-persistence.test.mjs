import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import {
  buildControlEvent,
  prepareControlEventAppend,
} from '../../../dist/liveEdge/controls/index.js';
import {
  LIVE_EDGE_CONTROL_EVENT_KIND,
  LiveEdgeControlPersistenceAdapter,
} from '../../../dist/systemIntegration/persistence/liveEdgeControlPersistenceAdapter.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  SYSTEM_PERSISTENCE_EVENT_KIND,
  SYSTEM_PERSISTENCE_LIMITS,
  SystemLedgerPersistenceAdapter,
  canonicalPersistenceJson,
  decodeSystemCheckpoint,
  encodeSystemCheckpoint,
  evaluateRestartBarrier,
  persistenceDigest,
} from '../../../dist/systemIntegration/persistence/index.js';
import { SystemControlService } from '../../../dist/systemIntegration/controls/index.js';
import { actions } from '../../liveEdge/controls/fixtures.mjs';

const CONFIG_VERSION = 11;

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-l14-control-persistence-'));
}

function commandId(seed) {
  return `cmd_${String(seed).padStart(16, '0').slice(-16)}`;
}

function bootstrap(ledger, nowMs) {
  const canonical = new SystemLedgerPersistenceAdapter(ledger);
  assert.equal(canonical.load(nowMs - 100, 'l14.bootstrap').ok, true);
  assert.equal(canonical.persistStartup({
    startedAtMs: nowMs - 90,
    correlationId: 'l14.bootstrap.start',
  }).ok, true);
  return canonical;
}

function reservationOwner(initialState) {
  return new SystemControlService({
    initialState,
    persistence: {
      async findControlMutation() { return null; },
      async recordControlRejection() { return { kind: 'RECORDED', ledgerEventId: 1 }; },
      async commitControlMutation() { throw new Error('not used by L14 reservation synchronization'); },
    },
    composition: {
      async inspectMutation() { throw new Error('not used by L14 reservation synchronization'); },
      async publishCommitted() { throw new Error('not used by L14 reservation synchronization'); },
    },
  });
}

function adapter(
  ledger,
  clock,
  version = CONFIG_VERSION,
  checkpointOwner = null,
  controlStateOwner = null,
) {
  const owner = checkpointOwner ?? new SystemLedgerPersistenceAdapter(ledger);
  const loaded = owner.load(clock.value, 'l14.adapter.owner');
  assert.equal(loaded.ok, true);
  const controlOwner = controlStateOwner ?? reservationOwner(loaded.state.control);
  return new LiveEdgeControlPersistenceAdapter({
    ledger,
    clock: { nowMs: () => clock.value },
    configurationVersion: { read: () => version },
    checkpointOwner: owner,
    controlStateOwner: controlOwner,
  });
}

function intentEvent({
  id,
  nowMs,
  expectedConfigVersion = CONFIG_VERSION,
  expectedControlRevision = 0,
  actor = `l14actor_${'b'.repeat(64)}`,
  action = actions.halt,
  expiresAtMs = nowMs + 60_000,
} = {}) {
  return buildControlEvent({
    schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
    version: 1,
    kind: 'CONTROL_INTENT_COMMITTED',
    commandId: id ?? commandId('1'),
    previewDigest: `sha256:${'a'.repeat(64)}`,
    actionType: action.type,
    actorBinding: actor,
    expectedConfigVersion,
    expectedControlRevision,
    occurredAtMs: nowMs,
    action,
    expiresAtMs,
    decisionCode: 'CONTROL_APPLIED',
    riskWitness: null,
    externalActionAuthorization: 'NONE',
  });
}

function appliedEvent(intent, nowMs, applied = true) {
  return buildControlEvent({
    schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
    version: 1,
    kind: 'CONTROL_APPLIED',
    commandId: intent.commandId,
    previewDigest: intent.previewDigest,
    actionType: intent.actionType,
    actorBinding: intent.actorBinding,
    expectedConfigVersion: intent.expectedConfigVersion,
    expectedControlRevision: intent.expectedControlRevision,
    occurredAtMs: nowMs,
    applied,
    reasonCode: applied ? 'CONTROL_APPLIED' : 'CONTROL_NOOP',
    recoveryStateChanged: false,
    externalActionAuthorization: 'NONE',
  });
}

function awarenessEvent(intent, nowMs, recoveryRevision = intent.action.observedRecoveryRevision) {
  return buildControlEvent({
    schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
    version: 1,
    kind: 'CONTROL_AWARENESS_RECORDED',
    commandId: intent.commandId,
    previewDigest: intent.previewDigest,
    actionType: intent.actionType,
    actorBinding: intent.actorBinding,
    expectedConfigVersion: intent.expectedConfigVersion,
    expectedControlRevision: intent.expectedControlRevision,
    occurredAtMs: nowMs,
    recoveryRevision,
    awarenessOnly: true,
    recoveryStateChanged: false,
    reasonCode: 'AWARENESS_RECORDED',
    externalActionAuthorization: 'NONE',
  });
}

function rejectedEvent(intent, nowMs, reasonCode, intentCommitted) {
  return buildControlEvent({
    schema: 'LIVE_EDGE_CONTROL_EVENT_V1',
    version: 1,
    kind: 'CONTROL_REJECTED',
    commandId: intent.commandId,
    previewDigest: intent.previewDigest,
    actionType: intent.actionType,
    actorBinding: intent.actorBinding,
    expectedConfigVersion: intent.expectedConfigVersion,
    expectedControlRevision: intent.expectedControlRevision,
    occurredAtMs: nowMs,
    reasonCode,
    redacted: true,
    intentCommitted,
    recoveryStateChanged: false,
    externalActionAuthorization: 'NONE',
  });
}

function countControlPairs(ledger) {
  return {
    control: ledger.recentEvents(2_000, LIVE_EDGE_CONTROL_EVENT_KIND).length,
    audit: ledger.recentEvents(2_000, SYSTEM_PERSISTENCE_EVENT_KIND).length,
  };
}

function storedControlEvent(request, checkpointRevision) {
  const preIntentAudit = request.event.kind === 'CONTROL_REJECTED' && request.event.intentCommitted === false;
  return {
    storageKey: `${preIntentAudit ? 'l14audit' : 'l14control'}:${request.idempotencyKey}`,
    storageKind: preIntentAudit ? 'PRE_INTENT_AUDIT' : 'JOURNAL',
    commandId: request.event.commandId,
    eventId: request.event.eventId,
    idempotencyKey: request.idempotencyKey,
    appendRequestDigest: request.appendRequestDigest,
    journalVersion: request.expectedJournalVersion + 1,
    previousHeadDigest: request.previousHeadDigest,
    headDigest: request.nextHeadDigest,
    event: request.event,
    occurredAtMs: request.event.occurredAtMs,
    checkpointRevision,
  };
}

test('intent reservation, ordinary SI transition, terminal append, and restart reconstruct one exact journal', async () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    const longLivedOwner = bootstrap(ledger, nowMs);
    const clock = { value: nowMs + 1 };
    const longLivedControl = reservationOwner(longLivedOwner.currentState().value.control);
    const persistence = adapter(ledger, clock, CONFIG_VERSION, longLivedOwner, longLivedControl);
    const intent = intentEvent({ id: commandId('101'), nowMs });
    const intentRequest = prepareControlEventAppend(intent, 0, null);
    const committed = await persistence.append(intentRequest);
    assert.equal(committed.disposition, 'COMMITTED_NEW');
    assert.equal(committed.currentControlRevision, 1);
    assert.equal(committed.currentConfigVersion, CONFIG_VERSION);
    assert.equal(longLivedOwner.currentState().value.control.revision, 1);
    assert.equal(longLivedOwner.currentState().value.liveEdgeControlEvents.length, 1);
    assert.equal(longLivedControl.snapshot().revision, 1);
    assert.deepEqual(await persistence.lookup(intent.commandId), {
      kind: 'PENDING',
      previewDigest: intent.previewDigest,
      actorBinding: intent.actorBinding,
      journalVersion: 1,
      headDigest: intentRequest.nextHeadDigest,
    });

    const ordinary = new SystemLedgerPersistenceAdapter(ledger);
    const loaded = ordinary.load(nowMs + 2, 'l14.ordinary.load');
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.liveEdgeControlEvents.length, 1);
    assert.equal(ordinary.persistRestartTruth({
      publicSourceTruth: 'UNKNOWN',
      accountTruth: 'UNAVAILABLE',
      reconciliationTruth: 'UNKNOWN',
      observedAtMs: nowMs + 2,
    }, 'l14.ordinary.transition').ok, true);

    const terminal = appliedEvent(intent, nowMs + 3);
    const terminalRequest = prepareControlEventAppend(terminal, 1, intentRequest.nextHeadDigest);
    clock.value = nowMs + 3;
    const terminalAck = await persistence.append(terminalRequest);
    assert.equal(terminalAck.disposition, 'COMMITTED_NEW');
    assert.equal(terminalAck.currentControlRevision, 1);
    const completed = await persistence.lookup(intent.commandId);
    assert.equal(completed.kind, 'COMPLETED');
    assert.equal(completed.receipt.committedControlRevision, 1);
    assert.equal(completed.receipt.recordedAtMs, terminalAck.committedAtMs);
    assert.deepEqual(completed.receipt.ledgerEventIds, [committed.ledgerEventId, terminalAck.ledgerEventId]);
    assert.deepEqual(countControlPairs(ledger), { control: 2, audit: 4 });

    const secondIntent = intentEvent({
      id: commandId('102'),
      nowMs: nowMs + 4,
      expectedControlRevision: 1,
    });
    clock.value = nowMs + 4;
    const secondIntentRequest = prepareControlEventAppend(secondIntent, 0, null);
    assert.equal((await persistence.append(secondIntentRequest)).disposition, 'COMMITTED_NEW');
    clock.value = nowMs + 5;
    const secondTerminal = appliedEvent(secondIntent, clock.value);
    assert.equal((await persistence.append(prepareControlEventAppend(
      secondTerminal,
      1,
      secondIntentRequest.nextHeadDigest,
    ))).disposition, 'COMMITTED_NEW');
    const historicalReplay = await persistence.append(intentRequest);
    assert.equal(historicalReplay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(historicalReplay.ledgerEventId, committed.ledgerEventId);
    assert.equal(longLivedOwner.currentState().value.control.revision, 2);
    assert.equal(longLivedControl.snapshot().revision, 2);

    ledger.close();
    ledger = new Ledger(dataDir);
    const restarted = adapter(ledger, clock);
    assert.deepEqual(await restarted.lookup(intent.commandId), completed);
    const decoded = decodeSystemCheckpoint(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.value.liveEdgeControlEvents.length, 4);
    assert.equal(decoded.value.control.revision, 2);
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('independent stale writer loses the global control revision race and appends zero rows', async () => {
  const dataDir = tempDataDir();
  const firstLedger = new Ledger(dataDir);
  const secondLedger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(firstLedger, nowMs);
    const staleSerialized = secondLedger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY);
    const stalePort = {
      getConfigValue: () => staleSerialized,
      compareAndSetConfigValueAndLogEvents: secondLedger.compareAndSetConfigValueAndLogEvents.bind(secondLedger),
      setConfigValueAndLogEvent: secondLedger.setConfigValueAndLogEvent.bind(secondLedger),
      recentEvents: secondLedger.recentEvents.bind(secondLedger),
    };
    const clock = { value: nowMs + 1 };
    const firstOwner = new SystemLedgerPersistenceAdapter(firstLedger);
    assert.equal(firstOwner.load(clock.value, 'l14.race.first').ok, true);
    const secondOwner = new SystemLedgerPersistenceAdapter(secondLedger);
    assert.equal(secondOwner.load(clock.value, 'l14.race.second').ok, true);
    const first = adapter(firstLedger, clock, CONFIG_VERSION, firstOwner);
    const stale = adapter(stalePort, clock, CONFIG_VERSION, secondOwner);
    const winner = prepareControlEventAppend(intentEvent({ id: commandId('201'), nowMs }), 0, null);
    const loser = prepareControlEventAppend(intentEvent({ id: commandId('202'), nowMs }), 0, null);
    assert.equal((await first.append(winner)).disposition, 'COMMITTED_NEW');
    const before = secondLedger.countEvents();
    const lost = await stale.append(loser);
    assert.equal(lost.disposition, 'VERSION_CONFLICT');
    assert.equal(lost.failureCode, 'STALE_CONTROL_REVISION');
    assert.equal(secondLedger.countEvents(), before);
    const decoded = decodeSystemCheckpoint(secondLedger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.equal(decoded.value.control.revision, 1);
    assert.equal(decoded.value.liveEdgeControlEvents.length, 1);
  } finally {
    firstLedger.close();
    secondLedger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('same command digest or actor conflict and config/control CAS conflicts write nothing', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    const clock = { value: nowMs + 1 };
    const persistence = adapter(ledger, clock);
    const intent = intentEvent({ id: commandId('301'), nowMs });
    const request = prepareControlEventAppend(intent, 0, null);
    assert.equal((await persistence.append(request)).disposition, 'COMMITTED_NEW');
    const count = ledger.countEvents();

    const foreignActor = intentEvent({
      id: intent.commandId,
      nowMs,
      actor: `l14actor_${'c'.repeat(64)}`,
    });
    const actorConflict = await persistence.append(prepareControlEventAppend(foreignActor, 0, null));
    assert.equal(actorConflict.disposition, 'IDEMPOTENCY_CONFLICT');
    assert.equal(ledger.countEvents(), count);

    const staleConfig = intentEvent({ id: commandId('302'), nowMs, expectedConfigVersion: 12, expectedControlRevision: 1 });
    const configConflict = await persistence.append(prepareControlEventAppend(staleConfig, 0, null));
    assert.equal(configConflict.disposition, 'VERSION_CONFLICT');
    assert.equal(configConflict.failureCode, 'STALE_CONFIG_VERSION');
    assert.equal(ledger.countEvents(), count);

    const staleControl = intentEvent({ id: commandId('303'), nowMs, expectedControlRevision: 0 });
    const controlConflict = await persistence.append(prepareControlEventAppend(staleControl, 0, null));
    assert.equal(controlConflict.disposition, 'VERSION_CONFLICT');
    assert.equal(controlConflict.failureCode, 'STALE_CONTROL_REVISION');
    assert.equal(ledger.countEvents(), count);

    const expired = intentEvent({ id: commandId('304'), nowMs, expectedControlRevision: 1 });
    clock.value = expired.expiresAtMs;
    const expiredAck = await persistence.append(prepareControlEventAppend(expired, 0, null));
    assert.equal(expiredAck.disposition, 'EXPIRED');
    assert.equal(expiredAck.failureCode, 'COMMAND_EXPIRED');
    assert.equal(ledger.countEvents(), count);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('future and post-deadline success events cannot create a false terminal result', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    const clock = { value: nowMs + 1 };
    const persistence = adapter(ledger, clock);
    const before = ledger.countEvents();
    const future = intentEvent({ id: commandId('351'), nowMs: clock.value + 1 });
    const futureAck = await persistence.append(prepareControlEventAppend(future, 0, null));
    assert.equal(futureAck.disposition, 'FAILED');
    assert.equal(futureAck.failureCode, 'PERSISTENCE_ACK_INVALID');
    assert.equal(ledger.countEvents(), before);

    const intentDeadline = Date.now() + 1_000;
    const deadlineIntent = intentEvent({
      id: commandId('350'),
      nowMs,
      expiresAtMs: intentDeadline,
    });
    const originalIntentNow = Date.now;
    clock.value = intentDeadline - 1;
    let deadlineIntentAck;
    try {
      Date.now = () => intentDeadline;
      deadlineIntentAck = await persistence.append(prepareControlEventAppend(deadlineIntent, 0, null));
    } finally {
      Date.now = originalIntentNow;
    }
    assert.equal(deadlineIntentAck.disposition, 'EXPIRED');
    assert.equal(deadlineIntentAck.failureCode, 'COMMAND_EXPIRED');
    assert.equal(ledger.countEvents(), before);
    assert.equal((await persistence.lookup(deadlineIntent.commandId)).kind, 'NOT_FOUND');
    clock.value = nowMs + 1;

    const intent = intentEvent({
      id: commandId('352'),
      nowMs,
      expiresAtMs: Date.now() + 80,
    });
    const intentRequest = prepareControlEventAppend(intent, 0, null);
    assert.equal((await persistence.append(intentRequest)).disposition, 'COMMITTED_NEW');
    const afterIntent = ledger.countEvents();
    clock.value = intent.expiresAtMs;
    const late = appliedEvent(intent, intent.expiresAtMs);
    const lateAck = await persistence.append(prepareControlEventAppend(late, 1, intentRequest.nextHeadDigest));
    assert.equal(lateAck.disposition, 'EXPIRED');
    assert.equal(lateAck.failureCode, 'COMMAND_EXPIRED');
    assert.equal(ledger.countEvents(), afterIntent);
    assert.equal((await persistence.lookup(intent.commandId)).kind, 'PENDING');

    const competingIntent = intentEvent({ id: commandId('354'), nowMs, expectedControlRevision: 1 });
    const competing = await persistence.append(prepareControlEventAppend(competingIntent, 0, null));
    assert.equal(competing.disposition, 'FAILED');
    assert.equal(competing.failureCode, 'COMMAND_IN_PROGRESS');
    assert.equal(ledger.countEvents(), afterIntent);

    clock.value = intent.expiresAtMs + 1;
    const expiryRejection = rejectedEvent(intent, clock.value, 'COMMAND_EXPIRED', true);
    const originalRejectionNow = Date.now;
    let expiryRejectionAck;
    try {
      Date.now = () => clock.value;
      expiryRejectionAck = await persistence.append(prepareControlEventAppend(
        expiryRejection,
        1,
        intentRequest.nextHeadDigest,
      ));
    } finally {
      Date.now = originalRejectionNow;
    }
    assert.equal(expiryRejectionAck.disposition, 'COMMITTED_NEW');

    const raceOccurredAtMs = Date.now();
    const commitRaceIntent = intentEvent({
      id: commandId('353'),
      nowMs: raceOccurredAtMs,
      expectedControlRevision: 1,
      expiresAtMs: raceOccurredAtMs + 80,
    });
    clock.value = raceOccurredAtMs + 1;
    const raceIntentRequest = prepareControlEventAppend(commitRaceIntent, 0, null);
    assert.equal((await persistence.append(raceIntentRequest)).disposition, 'COMMITTED_NEW');
    const preDeadlineTerminal = appliedEvent(commitRaceIntent, commitRaceIntent.expiresAtMs - 1);
    clock.value = commitRaceIntent.expiresAtMs - 1;
    const beforeDeadlineRefusal = ledger.countEvents();
    const originalNow = Date.now;
    let crossed;
    try {
      Date.now = () => commitRaceIntent.expiresAtMs;
      crossed = await persistence.append(prepareControlEventAppend(
        preDeadlineTerminal,
        1,
        raceIntentRequest.nextHeadDigest,
      ));
    } finally {
      Date.now = originalNow;
    }
    assert.equal(crossed.disposition, 'EXPIRED');
    assert.equal(crossed.failureCode, 'COMMAND_EXPIRED');
    assert.equal(ledger.countEvents(), beforeDeadlineRefusal);
    assert.equal((await persistence.lookup(commitRaceIntent.commandId)).kind, 'PENDING');
    const afterRefusal = decodeSystemCheckpoint(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.equal(afterRefusal.ok, true);
    assert.equal(afterRefusal.value.liveEdgeControlEvents.filter(
      (entry) => entry.commandId === commitRaceIntent.commandId,
    ).length, 1);
    assert.ok(evaluateRestartBarrier(afterRefusal.value, clock.value).reasonCodes.includes(
      'PENDING_LIVE_EDGE_CONTROL_INTENT',
    ));
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('crash before CAS writes nothing while crash after intent restarts as PENDING', async () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    const durableOwner = bootstrap(ledger, nowMs);
    assert.equal(durableOwner.persistRestartTruth({
      publicSourceTruth: 'FRESH',
      accountTruth: 'FRESH',
      reconciliationTruth: 'FRESH',
      observedAtMs: nowMs,
    }, 'l14.pending.truth').ok, true);
    const clock = { value: nowMs + 1 };
    const failingPort = {
      getConfigValue: ledger.getConfigValue.bind(ledger),
      compareAndSetConfigValueAndLogEvents() { throw new Error('injected pre-commit crash'); },
      setConfigValueAndLogEvent: ledger.setConfigValueAndLogEvent.bind(ledger),
      recentEvents: ledger.recentEvents.bind(ledger),
    };
    const beforeCheckpoint = ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY);
    const beforeCount = ledger.countEvents();
    const firstIntent = intentEvent({ id: commandId('401'), nowMs });
    const failed = await adapter(failingPort, clock).append(prepareControlEventAppend(firstIntent, 0, null));
    assert.equal(failed.disposition, 'FAILED');
    assert.equal(failed.failureCode, 'PERSISTENCE_UNAVAILABLE');
    assert.equal(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY), beforeCheckpoint);
    assert.equal(ledger.countEvents(), beforeCount);

    const durable = adapter(ledger, clock);
    const pendingIntent = intentEvent({ id: commandId('402'), nowMs });
    assert.equal((await durable.append(prepareControlEventAppend(pendingIntent, 0, null))).disposition, 'COMMITTED_NEW');
    ledger.close();
    ledger = new Ledger(dataDir);
    assert.equal((await adapter(ledger, clock).lookup(pendingIntent.commandId)).kind, 'PENDING');
    assert.equal((await adapter(ledger, clock, null).lookup(pendingIntent.commandId)).kind, 'PENDING');
    const restartedOwner = new SystemLedgerPersistenceAdapter(ledger);
    const restarted = restartedOwner.load(nowMs + 2, 'l14.pending.restart');
    assert.equal(restarted.ok, true);
    assert.equal(restarted.barrier.canOpenOrIncrease, false);
    assert.ok(restarted.barrier.reasonCodes.includes('PENDING_LIVE_EDGE_CONTROL_INTENT'));
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('post-commit listener failure replays exact append without a second publication', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    ledger.on('event', () => { throw new Error('injected listener failure'); });
    const clock = { value: nowMs + 1 };
    const persistence = adapter(ledger, clock);
    const request = prepareControlEventAppend(intentEvent({ id: commandId('501'), nowMs }), 0, null);
    const first = await persistence.append(request);
    assert.equal(first.disposition, 'COMMITTED_NEW');
    const count = ledger.countEvents();
    const replay = await persistence.append(request);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(replay.ledgerEventId, first.ledgerEventId);
    assert.equal(ledger.countEvents(), count);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('pre-intent rejection audit cannot reserve or poison the authentic command ID', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    const clock = { value: nowMs + 1 };
    const persistence = adapter(ledger, clock);
    const intent = intentEvent({ id: commandId('601'), nowMs });
    const securityAudit = rejectedEvent(intent, nowMs, 'LIVE_EXECUTION_NOT_IMPLEMENTED', false);
    const securityAck = await persistence.append(prepareControlEventAppend(securityAudit, 0, null));
    assert.equal(securityAck.disposition, 'COMMITTED_NEW');
    assert.equal(securityAck.currentControlRevision, 0);
    assert.equal((await persistence.lookup(intent.commandId)).kind, 'NOT_FOUND');

    const intentRequest = prepareControlEventAppend(intent, 0, null);
    const intentAck = await persistence.append(intentRequest);
    assert.equal(intentAck.disposition, 'COMMITTED_NEW');
    const terminal = rejectedEvent(intent, nowMs + 2, 'OWNER_REJECTED', true);
    clock.value = nowMs + 2;
    const terminalAck = await persistence.append(prepareControlEventAppend(terminal, 1, intentRequest.nextHeadDigest));
    assert.equal(terminalAck.disposition, 'COMMITTED_NEW');
    const lookup = await persistence.lookup(intent.commandId);
    assert.equal(lookup.kind, 'REJECTED');
    assert.equal(lookup.rejection.reasonCode, 'OWNER_REJECTED');
    assert.deepEqual(lookup.rejection.ledgerEventIds, [intentAck.ledgerEventId, terminalAck.ledgerEventId]);
    const decoded = decodeSystemCheckpoint(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.deepEqual(decoded.value.liveEdgeControlEvents.map((entry) => entry.storageKind), [
      'PRE_INTENT_AUDIT', 'JOURNAL', 'JOURNAL',
    ]);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('awareness terminal binds the exact recovery revision and replays after restart', async () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    const clock = { value: nowMs + 1 };
    const persistence = adapter(ledger, clock);
    const intent = intentEvent({ id: commandId('651'), nowMs, action: actions.acknowledge });
    const intentRequest = prepareControlEventAppend(intent, 0, null);
    assert.equal((await persistence.append(intentRequest)).disposition, 'COMMITTED_NEW');
    const beforeMismatch = ledger.countEvents();
    const mismatch = awarenessEvent(intent, nowMs + 2, 'foreign.recovery.revision');
    clock.value = nowMs + 2;
    const mismatchAck = await persistence.append(prepareControlEventAppend(mismatch, 1, intentRequest.nextHeadDigest));
    assert.equal(mismatchAck.disposition, 'IDEMPOTENCY_CONFLICT');
    assert.equal(ledger.countEvents(), beforeMismatch);

    const awareness = awarenessEvent(intent, nowMs + 3);
    clock.value = nowMs + 3;
    const awarenessAck = await persistence.append(prepareControlEventAppend(awareness, 1, intentRequest.nextHeadDigest));
    assert.equal(awarenessAck.disposition, 'COMMITTED_NEW');
    const completed = await persistence.lookup(intent.commandId);
    assert.equal(completed.kind, 'COMPLETED');
    assert.equal(completed.receipt.disposition, 'AWARENESS_RECORDED');
    assert.equal(completed.receipt.recoveryStateChanged, false);
    assert.equal(completed.receipt.recordedAtMs, awarenessAck.committedAtMs);
    ledger.close();
    ledger = new Ledger(dataDir);
    assert.deepEqual(await adapter(ledger, clock).lookup(intent.commandId), completed);
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('audit-row failure rolls back checkpoint and dedicated event as one atomic pair', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    const beforeCheckpoint = ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY);
    const beforeCount = ledger.countEvents();
    ledger.db.exec(`
      CREATE TRIGGER reject_l14_canonical_audit
      BEFORE INSERT ON events
      WHEN NEW.kind = '${SYSTEM_PERSISTENCE_EVENT_KIND}' AND NEW.symbol LIKE 'cmd_%'
      BEGIN SELECT RAISE(ABORT, 'L14 audit rejected'); END;
    `);
    const clock = { value: nowMs + 1 };
    const request = prepareControlEventAppend(intentEvent({ id: commandId('701'), nowMs }), 0, null);
    const failed = await adapter(ledger, clock).append(request);
    assert.equal(failed.disposition, 'FAILED');
    assert.equal(failed.failureCode, 'PERSISTENCE_UNAVAILABLE');
    ledger.db.exec('DROP TRIGGER reject_l14_canonical_audit');
    assert.equal(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY), beforeCheckpoint);
    assert.equal(ledger.countEvents(), beforeCount);
    assert.equal(ledger.recentEvents(100, LIVE_EDGE_CONTROL_EVENT_KIND).length, 0);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lookup refuses a missing or checksum-mismatched atomic audit companion', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    const clock = { value: nowMs + 1 };
    const persistence = adapter(ledger, clock);
    const intent = intentEvent({ id: commandId('751'), nowMs });
    const intentRequest = prepareControlEventAppend(intent, 0, null);
    assert.equal((await persistence.append(intentRequest)).disposition, 'COMMITTED_NEW');
    clock.value = nowMs + 2;
    const terminal = appliedEvent(intent, clock.value);
    const terminalAck = await persistence.append(prepareControlEventAppend(
      terminal,
      1,
      intentRequest.nextHeadDigest,
    ));
    assert.equal(terminalAck.disposition, 'COMMITTED_NEW');
    assert.equal((await persistence.lookup(intent.commandId)).kind, 'COMPLETED');

    const auditId = terminalAck.ledgerEventId + 1;
    const auditRow = ledger.db.prepare('SELECT data FROM events WHERE id = ?').get(auditId);
    assert.equal(typeof auditRow.data, 'string');
    const mismatched = JSON.parse(auditRow.data);
    mismatched.checkpointChecksum = 'f'.repeat(64);
    ledger.db.prepare('UPDATE events SET data = ? WHERE id = ?').run(JSON.stringify(mismatched), auditId);
    await assert.rejects(persistence.lookup(intent.commandId), /audit companion/);

    ledger.db.prepare('UPDATE events SET data = ? WHERE id = ?').run(auditRow.data, auditId);
    assert.equal((await persistence.lookup(intent.commandId)).kind, 'COMPLETED');
    ledger.db.prepare('DELETE FROM events WHERE id = ?').run(auditId);
    await assert.rejects(persistence.lookup(intent.commandId), /audit companion/);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('full journal and checkpoint byte capacity return exact FAILED acknowledgements with zero writes', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    const initialBytes = ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY);
    const decoded = decodeSystemCheckpoint(initialBytes);
    assert.equal(decoded.ok, true);

    const fullRows = [];
    for (let index = 0; index < SYSTEM_PERSISTENCE_LIMITS.maximumLiveEdgeControlEvents; index += 1) {
      const intent = intentEvent({ id: commandId(index.toString(16)), nowMs });
      const audit = rejectedEvent(intent, nowMs, 'LIVE_EXECUTION_NOT_IMPLEMENTED', false);
      fullRows.push(storedControlEvent(
        prepareControlEventAppend(audit, 0, null),
        decoded.value.revision,
      ));
    }
    const fullBytes = encodeSystemCheckpoint({
      ...decoded.value,
      liveEdgeControlEvents: fullRows,
    });
    ledger.setConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, fullBytes);
    const beforeFullCount = ledger.countEvents();
    const fullRequest = prepareControlEventAppend(
      intentEvent({ id: commandId('fff1'), nowMs }),
      0,
      null,
    );
    const full = await adapter(ledger, { value: nowMs + 1 }).append(fullRequest);
    assert.equal(full.disposition, 'FAILED');
    assert.equal(full.failureCode, 'PERSISTENCE_UNAVAILABLE');
    assert.equal(full.appendedCount, 0);
    assert.equal(full.ledgerEventId, null);
    assert.equal(ledger.countEvents(), beforeFullCount);
    assert.equal(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY), fullBytes);

    const paddingEntry = (index, padding) => ({
      idempotencyKey: `capacity.padding.${String(index).padStart(4, '0')}`,
      requestDigest: 'e'.repeat(64),
      correlationId: `capacity.padding.${index}`,
      recordedAtMs: nowMs,
      checkpointRevision: decoded.value.revision,
      receipt: { kind: 'CAPACITY_PADDING', padding },
    });
    const fixedPadding = Array.from({ length: 7 }, (_, index) => paddingEntry(index, 'x'.repeat(64 * 1_024)));
    const reserveIntent = intentEvent({ id: commandId('fff2'), nowMs });
    const reserveRequest = prepareControlEventAppend(reserveIntent, 0, null);
    const reserveRevision = decoded.value.revision + 1;
    const intentOnlyState = (baseState) => ({
      ...baseState,
      revision: reserveRevision,
      control: {
        ...baseState.control,
        revision: baseState.control.revision + 1,
        updatedAtMs: reserveIntent.occurredAtMs,
        correlationId: `l14.${reserveIntent.commandId}`,
      },
      liveEdgeControlEvents: [storedControlEvent(reserveRequest, reserveRevision)],
    });
    let low = 0;
    let high = 64 * 1_024;
    let reserveBaseBytes = null;
    let reserveIntentOnlyBytes = null;
    let reserveIntentOnlyState = null;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      try {
        const baseState = {
          ...decoded.value,
          idempotencyReceipts: [...fixedPadding, paddingEntry(7, 'x'.repeat(middle))],
        };
        const baseBytes = encodeSystemCheckpoint(baseState);
        const candidateState = intentOnlyState(baseState);
        const candidateBytes = encodeSystemCheckpoint(candidateState);
        reserveBaseBytes = baseBytes;
        reserveIntentOnlyBytes = candidateBytes;
        reserveIntentOnlyState = candidateState;
        low = middle + 1;
      } catch {
        high = middle - 1;
      }
    }
    assert.ok(reserveBaseBytes);
    assert.ok(reserveIntentOnlyBytes);
    assert.ok(reserveIntentOnlyState);
    assert.ok(Buffer.byteLength(reserveIntentOnlyBytes, 'utf8') > 511 * 1_024);
    const terminal = rejectedEvent(
      reserveIntent,
      4_102_444_800_000,
      'CONFIGURATION_OWNER_NOT_WIRED',
      true,
    );
    const terminalRequest = prepareControlEventAppend(terminal, 1, reserveRequest.nextHeadDigest);
    assert.throws(() => encodeSystemCheckpoint({
      ...reserveIntentOnlyState,
      revision: reserveRevision + 1,
      liveEdgeControlEvents: [
        ...reserveIntentOnlyState.liveEdgeControlEvents,
        storedControlEvent(terminalRequest, reserveRevision + 1),
      ],
    }), /CHECKPOINT_BYTE_LIMIT_EXCEEDED/);

    ledger.setConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, reserveBaseBytes);
    const beforeByteCount = ledger.countEvents();
    const byteBound = await adapter(ledger, { value: nowMs + 1 }).append(reserveRequest);
    assert.equal(byteBound.disposition, 'FAILED');
    assert.equal(byteBound.failureCode, 'PERSISTENCE_UNAVAILABLE');
    assert.equal(byteBound.appendedCount, 0);
    assert.equal(byteBound.ledgerEventId, null);
    assert.equal(ledger.countEvents(), beforeByteCount);
    assert.equal(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY), reserveBaseBytes);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('closed validation, secret policy, capacity, corrupt restart, and missing config version fail closed', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    const clock = { value: nowMs + 1 };
    const persistence = adapter(ledger, clock);
    const intent = intentEvent({ id: commandId('801'), nowMs });
    const request = prepareControlEventAppend(intent, 0, null);
    const beforeCount = ledger.countEvents();
    await assert.rejects(
      persistence.append({ ...request, event: { ...request.event, apiSecret: 'fixture-secret-material-123456789' } }),
      /missing or unknown fields/,
    );
    assert.equal(ledger.countEvents(), beforeCount);
    await assert.rejects(adapter(ledger, clock, null).append(request), /NOT_CONFIGURED/);
    assert.equal(ledger.countEvents(), beforeCount);

    assert.equal((await persistence.append(request)).disposition, 'COMMITTED_NEW');
    const decoded = decodeSystemCheckpoint(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    const row = decoded.value.liveEdgeControlEvents[0];
    assert.throws(() => encodeSystemCheckpoint({
      ...decoded.value,
      liveEdgeControlEvents: Array.from({ length: SYSTEM_PERSISTENCE_LIMITS.maximumLiveEdgeControlEvents + 1 }, () => row),
    }), /COUNT_LIMIT_EXCEEDED|invalid/);
    assert.throws(() => encodeSystemCheckpoint({
      ...decoded.value,
      liveEdgeControlEvents: [{
        ...row,
        event: { ...row.event, externalActionAuthorization: 'fixture-secret-token-123456789' },
      }],
    }), /SECRET_FIELD_FORBIDDEN|invalid/);

    const semanticallyCorrupt = JSON.parse(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    semanticallyCorrupt.state.liveEdgeControlEvents[0].event.contentDigest = `sha256:${'f'.repeat(64)}`;
    semanticallyCorrupt.checksum = persistenceDigest({
      schema: semanticallyCorrupt.schema,
      version: semanticallyCorrupt.version,
      state: semanticallyCorrupt.state,
    });
    const corruptButChecksummed = canonicalPersistenceJson(semanticallyCorrupt);
    assert.equal(decodeSystemCheckpoint(corruptButChecksummed).ok, false);
    ledger.setConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, corruptButChecksummed);
    const ordinary = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(ordinary.load(nowMs + 2, 'l14.corrupt.semantic').ok, false);

    ledger.setConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, '{"corrupt":true}');
    await assert.rejects(persistence.lookup(intent.commandId), /checkpoint is corrupt/);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('L14 reservation defeats a stale legacy control writer without double advance', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    const staleLegacy = bootstrap(ledger, nowMs);
    const before = staleLegacy.currentState().value.control;
    const clock = { value: nowMs + 1 };
    const persistence = adapter(ledger, clock);
    const intent = intentEvent({ id: commandId('901'), nowMs });
    assert.equal((await persistence.append(prepareControlEventAppend(intent, 0, null))).disposition, 'COMMITTED_NEW');
    const count = ledger.countEvents();
    const legacyRequest = {
      idempotencyKey: 'legacy.control.bypass.0001',
      expectedRevision: before.revision,
      reason: 'Attempt stale legacy bypass',
      requestedAtMs: nowMs + 2,
      correlationId: 'legacy.control.bypass',
      mutation: { command: 'SET_SAFE_MODE', safeMode: 'ADVISORY' },
    };
    await assert.rejects(staleLegacy.commitControlMutation({
      request: legacyRequest,
      actor: { id: 'local-operator', email: null, source: 'loopback' },
      requestDigest: 'd'.repeat(64),
      before,
      after: {
        ...before,
        revision: before.revision + 1,
        safeMode: 'ADVISORY',
        updatedAtMs: nowMs + 2,
        correlationId: 'legacy.control.bypass',
      },
      applied: true,
      code: 'CONTROL_APPLIED',
    }), /CHECKPOINT_REVISION_CONFLICT/);
    assert.equal(ledger.countEvents(), count);
    const decoded = decodeSystemCheckpoint(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.equal(decoded.value.control.revision, 1);
    assert.equal(decoded.value.control.safeMode, 'READ_ONLY');
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('reservation synchronization is required, durability-first, drift-proof, and retryable', async () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    const checkpointOwner = bootstrap(ledger, nowMs);
    const initialControl = checkpointOwner.currentState().value.control;
    const clock = { value: nowMs + 1 };
    const dependencies = {
      ledger,
      clock: { nowMs: () => clock.value },
      configurationVersion: { read: () => CONFIG_VERSION },
      checkpointOwner,
    };
    assert.throws(
      () => new LiveEdgeControlPersistenceAdapter(dependencies),
      /reservation-only control-state owner/,
    );

    const driftOwner = reservationOwner(initialControl);
    assert.equal(driftOwner.synchronizeReservedRevision({
      ...initialControl,
      revision: initialControl.revision + 1,
      safeMode: 'ADVISORY',
      updatedAtMs: initialControl.updatedAtMs + 1,
      correlationId: `l14.${commandId('951')}`,
    }), false);
    assert.deepEqual(driftOwner.snapshot(), initialControl);

    let synchronizationCalls = 0;
    let sawDurableReloadBeforeSynchronization = false;
    const rejectingControlOwner = {
      synchronizeReservedRevision(state) {
        synchronizationCalls += 1;
        const durable = checkpointOwner.currentState();
        sawDurableReloadBeforeSynchronization = durable.ok
          && durable.value.control.revision === state.revision
          && durable.value.liveEdgeControlEvents.length === 1;
        return false;
      },
    };
    const persistence = new LiveEdgeControlPersistenceAdapter({
      ...dependencies,
      controlStateOwner: rejectingControlOwner,
    });
    const intent = intentEvent({ id: commandId('952'), nowMs });
    const request = prepareControlEventAppend(intent, 0, null);
    const failed = await persistence.append(request);
    assert.equal(failed.disposition, 'FAILED');
    assert.equal(failed.failureCode, 'PERSISTENCE_UNAVAILABLE');
    assert.equal(synchronizationCalls, 1);
    assert.equal(sawDurableReloadBeforeSynchronization, true);
    assert.equal((await persistence.lookup(intent.commandId)).kind, 'PENDING');
    const afterFailureCount = ledger.countEvents();

    const acceptingControlOwner = reservationOwner(initialControl);
    const retry = new LiveEdgeControlPersistenceAdapter({
      ...dependencies,
      controlStateOwner: acceptingControlOwner,
    });
    const replay = await retry.append(request);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(acceptingControlOwner.snapshot().revision, 1);
    assert.equal(ledger.countEvents(), afterFailureCount);
    assert.ok(checkpointOwner.load(nowMs + 2, 'l14.sync.restart').barrier.reasonCodes.includes(
      'PENDING_LIVE_EDGE_CONTROL_INTENT',
    ));
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('legacy checkpoint migrates in memory and the adapter imports no exchange, Product, or money authority', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nowMs = Date.now() - 5_000;
    bootstrap(ledger, nowMs);
    const current = JSON.parse(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    delete current.state.liveEdgeControlEvents;
    current.checksum = persistenceDigest({ schema: current.schema, version: current.version, state: current.state });
    const legacyBytes = canonicalPersistenceJson(current);
    ledger.setConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY, legacyBytes);
    const migrated = decodeSystemCheckpoint(legacyBytes);
    assert.equal(migrated.ok, true);
    assert.deepEqual(migrated.value.liveEdgeControlEvents, []);
    const ordinary = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(ordinary.load(nowMs + 1, 'legacy.migration.load').ok, true);
    assert.equal(ordinary.persistRestartTruth({
      publicSourceTruth: 'UNKNOWN', accountTruth: 'UNAVAILABLE', reconciliationTruth: 'UNKNOWN', observedAtMs: nowMs + 1,
    }, 'legacy.migration.transition').ok, true);
    const upgraded = JSON.parse(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.deepEqual(upgraded.state.liveEdgeControlEvents, []);

    const source = readFileSync(new URL('../../../src/systemIntegration/persistence/liveEdgeControlPersistenceAdapter.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Binance|exchangeClient|product_commands|commandOwner|signedRequest|borrow|repay|AWS/i);
    assert.match(source, /externalActionAuthorization: 'NONE'/);
    assert.doesNotMatch(source, /LIVE_EXECUTION_NOT_IMPLEMENTED\s*=/);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
