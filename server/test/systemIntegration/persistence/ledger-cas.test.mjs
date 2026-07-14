import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

test('Ledger CAS rejects unbounded batches, payloads, values, and symbols before writing', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    assert.throws(
      () => ledger.compareAndSetConfigValueAndLogEvents(CONFIG_KEY, null, '{}', []),
      /between 1 and 2/,
    );
    assert.throws(
      () => ledger.compareAndSetConfigValueAndLogEvents(
        CONFIG_KEY,
        null,
        '{}',
        [...records(), records()[0]],
      ),
      /between 1 and 2/,
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
});
