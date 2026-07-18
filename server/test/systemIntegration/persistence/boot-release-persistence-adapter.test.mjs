import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../../../dist/ledger.js';
import {
  createSystemBootReleasePersistenceAdapter,
  finalizeSystemBootReleaseCleanShutdown,
} from '../../../dist/systemIntegration/persistence/bootReleasePersistenceAdapter.js';

const T0 = 1_800_000_000_000;
const TESTED_SHA = 'a'.repeat(40);
const DEPLOYED_SHA = 'b'.repeat(40);

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-boot-release-'));
}

function mutableClock(initial = T0) {
  let now = initial;
  return Object.freeze({
    nowMs: () => now,
    set: (value) => { now = value; },
  });
}

function validEnvironment(overrides = {}) {
  return Object.freeze({
    testedSha: TESTED_SHA,
    deployedSha: DEPLOYED_SHA,
    configRevision: 'config.release.17',
    modelRevision: 'model.champion.4',
    ...overrides,
  });
}

function withLedger(run) {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    return run(ledger, dataDir);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test('missing and malformed composition identity remains explicit UNKNOWN', () => {
  withLedger((ledger) => {
    const clock = mutableClock();
    const adapter = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock,
      environment: Object.freeze({
        testedSha: TESTED_SHA.toUpperCase(),
        deployedSha: 'not-a-full-sha',
        configRevision: 'REPLACE_ME_CONFIG',
        modelRevision: { unexpected: true },
      }),
    });
    assert.equal(adapter.start().ok, true);
    const readback = adapter.readback();
    assert.equal(readback.state, 'AVAILABLE');
    assert.equal(readback.latest?.identityState, 'UNKNOWN');
    assert.equal(readback.latest?.testedCommit, null);
    assert.equal(readback.latest?.deployedCommit, null);
    assert.equal(readback.latest?.configRevision, null);
    assert.equal(readback.latest?.modelRevision, null);
    assert.equal(readback.latest?.schemaRevision, '2');
    assert.equal(readback.latest?.blockerCode, 'TESTED_COMMIT_UNKNOWN');
    assert.deepEqual(readback.latest?.identityIssues, [
      'TESTED_COMMIT_UNKNOWN',
      'DEPLOYED_COMMIT_UNKNOWN',
      'CONFIG_REVISION_UNKNOWN',
      'MODEL_REVISION_UNKNOWN',
    ]);
  });
});

test('startup is exactly idempotent and produces one durable boot row', () => {
  withLedger((ledger) => {
    const adapter = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock: mutableClock(),
      environment: validEnvironment(),
    });
    const first = adapter.start();
    const eventCount = ledger.db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
    const replay = adapter.start();
    assert.equal(first.ok, true);
    assert.equal(first.disposition, 'COMMITTED_NEW');
    assert.equal(replay.ok, true);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(replay.ledgerEventId, first.ledgerEventId);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, eventCount);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM product_boot_release_revisions').get().count, 1);
  });
});

test('restart advances generation while preserving the crashed boot as pending', () => {
  withLedger((ledger) => {
    const firstClock = mutableClock();
    const first = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock: firstClock,
      environment: validEnvironment(),
    });
    assert.equal(first.start().ok, true);

    const secondClock = mutableClock(T0 + 1_000);
    const second = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock: secondClock,
      environment: validEnvironment(),
    });
    const restarted = second.start();
    assert.equal(restarted.ok, true);
    assert.equal(restarted.generation, 2);
    const readback = second.readback();
    assert.equal(readback.latest?.generation, 2);
    assert.equal(readback.latest?.lifecycleState, 'ACTIVE');
    assert.deepEqual(readback.history.map((row) => [row.generation, row.lifecycleState]), [
      [2, 'ACTIVE'],
      [1, 'CRASH_PENDING'],
    ]);
    assert.deepEqual(readback.crashPendingOperationIds, ['system.application.boot.g1']);
    assert.ok(readback.reasonCodes.includes('CRASH_PENDING_BOOT_PRESENT'));
  });
});

test('clean shutdown completes the original CAS identity and replays exactly', () => {
  withLedger((ledger) => {
    const clock = mutableClock();
    const adapter = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock,
      environment: validEnvironment(),
    });
    const started = adapter.start();
    assert.equal(started.ok, true);
    clock.set(T0 + 5_000);
    const completed = adapter.completeCleanShutdown();
    assert.equal(completed.ok, true);
    assert.equal(completed.disposition, 'COMMITTED_NEW');
    assert.notEqual(completed.ledgerEventId, started.ledgerEventId);
    const eventCount = ledger.db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
    const replay = adapter.completeCleanShutdown();
    assert.equal(replay.ok, true);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(replay.ledgerEventId, completed.ledgerEventId);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, eventCount);

    const latest = adapter.readback().latest;
    assert.equal(latest?.operationId, started.operationId);
    assert.equal(latest?.generation, started.generation);
    assert.equal(latest?.completedAtMs, T0 + 5_000);
    assert.equal(latest?.clean, true);
    assert.equal(latest?.lifecycleState, 'CLEAN_COMPLETED');
  });
});

test('stale generation planning loses the real Ledger CAS without a second row', () => {
  withLedger((ledger) => {
    const first = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock: mutableClock(),
      environment: validEnvironment(),
    });
    assert.equal(first.start().ok, true);

    const staleReadLedger = Object.freeze({
      readProductBootReleaseRevisions: () => Object.freeze([]),
      readSchemaCompatibility: () => ledger.readSchemaCompatibility(),
      compareAndSetProductBootReleaseRevision: (input) => (
        ledger.compareAndSetProductBootReleaseRevision(input)
      ),
    });
    const competitor = createSystemBootReleasePersistenceAdapter({
      ledger: staleReadLedger,
      clock: mutableClock(T0 + 1),
      environment: validEnvironment(),
    });
    const conflict = competitor.start();
    assert.deepEqual(conflict, {
      ok: false,
      code: 'BOOT_RELEASE_VERSION_CONFLICT',
      message: 'boot/release compare-and-set revision changed',
      currentRevision: '1',
    });
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM product_boot_release_revisions').get().count, 1);
  });
});

test('tested identity never fabricates a deployed release claim', () => {
  withLedger((ledger) => {
    const adapter = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock: mutableClock(),
      environment: validEnvironment({ deployedSha: undefined }),
    });
    assert.equal(adapter.start().ok, true);
    const latest = adapter.readback().latest;
    assert.equal(latest?.testedCommit, TESTED_SHA);
    assert.equal(latest?.deployedCommit, null);
    assert.equal(latest?.identityState, 'PARTIAL');
    assert.ok(latest?.identityIssues.includes('DEPLOYED_COMMIT_UNKNOWN'));
    const audit = ledger.recentEvents(1, 'system.integration.product.persistence')[0];
    assert.equal(audit.data.deployedCommit, null);
    assert.equal(audit.data.deploymentMutationAuthority, 'NONE');
  });
});

test('boot/release adapter is environment-injected and has no mutation or network owner', () => {
  const source = readFileSync(
    new URL('../../../src/systemIntegration/persistence/bootReleasePersistenceAdapter.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /process\.env|node:fs|node:net|node:https|fetch\s*\(/);
  assert.doesNotMatch(source, /(?:place|submit|send|cancel|borrow|repay|withdraw|transfer)Order\s*\(/i);
  assert.doesNotMatch(source, /LIVE_EXECUTION_PERMITTED|externalActionAuthorization\s*:\s*['"](?:LIVE|SIGNED)/);
});

test('final clean shutdown checkpoints the real Ledger, closes it, and survives reopen', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  const clock = mutableClock();
  const adapter = createSystemBootReleasePersistenceAdapter({
    ledger,
    clock,
    environment: validEnvironment(),
  });
  try {
    assert.equal(adapter.start().ok, true);
    clock.set(T0 + 10_000);
    assert.deepEqual(finalizeSystemBootReleaseCleanShutdown(adapter, ledger), {
      ok: true,
      code: 'CLEAN_SHUTDOWN_DURABLE',
    });
    assert.equal(ledger.db.open, false);

    const reopened = new Ledger(dataDir);
    try {
      const [row] = reopened.readProductBootReleaseRevisions(1);
      assert.equal(row.clean, true);
      assert.equal(row.completedAtMs, T0 + 10_000);
      assert.equal(row.blockerCode, null);
      assert.equal(reopened.probeWritable(true), true);
    } finally {
      reopened.close();
    }
  } finally {
    if (ledger.db.open) ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('failed final preflight leaves the boot ACTIVE and never writes a false clean marker', () => {
  withLedger((ledger) => {
    const adapter = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock: mutableClock(),
      environment: validEnvironment(),
    });
    assert.equal(adapter.start().ok, true);
    let flushCalls = 0;
    let closeCalls = 0;
    const result = finalizeSystemBootReleaseCleanShutdown(adapter, {
      probeWritable: () => false,
      flushForCleanShutdown: () => { flushCalls += 1; return true; },
      close: () => { closeCalls += 1; },
    });
    assert.deepEqual(result, {
      ok: false,
      code: 'LEDGER_FINAL_PREFLIGHT_FAILED',
      uncleanRecorded: false,
    });
    assert.equal(flushCalls, 0);
    assert.equal(closeCalls, 0);
    assert.equal(adapter.readback().latest?.lifecycleState, 'ACTIVE');
    assert.equal(adapter.readback().latest?.clean, null);
  });
});

test('post-completion checkpoint failure rewrites the same CAS identity UNCLEAN', () => {
  withLedger((ledger) => {
    const clock = mutableClock();
    const adapter = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock,
      environment: validEnvironment(),
    });
    const started = adapter.start();
    assert.equal(started.ok, true);
    clock.set(T0 + 20_000);
    const flushResults = [true, false, true];
    let closeCalls = 0;
    const result = finalizeSystemBootReleaseCleanShutdown(adapter, {
      probeWritable: () => true,
      flushForCleanShutdown: () => flushResults.shift() ?? false,
      close: () => { closeCalls += 1; },
    });
    assert.deepEqual(result, {
      ok: false,
      code: 'LEDGER_FINAL_CHECKPOINT_FAILED',
      uncleanRecorded: true,
    });
    assert.equal(closeCalls, 0);
    const latest = adapter.readback().latest;
    assert.equal(latest?.operationId, started.operationId);
    assert.equal(latest?.generation, started.generation);
    assert.equal(latest?.completedAtMs, T0 + 20_000);
    assert.equal(latest?.clean, false);
    assert.equal(latest?.blockerCode, 'LEDGER_FINAL_CHECKPOINT_FAILED');
    assert.equal(latest?.lifecycleState, 'UNCLEAN_COMPLETED');
  });
});

test('synchronous Ledger close throw is not success and rewrites clean evidence UNCLEAN', () => {
  withLedger((ledger) => {
    const clock = mutableClock();
    const adapter = createSystemBootReleasePersistenceAdapter({
      ledger,
      clock,
      environment: validEnvironment(),
    });
    assert.equal(adapter.start().ok, true);
    clock.set(T0 + 30_000);
    let closeCalls = 0;
    const result = finalizeSystemBootReleaseCleanShutdown(adapter, {
      probeWritable: () => true,
      flushForCleanShutdown: () => true,
      close: () => { closeCalls += 1; throw new Error('hostile close failure'); },
    });
    assert.deepEqual(result, {
      ok: false,
      code: 'LEDGER_CLOSE_FAILED',
      uncleanRecorded: true,
    });
    assert.equal(closeCalls, 1);
    const latest = adapter.readback().latest;
    assert.equal(latest?.clean, false);
    assert.equal(latest?.blockerCode, 'LEDGER_CLOSE_FAILED');
    assert.equal(latest?.lifecycleState, 'UNCLEAN_COMPLETED');
  });
});

test('shutdown composition orders listener closure before boot completion and exits failed shutdown nonzero', () => {
  const source = readFileSync(new URL('../../../src/index.ts', import.meta.url), 'utf8');
  const listenersClosed = source.indexOf('await Promise.all([httpClosed, websocketClosed])');
  const finalization = source.indexOf('const finalization = finalizeSystemBootReleaseCleanShutdown');
  const successfulOutcome = source.indexOf("return 'SHUTDOWN_COMPLETE' as const", finalization);
  assert.ok(listenersClosed > 0 && finalization > listenersClosed && successfulOutcome > finalization);
  assert.match(source, /type GracefulShutdownOutcome = 'SHUTDOWN_COMPLETE' \| 'SHUTDOWN_REFUSED' \| 'SHUTDOWN_FAILED'/);
  assert.match(source, /if \(outcome === 'SHUTDOWN_FAILED'\) process\.exit\(1\)/);
  assert.doesNotMatch(source.slice(listenersClosed, finalization), /completeCleanShutdown|ledger\.close/);
  assert.match(
    source,
    /const systemIntegrationStart = bootReleaseStart\.ok \? \(\(\) => \{\s*dataDirLease\.assertHeld\(\);\s*return systemIntegration\.start\(\);\s*\}\)\(\) : null;/,
  );
  assert.match(
    source,
    /if \(canonicalApplicationStartOk\) \{[\s\S]*?server\.listen\([\s\S]*?startServerTimers\(\);/,
  );
  const failedBootBranch = source.indexOf('const systemIntegrationStart = bootReleaseStart.ok ? (() => {');
  const listenerAdmission = source.indexOf('if (canonicalApplicationStartOk) {', failedBootBranch);
  assert.ok(failedBootBranch > 0 && listenerAdmission > failedBootBranch);
  assert.match(source, /applicationStartOk: \(\) => canonicalApplicationStartOk/);
  assert.match(source, /projectI00Health\([\s\S]*?canonicalApplicationStartOk,[\s\S]*?canonicalApplicationStartFailureCodes/);
  const shutdownStart = source.indexOf('function gracefulShutdown(');
  const drainAdmissionClosed = source.indexOf('ordinaryShutdownAdmission.beginDrainEvaluation();', shutdownStart);
  const intakePause = source.indexOf("command: 'SET_INTAKE_PAUSED', paused: true", shutdownStart);
  const canonicalDrain = source.indexOf('await systemIntegration.drain()', shutdownStart);
  const irreversibleClose = source.indexOf('ordinaryShutdownAdmission.beginIrreversibleClose();', shutdownStart);
  const mutationClosed = source.indexOf('shuttingDown = true;', irreversibleClose);
  assert.ok(
    shutdownStart > 0
      && drainAdmissionClosed > shutdownStart
      && intakePause > drainAdmissionClosed
      && canonicalDrain > intakePause
      && irreversibleClose > canonicalDrain
      && mutationClosed > irreversibleClose,
  );
  assert.match(source, /ordinaryShutdownAdmission\.refuseDrain\(\);[\s\S]*?return 'SHUTDOWN_REFUSED'/);
  assert.match(source, /phase === 'RECOVERY_ONLY' && recoveryControlEnvelope/);
  assert.match(source, /code: phase === 'RECOVERY_ONLY' \? 'SHUTDOWN_RECOVERY_ONLY' : 'SHUTDOWN_IN_PROGRESS'/);
  assert.match(
    source,
    /if \(outcome === 'SHUTDOWN_REFUSED'\) \{[\s\S]*?recovery supervision remains active[\s\S]*?return;/,
  );
});
