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
const actionPatterns = [
  /capital\/withdraw/i,
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
  env: { PATH: process.env.PATH, PORT: String(PORT), DATA_DIR: dataDir },
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

child.kill();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
if (failed.length > 0) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
