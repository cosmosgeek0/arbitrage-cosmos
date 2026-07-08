/* Money Flow — Binance's token-page money-flow analysis computed from REAL
 * spot aggTrades. Every aggregate trade in the window is classified by taker
 * side (isBuyerMaker=false → taker BUY) and by notional size using Binance's
 * order-size convention: Large ≥ $100K · Medium $10K–$100K · Small < $10K.
 * Sums are in BASE units (what the Binance widget shows). High-volume windows
 * walk BACKWARD from now so a pagination cap keeps the most recent trades and
 * reports honest coverage instead of silently truncating the wrong end. */

const API = 'https://api.binance.com';
const MAX_CALLS = 60; // 60k aggTrades ceiling per refresh

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

const cache = new Map<string, { fetchedAt: number; data: MoneyFlow }>();
const CACHE_MS = 45_000;

export async function fetchMoneyFlow(symbol: string, window: string): Promise<MoneyFlow | null> {
  const windowMs = FLOW_WINDOWS[window];
  if (!windowMs) return null;
  const key = `${symbol}:${window}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit.data;

  const now = Date.now();
  const start = now - windowMs;
  const flow: MoneyFlow = {
    symbol,
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
    const res = await fetch(`${API}/api/v3/aggTrades?symbol=${encodeURIComponent(symbol)}&endTime=${cursorEnd}&limit=1000`);
    if (!res.ok) break;
    const rows = (await res.json()) as AggTrade[];
    if (!rows.length) break;
    for (const tr of rows) {
      if (tr.T < start) continue;
      const price = Number(tr.p);
      const qty = Number(tr.q);
      const quote = price * qty;
      const bucket = quote >= 100_000 ? flow.large : quote >= 10_000 ? flow.medium : flow.small;
      if (tr.m) {
        bucket.sell += qty;
        flow.totalSell += qty;
      } else {
        bucket.buy += qty;
        flow.totalBuy += qty;
      }
      flow.trades++;
    }
    oldestSeen = Math.min(oldestSeen, rows[0].T);
    if (rows[0].T <= start) break;
    if (rows.length < 1000) {
      oldestSeen = Math.min(oldestSeen, start);
      break;
    }
    cursorEnd = rows[0].T - 1;
  }

  flow.coveredMs = now - Math.max(oldestSeen, start);
  flow.sampled = oldestSeen > start + 1_000;
  flow.inflow = flow.totalBuy - flow.totalSell;
  cache.set(key, { fetchedAt: now, data: flow });
  return flow;
}
