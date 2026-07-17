/* Money Flow — Binance's token-page money-flow analysis computed from REAL
 * spot aggTrades. Every aggregate trade in the window is classified by taker
 * side (isBuyerMaker=false → taker BUY) and by notional size using Binance's
 * order-size convention: Large ≥ $100K · Medium $10K–$100K · Small < $10K.
 * Sums are in BASE units (what the Binance widget shows). High-volume windows
 * walk BACKWARD from now so a pagination cap keeps the most recent trades and
 * reports honest coverage instead of silently truncating the wrong end. */

import { deterministicOfflinePublicSourcesEnabled } from './publicSourceMode.js';

const API = 'https://api.binance.com';
const MAX_CALLS = 60; // 60k aggTrades ceiling per refresh
const WALK_TIMEOUT_MS = 20_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 512;
const NEGATIVE_CACHE_MS = 5_000;
const MAX_ACTIVE_WALKS = 4;

export interface MoneyFlowBucket {
  buy: number;
  sell: number;
}

export interface MoneyFlow {
  symbol: string;
  window: string;
  large: MoneyFlowBucket;
  medium: MoneyFlowBucket;
  small: MoneyFlowBucket;
  totalBuy: number;
  totalSell: number;
  inflow: number;
  trades: number;
  coveredMs: number;
  windowMs: number;
  sampled: boolean;
  fetchedAt: number;
}

export const FLOW_WINDOWS: Record<string, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

interface AggTrade {
  p: string; // price
  q: string; // qty
  T: number; // trade time
  m: boolean; // buyer is maker → taker sold
}

interface ActiveWalk {
  controller: AbortController;
  promise: Promise<MoneyFlow | null>;
  subscribers: number;
  settled: boolean;
}

const cache = new Map<string, { fetchedAt: number; data: MoneyFlow }>();
const inFlight = new Map<string, ActiveWalk>();
const failures = new Map<string, number>();
const CACHE_MS = 45_000;

function canonicalSymbol(value: string): string | null {
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,20}$/.test(symbol) ? symbol : null;
}

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, max = MAX_CACHE_ENTRIES): void {
  if (!map.has(key) && map.size >= max) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('money flow request aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function joinActiveWalk(active: ActiveWalk, signal?: AbortSignal): Promise<MoneyFlow | null> {
  if (signal?.aborted) throw abortReason(signal);
  active.subscribers++;
  let callerAborted = false;
  let onAbort: (() => void) | null = null;
  try {
    if (!signal) return await active.promise;
    const cancellation = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        callerAborted = true;
        reject(abortReason(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([active.promise, cancellation]);
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    active.subscribers--;
    if (callerAborted && active.subscribers === 0 && !active.settled) {
      active.controller.abort(new DOMException('money flow request abandoned', 'AbortError'));
    }
  }
}

async function readAggTrades(res: Response): Promise<AggTrade[]> {
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('money flow unavailable');
  }
  const advertised = Number(res.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_PAGE_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('money flow unavailable');
  }
  if (!res.body) throw new Error('money flow unavailable');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_PAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('money flow unavailable');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('invalid');
    return parsed.slice(0, 1_000) as AggTrade[];
  } catch {
    throw new Error('money flow unavailable');
  }
}

async function fetchAggTrades(symbol: string, endTime: number, signal: AbortSignal): Promise<AggTrade[]> {
  try {
    const url = new URL('/api/v3/aggTrades', API);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('endTime', String(Math.trunc(endTime)));
    url.searchParams.set('limit', '1000');
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error('money flow unavailable');
    }
    return await readAggTrades(res);
  } catch (error) {
    if (signal.aborted) throw abortReason(signal);
    throw new Error('money flow unavailable');
  }
}

export async function fetchMoneyFlow(symbol: string, window: string, signal?: AbortSignal): Promise<MoneyFlow | null> {
  if (deterministicOfflinePublicSourcesEnabled()) throw new Error('money flow unavailable');
  if (signal?.aborted) throw abortReason(signal);
  const safeSymbol = canonicalSymbol(symbol);
  const windowMs = FLOW_WINDOWS[window];
  if (!safeSymbol || !windowMs) return null;
  const key = `${safeSymbol}:${window}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit.data;
  if ((failures.get(key) ?? 0) > Date.now()) {
    throw new Error('money flow unavailable');
  }
  failures.delete(key);
  const existing = inFlight.get(key);
  if (existing) return joinActiveWalk(existing, signal);
  if (inFlight.size >= MAX_ACTIVE_WALKS) throw new Error('money flow capacity reached');

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('money flow deadline exceeded', 'TimeoutError'));
  }, WALK_TIMEOUT_MS);
  const rawWork = (async (): Promise<MoneyFlow | null> => {
    try {
      const now = Date.now();
      const start = now - windowMs;
      const flow: MoneyFlow = {
        symbol: safeSymbol,
        window,
        large: { buy: 0, sell: 0 },
        medium: { buy: 0, sell: 0 },
        small: { buy: 0, sell: 0 },
        totalBuy: 0,
        totalSell: 0,
        inflow: 0,
        trades: 0,
        coveredMs: 0,
        windowMs,
        sampled: false,
        fetchedAt: now,
      };

      let cursorEnd = now;
      let oldestSeen = now;
      let calls = 0;
      while (cursorEnd > start && calls < MAX_CALLS) {
        calls++;
        const rows = await fetchAggTrades(safeSymbol, cursorEnd, controller.signal);
        if (!rows.length) break;
        for (const tr of rows) {
          if (!tr || !Number.isFinite(tr.T) || tr.T < start || typeof tr.m !== 'boolean') continue;
          const price = Number(tr.p);
          const qty = Number(tr.q);
          if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) continue;
          const quote = price * qty;
          if (!Number.isFinite(quote)) continue;
          const bucket = quote >= 100_000 ? flow.large : quote >= 10_000 ? flow.medium : flow.small;
          const nextBucket = (tr.m ? bucket.sell : bucket.buy) + qty;
          const nextTotal = (tr.m ? flow.totalSell : flow.totalBuy) + qty;
          if (!Number.isFinite(nextBucket) || !Number.isFinite(nextTotal)) continue;
          if (tr.m) {
            bucket.sell = nextBucket;
            flow.totalSell = nextTotal;
          } else {
            bucket.buy = nextBucket;
            flow.totalBuy = nextTotal;
          }
          flow.trades++;
        }
        const firstTs = Number(rows[0]?.T);
        if (!Number.isFinite(firstTs) || firstTs <= 0 || firstTs > cursorEnd) throw new Error('money flow unavailable');
        oldestSeen = Math.min(oldestSeen, firstTs);
        if (firstTs <= start) break;
        if (rows.length < 1000) {
          oldestSeen = Math.min(oldestSeen, start);
          break;
        }
        cursorEnd = firstTs - 1;
      }

      flow.coveredMs = now - Math.max(oldestSeen, start);
      flow.sampled = oldestSeen > start + 1_000;
      flow.inflow = flow.totalBuy - flow.totalSell;
      if (!Number.isFinite(flow.inflow)) throw new Error('money flow unavailable');
      boundedSet(cache, key, { fetchedAt: now, data: flow });
      failures.delete(key);
      return flow;
    } catch (error) {
      if (isAbortError(error)) throw error;
      boundedSet(failures, key, Date.now() + NEGATIVE_CACHE_MS, MAX_CACHE_ENTRIES);
      throw new Error('money flow unavailable');
    } finally {
      clearTimeout(timer);
    }
  })();
  let active!: ActiveWalk;
  const work = rawWork.finally(() => {
    active.settled = true;
    if (inFlight.get(key) === active) inFlight.delete(key);
  });
  active = { controller, promise: work, subscribers: 0, settled: false };
  inFlight.set(key, active);
  return joinActiveWalk(active, signal);
}
