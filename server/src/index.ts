import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';
import { MarketEngine } from './engine/marketData.js';
import { Scanner } from './engine/scanner.js';
import { Ledger } from './ledger.js';
import { loadConfig, saveConfig } from './config.js';
import { fetchKlines } from './binance/rest.js';
import type { AppConfig, SymbolRow } from './types.js';

const PORT = Number(process.env.PORT ?? 8080);
const TICK_MS = 2_000;

const ledger = new Ledger();
const config = loadConfig(ledger);
const engine = new MarketEngine(ledger);
const scanner = new Scanner(config, ledger);

// Boot: keep retrying exchangeInfo until Binance answers — the process is
// useless without the pair map, so there is nothing better to do than wait.
for (;;) {
  try {
    await engine.init();
    break;
  } catch (err) {
    console.error('engine init failed, retrying in 15s:', err);
    ledger.logEvent('engine.init_error', null, { message: String(err) });
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
engine.start();
ledger.logEvent('engine.start', null, { pairs: engine.pairCount });
console.log(`market engine started with ${engine.pairCount} spot+perp pairs`);

setInterval(() => {
  try {
    scanner.tick(engine.rows());
  } catch (err) {
    console.error('scanner tick failed:', err);
  }
}, TICK_MS);

function snapshot() {
  const rows: SymbolRow[] = engine
    .rows()
    .map((r) => ({ ...r, status: scanner.statusOf(r.symbol) }));

  const liquid = rows.filter(
    (r) => r.basisPct !== null && (r.quoteVolume24h ?? 0) >= config.minQuoteVolume24h
  );
  const topBasis = [...liquid]
    .sort((a, b) => Math.abs(b.basisPct!) - Math.abs(a.basisPct!))
    .slice(0, 8)
    .map((r) => ({ ...r, spark: engine.sparkOf(r.symbol).basis.slice(-40) }));
  const topMovers = rows
    .filter((r) => r.change24hPct !== null && (r.quoteVolume24h ?? 0) >= config.minQuoteVolume24h)
    .sort((a, b) => Math.abs(b.change24hPct!) - Math.abs(a.change24hPct!))
    .slice(0, 8)
    .map((r) => ({ ...r, spark: engine.sparkOf(r.symbol).price.slice(-40) }));
  const avgAbsBasis =
    liquid.length > 0
      ? liquid.reduce((sum, r) => sum + Math.abs(r.basisPct!), 0) / liquid.length
      : 0;

  return {
    updatedAt: Date.now(),
    stats: {
      pairs: engine.pairCount,
      liquidPairs: liquid.length,
      feeds: engine.feeds,
      activeSignals: scanner.activeSignals().length,
      watching: scanner.watchingCount(),
      avgAbsBasis,
      grossThresholdPct: scanner.grossThresholdPct,
      killSwitch: config.killSwitch,
      topBasis,
      topMovers,
    },
    rows,
  };
}

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    pairs: engine.pairCount,
    feeds: engine.feeds,
    killSwitch: config.killSwitch,
  });
});

app.get('/api/market', (_req, res) => {
  res.json(snapshot());
});

app.get('/api/spark', (req, res) => {
  const symbol = String(req.query.symbol ?? '');
  res.json(engine.sparkOf(symbol));
});

app.get('/api/signals', (_req, res) => {
  res.json({ active: scanner.activeSignals(), recent: ledger.listSignals({ limit: 50 }) });
});

app.get('/api/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  res.json(ledger.recentEvents(limit));
});

const KLINE_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d']);
app.get('/api/klines', async (req, res) => {
  const symbol = String(req.query.symbol ?? 'BTCUSDT');
  const interval = String(req.query.interval ?? '5m');
  const limit = Math.min(Number(req.query.limit ?? 288), 500);
  if (!KLINE_INTERVALS.has(interval) || !/^[A-Z0-9]{1,20}$/.test(symbol)) {
    res.status(400).json({ error: 'bad symbol or interval' });
    return;
  }
  try {
    res.json(await fetchKlines(symbol, interval, limit));
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.get('/api/config', (_req, res) => {
  res.json(config);
});

const NUMERIC_CONFIG_KEYS: (keyof AppConfig)[] = [
  'feesPct',
  'minNetBasisPct',
  'persistTicks',
  'minQuoteVolume24h',
];
app.post('/api/config', (req, res) => {
  const patch: Partial<AppConfig> = {};
  for (const key of NUMERIC_CONFIG_KEYS) {
    const v = (req.body as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      (patch as Record<string, number>)[key] = v;
    }
  }
  Object.assign(config, patch);
  saveConfig(ledger, config);
  ledger.logEvent('config.change', null, patch);
  res.json(config);
});

app.post('/api/kill', (req, res) => {
  config.killSwitch = Boolean((req.body as Record<string, unknown>).on);
  saveConfig(ledger, config);
  ledger.logEvent('killswitch', null, { on: config.killSwitch });
  res.json({ killSwitch: config.killSwitch });
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
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(s);
  }
}

setInterval(() => broadcast({ type: 'market', payload: snapshot() }), TICK_MS);
ledger.on('event', (ev) => broadcast({ type: 'event', payload: ev }));

server.listen(PORT, () => {
  console.log(`cosmos control room listening on http://localhost:${PORT}`);
});
