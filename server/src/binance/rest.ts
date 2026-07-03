const SPOT_API = 'https://api.binance.com';
const FAPI = 'https://fapi.binance.com';

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
  const [spotRes, futRes] = await Promise.all([
    fetch(`${SPOT_API}/api/v3/exchangeInfo`),
    fetch(`${FAPI}/fapi/v1/exchangeInfo`),
  ]);
  if (!spotRes.ok) throw new Error(`spot exchangeInfo HTTP ${spotRes.status}`);
  if (!futRes.ok) throw new Error(`futures exchangeInfo HTTP ${futRes.status}`);
  const spot = (await spotRes.json()) as SpotExchangeInfo;
  const fut = (await futRes.json()) as FuturesExchangeInfo;

  const filters = new Map<string, SymbolFilters>();
  const pairableBases = new Map<string, string>();
  for (const s of spot.symbols) {
    if (s.status !== 'TRADING' || s.quoteAsset !== 'USDT' || !s.isSpotTradingAllowed) continue;
    const lot = s.filters.find((f) => f.filterType === 'LOT_SIZE') as
      | { stepSize: string; minQty: string }
      | undefined;
    const priceF = s.filters.find((f) => f.filterType === 'PRICE_FILTER') as
      | { tickSize: string }
      | undefined;
    const notional = s.filters.find((f) => f.filterType === 'NOTIONAL') as
      | { minNotional: string }
      | undefined;
    filters.set(s.symbol, {
      symbol: s.symbol,
      base: s.baseAsset,
      quote: s.quoteAsset,
      status: s.status,
      stepSize: Number(lot?.stepSize ?? 0),
      minQty: Number(lot?.minQty ?? 0),
      tickSize: Number(priceF?.tickSize ?? 0),
      minNotional: Number(notional?.minNotional ?? 0),
    });
    if (!EXCLUDED_BASES.has(s.baseAsset)) pairableBases.set(s.symbol, s.baseAsset);
  }

  const pairs: PairedSymbol[] = [];
  for (const f of fut.symbols) {
    if (
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
}

const bookCache = new Map<string, { fetchedAt: number; data: BookTicker }>();
const BOOK_CACHE_MS = 2_000;

export async function fetchBookTicker(symbol: string): Promise<BookTicker> {
  const cached = bookCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < BOOK_CACHE_MS) return cached.data;
  const res = await fetch(`${SPOT_API}/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`bookTicker HTTP ${res.status}`);
  const raw = (await res.json()) as { symbol: string; bidPrice: string; bidQty: string; askPrice: string; askQty: string };
  const data: BookTicker = {
    symbol: raw.symbol,
    bidPrice: Number(raw.bidPrice),
    bidQty: Number(raw.bidQty),
    askPrice: Number(raw.askPrice),
    askQty: Number(raw.askQty),
  };
  bookCache.set(symbol, { fetchedAt: Date.now(), data });
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
  const url =
    market === 'futures'
      ? `${FAPI}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
      : `${SPOT_API}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines HTTP ${res.status}`);
  return (await res.json()) as [number, string, string, string, string, string, number, string, ...unknown[]][];
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
  market: 'spot' | 'futures' = 'spot',
  field: 'close' | 'volume' = 'close'
): Promise<KlinePoint[]> {
  const key = `${market}:${symbol}:${interval}:${limit}:${field}`;
  const cached = klineCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < KLINE_CACHE_MS) return cached.data;

  const raw = await fetchRawKlines(symbol, interval, limit, market);
  // k[4] = close, k[5] = base volume; volume is reported in quote terms (×close)
  const data = raw.map((k) => ({
    t: k[0],
    v: field === 'volume' ? Number(k[5]) * Number(k[4]) : Number(k[4]),
  }));
  klineCache.set(key, { fetchedAt: Date.now(), data });
  return data;
}

export async function fetchKlineCandles(
  symbol: string,
  interval: string,
  limit: number,
  market: 'spot' | 'futures' = 'spot'
): Promise<KlineCandle[]> {
  const key = `${market}:${symbol}:${interval}:${limit}:ohlcv`;
  const cached = candleCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < KLINE_CACHE_MS) return cached.data;
  const raw = await fetchRawKlines(symbol, interval, limit, market);
  const data = raw.map((k) => {
    const close = Number(k[4]);
    return {
      t: k[0],
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: close,
      v: Number(k[5]),
      qv: Number(k[7]) || Number(k[5]) * close,
    };
  });
  candleCache.set(key, { fetchedAt: Date.now(), data });
  return data;
}

export interface DepthLevel {
  price: number;
  qty: number;
}

const depthCache = new Map<string, { fetchedAt: number; data: { bids: DepthLevel[]; asks: DepthLevel[] } }>();

export async function fetchDepth(symbol: string, limit = 20): Promise<{ bids: DepthLevel[]; asks: DepthLevel[] }> {
  const cached = depthCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < 2_500) return cached.data;
  const res = await fetch(`${SPOT_API}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  if (!res.ok) throw new Error(`depth HTTP ${res.status}`);
  const raw = (await res.json()) as { bids: [string, string][]; asks: [string, string][] };
  const data = {
    bids: raw.bids.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
    asks: raw.asks.map(([p, q]) => ({ price: Number(p), qty: Number(q) })),
  };
  depthCache.set(symbol, { fetchedAt: Date.now(), data });
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
  const cached = tradesCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < 2_500) return cached.data;
  const res = await fetch(`${SPOT_API}/api/v3/trades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  if (!res.ok) throw new Error(`trades HTTP ${res.status}`);
  const raw = (await res.json()) as { id: number; price: string; qty: string; time: number; isBuyerMaker: boolean }[];
  const data = raw
    .map((t) => ({ id: t.id, price: Number(t.price), qty: Number(t.qty), time: t.time, isBuyerMaker: t.isBuyerMaker }))
    .reverse();
  tradesCache.set(symbol, { fetchedAt: Date.now(), data });
  return data;
}

const fundingCache = new Map<string, { fetchedAt: number; data: { t: number; v: number }[] }>();

/** Funding-rate history from the futures REST API (public), rate as percent. */
export async function fetchFundingHistory(symbol: string, limit = 120): Promise<{ t: number; v: number }[]> {
  const cached = fundingCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < 300_000) return cached.data;
  const res = await fetch(`${FAPI}/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  if (!res.ok) throw new Error(`fundingRate HTTP ${res.status}`);
  const raw = (await res.json()) as { fundingTime: number; fundingRate: string }[];
  const data = raw.map((r) => ({ t: r.fundingTime, v: Number(r.fundingRate) * 100 }));
  fundingCache.set(symbol, { fetchedAt: Date.now(), data });
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
  const url =
    `${FAPI}/futures/data/${pathName}?symbol=${encodeURIComponent(symbol)}` +
    `&period=${encodeURIComponent(period)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${pathName} HTTP ${res.status}`);
  return (await res.json()) as T[];
}

function settledValue<T>(r: PromiseSettledResult<T[]>, errors: string[]): T[] {
  if (r.status === 'fulfilled') return r.value;
  errors.push(String((r.reason as Error | undefined)?.message ?? r.reason));
  return [];
}

export async function fetchFuturesTelemetry(symbol: string, period = '5m', limit = 40): Promise<FuturesTelemetry> {
  const safeLimit = Math.max(5, Math.min(limit, 120));
  const key = `${symbol}:${period}:${safeLimit}`;
  const cached = futuresTelemetryCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < FUTURES_TELEMETRY_CACHE_MS) return cached.data;

  type OI = { sumOpenInterest: string; sumOpenInterestValue: string; timestamp: string | number };
  type Ratio = { longAccount: string; shortAccount: string; longShortRatio: string; timestamp: string | number };
  type Taker = { buySellRatio: string; buyVol: string; sellVol: string; timestamp: string | number };

  const [oiRes, topAccountRes, topPositionRes, globalRes, takerRes] = await Promise.allSettled([
    fetchFuturesData<OI>('openInterestHist', symbol, period, safeLimit),
    fetchFuturesData<Ratio>('topLongShortAccountRatio', symbol, period, safeLimit),
    fetchFuturesData<Ratio>('topLongShortPositionRatio', symbol, period, safeLimit),
    fetchFuturesData<Ratio>('globalLongShortAccountRatio', symbol, period, safeLimit),
    fetchFuturesData<Taker>('takerlongshortRatio', symbol, period, safeLimit),
  ]);

  const errors: string[] = [];
  const openInterest = settledValue(oiRes, errors).map((p) => ({
    t: Number(p.timestamp),
    contracts: Number(p.sumOpenInterest),
    notional: Number(p.sumOpenInterestValue),
  }));
  const mapRatio = (rows: Ratio[]) =>
    rows.map((p) => ({
      t: Number(p.timestamp),
      ratio: Number(p.longShortRatio),
      longPct: Number(p.longAccount) * 100,
      shortPct: Number(p.shortAccount) * 100,
    }));
  const topAccountRatio = mapRatio(settledValue(topAccountRes, errors));
  const topPositionRatio = mapRatio(settledValue(topPositionRes, errors));
  const globalRatio = mapRatio(settledValue(globalRes, errors));
  const takerFlow = settledValue(takerRes, errors).map((p) => ({
    t: Number(p.timestamp),
    buyVol: Number(p.buyVol),
    sellVol: Number(p.sellVol),
    ratio: Number(p.buySellRatio),
  }));

  const data: FuturesTelemetry = {
    symbol,
    period,
    updatedAt: Date.now(),
    available: openInterest.length + topAccountRatio.length + topPositionRatio.length + globalRatio.length + takerFlow.length > 0,
    errors,
    openInterest,
    topAccountRatio,
    topPositionRatio,
    globalRatio,
    takerFlow,
  };
  futuresTelemetryCache.set(key, { fetchedAt: Date.now(), data });
  return data;
}

export async function fetchBinanceServerTime(): Promise<{ diffMs: number; latencyMs: number }> {
  const t0 = Date.now();
  const res = await fetch(`${SPOT_API}/api/v3/time`);
  const t1 = Date.now();
  if (!res.ok) throw new Error(`time HTTP ${res.status}`);
  const { serverTime } = (await res.json()) as { serverTime: number };
  return { diffMs: serverTime - Math.round((t0 + t1) / 2), latencyMs: t1 - t0 };
}
