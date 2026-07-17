import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  SYSTEM_PERSISTENCE_EVENT_KIND,
  SYSTEM_PERSISTENCE_LIMITS,
  SystemLedgerPersistenceAdapter,
  decodeSystemCheckpoint,
  encodeSystemCheckpoint,
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

test('restart barrier fails closed when the canonical Product identity reader is unavailable', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const canonical = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(canonical.load(T0, 'restart.identity-reader.load').ok, true);
    assert.equal(canonical.persistStartup({
      startedAtMs: T0 + 1,
      correlationId: 'restart.identity-reader.start',
    }).ok, true);
    assert.equal(canonical.persistRestartTruth({
      publicSourceTruth: 'FRESH',
      accountTruth: 'FRESH',
      reconciliationTruth: 'FRESH',
      observedAtMs: T0 + 2,
    }, 'restart.identity-reader.truth').ok, true);
    assert.equal(canonical.restartBarrier(T0 + 3).value.canOpenOrIncrease, true);

    const missingReaderPort = new Proxy(ledger, {
      get(target, property) {
        if (property === 'readProductBlockingIdentityReferences') return undefined;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const restarted = new SystemLedgerPersistenceAdapter(missingReaderPort);
    const loaded = restarted.load(T0 + 3, 'restart.identity-reader.reload');
    assert.equal(loaded.ok, true);
    assert.equal(loaded.source, 'CHECKPOINT');
    assert.equal(loaded.barrier.canOpenOrIncrease, false);
    assert.ok(loaded.barrier.reasonCodes.includes('PRODUCT_IDENTITY_REFERENCE_READ_UNAVAILABLE'));
    const barrier = restarted.restartBarrier(T0 + 3);
    assert.equal(barrier.ok, true);
    assert.equal(barrier.value.canOpenOrIncrease, false);
    assert.equal(barrier.value.supervisionContinues, true);
    assert.ok(barrier.value.reasonCodes.includes('PRODUCT_IDENTITY_REFERENCE_READ_UNAVAILABLE'));
  } finally {
    ledger.close();
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

test('unclean shutdown evidence remains writable until a later clean checkpoint seals it', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const adapter = new SystemLedgerPersistenceAdapter(ledger);
    adapter.load(T0, 'shutdown.recovery.empty');
    adapter.persistStartup({ startedAtMs: T0 + 1, correlationId: 'shutdown.recovery.start' });
    const componentStates = [
      { componentId: 'ledger-persistence', desiredState: 'STOPPED', generation: 1 },
    ];
    const unclean = adapter.persistFinalShutdown({
      stoppedAtMs: T0 + 2,
      correlationId: 'shutdown.recovery.unclean',
      clean: false,
      componentStates,
    });
    assert.equal(unclean.ok, true);
    assert.equal(adapter.currentState().value.lastShutdown.clean, false);
    assert.equal(adapter.persistRestartTruth({
      publicSourceTruth: 'FRESH', accountTruth: 'FRESH', reconciliationTruth: 'FRESH', observedAtMs: T0 + 3,
    }, 'shutdown.recovery.repaired-truth').ok, true);

    const clean = adapter.persistFinalShutdown({
      stoppedAtMs: T0 + 4,
      correlationId: 'shutdown.recovery.clean',
      clean: true,
      componentStates,
    });
    assert.equal(clean.ok, true);
    assert.notEqual(clean.value.checkpointRevision, unclean.value.checkpointRevision);
    assert.equal(adapter.currentState().value.lastShutdown.clean, true);
    assert.equal(adapter.currentState().value.lastShutdown.correlationId, 'shutdown.recovery.clean');
    const sealed = adapter.persistRestartTruth({
      publicSourceTruth: 'FRESH', accountTruth: 'FRESH', reconciliationTruth: 'FRESH', observedAtMs: T0 + 5,
    }, 'shutdown.recovery.after-clean');
    assert.equal(sealed.ok, false);
    assert.equal(sealed.code, 'PERSISTENCE_SEALED');
  } finally {
    ledger.close();
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

    const restartBefore = state.control;
    const restartRequest = {
      idempotencyKey: 'control.restart.0001', expectedRevision: restartBefore.revision,
      reason: 'Restart the managed dependency root', requestedAtMs: T0 + 5, correlationId: 'control.restart',
      mutation: { command: 'RESTART_COMPONENT', componentId: 'market-universe' },
    };
    const restartAfter = {
      ...restartBefore,
      revision: restartBefore.revision + 1,
      generation: restartBefore.generation + 1,
      updatedAtMs: T0 + 5,
      correlationId: 'control.restart',
    };
    const restartDigest = 'c'.repeat(64);
    const restartCommit = {
      request: restartRequest,
      actor: { id: 'local-operator', email: null, source: 'loopback' },
      requestDigest: restartDigest,
      before: restartBefore,
      after: restartAfter,
      applied: true,
      code: 'MANAGED_RUNTIME_RESTART_ACCEPTED',
    };
    const restartCommitted = await adapter.commitControlMutation(restartCommit);
    assert.equal(restartCommitted.kind, 'COMMITTED');
    assert.equal(restartCommitted.runtimePublication, 'PENDING');
    assert.equal(adapter.readPendingControlRuntimePublications().value[0].state, 'PENDING');
    assert.ok(adapter.restartBarrier(T0 + 6).value.reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'));
    ledger.close();

    ledger = new Ledger(dataDir);
    adapter = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(adapter.load(T0 + 6, 'control.restart.reload').ok, true);
    const pendingRestart = await adapter.findControlMutation(restartRequest.idempotencyKey);
    assert.equal(pendingRestart.runtimePublication, 'PENDING');
    const marked = await adapter.markControlRuntimePublished({
      idempotencyKey: restartRequest.idempotencyKey,
      requestDigest: restartDigest,
      correlationId: restartAfter.correlationId,
      occurredAtMs: restartAfter.updatedAtMs,
    });
    assert.equal(marked.kind, 'PUBLISHED');
    assert.equal((await adapter.findControlMutation(restartRequest.idempotencyKey)).runtimePublication, 'PUBLISHED');
    assert.deepEqual(adapter.readPendingControlRuntimePublications().value, []);
    assert.equal(adapter.restartBarrier(T0 + 6).value.reasonCodes.includes('CONTROL_COMMITTED_RUNTIME_PENDING'), false);
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('terminal control idempotency evidence rolls over without losing exact lifetime replay', async () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    let adapter = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(adapter.load(T0, 'control.capacity.empty').ok, true);
    assert.equal(adapter.persistStartup({
      startedAtMs: T0 + 1,
      correlationId: 'control.capacity.start',
    }).ok, true);

    const pendingBefore = adapter.currentState().value.control;
    const pendingAfter = {
      ...pendingBefore,
      revision: pendingBefore.revision + 1,
      generation: pendingBefore.generation + 1,
      updatedAtMs: T0 + 2,
      correlationId: 'control.capacity.pending',
    };
    const pendingCommit = {
      request: {
        idempotencyKey: 'control.capacity.pending.0000',
        expectedRevision: pendingBefore.revision,
        reason: 'Keep unresolved runtime publication evidence resident',
        requestedAtMs: T0 + 2,
        correlationId: 'control.capacity.pending',
        mutation: { command: 'RESTART_COMPONENT', componentId: 'market-universe' },
      },
      actor: { id: 'local-operator', email: null, source: 'loopback' },
      requestDigest: 'f'.repeat(64),
      before: pendingBefore,
      after: pendingAfter,
      applied: true,
      code: 'MANAGED_RUNTIME_RESTART_ACCEPTED',
    };
    assert.equal((await adapter.commitControlMutation(pendingCommit)).kind, 'COMMITTED');

    const firstTerminalBefore = adapter.currentState().value.control;
    const firstTerminalAfter = {
      ...firstTerminalBefore,
      revision: firstTerminalBefore.revision + 1,
      safeMode: 'ADVISORY',
      updatedAtMs: T0 + 3,
      correlationId: 'control.capacity.terminal.0000',
    };
    const firstTerminalCommit = {
      request: {
        idempotencyKey: 'control.capacity.terminal.0000',
        expectedRevision: firstTerminalBefore.revision,
        reason: 'Create canonical terminal control evidence before rollover',
        requestedAtMs: T0 + 3,
        correlationId: 'control.capacity.terminal.0000',
        mutation: { command: 'SET_SAFE_MODE', safeMode: 'ADVISORY' },
      },
      actor: { id: 'local-operator', email: null, source: 'loopback' },
      requestDigest: '1'.padStart(64, '0'),
      before: firstTerminalBefore,
      after: firstTerminalAfter,
      applied: true,
      code: 'CONTROL_APPLIED',
    };
    const firstTerminalResult = await adapter.commitControlMutation(firstTerminalCommit);
    assert.equal(firstTerminalResult.kind, 'COMMITTED');

    const decoded = decodeSystemCheckpoint(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.equal(decoded.ok, true);
    const seeded = structuredClone(decoded.value);
    const terminalTemplate = seeded.idempotencyReceipts.find(
      (entry) => entry.idempotencyKey === firstTerminalCommit.request.idempotencyKey,
    );
    for (let index = 1;
      seeded.idempotencyReceipts.length < SYSTEM_PERSISTENCE_LIMITS.maximumIdempotencyReceipts;
      index += 1) {
      const suffix = String(index).padStart(4, '0');
      seeded.idempotencyReceipts.push({
        ...structuredClone(terminalTemplate),
        idempotencyKey: `control.capacity.fixture.${suffix}`,
        requestDigest: (index + 1).toString(16).padStart(64, '0'),
        correlationId: `control.capacity.fixture.${suffix}`,
        recordedAtMs: T0 + 3 + index,
      });
    }
    ledger.setConfigValueAndLogEvent(
      SYSTEM_PERSISTENCE_CONFIG_KEY,
      encodeSystemCheckpoint(seeded),
      SYSTEM_PERSISTENCE_EVENT_KIND,
      null,
      { capacityFixture: true },
    );
    ledger.close();
    ledger = new Ledger(dataDir);
    adapter = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(adapter.load(T0 + 600, 'control.capacity.seeded').ok, true);

    const rolloverBefore = adapter.currentState().value.control;
    const rolloverAfter = {
      ...rolloverBefore,
      revision: rolloverBefore.revision + 1,
      safeMode: 'VALIDATE_ONLY',
      updatedAtMs: T0 + 601,
      correlationId: 'control.capacity.rollover',
    };
    const rolloverCommit = {
      request: {
        idempotencyKey: 'control.capacity.rollover.0513',
        expectedRevision: rolloverBefore.revision,
        reason: 'Admit a new control after the bounded receipt window is full',
        requestedAtMs: T0 + 601,
        correlationId: 'control.capacity.rollover',
        mutation: { command: 'SET_SAFE_MODE', safeMode: 'VALIDATE_ONLY' },
      },
      actor: { id: 'local-operator', email: null, source: 'loopback' },
      requestDigest: 'd'.repeat(64),
      before: rolloverBefore,
      after: rolloverAfter,
      applied: true,
      code: 'CONTROL_APPLIED',
    };
    assert.equal((await adapter.commitControlMutation(rolloverCommit)).kind, 'COMMITTED');

    const boundedState = adapter.currentState().value;
    assert.equal(
      boundedState.idempotencyReceipts.length,
      SYSTEM_PERSISTENCE_LIMITS.maximumIdempotencyReceipts,
    );
    assert.ok(boundedState.idempotencyReceipts.some(
      (entry) => entry.idempotencyKey === pendingCommit.request.idempotencyKey,
    ));
    assert.equal(boundedState.idempotencyReceipts.some(
      (entry) => entry.idempotencyKey === firstTerminalCommit.request.idempotencyKey,
    ), false);
    assert.equal(adapter.readPendingControlRuntimePublications().value.length, 1);

    const eventCountBeforeReplay = ledger.recentEvents(2_000).length;
    const found = await adapter.findControlMutation(firstTerminalCommit.request.idempotencyKey);
    assert.equal(found.requestDigest, firstTerminalCommit.requestDigest);
    assert.equal(found.receipt.ledgerEventId, firstTerminalResult.receipt.ledgerEventId);
    const replay = await adapter.commitControlMutation(firstTerminalCommit);
    assert.equal(replay.kind, 'IDEMPOTENT_REPLAY');
    assert.equal(replay.receipt.ledgerEventId, firstTerminalResult.receipt.ledgerEventId);
    assert.equal(ledger.recentEvents(2_000).length, eventCountBeforeReplay);
    const conflict = await adapter.commitControlMutation({
      ...firstTerminalCommit,
      requestDigest: 'e'.repeat(64),
    });
    assert.equal(conflict.kind, 'IDEMPOTENCY_CONFLICT');
    assert.equal(ledger.recentEvents(2_000).length, eventCountBeforeReplay);

    ledger.close();
    ledger = new Ledger(dataDir);
    adapter = new SystemLedgerPersistenceAdapter(ledger);
    assert.equal(adapter.load(T0 + 602, 'control.capacity.reload').ok, true);
    const restartedReplay = await adapter.commitControlMutation(firstTerminalCommit);
    assert.equal(restartedReplay.kind, 'IDEMPOTENT_REPLAY');
    assert.equal(restartedReplay.receipt.ledgerEventId, firstTerminalResult.receipt.ledgerEventId);
    assert.ok(adapter.currentState().value.idempotencyReceipts.some(
      (entry) => entry.idempotencyKey === pendingCommit.request.idempotencyKey,
    ));
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('historical effectful control receipt without a publication marker loads as UNKNOWN attention', async () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    let adapter = new SystemLedgerPersistenceAdapter(ledger);
    adapter.load(T0, 'historical.empty');
    adapter.persistStartup({ startedAtMs: T0 + 1, correlationId: 'historical.start' });
    const before = adapter.currentState().value.control;
    const request = {
      idempotencyKey: 'historical.restart.0001', expectedRevision: before.revision,
      reason: 'Historical managed restart', requestedAtMs: T0 + 2, correlationId: 'historical.restart',
      mutation: { command: 'RESTART_COMPONENT', componentId: 'market-universe' },
    };
    const after = {
      ...before,
      revision: before.revision + 1,
      generation: before.generation + 1,
      updatedAtMs: T0 + 2,
      correlationId: 'historical.restart',
    };
    await adapter.commitControlMutation({
      request,
      actor: { id: 'local-operator', email: null, source: 'loopback' },
      requestDigest: 'd'.repeat(64),
      before,
      after,
      applied: true,
      code: 'MANAGED_RUNTIME_RESTART_ACCEPTED',
    });
    const decoded = decodeSystemCheckpoint(ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY));
    assert.equal(decoded.ok, true);
    const historical = structuredClone(decoded.value);
    delete historical.idempotencyReceipts[0].receipt.runtimePublication;
    ledger.setConfigValueAndLogEvent(
      SYSTEM_PERSISTENCE_CONFIG_KEY,
      encodeSystemCheckpoint(historical),
      SYSTEM_PERSISTENCE_EVENT_KIND,
      null,
      { migrationFixture: true },
    );
    ledger.close();

    ledger = new Ledger(dataDir);
    adapter = new SystemLedgerPersistenceAdapter(ledger);
    const loaded = adapter.load(T0 + 3, 'historical.reload');
    assert.equal(loaded.ok, true);
    const found = await adapter.findControlMutation(request.idempotencyKey);
    assert.equal(found.runtimePublication, 'UNKNOWN');
    const references = adapter.readPendingControlRuntimePublications();
    assert.equal(references.ok, true);
    assert.equal(references.value[0].state, 'UNKNOWN');
    assert.ok(loaded.barrier.reasonCodes.includes('CONTROL_RUNTIME_PUBLICATION_EFFECT_UNKNOWN'));
  } finally {
    try { ledger.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});
