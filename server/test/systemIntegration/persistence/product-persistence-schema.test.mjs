import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { Ledger } from '../../../dist/ledger.js';
import { SystemLedgerPersistenceAdapter } from '../../../dist/systemIntegration/persistence/ledgerAdapter.js';

const T0 = 1_800_000_000_000;
const AUDIT_KIND = 'system.integration.product.persistence';

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-product-persistence-'));
}

function digest(character) {
  return character.repeat(64);
}

function audit(seed) {
  return Object.freeze({
    kind: AUDIT_KIND,
    symbol: `product.${seed}`,
    data: Object.freeze({
      schema: 'cosmos.product-persistence.audit.v1',
      seed,
      actionAuthority: 'NONE',
    }),
  });
}

function desired(overrides = {}) {
  return Object.freeze({
    componentId: 'basis-engine',
    expectedStateRevision: null,
    desiredState: 'RUNNING',
    stateRevision: 0,
    restartGeneration: 1,
    updatedAtMs: T0,
    correlationId: 'cor.product.desired',
    audit: audit('desired-0'),
    ...overrides,
  });
}

function command(overrides = {}) {
  return Object.freeze({
    commandId: 'command.product.one',
    idempotencyKey: 'idem.product.command.one',
    requestDigest: digest('a'),
    commandType: 'SET_COMPONENT_DESIRED_STATE',
    targetComponentId: 'basis-engine',
    authenticatedOperatorId: 'operator.digest.one',
    reason: 'Owner requested a bounded state transition.',
    requiredAuthority: 'SYSTEM_CONTROL',
    requestPayload: Object.freeze({ desiredState: 'PAUSED', schema: 'product-command.v1' }),
    previewDigest: digest('b'),
    preview: Object.freeze({ effect: 'DRAIN', schema: 'product-command-preview.v1' }),
    expectedRevision: 0,
    resultingRevision: null,
    status: 'PENDING',
    createdAtMs: T0 + 1,
    expiresAtMs: T0 + 60_001,
    completedAtMs: null,
    correlationId: 'cor.product.command',
    beforeProjection: Object.freeze({ desiredState: 'RUNNING' }),
    afterProjection: null,
    result: null,
    audit: audit('command-one'),
    ...overrides,
  });
}

function configRevision(overrides = {}) {
  return Object.freeze({
    configRevision: 'config.revision.one',
    contentDigest: digest('c'),
    status: 'STAGED',
    effectiveAtMs: null,
    createdAtMs: T0 + 2,
    createdByOperatorId: 'operator.digest.one',
    correlationId: 'cor.product.config',
    config: Object.freeze({ schema: 'product-config.v1', posture: 'READ_ONLY' }),
    audit: audit('config-one'),
    ...overrides,
  });
}

function identityReference(overrides = {}) {
  return Object.freeze({
    referenceType: 'POSITION',
    referenceId: 'position.owner.one',
    ownerId: 'capital.positions',
    ownerRevision: 'revision.one',
    expectedResolutionState: null,
    ownerState: 'UNKNOWN',
    resolutionState: 'OPEN',
    correlationId: 'cor.product.position',
    parentReferenceType: null,
    parentReferenceId: null,
    payloadHash: digest('d'),
    ownerProjection: Object.freeze({ exposure: 'UNKNOWN', schema: 'owner-position.v1' }),
    occurredAtMs: T0 + 3,
    validUntilMs: null,
    audit: audit('position-open'),
    ...overrides,
  });
}

function incident(overrides = {}) {
  return Object.freeze({
    incidentId: 'incident.product.one',
    fingerprint: 'fingerprint.product.one',
    rootComponentId: 'basis-engine',
    severity: 'MEDIUM',
    capitalRelevant: true,
    expectedLedgerEventId: null,
    state: 'OPEN',
    firstSeenAtMs: T0 + 4,
    lastSeenAtMs: T0 + 4,
    eventCount: 1,
    acknowledgedAtMs: null,
    acknowledgedByOperatorId: null,
    resolvedAtMs: null,
    correlationId: 'cor.product.incident',
    audit: audit('incident-open'),
    ...overrides,
  });
}

function bootRelease(overrides = {}) {
  return Object.freeze({
    operationId: 'boot.operation.one',
    operationType: 'BOOT',
    expectedLedgerEventId: null,
    generation: 1,
    testedCommit: '1'.repeat(40),
    deployedCommit: null,
    configRevision: 'config.revision.one',
    schemaRevision: 'product-schema.v1',
    modelRevision: null,
    startedAtMs: T0 + 5,
    completedAtMs: null,
    clean: null,
    blockerCode: 'OWNER_GATED',
    correlationId: 'cor.product.boot',
    audit: audit('boot-start'),
    ...overrides,
  });
}

const EXPECTED_COLUMNS = Object.freeze({
  product_component_desired_state: [
    'component_id', 'desired_state', 'state_revision', 'restart_generation',
    'updated_at_ms', 'correlation_id', 'ledger_event_id',
  ],
  product_commands: [
    'command_id', 'idempotency_key', 'request_digest', 'command_type',
    'target_component_id', 'authenticated_operator_id', 'reason',
    'required_authority', 'request_payload_json', 'preview_digest',
    'preview_json', 'expected_revision', 'resulting_revision', 'status',
    'created_at_ms', 'expires_at_ms', 'completed_at_ms', 'correlation_id',
    'before_projection_json', 'after_projection_json', 'result_json',
    'ledger_event_id',
  ],
  product_config_revisions: [
    'config_revision', 'content_digest', 'status', 'effective_at_ms',
    'created_at_ms', 'created_by_operator_id', 'correlation_id',
    'config_json', 'ledger_event_id',
  ],
  product_identity_references: [
    'reference_type', 'reference_id', 'owner_id', 'owner_revision',
    'owner_state', 'resolution_state', 'correlation_id',
    'parent_reference_type', 'parent_reference_id', 'payload_hash',
    'owner_projection_json', 'occurred_at_ms', 'valid_until_ms',
    'ledger_event_id',
  ],
  product_incidents: [
    'incident_id', 'fingerprint', 'root_component_id', 'severity',
    'capital_relevant', 'state', 'first_seen_at_ms', 'last_seen_at_ms',
    'event_count', 'acknowledged_at_ms', 'acknowledged_by_operator_id',
    'resolved_at_ms', 'correlation_id', 'ledger_event_id',
  ],
  product_incident_source_dispositions: [
    'source_event_id', 'disposition_event_id', 'previous_source_event_id',
    'previous_disposition_event_id', 'processed_count', 'chain_digest',
  ],
  product_boot_release_revisions: [
    'operation_id', 'operation_type', 'generation', 'tested_commit',
    'deployed_commit', 'config_revision', 'schema_revision', 'model_revision',
    'started_at_ms', 'completed_at_ms', 'clean', 'blocker_code',
    'correlation_id', 'ledger_event_id',
  ],
});

const INCIDENT_CHECKPOINT_TRIGGER_NAMES = Object.freeze([
  'product_incident_checkpoint_events_no_delete',
  'product_incident_checkpoint_events_no_update',
  'product_incident_source_dispositions_no_delete',
  'product_incident_source_dispositions_no_update',
]);

const INCIDENT_EXPRESSION_INDEX_NAMES = Object.freeze([
  'idx_events_product_incident_disposition_source_event',
  'idx_events_product_incident_disposition_stream',
  'idx_events_product_incident_route_stream',
]);

function assertProductIncidentCheckpointSchema(database) {
  const tableInfo = database.prepare('PRAGMA table_info(product_incident_source_dispositions)').all();
  assert.deepEqual(tableInfo.map((column) => column.name), EXPECTED_COLUMNS.product_incident_source_dispositions);
  assert.equal(tableInfo.find((column) => column.name === 'source_event_id').pk, 1);
  assert.ok(tableInfo.filter((column) => column.name !== 'source_event_id').every((column) => column.pk === 0));
  assert.ok(tableInfo.filter((column) => column.name !== 'source_event_id').every((column) => column.notnull === 1));

  assert.deepEqual(
    database.prepare('PRAGMA foreign_key_list(product_incident_source_dispositions)').all()
      .map((row) => `${row.from}->${row.table}.${row.to}`)
      .sort(),
    ['disposition_event_id->events.id', 'source_event_id->events.id'],
  );

  const checkpointIndexes = database.prepare('PRAGMA index_list(product_incident_source_dispositions)').all();
  const uniqueColumns = checkpointIndexes
    .filter((index) => index.unique === 1)
    .map((index) => database.prepare(`PRAGMA index_info(${index.name})`).all().map((row) => row.name).join(','))
    .sort();
  assert.deepEqual(uniqueColumns, ['chain_digest', 'disposition_event_id', 'processed_count']);

  const tableSql = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='product_incident_source_dispositions'",
  ).get().sql;
  assert.match(tableSql, /processed_count\s+INTEGER\s+NOT\s+NULL\s+UNIQUE\s+CHECK\s*\(\s*processed_count\s*>=\s*1\s*\)/i);
  assert.match(tableSql, /chain_digest\s+TEXT\s+NOT\s+NULL\s+UNIQUE\s+CHECK\s*\(\s*length\s*\(\s*chain_digest\s*\)\s*=\s*64\s*\)/i);

  const triggers = database.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'product_incident_%'
    ORDER BY name ASC
  `).all();
  assert.deepEqual(triggers.map((trigger) => trigger.name), INCIDENT_CHECKPOINT_TRIGGER_NAMES);
  for (const trigger of triggers) {
    assert.match(trigger.sql, /BEFORE\s+(?:UPDATE|DELETE)\s+ON/i);
    assert.match(trigger.sql, /RAISE\s*\(\s*ABORT\s*,\s*'product incident checkpoint (?:history|evidence) is immutable'\s*\)/i);
    if (trigger.name.startsWith('product_incident_checkpoint_events_')) {
      assert.match(trigger.sql, /ON\s+events/i);
      assert.match(trigger.sql, /source_event_id\s*=\s*OLD\.id\s+OR\s+disposition_event_id\s*=\s*OLD\.id/i);
    } else {
      assert.match(trigger.sql, /ON\s+product_incident_source_dispositions/i);
    }
  }

  const expressionIndexes = database.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'index' AND name IN (?, ?, ?)
    ORDER BY name ASC
  `).all(...INCIDENT_EXPRESSION_INDEX_NAMES);
  assert.deepEqual(expressionIndexes.map((index) => index.name), INCIDENT_EXPRESSION_INDEX_NAMES);
  for (const index of expressionIndexes) {
    assert.match(index.sql, /CASE\s+WHEN\s+json_valid\s*\(\s*data\s*\)/i);
    assert.match(index.sql, /json_extract\s*\(\s*data\s*,\s*'\$\.sourceEventId'\s*\)/i);
    assert.match(index.sql, /WHERE\s+kind\s+IN/i);
  }
  assert.match(expressionIndexes[0].sql, /CREATE\s+UNIQUE\s+INDEX/i);
  for (const index of expressionIndexes.slice(1)) {
    assert.match(index.sql, /json_extract\s*\(\s*data\s*,\s*'\$\.rootComponentId'\s*\)/i);
    assert.match(index.sql, /json_extract\s*\(\s*data\s*,\s*'\$\.sourceGroup'\s*\)/i);
  }
  assert.ok(new Set(database.prepare('PRAGMA index_list(events)').all().map((index) => index.name))
    .has('idx_events_product_incident_source'));
}

test('migration creates the exact seven canonical tables, foreign keys, constraints, and requested indexes', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    assert.equal(ledger.db.pragma('foreign_keys', { simple: true }), 1);
    for (const [table, names] of Object.entries(EXPECTED_COLUMNS)) {
      assert.deepEqual(ledger.db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name), names);
      const foreignKeys = ledger.db.prepare(`PRAGMA foreign_key_list(${table})`).all();
      if (table === 'product_incident_source_dispositions') {
        assert.deepEqual(
          foreignKeys.map((row) => `${row.from}->${row.table}.${row.to}`).sort(),
          ['disposition_event_id->events.id', 'source_event_id->events.id'],
        );
      } else {
        assert.ok(foreignKeys.some((row) => row.table === 'events' && row.from === 'ledger_event_id' && row.to === 'id'));
      }
    }
    assertProductIncidentCheckpointSchema(ledger.db);

    const commandIndexes = new Set(ledger.db.prepare('PRAGMA index_list(product_commands)').all().map((row) => row.name));
    assert.ok(commandIndexes.has('idx_product_commands_target_created'));
    assert.ok(commandIndexes.has('idx_product_commands_status_created'));
    assert.ok(commandIndexes.has('idx_product_commands_correlation'));
    assert.deepEqual(
      ledger.db.prepare('PRAGMA index_xinfo(idx_product_commands_target_created)').all()
        .filter((row) => row.key === 1)
        .map((row) => ({ name: row.name, desc: row.desc })),
      [{ name: 'target_component_id', desc: 0 }, { name: 'created_at_ms', desc: 1 }],
    );

    const referenceIndexes = new Set(ledger.db.prepare('PRAGMA index_list(product_identity_references)').all().map((row) => row.name));
    assert.ok(referenceIndexes.has('idx_product_identity_references_correlation_occurred'));
    assert.ok(referenceIndexes.has('idx_product_identity_references_parent'));
    assert.ok(referenceIndexes.has('idx_product_identity_references_resolution_occurred'));
    assert.ok(new Set(ledger.db.prepare('PRAGMA index_list(product_incidents)').all().map((row) => row.name))
      .has('idx_product_incidents_state_severity_last_seen'));

    const commandSql = ledger.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='product_commands'").get().sql;
    assert.match(commandSql, /length\(reason\) BETWEEN 1 AND 500/i);
    assert.match(commandSql, /262144/);
    const referenceSql = ledger.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='product_identity_references'").get().sql;
    for (const state of ['OPEN', 'TERMINAL_PROVEN', 'AMBIGUOUS', 'RECOVERY_REQUIRED', 'UNAVAILABLE', 'UNKNOWN']) {
      assert.match(referenceSql, new RegExp(`'${state}'`));
    }
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('legacy database files migrate in place and preserve prior durable rows', () => {
  const dataDir = tempDataDir();
  const databasePath = path.join(dataDir, 'cosmos.db');
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, symbol TEXT, data TEXT);
    CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO events (ts, kind, symbol, data) VALUES (${T0}, 'legacy.audit', NULL, '{"legacy":true}');
    INSERT INTO config (key, value) VALUES ('legacy.config', 'preserved');
  `);
  legacy.close();
  writeFileSync(path.join(dataDir, 'journal-compat.json'), `${JSON.stringify({
    dataSchema: 1,
    rollbackFloor: 0,
    updatedAtUtc: '2026-07-13T00:00:00Z',
    updatedBy: 'product-persistence-test',
  })}\n`);

  const migrated = new Ledger(dataDir);
  try {
    assert.equal(migrated.getConfigValue('legacy.config'), 'preserved');
    assert.equal(migrated.countEvents('legacy.audit'), 1);
    for (const table of Object.keys(EXPECTED_COLUMNS)) {
      assert.equal(migrated.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?").get(table).count, 1);
    }
    assertProductIncidentCheckpointSchema(migrated.db);
    assert.equal(migrated.db.prepare('SELECT COUNT(*) AS count FROM product_incident_source_dispositions').get().count, 0);
  } finally {
    migrated.close();
  }

  const restarted = new Ledger(dataDir);
  try {
    assert.equal(restarted.getConfigValue('legacy.config'), 'preserved');
    assert.equal(restarted.countEvents('legacy.audit'), 1);
    assert.equal(restarted.readProductBlockingIdentityReferences().length, 0);
    assertProductIncidentCheckpointSchema(restarted.db);
    assert.equal(restarted.db.prepare('SELECT COUNT(*) AS count FROM product_incident_source_dispositions').get().count, 0);
  } finally {
    restarted.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('desired-state CAS serializes writers and stale conflicts append zero rows', () => {
  const dataDir = tempDataDir();
  const first = new Ledger(dataDir);
  const second = new Ledger(dataDir);
  try {
    const committed = first.compareAndSetProductComponentDesiredState(desired());
    assert.equal(committed.disposition, 'COMMITTED_NEW');
    assert.equal(committed.currentRevision, '0');
    const eventCount = first.countEvents(AUDIT_KIND);

    const stale = second.compareAndSetProductComponentDesiredState(desired({
      desiredState: 'PAUSED',
      correlationId: 'cor.product.desired.stale',
      audit: audit('desired-stale'),
    }));
    assert.deepEqual(stale, {
      disposition: 'VERSION_CONFLICT',
      ledgerEvent: null,
      currentRevision: '0',
    });
    assert.equal(second.countEvents(AUDIT_KIND), eventCount);

    const next = second.compareAndSetProductComponentDesiredState(desired({
      expectedStateRevision: 0,
      desiredState: 'PAUSED',
      stateRevision: 1,
      updatedAtMs: T0 + 1,
      correlationId: 'cor.product.desired.next',
      audit: audit('desired-next'),
    }));
    assert.equal(next.disposition, 'COMMITTED_NEW');
    assert.equal(first.db.prepare('SELECT state_revision FROM product_component_desired_state WHERE component_id = ?').get('basis-engine').state_revision, 1);
  } finally {
    first.close();
    second.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('command append is exact-idempotent, revision-bound, bounded, and transactionally atomic', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    ledger.compareAndSetProductComponentDesiredState(desired());
    const input = command();
    const committed = ledger.compareAndAppendProductCommand(input);
    assert.equal(committed.disposition, 'COMMITTED_NEW');
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM product_commands').get().count, 1);
    const eventCount = ledger.countEvents(AUDIT_KIND);

    const replay = ledger.compareAndAppendProductCommand(input);
    assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(replay.ledgerEvent.id, committed.ledgerEvent.id);
    assert.equal(ledger.countEvents(AUDIT_KIND), eventCount);

    const conflict = ledger.compareAndAppendProductCommand(command({ requestDigest: digest('e') }));
    assert.equal(conflict.disposition, 'IDEMPOTENCY_CONFLICT');
    assert.equal(ledger.countEvents(AUDIT_KIND), eventCount);

    const stale = ledger.compareAndAppendProductCommand(command({
      commandId: 'command.product.stale',
      idempotencyKey: 'idem.product.command.stale',
      requestDigest: digest('f'),
      expectedRevision: 1,
      correlationId: 'cor.product.command.stale',
      audit: audit('command-stale'),
    }));
    assert.equal(stale.disposition, 'VERSION_CONFLICT');
    assert.equal(ledger.countEvents(AUDIT_KIND), eventCount);

    assert.throws(() => ledger.compareAndAppendProductCommand(command({ reason: '' })), /reason/);
    assert.throws(() => ledger.compareAndAppendProductCommand(command({
      commandId: 'command.product.secret',
      idempotencyKey: 'idem.product.command.secret',
      requestDigest: digest('1'),
      requestPayload: { api_secret: 'do-not-store-this-secret' },
    })), /secret-free JSON/);
    assert.equal(ledger.countEvents(AUDIT_KIND), eventCount);

    ledger.db.exec(`
      CREATE TRIGGER reject_product_command
      BEFORE INSERT ON product_commands
      BEGIN SELECT RAISE(ABORT, 'product command rejected'); END;
    `);
    assert.throws(() => ledger.compareAndAppendProductCommand(command({
      commandId: 'command.product.rollback',
      idempotencyKey: 'idem.product.command.rollback',
      requestDigest: digest('2'),
      correlationId: 'cor.product.command.rollback',
      audit: audit('command-rollback'),
    })), /product command rejected/);
    ledger.db.exec('DROP TRIGGER reject_product_command');
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM product_commands').get().count, 1);
    assert.equal(ledger.countEvents(AUDIT_KIND), eventCount);
    assert.throws(() => ledger.db.prepare("UPDATE product_commands SET request_payload_json = 'not-json'").run(), /CHECK constraint failed/);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('config and identity writes preserve opaque owner truth and unresolved restart readback', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    const config = ledger.recordProductConfigRevision(configRevision());
    assert.equal(config.disposition, 'COMMITTED_NEW');
    assert.equal(ledger.recordProductConfigRevision(configRevision()).disposition, 'IDEMPOTENT_REPLAY');
    assert.equal(ledger.recordProductConfigRevision(configRevision({ status: 'ACTIVE' })).disposition, 'IDEMPOTENCY_CONFLICT');

    const opened = ledger.compareAndUpsertProductIdentityReference(identityReference());
    assert.equal(opened.disposition, 'COMMITTED_NEW');
    assert.deepEqual(ledger.readProductBlockingIdentityReferences().map((row) => ({
      type: row.referenceType,
      state: row.resolutionState,
      projection: row.ownerProjection,
    })), [{
      type: 'POSITION',
      state: 'OPEN',
      projection: { exposure: 'UNKNOWN', schema: 'owner-position.v1' },
    }]);

    const stale = ledger.compareAndUpsertProductIdentityReference(identityReference({
      resolutionState: 'RECOVERY_REQUIRED',
      ownerProjection: { exposure: 'UNKNOWN', recovery: 'REQUIRED', schema: 'owner-position.v1' },
      occurredAtMs: T0 + 4,
      audit: audit('position-stale'),
    }));
    assert.equal(stale.disposition, 'VERSION_CONFLICT');

    const recoveringInput = identityReference({
      expectedResolutionState: 'OPEN',
      resolutionState: 'RECOVERY_REQUIRED',
      ownerProjection: { exposure: 'UNKNOWN', recovery: 'REQUIRED', schema: 'owner-position.v1' },
      occurredAtMs: T0 + 4,
      audit: audit('position-recovery'),
    });
    assert.equal(ledger.compareAndUpsertProductIdentityReference(recoveringInput).disposition, 'COMMITTED_NEW');
    assert.equal(ledger.compareAndUpsertProductIdentityReference(recoveringInput).disposition, 'IDEMPOTENT_REPLAY');
    ledger.close();

    ledger = new Ledger(dataDir);
    assert.equal(ledger.readProductBlockingIdentityReferences()[0].resolutionState, 'RECOVERY_REQUIRED');
    const terminal = ledger.compareAndUpsertProductIdentityReference(identityReference({
      expectedResolutionState: 'RECOVERY_REQUIRED',
      resolutionState: 'TERMINAL_PROVEN',
      ownerState: 'CLOSED',
      ownerProjection: { exposure: 'CLOSED_PROVEN', schema: 'owner-position.v1' },
      occurredAtMs: T0 + 5,
      audit: audit('position-terminal'),
    }));
    assert.equal(terminal.disposition, 'COMMITTED_NEW');
    assert.equal(ledger.readProductBlockingIdentityReferences().length, 0);
    assert.throws(() => ledger.db.prepare("UPDATE product_identity_references SET resolution_state = 'CLEARED'").run(), /CHECK constraint failed/);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('incident and boot/release transitions are CAS evidence only and survive restart', () => {
  const dataDir = tempDataDir();
  let ledger = new Ledger(dataDir);
  try {
    const firstIncident = ledger.compareAndTransitionProductIncident(incident());
    assert.equal(firstIncident.disposition, 'COMMITTED_NEW');
    const secondIncidentInput = incident({
      expectedLedgerEventId: firstIncident.ledgerEvent.id,
      lastSeenAtMs: T0 + 10,
      eventCount: 1,
      state: 'ACKNOWLEDGED',
      acknowledgedAtMs: T0 + 9,
      acknowledgedByOperatorId: 'operator.digest.one',
      audit: audit('incident-acknowledged'),
    });
    assert.equal(ledger.compareAndTransitionProductIncident(secondIncidentInput).disposition, 'COMMITTED_NEW');
    assert.equal(ledger.compareAndTransitionProductIncident(secondIncidentInput).disposition, 'IDEMPOTENT_REPLAY');

    const boot = ledger.compareAndSetProductBootReleaseRevision(bootRelease());
    assert.equal(boot.disposition, 'COMMITTED_NEW');
    const completeInput = bootRelease({
      expectedLedgerEventId: boot.ledgerEvent.id,
      completedAtMs: T0 + 20,
      clean: true,
      blockerCode: null,
      audit: audit('boot-complete'),
    });
    const completed = ledger.compareAndSetProductBootReleaseRevision(completeInput);
    assert.equal(completed.disposition, 'COMMITTED_NEW');
    ledger.close();

    ledger = new Ledger(dataDir);
    assert.deepEqual(ledger.db.prepare('SELECT event_count, state FROM product_incidents').get(), {
      event_count: 1,
      state: 'ACKNOWLEDGED',
    });
    assert.deepEqual(ledger.db.prepare('SELECT completed_at_ms, clean FROM product_boot_release_revisions').get(), {
      completed_at_ms: T0 + 20,
      clean: 1,
    });
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('System Integration adapter exposes optional seams only after load and fails closed on malformed durable projections', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  const adapter = new SystemLedgerPersistenceAdapter(ledger);
  try {
    assert.deepEqual(adapter.compareAndSetProductComponentDesiredState(desired()), {
      ok: false,
      code: 'PERSISTENCE_NOT_LOADED',
      message: 'integration checkpoint has not been loaded',
    });
    assert.equal(adapter.load(T0).ok, true);
    const desiredResult = adapter.compareAndSetProductComponentDesiredState(desired());
    assert.equal(desiredResult.ok, true);
    assert.equal(desiredResult.value.disposition, 'COMMITTED_NEW');
    const identityInput = identityReference();
    assert.equal(adapter.compareAndUpsertProductIdentityReference(identityInput).ok, true);
    assert.equal(adapter.readProductBlockingIdentityReferences(1).value.length, 1);
    assert.ok(adapter.restartBarrier(T0).value.reasonCodes.includes('UNRESOLVED_PRODUCT_IDENTITY_REFERENCES'));
    assert.ok(adapter.restartBarrier(T0).value.reasonCodes.includes('UNRESOLVED_PRODUCT_IDENTITY_REFERENCE_POSITION'));
    assert.deepEqual(adapter.readProductBlockingIdentityReferences(0), {
      ok: false,
      code: 'INVALID_PERSISTENCE_REQUEST',
      message: 'product identity reference query is invalid',
    });

    const identityLedgerEventId = ledger.db.prepare('SELECT ledger_event_id FROM product_identity_references').get().ledger_event_id;
    ledger.db.prepare("UPDATE events SET data = '{\"corrupt\":true}' WHERE id = ?").run(identityLedgerEventId);
    const corruptReplay = adapter.compareAndUpsertProductIdentityReference(identityInput);
    assert.equal(corruptReplay.ok, false);
    assert.equal(corruptReplay.code, 'PERSISTENCE_WRITE_FAILED');

    ledger.db.pragma('ignore_check_constraints = ON');
    ledger.db.prepare("UPDATE product_identity_references SET owner_projection_json = '{\"z\":1,\"a\":2}'").run();
    ledger.db.pragma('ignore_check_constraints = OFF');
    const malformed = adapter.readProductBlockingIdentityReferences();
    assert.equal(malformed.ok, false);
    assert.equal(malformed.code, 'PERSISTENCE_READ_FAILED');
    const malformedBarrier = adapter.restartBarrier(T0);
    assert.equal(malformedBarrier.ok, true);
    assert.equal(malformedBarrier.value.canOpenOrIncrease, false);
    assert.ok(malformedBarrier.value.reasonCodes.includes('PRODUCT_IDENTITY_REFERENCE_READ_FAILED'));
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('all new writes remain inert with respect to live execution and private exchange authority', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    ledger.compareAndSetProductComponentDesiredState(desired());
    ledger.compareAndAppendProductCommand(command());
    ledger.recordProductConfigRevision(configRevision());
    ledger.compareAndUpsertProductIdentityReference(identityReference());
    ledger.compareAndTransitionProductIncident(incident());
    ledger.compareAndSetProductBootReleaseRevision(bootRelease());
    assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, 6);
    assert.equal(ledger.countEvents('order_request'), 0);
    assert.equal(ledger.countEvents('loan_request'), 0);
    assert.equal(ledger.getConfigValue('LIVE_EXECUTION_NOT_IMPLEMENTED'), null);
    assert.ok(ledger.recentEvents(20).every((event) => event.data.actionAuthority === 'NONE'));
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
