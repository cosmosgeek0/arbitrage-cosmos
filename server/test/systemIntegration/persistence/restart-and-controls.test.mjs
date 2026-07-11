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
  evaluateRestartBarrier,
  upsertDryRunExecutionReference,
  upsertReconciliationReference,
} from '../../../dist/systemIntegration/persistence/index.js';

const T0 = 1_800_000_000_000;

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-system-restart-'));
}

function trace(id, sequence, correlationId, occurredAtMs, kind = 'EXECUTION') {
  return {
    id, sequence, kind, componentId: kind === 'EXECUTION' ? 'execution-coordinator-validate-only' : 'reconciliation',
    correlationId, occurredAtMs, persistedAtMs: null, truthLabel: 'DRY_RUN', releaseStatuses: ['WIRED'],
    ownerId: null, canonicalProjectionId: null, revisionDigest: null, domainLifecycle: 'DRY_RUN',
    machinePhase: 'RUNNING', failure: null, referenceIds: [], lossCodes: [],
  };
}

test('restart barrier blocks before truth and through partial dry-run, then admits only reconciled truth', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    let adapter = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(adapter.load(T0, 'restart.empty').ok, true);
    assert.equal(adapter.persistStartup({ startedAtMs: T0 + 1, correlationId: 'restart.start' }).ok, true);
    let barrier = adapter.restartBarrier(T0 + 2);
    assert.equal(barrier.ok, true);
    assert.equal(barrier.value.canOpenOrIncrease, false);
    assert.ok(barrier.value.reasonCodes.includes('PUBLIC_SOURCE_TRUTH_UNKNOWN'));

    assert.equal(adapter.persistRestartTruth({
      publicSourceTruth: 'FRESH', accountTruth: 'FRESH', reconciliationTruth: 'FRESH', observedAtMs: T0 + 2,
    }, 'restart.truth').ok, true);
    barrier = adapter.restartBarrier(T0 + 3);
    assert.equal(barrier.ok, true);
    assert.equal(barrier.value.canOpenOrIncrease, true);

    const beforeExecution = adapter.currentState().value;
    const executionState = upsertDryRunExecutionReference(beforeExecution, {
      planId: 'plan-1', checkpointDigest: 'a'.repeat(32), serializedCheckpoint: '{}',
      domainLifecycle: 'PARTIALLY_APPLIED', dryRun: true, requiresReconciliation: true,
      correlationId: 'restart.partial', updatedAtMs: T0 + 4,
    });
    assert.equal(adapter.commitCheckpoint(executionState, {
      auditKind: 'TRANSITION', correlationId: 'restart.partial', occurredAtMs: T0 + 4,
      traceEvent: trace('dry-run.partial.1', executionState.revision, 'restart.partial', T0 + 4),
    }).ok, true);
    barrier = adapter.restartBarrier(T0 + 5);
    assert.equal(barrier.ok, true);
    assert.equal(barrier.value.canOpenOrIncrease, false);
    assert.deepEqual(barrier.value.reconciliationRequiredPlanIds, ['plan-1']);
    ledger.close();

    ledger = new Ledger(dataDir);
    adapter = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(adapter.load(T0 + 6, 'restart.reload').ok, true);
    barrier = adapter.restartBarrier(T0 + 6);
    assert.equal(barrier.ok, true);
    assert.equal(barrier.value.canOpenOrIncrease, false);
    assert.equal(barrier.value.supervisionContinues, true);

    let state = adapter.currentState().value;
    state = upsertReconciliationReference(state, {
      planId: 'plan-1', ownerRevision: 'reconciliation-1', domainStatus: 'DIVERGENT',
      allowsNewExposure: false, reasonCodes: ['ONE_LEG_ONLY'], correlationId: 'restart.reconcile.blocked',
      observedAtMs: T0 + 7,
    });
    assert.equal(adapter.commitCheckpoint(state, {
      auditKind: 'TRANSITION', correlationId: 'restart.reconcile.blocked', occurredAtMs: T0 + 7,
      traceEvent: trace('reconciliation.blocked.1', state.revision, 'restart.reconcile.blocked', T0 + 7, 'RECONCILIATION'),
    }).ok, true);
    assert.equal(adapter.restartBarrier(T0 + 8).value.canOpenOrIncrease, false);

    state = upsertReconciliationReference(adapter.currentState().value, {
      planId: 'plan-1', ownerRevision: 'reconciliation-2', domainStatus: 'CONSISTENT',
      allowsNewExposure: true, reasonCodes: [], correlationId: 'restart.reconcile.clear', observedAtMs: T0 + 9,
    });
    assert.equal(adapter.commitCheckpoint(state, {
      auditKind: 'TRANSITION', correlationId: 'restart.reconcile.clear', occurredAtMs: T0 + 9,
      traceEvent: trace('reconciliation.clear.1', state.revision, 'restart.reconcile.clear', T0 + 9, 'RECONCILIATION'),
    }).ok, true);
    assert.equal(adapter.restartBarrier(T0 + 10).value.canOpenOrIncrease, true);
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('clean shutdown is persisted once, seals writes, and reloads as restart evidence', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    let adapter = new SystemLedgerPersistenceAdapter(ledger);
    adapter.load(T0, 'shutdown.empty');
    adapter.persistStartup({ startedAtMs: T0 + 1, correlationId: 'shutdown.start' });
    const input = {
      stoppedAtMs: T0 + 2,
      correlationId: 'shutdown.final',
      clean: true,
      componentStates: [{ componentId: 'ledger-persistence', desiredState: 'STOPPED', generation: 1 }],
    };
    const first = adapter.persistFinalShutdown(input);
    const eventCount = ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length;
    const replay = adapter.persistFinalShutdown(input);
    assert.equal(first.ok, true);
    assert.equal(replay.ok, true);
    assert.deepEqual(replay.value, first.value);
    assert.equal(ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND).length, eventCount);
    const sealed = adapter.persistRestartTruth({
      publicSourceTruth: 'FRESH', accountTruth: 'FRESH', reconciliationTruth: 'FRESH', observedAtMs: T0 + 3,
    }, 'shutdown.after');
    assert.equal(sealed.ok, false);
    assert.equal(sealed.code, 'PERSISTENCE_SEALED');
    ledger.close();

    ledger = new Ledger(dataDir);
    adapter = new SystemLedgerPersistenceAdapter(ledger);
    const loaded = adapter.load(T0 + 4, 'shutdown.reload');
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.lastShutdown.clean, true);
    assert.equal(loaded.state.lastShutdown.correlationId, 'shutdown.final');
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('control commits replay exactly and rejection audit is atomic, idempotent, bounded, and redacted', async () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    let adapter = new SystemLedgerPersistenceAdapter(ledger);
    adapter.load(T0, 'control.empty');
    adapter.persistStartup({ startedAtMs: T0 + 1, correlationId: 'control.start' });
    const before = adapter.currentState().value.control;
    const request = {
      idempotencyKey: 'control.mode.0001', expectedRevision: before.revision,
      reason: 'Move to advisory observation', requestedAtMs: T0 + 2, correlationId: 'control.mode',
      mutation: { command: 'SET_SAFE_MODE', safeMode: 'ADVISORY' },
    };
    const after = { ...before, revision: before.revision + 1, safeMode: 'ADVISORY', updatedAtMs: T0 + 2, correlationId: 'control.mode' };
    const commit = { request, actor: { id: 'local-operator', email: null, source: 'loopback' }, requestDigest: 'a'.repeat(64), before, after, applied: true, code: 'CONTROL_APPLIED' };
    const first = await adapter.commitControlMutation(commit);
    assert.equal(first.kind, 'COMMITTED');
    assert.equal(first.receipt.after.safeMode, 'ADVISORY');
    assert.ok(Number.isSafeInteger(first.receipt.ledgerEventId));
    ledger.close();

    ledger = new Ledger(dataDir);
    adapter = new SystemLedgerPersistenceAdapter(ledger);
    adapter.load(T0 + 3, 'control.reload');
    const found = await adapter.findControlMutation(request.idempotencyKey);
    assert.equal(found.requestDigest, 'a'.repeat(64));
    assert.equal(found.receipt.after.safeMode, 'ADVISORY');
    const replay = await adapter.commitControlMutation(commit);
    assert.equal(replay.kind, 'IDEMPOTENT_REPLAY');

    const hostileMessage = 'authorization=Bearer fixture-super-secret-value';
    const rejection = {
      dedupeKey: 'control.reject.0001', idempotencyKey: null, requestDigest: 'b'.repeat(64),
      command: 'https://hostile.invalid/run', expectedRevision: null, currentRevision: 1,
      code: 'INVALID_CONTROL_REQUEST', message: hostileMessage, correlationId: 'control.reject',
      occurredAtMs: T0 + 4, actor: { id: 'local-operator', email: 'operator@example.com', source: 'loopback' },
      applied: false,
    };
    const recorded = await adapter.recordControlRejection(rejection);
    const rejectedReplay = await adapter.recordControlRejection(rejection);
    assert.equal(recorded.kind, 'RECORDED');
    assert.equal(rejectedReplay.kind, 'IDEMPOTENT_REPLAY');
    assert.equal(rejectedReplay.ledgerEventId, recorded.ledgerEventId);
    const checkpoint = ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY);
    const events = ledger.recentEvents(100, SYSTEM_PERSISTENCE_EVENT_KIND);
    assert.doesNotMatch(checkpoint, /fixture-super-secret|hostile\.invalid|operator@example/);
    assert.doesNotMatch(JSON.stringify(events), /fixture-super-secret|hostile\.invalid|operator@example/);
    const state = adapter.currentState().value;
    assert.equal(state.controlRejections.at(-1).command, null);
    assert.equal(state.controlRejections.at(-1).message, 'Control request rejected.');
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});
