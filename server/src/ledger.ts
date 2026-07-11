import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const EVENT_RESULT_MAX = 2_000;
const EVENT_SEARCH_MAX_CHARS = 64;
const EVENT_SEARCH_SCAN_ROWS = 25_000;
const BROWSER_SESSION_MAX = 2_000;
const BROWSER_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const HEALTH_PROBE_CACHE_MS = 5_000;
const EPHEMERAL_EVENT_BATCH_MAX = 10_000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

export interface LedgerEvent {
  id: number;
  ts: number;
  kind: string;
  symbol: string | null;
  data: unknown;
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

export interface LedgerEventInput {
  kind: string;
  symbol?: string | null;
  data?: unknown;
}

export interface FillRow {
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
  price: number;
  qty: number;
  quote_qty: number;
  commission: number;
  commission_asset: string | null;
  ts: number;
  source: string;
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

export class Ledger extends EventEmitter {
  private db: Database.Database;
  private healthProbeCache: { checkedAt: number; writable: boolean } | null = null;
  private closed = false;

  constructor(dataDir = path.resolve(process.cwd(), 'data')) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, 'cosmos.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        symbol TEXT,
        data TEXT
      );
      CREATE TABLE IF NOT EXISTS fills (
        symbol TEXT NOT NULL,
        trade_id INTEGER NOT NULL,
        order_id INTEGER,
        side TEXT NOT NULL,
        price REAL NOT NULL,
        qty REAL NOT NULL,
        quote_qty REAL NOT NULL,
        commission REAL NOT NULL DEFAULT 0,
        commission_asset TEXT,
        ts INTEGER NOT NULL,
        source TEXT NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_kind ON events (kind, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_fills_ts ON fills (ts DESC);
      CREATE INDEX IF NOT EXISTS idx_browser_sessions_last_seen ON browser_sessions (last_seen DESC);
    `);
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
  }

  logEvent(kind: string, symbol?: string | null, data?: unknown): LedgerEvent {
    const ts = Date.now();
    const info = this.db
      .prepare('INSERT INTO events (ts, kind, symbol, data) VALUES (?, ?, ?, ?)')
      .run(ts, kind, symbol ?? null, data === undefined ? null : JSON.stringify(data));
    const ev: LedgerEvent = {
      id: Number(info.lastInsertRowid),
      ts,
      kind,
      symbol: symbol ?? null,
      data: data ?? null,
    };
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
    const ts = Date.now();
    const insert = this.db.prepare('INSERT INTO events (ts, kind, symbol, data) VALUES (?, ?, ?, ?)');
    const commit = this.db.transaction(() => records.map((record) => {
      if (typeof record.kind !== 'string' || !/^[a-z0-9_.-]{1,64}$/.test(record.kind)) {
        throw new Error('invalid atomic ledger event kind');
      }
      const serialized = record.data === undefined ? null : JSON.stringify(record.data);
      const info = insert.run(ts, record.kind, record.symbol ?? null, serialized);
      return {
        id: Number(info.lastInsertRowid),
        ts,
        kind: record.kind,
        symbol: record.symbol ?? null,
        data: record.data ?? null,
      } satisfies LedgerEvent;
    }));
    const events = commit();
    for (const event of events) {
      try {
        this.emit('event', event);
      } catch {
        // SQLite is the source of truth. A listener failure after commit must
        // not make the caller retry or reinterpret a financial outcome.
      }
    }
    return events;
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
      clauses.push("(data LIKE ? ESCAPE '\\' OR kind LIKE ? ESCAPE '\\' OR symbol LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
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
      clauses.push("(data LIKE ? ESCAPE '\\' OR kind LIKE ? ESCAPE '\\' OR symbol LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }
    if (since !== undefined && Number.isFinite(since)) { clauses.push('ts >= ?'); params.push(since); }
    if (until !== undefined && Number.isFinite(until)) { clauses.push('ts < ?'); params.push(until); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM events ${where}`).get(...params) as { count?: number } | undefined;
    return Number(row?.count) || 0;
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
   * Requests from an earlier UTC day that still have no correlated response.
   * They do not belong in today's notional sum, but they must keep live
   * admission fail-closed until exchange reconciliation proves an outcome.
   */
  unresolvedOrderRequestsBefore(ts: number): number {
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
        )
      ORDER BY ${orderBy}
      LIMIT ?
    `).all(safeCursor, safeLimit) as UnresolvedOrderDbRow[];
    return rows.flatMap(parseUnresolvedOrderRow);
  }

  unresolvedOrderRequest(reservationId: string, clientOrderId: string): UnresolvedOrderRequest | null {
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
        )
      ORDER BY request.id DESC
      LIMIT 1
    `).get(reservationId, clientOrderId) as UnresolvedOrderDbRow | undefined;
    return row ? parseUnresolvedOrderRow(row)[0] ?? null : null;
  }

  unresolvedLoanMutations(): { mutationId: string; actionKey: string; riskIncreasing: boolean }[] {
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
            AND COALESCE(json_extract(response.data, '$.outcome'), 'unknown') != 'unknown'
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

  /** Returns true if the fill was new (not a duplicate). */
  insertFill(f: FillRow): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO fills
         (symbol, trade_id, order_id, side, price, qty, quote_qty, commission, commission_asset, ts, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        f.symbol,
        f.tradeId,
        f.orderId,
        f.side,
        f.price,
        f.qty,
        f.quoteQty,
        f.commission,
        f.commissionAsset,
        f.ts,
        f.source
      );
    return info.changes > 0;
  }

  listFills(limit = 200, symbol?: string): FillRow[] {
    const rows = (
      symbol
        ? this.db.prepare('SELECT * FROM fills WHERE symbol = ? ORDER BY ts DESC LIMIT ?').all(symbol, limit)
        : this.db.prepare('SELECT * FROM fills ORDER BY ts DESC LIMIT ?').all(limit)
    ) as FillDbRow[];
    return rows.map(parseFill);
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
    const rows = this.db.prepare('SELECT * FROM fills ORDER BY ts ASC').all() as FillDbRow[];
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
  ): LedgerEvent {
    const ts = Date.now();
    const serialized = data === undefined ? null : JSON.stringify(data);
    const commit = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, value);
      return this.db
        .prepare('INSERT INTO events (ts, kind, symbol, data) VALUES (?, ?, ?, ?)')
        .run(ts, kind, symbol, serialized);
    });
    const info = commit();
    const event: LedgerEvent = {
      id: Number(info.lastInsertRowid),
      ts,
      kind,
      symbol,
      data: data ?? null,
    };
    this.emit('event', event);
    return event;
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

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.healthProbeCache = null;
    this.removeAllListeners();
    if (this.db.open) this.db.close();
  }
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
  return {
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    symbol: r.symbol,
    data,
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

function parseFill(r: FillDbRow): FillRow {
  return {
    symbol: r.symbol,
    tradeId: r.trade_id,
    orderId: r.order_id,
    side: r.side,
    price: r.price,
    qty: r.qty,
    quoteQty: r.quote_qty,
    commission: r.commission,
    commissionAsset: r.commission_asset,
    ts: r.ts,
    source: r.source,
  };
}
