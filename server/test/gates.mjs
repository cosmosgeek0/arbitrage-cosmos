#!/usr/bin/env node
/**
 * v0 gate tests. Boots the built server on a test port with an isolated data
 * dir and hostile ambient credentials, then asserts they cannot become an
 * exchange-private, money-moving, or external-infrastructure capability.
 * Run: node server/test/gates.mjs   (after npm run build)
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HOST = '127.0.0.1';
const REQUEST_TIMEOUT_MS = 20_000;
const results = [];

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('could not reserve a test port'));
        return;
      }
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function childFinished(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs = 12_000) {
  if (childFinished(child)) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('close', onClose);
    };
    const onClose = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('server did not exit in time'));
    }, timeoutMs);
    child.once('close', onClose);
  });
}

async function stopChild(child) {
  if (childFinished(child)) return waitForExit(child);
  child.kill('SIGTERM');
  try {
    return await waitForExit(child);
  } catch (error) {
    if (!childFinished(child)) child.kill('SIGKILL');
    await waitForExit(child, 3_000).catch(() => undefined);
    throw error;
  }
}

const PORT = await availablePort();
const BASE = `http://${HOST}:${PORT}`;

async function request(p, init = {}) {
  return fetch(`${BASE}${p}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(p) {
  const res = await request(p);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

async function browserGet(p, deviceId = 'gate-primary-device-2026') {
  const res = await request(p, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36',
      Cookie: `cosmos_device=${deviceId}`,
    },
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

async function post(p, body) {
  const res = await request(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function awsControl(p, { method = 'GET', body } = {}) {
  const res = await request(p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Cosmos-Control': 'aws-runner',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ---------- static gates (no server needed) ----------
console.log('\nStatic gates:');

const gitignore = readFileSync('.gitignore', 'utf8');
check('.env is gitignored', /^\.env$/m.test(gitignore));

let envTracked = false;
try {
  execFileSync('git', ['ls-files', '--error-unmatch', '--', '.env'], { stdio: 'ignore' });
  envTracked = true;
} catch {
  // `git ls-files --error-unmatch` exits non-zero when .env is not in the index.
}
check('.env is not tracked', !envTracked);

// The real danger is client code READING key material — not the env var
// names appearing in setup-instruction copy. Flag env access patterns and
// key-value-shaped literals in the shipped bundle.
const distDir = 'web/dist/assets';
const bundleExists = existsSync(distDir);
check('frontend production bundle exists', bundleExists);
let bundleClean = bundleExists;
if (bundleExists) {
  for (const f of readdirSync(distDir)) {
    const txt = readFileSync(path.join(distDir, f), 'utf8');
    if (
      /import\.meta\.env\.\w*BINANCE/i.test(txt) ||
      /process\.env\.\w*BINANCE/i.test(txt) ||
      /apiSecret\s*[:=]\s*["'][A-Za-z0-9]{20,}/.test(txt) ||
      /X-MBX-APIKEY/.test(txt)
    ) {
      bundleClean = false;
    }
  }
}
check('frontend bundle reads no key material', bundleClean);

// No withdrawal/transfer-out FEATURE anywhere. Safety copy saying
// "withdrawals disabled" is required, so match action patterns instead.
// READ-ONLY history (capital/withdraw/history — past records for the equity
// chart) is allowed; the ACTION endpoint (capital/withdraw/apply) is banned.
const actionPatterns = [
  /capital\/withdraw\/apply/i,
  /\/api\/withdraw/i,
  /withdrawApply/i,
  /\bwithdraw\s*\(/i,
  /sub-account\/transfer/i,
  /asset\/transfer/i,
];
let noWithdrawFeature = true;
const scanDir = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) scanDir(p);
    else if (/\.(tsx?|mts|css)$/.test(f.name)) {
      const txt = readFileSync(p, 'utf8');
      if (actionPatterns.some((re) => re.test(txt))) {
        noWithdrawFeature = false;
        console.log(`    withdrawal-action pattern found in ${p}`);
      }
    }
  }
};
scanDir('web/src');
scanDir('server/src');
check('no withdrawal/transfer-out feature in source', noWithdrawFeature);

const serverIndex = readFileSync('server/src/index.ts', 'utf8');
check(
  'declared Binance keys never request withdrawal or universal-transfer permission',
  !/permissions\s*:\s*\{[^}]*withdrawals\s*:\s*true/si.test(serverIndex)
    && !/permissions\s*:\s*\{[^}]*universalTransfer\s*:\s*true/si.test(serverIndex)
);
check(
  'production composition has no ambient credential or external-control constructor',
  !/\bcredsFromEnv\b/.test(serverIndex) &&
    !/new\s+BinanceClient\b/.test(serverIndex) &&
    !/from\s+['"]\.\/binance\/userStream\.js['"]/.test(serverIndex) &&
    !/new\s+UserStream\b/.test(serverIndex) &&
    !/from\s+['"]\.\/services\/awsRunnerControl\.js['"]/.test(serverIndex) &&
    !/new\s+AwsRunnerControl\b/.test(serverIndex) &&
    !/from\s+['"]\.\/services\/loans\.js['"]/.test(serverIndex)
);
check(
  'legacy signed services receive only a mechanically unavailable client',
  /function\s+unavailablePrivateBinanceClient\(\):\s*BinanceClient\s*\|\s*null\s*\{\s*return\s+null;\s*\}/s.test(serverIndex) &&
    /const\s+client\s*=\s*unavailablePrivateBinanceClient\(\);/.test(serverIndex)
);
check(
  'production route composition invokes no signed or money mutation method',
  !/\b(?:orders|loans)\.(?:send|testOrder|cancel|cancelAll|borrow|repay|adjustLtv|resolveOrderRecovery)\s*\(/.test(serverIndex) &&
    !/\baccount\.sync\s*\(/.test(serverIndex) &&
    !/\borders\.(?:syncOpenOrders|reconcilePendingOrders)\s*\(/.test(serverIndex)
);
check(
  'legacy WebSocket does not expose raw Ledger events and Product streaming is not claimed',
  !/ledger\.on\(\s*['"]event['"][\s\S]{0,200}type:\s*['"]event['"]/.test(serverIndex)
);
check(
  'startup admits only market-owned auxiliaries from canonical lifecycle truth',
  /component\.componentId\s*===\s*['"]market-universe['"]/.test(serverIndex) &&
    /market\.readiness\s*===\s*['"]READY['"]/.test(serverIndex) &&
    /server\.listen\([\s\S]*?startServerTimers\(\);/.test(serverIndex) &&
    !/startNewsRefreshLoop|primeIconStartTimer|initialRefreshTimer|warmProfileStartTimer/.test(serverIndex)
);

// ---------- boot server ----------
console.log('\nBooting server (hostile ambient credentials, isolated data dir)…');
const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-gates-'));
const privateEgressSentinel = path.join(dataDir, 'private-egress-attempts.log');
const child = spawn(process.execPath, ['--import', './server/test/private-egress-tripwire.mjs', 'server/dist/index.js'], {
  // Synthetic credentials are deliberate: the runtime must remain keyless and
  // owner-gated even if every common ambient credential source is populated.
  env: {
    PATH: process.env.PATH,
    PORT: String(PORT),
    HOST,
    DATA_DIR: dataDir,
    PROFILE_CACHE: path.join(dataDir, 'profile-cache.json'),
    ICON_CACHE: path.join(dataDir, 'icon-cache.json'),
    LIQ_CACHE: path.join(dataDir, 'liquidations.json'),
    SKIP_DOTENV: '1',
    BINANCE_API_KEY: 'sentinel-binance-api-key-not-a-secret',
    BINANCE_API_SECRET: 'sentinel-binance-api-secret-not-a-secret',
    AWS_ACCESS_KEY_ID: 'SENTINELACCESSKEY',
    AWS_SECRET_ACCESS_KEY: 'sentinel-aws-secret-not-a-secret',
    AWS_SESSION_TOKEN: 'sentinel-aws-session-not-a-secret',
    AWS_REGION: 'us-east-1',
    AWS_CONTROL_REGION: 'us-east-1',
    AWS_CONTROL_INSTANCE_ID: 'i-0123456789abcdef0',
    AWS_CONTROL_RUNNER_PATH: '/tmp/sentinel-runner.mjs',
    AWS_CONTROL_WORKDIR: '/tmp',
    AWS_CONTROL_SERVICE: 'sentinel-service',
    AWS_CONTROL_VALIDATE_COMMAND: 'true',
    NOTIFICATION_AWS_INGEST_TOKEN: 'sentinel-aws-notification-token-not-a-secret',
    PRIVATE_EGRESS_SENTINEL_FILE: privateEgressSentinel,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
let spawnError = null;
child.on('error', (error) => { spawnError = error; });
child.stdout.on('data', (d) => { bootLog = `${bootLog}${d}`.slice(-32_000); });
child.stderr.on('data', (d) => { bootLog = `${bootLog}${d}`.slice(-32_000); });

try {
const deadline = Date.now() + 90_000;
let booted = false;
while (Date.now() < deadline) {
  if (spawnError || childFinished(child)) break;
  try {
    const { body } = await get('/api/health');
    if (body?.ok) {
      booted = true;
      break;
    }
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('\nRuntime gates:');
check('app boots', booted, booted ? '' : bootLog.slice(-300));
if (!booted) {
  throw new Error(`app did not boot${spawnError ? `: ${spawnError.message}` : `: ${bootLog.slice(-500)}`}`);
}

// wait for a BTC price so notional estimation works
const priceDeadline = Date.now() + 90_000;
let priced = false;
while (Date.now() < priceDeadline) {
  const { body } = await get('/api/market/quote?symbol=BTCUSDT');
  if (body?.last) {
    priced = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
check('market data flows (BTC price)', priced, priced ? '' : bootLog.slice(-1_000));

const health = (await get('/api/health')).body;
check('keys absent → keysPresent=false', health.keysPresent === false);
check('fresh boot mode is HALTED', health.mode === 'HALTED');

const state = (await get('/api/state')).body;
check('disconnected state: account is null', state.account === null);
check('disconnected state: binance.connected=false', state.binance.connected === false);
check(
  'ambient Binance credentials cannot create a private runtime posture',
  state.binance.keysPresent === false && state.binance.userStream === 'off' && state.binance.keyFingerprint === null
);
check('state includes config/risk/events', !!state.config && !!state.risk && Array.isArray(state.events));
const tradeReady = await get('/health/trade-ready');
const processLive = await get('/health/live');
check(
  'canonical liveness remains process-only while readiness evidence is unavailable',
  processLive.status === 200 && processLive.body?.ok === true
);
const dependencyReady = await get('/health/ready');
check(
  'canonical readiness fails closed without owner-supplied meaningful advance',
  dependencyReady.status === 503 &&
    dependencyReady.body?.ok === false &&
    dependencyReady.body?.lastMeaningfulAdvanceAtMs === null &&
    dependencyReady.body?.reasonCodes?.includes('MEANINGFUL_ADVANCE_NOT_SUPPLIED')
);
check(
  'canonical trade readiness preserves the live-execution barrier',
  tradeReady.status === 503 && tradeReady.body?.executionBarrier === 'LIVE_EXECUTION_NOT_IMPLEMENTED'
);

await browserGet('/api/state');
const browserSessionsResponse = await browserGet('/api/sessions');
const browserSessions = browserSessionsResponse.body;
check(
  'browser sessions persist truthful browser-only activity',
  browserSessionsResponse.status === 200 &&
    browserSessions?.source === 'browser-request-telemetry' &&
    browserSessions?.retentionHours === 24 &&
    browserSessions?.activeWindowSeconds === 120 &&
    browserSessions?.cloudflareActiveSessions === false &&
    browserSessions?.sessions?.length === 1 &&
    browserSessions.sessions[0]?.current === true &&
    browserSessions.sessions[0]?.active === true &&
    browserSessions.sessions[0]?.system === 'macOS' &&
    /^Chrome /.test(browserSessions.sessions[0]?.browser ?? '') &&
    browserSessions.sessions[0]?.device === 'Desktop' &&
    browserSessions.sessions[0]?.ip === '127.0.0.1' &&
    browserSessions.sessions[0]?.requests >= 2 &&
    /no-store/i.test(browserSessionsResponse.headers.get('cache-control') ?? '')
);

await browserGet('/api/state', 'gate-secondary-device-2026');
const multiDeviceSessions = (await browserGet('/api/sessions', 'gate-secondary-device-2026')).body;
check(
  'same IP and browser keep separate latest devices',
  multiDeviceSessions?.identity === 'first-party-device-token' &&
    multiDeviceSessions?.sessions?.length === 2 &&
    multiDeviceSessions.sessions.filter((session) => session.active).length === 2 &&
    multiDeviceSessions.sessions.filter((session) => session.current).length === 1 &&
    multiDeviceSessions.sessions[0]?.current === true,
);

// oversized order must be rejected by risk
const big = (await post('/api/trade/preview', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 100 })).body;
const bigNotional = big?.risk?.checks?.find((c) => c.name === 'max_order_notional');
check('risk rejects oversized order', bigNotional?.pass === false, bigNotional?.detail);

// tiny order passes the notional check (other checks may still fail — that's correct)
const tiny = (await post('/api/trade/preview', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10 })).body;
const tinyNotional = tiny?.risk?.checks?.find((c) => c.name === 'max_order_notional');
check('risk allows tiny valid order (notional check)', tinyNotional?.pass === true, tinyNotional?.detail);
check('preview validates Binance filters', tiny?.filters?.minNotional !== undefined);
check('kill switch blocks in risk checks', tiny?.risk?.checks?.find((c) => c.name === 'kill_switch_off')?.pass === false);
check('empty allowlist blocks symbol', tiny?.risk?.checks?.find((c) => c.name === 'symbol_allowed')?.pass === false);

const send = await post('/api/trade/send', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, confirmSymbol: 'BTCUSDT' });
check(
  'live send is retired independently of ambient credentials',
  send.status === 410 && send.body?.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED'
);
const testOrder = await post('/api/trade/test', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10 });
check(
  'signed test-order route is retired',
  testOrder.status === 410 && testOrder.body?.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED'
);

// config persistence
await post('/api/config', { maxOrderNotionalUsd: 15 });
const cfg = (await get('/api/config')).body;
check(
  'config saves while financial posture remains sealed',
  cfg?.maxOrderNotionalUsd === 15 &&
    cfg?.liveTradingEnabled === false &&
    cfg?.fundsLocked === true &&
    cfg?.controlModes?.funds === 'blocked' &&
    cfg?.controlModes?.borrowing === 'blocked' &&
    cfg?.controlModes?.liveOrders === 'blocked' &&
    cfg?.borrowGuard?.newBorrowPaused === true &&
    cfg?.borrowGuard?.repayOnly === true
);

const hostileConfig = await post('/api/config', {
  liveTradingEnabled: true,
  fundsLocked: false,
  borrowGuard: { enabled: false, newBorrowPaused: false, repayOnly: false },
  controlModes: { funds: 'allowed', borrowing: 'allowed', liveOrders: 'allowed' },
});
check(
  'config arming request fails closed',
  hostileConfig.status === 409 &&
    hostileConfig.body?.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED' &&
    hostileConfig.body?.fields?.includes?.('controlModes.liveOrders')
);
const safeConfig = await post('/api/config', {
  controlModes: { funds: 'blocked', borrowing: 'blocked', automation: 'paused', liveOrders: 'blocked' },
});
check('safe non-financial config remains writable', safeConfig.status === 200 && safeConfig.body?.controlModes?.automation === 'paused');

// Kill can disengage while the separate live-execution barrier remains sealed.
await post('/api/kill', { on: false });
let h = (await get('/api/health')).body;
check('kill off → mode MANUAL', h.mode === 'MANUAL');
const liveArm = await post('/api/live', { on: true });
h = (await get('/api/health')).body;
check('direct live arm is retired', liveArm.status === 410 && liveArm.body?.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED');
check('failed live arm leaves mode MANUAL and live orders blocked', h.mode === 'MANUAL' && (await get('/api/config')).body?.controlModes?.liveOrders === 'blocked');
await post('/api/kill', { on: true });
h = (await get('/api/health')).body;
check('kill switch overrides → HALTED', h.mode === 'HALTED');

// ledger must have recorded all of the above
const intents = (await get('/api/events?kind=order_intent&limit=10')).body;
const decisions = (await get('/api/events?kind=risk_decision&limit=10')).body;
const manual = (await get('/api/events?kind=manual_action&limit=10')).body;
const cfgEv = (await get('/api/events?kind=config_change&limit=10')).body;
check('ledger records order intents', Array.isArray(intents) && intents.length >= 2);
check('ledger records risk decisions', Array.isArray(decisions) && decisions.length >= 2);
check('ledger records kill actions but no live-arm mutation', Array.isArray(manual) && manual.length >= 2 && !manual.some((event) => event?.data?.action === 'live_trading'));
check('ledger records config changes', Array.isArray(cfgEv) && cfgEv.length >= 1);

// remaining API surface renders data
check('fills endpoint responds', Array.isArray((await get('/api/fills')).body));
check('pnl endpoint responds', !!(await get('/api/pnl')).body?.realizedByDay);
check('signals endpoint responds', !!(await get('/api/signals')).body);

const mkts = (await get('/api/markets')).body;
check('markets endpoint returns all pairs', Array.isArray(mkts?.rows) && mkts.rows.length > 300, `${mkts?.rows?.length ?? 0} rows`);
check('markets rows carry spark arrays', Array.isArray(mkts?.rows?.[0]?.spark));

const detail = (await get('/api/market/detail?symbol=BTCUSDT')).body;
check('market detail responds', detail?.row?.symbol === 'BTCUSDT' && detail?.filters !== null);

const walletBalanceResponse = await get('/api/wallet-balances');
check(
  'wallet balance aggregate is never browser/proxy cached',
  /private/i.test(walletBalanceResponse.headers.get('cache-control') ?? '')
    && /no-store/i.test(walletBalanceResponse.headers.get('cache-control') ?? '')
);

const privateReadResponses = [
  await post('/api/fills/import', { symbol: 'BTCUSDT' }),
  await get('/api/equity-history'),
  await get('/api/earn'),
  walletBalanceResponse,
  await get('/api/loans'),
  await post('/api/loans/refresh', {}),
  await get('/api/orders/history?symbol=BTCUSDT'),
  await get('/api/loans/max-borrowable?asset=BTC'),
  await post('/api/refresh', { target: 'account' }),
  await get('/api/apikey'),
];
check(
  'all private/account compatibility routes are statically NOT_CONFIGURED',
  privateReadResponses.every((response) => response.status === 503 && response.body?.code === 'NOT_CONFIGURED' && response.body?.available === false)
);

const retiredMoneyResponses = [
  await post('/api/loans/reconcile', { confirm: 'RECONCILE' }),
  await post('/api/loans/borrow', { loanCoin: 'BTC', collateralCoin: 'USDT', amount: 1, confirmCoin: 'BTC' }),
  await post('/api/loans/adjust-ltv', { loanCoin: 'BTC', collateralCoin: 'USDT', amount: 1, direction: 'ADDITIONAL', confirmCoin: 'BTC' }),
  await post('/api/loans/repay', { loanCoin: 'BTC', collateralCoin: 'USDT', amount: 1, confirmCoin: 'BTC' }),
  await post('/api/orders/cancel', { symbol: 'BTCUSDT', orderId: 1 }),
  await post('/api/orders/cancel-all', { symbol: 'BTCUSDT' }),
  await post('/api/orders/recovery/resolve', { action: 'hold' }),
];
check(
  'all loan/order money and recovery mutations are deterministically retired',
  retiredMoneyResponses.every((response) => response.status === 410 && response.body?.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED')
);
check('local order-recovery evidence remains read-only', (await get('/api/orders/recovery')).status === 200);

const depthB = (await get('/api/market/depth?symbol=BTCUSDT')).body;
check('depth endpoint returns book', Array.isArray(depthB?.bids) && depthB.bids.length > 5 && Array.isArray(depthB?.asks));

const tradesB = (await get('/api/market/trades?symbol=BTCUSDT')).body;
check('trades endpoint returns prints', Array.isArray(tradesB) && tradesB.length > 5 && tradesB[0].price > 0);

const futK = (await get('/api/klines?symbol=BTCUSDT&interval=5m&limit=50&market=futures')).body;
check('futures klines for basis chart', Array.isArray(futK) && futK.length > 10);

const fundH = (await get('/api/funding/history?symbol=BTCUSDT')).body;
check('funding history responds', Array.isArray(fundH) && fundH.length > 10);

const fundX = (await get('/api/funding/extremes')).body;
check('funding extremes responds', Array.isArray(fundX?.positive) && Array.isArray(fundX?.negative));

const sctx = (await get('/api/symbol/context?symbol=BTCUSDT')).body;
check('symbol context responds', Array.isArray(sctx?.openOrders) && Array.isArray(sctx?.fills) && Array.isArray(sctx?.signals));

const sys = (await get('/api/system')).body;
check('system health responds', sys?.ok === true && typeof sys.uptimeSec === 'number' && sys.dbOk === true);
const browserObservation = await post('/api/connections/browser-observation', { rttMs: 24, socketConnected: true });
check('browser connection observation is sanitized and accepted', browserObservation.status === 200 && browserObservation.body?.observation?.status === 'operational');
check(
  'connection inventory exposes live, cached, and planned source truth',
  typeof sys?.connections?.basis?.running === 'boolean' &&
    typeof sys?.connections?.volume?.streamConnections === 'number' &&
    typeof sys?.connections?.news?.sources === 'number' &&
    typeof sys?.connections?.calendar?.items === 'number' &&
    typeof sys?.connections?.fx?.currencies === 'number' &&
    typeof sys?.connections?.watchman?.summary?.required === 'number' &&
    Array.isArray(sys?.connections?.watchman?.components) &&
    sys.connections.watchman.components.some((component) => component.id === 'market-streams' && component.resetTarget === 'market') &&
    sys.connections.watchman.components.some((component) => component.id === 'user-stream' && component.status === 'planned' && /NOT_CONFIGURED/.test(component.detail ?? '')) &&
    sys.connections.watchman.components.some((component) => component.id === 'aws-runner' && component.status === 'planned') &&
    sys?.connections?.planned?.awsRunner?.configured === false &&
    sys?.connections?.planned?.awsRunner?.state === 'owner_gated' &&
    typeof sys?.connections?.planned?.cloudflareAccess?.reason === 'string'
);

const notificationRouting = (await get('/api/notification-routing')).body;
check(
  'notification routing exposes real source and destination readiness',
  notificationRouting?.sources?.bot?.available === true &&
    notificationRouting?.sources?.execution?.available === false &&
    notificationRouting?.sources?.aws?.available === false &&
    notificationRouting?.destinations?.inApp?.available === true &&
    notificationRouting?.destinations?.telegram?.available === false
);
const awsNotificationResponse = await request('/api/notifications/ingest/aws', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer sentinel-aws-notification-token-not-a-secret',
  },
  body: JSON.stringify({
    source: 'aws.ec2',
    'detail-type': 'EC2 Instance State-change Notification',
    detail: { state: 'stopped' },
  }),
});
const awsNotificationClosed = {
  status: awsNotificationResponse.status,
  body: await awsNotificationResponse.json().catch(() => null),
};
check(
  'AWS notification intake remains OWNER_GATED despite a matching hostile ambient token',
  awsNotificationClosed.status === 503 &&
    awsNotificationClosed.body?.code === 'OWNER_GATED' &&
    awsNotificationClosed.body?.available === false
);

const awsStatus = await awsControl('/api/aws-control/status');
const awsProbe = await awsControl('/api/aws-control/status?probe=1');
const awsOwnerGated = [
  awsStatus,
  awsProbe,
  await post('/api/aws-control/gates', { connectionEnabled: true }),
  await awsControl('/api/aws-control/gates', { method: 'POST', body: { connectionEnabled: true, executionEnabled: true } }),
  await awsControl('/api/aws-control/command', { method: 'POST', body: { command: 'restart' } }),
  await awsControl('/api/aws-control/runner'),
  await awsControl('/api/aws-control/runner', { method: 'PUT', body: { content: 'sentinel', expectedSha256: null } }),
];
check(
  'all AWS status, probe, command, gate, and runner surfaces remain OWNER_GATED',
  awsOwnerGated.every((response) => response.status === 503 && response.body?.code === 'OWNER_GATED' && response.body?.available === false)
);
check('AWS probe cannot change behavior or contact AWS', JSON.stringify(awsProbe.body) === JSON.stringify(awsStatus.body));

const evSearch = (await get('/api/events?kind=manual_action&q=kill')).body;
check('ledger search works', Array.isArray(evSearch));

const secRes = await request('/api/health');
check(
  'security headers set (CSP, nosniff, frame, referrer)',
  (secRes.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'") &&
    secRes.headers.get('x-content-type-options') === 'nosniff' &&
    secRes.headers.get('x-frame-options') === 'DENY' &&
    secRes.headers.get('referrer-policy') === 'no-referrer'
);

const volK = (await get('/api/klines?symbol=BTCUSDT&interval=5m&limit=50&field=volume')).body;
check('volume klines respond', Array.isArray(volK) && volK.length > 10 && volK[0].v >= 0);

const volumeRuntime = (await get('/api/engine/volume')).body;
check(
  'volume runtime endpoint exposes status and rows',
  typeof volumeRuntime?.status?.running === 'boolean' && Array.isArray(volumeRuntime?.rows)
);

const basisRuntime = (await get('/api/engine/basis')).body;
check(
  'basis runtime exposes crossed-book decisions and borrow truth',
  typeof basisRuntime?.status?.running === 'boolean' &&
    Array.isArray(basisRuntime?.rows) &&
    basisRuntime?.status?.verifiedBorrow === 0 &&
    typeof basisRuntime?.thresholds?.watchGapPct === 'number'
);

check(
  'hostile ambient Binance and AWS credentials generated zero prohibited egress',
  !existsSync(privateEgressSentinel),
  existsSync(privateEgressSentinel) ? readFileSync(privateEgressSentinel, 'utf8').slice(0, 300) : ''
);

const iconsRes = await request('/api/icons?bases=BTC,ETH,TLM,BREV');
const iconsBody = await iconsRes.json().catch(() => null);
check('icon manifest endpoint responds', iconsRes.status === 200 && iconsBody !== null && typeof iconsBody === 'object');
check(
  'CSP allows coingecko + coincap image hosts',
  (secRes.headers.get('content-security-policy') ?? '').includes('coingecko.com') &&
    (secRes.headers.get('content-security-policy') ?? '').includes('coincap.io')
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
if (failed.length > 0) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '));
  process.exitCode = 1;
}
} finally {
  await stopChild(child).catch((error) => {
    console.error(`failed to stop gate server: ${error.message}`);
    process.exitCode = 1;
  });
  rmSync(dataDir, { recursive: true, force: true });
}
