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
  fetchBookTicker,
  fetchDepth,
  fetchFundingHistory,
  fetchKlines,
  fetchTrades,
} from './binance/rest.js';
import { BinanceClient, credsFromEnv, rateLimit } from './binance/client.js';
import { UserStream, type ExecutionReport } from './binance/userStream.js';
import { AccountService } from './services/account.js';
import { RiskService } from './services/risk.js';
import { OrderService } from './services/orders.js';
import { LoanService } from './services/loans.js';
import type { AppConfig, OrderIntent } from './types.js';

// Minimal .env loader (no dependency). Never logs values.
function loadDotEnv(): void {
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
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https://cdn.jsdelivr.net https://assets.coincap.io; " +
      "connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
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

// Full market list for the Markets page: all exact spot+perp pairs with
// live spot/perp/basis/funding + a rolling spark. Separate from /api/state
// so the account WS payload stays light.
app.get('/api/markets', (_req, res) => {
  const rows = engine
    .allRows()
    .map((r) => ({
      ...r,
      status: r.hasPerp ? scanner.statusOf(r.symbol) : ('idle' as const),
      spark: engine.sparkOf(r.symbol, 36),
    }))
    .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0));
  res.json({ updatedAt: Date.now(), rows });
});

app.get('/api/market/detail', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? '');
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    const row = engine
      .rows()
      .map((r) => ({ ...r, status: scanner.statusOf(r.symbol) }))
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

const KLINE_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d']);
app.get('/api/klines', (req, res) => {
  void (async () => {
    const symbol = String(req.query.symbol ?? 'BTCUSDT');
    const interval = String(req.query.interval ?? '5m');
    const limit = Math.min(Number(req.query.limit ?? 288), 500);
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
  const patch: Record<string, unknown> = {};
  for (const key of NUMERIC_KEYS) {
    const v = body[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) patch[key] = v;
  }
  for (const key of LIST_KEYS) {
    const v = body[key];
    if (Array.isArray(v) && v.every((x) => typeof x === 'string' && /^[A-Z0-9]{4,20}$/.test(x))) {
      patch[key] = [...new Set(v)];
    }
  }
  Object.assign(config, patch);
  saveConfig(ledger, config);
  ledger.logEvent('config_change', null, patch);
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
