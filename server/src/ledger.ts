import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface LedgerEvent {
  id: number;
  ts: number;
  kind: string;
  symbol: string | null;
  data: unknown;
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

interface EventDbRow {
  id: number;
  ts: number;
  kind: string;
  symbol: string | null;
  data: string | null;
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

export class Ledger extends EventEmitter {
  private db: Database.Database;

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
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_kind ON events (kind, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_fills_ts ON fills (ts DESC);
    `);
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

  recentEvents(limit = 100, kind?: string): LedgerEvent[] {
    const rows = (
      kind
        ? this.db.prepare('SELECT * FROM events WHERE kind = ? ORDER BY id DESC LIMIT ?').all(kind, limit)
        : this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit)
    ) as EventDbRow[];
    return rows.map(parseEvent);
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

  listFills(limit = 200): FillRow[] {
    const rows = this.db
      .prepare('SELECT * FROM fills ORDER BY ts DESC LIMIT ?')
      .all(limit) as FillDbRow[];
    return rows.map(parseFill);
  }

  allFillsAsc(): FillRow[] {
    const rows = this.db.prepare('SELECT * FROM fills ORDER BY ts ASC').all() as FillDbRow[];
    return rows.map(parseFill);
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
}

function parseEvent(r: EventDbRow): LedgerEvent {
  return {
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    symbol: r.symbol,
    data: r.data ? (JSON.parse(r.data) as unknown) : null,
  };
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
