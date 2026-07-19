/* Passive liquidation projection. Binance publishes no liquidation history,
 * so the cockpit retains a bounded local view of frames delivered by the
 * canonical MarketEngine owner. This module never creates a transport. A SELL
 * force order closes a LONG position; BUY closes a SHORT. */
import fs from 'node:fs';
import path from 'node:path';
import {
  assertDataDirCachePathHeld,
  resolveDataDirAuthority,
} from '../bootstrap/environment.js';
import type { FeedStatus } from './ws.js';

const DATA_DIR_AUTHORITY = resolveDataDirAuthority();
const { liquidationCache: DISK } = DATA_DIR_AUTHORITY;
const FIVE_MIN = 5 * 60_000;
const HOUR = 60 * 60_000;
const KEEP_5M_MS = 48 * HOUR;
const KEEP_1H_MS = 90 * 24 * HOUR;
const BINANCE_EPOCH_MS = Date.UTC(2017, 0, 1);
const MAX_SYMBOLS = 4_096;
const DEFAULT_MAINTENANCE_MS = 5 * 60_000;
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

export interface LiquidationProjectionOptions {
  maintenanceMs?: number;
}

interface ProjectionRuntimeOptions {
  maintenanceMs: number;
}

export interface LiquidationProjectionPrint {
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly notionalUsd: number;
  readonly eventTimeMs: number;
  readonly sourceEventKey: string;
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
        assertDataDirCachePathHeld(DATA_DIR_AUTHORITY, DISK);
        await fs.promises.mkdir(path.dirname(DISK), { recursive: true });
        assertDataDirCachePathHeld(DATA_DIR_AUTHORITY, DISK);
        await fs.promises.writeFile(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true });
        assertDataDirCachePathHeld(DATA_DIR_AUTHORITY, DISK);
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

let maintenanceTimer: NodeJS.Timeout | null = null;
let stopped = true;
let generation = 0;
let lastActivityAt = 0;
let runtimeOptions: ProjectionRuntimeOptions | null = null;

function normalizeOptions(options: LiquidationProjectionOptions): ProjectionRuntimeOptions {
  return {
    maintenanceMs: positiveInt(options.maintenanceMs, DEFAULT_MAINTENANCE_MS),
  };
}

function isActive(owner: number): boolean {
  return !stopped && generation === owner;
}

function clearMaintenanceTimer(): void {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
}

function onCanonicalPrint(print: Readonly<LiquidationProjectionPrint>): void {
  if (!/^[A-Z0-9]{1,32}$/.test(print.symbol)
      || (print.side !== 'LONG' && print.side !== 'SHORT')
      || typeof print.sourceEventKey !== 'string'
      || print.sourceEventKey.length < 1
      || print.sourceEventKey.length > 256) return;
  const usd = print.notionalUsd;
  const ts = print.eventTimeMs;
  const now = Date.now();
  if (
    !Number.isFinite(usd) || usd <= 0 ||
    !Number.isSafeInteger(ts) || ts < now - HOUR || ts > now + 60_000
  ) return;

  lastActivityAt = now;
  record(print.symbol, print.side === 'LONG' ? 'long' : 'short', usd, ts);
}

export function startLiquidationProjection(options: LiquidationProjectionOptions = {}): void {
  if (!stopped) return;
  stopped = false;
  runtimeOptions = normalizeOptions(options);
  wsState = 'connecting';
  const owner = ++generation;
  maintenanceTimer = setInterval(() => {
    if (!isActive(owner)) return;
    prune();
    persist();
  }, runtimeOptions.maintenanceMs);
  maintenanceTimer.unref?.();
}

export function observeLiquidationSourceStatus(status: FeedStatus): void {
  if (stopped) return;
  wsState = status === 'open' ? 'live' : status === 'connecting' ? 'connecting' : 'down';
  if (status === 'open') lastActivityAt = Date.now();
}

export function ingestLiquidationPrint(print: Readonly<LiquidationProjectionPrint>): void {
  if (stopped || runtimeOptions === null || !isRecord(print)) return;
  onCanonicalPrint(print);
}

export function stopLiquidationProjection(): void {
  if (stopped) {
    void flushLiquidationCache();
    return;
  }
  stopped = true;
  ++generation;
  clearMaintenanceTimer();
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
