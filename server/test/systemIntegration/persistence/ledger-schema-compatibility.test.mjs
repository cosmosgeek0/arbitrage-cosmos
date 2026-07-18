import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  LEDGER_ROLLBACK_FLOOR,
  LEDGER_SCHEMA_VERSION,
  Ledger,
} from '../../../dist/ledger.js';
import { defaultApplicationSummaries } from '../../../dist/systemIntegration/application/projection.js';
import { createInitialCheckpointState } from '../../../dist/systemIntegration/persistence/index.js';

const T0 = 1_800_000_000_000;
const LEGACY_CHECKPOINT_KEYS = Object.freeze([
  'approvals',
  'authorityReferences',
  'control',
  'controlRejections',
  'desiredComponents',
  'dryRunExecutions',
  'generation',
  'idempotencyReceipts',
  'lastShutdown',
  'lastStartup',
  'reconciliations',
  'reservations',
  'restartTruth',
  'revision',
  'traceIndex',
].sort());

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'cosmos-ledger-schema-'));
}

function writeLegacyMarker(dataDir, overrides = {}) {
  const marker = {
    dataSchema: 1,
    rollbackFloor: 0,
    updatedAtUtc: '2026-07-13T00:00:00Z',
    updatedBy: 'deploy.sh',
    ...overrides,
  };
  writeFileSync(path.join(dataDir, 'journal-compat.json'), `${JSON.stringify(marker)}\n`);
  return marker;
}

function assertNullFailure(readback, state, reasonCode) {
  assert.equal(Object.isFrozen(readback), true);
  assert.equal(readback.state, state);
  assert.equal(readback.reasonCode, reasonCode);
  assert.equal(readback.currentSchemaVersion, null);
  assert.equal(readback.rollbackFloor, null);
}

test('new Ledger persists the exact owned schema and non-rollback floor', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    assert.equal(LEDGER_SCHEMA_VERSION, 3);
    assert.equal(LEDGER_ROLLBACK_FLOOR, 3);
    assert.equal(ledger.db.pragma('user_version', { simple: true }), 3);
    assert.deepEqual(
      ledger.db.prepare('SELECT singleton, current_schema_version, rollback_floor FROM ledger_schema_compatibility').get(),
      { singleton: 1, current_schema_version: 3, rollback_floor: 3 },
    );
    assert.deepEqual(ledger.readSchemaCompatibility(), {
      state: 'AVAILABLE',
      currentSchemaVersion: 3,
      rollbackFloor: 3,
      reasonCode: null,
    });
    assert.equal(Object.isFrozen(ledger.readSchemaCompatibility()), true);
  } finally {
    ledger.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('legacy DB rows survive one-time marker import while the unsafe legacy floor is promoted', () => {
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
  writeLegacyMarker(dataDir);

  const migrated = new Ledger(dataDir);
  try {
    assert.equal(migrated.getConfigValue('legacy.config'), 'preserved');
    assert.equal(migrated.countEvents('legacy.audit'), 1);
    assert.deepEqual(migrated.readSchemaCompatibility(), {
      state: 'AVAILABLE', currentSchemaVersion: 3, rollbackFloor: 3, reasonCode: null,
    });
    assert.equal(JSON.parse(readFileSync(path.join(dataDir, 'journal-compat.json'), 'utf8')).rollbackFloor, 0);

    const currentCheckpoint = createInitialCheckpointState(T0, 'legacy-reader-floor-proof');
    const oldExactKeyReaderAccepts = Object.keys(currentCheckpoint).sort().join('|')
      === LEGACY_CHECKPOINT_KEYS.join('|');
    assert.equal(Object.hasOwn(currentCheckpoint, 'liveEdgeControlEvents'), true);
    assert.equal(oldExactKeyReaderAccepts, false, 'the prior exact-key reader cannot consume the new checkpoint shape');
    assert.equal(migrated.readSchemaCompatibility().rollbackFloor, 3, 'rollback floor must reflect the old-reader incompatibility');
  } finally {
    migrated.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Ledger readback withholds both numbers for malformed, mismatched, and unavailable truth', () => {
  const dataDir = tempDataDir();
  const ledger = new Ledger(dataDir);
  try {
    ledger.db.prepare('UPDATE ledger_schema_compatibility SET current_schema_version = 4').run();
    assertNullFailure(ledger.readSchemaCompatibility(), 'MISMATCH', 'LEDGER_SCHEMA_VERSION_UNSUPPORTED_NEWER');
    ledger.db.prepare('UPDATE ledger_schema_compatibility SET current_schema_version = 3').run();

    ledger.db.pragma('ignore_check_constraints = ON');
    ledger.db.prepare('UPDATE ledger_schema_compatibility SET rollback_floor = 4').run();
    ledger.db.pragma('ignore_check_constraints = OFF');
    assertNullFailure(ledger.readSchemaCompatibility(), 'MISMATCH', 'LEDGER_ROLLBACK_FLOOR_EXCEEDS_CURRENT_SCHEMA');
    ledger.db.pragma('ignore_check_constraints = ON');
    ledger.db.prepare('UPDATE ledger_schema_compatibility SET rollback_floor = 3').run();
    ledger.db.prepare("UPDATE ledger_schema_compatibility SET current_schema_version = 'broken'").run();
    ledger.db.pragma('ignore_check_constraints = OFF');
    assertNullFailure(ledger.readSchemaCompatibility(), 'MALFORMED', 'LEDGER_SCHEMA_COMPATIBILITY_ROW_MALFORMED');
    ledger.db.pragma('ignore_check_constraints = ON');
    ledger.db.prepare('UPDATE ledger_schema_compatibility SET current_schema_version = 3').run();
    ledger.db.pragma('ignore_check_constraints = OFF');

    ledger.db.prepare('DELETE FROM ledger_schema_compatibility').run();
    assertNullFailure(ledger.readSchemaCompatibility(), 'MALFORMED', 'LEDGER_SCHEMA_COMPATIBILITY_ROW_COUNT_INVALID');
  } finally {
    ledger.close();
  }
  assertNullFailure(ledger.readSchemaCompatibility(), 'UNAVAILABLE', 'LEDGER_SCHEMA_COMPATIBILITY_UNAVAILABLE');
  rmSync(dataDir, { recursive: true, force: true });
});

test('ordinary startup rejects unsupported newer schema and rollback-floor mismatch', () => {
  const newerDir = tempDataDir();
  const newerDb = new Database(path.join(newerDir, 'cosmos.db'));
  newerDb.pragma('user_version = 4');
  newerDb.close();
  assert.throws(() => new Ledger(newerDir), /LEDGER_SCHEMA_VERSION_UNSUPPORTED_NEWER/);
  const newerReadback = new Database(path.join(newerDir, 'cosmos.db'));
  assert.equal(newerReadback.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'ledger_schema_compatibility'").get().count, 0);
  newerReadback.close();
  rmSync(newerDir, { recursive: true, force: true });

  const floorDir = tempDataDir();
  const seeded = new Ledger(floorDir);
  seeded.db.pragma('ignore_check_constraints = ON');
  seeded.db.prepare('UPDATE ledger_schema_compatibility SET rollback_floor = 4').run();
  seeded.close();
  assert.throws(() => new Ledger(floorDir), /LEDGER_ROLLBACK_FLOOR_EXCEEDS_CURRENT_SCHEMA/);
  rmSync(floorDir, { recursive: true, force: true });
});

test('legacy marker import is closed-schema and refuses extras, malformed values, and newer truth', () => {
  const cases = [
    [{ extra: 'not-allowed' }, /LEDGER_LEGACY_SCHEMA_COMPATIBILITY_MALFORMED/],
    [{ updatedAtUtc: 'not-utc' }, /LEDGER_LEGACY_SCHEMA_COMPATIBILITY_MALFORMED/],
    [{ updatedAtUtc: '2026-02-31T00:00:00Z' }, /LEDGER_LEGACY_SCHEMA_COMPATIBILITY_MALFORMED/],
    [{ dataSchema: 4, rollbackFloor: 3 }, /LEDGER_SCHEMA_VERSION_UNSUPPORTED_NEWER/],
  ];
  for (const [overrides, expected] of cases) {
    const dataDir = tempDataDir();
    writeLegacyMarker(dataDir, overrides);
    assert.throws(() => new Ledger(dataDir), expected);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('application projection publishes schema numbers only for exact AVAILABLE Ledger truth', () => {
  const checkpoint = createInitialCheckpointState(T0, 'schema-projection');
  const available = Object.freeze({
    state: 'AVAILABLE', currentSchemaVersion: 1, rollbackFloor: 1, reasonCode: null,
  });
  assert.deepEqual(
    {
      truthLabel: defaultApplicationSummaries(checkpoint, true, available).ledger.truthLabel,
      state: defaultApplicationSummaries(checkpoint, true, available).ledger.schemaCompatibilityState,
      current: defaultApplicationSummaries(checkpoint, true, available).ledger.currentSchemaVersion,
      floor: defaultApplicationSummaries(checkpoint, true, available).ledger.rollbackFloor,
    },
    { truthLabel: 'RECORDED_REPLAY', state: 'AVAILABLE', current: 1, floor: 1 },
  );

  const mismatch = defaultApplicationSummaries(checkpoint, true, Object.freeze({
    state: 'MISMATCH', currentSchemaVersion: null, rollbackFloor: null,
    reasonCode: 'LEDGER_SCHEMA_VERSION_MISMATCH',
  })).ledger;
  assert.equal(mismatch.truthLabel, 'UNAVAILABLE');
  assert.equal(mismatch.schemaCompatibilityState, 'MISMATCH');
  assert.equal(mismatch.currentSchemaVersion, null);
  assert.equal(mismatch.rollbackFloor, null);

  const hostileInputs = [
    undefined,
    7,
    [],
    { ...available, extra: true },
    { ...available, rollbackFloor: 2 },
    { state: 'UNAVAILABLE', currentSchemaVersion: 1, rollbackFloor: 1, reasonCode: 'LEAKED_VALUES' },
  ];
  for (const input of hostileInputs) {
    const ledger = defaultApplicationSummaries(checkpoint, true, input).ledger;
    assert.equal(ledger.truthLabel, 'UNAVAILABLE');
    assert.ok(['UNAVAILABLE', 'MALFORMED'].includes(ledger.schemaCompatibilityState));
    assert.equal(ledger.currentSchemaVersion, null);
    assert.equal(ledger.rollbackFloor, null);
  }
});
