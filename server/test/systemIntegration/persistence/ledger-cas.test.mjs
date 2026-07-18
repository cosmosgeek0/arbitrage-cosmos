import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';

import { Ledger } from '../../../dist/ledger.js';
import { BoundedInMemoryLedger } from '../fixtures/memory-ledger.mjs';
import { ManualClock } from '../fixtures/manual-clock.mjs';

const CONFIG_KEY = 'system.integration.live-edge.mutation-journal.v1';
const JOURNAL_KIND = 'system.integration.live_edge.journal';
const AUDIT_KIND = 'system.integration.live_edge.audit';
const MUTATION_ID = `l06mut_${'a'.repeat(64)}`;

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-ledger-cas-'));
}

function records(seed = 'one') {
  return Object.freeze([
    Object.freeze({
      kind: JOURNAL_KIND,
      symbol: MUTATION_ID,
      data: Object.freeze({ schema: 'TEST_JOURNAL_V1', seed }),
    }),
    Object.freeze({
      kind: AUDIT_KIND,
      symbol: MUTATION_ID,
      data: Object.freeze({ schema: 'TEST_AUDIT_V1', seed }),
    }),
  ]);
}

test('Ledger CAS atomically commits an exact config value and bounded event pair', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const nextValue = '{"revision":1}';
    const committed = ledger.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      null,
      nextValue,
      records(),
    );
    assert.equal(committed.committed, true);
    assert.deepEqual(committed.events.map((event) => event.kind), [JOURNAL_KIND, AUDIT_KIND]);
    assert.ok(committed.events.every((event) => Number.isSafeInteger(event.id) && event.id > 0));
    assert.equal(committed.events[1].id, committed.events[0].id + 1);
    assert.equal(ledger.getConfigValue(CONFIG_KEY), nextValue);
    assert.equal(ledger.recentEvents(10, JOURNAL_KIND, MUTATION_ID).length, 1);
    assert.equal(ledger.recentEvents(10, AUDIT_KIND, MUTATION_ID).length, 1);
    const semanticallyEqualButNotExact = ledger.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      '{ "revision": 1 }',
      '{"revision":2}',
      records('non-exact'),
    );
    assert.equal(semanticallyEqualButNotExact.committed, false);
    assert.equal(ledger.countEvents(), 2);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Ledger CAS enforces the exact commit timestamp deadline before any config or event write', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  const originalNow = Date.now;
  try {
    const deadline = 2_000_000_000_000;
    Date.now = () => deadline - 1;
    const prior = '{"revision":1}';
    const beforeDeadline = ledger.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      null,
      prior,
      records('before-deadline'),
      deadline,
    );
    assert.equal(beforeDeadline.committed, true);
    assert.deepEqual(beforeDeadline.events.map((event) => event.ts), [deadline - 1, deadline - 1]);

    const countBeforeRefusal = ledger.countEvents();
    Date.now = () => deadline;
    const atDeadline = ledger.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      prior,
      '{"revision":2}',
      records('at-deadline'),
      deadline,
    );
    assert.deepEqual(atDeadline, {
      committed: false,
      reason: 'DEADLINE_EXCEEDED',
      currentValue: prior,
    });
    assert.equal(ledger.getConfigValue(CONFIG_KEY), prior);
    assert.equal(ledger.countEvents(), countBeforeRefusal);
    assert.equal(ledger.recentEvents(10, JOURNAL_KIND, MUTATION_ID).length, 1);
    assert.equal(ledger.recentEvents(10, AUDIT_KIND, MUTATION_ID).length, 1);
  } finally {
    Date.now = originalNow;
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('independently opened Ledger writers compare durable state and the stale writer appends zero rows', () => {
  const dataDir = tempDataDir();
  const first = new Ledger(dataDir);
  const second = new Ledger(dataDir);
  try {
    const prior = '{"revision":0}';
    first.setConfigValue(CONFIG_KEY, prior);
    const firstExpected = first.getConfigValue(CONFIG_KEY);
    const secondExpected = second.getConfigValue(CONFIG_KEY);
    assert.equal(firstExpected, prior);
    assert.equal(secondExpected, prior);

    const winnerValue = '{"revision":1,"winner":"first"}';
    const winner = first.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      firstExpected,
      winnerValue,
      records('winner'),
    );
    assert.equal(winner.committed, true);

    const eventCountBeforeLoser = second.countEvents();
    const loser = second.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      secondExpected,
      '{"revision":1,"winner":"second"}',
      records('loser'),
    );
    assert.deepEqual(loser, {
      committed: false,
      reason: 'VERSION_CONFLICT',
      currentValue: winnerValue,
    });
    assert.equal(second.countEvents(), eventCountBeforeLoser);
    assert.equal(second.recentEvents(10, JOURNAL_KIND, MUTATION_ID).length, 1);
    assert.equal(second.recentEvents(10, AUDIT_KIND, MUTATION_ID).length, 1);
  } finally {
    first.close();
    second.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('SIGKILL before transaction commit leaves no checkpoint, journal, or audit row', { timeout: 15_000 }, async () => {
  const dataDir = tempDataDir();
  const ledgerModuleUrl = pathToFileURL(path.resolve('server/dist/ledger.js')).href;
  const childSource = `
    import { Ledger } from ${JSON.stringify(ledgerModuleUrl)};
    const ledger = new Ledger(process.env.COSMOS_CAS_CRASH_DATA_DIR);
    ledger.db.function('hold_before_cas_event', () => {
      process.stdout.write('CAS_TRANSACTION_OPEN\\n');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
      return 0;
    });
    ledger.db.exec("CREATE TRIGGER hold_before_cas_event_insert BEFORE INSERT ON events WHEN NEW.kind = '${JOURNAL_KIND}' BEGIN SELECT hold_before_cas_event(); END;");
    ledger.compareAndSetConfigValueAndLogEvents(
      ${JSON.stringify(CONFIG_KEY)},
      null,
      '{"revision":1,"crash":"before-commit"}',
      ${JSON.stringify(records('power-loss'))},
    );
  `;
  let child = null;
  try {
    child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
      env: { ...process.env, COSMOS_CAS_CRASH_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const close = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    await new Promise((resolve, reject) => {
      let stdout = '';
      const timeout = setTimeout(() => reject(new Error(`CAS crash fixture did not enter transaction: ${stderr}`)), 10_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (!stdout.includes('CAS_TRANSACTION_OPEN')) return;
        clearTimeout(timeout);
        resolve();
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('close', (code, signal) => {
        if (stdout.includes('CAS_TRANSACTION_OPEN')) return;
        clearTimeout(timeout);
        reject(new Error(`CAS crash fixture closed before transaction hold: ${code}/${signal}: ${stderr}`));
      });
    });
    assert.equal(child.kill('SIGKILL'), true);
    assert.deepEqual(await close, { code: null, signal: 'SIGKILL' });

    assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_SCHEMA_MALFORMED/);
    const repair = new Database(path.join(dataDir, 'cosmos.db'));
    repair.exec('DROP TRIGGER hold_before_cas_event_insert');
    repair.close();
    const reopened = new Ledger(dataDir);
    try {
      assert.equal(reopened.getConfigValue(CONFIG_KEY), null);
      assert.equal(reopened.recentEvents(10, JOURNAL_KIND, MUTATION_ID).length, 0);
      assert.equal(reopened.recentEvents(10, AUDIT_KIND, MUTATION_ID).length, 0);
      assert.equal(reopened.countEvents(), 0);
    } finally {
      reopened.close();
    }
  } finally {
    if (child !== null && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('failure inserting the audit row rolls back the checkpoint and journal row', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const prior = '{"revision":0}';
    ledger.setConfigValue(CONFIG_KEY, prior);
    ledger.db.exec(`
      CREATE TRIGGER reject_cas_audit
      BEFORE INSERT ON events WHEN NEW.kind = '${AUDIT_KIND}'
      BEGIN SELECT RAISE(ABORT, 'CAS audit rejected'); END;
    `);
    assert.throws(
      () => ledger.compareAndSetConfigValueAndLogEvents(
        CONFIG_KEY,
        prior,
        '{"revision":1}',
        records('rollback'),
      ),
      /CAS audit rejected/,
    );
    ledger.db.exec('DROP TRIGGER reject_cas_audit');
    assert.equal(ledger.getConfigValue(CONFIG_KEY), prior);
    assert.equal(ledger.recentEvents(10, JOURNAL_KIND, MUTATION_ID).length, 0);
    assert.equal(ledger.recentEvents(10, AUDIT_KIND, MUTATION_ID).length, 0);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('post-commit listener failure is swallowed and returns exact durable readback once', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    ledger.on('event', (event) => {
      event.data.listenerMutation = true;
      throw new Error('listener failed after durable commit');
    });
    const nextValue = '{"revision":1,"listener":"failed"}';
    const committed = ledger.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      null,
      nextValue,
      records('listener'),
    );
    assert.equal(committed.committed, true);
    assert.equal(committed.events.length, 2);
    assert.equal(committed.events[0].data.listenerMutation, undefined);
    assert.equal(committed.events[1].data.listenerMutation, undefined);
    assert.equal(ledger.getConfigValue(CONFIG_KEY), nextValue);
    assert.equal(ledger.recentEvents(10, JOURNAL_KIND, MUTATION_ID).length, 1);
    assert.equal(ledger.recentEvents(10, AUDIT_KIND, MUTATION_ID).length, 1);

    const replayAttempt = ledger.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      null,
      nextValue,
      records('listener'),
    );
    assert.equal(replayAttempt.committed, false);
    assert.equal(ledger.countEvents(), 2);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('nonthrowing mutating listeners cannot alter later listeners or the returned durable events', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const firstListenerEvents = [];
    const laterListenerEvents = [];
    ledger.on('event', (event) => {
      firstListenerEvents.push(event);
      event.kind = 'hostile.listener.mutation';
      event.data.schema = 'HOSTILE_MUTATION';
      event.data.seed = 'hostile-mutation';
    });
    ledger.on('event', (event) => {
      laterListenerEvents.push(event);
    });

    const committed = ledger.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      null,
      '{"revision":1,"listener":"isolated"}',
      records('listener-isolation'),
    );
    assert.equal(committed.committed, true);
    assert.deepEqual(firstListenerEvents.map((event) => event.kind), [
      'hostile.listener.mutation',
      'hostile.listener.mutation',
    ]);
    assert.deepEqual(laterListenerEvents.map((event) => event.kind), [JOURNAL_KIND, AUDIT_KIND]);
    assert.deepEqual(laterListenerEvents.map((event) => event.data.seed), [
      'listener-isolation',
      'listener-isolation',
    ]);
    assert.deepEqual(committed.events.map((event) => event.kind), [JOURNAL_KIND, AUDIT_KIND]);
    assert.deepEqual(committed.events.map((event) => event.data.seed), [
      'listener-isolation',
      'listener-isolation',
    ]);
    assert.notEqual(firstListenerEvents[0], laterListenerEvents[0]);
    assert.notEqual(firstListenerEvents[0].data, laterListenerEvents[0].data);
    assert.notEqual(laterListenerEvents[0], committed.events[0]);
    assert.notEqual(laterListenerEvents[0].data, committed.events[0].data);
    assert.deepEqual(
      ledger.recentEvents(10, JOURNAL_KIND, MUTATION_ID)[0].data,
      { schema: 'TEST_JOURNAL_V1', seed: 'listener-isolation' },
    );
    assert.deepEqual(
      ledger.recentEvents(10, AUDIT_KIND, MUTATION_ID)[0].data,
      { schema: 'TEST_AUDIT_V1', seed: 'listener-isolation' },
    );
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Ledger CAS rejects unbounded batches, payloads, values, and symbols before writing', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    assert.throws(
      () => ledger.compareAndSetConfigValueAndLogEvents(CONFIG_KEY, null, '{}', []),
      /between 1 and 8/,
    );
    assert.throws(
      () => ledger.compareAndSetConfigValueAndLogEvents(
        CONFIG_KEY,
        null,
        '{}',
        Array.from({ length: 9 }, () => records()[0]),
      ),
      /between 1 and 8/,
    );
    assert.throws(
      () => ledger.compareAndSetConfigValueAndLogEvents(
        CONFIG_KEY,
        null,
        'x'.repeat(512 * 1_024 + 1),
        [records()[0]],
      ),
      /config value exceeds/,
    );
    assert.throws(
      () => ledger.compareAndSetConfigValueAndLogEvents(
        CONFIG_KEY,
        null,
        '{}',
        [{ kind: JOURNAL_KIND, symbol: 'x'.repeat(97), data: {} }],
      ),
      /event symbol/,
    );
    assert.throws(
      () => ledger.compareAndSetConfigValueAndLogEvents(
        CONFIG_KEY,
        null,
        '{}',
        [{ kind: JOURNAL_KIND, data: { payload: 'x'.repeat(128 * 1_024) } }],
      ),
      /event data exceeds/,
    );
    assert.throws(
      () => ledger.compareAndSetConfigValueAndLogEvents(
        CONFIG_KEY,
        null,
        '{}',
        records(),
        -1,
      ),
      /commitBeforeMs/,
    );
    assert.equal(ledger.getConfigValue(CONFIG_KEY), null);
    assert.equal(ledger.countEvents(), 0);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('bounded memory Ledger mirrors CAS conflict and all-or-none capacity semantics', () => {
  const clock = new ManualClock(2_000_000_000_000);
  const ledger = new BoundedInMemoryLedger(clock, { maximumEvents: 2 });
  const committed = ledger.compareAndSetConfigValueAndLogEvents(
    CONFIG_KEY,
    null,
    '{"revision":1}',
    records('memory'),
  );
  assert.equal(committed.committed, true);
  assert.deepEqual(committed.events.map((event) => event.id), [1, 2]);
  const conflict = ledger.compareAndSetConfigValueAndLogEvents(
    CONFIG_KEY,
    null,
    '{"revision":2}',
    records('stale-memory'),
  );
  assert.equal(conflict.committed, false);
  assert.equal(ledger.countEvents(), 2);
  assert.equal(ledger.getConfigValue(CONFIG_KEY), '{"revision":1}');

  const bounded = new BoundedInMemoryLedger(clock, { maximumEvents: 1 });
  assert.throws(
    () => bounded.compareAndSetConfigValueAndLogEvents(
      CONFIG_KEY,
      null,
      '{"revision":1}',
      records('capacity'),
    ),
    /event capacity exceeded/,
  );
  assert.equal(bounded.getConfigValue(CONFIG_KEY), null);
  assert.equal(bounded.countEvents(), 0);

  const deadlineClock = new ManualClock(2_100_000_000_000);
  const deadlineLedger = new BoundedInMemoryLedger(deadlineClock, { maximumEvents: 4 });
  const beforeDeadline = deadlineLedger.compareAndSetConfigValueAndLogEvents(
    CONFIG_KEY,
    null,
    '{"revision":1}',
    records('memory-before-deadline'),
    deadlineClock.nowMs() + 1,
  );
  assert.equal(beforeDeadline.committed, true);
  deadlineClock.advance(1);
  const atDeadline = deadlineLedger.compareAndSetConfigValueAndLogEvents(
    CONFIG_KEY,
    '{"revision":1}',
    '{"revision":2}',
    records('memory-at-deadline'),
    deadlineClock.nowMs(),
  );
  assert.deepEqual(atDeadline, {
    committed: false,
    reason: 'DEADLINE_EXCEEDED',
    currentValue: '{"revision":1}',
  });
  assert.equal(deadlineLedger.getConfigValue(CONFIG_KEY), '{"revision":1}');
  assert.equal(deadlineLedger.countEvents(), 2);
});
