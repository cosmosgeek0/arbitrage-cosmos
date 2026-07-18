import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function writeLegacyMarker(dataDir, dataSchema = 1) {
  writeFileSync(path.join(dataDir, 'journal-compat.json'), `${JSON.stringify({
    dataSchema,
    rollbackFloor: 0,
    updatedAtUtc: '2026-07-13T00:00:00Z',
    updatedBy: 'deploy.sh',
  })}\n`);
}

function createV3Events(db, severityDeclaration = 'severity TEXT') {
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      symbol TEXT,
      data TEXT,
      ${severityDeclaration},
      source TEXT,
      strategy TEXT,
      status TEXT,
      reason TEXT,
      message TEXT,
      correlation TEXT,
      created_at INTEGER
    );
    CREATE INDEX idx_events_ts ON events (ts DESC);
    CREATE INDEX idx_events_kind ON events (kind, ts DESC);
    CREATE INDEX idx_events_correlation ON events (correlation, id DESC);
  `);
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

test('rank42 incident event indexes and immutable triggers survive the exact v2-to-v3 upgrade', () => {
  const dataDir = tempDataDir('rank42-incident-authority');
  seedV2Ledger(dataDir);
  const db = new Database(path.join(dataDir, 'cosmos.db'));
  db.exec(`
    CREATE TABLE product_incident_source_dispositions (
      source_event_id INTEGER PRIMARY KEY REFERENCES events(id),
      disposition_event_id INTEGER NOT NULL UNIQUE REFERENCES events(id),
      previous_source_event_id INTEGER NOT NULL,
      previous_disposition_event_id INTEGER NOT NULL,
      processed_count INTEGER NOT NULL UNIQUE CHECK(processed_count >= 1),
      chain_digest TEXT NOT NULL UNIQUE CHECK(length(chain_digest) = 64)
    );
    CREATE TRIGGER product_incident_checkpoint_events_no_update
      BEFORE UPDATE ON events
      WHEN EXISTS (
        SELECT 1 FROM product_incident_source_dispositions
        WHERE source_event_id = OLD.id OR disposition_event_id = OLD.id
      )
      BEGIN SELECT RAISE(ABORT, 'product incident checkpoint evidence is immutable'); END;
    CREATE TRIGGER product_incident_checkpoint_events_no_delete
      BEFORE DELETE ON events
      WHEN EXISTS (
        SELECT 1 FROM product_incident_source_dispositions
        WHERE source_event_id = OLD.id OR disposition_event_id = OLD.id
      )
      BEGIN SELECT RAISE(ABORT, 'product incident checkpoint evidence is immutable'); END;
    CREATE INDEX idx_events_product_incident_source ON events(kind, id);
    CREATE UNIQUE INDEX idx_events_product_incident_disposition_source_event
      ON events(
        CASE WHEN json_valid(data)
          THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END
      )
      WHERE kind IN (
        'product.incident.opened', 'product.incident.grouped', 'product.incident.resolved',
        'product.incident.source_ignored'
      )
        AND json_valid(data)
        AND json_extract(data, '$.schema') IN (
          'cosmos.product-incident-route.v1',
          'cosmos.product-incident-source-disposition.v1'
        );
    CREATE INDEX idx_events_product_incident_disposition_stream
      ON events(
        CASE WHEN json_valid(data) THEN json_extract(data, '$.rootComponentId') END,
        CASE WHEN json_valid(data) THEN json_extract(data, '$.sourceGroup') END,
        CASE WHEN json_valid(data)
          THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END DESC,
        id DESC
      )
      WHERE kind IN (
        'product.incident.opened', 'product.incident.grouped', 'product.incident.resolved',
        'product.incident.source_ignored'
      )
        AND json_valid(data)
        AND json_extract(data, '$.schema') IN (
          'cosmos.product-incident-route.v1',
          'cosmos.product-incident-source-disposition.v1'
        );
    CREATE INDEX idx_events_product_incident_route_stream
      ON events(
        CASE WHEN json_valid(data) THEN json_extract(data, '$.rootComponentId') END,
        CASE WHEN json_valid(data) THEN json_extract(data, '$.sourceGroup') END,
        CASE WHEN json_valid(data)
          THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END DESC,
        id DESC
      )
      WHERE kind IN (
        'product.incident.opened', 'product.incident.grouped', 'product.incident.resolved'
      )
        AND json_valid(data)
        AND json_extract(data, '$.schema') = 'cosmos.product-incident-route.v1';
    INSERT INTO events (ts, kind, symbol, data)
      VALUES (${LEGACY_TS + 1}, 'product.incident.source_ignored', NULL, '{}');
    INSERT INTO product_incident_source_dispositions (
      source_event_id, disposition_event_id, previous_source_event_id,
      previous_disposition_event_id, processed_count, chain_digest
    ) VALUES (1, 2, 0, 0, 1, lower(hex(zeroblob(32))));
  `);
  db.close();

  const migrated = new Ledger(dataDir);
  try {
    assert.equal(migrated.db.pragma('user_version', { simple: true }), 3);
    assert.equal(migrated.countEvents('legacy.audit'), 1);
    assert.deepEqual(
      migrated.db.prepare('SELECT id, created_at FROM events ORDER BY id').all(),
      [
        { id: 1, created_at: LEGACY_TS },
        { id: 2, created_at: LEGACY_TS + 1 },
      ],
    );
    assert.deepEqual(
      migrated.db.prepare('PRAGMA index_list(events)').all().map((row) => row.name).sort(),
      [
        'idx_events_correlation',
        'idx_events_kind',
        'idx_events_product_incident_disposition_source_event',
        'idx_events_product_incident_disposition_stream',
        'idx_events_product_incident_route_stream',
        'idx_events_product_incident_source',
        'idx_events_ts',
      ],
    );
    assert.deepEqual(
      migrated.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND tbl_name = 'events'
        ORDER BY name
      `).all().map((row) => row.name),
      [
        'product_incident_checkpoint_events_no_delete',
        'product_incident_checkpoint_events_no_update',
      ],
    );
    assert.throws(
      () => migrated.db.prepare("UPDATE events SET message = 'mutated' WHERE id = 1").run(),
      /product incident checkpoint evidence is immutable/,
    );
  } finally {
    migrated.close();
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

test('legacy marker lineage cannot manufacture missing event history or adopt unmarked v3 storage', async (t) => {
  await t.test('marker without a database', () => {
    const dataDir = tempDataDir('legacy-marker-missing');
    writeLegacyMarker(dataDir);
    assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_SCHEMA_MISSING/);
    const db = new Database(path.join(dataDir, 'cosmos.db'));
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'events'").get().count,
        0,
      );
      assert.equal(db.pragma('user_version', { simple: true }), 0);
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  await t.test('v1 marker beside a complete unversioned v3 table', () => {
    const dataDir = tempDataDir('legacy-marker-v3');
    const db = new Database(path.join(dataDir, 'cosmos.db'));
    createV3Events(db);
    db.close();
    writeLegacyMarker(dataDir);

    assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_SCHEMA_VERSION_MISMATCH/);
    const readback = new Database(path.join(dataDir, 'cosmos.db'));
    try {
      assert.equal(readback.pragma('user_version', { simple: true }), 0);
      assert.equal(
        readback.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'events'").get().count,
        1,
      );
    } finally {
      readback.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  await t.test('legacy marker beside a competing compatibility owner', () => {
    const dataDir = tempDataDir('legacy-marker-collision');
    const db = new Database(path.join(dataDir, 'cosmos.db'));
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        symbol TEXT,
        data TEXT
      );
      CREATE TABLE ledger_schema_compatibility (
        singleton INTEGER PRIMARY KEY,
        current_schema_version INTEGER,
        rollback_floor INTEGER
      );
      INSERT INTO ledger_schema_compatibility VALUES (1, 1, 1);
    `);
    db.close();
    writeLegacyMarker(dataDir);
    assert.throws(() => new Ledger(dataDir), /LEDGER_SCHEMA_COMPATIBILITY_LEGACY_COLLISION/);
    const readback = new Database(path.join(dataDir, 'cosmos.db'));
    try {
      assert.deepEqual(
        readback.prepare('PRAGMA table_info(events)').all().map((column) => column.name),
        ['id', 'ts', 'kind', 'symbol', 'data'],
      );
      assert.equal(readback.pragma('user_version', { simple: true }), 0);
    } finally {
      readback.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

test('event physical authority rejects rowid reuse, defaults, indexes, foreign keys and triggers', async (t) => {
  await t.test('legacy primary key without AUTOINCREMENT', () => {
    const dataDir = tempDataDir('no-autoincrement');
    const db = new Database(path.join(dataDir, 'cosmos.db'));
    db.exec(`
      CREATE TABLE ledger_schema_compatibility (
        singleton INTEGER NOT NULL PRIMARY KEY,
        current_schema_version INTEGER NOT NULL,
        rollback_floor INTEGER NOT NULL
      );
      INSERT INTO ledger_schema_compatibility VALUES (1, 2, 2);
      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        symbol TEXT,
        data TEXT
      );
    `);
    createExactV2Fills(db);
    db.pragma('user_version = 2');
    db.close();

    assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_SCHEMA_MALFORMED/);
    const readback = new Database(path.join(dataDir, 'cosmos.db'));
    try {
      assert.equal(readback.pragma('user_version', { simple: true }), 2);
      assert.deepEqual(
        readback.prepare('PRAGMA table_info(events)').all().map((column) => column.name),
        ['id', 'ts', 'kind', 'symbol', 'data'],
      );
    } finally {
      readback.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  await t.test('v3 metadata default', () => {
    const dataDir = tempDataDir('metadata-default');
    const db = new Database(path.join(dataDir, 'cosmos.db'));
    db.exec(`
      CREATE TABLE ledger_schema_compatibility (
        singleton INTEGER NOT NULL PRIMARY KEY,
        current_schema_version INTEGER NOT NULL,
        rollback_floor INTEGER NOT NULL
      );
      INSERT INTO ledger_schema_compatibility VALUES (1, 3, 3);
    `);
    createV3Events(db, "severity TEXT DEFAULT 'INFO'");
    createExactV2Fills(db);
    db.pragma('user_version = 3');
    db.close();

    assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_SCHEMA_MALFORMED/);
    const readback = new Database(path.join(dataDir, 'cosmos.db'));
    try {
      assert.equal(
        readback.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'product_commands'").get().count,
        0,
      );
    } finally {
      readback.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  await t.test('wrong same-name index', () => {
    const dataDir = tempDataDir('wrong-index');
    const ledger = new Ledger(dataDir);
    ledger.close();
    const db = new Database(path.join(dataDir, 'cosmos.db'));
    db.exec('DROP INDEX idx_events_ts; CREATE INDEX idx_events_ts ON events (ts ASC);');
    db.close();
    assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_INDEX_SCHEMA_MALFORMED/);
    rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test('foreign key on the owned events table', () => {
    const dataDir = tempDataDir('event-foreign-key');
    const db = new Database(path.join(dataDir, 'cosmos.db'));
    db.exec(`
      CREATE TABLE ledger_schema_compatibility (
        singleton INTEGER NOT NULL PRIMARY KEY,
        current_schema_version INTEGER NOT NULL,
        rollback_floor INTEGER NOT NULL
      );
      INSERT INTO ledger_schema_compatibility VALUES (1, 2, 2);
      CREATE TABLE event_parents (id INTEGER PRIMARY KEY);
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT REFERENCES event_parents(id),
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        symbol TEXT,
        data TEXT
      );
    `);
    createExactV2Fills(db);
    db.pragma('user_version = 2');
    db.close();
    assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_SCHEMA_MALFORMED/);
    rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test('trigger on the owned events table', () => {
    const dataDir = tempDataDir('event-trigger');
    const ledger = new Ledger(dataDir);
    ledger.close();
    const db = new Database(path.join(dataDir, 'cosmos.db'));
    db.exec('CREATE TRIGGER hostile_events AFTER INSERT ON events BEGIN DELETE FROM events; END;');
    db.close();
    assert.throws(() => new Ledger(dataDir), /LEDGER_EVENT_TRIGGER_SCHEMA_MALFORMED/);
    rmSync(dataDir, { recursive: true, force: true });
  });
});

test('v2 AUTOINCREMENT high-water survives migration, pruning and reopen', () => {
  const dataDir = tempDataDir('autoincrement-high-water');
  seedV2Ledger(dataDir);
  const db = new Database(path.join(dataDir, 'cosmos.db'));
  db.prepare("UPDATE events SET kind = 'heartbeat' WHERE id = 1").run();
  db.close();

  const ledger = new Ledger(dataDir);
  let appendedId;
  try {
    assert.equal(ledger.pruneEphemeralEvents(LEGACY_TS + (2 * 24 * 60 * 60 * 1_000), 10), 1);
    appendedId = ledger.logEvent('v3.after-prune').id;
    assert.ok(appendedId > 1);
  } finally {
    ledger.close();
  }
  const reopened = new Ledger(dataDir);
  try {
    assert.ok(reopened.logEvent('v3.after-reopen').id > appendedId);
  } finally {
    reopened.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('completed v3 storage reapplies every event-metadata write bound on read and restart', async (t) => {
  const corruptions = Object.freeze([
    { field: 'severity', value: '', code: 'LEDGER_EVENT_SEVERITY_MALFORMED' },
    { field: 'source', value: 's'.repeat(257), code: 'LEDGER_EVENT_SOURCE_MALFORMED' },
    { field: 'strategy', value: `basis\u0000hostile`, code: 'LEDGER_EVENT_STRATEGY_MALFORMED' },
    { field: 'status', value: 'S'.repeat(129), code: 'LEDGER_EVENT_STATUS_MALFORMED' },
    { field: 'reason', value: 'r'.repeat(2_049), code: 'LEDGER_EVENT_REASON_MALFORMED' },
    { field: 'message', value: 'm'.repeat(9_000), code: 'LEDGER_EVENT_MESSAGE_MALFORMED' },
    { field: 'correlation', value: 'c'.repeat(257), code: 'LEDGER_EVENT_CORRELATION_MALFORMED' },
    { field: 'created_at', value: null, code: 'LEDGER_EVENT_CREATED_AT_MALFORMED' },
  ]);

  for (const corruption of corruptions) {
    await t.test(corruption.field, () => {
      const dataDir = tempDataDir(`${corruption.field}-corrupt`);
      const kind = `v3.corrupt-${corruption.field.replaceAll('_', '-')}`;
      const ledger = new Ledger(dataDir);
      try {
        ledger.logEvent(kind, null, null, fullMetadata(corruption.field));
        ledger.db.prepare(`UPDATE events SET ${corruption.field} = ? WHERE kind = ?`)
          .run(corruption.value, kind);
        assert.throws(
          () => ledger.recentEvents(1, kind),
          (error) => error instanceof Error && error.message === corruption.code,
        );
      } finally {
        ledger.close();
      }

      assert.throws(
        () => new Ledger(dataDir),
        (error) => error instanceof Error && error.message === corruption.code,
      );
      const readback = new Database(path.join(dataDir, 'cosmos.db'));
      try {
        assert.equal(readback.pragma('user_version', { simple: true }), 3);
        assert.equal(
          readback.prepare(`SELECT ${corruption.field} AS value FROM events WHERE kind = ?`).get(kind).value,
          corruption.value,
        );
      } finally {
        readback.close();
        rmSync(dataDir, { recursive: true, force: true });
      }
    });
  }
});

test('count queries validate every matching metadata row instead of hiding corrupt truth', () => {
  const dataDir = tempDataDir('count-corrupt');
  const ledger = new Ledger(dataDir);
  try {
    ledger.logEvent('v3.count-needle', null, null, fullMetadata('count'));
    ledger.db.prepare("UPDATE events SET severity = '' WHERE kind = 'v3.count-needle'").run();
    for (const query of [
      () => ledger.countEvents(),
      () => ledger.countEvents(undefined, undefined, 'needle'),
      () => ledger.recentEvents(10, undefined, undefined, 'needle'),
    ]) {
      assert.throws(
        query,
        (error) => error instanceof Error && error.message === 'LEDGER_EVENT_SEVERITY_MALFORMED',
      );
    }
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('event metadata is scalar-bounded, Unicode exact and hostile-control closed', () => {
  const dataDir = tempDataDir('unicode');
  const ledger = new Ledger(dataDir);
  const exact = Object.freeze({
    severity: '😀'.repeat(64),
    source: 'مُشغِّل-עברית-operator',
    strategy: 'basis-e\u0301-策略',
    status: 'READY-✅',
    reason: 'Διατήρηση ακριβούς Unicode',
    message: 'Exact 👩🏽‍💻 metadata без normalization',
    correlation: 'corr-東京-🛰️',
    createdAt: RECEIPT_TS,
  });
  try {
    const event = ledger.logEvent('v3.unicode', 'BTCUSDT', { exact: true }, exact);
    assertMetadata(event, exact);
    assertMetadata(ledger.recentEvents(1, 'v3.unicode')[0], exact);
    assert.throws(
      () => ledger.logEvent('v3.unicode.too-long', null, null, { severity: '😀'.repeat(65) }),
      /invalid ledger event severity/,
    );
    for (const value of [
      '\ud800',
      '\udc00',
      '\u0009',
      '\u0085',
      '\u061c',
      '\u202e',
      '\u2066',
    ]) {
      assert.throws(
        () => ledger.logEvent('v3.unicode.hostile', null, null, { message: value }),
        /invalid ledger event message/,
      );
    }
  } finally {
    ledger.close();
  }

  const reopened = new Ledger(dataDir);
  try {
    assertMetadata(reopened.lastEvent('v3.unicode'), exact);
  } finally {
    reopened.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('atomic append snapshots each top-level input once and returns the durable JSON snapshot', () => {
  const dataDir = tempDataDir('atomic-snapshot');
  const ledger = new Ledger(dataDir);
  const reads = Object.create(null);
  const nestedReads = { value: 0 };
  const firstValues = Object.freeze({
    kind: 'v3.atomic-snapshot',
    symbol: 'BTCUSDT',
    data: Object.freeze({
      get payload() {
        nestedReads.value += 1;
        return { ordinal: 1 };
      },
    }),
    severity: 'INFO',
    source: 'test.atomic',
    strategy: 'basis',
    status: 'RECORDED',
    reason: 'captured-once',
    message: 'durable-snapshot',
    correlation: 'corr-atomic-snapshot',
    createdAt: RECEIPT_TS,
  });
  const laterValues = Object.freeze({
    kind: 'INVALID KIND',
    symbol: 7,
    data: { payload: { ordinal: 999 } },
    severity: '',
    source: '',
    strategy: '',
    status: '',
    reason: '',
    message: '',
    correlation: '',
    createdAt: -1,
  });
  const hostile = {};
  for (const field of Object.keys(firstValues)) {
    reads[field] = 0;
    Object.defineProperty(hostile, field, {
      enumerable: true,
      get() {
        reads[field] += 1;
        return reads[field] === 1 ? firstValues[field] : laterValues[field];
      },
    });
  }
  let secondListenerEvent = null;
  ledger.on('event', (event) => {
    event.kind = 'mutated-by-first-listener';
    event.data.payload.ordinal = 999;
  });
  ledger.on('event', (event) => {
    secondListenerEvent = JSON.parse(JSON.stringify(event));
  });

  try {
    const [event] = ledger.logEventsAtomically([hostile]);
    assert.deepEqual({ ...reads }, {
      kind: 1,
      symbol: 1,
      data: 1,
      severity: 1,
      source: 1,
      strategy: 1,
      status: 1,
      reason: 1,
      message: 1,
      correlation: 1,
      createdAt: 1,
    });
    assert.equal(nestedReads.value, 1);
    assert.equal(event.kind, firstValues.kind);
    assert.equal(event.symbol, firstValues.symbol);
    assert.deepEqual(event.data, { payload: { ordinal: 1 } });
    assert.equal(secondListenerEvent.kind, firstValues.kind);
    assert.deepEqual(secondListenerEvent.data, { payload: { ordinal: 1 } });
    assertMetadata(event, firstValues);
    const raw = ledger.db.prepare(`
      SELECT kind, symbol, data, severity, source, strategy, status, reason,
             message, correlation, created_at
      FROM events WHERE id = ?
    `).get(event.id);
    assert.deepEqual(raw, {
      kind: firstValues.kind,
      symbol: firstValues.symbol,
      data: JSON.stringify({ payload: { ordinal: 1 } }),
      severity: firstValues.severity,
      source: firstValues.source,
      strategy: firstValues.strategy,
      status: firstValues.status,
      reason: firstValues.reason,
      message: firstValues.message,
      correlation: firstValues.correlation,
      created_at: firstValues.createdAt,
    });
    assert.throws(
      () => ledger.logEventsAtomically([{ kind: 'v3.atomic-invalid-json-root', data: () => true }]),
      /invalid ledger event data/,
    );
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('config CAS snapshots hostile Proxy getters once before its atomic commit', () => {
  const dataDir = tempDataDir('cas-snapshot');
  const ledger = new Ledger(dataDir);
  const reads = Object.create(null);
  const nestedReads = { value: 0 };
  const firstValues = Object.freeze({
    kind: 'v3.cas-snapshot',
    symbol: 'ETHUSDT',
    data: Object.freeze({
      get payload() {
        nestedReads.value += 1;
        return { ordinal: 1 };
      },
    }),
    severity: 'WARN',
    source: 'test.cas',
    strategy: 'volume',
    status: 'RECORDED',
    reason: 'captured-once',
    message: 'durable-cas-snapshot',
    correlation: 'corr-cas-snapshot',
    createdAt: RECEIPT_TS,
  });
  const laterValues = Object.freeze({
    kind: 'INVALID KIND',
    symbol: 9,
    data: { payload: { ordinal: 999 } },
    severity: '',
    source: '',
    strategy: '',
    status: '',
    reason: '',
    message: '',
    correlation: '',
    createdAt: -1,
  });
  const hostile = {};
  for (const field of Object.keys(firstValues)) {
    reads[field] = 0;
    Object.defineProperty(hostile, field, {
      enumerable: true,
      configurable: true,
      get() {
        reads[field] += 1;
        return reads[field] === 1 ? firstValues[field] : laterValues[field];
      },
    });
  }
  const proxy = new Proxy(hostile, {
    get: Reflect.get,
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
  });

  try {
    const result = ledger.compareAndSetConfigValueAndLogEvents(
      'v3.cas-snapshot',
      null,
      'revision-1',
      [proxy],
    );
    assert.equal(result.committed, true);
    assert.deepEqual({ ...reads }, {
      kind: 1,
      symbol: 1,
      data: 1,
      severity: 1,
      source: 1,
      strategy: 1,
      status: 1,
      reason: 1,
      message: 1,
      correlation: 1,
      createdAt: 1,
    });
    assert.equal(nestedReads.value, 1);
    const [event] = result.events;
    assert.equal(event.kind, firstValues.kind);
    assert.equal(event.symbol, firstValues.symbol);
    assert.deepEqual(event.data, { payload: { ordinal: 1 } });
    assertMetadata(event, firstValues);
    assert.deepEqual(
      ledger.db.prepare(`
        SELECT kind, symbol, data, severity, source, strategy, status, reason,
               message, correlation, created_at
        FROM events WHERE id = ?
      `).get(event.id),
      {
        kind: firstValues.kind,
        symbol: firstValues.symbol,
        data: JSON.stringify({ payload: { ordinal: 1 } }),
        severity: firstValues.severity,
        source: firstValues.source,
        strategy: firstValues.strategy,
        status: firstValues.status,
        reason: firstValues.reason,
        message: firstValues.message,
        correlation: firstValues.correlation,
        created_at: firstValues.createdAt,
      },
    );
  } finally {
    ledger.close();
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
