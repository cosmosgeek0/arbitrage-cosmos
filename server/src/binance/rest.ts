import { deterministicOfflinePublicSourcesEnabled } from './publicSourceMode.js';

const SPOT_API = 'https://api.binance.com';
const FAPI = 'https://fapi.binance.com';

const BINANCE_HOSTS = new Set(['api.binance.com', 'fapi.binance.com']);
const FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_JSON_LIMIT_BYTES = 2 * 1024 * 1024;
// Spot exchangeInfo is currently ~17.3 MiB. Keep a bounded 24 MiB envelope so
// the full tradable/filter universe remains available without accepting an
// unbounded decompressed response.
const LARGE_JSON_LIMIT_BYTES = 24 * 1024 * 1024;
const NEGATIVE_CACHE_MS = 2_500;
const MAX_CACHE_ENTRIES = 1_024;
const MAX_ACTIVE_JSON_REQUESTS = 32;
// Host-scoped rate-limit breaker (Part 4 #2): Binance answers 429 with a
// Retry-After and escalates continued traffic to a whole-IP 418 ban. The
// per-URL negative cache alone records the failure against one URL while
// requests to other URLs on the same host keep escalating the ban, so a
// 429/418 must gate the HOST, not the URL.
const HOST_BAN_BASE_MS_429 = 60_000;
const HOST_BAN_BASE_MS_418 = 300_000;
const HOST_BAN_MAX_MS = 3_600_000;
const jsonInFlight = new Map<string, Promise<unknown>>();
const jsonFailures = new Map<string, { until: number; message: string }>();
const hostRateLimitBans = new Map<string, { until: number; strikes: number }>();

export interface BinanceRestLifecycleContext {
  readonly cacheScope: string;
  readonly generation: number;
  readonly signal: AbortSignal;
}

function lifecycleRequestKey(url: URL, lifecycle?: Readonly<BinanceRestLifecycleContext>): string {
  return lifecycle
    ? `${lifecycle.cacheScope}:${lifecycle.generation}:${url.toString()}`
    : url.toString();
}

function throwIfLifecycleAborted(lifecycle?: Readonly<BinanceRestLifecycleContext>): void {
  if (!lifecycle?.signal.aborted) return;
  throw lifecycle.signal.reason instanceof Error
    ? lifecycle.signal.reason
    : new Error('Binance REST lifecycle aborted');
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (header === null) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1_000, HOST_BAN_MAX_MS);
}

function recordHostRateLimit(hostname: string, status: number, advertisedMs: number | null): void {
  const strikes = (hostRateLimitBans.get(hostname)?.strikes ?? 0) + 1;
  const base = status === 418 ? HOST_BAN_BASE_MS_418 : HOST_BAN_BASE_MS_429;
  const escalated = Math.min(base * 2 ** Math.min(strikes - 1, 5), HOST_BAN_MAX_MS);
  const banMs = advertisedMs !== null ? Math.max(advertisedMs, base) : escalated;
  hostRateLimitBans.set(hostname, { until: Date.now() + banMs, strikes });
}

function boundedInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function canonicalSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(symbol)) throw new Error('invalid Binance symbol');
  return symbol;
}

function canonicalToken(value: string, label: string, maxLength = 12): string {
  const token = value.trim();
  if (!new RegExp(`^[A-Za-z0-9]{1,${maxLength}}$`).test(token)) throw new Error(`invalid Binance ${label}`);
  return token;
}

function finiteNumber(value: unknown, minimum = Number.NEGATIVE_INFINITY): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : null;
}

function boundedMapSet<K, V>(map: Map<K, V>, key: K, value: V, maxEntries = MAX_CACHE_ENTRIES): void {
  if (!map.has(key) && map.size >= maxEntries) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

async function readBoundedBody(res: Response, maxBytes: number): Promise<string> {
  const advertised = Number(res.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('Binance response too large');
  }
  if (!res.body) return '';

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Binance response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

async function requestJson<T>(
  urlValue: string,
  label: string,
  maxBytes = DEFAULT_JSON_LIMIT_BYTES,
  lifecycle?: Readonly<BinanceRestLifecycleContext>,
): Promise<T> {
  if (deterministicOfflinePublicSourcesEnabled()) throw new Error(`${label} unavailable`);
  throwIfLifecycleAborted(lifecycle);
  const url = new URL(urlValue);
  if (url.protocol !== 'https:' || !BINANCE_HOSTS.has(url.hostname)) throw new Error(`${label} unavailable`);
  const key = lifecycleRequestKey(url, lifecycle);
  const hostBan = hostRateLimitBans.get(url.hostname);
  if (hostBan && hostBan.until > Date.now()) {
    throw new Error(`${label} unavailable (upstream rate limit cooldown)`);
  }
  const failed = jsonFailures.get(key);
  if (failed && failed.until > Date.now()) throw new Error(failed.message);
  if (failed) jsonFailures.delete(key);

  const existing = jsonInFlight.get(key);
  if (existing) return existing as Promise<T>;
  if (jsonInFlight.size >= MAX_ACTIVE_JSON_REQUESTS) {
    throw new Error('Binance REST capacity reached');
  }

  const work = (async (): Promise<T> => {
    const ctrl = new AbortController();
    const abortForLifecycle = () => ctrl.abort(lifecycle?.signal.reason);
    lifecycle?.signal.addEventListener('abort', abortForLifecycle, { once: true });
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: ctrl.signal,
      });
      if (!res.ok) {
        if (res.status === 429 || res.status === 418) {
          recordHostRateLimit(url.hostname, res.status, retryAfterMs(res));
        }
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`${label} HTTP ${res.status}`);
      }
      hostRateLimitBans.delete(url.hostname);
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.includes('application/json') && !contentType.includes('+json')) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`${label} invalid content type`);
      }
      const text = await readBoundedBody(res, maxBytes);
      try {
        const decoded = JSON.parse(text) as T;
        throwIfLifecycleAborted(lifecycle);
        return decoded;
      } catch {
        throwIfLifecycleAborted(lifecycle);
        throw new Error(`${label} invalid JSON`);
      }
    } catch (err) {
      if (lifecycle?.signal.aborted) {
        throwIfLifecycleAborted(lifecycle);
      }
      const message = err instanceof Error && /^(?:[\w -]+) (?:HTTP \d{3}|invalid content type|invalid JSON)$/.test(err.message)
        ? err.message
        : err instanceof Error && err.message === 'Binance response too large'
          ? `${label} response too large`
          : `${label} unavailable`;
      boundedMapSet(jsonFailures, key, { until: Date.now() + NEGATIVE_CACHE_MS, message }, 512);
      throw new Error(message);
    } finally {
      clearTimeout(timer);
      lifecycle?.signal.removeEventListener('abort', abortForLifecycle);
    }
  })();
  jsonInFlight.set(key, work);
  try {
    return await work;
  } finally {
    if (jsonInFlight.get(key) === work) jsonInFlight.delete(key);
  }
}

export interface PairedSymbol {
  symbol: string;
  base: string;
}

export interface SymbolFilters {
  symbol: string;
  base: string;
  quote: string;
  status: string;
  stepSize: number;
  minQty: number;
  tickSize: number;
  minNotional: number;
}

interface SpotExchangeInfo {
  symbols: {
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    isSpotTradingAllowed: boolean;
    filters: { filterType: string; [k: string]: unknown }[];
  }[];
}

interface FuturesExchangeInfo {
  symbols: {
    symbol: string;
    status: string;
    contractType: string;
    quoteAsset: string;
  }[];
}

// Stablecoin bases: their "basis" is peg noise, not a tradable dislocation.
const EXCLUDED_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'AEUR', 'EUR', 'EURI', 'USD1', 'USDE', 'XUSD',
]);

export interface ExchangeUniverse {
  pairs: PairedSymbol[]; // exact-name spot+perp pairs for the basis scanner
  filters: Map<string, SymbolFilters>; // ALL tradable USDT spot symbols, for order validation
}

/**
 * One pass over both exchangeInfos. Pairs = symbols trading with the exact
 * same name on spot and USDT-perp (multiplier contracts like 1000SHIBUSDT
 * deliberately do not match). Filters cover every USDT spot symbol so the
 * manual trade ticket can validate any of them.
 */
export async function fetchExchangeUniverse(): Promise<ExchangeUniverse> {
  const [spot, fut] = await Promise.all([
    requestJson<SpotExchangeInfo>(`${SPOT_API}/api/v3/exchangeInfo`, 'spot exchangeInfo', LARGE_JSON_LIMIT_BYTES),
    requestJson<FuturesExchangeInfo>(`${FAPI}/fapi/v1/exchangeInfo`, 'futures exchangeInfo', LARGE_JSON_LIMIT_BYTES),
  ]);
  if (!Array.isArray(spot.symbols) || !Array.isArray(fut.symbols)) throw new Error('exchangeInfo invalid JSON');

  const filters = new Map<string, SymbolFilters>();
  const pairableBases = new Map<string, string>();
  for (const s of spot.symbols.slice(0, 20_000)) {
    if (!s || s.status !== 'TRADING' || s.quoteAsset !== 'USDT' || !s.isSpotTradingAllowed || !Array.isArray(s.filters)) continue;
    const lot = s.filters.find((f) => f.filterType === 'LOT_SIZE') as
      | { stepSize: string; minQty: string }
      | undefined;
    const priceF = s.filters.find((f) => f.filterType === 'PRICE_FILTER') as
      | { tickSize: string }
      | undefined;
    const notional = s.filters.find((f) => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL') as
      | { minNotional: string }
      | undefined;
    const symbol = typeof s.symbol === 'string' && /^[A-Z0-9]{1,20}$/.test(s.symbol) ? s.symbol : null;
    const base = typeof s.baseAsset === 'string' && /^[A-Z0-9]{1,20}$/.test(s.baseAsset) ? s.baseAsset : null;
    const stepSize = finiteNumber(lot?.stepSize, 0);
    const minQty = finiteNumber(lot?.minQty, 0);
    const tickSize = finiteNumber(priceF?.tickSize, 0);
    const minNotional = finiteNumber(notional?.minNotional, 0);
    if (!symbol || !base || stepSize === null || stepSize <= 0 || minQty === null || tickSize === null || tickSize <= 0 || minNotional === null) continue;
    filters.set(s.symbol, {
      symbol,
      base,
      quote: s.quoteAsset,
      status: s.status,
      stepSize,
      minQty,
      tickSize,
      minNotional,
    });
    if (!EXCLUDED_BASES.has(base)) pairableBases.set(symbol, base);
  }

  const pairs: PairedSymbol[] = [];
  for (const f of fut.symbols.slice(0, 20_000)) {
    if (
      f &&
      f.status === 'TRADING' &&
      f.contractType === 'PERPETUAL' &&
      f.quoteAsset === 'USDT' &&
      pairableBases.has(f.symbol)
    ) {
      pairs.push({ symbol: f.symbol, base: pairableBases.get(f.symbol)! });
    }
  }
  return { pairs, filters };
}

export interface BookTicker {
  symbol: string;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  time?: number;
}

const bookCache = new Map<string, { fetchedAt: number; data: BookTicker }>();
const allBookCache = new Map<'spot' | 'futures', { fetchedAt: number; data: Map<string, BookTicker> }>();
const BOOK_CACHE_MS = 2_000;
const ALL_BOOK_CACHE_MS = 2_500;

type RawBookTicker = {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  time?: number;
};

function parseBookTicker(raw: RawBookTicker): BookTicker {
  const symbol = typeof raw?.symbol === 'string' ? canonicalSymbol(raw.symbol) : null;
  const bidPrice = finiteNumber(raw?.bidPrice, 0);
  const bidQty = finiteNumber(raw?.bidQty, 0);
  const askPrice = finiteNumber(raw?.askPrice, 0);
  const askQty = finiteNumber(raw?.askQty, 0);
  if (!symbol || bidPrice === null || bidQty === null || askPrice === null || askQty === null) throw new Error('bookTicker invalid JSON');
  const time = raw.time === undefined ? undefined : finiteNumber(raw.time, 0) ?? undefined;
  return {
    symbol,
    bidPrice,
    bidQty,
    askPrice,
    askQty,
    time,
  };
}

export async function fetchBookTicker(symbol: string): Promise<BookTicker> {
  const safeSymbol = canonicalSymbol(symbol);
  const cached = bookCache.get(safeSymbol);
  if (cached && Date.now() - cached.fetchedAt < BOOK_CACHE_MS) return cached.data;
  const raw = await requestJson<RawBookTicker>(
    `${SPOT_API}/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(safeSymbol)}`,
    'bookTicker',
  );
  const data = parseBookTicker(raw);
  boundedMapSet(bookCache, safeSymbol, { fetchedAt: Date.now(), data });
  return data;
}

export async function fetchAllBookTickers(
  market: 'spot' | 'futures',
  lifecycle?: Readonly<BinanceRestLifecycleContext>,
): Promise<Map<string, BookTicker>> {
  throwIfLifecycleAborted(lifecycle);
  const cached = lifecycle ? undefined : allBookCache.get(market);
  if (cached && Date.now() - cached.fetchedAt < ALL_BOOK_CACHE_MS) return cached.data;

  const url = market === 'futures' ? `${FAPI}/fapi/v1/ticker/bookTicker` : `${SPOT_API}/api/v3/ticker/bookTicker`;
  const raw = await requestJson<RawBookTicker[]>(
    url,
    `${market} bookTicker`,
    LARGE_JSON_LIMIT_BYTES,
    lifecycle,
  );
  if (!Array.isArray(raw)) throw new Error(`${market} bookTicker invalid JSON`);
  const data = new Map<string, BookTicker>();
  const rows = raw.slice(0, 20_000);
  let skipped = 0;
  for (const row of rows) {
    try {
      const parsed = parseBookTicker(row);
      data.set(parsed.symbol, parsed);
    } catch { skipped += 1; /* skip malformed upstream rows */ }
  }
  // Per-row tolerance is for genuine one-off malformations. A majority of
  // rows failing the shape check means the upstream schema changed; caching
  // the near-empty map would silently present it as the real market for the
  // cache window. Throw so the honest-unavailable path takes over (Part 4 #13).
  if (rows.length > 0 && skipped > rows.length / 2) {
    throw new Error(`${market} bookTicker schema mismatch: ${skipped} of ${rows.length} rows malformed`);
  }
  throwIfLifecycleAborted(lifecycle);
  if (!lifecycle) allBookCache.set(market, { fetchedAt: Date.now(), data });
  return data;
}

export interface Futures24hTicker {
  symbol: string;
  lastPrice: number;
  priceChangePct: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  count: number;
}

type RawFutures24hTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  count: number;
};

const futures24hCache = new Map<'all', { fetchedAt: number; data: Map<string, Futures24hTicker> }>();
const FUTURES_24H_CACHE_MS = 15_000;

export async function fetchAllFutures24hTickers(
  lifecycle?: Readonly<BinanceRestLifecycleContext>,
): Promise<Map<string, Futures24hTicker>> {
  throwIfLifecycleAborted(lifecycle);
  const cached = lifecycle ? undefined : futures24hCache.get('all');
  if (cached && Date.now() - cached.fetchedAt < FUTURES_24H_CACHE_MS) return cached.data;
  const raw = await requestJson<RawFutures24hTicker[]>(
    `${FAPI}/fapi/v1/ticker/24hr`,
    'futures 24hr',
    LARGE_JSON_LIMIT_BYTES,
    lifecycle,
  );
  if (!Array.isArray(raw)) throw new Error('futures 24hr invalid JSON');
  const data = new Map<string, Futures24hTicker>();
  for (const row of raw.slice(0, 20_000)) {
    if (!row || typeof row.symbol !== 'string' || !/^[A-Z0-9]{1,20}$/.test(row.symbol)) continue;
    const lastPrice = finiteNumber(row.lastPrice, 0);
    const priceChangePct = finiteNumber(row.priceChangePercent);
    const highPrice = finiteNumber(row.highPrice, 0);
    const lowPrice = finiteNumber(row.lowPrice, 0);
    const volume = finiteNumber(row.volume, 0);
    const quoteVolume = finiteNumber(row.quoteVolume, 0);
    const count = finiteNumber(row.count, 0);
    if (lastPrice === null || priceChangePct === null || highPrice === null || lowPrice === null || volume === null || quoteVolume === null || count === null) continue;
    data.set(row.symbol, {
      symbol: row.symbol,
      lastPrice,
      priceChangePct,
      highPrice,
      lowPrice,
      volume,
      quoteVolume,
      count,
    });
  }
  throwIfLifecycleAborted(lifecycle);
  if (!lifecycle) futures24hCache.set('all', { fetchedAt: Date.now(), data });
  return data;
}

export interface OpenInterest {
  symbol: string;
  openInterest: number;
  time: number;
}

const openInterestCache = new Map<string, { fetchedAt: number; data: OpenInterest }>();
const OPEN_INTEREST_CACHE_MS = 55_000;

export async function fetchOpenInterest(symbol: string): Promise<OpenInterest> {
  const safeSymbol = canonicalSymbol(symbol);
  const cached = openInterestCache.get(safeSymbol);
  if (cached && Date.now() - cached.fetchedAt < OPEN_INTEREST_CACHE_MS) return cached.data;
  const raw = await requestJson<{ openInterest: string; symbol: string; time: number }>(
    `${FAPI}/fapi/v1/openInterest?symbol=${encodeURIComponent(safeSymbol)}`,
    'openInterest',
  );
  const openInterest = finiteNumber(raw.openInterest, 0);
  const time = finiteNumber(raw.time, 0);
  if (raw.symbol !== safeSymbol || openInterest === null || time === null) throw new Error('openInterest invalid JSON');
  const data = { symbol: safeSymbol, openInterest, time };
  boundedMapSet(openInterestCache, safeSymbol, { fetchedAt: Date.now(), data });
  return data;
}

export interface KlinePoint {
  t: number;
  v: number;
}

export interface KlineCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  qv: number;
  trades: number;
  takerBuyQv: number;
}

const klineCache = new Map<string, { fetchedAt: number; data: KlinePoint[] }>();
const candleCache = new Map<string, { fetchedAt: number; data: KlineCandle[] }>();
const KLINE_CACHE_MS = 60_000;

async function fetchRawKlines(
  symbol: string,
  interval: string,
  limit: number,
  market: 'spot' | 'futures'
): Promise<[number, string, string, string, string, string, number, string, ...unknown[]][]> {
  const safeSymbol = canonicalSymbol(symbol);
  const safeInterval = canonicalToken(interval, 'interval', 3);
  const safeLimit = boundedInteger(limit, 1, 1_000, 288);
  const url =
    market === 'futures'
      ? `${FAPI}/fapi/v1/klines?symbol=${encodeURIComponent(safeSymbol)}&interval=${encodeURIComponent(safeInterval)}&limit=${safeLimit}`
      : `${SPOT_API}/api/v3/klines?symbol=${encodeURIComponent(safeSymbol)}&interval=${encodeURIComponent(safeInterval)}&limit=${safeLimit}`;
  const rows = await requestJson<[number, string, string, string, string, string, number, string, ...unknown[]][]>(url, 'klines');
  if (!Array.isArray(rows)) throw new Error('klines invalid JSON');
  return rows.slice(0, safeLimit);
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
  market: 'spot' | 'futures' = 'spot',
  field: 'close' | 'volume' = 'close'
): Promise<KlinePoint[]> {
  const safeSymbol = canonicalSymbol(symbol);
  const safeInterval = canonicalToken(interval, 'interval', 3);
  const safeLimit = boundedInteger(limit, 1, 1_000, 288);
  const key = `${market}:${safeSymbol}:${safeInterval}:${safeLimit}:${field}`;
  const cached = klineCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < KLINE_CACHE_MS) return cached.data;

  const raw = await fetchRawKlines(safeSymbol, safeInterval, safeLimit, market);
  // k[4] = close, k[5] = base volume; volume is reported in quote terms (×close)
  const data = raw.flatMap((k) => {
    const t = finiteNumber(k?.[0], 0);
    const close = finiteNumber(k?.[4], 0);
    const volume = finiteNumber(k?.[5], 0);
    if (t === null || close === null || volume === null) return [];
    const v = field === 'volume' ? volume * close : close;
    return Number.isFinite(v) ? [{ t, v }] : [];
  });
  boundedMapSet(klineCache, key, { fetchedAt: Date.now(), data });
  return data;
}

export async function fetchKlineCandles(
  symbol: string,
  interval: string,
  limit: number,
  market: 'spot' | 'futures' = 'spot'
): Promise<KlineCandle[]> {
  const safeSymbol = canonicalSymbol(symbol);
  const safeInterval = canonicalToken(interval, 'interval', 3);
  const safeLimit = boundedInteger(limit, 1, 1_000, 288);
  const key = `${market}:${safeSymbol}:${safeInterval}:${safeLimit}:ohlcv`;
  const cached = candleCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < KLINE_CACHE_MS) return cached.data;
  const raw = await fetchRawKlines(safeSymbol, safeInterval, safeLimit, market);
  const data = raw.flatMap((k) => {
    const t = finiteNumber(k?.[0], 0);
    const o = finiteNumber(k?.[1], 0);
    const h = finiteNumber(k?.[2], 0);
    const l = finiteNumber(k?.[3], 0);
    const c = finiteNumber(k?.[4], 0);
    const v = finiteNumber(k?.[5], 0);
    const rawQv = finiteNumber(k?.[7], 0);
    const trades = finiteNumber(k?.[8], 0) ?? 0;
    const takerBuyQv = finiteNumber(k?.[10], 0) ?? 0;
    if (t === null || o === null || h === null || l === null || c === null || v === null) return [];
    const qv = rawQv ?? v * c;
    if (!Number.isFinite(qv)) return [];
    return [{ t, o, h, l, c, v, qv, trades, takerBuyQv }];
  });
  boundedMapSet(candleCache, key, { fetchedAt: Date.now(), data });
  return data;
}

export interface DepthLevel {
  price: number;
  qty: number;
}

const depthCache = new Map<string, { fetchedAt: number; data: { bids: DepthLevel[]; asks: DepthLevel[] } }>();

export async function fetchDepth(symbol: string, limit = 20): Promise<{ bids: DepthLevel[]; asks: DepthLevel[] }> {
  const safeSymbol = canonicalSymbol(symbol);
  const supportedLimits = [5, 10, 20, 50, 100, 500, 1_000, 5_000];
  const requestedLimit = boundedInteger(limit, 5, 5_000, 20);
  const safeLimit = supportedLimits.find((candidate) => candidate >= requestedLimit) ?? 5_000;
  const key = `${safeSymbol}:${safeLimit}`;
  const cached = depthCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < 2_500) return cached.data;
  const raw = await requestJson<{ bids: [string, string][]; asks: [string, string][] }>(
    `${SPOT_API}/api/v3/depth?symbol=${encodeURIComponent(safeSymbol)}&limit=${safeLimit}`,
    'depth',
    safeLimit > 1_000 ? LARGE_JSON_LIMIT_BYTES : DEFAULT_JSON_LIMIT_BYTES,
  );
  if (!Array.isArray(raw.bids) || !Array.isArray(raw.asks)) throw new Error('depth invalid JSON');
  const data = {
    bids: raw.bids.slice(0, safeLimit).flatMap(([p, q]) => {
      const price = finiteNumber(p, 0);
      const qty = finiteNumber(q, 0);
      return price !== null && qty !== null ? [{ price, qty }] : [];
    }),
    asks: raw.asks.slice(0, safeLimit).flatMap(([p, q]) => {
      const price = finiteNumber(p, 0);
      const qty = finiteNumber(q, 0);
      return price !== null && qty !== null ? [{ price, qty }] : [];
    }),
  };
  boundedMapSet(depthCache, key, { fetchedAt: Date.now(), data });
  return data;
}

export interface PublicTrade {
  id: number;
  price: number;
  qty: number;
  time: number;
  isBuyerMaker: boolean;
}

const tradesCache = new Map<string, { fetchedAt: number; data: PublicTrade[] }>();

export async function fetchTrades(symbol: string, limit = 30): Promise<PublicTrade[]> {
  const safeSymbol = canonicalSymbol(symbol);
  const safeLimit = boundedInteger(limit, 1, 1_000, 30);
  const key = `${safeSymbol}:${safeLimit}`;
  const cached = tradesCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < 2_500) return cached.data;
  const raw = await requestJson<{ id: number; price: string; qty: string; time: number; isBuyerMaker: boolean }[]>(
    `${SPOT_API}/api/v3/trades?symbol=${encodeURIComponent(safeSymbol)}&limit=${safeLimit}`,
    'trades',
  );
  if (!Array.isArray(raw)) throw new Error('trades invalid JSON');
  const data = raw
    .slice(0, safeLimit)
    .flatMap((t) => {
      const id = finiteNumber(t?.id, 0);
      const price = finiteNumber(t?.price, 0);
      const qty = finiteNumber(t?.qty, 0);
      const time = finiteNumber(t?.time, 0);
      if (id === null || price === null || qty === null || time === null || typeof t?.isBuyerMaker !== 'boolean') return [];
      return [{ id, price, qty, time, isBuyerMaker: t.isBuyerMaker }];
    })
    .reverse();
  boundedMapSet(tradesCache, key, { fetchedAt: Date.now(), data });
  return data;
}

const fundingCache = new Map<string, { fetchedAt: number; data: { t: number; v: number }[] }>();

/** Funding-rate history from the futures REST API (public), rate as percent. */
export async function fetchFundingHistory(symbol: string, limit = 120): Promise<{ t: number; v: number }[]> {
  const safeSymbol = canonicalSymbol(symbol);
  const safeLimit = boundedInteger(limit, 1, 1_000, 120);
  const key = `${safeSymbol}:${safeLimit}`;
  const cached = fundingCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < 300_000) return cached.data;
  const raw = await requestJson<{ fundingTime: number; fundingRate: string }[]>(
    `${FAPI}/fapi/v1/fundingRate?symbol=${encodeURIComponent(safeSymbol)}&limit=${safeLimit}`,
    'fundingRate',
  );
  if (!Array.isArray(raw)) throw new Error('fundingRate invalid JSON');
  const data = raw.slice(0, safeLimit).flatMap((r) => {
    const t = finiteNumber(r?.fundingTime, 0);
    const rate = finiteNumber(r?.fundingRate);
    return t !== null && rate !== null ? [{ t, v: rate * 100 }] : [];
  });
  boundedMapSet(fundingCache, key, { fetchedAt: Date.now(), data });
  return data;
}

export interface FuturesTelemetryPoint {
  t: number;
  v: number;
}

export interface FuturesOpenInterestPoint {
  t: number;
  contracts: number;
  notional: number;
}

export interface FuturesRatioPoint {
  t: number;
  ratio: number;
  longPct: number;
  shortPct: number;
}

export interface FuturesTakerFlowPoint {
  t: number;
  buyVol: number;
  sellVol: number;
  ratio: number;
}

export interface FuturesTelemetry {
  symbol: string;
  period: string;
  updatedAt: number;
  available: boolean;
  errors: string[];
  openInterest: FuturesOpenInterestPoint[];
  topAccountRatio: FuturesRatioPoint[];
  topPositionRatio: FuturesRatioPoint[];
  globalRatio: FuturesRatioPoint[];
  takerFlow: FuturesTakerFlowPoint[];
}

const futuresTelemetryCache = new Map<string, { fetchedAt: number; data: FuturesTelemetry }>();
const FUTURES_TELEMETRY_CACHE_MS = 60_000;

async function fetchFuturesData<T>(pathName: string, symbol: string, period: string, limit: number): Promise<T[]> {
  const allowedPaths = new Set([
    'openInterestHist',
    'topLongShortAccountRatio',
    'topLongShortPositionRatio',
    'globalLongShortAccountRatio',
    'takerlongshortRatio',
  ]);
  if (!allowedPaths.has(pathName)) throw new Error('invalid futures data path');
  const safeSymbol = canonicalSymbol(symbol);
  const safePeriod = canonicalToken(period, 'period', 3);
  const safeLimit = boundedInteger(limit, 5, 500, 40);
  const url =
    `${FAPI}/futures/data/${pathName}?symbol=${encodeURIComponent(safeSymbol)}` +
    `&period=${encodeURIComponent(safePeriod)}&limit=${safeLimit}`;
  const rows = await requestJson<T[]>(url, pathName);
  if (!Array.isArray(rows)) throw new Error(`${pathName} invalid JSON`);
  return rows.slice(0, safeLimit);
}

function settledValue<T>(r: PromiseSettledResult<T[]>, errors: string[]): T[] {
  if (r.status === 'fulfilled') return r.value;
  const message = r.reason instanceof Error && /^[A-Za-z0-9 -]+ (?:HTTP \d{3}|invalid content type|invalid JSON|response too large|unavailable)$/.test(r.reason.message)
    ? r.reason.message
    : 'futures telemetry unavailable';
  errors.push(message.slice(0, 120));
  return [];
}

export async function fetchFuturesTelemetry(symbol: string, period = '5m', limit = 40): Promise<FuturesTelemetry> {
  const safeSymbol = canonicalSymbol(symbol);
  const safePeriod = canonicalToken(period, 'period', 3);
  const safeLimit = boundedInteger(limit, 5, 120, 40);
  const key = `${safeSymbol}:${safePeriod}:${safeLimit}`;
  const cached = futuresTelemetryCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < FUTURES_TELEMETRY_CACHE_MS) return cached.data;

  type OI = { sumOpenInterest: string; sumOpenInterestValue: string; timestamp: string | number };
  type Ratio = { longAccount: string; shortAccount: string; longShortRatio: string; timestamp: string | number };
  type Taker = { buySellRatio: string; buyVol: string; sellVol: string; timestamp: string | number };

  const [oiRes, topAccountRes, topPositionRes, globalRes, takerRes] = await Promise.allSettled([
    fetchFuturesData<OI>('openInterestHist', safeSymbol, safePeriod, safeLimit),
    fetchFuturesData<Ratio>('topLongShortAccountRatio', safeSymbol, safePeriod, safeLimit),
    fetchFuturesData<Ratio>('topLongShortPositionRatio', safeSymbol, safePeriod, safeLimit),
    fetchFuturesData<Ratio>('globalLongShortAccountRatio', safeSymbol, safePeriod, safeLimit),
    fetchFuturesData<Taker>('takerlongshortRatio', safeSymbol, safePeriod, safeLimit),
  ]);

  const errors: string[] = [];
  const openInterest = settledValue(oiRes, errors).flatMap((p) => {
    const t = finiteNumber(p?.timestamp, 0);
    const contracts = finiteNumber(p?.sumOpenInterest, 0);
    const notional = finiteNumber(p?.sumOpenInterestValue, 0);
    return t !== null && contracts !== null && notional !== null ? [{ t, contracts, notional }] : [];
  });
  const mapRatio = (rows: Ratio[]) =>
    rows.flatMap((p) => {
      const t = finiteNumber(p?.timestamp, 0);
      const ratio = finiteNumber(p?.longShortRatio, 0);
      const long = finiteNumber(p?.longAccount, 0);
      const short = finiteNumber(p?.shortAccount, 0);
      return t !== null && ratio !== null && long !== null && short !== null
        ? [{ t, ratio, longPct: long * 100, shortPct: short * 100 }]
        : [];
    });
  const topAccountRatio = mapRatio(settledValue(topAccountRes, errors));
  const topPositionRatio = mapRatio(settledValue(topPositionRes, errors));
  const globalRatio = mapRatio(settledValue(globalRes, errors));
  const takerFlow = settledValue(takerRes, errors).flatMap((p) => {
    const t = finiteNumber(p?.timestamp, 0);
    const buyVol = finiteNumber(p?.buyVol, 0);
    const sellVol = finiteNumber(p?.sellVol, 0);
    const ratio = finiteNumber(p?.buySellRatio, 0);
    return t !== null && buyVol !== null && sellVol !== null && ratio !== null ? [{ t, buyVol, sellVol, ratio }] : [];
  });

  const data: FuturesTelemetry = {
    symbol: safeSymbol,
    period: safePeriod,
    updatedAt: Date.now(),
    available: openInterest.length + topAccountRatio.length + topPositionRatio.length + globalRatio.length + takerFlow.length > 0,
    errors,
    openInterest,
    topAccountRatio,
    topPositionRatio,
    globalRatio,
    takerFlow,
  };
  boundedMapSet(futuresTelemetryCache, key, { fetchedAt: Date.now(), data });
  return data;
}

export async function fetchBinanceServerTime(): Promise<{ diffMs: number; latencyMs: number }> {
  const t0 = Date.now();
  const { serverTime } = await requestJson<{ serverTime: number }>(`${SPOT_API}/api/v3/time`, 'time');
  const t1 = Date.now();
  const safeServerTime = finiteNumber(serverTime, 0);
  if (safeServerTime === null) throw new Error('time invalid JSON');
  return { diffMs: safeServerTime - Math.round((t0 + t1) / 2), latencyMs: t1 - t0 };
}


// ---- basis history (futures/data/basis — pair + contractType) --------------
export interface BasisPoint {
  t: number;
  futuresPrice: number;
  indexPrice: number;
  basis: number;
  basisRatePct: number;
}

const basisCache = new Map<string, { fetchedAt: number; rows: BasisPoint[] }>();

export async function fetchBasisHist(pair: string, period: string, limit: number): Promise<BasisPoint[]> {
  const safePair = canonicalSymbol(pair);
  const safePeriod = canonicalToken(period, 'period', 3);
  const safeLimit = boundedInteger(limit, 5, 200, 48);
  const key = `${safePair}:${safePeriod}:${safeLimit}`;
  const hit = basisCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < 60_000) return hit.rows;
  const url =
    `${FAPI}/futures/data/basis?pair=${encodeURIComponent(safePair)}&contractType=PERPETUAL` +
    `&period=${encodeURIComponent(safePeriod)}&limit=${safeLimit}`;
  const raw = await requestJson<{ timestamp: number; futuresPrice: string; indexPrice: string; basis: string; basisRate: string }[]>(url, 'basis');
  if (!Array.isArray(raw)) throw new Error('basis invalid JSON');
  const rows = raw.slice(0, safeLimit).flatMap((p) => {
    const t = finiteNumber(p?.timestamp, 0);
    const futuresPrice = finiteNumber(p?.futuresPrice, 0);
    const indexPrice = finiteNumber(p?.indexPrice, 0);
    const basis = finiteNumber(p?.basis);
    const basisRate = finiteNumber(p?.basisRate);
    return t !== null && futuresPrice !== null && indexPrice !== null && basis !== null && basisRate !== null
      ? [{ t, futuresPrice, indexPrice, basis, basisRatePct: basisRate * 100 }]
      : [];
  });
  boundedMapSet(basisCache, key, { fetchedAt: Date.now(), rows });
  return rows;
}

// ---- open-interest history with caller-chosen period ------------------------
export interface OiHistPoint {
  t: number;
  contracts: number;
  notional: number;
}

const oiHistCache = new Map<string, { fetchedAt: number; rows: OiHistPoint[] }>();

export async function fetchOiHist(symbol: string, period: string, limit: number): Promise<OiHistPoint[]> {
  const safeSymbol = canonicalSymbol(symbol);
  const safePeriod = canonicalToken(period, 'period', 3);
  const safeLimit = boundedInteger(limit, 5, 200, 30);
  const key = `${safeSymbol}:${safePeriod}:${safeLimit}`;
  const hit = oiHistCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < 60_000) return hit.rows;
  type OI = { sumOpenInterest: string; sumOpenInterestValue: string; timestamp: string | number };
  const raw = await fetchFuturesData<OI>('openInterestHist', safeSymbol, safePeriod, safeLimit);
  const rows = raw.flatMap((p) => {
    const t = finiteNumber(p?.timestamp, 0);
    const contracts = finiteNumber(p?.sumOpenInterest, 0);
    const notional = finiteNumber(p?.sumOpenInterestValue, 0);
    return t !== null && contracts !== null && notional !== null ? [{ t, contracts, notional }] : [];
  });
  boundedMapSet(oiHistCache, key, { fetchedAt: Date.now(), rows });
  return rows;
}


// ---- funding rate history (fapi fundingRate — up to 1000 records ≈ 333d) ---
export interface FundingHistPoint {
  t: number;
  ratePct: number;
}

const fundingHistCache = new Map<string, { fetchedAt: number; rows: FundingHistPoint[] }>();

export async function fetchFundingHist(symbol: string, limit: number): Promise<FundingHistPoint[]> {
  const safeSymbol = canonicalSymbol(symbol);
  const safeLimit = boundedInteger(limit, 10, 1_000, 1_000);
  const key = `${safeSymbol}:${safeLimit}`;
  const hit = fundingHistCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < 10 * 60_000) return hit.rows;
  const raw = await requestJson<{ fundingTime: number; fundingRate: string }[]>(
    `${FAPI}/fapi/v1/fundingRate?symbol=${encodeURIComponent(safeSymbol)}&limit=${safeLimit}`,
    'fundingRate',
  );
  if (!Array.isArray(raw)) throw new Error('fundingRate invalid JSON');
  const rows = raw.slice(0, safeLimit).flatMap((p) => {
    const t = finiteNumber(p?.fundingTime, 0);
    const rate = finiteNumber(p?.fundingRate);
    return t !== null && rate !== null ? [{ t, ratePct: rate * 100 }] : [];
  });
  boundedMapSet(fundingHistCache, key, { fetchedAt: Date.now(), rows });
  return rows;
}
