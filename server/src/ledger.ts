import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  compareExactDecimals,
  normalizeNonNegativeExactDecimal,
  type NonNegativeDecimal,
} from './capitalFoundation/contracts/decimal.js';
import type { SystemTraceEvent } from './systemIntegration/contracts/types.js';
import { validateSystemTraceEvent } from './systemIntegration/contracts/validation.js';
import {
  canonicalPersistenceJson,
  validateSystemTraceEvent as validatePersistedSystemTraceEvent,
} from './systemIntegration/persistence/codec.js';
import {
  PRODUCT_IDENTITY_REFERENCE_TYPES,
  PRODUCT_IDENTITY_RESOLUTION_STATES,
  PRODUCT_INCIDENT_ACK_EVENT_KIND,
  type ProductBootReleasePersistenceInput,
  type ProductBootReleaseRecord,
  type ProductCommandPersistenceInput,
  type ProductConfigRevisionPersistenceInput,
  type ProductDesiredStatePersistenceInput,
  type ProductIdentityReferencePersistenceInput,
  type ProductIdentityReferenceRecord,
  type ProductIncidentPersistenceInput,
  type ProductIncidentRecord,
  type ProductIncidentRotationInput,
  type ProductPersistenceAuditRecord,
  type ProductPersistenceMutationResult,
  type LedgerSchemaCompatibilityReadback,
  type SystemJsonValue,
} from './systemIntegration/persistence/types.js';

const EVENT_RESULT_MAX = 2_000;
const EVENT_SEARCH_MAX_CHARS = 64;
const EVENT_SEARCH_SCAN_ROWS = 25_000;
const EVENT_METADATA_VALIDATOR_SQL_FUNCTION = 'cosmos_validate_event_metadata_v1';
const BROWSER_SESSION_MAX = 2_000;
const BROWSER_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const HEALTH_PROBE_CACHE_MS = 5_000;
const EPHEMERAL_EVENT_BATCH_MAX = 10_000;
const CONFIG_CAS_KEY = /^[A-Za-z0-9_.:-]{1,160}$/;
const CONFIG_CAS_VALUE_MAX_BYTES = 512 * 1_024;
const CONFIG_CAS_EVENT_DATA_MAX_BYTES = 128 * 1_024;
const CONFIG_CAS_EVENT_BATCH_MAX = 8;
const CONFIG_CAS_EVENT_SYMBOL_MAX_CHARS = 96;
const LEDGER_EVENT_KIND = /^[a-z0-9_.-]{1,64}$/;
const SYSTEM_INTEGRATION_EVENT_KIND = 'system.integration.trace';
const SYSTEM_INTEGRATION_AUDIT_SCHEMA = 'cosmos.system-integration.audit';
const SYSTEM_RISK_DECISION_AUDIT_SCHEMA = 'cosmos.foundation.risk-verdict.audit.v1';
const SYSTEM_INTEGRATION_AUDIT_KINDS = new Set([
  'STARTUP',
  'TRANSITION',
  'TRACE',
  'RESTART_TRUTH',
  'SHUTDOWN',
  'CHECKPOINT',
]);
const MATERIAL_SYSTEM_TRACE_KINDS = new Set<SystemTraceEvent['kind']>([
  'CONTROL',
  'STRATEGY',
  'INTELLIGENCE',
  'CAPITAL',
  'RISK',
  'EXECUTION',
  'RECONCILIATION',
]);
const SYSTEM_CHECKPOINT_CHECKSUM = /^[a-f0-9]{64}$/;
const PRODUCT_OPERATOR_EVENT_MAX_BYTES = 128 * 1_024;
const PRODUCT_OPERATOR_EVENT_MAX_QUERY_LIMIT = 500;
export const PRODUCT_OPERATOR_EVENT_RETENTION_MAX = 25_000;
const PRODUCT_PERSISTENCE_JSON_MAX_BYTES = 256 * 1_024;
const PRODUCT_PERSISTENCE_AUDIT_MAX_BYTES = 128 * 1_024;
const PRODUCT_PERSISTENCE_QUERY_MAX = 2_000;
const PRODUCT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const PRODUCT_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PRODUCT_DOMAIN_STATE = /^[A-Z][A-Z0-9_.:-]{0,127}$/;
const PRODUCT_INCIDENT_SEVERITIES = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const);
const PRODUCT_INCIDENT_STATES = Object.freeze(['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const);
const PRODUCT_INCIDENT_ROUTE_SCHEMA = 'cosmos.product-incident-route.v1';
const PRODUCT_INCIDENT_ROTATION_SCHEMA = 'cosmos.product-incident-rotation.v1';
const PRODUCT_INCIDENT_SOURCE_DISPOSITION_SCHEMA = 'cosmos.product-incident-source-disposition.v1';
const PRODUCT_INCIDENT_ROUTER_CHECKPOINT_KEY = 'product.incident.router.checkpoint.v1';
const PRODUCT_INCIDENT_ROUTER_CHECKPOINT_SCHEMA = 'cosmos.product-incident-router-checkpoint.v2';
const PRODUCT_INCIDENT_ROUTER_GENESIS_DIGEST = '0'.repeat(64);

function productIncidentRouterCheckpointDigest(input: Readonly<{
  priorChainDigest: string;
  priorSourceEventId: number;
  priorDispositionEventId: number;
  sourceEventId: number;
  dispositionEventId: number;
  sourceData: unknown;
  dispositionData: unknown;
}>): string {
  return createHash('sha256')
    .update('product-incident-router-checkpoint.v2\0', 'utf8')
    .update(input.priorChainDigest, 'utf8')
    .update('\0', 'utf8')
    .update(String(input.priorSourceEventId), 'utf8')
    .update('\0', 'utf8')
    .update(String(input.priorDispositionEventId), 'utf8')
    .update('\0', 'utf8')
    .update(String(input.sourceEventId), 'utf8')
    .update('\0', 'utf8')
    .update(String(input.dispositionEventId), 'utf8')
    .update('\0', 'utf8')
    .update(canonicalProductPersistenceJson(input.sourceData, 'product incident checkpoint source'), 'utf8')
    .update('\0', 'utf8')
    .update(canonicalProductPersistenceJson(
      input.dispositionData,
      'product incident checkpoint disposition',
    ), 'utf8')
    .digest('hex');
}
const PRODUCT_INCIDENT_ROUTE_AUDIT_KEYS = Object.freeze([
  'schema', 'operation', 'sourceEventId', 'sourceEventKind', 'sourceGroup',
  'sourceStatus', 'sourceDetail', 'sourceObservedAtMs', 'incidentId', 'fingerprint', 'rootComponentId',
  'severity', 'capitalRelevant', 'state', 'firstSeenAtMs', 'lastSeenAtMs',
  'eventCount', 'acknowledgedAtMs', 'acknowledgedByOperatorId', 'resolvedAtMs',
  'reasonCode', 'correlationId', 'routing', 'externalActionAuthorization',
]);
const PRODUCT_INCIDENT_SOURCE_DISPOSITION_KEYS = Object.freeze([
  'schema', 'operation', 'sourceEventId', 'sourceEventKind', 'sourceGroup',
  'sourceStatus', 'sourceDetail', 'sourceObservedAtMs', 'rootComponentId',
  'groupingDigest', 'incidentId', 'priorDispositionEventId', 'priorSourceEventId',
  'priorObservedAtMs', 'externalActionAuthorization',
]);
const PRODUCT_INCIDENT_ROTATION_KEYS = Object.freeze([
  'schema', 'operation', 'incidentId', 'expectedLedgerEventId', 'reasonCode',
  'retentionLimit', 'snapshot', 'externalActionAuthorization',
]);
const PRODUCT_INCIDENT_SNAPSHOT_KEYS = Object.freeze([
  'incidentId', 'fingerprint', 'rootComponentId', 'severity', 'capitalRelevant',
  'state', 'firstSeenAtMs', 'lastSeenAtMs', 'eventCount', 'acknowledgedAtMs',
  'acknowledgedByOperatorId', 'resolvedAtMs', 'correlationId', 'ledgerEventId',
  'sourceGroup', 'openingRoutingReceiptEventId', 'openingSourceEventId',
  'recoveryRoutingReceiptEventId', 'recoverySourceEventId',
]);
const PRODUCT_INCIDENT_ACK_SCHEMAS = new Set([
  'cosmos.product-incident-ack.v1',
  'cosmos.product-incident-ack.v2',
]);
const PRODUCT_DIGEST = /^(?:sha256:)?[a-f0-9]{16,128}$/i;
const PRODUCT_COMMIT = /^[a-f0-9]{40,64}$/i;
const PRODUCT_SENSITIVE_TEXT = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?secret|password|authorization|bearer|access[_ -]?token|signature)\s*[:=]?\s*[A-Za-z0-9+/_=-]{12,})/i;
const PRODUCT_BLOCKING_REFERENCE_TYPES = Object.freeze([
  'TICKET',
  'AMBIGUOUS_MUTATION',
  'POSITION',
  'LIABILITY',
  'RECOVERY_CAMPAIGN',
] as const);
const LEDGER_EXACT_FILL_SCHEMA_VERSION = 2;
export const LEDGER_SCHEMA_VERSION = 3;
// Schema 2 replaces lossy REAL fill money with canonical decimal TEXT. Schema
// 3 makes the complete generic event envelope first-class in the sole Ledger.
// An older writer can silently drop either class of truth, so rollback is no
// longer safe after this runtime opens the ledger.
export const LEDGER_ROLLBACK_FLOOR = 3;
const LEDGER_SCHEMA_COMPATIBILITY_TABLE = 'ledger_schema_compatibility';
const LEGACY_JOURNAL_COMPATIBILITY_FILE = 'journal-compat.json';
const LEGACY_JOURNAL_COMPATIBILITY_MAX_BYTES = 4 * 1_024;
const LEGACY_PRESTART_BARRIER_WRITER = 'deploy.sh.prestart-barrier';
const SQLITE_MAX_ROWID = 9_223_372_036_854_775_807n;
const SQLITE_CURSOR = /^(0|[1-9][0-9]{0,18})$/;
const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const ORDER_MUTATION_OUTCOMES = new Set([
  'accepted',
  'accepted_partial_terminal',
  'accepted_reconciled',
  'accepted_operator_verified',
  'not_sent',
  'not_sent_rejected',
  'not_sent_reconciled',
  'not_sent_operator_verified',
  'unknown',
]);
const LOAN_MUTATION_OUTCOMES = new Set([
  'succeeded',
  'failed',
  'reconciled_by_operator',
  'unknown',
]);

export interface LedgerEvent {
  id: number;
  ts: number;
  kind: string;
  symbol: string | null;
  data: unknown;
  severity: string | null;
  source: string | null;
  strategy: string | null;
  status: string | null;
  reason: string | null;
  message: string | null;
  correlation: string | null;
  createdAt: number;
}

export interface LedgerEventMetadataInput {
  readonly severity?: string | null;
  readonly source?: string | null;
  readonly strategy?: string | null;
  readonly status?: string | null;
  readonly reason?: string | null;
  readonly message?: string | null;
  readonly correlation?: string | null;
  readonly createdAt?: number;
}

export type OrderRecoveryState =
  | 'pending'
  | 'reconciling'
  | 'operator_review_required'
  | 'held_by_operator';

export interface UnresolvedOrderRequest {
  requestId: number;
  requestedAt: number;
  symbol: string;
  reservationId: string;
  clientOrderId: string;
  reservedNotionalUsd: number;
  recoveryState: OrderRecoveryState;
  recoveryAttempts: number;
  lastRecoveryAt: number | null;
  lastRecoveryDetail: string | null;
}

export interface DurableMutationAuthorityRead {
  readonly posture: 'PROVEN_ABSENT' | 'AMBIGUOUS' | 'UNKNOWN';
  readonly unresolvedOrderCount: number;
  readonly unresolvedLoanCount: number;
  readonly malformedOrderRowCount: number;
  readonly malformedLoanRowCount: number;
  readonly readErrorCount: number;
}

export interface LedgerEventInput extends LedgerEventMetadataInput {
  kind: string;
  symbol?: string | null;
  data?: unknown;
}

export type LedgerConfigCompareAndSetResult =
  | {
      readonly committed: true;
      readonly events: readonly LedgerEvent[];
    }
  | {
      readonly committed: false;
      readonly reason: 'VERSION_CONFLICT' | 'DEADLINE_EXCEEDED';
      readonly currentValue: string | null;
    };

export interface LedgerProductOperatorEventRecord {
  readonly cursor: string;
  readonly event: Readonly<SystemTraceEvent>;
}

/**
 * Structural match for the System Integration persistence read port. Ledger
 * owns the durable cursor and exposes evidence; productIntegration remains a
 * consumer and is deliberately not imported here.
 */
export interface LedgerProductOperatorEventPage {
  readonly requestedAfterCursor: string;
  readonly retainedFromCursor: string | null;
  readonly highWaterCursor: string;
  readonly continuity: 'PROVEN' | 'GAP' | 'UNPROVEN';
  readonly truncated: boolean;
  readonly items: readonly Readonly<LedgerProductOperatorEventRecord>[];
}

interface LedgerSchemaCompatibilityRow {
  readonly singleton: unknown;
  readonly current_schema_version: unknown;
  readonly rollback_floor: unknown;
}

interface LegacyJournalCompatibility {
  readonly dataSchema: number;
  readonly rollbackFloor: number;
  readonly prestartBarrier: boolean;
}

function failedSchemaCompatibility(
  state: Exclude<LedgerSchemaCompatibilityReadback['state'], 'AVAILABLE'>,
  reasonCode: string,
): Readonly<LedgerSchemaCompatibilityReadback> {
  return Object.freeze({
    state,
    currentSchemaVersion: null,
    rollbackFloor: null,
    reasonCode,
  });
}

function availableSchemaCompatibility(
  currentSchemaVersion: number,
  rollbackFloor: number,
): Readonly<LedgerSchemaCompatibilityReadback> {
  return Object.freeze({
    state: 'AVAILABLE',
    currentSchemaVersion,
    rollbackFloor,
    reasonCode: null,
  });
}

function canonicalLegacyUtc(value: unknown): value is string {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const normalized = value.length === 20 ? `${value.slice(0, -1)}.000Z` : value;
  return new Date(parsed).toISOString() === normalized;
}

function readLegacyJournalCompatibility(dataDir: string): LegacyJournalCompatibility | null {
  const markerPath = path.join(dataDir, LEGACY_JOURNAL_COMPATIBILITY_FILE);
  if (!existsSync(markerPath)) return null;
  const bytes = readFileSync(markerPath);
  if (bytes.byteLength < 2 || bytes.byteLength > LEGACY_JOURNAL_COMPATIBILITY_MAX_BYTES) {
    throw new Error('LEDGER_LEGACY_SCHEMA_COMPATIBILITY_MALFORMED');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('LEDGER_LEGACY_SCHEMA_COMPATIBILITY_MALFORMED');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.getPrototypeOf(parsed) !== Object.prototype
      || Object.getOwnPropertySymbols(parsed).length !== 0) {
    throw new Error('LEDGER_LEGACY_SCHEMA_COMPATIBILITY_MALFORMED');
  }
  const record = parsed as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = ['dataSchema', 'rollbackFloor', 'updatedAtUtc', 'updatedBy'].sort();
  if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('LEDGER_LEGACY_SCHEMA_COMPATIBILITY_MALFORMED');
  }
  const { dataSchema, rollbackFloor, updatedAtUtc, updatedBy } = record;
  const prestartBarrier = updatedBy === LEGACY_PRESTART_BARRIER_WRITER;
  if (!Number.isSafeInteger(dataSchema) || (dataSchema as number) < 0
      || !Number.isSafeInteger(rollbackFloor) || (rollbackFloor as number) < 0
      || (prestartBarrier
        ? (rollbackFloor as number) <= (dataSchema as number)
          || (rollbackFloor as number) < LEDGER_ROLLBACK_FLOOR
        : (rollbackFloor as number) > (dataSchema as number))
      || !canonicalLegacyUtc(updatedAtUtc)
      || typeof updatedBy !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(updatedBy)) {
    throw new Error('LEDGER_LEGACY_SCHEMA_COMPATIBILITY_MALFORMED');
  }
  if ((dataSchema as number) > LEDGER_SCHEMA_VERSION
      || (rollbackFloor as number) > LEDGER_SCHEMA_VERSION) {
    throw new Error('LEDGER_SCHEMA_VERSION_UNSUPPORTED_NEWER');
  }
  return Object.freeze({
    dataSchema: dataSchema as number,
    rollbackFloor: rollbackFloor as number,
    prestartBarrier,
  });
}

interface FillColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly pk: number;
}

interface LegacyFillDbRow {
  readonly symbol: unknown;
  readonly trade_id: unknown;
  readonly order_id: unknown;
  readonly side: unknown;
  readonly price: unknown;
  readonly qty: unknown;
  readonly quote_qty: unknown;
  readonly commission: unknown;
  readonly commission_asset: unknown;
  readonly ts: unknown;
  readonly source: unknown;
}

const EXACT_FILL_COLUMNS = Object.freeze({
  symbol: 'TEXT',
  trade_id: 'INTEGER',
  order_id: 'INTEGER',
  side: 'TEXT',
  price: 'TEXT',
  qty: 'TEXT',
  quote_qty: 'TEXT',
  commission: 'TEXT',
  commission_asset: 'TEXT',
  ts: 'INTEGER',
  source: 'TEXT',
  money_encoding: 'TEXT',
} as const);

const LEGACY_FILL_COLUMNS = Object.freeze({
  symbol: 'TEXT',
  trade_id: 'INTEGER',
  order_id: 'INTEGER',
  side: 'TEXT',
  price: 'REAL',
  qty: 'REAL',
  quote_qty: 'REAL',
  commission: 'REAL',
  commission_asset: 'TEXT',
  ts: 'INTEGER',
  source: 'TEXT',
} as const);

interface EventColumnInfo {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: unknown;
  readonly pk: number;
  readonly hidden: number;
}

const LEGACY_EVENT_COLUMNS = Object.freeze({
  id: 'INTEGER',
  ts: 'INTEGER',
  kind: 'TEXT',
  symbol: 'TEXT',
  data: 'TEXT',
} as const);

const EVENT_V3_COLUMNS = Object.freeze({
  ...LEGACY_EVENT_COLUMNS,
  severity: 'TEXT',
  source: 'TEXT',
  strategy: 'TEXT',
  status: 'TEXT',
  reason: 'TEXT',
  message: 'TEXT',
  correlation: 'TEXT',
  created_at: 'INTEGER',
} as const);

const LEGACY_EVENT_TABLE_SQL = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    symbol TEXT,
    data TEXT
  )
`;

const EVENT_V3_TABLE_SQL = `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    symbol TEXT,
    data TEXT,
    severity TEXT,
    source TEXT,
    strategy TEXT,
    status TEXT,
    reason TEXT,
    message TEXT,
    correlation TEXT,
    created_at INTEGER
  )
`;

const CREATE_EVENT_V3_TABLE_SQL = EVENT_V3_TABLE_SQL.replace(
  /^\s*CREATE TABLE events/i,
  'CREATE TABLE IF NOT EXISTS events',
);

const EVENT_INDEX_SPECS = Object.freeze([
  Object.freeze({
    name: 'idx_events_ts',
    sql: 'CREATE INDEX idx_events_ts ON events (ts DESC)',
    unique: 0,
    partial: 0,
    keys: Object.freeze([
      Object.freeze({ cid: 1, name: 'ts', desc: 1 }),
    ]),
  }),
  Object.freeze({
    name: 'idx_events_kind',
    sql: 'CREATE INDEX idx_events_kind ON events (kind, ts DESC)',
    unique: 0,
    partial: 0,
    keys: Object.freeze([
      Object.freeze({ cid: 2, name: 'kind', desc: 0 }),
      Object.freeze({ cid: 1, name: 'ts', desc: 1 }),
    ]),
  }),
  Object.freeze({
    name: 'idx_events_correlation',
    sql: 'CREATE INDEX idx_events_correlation ON events (correlation, id DESC)',
    unique: 0,
    partial: 0,
    keys: Object.freeze([
      Object.freeze({ cid: 11, name: 'correlation', desc: 0 }),
      Object.freeze({ cid: 0, name: 'id', desc: 1 }),
    ]),
  }),
  Object.freeze({
    name: 'idx_events_product_incident_source',
    sql: 'CREATE INDEX idx_events_product_incident_source ON events(kind, id)',
    unique: 0,
    partial: 0,
    keys: Object.freeze([
      Object.freeze({ cid: 2, name: 'kind', desc: 0 }),
      Object.freeze({ cid: 0, name: 'id', desc: 0 }),
    ]),
  }),
  Object.freeze({
    name: 'idx_events_product_incident_disposition_source_event',
    sql: `
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
          )
    `,
    unique: 1,
    partial: 1,
    keys: Object.freeze([
      Object.freeze({ cid: -2, name: null, desc: 0 }),
    ]),
  }),
  Object.freeze({
    name: 'idx_events_product_incident_disposition_stream',
    sql: `
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
          )
    `,
    unique: 0,
    partial: 1,
    keys: Object.freeze([
      Object.freeze({ cid: -2, name: null, desc: 0 }),
      Object.freeze({ cid: -2, name: null, desc: 0 }),
      Object.freeze({ cid: -2, name: null, desc: 1 }),
      Object.freeze({ cid: 0, name: 'id', desc: 1 }),
    ]),
  }),
  Object.freeze({
    name: 'idx_events_product_incident_route_stream',
    sql: `
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
          AND json_extract(data, '$.schema') = 'cosmos.product-incident-route.v1'
    `,
    unique: 0,
    partial: 1,
    keys: Object.freeze([
      Object.freeze({ cid: -2, name: null, desc: 0 }),
      Object.freeze({ cid: -2, name: null, desc: 0 }),
      Object.freeze({ cid: -2, name: null, desc: 1 }),
      Object.freeze({ cid: 0, name: 'id', desc: 1 }),
    ]),
  }),
] as const);

const CREATE_EVENT_INDEXES_SQL = EVENT_INDEX_SPECS
  .map((index) => index.sql
    .trim()
    .replace(/^CREATE UNIQUE INDEX /, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS '))
  .join(';\n');

// The historical v3 trigger set. Frozen: it is the shape a pre-migration
// database legitimately carries, and must never follow the canonical set.
const LEGACY_EVENT_TRIGGER_SPECS = Object.freeze([
  Object.freeze({
    name: 'product_incident_checkpoint_events_no_update',
    sql: `
      CREATE TRIGGER product_incident_checkpoint_events_no_update
        BEFORE UPDATE ON events
        WHEN EXISTS (
          SELECT 1 FROM product_incident_source_dispositions
          WHERE source_event_id = OLD.id OR disposition_event_id = OLD.id
        )
        BEGIN SELECT RAISE(ABORT, 'product incident checkpoint evidence is immutable'); END
    `,
  }),
  Object.freeze({
    name: 'product_incident_checkpoint_events_no_delete',
    sql: `
      CREATE TRIGGER product_incident_checkpoint_events_no_delete
        BEFORE DELETE ON events
        WHEN EXISTS (
          SELECT 1 FROM product_incident_source_dispositions
          WHERE source_event_id = OLD.id OR disposition_event_id = OLD.id
        )
        BEGIN SELECT RAISE(ABORT, 'product incident checkpoint evidence is immutable'); END
    `,
  }),
] as const);

// Canonical set: the two checkpoint triggers above (still wanted; their names
// and messages are pinned by tests) plus the general append-only guarantee the
// ledger has always claimed but never enforced. events_no_update is
// unconditional — the only UPDATE in the product is the migration backfill,
// which runs between DROP_EVENT_TRIGGERS_SQL and CREATE_EVENT_TRIGGERS_SQL
// inside the migration transaction. events_no_delete_durable allowlists
// exactly the six recomputable kinds pruneEphemeralEvents may delete; kind is
// the right key (a trigger cannot know `now`), and this makes SQLite enforce
// the retention policy the prune comment already documents. Financial,
// operator, security, configuration, order, loan, fill, error, and connection
// audit events are protected unconditionally.
const EVENT_TRIGGER_SPECS = Object.freeze([
  ...LEGACY_EVENT_TRIGGER_SPECS,
  Object.freeze({
    name: 'events_no_update',
    sql: `
      CREATE TRIGGER events_no_update
        BEFORE UPDATE ON events
        BEGIN SELECT RAISE(ABORT, 'ledger events are append-only'); END
    `,
  }),
  Object.freeze({
    name: 'events_no_delete_durable',
    sql: `
      CREATE TRIGGER events_no_delete_durable
        BEFORE DELETE ON events
        WHEN OLD.kind NOT IN (
          'strategy_decision', 'basis.strategy_decision',
          'heartbeat', 'basis.heartbeat',
          'candidate_rejected', 'candidate_opened'
        )
        BEGIN SELECT RAISE(ABORT, 'ledger events are append-only'); END
    `,
  }),
] as const);

const CREATE_EVENT_TRIGGERS_SQL = EVENT_TRIGGER_SPECS
  .map((trigger) => trigger.sql
    .trim()
    .replace(/^CREATE TRIGGER /, 'CREATE TRIGGER IF NOT EXISTS '))
  .join(';\n');

const DROP_EVENT_TRIGGERS_SQL = EVENT_TRIGGER_SPECS
  .map((trigger) => `DROP TRIGGER IF EXISTS ${trigger.name}`)
  .join(';\n');

const LEDGER_EVENT_INSERT_SQL = `
  INSERT INTO events (
    ts, kind, symbol, data, severity, source, strategy, status,
    reason, message, correlation, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

interface PreparedLedgerEventMetadata {
  readonly severity: string | null;
  readonly source: string | null;
  readonly strategy: string | null;
  readonly status: string | null;
  readonly reason: string | null;
  readonly message: string | null;
  readonly correlation: string | null;
  /** Null means the append transaction must bind its own receipt time. */
  readonly createdAt: number | null;
}

const LEDGER_EVENT_TEXT_LIMITS = Object.freeze({
  severity: 64,
  source: 256,
  strategy: 256,
  status: 128,
  reason: 2_048,
  message: 8_192,
  correlation: 256,
} as const);

const LEDGER_EVENT_TEXT_FIELDS = Object.freeze(
  Object.keys(LEDGER_EVENT_TEXT_LIMITS) as (keyof typeof LEDGER_EVENT_TEXT_LIMITS)[],
);

function prepareLedgerEventText(
  field: keyof typeof LEDGER_EVENT_TEXT_LIMITS,
  value: unknown,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new TypeError(`invalid ledger event ${field}`);
  }
  let scalarCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new TypeError(`invalid ledger event ${field}`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(`invalid ledger event ${field}`);
    }
    scalarCount += 1;
  }
  if (scalarCount < 1
      || scalarCount > LEDGER_EVENT_TEXT_LIMITS[field]
      || /[\p{Cc}\p{Bidi_Control}]/u.test(value)) {
    throw new TypeError(`invalid ledger event ${field}`);
  }
  return value;
}

function prepareLedgerEventCreatedAt(value: unknown, nullable: boolean): number | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new TypeError('invalid ledger event createdAt');
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('invalid ledger event createdAt');
  }
  return value as number;
}

function prepareLedgerEventMetadata(
  input: Readonly<LedgerEventMetadataInput>,
): Readonly<PreparedLedgerEventMetadata> {
  return Object.freeze({
    severity: prepareLedgerEventText('severity', input.severity),
    source: prepareLedgerEventText('source', input.source),
    strategy: prepareLedgerEventText('strategy', input.strategy),
    status: prepareLedgerEventText('status', input.status),
    reason: prepareLedgerEventText('reason', input.reason),
    message: prepareLedgerEventText('message', input.message),
    correlation: prepareLedgerEventText('correlation', input.correlation),
    createdAt: prepareLedgerEventCreatedAt(input.createdAt, true),
  });
}

function snapshotLedgerEventMetadata(
  input: Readonly<LedgerEventMetadataInput>,
): Readonly<PreparedLedgerEventMetadata> {
  return prepareLedgerEventMetadata({
    severity: input.severity,
    source: input.source,
    strategy: input.strategy,
    status: input.status,
    reason: input.reason,
    message: input.message,
    correlation: input.correlation,
    createdAt: input.createdAt,
  });
}

interface PreparedLedgerEventData {
  readonly serialized: string | null;
  readonly value: unknown;
}

function prepareLedgerEventData(value: unknown, present: boolean): Readonly<PreparedLedgerEventData> {
  if (!present) return Object.freeze({ serialized: null, value: null });
  if (value === undefined) throw new TypeError('invalid ledger event data');
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('invalid ledger event data');
  return Object.freeze({
    serialized,
    value: JSON.parse(serialized) as unknown,
  });
}

interface StoredLedgerEventMetadata {
  readonly severity: unknown;
  readonly source: unknown;
  readonly strategy: unknown;
  readonly status: unknown;
  readonly reason: unknown;
  readonly message: unknown;
  readonly correlation: unknown;
  readonly createdAt: unknown;
}

function prepareStoredLedgerEventMetadata(
  input: Readonly<StoredLedgerEventMetadata>,
): Readonly<PreparedLedgerEventMetadata> {
  const prepared: Partial<Record<keyof typeof LEDGER_EVENT_TEXT_LIMITS, string | null>> = {};
  for (const field of LEDGER_EVENT_TEXT_FIELDS) {
    try {
      prepared[field] = prepareLedgerEventText(field, input[field]);
    } catch {
      throw new Error(`LEDGER_EVENT_${field.toUpperCase()}_MALFORMED`);
    }
  }
  let createdAt: number | null;
  try {
    createdAt = prepareLedgerEventCreatedAt(input.createdAt, false);
  } catch {
    throw new Error('LEDGER_EVENT_CREATED_AT_MALFORMED');
  }
  return Object.freeze({
    severity: prepared.severity ?? null,
    source: prepared.source ?? null,
    strategy: prepared.strategy ?? null,
    status: prepared.status ?? null,
    reason: prepared.reason ?? null,
    message: prepared.message ?? null,
    correlation: prepared.correlation ?? null,
    createdAt,
  });
}

function eventInsertValues(
  ts: number,
  kind: string,
  symbol: string | null,
  serialized: string | null,
  metadata: Readonly<PreparedLedgerEventMetadata>,
): readonly unknown[] {
  return [
    ts,
    kind,
    symbol,
    serialized,
    metadata.severity,
    metadata.source,
    metadata.strategy,
    metadata.status,
    metadata.reason,
    metadata.message,
    metadata.correlation,
    metadata.createdAt ?? ts,
  ];
}

function ledgerEventFromAppend(
  id: number,
  ts: number,
  kind: string,
  symbol: string | null,
  data: unknown,
  metadata: Readonly<PreparedLedgerEventMetadata>,
): LedgerEvent {
  return {
    id,
    ts,
    kind,
    symbol,
    data,
    severity: metadata.severity,
    source: metadata.source,
    strategy: metadata.strategy,
    status: metadata.status,
    reason: metadata.reason,
    message: metadata.message,
    correlation: metadata.correlation,
    createdAt: metadata.createdAt ?? ts,
  };
}

function exactColumnShape(
  columns: readonly FillColumnInfo[],
  expected: Readonly<Record<string, string>>,
): boolean {
  if (columns.length !== Object.keys(expected).length) return false;
  const actual = new Map(columns.map((column) => [column.name, column.type.toUpperCase()]));
  const nullable = new Set(['order_id', 'commission_asset']);
  return Object.entries(expected).every(([name, type]) => actual.get(name) === type)
    && columns.find((column) => column.name === 'symbol')?.pk === 1
    && columns.find((column) => column.name === 'trade_id')?.pk === 2
    && columns.every((column) => column.notnull === (nullable.has(column.name) ? 0 : 1))
    && columns.every((column) => ['symbol', 'trade_id'].includes(column.name) || column.pk === 0);
}

function createExactFillsTable(db: Database.Database): void {
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

function plainBinary64Decimal(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('LEDGER_FILL_V1_MONEY_MALFORMED');
  const text = value.toString();
  if (!/[eE]/.test(text)) return text;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (match === null) throw new Error('LEDGER_FILL_V1_MONEY_MALFORMED');
  const sign = match[1] === '-' ? '-' : '';
  const whole = match[2];
  const fraction = match[3] ?? '';
  const exponent = Number(match[4]);
  if (!Number.isSafeInteger(exponent)) throw new Error('LEDGER_FILL_V1_MONEY_MALFORMED');
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function legacyMoney(value: unknown, positive: boolean): NonNegativeDecimal {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value <= 0)) {
    throw new Error('LEDGER_FILL_V1_MONEY_MALFORMED');
  }
  return normalizeNonNegativeExactDecimal(plainBinary64Decimal(value));
}

function canonicalLegacyFill(row: Readonly<LegacyFillDbRow>): FillRow {
  if (typeof row.symbol !== 'string' || !/^[A-Z0-9]{1,20}$/.test(row.symbol)
    || !Number.isSafeInteger(row.trade_id) || (row.trade_id as number) < 0
    || (row.order_id !== null && (!Number.isSafeInteger(row.order_id) || (row.order_id as number) < 0))
    || (row.side !== 'BUY' && row.side !== 'SELL')
    || (row.commission_asset !== null && (typeof row.commission_asset !== 'string'
      || row.commission_asset.length < 1 || row.commission_asset.length > 80
      || /[\u0000-\u001f\u007f]/.test(row.commission_asset)))
    || !Number.isSafeInteger(row.ts) || (row.ts as number) <= 0
    || typeof row.source !== 'string' || row.source.length < 1 || row.source.length > 64
    || /[\u0000-\u001f\u007f]/.test(row.source)) {
    throw new Error('LEDGER_FILL_V1_ROW_MALFORMED');
  }
  return Object.freeze({
    symbol: row.symbol,
    tradeId: row.trade_id as number,
    orderId: row.order_id as number | null,
    side: row.side,
    price: legacyMoney(row.price, true),
    qty: legacyMoney(row.qty, true),
    quoteQty: legacyMoney(row.quote_qty, true),
    commission: legacyMoney(row.commission, false),
    commissionAsset: row.commission_asset as string | null,
    ts: row.ts as number,
    source: row.source,
    moneyEncoding: 'LEGACY_BINARY64',
  });
}

function upgradeFillSchemaVersion(db: Database.Database): void {
  const updated = db.prepare(`
    UPDATE ${LEDGER_SCHEMA_COMPATIBILITY_TABLE}
    SET current_schema_version = ?, rollback_floor = ?
    WHERE singleton = 1
      AND current_schema_version = 1
      AND typeof(rollback_floor) = 'integer'
      AND rollback_floor BETWEEN 0 AND 1
  `).run(LEDGER_EXACT_FILL_SCHEMA_VERSION, LEDGER_EXACT_FILL_SCHEMA_VERSION);
  if (updated.changes !== 1) throw new Error('LEDGER_SCHEMA_COMPATIBILITY_MIGRATION_BLOCKED');
  db.pragma(`user_version = ${LEDGER_EXACT_FILL_SCHEMA_VERSION}`);
}

function migrateFillStorage(db: Database.Database): void {
  db.transaction(() => {
    const liveSchemaVersion = db.pragma('user_version', { simple: true }) as unknown;
    if (!Number.isSafeInteger(liveSchemaVersion)
      || (liveSchemaVersion as number) < 0
      || (liveSchemaVersion as number) > LEDGER_SCHEMA_VERSION) {
      throw new Error('LEDGER_SCHEMA_VERSION_MALFORMED');
    }
    const columns = db.prepare('PRAGMA table_info(fills)').all() as FillColumnInfo[];
    if (exactColumnShape(columns, EXACT_FILL_COLUMNS)) {
      if (liveSchemaVersion === 1) upgradeFillSchemaVersion(db);
      return;
    }
    if (!exactColumnShape(columns, LEGACY_FILL_COLUMNS) || (liveSchemaVersion as number) >= 2) {
      throw new Error('LEDGER_FILL_SCHEMA_MALFORMED');
    }
    const rows = db.prepare(`
      SELECT symbol, trade_id, order_id, side, price, qty, quote_qty,
             commission, commission_asset, ts, source
      FROM fills
      ORDER BY symbol COLLATE BINARY ASC, trade_id ASC
    `).all() as LegacyFillDbRow[];
    const canonicalRows = rows.map(canonicalLegacyFill);
    const collision = db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'fills_v1_binary64'
    `).get() as { count: number };
    if (collision.count !== 0) throw new Error('LEDGER_FILL_V1_MIGRATION_COLLISION');
    db.exec(`
      DROP INDEX IF EXISTS idx_fills_ts;
      DROP INDEX IF EXISTS idx_fills_total_order;
      ALTER TABLE fills RENAME TO fills_v1_binary64;
    `);
    createExactFillsTable(db);
    const insert = db.prepare(`
      INSERT INTO fills
        (symbol, trade_id, order_id, side, price, qty, quote_qty, commission,
         commission_asset, ts, source, money_encoding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of canonicalRows) {
      insert.run(
        row.symbol, row.tradeId, row.orderId, row.side, row.price, row.qty,
        row.quoteQty, row.commission, row.commissionAsset, row.ts, row.source,
        row.moneyEncoding,
      );
    }
    const migratedCount = db.prepare('SELECT COUNT(*) AS count FROM fills').get() as { count: number };
    if (migratedCount.count !== canonicalRows.length) throw new Error('LEDGER_FILL_V1_MIGRATION_COUNT_MISMATCH');
    db.exec(`
      DROP TABLE fills_v1_binary64;
      CREATE INDEX idx_fills_ts ON fills (ts DESC);
      CREATE INDEX idx_fills_total_order
        ON fills (ts ASC, symbol COLLATE BINARY ASC, trade_id ASC);
    `);
    if (liveSchemaVersion === 1) upgradeFillSchemaVersion(db);
  }).immediate();
}

function exactEventColumnShape(
  columns: readonly EventColumnInfo[],
  expected: Readonly<Record<string, string>>,
): boolean {
  const entries = Object.entries(expected);
  if (columns.length !== entries.length) return false;
  return entries.every(([name, type], index) => {
    const column = columns[index];
    return column?.cid === index
      && column.name === name
      && column.type.toUpperCase() === type
      && column.notnull === (['ts', 'kind'].includes(name) ? 1 : 0)
      && column.dflt_value === null
      && column.pk === (name === 'id' ? 1 : 0)
      && column.hidden === 0;
  });
}

type EventTableShape = 'MISSING' | 'LEGACY' | 'V3' | 'MALFORMED';

interface SqliteMasterSqlRow {
  readonly name: unknown;
  readonly tbl_name: unknown;
  readonly sql: unknown;
}

interface EventIndexListRow {
  readonly name: unknown;
  readonly unique: unknown;
  readonly origin: unknown;
  readonly partial: unknown;
}

interface EventIndexXInfoRow {
  readonly seqno: unknown;
  readonly cid: unknown;
  readonly name: unknown;
  readonly desc: unknown;
  readonly coll: unknown;
  readonly key: unknown;
}

function normalizeSql(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .trim()
    .replace(/;+\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .toUpperCase();
}

function eventTableShape(db: Database.Database): EventTableShape {
  const masterRows = db.prepare(`
    SELECT name, tbl_name, sql
    FROM sqlite_master
    WHERE type = 'table' AND name = 'events' COLLATE NOCASE
  `).all() as SqliteMasterSqlRow[];
  if (masterRows.length === 0) return 'MISSING';
  if (masterRows.length !== 1
      || masterRows[0]?.name !== 'events'
      || masterRows[0]?.tbl_name !== 'events') return 'MALFORMED';

  const foreignKeys = db.prepare('PRAGMA foreign_key_list(events)').all();
  if (foreignKeys.length !== 0) return 'MALFORMED';

  const columns = db.prepare('PRAGMA table_xinfo(events)').all() as EventColumnInfo[];
  const sql = normalizeSql(masterRows[0]?.sql);
  if (exactEventColumnShape(columns, LEGACY_EVENT_COLUMNS)
      && sql === normalizeSql(LEGACY_EVENT_TABLE_SQL)) return 'LEGACY';
  if (exactEventColumnShape(columns, EVENT_V3_COLUMNS)
      && sql === normalizeSql(EVENT_V3_TABLE_SQL)) return 'V3';
  return 'MALFORMED';
}

function exactEventIndex(
  db: Database.Database,
  listRow: Readonly<EventIndexListRow>,
  masterRow: Readonly<SqliteMasterSqlRow>,
  spec: (typeof EVENT_INDEX_SPECS)[number],
): boolean {
  if (listRow.name !== spec.name
      || listRow.unique !== spec.unique
      || listRow.origin !== 'c'
      || listRow.partial !== spec.partial
      || masterRow.name !== spec.name
      || masterRow.tbl_name !== 'events'
      || normalizeSql(masterRow.sql) !== normalizeSql(spec.sql)) return false;

  const rows = db.prepare(`PRAGMA index_xinfo(${spec.name})`).all() as EventIndexXInfoRow[];
  if (rows.length !== spec.keys.length + 1) return false;
  const exactKeys = spec.keys.every((key, index) => {
    const row = rows[index];
    return row?.seqno === index
      && row.cid === key.cid
      && row.name === key.name
      && row.desc === key.desc
      && row.coll === 'BINARY'
      && row.key === 1;
  });
  const rowid = rows[spec.keys.length];
  return exactKeys
    && rowid?.seqno === spec.keys.length
    && rowid.cid === -1
    && rowid.name === null
    && rowid.desc === 0
    && rowid.coll === 'BINARY'
    && rowid.key === 0;
}

function eventIndexRows(db: Database.Database): {
  readonly list: readonly EventIndexListRow[];
  readonly master: readonly SqliteMasterSqlRow[];
} {
  return {
    list: db.prepare('PRAGMA index_list(events)').all() as EventIndexListRow[],
    master: db.prepare(`
      SELECT name, tbl_name, sql
      FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'events' COLLATE NOCASE
    `).all() as SqliteMasterSqlRow[],
  };
}

function eventTriggerRows(db: Database.Database): readonly SqliteMasterSqlRow[] {
  return db.prepare(`
    SELECT name, tbl_name, sql
    FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = 'events' COLLATE NOCASE
  `).all() as SqliteMasterSqlRow[];
}

function exactEventTriggers(
  rows: readonly SqliteMasterSqlRow[],
  specs: readonly { readonly name: string; readonly sql: string }[],
): boolean {
  return rows.length === specs.length
    && specs.every((spec) => {
      const row = rows.find((candidate) => candidate.name === spec.name);
      return row?.tbl_name === 'events'
        && normalizeSql(row.sql) === normalizeSql(spec.sql);
    });
}

function exactCanonicalEventTriggers(rows: readonly SqliteMasterSqlRow[]): boolean {
  return exactEventTriggers(rows, EVENT_TRIGGER_SPECS);
}

// A pre-migration (v1/v2-era) file legitimately carries one of exactly three
// trigger shapes: none (never booted with triggers), the historical two-trigger
// checkpoint set (booted by a pre-append-only build), or the full canonical
// set (this build's base DDL ran but the version migration did not complete).
// Asserting only the canonical set here would make every legitimate legacy
// file permanently unmigratable; anything outside these three shapes is
// corruption and fails closed.
function assertMigratableEventTriggers(db: Database.Database): void {
  const rows = eventTriggerRows(db);
  if (rows.length !== 0
      && !exactEventTriggers(rows, LEGACY_EVENT_TRIGGER_SPECS)
      && !exactEventTriggers(rows, EVENT_TRIGGER_SPECS)) {
    throw new Error('LEDGER_EVENT_TRIGGER_SCHEMA_MALFORMED');
  }
}

function assertCanonicalEventTriggers(db: Database.Database): void {
  if (!exactCanonicalEventTriggers(eventTriggerRows(db))) {
    throw new Error('LEDGER_EVENT_TRIGGER_SCHEMA_MALFORMED');
  }
}

function assertMigratableEventIndexes(db: Database.Database): void {
  const rows = eventIndexRows(db);
  if (rows.list.length !== rows.master.length) {
    throw new Error('LEDGER_EVENT_INDEX_SCHEMA_MALFORMED');
  }
  for (const listRow of rows.list) {
    const spec = EVENT_INDEX_SPECS.find((candidate) => candidate.name === listRow.name);
    const masterRow = rows.master.find((candidate) => candidate.name === listRow.name);
    if (spec === undefined || spec.name === 'idx_events_correlation'
        || masterRow === undefined || !exactEventIndex(db, listRow, masterRow, spec)) {
      throw new Error('LEDGER_EVENT_INDEX_SCHEMA_MALFORMED');
    }
  }
}

function assertCanonicalEventIndexes(db: Database.Database): void {
  const rows = eventIndexRows(db);
  if (rows.list.length !== EVENT_INDEX_SPECS.length
      || rows.master.length !== EVENT_INDEX_SPECS.length) {
    throw new Error('LEDGER_EVENT_INDEX_SCHEMA_MALFORMED');
  }
  for (const spec of EVENT_INDEX_SPECS) {
    const listRow = rows.list.find((candidate) => candidate.name === spec.name);
    const masterRow = rows.master.find((candidate) => candidate.name === spec.name);
    if (listRow === undefined || masterRow === undefined
        || !exactEventIndex(db, listRow, masterRow, spec)) {
      throw new Error('LEDGER_EVENT_INDEX_SCHEMA_MALFORMED');
    }
  }
}

function upgradeEventSchemaVersion(db: Database.Database): void {
  const updated = db.prepare(`
    UPDATE ${LEDGER_SCHEMA_COMPATIBILITY_TABLE}
    SET current_schema_version = ?, rollback_floor = ?
    WHERE singleton = 1
      AND current_schema_version = ?
      AND typeof(rollback_floor) = 'integer'
      AND rollback_floor BETWEEN 0 AND ?
  `).run(
    LEDGER_SCHEMA_VERSION,
    LEDGER_ROLLBACK_FLOOR,
    LEDGER_EXACT_FILL_SCHEMA_VERSION,
    LEDGER_EXACT_FILL_SCHEMA_VERSION,
  );
  if (updated.changes !== 1) throw new Error('LEDGER_SCHEMA_COMPATIBILITY_MIGRATION_BLOCKED');
  db.pragma(`user_version = ${LEDGER_SCHEMA_VERSION}`);
}

function initializeEventSchemaVersion(db: Database.Database, legacyRollbackFloor: number): void {
  const existingRows = db.prepare(`
    SELECT singleton, current_schema_version, rollback_floor
    FROM ${LEDGER_SCHEMA_COMPATIBILITY_TABLE}
    LIMIT 2
  `).all();
  if (existingRows.length !== 0) {
    throw new Error('LEDGER_SCHEMA_COMPATIBILITY_LEGACY_COLLISION');
  }
  const rollbackFloor = Math.max(legacyRollbackFloor, LEDGER_ROLLBACK_FLOOR);
  db.prepare(`
    INSERT INTO ${LEDGER_SCHEMA_COMPATIBILITY_TABLE}
      (singleton, current_schema_version, rollback_floor)
    VALUES (1, ?, ?)
  `).run(LEDGER_SCHEMA_VERSION, rollbackFloor);
  db.pragma(`user_version = ${LEDGER_SCHEMA_VERSION}`);
}

function assertCompleteEventMetadataStorage(db: Database.Database): void {
  const rows = db.prepare(`
    SELECT severity, source, strategy, status, reason, message, correlation,
           created_at AS createdAt
    FROM events
    ORDER BY id ASC
  `).iterate() as IterableIterator<StoredLedgerEventMetadata>;
  for (const row of rows) {
    prepareStoredLedgerEventMetadata(row);
  }
}

function assertCanonicalEventStorage(db: Database.Database): void {
  if (eventTableShape(db) !== 'V3') throw new Error('LEDGER_EVENT_SCHEMA_MALFORMED');
  assertCanonicalEventIndexes(db);
  assertCanonicalEventTriggers(db);
  assertCompleteEventMetadataStorage(db);
}

/**
 * Adds the v3 generic event envelope in place. SQLite ADD COLUMN preserves the
 * historical rows; created_at alone is deterministically backfilled from the
 * old receipt timestamp, while every historically absent descriptive field
 * remains NULL.
 */
function migrateEventStorage(
  db: Database.Database,
  allowFreshV3: boolean,
  legacyRollbackFloor: number,
): void {
  db.transaction(() => {
    const liveSchemaVersion = db.pragma('user_version', { simple: true }) as unknown;
    if (!Number.isSafeInteger(liveSchemaVersion)
        || (liveSchemaVersion as number) < 0
        || (liveSchemaVersion as number) > LEDGER_SCHEMA_VERSION) {
      throw new Error('LEDGER_SCHEMA_VERSION_MALFORMED');
    }
    const version = liveSchemaVersion as number;
    const shape = eventTableShape(db);
    if (shape === 'V3') {
      // A completed envelope beside an older durable marker cannot be an
      // interrupted migration: SQLite transactions commit schema, backfill,
      // compatibility row and user_version together. Treat that split-brain
      // shape as corruption instead of guessing which side is authoritative.
      if (version > 0 && version < LEDGER_SCHEMA_VERSION) {
        throw new Error('LEDGER_EVENT_SCHEMA_VERSION_MISMATCH');
      }
      if (version === 0) {
        if (!allowFreshV3) throw new Error('LEDGER_EVENT_SCHEMA_VERSION_MISMATCH');
        db.exec(CREATE_EVENT_INDEXES_SQL);
      }
      assertCanonicalEventStorage(db);
      if (version === 0) initializeEventSchemaVersion(db, legacyRollbackFloor);
      return;
    }
    if (shape !== 'LEGACY' || version >= LEDGER_SCHEMA_VERSION) {
      throw new Error('LEDGER_EVENT_SCHEMA_MALFORMED');
    }
    // Rank-42 owns immutable incident checkpoint events through exact triggers.
    // Temporarily remove only those already-proven triggers inside this same
    // migration transaction so the deterministic created_at backfill can
    // cover protected historical rows; rollback restores the prior schema.
    // By this point the constructor's base DDL has already installed the full
    // canonical trigger set (CREATE TRIGGER IF NOT EXISTS), regardless of
    // which legitimate shape the legacy file arrived with.
    assertCanonicalEventTriggers(db);
    db.exec(DROP_EVENT_TRIGGERS_SQL);
    db.exec(`
      ALTER TABLE events ADD COLUMN severity TEXT;
      ALTER TABLE events ADD COLUMN source TEXT;
      ALTER TABLE events ADD COLUMN strategy TEXT;
      ALTER TABLE events ADD COLUMN status TEXT;
      ALTER TABLE events ADD COLUMN reason TEXT;
      ALTER TABLE events ADD COLUMN message TEXT;
      ALTER TABLE events ADD COLUMN correlation TEXT;
      ALTER TABLE events ADD COLUMN created_at INTEGER;
    `);
    if (eventTableShape(db) !== 'V3') {
      throw new Error('LEDGER_EVENT_SCHEMA_MIGRATION_INCOMPLETE');
    }
    db.prepare('UPDATE events SET created_at = ts WHERE created_at IS NULL').run();
    db.exec(CREATE_EVENT_TRIGGERS_SQL);
    db.exec(CREATE_EVENT_INDEXES_SQL);
    assertCanonicalEventStorage(db);
    if (version === 0) initializeEventSchemaVersion(db, legacyRollbackFloor);
    else if (version === LEDGER_EXACT_FILL_SCHEMA_VERSION) upgradeEventSchemaVersion(db);
  }).immediate();
}

export type FillMoneyEncoding = 'EXACT_DECIMAL' | 'LEGACY_BINARY64';

/** Canonical durable fill truth used by replay and PnL. */
export interface FillInput {
  readonly symbol: string;
  readonly tradeId: number;
  readonly orderId: number | null;
  readonly side: string;
  readonly price: NonNegativeDecimal;
  readonly qty: NonNegativeDecimal;
  readonly quoteQty: NonNegativeDecimal;
  readonly commission: NonNegativeDecimal;
  readonly commissionAsset: string | null;
  readonly ts: number;
  readonly source: string;
}

export interface FillRow extends FillInput {
  readonly moneyEncoding: FillMoneyEncoding;
}

/** Non-authoritative numeric projection retained for the existing UI API. */
export interface FillDisplayRow {
  symbol: string;
  tradeId: number;
  orderId: number | null;
  side: string;
  price: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string | null;
  ts: number;
  source: string;
}

export interface SignalRecord {
  id: number;
  symbol: string;
  side: string;
  openedTs: number;
  closedTs: number | null;
  basisOpen: number;
  basisPeak: number;
  basisClose: number | null;
  fundingOpen: number | null;
}

export interface BrowserSessionRecord {
  id: string;
  ip: string;
  country: string | null;
  system: string;
  browser: string;
  device: string | null;
  model: string | null;
  firstSeen: number;
  lastSeen: number;
  requests: number;
}

interface EventDbRow {
  id: number;
  ts: number;
  kind: string;
  symbol: string | null;
  data: string | null;
  severity: string | null;
  source: string | null;
  strategy: string | null;
  status: string | null;
  reason: string | null;
  message: string | null;
  correlation: string | null;
  created_at: number | null;
}

interface ProductOperatorEventDbRow {
  cursor: string;
  ledger_event_id: number;
  event_id: string;
  component_id: string;
  correlation_id: string;
  occurred_at_ms: number;
  persisted_at_ms: number;
  material_projection_json: string;
  ledger_ts: number | null;
  ledger_kind: string | null;
  ledger_data: string | null;
}

interface ProductCommandDbRow {
  command_id: string;
  idempotency_key: string;
  request_digest: string;
  command_type: string;
  target_component_id: string;
  authenticated_operator_id: string;
  reason: string;
  required_authority: string;
  request_payload_json: string;
  preview_digest: string;
  preview_json: string;
  expected_revision: number;
  resulting_revision: number | null;
  status: string;
  created_at_ms: number;
  expires_at_ms: number;
  completed_at_ms: number | null;
  correlation_id: string;
  before_projection_json: string | null;
  after_projection_json: string | null;
  result_json: string | null;
  ledger_event_id: number | null;
}

interface ProductIdentityReferenceDbRow {
  reference_type: string;
  reference_id: string;
  owner_id: string;
  owner_revision: string;
  owner_state: string;
  resolution_state: string;
  correlation_id: string;
  parent_reference_type: string | null;
  parent_reference_id: string | null;
  payload_hash: string | null;
  owner_projection_json: string;
  occurred_at_ms: number;
  valid_until_ms: number | null;
  ledger_event_id: number;
}

interface ProductIncidentDbRow {
  incident_id: string;
  fingerprint: string;
  root_component_id: string;
  severity: string;
  capital_relevant: number;
  state: string;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
  event_count: number;
  acknowledged_at_ms: number | null;
  acknowledged_by_operator_id: string | null;
  resolved_at_ms: number | null;
  correlation_id: string;
  ledger_event_id: number;
}

interface ProductBootReleaseDbRow {
  operation_id: string;
  operation_type: string;
  generation: number;
  tested_commit: string | null;
  deployed_commit: string | null;
  config_revision: string | null;
  schema_revision: string;
  model_revision: string | null;
  started_at_ms: number;
  completed_at_ms: number | null;
  clean: number | null;
  blocker_code: string | null;
  correlation_id: string;
  ledger_event_id: number;
}

interface PreparedProductPersistenceAudit {
  readonly kind: string;
  readonly symbol: string | null;
  readonly serialized: string;
  readonly data: SystemJsonValue;
}

interface PreparedProductOperatorEvent {
  readonly eventId: string;
  readonly componentId: string;
  readonly correlationId: string;
  readonly occurredAtMs: number;
  readonly persistedAtMs: number;
  readonly serializedProjection: string;
  readonly event: Readonly<SystemTraceEvent>;
}

interface UnresolvedOrderDbRow {
  request_id: number;
  requested_at: number;
  symbol: string;
  data: string | null;
  recovery_attempts: number;
  last_recovery_at: number | null;
  last_recovery_data: string | null;
}

interface FillDbRow {
  symbol: string;
  trade_id: number;
  order_id: number | null;
  side: string;
  price: unknown;
  qty: unknown;
  quote_qty: unknown;
  commission: unknown;
  commission_asset: string | null;
  ts: number;
  source: string;
  money_encoding: unknown;
}

interface DurableMutationAuthorityDbRow {
  unresolved_order_count: unknown;
  unresolved_loan_count: unknown;
  malformed_order_row_count: unknown;
  malformed_loan_row_count: unknown;
}

interface SignalDbRow {
  id: number;
  symbol: string;
  side: string;
  opened_ts: number;
  closed_ts: number | null;
  basis_open: number;
  basis_peak: number;
  basis_close: number | null;
  funding_open: number | null;
}

interface BrowserSessionDbRow {
  id: string;
  ip: string;
  country: string | null;
  system: string;
  browser: string;
  device: string | null;
  model: string | null;
  first_seen: number;
  last_seen: number;
  requests: number;
}

export interface LedgerOptions {
  /** Synchronous fail-closed authority check immediately before any fs/DB mutation. */
  readonly beforeMutation?: () => void;
}

export class Ledger extends EventEmitter {
  private db: Database.Database;
  private healthProbeCache: { checkedAt: number; writable: boolean } | null = null;
  private closed = false;

  constructor(
    dataDir = path.resolve(process.cwd(), 'data'),
    options: Readonly<LedgerOptions> = {},
  ) {
    super();
    const databasePath = path.join(dataDir, 'cosmos.db');
    options.beforeMutation?.();
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(databasePath);
    try {
      this.db.function(
        EVENT_METADATA_VALIDATOR_SQL_FUNCTION,
        { deterministic: true },
        (
          severity: unknown,
          source: unknown,
          strategy: unknown,
          status: unknown,
          reason: unknown,
          message: unknown,
          correlation: unknown,
          createdAt: unknown,
        ) => {
          prepareStoredLedgerEventMetadata({
            severity,
            source,
            strategy,
            status,
            reason,
            message,
            correlation,
            createdAt,
          });
          return 1n;
        },
      );
      const startupSchemaVersion = this.db.pragma('user_version', { simple: true }) as unknown;
      if (!Number.isSafeInteger(startupSchemaVersion) || (startupSchemaVersion as number) < 0) {
        throw new Error('LEDGER_SCHEMA_VERSION_MALFORMED');
      }
      if ((startupSchemaVersion as number) > LEDGER_SCHEMA_VERSION) {
        throw new Error('LEDGER_SCHEMA_VERSION_UNSUPPORTED_NEWER');
      }
      const legacyCompatibility = startupSchemaVersion === 0
        ? readLegacyJournalCompatibility(dataDir)
        : null;
      const startupFillTable = this.db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'fills'
      `).get() as { count: number };
      if ((startupSchemaVersion as number) > 0 && startupFillTable.count !== 1) {
        throw new Error('LEDGER_FILL_SCHEMA_MISSING');
      }
      const startupEventShape = eventTableShape(this.db);
      const allowFreshEventV3 = (() => {
        const requireEmptyFreshStorage = () => {
          if (startupEventShape !== 'MISSING') {
            throw new Error('LEDGER_EVENT_SCHEMA_VERSION_MISMATCH');
          }
          const existingSchemaObjects = this.db.prepare(`
            SELECT COUNT(*) AS count
            FROM sqlite_master
            WHERE type IN ('table', 'index', 'trigger', 'view')
              AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
          `).get() as { count: unknown };
          if (existingSchemaObjects.count !== 0) {
            throw new Error('LEDGER_EVENT_SCHEMA_MISSING');
          }
          return true;
        };
        const version = startupSchemaVersion as number;
        if (version === LEDGER_SCHEMA_VERSION) {
          if (startupEventShape === 'MISSING') throw new Error('LEDGER_EVENT_SCHEMA_MISSING');
          if (startupEventShape !== 'V3') throw new Error('LEDGER_EVENT_SCHEMA_MALFORMED');
          assertCanonicalEventStorage(this.db);
          return false;
        }
        if (version > 0) {
          if (startupEventShape === 'MISSING') throw new Error('LEDGER_EVENT_SCHEMA_MISSING');
          if (startupEventShape === 'V3') throw new Error('LEDGER_EVENT_SCHEMA_VERSION_MISMATCH');
          if (startupEventShape !== 'LEGACY') throw new Error('LEDGER_EVENT_SCHEMA_MALFORMED');
          assertMigratableEventIndexes(this.db);
          assertMigratableEventTriggers(this.db);
          return false;
        }
        if (legacyCompatibility !== null) {
          if (legacyCompatibility.prestartBarrier
              && legacyCompatibility.dataSchema === 0) {
            return requireEmptyFreshStorage();
          }
          if (startupEventShape === 'MISSING') throw new Error('LEDGER_EVENT_SCHEMA_MISSING');
          if (legacyCompatibility.dataSchema !== 1 || startupEventShape === 'V3') {
            throw new Error('LEDGER_EVENT_SCHEMA_VERSION_MISMATCH');
          }
          if (startupEventShape !== 'LEGACY') throw new Error('LEDGER_EVENT_SCHEMA_MALFORMED');
          const compatibilityObjects = this.db.prepare(`
            SELECT COUNT(*) AS count
            FROM sqlite_master
            WHERE name = ? COLLATE NOCASE
          `).get(LEDGER_SCHEMA_COMPATIBILITY_TABLE) as { count: unknown };
          if (compatibilityObjects.count !== 0) {
            try {
              const rows = this.db.prepare(`
                SELECT singleton, current_schema_version, rollback_floor
                FROM ${LEDGER_SCHEMA_COMPATIBILITY_TABLE}
                LIMIT 1
              `).all();
              if (rows.length !== 0) {
                throw new Error('LEDGER_SCHEMA_COMPATIBILITY_LEGACY_COLLISION');
              }
            } catch {
              throw new Error('LEDGER_SCHEMA_COMPATIBILITY_LEGACY_COLLISION');
            }
          }
          assertMigratableEventIndexes(this.db);
          assertMigratableEventTriggers(this.db);
          return false;
        }
        return requireEmptyFreshStorage();
      })();

      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      // Make the concurrency contract explicit rather than inherited by
      // accident (Part 4 #10): busy_timeout matches better-sqlite3's implicit
      // 5000 ms and wal_autocheckpoint pins SQLite's 1000-page default, so a
      // driver or SQLite upgrade cannot silently change either. The runtime
      // `synchronous` level is deliberately NOT set here: the shutdown path
      // escalates to FULL for the clean-boot marker, and moving the runtime
      // level (e.g. to NORMAL) is a durability decision for the director.
      this.db.pragma('busy_timeout = 5000');
      this.db.pragma('wal_autocheckpoint = 1000');
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_schema_compatibility (
        singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton = 1),
        current_schema_version INTEGER NOT NULL CHECK(
          typeof(current_schema_version) = 'integer' AND current_schema_version >= 1
        ),
        rollback_floor INTEGER NOT NULL CHECK(
          typeof(rollback_floor) = 'integer'
          AND rollback_floor >= 0
          AND rollback_floor <= current_schema_version
        )
      );
      ${CREATE_EVENT_V3_TABLE_SQL};
      CREATE TABLE IF NOT EXISTS fills (
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
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        opened_ts INTEGER NOT NULL,
        closed_ts INTEGER,
        basis_open REAL NOT NULL,
        basis_peak REAL NOT NULL,
        basis_close REAL,
        funding_open REAL
      );
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS product_incident_source_dispositions (
        source_event_id INTEGER PRIMARY KEY REFERENCES events(id),
        disposition_event_id INTEGER NOT NULL UNIQUE REFERENCES events(id),
        previous_source_event_id INTEGER NOT NULL,
        previous_disposition_event_id INTEGER NOT NULL,
        processed_count INTEGER NOT NULL UNIQUE CHECK(processed_count >= 1),
        chain_digest TEXT NOT NULL UNIQUE CHECK(length(chain_digest) = 64)
      );
      CREATE TRIGGER IF NOT EXISTS product_incident_source_dispositions_no_update
        BEFORE UPDATE ON product_incident_source_dispositions
        BEGIN SELECT RAISE(ABORT, 'product incident checkpoint history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS product_incident_source_dispositions_no_delete
        BEFORE DELETE ON product_incident_source_dispositions
        BEGIN SELECT RAISE(ABORT, 'product incident checkpoint history is immutable'); END;
      ${CREATE_EVENT_TRIGGERS_SQL};
      CREATE TABLE IF NOT EXISTS product_component_desired_state (
        component_id TEXT PRIMARY KEY,
        desired_state TEXT NOT NULL,
        state_revision INTEGER NOT NULL CHECK(state_revision >= 0),
        restart_generation INTEGER NOT NULL CHECK(restart_generation >= 0),
        updated_at_ms INTEGER NOT NULL,
        correlation_id TEXT NOT NULL,
        ledger_event_id INTEGER NOT NULL REFERENCES events(id)
      );
      CREATE TABLE IF NOT EXISTS product_commands (
        command_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_digest TEXT NOT NULL,
        command_type TEXT NOT NULL,
        target_component_id TEXT NOT NULL,
        authenticated_operator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        required_authority TEXT NOT NULL,
        request_payload_json TEXT NOT NULL,
        preview_digest TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
        resulting_revision INTEGER CHECK(resulting_revision IS NULL OR resulting_revision >= 0),
        status TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        completed_at_ms INTEGER,
        correlation_id TEXT NOT NULL,
        before_projection_json TEXT,
        after_projection_json TEXT,
        result_json TEXT,
        ledger_event_id INTEGER REFERENCES events(id),
        CHECK(expires_at_ms > created_at_ms),
        CHECK(completed_at_ms IS NULL OR completed_at_ms >= created_at_ms),
        CHECK(length(reason) BETWEEN 1 AND 500 AND reason = trim(reason)),
        CHECK(json_valid(request_payload_json) AND length(CAST(request_payload_json AS BLOB)) <= 262144),
        CHECK(json_valid(preview_json) AND length(CAST(preview_json AS BLOB)) <= 262144),
        CHECK(before_projection_json IS NULL OR (json_valid(before_projection_json) AND length(CAST(before_projection_json AS BLOB)) <= 262144)),
        CHECK(after_projection_json IS NULL OR (json_valid(after_projection_json) AND length(CAST(after_projection_json AS BLOB)) <= 262144)),
        CHECK(result_json IS NULL OR (json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 262144)),
        UNIQUE(idempotency_key, request_digest)
      );
      CREATE TABLE IF NOT EXISTS product_config_revisions (
        config_revision TEXT PRIMARY KEY,
        content_digest TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        effective_at_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        created_by_operator_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        config_json TEXT NOT NULL,
        ledger_event_id INTEGER NOT NULL REFERENCES events(id),
        CHECK(json_valid(config_json) AND length(CAST(config_json AS BLOB)) <= 262144)
      );
      CREATE TABLE IF NOT EXISTS product_identity_references (
        reference_type TEXT NOT NULL CHECK(reference_type IN (
          'OPPORTUNITY', 'CAPITAL_VERDICT', 'RISK_VERDICT', 'TICKET', 'LEG', 'ORDER',
          'AMBIGUOUS_MUTATION', 'POSITION', 'LIABILITY', 'RECOVERY_CAMPAIGN',
          'MODEL_ASSESSMENT', 'OUTCOME', 'BOOT_OPERATION', 'SHUTDOWN_OPERATION',
          'DEPLOYMENT_REVISION'
        )),
        reference_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_revision TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(length(owner_revision) > 0),
        owner_state TEXT NOT NULL,
        resolution_state TEXT NOT NULL CHECK(resolution_state IN (
          'OPEN', 'TERMINAL_PROVEN', 'AMBIGUOUS', 'RECOVERY_REQUIRED', 'UNAVAILABLE', 'UNKNOWN'
        )),
        correlation_id TEXT NOT NULL,
        parent_reference_type TEXT CHECK(parent_reference_type IS NULL OR parent_reference_type IN (
          'OPPORTUNITY', 'CAPITAL_VERDICT', 'RISK_VERDICT', 'TICKET', 'LEG', 'ORDER',
          'AMBIGUOUS_MUTATION', 'POSITION', 'LIABILITY', 'RECOVERY_CAMPAIGN',
          'MODEL_ASSESSMENT', 'OUTCOME', 'BOOT_OPERATION', 'SHUTDOWN_OPERATION',
          'DEPLOYMENT_REVISION'
        )),
        parent_reference_id TEXT,
        payload_hash TEXT,
        owner_projection_json TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        valid_until_ms INTEGER,
        ledger_event_id INTEGER NOT NULL REFERENCES events(id),
        PRIMARY KEY(reference_type, reference_id, owner_revision),
        CHECK((parent_reference_type IS NULL) = (parent_reference_id IS NULL)),
        CHECK(valid_until_ms IS NULL OR valid_until_ms >= occurred_at_ms),
        CHECK(json_valid(owner_projection_json) AND length(CAST(owner_projection_json AS BLOB)) <= 262144)
      );
      CREATE TABLE IF NOT EXISTS product_operator_events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_event_id INTEGER NOT NULL UNIQUE REFERENCES events(id),
        event_id TEXT NOT NULL UNIQUE,
        component_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        persisted_at_ms INTEGER NOT NULL,
        material_projection_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS product_incidents (
        incident_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        root_component_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        capital_relevant INTEGER NOT NULL CHECK(capital_relevant IN (0,1)),
        state TEXT NOT NULL,
        first_seen_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        event_count INTEGER NOT NULL CHECK(event_count >= 1),
        acknowledged_at_ms INTEGER,
        acknowledged_by_operator_id TEXT,
        resolved_at_ms INTEGER,
        correlation_id TEXT NOT NULL,
        ledger_event_id INTEGER NOT NULL REFERENCES events(id),
        CHECK(last_seen_at_ms >= first_seen_at_ms),
        CHECK((acknowledged_at_ms IS NULL) = (acknowledged_by_operator_id IS NULL)),
        CHECK(acknowledged_at_ms IS NULL OR acknowledged_at_ms >= first_seen_at_ms),
        CHECK(resolved_at_ms IS NULL OR resolved_at_ms >= first_seen_at_ms)
      );
      CREATE TABLE IF NOT EXISTS product_boot_release_revisions (
        operation_id TEXT PRIMARY KEY,
        operation_type TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK(generation >= 0),
        tested_commit TEXT,
        deployed_commit TEXT,
        config_revision TEXT,
        schema_revision TEXT NOT NULL,
        model_revision TEXT,
        started_at_ms INTEGER NOT NULL,
        completed_at_ms INTEGER,
        clean INTEGER CHECK(clean IN (0,1)),
        blocker_code TEXT,
        correlation_id TEXT NOT NULL,
        ledger_event_id INTEGER NOT NULL REFERENCES events(id),
        CHECK(completed_at_ms IS NULL OR completed_at_ms >= started_at_ms)
      );
      CREATE TABLE IF NOT EXISTS browser_sessions (
        id TEXT PRIMARY KEY,
        ip TEXT NOT NULL,
        country TEXT,
        system TEXT NOT NULL,
        browser TEXT NOT NULL,
        device TEXT,
        model TEXT,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_product_operator_events_correlation_cursor
        ON product_operator_events (correlation_id, cursor);
      CREATE INDEX IF NOT EXISTS idx_product_operator_events_component_cursor
        ON product_operator_events (component_id, cursor DESC);
      CREATE INDEX IF NOT EXISTS idx_product_commands_target_created
        ON product_commands (target_component_id, created_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_product_commands_status_created
        ON product_commands (status, created_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_product_commands_correlation
        ON product_commands (correlation_id);
      CREATE INDEX IF NOT EXISTS idx_product_identity_references_correlation_occurred
        ON product_identity_references (correlation_id, occurred_at_ms);
      CREATE INDEX IF NOT EXISTS idx_product_identity_references_parent
        ON product_identity_references (parent_reference_type, parent_reference_id);
      CREATE INDEX IF NOT EXISTS idx_product_identity_references_resolution_occurred
        ON product_identity_references (reference_type, resolution_state, occurred_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_product_incidents_state_severity_last_seen
        ON product_incidents (state, severity, last_seen_at_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_fills_ts ON fills (ts DESC);
      CREATE INDEX IF NOT EXISTS idx_fills_total_order
        ON fills (ts ASC, symbol COLLATE BINARY ASC, trade_id ASC);
      CREATE INDEX IF NOT EXISTS idx_browser_sessions_last_seen ON browser_sessions (last_seen DESC);
    `);
      migrateFillStorage(this.db);
      migrateEventStorage(
        this.db,
        allowFreshEventV3,
        legacyCompatibility?.rollbackFloor ?? 0,
      );

      const compatibility = this.readSchemaCompatibility();
      if (compatibility.state !== 'AVAILABLE') {
        throw new Error(compatibility.reasonCode ?? 'LEDGER_SCHEMA_COMPATIBILITY_UNAVAILABLE');
      }

      const browserSessionColumns = new Set(
        (this.db.prepare('PRAGMA table_info(browser_sessions)').all() as { name: string }[]).map((column) => column.name),
      );
      if (!browserSessionColumns.has('device')) this.db.exec('ALTER TABLE browser_sessions ADD COLUMN device TEXT');
      if (!browserSessionColumns.has('model')) this.db.exec('ALTER TABLE browser_sessions ADD COLUMN model TEXT');
      // `local` was a display placeholder from the first telemetry version, not
      // a real address. New sessions persist the actual socket/proxy/edge IP.
      this.db.prepare("DELETE FROM browser_sessions WHERE ip = 'local'").run();
      // July 2026 identity migration: the former raw 16-char IP+UA ids collapsed
      // separate devices behind one NAT. New ids are explicitly versioned as
      // device-token (`d_`) or privacy fallback (`f_`) records.
      this.db.prepare("DELETE FROM browser_sessions WHERE id NOT GLOB 'd_*' AND id NOT GLOB 'f_*'").run();
      this.trimBrowserSessions(Date.now());
    } catch (error) {
      this.closed = true;
      try {
        if (this.db.open) this.db.close();
      } catch {
        // Preserve the exact startup compatibility failure.
      }
      throw error;
    }
  }

  logEvent(
    kind: string,
    symbol?: string | null,
    data?: unknown,
    metadata: Readonly<LedgerEventMetadataInput> = {},
  ): LedgerEvent {
    const ts = Date.now();
    const preparedData = prepareLedgerEventData(data, data !== undefined);
    validateFinancialMutationEvent(kind, symbol ?? null, preparedData.value);
    const preparedMetadata = snapshotLedgerEventMetadata(metadata);
    const info = this.db
      .prepare(LEDGER_EVENT_INSERT_SQL)
      .run(...eventInsertValues(ts, kind, symbol ?? null, preparedData.serialized, preparedMetadata));
    const ev = ledgerEventFromAppend(
      Number(info.lastInsertRowid),
      ts,
      kind,
      symbol ?? null,
      preparedData.value,
      preparedMetadata,
    );
    this.emit('event', ev);
    return ev;
  }

  /**
   * Persists a small state transition as one SQLite commit. This is used when
   * a recovery-state event and its correlated financial response must never
   * be split by a disk failure. EventEmitter delivery is post-commit and
   * deliberately cannot turn a durable commit back into an apparent failure.
   */
  logEventsAtomically(records: readonly LedgerEventInput[]): LedgerEvent[] {
    if (!Array.isArray(records) || records.length < 1 || records.length > 8) {
      throw new Error('atomic ledger event batch must contain between 1 and 8 records');
    }
    const preparedRecords = records.map((record) => {
      if (record === null || typeof record !== 'object') {
        throw new Error('invalid atomic ledger event record');
      }
      const kind = record.kind;
      const rawSymbol = record.symbol;
      const rawData = record.data;
      const hasData = Object.hasOwn(record, 'data');
      if (typeof kind !== 'string' || !/^[a-z0-9_.-]{1,64}$/.test(kind)) {
        throw new Error('invalid atomic ledger event kind');
      }
      if (rawSymbol !== undefined && rawSymbol !== null && typeof rawSymbol !== 'string') {
        throw new Error('invalid atomic ledger event symbol');
      }
      if (!hasData && rawData !== undefined) {
        throw new Error('invalid atomic ledger event data');
      }
      const symbol = rawSymbol ?? null;
      const data = prepareLedgerEventData(rawData, hasData);
      validateFinancialMutationEvent(kind, symbol, data.value);
      return Object.freeze({
        kind,
        symbol,
        data,
        metadata: snapshotLedgerEventMetadata(record),
      });
    });
    const ts = Date.now();
    const insert = this.db.prepare(LEDGER_EVENT_INSERT_SQL);
    const commit = this.db.transaction(() => preparedRecords.map((record) => {
      const info = insert.run(...eventInsertValues(
        ts,
        record.kind,
        record.symbol,
        record.data.serialized,
        record.metadata,
      ));
      return ledgerEventFromAppend(
        Number(info.lastInsertRowid),
        ts,
        record.kind,
        record.symbol,
        record.data.value,
        record.metadata,
      );
    }));
    const events = commit();
    const cloneCommittedEvent = (event: Readonly<LedgerEvent>, index: number): LedgerEvent => ({
      ...event,
      data: preparedRecords[index].data.serialized === null
        ? null
        : JSON.parse(preparedRecords[index].data.serialized) as unknown,
    });
    const exactEvents = events.map((event, index) => cloneCommittedEvent(event, index));
    for (const [index, event] of events.entries()) {
      for (const listener of this.rawListeners('event')) {
        try {
          listener.call(this, cloneCommittedEvent(event, index));
        } catch {
          // SQLite is the source of truth. A listener failure after commit must
          // not make the caller retry or reinterpret a financial outcome.
        }
      }
    }
    return exactEvents;
  }

  recentEvents(limit = 100, kind?: string, symbol?: string, q?: string, since?: number, beforeId?: number, until?: number, offset = 0, afterId?: number): LedgerEvent[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (kind) {
      clauses.push('kind = ?');
      params.push(kind);
    }
    if (symbol) {
      clauses.push('symbol = ?');
      params.push(symbol);
    }
    if (q) {
      const like = eventSearchPattern(q);
      if (!like) return [];
      clauses.push("id > (SELECT COALESCE(MAX(id), 0) - ? FROM events)");
      params.push(EVENT_SEARCH_SCAN_ROWS);
      clauses.push(`(
        data LIKE ? ESCAPE '\\' OR kind LIKE ? ESCAPE '\\' OR symbol LIKE ? ESCAPE '\\'
        OR severity LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\'
        OR strategy LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\'
        OR reason LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\'
        OR correlation LIKE ? ESCAPE '\\'
      )`);
      params.push(like, like, like, like, like, like, like, like, like, like);
    }
    if (since !== undefined && Number.isFinite(since)) {
      clauses.push('ts >= ?');
      params.push(since);
    }
    if (beforeId !== undefined && Number.isFinite(beforeId)) {
      clauses.push('id < ?');
      params.push(beforeId);
    }
    if (afterId !== undefined && Number.isFinite(afterId)) {
      clauses.push('id > ?');
      params.push(afterId);
    }
    if (until !== undefined && Number.isFinite(until)) {
      clauses.push('ts < ?');
      params.push(until);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = boundedInteger(limit, 1, EVENT_RESULT_MAX, 100);
    const safeOffset = boundedInteger(offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const order = afterId === undefined ? 'DESC' : 'ASC';
    const rows = this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY id ${order} LIMIT ? OFFSET ?`)
      .all(...params, safeLimit, safeOffset) as EventDbRow[];
    return rows.map(parseEvent);
  }

  countEvents(kind?: string, symbol?: string, q?: string, since?: number, until?: number): number {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (kind) { clauses.push('kind = ?'); params.push(kind); }
    if (symbol) { clauses.push('symbol = ?'); params.push(symbol); }
    if (q) {
      const like = eventSearchPattern(q);
      if (!like) return 0;
      clauses.push("id > (SELECT COALESCE(MAX(id), 0) - ? FROM events)");
      params.push(EVENT_SEARCH_SCAN_ROWS);
      clauses.push(`(
        data LIKE ? ESCAPE '\\' OR kind LIKE ? ESCAPE '\\' OR symbol LIKE ? ESCAPE '\\'
        OR severity LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\'
        OR strategy LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\'
        OR reason LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\'
        OR correlation LIKE ? ESCAPE '\\'
      )`);
      params.push(like, like, like, like, like, like, like, like, like, like);
    }
    if (since !== undefined && Number.isFinite(since)) { clauses.push('ts >= ?'); params.push(since); }
    if (until !== undefined && Number.isFinite(until)) { clauses.push('ts < ?'); params.push(until); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(${EVENT_METADATA_VALIDATOR_SQL_FUNCTION}(
               severity, source, strategy, status, reason, message, correlation, created_at
             )), 0) AS validatedCount
      FROM events ${where}
    `).safeIntegers().get(...params) as {
      readonly count: bigint;
      readonly validatedCount: bigint;
    };
    if (row.validatedCount !== row.count || row.count > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('LEDGER_EVENT_COUNT_MALFORMED');
    }
    return Number(row.count);
  }

  eventsSince(ts: number, kind: string): LedgerEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE kind = ? AND ts >= ? ORDER BY id ASC')
      .all(kind, ts) as EventDbRow[];
    return rows.map(parseEvent);
  }

  firstEventSince(ts: number, kind: string): LedgerEvent | null {
    const row = this.db
      .prepare('SELECT * FROM events WHERE kind = ? AND ts >= ? ORDER BY id ASC LIMIT 1')
      .get(kind, ts) as EventDbRow | undefined;
    return row ? parseEvent(row) : null;
  }

  /**
   * Reads the durable local financial-mutation posture without allowing
   * malformed request/response evidence to disappear behind JSON filters.
   * Corrupt request rows are ambiguous until repaired; a read failure is
   * UNKNOWN. Only a complete, readable all-zero scan proves absence.
   */
  readDurableMutationAuthority(): Readonly<DurableMutationAuthorityRead> {
    try {
      const row = this.db.prepare(`
        WITH request_fields AS (
          SELECT
            request.id,
            request.kind,
            request.ts,
            request.symbol,
            json_valid(request.data) AS valid_json,
            CASE WHEN json_valid(request.data)
              THEN json_type(request.data, '$.reservationId') END AS reservation_type,
            CASE WHEN json_valid(request.data)
              THEN json_extract(request.data, '$.reservationId') END AS reservation_id,
            CASE WHEN json_valid(request.data)
              THEN json_type(request.data, '$.params.newClientOrderId') END AS client_order_id_type,
            CASE WHEN json_valid(request.data)
              THEN json_extract(request.data, '$.params.newClientOrderId') END AS client_order_id,
            CASE WHEN json_valid(request.data)
              THEN json_type(request.data, '$.reservedNotionalUsd') END AS reserved_notional_type,
            CASE WHEN json_valid(request.data)
              THEN json_extract(request.data, '$.reservedNotionalUsd') END AS reserved_notional,
            CASE WHEN json_valid(request.data)
              THEN json_type(request.data, '$.mutationId') END AS mutation_id_type,
            CASE WHEN json_valid(request.data)
              THEN json_extract(request.data, '$.mutationId') END AS mutation_id,
            CASE WHEN json_valid(request.data)
              THEN json_type(request.data, '$.actionKey') END AS action_key_type,
            CASE WHEN json_valid(request.data)
              THEN json_extract(request.data, '$.actionKey') END AS action_key,
            CASE WHEN json_valid(request.data)
              THEN json_type(request.data, '$.riskIncreasing') END AS risk_increasing_type
          FROM events AS request
          WHERE request.kind IN ('order_request', 'loan_request')
        ),
        classified AS (
          SELECT
            fields.*,
            CASE
              WHEN fields.kind = 'order_request' THEN COALESCE((
                fields.valid_json = 1
                AND typeof(fields.ts) = 'integer'
                AND fields.ts > 0
                AND typeof(fields.symbol) = 'text'
                AND length(fields.symbol) BETWEEN 4 AND 20
                AND fields.symbol NOT GLOB '*[^A-Z0-9]*'
                AND fields.reservation_type = 'text'
                AND length(fields.reservation_id) BETWEEN 16 AND 64
                AND fields.reservation_id NOT GLOB '*[^0-9A-Fa-f-]*'
                AND fields.client_order_id_type = 'text'
                AND length(fields.client_order_id) BETWEEN 1 AND 36
                AND fields.client_order_id NOT GLOB '*[^A-Za-z0-9_-]*'
                AND fields.reserved_notional_type IN ('integer', 'real')
                AND fields.reserved_notional > 0
              ), 0)
              WHEN fields.kind = 'loan_request' THEN COALESCE((
                fields.valid_json = 1
                AND typeof(fields.ts) = 'integer'
                AND fields.ts > 0
                AND fields.symbol IS NULL
                AND fields.mutation_id_type = 'text'
                AND length(fields.mutation_id) BETWEEN 1 AND 128
                AND fields.action_key_type = 'text'
                AND length(fields.action_key) BETWEEN 1 AND 160
                AND fields.risk_increasing_type IN ('true', 'false')
              ), 0)
              ELSE 0
            END AS request_valid
          FROM request_fields AS fields
        )
        SELECT
          COALESCE(SUM(CASE
            WHEN request.kind = 'order_request' AND request.request_valid = 0 THEN 1 ELSE 0 END), 0)
            AS malformed_order_row_count,
          COALESCE(SUM(CASE
            WHEN request.kind = 'loan_request' AND request.request_valid = 0 THEN 1 ELSE 0 END), 0)
            AS malformed_loan_row_count,
          COALESCE(SUM(CASE
            WHEN request.kind = 'order_request'
              AND request.request_valid = 1
              AND NOT EXISTS (
                SELECT 1
                FROM events AS response
                WHERE response.id > request.id
                  AND response.kind = 'order_response'
                  AND CASE WHEN json_valid(response.data) THEN
                    json_type(response.data, '$.reservationId') = 'text'
                    AND json_extract(response.data, '$.reservationId') = request.reservation_id
                    AND json_type(response.data, '$.outcome') = 'text'
                    AND json_extract(response.data, '$.outcome') IN (
                      'accepted', 'accepted_partial_terminal', 'accepted_reconciled',
                      'accepted_operator_verified', 'not_sent', 'not_sent_rejected',
                      'not_sent_reconciled', 'not_sent_operator_verified'
                    )
                  ELSE 0 END
              )
            THEN 1 ELSE 0 END), 0) AS unresolved_order_count,
          COALESCE(SUM(CASE
            WHEN request.kind = 'loan_request'
              AND request.request_valid = 1
              AND NOT EXISTS (
                SELECT 1
                FROM events AS response
                WHERE response.id > request.id
                  AND response.kind = 'loan_response'
                  AND CASE WHEN json_valid(response.data) THEN
                    json_type(response.data, '$.mutationId') = 'text'
                    AND json_extract(response.data, '$.mutationId') = request.mutation_id
                    AND json_type(response.data, '$.outcome') = 'text'
                    AND json_extract(response.data, '$.outcome') IN (
                      'succeeded', 'failed', 'reconciled_by_operator'
                    )
                  ELSE 0 END
              )
            THEN 1 ELSE 0 END), 0) AS unresolved_loan_count
        FROM classified AS request
      `).get() as DurableMutationAuthorityDbRow | undefined;
      const unresolvedOrderCount = strictMutationCount(row?.unresolved_order_count);
      const unresolvedLoanCount = strictMutationCount(row?.unresolved_loan_count);
      const malformedOrderRowCount = strictMutationCount(row?.malformed_order_row_count);
      const malformedLoanRowCount = strictMutationCount(row?.malformed_loan_row_count);
      const posture = unresolvedOrderCount > 0
        || unresolvedLoanCount > 0
        || malformedOrderRowCount > 0
        || malformedLoanRowCount > 0
        ? 'AMBIGUOUS'
        : 'PROVEN_ABSENT';
      return Object.freeze({
        posture,
        unresolvedOrderCount,
        unresolvedLoanCount,
        malformedOrderRowCount,
        malformedLoanRowCount,
        readErrorCount: 0,
      });
    } catch {
      return Object.freeze({
        posture: 'UNKNOWN',
        unresolvedOrderCount: 0,
        unresolvedLoanCount: 0,
        malformedOrderRowCount: 0,
        malformedLoanRowCount: 0,
        readErrorCount: 1,
      });
    }
  }

  /**
   * Requests from an earlier UTC day that still have no correlated response.
   * They do not belong in today's notional sum, but they must keep live
   * admission fail-closed until exchange reconciliation proves an outcome.
   */
  unresolvedOrderRequestsBefore(ts: number): number {
    const authority = this.readDurableMutationAuthority();
    if (authority.readErrorCount > 0) throw new Error('FINANCIAL_MUTATION_AUTHORITY_READ_FAILED');
    if (authority.malformedOrderRowCount > 0) return authority.malformedOrderRowCount;
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM events AS request
      WHERE request.kind = 'order_request'
        AND request.ts < ?
        AND json_valid(request.data)
        AND json_type(request.data, '$.reservationId') = 'text'
        AND length(json_extract(request.data, '$.reservationId')) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM events AS response
          WHERE response.id > request.id
            AND response.kind = 'order_response'
            AND json_valid(response.data)
            AND json_extract(response.data, '$.reservationId') = json_extract(request.data, '$.reservationId')
            AND json_type(response.data, '$.outcome') = 'text'
            AND json_extract(response.data, '$.outcome') IN (
              'accepted', 'accepted_partial_terminal', 'accepted_reconciled',
              'accepted_operator_verified', 'not_sent', 'not_sent_rejected',
              'not_sent_reconciled', 'not_sent_operator_verified'
            )
        )
    `).get(ts) as { count?: number } | undefined;
    return Number(row?.count) || 0;
  }

  /**
   * Returns one fair wrap-around page of unresolved requests. `afterRequestId`
   * is a scheduling cursor, not a filter: rows after it are selected first and
   * the query then wraps to older rows. Permanently unresolvable early rows can
   * therefore never starve newer financial requests.
   */
  unresolvedOrderRequests(limit = 100, afterRequestId = 0, wrapAround = true): UnresolvedOrderRequest[] {
    const authority = this.readDurableMutationAuthority();
    if (authority.readErrorCount > 0) throw new Error('FINANCIAL_MUTATION_AUTHORITY_READ_FAILED');
    if (authority.malformedOrderRowCount > 0) throw new Error('MALFORMED_ORDER_MUTATION_EVIDENCE');
    const safeLimit = boundedInteger(limit, 1, 500, 100);
    const safeCursor = boundedInteger(afterRequestId, 0, Number.MAX_SAFE_INTEGER, 0);
    const cursorClause = wrapAround ? '' : 'AND request.id > ?';
    const orderBy = wrapAround
      ? 'CASE WHEN request.id > ? THEN 0 ELSE 1 END, request.id ASC'
      : 'request.id ASC';
    const rows = this.db.prepare(`
      SELECT
        request.id AS request_id,
        request.ts AS requested_at,
        request.symbol,
        request.data,
        (
          SELECT COUNT(*)
          FROM events AS recovery_attempt
          WHERE recovery_attempt.kind = 'order_recovery'
            AND json_valid(recovery_attempt.data)
            AND json_extract(recovery_attempt.data, '$.reservationId') = json_extract(request.data, '$.reservationId')
            AND json_extract(recovery_attempt.data, '$.state') = 'reconciling'
        ) AS recovery_attempts,
        (
          SELECT recovery.ts
          FROM events AS recovery
          WHERE recovery.kind = 'order_recovery'
            AND json_valid(recovery.data)
            AND json_extract(recovery.data, '$.reservationId') = json_extract(request.data, '$.reservationId')
          ORDER BY recovery.id DESC
          LIMIT 1
        ) AS last_recovery_at,
        (
          SELECT recovery.data
          FROM events AS recovery
          WHERE recovery.kind = 'order_recovery'
            AND json_valid(recovery.data)
            AND json_extract(recovery.data, '$.reservationId') = json_extract(request.data, '$.reservationId')
          ORDER BY recovery.id DESC
          LIMIT 1
        ) AS last_recovery_data
      FROM events AS request
      WHERE request.kind = 'order_request'
        AND request.symbol IS NOT NULL
        AND json_valid(request.data)
        AND json_type(request.data, '$.reservationId') = 'text'
        AND json_type(request.data, '$.params.newClientOrderId') = 'text'
        ${cursorClause}
        AND NOT EXISTS (
          SELECT 1
          FROM events AS response
          WHERE response.id > request.id
            AND response.kind = 'order_response'
            AND json_valid(response.data)
            AND json_extract(response.data, '$.reservationId') = json_extract(request.data, '$.reservationId')
            AND json_type(response.data, '$.outcome') = 'text'
            AND json_extract(response.data, '$.outcome') IN (
              'accepted', 'accepted_partial_terminal', 'accepted_reconciled',
              'accepted_operator_verified', 'not_sent', 'not_sent_rejected',
              'not_sent_reconciled', 'not_sent_operator_verified'
            )
        )
      ORDER BY ${orderBy}
      LIMIT ?
    `).all(safeCursor, safeLimit) as UnresolvedOrderDbRow[];
    return rows.flatMap(parseUnresolvedOrderRow);
  }

  unresolvedOrderRequest(reservationId: string, clientOrderId: string): UnresolvedOrderRequest | null {
    const authority = this.readDurableMutationAuthority();
    if (authority.readErrorCount > 0) throw new Error('FINANCIAL_MUTATION_AUTHORITY_READ_FAILED');
    if (authority.malformedOrderRowCount > 0) throw new Error('MALFORMED_ORDER_MUTATION_EVIDENCE');
    if (!/^[0-9a-f-]{16,64}$/i.test(reservationId) || !/^[A-Za-z0-9_-]{1,36}$/.test(clientOrderId)) return null;
    const row = this.db.prepare(`
      SELECT
        request.id AS request_id,
        request.ts AS requested_at,
        request.symbol,
        request.data,
        (
          SELECT COUNT(*)
          FROM events AS recovery_attempt
          WHERE recovery_attempt.kind = 'order_recovery'
            AND json_valid(recovery_attempt.data)
            AND json_extract(recovery_attempt.data, '$.reservationId') = json_extract(request.data, '$.reservationId')
            AND json_extract(recovery_attempt.data, '$.state') = 'reconciling'
        ) AS recovery_attempts,
        (
          SELECT recovery.ts
          FROM events AS recovery
          WHERE recovery.kind = 'order_recovery'
            AND json_valid(recovery.data)
            AND json_extract(recovery.data, '$.reservationId') = json_extract(request.data, '$.reservationId')
          ORDER BY recovery.id DESC
          LIMIT 1
        ) AS last_recovery_at,
        (
          SELECT recovery.data
          FROM events AS recovery
          WHERE recovery.kind = 'order_recovery'
            AND json_valid(recovery.data)
            AND json_extract(recovery.data, '$.reservationId') = json_extract(request.data, '$.reservationId')
          ORDER BY recovery.id DESC
          LIMIT 1
        ) AS last_recovery_data
      FROM events AS request
      WHERE request.kind = 'order_request'
        AND request.symbol IS NOT NULL
        AND json_valid(request.data)
        AND json_extract(request.data, '$.reservationId') = ?
        AND json_extract(request.data, '$.params.newClientOrderId') = ?
        AND NOT EXISTS (
          SELECT 1
          FROM events AS response
          WHERE response.id > request.id
            AND response.kind = 'order_response'
            AND json_valid(response.data)
            AND json_extract(response.data, '$.reservationId') = json_extract(request.data, '$.reservationId')
            AND json_type(response.data, '$.outcome') = 'text'
            AND json_extract(response.data, '$.outcome') IN (
              'accepted', 'accepted_partial_terminal', 'accepted_reconciled',
              'accepted_operator_verified', 'not_sent', 'not_sent_rejected',
              'not_sent_reconciled', 'not_sent_operator_verified'
            )
        )
      ORDER BY request.id DESC
      LIMIT 1
    `).get(reservationId, clientOrderId) as UnresolvedOrderDbRow | undefined;
    return row ? parseUnresolvedOrderRow(row)[0] ?? null : null;
  }

  unresolvedLoanMutations(): { mutationId: string; actionKey: string; riskIncreasing: boolean }[] {
    const authority = this.readDurableMutationAuthority();
    if (authority.readErrorCount > 0) throw new Error('FINANCIAL_MUTATION_AUTHORITY_READ_FAILED');
    if (authority.malformedLoanRowCount > 0) throw new Error('MALFORMED_LOAN_MUTATION_EVIDENCE');
    const rows = this.db.prepare(`
      SELECT request.data
      FROM events AS request
      WHERE request.kind = 'loan_request'
        AND json_valid(request.data)
        AND json_type(request.data, '$.mutationId') = 'text'
        AND NOT EXISTS (
          SELECT 1
          FROM events AS response
          WHERE response.id > request.id
            AND response.kind = 'loan_response'
            AND json_valid(response.data)
            AND json_extract(response.data, '$.mutationId') = json_extract(request.data, '$.mutationId')
            AND json_type(response.data, '$.outcome') = 'text'
            AND json_extract(response.data, '$.outcome') IN (
              'succeeded', 'failed', 'reconciled_by_operator'
            )
      )
      ORDER BY request.id ASC
    `).all() as { data: string | null }[];
    return rows.flatMap((row) => {
      try {
        const data = JSON.parse(row.data ?? '') as Record<string, unknown>;
        return typeof data.mutationId === 'string' && typeof data.actionKey === 'string'
          ? [{ mutationId: data.mutationId, actionKey: data.actionKey, riskIncreasing: data.riskIncreasing === true }]
          : [];
      } catch {
        return [];
      }
    });
  }

  lastEvent(kind: string): LedgerEvent | null {
    const row = this.db
      .prepare('SELECT * FROM events WHERE kind = ? ORDER BY id DESC LIMIT 1')
      .get(kind) as EventDbRow | undefined;
    return row ? parseEvent(row) : null;
  }

  /** Returns true if exact durable truth was inserted or upgraded. */
  insertFill(input: FillInput): boolean {
    const fill = canonicalExactFillInput(input);
    return this.db.transaction(() => {
      const existingRow = this.db.prepare(`
        SELECT symbol, trade_id, order_id, side, price, qty, quote_qty, commission,
               commission_asset, ts, source, money_encoding
        FROM fills
        WHERE symbol = ? AND trade_id = ?
      `).get(fill.symbol, fill.tradeId) as FillDbRow | undefined;
      if (existingRow === undefined) {
        const inserted = this.db.prepare(`
          INSERT INTO fills
            (symbol, trade_id, order_id, side, price, qty, quote_qty, commission,
             commission_asset, ts, source, money_encoding)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EXACT_DECIMAL')
        `).run(
          fill.symbol, fill.tradeId, fill.orderId, fill.side, fill.price, fill.qty,
          fill.quoteQty, fill.commission, fill.commissionAsset, fill.ts, fill.source,
        );
        if (inserted.changes !== 1) throw new Error('FILL_INSERT_FAILED');
        return true;
      }

      const existing = parseFill(existingRow);
      if (!sameFillIdentityMetadata(existing, fill)) throw new Error('FILL_IDENTITY_CONFLICT');
      if (existing.moneyEncoding === 'LEGACY_BINARY64') {
        const upgraded = this.db.prepare(`
          UPDATE fills
          SET price = ?, qty = ?, quote_qty = ?, commission = ?, source = ?,
              money_encoding = 'EXACT_DECIMAL'
          WHERE symbol = ? AND trade_id = ? AND money_encoding = 'LEGACY_BINARY64'
        `).run(
          fill.price, fill.qty, fill.quoteQty, fill.commission, fill.source,
          fill.symbol, fill.tradeId,
        );
        if (upgraded.changes !== 1) throw new Error('FILL_UPGRADE_FAILED');
        const readback = this.db.prepare(`
          SELECT symbol, trade_id, order_id, side, price, qty, quote_qty, commission,
                 commission_asset, ts, source, money_encoding
          FROM fills WHERE symbol = ? AND trade_id = ?
        `).get(fill.symbol, fill.tradeId) as FillDbRow | undefined;
        if (readback === undefined || !sameFillTruth(parseFill(readback), fill)) {
          throw new Error('FILL_UPGRADE_POSTCONDITION_FAILED');
        }
        return true;
      }
      if (sameFillTruth(existing, fill)) return false;
      throw new Error('FILL_IDENTITY_CONFLICT');
    }).immediate();
  }

  listFills(limit = 200, symbol?: string): FillDisplayRow[] {
    const rows = (
      symbol
        ? this.db.prepare(`
            SELECT * FROM fills WHERE symbol = ?
            ORDER BY ts DESC, symbol COLLATE BINARY DESC, trade_id DESC LIMIT ?
          `).all(symbol, limit)
        : this.db.prepare(`
            SELECT * FROM fills
            ORDER BY ts DESC, symbol COLLATE BINARY DESC, trade_id DESC LIMIT ?
          `).all(limit)
    ) as FillDbRow[];
    return rows.map((row) => displayFill(parseFill(row)));
  }

  /**
   * Returns a bounded distinct-symbol set for one explicit time window. The
   * timestamp range is served through idx_fills_ts, so account startup never
   * needs to materialize the lifetime fill ledger merely to discover today's
   * reconciliation scope.
   */
  distinctFillSymbolsBetween(startTs: number, endTs: number, limit = 501): string[] {
    if (
      !Number.isSafeInteger(startTs)
      || !Number.isSafeInteger(endTs)
      || startTs < 0
      || endTs <= startTs
    ) {
      throw new Error('invalid fill-symbol discovery range');
    }
    const safeLimit = boundedInteger(limit, 1, 1_000, 501);
    const rows = this.db.prepare(`
      SELECT DISTINCT symbol
      FROM fills INDEXED BY idx_fills_ts
      WHERE ts >= ? AND ts < ?
      ORDER BY symbol ASC
      LIMIT ?
    `).all(startTs, endTs, safeLimit) as { symbol: string }[];
    return rows.map((row) => row.symbol);
  }

  listSignalsForSymbol(symbol: string, limit = 20): SignalRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM signals WHERE symbol = ? ORDER BY id DESC LIMIT ?')
      .all(symbol, limit) as SignalDbRow[];
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      side: r.side,
      openedTs: r.opened_ts,
      closedTs: r.closed_ts,
      basisOpen: r.basis_open,
      basisPeak: r.basis_peak,
      basisClose: r.basis_close,
      fundingOpen: r.funding_open,
    }));
  }

  allFillsAsc(): FillRow[] {
    const rows = this.db.prepare(`
      SELECT * FROM fills
      ORDER BY ts ASC, symbol COLLATE BINARY ASC, trade_id ASC
    `).all() as FillDbRow[];
    return rows.map(parseFill);
  }

  /**
   * Prunes only recomputable engine telemetry. Financial, operator, security,
   * configuration, order, loan, fill, error, and connection audit events are
   * deliberately absent from this allowlist.
   */
  pruneEphemeralEvents(now = Date.now(), batch = 5_000): number {
    const safeNow = boundedInteger(now, 0, Number.MAX_SAFE_INTEGER, Date.now());
    const safeBatch = boundedInteger(batch, 1, EPHEMERAL_EVENT_BATCH_MAX, 5_000);
    const info = this.db.prepare(`
      DELETE FROM events
      WHERE id IN (
        SELECT id
        FROM events
        WHERE
          (kind IN ('strategy_decision', 'basis.strategy_decision') AND ts < ?)
          OR (kind IN ('heartbeat', 'basis.heartbeat', 'candidate_rejected') AND ts < ?)
          OR (kind = 'candidate_opened' AND ts < ?)
        ORDER BY id ASC
        LIMIT ?
      )
    `).run(
      safeNow - SIX_HOURS_MS,
      safeNow - ONE_DAY_MS,
      safeNow - SEVEN_DAYS_MS,
      safeBatch,
    );
    return info.changes;
  }

  openSignal(s: {
    symbol: string;
    side: string;
    openedTs: number;
    basisOpen: number;
    fundingOpen: number | null;
  }): number {
    const info = this.db
      .prepare(
        `INSERT INTO signals (symbol, side, opened_ts, basis_open, basis_peak, funding_open)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(s.symbol, s.side, s.openedTs, s.basisOpen, s.basisOpen, s.fundingOpen);
    return Number(info.lastInsertRowid);
  }

  updateSignalPeak(id: number, basisPeak: number): void {
    this.db.prepare('UPDATE signals SET basis_peak = ? WHERE id = ?').run(basisPeak, id);
  }

  closeSignal(id: number, closedTs: number, basisClose: number): void {
    this.db
      .prepare('UPDATE signals SET closed_ts = ?, basis_close = ? WHERE id = ?')
      .run(closedTs, basisClose, id);
  }

  listSignals(opts: { limit?: number } = {}): SignalRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM signals ORDER BY id DESC LIMIT ?')
      .all(opts.limit ?? 50) as SignalDbRow[];
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      side: r.side,
      openedTs: r.opened_ts,
      closedTs: r.closed_ts,
      basisOpen: r.basis_open,
      basisPeak: r.basis_peak,
      basisClose: r.basis_close,
      fundingOpen: r.funding_open,
    }));
  }

  recordBrowserSessionActivity(session: BrowserSessionRecord): void {
    const now = Date.now();
    const lastSeen = boundedInteger(session.lastSeen, 0, now + 5 * 60_000, now);
    const firstSeen = Math.min(lastSeen, boundedInteger(session.firstSeen, 0, lastSeen, lastSeen));
    const id = boundedText(session.id, 128);
    if (!id || (!id.startsWith('d_') && !id.startsWith('f_'))) return;
    const upsert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO browser_sessions
         (id, ip, country, system, browser, device, model, first_seen, last_seen, requests)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           ip = excluded.ip,
           country = COALESCE(excluded.country, browser_sessions.country),
           system = excluded.system,
           browser = excluded.browser,
           device = COALESCE(excluded.device, browser_sessions.device),
           model = COALESCE(excluded.model, browser_sessions.model),
           first_seen = MIN(browser_sessions.first_seen, excluded.first_seen),
           last_seen = MAX(browser_sessions.last_seen, excluded.last_seen),
           requests = MIN(2147483647, browser_sessions.requests + excluded.requests)`
        )
        .run(
          id,
          boundedText(session.ip, 96) || 'unknown',
          nullableBoundedText(session.country, 96),
          boundedText(session.system, 160) || 'Unknown',
          boundedText(session.browser, 160) || 'Unknown',
          nullableBoundedText(session.device, 80),
          nullableBoundedText(session.model, 120),
          firstSeen,
          lastSeen,
          boundedInteger(session.requests, 0, 1_000_000, 0),
        );
      this.trimBrowserSessions(now);
    });
    upsert();
  }

  listBrowserSessions(since: number, limit = 100): BrowserSessionRecord[] {
    const safeSince = boundedInteger(since, 0, Number.MAX_SAFE_INTEGER, 0);
    const safeLimit = boundedInteger(limit, 1, 200, 100);
    const rows = this.db
      .prepare('SELECT * FROM browser_sessions WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT ?')
      .all(safeSince, safeLimit) as BrowserSessionDbRow[];
    return rows.map((row) => ({
      id: row.id,
      ip: row.ip,
      country: row.country,
      system: row.system,
      browser: row.browser,
      device: row.device,
      model: row.model,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      requests: row.requests,
    }));
  }

  pruneBrowserSessions(before: number): void {
    const safeBefore = boundedInteger(before, 0, Number.MAX_SAFE_INTEGER, Date.now() - BROWSER_SESSION_RETENTION_MS);
    this.db.prepare('DELETE FROM browser_sessions WHERE last_seen < ?').run(safeBefore);
    this.trimBrowserSessions(Date.now());
  }

  private trimBrowserSessions(now: number): void {
    this.db.prepare('DELETE FROM browser_sessions WHERE last_seen < ?').run(now - BROWSER_SESSION_RETENTION_MS);
    this.db.prepare(
      `DELETE FROM browser_sessions
       WHERE id IN (
         SELECT id FROM browser_sessions
         ORDER BY last_seen DESC, id ASC
         LIMIT -1 OFFSET ?
       )`,
    ).run(BROWSER_SESSION_MAX);
  }

  /**
   * Keeps the newest fixed material-event window. Callers invoke this before
   * their surrounding transaction commits, so cursor insertion and retention
   * advance are one atomic state change. Deleting projection rows never
   * deletes the underlying immutable audit events or lowers sqlite_sequence.
   */
  private trimProductOperatorEvents(): void {
    this.db.prepare(`
      DELETE FROM product_operator_events
      WHERE cursor <= COALESCE((
        SELECT cursor
        FROM product_operator_events
        ORDER BY cursor DESC
        LIMIT 1 OFFSET ?
      ), 0)
    `).run(PRODUCT_OPERATOR_EVENT_RETENTION_MAX);
  }

  private appendProductPersistenceAudit(
    prepared: Readonly<PreparedProductPersistenceAudit>,
  ): LedgerEvent {
    const ts = Date.now();
    const metadata = prepareLedgerEventMetadata({});
    const info = this.db
      .prepare(LEDGER_EVENT_INSERT_SQL)
      .run(...eventInsertValues(ts, prepared.kind, prepared.symbol, prepared.serialized, metadata));
    const id = Number(info.lastInsertRowid);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new RangeError('product persistence ledger event identity is invalid');
    }
    return ledgerEventFromAppend(
      id,
      ts,
      prepared.kind,
      prepared.symbol,
      JSON.parse(prepared.serialized) as SystemJsonValue,
      metadata,
    );
  }

  private readProductPersistenceAudit(
    ledgerEventId: number,
    expected?: Readonly<PreparedProductPersistenceAudit>,
  ): LedgerEvent {
    if (!Number.isSafeInteger(ledgerEventId) || ledgerEventId < 1) {
      throw new TypeError('product persistence ledger event identity is invalid');
    }
    const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(ledgerEventId) as EventDbRow | undefined;
    if (!row) throw new Error('product persistence ledger event is missing');
    if (expected && (row.kind !== expected.kind
      || row.symbol !== expected.symbol
      || row.data !== expected.serialized)) {
      throw new Error('product persistence ledger event does not match its durable owner projection');
    }
    return parseEvent(row);
  }

  private publishProductPersistenceResult(
    result: ProductPersistenceMutationResult,
  ): ProductPersistenceMutationResult {
    if (result.disposition !== 'COMMITTED_NEW') return result;
    try {
      const event = this.readProductPersistenceAudit(result.ledgerEvent.id);
      this.emit('event', {
        ...event,
        data: JSON.parse(JSON.stringify(event.data)) as unknown,
      } satisfies LedgerEvent);
    } catch {
      // The SQLite transaction is already authoritative. Listener failure or
      // application shutdown cannot turn a committed owner projection into an
      // apparent retryable write failure.
    }
    return result;
  }

  getConfigValue(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setConfigValue(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value);
  }

  /**
   * Commits a configuration value and its audit record in one SQLite
   * transaction. The EventEmitter notification is sent only after commit, so
   * in-memory consumers can never observe an audit event for a rolled-back
   * configuration write.
   */
  setConfigValueAndLogEvent(
    key: string,
    value: string,
    kind: string,
    symbol: string | null = null,
    data: unknown = null,
    metadataInput: Readonly<LedgerEventMetadataInput> = {},
  ): LedgerEvent {
    const ts = Date.now();
    const metadata = prepareLedgerEventMetadata(metadataInput);
    let serialized: string | null = null;
    if (data !== undefined) {
      const encoded = JSON.stringify(data);
      if (typeof encoded !== 'string') throw new TypeError('ledger event data must be JSON serializable');
      serialized = encoded;
    }
    const durableData = serialized === null ? null : JSON.parse(serialized) as unknown;
    const productOperatorEvent = prepareProductOperatorEvent(kind, durableData, ts);
    const commit = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, value);
      const info = this.db
        .prepare(LEDGER_EVENT_INSERT_SQL)
        .run(...eventInsertValues(ts, kind, symbol, serialized, metadata));
      const ledgerEventId = Number(info.lastInsertRowid);
      if (!Number.isSafeInteger(ledgerEventId) || ledgerEventId < 1) {
        throw new RangeError('ledger event identity exceeds the supported integer range');
      }
      if (productOperatorEvent) {
        this.db.prepare(`
          INSERT INTO product_operator_events (
            ledger_event_id,
            event_id,
            component_id,
            correlation_id,
            occurred_at_ms,
            persisted_at_ms,
            material_projection_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          ledgerEventId,
          productOperatorEvent.eventId,
          productOperatorEvent.componentId,
          productOperatorEvent.correlationId,
          productOperatorEvent.occurredAtMs,
          productOperatorEvent.persistedAtMs,
          productOperatorEvent.serializedProjection,
        );
        this.trimProductOperatorEvents();
      }
      return ledgerEventId;
    });
    const ledgerEventId = commit.immediate();
    const event = ledgerEventFromAppend(
      ledgerEventId,
      ts,
      kind,
      symbol,
      durableData,
      metadata,
    );
    try {
      this.emit('event', event);
      return event;
    } catch {
      // The SQLite transaction is already committed. Verify the coupled
      // config/ledger/operator write when possible and never turn a listener
      // exception into a false write failure that invites a duplicate append.
      try {
        const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(ledgerEventId) as EventDbRow | undefined;
        const operatorRow = this.db.prepare(`
          SELECT material_projection_json
          FROM product_operator_events
          WHERE ledger_event_id = ?
        `).get(ledgerEventId) as { material_projection_json: string } | undefined;
        const exactOperator = productOperatorEvent
          ? operatorRow?.material_projection_json === productOperatorEvent.serializedProjection
          : operatorRow === undefined;
        if (this.getConfigValue(key) === value
          && row?.id === ledgerEventId
          && row.ts === ts
          && row.kind === kind
          && row.symbol === symbol
          && row.data === serialized
          && row.severity === metadata.severity
          && row.source === metadata.source
          && row.strategy === metadata.strategy
          && row.status === metadata.status
          && row.reason === metadata.reason
          && row.message === metadata.message
          && row.correlation === metadata.correlation
          && row.created_at === (metadata.createdAt ?? ts)
          && exactOperator) {
          return parseEvent(row);
        }
      } catch {
        // A listener may close its surrounding application. The pristine
        // transaction result below remains authoritative in that case.
      }
      return ledgerEventFromAppend(
        ledgerEventId,
        ts,
        kind,
        symbol,
        serialized === null ? null : JSON.parse(serialized) as unknown,
        metadata,
      );
    }
  }

  /**
   * Persists owner-supplied desired state with an exact per-component revision
   * CAS. This primitive records state; it does not start, stop, or pause a
   * component and therefore owns no lifecycle behavior.
   */
  compareAndSetProductComponentDesiredState(
    input: Readonly<ProductDesiredStatePersistenceInput>,
  ): ProductPersistenceMutationResult {
    if (!plainLedgerRecord(input)) throw new TypeError('product desired-state input is invalid');
    assertProductIdentifier(input.componentId, 'product desired-state componentId');
    if (!['STOPPED', 'RUNNING', 'PAUSED'].includes(input.desiredState)) {
      throw new TypeError('product desired-state desiredState is invalid');
    }
    if (input.expectedStateRevision !== null) {
      assertProductNonNegativeInteger(input.expectedStateRevision, 'product desired-state expectedStateRevision');
    }
    assertProductNonNegativeInteger(input.stateRevision, 'product desired-state stateRevision');
    const requiredRevision = input.expectedStateRevision === null ? 0 : input.expectedStateRevision + 1;
    if (!Number.isSafeInteger(requiredRevision) || input.stateRevision !== requiredRevision) {
      throw new TypeError('product desired-state revision must advance exactly once');
    }
    assertProductNonNegativeInteger(input.restartGeneration, 'product desired-state restartGeneration');
    assertProductUtcMillis(input.updatedAtMs, 'product desired-state updatedAtMs');
    assertProductIdentifier(input.correlationId, 'product desired-state correlationId');
    const audit = prepareProductPersistenceAudit(input.audit);

    const commit = this.db.transaction((): ProductPersistenceMutationResult => {
      const current = this.db.prepare(`
        SELECT state_revision FROM product_component_desired_state WHERE component_id = ?
      `).get(input.componentId) as { state_revision: number } | undefined;
      const currentRevision = current?.state_revision ?? null;
      if (currentRevision !== input.expectedStateRevision) {
        return frozenProductPersistenceResult(
          'VERSION_CONFLICT',
          null,
          currentRevision === null ? null : String(currentRevision),
        );
      }
      const event = this.appendProductPersistenceAudit(audit);
      this.db.prepare(`
        INSERT INTO product_component_desired_state (
          component_id, desired_state, state_revision, restart_generation,
          updated_at_ms, correlation_id, ledger_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(component_id) DO UPDATE SET
          desired_state = excluded.desired_state,
          state_revision = excluded.state_revision,
          restart_generation = excluded.restart_generation,
          updated_at_ms = excluded.updated_at_ms,
          correlation_id = excluded.correlation_id,
          ledger_event_id = excluded.ledger_event_id
      `).run(
        input.componentId,
        input.desiredState,
        input.stateRevision,
        input.restartGeneration,
        input.updatedAtMs,
        input.correlationId,
        event.id,
      );
      return frozenProductPersistenceResult('COMMITTED_NEW', event, String(input.stateRevision));
    });
    return this.publishProductPersistenceResult(commit.immediate());
  }

  /**
   * Appends a generic command projection only after exact idempotency and
   * target desired-state revision checks. It deliberately does not apply the
   * command, choose a status, or advance desired state.
   */
  compareAndAppendProductCommand(
    input: Readonly<ProductCommandPersistenceInput>,
  ): ProductPersistenceMutationResult {
    if (!plainLedgerRecord(input)) throw new TypeError('product command persistence input is invalid');
    assertProductIdentifier(input.commandId, 'product commandId');
    if (typeof input.idempotencyKey !== 'string' || !PRODUCT_IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
      throw new TypeError('product command idempotencyKey is invalid');
    }
    if (typeof input.requestDigest !== 'string' || !PRODUCT_DIGEST.test(input.requestDigest)
      || typeof input.previewDigest !== 'string' || !PRODUCT_DIGEST.test(input.previewDigest)) {
      throw new TypeError('product command digest is invalid');
    }
    assertProductDomainState(input.commandType, 'product commandType');
    assertProductIdentifier(input.targetComponentId, 'product targetComponentId');
    assertProductIdentifier(input.authenticatedOperatorId, 'product authenticatedOperatorId');
    assertProductReason(input.reason);
    assertProductDomainState(input.requiredAuthority, 'product requiredAuthority');
    assertProductNonNegativeInteger(input.expectedRevision, 'product expectedRevision');
    if (input.resultingRevision !== null) {
      assertProductNonNegativeInteger(input.resultingRevision, 'product resultingRevision');
    }
    assertProductDomainState(input.status, 'product command status');
    assertProductUtcMillis(input.createdAtMs, 'product command createdAtMs');
    assertProductUtcMillis(input.expiresAtMs, 'product command expiresAtMs');
    if (input.expiresAtMs <= input.createdAtMs) throw new TypeError('product command must expire after creation');
    if (input.completedAtMs !== null) {
      assertProductUtcMillis(input.completedAtMs, 'product command completedAtMs');
      if (input.completedAtMs < input.createdAtMs) throw new TypeError('product command completion precedes creation');
    }
    assertProductIdentifier(input.correlationId, 'product command correlationId');
    const requestPayloadJson = canonicalProductPersistenceJson(input.requestPayload, 'product command request payload');
    const previewJson = canonicalProductPersistenceJson(input.preview, 'product command preview');
    const beforeProjectionJson = canonicalNullableProductPersistenceJson(input.beforeProjection, 'product command before projection');
    const afterProjectionJson = canonicalNullableProductPersistenceJson(input.afterProjection, 'product command after projection');
    const resultJson = canonicalNullableProductPersistenceJson(input.result, 'product command result');
    const audit = prepareProductPersistenceAudit(input.audit);

    const commit = this.db.transaction((): ProductPersistenceMutationResult => {
      const existing = this.db.prepare(`
        SELECT * FROM product_commands
        WHERE idempotency_key = ? OR command_id = ?
        ORDER BY CASE WHEN idempotency_key = ? THEN 0 ELSE 1 END
        LIMIT 1
      `).get(input.idempotencyKey, input.commandId, input.idempotencyKey) as ProductCommandDbRow | undefined;
      if (existing) {
        if (exactProductCommandRow(
          existing,
          input,
          requestPayloadJson,
          previewJson,
          beforeProjectionJson,
          afterProjectionJson,
          resultJson,
        )) {
          return frozenProductPersistenceResult(
            'IDEMPOTENT_REPLAY',
            this.readProductPersistenceAudit(existing.ledger_event_id as number, audit),
            String(existing.expected_revision),
          );
        }
        return frozenProductPersistenceResult(
          'IDEMPOTENCY_CONFLICT',
          null,
          Number.isSafeInteger(existing.expected_revision) ? String(existing.expected_revision) : null,
        );
      }

      const desired = this.db.prepare(`
        SELECT state_revision FROM product_component_desired_state WHERE component_id = ?
      `).get(input.targetComponentId) as { state_revision: number } | undefined;
      const currentRevision = desired?.state_revision ?? null;
      if (currentRevision !== input.expectedRevision) {
        return frozenProductPersistenceResult(
          'VERSION_CONFLICT',
          null,
          currentRevision === null ? null : String(currentRevision),
        );
      }

      const event = this.appendProductPersistenceAudit(audit);
      this.db.prepare(`
        INSERT INTO product_commands (
          command_id, idempotency_key, request_digest, command_type,
          target_component_id, authenticated_operator_id, reason,
          required_authority, request_payload_json, preview_digest,
          preview_json, expected_revision, resulting_revision, status,
          created_at_ms, expires_at_ms, completed_at_ms, correlation_id,
          before_projection_json, after_projection_json, result_json,
          ledger_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.commandId,
        input.idempotencyKey,
        input.requestDigest,
        input.commandType,
        input.targetComponentId,
        input.authenticatedOperatorId,
        input.reason,
        input.requiredAuthority,
        requestPayloadJson,
        input.previewDigest,
        previewJson,
        input.expectedRevision,
        input.resultingRevision,
        input.status,
        input.createdAtMs,
        input.expiresAtMs,
        input.completedAtMs,
        input.correlationId,
        beforeProjectionJson,
        afterProjectionJson,
        resultJson,
        event.id,
      );
      return frozenProductPersistenceResult('COMMITTED_NEW', event, String(input.expectedRevision));
    });
    return this.publishProductPersistenceResult(commit.immediate());
  }

  /** Stores an immutable, owner-supplied configuration revision and audit. */
  recordProductConfigRevision(
    input: Readonly<ProductConfigRevisionPersistenceInput>,
  ): ProductPersistenceMutationResult {
    if (!plainLedgerRecord(input)) throw new TypeError('product config revision input is invalid');
    assertProductIdentifier(input.configRevision, 'product configRevision');
    if (typeof input.contentDigest !== 'string' || !PRODUCT_DIGEST.test(input.contentDigest)) {
      throw new TypeError('product config contentDigest is invalid');
    }
    assertProductDomainState(input.status, 'product config status');
    if (input.effectiveAtMs !== null) assertProductUtcMillis(input.effectiveAtMs, 'product config effectiveAtMs');
    assertProductUtcMillis(input.createdAtMs, 'product config createdAtMs');
    assertProductIdentifier(input.createdByOperatorId, 'product config createdByOperatorId');
    assertProductIdentifier(input.correlationId, 'product config correlationId');
    const configJson = canonicalProductPersistenceJson(input.config, 'product config projection');
    const audit = prepareProductPersistenceAudit(input.audit);

    const commit = this.db.transaction((): ProductPersistenceMutationResult => {
      const existing = this.db.prepare(`
        SELECT * FROM product_config_revisions
        WHERE config_revision = ? OR content_digest = ?
        LIMIT 1
      `).get(input.configRevision, input.contentDigest) as {
        config_revision: string;
        content_digest: string;
        status: string;
        effective_at_ms: number | null;
        created_at_ms: number;
        created_by_operator_id: string;
        correlation_id: string;
        config_json: string;
        ledger_event_id: number;
      } | undefined;
      if (existing) {
        const exact = existing.config_revision === input.configRevision
          && existing.content_digest === input.contentDigest
          && existing.status === input.status
          && existing.effective_at_ms === input.effectiveAtMs
          && existing.created_at_ms === input.createdAtMs
          && existing.created_by_operator_id === input.createdByOperatorId
          && existing.correlation_id === input.correlationId
          && existing.config_json === configJson
          && Number.isSafeInteger(existing.ledger_event_id)
          && existing.ledger_event_id > 0;
        if (exact) {
          return frozenProductPersistenceResult(
            'IDEMPOTENT_REPLAY',
            this.readProductPersistenceAudit(existing.ledger_event_id, audit),
            existing.config_revision,
          );
        }
        return frozenProductPersistenceResult('IDEMPOTENCY_CONFLICT', null, existing.config_revision);
      }
      const event = this.appendProductPersistenceAudit(audit);
      this.db.prepare(`
        INSERT INTO product_config_revisions (
          config_revision, content_digest, status, effective_at_ms,
          created_at_ms, created_by_operator_id, correlation_id,
          config_json, ledger_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.configRevision,
        input.contentDigest,
        input.status,
        input.effectiveAtMs,
        input.createdAtMs,
        input.createdByOperatorId,
        input.correlationId,
        configJson,
        event.id,
      );
      return frozenProductPersistenceResult('COMMITTED_NEW', event, input.configRevision);
    });
    return this.publishProductPersistenceResult(commit.immediate());
  }

  /**
   * CAS-upserts one opaque owner revision in the durable identity graph. The
   * caller supplies both current and next resolution states; Ledger preserves
   * them without deciding whether an opportunity, position, or recovery is
   * terminal.
   */
  compareAndUpsertProductIdentityReference(
    input: Readonly<ProductIdentityReferencePersistenceInput>,
  ): ProductPersistenceMutationResult {
    if (!plainLedgerRecord(input)) throw new TypeError('product identity reference input is invalid');
    if (!(PRODUCT_IDENTITY_REFERENCE_TYPES as readonly string[]).includes(input.referenceType)) {
      throw new TypeError('product identity referenceType is invalid');
    }
    assertProductIdentifier(input.referenceId, 'product identity referenceId');
    assertProductIdentifier(input.ownerId, 'product identity ownerId');
    assertProductIdentifier(input.ownerRevision, 'product identity ownerRevision');
    if (input.expectedResolutionState !== null
      && !(PRODUCT_IDENTITY_RESOLUTION_STATES as readonly string[]).includes(input.expectedResolutionState)) {
      throw new TypeError('product identity expectedResolutionState is invalid');
    }
    assertProductDomainState(input.ownerState, 'product identity ownerState');
    if (!(PRODUCT_IDENTITY_RESOLUTION_STATES as readonly string[]).includes(input.resolutionState)) {
      throw new TypeError('product identity resolutionState is invalid');
    }
    assertProductIdentifier(input.correlationId, 'product identity correlationId');
    const hasParentType = input.parentReferenceType !== null;
    const hasParentId = input.parentReferenceId !== null;
    if (hasParentType !== hasParentId
      || (input.parentReferenceType !== null
        && !(PRODUCT_IDENTITY_REFERENCE_TYPES as readonly string[]).includes(input.parentReferenceType))) {
      throw new TypeError('product identity parent reference is invalid');
    }
    assertProductOptionalIdentifier(input.parentReferenceId, 'product identity parentReferenceId');
    assertProductOptionalDigest(input.payloadHash, 'product identity payloadHash');
    assertProductUtcMillis(input.occurredAtMs, 'product identity occurredAtMs');
    if (input.validUntilMs !== null) {
      assertProductUtcMillis(input.validUntilMs, 'product identity validUntilMs');
      if (input.validUntilMs < input.occurredAtMs) throw new TypeError('product identity validity precedes occurrence');
    }
    const ownerProjectionJson = canonicalProductPersistenceJson(input.ownerProjection, 'product owner projection');
    const audit = prepareProductPersistenceAudit(input.audit);

    const commit = this.db.transaction((): ProductPersistenceMutationResult => {
      const existing = this.db.prepare(`
        SELECT * FROM product_identity_references
        WHERE reference_type = ? AND reference_id = ? AND owner_revision = ?
      `).get(input.referenceType, input.referenceId, input.ownerRevision) as ProductIdentityReferenceDbRow | undefined;
      if (existing && exactProductIdentityReferenceRow(existing, input, ownerProjectionJson)) {
        return frozenProductPersistenceResult(
          'IDEMPOTENT_REPLAY',
          this.readProductPersistenceAudit(existing.ledger_event_id, audit),
          existing.resolution_state,
        );
      }
      const currentResolution = existing?.resolution_state ?? null;
      if (currentResolution !== input.expectedResolutionState) {
        return frozenProductPersistenceResult('VERSION_CONFLICT', null, currentResolution);
      }
      if (existing && input.occurredAtMs < existing.occurred_at_ms) {
        throw new TypeError('product identity transition cannot move occurrence time backwards');
      }
      const event = this.appendProductPersistenceAudit(audit);
      this.db.prepare(`
        INSERT INTO product_identity_references (
          reference_type, reference_id, owner_id, owner_revision, owner_state,
          resolution_state, correlation_id, parent_reference_type,
          parent_reference_id, payload_hash, owner_projection_json,
          occurred_at_ms, valid_until_ms, ledger_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(reference_type, reference_id, owner_revision) DO UPDATE SET
          owner_id = excluded.owner_id,
          owner_state = excluded.owner_state,
          resolution_state = excluded.resolution_state,
          correlation_id = excluded.correlation_id,
          parent_reference_type = excluded.parent_reference_type,
          parent_reference_id = excluded.parent_reference_id,
          payload_hash = excluded.payload_hash,
          owner_projection_json = excluded.owner_projection_json,
          occurred_at_ms = excluded.occurred_at_ms,
          valid_until_ms = excluded.valid_until_ms,
          ledger_event_id = excluded.ledger_event_id
      `).run(
        input.referenceType,
        input.referenceId,
        input.ownerId,
        input.ownerRevision,
        input.ownerState,
        input.resolutionState,
        input.correlationId,
        input.parentReferenceType,
        input.parentReferenceId,
        input.payloadHash,
        ownerProjectionJson,
        input.occurredAtMs,
        input.validUntilMs,
        event.id,
      );
      return frozenProductPersistenceResult('COMMITTED_NEW', event, input.resolutionState);
    });
    return this.publishProductPersistenceResult(commit.immediate());
  }

  /**
   * Reads only unresolved restart-blocking owner references. Any malformed
   * durable row throws so the System Integration adapter can fail closed.
   */
  readProductBlockingIdentityReferences(
    limit = 1_000,
  ): readonly Readonly<ProductIdentityReferenceRecord>[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PRODUCT_PERSISTENCE_QUERY_MAX) {
      throw new RangeError(`product identity reference limit must be 1-${PRODUCT_PERSISTENCE_QUERY_MAX}`);
    }
    const placeholders = PRODUCT_BLOCKING_REFERENCE_TYPES.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT * FROM product_identity_references
      WHERE reference_type IN (${placeholders})
        AND resolution_state != 'TERMINAL_PROVEN'
      ORDER BY occurred_at_ms ASC, reference_type ASC, reference_id ASC, owner_revision ASC
      LIMIT ?
    `).all(...PRODUCT_BLOCKING_REFERENCE_TYPES, limit) as ProductIdentityReferenceDbRow[];
    return Object.freeze(rows.map((row) => {
      if (!(PRODUCT_IDENTITY_REFERENCE_TYPES as readonly string[]).includes(row.reference_type)
        || !(PRODUCT_IDENTITY_RESOLUTION_STATES as readonly string[]).includes(row.resolution_state)
        || !PRODUCT_BLOCKING_REFERENCE_TYPES.includes(row.reference_type as typeof PRODUCT_BLOCKING_REFERENCE_TYPES[number])) {
        throw new Error('durable product identity reference has invalid vocabulary');
      }
      assertProductIdentifier(row.reference_id, 'durable product identity referenceId');
      assertProductIdentifier(row.owner_id, 'durable product identity ownerId');
      assertProductIdentifier(row.owner_revision, 'durable product identity ownerRevision');
      assertProductDomainState(row.owner_state, 'durable product identity ownerState');
      assertProductIdentifier(row.correlation_id, 'durable product identity correlationId');
      const parentTypeValid = row.parent_reference_type === null
        || (PRODUCT_IDENTITY_REFERENCE_TYPES as readonly string[]).includes(row.parent_reference_type);
      if (!parentTypeValid || (row.parent_reference_type === null) !== (row.parent_reference_id === null)) {
        throw new Error('durable product identity parent reference is invalid');
      }
      assertProductOptionalIdentifier(row.parent_reference_id, 'durable product identity parentReferenceId');
      assertProductOptionalDigest(row.payload_hash, 'durable product identity payloadHash');
      assertProductUtcMillis(row.occurred_at_ms, 'durable product identity occurredAtMs');
      if (row.valid_until_ms !== null) {
        assertProductUtcMillis(row.valid_until_ms, 'durable product identity validUntilMs');
        if (row.valid_until_ms < row.occurred_at_ms) throw new Error('durable product identity validity is invalid');
      }
      assertProductPositiveInteger(row.ledger_event_id, 'durable product identity ledgerEventId');
      this.readProductPersistenceAudit(row.ledger_event_id);
      const parsed = JSON.parse(row.owner_projection_json) as SystemJsonValue;
      if (canonicalProductPersistenceJson(parsed, 'durable product owner projection') !== row.owner_projection_json) {
        throw new Error('durable product owner projection is not canonical');
      }
      return Object.freeze({
        referenceType: row.reference_type as ProductIdentityReferenceRecord['referenceType'],
        referenceId: row.reference_id,
        ownerId: row.owner_id,
        ownerRevision: row.owner_revision,
        ownerState: row.owner_state,
        resolutionState: row.resolution_state as ProductIdentityReferenceRecord['resolutionState'],
        correlationId: row.correlation_id,
        parentReferenceType: row.parent_reference_type as ProductIdentityReferenceRecord['parentReferenceType'],
        parentReferenceId: row.parent_reference_id,
        payloadHash: row.payload_hash,
        ownerProjection: parsed,
        occurredAtMs: row.occurred_at_ms,
        validUntilMs: row.valid_until_ms,
        ledgerEventId: row.ledger_event_id,
      });
    }));
  }

  /**
   * Persists an incident projection with an exact sole-Ledger event revision
   * CAS. `eventCount` is incident evidence, never a version token. Grouping,
   * severity, acknowledgement, and resolution remain supplied owner truth.
   */
  compareAndTransitionProductIncident(
    input: Readonly<ProductIncidentPersistenceInput>,
  ): ProductPersistenceMutationResult {
    if (!plainLedgerRecord(input)) throw new TypeError('product incident input is invalid');
    assertProductIdentifier(input.incidentId, 'product incidentId');
    assertProductIdentifier(input.fingerprint, 'product incident fingerprint');
    assertProductIdentifier(input.rootComponentId, 'product incident rootComponentId');
    assertProductIncidentSeverity(input.severity, 'product incident severity');
    if (typeof input.capitalRelevant !== 'boolean') throw new TypeError('product incident capitalRelevant is invalid');
    if (input.expectedLedgerEventId !== null) {
      assertProductPositiveInteger(input.expectedLedgerEventId, 'product incident expectedLedgerEventId');
    }
    assertProductIncidentState(input.state, 'product incident state');
    assertProductUtcMillis(input.firstSeenAtMs, 'product incident firstSeenAtMs');
    assertProductUtcMillis(input.lastSeenAtMs, 'product incident lastSeenAtMs');
    if (input.lastSeenAtMs < input.firstSeenAtMs) throw new TypeError('product incident lastSeenAtMs precedes firstSeenAtMs');
    assertProductPositiveInteger(input.eventCount, 'product incident eventCount');
    if ((input.acknowledgedAtMs === null) !== (input.acknowledgedByOperatorId === null)) {
      throw new TypeError('product incident acknowledgement fields must be paired');
    }
    if (input.acknowledgedAtMs !== null) {
      assertProductUtcMillis(input.acknowledgedAtMs, 'product incident acknowledgedAtMs');
      if (input.acknowledgedAtMs < input.firstSeenAtMs) throw new TypeError('product incident acknowledgement precedes first sighting');
    }
    assertProductOptionalIdentifier(input.acknowledgedByOperatorId, 'product incident acknowledgedByOperatorId');
    if (input.resolvedAtMs !== null) {
      assertProductUtcMillis(input.resolvedAtMs, 'product incident resolvedAtMs');
      if (input.resolvedAtMs < input.firstSeenAtMs) throw new TypeError('product incident resolution precedes first sighting');
    }
    if (!validProductIncidentLifecycle(
      input.state,
      input.lastSeenAtMs,
      input.acknowledgedAtMs,
      input.acknowledgedByOperatorId,
      input.resolvedAtMs,
    )) {
      throw new TypeError('product incident state fields are inconsistent');
    }
    assertProductIdentifier(input.correlationId, 'product incident correlationId');
    const audit = prepareProductPersistenceAudit(input.audit);

    const commit = this.db.transaction((): ProductPersistenceMutationResult => {
      const existing = this.db.prepare(`
        SELECT * FROM product_incidents
        WHERE incident_id = ? OR fingerprint = ?
        ORDER BY CASE WHEN incident_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `).get(input.incidentId, input.fingerprint, input.incidentId) as ProductIncidentDbRow | undefined;
      if (existing) {
        productIncidentRecord(existing, this.readProductPersistenceAudit(existing.ledger_event_id));
      }
      if (existing && exactProductIncidentRow(existing, input)) {
        return frozenProductPersistenceResult(
          'IDEMPOTENT_REPLAY',
          this.readProductPersistenceAudit(existing.ledger_event_id, audit),
          String(existing.event_count),
        );
      }
      if (existing && (existing.incident_id !== input.incidentId || existing.fingerprint !== input.fingerprint)) {
        return frozenProductPersistenceResult('IDEMPOTENCY_CONFLICT', null, String(existing.event_count));
      }
      const currentRevision = existing?.ledger_event_id ?? null;
      if (currentRevision !== input.expectedLedgerEventId) {
        return frozenProductPersistenceResult(
          'VERSION_CONFLICT',
          null,
          currentRevision === null ? null : String(currentRevision),
        );
      }
      if (!existing && input.eventCount !== 1) {
        throw new TypeError('new product incident eventCount must equal one');
      }
      if (!existing && input.state !== 'OPEN') {
        throw new TypeError('new product incident must begin OPEN');
      }
      if (existing && input.eventCount !== existing.event_count
        && input.eventCount !== existing.event_count + 1) {
        throw new TypeError('product incident eventCount may stay fixed or advance exactly once');
      }
      if (existing && (existing.first_seen_at_ms !== input.firstSeenAtMs
        || input.lastSeenAtMs < existing.last_seen_at_ms)) {
        throw new TypeError('product incident transition cannot rewrite first sighting or move last sighting backwards');
      }
      if (existing && (existing.root_component_id !== input.rootComponentId
        || existing.correlation_id !== input.correlationId)) {
        throw new TypeError('product incident transition cannot rewrite owner identity');
      }
      if (existing && !validProductIncidentTransition(existing, input)) {
        throw new TypeError('product incident lifecycle transition is invalid');
      }
      const event = this.appendProductPersistenceAudit(audit);
      this.db.prepare(`
        INSERT INTO product_incidents (
          incident_id, fingerprint, root_component_id, severity,
          capital_relevant, state, first_seen_at_ms, last_seen_at_ms,
          event_count, acknowledged_at_ms, acknowledged_by_operator_id,
          resolved_at_ms, correlation_id, ledger_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(incident_id) DO UPDATE SET
          fingerprint = excluded.fingerprint,
          root_component_id = excluded.root_component_id,
          severity = excluded.severity,
          capital_relevant = excluded.capital_relevant,
          state = excluded.state,
          first_seen_at_ms = excluded.first_seen_at_ms,
          last_seen_at_ms = excluded.last_seen_at_ms,
          event_count = excluded.event_count,
          acknowledged_at_ms = excluded.acknowledged_at_ms,
          acknowledged_by_operator_id = excluded.acknowledged_by_operator_id,
          resolved_at_ms = excluded.resolved_at_ms,
          correlation_id = excluded.correlation_id,
          ledger_event_id = excluded.ledger_event_id
      `).run(
        input.incidentId,
        input.fingerprint,
        input.rootComponentId,
        input.severity,
        input.capitalRelevant ? 1 : 0,
        input.state,
        input.firstSeenAtMs,
        input.lastSeenAtMs,
        input.eventCount,
        input.acknowledgedAtMs,
        input.acknowledgedByOperatorId,
        input.resolvedAtMs,
        input.correlationId,
        event.id,
      );
      if (plainLedgerRecord(audit.data)
        && audit.data.schema === PRODUCT_INCIDENT_ROUTE_SCHEMA
        && Number.isSafeInteger(audit.data.sourceEventId)) {
        this.advanceProductIncidentRouterCheckpointInTransaction(
          Number(audit.data.sourceEventId),
          event.id,
        );
      }
      return frozenProductPersistenceResult('COMMITTED_NEW', event, String(event.id));
    });
    return this.publishProductPersistenceResult(commit.immediate());
  }

  /** Appends one immutable disposition for an admitted source that creates no incident mutation. */
  recordProductIncidentSourceDisposition(
    input: Readonly<ProductPersistenceAuditRecord>,
  ): ProductPersistenceMutationResult {
    const audit = prepareProductPersistenceAudit(input);
    const data = audit.data;
    if (audit.kind !== 'product.incident.source_ignored'
      || audit.symbol !== null
      || !plainLedgerRecord(data)
      || Object.keys(data).length !== PRODUCT_INCIDENT_SOURCE_DISPOSITION_KEYS.length
      || !PRODUCT_INCIDENT_SOURCE_DISPOSITION_KEYS.every((key) => Object.hasOwn(data, key))
      || data.schema !== PRODUCT_INCIDENT_SOURCE_DISPOSITION_SCHEMA
      || (data.operation !== 'IGNORE_NO_ACTIVE' && data.operation !== 'IGNORE_LATE')
      || !Number.isSafeInteger(data.sourceEventId) || Number(data.sourceEventId) < 1
      || (data.sourceEventKind !== 'connection_alert' && data.sourceEventKind !== 'connection_recovered')
      || typeof data.sourceGroup !== 'string' || !PRODUCT_IDENTIFIER.test(data.sourceGroup)
      || (data.sourceStatus !== 'degraded' && data.sourceStatus !== 'outage' && data.sourceStatus !== 'operational')
      || typeof data.sourceDetail !== 'string' || data.sourceDetail.length > 2_000
      || !validProductUtcMillis(data.sourceObservedAtMs)
      || typeof data.rootComponentId !== 'string' || !PRODUCT_IDENTIFIER.test(data.rootComponentId)
      || typeof data.groupingDigest !== 'string' || !/^[a-f0-9]{64}$/.test(data.groupingDigest)
      || data.incidentId !== null
      || !((data.priorDispositionEventId === null
        && data.priorSourceEventId === null
        && data.priorObservedAtMs === null)
        || (Number.isSafeInteger(data.priorDispositionEventId)
          && Number(data.priorDispositionEventId) >= 1
          && Number.isSafeInteger(data.priorSourceEventId)
          && Number(data.priorSourceEventId) >= 1
          && validProductUtcMillis(data.priorObservedAtMs)))
      || (data.operation === 'IGNORE_NO_ACTIVE' && data.sourceEventKind !== 'connection_recovered')
      || (data.operation === 'IGNORE_NO_ACTIVE'
        && data.priorObservedAtMs !== null
        && Number(data.priorObservedAtMs) > Number(data.sourceObservedAtMs))
      || (data.operation === 'IGNORE_LATE'
        && (data.priorSourceEventId === null
          || Number(data.priorSourceEventId) >= Number(data.sourceEventId)
          || Number(data.priorObservedAtMs) <= Number(data.sourceObservedAtMs)))
      || data.externalActionAuthorization !== 'NONE') {
      throw new TypeError('product incident source disposition is invalid');
    }
    const source = this.readProductIncidentSourceEvent(Number(data.sourceEventId));
    if (!source || source.kind !== data.sourceEventKind || !plainLedgerRecord(source.data)
      || source.data.componentId !== data.rootComponentId
      || source.data.group !== data.sourceGroup
      || source.data.status !== data.sourceStatus
      || source.data.detail !== data.sourceDetail
      || source.data.observedAt !== data.sourceObservedAtMs) {
      throw new Error('product incident source disposition does not match durable source truth');
    }
    const commit = this.db.transaction((): ProductPersistenceMutationResult => {
      const existing = this.readProductIncidentRoutingBySourceEventId(Number(data.sourceEventId));
      if (existing !== null) {
        if (existing.kind === audit.kind
          && existing.symbol === audit.symbol
          && canonicalProductPersistenceJson(existing.data, 'existing product incident source disposition')
            === audit.serialized) {
          return frozenProductPersistenceResult(
            'IDEMPOTENT_REPLAY',
            this.readProductPersistenceAudit(existing.id, audit),
            String(existing.id),
          );
        }
        return frozenProductPersistenceResult('IDEMPOTENCY_CONFLICT', null, String(existing.id));
      }
      const event = this.appendProductPersistenceAudit(audit);
      this.advanceProductIncidentRouterCheckpointInTransaction(Number(data.sourceEventId), event.id);
      return frozenProductPersistenceResult('COMMITTED_NEW', event, String(event.id));
    });
    return this.publishProductPersistenceResult(commit.immediate());
  }

  /** Atomically rotates one resolved top-N projection while preserving immutable Ledger history. */
  compareAndRotateResolvedProductIncident(
    input: Readonly<ProductIncidentRotationInput>,
  ): ProductPersistenceMutationResult {
    if (!plainLedgerRecord(input)
      || Object.keys(input).length !== 3
      || !Object.hasOwn(input, 'incidentId')
      || !Object.hasOwn(input, 'expectedLedgerEventId')
      || !Object.hasOwn(input, 'audit')) {
      throw new TypeError('product incident rotation input is invalid');
    }
    assertProductIdentifier(input.incidentId, 'product incident rotation incidentId');
    assertProductPositiveInteger(input.expectedLedgerEventId, 'product incident rotation expectedLedgerEventId');
    const audit = prepareProductPersistenceAudit(input.audit);
    const commit = this.db.transaction((): ProductPersistenceMutationResult => {
      const row = this.db.prepare(`
        SELECT * FROM product_incidents WHERE incident_id = ? LIMIT 1
      `).get(input.incidentId) as ProductIncidentDbRow | undefined;
      if (!row) {
        const existing = this.readProductIncidentRotationByIncidentId(input.incidentId);
        if (existing && existing.kind === audit.kind && existing.symbol === audit.symbol
          && canonicalProductPersistenceJson(existing.data, 'existing product incident rotation') === audit.serialized) {
          return frozenProductPersistenceResult(
            'IDEMPOTENT_REPLAY',
            this.readProductPersistenceAudit(existing.id, audit),
            String(existing.id),
          );
        }
        return frozenProductPersistenceResult('VERSION_CONFLICT', null, null);
      }
      productIncidentRecord(row, this.readProductPersistenceAudit(row.ledger_event_id));
      if (row.ledger_event_id !== input.expectedLedgerEventId) {
        return frozenProductPersistenceResult('VERSION_CONFLICT', null, String(row.ledger_event_id));
      }
      if (row.state !== 'RESOLVED' || !productIncidentRotationAuditMatchesRow(audit.data, row)
        || audit.kind !== 'product.incident.rotated' || audit.symbol !== null) {
        throw new TypeError('product incident rotation audit does not match resolved projection truth');
      }
      const event = this.appendProductPersistenceAudit(audit);
      const removed = this.db.prepare(`
        DELETE FROM product_incidents
        WHERE incident_id = ? AND ledger_event_id = ? AND state = 'RESOLVED'
      `).run(row.incident_id, row.ledger_event_id);
      if (removed.changes !== 1) throw new Error('product incident rotation compare-and-delete failed');
      return frozenProductPersistenceResult('COMMITTED_NEW', event, String(event.id));
    });
    return this.publishProductPersistenceResult(commit.immediate());
  }

  /** Reads one exact incident projection and verifies its immutable audit row. */
  readProductIncident(incidentId: string): Readonly<ProductIncidentRecord> | null {
    assertProductIdentifier(incidentId, 'product incidentId');
    const row = this.db.prepare(`
      SELECT * FROM product_incidents WHERE incident_id = ? LIMIT 1
    `).get(incidentId) as ProductIncidentDbRow | undefined;
    if (!row) return null;
    return productIncidentRecord(row, this.readProductPersistenceAudit(row.ledger_event_id));
  }

  /** Bounded deterministic incident list for one exact owner fingerprint namespace. */
  readProductIncidentsByFingerprintPrefix(
    fingerprintPrefix: string,
    limit = 200,
  ): readonly Readonly<ProductIncidentRecord>[] {
    assertProductIdentifier(fingerprintPrefix, 'product incident fingerprintPrefix');
    const safeLimit = boundedInteger(limit, 1, 200, 200);
    const rows = this.db.prepare(`
      SELECT * FROM product_incidents
      WHERE substr(fingerprint, 1, length(?)) = ?
      ORDER BY
        CASE state WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 WHEN 'RESOLVED' THEN 2 ELSE 3 END,
        CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
        last_seen_at_ms DESC,
        incident_id ASC
      LIMIT ?
    `).all(fingerprintPrefix, fingerprintPrefix, safeLimit) as ProductIncidentDbRow[];
    return Object.freeze(rows.map((row) => (
      productIncidentRecord(row, this.readProductPersistenceAudit(row.ledger_event_id))
    )));
  }

  /** Exact owner-namespace cardinality prevents a bounded read from hiding overflow. */
  countProductIncidentsByFingerprintPrefix(fingerprintPrefix: string): number {
    assertProductIdentifier(fingerprintPrefix, 'product incident fingerprintPrefix');
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM product_incidents
      WHERE substr(fingerprint, 1, length(?)) = ?
    `).get(fingerprintPrefix, fingerprintPrefix) as { count: number };
    assertProductNonNegativeInteger(row.count, 'product incident namespace count');
    return row.count;
  }

  /** Reads admitted source events oldest-first for explicit startup catch-up. */
  readProductIncidentSourceEvents(
    afterId: number,
    limit = 500,
  ): readonly Readonly<LedgerEvent>[] {
    if (!Number.isSafeInteger(afterId) || afterId < 0) {
      throw new TypeError('product incident source cursor is invalid');
    }
    const safeLimit = boundedInteger(limit, 1, 500, 500);
    const rows = this.db.prepare(`
      SELECT * FROM events
      WHERE id > ? AND kind IN ('connection_alert', 'connection_recovered')
      ORDER BY id ASC
      LIMIT ?
    `).all(afterId, safeLimit) as EventDbRow[];
    return Object.freeze(rows.map((row) => Object.freeze(parseEvent(row))));
  }

  private advanceProductIncidentRouterCheckpointInTransaction(
    sourceEventId: number,
    dispositionEventId: number,
  ): void {
    assertProductPositiveInteger(sourceEventId, 'product incident checkpoint sourceEventId');
    assertProductPositiveInteger(dispositionEventId, 'product incident checkpoint dispositionEventId');
    const current = this.readProductIncidentRouterCheckpoint();
    const currentSourceEventId = current.sourceEventId;
    const currentDispositionEventId = current.dispositionEventId;
    const currentProcessedCount = current.processedCount;
    const currentChainDigest = current.chainDigest;
    if (sourceEventId === currentSourceEventId) {
      if (dispositionEventId !== currentDispositionEventId) {
        throw new Error('product incident router checkpoint disposition conflicts');
      }
      return;
    }
    if (sourceEventId < currentSourceEventId) {
      const mapping = this.db.prepare(`
        SELECT disposition_event_id FROM product_incident_source_dispositions
        WHERE source_event_id = ?
      `).get(sourceEventId) as { disposition_event_id: number } | undefined;
      if (!mapping || mapping.disposition_event_id !== dispositionEventId) {
        throw new Error('product incident router historical checkpoint mapping conflicts');
      }
      return;
    }
    const nextSource = this.db.prepare(`
      SELECT id FROM events
      WHERE kind IN ('connection_alert', 'connection_recovered') AND id > ?
      ORDER BY id ASC LIMIT 1
    `).get(currentSourceEventId) as { id: number } | undefined;
    if (!nextSource || nextSource.id !== sourceEventId) {
      throw new Error('product incident router checkpoint advance has a source gap');
    }
    const source = this.readProductIncidentSourceEvent(sourceEventId);
    const disposition = this.readProductIncidentRoutingBySourceEventId(sourceEventId);
    if (source === null || disposition === null || disposition.id !== dispositionEventId
      || disposition.id <= source.id || !plainLedgerRecord(disposition.data)
      || disposition.data.sourceEventId !== source.id
      || ![
        PRODUCT_INCIDENT_ROUTE_SCHEMA,
        PRODUCT_INCIDENT_SOURCE_DISPOSITION_SCHEMA,
      ].includes(String(disposition.data.schema))) {
      throw new Error('product incident router checkpoint advance proof is invalid');
    }
    const processedCount = currentProcessedCount + 1;
    if (!Number.isSafeInteger(processedCount)) {
      throw new Error('product incident router checkpoint count is exhausted');
    }
    const chainDigest = productIncidentRouterCheckpointDigest({
      priorChainDigest: currentChainDigest,
      priorSourceEventId: currentSourceEventId,
      priorDispositionEventId: currentDispositionEventId,
      sourceEventId,
      dispositionEventId,
      sourceData: source.data,
      dispositionData: disposition.data,
    });
    const inserted = this.db.prepare(`
      INSERT INTO product_incident_source_dispositions (
        source_event_id, disposition_event_id, previous_source_event_id,
        previous_disposition_event_id, processed_count, chain_digest
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_event_id) DO NOTHING
    `).run(
      sourceEventId,
      dispositionEventId,
      currentSourceEventId,
      currentDispositionEventId,
      processedCount,
      chainDigest,
    );
    if (inserted.changes !== 1) throw new Error('product incident router checkpoint mapping conflicts');
    this.db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(PRODUCT_INCIDENT_ROUTER_CHECKPOINT_KEY, JSON.stringify({
      schema: PRODUCT_INCIDENT_ROUTER_CHECKPOINT_SCHEMA,
      sourceEventId,
      dispositionEventId,
      processedCount,
      chainDigest,
    }));
  }

  /**
   * Reads only the bounded suffix after the atomically advanced incident-router
   * checkpoint. The latest immutable chained receipt authenticates the prefix,
   * so restart work is independent of lifetime source-event history.
   */
  readProductIncidentRouterBootstrapPage(limit = 500): readonly Readonly<LedgerEvent>[] {
    const safeLimit = boundedInteger(limit, 1, 500, 500);
    const checkpoint = this.readProductIncidentRouterCheckpoint();
    return this.readProductIncidentSourceEvents(checkpoint.sourceEventId, safeLimit);
  }

  /** Exact durable high-water used to avoid lifetime-history replay on restart. */
  readProductIncidentRouterCheckpoint(): Readonly<{
    sourceEventId: number;
    dispositionEventId: number;
    processedCount: number;
    chainDigest: string;
  }> {
    const raw = this.getConfigValue(PRODUCT_INCIDENT_ROUTER_CHECKPOINT_KEY);
    if (raw === null) {
      const mapping = this.db.prepare(`
        SELECT source_event_id FROM product_incident_source_dispositions LIMIT 1
      `).get() as { source_event_id: number } | undefined;
      if (mapping) throw new Error('product incident router checkpoint is missing');
      return Object.freeze({
        sourceEventId: 0,
        dispositionEventId: 0,
        processedCount: 0,
        chainDigest: PRODUCT_INCIDENT_ROUTER_GENESIS_DIGEST,
      });
    }
    let value: unknown;
    try { value = JSON.parse(raw) as unknown; } catch {
      throw new Error('product incident router checkpoint is invalid');
    }
    if (!plainLedgerRecord(value)
      || Object.keys(value).length !== 5
      || value.schema !== PRODUCT_INCIDENT_ROUTER_CHECKPOINT_SCHEMA
      || !Number.isSafeInteger(value.sourceEventId) || Number(value.sourceEventId) < 1
      || !Number.isSafeInteger(value.dispositionEventId) || Number(value.dispositionEventId) < 1
      || !Number.isSafeInteger(value.processedCount) || Number(value.processedCount) < 1
      || typeof value.chainDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.chainDigest)) {
      throw new Error('product incident router checkpoint is invalid');
    }
    const mapping = this.db.prepare(`
      SELECT disposition_event_id, previous_source_event_id, previous_disposition_event_id,
        processed_count, chain_digest
      FROM product_incident_source_dispositions
      WHERE source_event_id = ?
    `).get(Number(value.sourceEventId)) as {
      disposition_event_id: number;
      previous_source_event_id: number;
      previous_disposition_event_id: number;
      processed_count: number;
      chain_digest: string;
    } | undefined;
    if (!mapping || mapping.disposition_event_id !== value.dispositionEventId
      || mapping.processed_count !== value.processedCount
      || mapping.chain_digest !== value.chainDigest
      || !Number.isSafeInteger(mapping.previous_source_event_id)
      || mapping.previous_source_event_id < 0
      || mapping.previous_source_event_id >= Number(value.sourceEventId)
      || !Number.isSafeInteger(mapping.previous_disposition_event_id)
      || mapping.previous_disposition_event_id < 0
      || mapping.previous_disposition_event_id >= Number(value.dispositionEventId)
      || ((mapping.previous_source_event_id === 0)
        !== (mapping.previous_disposition_event_id === 0))) {
      throw new Error('product incident router checkpoint mapping is invalid');
    }
    const latest = this.db.prepare(`
      SELECT source_event_id, disposition_event_id, processed_count, chain_digest
      FROM product_incident_source_dispositions
      ORDER BY processed_count DESC LIMIT 1
    `).get() as {
      source_event_id: number;
      disposition_event_id: number;
      processed_count: number;
      chain_digest: string;
    } | undefined;
    if (!latest
      || latest.source_event_id !== value.sourceEventId
      || latest.disposition_event_id !== value.dispositionEventId
      || latest.processed_count !== value.processedCount
      || latest.chain_digest !== value.chainDigest) {
      throw new Error('product incident router checkpoint is not the immutable high-water');
    }
    const source = this.readProductIncidentSourceEvent(Number(value.sourceEventId));
    const disposition = this.readProductIncidentRoutingBySourceEventId(Number(value.sourceEventId));
    if (source === null || disposition === null || disposition.id !== value.dispositionEventId
      || disposition.id <= source.id || !plainLedgerRecord(disposition.data)
      || disposition.data.sourceEventId !== source.id) {
      throw new Error('product incident router checkpoint proof is invalid');
    }
    let priorChainDigest = PRODUCT_INCIDENT_ROUTER_GENESIS_DIGEST;
    if (mapping.previous_source_event_id === 0) {
      if (mapping.processed_count !== 1) {
        throw new Error('product incident router checkpoint genesis count is invalid');
      }
    } else {
      const prior = this.db.prepare(`
        SELECT disposition_event_id, processed_count, chain_digest
        FROM product_incident_source_dispositions
        WHERE source_event_id = ?
      `).get(mapping.previous_source_event_id) as {
        disposition_event_id: number;
        processed_count: number;
        chain_digest: string;
      } | undefined;
      if (!prior
        || prior.disposition_event_id !== mapping.previous_disposition_event_id
        || prior.processed_count !== mapping.processed_count - 1
        || !/^[a-f0-9]{64}$/.test(prior.chain_digest)) {
        throw new Error('product incident router checkpoint predecessor is invalid');
      }
      priorChainDigest = prior.chain_digest;
    }
    const expectedChainDigest = productIncidentRouterCheckpointDigest({
      priorChainDigest,
      priorSourceEventId: mapping.previous_source_event_id,
      priorDispositionEventId: mapping.previous_disposition_event_id,
      sourceEventId: Number(value.sourceEventId),
      dispositionEventId: Number(value.dispositionEventId),
      sourceData: source.data,
      dispositionData: disposition.data,
    });
    if (expectedChainDigest !== value.chainDigest) {
      throw new Error('product incident router checkpoint chain digest is invalid');
    }
    return Object.freeze({
      sourceEventId: Number(value.sourceEventId),
      dispositionEventId: Number(value.dispositionEventId),
      processedCount: Number(value.processedCount),
      chainDigest: value.chainDigest,
    });
  }

  /** Advances an existing exact source disposition during idempotent catch-up. */
  advanceProductIncidentRouterCheckpoint(sourceEventId: number): void {
    assertProductPositiveInteger(sourceEventId, 'product incident checkpoint sourceEventId');
    const disposition = this.readProductIncidentRoutingBySourceEventId(sourceEventId);
    if (disposition === null) throw new Error('product incident checkpoint disposition is missing');
    const commit = this.db.transaction(() => {
      this.advanceProductIncidentRouterCheckpointInTransaction(sourceEventId, disposition.id);
    });
    commit.immediate();
  }

  /** Exact durable admitted source event for router input authentication. */
  readProductIncidentSourceEvent(sourceEventId: number): Readonly<LedgerEvent> | null {
    assertProductPositiveInteger(sourceEventId, 'product incident sourceEventId');
    const row = this.db.prepare(`
      SELECT * FROM events
      WHERE id = ? AND kind IN ('connection_alert', 'connection_recovered')
    `).get(sourceEventId) as EventDbRow | undefined;
    return row ? Object.freeze(parseEvent(row)) : null;
  }

  /** Exact durable source-event dedupe for Product incident routing audits. */
  readProductIncidentRoutingBySourceEventId(sourceEventId: number): Readonly<LedgerEvent> | null {
    assertProductPositiveInteger(sourceEventId, 'product incident sourceEventId');
    const rows = this.db.prepare(`
      SELECT * FROM events
      WHERE kind IN (
        'product.incident.opened', 'product.incident.grouped', 'product.incident.resolved',
        'product.incident.source_ignored'
      )
        AND json_valid(data)
        AND json_extract(data, '$.schema') IN (
          'cosmos.product-incident-route.v1',
          'cosmos.product-incident-source-disposition.v1'
        )
        AND CASE WHEN json_valid(data)
          THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END = ?
      ORDER BY id ASC
      LIMIT 2
    `).all(sourceEventId) as EventDbRow[];
    if (rows.length > 1) throw new Error('duplicate durable product incident source routing events');
    return rows.length === 0 ? null : Object.freeze(parseEvent(rows[0]!));
  }

  /** Exact immutable Product incident route by its Ledger receipt revision. */
  readProductIncidentRoutingByReceiptEventId(receiptEventId: number): Readonly<LedgerEvent> | null {
    assertProductPositiveInteger(receiptEventId, 'product incident routing receiptEventId');
    const row = this.db.prepare(`
      SELECT * FROM events
      WHERE id = ?
        AND kind IN ('product.incident.opened', 'product.incident.grouped', 'product.incident.resolved')
        AND json_extract(data, '$.schema') = 'cosmos.product-incident-route.v1'
      LIMIT 1
    `).get(receiptEventId) as EventDbRow | undefined;
    return row ? Object.freeze(parseEvent(row)) : null;
  }

  /** Latest exact processed-source high-water for one component/group stream. */
  readLatestProductIncidentSourceDisposition(
    componentId: string,
    sourceGroup: string,
  ): Readonly<LedgerEvent> | null {
    assertProductIdentifier(componentId, 'product incident componentId');
    assertProductIdentifier(sourceGroup, 'product incident sourceGroup');
    const row = this.db.prepare(`
      SELECT * FROM events
      WHERE kind IN (
        'product.incident.opened', 'product.incident.grouped', 'product.incident.resolved',
        'product.incident.source_ignored'
      )
        AND json_valid(data)
        AND json_extract(data, '$.schema') IN (
          'cosmos.product-incident-route.v1',
          'cosmos.product-incident-source-disposition.v1'
        )
        AND CASE WHEN json_valid(data) THEN json_extract(data, '$.rootComponentId') END = ?
        AND CASE WHEN json_valid(data) THEN json_extract(data, '$.sourceGroup') END = ?
      ORDER BY CASE WHEN json_valid(data)
        THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END DESC, id DESC
      LIMIT 1
    `).get(componentId, sourceGroup) as EventDbRow | undefined;
    return row ? Object.freeze(parseEvent(row)) : null;
  }

  /** Exact predecessor disposition for ignored-source causal proof. */
  readPreviousProductIncidentSourceDisposition(
    componentId: string,
    sourceGroup: string,
    beforeSourceEventId: number,
  ): Readonly<LedgerEvent> | null {
    assertProductIdentifier(componentId, 'product incident componentId');
    assertProductIdentifier(sourceGroup, 'product incident sourceGroup');
    assertProductPositiveInteger(beforeSourceEventId, 'product incident beforeSourceEventId');
    const row = this.db.prepare(`
      SELECT * FROM events
      WHERE kind IN (
        'product.incident.opened', 'product.incident.grouped', 'product.incident.resolved',
        'product.incident.source_ignored'
      )
        AND json_valid(data)
        AND json_extract(data, '$.schema') IN (
          'cosmos.product-incident-route.v1',
          'cosmos.product-incident-source-disposition.v1'
        )
        AND CASE WHEN json_valid(data) THEN json_extract(data, '$.rootComponentId') END = ?
        AND CASE WHEN json_valid(data) THEN json_extract(data, '$.sourceGroup') END = ?
        AND CASE WHEN json_valid(data)
          THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END < ?
      ORDER BY CASE WHEN json_valid(data)
        THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END DESC, id DESC
      LIMIT 1
    `).get(componentId, sourceGroup, beforeSourceEventId) as EventDbRow | undefined;
    return row ? Object.freeze(parseEvent(row)) : null;
  }

  /** Exact predecessor route, excluding ignored late/unmatched source dispositions. */
  readPreviousProductIncidentRoutedDisposition(
    componentId: string,
    sourceGroup: string,
    beforeSourceEventId: number,
  ): Readonly<LedgerEvent> | null {
    assertProductIdentifier(componentId, 'product incident componentId');
    assertProductIdentifier(sourceGroup, 'product incident sourceGroup');
    assertProductPositiveInteger(beforeSourceEventId, 'product incident beforeSourceEventId');
    const row = this.db.prepare(`
      SELECT * FROM events
      WHERE kind IN ('product.incident.opened', 'product.incident.grouped', 'product.incident.resolved')
        AND json_valid(data)
        AND json_extract(data, '$.schema') = 'cosmos.product-incident-route.v1'
        AND CASE WHEN json_valid(data) THEN json_extract(data, '$.rootComponentId') END = ?
        AND CASE WHEN json_valid(data) THEN json_extract(data, '$.sourceGroup') END = ?
        AND CASE WHEN json_valid(data)
          THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END < ?
      ORDER BY CASE WHEN json_valid(data)
        THEN CAST(json_extract(data, '$.sourceEventId') AS INTEGER) END DESC, id DESC
      LIMIT 1
    `).get(componentId, sourceGroup, beforeSourceEventId) as EventDbRow | undefined;
    return row ? Object.freeze(parseEvent(row)) : null;
  }

  /** Stable immutable in-app opening receipt for one routed incident episode. */
  readProductIncidentOpeningRoutingByIncidentId(incidentId: string): Readonly<LedgerEvent> | null {
    assertProductIdentifier(incidentId, 'product incidentId');
    const rows = this.db.prepare(`
      SELECT * FROM events
      WHERE kind = 'product.incident.opened'
        AND json_extract(data, '$.schema') = 'cosmos.product-incident-route.v1'
        AND json_extract(data, '$.incidentId') = ?
      ORDER BY id ASC
      LIMIT 2
    `).all(incidentId) as EventDbRow[];
    if (rows.length > 1) throw new Error('duplicate durable product incident opening routes');
    return rows.length === 0 ? null : Object.freeze(parseEvent(rows[0]!));
  }

  /** One immutable ACK transition for an incident episode, independent of idempotency-key lookup. */
  readProductIncidentAcknowledgementByIncidentId(incidentId: string): Readonly<LedgerEvent> | null {
    assertProductIdentifier(incidentId, 'product incidentId');
    const rows = this.db.prepare(`
      SELECT * FROM events
      WHERE kind = ?
        AND json_extract(data, '$.schema') IN (
          'cosmos.product-incident-ack.v1',
          'cosmos.product-incident-ack.v2'
        )
        AND json_extract(data, '$.incidentId') = ?
      ORDER BY id ASC
      LIMIT 2
    `).all(PRODUCT_INCIDENT_ACK_EVENT_KIND, incidentId) as EventDbRow[];
    if (rows.length > 1) throw new Error('duplicate durable product incident ACK transitions');
    return rows.length === 0 ? null : Object.freeze(parseEvent(rows[0]!));
  }

  /** Immutable proof that a resolved projection episode was top-N rotated. */
  readProductIncidentRotationByIncidentId(incidentId: string): Readonly<LedgerEvent> | null {
    assertProductIdentifier(incidentId, 'product incidentId');
    const rows = this.db.prepare(`
      SELECT * FROM events
      WHERE kind = 'product.incident.rotated'
        AND json_extract(data, '$.schema') = 'cosmos.product-incident-rotation.v1'
        AND json_extract(data, '$.incidentId') = ?
      ORDER BY id ASC
      LIMIT 2
    `).all(incidentId) as EventDbRow[];
    if (rows.length > 1) throw new Error('duplicate durable product incident rotation events');
    return rows.length === 0 ? null : Object.freeze(parseEvent(rows[0]!));
  }

  /** Oldest resolved projection eligible for deterministic top-N rotation. */
  readOldestResolvedProductIncidentByFingerprintPrefix(
    fingerprintPrefix: string,
  ): Readonly<ProductIncidentRecord> | null {
    assertProductIdentifier(fingerprintPrefix, 'product incident fingerprintPrefix');
    const row = this.db.prepare(`
      SELECT * FROM product_incidents
      WHERE substr(fingerprint, 1, length(?)) = ? AND state = 'RESOLVED'
      ORDER BY resolved_at_ms ASC, incident_id ASC
      LIMIT 1
    `).get(fingerprintPrefix, fingerprintPrefix) as ProductIncidentDbRow | undefined;
    return row ? productIncidentRecord(row, this.readProductPersistenceAudit(row.ledger_event_id)) : null;
  }

  /**
   * Reads the one immutable acknowledgement event by Product incident and
   * idempotency identity. The canonical Ledger event-history route exposes this same
   * Ledger row; no operator-event projection or second store is involved.
   */
  readProductIncidentAcknowledgement(
    incidentId: string,
    idempotencyKey: string,
  ): Readonly<LedgerEvent> | null {
    assertProductIdentifier(incidentId, 'product incidentId');
    if (typeof idempotencyKey !== 'string' || !PRODUCT_IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new TypeError('product incident acknowledgement idempotencyKey is invalid');
    }
    const rows = this.db.prepare(`
      SELECT * FROM events
      WHERE kind = ?
        AND json_extract(data, '$.schema') IN (
          'cosmos.product-incident-ack.v1',
          'cosmos.product-incident-ack.v2'
        )
        AND json_extract(data, '$.incidentId') = ?
        AND json_extract(data, '$.idempotencyKey') = ?
      ORDER BY id ASC
      LIMIT 2
    `).all(
      PRODUCT_INCIDENT_ACK_EVENT_KIND,
      incidentId,
      idempotencyKey,
    ) as EventDbRow[];
    if (rows.length > 1) throw new Error('duplicate durable product incident acknowledgement events');
    return rows.length === 0 ? null : this.readProductPersistenceAudit(rows[0]!.id);
  }

  /** Reads one Product ACK receipt by its exact command identity pair. */
  readProductIncidentCommandAcknowledgement(
    idempotencyKey: string,
    controlId: string,
  ): Readonly<LedgerEvent> | null {
    if (typeof idempotencyKey !== 'string' || !PRODUCT_IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new TypeError('product incident acknowledgement idempotencyKey is invalid');
    }
    if (typeof controlId !== 'string' || !/^incident\.ack\.[a-f0-9]{64}$/.test(controlId)) {
      throw new TypeError('product incident acknowledgement controlId is invalid');
    }
    const rows = this.db.prepare(`
      SELECT * FROM events
      WHERE kind = ?
        AND json_extract(data, '$.schema') = 'cosmos.product-incident-ack.v2'
        AND json_extract(data, '$.idempotencyKey') = ?
        AND json_extract(data, '$.command.controlId') = ?
      ORDER BY id ASC
      LIMIT 2
    `).all(PRODUCT_INCIDENT_ACK_EVENT_KIND, idempotencyKey, controlId) as EventDbRow[];
    if (rows.length > 1) throw new Error('duplicate durable product incident command receipts');
    return rows.length === 0 ? null : this.readProductPersistenceAudit(rows[0]!.id);
  }

  /**
   * CAS-records one boot, shutdown, or release revision. The row is evidence
   * only; this primitive never deploys, switches a release, or marks readiness.
   */
  compareAndSetProductBootReleaseRevision(
    input: Readonly<ProductBootReleasePersistenceInput>,
  ): ProductPersistenceMutationResult {
    if (!plainLedgerRecord(input)) throw new TypeError('product boot/release input is invalid');
    assertProductIdentifier(input.operationId, 'product boot/release operationId');
    assertProductDomainState(input.operationType, 'product boot/release operationType');
    if (input.expectedLedgerEventId !== null) {
      assertProductPositiveInteger(input.expectedLedgerEventId, 'product boot/release expectedLedgerEventId');
    }
    assertProductNonNegativeInteger(input.generation, 'product boot/release generation');
    for (const [label, value] of [
      ['testedCommit', input.testedCommit],
      ['deployedCommit', input.deployedCommit],
    ] as const) {
      if (value !== null && !PRODUCT_COMMIT.test(value)) {
        throw new TypeError(`product boot/release ${label} is invalid`);
      }
    }
    assertProductOptionalIdentifier(input.configRevision, 'product boot/release configRevision');
    assertProductIdentifier(input.schemaRevision, 'product boot/release schemaRevision');
    assertProductOptionalIdentifier(input.modelRevision, 'product boot/release modelRevision');
    assertProductUtcMillis(input.startedAtMs, 'product boot/release startedAtMs');
    if (input.completedAtMs !== null) {
      assertProductUtcMillis(input.completedAtMs, 'product boot/release completedAtMs');
      if (input.completedAtMs < input.startedAtMs) throw new TypeError('product boot/release completion precedes start');
    }
    if (input.clean !== null && typeof input.clean !== 'boolean') throw new TypeError('product boot/release clean is invalid');
    if (input.clean !== null && input.completedAtMs === null) {
      throw new TypeError('product boot/release clean evidence requires completion');
    }
    if (input.blockerCode !== null) assertProductDomainState(input.blockerCode, 'product boot/release blockerCode');
    assertProductIdentifier(input.correlationId, 'product boot/release correlationId');
    const audit = prepareProductPersistenceAudit(input.audit);

    const commit = this.db.transaction((): ProductPersistenceMutationResult => {
      const existing = this.db.prepare(`
        SELECT * FROM product_boot_release_revisions WHERE operation_id = ?
      `).get(input.operationId) as ProductBootReleaseDbRow | undefined;
      if (existing && exactProductBootReleaseRow(existing, input)) {
        return frozenProductPersistenceResult(
          'IDEMPOTENT_REPLAY',
          this.readProductPersistenceAudit(existing.ledger_event_id, audit),
          String(existing.ledger_event_id),
        );
      }
      const currentLedgerEventId = existing?.ledger_event_id ?? null;
      if (currentLedgerEventId !== input.expectedLedgerEventId) {
        return frozenProductPersistenceResult(
          'VERSION_CONFLICT',
          null,
          currentLedgerEventId === null ? null : String(currentLedgerEventId),
        );
      }
      if (existing && (input.operationType !== existing.operation_type
        || input.generation !== existing.generation
        || input.testedCommit !== existing.tested_commit
        || input.deployedCommit !== existing.deployed_commit
        || input.configRevision !== existing.config_revision
        || input.schemaRevision !== existing.schema_revision
        || input.modelRevision !== existing.model_revision
        || input.startedAtMs !== existing.started_at_ms
        || input.correlationId !== existing.correlation_id
        || input.completedAtMs === null && existing.completed_at_ms !== null)) {
        throw new TypeError('product boot/release transition cannot rewrite its durable CAS identity');
      }
      const event = this.appendProductPersistenceAudit(audit);
      this.db.prepare(`
        INSERT INTO product_boot_release_revisions (
          operation_id, operation_type, generation, tested_commit,
          deployed_commit, config_revision, schema_revision, model_revision,
          started_at_ms, completed_at_ms, clean, blocker_code,
          correlation_id, ledger_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(operation_id) DO UPDATE SET
          operation_type = excluded.operation_type,
          generation = excluded.generation,
          tested_commit = excluded.tested_commit,
          deployed_commit = excluded.deployed_commit,
          config_revision = excluded.config_revision,
          schema_revision = excluded.schema_revision,
          model_revision = excluded.model_revision,
          started_at_ms = excluded.started_at_ms,
          completed_at_ms = excluded.completed_at_ms,
          clean = excluded.clean,
          blocker_code = excluded.blocker_code,
          correlation_id = excluded.correlation_id,
          ledger_event_id = excluded.ledger_event_id
      `).run(
        input.operationId,
        input.operationType,
        input.generation,
        input.testedCommit,
        input.deployedCommit,
        input.configRevision,
        input.schemaRevision,
        input.modelRevision,
        input.startedAtMs,
        input.completedAtMs,
        input.clean === null ? null : input.clean ? 1 : 0,
        input.blockerCode,
        input.correlationId,
        event.id,
      );
      return frozenProductPersistenceResult('COMMITTED_NEW', event, String(event.id));
    });
    return this.publishProductPersistenceResult(commit.immediate());
  }

  /**
   * Reads a bounded newest-first view of boot/release evidence. Every row and
   * its referenced audit event are validated before any value is published.
   */
  readProductBootReleaseRevisions(
    limit = 20,
  ): readonly Readonly<ProductBootReleaseRecord>[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PRODUCT_PERSISTENCE_QUERY_MAX) {
      throw new RangeError(`product boot/release limit must be 1-${PRODUCT_PERSISTENCE_QUERY_MAX}`);
    }
    const rows = this.db.prepare(`
      SELECT * FROM product_boot_release_revisions
      ORDER BY generation DESC, started_at_ms DESC, operation_id DESC
      LIMIT ?
    `).all(limit) as ProductBootReleaseDbRow[];
    return Object.freeze(rows.map((row) => {
      assertProductIdentifier(row.operation_id, 'durable product boot/release operationId');
      assertProductDomainState(row.operation_type, 'durable product boot/release operationType');
      assertProductNonNegativeInteger(row.generation, 'durable product boot/release generation');
      for (const [label, value] of [
        ['testedCommit', row.tested_commit],
        ['deployedCommit', row.deployed_commit],
      ] as const) {
        if (value !== null && !PRODUCT_COMMIT.test(value)) {
          throw new Error(`durable product boot/release ${label} is invalid`);
        }
      }
      assertProductOptionalIdentifier(row.config_revision, 'durable product boot/release configRevision');
      assertProductIdentifier(row.schema_revision, 'durable product boot/release schemaRevision');
      assertProductOptionalIdentifier(row.model_revision, 'durable product boot/release modelRevision');
      assertProductUtcMillis(row.started_at_ms, 'durable product boot/release startedAtMs');
      if (row.completed_at_ms !== null) {
        assertProductUtcMillis(row.completed_at_ms, 'durable product boot/release completedAtMs');
        if (row.completed_at_ms < row.started_at_ms) {
          throw new Error('durable product boot/release completion precedes start');
        }
      }
      if (row.clean !== null && row.clean !== 0 && row.clean !== 1) {
        throw new Error('durable product boot/release clean state is invalid');
      }
      if (row.completed_at_ms === null && row.clean !== null) {
        throw new Error('durable product boot/release pending row claims a clean state');
      }
      if (row.blocker_code !== null) {
        assertProductDomainState(row.blocker_code, 'durable product boot/release blockerCode');
      }
      assertProductIdentifier(row.correlation_id, 'durable product boot/release correlationId');
      assertProductPositiveInteger(row.ledger_event_id, 'durable product boot/release ledgerEventId');
      this.readProductPersistenceAudit(row.ledger_event_id);
      return Object.freeze({
        operationId: row.operation_id,
        operationType: row.operation_type,
        generation: row.generation,
        testedCommit: row.tested_commit,
        deployedCommit: row.deployed_commit,
        configRevision: row.config_revision,
        schemaRevision: row.schema_revision,
        modelRevision: row.model_revision,
        startedAtMs: row.started_at_ms,
        completedAtMs: row.completed_at_ms,
        clean: row.clean === null ? null : row.clean === 1,
        blockerCode: row.blocker_code,
        correlationId: row.correlation_id,
        ledgerEventId: row.ledger_event_id,
      } satisfies ProductBootReleaseRecord);
    }));
  }

  /**
   * Reads one bounded page from the dedicated material-event cursor. Cursor
   * zero is the valid origin. Prefix retention, missing interior rows, an
   * impossible future cursor, and malformed durable projections remain
   * distinct evidence states rather than being repaired or silently reset.
   */
  readProductOperatorEventPage(
    afterCursor: string,
    limit = 200,
  ): Readonly<LedgerProductOperatorEventPage> {
    const after = parseSqliteCursor(afterCursor);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PRODUCT_OPERATOR_EVENT_MAX_QUERY_LIMIT) {
      throw new RangeError(`product operator event limit must be 1-${PRODUCT_OPERATOR_EVENT_MAX_QUERY_LIMIT}`);
    }

    const read = this.db.transaction(() => {
      const geometry = this.db.prepare(`
        SELECT
          CAST(MIN(cursor) AS TEXT) AS retained_from_cursor,
          COALESCE(
            (SELECT CAST(seq AS TEXT) FROM sqlite_sequence WHERE name = 'product_operator_events'),
            '0'
          ) AS high_water_cursor
        FROM product_operator_events
      `).get() as { retained_from_cursor: string | null; high_water_cursor: string };
      const rows = this.db.prepare(`
        SELECT
          CAST(operator.cursor AS TEXT) AS cursor,
          operator.ledger_event_id,
          operator.event_id,
          operator.component_id,
          operator.correlation_id,
          operator.occurred_at_ms,
          operator.persisted_at_ms,
          operator.material_projection_json,
          ledger.ts AS ledger_ts,
          ledger.kind AS ledger_kind,
          ledger.data AS ledger_data
        FROM product_operator_events AS operator
        LEFT JOIN events AS ledger ON ledger.id = operator.ledger_event_id
        WHERE operator.cursor > ?
        ORDER BY operator.cursor ASC
        LIMIT ?
      `).all(after, limit) as ProductOperatorEventDbRow[];
      const requestedCursorPresent = after === 0n || this.db.prepare(`
        SELECT 1 AS present FROM product_operator_events WHERE cursor = ?
      `).get(after) !== undefined;
      return { geometry, rows, requestedCursorPresent };
    });
    const { geometry, rows, requestedCursorPresent } = read();
    const retainedFromCursor = geometry.retained_from_cursor;
    const highWaterCursor = geometry.high_water_cursor;
    let retained: bigint | null;
    let highWater: bigint;
    try {
      retained = retainedFromCursor === null ? null : parseSqliteCursor(retainedFromCursor);
      highWater = parseSqliteCursor(highWaterCursor);
    } catch {
      return unprovenProductOperatorEventPage(afterCursor, retainedFromCursor, highWaterCursor);
    }

    if (after > highWater) {
      return unprovenProductOperatorEventPage(afterCursor, retainedFromCursor, highWaterCursor);
    }
    if (highWater === 0n) {
      return frozenProductOperatorEventPage(afterCursor, null, '0', 'PROVEN', false, []);
    }
    if (retained === null) {
      return frozenProductOperatorEventPage(
        afterCursor,
        null,
        highWaterCursor,
        after < highWater ? 'GAP' : 'UNPROVEN',
        true,
        [],
      );
    }
    if (retained > highWater) {
      return unprovenProductOperatorEventPage(afterCursor, retainedFromCursor, highWaterCursor);
    }
    if (after + 1n < retained) {
      return frozenProductOperatorEventPage(
        afterCursor,
        retainedFromCursor,
        highWaterCursor,
        'GAP',
        true,
        [],
      );
    }
    if (after >= retained && after <= highWater && !requestedCursorPresent) {
      return frozenProductOperatorEventPage(
        afterCursor,
        retainedFromCursor,
        highWaterCursor,
        'GAP',
        false,
        [],
      );
    }

    let continuity: LedgerProductOperatorEventPage['continuity'] = 'PROVEN';
    const items: Readonly<LedgerProductOperatorEventRecord>[] = [];
    let expected = after + 1n;
    for (const row of rows) {
      let cursor: bigint;
      try {
        cursor = parseSqliteCursor(row.cursor);
      } catch {
        continuity = 'UNPROVEN';
        break;
      }
      if (cursor !== expected) {
        continuity = 'GAP';
        break;
      }
      const event = parseProductOperatorEventRow(row);
      if (!event) {
        continuity = 'UNPROVEN';
        break;
      }
      items.push(Object.freeze({ cursor: row.cursor, event }));
      expected += 1n;
    }
    if (items.length === 0 && after < highWater && continuity === 'PROVEN') continuity = 'GAP';
    return frozenProductOperatorEventPage(
      afterCursor,
      retainedFromCursor,
      highWaterCursor,
      continuity,
      false,
      items,
    );
  }

  /**
   * Compares the exact durable config value and, only on a match, commits the
   * replacement value plus its bounded journal/audit records in one SQLite
   * writer transaction. `BEGIN IMMEDIATE` is intentional: independently
   * opened Ledger connections must serialize before reading the expected
   * value, so a stale writer returns a conflict without appending an event.
   */
  compareAndSetConfigValueAndLogEvents(
    key: string,
    expectedValue: string | null,
    nextValue: string,
    records: readonly LedgerEventInput[],
    commitBeforeMs?: number,
  ): LedgerConfigCompareAndSetResult {
    if (typeof key !== 'string' || !CONFIG_CAS_KEY.test(key)) {
      throw new TypeError('invalid compare-and-set config key');
    }
    if (expectedValue !== null && typeof expectedValue !== 'string') {
      throw new TypeError('compare-and-set expected value must be a string or null');
    }
    if (typeof nextValue !== 'string') {
      throw new TypeError('compare-and-set next value must be a string');
    }
    if ((expectedValue !== null
        && Buffer.byteLength(expectedValue, 'utf8') > CONFIG_CAS_VALUE_MAX_BYTES)
      || Buffer.byteLength(nextValue, 'utf8') > CONFIG_CAS_VALUE_MAX_BYTES) {
      throw new RangeError('compare-and-set config value exceeds its byte bound');
    }
    if (!Array.isArray(records) || records.length < 1 || records.length > CONFIG_CAS_EVENT_BATCH_MAX) {
      throw new RangeError(`compare-and-set event batch must contain between 1 and ${CONFIG_CAS_EVENT_BATCH_MAX} records`);
    }
    if (commitBeforeMs !== undefined
      && (!Number.isSafeInteger(commitBeforeMs) || commitBeforeMs < 0)) {
      throw new TypeError('compare-and-set commitBeforeMs must be a non-negative safe integer');
    }

    const prepared = records.map((record) => {
      if (record === null || typeof record !== 'object') {
        throw new TypeError('invalid compare-and-set ledger event kind');
      }
      const kind = record.kind;
      const rawSymbol = record.symbol;
      const rawData = record.data;
      const hasData = Object.hasOwn(record, 'data');
      if (typeof kind !== 'string' || !LEDGER_EVENT_KIND.test(kind)) {
        throw new TypeError('invalid compare-and-set ledger event kind');
      }
      const symbol = rawSymbol ?? null;
      if (symbol !== null && (typeof symbol !== 'string'
        || symbol.length > CONFIG_CAS_EVENT_SYMBOL_MAX_CHARS
        || /[\u0000-\u001f\u007f]/.test(symbol))) {
        throw new TypeError('invalid compare-and-set ledger event symbol');
      }
      if (!hasData && rawData !== undefined) {
        throw new TypeError('compare-and-set ledger event data must be an own value');
      }
      const data = prepareLedgerEventData(rawData, hasData);
      if (data.serialized !== null
          && Buffer.byteLength(data.serialized, 'utf8') > CONFIG_CAS_EVENT_DATA_MAX_BYTES) {
        throw new RangeError('compare-and-set ledger event data exceeds its byte bound');
      }
      validateFinancialMutationEvent(kind, symbol, data.value);
      return Object.freeze({
        kind,
        symbol,
        serialized: data.serialized,
        data: data.value,
        metadata: snapshotLedgerEventMetadata(record),
      });
    });

    const insert = this.db.prepare(LEDGER_EVENT_INSERT_SQL);
    const insertProductOperatorEvent = this.db.prepare(`
      INSERT INTO product_operator_events (
        ledger_event_id,
        event_id,
        component_id,
        correlation_id,
        occurred_at_ms,
        persisted_at_ms,
        material_projection_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const commit = this.db.transaction((): LedgerConfigCompareAndSetResult => {
      const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      const currentValue = row?.value ?? null;
      if (currentValue !== expectedValue) {
        return Object.freeze({ committed: false as const, reason: 'VERSION_CONFLICT' as const, currentValue });
      }

      const ts = Date.now();
      if (commitBeforeMs !== undefined && ts >= commitBeforeMs) {
        return Object.freeze({ committed: false as const, reason: 'DEADLINE_EXCEEDED' as const, currentValue });
      }
      this.db
        .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, nextValue);
      let appendedProductOperatorEvent = false;
      const events = prepared.map((record) => {
        const info = insert.run(...eventInsertValues(
          ts,
          record.kind,
          record.symbol,
          record.serialized,
          record.metadata,
        ));
        const ledgerEventId = Number(info.lastInsertRowid);
        if (!Number.isSafeInteger(ledgerEventId) || ledgerEventId < 1) {
          throw new RangeError('ledger event identity exceeds the supported integer range');
        }
        const productOperatorEvent = prepareProductOperatorEvent(record.kind, record.data, ts);
        if (productOperatorEvent) {
          insertProductOperatorEvent.run(
            ledgerEventId,
            productOperatorEvent.eventId,
            productOperatorEvent.componentId,
            productOperatorEvent.correlationId,
            productOperatorEvent.occurredAtMs,
            productOperatorEvent.persistedAtMs,
            productOperatorEvent.serializedProjection,
          );
          appendedProductOperatorEvent = true;
        }
        return Object.freeze(ledgerEventFromAppend(
          ledgerEventId,
          ts,
          record.kind,
          record.symbol,
          record.data,
          record.metadata,
        ));
      });
      if (appendedProductOperatorEvent) this.trimProductOperatorEvents();
      return Object.freeze({ committed: true as const, events: Object.freeze(events) });
    });

    const result = commit.immediate();
    if (!result.committed) return result;

    const cloneCommittedEvent = (event: Readonly<LedgerEvent>, index: number): LedgerEvent => ({
      id: event.id,
      ts: event.ts,
      kind: prepared[index].kind,
      symbol: prepared[index].symbol,
      data: prepared[index].serialized === null
        ? null
        : JSON.parse(prepared[index].serialized) as unknown,
      severity: event.severity,
      source: event.source,
      strategy: event.strategy,
      status: event.status,
      reason: event.reason,
      message: event.message,
      correlation: event.correlation,
      createdAt: event.createdAt,
    });
    const exactResult: LedgerConfigCompareAndSetResult = Object.freeze({
      committed: true as const,
      events: Object.freeze(result.events.map((event, index) => Object.freeze(
        cloneCommittedEvent(event, index),
      ))),
    });

    let listenerFailed = false;
    for (const [index, event] of result.events.entries()) {
      // EventEmitter publishes synchronously and normally shares one argument
      // object across every listener. Snapshot its raw listeners to preserve
      // order/once semantics, but give each listener a fresh parse of the
      // committed JSON so one consumer cannot corrupt a later consumer or the
      // value returned to the caller.
      for (const listener of this.rawListeners('event')) {
        try {
          listener.call(this, cloneCommittedEvent(event, index));
        } catch {
          listenerFailed = true;
        }
      }
    }
    if (!listenerFailed) return exactResult;

    // The transaction has already committed. Exact readback prevents a
    // listener exception from being returned as a write failure that could
    // cause a caller to append the same financial mutation a second time.
    try {
      const ids = result.events.map((event) => event.id);
      const placeholders = ids.map(() => '?').join(', ');
      const rows = this.db
        .prepare(`SELECT * FROM events WHERE id IN (${placeholders}) ORDER BY id ASC`)
        .all(...ids) as EventDbRow[];
      const operatorRows = this.db.prepare(`
        SELECT ledger_event_id, material_projection_json
        FROM product_operator_events
        WHERE ledger_event_id IN (${placeholders})
        ORDER BY ledger_event_id ASC
      `).all(...ids) as { ledger_event_id: number; material_projection_json: string }[];
      const operatorByLedgerEventId = new Map(
        operatorRows.map((row) => [row.ledger_event_id, row.material_projection_json] as const),
      );
      const exact = this.getConfigValue(key) === nextValue
        && rows.length === prepared.length
        && rows.every((row, index) => row.id === ids[index]
          && row.ts === result.events[index].ts
          && row.kind === prepared[index].kind
          && row.symbol === prepared[index].symbol
          && row.data === prepared[index].serialized
          && row.severity === prepared[index].metadata.severity
          && row.source === prepared[index].metadata.source
          && row.strategy === prepared[index].metadata.strategy
          && row.status === prepared[index].metadata.status
          && row.reason === prepared[index].metadata.reason
          && row.message === prepared[index].metadata.message
          && row.correlation === prepared[index].metadata.correlation
          && row.created_at === (prepared[index].metadata.createdAt ?? row.ts)
          && (() => {
            const productOperatorEvent = prepareProductOperatorEvent(
              prepared[index].kind,
              prepared[index].data,
              row.ts,
            );
            const stored = operatorByLedgerEventId.get(row.id);
            return productOperatorEvent
              ? stored === productOperatorEvent.serializedProjection
              : stored === undefined;
          })());
      if (exact) {
        return Object.freeze({
          committed: true as const,
          events: Object.freeze(rows.map(parseEvent)),
        });
      }
    } catch {
      // The commit result remains authoritative even if diagnostic readback is
      // unavailable after a listener mutates or closes its surrounding app.
    }
    return exactResult;
  }

  /**
   * Reads the durable schema/rollback contract owned by this Ledger. The
   * values are intentionally withheld unless the singleton row, SQLite
   * user_version, and this runtime's supported schema agree exactly.
   */
  readSchemaCompatibility(): Readonly<LedgerSchemaCompatibilityReadback> {
    if (this.closed || !this.db.open) {
      return failedSchemaCompatibility('UNAVAILABLE', 'LEDGER_SCHEMA_COMPATIBILITY_UNAVAILABLE');
    }
    let userVersion: unknown;
    let rows: LedgerSchemaCompatibilityRow[];
    try {
      userVersion = this.db.pragma('user_version', { simple: true }) as unknown;
      rows = this.db.prepare(`
        SELECT singleton, current_schema_version, rollback_floor
        FROM ${LEDGER_SCHEMA_COMPATIBILITY_TABLE}
        ORDER BY singleton
        LIMIT 2
      `).all() as LedgerSchemaCompatibilityRow[];
    } catch {
      return failedSchemaCompatibility('MALFORMED', 'LEDGER_SCHEMA_COMPATIBILITY_QUERY_FAILED');
    }
    if (!Number.isSafeInteger(userVersion) || (userVersion as number) < 0) {
      return failedSchemaCompatibility('MALFORMED', 'LEDGER_SCHEMA_USER_VERSION_MALFORMED');
    }
    if (rows.length !== 1) {
      return failedSchemaCompatibility('MALFORMED', 'LEDGER_SCHEMA_COMPATIBILITY_ROW_COUNT_INVALID');
    }
    const row = rows[0];
    if (row.singleton !== 1
        || !Number.isSafeInteger(row.current_schema_version)
        || (row.current_schema_version as number) < 1
        || !Number.isSafeInteger(row.rollback_floor)
        || (row.rollback_floor as number) < 0) {
      return failedSchemaCompatibility('MALFORMED', 'LEDGER_SCHEMA_COMPATIBILITY_ROW_MALFORMED');
    }
    const currentSchemaVersion = row.current_schema_version as number;
    const rollbackFloor = row.rollback_floor as number;
    if (rollbackFloor > currentSchemaVersion) {
      return failedSchemaCompatibility('MISMATCH', 'LEDGER_ROLLBACK_FLOOR_EXCEEDS_CURRENT_SCHEMA');
    }
    if ((userVersion as number) > LEDGER_SCHEMA_VERSION
        || currentSchemaVersion > LEDGER_SCHEMA_VERSION) {
      return failedSchemaCompatibility('MISMATCH', 'LEDGER_SCHEMA_VERSION_UNSUPPORTED_NEWER');
    }
    if ((userVersion as number) !== currentSchemaVersion
        || currentSchemaVersion !== LEDGER_SCHEMA_VERSION) {
      return failedSchemaCompatibility('MISMATCH', 'LEDGER_SCHEMA_VERSION_MISMATCH');
    }
    if (rollbackFloor < LEDGER_ROLLBACK_FLOOR) {
      return failedSchemaCompatibility('MISMATCH', 'LEDGER_ROLLBACK_FLOOR_BELOW_RUNTIME_FLOOR');
    }
    return availableSchemaCompatibility(currentSchemaVersion, rollbackFloor);
  }

  /**
   * Proves that the on-disk ledger can write and read without leaving probe
   * data behind. A savepoint is used so the config table is unchanged.
   */
  probeWritable(force = false): boolean {
    if (this.closed || !this.db.open) return false;
    const now = Date.now();
    if (!force && this.healthProbeCache && now - this.healthProbeCache.checkedAt < HEALTH_PROBE_CACHE_MS) {
      return this.healthProbeCache.writable;
    }
    const key = '__health_write_probe__';
    const value = String(now);
    try {
      this.db.exec('SAVEPOINT health_write_probe');
      this.db
        .prepare(
          'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run(key, value);
      const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      this.db.exec('ROLLBACK TO health_write_probe');
      this.db.exec('RELEASE health_write_probe');
      const writable = row?.value === value;
      this.healthProbeCache = { checkedAt: now, writable };
      return writable;
    } catch {
      try {
        this.db.exec('ROLLBACK TO health_write_probe');
        this.db.exec('RELEASE health_write_probe');
      } catch {
        // The original write failure is the health result.
      }
      this.healthProbeCache = { checkedAt: now, writable: false };
      return false;
    }
  }

  /**
   * Periodic WAL reclamation (Part 4 #10): without it the WAL is fully
   * reclaimed only on a clean stop, which a SIGKILL mid-drain is precisely
   * the scenario that prevents. Best-effort by design — a busy reader simply
   * defers reclamation to the next pass.
   */
  checkpointWalPeriodic(): boolean {
    if (this.closed || !this.db.open) return false;
    try {
      const rows = this.db.pragma('wal_checkpoint(TRUNCATE)') as unknown;
      if (!Array.isArray(rows) || rows.length !== 1) return false;
      const row = rows[0] as Record<string, unknown>;
      return row.busy === 0;
    } catch {
      return false;
    }
  }

  /**
   * Forces the WAL into the main database under FULL synchronous durability.
   * The clean boot marker is trustworthy only when every frame was
   * checkpointed without a busy reader/writer.
   */
  flushForCleanShutdown(): boolean {
    if (this.closed || !this.db.open) return false;
    try {
      this.db.pragma('synchronous = FULL');
      const rows = this.db.pragma('wal_checkpoint(FULL)') as unknown;
      if (!Array.isArray(rows) || rows.length !== 1) return false;
      const row = rows[0] as Record<string, unknown>;
      return Number.isSafeInteger(row.busy)
        && row.busy === 0
        && Number.isSafeInteger(row.log)
        && Number.isSafeInteger(row.checkpointed)
        && row.log === row.checkpointed;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.closed) return;
    if (this.db.open) this.db.close();
    this.closed = true;
    this.healthProbeCache = null;
    this.removeAllListeners();
  }
}

function plainLedgerRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactLedgerFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function validProductUtcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 4_102_444_800_000;
}

function assertProductIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !PRODUCT_IDENTIFIER.test(value)) {
    throw new TypeError(`${label} must be a bounded canonical identifier`);
  }
}

function assertProductDomainState(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !PRODUCT_DOMAIN_STATE.test(value)) {
    throw new TypeError(`${label} must be a bounded canonical state`);
  }
}

function assertProductIncidentSeverity(
  value: unknown,
  label: string,
): asserts value is (typeof PRODUCT_INCIDENT_SEVERITIES)[number] {
  if (typeof value !== 'string'
    || !PRODUCT_INCIDENT_SEVERITIES.includes(value as (typeof PRODUCT_INCIDENT_SEVERITIES)[number])) {
    throw new TypeError(`${label} must be CRITICAL, HIGH, MEDIUM, or LOW`);
  }
}

function assertProductIncidentState(
  value: unknown,
  label: string,
): asserts value is (typeof PRODUCT_INCIDENT_STATES)[number] {
  if (typeof value !== 'string'
    || !PRODUCT_INCIDENT_STATES.includes(value as (typeof PRODUCT_INCIDENT_STATES)[number])) {
    throw new TypeError(`${label} must be OPEN, ACKNOWLEDGED, or RESOLVED`);
  }
}

function validProductIncidentLifecycle(
  state: string,
  lastSeenAtMs: number,
  acknowledgedAtMs: number | null,
  acknowledgedByOperatorId: string | null,
  resolvedAtMs: number | null,
): boolean {
  const acknowledgementAbsent = acknowledgedAtMs === null && acknowledgedByOperatorId === null;
  const acknowledgementPresent = acknowledgedAtMs !== null && acknowledgedByOperatorId !== null;
  if (state === 'OPEN') return acknowledgementAbsent && resolvedAtMs === null;
  if (state === 'ACKNOWLEDGED') return acknowledgementPresent && resolvedAtMs === null;
  return state === 'RESOLVED'
    && (acknowledgementAbsent || acknowledgementPresent)
    && resolvedAtMs !== null
    && resolvedAtMs === lastSeenAtMs
    && (acknowledgedAtMs === null || acknowledgedAtMs <= resolvedAtMs);
}

function validProductIncidentTransition(
  existing: Readonly<ProductIncidentDbRow>,
  input: Readonly<ProductIncidentPersistenceInput>,
): boolean {
  if (existing.state === 'RESOLVED') return false;
  if (existing.state === 'ACKNOWLEDGED' && input.state === 'OPEN') return false;
  if (existing.acknowledged_at_ms !== null) {
    if (input.acknowledgedAtMs !== existing.acknowledged_at_ms
      || input.acknowledgedByOperatorId !== existing.acknowledged_by_operator_id) return false;
  } else if (input.acknowledgedAtMs !== null && input.state !== 'ACKNOWLEDGED') {
    return false;
  }
  return true;
}

function assertProductUtcMillis(value: unknown, label: string): asserts value is number {
  if (!validProductUtcMillis(value)) throw new TypeError(`${label} must be valid UTC milliseconds`);
}

function assertProductNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function assertProductPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function assertProductOptionalIdentifier(value: unknown, label: string): asserts value is string | null {
  if (value !== null) assertProductIdentifier(value, label);
}

function assertProductOptionalDigest(value: unknown, label: string): asserts value is string | null {
  if (value !== null && (typeof value !== 'string' || !PRODUCT_DIGEST.test(value))) {
    throw new TypeError(`${label} must be a canonical digest or null`);
  }
}

function assertProductReason(value: unknown): asserts value is string {
  if (typeof value !== 'string'
    || value !== value.trim()
    || [...value].length < 1
    || [...value].length > 500
    || /[\u0000-\u001f\u007f]/.test(value)
    || PRODUCT_SENSITIVE_TEXT.test(value)) {
    throw new TypeError('product command reason must be 1-500 secret-free UTF-8 characters');
  }
}

function canonicalProductPersistenceJson(value: unknown, label: string): string {
  let serialized: string;
  try {
    serialized = canonicalPersistenceJson(value);
  } catch {
    throw new TypeError(`${label} must be bounded canonical secret-free JSON`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > PRODUCT_PERSISTENCE_JSON_MAX_BYTES) {
    throw new RangeError(`${label} exceeds its 262144-byte bound`);
  }
  return serialized;
}

function canonicalNullableProductPersistenceJson(value: SystemJsonValue | null, label: string): string | null {
  return value === null ? null : canonicalProductPersistenceJson(value, label);
}

function prepareProductPersistenceAudit(
  audit: Readonly<ProductPersistenceAuditRecord>,
): Readonly<PreparedProductPersistenceAudit> {
  if (!plainLedgerRecord(audit)
    || typeof audit.kind !== 'string'
    || !LEDGER_EVENT_KIND.test(audit.kind)
    || Object.keys(audit).some((key) => !['kind', 'symbol', 'data'].includes(key))) {
    throw new TypeError('product persistence audit record is invalid');
  }
  const symbol = audit.symbol ?? null;
  if (symbol !== null && (typeof symbol !== 'string'
    || symbol.length > CONFIG_CAS_EVENT_SYMBOL_MAX_CHARS
    || /[\u0000-\u001f\u007f]/.test(symbol))) {
    throw new TypeError('product persistence audit symbol is invalid');
  }
  const serialized = canonicalProductPersistenceJson(audit.data, 'product persistence audit data');
  if (Buffer.byteLength(serialized, 'utf8') > PRODUCT_PERSISTENCE_AUDIT_MAX_BYTES) {
    throw new RangeError('product persistence audit data exceeds its 131072-byte bound');
  }
  return Object.freeze({
    kind: audit.kind,
    symbol,
    serialized,
    data: JSON.parse(serialized) as SystemJsonValue,
  });
}

function frozenProductPersistenceResult(
  disposition: ProductPersistenceMutationResult['disposition'],
  ledgerEvent: LedgerEvent | null,
  currentRevision: string | null,
): ProductPersistenceMutationResult {
  if (disposition === 'COMMITTED_NEW' || disposition === 'IDEMPOTENT_REPLAY') {
    if (!ledgerEvent) throw new Error('committed product persistence result is missing its ledger event');
    return Object.freeze({ disposition, ledgerEvent: Object.freeze(ledgerEvent), currentRevision });
  }
  return Object.freeze({ disposition, ledgerEvent: null, currentRevision });
}

function exactProductCommandRow(
  row: Readonly<ProductCommandDbRow>,
  input: Readonly<ProductCommandPersistenceInput>,
  requestPayloadJson: string,
  previewJson: string,
  beforeProjectionJson: string | null,
  afterProjectionJson: string | null,
  resultJson: string | null,
): boolean {
  return row.command_id === input.commandId
    && row.idempotency_key === input.idempotencyKey
    && row.request_digest === input.requestDigest
    && row.command_type === input.commandType
    && row.target_component_id === input.targetComponentId
    && row.authenticated_operator_id === input.authenticatedOperatorId
    && row.reason === input.reason
    && row.required_authority === input.requiredAuthority
    && row.request_payload_json === requestPayloadJson
    && row.preview_digest === input.previewDigest
    && row.preview_json === previewJson
    && row.expected_revision === input.expectedRevision
    && row.resulting_revision === input.resultingRevision
    && row.status === input.status
    && row.created_at_ms === input.createdAtMs
    && row.expires_at_ms === input.expiresAtMs
    && row.completed_at_ms === input.completedAtMs
    && row.correlation_id === input.correlationId
    && row.before_projection_json === beforeProjectionJson
    && row.after_projection_json === afterProjectionJson
    && row.result_json === resultJson
    && Number.isSafeInteger(row.ledger_event_id)
    && (row.ledger_event_id ?? 0) > 0;
}

function exactProductIdentityReferenceRow(
  row: Readonly<ProductIdentityReferenceDbRow>,
  input: Readonly<ProductIdentityReferencePersistenceInput>,
  ownerProjectionJson: string,
): boolean {
  return row.reference_type === input.referenceType
    && row.reference_id === input.referenceId
    && row.owner_id === input.ownerId
    && row.owner_revision === input.ownerRevision
    && row.owner_state === input.ownerState
    && row.resolution_state === input.resolutionState
    && row.correlation_id === input.correlationId
    && row.parent_reference_type === input.parentReferenceType
    && row.parent_reference_id === input.parentReferenceId
    && row.payload_hash === input.payloadHash
    && row.owner_projection_json === ownerProjectionJson
    && row.occurred_at_ms === input.occurredAtMs
    && row.valid_until_ms === input.validUntilMs
    && Number.isSafeInteger(row.ledger_event_id)
    && row.ledger_event_id > 0;
}

function exactProductIncidentRow(
  row: Readonly<ProductIncidentDbRow>,
  input: Readonly<ProductIncidentPersistenceInput>,
): boolean {
  return row.incident_id === input.incidentId
    && row.fingerprint === input.fingerprint
    && row.root_component_id === input.rootComponentId
    && row.severity === input.severity
    && row.capital_relevant === (input.capitalRelevant ? 1 : 0)
    && row.state === input.state
    && row.first_seen_at_ms === input.firstSeenAtMs
    && row.last_seen_at_ms === input.lastSeenAtMs
    && row.event_count === input.eventCount
    && row.acknowledged_at_ms === input.acknowledgedAtMs
    && row.acknowledged_by_operator_id === input.acknowledgedByOperatorId
    && row.resolved_at_ms === input.resolvedAtMs
    && row.correlation_id === input.correlationId
    && Number.isSafeInteger(row.ledger_event_id)
    && row.ledger_event_id > 0;
}

function productIncidentAuditSnapshotMatchesRow(
  value: unknown,
  row: Readonly<ProductIncidentDbRow>,
): boolean {
  if (!plainLedgerRecord(value)) return false;
  return value.incidentId === row.incident_id
    && value.fingerprint === row.fingerprint
    && value.rootComponentId === row.root_component_id
    && value.severity === row.severity
    && value.capitalRelevant === (row.capital_relevant === 1)
    && value.state === row.state
    && value.firstSeenAtMs === row.first_seen_at_ms
    && value.lastSeenAtMs === row.last_seen_at_ms
    && value.eventCount === row.event_count
    && value.acknowledgedAtMs === row.acknowledged_at_ms
    && value.acknowledgedByOperatorId === row.acknowledged_by_operator_id
    && value.resolvedAtMs === row.resolved_at_ms
    && value.correlationId === row.correlation_id;
}

function productIncidentRotationAuditMatchesRow(
  value: unknown,
  row: Readonly<ProductIncidentDbRow>,
): boolean {
  if (!plainLedgerRecord(value)
    || Object.keys(value).length !== PRODUCT_INCIDENT_ROTATION_KEYS.length
    || !PRODUCT_INCIDENT_ROTATION_KEYS.every((key) => Object.hasOwn(value, key))
    || value.schema !== PRODUCT_INCIDENT_ROTATION_SCHEMA
    || value.operation !== 'ROTATE_RESOLVED'
    || value.incidentId !== row.incident_id
    || value.expectedLedgerEventId !== row.ledger_event_id
    || value.reasonCode !== 'BOUNDED_TOP_N_RETENTION'
    || value.retentionLimit !== 200
    || value.externalActionAuthorization !== 'NONE'
    || !plainLedgerRecord(value.snapshot)) {
    return false;
  }
  const snapshot = value.snapshot;
  return Object.keys(snapshot).length === PRODUCT_INCIDENT_SNAPSHOT_KEYS.length
    && PRODUCT_INCIDENT_SNAPSHOT_KEYS.every((key) => Object.hasOwn(snapshot, key))
    && productIncidentAuditSnapshotMatchesRow(snapshot, row)
    && snapshot.ledgerEventId === row.ledger_event_id
    && typeof snapshot.sourceGroup === 'string'
    && PRODUCT_IDENTIFIER.test(snapshot.sourceGroup)
    && Number.isSafeInteger(snapshot.openingRoutingReceiptEventId)
    && Number(snapshot.openingRoutingReceiptEventId) >= 1
    && Number.isSafeInteger(snapshot.openingSourceEventId)
    && Number(snapshot.openingSourceEventId) >= 1
    && Number(snapshot.openingSourceEventId) < Number(snapshot.openingRoutingReceiptEventId)
    && Number.isSafeInteger(snapshot.recoveryRoutingReceiptEventId)
    && snapshot.recoveryRoutingReceiptEventId === row.ledger_event_id
    && Number.isSafeInteger(snapshot.recoverySourceEventId)
    && Number(snapshot.recoverySourceEventId) >= 1
    && Number(snapshot.recoverySourceEventId) < Number(snapshot.recoveryRoutingReceiptEventId)
    && Number(snapshot.openingRoutingReceiptEventId) < Number(snapshot.recoveryRoutingReceiptEventId);
}

function productIncidentAuditMatchesRow(
  row: Readonly<ProductIncidentDbRow>,
  audit: Readonly<LedgerEvent>,
): boolean {
  if (!plainLedgerRecord(audit.data)) return false;
  const data = audit.data;
  if (Object.hasOwn(data, 'incidentId') && data.incidentId !== row.incident_id) return false;

  if (data.schema === PRODUCT_INCIDENT_ROUTE_SCHEMA) {
    const expected = audit.kind === 'product.incident.opened'
      ? Object.freeze({ operation: 'OPEN', sourceKind: 'connection_alert', state: 'OPEN' })
      : audit.kind === 'product.incident.grouped'
        ? Object.freeze({ operation: 'GROUP', sourceKind: 'connection_alert', state: null })
        : audit.kind === 'product.incident.resolved'
          ? Object.freeze({ operation: 'RESOLVE', sourceKind: 'connection_recovered', state: 'RESOLVED' })
          : null;
    return expected !== null
      && audit.symbol === null
      && Object.keys(data).length === PRODUCT_INCIDENT_ROUTE_AUDIT_KEYS.length
      && PRODUCT_INCIDENT_ROUTE_AUDIT_KEYS.every((key) => Object.hasOwn(data, key))
      && data.operation === expected.operation
      && data.sourceEventKind === expected.sourceKind
      && typeof data.sourceGroup === 'string'
      && PRODUCT_IDENTIFIER.test(data.sourceGroup)
      && typeof data.sourceDetail === 'string'
      && data.sourceDetail.length <= 2_000
      && validProductUtcMillis(data.sourceObservedAtMs)
      && Number.isSafeInteger(data.sourceEventId)
      && Number(data.sourceEventId) >= 1
      && (expected.state === null || row.state === expected.state)
      && data.fingerprint === row.fingerprint
      && data.rootComponentId === row.root_component_id
      && data.severity === row.severity
      && data.capitalRelevant === (row.capital_relevant === 1)
      && data.state === row.state
      && data.firstSeenAtMs === row.first_seen_at_ms
      && data.lastSeenAtMs === row.last_seen_at_ms
      && data.eventCount === row.event_count
      && data.acknowledgedAtMs === row.acknowledged_at_ms
      && data.acknowledgedByOperatorId === row.acknowledged_by_operator_id
      && data.resolvedAtMs === row.resolved_at_ms
      && data.correlationId === row.correlation_id
      && data.reasonCode === 'CONNECTION_UNHEALTHY'
      && plainLedgerRecord(data.routing)
      && Object.keys(data.routing).length === 2
      && data.routing.inApp === 'WIRED_LOCAL'
      && data.routing.externalPaging === 'NOT_CONFIGURED'
      && data.externalActionAuthorization === 'NONE'
      && (expected.sourceKind === 'connection_recovered'
        ? data.sourceStatus === 'operational'
        : data.sourceStatus === 'degraded' || data.sourceStatus === 'outage');
  }

  if (PRODUCT_INCIDENT_ACK_SCHEMAS.has(String(data.schema))) {
    return audit.kind === PRODUCT_INCIDENT_ACK_EVENT_KIND
      && audit.symbol === null
      && row.state === 'ACKNOWLEDGED'
      && data.operation === 'ACKNOWLEDGE'
      && data.acknowledgedAtMs === row.acknowledged_at_ms
      && data.incidentCorrelationId === row.correlation_id
      && Number.isSafeInteger(data.expectedLedgerEventId)
      && Number(data.expectedLedgerEventId) >= 1
      && Number(data.expectedLedgerEventId) < audit.id
      && plainLedgerRecord(data.actor)
      && data.actor.id === row.acknowledged_by_operator_id
      && productIncidentAuditSnapshotMatchesRow(data.after, row);
  }

  return true;
}

function productIncidentRecord(
  row: Readonly<ProductIncidentDbRow>,
  audit: Readonly<LedgerEvent>,
): Readonly<ProductIncidentRecord> {
  if (!Number.isSafeInteger(row.ledger_event_id) || row.ledger_event_id < 1
    || audit.id !== row.ledger_event_id) {
    throw new Error('durable product incident audit reference is invalid');
  }
  assertProductIdentifier(row.incident_id, 'durable product incidentId');
  assertProductIdentifier(row.fingerprint, 'durable product incident fingerprint');
  assertProductIdentifier(row.root_component_id, 'durable product incident rootComponentId');
  assertProductIncidentSeverity(row.severity, 'durable product incident severity');
  assertProductIncidentState(row.state, 'durable product incident state');
  if (row.capital_relevant !== 0 && row.capital_relevant !== 1) {
    throw new Error('durable product incident capital relevance is invalid');
  }
  assertProductUtcMillis(row.first_seen_at_ms, 'durable product incident firstSeenAtMs');
  assertProductUtcMillis(row.last_seen_at_ms, 'durable product incident lastSeenAtMs');
  assertProductPositiveInteger(row.event_count, 'durable product incident eventCount');
  if (row.last_seen_at_ms < row.first_seen_at_ms) throw new Error('durable product incident chronology is invalid');
  if ((row.acknowledged_at_ms === null) !== (row.acknowledged_by_operator_id === null)) {
    throw new Error('durable product incident acknowledgement is invalid');
  }
  if (row.acknowledged_at_ms !== null) {
    assertProductUtcMillis(row.acknowledged_at_ms, 'durable product incident acknowledgedAtMs');
    if (row.acknowledged_at_ms < row.first_seen_at_ms) throw new Error('durable product incident acknowledgement chronology is invalid');
  }
  assertProductOptionalIdentifier(row.acknowledged_by_operator_id, 'durable product incident acknowledgedByOperatorId');
  if (row.resolved_at_ms !== null) {
    assertProductUtcMillis(row.resolved_at_ms, 'durable product incident resolvedAtMs');
    if (row.resolved_at_ms < row.first_seen_at_ms) throw new Error('durable product incident resolution chronology is invalid');
  }
  if (!validProductIncidentLifecycle(
    row.state,
    row.last_seen_at_ms,
    row.acknowledged_at_ms,
    row.acknowledged_by_operator_id,
    row.resolved_at_ms,
  )) {
    throw new Error('durable product incident state fields are inconsistent');
  }
  assertProductIdentifier(row.correlation_id, 'durable product incident correlationId');
  if (!productIncidentAuditMatchesRow(row, audit)) {
    throw new Error('durable product incident audit relationship is invalid');
  }
  return Object.freeze({
    incidentId: row.incident_id,
    fingerprint: row.fingerprint,
    rootComponentId: row.root_component_id,
    severity: row.severity,
    capitalRelevant: row.capital_relevant === 1,
    state: row.state,
    firstSeenAtMs: row.first_seen_at_ms,
    lastSeenAtMs: row.last_seen_at_ms,
    eventCount: row.event_count,
    acknowledgedAtMs: row.acknowledged_at_ms,
    acknowledgedByOperatorId: row.acknowledged_by_operator_id,
    resolvedAtMs: row.resolved_at_ms,
    correlationId: row.correlation_id,
    ledgerEventId: row.ledger_event_id,
    lastAudit: Object.freeze({
      id: audit.id,
      ts: audit.ts,
      kind: audit.kind,
      symbol: audit.symbol,
      data: audit.data === null
        ? null
        : JSON.parse(canonicalProductPersistenceJson(audit.data, 'durable product incident audit data')) as SystemJsonValue,
    }),
  });
}

function exactProductBootReleaseRow(
  row: Readonly<ProductBootReleaseDbRow>,
  input: Readonly<ProductBootReleasePersistenceInput>,
): boolean {
  return row.operation_id === input.operationId
    && row.operation_type === input.operationType
    && row.generation === input.generation
    && row.tested_commit === input.testedCommit
    && row.deployed_commit === input.deployedCommit
    && row.config_revision === input.configRevision
    && row.schema_revision === input.schemaRevision
    && row.model_revision === input.modelRevision
    && row.started_at_ms === input.startedAtMs
    && row.completed_at_ms === input.completedAtMs
    && row.clean === (input.clean === null ? null : input.clean ? 1 : 0)
    && row.blocker_code === input.blockerCode
    && row.correlation_id === input.correlationId
    && Number.isSafeInteger(row.ledger_event_id)
    && row.ledger_event_id > 0;
}

function frozenSystemTraceEvent(event: Readonly<SystemTraceEvent>): Readonly<SystemTraceEvent> {
  return Object.freeze({
    ...event,
    releaseStatuses: Object.freeze([...event.releaseStatuses]),
    failure: event.failure === null ? null : Object.freeze({ ...event.failure }),
    referenceIds: Object.freeze([...event.referenceIds]),
    lossCodes: Object.freeze([...event.lossCodes]),
  });
}

/**
 * Selects only a canonical System Integration audit carrying an already-owned
 * material decision. The trace is copied with its actual persistence time;
 * no readiness, severity, incident, or strategy truth is derived here.
 */
function prepareProductOperatorEvent(
  kind: string,
  data: unknown,
  persistedAtMs: number,
): Readonly<PreparedProductOperatorEvent> | null {
  if (kind !== SYSTEM_INTEGRATION_EVENT_KIND || !plainLedgerRecord(data)) return null;
  const hasRiskDecision = Object.hasOwn(data, 'riskDecision');
  if (!exactLedgerFields(data, [
    'schema',
    'version',
    'auditKind',
    'correlationId',
    'occurredAtMs',
    'checkpointRevision',
    'checkpointChecksum',
    'trace',
    ...(hasRiskDecision ? ['riskDecision'] : []),
  ])) return null;
  if (data.schema !== SYSTEM_INTEGRATION_AUDIT_SCHEMA
    || data.version !== 1
    || typeof data.auditKind !== 'string'
    || !SYSTEM_INTEGRATION_AUDIT_KINDS.has(data.auditKind)
    || !Number.isSafeInteger(data.checkpointRevision)
    || (data.checkpointRevision as number) < 0
    || typeof data.checkpointChecksum !== 'string'
    || !SYSTEM_CHECKPOINT_CHECKSUM.test(data.checkpointChecksum)
    || !plainLedgerRecord(data.trace)) return null;

  if (validateSystemTraceEvent(data.trace).length > 0
    || validatePersistedSystemTraceEvent(data.trace).length > 0) return null;
  const source = data.trace as unknown as Readonly<SystemTraceEvent>;
  if (!MATERIAL_SYSTEM_TRACE_KINDS.has(source.kind)
    || source.id.length > 160
    || source.persistedAtMs !== null
    || data.correlationId !== source.correlationId
    || data.occurredAtMs !== source.occurredAtMs) return null;
  if (hasRiskDecision) {
    const riskDecision = data.riskDecision;
    if (source.kind !== 'RISK'
      || !plainLedgerRecord(riskDecision)
      || !exactLedgerFields(riskDecision, ['schema', 'recordId', 'verdict'])
      || riskDecision.schema !== SYSTEM_RISK_DECISION_AUDIT_SCHEMA
      || typeof riskDecision.recordId !== 'string'
      || !PRODUCT_IDENTIFIER.test(riskDecision.recordId)
      || !plainLedgerRecord(riskDecision.verdict)
      || riskDecision.verdict.correlationId !== source.correlationId) return null;
    const serializedRiskDecision = JSON.stringify(riskDecision);
    if (Buffer.byteLength(serializedRiskDecision, 'utf8') > PRODUCT_OPERATOR_EVENT_MAX_BYTES
      || PRODUCT_SENSITIVE_TEXT.test(serializedRiskDecision)) return null;
  }

  const event = frozenSystemTraceEvent({ ...source, persistedAtMs });
  if (validateSystemTraceEvent(event).length > 0
    || validatePersistedSystemTraceEvent(event).length > 0) return null;
  const serializedProjection = JSON.stringify(event);
  if (Buffer.byteLength(serializedProjection, 'utf8') > PRODUCT_OPERATOR_EVENT_MAX_BYTES) {
    throw new RangeError('product operator event projection exceeds its byte bound');
  }
  return Object.freeze({
    eventId: event.id,
    componentId: event.componentId,
    correlationId: event.correlationId,
    occurredAtMs: event.occurredAtMs,
    persistedAtMs,
    serializedProjection,
    event,
  });
}

function parseSqliteCursor(value: string): bigint {
  if (typeof value !== 'string' || !SQLITE_CURSOR.test(value)) {
    throw new TypeError('product operator event cursor must be a canonical non-negative decimal');
  }
  const cursor = BigInt(value);
  if (cursor > SQLITE_MAX_ROWID) throw new RangeError('product operator event cursor exceeds SQLite rowid');
  return cursor;
}

function parseProductOperatorEventRow(row: ProductOperatorEventDbRow): Readonly<SystemTraceEvent> | null {
  if (!Number.isSafeInteger(row.ledger_event_id) || row.ledger_event_id < 1
    || !Number.isSafeInteger(row.occurred_at_ms) || row.occurred_at_ms < 0
    || !Number.isSafeInteger(row.persisted_at_ms) || row.persisted_at_ms < 0
    || !Number.isSafeInteger(row.ledger_ts) || (row.ledger_ts ?? -1) < 0
    || row.ledger_kind !== SYSTEM_INTEGRATION_EVENT_KIND
    || typeof row.ledger_data !== 'string') return null;
  try {
    const audit = JSON.parse(row.ledger_data) as unknown;
    const prepared = prepareProductOperatorEvent(row.ledger_kind, audit, row.ledger_ts as number);
    if (!prepared
      || prepared.eventId !== row.event_id
      || prepared.componentId !== row.component_id
      || prepared.correlationId !== row.correlation_id
      || prepared.occurredAtMs !== row.occurred_at_ms
      || prepared.persistedAtMs !== row.persisted_at_ms
      || prepared.serializedProjection !== row.material_projection_json) return null;
    return prepared.event;
  } catch {
    return null;
  }
}

function frozenProductOperatorEventPage(
  requestedAfterCursor: string,
  retainedFromCursor: string | null,
  highWaterCursor: string,
  continuity: LedgerProductOperatorEventPage['continuity'],
  truncated: boolean,
  items: readonly Readonly<LedgerProductOperatorEventRecord>[],
): Readonly<LedgerProductOperatorEventPage> {
  return Object.freeze({
    requestedAfterCursor,
    retainedFromCursor,
    highWaterCursor,
    continuity,
    truncated,
    items: Object.freeze([...items]),
  });
}

function unprovenProductOperatorEventPage(
  requestedAfterCursor: string,
  retainedFromCursor: string | null,
  highWaterCursor: string,
): Readonly<LedgerProductOperatorEventPage> {
  return frozenProductOperatorEventPage(
    requestedAfterCursor,
    retainedFromCursor,
    highWaterCursor,
    'UNPROVEN',
    false,
    [],
  );
}

function parseEvent(r: EventDbRow): LedgerEvent {
  let data: unknown = null;
  if (r.data) {
    try {
      data = JSON.parse(r.data) as unknown;
    } catch {
      data = { unavailable: true, reason: 'invalid_json' };
    }
  }
  const metadata = prepareStoredLedgerEventMetadata({
    severity: r.severity,
    source: r.source,
    strategy: r.strategy,
    status: r.status,
    reason: r.reason,
    message: r.message,
    correlation: r.correlation,
    createdAt: r.created_at,
  });
  return {
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    symbol: r.symbol,
    data,
    severity: metadata.severity,
    source: metadata.source,
    strategy: metadata.strategy,
    status: metadata.status,
    reason: metadata.reason,
    message: metadata.message,
    correlation: metadata.correlation,
    createdAt: metadata.createdAt as number,
  };
}

function parseUnresolvedOrderRow(row: UnresolvedOrderDbRow): UnresolvedOrderRequest[] {
  try {
    const data = JSON.parse(row.data ?? '') as {
      reservationId?: unknown;
      reservedNotionalUsd?: unknown;
      params?: { newClientOrderId?: unknown };
    };
    const recovery = row.last_recovery_data
      ? JSON.parse(row.last_recovery_data) as { state?: unknown; detail?: unknown }
      : null;
    const reservationId = typeof data.reservationId === 'string' ? data.reservationId : '';
    const clientOrderId = typeof data.params?.newClientOrderId === 'string' ? data.params.newClientOrderId : '';
    const reservedNotionalUsd = data.reservedNotionalUsd;
    if (
      !Number.isSafeInteger(row.request_id)
      || row.request_id <= 0
      || !Number.isSafeInteger(row.requested_at)
      || row.requested_at <= 0
      || !/^[A-Z0-9]{4,20}$/.test(row.symbol)
      || !/^[0-9a-f-]{16,64}$/i.test(reservationId)
      || !/^[A-Za-z0-9_-]{1,36}$/.test(clientOrderId)
      || typeof reservedNotionalUsd !== 'number'
      || !Number.isFinite(reservedNotionalUsd)
      || reservedNotionalUsd <= 0
    ) {
      return [];
    }
    const state = recovery?.state;
    const recoveryState: OrderRecoveryState = state === 'reconciling'
      || state === 'operator_review_required'
      || state === 'held_by_operator'
      ? state
      : 'pending';
    return [{
      requestId: row.request_id,
      requestedAt: row.requested_at,
      symbol: row.symbol,
      reservationId,
      clientOrderId,
      reservedNotionalUsd,
      recoveryState,
      recoveryAttempts: boundedInteger(row.recovery_attempts, 0, Number.MAX_SAFE_INTEGER, 0),
      lastRecoveryAt: Number.isSafeInteger(row.last_recovery_at) && (row.last_recovery_at ?? 0) > 0
        ? row.last_recovery_at
        : null,
      lastRecoveryDetail: typeof recovery?.detail === 'string'
        ? recovery.detail.replace(/[\r\n\0]/g, ' ').trim().slice(0, 320) || null
        : null,
    }];
  } catch {
    return [];
  }
}

function strictMutationCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('FINANCIAL_MUTATION_COUNT_MALFORMED');
  }
  return value;
}

function financialRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateFinancialMutationEvent(kind: string, symbol: string | null, data: unknown): void {
  if (!['order_request', 'order_response', 'loan_request', 'loan_response'].includes(kind)) return;
  if (!financialRecord(data)) throw new Error('FINANCIAL_MUTATION_EVENT_MALFORMED');

  if (kind === 'order_request' || kind === 'order_response') {
    if (typeof symbol !== 'string' || !/^[A-Z0-9]{4,20}$/.test(symbol)) {
      throw new Error('ORDER_MUTATION_SYMBOL_MALFORMED');
    }
    if (typeof data.reservationId !== 'string' || !/^[0-9a-f-]{16,64}$/i.test(data.reservationId)) {
      throw new Error('ORDER_MUTATION_RESERVATION_ID_MALFORMED');
    }
    if (kind === 'order_request') {
      if (
        !financialRecord(data.params)
        || typeof data.params.newClientOrderId !== 'string'
        || !/^[A-Za-z0-9_-]{1,36}$/.test(data.params.newClientOrderId)
        || typeof data.reservedNotionalUsd !== 'number'
        || !Number.isFinite(data.reservedNotionalUsd)
        || data.reservedNotionalUsd <= 0
      ) {
        throw new Error('ORDER_REQUEST_EVIDENCE_MALFORMED');
      }
      return;
    }
    if (typeof data.outcome !== 'string' || !ORDER_MUTATION_OUTCOMES.has(data.outcome)) {
      throw new Error('ORDER_RESPONSE_OUTCOME_MALFORMED');
    }
    return;
  }

  if (symbol !== null) throw new Error('LOAN_MUTATION_SYMBOL_MALFORMED');
  if (typeof data.mutationId !== 'string' || data.mutationId.length < 1 || data.mutationId.length > 128) {
    throw new Error('LOAN_MUTATION_ID_MALFORMED');
  }
  if (kind === 'loan_request') {
    if (
      typeof data.actionKey !== 'string'
      || data.actionKey.length < 1
      || data.actionKey.length > 160
      || typeof data.riskIncreasing !== 'boolean'
    ) {
      throw new Error('LOAN_REQUEST_EVIDENCE_MALFORMED');
    }
    return;
  }
  if (typeof data.outcome !== 'string' || !LOAN_MUTATION_OUTCOMES.has(data.outcome)) {
    throw new Error('LOAN_RESPONSE_OUTCOME_MALFORMED');
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(/[\r\n\0]/g, ' ').trim().slice(0, maxLength) : '';
}

function nullableBoundedText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return boundedText(value, maxLength) || null;
}

function eventSearchPattern(value: string): string | null {
  const literal = value.normalize('NFKC').trim();
  if (literal.length < 2 || literal.length > EVENT_SEARCH_MAX_CHARS) return null;
  const escaped = literal.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

const EXACT_ZERO = normalizeNonNegativeExactDecimal('0');

function canonicalExactFillInput(input: FillInput): Readonly<FillInput> {
  if (typeof input.symbol !== 'string' || !/^[A-Z0-9]{1,20}$/.test(input.symbol)) {
    throw new TypeError('fill symbol is invalid');
  }
  if (!Number.isSafeInteger(input.tradeId) || input.tradeId < 0) {
    throw new TypeError('fill trade id is invalid');
  }
  if (input.orderId !== null && (!Number.isSafeInteger(input.orderId) || input.orderId < 0)) {
    throw new TypeError('fill order id is invalid');
  }
  if (input.side !== 'BUY' && input.side !== 'SELL') throw new TypeError('fill side is invalid');
  if (input.commissionAsset !== null && (typeof input.commissionAsset !== 'string'
    || input.commissionAsset.length < 1 || input.commissionAsset.length > 80
    || /[\u0000-\u001f\u007f]/.test(input.commissionAsset))) {
    throw new TypeError('fill commission asset is invalid');
  }
  if (!Number.isSafeInteger(input.ts) || input.ts <= 0) throw new TypeError('fill timestamp is invalid');
  if (typeof input.source !== 'string' || input.source.length < 1 || input.source.length > 64
    || /[\u0000-\u001f\u007f]/.test(input.source)) {
    throw new TypeError('fill source is invalid');
  }
  const price = normalizeNonNegativeExactDecimal(input.price);
  const qty = normalizeNonNegativeExactDecimal(input.qty);
  const quoteQty = normalizeNonNegativeExactDecimal(input.quoteQty);
  const commission = normalizeNonNegativeExactDecimal(input.commission);
  if (compareExactDecimals(price, EXACT_ZERO) <= 0
    || compareExactDecimals(qty, EXACT_ZERO) <= 0
    || compareExactDecimals(quoteQty, EXACT_ZERO) <= 0) {
    throw new TypeError('fill price and quantities must be positive');
  }
  return Object.freeze({
    symbol: input.symbol,
    tradeId: input.tradeId,
    orderId: input.orderId,
    side: input.side,
    price,
    qty,
    quoteQty,
    commission,
    commissionAsset: input.commissionAsset,
    ts: input.ts,
    source: input.source,
  });
}

function sameFillTruth(existing: Readonly<FillRow>, incoming: Readonly<FillInput>): boolean {
  return sameFillIdentityMetadata(existing, incoming)
    && existing.price === incoming.price
    && existing.qty === incoming.qty
    && existing.quoteQty === incoming.quoteQty
    && existing.commission === incoming.commission;
}

function sameFillIdentityMetadata(existing: Readonly<FillRow>, incoming: Readonly<FillInput>): boolean {
  return existing.symbol === incoming.symbol
    && existing.tradeId === incoming.tradeId
    && existing.orderId === incoming.orderId
    && existing.side === incoming.side
    && existing.commissionAsset === incoming.commissionAsset
    && existing.ts === incoming.ts;
}

function parseFill(r: FillDbRow): FillRow {
  if (r.money_encoding !== 'EXACT_DECIMAL' && r.money_encoding !== 'LEGACY_BINARY64') {
    throw new Error('LEDGER_FILL_ENCODING_MALFORMED');
  }
  const canonical = canonicalExactFillInput({
    symbol: r.symbol,
    tradeId: r.trade_id,
    orderId: r.order_id,
    side: r.side,
    price: r.price as NonNegativeDecimal,
    qty: r.qty as NonNegativeDecimal,
    quoteQty: r.quote_qty as NonNegativeDecimal,
    commission: r.commission as NonNegativeDecimal,
    commissionAsset: r.commission_asset,
    ts: r.ts,
    source: r.source,
  });
  if (canonical.price !== r.price || canonical.qty !== r.qty
    || canonical.quoteQty !== r.quote_qty || canonical.commission !== r.commission) {
    throw new Error('LEDGER_FILL_DECIMAL_NON_CANONICAL');
  }
  return Object.freeze({ ...canonical, moneyEncoding: r.money_encoding });
}

function displayFill(fill: Readonly<FillRow>): FillDisplayRow {
  const price = Number(fill.price);
  const qty = Number(fill.qty);
  const quoteQty = Number(fill.quoteQty);
  const commission = Number(fill.commission);
  if (![price, qty, quoteQty, commission].every(Number.isFinite)) {
    throw new Error('LEDGER_FILL_DISPLAY_PROJECTION_UNAVAILABLE');
  }
  return {
    symbol: fill.symbol,
    tradeId: fill.tradeId,
    orderId: fill.orderId,
    side: fill.side,
    price,
    qty,
    quoteQty,
    commission,
    commissionAsset: fill.commissionAsset,
    ts: fill.ts,
    source: fill.source,
  };
}
