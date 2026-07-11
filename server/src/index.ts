import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
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
  fetchBasisHist,
  fetchFundingHist,
  fetchFuturesTelemetry,
  fetchOiHist,
  fetchKlineCandles,
  fetchKlines,
  fetchTrades,
  type BookTicker,
  type Futures24hTicker,
} from './binance/rest.js';
import { BinanceClient, credsFromEnv, maskApiKey, keyPosture, rateLimit } from './binance/client.js';
import { resolveIcons, STOCK_TOKENS } from './binance/icons.js';
import { tokenProfile, warmAllProfiles, profileWarmStatus } from './binance/profile.js';
import { fetchMoneyFlow, FLOW_WINDOWS } from './binance/moneyflow.js';
import { startLiquidationCollector, stopLiquidationCollector, liquidationSeries, liquidationStats } from './binance/liquidations.js';
import { UserStream, type ExecutionReport } from './binance/userStream.js';
import { AccountService } from './services/account.js';
import { RiskService } from './services/risk.js';
import { OrderService } from './services/orders.js';
import { LoanService } from './services/loans.js';
import { BookStreamHub } from './services/bookStream.js';
import { BasisRuntime } from './services/basisRuntime.js';
import { VolumeRuntime } from './services/volumeRuntime.js';
import { AwsRunnerControl, AwsRunnerControlError } from './services/awsRunnerControl.js';
import { getNewsContext, newsContextStatus, refreshNewsContextNow, scoreNewsImpact, subscribeNewsContext } from './services/newsContext.js';
import { OperatorAccess } from './security/access.js';
import type { AppConfig, ControlMode, ExecutionControlModes, OrderIntent } from './types.js';

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
const HOST = process.env.HOST ?? '127.0.0.1';
const TICK_MS = 2_000;
const POLL_MS = 30_000;
const SOURCE_LOGO_TTL_MS = 24 * 60 * 60 * 1000;
const SOURCE_LOGO_MAX_BYTES = 256 * 1024;
const DIRECT_SOURCE_LOGOS: Record<string, string> = {
  'financialjuice.com': 'https://www.financialjuice.com/favicon.ico',
};
type SourceLogoEntry = { ts: number; contentType: string; body: Buffer };
const SOURCE_LOGO_CACHE_MAX = 256;
const SOURCE_LOGO_FAILURE_TTL_MS = 60_000;
const sourceLogoCache = new Map<string, SourceLogoEntry>();
const sourceLogoInFlight = new Map<string, Promise<SourceLogoEntry>>();
const sourceLogoFailures = new Map<string, number>();

const ledger = new Ledger(
  process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : undefined
);
const awsRunnerControl = new AwsRunnerControl(ledger);
const config = loadConfig(ledger);
const engine = new MarketEngine(ledger);
const scanner = new Scanner(config, ledger);
const basisRuntime = new BasisRuntime(ledger, () => config, () => engine.allRows().map((row) => ({
  ...row,
  markUpdatedAt: engine.markEventTimestamp(row.symbol),
})));
const volumeRuntime = new VolumeRuntime(ledger, () => config, () => engine.allRows());
let shuttingDown = false;
let basisStartTimer: NodeJS.Timeout | null = null;
let volumeStartTimer: NodeJS.Timeout | null = null;

// The control plane, News and Calendar must stay available when Binance is
// temporarily unreachable. Market initialization retries in the background
// instead of blocking the HTTP server and every non-market route.
void (async () => {
  while (!shuttingDown) {
    try {
      await engine.init();
      if (shuttingDown) break;
      engine.start();
      basisStartTimer = setTimeout(() => {
        if (!shuttingDown) void basisRuntime.start();
      }, 3_000);
      volumeStartTimer = setTimeout(() => {
        if (!shuttingDown) void volumeRuntime.start();
      }, 5_000);
      break;
    } catch (err) {
      if (shuttingDown) break;
      console.error('engine init failed, retrying in 15s:', err);
      try {
        ledger.logEvent('error_event', null, { source: 'engine.init', message: String(err) });
      } catch {
        // Retry remains available while persistence is degraded.
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
})();

const creds = credsFromEnv();
const client = creds ? new BinanceClient(creds) : null;
const account = new AccountService(client, ledger, (s) => engine.priceOf(s));
const risk = new RiskService(config, ledger);
const orders = new OrderService(
  client,
  engine.filters,
  (s) => engine.priceOf(s),
  risk,
  ledger,
  account,
);
const loans = new LoanService(client, config, ledger, account, (symbol) => engine.priceOf(symbol));

function normalizeLogoDomain(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (!host) return null;
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9.-]{3,80}$/.test(host) || host.includes('..')) return null;
  if (host === 'localhost' || host.endsWith('.local') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  return host;
}

let userStream: UserStream | null = null;
let accountSyncTimer: NodeJS.Timeout | null = null;
let orderSyncTimer: NodeJS.Timeout | null = null;
let fillReconcileTimer: NodeJS.Timeout | null = null;

function fillReconciliationSymbols(): string[] {
  const symbols = new Set<string>([...config.allowedSymbols, ...config.watchlist]);
  for (const order of orders.openOrdersCache) symbols.add(order.symbol);
  for (const request of ledger.unresolvedOrderRequests(500)) symbols.add(request.symbol);
  for (const fill of ledger.listFills(200)) symbols.add(fill.symbol);
  for (const entry of account.equity().entries) {
    if (entry.asset !== 'USDT') {
      const symbol = `${entry.asset}USDT`;
      if (engine.filters.has(symbol)) symbols.add(symbol);
    }
  }
  return [...symbols];
}

async function reconcileAccountFills(): Promise<void> {
  if (!client || shuttingDown) return;
  account.setRequiredFillSymbols(fillReconciliationSymbols());
  await account.reconcileFills();
}

if (client) {
  await account.sync();
  await orders.syncOpenOrders().catch((error) => {
    safeLogEvent('error_event', null, { source: 'orders.initial_sync', message: error instanceof Error ? error.message : String(error) });
  });
  void orders.reconcilePendingOrders().catch((error) => {
    safeLogEvent('error_event', null, { source: 'orders.initial_reconciliation', message: error instanceof Error ? error.message : String(error) });
  });
  void reconcileAccountFills();
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
        void orders.syncOpenOrders().catch((error) => {
          safeLogEvent('error_event', r.s, { source: 'orders.stream_sync', message: error instanceof Error ? error.message : String(error) });
        });
      } else if (e === 'outboundAccountPosition') {
        account.applyStreamBalances(ev.B as { a: string; f: string; l: string }[], Number(ev.u));
      }
    },
    (status, detail) => {
      ledger.logEvent('user_stream', null, { status, detail });
      if (status === 'open') void reconcileAccountFills();
    }
  );
  void userStream.start();
  accountSyncTimer = setInterval(() => {
    void account.sync().catch((error) => {
      try {
        ledger.logEvent('error_event', null, { source: 'account.sync', message: error instanceof Error ? error.message : String(error) });
      } catch {
        // Health state in AccountService remains the primary signal.
      }
    });
  }, POLL_MS);
  orderSyncTimer = setInterval(() => {
    void (async () => {
      await orders.syncOpenOrders();
      await orders.reconcilePendingOrders();
    })().catch((error) => {
      safeLogEvent('error_event', null, { source: 'orders.periodic_sync', message: error instanceof Error ? error.message : String(error) });
    });
  }, POLL_MS);
  fillReconcileTimer = setInterval(() => {
    void reconcileAccountFills().catch((error) => {
      try {
        ledger.logEvent('error_event', null, {
          source: 'account.fill_reconciliation',
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // AccountService retains the reconciliation error for risk admission.
      }
    });
  }, POLL_MS);
}

ledger.logEvent('engine.start', null, {
  pairs: engine.pairCount,
  keysPresent: account.keysPresent,
});
console.log(
  `cosmos control room: ${engine.pairCount} pairs, Binance keys ${account.keysPresent ? 'PRESENT' : 'absent'}, booting ${HOST}:${PORT}`
);

const scannerTimer = setInterval(() => {
  try {
    scanner.tick(engine.rows());
  } catch (err) {
    console.error('scanner tick failed:', err);
  }
}, TICK_MS);

function pruneEphemeralLedgerEvents(maxBatches = 1): void {
  try {
    const now = Date.now();
    const batches = Math.max(1, Math.min(5, Math.trunc(maxBatches)));
    for (let batch = 0; batch < batches; batch += 1) {
      if (ledger.pruneEphemeralEvents(now, 10_000) < 10_000) break;
    }
  } catch (error) {
    safeLogEvent('error_event', null, {
      source: 'ledger.retention',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
// Drain a bounded historical backlog at boot, then maintain it incrementally.
pruneEphemeralLedgerEvents(5);
const eventRetentionTimer = setInterval(() => pruneEphemeralLedgerEvents(1), 10 * 60_000);

function mode(): string {
  if (config.killSwitch) return 'HALTED';
  return config.liveTradingEnabled ? 'LIVE_ARMED' : 'MANUAL';
}

function buildState() {
  const eq = account.keysPresent ? account.equity() : null;
  const dayOpen = account.keysPresent ? account.dayOpenEquity() : null;
  const dailyLossPolicy = account.keysPresent ? account.dailyLossPolicy() : null;
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
      keyPermissions: account.keyRestrictions,
      keyPermissionsTs: account.lastRestrictionsTs,
      keyPosture: keyPosture(account.keyRestrictions, account.keysPresent),
    },
    feeds: engine.feeds,
    config,
    account: eq
      ? {
          totalUsdt: eq.totalUsdt,
          availableUsdt: eq.availableUsdt,
          complete: eq.complete,
          sourceFresh: eq.sourceFresh,
          pricedAssets: eq.pricedAssets,
          unpricedAssets: eq.unpricedAssets,
          dayOpenEquity: dayOpen,
          dayChangeUsd: eq.complete && dayOpen !== null ? eq.totalUsdt - dayOpen : null,
          realizedTodayUsd: account.realizedTodayUsd(),
          dailyLossPolicy,
          fillReconciliation: account.fillReconciliationStatus(),
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
const operatorAccess = new OperatorAccess();
app.disable('x-powered-by');
app.disable('etag');

// These headers must cover every response, including authentication and JSON
// parser failures. CSP allows only the resources used by the existing UI.
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://s3.tradingview.com; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https://cdn.jsdelivr.net https://assets.coincap.io https://coin-images.coingecko.com https://assets.coingecko.com https://*.tradingview.com; " +
      "connect-src 'self' ws: wss: https://*.tradingview.com; frame-src https://www.tradingview.com https://s.tradingview.com https://www.tradingview-widget.com; font-src 'self'; object-src 'none'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Accept-CH', 'Sec-CH-UA-Model, Sec-CH-UA-Form-Factors');
  if (/^\/api(?:\/|$)/i.test(_req.path)) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
app.use(express.json({ limit: '192kb', strict: true }));

function runAsync(res: express.Response, task: () => Promise<void>): void {
  void task().catch((error) => {
    try {
      ledger.logEvent('error_event', null, { source: 'http.async', message: error instanceof Error ? error.message : String(error) });
    } catch {
      // Response containment must not depend on the event sink being healthy.
    }
    if (!res.headersSent) {
      res.status(500).json({ ok: false, code: 'REQUEST_FAILED', error: 'Request could not be completed.' });
    } else {
      res.end();
    }
  });
}

function safeLogEvent(kind: string, symbol: string | null, data: unknown): void {
  try {
    ledger.logEvent(kind, symbol, data);
  } catch {
    // Detached refresh/error paths must remain contained when persistence is
    // degraded; primary health state still exposes the upstream failure.
  }
}

function secretMatches(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function notificationRoutingSnapshot() {
  const awsIngressReady = Boolean(process.env.NOTIFICATION_AWS_INGEST_TOKEN?.trim());
  return {
    sources: {
      bot: { available: true, label: 'Bot Runtime', detail: 'Engine, controls, and dependency state changes' },
      execution: { available: true, label: 'Execution Pipeline', detail: 'Risk blocks, order outcomes, fills, and loan outcomes' },
      aws: {
        available: awsIngressReady,
        label: 'AWS Infrastructure',
        detail: awsIngressReady ? 'Secure EventBridge intake is ready' : 'Set NOTIFICATION_AWS_INGEST_TOKEN on the server',
        endpoint: '/api/notifications/ingest/aws',
      },
    },
    destinations: {
      inApp: { available: true, label: 'In-App', detail: 'Active in this control room' },
      email: { available: false, label: 'Email', detail: 'Delivery provider is not connected' },
      telegram: { available: false, label: 'Telegram', detail: 'Bot token and chat routing are not connected' },
      whatsapp: { available: false, label: 'WhatsApp', detail: 'WhatsApp Cloud API is not connected' },
      awsSns: { available: false, label: 'AWS SNS', detail: 'SNS topic and publish role are not connected' },
    },
    policy: {
      transitionsOnly: true,
      repeatWindowMinutes: 15,
      rawLogsExcluded: true,
    },
  };
}

/**
 * Optional AWS EventBridge/API-Destination intake. It is unavailable until a
 * server-side bearer token is configured; credentials are never accepted from
 * or returned to the browser.
 */
app.post('/api/notifications/ingest/aws', (req, res) => {
  const expected = process.env.NOTIFICATION_AWS_INGEST_TOKEN?.trim() ?? '';
  if (!expected) {
    res.status(503).json({ error: 'AWS notification intake is not configured' });
    return;
  }
  const authorization = req.header('authorization') ?? '';
  const received = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!received || !secretMatches(received, expected)) {
    res.status(401).json({ error: 'invalid notification intake token' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const source = String(body.source ?? '');
  if (!['aws.ec2', 'aws.cloudwatch', 'aws.health'].includes(source)) {
    res.status(400).json({ error: 'unsupported AWS event source' });
    return;
  }
  const detail = body.detail && typeof body.detail === 'object' ? body.detail as Record<string, unknown> : {};
  const stateValue = detail.state && typeof detail.state === 'object'
    ? String((detail.state as Record<string, unknown>).value ?? '')
    : String(detail.state ?? detail.statusCode ?? '');
  const resources = Array.isArray(body.resources) ? body.resources.filter((item): item is string => typeof item === 'string') : [];
  const eventId = String(body.id ?? '').slice(0, 120);
  if (eventId && ledger.recentEvents(1_000, 'aws_notification', undefined, eventId).length > 0) {
    res.status(202).json({ accepted: true, duplicate: true });
    return;
  }
  const ev = ledger.logEvent('aws_notification', null, {
    eventId: eventId || null,
    service: source.replace(/^aws\./, '').toUpperCase(),
    detailType: String(body['detail-type'] ?? 'AWS State Change').slice(0, 160),
    region: String(body.region ?? '').slice(0, 80),
    resource: String(resources[0] ?? detail['instance-id'] ?? detail.resource ?? '').slice(0, 300),
    state: stateValue.slice(0, 80),
    alarmName: String(detail.alarmName ?? detail['alarm-name'] ?? '').slice(0, 160),
    reason: String(
      detail.state && typeof detail.state === 'object'
        ? (detail.state as Record<string, unknown>).reason ?? ''
        : detail.description ?? '',
    ).slice(0, 500),
  });
  res.status(202).json({ accepted: true, id: ev.id });
});

// The notification intake has its own exact bearer-token contract. Every
// other API route shares one operator admission boundary.
app.use('/api', operatorAccess.middleware());

app.get('/api/notification-routing', (_req, res) => {
  res.json(notificationRoutingSnapshot());
});

// ---- active session tracking ------------------------------------------------
// Records each visiting browser profile by a random first-party device token.
// IP + user-agent remains the privacy-safe fallback when cookies are disabled.
// Cloudflare injects the real IP + country in prod; localhost uses loopback.
interface Sess {
  id: string; ip: string; country: string | null; ua: string;
  system: string; browser: string; device: string; model: string | null;
  firstSeen: number; lastSeen: number;
  reqs: number; pendingReqs: number; persistedAt: number;
}
const sessions = new Map<string, Sess>();
const SESSION_ACTIVE_MS = 2 * 60_000;
const SESSION_API_RETENTION_MS = 24 * 60 * 60_000;
const SESSION_DB_RETENTION_MS = 30 * 24 * 60 * 60_000;
const SESSION_MEMORY_RETENTION_MS = 30 * 60_000;
const SESSION_PERSIST_FLOOR_MS = 15_000;
const SESSION_MEMORY_MAX = 256;
const DEVICE_ID_COOKIE = 'cosmos_device';

function headerText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function cleanClientHint(value: string): string {
  return value.trim().replace(/^"|"$/g, '').slice(0, 80);
}

function parseClient(req: express.Request, ua: string): { system: string; browser: string; device: string; model: string | null } {
  let system = 'Unknown OS';
  if (/iPhone|iPad/i.test(ua)) system = 'iOS';
  else if (/Android/i.test(ua)) system = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) system = 'macOS';
  else if (/Windows/i.test(ua)) system = 'Windows';
  else if (/Linux/i.test(ua)) system = 'Linux';
  const bm = ua.match(/(Edg|OPR|CriOS|FxiOS|Chrome|Firefox|Safari)\/([\d.]+)/);
  const map: Record<string, string> = { Edg: 'Edge', OPR: 'Opera', CriOS: 'Chrome', FxiOS: 'Firefox', Chrome: 'Chrome', Firefox: 'Firefox', Safari: 'Safari' };
  const bkey = bm ? Object.keys(map).find((k) => bm[0].startsWith(k)) ?? '' : '';
  let browser = bm ? `${map[bkey] ?? 'Browser'} ${bm[2].split('.')[0]}` : 'Browser';

  const platformHint = cleanClientHint(headerText(req.headers['sec-ch-ua-platform']));
  if (platformHint && platformHint !== 'Unknown') system = platformHint;

  const brandHeader = headerText(req.headers['sec-ch-ua']);
  const brands = [...brandHeader.matchAll(/"([^"]+)";v="([^"]+)"/g)]
    .map((match) => ({ name: match[1], version: match[2].split('.')[0] }));
  const preferred = ['Microsoft Edge', 'Google Chrome', 'Opera', 'Brave', 'Chromium']
    .map((name) => brands.find((brand) => brand.name === name))
    .find(Boolean);
  if (preferred) {
    const browserName = preferred.name === 'Google Chrome' ? 'Chrome' : preferred.name === 'Microsoft Edge' ? 'Edge' : preferred.name;
    browser = `${browserName} ${preferred.version}`;
  }

  const formFactors = cleanClientHint(headerText(req.headers['sec-ch-ua-form-factors'])).toLowerCase();
  const mobileHint = headerText(req.headers['sec-ch-ua-mobile']);
  const model = cleanClientHint(headerText(req.headers['sec-ch-ua-model'])) || null;
  const device = formFactors.includes('tablet') || /iPad/i.test(ua)
    ? 'Tablet'
    : formFactors.includes('mobile') || mobileHint === '?1' || /iPhone|Android.+Mobile/i.test(ua)
      ? 'Mobile'
      : 'Desktop';
  return { system, browser, device, model };
}
function requestDeviceToken(req: express.Request): string | null {
  const cookieHeader = headerText(req.headers.cookie);
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== DEVICE_ID_COOKIE) continue;
    try {
      const value = decodeURIComponent(rawValue.join('=')).trim();
      return /^[A-Za-z0-9_-]{20,96}$/.test(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function sessKey(ip: string, ua: string, deviceToken: string | null): string {
  const stableDevice = deviceToken ? `device|${deviceToken}` : `fallback|${ip}|${ua}`;
  const prefix = deviceToken ? 'd' : 'f';
  return `${prefix}_${createHash('sha256').update(stableDevice).digest('hex').slice(0, 20)}`;
}

function normalizedRequestIp(req: express.Request): string {
  const cloudflare = headerText(req.headers['cf-connecting-ip']);
  const forwarded = headerText(req.headers['x-forwarded-for']).split(',')[0]?.trim() ?? '';
  const realIp = headerText(req.headers['x-real-ip']);
  const socketIp = req.socket.remoteAddress ?? '';
  const raw = cloudflare || forwarded || realIp || socketIp || 'unknown';
  if (raw === '::1') return '127.0.0.1';
  return raw.replace(/^::ffff:/, '');
}

function reqIdent(req: express.Request): { id: string; ip: string; ua: string; country: string | null } {
  const ip = normalizedRequestIp(req);
  const ua = headerText(req.headers['user-agent']) || 'unknown';
  const country = headerText(req.headers['cf-ipcountry']) || null;
  return { id: sessKey(ip, ua, requestDeviceToken(req)), ip, ua, country };
}

function isBrowserTelemetryRequest(req: express.Request): boolean {
  const ua = String(req.headers['user-agent'] ?? '');
  return /(Edg|OPR|CriOS|FxiOS|Chrome|Firefox|Safari)\//i.test(ua)
    && !/(bot|crawler|spider|curl|wget|postmanruntime)/i.test(ua);
}

function persistBrowserSession(session: Sess, now = Date.now(), force = false): boolean {
  if (session.pendingReqs <= 0) return true;
  if (!force && now - session.persistedAt < SESSION_PERSIST_FLOOR_MS) return true;
  try {
    ledger.recordBrowserSessionActivity({
      id: session.id,
      ip: session.ip,
      country: session.country,
      system: session.system,
      browser: session.browser,
      device: session.device,
      model: session.model,
      firstSeen: session.firstSeen,
      lastSeen: session.lastSeen,
      requests: session.pendingReqs,
    });
    session.pendingReqs = 0;
    session.persistedAt = now;
    return true;
  } catch {
    // Visitor telemetry is best-effort and must never break the control API.
    return false;
  }
}

app.use((req, _res, next) => {
  // Static assets and the document request happen before the frontend can
  // establish its device cookie. Only same-origin API work is session activity.
  if (!req.path.startsWith('/api/') || !isBrowserTelemetryRequest(req)) {
    next();
    return;
  }
  const { id, ip, ua, country } = reqIdent(req);
  const now = Date.now();
  const s = sessions.get(id);
  const client = parseClient(req, ua);
  if (s) {
    s.lastSeen = now;
    s.reqs++;
    s.pendingReqs++;
    s.system = client.system;
    s.browser = client.browser;
    s.device = client.device;
    if (client.model) s.model = client.model;
    if (country) s.country = country;
    persistBrowserSession(s, now);
  } else {
    const session = { id, ip, country, ua, ...client, firstSeen: now, lastSeen: now, reqs: 1, pendingReqs: 1, persistedAt: 0 };
    sessions.set(id, session);
    persistBrowserSession(session, now, true);
  }
  for (const [k, v] of sessions) {
    if (now - v.lastSeen <= SESSION_MEMORY_RETENTION_MS) continue;
    if (persistBrowserSession(v, now, true)) sessions.delete(k);
  }
  if (sessions.size > SESSION_MEMORY_MAX) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    for (const stale of oldest.slice(0, sessions.size - SESSION_MEMORY_MAX)) {
      persistBrowserSession(stale, now, true);
      sessions.delete(stale.id);
    }
  }
  next();
});

interface AwsOperatorResult {
  authorized: boolean;
  operator: string | null;
  reason: string | null;
}

async function awsOperator(req: express.Request): Promise<AwsOperatorResult> {
  const controlHeader = req.headers['x-cosmos-control'];
  if (controlHeader !== 'aws-runner') return { authorized: false, operator: null, reason: 'Missing control-channel header.' };
  const verified = operatorAccess.operator(req) ?? (await operatorAccess.verify(req)).operator;
  if (!verified) return { authorized: false, operator: null, reason: 'Verified operator identity is required.' };
  return { authorized: true, operator: verified.email ?? verified.id, reason: null };
}

async function requireAwsOperator(req: express.Request, res: express.Response): Promise<AwsOperatorResult | null> {
  const operator = await awsOperator(req);
  if (!operator.authorized) {
    res.status(403).json({ ok: false, code: 'AWS_OPERATOR_DENIED', error: operator.reason });
    return null;
  }
  return operator;
}

function sendAwsControlError(res: express.Response, error: unknown): void {
  if (error instanceof AwsRunnerControlError) {
    res.status(error.statusCode).json({ ok: false, code: error.code, error: error.message });
    return;
  }
  try {
    ledger.logEvent('error_event', null, { source: 'aws.control', message: error instanceof Error ? error.message : String(error) });
  } catch {
    // Preserve a stable control-plane response if persistence is degraded.
  }
  res.status(500).json({ ok: false, code: 'AWS_CONTROL_ERROR', error: 'AWS control request failed.' });
}

app.get('/api/sessions', (req, res) => {
  const now = Date.now();
  const meId = reqIdent(req).id;
  for (const session of sessions.values()) persistBrowserSession(session, now, true);
  ledger.pruneBrowserSessions(now - SESSION_DB_RETENTION_MS);
  const storedSessions = ledger.listBrowserSessions(now - SESSION_API_RETENTION_MS, 100);
  // A privacy fallback can be created by an already-open pre-migration tab
  // before it receives the first-party cookie. Once a token-backed profile
  // with the same observable browser posture exists, suppress that duplicate
  // fallback from Recent Devices instead of presenting one machine twice.
  const tokenProfiles = new Set(
    storedSessions
      .filter((session) => session.id.startsWith('d_'))
      .map((session) => `${session.ip}|${session.system}|${session.browser}|${session.device ?? ''}`),
  );
  const list = storedSessions
    .filter((session) => !session.id.startsWith('f_') || !tokenProfiles.has(`${session.ip}|${session.system}|${session.browser}|${session.device ?? ''}`))
    .map((s) => {
      const live = sessions.get(s.id);
      const fallbackDevice = /Android|iOS/i.test(s.system) ? 'Mobile' : 'Desktop';
      return {
      id: s.id,
      ip: s.ip || null,
      country: s.country,
      system: s.system,
      browser: s.browser,
      device: live?.device ?? s.device ?? fallbackDevice,
      model: live?.model ?? s.model ?? null,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      requests: s.requests,
      current: s.id === meId,
      active: now - s.lastSeen < SESSION_ACTIVE_MS,
      };
    });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    sessions: list,
    now,
    source: 'browser-request-telemetry',
    identity: 'first-party-device-token',
    retentionHours: SESSION_API_RETENTION_MS / 3_600_000,
    activeWindowSeconds: SESSION_ACTIVE_MS / 1000,
    cloudflareActiveSessions: false,
  });
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

function integerQuery(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return null;
  return parsed;
}

function integerBody(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function rejectGetRefresh(req: express.Request, res: express.Response): boolean {
  if (!Object.prototype.hasOwnProperty.call(req.query, 'refresh')) return false;
  res.status(400).json({
    ok: false,
    code: 'REFRESH_REQUIRES_POST',
    error: 'Forced refreshes require an authenticated same-origin POST request.',
  });
  return true;
}

function optionalPositiveInteger(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function marketSymbol(value: unknown, minimum = 1, maximum = 20): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  const pattern = new RegExp(`^[A-Z0-9]{${minimum},${maximum}}$`);
  return pattern.test(normalized) ? normalized : null;
}

function eventFilters(req: express.Request):
  | { ok: true; kind?: string; symbol?: string; q?: string; since?: number; until?: number }
  | { ok: false; error: string } {
  const kind = req.query.kind === undefined ? undefined : String(req.query.kind).trim();
  const symbol = req.query.symbol === undefined ? undefined : String(req.query.symbol).trim().toUpperCase();
  const q = req.query.q === undefined ? undefined : String(req.query.q).trim();
  const since = optionalPositiveInteger(req.query.since);
  const until = optionalPositiveInteger(req.query.until);
  if (kind !== undefined && !/^[a-zA-Z0-9._:-]{1,80}$/.test(kind)) return { ok: false, error: 'invalid event kind' };
  if (symbol !== undefined && !/^[A-Z0-9]{2,20}$/.test(symbol)) return { ok: false, error: 'invalid event symbol' };
  if (q !== undefined && (q.length < 2 || q.length > 60 || /^[%_*\s]+$/.test(q))) return { ok: false, error: 'event search must contain 2-60 literal characters' };
  if (since === null || until === null) return { ok: false, error: 'event timestamps must be positive integers' };
  return { ok: true, kind, symbol, q, since, until };
}

app.get('/api/events', (req, res) => {
  const limit = integerQuery(req.query.limit, 200, 1, 2_000);
  const offset = integerQuery(req.query.offset, 0, 0, 10_000);
  const beforeId = optionalPositiveInteger(req.query.beforeId);
  const afterId = optionalPositiveInteger(req.query.afterId);
  const filters = eventFilters(req);
  if (limit === null || offset === null || beforeId === null || afterId === null || (beforeId !== undefined && afterId !== undefined) || !filters.ok) {
    const error = !filters.ok ? filters.error : 'event pagination must use bounded integers';
    res.status(400).json({ code: 'INVALID_EVENT_QUERY', error });
    return;
  }
  res.json(ledger.recentEvents(limit, filters.kind, filters.symbol, filters.q, filters.since, beforeId, filters.until, offset, afterId));
});

app.get('/api/events/count', (req, res) => {
  const filters = eventFilters(req);
  if (!filters.ok) {
    res.status(400).json({ code: 'INVALID_EVENT_QUERY', error: filters.error });
    return;
  }
  res.json({ count: ledger.countEvents(filters.kind, filters.symbol, filters.q, filters.since, filters.until) });
});

// ---- Binance announcements proxy (real critical announcements; cached) ------
// New-listing / futures-launch announcements move markets, so they belong in an
// arbitrage cockpit. Fetched server-side (CORS + one shared cache), never faked.
// Categories map to Binance's own announcement catalog IDs.
type NewsItem = { id: number; title: string; date: string | null; url: string; impact: 1 | 2 | 3 };
const NEWS_CATALOGS = new Set([48, 49, 93, 50, 161, 157, 51, 128]);
const NEWS_AGGREGATE_CATALOGS = [48, 49, 93, 50, 161, 157, 51, 128];
const newsCache = new Map<number, { at: number; items: NewsItem[] }>();
const newsInFlight = new Map<number, Promise<boolean>>();

async function refreshNews(catalogId: number): Promise<void> {
  const url = `https://www.binance.com/bapi/apex/v1/public/apex/cms/article/catalog/list/query?catalogId=${catalogId}&pageNo=1&pageSize=16`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: ctrl.signal,
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await readBoundedJson<{ data?: { articles?: { id: number; code: string; title: string }[] } }>(res, 512 * 1024);
    const items: NewsItem[] = (json.data?.articles ?? []).map((a) => {
      const m = a.title.match(/\s*\((\d{4}-\d{2}-\d{2})\)\s*$/);
      const title = m ? a.title.slice(0, m.index).trim() : a.title.trim();
      return {
        id: a.id,
        title,
        date: m ? m[1] : null,
        url: `https://www.binance.com/en/support/announcement/${a.code}`,
        impact: scoreNewsImpact({ sourceKey: 'binance', channel: 'venue', title, tags: [] }),
      };
    });
    newsCache.set(catalogId, { at: Date.now(), items });
  } finally {
    clearTimeout(timer);
  }
}

function compareNewsItems(a: NewsItem, b: NewsItem): number {
  const aTs = a.date ? Date.parse(`${a.date}T00:00:00Z`) : 0;
  const bTs = b.date ? Date.parse(`${b.date}T00:00:00Z`) : 0;
  if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return bTs - aTs;
  return b.id - a.id;
}

async function ensureNewsCatalog(catalogId: number, force: boolean): Promise<boolean> {
  const cached = newsCache.get(catalogId);
  const fresh = !force && cached && Date.now() - cached.at < 5 * 60_000;
  if (!fresh && !newsInFlight.has(catalogId)) {
    const p = refreshNews(catalogId)
      .then(() => true)
      .catch((err) => {
        safeLogEvent('error_event', null, { source: 'news.fetch', message: String(err), catalogId });
        return false;
      })
      .finally(() => newsInFlight.delete(catalogId));
    newsInFlight.set(catalogId, p);
  }
  if ((force || !newsCache.get(catalogId)) && newsInFlight.has(catalogId)) return newsInFlight.get(catalogId)!;
  return Boolean(fresh || newsCache.get(catalogId));
}

app.get('/api/news', (req, res) => {
  runAsync(res, async () => {
    if (rejectGetRefresh(req, res)) return;
    const aggregate = String(req.query.catalog ?? '') === 'all';
    const catalogId = NEWS_CATALOGS.has(Number(req.query.catalog)) ? Number(req.query.catalog) : 48;
    const catalogIds = aggregate ? NEWS_AGGREGATE_CATALOGS : [catalogId];
    await Promise.all(catalogIds.map((id) => ensureNewsCatalog(id, false)));
    const outputs = catalogIds.map((id) => newsCache.get(id)).filter((out): out is { at: number; items: NewsItem[] } => Boolean(out));
    if (outputs.length) {
      const byId = new Map<number, NewsItem>();
      outputs.flatMap((out) => out.items).forEach((item) => byId.set(item.id, item));
      const items = Array.from(byId.values()).sort(compareNewsItems).slice(0, aggregate ? 96 : 20);
      const fetchedAt = Math.max(...outputs.map((out) => out.at));
      res.json({ catalog: aggregate ? 'all' : catalogId, items, fetchedAt });
    }
    else res.status(503).json({ error: 'binance announcements unavailable', items: [] });
  });
});

app.post('/api/news/refresh', (req, res) => {
  runAsync(res, async () => {
    const requestedCatalog = (req.body as { catalog?: unknown } | null)?.catalog;
    const aggregate = requestedCatalog === 'all';
    const numericCatalog = typeof requestedCatalog === 'number' || typeof requestedCatalog === 'string'
      ? Number(requestedCatalog)
      : 48;
    if (!aggregate && !NEWS_CATALOGS.has(numericCatalog)) {
      res.status(400).json({ ok: false, error: 'news catalog is invalid' });
      return;
    }
    const catalogIds = aggregate ? NEWS_AGGREGATE_CATALOGS : [numericCatalog];
    const refreshResults = await Promise.all(catalogIds.map((id) => ensureNewsCatalog(id, true)));
    const outputs = catalogIds.map((id) => newsCache.get(id)).filter((out): out is { at: number; items: NewsItem[] } => Boolean(out));
    if (!outputs.length || refreshResults.some((ok) => !ok)) {
      const byId = new Map<number, NewsItem>();
      outputs.flatMap((out) => out.items).forEach((item) => byId.set(item.id, item));
      res.status(503).json({
        ok: false,
        stale: outputs.length > 0,
        error: 'binance announcement refresh failed',
        items: Array.from(byId.values()).sort(compareNewsItems).slice(0, aggregate ? 96 : 20),
        fetchedAt: outputs.length ? Math.max(...outputs.map((out) => out.at)) : null,
      });
      return;
    }
    const byId = new Map<number, NewsItem>();
    outputs.flatMap((out) => out.items).forEach((item) => byId.set(item.id, item));
    res.json({
      ok: true,
      catalog: aggregate ? 'all' : numericCatalog,
      items: Array.from(byId.values()).sort(compareNewsItems).slice(0, aggregate ? 96 : 20),
      fetchedAt: Math.max(...outputs.map((out) => out.at)),
    });
  });
});

// ---- Market news context proxy (primary + venue + protocol + issuer + Tree/RSS/Lookonchain) ----
app.get('/api/news-context', (req, res) => {
  runAsync(res, async () => {
    try {
      if (rejectGetRefresh(req, res)) return;
      const limit = integerQuery(req.query.limit, 220, 20, 600);
      if (limit === null) {
        res.status(400).json({ error: 'news limit must be an integer between 20 and 600' });
        return;
      }
      const payload = await getNewsContext(false);
      res.json({ ...payload, items: payload.items.slice(0, limit) });
    } catch (err) {
      safeLogEvent('error_event', null, { source: 'news-context.fetch', message: String(err) });
      res.status(503).json({ error: 'news context unavailable', source: 'primary+venue+protocol+issuer+tree+rss+lookonchain', items: [], sources: [] });
    }
  });
});

app.post('/api/news-context/refresh', (req, res) => {
  runAsync(res, async () => {
    const limit = integerBody((req.body as { limit?: unknown } | null)?.limit, 220, 20, 600);
    if (limit === null) {
      res.status(400).json({ ok: false, error: 'news limit must be an integer between 20 and 600' });
      return;
    }
    try {
      const payload = await refreshNewsContextNow();
      res.json({ ok: true, ...payload, items: payload.items.slice(0, limit) });
    } catch (err) {
      safeLogEvent('error_event', null, { source: 'news-context.refresh', message: String(err) });
      res.status(503).json({ ok: false, error: 'news context refresh failed', items: [], sources: [] });
    }
  });
});

// One server-owned refresh loop runs whether or not a browser is open. This is
// what keeps the rolling seven-day archive complete on an unattended EC2 host;
// browsers only subscribe to committed snapshots and never own collection.
let newsRefreshTimer: NodeJS.Timeout | null = null;

function startNewsRefreshLoop(): void {
  if (newsRefreshTimer) return;
  newsRefreshTimer = setInterval(() => { void getNewsContext(true).catch(() => undefined); }, 5_000);
}

let newsStreamClients = 0;
const NEWS_STREAM_MAX_CLIENTS = 16;

app.get('/api/news-stream', (req, res) => {
  const limit = integerQuery(req.query.limit, 220, 20, 600);
  if (limit === null) {
    res.status(400).json({ error: 'news stream limit must be an integer between 20 and 600' });
    return;
  }
  if (newsStreamClients >= NEWS_STREAM_MAX_CLIENTS) {
    res.status(429).json({ error: 'news stream capacity reached' });
    return;
  }
  newsStreamClients++;
  let slowWrites = 0;
  let closed = false;
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'private, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload: Awaited<ReturnType<typeof getNewsContext>>) => {
    if (closed) return;
    const accepted = res.write(`event: news\ndata: ${JSON.stringify({ ...payload, items: payload.items.slice(0, limit) })}\n\n`);
    slowWrites = accepted ? 0 : slowWrites + 1;
    if (slowWrites >= 3) res.end();
  };
  const unsubscribe = subscribeNewsContext(send);
  void getNewsContext(false).catch(() => undefined);
  const heartbeat = setInterval(() => {
    if (!closed && !res.write(': keep-alive\n\n')) slowWrites++;
    if (slowWrites >= 3) res.end();
  }, 15_000);
  const close = () => {
    if (closed) return;
    closed = true;
    newsStreamClients--;
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', close);
  res.on('close', close);
});

// ---- TradingView economic calendar proxy (real events; cached 60 sec) -------
type CalItem = {
  id: string; title: string; country: string; indicator: string; importance: number;
  period: string; actual: number | null; forecast: number | null; previous: number | null;
  unit: string | null; scale: string | null; currency: string | null; date: string; category: string | null;
  comment: string | null; source: string | null; sourceUrl: string | null;
};
let calCache: { at: number; items: CalItem[] } | null = null;
let calInFlight: Promise<boolean> | null = null;

async function refreshCalendar(): Promise<void> {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
  const from = new Date(currentMonday.getTime() - 7 * 86_400_000).toISOString();
  const to = new Date(currentMonday.getTime() + 21 * 86_400_000).toISOString();
  const countries = 'US,EU,GB,JP,CN,IN,DE,CA,AU,FR,KR,ID,TR,IT,MX,BR,CH,NZ,ZA,SA';
  const url = `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=${countries}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Origin: 'https://www.tradingview.com' },
      signal: ctrl.signal,
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await readBoundedJson<{ result?: Record<string, unknown>[] }>(res, 2 * 1024 * 1024);
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
      scale: (e.scale as string) ?? null,
      currency: (e.currency as string) ?? null,
      date: String(e.date ?? ''),
      category: typeof e.category === 'string' ? e.category : null,
      comment: typeof e.comment === 'string' ? e.comment : null,
      source: typeof e.source === 'string' ? e.source : null,
      sourceUrl: typeof e.source_url === 'string' ? e.source_url : null,
    })).filter((item) => Number.isFinite(Date.parse(item.date))).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    calCache = { at: Date.now(), items };
  } finally {
    clearTimeout(timer);
  }
}

function startCalendarRefresh(): Promise<boolean> {
  if (!calInFlight) {
    calInFlight = refreshCalendar()
      .then(() => true)
      .catch((err) => {
        safeLogEvent('error_event', null, { source: 'calendar.fetch', message: String(err) });
        return false;
      })
      .finally(() => { calInFlight = null; });
  }
  return calInFlight;
}

app.get('/api/calendar', (req, res) => {
  runAsync(res, async () => {
    if (rejectGetRefresh(req, res)) return;
    const fresh = calCache && Date.now() - calCache.at < 60_000;
    if (!fresh) void startCalendarRefresh();
    // Cached reads stay instant; only authenticated same-origin POST routes
    // may intentionally force upstream work.
    if (!calCache && calInFlight) await calInFlight.catch(() => undefined);
    if (calCache) res.json({ items: calCache.items, fetchedAt: calCache.at });
    else res.status(503).json({ error: 'calendar unavailable', items: [] });
  });
});

app.post('/api/calendar/refresh', (_req, res) => {
  runAsync(res, async () => {
    const refreshed = await startCalendarRefresh();
    if (refreshed && calCache) res.json({ ok: true, items: calCache.items, fetchedAt: calCache.at });
    else res.status(503).json({ ok: false, stale: Boolean(calCache), error: 'calendar refresh failed', items: calCache?.items ?? [], fetchedAt: calCache?.at ?? null });
  });
});

// ---- FX rates proxy (real USD rates; cached 30 min) -------------------------
let fxCache: { at: number; rates: Record<string, number> } | null = null;
let fxInFlight: Promise<void> | null = null;

async function refreshFx(): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await readBoundedJson<{ result?: string; rates?: Record<string, number> }>(res, 512 * 1024);
    if (json.result !== 'success' || !json.rates) throw new Error('bad fx payload');
    fxCache = { at: Date.now(), rates: json.rates };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/fx', (_req, res) => {
  runAsync(res, async () => {
    const fresh = fxCache && Date.now() - fxCache.at < 30 * 60_000;
    if (!fresh && !fxInFlight) {
      fxInFlight = refreshFx()
        .catch((err) => { safeLogEvent('error_event', null, { source: 'fx.fetch', message: String(err) }); })
        .finally(() => { fxInFlight = null; });
    }
    if (!fxCache && fxInFlight) await fxInFlight.catch(() => undefined);
    if (fxCache) res.json({ base: 'USD', rates: fxCache.rates, fetchedAt: fxCache.at });
    else res.status(503).json({ error: 'fx unavailable', rates: {} });
  });
});

app.get('/api/fills', (_req, res) => {
  res.json(ledger.listFills(200));
});

app.post('/api/fills/import', (req, res) => {
  runAsync(res, async () => {
    const symbol = String((req.body as Record<string, unknown>).symbol ?? '');
    if (!client) {
      res.status(400).json({ error: 'Binance keys not configured' });
      return;
    }
    if (!/^[A-Z0-9]{1,16}USDT$/.test(symbol)) {
      res.status(400).json({ error: 'fill imports currently support USDT symbols only' });
      return;
    }
    account.registerFillSymbols([symbol]);
    try {
      const trades = await client.myTrades(symbol, 200);
      let imported = 0;
      for (const t of trades) {
        if (t.symbol !== symbol) throw new Error('Binance trade payload symbol mismatch');
        const isNew = account.recordFill({
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
  });
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
// Simple Earn flexible positions — the money Binance holds in Earn. Real
// values from the signed endpoint, 60s cache; empty rows when keys are absent.
// Real balance history: Binance's daily SPOT account snapshots (~30 days is
// all their API exposes) converted to USD with daily BTCUSDT closes. Our own
// 15-minute snapshots take over from wherever these end.
type EquityHistorySnapshot = {
  ts: number;
  rows: { ts: number; totalUsdt: number }[];
  reconstructedBefore: number | null;
  reconstruction: { complete: boolean; reasons: string[] };
};
let eqHistCache: EquityHistorySnapshot | null = null;
let eqHistInFlight: Promise<EquityHistorySnapshot> | null = null;
const STABLE_FLOW = new Set(['USDT']);

function recentCompleteEquityRows(afterTs = 0): { ts: number; totalUsdt: number }[] {
  return ledger
    .recentEvents(500, 'account_snapshot')
    .map((event) => {
      const data = event.data as { totalUsdt?: unknown; complete?: unknown } | null;
      return {
        ts: event.ts,
        totalUsdt: Number(data?.totalUsdt),
        complete: data?.complete === true,
      };
    })
    .filter((row) => row.complete && row.ts > afterTs && Number.isFinite(row.totalUsdt) && row.totalUsdt >= 0)
    .map(({ ts, totalUsdt }) => ({ ts, totalUsdt }))
    .reverse();
}

function withRecentEquityRows(base: { ts: number; totalUsdt: number }[]): { ts: number; totalUsdt: number }[] {
  const newestBaseTs = base[base.length - 1]?.ts ?? 0;
  const merged = [...base, ...recentCompleteEquityRows(newestBaseTs)].sort((a, b) => a.ts - b.ts);
  const deduped: { ts: number; totalUsdt: number }[] = [];
  for (const row of merged) {
    const prior = deduped[deduped.length - 1];
    if (prior && Math.abs(prior.ts - row.ts) < 1_000) deduped[deduped.length - 1] = row;
    else deduped.push(row);
  }
  return deduped;
}

function externalFlowId(
  direction: 'deposit' | 'withdrawal',
  row: { id?: unknown; txId?: unknown },
  fallback: readonly (string | number)[],
): string {
  for (const value of [row.id, row.txId]) {
    const normalized = typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string' ? value.trim() : '';
    if (normalized && normalized.length <= 256 && !/[\u0000-\u001f\u007f]/.test(normalized)) {
      return `${direction}:${normalized}`;
    }
  }
  return `${direction}:fallback:${createHash('sha256').update(JSON.stringify(fallback)).digest('hex')}`;
}

function nonNegativeDecimal(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function buildEquityHistorySnapshot(): Promise<EquityHistorySnapshot> {
  if (!client) throw new Error('Binance key is not configured');
  const now = Date.now();
  const reconstructionReasons = new Set<string>();
  const [snaps, btcCandles] = await Promise.all([
    client.accountSnapshots(),
    fetchKlineCandles('BTCUSDT', '1d', 40, 'spot'),
  ]);
  if (!snaps || !Array.isArray(snaps.snapshotVos) || snaps.snapshotVos.length === 0) {
    throw new Error('No signed Binance account snapshots are available');
  }
  const closeByDay = new Map<string, number>();
  for (const candle of btcCandles) {
    if (!Number.isSafeInteger(candle.t) || !Number.isFinite(candle.c) || candle.c <= 0) {
      throw new Error('BTC history returned an invalid candle');
    }
    closeByDay.set(new Date(candle.t).toISOString().slice(0, 10), candle.c);
  }
  const dailies = snaps.snapshotVos.map((snapshot) => {
    const btc = nonNegativeDecimal(snapshot.data?.totalAssetOfBtc);
    const updateTime = Number(snapshot.updateTime);
    if (!Number.isSafeInteger(updateTime) || updateTime <= 0 || btc === null) {
      throw new Error('A signed Binance account snapshot is malformed');
    }
    const day = new Date(updateTime).toISOString().slice(0, 10);
    const close = closeByDay.get(day);
    if (!close) throw new Error(`BTC valuation is unavailable for signed snapshot ${day}`);
    const totalUsdt = btc * close;
    if (!Number.isFinite(totalUsdt) || totalUsdt < 0) throw new Error(`Signed snapshot valuation is invalid for ${day}`);
    return { ts: updateTime, totalUsdt };
  }).sort((a, b) => a.ts - b.ts);

  const windows: [number, number][] = [
    [now - 90 * 86_400_000, now],
    [now - 180 * 86_400_000, now - 90 * 86_400_000],
    [now - 200 * 86_400_000, now - 180 * 86_400_000],
  ];
  const flows: { id: string; ts: number; usd: number }[] = [];
  const seenFlows = new Set<string>();
  const priceCache = new Map<string, Map<string, number>>();
  const flowUsd = async (coin: string, amount: number, ts: number): Promise<number | null> => {
    if (!/^[A-Z0-9]{1,20}$/.test(coin) || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(ts) || ts <= 0) {
      throw new Error('A completed wallet flow is malformed');
    }
    if (STABLE_FLOW.has(coin)) return amount;
    let closes = priceCache.get(coin);
    if (!closes) {
      closes = new Map<string, number>();
      try {
        for (const candle of await fetchKlineCandles(`${coin}USDT`, '1d', 220, 'spot')) {
          if (Number.isSafeInteger(candle.t) && Number.isFinite(candle.c) && candle.c > 0) {
            closes.set(new Date(candle.t).toISOString().slice(0, 10), candle.c);
          }
        }
      } catch {
        reconstructionReasons.add(`Historical ${coin}USDT prices are unavailable`);
      }
      priceCache.set(coin, closes);
    }
    const close = closes.get(new Date(ts).toISOString().slice(0, 10));
    if (!close) {
      reconstructionReasons.add(`Historical ${coin} valuation is incomplete`);
      return null;
    }
    return amount * close;
  };

  for (const [startTime, endTime] of windows) {
    // This refresh is atomic: a failed signed history window leaves the last
    // known-good cache untouched instead of publishing a partial chart.
    const [deposits, withdrawals] = await Promise.all([
      client.depositHistory(startTime, endTime),
      client.withdrawHistory(startTime, endTime),
    ]);
    if (!Array.isArray(deposits) || !Array.isArray(withdrawals)) throw new Error('Binance wallet history is malformed');
    if (deposits.length >= 1_000) reconstructionReasons.add('Deposit history may exceed Binance page limits');
    if (withdrawals.length >= 1_000) reconstructionReasons.add('Withdrawal history may exceed Binance page limits');
    for (const deposit of deposits) {
      if (deposit.status !== 1) continue;
      const coin = String(deposit.coin);
      const amount = nonNegativeDecimal(deposit.amount);
      const ts = Number(deposit.insertTime);
      const runtimeRow = deposit as typeof deposit & { id?: unknown; txId?: unknown };
      const id = externalFlowId('deposit', runtimeRow, [coin, String(deposit.amount), ts]);
      if (seenFlows.has(id)) continue;
      seenFlows.add(id);
      if (amount === null || ts < startTime - 1_000 || ts > endTime + 5 * 60_000) throw new Error('A completed deposit is malformed');
      const usd = await flowUsd(coin, amount, ts);
      if (usd !== null) flows.push({ id, ts, usd });
    }
    for (const withdrawal of withdrawals) {
      if (withdrawal.status !== 6) continue;
      const coin = String(withdrawal.coin);
      const ts = Date.parse(`${String(withdrawal.applyTime).replace(' ', 'T')}Z`);
      const amount = nonNegativeDecimal(withdrawal.amount);
      const fee = nonNegativeDecimal(withdrawal.transactionFee);
      if (amount === null || fee === null || ts < startTime - 1_000 || ts > endTime + 5 * 60_000) {
        throw new Error('A completed withdrawal is malformed');
      }
      const runtimeRow = withdrawal as typeof withdrawal & { id?: unknown; txId?: unknown };
      const id = externalFlowId('withdrawal', runtimeRow, [coin, String(withdrawal.amount), String(withdrawal.transactionFee), ts]);
      if (seenFlows.has(id)) continue;
      seenFlows.add(id);
      const usd = await flowUsd(coin, amount + fee, ts);
      if (usd !== null) flows.push({ id, ts, usd: -usd });
    }
  }

  const rows: { ts: number; totalUsdt: number }[] = [...dailies];
  let reconstructedBefore: number | null = null;
  if (reconstructionReasons.size === 0) {
    const anchor = dailies[0];
    const horizon = now - 185 * 86_400_000;
    const older = flows
      .filter((flow) => flow.ts < anchor.ts && flow.ts >= horizon)
      .sort((a, b) => b.ts - a.ts);
    reconstructedBefore = anchor.ts;
    let running = anchor.totalUsdt;
    const back: { ts: number; totalUsdt: number }[] = [];
    for (const flow of older) {
      back.push({ ts: flow.ts, totalUsdt: running });
      running = Math.max(0, running - flow.usd);
      back.push({ ts: flow.ts - 1, totalUsdt: running });
    }
    back.push({ ts: horizon, totalUsdt: running });
    rows.unshift(...back.sort((a, b) => a.ts - b.ts));
    reconstructionReasons.add('Pre-anchor balances are estimates from external wallet flows; trading PnL and internal transfers are not reconstructed');
  }
  return {
    ts: Date.now(),
    rows,
    reconstructedBefore,
    reconstruction: { complete: false, reasons: [...reconstructionReasons].slice(0, 20) },
  };
}

function startEquityHistoryRefresh(): Promise<EquityHistorySnapshot> {
  if (!eqHistInFlight) {
    const refresh = buildEquityHistorySnapshot().then((snapshot) => {
      eqHistCache = snapshot;
      return snapshot;
    });
    eqHistInFlight = refresh;
    void refresh.catch(() => undefined);
    void refresh.then(
      () => { if (eqHistInFlight === refresh) eqHistInFlight = null; },
      () => { if (eqHistInFlight === refresh) eqHistInFlight = null; },
    );
  }
  return eqHistInFlight;
}

app.get('/api/equity-history', (_req, res) => {
  runAsync(res, async () => {
    const now = Date.now();
    if (eqHistCache && now - eqHistCache.ts < 3_600_000) {
      res.json({ rows: withRecentEquityRows(eqHistCache.rows), reconstructedBefore: eqHistCache.reconstructedBefore, reconstruction: eqHistCache.reconstruction, fetchedAt: eqHistCache.ts });
      return;
    }
    if (!client) {
      res.json({ rows: [], reconstructedBefore: null, reconstruction: { complete: false, reasons: ['Binance key is not configured'] }, fetchedAt: null });
      return;
    }
    try {
      const snapshot = await startEquityHistoryRefresh();
      res.json({ rows: withRecentEquityRows(snapshot.rows), reconstructedBefore: snapshot.reconstructedBefore, reconstruction: snapshot.reconstruction, fetchedAt: snapshot.ts });
    } catch (error) {
      res.json({
        rows: withRecentEquityRows(eqHistCache?.rows ?? []),
        reconstructedBefore: eqHistCache?.reconstructedBefore ?? null,
        reconstruction: eqHistCache?.reconstruction ?? { complete: false, reasons: ['Signed history refresh failed'] },
        fetchedAt: eqHistCache?.ts ?? null,
        error: error instanceof Error ? error.message : 'history failed',
      });
    }
  });
});

type EarnSnapshot = { ts: number; rows: { asset: string; amount: number; apr: number }[] };
let earnCache: EarnSnapshot | null = null;
let earnInFlight: Promise<EarnSnapshot> | null = null;

function startEarnRefresh(): Promise<EarnSnapshot> {
  if (!client) return Promise.reject(new Error('Binance key is not configured'));
  if (!earnInFlight) {
    const refresh = client.earnFlexiblePositions().then((payload) => {
      if (!payload || !Array.isArray(payload.rows)) throw new Error('Simple Earn returned a malformed payload');
      if (payload.rows.length >= 100) throw new Error('Simple Earn positions may exceed the current page limit');
      const rows = payload.rows.map((row) => {
        const asset = typeof row.asset === 'string' ? row.asset.trim().toUpperCase() : '';
        const amount = nonNegativeDecimal(row.totalAmount);
        const apr = nonNegativeDecimal(row.latestAnnualPercentageRate);
        if (!/^[A-Z0-9]{1,20}$/.test(asset) || amount === null || apr === null || typeof row.canRedeem !== 'boolean') {
          throw new Error('Simple Earn returned an invalid position');
        }
        return { asset, amount, apr };
      });
      const snapshot = { ts: Date.now(), rows };
      earnCache = snapshot;
      return snapshot;
    });
    earnInFlight = refresh;
    void refresh.catch(() => undefined);
    void refresh.then(
      () => { if (earnInFlight === refresh) earnInFlight = null; },
      () => { if (earnInFlight === refresh) earnInFlight = null; },
    );
  }
  return earnInFlight;
}

app.get('/api/earn', (_req, res) => {
  runAsync(res, async () => {
    const now = Date.now();
    if (earnCache && now - earnCache.ts < 60_000) {
      res.json({ rows: earnCache.rows, fetchedAt: earnCache.ts });
      return;
    }
    if (!client) {
      res.json({ rows: [], fetchedAt: null });
      return;
    }
    try {
      const snapshot = await startEarnRefresh();
      res.json({ rows: snapshot.rows, fetchedAt: snapshot.ts });
    } catch (error) {
      res.json({ rows: earnCache?.rows ?? [], fetchedAt: earnCache?.ts ?? null, error: error instanceof Error ? error.message : 'earn fetch failed' });
    }
  });
});

// Account-wide wallet totals from Binance's signed wallet-balance endpoint.
// The upstream request costs 60 IP weight, so every browser shares one 60s
// server cache. Cached rows remain visible with an explicit error if a later
// refresh fails; the UI never replaces stale money with invented zeroes.
type WalletBalanceSnapshot = { ts: number; rows: { walletName: string; balance: number; active: boolean }[] };
let walletBalanceCache: WalletBalanceSnapshot | null = null;
let walletBalanceInFlight: Promise<WalletBalanceSnapshot> | null = null;
let walletBalanceRetryAfter = 0;
let walletBalanceLastError: string | null = null;

async function refreshWalletBalances(force = false): Promise<WalletBalanceSnapshot> {
  const now = Date.now();
  if (!force && walletBalanceCache && now - walletBalanceCache.ts < 60_000) return walletBalanceCache;
  if (walletBalanceInFlight) return walletBalanceInFlight;
  if (!client) throw new Error('Binance keys not configured');
  if (!force && now < walletBalanceRetryAfter) {
    throw new Error(walletBalanceLastError ?? 'Binance wallet refresh is cooling down');
  }

  walletBalanceInFlight = (async () => {
    const data = await client.walletBalances('USDT');
    if (!Array.isArray(data)) throw new Error('Binance wallet response is not an array');
    const rows = data.map((row, index) => {
      const walletName = typeof row?.walletName === 'string' ? row.walletName.trim() : '';
      const balance = Number(row?.balance);
      if (!walletName || !Number.isFinite(balance) || typeof row?.activate !== 'boolean') {
        throw new Error(`Binance wallet response contains an invalid row at index ${index}`);
      }
      return { walletName, balance, active: row.activate };
    });
    const snapshot = { ts: Date.now(), rows };
    walletBalanceCache = snapshot;
    walletBalanceRetryAfter = 0;
    walletBalanceLastError = null;
    return snapshot;
  })()
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'wallet balance fetch failed';
      walletBalanceLastError = message;
      walletBalanceRetryAfter = Date.now() + 15_000;
      ledger.logEvent('error_event', null, { source: 'account.wallet_balances', message });
      throw error;
    })
    .finally(() => {
      walletBalanceInFlight = null;
    });
  return walletBalanceInFlight;
}

app.get('/api/wallet-balances', (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  runAsync(res, async () => {
    try {
      const snapshot = await refreshWalletBalances();
      res.json({ rows: snapshot.rows, fetchedAt: snapshot.ts });
    } catch (error) {
      res.json({
        rows: walletBalanceCache?.rows ?? [],
        fetchedAt: walletBalanceCache?.ts ?? null,
        error: error instanceof Error ? error.message : 'wallet balance fetch failed',
      });
    }
  });
});

type MarketSourceSnapshot = {
  at: number;
  spotBookRes: PromiseSettledResult<Map<string, BookTicker>>;
  perpBookRes: PromiseSettledResult<Map<string, BookTicker>>;
  perp24hRes: PromiseSettledResult<Map<string, Futures24hTicker>>;
};
let marketSourceCache: MarketSourceSnapshot | null = null;
let marketSourceInFlight: Promise<MarketSourceSnapshot> | null = null;

async function marketSources(): Promise<MarketSourceSnapshot> {
  const now = Date.now();
  if (marketSourceCache && now - marketSourceCache.at < 2_000) return marketSourceCache;
  if (marketSourceInFlight) return marketSourceInFlight;
  marketSourceInFlight = Promise.allSettled([
    fetchAllBookTickers('spot'),
    fetchAllBookTickers('futures'),
    fetchAllFutures24hTickers(),
  ]).then(([spotBookRes, perpBookRes, perp24hRes]) => {
    const snapshot = { at: Date.now(), spotBookRes, perpBookRes, perp24hRes };
    marketSourceCache = snapshot;
    return snapshot;
  }).finally(() => {
    marketSourceInFlight = null;
  });
  return marketSourceInFlight;
}

app.get('/api/markets', (_req, res) => {
  runAsync(res, async () => {
    const { spotBookRes, perpBookRes, perp24hRes } = await marketSources();
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
  });
});

app.get('/api/market/detail', (req, res) => {
  runAsync(res, async () => {
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
  });
});

app.get('/api/loans', (_req, res) => {
  runAsync(res, async () => {
    res.json(await loans.snapshot(false));
  });
});

app.post('/api/loans/refresh', (_req, res) => {
  runAsync(res, async () => {
    res.json(await loans.snapshot(true));
  });
});

app.post('/api/loans/reconcile', (req, res) => {
  const confirm = typeof (req.body as Record<string, unknown>).confirm === 'string'
    ? String((req.body as Record<string, unknown>).confirm)
    : '';
  res.json(loans.acknowledgeReconciliation(confirm));
});

function loanCoin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[A-Z0-9]{2,10}$/.test(value) ? value : null;
}

function positiveFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

app.post('/api/loans/borrow', (req, res) => {
  runAsync(res, async () => {
    const b = req.body as Record<string, unknown>;
    const requestedLoanCoin = loanCoin(b.loanCoin);
    const collateralCoin = loanCoin(b.collateralCoin);
    const amount = positiveFinite(b.amount);
    const confirmCoin = loanCoin(b.confirmCoin);
    if (!requestedLoanCoin || !collateralCoin || amount === null || !confirmCoin) {
      res.status(400).json({ error: 'bad borrow request' });
      return;
    }
    res.json(await loans.borrow(requestedLoanCoin, collateralCoin, amount, confirmCoin));
  });
});

app.post('/api/loans/adjust-ltv', (req, res) => {
  runAsync(res, async () => {
    const b = req.body as Record<string, unknown>;
    const requestedLoanCoin = loanCoin(b.loanCoin);
    const collateralCoin = loanCoin(b.collateralCoin);
    const amount = positiveFinite(b.amount);
    const direction = b.direction === 'REDUCED' || b.direction === 'ADDITIONAL' ? b.direction : null;
    const confirmCoin = loanCoin(b.confirmCoin);
    if (!requestedLoanCoin || !collateralCoin || amount === null || !direction || !confirmCoin) {
      res.status(400).json({ error: 'bad adjust request' });
      return;
    }
    res.json(await loans.adjustLtv(requestedLoanCoin, collateralCoin, amount, direction, confirmCoin));
  });
});

app.post('/api/loans/repay', (req, res) => {
  runAsync(res, async () => {
    const b = req.body as Record<string, unknown>;
    const requestedLoanCoin = loanCoin(b.loanCoin);
    const collateralCoin = loanCoin(b.collateralCoin);
    const amount = positiveFinite(b.amount);
    const confirmCoin = loanCoin(b.confirmCoin);
    if (!requestedLoanCoin || !collateralCoin || amount === null || !confirmCoin) {
      res.status(400).json({ error: 'bad repay request' });
      return;
    }
    res.json(await loans.repay(requestedLoanCoin, collateralCoin, amount, confirmCoin));
  });
});

app.get('/api/orders/history', (req, res) => {
  runAsync(res, async () => {
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
  });
});

app.get('/api/pnl', (_req, res) => {
  const { realizedByDay, realizedBySymbol, feesByAsset, feeUsdByDay, incompleteByDay } = account.pnl();
  const days = [...realizedByDay.entries()]
    .map(([day, usd]) => ({ day, usd }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const bySymbol = [...realizedBySymbol.entries()]
    .map(([symbol, usd]) => ({ symbol, usd }))
    .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd));
  const fees = [...feesByAsset.entries()].map(([asset, amount]) => ({ asset, amount }));
  const integrityDays = new Set([...realizedByDay.keys(), ...feeUsdByDay.keys(), ...incompleteByDay.keys()]);
  const integrity = [...integrityDays]
    .sort()
    .map((day) => ({
      day,
      complete: (incompleteByDay.get(day) ?? []).length === 0,
      reasons: [...(incompleteByDay.get(day) ?? [])],
      feeUsd: feeUsdByDay.get(day) ?? 0,
      netUsd: (realizedByDay.get(day) ?? 0) - (feeUsdByDay.get(day) ?? 0),
    }));
  const snapshots = ledger
    .recentEvents(500, 'account_snapshot')
    .map((ev) => {
      const data = ev.data as { totalUsdt?: number; complete?: unknown } | null;
      return { ts: ev.ts, totalUsdt: data?.totalUsdt ?? null, complete: data?.complete === true };
    })
    .filter((s) => s.complete && s.totalUsdt !== null)
    .map(({ ts, totalUsdt }) => ({ ts, totalUsdt }))
    .reverse();
  res.json({
    realizedByDay: days,
    realizedBySymbol: bySymbol,
    feesByAsset: fees,
    equitySnapshots: snapshots,
    integrity: {
      complete: integrity.every((row) => row.complete),
      reasons: [...new Set(integrity.flatMap((row) => row.reasons))],
      days: integrity,
    },
  });
});

app.get('/api/signals', (_req, res) => {
  res.json({ active: scanner.proposals(), recent: ledger.listSignals({ limit: 50 }) });
});

app.get('/api/engine/volume', (_req, res) => {
  res.json(volumeRuntime.snapshot());
});

app.get('/api/engine/basis', (_req, res) => {
  res.json(basisRuntime.snapshot());
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
app.get('/api/token/moneyflow', (req, res) => {
  runAsync(res, async () => {
    const symbol = marketSymbol(req.query.symbol, 1, 20) ?? '';
    const window = String(req.query.window ?? '15m');
    if (!symbol || !FLOW_WINDOWS[window]) {
      res.status(400).json({ error: 'symbol + window (15m|1h|4h|1d) required' });
      return;
    }
    try {
      res.json(await fetchMoneyFlow(symbol, window));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });
});

app.get('/api/futures/funding-hist', (req, res) => {
  runAsync(res, async () => {
    const symbol = marketSymbol(req.query.symbol, 1, 20) ?? '';
    const limit = integerQuery(req.query.limit, 1_000, 1, 1_000);
    if (!symbol || limit === null) {
      res.status(400).json({ error: 'valid symbol and integer limit are required' });
      return;
    }
    try {
      res.json(await fetchFundingHist(symbol, limit));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });
});

app.get('/api/futures/liquidations', (req, res) => {
  const symbol = marketSymbol(req.query.symbol, 1, 20) ?? '';
  const bucketMs = integerQuery(req.query.bucketMs, 3_600_000, 5 * 60_000, 24 * 3_600_000);
  if (!symbol || bucketMs === null) {
    res.status(400).json({ error: 'valid symbol and integer bucket are required' });
    return;
  }
  res.json(liquidationSeries(symbol, bucketMs));
});

app.get('/api/futures/liquidations/stats', (_req, res) => {
  res.json(liquidationStats());
});

app.get('/api/futures/oi-hist', (req, res) => {
  runAsync(res, async () => {
    const symbol = marketSymbol(req.query.symbol, 1, 20) ?? '';
    const period = String(req.query.period ?? '1d');
    const limit = integerQuery(req.query.limit, 30, 1, 500);
    if (!symbol || limit === null || !/^(5m|15m|30m|1h|2h|4h|6h|12h|1d)$/.test(period)) {
      res.status(400).json({ error: 'symbol, valid period, and integer limit required' });
      return;
    }
    try {
      res.json(await fetchOiHist(symbol, period, limit));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });
});

app.get('/api/futures/basis-hist', (req, res) => {
  runAsync(res, async () => {
    const symbol = marketSymbol(req.query.symbol, 1, 20) ?? '';
    const period = String(req.query.period ?? '1h');
    const limit = integerQuery(req.query.limit, 48, 1, 500);
    if (!symbol || limit === null || !/^(5m|15m|30m|1h|2h|4h|6h|12h|1d)$/.test(period)) {
      res.status(400).json({ error: 'symbol, valid period, and integer limit required' });
      return;
    }
    try {
      res.json(await fetchBasisHist(symbol, period, limit));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });
});

app.get('/api/token/profiles/status', (_req, res) => {
  res.json(profileWarmStatus());
});

app.post('/api/token/profiles/warm', (_req, res) => {
  const rows = engine.allRows();
  const prices = new Map(rows.map((r) => [r.base, r.spot]));
  void warmAllProfiles(rows.map((r) => r.base), (b) => prices.get(b) ?? null, STOCK_TOKENS);
  res.json({ started: true, total: new Set(rows.map((r) => r.base)).size });
});

app.get('/api/token/profile', (req, res) => {
  runAsync(res, async () => {
    const rawBase = String(req.query.base ?? '').trim().toUpperCase();
    const base = /^[A-Z0-9\u3400-\u9fff]{1,24}$/u.test(rawBase) ? rawBase : '';
    if (!base) {
      res.status(400).json({ error: 'base required' });
      return;
    }
    try {
      const profile = await tokenProfile(base);
      res.json({ ok: !!profile, profile });
    } catch (error) {
      try {
        ledger.logEvent('error_event', null, { source: 'token.profile', message: error instanceof Error ? error.message : String(error) });
      } catch {
        // Preserve a stable response if persistence is degraded.
      }
      res.status(502).json({ ok: false, profile: null, error: 'token profile unavailable' });
    }
  });
});

app.get('/api/icons', (req, res) => {
  const bases = String(req.query.bases ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((b) => /^[A-Z0-9\u3400-\u9fff]{1,24}$/u.test(b))
    .slice(0, 200);
  res.json(resolveIcons(bases));
});

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error('upstream payload is too large');
  if (!response.body) throw new Error('upstream payload is empty');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('payload limit exceeded');
        throw new Error('upstream payload is too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error('upstream payload is empty');
  return Buffer.concat(chunks, total);
}

async function readBoundedJson<T>(response: Response, maximumBytes: number): Promise<T> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    throw new Error('upstream response is not JSON');
  }
  const body = await readBoundedBody(response, maximumBytes);
  return JSON.parse(body.toString('utf8')) as T;
}

function sourceLogoType(body: Buffer): string | null {
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.length >= 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (body.length >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) return 'image/x-icon';
  return null;
}

function cachedSourceLogo(key: string): SourceLogoEntry | null {
  const cached = sourceLogoCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts >= SOURCE_LOGO_TTL_MS) {
    sourceLogoCache.delete(key);
    return null;
  }
  sourceLogoCache.delete(key);
  sourceLogoCache.set(key, cached);
  return cached;
}

function rememberSourceLogo(key: string, entry: SourceLogoEntry): void {
  sourceLogoCache.delete(key);
  sourceLogoCache.set(key, entry);
  while (sourceLogoCache.size > SOURCE_LOGO_CACHE_MAX) {
    const oldest = sourceLogoCache.keys().next().value as string | undefined;
    if (!oldest) break;
    sourceLogoCache.delete(oldest);
  }
}

async function loadSourceLogo(domain: string, size: number): Promise<SourceLogoEntry> {
  const key = `${domain}:${size}`;
  const cached = cachedSourceLogo(key);
  if (cached) return cached;
  const failedAt = sourceLogoFailures.get(key) ?? 0;
  if (Date.now() - failedAt < SOURCE_LOGO_FAILURE_TTL_MS) throw new Error('source logo is cooling down');
  const existing = sourceLogoInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    try {
      const faviconUrl = DIRECT_SOURCE_LOGOS[domain] ?? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
      const upstream = await fetch(faviconUrl, {
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/x-icon,*/*;q=0.5' },
        signal: ctrl.signal,
        redirect: 'error',
      });
      if (!upstream.ok) throw new Error(`favicon HTTP ${upstream.status}`);
      const body = await readBoundedBody(upstream, SOURCE_LOGO_MAX_BYTES);
      const contentType = sourceLogoType(body);
      if (!contentType) throw new Error('unsupported favicon payload');
      const entry = { ts: Date.now(), contentType, body };
      rememberSourceLogo(key, entry);
      sourceLogoFailures.delete(key);
      return entry;
    } catch (error) {
      sourceLogoFailures.set(key, Date.now());
      while (sourceLogoFailures.size > SOURCE_LOGO_CACHE_MAX) {
        const oldest = sourceLogoFailures.keys().next().value as string | undefined;
        if (!oldest) break;
        sourceLogoFailures.delete(oldest);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => sourceLogoInFlight.delete(key));
  sourceLogoInFlight.set(key, request);
  return request;
}

app.get('/api/source-logo', (req, res) => {
  runAsync(res, async () => {
    const domain = normalizeLogoDomain(String(req.query.domain ?? ''));
    const size = integerQuery(req.query.sz, 64, 16, 128);
    if (!domain || size === null) {
      res.status(400).json({ error: 'valid domain and integer size required' });
      return;
    }
    const key = `${domain}:${size}`;
    const cached = cachedSourceLogo(key);
    if (cached) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.type(cached.contentType);
      res.send(cached.body);
      return;
    }

    try {
      const entry = await loadSourceLogo(domain, size);
      res.setHeader('Cache-Control', 'private, no-store');
      res.type(entry.contentType);
      res.send(entry.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The first upstream failure is observable; repeated browser image
      // retries during the negative-cache window are expected and must not
      // flood the operational ledger.
      if (message !== 'source logo is cooling down') {
        safeLogEvent('error_event', null, { source: 'source-logo.fetch', domain, message });
      }
      res.status(502).json({ error: 'source logo unavailable' });
    }
  });
});

app.get('/api/market/quote', (req, res) => {
  runAsync(res, async () => {
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
  });
});

const KLINE_INTERVALS = new Set(['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);
const FUTURES_DATA_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
app.get('/api/klines', (req, res) => {
  runAsync(res, async () => {
    const symbol = String(req.query.symbol ?? 'BTCUSDT');
    const interval = String(req.query.interval ?? '5m');
    const limit = integerQuery(req.query.limit, 288, 1, 1_000);
    const market = req.query.market === 'futures' ? 'futures' : 'spot';
    const field = req.query.field === 'volume' ? 'volume' : 'close';
    if (limit === null || !KLINE_INTERVALS.has(interval) || !/^[A-Z0-9]{1,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol or interval' });
      return;
    }
    try {
      res.json(await fetchKlines(symbol, interval, limit, market, field));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });
});

app.get('/api/candles', (req, res) => {
  runAsync(res, async () => {
    const symbol = String(req.query.symbol ?? 'BTCUSDT');
    const interval = String(req.query.interval ?? '5m');
    const limit = integerQuery(req.query.limit, 288, 1, 1_000);
    const market = req.query.market === 'futures' ? 'futures' : 'spot';
    if (limit === null || !KLINE_INTERVALS.has(interval) || !/^[A-Z0-9]{1,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol or interval' });
      return;
    }
    try {
      res.json(await fetchKlineCandles(symbol, interval, limit, market));
    } catch (err) {
      res.status(502).json({ error: String(err) });
    }
  });
});

app.get('/api/market/depth', (req, res) => {
  runAsync(res, async () => {
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
  });
});

app.get('/api/market/trades', (req, res) => {
  runAsync(res, async () => {
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
  });
});

app.get('/api/funding/history', (req, res) => {
  runAsync(res, async () => {
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
  });
});

app.get('/api/futures/telemetry', (req, res) => {
  runAsync(res, async () => {
    const symbol = String(req.query.symbol ?? '');
    const period = String(req.query.period ?? '5m');
    const limit = integerQuery(req.query.limit, 40, 1, 120);
    if (limit === null || !/^[A-Z0-9]{5,20}$/.test(symbol) || !FUTURES_DATA_PERIODS.has(period)) {
      res.status(400).json({ error: 'bad symbol or period' });
      return;
    }
    try {
      res.json(await fetchFuturesTelemetry(symbol, period, limit));
    } catch (err) {
      res.status(502).json({ error: String((err as Error).message) });
    }
  });
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
  runAsync(res, async () => {
    const symbol = String((req.body as Record<string, unknown>).symbol ?? '');
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
      res.status(400).json({ error: 'bad symbol' });
      return;
    }
    res.json(await orders.cancelAll(symbol));
  });
});

app.get('/api/loans/max-borrowable', (req, res) => {
  runAsync(res, async () => {
    const asset = String(req.query.asset ?? '').toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(asset)) {
      res.status(400).json({ error: 'bad asset' });
      return;
    }
    res.json(await loans.maxBorrowable(asset));
  });
});

// System health for the dedicated page.
const bootTs = Date.now();
let timeSync: { diffMs: number; latencyMs: number; ts: number } | null = null;

type WatchmanStatus = 'operational' | 'degraded' | 'outage' | 'planned';
type WatchmanGroup = 'control_path' | 'binance' | 'bot' | 'sources' | 'infrastructure';
type WatchmanResetTarget = 'market' | 'runtime' | 'account' | 'news' | 'calendar' | 'fx';
interface WatchmanComponent {
  id: string;
  label: string;
  group: WatchmanGroup;
  status: WatchmanStatus;
  detail: string;
  value: string;
  required: boolean;
  updatedAt: number | null;
  latencyMs?: number | null;
  resetTarget?: WatchmanResetTarget;
}
interface WatchmanTransition {
  ts: number;
  componentId: string;
  label: string;
  from: WatchmanStatus;
  to: WatchmanStatus;
  detail: string;
}

const watchmanPrevious = new Map<string, WatchmanStatus>();
const watchmanTransitions: WatchmanTransition[] = [];
let watchmanSuppressUntil = 0;
let watchmanLastReset: { ts: number; target: string; ok: boolean; durationMs: number } | null = null;
let browserWatchmanObservation: { status: WatchmanStatus; rttMs: number; socketConnected: boolean; observedAt: number } | null = null;

function connectionWatchmanSnapshot(
  dbOk: boolean,
  awsStatus: { configured: boolean; connectionEnabled: boolean; channel: string; region: string | null; instanceId: string | null },
  notificationRouting: ReturnType<typeof notificationRoutingSnapshot>,
  cloudflarePresent: boolean,
) {
  const now = Date.now();
  const feedStates = Object.values(engine.feeds);
  const openFeeds = feedStates.filter((state) => state === 'open').length;
  const basis = basisRuntime.connectionStatus();
  const volume = volumeRuntime.connectionStatus();
  const news = newsContextStatus();
  const accountAgeMs = account.lastSyncTs ? now - account.lastSyncTs : null;
  const newsAgeMs = news.fetchedAt ? now - news.fetchedAt : null;
  const calendarAgeMs = calCache?.at ? now - calCache.at : null;
  const fxAgeMs = fxCache?.at ? now - fxCache.at : null;
  const privateStream = String(userStream?.status ?? 'off').toLowerCase();

  const accountStatus: WatchmanStatus = !account.keysPresent
    ? 'planned'
    : !account.connected || accountAgeMs === null || accountAgeMs > 6 * 60_000
      ? 'outage'
      : accountAgeMs > 2 * 60_000
        ? 'degraded'
        : 'operational';
  const runtimeStatus: WatchmanStatus = !basis.running || !volume.running
    ? 'outage'
    : basis.bookState !== 'fresh' || basis.markState !== 'fresh' || volume.bookState !== 'fresh' || volume.streamState !== 'open'
      ? 'degraded'
      : 'operational';
  const newsStatus: WatchmanStatus = !news.fetchedAt || news.live === 0 || (newsAgeMs !== null && newsAgeMs > 5 * 60_000)
    ? 'outage'
    : news.errors > Math.max(3, Math.floor(news.sources * 0.2)) || (newsAgeMs !== null && newsAgeMs > 90_000)
      ? 'degraded'
      : 'operational';
  const awsConnectionStatus: WatchmanStatus = !awsStatus.configured
    ? 'planned'
    : awsStatus.channel === 'offline'
      ? 'outage'
      : awsStatus.channel === 'online'
        ? 'operational'
        : 'degraded';

  const components: WatchmanComponent[] = [
    {
      id: 'control-api', label: 'Website / Control API', group: 'control_path', status: 'operational',
      detail: 'This server answered the authenticated cockpit health probe', value: 'Online', required: true,
      updatedAt: now,
    },
    {
      id: 'market-streams', label: 'Binance Market Streams', group: 'binance',
      status: feedStates.length === 0 ? 'degraded' : openFeeds === feedStates.length ? 'operational' : openFeeds === 0 ? 'outage' : 'degraded',
      detail: 'Spot book, USD-M mark price, and liquidation stream sockets',
      value: `${openFeeds}/${feedStates.length} open`, required: true, updatedAt: now, resetTarget: 'market',
    },
    {
      id: 'binance-rest', label: 'Binance REST / Clock', group: 'binance',
      status: !timeSync ? 'outage' : timeSync.latencyMs > 1_100 ? 'outage' : timeSync.latencyMs > 600 ? 'degraded' : 'operational',
      detail: `Server clock drift ${timeSync ? Math.round(timeSync.diffMs) : '—'} ms · ${rateLimit.ts > 0 ? rateLimit.usedWeight1m : '—'} weight / 1m`,
      value: timeSync ? `${Math.round(timeSync.latencyMs)} ms` : 'No probe', required: true,
      updatedAt: timeSync?.ts ?? null, latencyMs: timeSync?.latencyMs ?? null,
    },
    {
      id: 'binance-account', label: 'Binance Signed Account', group: 'binance', status: accountStatus,
      detail: account.keysPresent ? 'Balances, orders, loans, fills, and key posture' : 'No signed read key is configured on this server',
      value: !account.keysPresent ? 'Not configured' : account.lastSyncTs ? `${Math.max(0, Math.round((now - account.lastSyncTs) / 1000))}s ago` : 'No sync',
      required: account.keysPresent, updatedAt: account.lastSyncTs, resetTarget: 'account',
    },
    {
      id: 'strategy-runtimes', label: 'Bot Strategy Runtimes', group: 'bot', status: runtimeStatus,
      detail: `Basis ${basis.bookState}/${basis.markState} · Volume ${volume.streamState} ${volume.openConnections}/${volume.streamConnections}`,
      value: runtimeStatus === 'operational' ? 'Processing' : runtimeStatus === 'degraded' ? 'Lagging' : 'Stopped',
      required: true, updatedAt: Math.max(basis.lastBookTs ?? 0, volume.lastTradeTs ?? 0) || null, resetTarget: 'runtime',
    },
    {
      id: 'ledger-db', label: 'Ledger Database', group: 'bot', status: dbOk ? 'operational' : 'outage',
      detail: 'Decisions, fills, events, configuration, and visitor telemetry', value: dbOk ? 'Writable' : 'Write failed',
      required: true, updatedAt: now,
    },
    {
      id: 'user-stream', label: 'Binance User Stream', group: 'binance',
      status: ['open', 'live', 'connected'].includes(privateStream) ? 'operational' : 'degraded',
      detail: ['open', 'live', 'connected'].includes(privateStream) ? 'Private account-event socket' : 'Optional socket unavailable · 30s signed REST fallback active',
      value: ['open', 'live', 'connected'].includes(privateStream) ? 'Live' : 'Fallback', required: false,
      updatedAt: account.lastSyncTs, resetTarget: 'account',
    },
    {
      id: 'news-sources', label: 'News Source Network', group: 'sources', status: newsStatus,
      detail: `${news.live} live · ${news.delayed} delayed · ${news.errors} errors · ${news.items} retained`,
      value: `${news.live}/${news.sources} live`, required: true, updatedAt: news.fetchedAt, resetTarget: 'news',
    },
    {
      id: 'calendar-source', label: 'Economic Calendar', group: 'sources',
      status: !calCache?.at || !calCache.items.length ? 'outage' : calendarAgeMs !== null && calendarAgeMs > 10 * 60_000 ? 'degraded' : 'operational',
      detail: 'TradingView macro-event cache with actual, forecast, and prior values',
      value: `${calCache?.items.length ?? 0} events`, required: true, updatedAt: calCache?.at ?? null, resetTarget: 'calendar',
    },
    {
      id: 'fx-source', label: 'FX Reference Rates', group: 'sources',
      status: !fxCache?.at || !Object.keys(fxCache.rates).length ? 'outage' : fxAgeMs !== null && fxAgeMs > 45 * 60_000 ? 'degraded' : 'operational',
      detail: 'Display-currency conversion cache; trading decisions remain USD based',
      value: `${fxCache ? Object.keys(fxCache.rates).length : 0} currencies`, required: true, updatedAt: fxCache?.at ?? null, resetTarget: 'fx',
    },
    {
      id: 'aws-runner', label: 'AWS EC2 Runner', group: 'infrastructure', status: awsConnectionStatus,
      detail: !awsStatus.configured ? 'Secure SSM runner target is not configured' : `${awsStatus.region ?? 'Region unknown'} · ${awsStatus.instanceId ?? 'Instance unknown'} · ${awsStatus.connectionEnabled ? 'channel allowed' : 'channel blocked'}`,
      value: !awsStatus.configured ? 'Planned' : awsStatus.channel === 'online' ? 'Online' : awsStatus.channel === 'offline' ? 'Offline' : 'Ready',
      required: awsStatus.configured, updatedAt: now,
    },
    {
      id: 'cloudflare-edge', label: 'Cloudflare Access Edge', group: 'infrastructure',
      status: cloudflarePresent ? 'operational' : 'planned',
      detail: cloudflarePresent ? 'Verified edge request and routed visitor identity' : 'Only available on the deployed hostname',
      value: cloudflarePresent ? 'Present' : 'Localhost', required: cloudflarePresent, updatedAt: now,
    },
    {
      id: 'alert-routing', label: 'Failure Notification Route', group: 'infrastructure', status: 'operational',
      detail: `${Object.values(notificationRouting.destinations).filter((destination) => destination.available).length} active route · transition-only policy`,
      value: 'In-App Live', required: true, updatedAt: now,
    },
  ];

  for (const component of components) {
    const previous = watchmanPrevious.get(component.id);
    watchmanPrevious.set(component.id, component.status);
    if (!previous || previous === component.status || !component.required || component.status === 'planned' || now - bootTs < 30_000 || now < watchmanSuppressUntil) continue;
    const recovered = component.status === 'operational' && previous !== 'operational';
    const actionable = component.status === 'degraded' || component.status === 'outage';
    if (!recovered && !actionable) continue;
    const transition: WatchmanTransition = {
      ts: now, componentId: component.id, label: component.label, from: previous, to: component.status, detail: component.detail,
    };
    watchmanTransitions.unshift(transition);
    watchmanTransitions.splice(20);
    if (dbOk) {
      try {
        ledger.logEvent(recovered ? 'connection_recovered' : 'connection_alert', null, {
          componentId: component.id,
          component: component.label,
          group: component.group,
          previousStatus: previous,
          status: component.status,
          detail: component.detail,
          value: component.value,
          resetTarget: component.resetTarget ?? null,
          observedAt: now,
        });
      } catch {
        // Health reporting must remain available while persistence is degraded.
      }
    }
  }

  const required = components.filter((component) => component.required && component.status !== 'planned');
  const outage = required.filter((component) => component.status === 'outage').length;
  const degraded = required.filter((component) => component.status === 'degraded').length;
  const operational = required.filter((component) => component.status === 'operational').length;
  return {
    assessedAt: now,
    status: outage > 0 ? 'outage' : degraded > 0 ? 'degraded' : 'operational',
    summary: {
      operational,
      degraded,
      outage,
      required: required.length,
      total: components.length,
      sourceCoverage: news.sources,
      liveSources: news.live,
    },
    components,
    recentTransitions: watchmanTransitions.slice(0, 8),
    lastReset: watchmanLastReset,
    browserObservation: browserWatchmanObservation,
  };
}

app.get('/api/system', (req, res) => {
  runAsync(res, async () => {
    if (!timeSync || Date.now() - timeSync.ts > 60_000) {
      try {
        const t = await fetchBinanceServerTime();
        timeSync = { ...t, ts: Date.now() };
      } catch {
        timeSync = null;
      }
    }
    const dbOk = ledger.probeWritable();
    const awsStatus = await awsRunnerControl.status(false, null, false);
    const notificationRouting = notificationRoutingSnapshot();
    const watchman = connectionWatchmanSnapshot(dbOk, awsStatus, notificationRouting, Boolean(req.headers['cf-ray']));
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
        keyPermissions: account.keyRestrictions,
        keyPermissionsTs: account.lastRestrictionsTs,
        keyPosture: keyPosture(account.keyRestrictions, account.keysPresent),
      },
      restLatencyMs: timeSync?.latencyMs ?? null,
      serverTimeDiffMs: timeSync?.diffMs ?? null,
      timeSyncTs: timeSync?.ts ?? null,
      usedWeight1m: rateLimit.ts > 0 ? rateLimit.usedWeight1m : null,
      usedWeightTs: rateLimit.ts || null,
      binanceCooldownUntil: rateLimit.cooldownUntil > Date.now() ? rateLimit.cooldownUntil : null,
      lastScannerTickTs: scanner.lastTickTs,
      lastOrdersSyncTs: orders.lastOrdersSyncTs,
      dbOk,
      connections: {
        basis: basisRuntime.connectionStatus(),
        volume: volumeRuntime.connectionStatus(),
        news: newsContextStatus(),
        calendar: {
          fetchedAt: calCache?.at ?? null,
          items: calCache?.items.length ?? 0,
          refreshing: calInFlight !== null,
        },
        fx: {
          fetchedAt: fxCache?.at ?? null,
          currencies: fxCache ? Object.keys(fxCache.rates).length : 0,
          refreshing: fxInFlight !== null,
        },
        watchman,
        planned: {
          awsRunner: {
            ready: awsStatus.configured && awsStatus.channel === 'online',
            configured: awsStatus.configured,
            state: awsStatus.channel,
            reason: awsStatus.configured ? (awsStatus.connectionEnabled ? 'Awaiting or using an authorized SSM probe' : 'AWS Channel is blocked') : `Missing ${awsStatus.missing.join(', ')}`,
          },
          cloudflareAccess: {
            ready: Boolean(req.headers['cf-ray']),
            configured: Boolean(process.env.CF_ACCESS_TEAM_DOMAIN && process.env.CF_ACCESS_AUD),
            state: req.headers['cf-ray'] ? 'live' : 'not_present',
            reason: req.headers['cf-ray'] ? 'Cloudflare edge request verified' : 'Only present on the deployed hostname',
          },
          externalAlerts: {
            ready: Object.entries(notificationRouting.destinations).filter(([key]) => key !== 'inApp').some(([, destination]) => destination.available),
            configured: Object.entries(notificationRouting.destinations).filter(([key]) => key !== 'inApp').some(([, destination]) => destination.available),
            state: 'planned',
            reason: 'Email, Telegram, WhatsApp, and AWS SNS require provider credentials',
          },
        },
      },
      killSwitch: config.killSwitch,
      liveTradingEnabled: config.liveTradingEnabled,
      cfUser: operatorAccess.operator(req)?.email ?? null,
      // Real edge session facts from Cloudflare (present in prod; null on localhost).
      cfIp: (req.headers['cf-connecting-ip'] as string | undefined) ?? null,
      cfCountry: (req.headers['cf-ipcountry'] as string | undefined) ?? null,
      cfRay: (req.headers['cf-ray'] as string | undefined) ?? null,
      serverStartTs: bootTs,
    });
  });
});

// Browser RTT is measurable only from the browser. Accept a small, sanitized
// observation so material client-path lag and recovery use the same
// transition-only notification pipeline as server-owned connections.
app.post('/api/connections/browser-observation', (req, res) => {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const rttMs = Number(body.rttMs);
  const socketConnected = body.socketConnected === true;
  if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > 120_000) {
    res.status(400).json({ ok: false, error: 'valid rttMs required' });
    return;
  }
  const now = Date.now();
  const status: WatchmanStatus = !socketConnected || rttMs >= 800 ? 'outage' : rttMs >= 350 ? 'degraded' : 'operational';
  const previous = watchmanPrevious.get('browser-session');
  watchmanPrevious.set('browser-session', status);
  browserWatchmanObservation = { status, rttMs, socketConnected, observedAt: now };
  if (previous && previous !== status && now - bootTs >= 30_000 && now >= watchmanSuppressUntil) {
    const recovered = status === 'operational';
    const transition: WatchmanTransition = {
      ts: now,
      componentId: 'browser-session',
      label: 'Browser / Website Session',
      from: previous,
      to: status,
      detail: `Control API ${Math.round(rttMs)} ms · cockpit socket ${socketConnected ? 'live' : 'reconnecting'}`,
    };
    watchmanTransitions.unshift(transition);
    watchmanTransitions.splice(20);
    try {
      ledger.logEvent(recovered ? 'connection_recovered' : 'connection_alert', null, {
        componentId: transition.componentId,
        component: transition.label,
        group: 'control_path',
        previousStatus: previous,
        status,
        detail: transition.detail,
        value: `${Math.round(rttMs)} ms`,
        resetTarget: null,
        observedAt: now,
      });
    } catch {
      // The browser observation remains valid even when telemetry storage is degraded.
    }
  }
  res.json({ ok: true, observation: browserWatchmanObservation });
});

// ---- API key inventory (top-bar "API Key" tab) -----------------------------
// A small, editable manifest describing the Binance API key(s) this deployment
// uses, so the owner can confirm at a glance WHICH key is live and what it may
// do — without ever exposing the key or secret. The prefix is the REAL first 8
// chars of the loaded key when one is present (so a key swap is visible);
// otherwise it falls back to the declared prefix. Rotate the key or add the
// full-access key by editing these env vars (or the defaults below).
function apiKeyManifest() {
  const declaredPrefix = process.env.BINANCE_KEY_PREFIX || '—';
  const ips = (process.env.BINANCE_KEY_IPS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  // Only Binance's live per-key restriction response is authoritative. Never
  // turn an unavailable permission read into reassuring false values.
  const r = account.keyRestrictions;
  const posture = keyPosture(r, Boolean(creds));
  const permissions = r
    ? {
        reading: r.enableReading,
        spotMargin: r.enableSpotAndMarginTrading,
        marginLoan: r.enableMargin,
        withdrawals: r.enableWithdrawals,
        universalTransfer: r.permitsUniversalTransfer,
        futures: r.enableFutures,
      }
    : { reading: null, spotMargin: null, marginLoan: null, withdrawals: null, universalTransfer: null, futures: null };
  const fullIps = (process.env.BINANCE_FULL_KEY_IPS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return [
    {
      id: 'read-only',
      name: process.env.BINANCE_KEY_NAME || 'cosmos-local-read-only',
      type: process.env.BINANCE_KEY_TYPE || 'HMAC',
      scope: posture.level === 'unsafe'
        ? 'Unsafe permissions'
        : posture.level === 'elevated'
          ? 'Elevated permissions'
          : posture.level === 'trading'
            ? 'Trading'
            : posture.level === 'read_only'
              ? 'Read-only'
              : 'Unknown',
      status: r ? 'live' : creds ? 'unknown' : 'missing',
      live: !!r, // permissions are the real, cross-checkable ones from Binance
      keysPresent: !!creds,
      prefix: creds ? creds.apiKey.slice(0, 8) : declaredPrefix, // first 8 only — never the full key
      fingerprint: creds ? maskApiKey(creds.apiKey) : null,
      ipRestrict: r ? r.ipRestrict : null,
      ips,
      ipNote: creds ? 'Restriction declared by server environment' : 'No key is loaded',
      permissions,
      note: creds
        ? r
          ? posture.level === 'unsafe'
            ? 'Unsafe transfer or withdrawal authority is enabled. Recreate this key before operating the control room.'
            : null
          : 'Live permissions are unavailable; every permission remains unknown until Binance verifies it.'
        : 'Declared config — no key wired into this server yet.',
      updatedAt: account.lastRestrictionsTs,
    },
    {
      // Future AWS automation key, restricted to the EC2 egress IP. Its
      // requested permission scope is visible, but status remains PLANNED until
      // a credential is actually wired and Binance confirms the live posture.
      id: 'secrets-full',
      name: process.env.BINANCE_FULL_KEY_NAME || 'Automation key',
      type: process.env.BINANCE_FULL_KEY_TYPE || 'HMAC',
      scope: 'Automation',
      status: 'planned',
      live: false,
      keysPresent: false,
      prefix: process.env.BINANCE_FULL_KEY_PREFIX || '—',
      fingerprint: null,
      ipRestrict: fullIps.length > 0,
      ips: fullIps,
      ipNote: 'AWS runner egress',
      permissions: { reading: true, spotMargin: true, marginLoan: true, withdrawals: false, universalTransfer: false, futures: true },
      note: 'Planned only. No credential is active; withdrawal and universal-transfer permissions remain forbidden.',
      updatedAt: bootTs,
    },
  ];
}

type ConnectionRefreshTarget = 'all' | 'market' | 'runtime' | 'account' | 'news' | 'calendar' | 'fx';
const CONNECTION_REFRESH_TARGETS = new Set<ConnectionRefreshTarget>(['all', 'market', 'runtime', 'account', 'news', 'calendar', 'fx']);
let connectionRefreshBusy = false;

// On-demand connection control. "all" is a real reconnect cycle: rebuild the
// Binance market/runtime streams, re-open the optional user stream, resync the
// signed account/order/wallet state, and force every server-owned cache source.
// Targeted retries use the same implementation without pretending that a local
// polling preference can restart an upstream connection by itself.
app.post('/api/refresh', (req, res) => {
  runAsync(res, async () => {
    const rawTarget = (req.body as { target?: unknown } | null)?.target;
    const requested = typeof rawTarget === 'string' ? rawTarget : '';
    if (!CONNECTION_REFRESH_TARGETS.has(requested as ConnectionRefreshTarget)) {
      res.status(400).json({ ok: false, issues: ['An explicit connection refresh target is required'], target: requested || null, ts: Date.now() });
      return;
    }
    const target = requested as ConnectionRefreshTarget;
    if (connectionRefreshBusy) {
      res.status(409).json({ ok: false, issues: ['A connection reset is already running'], target, ts: Date.now() });
      return;
    }
    connectionRefreshBusy = true;
    // An intentional restart briefly closes sockets by design. Do not promote
    // those expected transitions as outages; keep monitoring and resume alerts
    // after the recovery has had time to converge.
    watchmanSuppressUntil = Date.now() + 60_000;
    const startedAt = Date.now();
    const issues: string[] = [];
    const steps: { key: string; ok: boolean; durationMs: number; detail: string }[] = [];
    const runStep = async (key: string, fn: () => Promise<string> | string) => {
      const stepStartedAt = Date.now();
      try {
        const detail = await fn();
        steps.push({ key, ok: true, durationMs: Date.now() - stepStartedAt, detail });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push(`${key}: ${message}`);
        steps.push({ key, ok: false, durationMs: Date.now() - stepStartedAt, detail: message });
      }
    };

    try {
      if (target === 'all' || target === 'market') {
        await runStep('market-streams', async () => {
          basisRuntime.stop();
          volumeRuntime.stop();
          engine.stop();
          engine.start();
          await Promise.all([basisRuntime.start(), volumeRuntime.start()]);
          return `${Object.keys(engine.feeds).length} core feeds restarted`;
        });
      } else if (target === 'runtime') {
        await runStep('strategy-runtimes', async () => {
          basisRuntime.stop();
          volumeRuntime.stop();
          await Promise.all([basisRuntime.start(), volumeRuntime.start()]);
          return 'Basis and volume runtimes restarted';
        });
      }

      if (target === 'all' || target === 'account') {
        await runStep('account-data', async () => {
          await account.sync();
          await orders.syncOpenOrders();
          await orders.reconcilePendingOrders();
          if (account.keysPresent) await refreshWalletBalances(true);
          if (userStream) {
            userStream.stop();
            await userStream.start();
          }
          return account.keysPresent ? 'Account, orders, wallets, and user stream reset' : 'No signed account key configured';
        });
      }

      if (target === 'all' || target === 'news') {
        await runStep('news-context', async () => {
          const payload = await refreshNewsContextNow();
          return `${payload.sources.length} source states refreshed`;
        });
      }
      if (target === 'all' || target === 'calendar') {
        await runStep('economic-calendar', async () => {
          if (!(await startCalendarRefresh())) throw new Error('Economic calendar refresh failed');
          return `${calCache?.items.length ?? 0} events cached`;
        });
      }
      if (target === 'all' || target === 'fx') {
        await runStep('fx-rates', async () => {
          await refreshFx();
          return `${fxCache ? Object.keys(fxCache.rates).length : 0} currencies cached`;
        });
      }

      broadcast({ type: 'state', payload: buildState() });
      const feedVals = Object.values(engine.feeds);
      const feedsOk = feedVals.length > 0 && feedVals.every((status) => status === 'open');
      if (account.keysPresent && !account.connected) {
        issues.push(account.lastError ? `Binance account: ${account.lastError}` : 'Binance account not synced');
      }
      ledger.logEvent('connections.reset', null, {
        target,
        ok: issues.length === 0,
        durationMs: Date.now() - startedAt,
        steps,
      });
      watchmanLastReset = {
        ts: Date.now(),
        target,
        ok: issues.length === 0,
        durationMs: Date.now() - startedAt,
      };
      res.json({
        ok: issues.length === 0,
        binanceConnected: account.connected,
        walletBalancesOk: !steps.some((step) => step.key === 'account-data' && !step.ok),
        feedsOk,
        keysPresent: account.keysPresent,
        issues,
        ts: Date.now(),
        reset: { target, startedAt, finishedAt: Date.now(), steps },
      });
    } finally {
      connectionRefreshBusy = false;
      watchmanSuppressUntil = Math.max(watchmanSuppressUntil, Date.now() + 15_000);
    }
  });
});

app.get('/api/apikey', (_req, res) => {
  res.json({ keys: apiKeyManifest(), activeId: 'read-only', ts: Date.now() });
});

app.get('/api/aws-control/status', (req, res) => {
  void (async () => {
    const operator = await awsOperator(req);
    const probe = req.query.probe === '1';
    const status = await awsRunnerControl.status(operator.authorized, operator.operator, probe);
    res.json({ ok: true, status, authorizationReason: operator.authorized ? null : operator.reason });
  })().catch((error) => sendAwsControlError(res, error));
});

app.post('/api/aws-control/gates', (req, res) => {
  void (async () => {
    const operator = await requireAwsOperator(req, res);
    if (!operator) return;
    const body = req.body as Record<string, unknown>;
    const provided = ['connectionEnabled', 'executionEnabled'].filter((key) => body[key] !== undefined);
    if (provided.length === 0 || provided.some((key) => typeof body[key] !== 'boolean')) {
      res.status(400).json({ ok: false, code: 'INVALID_AWS_GATES', error: 'At least one explicit boolean gate is required.' });
      return;
    }
    const gates = awsRunnerControl.setGates({
      connectionEnabled: typeof body.connectionEnabled === 'boolean' ? body.connectionEnabled : undefined,
      executionEnabled: typeof body.executionEnabled === 'boolean' ? body.executionEnabled : undefined,
    }, operator.operator);
    res.json({ ok: true, gates });
  })().catch((error) => sendAwsControlError(res, error));
});

app.post('/api/aws-control/command', (req, res) => {
  void (async () => {
    const operator = await requireAwsOperator(req, res);
    if (!operator) return;
    const rawCommand = (req.body as Record<string, unknown>).command;
    const command = typeof rawCommand === 'string' && rawCommand.length <= 80 ? rawCommand : '';
    if (!command) {
      res.status(400).json({ ok: false, code: 'INVALID_AWS_COMMAND', error: 'A valid command is required.' });
      return;
    }
    ledger.logEvent('aws_runner_request', null, { operator: operator.operator, command: command.toLowerCase() });
    const result = await awsRunnerControl.runCommand(command);
    res.json({ ok: true, result });
  })().catch((error) => sendAwsControlError(res, error));
});

app.get('/api/aws-control/runner', (req, res) => {
  void (async () => {
    const operator = await requireAwsOperator(req, res);
    if (!operator) return;
    ledger.logEvent('aws_runner_request', null, { operator: operator.operator, command: 'read_runner' });
    const file = await awsRunnerControl.readRunner();
    res.json({ ok: true, file });
  })().catch((error) => sendAwsControlError(res, error));
});

app.put('/api/aws-control/runner', (req, res) => {
  void (async () => {
    const operator = await requireAwsOperator(req, res);
    if (!operator) return;
    const body = req.body as Record<string, unknown>;
    const content = typeof body.content === 'string' ? body.content : null;
    const expectedSha256 = typeof body.expectedSha256 === 'string' && /^[a-f0-9]{64}$/.test(body.expectedSha256)
      ? body.expectedSha256
      : body.expectedSha256 === null || body.expectedSha256 === undefined ? null : undefined;
    if (content === null || expectedSha256 === undefined) {
      res.status(400).json({ ok: false, code: 'INVALID_RUNNER_SOURCE', error: 'Runner content or expected hash is invalid.' });
      return;
    }
    ledger.logEvent('aws_runner_request', null, { operator: operator.operator, command: 'save_runner', bytes: Buffer.byteLength(content) });
    const file = await awsRunnerControl.saveRunner(content, expectedSha256);
    res.json({ ok: true, file: { ...file, content: undefined } });
  })().catch((error) => sendAwsControlError(res, error));
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
const NUMERIC_RULES: Partial<Record<keyof AppConfig, { minimum: number; maximum: number; integer?: boolean }>> = {
  feesPct: { minimum: 0, maximum: 10 },
  minNetBasisPct: { minimum: 0, maximum: 100 },
  persistTicks: { minimum: 1, maximum: 10_000, integer: true },
  minQuoteVolume24h: { minimum: 0, maximum: 1_000_000_000_000 },
  maxOrderNotionalUsd: { minimum: 0.01, maximum: 1_000_000_000 },
  maxDailyNotionalUsd: { minimum: 0.01, maximum: 10_000_000_000 },
  maxDailyLossUsd: { minimum: 0.01, maximum: 1_000_000_000 },
  maxOpenOrders: { minimum: 1, maximum: 10_000, integer: true },
  cooldownSec: { minimum: 0, maximum: 86_400, integer: true },
  staleOrderMaxMin: { minimum: 1, maximum: 43_200, integer: true },
};
const LIST_KEYS: (keyof AppConfig)[] = ['allowedSymbols', 'blockedSymbols', 'watchlist'];
const BOOLEAN_KEYS: (keyof AppConfig)[] = ['killSwitch', 'liveTradingEnabled', 'fundsLocked', 'automationPaused'];
const COIN_RE = /^[A-Z0-9]{1,20}$/;
const CONTROL_MODE_VALUES = new Set<ControlMode>(['blocked', 'paused', 'allowed']);

function parseCoinList(v: unknown, max = 40): string[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length > max || !v.every((x) => typeof x === 'string' && COIN_RE.test(x))) return null;
  const rows = v as string[];
  return [...new Set(rows)];
}

app.post('/api/config', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {}; // applied to config
  const logPatch: Record<string, unknown> = {}; // written to the ledger (no image bytes)
  const invalidFields: string[] = [];
  const nextControlModes: ExecutionControlModes = { ...config.controlModes };
  const touchedControlModes = new Set<keyof ExecutionControlModes>();
  for (const key of NUMERIC_KEYS) {
    const v = body[key];
    if (v === undefined) continue;
    const rule = NUMERIC_RULES[key]!;
    if (
      typeof v === 'number'
      && Number.isFinite(v)
      && v >= rule.minimum
      && v <= rule.maximum
      && (!rule.integer || Number.isSafeInteger(v))
    ) {
      patch[key] = v;
      logPatch[key] = v;
    } else invalidFields.push(String(key));
  }
  for (const key of LIST_KEYS) {
    const v = body[key];
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === 'string' && /^[A-Z0-9]{4,20}$/.test(x))) {
      patch[key] = [...new Set(v)];
      logPatch[key] = patch[key];
    } else invalidFields.push(String(key));
  }
  for (const key of BOOLEAN_KEYS) {
    const v = body[key];
    if (v === undefined) continue;
    if (typeof v === 'boolean') {
      patch[key] = v;
      logPatch[key] = v;
    } else invalidFields.push(String(key));
  }
  if (typeof body.fundsLocked === 'boolean') {
    nextControlModes.funds = body.fundsLocked ? 'blocked' : 'allowed';
    touchedControlModes.add('funds');
  }
  if (typeof body.automationPaused === 'boolean') {
    nextControlModes.automation = body.automationPaused ? 'paused' : 'allowed';
    touchedControlModes.add('automation');
  }
  if (typeof body.liveTradingEnabled === 'boolean') {
    nextControlModes.liveOrders = body.liveTradingEnabled ? 'allowed' : 'paused';
    touchedControlModes.add('liveOrders');
  }
  if (body.borrowGuard !== undefined && (!body.borrowGuard || typeof body.borrowGuard !== 'object' || Array.isArray(body.borrowGuard))) {
    invalidFields.push('borrowGuard');
  } else if (body.borrowGuard && typeof body.borrowGuard === 'object') {
    const g = body.borrowGuard as Record<string, unknown>;
    const cur = config.borrowGuard;
    const next = { ...cur };
    for (const key of ['enabled', 'newBorrowPaused', 'repayOnly', 'requireLiveCatalog'] as const) {
      if (g[key] !== undefined && typeof g[key] !== 'boolean') invalidFields.push(`borrowGuard.${key}`);
    }
    if (g.requireLiveCatalog === false) invalidFields.push('borrowGuard.requireLiveCatalog');
    if (g.maxLtvPct !== undefined && (typeof g.maxLtvPct !== 'number' || !Number.isFinite(g.maxLtvPct) || g.maxLtvPct < 10 || g.maxLtvPct > 90)) invalidFields.push('borrowGuard.maxLtvPct');
    if (g.maxAprPct !== undefined && (typeof g.maxAprPct !== 'number' || !Number.isFinite(g.maxAprPct) || g.maxAprPct < 0 || g.maxAprPct > 200)) invalidFields.push('borrowGuard.maxAprPct');
    if (g.maxBorrowNotionalUsd !== undefined && (typeof g.maxBorrowNotionalUsd !== 'number' || !Number.isFinite(g.maxBorrowNotionalUsd) || g.maxBorrowNotionalUsd < 0.01 || g.maxBorrowNotionalUsd > 10_000_000)) invalidFields.push('borrowGuard.maxBorrowNotionalUsd');
    if (typeof g.enabled === 'boolean') next.enabled = g.enabled;
    if (typeof g.newBorrowPaused === 'boolean') next.newBorrowPaused = g.newBorrowPaused;
    if (typeof g.repayOnly === 'boolean') next.repayOnly = g.repayOnly;
    next.requireLiveCatalog = true;
    if (typeof g.maxLtvPct === 'number' && Number.isFinite(g.maxLtvPct) && g.maxLtvPct >= 10 && g.maxLtvPct <= 90) next.maxLtvPct = g.maxLtvPct;
    if (typeof g.maxAprPct === 'number' && Number.isFinite(g.maxAprPct) && g.maxAprPct >= 0 && g.maxAprPct <= 200) next.maxAprPct = g.maxAprPct;
    if (typeof g.maxBorrowNotionalUsd === 'number' && Number.isFinite(g.maxBorrowNotionalUsd) && g.maxBorrowNotionalUsd >= 0.01 && g.maxBorrowNotionalUsd <= 10_000_000) next.maxBorrowNotionalUsd = g.maxBorrowNotionalUsd;
    const allowedCollateralCoins = parseCoinList(g.allowedCollateralCoins, 12);
    const blockedLoanCoins = parseCoinList(g.blockedLoanCoins, 40);
    if (g.allowedCollateralCoins !== undefined && allowedCollateralCoins === null) invalidFields.push('borrowGuard.allowedCollateralCoins');
    if (g.blockedLoanCoins !== undefined && blockedLoanCoins === null) invalidFields.push('borrowGuard.blockedLoanCoins');
    if (allowedCollateralCoins) next.allowedCollateralCoins = allowedCollateralCoins;
    if (blockedLoanCoins) next.blockedLoanCoins = blockedLoanCoins;
    patch.borrowGuard = next;
    logPatch.borrowGuard = {
      enabled: next.enabled,
      newBorrowPaused: next.newBorrowPaused,
      repayOnly: next.repayOnly,
      maxLtvPct: next.maxLtvPct,
      maxAprPct: next.maxAprPct,
      maxBorrowNotionalUsd: next.maxBorrowNotionalUsd,
      requireLiveCatalog: next.requireLiveCatalog,
      allowedCollateralCoins: next.allowedCollateralCoins,
      blockedLoanCoins: next.blockedLoanCoins,
    };
    nextControlModes.borrowing = !next.newBorrowPaused && !next.repayOnly
      ? 'allowed'
      : next.repayOnly
        ? 'blocked'
        : 'paused';
    touchedControlModes.add('borrowing');
  }
  if (body.controlModes !== undefined && (!body.controlModes || typeof body.controlModes !== 'object' || Array.isArray(body.controlModes))) {
    invalidFields.push('controlModes');
  } else if (body.controlModes && typeof body.controlModes === 'object') {
    const incoming = body.controlModes as Record<string, unknown>;
    for (const key of ['funds', 'borrowing', 'automation', 'liveOrders'] as const) {
      const value = incoming[key];
      if (typeof value === 'string' && CONTROL_MODE_VALUES.has(value as ControlMode)) {
        nextControlModes[key] = value as ControlMode;
        touchedControlModes.add(key);
      } else if (value !== undefined) invalidFields.push(`controlModes.${key}`);
    }
  }
  if (touchedControlModes.size > 0) {
    patch.controlModes = nextControlModes;
    logPatch.controlModes = nextControlModes;
    if (touchedControlModes.has('funds')) {
      patch.fundsLocked = nextControlModes.funds !== 'allowed';
      logPatch.fundsLocked = patch.fundsLocked;
    }
    if (touchedControlModes.has('automation')) {
      patch.automationPaused = nextControlModes.automation !== 'allowed';
      logPatch.automationPaused = patch.automationPaused;
    }
    if (touchedControlModes.has('liveOrders')) {
      patch.liveTradingEnabled = nextControlModes.liveOrders === 'allowed';
      logPatch.liveTradingEnabled = patch.liveTradingEnabled;
    }
    if (touchedControlModes.has('borrowing')) {
      const nextGuard = {
        ...config.borrowGuard,
        ...((patch.borrowGuard && typeof patch.borrowGuard === 'object') ? patch.borrowGuard as AppConfig['borrowGuard'] : {}),
        enabled: true,
        newBorrowPaused: nextControlModes.borrowing !== 'allowed',
        repayOnly: nextControlModes.borrowing === 'blocked',
      };
      patch.borrowGuard = nextGuard;
      logPatch.borrowGuard = {
        enabled: nextGuard.enabled,
        newBorrowPaused: nextGuard.newBorrowPaused,
        repayOnly: nextGuard.repayOnly,
        maxLtvPct: nextGuard.maxLtvPct,
        maxAprPct: nextGuard.maxAprPct,
        maxBorrowNotionalUsd: nextGuard.maxBorrowNotionalUsd,
        requireLiveCatalog: nextGuard.requireLiveCatalog,
        allowedCollateralCoins: nextGuard.allowedCollateralCoins,
        blockedLoanCoins: nextGuard.blockedLoanCoins,
      };
    }
  }
  // owner profile: short name + small data-URL avatar (server-side, follows the box)
  if (body.profile !== undefined && (!body.profile || typeof body.profile !== 'object' || Array.isArray(body.profile))) {
    invalidFields.push('profile');
  } else if (body.profile && typeof body.profile === 'object') {
    const p = body.profile as Record<string, unknown>;
    if (p.name !== undefined && typeof p.name !== 'string') invalidFields.push('profile.name');
    if (p.avatar !== undefined && p.avatar !== null && (typeof p.avatar !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(p.avatar) || p.avatar.length > 160_000)) invalidFields.push('profile.avatar');
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
  } else if (body.customRules !== undefined) {
    invalidFields.push('customRules');
  }
  if (invalidFields.length > 0) {
    res.status(400).json({ code: 'INVALID_CONFIG', error: 'Configuration contains invalid fields.', fields: [...new Set(invalidFields)] });
    return;
  }
  const nextConfig = { ...config, ...patch } as AppConfig;
  saveConfig(ledger, nextConfig);
  Object.assign(config, nextConfig);
  ledger.logEvent('config_change', null, logPatch);
  res.json(config);
});

app.post('/api/kill', (req, res) => {
  const on = (req.body as Record<string, unknown>).on;
  if (typeof on !== 'boolean') {
    res.status(400).json({ error: 'kill switch requires a boolean on value' });
    return;
  }
  const nextConfig = { ...config, killSwitch: on };
  saveConfig(ledger, nextConfig);
  Object.assign(config, nextConfig);
  ledger.logEvent('manual_action', null, { action: 'kill_switch', on: config.killSwitch });
  res.json({ killSwitch: config.killSwitch });
});

app.post('/api/live', (req, res) => {
  const on = (req.body as Record<string, unknown>).on;
  if (typeof on !== 'boolean') {
    res.status(400).json({ error: 'live trading requires a boolean on value' });
    return;
  }
  const nextConfig = {
    ...config,
    liveTradingEnabled: on,
    controlModes: { ...config.controlModes, liveOrders: on ? 'allowed' as const : 'paused' as const },
  };
  saveConfig(ledger, nextConfig);
  Object.assign(config, nextConfig);
  ledger.logEvent('manual_action', null, { action: 'live_trading', on: config.liveTradingEnabled });
  res.json({ liveTradingEnabled: config.liveTradingEnabled });
});

function parseIntent(body: Record<string, unknown>): OrderIntent | null {
  if (typeof body.symbol !== 'string') return null;
  const symbol = body.symbol;
  const side = body.side === 'SELL' ? 'SELL' : body.side === 'BUY' ? 'BUY' : null;
  const type = body.type === 'LIMIT' ? 'LIMIT' : body.type === 'MARKET' ? 'MARKET' : null;
  if (!/^[A-Z0-9]{4,20}$/.test(symbol) || !side || !type) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  for (const value of [body.quantity, body.quoteQty, body.price]) {
    if (value !== undefined && num(value) === undefined) return null;
  }
  if (body.quantity !== undefined && body.quoteQty !== undefined) return null;
  if (body.timeInForce !== undefined && !['GTC', 'IOC', 'FOK'].includes(String(body.timeInForce))) return null;
  if (body.source !== undefined && body.source !== 'manual' && body.source !== 'proposal') return null;
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
  runAsync(res, async () => {
    const intent = parseIntent(req.body as Record<string, unknown>);
    if (!intent) {
      res.status(400).json({ error: 'invalid order intent' });
      return;
    }
    res.json(await orders.testOrder(intent));
  });
});

app.post('/api/trade/send', (req, res) => {
  runAsync(res, async () => {
    const body = req.body as Record<string, unknown>;
    const intent = parseIntent(body);
    if (!intent) {
      res.status(400).json({ error: 'invalid order intent' });
      return;
    }
    const confirmSymbol = typeof body.confirmSymbol === 'string' ? body.confirmSymbol : '';
    res.json(await orders.send(intent, confirmSymbol));
  });
});

app.get('/api/orders/recovery', (req, res) => {
  const requested = Number(req.query.limit ?? 100);
  const limit = Number.isSafeInteger(requested) && requested >= 1 && requested <= 500 ? requested : 100;
  const requestedAfter = Number(req.query.afterRequestId ?? 0);
  const afterRequestId = Number.isSafeInteger(requestedAfter) && requestedAfter >= 0
    ? requestedAfter
    : 0;
  const requests = orders.pendingOrderRecoveries(limit, afterRequestId);
  const nextAfterRequestId = requests.at(-1)?.requestId ?? afterRequestId;
  res.json({
    requests,
    afterRequestId,
    nextAfterRequestId,
    hasMore: requests.length === limit && orders.pendingOrderRecoveries(1, nextAfterRequestId).length > 0,
  });
});

app.post('/api/orders/recovery/resolve', (req, res) => {
  runAsync(res, async () => {
    const body = req.body as Record<string, unknown>;
    const action = body.action === 'hold'
      || body.action === 'confirm_not_sent'
      || body.action === 'confirm_accepted'
      ? body.action
      : null;
    if (!action) {
      res.status(400).json({ ok: false, error: 'invalid order-recovery action' });
      return;
    }
    const verified = operatorAccess.operator(req);
    if (!verified) {
      res.status(403).json({ ok: false, error: 'verified operator identity is required' });
      return;
    }
    const result = await orders.resolveOrderRecovery({
      reservationId: typeof body.reservationId === 'string' ? body.reservationId : '',
      clientOrderId: typeof body.clientOrderId === 'string' ? body.clientOrderId : '',
      action,
      confirm: typeof body.confirm === 'string' ? body.confirm : '',
      reason: typeof body.reason === 'string' ? body.reason : '',
      operator: verified.email ?? verified.id,
      orderId: typeof body.orderId === 'number' ? body.orderId : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
      executedQty: typeof body.executedQty === 'number' ? body.executedQty : undefined,
      executedQuoteUsd: typeof body.executedQuoteUsd === 'number' ? body.executedQuoteUsd : undefined,
    });
    res.status(result.ok ? 200 : 409).json(result);
  });
});

app.post('/api/orders/cancel', (req, res) => {
  runAsync(res, async () => {
    const body = req.body as Record<string, unknown>;
    const symbol = typeof body.symbol === 'string' ? body.symbol : '';
    const orderId = body.orderId;
    if (!/^[A-Z0-9]{4,20}$/.test(symbol) || typeof orderId !== 'number' || !Number.isSafeInteger(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'bad cancel request' });
      return;
    }
    res.json(await orders.cancel(symbol, orderId));
  });
});

// Serve the built dashboard (web/dist) with SPA fallback.
//
// Cache policy matters here: index.html must NEVER be served stale, or a rebuild
// (which mints a new hashed bundle and deletes the old one) leaves a browser
// holding a cached index.html that points at a now-missing JS file → the script
// 404s and the page renders blank white. So: index.html always revalidates,
// while the content-hashed /assets/* files are safe to cache immutably forever.
const webDist = path.resolve(process.cwd(), 'web/dist');
if (fs.existsSync(webDist)) {
  app.use(
    express.static(webDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    // Never serve the HTML shell in place of a missing static asset. A stale
    // cached index.html requesting a deleted hashed bundle must 404 cleanly —
    // otherwise the browser receives HTML where it expects JS/CSS, fails to
    // parse it, and the page goes blank white. Only extensionless routes (the
    // SPA itself, served from "/") get the shell.
    if (req.path.startsWith('/assets/') || path.extname(req.path)) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, code: 'API_NOT_FOUND', error: 'API route not found.' });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const details = error as { status?: number; type?: string } | null;
  const malformedJson = details?.type === 'entity.parse.failed';
  const tooLarge = details?.type === 'entity.too.large' || details?.status === 413;
  const status = tooLarge ? 413 : malformedJson ? 400 : 500;
  const code = tooLarge ? 'BODY_TOO_LARGE' : malformedJson ? 'INVALID_JSON' : 'INTERNAL_ERROR';
  const message = tooLarge ? 'Request body exceeds the allowed size.' : malformedJson ? 'Request body is not valid JSON.' : 'Request could not be completed.';
  try {
    if (status === 500) ledger.logEvent('error_event', null, { source: 'http.error', message: error instanceof Error ? error.message : String(error) });
  } catch {
    // The response must remain available even if persistence is degraded.
  }
  if (!res.headersSent) res.status(status).json({ ok: false, code, error: message });
  else res.end();
});

const server = http.createServer(app);
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1_000;

const wss = new WebSocketServer({
  noServer: true,
  clientTracking: true,
  maxPayload: 16 * 1024,
  perMessageDeflate: false,
});
const WS_MAX_CLIENTS = 64;
const WS_MAX_CLIENTS_PER_IP = 8;
const WS_MAX_PENDING_UPGRADES = 16;
const WS_MAX_BUFFERED_BYTES = 512 * 1024;
const WS_MESSAGES_PER_WINDOW = 30;
const WS_MESSAGE_WINDOW_MS = 10_000;
const wsClientIp = new WeakMap<WebSocket, string>();
const wsAlive = new WeakMap<WebSocket, boolean>();
const wsMessageRate = new WeakMap<WebSocket, { startedAt: number; count: number }>();
let pendingWsUpgrades = 0;
const pendingWsUpgradeSockets = new Set<import('node:stream').Duplex>();

function websocketCountForIp(ip: string): number {
  let count = 0;
  for (const client of wss.clients) if (wsClientIp.get(client) === ip) count++;
  return count;
}

function rejectUpgrade(socket: import('node:stream').Duplex, status: 400 | 401 | 404 | 429 | 503, reason: string): void {
  if (socket.destroyed) return;
  const label = status === 401
    ? 'Unauthorized'
    : status === 404
      ? 'Not Found'
      : status === 429
        ? 'Too Many Requests'
        : status === 503
          ? 'Service Unavailable'
          : 'Bad Request';
  socket.end(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`);
}

server.on('upgrade', (request, socket, head) => {
  // A raw upgrade socket can emit before `ws` owns it. Keep that failure
  // contained for the entire underlying socket lifetime.
  socket.on('error', () => undefined);
  if (shuttingDown) {
    rejectUpgrade(socket, 503, 'WebSocket service is shutting down.');
    return;
  }
  let pathname = '';
  try {
    pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    rejectUpgrade(socket, 400, 'Invalid WebSocket request.');
    return;
  }
  if (pathname !== '/ws') {
    rejectUpgrade(socket, 404, 'WebSocket endpoint not found.');
    return;
  }
  if (pendingWsUpgrades >= WS_MAX_PENDING_UPGRADES || wss.clients.size >= WS_MAX_CLIENTS) {
    rejectUpgrade(socket, 429, 'WebSocket capacity reached.');
    return;
  }
  pendingWsUpgrades++;
  pendingWsUpgradeSockets.add(socket);
  void operatorAccess.verify(request, { websocket: true })
    .then((verification) => {
      if (shuttingDown || socket.destroyed) {
        rejectUpgrade(socket, 503, 'WebSocket service is shutting down.');
        return;
      }
      if (!verification.authorized) {
        rejectUpgrade(socket, 401, 'WebSocket operator verification failed.');
        return;
      }
      if (wss.clients.size >= WS_MAX_CLIENTS) {
        rejectUpgrade(socket, 429, 'WebSocket capacity reached.');
        return;
      }
      const ip = request.socket.remoteAddress?.replace(/^::ffff:/, '') ?? 'unknown';
      if (websocketCountForIp(ip) >= WS_MAX_CLIENTS_PER_IP) {
        rejectUpgrade(socket, 429, 'WebSocket per-client capacity reached.');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        if (shuttingDown) {
          ws.close(1012, 'service restart');
          return;
        }
        wsClientIp.set(ws, ip);
        wss.emit('connection', ws, request);
      });
    })
    .catch(() => rejectUpgrade(socket, 401, 'WebSocket operator verification failed.'))
    .finally(() => {
      pendingWsUpgradeSockets.delete(socket);
      pendingWsUpgrades = Math.max(0, pendingWsUpgrades - 1);
    });
});

// Live order-book/trade fan-out (public market data only, symbol-validated).
const bookHub = new BookStreamHub((s) => engine.filters.has(s));
wss.on('connection', (ws) => {
  wsAlive.set(ws, true);
  ws.on('error', () => {
    bookHub.drop(ws);
    try { ws.terminate(); } catch { /* already closed */ }
  });
  ws.on('pong', () => wsAlive.set(ws, true));
  ws.on('message', (buf) => {
    const now = Date.now();
    const current = wsMessageRate.get(ws);
    const rate = !current || now - current.startedAt >= WS_MESSAGE_WINDOW_MS
      ? { startedAt: now, count: 1 }
      : { startedAt: current.startedAt, count: current.count + 1 };
    wsMessageRate.set(ws, rate);
    if (rate.count > WS_MESSAGES_PER_WINDOW) {
      ws.close(1008, 'message rate exceeded');
      return;
    }
    try {
      bookHub.handleMessage(ws, JSON.parse(buf.toString()));
    } catch {
      ws.close(1007, 'invalid message');
    }
  });
  ws.on('close', () => bookHub.drop(ws));
});

function broadcast(msg: unknown): void {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
      c.close(1013, 'slow consumer');
      continue;
    }
    if (c.readyState === WebSocket.OPEN) c.send(s, (error) => {
      if (error && c.readyState === WebSocket.OPEN) c.close(1011, 'send failed');
    });
  }
}

const websocketHeartbeatTimer = setInterval(() => {
  for (const client of wss.clients) {
    if (wsAlive.get(client) === false) {
      client.terminate();
      continue;
    }
    wsAlive.set(client, false);
    try { client.ping(); } catch { client.terminate(); }
  }
}, 30_000);
const stateBroadcastTimer = setInterval(() => broadcast({ type: 'state', payload: buildState() }), TICK_MS);
ledger.on('event', (ev) => broadcast({ type: 'event', payload: ev }));

// Prime the icon resolver with the full market universe so logo coverage
// converges in the background without waiting for a browser to ask, and new
// listings resolve within the hour.
function primeIconUniverse(): void {
  try {
    resolveIcons(engine.allRows().map((r) => r.base));
  } catch {
    // non-fatal — the client-driven path still works
  }
}
const primeIconStartTimer = setTimeout(primeIconUniverse, 20_000);
const initialRefreshTimer = setTimeout(() => {
  void startCalendarRefresh();
  void getNewsContext(false).catch(() => undefined);
  void refreshFx().catch((error) => safeLogEvent('error_event', null, { source: 'fx.fetch', message: String(error) }));
  startNewsRefreshLoop();
}, 250);
function warmProfileUniverse(): void {
  try {
    const rows = engine.allRows();
    if (!rows.length) return;
    const prices = new Map(rows.map((r) => [r.base, r.spot]));
    void warmAllProfiles(rows.map((r) => r.base), (b) => prices.get(b) ?? null, STOCK_TOKENS);
  } catch {
    // non-fatal
  }
}
const warmProfileStartTimer = setTimeout(warmProfileUniverse, 45_000);
startLiquidationCollector();
const warmProfileTimer = setInterval(warmProfileUniverse, 24 * 3_600_000);
const primeIconTimer = setInterval(primeIconUniverse, 3_600_000);

server.listen(PORT, HOST, () => {
  console.log(`cosmos control room listening on http://${HOST}:${PORT}`);
});
server.on('error', (error) => {
  console.error('control-room listener failed:', error instanceof Error ? error.message : String(error));
  void gracefulShutdown('SIGTERM').finally(() => process.exit(1));
});

let shutdownPromise: Promise<void> | null = null;

function gracefulShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  const current = (async () => {
    shuttingDown = true;
    console.log(`received ${signal}; draining control-room services`);

    for (const timer of [
      basisStartTimer,
      volumeStartTimer,
      accountSyncTimer,
      orderSyncTimer,
      fillReconcileTimer,
      newsRefreshTimer,
      scannerTimer,
      eventRetentionTimer,
      websocketHeartbeatTimer,
      stateBroadcastTimer,
      primeIconStartTimer,
      initialRefreshTimer,
      warmProfileStartTimer,
      warmProfileTimer,
      primeIconTimer,
    ]) {
      if (timer) clearTimeout(timer);
    }

    userStream?.stop();
    bookHub.stop();
    basisRuntime.stop();
    volumeRuntime.stop();
    engine.stop();
    stopLiquidationCollector();
    for (const socket of pendingWsUpgradeSockets) {
      rejectUpgrade(socket, 503, 'WebSocket service is shutting down.');
      socket.destroy();
    }
    pendingWsUpgradeSockets.clear();

    const websocketClosed = new Promise<void>((resolve) => {
      wss.close(() => resolve());
      for (const client of wss.clients) client.close(1012, 'service restart');
      if (wss.clients.size === 0) resolve();
    });
    const httpClosed = new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
      server.closeIdleConnections();
    });

    const deadline = setTimeout(() => {
      for (const client of wss.clients) client.terminate();
      server.closeAllConnections();
    }, 8_000);
    deadline.unref();
    await Promise.all([httpClosed, websocketClosed]);
    clearTimeout(deadline);

    try {
      (ledger as Ledger & { close?: () => void }).close?.();
    } catch (error) {
      console.error('ledger close failed:', error instanceof Error ? error.message : String(error));
    }
    console.log('control-room shutdown complete');
  })();
  shutdownPromise = current;
  return current;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void gracefulShutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('graceful shutdown failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
  });
}
