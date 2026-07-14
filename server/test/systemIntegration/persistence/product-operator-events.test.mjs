import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Ledger, PRODUCT_OPERATOR_EVENT_RETENTION_MAX } from '../../../dist/ledger.js';

const T0 = 1_800_000_000_000;
const LEDGER_KIND = 'system.integration.trace';

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-product-operator-events-'));
}

function materialAudit(seed, sequence, traceKind = 'STRATEGY', eventId = `material.${seed}`) {
  const componentId = traceKind === 'CONTROL' ? 'engine-supervisor' : 'basis-engine';
  const correlationId = `cor.material.${seed}`;
  const occurredAtMs = T0 + sequence;
  return Object.freeze({
    schema: 'cosmos.system-integration.audit',
    version: 1,
    auditKind: 'TRACE',
    correlationId,
    occurredAtMs,
    checkpointRevision: sequence,
    checkpointChecksum: 'a'.repeat(64),
    trace: Object.freeze({
      id: eventId,
      sequence,
      kind: traceKind,
      componentId,
      correlationId,
      occurredAtMs,
      persistedAtMs: null,
      truthLabel: 'DRY_RUN',
      releaseStatuses: Object.freeze(['BUILT_AND_TESTED', 'WIRED']),
      ownerId: componentId,
      canonicalProjectionId: null,
      revisionDigest: null,
      domainLifecycle: 'READY',
      machinePhase: 'RUNNING',
      failure: null,
      referenceIds: Object.freeze([]),
      lossCodes: Object.freeze([]),
    }),
  });
}

test('migration creates the exact dedicated table, foreign key, indexes, and valid empty cursor zero', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const columns = ledger.db.prepare('PRAGMA table_info(product_operator_events)').all();
    assert.deepEqual(columns.map((column) => column.name), [
      'cursor',
      'ledger_event_id',
      'event_id',
      'component_id',
      'correlation_id',
      'occurred_at_ms',
      'persisted_at_ms',
      'material_projection_json',
    ]);
    assert.equal(columns[0].type, 'INTEGER');
    assert.equal(columns[0].pk, 1);
    assert.equal(ledger.db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(ledger.db.prepare('PRAGMA foreign_key_list(product_operator_events)').all().map((row) => ({
      table: row.table,
      from: row.from,
      to: row.to,
    })), [{ table: 'events', from: 'ledger_event_id', to: 'id' }]);

    const indexes = new Set(ledger.db.prepare('PRAGMA index_list(product_operator_events)').all().map((row) => row.name));
    assert.ok(indexes.has('idx_product_operator_events_correlation_cursor'));
    assert.ok(indexes.has('idx_product_operator_events_component_cursor'));
    assert.deepEqual(
      ledger.db.prepare('PRAGMA index_info(idx_product_operator_events_correlation_cursor)').all().map((row) => row.name),
      ['correlation_id', 'cursor'],
    );
    assert.deepEqual(
      ledger.db.prepare('PRAGMA index_xinfo(idx_product_operator_events_component_cursor)').all()
        .filter((row) => row.key === 1)
        .map((row) => ({ name: row.name, desc: row.desc })),
      [{ name: 'component_id', desc: 0 }, { name: 'cursor', desc: 1 }],
    );

    assert.deepEqual(ledger.readProductOperatorEventPage('0', 10), {
      requestedAfterCursor: '0',
      retainedFromCursor: null,
      highWaterCursor: '0',
      continuity: 'PROVEN',
      truncated: false,
      items: [],
    });
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('setConfigValueAndLogEvent commits one supplied material trace with its ledger row and persistence time', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const audit = materialAudit('set-path', 1);
    const event = ledger.setConfigValueAndLogEvent('operator.test.set', '{"revision":1}', LEDGER_KIND, null, audit);
    const page = ledger.readProductOperatorEventPage('0', 10);
    assert.equal(ledger.getConfigValue('operator.test.set'), '{"revision":1}');
    assert.equal(page.continuity, 'PROVEN');
    assert.equal(page.truncated, false);
    assert.equal(page.retainedFromCursor, '1');
    assert.equal(page.highWaterCursor, '1');
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].cursor, '1');
    assert.equal(page.items[0].event.id, audit.trace.id);
    assert.equal(page.items[0].event.persistedAtMs, event.ts);
    assert.equal(page.items[0].event.truthLabel, audit.trace.truthLabel);

    const durable = ledger.db.prepare('SELECT * FROM product_operator_events').get();
    assert.equal(durable.ledger_event_id, event.id);
    assert.equal(durable.event_id, audit.trace.id);
    assert.deepEqual(JSON.parse(durable.material_projection_json), page.items[0].event);

    const nonMaterial = materialAudit('non-material', 2, 'PERSISTENCE');
    ledger.setConfigValueAndLogEvent('operator.test.non-material', '{"revision":2}', LEDGER_KIND, null, nonMaterial);
    const invalid = structuredClone(materialAudit('invalid', 3));
    invalid.trace.sequence = 0;
    ledger.setConfigValueAndLogEvent('operator.test.invalid', '{"revision":3}', LEDGER_KIND, null, invalid);
    assert.equal(ledger.countEvents(LEDGER_KIND), 3);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM product_operator_events').get().count, 1);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('CAS inserts material operator truth atomically and a stale conflict appends no ledger or cursor row', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const committed = ledger.compareAndSetConfigValueAndLogEvents(
      'operator.test.cas',
      null,
      '{"revision":1}',
      [{ kind: LEDGER_KIND, data: materialAudit('cas-winner', 1) }],
    );
    assert.equal(committed.committed, true);
    assert.equal(committed.events.length, 1);
    const winnerPage = ledger.readProductOperatorEventPage('0', 10);
    assert.deepEqual(winnerPage.items.map((item) => item.event.id), ['material.cas-winner']);
    assert.equal(winnerPage.items[0].event.persistedAtMs, committed.events[0].ts);

    const ledgerRowsBefore = ledger.countEvents(LEDGER_KIND);
    const operatorRowsBefore = ledger.db.prepare('SELECT COUNT(*) AS count FROM product_operator_events').get().count;
    const stale = ledger.compareAndSetConfigValueAndLogEvents(
      'operator.test.cas',
      null,
      '{"revision":2}',
      [{ kind: LEDGER_KIND, data: materialAudit('cas-stale', 2) }],
    );
    assert.deepEqual(stale, {
      committed: false,
      reason: 'VERSION_CONFLICT',
      currentValue: '{"revision":1}',
    });
    assert.equal(ledger.countEvents(LEDGER_KIND), ledgerRowsBefore);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM product_operator_events').get().count, operatorRowsBefore);
    assert.equal(ledger.readProductOperatorEventPage('0', 10).highWaterCursor, '1');
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('operator insert failure and duplicate event identity roll back config, ledger, and cursor together', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    ledger.setConfigValue('operator.test.rollback', '{"revision":0}');
    ledger.db.exec(`
      CREATE TRIGGER reject_product_operator_event
      BEFORE INSERT ON product_operator_events
      BEGIN SELECT RAISE(ABORT, 'operator append rejected'); END;
    `);
    assert.throws(
      () => ledger.setConfigValueAndLogEvent(
        'operator.test.rollback',
        '{"revision":1}',
        LEDGER_KIND,
        null,
        materialAudit('rollback', 1),
      ),
      /operator append rejected/,
    );
    ledger.db.exec('DROP TRIGGER reject_product_operator_event');
    assert.equal(ledger.getConfigValue('operator.test.rollback'), '{"revision":0}');
    assert.equal(ledger.countEvents(LEDGER_KIND), 0);
    assert.equal(ledger.readProductOperatorEventPage('0', 10).highWaterCursor, '0');

    const duplicateId = 'material.duplicate';
    ledger.setConfigValueAndLogEvent(
      'operator.test.duplicate',
      '{"revision":1}',
      LEDGER_KIND,
      null,
      materialAudit('duplicate-one', 2, 'STRATEGY', duplicateId),
    );
    assert.throws(
      () => ledger.setConfigValueAndLogEvent(
        'operator.test.duplicate',
        '{"revision":2}',
        LEDGER_KIND,
        null,
        materialAudit('duplicate-two', 3, 'STRATEGY', duplicateId),
      ),
      /UNIQUE constraint failed: product_operator_events.event_id/,
    );
    assert.equal(ledger.getConfigValue('operator.test.duplicate'), '{"revision":1}');
    assert.equal(ledger.countEvents(LEDGER_KIND), 1);
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM product_operator_events').get().count, 1);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('post-commit listener close and throw cannot forge failure or mutate durable readback', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  let reopened;
  try {
    const audit = materialAudit('listener', 1);
    ledger.on('event', (event) => {
      event.data.trace.id = 'listener.mutation';
      ledger.close();
      throw new Error('listener failed after commit');
    });
    const committed = ledger.setConfigValueAndLogEvent(
      'operator.test.listener',
      '{"revision":1}',
      LEDGER_KIND,
      null,
      audit,
    );
    assert.equal(committed.data.trace.id, audit.trace.id);

    reopened = new Ledger(dataDir);
    assert.equal(reopened.getConfigValue('operator.test.listener'), '{"revision":1}');
    assert.equal(reopened.countEvents(LEDGER_KIND), 1);
    const page = reopened.readProductOperatorEventPage('0', 10);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].event.id, audit.trace.id);
    assert.equal(page.items[0].event.persistedAtMs, committed.ts);
  } finally {
    ledger.close();
    reopened?.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('transactional retention keeps the newest fixed window, audit history, floor, and monotonic high-water', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    const insertLedger = ledger.db.prepare(
      "INSERT INTO events (ts, kind, symbol, data) VALUES (?, 'retention.seed', NULL, '{}')",
    );
    const insertOperator = ledger.db.prepare(`
      INSERT INTO product_operator_events (
        ledger_event_id,
        event_id,
        component_id,
        correlation_id,
        occurred_at_ms,
        persisted_at_ms,
        material_projection_json
      ) VALUES (?, ?, 'basis-engine', 'cor.retention.seed', ?, ?, '{}')
    `);
    ledger.db.transaction(() => {
      for (let cursor = 1; cursor <= PRODUCT_OPERATOR_EVENT_RETENTION_MAX; cursor += 1) {
        const inserted = insertLedger.run(T0 + cursor);
        insertOperator.run(Number(inserted.lastInsertRowid), `retention.seed.${cursor}`, T0 + cursor, T0 + cursor);
      }
    })();

    const material = materialAudit('retention-newest', PRODUCT_OPERATOR_EVENT_RETENTION_MAX + 1);
    ledger.setConfigValueAndLogEvent(
      'operator.test.retention',
      '{"revision":1}',
      LEDGER_KIND,
      null,
      material,
    );
    const geometry = ledger.db.prepare(`
      SELECT COUNT(*) AS count, MIN(cursor) AS floor, MAX(cursor) AS maximum
      FROM product_operator_events
    `).get();
    assert.deepEqual(geometry, {
      count: PRODUCT_OPERATOR_EVENT_RETENTION_MAX,
      floor: 2,
      maximum: PRODUCT_OPERATOR_EVENT_RETENTION_MAX + 1,
    });
    assert.equal(ledger.countEvents(), PRODUCT_OPERATOR_EVENT_RETENTION_MAX + 1);
    assert.ok(ledger.db.prepare('SELECT id FROM events WHERE id = 1').get());

    const page = ledger.readProductOperatorEventPage('0', 10);
    assert.equal(page.retainedFromCursor, '2');
    assert.equal(page.highWaterCursor, String(PRODUCT_OPERATOR_EVENT_RETENTION_MAX + 1));
    assert.equal(page.continuity, 'GAP');
    assert.equal(page.truncated, true);
    assert.deepEqual(page.items, []);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cursor pages expose prefix truncation, interior gaps, missing requested cursors, and corrupt projections', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    for (let sequence = 1; sequence <= 4; sequence += 1) {
      ledger.setConfigValueAndLogEvent(
        `operator.test.cursor.${sequence}`,
        `{"revision":${sequence}}`,
        LEDGER_KIND,
        null,
        materialAudit(`cursor-${sequence}`, sequence),
      );
    }
    const first = ledger.readProductOperatorEventPage('0', 2);
    assert.deepEqual({
      retained: first.retainedFromCursor,
      highWater: first.highWaterCursor,
      continuity: first.continuity,
      truncated: first.truncated,
      cursors: first.items.map((item) => item.cursor),
    }, {
      retained: '1', highWater: '4', continuity: 'PROVEN', truncated: false, cursors: ['1', '2'],
    });
    assert.deepEqual(ledger.readProductOperatorEventPage('2', 2).items.map((item) => item.cursor), ['3', '4']);

    ledger.db.prepare('DELETE FROM product_operator_events WHERE cursor = 1').run();
    const truncated = ledger.readProductOperatorEventPage('0', 10);
    assert.deepEqual({
      retained: truncated.retainedFromCursor,
      highWater: truncated.highWaterCursor,
      continuity: truncated.continuity,
      truncated: truncated.truncated,
      cursors: truncated.items.map((item) => item.cursor),
    }, {
      retained: '2', highWater: '4', continuity: 'GAP', truncated: true, cursors: [],
    });

    ledger.db.prepare('DELETE FROM product_operator_events WHERE cursor = 3').run();
    const internalGap = ledger.readProductOperatorEventPage('1', 10);
    assert.equal(internalGap.continuity, 'GAP');
    assert.equal(internalGap.truncated, false);
    assert.deepEqual(internalGap.items.map((item) => item.cursor), ['2']);
    const missingRequested = ledger.readProductOperatorEventPage('3', 10);
    assert.equal(missingRequested.continuity, 'GAP');
    assert.equal(missingRequested.truncated, false);
    assert.deepEqual(missingRequested.items, []);

    ledger.db.prepare("UPDATE product_operator_events SET material_projection_json = '{}' WHERE cursor = 2").run();
    const corrupt = ledger.readProductOperatorEventPage('1', 10);
    assert.equal(corrupt.continuity, 'UNPROVEN');
    assert.equal(corrupt.truncated, false);
    assert.deepEqual(corrupt.items, []);
    assert.equal(corrupt.highWaterCursor, '4');

    assert.equal(ledger.readProductOperatorEventPage('5', 10).continuity, 'UNPROVEN');
    assert.throws(() => ledger.readProductOperatorEventPage('01', 10), /canonical non-negative decimal/);
    assert.throws(() => ledger.readProductOperatorEventPage('0', 0), /limit must be 1-500/);
    assert.throws(() => ledger.readProductOperatorEventPage('9223372036854775808', 10), /exceeds SQLite rowid/);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
