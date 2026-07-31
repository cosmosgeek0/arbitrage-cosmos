import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger } from '../dist/ledger.js';

function tempDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'cosmos-ledger-count-'));
}

test('countEvents keeps exact filters behind one native SQL aggregate row', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    ledger.logEventsAtomically([
      {
        kind: 'count.alpha',
        symbol: 'BTCUSDT',
        data: { detail: 'needle' },
        severity: 'INFO',
        createdAt: 1_700_000_000_000,
      },
      {
        kind: 'count.alpha',
        symbol: 'ETHUSDT',
        data: { detail: 'other' },
        severity: 'WARNING',
        createdAt: 1_700_000_000_001,
      },
      {
        kind: 'count.beta',
        symbol: 'BTCUSDT',
        data: { detail: 'needle' },
        severity: 'ERROR',
        createdAt: 1_700_000_000_002,
      },
    ]);

    assert.equal(ledger.countEvents(), 3);
    assert.equal(ledger.countEvents('count.alpha'), 2);
    assert.equal(ledger.countEvents(undefined, 'BTCUSDT'), 2);
    assert.equal(ledger.countEvents('count.alpha', 'BTCUSDT', 'needle'), 1);

    const plan = ledger.db.prepare(
      'EXPLAIN QUERY PLAN SELECT COUNT(*) FROM events WHERE kind = ? AND ts >= ?',
    ).all('count.alpha', 0);
    assert.match(
      plan.map((row) => String(row.detail)).join('\n'),
      /idx_events_kind/,
      'kind/time counts must remain eligible for the canonical covering filter index',
    );

    ledger.db.exec('DROP TRIGGER events_no_update');
    ledger.db.prepare("UPDATE events SET severity = '' WHERE kind = 'count.beta'").run();
    assert.equal(
      ledger.countEvents(),
      3,
      'the hot count path must not execute JavaScript once per matching row',
    );
    assert.throws(
      () => ledger.recentEvents(10, 'count.beta'),
      (error) => error instanceof Error && error.message === 'LEDGER_EVENT_SEVERITY_MALFORMED',
      'row-bearing reads must continue to reject corrupt metadata',
    );
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('countEvents does not materialize an iterator of every matching event row', () => {
  const source = readFileSync(new URL('../src/ledger.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  countEvents(');
  const end = source.indexOf('\n  eventsSince(', start);
  assert.ok(start >= 0 && end > start);
  const countSource = source.slice(start, end);

  assert.match(countSource, /SELECT COUNT\(\*\) AS count/);
  assert.match(countSource, /\.safeIntegers\(\)\.get\(\.\.\.params\)/);
  assert.doesNotMatch(countSource, /cosmos_validate_event_metadata/);
  assert.doesNotMatch(countSource, /\.iterate\(/);
  assert.doesNotMatch(countSource, /for \(const row of rows\)/);
});
