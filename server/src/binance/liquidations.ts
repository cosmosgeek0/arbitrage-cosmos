/* Liquidation collector — Binance publishes no liquidation history, so the
 * cockpit records its own truth from the public !forceOrder@arr stream. A SELL
 * force order closes a LONG position; BUY closes a SHORT. */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket, { type ClientOptions, type RawData } from 'ws';

const DISK = path.resolve(process.cwd(), process.env.LIQ_CACHE ?? 'data/liquidations.json');
const FIVE_MIN = 5 * 60_000;
const HOUR = 60 * 60_000;
const KEEP_5M_MS = 48 * HOUR;
const KEEP_1H_MS = 90 * 24 * HOUR;
const BINANCE_EPOCH_MS = Date.UTC(2017, 0, 1);
const MAX_SYMBOLS = 4_096;
const MAX_FRAME_EVENTS = 128;
const MAX_RECENT_EVENT_KEYS = 10_000;
const RECENT_EVENT_TTL_MS = HOUR;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 30_000;
const DEFAULT_STABLE_CONNECTION_MS = 60_000;
const DEFAULT_MAINTENANCE_MS = 5 * 60_000;
const DEFAULT_LIVENESS_CHECK_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 90_000;
const DEFAULT_MAX_LIFETIME_MS = 23 * HOUR;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_SERIALIZED_BUCKET_ROWS = 250_000;
const MAX_M5_BUCKETS_PER_SYMBOL = Math.ceil(KEEP_5M_MS / FIVE_MIN) + 2;
const MAX_H1_BUCKETS_PER_SYMBOL = Math.ceil(KEEP_1H_MS / HOUR) + 2;
const PERSIST_DEBOUNCE_MS = 500;

interface Bucket {
  long: number;
  short: number;
}

interface SymbolBook {
  m5: Record<string, Bucket>;
  h1: Record<string, Bucket>;
}

interface ForceOrderMsg {
  e?: string;
  E?: number;
  o?: {
    s?: string;
    S?: string;
    q?: string;
    z?: string;
    l?: string;
    ap?: string;
    T?: number;
  };
}

type SocketFactory = (url: string, options: ClientOptions) => WebSocket;

export interface LiquidationCollectorOptions {
  socketFactory?: SocketFactory;
  retryBaseMs?: number;
  retryMaxMs?: number;
  stableConnectionMs?: number;
  maintenanceMs?: number;
  livenessCheckMs?: number;
  staleAfterMs?: number;
  maxLifetimeMs?: number;
  maxPayloadBytes?: number;
  random?: () => number;
  isKnownSymbol?: (symbol: string) => boolean;
}

interface CollectorRuntimeOptions {
  socketFactory: SocketFactory;
  retryBaseMs: number;
  retryMaxMs: number;
  stableConnectionMs: number;
  maintenanceMs: number;
  livenessCheckMs: number;
  staleAfterMs: number;
  maxLifetimeMs: number;
  maxPayloadBytes: number;
  random: () => number;
  isKnownSymbol?: (symbol: string) => boolean;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validBucket(value: unknown): value is Bucket {
  if (!isRecord(value)) return false;
  return (
    Number.isFinite(value.long) && Number(value.long) >= 0 &&
    Number.isFinite(value.short) && Number(value.short) >= 0
  );
}

function sanitizeBuckets(value: unknown, keepMs: number, now: number): Record<string, Bucket> {
  if (!isRecord(value)) return {};
  const rows: [string, Bucket][] = [];
  for (const [rawTs, bucket] of Object.entries(value)) {
    const ts = Number(rawTs);
    if (!Number.isSafeInteger(ts) || ts < BINANCE_EPOCH_MS || ts > now + FIVE_MIN) continue;
    if (now - ts > keepMs || !validBucket(bucket)) continue;
    rows.push([String(ts), { long: Number(bucket.long), short: Number(bucket.short) }]);
  }
  rows.sort((a, b) => Number(a[0]) - Number(b[0]));
  return Object.fromEntries(rows);
}

const books = new Map<string, SymbolBook>();
let recordingSince = Date.now();
let eventsSeen = 0;
// Construction is inert. `connecting` is truthful only after the managed
// market lifecycle explicitly starts this owner.
let wsState: 'connecting' | 'live' | 'down' = 'down';
let persistTimer: NodeJS.Timeout | null = null;
let persistDirty = false;
let persistSequence = 0;
let persistTail: Promise<void> = Promise.resolve();

try {
  if (fs.statSync(DISK).size > MAX_CACHE_BYTES) throw new Error('liquidation cache too large');
  const stored = JSON.parse(fs.readFileSync(DISK, 'utf8')) as unknown;
  if (isRecord(stored)) {
    if (Number.isSafeInteger(stored.since) && Number(stored.since) >= BINANCE_EPOCH_MS) {
      recordingSince = Math.min(Number(stored.since), Date.now());
    }
    if (isRecord(stored.books)) {
      for (const [symbol, rawBook] of Object.entries(stored.books).slice(0, MAX_SYMBOLS)) {
        if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !isRecord(rawBook)) continue;
        const book = {
          m5: sanitizeBuckets(rawBook.m5, KEEP_5M_MS, Date.now()),
          h1: sanitizeBuckets(rawBook.h1, KEEP_1H_MS, Date.now()),
        };
        if (Object.keys(book.m5).length || Object.keys(book.h1).length) books.set(symbol, book);
      }
    }
  }
} catch {
  // Fresh start or corrupt cache: the live stream remains authoritative.
}

function newestBuckets(value: Record<string, Bucket>, limit: number): Record<string, Bucket> {
  if (limit <= 0) return {};
  const entries = Object.entries(value)
    .filter(([rawTs, bucket]) => Number.isSafeInteger(Number(rawTs)) && validBucket(bucket))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(-limit)
    .map(([ts, bucket]) => [ts, { long: bucket.long, short: bucket.short }] as const);
  return Object.fromEntries(entries);
}

function serializeLiquidationCache(): string {
  const prefix = `{"since":${recordingSince},"books":{`;
  const suffix = '}}';
  const parts: string[] = [];
  let bytes = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
  let rows = 0;

  for (const [symbol, book] of [...books.entries()].reverse().slice(0, MAX_SYMBOLS)) {
    const remaining = MAX_SERIALIZED_BUCKET_ROWS - rows;
    if (remaining <= 0) break;
    const m5 = newestBuckets(book.m5, Math.min(MAX_M5_BUCKETS_PER_SYMBOL, Math.max(1, Math.ceil(remaining / 3))));
    const m5Rows = Object.keys(m5).length;
    const h1 = newestBuckets(book.h1, Math.min(MAX_H1_BUCKETS_PER_SYMBOL, Math.max(0, remaining - m5Rows)));
    const rowCount = m5Rows + Object.keys(h1).length;
    if (!rowCount) continue;
    const fragment = `${JSON.stringify(symbol)}:${JSON.stringify({ m5, h1 })}`;
    const fragmentBytes = Buffer.byteLength(fragment) + (parts.length ? 1 : 0);
    if (bytes + fragmentBytes > MAX_CACHE_BYTES) continue;
    parts.push(fragment);
    bytes += fragmentBytes;
    rows += rowCount;
  }
  return `${prefix}${parts.reverse().join(',')}${suffix}`;
}

function enqueueLiquidationPersist(): Promise<void> {
  if (!persistDirty) return persistTail;
  persistDirty = false;
  let payload: string;
  try {
    payload = serializeLiquidationCache();
  } catch {
    return persistTail;
  }

  persistTail = persistTail
    .catch(() => undefined)
    .then(async () => {
      const temp = `${DISK}.${process.pid}.${Date.now()}.${++persistSequence}.tmp`;
      try {
        await fs.promises.mkdir(path.dirname(DISK), { recursive: true });
        await fs.promises.writeFile(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true });
        await fs.promises.rename(temp, DISK);
      } finally {
        await fs.promises.unlink(temp).catch(() => undefined);
      }
    })
    .catch(() => undefined);
  return persistTail;
}

function persist(): void {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void enqueueLiquidationPersist();
  }, PERSIST_DEBOUNCE_MS);
  persistTimer.unref?.();
}

export async function flushLiquidationCache(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  do {
    if (persistDirty) await enqueueLiquidationPersist();
    else await persistTail;
  } while (persistDirty);
}

function prune(): void {
  const now = Date.now();
  for (const [symbol, book] of books) {
    for (const ts of Object.keys(book.m5)) {
      if (!Number.isSafeInteger(Number(ts)) || now - Number(ts) > KEEP_5M_MS) delete book.m5[ts];
    }
    for (const ts of Object.keys(book.h1)) {
      if (!Number.isSafeInteger(Number(ts)) || now - Number(ts) > KEEP_1H_MS) delete book.h1[ts];
    }
    if (!Object.keys(book.m5).length && !Object.keys(book.h1).length) books.delete(symbol);
  }
  for (const [key, seenAt] of recentEventKeys) {
    if (now - seenAt > RECENT_EVENT_TTL_MS) recentEventKeys.delete(key);
  }
}

function record(symbol: string, side: 'long' | 'short', usd: number, ts: number): void {
  let book = books.get(symbol);
  if (!book) {
    if (books.size >= MAX_SYMBOLS) return;
    book = { m5: {}, h1: {} };
    books.set(symbol, book);
  }
  const key5 = String(Math.floor(ts / FIVE_MIN) * FIVE_MIN);
  const key1 = String(Math.floor(ts / HOUR) * HOUR);
  book.m5[key5] = book.m5[key5] ?? { long: 0, short: 0 };
  book.h1[key1] = book.h1[key1] ?? { long: 0, short: 0 };
  book.m5[key5][side] += usd;
  book.h1[key1][side] += usd;
  eventsSeen++;
}

const recentEventKeys = new Map<string, number>();
let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let lifeTimer: NodeJS.Timeout | null = null;
let stableTimer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;
let stopped = true;
let generation = 0;
let retryMs = DEFAULT_RETRY_BASE_MS;
let lastActivityAt = 0;
let runtimeOptions: CollectorRuntimeOptions | null = null;

function normalizeOptions(options: LiquidationCollectorOptions): CollectorRuntimeOptions {
  const retryBaseMs = positiveInt(options.retryBaseMs, DEFAULT_RETRY_BASE_MS);
  const livenessCheckMs = positiveInt(options.livenessCheckMs, DEFAULT_LIVENESS_CHECK_MS);
  return {
    socketFactory: options.socketFactory ?? ((url, wsOptions) => new WebSocket(url, wsOptions)),
    retryBaseMs,
    retryMaxMs: Math.max(retryBaseMs, positiveInt(options.retryMaxMs, DEFAULT_RETRY_MAX_MS)),
    stableConnectionMs: positiveInt(options.stableConnectionMs, DEFAULT_STABLE_CONNECTION_MS),
    maintenanceMs: positiveInt(options.maintenanceMs, DEFAULT_MAINTENANCE_MS),
    livenessCheckMs,
    staleAfterMs: Math.max(livenessCheckMs, positiveInt(options.staleAfterMs, DEFAULT_STALE_AFTER_MS)),
    maxLifetimeMs: positiveInt(options.maxLifetimeMs, DEFAULT_MAX_LIFETIME_MS),
    maxPayloadBytes: positiveInt(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES),
    random: options.random ?? Math.random,
    isKnownSymbol: options.isKnownSymbol,
  };
}

function isActive(owner: number): boolean {
  return !stopped && generation === owner;
}

function isCurrent(owner: number, socket: WebSocket): boolean {
  return isActive(owner) && ws === socket;
}

function closeSocket(socket: WebSocket, terminate: boolean): void {
  try {
    if (terminate || socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'liquidation stream recycle');
  } catch {
    // Generation ownership prevents reuse even if a close implementation fails.
  }
}

function clearConnectionTimers(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (lifeTimer) clearTimeout(lifeTimer);
  if (stableTimer) clearTimeout(stableTimer);
  heartbeatTimer = null;
  lifeTimer = null;
  stableTimer = null;
}

function clearAllTimers(): void {
  clearConnectionTimers();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  reconnectTimer = null;
  maintenanceTimer = null;
}

function scheduleReconnect(owner: number): void {
  const options = runtimeOptions;
  if (!options || !isActive(owner) || reconnectTimer) return;
  const random = Math.min(1, Math.max(0, options.random()));
  const delay = Math.max(1, Math.floor(retryMs * (0.8 + random * 0.4)));
  retryMs = Math.min(options.retryMaxMs, retryMs * 2);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (isActive(owner)) connect(owner);
  }, delay);
  reconnectTimer.unref?.();
}

function symbolIsAllowed(symbol: string, options: CollectorRuntimeOptions): boolean {
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return false;
  if (!options.isKnownSymbol) return true;
  try {
    return options.isKnownSymbol(symbol);
  } catch {
    return false;
  }
}

function onForceOrder(value: unknown, options: CollectorRuntimeOptions): void {
  if (!isRecord(value)) return;
  const message = value as unknown as ForceOrderMsg;
  const order = message.o;
  if (!order || typeof order.s !== 'string' || !symbolIsAllowed(order.s, options)) return;
  if (order.S !== 'BUY' && order.S !== 'SELL') return;
  // Binance defines `l` as the last-filled quantity and `z` as the cumulative
  // filled quantity. Counting `z` on each snapshot can count earlier fills
  // again, so an event without a valid last-fill quantity is not recordable.
  const qty = Number(order.l);
  const price = Number(order.ap);
  const ts = Number(order.T ?? message.E);
  const now = Date.now();
  if (
    !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0 ||
    !Number.isSafeInteger(ts) || ts < now - HOUR || ts > now + 60_000
  ) return;
  const usd = qty * price;
  if (!Number.isFinite(usd) || usd <= 0) return;

  const eventKey = `${order.s}:${order.S}:${ts}:${qty}:${price}`;
  if (recentEventKeys.has(eventKey)) return;
  recentEventKeys.set(eventKey, now);
  while (recentEventKeys.size > MAX_RECENT_EVENT_KEYS) {
    const oldest = recentEventKeys.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    recentEventKeys.delete(oldest);
  }
  record(order.s, order.S === 'SELL' ? 'long' : 'short', usd, ts);
}

function connect(owner: number): void {
  const options = runtimeOptions;
  if (!options || !isActive(owner) || ws) return;
  wsState = 'connecting';
  let socket: WebSocket;
  try {
    socket = options.socketFactory(
      'wss://fstream.binance.com/market/ws/!forceOrder@arr',
      {
        handshakeTimeout: 10_000,
        maxPayload: options.maxPayloadBytes,
        perMessageDeflate: false,
      },
    );
  } catch {
    wsState = 'down';
    scheduleReconnect(owner);
    return;
  }
  ws = socket;

  socket.on('open', () => {
    if (!isCurrent(owner, socket)) {
      closeSocket(socket, true);
      return;
    }
    lastActivityAt = Date.now();
    wsState = 'live';
    clearConnectionTimers();
    stableTimer = setTimeout(() => {
      if (isCurrent(owner, socket)) retryMs = options.retryBaseMs;
    }, options.stableConnectionMs);
    stableTimer.unref?.();
    lifeTimer = setTimeout(() => {
      if (isCurrent(owner, socket)) closeSocket(socket, false);
    }, options.maxLifetimeMs);
    lifeTimer.unref?.();
    heartbeatTimer = setInterval(() => {
      if (!isCurrent(owner, socket)) return;
      if (Date.now() - lastActivityAt > options.staleAfterMs) closeSocket(socket, true);
    }, options.livenessCheckMs);
    heartbeatTimer.unref?.();
  });

  const noteActivity = () => {
    if (isCurrent(owner, socket)) lastActivityAt = Date.now();
  };
  socket.on('ping', noteActivity);
  socket.on('pong', noteActivity);

  socket.on('message', (raw: RawData, isBinary: boolean) => {
    if (!isCurrent(owner, socket)) return;
    lastActivityAt = Date.now();
    if (isBinary) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (isRecord(decoded) && decoded.data !== undefined) decoded = decoded.data;
    const events = Array.isArray(decoded) ? decoded.slice(0, MAX_FRAME_EVENTS) : [decoded];
    for (const event of events) onForceOrder(event, options);
  });

  socket.on('error', () => {
    if (isCurrent(owner, socket)) closeSocket(socket, true);
  });

  socket.on('close', () => {
    if (!isCurrent(owner, socket)) return;
    ws = null;
    clearConnectionTimers();
    wsState = 'down';
    scheduleReconnect(owner);
  });
}

export function startLiquidationCollector(options: LiquidationCollectorOptions = {}): void {
  if (!stopped) return;
  stopped = false;
  runtimeOptions = normalizeOptions(options);
  retryMs = runtimeOptions.retryBaseMs;
  wsState = 'connecting';
  const owner = ++generation;
  connect(owner);
  maintenanceTimer = setInterval(() => {
    if (!isActive(owner)) return;
    prune();
    persist();
  }, runtimeOptions.maintenanceMs);
  maintenanceTimer.unref?.();
}

export function stopLiquidationCollector(): void {
  if (stopped) {
    void flushLiquidationCache();
    return;
  }
  stopped = true;
  ++generation;
  clearAllTimers();
  const socket = ws;
  ws = null;
  if (socket) closeSocket(socket, true);
  wsState = 'down';
  runtimeOptions = null;
  prune();
  persist();
  void flushLiquidationCache();
}

export interface LiqPoint {
  t: number;
  long: number;
  short: number;
}

export function liquidationSeries(symbol: string, bucketMs: number): { since: number; state: string; points: LiqPoint[] } {
  const normalizedSymbol = symbol.toUpperCase();
  const requestedBucket = Number.isFinite(bucketMs) ? Math.floor(bucketMs) : HOUR;
  const safeBucketMs = Math.max(FIVE_MIN, Math.min(24 * HOUR, requestedBucket));
  const book = /^[A-Z0-9]{5,20}$/.test(normalizedSymbol) ? books.get(normalizedSymbol) : undefined;
  const points: LiqPoint[] = [];
  if (book) {
    const source = safeBucketMs < HOUR ? book.m5 : book.h1;
    const aggregated = new Map<number, Bucket>();
    for (const [rawTs, bucket] of Object.entries(source)) {
      const ts = Number(rawTs);
      if (!Number.isSafeInteger(ts) || !validBucket(bucket)) continue;
      const key = Math.floor(ts / safeBucketMs) * safeBucketMs;
      const current = aggregated.get(key) ?? { long: 0, short: 0 };
      current.long += bucket.long;
      current.short += bucket.short;
      aggregated.set(key, current);
    }
    for (const [t, bucket] of [...aggregated.entries()].sort((a, b) => a[0] - b[0])) {
      points.push({ t, long: bucket.long, short: bucket.short });
    }
  }
  return { since: recordingSince, state: wsState, points };
}

export function liquidationStats(): {
  state: 'connecting' | 'live' | 'down';
  running: boolean;
  generation: number;
  since: number;
  symbols: number;
  events: number;
  lastActivityAt: number | null;
} {
  return {
    state: wsState,
    running: !stopped,
    generation,
    since: recordingSince,
    symbols: books.size,
    events: eventsSeen,
    lastActivityAt: lastActivityAt > 0 ? lastActivityAt : null,
  };
}
