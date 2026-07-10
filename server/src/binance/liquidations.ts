/* Liquidation collector — Binance publishes NO liquidation history (the old
 * allForceOrders REST endpoint is dead), so the cockpit records its own truth
 * from the public !forceOrder@arr stream: every USD-M forced order, every
 * symbol, bucketed to 5 minutes (kept 48h) and 1 hour (kept 90d), persisted
 * to disk so restarts lose nothing. Convention: a SELL force order closes a
 * LONG position (long liquidation); BUY closes a SHORT. */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const DISK = path.resolve(process.cwd(), process.env.LIQ_CACHE ?? 'data/liquidations.json');
const FIVE_MIN = 5 * 60_000;
const HOUR = 60 * 60_000;
const KEEP_5M_MS = 48 * HOUR;
const KEEP_1H_MS = 90 * 24 * HOUR;

interface Bucket {
  long: number; // USD notional of liquidated longs
  short: number;
}

interface SymbolBook {
  m5: Record<string, Bucket>; // bucketTs -> bucket
  h1: Record<string, Bucket>;
}

const books = new Map<string, SymbolBook>();
let recordingSince = Date.now();
let eventsSeen = 0;
let wsState: 'connecting' | 'live' | 'down' = 'connecting';

try {
  const stored = JSON.parse(fs.readFileSync(DISK, 'utf8')) as { since: number; books: Record<string, SymbolBook> };
  recordingSince = stored.since;
  for (const [sym, book] of Object.entries(stored.books)) books.set(sym, book);
} catch {
  // fresh start
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(DISK), { recursive: true });
    fs.writeFileSync(DISK, JSON.stringify({ since: recordingSince, books: Object.fromEntries(books) }));
  } catch {
    // best effort
  }
}

function prune(): void {
  const now = Date.now();
  for (const book of books.values()) {
    for (const ts of Object.keys(book.m5)) if (now - Number(ts) > KEEP_5M_MS) delete book.m5[ts];
    for (const ts of Object.keys(book.h1)) if (now - Number(ts) > KEEP_1H_MS) delete book.h1[ts];
  }
}

function record(symbol: string, side: 'long' | 'short', usd: number, ts: number): void {
  let book = books.get(symbol);
  if (!book) {
    book = { m5: {}, h1: {} };
    books.set(symbol, book);
  }
  const k5 = String(Math.floor(ts / FIVE_MIN) * FIVE_MIN);
  const k1 = String(Math.floor(ts / HOUR) * HOUR);
  book.m5[k5] = book.m5[k5] ?? { long: 0, short: 0 };
  book.h1[k1] = book.h1[k1] ?? { long: 0, short: 0 };
  book.m5[k5][side] += usd;
  book.h1[k1][side] += usd;
  eventsSeen++;
}

interface ForceOrderMsg {
  o?: { s: string; S: string; q: string; ap: string; T: number };
}

let ws: WebSocket | null = null;

function connect(): void {
  wsState = 'connecting';
  // Binance's legacy /ws futures host still handshakes but no longer emits
  // market frames. The engine and this persistent recorder must use the
  // current public market socket or the UI gets live 15m totals with an empty
  // historical liquidation series.
  ws = new WebSocket('wss://fstream.binance.com/market/ws/!forceOrder@arr');
  ws.on('open', () => { wsState = 'live'; });
  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(String(raw)) as ForceOrderMsg;
      const o = msg.o;
      if (!o?.s) return;
      const usd = Number(o.q) * Number(o.ap);
      if (!Number.isFinite(usd) || usd <= 0) return;
      record(o.s, o.S === 'SELL' ? 'long' : 'short', usd, Number(o.T) || Date.now());
    } catch {
      // malformed frame
    }
  });
  ws.on('close', () => { wsState = 'down'; setTimeout(connect, 5_000); });
  ws.on('error', () => { ws?.close(); });
}

export function startLiquidationCollector(): void {
  connect();
  setInterval(() => { prune(); persist(); }, 5 * 60_000);
}

export interface LiqPoint {
  t: number;
  long: number;
  short: number;
}

export function liquidationSeries(symbol: string, bucketMs: number): { since: number; state: string; points: LiqPoint[] } {
  const book = books.get(symbol.toUpperCase());
  const points: LiqPoint[] = [];
  if (book) {
    const source = bucketMs < HOUR ? book.m5 : book.h1;
    const nativeMs = bucketMs < HOUR ? FIVE_MIN : HOUR;
    const agg = new Map<number, Bucket>();
    for (const [ts, b] of Object.entries(source)) {
      const k = Math.floor(Number(ts) / bucketMs) * bucketMs;
      const cur = agg.get(k) ?? { long: 0, short: 0 };
      cur.long += b.long;
      cur.short += b.short;
      agg.set(k, cur);
    }
    void nativeMs;
    for (const [t, b] of [...agg.entries()].sort((a, b2) => a[0] - b2[0])) points.push({ t, long: b.long, short: b.short });
  }
  return { since: recordingSince, state: wsState, points };
}

export function liquidationStats(): { state: string; since: number; symbols: number; events: number } {
  return { state: wsState, since: recordingSince, symbols: books.size, events: eventsSeen };
}
