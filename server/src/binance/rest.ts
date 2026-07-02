const SPOT_API = 'https://api.binance.com';
const FAPI = 'https://fapi.binance.com';

export interface PairedSymbol {
  symbol: string;
  base: string;
}

interface SpotExchangeInfo {
  symbols: {
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    isSpotTradingAllowed: boolean;
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

/**
 * Symbols that trade with the exact same name on spot and USDT-perp (e.g. BTCUSDT).
 * Multiplier contracts like 1000SHIBUSDT deliberately do NOT match — comparing them
 * to spot needs contract-size math, which is a later phase.
 */
export async function fetchPairedSymbols(): Promise<PairedSymbol[]> {
  const [spotRes, futRes] = await Promise.all([
    fetch(`${SPOT_API}/api/v3/exchangeInfo`),
    fetch(`${FAPI}/fapi/v1/exchangeInfo`),
  ]);
  if (!spotRes.ok) throw new Error(`spot exchangeInfo HTTP ${spotRes.status}`);
  if (!futRes.ok) throw new Error(`futures exchangeInfo HTTP ${futRes.status}`);
  const spot = (await spotRes.json()) as SpotExchangeInfo;
  const fut = (await futRes.json()) as FuturesExchangeInfo;

  const spotBases = new Map<string, string>();
  for (const s of spot.symbols) {
    if (
      s.status === 'TRADING' &&
      s.quoteAsset === 'USDT' &&
      s.isSpotTradingAllowed &&
      !EXCLUDED_BASES.has(s.baseAsset)
    ) {
      spotBases.set(s.symbol, s.baseAsset);
    }
  }

  const pairs: PairedSymbol[] = [];
  for (const f of fut.symbols) {
    if (
      f.status === 'TRADING' &&
      f.contractType === 'PERPETUAL' &&
      f.quoteAsset === 'USDT' &&
      spotBases.has(f.symbol)
    ) {
      pairs.push({ symbol: f.symbol, base: spotBases.get(f.symbol)! });
    }
  }
  return pairs;
}

export interface KlinePoint {
  t: number;
  v: number;
}

const klineCache = new Map<string, { fetchedAt: number; data: KlinePoint[] }>();
const KLINE_CACHE_MS = 60_000;

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<KlinePoint[]> {
  const key = `${symbol}:${interval}:${limit}`;
  const cached = klineCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < KLINE_CACHE_MS) return cached.data;

  const url = `${SPOT_API}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines HTTP ${res.status}`);
  const raw = (await res.json()) as [number, string, string, string, string, ...unknown[]][];
  const data = raw.map((k) => ({ t: k[0], v: Number(k[4]) }));
  klineCache.set(key, { fetchedAt: Date.now(), data });
  return data;
}
