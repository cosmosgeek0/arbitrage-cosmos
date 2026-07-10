#!/usr/bin/env node
/**
 * v0 gate tests. Boots the built server on a test port with an isolated data
 * dir and NO Binance keys, then asserts the contract the spec demands.
 * Run: node server/test/gates.mjs   (after npm run build)
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 8093;
const BASE = `http://localhost:${PORT}`;
const results = [];

function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(p) {
  const res = await fetch(`${BASE}${p}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function awsControl(p, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${p}`, {
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

let staged = '';
try {
  staged = execSync('git status --porcelain', { encoding: 'utf8' });
} catch {
  /* not a repo */
}
check('.env is not staged/tracked', !staged.split('\n').some((l) => l.trim().endsWith('.env') && !l.includes('.env.example')));

// The real danger is client code READING key material — not the env var
// names appearing in setup-instruction copy. Flag env access patterns and
// key-value-shaped literals in the shipped bundle.
const distDir = 'web/dist/assets';
let bundleClean = true;
if (existsSync(distDir)) {
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

// ---------- boot server ----------
console.log('\nBooting server (no keys, isolated data dir)…');
const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-gates-'));
const child = spawn(process.execPath, ['server/dist/index.js'], {
  // SKIP_DOTENV keeps gates deterministic/keyless even when a real .env exists,
  // so the disconnected-state contract is what gets tested.
  env: { PATH: process.env.PATH, PORT: String(PORT), DATA_DIR: dataDir, SKIP_DOTENV: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', (d) => (bootLog += d));
child.stderr.on('data', (d) => (bootLog += d));

const deadline = Date.now() + 90_000;
let booted = false;
while (Date.now() < deadline) {
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
  child.kill();
  process.exit(1);
}

// wait for a BTC price so notional estimation works
let priced = false;
while (Date.now() < deadline) {
  const { body } = await get('/api/market/quote?symbol=BTCUSDT');
  if (body?.last) {
    priced = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
check('market data flows (BTC price)', priced);

const health = (await get('/api/health')).body;
check('keys absent → keysPresent=false', health.keysPresent === false);
check('fresh boot mode is HALTED', health.mode === 'HALTED');

const state = (await get('/api/state')).body;
check('disconnected state: account is null', state.account === null);
check('disconnected state: binance.connected=false', state.binance.connected === false);
check('state includes config/risk/events', !!state.config && !!state.risk && Array.isArray(state.events));

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

// live send without keys must fail cleanly, never place anything
const send = (await post('/api/trade/send', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, confirmSymbol: 'BTCUSDT' })).body;
check('live send without keys fails cleanly', send?.sent === false && /keys/i.test(send?.error ?? ''));

// typed-confirmation mismatch must be rejected before anything else
const mismatch = (await post('/api/trade/send', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, confirmSymbol: 'WRONG' })).body;
check('send rejects on any failure without keys', mismatch?.sent === false);

// config persistence
await post('/api/config', { maxOrderNotionalUsd: 15 });
const cfg = (await get('/api/config')).body;
check('config saves and persists', cfg?.maxOrderNotionalUsd === 15);

// kill switch + live arm flow
await post('/api/kill', { on: false });
let h = (await get('/api/health')).body;
check('kill off → mode MANUAL', h.mode === 'MANUAL');
await post('/api/live', { on: true });
h = (await get('/api/health')).body;
check('live armed → mode LIVE_ARMED', h.mode === 'LIVE_ARMED');
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
check('ledger records manual actions (kill/live)', Array.isArray(manual) && manual.length >= 3);
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

const loansSnap = (await get('/api/loans')).body;
check('loans endpoint honest without keys', loansSnap?.available === false && /keys/i.test(loansSnap?.error ?? ''));

const borrow = (await post('/api/loans/borrow', { loanCoin: 'BTC', collateralCoin: 'USDT', amount: 1, confirmCoin: 'BTC' })).body;
check('loan borrow blocked without keys/arm', borrow?.ok === false);

const oh = (await get('/api/orders/history?symbol=BTCUSDT')).body;
check('order history honest without keys', oh?.available === false && Array.isArray(oh?.orders));

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

const loansM = (await get('/api/loans')).body;
check('loans includes honest margin state', loansM?.margin?.available === false && /keys/i.test(loansM?.margin?.error ?? ''));

const cAll = (await post('/api/orders/cancel-all', { symbol: 'BTCUSDT' })).body;
check('cancel-all honest without keys', cAll?.ok === false && /keys/i.test(cAll?.error ?? ''));

const maxB = (await get('/api/loans/max-borrowable?asset=BTC')).body;
check('max-borrowable honest without keys', maxB?.ok === false);

const sys = (await get('/api/system')).body;
check('system health responds', sys?.ok === true && typeof sys.uptimeSec === 'number' && sys.dbOk === true);

const awsStatus = (await awsControl('/api/aws-control/status')).body;
check(
  'AWS runner control defaults closed and honest',
  awsStatus?.status?.configured === false &&
    awsStatus?.status?.connectionEnabled === false &&
    awsStatus?.status?.executionEnabled === false &&
    awsStatus?.status?.channel === 'not_configured'
);
const awsDenied = await post('/api/aws-control/gates', { connectionEnabled: false });
check('AWS runner mutations require control header', awsDenied.status === 403 && awsDenied.body?.code === 'AWS_OPERATOR_DENIED');
const awsClosed = await awsControl('/api/aws-control/gates', { method: 'POST', body: { connectionEnabled: false } });
check('AWS runner gates can be explicitly locked', awsClosed.status === 200 && awsClosed.body?.gates?.connectionEnabled === false);
const awsUnconfigured = await awsControl('/api/aws-control/gates', { method: 'POST', body: { connectionEnabled: true } });
check('AWS runner channel cannot arm without target config', awsUnconfigured.status === 409 && awsUnconfigured.body?.code === 'AWS_NOT_CONFIGURED');
const awsHelp = await awsControl('/api/aws-control/command', { method: 'POST', body: { command: 'help' } });
check('AWS runner exposes restricted command help', awsHelp.status === 200 && /status/.test(awsHelp.body?.result?.output ?? ''));
const awsArbitrary = await awsControl('/api/aws-control/command', { method: 'POST', body: { command: 'rm -rf /' } });
check('AWS runner rejects arbitrary shell input', awsArbitrary.status === 400 && awsArbitrary.body?.code === 'AWS_COMMAND_NOT_ALLOWED');
const awsBlocked = await awsControl('/api/aws-control/command', { method: 'POST', body: { command: 'status' } });
check('AWS runner blocks remote command while channel is closed', awsBlocked.status === 423 && awsBlocked.body?.code === 'AWS_CHANNEL_BLOCKED');

const evSearch = (await get('/api/events?kind=manual_action&q=kill')).body;
check('ledger search works', Array.isArray(evSearch));

const secRes = await fetch(`${BASE}/api/health`);
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

const iconsRes = await fetch(`${BASE}/api/icons?bases=BTC,ETH,TLM,BREV`);
const iconsBody = await iconsRes.json().catch(() => null);
check('icon manifest endpoint responds', iconsRes.status === 200 && iconsBody !== null && typeof iconsBody === 'object');
check(
  'CSP allows coingecko + coincap image hosts',
  (secRes.headers.get('content-security-policy') ?? '').includes('coingecko.com') &&
    (secRes.headers.get('content-security-policy') ?? '').includes('coincap.io')
);

child.kill();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
if (failed.length > 0) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
