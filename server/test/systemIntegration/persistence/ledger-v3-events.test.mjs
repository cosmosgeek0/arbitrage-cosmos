import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { Ledger } from '../../../dist/ledger.js';

const LEGACY_TS = 1_800_000_000_000;
const RECEIPT_TS = 1_800_000_100_000;
const EVENT_COLUMNS = Object.freeze([
  'id',
  'ts',
  'kind',
  'symbol',
  'data',
  'severity',
  'source',
  'strategy',
  'status',
  'reason',
  'message',
  'correlation',
  'created_at',
]);

function tempDataDir(label) {
  return mkdtempSync(path.join(tmpdir(), `cosmos-ledger-v3-${label}-`));
}

function createExactV2Fills(db) {
  db.exec(`
    CREATE TABLE fills (
      symbol TEXT NOT NULL,
      trade_id INTEGER NOT NULL,
      order_id INTEGER,
      side TEXT NOT NULL,
      price TEXT NOT NULL CHECK(typeof(price) = 'text' AND length(price) BETWEEN 1 AND 98),
      qty TEXT NOT NULL CHECK(typeof(qty) = 'text' AND length(qty) BETWEEN 1 AND 98),
      quote_qty TEXT NOT NULL CHECK(typeof(quote_qty) = 'text' AND length(quote_qty) BETWEEN 1 AND 98),
      commission TEXT NOT NULL CHECK(typeof(commission) = 'text' AND length(commission) BETWEEN 1 AND 98),
      commission_asset TEXT,
      ts INTEGER NOT NULL,
      source TEXT NOT NULL,
      money_encoding TEXT NOT NULL CHECK(money_encoding IN ('EXACT_DECIMAL', 'LEGACY_BINARY64')),
      PRIMARY KEY (symbol, trade_id)
    );
  `);
}

function seedV2Ledger(dataDir, partialEventEnvelope = false) {
  const db = new Database(path.join(dataDir, 'cosmos.db'));
  db.exec(`
    CREATE TABLE ledger_schema_compatibility (
      singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton = 1),
      current_schema_version INTEGER NOT NULL,
      rollback_floor INTEGER NOT NULL
    );
    INSERT INTO ledger_schema_compatibility VALUES (1, 2, 2);
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      symbol TEXT,
      data TEXT${partialEventEnvelope ? ', severity TEXT' : ''}
    );
    INSERT INTO events (ts, kind, symbol, data)
      VALUES (${LEGACY_TS}, 'legacy.audit', 'BTCUSDT', '{"legacy":true}');
    PRAGMA user_version = 2;
  `);
  createExactV2Fills(db);
  db.close();
}

function seedV2WithoutEventTable(dataDir) {
  const db = new Database(path.join(dataDir, 'cosmos.db'));
  db.exec(`
    CREATE TABLE ledger_schema_compatibility (
      singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton = 1),
      current_schema_version INTEGER NOT NULL,
      rollback_floor INTEGER NOT NULL
    );
    INSERT INTO ledger_schema_compatibility VALUES (1, 2, 2);
  `);
  createExactV2Fills(db);
  db.pragma('user_version = 2');
  db.close();
}

function addCompleteV3EnvelopeWithoutAdvancingMarker(dataDir) {
  const db = new Database(path.join(dataDir, 'cosmos.db'));
  db.exec(`
    ALTER TABLE events ADD COLUMN severity TEXT;
    ALTER TABLE events ADD COLUMN source TEXT;
    ALTER TABLE events ADD COLUMN strategy TEXT;
    ALTER TABLE events ADD COLUMN status TEXT;
    ALTER TABLE events ADD COLUMN reason TEXT;
    ALTER TABLE events ADD COLUMN message TEXT;
    ALTER TABLE events ADD COLUMN correlation TEXT;
    ALTER TABLE events ADD COLUMN created_at INTEGER;
    UPDATE events SET created_at = ts;
  `);
  db.close();
}

function fullMetadata(suffix, createdAt = RECEIPT_TS - 100) {
  return Object.freeze({
    severity: 'ERROR',
    source: `runtime.${suffix}`,
    strategy: 'basis',
    status: 'BLOCKED',
    reason: `reason-${suffix}`,
    message: `message-${suffix}`,
    correlation: `corr-${suffix}`,
    createdAt,
  });
}

function assertMetadata(event, expected) {
  assert.equal(event.severity, expected.severity ?? null);
  assert.equal(event.source, expected.source ?? null);
  assert.equal(event.strategy, expected.strategy ?? null);
  assert.equal(event.status, expected.status ?? null);
  assert.equal(event.reason, expected.reason ?? null);
  assert.equal(event.message, expected.message ?? null);
  assert.equal(event.correlation, expected.correlation ?? null);
  assert.equal(event.createdAt, expected.createdAt);
}

test('v2 event rows migrate additively and map only created_at from the exact legacy ts', () => {
  const dataDir = tempDataDir('migration');
  seedV2Ledger(dataDir);
  const ledger = new Ledger(dataDir);
  try {
    assert.equal(ledger.db.pragma('user_version', { simple: true }), 3);
    assert.deepEqual(
      ledger.db.prepare('SELECT current_schema_version, rollback_floor FROM ledger_schema_compatibility').get(),
      { current_schema_version: 3, rollback_floor: 3 },
    );
    assert.deepEqual(
      ledger.db.prepare('PRAGMA table_info(events)').all().map((column) => column.name),
      EVENT_COLUMNS,
    );
    const raw = ledger.db.prepare(`
      SELECT severity, source, strategy, status, reason, message, correlation, created_at
      FROM events WHERE kind = 'legacy.audit'
    `).get();
    assert.deepEqual(raw, {
      severity: null,
      source: null,
      strategy: null,
      status: null,
      reason: null,
      message: null,
      correlation: null,
      created_at: LEGACY_TS,
    });
    const legacy = ledger.recentEvents(1, 'legacy.audit')[0];
    assert.deepEqual(legacy, {
      id: 1,
      ts: LEGACY_TS,
      kind: 'legacy.audit',
      symbol: 'BTCUSDT',
      data: { legacy: true },
      severity: null,
      source: null,
      strategy: null,
      status: null,
      reason: null,
      message: null,
      correlation: null,
      createdAt: LEGACY_TS,
    });
  } finally {
    ledger.close();
  }

  const reopened = new Ledger(dataDir);
  try {
    assert.equal(reopened.recentEvents(1, 'legacy.audit')[0].createdAt, LEGACY_TS);
  } finally {
    reopened.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('partial v3 event envelopes fail closed without advancing or erasing v2 truth', () => {
  const dataDir = tempDataDir('partial');
  seedV2Ledger(dataDir, true);
  assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_SCHEMA_MALFORMED/);

  const db = new Database(path.join(dataDir, 'cosmos.db'));
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 2);
    assert.equal(db.prepare('SELECT current_schema_version FROM ledger_schema_compatibility').get().current_schema_version, 2);
    assert.deepEqual(
      db.prepare('PRAGMA table_info(events)').all().map((column) => column.name),
      ['id', 'ts', 'kind', 'symbol', 'data', 'severity'],
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM events').get().count, 1);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a versioned ledger missing the sole events table fails before recreating empty history', () => {
  const dataDir = tempDataDir('missing-events');
  seedV2WithoutEventTable(dataDir);
  assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_SCHEMA_MISSING/);

  const db = new Database(path.join(dataDir, 'cosmos.db'));
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 2);
    assert.equal(db.prepare('SELECT current_schema_version FROM ledger_schema_compatibility').get().current_schema_version, 2);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'events'").get().count,
      0,
    );
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a complete v3 physical envelope beside the v2 marker fails as split-brain truth', () => {
  const dataDir = tempDataDir('marker-split');
  seedV2Ledger(dataDir);
  addCompleteV3EnvelopeWithoutAdvancingMarker(dataDir);
  assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_SCHEMA_VERSION_MISMATCH/);

  const db = new Database(path.join(dataDir, 'cosmos.db'));
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 2);
    assert.equal(db.prepare('SELECT current_schema_version FROM ledger_schema_compatibility').get().current_schema_version, 2);
    assert.equal(db.prepare('SELECT created_at FROM events WHERE id = 1').get().created_at, LEGACY_TS);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('completed v3 storage never masks a missing authoritative created_at on restart', () => {
  const dataDir = tempDataDir('created-at-corrupt');
  const ledger = new Ledger(dataDir);
  ledger.logEvent('v3.corrupt-target');
  ledger.close();

  const corrupt = new Database(path.join(dataDir, 'cosmos.db'));
  corrupt.prepare("UPDATE events SET created_at = NULL WHERE kind = 'v3.corrupt-target'").run();
  corrupt.close();

  assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_CREATED_AT_MALFORMED/);
  const readback = new Database(path.join(dataDir, 'cosmos.db'));
  try {
    assert.equal(readback.pragma('user_version', { simple: true }), 3);
    assert.equal(readback.prepare("SELECT created_at FROM events WHERE kind = 'v3.corrupt-target'").get().created_at, null);
  } finally {
    readback.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('log, atomic batch, config audit and CAS preserve the full v3 envelope through every query path', () => {
  const dataDir = tempDataDir('roundtrip');
  const originalNow = Date.now;
  Date.now = () => RECEIPT_TS;
  const ledger = new Ledger(dataDir);
  try {
    const directMetadata = fullMetadata('direct');
    const direct = ledger.logEvent('v3.direct', 'BTCUSDT', { payload: 'direct' }, directMetadata);
    assert.equal(direct.ts, RECEIPT_TS);
    assertMetadata(direct, directMetadata);

    const batchMetadata = fullMetadata('batch', RECEIPT_TS - 200);
    const batch = ledger.logEventsAtomically([
      { kind: 'v3.batch.one', symbol: 'ETHUSDT', data: { ordinal: 1 }, ...batchMetadata },
      { kind: 'v3.batch.two', data: { ordinal: 2 }, status: 'RECORDED', correlation: 'corr-batch-two' },
    ]);
    assert.equal(batch.length, 2);
    assertMetadata(batch[0], batchMetadata);
    assertMetadata(batch[1], {
      status: 'RECORDED',
      correlation: 'corr-batch-two',
      createdAt: RECEIPT_TS,
    });

    const configMetadata = fullMetadata('config', RECEIPT_TS - 300);
    const configEvent = ledger.setConfigValueAndLogEvent(
      'v3.config',
      'revision-1',
      'v3.config.audit',
      null,
      { revision: 1 },
      configMetadata,
    );
    assert.equal(ledger.getConfigValue('v3.config'), 'revision-1');
    assertMetadata(configEvent, configMetadata);

    const casMetadata = fullMetadata('cas', RECEIPT_TS - 400);
    ledger.on('event', () => { throw new Error('hostile listener'); });
    const committed = ledger.compareAndSetConfigValueAndLogEvents(
      'v3.cas',
      null,
      'revision-1',
      [{ kind: 'v3.cas.audit', data: { revision: 1 }, ...casMetadata }],
    );
    assert.equal(committed.committed, true);
    assertMetadata(committed.events[0], casMetadata);

    const beforeConflict = ledger.countEvents();
    const conflict = ledger.compareAndSetConfigValueAndLogEvents(
      'v3.cas',
      null,
      'revision-2',
      [{ kind: 'v3.cas.conflict', ...fullMetadata('conflict') }],
    );
    assert.deepEqual(conflict, {
      committed: false,
      reason: 'VERSION_CONFLICT',
      currentValue: 'revision-1',
    });
    assert.equal(ledger.countEvents(), beforeConflict);

    const beforeInvalidBatch = ledger.countEvents();
    assert.throws(() => ledger.logEventsAtomically([
      { kind: 'v3.rollback.one', correlation: 'corr-rollback' },
      { kind: 'v3.rollback.two', createdAt: -1 },
    ]), /invalid ledger event createdAt/);
    assert.equal(ledger.countEvents(), beforeInvalidBatch);

    assertMetadata(ledger.lastEvent('v3.direct'), directMetadata);
    assertMetadata(ledger.eventsSince(RECEIPT_TS, 'v3.batch.one')[0], batchMetadata);
    assertMetadata(ledger.firstEventSince(RECEIPT_TS, 'v3.config.audit'), configMetadata);
    assertMetadata(ledger.recentEvents(1, undefined, undefined, 'corr-cas')[0], casMetadata);
    assert.equal(ledger.countEvents(undefined, undefined, 'reason-config'), 1);
    assert.deepEqual(
      ledger.db.prepare(`
        SELECT severity, source, strategy, status, reason, message, correlation, created_at
        FROM events WHERE id = ?
      `).get(direct.id),
      {
        severity: directMetadata.severity,
        source: directMetadata.source,
        strategy: directMetadata.strategy,
        status: directMetadata.status,
        reason: directMetadata.reason,
        message: directMetadata.message,
        correlation: directMetadata.correlation,
        created_at: directMetadata.createdAt,
      },
    );
  } finally {
    ledger.close();
    Date.now = originalNow;
  }

  const reopened = new Ledger(dataDir);
  try {
    assertMetadata(reopened.lastEvent('v3.cas.audit'), fullMetadata('cas', RECEIPT_TS - 400));
  } finally {
    reopened.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
