import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';
import { MarketEngine } from './engine/marketData.js';
import { Scanner } from './engine/scanner.js';
import { Ledger } from './ledger.js';
import { loadConfig, saveConfig } from './config.js';
import {
  fetchBinanceServerTime,
  fetchAllBookTickers,
  fetchAllFutures24hTickers,
  fetchBookTicker,
  fetchDepth,
  fetchFundingHistory,
  fetchFuturesTelemetry,
  fetchKlineCandles,
  fetchKlines,
  fetchTrades,
  type BookTicker,
  type Futures24hTicker,
} from './binance/rest.js';
import { BinanceClient, credsFromEnv, maskApiKey, rateLimit } from './binance/client.js';
import { resolveIcons } from './binance/icons.js';
import { UserStream, type ExecutionReport } from './binance/userStream.js';
import { AccountService } from './services/account.js';
import { RiskService } from './services/risk.js';
import { OrderService } from './services/orders.js';
import { LoanService } from './services/loans.js';
import { BookStreamHub } from './services/bookStream.js';
import type { AppConfig, OrderIntent } from './types.js';

// Minimal .env loader (no dependency). Never logs values.
// SKIP_DOTENV lets the gates harness boot deterministically keyless, ignoring
// any developer .env on disk so the disconnected-state gates stay valid.
function loadDotEnv(): void {
  if (process.env.SKIP_DOTENV) return;
  try {
    const txt = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // no .env — fine
  }
}
loadDotEnv();

const PORT = Number(process.env.PORT ?? 8080);
const TICK_MS = 2_000;
const POLL_MS = 30_000;

const ledger = new Ledger(
  process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : undefined
);
const config = loadConfig(ledger);
const engine = new MarketEngine(ledger);
const scanner = new Scanner(config, ledger);

for (;;) {
  try {
    await engine.init();
    break;
  } catch (err) {
    console.error('engine init failed, retrying in 15s:', err);
    ledger.logEvent('error_event', null, { source: 'engine.init', message: String(err) });
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
engine.start();

const creds = credsFromEnv();
const client = creds ? new BinanceClient(creds) : null;
const account = new AccountService(client, ledger, (s) => engine.priceOf(s));
const risk = new RiskService(config, ledger);
const orders = new OrderService(client, engine.filters, (s) => engine.priceOf(s), risk, ledger, account);
const loans = new LoanService(client, config, ledger);

let userStream: UserStream | null = null;
if (client) {
  await account.sync();
  await orders.syncOpenOrders().catch(() => undefined);
  userStream = new UserStream(
    client,
    (ev) => {
      const e = ev.e as string | undefined;
      if (e === 'executionReport') {
        const r = ev as unknown as ExecutionReport;
        if (r.x === 'TRADE' && r.t >= 0) {
          account.recordFill({
            symbol: r.s,
            tradeId: r.t,
            orderId: r.i,
            side: r.S,
            price: Number(r.L),
            qty: Number(r.l),
            quoteQty: Number(r.L) * Number(r.l),
            commission: Number(r.n),
            commissionAsset: r.N,
            ts: r.T,
            source: 'user_stream',
          });
        }
        void orders.syncOpenOrders().catch(() => undefined);
      } else if (e === 'outboundAccountPosition') {
        account.applyStreamBalances(ev.B as { a: string; f: string; l: string }[]);
      }
    },
    (status, detail) => {
      ledger.logEvent('user_stream', null, { status, detail });
    }
  );
  void userStream.start();
  setInterval(() => void account.sync(), POLL_MS);
  setInterval(() => void orders.syncOpenOrders().catch(() => undefined), POLL_MS);
}

ledger.logEvent('engine.start', null, {
  pairs: engine.pairCount,
  keysPresent: account.keysPresent,
});
console.log(
  `cosmos control room: ${engine.pairCount} pairs, Binance keys ${account.keysPresent ? 'PRESENT' : 'absent'}, listening :${PORT}`
);

setInterval(() => {
  try {
    scanner.tick(engine.rows());
  } catch (err) {
    console.error('scanner tick failed:', err);
  }
}, TICK_MS);

function mode(): string {
  if (config.killSwitch) return 'HALTED';
  return config.liveTradingEnabled ? 'LIVE_ARMED' : 'MANUAL';
}

function buildState() {
  const eq = account.keysPresent ? account.equity() : null;
  const dayOpen = account.keysPresent ? account.dayOpenEquity() : null;
  const staleMs = config.staleOrderMaxMin * 60 * 1000;
  return {
    now: Date.now(),
    mode: mode(),
    binance: {
      keysPresent: account.keysPresent,
      connected: account.connected,
      lastSyncTs: account.lastSyncTs,
      lastError: account.lastError,
      canWithdraw: account.canWithdraw,
      canTrade: account.canTrade,
      userStream: userStream?.status ?? 'off',
      keyFingerprint: creds ? maskApiKey(creds.apiKey) : null,
    },
    feeds: engine.feeds,
    config,
    account: eq
      ? {
          totalUsdt: eq.totalUsdt,
          availableUsdt: eq.availableUsdt,
          dayOpenEquity: dayOpen,
          dayChangeUsd: dayOpen !== null ? eq.totalUsdt - dayOpen : null,
          realizedTodayUsd: account.realizedTodayUsd(),
          entries: eq.entries,
        }
      : null,
    positions: account.keysPresent ? account.positions() : [],
    openOrders: orders.openOrdersCache.map((o) => ({
      symbol: o.symbol,
      orderId: o.orderId,
      clientOrderId: o.clientOrderId ?? null,
      side: o.side,
      type: o.type,
      price: Number(o.price),
      origQty: Number(o.origQty),
      executedQty: Number(o.executedQty),
      status: o.status,
      time: o.time,
      stale: Date.now() - o.time > staleMs,
    })),
    recentFills: ledger.listFills(20),
    proposals: scanner.proposals(),
    scanner: {
      pairs: engine.pairCount,
      watching: scanner.watchingCount(),
      lastTickTs: scanner.lastTickTs,
      grossThresholdPct: scanner.grossThresholdPct,
    },
    risk: {
      dailyNotionalUsedUsd: risk.dailyNotionalUsedUsd(),
      lastOrderTs: risk.lastOrderTs(),
      rejectionsToday: risk.rejectionsTodayCount(),
    },
    events: ledger.recentEvents(30),
  };
}

const app = express();
app.use(express.json());

// Security headers. CSP allows exactly what the app uses: self-hosted
// scripts, inline styles (React style props), the two icon CDNs, and the
// app's own WebSocket. Nothing else loads, nothing can frame us.
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://s3.tradingview.com; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https://cdn.jsdelivr.net https://assets.coincap.io https://coin-images.coingecko.com https://assets.coingecko.com https://*.tradingview.com; " +
      "connect-src 'self' ws: wss: https://*.tradingview.com; frame-src https://www.tradingview.com https://s.tradingview.com https://www.tradingview-widget.com; font-src 'self'; object-src 'none'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

// ---- active session tracking ------------------------------------------------
// Records each visiting device by (IP + user-agent) so the account panel can
// show who is currently on the cockpit. Cloudflare injects the real IP + country
// in prod; on localhost it collapses to a single "local" session. Real, not faked.
interface Sess {
  id: string; ip: string; country: string | null; ua: string;
  system: string; browser: string; firstSeen: number; lastSeen: number; reqs: number;
}
const sessions = new Map<string, Sess>();

function parseUA(ua: string): { system: string; browser: string } {
  let system = 'Unknown OS';
  if (/iPhone|iPad/i.test(ua)) system = 'iOS';
  else if (/Android/i.test(ua)) system = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) system = 'macOS';
  else if (/Windows/i.test(ua)) system = 'Windows';
  else if (/Linux/i.test(ua)) system = 'Linux';
  const bm = ua.match(/(Edg|OPR|Chrome|Firefox|Safari)\/([\d.]+)/);
  const map: Record<string, string> = { Edg: 'Edge', OPR: 'Opera', Chrome: 'Chrome', Firefox: 'Firefox', Safari: 'Safari' };
  const bkey = bm ? Object.keys(map).find((k) => bm[0].startsWith(k)) ?? '' : '';
  const browser = bm ? `${map[bkey] ?? 'Browser'} ${bm[2].split('.')[0]}` : 'Browser';
  return { system, browser };
}
function sessKey(ip: string, ua: string): string {
  let h = 0;
  const s = `${ip}|${ua}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function reqIdent(req: express.Request): { id: string; ip: string; ua: string; country: string | null } {
  const ip = (req.headers['cf-connecting-ip'] as string) || 'local';
  const ua = (req.headers['user-agent'] as string) || 'unknown';
  const country = (req.headers['cf-ipcountry'] as string) || null;
  return { id: sessKey(ip, ua), ip, ua, country };
}

app.use((req, _res, next) => {
  const { id, ip, ua, country } = reqIdent(req);
  const now = Date.now();
  const s = sessions.get(id);
  if (s) {
    s.lastSeen = now;
    s.reqs++;
    if (country) s.country = country;
  } else {
    const { system, browser } = parseUA(ua);
    sessions.set(id, { id, ip, country, ua, system, browser, firstSeen: now, lastSeen: now, reqs: 1 });
  }
  for (const [k, v] of sessions) if (now - v.lastSeen > 30 * 60_000) sessions.delete(k);
  next();
});

app.get('/api/sessions', (req, res) => {
  const now = Date.now();
  const meId = reqIdent(req).id;
  const list = [...sessions.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((s) => ({
      id: s.id,
      ip: s.ip === 'local' ? null : s.ip,
      country: s.country,
      system: s.system,
      browser: s.browser,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      current: s.id === meId,
      active: now - s.lastSeen < 120_000,
    }));
  res.json({ sessions: list, now });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    pairs: engine.pairCount,
    feeds: engine.feeds,
    keysPresent: account.keysPresent,
    binanceConnected: account.connected,
    mode: mode(),
  });
});

app.get('/api/state', (_req, res) => {
  res.json(buildState());
});

app.get('/api/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const kind = req.query.kind ? String(req.query.kind) : undefined;
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
  const q = req.query.q ? String(req.query.q).slice(0, 60) : undefined;
  res.json(ledger.recentEvents(limit, kind, symbol, q));
});

// ---- Binance announcements proxy (real critical announcements; cached) ------
// New-listing / futures-launch announcements move markets, so they belong in an
// arbitrage cockpit. Fetched server-side (CORS + one shared cache), never faked.
// Categories map to Binance's own announcement catalog IDs.
type NewsItem = { id: number; title: string; date: string | null; url: string };
const NEWS_CATALOGS = new Set([48, 49, 93, 50, 161, 157, 51, 128]);
const newsCache = new Map<number, { at: number; items: NewsItem[] }>();
const newsInFlight = new Map<number, Promise<void>>();

async function refreshNews(catalogId: number): Promise<void> {
  const url = `https://www.binance.com/bapi/apex/v1/public/apex/cms/article/catalog/list/query?catalogId=${catalogId}&pageNo=1&pageSize=16`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { articles?: { id: number; code: string; title: string }[] } };
    const items: NewsItem[] = (json.data?.articles ?? []).map((a) => {
      const m = a.title.match(/\s*\((\d{4}-\d{2}-\d{2})\)\s*$/);
      return {
        id: a.id,
        title: m ? a.title.slice(0, m.index).trim() : a.title.trim(),
        date: m ? m[1] : null,
        url: `https://www.binance.com/en/support/announcement/${a.code}`,
      };
    });
    newsCache.set(catalogId, { at: Date.now(), items });
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/news', (req, res) => {
  const catalogId = NEWS_CATALOGS.has(Number(req.query.catalog)) ? Number(req.query.catalog) : 48;
  void (async () => {
    const cached = newsCache.get(catalogId);
    const fresh = cached && Date.now() - cached.at < 5 * 60_000;
    if (!fresh && !newsInFlight.has(catalogId)) {
      const p = refreshNews(catalogId)
        .catch((err) => {
          ledger.logEvent('error_event', null, { source: 'news.fetch', message: String(err) });
        })
        .finally(() => newsInFlight.delete(catalogId));
      newsInFlight.set(catalogId, p);
    }
    if (!newsCache.get(catalogId) && newsInFlight.has(catalogId)) await newsInFlight.get(catalogId)!.catch(() => undefined);
    const out = newsCache.get(catalogId);
    if (out) res.json({ catalog: catalogId, items: out.items, fetchedAt: out.at });
    else res.status(503).json({ error: 'binance announcements unavailable', items: [] });
  })();
});

// ---- TradingView economic calendar proxy (real events; cached 10 min) -------
type CalItem = {
  id: string; title: string; country: string; indicator: string; importance: number;
  period: string; actual: number | null; forecast: number | null; previous: number | null;
  unit: string | null; currency: string | null; date: string;
};
let calCache: { at: number; items: CalItem[] } | null = null;
let calInFlight: Promise<void> | null = null;

async function refreshCalendar(): Promise<void> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const to = new Date(now.getTime() + 6 * 86400_000).toISOString();
  const countries = 'US,EU,GB,JP,CN,IN,DE,CA,AU,FR';
  const url = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=${countries}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Origin: 'https://www.tradingview.com' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { result?: Record<string, unknown>[] };
    const items: CalItem[] = (json.result ?? []).map((e) => ({
      id: String(e.id),
      title: String(e.title ?? ''),
      country: String(e.country ?? ''),
      indicator: String(e.indicator ?? ''),
      importance: typeof e.importance === 'number' ? e.importance : -1,
      period: String(e.period ?? ''),
      actual: typeof e.actual === 'number' ? e.actual : null,
      forecast: typeof e.forecast === 'number' ? e.forecast : null,
      previous: typeof e.previous === 'number' ? e.previous : null,
      unit: (e.unit as string) ?? null,
      currency: (e.currency as string) ?? null,
      date: String(e.date ?? ''),
    }));
    calCache = { at: Date.now(), items };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/calendar', (_req, res) => {
  void (async () => {
    const fresh = calCache && Date.now() - calCache.at < 10 * 60_000;
    if (!fresh && !calInFlight) {
      calInFlight = refreshCalendar()
        .catch((err) => { ledger.logEvent('error_event', null, { source: 'calendar.fetch', message: String(err) }); })
        .finally(() => { calInFlight = null; });
    }
    if (!calCache && calInFlight) await calInFlight.catch(() => undefined);
    if (calCache) res.json({ items: calCache.items, fetchedAt: calCache.at });
    else res.status(503).json({ error: 'calendar unavailable', items: [] });
  })();
});

// ---- FX rates proxy (real USD rates; cached 30 min) -------------------------
let fxCache: { at: number; rates: Record<string, number> } | null = null;
let fxInFlight: Promise<void> | null = null;

async function refreshFx(): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (json.result !== 'success' || !json.rates) throw new Error('bad fx payload');
    fxCache = { at: Date.now(), rates: json.rates };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/fx', (_req, res) => {
  void (async () => {
    const fresh = fxCache && Date.now() - fxCache.at < 30 * 60_000;
    if (!fresh && !fxInFlight) {
      fxInFlight = refreshFx()
        .catch((err) => { ledger.logEvent('error_event', null, { source: 'fx.fetch', message: String(err) }); })
        .finally(() => { fxInFlight = null; });
    }
    if (!fxCache && fxInFlight) await fxInFlight.catch(() => undefined);
    if (fxCache) res.json({ base: 'USD', rates: fxCache.rates, fetchedAt: fxCache.at });
    else res.status(503).json({ error: 'fx unavailable', rates: {} });
  })();
});

app.get('/api/fills', (_req, res) => {
  res.json(ledger.listFills(200));
});

app.post('/api/fills/import', (req, res) => {
  void (async () => {
    const symbol = String((req.body as Record<string, unknown>).symbol ?? '');
    if (!client) {
      res.status(400).json({ error: 'Binance keys not configured' });
      return;
    }
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    try {
      const trades = await client.myTrades(symbol, 200);
      let imported = 0;
      for (const t of trades) {
        const isNew = ledger.insertFill({
          symbol: t.symbol,
          tradeId: t.id,
          orderId: t.orderId,
          side: t.isBuyer ? 'BUY' : 'SELL',
          price: Number(t.price),
          qty: Number(t.qty),
          quoteQty: Number(t.quoteQty),
          commission: Number(t.commission),
          commissionAsset: t.commissionAsset,
          ts: t.time,
          source: 'import',
        });
        if (isNew) imported++;
      }
      ledger.logEvent('manual_action', symbol, { action: 'import_fills', imported, fetched: trades.length });
      res.json({ imported, fetched: trades.length });
    } catch (err) {
      res.status(502).json({ error: String((err as Error).message) });
    }
  })();
});

function usableBook(b: BookTicker | undefined): BookTicker | null {
  if (!b || !(b.bidPrice > 0) || !(b.askPrice > 0) || b.askPrice < b.bidPrice) return null;
  return b;
}

function spreadPct(b: BookTicker | null): number | null {
  if (!b) return null;
  const mid = (b.bidPrice + b.askPrice) / 2;
  return mid > 0 ? ((b.askPrice - b.bidPrice) / mid) * 100 : null;
}

function topQuoteUsd(b: BookTicker | null): number | null {
  if (!b) return null;
  const bidQuote = b.bidPrice * b.bidQty;
  const askQuote = b.askPrice * b.askQty;
  const usable = Math.min(bidQuote, askQuote);
  return Number.isFinite(usable) && usable > 0 ? usable : null;
}

function gapPct(a: number | null, b: number | null, den: number | null): number | null {
  if (a === null || b === null || den === null || den <= 0) return null;
  return ((a - b) / den) * 100;
}

// Full market list for the Markets page: all exact spot+perp pairs plus
// spot-only Binance USDT symbols. The account WS payload stays light while
// this endpoint carries screener-grade market facts.
app.get('/api/markets', (_req, res) => {
  void (async () => {
    const [spotBookRes, perpBookRes, perp24hRes] = await Promise.allSettled([
      fetchAllBookTickers('spot'),
      fetchAllBookTickers('futures'),
      fetchAllFutures24hTickers(),
    ]);
    const spotBooks = spotBookRes.status === 'fulfilled' ? spotBookRes.value : new Map<string, BookTicker>();
    const perpBooks = perpBookRes.status === 'fulfilled' ? perpBookRes.value : new Map<string, BookTicker>();
    const perp24h = perp24hRes.status === 'fulfilled' ? perp24hRes.value : new Map<string, Futures24hTicker>();

    const rows = engine
      .allRows()
      .map((r) => {
        const spotBook = usableBook(spotBooks.get(r.symbol));
        const perpBook = r.hasPerp ? usableBook(perpBooks.get(r.symbol)) : null;
        const perpTicker = r.hasPerp ? perp24h.get(r.symbol) : undefined;
        const perpVolume24h = perpTicker?.quoteVolume ?? null;
        const executableBasisLongSpotPct = gapPct(perpBook?.bidPrice ?? null, spotBook?.askPrice ?? null, spotBook?.askPrice ?? null);
        const executableBasisShortSpotPct = gapPct(spotBook?.bidPrice ?? null, perpBook?.askPrice ?? null, perpBook?.askPrice ?? null);
        const executableBasisBestPct =
          executableBasisLongSpotPct === null
            ? executableBasisShortSpotPct
            : executableBasisShortSpotPct === null
              ? executableBasisLongSpotPct
              : Math.max(executableBasisLongSpotPct, executableBasisShortSpotPct);
        const executableBasisSide =
          executableBasisBestPct === null
            ? null
            : executableBasisBestPct === executableBasisLongSpotPct
              ? ('LONG_SPOT_SHORT_PERP' as const)
              : ('SHORT_SPOT_LONG_PERP' as const);
        return {
          ...r,
          status: r.hasPerp ? scanner.statusOf(r.symbol) : ('idle' as const),
          spark: engine.sparkOf(r.symbol, 36),
          spotBid: spotBook?.bidPrice ?? null,
          spotAsk: spotBook?.askPrice ?? null,
          spotBidQty: spotBook?.bidQty ?? null,
          spotAskQty: spotBook?.askQty ?? null,
          spotSpreadPct: spreadPct(spotBook),
          spotTopQuoteUsd: topQuoteUsd(spotBook),
          perpBid: perpBook?.bidPrice ?? null,
          perpAsk: perpBook?.askPrice ?? null,
          perpBidQty: perpBook?.bidQty ?? null,
          perpAskQty: perpBook?.askQty ?? null,
          perpSpreadPct: spreadPct(perpBook),
          perpTopQuoteUsd: topQuoteUsd(perpBook),
          perpLast: perpTicker?.lastPrice ?? null,
          perpChange24hPct: perpTicker?.priceChangePct ?? null,
          perpVolume24h,
          perpHigh24h: perpTicker?.highPrice ?? null,
          perpLow24h: perpTicker?.lowPrice ?? null,
          oiToPerpVolume24h:
            r.openInterestUsd !== null && r.openInterestUsd !== undefined && perpVolume24h !== null && perpVolume24h > 0
              ? r.openInterestUsd / perpVolume24h
              : null,
          executableBasisLongSpotPct,
          executableBasisShortSpotPct,
          executableBasisBestPct,
          executableBasisSide,
          fundingAnnualPct: r.fundingRate === null ? null : r.fundingRate * 3 * 365 * 100,
        };
      })
      .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0));
    res.json({
      updatedAt: Date.now(),
      dataSources: {
        spotBookTicker: spotBookRes.status === 'fulfilled' ? 'fresh' : 'unavailable',
        futuresBookTicker: perpBookRes.status === 'fulfilled' ? 'fresh' : 'unavailable',
        futures24hTicker: perp24hRes.status === 'fulfilled' ? 'fresh' : 'unavailable',
      },
      rows,
    });
  })();
});

app.get('/api/market/detail', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? '');
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    const row = engine
      .allRows()
      .map((r) => ({ ...r, status: r.hasPerp ? scanner.statusOf(r.symbol) : ('idle' as const) }))
      .find((r) => r.symbol === symbol);
    let book = null;
    try {
      book = await fetchBookTicker(symbol);
    } catch {
      // ok — book optional
    }
    res.json({
      row: row ?? null,
      book,
      filters: engine.filters.get(symbol) ?? null,
      last: engine.priceOf(symbol),
      change24hPct: engine.changeOf(symbol),
      watchlisted: config.watchlist.includes(symbol),
      allowlisted: config.allowedSymbols.includes(symbol),
    });
  })();
});

app.get('/api/loans', (req, res) => {
  void (async () => {
    res.json(await loans.snapshot(req.query.force === '1'));
  })();
});

app.post('/api/loans/borrow', (req, res) => {
  void (async () => {
    const b = req.body as Record<string, unknown>;
    const loanCoin = String(b.loanCoin ?? '').toUpperCase();
    const collateralCoin = String(b.collateralCoin ?? '').toUpperCase();
    const amount = Number(b.amount);
    if (!/^[A-Z0-9]{2,10}$/.test(loanCoin) || !/^[A-Z0-9]{2,10}$/.test(collateralCoin) || !(amount > 0)) {
      res.status(400).json({ error: 'bad borrow request' });
      return;
    }
    res.json(await loans.borrow(loanCoin, collateralCoin, amount, String(b.confirmCoin ?? '')));
  })();
});

app.post('/api/loans/repay', (req, res) => {
  void (async () => {
    const b = req.body as Record<string, unknown>;
    const loanCoin = String(b.loanCoin ?? '').toUpperCase();
    const collateralCoin = String(b.collateralCoin ?? '').toUpperCase();
    const amount = Number(b.amount);
    if (!/^[A-Z0-9]{2,10}$/.test(loanCoin) || !/^[A-Z0-9]{2,10}$/.test(collateralCoin) || !(amount > 0)) {
      res.status(400).json({ error: 'bad repay request' });
      return;
    }
    res.json(await loans.repay(loanCoin, collateralCoin, amount));
  })();
});

app.get('/api/orders/history', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? '');
    if (!client) {
      res.json({ available: false, error: 'Binance keys not configured', orders: [] });
      return;
    }
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    try {
      const all = await client.allOrders(symbol, 100);
      res.json({ available: true, orders: all.reverse() });
    } catch (err) {
      res.json({ available: false, error: String((err as Error).message), orders: [] });
    }
  })();
});

app.get('/api/pnl', (_req, res) => {
  const { realizedByDay, realizedBySymbol, feesByAsset } = account.pnl();
  const days = [...realizedByDay.entries()]
    .map(([day, usd]) => ({ day, usd }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const bySymbol = [...realizedBySymbol.entries()]
    .map(([symbol, usd]) => ({ symbol, usd }))
    .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd));
  const fees = [...feesByAsset.entries()].map(([asset, amount]) => ({ asset, amount }));
  const snapshots = ledger
    .recentEvents(500, 'account_snapshot')
    .map((ev) => ({ ts: ev.ts, totalUsdt: (ev.data as { totalUsdt?: number } | null)?.totalUsdt ?? null }))
    .filter((s) => s.totalUsdt !== null)
    .reverse();
  res.json({ realizedByDay: days, realizedBySymbol: bySymbol, feesByAsset: fees, equitySnapshots: snapshots });
});

app.get('/api/signals', (_req, res) => {
  res.json({ active: scanner.proposals(), recent: ledger.listSignals({ limit: 50 }) });
});

app.post('/api/proposals/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const p = scanner.proposals().find((x) => x.id === id);
  if (!p) {
    res.status(404).json({ error: 'proposal not active' });
    return;
  }
  // Approving NEVER sends an order. It returns a prefilled manual ticket.
  const intent: OrderIntent = {
    symbol: p.symbol,
    side: p.side === 'SHORT_PERP_LONG_SPOT' ? 'BUY' : 'SELL', // the SPOT leg of the basis trade
    type: 'LIMIT',
    price: p.spotPrice ?? undefined,
    source: 'proposal',
  };
  ledger.logEvent('manual_action', p.symbol, { action: 'approve_proposal', proposalId: id, intent });
  res.json({ intent, note: 'Prefilled ticket for the SPOT leg. The perp leg is not automated in v0.' });
});

app.post('/api/proposals/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const ok = scanner.dismiss(id);
  if (!ok) {
    res.status(404).json({ error: 'proposal not active' });
    return;
  }
  ledger.logEvent('manual_action', null, { action: 'reject_proposal', proposalId: id });
  res.json({ ok: true });
});

// Token icon manifest: resolved real logo URLs (CoinGecko) for the requested
// bases. Unknown ones resolve in the background and appear on a later call.
app.get('/api/icons', (req, res) => {
  const bases = String(req.query.bases ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((b) => /^[A-Z0-9]{1,12}$/.test(b))
    .slice(0, 200);
  res.json(resolveIcons(bases));
});

app.get('/api/market/quote', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? '');
    if (!/^[A-Z0-9]{4,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    const last = engine.priceOf(symbol);
    let book = null;
    try {
      book = await fetchBookTicker(symbol);
    } catch {
      // book unavailable — last price may still exist
    }
    res.json({ symbol, last, change24hPct: engine.changeOf(symbol), book, tradable: engine.filters.has(symbol) });
  })();
});

const KLINE_INTERVALS = new Set(['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w']);
const FUTURES_DATA_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
app.get('/api/klines', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? 'BTCUSDT');
    const interval = String(req.query.interval ?? '5m');
    const limit = Math.min(Number(req.query.limit ?? 288), 1000);
    const market = req.query.market === 'futures' ? 'futures' : 'spot';
    const field = req.query.field === 'volume' ? 'volume' : 'close';
    if (!KLINE_INTERVALS.has(interval) || !/^[A-Z0-9]{1,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol or interval' });
      return;
    }
    try {
      res.json(await fetchKlines(symbol, interval, limit, market, field));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  })();
});

app.get('/api/candles', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? 'BTCUSDT');
    const interval = String(req.query.interval ?? '5m');
    const limit = Math.min(Number(req.query.limit ?? 288), 1000);
    const market = req.query.market === 'futures' ? 'futures' : 'spot';
    if (!KLINE_INTERVALS.has(interval) || !/^[A-Z0-9]{1,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol or interval' });
      return;
    }
    try {
      res.json(await fetchKlineCandles(symbol, interval, limit, market));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  })();
});

app.get('/api/market/depth', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? '');
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    try {
      res.json(await fetchDepth(symbol, 20));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  })();
});

app.get('/api/market/trades', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? '');
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    try {
      res.json(await fetchTrades(symbol, 30));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  })();
});

app.get('/api/funding/history', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? '');
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    try {
      res.json(await fetchFundingHistory(symbol));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  })();
});

app.get('/api/futures/telemetry', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? '');
    const period = String(req.query.period ?? '5m');
    const limit = Math.min(Number(req.query.limit ?? 40), 120);
    if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !FUTURES_DATA_PERIODS.has(period)) {
      res.status(400).json({ error: 'bad symbol or period' });
      return;
    }
    try {
      res.json(await fetchFuturesTelemetry(symbol, period, limit));
    } catch (err) {
      res.status(502).json({ error: String((err as Error).message) });
    }
  })();
});

// Live funding extremes across all pairs — the data behind the funding monitor.
app.get('/api/funding/extremes', (_req, res) => {
  const rows = engine
    .rows()
    .filter((r) => r.fundingRate !== null && (r.quoteVolume24h ?? 0) >= config.minQuoteVolume24h);
  const sorted = [...rows].sort((a, b) => (b.fundingRate ?? 0) - (a.fundingRate ?? 0));
  res.json({
    positive: sorted.slice(0, 10),
    negative: sorted.slice(-10).reverse(),
    updatedAt: Date.now(),
  });
});

// Everything the app knows about ONE symbol (for the token detail page).
app.get('/api/symbol/context', (req, res) => {
  const symbol = String(req.query.symbol ?? '');
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    res.status(400).json({ error: 'bad symbol' });
    return;
  }
  const base = symbol.replace(/USDT$/, '');
  const eq = account.keysPresent ? account.equity() : null;
  const baseBal = eq?.entries.find((e) => e.asset === base);
  res.json({
    openOrders: orders.openOrdersCache.filter((o) => o.symbol === symbol),
    fills: ledger.listFills(20, symbol),
    signals: ledger.listSignalsForSymbol(symbol, 10),
    balances: {
      base: baseBal ? baseBal.free + baseBal.locked : 0,
      usdtFree: eq?.availableUsdt ?? null,
    },
    allowlisted: config.allowedSymbols.includes(symbol),
    blocklisted: config.blockedSymbols.includes(symbol),
  });
});

app.post('/api/orders/cancel-all', (req, res) => {
  void (async () => {
    const symbol = String((req.body as Record<string, unknown>).symbol ?? '');
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    if (!client) {
      res.json({ ok: false, error: 'Binance keys not configured' });
      return;
    }
    ledger.logEvent('manual_action', symbol, { action: 'cancel_all_orders' });
    try {
      await client.cancelAllOrders(symbol);
      ledger.logEvent('order_response', symbol, { status: 'ALL_CANCELED', executedQuoteUsd: 0 });
      await orders.syncOpenOrders().catch(() => undefined);
      res.json({ ok: true });
    } catch (err) {
      const msg = String((err as Error).message);
      ledger.logEvent('error_event', symbol, { source: 'order.cancelAll', message: msg });
      res.json({ ok: false, error: msg });
    }
  })();
});

app.get('/api/loans/max-borrowable', (req, res) => {
  void (async () => {
    const asset = String(req.query.asset ?? '').toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(asset)) {
      res.status(400).json({ error: 'bad asset' });
      return;
    }
    res.json(await loans.maxBorrowable(asset));
  })();
});

// System health for the dedicated page.
const bootTs = Date.now();
let timeSync: { diffMs: number; latencyMs: number; ts: number } | null = null;
app.get('/api/system', (req, res) => {
  void (async () => {
    if (!timeSync || Date.now() - timeSync.ts > 60_000) {
      try {
        const t = await fetchBinanceServerTime();
        timeSync = { ...t, ts: Date.now() };
      } catch {
        timeSync = null;
      }
    }
    let dbOk = true;
    try {
      ledger.getConfigValue('app');
    } catch {
      dbOk = false;
    }
    res.json({
      ok: true,
      uptimeSec: Math.round((Date.now() - bootTs) / 1000),
      version: '1.1.0',
      env: process.env.NODE_ENV ?? 'production',
      feeds: engine.feeds,
      pairs: engine.pairCount,
      binance: {
        keysPresent: account.keysPresent,
        connected: account.connected,
        lastSyncTs: account.lastSyncTs,
        lastError: account.lastError,
        userStream: userStream?.status ?? 'off',
        keyFingerprint: creds ? maskApiKey(creds.apiKey) : null,
      },
      restLatencyMs: timeSync?.latencyMs ?? null,
      serverTimeDiffMs: timeSync?.diffMs ?? null,
      usedWeight1m: rateLimit.ts > 0 ? rateLimit.usedWeight1m : null,
      usedWeightTs: rateLimit.ts || null,
      lastScannerTickTs: scanner.lastTickTs,
      lastOrdersSyncTs: orders.lastOrdersSyncTs,
      dbOk,
      killSwitch: config.killSwitch,
      liveTradingEnabled: config.liveTradingEnabled,
      cfUser: (req.headers['cf-access-authenticated-user-email'] as string | undefined) ?? null,
      // Real edge session facts from Cloudflare (present in prod; null on localhost).
      cfIp: (req.headers['cf-connecting-ip'] as string | undefined) ?? null,
      cfCountry: (req.headers['cf-ipcountry'] as string | undefined) ?? null,
      cfRay: (req.headers['cf-ray'] as string | undefined) ?? null,
      serverStartTs: bootTs,
    });
  })();
});

app.get('/api/config', (_req, res) => {
  res.json(config);
});

const NUMERIC_KEYS: (keyof AppConfig)[] = [
  'feesPct',
  'minNetBasisPct',
  'persistTicks',
  'minQuoteVolume24h',
  'maxOrderNotionalUsd',
  'maxDailyNotionalUsd',
  'maxDailyLossUsd',
  'maxOpenOrders',
  'cooldownSec',
  'staleOrderMaxMin',
];
const LIST_KEYS: (keyof AppConfig)[] = ['allowedSymbols', 'blockedSymbols', 'watchlist'];

app.post('/api/config', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {}; // applied to config
  const logPatch: Record<string, unknown> = {}; // written to the ledger (no image bytes)
  for (const key of NUMERIC_KEYS) {
    const v = body[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      patch[key] = v;
      logPatch[key] = v;
    }
  }
  for (const key of LIST_KEYS) {
    const v = body[key];
    if (Array.isArray(v) && v.every((x) => typeof x === 'string' && /^[A-Z0-9]{4,20}$/.test(x))) {
      patch[key] = [...new Set(v)];
      logPatch[key] = patch[key];
    }
  }
  // owner profile: short name + small data-URL avatar (server-side, follows the box)
  if (body.profile && typeof body.profile === 'object') {
    const p = body.profile as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.slice(0, 40) : config.profile.name;
    const avatar =
      p.avatar === null
        ? null
        : typeof p.avatar === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(p.avatar) && p.avatar.length <= 160_000
          ? p.avatar
          : config.profile.avatar;
    patch.profile = { name, avatar };
    logPatch.profile = { name, avatar: avatar ? '(image set)' : null };
  }
  // custom governance rules (recorded + ledgered; strict ones feed the risk gate at live-mode wiring)
  if (Array.isArray(body.customRules)) {
    const scopes = new Set(['orders', 'symbols', 'strategy', 'hours', 'general']);
    const effects = new Set(['allow', 'block', 'limit']);
    const rules = (body.customRules as Record<string, unknown>[])
      .filter((r) => r && typeof r === 'object')
      .slice(0, 50)
      .map((r, i) => ({
        id: String(r.id ?? '').slice(0, 40) || `rule_${Date.now()}_${i}`,
        name: String(r.name ?? '').slice(0, 80),
        scope: scopes.has(String(r.scope)) ? (String(r.scope) as AppConfig['customRules'][number]['scope']) : 'general',
        effect: effects.has(String(r.effect)) ? (String(r.effect) as AppConfig['customRules'][number]['effect']) : 'block',
        note: String(r.note ?? '').slice(0, 240),
        strict: r.strict === true,
        createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      }))
      .filter((r) => r.name.length > 0);
    patch.customRules = rules;
    logPatch.customRules = rules.map((r) => `${r.effect}:${r.name}${r.strict ? ' (strict)' : ''}`);
  }
  Object.assign(config, patch);
  saveConfig(ledger, config);
  ledger.logEvent('config_change', null, logPatch);
  res.json(config);
});

app.post('/api/kill', (req, res) => {
  config.killSwitch = Boolean((req.body as Record<string, unknown>).on);
  saveConfig(ledger, config);
  ledger.logEvent('manual_action', null, { action: 'kill_switch', on: config.killSwitch });
  res.json({ killSwitch: config.killSwitch });
});

app.post('/api/live', (req, res) => {
  config.liveTradingEnabled = Boolean((req.body as Record<string, unknown>).on);
  saveConfig(ledger, config);
  ledger.logEvent('manual_action', null, { action: 'live_trading', on: config.liveTradingEnabled });
  res.json({ liveTradingEnabled: config.liveTradingEnabled });
});

function parseIntent(body: Record<string, unknown>): OrderIntent | null {
  const symbol = String(body.symbol ?? '').toUpperCase();
  const side = body.side === 'SELL' ? 'SELL' : body.side === 'BUY' ? 'BUY' : null;
  const type = body.type === 'LIMIT' ? 'LIMIT' : body.type === 'MARKET' ? 'MARKET' : null;
  if (!/^[A-Z0-9]{4,20}$/.test(symbol) || !side || !type) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const tif = body.timeInForce === 'IOC' ? 'IOC' : body.timeInForce === 'FOK' ? 'FOK' : 'GTC';
  return {
    symbol,
    side,
    type,
    quantity: num(body.quantity),
    quoteQty: num(body.quoteQty),
    price: num(body.price),
    timeInForce: tif,
    source: body.source === 'proposal' ? 'proposal' : 'manual',
  };
}

app.post('/api/trade/preview', (req, res) => {
  const intent = parseIntent(req.body as Record<string, unknown>);
  if (!intent) {
    res.status(400).json({ error: 'invalid order intent' });
    return;
  }
  res.json(orders.preview(intent));
});

app.post('/api/trade/test', (req, res) => {
  void (async () => {
    const intent = parseIntent(req.body as Record<string, unknown>);
    if (!intent) {
      res.status(400).json({ error: 'invalid order intent' });
      return;
    }
    res.json(await orders.testOrder(intent));
  })();
});

app.post('/api/trade/send', (req, res) => {
  void (async () => {
    const body = req.body as Record<string, unknown>;
    const intent = parseIntent(body);
    if (!intent) {
      res.status(400).json({ error: 'invalid order intent' });
      return;
    }
    const confirmSymbol = String(body.confirmSymbol ?? '');
    res.json(await orders.send(intent, confirmSymbol));
  })();
});

app.post('/api/orders/cancel', (req, res) => {
  void (async () => {
    const body = req.body as Record<string, unknown>;
    const symbol = String(body.symbol ?? '');
    const orderId = Number(body.orderId);
    if (!/^[A-Z0-9]{4,20}$/.test(symbol) || !Number.isInteger(orderId)) {
      res.status(400).json({ error: 'bad cancel request' });
      return;
    }
    res.json(await orders.cancel(symbol, orderId));
  })();
});

// Serve the built dashboard (web/dist) with SPA fallback.
const webDist = path.resolve(process.cwd(), 'web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Live order-book/trade fan-out (public market data only, symbol-validated).
const bookHub = new BookStreamHub((s) => engine.filters.has(s));
wss.on('connection', (ws) => {
  ws.on('message', (buf) => {
    try {
      bookHub.handleMessage(ws, JSON.parse(buf.toString()));
    } catch {
      // ignore malformed client frames
    }
  });
  ws.on('close', () => bookHub.drop(ws));
});

function broadcast(msg: unknown): void {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(s);
  }
}

setInterval(() => broadcast({ type: 'state', payload: buildState() }), TICK_MS);
ledger.on('event', (ev) => broadcast({ type: 'event', payload: ev }));

server.listen(PORT, () => {
  console.log(`cosmos control room listening on http://localhost:${PORT}`);
});
